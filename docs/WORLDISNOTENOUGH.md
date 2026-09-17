# 007: The World Is Not Enough — Nintendo 64 ROM format specification

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | One offset-indexed archive of 507 entries, separate scene scripts, animation bank, text, and audio banks. |
| Compression | EDL methods 1 and 2 for archive components; speech uses a separate, undecoded Factor 5 codec. |
| Graphics microcode | F3DEX2 FIFO 2.08. |
| Geometry | Placed mesh components compiled into F3DEX2 display lists at load time. |
| Textures | CI4/CI8 with RGBA16 palettes; I4/I8 in selected draw modes. |
| Collision | Exact query/primitive format unverified; some non-rendered helper planes are present. |
| Music driver | Factor 5 MusyX v1 sequencer and SoundMacro engine. |
| Audio microcode | N64 RSP mixer V1.1. |
| Sample encoding | MusyX ADPCM; speech encoding distinct and undecoded. |
| Levels | 28 selectable missions/arenas; other archive entries contain cutscene and front-end sets. |
| Memory requirement | Base 4 MiB supported; Expansion Pak detected for optional video modes. |
| Viewer support | USA and Europe: 28 retail missions/arenas and 12 archival/front-end sets, plus all 18 songs. |

### 1.2 ROM identification

Verified from normalized ROM bytes. CRC1/CRC2 recomputed with CIC-6102 and matched both headers; SHA-1 covers the complete `.z64` image.

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| USA | `TWINE` | `NO7E` | 0 | 32 MiB (`0x2000000`) | `033F4C13` | `319EE7A7` | `d347159808f0374a93cf44cfb6135d8f56279f7b` | 6102 | Unknown |
| Europe (M3) | `TWINE` | `NO7P` | 0 | 32 MiB (`0x2000000`) | `3B941695` | `F90A5EEB` | `7fde668850a7e1a8402ab94bb09538a537a7e38b` | 6102 | Unknown |

### 1.3 Terminology and conventions

Addresses and offsets below refer to the USA `.z64` image unless labelled Europe. Ranges are half-open. Multi-byte fields are big-endian. An *entry* is a slot in the 507-entry archive index; entries 0–41 are level-addressable but 27 and 37 are common effect/icon models, not playable levels. An *instance* is a `0x44`-byte placement record; a *node* is a load-generated render object. A *scene* is a command script that can load a level and drive a camera, speech, or music. ROM bytes and disassembly establish stored layouts; visual or audio equivalence is separately stated.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

Verified by disassembly of the boot entry and overlay loader.

| ROM range | Stored size | Decoded size | Destination | Compression | Contents |
|---|---:|---:|---|---|---|
| `[0x1000,0xD7C50)` | `0xD6C50` | same | `[0x80000400,0x800D7050)` | none | Main code and data. |
| `[0xD7C50,0xF8D70)` | `0x21120` | one overlay at a time | `0x80117740` | none | Sixteen distinct overlay images indexed by 33 records. |

Entry `0x80000400` clears BSS and establishes the main thread. A test at `0x800005C0` checks `osMemSize` for the Expansion Pak; the menu exposes Hi-Res and Hi-Color modes when available. Overlay records 0, 6, and 32 have no image; 17–31 share the multiplayer overlay image. The loader at `0x80044C4C` copies the selected image and clears overlay BSS.

The overlay index has 33 records of 16 bytes at ROM `0xC3814`/RAM `0x800C2C14`, terminated by the table count rather than a sentinel:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | u32 | `bssStart` | Overlay BSS start; address domain is RAM. |
| `0x04` | 4 | u32 | `bssEnd` | Exclusive overlay BSS end. |
| `0x08` | 4 | u32 | `romStart` | Inclusive ROM image start. |
| `0x0C` | 4 | u32 | `romEnd` | Exclusive ROM image end. |

### 2.2 Memory and address mapping

The main code maps `ROM = VRAM - 0x80000400 + 0x1000`. An overlay maps `ROM = VRAM - 0x80117740 + romStart` while resident. `romCopy` at `0x8000B900` uses PI DMA in 4 KiB chunks; `romCopyAligned` at `0x8000B9B8` uses a bounce buffer for odd offsets or destinations. Archive offsets are relative to ROM `0x54D910`, not virtual addresses. Level data and decompressed components occupy the heap allocated by `0x80083E90`.

### 2.3 ROM map and asset organization

Verified by ROM index walks and corresponding reader routines. Locations for Europe are summarized under [revision differences](#26-revision-differences).

| ROM range | Stored size | Decoded size | Destination | Compression | Contents |
|---|---:|---:|---|---|---|
| `[0xF8D70,0x530BA8)` | `0x437E38` | same | animation cache | none | Quantized animation key data. |
| `[0x530BA8,0x538D08)` | `0x8160` | same | animation cache | none | 1,035 animation records, 32 bytes each. |
| `[0x538D08,0x54D8E8)` | `0x14BE0` | same | animation cache | none | Animation-group data and 121 group descriptors. |
| `[0x54D910,0x14744A4)` | `0xF26B94` | component-dependent | heap | EDL or stored | 507-entry model/level archive; 11,194 EDL streams. |
| `[0x14744B0,0x148B400)` | `0x16F50` | same | scene interpreter | none | 52 scene scripts. |
| `[0x148B400,0x14977A0)` | `0xC3A0` | same | text buffers | none | Dialogue/caption text, 272 strings in each of three languages. |
| `[0x14977A0,0x14CD630)` | `0x35E90` | same | text buffers | none | English, French, and German menu text. |
| `[0x14CD630,0x14E2500)` | `0x14ED0` | same | audio heap | none | MusyX project, pool, sample directory. |
| `[0x14E2500,0x1D54AD0)` | `0x8725D0` | sample-dependent | audio heap | MusyX ADPCM | Music/SFX samples. |
| `[0x1D54AD0,0x1D69630)` | `0x14B60` | sequenced | audio heap | none | 18 MusyX song streams. |
| `[0x1D69630,0x1F282B0)` | `0x1BEC80` | unknown | audio heap | Factor 5 speech codec | Speech table and 276 clips. |
| `[0x1F282B0,0x1F32B90)` | `0xA8E0` | same | `0x80104320` | none | Three attract-demo input recordings. |
| `[0x1F32BA0,0x2000000)` | `0xCD460` | — | — | — | `0xFF` padding. |

There are no archive filenames. The archive index begins at ROM `0xC1380` (RAM `0x800C0780`), contains 507 records of 16 bytes and a zero record, and addresses headers that follow each entry's stored data. Separate menu-text banks start at `0x14977A0`, `0x14A8380`, and `0x14BA940`; the section-0 offsets yield mission names at entries 40–64 plus 269, 278, and 350. The dialogue bank uses three `u32[272]` offset tables at `0x148B400 + 0x440 × languageIndex`, followed by strings. The language indices are English, French, and German.

The menu reader selects one language blob, assigns 11 code-defined section starts within it, and indexes each section as an array of 4-byte entries with code-defined bounds. The dialogue reader similarly chooses one of the three 272-entry tables. In either case the stored index entry is:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `4 × stringIndex` | 4 | u32 | `stringOffset` | Byte offset from the start of the selected language blob to its string. |

The speech bank has an initial count word at ROM `0x1D69630`; the reader uses `0x1D69634` as the offset-table base. The table has no extra terminator:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | u32 | `clipCount` | 276 (`0x114`). |
| `0x04 + 4 × i` | 4 each | u32 | `clipOffset[i]` | Low 24 bits: offset from ROM `0x1D69634` to clip i; high byte is `0x01` in all 276 records. |
| `0x1D69634 + low24(clipOffset[i]) - 4` | 4 | char[4] | `clipTag` | ASCII `MORT` immediately before every clip. |
| `0x1D69634 + low24(clipOffset[i])` | variable | bytes | `clipData` | Begins with a u16 duration tick count interpreted at 75 Hz; remaining Factor 5 encoded voice payload undecoded. |

The offset column above is relative to the count-word address for the table rows, but `clipOffset[i]` itself is relative to the reader's table base `0x1D69634`. The four-byte `MORT` tag is not an index entry. The encoded voice payload is unrelated to EDL.

Each attract-demo recording contains 900 frames of 16 bytes. The title-idle code chooses the three recordings for levels 34, 25, and 1. The frame layout is verified by the game's recorder and playback routines:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | u16 | `input_0` | Controller/input state word. |
| `0x02` | 2 | u16 | `input_1` | Controller/input state word. |
| `0x04` | 2 | u16 | `input_2` | Controller/input state word. |
| `0x06` | 2 | u16 | `input_3` | Controller/input state word. |
| `0x08` | 4 | u32 | `state_08` | Recorded state word. |
| `0x0C` | 4 | u32 | `state_0C` | Recorded state word; counts down in the three ROM recordings. |

The purpose of each input/state word beyond this correspondence is not fully established.

### 2.4 Compression formats

Archive mesh components, texture blobs, and palette blobs use **EDL**, a distinct format with methods 0 (stored), 1 (canonical-Huffman LZ), and 2 (fixed-code LZ). The header includes magic, a method/size-endian byte, compressed size, and decompressed size; see the [EDL reference](compression/edl.md) for the exact bitstream. USA has 11,194 EDL streams (696 method-1, 10,498 method-2); Europe has 11,195 (697 method-1, 10,498 method-2). Method 0 is implemented by the game but absent from both inspected archives. Every stream reached its declared output size and consumed its declared input size; six method-1/2 decompressions captured in RAM were byte-identical to an independent decoder. USA stored EDL streams total `0xC50EE8` bytes (12.3 MiB), yielding `0x136DF27` decoded bytes (19.4 MiB). The speech payload has a different, unverified Factor 5 compression format; do not pass it to EDL.

### 2.5 Loading process

Verified by disassembly and a Courier PI-DMA trace. A request sets u8 `0x80102EDF` to the level and u32 `0x80102EEC` to 1. The loader resets heap/object/view tables, selects an overlay, preloads common models 137, 494, 493, 505, **27**, 42, 251, and **37** (except for title entry 15), reads the level archive header and records, follows model references, decompresses components, constructs render nodes, and runs the 203-case spawn switch. The Courier load included the overlay at `[0xECCE0,0xEDF20)`, about 1.1 MiB of archive reads in 47 merged ranges, and a loading-screen image. Components are shared across entry storage ranges, so extracting each entry as an isolated file loses dependencies.

### 2.6 Revision differences

Verified by aligning the USA and Europe reader code, comparing decompressed archive entries, and reading both ROMs. Both include English, French, and German. The data formats are the same; use a per-release address map.

| Feature | USA | Europe (M3) |
|---|---|---|
| Main code ROM end | `0xD7C50` | `0xD8780` |
| Overlay load address / table ROM | `0x80117740` / `0xC3814` | `0x80118FB0` / `0xC4304` |
| Archive index / base ROM | `0xC1380` / `0x54D910` | `0xC1E70` / `0x54E8D0` |
| Scene script table / data ROM | `0xB3240` / `0x14744B0` | `0xB37E0` / `0x146FC10` |
| Menu text EN / FR / DE ROM | `0x14977A0` / `0x14A8380` / `0x14BA940` | `0x1492F10` / `0x14A3C30` / `0x14B65F0` |
| MusyX project / pool / sample directory / samples ROM | `0x14CD630` / `0x14D0ED0` / `0x14DDC00` / `0x14E2500` | `0x14C8FF0` / `0x14CC890` / `0x14D95C0` / `0x14DDEC0` |
| Speech table ROM | `0x1D69630` | `0x1D64FF0` |

After decompression, 489 of 507 archive entries match between releases. Eighteen differ: about 22 Europe textures are half/quarter resolution, several scene records or meshes change, and one palette changes between stored and EDL representation. Environment and spawn values agree across the 42 level-addressable entries except shifted sky node indices where nodes were inserted. Scene scripts are relocated and four commands change. The Europe code adjusts PAL video framing and language-dependent menu layout; no 50 Hz-specific game-timing constant was established.

## 3. Level data

### 3.1 Level catalog and identifiers

The 28 mission-table records consist of 14 campaign missions and 14 multiplayer arenas. Names are verified from menu text; entry and overlay indices are verified from ROM tables. The intro scene and sky node are data-derived, not hand-selected assets. A dash means no such record was found.

| ID | Name | Kind | Overlay | Instance records | Intro scene | Sky node |
|---:|---|---|---:|---:|---:|---|
| 2 | Courier | campaign | 15 | 552 | 4 | — |
| 20 | King's Ransom | campaign | 8 | 712 | 16 | 336 + layer |
| 16 | Thames Chase | campaign | 13 | 613 | 14 | 272 + layer |
| 34 | Underground Uprising | campaign | 14 | 1005 | 34 | 310 + layer |
| 25 | Cold Reception | campaign | 3 | 383 | 17 | 139 + layer |
| 38 | Night Watch | campaign | 12 | 627 | 44 | 12 |
| 1 | Midnight Departure | campaign | 2 | 684 | 1 | 278 |
| 11 | Masquerade | campaign | 16 | 546 | 8 | 242 |
| 41 | City of Walkways I | campaign | 4 | 728 | 47 | 353 |
| 40 | City of Walkways II | campaign | 5 | 1189 | 49 | 475 |
| 28 | Turncoat | campaign | 7 | 815 | 12 | 125 + layer |
| 18 | Fallen Angel | campaign | 10 | 570 | 37 | 234 + layer |
| 29 | A Sinking Feeling | campaign | 11 | 404 | 24 | — |
| 33 | Meltdown | campaign | 9 | 302 | 26 | — |
| 24 | Labyrinth | multiplayer | 18 | 127 | — | — |
| 31 | Frostbite | multiplayer | 19 | 118 | — | — |
| 7 | Istanbul | multiplayer | 20 | 135 | — | 100 |
| 12 | Forest | multiplayer | 21 | 107 | — | 74 |
| 39 | Hidden Volcano | multiplayer | 17/22 | 132 | — | — |
| 9 | Field of Fire | multiplayer | 23 | 92 | — | — |
| 26 | Sky Rail | multiplayer | 28 | 178 | — | — |
| 32 | Submarine | multiplayer | 27 | 99 | — | — |
| 0 | Air Raid | multiplayer | 24 | 70 | — | — |
| 21 | MI-6 | multiplayer | 25 | 91 | — | — |
| 22 | Silo Surprise | multiplayer | 26 | 128 | — | — |
| 19 | Merchant | multiplayer | 29 | 157 | — | — |
| 23 | Flashpoint | multiplayer | 30 | 213 | — | — |
| 4 | Castle | multiplayer | 31 | 82 | — | 18 |

Scene-script target sets also include 3, 5, 6, 10, 13, 14, 17, 30, and 35. Entry 15 is a title/attract set and 36 a front-end set. Entry 8 has no mission, overlay, or scene reference. Entries 27 and 37 are preloaded common models rather than missing missions; see [unused and hidden content](#6-unused-and-hidden-content).

The mission table at ROM `0xC0EC0`/RAM `0x800C02C0` has 28 records of 32 bytes. It is searched by `0x8003099C`:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x18` | pointers/values | `missionData` | Per-mission list pointers and parameters; individual semantics incomplete. |
| `0x18` | 2 | u16 | `menuTextId` | Section-0 menu-text index. |
| `0x1A` | 2 | u16 | `levelId` | Archive entry/level identifier. |
| `0x1C` | 1 | u8 | `unknown_1C` | Values 3–9 for campaign and 0 for multiplayer; objective count is a hypothesis. |
| `0x1D` | 3 | u8[3] | `unknown_1D` | Unclassified bytes. |

### 3.2 Level container

The archive index at ROM `0xC1380` contains 507 records of `0x10` bytes followed by a zero record. Offsets use the archive base `0x54D910`. Verified by the loaders at `0x80041F68`, `0x800422F4`, `0x800426B8`, and `0x80042CFC`.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | u32 | `headerOffset` | Archive-relative address of the 48-byte entry header. |
| `0x04` | 4 | u32 | `ramHeader` | Zero in ROM; loaded-header pointer at runtime. |
| `0x08` | 4 | u32 | `ramNodes` | Zero in ROM; pointer to `nodeCount` × 76-byte nodes at runtime. |
| `0x0C` | 4 | u32 | `nodeCount` | Render-node count. |

The 48-byte entry header uses archive-relative offsets. Record arrays are counted; no sentinel terminates them:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | u32 | `recordOffset` | Offset of `recordCount` placement records, `0x44` bytes each. |
| `0x04` | 4 | u32 | `recordCount` | Placement record count. |
| `0x08` | 4 | u32 | `extra28Offset` | Offset of `extra28Count` × 28-byte records. |
| `0x0C` | 4 | u32 | `extra28Count` | Extra-record count. |
| `0x10` | 4 | u32 | `paletteTableOffset` | Offset of `paletteCount` × 8-byte palette records. |
| `0x14` | 4 | u32 | `paletteCount` | Palette count. |
| `0x18` | 4 | u32 | `textureTableOffset` | Offset of `textureCount` × 12-byte texture records. |
| `0x1C` | 4 | u32 | `textureCount` | Texture count. |
| `0x20` | 4 | u32 | `paletteBlobOffset` | Offset of palette payload; may hold EDL. |
| `0x24` | 4 | u32 | `paletteBlobSize` | Stored palette payload size. |
| `0x28` | 4 | u32 | `textureBlobOffset` | Offset of texture payload; may hold EDL. |
| `0x2C` | 4 | u32 | `textureBlobSize` | Stored texture payload size. |

A placement record's fields are defined under [placement records](#41-placement-records). Its `subHeaderOffset` addresses a 32-byte mesh descriptor containing four independently stored or EDL-compressed components. Descriptors and components may lie in another entry's storage range: of 74,045 component references, 43,730 point within the referencing entry, 13,655 within the model named by its `modelPtr`, and 16,660 elsewhere. A level cannot be extracted by simply slicing its archive entry.

The mesh descriptor stride is `0x20` bytes; the consumer knows component element sizes A=12, B=4, C=4, D=1. Each component offset addresses an archive payload, and each count states decoded element count:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | u32 | `aOffset` | Position component offset. |
| `0x04` | 2 | u16 | `aCount` | 12-byte position count. |
| `0x06` | 2 | u16 | `unknown_06` | Padding in inspected records. |
| `0x08` | 4 | u32 | `bOffset` | Colour component offset. |
| `0x0C` | 2 | u16 | `bCount` | 4-byte colour count. |
| `0x0E` | 2 | u16 | `unknown_0E` | Padding in inspected records. |
| `0x10` | 4 | u32 | `cOffset` | UV component offset. |
| `0x14` | 2 | u16 | `cCount` | 4-byte UV count. |
| `0x16` | 2 | u16 | `unknown_16` | Padding in inspected records. |
| `0x18` | 4 | u32 | `dOffset` | Mesh-command component offset. |
| `0x1C` | 2 | u16 | `dCount` | Decoded command-byte count. |
| `0x1E` | 1 | u8 | `type` | Spawn switch selector, 203 cases. |
| `0x1F` | 1 | u8 | `unknown_1F` | Unclassified. |

### 3.3 Geometry

The decoded components have these element layouts; component D's byte count terminates at its opcode-12 command.

| Component | Stride | Fields | Meaning |
|---|---:|---|---|
| A | 12 | `x`, `y`, `z`: f32 each | Object-space position. |
| B | 4 | `r`, `g`, `b`, `a`: u8 each | Prelit colour. |
| C | 4 | `s`, `t`: s16 each | Texture coordinates, 1/32 texel units. |
| D | 1 | u8 opcode stream | Load-generated display-list commands. |

Each placement record places one mesh, but repeated records can share one generated node/display list. There are no established room or portal records.

Verified by numerical evaluation of the transformation routine `0x80082FE4`: for column vectors, `world = T(position) · Rz · Ry · Rx`. Record angles are f32 in 4096 units per degree. Mesh positions and record positions are in the same right-handed, Y-up space. The game generates `Vtx` coordinates by truncating `f32 × scale × 64`; scale is 1 except for record flag `0x1000` on types 93 and 115–120, where it is 64. All 7,440 distinct mesh streams parse and their 515,396 triangles index only the current ≤32-vertex load.

### 3.4 Display lists and render state

`0x800336FC` compiles component D into F3DEX2 lists in a count pass and an emission pass. Verified in disassembly and captured RDRAM: VTX opcode `0x01`, TRI1 `0x05`, TRI2 `0x06`, ENDDL `0xDF`. The D-stream opcodes are byte values; each stream ends with opcode 12 exactly at its declared length.

| Opcode | Length | Operands | Effect |
|---:|---|---|---|
| 0 | variable | `u8 n`, then n × `(u8 pos,u8 uv,u8 colour)` | Load n vertices from A/C/B. |
| 1 | variable | `u8 n`, then n × `(u16 pos,u16 uv,u16 colour)` | Load n vertices with 16-bit indices. |
| 2, 3 | variable | count and shared vertex indices | Alternate vertex loads; absent from inspected streams. |
| 4 | 4 | three vertex indices | Emit one triangle; absent from inspected streams. |
| 5 | variable | count and index triples | Emit triangles, pairing adjacent triangles as TRI2. |
| 6 | variable | palette, texture, count, triangle triples | Set distinct palette and texture; absent from inspected streams. |
| 7 | variable | texture/palette index, count, triangle triples | Select same-index palette and texture; emit triangles. |
| 8 | variable | three colour-like bytes, count, triangle triples | Emit untextured triangles; interpretation of the three bytes is unverified. |
| 9 | 4 | three colour-like bytes | Skip three bytes; absent from inspected streams. |
| 10, 11 | 2 | texture or palette index | Set only one binding; absent from inspected streams. |
| 12 | 1 | none | End stream. |

Node byte `+0x45` selects the game's draw-mode state list. Mode 1 uses a backface-culled fogged cutout path; mode 12 is a culled translucent path used by ceiling glows. Modes 3/4/8 and 7/10/13/16 are translucent without backface culling; modes 5/6/9/15 use intensity textures, and 9/15 disable depth comparison. F3DEX2 state lists at `0x800B1A00` onward establish texture filtering, TLUT, render mode, and combiner. The captured Courier world frame called the mode-1 list 12 times; glow type 114 was mode 12 at runtime and used ordinary translucent blending, not additive blending. Intensity-mode PRIM/ENV colours were not captured.

### 3.5 Textures and materials

Texture table records have 12-byte stride, palette records 8-byte stride. A palette index normally equals the texture index. Verified by `0x80032978`, `0x800334A4`, and texture data decoded into legible signage.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 1 | u8 | `flags` | Bit 0: 8-bit texels; bit 1: clamp S; bit 2: clamp T; bit 3 set in observed records. |
| `0x01` | 1 | u8 | `unknown_01` | Unclassified. |
| `0x02` | 2 | u16 | `widthMinusOne` | Width = value + 1. |
| `0x04` | 2 | u16 | `heightMinusOne` | Height = value + 1. |
| `0x06` | 1 | u8 | `count` | Observed as 1; loader's nibble-swap length multiplier. |
| `0x07` | 1 | u8 | `unknown_07` | Unclassified. |
| `0x08` | 4 | u32 | `dataOffset` | Offset into decoded texture blob. |

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 1 | u8 | `entriesMinusOne` | Usually `0x0F` or `0xFF`. |
| `0x01` | 3 | u8[3] | `unknown_01` | Unclassified. |
| `0x04` | 4 | u32 | `dataOffset` | Offset in u16 units into decoded palette blob. |

Most modes use CI4/CI8 texels and RGBA16 (RGBA5551) palettes; modes 5/6/9/15 interpret the corresponding bytes as I4/I8. Four-bit texels are nibble-swapped in storage and swapped by the loader. No RGBA, IA, or mipmap path was found. Typical level textures are at most 128×128; front-end images include 320×240 and 292×112 CI8 textures. UVs use `u=s/(32×width)`, `v=t/(32×height)` when normalized for a viewer. Optional palette colour correction is controlled by RAM byte `0x8010A4FC`; raw palette colours are the unmodified source.

### 3.6 Collision

The complete runtime collision query format is **not established**. Types 30, 31, and 104 contain many untextured or alpha-zero triangles and are plausible helper/collision surfaces, but that interpretation remains a hypothesis. In the captured Courier frame, all 58 helper-plane nodes had null display-list pointers and were not drawn; this proves non-rendering for Courier, not their physical role or behavior in every level. A reader must not treat all visible mesh triangles as verified collision, nor assume these helper planes are the sole collision source. Their position, triangle, and type data can be exposed as provisional hidden geometry pending a collision-code trace.

### 3.7 Environment, sky, fog, and lighting

Each normal level has one type-41 (environment and sky) or type-42 (environment only) record. The spawn pass consumes these placement-record fields, verified by disassembly. For the first six fields only the low byte is copied:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x2C` | 2 | u16 | `fogA` | Low byte is fog parameter A. |
| `0x2E` | 2 | u16 | `fogB` | Low byte is fog parameter B. |
| `0x30` | 2 | u16 | `fogC` | Low byte is fog parameter C. |
| `0x32` | 2 | u16 | `fogRed` | Low byte is fog red. |
| `0x34` | 2 | u16 | `fogGreen` | Low byte is fog green. |
| `0x36` | 2 | u16 | `fogBlue` | Low byte is fog blue. |
| `0x38` | 2 | u16 | `skySpinDivisor` | Inverse divisor for sky spin; zero disables spin. |
| `0x3A` | 2 | u16 | `farPlane` | Far plane in float units. |
| `0x3C` | 2 | u16 | `lightFloor` | Low byte appears to set minimum object brightness (**hypothesis**). |

Entries 5, 13, and 15 and common models 27 and 37 have no environment record.

Verified by disassembly and captured graphics lists: fog multiplier is `B + 120A`; fog offset is `C - 120A`. The game emits F3DEX2 `DB080000` fog factor and `F8` fog colour. A=B=C=0 disables fog. Projection has fovY 60°, default aspect 4:3, near 0.2 and far equal to `+0x3A` in float units. A fill rectangle clears to fog colour in captured gameplay, including no-fog levels (Courier clears black); the gate's non-gameplay behavior is unknown. Eight captured levels matched the record-derived fog words and far planes. The renderer applies fog per vertex, so a per-pixel viewer can differ across large triangles.

Type 41 identifies a node in the level's own entry as the sky mesh. Type 43 adds a second sky layer in levels 6, 10, 16, 18, 20, 25, 28, and 34. The sky is drawn first without depth testing, with camera rotation but no translation; the global sky angle can spin it around Y. Its state list leaves G_FOG enabled. Six captured sky levels drew the expected state list and one or two sky nodes before the world. A type-42 level shows clear colour behind geometry. No separate skybox image or 2D backdrop was established. Geometry uses prelit vertex colours; G_LIGHTING is never set in the inspected display lists.

Runtime environment triggers 145–148 interpolate fog and colour towards target records by up to 12 units per frame; some also change far plane and tint. Meltdown has an additional underwater fog set on type 105. Night vision overrides fog with green; another vision mode uses dark-blue fog and a shorter far plane. Static viewer values therefore represent the initial state, not every in-game state.

### 3.8 Cameras and paths

Scene scripts are 32-bit command streams, 52 in USA, addressed by the table at RAM `0x800B2640`. The low six bits are opcode; the argument is in the high bits or following words. Verified by interpreter disassembly and full script walks. Script camera Z is negated relative to instance space. Not every scene is proven reachable.

| Opcode | Length | Operands | Effect |
|---:|---|---|---|
| 0 | 4 | Level id in command argument | Load a level. |
| 1, 2 | command-dependent | Keyframe data | Set/interpolate camera eye. |
| 5, 6 | command-dependent | Keyframe data | Set/interpolate camera target. |
| 9, 10 | command-dependent | FOV data | Set/interpolate field of view. |
| 30 | 4 | Speech id in command argument | Play speech. |
| 31 | 4 | Song id in command argument | Force music song. |
| 32 | 4 | — | Stop music. |
| 35 | 4 | — | End scene script. |

Other opcodes have known interpreter branches but are not fully described here. Lengths for keyframe commands depend on their payloads and require the interpreter rather than a fixed increment.

Player-start types 35–38 represent up to four player slots; type 44 is a multiplayer respawn point. Campaign levels have three type-35 starts differentiated by difficulty. The viewer's static camera uses the Agent start, yaw `rotY/4096` degrees, forward `(sin yaw,0,cos yaw)`, fovY 60°, and eye at the floor under the record plus 1.62885 float units. Verified against six stationary single-player frames: eye within 0.06 units and yaw exact. The runtime player's eye is object position plus 0.55 while standing on dry land; objects can settle below their start record. Multiplayer start assignment is dynamic (the captured Castle player began at a type-37 record). No independently encoded path graph is established; scene camera keyframes are the known camera paths.

## 4. Objects

### 4.1 Placement records

Each archive entry's counted instance array contains `0x44`-byte records. The `modelPtr` points into the identity table at RAM `0x800C2740` (`table + 2 × modelId`), rather than directly to geometry. The mesh may be stored outside the nominal entry range. Verified by the spawn pass `0x80042CFC` and Courier object-list RAM.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | u16 | `nodeIndex` | Index into the entry's 76-byte node array. |
| `0x02` | 2 | u16 | `extra24Count` | Count of 24-byte extra-position records. |
| `0x04` | 4 | u32 | `unknown_04` | Unclassified. |
| `0x08` | 4 | u32 | `extra24Offset` | Archive-relative offset of extra-position records. |
| `0x0C` | 12 | f32[3] | `position` | X, Y, Z placement in float units. |
| `0x18` | 12 | f32[3] | `rotation` | X, Y, Z angles, 4096 units per degree. |
| `0x24` | 4 | u32 | `subHeaderOffset` | Archive-relative mesh descriptor offset. |
| `0x28` | 4 | u32 | `modelPtr` | RAM pointer to the model-identity table slot. |
| `0x2C` | `0x18` | mixed | `typeData` | Type-dependent environment, spawn, trigger, and object data. |

The extra-position records contain six f32 values, position followed by rotation, and are counted by `extra24Count`. Characters with several possible spawns may use these as alternatives. Types 14 and 17 use type-specific fields at `+0x2E/+0x30/+0x32` for Agent/Secret Agent/00 Agent spawn chances, `+0x34` for AI mode, `+0x38` for character type, `+0x3A` for weapon, and `+0x3F` for trigger slot; these meanings are verified by spawn-handler disassembly.

### 4.2 Object and model formats

The spawn switch handles 203 type values. Its default case creates no runtime object: these records are static render geometry. Other handlers instantiate objects, with position at object `+0x24`, angles at `+0x3C`, skeleton pointer at `+0x68`, drawn-node pointer at `+0x70`, class at `+0x78`, and draw mode at `+0x7E`. In Courier RAM, 132 objects were present; doors, pickups, props, glows, script points, and unmoved characters matched their instance-record transforms, including non-Y rotation. Animated types subsequently move. Names below are supported by model appearance, menu text, or handler behavior as indicated; where none settles a role it is only a class label.

| Class | Types | Records in all entries | Stored/rendered role |
|---|---|---:|---|
| Static geometry | 96 default-handler types | 6,426 | Place mesh at record transform. |
| Helper planes | 30, 31, 104 | 1,721 | Non-rendered in Courier; collision role unverified. |
| Doors and moving parts | 0–8, 54–59, 65, 74, 150, 159–172 | 409 | Mesh plus movable object. |
| Spinners | 9–11, 112 | 31 | Rotating mesh. |
| Props/usable objects | 28, 29, 45–47, 75, 76, 94, 124, 125, 131, 141, 142, 144 | 341 | Mesh plus interaction handler. |
| Pickups | 93 | 70 | Record chooses ammo, item, or weapon model. |
| Characters | 14, 17 | 898 | Placeholder replaced by posed skeleton. |
| Level vehicles/scripted objects | 19, 92, 97, 129, 130, 149, 152 | 28 | Overlay-driven mesh/object. |
| Multiplayer objects | 91, 99, 100, 102, 126 | 292 | Mode objects and item spawns. |
| Player starts/respawns | 35–38, 44 | 405 | Spatial markers. |
| Environment | 41–43, 86, 105, 145–148 | 52 | Fog, sky, and transition values. |
| Lights | 77, 78 | 244 | Local light-source markers. |
| Glow | 114 | 18 | Translucent mesh. |
| Emitters/script points | 84, 88, 89, 98, 106–111, 201, 202 | 260 | Event or effect markers. |

Model entries 43–136 are character bodies; 137–145 hand/arm parts; 146–478 props, vehicles, furniture, and pickups; 479–506 first-person weapon rigs. Entry 42 is a blob shadow; 420 is the magenta placeholder used for actor/marker records. Two program tables connect ids to models:

| Table | ROM/RAM address | Stride/count | Fields and use |
|---|---|---|---|
| Character types | RAM `0x800C3CF4` | 121 × 12 | Skeleton group, model-id pointer, and bone-to-node remap pointer. |
| Weapons | RAM `0x800C46DC` | 59 × 232 | First-person rig at `+0x00`; held weapon node/model at `+0x2A/+0x2C`. |
| Items/gadgets | RAM `0x800C4470` | 31 × 16 | Use callback at `+0x00`, weapon slot at `+0x06`, pickup model at `+0x0A`. |

The exact layout of the remaining bytes in those tables is incomplete; the rows identify verified consumer fields, not complete record definitions. A 28-byte array in 15 entry headers is consumed at `0x800862BC` and contains position triples plus unclassified parameters. Sound emitters are a hypothesis, not a proven role.

### 4.3 Skeletons and animation

Characters are rigid per bone, not skinned. A human has 15 bones, and first-person rigs have 37–49. Captured Courier frames load one modelview per guard bone; each modelview translation divided by 64 matches the joint-position array in RAM. The bone record stride is 32 bytes at animation-bank base `0xF8D70 + groupOffset`, with the following verified fields:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | s16 | `boneIndex` | Bone slot. |
| `0x02` | 2 | s16 | `parentIndex` | Parent bone slot. |
| `0x04` | 12 | f32[3] | `jointOffset` | Offset in the parent bone's frame; captured joint differences agree within 0.0005. |
| `0x10` | 16 | mixed | `unknown_10` | Unclassified tail. |

The animation table at ROM `0x530BA8` contains 1,035 records of 32 bytes. A group table has 121 records of eight bytes at RAM `0x800C3924`, terminated by a zero record. Its fields select a bone group:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | u32 | `groupOffset` | Offset from animation-bank base `0xF8D70`. |
| `0x04` | 2 | s16 | `boneCount` | Number of 32-byte bone records. |
| `0x06` | 2 | u16 | `flags` | Group flags; individual bit meanings incomplete. |

The animation-record fields are:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | u16 | `frameCount` | Frame count. |
| `0x02` | 2 | u16 | `groupAndFlags` | Group id; bit `0x8000` enables per-bone translation. |
| `0x04` | 4 | u32 | `dataOffset` | Offset into animation key data from ROM `0xF8D70`. |
| `0x08` | 12 | f32[3] | `translationScale` | Scale for quantized XYZ translation. |
| `0x14` | 12 | f32[3] | `translationOffset` | Bias for quantized XYZ translation. |

Each frame has `T` u16 XYZ translation triples followed by `B` packed u32 angle words, where `B` is bone count and `T=B` if the flag is set, otherwise 1. The data span is `frameCount × (6T + 4B)` for all 1,035 records. Translation = `u16 × scale + offset`. The packed angle components are `(word >>> 22) << 2`, `(word >>> 10) & 0xFFE`, and `(word << 1) & 0xFFE`; quaternion sin/cos use half-angles `π × component / 4096`, and bone rotations compose parent × local. That decode matched 14 captured bone-local rotations from animation 164 within 1.38° mean / 2.14° maximum.

Character creation at `0x8000265C` initializes animation 113. It is one neutral frame for 15-bone human rigs (group 17; key-data offset `0x9B810`), with root bias `(0, 1.08446, 0)`. Captured Courier RAM confirms animation 113 on the reported guard. The viewer applies this source-derived neutral pose to human characters; larger first-person rigs retain their bind-record pose. Time-dependent animation selection, blending, head variants, and exact root settlement remain unverified.

### 4.4 Behaviors, triggers, and scripted objects

Overlay code drives moving vehicles, doors, and mission-specific objects. Character spawn chances are difficulty-dependent; AI modes 2, 3, 28, 29, 30, and 50 create generator objects which release a character later on an untraced condition. Player starts, script points (type 201), local light markers, and type-126 multiplayer item spawns should be interpreted from their records rather than rendered with the magenta placeholder model. Type-126 chooses one of ten item words using the multiplayer weapon-set byte and respawns after `900 - random` frames. Environment-transition types 145–148 alter fog and tint as described above. Door motion, trigger conditions, and full mission logic remain outside the format verification.

## 5. Audio

### 5.1 Audio storage and banks

The music/SFX section contains a MusyX project at ROM `0x14CD630` (size `0x38A0`), pool at `0x14D0ED0` (`0xCD30`), sample directory at `0x14DDC00` (`0x4900`), sample payload starting `0x14E2500`, and 18 song streams starting `0x1D54AD0`. Verified by audio initialization at `0x80009F04`. The project declares nine groups: one SFX group and eight song groups. The pool contains 594 SoundMacros, four ADSR tables, 13 keymaps, and 70 layers. The sample directory has 667 records of `0x1C` bytes; 133 samples have loop metadata. The speech bank is separate: 276 clips after the count/offset table and `MORT` tags, sampled at approximately 12 kHz and encoded by an undecoded Factor 5 voice codec. Speech is not part of the MusyX sample directory.

### 5.2 Sequence format and driver

Verified by disassembly and parsing all 18 songs. `sndInit` starts MusyX v1 at nominal 22,050 Hz with 20 voices (10 music, 10 SFX). `sndPushGroup` loads the project/group/sample-base/directory/pool set; `sndSeqPlay` starts a song; a 114-opcode SoundMacro interpreter generates voices. The sample output captured from the running game uses an AI DAC rate of 22,047 Hz and 192-sample stereo buffers. In both observed Mono and Stereo settings, the music channels were bit-identical (SFX were not always mono).

The music-volume option controls MusyX group 253; its default 6/10 setting maps to volume 76, then through the driver's nonlinear volume table (about 0.311 of full scale). Group 254 controls sound effects. This is a runtime mix setting, not a property of the stored songs.

The song table at ROM `0xB3080` contains 18 records of 12 bytes and a zero terminator:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | u32 | `romStart` | Inclusive SNG stream start. |
| `0x04` | 4 | u32 | `romEnd` | Exclusive SNG stream end. |
| `0x08` | 2 | u16 | `groupId` | MusyX group. |
| `0x0A` | 2 | u16 | `songId` | Song number passed to the sequencer. |

An SNG header has these 24 bytes; its pointers refer to the song's internal data. All songs have a zero tempo-table pointer and the top bit of BPM clear:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | u32 | `trackTable` | Track-list offset. |
| `0x04` | 4 | u32 | `regionTable` | Region/event data offset. |
| `0x08` | 4 | u32 | `channelMap` | Channel-to-program mapping offset. |
| `0x0C` | 4 | u32 | `tempoTable` | Zero in all inspected songs. |
| `0x10` | 4 | u32 | `bpm` | Beats per minute, high flag clear. |
| `0x14` | 4 | u32 | `loopStartTick` | Song-wide loop start. |

Sequences use 384 ticks per beat. Track entries have 12-byte stride; a negative `region` terminates a track (`-2` loops to `loopTo`, `-1` ends):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | u32 | `tick` | Event or terminator tick. |
| `0x04` | 4 | u32 | `eventWord` | Event data; detailed packing varies by event. |
| `0x08` | 2 | s16 | `region` | Region index, or `-1`/`-2` terminator. |
| `0x0A` | 2 | s16 | `loopTo` | Loop target for `-2`; otherwise event-dependent. |

Keymaps and layers route a note through a nested SoundMacro object. Layered instruments cannot be reproduced by a direct flat program/sample lookup. Runtime VolSelect, SplitMod, and a configurable voice cap are needed to match TWINE's MusyX output; these operations are part of the driver behavior, not a second sample encoding.

### 5.3 Instruments and sample encoding

All 667 MusyX sample records use format 3: a 256-byte ADPCM codebook followed by 40-byte compressed blocks representing 64 PCM samples each. Common native sample rates are 8,000, 11,025, 16,000, and 22,050 Hz. All samples parse and decode; measured discontinuities at block boundaries are no larger on average than adjacent in-block sample differences. Keymaps (`0x4xxx` references) and layers (`0x8xxx` references) select child objects, transpose, volume, pan, and key ranges. The SFX group and song pages reference those objects; all 667 samples are named by at least one SoundMacro. Voice compression for speech is not this MusyX ADPCM and its bitstream remains unknown.

A keymap has 128 eight-byte entries indexed by note number. Each entry contains these verified fields; a `0x4xxx` object reference selects the keymap:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | u16 | `object` | Child SoundMacro/keymap/layer reference. |
| `0x02` | 1 | s8 | `transpose` | Note transposition. |
| `0x03` | 1 | u8 | `pan` | Pan setting. |
| `0x04` | 2 | s16 | `priority` | Voice priority adjustment. |
| `0x06` | 2 | u16 | `unknown_06` | Unclassified. |

A layer begins with a four-byte `u32 count` followed by `count` 12-byte entries. Each entry is:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | u16 | `object` | Child object reference. |
| `0x02` | 1 | u8 | `keyLo` | Inclusive lower note. |
| `0x03` | 1 | u8 | `keyHi` | Inclusive upper note. |
| `0x04` | 1 | s8 | `transpose` | Note transposition. |
| `0x05` | 1 | u8 | `volume` | Relative volume. |
| `0x06` | 1 | s8 | `priority` | Priority adjustment. |
| `0x07` | 1 | u8 | `span` | Spread parameter. |
| `0x08` | 1 | u8 | `pan` | Pan setting. |
| `0x09` | 3 | u8[3] | `unknown_09` | Padding/unclassified. |

### 5.4 Music catalog and loop points

Names below describe verified use rather than claims of official soundtrack titles. Song ids and loop times are decoded from SNG data; uses come from the level-start switch, complete scene-script walk, and, for rows marked *heard*, audio capture. Multiplayer chooses randomly among rows 0–12.

| Row | Song id | Group | BPM | Loop start → end (s) | Use |
|---:|---:|---:|---:|---|---|
| 0 | 5 | 3 | 174 | 4.14 → 142.07 | King's Ransom level start; heard. |
| 1 | 17 | 8 | 130 | 14.77 → 121.85 | Thames Chase, Cold Reception, Fallen Angel, Turncoat starts; heard in Cold Reception attract demo. |
| 2 | 2 | 2 | 116 | 2.07 → 155.17 | Midnight Departure start. |
| 3 | 0 | 1 | 116 | 51.72 → 233.79 | Masquerade event. |
| 4 | 7 | 4 | 150 | 2.80 → 103.60 | A Sinking Feeling event. |
| 5 | 1 | 1 | 145 | 1.66 → 107.59 | Masquerade scene 6. |
| 6 | 3 | 2 | 120 | 0 → 68.00 | Courier scene 3. |
| 7 | 8 | 4 | 150 | 0 → 89.60 | Underground Uprising start, Meltdown scene 25; heard in attract demo. |
| 8 | 12 | 5 | 118 | 8.14 → 105.76 | Title, menus, debriefing (heard); City of Walkways II start, Thames Chase intro. |
| 9 | 9 | 4 | 108 | 11.11 → 64.44 | Meltdown start. |
| 10 | 16 | 7 | 112 | 2.14 → 156.43 | Night Watch start and scene 44. |
| 11 | 10 | 4 | 116 | 0 → 99.31 | A Sinking Feeling start; several underwater/Fallen Angel/City scenes. |
| 12 | 4 | 2 | 155 | 0 → 86.71 | Submarine-set scene 20. |
| 13 | 6 | 3 | 172 | once, ≈22.6 | King's Ransom scene 15. |
| 14 | 11 | 5 | 90 | 10.67 → 32.00 | No static reference found outside song table. |
| 15 | 15 | 6 | 80 | once, two notes | Courier intro sting; heard, stopped after ≈8 s. |
| 16 | 13 | 5 | 118 | 0 → 40.68 | City of Walkways I intro scene 47. |
| 17 | 14 | 5 | 106 | 0.57 → 27.74 | Front-end intro-set scene 35. |

Sixteen songs loop song-wide; ids 6 and 15 play once. For looping tracks, a `-2` terminator at the same end tick returns to the header's loop-start tick. A captured song-12 loop was seamless at the predicted point. A gameplay-song seam was not captured.

## 6. Unused and hidden content

### 6.1 Unreferenced assets

Verified by a static scan of every archive placement, known model table, preload list, head-variant table, scene reference, and constant model-loader call: **159 prop model ids** among 146–478 have no discovered placement or static load reference. Examples identified by rendered shape are an ambulance (151), school bus (216), roulette wheel (350), tube train (426), and test-pattern cube (404). Identification by shape is descriptive, not proof of intended game use. Computed runtime model ids, especially multiplayer items and debris, prevent a definitive unused claim. No complete scan of unreferenced individual textures, meshes, or animations has been performed.

Song id 11 (row 14) has no reference in the level-start switch, all 52 fully parsed scene scripts, known direct calls, or the multiplayer random selection (which stops at row 12). It is **statically unreferenced**, not proved unplayable through every possible computed id. All 667 MusyX samples are named by at least one macro, but macro reachability is unverified. Speech clips 272–275 have no same-numbered dialogue text because the text bank ends at 271; clip index and dialogue string index are not a one-to-one mapping, so their actual reachability is unknown. Three objective strings—“Rescue Christmas undetected.”, “Disabling reactor safeties.”, and “Ejecting Reactor Rod.”—have no discovered mission-list or constant-id reference. Computed text ids remain possible.

### 6.2 Cut or inaccessible levels

Entry 8 has an arena-like 145×145-unit slab, wall, crate stacks, one light, and four player-start records. It lacks a mission record, overlay, scene-script load, respawn point, multiplayer pickup, and per-level preload list. Its 88 records and 15 textures render coherently. Verified from archive bytes and reference tables; **hypothesis:** an unfinished/test multiplayer arena.

Entry 17 has 41 records forming an island, sea, and domed tower, with a player start on the tower roof. Its level-to-overlay slot 6 names it, but overlay record 6 has an empty ROM range; no mission or level-start song was found. Scene 36 loads it and frames the tower, but no static caller of that scene was found. A runtime warp loaded the tower-roof area, consistent with the archive geometry. **Hypothesis:** an abandoned Istanbul/Maiden's Tower mission or establishing set; the geographical identification rests on visual similarity and nearby caption text, not an explicit level label.

Entries 27 and 37 are **not** cut levels. They are common preloads: 27 contains 31 effect-mesh records (flash/smoke/ring/bullet-hole-like textures) and 37 one badge-like icon. Their exact in-game purpose beyond the common model load is not completely traced.

### 6.3 Debug features

The attract-demo recorder is present in disassembly. Mode byte `0x800CEEB1` selects record mode when 1 and playback when 2; the recorder writes 900 16-byte input/state frames into `0x80104320`. No write of 1 to that selector was found in main code or any overlay, whereas writes of 0 and 2 were found. It is therefore statically unreachable in retail navigation; a debugger can still set the byte. The three ROM recordings are selected by title-idle code and play levels 34, 25, and 1.

The name-entry word filter is used, not unused: 45 encoded words in front-end overlay data have each character incremented by one; the routine at `0x80019150` decrements and compares them with entered names. Text banks also contain “Cheats Menu”, “Cheats”, “Development Menu”, “Invulnerability”, “All Weapons”, “All Gadgets”, “All Missions”, and “FPS,Position”. No page record or resolved text-getter call uses the cheat/development titles. However, many getter ids are computed, so removal of those menus is a **hypothesis**. A Password Menu page **does** exist with “Code” and “Weapon Mode” items, but its navigation path and code semantics have not been traced. Unlock messages for skins, modes, and maps are actually selected by code at `0x8001CB50`–`0x8001CBA0`; they should not be listed as orphan text.

### 6.4 Prototype or revision-specific content

Europe changes 18 archive entries after decompression, including texture downscales and added/deleted instances, but there is no verified Europe-exclusive level. A few otherwise unplaced models also have Europe texture edits; this does not establish playability. Entry 17's empty overlay slot is a remnant in both inspected releases. No build timestamp, source path, or debug-print string was found in the main code/overlays; absence from that scan does not establish that none exists elsewhere in the ROM. The `0x28`-byte tail before the archive is terminator/padding, and the 16 bytes after the three demo recordings have no verified reader or meaning.

## 7. nviewer implementation

### 7.1 Module mapping

The viewer detects normalized header code `NO7E` or `NO7P`, selects release-specific addresses, and presents the 28 menu-selectable levels plus 12 scene/front-end/archive sets. Entries 27 and 37 are common models, not levels.

| Component | Existing or suggested module | Responsibility |
|---|---|---|
| ROM dispatch and game contract | `src/rom/index.ts`, `src/rom/types.ts` | Detect `NO7E`/`NO7P`, add `twine` game id. |
| EDL | `src/rom/twine/edl.ts` | Methods 0/1/2 and bounds-checked header handling, guided by [EDL reference](compression/edl.md). |
| Archive | `src/rom/twine/level.ts` | Index, entry headers, cross-entry component references, release map. |
| Geometry | `src/rom/twine/level.ts` | D stream to batches; record transforms and draw-mode state. |
| Textures | `src/rom/texture.ts` | Existing CI/I row decoders; apply storage nibble swap. |
| Environment/objects | `src/rom/twine/level.ts`, `objtypes.ts` | Fog, sky, camera, layers, markers, bind-pose characters. |
| Music | `src/rom/music/musyx.ts`, `src/rom/twine/music.ts` | Extend generic MusyX keymaps/layers, SplitMod and VolSelect; expose 18 songs. |
| Game facade | `src/rom/twine/twine.ts` | Level list, loading, music and metadata. |

### 7.2 Supported features

The integrated loader renders all 40 exposed sets on both USA and Europe, with initial fog and skies, static object transforms, neutral-pose human characters, and all 18 MusyX songs. Drawn world geometry, objects, skies, characters, markers, and provisional helper planes have toggleable layers; the helper layer is hidden by default. Transparent meshes retain ROM vertex alpha and use a blended, no-depth-write pass. The corrected Courier offline render has lower mean absolute RGB error against its captured game frame than the initial loader (10.14 versus 10.84 at 320×240). Earlier emulator comparisons across eight levels support colour, fog, sky, and camera mappings; they are not exhaustive runtime-fidelity tests.

### 7.3 Approximations and omissions

Initial static geometry does not reproduce runtime visibility, moving doors, vehicles, mission scripting, or time-dependent character animation/head choice. Human characters show the initialized neutral pose, not a sampled gameplay frame. Sky fog needs viewer support because game skies retain G_FOG; a no-fog viewer sky can look too bright, especially at Cold Reception. The game's RSP fog is per vertex, while the viewer may fog per pixel. Collision can be shown only as provisional helper surfaces until the query code is decoded. Intensity-mode PRIM/ENV colours were not established. The music player supports keymaps/layers, SplitMod, VolSelect, and the game's voice cap, with an approximate full-scale gain of 0.92; reverb/chorus sends and portamento are not modelled.

## 8. Verification and remaining work

### 8.1 Verification evidence

| Subject | Method | Result |
|---|---|---|
| ROM identification | Read normalized headers; recompute CIC-6102 CRCs and whole-ROM SHA-1. | Two releases identified; both CRC pairs match headers. |
| Executable/archive | Disassemble main and overlay readers; walk all 507 entry records. | Address domains, load chain, cross-entry component pointers established. |
| EDL | Exhaustively decode archive streams; compare sampled decompressions with runtime RAM. | 11,194/11,194 exact declared input/output bounds; 6/6 RAM outputs byte-identical. |
| Revisions | Align Europe readers with USA; compare decoded archive entries. | Same formats; 489/507 decoded entries match, 18 differ. |
| Level catalog | Cross-check mission, overlay, scene, and entry tables. | 14 campaign + 14 multiplayer; 27/37 are common models. |
| Mesh commands | Parse all distinct D streams and generated-list opcodes. | 7,440 streams, 0 parse or index errors; 515,396 triangles. |
| Texture payload | Compare all 71 texture blobs loaded for Courier against ROM decoding. | All 71 byte-identical. |
| In-game rendering | Render with captured frame cameras; compare nine frames on eight levels. | Main geometry/texture/fog/sky alignment; frame mean absolute pixel error 2.8–11.6 except character-heavy Masquerade 19.3 and moving-camera Cold Reception 30.5. |
| Fog and camera | Read F3DEX2 fog/projection commands and RAM in eight levels; compare record-derived camera with six frames. | Fog words and far planes match; static eye within 0.06 units, yaw exact. |
| Objects/characters | Compare Courier object list, rigid bone matrices, spawn calls, and animation callback against RAM. | Static object transforms exact; joint offsets within 0.0005; half-angle quaternion convention and initialized human pose verified. |
| MusyX | Parse all banks/songs/samples; render 18 songs; compare three captured songs. | 667 samples and 18 songs parse; clean waveform windows correlate up to 0.95–1.00; song-12 loop confirmed. The game's long-run sequence timing is ≈0.034% slower than a nominal 22,050 Hz offline render; cause unknown. |
| Unused candidates | Cross-reference mission, overlay, scenes, preloads, models, songs, and text. | Entries 8/17 and song 11 statically unreferenced as described; computed references remain possible. |

### 8.2 Known unknowns

- Runtime collision structures and exact role of helper-plane types 30/31/104.
- Speech compression bitstream, speech-clip-to-text mapping, and use of clips 272–275.
- Meaning of 28-byte entry extras, several 24-byte placement extras, and many object type-dependent fields.
- Time-dependent animation selection/blending, live head variant, and exact root settlement.
- PRIM/ENV for intensity draw modes and exact sky-fog visual treatment.
- Reachability of scene 36/entry 17, title Password Menu, and computed references to apparently unused models/song 11.
- Level-song loop seams beyond captured song 12, clean isolated song 17, and cause of the ≈0.034% long-run sequencer timing drift.

### 8.3 References

The [EDL compression reference](compression/edl.md) defines the archive codec and links its standalone decoder/encoder. The viewer's existing MusyX player is under `src/rom/music/musyx.ts`; the audio behavior and bank offsets above were verified against ROM code and captures.
