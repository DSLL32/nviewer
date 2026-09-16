/* The two Rush LZSS variants share flags and token bytes but address matches
 * differently: Rush 1 uses an absolute 4 KiB ring; Rush 2049 uses a backward
 * output distance. Both end with a zero match. No allocation is needed.
 */
#include <stddef.h>
#include <stdint.h>

static int decode(const uint8_t *src, size_t size, uint8_t *dst,
                  size_t cap, size_t *written, int ring_mode) {
    if (!src || !dst || !written) return -1;
    uint8_t ring[4096] = {0};
    size_t in = 0, out = 0, ring_at = 1;
    while (in < size) {
        unsigned flags = src[in++];
        for (unsigned bit = 0; bit < 8; bit++) {
            if (flags & (1u << bit)) {
                if (in == size || out == cap) return -1;
                uint8_t value = src[in++];
                dst[out++] = value;
                ring[ring_at++ & 4095] = value;
            } else {
                if (size - in < 2) return -1;
                unsigned a = src[in++], b = src[in++];
                size_t address = (a & 0xf0u) << 4 | b;
                size_t length = (a & 15u) + 2;
                if (address == 0 && length == 2) {
                    *written = out;
                    return 0;
                }
                if (length > cap - out || (!ring_mode && (!address || address > out))) return -1;
                for (size_t j = 0; j < length; j++) {
                    uint8_t value = ring_mode ? ring[(address + j) & 4095]
                                              : dst[out - address];
                    dst[out++] = value;
                    ring[ring_at++ & 4095] = value;
                }
            }
        }
    }
    return -1;
}

int rush1_lzss_decode(const uint8_t *src, size_t size, uint8_t *dst,
                      size_t cap, size_t *written) {
    return decode(src, size, dst, cap, written, 1);
}

int rush2049_lzss_decode(const uint8_t *src, size_t size, uint8_t *dst,
                         size_t cap, size_t *written) {
    return decode(src, size, dst, cap, written, 0);
}

#define HASH3(p) (((p)[0] * 251u + (p)[1] * 31u + (p)[2]) & 4095u)

/* One recent three-byte candidate per bucket keeps the search bounded. */
static int encode(const uint8_t *src, size_t size, uint8_t *dst,
                  size_t cap, size_t *written, int ring_mode) {
    if (!src || !dst || !written) return -1;
    size_t last[4096];
    for (size_t i = 0; i < 4096; i++) last[i] = SIZE_MAX;
    size_t in = 0, out = 0;
    for (;;) {
        if (out == cap) return -1;
        size_t flag_at = out++;
        unsigned flags = 0;
        for (unsigned bit = 0; bit < 8; bit++) {
            if (in == size) {
                if (cap - out < 2) return -1;
                dst[out++] = 0; dst[out++] = 0;
                dst[flag_at] = (uint8_t)flags;
                *written = out;
                return 0;
            }
            size_t count = 0, prev = SIZE_MAX;
            if (size - in >= 3) {
                prev = last[HASH3(src + in)];
                if (prev != SIZE_MAX && in - prev <= 4095) {
                    while (count < 17 && count < size - in &&
                           src[prev + count] == src[in + count]) count++;
                    if (count < 3) count = 0;
                }
            }
            if (count) {
                if (cap - out < 2) return -1;
                unsigned address = ring_mode ? (unsigned)((prev + 1) & 4095)
                                             : (unsigned)(in - prev);
                dst[out++] = (uint8_t)((address >> 4 & 0xf0u) | (count - 2));
                dst[out++] = (uint8_t)address;
            } else {
                if (out == cap) return -1;
                flags |= 1u << bit;
                dst[out++] = src[in];
                count = 1;
            }
            for (size_t j = 0; j < count; j++)
                if (size - (in + j) >= 3) last[HASH3(src + in + j)] = in + j;
            in += count;
        }
        dst[flag_at] = (uint8_t)flags;
    }
}

int rush1_lzss_encode(const uint8_t *src, size_t size, uint8_t *dst,
                      size_t cap, size_t *written) {
    return encode(src, size, dst, cap, written, 1);
}

int rush2049_lzss_encode(const uint8_t *src, size_t size, uint8_t *dst,
                         size_t cap, size_t *written) {
    return encode(src, size, dst, cap, written, 0);
}
