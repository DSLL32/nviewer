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
contains a bounded decoder followed by a shortest-path encoder. It searches
the full written 4 KiB history, considers every available match length from
2 to 17, and minimizes nine-bit literal and seventeen-bit match costs. These
include the flag bit: rounding the total up to bytes exactly accounts for
flag groups, including the final terminator. The resulting parse has minimum
byte size among matches into written history; the encoder does not reference
the initially zero-filled ring. It avoids position zero except for its final
token and does not reproduce retail parse decisions. Both functions return
zero on success and `-1` on invalid input or inadequate destination capacity; the decoder
also reports the bytes consumed through the terminator.

Verified against scene 00 and the shared image archive in all four retail
releases. All eight re-encodes round-trip byte-for-byte through both the C++
reference decoder and the independent TypeScript viewer decoder. Every
re-encode is smaller than retail and smaller than the previous greedy
encoder.

The shared image archive is the largest retail stream in every release,
with tied stored sizes; USA V1.0 is the primary benchmark. Retail sizes
include archive alignment; reference sizes end immediately after the
terminator.

| Stream | Retail bytes | Previous greedy bytes | Tuned bytes | Encode time |
|---|---:|---:|---:|---:|
| USA V1.0 shared images | 1,246,800 | 1,244,550 | 1,207,027 | 0.75 s |
| USA V1.0 scene 00 | 71,232 | 71,567 | 68,942 | 0.17 s |

Measured with GCC 14.2, `-O3 -std=c++17`, on an Intel Xeon E5-2697 v2.
The worst normalized time across all eight streams is 0.026 s per 10 KiB of
compressed output, below the 2 s budget; host timings are not portable
guarantees. ASan and UBSan checks cover empty
inputs, short and exact-capacity buffers, truncated and malformed streams,
two-byte matches, overlapping matches, and ring wrap.

## Reference source

<<< ../../codecs/shadows_lzss.cpp{cpp}
