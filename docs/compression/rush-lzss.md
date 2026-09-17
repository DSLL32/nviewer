# Rush LZSS

Both [San Francisco Rush](../SAN_FRANCISCO_RUSH.md) and
[Rush 2049](../SAN_FRANCISCO_RUSH_2049.md) consume flag bytes least-significant
bit first. A set bit means one literal byte. A clear bit means two bytes `a,b`:
the 12-bit field `(a & 0xF0) << 4 | b` is an address, and the copied length is
`(a & 0x0F) + 2`. The zero address with length two ends the stream.

The variants interpret that address differently. Rush 2049 reads it as a
backward distance from the output cursor. Rush 1 reads an absolute index in a
zero-filled, 4 KiB circular dictionary whose initial write index is one. Copy
and dictionary writes happen one byte at a time, so matches can overlap.

The [C++ reference codec](https://github.com/DSLL32/nviewer/blob/master/codecs/rush_lzss.cpp)
has separate entry points for the two variants and a shared encoder. The
encoder searches the complete legal 4 KiB history for matches of lengths
2–17, including Rush 1's initially zero-filled ring, then uses dynamic
programming to minimize the byte count, including one flag byte per eight
tokens and the terminating token. It does not try to reproduce retail token
choices; multiple equally short streams can represent the same bytes.

The codec has been checked against the indexed LZSS streams in both games.
Re-encoded streams decode byte-for-byte with the independent viewer decoders.
Bounds checks include ring-wrap and short-capacity cases.

## Reference source

<<< ../../codecs/rush_lzss.cpp{cpp}
