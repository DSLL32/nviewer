/* Yoshi's Story SMSR00 slide-LZ, optionally wrapped in CMPR. */
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <array>
#include <new>
#include <stdexcept>
#include <vector>

extern "C" {

#define BE32(p) ((uint32_t)(p)[0] << 24 | (uint32_t)(p)[1] << 16 | (uint32_t)(p)[2] << 8 | (p)[3])
#define PUT32(p, n) do { \
    (p)[0] = (uint8_t)((n) >> 24); (p)[1] = (uint8_t)((n) >> 16); \
    (p)[2] = (uint8_t)((n) >> 8); (p)[3] = (uint8_t)(n); \
} while (0)

int smsr_decode(const uint8_t *src, size_t size, uint8_t *dst,
                size_t cap, size_t *written) {
    if (!src || !dst || !written || size < 16 ||
        memcmp(src, "SMSR00\0\0", 8)) return -1;
    size_t decoded = BE32(src + 8), lit_at = BE32(src + 12);
    if (lit_at > size - 16 || decoded > cap) return -1;
    lit_at += 16;
    const size_t ctrl_end = lit_at;
    size_t ctrl = 16, out = 0;
    unsigned flags = 0, left = 0;
    while (out < decoded) {
        if (!left) {
            if (ctrl > ctrl_end || ctrl_end - ctrl < 2) return -1;
            flags = src[ctrl] << 8 | src[ctrl + 1]; ctrl += 2; left = 16;
        }
        if (flags & 0x8000u) {
            if (lit_at == size) return -1;
            dst[out++] = src[lit_at++];
        } else {
            if (ctrl > ctrl_end || ctrl_end - ctrl < 2) return -1;
            unsigned word = src[ctrl] << 8 | src[ctrl + 1]; ctrl += 2;
            size_t distance = (word & 4095u) + 1u, count = (word >> 12) + 3u;
            if (distance > out) return -1;
            while (count-- && out < decoded) { dst[out] = dst[out - distance]; out++; }
        }
        flags <<= 1; left--;
    }
    *written = out;
    return 0;
}

int smsr_encode(const uint8_t *src, size_t size, uint8_t *dst,
                size_t cap, size_t *written) try {
    if (!src || !dst || !written || size > UINT32_MAX) return -1;
    // Distances all cost two bytes, so one longest match also represents every
    // shorter match at this position. Search the entire 4 KiB window.
    constexpr uint32_t absent = UINT32_MAX;
    std::array<uint32_t, 65536> head;
    std::array<uint32_t, 4096> prev;
    head.fill(absent);
    struct Match { uint16_t distance; uint8_t length; };
    std::vector<Match> matches(size);
    for (size_t i = 0; size - i >= 3; i++) {
        uint32_t bytes = (uint32_t(src[i]) << 16) | (uint32_t(src[i + 1]) << 8) | src[i + 2];
        unsigned hash = (bytes * 0x1e35a7bdu) >> 16;
        unsigned limit = unsigned(size - i < 18 ? size - i : 18);
        for (uint32_t p = head[hash]; p != absent && i - p <= 4096;
             p = prev[p & 4095]) {
            if (src[p + matches[i].length] != src[i + matches[i].length]) continue;
            unsigned length = 0;
            while (length < limit && src[p + length] == src[i + length]) length++;
            if (length >= 3 && length > matches[i].length) {
                matches[i] = {uint16_t(i - p), uint8_t(length)};
                if (length == limit) break;
            }
        }
        prev[i & 4095] = head[hash];
        head[hash] = uint32_t(i);
    }

    // Exact byte costs for all 16 control-word phases. A token starts a new
    // two-byte control word at phase zero, plus one literal or two match bytes.
    // Only the following 18 positions' costs are needed while parsing backward.
    std::array<std::array<uint64_t, 16>, 19> cost{};
    std::vector<std::array<uint8_t, 16>> choice(size);
    for (size_t i = size; i-- > 0;) {
        for (unsigned phase = 0; phase < 16; phase++) {
            unsigned next = (phase + 1) & 15, extra = phase == 0 ? 2 : 0;
            uint64_t best = extra + 1 + cost[(i + 1) % 19][next];
            unsigned count = 1;
            for (unsigned length = 3; length <= matches[i].length; length++) {
                uint64_t trial = extra + 2 + cost[(i + length) % 19][next];
                if (trial <= best) { best = trial; count = length; }
            }
            cost[i % 19][phase] = best;
            choice[i][phase] = uint8_t(count);
        }
    }
    size_t controls = 0, literals = 0, tokens = 0;
    for (size_t i = 0; i < size; tokens++) {
        if (tokens % 16 == 0) controls += 2;
        unsigned length = choice[i][tokens % 16];
        if (length == 1) literals++; else controls += 2;
        i += length;
    }
    if (controls > UINT32_MAX || cap < 16 || controls > cap - 16 ||
        literals > cap - 16 - controls) return -1;
    memcpy(dst, "SMSR00\0\0", 8);
    PUT32(dst + 8, size); PUT32(dst + 12, controls);
    size_t ctrl = 16, lit = 16 + controls, flag_at = 0;
    tokens = 0;
    for (size_t i = 0; i < size; tokens++) {
        if (tokens % 16 == 0) {
            flag_at = ctrl;
            dst[ctrl++] = 0; dst[ctrl++] = 0;
        }
        unsigned length = choice[i][tokens % 16];
        if (length == 1) {
            dst[flag_at + (tokens % 16) / 8] |= 0x80u >> (tokens % 8);
            dst[lit++] = src[i];
        } else {
            unsigned word = (length - 3) << 12 | (matches[i].distance - 1);
            dst[ctrl++] = uint8_t(word >> 8); dst[ctrl++] = uint8_t(word);
        }
        i += length;
    }
    *written = 16 + controls + literals;
    return 0;
} catch (const std::bad_alloc &) {
    return -1;
} catch (const std::length_error &) {
    return -1;
}

int cmpr_decode(const uint8_t *src, size_t size, uint8_t *dst,
                size_t cap, size_t *written) {
    if (!src || !dst || !written || size < 32 || memcmp(src, "CMPR", 4)) return -1;
    size_t stored = BE32(src + 4), decoded = BE32(src + 8);
    if (stored > size - 16 || decoded > cap || BE32(src + 12)) return -1;
    if (smsr_decode(src + 16, stored, dst, cap, written)) return -1;
    return *written == decoded ? 0 : -1;
}

int cmpr_encode(const uint8_t *src, size_t size, uint8_t *dst,
                size_t cap, size_t *written) {
    if (!src || !dst || !written || cap < 16) return -1;
    size_t stream;
    if (smsr_encode(src, size, dst + 16, cap - 16, &stream)) return -1;
    size_t stored = stream + (stream & 1);
    if (stored > UINT32_MAX || stored > cap - 16) return -1;
    memcpy(dst, "CMPR", 4);
    PUT32(dst + 4, stored); PUT32(dst + 8, size); PUT32(dst + 12, 0);
    if (stream != stored) dst[16 + stream] = 0;
    *written = 16 + stored;
    return 0;
}

} /* extern "C" */
