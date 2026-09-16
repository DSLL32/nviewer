/* Yaz0 reference codec. Both functions return 0 on success, -1 on error. */
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <algorithm>
#include <array>
#include <new>
#include <stdexcept>
#include <vector>

namespace {

// The tree holds suffix costs for the next 512 positions. Every match ends at
// most 273 bytes ahead, so old values can be overwritten as parsing goes back.
struct SuffixMin {
    static constexpr unsigned span = 512;
    std::array<uint64_t, span * 2> tree{};

    SuffixMin() { tree.fill(UINT64_MAX); }

    void set(size_t pos, uint64_t cost) {
        unsigned at = span + (unsigned(pos) & (span - 1));
        tree[at] = cost << 9 | (unsigned(pos) & (span - 1));
        while (at > 1) {
            at >>= 1;
            tree[at] = std::min(tree[at * 2], tree[at * 2 + 1]);
        }
    }

    uint64_t part(unsigned first, unsigned last) const {
        uint64_t best = UINT64_MAX;
        for (first += span, last += span; first < last; first >>= 1, last >>= 1) {
            if (first & 1) best = std::min(best, tree[first++]);
            if (last & 1) best = std::min(best, tree[--last]);
        }
        return best;
    }

    uint64_t get(size_t first, size_t last) const { // inclusive positions
        unsigned a = unsigned(first) & (span - 1);
        unsigned b = unsigned(last) & (span - 1);
        if (a <= b) return part(a, b + 1);
        return std::min(part(a, span), part(0, b + 1));
    }

    static unsigned length(uint64_t packed, size_t from, unsigned minimum) {
        // A queried interval is shorter than 512, so the leaf index uniquely
        // identifies the absolute suffix position in that interval.
        unsigned first = (unsigned(from) + minimum) & (span - 1);
        return minimum + ((unsigned(packed) - first) & (span - 1));
    }
};

} // namespace

extern "C" {

#define BE32(p) ((uint32_t)(p)[0] << 24 | (p)[1] << 16 | (p)[2] << 8 | (p)[3])
#define PUT32(p, value) do { \
    uint32_t n_ = (value); \
    (p)[0] = n_ >> 24; (p)[1] = n_ >> 16; \
    (p)[2] = n_ >> 8; (p)[3] = n_; \
} while (0)

int yaz0_decode(const uint8_t *src, size_t src_len, uint8_t *dst,
                size_t dst_cap, size_t *dst_len) {
    if (!src || !dst || !dst_len || src_len < 16 || memcmp(src, "Yaz0", 4)) return -1;
    size_t size = BE32(src + 4), in = 16, out = 0;
    if (size > dst_cap) return -1;
    unsigned flags = 0, left = 0;
    while (out < size) {
        if (!left) { if (in == src_len) return -1; flags = src[in++]; left = 8; }
        if (flags & 0x80u) {
            if (in == src_len) return -1;
            dst[out++] = src[in++];
        } else {
            if (in > src_len || src_len - in < 2) return -1;
            unsigned a = src[in++], b = src[in++];
            size_t distance = ((a & 15u) << 8 | b) + 1u;
            size_t count = a >> 4;
            if (count) count += 2;
            else { if (in == src_len) return -1; count = (size_t)src[in++] + 18; }
            if (distance > out || count > size - out) return -1;
            while (count--) { dst[out] = dst[out - distance]; out++; }
        }
        flags <<= 1; left--;
    }
    *dst_len = out;
    return 0;
}

int yaz0_encode(const uint8_t *src, size_t src_len, uint8_t *dst,
                size_t dst_cap, size_t *dst_len) try {
    if (!src || !dst || !dst_len || src_len > UINT32_MAX || dst_cap < 16) return -1;
    constexpr uint32_t absent = UINT32_MAX;
    std::array<uint32_t, 65536> head;
    head.fill(absent);
    std::vector<uint32_t> prev(src_len, absent);
    std::vector<uint16_t> longest(src_len, 0), distance(src_len, 0);
    for (size_t i = 0; src_len - i >= 3; i++) {
        uint32_t bytes = uint32_t(src[i]) << 16 | uint32_t(src[i + 1]) << 8 | src[i + 2];
        unsigned hash = (bytes * 0x1e35a7bdu) >> 16;
        uint32_t candidate = head[hash];
        unsigned limit = unsigned(std::min<size_t>(273, src_len - i));
        unsigned best = 0;
        for (; candidate != absent && i - candidate <= 4096;
             candidate = prev[candidate]) {
            if (best && src[candidate + best] != src[i + best]) continue;
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

    // Exact byte costs include the control byte at every eighth token.
    // Suffix minima make the two match-length ranges cheap to search.
    std::array<SuffixMin, 8> suffix;
    std::vector<std::array<uint16_t, 8>> choice(src_len);
    for (auto &s : suffix) s.set(src_len, 0);
    for (size_t i = src_len; i-- > 0;) {
        unsigned length = longest[i];
        for (unsigned phase = 0; phase < 8; phase++) {
            unsigned next = (phase + 1) & 7;
            uint64_t best = 1 + (phase == 0) + (suffix[next].get(i + 1, i + 1) >> 9);
            unsigned selected = 1;
            if (length >= 3) {
                uint64_t short_best = suffix[next].get(i + 3, i + std::min(length, 17u));
                uint64_t cost = 2 + (phase == 0) + (short_best >> 9);
                if (cost < best) { best = cost; selected = SuffixMin::length(short_best, i, 3); }
            }
            if (length >= 18) {
                uint64_t long_best = suffix[next].get(i + 18, i + length);
                uint64_t cost = 3 + (phase == 0) + (long_best >> 9);
                if (cost < best) { best = cost; selected = SuffixMin::length(long_best, i, 18); }
            }
            choice[i][phase] = uint16_t(selected);
            suffix[phase].set(i, best);
        }
    }

    memcpy(dst, "Yaz0", 4); PUT32(dst + 4, src_len);
    memset(dst + 8, 0, 8);
    size_t i = 0, out = 16;
    unsigned phase = 0;
    size_t flag_at = 0;
    while (i < src_len) {
        if (!phase) {
            if (out == dst_cap) return -1;
            flag_at = out++;
            dst[flag_at] = 0;
        }
        unsigned count = choice[i][phase];
        unsigned width = count == 1 ? 1 : count >= 18 ? 3 : 2;
        if (width > dst_cap - out) return -1;
        if (count == 1) {
            dst[flag_at] |= 0x80u >> phase;
            dst[out++] = src[i];
        } else {
            unsigned d = distance[i] - 1;
            dst[out++] = ((count >= 18 ? 0 : count - 2) << 4) | (d >> 8);
            dst[out++] = d;
            if (count >= 18) dst[out++] = count - 18;
        }
        i += count;
        phase = (phase + 1) & 7;
    }
    *dst_len = out;
    return 0;
} catch (const std::bad_alloc &) {
    return -1;
} catch (const std::length_error &) {
    return -1;
}

} /* extern "C" */
