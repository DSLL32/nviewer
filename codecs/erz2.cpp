/* Spider-Man ERZ version 2. Bounded decoder and minimum-size encoder. */
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <algorithm>
#include <new>
#include <stdexcept>
#include <vector>
#include "common/hash_chain.hpp"

extern "C" {

#define BE32(p) ((uint32_t)(p)[0] << 24 | (uint32_t)(p)[1] << 16 | (uint32_t)(p)[2] << 8 | (p)[3])

typedef struct {
    const uint8_t *src; size_t in, end;
    uint8_t *dst; size_t out, cap;
    unsigned t2, t7;
    int bad;
} Erz;

static unsigned next(Erz *e) {
    if (e->in == e->end) { e->bad = 1; return 0; }
    return e->src[e->in++];
}

static unsigned bit(Erz *e) {
    e->t2 += e->t2;
    e->t7 = (e->t2 >> 8) & 1u;
    e->t2 &= 255u;
    if (!e->t2) {
        e->t2 = next(e) * 2 + e->t7;
        e->t7 = (e->t2 >> 8) & 1u;
    }
    return e->t7;
}

static void put(Erz *e, unsigned value) {
    if (e->out == e->cap) { e->bad = 1; return; }
    e->dst[e->out++] = (uint8_t)value;
}

int erz2_decode(const uint8_t *src, size_t size, uint8_t *dst,
                size_t cap, size_t *written) {
    if (!src || !dst || !written || size < 19 || memcmp(src, "ERZ\2", 4)) return -1;
    size_t decoded = BE32(src + 4), packed = BE32(src + 8);
    if (!packed || packed > size - 18 || decoded > cap) return -1;
    Erz e = {src, 18, 18 + packed, dst, 0, decoded, 0, 0, 0};
    e.t2 = next(&e) * 2 + 1;
    e.t2 += e.t2;
    e.t7 = (e.t2 >> 8) & 1u;
    int t0 = 0;
    unsigned t1 = 0, state = 0;
    while (!e.bad) {
        if (state == 0) { /* dispatch */
            e.t2 += e.t2;
            e.t7 = (e.t2 >> 8) & 1u;
            if (!e.t7) {
                put(&e, next(&e));
                e.t2 += e.t2;
                e.t7 = (e.t2 >> 8) & 1u;
                if (!e.t7) { put(&e, next(&e)); continue; }
            }
            e.t2 &= 255u;
            if (!e.t2) {
                e.t2 = next(&e) * 2 + e.t7;
                e.t7 = (e.t2 >> 8) & 1u;
                if (!e.t7) { put(&e, next(&e)); continue; }
            }
            t0 = 2; t1 = 0;
            if (!bit(&e)) state = 1;
            else if (!bit(&e)) state = 3;
            else {
                t0++;
                if (!bit(&e)) state = 2;
                else { t0 = next(&e); state = t0 ? 2 : 5; if (state == 2) t0 += 8; }
            }
        } else if (state == 1) { /* gamma length */
            t0 = t0 * 2 + bit(&e);
            if (!bit(&e)) { state = 2; continue; }
            t0 = (t0 - 1) * 2 + bit(&e);
            state = t0 == 9 ? 4 : 2;
        } else if (state == 2) { /* distance prefix */
            if (!bit(&e)) { state = 3; continue; }
            t1 = t1 * 2 + bit(&e);
            if (bit(&e)) {
                t1 = t1 * 2 + bit(&e); t1 |= 4;
                if (!bit(&e)) t1 = t1 * 2 + bit(&e);
            } else if (!t1) t1 = 2 + bit(&e);
            t1 = ((t1 << 8) & 0xff00u) | ((t1 >> 8) & 255u);
            state = 3;
        } else if (state == 3) { /* overlapping match or repeat */
            t1 = (t1 & 0xff00u) | next(&e);
            size_t distance = (size_t)t1 + 1;
            if (distance > e.out || (size_t)t0 > e.cap - e.out) return -1;
            size_t from = e.out - distance;
            unsigned odd = t0 & 1u;
            t0 >>= 1;
            if (odd) put(&e, e.dst[from++]);
            t0--;
            if (!t1) {
                unsigned value = e.dst[from];
                for (;;) {
                    put(&e, value); t0--; put(&e, value);
                    if (t0 < 0 || e.bad) break;
                }
            } else {
                for (;;) {
                    if (from + 1 >= e.out) return -1;
                    unsigned a = e.dst[from], b = e.dst[from + 1];
                    put(&e, a); put(&e, b); from += 2; t0--;
                    if (t0 < 0 || e.bad) break;
                }
            }
            state = 0;
        } else if (state == 4) { /* raw run */
            t1 = 0;
            for (unsigned i = 0; i < 4; i++) t1 = t1 * 2 + bit(&e);
            int blocks = (int)t1 + 2;
            while (blocks-- >= 0 && !e.bad) {
                put(&e, next(&e)); put(&e, next(&e));
                put(&e, next(&e)); put(&e, next(&e));
            }
            state = 0;
        } else { /* end escape */
            if (bit(&e)) { state = 0; continue; }
            if (e.out != decoded || e.bad) return -1;
            *written = e.out;
            return 0;
        }
    }
    return -1;
}

typedef struct { uint8_t *dst; size_t cap, pos, control; unsigned left; int bad; } Writer;

static void emit_bit(Writer *w, unsigned value) {
    if (!w->left) {
        if (w->pos == w->cap) { w->bad = 1; return; }
        w->control = w->pos++;
        w->dst[w->control] = 0;
        w->left = 8;
    }
    w->left--;
    if (value) w->dst[w->control] |= 1u << w->left;
}

static void emit_byte(Writer *w, unsigned value) {
    if (w->pos == w->cap) { w->bad = 1; return; }
    w->dst[w->pos++] = (uint8_t)value;
}

static void emit_distance(Writer *w, size_t distance) {
    unsigned value = (unsigned)(distance - 1), high = value >> 8;
    if (!high) emit_bit(w, 0);
    else if (high == 1) {
        emit_bit(w, 1); emit_bit(w, 1); emit_bit(w, 0);
    } else if (high <= 3) {
        emit_bit(w, 1); emit_bit(w, 0); emit_bit(w, 0);
        emit_bit(w, high - 2);
    } else {
        unsigned base = high >= 8 ? high >> 1 : high;
        emit_bit(w, 1);
        emit_bit(w, (base - 4) >> 1);
        emit_bit(w, 1);
        emit_bit(w, (base - 4) & 1u);
        emit_bit(w, high < 8);
        if (high >= 8) emit_bit(w, high & 1u);
    }
    emit_byte(w, value & 255u);
}

static void emit_literals(Writer *w, const uint8_t *src,
                          size_t start, size_t count) {
    while (count >= 12) {
        size_t run = count > 72 ? 72 : 12 + ((count - 12) / 4) * 4;
        /* The length-nine escape stores 12, 16, ..., 72 raw bytes. */
        emit_bit(w, 1); emit_bit(w, 0);
        emit_bit(w, 1); emit_bit(w, 1); emit_bit(w, 1);
        for (unsigned bit = 4; bit; bit--)
            emit_bit(w, ((run - 12) / 4 >> (bit - 1)) & 1u);
        for (size_t j = 0; j < run; j++) emit_byte(w, src[start + j]);
        start += run; count -= run;
    }
    /* A zero dispatch bit stores a literal; two zeros store a pair. */
    while (count--) { emit_bit(w, 0); emit_byte(w, src[start++]); }
}


int erz2_encode(const uint8_t *src, size_t size, uint8_t *dst,
                size_t cap, size_t *written) try {
    if (!src || !dst || !written || size > UINT32_MAX || cap < 19) return -1;
    HashChain<PairHash2> index(size);
    index.build(src, size);

    struct Choice { uint16_t length, distance; };
    std::vector<Choice> choice(size);
    std::vector<uint64_t> suffix(size + 1);
    // Raw bytes do not change the control-bit phase. Minimizing bits therefore
    // also minimizes the final byte count, including its one partial byte.
    for (size_t at = size; at-- > 0;) {
        uint64_t best = suffix[at + 1] + 9;
        Choice selected{1, 0};
        for (unsigned run = 12; run <= 72 && run <= size - at; run += 4) {
            uint64_t bits = suffix[at + run] + run * 8 + 9;
            if (bits < best) { best = bits; selected = {uint16_t(run), 0}; }
        }
        unsigned limit = unsigned(std::min<size_t>(263, size - at));
        unsigned longest = 1;
        // A pair chain finds every legal match, including the cheap length-two
        // token. Candidates get farther away, so their distance cost cannot
        // improve: only newly reached lengths need to be considered.
        for (uint32_t from = index.previous(uint32_t(at));
             from != index.absent && at - from <= 4096;
             from = index.previous(from)) {
            unsigned distance = unsigned(at - from);
            if (longest >= limit) break;
            if (src[from + longest] != src[at + longest]) continue;
            unsigned length = 2;
            while (length < limit && src[from + length] == src[at + length]) length++;
            unsigned high = (distance - 1) >> 8;
            unsigned offset_bits = 8 + (!high ? 1 : high == 1 ? 3 : high < 4 ? 4 : high < 8 ? 5 : 6);
            unsigned first = std::max(longest + 1, distance <= 256 ? 2u : 3u);
            for (unsigned count = first; count <= length; count++) {
                unsigned token_bits = count == 2 ? 11 : offset_bits +
                                      (count <= 5 ? 4 : count <= 8 ? 5 : 12);
                uint64_t bits = suffix[at + count] + token_bits;
                if (bits < best) { best = bits; selected = {uint16_t(count), uint16_t(distance)}; }
            }
            longest = std::max(longest, length);
        }
        suffix[at] = best;
        choice[at] = selected;
    }

    /* The first control byte contributes only bits 5..0; its top bits are skipped. */
    Writer w = {dst, cap, 19, 18, 6, 0};
    dst[18] = 0;
    for (size_t i = 0; i < size && !w.bad;) {
        size_t count = choice[i].length, distance = choice[i].distance;
        if (distance) {
            if (count == 2) {
                emit_bit(&w, 1); emit_bit(&w, 1); emit_bit(&w, 0);
                emit_byte(&w, unsigned(distance - 1));
            } else if (count >= 9) {
                emit_bit(&w, 1); emit_bit(&w, 1);
                emit_bit(&w, 1); emit_bit(&w, 1);
                emit_byte(&w, (unsigned)(count - 8));
            } else if (count == 3) {
                emit_bit(&w, 1); emit_bit(&w, 1);
                emit_bit(&w, 1); emit_bit(&w, 0);
            } else {
                emit_bit(&w, 1); emit_bit(&w, 0);
                emit_bit(&w, count == 5 || count == 8);
                emit_bit(&w, count >= 6);
                if (count >= 6) emit_bit(&w, count == 7);
            }
            if (count != 2) emit_distance(&w, distance);
        } else emit_literals(&w, src, i, count);
        i += count;
    }
    for (unsigned i = 0; i < 4; i++) emit_bit(&w, 1);
    emit_byte(&w, 0); emit_bit(&w, 0); /* end escape */
    if (w.bad || w.pos - 18 > UINT32_MAX) return -1;
    memcpy(dst, "ERZ\2", 4);
    dst[4] = (uint8_t)(size >> 24); dst[5] = (uint8_t)(size >> 16);
    dst[6] = (uint8_t)(size >> 8); dst[7] = (uint8_t)size;
    size_t packed = w.pos - 18;
    dst[8] = (uint8_t)(packed >> 24); dst[9] = (uint8_t)(packed >> 16);
    dst[10] = (uint8_t)(packed >> 8); dst[11] = (uint8_t)packed;
    memset(dst + 12, 0, 6);
    *written = w.pos;
    return 0;
} catch (const std::bad_alloc &) {
    return -1;
} catch (const std::length_error &) {
    return -1;
}

} /* extern "C" */
