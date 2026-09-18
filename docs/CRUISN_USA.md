# Cruis'n USA — Nintendo 64 ROM format specification

This manual describes the Nintendo 64 releases of *Cruis'n USA*. Unless stated
otherwise, addresses and structures below are verified in the USA revision 0
image. All ROM and RAM ranges are half-open.

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | 12,518-entry indexed extent catalog and separate contiguous WESS audio regions. |
| Compression | Five indexed files use a byte-oriented RLE; the other 12,513 catalog entries are stored directly. [Cruis'n RLE](compression/cruisn-rle.md). |
| Graphics microcode | `RSP SW Version: 2.0D, 04-01-96` string; exact graphics family **Unknown**. |
| Geometry | Two-level per-course scene graph; 6,430 class-`0x10`/`0x20` meshes with 85,757 triangle records and 16,046 material batches. |
| Textures | 4,361 class-`0x40` textures: CI8 with RGBA5551 palettes and a small set of direct-16-bit images; one 680×108 RGBA5551 sky panorama. |
| Collision | **Unknown**; course-section and object-visibility records are present in RAM. |
| Music driver | Williams WESS v2, with `SN64` sound module and `SSEQ` sequences. |
| Audio microcode | **Unknown**. |
| Sample encoding | Nintendo 4-bit VADPCM; 190 waves. |
| Levels | Fourteen course roots, including Iowa; `Cruise the USA` is a multi-course mode, not a fifteenth map. |
| Memory requirement | **Unknown**. |
| Viewer support | Research complete for the catalog/scene graph/audio containers; course rendering and music playback are not implemented. |

### 1.2 ROM identification

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| USA 1.0 | `Cruis'n USA` | `NCUE` | 0 | 8 MiB (`0x800000`) | `FF2F2FB4` | `D161149A` | `aefe77a5518fe74519908b6cbc97cb81b8570897` | CIC-6102 | **Unknown** |
| USA 1.1 | `Cruis'n USA` | `NCUE` | 1 | 8 MiB (`0x800000`) | `5306CF45` | `CBC49250` | `71bb3d8850b6a4a294aeca2abad1f936e4f85f0f` | CIC-6102 | **Unknown** |
| USA 1.2 | `Cruis'n USA` | `NCUE` | 2 | 8 MiB (`0x800000`) | `B3402554` | `7340C004` | `54a875ee0b482036fa401a6bc2b242699f0259f7` | CIC-6102 | **Unknown** |
| Europe | `Cruis'n USA` | `NCUP` | 0 | 8 MiB (`0x800000`) | `503EA760` | `E1300E96` | `404ab549cd148ea07f40d66c0b896a343741bbf6` | CIC-6102 | **Unknown** |

Verified from each normalized `.z64` header and whole-image SHA-1. A ROM
header's revision byte is an identification field, not a guarantee that other
format offsets remain fixed. All four IPL3 byte ranges `[0x40,0x1000)` are
identical to the verified CIC-6102 image of *Off Road Challenge*; the emulator
also identifies USA 1.0 as CIC type X102.

### 1.3 Terminology and conventions

All offsets, addresses, sizes and IDs are hexadecimal unless explicitly
identified as decimal. Multi-byte CPU fields are big-endian. A catalog ID is a
zero-based index into the game's asset table; a course ID is `0..13`. A
`ROM-relative` pointer in the catalog is added to the catalog base, not to
zero. File-size formulas distinguish decoded length, consumed packed bytes,
and four-byte-aligned stored extent.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

The USA 1.0 header enters at `0x80100000`. The boot word at ROM `0x1000`
corresponds to that address. Resident instructions and their direct data
pointers establish the mapping `RAM = ROM + 0x800FF000` for this loaded image;
for example, the ROM `0x34D74` pointer `0x80133CAC` addresses the string at
ROM `0x34CAC`. The initial resident-image end is **Unknown**.

Verified by disassembly: four 24-byte records at ROM `0x332F0` describe
overlays. Code at RAM `0x80103264` indexes this table, DMAs the stated ROM
interval and clears the BSS interval. The names below are inferred from the
runtime monitor's overlay labels and code roles, not stored in these records.

| Index and likely role | ROM range | Initialized RAM range | BSS range |
|---|---|---|---|
| 0, Init | `[0x3D980,0x3E810)` | `[0x80025C80,0x80026B10)` | `[0x80026B10,0x80026B20)` |
| 1, Kernel | `[0x7F220,0x80590)` | `[0x80000480,0x800017F0)` | `[0x800017F0,0x8000AA50)` |
| 2, Obsys | `[0x3E810,0x5EB30)` | `[0x80025C80,0x80045FA0)` | `[0x80045FA0,0x80067960)` |
| 3, Race | `[0x5EB30,0x7F220)` | `[0x80025C80,0x80046370)` | `[0x80046370,0x800501E0)` |

The overlays at indices 0, 2 and 3 reuse RAM starting at `0x80025C80`;
their ROM contents must not be treated as simultaneously resident. The
catalog follows the Kernel overlay at ROM `0x80590`.

The overlay record has a 24-byte stride and no terminator; exactly four
records are used by the indexed loader.

<table class="byte-layout">
  <thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
  <tbody>
    <tr><th><code>0x00</code></th><td colspan="4"><code>romStart: u32</code></td><td colspan="4"><code>romEnd: u32</code></td></tr>
    <tr><th><code>0x08</code></th><td colspan="4"><code>ramStart: u32</code></td><td colspan="4"><code>ramLimit: u32</code></td></tr>
    <tr><th><code>0x10</code></th><td colspan="4"><code>bssStart: u32</code></td><td colspan="4"><code>bssEnd: u32</code></td></tr>
  </tbody>
</table>

| Field | Meaning |
|---|---|
| `romStart`, `romEnd` | Inclusive and exclusive cartridge addresses passed to the DMA routine. |
| `ramStart` | Address receiving the initialized overlay bytes. |
| `ramLimit` | Allocation end; equal to `bssEnd` in all four records. |
| `bssStart`, `bssEnd` | Interval cleared after loading. `bssStart = ramStart + (romEnd - romStart)` in all four records. |

### 2.2 Memory and address mapping

The fixed resident image uses `ROM + 0x800FF000`, whereas each overlay uses
the mapping in its table record. Catalog pointers use the catalog ROM base
`0x80590` in USA 1.0; they are neither KSEG0 addresses nor absolute ROM
offsets. The audio `SN64`/`SSEQ` directories use their own container-relative
offsets. Do not apply the resident mapping to asset or audio pointers.

### 2.3 ROM map and asset organization

The USA 1.0 asset catalog begins at `0x80590`: a `u32` entry count of
`0x30E6`, then 12,518 eight-byte records. Its end `0x98CC4` is exactly the
start of asset data. The indexed extents form a gapless, non-overlapping
partition of `[0x98CC4,0x5C41F4)` after accounting for record length and
alignment. The first entry's relative pointer is `0x018734`, giving
`0x80590 + 0x018734 = 0x98CC4`. Verified from ROM bytes and the Kernel
asset loader at RAM `0x80000480`.

| ROM range | Contents |
|---|---|
| `[0x000000,0x001000)` | N64 header and IPL3 |
| `[0x001000,0x080590)` | Resident program and four overlays; see the overlay table for overlay-specific ranges |
| `[0x080590,0x098CC4)` | Catalog header and 12,518 records |
| `[0x098CC4,0x5C41F4)` | Cataloged asset extents |
| `[0x5C4200,0x5D2D00)` | `SN64` sound module |
| `[0x5D2D00,0x72AE7A)` | WDD VADPCM wave bytes |
| `[0x72AE80,0x74E378)` | `SSEQ` directory and sequences |
| `[0x74E378,0x800000)` | Zero padding; no indexed data |

The catalog record's eight-byte stride and count come from the header.
`relativeOffset` is measured from the catalog base. Record index is the
numeric asset ID. Verified by disassembly of the Kernel loader at ROM
`0x7F290–0x7F308`, the record fields are:

<table class="byte-layout">
  <thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
  <tbody><tr><th><code>0x00</code></th><td><code>flags: u8</code></td><td><code>sizeHigh: u8</code></td><td colspan="2"><code>decodedLow: u16</code></td><td><code>dmaPagesLow: u8</code></td><td colspan="3"><code>relativeOffset: u24</code></td></tr></tbody>
</table>

| Field | Meaning |
|---|---|
| `flags` | Bit 7 means compressed; bits 6–4 select an allocator class of unestablished meaning. When bit 7 is set, low nibble selects RLE width (2/3/4 = 8/16/32 bits). Raw ID 741 also has low nibble 2; bit 7 takes precedence. |
| `sizeHigh`, `decodedLow` | `decodedBytes = ((sizeHigh & 0x0F) << 16) \| decodedLow`. |
| `sizeHigh`, `dmaPagesLow` | `dmaExtent = (((sizeHigh >> 4) << 8) \| dmaPagesLow) << 8`. This 256-byte-unit bound may exceed the actual stored extent. |
| `relativeOffset` | Unsigned 24-bit offset from catalog base to the first stored byte. The next file's offset defines the four-byte-aligned stored extent. |

Live DMA confirmed catalog ID `0x09B8`: its record at ROM `0x85354` is
`descriptor=0x00000014`, `pointer=0x01157E98`; the loader DMAs its 20-byte
root header from ROM `0x1D8428` to RAM `0x80293E40`. IDs `0x09B9` and
`0x09BA` load its child and placement lists from ROM `0x1D843C` and
`0x1D8544`. These agree with the static catalog calculation.

### 2.4 Compression formats

Five asset IDs (`702`, `703`, `704`, `740`, `742` in decimal) are byte-RLE
streams. They are palette-indexed user-interface glyph strips referenced by
asset ID `700`, with palette asset `701`; no course mesh uses them. All other
catalog entries are direct stored extents; the WESS
sequence directory reports compression flag zero for all 173 records.
The reusable [Cruis'n RLE reference](compression/cruisn-rle.md) specifies the
token grammar, header flags and encoder. The game also has Kernel code paths
for halfword and word RLE, but no indexed stream in the four located releases
uses those modes; their behavior is verified by disassembly but not by a
retail-stream round trip.

### 2.5 Loading process

The course initializer at RAM `0x80100340` indexes a 16-byte per-course
parameter record at ROM `0x33090`. Its first `u16` names a course-root asset
ID, beginning with `0x09B8` and increasing by three per course. The loader
fetches the catalog record, adds the catalog ROM base to its relative pointer,
DMAs the asset, and recursively loads child scene and placement records.
The root and its two immediate child DMAs have been observed during Golden
Gate Park gameplay; all 14 root graphs pass static bounds checks.

### 2.6 Revision differences

The four located release images all declare `0x30E6` catalog entries, but
the base moves: USA 1.0 `0x80590`, USA 1.1 `0x80470`, USA 1.2 `0x80480`,
Europe `0x805B0`. In each release the catalog ends where a gapless set of
asset extents begins. The five RLE IDs have identical decoded and optimized
encoded sizes across these images.

| Release | Catalog base | Asset-data range | `SN64` start | Last nonzero ROM byte |
|---|---:|---|---:|---:|
| USA 1.0 | `0x80590` | `[0x98CC4,0x5C41F4)` | `0x5C4200` | `0x74E377` |
| USA 1.1 | `0x80470` | `[0x98BA4,0x5C40D4)` | `0x5C40E0` | `0x74E257` |
| USA 1.2 | `0x80480` | `[0x98BB4,0x5C40D0)` | `0x5C40D0` | `0x74E247` |
| Europe | `0x805B0` | `[0x98CE4,0x5C4200)` | `0x5C4200` | `0x74E377` |

All bytes after each last nonzero byte are zero. Format portability beyond
these checks remains **Unknown**; code must locate each revision's catalog
rather than hard-code USA 1.0 offsets.

## 3. Level data

### 3.1 Level catalog and identifiers

Verified from the two resident course-name tables at ROM `0x34CA8` and
`0x34DB0`, the 14-root parameter table at ROM `0x33090`, and complete
catalog-referenced scene graphs. Iowa (course 9) has a full graph and is an
ordinary course. `Cruise the USA` names the route across those courses and
does not supply a fifteenth root.

| Course ID | Name | Root asset ID | Direct child scenes | Root placements |
|---:|---|---:|---:|---:|
| 0 | Golden Gate Park | `0x09B8` | 22 | 110 |
| 1 | San Francisco | `0x09BB` | 20 | 74 |
| 2 | US 101 | `0x09BE` | 12 | 51 |
| 3 | Redwood Forest | `0x09C1` | 22 | 219 |
| 4 | Beverly Hills | `0x09C4` | 37 | 166 |
| 5 | LA Freeway | `0x09C7` | 16 | 104 |
| 6 | Death Valley | `0x09CA` | 33 | 182 |
| 7 | Arizona | `0x09CD` | 30 | 219 |
| 8 | Grand Canyon | `0x09D0` | 70 | 203 |
| 9 | Iowa | `0x09D3` | 34 | 182 |
| 10 | Chicago | `0x09D6` | 61 | 161 |
| 11 | Indiana | `0x09D9` | 23 | 173 |
| 12 | Appalachia | `0x09DC` | 34 | 214 |
| 13 | Washington DC | `0x09DF` | 33 | 125 |

### 3.2 Level container

Each course root is a 20-byte catalog file. It names a child-list catalog ID
and a placement-list catalog ID, followed by their record counts. Each of the
14 file-size relationships holds exactly: child list `12 × childCount` bytes;
placement list `20 × placementCount` bytes. The scene graph has the root and
one nested level of scene nodes. All placement child indices are in range.
Catalog ID `0x09D3` (Iowa) has 34 nested scenes, 765 distinct leaf files,
and 174,348 distinct reachable asset bytes including its scene metadata.

<table class="byte-layout">
  <thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
  <tbody>
    <tr><th><code>0x00</code></th><td colspan="4"><code>childListID: u32</code></td><td colspan="4"><code>childCount: u32</code></td></tr>
    <tr><th><code>0x08</code></th><td colspan="4"><code>placementListID: u32</code></td><td colspan="4"><code>placementCount: u32</code></td></tr>
    <tr><th><code>0x10</code></th><td colspan="4"><code>reserved: u32</code></td><td colspan="4">—</td></tr>
  </tbody>
</table>

The 12-byte child-list record is:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `u32` | `assetID` | Referenced catalog entry. |
| `0x04` | 4 | `u32` | `flags` | Bit 0 distinguishes nested scene from leaf asset. |
| `0x08` | 4 | `u32` | `runtimePtr` | Runtime pointer/relocation slot; exact initial semantics **Unknown**. |

### 3.3 Geometry

All 6,430 catalog class-`0x10` and `0x20` files parse as mesh leaves (5,574
and 856 respectively). Verified from ROM
bytes: their declared arrays and batch counts consume each file exactly, with
zero extent mismatches. Together they contain 16,046 material batches and
85,757 six-byte triangle records. The runtime renderer's mesh parser is at
ROM `0x1D21C–0x1D4F8`. It reads two coordinate arrays and the material
batches; several mesh flags remain unresolved.

Each mesh begins with an eight-byte header, followed by
`positionMaxIndex+1` signed-16-bit XYZ triples and
`secondaryMaxIndex+1` signed-16-bit coordinate pairs. The second header word
is zero in all 6,430 catalog meshes; its runtime purpose is **Unknown**. Then
come material batches. The stored
`primitiveUnits` is the sum of `1 + triangleCount` over every batch, and the
last triangle ends at the file boundary.

The position array starts at `0x08`, not `0x04`. This is verified against a
live Golden Gate Park display list: all eight vertices of mesh `0x11C5`
(ROM `0x29DDEC`) match the game-generated `G_VTX` buffer at RAM
`0x8006F960` byte-for-byte, including the first vertex
`(-2304, 0, -2603)` and first ST pair `(0, 10240)`. All six source triangles
are nondegenerate. Treating `0x04–0x07` as vertex data instead produces
spurious degenerate triangles. [evidence: ROM bytes, live RAM/display list]

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 1 | `u8` | `positionMaxIndex` | Highest valid position index; array has one more element. |
| `0x01` | 1 | `u8` | `secondaryMaxIndex` | Highest valid secondary index; array has one more element. |
| `0x02` | 2 | `u16` | `primitiveUnits` | Sum of `1 + triangleCount` across all batches. |
| `0x04` | 4 | `u32` | `reserved` | Zero in all catalog meshes; runtime purpose unresolved. |
| `0x08` | `6 × (positionMaxIndex + 1)` | Array of `s16[3]` | `positions` | Stored XYZ coordinates, in native vertex-axis order. |
| After positions | `4 × (secondaryMaxIndex + 1)` | Array of `s16[2]` | `secondaryCoordinates` | Signed 10.5 ST pairs; course drawing applies a further half-scale to both components. |
| After coordinates | Variable | Batch array | `batches` | Ends at file boundary and when `primitiveUnits` are exhausted. |

Each batch has a six-byte header and `triangleCount` six-byte triangle
records. The 32-bit material ID references a texture asset when applicable.
Batch flag bit 0 selects a combiner that uses texture alpha; when clear, the
combiner uses primitive alpha and ignores transparent palette entries. ROM
code at `0x1D9A0` emits the two distinct `G_SETCOMBINE` commands. For
example, Appalachia texture `0x0CB4` has 20 transparent-black texels, but
mesh `0x0B9B` uses batch flag zero, so these render opaque black. Golden Gate
tree material `0x0EA2` uses flag 1 and texture-alpha cutout. [evidence: ROM
material flags, palette bytes, disassembly]

Batch flag bit 2 skips texture material loading. Material IDs `0xFF` and
`0xFFFFFFFF` are sentinels used only with that bit set. Texture-addressing
bits are described under Textures and materials; remaining flag bits need
classification.
The header alternates field order according to its two-byte alignment:

| Offset within batch | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` when 4-byte aligned, else `0x02` | 4 | `u32` | `materialAssetID` | Texture or sentinel material value. |
| `0x04` when 4-byte aligned, else `0x00` | 1 | `u8` | `triangleCount` | Number of following triangles. |
| `0x05` when 4-byte aligned, else `0x01` | 1 | `u8` | `flags` | Render/geometry bits, not fully assigned. |
| `0x06` | `6 × triangleCount` | Array of `u8[6]` | `triangles` | First three bytes select positions; last three select paired secondary coordinates. Each index is within the inclusive header limit. |

### 3.4 Display lists and render state

The mesh files are compact indexed data, not native display lists. Resident
code at ROM `0x1D21C–0x1D4F8` builds render commands from the material and
triangle batches at runtime. The ROM contains the string
`RSP SW Version: 2.0D, 04-01-96`, but that string alone does not identify the
game-specific command dialect or its complete render-state configuration.

A live model matrix loaded immediately before mesh `0x11C5` has diagonal
coefficients approximately `(0.20049, 0.199997, 0.20049, 1)` and translation
`(-114.4, -115.1, 248)`. This establishes local Y scale near `0.2`; the
slightly larger X/Z factors may include section-specific stretch. [evidence:
live RAM/display list]

The course-scene display list sets `G_TEXTURE` scale to `0x8000` for both ST
components (`BB000001 80008000` at captured DL `0x39F5A8`). Thus normalized
course-mesh UVs are stored ST divided by `64 × texture dimension`. Mesh
`0x0F0D` spans 112×72 stored texels over texture `0x0EA2` (56×36), yielding
one tile after that half-scale. The sky uses a separate render path.
[evidence: ROM mesh, live display list]

### 3.5 Textures and materials

All 4,361 class-`0x40` texture files have an eight-byte header. Pixel width
is four times byte 0; pixel height is byte 1. The product happens to equal
the incorrect `2 × byte0` by `2 × byte1` interpretation, so payload-size
validation alone cannot distinguish the layouts. Live RDP tile sizes confirm
the dimensions: asset `0x0EA2` has header `0E 24` and renders at 56×36;
asset `0x11DF` has header `10 20` and renders at 64×32. [evidence: ROM bytes,
live display list]
The 4,353 files with mode 1 and nonzero `paletteAssetID` have a CI8 pixel
payload of exactly `width × height` bytes. Seven files with mode 0 and a
zero palette ID have direct 16-bit payloads of exactly `2 × width × height`
bytes. One mode-1 file has palette ID zero; its intended palette source is
**Unknown**. These size rules hold across every class-`0x40` file in USA 1.0.

<table class="byte-layout">
  <thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
  <tbody><tr><th><code>0x00</code></th><td><code>quarterWidth: u8</code></td><td><code>height: u8</code></td><td colspan="2"><code>mode: u16</code></td><td colspan="4"><code>paletteAssetID: u32</code></td></tr></tbody>
</table>

The 508 class-`0x30` palette files start with `u32 marker=1` and
`u32 paletteCount`, followed by `paletteCount × 256` big-endian RGBA5551
entries. Their lengths are exactly `8 + 512 × paletteCount`, with one to six
palettes per file. Of 2,380 distinct course-batch material IDs, 2,378 resolve
to class-`0x40` texture files. The two exceptions `0xFF` and `0xFFFFFFFF`
occur only with batch flag `0x04` and are sentinel nontexture materials.
For example, mesh leaf `0x0D62` refers to texture
`0x0E35`, whose palette ID `0x0D9C` is a class-`0x30` palette. Palette
`0x0D9C` has transparent entry `0x0000` and opaque-red entry `0xF801`,
confirming RGBA5551. Material index and palette-selection rules within the
mesh remain under investigation.

The runtime tile builder defaults to clamping both axes. Material-batch flags
select the following addressing modes; a mirror bit takes precedence over the
repeat bit on its axis. [evidence: ROM code `0x1DAE0–0x1DD4C`, live RDP tiles]

| Flag bit | S axis | T axis |
|---:|---|---|
| `0x02` | Repeat | — |
| `0x08` | Mirror | — |
| `0x10` | — | Mirror |
| `0x20` | — | Repeat |

Live tiles for texture `0x0EA2` and tree textures `0x0EA4`/`0x0EA5` clamp;
texture `0x11DF` mirrors. These settings belong to the material draw, not
the texture asset: the same image may need more than one viewer texture object
when batches use different addressing. One captured `0x2C31` tile mirrors
although its catalog batch flags predict repeat; the override or draw path
remains **Unknown**.

The palette-file header is eight bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `u32` | `marker` | Always 1 in the tested corpus. |
| `0x04` | 4 | `u32` | `paletteCount` | Number of 256-entry palettes following the header. |

Catalog ID `0x0546` is a separate class-`0x00` panoramic RGBA5551 image:
146,880 bytes = 680 × 108 × 2. All texels have alpha bit set. The
course initializer loads it at ROM `0x2820–0x2850` and stores its RAM
pointer at `0x80146270`; the renderer at ROM `0x3B20` sets a 680-pixel
RGBA16 source (`G_SETTIMG` word `0xFD1002A7`) from that pointer. This
is the shared sky/background panorama, not a collision blob.

### 3.6 Collision

**Unknown.** No separate per-course collision file has been identified in the
catalog. The 44-byte runtime course-section records encode segment transforms
and lengths, not independently evidenced collision polygons. Object-instantiation
code indexes those records and checks visibility, but this does not establish
the road collision representation; it may derive from course meshes or another
resident structure.

### 3.7 Environment, sky, fog, and lighting

Emulator frames of Golden Gate Park show a cloud sky, tree-lined road and
roadside lighting props. The cloud image is the 680×108 RGBA5551 panorama
at catalog ID `0x0546`, verified by its dimensions, renderer source pointer,
and RDP image command. How its texture coordinates track camera yaw remains
**Unknown**. Fog and light parameters have not been identified in source data.

### 3.8 Cameras and paths

The course builder at ROM `0x179C–0x1A80` creates one 44-byte runtime section
record per root placement at RAM `0x801435F0`. The Golden Gate Park live table
has 110 records (`0x12E8` bytes). Each record contains ten big-endian `f32`
values followed by one `u32`; it gives the cumulative course transform before
that placement and its horizontal segment length. Rotation components at
`+0x00`, `+0x04`, `+0x0C`, `+0x10` form a planar sine/cosine matrix; components
at `+0x08`, `+0x14`, `+0x18` are transformed position; `+0x1C`, `+0x20` are
approximately `0.2` scale; `+0x24` was zero in sampled records. In live RAM,
all 110 final `u32` values at `+0x28` equal
`trunc(0.2 × hypot(placement.x, placement.z))`; Y does not contribute. This
table is generated from placement records rather than stored as a separate
course file. Obsys code at ROM `0x4A320–0x4A57C` consumes the transformed
coordinates and segment length to track progress along the driving path.
Race camera, checkpoints and any separate AI path spline remain **Unknown**.

The builder accumulates root-placement yaw in 16-bit binary turns and applies
each placement's X/Z displacement at scale `0.2`. Root child `i` is drawn
using section `i`'s transform before that placement advances the path. A
per-course grade table selected by the pointer array at ROM `0x32B5C`
supplies vertical adjustment. Reconstructed X/Z transforms match all 109
adjacent Golden Gate Park live records within 0.014 unit. [evidence:
disassembly, RAM comparison]

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `f32` | `cos` | Planar rotation component. |
| `0x04` | 4 | `f32` | `sin` | Planar rotation component. |
| `0x08` | 4 | `f32` | `position0` | First transformed position component. |
| `0x0C` | 4 | `f32` | `minusSin` | Planar rotation component. |
| `0x10` | 4 | `f32` | `cos2` | Planar rotation component. |
| `0x14` | 4 | `f32` | `position1` | Second transformed position component. |
| `0x18` | 4 | `f32` | `position2` | Third transformed position component. |
| `0x1C` | 4 | `f32` | `scale0` | Approximately `0.2` in the live table. |
| `0x20` | 4 | `f32` | `scale1` | Approximately `0.2` in the live table. |
| `0x24` | 4 | `f32` | `unknown` | Zero in sampled live records. |
| `0x28` | 4 | `u32` | `segmentLength` | Truncated scaled horizontal placement length. |

## 4. Objects

### 4.1 Placement records

Each scene's placement list consists of 20-byte records. Byte `+1` indexes
that scene's child list; all tested indices in the 14 course graphs are in
bounds. Verified by disassembly of the render loop at ROM `0x18250–0x1861C`:
bit 0 of `flags` skips the instance; bit 15 of `drawFlags` recomputes a
camera-facing yaw; bits `0x0700` alter render state. Other bits are not yet
assigned. Nested-scene XYZ use signed low 16 bits scaled by 0.2 into 16.16;
leaf XYZ are already signed 16.16 fixed-point. The renderer converts fixed
positions to float using `1/65536`. `yaw` is read unless `drawFlags` bit 15
selects the camera-facing value. Root-path yaw accumulates negatively in
16-bit binary turns, while leaf placement yaw composes positively with the
current path frame. The positive leaf sign makes adjacent curved-road mesh
edges meet within 0.02 source units in Golden Gate Park section 48; the
opposite sign leaves a roughly 640-unit gap. [evidence: ROM scene geometry,
live RAM root-section transform]

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 1 | `u8` | `flags` | Bit 0 skips the instance. Other bits unknown. |
| `0x01` | 1 | `u8` | `childIndex` | Index into this scene's 12-byte child list. |
| `0x02` | 2 | `u16` | `drawFlags` | Bit 15 selects camera-facing yaw; bits `0x0700` change render state. |
| `0x04` | 4 | `s32` | `x` | Nested-scene integer or leaf 16.16, depending on child kind. |
| `0x08` | 4 | `s32` | `y` | As above. |
| `0x0C` | 4 | `s32` | `z` | As above. |
| `0x10` | 4 | `u32` | `yaw` | Orientation; units unknown. |

### 4.2 Object and model formats

Obsys code traverses object-template lists and instantiates objects into
course sections. A section-visibility diagnostic is described under hidden
content; object model and behavior-record formats remain **Unknown**.

### 4.3 Skeletons and animation

**Unknown.** No skeleton or animation byte format has been verified.

### 4.4 Behaviors, triggers, and scripted objects

The game has a routine at Obsys ROM `0x5A930` that scans 44-byte section
records, tests visibility bits 1 and 2, and instantiates a selected object.
The full object/template grammar and course event routing remain **Unknown**.

## 5. Audio

### 5.1 Audio storage and banks

Verified from ROM bytes: Williams WESS v2 assets occupy the fixed region
starting at ROM `0x5C4200`. `SN64` module version 2 contains 190 patch
records, 190 patch maps, 190 wave records, 17 VADPCM loop records and 190
predictor-book slots. WDD sample bytes extend to `0x72AE7A`; 101 declared
wave sizes have one extra byte after an integral number of 9-byte VADPCM
frames, so only complete frames are decoded.

| ROM range | Contents |
|---|---|
| `[0x5C4200,0x5D2D00)` | `SN64` module and wave metadata |
| `[0x5D2D00,0x72AE7A)` | WDD encoded samples |
| `[0x72AE80,0x72B970)` | `SSEQ` header and 173 directory records |
| `[0x72B970,0x74E378)` | `SSEQ` sequence payloads |

### 5.2 Sequence format and driver

The `SSEQ` version-2 directory has 173 16-byte records, all with compression
flag zero. IDs 0–158 are version-0 sound-effect class; IDs 159–172 are 14
version-1 music-class sequences. The maximum referenced sequence end is
exactly `0x74E378`. Each sequence has 20-byte track headers, optional label
offsets and timed WESS events. Opcode `0x20` jumps to a track label for an
authored loop; `0x22` ends a one-shot track. Music uses 192 pulses per quarter
note and song-specific QPM values.

The directory record's 16-byte stride is:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | `u16` | `trackCount` | Number of tracks in the sequence. |
| `0x02` | 2 | `u16` | `compression` | Zero in all 173 records. |
| `0x04` | 4 | `u32` | `storedBytes` | Sequence payload length. |
| `0x08` | 4 | `u32` | `payloadOffset` | Relative to payload base `0x72B970`. |
| `0x0C` | 4 | `u32` | `reserved` | Zero. |

### 5.3 Instruments and sample encoding

All 190 waves are Nintendo 4-bit VADPCM type 0, with order-2 predictor
books; 166 use eight predictors and 24 use four. Seventeen samples have
declared infinite ADPCM loop states; 173 have no loop. The game requests
22,050 Hz output in Init code at ROM `0x3E670` and `0x3E6C8`.
Verified against live emulator hardware state: AI DACRATE `0x089F` gives
approximately 22,048 Hz at the NTSC clock.

### 5.4 Music catalog and loop points

The Obsys radio table at ROM `0x5B478` has eight `(titlePointer, sequenceID)`
pairs but only seven distinct songs because HOUSE SPECIAL appears twice.
Titles are the exact on-ROM spellings.

| Radio slot | On-ROM title | SSEQ ID | QPM | Authored loop (ticks) |
|---:|---|---:|---:|---|
| 0 | SURFARI MONSTER | 167 | 150 | `13056–25343` on 15/16 tracks |
| 1 | REDLINE SHUFFLE | 169 | 202 | `768–19192` |
| 2 | HOUSE SPECIAL | 163 | 154 | `0–45304` |
| 3 | DEADWOOD RIDE | 171 | 135 | `3840–39160` on 15/16 tracks |
| 4 | TUBULAR SURF | 170 | 172 | `12288–23800` on 12/13 tracks |
| 5 | ROADKILL JAM | 168 | 150 | `11520–22271` on 14/15 tracks |
| 6 | HOUSE SPECIAL | 163 | 154 | `0–45304` |
| 7 | BLUEGRASS BOOGIE | 161 | 224 | `0–30712` |

The remaining version-1 IDs are 159, 160, 162, 164, 165, 166 and 172;
they are not given invented menu/cutscene titles. Sequence 167 track 2 has
`TrkJump 0` but no declared labels; the other 15 tracks have the loop shown
above. Its runtime resolution remains **Unknown**.

## 6. Unused and hidden content

### 6.1 Unreferenced assets

All 397 structurally valid 20-byte scene records in the USA 1.0 catalog are
reachable from the 14 course roots. There is no orphan scene hierarchy.
Of 6,430 mesh assets, 4,796 appear as course leaves (1,036,478 bytes);
1,634 do not (410,036 bytes). Those may be vehicles, user-interface art,
or other ordinary object content: non-membership in a course graph is not
proof of being unused. The 22 class-`0x00` assets outside scene-graph
records include 21 short ID/metadata lists and the shared sky panorama
`0x0546`; none is an evident separate cut-course root. No unreferenced map
is confirmed.

### 6.2 Cut or inaccessible levels

No cut course is established. Iowa is course index 9 in both the name tables
and the 14-root course table; it has 34 nested scenes and 182 direct root
placements. `Cruise the USA` is an aggregate route label, not a standalone
course asset.

### 6.3 Debug features

The resident image retains the **Ranck Runtime Monitor**: welcome text at
ROM `0x3C6C0`, MIPS fault/register/overlay strings at `0x3C454–0x3C9B4`,
and an implemented render/input loop at ROM `0x5800–0x5984`. Disassembly
shows a Start-button test that cycles three monitor views and a memory-address
dump/navigation routine at `0x59B8`. The entry trigger is **Unknown**; this
is verified diagnostic code, **not** a confirmed accessible retail menu.

`RK SECT %i NOT VISIBLE` at Obsys ROM `0x5EA90` is used by an object
section-visibility warning path at ROM `0x5A930`/`0x5AACC`. The `RK`
abbreviation's expansion is **Unknown**. The string and helper do not prove
that deer, cow or other roadkill content survives in this ROM. WESS error,
DMA, viewport and heap diagnostics also remain in the executable.

### 6.4 Prototype or revision-specific content

The later USA revisions retain the monitor welcome, WESS error and `RK SECT`
strings. This is only a string-presence comparison; reachability or behavior
differences have not been verified. No prototype-only course is claimed.

## 7. nviewer implementation

### 7.1 Module mapping

`src/rom/cruisnusa/catalog.ts` indexes assets and decodes RLE;
`scene.ts` parses course graphs; `assets.ts` decodes meshes and textures;
`cruisnusa.ts` assembles course instances, paths and layers; `sky.ts` supplies
the panorama; `music.ts` renders WESS sequences. The viewer currently accepts
USA V1.0 only. Catalog IDs, not absolute payload offsets, are the stable
cross-reference in the course graph.

### 7.2 Supported features

The viewer lists all 14 courses and their section-path markers. It renders
course meshes, per-material CI8/RGBA5551 and direct RGBA5551 textures,
the cloud panorama, and a music player for the 14 indexed WESS sequences.
Course meshes use the native eight-byte header and material-specific texture
addressing and alpha selection. Focused level/layer checks covered all 14
courses before the final alpha-selection change; that last change was not
retested at the user's request.

### 7.3 Approximations and omissions

There is no collision layer: the polygon collision representation remains
unknown. Traffic/vehicle objects, original camera behavior, fog and lighting
are not reproduced. The starting camera is viewer framing, not the game's
chase camera. Palette selection beyond bank zero and one captured material's
runtime texture-addressing override remain unresolved. The music renderer
handles NoteOff and patch-release timing, but precise mixing/modulation and
sequence 167's anomalous jump need further comparison against game audio.

## 8. Verification and remaining work

### 8.1 Verification evidence

- Verified from normalized ROM bytes: all four identification rows; overlay
  records; 12,518-entry catalog; exact asset partition; all 14 course graphs;
  6,430 mesh records; 4,361 texture records; 508 palette records; five RLE
  streams; audio container sizes and sequence/song tables.
- Verified by disassembly: resident/overlay address mappings; overlay loader;
  RLE decoder dispatch; course-root loading; WESS output-rate request; Ranck
  Runtime Monitor and `RK SECT` warning paths.
- Verified against emulator RAM and frames: Golden Gate Park root and two
  subordinate DMA ranges; 110 live section records compared with all 110
  placements; AI DACRATE `0x089F`; live road/sky/traffic view.
- Verified with an independent codec round trip: five RLE streams decode to
  their declared sizes. An exact shortest-path encoder matches all five
  retail consumed byte counts, three byte-identically. No smaller legal
  encoding exists under the verified byte-RLE grammar.

### 8.2 Known unknowns

Section-specific X/Z stretch and several render-state flags, palette
selection beyond bank zero, collision, sky panorama camera mapping,
fog/light parameters, traffic transforms, any AI path and camera structures
remain to be established.
The monitor entry path, `RK`
expansion, unreferenced asset meaning, precise music mix and the anomalous
sequence-167 branch are also unresolved. These are not claimed as verified.

### 8.3 References

The only external format relationship used here is the repository's existing
[Off Road Challenge specification](OFFROADCHALLENGE.md) for the related WESS
container family. All game-specific addresses and claims above derive from
the identified ROM images, their disassembly, or a live emulator run.
