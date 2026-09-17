# Raw DEFLATE and Rare wrappers

Raw DEFLATE is an RFC 1951 bitstream without a zlib or gzip header. It is used by
[Gex 64](../GEX64.md), [Gex 3](../GEX3.md), and
[San Francisco Rush 2049](../SAN_FRANCISCO_RUSH_2049.md). The final-block bit
ends the stream; ROM ranges can include padding afterward.

Rare adds one of two small wrappers around the same raw bitstream:

| Wrapper | Header | Game |
|---|---|---|
| `1172` | `11 72`, then raw DEFLATE; decoded size comes from the caller | [GoldenEye 007](../GOLDENEYE.md) |
| `1173` | `11 73`, big-endian 24-bit decoded size, then raw DEFLATE | [Perfect Dark](../PERFECTDARK.md) |

The [C reference codec](https://github.com/DSLL32/nviewer/blob/master/codecs/deflate.c)
offers `raw_deflate_*`, `rare1172_*`, and `rare1173_*` buffer functions. It uses
zlib (`-lz`) for the standard DEFLATE bitstream and implements the Rare headers
itself. The encoders make valid streams, not byte-identical retail streams.
They use a 32 KiB window and the default zlib strategy:

| Encoder | zlib level | `memLevel` |
|---|---:|---:|
| Raw DEFLATE | 8 | 6 |
| Rare `1172` | 9 | 5 |
| Rare `1173` | 9 | 7 |

`rare1173_encode_retail_size` is an optional level-9, `memLevel`-9 profile.
It matches the stored length of the documented Perfect Dark boot stream, but
not its bytes; the default `rare1173_encode` uses `memLevel` 7. Neither profile
guarantees a particular output size on other inputs.

The codec has been checked against GoldenEye, Perfect Dark, and Rush 2049 ROM
streams. Re-encoded streams decode byte-for-byte with the independent viewer
decoder. Stored stream extents end at the RFC 1951 final block and exclude
subsequent ROM padding.

## Reference source

<<< ../../codecs/deflate.c{c}
