/* Yay0 reference codec. Both functions return 0 on success, -1 on error.
 * The encoder uses one recent match per three-byte hash bucket.
 */
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include "common/match_finder.hpp"

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

static void encode_pass(const uint8_t *src, size_t src_len, uint8_t *dst,
                        size_t link_at, size_t chunk_at,
                        size_t *tokens_out, size_t *links_out, size_t *chunks_out) {
    MatchFinder<4096, 273> finder;
    size_t i = 0, tokens = 0, links = 0, chunks = 0;
    while (i < src_len) {
        auto match = finder.find(src, src_len, i);
        size_t count = match.length, distance = match.distance;
        if (count) {
            unsigned word = (count >= 18 ? 0 : count - 2) << 12 | (distance - 1);
            if (dst) { dst[link_at + links] = word >> 8; dst[link_at + links + 1] = word; }
            links += 2;
            if (count >= 18) {
                if (dst) dst[chunk_at + chunks] = count - 18;
                chunks++;
            }
        } else {
            if (dst) {
                dst[16 + tokens / 8] |= 0x80u >> (tokens % 8);
                dst[chunk_at + chunks] = src[i];
            }
            chunks++; count = 1;
        }
        finder.advance(src, src_len, i, count);
        i += count; tokens++;
    }
    *tokens_out = tokens; *links_out = links; *chunks_out = chunks;
}

int yay0_encode(const uint8_t *src, size_t src_len, uint8_t *dst,
                size_t dst_cap, size_t *dst_len) {
    if (!src || !dst || !dst_len || src_len > UINT32_MAX) return -1;
    size_t tokens, links, chunks;
    encode_pass(src, src_len, NULL, 0, 0, &tokens, &links, &chunks);
    size_t control_bytes = ((tokens + 31) / 32) * 4;
    size_t total = 16 + control_bytes + links + chunks;
    if (total > dst_cap || total > UINT32_MAX) return -1;
    memcpy(dst, "Yay0", 4); PUT32(dst + 4, src_len);
    PUT32(dst + 8, 16 + control_bytes);
    PUT32(dst + 12, 16 + control_bytes + links);
    memset(dst + 16, 0, control_bytes);
    encode_pass(src, src_len, dst, 16 + control_bytes,
                16 + control_bytes + links, &tokens, &links, &chunks);
    *dst_len = total;
    return 0;
}

} /* extern "C" */
