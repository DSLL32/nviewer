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
| DKR | Little-endian 32-bit decoded size, one level byte, then raw DEFLATE | [Jet Force Gemini](../JETFORCEGEMINI.md), Diddy Kong Racing |

In Banjo-Kazooie, the `1172` size field occupies bytes `+2..+5`; the DEFLATE
stream begins at `+6`. The size is the exact decoded byte count. Asset-table
extents are eight-byte aligned and may end with `AA` padding after the final
DEFLATE block; the padding is not part of the bitstream.
An empty Banjo asset still has a six-byte header and a two-byte empty DEFLATE
stream.

## Diddy Kong Racing / Jet Force Gemini wrapper

Verified from Jet Force Gemini USA ROM bytes and disassembly: each stream has
a five-byte header followed immediately by raw DEFLATE. The header contains no
magic signature, compressed length, checksum, or pointer. The decoded-size
field is little-endian even though the surrounding archive tables are
big-endian. Stream termination is the RFC 1951 final block, independent of the
enclosing archive allocation; padding after that block is not compressed data.
The wrapper itself imposes no alignment.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `u32`, little-endian | `decodedSize` | Exact number of output bytes. |
| `0x04` | `0x01` | `u8` | `level` | Compression-level metadata; `0x09` in every audited Jet Force Gemini stream. The game inflater ignores this byte. |
| `0x05` | Variable | RFC 1951 bitstream | `payload` | Raw DEFLATE, ending at the final block. No gzip trailer or zlib Adler-32 follows it. |

Verified by disassembly: Jet Force Gemini USA's decoded-size reader at
`0x800724DC` combines four byte loads with shifts of `0`, `8`, `16`, and `24`.
Its inflater at `0x80072548` starts at input `+5` and processes blocks until the
final block. It does not use the level byte to select a decoder. The reference
decoder additionally requires the output length to equal `decodedSize` and
rejects an insufficient destination buffer.

Decompilation-derived: the
[Diddy Kong Racing asset writer](https://github.com/DavidSM64/Diddy-Kong-Racing/blob/84f0ea569b07903ba8a4f9f252e8dc8e4ba54bdc/tools/dkr_assets_tool_src/libs/gzip/DKRCompression.cpp)
uses the same wrapper. It invokes a level-9 gzip compressor, retains only the
raw payload, and prepends the decoded size and `0x09`. Its archive padding is a
container rule, not part of the compression format.

Verified from ROM bytes and independent decoding: all 1,207 streams indexed by
Jet Force Gemini USA's screen, scene, and model tables decode to their stored
sizes. Re-encoding them with the reference profile and decoding them with the
viewer’s independent RFC 1951 decoder preserves every output byte. The profile
can enlarge individual assets; archive offsets and allocation sizes must be
rebuilt when a replacement no longer fits.

An optional retail reproduction recipe uses GNU gzip 1.13 with `-n -9`: remove
its ten-byte gzip header and eight-byte trailer, then prepend the four-byte
little-endian decoded size and `0x09`. Verified on Jet Force Gemini USA scene
entry `0x56` at ROM `0xEEE9C0`, that recipe reproduces every stored stream byte,
excluding archive padding. This is a separate tool-based recipe, not the zlib
reference encoder, and byte identity has not been established for other inputs
or gzip versions.

## Reference codec

The [C reference codec](https://github.com/DSLL32/nviewer/blob/master/codecs/deflate.c)
offers `raw_deflate_*`, `rare1172_*`, `rare1172_u32_*`, `rare1173_*`, and
`rare_dkr_*` buffer functions. It uses zlib (`-lz`) for the standard DEFLATE
bitstream and implements the Rare headers itself. The encoders make valid
streams without promising byte-identical retail output. They use a 32 KiB
window and the default zlib strategy:

| Encoder | zlib level | `memLevel` |
|---|---:|---:|
| Raw DEFLATE | 8 | 6 |
| Rare `1172` | 9 | 5 |
| Rare `1172` with size | 9 | 5 |
| Rare `1173` | 9 | 7 |
| Rare DKR | 9 | 6 |

The buffer functions return `0` on success and `-1` for invalid input,
unsupported lengths, insufficient capacity, or a zlib failure. Source and
destination must not overlap. Callers provide input and output storage; the
wrapper adds no allocation beyond zlib's internal state. The DKR decoder
accepts padding after the final block and checks the decoded size. Its encoder
writes a level byte of `0x09` and emits no alignment padding.

`rare1173_encode_retail_size` is an optional level-9, `memLevel`-9 profile.
It matches the stored length of the documented Perfect Dark boot stream, but
not its bytes; the default `rare1173_encode` uses `memLevel` 7. Neither profile
guarantees a particular output size on other inputs.

The codec has also been checked against GoldenEye, Perfect Dark, Rush 2049, and
Banjo-Kazooie ROM streams. Re-encoded streams decode byte-for-byte with the
independent viewer decoder. For reproducible size and timing comparisons, use
the [compression benchmark](./index.md).

## Reference source

<<< ../../codecs/deflate.c{c}
