# Shadows of the Empire LZHUF

[Star Wars: Shadows of the Empire](../SHADOWS_OF_THE_EMPIRE.md) compresses its
main program and scene IDs 01–31 with this adaptive-Huffman LZ format. Each
stream begins with an exact decoded byte count; there is no end symbol. Bits
are read most-significant first. The decoder stops when it has produced that
count, so an archive member can contain trailing alignment bytes.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `u32` | `decodedSize` | Big-endian output byte count. |
| `0x04` | variable | bitstream | `tokens` | Adaptive-Huffman symbols and fixed-table match positions. |

The adaptive tree begins with unit frequencies for 314 symbols. Symbols
`0x00`–`0xFF` emit literal bytes; symbols `0x100`–`0x139` copy `symbol − 253`
bytes (3–60). The 4 KiB history ring starts with its write cursor at 4,036;
the preceding positions contain spaces. Matches permit overlap and use a
distance of 1–4096. After each symbol, its tree node is incremented and
reordered by frequency. When the root reaches `0x8000`, leaf frequencies are
halved, rounded up, and the tree is reconstructed before the next update.

After a match symbol, the bitstream supplies a position code. The boot
preamble contains `d_code[256]` followed by `d_len[256]`. Read the next eight
bits as `x`, use those tables to obtain the upper six distance bits and code
length, then read `d_len[x] − 2` further bits while shifting `x`. The distance
minus one is `(d_code[initial x] << 6) | (shifted x & 63)`. The two tables are
release-specific and must be supplied alongside a stream:

| Release | `d_code[256]` ROM range | `d_len[256]` ROM range |
|---|---|---|
| USA V1.0 | `[0x28C0, 0x29C0)` | `[0x29C0, 0x2AC0)` |
| USA V1.1, V1.2 | `[0x28BC, 0x29BC)` | `[0x29BC, 0x2ABC)` |
| Europe | `[0x2804, 0x2904)` | `[0x2904, 0x2A04)` |

The [standalone C++17 reference](https://github.com/DSLL32/nviewer/blob/master/codecs/shadows_lzhuf.cpp)
contains the decoder first and a bounded hash-chain, longest-match encoder
second. The encoder derives its position prefixes from the supplied tables;
it does not embed any release's table or attempt to reproduce the retail parse.
Its `encode` and `decode` functions return zero on success and `-1` on invalid
input or inadequate output capacity. The caller owns all buffers.

Verified against the four retail releases: the decoder completed all 31
LZHUF scene members and the main-program stream per release, with every scene
reaching its advertised output size and `LStb` header. All 128 LZHUF scene
re-encodes and four program re-encodes round-tripped byte-for-byte. The USA
V1.0 program and scene outputs also matched independently decoded bytes. In
USA V1.0, scene 03's indexed stored member occupies 154,272 bytes including
alignment, versus 154,345 bytes from
the reference encoder. Scene 31 occupies 102,336 stored bytes versus 101,733
reference bytes. The main program occupies 527,056 stored bytes versus 522,223
reference bytes. These compression decisions are not byte-identical to retail.
The scene 03, scene 31, and main-program re-encodes took 29 ms, 17 ms, and
75 ms respectively with `-O3` on the audit host, far below the 2 s per 10 KiB
output budget. The times are not a portable guarantee.

## Reference source

<<< ../../codecs/shadows_lzhuf.cpp{cpp}
