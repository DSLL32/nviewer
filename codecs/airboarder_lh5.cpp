/* Air Boarder 64's BE-size-prefixed, headerless LH5-family stream.
 * Both functions return 0 on success, -1 on error.
 */
#include <algorithm>
#include <array>
#include <new>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <vector>
#include "common/hash_chain.hpp"

static constexpr unsigned MATCH_DEPTH = 512;
static constexpr size_t BLOCK_BYTES = 16384;
static constexpr unsigned PARSE_PASSES = 6;

#define BE32(p) ((uint32_t)(p)[0] << 24 | (uint32_t)(p)[1] << 16 | (uint32_t)(p)[2] << 8 | (p)[3])
#define PUT32(p, n) do { \
    (p)[0] = (uint8_t)((n) >> 24); (p)[1] = (uint8_t)((n) >> 16); \
    (p)[2] = (uint8_t)((n) >> 8); (p)[3] = (uint8_t)(n); \
} while (0)

typedef struct { const uint8_t *data; size_t size, bit; } Reader;
typedef struct { uint8_t *data; size_t size, bit; } Writer;
typedef struct { int child[2], symbol; } Node;
typedef struct { Node nodes[1023]; int used, constant; } Huffman;

static int bits(Reader *r, unsigned n, unsigned *value) {
    if (n > 24 || r->bit / 8 > r->size ||
        n > (r->size - r->bit / 8) * 8 - r->bit % 8) return -1;
    unsigned v = 0;
    while (n--) {
        v = (v << 1) | ((r->data[r->bit / 8] >> (7 - r->bit % 8)) & 1u);
        r->bit++;
    }
    *value = v;
    return 0;
}

static int put(Writer *w, unsigned n, unsigned value) {
    if (w->bit / 8 > w->size || n > (w->size - w->bit / 8) * 8 - w->bit % 8)
        return -1;
    while (n--) {
        if (!(w->bit % 8)) w->data[w->bit / 8] = 0;
        if (value & (1u << n)) w->data[w->bit / 8] |= 0x80u >> (w->bit % 8);
        w->bit++;
    }
    return 0;
}

static int new_node(Huffman *h) {
    if (h->used == 1023) return -1;
    int i = h->used++;
    h->nodes[i].child[0] = h->nodes[i].child[1] = -1;
    h->nodes[i].symbol = -1;
    return i;
}

static int build(Huffman *h, const uint8_t *lengths, unsigned count) {
    unsigned frequencies[17] = {0}, next[17] = {0};
    for (unsigned i = 0; i < count; i++) {
        if (lengths[i] > 16) return -1;
        if (lengths[i]) frequencies[lengths[i]]++;
    }
    unsigned code = 0;
    for (unsigned n = 1; n <= 16; n++) {
        code = (code + frequencies[n - 1]) * 2;
        next[n] = code;
        if (code + frequencies[n] > (1u << n)) return -1;
    }
    h->used = 0; h->constant = -1;
    if (new_node(h) < 0) return -1;
    for (unsigned s = 0; s < count; s++) {
        unsigned n = lengths[s];
        if (!n) continue;
        unsigned word = next[n]++;
        int node = 0;
        while (n--) {
            unsigned bit = (word >> n) & 1u;
            int child = h->nodes[node].child[bit];
            if (child < 0) {
                child = new_node(h);
                if (child < 0) return -1;
                h->nodes[node].child[bit] = child;
            }
            node = child;
        }
        if (h->nodes[node].symbol >= 0) return -1;
        h->nodes[node].symbol = (int)s;
    }
    return 0;
}

static int symbol(Reader *r, const Huffman *h, unsigned *value) {
    if (h->constant >= 0) { *value = (unsigned)h->constant; return 0; }
    int node = 0;
    for (unsigned depth = 0; depth < 16; depth++) {
        unsigned bit;
        if (bits(r, 1, &bit)) return -1;
        node = h->nodes[node].child[bit];
        if (node < 0) return -1;
        if (h->nodes[node].symbol >= 0) {
            *value = (unsigned)h->nodes[node].symbol;
            return 0;
        }
    }
    return -1;
}

static int pt_tree(Reader *r, Huffman *h, unsigned count,
                   unsigned count_bits, int special) {
    unsigned used;
    if (bits(r, count_bits, &used) || used > count) return -1;
    if (!used) {
        unsigned constant;
        if (bits(r, count_bits, &constant) || constant >= count) return -1;
        h->constant = (int)constant;
        return 0;
    }
    uint8_t lengths[19] = {0};
    unsigned at = 0;
    while (at < used) {
        unsigned n;
        if (bits(r, 3, &n)) return -1;
        if (n == 7) {
            unsigned more;
            do {
                if (bits(r, 1, &more)) return -1;
                n += more;
            } while (more && n <= 16);
        }
        if (at == count || n > 16) return -1;
        lengths[at++] = (uint8_t)n;
        if ((int)at == special) {
            unsigned zeros;
            if (bits(r, 2, &zeros) || zeros > count - at) return -1;
            at += zeros;
        }
    }
    return build(h, lengths, count);
}

static int char_tree(Reader *r, Huffman *h, const Huffman *pt) {
    unsigned used;
    if (bits(r, 9, &used) || used > 509) return -1;
    if (!used) {
        unsigned constant;
        if (bits(r, 9, &constant) || constant >= 509) return -1;
        h->constant = (int)constant;
        return 0;
    }
    uint8_t lengths[509] = {0};
    unsigned at = 0;
    while (at < used) {
        unsigned code;
        if (symbol(r, pt, &code)) return -1;
        if (code >= 3) {
            if (at == 509) return -1;
            lengths[at++] = (uint8_t)(code - 2);
        } else {
            unsigned zeros = 1, extra;
            if (code == 1) {
                if (bits(r, 4, &extra)) return -1;
                zeros = extra + 3;
            } else if (code == 2) {
                if (bits(r, 9, &extra)) return -1;
                zeros = extra + 20;
            }
            if (zeros > 509 - at) return -1;
            at += zeros;
        }
    }
    return build(h, lengths, 509);
}

extern "C" int airboarder_lh5_decode(const uint8_t *src, size_t size, uint8_t *dst,
                          size_t cap, size_t *written) {
    if (!src || !dst || !written || size < 4) return -1;
    size_t out_size = BE32(src);
    if (!out_size || out_size > cap) return -1;
    Reader r = {src + 4, size - 4, 0};
    uint8_t ring[8192]; memset(ring, 0x20, sizeof ring);
    size_t out = 0, ring_at = 0;
    unsigned left = 0;
    Huffman pt, chars, positions;
    while (out < out_size) {
        if (!left) {
            if (bits(&r, 16, &left) || !left ||
                pt_tree(&r, &pt, 19, 5, 3) || char_tree(&r, &chars, &pt) ||
                pt_tree(&r, &positions, 14, 4, -1)) return -1;
        }
        left--;
        unsigned value;
        if (symbol(&r, &chars, &value)) return -1;
        if (value < 256) {
            dst[out++] = (uint8_t)value;
            ring[ring_at++ & 8191] = (uint8_t)value;
        } else {
            unsigned slot, extra = 0;
            if (symbol(&r, &positions, &slot) || slot > 13) return -1;
            if (slot && bits(&r, slot - 1, &extra)) return -1;
            size_t distance = slot ? (1u << (slot - 1)) + extra : 0;
            size_t source = (ring_at - distance - 1) & 8191;
            size_t length = value - 253;
            while (length-- && out < out_size) {
                uint8_t byte = ring[source++ & 8191];
                dst[out++] = byte;
                ring[ring_at++ & 8191] = byte;
            }
        }
    }
    *written = out;
    return 0;
}

struct Token { uint16_t symbol, slot, extra; };
struct Code { uint8_t bits; uint16_t word; };
struct Run { uint8_t symbol; uint16_t extra; };
struct Match { uint16_t length, distance; };
struct MatchSet { std::array<Match, 14> slots; };

static unsigned slot_for(size_t distance) {
    unsigned d = (unsigned)distance - 1, slot = 0;
    while ((1u << slot) <= d) slot++;
    return slot;
}

struct LhHash3 {
    static constexpr size_t width = 3, buckets = 4096;
    unsigned operator()(const uint8_t *p) const {
        return (p[0] * 251u + p[1] * 31u + p[2]) & 4095u;
    }
};

class MatchCandidates {
    HashChain<LhHash3, size_t, 8192> index_;
public:
    MatchSet find(const uint8_t *src, size_t end, size_t at) const {
        MatchSet result{};
        if (end - at < 3) return result;
        unsigned max_length = (unsigned)std::min<size_t>(255, end - at);
        unsigned best_length = 0;
        bool near_full = false;
        size_t previous = index_.first(src, at);
        for (unsigned n = 0; n < MATCH_DEPTH &&
             previous != index_.absent && at - previous <= 8192; n++) {
            unsigned slot = slot_for(at - previous);
            if (result.slots[slot].length < max_length) {
                unsigned length = 0;
                while (length < 255 && at + length < end &&
                   src[previous + length] == src[at + length]) length++;
                if (length >= 3 && length > result.slots[slot].length)
                    result.slots[slot] = {(uint16_t)length, (uint16_t)(at - previous)};
                best_length = std::max(best_length, length);
                if (length == max_length && max_length >= 32)
                    near_full = true;
            }
            if (near_full && n >= 15) break;
            if (best_length >= 32 && n >= 127) break;
            previous = index_.previous(previous);
        }
        return result;
    }
    void advance(const uint8_t *src, size_t size, size_t at) {
        if (size - at < 3) return;
        index_.insert(src, at);
    }
};

static Match longest(const MatchSet &set) {
    Match best{0, 0};
    for (const Match &match : set.slots)
        if (match.length > best.length) best = match;
    return best;
}

static void add_token(std::vector<Token> &tokens, const uint8_t *src,
                      size_t at, unsigned length, unsigned distance) {
    if (length < 3) { tokens.push_back({src[at], 0, 0}); return; }
    unsigned slot = slot_for(distance), d = distance - 1;
    tokens.push_back({(uint16_t)(length + 253), (uint16_t)slot,
                      (uint16_t)(slot ? d - (1u << (slot - 1)) : 0)});
}

/* Build length-limited canonical Huffman codes. Overlong leaves are clamped
 * and then their excess Kraft weight is redistributed at the deepest levels. */
template<size_t N> static void make_codes(const std::array<unsigned, N> &freq,
                                            std::array<Code, N> &codes) {
    struct Entry { unsigned weight; int parent, symbol; };
    std::array<Entry, 2 * N> entries{};
    std::array<int, 2 * N> heap{};
    std::array<int, N> leaves{};
    size_t used = 0, heap_size = 0;
    codes.fill({0, 0});
    for (size_t i = 0; i < N; i++) if (freq[i]) {
        leaves[i] = (int)used;
        entries[used] = {freq[i], -1, (int)i};
        heap[heap_size++] = (int)used++;
    }
    if (heap_size <= 1) return;
    auto greater = [&entries](int a, int b) {
        if (entries[a].weight != entries[b].weight)
            return entries[a].weight > entries[b].weight;
        return entries[a].symbol > entries[b].symbol;
    };
    std::make_heap(heap.begin(), heap.begin() + heap_size, greater);
    while (heap_size > 1) {
        std::pop_heap(heap.begin(), heap.begin() + heap_size, greater);
        int a = heap[--heap_size];
        std::pop_heap(heap.begin(), heap.begin() + heap_size, greater);
        int b = heap[--heap_size];
        entries[a].parent = entries[b].parent = (int)used;
        entries[used] = {entries[a].weight + entries[b].weight, -1,
                         std::min(entries[a].symbol, entries[b].symbol)};
        heap[heap_size++] = (int)used++;
        std::push_heap(heap.begin(), heap.begin() + heap_size, greater);
    }
    unsigned counts[17] = {0};
    std::vector<int> symbols;
    for (size_t i = 0; i < N; i++) if (freq[i]) {
        unsigned depth = 0;
        for (int node = leaves[i]; entries[node].parent >= 0;
             node = entries[node].parent) depth++;
        if (depth > 16) depth = 16;
        counts[depth]++;
        symbols.push_back((int)i);
    }
    unsigned kraft = 0;
    for (unsigned bits = 1; bits <= 16; bits++)
        kraft += counts[bits] << (16 - bits);
    while (kraft > 65536) {
        int bits = 15;
        while (!counts[bits]) bits--;
        counts[bits]--;
        counts[bits + 1] += 2;
        counts[16]--;
        kraft--;
    }
    std::sort(symbols.begin(), symbols.end(), [&freq](int a, int b) {
        return freq[a] != freq[b] ? freq[a] < freq[b] : a > b;
    });
    size_t at = 0;
    for (int bits = 16; bits >= 1; bits--)
        for (unsigned i = 0; i < counts[bits]; i++)
            codes[symbols[at++]].bits = (uint8_t)bits;
    unsigned next[17] = {0}, word = 0;
    for (unsigned bits = 1; bits <= 16; bits++) {
        word = (word + counts[bits - 1]) * 2;
        next[bits] = word;
    }
    for (size_t i = 0; i < N; i++) if (codes[i].bits)
        codes[i].word = (uint16_t)next[codes[i].bits]++;
}

static void refine_parse(const uint8_t *src, size_t begin,
                         const std::vector<MatchSet> &matches,
                         std::vector<Token> &tokens) {
    std::array<unsigned, 509> char_freq{};
    std::array<unsigned, 14> pos_freq{};
    for (const Token &token : tokens) {
        char_freq[token.symbol]++;
        if (token.symbol >= 256) pos_freq[token.slot]++;
    }
    std::array<Code, 509> chars{};
    std::array<Code, 14> positions{};
    make_codes(char_freq, chars);
    make_codes(pos_freq, positions);
    const size_t size = matches.size();
    std::vector<unsigned> cost(size + 1);
    std::vector<uint16_t> choice(size);
    std::vector<uint16_t> choice_distance(size);
    for (size_t i = size; i-- > 0;) {
        unsigned literal = chars[src[begin + i]].bits;
        unsigned best = (literal ? literal : 12) + cost[i + 1];
        unsigned selected = 1;
        unsigned selected_distance = 0, max_length = 0;
        unsigned base_by_length[256];
        uint16_t distance_by_length[256];
        std::fill(base_by_length, base_by_length + 256, UINT32_MAX);
        for (unsigned slot = 0; slot < 14; slot++) {
            const Match &match = matches[i].slots[slot];
            if (match.length < 3) continue;
            max_length = std::max(max_length, (unsigned)match.length);
            unsigned position = positions[slot].bits;
            unsigned base = (position ? position : 5) + (slot ? slot - 1 : 0);
            if (base < base_by_length[match.length]) {
                base_by_length[match.length] = base;
                distance_by_length[match.length] = match.distance;
            }
        }
        if (max_length) {
            for (unsigned length = max_length; length > 3; length--) {
                if (base_by_length[length] < base_by_length[length - 1]) {
                    base_by_length[length - 1] = base_by_length[length];
                    distance_by_length[length - 1] = distance_by_length[length];
                }
            }
            for (unsigned length = 3; length <= max_length; length++) {
                unsigned character = chars[length + 253].bits;
                unsigned trial = (character ? character : 12) +
                                 base_by_length[length] + cost[i + length];
                if (trial < best) {
                    best = trial; selected = length;
                    selected_distance = distance_by_length[length];
                }
            }
        }
        cost[i] = best;
        choice[i] = (uint16_t)selected;
        choice_distance[i] = (uint16_t)selected_distance;
    }
    tokens.clear();
    for (size_t i = 0; i < size;) {
        add_token(tokens, src, begin + i, choice[i], choice_distance[i]);
        i += choice[i];
    }
}

template<size_t N> static int emit_pt(Writer *w, const std::array<Code, N> &codes,
                                       unsigned count_bits, int special) {
    unsigned used = 0, one = 0, symbols = 0;
    for (unsigned i = 0; i < N; i++) if (codes[i].bits) {
        used = i + 1; one = i; symbols++;
    }
    if (symbols == 1) return put(w, count_bits, 0) || put(w, count_bits, one);
    if (put(w, count_bits, used)) return -1;
    for (unsigned i = 0; i < used; i++) {
        unsigned bits = codes[i].bits;
        if (bits < 7) { if (put(w, 3, bits)) return -1; }
        else {
            if (put(w, 3, 7)) return -1;
            for (unsigned j = 7; j < bits; j++) if (put(w, 1, 1)) return -1;
            if (put(w, 1, 0)) return -1;
        }
        if ((int)i + 1 == special) {
            unsigned zeros = 0;
            while (i + 1 + zeros < used && zeros < 3 &&
                   !codes[i + 1 + zeros].bits) zeros++;
            if (put(w, 2, zeros)) return -1;
            i += zeros;
        }
    }
    return 0;
}

static void length_runs(const std::array<Code, 509> &chars,
                        std::vector<Run> &runs, unsigned &used) {
    used = 0;
    for (unsigned i = 0; i < 509; i++) if (chars[i].bits) used = i + 1;
    for (unsigned i = 0; i < used;) {
        if (chars[i].bits) {
            runs.push_back({(uint8_t)(chars[i++].bits + 2), 0});
            continue;
        }
        unsigned end = i + 1;
        while (end < used && !chars[end].bits) end++;
        unsigned n = end - i;
        while (n) {
            if (n >= 20) {
                unsigned take = std::min(n, 531u);
                runs.push_back({2, (uint16_t)(take - 20)});
                n -= take;
            } else if (n >= 3) {
                unsigned take = std::min(n, 18u);
                runs.push_back({1, (uint16_t)(take - 3)});
                n -= take;
            } else { runs.push_back({0, 0}); n--; }
        }
        i = end;
    }
}

static int emit_block(Writer *w, const std::vector<Token> &tokens) {
    std::array<unsigned, 509> char_freq{};
    std::array<unsigned, 14> pos_freq{};
    for (const Token &t : tokens) {
        char_freq[t.symbol]++;
        if (t.symbol >= 256) pos_freq[t.slot]++;
    }
    std::array<Code, 509> chars{};
    std::array<Code, 14> positions{};
    make_codes(char_freq, chars);
    make_codes(pos_freq, positions);
    unsigned char_constant = 0, char_symbols = 0;
    for (unsigned i = 0; i < 509; i++) if (char_freq[i]) {
        char_constant = i; char_symbols++;
    }
    if (put(w, 16, (unsigned)tokens.size())) return -1;
    if (char_symbols == 1) {
        if (put(w, 5, 0) || put(w, 5, 0) ||
            put(w, 9, 0) || put(w, 9, char_constant)) return -1;
    } else {
        std::vector<Run> runs;
        unsigned used;
        length_runs(chars, runs, used);
        std::array<unsigned, 19> pt_freq{};
        for (const Run &run : runs) pt_freq[run.symbol]++;
        std::array<Code, 19> pt{};
        make_codes(pt_freq, pt);
        unsigned pt_symbols = 0, pt_constant = 0;
        for (unsigned i = 0; i < 19; i++) if (pt_freq[i]) {
            pt_symbols++; pt_constant = i;
        }
        if (pt_symbols == 1) {
            if (put(w, 5, 0) || put(w, 5, pt_constant)) return -1;
        } else if (emit_pt(w, pt, 5, 3)) return -1;
        if (put(w, 9, used)) return -1;
        for (const Run &run : runs) {
            if (pt_symbols > 1 && put(w, pt[run.symbol].bits, pt[run.symbol].word)) return -1;
            if (run.symbol == 1 && put(w, 4, run.extra)) return -1;
            if (run.symbol == 2 && put(w, 9, run.extra)) return -1;
        }
    }
    unsigned pos_symbols = 0, pos_constant = 0;
    for (unsigned i = 0; i < 14; i++) if (pos_freq[i]) {
        pos_symbols++; pos_constant = i;
    }
    if (pos_symbols <= 1) {
        if (put(w, 4, 0) || put(w, 4, pos_constant)) return -1;
    } else if (emit_pt(w, positions, 4, -1)) return -1;
    for (const Token &t : tokens) {
        if (char_symbols > 1 && put(w, chars[t.symbol].bits, chars[t.symbol].word)) return -1;
        if (t.symbol >= 256) {
            if (pos_symbols > 1 && put(w, positions[t.slot].bits, positions[t.slot].word)) return -1;
            if (t.slot && put(w, t.slot - 1, t.extra)) return -1;
        }
    }
    return 0;
}

extern "C" int airboarder_lh5_encode(const uint8_t *src, size_t size, uint8_t *dst,
                                      size_t cap, size_t *written) {
    if (!src || !dst || !written || !size || size > UINT32_MAX || cap < 4) return -1;
    try {
        PUT32(dst, size);
        Writer w = {dst + 4, cap - 4, 0};
        MatchCandidates finder;
        for (size_t begin = 0; begin < size;) {
            size_t end = std::min(size, begin + BLOCK_BYTES);
            std::vector<MatchSet> matches(end - begin);
            for (size_t at = begin; at < end; at++) {
                matches[at - begin] = finder.find(src, end, at);
                finder.advance(src, size, at);
            }
            std::vector<Token> tokens;
            for (size_t i = 0; i < matches.size();) {
                Match match = longest(matches[i]);
                unsigned length = match.length;
                if (length && i + 1 < matches.size() &&
                    longest(matches[i + 1]).length >= length + 1)
                    length = 0;
                add_token(tokens, src, begin + i, length, match.distance);
                i += length ? length : 1;
            }
            // Highly redundant blocks need little reweighting and can have
            // very small outputs relative to their decoded work.
            unsigned passes = tokens.size() * 8 < matches.size() ? 1 : PARSE_PASSES;
            for (unsigned pass = 0; pass < passes; pass++)
                refine_parse(src, begin, matches, tokens);
            if (emit_block(&w, tokens)) return -1;
            begin = end;
        }
        *written = 4 + (w.bit + 7) / 8;
        return 0;
    } catch (const std::bad_alloc &) {
        return -1;
    }
}
