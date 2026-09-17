# Yay0

[Bomberman 64: The Second Attack!](../BOMBERMAN64_SECOND_ATTACK.md) uses Yay0
for some archive resources. Its resource wrapper stores a decoded-size word
before the `Yay0` magic; the offsets below are relative to the magic, not the
start of that wrapper.

## Stored layout

All header words are big-endian.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `char[4]` | `magic` | ASCII `Yay0`. |
| `0x04` | 4 | `u32` | `decodedSize` | Number of bytes to produce. |
| `0x08` | 4 | `u32` | `linkOffset` | Start of the back-reference stream. |
| `0x0C` | 4 | `u32` | `chunkOffset` | Start of literals and extended lengths. |
| `0x10` | variable | `u32[]` | `controlWords` | Bits consumed most-significant first. |

A control bit of 1 consumes one literal byte from the chunk stream. A bit of
0 consumes one big-endian `u16` from the link stream. Its low twelve bits
encode `distance - 1`. A nonzero high nibble encodes `length - 2`; a zero
high nibble consumes an additional chunk byte `c` and gives `length = c + 18`.
Matches copy forward and may overlap. Stop after `decodedSize` output bytes.

## Reference codec

The encoder searches the full 4 KiB window and finds a minimum-size parse,
including the final control word's padding. Its dynamic-programming state
tracks the input position and token count modulo 32: each literal costs one
byte, a 3–17-byte match costs two, an 18–273-byte match costs three, and each
new control word costs four. Since all distances have the same cost, every
prefix of the longest available match covers all useful choices. A rolling
range-minimum tree evaluates both match-length ranges for all 32 token phases
together. There is no search-depth limit or greedy parsing approximation.

The minimum applies to streams whose matches stay within the declared output
size; the encoder does not emit a final match that would require truncation.
It writes the Yay0 stream without the game's outer decoded-size word, and does
not reproduce the original game's compressed bytes. Both functions return 0
on success or −1 for malformed input, insufficient space, or allocation failure.
The maintained source is
[codecs/yay0.cpp](https://github.com/DSLL32/nviewer/blob/master/codecs/yay0.cpp).

The codec has been checked against the Yay0 resources in The Second Attack's
US archive. Re-encoded streams decode byte-for-byte with the independent
viewer decoder. Bounds checks include control-word boundaries, overlap,
truncation, and insufficient output capacity. An independent exhaustive
parser confirms encoded size on short inputs.

<<< ../../codecs/yay0.cpp{cpp}
