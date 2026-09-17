# Raw DEFLATE and Rare wrappers

Raw DEFLATE is an RFC 1951 bitstream without a zlib or gzip header. It is used by
[Gex 64](../GEX64.md), [Gex 3](../GEX3.md), and
[San Francisco Rush 2049](../SAN_FRANCISCO_RUSH_2049.md). The final-block bit
ends the stream; ROM ranges can include padding afterward.

Rare adds small wrappers around the same raw bitstream:

| Wrapper | Header | Game |
|---|---|---|
| `1172` | `11 72`, then raw DEFLATE; decoded size comes from the caller | [GoldenEye 007](../GOLDENEYE.md) |
| `1172` with size | `11 72`, big-endian 32-bit decoded size, then raw DEFLATE | [Banjo-Kazooie](../BANJOKAZOOIE.md) |
| `1173` | `11 73`, big-endian 24-bit decoded size, then raw DEFLATE | [Perfect Dark](../PERFECTDARK.md) |

In Banjo-Kazooie, the `1172` size field occupies bytes `+2..+5`; the DEFLATE
stream begins at `+6`. The size is the exact decoded byte count. Asset-table
extents are eight-byte aligned and may end with `AA` padding after the final
DEFLATE block; the padding is not part of the bitstream.
An empty Banjo asset still has a six-byte header and a two-byte empty DEFLATE
stream.

The [C reference codec](https://github.com/DSLL32/nviewer/blob/master/codecs/deflate.c)
offers `raw_deflate_*`, `rare1172_*`, `rare1172_u32_*`, and `rare1173_*` buffer functions. It uses
zlib (`-lz`) for the standard DEFLATE bitstream and implements the Rare headers
itself. The encoders make valid streams, not byte-identical retail streams.
They use a 32 KiB window and the default zlib strategy:

| Encoder | zlib level | `memLevel` |
|---|---:|---:|
| Raw DEFLATE | 8 | 6 |
| Rare `1172` | 9 | 5 |
| Rare `1172` with size | 9 | 5 |
| Rare `1173` | 9 | 7 |

`rare1173_encode_retail_size` is an optional level-9, `memLevel`-9 profile.
It matches the stored length of the documented Perfect Dark boot stream, but
not its bytes; the default `rare1173_encode` uses `memLevel` 7. Neither profile
guarantees a particular output size on other inputs.

The codec has been checked against GoldenEye, Perfect Dark, and Rush 2049 ROM
streams, plus Banjo-Kazooie assets. Re-encoded streams decode byte-for-byte
with the independent viewer decoder. Stored stream extents end at the RFC 1951
final block and exclude subsequent ROM padding. The largest indexed Banjo
V1.0 asset has 231,555 retail stream bytes and 495,668 decoded bytes; the
reference encoder produces 224,030 bytes. A level-1–9, `memLevel`-1–9,
five-strategy zlib grid on that asset did not improve on its level-9,
`memLevel`-5 default.

Across all 3,308 compressed USA V1.0 assets, that default produces 13,730,546
bytes versus 14,035,043 retail stream bytes, excluding alignment: 860 streams
shrink, 2,042 tie, and 406 grow (largest growth 1,083 bytes). Every repack
round-trips. This profile is not a guarantee of a smaller individual stream.

## Reference source

<<< ../../codecs/deflate.c{c}
