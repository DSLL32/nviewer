# Kirby 64: The Crystal Shards — Nintendo 64 ROM format specification

This manual describes the shipped data formats needed to identify, extract, and
present *Kirby 64: The Crystal Shards*. It covers the USA revision-0 image. Each
claim identifies its evidence; names borrowed from the public decompilation are
identified as source-derived and are not presented as ROM-native metadata.

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | Eight numeric banks, each with geometry, image, animation, and miscellaneous namespaces; 10,583 indexed entries. |
| Compression | Active assets are raw. Dormant resident VPK0 method-0/method-1 decoders match the shared [VPK0 specification](compression/vpk0.md), but no indexed asset uses them. |
| Graphics microcode | `F3DEX fifo 2.04H`, `L3DEX fifo 2.04H`, and `S2DEX fifo 2.04`; three-dimensional level and model display lists use the F3DEX2 command family. |
| Geometry | Banked geometry blocks with hierarchical layouts, F3DEX2 display lists, standard `Vtx` vertices, image/vertex fixup lists, texture scrolling, and animation references. |
| Textures | ROM-indexed CI, I, IA, and RGBA images; bit depth, dimensions, palette, and sampling state come from referenced display-list commands. |
| Collision | One indexed setup per area containing `s16` vertices, triangle records, plane normals, a plane BSP, destructible groups, and optional convex water volumes. |
| Music driver | Nintendo `ALCSeq` compressed-sequence player with a 63-entry `S1` archive and a ROM-authored public-ID remap. |
| Audio microcode | Nintendo `n_aspMain` (source-derived identification); resident task begins at ROM `0x00039E30`, exact SDK/ABI revision unknown. |
| Sample encoding | Nintendo VADPCM in both music and sound-effect banks; 245 unique stored waves. |
| Levels | 32 ordered area sequences: 174 campaign areas, one retail-reachable tutorial area, and six hidden/test areas; 181 populated records total. |
| Memory requirement | Base 4 MiB. |
| Viewer support | Specification only; USA revision 0. |

### 1.2 ROM identification

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| USA | `Kirby64` | `NK4E` | 0 | 32 MiB (`0x02000000`) | `46039FB4` | `0337822C` | `6cea2d46b929a3bb347b060a77fccc83526fb855` | CIC-NUS-6103 | **Unknown** |

Verified from the normalized ROM header and complete-image hash. The IPL3
CRC-32 is `0B050EE0`, and independently recalculated CIC-6103 CRC1/CRC2 values
match the header. The entry point is `0x80100400`.

### 1.3 Terminology and conventions

ROM and memory ranges are half-open. Offsets, addresses, masks, opcodes, and
encoded sizes are hexadecimal unless stated otherwise. Multi-byte CPU fields
are big-endian. RAM addresses are virtual unless identified as physical.

A **file ID** is `bank << 16 | index`. Its namespace—geometry, image,
animation, or miscellaneous—is selected by the caller. A **geometry pair** in
an area record uses the same packed representation. An **area** is one runtime
room/setup. A **level sequence** is the zero-terminated array of areas selected
by one world/level table entry. Developer area strings such as `M11PLAIN01`
are genuine ROM-resident ASCII; descriptive structure and function names are
source-derived unless the text says otherwise.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

Verified from ROM bytes. The header occupies `[0x00000000,0x00000040)`, the
CIC boot program `[0x00000040,0x00001000)`, and the resident executable
`[0x00001000,0x00043790)`. Startup clears BSS beginning at `0x80042B90`, sets
the initial stack near `0x80042D90`, and enters the resident scheduler at
`0x80000870`.

Verified from ROM bytes and disassembly. A 20-entry overlay table at ROM
`0x00066820` supplies nine words per overlay: ROM start/end; load address;
text start/end; data start/end; and BSS start/end. The 20 stored overlays tile
`[0x00043790,0x00250320)` without gaps or overlap. Overlays reuse virtual
address ranges, so a static pointer into overlay space must be interpreted with
the active overlay, not only its address.

The ROM embeds the following RSP identification strings, verified from ROM
bytes:

| ROM | Identification string |
|---:|---|
| `0x00042D29` | `RSP Gfx ucode F3DEX fifo 2.04H Yoshitaka Yasumoto 1998 Nintendo.` |
| `0x00043149` | `RSP Gfx ucode L3DEX fifo 2.04H` |
| `0x00043539` | `RSP Gfx ucode S2DEX fifo 2.04` |

### 2.2 Memory and address mapping

Verified from ROM bytes. The resident image is loaded so ROM `0x1000` maps to
RAM `0x80000400`; therefore resident file offsets use a `+0x7FFFF400` virtual
bias. Overlay 1 maps ROM `0x43790` to `0x8009B540`; pointers in its static data
convert with `rom = vram - 0x80057DB0`.

Bank members use two internal pointer domains. Geometry layouts use segmented
addresses, normally segment 4 (`0x04xxxxxx`), resolved as `blockBase +
(address & 0x00FFFFFF)`. Miscellaneous area setup records use offsets from the
start of their own loaded blob. The loader relocates both forms in RAM.

### 2.3 ROM map and asset organization

Verified from ROM bytes. The physical ROM partition is:

| ROM range | Stored size | Decoded size | Destination | Compression | Contents |
|---|---:|---:|---|---|---|
| `[0x00000000,0x00000040)` | `0x40` | `0x40` | Header registers | None | N64 header |
| `[0x00000040,0x00001000)` | `0xFC0` | `0xFC0` | PIF/boot path | None | CIC-6103 boot code |
| `[0x00001000,0x00043790)` | `0x42790` | `0x42790` | `0x80000400` | None | Resident program/data and RSP task images |
| `[0x00043790,0x00250320)` | `0x20CB90` | Overlay-dependent | Reused overlay RAM | None | 20 overlays |
| `[0x00250320,0x004AA8F0)` | `0x2595D0` | Same | Audio heaps | None | Sequences, instrument controls, and wave data |
| `[0x004AA8F0,0x01E8BB50)` | `0x19E1260` | Same | Allocated per member | None | Eight-bank asset archive |
| `[0x01E8BB50,0x02000000)` | `0x1744B0` | — | — | — | `0xFF` cartridge padding |

Verified from ROM bytes. The unique eight-word pointer array at ROM
`0x000783D4` selects eight 0x20-byte bank headers. Four count arrays immediately
before it define the following logical namespace sizes; every count includes
empty index 0.

| Namespace | Bank 0 | Bank 1 | Bank 2 | Bank 3 | Bank 4 | Bank 5 | Bank 6 | Bank 7 | Total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Geometry | 11 | 244 | 129 | 197 | 154 | 1 | 295 | 211 | 1,242 |
| Image | 28 | 907 | 265 | 1,034 | 705 | 313 | 162 | 1,129 | 4,543 |
| Animation | 19 | 1,683 | 1,026 | 475 | 558 | 1 | 331 | 151 | 4,244 |
| Miscellaneous | 5 | 3 | 3 | 22 | 3 | 1 | 277 | 240 | 554 |

The 10,583 logical entries comprise 10,551 stored members and 32 empty index-0
members. Bank 5 has only empty geometry, animation, and miscellaneous
namespaces.

Verified from ROM bytes, the eight bank spans and headers are:

| Bank | Header VRAM | Header ROM | Physical range | Geometry / image / animation / miscellaneous counts |
|---:|---:|---:|---|---|
| 0 | `0x800C47D4` | `0x0006CA24` | `[0x004AA8F0,0x004FC9A0)` | 11 / 28 / 19 / 5 |
| 1 | `0x800C7824` | `0x0006FA74` | `[0x004FC9A0,0x007DDF60)` | 244 / 907 / 1,683 / 3 |
| 2 | `0x800C9090` | `0x000712E0` | `[0x007DDF60,0x0096C2D0)` | 129 / 265 / 1,026 / 3 |
| 3 | `0x800CAED0` | `0x00073120` | `[0x0096C2D0,0x00BDE710)` | 197 / 1,034 / 475 / 22 |
| 4 | `0x800CC794` | `0x000749E4` | `[0x00BDE710,0x011291B0)` | 154 / 705 / 558 / 3 |
| 5 | `0x800CCCB4` | `0x00074F04` | `[0x011291B0,0x01195E60)` | 1 / 313 / 1 / 1 |
| 6 | `0x800CE220` | `0x00076470` | `[0x01195E60,0x0128E770)` | 295 / 162 / 331 / 277 |
| 7 | `0x800D00A4` | `0x000782F4` | `[0x0128E770,0x01E8BB50)` | 211 / 1,129 / 151 / 240 |

The bank header has size and stride `0x20`; all words are overlay-1 virtual
pointers or physical ROM bases.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `u32` | `geometryTable` | Pointer to `geometryCount` absolute start/end pairs. |
| `0x04` | `0x04` | `u32` | `geometryBase` | Always `0xFFFFFFFF`; geometry pairs are already absolute. |
| `0x08` | `0x04` | `u32` | `imageTable` | Pointer to `imageCount + 1` relative offsets. |
| `0x0C` | `0x04` | `u32` | `imageBase` | Physical ROM base added to image offsets. |
| `0x10` | `0x04` | `u32` | `animationTable` | Pointer to `animationCount + 1` relative offsets. |
| `0x14` | `0x04` | `u32` | `animationBase` | Physical ROM base added to animation offsets. |
| `0x18` | `0x04` | `u32` | `miscTable` | Pointer to `miscCount + 1` relative offsets. |
| `0x1C` | `0x04` | `u32` | `miscBase` | Physical ROM base added to miscellaneous offsets. |

Geometry member `i` is the absolute range stored by pair `i`. Every nonempty
geometry member starts on a 16-byte boundary. For another namespace, member
`i` is `[base + offsets[i], base + offsets[i+1])`.

Verified exhaustively from ROM bytes. Nonempty member extents account for
27,136,384 bytes. Twenty-four namespace trailers contain `39 39 39 0A`
(`999\n`) followed by zero alignment, totaling 224 bytes; members and trailers
exactly tile the archive. These four bytes are not part of the final member.

### 2.4 Compression formats

Verified by disassembly. All four active loaders derive the allocation size
directly from adjacent table offsets, DMA that exact raw range, and perform only
pointer fixups. No decode call lies between DMA and use. None of the 10,583
member boundaries carries a known compression signature.

The resident image retains stream and memory decoders at `0x80002FC0` and
`0x8000385C`. Verified by disassembly, they implement the method-0 and method-1
variants of the existing [VPK0 format](compression/vpk0.md). No aligned call or
stored function pointer reaches the public wrappers `0x80003838` and
`0x8000385C`, and no edge enters the decoder/wrapper cluster from outside it.
The literal `vpk0` magic does not occur. This is dormant library residue, not
an asset codec used by the shipped game.

### 2.5 Loading process

Verified by disassembly. The active namespace loaders are:

| Namespace | RAM entry point | Operation |
|---|---:|---|
| Image | `0x800A8B0C` (`0x800A8934` for a partial read) | Resolve relative range, align allocation to four bytes, DMA, return raw image record. |
| Geometry | `0x800A8CE0`, `0x800A9250` | Resolve absolute pair, DMA, relocate segment-4 layout and command references, load referenced images. |
| Animation | `0x800A94F4` | Resolve relative range, DMA, relocate animation pointers. |
| Miscellaneous | `0x800A9AA8` | Resolve relative range, align allocation to four bytes, DMA. |

The selected area descriptor chooses one or two geometry IDs and one
miscellaneous setup ID. The setup is loaded first; its collision, path, and
entity offsets are rebased. Geometry loading then patches each referenced
`G_VTX` and `G_SETTIMG` command using the geometry and image bank tables.

### 2.6 Revision differences

Only the USA revision-0 image in the identification table was available.
Region or revision portability is unverified. Detect by the full `NK4E` code,
revision byte, and checksum rather than assuming the USA offsets apply to other
images.

## 3. Level data

### 3.1 Level catalog and identifiers

Verified from ROM bytes and disassembly. The selector at ROM `0x0007A1E8`
(linked address `0x800D1F98`) is a 9×12 array of overlay-1 virtual `u32`
pointers. Exactly 32 entries are nonzero. Each points to one contiguous
sequence of 0x24-byte area descriptors ending with an all-zero record; all 32
sequences are selected exactly once. The table physically contains 213 slots:
181 populated areas and 32 terminators. Runtime indexing is zero-based:
`selectorAddress = 0x800D1F98 + world * 48 + level * 4`, followed by
`area * 0x24` within the selected sequence.

Worlds 1–6 contribute 171 campaign areas, and final sequence 7-1 contributes
three more. Additional selectors are 7-2 (`ABE200`, `ABE100`), 7-3
(`EXERCISE01`), and 7-4 (`ENETEST1`, `ENETEST2`, `ITEM01`, `BREAKTEST1`).
Runtime validation established 7-3 as a retail-reachable Copy tutorial; 7-2
and 7-4 have no established retail route. The complete ordered catalog, with
ROM-native developer names and internal IDs, is in Appendix A.

Verified against live RAM. Selecting the Copy exercise produced zero-based
globals `[6,2,0,0]`, selected descriptor `0x800D1E9C`, and the live name
`EXERCISE01`. Its descriptor held geometry `7:206`, setup `7:235`, music ID
32, and no secondary geometry. This proves the 7-3 selector is reached by the
retail tutorial UI, not merely loadable through RAM modification.

Level numbers displayed to a user should use conventional world names—Pop
Star, Rock Star, Aqua Star, Neo Star, Shiver Star, Ripple Star, and Dark Star—
while retaining the numeric internal key and ROM-native area name. The seventh
selector group contains final and development content, so it must not be
interpreted as a normal seven-level campaign world.

### 3.2 Level container

Verified from ROM bytes and disassembly. The area descriptor at ROM
`0x000783F4` has size and stride `0x24`.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `u32` | `geometryPrimary` | Packed geometry bank/index. |
| `0x04` | `0x04` | `u32` | `geometrySecondary` | Optional packed geometry bank/index; zero if absent. |
| `0x08` | `0x02` | `u16` | `backdropId` | Backdrop/sky record number; zero means no new backdrop. |
| `0x0A` | `0x02` | `u16` | `backgroundColorId` | Index into the environment color table. |
| `0x0C` | `0x04` | `u32` | `musicId` | Public music selector. |
| `0x10` | `0x04` | `u32` | `setupId` | Packed miscellaneous ID for collision, path, and entities. |
| `0x14` | `0x02` | `u16` | `deathCamera` | Death-camera setting. |
| `0x16` | `0x02` | `u16` | `areaType` | Area-content enumeration. |
| `0x18` | `0x04` | `u32` | `dustSettingsId` | Packed dust-settings asset ID. |
| `0x1C` | `0x04` | `u32` | `dustImageId` | Packed dust-image asset ID. |
| `0x20` | `0x04` | `u32` | `areaName` | Static pointer to a ROM-resident developer ASCII string. |

All populated descriptors select bank 7 for setup and geometry. Setup indices
are the consecutive range 59–239, one unique blob per area. Geometry IDs are
the complete bank-7 range 1–210, each referenced exactly once: 181 primary and
29 secondary blocks.

The area-type values below are source-derived names checked against ROM usage:

| Value | Name | Meaning |
|---:|---|---|
| `0x00` | Normal | Ordinary traversal area. |
| `0x01` | Character boss | Encounter controlled by entity bank 1. |
| `0x02` | World boss | Encounter controlled by entity bank 2. |
| `0x03` | Stage end | Goal/picnic area. |
| `0x04` | Log ride | River vehicle area. |
| `0x05` | Sled ride | Sled vehicle area. |
| `0x06` | Minecart ride | Minecart vehicle area. |
| `0x07` | Unused | Engine case exists; no populated descriptor uses it. |
| `0x08` | Dedede ride | King Dedede vehicle area. |
| `0x09` | Final boss | Final encounter. |
| `0x0A` | Mini-boss | Encounter controlled by entity bank 8. |

Each setup blob begins with this 0x10-byte header; offsets are relative to the
blob start.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `u32` | `collisionOffset` | Offset to the 0x44-byte collision header. |
| `0x04` | `0x04` | `u32` | `pathOffset` | Offset to the path/node header. |
| `0x08` | `0x04` | `u32` | `entityOffset` | Offset to the entity list, or zero. |
| `0x0C` | `0x04` | `u32` | `reserved` | Zero in all 181 setup blobs. |

### 3.3 Geometry

Verified from ROM bytes and disassembly. A geometry block begins with this
0x20-byte header. Its internal pointers are normally segment-4 addresses.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `u32` | `layout` | Pointer to layout nodes or mode-specific entries. |
| `0x04` | `0x04` | `u32` | `textureScroll` | Optional texture-scroll hierarchy. |
| `0x08` | `0x04` | `u32` | `layoutMode` | Selects the layout/draw function family. |
| `0x0C` | `0x04` | `u32` | `imageFixups` | Pointer to a null-terminated list of `G_SETTIMG` command addresses. |
| `0x10` | `0x04` | `u32` | `addressFixups` | Pointer to a null-terminated list of `G_VTX` and branch-target command addresses. |
| `0x14` | `0x04` | `u32` | `animationCount` | Number of animation references. |
| `0x18` | `0x04` | `u32` | `animations` | Pointer to the animation-reference array. |
| `0x1C` | `0x04` | `u32` | `layoutCount` | Number of layout nodes/entries. |

The 210 level blocks use modes `0x14` (11), `0x17` (71), `0x18` (125),
`0x1B` (one), and `0x1C` (two). Across the whole archive, additional model
blocks use mode `0x13`; the loader supports the family `0x11`–`0x1E`, plus
special/no-op modes `0x1F` and decimal 999.

Mode `0x13` uses the header layout pointer as one direct display-list root.
Mode `0x14` has no transform hierarchy; its header root points to the same
0x08-byte output-list record sequence defined below for mode `0x18`, terminated
by output-list selector 4.

Verified against live RAM. In `EXERCISE01`, the primary render object pointed
to a loaded header at `0x803469C0` with mode `0x17`, two layout entries, no
secondary object, no texture-scroll graph, and no animations. A live frame
bound segment 4 to that header and called display list `0x040003A0`.

Common hierarchical layout nodes have stride `0x2C`:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `u32` | `command` | Low 12 bits are hierarchy depth; high bits select special matrix construction. A low value `0x12` terminates the array. |
| `0x04` | `0x04` | `u32` | `entry` | Optional segmented pointer to mode-specific display-list entry. |
| `0x08` | `0x0C` | `f32[3]` | `translation` | Local translation. |
| `0x14` | `0x0C` | `f32[3]` | `rotation` | Local Euler rotation. |
| `0x20` | `0x0C` | `f32[3]` | `scale` | Local scale. |

Depth zero is a root; depth N attaches to the most recent depth N-1. Mode
`0x17` uses the node entry as a direct display-list pointer. Mode `0x18` uses
0x08-byte output-list records:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `u32` | `outputList` | Output-list selector; 4 terminates the sequence. |
| `0x04` | `0x04` | `u32` | `displayList` | Segmented display-list pointer. |

Mode `0x1B` uses a fixed 0x08-byte entry:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `u32` | `displayList0` | First segmented display-list pointer. |
| `0x04` | `0x04` | `u32` | `displayList1` | Second segmented display-list pointer. |

Mode `0x1C` uses 0x0C-byte output-list records:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `u32` | `outputList` | Output-list selector; 4 terminates the sequence. |
| `0x04` | `0x04` | `u32` | `preDisplayList` | Segmented pre-pass display-list pointer. |
| `0x08` | `0x04` | `u32` | `mainDisplayList` | Segmented main display-list pointer. |

Preserve the hierarchy and concatenate the optional secondary block as a
separate root; it is not an alternate LOD.

In applicable level blocks, ordinary nodes are followed by command `0x12`,
entry `0x80000000`, and a post-sentinel environment-effect transform array
ending when the first halfword has bit `0x8000`. There are 147 such records.
Their consumer semantics remain unknown; keep them separate from the ordinary
model tree.

### 3.4 Display lists and render state

Verified from ROM bytes and display-list decoding. Level and object geometry
use F3DEX2-family commands and standard 16-byte N64 `Vtx` records. Display
lists use the F3DEX2 opcode family. Geometry
fixup arrays point to the command words that need relocation. The second list
contains `G_VTX` addresses and a small number of `G_RDPHALF_1` branch targets.
A relocated address becomes `blockBase + (segmented & 0x00FFFFFF)`. An image command's
packed ID is resolved through the selected image namespace and replaced by the
loaded image address.

The renderer must interpret material state at each draw: cycle type, combine
mode, render mode, geometry mode, texture enable/scale, tile descriptors,
palette selection, and primitive/environment colors. State is inherited within
a display-list call tree and cannot safely be reduced to a material keyed only
by texture ID.

### 3.5 Textures and materials

Verified from all 210 level geometry blocks and their referenced image records.
No texture reference or vertex reference points outside its indexed member.
Observed `G_SETTIMG` format tags, counted per reference, are CI (3,031), I
(3,461), IA (1,703), and RGBA (2,159). Every command carries the standard
16-bit load-transfer size and width 1; these are not claims that each sampled
texture is 16 bpp or one texel wide. Actual bit depth, dimensions, palette, and
texel interpretation follow the tile/load commands.

CI textures require their referenced TLUT. Preserve wrap, mirror, clamp,
mask, shift, tile origin, and texture scale. Texture-scroll state is linked
from the geometry header, but its complete stored structure remains unresolved;
static rendering may use the unscrolled base coordinates and should label that
as an approximation.

### 3.6 Collision

Verified from ROM bytes and disassembly. Every area setup selects one collision
header. Released levels use `s16` vertices; the engine's float-vertex query path
is a general runtime alternative. Every array offset below is relative to the
start of the enclosing setup blob. The header is 0x44 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `u32` | `trianglesOffset` | Triangle array offset. |
| `0x04` | `0x04` | `u32` | `triangleCount` | Includes placeholder record 0. |
| `0x08` | `0x04` | `u32` | `verticesOffset` | `s16[3]` vertex array offset. |
| `0x0C` | `0x04` | `u32` | `vertexCount` | Includes sentinel record 0. |
| `0x10` | `0x04` | `u32` | `planesOffset` | `f32[4]` plane array offset. |
| `0x14` | `0x04` | `u32` | `planeCount` | Includes sentinel record 0. |
| `0x18` | `0x04` | `u32` | `cellsOffset` | `u16` triangle-cell array offset. |
| `0x1C` | `0x04` | `u32` | `cellCount` | Includes placeholder cell 0. |
| `0x20` | `0x04` | `u32` | `bspOffset` | 8-byte plane-BSP node array offset. |
| `0x24` | `0x04` | `u32` | `bspCount` | Includes placeholder node 0. |
| `0x28` | `0x04` | `u32` | `bspRoot` | Root node index; `bspCount - 1` in all areas. |
| `0x2C` | `0x04` | `u32` | `dynamicGroupsOffset` | Array of 6-byte destructible/moving groups. |
| `0x30` | `0x04` | `u32` | `dynamicIndicesOffset` | Group member triangle indices. |
| `0x34` | `0x04` | `u32` | `waterVolumesOffset` | Optional 0x18-byte water-volume array. |
| `0x38` | `0x04` | `u32` | `waterVolumeCount` | Number of water volumes. |
| `0x3C` | `0x04` | `u32` | `waterPlanesOffset` | Optional `f32[4]` water-plane array. |
| `0x40` | `0x04` | `u32` | `waterPlaneCount` | Includes sentinel plane 0 when present. |

Triangle records have stride `0x14`:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x06` | `u16[3]` | `vertexIndices` | Indices into the vertex array. |
| `0x06` | `0x02` | `u16` | `polygonGroup` | Connected/coplanar group identifier; precise gameplay use unknown. |
| `0x08` | `0x02` | `u16` | `flags` | Sidedness and query-participation flags. |
| `0x0A` | `0x02` | `u16` | `collisionIndex` | Dynamic group or type-specific index. |
| `0x0C` | `0x02` | `u16` | `particleType` | Break/attack particle selector. |
| `0x0E` | `0x02` | `u16` | `haltSelector` | Script/response selector. |
| `0x10` | `0x02` | `u16` | `parameter` | Break condition, conveyor speed, or type-specific value. |
| `0x12` | `0x02` | `u16` | `type` | Collision-type enumeration. |

Flag `0x0001` accepts the stored/front normal, `0x0002` accepts the reversed
normal, `0x0004` is a conditional class rejected by generic queries unless a
global state bit is set, and `0x0008` excludes the triangle from ordinary
solid queries. Both sidedness bits together make a double-sided triangle.

The shipped type values and verified behavior are:

| Value | Meaning | Evidence |
|---:|---|---|
| `0x00` | Default solid. | Verified by disassembly and ROM usage. |
| `0x01` | Wall-ladder query class. | Query behavior verified by disassembly; name source-derived. |
| `0x02` | Rope query class. | Query behavior verified by disassembly; name source-derived. |
| `0x03` | Non-solid death floor. | Query behavior verified by disassembly; name source-derived. |
| `0x04` | Semisolid/pass-through platform. | Dedicated query verified; name source-derived. |
| `0x05` | Unknown ceiling/platform variant. | Verified from ROM bytes and shared type-4 handling. |
| `0x06` | Special response surface using selector `0x10`. | Verified by disassembly; exact gameplay meaning unknown. |
| `0x08` | Non-solid warp. | Layout verified; name source-derived. |
| `0x09` | Breakable surface. | Dynamic-group removal verified; name source-derived. |
| `0x0A` | Unknown solid type; every instance has flags `0x0005`. | Verified from ROM bytes; the type's exact meaning is unknown. |
| `0x0C` | Unused non-solid query class. | Engine query verified; zero shipped triangles. |
| `0x0D` | Breakable ceiling. | Layout verified; name source-derived. |
| `0x0E` | Unknown non-solid class. | Verified from ROM bytes. |
| `0x10` | Dedede hammer-breakable surface. | Dynamic removal verified; name source-derived. |
| `0x12` | Backward conveyor, subtracting `parameter * 0.1`. | Verified by disassembly. |
| `0x13` | Forward conveyor, adding `parameter * 0.1`. | Verified by disassembly. |
| `0x14` | Custom moving-platform class. | Presence verified; name source-derived. |

The corpus contains 23,550 real triangles, 24,431 real vertices, 7,270 real
unit-length collision planes, 8,654 real BSP nodes, and 23,786 real cell
entries. Bit 15 in a cell marks the final triangle in a plane run; bits 0–14
are the triangle index. A BSP node has stride 0x08:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x02` | `u16` | `planeIndex` | Plane used for this partition. |
| `0x02` | `0x02` | `u16` | `leftChild` | Left child index; zero means no child. |
| `0x04` | `0x02` | `u16` | `rightChild` | Right child index; zero means no child. |
| `0x06` | `0x02` | `u16` | `cellStart` | First triangle-cell entry for this plane. |

A dynamic-group record has stride `0x06`:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x02` | `u16` | `memberCount` | Number of triangle indices. |
| `0x02` | `0x02` | `u16` | `firstMember` | First element in the dynamic-index array. |
| `0x04` | `0x02` | `u16` | `renderObject` | Associated level render-object index. |

The group table is bounded by `dynamicIndicesOffset` and ends at a record whose
`memberCount` is `0x9999`; the number of preceding records is the group count.
The dynamic-index count is the maximum `firstMember + memberCount` across
groups. There are 2,779 groups and 3,654 member references. Destruction clears
the two sidedness bits of all member triangles, disabling them for ordinary
queries.

Forty-two areas contain 349 water volumes and 1,403 real water planes. Water
volumes have stride `0x18`:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x02` | `u16` | `planeCount` | Number of convex boundary planes. |
| `0x02` | `0x02` | `u16` | `firstPlane` | First index in the water-plane array. |
| `0x04` | `0x01` | `u8` | `enabled` | Runtime enable flag. |
| `0x05` | `0x01` | `u8` | `mode` | Flow/mode value; 0, 1, and 2 occur. |
| `0x06` | `0x01` | `u8` | `flowDirection` | Direction code. |
| `0x07` | `0x01` | `u8` | `flowSpeed` | Speed code. |
| `0x08` | `0x04` | `f32` | `minX` | Inclusive X acceleration bound. |
| `0x0C` | `0x04` | `f32` | `minY` | Inclusive Y bound. |
| `0x10` | `0x04` | `f32` | `maxY` | Inclusive Y bound. |
| `0x14` | `0x04` | `f32` | `maxX` | Exclusive X acceleration bound. |

The four scalar bounds are not a box: Z and the exact convex boundary come
from the plane equations. A collision viewer should render all triangles in a
hidden-by-default `collision` layer, preserving type and flags, and should only
render water when it reconstructs the convex volume from those planes.

### 3.7 Environment, sky, fog, and lighting

Verified from ROM bytes and disassembly. The backdrop pointer table at ROM
`0x0007C8B8` provides IDs 1–72. Areas use 70 IDs; 102 areas use ID zero and
therefore select no backdrop record. Each nonzero pointer selects one or more
0x30-byte records, terminated when the following record's first word is zero.
The 70 selected lists contain 124 records.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `u32` | `imageId` | Packed bank/index image. |
| `0x04` | `0x04` | `u32` | `type` | Backdrop/environment type. |
| `0x08` | `0x08` | `u16[4]` | `parameters08` | Type-specific parameters. |
| `0x10` | `0x0C` | `f32[3]` | `positionOrScale` | Type-specific vector. |
| `0x1C` | `0x04` | `u32` | `parameter1C` | Type-specific value. |
| `0x20` | `0x10` | `f32[4]` | `parameters20` | Type-specific values. |

The consumer treats these as environment/sprite records; “skybox” is too
narrow. Render each as a separate `backdrop` instance. Exact per-type semantics
remain unknown.

The 0x0C-byte color table begins at ROM `0x0007C9DC`. Seven IDs occur. The
per-frame code uses bytes 0–2 as clear RGB and forces alpha `0xFF`: ID 1
`5A5A5A`, ID 5 `FFFFFF`, ID 19 `5087DC`, ID 51 `A0AABE`, ID 55 `6496FF`, ID
57 `00BBFF`, and ID 127 `000000`. Meanings of bytes 3–11 remain unknown.

Fog setup at `0x800F716C` emits F3DEX2 fog-position state to display-list heads
0 and 1. Zero-based world 1, level 2 (displayed 2-3) uses positions 102/1003;
all other selectors use 920/1000. Fog color remains display-list state through
`G_SETFOGCOLOR`; 23 such commands occur in level geometry.

Verified against live RAM and a gameplay frame. The exercise renderer executed
the wrapper and emitted `DB080000 0640FAC0`, the packed 920/1000 fog state,
before binding segment 4 and calling its level display list.

### 3.8 Cameras and paths

Verified from ROM bytes. The 181 setup blobs contain 957 camera/path nodes: 852
with one-byte type 0 and 105 with one-byte type 1; the following byte is 10 in
all records. Paths are a runtime rail system,
not free-camera keyframes. An entity with placement-control bit 0 clear binds
to its node and uses its middle auxiliary float as a path parameter.

The setup node header has size 0x10; all nonnull fields are setup-blob-relative
offsets:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `u32` | `pathCount` | Number of path headers. |
| `0x04` | `0x04` | `u32` | `pathHeadersOffset` | Offset to 0x10-byte path headers. |
| `0x08` | `0x04` | `u32` | `unknownByteArrayOffset` | Offset to an unresolved byte array. |
| `0x0C` | `0x04` | `u32` | `unknownFloatArrayOffset` | Offset to an unresolved float array. |

Each path header has stride 0x10:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `u32` | `nodeOffset` | Offset to the combined Kirby/camera record. |
| `0x04` | `0x04` | `u32` | `footerOffset` | Offset to the 0x18-byte path footer. |
| `0x08` | `0x04` | `u32` | `connectorsOffset` | Offset to 4-byte connector records. |
| `0x0C` | `0x02` | `u16` | `connectorCount` | Number of connector records. |
| `0x0E` | `0x02` | `u16` | `selfConnected` | Nonzero for a self-connected path. |

Connector field names are source-derived; each record has stride 0x04:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x01` | `u8` | `backwardRule` | Backward traversal rule. |
| `0x01` | `0x01` | `u8` | `currentNode` | Current-node index. |
| `0x02` | `0x01` | `u8` | `connectedNode` | Connected-node index. |
| `0x03` | `0x01` | `u8` | `forwardRule` | Forward traversal rule. |

The path footer has stride 0x18:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x02` | `u16` | `flags` | Bit `0x0200` enables the optional matrix. |
| `0x02` | `0x02` | `u16` | `pathPointCount` | Number of point-major XYZ positions. |
| `0x04` | `0x04` | `f32` | `sectionCount` | Number of path sections, stored as a float. |
| `0x08` | `0x04` | `u32` | `positionsOffset` | Offset to `pathPointCount` consecutive point-major `f32[3]` XYZ positions. |
| `0x0C` | `0x04` | `f32` | `pathLength` | Authored path length. |
| `0x10` | `0x04` | `u32` | `boundariesOffset` | Offset to the section boundary array. |
| `0x14` | `0x04` | `f32` | `unknown14` | Unknown. |

The combined Kirby/camera record has size `0x90`. Its 0x20-byte prefix is:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x01` | `u8` | `nodeNumber` | Path-node number. |
| `0x01` | `0x01` | `u8` | `unknown01` | Padding or unknown. |
| `0x02` | `0x02` | `u16` | `entryDirection` | Entry direction. |
| `0x04` | `0x04` | `u8[4]` | `warpDestination` | Stored warp destination. |
| `0x08` | `0x01` | `u8` | `unknown08` | Unknown. |
| `0x09` | `0x03` | `u8[3]` | `shading` | Left, center, and right shading values. |
| `0x0C` | `0x02` | `u16` | `unknown0C` | Unknown. |
| `0x0E` | `0x02` | `u16` | `flags` | Node flags; bit `0x0010` enables optional values. |
| `0x10` | `0x02` | `u16` | `option1` | Optional value. |
| `0x12` | `0x02` | `u16` | `option2` | Optional value. |
| `0x14` | `0x04` | `f32` | `optionFloat1` | Optional value. |
| `0x18` | `0x04` | `f32` | `optionFloat2` | Optional value. |
| `0x1C` | `0x04` | `f32` | `unknown1C` | Unknown. |

These semantic names are source-derived; offsets and values were checked
against ROM bytes. The camera portion at `+0x20` has size `0x70`:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x01` | `u8` | `type` | 0 or 1. |
| `0x01` | `0x01` | `u8` | `constant10` | Decimal 10 in every record. |
| `0x02` | `0x03` | `u8[3]` | `axisLocks` | Horizontal, vertical, and Z locks; all one. |
| `0x06` | `0x02` | `u8[2]` | `panFlags` | Pan-control flags. |
| `0x08` | `0x01` | `u8` | `followXAngle` | Set in 57 nodes. |
| `0x0C` | `0x0C` | `f32[3]` | `focus` | Horizontal, vertical, and Z focus. |
| `0x18` | `0x08` | `f32[2]` | `clip` | Near and far clip planes. |
| `0x20` | `0x18` | `f32[6]` | `rThetaRadius` | Three endpoint pairs. |
| `0x38` | `0x08` | `f32[2]` | `fov` | FOV endpoint pair. |
| `0x40` | `0x08` | `f32[2]` | `phi` | Phi endpoint pair. |
| `0x48` | `0x18` | `f32[6]` | `positionLocks` | X/Y/Z lock-bound pairs. |
| `0x60` | `0x10` | `f32[4]` | `angleOrFocusLocks` | Two remaining lock-bound pairs. |

Field meanings are source-derived and offsets/values are ROM-verified. Near
clip ranges from 10–300, far clip from 2,000–12,800, and FOV endpoints from
30–50. Reproducing gameplay requires path interpolation; a static viewer may
expose these as authored metadata and use its orbit camera. Runtime anchors are
the combined camera matrix at `0x800D6ED0` and camera-object pointer at
`0x800D799C`.

Verified against live RAM. During the same interactive exercise frame, the
camera object pointer was nonnull (`0x802965F8`) and the combined 4x4 matrix was
populated. This validates the global addresses and their active draw-time role;
it does not independently assign meanings to every stored camera-node field.

## 4. Objects

### 4.1 Placement records

Verified from all 181 setup blobs. The entity list contains 2,911 records in
176 nonempty setups and ends when the next record begins with `0x99999999`.
Each record has stride `0x2C`:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x01` | `u8` | `node` | Path-node number. |
| `0x01` | `0x01` | `u8` | `bank` | Behavior/object bank. |
| `0x02` | `0x01` | `u8` | `entityId` | Entity selector within the bank. |
| `0x03` | `0x01` | `u8` | `action` | Action/variant; bank 5 uses it as selector high byte. |
| `0x04` | `0x01` | `u8` | `controlFlags` | Path/absolute and runtime-state flags. |
| `0x05` | `0x01` | `u8` | `behaviorFlags` | Spawn, linkage, collision-query, and depth flags. |
| `0x06` | `0x02` | `s16` | `saveIndex` | Persistent/save index, or zero. |
| `0x08` | `0x0C` | `f32[3]` | `position` | Initial position. |
| `0x14` | `0x0C` | `f32[3]` | `rotation` | Initial Euler rotation. |
| `0x20` | `0x0C` | `f32[3]` | `scaleAux` | Uniform scale in X; path parameter in Y for bound actors; Z unresolved. |

Control bit `0x01` selects absolute/unbound placement; when clear, the object
binds to `node`. Control bit `0x02` seeds a runtime state value. Only values 0,
1, and 2 occur. The common setup applies the first scale float uniformly to
all three axes. All records are effectively unit scale.

### 4.2 Object and model formats

Verified record counts and model selectors from ROM bytes; bank roles are
source-derived and checked against dispatch disassembly.

| Bank | Records | Used IDs | Common model behavior |
|---:|---:|---:|---|
| 0 | 1,574 | 73 | General actors/enemies; 107-entry fixed model table. |
| 1 | 3 | 3 | Character encounters; three-entry fixed table. |
| 2 | 9 | 6 | World bosses; seven-entry fixed table. |
| 3 | 1,012 | 13 | Items/collectibles; 14-entry fixed table. |
| 5 | 271 | 252 | Area-load resources selected by `(action << 8) | entityId`. |
| 7 | 21 | 10 | Helper/scripted-goal actors with ID-specific initialization. |
| 8 | 21 | 21 | Mini-boss encounter controllers, stage-overlay specific. |

Banks 4 and 6 do not occur in placed records. For banks 0–3, action does not
change the fixed geometry selector. The four model tables are at ROM
`0x168EF4` (107 entries), `0x1E416C` (3), `0x17B37C` (7), and `0x1690A0`
(14). Ninety nonnull models reached by placements have valid geometry headers.
Four placed boss records select null common-table entries and receive their
visuals through stage-specific code.

Bank 7 is action-dependent. Static tracing resolves all 15 pairs used by placed
records:

| ID/actions | Geometry result |
|---|---|
| 0/0 | `2:106` |
| 1/0,1,2 | `2:111` |
| 2/0 | `2:103` |
| 3/0 | `2:111` |
| 3/1 | No own model. |
| 4/0 | `2:111` |
| 4/1 | No own model. |
| 5/0 | `2:111` |
| 5/1 | No own model. |
| 6/0 | `2:96` |
| 7/0 | `2:108` |
| 9/0 | `2:104` |
| 10/0 | `2:107` |

Bank 5 bypasses the ordinary factory. Area setup combines action and entity ID
into a 16-bit selector and indexes a 0x1C-byte resource table. Its 271 records
use distinct combined selectors. Selectors `0x115`–`0x118` in `M22RUINS01`
are outside the factory's accepted `< 0x115` range and instantiate nothing;
they are probable disabled stage actors, but that interpretation is a
**Hypothesis**.

Object geometry reuses the header, layouts, display lists, texture resolution,
and standard `Vtx` format described for level geometry. A viewer should show
unresolved bank-5/bank-8 actors as labeled markers rather than applying a model
observed in only one overlay globally.

Across the full geometry archive, 41 blank/control resources have no nonnull
draw root. They are valid empty models, not parse failures.

### 4.3 Skeletons and animation

Verified from ROM bytes and disassembly. The complete archive has 1,234
nonnull geometry blocks: modes `0x13` (163), `0x14` (33), `0x17` (511),
`0x18` (515), `0x1B` (5), and `0x1C` (7). Of these, 1,038 carry rigid
transform hierarchies. These are part trees, not weighted skinning. High
command bits `0x1000`, `0x2000`, `0x4000`, and `0x8000` select
camera/projection-dependent matrix variants; friendly billboard names remain
unknown.

The optional geometry-header material graph consists of nested
`0x99999999`-terminated pointer tables and 0x78-byte material records. Material
offsets `0x04` and `0x2C` point to terminated image and palette ID lists.
Segment `0x0E` display-list calls are runtime material lists, not offsets inside
the geometry block.

An animation block begins with this variable-size header. Offsets in the
relocation list identify pointer-bearing words; the loader adds the block base
to the root and each listed word.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `u32` | `rootOffset` | Block-relative root-data offset. |
| `0x04` | `0x04` | `u32` | `kind` | 0 model, 1 material/texture, or 2 camera. |
| `0x08` | `0x04` | `u32` | `relocationCount` | Number of relocation entries. |
| `0x0C` | `4 * relocationCount` | `u32[]` | `relocations` | Offsets of pointer-bearing words. |

Kind 0 roots contain one nullable track pointer per preorder geometry node.
Kind 1 roots contain outer node pointers and per-material stream pointers. Kind
2 points directly to a camera stream. The archive contains 4,236 animation
blocks: 2,502 model, 1,693 material, and 41 camera. All 3,345 references from
geometry resolve: 1,934 model, 1,395 material, and 16 camera references.

Each animation command is one `u32`: opcode bits 31–25, parameter-mask bits
24–15, and duration bits 14–0. Mask bits 0–9 select rotation X/Y/Z,
spline-position parameter, translation X/Y/Z, and scale X/Y/Z. Float operands
follow in mask order.

| Opcode | Operand form | Effect |
|---:|---|---|
| `0x00` | None | End stream. |
| `0x01` | Relative pointer | Jump. |
| `0x02` | None | Wait for duration. |
| `0x03`, `0x04` | One `f32` per selected parameter | Linear target, last/non-last. |
| `0x05`, `0x06` | Two `f32` per selected parameter | Cubic target and rate, last/non-last. |
| `0x07` | One `f32` per selected parameter | Set target rate. |
| `0x08`, `0x09` | One `f32` per selected parameter | Cubic target with zero target rate, last/non-last. |
| `0x0A`, `0x0B` | One `f32` per selected parameter | Delayed step target, last/non-last. |
| `0x0C` | None | Add duration to selected timers. |
| `0x0D` | Pointer | Install spline data. |
| `0x0E` | Pointer | Set animation/loop target and reset time. |
| `0x0F` | Value | Set node flags. |
| `0x10` | Callback operand | Callback event. |
| `0x11` | Callback values | Callback values. |
| `0x17` | Two `f32` values | Set camera near/far clip planes. |

Geometry-header animation references are dependency/compatibility lists;
runtime behavior selects one action. An initial viewer may render bind pose,
but full playback must relocate the block, pair streams by preorder
node/material order, and execute each timeline independently.

### 4.4 Behaviors, triggers, and scripted objects

Verified by disassembly. Ordinary records are scanned against the current view
volume: normalized X `[-1.4,1.4]`, Y `[-2,2]`, and Z `[-0.9,0.9]`. Behavior
flag `0x20` bypasses the Z bound and extends offscreen lifetime; flag `0x08`
suppresses ordinary scanning. A successful spawn sets a resident state bit,
and leaving the volume permits respawn unless persistence suppresses it.

The engine unpacks 64 persistent bits for the selected area. The largest setup
contains 62 records, matching that capacity. Exactly 48 bank-3 ID-7 records
use positive save indices 1–64. Their alternate action when the bit is already
set and their placement pattern identify them as the Crystal Shard collectible;
the name is source-derived/game-context interpretation, while the persistence
behavior is verified by disassembly.

When `(behaviorFlags & 0x0C) == 0x04`, the immediately following record is a
companion descriptor. All 17 such leaders are followed by an `0x08`-suppressed
record. This is a generic explicit record-link mechanism.

Bank 1's three IDs occur only in character-boss rooms. Bank 2 IDs 0–5 occur
only in world-boss rooms. Each of the 21 mini-boss areas contains one bank-8
record with sequential ID 0–20 and action zero. Bank 7 clusters in friend,
finale, and puzzle-like areas and dispatches through an 11-entry helper table.

## 5. Audio

### 5.1 Audio storage and banks

Verified from ROM bytes. Audio occupies eight contiguous raw regions before
the game-asset archive:

| ROM range | Stored size | Contents |
|---|---:|---|
| `[0x00250320,0x002A8CB0)` | `0x58990` | `S1` sequence archive, 63 entries. |
| `[0x002A8CB0,0x002B1510)` | `0x8860` | `B1` music control/bank graph. |
| `[0x002B1510,0x003E1400)` | `0x12FEF0` | Music sample table. |
| `[0x003E1400,0x003E6BC0)` | `0x57C0` | `B1` sound-effect control/bank graph. |
| `[0x003E6BC0,0x0049F590)` | `0xB89D0` | Sound-effect sample table. |
| `[0x0049F590,0x004A0340)` | `0xDB0` | 218 fixed 0x10-byte custom SFX records. |
| `[0x004A0340,0x004A3B60)` | `0x3820` | 379 variable custom records behind an offset table. |
| `[0x004A3B60,0x004AA8F0)` | `0x6D90` | 630 public SFX records behind an offset table. |

The `S1` archive header is variable-size:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x02` | `u16` | `magic` | ASCII `S1`. |
| `0x02` | `0x02` | `u16` | `count` | 63. |
| `0x04` | `8 * count` | record[] | `entries` | Array of 0x08-byte sequence entries. |

Each sequence entry has stride 0x08:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `u32` | `offset` | Sequence offset relative to the `S1` base. |
| `0x04` | `0x04` | `u32` | `length` | Stored sequence length, excluding alignment. |

Offsets are relative to `0x00250320`; entries are padded to four-byte
boundaries. Fifteen zero bytes follow the last stored sequence.

Both `B1` controls are standard Nintendo `ALBankFile` graphs with offsets
relative to their control-file base. Each `ALWaveTable.base` is relative to the
paired sample-table base. The three custom SFX tables are relocated by the
resident loader, but their deeper record semantics remain unknown.

### 5.2 Sequence format and driver

Verified by disassembly. The game uses Nintendo's compact `ALCSeq` player and
`ALBankFile` synthesizer. It requests 32,000 Hz from `osAiSetFrequency`, then
uses the returned hardware rate for buffer sizing. Configuration requests 16
physical voices, 24 virtual voices, 64 updates, 64 events, eight sound slots,
and one BGM player. Sample DMA uses four 1,024-byte caches. Reverb type 2 is
selected at initialization.

The public decompilation identifies the resident audio RSP task at ROM
`0x00039E30` as Nintendo `n_aspMain`; this name is source-derived. The ROM has
no audio ABI revision string, so a more specific SDK revision is unknown.

Verified against live RAM. The active settings contained requested rate 32,000,
voices 16/24, updates/events 64/64, and eight sound players. NTSC AI DAC rate
`0x5F0` yields 32,006.451 Hz. A write to `AI_LEN` submitted `0x8A0` bytes—552
stereo signed-PCM16 frames—from `0x8006FFC0`; all 1,104 channel samples were
nonzero, ranging from -5,911 to 5,944. This confirms live non-silent synthesis;
the headless dummy plugin did not provide acoustic output for listening tests.

A compact sequence begins with 16 relative track offsets and a division word:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x40` | `u32[16]` | `trackOffsets` | Relative track offsets; zero means no track. |
| `0x40` | `0x04` | `u32` | `division` | Ticks per quarter note; 384 or 480 in this corpus. |

Each track begins with a MIDI-style variable-length delta. Running status is
per track and meta events clear it. Note On adds a variable-length duration
after key and velocity; the player schedules Note Off internally. Timing begins
at 500,000 microseconds per quarter note.

| Encoding | Length | Operands | Effect |
|---|---:|---|---|
| `8n` | 3 | key, velocity | Note Off. |
| `9n` | variable | key, velocity, duration VLQ | Note On with embedded duration. |
| `An` | 3 | key, pressure | Polyphonic pressure. |
| `Bn` | 3 | controller, value | Controller change. |
| `Cn` | 2 | program | Program change. |
| `Dn` | 2 | pressure | Channel pressure. |
| `En` | 3 | LSB, MSB | Pitch bend. |
| `FF 51` | 5 | 24-bit tempo | Set microseconds per quarter; no MIDI length byte. |
| `FF 2F` | 2 | None | End track; no MIDI length byte. |
| `FF 2E` | 4 | two marker bytes | Begin per-track loop. |
| `FF 2D` | 8 | initial count, current count, back-distance `u32` | Loop backward; current `0xFF` repeats forever. |
| `FE FE` | 2 | None | Emit literal `FE`. |
| `FE` block | 4 | back-distance `u16`, length `u8` | Copy logical bytes from `physicalPosition - (back + 4)`; copied bytes are not recursively decoded as block codes. |

All 63 sequences decode without unsupported events: 102,868 Note On events and
30,889 compact backreferences. Controllers present are volume `0x07`, pan
`0x0A`, FX mix `0x5B`, and `0x15`, `0x16`, `0x17`, `0x19` whose exact compiled
effects remain unknown. Loops are per track; preserve independent cursors,
running status, block-copy state, and counters. Forty-three sequences contain
an infinite track loop and 20 terminate normally.

### 5.3 Instruments and sample encoding

Verified from ROM bytes and standard Nintendo audio structures. The music bank
has nominal sample rate 32,000 Hz, 57 program slots (0 and 1 alias), 56 unique
instruments, 171 sounds/keymaps, 56 envelopes, and 139 unique waves. Program 9
is also the percussion pointer. Every program 0–56 occurs in at least one
sequence.

The SFX bank has nominal bank rate 44,100 Hz but is mixed through the same
32,000 Hz output. It contains one instrument, 106 sounds/keymaps/waves, and one
shared envelope. The 630 public SFX records reach these waves indirectly
through the custom tables.

All 245 waves are Nintendo VADPCM. Predictor books are order 2 with four
predictors: two header words followed by 64 signed 16-bit coefficients. A
9-byte frame decodes to 16 PCM samples. When a stored extent is `9*n + 1`, the
last byte is alignment and is not an audio frame. The music bank has 95
infinite sample loops and 44 one-shots; the SFX bank has 34 infinite loops and
72 one-shots. Each infinite loop uses count `0xFFFFFFFF`, decoded start/end
sample positions, and a stored 16-sample ADPCM decoder state that must be
restored on wrap.

### 5.4 Music catalog and loop points

Verified from ROM bytes and disassembly. A signed-16 public-ID map at ROM
`0x00068210` maps ID 0 to `-1` and IDs 1–63 bijectively onto sequence indices
0–62. A label table at ROM `0x00068780` begins with counts `{63,630}` and 63
fixed 24-byte music labels. These labels are ROM-native.

The ROM's visible enumeration exposes 62 entries and deliberately omits ID 58,
sequence 62, `058ZZZZ`. That 105-byte entry contains no notes or program
changes and loops silence indefinitely. It should be hidden from the normal
music list but may appear under an internal-content toggle.

The catalog's “one-pass span” is the latest first-pass loop-end or end-of-track
time. It is UI metadata, not a global loop point; tracks within one song can
loop at different ticks.

| Public ID | Seq | ROM-native label | Behavior | Infinite track-loop spans (ticks) | One-pass span |
|---:|---:|---|---|---|---:|
| 1 | 0 | `001K4BOSS1` | loop | 1777–75505 | 65.908 s |
| 2 | 1 | `002K4BOSS2` | loop | 44598–155190; 47670–158262; 52278–162870; 56886–167478; 61494–172086; 69174–179766 | 165.116 s |
| 3 | 4 | `003K4CLEAR` | one-shot | — | 5.817 s |
| 4 | 5 | `004K4CLEARSH` | one-shot | — | 2.817 s |
| 5 | 6 | `005K4DEAD` | one-shot | — | 4.733 s |
| 6 | 7 | `006K4DEMOSIMOBE1` | loop | 55–73783 | 66.256 s |
| 7 | 8 | `007K4DEMOSIMOBE2` | loop | 38–36902 | 48.456 s |
| 8 | 9 | `008K4DEMOSIMOBE3` | loop | 632–148088 | 130.729 s |
| 9 | 10 | `009K4FANFARE1` | loop | 1573–26149; 4645–29221 | 32.976 s |
| 10 | 11 | `010K4FIELD1` | loop | 6634–55786; 8170–57322 | 59.711 s |
| 11 | 12 | `019K4FIELD10` | loop | 1588–81460 | 77.14 s |
| 12 | 13 | `020K4FIELD11` | loop | 821–86837 | 81.247 s |
| 13 | 14 | `021K4FIELD12` | loop | 1590–93750 | 86.168 s |
| 14 | 15 | `022K4FIELD13` | loop | 1571–75299 | 105.995 s |
| 15 | 16 | `011K4FIELD2` | loop | 3286–89302; 15574–101590 | 93.374 s |
| 16 | 17 | `012K4FIELD3` | loop | 46–73774 | 79.5 s |
| 17 | 18 | `013K4FIELD4` | loop | 47–43823 | 46.538 s |
| 18 | 19 | `014K4FIELD5` | loop | 37–53797 | 69.726 s |
| 19 | 20 | `015K4FIELD6` | loop | 24–69912; 221–70109 | 144.136 s |
| 20 | 21 | `016K4FIELD7` | loop | 47644–93724; 47708–93788; 47742–93822 | 164.713 s |
| 21 | 22 | `017K4FIELD8` | loop | 1583–90671 | 95.082 s |
| 22 | 23 | `018K4FIELD9` | loop | 1582–93742; 3118–95278; 4654–96814 | 105.049 s |
| 23 | 24 | `023K4GAMEOVER1` | loop | 4168–16456 | 23.75 s |
| 24 | 25 | `024K4GOALGAME1` | loop | 0–3072; 15–3087; 128–3200; 256–3328 | 3.401 s |
| 25 | 27 | `025K4ISOGASI1` | loop | 456–16008; 463–16015; 1423–16975; 2383–17935 | 19.064 s |
| 26 | 28 | `026K4LEVEL1` | loop | 45–24621 | 27.284 s |
| 27 | 29 | `027K4LEVEL2` | loop | 51–24627 | 24.05 s |
| 28 | 30 | `028K4LEVEL3` | loop | 167–12455 | 15.822 s |
| 29 | 31 | `029K4LEVEL4` | loop | 52–49204 | 46.595 s |
| 30 | 32 | `030K4LEVEL5` | loop | 27–12315; 91–12379 | 22.49 s |
| 31 | 33 | `031K4MUTEKI1` | loop | 236–6380 | 7.121 s |
| 32 | 34 | `032K4RENSYUU1` | loop | 247–73975 | 66.813 s |
| 33 | 35 | `033K4ROCKN1` | loop | 440–55736 | 49.764 s |
| 34 | 36 | `034K4ROOM1` | loop | 1587–20019 | 19.309 s |
| 35 | 37 | `035K4SELECT1` | loop | 243–24819 | 24.238 s |
| 36 | 38 | `036K4SELECT2` | loop | 47–24623 | 26.175 s |
| 37 | 39 | `037K4SELECT3` | loop | 30–61470; 107–61547; 133–61573 | 100.357 s |
| 38 | 40 | `038K4SELECT4` | loop | 23–12311; 49–12337; 92–12380; 114–12402 | 26.185 s |
| 39 | 42 | `039K4TYUBOSS1` | loop | 452–18884 | 13.789 s |
| 40 | 43 | `040K4TYUBOSS2` | loop | 230–18662 | 24.504 s |
| 41 | 44 | `041K4TYUBOSS3` | loop | 12709–37285; 12721–37297 | 37.842 s |
| 42 | 45 | `042MV0_01` | one-shot | — | 44.983 s |
| 43 | 46 | `043MV0_02` | one-shot | — | 39.165 s |
| 44 | 47 | `046MV1_AD01` | one-shot | — | 29.041 s |
| 45 | 48 | `047MV1_AD02` | one-shot | — | 17.976 s |
| 46 | 49 | `048MV1_DEDE01` | one-shot | — | 33.041 s |
| 47 | 50 | `049MV1_DEDE02` | one-shot | — | 25.528 s |
| 48 | 51 | `050MV1_NEXTMAP` | one-shot | — | 27.055 s |
| 49 | 52 | `044MV1_WAD01` | one-shot | — | 19.345 s |
| 50 | 53 | `045MV1_WAD02` | one-shot | — | 23.057 s |
| 51 | 54 | `051MV2_NEXTMAP` | one-shot | — | 52.9 s |
| 52 | 55 | `052MV3_NEXTMAP` | one-shot | — | 40.056 s |
| 53 | 56 | `053MV4_NEXTMAP` | one-shot | — | 31.057 s |
| 54 | 57 | `054MV5_NEXTMAP` | one-shot | — | 33.103 s |
| 55 | 58 | `056MV6_ENDING` | one-shot | — | 53.348 s |
| 56 | 59 | `055MV6_NEXTMAP` | one-shot | — | 49.38 s |
| 57 | 60 | `057MV7_ENDING` | one-shot | — | 37.989 s |
| 58 | 62 | `058ZZZZ` | silent loop/internal | 54–494646 | 454.637 s |
| 59 | 41 | `059K4SELECT5` | loop | 6449–24881 | 30.855 s |
| 60 | 2 | `060K4BOSS3` | loop | 924–50076 | 47.507 s |
| 61 | 3 | `061K4BOSS4` | loop | 15601–101617; 18673–104689; 24817–110833 | 96.746 s |
| 62 | 26 | `062K4GURUME1` | loop | 62–76862; 1598–78398; 3134–79934; 6206–83006 | 66.172 s |
| 63 | 61 | `063MV8_STAFF` | one-shot | — | 111.274 s |


## 6. Unused and hidden content

### 6.1 Unreferenced assets

Verified from ROM bytes. No orphan bank-7 stage content exists: all nonempty
geometry IDs 1–210 are referenced exactly once by the 181 areas, auxiliary IDs
1–58 are used as dust settings/images, and setup IDs 59–239 are used exactly
once. The six hidden/test areas and the separate retail tutorial are referenced
content, not loose files.

Every `(bank,entityId,action)` tuple placed in those seven noncampaign areas
also occurs in campaign content, so they do not establish a test-only actor
class. Four bank-5
selectors `0x115`–`0x118` retained in `M22RUINS01` exceed the constructor's
accepted range and produce no object; treating them as cut stage actors is a
**Hypothesis**.

This is an exhaustive stage-bank audit, not a whole-program proof that every
texture, animation, model, or member in banks 0–6 is referenced. Orphan status
outside bank 7 remains unknown.

Music ID 58 / sequence 62, `058ZZZZ`, is the strong dummy candidate described
in the music catalog. It is excluded from the 62-entry visible enumeration and
has no stage reference. A source-tree call-site search found no literal
playback call for ID 58. Indirect table-driven use is not exhaustively
disproven.

### 6.2 Cut or inaccessible levels

Verified from ROM bytes. The ordinary per-world level-count array is
`4,5,5,5,5,4,1`; it exposes only group 7-1 through campaign selection. Three
additional valid selector entries point to seven ROM-resident area records:

| Record | Selector | ROM-native name | Geometry | Setup | Reachability and static contents |
|---:|---|---|---|---|---|
| 203 | 7-2-1 | `ABE200` | `7:204` | `7:233` | No known retail route; two placed entities. |
| 204 | 7-2-2 | `ABE100` | `7:205` | `7:234` | No known retail route; no entity list. |
| 206 | 7-3-1 | `EXERCISE01` | `7:206` | `7:235` | Retail Copy tutorial, frame/RAM verified; eleven bank-0 entities. |
| 208 | 7-4-1 | `ENETEST1` | `7:207` | `7:236` | No known retail route; collision/path data, no entity list or reachable display list. |
| 209 | 7-4-2 | `ENETEST2` | `7:208` | `7:237` | No known retail route; collision/path data, no entity list. |
| 210 | 7-4-3 | `ITEM01` | `7:209` | `7:238` | No known retail route; regular grid of 36 bank-3 items. |
| 211 | 7-4-4 | `BREAKTEST1` | `7:210` | `7:239` | No known retail route; collision/path data, no entity list. |

No campaign setup's stored warp destination targets these three groups. The
retail tutorial UI nevertheless reaches 7-3 through a code-driven route,
verified from a clean File 1 with ordinary controller input. The count table,
warp scan, and source inspection establish no route for 7-2 or 7-4, but do not
prove one cannot exist. Their developer names support a test-content
interpretation; the specific purpose of `ABE100`/`ABE200` is unknown.

### 6.3 Debug features

Verified from ROM bytes. The retail image contains complete CPU/FPU crash text,
GObj/display-list/camera/thread/stack/DMA pages, and diagnostics including
`Audio Heap Overflow`, `Error: No Entry BGM Number: %d`,
`Job Request Deep OverFlow`, and `setUpDispose failed`.

Source-derived from the fixed public decompilation: startup launches the crash
screen thread and installs a game-specific page callback. On a CPU fault/break
or watchdog timeout, the viewer waits for exact held chords with full release
between steps: `Z+L+R`, `D-Up+C-Up`, `A+D-Left`, `B+D-Right`, then
`D-Down+C-Down`. Further release/`Z+L+R` operations page through views. This is
active gated retail code, not only dead strings; emulator reproduction remains
unverified.

Source-derived: during the HAL-logo state, controller 2 can enter
`L` plus `C-Up`, `C-Up`, `R`, `C-Right`, `C-Left`, `Start` within four seconds.
With a specific save-array precondition, the callback force-completes source
save element 2 and plays the 1-Up sound. The user-facing save-slot numbering was
not dynamically confirmed.

Source-derived negative result: no retail stage-select/debug-menu front end was
found in the inspected source. A title-screen `Z+L+R` check changes a
confirmation sound but does not enter a stage selector.

### 6.4 Prototype or revision-specific content

Verified from ROM bytes. Developer residue includes `-HALKEN--KIRBY4-`, area
and audio labels, and source-style error labels such as `[kirby.cc]` and
`[enelib.cc]`. These are diagnostic metadata rather than additional playable
content.

Only the USA ROM was available. A source-labeled wrong-region presentation path
exists, but without Japanese or European images it cannot be classified as
regional residue. No positive cross-region claim is made.

## 7. nviewer implementation

### 7.1 Module mapping

Recommended module ownership is:

| Module | Difficulty | Responsibility |
|---|---|---|
| `src/rom/kirby64/fs.ts` | Low | ROM validation, bank headers, raw member extents, and overlay-address conversion. |
| `src/rom/kirby64/geometry.ts` | High | Geometry headers, layout modes, relocation lists, display-list roots, material graphs, and image resolution. |
| `src/rom/kirby64/level.ts` | Medium | World/level selector, area descriptors, setup headers, paths, environment, and layer assembly. |
| `src/rom/kirby64/collision.ts` | Medium | Collision arrays, flags/types, dynamic groups, BSP metadata, and water volumes. |
| `src/rom/kirby64/objects.ts` | High | Placements, fixed model selectors, bank-5 resources, markers, skeletons, and animation. |
| `src/rom/kirby64/music.ts` | High | `S1` sequence archive, public-ID remap, instrument banks, compact events, and player adapter. |
| `src/rom/kirby64/kirby64.ts` | Low | Level catalog, open/load contract, music adapter, and transfer-safe results; `NK4E` detection is in `src/rom/index.ts`. |

Shared `displaylist.ts` can parse F3DEX2 and `music/libultra.ts` can supply the
Nintendo sequence/synthesis foundation if their exact command/event variants
are confirmed. Avoid copying asset data: retain ROM-backed slices or newly
owned transferable buffers.

### 7.2 Supported features

An initial implementation can support all 181 area records, primary and
secondary static geometry, backdrop geometry, exact display-list materials,
collision meshes, ordinary fixed-table object models, labeled unresolved
object markers, and all 63 music sequences.

Every drawn instance must belong to a user-toggleable layer. Use `main` (or
named geometry sections), `objects`, `backdrop`, `markers`, and a
hidden-by-default `collision` layer. Do not put ordinary drawable geometry in
the viewer's unlayered fallback.

### 7.3 Approximations and omissions

Until their formats are completely verified, keep texture scrolling, skeletal
animation, stage-overlay-specific actor visuals, exact path camera replay,
water-volume meshes, fog/light tables, and particles explicit as unsupported
or approximate. Never infer collision solidity from face winding alone; honor
triangle sidedness and participation flags.

Implementation verification must include type checking, per-area hashes for
all 181 areas, transferred `structuredClone` loads, layer checks, offline
renders against captured frames, and a browser load of representative normal,
boss, ride, finale, and test areas. Hash comparison against clean HEAD must
show that all previously supported games remain byte-identical.

## 8. Verification and remaining work

### 8.1 Verification evidence

The following independent evidence classes support this manual:

| Evidence | Result |
|---|---|
| Verified from ROM bytes | Header/checksums; overlay and archive partitions; all bank tables and 10,583 extents; 213 area slots; 181 setups; 210 level geometry blocks; 2,911 placements; complete collision corpus; 63 audio sequence extents. |
| Verified by disassembly | Direct-DMA loaders; geometry/image/animation relocation; collision BSP/query behavior; dynamic-group removal; spawn, persistence, and bank dispatch; sequence/audio initialization. |
| Verified against RAM | Live `EXERCISE01` selector/descriptor, loaded geometry header, display-list heads and segment binding, fog word, camera object/matrix, graphics task, audio settings, AI registers, and non-silent PCM submission. |
| Verified from frames | A trustworthy 320x240 interactive Copy-exercise frame visually matched the selected area before audio-register breakpoints; no post-breakpoint campaign frame is claimed. |
| Verified from audio | Sequence/sample structure is ROM-verified; live PCM generation is RAM-verified. Acoustic output was unavailable through the headless dummy plugin. |
| Decompilation | Public source commit `0ff486772fc5fee31756e3a1121b3d2d1057e1d2` supplies descriptive names and corroborates structures; names are not treated as ROM-native. |

### 8.2 Known unknowns

- Other regional/revision offsets and content differences.
- Exact semantics of collision types `0x05`, `0x06`, `0x0A`, and `0x0E`, and
  water flow codes.
- Complete texture-scroll, skeleton/keyframe, and some mode-specific geometry
  entry formats.
- Exact meanings of placement behavior bits `0x01` and `0x10`, friendly names
  for most bank-7 helpers, bank-5 resource identities, and stage-specific
  bank-8 models.
- Full camera-node stored boundaries, environment color/fog/light records, and
  faithful rail-camera replay.
- Whether selectors 7-2 and 7-4 have an undiscovered retail route.
- Exact fields in the three custom SFX tables and compiled effects of sequence
  controllers `0x15`, `0x16`, `0x17`, and `0x19`.

### 8.3 References

- [Kirby 64 decompilation, fixed research revision](https://github.com/kirby64ret/kirby64/tree/0ff486772fc5fee31756e3a1121b3d2d1057e1d2) — source-derived labels and corroboration.
- [Nintendo 64 programming manuals](https://ultra64.ca/files/documentation/online-manuals/man-v5-2/) — display-list, vertex, audio-bank, and ABI conventions.
- [n64ops](https://jrra.zone/n64/doc/n64ops/) — MIPS and RSP instruction reference used for disassembly interpretation.

## Appendix A. Complete area catalog

The following catalog is verified from ROM bytes. World names are conventional;
developer names and numeric fields are ROM-resident. `Geometry` and `Setup` use
`bank:index`. Every row in 1-1 through 7-1 is retail campaign content. Group
7-3 is a runtime-verified retail tutorial. Groups 7-2 and 7-4 are selected by
the internal table but have no established retail route.

### 1-1 — Pop Star

Reachability: **campaign**. Stage record array begins at ROM `0x000783f4`; 5 areas before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M11PLAIN01` | `7:1` | 2 | 127 | 13 | `7:59` | 9 | normal |
| 2 | `M11PLAINRG` | `7:2` | 3 | 127 | 34 | `7:60` | 3 | mini-boss |
| 3 | `M11PLAIN03` | `7:3` | 4 | 127 | 13 | `7:61` | 7 | normal |
| 4 | `M11PLAIN02` | `7:4` | 5 | 127 | 39 | `7:62` | 3 | character boss |
| 5 | `G11` | `7:5` | 6 | 127 | 24 | `7:63` | 1 | stage end |

### 1-2 — Pop Star

Reachability: **campaign**. Stage record array begins at ROM `0x000784cc`; 7 areas before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M12WOODS01` | `7:6` | 7 | 127 | 18 | `7:64` | 8 | normal |
| 2 | `M12WOODS02` | `7:7` | 0 | 127 | 18 | `7:65` | 5 | normal |
| 3 | `M12WOODS03` | `7:8` | 0 | 127 | 18 | `7:66` | 6 | normal |
| 4 | `M12WOODS04` | `7:9` | 0 | 127 | 18 | `7:67` | 5 | normal |
| 5 | `M12WOODSRG` | `7:10` | 0 | 127 | 34 | `7:68` | 3 | mini-boss |
| 6 | `MBADO01` | `7:11` | 8 | 127 | 40 | `7:69` | 4 | character boss |
| 7 | `G12` | `7:12` | 9 | 127 | 24 | `7:70` | 1 | stage end |

### 1-3 — Pop Star

Reachability: **campaign**. Stage record array begins at ROM `0x000785ec`; 10 areas before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M13CASTLE01` | `7:13` | 10 | 127 | 13 | `7:71` | 10 | normal |
| 2 | `M13CASTLE02` | `7:14` | 0 | 127 | 8 | `7:72` | 3 | normal |
| 3 | `M13CASTLE03` | `7:15` | 0 | 127 | 8 | `7:73` | 5 | normal |
| 4 | `M13CASTLE04` | `7:16` | 0 | 127 | 8 | `7:74` | 3 | normal |
| 5 | `M13CASTLE05` | `7:17` | 11 | 127 | 13 | `7:75` | 10 | normal |
| 6 | `M13CASTLE06` | `7:18` | 0 | 127 | 8 | `7:76` | 3 | normal |
| 7 | `M13CASTLEADO` | `7:19` | 0 | 127 | 8 | `7:77` | 3 | normal |
| 8 | `M13CASTLE07` | `7:20` | 0 | 127 | 8 | `7:78` | 4 | normal |
| 9 | `MBDEDEDE01` | `7:21` | 12 | 127 | 41 | `7:79` | 8 | character boss |
| 10 | `G13` | `7:22` | 0 | 127 | 24 | `7:80` | 1 | stage end |

### 1-4 — Pop Star

Reachability: **campaign**. Stage record array begins at ROM `0x00078778`; 1 area before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M1WHISPY` | `7:23` | 13 | 127 | 1 | `7:81` | 1 | world boss |

### 2-1 — Rock Star

Reachability: **campaign**. Stage record array begins at ROM `0x000787c0`; 6 areas before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M21DESERT01` | `7:24` | 14 | 127 | 12 | `7:82` | 7 | normal |
| 2 | `M21DESERT02` | `7:25` | 15 | 127 | 12 | `7:83` | 7 | normal |
| 3 | `M21DESERTRG` | `7:26` | 0 | 127 | 34 | `7:84` | 4 | mini-boss |
| 4 | `M21DESERT03` | `7:27` | 0 | 127 | 12 | `7:85` | 4 | normal |
| 5 | `M21DESERT04` | `7:28` | 16 | 127 | 12 | `7:86` | 6 | normal |
| 6 | `G21` | `7:29` | 17 | 127 | 24 | `7:87` | 1 | stage end |

### 2-2 — Rock Star

Reachability: **campaign**. Stage record array begins at ROM `0x000788bc`; 7 areas before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M22RUINS01` | `7:30` | 18 | 127 | 19 | `7:88` | 10 | normal |
| 2 | `M22RUINS05` | `7:31` | 19 | 127 | 19 | `7:89` | 8 | normal |
| 3 | `M22RUINS02` | `7:32` | 0 | 127 | 19 | `7:90` | 3 | normal |
| 4 | `M22RUINS03` | `7:33 + 7:34` | 18 | 127 | 19 | `7:91` | 5 | normal |
| 5 | `M22RUINS04` | `7:35` | 19 | 127 | 19 | `7:92` | 6 | normal |
| 6 | `M22RUINSDEDEDE` | `7:36` | 0 | 127 | 19 | `7:93` | 5 | Dedede ride |
| 7 | `G22` | `7:37` | 0 | 127 | 24 | `7:94` | 1 | stage end |

### 2-3 — Rock Star

Reachability: **campaign**. Stage record array begins at ROM `0x000789dc`; 9 areas before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M23SAND01` | `7:38` | 0 | 127 | 8 | `7:95` | 9 | normal |
| 2 | `M23SAND02` | `7:39` | 0 | 127 | 8 | `7:96` | 9 | normal |
| 3 | `M23SANDRG` | `7:40` | 0 | 127 | 34 | `7:97` | 2 | mini-boss |
| 4 | `M23SAND03` | `7:41` | 0 | 127 | 8 | `7:98` | 12 | normal |
| 5 | `M23SAND04` | `7:42 + 7:43` | 0 | 127 | 8 | `7:99` | 9 | normal |
| 6 | `M23SAND06` | `7:44 + 7:45` | 0 | 127 | 8 | `7:100` | 5 | normal |
| 7 | `M23SAND07` | `7:46` | 0 | 127 | 8 | `7:101` | 5 | normal |
| 8 | `M23SAND05` | `7:47` | 0 | 127 | 8 | `7:102` | 5 | normal |
| 9 | `G23` | `7:48` | 0 | 127 | 24 | `7:103` | 1 | stage end |

### 2-4 — Rock Star

Reachability: **campaign**. Stage record array begins at ROM `0x00078b44`; 9 areas before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M24PYRAMID01` | `7:49` | 20 | 127 | 12 | `7:104` | 10 | normal |
| 2 | `M24PYRAMID02` | `7:50 + 7:51` | 0 | 127 | 17 | `7:105` | 2 | normal |
| 3 | `M24PYRAMID03` | `7:52 + 7:53` | 0 | 127 | 17 | `7:106` | 4 | normal |
| 4 | `M24PYRAMIDADO1` | `7:54` | 0 | 127 | 17 | `7:107` | 3 | normal |
| 5 | `M24PYRAMIDADO2` | `7:55` | 0 | 127 | 17 | `7:108` | 5 | normal |
| 6 | `M24PYRAMID04` | `7:56` | 21 | 127 | 17 | `7:109` | 6 | normal |
| 7 | `M24PYRAMIDRG` | `7:57` | 0 | 127 | 34 | `7:110` | 4 | mini-boss |
| 8 | `M24PYRAMID05` | `7:58` | 0 | 127 | 17 | `7:111` | 4 | normal |
| 9 | `G24` | `7:59` | 22 | 127 | 24 | `7:112` | 1 | stage end |

### 2-5 — Rock Star

Reachability: **campaign**. Stage record array begins at ROM `0x00078cac`; 1 area before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M2PIX` | `7:60` | 23 | 127 | 1 | `7:113` | 2 | world boss |

### 3-1 — Aqua Star

Reachability: **campaign**. Stage record array begins at ROM `0x00078cf4`; 7 areas before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M31SEASIDE01` | `7:61 + 7:62` | 24 | 127 | 10 | `7:114` | 7 | normal |
| 2 | `M31SEASIDE02` | `7:63` | 24 | 127 | 10 | `7:115` | 6 | normal |
| 3 | `M31SEASIDE03` | `7:64` | 0 | 127 | 10 | `7:116` | 5 | normal |
| 4 | `M31SEASIDE06` | `7:65 + 7:66` | 0 | 127 | 10 | `7:117` | 7 | normal |
| 5 | `M31SEASIDERG` | `7:67` | 0 | 127 | 34 | `7:118` | 3 | mini-boss |
| 6 | `M31SEASIDE05` | `7:68` | 24 | 127 | 10 | `7:119` | 7 | normal |
| 7 | `G31` | `7:69` | 25 | 127 | 24 | `7:120` | 1 | stage end |

### 3-2 — Aqua Star

Reachability: **campaign**. Stage record array begins at ROM `0x00078e14`; 7 areas before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M32RIVER01` | `7:70 + 7:71` | 27 | 127 | 15 | `7:121` | 7 | normal |
| 2 | `M32RIVER03` | `7:72 + 7:73` | 0 | 127 | 15 | `7:122` | 5 | normal |
| 3 | `M32RIVERRG` | `7:74` | 0 | 127 | 34 | `7:123` | 5 | mini-boss |
| 4 | `M32RIVERDEE` | `7:75` | 29 | 127 | 15 | `7:124` | 11 | log ride |
| 5 | `M32RIVER05` | `7:76` | 28 | 127 | 15 | `7:125` | 8 | normal |
| 6 | `M32RIVER04` | `7:77 + 7:78` | 26 | 127 | 15 | `7:126` | 8 | normal |
| 7 | `G32` | `7:79` | 30 | 127 | 24 | `7:127` | 1 | stage end |

### 3-3 — Aqua Star

Reachability: **campaign**. Stage record array begins at ROM `0x00078f34`; 8 areas before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M33COAST06` | `7:80` | 0 | 127 | 10 | `7:128` | 7 | normal |
| 2 | `M33COAST01` | `7:81 + 7:82` | 31 | 127 | 10 | `7:129` | 8 | normal |
| 3 | `M33COAST03` | `7:83` | 0 | 127 | 10 | `7:130` | 4 | normal |
| 4 | `M33COAST02` | `7:84` | 32 | 5 | 10 | `7:131` | 12 | normal |
| 5 | `M33COAST04` | `7:85 + 7:86` | 33 | 127 | 10 | `7:132` | 7 | normal |
| 6 | `M33COASTRG` | `7:87` | 0 | 127 | 34 | `7:133` | 5 | mini-boss |
| 7 | `M33COAST05` | `7:88 + 7:89` | 0 | 127 | 10 | `7:134` | 6 | normal |
| 8 | `G33` | `7:90` | 34 | 127 | 24 | `7:135` | 1 | stage end |

### 3-4 — Aqua Star

Reachability: **campaign**. Stage record array begins at ROM `0x00079078`; 7 areas before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M34SUBMARINE01` | `7:91` | 35 | 57 | 19 | `7:136` | 3 | normal |
| 2 | `M34SUBMARINE02` | `7:92` | 36 | 127 | 19 | `7:137` | 7 | normal |
| 3 | `M34SUBMARINE03` | `7:93` | 0 | 127 | 19 | `7:138` | 5 | normal |
| 4 | `M34SUBMARINE05` | `7:94` | 0 | 127 | 19 | `7:139` | 10 | normal |
| 5 | `M34SUBMARINERG` | `7:95` | 0 | 127 | 34 | `7:140` | 3 | mini-boss |
| 6 | `M34SUBMARINE04` | `7:96` | 0 | 127 | 19 | `7:141` | 8 | normal |
| 7 | `G34` | `7:97` | 0 | 127 | 24 | `7:142` | 1 | stage end |

### 3-5 — Aqua Star

Reachability: **campaign**. Stage record array begins at ROM `0x00079198`; 1 area before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M3ACRO` | `7:98` | 0 | 127 | 1 | `7:143` | 3 | world boss |

### 4-1 — Neo Star

Reachability: **campaign**. Stage record array begins at ROM `0x000791e0`; 7 areas before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M41JUNGLE01` | `7:99` | 37 | 127 | 13 | `7:144` | 8 | normal |
| 2 | `M41JUNGLE03` | `7:100` | 38 | 19 | 13 | `7:145` | 3 | normal |
| 3 | `M41JUNGLE06` | `7:101` | 39 | 19 | 13 | `7:146` | 9 | normal |
| 4 | `M41JUNGLERG` | `7:102` | 40 | 19 | 34 | `7:147` | 3 | mini-boss |
| 5 | `M41JUNGLE05` | `7:103` | 41 | 19 | 13 | `7:148` | 8 | normal |
| 6 | `M41JUNGLE02` | `7:104` | 42 | 19 | 13 | `7:149` | 7 | normal |
| 7 | `G41` | `7:105` | 43 | 127 | 24 | `7:150` | 1 | stage end |

### 4-2 — Neo Star

Reachability: **campaign**. Stage record array begins at ROM `0x00079300`; 8 areas before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M42CAVERN01` | `7:106` | 0 | 127 | 11 | `7:151` | 2 | normal |
| 2 | `M42CAVERNDEE` | `7:107` | 0 | 127 | 11 | `7:152` | 10 | minecart ride |
| 3 | `M42CAVERN06` | `7:108 + 7:109` | 0 | 127 | 11 | `7:153` | 8 | normal |
| 4 | `M42CAVERN03` | `7:110` | 0 | 127 | 11 | `7:154` | 8 | normal |
| 5 | `M42CAVERN05` | `7:111` | 0 | 127 | 11 | `7:155` | 9 | normal |
| 6 | `M42CAVERNRG` | `7:112` | 0 | 127 | 34 | `7:156` | 4 | mini-boss |
| 7 | `M42CAVERN04` | `7:113` | 0 | 127 | 11 | `7:157` | 5 | normal |
| 8 | `G42` | `7:114` | 0 | 127 | 24 | `7:158` | 1 | stage end |

### 4-3 — Neo Star

Reachability: **campaign**. Stage record array begins at ROM `0x00079444`; 6 areas before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M43ROCK01` | `7:115 + 7:116` | 44 | 5 | 12 | `7:159` | 6 | normal |
| 2 | `M43ROCK02` | `7:117` | 45 | 5 | 12 | `7:160` | 7 | normal |
| 3 | `M43ROCKADO1` | `7:118` | 47 | 5 | 12 | `7:161` | 4 | normal |
| 4 | `M43ROCKADO2` | `7:119` | 47 | 5 | 12 | `7:162` | 3 | normal |
| 5 | `M43ROCK03` | `7:120` | 46 | 5 | 12 | `7:163` | 7 | normal |
| 6 | `G43` | `7:121` | 48 | 5 | 24 | `7:164` | 1 | stage end |

### 4-4 — Neo Star

Reachability: **campaign**. Stage record array begins at ROM `0x00079540`; 8 areas before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M44LAVA01` | `7:122` | 49 | 127 | 11 | `7:165` | 5 | normal |
| 2 | `M44LAVA02` | `7:123` | 0 | 127 | 11 | `7:166` | 8 | normal |
| 3 | `M44LAVADEDE` | `7:124` | 0 | 127 | 11 | `7:167` | 10 | Dedede ride |
| 4 | `M44LAVA03` | `7:125` | 0 | 127 | 11 | `7:168` | 10 | normal |
| 5 | `M44LAVA04` | `7:126` | 0 | 127 | 11 | `7:169` | 5 | normal |
| 6 | `M44LAVA06` | `7:127` | 0 | 127 | 11 | `7:170` | 9 | normal |
| 7 | `M44LAVA05` | `7:128` | 0 | 127 | 11 | `7:171` | 7 | normal |
| 8 | `G44` | `7:129` | 0 | 127 | 24 | `7:172` | 1 | stage end |

### 4-5 — Neo Star

Reachability: **campaign**. Stage record array begins at ROM `0x00079684`; 1 area before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M4MOLTEN` | `7:130` | 0 | 127 | 1 | `7:173` | 3 | world boss |

### 5-1 — Shiver Star

Reachability: **campaign**. Stage record array begins at ROM `0x000796cc`; 7 areas before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M51SNOW01` | `7:131` | 50 | 127 | 16 | `7:174` | 7 | normal |
| 2 | `M51SNOW02` | `7:132 + 7:133` | 51 | 127 | 16 | `7:175` | 6 | normal |
| 3 | `M51SNOWDEE` | `7:134` | 0 | 51 | 16 | `7:176` | 12 | sled ride |
| 4 | `M51SNOWRG01` | `7:135` | 0 | 127 | 34 | `7:177` | 5 | mini-boss |
| 5 | `M51SNOW05` | `7:136 + 7:137` | 0 | 51 | 16 | `7:178` | 14 | normal |
| 6 | `M51SNOW04` | `7:138 + 7:139` | 50 | 127 | 16 | `7:179` | 10 | normal |
| 7 | `G51` | `7:140` | 53 | 127 | 24 | `7:180` | 1 | stage end |

### 5-2 — Shiver Star

Reachability: **campaign**. Stage record array begins at ROM `0x000797ec`; 7 areas before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M52CLOUD01` | `7:141` | 54 | 55 | 14 | `7:181` | 7 | normal |
| 2 | `M52CLOUD03` | `7:142` | 56 | 55 | 14 | `7:182` | 7 | normal |
| 3 | `M52CLOUD02` | `7:143` | 55 | 55 | 14 | `7:183` | 7 | normal |
| 4 | `M52CLOUD06` | `7:144` | 58 | 55 | 14 | `7:184` | 10 | normal |
| 5 | `M52CLOUD05` | `7:145` | 57 | 55 | 14 | `7:185` | 8 | normal |
| 6 | `M52CLOUDRG` | `7:146` | 0 | 5 | 34 | `7:186` | 3 | mini-boss |
| 7 | `G52` | `7:147` | 59 | 55 | 24 | `7:187` | 1 | stage end |

### 5-3 — Shiver Star

Reachability: **campaign**. Stage record array begins at ROM `0x0007990c`; 9 areas before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M53BUILDING01` | `7:148` | 60 | 5 | 16 | `7:188` | 5 | normal |
| 2 | `M53BUILDING02` | `7:149` | 61 | 5 | 16 | `7:189` | 6 | normal |
| 3 | `M53BUILDING05` | `7:150` | 0 | 127 | 16 | `7:190` | 8 | normal |
| 4 | `M53BUILDINGRG` | `7:151` | 0 | 127 | 34 | `7:191` | 3 | mini-boss |
| 5 | `M53BUILDINGADO1` | `7:152` | 0 | 127 | 16 | `7:192` | 3 | normal |
| 6 | `M53BUILDINGADO2` | `7:153` | 0 | 127 | 16 | `7:193` | 5 | normal |
| 7 | `M53BUILDING03` | `7:154 + 7:155` | 0 | 127 | 16 | `7:194` | 13 | normal |
| 8 | `M53BUILDING04` | `7:156` | 62 | 5 | 16 | `7:195` | 5 | normal |
| 9 | `G53` | `7:157` | 0 | 5 | 24 | `7:196` | 1 | stage end |

### 5-4 — Shiver Star

Reachability: **campaign**. Stage record array begins at ROM `0x00079a74`; 8 areas before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M54FACTORY01` | `7:158` | 63 | 127 | 16 | `7:197` | 8 | normal |
| 2 | `M54FACTORY02` | `7:159` | 0 | 127 | 21 | `7:198` | 5 | normal |
| 3 | `M54FACTORYDEDE` | `7:160 + 7:161` | 0 | 127 | 21 | `7:199` | 9 | Dedede ride |
| 4 | `M54FACTORY05` | `7:162` | 64 | 127 | 21 | `7:200` | 8 | normal |
| 5 | `M54FACTORYRG` | `7:163` | 0 | 127 | 34 | `7:201` | 7 | mini-boss |
| 6 | `M54FACTORY07` | `7:164 + 7:165` | 64 | 127 | 21 | `7:202` | 9 | normal |
| 7 | `M54FACTORY06` | `7:166 + 7:167` | 0 | 127 | 21 | `7:203` | 5 | normal |
| 8 | `G54` | `7:168` | 0 | 127 | 24 | `7:204` | 1 | stage end |

### 5-5 — Shiver Star

Reachability: **campaign**. Stage record array begins at ROM `0x00079bb8`; 1 area before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M5HR` | `7:169` | 65 | 127 | 1 | `7:205` | 10 | world boss |

### 6-1 — Ripple Star

Reachability: **campaign**. Stage record array begins at ROM `0x00079c00`; 4 areas before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M61RPLAIN02` | `7:170 + 7:171` | 66 | 127 | 13 | `7:206` | 8 | normal |
| 2 | `M61RPLAINRG` | `7:172` | 0 | 127 | 34 | `7:207` | 3 | mini-boss |
| 3 | `M61RPLAIN03` | `7:173` | 67 | 127 | 13 | `7:208` | 7 | normal |
| 4 | `G61` | `7:174` | 69 | 127 | 24 | `7:209` | 1 | stage end |

### 6-2 — Ripple Star

Reachability: **campaign**. Stage record array begins at ROM `0x00079cb4`; 7 areas before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M62RCASTLE01` | `7:175 + 7:176` | 70 | 127 | 20 | `7:210` | 5 | normal |
| 2 | `M62RCASTLE02` | `7:177 + 7:178` | 0 | 127 | 20 | `7:211` | 5 | normal |
| 3 | `M62RCASTLEDE` | `7:179 + 7:180` | 0 | 127 | 20 | `7:212` | 8 | normal |
| 4 | `M62RCASTLE03` | `7:181 + 7:182` | 0 | 127 | 20 | `7:213` | 6 | normal |
| 5 | `M62RCASTLEADO` | `7:183` | 0 | 127 | 20 | `7:214` | 6 | normal |
| 6 | `M62RCASTLE04` | `7:184` | 0 | 127 | 20 | `7:215` | 3 | normal |
| 7 | `G62` | `7:185` | 0 | 127 | 24 | `7:216` | 1 | stage end |

### 6-3 — Ripple Star

Reachability: **campaign**. Stage record array begins at ROM `0x00079dd4`; 12 areas before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M63RCASTLERG01` | `7:186` | 0 | 127 | 22 | `7:217` | 3 | normal |
| 2 | `M63RCASTLERG02` | `7:187` | 0 | 127 | 22 | `7:218` | 3 | mini-boss |
| 3 | `M63RCASTLE05` | `7:188` | 0 | 127 | 22 | `7:219` | 5 | normal |
| 4 | `M63RCASTLERG03` | `7:189` | 0 | 127 | 22 | `7:220` | 3 | mini-boss |
| 5 | `M63RCASTLE06` | `7:190` | 0 | 127 | 22 | `7:221` | 5 | normal |
| 6 | `M63RCASTLERG04` | `7:191` | 0 | 127 | 22 | `7:222` | 3 | mini-boss |
| 7 | `M63RCASTLE07` | `7:192` | 0 | 127 | 22 | `7:223` | 5 | normal |
| 8 | `M63RCASTLERG05` | `7:193` | 0 | 127 | 22 | `7:224` | 3 | mini-boss |
| 9 | `M63RCASTLE08` | `7:194` | 0 | 127 | 22 | `7:225` | 5 | normal |
| 10 | `M63RCASTLERG06` | `7:195` | 0 | 127 | 22 | `7:226` | 3 | mini-boss |
| 11 | `M63RCASTLE09` | `7:196` | 0 | 127 | 22 | `7:227` | 6 | normal |
| 12 | `G63` | `7:197` | 0 | 127 | 24 | `7:228` | 1 | stage end |

### 6-4 — Ripple Star

Reachability: **campaign**. Stage record array begins at ROM `0x00079fa8`; 1 area before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M6MIRACLE` | `7:198` | 0 | 127 | 61 | `7:229` | 2 | world boss |

### 7-1 — Dark Star / special

Reachability: **campaign**. Stage record array begins at ROM `0x00079ff0`; 3 areas before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `M71WADO` | `7:199 + 7:200` | 71 | 127 | 60 | `7:230` | 10 | normal |
| 2 | `M71DEDE` | `7:201 + 7:202` | 71 | 127 | 60 | `7:231` | 6 | normal |
| 3 | `M7LAST` | `7:203` | 71 | 127 | 2 | `7:232` | 2 | final boss |

### 7-2 — Dark Star / special

Reachability: **extra-selector**. Stage record array begins at ROM `0x0007a080`; 2 areas before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `ABE200` | `7:204` | 0 | 127 | 39 | `7:233` | 2 | normal |
| 2 | `ABE100` | `7:205` | 0 | 127 | 39 | `7:234` | 2 | normal |

### 7-3 — Dark Star / special

Reachability: **retail tutorial (runtime-verified)**. Stage record array begins at ROM `0x0007a0ec`; 1 area before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `EXERCISE01` | `7:206` | 72 | 127 | 32 | `7:235` | 3 | normal |

### 7-4 — Dark Star / special

Reachability: **extra-selector**. Stage record array begins at ROM `0x0007a134`; 4 areas before the zero record.

| Area | Internal name | Geometry | Backdrop | Color | Music | Setup | Paths | Type |
|---:|---|---|---:|---:|---:|---|---:|---|
| 1 | `ENETEST1` | `7:207` | 0 | 1 | 39 | `7:236` | 2 | normal |
| 2 | `ENETEST2` | `7:208` | 0 | 127 | 39 | `7:237` | 3 | normal |
| 3 | `ITEM01` | `7:209` | 0 | 127 | 39 | `7:238` | 1 | normal |
| 4 | `BREAKTEST1` | `7:210` | 1 | 127 | 39 | `7:239` | 3 | normal |
