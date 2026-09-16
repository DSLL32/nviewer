# VPK0

[Pokémon Snap](../POKEMONSNAP.md) uses VPK0 for three menu, intro, and check
buffers; course assets themselves are raw.

| Offset | Size | Field |
|---:|---:|---|
| `+0x00` | 4 | ASCII lowercase `vpk0`. |
| `+0x04` | 4 | Big-endian decoded size. |
| `+0x08` | Variable | MSB-first bitstream, starting with an 8-bit method. |

Two post-order trees describe offset and length values. A
zero token bit gives an eight-bit literal; a one gives a back-reference. Method
0 uses a direct backward distance. Method 1 combines one or two offset-tree
values into an interleaved distance, as detailed in the game manual.

The [C reference codec](https://github.com/DSLL32/nviewer/blob/master/codecs/vpk0.c)
decodes both methods and uses fixed-width value leaves plus a bounded match
search when encoding. The encoder takes a method argument (`0` or `1`) and
does not attempt retail tree optimization.

Two USA ROM streams matched the independently written VPK0 decoder:

| Stream | ROM stored | Decoded | Re-encoded (method 1) | FNV-1a decoded |
|---|---:|---:|---:|---|
| Main menu | 316,438 | 997,232 | 495,749 | `2CCF3810` |
| Intro | 3,411 | 28,944 | 6,977 | `7487AD95` |

Both methods pass sanitized round trips. Re-encoded output is valid but larger
than the retail stream because the reference trees are fixed.
