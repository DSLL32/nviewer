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
#include "common/yaz_yay_parse.hpp"

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
    auto matches = longest_matches<273>(src, src_len);
    auto choice = yaz_yay_parse<32, 4>(matches);

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
            unsigned word = (count >= 18 ? 0 : count - 2) << 12 | (matches[i].distance - 1);
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
