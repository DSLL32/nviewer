# MIO0

MIO0 is a three-stream LZ format. [Mario Kart 64](../MARIOKART64.md),
[Pilotwings 64](../PILOTWINGS64.md), and [Star Fox 64](../STARFOX.md) use it.
Pilotwings places MIO0 data inside chunks tagged `GZIP`; that tag does not
indicate gzip or DEFLATE.

## Stored layout

All header words are big-endian, and offsets are relative to the `MIO0` magic.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `char[4]` | `magic` | ASCII `MIO0`. |
| `0x04` | 4 | `u32` | `decodedSize` | Number of bytes to produce. |
| `0x08` | 4 | `u32` | `linkOffset` | Start of the back-reference stream. |
| `0x0C` | 4 | `u32` | `literalOffset` | Start of the literal stream. |
| `0x10` | variable | `u32[]` | `controlWords` | Bits consumed most-significant first. |

A control bit of 1 copies one byte from the literal stream. A bit of 0 consumes
one big-endian `u16` from the link stream: the top four bits encode
`length - 3`, and the low twelve encode `distance - 1`. Copy forward from
`outputPosition - distance`, allowing overlapping matches. Stop after
`decodedSize` output bytes; unused bits in the last control word are ignored.
The three streams are ordered control words, links, then literals. Surrounding
game containers may add alignment padding after the MIO0 stream.

## Reference C codec

The encoder uses a recent-match hash table and greedily emits matches of 3–18
bytes; it does not aim for a bit-identical rebuild. Both functions accept caller
buffers and return 0 on success or −1 for malformed input or insufficient space.
The maintained source is [codecs/mio0.cpp](https://github.com/DSLL32/nviewer/blob/master/codecs/mio0.cpp).

Verification: Mario Kart 64's ROM stream at `0x132B50` decoded to 184,664
bytes (FNV-1a `43BFF052`), matching the viewer. Sanitized encoder round trips
passed on prefixes up to 8,192 bytes.

<<< ../../codecs/mio0.cpp{cpp}
