/* EDL reference codec: bounded decoder for methods 0, 1, 2; encoder selects
 * the smallest stored, Huffman/LZ, or fixed-code LZ representation.
 * Return 0 on success, -1 on malformed input or insufficient output capacity.
 */
#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <new>
#include <vector>

namespace {

uint32_t get32(const uint8_t *p, bool be) {
    if (be) return uint32_t(p[0]) << 24 | uint32_t(p[1]) << 16 | uint32_t(p[2]) << 8 | p[3];
    return uint32_t(p[3]) << 24 | uint32_t(p[2]) << 16 | uint32_t(p[1]) << 8 | p[0];
}

void put32(uint8_t *p, uint32_t n) {
    p[0] = n >> 24; p[1] = n >> 16; p[2] = n >> 8; p[3] = n;
}

struct Reader {
    const uint8_t *src;
    size_t pos, end;
    uint32_t word = 0;
    unsigned left = 0;
    bool get(unsigned count, unsigned &v) {
        v = 0;
        for (unsigned i = 0; i < count; i++) {
            if (!left) {
                if (end - pos < 4) return false;
                word = get32(src + pos, true);
                pos += 4;
                left = 32;
            }
            v |= (word & 1u) << i;
            word >>= 1;
            left--;
        }
        return true;
    }
};

struct Output {
    uint8_t *dst;
    size_t cap, pos = 0;
    bool literal(unsigned v) {
        if (pos == cap) return false;
        dst[pos++] = uint8_t(v);
        return true;
    }
    bool copy(unsigned distance, unsigned count) {
        if (!distance || distance > pos || count > cap - pos) return false;
        while (count--) { dst[pos] = dst[pos - distance]; pos++; }
        return true;
    }
};

struct Huffman {
    unsigned count[16] = {};
    std::array<unsigned, 511> symbol{};
    bool build(const unsigned *length, unsigned size) {
        std::fill(count, count + 16, 0);
        unsigned used = 0;
        for (unsigned i = 0; i < size; i++) {
            unsigned l = length[i];
            if (l > 15) return false;
            if (l) count[l]++;
        }
        int slots = 1;
        for (unsigned l = 1; l <= 15; l++) {
            slots = slots * 2 - int(count[l]);
            if (slots < 0) return false;
        }
        for (unsigned l = 1; l <= 15; l++)
            for (unsigned s = 0; s < size; s++)
                if (length[s] == l) symbol[used++] = s;
        return used != 0;
    }
    bool read(Reader &r, unsigned &symbol_out) const {
        unsigned code = 0, first = 0, index = 0, bit;
        for (unsigned length = 1; length <= 15; length++) {
            if (!r.get(1, bit)) return false;
            code = code << 1 | bit;
            if (code >= first && code - first < count[length]) {
                symbol_out = symbol[index + code - first];
                return true;
            }
            index += count[length];
            first = (first + count[length]) << 1;
        }
        return false;
    }
};

constexpr unsigned length_base[] = {
    0,1,2,3,4,5,6,7,8,10,12,14,16,20,24,28,32,40,48,
    56,64,80,96,112,128,160,192,224,255
};
constexpr unsigned length_extra[] = {
    0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0
};
constexpr unsigned distance_base[] = {
    0,1,2,3,4,6,8,12,16,24,32,48,64,96,128,192,256,384,
    512,768,1024,1536,2048,3072,4096,6144,8192,12288,16384,24576
};
constexpr unsigned distance_extra[] = {
    0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,
    10,10,11,11,12,12,13,13
};

bool method1(Reader &r, Output &out) {
    Huffman lit, dist;
    bool have_lit = false, have_dist = false;
    unsigned last_length = 0, v;
    for (;;) {
        if (!r.get(1, v)) return false;
        if (!v) {
            unsigned n;
            if (!r.get(15, n) || n > out.cap - out.pos) return false;
            while (n--) {
                if (!r.get(8, v) || !out.literal(v)) return false;
            }
        } else {
            for (unsigned table = 0; table < 2; table++) {
                unsigned n;
                if (!r.get(9, n)) return false;
                if (!n) continue;
                unsigned lengths[511];
                for (unsigned i = 0; i < n; i++) {
                    if (!r.get(1, v)) return false;
                    if (v && !r.get(4, last_length)) return false;
                    lengths[i] = last_length;
                }
                if (table == 0) {
                    if (!lit.build(lengths, n)) return false;
                    have_lit = true;
                } else {
                    if (!dist.build(lengths, n)) return false;
                    have_dist = true;
                }
            }
            if (!have_lit || !have_dist) return false;
            for (;;) {
                unsigned s;
                if (!lit.read(r, s)) return false;
                if (s < 256) {
                    if (!out.literal(s)) return false;
                } else if (s == 256) break;
                else {
                    unsigned d, extra, dextra;
                    if (s > 285 || !r.get(length_extra[s - 257], extra) ||
                        !dist.read(r, d) || d >= 30 ||
                        !r.get(distance_extra[d], dextra) ||
                        !out.copy(distance_base[d] + dextra + 1,
                                  length_base[s - 257] + extra + 3)) return false;
                }
            }
        }
        if (!r.get(1, v)) return false;
        if (v) return true;
    }
}

bool distance2(Reader &r, unsigned &distance) {
    unsigned hi, a, b, c, v;
    if (!r.get(1, v)) return false;
    if (!v) hi = 0;
    else {
        if (!r.get(1, a) || !r.get(1, b)) return false;
        if (!b) {
            if (a) hi = 1;
            else { if (!r.get(1, c)) return false; hi = 2 + c; }
        } else {
            if (!r.get(1, c) || !r.get(1, v)) return false;
            unsigned h = a * 2 + c + 4;
            if (v) hi = h;
            else { if (!r.get(1, c)) return false; hi = h * 2 + c; }
        }
    }
    if (!r.get(8, v)) return false;
    distance = (hi << 8) + v + 1;
    return true;
}

bool method2(Reader &r, Output &out) {
    unsigned v;
    for (;;) {
        if (!r.get(1, v)) return false;
        if (!v) {
            if (!r.get(8, v) || !out.literal(v)) return false;
            continue;
        }
        unsigned length, distance;
        if (!r.get(1, v)) return false;
        if (!v) {
            if (!r.get(1, v)) return false;
            length = v + 4;
            if (!r.get(1, v)) return false;
            if (v) {
                unsigned y;
                if (!r.get(1, y)) return false;
                length = (length - 1) * 2 + y;
            }
            if (length == 9) {
                if (!r.get(4, v)) return false;
                unsigned n = v * 4 + 12;
                if (n > out.cap - out.pos) return false;
                while (n--) {
                    if (!r.get(8, v) || !out.literal(v)) return false;
                }
                continue;
            }
            if (!distance2(r, distance)) return false;
        } else {
            if (!r.get(1, v)) return false;
            if (!v) {
                length = 2;
                if (!r.get(8, v)) return false;
                distance = v + 1;
            } else {
                if (!r.get(1, v)) return false;
                if (!v) length = 3;
                else {
                    if (!r.get(8, v)) return false;
                    if (!v) return true;
                    length = v + 8;
                }
                if (!distance2(r, distance)) return false;
            }
        }
        if (!out.copy(distance, length)) return false;
    }
}

} // namespace

int edl_decode(const uint8_t *src, size_t src_size, uint8_t *dst,
               size_t dst_cap, size_t *written, size_t *consumed) {
    if (!src || !dst || !written || !consumed || src_size < 12 ||
        std::memcmp(src, "EDL", 3)) return -1;
    bool be = (src[3] & 0x80) != 0;
    unsigned method = src[3] & 0x7f;
    size_t csize = get32(src + 4, be), dsize = get32(src + 8, be);
    if (csize < 12 || csize > src_size || dsize > dst_cap) return -1;
    Output out{dst, dsize};
    if (method == 0) {
        if (dsize > csize - 12) return -1;
        std::memmove(dst, src + 12, dsize);
        out.pos = dsize;
        *consumed = 12 + dsize;
    } else {
        Reader reader{src, 12, csize};
        bool ok = method == 1 ? method1(reader, out) :
                  method == 2 ? method2(reader, out) : false;
        if (!ok || out.pos != dsize) return -1;
        *consumed = reader.pos;
    }
    *written = out.pos;
    return 0;
}

namespace {

struct Writer {
    std::vector<uint8_t> bytes;
    uint32_t word = 0;
    unsigned count = 0;
    void put(unsigned n, unsigned value) {
        for (unsigned i = 0; i < n; i++) {
            word |= ((value >> i) & 1u) << count++;
            if (count == 32) flush();
        }
    }
    void flush() {
        bytes.push_back(word >> 24);
        bytes.push_back(word >> 16);
        bytes.push_back(word >> 8);
        bytes.push_back(word);
        word = count = 0;
    }
};

unsigned distance_bits(unsigned distance) {
    unsigned hi = (distance - 1) >> 8;
    return 8 + (hi == 0 ? 1 : hi == 1 ? 3 : hi < 4 ? 4 : hi < 8 ? 5 : 6);
}

void put_distance(Writer &w, unsigned distance) {
    unsigned hi = (distance - 1) >> 8;
    if (!hi) w.put(1, 0);
    else if (hi == 1) { w.put(1, 1); w.put(1, 1); w.put(1, 0); }
    else if (hi < 4) {
        w.put(1, 1); w.put(1, 0); w.put(1, 0); w.put(1, hi - 2);
    } else {
        unsigned h = hi < 8 ? hi : hi >> 1;
        w.put(1, 1); w.put(1, (h - 4) >> 1); w.put(1, 1);
        w.put(1, (h - 4) & 1); w.put(1, hi < 8);
        if (hi >= 8) w.put(1, hi & 1);
    }
    w.put(8, (distance - 1) & 255);
}

struct Match { uint16_t length = 0, distance = 0; };

struct Matches {
    std::vector<size_t> first;
    std::vector<Match> values;
    std::vector<uint16_t> pairs;
    Matches(const uint8_t *src, size_t size) : first(size + 1), pairs(size) {
        std::array<int32_t, 65536> head, pair;
        std::array<uint32_t, 32769> equal_end{};
        head.fill(-1); pair.fill(-1);
        std::vector<int32_t> previous(size, -1);
        for (size_t i = 0; i < size; i++) {
            first[i] = values.size();
            if (size - i < 2) continue;
            unsigned key2 = unsigned(src[i]) << 8 | src[i + 1];
            int32_t p = pair[key2];
            if (p >= 0 && i - size_t(p) <= 256) pairs[i] = uint16_t(i - size_t(p));
            pair[key2] = int32_t(i);
            if (size - i < 3) continue;
            unsigned key = ((key2 * 251u) ^ (unsigned(src[i + 2]) * 4051u)) & 65535;
            p = head[key];
            previous[i] = p;
            head[key] = int32_t(i);
            unsigned longest = 2, limit = unsigned(std::min<size_t>(263, size - i));
            // In increasing distance order, only a new longest match can
            // improve the fixed-code parse. Keep that frontier for both methods.
            while (p >= 0 && i - size_t(p) <= 32768) {
                unsigned distance = unsigned(i - size_t(p));
                if (src[size_t(p) + longest] == src[i + longest] &&
                    src[p] == src[i] && src[p + 1] == src[i + 1] && src[p + 2] == src[i + 2]) {
                    unsigned length = equal_end[distance] > i ? unsigned(equal_end[distance] - i) : 3;
                    length = std::max(length, 3u);
                    while (length < limit && src[size_t(p) + length] == src[i + length]) length++;
                    equal_end[distance] = uint32_t(i + length);
                    if (length > longest) {
                        values.push_back({uint16_t(length), uint16_t(distance)});
                        longest = length;
                        if (length == limit) break;
                    }
                }
                p = previous[p];
            }
        }
        first[size] = values.size();
    }
};

struct SuffixMin {
    static constexpr unsigned span = 512;
    std::array<uint64_t, span * 2> tree;
    SuffixMin() { tree.fill(UINT64_MAX); }
    void set(size_t pos, uint64_t cost) {
        unsigned at = span + (unsigned(pos) & (span - 1));
        tree[at] = cost << 9 | (unsigned(pos) & (span - 1));
        while (at > 1) {
            at >>= 1;
            tree[at] = std::min(tree[at * 2], tree[at * 2 + 1]);
        }
    }
    uint64_t part(unsigned a, unsigned b) const {
        uint64_t best = UINT64_MAX;
        for (a += span, b += span; a < b; a >>= 1, b >>= 1) {
            if (a & 1) best = std::min(best, tree[a++]);
            if (b & 1) best = std::min(best, tree[--b]);
        }
        return best;
    }
    uint64_t get(size_t first, size_t last) const {
        unsigned a = unsigned(first) & (span - 1);
        unsigned b = unsigned(last) & (span - 1);
        return a <= b ? part(a, b + 1) :
               std::min(part(a, span), part(0, b + 1));
    }
};

Writer encode2(const uint8_t *src, size_t src_size, const Matches &matches) {
    std::vector<Match> choice(src_size);
    std::vector<uint64_t> cost(src_size + 1);
    cost[src_size] = 12;
    SuffixMin suffix;
    suffix.set(src_size, 12); // end token
    for (size_t i = src_size; i-- > 0;) {
        uint64_t best = 9 + cost[i + 1];
        choice[i] = {1, 0};
        for (unsigned n = 12; n <= 72 && n <= src_size - i; n += 4) {
            uint64_t bits = 9 + 8 * n + cost[i + n];
            if (bits < best) { best = bits; choice[i] = {uint16_t(n), 0}; }
        }
        if (matches.pairs[i] && 11 + cost[i + 2] < best) {
            best = 11 + cost[i + 2];
            choice[i] = {2, matches.pairs[i]};
        }
        for (size_t j = matches.first[i]; j < matches.first[i + 1]; j++) {
            Match m = matches.values[j];
            if (m.distance > 4096) break;
            unsigned dbits = distance_bits(m.distance);
            for (unsigned n = 3; n <= 8 && n <= m.length; n++) {
                unsigned bits = n == 3 ? 4 + dbits :
                                n < 6 ? 4 + dbits : 5 + dbits;
                uint64_t total = bits + cost[i + n];
                if (total < best) { best = total; choice[i] = {uint16_t(n), m.distance}; }
            }
            if (m.length >= 9) {
                uint64_t next = suffix.get(i + 9, i + m.length);
                uint64_t total = 12 + dbits + (next >> 9);
                if (total < best) {
                    unsigned first = unsigned(i + 9) & 511;
                    unsigned n = 9 + ((unsigned(next) - first) & 511);
                    best = total;
                    choice[i] = {uint16_t(n), m.distance};
                }
            }
        }
        cost[i] = best;
        suffix.set(i, best);
    }
    Writer w;
    for (size_t i = 0; i < src_size;) {
        Match m = choice[i];
        if (!m.distance) {
            if (m.length > 1) {
                unsigned count = m.length;
                w.put(5, 0x1d); // 1,0,1,1,1: method-2 raw run
                w.put(4, (count - 12) / 4);
                for (unsigned j = 0; j < count; j++) w.put(8, src[i + j]);
                i += count;
            } else {
                w.put(1, 0);
                w.put(8, src[i++]);
            }
            continue;
        }
        unsigned n = m.length;
        if (n == 2) {
            w.put(3, 3); // 1,1,0
            w.put(8, m.distance - 1);
        } else if (n == 3) {
            w.put(4, 7); // 1,1,1,0
            put_distance(w, m.distance);
        } else if (n <= 5) {
            w.put(2, 1); w.put(1, n - 4); w.put(1, 0);
            put_distance(w, m.distance);
        } else if (n <= 8) {
            w.put(2, 1); w.put(1, n >= 8); w.put(1, 1);
            w.put(1, (n - 6) & 1);
            put_distance(w, m.distance);
        } else {
            w.put(4, 15); w.put(8, n - 8);
            put_distance(w, m.distance);
        }
        i += n;
    }
    w.put(4, 15); w.put(8, 0); // end marker
    if (w.count) w.flush();
    return w;
}

unsigned length_symbol(unsigned length) {
    unsigned s = 28;
    while (length < length_base[s] + 3) s--;
    return s;
}

unsigned distance_symbol(unsigned distance) {
    unsigned s = 29;
    while (distance <= distance_base[s]) s--;
    return s;
}

template<size_t N> struct Codes {
    std::array<unsigned, N> length{};
    std::array<unsigned, N> word{};
};

// Canonical Huffman codes, limited to the format's fifteen-bit maximum.
template<size_t N> Codes<N> make_codes(const std::array<unsigned, N> &frequency, bool smooth) {
    struct Node { uint64_t weight; int parent; };
    std::array<Node, N * 2> nodes{};
    std::array<unsigned, N * 2> heap{};
    std::array<unsigned, N> order{};
    unsigned used = unsigned(N), count = 0, leaves = 0;
    for (unsigned i = 0; i < N; i++) {
        nodes[i] = {frequency[i], -1};
        if (frequency[i]) { heap[count++] = i; order[leaves++] = i; }
    }
    Codes<N> codes;
    if (!leaves) { codes.length[0] = 1; return codes; }
    if (leaves == 1) { codes.length[order[0]] = 1; return codes; }
    auto greater = [&](unsigned a, unsigned b) {
        return nodes[a].weight != nodes[b].weight ? nodes[a].weight > nodes[b].weight : a > b;
    };
    std::make_heap(heap.begin(), heap.begin() + count, greater);
    while (count > 1) {
        std::pop_heap(heap.begin(), heap.begin() + count, greater);
        unsigned a = heap[--count];
        std::pop_heap(heap.begin(), heap.begin() + count, greater);
        unsigned b = heap[--count];
        nodes[a].parent = nodes[b].parent = int(used);
        nodes[used] = {nodes[a].weight + nodes[b].weight, -1};
        heap[count++] = used++;
        std::push_heap(heap.begin(), heap.begin() + count, greater);
    }
    unsigned counts[16] = {}, kraft = 0;
    for (unsigned i = 0; i < leaves; i++) {
        unsigned depth = 0;
        for (unsigned p = order[i]; nodes[p].parent >= 0; p = unsigned(nodes[p].parent)) depth++;
        counts[std::min(depth, 15u)]++;
    }
    for (unsigned bits = 1; bits <= 15; bits++) kraft += counts[bits] << (15 - bits);
    while (kraft > 32768) {
        unsigned bits = 14;
        while (!counts[bits]) bits--;
        counts[bits]--; counts[bits + 1] += 2; counts[15]--; kraft--;
    }
    std::sort(order.begin(), order.begin() + leaves, [&](unsigned a, unsigned b) {
        return frequency[a] != frequency[b] ? frequency[a] < frequency[b] : a > b;
    });
    unsigned at = 0;
    for (unsigned bits = 15; bits; bits--)
        for (unsigned j = 0; j < counts[bits]; j++) codes.length[order[at++]] = bits;
    if (smooth) {
        // Permuting depths preserves the tree. A few extra token bits can be
        // worthwhile when they remove four-bit length changes in its header.
        unsigned end = unsigned(N);
        while (end && !codes.length[end - 1]) end--;
        auto edge = [&](unsigned i) {
            return i < end && codes.length[i] != (i ? codes.length[i - 1] : 0);
        };
        for (unsigned pass = 0; pass < 3; pass++) {
            bool changed = false;
            for (unsigned a = 0; a < end; a++) if (frequency[a])
                for (unsigned b = a + 1; b < end; b++) if (frequency[b]) {
                    int64_t delta = (int64_t(frequency[a]) - frequency[b]) *
                                    (int64_t(codes.length[b]) - codes.length[a]);
                    if (codes.length[a] == codes.length[b] || delta >= 16) continue;
                    int before = edge(a) + edge(a + 1) + edge(b + 1) + (b != a + 1 ? edge(b) : 0);
                    std::swap(codes.length[a], codes.length[b]);
                    int after = edge(a) + edge(a + 1) + edge(b + 1) + (b != a + 1 ? edge(b) : 0);
                    if (delta + 4 * (after - before) < 0) changed = true;
                    else std::swap(codes.length[a], codes.length[b]);
                }
            if (!changed) break;
        }
    }
    unsigned next[16] = {}, code = 0;
    for (unsigned bits = 1; bits <= 15; bits++) {
        code = (code + counts[bits - 1]) * 2;
        next[bits] = code;
    }
    for (unsigned i = 0; i < N; i++) if (codes.length[i]) {
        unsigned v = next[codes.length[i]]++, reversed = 0;
        for (unsigned j = 0; j < codes.length[i]; j++) { reversed = reversed * 2 + (v & 1); v >>= 1; }
        codes.word[i] = reversed;
    }
    return codes;
}

struct Tables {
    Codes<286> lit;
    Codes<30> dist;
};

Tables tables_for(const uint8_t *src, size_t begin, const std::vector<Match> &tokens, bool smooth = false) {
    std::array<unsigned, 286> lit{};
    std::array<unsigned, 30> dist{};
    lit[256] = 1;
    for (Match m : tokens) {
        if (m.distance) {
            lit[257 + length_symbol(m.length)]++;
            dist[distance_symbol(m.distance)]++;
        } else lit[src[begin]]++;
        begin += m.length;
    }
    return {make_codes(lit, smooth), make_codes(dist, smooth)};
}

template<class Sink, size_t N> void put_table(Sink &w, const Codes<N> &codes, unsigned &last) {
    unsigned count = unsigned(N);
    while (count > 1 && !codes.length[count - 1]) count--;
    w.put(9, count);
    for (unsigned i = 0; i < count; i++) {
        w.put(1, codes.length[i] != last);
        if (codes.length[i] != last) { last = codes.length[i]; w.put(4, last); }
    }
}

template<class Sink> void put_block(Sink &w, const uint8_t *src, size_t begin,
                                    const std::vector<Match> &tokens, const Tables &tables, unsigned &last) {
    w.put(1, 1);
    put_table(w, tables.lit, last);
    put_table(w, tables.dist, last);
    for (Match m : tokens) {
        if (!m.distance) {
            unsigned s = src[begin];
            w.put(tables.lit.length[s], tables.lit.word[s]);
        } else {
            unsigned l = length_symbol(m.length), d = distance_symbol(m.distance);
            w.put(tables.lit.length[257 + l], tables.lit.word[257 + l]);
            w.put(length_extra[l], m.length - 3 - length_base[l]);
            w.put(tables.dist.length[d], tables.dist.word[d]);
            w.put(distance_extra[d], m.distance - 1 - distance_base[d]);
        }
        begin += m.length;
    }
    w.put(tables.lit.length[256], tables.lit.word[256]);
}

size_t block_bits(const uint8_t *src, size_t begin, const std::vector<Match> &tokens,
                  const Tables &tables) {
    struct Counter {
        size_t bits = 0;
        void put(unsigned count, unsigned) { bits += count; }
    } counter;
    unsigned last = 0;
    put_block(counter, src, begin, tokens, tables, last);
    return counter.bits;
}

std::vector<Match> parse1(const uint8_t *src, size_t begin, size_t end,
                          const Matches &matches, const Tables &tables) {
    std::vector<Match> choice(end - begin);
    SuffixMin suffix;
    suffix.set(end, tables.lit.length[256]);
    uint64_t next_cost = tables.lit.length[256];
    for (size_t i = end; i-- > begin;) {
        unsigned literal = tables.lit.length[src[i]];
        uint64_t best = (literal ? literal : 12) + next_cost;
        Match pick{1, 0};
        unsigned cheapest = UINT32_MAX, distance = 0;
        for (size_t j = matches.first[i + 1]; j-- > matches.first[i];) {
            Match m = matches.values[j];
            unsigned high = unsigned(std::min<size_t>({m.length, 258, end - i}));
            unsigned low = j == matches.first[i] ? 3 : matches.values[j - 1].length + 1;
            unsigned d = distance_symbol(m.distance);
            unsigned dbits = (tables.dist.length[d] ? tables.dist.length[d] : 10) + distance_extra[d];
            if (dbits < cheapest) { cheapest = dbits; distance = m.distance; }
            if (low > high) continue;
            for (unsigned l = length_symbol(low); l < 29; l++) {
                unsigned a = std::max(low, length_base[l] + 3);
                unsigned b = std::min(high, l == 28 ? 258u : length_base[l + 1] + 2);
                if (a > b) break;
                uint64_t result = suffix.get(i + a, i + b);
                unsigned lbits = tables.lit.length[257 + l];
                uint64_t total = (result >> 9) + cheapest + (lbits ? lbits : 12) + length_extra[l];
                if (total < best) {
                    unsigned n = a + ((unsigned(result) - unsigned(i + a)) & 511);
                    best = total; pick = {uint16_t(n), uint16_t(distance)};
                }
            }
        }
        choice[i - begin] = pick;
        next_cost = best;
        suffix.set(i, best);
    }
    std::vector<Match> tokens;
    for (size_t i = begin; i < end;) {
        Match m = choice[i - begin];
        tokens.push_back(m); i += m.length;
    }
    return tokens;
}

struct Block {
    std::vector<Match> tokens;
    Tables tables;
    size_t bits = SIZE_MAX;
};

Block optimize_block(const uint8_t *src, size_t begin, size_t end, const Matches &matches) {
    std::vector<Match> tokens;
    for (size_t i = begin; i < end;) {
        Match m{1, 0};
        if (matches.first[i] != matches.first[i + 1]) {
            m = matches.values[matches.first[i + 1] - 1];
            m.length = uint16_t(std::min<size_t>({m.length, 258, end - i}));
            if (m.length < 3) m = {1, 0};
        }
        tokens.push_back(m); i += m.length;
    }
    Block best;
    Tables model;
    for (unsigned pass = 0; pass < 6; pass++) {
        Tables tables = tables_for(src, begin, tokens);
        size_t bits = block_bits(src, begin, tokens, tables);
        if (bits < best.bits) best = {tokens, tables, bits};
        Tables smooth = tables_for(src, begin, tokens, true);
        bits = block_bits(src, begin, tokens, smooth);
        if (bits < best.bits) best = {tokens, smooth, bits};
        // Repeated data already has a cheap greedy representation. Avoid work
        // proportional to decoded size when almost no coded data is required.
        if (best.bits < (end - begin) / 8) break;
        if (pass && tables.lit.length == model.lit.length && tables.dist.length == model.dist.length) break;
        model = tables;
        tokens = parse1(src, begin, end, matches, model);
    }
    return best;
}

Writer encode1(const uint8_t *src, size_t size, const Matches &matches, size_t block_size) {
    Writer w;
    unsigned last = 0;
    for (size_t begin = 0; begin < size;) {
        size_t end = begin + std::min(size - begin, block_size);
        Block block = optimize_block(src, begin, end, matches);
        put_block(w, src, begin, block.tokens, block.tables, last);
        w.put(1, end == size);
        begin = end;
    }
    if (w.count) w.flush();
    return w;
}

} // namespace

int edl_encode(const uint8_t *src, size_t src_size, uint8_t *dst,
               size_t dst_cap, size_t *written) try {
    if (!src || !dst || !written || src_size > INT32_MAX || dst_cap < 12) return -1;
    Matches matches(src, src_size);
    Writer best = encode2(src, src_size, matches);
    unsigned method = 2;
    if (best.bytes.size() > 36) {
        Writer huffman = encode1(src, src_size, matches, src_size);
        if (huffman.bytes.size() < best.bytes.size()) { best = std::move(huffman); method = 1; }
        if (src_size > 16384) {
            huffman = encode1(src, src_size, matches, 16384);
            if (huffman.bytes.size() < best.bytes.size()) { best = std::move(huffman); method = 1; }
        }
        if (src_size > 4096) {
            huffman = encode1(src, src_size, matches, 4096);
            if (huffman.bytes.size() < best.bytes.size()) { best = std::move(huffman); method = 1; }
        }
    }
    if (src_size < best.bytes.size()) method = 0;
    size_t payload = method ? best.bytes.size() : src_size;
    if (payload > UINT32_MAX - 12 || payload > dst_cap - 12) return -1;
    if (method) std::memcpy(dst + 12, best.bytes.data(), payload);
    else std::memmove(dst + 12, src, payload);
    std::memcpy(dst, "EDL", 3);
    dst[3] = uint8_t(0x80 | method);
    put32(dst + 4, uint32_t(12 + payload));
    put32(dst + 8, uint32_t(src_size));
    *written = 12 + payload;
    return 0;
} catch (const std::bad_alloc &) {
    return -1;
}
