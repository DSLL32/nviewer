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

## Reference C codec

The encoder greedily chooses a recent match per hash bucket and does not
reproduce the original game's compressed bytes. It writes the Yay0 stream,
without the game's outer decoded-size word. Both functions return 0 on success
or −1 for malformed input or insufficient space. The maintained source is
[codecs/yay0.c](https://github.com/DSLL32/nviewer/blob/master/codecs/yay0.c).

<<< ../../codecs/yay0.c
