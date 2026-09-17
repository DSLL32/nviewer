# ERZ version 2

[Spider-Man](../SPIDERMAN.md) uses ERZ2 for its boot image pages and most
archive leaves. Each block has this layout:

| Offset | Size | Field |
|---:|---:|---|
| `+0x00` | 3 | ASCII `ERZ`. |
| `+0x03` | 1 | Version `02`. |
| `+0x04` | 4 | Big-endian decoded size. |
| `+0x08` | 4 | Big-endian compressed size, excluding the 18-byte header and archive padding. |
| `+0x0C` | 6 | Ignored by the decoder. |
| `+0x12` | Variable | Compressed bitstream. |

The first control byte contributes bits 5..0; later control bytes contribute
bits 7..0. Control bytes and raw bytes are interleaved. A zero dispatch bit
stores a literal byte, and two successive zero bits store two literals.
The one-bit branch begins a back-reference or an escape. In the table below,
`a` and `b` are individual bits:

| Control prefix | Followed by |
|---|---|
| `110` | One raw distance byte; copy two bytes from at most 256 bytes back. |
| `1110` | Distance prefix and byte; copy three bytes. |
| `1111` | Raw length byte: zero selects the end escape; otherwise copy length + 8 bytes. |
| `10a0` | Distance prefix and byte; copy `4 + a` bytes. |
| `10a1b` | Distance prefix and byte; copy `6 + 2a + b` bytes, except nine selects a raw run. |

The length-nine escape is followed by four control bits `r`, then
`12 + 4r` raw bytes: runs can store 12, 16, ..., 72 bytes. The end escape is
followed by one control bit: zero ends the block, and one resumes dispatch.
The output must equal the declared size when the block ends.

For matches of three or more bytes, these control prefixes encode the high
part `h` of a distance. A raw low byte `l` follows, and the back-distance is
`256h + l + 1`:

| Distance prefix | `h` |
|---|---:|
| `0` | 0 |
| `110` | 1 |
| `100a` | `2 + a` |
| `1a1b1` | `4 + 2a + b` |
| `1a1b0c` | `8 + 4a + 2b + c` |

Thus the window is 4 KiB, and matches span 2..263 bytes. Encoded distance
zero means a back-distance of one and repeats the previous byte; other
distances permit overlapping matches. Blocks are independent.

## Reference encoder

The [C++ reference codec](https://github.com/DSLL32/nviewer/blob/master/codecs/erz2.cpp)
bounds input and output. Its decoder allocates nothing; its encoder uses
about 16 bytes of working memory per input byte plus a 256 KiB pair index.
Allocation failure returns `-1`, as do malformed input and insufficient
output capacity.

The encoder searches every matching two-byte prefix in the complete 4 KiB
window and finds a minimum-size parse. Nearby candidates have distance costs
no greater than farther candidates, so only newly reached match lengths need
evaluation. Dynamic programming considers every usable match length, single
literals, and every raw-run length. A literal costs nine bits; the short
two-byte match costs eleven. Other match costs include their actual length
and distance prefixes. Raw bytes do not change the control-bit phase, so
minimizing total bits also minimizes bytes after rounding the final control
byte. This includes the fixed two skipped bits and the end escape. No
search-depth or compression-level setting is needed.

The codec has been checked against all 1,584 ERZ2 blocks in the Spider-Man
(USA) boot and archive indexes. Re-encoded streams decode byte-for-byte with
the independent viewer decoder. An independent parser confirms the encoded
size for short inputs and distance-boundary cases; bounds checks include
undersized buffers and malformed streams.

## Reference source

<<< ../../codecs/erz2.cpp{cpp}
