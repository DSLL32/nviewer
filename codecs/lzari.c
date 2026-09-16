/* BattleTanx LZARI: 4 KiB ring and adaptive arithmetic symbols.
 * Return 0 on success, -1 on bad input, allocation failure or short output.
 */
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define N 4096
#define F 60
#define NCHAR 314
#define Q1 0x8000u
#define Q2 0x10000u
#define Q3 0x18000u
#define Q4 0x20000u
#define MAXCUM 0x7fffu
#define HASH_SIZE 4096
#define OPTIMAL_PASSES 20
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

typedef struct { size_t head[HASH_SIZE], next[N]; } Matches;
typedef struct { unsigned length, distance; } Match;

static unsigned match_hash(const uint8_t *p) {
    return (p[0] * 251u + p[1] * 31u + p[2]) & (HASH_SIZE - 1);
}

static void matches_start(Matches *m) {
    for (unsigned i = 0; i < HASH_SIZE; i++) m->head[i] = SIZE_MAX;
}

static void matches_add(Matches *m, const uint8_t *src, size_t size, size_t at) {
    if (size - at < 3) return;
    unsigned hash = match_hash(src + at);
    m->next[at & (N - 1)] = m->head[hash];
    m->head[hash] = at;
}

static Match matches_find(const Matches *m, const uint8_t *src,
                          size_t size, size_t at, unsigned depth) {
    Match best = {0, 0};
    size_t limit = size - at < F ? size - at : F;
    if (limit < 3) return best;
    size_t prev = m->head[match_hash(src + at)];
    for (unsigned search = 0; search < depth && prev != SIZE_MAX &&
         at - prev <= N; search++) {
        unsigned length = 0;
        while (length < limit && src[prev + length] == src[at + length]) length++;
        unsigned distance = (unsigned)(at - prev);
        if (length > best.length || (length == best.length && length >= 3 &&
                                     distance < best.distance)) {
            best.length = length;
            best.distance = distance;
            if (length == F) break;
        }
        prev = m->next[prev & (N - 1)];
    }
    /* The ring initially contains 4,036 spaces before its write cursor. */
    if (src[at] == 0x20 && (!at || src[at - 1] == 0x20)) {
        unsigned length = 0;
        while (length < limit && src[at + length] == 0x20) length++;
        if (length >= 3 && (length > best.length ||
            (length == best.length && 1 < best.distance))) {
            best.length = length;
            best.distance = 1;
        }
    }
    return best;
}

/* Level 9 keeps the cheapest distance for every possible match length.
 * The position model favors closer distances, so the first match found at
 * each length is the cheapest one. Rows are built once before parsing.
 */
typedef struct { uint16_t distance[F + 1]; } MatchRow;

static unsigned row_best_length(const MatchRow *row) {
    for (unsigned length = F; length >= 3; length--)
        if (row->distance[length]) return length;
    return 0;
}

static void build_rows(MatchRow *rows, const uint8_t *src, size_t size) {
    Matches matches; matches_start(&matches);
    for (size_t at = 0; at < size; at++) {
        MatchRow *row = &rows[at];
        size_t limit = size - at < F ? size - at : F;
        if (src[at] == 0x20 && (!at || src[at - 1] == 0x20)) {
            unsigned length = 0;
            while (length < limit && src[at + length] == 0x20) length++;
            for (unsigned j = 3; j <= length; j++) row->distance[j] = 1;
        }
        if (limit >= 3 && !row->distance[limit]) {
            size_t prev = matches.head[match_hash(src + at)];
            for (unsigned search = 0; search < N && prev != SIZE_MAX &&
                 at - prev <= N; search++) {
                unsigned length = 0;
                while (length < limit && src[prev + length] == src[at + length]) length++;
                unsigned distance = (unsigned)(at - prev);
                for (unsigned j = 3; j <= length; j++)
                    if (!row->distance[j]) row->distance[j] = (uint16_t)distance;
                if (row->distance[limit]) break;
                prev = matches.next[prev & (N - 1)];
            }
        }
        matches_add(&matches, src, size, at);
    }
}

/* Fixed-point approximation to log2, in 1/256-bit units. */
static int log2_256(uint64_t value) {
    unsigned bits = 0;
    uint64_t top = value;
    while (top >= 2) { top >>= 1; bits++; }
    return (int)(bits * 256 + (value * 256 >> bits) - 256);
}

static void count_symbols(const uint8_t *src, size_t size,
                          const uint8_t *chosen, const MatchRow *rows,
                          size_t counts[NCHAR]) {
    for (unsigned j = 0; j < NCHAR; j++) counts[j] = 1;
    for (size_t i = 0; i < size;) {
        unsigned length;
        if (chosen) length = chosen[i];
        else {
            length = row_best_length(&rows[i]);
            if (length && i + 1 < size && row_best_length(&rows[i + 1]) > length)
                length = 0;
        }
        if (length >= 3) { counts[253 + length]++; i += length; }
        else { counts[src[i]]++; i++; }
    }
}

static int encode_optimal(const uint8_t *src, size_t size, uint8_t *dst,
                          size_t cap, size_t *written) {
    if (size > SIZE_MAX / sizeof(MatchRow)) return -1;
    MatchRow *rows = calloc(size, sizeof *rows);
    uint64_t *cost = malloc((size + 1) * sizeof *cost);
    uint8_t *chosen = malloc(size);
    uint16_t *chosen_distance = malloc(size * sizeof *chosen_distance);
    if (!rows || !cost || !chosen || !chosen_distance) goto fail;
    build_rows(rows, src, size);
    uint16_t position[N + 1] = {0};
    int distance_price[N + 1];
    for (int k = N; k >= 1; k--)
        position[k - 1] = (uint16_t)(position[k] + 10000 / (k + 200));
    for (int k = 1; k <= N; k++)
        distance_price[k] = log2_256(position[0]) -
                            log2_256(position[k - 1] - position[k]);
    size_t counts[NCHAR];
    count_symbols(src, size, NULL, rows, counts);
    /* Re-estimate symbol prices from each parse, then solve the shortest path
     * through literal and match choices. Prices approximate the adaptive
     * arithmetic coder; this is not a proof of globally optimal output.
     */
    for (unsigned pass = 0; pass < OPTIMAL_PASSES; pass++) {
        size_t total = 0;
        for (unsigned j = 0; j < NCHAR; j++) total += counts[j];
        int symbol_price[NCHAR];
        for (unsigned j = 0; j < NCHAR; j++)
            symbol_price[j] = log2_256(total) - log2_256(counts[j]);
        cost[size] = 0;
        for (size_t i = size; i-- > 0;) {
            uint64_t best = cost[i + 1] + symbol_price[src[i]];
            unsigned length = 1, distance = 0;
            unsigned limit = size - i < F ? (unsigned)(size - i) : F;
            for (unsigned j = 3; j <= limit; j++) {
                unsigned d = rows[i].distance[j];
                if (!d) continue;
                uint64_t candidate = cost[i + j] + symbol_price[253 + j] +
                                     distance_price[d];
                if (candidate < best) {
                    best = candidate; length = j; distance = d;
                }
            }
            cost[i] = best;
            chosen[i] = (uint8_t)length;
            chosen_distance[i] = (uint16_t)distance;
        }
        count_symbols(src, size, chosen, rows, counts);
    }
    Model model; start_model(&model);
    PUT32(dst, size);
    Writer w = {dst + 4, cap - 4, 0, 0, 0};
    uint32_t low = 0, high = Q4;
    for (size_t i = 0; i < size && !w.bad;) {
        unsigned length = chosen[i];
        unsigned sym = model.char_sym[length >= 3 ? 253 + length : src[i]];
        encode_interval(&w, &low, &high, model.cum, sym);
        update(&model, sym);
        if (length >= 3) {
            encode_interval(&w, &low, &high, position, chosen_distance[i]);
            i += length;
        } else i++;
    }
    w.pending++;
    put_follow(&w, low < Q1 ? 0 : 1);
    for (unsigned i = 0; i < 17; i++) put_bit(&w, 0);
    free(rows); free(cost); free(chosen); free(chosen_distance);
    if (w.bad) return -1;
    *written = 4 + (w.bit + 7) / 8;
    return 0;
fail:
    free(rows); free(cost); free(chosen); free(chosen_distance);
    return -1;
}

int lzari_encode_ex(const uint8_t *src, size_t size, uint8_t *dst,
                    size_t cap, size_t *written, unsigned level) {
    static const unsigned depth[9] = {0, 1, 4, 16, 32, 64, 128, 256, 512};
    if (!src || !dst || !written || !size || size > UINT32_MAX || cap < 8 ||
        level > 9) return -1;
    if (level == 9) return encode_optimal(src, size, dst, cap, written);
    Model model; start_model(&model);
    PUT32(dst, size);
    Writer w = {dst + 4, cap - 4, 0, 0, 0};
    uint32_t low = 0, high = Q4;
    uint16_t position[N + 1] = {0};
    for (int k = N; k >= 1; k--)
        position[k - 1] = (uint16_t)(position[k] + 10000 / (k + 200));
    Matches matches;
    if (level) matches_start(&matches);
    size_t indexed = 0;
    for (size_t i = 0; i < size && !w.bad;) {
        Match match = {0, 0};
        if (level) {
            while (indexed < i) matches_add(&matches, src, size, indexed++);
            match = matches_find(&matches, src, size, i, depth[level]);
        }
        /* A one-byte delay often turns a short match into a longer one. */
        if (level >= 6 && match.length >= 3 && i + 1 < size) {
            matches_add(&matches, src, size, indexed++);
            Match next = matches_find(&matches, src, size, i + 1, depth[level]);
            if (next.length > match.length) match.length = 0;
        }
        unsigned sym = model.char_sym[match.length >= 3 ?
                                      253 + match.length : src[i]];
        encode_interval(&w, &low, &high, model.cum, sym);
        update(&model, sym);
        if (match.length >= 3) {
            encode_interval(&w, &low, &high, position, match.distance);
            i += match.length;
        } else i++;
    }
    w.pending++;
    put_follow(&w, low < Q1 ? 0 : 1);
    /* Arithmetic decoders initialise with 17 bits and may read ahead. */
    for (unsigned i = 0; i < 17; i++) put_bit(&w, 0);
    if (w.bad) return -1;
    *written = 4 + (w.bit + 7) / 8;
    return 0;
}

int lzari_encode(const uint8_t *src, size_t size, uint8_t *dst,
                 size_t cap, size_t *written) {
    return lzari_encode_ex(src, size, dst, cap, written, 9);
}
