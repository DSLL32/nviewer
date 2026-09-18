# Glover FLA2

[Glover](../GLOVER.md) stores its 19 referenced texture banks, 56 object
banks, and one unreferenced texture bank as FLA2 streams. The stream begins
with an eight-byte header:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `char[4]` | Magic | ASCII `FLA2`. |
| `0x04` | 4 | `u32le` | Decoded size | Byte count after decompression. |
| `0x08` | variable | bytes | LZSS stream | Tokens through the end marker. |

The 4 KiB history ring starts at position zero and is filled with zeroes.
Each flag byte describes up to eight tokens, most-significant bit first.
A clear bit copies the next byte literally. A set bit reads a first token
byte `a`: `a == 0` ends the stream without reading a second byte. Otherwise
read `b` and copy `(a & 15) + 2` bytes from the history ring. The 12-bit
field `((a & 0xF0) << 4) | b` is the backward distance modulo 4096: field
zero denotes 4096 bytes back, and fields 1–4095 denote those distances.
Both literals and match output are written to the ring as produced, so
matches may overlap their own output. The decoder should check that the
decoded byte count matches the header at termination.

The game's indexed ROM ranges are rounded up to 64 bytes and padded with
zeroes. That padding follows the end marker and is not part of the FLA2
stream. A replacement stream may be padded to the next 64-byte boundary
when laid out in ROM.

The [C++17 reference codec](https://github.com/DSLL32/nviewer/blob/master/codecs/fla2.cpp)
provides a bounded decoder and encoder. The encoder searches the full legal
4 KiB history, including the initial zero-filled portion, and chooses a
minimum-byte token parse with exact flag-byte and terminator costs. It
does not attempt to reproduce the original token choices. All 76 indexed
retail streams decode to their header sizes and terminate within their ROM
ranges; all 76 re-encoded streams decode byte-identically.

## Reference source

<<< ../../codecs/fla2.cpp{cpp}
