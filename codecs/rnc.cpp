/* A Bug's Life RNC ProPack methods 1 and 2. CRC-checked, no allocation.
 * Both encoders use bounded matches; method 1 uses fixed Huffman tables.
 * Streams with the encrypted or locked flags set are not supported.
 */
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include "common/match_finder.hpp"

extern "C" {

#define BE16(p) ((unsigned)(p)[0] << 8 | (p)[1])
#define BE32(p) ((uint32_t)(p)[0] << 24 | (uint32_t)(p)[1] << 16 | (uint32_t)(p)[2] << 8 | (p)[3])
#define PUT16(p, n) do { (p)[0] = (uint8_t)((n) >> 8); (p)[1] = (uint8_t)(n); } while (0)
#define PUT32(p, n) do { \
    (p)[0] = (uint8_t)((n) >> 24); (p)[1] = (uint8_t)((n) >> 16); \
    (p)[2] = (uint8_t)((n) >> 8); (p)[3] = (uint8_t)(n); \
} while (0)

typedef struct { unsigned depth, code; } Entry;
typedef struct {
    const uint8_t *src; size_t size, cursor;
    uint8_t *dst; size_t cap, out;
    uint32_t bit_buffer; unsigned bit_count;
    int bad;
} Decoder;

static unsigned crc16(const uint8_t *data, size_t size) {
    unsigned crc = 0;
    for (size_t i = 0; i < size; i++) {
        crc ^= data[i];
        for (unsigned bit = 0; bit < 8; bit++)
            crc = crc & 1 ? (crc >> 1) ^ 0xa001u : crc >> 1;
    }
    return crc & 0xffffu;
}

static unsigned byte(Decoder *d) {
    if (d->cursor < d->size) return d->src[d->cursor++];
    if (d->cursor < d->size + 2) { d->cursor++; return 0; }
    d->bad = 1;
    return 0;
}

static unsigned bits1(Decoder *d, unsigned count) {
    unsigned result = 0;
    for (unsigned bit = 0; bit < count; bit++) {
        if (!d->bit_count) {
            unsigned a = byte(d), b = byte(d);
            unsigned c = d->cursor < d->size ? d->src[d->cursor] : 0;
            unsigned e = d->cursor + 1 < d->size ? d->src[d->cursor + 1] : 0;
            d->bit_buffer = a | b << 8 | c << 16 | e << 24;
            d->bit_count = 16;
        }
        result |= (d->bit_buffer & 1u) << bit;
        d->bit_buffer >>= 1;
        d->bit_count--;
    }
    return result;
}

static unsigned bits2(Decoder *d, unsigned count) {
    unsigned result = 0;
    while (count--) {
        if (!d->bit_count) { d->bit_buffer = byte(d); d->bit_count = 8; }
        result = (result << 1) | ((d->bit_buffer >> 7) & 1u);
        d->bit_buffer = (d->bit_buffer << 1) & 255u;
        d->bit_count--;
    }
    return result;
}

static void output(Decoder *d, unsigned value) {
    if (d->out == d->cap) { d->bad = 1; return; }
    d->dst[d->out++] = (uint8_t)value;
}

static void copy(Decoder *d, unsigned distance, unsigned length) {
    if (!distance || distance > d->out || length > d->cap - d->out) {
        d->bad = 1; return;
    }
    while (length--) { d->dst[d->out] = d->dst[d->out - distance]; d->out++; }
}

static unsigned reverse(unsigned value, unsigned count) {
    unsigned result = 0;
    while (count--) { result = (result << 1) | (value & 1u); value >>= 1; }
    return result;
}

static void table(Decoder *d, Entry entries[16]) {
    memset(entries, 0, 16 * sizeof *entries);
    unsigned count = bits1(d, 5);
    if (count > 16) count = 16;
    for (unsigned i = 0; i < count; i++) entries[i].depth = bits1(d, 4);
    uint64_t value = 0;
    uint32_t divisor = 0x80000000u;
    for (unsigned depth = 1; depth <= 16; depth++, divisor >>= 1)
        for (unsigned i = 0; i < count; i++) if (entries[i].depth == depth) {
            entries[i].code = reverse((unsigned)(value / divisor), depth);
            value += divisor;
        }
}

static unsigned symbol(Decoder *d, const Entry entries[16]) {
    for (unsigned i = 0; i < 16; i++) {
        unsigned depth = entries[i].depth;
        if (depth && entries[i].code == (d->bit_buffer & ((1u << depth) - 1u))) {
            bits1(d, depth);
            return i < 2 ? i : bits1(d, i - 1) + (1u << (i - 1));
        }
    }
    d->bad = 1;
    return 0;
}

static void method1(Decoder *d) {
    while (d->out < d->cap && !d->bad) {
        Entry raw[16], distance[16], length[16];
        table(d, raw); table(d, distance); table(d, length);
        unsigned chunks = bits1(d, 16);
        if (!chunks) { d->bad = 1; return; }
        while (chunks-- && !d->bad) {
            unsigned literals = symbol(d, raw);
            if (literals > d->cap - d->out) { d->bad = 1; return; }
            for (unsigned i = 0; i < literals; i++) output(d, byte(d));
            if (literals) {
                uint32_t mask = d->bit_count ? (1u << d->bit_count) - 1u : 0;
                uint32_t next = (d->cursor < d->size ? d->src[d->cursor] : 0) |
                    ((d->cursor + 1 < d->size ? d->src[d->cursor + 1] : 0) << 8) |
                    ((d->cursor + 2 < d->size ? d->src[d->cursor + 2] : 0) << 16);
                d->bit_buffer = (uint32_t)((uint64_t)next << d->bit_count) |
                                (d->bit_buffer & mask);
            }
            if (d->out == d->cap) return;
            if (chunks) {
                unsigned back = symbol(d, distance) + 1;
                unsigned count = symbol(d, length) + 2;
                copy(d, back, count);
            }
        }
    }
}

static unsigned offset2(Decoder *d) {
    unsigned high = 0;
    if (bits2(d, 1)) {
        high = bits2(d, 1);
        if (bits2(d, 1)) {
            high = (high << 1 | bits2(d, 1)) | 4;
            if (!bits2(d, 1)) high = high << 1 | bits2(d, 1);
        } else if (!high) high = bits2(d, 1) + 2;
    }
    return (high << 8 | byte(d)) + 1;
}

static void method2(Decoder *d) {
    while (d->out < d->cap && !d->bad) {
        for (;;) {
            if (!bits2(d, 1)) {
                output(d, byte(d));
                if (d->bad) return;
                continue;
            }
            if (bits2(d, 1)) {
                unsigned length, distance;
                if (bits2(d, 1)) {
                    if (bits2(d, 1)) {
                        length = byte(d) + 8;
                        if (length == 8) { bits2(d, 1); break; }
                    } else length = 3;
                    distance = offset2(d);
                } else { length = 2; distance = byte(d) + 1; }
                copy(d, distance, length);
            } else {
                unsigned length = bits2(d, 1) + 4;
                if (bits2(d, 1)) length = ((length - 1) << 1) + bits2(d, 1);
                if (length != 9) copy(d, offset2(d), length);
                else {
                    unsigned literals = (bits2(d, 4) << 2) + 12;
                    while (literals--) output(d, byte(d));
                }
            }
            if (d->bad) return;
        }
    }
}

int rnc_decode(const uint8_t *src, size_t size, uint8_t *dst,
               size_t cap, size_t *written) {
    if (!src || !dst || !written || size < 18 || memcmp(src, "RNC", 3) ||
        (src[3] != 1 && src[3] != 2)) return -1;
    size_t decoded = BE32(src + 4), packed = BE32(src + 8);
    if (decoded > cap || packed != size - 18 ||
        crc16(src + 18, packed) != BE16(src + 14)) return -1;
    Decoder d = {src, size, 18, dst, decoded, 0, 0, 0, 0};
    unsigned locked = src[3] == 1 ? bits1(&d, 1) : bits2(&d, 1);
    unsigned encrypted = src[3] == 1 ? bits1(&d, 1) : bits2(&d, 1);
    if (locked || encrypted) return -1;
    if (src[3] == 1) method1(&d); else method2(&d);
    if (d.bad || d.out != decoded || crc16(dst, decoded) != BE16(src + 12)) return -1;
    *written = decoded;
    return 0;
}


typedef struct { uint8_t *dst; size_t cap, pos, word; unsigned used; int bad; } Writer1;

static void bit1_out(Writer1 *w, unsigned bit) {
    if (w->used == 16) w->used = 0;
    if (!w->used) {
        if (w->cap - w->pos < 2) { w->bad = 1; return; }
        w->word = w->pos;
        w->dst[w->pos++] = 0;
        w->dst[w->pos++] = 0;
    }
    if (bit) w->dst[w->word + w->used / 8] |= 1u << (w->used % 8);
    w->used++;
}

static void number1(Writer1 *w, unsigned value, unsigned count) {
    for (unsigned i = 0; i < count; i++) bit1_out(w, (value >> i) & 1u);
}

static void table1_out(Writer1 *w) {
    number1(w, 16, 5);
    for (unsigned i = 0; i < 16; i++) number1(w, 4, 4);
}

static void symbol1_out(Writer1 *w, unsigned value) {
    unsigned index = 0;
    if (value == 1) index = 1;
    else if (value >= 2) {
        unsigned n = value;
        while (n >>= 1) index++;
        index++;
    }
    for (unsigned i = 4; i > 0; i--) bit1_out(w, (index >> (i - 1)) & 1u);
    if (index >= 2) number1(w, value - (1u << (index - 1)), index - 1);
}

static void literal1_out(Writer1 *w, const uint8_t *src, size_t count) {
    if (count > w->cap - w->pos) { w->bad = 1; return; }
    memcpy(w->dst + w->pos, src, count);
    w->pos += count;
}

static unsigned block1(const uint8_t *src, size_t size, Writer1 *w) {
    MatchFinder<4096, 255, 8> finder;
    size_t literal_at = 0, in = 0;
    unsigned chunks = 1;
    while (in < size) {
        auto match = finder.find(src, size, in);
        size_t count = match.length, distance = match.distance;
        if (count) {
            if (w) {
                symbol1_out(w, (unsigned)(in - literal_at));
                literal1_out(w, src + literal_at, in - literal_at);
                symbol1_out(w, (unsigned)(distance - 1));
                symbol1_out(w, (unsigned)(count - 2));
            }
            chunks++;
            literal_at = in + count;
        } else count = 1;
        finder.advance(src, size, in, count);
        in += count;
    }
    if (w) {
        symbol1_out(w, (unsigned)(size - literal_at));
        literal1_out(w, src + literal_at, size - literal_at);
    }
    return chunks;
}

int rnc1_encode(const uint8_t *src, size_t size, uint8_t *dst,
                size_t cap, size_t *written) {
    if (!src || !dst || !written || size > UINT32_MAX || cap < 18) return -1;
    Writer1 w = {dst, cap, 18, 0, 0, 0};
    number1(&w, 0, 2); /* unlocked, unencrypted */
    for (size_t at = 0; at < size && !w.bad;) {
        size_t length = size - at < 32767 ? size - at : 32767;
        unsigned chunks = block1(src + at, length, NULL);
        table1_out(&w); table1_out(&w); table1_out(&w);
        number1(&w, chunks, 16);
        block1(src + at, length, &w);
        at += length;
    }
    if (w.bad || w.pos - 18 > UINT32_MAX) return -1;
    memcpy(dst, "RNC", 3); dst[3] = 1;
    PUT32(dst + 4, size); PUT32(dst + 8, w.pos - 18);
    PUT16(dst + 12, crc16(src, size));
    PUT16(dst + 14, crc16(dst + 18, w.pos - 18));
    dst[16] = dst[17] = 0;
    *written = w.pos;
    return 0;
}

typedef struct { uint8_t *dst; size_t cap, pos, control; unsigned left; int bad; } Writer;
static void emit_bit(Writer *w, unsigned bit) {
    if (!w->left) {
        if (w->pos == w->cap) { w->bad = 1; return; }
        w->control = w->pos++;
        w->dst[w->control] = 0;
        w->left = 8;
    }
    w->left--;
    if (bit) w->dst[w->control] |= 1u << w->left;
}
static void emit_byte(Writer *w, unsigned value) {
    if (w->pos == w->cap) { w->bad = 1; return; }
    w->dst[w->pos++] = (uint8_t)value;
}

static void emit_offset2(Writer *w, size_t distance) {
    unsigned value = (unsigned)(distance - 1);
    unsigned high = value >> 8;
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
        /* The length-nine escape is a raw run of 12,16,...,72 bytes. */
        emit_bit(w, 1); emit_bit(w, 0); emit_bit(w, 1);
        emit_bit(w, 1); emit_bit(w, 1);
        for (unsigned bit = 4; bit > 0; bit--)
            emit_bit(w, ((run - 12) / 4 >> (bit - 1)) & 1u);
        for (size_t j = 0; j < run; j++) emit_byte(w, src[start + j]);
        start += run; count -= run;
    }
    while (count--) { emit_bit(w, 0); emit_byte(w, src[start++]); }
}

int rnc2_encode(const uint8_t *src, size_t size, uint8_t *dst,
                size_t cap, size_t *written) {
    if (!src || !dst || !written || size > UINT32_MAX || cap < 20) return -1;
    Writer w = {dst, cap, 18, 0, 0, 0};
    emit_bit(&w, 0); emit_bit(&w, 0); /* unlocked, unencrypted */
    MatchFinder<4096, 263, 8> finder;
    size_t pending_at = 0, pending = 0;
    for (size_t i = 0; i < size && !w.bad;) {
        auto match = finder.find(src, size, i);
        size_t count = match.length, distance = match.distance;
        if (count) {
            emit_literals(&w, src, pending_at, pending);
            pending = 0;
            if (count >= 9) {
                emit_bit(&w, 1); emit_bit(&w, 1); emit_bit(&w, 1); emit_bit(&w, 1);
                emit_byte(&w, (unsigned)(count - 8));
            } else if (count == 3) {
                emit_bit(&w, 1); emit_bit(&w, 1); emit_bit(&w, 1); emit_bit(&w, 0);
            } else {
                emit_bit(&w, 1); emit_bit(&w, 0);
                emit_bit(&w, count == 5 || count == 8);
                emit_bit(&w, count >= 6);
                if (count >= 6) emit_bit(&w, count == 7);
            }
            emit_offset2(&w, distance);
        } else {
            count = 1;
            if (!pending) pending_at = i;
            pending++;
            if (pending == 72) { emit_literals(&w, src, pending_at, pending); pending = 0; }
        }
        finder.advance(src, size, i, count);
        i += count;
    }
    emit_literals(&w, src, pending_at, pending);
    for (int i = 0; i < 4; i++) emit_bit(&w, 1);
    emit_byte(&w, 0); emit_bit(&w, 0); /* method-2 end marker */
    if (w.bad || w.pos - 18 > UINT32_MAX) return -1;
    memcpy(dst, "RNC", 3); dst[3] = 2;
    PUT32(dst + 4, size); PUT32(dst + 8, w.pos - 18);
    PUT16(dst + 12, crc16(src, size));
    PUT16(dst + 14, crc16(dst + 18, w.pos - 18));
    dst[16] = dst[17] = 0;
    *written = w.pos;
    return 0;
}

} /* extern "C" */
