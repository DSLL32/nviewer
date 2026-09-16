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

Verification: the largest indexed Rush 1 stream at `0x2354C0` consumed
570,270 retail bytes and decoded to 1,052,128 bytes. The encoder produced
550,972 bytes in 0.35 seconds (`g++ -O3`), 3.38% below retail. The largest
indexed Rush 2049 LZSS stream at `0x399370` consumed 90,821 bytes (excluding
11 archive-padding bytes) and decoded to 219,288; the encoder produced 88,856
bytes in 0.30 seconds, 2.16% below retail. Both were checked byte-for-byte
with the C++ and independent viewer decoders. Across the complete indexed
corpora, all 69 unique Rush 1 streams (including the main image) improved,
with aggregate bytes 6,333,101 → 6,095,212; all 48 Rush 2049 LZSS files
improved, 619,752 → 602,530. An AddressSanitizer/UBSan run passed 1,600
mixed-pattern round trips, including 4 KiB boundary cases and short-capacity
checks.

## Reference source

<<< ../../codecs/rush_lzss.cpp{cpp}
