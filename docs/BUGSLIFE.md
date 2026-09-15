# A Bug's Life — Nintendo 64 ROM format specification

This manual describes the shipped data formats needed to identify, extract, and
present A Bug's Life content. Claims state their evidence inline; unsupported
interpretations are labelled hypotheses.

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | A 488-entry path manifest indexes 488 packed and raw files. |
| Compression | RNC method 1 and method 2. |
| Graphics microcode | F3DLX 1.23 for the sampled live level renderer. |
| Geometry | Custom CPU-decoded mesh streams in `level.dat`. |
| Textures | Custom `.tpg` pages plus CI8 parallax strips and environment maps. |
| Collision | `terrain.all` triangle meshes. |
| Music driver | Nintendo Sound Tools libmus. |
| Audio microcode | Nintendo ABI1. |
| Sample encoding | Nintendo VADPCM. |
| Levels | 17 complete 3-D packages. |
| Memory requirement | Base 4 MiB. |
| Viewer support | Five retail regional releases. |

### 1.2 ROM identification

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| USA | `A Bug's Life` | `NBYE` | 0 | 12 MiB (`0xC00000`) | `82DC04FD` | `CF2D82F4` | `697c1e895fc840826fcb6a6f37411a2af6d6f47c` | CIC-6102 | — |
| Europe | `A Bug's Life` | `NBYP` | 0 | 12 MiB (`0xC00000`) | `8F12C096` | `45DC17E1` | `2922c2281faa4106295830c617289292df4c377a` | CIC-6102 | — |
| France | `A Bug's Life` | `NBYF` | 0 | 12 MiB (`0xC00000`) | `2B38AEC0` | `6350B810` | `4970ecc65e8de25990a241b0d2ffbe274cb1619a` | CIC-6102 | — |
| Germany | `A Bug's Life` | `NBYD` | 0 | 12 MiB (`0xC00000`) | `DFF227D9` | `0D4D8169` | `daa7114a8d16c3e636b2808d4f256e07954f05dd` | CIC-6102 | — |
| Italy | `A Bug's Life` | `NBYI` | 0 | 12 MiB (`0xC00000`) | `F63B89CE` | `4582D57D` | `46f9c5d7eb822b19be6910b992949def27e46887` | CIC-6102 | — |

Verified from the normalized ROM headers and complete-image SHA-1 hashes.

### 1.3 Terminology and conventions

ROM and memory ranges are half-open. Offsets, addresses, encoded sizes, masks,
and opcodes are hexadecimal unless stated otherwise. Multi-byte CPU fields are
big-endian. RAM addresses are virtual unless explicitly identified as physical;
segmented, VROM, and file-relative addresses are named at each use.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

#### Boot and resident code

[evidence: ROM bytes, disassembly] IPL3 copies ROM `0x1000` to `0x80006000`. Within the
resident image, the static relation is therefore:

```text
virtual address = ROM offset + 0x80005000
```

Startup clears BSS `[0x8009DD40, 0x801FCE20)` and calls `0x8000805C`.
Linked RSP identifiers include F3DEX 1.23 at ROM `0x86970` and F3DLX 1.23 at
`0x87170`; live Training uses the latter. Retained source/debug strings include
`sched.c`, `synthesizer.c`, `save.c`, `env.c`, and `reverb.c`.

### 2.2 Memory and address mapping

### 2.3 ROM map and asset organization

### 2.4 Compression formats

#### Manifest

[evidence: ROM bytes, deterministic decoding] The US manifest occupies `0xA89A0..0xABEC0`. Its 488
variable-size records are:

| Order | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 1 | variable | NUL-terminated ASCII | `path` | Windows path. |
| 2 | 0–3 | — | `padding` | Advances through the next four-byte boundary. |
| 3 | 4 | `u32` | `storedSize` | Stored payload size. |
| 4 | 4 | `u32` | `auxiliary` | Always zero in all five builds. |

If `string_end` points at the NUL, the size fields start at
`(string_end + 4) & ~3`. A four-byte empty-name record terminates the table.
Payloads begin at `0xABEC0`, follow manifest order, and each next file begins
on an eight-byte boundary. The final aligned archive end is `0x8D17D0`.

[evidence: disassembly] `0x8005D834` loads a `0x4000`-byte manifest window, compares paths
case-insensitively while normalizing separators, walks records, and accumulates
stored sizes rounded to eight. `0x8005DA54` is the PI-DMA wrapper and chunks
transfers at 4096 bytes.

#### Compression

[evidence: ROM bytes, disassembly, deterministic decoding] `0x8005D560` checks `RNC` and the method byte, reads
the unpacked size from header `+4`, and dispatches:

| Codec | Count | Decoder |
|---|---:|---:|
| RNC method 1 | 463 | `0x80018440` |
| RNC method 2 | 20 | `0x80017000` |
| raw | 5 | none |

The 20 RNC2 files are `level15/end00..04.tpg` and all fifteen
`charpage/*.tpg` pages. The five raw files are `level03/light.tpg`,
`backdrop/disint.pic`, `fonts/tahoma08.fnt`, `level98/font.bin`, and
`level98/blank.pic`. For every RNC file, the 18-byte header plus its encoded
payload length equals the manifest's stored size.

The archive needs no external allocation or checksum table: manifest, aligned
payload sequence, and RNC headers are sufficient.

#### Regional locations

[evidence: deterministic decoding]

| Build | Manifest | Data base | Indexed end | RNC1 / RNC2 / raw |
|---|---:|---:|---:|---:|
| U | `A89A0` | `ABEC0` | `8D17D0` | 463 / 20 / 5 |
| E | `A9600` | `ACB20` | `8C4538` | 460 / 20 / 8 |
| F | `AA460` | `AD980` | `8DAA70` | 459 / 18 / 11 |
| G | `A9D60` | `AD280` | `8DAC00` | 457 / 20 / 11 |
| I | `A9B60` | `AD080` | `8E4C20` | 456 / 20 / 12 |

Compression choice varies by build; decompressed content is the stable API.

### 2.5 Loading process

### 2.6 Revision differences

## 3. Level data

### 3.1 Level catalog and identifiers

#### Complete selectable list

[evidence: ROM bytes, disassembly] Sixteen user-facing progression slots map through the BE
`u32` table at ROM `0x80EC0`, terminated by `FFFFFFFF`. Bonus is a deliberate
special case: `0x80023218..0x80023220` selects internal ID 16 directly.

| UI order | Display name | Internal ID | Package |
|---:|---|---:|---|
| 0 | Training | 17 | `level17` |
| 1 | Ant Island | 1 | `level01` |
| 2 | Tunnels | 3 | `level03` |
| 3 | Council Chamber | 2 | `level02` |
| 4 | Cliffside | 6 | `level06` |
| 5 | Riverbed Canyon | 10 | `level10` |
| 6 | Birdnest | 11 | `level11` |
| 7 | City Entrance | 4 | `level04` |
| 8 | City Square | 5 | `level05` |
| 9 | Bug Bar | 14 | `level14` |
| 10 | Clover Forest | 7 | `level07` |
| 11 | The Tree | 12 | `level12` |
| 12 | Battle Arena | 13 | `level13` |
| 13 | Anthill, Part Two | 9 | `level09` |
| 14 | Riverbed Flight | 8 | `level08` |
| 15 | Canyon Showdown | 15 | `level15` |
| special | Bonus | 16 | `level16` |

The scan/map routine is `0x8001413C..0x800141B8`. Challenge objectives reuse
the one package for their stage; no alternate 3-D setup file exists.

#### Per-stage principal files

[evidence: ROM bytes, deterministic decoding] Each package 01–17 has exactly one `level.dat`, one
`terrain.all`, one `creat/creatNN.bin`, and one `envmaps/levelNN.tpg`.

| ID | Name | `level.dat` ROM / decoded | `terrain.all` ROM / decoded |
|---:|---|---|---|
| 1 | Ant Island | `106758..12A091` / `3C27C` | `12A098..154FA8` / `39D8C` |
| 2 | Council Chamber | `16C490..1778F7` / `12B48` | `1778F8..184D02` / `13F28` |
| 3 | Tunnels | `18F1A8..1B1C64` / `3A85C` | `1B1C68..1DD861` / `41850` |
| 4 | City Entrance | `1ED1B8..212E93` / `491A4` | `212E98..233BC2` / `3131C` |
| 5 | City Square | `2462C0..268F04` / `43DAC` | `268F08..285E00` / `2E5C0` |
| 6 | Cliffside | `2950B8..2A604A` / `2221C` | `2A6050..2C668D` / `2B924` |
| 7 | Clover Forest | `2D3EB8..2F14D0` / `3B3F4` | `2F14D0..307B9D` / `1F0D8` |
| 8 | Riverbed Flight | `318B90..334D34` / `374F4` | `334D38..3568BF` / `31784` |
| 9 | Anthill, Part Two | `36A7F8..38AC5D` / `381F4` | `38AC60..3AFE68` / `32AB4` |
| 10 | Riverbed Canyon | `3B5AD8..3DC257` / `43ADC` | `3DC258..3F2CE1` / `22C08` |
| 11 | Birdnest | `405F00..40D7E9` / `FB94` | `40D7F0..417C94` / `F078` |
| 12 | The Tree | `424AB8..44B4FD` / `493B4` | `44B500..47384C` / `35B84` |
| 13 | Battle Arena | `487CB8..49C157` / `228EC` | `49C158..4A0A77` / `618C` |
| 14 | Bug Bar | `4B5C30..4BC4CF` / `C414` | `4BC4D0..4BD68B` / `42C0` |
| 15 | Canyon Showdown | `4C1A00..4E457F` / `448F4` | `4E4580..505A26` / `3056C` |
| 16 | Bonus | `52B7E0..533A72` / `D8A8` | `533A78..543730` / `166D4` |
| 17 | Training | `54BD90..557F70` / `17C78` | `557F70..5610E7` / `C584` |

#### Non-gameplay namespaces

[evidence: ROM bytes] The only `level` roots are 00–17 and 96–99. There is no content
under 18–95.

- `level00`: front-end/menu dataset; it has `level.dat` but no `terrain.all`.
- `level96`: challenge/story/result images, including 44 generated story
  panels and the questionable `lose.pic`.
- `level97`: title bitmap.
- `level98`: save/options/controller assets and font.
- `level99`: fourteen UI sprite bitmaps.

These are presentation packages, not hidden 3-D stages.

### 3.2 Level container

#### `level.dat` envelope and placements

[evidence: disassembly, deterministic decoding] The initial-table region is:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | s32 | initialTableCount | Number of initial tables. |
| 0x04 | Variable | table[] | initialTables | Sequential variable-size tables. |

Each initial table starts with this four-byte header:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | s16 | n | Element count. |
| 0x02 | 2 | s16 | type | Selects the table length formula. |

Its byte length is:

```text
type < 0   : ((3*n + 1) // 2) * 4 + 16
type == 63 : n * 16 + 4
otherwise  : n * 12 + 4
```

The remaining envelope is sequential. Pointers are relative to the file;
variable regions have no fixed offset.

| Order | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 1 | 4 | u32 | optionalPointer | Optional relative pointer after the initial tables. |
| 2 | Variable | placement[] | firstPlacements | 20-byte records including the terminator. |
| 3 | 4 | s32 | pointerCount | −1 means no pointers; otherwise count plus one. |
| 4 | 4 × (pointerCount + 1), or 0 | u32[] | pointers | Relative pointers; absent when count is −1. |
| 5 | Variable | placement[] | secondPlacements | Stops at its terminator or the first model payload. |

Both placement lists use this 20-byte record; a negative signed halfword at
`+0x0E` terminates the list:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `+00` | 4 | `s32` | `x` | — |
| `+04` | 4 | `s32` | `y` | — |
| `+08` | 4 | `s32` | `z` | — |
| `+0C` | 2 | `s16` | `field0 / flags` | — |
| `+0E` | 2 | `s16` | `field1 / terminator test` | — |
| `+10` | 4 | `u32` | `relativeModel` | — |

The model header has these known fields. The loader relocates its model
pointer and builds the runtime fixed-point 3×3 transform. Translation belongs
to the model; placement XYZ is the culling centre.

| Normal offset | Flag 0x8 offset | Size | Type | Field |
|---:|---:|---:|---|---|
| 0x00 | 0x00 | 12 | s32[3] | Translation X, Y, Z. |
| 0x0C | 0x0C | 6 | s16[3] | Source angles. |
| 0x14 | 0x1C | 4 | u32 | Model pointer, relocated at load. |
| 0x18 | 0x20 | Unknown | fixed-point matrix | Runtime 3×3 transform; component storage width not established here. |

#### Coordinates and transforms

[evidence: disassembly, deterministic decoding] Stored culling centres, model translations, and common-mesh
vertices are signed integers. `0x8001554C` uses the low 12 bits of each model
angle as a 4096-step turn and builds a row-composed rotation matrix. Comparing
the runtime-derived composition and its transpose against authored culling
centres strongly selects the row form: in Tunnels its median normalized
distance is 3.64 versus 45.30, and in Training 24.49 versus 114.91. The common
renderer explicitly negates the second component before emitting vertices
(`0x8003D214/280/2F0/350`), proving that source +Y points down relative to the
viewer's Y-up frame. The viewer uses model-header XYZ as translation and
applies `Y -> -Y` consistently to geometry, transforms, collision, culling
centres, creature markers, and derived cameras.

#### Level assembly and layers

For a selected internal ID the viewer:

1. Locates/decodes its `levelNN/level.dat`, `levelNN/terrain.all`, texture pages,
   envmap, optional parallax, `creat/creatNN.bin`, and referenced object roots.
2. Parses both placement lists and all recognized positive common meshes.
3. Decodes/binds CI4, CI8, and RGBA16 `.tpg` slots.
4. Emits visible world geometry in a `main` layer.
5. Emits candidate creature positions as explicitly hypothetical markers.
6. Decodes finite terrain groups into a hidden-by-default `collision` layer.
7. Emits `.par` as a `backdrop` layer only for its nine packages.
8. Supplies a robust placement-centre overview using the verified 75-degree
   game lens as its framing input; normal free flight retains the viewer lens.

Every drawn instance must belong to a layer. There is no evidence for room or
setup variants, so do not create artificial duplicates in the level selector.

### 3.3 Geometry

#### Custom mesh stream

[evidence: disassembly, deterministic decoding] The visible payload is not stored GBI. Renderer
`0x8003C858` converts this stream to F3D-family commands:

The common positive-count stream is:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | s32 | vertexCount | Positive in the common form. |
| 0x04 | 8 × vertexCount | vertex[] | vertices | Eight-byte records below. |
| 0x04 + 8 × vertexCount | Variable | faceGroup[] | groups | Ends with the two-byte signed control value −1. |

Vertex record, eight bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 6 | s16[3] | position | X, Y, Z. |
| 0x06 | 2 | u16 | packedColor | Packed RGB color. |

Face-group header, four bytes (the terminator contains only the first halfword):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | u16 | control | Kind: bits 0–4; render mode: bits 5–6; texture: bits 8–12. |
| 0x02 | 2 | s16 | count | Number of following face records. |

Face records contain three or four corners and are respectively 12 or 16 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 × corners | u16[] | references | Vertex index in low 12 bits. |
| 2 × corners | 2 × corners | u8[][2] | uv | Per-corner U, V bytes; shifted left four by the game. |

Kinds 0/2/4/6/8/10/12/14 use quads; kinds 1/3/9/11 use triangles.
Kinds 5/7/13 use the renderer default branch.

For a quad, the generated `G_TRI2` nominally names cache slots
   `(2,1,0),(3,1,2)`, but the runtime loads slots 0..3 from source references
   3,2,0,1. The source-record split is therefore `(2,1,0),(3,2,0)`, using
   diagonal 0--2.

The all-level parser encountered successful common meshes using kinds
0, 1, 2, 3, 4, and 6. The slot remap and resulting quad split above were
verified against the display-list builder and by rendering Training.

[evidence: disassembly, deterministic decoding] Across the common visible corpus, `control & 0x60` occurs
as 21,321 groups / 217,245 faces for `0x60`, 38 / 1,012 for `0x20`, and
11 / 545 for `0x00`; `0x40` is absent. The traced branch proves that `0x60`
changes generated vertex shade, but does not establish alpha compare or
framebuffer blending. The viewer therefore renders these common static groups
opaque rather than inventing a cutout rule from palette alpha bits.

[evidence: deterministic decoding] Across all 17 files, 8,437 placements resolve to 8,269 valid
positive-count meshes: 333,678 vertices and 218,802 face records. The checker
logged 110 non-common attempts—negative-count streams, negative/pre-relocated
pointers, or non-mesh placement kinds—rather than guessing them. These are
valid engine variants, not corrupt data.

### 3.4 Display lists and render state

### 3.5 Textures and materials

#### `.tpg` pages

[evidence: ROM bytes, disassembly, deterministic decoding] All 124 pages share
this envelope. The page length depends on the active slots.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 0x40 | u32[16] | descriptors | 0xFFFFFFFF marks an unused slot. |
| 0x40 | 0x200 | u8[] | paletteData | Shared color/palette region. |
| 0x240 | Variable | u8[] | imageData | Ordinary image payload. |

For live descriptor `d`, the loader computes:

```text
baseTexels = (((d & 2) + 2) * 512) << (d & 1)
payload scale by (d & 12): 0 or 4 => 1/2, 8 => 1, 12 => 2
```

The low six descriptor bits also supply an offset within a 64-byte aligned
runtime allocation. Common descriptors 4/5/6/7 therefore have
512/1024/1024/2048 payload bytes, corresponding to common 4-bit page shapes
32x32, 64x32, 32x64, and 64x64. `0x80013324` emits the runtime texture-load and
tile commands.

[evidence: disassembly, deterministic decoding] Runtime descriptor format bits are 4 = CI4, 8 = CI8, and
12 = RGBA16. Format bits zero emit no static texture setup, so the viewer
honors their payload extent but does not expose them as decoded textures.
Bonus exercises descriptor 9 (CI8). Per-slot CI4 palettes and the shared CI8
palette agree with focused renders, though their selection is less strongly
proved than the format and payload sizes.

#### Envmap and parallax resources

[evidence: ROM bytes, deterministic decoding] Every stage has `envmaps/levelNN.tpg`. All are `0xA40`
bytes except level 09 (`0x8240`, one descriptor 10 plus fifteen descriptor-7
slots).

Stages 01, 06, 07, 08, 09, 10, 11, 12, and 17 additionally have a
`parallax/levelNN.par`. Each is exactly `0x5200` bytes: a `0x200`-byte,
256-entry RGBA16 palette followed by ten consecutive `0x800`-byte 64x32 CI8
panels. `0x8000B358` loads the TLUT and `0x800620F8` uploads the panels.
`0x80012FAC` also retains the resource pointer and samples it for backdrop or
environment colors.

The viewer presents the ten panels as a thin camera-relative cylinder only for
those nine packages. This preserves the panoramic behavior but approximates
the game's exact screen-space strip and fill-band compositor.

### 3.6 Collision

#### `.all` container

[evidence: ROM bytes, disassembly, deterministic decoding] `.all` is a generic group container used for terrain,
characters, plants, and props. Its top-level layout is:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `u32` | `metadataOffsetHalfwords` | Multiply by two to obtain `metadataByteOffset`. |
| `0x04` | `metadataByteOffset - 4` | byte array | `groupData` | Concatenated group payloads. |
| `metadataByteOffset` | 4 | `u32` | `groupCount` | Number of following metadata records. |
| `metadataByteOffset + 4` | `0x4C * groupCount` | metadata record array | `groups` | Records defined below. |

Thus `metadataByteOffset = readU32BE(file, 0) * 2`. Group bytes occupy
`[4, metadataByteOffset)` and each metadata record is `0x4C` bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `+00` | 4 | `u32` | `data size in halfwords` | — |
| `+04` | 4 | `s32` | `x` | — |
| `+08` | 4 | `s32` | `y` | — |
| `+0C` | 4 | `s32` | `z` | — |
| `+10` | 4 | `u32` | `group ID` | — |
| `+14` | `0x38` | unknown | `unknown14` | Remaining fields; the complete record stride is `0x4C`. |

Runtime routines `0x80030A70`/`0x80030FE8` advance data by `size * 2` and
metadata by `0x4C`. A zero-size record reuses the preceding data pointer at a
new position.

#### `terrain.all` collision

[evidence: ROM bytes, disassembly] Every stage uses:

- ID `0x06`: ordinary finite collision;
- ID `0x08`: dynamic finite collision, present only in 03, 04, and 15;
- ID `0x0101`: infinite-wall collision;
- ID `0x0104`: one footer/end record.

A finite group's batches begin with this header:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | `s16` | `enabled` | Must equal 1 for another batch; any other value terminates the group. |
| `0x02` | 2 | `u16` | `triangleCount` | Number of following collision triangles. |
| `0x04` | 8 | `u16[4]` | `unknown04` | Unknown header fields. |
| `0x0C` | `32 × triangleCount` | `CollisionTri[]` | `triangles` | Collision-triangle records. |

A negative/non-1 first halfword terminates the group. Each 32-byte collision
triangle has this partially understood layout:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 6 | `u16[3]` | `attributes00` | Collision attributes; semantics remain unknown. |
| `0x06` | 6 | `s16[3]` | `origin` | Local origin for vertex 1. |
| `0x0C` | 6 | `s16[3]` | `vertex2Delta` | Add to `origin` to obtain vertex 2. |
| `0x12` | 6 | `s16[3]` | `vertex3Delta` | Add to `origin` to obtain vertex 3. |
| `0x18` | 8 | `u16[4]` | `attributes18` | Collision attributes; semantics remain unknown. |

Add the metadata X/Y/Z to all three vertices.

[evidence: deterministic decoding] All 17 files land exactly on their metadata offsets. All 3,297
finite group instances terminate on `FFFF`; expanding reused group data at
each position produces 113,028 finite triangles. Infinite-wall groups are not
decoded yet.

Collision belongs in a hidden-by-default `collision` layer. Finite groups may
be emitted now; `0x0101` must stay explicitly incomplete rather than treated
as ordinary triangles.

### 3.7 Environment, sky, fog, and lighting

### 3.8 Cameras and paths

#### Runtime camera, fog, and background

[evidence: RAM, captured frames] Playable Training was captured at 320x240. Its viewport is
the standard `(scale,translation)=(640,480,511,0)` quarter-pixel form. The root
frame DL is `0x19D8` bytes and uses F3DLX 1.23. It contains 277 `G_VTX`, 940
`G_TRI2`, 103 `G_TRI1`, 100 nested `G_DL`, and 107 texture-image commands.

Projection at physical `0x3E5040` is 4:3, vertical FOV 75 degrees, near about
4 and far about 32768. A second projection at `0x3E50C0` keeps 75 degrees but
uses near about 200 and far about 32000, consistent with a distant/backdrop
pass. A sampled pass sets fog color `7878FF00`, fog factor `011CFFE4`, enables
`G_FOG` around nine display lists, then disables it; standard equations give
roughly near 550/far 1000.

This verifies the engine capabilities and one Training frame only.
[open question] Per-level fog colors/distances, the semantic camera eye/target
derived from split runtime matrices, and camera-follow parameters remain to be
mapped. The viewer uses the 75-degree value to reframe its Training overview;
normal free flight retains the viewer's standard lens.

## 4. Objects

### 4.1 Placement records

### 4.2 Object and model formats

#### Objects and creatures

[evidence: ROM bytes, disassembly] Object resources live under `chars*`, `creat`, `bits`,
`plants*`, and related roots. `.anm` contains animation data, `.tpg` page
images, and `.all` the same group container. `0x80030A70` explicitly loads
`bits\\plantter.all`, then a requested object `.all`, relocates its groups,
and recognizes collision IDs 6/8. Placement rendering dispatches on the low
nibble of the `level.dat` placement flag.

**[ROM bytes/deterministic decoding; hypothesis semantics]** Each `creatNN.bin` expands to
`0x700` bytes: 64 records of `0x1C`. Treating record byte `+0x0C` as a
one-based creature/model type, every value `0x01..0x29` occurs across the
stages and matches in order all 41 registered model stems at ROM
`0x7DC44..0x7DE7F`. This strongly suggests no registered actor family is
orphaned from all stage placement data, but the type field and one-based
mapping still need code/runtime proof. Type zero's exact semantics remain
[open question].

Animation decoding, negative-count model streams, and non-common placement
kinds are required before the viewer can promise every animated object.

### 4.3 Skeletons and animation

### 4.4 Behaviors, triggers, and scripted objects

#### Song storage and selector behavior

[evidence: ROM bytes] All tune files are RNC1. Relevant archive extents are:

| File group | ROM interval | Notes |
|---|---|---|
| `sfx.bfx` | `8A4B88..8A4EF4` | 93 effects |
| `bugs.ptr` | `8A4EF8..8AE642` | decoded `BB28` |
| `bugs01..15.bin` | `8AE648..8CEFA1` | 15 level cues |
| `bugsa.bin` | `8CEFA8..8D0511` | Training |
| `bugsb.bin` | `8D0518..8D0D59` | context unresolved |
| `bugtoken.bin` | `8D0D60..8D1196` | one-shot |
| `dead.bin` | `8D1198..8D1315` | one-shot |
| `title.bin` | `8D1318..8D17CF` | title cue |

[evidence: disassembly] Selector `0x80017AB0` normalizes positive inputs `>=16` by
subtracting one, while negative inputs are simply negated. Its exact mapping:

| Caller request | Stored normalized value | File |
|---|---|---|
| `+1..+15` or `-1..-15` | 1..15 | `bugs01..15` |
| `+16` | 15 | `bugs15` alias |
| `+17..+20` | 16..19 | `dead`, `bugtoken`, `title`, `bugsb` |
| `+21,+22` | 20,21 | `bugsa` |
| `-16..-19` | 16..19 | `dead`, `bugtoken`, `title`, `bugsb` |
| `-20,-21` | 20,21 | `bugsa` |

`0x80084B38` is the normalized value, not necessarily the caller's original
request. [evidence: RAM] Training retained value 21 and a relocated `bugsa.bin` at
`0x8032C000`; bytes from its offset `+0xC0` onward matched exactly. This
resolves Training. The context of `bugsb` remains [open question].

## 5. Audio

### 5.1 Audio storage and banks

### 5.2 Sequence format and driver

#### Driver and banks

[evidence: ROM bytes, disassembly, RAM, audio analysis] Audio is Software Creations Nintendo 64 Sound
Tools `libmus`, song format `0x215`, running over standard Nintendo ABI1—not
MusyX. Diagnostic signatures are `N64 PtrTablesV2`, `N64 WaveTables `, BFX,
the song headers, the player routines, and the live ABI1 task tuple.

Initialization at `0x80017898` loads `tunes/sfx.bfx` and `tunes/bugs.ptr`,
then calls `MusInitialize` at `0x80079FB8` with:

| Setting | Value |
|---|---:|
| voices/channels | 24 |
| scheduler priority | 12 |
| heap | `0x20000` bytes |
| FIFO / synth updates | 64 / 256 |
| requested / actual rate | 22050 / **22047 Hz** |
| RSP commands | 2048 |
| retrace count | 1 |
| DMA buffers | 48 x 1024 bytes |
| synth FX | 2 = `AL_FX_BIGROOM` |
| song and SFX master volume | `0x3FFF` each |

Live Training used a type-2 ABI1 task and streamed a `0x400`-byte slice of
ADPCM wave 86 from ROM `0x99CD74`.

[evidence: ROM bytes, deterministic decoding] `bugs.ptr` declares 271 type-0 N64 VADPCM waves. The raw
sample bank starts at `0x8D1800` and its used range ends at `0xBAD860`
(2,998,368 bytes). There are 43 infinite sample loops. `sfx.bfx` maps 93 waves
(0–26, 205–270). Songs collectively map 173 other waves; songs may share
samples with one another, but the aggregate song set is disjoint from SFX.

#### Complete music-player list and loops

[evidence: ROM bytes, disassembly, deterministic decoding] Loop samples are in the 22,047-Hz renderer domain.
All looped tracks wrap every stream; `dead` and `bugtoken` terminate.

| UI track | File | Ch./waves | Loop start | Loop length | Seconds start / length |
|---|---|---:|---:|---:|---:|
| Ant Island | `bugs01` | 12/17 | 0 | 3,382,272 | 0.000 / 153.412 |
| Council Chamber | `bugs02` | 12/16 | 5,021,786 | 3,171,614 | 227.776 / 143.857 |
| Tunnels | `bugs03` | 12/15 | 5,400,757 | 5,379,853 | 244.966 / 244.017 |
| City Entrance | `bugs04` | 12/13 | 5,100,363 | 4,050,212 | 231.340 / 183.708 |
| City Square | `bugs05` | 12/15 | 5,400,384 | 4,725,492 | 244.949 / 214.337 |
| Cliffside | `bugs06` | 12/18 | 4,487,509 | 4,627,870 | 203.543 / 209.909 |
| Clover Forest | `bugs07` | 12/18 | 5,526,105 | 4,894,679 | 250.651 / 222.011 |
| Riverbed Flight | `bugs08` | 12/23 | 5,329,641 | 4,807,700 | 241.740 / 218.066 |
| Anthill Part Two | `bugs09` | 12/17 | 5,153,938 | 4,329,132 | 233.770 / 196.359 |
| Riverbed Canyon | `bugs10` | 12/16 | 5,431,032 | 5,042,947 | 246.339 / 228.736 |
| Birdnest | `bugs11` | 12/20 | 4,121,059 | 4,926,241 | 186.922 / 223.443 |
| The Tree | `bugs12` | 12/24 | 5,098,963 | 4,281,055 | 231.277 / 194.179 |
| Battle Arena | `bugs13` | 12/18 | 5,863,679 | 4,810,269 | 265.963 / 218.182 |
| Bug Bar | `bugs14` | 12/18 | 0 | 5,258,376 | 0.000 / 238.508 |
| Canyon Showdown | `bugs15` | 12/20 | 5,163,044 | 2,708,827 | 234.184 / 122.866 |
| Death | `dead` | 8/4 | — | one-shot | end about 13.400 s |
| Token | `bugtoken` | 7/8 | — | one-shot | end about 10.470 s |
| Title | `title` | 6/10 | 0 | 224,971 | 0.000 / 10.204 |
| Unidentified context | `bugsb` | 12/11 | 2,603,065 | 2,237,599 | 118.069 / 101.492 |
| Training | `bugsa` | 12/13 | 0 | 2,722,773 | 0.000 / 123.499 |

The 1–15 names follow the exact shared internal level ID space. The UI should
list 20 unique files, not duplicate selector aliases 16 and 22.

#### Unreferenced audio waves

[evidence: ROM bytes, deterministic decoding] Five valid VADPCM waves are referenced by neither any song
nor the 93-entry BFX bank:

| Wave | ROM start | Encoded bytes | Decoded samples | Loop |
|---:|---:|---:|---:|---|
| 159 | `A3E690` | `AE6` | 4,960 | 4,105..4,915 infinite |
| 181 | `A6FDF0` | `396` | 1,632 | 778..1,603 infinite |
| 193 | `A92400` | `8E86` | 64,864 | none |
| 194 | `A9B290` | `84D2` | 60,448 | none |
| 204 | `ACA770` | `1878` | 11,136 | none |

Their intended sounds cannot be named from static data alone.

### 5.3 Instruments and sample encoding

### 5.4 Music catalog and loop points

## 6. Unused and hidden content

### 6.1 Unreferenced assets

#### No hidden 3-D map

[evidence: ROM bytes, deterministic decoding] The complete manifest contains no extra level directory or
additional `level.dat`/`terrain.all` pair. All 17 gameplay datasets correspond
to Training, the fifteen story stages, or Bonus. No cut 3-D map was found.

An exhaustive filename reachability audit classifies 487 of 488 records via
exact full paths, basenames inside resource descriptors, or verified filename
generators: level pairs, creature names, actor/plant stems, music numbers,
story panels, or demo paths.

#### Likely-unused result bitmap

**[ROM bytes; hypothesis unused]** `level96/lose.pic` is manifest record 418,
stored at `0x790940..0x79698E` and RNC1-decoded to `0x88E8`. It is the sole
archive entry with neither an explicit pre-manifest full/basename reference nor
coverage by a known filename generator. Challenge UI explicitly names
`level96/chal.pic`, and failure text uses `Please Try Again.`; no second
`lose` string exists outside the manifest.

A numeric-index load has not been disproved, so call it **likely unused**, not
proven unreachable.

#### Demo recordings and development residue

**[ROM bytes; hypothesis record semantics]** `pad/path01.bin`, `path04.bin`,
`path10.bin`, and `path13.bin` decode to patterned four-byte records and are
strongly associated with shipped attract/demo paths for Ant Island, City
Entrance, Riverbed Canyon, and Battle Arena. Interpreting the two halfwords in
each record as controller input plus run duration remains unverified. The
mutable template `PAD\\PATH00.BIN` at `0x80B20` and UI text `DEMO` corroborate
their normal shipped use. They are not cut levels.

The executable retains the authoring path
`D:\\BUGS\\N64\\CD\\PAD\\PATH00.BIN` at `0x80B30`, plus dormant generic
loader basenames `level1.dat`, `level2.dat`, and `level3.dat`; the archive has
no matching split-level payloads.

**[ROM bytes negative audit]** No `DEBUG`, `ASSERT`, warp, test-map,
collision-view, or free-camera label was found. `MOVING CAMERA` and
`STILL CAMERA` are normal pause-menu options, not evidence of a debugger.

### 6.2 Cut or inaccessible levels

### 6.3 Debug features

### 6.4 Prototype or revision-specific content

## 7. nviewer implementation

### 7.1 Module mapping

#### Viewer renderer mapping

[evidence: nviewer source, ROM bytes, disassembly, deterministic decoding] Reuse `parseLibmusBank` and `renderLibmusSong` from
`src/rom/music/libmus.ts` with `{ masterVolume: 0x3FFF, reverb: true }`. This
is the newer `0x215` player used by Global Assault/Gex 3, not the older
`libmus64.ts` path. Every executed audio-significant command is already
supported. The existing `AA` no-op is acceptable because every executed
change-FX value is 2, the already-active BIGROOM mode.

The implementation decodes `bugs.ptr` and the selected song with RNC1, then
caches the parsed pointer and sample bank per source ROM. Its temporary
contiguous bank assembly costs roughly 2.91 MiB and avoids a broader shared
renderer API change.

#### Implemented modules

The implementation lives in:

```text
src/rom/bugslife/
  archive.ts       manifest detection, lookup, RNC1/RNC2
  level.ts         level.dat envelope, placements, assembly
  mesh.ts          custom mesh stream -> viewer geometry
  all.ts           .all containers and finite collision
  texture.ts       .tpg and .par decoding
  objects.ts       candidate creature-position markers
  music.ts         tune list and libmus bank assembly
  index.ts         ROM detection and public game API
```

`src/rom/index.ts` registers `NBYE/NBYP/NBYF/NBYD/NBYI`. No new level-data
contract was needed. `music/libmus.ts` accepts independently verified loop
bounds, while callers that omit them retain its existing bytecode probe.

#### Remaining difficulty

| Remaining piece | Difficulty | Main risk |
|---|---|---|
| Full animated objects | high | non-common streams and `.anm` |
| Infinite collision | medium | ID `0x101` record semantics |
| Exact backdrop compositor | medium | screen-space fill/strip behavior |
| Per-stage environment | medium | authored fog, clear color and cameras |

### 7.2 Supported features

### 7.3 Approximations and omissions

## 8. Verification and remaining work

### 8.1 Verification evidence

#### Implementation verification

[evidence: deterministic decoding, nviewer source] The focused US audit reads all 488 manifest records and
all 17 levels: 8,437 placements, 8,269 recognized common models, 333,678
vertices, 218,802 face records, 3,297 finite collision groups, and 113,028
collision triangles. It completed 34/34 transferred loads and 17/17 layer
audits; the final focused render-data hash is
`6c5e8731395791edc0431cb43107ae5f4571c4b4`. The same structural totals,
transfer checks, and layer checks passed the E/F/G/I builds.

All 20 US tracks rendered with finite stereo PCM at 22,047 Hz and exact
researched loop metadata; every buffer transferred successfully. The Title cue
also decoded in all five regions. Global Assault's 21 tracks and Gex 3's 15
tracks were byte-identical to their pre-change shared-renderer baseline.

Offline comparison covers Training and the parallax decode. Final in-app
Chromium checks loaded Training and Tunnels, exercised sky and layers, started
Title music, and produced no console, page, or request errors.

#### Static verification

The extractors compile and reproduce all 488 records. All 17 `level.dat`
placement envelopes and all `.all` containers reach their structural
endpoints; only the common positive-count mesh form is decoded within the
placements. The song loop
analyzer executes every channel/master stream and avoids a prior fixed-duration
probe ceiling that would miss long introductions.

#### Runtime capture evidence

[evidence: RAM, captured frames] `emulator/NOTES.md` records the one authorized session.
It reached playable Training and retained:

- `title.png` — SHA-256
  `46f61e5ea7f0b925c8ec352b95cae33f3183dbdbe1d1d1322f77738c7b85320c`;
- `training-playable.png` — SHA-256
  `d033f86c18f54d53db9f90c8de9dc10bb7393bc1a49c064a0cbed01eb870b368`;
- `rdram-training.bin` — 8 MiB, SHA-256
  `f23a57eadf9eea6ca3188225021f09c7dba17ee7d415d16d9d399b8796881fca`;
- `frame-80240000.bin` — `0x19D8` bytes, SHA-256
  `fecab3c82fce021c56673ab00b33afe186d40e43d20a9450bb4943f369051f7e`;
- `audio-task-803177a0.bin` — `0x12A8` bytes, SHA-256
  `80b4ae21d3ad14b98d8d27a4d93b4ac12de41046293045df04e2a15f64a8120c`.

The screenshot callback was asynchronous, so the retained frame DL and image
must not be described as the exact same VI. After a PI breakpoint, the session
stopped producing new frames and remained in a kernel receive/exception path;
it was stopped rather than reset or relaunched. No full level-load DMA or
additional stage was captured. The child and lead both verified that no
`mupen64plus` or `headless-*.sh` process remained.

### 8.2 Known unknowns

#### Open questions and explicit limitations

1. The 110 classified negative, non-common, or secondary model attempts are
   omitted; malformed data after recognition of a common mesh still fails.
2. Creature positions are markers. Their `creatNN.bin +0x0C` one-based model
   mapping remains a hypothesis, and `.anm` animation is not decoded.
3. Infinite-wall collision ID `0x0101` and collision attributes remain
   undecoded; only finite IDs 6/8 are shown.
4. The nine parallax skies use a labelled thin-cylinder approximation rather
   than the game's exact screen-space strip and fill-band compositor.
5. Per-stage environment values beyond verified Training fog and PAR-derived
   clear colors use conservative defaults. Cameras are robust overview views,
   not claimed authored cameras.
6. CI4 and CI8 palette selection is visually supported but merits a second
   direct runtime branch trace.
7. The runtime context of `bugsb.bin` remains unidentified.

### 8.3 References
