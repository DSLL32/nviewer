/* Yoshi's Story SMSR00 slide-LZ, optionally wrapped in CMPR. No allocation. */
#include <stddef.h>
#include <stdint.h>
#include <string.h>

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
    size_t ctrl = 16, out = 0;
    unsigned flags = 0, left = 0;
    while (out < decoded) {
        if (!left) {
            if (ctrl > lit_at || lit_at - ctrl < 2) return -1;
            flags = src[ctrl] << 8 | src[ctrl + 1]; ctrl += 2; left = 16;
        }
        if (flags & 0x8000u) {
            if (lit_at == size) return -1;
            dst[out++] = src[lit_at++];
        } else {
            if (ctrl > lit_at || lit_at - ctrl < 2) return -1;
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

#define HASH3(p) (((p)[0] * 251u + (p)[1] * 31u + (p)[2]) & 4095u)

static void encode_pass(const uint8_t *src, size_t size, uint8_t *dst,
                        size_t literal_at, size_t *controls, size_t *literals) {
    size_t last[4096];
    for (size_t k = 0; k < 4096; k++) last[k] = SIZE_MAX;
    size_t in = 0, ctrl = 0, lit = 0, tokens = 0, flag_at = 0;
    while (in < size) {
        if (tokens % 16 == 0) {
            flag_at = ctrl;
            if (dst) dst[16 + ctrl] = dst[17 + ctrl] = 0;
            ctrl += 2;
        }
        size_t count = 0, prev = SIZE_MAX;
        if (size - in >= 3) {
            prev = last[HASH3(src + in)];
            if (prev != SIZE_MAX && in - prev <= 4096) {
                while (count < 18 && count < size - in &&
                       src[prev + count] == src[in + count]) count++;
                if (count < 3) count = 0;
            }
        }
        if (count) {
            unsigned word = (unsigned)((count - 3) << 12 | (in - prev - 1));
            if (dst) { dst[16 + ctrl] = (uint8_t)(word >> 8); dst[17 + ctrl] = (uint8_t)word; }
            ctrl += 2;
        } else {
            if (dst) {
                size_t bit = 15 - tokens % 16;
                dst[16 + flag_at + (bit < 8)] |= 1u << (bit % 8);
                dst[literal_at + lit] = src[in];
            }
            lit++; count = 1;
        }
        for (size_t j = 0; j < count; j++)
            if (size - (in + j) >= 3) last[HASH3(src + in + j)] = in + j;
        in += count; tokens++;
    }
    *controls = ctrl; *literals = lit;
}

int smsr_encode(const uint8_t *src, size_t size, uint8_t *dst,
                size_t cap, size_t *written) {
    if (!src || !dst || !written || size > UINT32_MAX) return -1;
    size_t controls, literals;
    encode_pass(src, size, NULL, 0, &controls, &literals);
    if (controls > UINT32_MAX || cap < 16 || controls > cap - 16 ||
        literals > cap - 16 - controls) return -1;
    memcpy(dst, "SMSR00\0\0", 8);
    PUT32(dst + 8, size); PUT32(dst + 12, controls);
    encode_pass(src, size, dst, 16 + controls, &controls, &literals);
    *written = 16 + controls + literals;
    return 0;
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
