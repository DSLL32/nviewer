# Shadows of the Empire LZSS

[Star Wars: Shadows of the Empire](../SHADOWS_OF_THE_EMPIRE.md) uses this
LSB-first flag LZSS stream for scene ID 00 and the shared image archive. It
has no in-stream decoded-size header. The surrounding scene or archive
metadata supplies bounds; an absolute ring-position-zero token terminates
the stream.

Each flag byte describes up to eight following tokens, consuming bits 0–7.
A set bit reads one literal byte. A clear bit reads a two-byte token:

| Offset | Bits | Field | Meaning |
|---:|---|---|---|
| `0x00` | `7:4` | `lengthCode` | Copy `lengthCode + 2` bytes. |
| `0x00` | `3:0` | `ringPositionHigh` | Upper four bits of an absolute 12-bit ring position. |
| `0x01` | `7:0` | `ringPositionLow` | Lower eight bits; zero position terminates the stream. |

The history ring is 4 KiB, initially zero-filled, with write position one.
Every output byte is written to the ring, including bytes produced by a match.
A match reads from successive absolute ring positions, wrapping at 4 KiB, and
may overlap the bytes it writes. The token's first byte is **not** a relative
backward distance. A terminator may appear before all eight flags are used;
padding following it is outside the bitstream.

The [standalone C++17 reference](https://github.com/DSLL32/nviewer/blob/master/codecs/shadows_lzss.cpp)
contains a bounded decoder and a greedy hash-chain encoder. The encoder emits
real matches, avoids position zero except for its final token, and does not
try to reproduce retail parse decisions. Both functions return zero on success
and `-1` on invalid input or inadequate destination capacity; the decoder
also reports the bytes consumed through the terminator.

Verified against scene 00 and the shared image archive in all four retail
releases. All eight re-encodes round-trip byte-for-byte; the USA V1.0 scene
output also matches an independent decoder. In USA V1.0, scene 00's indexed
member occupies
71,232 bytes including alignment; the reference encoder produces 71,567 bytes.
The image archive occupies 1,246,800 stored bytes, versus 1,244,550 reference
bytes. The two encodes took 8 ms and 69 ms respectively with `-O3` on the
audit host, below the 2 s per 10 KiB output budget; these times are not
portable guarantees.

## Reference source

<<< ../../codecs/shadows_lzss.cpp{cpp}
