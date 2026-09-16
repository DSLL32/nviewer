/* Air Boarder 64's BE-size-prefixed, headerless LH5-family stream.
 * The encoder uses fixed canonical trees and a short hash chain.
 * No heap allocation. Both functions return 0 on success, -1 on error.
 */
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#define BE32(p) ((uint32_t)(p)[0] << 24 | (uint32_t)(p)[1] << 16 | (uint32_t)(p)[2] << 8 | (p)[3])
#define PUT32(p, n) do { \
    (p)[0] = (uint8_t)((n) >> 24); (p)[1] = (uint8_t)((n) >> 16); \
    (p)[2] = (uint8_t)((n) >> 8); (p)[3] = (uint8_t)(n); \
} while (0)

typedef struct { const uint8_t *data; size_t size, bit; } Reader;
typedef struct { uint8_t *data; size_t size, bit; } Writer;
typedef struct { int child[2], symbol; } Node;
typedef struct { Node nodes[1023]; int used, constant; } Huffman;

static int bits(Reader *r, unsigned n, unsigned *value) {
    if (n > 24 || r->bit / 8 > r->size ||
        n > (r->size - r->bit / 8) * 8 - r->bit % 8) return -1;
    unsigned v = 0;
    while (n--) {
        v = (v << 1) | ((r->data[r->bit / 8] >> (7 - r->bit % 8)) & 1u);
        r->bit++;
    }
    *value = v;
    return 0;
}

static int put(Writer *w, unsigned n, unsigned value) {
    if (w->bit / 8 > w->size || n > (w->size - w->bit / 8) * 8 - w->bit % 8)
        return -1;
    while (n--) {
        if (!(w->bit % 8)) w->data[w->bit / 8] = 0;
        if (value & (1u << n)) w->data[w->bit / 8] |= 0x80u >> (w->bit % 8);
        w->bit++;
    }
    return 0;
}

static int new_node(Huffman *h) {
    if (h->used == 1023) return -1;
    int i = h->used++;
    h->nodes[i].child[0] = h->nodes[i].child[1] = -1;
    h->nodes[i].symbol = -1;
    return i;
}

static int build(Huffman *h, const uint8_t *lengths, unsigned count) {
    unsigned frequencies[17] = {0}, next[17] = {0};
    for (unsigned i = 0; i < count; i++) {
        if (lengths[i] > 16) return -1;
        if (lengths[i]) frequencies[lengths[i]]++;
    }
    unsigned code = 0;
    for (unsigned n = 1; n <= 16; n++) {
        code = (code + frequencies[n - 1]) * 2;
        next[n] = code;
        if (code + frequencies[n] > (1u << n)) return -1;
    }
    h->used = 0; h->constant = -1;
    if (new_node(h) < 0) return -1;
    for (unsigned s = 0; s < count; s++) {
        unsigned n = lengths[s];
        if (!n) continue;
        unsigned word = next[n]++;
        int node = 0;
        while (n--) {
            unsigned bit = (word >> n) & 1u;
            int child = h->nodes[node].child[bit];
            if (child < 0) {
                child = new_node(h);
                if (child < 0) return -1;
                h->nodes[node].child[bit] = child;
            }
            node = child;
        }
        if (h->nodes[node].symbol >= 0) return -1;
        h->nodes[node].symbol = (int)s;
    }
    return 0;
}

static int symbol(Reader *r, const Huffman *h, unsigned *value) {
    if (h->constant >= 0) { *value = (unsigned)h->constant; return 0; }
    int node = 0;
    for (unsigned depth = 0; depth < 16; depth++) {
        unsigned bit;
        if (bits(r, 1, &bit)) return -1;
        node = h->nodes[node].child[bit];
        if (node < 0) return -1;
        if (h->nodes[node].symbol >= 0) {
            *value = (unsigned)h->nodes[node].symbol;
            return 0;
        }
    }
    return -1;
}

static int pt_tree(Reader *r, Huffman *h, unsigned count,
                   unsigned count_bits, int special) {
    unsigned used;
    if (bits(r, count_bits, &used) || used > count) return -1;
    if (!used) {
        unsigned constant;
        if (bits(r, count_bits, &constant) || constant >= count) return -1;
        h->constant = (int)constant;
        return 0;
    }
    uint8_t lengths[19] = {0};
    unsigned at = 0;
    while (at < used) {
        unsigned n;
        if (bits(r, 3, &n)) return -1;
        if (n == 7) {
            unsigned more;
            do {
                if (bits(r, 1, &more)) return -1;
                n += more;
            } while (more && n <= 16);
        }
        if (at == count || n > 16) return -1;
        lengths[at++] = (uint8_t)n;
        if ((int)at == special) {
            unsigned zeros;
            if (bits(r, 2, &zeros) || zeros > count - at) return -1;
            at += zeros;
        }
    }
    return build(h, lengths, count);
}

static int char_tree(Reader *r, Huffman *h, const Huffman *pt) {
    unsigned used;
    if (bits(r, 9, &used) || used > 509) return -1;
    if (!used) {
        unsigned constant;
        if (bits(r, 9, &constant) || constant >= 509) return -1;
        h->constant = (int)constant;
        return 0;
    }
    uint8_t lengths[509] = {0};
    unsigned at = 0;
    while (at < used) {
        unsigned code;
        if (symbol(r, pt, &code)) return -1;
        if (code >= 3) {
            if (at == 509) return -1;
            lengths[at++] = (uint8_t)(code - 2);
        } else {
            unsigned zeros = 1, extra;
            if (code == 1) {
                if (bits(r, 4, &extra)) return -1;
                zeros = extra + 3;
            } else if (code == 2) {
                if (bits(r, 9, &extra)) return -1;
                zeros = extra + 20;
            }
            if (zeros > 509 - at) return -1;
            at += zeros;
        }
    }
    return build(h, lengths, 509);
}

int airboarder_lh5_decode(const uint8_t *src, size_t size, uint8_t *dst,
                          size_t cap, size_t *written) {
    if (!src || !dst || !written || size < 4) return -1;
    size_t out_size = BE32(src);
    if (!out_size || out_size > cap) return -1;
    Reader r = {src + 4, size - 4, 0};
    uint8_t ring[8192]; memset(ring, 0x20, sizeof ring);
    size_t out = 0, ring_at = 0;
    unsigned left = 0;
    Huffman pt, chars, positions;
    while (out < out_size) {
        if (!left) {
            if (bits(&r, 16, &left) || !left ||
                pt_tree(&r, &pt, 19, 5, 3) || char_tree(&r, &chars, &pt) ||
                pt_tree(&r, &positions, 14, 4, -1)) return -1;
        }
        left--;
        unsigned value;
        if (symbol(&r, &chars, &value)) return -1;
        if (value < 256) {
            dst[out++] = (uint8_t)value;
            ring[ring_at++ & 8191] = (uint8_t)value;
        } else {
            unsigned slot, extra = 0;
            if (symbol(&r, &positions, &slot) || slot > 13) return -1;
            if (slot && bits(&r, slot - 1, &extra)) return -1;
            size_t distance = slot ? (1u << (slot - 1)) + extra : 0;
            size_t source = (ring_at - distance - 1) & 8191;
            size_t length = value - 253;
            while (length-- && out < out_size) {
                uint8_t byte = ring[source++ & 8191];
                dst[out++] = byte;
                ring[ring_at++ & 8191] = byte;
            }
        }
    }
    *written = out;
    return 0;
}

#define HASH3(p) (((p)[0] * 251u + (p)[1] * 31u + (p)[2]) & 4095u)

static int block_tokens(const uint8_t *src, size_t size, Writer *w,
                        size_t *token_count) {
    size_t last[4096], chain[8192];
    for (size_t k = 0; k < 4096; k++) last[k] = SIZE_MAX;
    size_t in = 0, tokens = 0;
    while (in < size) {
        size_t count = 0, distance = 0;
        if (size - in >= 3) {
            size_t prev = last[HASH3(src + in)];
            for (unsigned tries = 0; tries < 8 && prev != SIZE_MAX &&
                     in - prev <= 8192; tries++) {
                size_t n = 0;
                while (n < 255 && n < size - in && src[prev + n] == src[in + n]) n++;
                if (n > count) { count = n; distance = in - prev; }
                prev = chain[prev & 8191];
            }
            if (count < 3) count = 0;
        }
        if (w) {
            if (!count) {
                if (put(w, 9, src[in])) return -1;
            } else {
                size_t d = distance - 1;
                unsigned slot = 0;
                while ((1u << slot) <= d) slot++;
                if (put(w, 9, (unsigned)(count + 253)) || put(w, 4, slot) ||
                    (slot && put(w, slot - 1, (unsigned)(d - (1u << (slot - 1))))))
                    return -1;
            }
        }
        if (!count) count = 1;
        for (size_t j = 0; j < count; j++) if (size - (in + j) >= 3) {
            size_t h = HASH3(src + in + j);
            chain[(in + j) & 8191] = last[h];
            last[h] = in + j;
        }
        in += count; tokens++;
    }
    *token_count = tokens;
    return 0;
}

int airboarder_lh5_encode(const uint8_t *src, size_t size, uint8_t *dst,
                          size_t cap, size_t *written) {
    if (!src || !dst || !written || !size || size > UINT32_MAX || cap < 4) return -1;
    PUT32(dst, size);
    Writer w = {dst + 4, cap - 4, 0};
    for (size_t at = 0; at < size;) {
        size_t length = size - at < 65535 ? size - at : 65535;
        size_t tokens, check;
        if (block_tokens(src + at, length, NULL, &tokens) ||
            put(&w, 16, (unsigned)tokens) ||
            /* A constant code-length tree: every character gets a 9-bit code. */
            put(&w, 5, 0) || put(&w, 5, 11) || put(&w, 9, 509) ||
            /* Four-bit canonical codes for the fourteen distance slots. */
            put(&w, 4, 14)) return -1;
        for (unsigned i = 0; i < 14; i++) if (put(&w, 3, 4)) return -1;
        if (block_tokens(src + at, length, &w, &check) || check != tokens) return -1;
        at += length;
    }
    *written = 4 + (w.bit + 7) / 8;
    return 0;
}
