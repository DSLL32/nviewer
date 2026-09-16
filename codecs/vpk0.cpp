/* Pokémon Snap VPK0. Both operations use complete buffers. */
#include <algorithm>
#include <array>
#include <new>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <utility>
#include <vector>

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

/* Each hash-chain search keeps the longest match for a given offset-value
 * width and (for method 1) adjustment. Matches in the same class have the
 * same bit cost; shorter ones cannot improve the following optimal parse. */
static constexpr unsigned kMaxMatch = 1023;
static constexpr unsigned kDirectWidths = 21, kEscapeWidths = 19;
static constexpr unsigned kClasses = kDirectWidths + 3 * kEscapeWidths;
typedef struct { uint32_t distance_minus_one; uint16_t length; } Match;
typedef std::array<Match, kClasses> Matches;
typedef struct { std::vector<size_t> starts; std::vector<Match> options; } MatchGraph;

static unsigned width_of(unsigned v) {
    return v ? 32u - (unsigned)__builtin_clz(v) : 1u;
}

static unsigned hash3(const uint8_t *p) {
    return (unsigned)((p[0] * 2654435761u ^ p[1] * 2246822519u ^ p[2] * 3266489917u) >> 16);
}

static unsigned offset_class(unsigned distance, unsigned method) {
    if (!method || !(distance & 3)) {
        unsigned v = method ? (distance + 8) / 4 : distance;
        return width_of(v) - 1;
    }
    unsigned adjust = distance & 3;
    unsigned v = (distance + 8 - adjust) / 4;
    return kDirectWidths + (adjust - 1) * kEscapeWidths + width_of(v) - 1;
}

static MatchGraph find_matches(const uint8_t *src, size_t size, unsigned method,
                               unsigned depth, unsigned max_match,
                               unsigned window) {
    MatchGraph graph;
    graph.starts.resize(size + 1);
    std::array<uint32_t, 65536> head;
    std::vector<uint32_t> previous(size, UINT32_MAX);
    head.fill(UINT32_MAX);
    for (size_t i = 0; i < size; i++) {
        graph.starts[i] = graph.options.size();
        if (size - i < 3) continue;
        Matches matches{};
        unsigned h = hash3(src + i);
        uint32_t j = head[h];
        unsigned limit = (unsigned)std::min<size_t>(max_match, size - i);
        for (unsigned n = 0; j != UINT32_MAX && n < depth && i - (size_t)j <= window;
             n++, j = previous[j]) {
            if (src[j] != src[i] || src[j + 1] != src[i + 1] ||
                src[j + 2] != src[i + 2]) continue;
            unsigned distance = (unsigned)(i - (size_t)j);
            unsigned cls = offset_class(distance, method);
            Match &best = matches[cls];
            unsigned length = 3;
            if (best.length >= limit ||
                (best.length > 3 && src[j + best.length - 1] != src[i + best.length - 1]))
                continue;
            while (length < limit && src[j + length] == src[i + length]) length++;
            if (length > best.length) best = {distance - 1, (uint16_t)length};
        }
        previous[i] = head[h];
        head[h] = (uint32_t)i;
        for (const Match &m : matches)
            if (m.length) graph.options.push_back(m);
    }
    graph.starts[size] = graph.options.size();
    return graph;
}

/* Huffman-code the bit-width buckets. A value may use any bucket wide enough
 * to hold it, so the lookup picks the cheapest legal leaf. */
typedef struct { int left, right; unsigned width; uint64_t frequency; } EncNode;
typedef struct { unsigned bits, length, width, cost; } Code;
typedef struct {
    std::vector<EncNode> nodes;
    int root;
    std::array<Code, 22> code;
} EncTree;

static void assign_codes(EncTree &tree, int node, unsigned bits, unsigned length,
                         std::array<Code, 22> &leaves) {
    const EncNode &n = tree.nodes[node];
    if (n.left < 0) {
        leaves[n.width] = {bits, length, n.width, n.width + length};
        return;
    }
    assign_codes(tree, n.left, bits << 1, length + 1, leaves);
    assign_codes(tree, n.right, bits << 1 | 1, length + 1, leaves);
}

static EncTree make_tree_with_mask(const std::array<uint64_t, 22> &hist,
                                   uint32_t mask) {
    EncTree tree{};
    std::vector<int> active;
    std::array<uint64_t, 22> bucket{};
    for (unsigned v = 1; v < hist.size(); v++) {
        if (!hist[v]) continue;
        for (unsigned w = v; w < hist.size(); w++) {
            if (mask & (1u << w)) { bucket[w] += hist[v]; break; }
        }
    }
    for (unsigned w = 1; w < hist.size(); w++) {
        if (mask & (1u << w)) {
            active.push_back((int)tree.nodes.size());
            tree.nodes.push_back({-1, -1, w, bucket[w]});
        }
    }
    auto less = [&](int a, int b) {
        return tree.nodes[a].frequency < tree.nodes[b].frequency ||
            (tree.nodes[a].frequency == tree.nodes[b].frequency && a < b);
    };
    while (active.size() > 1) {
        std::sort(active.begin(), active.end(), less);
        int left = active[0], right = active[1];
        active.erase(active.begin(), active.begin() + 2);
        active.push_back((int)tree.nodes.size());
        tree.nodes.push_back({left, right, 0,
                              tree.nodes[left].frequency + tree.nodes[right].frequency});
    }
    tree.root = active[0];
    std::array<Code, 22> leaves{};
    assign_codes(tree, tree.root, 0, 0, leaves);
    for (unsigned w = 1; w < tree.code.size(); w++) {
        tree.code[w].cost = UINT32_MAX;
        for (unsigned leaf = w; leaf < leaves.size(); leaf++) {
            if (leaves[leaf].width && leaves[leaf].cost < tree.code[w].cost)
                tree.code[w] = leaves[leaf];
        }
    }
    return tree;
}

static EncTree make_tree(const std::array<uint64_t, 22> &hist, unsigned fallback) {
    uint32_t mask = 0;
    for (unsigned w = 1; w < hist.size(); w++)
        if (hist[w]) mask |= 1u << w;
    if (!mask) mask = 1u << fallback;
    EncTree best = make_tree_with_mask(hist, mask);
    auto score = [&](const EncTree &tree, uint32_t widths) {
        uint64_t bits = 10u * (unsigned)__builtin_popcount(widths);
        for (unsigned w = 1; w < hist.size(); w++)
            if (hist[w]) bits += hist[w] * tree.code[w].cost;
        return bits;
    };
    uint64_t best_bits = score(best, mask);
    for (;;) {
        uint32_t winner = 0;
        EncTree next;
        uint64_t next_bits = best_bits;
        unsigned widest = 31u - (unsigned)__builtin_clz(mask);
        for (unsigned w = 1; w < widest; w++) {
            if (!(mask & (1u << w))) continue;
            uint32_t candidate_mask = mask & ~(1u << w);
            EncTree candidate = make_tree_with_mask(hist, candidate_mask);
            uint64_t bits = score(candidate, candidate_mask);
            if (bits < next_bits) {
                next_bits = bits;
                winner = candidate_mask;
                next = std::move(candidate);
            }
        }
        if (!winner) break;
        mask = winner;
        best_bits = next_bits;
        best = std::move(next);
    }
    return best;
}

static int write_tree(Writer *w, const EncTree &tree, int node) {
    const EncNode &n = tree.nodes[node];
    if (n.left < 0) return put_bits(w, 1, 0) || put_bits(w, 8, n.width) ? -1 : 0;
    return write_tree(w, tree, n.left) || write_tree(w, tree, n.right) ||
           put_bits(w, 1, 1) ? -1 : 0;
}

static int write_value(Writer *w, const EncTree &tree, unsigned v) {
    const Code &c = tree.code[width_of(v)];
    return c.cost == UINT32_MAX || put_bits(w, c.length, c.bits) ||
           put_bits(w, c.width, v) ? -1 : 0;
}

static unsigned offset_cost(unsigned distance, unsigned method, const EncTree *tree) {
    unsigned adjust = method ? distance & 3 : 0;
    unsigned v = method ? (distance + 8 - adjust) / 4 : distance;
    if (tree) {
        unsigned cost = tree->code[width_of(v)].cost;
        if (adjust && cost != UINT32_MAX) {
            unsigned prefix = tree->code[width_of(adjust - 1)].cost;
            if (prefix == UINT32_MAX) return UINT32_MAX;
            cost += prefix;
        }
        return cost;
    }
    return width_of(v) + 2 + (adjust ? width_of(adjust - 1) + 2 : 0);
}

static unsigned length_cost(unsigned length, const EncTree *tree) {
    return tree ? tree->code[width_of(length)].cost : width_of(length) + 2;
}

static std::vector<Match> parse(const MatchGraph &matches, unsigned method,
                                const EncTree *offsets, const EncTree *lengths) {
    size_t size = matches.starts.size() - 1;
    std::vector<uint64_t> cost(size + 1);
    std::vector<Match> choices(size);
    for (size_t pos = size; pos-- > 0;) {
        uint64_t best = 9 + cost[pos + 1];
        choices[pos] = {0, 1};
        unsigned max_length = 0;
        for (size_t j = matches.starts[pos]; j < matches.starts[pos + 1]; j++)
            max_length = std::max<unsigned>(max_length, matches.options[j].length);
        if (max_length < 3) { cost[pos] = best; continue; }
        std::array<uint64_t, kMaxMatch + 1> best_suffix{};
        std::array<uint16_t, kMaxMatch + 1> best_length{};
        uint64_t cheapest = UINT64_MAX;
        unsigned chosen = 0;
        for (unsigned len = 3; len <= max_length; len++) {
            unsigned lc = length_cost(len, lengths);
            if (lc != UINT32_MAX && cost[pos + len] + lc < cheapest) {
                cheapest = cost[pos + len] + lc;
                chosen = len;
            }
            best_suffix[len] = cheapest;
            best_length[len] = (uint16_t)chosen;
        }
        for (size_t j = matches.starts[pos]; j < matches.starts[pos + 1]; j++) {
            const Match &m = matches.options[j];
            if (m.length < 3 || !best_length[m.length]) continue;
            unsigned distance = (unsigned)m.distance_minus_one + 1;
            unsigned oc = offset_cost(distance, method, offsets);
            if (oc != UINT32_MAX && 1 + oc + best_suffix[m.length] < best) {
                best = 1 + oc + best_suffix[m.length];
                choices[pos] = {m.distance_minus_one, best_length[m.length]};
            }
        }
        cost[pos] = best;
    }
    return choices;
}

static void value_histograms(const std::vector<Match> &choices, unsigned method,
                             std::array<uint64_t, 22> &offs,
                             std::array<uint64_t, 22> &lens) {
    for (size_t i = 0; i < choices.size(); i += choices[i].length) {
        const Match &m = choices[i];
        if (m.length == 1) continue;
        unsigned distance = (unsigned)m.distance_minus_one + 1;
        unsigned adjust = method ? distance & 3 : 0;
        unsigned value = method ? (distance + 8 - adjust) / 4 : distance;
        offs[width_of(value)]++;
        if (adjust) offs[width_of(adjust - 1)]++;
        lens[width_of(m.length)]++;
    }
}

static int emit(const uint8_t *src, size_t size, uint8_t *dst, size_t cap,
                size_t *written, unsigned method, const std::vector<Match> &choices,
                const EncTree &offs, const EncTree &lens) {
    if (cap < 9) return -1;
    memcpy(dst, "vpk0", 4); PUT32(dst + 4, size);
    Writer w = {dst + 8, cap - 8, 0};
    if (put_bits(&w, 8, method) || write_tree(&w, offs, offs.root) ||
        put_bits(&w, 1, 1) || write_tree(&w, lens, lens.root) ||
        put_bits(&w, 1, 1)) return -1;
    for (size_t i = 0; i < size; i += choices[i].length) {
        const Match &m = choices[i];
        if (m.length == 1) {
            if (put_bits(&w, 1, 0) || put_bits(&w, 8, src[i])) return -1;
        } else {
            unsigned distance = (unsigned)m.distance_minus_one + 1;
            unsigned adjust = method ? distance & 3 : 0;
            unsigned value = method ? (distance + 8 - adjust) / 4 : distance;
            if (put_bits(&w, 1, 1) ||
                (adjust && write_value(&w, offs, adjust - 1)) ||
                write_value(&w, offs, value) || write_value(&w, lens, m.length)) return -1;
        }
    }
    *written = 8 + (w.bit + 7) / 8;
    return 0;
}

int vpk0_encode_ex(const uint8_t *src, size_t size, uint8_t *dst,
                   size_t cap, size_t *written, unsigned method, unsigned level) {
    size_t extra = size / 8 + !!(size % 8);
    if (!src || !dst || !written || method > 1 || level > 9 || size > UINT32_MAX ||
        extra > SIZE_MAX - 1024 || size > SIZE_MAX - extra - 1024)
        return -1;
    try {
    static constexpr unsigned depths[10] = {16, 32, 64, 128, 256, 512,
                                             256, 512, 768, 1024};
    static constexpr unsigned windows[10] = {65536, 65536, 65536, 65536, 65536,
                                              65536, 65536, 262144, 524288, 1048576};
    static constexpr unsigned max_lengths[10] = {255, 255, 255, 255, 255,
                                                  255, 1023, 1023, 1023, 1023};
    static constexpr unsigned passes[10] = {1, 2, 2, 3, 4, 4, 4, 4, 4, 4};
    auto matches = find_matches(src, size, method, depths[level], max_lengths[level],
                                windows[level]);
    std::vector<uint8_t> trial(size + extra + 1024);
    std::vector<uint8_t> best;
    EncTree offsets{}, lengths{};
    for (unsigned pass = 0; pass < passes[level]; pass++) {
        auto choices = parse(matches, method, pass ? &offsets : nullptr,
                             pass ? &lengths : nullptr);
        std::array<uint64_t, 22> off_hist{}, len_hist{};
        value_histograms(choices, method, off_hist, len_hist);
        offsets = make_tree(off_hist, method ? 19 : 21);
        lengths = make_tree(len_hist, 8);
        size_t used = 0;
        if (emit(src, size, trial.data(), trial.size(), &used, method,
                 choices, offsets, lengths)) return -1;
        if (best.empty() || used < best.size()) best.assign(trial.begin(), trial.begin() + used);
    }
    if (best.size() > cap) return -1;
    memcpy(dst, best.data(), best.size());
    *written = best.size();
    return 0;
    } catch (const std::bad_alloc &) {
        return -1;
    }
}

int vpk0_encode(const uint8_t *src, size_t size, uint8_t *dst,
                size_t cap, size_t *written, unsigned method) {
    return vpk0_encode_ex(src, size, dst, cap, written, method, 6);
}

} /* extern "C" */
