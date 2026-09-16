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
itself. The encoder makes valid streams, not byte-identical retail streams.

Verification: the C decoder matched the viewer byte-for-byte on these ROM
streams. Original sizes end at the RFC 1951 final block and include any Rare
header, but exclude later ROM padding.

| Stream | Original | Decoded | Re-encoded | FNV-1a decoded |
|---|---:|---:|---:|---|
| GoldenEye data at `0x21990` | 71,760 | 247,120 | 73,638 | `A94BCEB5` |
| Perfect Dark data at `0x39850` | 69,430 | 200,256 | 70,681 | `48B75FC5` |
| Rush 2049 main at `0xB0CB10` | 326,180 | 647,072 | 327,062 | `52E92DA6` |

Sanitized round trips pass for all three entry points. Re-encoded streams are
valid but do not match the retail compressor's choices.

## Reference source

<<< ../../codecs/deflate.c{c}
