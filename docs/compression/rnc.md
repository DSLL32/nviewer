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
decodes and CRC-checks both methods. `rnc1_encode` writes fixed, 4-bit
Huffman tables per block; `rnc2_encode` writes raw runs and back-references.
Both use a bounded greedy match search and no heap allocation. The output is
valid but not optimized for the original packer's compression ratio.

Verification against the viewer on A Bug's Life files, showing original
packed → decoded → reference repacked bytes:

| Method | File | Bytes | Decoded FNV-1a |
|---|---|---:|---|
| RNC1 | `level01/lowres.n64` | 23,815 → 71,952 → 32,038 | `30FC5391` |
| RNC1 | `level02/lowres.n64` | 13,927 → 52,168 → 18,260 | `E77DC757` |
| RNC2 | `level15/end00.tpg` | 17,479 → 17,984 → 17,635 | `2B390D45` |
| RNC2 | `level15/end03.tpg` | 1,696 → 3,136 → 1,837 | `F1E25214` |

The viewer independently decoded the repacked method-1 stream byte-for-byte.
Sanitized round trips passed, including varied content and block boundaries.

## Reference source

<<< ../../codecs/rnc.cpp{cpp}
