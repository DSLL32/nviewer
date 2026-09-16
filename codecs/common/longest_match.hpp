/* Longest equal-cost LZ matches for formats with a 4 KiB distance field. */
#pragma once
#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <vector>
#include "hash_chain.hpp"

struct LongestMatch {
    uint16_t length = 0, distance = 0;
};

template<unsigned MaxLength, size_t Ring = 0>
std::vector<LongestMatch> longest_matches(const uint8_t *src, size_t size) {
    HashChain<MultiplyHash3, uint32_t, Ring> index(size);
    std::vector<LongestMatch> matches(size);
    for (size_t i = 0; size - i >= 3; i++) {
        unsigned limit = unsigned(std::min<size_t>(MaxLength, size - i));
        auto &best = matches[i];
        for (uint32_t p = index.first(src, i);
             p != index.absent && i - p <= 4096; p = index.previous(p)) {
            if (best.length && src[p + best.length] != src[i + best.length]) continue;
            unsigned length = 0;
            while (length < limit && src[p + length] == src[i + length]) length++;
            if (length > best.length) {
                best = {uint16_t(length), uint16_t(i - p)};
                if (length == limit) break;
            }
        }
        if (best.length < 3) best = {};
        index.insert(src, i);
    }
    return matches;
}
