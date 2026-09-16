/* Bounded greedy LZ search. No allocation; token costs and encoding stay with
 * the caller. Window must be a power of two. Depth=1 keeps only the latest
 * three-byte match; larger depths walk a short ring of prior candidates.
 */
#pragma once
#include <array>
#include <cstddef>
#include <cstdint>

template<size_t Window, size_t MaxLength, unsigned Depth = 1,
         size_t MaxDistance = Window>
class MatchFinder {
    static_assert(Window && !(Window & (Window - 1)) && Depth &&
                  MaxDistance && MaxDistance <= Window);
    std::array<size_t, 4096> last_;
    std::array<size_t, Depth == 1 ? 0 : Window> chain_;

    static unsigned hash(const uint8_t *p) {
        return (p[0] * 251u + p[1] * 31u + p[2]) & 4095u;
    }

public:
    struct Match { size_t length, distance; };

    MatchFinder() { last_.fill(SIZE_MAX); }

    Match find(const uint8_t *src, size_t size, size_t pos) const {
        Match best{0, 0};
        if (size - pos < 3) return best;
        size_t prev = last_[hash(src + pos)];
        for (unsigned n = 0; n < Depth && prev != SIZE_MAX &&
             pos - prev <= MaxDistance; n++) {
            size_t length = 0;
            while (length < MaxLength && length < size - pos &&
                   src[prev + length] == src[pos + length]) length++;
            if (length > best.length) best = {length, pos - prev};
            if constexpr (Depth > 1) prev = chain_[prev & (Window - 1)];
        }
        if (best.length < 3) return {0, 0};
        return best;
    }

    void advance(const uint8_t *src, size_t size, size_t pos, size_t count) {
        for (size_t j = 0; j < count; j++) {
            size_t at = pos + j;
            if (size - at < 3) break;
            unsigned h = hash(src + at);
            if constexpr (Depth > 1) chain_[at & (Window - 1)] = last_[h];
            last_[h] = at;
        }
    }
};
