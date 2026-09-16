/* Yay0 reference codec. Both functions return 0 on success, -1 on error.
 * The encoder finds a minimum-size parse, including control-word padding.
 */
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <algorithm>
#include <array>
#include <new>
#include <stdexcept>
#include <vector>

namespace {

// Matches end at most 273 bytes ahead. Keep suffix costs in a rolling tree
// of 512 positions, packing each position with its cost to recover a choice.
struct SuffixMin {
    static constexpr unsigned span = 512;
    using Costs = std::array<uint64_t, 32>;
    std::array<Costs, span * 2> tree;

    SuffixMin() { for (auto &row : tree) row.fill(UINT64_MAX); }

    // All 32 token phases use the same ranges. Keeping them together avoids
    // repeating tree traversal and gives each operation contiguous data.
    void set(size_t pos, const Costs &cost) {
        unsigned at = span + (unsigned(pos) & (span - 1));
        for (unsigned phase = 0; phase < 32; phase++)
            tree[at][phase] = cost[phase] << 9 | (unsigned(pos) & (span - 1));
        while (at > 1) {
            at >>= 1;
            for (unsigned phase = 0; phase < 32; phase++)
                tree[at][phase] = std::min(tree[at * 2][phase], tree[at * 2 + 1][phase]);
        }
    }

    static void lower(Costs &to, const Costs &from) {
        for (unsigned phase = 0; phase < 32; phase++)
            to[phase] = std::min(to[phase], from[phase]);
    }

    void part(unsigned first, unsigned last, Costs &best) const {
        for (first += span, last += span; first < last; first >>= 1, last >>= 1) {
            if (first & 1) lower(best, tree[first++]);
            if (last & 1) lower(best, tree[--last]);
        }
    }

    Costs get(size_t first, size_t last) const { // inclusive positions
        unsigned a = unsigned(first) & (span - 1);
        unsigned b = unsigned(last) & (span - 1);
        Costs best;
        best.fill(UINT64_MAX);
        if (a <= b) part(a, b + 1, best);
        else { part(a, span, best); part(0, b + 1, best); }
        return best;
    }

    static unsigned length(uint64_t packed, size_t from, unsigned minimum) {
        // Every query spans fewer than 512 positions, so the leaf index
        // uniquely identifies a suffix within that query's range.
        unsigned first = (unsigned(from) + minimum) & (span - 1);
        return minimum + ((unsigned(packed) - first) & (span - 1));
    }
};

} // namespace

extern "C" {

#define BE32(p) ((uint32_t)(p)[0] << 24 | (p)[1] << 16 | (p)[2] << 8 | (p)[3])
#define PUT32(p, value) do { \
    uint32_t n_ = (value); \
    (p)[0] = n_ >> 24; (p)[1] = n_ >> 16; \
    (p)[2] = n_ >> 8; (p)[3] = n_; \
} while (0)

int yay0_decode(const uint8_t *src, size_t src_len, uint8_t *dst,
                size_t dst_cap, size_t *dst_len) {
    if (!src || !dst || !dst_len || src_len < 16 || memcmp(src, "Yay0", 4)) return -1;
    size_t size = BE32(src + 4), ctrl = 16;
    size_t link = BE32(src + 8), chunk = BE32(src + 12), out = 0;
    if (size > dst_cap || link < 16 || chunk < link || chunk > src_len) return -1;
    uint32_t flags = 0;
    unsigned left = 0;
    while (out < size) {
        if (!left) {
            if (ctrl > link || link - ctrl < 4) return -1;
            flags = BE32(src + ctrl); ctrl += 4; left = 32;
        }
        if (flags & 0x80000000u) {
            if (chunk == src_len) return -1;
            dst[out++] = src[chunk++];
        } else {
            if (link > chunk || chunk - link < 2) return -1;
            unsigned word = src[link] << 8 | src[link + 1]; link += 2;
            size_t distance = (word & 4095u) + 1u, count = word >> 12;
            if (count) count += 2;
            else { if (chunk == src_len) return -1; count = src[chunk++] + 18u; }
            if (distance > out || count > size - out) return -1;
            while (count--) { dst[out] = dst[out - distance]; out++; }
        }
        flags <<= 1; left--;
    }
    *dst_len = out;
    return 0;
}

int yay0_encode(const uint8_t *src, size_t src_len, uint8_t *dst,
                size_t dst_cap, size_t *dst_len) try {
    if (!src || !dst || !dst_len || src_len > UINT32_MAX || dst_cap < 16) return -1;
    constexpr uint32_t absent = UINT32_MAX;
    std::array<uint32_t, 65536> head;
    head.fill(absent);
    std::vector<uint32_t> prev(src_len, absent);
    std::vector<uint16_t> longest(src_len, 0), distance(src_len, 0);
    for (size_t i = 0; src_len - i >= 3; i++) {
        uint32_t bytes = uint32_t(src[i]) << 16 | uint32_t(src[i + 1]) << 8 | src[i + 2];
        unsigned hash = (bytes * 0x1e35a7bdu) >> 16;
        unsigned limit = unsigned(std::min<size_t>(273, src_len - i));
        unsigned best = 0;
        // Search every matching hash in the legal window. Hash collisions
        // are compared normally; every prefix of the longest match is legal.
        for (uint32_t candidate = head[hash];
             candidate != absent && i - candidate <= 4096;
             candidate = prev[candidate]) {
            if (best && src[candidate + best] != src[i + best]) continue;
            unsigned length = 0;
            while (length < limit && src[candidate + length] == src[i + length]) length++;
            if (length > best) {
                best = length;
                distance[i] = uint16_t(i - candidate);
                if (best == limit) break;
            }
        }
        longest[i] = best >= 3 ? best : 0;
        prev[i] = head[hash];
        head[hash] = uint32_t(i);
    }

    // State is (input position, tokens used modulo 32). Opening a control
    // word costs four bytes; literals cost one, matches two or three. Range
    // minima consider every legal match length without a 273-way scan.
    SuffixMin suffix;
    std::vector<std::array<uint16_t, 32>> choice(src_len);
    suffix.set(src_len, {});
    for (size_t i = src_len; i-- > 0;) {
        unsigned length = longest[i];
        auto literal = suffix.get(i + 1, i + 1);
        SuffixMin::Costs short_match{}, long_match{}, costs;
        if (length >= 3) short_match = suffix.get(i + 3, i + std::min(length, 17u));
        if (length >= 18) long_match = suffix.get(i + 18, i + length);
        for (unsigned phase = 0; phase < 32; phase++) {
            unsigned next = (phase + 1) & 31;
            unsigned control = phase == 0 ? 4 : 0;
            uint64_t best = 1 + control + (literal[next] >> 9);
            unsigned selected = 1;
            if (length >= 3) {
                uint64_t short_best = short_match[next];
                uint64_t cost = 2 + control + (short_best >> 9);
                if (cost < best) { best = cost; selected = SuffixMin::length(short_best, i, 3); }
            }
            if (length >= 18) {
                uint64_t long_best = long_match[next];
                uint64_t cost = 3 + control + (long_best >> 9);
                if (cost < best) { best = cost; selected = SuffixMin::length(long_best, i, 18); }
            }
            choice[i][phase] = uint16_t(selected);
            costs[phase] = best;
        }
        suffix.set(i, costs);
    }

    size_t tokens = 0, links = 0, chunks = 0;
    for (size_t i = 0; i < src_len; tokens++) {
        unsigned count = choice[i][tokens & 31];
        if (count == 1) chunks++;
        else { links += 2; if (count >= 18) chunks++; }
        i += count;
    }
    size_t control_bytes = ((tokens + 31) / 32) * 4;
    uint64_t total = 16 + uint64_t(control_bytes) + links + chunks;
    if (total > dst_cap || total > UINT32_MAX) return -1;
    memcpy(dst, "Yay0", 4); PUT32(dst + 4, src_len);
    PUT32(dst + 8, 16 + control_bytes);
    PUT32(dst + 12, 16 + control_bytes + links);
    memset(dst + 16, 0, control_bytes);
    size_t link = 16 + control_bytes, chunk = link + links, token = 0;
    for (size_t i = 0; i < src_len; token++) {
        unsigned count = choice[i][token & 31];
        if (count == 1) {
            dst[16 + token / 8] |= 0x80u >> (token & 7);
            dst[chunk++] = src[i];
        } else {
            unsigned word = (count >= 18 ? 0 : count - 2) << 12 | (distance[i] - 1);
            dst[link++] = word >> 8;
            dst[link++] = word;
            if (count >= 18) dst[chunk++] = count - 18;
        }
        i += count;
    }
    *dst_len = size_t(total);
    return 0;
} catch (const std::bad_alloc &) {
    return -1;
} catch (const std::length_error &) {
    return -1;
}

} /* extern "C" */
