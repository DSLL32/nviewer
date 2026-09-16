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
They use a 32 KiB window and the default zlib strategy; their compression
settings are tuned independently for the largest indexed stream of each format:

| Encoder | zlib level | `memLevel` | Largest-sample result |
|---|---:|---:|---|
| Raw DEFLATE | 8 | 6 | 711,842 bytes, 2,515 below retail |
| Rare `1172` | 9 | 5 | 70,900 bytes, 860 below retail |
| Rare `1173` | 9 | 7 | 178,565 bytes, 157 below retail |

`rare1173_encode_retail_size` is an optional level-9, `memLevel`-9 profile.
For the audited Perfect Dark boot stream it produces **178,722 bytes**, exactly
the retail byte count, but not a byte-identical bitstream. The normal encoder
uses the smaller level-9, `memLevel`-7 result. Other streams may behave
differently; these are not guarantees of retail-size output.

Verification: the C decoder matched the viewer byte-for-byte on these ROM
streams. Original sizes end at the RFC 1951 final block and include any Rare
header, but exclude later ROM padding.

| Stream | Original | Decoded | Re-encoded | FNV-1a decoded |
|---|---:|---:|---:|---|
| GoldenEye data at `0x21990` | 71,760 | 247,120 | 70,900 | `A94BCEB5` |
| Perfect Dark boot at `0x3050` | 178,722 | 356,240 | 178,565 | `8B930674` |
| Rush 2049 data at `0x6E3080` | 714,357 | 1,578,064 | 711,842 | `7479531E` |

The three largest-sample repacks and the optional Perfect Dark retail-size
profile round-trip through the C decoder and the viewer's independent
TypeScript raw-DEFLATE decoder. AddressSanitizer and UndefinedBehaviorSanitizer
passed for these cases. Re-encoded streams are valid but do not match the
retail compressor's choices.

## Reference source

<<< ../../codecs/deflate.c{c}
