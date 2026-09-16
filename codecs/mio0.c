/* MIO0 reference codec. Public-domain-style example; no game code is used.
 * Both functions return 0 on success and -1 for malformed input or short output.
 * The encoder uses one recent 3-byte match per hash bucket, not optimal parsing.
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

int mio0_decode(const uint8_t *src, size_t src_len, uint8_t *dst,
                size_t dst_cap, size_t *dst_len) {
    if (!src || !dst || !dst_len || src_len < 16 || memcmp(src, "MIO0", 4)) return -1;
    size_t size = BE32(src + 4), ctrl = 16;
    size_t link = BE32(src + 8), lit = BE32(src + 12), out = 0;
    if (size > dst_cap || link < 16 || lit < link || lit > src_len) return -1;
    uint32_t flags = 0;
    unsigned left = 0;
    while (out < size) {
        if (!left) {
            if (ctrl > link || link - ctrl < 4) return -1;
            flags = BE32(src + ctrl); ctrl += 4; left = 32;
        }
        if (flags & 0x80000000u) {
            if (lit >= src_len) return -1;
            dst[out++] = src[lit++];
        } else {
            if (link > lit || lit - link < 2) return -1;
            unsigned word = src[link] << 8 | src[link + 1]; link += 2;
            size_t distance = (word & 4095u) + 1u, count = (word >> 12) + 3u;
            if (distance > out || count > size - out) return -1;
            while (count--) { dst[out] = dst[out - distance]; out++; }
        }
        flags <<= 1; left--;
    }
    *dst_len = out;
    return 0;
}

/* The first pass counts the three streams; the second writes them in place. */
static void encode_pass(const uint8_t *src, size_t src_len, uint8_t *dst,
                        size_t link_at, size_t lit_at,
                        size_t *tokens_out, size_t *links_out, size_t *lits_out) {
    size_t last[4096];
    for (size_t k = 0; k < 4096; k++) last[k] = SIZE_MAX;
    size_t i = 0, tokens = 0, nl = 0, nb = 0;
    while (i < src_len) {
        size_t count = 0, distance = 0;
        if (i + 2 < src_len) {
            size_t prev = last[HASH3(src + i)];
            if (prev != SIZE_MAX && i - prev <= 4096) {
                while (count < 18 && i + count < src_len &&
                       src[prev + count] == src[i + count]) count++;
                if (count >= 3) distance = i - prev;
                else count = 0;
            }
        }
        if (count) {
            unsigned word = (count - 3) << 12 | (distance - 1);
            if (dst) { dst[link_at + nb] = word >> 8; dst[link_at + nb + 1] = word; }
            nb += 2;
        } else {
            if (dst) {
                dst[16 + tokens / 8] |= 0x80u >> (tokens % 8);
                dst[lit_at + nl] = src[i];
            }
            nl++; count = 1;
        }
        for (size_t j = 0; j < count; j++)
            if (i + j + 2 < src_len) last[HASH3(src + i + j)] = i + j;
        i += count; tokens++;
    }
    *tokens_out = tokens; *links_out = nb; *lits_out = nl;
}

int mio0_encode(const uint8_t *src, size_t src_len, uint8_t *dst,
                size_t dst_cap, size_t *dst_len) {
    if (!src || !dst || !dst_len || src_len > UINT32_MAX) return -1;
    size_t tokens, nb, nl;
    encode_pass(src, src_len, NULL, 0, 0, &tokens, &nb, &nl);
    size_t nc = ((tokens + 31) / 32) * 4;
    size_t total = 16 + nc + nb + nl;
    if (total > dst_cap || total > UINT32_MAX) return -1;
    memcpy(dst, "MIO0", 4); PUT32(dst + 4, src_len);
    PUT32(dst + 8, 16 + nc); PUT32(dst + 12, 16 + nc + nb);
    memset(dst + 16, 0, nc);
    encode_pass(src, src_len, dst, 16 + nc, 16 + nc + nb, &tokens, &nb, &nl);
    *dst_len = total;
    return 0;
}
