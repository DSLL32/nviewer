// Mario Party HVQ 2.0 still images. Independent C++17 syntax decoder/encoder.
// The encoder preserves a decoded image's DC, block modes and AOT vectors,
// then rebuilds its zero runs and Huffman trees. It is not a pixel encoder.
#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <stdexcept>
#include <string>
#include <vector>

namespace hvq2 {
using Byte = uint8_t;
using Bytes = std::vector<Byte>;
using Words = std::vector<uint16_t>;
static uint16_t be16(const Byte *p) { return uint16_t(p[0] << 8 | p[1]); }
static uint32_t be32(const Byte *p) { return uint32_t(p[0]) << 24 | uint32_t(p[1]) << 16 | uint32_t(p[2]) << 8 | p[3]; }
static void put16(Byte *p, unsigned n) { p[0] = n >> 8; p[1] = n; }
static void put32(Byte *p, unsigned n) { p[0] = n >> 24; p[1] = n >> 16; p[2] = n >> 8; p[3] = n; }
static int16_t s16(int v) { return int16_t(uint16_t(v)); }

struct Reader {
    const Byte *p; size_t size, bit = 0;
    int get() {
        if (bit >= size * 8) throw std::runtime_error("truncated HVQ bitstream");
        int v = (p[bit >> 3] >> (7 - (bit & 7))) & 1; ++bit; return v;
    }
    unsigned byte() { unsigned v = 0; for (int i = 0; i < 8; ++i) v = (v << 1) | get(); return v; }
};
struct Writer {
    Bytes bytes; size_t bit = 0;
    void put(unsigned n) {
        if (!(bit & 7)) bytes.push_back(0);
        bytes.back() |= (n & 1) << (7 - (bit & 7)); ++bit;
    }
    void byte(unsigned n) { for (int i = 7; i >= 0; --i) put(n >> i); }
    Bytes padded() { while (bytes.size() & 3) bytes.push_back(0); return bytes; }
};
struct HNode { int leaf = -1, left = -1, right = -1; unsigned freq = 0; };
struct Huff {
    std::vector<HNode> nodes; int root = -1;
    std::array<std::vector<Byte>, 256> codes;
    int parse(Reader &r) {
        int id = nodes.size(); nodes.push_back({});
        if (!r.get()) nodes[id].leaf = r.byte();
        else { int left = parse(r), right = parse(r); nodes[id].left = left; nodes[id].right = right; }
        return id;
    }
    unsigned read(Reader &r) const {
        if (root < 0) throw std::runtime_error("missing HVQ tree");
        int n = root;
        while (nodes[n].leaf < 0) n = r.get() ? nodes[n].right : nodes[n].left;
        return nodes[n].leaf;
    }
    void make(const std::vector<Bytes> &groups) {
        std::array<unsigned, 256> freq{};
        for (const auto &g : groups) for (Byte b : g) ++freq[b];
        std::vector<int> q;
        for (int i = 0; i < 256; ++i) if (freq[i]) { q.push_back(nodes.size()); nodes.push_back({i, -1, -1, freq[i]}); }
        if (q.empty()) { q.push_back(0); nodes.push_back({0, -1, -1, 1}); }
        while (q.size() > 1) {
            std::stable_sort(q.begin(), q.end(), [&](int a, int b) {
                return nodes[a].freq < nodes[b].freq ||
                    (nodes[a].freq == nodes[b].freq && nodes[a].leaf < nodes[b].leaf);
            });
            int a = q[0], b = q[1]; q.erase(q.begin(), q.begin() + 2);
            int id = nodes.size(); nodes.push_back({-1, a, b, nodes[a].freq + nodes[b].freq}); q.push_back(id);
        }
        root = q[0]; std::vector<Byte> path; build_codes(root, path);
    }
    void build_codes(int n, std::vector<Byte> &path) {
        if (nodes[n].leaf >= 0) { codes[nodes[n].leaf] = path; return; }
        path.push_back(0); build_codes(nodes[n].left, path); path.back() = 1;
        build_codes(nodes[n].right, path); path.pop_back();
    }
    void emit_tree(Writer &w, int n) const {
        if (nodes[n].leaf >= 0) { w.put(0); w.byte(nodes[n].leaf); }
        else { w.put(1); emit_tree(w, nodes[n].left); emit_tree(w, nodes[n].right); }
    }
    Bytes pack(const Bytes &symbols, bool first) const {
        Writer w; if (first) emit_tree(w, root);
        for (Byte b : symbols) for (Byte bit : codes[b]) w.put(bit);
        return w.padded();
    }
};

struct Vector { Byte scale; uint16_t code; };
struct Image {
    unsigned width = 0, height = 0, q = 0;
    std::array<Bytes, 3> dc, mode, raw;
    std::array<std::vector<std::vector<Vector>>, 3> vectors;
    std::array<Words, 3> plane;
    Words rgba5551;
};
struct Stream { Reader r; bool present; };
static Stream stream(const Byte *src, size_t size, unsigned off, Huff *tree = nullptr) {
    if (off > size || size - off < 4) throw std::runtime_error("HVQ section offset");
    unsigned n = be32(src + off);
    if (n > size - off - 4) throw std::runtime_error("HVQ section size");
    Stream s{{src + off + 4, n, 0}, n != 0};
    if (n && tree) tree->root = tree->parse(s.r);
    return s;
}
Image decode(const Byte *src, size_t size) {
    if (size < 0x60 || std::memcmp(src, "HVQ 2.0", 7)) throw std::runtime_error("not HVQ 2.0");
    Image a; a.width = be16(src + 0x10); a.height = be16(src + 0x12); a.q = src[0x1d];
    if (!a.width || !a.height || (a.width & 7) || (a.height & 7) || a.q > 7 || src[0x1c] != 8)
        throw std::runtime_error("unsupported HVQ dimensions or parameters");
    unsigned bw = a.width / 4, bh = a.height / 4, cw = bw / 2, ch = bh / 2;
    Huff bn, run, dct, scale;
    std::array<Stream, 16> s;
    for (int i = 0; i < 16; ++i) {
        Huff *h = i == 0 ? &bn : i == 2 ? &run : i == 4 ? &dct : i == 10 ? &scale : nullptr;
        s[i] = stream(src, size, be32(src + 0x20 + i * 4), h);
    }
    for (int p = 0; p < 3; ++p) {
        size_t n = p ? cw * ch : bw * bh;
        a.dc[p].resize(n); a.mode[p].resize(n); a.raw[p].resize(n * 16);
        a.vectors[p].resize(n); a.plane[p].resize((p ? a.width * a.height / 4 : a.width * a.height));
    }
    // Block counts. The UV symbol combines one count from each chroma plane.
    for (int group = 0; group < 2; ++group) {
        unsigned i = 0, count = group ? cw * ch : bw * bh;
        Reader &b = s[group].r, &r = s[group + 2].r;
        while (i < count) {
            unsigned v = bn.read(b);
            if (v) {
                if (!group) a.mode[0][i] = v;
                else { a.mode[1][i] = v & 15; a.mode[2][i] = v >> 4; }
                ++i;
            } else { unsigned n = run.read(r) + 1; if (n > count - i) throw std::runtime_error("basis run overflow"); i += n; }
        }
    }
    std::array<unsigned, 3> remaining{};
    auto delta = [&](int p) {
        if (remaining[p]) { --remaining[p]; return 0; }
        auto next = [&] { return int(int8_t(dct.read(s[4 + p].r))) * (1 << a.q); };
        int v = next();
        if (!v) { remaining[p] = run.read(s[7 + p].r); return 0; }
        int total = v, lo = -(128 << a.q), hi = 127 << a.q;
        if (v == lo || v == hi) do { v = next(); total += v; } while (v <= lo || v >= hi);
        return total;
    };
    auto dc_at = [&](int p, unsigned x, unsigned y) {
        unsigned w = p ? cw : bw, i = y * w + x;
        int pred = !y ? (!x ? 0 : a.dc[p][i - 1]) : !x ? a.dc[p][i - w] :
            (a.dc[p][i - 1] + a.dc[p][i - w]) >> 1;
        a.dc[p][i] = Byte(pred + delta(p));
    };
    for (unsigned my = 0; my < ch; ++my) {
        for (unsigned mx = 0; mx < cw; ++mx) {
            dc_at(0, 2 * mx, 2 * my); dc_at(0, 2 * mx + 1, 2 * my);
            dc_at(1, mx, my); dc_at(2, mx, my);
        }
        for (unsigned x = 0; x < bw; ++x) dc_at(0, x, 2 * my + 1);
    }
    // AOT nest from the Y DC plane: mirror once at the edges.
    Bytes nest(70 * 38);
    unsigned sx = be16(src + 0x14), sy = be16(src + 0x16);
    for (unsigned y = 0; y < 38; ++y) for (unsigned x = 0; x < 70; ++x) {
        int yy = int(y) < int(bh) ? y : int(y) < int(2 * bh) ? int(2 * bh - 1 - y) : -1;
        int xx = int(x) < int(bw) ? x : int(x) < int(2 * bw) ? int(2 * bw - 1 - x) : -1;
        int px = xx + sx, py = yy + sy;
        if (xx >= 0 && yy >= 0 && px >= 0 && px < int(bw) && py >= 0 && py < int(bh))
            nest[y * 70 + x] = a.dc[0][py * bw + px];
    }
    // Fix payload is consumed in MCU order, not simple plane raster order.
    std::array<unsigned, 3> fix{};
    for (int p = 0; p < 3; ++p) fix[p] = be32(src + 0x54 + 4 * p) + 4;
    auto payload = [&](int p, unsigned bx, unsigned by) {
        unsigned w = p ? cw : bw, i = by * w + bx, n = a.mode[p][i];
        if (n == 8) {
            if (fix[p] > size || size - fix[p] < 16) throw std::runtime_error("raw block truncated");
            std::copy(src + fix[p], src + fix[p] + 16, a.raw[p].begin() + i * 16); fix[p] += 16;
        } else if (n <= 7) {
            for (unsigned k = 0; k < n; ++k) {
                if (fix[p] > size || size - fix[p] < 2) throw std::runtime_error("AOT vector truncated");
                unsigned sc = scale.read(s[10 + p].r), code = be16(src + fix[p]); fix[p] += 2;
                a.vectors[p][i].push_back({Byte(sc), uint16_t(code)});
            }
        } else throw std::runtime_error("invalid block mode");
    };
    for (unsigned my = 0; my < ch; ++my) for (unsigned mx = 0; mx < cw; ++mx) {
        payload(0, mx * 2, my * 2); payload(0, mx * 2 + 1, my * 2);
        payload(0, mx * 2, my * 2 + 1); payload(0, mx * 2 + 1, my * 2 + 1);
        payload(1, mx, my); payload(2, mx, my);
    }
    std::array<int, 512> div{}; for (int i = 1; i < 512; ++i) div[i] = 4096 / i;
    auto render = [&](int p) {
        unsigned w = p ? cw : bw, h = p ? ch : bh, stride = w * 4;
        for (unsigned by = 0; by < h; ++by) {
            int left = a.dc[p][by * w];
            for (unsigned bx = 0; bx < w; ++bx) {
                unsigned id = by * w + bx, c = a.dc[p][id], mode = a.mode[p][id];
                uint16_t pixels[16];
                if (!mode) {
                    int right = bx + 1 < w && !a.mode[p][id + 1] ? a.dc[p][id + 1] : c;
                    int top = by && !a.mode[p][id - w] ? a.dc[p][id - w] : c;
                    int bottom = by + 1 < h && !a.mode[p][id + w] ? a.dc[p][id + w] : c;
                    int c2 = 2 * int(c), c8 = 8 * int(c) + 4;
                    int tb = top - bottom, lr = left - right, vp = tb + lr, vm = tb - lr;
                    int tl = top + left - c2, tr = top + right - c2, br = bottom + right - c2, bl = bottom + left - c2;
                    int tml = top - left, tmr = top - right, bmr = bottom - right, bml = bottom - left;
                    int q[16] = {c8+vp+tl,c8+vp+tml,c8+vm+tmr,c8+vm+tr,
                        c8+vp-tml,c8-br,c8-bl,c8+vm-tmr,
                        c8-vm-bml,c8-tr,c8-tl,c8-vp-bmr,
                        c8-vm+bl,c8-vm+bml,c8-vp+bmr,c8-vp+br};
                    for (int i = 0; i < 16; ++i) pixels[i] = uint16_t(q[i] >> 3);
                    left = c;
                } else {
                    if (mode == 8) for (int i = 0; i < 16; ++i) pixels[i] = a.raw[p][id * 16 + i];
                    else {
                        std::fill(pixels, pixels + 16, uint16_t(c));
                        for (const auto &v : a.vectors[p][id]) {
                            int xs = (v.code & 1) + 1, ys = ((v.code >> 1) & 1) + 1;
                            int nx = (v.code >> 2) & 63, ny = (v.code >> 8) & 31;
                            int sample[16], sum = 0;
                            for (int y = 0; y < 4; ++y) for (int x = 0; x < 4; ++x)
                                sum += sample[y * 4 + x] = nest[(ny + y * ys) * 70 + nx + x * xs];
                            int mean = (sum + 8) >> 4, max = 0;
                            for (int &x : sample) { x -= mean; max = std::max(max, std::abs(x)); }
                            int coeff = int(int8_t(v.scale)) * 8 + (v.code >> 13);
                            int bar = div[max] * coeff;
                            for (int i = 0; i < 16; ++i) pixels[i] = uint16_t(pixels[i] + ((sample[i] * bar + 512) >> 10));
                        }
                    }
                    left = bx + 1 < w ? a.dc[p][id + 1] : c;
                }
                for (int y = 0; y < 4; ++y) for (int x = 0; x < 4; ++x)
                    a.plane[p][(by * 4 + y) * stride + bx * 4 + x] = pixels[y * 4 + x];
            }
        }
    };
    for (int p = 0; p < 3; ++p) render(p);
    a.rgba5551.resize(a.width * a.height);
    auto clip = [](int x) { x -= 256; return x < 0 ? 0 : x >= 256 ? 248 : x & ~7; };
    for (unsigned y = 0; y < a.height; ++y) for (unsigned x = 0; x < a.width; ++x) {
        unsigned i = y * a.width + x, ci = (y / 2) * (a.width / 2) + x / 2;
        int yy = a.plane[0][i], u = s16(a.plane[1][ci] - 128), v = s16(a.plane[2][ci] - 128);
        int y6 = s16((yy & 0x3ff) << 6);
        int r = clip((y6 + s16(90 * v + 0x4020)) >> 6);
        int g = clip((y6 + s16(-22 * u - 46 * v + 0x4020)) >> 6);
        int b = clip((y6 + s16(113 * u + 0x4020)) >> 6);
        a.rgba5551[i] = uint16_t((r << 8) | (g << 3) | (b >> 2));
    }
    return a;
}

static std::pair<Bytes, Bytes> runs(const Bytes &v, bool escape) {
    Bytes symbols, lengths;
    for (size_t i = 0; i < v.size();) {
        if (!v[i]) {
            size_t n = 1; while (n < 256 && i + n < v.size() && !v[i + n]) ++n;
            symbols.push_back(0); lengths.push_back(Byte(n - 1)); i += n;
        } else {
            Byte x = v[i++]; symbols.push_back(x);
            if (escape && (x == 0x80 || x == 0x7f)) symbols.push_back(0);
        }
    }
    return {symbols, lengths};
}
Bytes encode(const Image &a) {
    if (!a.width || !a.height || (a.width & 7) || (a.height & 7)) throw std::runtime_error("bad HVQ dimensions");
    unsigned bw = a.width / 4, cw = a.width / 8, ch = a.height / 8;
    Bytes uv; for (size_t i = 0; i < a.mode[1].size(); ++i) uv.push_back(a.mode[1][i] | (a.mode[2][i] << 4));
    auto bnY = runs(a.mode[0], false), bnUV = runs(uv, false);
    std::array<Bytes, 3> deltas;
    auto visit = [&](int p, unsigned x, unsigned y) {
        unsigned w = p ? cw : bw, i = y * w + x;
        int pred = !y ? (!x ? 0 : a.dc[p][i - 1]) : !x ? a.dc[p][i - w] :
            (a.dc[p][i - 1] + a.dc[p][i - w]) >> 1;
        int d = int8_t(a.dc[p][i] - pred);
        if (d & ((1 << a.q) - 1)) throw std::runtime_error("unencodable HVQ DC");
        deltas[p].push_back(Byte(d >> a.q));
    };
    for (unsigned my = 0; my < ch; ++my) {
        for (unsigned mx = 0; mx < cw; ++mx) {
            visit(0, mx * 2, my * 2); visit(0, mx * 2 + 1, my * 2);
            visit(1, mx, my); visit(2, mx, my);
        }
        for (unsigned x = 0; x < bw; ++x) visit(0, x, my * 2 + 1);
    }
    std::array<std::pair<Bytes, Bytes>, 3> dr;
    for (int p = 0; p < 3; ++p) dr[p] = runs(deltas[p], true);
    std::array<Bytes, 3> scales, fixed;
    auto block = [&](int p, unsigned x, unsigned y) {
        unsigned w = p ? cw : bw, id = y * w + x, n = a.mode[p][id];
        if (n == 8) fixed[p].insert(fixed[p].end(), a.raw[p].begin() + id * 16, a.raw[p].begin() + id * 16 + 16);
        else for (const auto &v : a.vectors[p][id]) {
            scales[p].push_back(v.scale); fixed[p].push_back(v.code >> 8); fixed[p].push_back(v.code);
        }
    };
    for (unsigned my = 0; my < ch; ++my) for (unsigned mx = 0; mx < cw; ++mx) {
        block(0, mx * 2, my * 2); block(0, mx * 2 + 1, my * 2);
        block(0, mx * 2, my * 2 + 1); block(0, mx * 2 + 1, my * 2 + 1);
        block(1, mx, my); block(2, mx, my);
    }
    Huff bn, rt, dc, st;
    bn.make({bnY.first, bnUV.first});
    rt.make({bnY.second, bnUV.second, dr[0].second, dr[1].second, dr[2].second});
    dc.make({dr[0].first, dr[1].first, dr[2].first});
    st.make({scales[0], scales[1], scales[2]});
    std::array<Bytes, 16> parts = {bn.pack(bnY.first, true), bn.pack(bnUV.first, false),
        rt.pack(bnY.second, true), rt.pack(bnUV.second, false),
        dc.pack(dr[0].first, true), dc.pack(dr[1].first, false), dc.pack(dr[2].first, false),
        rt.pack(dr[0].second, false), rt.pack(dr[1].second, false), rt.pack(dr[2].second, false),
        st.pack(scales[0], true), st.pack(scales[1], false), st.pack(scales[2], false),
        fixed[0], fixed[1], fixed[2]};
    Bytes out(0x60); std::memcpy(out.data(), "HVQ 2.0", 7);
    put16(out.data() + 0x10, a.width); put16(out.data() + 0x12, a.height);
    unsigned words = (fixed[0].size() + fixed[1].size() + fixed[2].size()) / 2;
    out[0x18] = words; out[0x19] = words >> 8; out[0x1a] = words >> 16; out[0x1b] = words >> 24;
    out[0x1c] = 8; out[0x1d] = a.q; out[0x1e] = 2; out[0x1f] = 2;
    for (int i = 0; i < 16; ++i) {
        put32(out.data() + 0x20 + 4 * i, out.size());
        size_t pos = out.size(); out.resize(pos + 4 + parts[i].size());
        put32(out.data() + pos, parts[i].size());
        std::copy(parts[i].begin(), parts[i].end(), out.begin() + pos + 4);
    }
    return out;
}
} // namespace hvq2
