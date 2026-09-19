# Vigilante 8 — Nintendo 64 ROM format specification

This manual describes the USA release of *Vigilante 8*. Statements marked
**Verified from ROM bytes** were checked against the named image; statements
marked **Verified by disassembly** were checked against its MIPS program.

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | Resident hierarchical 20-byte filename directory; 126 indexed files in seven groups, stored contiguously after the program and audio banks. |
| Compression | Game-specific 2 KiB-ring LZSS for 66 indexed files; raw JFIF JPEG for 50 files. |
| Graphics microcode | F3DEX FIFO 2.06, identified by its embedded RSP version string. |
| Geometry | IFF `FORM`/`TERR` terrain `.EXP` plus per-level MIPS `.DLL` behavior overlays. |
| Textures | Indexed terrain/sky bitmaps with RGBA5551 palettes; embedded and standalone JPEGs for previews and slides. |
| Collision | Runtime height surface: 32×32 `ZMAP` of 64×64-sample `ZONE` tiles, with 1-unit X/Z spacing, 1/32-unit height scale, and fixed diagonal interpolation. Object-shape collision remains unresolved. |
| Music driver | libmus-compatible version `0x215` sequencer; 15 indexed songs. |
| Audio microcode | **Unknown**. |
| Sample encoding | Nintendo 9-byte-frame VADPCM in two unindexed wave-table banks. |
| Levels | 11 indexed terrain `.EXP`/`.DLL` pairs. |
| Memory requirement | Base 4 MiB; boot initializes the stack at `0x803FFFF0`. |
| Viewer support | USA revision 0: eleven textured height-field arenas, panoramas, hidden terrain-collision layers, and fifteen music entries; OBJ/DLL-instantiated XOBF objects omitted. |

### 1.2 ROM identification

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| USA | `VIGILANTE 8` | `NV8E` | 0 | 8 MiB (`0x800000`) | `EA71056A` | `E4214847` | `22b7d7b4f1722efd52d3c8beba8cf5d07340569b` | CIC-6102 | **Unknown** |

Verified from ROM header bytes and a complete-image SHA-1. Other regional or
revised ROMs were not examined.

### 1.3 Terminology and conventions

ROM ranges are half-open. Multi-byte CPU fields are big-endian unless stated
otherwise. An `0xB0xxxxxx` directory address is a cart-domain pointer whose
low 24 bits are a physical offset in this ROM; an `0x801xxxxx` address is a
linked RDRAM address. An `.EXP` is an environment asset; a `.DLL` is a MIPS
behavior overlay. These suffixes do not imply Windows file formats.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

The header entrypoint is `0x80125800`. ROM `0x1000` maps to RDRAM `0x80125800`,
so direct resident-image addresses use `VRAM = ROM + 0x80124800`. Startup clears
the static BSS region beginning at `0x80199B60` and initializes the stack at
`0x803FFFF0` before entering the resident program. **Verified by disassembly.**

The boot block's `[0x40,0x1000)` MD5 is
`e24dd796b2fa16511521139d28c8356b`, matching the CIC-6102 IPL3
fingerprint in the [n64checksum boot-code catalog](https://github.com/Dragorn421/n64checksum/blob/main/README.md#different-checksum-types).

The resident image contains the filesystem directory at ROM `0x62830` and a
graphics microcode version string at `0x633D8`: `RSP Gfx ucode F3DEX fifo 2.06`.
Each terrain `.DLL` decompresses to a loadable MIPS overlay: the Sand Factory
overlay has an offset/dispatch table and MIPS function prologues beginning at
decoded offset `0x100`. Its relocation and call ABI remain **Unknown**.
**Verified from ROM bytes and disassembly.**

### 2.2 Memory and address mapping

| Purpose | ROM | VRAM | Evidence |
|---|---|---|---|
| Initial resident instructions | `0x1000` | `0x80125800` | ROM header and startup disassembly. |
| Embedded file directory | `0x62830` | `0x80187030` | Resident-image mapping and folder pointers. |
| LZSS token decoder | `0xDED0–0xDFCC` | `0x801326D0–0x801327CC` | MIPS disassembly. |
| F3DEX version marker | `0x633D8` | `0x80187BD8` | Embedded string. |

The directory's `0xB0xxxxxx` cart addresses do **not** use the resident-image
RDRAM conversion. Their low 24 bits locate stored files directly in this ROM.
Decoded `.EXP` offsets are relative to each decoded file, not ROM offsets.
**Verified from ROM bytes and all 126 indexed bounds.**

### 2.3 ROM map and asset organization

| ROM range | Stored size | Decoded size | Destination | Compression | Contents |
|---|---:|---:|---|---|---|
| `[0x000000,0x001000)` | `0x1000` | — | Boot | None | Header and IPL3. |
| `[0x001000,0x065360)` | `0x64360` | — | Resident/RSP/audio control | None | Program, both audio-control banks, directory, F3DEX task. |
| `[0x065360,0x110940)` | `0xAB5E0` | — | Audio | None | Music wave-table bank. |
| `[0x110940,0x2421B0)` | `0x131870` | — | Audio | None | Effects wave-table bank. |
| `[0x2421B0,0x7C3AD7)` | `0x581927` | Varies | Asset loader | Mixed | 126 indexed files, including alignment bytes. |
| `[0x7C3AD7,0x800000)` | `0x3C529` | — | — | — | `0xFF` fill. |

The directory begins at ROM `0x62830`. A group header has 20-byte stride:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 8 | char[8] | name | Space-padded group name. |
| `0x08` | 4 | u32 | next | Resident address following this group's children; zero for the final group. |
| `0x0C` | 4 | u32 | reserved | Zero in this image. |
| `0x10` | 4 | u32 | childCount | Number of immediately following file records. |

An indexed file record also has 20-byte stride:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 12 | char[12] | name | Space-padded filename, including extension. |
| `0x0C` | 4 | u32 | cartAddress | `0xB0xxxxxx` direct-cart pointer; low 24 bits give ROM offset. |
| `0x10` | 4 | u32 | storedSize | File bytes before four-byte alignment padding. |

| Group | Files | Contents |
|---|---:|---|
| Root | 11 | Shared data, quest/vehicle tables, eight `DEMO*.APD` recordings. |
| `TERRAIN` | 22 | Eleven `.DLL`/`.EXP` pairs. |
| `HUD` | 3 | HUD resources. |
| `SOUNDS` | 15 | Compressed music and sound data. |
| `SHELL` | 24 | Menus, fonts, tables, credits, images. |
| `MISC` | 3 | Fonts/filler. |
| `SLIDES` | 48 | Raw JFIF JPEG character/story slides. |

All 126 files are physically ordered with `nextStart = align4(start +
storedSize)`, with no unindexed gaps in the asset extent. Of these, 66 begin
`LZSS`; 50 are raw JFIF JPEG (the 48 slides plus `LEGAL.JPG` and `MAP.JPG`);
eight are raw `.APD` demos; two are raw credits data. **Verified from ROM
bytes.**

### 2.4 Compression formats

The 66 compressed indexed files use the shared [Vigilante LZSS](compression/vigilante-lzss.md)
reference codec, also used by *Vigilante 8: 2nd Offense*.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | char[4] | magic | ASCII `LZSS`. |
| `0x04` | 4 | u32le | decodedSize | Expected decoded byte count; little-endian exception. |
| `0x08` | Variable | u8[] | tokens | MSB-first flag groups and literal/match tokens. |

The 2 KiB history ring starts zero-filled with write index zero. A flag bit of
one emits the next literal; zero consumes a little-endian `u16` match token.
The match reads from absolute ring index `token >> 5` and emits
`(token & 31) + 2` bytes, wrapping at 2048 bytes. The retail decoder at ROM
`0xDED0–0xDFCC` implements this grammar. All 66 indexed streams produce their
advertised size and consume their full stored extent. **Verified by
disassembly and independent corpus decoding.**

### 2.5 Loading process

The resident and shell code refer to mixed-case paths whose uppercase
filenames occur in the directory; case-insensitive or normalized lookup is a
**Hypothesis** until the resolver is traced. Direct-cart addresses supply
the stored bytes, and the verified decoder expands `LZSS` resources before
their decoded formats can be parsed. Terrain directory entries pair behavior
`.DLL` and environment `.EXP` files. Exact load order, DMA strategy,
relocation contract, and streaming granularity remain **Unknown**; no full
runtime DMA trace was captured.

### 2.6 Revision differences

Only USA revision 0 was examined. Do not assume offsets or directory counts
apply to unexamined revisions. *Vigilante 8: 2nd Offense* has its own companion
specification; its LZSS token grammar is shared, but its maps are not the same
indexed files.

## 3. Level data

### 3.1 Level catalog and identifiers

The directory contains eleven terrain pairs. The `.EXP` `TITL` chunk supplies
the displayed name. **Verified from ROM bytes and decoded file bounds.**

| Directory stem | Level title | `.EXP` ROM start | Stored `.EXP` size | Decoded `.EXP` size |
|---|---|---:|---:|---:|
| `SANDFACT` | Sand Factory | `0x2CDF88` | `0x3DB17` | `0x7768E` |
| `CANYNLND` | Canyonlands | `0x30C778` | `0x53007` | `0x93630` |
| `CASNOCTY` | Casino City | `0x360B78` | `0x5B112` | `0xAD8E8` |
| `HOOVRDAM` | Hoover Dam | `0x3BCD34` | `0x4A9C2` | `0x8BFE6` |
| `OILFIELD` | Oil Fields | `0x408280` | `0x46641` | `0x78CC0` |
| `AIRGRAVE` | Aircraft Graveyard | `0x44FA60` | `0x4EEC4` | `0x83AF0` |
| `SCRTBASE` | Secret Base | `0x4A0898` | `0x53E6C` | `0x883E4` |
| `SKIRESRT` | Ski Resort | `0x4F5F48` | `0x582AC` | `0x84DAE` |
| `VALLYFRM` | Valley Farms | `0x54EE38` | `0x56B28` | `0x84F3E` |
| `WILDWEST` | Ghost Town | `0x5A6EF4` | `0x5AE7F` | `0x99B66` |
| `DREAMLND` | Super Dreamland 64 | `0x603EBC` | `0x424FE` | `0x6DAC2` |

### 3.2 Level container

Each `.EXP` expands to an IFF-style `FORM` whose type is `TERR`. The BE32
`formSize` equals the complete decoded length minus eight. Its children are
identified by four-character tags and BE32 lengths, with an extra pad byte
after odd-sized payloads. Nested `FORM` chunks contain object banks and object
records. **Verified across all eleven decoded environments.**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | char[4] | magic | `FORM`. |
| `0x04` | 4 | u32 | formSize | Bytes following this field. |
| `0x08` | 4 | char[4] | formType | `TERR`. |
| `0x0C` | Variable | chunk[] | children | Repeated chunks through decoded end. |

Each child chunk has this eight-byte prefix; `payloadSize` excludes padding:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | char[4] | tag | Four-character chunk ID. |
| `0x04` | 4 | u32 | payloadSize | Payload byte count. |
| `0x08` | `payloadSize` | u8[] | payload | Chunk-specific bytes. |
| Following | 0–1 | u8 | pad | One byte when payloadSize is odd. |

`TITL` and `TEXT` contain level names and setting text. `XLSC` embeds a
320×112 JFIF preview. Other observed top-level tags include `HEAD`, `XOBF`,
`SUNA`, `COLS`, `XBMP`, `TINF`, `ZONE`, `ZMAP`, `AIMP`, `RECT`, `XBGM`, `XRTP`,
`PLTX`, `JUNC`, `RSEG`, and `BSP`; per-level presence varies.

### 3.3 Geometry

Each environment has two nested `FORM`/`XOBF` model banks. Each bank's
`BIN ` payload begins with a 28-byte directory followed by fixed-stride
scene nodes and three indexed sections. Offsets in this table are from the
start of the `BIN ` payload; each section begins with `count + 1` BE32
offsets relative to that section's start. The scene nodes begin at `0x1C`,
and `modelSectionOffset = align8(0x1C + 28 × nodeCount)` in all 22 banks.
**Verified across all 22 banks.**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | u32 | modelCount | Number of model records. |
| `0x04` | 4 | u32 | modelSectionOffset | Offset to model-record index. |
| `0x08` | 4 | u32 | shapeCount | Number of bounds/shape records. |
| `0x0C` | 4 | u32 | shapeSectionOffset | Offset to shape-record index. |
| `0x10` | 4 | u32 | textureCount | Number of texture records. |
| `0x14` | 4 | u32 | textureSectionOffset | Offset to texture-record index. |
| `0x18` | 4 | u32 | nodeCount | Number of 28-byte scene nodes from `0x1C`. |

The same XOBF structure also occurs in `COMMON.EXP` (16 banks),
`VEHICLES.EXP` (14), and `ARMS.EXP` (13), making 65 indexed banks in total.
Their 2,364 model records comprise 2,003 terrain, 316 common, 32 vehicle,
and 13 weapon models. The model index points to records with this 24-byte prefix. The display-list
region begins at `displayListOffset` when nonzero; the vertex array begins
at `vertexDataOffset`. All 2,364 records across those 65 banks satisfy
`recordSize = vertexDataOffset + 16 × vertexCount` exactly; twelve are
zero-vertex placeholders. **Verified from all model index bounds.**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | u32 | vertexCount | Number of N64 `Vtx` records. |
| `0x04` | 4 | u32 | vertexDataOffset | Model-relative vertex-array start. |
| `0x08` | 4 | u32 | displayListOffset | Model-relative F3DEX2 command start; zero for no list. |
| `0x0C` | 8 | u8[8] | unknown_0C | Two metadata words not interpreted. |
| `0x14` | 1 | u8 | coordinateShift | Left shift applied to 24.8 node translation when emitting the 16.16 RSP matrix; normally 8. |
| `0x15` | 3 | u8[3] | unknown_15 | Remaining model metadata. |
| `vertexDataOffset` | `16 × vertexCount` | Vtx[] | vertices | Standard N64 signed XYZ, flag, ST, and RGBA fields. |

The terrain itself has `ZONE` chunks, each `0x4000` bytes. Each is a 64×64
array of packed BE32 samples in X-major order. The `0x800`-byte `ZMAP` is a
32×32 BE16 array of one-based zone IDs in Z-major, X-minor order; zero selects
the initialized default tile. Every map contains exactly the IDs `1…N`,
matching its N `ZONE` chunks (N is 4, 6, or 9). **Verified across all eleven
maps from ROM bytes; layout and axes verified by disassembly and live RAM.**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x800` | u16[32][32] | zoneIndexMap | BE16 one-based `ZONE` IDs indexed as `[zBlock][xBlock]`; zero selects the default tile. |

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x4000` | u32[64][64] | zoneSamples | BE32 packed samples indexed as `[localX][localZ]`. |

The loader removes a `0x200` stored-height bias and copies the upper five bits
of source byte 2 into the runtime height word. The renderer writes global X/Z
sample coordinates and the resulting eleven-bit height directly to N64
vertices, then submits a matrix with scale `(1, 1/32, 1)` and no translation.
An Oil Fields capture emitted `(956,1524,1212)` for stored sample
`07 F4 7C F5`: `0x7F4 - 0x200 = 1524`, and `0x7C >> 3 = 15` selected shade 15.
Above-ground XOBF structures extend into negative values on the second axis;
nviewer reflects that Y-down basis into Y-up. **Verified by resident-code
disassembly and live display-list, matrix, and RAM captures.**

### 3.4 Display lists and render state

Model records contain F3DEX2 display lists directly, using the embedded
F3DEX FIFO 2.06 task. Opcode `0x01` loads vertices from segment `0x01`,
relative to this model's 16-byte vertex array; `0x06` draws TRI2 pairs;
`0xDF` ends the list. `G_SETTIMG` addresses in segment `0x02` are relative
to the first texture record in the same XOBF bank (past the texture offset
table). For example, Sand Factory model 1 uses `0x02000008` for texture 0's
palette, `0x02000028` for its pixels, and `0x020008B8` for texture 2's
palette. **Verified by display-list disassembly and section offsets.**

Of 2,364 models, 2,118 begin their list at `0x18`, 215 have no list,
and 31 use later offsets. Terrain lists inherit `G_LIGHTING` from the arena
renderer and toggle it with `G_GEOMETRYMODE`; lit `Vtx` color bytes are signed
surface normals rather than authored RGB. The common textured combiner uses
`TEXEL0 × SHADE`. Resident routine `0x801377C4` constructs three directional
lights, but the exact `SUNA`/`COLS` mapping to those lights remains
**Unknown**. **Verified by display-list and resident-code disassembly.**

### 3.5 Textures and materials

The XOBF texture sections contain 2,103 indexed texture records across
the 65 terrain, common, vehicle, and weapon banks (1,402 terrain, 532 common,
143 vehicle, 26 weapon). Their record format is the common header/palette/pixel
layout below, with formats `0x0200` CI4 (1,790), `0x0201` CI8 (264),
`0x0002` RGBA16 (23), and `0x0003` RGBA32 (26). Every record satisfies
`align8(8 + 2 × paletteEntries) + height × align8(ceil(width × bpp / 8))`
bytes. **Verified from all record bounds; individual texture appearance has
not been exhaustively rendered.**

`XBMP` is the terrain CI8 atlas, 288 or 320 pixels wide and 128 high. It is a
9×4 or 10×4 array of 32×32 tiles. `TINF` contains 256 fixed 40-byte material
records. Runtime material construction selects the atlas tile from
`u/32 + atlasColumns × (v/32)`, selects one of eight exact UV permutations
from the low three bits at `+0x06`, and selects the terrain-cell diagonal from
bit 3. The renderer loads the selected 32×32 tile and uses S/T values −16 and
976, corresponding to texel centers −0.5 and 30.5. **Verified by disassembly,
all eleven decoded atlases, and a live Oil Fields runtime-material and display-list capture.**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | u16 | unknown_00 | Material flags not yet interpreted. |
| `0x02` | 2 | u16 | atlasU | Tile origin in pixels; multiple of 32. |
| `0x04` | 2 | u16 | atlasV | Tile origin in pixels; multiple of 32. |
| `0x06` | 2 | u16 | orientation | Low 3 bits select UV orientation; bit 3 selects the visual diagonal. |
| `0x08` | 32 | u8[32] | unknown_08 | Remaining material state. |

The four UV corners in this table correspond to vertices 0=`(x,z)`,
1=`(x+1,z)`, 2=`(x,z+1)`, and 3=`(x+1,z+1)`, in tile texel coordinates.

| Orientation | Vertex 0 | Vertex 1 | Vertex 2 | Vertex 3 |
|---:|---|---|---|---|
| 0 | `(0,31)` | `(31,31)` | `(0,0)` | `(31,0)` |
| 1 | `(31,31)` | `(0,31)` | `(31,0)` | `(0,0)` |
| 2 | `(0,0)` | `(0,31)` | `(31,0)` | `(31,31)` |
| 3 | `(0,31)` | `(0,0)` | `(31,31)` | `(31,0)` |
| 4 | `(31,0)` | `(0,0)` | `(31,31)` | `(0,31)` |
| 5 | `(0,0)` | `(31,0)` | `(0,31)` | `(31,31)` |
| 6 | `(31,31)` | `(31,0)` | `(0,31)` | `(0,0)` |
| 7 | `(31,0)` | `(31,31)` | `(0,0)` | `(0,31)` |

Diagonal zero emits `(0,1,2)` and `(3,2,1)`; diagonal one emits `(0,1,3)`
and `(3,2,0)`. `XBGM` is a 256×92 indexed panorama painted with sky and distant
structures; the Oil Fields panorama matches the refinery silhouettes and
bright horizon in a captured attract-demo frame. `XLSC` holds 320×112 JFIF
menu preview imagery. **Verified from decoded bytes, decoded image renders,
and an emulator frame for Oil Fields.**

All 256 palette entries in every one of the eleven `XBGM` images have their
RGBA5551 alpha bit clear. The game's dedicated backdrop pass nevertheless
draws the panorama opaquely; the bit is not transparency for this use.
**Verified from all panorama palettes and the captured Oil Fields frame.**

The `XBMP` payload starts directly with this eight-byte texture header;
`XBGM` has an additional signed 32-bit field before the same header. Its
meaning is **Unknown** (a vertical panorama offset is a hypothesis).
`paletteEntries` varies; the image data begins after the palette is padded
to an eight-byte boundary.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | s32 | unknown_00 | `XBGM`-only prefix before the texture header; values from −16 to +12 in the examined maps. |
| `0x04` | Variable | texture | bitmap | The common indexed-texture structure below. |

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | u16 | format | `0x0201` for the indexed bitmaps. |
| `0x02` | 2 | u16 | paletteEntries | Number of RGBA5551 palette colors. |
| `0x04` | 2 | u16 | width | Pixel width. |
| `0x06` | 2 | u16 | height | Pixel height. |
| `0x08` | `2 × paletteEntries` | u16[] | palette | Big-endian RGBA5551 colors. |
| Following | 0–7 | u8[] | pad | Eight-byte alignment after header and palette. |
| Following | `height × align8(ceil(width × bpp / 8))` | u8[] | pixels | Texture-format-specific pixels; each row padded to eight bytes. |

### 3.6 Collision

The runtime expands each active `ZONE` into a `0x3000`-byte buffer: 4096 BE16
values constructed from each source sample's biased height and shade index,
followed by 4096 material bytes copied from the source sample's low byte. A
live Oil Fields capture matched every resulting height/shade and material
value in all six active zones. The lower three bits of source byte 2 are not
retained in this runtime representation.
**Verified by ROM/RAM comparison and disassembly.**

| Source offset | Size | Type | Field | Runtime interpretation |
|---:|---:|---|---|---|
| `0x00` | 2 | u16 | biasedHeight | Subtract `0x200`; the low 11 bits become runtime height. |
| `0x02` | 1 | u8 | shadeAndFlags | Upper five bits become the runtime shade index; lower three bits are not retained. |
| `0x03` | 1 | u8 | material | Index into 24-byte runtime material records. |

For world coordinates `(X,Z)`, the game selects
`ZMAP[floor(Z/64)][floor(X/64)]`; the local sample is
`ZONE[X mod 64][Z mod 64]`. A sample is positioned at
`(X, ((biasedHeight - 0x200) & 0x07ff) / 32, Z)`. The terrain matrix independently
uses scale `(1, 1/32, 1)`. A zero ZMAP cell uses a default tile initialized to
height/metadata value `0x45ff` and material zero. **Verified by disassembly and
a live height-query breakpoint.**

Each grid cell is split along `xFraction + zFraction = 1`. The lower triangle
uses corners `(x,z)`, `(x+1,z)`, `(x,z+1)`; the upper triangle uses
`(x+1,z+1)`, `(x,z+1)`, `(x+1,z)`. The height-query routine performs linear
interpolation over those same triangles. **Verified by disassembly.**

The resident terrain initializer, height query, material query, and renderer
begin at `0x8013F520`, `0x8013F698`, `0x8013F884`, and `0x8013FDA8`,
respectively. The runtime pointer grid is based at `0x801A8F80`, with its
first terrain-cell pointer at `+0x80`.

The XOBF shape section has 823 indexed records in 22 banks. The scene-node
`shapeIndex` field references every shape record **exactly once** within its
bank: 823 distinct, in-range references, no duplicates or unused records.
This proves the section is associated with individual scene nodes, although
its physical-collision role remains a hypothesis. A record begins
with BE16 kind and BE16 flags/count. Most (724) are kind 1 with flags zero;
627 of these have 32-byte length fitting a six-signed-BE32 min/max XYZ box
plus a trailing word. Kind 2 commonly has length `8 + 12 × count` for
counts 4–11, consistent with a list of 3D points, but optional extra blocks
occur. Nine kind-zero records contain only the four-byte prefix. Their use
as physical collision bounds is **Hypothesis**; no full runtime collision
test has been observed.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | u16 | kind | Observed 0, 1, or 2. |
| `0x02` | 2 | u16 | flagsOrCount | Zero for common kind 1; count 4–11 in many kind-2 records. |
| `0x04` | Variable | u8[] | body | Kind-specific bounds/point data. |

The common 32-byte kind-1/flags-zero record has these fields. Sand Factory's
first shape spans `(-1724,-3568,-1962)` to `(1724,0,1962)`, consistent
with a local-space bounding box. Another node-associated shape's X bounds,
`−716816…+716951`, divided by 256 approximate its model vertices'
`−2800…+2800` X range. Signed 24.8 fixed-point is therefore a
**Hypothesis** for these shape bounds, not yet code-verified. **Verified from
decoded record and vertex bounds; use as physical collision bounds remains a
hypothesis.**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | u16 | kind | `1`. |
| `0x02` | 2 | u16 | flags | `0`. |
| `0x04` | 4 | s32 | minX | Lower X bound. |
| `0x08` | 4 | s32 | minY | Lower Y bound. |
| `0x0C` | 4 | s32 | minZ | Lower Z bound. |
| `0x10` | 4 | s32 | maxX | Upper X bound. |
| `0x14` | 4 | s32 | maxY | Upper Y bound. |
| `0x18` | 4 | s32 | maxZ | Upper Z bound. |
| `0x1C` | 4 | u32 | unknown_1C | Zero in this example; meaning unresolved. |

### 3.7 Environment, sky, fog, and lighting

The `XBGM` indexed image supplies an opaque painted backdrop with distant scenery;
Oil Fields' decoded image matches the refinery silhouettes and cloudy
sunset in an attract-demo frame. Every terrain has `SUNA` (`0x10` payload
bytes) and `COLS` (`0x1C` bytes). `COLS` contains seven four-byte entries
whose first three bytes are color-like RGB values; the fourth varies and
cannot generally be called alpha. The terrain initializer creates its
32-entry shade table by floor-interpolating RGB from `COLS` record 3 to
record 4, with output alpha forced to 255; source sample byte 2's upper five
bits select that table. Other `COLS` and `SUNA` mappings remain **Unknown**.
The first signed word of `XBGM`
varies from −16 to +12; vertical backdrop placement is a **Hypothesis**,
not a proven scroll rule. **Verified from decoded bytes and the Oil Fields
emulator frame, runtime shade table, and emitted terrain vertices.**

`COLS` has seven records of four bytes each. The first three bytes are
color-like channels; the fourth is an uninterpreted control byte.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 1 | u8 | componentA | Color-like first channel. |
| `0x01` | 1 | u8 | componentB | Color-like second channel. |
| `0x02` | 1 | u8 | componentC | Color-like third channel. |
| `0x03` | 1 | u8 | unknown_03 | Varies among records; not proven to be alpha. |

### 3.8 Cameras and paths

`JUNC` and `RSEG` chunks form route/junction records in most maps, but their
record fields and camera usage remain **Unknown**. The captured Oil Fields
attract demo uses a rear chase camera; no camera encoding was tied to these
records. **Verified from ROM tags and emulator frame; path semantics
unproved.**

## 4. Objects

### 4.1 Placement records

Nested `FORM`/`OBJ ` chunks after the terrain structures contain 2,436
object placements across the eleven environments. Each has one `HEAD`
child; 82 also have an `LGHT` child. The terrain-level fixed `HEAD` chunk
is 26 bytes; its payload `+0x08` BE16 equals that map's number of top-level
`OBJ ` forms (for example, 153 in Sand Factory). Other terrain-HEAD fields
are not yet interpreted. **Verified across all eleven maps.**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 8 | u8[8] | unknown_00 | Uninterpreted HEAD fields. |
| `0x08` | 2 | u16 | objectCount | Count of top-level `FORM`/`OBJ ` placements. |
| `0x0A` | 16 | u8[16] | unknown_0A | Uninterpreted HEAD fields. |

Each object `HEAD` payload is a 34-byte binary prefix followed by a printable
ASCII object-type name of length `payloadSize − 34`, with no NUL inside the
payload. Its position-like signed words at `+0x08/+0x0C/+0x10` have
plausible 16.16 fixed-point magnitudes, but world-coordinate interpretation
and axes are not yet code-verified. **Verified from all 2,436 record bounds;
position scale is a hypothesis.**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | u16 | kind | Observed 0, 4, 5, 6, 256, 260; all 82 `LGHT` objects are kind 6. |
| `0x02` | 2 | u16 | unknown_02 | Uninterpreted. |
| `0x04` | 2 | u16 | unknown_04 | Uninterpreted. |
| `0x06` | 2 | u16 | unknown_06 | Uninterpreted. |
| `0x08` | 4 | s32 | coordinateA | Position-like 16.16 candidate. |
| `0x0C` | 4 | s32 | coordinateB | Position-like 16.16 candidate. |
| `0x10` | 4 | s32 | coordinateC | Position-like 16.16 candidate. |
| `0x14` | 4 | u32 | unknown_14 | Uninterpreted. |
| `0x18` | 4 | u32 | unknown_18 | Uninterpreted. |
| `0x1C` | 4 | u32 | unknown_1C | Uninterpreted. |
| `0x20` | 2 | u16 | unknown_20 | Uninterpreted. |
| `0x22` | Variable | char[] | name | Remaining payload bytes, without terminator. |

`PlaceHolder` (308), `I_Cannon` (165), `PU_Shield` (164), and `Light`
(82) are among the observed names; 253 distinct names occur. Placement-to-
model binding, kind semantics beyond the `LGHT` association, and transform
fields remain **Unknown pending code/RAM validation**.

An XOBF bank can contain many independent scene-tree roots. These are model
archetypes, not implicit world placements: the generic object constructor at
`0x8013BCE8` calls the selected object's `.DLL` handler, obtains a root index,
and passes that index to the recursive XOBF constructor at `0x80137028`.
The second XOBF bank is byte-identical in all eleven arenas, independently
excluding its roots from arena-specific static placement. **Verified by
resident-code disassembly, per-bank graph structure, and all eleven decoded
environments.**

### 4.2 Object and model formats

Every terrain `.EXP` contains two XOBF banks, with model, shape, texture,
and scene-node sections described above. The 7,128 scene nodes across
eleven arenas have 28-byte stride. The graph links at `+0x18` and
`+0x1A` are next sibling and first child, respectively (`0xFFFF` means
none). Every first-child index is exactly its parent's index plus one
(1,396/1,396), all 5,525 sibling indexes point forward, and walking these
links partitions each bank into contiguous preorder trees without cycles or
cross-links. The low eleven bits of the word at `+0x00` select the model when
the signed word is nonnegative; negative records are disabled scene
alternatives. The `+0x02` word is either `0xFFFF` (6,305 nodes) or an
in-range shape index (823 nodes), with every shape referenced exactly once.
The runtime treats `modelAndFlags` as signed before constructing a node. A
negative word disables that node and its child subtree while traversal may
continue at its next sibling. Otherwise bits `0–10` select the model;
bit `0x0800` becomes a runtime flag whose later meaning is unresolved. The
runtime builds each local transform from three 12-bit-turn angles and signed
24.8 translations, then recursively composes `parent × local` for a first
child while retaining the parent transform for a sibling. The constructor at
`0x80137028` implements the signed gate and model mask, the transform builder
is at `0x8012FAA8`, and the local-matrix wrapper at `0x80137410` copies the
three translation words without scaling. Immediately before RSP-matrix
emission, `0x801310CC` shifts each translation left by the model descriptor's
`coordinateShift`; the descriptor constructor copies that value from model
record byte `+0x14`. It is 8 for 237 of Casino City's 238 models. Thus the
ordinary source translation is signed 24.8 and becomes 16.16 only at matrix
emission. The sole shift-9 Casino model has zero node translation. A live
Casino bank and its source nodes matched byte-for-byte in RAM. **Verified
from ROM bytes, disassembly, and RAM.** Object binding remains **Unknown**.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | u16 | modelAndFlags | Negative disables this node and child subtree; bits `0–10` are model index; bit `0x0800` maps to an unresolved runtime flag. |
| `0x02` | 2 | u16 | shapeIndex | Shape index or `0xFFFF`. |
| `0x04` | 4 | s32 | x | Signed 24.8 local X translation. |
| `0x08` | 4 | s32 | y | Signed 24.8 local Y translation. |
| `0x0C` | 4 | s32 | z | Signed 24.8 local Z translation. |
| `0x10` | 2 | u16 | angleA | Low 12 bits, one turn = 4096. |
| `0x12` | 2 | u16 | angleB | Low 12 bits, one turn = 4096. |
| `0x14` | 2 | u16 | angleC | Low 12 bits, one turn = 4096. |
| `0x16` | 2 | u16 | auxiliary | Runtime use not established. |
| `0x18` | 2 | u16 | nextSibling | Forward node index or `0xFFFF`. |
| `0x1A` | 2 | u16 | firstChild | Next record's index or `0xFFFF`. |

### 4.3 Skeletons and animation

No complete skeleton/animation record has been verified. Static models and
scene nodes can be decoded, but vehicle and moving-object animation are
**Unknown**.

### 4.4 Behaviors, triggers, and scripted objects

Terrain `.DLL` files are loadable MIPS overlays with named object routines.
For example, decoded `SANDFACT.DLL` contains `M2_elevator_1`,
`M2_Conveyor`, `factory_1`, and `factory_door` plus a function-offset table
and MIPS code from offset `0x100`. **Verified by ROM bytes and disassembly.**
The exact runtime ABI and trigger-record binding remain **Unknown**.

## 5. Audio

### 5.1 Audio storage and banks

Two unindexed control/wave-table pairs precede the named asset archive:

| ROM range | Role | Evidence |
|---|---|---|
| `[0x50A30,0x52FA0)` | `N64 PtrTablesV2` control bank 0. | Signature and record bounds. |
| Beginning `0x52FA0`; referenced through `0x5BA98` | `N64 PtrTablesV2` control bank 1; exact allocation end not established. | Signature and parsed record/book/loop bounds. |
| `[0x65360,0x110940)` | `N64 WaveTables ` sample bank 0. | Signature and frame alignment. |
| `[0x110940,0x2421B0)` | `N64 WaveTables ` sample bank 1. | Signature and frame alignment. |

The first control bank occupies `[0x50A30,0x52FA0)`; its last referenced byte
is at `0x52F9B`. The second bank's last parsed reference ends at `0x5BA98`,
well before the resident directory at `0x62830`; treating the entire span to
the next wave-table marker as a control bank would be wrong. The control-bank
headers report 51 and 198 waveform records, respectively.
The 15 indexed `SOUNDS` sequences reference only wave IDs `0–50`, proving
they use the first bank; the second bank contains sound effects. The control
header's `+0x20` field gives wave-record count, and `+0x2C` points to a
bank-relative table of BE32 record offsets. **Verified from ROM bytes.**

A wave record contains at least the following fields; other flags and pitch
fields are specified by the shared libmus player rather than fully reproduced
here. Relative pointers use the start of the control bank unless noted.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | u32 | sampleOffset | Offset from start of corresponding `N64 WaveTables ` bank, including its 16-byte header. |
| `0x04` | 4 | u32 | encodedBytes | ADPCM sample byte count. |
| `0x0C` | 4 | u32 | loopOffset | Control-bank-relative loop record; zero if absent. |
| `0x10` | 4 | u32 | bookOffset | Control-bank-relative predictor book. |

The predictor book begins with BE32 order and predictor count; in both banks
these are 2 and 4, followed by 64 signed BE16 coefficients. A loop record
holds BE32 start and end sample positions, BE32 repeat count (`0xFFFFFFFF`
for all 62 observed loops), then 16 signed BE16 decoder-state samples.
All 249 wave-record byte spans are in bounds and divisible by nine; 19 of
51 music samples and 43 of 198 effect samples have valid loop records.
**Verified from ROM bytes and parsed bounds.**

### 5.2 Sequence format and driver

All 15 `SOUNDS/*.BIN` files decompress to version `0x215` libmus-compatible
song files. The committed shared [libmus player](https://github.com/DSLL32/nviewer/blob/master/src/rom/music/libmus.ts)
accepts every sequence and the music bank without format changes. The
game-specific mixer settings are not yet verified against captured audio.
**Verified from ROM bytes and parser/render validation.**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | u32 | version | `0x215`. |
| `0x04` | 4 | u32 | channelCount | Number of parallel event channels. |
| `0x08` | 4 | u32 | waveMapCount | Number of song-local wave IDs. |
| `0x0C` | 4 | u32 | eventTableOffset | Offset to BE32 per-channel event-stream offsets. |
| `0x10` | 4 | u32 | volumeTableOffset | Offset to BE32 optional volume-stream offsets. |
| `0x14` | 4 | u32 | bendTableOffset | Offset to BE32 optional pitch-bend stream offsets. |
| `0x18` | 4 | u32 | envelopeTableOffset | Offset to envelope definitions. |
| `0x1C` | 4 | u32 | drumTableOffset | Offset to drum definitions. |
| `0x20` | 4 | u32 | waveMapOffset | Offset to BE16 bank-wave IDs. |
| `0x24` | 4 | u32 | masterTrackOffset | Offset to tempo/master event stream. |

Sequence opcode `0x95` opens a counted loop (`0xFF` means infinite), `0x96`
repeats it, and `0x80` ends a channel. The remaining event bytecode and
synthesis rules are implemented by the shared player. **Verified through
the song bytes and existing player implementation.**

### 5.3 Instruments and sample encoding

Sample data use Nintendo 9-byte, 4-bit VADPCM frames rather than PCM. All 249
wave records point to valid encoded spans; predictor books and loop decoder
states parse as above. The shared player synthesizes songs at 22,047 Hz, but
the game's exact output rate, master volume, and reverb mode have not been
measured against captured playback. **Verified from ROM bytes and player
format compatibility; game-specific mixer settings Unknown.**

### 5.4 Music catalog and loop points

The archive names, offsets, and loop classifications below are verified from
the complete `SOUNDS` directory and event-channel termini. `0x96` denotes a
loop repeat and `0x80` a finite end. The precise game-side call sites for
ending/logo songs are not fully traced.

| Song file | ROM start | Stored size | Decoded size | Channels | Loop behavior |
|---|---:|---:|---:|---:|---|
| `VIGWIN.BIN` | `0x66AF88` | `0x558` | `0xA29` | 12 | Finite. |
| `VIGLOSE.BIN` | `0x66B4E0` | `0x6BB` | `0xC2E` | 12 | Finite. |
| `COYWIN.BIN` | `0x66BB9C` | `0x4EB` | `0xB26` | 11 | Finite. |
| `COYLOSE.BIN` | `0x66C088` | `0x3AB` | `0x603` | 11 | Finite. |
| `ENDVIG.BIN` | `0x66C434` | `0xED6` | `0x280E` | 14 | 13 channels loop; one finite. |
| `ENDCOY.BIN` | `0x66D30C` | `0x100E` | `0x295D` | 15 | Finite. |
| `LOGO.BIN` | `0x66E31C` | `0x3F5` | `0x7C2` | 10 | Finite. |
| `TITLE2.BIN` | `0x66E714` | `0x1824` | `0x4EF7` | 12 | All channels loop. |
| `V8BAND.BIN` | `0x66FF38` | `0x1811` | `0x423C` | 12 | All channels loop. |
| `V8FUNK.BIN` | `0x67174C` | `0x1946` | `0x42F0` | 12 | All channels loop. |
| `V8SONG1A.BIN` | `0x673094` | `0x1763` | `0x339A` | 12 | All channels loop. |
| `V8SONG2.BIN` | `0x6747F8` | `0xE22` | `0x2421` | 13 | All channels loop. |
| `V8THEME.BIN` | `0x67561C` | `0x22BF` | `0x439D` | 13 | All channels loop. |
| `V8TOP.BIN` | `0x6778DC` | `0xD12` | `0x366B` | 10 | All channels loop. |
| `HAPPY.BIN` | `0x6785F0` | `0x13FB` | `0x2BC5` | 11 | All channels loop. |

The resident program names eight selectable music files at ROM
`0x2900–0x299F`: `happy`, `v8top`, `v8funk`, `v8band`, `v8song1a`,
`v8song2`, `v8theme`, and `title2`. That textual order has not been proved
to be the numeric selector order. All 15 songs generated nonzero PCM in the
shared libmus renderer with valid loop bounds; the validation used inherited
default mixer settings, not game-verified volume or reverb values.

## 6. Unused and hidden content

### 6.1 Unreferenced assets

The named directory contains no unmatched extra terrain `.EXP` beyond its
eleven `.DLL`/`.EXP` pairs. This does not rule out resources embedded inside
an indexed file. **Verified from the complete 126-file directory.**

### 6.2 Cut or inaccessible levels

Decoded `SHELL.DLL` contains twelve 20-byte location records at
`0x1153C–0x1162C`. Records 0–10 correspond to the eleven indexed terrains;
record 11 at `0x11618` is `Harbour Level`, pointing to
`Terrain\\V9Harbor.exp`. Its numeric ID 12 is also used by the Dreamland
record, so the number does not establish a twelfth loadable map. No
`V9HARBOR` file exists in the ROM directory.
The normal location-menu constructor fills its index list only while
`s1 < 11` (decoded shell MIPS at `0x4200`), then indexes these records. It
does not enumerate the Harbour record. This is a dormant *reference*, not
surviving level geometry or proof of a playable cut map. Other code paths
were not exhaustively excluded. **Verified from ROM bytes and disassembly.**

### 6.3 Debug features

The resident strings `CHEATS ENABLED` (`0x150B`) and `DEMO MODE`
(`0x1D2C`) accompany an ordinary shell `Passcode` option and eight indexed
`DEMO*.APD` recordings; these are game-facing features, not proof of a
developer menu. Exception diagnostics at ROM `0x1D99–0x1E4C` and source
filenames such as `synthesizer.c`, `reverb.c`, and `sched.c` near
`0x3034–0x3484` are compiled developer residue. Decoded `SHELL.DLL`
contains `Camera Orbit` and `Camera Dolly` at `0x11AFC` and `0x11B0C`,
but neither appears in the adjacent 14-entry controller-action pointer table
or in a scan for aligned direct pointers. These labels are possible dormant
actions, not confirmed selectable modes. A scan of readable ROM and all
decoded LZSS files found no `DEBUG`, `DEVMENU`, `TEST MAP`, or `TEST LEVEL`
label; this does not exclude button-gated or graphic-only debug code.
**Verified from ROM bytes and static pointer/code analysis; runtime access to
the residual strings remains Unknown.**

### 6.4 Prototype or revision-specific content

Twelve `Video\\*.str` FMV paths appear in shell character descriptors at
decoded `0x254–0x424`, but the ROM directory has no `VIDEO` group or `.STR`
files. They are unresolved dangling paths, not evidence of embedded N64
movie content. The resident `Sounds\\Main.SND` path likewise has no
same-named indexed file; it may identify a source container or another
unexamined resource, not proven unused audio. `Super Dreamland 64`,
`Secret Base`, and `Sand Factory` do
have matching indexed terrain assets; their unusual names do not make them
extra test areas. A `protoSaucer` object name occurs in both the Secret Base
overlay and its environment asset, so the name alone does not establish an
orphan object. **Verified from decoded bytes and the complete directory.**

## 7. nviewer implementation

### 7.1 Module mapping

The implementation is split between the embedded directory and LZSS reader
(`src/rom/vigilante8/fs.ts`), `FORM`/`TERR`, XOBF and F3DEX2 scene decoding
(`level.ts`), visible terrain decoding (`terrain.ts`), terrain collision (`collision.ts`), arena assembly
(`vigilante8.ts`), and a shared-libmus audio adapter (`music.ts`).

### 7.2 Supported features

The viewer accepts `NV8E` revision 0 and lists all eleven indexed arenas.
The loader renders the complete code-verified `ZMAP`/`ZONE` height surface
with its `XBMP` atlas, `TINF` material orientation and diagonal, and
`COLS`-derived vertex shading. The same source surface supplies a separate
hidden physical-collision layer. It displays the `XBGM` panorama opaquely
despite its clear palette alpha bits. The music box lists fifteen `SOUNDS`
sequences.

### 7.3 Approximations and omissions

The loader reflects terrain Y coordinates into the viewer's Y-up basis. The
starting camera and capped cylindrical sky projection are viewer
approximations. XOBF formats are understood, but the viewer does not decode
or draw a bank without a source placement: resolving each `OBJ ` name through
its level `.DLL` handler remains unimplemented. Thus buildings, props, dynamic
vehicles/projectiles, and object-shape collision are omitted rather than
shown piled at archetype pivots. `JUNC`/`RSEG` routes are also omitted. The
music player uses neutral dry mixer settings because game-specific volume
and reverb remain unmeasured.

## 8. Verification and remaining work

### 8.1 Verification evidence

| Check | Result |
|---|---|
| ROM identification | Header fields and complete-image SHA-1 recorded above. |
| Directory | 126 bounds-checked files; every successor begins at four-byte alignment after its predecessor. |
| LZSS | 66 indexed streams decoded to advertised sizes while consuming exact stored payloads. |
| Level containers | Eleven `FORM`/`TERR` roots; top-level lengths equal decoded sizes; HEAD object counts match every map's object forms. |
| Models/textures/nodes | 65 XOBF banks: 2,364 model records and 2,103 textures satisfy exact size formulas; the 22 terrain banks' 7,128 scene nodes satisfy graph-link constraints. Resident-code disassembly verifies the signed-node gate, 11-bit model index, 24.8 transforms, inherited lighting, signed-normal interpretation, and per-object root selection. |
| Terrain index, rendering and collision | Every `ZMAP` has exactly the IDs of its 4/6/9 `ZONE` chunks. Disassembly establishes axes, scale, physical sampling and triangulation; all six Oil Fields source zones matched their expanded live RAM buffers. A live render capture verifies emitted XYZ, the `(1,1/32,1)` matrix, XBMP atlas, all TINF UV orientations and diagonals, and the COLS shade table. Offline renders load all eleven terrain surfaces. |
| Image formats | Eleven terrain bitmaps and sky panoramas satisfy texture bounds; all 2,816 panorama palette entries have clear alpha bits, while the Oil Fields panorama appears opaque and matches a captured attract-demo backdrop. |
| Audio | Both banks' 249 wave records and all 15 song files parse; every song produced nonzero PCM and valid loop bounds in the shared player. |
| Hidden-level descriptor | Missing `V9HARBOR` asset established from full index; normal-menu bound proved by MIPS disassembly. |

### 8.2 Known unknowns

The source sample's low three bits at `+0x02`, XOBF shape-record collision rules,
overlay relocation ABI, remaining environment/fog controls, dynamic object bindings,
vehicle animation, game-specific audio mixer settings, audio microcode ID,
and runtime reachability of residual controller/debug strings remain open.
Other regional revisions have not been compared.

### 8.3 References

- USA release ROM identified by the SHA-1 above; all file-format observations
  and addresses are from that image.
- [n64checksum IPL3 fingerprint catalog](https://github.com/Dragorn421/n64checksum/blob/main/README.md#different-checksum-types)
  for CIC classification of the verified boot-code MD5.
