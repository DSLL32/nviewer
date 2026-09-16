/* RFC 1951 raw DEFLATE and Rare's 1172/1173 wrappers. Link with -lz.
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
    z.next_out = dst;
    z.avail_out = (uInt)cap;
    int result = inflate(&z, Z_FINISH);
    *written = z.total_out;
    inflateEnd(&z);
    return result == Z_STREAM_END ? 0 : -1;
}

static int deflate_raw(const uint8_t *src, size_t size, uint8_t *dst,
                       size_t cap, size_t *written) {
    if (size > UINT_MAX || cap > UINT_MAX) return -1;
    z_stream z = {0};
    if (deflateInit2(&z, Z_DEFAULT_COMPRESSION, Z_DEFLATED, -15, 8,
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
    return deflate_raw(src, size, dst, cap, written);
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
    if (deflate_raw(src, size, dst + 2, cap - 2, &payload)) return -1;
    *written = payload + 2;
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

int rare1173_encode(const uint8_t *src, size_t size, uint8_t *dst,
                    size_t cap, size_t *written) {
    if (!src || !dst || !written || size > 0xffffff || cap < 5) return -1;
    dst[0] = 0x11; dst[1] = 0x73;
    dst[2] = (uint8_t)(size >> 16);
    dst[3] = (uint8_t)(size >> 8);
    dst[4] = (uint8_t)size;
    size_t payload;
    if (deflate_raw(src, size, dst + 5, cap - 5, &payload)) return -1;
    *written = payload + 5;
    return 0;
}
