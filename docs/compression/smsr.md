# CMPR and SMSR00 slide-LZ

[Yoshi's Story](../YOSHISTORY.md) stores a `CMPR` record containing an
`SMSR00` stream:

| Offset | Size | Field |
|---:|---:|---|
| CMPR `+0x00` | 4 | ASCII `CMPR`. |
| CMPR `+0x04` | 4 | Big-endian size of the following SMSR stream, padded to even. |
| CMPR `+0x08` | 4 | Big-endian decoded size. |
| CMPR `+0x0C` | 4 | Reserved zero. |
| SMSR `+0x00` | 8 | `SMSR00` followed by two zero bytes. |
| SMSR `+0x08` | 4 | Big-endian decoded size. |
| SMSR `+0x0C` | 4 | Big-endian literal offset relative to SMSR `+0x10`. |

Control words and match words are big-endian; each
control word supplies 16 flags most-significant bit first. One means a literal
from the separate stream; zero means a match word. Its high nibble gives
length minus three; its low 12 bits give backward distance minus one. There
is no end marker.

The [C++ reference codec](https://github.com/DSLL32/nviewer/blob/master/codecs/smsr.cpp)
supports bare `SMSR00` and wrapped `CMPR` streams. The encoder searches the
whole 4,096-byte window through three-byte hash chains, then uses dynamic
programming to select the smallest stream. All distances have the same
two-byte cost, so the longest available match also supplies every shorter
match at that position. The parser tracks all 16 control-word phases and
charges the two control bytes when a new word starts; it does not approximate
their cost as a fraction of a byte. It finds a minimum-size parse whose matches
stay within the decoded size, including the final control word. CMPR's even
padding preserves that minimum.

Encoding uses allocation proportional to the input size (about 20 bytes per
input byte, plus a fixed hash table); allocation failures return `-1`.
Decoding needs only the caller's output buffer. The decoder accepts a final
match that extends beyond the declared size, as the game does, but writes
only the declared number of bytes. It bounds control reads at the start of
the literal stream even after literals have been consumed.

## Verification

Verified against the Japanese ROM's indexed CMPR records, with retail sizes
including both headers and even-byte padding but excluding archive alignment:

| ROM record | Decoded bytes | Retail CMPR bytes | Re-encoded bytes | Change |
|---|---:|---:|---:|---:|
| `0x637C20` | 32,256 | 5,652 | 5,582 | −1.24% |
| `0x7F3E70` (largest) | 230,144 | 163,042 | 161,274 | −1.08% |
| All 702 records | 9,580,250 | 3,706,816 | 3,663,384 | −1.17% |

Every record became smaller, and all 702 repacks decode byte-for-byte in
both the reference decoder and the independent viewer decoder. Decoded
FNV-1a hashes for the two individual records are `E87F835B` and `AEA85896`,
respectively. The largest sample encodes in about 0.06 seconds at `-O3`;
reproduce it with `npm run bench:codecs -- --only cmpr`.

ASan/UBSan checks cover all 702 records and 4,463 synthetic round trips,
exact and undersized output buffers, overlap, the 4,096-byte window limit,
control-word boundaries, and 10,000 malformed/truncated inputs. Small binary
strings and varied short inputs also match the minimum sizes from an
independent exhaustive parser.

## Reference source

<<< ../../codecs/smsr.cpp{cpp}
