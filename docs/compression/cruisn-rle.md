# Cruis'n USA RLE

[Cruis'n USA](../CRUISN_USA.md) uses a run/literal stream for five assets in
each documented ROM release. The asset catalog supplies the decoded byte count
and a ROM extent; the stream has no header or terminator. Its control and data
elements are 1, 2, or 4 bytes wide, selected by the catalog descriptor's low
nibble (`2`, `3`, or `4`, respectively). All five known compressed assets use
one-byte elements. The kernel contains the corresponding two- and four-byte
decoders, but no catalog entry in the documented releases selects them.

Each token has this variable-size layout. Multi-byte elements are big-endian.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `W` | `u8`, `u16`, or `u32` | `control` | The high bit selects a run; remaining bits encode its length. |
| `W` | Variable | Array of `W`-byte elements | `payload` | One element for a run, or the literal elements themselves. |

| Control high bit | Payload | Output elements |
|---:|---|---:|
| `0` | `control + 1` literal elements | `control + 1` |
| `1` | One repeated element | `(control & (2^(8W−1)−1)) + 3` |

The decoder stops when it has emitted the catalog's exact decoded byte count.
The stored extent may contain up to three following alignment bytes; these are
not part of the stream and need not be zero. Repeating a one-, two-, or
four-byte element preserves its byte order without arithmetic on its value.

The [C++17 reference](https://github.com/DSLL32/nviewer/blob/master/codecs/cruisn_rle.cpp)
implements all three element widths. Its one-byte encoder searches every legal
literal and run length using a shortest-path parse, so its stream is minimum
size for this grammar. The wider-width encoder uses bounded candidate lengths
plus the longest available run; it produces valid streams but is not claimed
optimal. The decoder checks input truncation, output overruns, and element
alignment.

## Reference source

<<< ../../codecs/cruisn_rle.cpp{cpp}
