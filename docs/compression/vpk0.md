# VPK0

[Pokémon Snap](../POKEMONSNAP.md) uses VPK0 for three menu, intro, and check
buffers; course assets themselves are raw.

| Offset | Size | Field |
|---:|---:|---|
| `+0x00` | 4 | ASCII lowercase `vpk0`. |
| `+0x04` | 4 | Big-endian decoded size. |
| `+0x08` | Variable | MSB-first bitstream, starting with an 8-bit method. |

Two post-order trees describe offset and length values. A
zero token bit gives an eight-bit literal; a one gives a back-reference. Method
0 uses a direct backward distance. Method 1 combines one or two offset-tree
values into an interleaved distance, as detailed in the game manual.

The [C++ reference codec](https://github.com/DSLL32/nviewer/blob/master/codecs/vpk0.cpp)
decodes both methods. Its encoder searches hash chains for matches, optimizes
the token sequence with a backward bit-cost parse, and builds Huffman trees for
the offset and length bit-width buckets. It also removes buckets when merging
them into a wider bucket reduces the total tree and payload cost. The parse
and trees are refined for several passes, retaining the smallest stream.
This is not a globally optimal parse: the match search is depth-bounded.

`vpk0_encode_ex(src, size, dst, cap, written, method, level)` accepts method
`0` or `1` and effort level `0` through `9`; the existing `vpk0_encode`
signature calls level `4`. A higher level spends more time searching, with no
guarantee that output size improves on every input. All levels use a 1,023-byte
maximum match except levels `0`–`5`, which use 255 bytes.

| Level | Search depth | Window | Parse/tree passes |
|---:|---:|---:|---:|
| 0 | 16 | 64 KiB | 1 |
| 1 | 32 | 64 KiB | 2 |
| 2 | 64 | 64 KiB | 2 |
| 3 | 128 | 64 KiB | 3 |
| 4 (default) | 256 | 64 KiB | 4 |
| 5 | 512 | 64 KiB | 4 |
| 6 | 256 | 64 KiB | 4 |
| 7 | 512 | 256 KiB | 4 |
| 8 | 768 | 512 KiB | 4 |
| 9 | 1,024 | 1 MiB | 4 |

Both VPK0 methods support the wider windows at high effort levels. The codec
has been checked against the Pokémon Snap menu and intro streams; re-encoded
streams decode byte-for-byte with the independent viewer decoder. Bounds
checks include long direct and escaped distances.

## Reference source

<<< ../../codecs/vpk0.cpp{cpp}
