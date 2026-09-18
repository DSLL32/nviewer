# HVQ 2.0 still images

[Mario Party](../MARIOPARTY.md) stores its board backgrounds as 64×48 HVQ 2.0
tiles and its mini-game instruction pictures as 160×128 HVQ 2.0 images. This
is a lossy, intra-frame YUV 4:2:0 image codec. It is distinct from the
[Hudson LZSS](./hudson-lzss.md) used by the game's main filesystem.

## Container

All multibyte header fields are big-endian except the word count at `0x18`.
Section offsets are relative to the start of the image. Each section begins
with a four-byte big-endian payload length; zero length means no payload.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 16 | char[16] | Magic | `HVQ 2.0` followed by zero padding. |
| `0x10` | 2 | u16 | Width | Image width. |
| `0x12` | 2 | u16 | Height | Image height. |
| `0x14` | 2 | u16 | Nest X | Start X in the Y DC plane. |
| `0x16` | 2 | u16 | Nest Y | Start Y in the Y DC plane. |
| `0x18` | 4 | u32 LE | Fix words | Number of 16-bit fix words; not consumed by the game decoder. |
| `0x1C` | 1 | u8 | Y shift | `8` selects a 70×38 nest. |
| `0x1D` | 1 | u8 | DC quantization | Left shift applied to signed DC symbols. |
| `0x1E` | 1 | u8 | Horizontal sampling | `2` in these images. |
| `0x1F` | 1 | u8 | Vertical sampling | `2` in these images. |
| `0x20` | 4 | u32 | Basis-count Y | Section offset. |
| `0x24` | 4 | u32 | Basis-count UV | Section offset. |
| `0x28` | 4 | u32 | Basis-run Y | Section offset. |
| `0x2C` | 4 | u32 | Basis-run UV | Section offset. |
| `0x30` | 4 | u32 | DC Y | Section offset. |
| `0x34` | 4 | u32 | DC U | Section offset. |
| `0x38` | 4 | u32 | DC V | Section offset. |
| `0x3C` | 4 | u32 | DC-run Y | Section offset. |
| `0x40` | 4 | u32 | DC-run U | Section offset. |
| `0x44` | 4 | u32 | DC-run V | Section offset. |
| `0x48` | 4 | u32 | AOT scale Y | Section offset. |
| `0x4C` | 4 | u32 | AOT scale U | Section offset. |
| `0x50` | 4 | u32 | AOT scale V | Section offset. |
| `0x54` | 4 | u32 | Fix Y | Section offset. |
| `0x58` | 4 | u32 | Fix U | Section offset. |
| `0x5C` | 4 | u32 | Fix V | Section offset. |

## Coding

Bit sections read big-endian 32-bit words from the most significant bit.
Four shared Huffman trees occur at the start of the first section of their
group: basis counts, runs, DC, and scales. A `1` bit introduces an internal
node with recursively serialized left and right children; a `0` bit introduces
an eight-bit leaf. The run tree is shared by basis-count and DC runs. Fix
sections are byte arrays, not bitstreams.

Each plane is divided into 4×4 blocks. Y has `(width/4)×(height/4)` blocks;
U and V each have `(width/8)×(height/8)` blocks. A Y basis symbol gives its
block's mode. A UV basis symbol packs U in the low nibble and V in the high
nibble. A zero symbol reads a run value `r` and assigns zero mode to `r+1`
blocks. Mode 0 interpolates a smooth block from its DC and neighboring DCs;
modes 1–7 add that many adaptive orthogonal transform (AOT) vectors to DC;
mode 8 reads 16 raw samples from the plane's fix section.

DC values are stored as predicted deltas in the order Y/Y/U/V for each 8×8
MCU, followed by its second Y-block row. The first row predicts from the
left, each later row begins from the block above, and interior blocks predict
`(left+above)>>1`. A zero DC symbol reads a zero-run length; extreme symbols
`−128` and `127` chain further symbols until an interior symbol ends the
delta. Signed DC leaves are shifted left by the header's quantization step;
reconstructed DCs wrap to eight bits.

The AOT nest is built from the Y DC plane, mirrored once at each edge and
zero-filled beyond the mirrored region. Each vector consumes a Huffman-coded
scale leaf and a big-endian 16-bit fix word. The word supplies X/Y nest
coordinates, X/Y sample strides of one or two, and three fractional scale
bits in positions 13–15. The vector's 4×4 nest samples are mean-centered. With `m` the maximum
absolute centered sample, `bar = floor(4096/m) × (signedScale×8 + low3)`;
each sample adds `(sample×bar + 512)>>10` to its block. A zero `m` adds zero.

The decoder converts the resulting YUV 4:2:0 samples to RGBA5551 with the
alpha bit clear. The game's draw path ignores that alpha bit for opaque
backgrounds.

## Reference implementation

The C++17 source decodes an image to its YUV planes and RGBA5551 pixels. Its
encoder accepts the decoded syntax—DC planes, block modes, raw blocks, and
AOT vectors—and rebuilds the zero runs and Huffman trees. This preserves
decoded pixels exactly. It does not yet choose DC values, block modes, or
vectors from an arbitrary source bitmap; encoding a new picture needs those
rate-distortion decisions.

For the Japanese *Mario Party* ROM, all 4,875 background tiles and 55
instruction pictures decode successfully. Re-encoding all 4,930 and
decoding them independently reproduces every RGBA5551 pixel. The largest
single image stream is instruction picture `11/53`, 160×128: 11,012 retail
bytes and 10,994 reference bytes. Across all 4,930 streams, the reference
representation is 16,878 bytes smaller than the retail representation.

## Reference source

<<< ../../codecs/hvq2.cpp{cpp}
