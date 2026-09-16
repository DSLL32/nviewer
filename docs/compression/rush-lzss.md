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

The [C reference codec](https://github.com/DSLL32/nviewer/blob/master/codecs/rush_lzss.c)
has separate functions for each variant. Its encoder uses one recent
three-byte match per hash bucket, with a 4 KiB search limit. It emits valid
streams without attempting to reproduce retail match choices.

Verification: Rush 1's main image at `0x7A7930` decoded to 509,264 bytes
(FNV-1a `16337489`), matching the viewer; re-encoding took 350,895 bytes
(0.689× decoded size). Rush 2049 file 6, 3,232 stored bytes, decoded to 6,856
bytes (`EF06A70D`) and re-encoded to 3,518 bytes (0.513× decoded size).
Both round trips passed under sanitizers.
