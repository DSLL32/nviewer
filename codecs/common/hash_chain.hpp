/* Hash-chain index for LZ match candidates. Match scoring and parsing belong
 * to the codec. Ring=0 stores one link per input byte; otherwise links wrap
 * through a power-of-two ring. Callers bound candidate distance and depth.
 */
#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <type_traits>
#include <vector>

struct PairHash2 {
    static constexpr size_t width = 2, buckets = 65536;
    unsigned operator()(const uint8_t *p) const { return unsigned(p[0]) << 8 | p[1]; }
};

struct MultiplyHash3 {
    static constexpr size_t width = 3, buckets = 65536;
    unsigned operator()(const uint8_t *p) const {
        uint32_t word = uint32_t(p[0]) << 16 | uint32_t(p[1]) << 8 | p[2];
        return (word * 0x1e35a7bdu) >> 16;
    }
};

template<class Hash, class Index = uint32_t, size_t Ring = 0>
class HashChain {
    static_assert(!Ring || !(Ring & (Ring - 1)));
    std::array<Index, Hash::buckets> head_;
    std::conditional_t<Ring == 0, std::vector<Index>, std::array<Index, Ring>> link_;

    static size_t slot(size_t pos) {
        if constexpr (Ring) return pos & (Ring - 1);
        return pos;
    }

public:
    static constexpr Index absent = std::numeric_limits<Index>::max();

    explicit HashChain(size_t size = 0) {
        head_.fill(absent);
        if constexpr (Ring) link_.fill(absent);
        else link_.resize(size, absent);
    }

    Index first(const uint8_t *src, size_t pos) const {
        return head_[Hash{}(src + pos)];
    }

    Index previous(Index pos) const { return link_[slot(pos)]; }

    void insert(const uint8_t *src, size_t pos) {
        unsigned key = Hash{}(src + pos);
        link_[slot(pos)] = head_[key];
        head_[key] = static_cast<Index>(pos);
    }

    void build(const uint8_t *src, size_t size) {
        for (size_t pos = 0; size - pos >= Hash::width; pos++) insert(src, pos);
    }
};
