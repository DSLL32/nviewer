/* A Bug's Life RNC ProPack methods 1 and 2. CRC-checked reference codecs.
 * Method 1 iterates a Huffman-cost parse; method 2 uses exact token costs.
 * Streams with the encrypted or locked flags set are not supported.
 */
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <algorithm>
#include <array>
#include <new>
#include <stdexcept>
#include <utility>
#include <vector>

namespace {

constexpr unsigned absent = UINT32_MAX;

static unsigned category(unsigned value) {
    unsigned result = 0;
    while (value) { result++; value >>= 1; }
    return result;
}

struct Match { uint16_t length = 0, distance = 0; };
using Matches = std::array<Match, 16>;

// Two-byte chains also find the short matches allowed by both methods. Keep
// the longest match in each distance category, since its shorter prefixes
// have the same distance cost. History continues across method-1 blocks.
struct MatchIndex {
    const uint8_t *src;
    std::vector<uint32_t> previous;

    MatchIndex(const uint8_t *data, size_t size) : src(data), previous(size, absent) {
        std::array<uint32_t, 65536> head;
        head.fill(absent);
        for (size_t i = 0; size - i >= 2; i++) {
            unsigned key = unsigned(src[i]) << 8 | src[i + 1];
            previous[i] = head[key]; head[key] = uint32_t(i);
        }
    }

    std::vector<Matches> find(size_t start, unsigned size, unsigned window,
                              unsigned max_length, unsigned depth) const {
        std::vector<Matches> result(size);
        // If a match at distance d covered [a,b), every later position inside
        // that interval already matches through b. Cache that proven prefix
        // for each distance to avoid re-comparing long, overlapping matches.
        std::vector<uint32_t> matched_until(window);
        for (unsigned p = 0; p + 1 < size; p++) {
            size_t at = start + p;
            unsigned limit = std::min(max_length, size - p);
            unsigned visited = 0;
            for (uint32_t candidate = previous[at]; candidate != absent &&
                 at - candidate <= window && visited++ < depth;
                 candidate = previous[candidate]) {
                unsigned distance = unsigned(at - candidate);
                unsigned c = category(distance - 1);
                Match &best = result[p][c];
                if (best.length == limit ||
                    src[candidate + best.length] != src[at + best.length]) continue;
                unsigned length = 2;
                if (matched_until[distance - 1] > at)
                    length = std::max(length, unsigned(std::min<size_t>(limit,
                        matched_until[distance - 1] - at)));
                while (length < limit && src[candidate + length] == src[at + length]) length++;
                matched_until[distance - 1] = uint32_t(at + length);
                if (length > best.length) best = {uint16_t(length), uint16_t(distance)};
                // The nearest full-length match is sufficient for method 2;
                // this also bounds method 1's search on highly repetitive data.
                if (length == limit) break;
            }
        }
        return result;
    }
};

// A block-local range minimum carries the suffix position as a tie breaker.
// Huffman values have constant cost within power-of-two length intervals.
struct MinTree {
    unsigned base = 1;
    std::vector<uint64_t> values;

    explicit MinTree(unsigned size) {
        while (base < size) base *= 2;
        values.assign(base * 2, UINT64_MAX);
    }
    void set(unsigned at, unsigned cost) {
        unsigned node = base + at;
        values[node] = uint64_t(cost) << 32 | at;
        while (node > 1) {
            node /= 2;
            values[node] = std::min(values[node * 2], values[node * 2 + 1]);
        }
    }
    uint64_t get(unsigned first, unsigned last) const { // inclusive
        uint64_t result = UINT64_MAX;
        for (first += base, last += base + 1; first < last; first /= 2, last /= 2) {
            if (first & 1) result = std::min(result, values[first++]);
            if (last & 1) result = std::min(result, values[--last]);
        }
        return result;
    }
};

struct Parse1 {
    MinTree suffix, raw_suffix;
    std::vector<unsigned> raw_choice;
    std::vector<Match> match_choice;
    explicit Parse1(unsigned size) : suffix(size + 1), raw_suffix(size + 1),
        raw_choice(size + 1), match_choice(size) {}
};

} // namespace

extern "C" {

#define BE16(p) ((unsigned)(p)[0] << 8 | (p)[1])
#define BE32(p) ((uint32_t)(p)[0] << 24 | (uint32_t)(p)[1] << 16 | (uint32_t)(p)[2] << 8 | (p)[3])
#define PUT16(p, n) do { (p)[0] = (uint8_t)((n) >> 8); (p)[1] = (uint8_t)(n); } while (0)
#define PUT32(p, n) do { \
    (p)[0] = (uint8_t)((n) >> 24); (p)[1] = (uint8_t)((n) >> 16); \
    (p)[2] = (uint8_t)((n) >> 8); (p)[3] = (uint8_t)(n); \
} while (0)

typedef struct { unsigned depth, code; } Entry;
typedef struct {
    const uint8_t *src; size_t size, cursor;
    uint8_t *dst; size_t cap, out;
    uint32_t bit_buffer; unsigned bit_count;
    int bad;
} Decoder;

static unsigned crc16(const uint8_t *data, size_t size) {
    unsigned crc = 0;
    for (size_t i = 0; i < size; i++) {
        crc ^= data[i];
        for (unsigned bit = 0; bit < 8; bit++)
            crc = crc & 1 ? (crc >> 1) ^ 0xa001u : crc >> 1;
    }
    return crc & 0xffffu;
}

static unsigned byte(Decoder *d) {
    if (d->cursor < d->size) return d->src[d->cursor++];
    if (d->cursor < d->size + 2) { d->cursor++; return 0; }
    d->bad = 1;
    return 0;
}

static unsigned bits1(Decoder *d, unsigned count) {
    unsigned result = 0;
    for (unsigned bit = 0; bit < count; bit++) {
        if (!d->bit_count) {
            unsigned a = byte(d), b = byte(d);
            unsigned c = d->cursor < d->size ? d->src[d->cursor] : 0;
            unsigned e = d->cursor + 1 < d->size ? d->src[d->cursor + 1] : 0;
            d->bit_buffer = a | b << 8 | c << 16 | e << 24;
            d->bit_count = 16;
        }
        result |= (d->bit_buffer & 1u) << bit;
        d->bit_buffer >>= 1;
        d->bit_count--;
    }
    return result;
}

static unsigned bits2(Decoder *d, unsigned count) {
    unsigned result = 0;
    while (count--) {
        if (!d->bit_count) { d->bit_buffer = byte(d); d->bit_count = 8; }
        result = (result << 1) | ((d->bit_buffer >> 7) & 1u);
        d->bit_buffer = (d->bit_buffer << 1) & 255u;
        d->bit_count--;
    }
    return result;
}

static void output(Decoder *d, unsigned value) {
    if (d->out == d->cap) { d->bad = 1; return; }
    d->dst[d->out++] = (uint8_t)value;
}

static void copy(Decoder *d, unsigned distance, unsigned length) {
    if (!distance || distance > d->out || length > d->cap - d->out) {
        d->bad = 1; return;
    }
    while (length--) { d->dst[d->out] = d->dst[d->out - distance]; d->out++; }
}

static unsigned reverse(unsigned value, unsigned count) {
    unsigned result = 0;
    while (count--) { result = (result << 1) | (value & 1u); value >>= 1; }
    return result;
}

static void table(Decoder *d, Entry entries[16]) {
    memset(entries, 0, 16 * sizeof *entries);
    unsigned count = bits1(d, 5);
    if (count > 16) count = 16;
    for (unsigned i = 0; i < count; i++) entries[i].depth = bits1(d, 4);
    uint64_t value = 0;
    uint32_t divisor = 0x80000000u;
    for (unsigned depth = 1; depth <= 16; depth++, divisor >>= 1)
        for (unsigned i = 0; i < count; i++) if (entries[i].depth == depth) {
            entries[i].code = reverse((unsigned)(value / divisor), depth);
            value += divisor;
        }
}

static unsigned symbol(Decoder *d, const Entry entries[16]) {
    for (unsigned i = 0; i < 16; i++) {
        unsigned depth = entries[i].depth;
        if (depth && entries[i].code == (d->bit_buffer & ((1u << depth) - 1u))) {
            bits1(d, depth);
            return i < 2 ? i : bits1(d, i - 1) + (1u << (i - 1));
        }
    }
    d->bad = 1;
    return 0;
}

static void method1(Decoder *d) {
    while (d->out < d->cap && !d->bad) {
        Entry raw[16], distance[16], length[16];
        table(d, raw); table(d, distance); table(d, length);
        unsigned chunks = bits1(d, 16);
        if (!chunks) { d->bad = 1; return; }
        while (chunks-- && !d->bad) {
            unsigned literals = symbol(d, raw);
            if (literals > d->cap - d->out) { d->bad = 1; return; }
            for (unsigned i = 0; i < literals; i++) output(d, byte(d));
            if (literals) {
                uint32_t mask = d->bit_count ? (1u << d->bit_count) - 1u : 0;
                uint32_t next = (d->cursor < d->size ? d->src[d->cursor] : 0) |
                    ((d->cursor + 1 < d->size ? d->src[d->cursor + 1] : 0) << 8) |
                    ((d->cursor + 2 < d->size ? d->src[d->cursor + 2] : 0) << 16);
                d->bit_buffer = (uint32_t)((uint64_t)next << d->bit_count) |
                                (d->bit_buffer & mask);
            }
            if (d->out == d->cap) return;
            if (chunks) {
                unsigned back = symbol(d, distance) + 1;
                unsigned count = symbol(d, length) + 2;
                copy(d, back, count);
            }
        }
    }
}

static unsigned offset2(Decoder *d) {
    unsigned high = 0;
    if (bits2(d, 1)) {
        high = bits2(d, 1);
        if (bits2(d, 1)) {
            high = (high << 1 | bits2(d, 1)) | 4;
            if (!bits2(d, 1)) high = high << 1 | bits2(d, 1);
        } else if (!high) high = bits2(d, 1) + 2;
    }
    return (high << 8 | byte(d)) + 1;
}

static void method2(Decoder *d) {
    while (d->out < d->cap && !d->bad) {
        for (;;) {
            if (!bits2(d, 1)) {
                output(d, byte(d));
                if (d->bad) return;
                continue;
            }
            if (bits2(d, 1)) {
                unsigned length, distance;
                if (bits2(d, 1)) {
                    if (bits2(d, 1)) {
                        length = byte(d) + 8;
                        if (length == 8) { bits2(d, 1); break; }
                    } else length = 3;
                    distance = offset2(d);
                } else { length = 2; distance = byte(d) + 1; }
                copy(d, distance, length);
            } else {
                unsigned length = bits2(d, 1) + 4;
                if (bits2(d, 1)) length = ((length - 1) << 1) + bits2(d, 1);
                if (length != 9) copy(d, offset2(d), length);
                else {
                    unsigned literals = (bits2(d, 4) << 2) + 12;
                    while (literals--) output(d, byte(d));
                }
            }
            if (d->bad) return;
        }
    }
}

int rnc_decode(const uint8_t *src, size_t size, uint8_t *dst,
               size_t cap, size_t *written) {
    if (!src || !dst || !written || size < 18 || memcmp(src, "RNC", 3) ||
        (src[3] != 1 && src[3] != 2)) return -1;
    size_t decoded = BE32(src + 4), packed = BE32(src + 8);
    if (decoded > cap || packed != size - 18 ||
        crc16(src + 18, packed) != BE16(src + 14)) return -1;
    Decoder d = {src, size, 18, dst, decoded, 0, 0, 0, 0};
    unsigned locked = src[3] == 1 ? bits1(&d, 1) : bits2(&d, 1);
    unsigned encrypted = src[3] == 1 ? bits1(&d, 1) : bits2(&d, 1);
    if (locked || encrypted) return -1;
    if (src[3] == 1) method1(&d); else method2(&d);
    if (d.bad || d.out != decoded || crc16(dst, decoded) != BE16(src + 12)) return -1;
    *written = decoded;
    return 0;
}


typedef struct { uint8_t *dst; size_t cap, pos, word; unsigned used; int bad; } Writer1;

static void bit1_out(Writer1 *w, unsigned bit) {
    if (w->used == 16) w->used = 0;
    if (!w->used) {
        if (w->cap - w->pos < 2) { w->bad = 1; return; }
        w->word = w->pos;
        w->dst[w->pos++] = 0;
        w->dst[w->pos++] = 0;
    }
    if (bit) w->dst[w->word + w->used / 8] |= 1u << (w->used % 8);
    w->used++;
}

static void number1(Writer1 *w, unsigned value, unsigned count) {
    for (unsigned i = 0; i < count; i++) bit1_out(w, (value >> i) & 1u);
}

static unsigned table1_size(const Entry entries[16]) {
    unsigned count = 16;
    while (count && !entries[count - 1].depth) count--;
    return count;
}

static void table1_out(Writer1 *w, const Entry entries[16]) {
    unsigned count = table1_size(entries);
    number1(w, count, 5);
    for (unsigned i = 0; i < count; i++) number1(w, entries[i].depth, 4);
}

static void symbol1_out(Writer1 *w, const Entry entries[16], unsigned value) {
    unsigned index = category(value);
    number1(w, entries[index].code, entries[index].depth);
    if (index >= 2) number1(w, value - (1u << (index - 1)), index - 1);
}

static void literal1_out(Writer1 *w, const uint8_t *src, size_t count) {
    if (count > w->cap - w->pos) { w->bad = 1; return; }
    memcpy(w->dst + w->pos, src, count);
    w->pos += count;
}

typedef struct { unsigned raw; Match match; } Token1;
typedef struct { Entry raw[16], distance[16], length[16]; } Tables1;

// At most 16 leaves means the ordinary Huffman tree already fits the format's
// four-bit depth limit. An otherwise constant alphabet still needs one bit.
static void huffman1(const unsigned frequencies[16], Entry entries[16]) {
    unsigned weight[31] = {}, parent[31];
    std::fill(parent, parent + 31, absent);
    for (unsigned i = 0; i < 16; i++) weight[i] = frequencies[i];
    for (unsigned next = 16; next < 31; next++) {
        unsigned first = absent, second = absent;
        for (unsigned i = 0; i < next; i++) if (weight[i] && parent[i] == absent) {
            if (first == absent || weight[i] < weight[first]) {
                second = first; first = i;
            } else if (second == absent || weight[i] < weight[second]) second = i;
        }
        if (second == absent) break;
        parent[first] = parent[second] = next;
        weight[next] = weight[first] + weight[second];
    }
    memset(entries, 0, sizeof(Entry) * 16);
    for (unsigned i = 0; i < 16; i++) if (frequencies[i]) {
        for (unsigned at = i; parent[at] != absent; at = parent[at]) entries[i].depth++;
        entries[i].depth = std::max(entries[i].depth, 1u);
    }
    unsigned code = 0;
    for (unsigned depth = 1; depth <= 15; depth++) {
        for (unsigned i = 0; i < 16; i++) if (entries[i].depth == depth)
            entries[i].code = reverse(code++, depth);
        code *= 2;
    }
}

static unsigned tables1(const std::vector<Token1> &tokens, Tables1 *tables) {
    unsigned raw[16] = {}, distance[16] = {}, length[16] = {};
    for (const Token1 &token : tokens) {
        raw[category(token.raw)]++;
        if (token.match.length) {
            distance[category(token.match.distance - 1)]++;
            length[category(token.match.length - 2)]++;
        }
    }
    huffman1(raw, tables->raw); huffman1(distance, tables->distance);
    huffman1(length, tables->length);
    unsigned bits = 16 + 15 + 4 * (table1_size(tables->raw) +
        table1_size(tables->distance) + table1_size(tables->length));
    for (unsigned i = 0; i < 16; i++) {
        unsigned extra = i > 1 ? i - 1 : 0;
        bits += raw[i] * (tables->raw[i].depth + extra) +
                distance[i] * (tables->distance[i].depth + extra) +
                length[i] * (tables->length[i].depth + extra);
    }
    for (const Token1 &token : tokens) bits += token.raw * 8;
    return bits;
}

static unsigned cost1(const Entry entries[16], unsigned c) {
    // Give an unused symbol a finite estimate so a later pass can introduce it.
    return (entries[c].depth ? entries[c].depth : 8) + (c > 1 ? c - 1 : 0);
}

static std::vector<Token1> parse1(const std::vector<Matches> &matches,
                                 const Tables1 &tables, Parse1 &work) {
    unsigned size = unsigned(matches.size());
    auto &suffix = work.suffix, &raw_suffix = work.raw_suffix;
    auto &raw_choice = work.raw_choice;
    auto &match_choice = work.match_choice;
    suffix.set(size, cost1(tables.raw, 0));
    raw_suffix.set(size, size * 8);
    // A chunk is a literal run followed by a match; the last run has no match.
    // First find each match's best suffix, then choose the literal run ending
    // there. Adding 8*position makes all literal lengths in one symbol range
    // comparable with one range query. The terminal zero run is still coded.
    for (unsigned at = size; at-- > 0;) {
        unsigned best_match = UINT32_MAX / 4;
        for (unsigned d = 0; d < 16; d++) {
            unsigned maximum = matches[at][d].length;
            if (!maximum) continue;
            for (unsigned c = 0; c < 16; c++) {
                unsigned low = (c < 2 ? c : 1u << (c - 1)) + 2;
                if (low > maximum) break;
                unsigned high = std::min(maximum, (c < 2 ? c : (1u << c) - 1) + 2);
                uint64_t choice = suffix.get(at + low, at + high);
                unsigned bits = unsigned(choice >> 32) + cost1(tables.distance, d) +
                                cost1(tables.length, c);
                if (bits < best_match) {
                    best_match = bits;
                    match_choice[at] = {uint16_t(uint32_t(choice) - at), matches[at][d].distance};
                }
            }
        }
        raw_suffix.set(at, best_match + at * 8);
        unsigned best = UINT32_MAX;
        for (unsigned c = 0; c < 16; c++) {
            unsigned low = c < 2 ? c : 1u << (c - 1);
            if (low > size - at) break;
            unsigned high = std::min(size - at, c < 2 ? c : (1u << c) - 1);
            uint64_t choice = raw_suffix.get(at + low, at + high);
            unsigned bits = unsigned(choice >> 32) - at * 8 + cost1(tables.raw, c);
            if (bits < best) { best = bits; raw_choice[at] = uint32_t(choice) - at; }
        }
        suffix.set(at, best);
    }
    std::vector<Token1> tokens;
    unsigned at = 0;
    for (;;) {
        unsigned raw = raw_choice[at];
        at += raw;
        Match match = at < size ? match_choice[at] : Match{};
        tokens.push_back({raw, match});
        if (!match.length) break;
        at += match.length;
    }
    return tokens;
}

static void block1(const uint8_t *src, const std::vector<Matches> &matches, Writer1 *w,
                   unsigned passes = 6) {
    std::vector<Token1> best;
    unsigned pending = 0;
    for (unsigned at = 0; at < matches.size();) {
        Match longest{};
        for (const Match &match : matches[at])
            if (match.length > longest.length) longest = match;
        if (longest.length) {
            best.push_back({pending, longest}); pending = 0;
            at += longest.length;
        } else { pending++; at++; }
    }
    best.push_back({pending, {}});
    Tables1 best_tables{};
    unsigned best_bits = tables1(best, &best_tables);
    // Already tiny blocks (at most 1,024 coded bits) do not justify an expensive
    // iterative parse. This keeps work proportional to compressed output even
    // for large zero-filled assets. Keep the greedy bit cost as a fallback.
    if (best_bits > 1024) {
        Parse1 work(unsigned(matches.size()));
        Tables1 tables{};
        for (unsigned i = 0; i < 16; i++)
            tables.raw[i].depth = tables.distance[i].depth = tables.length[i].depth = 4;
        for (unsigned pass = 0; pass < passes; pass++) {
            Tables1 previous = tables;
            std::vector<Token1> tokens = parse1(matches, tables, work);
            unsigned bits = tables1(tokens, &tables);
            if (bits < best_bits) { best_bits = bits; best = std::move(tokens); best_tables = tables; }
            if (!memcmp(&previous, &tables, sizeof tables)) break;
        }
    }
    table1_out(w, best_tables.raw); table1_out(w, best_tables.distance);
    table1_out(w, best_tables.length); number1(w, unsigned(best.size()), 16);
    unsigned at = 0;
    for (const Token1 &token : best) {
        symbol1_out(w, best_tables.raw, token.raw);
        literal1_out(w, src + at, token.raw); at += token.raw;
        if (token.match.length) {
            symbol1_out(w, best_tables.distance, token.match.distance - 1);
            symbol1_out(w, best_tables.length, token.match.length - 2);
            at += token.match.length;
        }
    }
}

int rnc1_encode(const uint8_t *src, size_t size, uint8_t *dst,
                size_t cap, size_t *written) try {
    if (!src || !dst || !written || size > UINT32_MAX || cap < 18) return -1;
    Writer1 w = {dst, cap, 18, 0, 0, 0};
    MatchIndex index(src, size);
    number1(&w, 0, 2); /* unlocked, unencrypted */
    for (size_t at = 0; at < size && !w.bad;) {
        unsigned length = unsigned(std::min<size_t>(size - at, 8192));
        auto matches = index.find(at, length, 32768, 32769, 1024);
        block1(src + at, matches, &w);
        at += length;
    }
    if (w.bad || w.pos - 18 > UINT32_MAX) return -1;
    memcpy(dst, "RNC", 3); dst[3] = 1;
    PUT32(dst + 4, size); PUT32(dst + 8, w.pos - 18);
    PUT16(dst + 12, crc16(src, size));
    PUT16(dst + 14, crc16(dst + 18, w.pos - 18));
    dst[16] = dst[17] = 0;
    *written = w.pos;
    return 0;
} catch (const std::bad_alloc &) {
    return -1;
} catch (const std::length_error &) {
    return -1;
}

typedef struct { uint8_t *dst; size_t cap, pos, control; unsigned left; int bad; } Writer;
static void emit_bit(Writer *w, unsigned bit) {
    if (!w->left) {
        if (w->pos == w->cap) { w->bad = 1; return; }
        w->control = w->pos++;
        w->dst[w->control] = 0;
        w->left = 8;
    }
    w->left--;
    if (bit) w->dst[w->control] |= 1u << w->left;
}
static void emit_byte(Writer *w, unsigned value) {
    if (w->pos == w->cap) { w->bad = 1; return; }
    w->dst[w->pos++] = (uint8_t)value;
}

static void emit_offset2(Writer *w, size_t distance) {
    unsigned value = (unsigned)(distance - 1);
    unsigned high = value >> 8;
    if (!high) emit_bit(w, 0);
    else if (high == 1) {
        emit_bit(w, 1); emit_bit(w, 1); emit_bit(w, 0);
    } else if (high <= 3) {
        emit_bit(w, 1); emit_bit(w, 0); emit_bit(w, 0);
        emit_bit(w, high - 2);
    } else {
        unsigned base = high >= 8 ? high >> 1 : high;
        emit_bit(w, 1);
        emit_bit(w, (base - 4) >> 1);
        emit_bit(w, 1);
        emit_bit(w, (base - 4) & 1u);
        emit_bit(w, high < 8);
        if (high >= 8) emit_bit(w, high & 1u);
    }
    emit_byte(w, value & 255u);
}

static void emit_literals(Writer *w, const uint8_t *src,
                          size_t start, size_t count) {
    while (count >= 12) {
        size_t run = count > 72 ? 72 : 12 + ((count - 12) / 4) * 4;
        /* The length-nine escape is a raw run of 12,16,...,72 bytes. */
        emit_bit(w, 1); emit_bit(w, 0); emit_bit(w, 1);
        emit_bit(w, 1); emit_bit(w, 1);
        for (unsigned bit = 4; bit > 0; bit--)
            emit_bit(w, ((run - 12) / 4 >> (bit - 1)) & 1u);
        for (size_t j = 0; j < run; j++) emit_byte(w, src[start + j]);
        start += run; count -= run;
    }
    while (count--) { emit_bit(w, 0); emit_byte(w, src[start++]); }
}

int rnc2_encode(const uint8_t *src, size_t size, uint8_t *dst,
                size_t cap, size_t *written) try {
    if (!src || !dst || !written || size > UINT32_MAX || cap < 20) return -1;
    MatchIndex index(src, size);
    auto matches = index.find(0, unsigned(size), 4096, 263, UINT32_MAX);
    std::vector<uint64_t> suffix(size + 1);
    std::vector<Match> choice(size);
    // Every token has a fixed bit cost. Bytes inserted between control bits do
    // not affect their phase, so minimizing total bits also minimizes bytes.
    for (size_t at = size; at-- > 0;) {
        uint64_t best = suffix[at + 1] + 9;
        Match selected{1, 0};
        for (unsigned run = 12; run <= 72 && run <= size - at; run += 4) {
            uint64_t bits = suffix[at + run] + run * 8 + 9;
            if (bits < best) { best = bits; selected = {uint16_t(run), 0}; }
        }
        unsigned longest = 1;
        for (const Match &match : matches[at]) {
            if (!match.length) continue;
            unsigned high = (unsigned(match.distance) - 1) >> 8;
            unsigned offset_bits = 8 + (!high ? 1 : high == 1 ? 3 : high < 4 ? 4 : high < 8 ? 5 : 6);
            unsigned first = std::max(longest + 1, match.distance <= 256 ? 2u : 3u);
            for (unsigned length = first; length <= match.length; length++) {
                unsigned token_bits = length == 2 ? 11 : offset_bits +
                                      (length <= 5 ? 4 : length <= 8 ? 5 : 12);
                uint64_t bits = suffix[at + length] + token_bits;
                if (bits < best) { best = bits; selected = {uint16_t(length), match.distance}; }
            }
            longest = std::max(longest, unsigned(match.length));
        }
        suffix[at] = best; choice[at] = selected;
    }
    Writer w = {dst, cap, 18, 0, 0, 0};
    emit_bit(&w, 0); emit_bit(&w, 0); /* unlocked, unencrypted */
    for (size_t i = 0; i < size && !w.bad;) {
        auto match = choice[i];
        size_t count = match.length, distance = match.distance;
        if (distance) {
            if (count == 2) {
                emit_bit(&w, 1); emit_bit(&w, 1); emit_bit(&w, 0);
                emit_byte(&w, unsigned(distance - 1));
            } else if (count >= 9) {
                emit_bit(&w, 1); emit_bit(&w, 1); emit_bit(&w, 1); emit_bit(&w, 1);
                emit_byte(&w, (unsigned)(count - 8));
            } else if (count == 3) {
                emit_bit(&w, 1); emit_bit(&w, 1); emit_bit(&w, 1); emit_bit(&w, 0);
            } else {
                emit_bit(&w, 1); emit_bit(&w, 0);
                emit_bit(&w, count == 5 || count == 8);
                emit_bit(&w, count >= 6);
                if (count >= 6) emit_bit(&w, count == 7);
            }
            if (count != 2) emit_offset2(&w, distance);
        } else emit_literals(&w, src, i, count);
        i += count;
    }
    for (int i = 0; i < 4; i++) emit_bit(&w, 1);
    emit_byte(&w, 0); emit_bit(&w, 0); /* method-2 end marker */
    if (w.bad || w.pos - 18 > UINT32_MAX) return -1;
    memcpy(dst, "RNC", 3); dst[3] = 2;
    PUT32(dst + 4, size); PUT32(dst + 8, w.pos - 18);
    PUT16(dst + 12, crc16(src, size));
    PUT16(dst + 14, crc16(dst + 18, w.pos - 18));
    dst[16] = dst[17] = 0;
    *written = w.pos;
    return 0;
} catch (const std::bad_alloc &) {
    return -1;
} catch (const std::length_error &) {
    return -1;
}

} /* extern "C" */
