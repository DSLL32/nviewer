// Cruis'n USA kernel RLE. Unit is 1, 2, or 4 bytes, as selected by the asset descriptor.
#include <algorithm>
#include <cstdint>
#include <stdexcept>
#include <vector>

using Bytes = std::vector<uint8_t>;

template <unsigned Unit>
Bytes decode(const uint8_t *src, size_t size, size_t raw_size, size_t *consumed = nullptr) {
    static_assert(Unit == 1 || Unit == 2 || Unit == 4);
    if (raw_size % Unit) throw std::runtime_error("unaligned output size");
    Bytes out;
    out.reserve(raw_size);
    size_t p = 0;
    constexpr uint32_t high = uint32_t(1) << (8 * Unit - 1);
    while (out.size() < raw_size) {
        if (size - p < Unit) throw std::runtime_error("short control word");
        uint32_t op = 0;
        for (unsigned j = 0; j < Unit; ++j) op = (op << 8) | src[p++];
        size_t count = size_t(op & (high - 1)) + (op & high ? 3 : 1);
        if (count > (raw_size - out.size()) / Unit)
            throw std::runtime_error("output overrun");
        if (op & high) {
            if (size - p < Unit) throw std::runtime_error("short run value");
            for (size_t j = 0; j < count; ++j)
                out.insert(out.end(), src + p, src + p + Unit);
            p += Unit;
        } else {
            if (count > (size - p) / Unit) throw std::runtime_error("short literal");
            out.insert(out.end(), src + p, src + p + count * Unit);
            p += count * Unit;
        }
    }
    if (consumed) *consumed = p;
    return out;
}

template <unsigned Unit>
Bytes encode(const Bytes &input) {
    static_assert(Unit == 1 || Unit == 2 || Unit == 4);
    if (input.size() % Unit) throw std::runtime_error("unaligned input size");
    constexpr size_t max_code = (uint64_t(1) << (8 * Unit - 1)) - 1;
    const size_t n = input.size() / Unit;
    std::vector<size_t> cost(n + 1), length(n);
    std::vector<size_t> runs(n);
    std::vector<uint8_t> repeat(n);
    for (size_t i = n; i-- > 0;) {
        runs[i] = 1;
        if (i + 1 < n && std::equal(input.begin() + i * Unit,
                                   input.begin() + (i + 1) * Unit,
                                   input.begin() + (i + 1) * Unit))
            runs[i] += runs[i + 1];
    }
    for (size_t i = n; i-- > 0;) {
        size_t best = SIZE_MAX;
        auto choose = [&](size_t len, bool run) {
            size_t c = Unit * (run ? 2 : 1 + len) + cost[i + len];
            if (c < best) { best = c; length[i] = len; repeat[i] = run; }
        };
        size_t literals = std::min(n - i, max_code + 1);
        for (size_t len = 1; len <= std::min<size_t>(literals, 128); ++len)
            choose(len, false);
        if (literals > 128) choose(literals, false);
        size_t run = std::min(runs[i], max_code + 3);
        for (size_t len = 3; len <= std::min<size_t>(run, 130); ++len)
            choose(len, true);
        if (run > 130) choose(run, true);
        cost[i] = best;
    }
    Bytes out;
    out.reserve(cost[0]);
    for (size_t i = 0; i < n;) {
        size_t len = length[i];
        uint32_t op = repeat[i] ? uint32_t((len - 3) | (max_code + 1))
                                : uint32_t(len - 1);
        for (unsigned j = Unit; j-- > 0;) out.push_back(uint8_t(op >> (8 * j)));
        if (repeat[i])
            out.insert(out.end(), input.begin() + i * Unit,
                       input.begin() + (i + 1) * Unit);
        else
            out.insert(out.end(), input.begin() + i * Unit,
                       input.begin() + (i + len) * Unit);
        i += len;
    }
    return out;
}
