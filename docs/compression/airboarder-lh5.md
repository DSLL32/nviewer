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

The largest indexed Japanese/PAL archive stream in the J ROM begins at
`0x56A8F4`. It occupies 583,156 retail bytes and decodes to 1,271,176 bytes.
The reference encoder produces **568,048 bytes** (2.59% below retail) in
2.33 seconds with `-O3` on the test host, or 0.042 seconds per 10 KiB of
compressed output. The C++ decoder and the independent viewer TypeScript
decoder both reproduced all 1,271,176 decoded bytes.

All 44 J and 45 PAL compressed archive records re-encoded and round-tripped.
Their slowest normalized encode time was 0.775 seconds per 10 KiB of compressed
output, below the 2-second budget.

Address/undefined-behavior sanitizer round trips passed on 2,128 varied
inputs, including block boundaries, repetitive data and random data. A separate
sanitizer test checked 2,000 skewed and random Huffman frequency sets, including
odd and even length-limit overflows. Streams made with both overflow cases also
decoded byte-for-byte in the independent viewer decoder.

## Reference source

<<< ../../codecs/airboarder_lh5.cpp{cpp}
