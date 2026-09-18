# Mario Party — Nintendo 64 ROM format specification

This manual describes the Japanese retail ROM. North American and European offsets are identified where verified; the proposed viewer loader targets Japan.

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | Main filesystem: 73 directories and 3,297 files; 132 code overlays; separate string, HVQ background, and audio regions. |
| Compression | Mainfs type 1: 1 KiB-ring Hudson LZSS; HVQ 2.0 still images. |
| Graphics microcode | F3DEX/F3DEX.NoN/F3DLX.Rej/S2DEX/L3DEX FIFO 2.06 identification string; generated static lists use F3DEX2 opcodes. |
| Geometry | FORM chunk container; board spaces and chains in mainfs 10/69–83. |
| Textures | CI4/CI8, IA8/IA16, RGBA5551/RGBA32, I8, RGB24; HVQ 2.0 board backgrounds. |
| Collision | Optional FORM `MAP1` uniform grid of triangle/quad index lists; board movement follows space graphs. |
| Music driver | libultra `alCSPlayer`, wrapped by Hudson's sound player. |
| Audio microcode | **Unknown**; RSP task microcode version has not been identified. |
| Sample encoding | libultra VADPCM in `B1` banks. |
| Levels | Eight party boards, training board, five Mini-Game Island maps, stadium board, Mushroom Village, and mini-game arenas. |
| Memory requirement | **Unknown** from current runtime tests; no observed allocation exceeds base 4 MiB. |
| Viewer support | Proposed Japanese release only; implementation pending. |

### 1.2 ROM identification

Verified from normalized `.z64` bytes. All known releases are 32 MiB and use CIC-6102.

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| Japan | `MarioParty` | `CLBJ` | 0 | 32 MiB (`0x2000000`) | `ADA815BE` | `6028622F` | `37fd6d27f55c468dc36efb92a255f7ab04ffc0a8` | 6102 | libultra 2.0I |
| North America | `MarioParty` | `CLBE` | 0 | 32 MiB (`0x2000000`) | `2829657E` | `A0621877` | `1159bd56730094bfc71be30113e1cfc8bacf34f3` | 6102 | libultra 2.0I |
| Europe (M3) | `MarioParty` | `NLBP` | 0 | 32 MiB (`0x2000000`) | `9C663069` | `80F24A80` | `d7ba071c220a71f5e4503e55c98c91ff8f027848` | 6102 | libultra 2.0I |

For Japanese detection, also validate 132 overlay records at ROM `0xC1FD4`, their `0x44200000` terminator, and 73 mainfs directories at `0x31BA80`. These are verified from ROM bytes.

### 1.3 Terminology and conventions

Ranges are half-open. Multi-byte fields are big-endian unless stated otherwise. `d/f` denotes a mainfs directory/file pair. RAM addresses are KSEG0. `A` and `B` identify the two S2 music tables, not regional releases. Evidence labels distinguish ROM-byte/disassembly/RAM/frame/audio verification from hypotheses.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

Verified by entry-code disassembly: IPL3 loads ROM `[0x1000, 0xCCF00)` at RAM `0x80000400`, clears BSS `[0x800CC300, 0x800F5A30)`, sets SP `0x800F1EC0`, and enters `0x80000460`. The estimated text/data/rodata boundaries are `0xB1AC0` and approximately `0xCA810`; the latter is a **hypothesis** from byte matching. A `0x800`-byte glyph blob at ROM `0x31B280` is DMA-read at boot; its use as debug-print font is a **hypothesis**.

### 2.2 Memory and address mapping

The Japanese main segment maps ROM offset `R` to RAM `0x80000000 + R - 0xC00`. Every overlay links at RAM `0x800F5A30`; only one is resident. Overlay-relative data address `A` maps to file offset `A - 0x800F5A30`. Verified by disassembly of the overlay loader (`0x800174F0`): it DMA-copies the stored range and zeroes BSS. Overlays contain absolute addresses and no relocation records.

### 2.3 ROM map and asset organization

Verified from ROM region boundaries and loader constants. Alignment gaps up to ten bytes separate regions.

| ROM range | Stored size | Decoded size | Destination | Compression | Contents |
|---|---:|---:|---|---|---|
| `[0x0000000,0x0000040)` | `0x40` | same | header | none | N64 header |
| `[0x0000040,0x0001000)` | `0xFC0` | same | IPL3 | none | CIC boot code |
| `[0x0001000,0x00CCF00)` | `0xCBF00` | same | `0x80000400` | none | main executable |
| `[0x00CCF00,0x031B280)` | `0x24E380` | same | `0x800F5A30` one at a time | none | overlays 0–131 |
| `[0x031B280,0x031BA80)` | `0x800` | same | boot allocation | none | glyph blob |
| `[0x031BA80,0x0FB4796)` | `0xC98D16` | varies | heap | mainfs type 0/1 | 73 directories |
| `[0x0FB47A0,0x0FC4927)` | `0x10187` | same | heap | none | 1,324 strings |
| `[0x0FC4930,0x151DBCC)` | `0x55829C` | varies | tile cache | HVQ 2.0 | 105 backgrounds |
| `[0x151DBD0,0x175D0F0)` | `0x23F520` | same | audio heap | none | S2 music A |
| `[0x175D0F0,0x1817010)` | `0xB9F20` | same | audio heap | none | S2 music B |
| `[0x1817010,0x1B9C8A0)` | `0x385890` | same | audio heap | none | T3 effects A |
| `[0x1B9C8A0,0x1CD2290)` | `0x1359F0` | same | audio heap | none | T3 effects B |
| `[0x1CD2290,0x1CD2AC0)` | `0x830` | same | audio heap | none | FXD0 reverb parameters |
| `[0x1CD2AC0,0x2000000)` | remainder | same | — | — | `0xFF` padding |

The 36-byte overlay-table record has nine `u32` fields and is terminated by `0x44200000` after 132 records. Overlay 88 is zero length. Verified from ROM bytes.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `u32` | `romStart` | Inclusive stored start. |
| `0x04` | 4 | `u32` | `romEnd` | Exclusive stored end. |
| `0x08` | 4 | `u32` | `ramStart` | DMA destination. |
| `0x0C` | 4 | `u32` | `codeStart` | Code start in RAM. |
| `0x10` | 4 | `u32` | `codeEnd` | Code end in RAM. |
| `0x14` | 4 | `u32` | `rodataStart` | Read-only data start. |
| `0x18` | 4 | `u32` | `rodataEnd` | Read-only data end. |
| `0x1C` | 4 | `u32` | `bssStart` | Zero-filled start. |
| `0x20` | 4 | `u32` | `bssEnd` | Zero-filled end. |

Mainfs indexing is relative: directory offsets are from the filesystem base; file offsets are from the containing directory. The file payload begins eight bytes after its entry. Verified by decoding all 3,297 Japanese files.

| Structure | Offset | Size | Type | Field | Description |
|---|---:|---:|---|---|---|
| filesystem | `0x00` | 4 | `u32` | `directoryCount` | 73 in Japan. |
| filesystem | `0x04` | `4 × directoryCount` | `u32[]` | `directoryOffset` | Relative directory starts. |
| directory | `0x00` | 4 | `u32` | `fileCount` | Number of files. |
| directory | `0x04` | `4 × fileCount` | `u32[]` | `fileOffset` | Relative file starts. |
| file | `0x00` | 4 | `u32` | `decodedSize` | Output-byte count. |
| file | `0x04` | 4 | `u32` | `compressionType` | 0 stored, 1 LZSS. |
| file | `0x08` | variable | `u8[]` | `payload` | Ends at the next file offset. |

The HVQ background filesystem has 105 entries and one end-offset sentinel at each index level. Offsets are relative to their respective filesystem/background bases. Verified from ROM bytes.

| Structure | Offset | Size | Type | Field | Description |
|---|---:|---:|---|---|---|
| filesystem | `0x00` | 4 | `u32` | `backgroundCountPlusOne` | 106. |
| filesystem | `0x04` | `4 × backgroundCountPlusOne` | `u32[]` | `backgroundOffset` | Last offset marks end. |
| background | `0x00` | 4 | `u32` | `fileCountPlusOne` | Metadata plus tile files and sentinel. |
| background | `0x04` | `4 × fileCountPlusOne` | `u32[]` | `fileOffset` | Last offset marks end. |

### 2.4 Compression formats

Mainfs type 0 is stored (1,023 files); type 1 is [Hudson 1 KiB-ring LZSS](./compression/hudson-lzss.md) (2,274 files). It uses a zero-filled 1,024-byte ring initially written at `0x3BE`. Each flag byte supplies eight least-significant-bit-first flags: 1 literal, 0 two-byte back-reference. The match's ring index is `b1 | ((b2 & 0xC0) << 2)` and length is `(b2 & 0x3F) + 3`; overlapping copies are permitted. Decoding stops at `decodedSize`; no compressed size is stored in the file header. This matches the Bomberman 64 1 KiB variant and all Japanese type-1 files decode to the declared size.

HVQ 2.0 is Hudson's intra-frame image codec. Its game-specific container and output path are described under [Textures and materials](#35-textures-and-materials); [the shared HVQ 2.0 reference](./compression/hvq2.md) defines the bitstream and syntax codec. Its decoded output is RGBA5551 with alpha zero. No other mainfs compression type occurs in this ROM.

### 2.5 Loading process

Verified by Japanese disassembly: `DataRead` at `0x800144E0` takes `dir << 16 | file`, bounds-checks both indices, and decompresses as required. `LoadFormFile` at `0x80017458` reads a model by mainfs ID. Board setup at `0x80056878` loads the HVQ filesystem, background index, and board spaces; Mini-Game Island uses `0x8005BFBC`. Background tiles are streamed into a 40-slot cache as the 320×240 viewport scrolls.

### 2.6 Revision differences

Verified from the three regional images; names/roles of regional-only code are hypotheses where indicated.

| Feature | Japan | North America | Europe (M3) |
|---|---|---|---|
| Main ROM range | `[0x1000,0xCCF00)` | `[0x1000,0xCDA50)` | `[0x1000,0xD5410)` |
| Overlay table ROM | `0xC1FD4` | `0xC2874` | `0xC9EB4` |
| Overlays / link RAM | 132 / `0x800F5A30` | 132 / `0x800F65E0` | 133 / `0x80103750` |
| Mainfs ROM / files | `0x31BA80` / 3,297 | `0x31C7E0` / 3,302 | `0x3373C0` / 3,321 |
| String table ROM / entries | `0xFB47A0` / 1,324 | `0xFCB860` / 1,327 | `0xFF0850`, `0x1007310`, `0x101F110` / 1,327 each |
| HVQ filesystem ROM | `0xFC4930` | `0xFE2310` | `0x10357D0` |
| S2 A / B ROM | `0x151DBD0` / `0x175D0F0` | `0x15396A0` / `0x1778BC0` | `0x158CB60` / `0x17CC080` |

After decompression, 3,213 Japanese files equal their US counterparts at the same index. Of 105 HVQ backgrounds, 102 are byte-identical across regions; indices 68, 72, and 75 differ. S2 tables and FXD0 are byte-identical. Europe inserts overlay 112 (`0xE30` bytes), shifting later indices; a language-selection purpose is a **hypothesis**.

## 3. Level data

### 3.1 Level catalog and identifiers

A level is either a board/map using HVQ backdrop plus 3D pieces, a mini-game arena assembled from FORM assets, or a 3D hub. Verified board metadata and overlay references:

| Level | Overlay | Board definition | HVQ background | Spaces | Chains | Song A |
|---|---:|---|---:|---:|---:|---:|
| DK's Jungle Adventure | 54 | 10/69 | 0 | 134 | 18 | 8 |
| Peach's Birthday Cake | 55 | 10/70 | 7 | 87 | 3 | 9 |
| Yoshi's Tropical Island | 56 | 10/71 | 18 | 79 | 7 | 10 |
| Wario's Battle Canyon | 57 | 10/72 | 27 | 108 | 9 | 11 |
| Luigi's Engine Room | 58 | 10/73 | 39 | 119 | 16 | 12 |
| Mario's Rainbow Castle | 59 | 10/74 | 47 | 64 | 9 | 13 |
| Bowser's Magma Mountain | 60 | 10/75 | 56 | 82 | 11 | 14 |
| Eternal Star | 61 | 10/76 | 68 | 100 | 21 | 15 |
| Training map | 62 | 10/77 | 77 | 35 | 4 | 42 |
| Mini-Game Island main map | 114 | 10/78 | 79 | 49 | 8 | 67 |
| Mini-Game Island submaps 1–4 | 115–118 | 10/79–82 | 80–83 | 17/12/10/9 | 1 each | 69/70/70/71 |
| Mini-Game Stadium | 127 | 10/83 | 99 | 53 | 1 | 49 |

Backgrounds 0, 7, 18, 27, 39, 47, 56, 68, and 79 are 960×720; backgrounds 77, 80–83, and 99 are 640×480; other event backgrounds are 320×240. Mushroom Village is overlay 105, principally FORM 15/0. Mini-game ID-to-overlay records reside in overlay 111, but some IDs redirect to shared or replacement overlays; see [Mini-game identifiers](#appendix-b-mini-game-identifiers) and [Cut or inaccessible levels](#62-cut-or-inaccessible-levels). Verified by overlay entry disassembly, Bumper Ball Maze overlay 52 selects FORM 72/0 for zero-based runtime indices 27 and 48 (catalog IDs 28 and 49), 72/1 for index 36 (ID 37), and 72/2 for index 53 (ID 54).

Overlay 111 holds 56 mini-game records at RAM `0x8010D7E0`, 20 bytes each, followed by an all-zero terminator. Record index zero denotes catalog ID 1. The overlay field and record stride are verified from ROM bytes; the semantic names of the other nonconstant fields are **hypotheses**.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `u32` | `overlay` | Target overlay index. |
| `0x04` | 1 | `u8` | `category` | Hypothesis: player grouping. |
| `0x05` | 3 | `u8[3]` | `padding_05` | Observed zero. |
| `0x08` | 2 | `u16` | `unknown_08` | Observed `0x000B`. |
| `0x0A` | 2 | `u16` | `previewImageId` | Hypothesis: instruction image. |
| `0x0C` | 2 | `u16` | `stringId` | Hypothesis: title or instruction text. |
| `0x0E` | 2 | `u16` | `stringId2` | Hypothesis: companion text. |
| `0x10` | 1 | `u8` | `flag` | Semantics unestablished. |
| `0x11` | 3 | `u8[3]` | `padding_11` | Observed zero. |

### 3.2 Level container

Board definition files 10/69–83 parse completely and are indexed by overlay setup calls. Header size is 12 bytes; each space is 16 bytes. Chain offsets are relative to their chain block. All observed `chainCountA` values are zero, so chain list B is used.

| Structure | Offset | Size | Type | Field | Description |
|---|---:|---:|---|---|---|
| header | `0x00` | 2 | `u16` | `spaceCount` | Number of 16-byte spaces. |
| header | `0x02` | 2 | `u16` | `chainCountA` | Zero in all 15 files. |
| header | `0x04` | 2 | `u16` | `chainCountB` | Active chain count. |
| header | `0x06` | 2 | `u16` | `spacesOffset` | Usually `0x0C`. |
| header | `0x08` | 2 | `u16` | `chainsAOffset` | Equals `chainsBOffset` in MP1. |
| header | `0x0A` | 2 | `u16` | `chainsBOffset` | Start of active chain block. |
| space | `0x00` | 2 | `u16` | `flags` | Mostly zero; `0x8000` on 15 Luigi spaces. |
| space | `0x02` | 2 | `u16` | `type` | Low byte is used by game. |
| space | `0x04` | 4 | `f32` | `x` | Position, scaled ×5 on load. |
| space | `0x08` | 4 | `f32` | `y` | Up coordinate, scaled ×5. |
| space | `0x0C` | 4 | `f32` | `z` | Position, scaled ×5. |
| chain block | `0x00` | `2 × chainCount` | `u16[]` | `chainOffset` | Relative starts. |
| chain | `0x00` | 2 | `u16` | `length` | Number of indices. |
| chain | `0x02` | `2 × length` | `u16[]` | `spaceIndex` | Indices into space array. |

Within a chain, a space links to the next. Cross-chain merges, splits, and Eternal Star warps are defined by board overlay event code rather than the file. Event tables end at a signed space index of −1; event lists end at a zero function pointer. Most links have been decoded, but several special paths remain unresolved (see [Known unknowns](#82-known-unknowns)).

### 3.3 Geometry

Verified by parsing all 933 FORM files. FORM starts with an eight-byte header (`FORM`, size excluding header), followed by tagged chunks of even-padded payload length. Required observed chunks: `OBJ1`, `COL1`, `MAT1`, `VTX1`, `FAC1`, `STRG`; `MAP1` and `MTN1` are optional. `HBIN`/`MODE` is present first and not read by the game. Unknown chunks should be skipped by declared length.

| Structure | Offset | Size | Type | Field | Description |
|---|---:|---:|---|---|---|
| FORM | `0x00` | 4 | `char[4]` | `magic` | `FORM`. |
| FORM | `0x04` | 4 | `u32` | `payloadSize` | File size minus eight. |
| chunk | `0x00` | 4 | `char[4]` | `tag` | Four-character identifier. |
| chunk | `0x04` | 4 | `u32` | `payloadSize` | Followed by payload and even padding. |
| STRG | `0x00` | 2 | `u16` | `count` | Number of names. |
| STRG | `0x02` | `count` | `u8[]` | `length` | One length per name. |
| STRG | variable | variable | `u8[]` | `characters` | Concatenated name bytes. |
| VTX1 | `0x00` | 2 | `u16` | `count` | Vertex count. |
| VTX1 | `0x02` | 2 | `u16` | `version` | Observed value 1. |
| VTX1 | `0x04` | 4 | `f32` | `scale` | Applied to raw positions. |
| VTX1 vertex | `0x00` | 6 | `s16[3]` | `position` | XYZ, scaled by `scale` on load. |
| VTX1 vertex | `0x06` | 3 | `s8[3]` | `normal` | XYZ normal. |

`OBJ1` contains a count, a constant 1, then size-prefixed typed objects. Name references resolve through STRG with a name hash and string comparison. Group (`0x3D`) objects define child-name trees; mesh (`0x3A`) objects select FAC1 face ranges; skeleton-reference (`0x10`) objects select SKL1 trees; point (`0x61`) and null (`0x3E`) objects are non-drawable. All observed models assemble through either the first group or the final skeleton-reference object. The named bitmap/palette cache has 128 entries; a previously loaded same-name texture wins.

| Structure | Offset | Size | Type | Field | Description |
|---|---:|---:|---|---|---|
| OBJ1 | `0x00` | 2 | `u16` | `objectCount` | Number of objects. |
| OBJ1 | `0x02` | 2 | `u16` | `version` | Observed value 1. |
| object | `0x00` | 2 | `u16` | `payloadSize` | Bytes after this field. |
| object | `0x02` | 1 | `u8` | `type` | `0x3D`, `0x3A`, `0x10`, `0x61`, `0x3E`. |
| object | `0x03` | 2 | `u16` | `nameIndex` | STRG index. |
| object | `0x05` | variable | `u8[]` | `payload` | Type-specific; align by `payloadSize`. |
| transform | `0x00` | 12 | `f32[3]` | `position` | XYZ. |
| transform | `0x0C` | 12 | `f32[3]` | `rotation` | XYZ degrees. |
| transform | `0x18` | 12 | `f32[3]` | `scale` | XYZ. |

`FAC1` contains a count (`u16`), constant 3 (`u16`), and zero (`u32`). Triangle record type `0x16` is 42 bytes; quad type `0x35` is 54 bytes; line type `0x30` is 12 bytes and is not drawn. Each triangle/quad corner carries vertex index (`u16`), vertex-material index (`s16`), and UV (`f32`, `f32`); following them are face material (`s16`), attribute (`s16`, −1 for untextured), and a tail byte. Quad triangulation is `(0,1,2)` and `(0,2,3)`. A corner material whose low byte differs from `0xFF` selects unlit per-vertex diffuse colour; otherwise VTX1 normal feeds lighting. UV is scaled by texture width and height without an origin flip. Verified by disassembly and offline renders.

| Record | Offset | Size | Type | Field | Description |
|---|---:|---:|---|---|---|
| FAC1 header | `0x00` | 2 | `u16` | `faceCount` | Number of records. |
| FAC1 header | `0x02` | 2 | `u16` | `version` | Observed value 3. |
| FAC1 header | `0x04` | 4 | `u32` | `zero` | Observed zero. |
| triangle/quad | `0x00` | 1 | `u8` | `type` | `0x16` triangle or `0x35` quad. |
| triangle/quad | `0x01` | `12 × cornerCount` | mixed | `corners` | Three/four repeated fields below. |
| corner | `0x00` | 2 | `u16` | `vertexIndex` | VTX1 index. |
| corner | `0x02` | 2 | `s16` | `vertexMaterial` | COL1/MAT1 selector. |
| corner | `0x04` | 4 | `f32` | `u` | Horizontal texture coordinate. |
| corner | `0x08` | 4 | `f32` | `v` | Vertical texture coordinate. |
| triangle/quad | after corners | 2 | `s16` | `faceMaterial` | Material selector. |
| triangle/quad | +2 | 2 | `s16` | `attribute` | −1 means untextured. |
| triangle/quad | +4 | 1 | `u8` | `tail` | Not read by renderer. |

### 3.4 Display lists and render state

The game constructs F3DEX2 display lists from FORM faces. Verified by disassembly: base state is one-cycle, no alpha compare, TLUT none, no CULL_BACK/FOG/TEXGEN, with ZBUFFER/LIGHTING and texturing enabled. Mesh flag `0x2000` enables back-face culling; fog enables two-cycle mode. Representative batch cases:

| Material case | Combiner | Render mode | Viewer interpretation |
|---|---|---|---|
| Untextured opaque | SHADE | `0x552030` | opaque, Z update |
| Untextured translucent | SHADE with PRIM alpha | `0x504850` | blend, no depth write |
| CI/RGBA16 opaque | TEXEL0 × SHADE | `0x553038` | cutout |
| CI/RGBA16 translucent | TEXEL0 × SHADE with PRIM alpha | `0x504850` | blend |
| IA / I / RGBA32 | texture/PRIM variants | translucent | blend |

Default mesh flags are `0x2B00`; `0x1700` is double-sided. High bits encode billboard (`0x70000000`), environment map (`0x08000000`), specular passes (`0x02000000`/`0x04000000`), decal depth sorting (`0x80000000`), and translucent faces (`0x10000`). Load flags affect Z (`0x0180`/`0x100`), ambient material (`0x200`), sorted draw layer (`(flags >> 10) & 7`), tint (`0x10000`), and silhouette (`0x80000`). Exact material-alpha behavior across textured and untextured faces requires frame comparison.

### 3.5 Textures and materials

`COL1` stores a count (`u16`) and RGBA32 entries. `MAT1` has 12-byte records; only its three COL1 indices are read. `ATR1` records have an 11-byte payload following the size word; wrapping values `0x2D` repeat, `0x2E` clamp, and `0x2C` mirror are observed. `BMP1` supplies bitmap data and `PAL1` supplies RGBA8888 entries converted to RGBA5551. Verified by parsing and loader disassembly.

| Structure | Offset | Size | Type | Field | Description |
|---|---:|---:|---|---|---|
| MAT1 record | `0x00` | 2 | `u16` | `ambientColour` | COL1 index. |
| MAT1 record | `0x02` | 2 | `u16` | `diffuseColour` | COL1 index. |
| MAT1 record | `0x04` | 2 | `u16` | `specularColour` | COL1 index. |
| MAT1 record | `0x06` | 4 | `f32` | `unknown_06` | Usually 50.0; not read. |
| MAT1 record | `0x0A` | 2 | `u16` | `unknown_0A` | Not read. |
| COL1 | `0x00` | 2 | `u16` | `colourCount` | Number of colours. |
| COL1 | `0x02` | `4 × colourCount` | `u32[]` | `rgba` | RGBA8888 colours. |
| ATR1 | `0x00` | 2 | `u16` | `attributeCount` | Number of records. |
| ATR1 record | `0x00` | 2 | `u16` | `payloadSize` | Observed 11. |
| ATR1 record | `0x02` | 1 | `u8` | `type` | Observed `0x2A`. |
| ATR1 record | `0x03` | 2 | `u16` | `colourIndex` | Usually `0xFFFF`. |
| ATR1 record | `0x05` | 1 | `u8` | `wrapS` | Horizontal wrap mode. |
| ATR1 record | `0x06` | 1 | `u8` | `wrapT` | Vertical wrap mode. |
| ATR1 record | `0x07` | 1 | `u8` | `unknown_07` | Observed `0x2F`. |
| ATR1 record | `0x08` | 1 | `u8` | `unknown_08` | Observed `0x2F`. |
| ATR1 record | `0x09` | 1 | `u8` | `unknown_09` | Observed 1. |
| ATR1 record | `0x0A` | 2 | `u16` | `bitmapName` | STRG name index. |
| ATR1 record | `0x0C` | 1 | `u8` | `unknown_0C` | Trailing byte; meaning unestablished. |
| BMP1 | `0x00` | 2 | `u16` | `nameIndex` | STRG index. |
| BMP1 | `0x02` | 1 | `u8` | `kind` | Usually 1; kind 2 adds unused zero image. |
| BMP1 | `0x03` | 1 | `u8` | `format` | See table below. |
| BMP1 | `0x04` | 1 | `u8` | `bitsOrColourCount` | Meaning depends on format. |
| BMP1 | `0x05` | 2 | `u16` | `width` | Texels. |
| BMP1 | `0x07` | 2 | `u16` | `height` | Texels. |
| BMP1 CI | `0x09` | 2 | `u16` | `paletteName` | STRG name index. |
| BMP1 CI | `0x0B` | 2 | `u16` | `unknown_0B` | Observed zero. |
| BMP1 CI | `0x0D` | 2 | `u16` | `unknown_0D` | Observed zero. |
| BMP1 CI | `0x0F` | 2 | `u16` | `byteCount` | Texel payload length. |
| BMP1 CI | `0x11` | `byteCount` | `u8[]` | `texels` | Indexed pixel data. |
| BMP1 non-CI | `0x09` | 2 | `u16` | `unknown_09` | Observed zero. |
| BMP1 non-CI | `0x0B` | 2 | `u16` | `byteCount` | Texel payload length. |
| BMP1 non-CI | `0x0D` | `byteCount` | `u8[]` | `texels` | Direct or intensity data. |
| BMP1 kind 2 trailer | `0x00` | 1 | `u8` | `format` | Additional image format. |
| BMP1 kind 2 trailer | `0x01` | 1 | `u8` | `bitsPerPixel` | Additional image depth. |
| BMP1 kind 2 trailer | `0x02` | 2 | `u16` | `width` | Observed 50. |
| BMP1 kind 2 trailer | `0x04` | 2 | `u16` | `height` | Observed 75. |
| BMP1 kind 2 trailer | `0x06` | 2 | `u16` | `unknown_06` | Meaning unestablished. |
| BMP1 kind 2 trailer | `0x08` | 2 | `u16` | `byteCount` | Additional payload length. |
| BMP1 kind 2 trailer | `0x0A` | `byteCount` | `u8[]` | `texels` | All zero in the seven observed images. |
| PAL1 | `0x00` | 2 | `u16` | `nameIndex` | STRG index. |
| PAL1 | `0x02` | 2 | `u16` | `colourCount` | Entry count. |
| PAL1 | `0x04` | `4 × colourCount` | `u32[]` | `rgba` | RGBA8888 colours. |

| Format byte | Bpp/count | Decoding | Bitmap count |
|---|---|---|---:|
| `0x28` | palette count; 0 = 256 | CI4 if fewer than 17 colours, otherwise CI8 | 1,919 |
| `0x25` | 8 or 16 | IA8 or IA16 | 116 / 19 |
| `0x27` | 32 or 16 | RGBA32 or RGBA5551 | 45 / 6 |
| `0x26` | 24 | RGB24; game converts only red byte to grey RGBA5551 | 3 |
| `0x24` | 8 | I8 | 1 |

The HVQ 2.0 still-image header is `0x60` bytes; `0x18` is the local little-endian exception. Its section fields are image-relative offsets, **not lengths**. Each referenced section begins with a big-endian `u32` byte length, zero if absent. Verified by decoding 105 backgrounds, 4,875 tiles, and 55 preview images, with sampled tile output byte-equal to the game's RAM cache.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 16 | `char[16]` | `magic` | `HVQ 2.0` plus zero padding. |
| `0x10` | 2 | `u16` | `width` | 64 on map tiles; 160 on previews. |
| `0x12` | 2 | `u16` | `height` | 48 on map tiles; 128 on previews. |
| `0x14` | 2 | `u16` | `nestStartX` | Observed zero. |
| `0x16` | 2 | `u16` | `nestStartY` | Observed zero. |
| `0x18` | 4 | `u32 LE` | `fixWordCount` | Not read by game decoder. |
| `0x1C` | 1 | `u8` | `yShiftNum` | Observed 8. |
| `0x1D` | 1 | `u8` | `quantizeStep` | Observed 0 or 1. |
| `0x1E` | 1 | `u8` | `horizontalSampling` | Observed 2. |
| `0x1F` | 1 | `u8` | `verticalSampling` | Observed 2. |
| `0x20` | 4 | `u32` | `basisnumYOffset` | Luma block-count section. |
| `0x24` | 4 | `u32` | `basisnumUVOffset` | Packed chroma block-count section. |
| `0x28` | 4 | `u32` | `basisnumRunYOffset` | Luma zero-run section. |
| `0x2C` | 4 | `u32` | `basisnumRunUVOffset` | Chroma zero-run section. |
| `0x30` | 4 | `u32` | `dcYOffset` | Luma DC section. |
| `0x34` | 4 | `u32` | `dcUOffset` | U DC section. |
| `0x38` | 4 | `u32` | `dcVOffset` | V DC section. |
| `0x3C` | 4 | `u32` | `dcRunYOffset` | Luma DC-run section. |
| `0x40` | 4 | `u32` | `dcRunUOffset` | U DC-run section. |
| `0x44` | 4 | `u32` | `dcRunVOffset` | V DC-run section. |
| `0x48` | 4 | `u32` | `scaleYOffset` | Luma vector-scale section. |
| `0x4C` | 4 | `u32` | `scaleUOffset` | U vector-scale section. |
| `0x50` | 4 | `u32` | `scaleVOffset` | V vector-scale section. |
| `0x54` | 4 | `u32` | `fixYOffset` | Luma vector-code section. |
| `0x58` | 4 | `u32` | `fixUOffset` | U vector-code section. |
| `0x5C` | 4 | `u32` | `fixVOffset` | V vector-code section. |

HVQ block counts encode smooth, 1–7-vector, or raw 4×4 blocks; four Huffman trees encode count, run, scale, and DC streams. The intra-frame decoder reconstructs YUV 4:2:0 and converts it to RGBA5551; see [the shared bitstream reference](./compression/hvq2.md). Tile file `k` (1-based) is column `(k−1) mod tilesX`, row `tilesY−1−floor((k−1)/tilesX)`: files are stored bottom row first. The game draws cached tiles as two 64×24 RGBA16 texture rectangles per 64×48 tile, at 1:1 screen pixels. The game-specific decoding observations are verified by RAM comparison.

### 3.6 Collision

Optional `MAP1` is present in 57 FORM files. Verified by loader disassembly and full chunk walks. Header size 16 bytes, cells have 12-byte stride. Polygon-list offsets are in 16-bit words. A polygon first word uses `0x8000` for four vertices or `0x4000` for three, with remaining bits an attribute; the following words are VTX1 vertex indices. Origin is not stored; derivation from model minimum X/Z is a **hypothesis**.

| Structure | Offset | Size | Type | Field | Description |
|---|---:|---:|---|---|---|
| MAP1 | `0x00` | 2 | `u16` | `columns` | Usually 1, sometimes 10 or 20. |
| MAP1 | `0x02` | 2 | `u16` | `rows` | Usually 1, sometimes 10 or 20. |
| MAP1 | `0x04` | 2 | `u16` | `unknown_04` | Observed 4, 5, or 6. |
| MAP1 | `0x06` | 2 | `u16` | `polygonCount` | Total polygons. |
| MAP1 | `0x08` | 4 | `f32` | `cellSizeX` | X spacing. |
| MAP1 | `0x0C` | 4 | `f32` | `cellSizeZ` | Z spacing. |
| cell | `0x00` | 2 | `u16` | `c0` | `0xFFFF` marks empty. |
| cell | `0x02` | 2 | `u16` | `c1` | Meaning unestablished. |
| cell | `0x04` | 2 | `u16` | `c2` | Meaning unestablished. |
| cell | `0x06` | 4 | `u32` | `listOffsetWords` | Polygon list location. |
| cell | `0x0A` | 2 | `u16` | `count` | Polygon entries in cell. |

Attributes observed include `0x00`, `0x02`, `0x05`, `0x12`, `0x1A`. Boards do not use MAP1 for movement; they use the space graph. Runtime collision-query semantics remain untraced.

### 3.7 Environment, sky, fog, and lighting

Verified by disassembly: default fog is disabled, with near/far positions 950/1000 and white colour. `FogOn` takes near, far, RGB; it uses N64 fog-position units 0–1000, not world distance. The RSP factor is `128000/(far−near)` and `(500−near)×256/(far−near)`. Confirmed constant scene settings include Shell Game 933/1026 with RGB 255/200/200 and Paddle Battle 989/1000 with RGB 240/248/255. A RAM/frame capture of Bobsled Run found clear RGB (0,0,50), fog on at 990/1000, three lights, ambient RGB (128,128,176), and directional light RGB (128,128,200) with direction (−69,69,69); the second directional light is RGB (32,32,32), direction (69,69,69). Mushroom Village has clear RGB (64,240,255), fog off, and ambient RGB (120,120,120). The title is 2D on a white clear colour with fog off. Other scene fog, light, and clear colours remain incomplete. The available arena FORMs do not contain sky meshes; 2D ImgPack/HVQ backdrops are likely but not yet confirmed for every scene.

### 3.8 Cameras and paths

The game has six camera slots. Verified by disassembly: default perspective is 45° vertical FOV, near 80, far 8000, aspect 4:3; runtime calls set eye/target/up. A RAM/frame capture of Bobsled Run found FOV 90°, near 20, far 12000, eye (3055.861,10632.095,−4207.721), target (2800,10580,−4060). Mushroom Village has FOV 20°, near 80, far 13000, eye (3215.436,2377.272,6005.562), target (54.910,59.227,61.478). Board background metadata stores tile geometry plus FOV, scale, eye, look-at, and up vectors. The metadata record begins with four `u32` dimensions and then eleven `f32` values. `scale` is not read by the board camera code.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `u32` | `tileWidth` | 64. |
| `0x04` | 4 | `u32` | `tileHeight` | 48. |
| `0x08` | 4 | `u32` | `tilesX` | Horizontal tile count. |
| `0x0C` | 4 | `u32` | `tilesY` | Vertical tile count. |
| `0x10` | 4 | `f32` | `fovY` | FOV of full 4:3 picture. |
| `0x14` | 4 | `f32` | `scale` | Not dereferenced by game. |
| `0x18` | 12 | `f32[3]` | `eye` | Camera eye; multiplied ×5. |
| `0x24` | 12 | `f32[3]` | `lookAt` | Camera target; multiplied ×5. |
| `0x30` | 12 | `f32[3]` | `up` | Up vector. |

Board camera: `guPerspective(fovY, 4/3, 1000, 20000)` and `guLookAt(eye×5, lookAt×5, up)`. The 3D viewport covers the entire background picture; scrolling translates it by `(160−scrollX, 120−scrollY)` in screen pixels rather than changing camera pose. Verified by disassembly, RAM, and frame alignment for sampled boards. All map spaces land on painted paths when projected through the metadata camera; spaces and camera both use file units ×5. FOV is 17° except Mario board 16° and Island submaps 2–4 at 30°. Event-scene and arena starting camera positions remain incomplete.

## 4. Objects

### 4.1 Placement records

Board-space placement records are described under [Level container](#32-level-container). The game expands each to a 32-byte RAM record, scaling XYZ ×5; active status and mutable type allow star candidates and other dynamic board states to change appearance. File type 5 is a star candidate but generally displays as blue until selected. Mini-game and hub FORM instances are placed by overlay code rather than one uniform ROM placement table. Static overlay analysis yields 60 viewable scene recipes, including two Slot Car Derby tracks; runtime-dependent placements remain incomplete.

Paddle Battle's overlay table loads four river FORMs (71/0–3) and four matching water FORMs (71/4–7). The stored and live model positions agree: section Z positions are 7500, 2500, about −2495, and about −7490; the final water section is `(0, −3, −7485)`. Slot Car Derby's track table selects either 57/8+9 or 57/10+11 at 2× scale. A live gameplay frame and model-slot RAM dump show pair 57/8+9 rendered for selection index zero; image 57/19 does not replace the 3D track. These are verified by disassembly, RAM, and frames; selection conditions for the second pair remain unestablished.

### 4.2 Object and model formats

FORM's `OBJ1` tree and faces are defined under [Geometry](#33-geometry). Board space types 1–6, 8, and 9 use 32×32 RGBA32 disc/icon textures from mainfs 10/61–68; type 0 is invisible and type 7 is start. The game draws each active textured space as a 100×100 XZ quad with no lighting, scaled and translated by its board position. Type 3 on Island uses horizontal scale 1.5; normal spaces use 1.0. The quad is drawn in translucent mode without Z buffering. Verified by display-list disassembly and RAM matrix comparison.

### 4.3 Skeletons and animation

`SKL1` defines named nodes, 56 bytes each. The node header identifies the target OBJ1 name; each node has a nine-float transform, a 12-byte unused area, relative sibling and child indices, and a trailing `0x1C`. Child traversal retains the node matrix; sibling traversal uses its parent's. There are 1,100 standalone `MTNX` files and `MTN1` chunks in 276 FORM files. Static rest-pose rendering works without animation; track/interpolation semantics are not yet specified.

| Structure | Offset | Size | Type | Field | Description |
|---|---:|---:|---|---|---|
| SKL1 | `0x00` | 2 | `u16` | `nameIndex` | STRG name. |
| SKL1 | `0x02` | 1 | `u8` | `nodeCount` | Number of 56-byte nodes. |
| node | `0x00` | 1 | `u8` | `one` | Observed 1. |
| node | `0x01` | 2 | `u16` | `objectName` | STRG name selector. |
| node | `0x03` | 36 | `f32[9]` | `transform` | Position, rotation, scale. |
| node | `0x27` | 12 | `u8[12]` | `unknown_27` | Observed zero. |
| node | `0x33` | 2 | `s16` | `sibling` | Relative node index. |
| node | `0x35` | 2 | `s16` | `child` | Relative node index. |
| node | `0x37` | 1 | `u8` | `tag` | Observed `0x1C`. |

### 4.4 Behaviors, triggers, and scripted objects

Board chain exits use registered event tables and overlay functions. A merge supplies next chain/space constants; a split offers two target spaces; Eternal Star warp targets are selected from an overlay data table by star state. The game may compute other links at runtime. Mini-game behaviors and prop placements are overlay-specific and not a common stored format.

## 5. Audio

### 5.1 Audio storage and banks

Both S2 regions and FXD0 are byte-identical across J/U/E. Verified from ROM bytes. Table A has 81 songs and 69 B1 banks; B has seven songs and seven banks. Music data is uncompressed and read on demand. T3 stores effects (1,198 and 165 entries). All B1 banks are 32 kHz; two A banks (45, 46) have no song reference.

| Region | Japan ROM | Size | Contents |
|---|---:|---:|---|
| S2 A | `0x151DBD0` | `0x23F520` | 81 songs; B1 at +`0x7A0`, sequence data starts `0x172B8E0` |
| S2 B | `0x175D0F0` | `0xB9F20` | 7 songs; B1 at +`0xB0`, sequence data starts `0x1805290` |
| T3 A/B | `0x1817010` / `0x1B9C8A0` | `0x385890` / `0x1359F0` | Effects |
| FXD0 | `0x1CD2290` | `0x830` | Four custom reverb presets |

S2 offsets are relative to their S2 header. The eight-byte song directory precedes 16-byte song records. Verified from ROM bytes and all-song offline renders.

| Structure | Offset | Size | Type | Field | Description |
|---|---:|---:|---|---|---|
| S2 | `0x00` | 2 | `char[2]` | `magic` | `S2`. |
| S2 | `0x02` | 2 | `u16` | `songCount` | 81 or 7. |
| directory record | `0x00` | 4 | `u32` | `sequenceOffset` | Relative to S2 start. |
| directory record | `0x04` | 4 | `u32` | `sequenceLength` | Stored byte length. |
| song record | `0x00` | 1 | `u8` | `bank` | Bank index. |
| song record | `0x01` | 1 | `u8` | `volume` | Observed 127. |
| song record | `0x02` | 2 | `u16` | `unknown_02` | Observed `0xFFFF`. |
| song record | `0x04` | 4 | `u32` | `ctlOffset` | Relative bank-control offset. |
| song record | `0x08` | 4 | `u32` | `ctlSize` | Control byte count. |
| song record | `0x0C` | 4 | `u32` | `tblOffset` | Relative sample-table offset. |

### 5.2 Sequence format and driver

The game uses libultra compressed MIDI sequences through `alCSPlayer` and Hudson's sound-player wrapper. All 88 sequences have division 480. Events observed: CC7 volume, CC10 pan, CC91 reverb send, program change, pitch bend, and tempo. Each sequence begins with a 52 μs/tick tempo at tick zero and sets its real tempo at tick 1920 (or 1900). Loop control uses `FF 2D` with count=current=`0xFF`; 51 songs in A and two in B loop. On playback, the driver loads B1 control and sequence data, initializes bank/sequence, and plays at volume `0x7FFF`. Verified by disassembly and sequence bytes. Table B is selected for overlays 65, 97, 99, 100, 102–104, and 129; A otherwise.

### 5.3 Instruments and sample encoding

Every wave is libultra VADPCM at a nominal 32 kHz; no percussion instruments were found. The driver requests `osAiSetFrequency(32000)`, while emulator AI captures report an effective 32,006 Hz from DAC rate 1520. Synth configuration is 24 virtual and physical voices with 512 updates. The sound player supports four FXD0 custom reverb presets; boards choose 0 except Luigi, Bowser, and Eternal Star, which choose 1. Chance Time chooses 2. The exact audio RSP microcode identification is **Unknown**. Verified by bank parsing, disassembly, and AI capture logs.

### 5.4 Music catalog and loop points

The full 88-entry sequence index includes 16 identical two-beep placeholders: A0, A1, A20, A40, A41, A44, A62, A73–A80, and B0. The main playable songs, using the game's English jukebox titles where present, are:

| Table/index | Song or use | Loop | Principal use |
|---|---|---|---|
| A2–A7 | Mushroom Village, Warp Pipe, Bank, Option House, Shop, Mini-Game House | yes | Village and houses |
| A8–A15 | Eight board themes in board order | yes | Overlays 54–61 |
| A16–A19 | Outcome, Adventure Begins, Bowser, Koopa Troopa | yes | Board events/results |
| A21–A39 | Mini-game instruction/results and principal mini-game themes | mostly yes; A23 no | Mini-games |
| A42–A43 | Playing the Game; Where Have the Stars Gone | yes | Training and boards |
| A45–A46 | Mario Bandstand pieces | no | Overlay 38 |
| A47–A49 | Stolen Star; Where's the Star?; Stadium | yes | Board/stadium |
| A50–A64 | Jingles and short loops | mixed | Mini-game and victory cues |
| A65 | Mini-Game Island Theme | yes | Jukebox; no constant play site |
| A66–A72 | Mini-Game Island maps | yes | Overlays 114–118 |
| B1–B6 | Title, Power of Stars, Ending, staff prelude/roll, Opening | B3/B5 yes | Title/ending/opening |

The [complete song catalog and 53 sample-domain loop spans](#appendix-a-music-catalog) retain the Japanese jukebox strings, US titles where available, overlay play sites, and durations. Sample spans were derived at 32 kHz from tempo maps. Fifty of 53 offline loops were seamless; A2 has a 568-second drone crossing its short loop, and A9 contains a one-shot track that a simple whole-song loop repeats incorrectly. Reverb, vibrato, and tremolo are not yet modeled by the current offline player. These are verified from sequence bytes and renders; absolute gain versus captured game audio remains unknown. Comparison with game-captured audio found non-constant capture/render RMS ratios for A8 and A9, so no fixed gain correction is justified.

## 6. Unused and hidden content

### 6.1 Unreferenced assets

1,659 of 3,297 mainfs files have no *constant* ID reference, but many are loaded by computed IDs; this number is an upper bound on unused files. A second scan of scene-directory FORM assets leaves 120 without a resolved constant or indexed reference; this is still not proof of non-use. Stronger candidates include parts of the early Slot Car Derby directory 24, Bobsled Run animation assets 48/9–53, Hot Rope Jump's flat arena-sized FORM 66/4 (560 triangles and embedded camera markers, but no known code load), and 10/414–421. The former candidate Paddle Battle files 71/0–7 are **used** by its live eight-part course. Seven kind-2 FORM bitmaps contain all-zero unused 50×75 RGBA32 images; 723 FAC1 line records are never drawn. `test-kora` at 46/2 resembles 0/93; its actual use is unproven.

HVQ backgrounds 4, 14, 23, 33, 36, 44, 53, 61, 64, 66, 72, 74, and 103 have no constant or table reference in the scanned code. Several are annotated board miniatures; computed access remains possible. Preview 11/36 is a red/green/blue test grid without a found data reference. These are verified scan/decoding observations, not proof of unreachability.

### 6.2 Cut or inaccessible levels

Overlays 6 and 8 retain code and their own scenery (24/0, a dark maze; 26/0–2, a river), yet mini-game catalog IDs 7 and 9 redirect to final Slot Car Derby overlay 37. The debug labels for these superseded slots include `SAME GAME` and `YOSI NO SHITAAWASE`; calling their original gameplay “Slot Car Derby” would be an inference from the later catalog labels, not a verified fact. Their absence of alternate reachability is a **hypothesis**. Tour de Mario (ID 49) and Bungee Jump (ID 57) have strings but no dedicated overlay; ID 49 redirects to Bumper Ball Maze. The debug menu also preserves disabled labels for Piranha Plant, fire Goomba ranch, pole vault, lava fall, Bungee Jump, treasure crate, soccer, and other concepts. Verified from ROM strings and overlay tables; specific development-stage interpretations are hypotheses.

### 6.3 Debug features

Overlays 112, 122, 126, and 131 contain motion-check, random/sequential play, and mini-game menu facilities. The main binary has memory HUD, model loader error, and light-editor strings. Entry paths without code patches remain unknown. Verified from ROM bytes and disassembly. Japanese string 1252 is a text-window test without a US counterpart; string 1072 is an alignment placeholder retained in US/E. Mainfs 17/0–6 contains disk/Expansion Pak error images despite the retail cartridge release; actual execution references are unknown.

### 6.4 Prototype or revision-specific content

Europe adds overlay 112; language-selection purpose is a **hypothesis**. Japan and US share 102 of 105 HVQ backgrounds byte-for-byte; Eternal Star and two associated variants differ. Japanese ROM retains some English board logos; usage is unknown. Japanese A24 appears in the 46-entry jukebox; US drops it from the 45-entry jukebox while retaining the identical song in gameplay. These differences are verified from regional ROM bytes.

## 7. nviewer implementation

### 7.1 Module mapping

No Mario Party loader is present yet. A Japanese-only loader would register `CLBJ` after structural validation. Suggested modules:

| Module | Responsibility |
|---|---|
| `src/rom/marioparty/fs.ts` | Mainfs, overlays, strings; reuse the existing 1 KiB LZSS decoder. |
| `src/rom/marioparty/form.ts` | FORM tree, batches, textures, MAP1 collision. |
| `src/rom/marioparty/hvq.ts` | HVQ tile decoding and bottom-row-first assembly. |
| `src/rom/marioparty/boards.ts` | Fifteen board maps, space quads, paths, camera, backdrop. |
| `src/rom/marioparty/scenes.ts` | Arena and hub asset recipes, placements, fog, lights, cameras. |
| music integration | Two S2 tables through existing Hudson/libultra sequence support. |

### 7.2 Supported features

**Not yet implemented.** ROM analysis supports a planned 15-map board loader with HVQ backdrops, space quads, paths, static props, and hidden collision; arena and hub FORM rendering; and an 88-sequence music catalog. The proposed board camera is the original fixed metadata camera. Every drawn class should have a selectable layer, including hidden-by-default MAP1 collision.

### 7.3 Approximations and omissions

Unresolved arena placement and runtime lighting would initially require approximations. Dynamic characters, board-state changes, scene scripting, and some special path links are not representable solely from static files. Audio reverb/vibrato/tremolo and A2/A9 loop edge cases need fidelity work. No release support beyond Japan is specified for the viewer.

## 8. Verification and remaining work

### 8.1 Verification evidence

| Subject | Method and result |
|---|---|
| ROM map/regions | Japanese ROM region walk accounted for all data through `0x1CD2AC0`. |
| Mainfs | All 3,297 files decoded to declared size; 2,274 type-1 outputs match the shared 1 KiB LZSS decoder. |
| FORM | All 933 files parsed without leftover bytes; static assemblies checked in offline renders. |
| Scene assembly | Sixty static recipes pass clone-transfer; live Slot Car Derby and Paddle Battle frames/RAM confirm the 3D track and eight-part river respectively. |
| MAP1 | All 57 chunks walked exactly; loader behavior checked by disassembly. |
| HVQ | All 105 backgrounds/4,875 tiles and 55 previews decoded; sampled tiles byte-equal to game RAM cache. Repacking all 4,930 image streams and decoding them independently reproduced every RGBA5551 pixel; aggregate stream size fell by 16,878 bytes. |
| Boards | Fifteen definitions parsed exactly; space/world ×5 and selected camera projections matched RAM and emulator frames. |
| Music | All 88 songs rendered offline; 53 loop spans inspected, 50 seamless in current renderer. |

### 8.2 Known unknowns

- Exact audio RSP microcode version.
- Runtime-dependent arena FORM placements, follow-camera trajectories, many clear colours, and runtime light arrays.
- Full semantics of MAP1 cell fields and collision attributes.
- Some board special-case graph links, including Yoshi's gates, Bowser roulette, Wario cannons, Luigi doors, Mario/DK tails, Eternal Star warps, and Island mini-game nodes.
- Actual reachability of assets lacking constant/table references; computed IDs may load them.
- Scene-specific use of several HVQ backgrounds and the English board logos in the Japanese ROM.
- Exact track-loop and audio gain behavior for A2, A9, and reverb-dependent songs.
- Choosing HVQ DC planes, block modes, and AOT vectors from an arbitrary new bitmap at retail-like size and image quality. The reference syntax encoder preserves decoded pixels when repacking existing streams.

### 8.3 References

- [Hudson 1 KiB-ring LZSS](./compression/hudson-lzss.md) — shared codec description.
- [HVQ 2.0 still images](./compression/hvq2.md) — shared image bitstream and reference syntax codec.
- [Bomberman 64 specification](./BOMBERMAN64.md) — related mainfs and S2 audio structures.
## Appendix A. Music catalog

Japanese titles are verified from the Japanese jukebox strings. English titles are from the US strings; italicized use labels are editorial descriptions based on verified play sites. Durations end at the sequence loop or track end. Table A contains 81 slots, table B seven; the 16 two-beep stubs omitted from the rows are A0, A1, A20, A40, A41, A44, A62, A73–A80, and B0.

| # | Japanese | English / use | length s | loop | played by (overlay) |
|---|---|---|---|---|---|
| A2 | のどかなキノコむら | Peaceful Mushroom Village | 17.63 | yes | 105 hub |
| A3 | たびだちのワープドカン | Traveling the Warp Pipe | 29.83 | yes | 106 adventure setup |
| A4 | キノコバンクのテーマ | Mushroom Bank Theme | 15.45 | yes | 109 |
| A5 | オプションハウスのテーマ | Option House Theme | 17.37 | yes | 110 |
| A6 | キノコショップのテーマ | Mushroom Shop Theme | 19.96 | yes | 108 |
| A7 | ミニゲームハウスのテーマ | Mini-Game House Theme | 13.97 | yes | 107 |
| A8 | ジャングルアドベンチャー | Jungle Adventure | 54.01 | yes | 54 DK board |
| A9 | バースデーケーキ | Birthday Cake | 41.95 | yes | 55 Peach board |
| A10 | トロピカルアイランド | Tropical Island | 60.41 | yes | 56 Yoshi board |
| A11 | バトルキャニオン | Battle Canyon | 49.18 | yes | 57 Wario board |
| A12 | エンジンルーム | Engine Room | 39.92 | yes | 58 Luigi board |
| A13 | レインボーキャッスル | Rainbow Castle | 44.73 | yes | 59 Mario board |
| A14 | マグママウンテン | Magma Mountain | 48.31 | yes | 60 Bowser board |
| A15 | えいえんのスター | Eternal Star | 65.74 | yes | 61 Eternal Star board |
| A16 | ぼうけんのけっか | Outcome of Adventure | 30.08 | yes | 66, 67 bonus stars; 128 stadium results |
| A17 | ぼうけんのはじまり | Adventure Begins | 34.08 | yes | 98 board intro; 120 island start; 130 stadium start |
| A18 | クッパのテーマ | Bowser's Theme | 35.65 | yes | Bowser events (69, 70, 72, 73, 79, 83, 84, 87, 91, 93); 98 |
| A19 | ノコノコのテーマ | Koopa Troopa Theme | 14.07 | yes | 63 last 5 turns; 107; 119 island finish |
| A21 | ミニゲームをはじめよう！ | Play a Mini-Game! | 16.80 | yes | 111 instructions; 122, 126 debug |
| A22 | (きけなくなります) | *Mini-game results* | 7.60 | yes | 123, 124 results; 125 island MISS |
| A23 | (きけなくなります) | *Mario Bandstand piece 1* | 25.83 | no | 38 Mario Bandstand |
| A24 | ノリノリマンボ！ | Move to the Mambo! | 52.69 | yes | 11 Musical Mushroom; 19 Balloon Burst |
| A25 | うみはひろいよ | The Wide, Wide Ocean | 46.12 | yes | 4, 40, 43, 48 |
| A26 | キノコのもりで | In the Mushroom Forest | 46.52 | yes | 0 Memory Match |
| A27 | よけてかわして | Ducking and Dodging | 30.51 | yes | 16, 20, 21, 23, 28, 30, 34 |
| A28 | きけんがいっぱい | Full of Danger | 38.81 | yes | 25, 45, 46 |
| A29 | よのなかコインさ | Coins of the World | 26.43 | yes | 3, 13, 27, 33, 35, 36 |
| A30 | コインいただき | Taking Coins | 5.52 | yes | 2, 5, 7, 17, 32 |
| A31 | ちかのこべやで | The Room Underground | 18.73 | yes | 6 (unused), 9, 15, 42, 44 |
| A32 | じわりじわりと | Slowly, Slowly | 14.86 | yes | 10, 12 |
| A33 | きけんをかわそう | Dodging Danger | 36.76 | yes | 22, 49 |
| A34 | レッツ リンボー！ | Let's Limbo! | 30.38 | yes | 39, 41, 46, 50, 51 |
| A35 | スイスイいこうよ | Let's Go Lightly | 44.03 | yes | 24, 29 |
| A36 | いちかばちかのチャンスゲーム | Hit or Miss Chance Game | 20.99 | yes | 1 Chance Time |
| A37 | できるかな？ | Can It Be Done? | 8.25 | yes | 14, 18 |
| A38 | だれよりもはやく | Faster Than All | 27.44 | yes | 37, 47, 52 |
| A39 | ゆうきをためそう | Saving Courage | 22.98 | yes | 26, 31 |
| A42 | ゲームのあそびかた | Playing the Game | 41.75 | yes | 62 training map; 98 |
| A43 | スターはどこに？ | Where Have the Stars Gone | 8.10 | yes | 54-60 boards |
| A45, A46 | (きけなくなります) | *Mario Bandstand pieces 2, 3* | 25.83 | no | 38 |
| A47 | うばわれたスター | The Stolen Star | 30.57 | yes | 105, 109 |
| A48 | スターはどこ！？ | Where's the Star? | 8.99 | yes | 61 |
| A49 | ミニゲームスタジアムのテーマ | Mini-Game Stadium Theme | 44.53 | yes | 127 stadium |
| A50–A55, A60 | – | *Mini-game end jingles A-G* | 3.1-4.8 | no | most mini-games (A52 is the common one) |
| A56 | – | *Mushroom Bank jingle* | 4.68 | no | 109 |
| A57 / A58 | – | *Board intro jingle / loop* | 5.26 / 7.43 | no / yes | 98 |
| A59 | – | *Slot Machine jingle* | 3.72 | no | 2 |
| A61 | – | *Slot Car Derby jingle* | 3.43 | no | 37 |
| A63 / A64 | – | *Victory fanfare / winner loop* | 5.59 / 23.51 | no / yes | 66, 67, 119, 128 |
| A65 | ミニゲームアイランドのテーマ | Mini-Game Island Theme | 70.80 | yes | jukebox only; see [Unused and hidden content](#6-unused-and-hidden-content) |
| A66, A67, A68, A72 | – | *Mini-Game Island map* (chosen by save flags 10, default, 15, 50) | 10.20 | yes | 114 |
| A69, A70, A71 | – | *Mini-Game Island sub-maps 1, 2-3, 4* | 10.20 | yes | 115, 116/117, 118 |
| B1 | マリオパーティのテーマ | Mario Party Theme | 35.01 | no | 129 title |
| B2 | スターのちから | The Power of Stars | 28.33 | no | 65 ending |
| B3 | エンディング | Ending | 26.77 | yes | 65 |
| B4 | – | *Staff roll prelude* | 36.42 | no | 99 |
| B5 | みんなスーパースター！ | Everyone's a Super Star! | 124.75 | yes | 99 staff roll |
| B6 | オープニング | Opening | 199.31 | no | 97 opening |

### Loop points

Sample-domain loop spans at 32,000 Hz, verified by sequence tempo maps and offline rendering. The first track's `FF 2E`/`FF 2D` delimiters determine the span. A2 is not seamless because of its long sustained note; A15 and A49 have small render seams.

| song | start | end | song | start | end | song | start | end |
|---|---|---|---|---|---|---|---|---|
| A2 | 283202 | 564204 | A18 | 3255 | 1140643 | A36 | 45287 | 671524 |
| A3 | 192733 | 954409 | A19 | 23615 | 450310 | A37 | 2393 | 264131 |
| A4 | 6741 | 494392 | A21 | 25915 | 537654 | A38 | 100342 | 877978 |
| A5 | 44148 | 555909 | A22 | 3192 | 243057 | A39 | 107017 | 735252 |
| A6 | 59139 | 638642 | A24 | 55733 | 1686159 | A42 | 107500 | 1335862 |
| A7 | 20328 | 447078 | A25 | 120561 | 1475681 | A43 | 3249 | 259094 |
| A8 | 348152 | 1728430 | A26 | 141810 | 1488645 | A47 | 18557 | 978350 |
| A9 | 18939 | 1342425 | A27 | 3239 | 976457 | A48 | 3255 | 287610 |
| A10 | 13112 | 1933072 | A28 | 250856 | 1241825 | A49 | 287465 | 1424916 |
| A11 | 3192 | 1573601 | A29 | 96781 | 845906 | A58 | 3225 | 237742 |
| A12 | 242994 | 1277460 | A30 | 13335 | 176563 | A64 | 377669 | 752256 |
| A13 | 21100 | 1431229 | A31 | 3192 | 599409 | A65 | 1942238 | 2265496 |
| A14 | 10724 | 1545807 | A32 | 3192 | 475546 | A66–A68, A70–A72 | 3264 | 326450 |
| A15 | 229600 | 2103583 | A33 | 963078 | 1176453 | A69 | 3374 | 326572 |
| A16 | 3192 | 962642 | A34 | 375751 | 972042 | B3 | 3327 | 856624 |
| A17 | 67087 | 1090499 | A35 | 3192 | 1408942 | B5 | 662100 | 3992120 |

## Appendix B. Mini-game identifiers

Japanese names are verified from Japanese string indices 802 + ID. English names are from the US release (string indices 804 + ID), not translations inferred from model names. Overlay associations are verified from the Japanese debug-menu and instruction tables. IDs 7 and 9 redirect to the final Slot Car Derby overlay; IDs 49 and 57 have no dedicated overlay.

| id | Japanese | English (U) | overlay |
|---|---|---|---|
| 1 | えあわせパネル | Memory Match | 0 |
| 2 | いちかばちか | Chance Time | 1 |
| 3 | ソロッタマシーン | Slot Machine | 2 |
| 4 | あなほりマリオ | Buried Treasure | 3 |
| 5 | すもぐりマリオ | Treasure Divers | 4 |
| 6 | ノコノコたまてばこ | Shell Game | 5 |
| 7 | スロットルレーシングS | Slot Car Derby 1 | 37 (unused overlay 6) |
| 8 | ボムへいわたし | Hot Bob-omb | 7 |
| 9 | スロットルレーシングL | Slot Car Derby 2 | 37 (unused overlay 8) |
| 10 | ドキドキあみだドカン | Pipe Maze | 9 |
| 11 | リーダーはだれだ？ | Ghost Guess | 10 |
| 12 | キノコ！1ばんのり！！ | Musical Mushroom | 11 |
| 13 | ビカビカじかはつでん | Pedal Power | 12 |
| 14 | はっくつ！ハッスル！！ | Crazy Cutter | 13 |
| 15 | クッパひゃくめんそう | Face Lift | 14 |
| 16 | パックンたたき | Whack-a-Plant | 15 |
| 17 | クッパのきもち | Bash 'n' Cash | 16 |
| 18 | ボーリングGO！GO！ | Bowl Over | 17 |
| 19 | ひっこめヒップドロップ | Ground Pound | 18 |
| 20 | クッパふうせん | Balloon Burst | 19 |
| 21 | 10カウントコイン | Coin Block Blitz | 20 |
| 22 | ハンマーコイン | Coin Block Bash | 21 |
| 23 | くずれるゆかをかけろ！ | Skateboard Scamper | 22 |
| 24 | ブロックやまくずし | Box Mountain Mayhem | 23 |
| 25 | プレートわたり | Platform Peril | 24 |
| 26 | ぐらぐらタワー | Teetering Towers | 25 |
| 27 | いろいろキノコ | Mushroom Mix-Up | 26 |
| 28 | はしれ！のっかれボール | Bumper Ball Maze 1 | 52 |
| 29 | ガッポリよこどりコイン | Grab Bag | 28 |
| 30 | スライダーボブスレー | Bobsled Run | 29 |
| 31 | のっかれボール | Bumper Balls | 30 |
| 32 | オットット！つなわたり | Tightrope Treachery | 31 |
| 33 | ビックリきばこドスン！ | Knock Block Tower | 32 |
| 34 | ノコノコころころ | Tipsy Tourney | 33 |
| 35 | ぷかぷかアイランド | Bombs Away | 34 |
| 36 | くれくれ！クレーン | Crane Game | 35 |
| 37 | いそげ！のっかれボール | Bumper Ball Maze 2 | 52 |
| 38 | スロットルレーシング | Slot Car Derby | 37 |
| 39 | マリオオーケストラ | Mario Bandstand | 38 |
| 40 | ムカデGO！GO！ | Desert Dash | 39 |
| 41 | はたあげヘイホー | Shy Guy Says | 40 |
| 42 | リンボーダンス | Limbo Dance | 41 |
| 43 | ボムへいバスケット | Bombsketball | 42 |
| 44 | おたからフィッシング | Cast Aways | 43 |
| 45 | キー！KEY！キープ！ | Key-pa-Way | 44 |
| 46 | てらせ！テレサのやかた | Running of the Bulb | 45 |
| 47 | なわなわピョンピョン | Hot Rope Jump | 46 |
| 48 | トロッコレース | Handcar Havoc | 47 |
| 49 | ツールドマリオ | (untranslated; "Tour de Mario") | none; see [cut content](#62-cut-or-inaccessible-levels) |
| 50 | マリオブルー | Deep Sea Divers | 48 |
| 51 | ジュラシックパックン | Piranha's Pursuit | 49 |
| 52 | つなひきデンジャラス | Tug o' War | 50 |
| 53 | マリオボート | Paddle Battle | 51 |
| 54 | すすめ！のっかれボール | Bumper Ball Maze 3 | 52 |
| 55 | ハッピーふらわー | Coin Shower Flower | 36 |
| 56 | ぎぶみーハンマーブロス | Hammer Drop | 27 |
| 57 | バンジージャンプ | Bungee Jump | none; see [cut content](#62-cut-or-inaccessible-levels) |
| 58 | クッパのつなひき | Bowser's Tug o' War | not in either table (open question) |
