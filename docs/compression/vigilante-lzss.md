# Vigilante LZSS

[Vigilante 8](../VIGILANTE8.md) and
[Vigilante 8: 2nd Offense](../VIGILANTE8_2ND_OFFENSE.md) store archive files in
this 2 KiB-ring LZSS format. It is distinct from the other LZSS variants in
this catalog: flags are read most-significant bit first, match tokens contain
an absolute 11-bit ring position, and their five-bit length field permits
copies of 2–33 bytes. The archive directory supplies each packed file's byte
length.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | ASCII | `magic` | `LZSS`. |
| `0x04` | 4 | `u32le` | `decodedSize` | Decoded byte count; local little-endian exception. |
| `0x08` | Variable | u8 stream | `tokens` | Flag groups and their literal/match tokens. |

Each flag byte controls up to eight tokens, from bit 7 to bit 0. A set bit
reads one literal byte. A clear bit reads a 16-bit little-endian match token:

| Token bits | Field | Meaning |
|---|---|---|
| `15:5` | source | Absolute position in the 2,048-byte history ring. |
| `4:0` | lengthCode | Copy `lengthCode + 2` bytes. |

The ring begins zero-filled, with write position zero. Every emitted byte,
including a copied byte, is written to the ring; matches may overlap the
write cursor. Decoding stops at `decodedSize`, not at a token-level terminator.
The final flag group may contain fewer than eight tokens.

The [reference C++ codec](https://github.com/DSLL32/nviewer/blob/master/codecs/vigilante_lzss.cpp)
includes a bounded decoder and an encoder with effort levels 0–9. Higher
effort searches more same-hash history candidates, from one candidate to the
full ring. For the available matches, the encoder chooses a minimum-byte
parse, including each flag byte. It may use the ring's unwritten zero cells,
but never crosses their first wrap. The default uses effort 9. Both functions
return zero on success or `-1` for invalid input or insufficient output space.

Verification against the indexed USA ROM archives: all 66 original-game and
98 sequel streams decode to their declared sizes and consume exactly their
directory-record lengths. All 164 streams re-encoded by the reference codec
decode byte-for-byte to their original decoded data. For the largest indexed
stream in each game, the reference encoder produces:

| Game and asset | Retail bytes | Reference bytes | Decoded bytes |
|---|---:|---:|---:|
| Vigilante 8 `COMMON.EXP` | 554,753 | 536,440 | 1,025,022 |
| 2nd Offense `COMMON.EXP` | 952,079 | 916,990 | 1,924,786 |

## Reference source

<<< ../../codecs/vigilante_lzss.cpp{cpp}
