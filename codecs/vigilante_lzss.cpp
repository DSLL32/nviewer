/* Vigilante 8 / 2nd Offense LZSS. Wrapper: "LZSS", u32le output size. */
#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

int vigilante_lzss_decode(const uint8_t *src, size_t size, uint8_t *dst,
                         size_t cap, size_t *written) {
    if (!src || !dst || !written || size < 8 ||
        src[0] != 'L' || src[1] != 'Z' || src[2] != 'S' || src[3] != 'S') return -1;
    size_t expected = uint32_t(src[4]) | uint32_t(src[5]) << 8 |
                      uint32_t(src[6]) << 16 | uint32_t(src[7]) << 24;
    if (expected > cap) return -1;
    std::array<uint8_t, 2048> ring{};
    size_t in = 8, out = 0, write = 0;
    while (out < expected) {
        if (in == size) return -1;
        unsigned flags = src[in++];
        for (unsigned bit = 0; bit < 8 && out < expected; bit++) {
            if (flags & (0x80u >> bit)) {
                if (in == size) return -1;
                uint8_t c = src[in++];
                dst[out++] = c;
                ring[write++ & 2047] = c;
            } else {
                if (size - in < 2) return -1;
                unsigned token = src[in] | unsigned(src[in + 1]) << 8;
                in += 2;
                unsigned pos = token >> 5, count = (token & 31) + 2;
                while (count-- && out < expected) {
                    uint8_t c = ring[pos++ & 2047];
                    dst[out++] = c;
                    ring[write++ & 2047] = c;
                }
            }
        }
    }
    if (in != size) return -1;
    *written = out;
    return 0;
}

int vigilante_lzss_encode_ex(const uint8_t *src, size_t size, uint8_t *dst,
                            size_t cap, size_t *written, unsigned effort) {
    if (!src || !dst || !written || size > 0x1fffffffu) return -1;
    constexpr size_t window = 2048, max_length = 33;
    constexpr unsigned depths[] = {1, 2, 4, 8, 16, 32, 64, 128, 512, 2048};
    const unsigned depth = depths[effort < 10 ? effort : 9];
    struct Match { uint16_t source; uint8_t length; };
    std::vector<Match> matches(size);
    std::array<size_t, 65536> head;
    std::array<size_t, window> chain;
    head.fill(SIZE_MAX);
    for (size_t i = 0; i < size; i++) {
        unsigned limit = (unsigned)(size - i < max_length ? size - i : max_length);
        Match best{0, 0};
        // Unwritten history is zero. Do not cross the first ring wrap.
        if (src[i] == 0 && i < window) {
            unsigned n = 1;
            while (n < limit && n < window - i && src[i + n] == 0) n++;
            if (n >= 2) best = {uint16_t(i), uint8_t(n)};
        }
        if (size - i >= 2) {
            unsigned hash = unsigned(src[i]) << 8 | src[i + 1];
            size_t prev = head[hash];
            for (unsigned seen = 0; seen < depth && prev != SIZE_MAX &&
                 i - prev <= window && best.length < limit; seen++) {
                unsigned n = 2;
                while (n < limit && src[prev + n] == src[i + n]) n++;
                if (n > best.length) best = {uint16_t(prev & 2047), uint8_t(n)};
                prev = chain[prev & 2047];
            }
            chain[i & 2047] = head[hash];
            head[hash] = i;
        }
        matches[i] = best;
    }
    // Eight DP states per output position account for the flag-byte cost.
    std::vector<uint32_t> cost((size + 1) * 8);
    std::vector<uint8_t> choice(size * 8);
    for (size_t i = size; i-- > 0;) {
        for (unsigned phase = 0; phase < 8; phase++) {
            unsigned next = (phase + 1) & 7;
            uint32_t best = (phase == 0) + 1 + cost[(i + 1) * 8 + next];
            uint8_t length = 1;
            for (unsigned n = 2; n <= matches[i].length; n++) {
                uint32_t candidate = (phase == 0) + 2 + cost[(i + n) * 8 + next];
                if (candidate < best || (candidate == best && n > length)) {
                    best = candidate;
                    length = uint8_t(n);
                }
            }
            cost[i * 8 + phase] = best;
            choice[i * 8 + phase] = length;
        }
    }
    if (cap < 8 || cost[0] > cap - 8) return -1;
    dst[0] = 'L'; dst[1] = 'Z'; dst[2] = 'S'; dst[3] = 'S';
    for (unsigned j = 0; j < 4; j++) dst[4 + j] = uint8_t(size >> (8 * j));
    size_t in = 0, out = 8, flag_at = 0;
    unsigned phase = 0;
    uint8_t flags = 0;
    while (in < size) {
        if (phase == 0) { flag_at = out++; flags = 0; }
        unsigned n = choice[in * 8 + phase];
        if (n == 1) {
            flags |= uint8_t(0x80u >> phase);
            dst[out++] = src[in];
        } else {
            unsigned token = (unsigned(matches[in].source) << 5) | (n - 2);
            dst[out++] = uint8_t(token);
            dst[out++] = uint8_t(token >> 8);
        }
        in += n;
        phase = (phase + 1) & 7;
        if (phase == 0 || in == size) dst[flag_at] = flags;
    }
    *written = out;
    return 0;
}

int vigilante_lzss_encode(const uint8_t *src, size_t size, uint8_t *dst,
                         size_t cap, size_t *written) {
    return vigilante_lzss_encode_ex(src, size, dst, cap, written, 9);
}
