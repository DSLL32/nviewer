/* Glover FLA2. The stream is eight-byte header plus MSB-first LZSS tokens.
 * A 64-byte zero pad belongs to the ROM file layout, not the stream itself.
 */
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <vector>

extern "C" {

int fla2_decode(const uint8_t *src, size_t size, uint8_t *dst, size_t cap,
                size_t *written, size_t *consumed) {
    if (!src || !written || !consumed || size < 10 ||
        std::memcmp(src, "FLA2", 4)) return -1;
    size_t need = size_t(src[4]) | size_t(src[5]) << 8 |
                  size_t(src[6]) << 16 | size_t(src[7]) << 24;
    if (need > cap || (need && !dst)) return -1;
    uint8_t ring[4096] = {};
    size_t in = 8, out = 0;
    unsigned cursor = 0;
    for (;;) {
        if (in == size) return -1;
        unsigned flags = src[in++];
        for (unsigned bit = 0; bit < 8; bit++) {
            if (flags & (0x80u >> bit)) {
                if (in == size) return -1;
                unsigned first = src[in++];
                if (!first) {
                    if (out != need) return -1;
                    *written = out;
                    *consumed = in;
                    return 0;
                }
                if (in == size) return -1;
                unsigned second = src[in++];
                unsigned distance = (first & 0xf0u) << 4 | second;
                unsigned length = (first & 15u) + 2;
                if (length > need - out) return -1;
                for (unsigned j = 0; j < length; j++) {
                    uint8_t value = ring[(cursor - distance) & 4095];
                    dst[out++] = value;
                    ring[cursor++ & 4095] = value;
                }
            } else {
                if (in == size || out == need) return -1;
                uint8_t value = src[in++];
                dst[out++] = value;
                ring[cursor++ & 4095] = value;
            }
        }
    }
}

int fla2_encode_depth(const uint8_t *src, size_t size, uint8_t *dst, size_t cap,
                      size_t *written, unsigned depth) {
    if ((!src && size) || !dst || !written || size > INT32_MAX || !depth)
        return -1;
    try {
        struct Match { uint16_t length, distance, two_distance; };
        std::vector<Match> matches(size);
        std::vector<int32_t> previous(size);
        std::vector<int32_t> head(65536, -1);
        for (size_t pos = 0; pos < size; pos++) {
            Match best{};
            unsigned limit = unsigned(size - pos < 17 ? size - pos : 17);
            if (limit >= 2) {
                unsigned key = unsigned(src[pos]) << 8 | src[pos + 1];
                int32_t at = head[key];
                for (unsigned n = 0; n < depth && at >= 0 &&
                     pos - size_t(at) <= 4096; n++, at = previous[at]) {
                    unsigned distance = unsigned(pos - size_t(at));
                    unsigned length = 2;
                    while (length < limit && src[at + length] == src[pos + length])
                        length++;
                    if (distance >= 256 && distance < 4096 && !best.two_distance)
                        best.two_distance = uint16_t(distance);
                    if (length > best.length) {
                        best.length = uint16_t(length);
                        best.distance = uint16_t(distance);
                    }
                    if (best.length == 17 && best.two_distance) break;
                }
                previous[pos] = head[key];
                head[key] = int32_t(pos);
            }
            // Before the ring is filled, unwritten bytes are zero. A source
            // within 17 bytes of the write cursor can enter written history
            // while the match is copied; a farther source remains all zero.
            if (pos < 4096 && limit >= 2 && src[pos] == 0) {
                size_t last = pos + 17 < 4096 ? pos + 17 : 4096;
                auto examine = [&](unsigned distance) {
                    unsigned length = 0;
                    while (length < limit) {
                        ptrdiff_t from = ptrdiff_t(pos + length) - distance;
                        uint8_t value = from < 0 ? 0 : src[size_t(from)];
                        if (value != src[pos + length]) break;
                        length++;
                    }
                    if (length >= 2 && distance >= 256 && distance < 4096 && !best.two_distance)
                        best.two_distance = uint16_t(distance);
                    if (length > best.length) {
                        best.length = uint16_t(length);
                        best.distance = uint16_t(distance);
                    }
                };
                for (size_t d = pos + 1; d <= last; d++) examine(unsigned(d));
                if (last != 4096) examine(4096);
            }
            matches[pos] = best;
        }

        // Exact byte cost, including each group of eight flags and the final
        // one-byte terminator. Phase is tokens consumed in the current group.
        std::vector<uint32_t> cost((size + 1) * 8);
        for (unsigned phase = 0; phase < 8; phase++)
            cost[size * 8 + phase] = 1 + (phase == 0);
        for (size_t pos = size; pos-- > 0;) {
            const Match &m = matches[pos];
            for (unsigned phase = 0; phase < 8; phase++) {
                unsigned next = (phase + 1) & 7;
                uint32_t best = 1 + cost[(pos + 1) * 8 + next];
                if (m.two_distance) {
                    uint32_t candidate = 2 + cost[(pos + 2) * 8 + next];
                    if (candidate < best) best = candidate;
                }
                for (unsigned length = 3; length <= m.length; length++) {
                    uint32_t candidate = 2 + cost[(pos + length) * 8 + next];
                    if (candidate < best) best = candidate;
                }
                cost[pos * 8 + phase] = best + (phase == 0);
            }
        }
        if (cap < 8 || cost[0] > cap - 8) return -1;
        std::memcpy(dst, "FLA2", 4);
        for (unsigned i = 0; i < 4; i++) dst[4 + i] = uint8_t(size >> (i * 8));
        size_t in = 0, out = 8, flag_at = 0;
        unsigned phase = 0, flags = 0;
        for (;;) {
            if (!phase) { flag_at = out++; flags = 0; }
            if (in == size) {
                flags |= 0x80u >> phase;
                dst[out++] = 0;
                dst[flag_at] = uint8_t(flags);
                *written = out;
                return 0;
            }
            const Match &m = matches[in];
            unsigned next = (phase + 1) & 7;
            unsigned length = 1;
            uint32_t best = 1 + cost[(in + 1) * 8 + next];
            if (m.two_distance) {
                uint32_t candidate = 2 + cost[(in + 2) * 8 + next];
                if (candidate < best) { best = candidate; length = 2; }
            }
            for (unsigned n = 3; n <= m.length; n++) {
                uint32_t candidate = 2 + cost[(in + n) * 8 + next];
                if (candidate < best || (candidate == best && length > 1 && n > length)) {
                    best = candidate;
                    length = n;
                }
            }
            if (length == 1) dst[out++] = src[in];
            else {
                flags |= 0x80u >> phase;
                unsigned distance = length == 2 ? m.two_distance : m.distance;
                dst[out++] = uint8_t(((distance >> 8) << 4) | (length - 2));
                dst[out++] = uint8_t(distance);
            }
            in += length;
            phase = next;
            if (phase == 0) dst[flag_at] = uint8_t(flags);
        }
    } catch (...) {
        return -1;
    }
}

int fla2_encode(const uint8_t *src, size_t size, uint8_t *dst, size_t cap,
                size_t *written) {
    return fla2_encode_depth(src, size, dst, cap, written, 4096);
}

} // extern "C"
