# Jet Force Gemini — Nintendo 64 ROM format specification

This manual describes the North American revision-zero cartridge image. Unless
otherwise stated, multi-byte integers are big-endian and ROM ranges are
half-open.

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | 71-section archive with a top-level relative-offset table; most file collections use secondary relative-offset tables |
| Compression | Rare DKR wrapper around raw RFC 1951 DEFLATE for models and most textures; ten 2D textures are raw |
| Graphics microcode | Rare F3DJFG, derived from F3DDKR; custom compact-vertex and polygon DMA commands |
| Geometry | Indexed compact meshes grouped into segments and batches; separate compressed level and object-model collections |
| Textures | RGBA32, RGBA16, I8, I4, IA16, IA8, and IA4; animated textures and mip levels supported |
| Collision | Derived from level-model triangles after batch- and triangle-flag exclusion; runtime planes and spatial masks accelerate queries |
| Music driver | Rare-modified Nintendo `n_audio` with `n_alCSPlayer` compressed MIDI |
| Audio microcode | Nintendo `n_audio`/`n_aspMain` family; exact SDK revision unknown |
| Sample encoding | Nintendo VADPCM in standard `ALBankFile` banks |
| Levels | 412 loadable level-header records selecting 301 level models |
| Memory requirement | Base 4 MiB; the retail executable does not enable its dormant extended-memory branch |
| Viewer support | Implemented: all 412 level records and 89 selectable music sequences. |

Verified from ROM bytes and disassembly. The graphics task is identified by
its command behavior and its GLideN64-recognized microcode CRC. The audio task
contains no version string, so its binary hashes are more precise identifiers
than an inferred SDK release.

### 1.2 ROM identification

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| USA | `JET FORCE GEMINI` | `NJFE` | 0 | 32 MiB (`0x02000000`) | `8A6009B6` | `94ACE150` | `493ced9008dbe932d6e91179b68e8630cf23a023` | CIC-NUS-6105 | `1.1848`; `04/09/99 20:40` |

The SHA-1 is over normalized `.z64` bytes. The CIC identification is verified
by bootcode CRC-32 `98BC2C86`. The timestamp is a retained build string, not
the cartridge revision byte; its date-field ordering is not established.
The resident program also contains `Version 1.1 14/03/98 15:50 The Overlord`;
that is a library or tool banner and does not identify this ROM revision.

### 1.3 Terminology and conventions

- **Asset section** means one of the 71 top-level archive members, numbered
  `0x00` through `0x46`.
- **Level record** means one fixed `0x118`-byte entry in asset `0x1F`. A record
  may describe gameplay, a room, a transition, a cutscene, a frontend scene,
  or a test.
- **Level model** means one compressed static world mesh in asset `0x25`.
  Multiple level records can select the same model.
- **ROM list** means a variable-length placement list in asset `0x1D`.
- Offsets within decoded models and secondary archive tables are relative to
  the beginning of their containing object unless stated otherwise.
- Stored offset fields are relative to their decoded member and are relocated
  in place. Fields explicitly labeled runtime pointers are populated after
  loading.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

Verified by disassembly, the cartridge entry point is `0x80000400`. The
resident image occupies ROM `[0x00001000,0x000B1750)` and RAM
`[0x80000400,0x800B0B50)`, with the mapping
`ROM = virtual address - 0x7FFFF400`. Resident BSS occupies
`[0x800B0B50,0x801059A0)`. The entry stub clears BSS, sets the initial stack to
`0x800FA4D0`, and calls the boot routine at `0x8003F500`.

Code outside the resident image uses a runtime linker:

| ROM range | Size | Contents |
|---|---:|---|
| `[0x01ECF220,0x01ED0270)` | `0x1050` | 520 resident-image relocation entries |
| `[0x01ED0270,0x01ED2780)` | `0x2510` | Symbol-to-overlay dispatch table |
| `[0x01ED2780,0x01ED3B20)` | `0x13A0` | 157 overlay headers |
| `[0x01ED3B20,0x01FEB040)` | `0x117520` | Overlay code, data, and relocation streams |
| `[0x01FEB040,0x01FED550)` | `0x2510` | Symbol-name offsets |
| `[0x01FED550,0x01FF6820)` | `0x92D0` | Symbol-name pool |
| `[0x01FF6820,0x02000000)` | `0x980` | Padding |

Each overlay header is `0x20` bytes:

<table class="byte-layout">
  <thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
  <tbody>
    <tr><th><code>0x00</code></th><td colspan="4"><code>runtimeBase: u32</code></td><td colspan="4"><code>romOffset: u32</code></td></tr>
    <tr><th><code>0x08</code></th><td colspan="4"><code>textSize: u32</code></td><td colspan="4"><code>dataSize: u32</code></td></tr>
    <tr><th><code>0x10</code></th><td colspan="4"><code>bssSize: u32</code></td><td colspan="2"><code>primaryRelocSize: u16</code></td><td colspan="2"><code>secondaryRelocSize: u16</code></td></tr>
    <tr><th><code>0x18</code></th><td colspan="4"><code>initOffset: s32</code></td><td colspan="4"><code>resumeOffset: s32</code></td></tr>
  </tbody>
</table>

`romOffset` is relative to ROM `0x01ED3B20`; initialization converts it to an
absolute address. An init or resume offset of `-1` means absent. The loader
allocates text, initialized data, zeroed BSS, and the primary relocation stream,
then resolves local, external, and jump relocations. Overlay 24 contains the
level-model loader.

### 2.2 Memory and address mapping

Verified by resident-code disassembly, the retail program creates its heap over
`[0x801059A0,0x80400000)`. The
initialized `mmExtendedRam` flag is zero, and exhaustive resident-code
reference checking finds no store that enables it. A dormant branch would use
`0x80600000`, but it is unreachable in this build. Overlays have no fixed RAM
addresses: their on-ROM `runtimeBase` values begin as zero and the runtime
linker assigns heap addresses.

### 2.3 ROM map and asset organization

Verified from ROM bytes and asset-loader disassembly, the asset lookup table is
ROM `[0x000B1750,0x000B1880)`. Its first word is
`0x47`, followed by 72 offsets relative to data base `0x000B1880`: one start
for every section and a terminal end. The final relative offset is
`0x01E1D9A0`, so asset data occupies `[0x000B1880,0x01ECF220)`.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `u32` | `sectionCount` | Number of valid sections; `0x47`. |
| `0x04 + 4*i` | 4 | `u32` | `offset[i]` | Offset relative to asset-data base; `i = 0..sectionCount`. |
| After offsets | 12 | bytes | `padding` | Zero-filled lookup-table padding. |

There are `sectionCount + 1` offsets. The trailing terminal offset is followed
by twelve zero bytes. The retail bounds check mistakenly accepts section ID
`0x47`, but no legitimate caller uses it and only `0x00..0x46` are valid.

Most multi-file sections use a secondary table containing `N + 1` relative
`u32` offsets, then `0xFFFFFFFF` and zero alignment padding. Member `i` spans
`dataBase + offset[i]` through `dataBase + offset[i+1]`.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00 + 4*i` | 4 | `u32` | `offset[i]` | Member boundary relative to the paired data section; `i = 0..N`. |
| `0x04 * (N + 1)` | 4 | `u32` | `terminator` | Constant `0xFFFFFFFF`. |
| After terminator | Variable | bytes | `padding` | Zero-filled alignment through the end of the table section. |

| Table | Data | Members | Contents |
|---:|---:|---:|---|
| `0x01` | `0x00` | 6,663 | Level and 3D textures |
| `0x03` | `0x02` | 657 | Ordinary and 2D textures |
| `0x14` | `0x13` | 2 | Full-screen images |
| `0x1C` | `0x1D` | 806 | ROM lists |
| `0x1E` | `0x1F` | 412 | Level records |
| `0x20` | `0x21` | 412 | Parallel per-level build metadata |
| `0x22` | `0x23` | 21 | World/category strings |
| `0x24` | `0x25` | 301 | Level models |
| `0x26` | `0x27` | 904 | Object models |
| `0x2E` | `0x2F` | — | Object-definition offsets and definitions |
| — | `0x30` | 832 | Object-ID-to-definition translation table |
| `0x41` | `0x42` | — | Level animation and path data |
| `0x45` | `0x46` | — | FMV table and data |

These roles are verified by ROM structure and loader call sites. The archive
does not contain filenames.

### 2.4 Compression formats

Verified from ROM bytes, independent inflation, and inflater disassembly,
models, screens, all 6,663 level/3D textures, and 647 of 657 ordinary textures
use the [Rare DKR raw-DEFLATE wrapper](compression/raw-deflate.md). This is not
a gzip member: it has no gzip magic, metadata, CRC-32, or ISIZE trailer.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | little-endian `u32` | `decodedSize` | Exact decoded byte count. |
| `0x04` | `0x01` | `u8` | `level` | `0x09` in every audited stream; ignored by the game decoder. |
| `0x05` | Variable | RFC 1951 | `payload` | Raw DEFLATE through its final block. |
| After stream | 0–15 | bytes | `padding` | Zero padding belonging to the enclosing 16-byte-aligned member. |

Verified by disassembly, the size reader assembles the first four bytes
little-endian and the inflater starts exactly at `+0x05`. All 8,517 indexed
wrappers decode to their declared sizes and contain only zero padding after a
valid final block. `rare_dkr_decode` and `rare_dkr_encode` in the shared
DEFLATE reference codec implement the five-byte wrapper; enclosing-archive
padding remains the caller's responsibility.

| Resource group | Members | RZIP | Raw | Stored bytes | Decoded bytes |
|---|---:|---:|---:|---:|---:|
| Level/3D textures | 6,663 | 6,663 | 0 | 11,093,088 | 20,977,408 |
| Ordinary/2D textures | 657 | 647 | 10 | 707,408 | 1,489,744 |
| Full-screen images | 2 | 2 | 0 | 22,416 | 307,232 |
| Level models | 301 | 301 | 0 | 7,112,288 | 18,207,358 |
| Object models | 904 | 904 | 0 | 2,548,560 | 5,463,392 |
| **Total** | **8,527** | **8,517** | **10** | **21,483,760** | **46,445,134** |

Stored sizes include wrappers and member padding. The ten raw ordinary-texture
IDs are 180 through 188 and 408.

### 2.5 Loading process

Verified by loader disassembly, the PI loader initializes the top-level table
and splits DMA transfers into
chunks no larger than `0x5000` bytes. Level loading proceeds as follows:

1. Asset `0x1E` supplies adjacent offsets for the selected `0x118`-byte record
   in asset `0x1F`.
2. Level-record field `+0x54` selects a member through assets `0x24/0x25`.
3. Overlay 24 allocates a `0x9F000`-byte arena, stages the compressed member at
   the aligned high end, and inflates it forward to the arena base.
4. Six level-model offsets and four offsets in each segment are relocated.
5. Referenced textures are loaded, runtime display lists and collision query
   data are generated, and both level-selected ROM lists are instantiated.
6. Animation data, players, the sky, reflections, fog, and camera state are
   initialized from the level record.

Textures keep a clear `0x20`-byte outer header. When header byte `+0x19` is
nonzero, an RZIP stream at entry `+0x20` expands to the complete texture,
including a new copy of the header.

### 2.6 Revision differences

Only the North American revision-zero image is specified. No cross-revision
field or asset comparison has been completed. Internal version and build
strings must not be interpreted as cartridge-header revisions.

## 3. Level data

### 3.1 Level catalog and identifiers

Verified from ROM bytes, assets `0x1E/0x1F` contain 412 level records. Each
begins with a 32-byte
internal name and stores a world/category ID at `+0x20`. Category labels reside
in asset `0x23`. The full ROM-derived catalog is Appendix A.

The catalog includes small rooms, transitions, cutscenes, boss phases,
frontend scenes, multiplayer arenas, and test areas. It is therefore not
equivalent to the game's player-facing world list. There are 301 level models;
level record field `+0x54` is a signed model index, and several records can
share one model.

### 3.2 Level container

Verified from ROM bytes and level-loader disassembly, level records have fixed
size `0x118`. Fields used by the static scene loader are:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x20` | char array | `internalName` | NUL-terminated development name within the fixed buffer. |
| `0x20` | `0x01` | `u8` | `categoryId` | Index into the world/category records; `0xFF` occurs once. |
| `0x54` | `0x02` | `s16` | `modelId` | Member of assets `0x24/0x25`. |
| `0x56` | `0x02` | `s16` | `romListA` | First placement-list index. |
| `0x58` | `0x02` | `s16` | `skyObjectId` | Sky object/resource; `-1` means absent. |
| `0x5A` | `0x02` | `s16` | `fogNear` | Fog near distance. |
| `0x5C` | `0x02` | `s16` | `fogFar` | Fog far distance. |
| `0x5E` | `0x02` | `s16` | `fogUnknown` | Third fog or transition parameter. |
| `0x60` | `0x03` | `u8[3]` | `fogRgb` | Fog color. |
| `0x63` | `0x01` | `u8` | `fogMode` | Fog flags; individual bits unresolved. |
| `0x69` | `0x01` | `s8` | `skyMode` | `-1` selects the scrolling-plane sky path. |
| `0x72` | `0x01` | `u8` | `musicId` | Music sequence selected for the level. |
| `0xAC` | `0x01` | `s8` | `verticalFov` | Camera vertical field of view in degrees. |
| `0xAD` | `0x03` | `u8[3]` | `clearRgb` | Screen/clear color. |
| `0xB0` | `0x02` | `u8[2]` | `skyUvScale` | Scrolling-plane U and V scale. |
| `0xB2` | `0x02` | `s8[2]` | `skyUvSpeed` | Scrolling-plane U and V speed. |
| `0xB4` | `0x04` | `u32` | `skyTextureId` | Scrolling-plane texture ID; relocated to a pointer. |
| `0xB8` | `0x04` | `s16[2]` | `skyUvOffset` | Runtime U and V offsets. |
| `0xCA` | `0x02` | `s16` | `romListB` | Second placement-list index. |
| `0xCE` | `0x03` | `u8[3]` | `gradientBottomRgb` | Lower gradient color. |
| `0xD1` | `0x03` | `u8[3]` | `gradientTopRgb` | Upper gradient color. |
| `0xE8` | `0x02` | `s16` | `animationId` | Entry in assets `0x41/0x42`. |

Verified against RAM: during the opening 3D sequence, current level ID
`0x15D` selects `JFGShip Scroll`. Its RAM record matches the corresponding ROM
record byte-for-byte except optional pointer-like field `+0xE4`, which changes
from `0xFFFFFFFF` to zero.

### 3.3 Geometry

Verified from decoded ROM members and level-model loader disassembly, the
level-model header is `0x30` bytes:

<table class="byte-layout">
  <thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
  <tbody>
    <tr><th><code>0x00</code></th><td colspan="4"><code>textureInfoOffset: u32</code></td><td colspan="4"><code>segmentOffset: u32</code></td></tr>
    <tr><th><code>0x08</code></th><td colspan="4"><code>segmentBoundsOffset: u32</code></td><td colspan="4"><code>auxOffset: u32</code></td></tr>
    <tr><th><code>0x10</code></th><td colspan="4"><code>visibilityOffset: u32</code></td><td colspan="4"><code>bspOffset: u32</code></td></tr>
    <tr><th><code>0x18</code></th><td colspan="2"><code>textureCount: u16</code></td><td colspan="2"><code>segmentCount: u16</code></td><td colspan="2"><code>unknown_1C: u16</code></td><td colspan="2"><code>animatedTextureCount: u16</code></td></tr>
    <tr><th><code>0x20</code></th><td colspan="2"><code>minX: s16</code></td><td colspan="2"><code>maxX: s16</code></td><td colspan="2"><code>minY: s16</code></td><td colspan="2"><code>maxY: s16</code></td></tr>
    <tr><th><code>0x28</code></th><td colspan="2"><code>minZ: s16</code></td><td colspan="2"><code>maxZ: s16</code></td><td colspan="4"><code>decodedSize: u32</code></td></tr>
  </tbody>
</table>

The first six fields are offsets relocated in place. `auxOffset` is verified as
an offset but its contents remain unidentified. The visibility and BSP names
are source-derived and consistent with their data. Bounds are paired minimum
and maximum values by axis.

Level texture-info records are eight bytes:

<table class="byte-layout">
  <thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
  <tbody><tr><th><code>0x00</code></th><td colspan="4"><code>textureId: u32</code></td><td><code>cachedWidth: u8</code></td><td><code>cachedHeight: u8</code></td><td><code>formatMaterial: u8</code></td><td><code>surfaceType: s8</code></td></tr></tbody>
</table>

`trackInit` loads each entry as `textureId | 0x8000`, selecting the level/3D
texture pool, then replaces the stored ID with a runtime texture pointer.

Each segment is `0x48` bytes. Confirmed fields are:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `u32` | `vertexOffset` | Relocated compact-vertex array. |
| `0x04` | 4 | `u32` | `triangleOffset` | Relocated triangle array. |
| `0x08` | 4 | `u32` | `unknown_08` | Stored value; not relocated. |
| `0x0C` | 4 | `u32` | `batchOffset` | Relocated batch array. |
| `0x10` | 4 | pointer | `xzMasks` | Runtime `u32` overlap mask per triangle. |
| `0x14` | 4 | pointer | `yMasks` | Runtime `u8` overlap mask per triangle. |
| `0x18` | 4 | `u32` | `collisionFacetOffset` | Relocated stored facet-index array. |
| `0x1C` | 4 | pointer | `collisionPlanes` | Runtime generated `f32[4]` planes. |
| `0x20` | 4 | pointer | `collisionBytes` | Runtime generated per-triangle data. |
| `0x24` | 2 | `u16` | `vertexCount` | Compact vertices. |
| `0x26` | 2 | `u16` | `triangleCount` | Triangles. |
| `0x28` | 2 | `u16` | `batchCount` | Excludes the required sentinel. |
| `0x2A` | 2 | `u16` | `unknown_2A` | Unresolved count or flags. |
| `0x34` | 4 | pointer | `runtimeWork` | Runtime allocation/work pointer. |
| `0x3C` | 2 | `s16` | `runtime_3C` | Initialized to zero. |
| `0x3E` | 2 | `s16` | `specialBatchCount` | Number of batches carrying flag `0x2000`. |
| `0x40` | 4 | pointer | `specialBatchIndices` | Runtime index array. |
| `0x44` | 2 | `s16` | `specialMaximumY` | Maximum Y among those batches. |

Segment bounds are independent `0x0C`-byte records:

<table class="byte-layout">
  <thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
  <tbody>
    <tr><th><code>0x00</code></th><td colspan="2"><code>minX: s16</code></td><td colspan="2"><code>minY: s16</code></td><td colspan="2"><code>minZ: s16</code></td><td colspan="2"><code>maxX: s16</code></td></tr>
    <tr><th><code>0x08</code></th><td colspan="2"><code>maxY: s16</code></td><td colspan="2"><code>maxZ: s16</code></td><td colspan="4">—</td></tr>
  </tbody>
</table>

Compact vertices are `0x0A` bytes:

<table class="byte-layout">
  <thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
  <tbody>
    <tr><th><code>0x00</code></th><td colspan="2"><code>x: s16</code></td><td colspan="2"><code>y: s16</code></td><td colspan="2"><code>z: s16</code></td><td><code>r: u8</code></td><td><code>g: u8</code></td></tr>
    <tr><th><code>0x08</code></th><td><code>b: u8</code></td><td><code>a: u8</code></td><td colspan="6">—</td></tr>
  </tbody>
</table>

Compact triangles are `0x10` bytes:

<table class="byte-layout">
  <thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
  <tbody>
    <tr><th><code>0x00</code></th><td><code>flags</code></td><td><code>i0</code></td><td><code>i1</code></td><td><code>i2</code></td><td colspan="2"><code>u0: s16</code></td><td colspan="2"><code>v0: s16</code></td></tr>
    <tr><th><code>0x08</code></th><td colspan="2"><code>u1: s16</code></td><td colspan="2"><code>v1: s16</code></td><td colspan="2"><code>u2: s16</code></td><td colspan="2"><code>v2: s16</code></td></tr>
  </tbody>
</table>

Indices are relative to the active batch's vertex base. Triangle flag `0x40`
enables the back face; flag `0x80` excludes the triangle from collision.
Coordinates and UVs are signed integers and must be preserved during decoding.

### 3.4 Display lists and render state

Verified from decoded ROM members and render-path disassembly, batch records
are `0x10` bytes, followed by one sentinel record:

<table class="byte-layout">
  <thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
  <tbody>
    <tr><th><code>0x00</code></th><td><code>textureIndex: u8</code></td><td><code>drawOverride: s8</code></td><td colspan="2"><code>unknown_02: bytes[2]</code></td><td colspan="2"><code>unknown_04: bytes[2]</code></td><td colspan="2"><code>firstVertex: u16</code></td></tr>
    <tr><th><code>0x08</code></th><td colspan="2"><code>firstTriangle: u16</code></td><td colspan="2"><code>animationState: u16</code></td><td colspan="4"><code>flags: u32</code></td></tr>
  </tbody>
</table>

`textureIndex == 0xFF` means untextured. Counts are obtained by subtracting the
current `firstVertex` and `firstTriangle` from the next record, including the
sentinel for the final batch. Flag `0x00010000` enables texture animation;
`0x00020000..0x00080000` select animation modes. The remaining material flag
semantics require further JFG-specific disassembly.

The graphics task uses Rare F3DJFG. Its task text occupies ROM
`[0x0009FFD0,0x000A0FD0)` and has SHA-1
`d2a94be210974861cf0419856dd8c3ca92ba9186`; its `0x800`-byte data image has
SHA-1 `08ace43b91019665612c894a3b61ca8c1114d232`. The raw text CRC-32 is
`83421788`; 32-bit host-word swapping produces GLideN64's identifier
`BDE9D1FB`.

| Opcode | Length | Operands | Effect |
|---:|---:|---|---|
| `0x01` | 8 | Command-specific matrix fields | Load a matrix through the Rare DMA path. |
| `0x02` | 8 | Command-specific texture/offset fields | Load texture or offset state. |
| `0x04` | 8 | Vertex count and DMA offset | DMA compact 10-byte JFG vertices. |
| `0x05` | 8 | Polygon count and DMA offset | DMA one or more compact triangles. |
| `0x07` | 8 | Command count and DMA offset | DMA a run of display-list commands. |
| `0xBF` | 8 | DMA base offsets | Set custom DMA bases. |

Model files do not store stock F3DEX display lists. The loader walks compact
batches and generates F3DJFG commands. Static tools should decode the arrays
directly.

### 3.5 Textures and materials

Verified from decoded ROM members and texture-loader disassembly, IDs with bit
15 set use `id & 0x7FFF` in assets `0x01/0x00`; IDs without it
use assets `0x03/0x02`. The decoded texture header is `0x20` bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 1 | `u8` | `width` | Pixel width. |
| `0x01` | 1 | `u8` | `height` | Pixel height. |
| `0x02` | 1 | `u8` | `formatFlags` | Low nibble is texel format; high nibble is material flags. |
| `0x03` | 1 | `s8` | `originX` | Source-derived sprite X origin. |
| `0x04` | 1 | `s8` | `originY` | Source-derived sprite Y origin. |
| `0x05` | 1 | `u8` | `runtime_05` | Instance/runtime field. |
| `0x06` | 2 | `u16` | `flags` | `0x40` clamps S; `0x80` clamps T. |
| `0x08` | 2 | `u16` | `referenceCount` | Runtime cache reference count. |
| `0x0A` | 2 | `u16` | `displayListCount` | Generated texture command count. |
| `0x0C` | 4 | pointer | `displayList` | Runtime generated texture display list. |
| `0x10` | 2 | `u16` | `unknown_10` | Unresolved. |
| `0x12` | 2 | `u16` | `frameExtent` | Frame count in the high byte/fixed-point extent. |
| `0x14` | 2 | `u16` | `frameRate` | Animation advance rate. |
| `0x16` | 2 | `s16` | `frameBytes` | Bytes per frame excluding the header. |
| `0x18` | 1 | `u8` | `animationMode` | Wrap/mode flag. |
| `0x19` | 1 | `u8` | `compressed` | Nonzero in an outer header selects RZIP at `+0x20`. |
| `0x1A` | 1 | `u8` | `unknown_1A` | Unresolved. |
| `0x1B` | 1 | `u8` | `mipCount` | Mip level count. |
| `0x1C` | 1 | `u8` | `cms` | RDP S clamp/mirror mode. |
| `0x1D` | 1 | `u8` | `masks` | RDP S mask exponent. |
| `0x1E` | 1 | `u8` | `cmt` | RDP T clamp/mirror mode. |
| `0x1F` | 1 | `u8` | `maskt` | RDP T mask exponent. |

Texture payloads are stored in the word order expected by TMEM, not ordinary
linear row order. Verified from the texture display-list builder, both the
single-level and mipmapped paths load with `dxt = 0`; consequently the RDP does
not perform its usual odd-line swap during the load. On every odd-numbered
image row, RGBA32 exchanges the two eight-byte halves of each 16-byte group.
All other formats exchange the two four-byte halves of each eight-byte group.
Any incomplete group at the end of a row remains unchanged. An extractor must
reverse this involutive transform for each frame and each mip level.

Within one frame, mip images are packed consecutively from largest to smallest
without per-level padding. The complete mip chain is rounded up to 16 bytes;
successive animation frames begin at that aligned span. `frameBytes` contains
this span when populated, while 531 ordinary/2D entries store zero and require
it to be calculated. Exhaustive ROM validation gives
`decodedSize = 0x20 + alignedFrameBytes * frameCount` for all 7,320 textures.

Exhaustive decoded-header counts are:

| Format value | N64 texel format | Textures |
|---:|---|---:|
| `0` | RGBA32 | 640 |
| `1` | RGBA16 | 6,168 |
| `2` | I8 | 21 |
| `3` | I4 | 65 |
| `4` | IA16 | 25 |
| `5` | IA8 | 395 |
| `6` | IA4 | 6 |

No CI texture occurs in either audited pool.

### 3.6 Collision

Verified by model-initialization and collision-query disassembly, collision is
derived from the visible level mesh, not loaded from a separate
asset. For each batch, the game:

1. excludes the whole batch when `(flags & 0x00000880) != 0`;
2. excludes a triangle when `(triangle.flags & 0x80) != 0`;
3. generates a normalized plane `(nx, ny, nz, d)` and three edge-bisector
   planes for every retained triangle;
4. creates masks for overlap with 16 X slices, 16 Z slices, and 8 Y slices of
   the segment bounds.

The stored facet record is eight bytes:

<table class="byte-layout">
  <thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
  <tbody><tr><th><code>0x00</code></th><td colspan="2"><code>trianglePlane: u16</code></td><td colspan="2"><code>edgePlane0: u16</code></td><td colspan="2"><code>edgePlane1: u16</code></td><td colspan="2"><code>edgePlane2: u16</code></td></tr></tbody>
</table>

For visualization, draw the original triangles surviving the two exclusion
tests. Generated planes and masks are query acceleration data, not another
mesh. Batch flag `0x2000` is processed separately and is not a collision
exclusion flag; its exact surface meaning is unknown.

### 3.7 Environment, sky, fog, and lighting

Fog uses level-record near, far, RGB, and mode fields. It is disabled only when
near, far, and all three RGB components are zero.

Two sky paths are verified by disassembly:

- With `skyMode == -1`, the game renders a camera-centered nine-vertex,
  eight-triangle horizontal plane at `cameraY + 192`. Its nominal extent is
  1,280 world units. The level supplies texture, UV scale, and signed scroll
  speeds; outer vertices fade to alpha zero.
- Otherwise, the game creates `skyObjectId` at the origin. The mode controls
  whether the object follows camera translation.

For multiple viewports, the game substitutes an orthographic four-vertex color
gradient using the top and bottom RGB fields. Clear color is stored separately.
Lighting state is primarily expressed by vertex colors and material/render
state; a complete semantic map of all material bits is not established.

### 3.8 Cameras and paths

The signed level-record byte at `+0xAC` is passed to the camera as vertical FOV.
No general fixed camera-path record has been decoded.

Placement record ID 5 is a patrol/path node. All 10,808 such records in the
ROM are exactly `0x0C` bytes:

<table class="byte-layout">
  <thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
  <tbody>
    <tr><th><code>0x00</code></th><td colspan="2"><code>objectId: s16 = 5</code></td><td><code>size: u8 = 12</code></td><td><code>reserved: u8</code></td><td colspan="2"><code>x: s16</code></td><td colspan="2"><code>y: s16</code></td></tr>
    <tr><th><code>0x08</code></th><td colspan="2"><code>z: s16</code></td><td><code>pathId: u8</code></td><td><code>ordinal: u8</code></td><td colspan="4">—</td></tr>
  </tbody>
</table>

The final-byte meanings are strongly supported by grouping and coordinate
continuity. Connect consecutive ordinals in each path, but do not infer
closure or branching. Asset pair `0x41/0x42` contains a separate animation/path
command format: group entries use a group number in the upper byte and a local
offset in the lower 24 bits, terminated by group `0xFF`; its commands remain
undecoded.

| Bits | Mask | Name | Meaning |
|---:|---:|---|---|
| 31–24 | `0xFF000000` | `group` | Animation group number; `0xFF` terminates the index. |
| 23–0 | `0x00FFFFFF` | `offset` | Local offset to the group's command body. |

The level model contains `segmentCount - 1` eight-byte spatial BSP nodes:

<table class="byte-layout">
  <thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
  <tbody><tr><th><code>0x00</code></th><td colspan="2"><code>left: s16</code></td><td colspan="2"><code>right: s16</code></td><td><code>axis: u8</code></td><td><code>segment: u8</code></td><td colspan="2"><code>split: s16</code></td></tr></tbody>
</table>

`-1` denotes a leaf and axes 0, 1, and 2 mean X, Y, and Z. The structure and
traversal are source-derived from the related engine and corroborated by JFG
values; JFG's inclusive boundary convention is not independently verified.

## 4. Objects

### 4.1 Placement records

Verified from all ROM lists and object-loader disassembly, each level selects
two independent ROM lists through fields `+0x56` and
`+0xCA`; both must be loaded. A list begins with a 16-byte header followed by
variable records:

<table class="byte-layout">
  <thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
  <tbody>
    <tr><th><code>0x00</code></th><td colspan="4"><code>recordBytes: u32</code></td><td colspan="4"><code>reserved_04: bytes[4]</code></td></tr>
    <tr><th><code>0x08</code></th><td colspan="8"><code>reserved_08: bytes[8]</code></td></tr>
  </tbody>
</table>

The reserved bytes are zero in sampled lists.

Every record shares this prefix:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | `s16` | `objectId` | Object or special-record ID. |
| `0x02` | 1 | `u8` | `recordSize` | Total record size; next record is `current + recordSize`. |
| `0x03` | 1 | `u8` | `type_03` | Type-specific or reserved; normally zero. |
| `0x04` | 2 | `s16` | `x` | World X, converted directly to `f32`. |
| `0x06` | 2 | `s16` | `y` | World Y, converted directly to `f32`. |
| `0x08` | 2 | `s16` | `z` | World Z, converted directly to `f32`. |
| `0x0A` | Variable | bytes | `payload` | Behavior-specific rotation, scale, links, bounds, and parameters. |

Summed record sizes equal the list header's byte count in every scanned list.
There is no global position scale.

### 4.2 Object and model formats

Verified from ROM tables and object-loader disassembly, the static-model chain
is:

`placement ID` → asset `0x30` definition index → asset `0x2E` definition
offset → asset `0x2F` definition → model-ID list → asset `0x26` model offset →
compressed model in asset `0x27`.

Confirmed definition fields are:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x18` | 2 | `s16` | `scale` | Definition scale used by object setup. |
| `0x1C` | 2 | `s16` | `behaviorId` | Control/behavior number. |
| `0xA6` | 1 | `u8` | `modelCount` | Number of model IDs. |
| `0xA8` | 4 | `u32` | `modelListOffset` | Local offset to `u16` IDs; relocated after load. |
| `0xAC` | 4 | pointer | `modelPointers` | Runtime loaded-model pointer array. |

| Condition | Resource kind |
|---|---|
| `(id & 0xC000) == 0xC000` | Sprite resource. |
| Otherwise, `(id & 0x8000) != 0` | Texture/sprite-like resource. |
| Otherwise | 3D object model in assets `0x26/0x27`. |

Object-model headers are `0x88` bytes. Confirmed fields are:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x10` | char array | `name` | Internal model name; stale tail bytes may follow the terminator. |
| `0x10` | 1 | `u8` | `textureCount` | Texture-info records. |
| `0x11` | 1 | `u8` | `deformationMode` | Animated/deformed-vertex path selector. |
| `0x12` | 2 | `u16` | `vertexCount` | Compact vertices. |
| `0x14` | 2 | `u16` | `triangleCount` | Compact triangles. |
| `0x16` | 2 | `u16` | `batchCount` | Batches excluding sentinel. |
| `0x18` | 4 | `u32` | `textureInfoOffset` | Relocated texture-info array. |
| `0x1C` | 4 | `u32` | `vertexOffset` | Relocated vertex array. |
| `0x20` | 4 | `u32` | `triangleOffset` | Relocated triangle array. |
| `0x24` | 4 | `u32` | `batchOffset` | Relocated batch array. |
| `0x28` | 4 | `u32` | `unknown_28` | Flags or auxiliary value. |
| `0x30` | 4 | `u32` | `offset_30` | Relocated animation/collision-related offset. |
| `0x34` | 4 | `u32` | `offset_34` | Relocated animation/collision-related offset. |
| `0x38` | 4 | `u32` | `offset_38` | Relocated animation/collision-related offset. |
| `0x3C` | 12 | `s16[6]` | `bounds` | Minimum XYZ then maximum XYZ. |
| `0x48` | 4 | `u32` | `decodedSize` | Decoded member size. |
| `0x4C` | 4 | bytes | `signature_4C` | Constant `49 4E 47 00` (`ING\0`). |
| `0x50` | 4 | `u32` | `signature_50` | Constant `0x0A244C46`. |
| `0x64` | 1 | `u8` | `modelFlags` | Animation/model flag; semantics unresolved. |
| `0x68` | 4 | `u32` | `offset_68` | Relocated later-block offset. |
| `0x6C` | 4 | `u32` | `offset_6C` | Relocated later-block offset. |
| `0x78` | 4 | bytes | `signature_78` | Constant `KNEE`. |
| `0x80` | 4 | `u32` | `offset_80` | Often equal to field `+0x30`. |
| `0x84` | 4 | `u32` | `unknown_84` | Possible checksum or table field. |

Object texture-info records are eight bytes:

<table class="byte-layout">
  <thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
  <tbody><tr><th><code>0x00</code></th><td colspan="4"><code>texture: pointer</code></td><td><code>width: u8</code></td><td><code>height: u8</code></td><td colspan="2"><code>textureId: s16</code></td></tr></tbody>
</table>

The pointer is zero in ROM and filled at load time. Object meshes reuse the
compact vertex, triangle, and batch encodings.

### 4.3 Skeletons and animation

Object headers relocate several animation-related blocks and select a
deformed-vertex path with byte `+0x11`. The exact skeleton, animation key, and
skin/deformation layouts are not yet decoded. Static base meshes are usable
without them; animated characters are not.

### 4.4 Behaviors, triggers, and scripted objects

Placement payloads are behavior-specific. The common prefix is sufficient for
markers and patrol paths, but not for universal rotations, scales, trigger
bounds, or links. Many behaviors select or spawn models in code and advertise
no direct model list. Such objects must remain labeled markers until their
individual behavior setup is decoded. The separate asset `0x42` animation
command stream also remains unresolved.

## 5. Audio

### 5.1 Audio storage and banks

Verified from ROM tables and audio-loader disassembly, asset `0x33` partitions
asset `0x34` into the following spans:

| Asset `0x34` relative range | Absolute ROM range | Contents |
|---|---|---|
| `[0x000000,0x012960)` | `[0x01747920,0x0175A280)` | Music `ALBankFile` control data |
| `[0x012960,0x2B1220)` | `[0x0175A280,0x019F8B40)` | Music sample table |
| `[0x2B1220,0x2BF888)` | `[0x019F8B40,0x01A071A8)` | Sound-effect `ALBankFile` control data |
| `[0x2BF888,0x626568)` | `[0x01A071A8,0x01D6DE88)` | Sound-effect sample table |
| `[0x626568,0x6AA858)` | `[0x01D6DE88,0x01DF2178)` | `S1` compressed-sequence archive |
| `[0x6AA858,0x6AA96C)` | `[0x01DF2178,0x01DF228C)` | Three-byte music configuration rows |
| `[0x6AA96C,0x6AC26C)` | `[0x01DF228C,0x01DF3B8C)` | 640 ten-byte sound-effect configuration rows |
| `[0x6AC26C,0x6AC338)` | `[0x01DF3B8C,0x01DF3C58)` | Six audio/reverb parameter sets |
| `[0x6AC338,0x6AC340)` | `[0x01DF3C58,0x01DF3C60)` | Padding |

The music bank declares 22,050 Hz and contains one bank, 159 present
instruments, 387 referenced waves, and no percussion pointer. The sound-effect
bank declares 44,100 Hz and contains one instrument with 434 sounds/waves.

### 5.2 Sequence format and driver

Verified by sequence-player disassembly and independent parsing, the software
driver is Rare-modified Nintendo `n_audio`. Music uses
`n_alCSPlayer` compressed MIDI with 32 voices, 200 events, and 16 MIDI
channels. The game requests 22,020 Hz; NTSC clock division produces an
effective 22,018 Hz output rate.

The `S1` archive has this variable-length layout:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | char array | `magic` | ASCII `S1`. |
| `0x02` | 2 | `u16` | `sequenceCount` | `0x005A` (90). |
| `0x04 + 8*i` | 4 | `u32` | `offset[i]` | Sequence offset relative to archive start. |
| `0x08 + 8*i` | 4 | `u32` | `size[i]` | Stored sequence size. |

All 90 entries parse as standard ALCSeq data with division 384. Relevant stream
tokens are:

| Opcode | Length | Operands | Effect |
|---:|---:|---|---|
| `0xFE` | 4 | `hi`, `lo`, `length` | Copy `length` bytes from the prior-stream displacement encoded by `hi:lo`. |
| `0xFE 0xFE` | 2 | — | Emit one literal `0xFE`. |
| `0xFF 0x2D` | 8 | `count`, `current`, `back: u32` | End a track loop; `current == 0xFF` repeats indefinitely. |

Sequence zero is a silent loop used as the no-music value. IDs `0x01..0x59`
are selectable; 53 contain at least one infinite per-track loop and 36
terminate.

The three-byte music configuration record is:

<table class="byte-layout">
  <thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
  <tbody><tr><th><code>0x00</code></th><td><code>volume: u8</code></td><td><code>tempoAdjust: u8</code></td><td><code>reverb: u8</code></td><td colspan="5">—</td></tr></tbody>
</table>

The player receives `volume << 8`. Reachable tempo values are zero, so sequence
tempo events apply without table scaling; reverb is one for every reachable
entry. The table holds 92 rows, but archive bounds reject ID `0x5A`; its
otherwise populated configuration row is unreachable.

### 5.3 Instruments and sample encoding

Verified from ROM bank traversal and audio setup disassembly, both banks use
standard Nintendo `ALBankFile` pointer structures. Every music
wave is Nintendo VADPCM; 156 of 387 waves have loop records. Every sound-effect
wave is also Nintendo VADPCM; 45 of 434 are looped.

The audio RSP task uses text at ROM `[0x0009E610,0x0009F610)`, SHA-1
`081cf2e3a5c02186cd52cafd7c52fb4908d78b92`, and data at
`[0x000B0810,0x000B1010)`, SHA-1
`c51e052d86a8f8fbe1a51e22db4b2c71869a9eb1`. It is the Nintendo
`n_audio`/`n_aspMain` family, but a finer revision is not established.

The driver retains Rare extensions for surround, low-pass filtering,
distortion, and custom reverb. Those affect exact wet playback but not sequence
or bank parsing.

### 5.4 Music catalog and loop points

Verified from ROM sequence/configuration tables and level records, the ROM
contains no cue-title table; the frontend label is `MUSIC TEST %02d`.
Appendix B lists every selectable ID, stored size, configured volume, loop
classification, first-pass duration, and level association. Associations come
from level-record field `+0x72`; a blank association does not prove that direct
code never plays the cue.

Loops are attached independently to sequence tracks, so many cues do not have
one cue-level loop point. Appendix B therefore reports loop classification and
the duration through the first complete loop region.

Nine selectable IDs (`06`, `08`, `09`, `0A`, `1C`, `22`, `24`, `28`, and
`2D`) duplicate the sequence-zero silent payload. IDs `07/3A` and `10/3B` are
two further byte-identical pairs. The 89 selectable IDs therefore contain 79
distinct payloads.

## 6. Unused and hidden content

### 6.1 Unreferenced assets

Numeric unreferenced status has not been proven. Level IDs occur in packed
overlay and gameplay structures, so raw whole-ROM integer searches cannot
establish reachability. The bounded object-name area contains `WindowTest` at
ROM `0x0173E69C`; its reachability is unknown.

### 6.2 Cut or inaccessible levels

Two fixed level names and one level-name/metadata pair explicitly state `NOT
USED`:

| Index | Category | Internal ROM name |
|---:|---|---|
| 83 | `RITH_ESSA_Canyon` | `Canyon Exit Main NOT USED` |
| 105 | `AlienCave` | `AlienCave Two NOT USED` |
| 116 | `RITH_ESSA_Canyon` | `Canyon JetPac Mountain Test NOT` |

Index 116's fixed 32-byte name ends after `NOT`; its parallel metadata entry in
asset `0x21` completes the phrase as `NOT USED`.

Category `Old` contains Alpha Sewer indices 68, 71, and 73, and the frontend
contains index 79 `Old Character Select`. These are obsolete-content
candidates, but their names do not prove inaccessibility.

Category `BaddyTest` contains indices 175–178 and 273: `Tribal family`, `Ant
types`, `Big baddies`, `Galaxians`, and `Others`. Other test-named records are
33, 109–111, 117, 137, and 140. Some multiplayer records retain development
`Test` names and may be shipped content; they are not classified as unused.
Index 202 retains the development-lineage name `DKR Track`; the name alone does
not establish its retail reachability. Index 309 `Happy Tribal Seq1` uniquely
has category byte `0xFF`, but that anomaly alone does not show non-use.

### 6.3 Debug features

The executable retains a 14-input debug-toggle sequence:

`C-Left, C-Right, C-Up, C-Down, R, L, L, R, C-Up, R, C-Down, R, L, C-Right`.

Verified by disassembly, the comparison routine toggles a debug-enable word,
and the main frame path displays debug information when that word is nonzero.
No direct resident call to the toggle routine was found; overlay or indirect
accessibility remains unproven.

The retail ROM also retains compiled CPU fault pages, SP/DP hang reports,
display-list and RSP task decoders, allocator diagnostics, level/position crash
context, and named cheat/editor symbols including all-level, invulnerability,
all-weapons, and mantis editor functionality. Presence of a symbol does not by
itself establish a reachable retail menu.

### 6.4 Prototype or revision-specific content

The ROM retains build string `1.1848`, timestamp `04/09/99 20:40`, the tag
`jpegg`, source paths including `track/track.c`, `main/main.c`, and
`front/front.c`, and a 2,371-name symbol package. These are developer leftovers,
not player-visible filenames. No prototype ROM or alternate retail revision was
compared.

## 7. nviewer implementation

### 7.1 Module mapping

Implementation modules are:

| Module | Responsibility |
|---|---|
| `src/rom/jet_force_gemini/fs.ts` | ROM validation, top-level and secondary archive tables, Rare DKR wrapper |
| `src/rom/jet_force_gemini/texture.ts` | 2D/3D texture pools, seven texel formats, wrapping and static base images |
| `src/rom/jet_force_gemini/geometry.ts` | Level and direct object-model meshes, compact batches and collision |
| `src/rom/jet_force_gemini/objects.ts` | Both placement lists, direct models, unresolved markers and ID-5 patrol paths |
| `src/rom/jet_force_gemini/level.ts` | Level records, environments, skies, layer assembly and bounds |
| `src/rom/jet_force_gemini/music.ts` | `ALBankFile`, `S1` archive, music configuration, catalog |
| `src/rom/jet_force_gemini/jet_force_gemini.ts` | Game adapter and level/music entry points |

### 7.2 Supported features

The viewer implements:

- all 412 level records, with shared model IDs preserved;
- every static level segment and compact batch;
- all audited texture formats and address modes, using each texture's static
  base image while retaining mip/frame metadata for diagnostics;
- collision derived from render triangles and placed in a hidden-by-default
  `collision` layer;
- both ROM lists, common-prefix object markers, direct static object models,
  and ID-5 patrol paths;
- directly resolvable sky objects or scrolling planes, fog, and clear/gradient
  colors; records without a resolved authored eye/target use viewer framing;
- sequence IDs `0x01..0x59` through the shared bank, CSeq, and synthesizer path.

### 7.3 Approximations and omissions

Static drawing renders every segment without the visibility BSP. Music
playback is dry and structurally correct, but it does not reproduce
Rare's reverb, surround, low-pass, or distortion paths. Object behavior-specific
transforms, behavior-selected models, skeletal deformation, animation commands,
exact material-bit semantics, and non-patrol path commands remain omissions.

## 8. Verification and remaining work

### 8.1 Verification evidence

| Area | Method | Result |
|---|---|---|
| ROM and archive | Direct ROM-byte parsing | Header identity, 71 sections, secondary tables, counts, and ranges reproduced. |
| Compression | ROM bytes, MIPS disassembly, independent raw-DEFLATE inflation | All 8,517 indexed wrappers decode to declared size; marker and padding invariants hold. |
| Level mapping | Disassembly and RAM comparison | Record `0x15D` and its relocated level/track pointers match the ROM-derived mapping. |
| Geometry and textures | ROM bytes and loader/render disassembly | Headers, strides, relocation fields, counts, compact primitives, texture formats, and address modes established. |
| Graphics microcode | Task construction, command disassembly, and GLideN64 identification | F3DJFG code/data ranges and command family established. |
| Collision | Track initialization and resident query disassembly | Inclusion filters, facet indices, generated planes, and slice masks established. |
| Placements and paths | Exhaustive ROM-list scan and object-loader disassembly | Both-list selection, common record prefix, exact record stepping, 10,808 ID-5 nodes, and direct model chain established. |
| Audio | ROM pointer walk, disassembly, and shared-parser compatibility | Both banks, all 90 sequences, configurations, loops, rates, and catalog established. |
| Runtime | Emulator frame and RDRAM capture | Current level record and relocated level-model allocation correlated to ROM. |
| Unused content | Bounded ROM table and string audit | Complete 412-record catalog and confidence-separated leftover candidates established. |

### 8.2 Known unknowns

- Material meanings for most level batch flag bits and fields `+0x02/+0x04`.
- Exact meaning of level-model auxiliary table `+0x0C` and batch flag `0x2000`.
- JFG-specific BSP boundary convention.
- Behavior-specific placement payloads, transforms, links, and trigger volumes.
- Object skeleton, animation, and deformation formats.
- Commands in asset `0x42` and patrol-path branching/closure rules.
- Semantic names for music cues not associated with a level record.
- Field-by-field meanings of the six audio/reverb parameter sets.
- Exact Nintendo SDK revision of the audio microcode.
- Alternate-region or cartridge-revision differences.

### 8.3 References

- [Jet Force Gemini matching decompilation, pinned revision](https://github.com/Ryan-Myers/Jet-Force-Gemini/tree/efd5abb1c79636e297b831f7c2d5bf47eac39c0c) — source-derived symbol names and related-engine structure leads.
- [Diddy Kong Racing matching decompilation, pinned revision](https://github.com/DavidSM64/Diddy-Kong-Racing/tree/84f0ea569b07903ba8a4f9f252e8dc8e4ba54bdc) — source-derived BSP interpretation and wrapper-writer comparison.
- [GLideN64](https://github.com/gonetz/GLideN64) — F3DJFG microcode identification and command-family documentation.
- [RFC 1951](https://www.rfc-editor.org/rfc/rfc1951) — DEFLATE bitstream specification.
- [Raw DEFLATE and Rare wrappers](compression/raw-deflate.md) — shared codec and wrapper reference.

## Appendix A. Internal level records

The US ROM stores 412 loadable level records in asset section `0x1F`; each
record begins with a 32-byte internal name and carries a world/category byte
whose labels are stored in asset section `0x23`. The index, category, and name
below are therefore verified directly from ROM bytes. A parallel per-level
metadata table in sections `0x20` and `0x21` supplies additional build
parameters but is not reproduced here.

| Index | World/category | Internal ROM name |
|---:|---|---|
| `0x000` (0) | `FrontEnd` | `xxFront End` |
| `0x001` (1) | `FrontEnd` | `xxFront End2` |
| `0x002` (2) | `CERULEAN_Dune` | `Dune Holding Room2` |
| `0x003` (3) | `SPAWNSHIP_CargoSewer` | `CargoShip Sewer1` |
| `0x004` (4) | `SEKHMET_BATTLESHIP_AlphaSewer` | `AlphaSewer northeast` |
| `0x005` (5) | `SEKHMET_BATTLESHIP_AlphaSewer` | `AlphaSewer easttop` |
| `0x006` (6) | `WALKWAY` | `L demo Sewer` |
| `0x007` (7) | `SEKHMET_BATTLESHIP_AlphaSewer` | `AlphaSewer eastpit` |
| `0x008` (8) | `SEKHMET_BATTLESHIP_AlphaSewer` | `AlphaSewer back` |
| `0x009` (9) | `SPACESTATION` | `S demo Sewer One` |
| `0x00A` (10) | `SEKHMET_BATTLESHIP_AlphaSewer` | `AlphaSewer side` |
| `0x00B` (11) | `SEKHMET_BATTLESHIP_AlphaSewer` | `alphasewerinnerback` |
| `0x00C` (12) | `WALKWAY` | `L demo Temple` |
| `0x00D` (13) | `WALKWAY` | `S Demo Lift` |
| `0x00E` (14) | `CERULEAN_Dune` | `Dune Holding Room1` |
| `0x00F` (15) | `WALKWAY` | `Lee Walkway Sequence` |
| `0x010` (16) | `GOLDWOOD_Forest` | `Cave 1` |
| `0x011` (17) | `GOLDWOOD_Forest` | `Forest Sequence Start` |
| `0x012` (18) | `ICHOR_MILITARY_BASE` | `MilitaryBase Take Off Pad ` |
| `0x013` (19) | `ICHOR_MILITARY_BASE` | `MilitaryBase Holding Room` |
| `0x014` (20) | `GOLDWOOD_Forest` | `Forest Night Sequence` |
| `0x015` (21) | `GOLDWOOD_Forest` | `Forest First` |
| `0x016` (22) | `WALKWAY` | `Lee Walkway` |
| `0x017` (23) | `AlienCave` | `Alien Cave` |
| `0x018` (24) | `GOLDWOOD_Forest` | `Forest Edge` |
| `0x019` (25) | `GOLDWOOD_Forest` | `Forest Clearing` |
| `0x01A` (26) | `GOLDWOOD_Forest` | `Forest Bridge` |
| `0x01B` (27) | `GOLDWOOD_Forest` | `Forest Hide` |
| `0x01C` (28) | `Asteroid` | `ast_Cave` |
| `0x01D` (29) | `RITH_ESSA_Canyon` | `Canyon Lobby1` |
| `0x01E` (30) | `RITH_ESSA_Canyon` | `Canyon Slope1` |
| `0x01F` (31) | `RITH_ESSA_Canyon` | `Canyon Spiral1` |
| `0x020` (32) | `RITH_ESSA_Canyon` | `New Canyon Maze` |
| `0x021` (33) | `General` | `Character Test` |
| `0x022` (34) | `WALKWAY` | `Temple Lift Up` |
| `0x023` (35) | `SS_ANUBIS_CargoShip` | `CargoShip Dock` |
| `0x024` (36) | `GOLDWOOD_Quarry` | `Forest Hut Interior` |
| `0x025` (37) | `SS_ANUBIS_CargoShip` | `CargoShip Hold` |
| `0x026` (38) | `SS_ANUBIS_CargoShip` | `CargoShip Hold Top Bit` |
| `0x027` (39) | `SS_ANUBIS_CargoShip` | `CargoShip MovingRopes` |
| `0x028` (40) | `SS_ANUBIS_CargoShip` | `CargoShip Cylinders` |
| `0x029` (41) | `ICHOR_MILITARY_BASE` | `Military Base Doggy Surf` |
| `0x02A` (42) | `ICHOR_MILITARY_BASE` | `MilitaryBase First Compartment` |
| `0x02B` (43) | `ICHOR_MILITARY_BASE` | `MilitaryBase Approach` |
| `0x02C` (44) | `ICHOR_MILITARY_BASE` | `MilitaryBase Pyxis Room` |
| `0x02D` (45) | `General` | `BigShip Sequence` |
| `0x02E` (46) | `SEKHMET_BATTLESHIP_AlphaSewer` | `AlphaSewer Take-Off` |
| `0x02F` (47) | `GOLDWOOD_Forest` | `Forest Village` |
| `0x030` (48) | `GOLDWOOD_Forest` | `Forest VillageHall Interior` |
| `0x031` (49) | `ICHOR_MILITARY_BASE` | `MilitaryBase Disco Outside` |
| `0x032` (50) | `SEKHMET_BATTLESHIP_AlphaSewer` | `AlphaSewer Back Tube` |
| `0x033` (51) | `SEKHMET_BATTLESHIP_AlphaSewer` | `AlphaSewer Passage UP` |
| `0x034` (52) | `SEKHMET_BATTLESHIP_AlphaSewer` | `AlphaSewer Outside` |
| `0x035` (53) | `CERULEAN_Dune` | `Dune` |
| `0x036` (54) | `GOLDWOOD_Forest` | `Forest Clear` |
| `0x037` (55) | `SPAWNSHIP_CargoSewer` | `CargoSewer Cross` |
| `0x038` (56) | `RITH_ESSA_Canyon` | `Canyon Spiral2` |
| `0x039` (57) | `SPAWNSHIP_CargoSewer` | `CargoSewer Moving Platforms` |
| `0x03A` (58) | `SPAWNSHIP_CargoSewer` | `CargoSewer Grid` |
| `0x03B` (59) | `SPAWNSHIP_CargoSewer` | `CargoSewer Key` |
| `0x03C` (60) | `SPAWNSHIP_CargoSewer` | `CargoSewer Hall` |
| `0x03D` (61) | `SPAWNSHIP_CargoSewer` | `CargoSewer Lobby` |
| `0x03E` (62) | `SPAWNSHIP_CargoSewer` | `CargoSewer End` |
| `0x03F` (63) | `SPAWNSHIP_CargoSewer` | `CargoSewer Generator room` |
| `0x040` (64) | `SPAWNSHIP_CargoSewer` | `CargoSewer Under` |
| `0x041` (65) | `RITH_ESSA_Canyon` | `Canyon Cave` |
| `0x042` (66) | `SEKHMET_BATTLESHIP_AlphaSewer` | `AlphaSewer MainLanding Sequence` |
| `0x043` (67) | `SEKHMET_BATTLESHIP_AlphaSewer` | `AlphaSewer Lobby START` |
| `0x044` (68) | `Old` | `AlphaSewer northhwest` |
| `0x045` (69) | `SEKHMET_BATTLESHIP_AlphaSewer` | `AlphaSewer West side` |
| `0x046` (70) | `SEKHMET_BATTLESHIP_AlphaSewer` | `AlphaSewer Westpit` |
| `0x047` (71) | `Old` | `AlphaSewer Westtop` |
| `0x048` (72) | `SPAWNSHIP_CargoSewer` | `Cargosewer Landing Pad` |
| `0x049` (73) | `Old` | `AlphaSewer Map` |
| `0x04A` (74) | `SEKHMET_BATTLESHIP_AlphaSewer` | `AlphaSewer Stairs` |
| `0x04B` (75) | `SPAWNSHIP_CargoSewer` | `CargoSewer Lobby SecretBit` |
| `0x04C` (76) | `SPAWNSHIP_CargoSewer` | `CargoSewer Secret Pad` |
| `0x04D` (77) | `SPAWNSHIP_CargoSewer` | `CargoSewer Electric` |
| `0x04E` (78) | `SPAWNSHIP_CargoSewer` | `CargoSewer EndBit` |
| `0x04F` (79) | `FrontEnd` | `Old Character Select` |
| `0x050` (80) | `RITH_ESSA_Canyon` | `Canyon Tunnel` |
| `0x051` (81) | `RITH_ESSA_Canyon` | `Canyon_Exit1` |
| `0x052` (82) | `RITH_ESSA_Canyon` | `Canyon Takeoff` |
| `0x053` (83) | `RITH_ESSA_Canyon` | `Canyon Exit Main NOT USED` |
| `0x054` (84) | `SS_ANUBIS_CargoShip` | `CargoShip Exterior` |
| `0x055` (85) | `GOLDWOOD_Forest` | `Forest Boss` |
| `0x056` (86) | `SS_ANUBIS_CargoShip` | `CargoShip Maze` |
| `0x057` (87) | `GOLDWOOD_Forest` | `Cave Edge` |
| `0x058` (88) | `SEKHMET_BATTLESHIP_AlphaSewer` | `AlphaSewer Leaving Ship Sequenc` |
| `0x059` (89) | `SEKHMET_BATTLESHIP_AlphaSewer` | `AlphaSewer Channel` |
| `0x05A` (90) | `General` | `Dune Top Down` |
| `0x05B` (91) | `SEKHMET_BATTLESHIP_AlphaSewer` | `AlphaSewer Platforms` |
| `0x05C` (92) | `GOLDWOOD_Forest` | `Forest Day Landing` |
| `0x05D` (93) | `GOLDWOOD_Forest` | `Forest Day Sequence` |
| `0x05E` (94) | `SEKHMET_BATTLESHIP_AlphaSewer` | `AlphaSewer Take-Off -Back Tube` |
| `0x05F` (95) | `GOLDWOOD_Forest` | `Cave Exit` |
| `0x060` (96) | `GOLDWOOD_Forest` | `Forest Day Last` |
| `0x061` (97) | `GOLDWOOD_Forest` | `Forest Day Last Sequence` |
| `0x062` (98) | `GOLDWOOD_Forest` | `Cave Exit seq` |
| `0x063` (99) | `SEKHMET_BATTLESHIP_AlphaSewer` | `AlphaSewer Outside seq- Top Exi` |
| `0x064` (100) | `SPAWNSHIP_CargoSewer` | `big_cargo_ships` |
| `0x065` (101) | `SS_ANUBIS_CargoShip` | `CargoShip Landing Seq` |
| `0x066` (102) | `SS_ANUBIS_CargoShip` | `CargoShip Dock Seq` |
| `0x067` (103) | `SEKHMET_BATTLESHIP_AlphaSewer` | `AlphaSewer Back Outside` |
| `0x068` (104) | `SPACESTATION` | `SteveSewer Two` |
| `0x069` (105) | `AlienCave` | `AlienCave Two NOT USED` |
| `0x06A` (106) | `GOLDWOOD_Forest` | `Forest Tunnel` |
| `0x06B` (107) | `SPAWNSHIP_CargoSewer` | `CargoSewer Cave` |
| `0x06C` (108) | `General` | `B Man` |
| `0x06D` (109) | `Multi` | `Sewer Test` |
| `0x06E` (110) | `Multi` | `CargoShip Test` |
| `0x06F` (111) | `Multi` | `Dune Test` |
| `0x070` (112) | `RITH_ESSA_Canyon` | `Canyon JetPac` |
| `0x071` (113) | `CERULEAN_Dune` | `Termite Mounds` |
| `0x072` (114) | `CERULEAN_Dune` | `Termite Colony` |
| `0x073` (115) | `TAWFRET_Swamp` | `Swamp` |
| `0x074` (116) | `RITH_ESSA_Canyon` | `Canyon JetPac Mountain Test NOT` |
| `0x075` (117) | `Multi` | `Canyon JetPac Multi Test` |
| `0x076` (118) | `TAWFRET_Swamp` | `Swamp bog` |
| `0x077` (119) | `ICHOR_MILITARY_BASE` | `Military Base Mine` |
| `0x078` (120) | `AlienCave` | `Alien Cave Pyxis` |
| `0x079` (121) | `TAWFRET_Swamp` | `Swamp Creek` |
| `0x07A` (122) | `GOLDWOOD_Forest` | `Fish Farm` |
| `0x07B` (123) | `SS_ANUBIS_CargoShip` | `CargoShip JetPac` |
| `0x07C` (124) | `SS_ANUBIS_CargoShip` | `CargoShip JetPac Outside` |
| `0x07D` (125) | `TAWFRET_Swamp` | `Swamp track` |
| `0x07E` (126) | `GOLDWOOD_Forest` | `Forest Maze N` |
| `0x07F` (127) | `FrontEnd` | `Character Select` |
| `0x080` (128) | `SS_ANUBIS_CargoShip` | `CargoShip JetPac Tube` |
| `0x081` (129) | `SS_ANUBIS_CargoShip` | `CargoShip Steps` |
| `0x082` (130) | `SS_ANUBIS_CargoShip` | `CargoShip Hidden Link` |
| `0x083` (131) | `SS_ANUBIS_CargoShip` | `CargoShip Pyxis` |
| `0x084` (132) | `TAWFRET_Swamp` | `Swamp_Ruin` |
| `0x085` (133) | `TAWFRET_Swamp` | `Swamp_hut` |
| `0x086` (134) | `SS_ANUBIS_CargoShip` | `CargoShip Step Out` |
| `0x087` (135) | `TAWFRET_Swamp` | `Swamp Landing` |
| `0x088` (136) | `TAWFRET_Swamp` | `Swamp TakeOff` |
| `0x089` (137) | `Multi` | `Termite Multi Test` |
| `0x08A` (138) | `TAWFRET_Swamp` | `Swamp Maze` |
| `0x08B` (139) | `ICHOR_MILITARY_BASE` | `MilitaryBase Tunnel Link2` |
| `0x08C` (140) | `General` | `Worldmap Test` |
| `0x08D` (141) | `Mizar` | `Mizar Boss` |
| `0x08E` (142) | `AlienCave` | `Alien under water` |
| `0x08F` (143) | `ICHOR_MILITARY_BASE` | `MilitaryBase Poles` |
| `0x090` (144) | `Multi` | `sewer multi` |
| `0x091` (145) | `Multi` | `swm multi` |
| `0x092` (146) | `ICHOR_MILITARY_BASE` | `MilitaryBase BigBoy FunClub` |
| `0x093` (147) | `TAWFRET_Swamp` | `Swamp CircularHut1` |
| `0x094` (148) | `AlienCave` | `Alien pipes` |
| `0x095` (149) | `TAWFRET_Swamp` | `Swamp TownHall` |
| `0x096` (150) | `TAWFRET_Swamp` | `Swamp Catacombs` |
| `0x097` (151) | `ICHOR_MILITARY_BASE` | `MilitaryBase Surf` |
| `0x098` (152) | `SS_ANUBIS_CargoShip` | `CargoShip Pickup 1` |
| `0x099` (153) | `ICHOR_MILITARY_BASE` | `MilitaryBase Puzzle` |
| `0x09A` (154) | `SS_ANUBIS_CargoShip` | `CargoShip Bears` |
| `0x09B` (155) | `Mizar` | `MizarPalace Entrance` |
| `0x09C` (156) | `SS_ANUBIS_CargoShip` | `CargoShip Takeoff` |
| `0x09D` (157) | `GOLDWOOD_Forest` | `Other Forest Clearing` |
| `0x09E` (158) | `TAWFRET_Swamp` | `Swamp Landing Play` |
| `0x09F` (159) | `GOLDWOOD_Forest` | `Cave Floyd` |
| `0x0A0` (160) | `Multi` | `Cooperative SwampMaze` |
| `0x0A1` (161) | `FrontEnd` | `Multi Player Character Select` |
| `0x0A2` (162) | `SEKHMET_BATTLESHIP_AlphaSewer` | `AlphaSewer Boss` |
| `0x0A3` (163) | `SEKHMET_BATTLESHIP_AlphaSewer` | `seq part2` |
| `0x0A4` (164) | `SEKHMET_BATTLESHIP_AlphaSewer` | `seq part1` |
| `0x0A5` (165) | `SEKHMET_BATTLESHIP_AlphaSewer` | `seq part3` |
| `0x0A6` (166) | `SEKHMET_BATTLESHIP_AlphaSewer` | `seq part4` |
| `0x0A7` (167) | `RITH_ESSA_Canyon` | `Canyon Cliff` |
| `0x0A8` (168) | `GOLDWOOD_Forest` | `Forest Small Cave` |
| `0x0A9` (169) | `GOLDWOOD_Forest` | `Forest Cave Hut` |
| `0x0AA` (170) | `SEKHMET_BATTLESHIP_AlphaSewer` | `Jet Pack` |
| `0x0AB` (171) | `RITH_ESSA_Canyon` | `Canyon Clear` |
| `0x0AC` (172) | `RITH_ESSA_Canyon` | `Canyon Mine Entrance` |
| `0x0AD` (173) | `RITH_ESSA_Canyon` | `Canyon Mine Cabin` |
| `0x0AE` (174) | `RITH_ESSA_Canyon` | `Canyon Kennel` |
| `0x0AF` (175) | `BaddyTest` | `Tribal family` |
| `0x0B0` (176) | `BaddyTest` | `Ant types` |
| `0x0B1` (177) | `BaddyTest` | `Big baddies` |
| `0x0B2` (178) | `BaddyTest` | `Galaxians` |
| `0x0B3` (179) | `RITH_ESSA_Canyon` | `Mine Cave Entrance` |
| `0x0B4` (180) | `Mizar` | `MizarHall` |
| `0x0B5` (181) | `ICHOR_MILITARY_BASE` | `SlugBoss Tunnel` |
| `0x0B6` (182) | `RITH_ESSA_Canyon` | `Mine Lift` |
| `0x0B7` (183) | `AlienCave` | `Alien Throat` |
| `0x0B8` (184) | `AlienCave` | `Alien Thorax` |
| `0x0B9` (185) | `ICHOR_MILITARY_BASE` | `MilitaryBase Push` |
| `0x0BA` (186) | `RITH_ESSA_Canyon` | `Mine Bridges` |
| `0x0BB` (187) | `ICHOR_MILITARY_BASE` | `MilitaryBase Perim` |
| `0x0BC` (188) | `AlienCave` | `Alien Outside` |
| `0x0BD` (189) | `AlienCave` | `Alien Chest` |
| `0x0BE` (190) | `AlienCave` | `Alien Shell` |
| `0x0BF` (191) | `AlienCave` | `Alien BRIDGE` |
| `0x0C0` (192) | `Mizar` | `Mizar Big Room Left` |
| `0x0C1` (193) | `TAWFRET_Swamp` | `Swamp Boss Intro` |
| `0x0C2` (194) | `TAWFRET_Swamp` | `Swamp Boss Play` |
| `0x0C3` (195) | `TAWFRET_Swamp` | `Swamp Boss Fight` |
| `0x0C4` (196) | `RITH_ESSA_Canyon` | `Mine Maze` |
| `0x0C5` (197) | `Multi` | `Canyon Multi` |
| `0x0C6` (198) | `AlienCave` | `Alien Entrance` |
| `0x0C7` (199) | `GOLDWOOD_Forest` | `Forest Intro` |
| `0x0C8` (200) | `Multi` | `Canyon Trench` |
| `0x0C9` (201) | `Mizar` | `Mizar Tunnels` |
| `0x0CA` (202) | `SUBWORLDS` | `DKR Track` |
| `0x0CB` (203) | `AlienCave` | `Alien Gut` |
| `0x0CC` (204) | `AlienCave` | `Alien right_intesten` |
| `0x0CD` (205) | `AlienCave` | `Alien left_intesten` |
| `0x0CE` (206) | `AlienCave` | `Cranial Capers` |
| `0x0CF` (207) | `Mizar` | `Central Sequence Boy` |
| `0x0D0` (208) | `RITH_ESSA_Canyon` | `Mine Exits` |
| `0x0D1` (209) | `RITH_ESSA_Canyon` | `Mine JoinT1` |
| `0x0D2` (210) | `AlienCave` | `Alien Boss` |
| `0x0D3` (211) | `GOLDWOOD_Forest` | `Forest Maze S` |
| `0x0D4` (212) | `Mizar` | `Meet Mizar` |
| `0x0D5` (213) | `Mizar` | `Mizar Side Room` |
| `0x0D6` (214) | `AlienCave` | `Alien Cerebral` |
| `0x0D7` (215) | `GOLDWOOD_Forest` | `Forest Dark Edge` |
| `0x0D8` (216) | `AlienCave` | `Alien Landing` |
| `0x0D9` (217) | `TAWFRET_Swamp` | `Swamp Undertree` |
| `0x0DA` (218) | `GOLDWOOD_Forest` | `Hidden Cave` |
| `0x0DB` (219) | `GOLDWOOD_Forest` | `Forest Edge Clear` |
| `0x0DC` (220) | `Asteroid` | `ast_Canyon` |
| `0x0DD` (221) | `Multi` | `Mine Multi1` |
| `0x0DE` (222) | `Mizar` | `Mizar Girl Tunnels` |
| `0x0DF` (223) | `Mizar` | `Mizar Abyss Room` |
| `0x0E0` (224) | `Asteroid` | `ast_Lobby` |
| `0x0E1` (225) | `Asteroid` | `Ice Maze` |
| `0x0E2` (226) | `Asteroid` | `ast_back` |
| `0x0E3` (227) | `GOLDWOOD_Forest` | `Cave Edge2` |
| `0x0E4` (228) | `GOLDWOOD_Forest` | `Cave Exit2` |
| `0x0E5` (229) | `WATERRUIN` | `Water Ruin` |
| `0x0E6` (230) | `ICHOR_MILITARY_BASE` | `SlugBoss Tunnel Sequence` |
| `0x0E7` (231) | `TAWFRET_Swamp` | `Swamp Bigtree` |
| `0x0E8` (232) | `Mizar` | `Mizar Boy Lobby` |
| `0x0E9` (233) | `Asteroid` | `Asteroid Mizar` |
| `0x0EA` (234) | `Mizar` | `Girl Waterfall` |
| `0x0EB` (235) | `TAWFRET_Swamp` | `Swamp Creekseq` |
| `0x0EC` (236) | `GOLDWOOD_Forest` | `Forest Hide End` |
| `0x0ED` (237) | `GOLDWOOD_Forest` | `Hidden Gun Cave` |
| `0x0EE` (238) | `SS_ANUBIS_CargoShip` | `CargoShip Chase1 Seq` |
| `0x0EF` (239) | `SS_ANUBIS_CargoShip` | `CargoShip Chase2 Seq` |
| `0x0F0` (240) | `SS_ANUBIS_CargoShip` | `CargoShip Brig Seq` |
| `0x0F1` (241) | `SS_ANUBIS_CargoShip` | `CargoShip Brig` |
| `0x0F2` (242) | `TAWFRET_Swamp` | `Swamp Grave Yard` |
| `0x0F3` (243) | `Mizar` | `DogChasm` |
| `0x0F4` (244) | `TAWFRET_Swamp` | `Swamp Crypt` |
| `0x0F5` (245) | `Mizar` | `Transformer` |
| `0x0F6` (246) | `WATERRUIN` | `Water Ruin Under` |
| `0x0F7` (247) | `TAWFRET_Swamp` | `Swamp Tomb` |
| `0x0F8` (248) | `ICHOR_MILITARY_BASE` | `MilitaryBase JetPac Room` |
| `0x0F9` (249) | `AlienCave` | `Alien exit` |
| `0x0FA` (250) | `Mizar` | `Mizar Racetrack Pits` |
| `0x0FB` (251) | `Multi` | `Forest OnRails Shooter` |
| `0x0FC` (252) | `TAWFRET_Swamp` | `Swamp_RuinSeq` |
| `0x0FD` (253) | `TAWFRET_Swamp` | `Floyd Regen` |
| `0x0FE` (254) | `TAWFRET_Swamp` | `Swamp Maze_part2` |
| `0x0FF` (255) | `TAWFRET_Swamp` | `Swamp Bigtree2` |
| `0x100` (256) | `TAWFRET_Swamp` | `Swamp Crypt2` |
| `0x101` (257) | `TAWFRET_Swamp` | `Swamp Crypt3` |
| `0x102` (258) | `Multi` | `Multi Race` |
| `0x103` (259) | `TAWFRET_Swamp` | `Swamp Bridge` |
| `0x104` (260) | `TAWFRET_Swamp` | `Swamp_Treehut` |
| `0x105` (261) | `TAWFRET_Swamp` | `Lost Tomb` |
| `0x106` (262) | `ICHOR_MILITARY_BASE` | `MilitaryBase Disco` |
| `0x107` (263) | `ICHOR_MILITARY_BASE` | `MilitaryBase Courtyard` |
| `0x108` (264) | `SPACESTATION` | `Sewer Three` |
| `0x109` (265) | `CERULEAN_Dune` | `Termite Room1` |
| `0x10A` (266) | `CERULEAN_Dune` | `Termite Room2` |
| `0x10B` (267) | `GOLDWOOD_Quarry` | `Gem Quarry` |
| `0x10C` (268) | `Mizar` | `Mizar Racer` |
| `0x10D` (269) | `ICHOR_MILITARY_BASE` | `MilitaryBase Pyxis Track` |
| `0x10E` (270) | `Multi` | `swm multi2` |
| `0x10F` (271) | `SPACESTATION` | `Space Station` |
| `0x110` (272) | `GOLDWOOD_Quarry` | `Gem Quarry Landing` |
| `0x111` (273) | `BaddyTest` | `Others` |
| `0x112` (274) | `ICHOR_MILITARY_BASE` | `MilitaryBase Lava` |
| `0x113` (275) | `SPACESTATION` | `Space Stationlanding` |
| `0x114` (276) | `SPACESTATION` | `Sewer landingplay` |
| `0x115` (277) | `SPAWNSHIP_CargoSewer` | `CargoSewer Sewer 2 Doors` |
| `0x116` (278) | `SPAWNSHIP_CargoSewer` | `CargoSewer WaterLink` |
| `0x117` (279) | `SPAWNSHIP_CargoSewer` | `CargoSewer After Electric` |
| `0x118` (280) | `SPAWNSHIP_CargoSewer` | `CargoSewer Lava Inside` |
| `0x119` (281) | `SPAWNSHIP_CargoSewer` | `CargoSewer Lava Endbit` |
| `0x11A` (282) | `GOLDWOOD_Quarry` | `Gem Planet` |
| `0x11B` (283) | `GOLDWOOD_Quarry` | `Happy Tribal Seq` |
| `0x11C` (284) | `Asteroid` | `Asteroid Launch Seq` |
| `0x11D` (285) | `Mizar` | `Mizar RaceEmpty Pits` |
| `0x11E` (286) | `Mizar` | `Mizar Courtyard` |
| `0x11F` (287) | `AlienCave` | `Alien exit2` |
| `0x120` (288) | `GOLDWOOD_Forest` | `Forest Hut Interior2` |
| `0x121` (289) | `GOLDWOOD_Forest` | `Forest Hut Interior3` |
| `0x122` (290) | `GOLDWOOD_Forest` | `Forest Hut Interior4` |
| `0x123` (291) | `GOLDWOOD_Forest` | `Forest Hut Interior5` |
| `0x124` (292) | `GOLDWOOD_Forest` | `Forest Hut Interior6` |
| `0x125` (293) | `GOLDWOOD_Forest` | `Forest Hut Interior7` |
| `0x126` (294) | `GOLDWOOD_Quarry` | `Forest Hut Interior8` |
| `0x127` (295) | `GOLDWOOD_Quarry` | `Forest Quarry VillageHall Inter` |
| `0x128` (296) | `GOLDWOOD_Forest` | `Forest Cave Hut2` |
| `0x129` (297) | `SS_ANUBIS_CargoShip` | `CargoShip Pickup 2` |
| `0x12A` (298) | `CERULEAN_Dune` | `Termite Room3` |
| `0x12B` (299) | `Mizar` | `Mizar Side RoomII Left` |
| `0x12C` (300) | `Mizar` | `Mizar Side RoomII Right` |
| `0x12D` (301) | `Mizar` | `Mizar Big Room Right` |
| `0x12E` (302) | `Mizar` | `Mizar Side Room Labarynth Two` |
| `0x12F` (303) | `Mizar` | `Mizar Side Room Labarynth Three` |
| `0x130` (304) | `Mizar` | `Mizar Courtyard Pyramid` |
| `0x131` (305) | `Mizar` | `Mizar Boy Lava` |
| `0x132` (306) | `Mizar` | `Mizar Boy Fall` |
| `0x133` (307) | `Mizar` | `Mizar Boy Girl Land` |
| `0x134` (308) | `Mizar` | `Pyramid Land` |
| `0x135` (309) | `0xFF` | `Happy Tribal Seq1` |
| `0x136` (310) | `GOLDWOOD_Forest` | `Cave_room` |
| `0x137` (311) | `Mizar` | `Dog Landing Pad` |
| `0x138` (312) | `SEKHMET_BATTLESHIP_AlphaSewer` | `AlphaSewer LaverPit` |
| `0x139` (313) | `Mizar` | `Central Sequence Girl` |
| `0x13A` (314) | `Mizar` | `Central Sequence Dog` |
| `0x13B` (315) | `Mizar` | `Dog Tunnels` |
| `0x13C` (316) | `Mizar` | `Dog NVision Pad In` |
| `0x13D` (317) | `Mizar` | `Dog NVision Pad Out` |
| `0x13E` (318) | `TAWFRET_Swamp` | `Swamp Maze Entrance` |
| `0x13F` (319) | `TAWFRET_Swamp` | `Swamp TakeOff Seq` |
| `0x140` (320) | `RITH_ESSA_Canyon` | `Canyon Exit2seq` |
| `0x141` (321) | `RITH_ESSA_Canyon` | `Canyon Landing` |
| `0x142` (322) | `General` | `JFG Ship` |
| `0x143` (323) | `General` | `Control Room` |
| `0x144` (324) | `General` | `JFG Ship Lookin` |
| `0x145` (325) | `General` | `Ant Attack Seq` |
| `0x146` (326) | `General` | `Spawn Attack` |
| `0x147` (327) | `General` | `Character Select Sq` |
| `0x148` (328) | `RITH_ESSA_Canyon` | `clf_planet` |
| `0x149` (329) | `AlienCave` | `aln_planet` |
| `0x14A` (330) | `AlienCave` | `Alien LandingSeq` |
| `0x14B` (331) | `SPACESTATION` | `Space Stationtakeoff` |
| `0x14C` (332) | `Asteroid` | `ast_Landing` |
| `0x14D` (333) | `ICHOR_MILITARY_BASE` | `MilitaryBase Tunnel Link1` |
| `0x14E` (334) | `Asteroid` | `Space earth` |
| `0x14F` (335) | `Asteroid` | `ast_LandingSeq` |
| `0x150` (336) | `Asteroid` | `ast_Boss3` |
| `0x151` (337) | `Asteroid` | `ast_pass` |
| `0x152` (338) | `Asteroid` | `ast_floyed` |
| `0x153` (339) | `ICHOR_MILITARY_BASE` | `MilitaryBase Sniper Room` |
| `0x154` (340) | `Mizar` | `Mizar Ship Room` |
| `0x155` (341) | `SS_ANUBIS_CargoShip` | `Cargo Leaving Seq` |
| `0x156` (342) | `WATERRUIN` | `Water Ruin Seq` |
| `0x157` (343) | `Asteroid` | `ast_floyedanim` |
| `0x158` (344) | `SS_ANUBIS_CargoShip` | `MilitaryB Vela Seq` |
| `0x159` (345) | `SS_ANUBIS_CargoShip` | `Free Vela Seq` |
| `0x15A` (346) | `Mizar` | `Miz Shipseq` |
| `0x15B` (347) | `Asteroid` | `ast_Boss3Seq` |
| `0x15C` (348) | `General` | `Forest Scroll` |
| `0x15D` (349) | `General` | `JFGShip Scroll` |
| `0x15E` (350) | `Asteroid` | `ast_Boss3Seq2` |
| `0x15F` (351) | `AlienCave` | `Alien Boss Play` |
| `0x160` (352) | `AlienCave` | `Alien Boss Intro` |
| `0x161` (353) | `General` | `EarthCity Seq` |
| `0x162` (354) | `GOLDWOOD_Quarry` | `Gem Quarry Seq` |
| `0x163` (355) | `Multi` | `tunnel multi` |
| `0x164` (356) | `Multi` | `closequaters` |
| `0x165` (357) | `GOLDWOOD_Quarry` | `Gem Quarry FSeq` |
| `0x166` (358) | `AlienCave` | `Alien exit2seq` |
| `0x167` (359) | `Mizar` | `Into Power Chars` |
| `0x168` (360) | `FrontEnd` | `Disco Credits` |
| `0x169` (361) | `SPAWNSHIP_CargoSewer` | `CargoSewer Secret Pad Takeoff S` |
| `0x16A` (362) | `ICHOR_MILITARY_BASE` | `MilitaryBase App Seq` |
| `0x16B` (363) | `Mizar` | `Before RacePits` |
| `0x16C` (364) | `Multi` | `CargoShip OnRails Shooter` |
| `0x16D` (365) | `General` | `Boy Select Sq` |
| `0x16E` (366) | `General` | `Earth Award Seq` |
| `0x16F` (367) | `Mizar` | `Dog Landing Seq` |
| `0x170` (368) | `CERULEAN_Dune` | `Dune Landing` |
| `0x171` (369) | `CERULEAN_Dune` | `Dune Take Off` |
| `0x172` (370) | `ICHOR_MILITARY_BASE` | `SlugBoss End Sequence` |
| `0x173` (371) | `ICHOR_MILITARY_BASE` | `SlugBoss Play Sequence` |
| `0x174` (372) | `ICHOR_MILITARY_BASE` | `SlugBoss Play` |
| `0x175` (373) | `Asteroid` | `ast_Boss3Seq3` |
| `0x176` (374) | `General` | `EarthCityDark Seq` |
| `0x177` (375) | `ICHOR_MILITARY_BASE` | `Arcade` |
| `0x178` (376) | `TAWFRET_Swamp` | `Swamp Boss End Sequence` |
| `0x179` (377) | `TAWFRET_Swamp` | `Swamp Boss Play II` |
| `0x17A` (378) | `SS_ANUBIS_CargoShip` | `CargoShip Brig Seq1` |
| `0x17B` (379) | `SS_ANUBIS_CargoShip` | `CargoShip Chase2a Seq` |
| `0x17C` (380) | `SS_ANUBIS_CargoShip` | `CargoShip Brig Seq1a` |
| `0x17D` (381) | `General` | `Cargoship Scroll` |
| `0x17E` (382) | `General` | `Swamp Scroll` |
| `0x17F` (383) | `General` | `Spawn Scroll` |
| `0x180` (384) | `General` | `Mizar Scroll` |
| `0x181` (385) | `General` | `EarthCityDark Scroll` |
| `0x182` (386) | `Mizar` | `Mizar Fight Play` |
| `0x183` (387) | `Mizar` | `Mizar Fight Seq` |
| `0x184` (388) | `Mizar` | `MizarFightSeqend` |
| `0x185` (389) | `Mizar` | `Miz_planet` |
| `0x186` (390) | `Asteroid` | `Asteroid Seq` |
| `0x187` (391) | `Mizar` | `Miz Shipseq2` |
| `0x188` (392) | `Mizar` | `Mine Cave seq` |
| `0x189` (393) | `AlienCave` | `Alien Boss End Sequence` |
| `0x18A` (394) | `Mizar` | `Won Mizar Race` |
| `0x18B` (395) | `Mizar` | `Mizar Boss Holding Room` |
| `0x18C` (396) | `Asteroid` | `Asteroid holding room` |
| `0x18D` (397) | `Multi` | `Multi Race II` |
| `0x18E` (398) | `Mizar` | `Fake RacePits` |
| `0x18F` (399) | `GOLDWOOD_Forest` | `Forest Day Last SequenceII` |
| `0x190` (400) | `Mizar` | `Mizar Pyramid Ship Room` |
| `0x191` (401) | `ICHOR_MILITARY_BASE` | `MilitaryBase Take Off Seq ` |
| `0x192` (402) | `Mizar` | `Mizar PowerBoy Fall` |
| `0x193` (403) | `GOLDWOOD_Quarry` | `Gem Planet b` |
| `0x194` (404) | `GOLDWOOD_Quarry` | `Gem Quarry FSeqb` |
| `0x195` (405) | `Asteroid` | `Space earthII` |
| `0x196` (406) | `Mizar` | `Transformer ANT` |
| `0x197` (407) | `Mizar` | `Mizar Pits Sequences` |
| `0x198` (408) | `Multi` | `Canyon OnRails Shooter` |
| `0x199` (409) | `Mizar` | `Dog Tunnels SEQ` |
| `0x19A` (410) | `Mizar` | `DogChasm SEQ` |
| `0x19B` (411) | `GOLDWOOD_Quarry` | `Gem Quarry Seq2` |

## Appendix B. Music cues

“First pass” is the duration through the first complete loop region, not a
claim that a looping cue stops there.

| ID | Bytes | Volume | Playback | First pass | ROM level-header associations |
|---:|---:|---:|---|---:|---|
| `01` | `0x52f` | 75 | loop | 198.482 s | Cargo Ship Dock; demo/test maps |
| `02` | `0x1db` | 75 | loop | 198.482 s | Lee Walkway; Alpha Sewer boss; Arcade |
| `03` | `0x509` | 70 | loop | 220.845 s | — |
| `04` | `0x3c2b` | 50 | loop | 211.747 s | Goldwood / forest maps |
| `05` | `0x356f` | 115 | loop | 158.399 s | Cargo Ship interior; Water Ruin under |
| `06` | `0x61` | 127 | loop | 399.974 s | silent placeholder |
| `07` | `0x155e` | 127 | loop | 42.497 s | transition and landing cutscenes |
| `08` | `0x61` | 127 | loop | 399.974 s | silent placeholder |
| `09` | `0x61` | 127 | loop | 399.974 s | silent placeholder |
| `0A` | `0x61` | 127 | loop | 399.974 s | silent placeholder |
| `0B` | `0x3023` | 125 | loop | 109.920 s | front end |
| `0C` | `0x1ca3` | 127 | loop | 119.108 s | Goldwood caves |
| `0D` | `0xb2` | 70 | once | 0.579 s | — |
| `0E` | `0xdfa` | 65 | loop | 57.615 s | character select |
| `0F` | `0x2df` | 65 | once | 2.827 s | — |
| `10` | `0x41f6` | 90 | loop | 179.988 s | Cargo Ship sewer |
| `11` | `0x2ad1` | 85 | loop | 214.815 s | Mizar's Palace |
| `12` | `0x3793` | 127 | loop | 236.087 s | Cerulean / canyon |
| `13` | `0x87e` | 65 | loop | 65.434 s | — |
| `14` | `0x53b` | 75 | once | 39.808 s | — |
| `15` | `0x7ec` | 75 | once | 19.428 s | Alpha Sewer departure cutscene |
| `16` | `0x7e5` | 127 | once | 18.815 s | — |
| `17` | `0x78d` | 75 | loop | 67.615 s | Goldwood night cutscene |
| `18` | `0x495` | 70 | loop | 67.615 s | — |
| `19` | `0x969` | 70 | loop | 69.796 s | — |
| `1A` | `0x1af` | 127 | once | 24.004 s | — |
| `1B` | `0x566` | 68 | loop | 67.615 s | — |
| `1C` | `0x61` | 127 | loop | 399.974 s | silent placeholder |
| `1D` | `0xe0` | 65 | once | 0.796 s | — |
| `1E` | `0x5afa` | 110 | loop | 243.630 s | Eschebone interiors |
| `1F` | `0x47ff` | 65 | loop | 183.440 s | Ichor Military Base; Goldwood intro |
| `20` | `0x1d8e` | 60 | once | 107.605 s | multiplayer select; scroll cutscenes |
| `21` | `0xc12` | 85 | loop | 46.975 s | Mizar's Palace tunnels |
| `22` | `0x61` | 127 | loop | 399.974 s | silent placeholder |
| `23` | `0x704` | 70 | loop | 67.615 s | — |
| `24` | `0x61` | 127 | loop | 399.974 s | silent placeholder |
| `25` | `0x56a8` | 70 | loop | 217.186 s | Spawnship / termite areas |
| `26` | `0x291d` | 100 | loop | 190.237 s | Cerulean mine; Water Ruin |
| `27` | `0x623` | 65 | once | 23.995 s | Alpha Sewer exit cutscene |
| `28` | `0x61` | 127 | loop | 399.974 s | silent placeholder |
| `29` | `0x3172` | 100 | loop | 202.273 s | Asteroid |
| `2A` | `0x95d` | 110 | loop | 36.426 s | — |
| `2B` | `0x5c1` | 127 | once | 6.644 s | — |
| `2C` | `0x10f1` | 100 | once | 36.045 s | — |
| `2D` | `0x61` | 127 | loop | 399.974 s | silent placeholder |
| `2E` | `0x3fea` | 115 | loop | 226.111 s | Tawfret / swamp |
| `2F` | `0x126d` | 80 | once | 77.863 s | Cargo Ship chase/brig cutscenes |
| `30` | `0x2dc3` | 85 | once | 202.470 s | — |
| `31` | `0x1588` | 60 | once | 88.483 s | Gem Quarry/Asteroid cutscenes |
| `32` | `0x2d3c` | 100 | loop | 258.967 s | SS Anubis / Alpha Sewer |
| `33` | `0x1213` | 127 | once | 75.810 s | — |
| `34` | `0x232a` | 80 | once | 82.728 s | — |
| `35` | `0x1f9c` | 85 | loop | 54.961 s | boss arenas |
| `36` | `0x55a3` | 100 | loop | 178.716 s | Mizar boss |
| `37` | `0x2e7e` | 85 | loop | 194.338 s | Space Station sewer |
| `38` | `0x2ff` | 100 | once | 6.940 s | — |
| `39` | `0x5282` | 127 | once | 156.651 s | JFG ship/control-room cutscenes |
| `3A` | `0x155e` | 127 | loop | 42.497 s | duplicate of `07` |
| `3B` | `0x41f6` | 90 | loop | 179.988 s | duplicate of `10` |
| `3C` | `0x23b` | 127 | loop | 21.453 s | Ichor disco; credits |
| `3D` | `0xa9a` | 127 | loop | 52.035 s | — |
| `3E` | `0x95a` | 127 | loop | 70.522 s | — |
| `3F` | `0x22d2` | 80 | loop | 103.533 s | — |
| `40` | `0x361` | 127 | loop | 105.996 s | Goldwood village; multiplayer arenas |
| `41` | `0x1893` | 90 | loop | 101.207 s | — |
| `42` | `0x1683` | 127 | once | 78.246 s | Cargo Ship cutscenes |
| `43` | `0x1d86` | 110 | once | 138.998 s | Asteroid boss cutscene |
| `44` | `0x1b05` | 110 | once | 74.196 s | — |
| `45` | `0x1f6d` | 90 | once | 56.587 s | — |
| `46` | `0x917` | 100 | once | 5.187 s | — |
| `47` | `0x452` | 100 | once | 3.750 s | — |
| `48` | `0x452` | 100 | once | 3.750 s | — |
| `49` | `0x452` | 100 | once | 3.750 s | — |
| `4A` | `0x7af` | 100 | once | 14.818 s | Floyd regeneration |
| `4B` | `0x19be` | 127 | loop | 96.161 s | boss introductions |
| `4C` | `0x90d` | 90 | loop | 36.895 s | multiplayer race |
| `4D` | `0x6d7c` | 127 | once | 271.570 s | Mizar/Asteroid/mine cutscenes |
| `4E` | `0x236` | 85 | once | 2.087 s | — |
| `4F` | `0x22c0` | 110 | once | 115.973 s | Gem Quarry cutscenes |
| `50` | `0x2785` | 110 | once | 139.541 s | — |
| `51` | `0x10df` | 110 | loop | 67.632 s | — |
| `52` | `0x144b` | 127 | once | 22.793 s | space/Asteroid cutscenes |
| `53` | `0x33fb` | 127 | once | 154.558 s | Earth City cutscenes |
| `54` | `0xeaf` | 127 | loop | 29.516 s | boss ending cutscenes |
| `55` | `0x12c2` | 127 | once | 16.391 s | — |
| `56` | `0x212c` | 100 | loop | 71.959 s | — |
| `57` | `0x374` | 100 | once | 4.021 s | — |
| `58` | `0x5ca` | 100 | once | 5.192 s | — |
| `59` | `0x1454` | 127 | loop | 80.511 s | — |
