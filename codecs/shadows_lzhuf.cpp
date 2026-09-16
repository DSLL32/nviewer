/* Shadows of the Empire: adaptive Huffman symbols plus fixed-table distances.
 * Pass the release's 256-byte d_code and d_len tables from its boot preamble.
 * Return 0 on success, -1 on malformed input or insufficient output space.
 */
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <vector>

#define BE32(p) ((uint32_t)(p)[0] << 24 | (uint32_t)(p)[1] << 16 | \
                 (uint32_t)(p)[2] << 8 | (p)[3])
#define PUT32(p, n) do { \
    (p)[0] = (uint8_t)((n) >> 24); (p)[1] = (uint8_t)((n) >> 16); \
    (p)[2] = (uint8_t)((n) >> 8); (p)[3] = (uint8_t)(n); \
} while (0)

enum { NCHAR = 314, T = 627, ROOT = 626 };

namespace {

struct Bits {
    const uint8_t *src;
    uint8_t *dst;
    size_t size, cap, pos;
    unsigned left, byte;
    bool bad;
    unsigned get() {
        if (!left) {
            if (pos >= size) { bad = true; return 0; }
            byte = src[pos++]; left = 8;
        }
        return (byte >> --left) & 1;
    }
    unsigned get8() {
        unsigned value = 0;
        for (int i = 0; i < 8; i++) value = (value << 1) | get();
        return value;
    }
    void put(unsigned bit) {
        if (!left) {
            if (pos >= cap) { bad = true; return; }
            dst[pos] = 0; left = 8;
        }
        if (bit) dst[pos] |= (uint8_t)(1u << (left - 1));
        if (!--left) pos++;
    }
    void putn(unsigned value, unsigned count) {
        while (count) put((value >> --count) & 1);
    }
    size_t bytes() const { return pos + (left && dst ? 1 : 0); }
};

struct Tree {
    uint16_t freq[T + 1] = {};
    uint16_t son[T] = {};
    uint16_t parent[T + NCHAR] = {};

    Tree() {
        for (unsigned i = 0; i < NCHAR; i++) {
            freq[i] = 1; son[i] = i + T; parent[i + T] = i;
        }
        for (unsigned i = 0, j = NCHAR; j < T; i += 2, j++) {
            freq[j] = freq[i] + freq[i + 1];
            son[j] = i; parent[i] = parent[i + 1] = j;
        }
        freq[T] = 0xffff;
        parent[ROOT] = 0;
    }

    void reconstruct() {
        unsigned j = 0;
        for (unsigned i = 0; i < T; i++) {
            if (son[i] >= T) {
                freq[j] = (freq[i] + 1) >> 1;
                son[j++] = son[i];
            }
        }
        for (unsigned i = 0, k = NCHAR; k < T; i += 2, k++) {
            unsigned count = freq[i] + freq[i + 1];
            int at = (int)k - 1;
            while (count < freq[at]) at--;
            at++;
            for (int p = (int)k; p > at; p--) {
                freq[p] = freq[p - 1]; son[p] = son[p - 1];
            }
            freq[at] = count; son[at] = i;
        }
        for (unsigned i = 0; i < T; i++) {
            unsigned child = son[i];
            parent[child] = i;
            if (child < T) parent[child + 1] = i;
        }
    }

    void update(unsigned symbol) {
        if (freq[ROOT] == 0x8000) reconstruct();
        unsigned node = parent[symbol + T];
        do {
            unsigned count = ++freq[node], next = node + 1;
            if (count > freq[next]) {
                while (count > freq[next + 1]) next++;
                freq[node] = freq[next]; freq[next] = count;
                unsigned a = son[node], b = son[next];
                son[node] = b; son[next] = a;
                parent[a] = next; parent[b] = node;
                if (a < T) parent[a + 1] = next;
                if (b < T) parent[b + 1] = node;
                node = next;
            }
            node = parent[node];
        } while (node);
    }

    unsigned decode(Bits &bits) {
        unsigned node = son[ROOT];
        while (node < T && !bits.bad) node = son[node + bits.get()];
        if (bits.bad) return 0;
        unsigned symbol = node - T;
        update(symbol);
        return symbol;
    }

    void encode(Bits &bits, unsigned symbol) {
        unsigned path[T];
        unsigned count = 0, node = parent[symbol + T];
        while (node != ROOT) {
            unsigned up = parent[node];
            path[count++] = node == (unsigned)son[up] + 1;
            node = up;
        }
        while (count) bits.put(path[--count]);
        update(symbol);
    }
};

} // namespace

int shadows_lzhuf_decode(const uint8_t *src, size_t size, uint8_t *dst,
                         size_t cap, const uint8_t *d_code, const uint8_t *d_len,
                         size_t *written, size_t *consumed) {
    if (!src || !dst || !d_code || !d_len || !written || !consumed || size < 4) return -1;
    size_t output_size = BE32(src);
    if (output_size > cap) return -1;
    Bits bits{src + 4, nullptr, size - 4, 0, 0, 0, 0, false};
    Tree tree;
    uint8_t ring[4096] = {};
    std::memset(ring, 0x20, 4036);
    unsigned cursor = 4036;
    size_t out = 0;
    while (out < output_size && !bits.bad) {
        unsigned symbol = tree.decode(bits);
        if (bits.bad) break;
        if (symbol < 256) {
            dst[out++] = (uint8_t)symbol;
            ring[cursor++ & 4095] = (uint8_t)symbol;
        } else {
            unsigned first = bits.get8();
            unsigned length = d_len[first], distance = (unsigned)d_code[first] << 6;
            if (length < 2 || length > 8 || d_code[first] > 63) return -1;
            for (unsigned i = 2; i < length; i++) first = (first << 1) | bits.get();
            if (bits.bad) break;
            distance |= first & 63;
            unsigned count = symbol - 253;
            while (count-- && out < output_size) {
                uint8_t byte = ring[(cursor - distance - 1) & 4095];
                dst[out++] = byte;
                ring[cursor++ & 4095] = byte;
            }
        }
    }
    if (bits.bad) return -1;
    *written = out;
    *consumed = bits.pos + 4;
    return 0;
}

static unsigned hash3(const uint8_t *p) {
    return ((unsigned)p[0] * 251u + (unsigned)p[1] * 31u + p[2]) & 8191;
}

int shadows_lzhuf_encode(const uint8_t *src, size_t size, uint8_t *dst,
                         size_t cap, const uint8_t *d_code, const uint8_t *d_len,
                         size_t *written) {
    if (!src || !dst || !d_code || !d_len || !written || size > 0x7fffffffu || cap < 4)
        return -1;
    unsigned prefix[64] = {}, width[64] = {};
    for (unsigned first = 0; first < 256; first++) {
        unsigned q = d_code[first], length = d_len[first];
        if (q < 64 && length >= 2 && length <= 8 && !width[q]) {
            prefix[q] = first >> (8 - length);
            width[q] = length;
        }
    }
    for (unsigned q = 0; q < 64; q++) if (!width[q]) return -1;
    PUT32(dst, (uint32_t)size);
    Bits bits{nullptr, dst + 4, 0, cap - 4, 0, 0, 0, false};
    Tree tree;
    std::vector<int32_t> head(8192, -1), prev(size, -1);
    for (size_t in = 0; in < size && !bits.bad;) {
        unsigned best = 0, distance = 0;
        if (size - in >= 3) {
            int32_t at = head[hash3(src + in)];
            for (unsigned depth = 0; at >= 0 && depth < 128; depth++, at = prev[at]) {
                size_t old = (size_t)at;
                if (in - old > 4096) break;
                unsigned length = 0, limit = (unsigned)((size - in < 60) ? size - in : 60);
                while (length < limit && src[old + length] == src[in + length]) length++;
                if (length > best) { best = length; distance = (unsigned)(in - old); }
                if (best == 60) break;
            }
        }
        if (best >= 3) {
            tree.encode(bits, best + 253);
            unsigned value = distance - 1, q = value >> 6;
            bits.putn(prefix[q], width[q]);
            bits.putn(value & 63, 6);
        } else {
            best = 1;
            tree.encode(bits, src[in]);
        }
        for (unsigned j = 0; j < best; j++) {
            size_t p = in + j;
            if (size - p >= 3) {
                unsigned hash = hash3(src + p);
                prev[p] = head[hash]; head[hash] = (int32_t)p;
            }
        }
        in += best;
    }
    if (bits.bad) return -1;
    *written = bits.bytes() + 4;
    return 0;
}
