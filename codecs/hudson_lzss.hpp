/* Hudson's absolute-ring LZSS. LenBits=6: Bomberman 64/Second Attack;
 * LenBits=4: Bomberman Hero. The game-specific size word is outside this codec.
 * Functions return 0 on success, -1 on malformed input or short output.
 */
#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>
#include "common/hash_chain.hpp"

struct HudsonHash3 {
    static constexpr size_t width = 3, buckets = 65536;
    unsigned operator()(const uint8_t *p) const {
        return ((unsigned(p[0]) * 251u + p[1]) * 251u + p[2]) & 65535u;
    }
};

template<unsigned LenBits>
int hudson_decode(const uint8_t *src, size_t src_len, uint8_t *dst,
                  size_t dst_cap, size_t *dst_len, size_t expected = SIZE_MAX) {
    static_assert(LenBits == 4 || LenBits == 6);
    constexpr size_t window = size_t{1} << (16 - LenBits);
    constexpr size_t mask = window - 1;
    constexpr size_t start = window - ((size_t{1} << LenBits) + 2);
    std::array<uint8_t, window> ring{};
    size_t in = 0, out = 0, write = start;
    unsigned flags = 0, left = 0;
    if (!src || !dst || !dst_len || (expected != SIZE_MAX && expected > dst_cap)) return -1;
    while (expected == SIZE_MAX ? in < src_len : out < expected) {
        if (!left) {
            if (in == src_len) break;
            flags = src[in++]; left = 8;
        }
        if (in == src_len && expected == SIZE_MAX) break;
        if (flags & 1u) {
            if (in == src_len || out == dst_cap) return -1;
            uint8_t byte = src[in++];
            dst[out++] = byte; ring[write] = byte; write = (write + 1) & mask;
        } else {
            if (in > src_len || src_len - in < 2) return -1;
            unsigned a = src[in++], b = src[in++];
            size_t pos = a | (b >> LenBits) << 8;
            size_t count = (b & ((1u << LenBits) - 1)) + 3;
            if (expected != SIZE_MAX && count > expected - out) count = expected - out;
            if (count > dst_cap - out) return -1;
            while (count--) {
                uint8_t byte = ring[pos]; pos = (pos + 1) & mask;
                dst[out++] = byte; ring[write] = byte; write = (write + 1) & mask;
            }
        }
        flags >>= 1; left--;
    }
    if (expected != SIZE_MAX && out != expected) return -1;
    *dst_len = out;
    return 0;
}

/* Effort controls the number of same-hash candidates searched per input byte.
 * Parsing is optimal for the matches found, including the flag-byte cost.
 * Higher efforts can only add available matches, so output size never grows.
 */
template<unsigned LenBits>
int hudson_encode_ex(const uint8_t *src, size_t src_len, uint8_t *dst,
                     size_t dst_cap, size_t *dst_len, unsigned effort) {
    static_assert(LenBits == 4 || LenBits == 6);
    constexpr size_t window = size_t{1} << (16 - LenBits);
    constexpr size_t mask = window - 1;
    constexpr size_t max_len = (size_t{1} << LenBits) + 2;
    if (!src || !dst || !dst_len) return -1;
    if (src_len > SIZE_MAX / 8 - 1) return -1;
    constexpr unsigned depths[] = {1, 2, 4, 8, 16, 32, 64, 128,
                                   unsigned(window / 4),
                                   unsigned(window)};
    const unsigned depth = depths[effort < 10 ? effort : 9];

    struct Match { uint16_t distance; uint8_t length; };
    std::vector<Match> matches(src_len, Match{0, 0});
    HashChain<HudsonHash3, size_t, window> index;
    for (size_t i = 0; i + 2 < src_len; i++) {
        size_t limit = src_len - i < max_len ? src_len - i : max_len;
        Match best{0, 0};

        // Before the first wrap, the unwritten part of the ring is zero.
        // Reading at the writer itself (distance = window) is safe: the
        // decoder reads each cell before writing it. For later zero runs,
        // the previous output byte is an overlapping one-byte seed.
        if (src[i] == 0 && (i < window || src[i - 1] == 0)) {
            size_t zero_limit = limit;
            if (i < window && zero_limit > window - i)
                zero_limit = window - i;
            size_t length = 1;
            while (length < limit && src[i + length] == 0) length++;
            if (i < window && zero_limit >= 3) {
                size_t n = length < zero_limit ? length : zero_limit;
                if (n >= 3) best = {uint16_t(window), uint8_t(n)};
            }
            if ((i == 0 || src[i - 1] == 0) && length >= 3 &&
                length > best.length)
                best = {1, uint8_t(length)};
        }

        size_t prev = index.first(src, i);
        for (unsigned n = 0; n < depth && prev != index.absent &&
             i - prev <= window && best.length < limit; n++) {
            size_t length = 0;
            while (length < limit && src[prev + length] == src[i + length])
                length++;
            if (length >= 3 && length > best.length)
                best = {uint16_t(i - prev), uint8_t(length)};
            prev = index.previous(prev);
        }
        matches[i] = best;
        index.insert(src, i);
    }

    // The next state is the token's bit position in its flag byte. A new
    // group charges one byte; literals and matches charge one and two more.
    std::vector<size_t> cost((src_len + 1) * 8, 0);
    std::vector<uint8_t> choice(src_len * 8, 1);
    for (size_t i = src_len; i-- > 0;) {
        for (unsigned phase = 0; phase < 8; phase++) {
            unsigned next = (phase + 1) & 7;
            size_t overhead = phase == 0 ? 1 : 0;
            size_t best = overhead + 1 + cost[(i + 1) * 8 + next];
            uint8_t length = 1;
            for (unsigned n = 3; n <= matches[i].length; n++) {
                size_t candidate = overhead + 2 + cost[(i + n) * 8 + next];
                if (candidate < best || (candidate == best && n > length)) {
                    best = candidate;
                    length = uint8_t(n);
                }
            }
            cost[i * 8 + phase] = best;
            choice[i * 8 + phase] = length;
        }
    }

    size_t in = 0, out = 0, write = window - max_len;
    unsigned phase = 0;
    size_t flag_at = 0;
    uint8_t flags = 0;
    while (in < src_len) {
        if (phase == 0) {
            if (out == dst_cap) return -1;
            flag_at = out++;
            flags = 0;
        }
        unsigned count = choice[in * 8 + phase];
        if (count > 1) {
            if (dst_cap - out < 2) return -1;
            size_t pos = (write - matches[in].distance) & mask;
            dst[out++] = uint8_t(pos);
            dst[out++] = uint8_t(((pos >> 8) << LenBits) | (count - 3));
        } else {
            if (out == dst_cap) return -1;
            flags |= uint8_t(1u << phase);
            dst[out++] = src[in];
        }
        in += count;
        write = (write + count) & mask;
        phase = (phase + 1) & 7;
        if (phase == 0 || in == src_len) dst[flag_at] = flags;
    }
    *dst_len = out;
    return 0;
}

template<unsigned LenBits>
int hudson_encode(const uint8_t *src, size_t src_len, uint8_t *dst,
                  size_t dst_cap, size_t *dst_len) {
    return hudson_encode_ex<LenBits>(src, src_len, dst, dst_cap, dst_len, 9);
}
