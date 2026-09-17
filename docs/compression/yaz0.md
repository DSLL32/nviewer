# Yaz0

Yaz0 compresses individual files in the retail [Ocarina of Time](../OCARINA_OF_TIME.md)
and [Majora's Mask](../MAJORAS_MASK.md) ROMs. The filesystem's `dmadata`
record identifies the stored ROM range and expected decoded length. Some files
are raw, and Ocarina of Time's Master Quest debug image stores its files raw.

## Stored layout

Multi-byte header fields are big-endian.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `char[4]` | `magic` | ASCII `Yaz0`. |
| `0x04` | 4 | `u32` | `decodedSize` | Number of bytes to produce. |
| `0x08` | 8 | byte array | `reserved` | Zero in the documented files. |
| `0x10` | variable | token stream | `tokens` | Control bytes and operands. |

Each control byte supplies eight flags, most-significant bit first. A 1 copies
one following literal byte. A 0 reads two bytes `a,b`; the distance is
`(((a & 0x0F) << 8) | b) + 1`. If `a >> 4` is nonzero, the match length is
`(a >> 4) + 2`; otherwise a third byte `c` supplies `c + 18`.
Matches copy forward from already decoded output and may overlap. Stop at
`decodedSize`; remaining flags in the final control byte are unused.

## Reference C codec

The encoder checks every candidate in the preceding 4 KiB window and records
the longest match at each input byte. A backward parse then minimizes the
encoded byte count, considering literals, two-byte matches of length 3–17,
three-byte matches of length 18–273, and the position within each eight-token
control group. Any shorter length of a recorded match remains valid at the
same distance, so this finds a minimum-size Yaz0 stream; the bytes need not
match the game's encoder. Both functions return 0 on success or −1 for
malformed input or insufficient space.
The maintained source is [codecs/yaz0.cpp](https://github.com/DSLL32/nviewer/blob/master/codecs/yaz0.cpp).

The codec has been checked against compressed `dmadata` files in the US and
European Majora's Mask and US Ocarina of Time ROMs. Re-encoded streams decode
byte-for-byte with the independent viewer decoder. An exhaustive match
enumeration confirms encoded size on short inputs.

<<< ../../codecs/yaz0.cpp{cpp}
