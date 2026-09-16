/* BattleTanx LZARI: 4 KiB ring and adaptive arithmetic symbols.
 * The reference encoder uses literal symbols only. It is valid but not compact.
 * No heap allocation; return 0 on success, -1 on bad input or short output.
 */
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#define N 4096
#define F 60
#define NCHAR 314
#define Q1 0x8000u
#define Q2 0x10000u
#define Q3 0x18000u
#define Q4 0x20000u
#define MAXCUM 0x7fffu
#define BE32(p) ((uint32_t)(p)[0] << 24 | (uint32_t)(p)[1] << 16 | (uint32_t)(p)[2] << 8 | (p)[3])
#define PUT32(p, n) do { \
    (p)[0] = (uint8_t)((n) >> 24); (p)[1] = (uint8_t)((n) >> 16); \
    (p)[2] = (uint8_t)((n) >> 8); (p)[3] = (uint8_t)(n); \
} while (0)

typedef struct { uint16_t char_sym[NCHAR], sym_char[NCHAR + 1];
                 uint16_t freq[NCHAR + 1], cum[NCHAR + 1]; } Model;
typedef struct { const uint8_t *data; size_t size, bit; int bad; } Reader;
typedef struct { uint8_t *data; size_t cap, bit; unsigned pending; int bad; } Writer;

static void start_model(Model *m) {
    memset(m, 0, sizeof *m);
    for (int i = NCHAR; i >= 1; i--) {
        m->char_sym[i - 1] = (uint16_t)i;
        m->sym_char[i] = (uint16_t)(i - 1);
        m->freq[i] = 1;
        m->cum[i - 1] = (uint16_t)(m->cum[i] + 1);
    }
}

static void update(Model *m, unsigned sym) {
    if (m->cum[0] >= MAXCUM) {
        unsigned sum = 0;
        for (int i = NCHAR; i >= 1; i--) {
            m->cum[i] = (uint16_t)sum;
            m->freq[i] = (uint16_t)((m->freq[i] + 1) >> 1);
            sum += m->freq[i];
        }
        m->cum[0] = (uint16_t)sum;
    }
    unsigned i = sym;
    while (m->freq[i] == m->freq[i - 1]) i--;
    if (i < sym) {
        unsigned a = m->sym_char[i], b = m->sym_char[sym];
        m->sym_char[i] = (uint16_t)b; m->sym_char[sym] = (uint16_t)a;
        m->char_sym[a] = (uint16_t)sym; m->char_sym[b] = (uint16_t)i;
    }
    m->freq[i]++;
    do { m->cum[--i]++; } while (i);
}

static unsigned get_bit(Reader *r) {
    if (r->bit / 8 >= r->size) {
        if (r->bit / 8 >= r->size + 4) r->bad = 1;
        r->bit++;
        return 0; /* the original decoder reads past the final arithmetic bits */
    }
    unsigned value = (r->data[r->bit / 8] >> (7 - r->bit % 8)) & 1u;
    r->bit++;
    return value;
}

static void renorm_decode(Reader *r, uint32_t *low, uint32_t *high,
                          uint32_t *value) {
    for (;;) {
        if (*low >= Q2) {
            *value -= Q2; *low -= Q2; *high -= Q2;
        } else if (*low >= Q1 && *high <= Q3) {
            *value -= Q1; *low -= Q1; *high -= Q1;
        } else if (*high > Q2) break;
        *low *= 2; *high *= 2;
        *value = *value * 2 + get_bit(r);
    }
}

static unsigned decode_interval(Reader *r, uint32_t *low, uint32_t *high,
                                uint32_t *value, const uint16_t *cum,
                                unsigned count) {
    uint32_t range = *high - *low;
    if (!range || *value < *low || *value >= *high) { r->bad = 1; return 1; }
    uint32_t x = (uint32_t)((((uint64_t)(*value - *low + 1) * cum[0]) - 1) / range);
    if (x >= cum[0]) { r->bad = 1; return 1; }
    unsigned i = 1, j = count;
    while (i < j) {
        unsigned k = (i + j) / 2;
        if (cum[k] > x) i = k + 1; else j = k;
    }
    uint32_t base = *low;
    *high = base + (uint32_t)((uint64_t)range * cum[i - 1] / cum[0]);
    *low = base + (uint32_t)((uint64_t)range * cum[i] / cum[0]);
    renorm_decode(r, low, high, value);
    return i;
}

int lzari_decode(const uint8_t *src, size_t size, uint8_t *dst,
                 size_t cap, size_t *written) {
    if (!src || !dst || !written || size < 4) return -1;
    size_t output_size = BE32(src);
    if (!output_size || output_size > cap) return -1;
    Reader r = {src + 4, size - 4, 0, 0};
    Model model; start_model(&model);
    uint16_t position[N + 1] = {0};
    for (int i = N; i >= 1; i--)
        position[i - 1] = (uint16_t)(position[i] + 10000 / (i + 200));
    uint8_t ring[N] = {0}; memset(ring, 0x20, N - F);
    size_t out = 0, ring_at = N - F;
    uint32_t low = 0, high = Q4, value = 0;
    for (int i = 0; i < 17; i++) value = value * 2 + get_bit(&r);
    while (out < output_size && !r.bad) {
        unsigned sym = decode_interval(&r, &low, &high, &value, model.cum, NCHAR);
        unsigned ch = model.sym_char[sym];
        update(&model, sym);
        if (ch < 256) {
            dst[out++] = (uint8_t)ch;
            ring[ring_at++ & (N - 1)] = (uint8_t)ch;
        } else {
            unsigned pos = decode_interval(&r, &low, &high, &value, position, N) - 1;
            size_t from = (ring_at - pos - 1) & (N - 1);
            size_t count = ch - 253; /* 3..60 */
            while (count-- && out < output_size) {
                uint8_t byte = ring[from++ & (N - 1)];
                dst[out++] = byte;
                ring[ring_at++ & (N - 1)] = byte;
            }
        }
    }
    if (r.bad) return -1;
    *written = out;
    return 0;
}

static void put_bit(Writer *w, unsigned bit) {
    if (w->bit / 8 >= w->cap) { w->bad = 1; return; }
    if (!(w->bit % 8)) w->data[w->bit / 8] = 0;
    if (bit) w->data[w->bit / 8] |= 0x80u >> (w->bit % 8);
    w->bit++;
}

static void put_follow(Writer *w, unsigned bit) {
    put_bit(w, bit);
    while (w->pending) { put_bit(w, !bit); w->pending--; }
}

static void encode_interval(Writer *w, uint32_t *low, uint32_t *high,
                            const uint16_t *cum, unsigned sym) {
    uint32_t range = *high - *low, base = *low;
    *high = base + (uint32_t)((uint64_t)range * cum[sym - 1] / cum[0]);
    *low = base + (uint32_t)((uint64_t)range * cum[sym] / cum[0]);
    for (;;) {
        if (*high <= Q2) put_follow(w, 0);
        else if (*low >= Q2) { put_follow(w, 1); *low -= Q2; *high -= Q2; }
        else if (*low >= Q1 && *high <= Q3) {
            w->pending++; *low -= Q1; *high -= Q1;
        } else break;
        *low *= 2; *high *= 2;
    }
}

int lzari_encode(const uint8_t *src, size_t size, uint8_t *dst,
                 size_t cap, size_t *written) {
    if (!src || !dst || !written || !size || size > UINT32_MAX || cap < 8) return -1;
    Model model; start_model(&model);
    PUT32(dst, size);
    Writer w = {dst + 4, cap - 4, 0, 0, 0};
    uint32_t low = 0, high = Q4;
    for (size_t i = 0; i < size && !w.bad; i++) {
        unsigned sym = model.char_sym[src[i]];
        encode_interval(&w, &low, &high, model.cum, sym);
        update(&model, sym);
    }
    w.pending++;
    put_follow(&w, low < Q1 ? 0 : 1);
    /* Arithmetic decoders initialise with 17 bits and may read ahead. */
    for (unsigned i = 0; i < 17; i++) put_bit(&w, 0);
    if (w.bad) return -1;
    *written = 4 + (w.bit + 7) / 8;
    return 0;
}
