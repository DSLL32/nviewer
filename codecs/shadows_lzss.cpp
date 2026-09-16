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

int shadows_lzss_encode(const uint8_t *src, size_t size, uint8_t *dst,
                        size_t cap, size_t *written) {
    if (!src || !dst || !written || size > 0x7fffffffu) return -1;
    // Search the full written history for two-byte and longer matches. Keeping all
    // positions in the chain makes this independent of the eventual parse.
    std::vector<int32_t> head(65536, -1), prev(size, -1);
    for (size_t p = 0; size - p >= 2; p++) {
        unsigned hash = (unsigned)src[p] << 8 | src[p + 1];
        prev[p] = head[hash];
        head[hash] = (int32_t)p;
    }
    struct Match { uint16_t position; uint8_t length; };
    std::vector<Match> parse(size);
    std::vector<size_t> cost(size + 1);
    // A literal costs nine bits and a match costs seventeen, including its
    // flag. Rounding the total up to bytes exactly accounts for flag groups.
    cost[size] = 17; // final position-zero token
    for (size_t p = size; p-- > 0;) {
        cost[p] = 9 + cost[p + 1];
        parse[p] = {0, 1};
        unsigned best = 1, limit = (unsigned)((size - p < 17) ? size - p : 17);
        for (int32_t at = prev[p]; at >= 0 && best < limit; at = prev[at]) {
            size_t old = (size_t)at;
            if (p - old > 4096) break;
            unsigned position = (unsigned)((old + 1) & 4095);
            if (!position) continue; // zero is the end token
            if (best >= 2 && src[old + best] != src[p + best]) continue;
            unsigned length = 2;
            while (length < limit && src[old + length] == src[p + length]) length++;
            for (unsigned n = best + 1; n <= length; n++) {
                size_t candidate = 17 + cost[p + n];
                if (candidate <= cost[p]) {
                    cost[p] = candidate;
                    parse[p] = {(uint16_t)position, (uint8_t)n};
                }
            }
            if (length > best) best = length;
        }
    }
    if ((cost[0] + 7) / 8 > cap) return -1;
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
        unsigned best = parse[in].length, position = parse[in].position;
        if (best >= 2) {
            if (!token(false) || cap - out < 2) return -1;
            dst[out++] = (uint8_t)(((best - 2) << 4) | (position >> 8));
            dst[out++] = (uint8_t)position;
        } else {
            if (!token(true) || out >= cap) return -1;
            dst[out++] = src[in];
        }
        in += best;
    }
    if (!token(false) || cap - out < 2) return -1;
    dst[out++] = 0;
    dst[out++] = 0;
    *written = out;
    return 0;
}
