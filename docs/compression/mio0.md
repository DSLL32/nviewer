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

## Reference C++ codec

The encoder searches all matching candidates in the 4 KiB window with a hash
chain, then chooses 3–18-byte links or literals by a backward cost pass. Control
bits are priced at one eighth of a byte; the final control word is rounded to
four bytes. It does not aim for a bit-identical rebuild. Both functions accept
caller buffers and return 0 on success or −1 for malformed input or insufficient
space.
The maintained source is [codecs/mio0.cpp](https://github.com/DSLL32/nviewer/blob/master/codecs/mio0.cpp).

Verification: the largest indexed stream, Star Fox 64 U V1.1 at `0xA88180`,
repacked to 190,009 bytes versus 191,968 retail (396,960 decoded bytes) in
0.46 seconds at `-O3`. All 4,727 MIO0 streams found in the US Star Fox 64,
Mario Kart 64, and Pilotwings 64 ROMs round-tripped through this codec and
matched the respective independent viewer decoders byte-for-byte. The slowest
observed encode rate was 0.27 seconds per 10 KiB of output. ASan/UBSan passed
119 varied-size and patterned round trips, including short-output checks.

<<< ../../codecs/mio0.cpp{cpp}
