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

Both methods preserve the existing encoder API and produce ordinary unlocked,
unencrypted RNC streams. Neither attempts to reproduce the original packer's
byte sequence.

Verification against the viewer on A Bug's Life files, showing original
packed → decoded → reference repacked bytes:

| Method | File | Bytes | Decoded FNV-1a |
|---|---|---:|---|
| RNC1 | `level01/lowres.n64` | 23,815 → 71,952 → 22,863 | `30FC5391` |
| RNC1 | `level02/lowres.n64` | 13,927 → 52,168 → 13,275 | `E77DC757` |
| RNC2 | `level15/end00.tpg` | 17,479 → 17,984 → 17,339 | `2B390D45` |
| RNC2 | `level15/end03.tpg` | 1,696 → 3,136 → 1,686 | `F1E25214` |

Largest packed stream of each method across all five regional manifests,
including the 18-byte RNC header and excluding archive alignment:

| Method | US ROM offset | Retail bytes | Repacked bytes | Change |
|---|---:|---:|---:|---:|
| RNC1 | `0x1B1C68` | 179,193 | 175,356 | −2.14% |
| RNC2 | `0x5617E8` | 22,456 | 22,089 | −1.63% |

Reproduce the largest-stream comparison with
`npm run bench:codecs -- --only rnc`. The benchmark compiles at `-O3` and checks
each repack against the decoded source bytes.

The complete US archive comparison is:

| Method | Files | Retail bytes | Repacked bytes | Smaller / equal / larger |
|---|---:|---:|---:|---:|
| RNC1 | 463 | 8,056,113 | 7,784,354 | 457 / 2 / 4 |
| RNC2 | 20 | 296,856 | 291,913 | 20 / 0 / 0 |

On the audit host, the `-O3` defaults stayed below two seconds per 10 KiB of
compressed output for every distinct stream in all five regions. The worst
observed rates were 1.21 s/10 KiB for RNC1 and 0.15 s/10 KiB for RNC2; the
longest individual encodes took 1.234 s and 0.134 s respectively. These are host
measurements, not a runtime guarantee. Some RNC1 files remain larger than their
retail allocations even though the archive total and largest sample are smaller.

The C++ codec and the independent viewer decoder verified every RNC asset in
the five regional archives: 2,393 entries representing 506 distinct packed
streams. AddressSanitizer and UndefinedBehaviorSanitizer round trips cover 608
varied inputs, including empty streams, overlap, distance and block boundaries,
exact destination capacities, and one-byte-short destination buffers. An
independent exhaustive parser, tracking all eight control-bit phases and every
legal source offset, also matched RNC2's output size on 120 small inputs.

## Reference source

<<< ../../codecs/rnc.cpp{cpp}
