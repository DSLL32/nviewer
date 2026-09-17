# Air Boarder 64 LH5-family stream

[Air Boarder 64](../AIRBOARDER64.md) prefixes each stream with a big-endian
`u32` decoded size, then an MSB-first LH5-family bitstream:

| Offset | Size | Field |
|---:|---:|---|
| `+0x00` | 4 | Big-endian decoded size. |
| `+0x04` | Variable | LH5-family blocks, with no separate magic. |

Each block starts
with a 16-bit token count and canonical Huffman trees for characters and
positions. Character values below 256 are literals; higher values copy
`symbol - 253` bytes from an 8 KiB circular history. A position slot and
its extra bits give the backward distance. The history begins filled with
spaces.

The [C++ reference codec](https://github.com/DSLL32/nviewer/blob/master/codecs/airboarder_lh5.cpp)
decodes dynamic trees without allocating memory. The encoder builds canonical
character and distance trees for each block. It searches an 8 KiB history for
matches at several distance costs, then refines the token choices against the
resulting Huffman bit costs. It uses up to six parsing passes; very redundant
blocks use one pass, and a strong match limits search depth. Encoder scratch
space is bounded by a 16 KiB decoded block; its history is carried across blocks.

The codec has been checked against all indexed compressed records in the
Japanese and PAL archives. Re-encoded streams decode byte-for-byte with the
independent viewer decoder. Bounds checks include block boundaries, Huffman
length limits, and malformed trees.

## Reference source

<<< ../../codecs/airboarder_lh5.cpp{cpp}
