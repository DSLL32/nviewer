/* RFC 1951 raw DEFLATE and Rare wrappers. Link with -lz.
 * All functions return 0 on success, -1 on invalid input or insufficient space.
 * Source and destination buffers must not overlap.
 */
#include <stddef.h>
#include <stdint.h>
#include <limits.h>
#include <string.h>
#include <zlib.h>

static int inflate_raw(const uint8_t *src, size_t size, uint8_t *dst,
                       size_t cap, size_t *written) {
    if (size > UINT_MAX || cap > UINT_MAX) return -1;
    z_stream z = {0};
    if (inflateInit2(&z, -15) != Z_OK) return -1;
    z.next_in = (Bytef *)src;
    z.avail_in = (uInt)size;
    uint8_t empty_sink;
    z.next_out = cap ? dst : &empty_sink;
    z.avail_out = cap ? (uInt)cap : 1;
    int result = inflate(&z, Z_FINISH);
    *written = z.total_out;
    inflateEnd(&z);
    return result == Z_STREAM_END && *written <= cap ? 0 : -1;
}

static int deflate_raw(const uint8_t *src, size_t size, uint8_t *dst,
                       size_t cap, size_t *written, int level, int mem_level) {
    if (size > UINT_MAX || cap > UINT_MAX) return -1;
    z_stream z = {0};
    if (deflateInit2(&z, level, Z_DEFLATED, -15, mem_level,
                     Z_DEFAULT_STRATEGY) != Z_OK) return -1;
    z.next_in = (Bytef *)src;
    z.avail_in = (uInt)size;
    z.next_out = dst;
    z.avail_out = (uInt)cap;
    int result = deflate(&z, Z_FINISH);
    *written = z.total_out;
    deflateEnd(&z);
    return result == Z_STREAM_END ? 0 : -1;
}

int raw_deflate_decode(const uint8_t *src, size_t size, uint8_t *dst,
                       size_t cap, size_t *written) {
    if (!src || !dst || !written) return -1;
    return inflate_raw(src, size, dst, cap, written);
}

int raw_deflate_encode(const uint8_t *src, size_t size, uint8_t *dst,
                       size_t cap, size_t *written) {
    if (!src || !dst || !written) return -1;
    return deflate_raw(src, size, dst, cap, written, 8, 6);
}

int rare1172_decode(const uint8_t *src, size_t size, uint8_t *dst,
                    size_t cap, size_t *written) {
    if (!src || !dst || !written || size < 2 || src[0] != 0x11 || src[1] != 0x72)
        return -1;
    return inflate_raw(src + 2, size - 2, dst, cap, written);
}

int rare1172_encode(const uint8_t *src, size_t size, uint8_t *dst,
                    size_t cap, size_t *written) {
    if (!src || !dst || !written || cap < 2) return -1;
    dst[0] = 0x11; dst[1] = 0x72;
    size_t payload;
    if (deflate_raw(src, size, dst + 2, cap - 2, &payload, 9, 5)) return -1;
    *written = payload + 2;
    return 0;
}

/* Banjo-Kazooie uses 1172 with a four-byte decoded size before the bitstream. */
int rare1172_u32_decode(const uint8_t *src, size_t size, uint8_t *dst,
                        size_t cap, size_t *written) {
    if (!src || !dst || !written || size < 6 || src[0] != 0x11 || src[1] != 0x72)
        return -1;
    size_t expected = (size_t)src[2] << 24 | (size_t)src[3] << 16 |
                      (size_t)src[4] << 8 | src[5];
    if (expected > cap || inflate_raw(src + 6, size - 6, dst, cap, written)) return -1;
    return *written == expected ? 0 : -1;
}

int rare1172_u32_encode(const uint8_t *src, size_t size, uint8_t *dst,
                        size_t cap, size_t *written) {
    if (!src || !dst || !written || size > UINT32_MAX || cap < 6) return -1;
    dst[0] = 0x11; dst[1] = 0x72;
    dst[2] = (uint8_t)(size >> 24);
    dst[3] = (uint8_t)(size >> 16);
    dst[4] = (uint8_t)(size >> 8);
    dst[5] = (uint8_t)size;
    size_t payload;
    if (deflate_raw(src, size, dst + 6, cap - 6, &payload, 9, 5)) return -1;
    *written = payload + 6;
    return 0;
}

int rare1173_decode(const uint8_t *src, size_t size, uint8_t *dst,
                    size_t cap, size_t *written) {
    if (!src || !dst || !written || size < 5 || src[0] != 0x11 || src[1] != 0x73)
        return -1;
    size_t expected = (size_t)src[2] << 16 | (size_t)src[3] << 8 | src[4];
    if (expected > cap || inflate_raw(src + 5, size - 5, dst, cap, written)) return -1;
    return *written == expected ? 0 : -1;
}

static int rare1173_encode_profile(const uint8_t *src, size_t size, uint8_t *dst,
                                   size_t cap, size_t *written, int mem_level) {
    if (!src || !dst || !written || size > 0xffffff || cap < 5) return -1;
    dst[0] = 0x11; dst[1] = 0x73;
    dst[2] = (uint8_t)(size >> 16);
    dst[3] = (uint8_t)(size >> 8);
    dst[4] = (uint8_t)size;
    size_t payload;
    if (deflate_raw(src, size, dst + 5, cap - 5, &payload, 9, mem_level)) return -1;
    *written = payload + 5;
    return 0;
}

int rare1173_encode(const uint8_t *src, size_t size, uint8_t *dst,
                    size_t cap, size_t *written) {
    return rare1173_encode_profile(src, size, dst, cap, written, 7);
}

/* Reproduces the retail byte count of the audited PD boot stream, not its bits. */
int rare1173_encode_retail_size(const uint8_t *src, size_t size, uint8_t *dst,
                                size_t cap, size_t *written) {
    return rare1173_encode_profile(src, size, dst, cap, written, 9);
}

/* Diddy Kong Racing / Jet Force Gemini: LE decoded size, level, raw DEFLATE.
 * The level byte is metadata; the game decoder skips it. Trailing archive
 * padding is accepted. The caller supplies all input/output storage; zlib
 * manages only its internal state.
 */
int rare_dkr_decode(const uint8_t *src, size_t size, uint8_t *dst,
                    size_t cap, size_t *written) {
    if (!src || !dst || !written || size < 5) return -1;
    size_t expected = (size_t)src[3] << 24 | src[2] << 16 | src[1] << 8 | src[0];
    if (expected > cap || inflate_raw(src + 5, size - 5, dst, expected, written))
        return -1;
    return *written == expected ? 0 : -1;
}

int rare_dkr_encode(const uint8_t *src, size_t size, uint8_t *dst,
                    size_t cap, size_t *written) {
    if (!src || !dst || !written || size > UINT32_MAX || cap < 5) return -1;
    size_t payload;
    if (deflate_raw(src, size, dst + 5, cap - 5, &payload, 9, 6)) return -1;
    dst[0] = size; dst[1] = size >> 8;
    dst[2] = size >> 16; dst[3] = size >> 24;
    dst[4] = 9;
    *written = payload + 5;
    return 0;
}
