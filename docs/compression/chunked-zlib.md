# Chunked zlib

[Stunt Racer 64](../STUNTRACER64.md) wraps independent zlib streams in a
big-endian container:

| Offset | Size | Field |
|---:|---:|---|
| `+0x00` | 4 | Complete stored size, including this header. |
| `+0x04` | 4 | Concatenated decoded size. |
| `+0x08` | Variable | Repeated blocks. |

Each block has a big-endian `u32` compressed size, that many bytes of zlib
data, and possibly one padding byte to reach an even offset. Every non-final
block expands to 16,000 bytes; the final one expands to the remainder.

The [C reference codec](https://github.com/DSLL32/nviewer/blob/master/codecs/chunked_zlib.c)
uses zlib (`-lz`) for each block. The encoder tries level 9 with the default
strategy, `memLevel` 3–8, and 4 KiB or 32 KiB windows, keeping the smallest
stream for each fixed 16,000-byte input block. Smaller token buffers can improve
DEFLATE block boundaries; shorter windows can avoid costly long-distance matches.
The encoder uses two 16 KiB stack buffers in addition to zlib's workspace.
Destination capacity is checked against the chosen stream and its padding,
allowing an exactly sized output buffer.

The codec has been checked against all indexed containers in the ROM.
Re-encoded blocks decode byte-for-byte with the independent viewer decoder,
including separate Adler-32 validation. Bounds checks include empty inputs,
block boundaries, truncation, and exact or insufficient output capacity.

## Reference source

<<< ../../codecs/chunked_zlib.c{c}
