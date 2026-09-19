/* Benchmark one exact ROM stream. Invoked by codec-table.ts. */
#include "../codecs/hudson_lzss.hpp"
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <utility>
#include <vector>

extern "C" {
#define CODEC(name) int name(const uint8_t *, size_t, uint8_t *, size_t, size_t *)
CODEC(mio0_decode); CODEC(mio0_encode);
CODEC(yaz0_decode); CODEC(yaz0_encode);
CODEC(yay0_decode); CODEC(yay0_encode);
CODEC(raw_deflate_decode); CODEC(raw_deflate_encode);
CODEC(rare1172_decode); CODEC(rare1172_encode);
CODEC(rare1172_u32_decode); CODEC(rare1172_u32_encode);
CODEC(rare1173_decode); CODEC(rare1173_encode);
CODEC(rare_dkr_decode); CODEC(rare_dkr_encode);
CODEC(chunked_zlib_decode); CODEC(chunked_zlib_encode);
CODEC(rush1_lzss_decode); CODEC(rush1_lzss_encode);
CODEC(rush2049_lzss_decode); CODEC(rush2049_lzss_encode);
CODEC(smsr_decode); CODEC(smsr_encode);
CODEC(cmpr_decode); CODEC(cmpr_encode);
CODEC(lzari_decode); CODEC(lzari_encode);
CODEC(rnc_decode); CODEC(rnc1_encode); CODEC(rnc2_encode);
CODEC(airboarder_lh5_decode); CODEC(airboarder_lh5_encode);
CODEC(vpk0_decode);
int vpk0_encode(const uint8_t *, size_t, uint8_t *, size_t, size_t *, unsigned);
CODEC(erz2_decode); CODEC(erz2_encode);
int fla2_decode(const uint8_t *, size_t, uint8_t *, size_t, size_t *, size_t *);
CODEC(fla2_encode);
#undef CODEC
}

using Codec = int(const uint8_t *, size_t, uint8_t *, size_t, size_t *);

std::vector<uint8_t> decode(const uint8_t *, size_t, size_t);
std::vector<uint8_t> encode(const std::vector<uint8_t> &, unsigned);

static int boss_pattern_decode(const uint8_t *src, size_t size, uint8_t *dst,
                               size_t cap, size_t *used) {
    try {
        auto out = decode(src, size, cap);
        if (out.size() > cap) return -1;
        std::memcpy(dst, out.data(), out.size());
        *used = out.size();
        return 0;
    } catch (...) { return -1; }
}

static int boss_pattern_encode(const uint8_t *src, size_t size, uint8_t *dst,
                               size_t cap, size_t *used) {
    try {
        auto out = encode(std::vector<uint8_t>(src, src + size), 4096);
        if (out.size() > cap) return -1;
        std::memcpy(dst, out.data(), out.size());
        *used = out.size();
        return 0;
    } catch (...) { return -1; }
}

static int fla2_checked_decode(const uint8_t *src, size_t size, uint8_t *dst,
                               size_t cap, size_t *used) {
    size_t consumed = 0;
    if (fla2_decode(src, size, dst, cap, used, &consumed)) return -1;
    return consumed == size ? 0 : -1;
}

static uint32_t be32(const uint8_t *p) {
    return uint32_t(p[0]) << 24 | uint32_t(p[1]) << 16 | uint32_t(p[2]) << 8 | p[3];
}

static uint32_t le32(const uint8_t *p) {
    return uint32_t(p[3]) << 24 | uint32_t(p[2]) << 16 | uint32_t(p[1]) << 8 | p[0];
}

static int vpk1_encode(const uint8_t *src, size_t size, uint8_t *dst,
                       size_t cap, size_t *used) {
    return vpk0_encode(src, size, dst, cap, used, 1);
}

static int hudson1_decode(const uint8_t *src, size_t size, uint8_t *dst,
                          size_t cap, size_t *used) {
    return size >= 4 ? hudson_decode<6>(src + 4, size - 4, dst, cap, used, be32(src)) : -1;
}

static int hudson1_encode(const uint8_t *src, size_t size, uint8_t *dst,
                          size_t cap, size_t *used) {
    if (cap < 4 || size > UINT32_MAX) return -1;
    dst[0] = size >> 24; dst[1] = size >> 16; dst[2] = size >> 8; dst[3] = size;
    int rc = hudson_encode<6>(src, size, dst + 4, cap - 4, used);
    if (rc) return rc;
    *used += 4;
    return 0;
}

static int hudson4_decode(const uint8_t *src, size_t size, uint8_t *dst,
                          size_t cap, size_t *used) {
    return size >= 4 && le32(src) == size - 4 ?
        hudson_decode<4>(src + 4, size - 4, dst, cap, used) : -1;
}

static int hudson4_encode(const uint8_t *src, size_t size, uint8_t *dst,
                          size_t cap, size_t *used) {
    if (cap < 4) return -1;
    int rc = hudson_encode<4>(src, size, dst + 4, cap - 4, used);
    if (rc || *used > UINT32_MAX) return -1;
    uint32_t n = *used;
    dst[0] = n; dst[1] = n >> 8; dst[2] = n >> 16; dst[3] = n >> 24;
    *used += 4;
    return 0;
}

static int yay0_outer_decode(const uint8_t *src, size_t size, uint8_t *dst,
                             size_t cap, size_t *used) {
    if (size < 4 || be32(src) > cap) return -1;
    int rc = yay0_decode(src + 4, size - 4, dst, cap, used);
    return rc || *used != be32(src) ? -1 : 0;
}

static int yay0_outer_encode(const uint8_t *src, size_t size, uint8_t *dst,
                             size_t cap, size_t *used) {
    if (cap < 4 || size > UINT32_MAX) return -1;
    dst[0] = size >> 24; dst[1] = size >> 16; dst[2] = size >> 8; dst[3] = size;
    int rc = yay0_encode(src, size, dst + 4, cap - 4, used);
    if (rc) return rc;
    *used += 4;
    return 0;
}

static std::pair<Codec *, Codec *> codec(const char *name) {
#define PAIR(label, decoder, encoder) if (!std::strcmp(name, label)) return {decoder, encoder}
    PAIR("mio0", mio0_decode, mio0_encode);
    PAIR("yaz0", yaz0_decode, yaz0_encode);
    PAIR("yay0", yay0_outer_decode, yay0_outer_encode);
    PAIR("raw-deflate", raw_deflate_decode, raw_deflate_encode);
    PAIR("rare1172", rare1172_decode, rare1172_encode);
    PAIR("rare1172-u32", rare1172_u32_decode, rare1172_u32_encode);
    PAIR("rare1173", rare1173_decode, rare1173_encode);
    PAIR("rare-dkr", rare_dkr_decode, rare_dkr_encode);
    PAIR("chunked-zlib", chunked_zlib_decode, chunked_zlib_encode);
    PAIR("boss-pattern", boss_pattern_decode, boss_pattern_encode);
    PAIR("fla2", fla2_checked_decode, fla2_encode);
    PAIR("hudson1", hudson1_decode, hudson1_encode);
    PAIR("hudson4", hudson4_decode, hudson4_encode);
    PAIR("rush1-lzss", rush1_lzss_decode, rush1_lzss_encode);
    PAIR("rush2049-lzss", rush2049_lzss_decode, rush2049_lzss_encode);
    PAIR("smsr", smsr_decode, smsr_encode);
    PAIR("cmpr", cmpr_decode, cmpr_encode);
    PAIR("lzari", lzari_decode, lzari_encode);
    PAIR("rnc1", rnc_decode, rnc1_encode);
    PAIR("rnc2", rnc_decode, rnc2_encode);
    PAIR("lh5", airboarder_lh5_decode, airboarder_lh5_encode);
    PAIR("vpk0", vpk0_decode, vpk1_encode);
    PAIR("erz2", erz2_decode, erz2_encode);
#undef PAIR
    return {nullptr, nullptr};
}

int main(int argc, char **argv) {
    if (argc != 6) return 2;
    auto [decode, encode] = codec(argv[1]);
    if (!decode) return 2;
    const size_t at = std::strtoull(argv[3], nullptr, 0);
    const size_t stored = std::strtoull(argv[4], nullptr, 0);
    const size_t expected = std::strtoull(argv[5], nullptr, 0);
    FILE *file = std::fopen(argv[2], "rb");
    if (!file) { std::perror(argv[2]); return 2; }
    if (std::fseek(file, 0, SEEK_END)) return 2;
    long end = std::ftell(file);
    if (end < 0 || at > size_t(end) || stored > size_t(end) - at ||
        std::fseek(file, long(at), SEEK_SET)) return 2;
    std::vector<uint8_t> source(stored), raw(expected ? expected : 1),
                         repacked(expected * 3 + 4096), again(expected ? expected : 1);
    if (std::fread(source.data(), 1, stored, file) != stored) return 2;
    std::fclose(file);
    size_t decoded = 0, packed = 0, checked = 0;
    if (decode(source.data(), stored, raw.data(), expected, &decoded) ||
        decoded != expected) { std::fprintf(stderr, "retail decode failed\n"); return 1; }
    auto start = std::chrono::steady_clock::now();
    if (encode(raw.data(), decoded, repacked.data(), repacked.size(), &packed)) {
        std::fprintf(stderr, "encode failed\n"); return 1;
    }
    auto stop = std::chrono::steady_clock::now();
    if (decode(repacked.data(), packed, again.data(), expected, &checked) ||
        checked != decoded || std::memcmp(raw.data(), again.data(), decoded)) {
        std::fprintf(stderr, "repacked round trip failed\n"); return 1;
    }
    double seconds = std::chrono::duration<double>(stop - start).count();
    std::printf("%zu %zu %zu %.6f\n", stored, decoded, packed, seconds);
}
