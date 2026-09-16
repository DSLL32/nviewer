/* MIO0 reference codec. Public-domain-style example; no game code is used.
 * Both functions return 0 on success and -1 for malformed input or short output.
 */
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <array>
#include <new>
#include <stdexcept>
#include <vector>

extern "C" {

#define BE32(p) ((uint32_t)(p)[0] << 24 | (p)[1] << 16 | (p)[2] << 8 | (p)[3])
#define PUT32(p, value) do { \
    uint32_t n_ = (value); \
    (p)[0] = n_ >> 24; (p)[1] = n_ >> 16; \
    (p)[2] = n_ >> 8; (p)[3] = n_; \
} while (0)

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

int mio0_encode(const uint8_t *src, size_t src_len, uint8_t *dst,
                size_t dst_cap, size_t *dst_len) try {
    if (!src || !dst || !dst_len || src_len > UINT32_MAX ||
        src_len > SIZE_MAX / sizeof(uint64_t) - 1) return -1;
    constexpr uint32_t absent = UINT32_MAX;
    std::array<uint32_t, 65536> head;
    head.fill(absent);
    std::vector<uint32_t> prev(src_len, absent);
    std::vector<uint8_t> longest(src_len, 0);
    std::vector<uint16_t> distance(src_len, 0);
    for (size_t i = 0; i + 2 < src_len; i++) {
        uint32_t bytes = (uint32_t(src[i]) << 16) | (uint32_t(src[i + 1]) << 8) | src[i + 2];
        unsigned hash = (bytes * 0x1e35a7bdu) >> 16;
        uint32_t candidate = head[hash];
        unsigned limit = unsigned(src_len - i < 18 ? src_len - i : 18);
        unsigned best = 0;
        for (; candidate != absent && i - candidate <= 4096;
             candidate = prev[candidate]) {
            unsigned length = 0;
            while (length < limit && src[candidate + length] == src[i + length]) length++;
            if (length > best) {
                best = length;
                distance[i] = uint16_t(i - candidate);
                if (best == limit) break;
            }
        }
        longest[i] = best >= 3 ? best : 0;
        prev[i] = head[hash];
        head[hash] = uint32_t(i);
    }

    // A control bit costs 1/8 byte. Rounding the final control word changes
    // the estimate by less than four bytes.
    std::vector<uint64_t> cost(src_len + 1, 0);
    std::vector<uint8_t> choice(src_len, 1);
    for (size_t i = src_len; i-- > 0;) {
        uint64_t best = 9 + cost[i + 1];
        for (unsigned length = 3; length <= longest[i]; length++) {
            uint64_t trial = 17 + cost[i + length];
            if (trial <= best) { best = trial; choice[i] = uint8_t(length); }
        }
        cost[i] = best;
    }
    size_t tokens = 0, nb = 0, nl = 0;
    for (size_t i = 0; i < src_len; i += choice[i]) {
        unsigned length = choice[i];
        tokens++;
        if (length == 1) nl++; else nb += 2;
    }
    size_t nc = ((tokens + 31) / 32) * 4;
    size_t total = 16 + nc + nb + nl;
    if (total > dst_cap || total > UINT32_MAX) return -1;
    memcpy(dst, "MIO0", 4); PUT32(dst + 4, src_len);
    PUT32(dst + 8, 16 + nc); PUT32(dst + 12, 16 + nc + nb);
    memset(dst + 16, 0, nc);
    size_t link = 16 + nc, lit = link + nb, token = 0;
    for (size_t i = 0; i < src_len; i += choice[i], token++) {
        unsigned length = choice[i];
        if (length == 1) {
            dst[16 + token / 8] |= 0x80u >> (token % 8);
            dst[lit++] = src[i];
        } else {
            unsigned word = (length - 3) << 12 | (distance[i] - 1);
            dst[link++] = word >> 8;
            dst[link++] = word;
        }
    }
    *dst_len = total;
    return 0;
} catch (const std::bad_alloc &) {
    return -1;
} catch (const std::length_error &) {
    return -1;
}

} /* extern "C" */
