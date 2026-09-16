# ERZ version 2

[Spider-Man](../SPIDERMAN.md) uses ERZ2 for its boot image pages and most
archive leaves. Each block has this layout:

| Offset | Size | Field |
|---:|---:|---|
| `+0x00` | 3 | ASCII `ERZ`. |
| `+0x03` | 1 | Version `02`. |
| `+0x04` | 4 | Big-endian decoded size. |
| `+0x08` | 4 | Big-endian compressed size. |
| `+0x0C` | 6 | Ignored by the decoder. |
| `+0x12` | Variable | Compressed bitstream. |

The first control byte contributes bits 5..0; later control bytes contribute
bits 7..0. Control bytes and raw bytes are interleaved. A zero dispatch bit
stores a literal byte, and two successive zero bits store two literals.
The one-bit branch begins a back-reference or an escape:

| Control prefix | Followed by |
|---|---|
| `110` | One raw distance byte; copy two bytes. |
| `1110` | Distance prefix and byte; copy three bytes. |
| `1111` | Raw length byte: zero selects the end escape; otherwise copy length + 8 bytes. |
| `10` | Gamma-coded length, then distance, except length nine selects a raw run. |

Raw runs store 12, 16, ..., 72 bytes. Distance zero repeats the previous
byte; other distances permit overlapping matches. Blocks are independent.

The [C reference codec](https://github.com/DSLL32/nviewer/blob/master/codecs/erz2.c)
bounds input and output and allocates nothing. Its encoder uses a bounded
greedy match search, literal pairs, and raw runs. It is valid but not tuned
to match the original packer's ratio.

The first two Spider-Man boot blocks, at ROM `0x13B7C` and `0x1ABC8`, each
decode to 65,536 bytes. Original packed → decoded → reference repacked sizes
were 28,748 → 65,536 → 30,693 and 32,884 → 65,536 → 34,585 bytes.
The viewer independently decoded both repacked streams byte-for-byte to the
original output (FNV-1a `C8510988` and `342EDC6F`). Sanitized varied-content
round trips also passed.
