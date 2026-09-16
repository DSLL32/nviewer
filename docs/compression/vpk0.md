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

The main-menu stream from the Pokémon Snap USA ROM (0xA0F830–0xA5CC46) is
316,438 bytes and expands to 997,232 bytes. On this host, an optimized C++17
build (`g++ -O3`) produced the following one-run encode-only timings; decoding
and file I/O were excluded:

| Level | Search depth | Window | Parse/tree passes | Encoded bytes | Seconds |
|---:|---:|---:|---:|---:|---:|
| 0 | 16 | 64 KiB | 1 | 312,545 | 1.16 |
| 1 | 32 | 64 KiB | 2 | 309,506 | 1.98 |
| 2 | 64 | 64 KiB | 2 | 308,192 | 2.66 |
| 3 | 128 | 64 KiB | 3 | 307,471 | 4.17 |
| 4 (default) | 256 | 64 KiB | 4 | 306,867 | 6.54 |
| 5 | 512 | 64 KiB | 4 | 306,483 | 10.05 |
| 6 | 256 | 64 KiB | 4 | 305,300 | 16.72 |
| 7 | 512 | 256 KiB | 4 | 303,585 | 27.41 |
| 8 | 768 | 512 KiB | 4 | 303,496 | 38.53 |
| 9 | 1,024 | 1 MiB | 4 | 303,264 | 49.11 |

The default level 4 saves 9,571 bytes (3.02%) in 6.54 s on this sample.
Level 9 saves 13,174 bytes (4.16%) relative to the ROM stream. Its 49.11 s
encode time is below a limit of two seconds per 10 KiB of compressed output
(59.23 s for this stream). Wider windows can create offsets beyond the
retail encoder's apparent 64 KiB window; both VPK0 methods support them.

The original and all ten encoded streams decoded byte-for-byte to the same
997,232-byte output with the C++ decoder. An independently written TypeScript
decoder also validated the encoded streams. A sanitized build checked the
level-9 encode/decode round trip. Synthetic round trips exercised direct
method-0 distance 1,048,576 and escaped method-1 distance 1,048,575.

Earlier fixed-tree comparisons for the USA ROM streams were:

| Stream | ROM stored | Decoded | Re-encoded (method 1) | FNV-1a decoded |
|---|---:|---:|---:|---|
| Main menu | 316,438 | 997,232 | 495,749 | `2CCF3810` |
| Intro | 3,411 | 28,944 | 6,977 | `7487AD95` |

The re-encoded sizes in this last table describe the previous fixed-tree
encoder, not the current implementation.

## Reference source

<<< ../../codecs/vpk0.cpp{cpp}
