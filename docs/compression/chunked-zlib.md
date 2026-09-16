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
uses zlib (`-lz`) for each block. It needs no extra allocation of its own. A
container at ROM `0x1775C0` was checked against independent zlib inflation:
44,004 stored bytes yielded 150,224 bytes, FNV-1a `E83FD904`. Re-encoding
that output produced 44,004 bytes and round-tripped under sanitizers.

## Reference source

<<< ../../codecs/chunked_zlib.c{c}
