/* Stunt Racer 64's 16,000-byte-block zlib container. Link with -lz. */
#include <stddef.h>
#include <stdint.h>
#include <limits.h>
#include <zlib.h>

#define BE32(p) ((uint32_t)(p)[0] << 24 | (uint32_t)(p)[1] << 16 | (uint32_t)(p)[2] << 8 | (p)[3])
#define PUT32(p, n) do { \
    (p)[0] = (uint8_t)((n) >> 24); (p)[1] = (uint8_t)((n) >> 16); \
    (p)[2] = (uint8_t)((n) >> 8); (p)[3] = (uint8_t)(n); \
} while (0)

int chunked_zlib_decode(const uint8_t *src, size_t size, uint8_t *dst,
                        size_t cap, size_t *written) {
    if (!src || !dst || !written || size < 8) return -1;
    size_t end = BE32(src), total = BE32(src + 4), in = 8, out = 0;
    if (end > size || end < 8 || total > cap) return -1;
    while (in < end) {
        if (end - in < 4) return -1;
        size_t packed = BE32(src + in);
        in += 4;
        if (packed > end - in) return -1;
        size_t block = total - out < 16000 ? total - out : 16000;
        uLongf got = (uLongf)block;
        int status = uncompress(dst + out, &got, src + in, (uLong)packed);
        if (status != Z_OK || got != block) return -1;
        out += block;
        in += packed;
        if (in & 1) in++;
        if (in > end) return -1;
    }
    if (out != total) return -1;
    *written = out;
    return 0;
}

int chunked_zlib_encode(const uint8_t *src, size_t size, uint8_t *dst,
                        size_t cap, size_t *written) {
    if (!src || !dst || !written || size > UINT32_MAX || cap < 8) return -1;
    size_t in = 0, out = 8;
    while (in < size) {
        size_t block = size - in < 16000 ? size - in : 16000;
        if (cap - out < 4 || cap - out - 4 < compressBound((uLong)block)) return -1;
        uLongf packed = (uLongf)(cap - out - 4);
        if (compress2(dst + out + 4, &packed, src + in, (uLong)block,
                      Z_BEST_COMPRESSION) != Z_OK) return -1;
        PUT32(dst + out, packed);
        out += 4 + packed;
        if (out & 1) {
            if (out == cap) return -1;
            dst[out++] = 0;
        }
        in += block;
    }
    if (out > UINT32_MAX) return -1;
    PUT32(dst, out); PUT32(dst + 4, size);
    *written = out;
    return 0;
}
