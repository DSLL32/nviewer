/* The two Rush LZSS variants share flags and token bytes but address matches
 * differently: Rush 1 uses an absolute 4 KiB ring; Rush 2049 uses a backward
 * output distance. Both end with a zero match.
 */
#include <stddef.h>
#include <stdint.h>
#include <array>
#include <vector>

extern "C" {

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

static int encode_impl(const uint8_t *src, size_t size, uint8_t *dst,
                       size_t cap, size_t *written, int ring_mode) {
    if (!src || !dst || !written) return -1;
    if (size > SIZE_MAX / 8 - 1 || size > UINT32_MAX / 2 - 2) return -1;
    struct Match { uint16_t length, distance, two_distance; };
    std::vector<Match> matches(size);
    std::array<size_t, 65536> last3, last2;
    std::array<size_t, 4096> chain3, chain2;
    last3.fill(SIZE_MAX);
    last2.fill(SIZE_MAX);
    const size_t window = ring_mode ? 4096 : 4095;
    for (size_t pos = 0; pos < size; pos++) {
        Match best{};
        size_t remaining = size - pos;
        if (remaining >= 2) {
            unsigned key2 = unsigned(src[pos]) << 8 | src[pos + 1];
            size_t prev = last2[key2];
            while (prev != SIZE_MAX && pos - prev <= window) {
                size_t distance = pos - prev;
                unsigned address = ring_mode ? unsigned((pos - distance + 1) & 4095)
                                             : unsigned(distance);
                if (address) { best.two_distance = uint16_t(distance); break; }
                prev = chain2[prev & 4095];
            }
            chain2[pos & 4095] = last2[key2];
            last2[key2] = pos;
        }
        if (remaining >= 3) {
            unsigned key3 = ((unsigned(src[pos]) << 8 | src[pos + 1]) ^
                             unsigned(src[pos + 2]) * 251u) & 65535u;
            size_t prev = last3[key3];
            while (prev != SIZE_MAX && pos - prev <= window) {
                size_t length = 0;
                size_t limit = remaining < 17 ? remaining : 17;
                while (length < limit && src[prev + length] == src[pos + length]) length++;
                if (length > best.length) {
                    best.length = uint16_t(length);
                    best.distance = uint16_t(pos - prev);
                    if (length == 17) break;
                }
                prev = chain3[prev & 4095];
            }
            chain3[pos & 4095] = last3[key3];
            last3[key3] = pos;
        }
        // For the first 4096 bytes, a match can begin in an unwritten (zero)
        // ring cell, then wrap into earlier output or its own copy. Distances
        // with more than 16 leading zeros cannot beat a 17-byte zero match,
        // so examine the nearby transitions plus the farthest zero run.
        if (ring_mode && pos < 4096 && remaining >= 2 && src[pos] == 0) {
            size_t last = pos + 16 < 4096 ? pos + 16 : 4096;
            auto examine = [&](size_t distance) {
                size_t length = 0, limit = remaining < 17 ? remaining : 17;
                while (length < limit) {
                    ptrdiff_t source = ptrdiff_t(pos + length) - ptrdiff_t(distance);
                    uint8_t value = source < 0 ? 0 : src[size_t(source)];
                    if (value != src[pos + length]) break;
                    length++;
                }
                if (length > best.length && length >= 3) {
                    best.length = uint16_t(length);
                    best.distance = uint16_t(distance);
                }
                if (length >= 2 && !best.two_distance && ((pos - distance + 1) & 4095))
                    best.two_distance = uint16_t(distance);
            };
            for (size_t distance = pos + 1; distance <= last; distance++)
                examine(distance);
            if (last != 4096) examine(4096);
        }
        matches[pos] = best;
    }

    // The state is the number of tokens already assigned to the current flag
    // byte. This accounts exactly for the extra byte at every eighth token.
    std::vector<uint32_t> cost((size + 1) * 8);
    for (unsigned phase = 0; phase < 8; phase++)
        cost[size * 8 + phase] = 2 + (phase == 0);
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
    if (cost[0] > cap) return -1;

    size_t in = 0, out = 0;
    unsigned phase = 0, flags = 0;
    size_t flag_at = 0;
    for (;;) {
        if (phase == 0) { flag_at = out++; flags = 0; }
        if (in == size) {
            dst[out++] = 0; dst[out++] = 0;
            dst[flag_at] = uint8_t(flags);
            *written = out;
            return 0;
        }
        const Match &m = matches[in];
        unsigned next = (phase + 1) & 7;
        size_t length = 1;
        uint32_t best = 1 + cost[(in + 1) * 8 + next];
        if (m.two_distance) {
            uint32_t candidate = 2 + cost[(in + 2) * 8 + next];
            if (candidate < best) { best = candidate; length = 2; }
        }
        for (unsigned n = 3; n <= m.length; n++) {
            uint32_t candidate = 2 + cost[(in + n) * 8 + next];
            if (candidate < best || (candidate == best && length > 1 && n > length)) {
                best = candidate; length = n;
            }
        }
        if (length == 1) {
            flags |= 1u << phase;
            dst[out++] = src[in];
        } else {
            unsigned distance = length == 2 ? m.two_distance : m.distance;
            unsigned address = ring_mode ? unsigned((in - distance + 1) & 4095) : distance;
            dst[out++] = uint8_t((address >> 4 & 0xf0u) | (length - 2));
            dst[out++] = uint8_t(address);
        }
        in += length;
        phase = next;
        if (phase == 0) dst[flag_at] = uint8_t(flags);
    }
}

static int encode(const uint8_t *src, size_t size, uint8_t *dst,
                  size_t cap, size_t *written, int ring_mode) {
    try {
        return encode_impl(src, size, dst, cap, written, ring_mode);
    } catch (...) {
        // Allocation failure must not unwind through the C entry points.
        return -1;
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

} /* extern "C" */
