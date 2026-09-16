/* Pokémon Snap VPK0. Bounded, allocation-free tree decoder and a simple
 * fixed-tree encoder for either offset method. Both use complete buffers. */
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include "common/match_finder.hpp"

extern "C" {

#define BE32(p) ((uint32_t)(p)[0] << 24 | (uint32_t)(p)[1] << 16 | (uint32_t)(p)[2] << 8 | (p)[3])
#define PUT32(p, n) do { \
    (p)[0] = (uint8_t)((n) >> 24); (p)[1] = (uint8_t)((n) >> 16); \
    (p)[2] = (uint8_t)((n) >> 8); (p)[3] = (uint8_t)(n); \
} while (0)

typedef struct { const uint8_t *bytes; size_t size, bit; } Reader;
typedef struct { uint8_t *bytes; size_t cap, bit; } Writer;
typedef struct { int left, right; unsigned width; } Node;
typedef struct { Node nodes[511]; int root; } Tree;

static int read_bits(Reader *r, unsigned count, unsigned *value) {
    if (count > 24 || r->bit / 8 > r->size ||
        count > (r->size - r->bit / 8) * 8 - r->bit % 8) return -1;
    unsigned n = 0;
    while (count--) {
        n = (n << 1) | ((r->bytes[r->bit / 8] >> (7 - r->bit % 8)) & 1u);
        r->bit++;
    }
    *value = n;
    return 0;
}

static int read_tree(Reader *r, Tree *tree) {
    int stack[511], top = 0, used = 0;
    for (;;) {
        unsigned bit, width;
        if (read_bits(r, 1, &bit)) return -1;
        if (bit && top < 2) {
            if (top != 1) return -1;
            tree->root = stack[0];
            return 0;
        }
        if (used == 511) return -1;
        Node *n = &tree->nodes[used];
        if (bit) {
            n->right = stack[--top];
            n->left = stack[--top];
            n->width = 0;
        } else {
            if (read_bits(r, 8, &width) || width > 24) return -1;
            n->left = n->right = -1;
            n->width = width;
        }
        stack[top++] = used++;
    }
}

static int tree_value(Reader *r, const Tree *tree, unsigned *value) {
    int node = tree->root;
    while (tree->nodes[node].left >= 0) {
        unsigned bit;
        if (read_bits(r, 1, &bit)) return -1;
        node = bit ? tree->nodes[node].right : tree->nodes[node].left;
    }
    return read_bits(r, tree->nodes[node].width, value);
}

int vpk0_decode(const uint8_t *src, size_t size, uint8_t *dst,
                size_t cap, size_t *written) {
    if (!src || !dst || !written || size < 9 || memcmp(src, "vpk0", 4)) return -1;
    size_t out_size = BE32(src + 4), out = 0;
    if (out_size > cap) return -1;
    Reader r = {src + 8, size - 8, 0};
    unsigned method;
    Tree offsets, lengths;
    if (read_bits(&r, 8, &method) || method > 1 ||
        read_tree(&r, &offsets) || read_tree(&r, &lengths)) return -1;
    while (out < out_size) {
        unsigned token;
        if (read_bits(&r, 1, &token)) return -1;
        if (!token) {
            unsigned literal;
            if (read_bits(&r, 8, &literal)) return -1;
            dst[out++] = (uint8_t)literal;
        } else {
            unsigned v, length;
            if (tree_value(&r, &offsets, &v)) return -1;
            size_t distance;
            if (method) {
                unsigned adjust = 0;
                if (v <= 2) {
                    adjust = v + 1;
                    if (tree_value(&r, &offsets, &v)) return -1;
                }
                distance = (size_t)v * 4 + adjust - 8;
            } else distance = v;
            if (tree_value(&r, &lengths, &length) || !distance ||
                distance > out || !length || length > out_size - out) return -1;
            while (length--) { dst[out] = dst[out - distance]; out++; }
        }
    }
    *written = out;
    return 0;
}

static int put_bits(Writer *w, unsigned count, unsigned value) {
    if (w->bit / 8 > w->cap || count > (w->cap - w->bit / 8) * 8 - w->bit % 8)
        return -1;
    while (count--) {
        if (!(w->bit % 8)) w->bytes[w->bit / 8] = 0;
        if (value & (1u << count)) w->bytes[w->bit / 8] |= 0x80u >> (w->bit % 8);
        w->bit++;
    }
    return 0;
}


int vpk0_encode(const uint8_t *src, size_t size, uint8_t *dst,
                size_t cap, size_t *written, unsigned method) {
    if (!src || !dst || !written || method > 1 || size > UINT32_MAX || cap < 11)
        return -1;
    memcpy(dst, "vpk0", 4); PUT32(dst + 4, size);
    Writer w = {dst + 8, cap - 8, 0};
    if (put_bits(&w, 8, method) ||
        /* Fixed-width offset and length leaves, each followed by tree-end. */
        put_bits(&w, 1, 0) || put_bits(&w, 8, 16) || put_bits(&w, 1, 1) ||
        put_bits(&w, 1, 0) || put_bits(&w, 8, 8) || put_bits(&w, 1, 1)) return -1;
    MatchFinder<4096, 255> finder;
    for (size_t i = 0; i < size;) {
        auto match = finder.find(src, size, i);
        size_t count = match.length, distance = match.distance;
        if (count && count < (method && distance % 4 ? 5u : 3u)) count = 0;
        if (count) {
            unsigned adjust = method ? (unsigned)(distance % 4) : 0;
            unsigned value = method ? (unsigned)((distance + 8 - adjust) / 4)
                                    : (unsigned)distance;
            if (put_bits(&w, 1, 1) ||
                (adjust && put_bits(&w, 16, adjust - 1)) ||
                put_bits(&w, 16, value) || put_bits(&w, 8, (unsigned)count)) return -1;
        } else {
            if (put_bits(&w, 1, 0) || put_bits(&w, 8, src[i])) return -1;
            count = 1;
        }
        finder.advance(src, size, i, count);
        i += count;
    }
    *written = 8 + (w.bit + 7) / 8;
    return 0;
}

} /* extern "C" */
