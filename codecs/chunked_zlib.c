/* Stunt Racer 64's 16,000-byte-block zlib container. Link with -lz. */
#include <stddef.h>
#include <stdint.h>
#include <limits.h>
#include <string.h>
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

/* A zero result means this candidate did not finish within cap. */
static size_t compress_block(const uint8_t *src, size_t size, uint8_t *dst,
                             size_t cap, int window, int memory) {
    z_stream z = {0};
    if (deflateInit2(&z, Z_BEST_COMPRESSION, Z_DEFLATED, window, memory,
                     Z_DEFAULT_STRATEGY) != Z_OK) return 0;
    z.next_in = (Bytef *)src;
    z.avail_in = (uInt)size;
    z.next_out = dst;
    z.avail_out = (uInt)cap;
    int status = deflate(&z, Z_FINISH);
    size_t packed = z.total_out;
    deflateEnd(&z);
    return status == Z_STREAM_END ? packed : 0;
}

int chunked_zlib_encode(const uint8_t *src, size_t size, uint8_t *dst,
                        size_t cap, size_t *written) {
    if (!src || !dst || !written || size > UINT32_MAX || cap < 8) return -1;
    /* The original level-9 profile bounds the result; 16,384 bytes exceed
     * its compressBound(16000). Other profiles need only beat this size. */
    uint8_t best[16384], trial[16384];
    size_t in = 0, out = 8;
    while (in < size) {
        size_t block = size - in < 16000 ? size - in : 16000;
        size_t packed = compress_block(src + in, block, best, sizeof(best), 15, 8);
        if (!packed) return -1;
        /* Smaller token buffers can split a heterogeneous block profitably;
         * a shorter window can avoid expensive long-distance matches. */
        for (int window = 12; window <= 15; window += 3) {
            for (int memory = 3; memory <= 8; memory++) {
                if (window == 15 && memory == 8) continue;
                size_t n = compress_block(src + in, block, trial, packed,
                                          window, memory);
                if (n && n < packed) {
                    memcpy(best, trial, n);
                    packed = n;
                }
            }
        }
        size_t padded = (packed + 1) & ~(size_t)1;
        if (cap - out < 4 || padded > cap - out - 4) return -1;
        PUT32(dst + out, packed);
        memcpy(dst + out + 4, best, packed);
        out += 4 + packed;
        if (out & 1) dst[out++] = 0;
        in += block;
    }
    if (out > UINT32_MAX) return -1;
    PUT32(dst, out); PUT32(dst + 4, size);
    *written = out;
    return 0;
}
