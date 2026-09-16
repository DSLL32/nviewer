/* Shared RNC method-2 / ERZ2 token grammar. Headers and bitstream starts differ. */
#pragma once
#include <cstddef>
#include <cstdint>

struct Rnc2Writer {
    uint8_t *dst;
    size_t cap, pos, control;
    unsigned left;
    int bad;

    void bit(unsigned value) {
        if (!left) {
            if (pos == cap) { bad = 1; return; }
            control = pos++;
            dst[control] = 0;
            left = 8;
        }
        left--;
        if (value) dst[control] |= 1u << left;
    }

    void byte(unsigned value) {
        if (pos == cap) { bad = 1; return; }
        dst[pos++] = uint8_t(value);
    }

    void distance(size_t d) {
        unsigned value = unsigned(d - 1), high = value >> 8;
        if (!high) bit(0);
        else if (high == 1) { bit(1); bit(1); bit(0); }
        else if (high <= 3) { bit(1); bit(0); bit(0); bit(high - 2); }
        else {
            unsigned base = high >= 8 ? high >> 1 : high;
            bit(1); bit((base - 4) >> 1); bit(1); bit((base - 4) & 1u);
            bit(high < 8);
            if (high >= 8) bit(high & 1u);
        }
        byte(value & 255u);
    }

    void literals(const uint8_t *src, size_t start, size_t count) {
        while (count >= 12) {
            size_t run = count > 72 ? 72 : 12 + ((count - 12) / 4) * 4;
            bit(1); bit(0); bit(1); bit(1); bit(1);
            for (unsigned b = 4; b; b--)
                bit(((run - 12) / 4 >> (b - 1)) & 1u);
            for (size_t j = 0; j < run; j++) byte(src[start + j]);
            start += run; count -= run;
        }
        while (count--) { bit(0); byte(src[start++]); }
    }

    void token(const uint8_t *src, size_t at, unsigned count, unsigned d) {
        if (!d) { literals(src, at, count); return; }
        if (count == 2) {
            bit(1); bit(1); bit(0); byte(d - 1);
        } else {
            if (count >= 9) {
                bit(1); bit(1); bit(1); bit(1); byte(count - 8);
            } else if (count == 3) {
                bit(1); bit(1); bit(1); bit(0);
            } else {
                bit(1); bit(0); bit(count == 5 || count == 8);
                bit(count >= 6);
                if (count >= 6) bit(count == 7);
            }
            distance(d);
        }
    }

    void end() {
        for (unsigned i = 0; i < 4; i++) bit(1);
        byte(0); bit(0);
    }
};

inline unsigned rnc2_match_bits(unsigned length, unsigned distance) {
    unsigned high = (distance - 1) >> 8;
    unsigned offset = 8 + (!high ? 1 : high == 1 ? 3 : high < 4 ? 4 : high < 8 ? 5 : 6);
    return length == 2 ? 11 : offset +
           (length <= 5 ? 4 : length <= 8 ? 5 : 12);
}
