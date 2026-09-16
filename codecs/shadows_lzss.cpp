/* Shadows of the Empire: LSB-first flags and absolute 4 KiB ring positions.
 * Return 0 on success, -1 on malformed input or insufficient output space.
 */
#include <cstddef>
#include <cstdint>
#include <vector>

int shadows_lzss_decode(const uint8_t *src, size_t size, uint8_t *dst,
                        size_t cap, size_t *written, size_t *consumed) {
    if (!src || !dst || !written || !consumed) return -1;
    uint8_t ring[4096] = {};
    size_t in = 0, out = 0;
    unsigned cursor = 1;
    while (in < size) {
        unsigned flags = src[in++];
        for (unsigned bit = 0; bit < 8; bit++) {
            if (flags & (1u << bit)) {
                if (in >= size || out >= cap) return -1;
                uint8_t byte = src[in++];
                dst[out++] = byte;
                ring[cursor++ & 4095] = byte;
            } else {
                if (size - in < 2) return -1;
                unsigned first = src[in++], position = ((first & 15) << 8) | src[in++];
                if (!position) { *written = out; *consumed = in; return 0; }
                unsigned count = (first >> 4) + 2;
                if (count > cap - out) return -1;
                for (unsigned j = 0; j < count; j++) {
                    uint8_t byte = ring[(position + j) & 4095];
                    dst[out++] = byte;
                    ring[cursor++ & 4095] = byte;
                }
            }
        }
    }
    return -1; /* missing position-zero terminator */
}

static unsigned hash3(const uint8_t *p) {
    return ((unsigned)p[0] * 251u + (unsigned)p[1] * 31u + p[2]) & 4095;
}

int shadows_lzss_encode(const uint8_t *src, size_t size, uint8_t *dst,
                        size_t cap, size_t *written) {
    if (!src || !dst || !written || size > 0x7fffffffu) return -1;
    std::vector<int32_t> head(4096, -1), prev(size, -1);
    size_t in = 0, out = 0, control = 0;
    unsigned bits = 8, flags = 0;
    auto token = [&](bool literal) {
        if (bits == 8) {
            if (out >= cap) return false;
            control = out++;
            flags = 0;
            bits = 0;
        }
        if (literal) flags |= 1u << bits;
        bits++;
        dst[control] = (uint8_t)flags;
        return true;
    };
    while (in < size) {
        unsigned best = 0, position = 0;
        if (size - in >= 3) {
            unsigned hash = hash3(src + in);
            int32_t at = head[hash];
            for (unsigned depth = 0; at >= 0 && depth < 128; depth++, at = prev[at]) {
                size_t old = (size_t)at;
                if (in - old > 4096) break;
                unsigned absolute = (unsigned)((old + 1) & 4095);
                if (!absolute) continue; /* zero is the end token */
                unsigned length = 0, limit = (unsigned)((size - in < 17) ? size - in : 17);
                while (length < limit && src[old + length] == src[in + length]) length++;
                if (length > best) { best = length; position = absolute; }
                if (best == 17) break;
            }
        }
        if (best >= 3) {
            if (!token(false) || cap - out < 2) return -1;
            dst[out++] = (uint8_t)(((best - 2) << 4) | (position >> 8));
            dst[out++] = (uint8_t)position;
        } else {
            best = 1;
            if (!token(true) || out >= cap) return -1;
            dst[out++] = src[in];
        }
        for (unsigned j = 0; j < best; j++) {
            size_t p = in + j;
            if (size - p >= 3) {
                unsigned hash = hash3(src + p);
                prev[p] = head[hash];
                head[hash] = (int32_t)p;
            }
        }
        in += best;
    }
    if (!token(false) || cap - out < 2) return -1;
    dst[out++] = 0;
    dst[out++] = 0;
    *written = out;
    return 0;
}
