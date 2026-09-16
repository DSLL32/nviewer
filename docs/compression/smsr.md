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

The [C reference codec](https://github.com/DSLL32/nviewer/blob/master/codecs/smsr.c)
supports bare `SMSR00` and wrapped `CMPR` streams. Its encoder uses one recent
three-byte match per hash bucket. The ROM record at `0x637C20` decoded to
32,256 bytes (FNV-1a `E87F835B`), identical to the viewer. The original CMPR
record was 5,652 bytes; re-encoding made a 7,574-byte record (0.235× decoded
size). Sanitized round trips pass.
