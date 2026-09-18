// Stunt Racer 64 Boss tracker-pattern stream; independent reference codec.
#include <algorithm>
#include <array>
#include <cstdint>
#include <stdexcept>
#include <vector>

using Bytes = std::vector<uint8_t>;

Bytes decode(const uint8_t *src, size_t size, size_t raw_size) {
    if (!size) throw std::runtime_error("empty stream");
    if (src[0] == 0x80) {
        if (size - 1 != raw_size) throw std::runtime_error("raw size mismatch");
        return Bytes(src + 1, src + size);
    }
    if (size < 3) throw std::runtime_error("missing control word");
    Bytes out;
    out.reserve(raw_size);
    size_t p = 3;
    uint16_t control = uint16_t(src[1]) << 8 | src[2];
    unsigned bits = 16;
    while (p < size) {
        if (!bits) {
            if (p + 2 > size) throw std::runtime_error("short control word");
            control = uint16_t(src[p]) << 8 | src[p + 1];
            p += 2;
            bits = 16;
        }
        if (control & 0x8000) {
            if (p + 2 > size) throw std::runtime_error("short match");
            uint8_t a = src[p++], b = src[p++];
            unsigned distance = unsigned(a) << 4 | b >> 4;
            if (distance) {
                unsigned length = (b & 15) + 3;
                if (distance > out.size() || length > raw_size - out.size())
                    throw std::runtime_error("invalid match");
                while (length--) out.push_back(out[out.size() - distance]);
            } else {
                if (p + 2 > size) throw std::runtime_error("short run");
                unsigned length = (unsigned(b) << 8 | src[p++]) + 16;
                uint8_t value = src[p++];
                if (length > raw_size - out.size()) throw std::runtime_error("invalid run");
                out.insert(out.end(), length, value);
            }
        } else {
            if (out.size() == raw_size) throw std::runtime_error("extra literal");
            out.push_back(src[p++]);
        }
        control <<= 1;
        --bits;
    }
    if (out.size() != raw_size) throw std::runtime_error("decoded size mismatch");
    return out;
}

struct Choice { uint16_t length, distance; }; // distance: 0 literal, 0xffff run
struct State { uint32_t cost; Choice choice; };

Bytes encode(const Bytes &input, unsigned search_depth = 4096) {
    const size_t n = input.size();
    std::vector<std::array<uint16_t, 19>> matches(n);
    std::vector<uint16_t> runs(n);
    std::array<int, 65536> head;
    head.fill(-1);
    std::vector<int> previous(n, -1);
    for (size_t i = n; i-- > 0;) {
        if (i + 1 < n && input[i] == input[i + 1])
            runs[i] = std::min<unsigned>(4111, runs[i + 1] + 1);
        else runs[i] = 1;
    }
    for (size_t i = 0; i + 2 < n; ++i) {
        unsigned h = ((unsigned(input[i]) << 8) ^
                      (unsigned(input[i + 1]) << 4) ^ input[i + 2]) & 65535;
        previous[i] = head[h];
        head[h] = int(i);
        unsigned depth = 0, limit = std::min<size_t>(18, n - i);
        for (int j = previous[i]; j >= 0 && i - size_t(j) <= 4095 && depth++ < search_depth;
             j = previous[j]) {
            unsigned k = 0;
            while (k < limit && input[i + k] == input[size_t(j) + k]) ++k;
            for (unsigned length = 3; length <= k; ++length)
                if (!matches[i][length]) matches[i][length] = uint16_t(i - j);
            if (matches[i][limit]) break;
        }
    }

    std::vector<std::array<State, 16>> dp(n + 1);
    for (unsigned m = 0; m < 16; ++m) dp[n][m] = {0, {0, 0}};
    for (size_t i = n; i-- > 0;) {
        for (unsigned m = 0; m < 16; ++m) {
            unsigned next = (m + 1) & 15;
            uint32_t overhead = m ? 0 : 2;
            State best = {uint32_t(1 + overhead + dp[i + 1][next].cost), {1, 0}};
            for (unsigned length = 3; length <= 18; ++length) {
                unsigned distance = matches[i][length];
                if (distance && i + length <= n) {
                    uint32_t cost = 2 + overhead + dp[i + length][next].cost;
                    if (cost < best.cost) best = {cost, {uint16_t(length), uint16_t(distance)}};
                }
            }
            if (runs[i] >= 16) {
                auto try_run = [&](unsigned length) {
                    uint32_t cost = 4 + overhead + dp[i + length][next].cost;
                    if (cost < best.cost) best = {cost, {uint16_t(length), 0xffff}};
                };
                for (unsigned length = 16; length <= std::min<unsigned>(runs[i], 64); ++length)
                    try_run(length);
                for (unsigned length = 65; length < runs[i]; length *= 2)
                    try_run(length);
                if (runs[i] > 64) try_run(runs[i]);
            }
            dp[i][m] = best;
        }
    }

    Bytes out(1, 0x40); // the compressed-mode byte; retail streams use 0x40
    size_t control_at = 0;
    unsigned tokens = 0;
    for (size_t i = 0; i < n;) {
        if (!(tokens & 15)) { control_at = out.size(); out.resize(out.size() + 2); }
        Choice c = dp[i][tokens & 15].choice;
        if (!c.distance) out.push_back(input[i]);
        else {
            out[control_at + ((tokens & 15) >= 8)] |= uint8_t(1u << (7 - (tokens & 7)));
            if (c.distance == 0xffff) {
                unsigned count = c.length - 16;
                out.push_back(0);
                out.push_back(uint8_t(count >> 8));
                out.push_back(uint8_t(count));
                out.push_back(input[i]);
            } else {
                out.push_back(uint8_t(c.distance >> 4));
                out.push_back(uint8_t((c.distance << 4) | (c.length - 3)));
            }
        }
        i += c.length;
        ++tokens;
    }
    if (out.size() >= n + 1) {
        out.assign(1, 0x80);
        out.insert(out.end(), input.begin(), input.end());
    }
    return out;
}
