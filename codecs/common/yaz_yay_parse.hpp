/* Exact phase-aware parse shared by Yaz0 and Yay0. */
#pragma once
#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>
#include "longest_match.hpp"

template<unsigned Phases, unsigned ControlBytes>
std::vector<std::array<uint16_t, Phases>> yaz_yay_parse(
    const std::vector<LongestMatch> &matches) {
    static_assert(Phases == 8 || Phases == 32);
    constexpr unsigned span = 512;
    using Costs = std::array<uint64_t, Phases>;
    std::array<Costs, span * 2> tree;
    for (auto &row : tree) row.fill(UINT64_MAX);

    auto set = [&](size_t pos, const Costs &cost) {
        unsigned at = span + (unsigned(pos) & (span - 1));
        for (unsigned phase = 0; phase < Phases; phase++)
            tree[at][phase] = cost[phase] << 9 | (unsigned(pos) & (span - 1));
        while (at > 1) {
            at >>= 1;
            for (unsigned phase = 0; phase < Phases; phase++)
                tree[at][phase] = std::min(tree[at * 2][phase], tree[at * 2 + 1][phase]);
        }
    };
    auto get = [&](size_t first, size_t last) {
        Costs best;
        best.fill(UINT64_MAX);
        auto part = [&](unsigned a, unsigned b) {
            for (a += span, b += span; a < b; a >>= 1, b >>= 1) {
                if (a & 1) {
                    for (unsigned p = 0; p < Phases; p++)
                        best[p] = std::min(best[p], tree[a][p]);
                    a++;
                }
                if (b & 1) {
                    --b;
                    for (unsigned p = 0; p < Phases; p++)
                        best[p] = std::min(best[p], tree[b][p]);
                }
            }
        };
        unsigned a = unsigned(first) & (span - 1), b = unsigned(last) & (span - 1);
        if (a <= b) part(a, b + 1);
        else { part(a, span); part(0, b + 1); }
        return best;
    };
    auto choice_length = [](uint64_t packed, size_t from, unsigned minimum) {
        unsigned first = (unsigned(from) + minimum) & (span - 1);
        return minimum + ((unsigned(packed) - first) & (span - 1));
    };

    std::vector<std::array<uint16_t, Phases>> choice(matches.size());
    set(matches.size(), {});
    for (size_t i = matches.size(); i-- > 0;) {
        unsigned length = matches[i].length;
        auto literal = get(i + 1, i + 1);
        Costs short_match{}, long_match{}, costs;
        if (length >= 3) short_match = get(i + 3, i + std::min(length, 17u));
        if (length >= 18) long_match = get(i + 18, i + length);
        for (unsigned phase = 0; phase < Phases; phase++) {
            unsigned next = (phase + 1) & (Phases - 1);
            unsigned control = phase == 0 ? ControlBytes : 0;
            uint64_t best = 1 + control + (literal[next] >> 9);
            unsigned selected = 1;
            if (length >= 3) {
                uint64_t cost = 2 + control + (short_match[next] >> 9);
                if (cost < best) {
                    best = cost; selected = choice_length(short_match[next], i, 3);
                }
            }
            if (length >= 18) {
                uint64_t cost = 3 + control + (long_match[next] >> 9);
                if (cost < best) {
                    best = cost; selected = choice_length(long_match[next], i, 18);
                }
            }
            choice[i][phase] = uint16_t(selected);
            costs[phase] = best;
        }
        set(i, costs);
    }
    return choice;
}
