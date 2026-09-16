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
decodes dynamic trees and encodes using small fixed canonical trees plus a
bounded greedy match search. It has no heap allocation. Two Japanese ROM
entries matched the viewer byte-for-byte:

| Entry | ROM stored | Decoded | Re-encoded | FNV-1a decoded |
|---|---:|---:|---:|---|
| Course archive 74 | 305,074 | 814,624 | 388,219 | `E01A4685` |
| Archive 0 | 4,716 | 20,744 | 6,981 | `AC86416B` |

Both re-encoded streams round-tripped under sanitizers. The fixed trees are
intentionally simpler than the retail compressor and may produce larger files.

## Reference source

<<< ../../codecs/airboarder_lh5.cpp{cpp}
