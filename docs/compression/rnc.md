# RNC methods 1 and 2

[A Bug's Life](../BUGSLIFE.md) stores both ProPack methods. An 18-byte `RNC`
header has this layout:

| Offset | Size | Field |
|---:|---:|---|
| `+0x00` | 3 | ASCII `RNC`. |
| `+0x03` | 1 | Method, 1 or 2. |
| `+0x04` | 4 | Big-endian decoded size. |
| `+0x08` | 4 | Big-endian compressed size. |
| `+0x0C` | 2 | Big-endian decoded-data CRC-16. |
| `+0x0E` | 2 | Big-endian compressed-data CRC-16. |
| `+0x10` | 2 | Leeway/chunk metadata; not needed to decode. |
| `+0x12` | Variable | Compressed payload. |

This reference rejects the locked and encrypted flags used by
other RNC variants; retail files set both to zero.

Method 1 has interleaved little-endian bit words and literal bytes, with
per-chunk Huffman tables. Method 2 reads control bits MSB-first and interleaves
raw bytes with literals, distances, match lengths, and raw runs. Both allow
overlapping back-references.

The [C++ reference codec](https://github.com/DSLL32/nviewer/blob/master/codecs/rnc.cpp)
decodes and CRC-checks both methods. Its decoder requires no heap allocation;
the encoders allocate match history and parsing workspace, and return `-1` on
insufficient destination capacity or allocation failure.

`rnc1_encode` writes canonical Huffman tables for 8 KiB blocks, retaining the
32 KiB match history across block boundaries. It examines up to 1,024 previous
two-byte matches at each position. A backward parse prices literal runs,
distances, and match lengths using the current tables; up to six passes rebuild
those tables and retain the smallest actual bit cost. Range minima cover
every literal-run and retained match-length choice without a quadratic search.
The greedy parse remains a fallback. Blocks whose greedy representation already
uses at most 1,024 bits skip the iterative parse to keep very compressible assets
fast. Match comparison reuses already-proven overlapping prefixes.

`rnc2_encode` searches the full 4 KiB history and minimizes exact token bit
costs, including two-byte matches within 256 bytes, matches through 263 bytes,
and the raw-run escape for 12, 16, …, 72 bytes. Minimizing combined control and
data bits also minimizes the final byte count: literal/data bytes are integral,
and only the final control byte is rounded up. The fixed header, flags, and end
marker add the same cost to every parse.

Both methods produce ordinary unlocked,
unencrypted RNC streams. Neither attempts to reproduce the original packer's
byte sequence.

The codec has been checked against the RNC assets in all five regional
A Bug's Life archives. Re-encoded streams decode byte-for-byte with the
independent viewer decoder. Bounds checks include empty streams, overlap,
distance and block boundaries, and exact or insufficient destination capacity.
An independent exhaustive parser confirms RNC2 output size on small inputs.

## Reference source

<<< ../../codecs/rnc.cpp{cpp}
