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
contains the decoder first and an iterative shortest-path encoder second.
The encoder derives its position prefixes from the supplied tables and
searches the full written 4 KiB history. It caches useful matches, then
runs six parsing passes using Huffman lengths sampled every 128 decoded
bytes from the preceding parse. These are estimated future costs: every
candidate is measured with the actual adaptive tree, and the smallest is
retained alongside a 128-candidate greedy fallback. It does not
embed any release's table or reproduce the retail parse.
Its `encode` and `decode` functions return zero on success and `-1` on invalid
input or inadequate output capacity. The caller owns all buffers.

The codec has been checked against the main program and all LZHUF scene members
in the four documented releases. Re-encoded streams decode byte-for-byte with
the independent viewer decoder. Bounds and malformed-stream checks include
ring wrap, adaptive-tree reconstruction, and release-specific position tables.

## Reference source

<<< ../../codecs/shadows_lzhuf.cpp{cpp}
