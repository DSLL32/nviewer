/* Yaz0 reference codec. Both functions return 0 on success, -1 on error.
 * The encoder uses a single recent 3-byte match per hash bucket.
 */
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#define BE32(p) ((uint32_t)(p)[0] << 24 | (p)[1] << 16 | (p)[2] << 8 | (p)[3])
#define PUT32(p, value) do { \
    uint32_t n_ = (value); \
    (p)[0] = n_ >> 24; (p)[1] = n_ >> 16; \
    (p)[2] = n_ >> 8; (p)[3] = n_; \
} while (0)
#define HASH3(p) (((p)[0] * 251u + (p)[1] * 31u + (p)[2]) & 4095u)

int yaz0_decode(const uint8_t *src, size_t src_len, uint8_t *dst,
                size_t dst_cap, size_t *dst_len) {
    if (!src || !dst || !dst_len || src_len < 16 || memcmp(src, "Yaz0", 4)) return -1;
    size_t size = BE32(src + 4), in = 16, out = 0;
    if (size > dst_cap) return -1;
    unsigned flags = 0, left = 0;
    while (out < size) {
        if (!left) { if (in == src_len) return -1; flags = src[in++]; left = 8; }
        if (flags & 0x80u) {
            if (in == src_len) return -1;
            dst[out++] = src[in++];
        } else {
            if (in > src_len || src_len - in < 2) return -1;
            unsigned a = src[in++], b = src[in++];
            size_t distance = ((a & 15u) << 8 | b) + 1u;
            size_t count = a >> 4;
            if (count) count += 2;
            else { if (in == src_len) return -1; count = (size_t)src[in++] + 18; }
            if (distance > out || count > size - out) return -1;
            while (count--) { dst[out] = dst[out - distance]; out++; }
        }
        flags <<= 1; left--;
    }
    *dst_len = out;
    return 0;
}

int yaz0_encode(const uint8_t *src, size_t src_len, uint8_t *dst,
                size_t dst_cap, size_t *dst_len) {
    if (!src || !dst || !dst_len || src_len > UINT32_MAX || dst_cap < 16) return -1;
    memcpy(dst, "Yaz0", 4); PUT32(dst + 4, src_len);
    memset(dst + 8, 0, 8);
    size_t last[4096];
    for (size_t k = 0; k < 4096; k++) last[k] = SIZE_MAX;
    size_t i = 0, out = 16;
    while (i < src_len) {
        if (out == dst_cap) return -1;
        size_t flag_at = out++;
        unsigned flags = 0;
        for (unsigned bit = 0; bit < 8 && i < src_len; bit++) {
            size_t count = 0, distance = 0;
            if (i + 2 < src_len) {
                size_t prev = last[HASH3(src + i)];
                if (prev != SIZE_MAX && i - prev <= 4096) {
                    while (count < 273 && i + count < src_len &&
                           src[prev + count] == src[i + count]) count++;
                    if (count >= 3) distance = i - prev;
                    else count = 0;
                }
            }
            size_t width = count ? (count >= 18 ? 3 : 2) : 1;
            if (width > dst_cap - out) return -1;
            if (count) {
                unsigned d = (unsigned)(distance - 1);
                dst[out++] = ((count >= 18 ? 0 : count - 2) << 4) | (d >> 8);
                dst[out++] = d;
                if (count >= 18) dst[out++] = count - 18;
            } else {
                flags |= 0x80u >> bit;
                dst[out++] = src[i]; count = 1;
            }
            for (size_t j = 0; j < count; j++)
                if (i + j + 2 < src_len) last[HASH3(src + i + j)] = i + j;
            i += count;
        }
        dst[flag_at] = flags;
    }
    *dst_len = out;
    return 0;
}
