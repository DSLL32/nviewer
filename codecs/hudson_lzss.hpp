/* Hudson's absolute-ring LZSS. LenBits=6: Bomberman 64/Second Attack;
 * LenBits=4: Bomberman Hero. The game-specific size word is outside this codec.
 * Functions return 0 on success, -1 on malformed input or short output.
 */
#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
#include "common/match_finder.hpp"

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

template<unsigned LenBits>
int hudson_encode(const uint8_t *src, size_t src_len, uint8_t *dst,
                  size_t dst_cap, size_t *dst_len) {
    static_assert(LenBits == 4 || LenBits == 6);
    constexpr size_t window = size_t{1} << (16 - LenBits);
    constexpr size_t mask = window - 1;
    constexpr size_t max_len = (size_t{1} << LenBits) + 2;
    MatchFinder<window, max_len> finder;
    if (!src || !dst || !dst_len) return -1;
    size_t in = 0, out = 0, write = window - max_len;
    while (in < src_len) {
        if (out == dst_cap) return -1;
        size_t flag_at = out++;
        unsigned flags = 0;
        for (unsigned bit = 0; bit < 8 && in < src_len; bit++) {
            auto match = finder.find(src, src_len, in);
            size_t count = match.length, distance = match.distance;
            if (count) {
                if (dst_cap - out < 2) return -1;
                size_t pos = (write - distance) & mask;
                dst[out++] = pos;
                dst[out++] = ((pos >> 8) << LenBits) | (count - 3);
            } else {
                if (out == dst_cap) return -1;
                flags |= 1u << bit;
                dst[out++] = src[in]; count = 1;
            }
            finder.advance(src, src_len, in, count);
            in += count; write = (write + count) & mask;
        }
        dst[flag_at] = flags;
    }
    *dst_len = out;
    return 0;
}
