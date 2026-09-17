# Banjo-Kazooie — Nintendo 64 ROM format specification

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | Offset-indexed asset table, with separate soundfonts and compressed code overlays. |
| Compression | `1172` plus a big-endian 32-bit decoded size and raw DEFLATE; six-byte header. |
| Graphics microcode | F3DEX 1.21; L3DEX 1.21 is also embedded. |
| Geometry | Model assets contain vertices, F3DEX display lists, and a command tree. |
| Textures | CI4, CI8, RGBA16, RGBA32, IA8; CI palettes are RGBA16. |
| Collision | Per-model spatial grids of indexed triangles, sharing model vertices. |
| Music driver | Rare's `n_audio`-based compressed-sequence player. |
| Audio microcode | Nintendo `n_audio` task; exact binary revision not established. |
| Sample encoding | VADPCM in two `ALBankFile` soundfonts. |
| Levels | 128 model-table map records, with 129 setup assets; 25 map IDs are geometry stubs. |
| Memory requirement | Base 4 MiB. |
| Viewer support | Planned: USA V1.0 maps, objects, collision, sky, and 173 music slots. |

### 1.2 ROM identification

Verified from normalized `.z64` ROM bytes. CRC1/CRC2 in the USA V1.0 header were recomputed for CIC-6103; SHA-1 covers the complete image. The Japan ROM was examined during the original asset comparison but is not present in the current verification set; its previously recorded SHA-1 is not repeated here.

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| USA V1.0 | `Banjo-Kazooie` | `NBKE` | 0 | 16 MiB (`0x1000000`) | `A4BF9306` | `BF0CDFD1` | `1fe1632098865f639e22c11b9a81ee8f29c75d7a` | 6103 | Unknown |
| USA V1.1 | `Banjo-Kazooie` | `NBKE` | 1 | 16 MiB (`0x1000000`) | `CD7559AC` | `B26CF5AE` | `ded6ee166e740ad1bc810fd678a84b48e245ab80` | 6103 | Unknown |
| Europe (M3) | `Banjo-Kazooie` | `NBKP` | 0 | 16 MiB (`0x1000000`) | `733FCCB1` | `444892F9` | `bb359a75941df74bf7290212c89fbc6e2c5601fe` | 6103 | Unknown |

### 1.3 Terminology and conventions

Offsets below refer to USA V1.0 unless qualified. ROM ranges are half-open and multi-byte fields are big-endian except where stated. An *asset* is an indexed table entry; empty entries have zero stored length. A *map* is a loadable area identified by the game's map number, while a *level* groups maps into a world. `opa` and `xlu` denote the opaque and translucent model of a map. A *setup* holds placed nodes, props, cameras, and lights. Addresses beginning `0x80` are KSEG0 virtual addresses, not ROM offsets.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

Verified by disassembly of the USA V1.0 boot code and by decompressing the code images. The N64 header gives entry `0x80100400`; CIC-6103 enters the linked stub at `0x80000400`. That stub clears BSS, sets the stack and branches to the boot body at `0x80000450`. The boot body loads core1, then core2 and one level overlay at a time. Its overlay map names 15 overlay slots, including an empty `coshow` dummy.

| ROM range | Stored size | Decoded size | Destination | Compression | Contents |
|---|---:|---:|---|---|---|
| `[0x1000,0x5E70)` | `0x4E70` | same | `0x80000400` onward | none | Entry stub and boot code. |
| `[0xF19250,0xF37F90)` | `0x1ED40` | text `0x37BF0`, data `0x4B20` | `0x8023DA20` | size-bearing `1172` | Core1, including libultra, graphics, audio and asset loader. |
| `[0xF37F90,0xFA3FD0)` | `0x6C040` | text `0xDC600`, data `0x16600` | `0x80286F90` | size-bearing `1172` | Core2 game logic, model and map tables. |
| `[0xFA3FD0,0xFDAA30)` | `0x36A60` | overlay-dependent | `0x803863F0` | size-bearing `1172` | One of 14 level overlays or the empty dummy. |

Code images contain separately compressed text and data streams. The ROM ranges above include alignment; decoded columns give text and initialized data and exclude BSS. The overlay table in core1 data at `0x802762D0` has 15 records of `0x2C` bytes. Its fields include name pointer, RAM text/data/BSS ranges and source-image positions; the source-image positions refer to the decompressed build and must not be used as physical retail-ROM offsets. The loaded overlay ID is stored at `0x80276564`.

### 2.2 Memory and address mapping

For USA V1.0, core1 text begins at `0x8023DA20`, core2 text at `0x80286F90`, core2 data at `0x80363590`, and the current overlay at `0x803863F0`. Code pointers in tables are virtual addresses within these decoded images. Asset-table offsets are relative to the asset-data base at ROM `0x10CD0`; model-local offsets are relative to the decoded model's start. Model display-list segments are assigned by the renderer, not ROM address space: segment 1 addresses vertices, segment 2 texture data, and segment 3 a runtime render-mode table.

### 2.3 ROM map and asset organization

Verified by walking the ROM table and disassembling its reader. All physical bytes of USA V1.0 are accounted for:

| ROM range | Stored size | Decoded size | Destination | Compression | Contents |
|---|---:|---:|---|---|---|
| `[0x000000,0x001000)` | `0x1000` | same | boot | none | Header and IPL3. |
| `[0x001000,0x005E70)` | `0x4E70` | same | boot | none | Entry and boot code. |
| `[0x005E70,0x005E90)` | `0x20` | same | boot | none | Checksum words and zero padding. |
| `[0x005E90,0x010CD0)` | `0xAE40` | same | asset cache | none | Asset index. |
| `[0x010CD0,0xD846B8)` | `0xD739E8` | asset-dependent | heap | size-bearing `1172`, or raw | Asset payloads. |
| `[0xD846B8,0xD846C0)` | `0x8` | — | — | — | Alignment. |
| `[0xD846C0,0xD954B0)` | `0x10DF0` | same | audio heap | none | Soundfont 1 control. |
| `[0xD954B0,0xEA3EB0)` | `0x10EA00` | same | audio heap | VADPCM samples | Soundfont 1 sample table. |
| `[0xEA3EB0,0xEADE60)` | `0x9FB0` | same | audio heap | none | Soundfont 2 control. |
| `[0xEADE60,0xF19250)` | `0x6B3F0` | same | audio heap | VADPCM samples | Soundfont 2 sample table. |
| `[0xF19250,0xFDAA30)` | `0xC17E0` | segment-dependent | code RAM | size-bearing `1172` | Core1, core2, level overlays. |
| `[0xFDAA30,0x1000000)` | `0x255D0` | — | — | — | `0xFF` fill. |

The asset table begins at ROM `0x5E90`. It has `count = 0x15C7` entries in USA V1.0; entry `0x15C6` is a terminal offset sentinel. Header size is eight bytes and each entry is eight bytes. The data base is `0x5E90 + 8 + 8 × count = 0x10CD0`. Stored asset `i` occupies `[base + offset[i], base + offset[i+1])`, so the last real ID is `0x15C5`.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | u32 | `entryCount` | Includes terminal sentinel. |
| `0x04` | 4 | u32 | `marker` | Always `0xFFFFFFFF` in the inspected images. |
| `0x08 + 8 × i` | 4 | u32 | `offset[i]` | Relative to the data base. |
| `0x0C + 8 × i` | 2 | s16 | `flags[i]` | Bit 0 marks compressed data. |
| `0x0E + 8 × i` | 2 | s16 | `type[i]` | 0 model, 1 sprite, 2 special image, 3 miscellaneous data, 4 empty ID. |

USA V1.0 has 3,308 compressed, six raw and 2,260 zero-length real entries. Asset IDs `0x71D`–`0x7B5` are 129 map setups (`asset = map + 0x71C`), `0x146B`–`0x1515` include map models, and `0x1516`–`0x15C2` are 173 music sequences (`asset = 0x1516 + song ID`). The archive also contains 667 skeletal animations, sprites, text, demo inputs and object models. The six raw assets are sprites `0x704`, `0x705`, `0x7D9`, `0x7DA`, `0x7DB`, `0x7DE`.

### 2.4 Compression formats

Banjo's streams use [raw DEFLATE and a Rare wrapper](compression/raw-deflate.md). The `11 72` tag is shared with GoldenEye, but Banjo inserts a **big-endian u32 decoded size** before the RFC 1951 bitstream. GoldenEye's `1172` has no size field; Perfect Dark's `1173` uses a three-byte size. The wrapper is six bytes; the encoded stream terminates at the DEFLATE final-block bit. The asset-table extent may include `0xAA` alignment bytes after it.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | bytes | `tag` | `11 72`. |
| `0x02` | 4 | u32 | `decodedSize` | Exact output byte count. |
| `0x06` | variable | raw DEFLATE bits | `payload` | RFC 1951 final block ends the stream. |
| after payload | 0–15 | bytes | `alignment` | `0xAA` fill within indexed extent; not input to the bitstream. |

Verified from all 9,399 compressed asset entries in the three currently available ROMs (3,308 USA V1.0, 3,038 USA V1.1, 3,053 Europe): every header and decoded size is valid. A previous four-version audit decoded 12,586 asset and code streams with the viewer inflater and Node zlib with no byte mismatches. During emulation, 475 decompression outputs from map loads matched extracted ROM data byte-for-byte. For the largest USA V1.0 asset, model `0x14DA` at ROM `0x9981C8`, wrapper and DEFLATE consume `0x38883` bytes; the five remaining bytes to the indexed end `0x9D0A50` are `AA`. Its decoded size is `0x79034`.

### 2.5 Loading process

Verified by disassembly and asset-load breakpoints. The loader reads the asset table from ROM `0x5E90` into RAM, uses the flag to choose raw copying or inflation, allocates from the decoded size rounded to 16 bytes, and retains resources in a 150-slot reference-counted cache. `assetcache_get` is at `0x8033B798`; the size/flag helpers are at `0x8033B684` and `0x8033B6A4`. `file_openMap` at `0x8034AB6C` requests setup asset `map + 0x71C`. Map-model, section, sky and music tables in decoded core2 data select the remaining resources. The world selects a level overlay, which registers actors and runs level-specific behavior.

### 2.6 Revision differences

Verified from the three available ROM tables and previously decoded Japan image. IDs below `0x8A3` retain their numbers; higher IDs are compacted in USA V1.1, Europe and Japan. Consequently, map-model and music asset IDs cannot be reused verbatim across revisions. The table format, six-byte compression wrapper, model format and setup-map offset remain stable.

| Feature | USA V1.0 | USA V1.1 | Europe (M3) | Japan |
|---|---|---|---|---|
| Game code/revision | `NBKE`/0 | `NBKE`/1 | `NBKP`/0 | `NBKJ`/0 |
| Asset entries | `0x15C7` | `0xE24` | `0xE25` | `0xE3A` |
| Asset data base | `0x10CD0` | `0xCFB8` | `0xCFC0` | `0xD068` |
| Soundfont 1 control ROM | `0xD846C0` | `0xD87CA0` | `0xDA8DF0` | `0xDA80A0` |
| Core1 ROM start | `0xF19250` | `0xF1C830` | `0xF3D980` | `0xF3CC30` |
| Spiral Mountain opaque model asset | `0x14CF` | `0xD2C` | `0xD2D` | `0xD35` |

USA V1.1 and Europe share 148 of 161 map-model decoded byte strings with USA V1.0. Thirteen differ: nine Treasure Trove Cove models, the Mad Monster Mansion well, Rusty Bucket Bay engine room, Click Clock Wood winter translucent model, and Gruntilda's Lair Gobi's Valley lobby. Their game effect is not established. Europe dialog assets contain English, French and German subrecords; Japan uses a distinct glyph encoding. Music sequence data is largely shared, with one altered sequence in USA V1.1/Europe and three in Japan.

## 3. Level data

### 3.1 Level catalog and identifiers

Verified from the USA V1.0 section, map-model and main-exit tables in core2 data. Maps are grouped under the pause-menu world names; individual area names below are descriptive and are not displayed in-game. The internal ROM section table has names for 128 maps. There are 25 additional stub IDs without model or section records. Maps that reuse the same model retain distinct setups and behavior.

| Group | Main map | Other maps (hex IDs) |
|---|---|---|
| Spiral Mountain | `01` | Banjo's House `8C`. |
| Gruntilda's Lair | `69` | `6A`–`72`, `74`–`7A`, `80`, `8E`, `93`; battlements `90`. |
| Mumbo's Mountain | `02` | Ticker's Tower `0C`, Mumbo's skull `0E`. |
| Treasure Trove Cove | `07` | Ship `05`, Nipper's shell `06`, sandcastle `0A`, Sharkfood Island `8F`. |
| Clanker's Cavern | `0B` | Inside `21`–`23`. |
| Bubblegloop Swamp | `0D` | Mr. Vile `10`, Tiptup `11`, Mumbo's skull `47`. |
| Freezeezy Peak | `27` | Igloo `41`, Mumbo's skull `48`, Christmas tree `53`, Wozza's cave `7F`. |
| Gobi's Valley | `12` | `13`–`16`, Jinxy `1A`, secret chamber `92`. |
| Mad Monster Mansion | `1B` | `1C`–`1D`, `24`–`30`, inside Loggo `8D`. |
| Rusty Bucket Bay | `31` | Engine room `34`, warehouse `35`, boathouse `36`, containers `37`/`38`/`3E`, crew cabin `39`, boss room `3A`, storage `3B`, kitchen `3C`, navigation `3D`, captain's cabin `3F`, anchor room `8B`. |
| Click Clock Wood | `40` | Seasonal main maps `43`–`46`, Mumbo's skull `4A`–`4D`, hives `5A`–`5C`, Nabnut's house `5E`–`61`, water supply `63`–`64`, Whipcrack rooms `65`–`68`, winter honeycomb `62`. |
| Cutscenes and front end | — | Logo intros `1E`–`1F`; ending beach `20`, `95`–`97`; Grunty's fall `87`; file select `91`; additional intro/ending maps `7B`–`7E`, `81`–`8A`, `94`, `98`–`99` where present in the model table. Credits-only Klungo map `84` belongs here. |

The main-exit table has 13 `{level, map, exit}` records; examples are Spiral Mountain `01`/`12`, Mumbo's Mountain `02`/`05`, Treasure Trove Cove `07`/`04`, and the boss battlements `90`/`00`. Map IDs `03`, `04`, `08`, `09`, `0F`, `17`–`19`, `32`, `33`, `42`, `49`, `4E`–`52`, `54`–`59`, `5D`, `73` are stubs, not complete levels. Map `73` retains a setup but no environment model; details are under [cut or inaccessible levels](#62-cut-or-inaccessible-levels).

### 3.2 Level container

There is no single contiguous level file. A map combines one opaque model, an optional translucent model, setup asset `0x71C + map`, optional sky models, music and the current level overlay. The core2 map-model table at data offset `0x7650` has 128 records of `0x18` bytes, ending at map ID zero. Offsets refer to USA V1.0 decoded core2 data; model IDs are asset-table indices. The two `gridDelta` vectors modify object-grid extents and are not world-coordinate bounds.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | s16 | `map` | Map ID; zero terminates the table. |
| `0x02` | 2 | s16 | `opaqueModel` | Asset ID. |
| `0x04` | 2 | s16 | `translucentModel` | Asset ID, zero if absent. |
| `0x06` | 6 | s16[3] | `gridDeltaMin` | Added to object-grid lower extents. |
| `0x0C` | 6 | s16[3] | `gridDeltaMax` | Added to object-grid upper extents. |
| `0x12` | 2 | u16 | `reserved_12` | Unused/zero. |
| `0x14` | 4 | f32 | `scale` | Model transform: 1 except selected house/lab/cutscene maps at 5/3. |

The section table has eight-byte records in decoded core2 data; `namePointer` addresses a ROM-internal string in RAM:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | s16 | `map` | Map ID. |
| `0x02` | 2 | s16 | `level` | World/overlay group. |
| `0x04` | 4 | ptr | `namePointer` | RAM address of internal name. |

The sky table has `0x28`-byte records keyed by map and up to three layers:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | s16 | `map` | Map ID. |
| `0x02` | 2 | u16 | `reserved_02` | Padding. |
| `0x04 + 0x0C × i` | 2 | s16 | `modelId[i]` | Sky model asset ID; zero means empty layer. |
| `0x06 + 0x0C × i` | 2 | u16 | `reserved[i]` | Padding. |
| `0x08 + 0x0C × i` | 4 | f32 | `scale[i]` | Model scale. |
| `0x0C + 0x0C × i` | 4 | f32 | `rotationSpeed[i]` | Degrees per second about +Y. |

Here `i = 0, 1, 2`. The map-music table has 131 eight-byte records; `song2 = −1` means absent. All pointers and strides are verified by the corresponding core2 reader functions.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | s16 | `map` | Map ID. |
| `0x02` | 2 | s16 | `song1` | Primary song ID. |
| `0x04` | 2 | s16 | `song2` | Optional concurrent song ID. |
| `0x06` | 2 | s16 | `flags` | Map music flags. |

### 3.3 Geometry

Verified on all 823 model assets. Every decoded model begins with magic `0x0000000B` and a `0x38`-byte header. Its offsets are relative to the decoded asset start; zero means a section is absent. The sections are aligned in the model itself; their counts come from their own headers or the model's vertex/triangle counts. Map model vertices are right-handed, +Y up, with no axis mirroring. The model-table scale applies to geometry, not already placed objects.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | u32 | `magic` | `0x0000000B`. |
| `0x04` | 4 | s32 | `layoutOffset` | Geometry command tree, last section. |
| `0x08` | 2 | s16 | `textureOffset` | Texture list, normally `0x38`. |
| `0x0A` | 2 | s16 | `geometryType` | Bit 1 trilinear mipmapping; bit 2 environment mapping. |
| `0x0C` | 4 | s32 | `displayListOffset` | Gfx array. |
| `0x10` | 4 | s32 | `vertexOffset` | Vertex-list header and N64 vertices. |
| `0x14` | 4 | s32 | `hitboxOffset` | Object hitboxes, when present. |
| `0x18` | 4 | s32 | `boneOffset` | Bones/animation metadata. |
| `0x1C` | 4 | s32 | `collisionOffset` | Collision grid. |
| `0x20` | 4 | s32 | `cameraAreaOffset` | Camera-area boxes. |
| `0x24` | 4 | s32 | `meshOffset` | Runtime vertex-group effects. |
| `0x28` | 4 | s32 | `animatedVertexOffset` | Runtime vertex-animation data. |
| `0x2C` | 4 | s32 | `animatedTextureOffset` | Frame descriptors. |
| `0x30` | 2 | u16 | `triangleCount` | Reachable render triangles; exact on all 823 assets. |
| `0x32` | 2 | u16 | `vertexCount` | Exact on all 823 assets. |
| `0x34` | 4 | f32 | `distance_34` | Purpose unverified; generally 100 for maps. |

The vertex-list header has size `0x18`:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 6 | s16[3] | `minimum` | XYZ bounds. |
| `0x06` | 6 | s16[3] | `maximum` | XYZ bounds. |
| `0x0C` | 6 | s16[3] | `center` | XYZ center. |
| `0x12` | 2 | s16 | `localNormal` | Normalization parameter. |
| `0x14` | 2 | s16 | `count` | Number of 16-byte vertices. |
| `0x16` | 2 | s16 | `globalNormal` | Normalization parameter. |

Each 16-byte N64 vertex follows:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 6 | s16[3] | `position` | XYZ. |
| `0x06` | 2 | u16 | `reserved_06` | Padding. |
| `0x08` | 4 | s16[2] | `textureST` | Texture coordinates. |
| `0x0C` | 4 | u8[4] | `colorOrNormal` | RGBA; RGB is signed normal on environment-mapped geometry. |

Segment 1 maps index `i` to `0x01000000 + 16 × i`.

The layout tree starts at `layoutOffset`. Every node begins with an eight-byte header and sibling linkage; node-specific branches address children within the decoded model. The 823 trees traverse without loops or invalid references.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | u32 | `command` | Node kind, listed below. |
| `0x04` | 4 | s32 | `next` | File-relative sibling offset; zero ends the sibling chain. |

The following is an opcode overview, not a complete on-disk layout for every node; use the verified common header and the game reader for authoring or editing command payloads. `branch` values are model-relative unless a command says otherwise.

| Command | Name | Principal operands | Viewer interpretation |
|---|---|---|---|
| `0x00` | Billboard | Branch, pitch flag, f32 position[3]. | Camera-facing child geometry. |
| `0x01` | Sort | Two f32 points[3], flags and two branches. | Draw both branches statically. |
| `0x02` | Bone | Child branch and matrix index. | Bind-pose object geometry. |
| `0x03` | LoadDL | s16 Gfx command index. | Draw list at `displayListOffset + 8 + index × 8`. |
| `0x05` | Skinning | s16 list indices ending in zero. | Object skeletal geometry. |
| `0x08` | LOD | f32 max/min/radius point and child branch. | Near branch for static display. |
| `0x0A` | Refpoint | Index, matrix and f32 position[3]. | Runtime reference point. |
| `0x0C` | Selector | Count, index and branch array. | Select by map appendage state. |
| `0x0D` | DrawDistance | s16 min/max boxes and branch. | Frustum/distance culling. |
| `0x0E` | SphereCull | s16 position/radius, branch, matrix. | Sphere culling. |
| `0x0F` | Camera | Branch, count, flags, area IDs. | Camera-area visibility selector. |
| `0x10` | TexWrap | s32 mode. | Mip tile clamp or wrap. |

The `Stored payload` summary is not a substitute for a byte layout; command-specific offsets are variable and their exact padding and pointer domains should be checked before writing an independent editor. For a renderer, preserving command semantics and the common node header is sufficient.

### 3.4 Display lists and render state

Core1 embeds F3DEX 1.21 and L3DEX 1.21 identification strings. All stored model lists use F3DEX 1.x commands; the common `B1` is two triangles (TRI2), not the four-triangle variant used by some other Rare games. The Gfx-array header is eight bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | u32 | `commandCount` | Number of following eight-byte Gfx commands. |
| `0x04` | 4 | u32 | `reserved_04` | Zero. |
| `0x08 + 8 × i` | 8 | u32[2] | `command[i]` | F3DEX Gfx word pair. |

A tree LoadDL node indexes this array, and each selected list terminates with `B8` ENDDL. The complete opcode histogram contains no MTX, light, fog, fill-rect or extended `C0` command in stored model lists.

| Opcode | Command | Interpretation |
|---|---|---|
| `04` | VTX | Segment-1 vertex load, at most 32 vertices. |
| `B1`, `BF` | TRI2, TRI1 | Geometry; F3DEX indices are multiplied by two. |
| `06` | G_DL | Calls runtime segment-3 render-mode entry `0x03000000 + 16 × k`. |
| `FD`, `F5`, `F3`, `F0` | SETTIMG, SETTILE, LOADBLOCK, LOADTLUT | Texture and palette setup. |
| `FC`, `BB` | SETCOMBINE, G_TEXTURE | Combiner and texture tile/scale. |
| `B6`, `B7` | Geometry mode | Back-face culling and environment mapping. |
| `B9` | Other-mode low | Alpha compare in selected lists. |

Verified against runtime frame display lists for 16 captured scenes: sky renders without Z, then opaque map, actors, and translucent map. Opaque uses depth compare and write; translucent uses compare without write. The runtime segment-3 table maps `k=0,1,6,7` to opaque modes and `k=2,3,4,5,8` to translucent modes. Opaque-model `k=4/5` under alpha compare is a **cutout that writes depth**, not ordinary alpha blending; this matters at the Treasure Trove Cove dock. The blend-color alpha threshold is `0x80`. All captured map triangles used bilinear texture filtering. No fog render mode or decal Z mode was observed.

The principal combiner `FC129804 3F15FFFF` yields texel × environment × vertex RGB. `FC269804 1F14FFFF` is the mipmapped texel × vertex path, `FC62FE04 3F15F9FF` is untextured environment × vertex, and `FCFF99FF FF14FE3F` is environment mapping. Environment is white in normal map frames. Non-environment-mapped geometry uses stored prelit vertex colors; the game does not compute per-vertex directional lighting on these surfaces. Preserving vertex alpha is necessary for translucent water and edge fades.

### 3.5 Textures and materials

Verified from all model texture lists and display-list loads. The texture section begins with an eight-byte header, then `count` entries of 16 bytes each, followed by image payloads. Each entry's data offset is relative to the *end* of the entry array (segment-2 base). CI palettes immediately precede their index texels. Level-zero images are sufficient for a static viewer.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | s32 | `sectionSize` | Includes this header and entries. |
| `0x04` | 2 | s16 | `textureCount` | Number of 16-byte entries. |
| `0x06` | 2 | u16 | `reserved_06` | Zero. |
| `0x08 + 16 × i` | 4 | s32 | `dataOffset[i]` | Relative to end of texture-info array. |
| `0x0C + 16 × i` | 2 | s16 | `format[i]` | Table below. |
| `0x0E + 16 × i` | 2 | u16 | `reserved[i]` | Zero. |
| `0x10 + 16 × i` | 1 | u8 | `width[i]` | Texels. |
| `0x11 + 16 × i` | 1 | u8 | `height[i]` | Texels. |
| `0x12 + 16 × i` | 6 | bytes | `reservedTail[i]` | Zero. |

| Format value | N64 format | Payload | Count across surveyed models |
|---:|---|---|---:|
| 1 | CI4 | 32-byte RGBA16 palette, then 4-bit indices. | 3,643 |
| 2 | CI8 | 512-byte RGBA16 palette, then 8-bit indices. | 177 |
| 4 | RGBA16 | Two bytes per texel; optional packed mip levels. | 795 |
| 8 | RGBA32 | Four bytes per texel. | 255 |
| `0x10` | IA8 | One byte per texel. | 57 |

Tile modes observed are wrap/wrap, clamp/clamp and mixed clamp/wrap; no mirror mode appeared. The animated-texture descriptor has four fixed slots, each eight bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | s16 | `frameSize` | Bytes per frame. |
| `0x02` | 2 | s16 | `frameCount` | Number of frames. |
| `0x04` | 4 | f32 | `framesPerSecond` | Playback rate. |

Active slots use segments `0x0F` downward. Five map models use them, including Gobi's Valley (21 CI4 frames at 10 Hz). The viewer can display frame zero, but that is not live animation. In-game UV or vertex animation also changes Mad Monster Mansion mist, water in several worlds and Gobi's Valley sand; decoded file vertices represent the initial state.

### 3.6 Collision

Verified by parsing all 507 present grid lists and comparing indexed faces with render triangles. A collision section refers to the same vertex list as its model. Its cells form a uniform three-dimensional grid; a triangle is repeated in every overlapping cell, so drawing requires deduplication. Of 380,156 indexed collision entries, 358,690 have an exact render-triangle twin, 653 share positions only, and 20,813 lack a render twin (invisible walls and simplified hulls).

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 6 | s16[3] | `minCell` | Inclusive grid minimum. |
| `0x06` | 6 | s16[3] | `maxCell` | Inclusive grid maximum. |
| `0x0C` | 2 | s16 | `yStride` | `nx`. |
| `0x0E` | 2 | s16 | `zStride` | `nx × ny`. |
| `0x10` | 2 | s16 | `cellCount` | `nx × ny × nz`. |
| `0x12` | 2 | s16 | `cellSize` | World units; zero denotes a single cell. |
| `0x14` | 2 | u16 | `triangleCount` | Entries following the cell table. |
| `0x16` | 2 | u16 | `reserved_16` | Zero. |
| `0x18 + 4 × i` | 2 | s16 | `firstTriangle[i]` | Start index within triangle array. |
| `0x1A + 4 × i` | 2 | s16 | `cellTriangleCount[i]` | Number of indices for cell `i`. |

The triangle array begins at `0x18 + 4 × cellCount`, with 12-byte records:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | s16 | `vertex0` | Index into model vertex list. |
| `0x02` | 2 | s16 | `vertex1` | Index. |
| `0x04` | 2 | s16 | `vertex2` | Index. |
| `0x06` | 2 | u16 | `unknown_06` | Meaning not established. |
| `0x08` | 4 | u32 | `flags` | Surface/material bits. |

Cell index is `(x−minX) + (y−minY) × yStride + (z−minZ) × zStride`. Bit `0x01000000` correlates strongly with collision-only geometry. Other flag meanings, including material, sliding, damage and two-sided handling, are partly source-derived or inferred and require behavioral verification. Collision should be exposed as a separate hidden-by-default viewer layer.

### 3.7 Environment, sky, fog, and lighting

Verified by disassembly and 16 RDRAM frame display lists. The game clears the 292×216 framebuffer to black before rendering the sky. Sky table entries hold up to three ordinary model assets, each scaled and rotated around +Y at a stored degrees-per-second rate; the model is centered on the camera and drawn without depth. For example, Mumbo's Mountain uses `0x7BD` (static gradient) and `0x7BE` (cloud cards at 1°/s), Treasure Trove Cove uses `0x7BF` and `0x7C0` (clouds scaled 2 and rotated 0.5°/s), and Freezeezy Peak uses three layers `0x7C6`–`0x7C8`. Maps without a sky record show black beyond geometry.

No level fog is used: neither the stored model lists nor 16 complete captured frame lists set G_FOG or a fog blender. A fog-color command in transition code drives a screen effect, not distance fog. Normal map environment color is white (`FFFFFF`). Local light nodes in five setups can recolor flagged actors by proximity; their effect on map geometry was not found. Non-environment-mapped scene geometry is prelit in its stored vertex colors.

### 3.8 Cameras and paths

Verified against captured RAM camera vectors and offline projections. The normal vertical FOV is 40° and the framebuffer aspect is `292/216`. Camera eye is stored at `0x80280EB0`, look vector at `0x80280EA0`, and pitch/yaw/roll in degrees at `0x80280EC0`; yaw zero looks toward −Z, yaw grows toward −X, and +Y is up. The game computes level near/far each frame from camera and map extents, clamping far to 1,000–20,000. The sky uses its own perspective (`near=5`, `far=15000`).

Setups also contain 1,177 camera nodes (static, zoom, pivot and random types). Category-8/9 setup nodes provide paths and camera triggers; their event semantics are only partially decoded. For a viewer's default camera, the main-exit entrance node gives a reproducible target: place the eye about 700 units behind it and 300 units above it, looking toward the entrance. This is a viewer convention, not a stored camera pose.

## 4. Objects

### 4.1 Placement records

Verified by the setup reader and a complete parse of all 129 setup assets. The file uses a peek/expect grammar: a mismatched tag remains pending for the next branch. Top-level tags are `01` grid, `03` cameras, `04` lights and terminal `00`; tag `02` is permitted as an empty section. The grid bounds are signed-32-bit cube indices, each cube 1,000 model units wide. Cubes are iterated X outermost, then Y, then Z. Each cube body contains node and prop lists; all 129 setups end without trailing undecoded bytes. The grid's bounds derive from model vertex bounds plus the two map-table grid deltas for most maps; some reused-model cutscenes are exceptions. Placement coordinates themselves are world/model coordinates, not cube-relative.

The top-level stream is variable-length and tag-delimited; its elements are:

| Order | Count | Type | Field | Description |
|---:|---:|---|---|---|
| 1 | 1 | u8 | `sectionTag` | `01` grid, `03` cameras, `04` lights, `02` empty, or `00` end. |
| if grid | 3 each | s32 | `minCube`, `maxCube` | Inclusive XYZ cube bounds. |
| per cube | variable | tagged entries | `cubeBody` | `0A count 0B` precedes 20-byte nodes; `08 count 09` precedes 12-byte props. |
| if cameras | variable | tagged entries | `cameraNodes` | Index, type and type-dependent fields; `00` terminates. |
| if lights | variable | tagged entries | `lightNodes` | Position, fade range and color; `00` terminates. |

Node records have fixed size `0x14` and appear in the grid's `0B` list. Verified fields from disassembly, setup parsing and runtime Actor structs:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 6 | s16[3] | `position` | World XYZ. |
| `0x06` | 2 | u16 | `selectorCategory` | Bits 15–7 selector/radius; bits 6–1 category; bit 0 kind. |
| `0x08` | 2 | u16 | `actorId` | Actor, entrance or trigger ID. |
| `0x0A` | 1 | u8 | `markerId` | Secondary marker. |
| `0x0B` | 1 | u8 | `reserved_0B` | Padding. |
| `0x0C` | 4 | u32 | `yawAndScale` | Bits 31–23 yaw 0–359°, low 23 bits scale percentage; zero scale means 100%. |
| `0x10` | 4 | u32 | `linkAndFlags` | Bits 31–20 ID, 19–8 link ID, lower bits flags. |

Kind-zero categories include actors (6), camera controllers (3), enemy boundaries (7), paths (8) and camera triggers (9). The 1,215 kind-one records appear to form linked control-point chains; their exact semantics are a **hypothesis**, so they should not automatically be rendered as actors. Across all setups there are 14,238 nodes, 2,904 props, 1,177 camera nodes and 50 lights.

Prop records have fixed size `0x0C`; bit 1 of flags at `0x0A` chooses model rather than sprite. The `0x04`–`0x09` position is three signed-16-bit coordinates in both variants:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | u32 | `identityAndAppearance` | Model: high 12 bits ID, bytes 2–3 yaw/roll at 2° per unit. Sprite: high 12 bits ID, color reductions, scale and mirror. |
| `0x04` | 6 | s16[3] | `position` | World XYZ. |
| `0x0A` | 2 | u16 | `flagsAndScale` | Model: scale percent and model bit; sprite: high five bits initial frame. |

For model props, asset ID is high-12-bit ID plus `0x2D1`. For sprite props, it is high-12-bit ID plus `0x572`. All 457 model props and 2,447 sprite props resolve to assets of the expected type. Actor placements with map-model scale 5/3 are already in final world coordinates; only the map model is scaled.

### 4.2 Object and model formats

Actors are registered by core2 and the resident level overlay. The first registered ActorInfo with matching `actorId` wins; registered model IDs may point to either model or sprite assets. The 618 ActorInfo records decoded from registration call sites have 0x24-byte stride:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | s16 | `markerId` | Marker class. |
| `0x02` | 2 | s16 | `actorId` | Matches setup node. |
| `0x04` | 2 | s16 | `modelAssetId` | Zero for invisible controllers. |
| `0x06` | 2 | s16 | `startAnimation` | Animation asset or state index. |
| `0x08` | 4 | ptr | `animations` | Resident code/data address. |
| `0x0C` | 4 | ptr | `update` | Behavior callback. |
| `0x10` | 4 | ptr | `update2` | Secondary callback. |
| `0x14` | 4 | ptr | `draw` | Draw callback. |
| `0x18` | 2 | u16 | `unknown_18` | Not established. |
| `0x1A` | 2 | u16 | `drawDistance` | Culling distance parameter. |
| `0x1C` | 4 | f32 | `shadowScale` | Shadow parameter. |
| `0x20` | 2 | u16 | `unknown_20` | Not established. |
| `0x22` | 2 | u16 | `unknown_22` | Not established. |

Across 3,889 actor-category nodes, 1,543 map to model assets, 190 to sprite assets, 365 to registered actors with no model, and 1,791 lack an ActorInfo (including 383 entrance markers and many triggers). This is a resolution count, not an unused-actor count. Runtime RAM checks in Spiral Mountain and Mumbo's Mountain matched ActorInfo pointer, node yaw and node scale for spawned actors.

Sprite assets store one or more image frames and display dimensions. A sprite renders as a camera-facing quad anchored at its placement; collectibles may change frame or turn during play. Static model props use their stored yaw and roll; actors may override scale or despawn according to progress state. Common examples are notes (sprite `0x6D6`), Jiggies (actor `0x46` → model `0x35F`), Jinjos (actors `0x5E`–`0x62`), and note doors (actor `0x203` → model `0x491`).

### 4.3 Skeletons and animation

Model headers can point to bone and animation lists; animation assets occupy IDs `0x001`–`0x2C9` in USA V1.0. For static geometry, bind-pose vertices and the geometry tree render recognizable characters without evaluating the animation data. Character animation, skinning matrices and per-actor update logic are not yet specified sufficiently for a faithful animation player. This limitation is separate from the music sequence format.

### 4.4 Behaviors, triggers, and scripted objects

The setup carries spawn inputs, but event handlers in core2 and overlays control collectibles, transformations, doors, cameras and cutscenes. Thus an object placed in a setup need not be visible in every game state, and an actor absent from all setups can still be spawned by code. Exit numbers resolve to entrance actor IDs through a jump table in core2; the first category-6 node with that ID supplies the initial position and yaw. Example: Spiral Mountain exit `0x12` resolves to the outside-house entrance at `(3955, −490, 6484)`; Mumbo's Mountain exit `05` resolves to `(5950, 507, 5030)`. These positions were verified against player RAM after loading.

## 5. Audio

### 5.1 Audio storage and banks

Verified from ROM bytes, disassembly of the bank loader, and parsing both standard `ALBankFile` structures. Soundfont 1 at `.ctl` ROM `0xD846C0`, `.tbl` ROM `0xD954B0` is for sound effects: one instrument, 402 sounds and 308 VADPCM waves. Soundfont 2 at `.ctl` ROM `0xEA3EB0`, `.tbl` ROM `0xEADE60` is for music: 86 instruments, 244 sounds, 159 VADPCM waves (53 looped), no percussion. The game runs `osAiSetFrequency(22000)`; a captured AI DAC rate corresponds to 21,998 Hz output.

### 5.2 Sequence format and driver

The player is Rare's modified libultra `n_alCSPlayer` using `n_audio` ABI. Disassembly identifies 24 virtual and 24 physical voices, a six-section custom reverb chain, and six music slots; slot 0 carries the map track and slot 5 pause music. The RSP audio task uses `n_aspMainTextStart` and `n_aspMainDataStart` (source-derived symbol labels); the exact microcode build revision is unverified.

Sequences are archive assets `0x1516 + songId` for IDs `0x00`–`0xAC` (173 files). All parse as libultra compressed MIDI, with 384 ticks per quarter note. Each sequence starts with a `0x44`-byte header; track offsets are sequence-relative:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x40` | u32[16] | `trackOffset` | Zero for absent tracks. |
| `0x40` | 4 | u32 | `division` | 384 ticks per quarter note. |

Tracks contain variable-length delta times and MIDI-compatible events. The compressed-track escape grammar, after reading a delta time, is:

| Opcode | Length | Operands | Effect |
|---|---:|---|---|
| `FE FE` | 2 | none | Literal `FE` event byte. |
| `FE hi lo len` | 4 | 16-bit lookback and 8-bit copy length | Copy prior encoded track bytes. |
| `FF 2E` | variable | MIDI meta length/body | Loop start. |
| `FF 2D` | variable | Count, current count, raw u32 back offset | Loop end; back-offset operand is not passed through the back-reference expander. |
| `FF 2F` | variable | MIDI end-of-track meta body | End track. |

All 848 observed loop ends are perpetual; 95 songs loop and 78 play once. The loop-end operand must be read raw, not expanded as compressed data.

The runtime channel-mask system adds controller events `0x7D` (channel volume), `0x7E` (mask out channel) and `0x7F` (mask in channel); these are posted by game code, not stored in sequence assets. Unmasked playback can exceed 24 voices and lose notes. Masks change with map, player position, water and game state. Verified mask examples are Spiral Mountain `0x6FFF`, Mumbo's Mountain start `0x103F` and near Ticker's Tower `0x513F`, Treasure Trove Cove jetty `0x60FF`, and file select `0x0200` on save slot 0 versus `0x01FF` on slots 1–2. The file-select mask follows highlighted slot index, not whether a file has been saved. Two-track maps start both tracks concurrently; Treasure Trove Cove crossfades `0x05` Beach and `0x11` Lighthouse by height, while Spiral Mountain switches `0x10` and `0x56` at the bridge.

### 5.3 Instruments and sample encoding

Both `.tbl` files contain libultra VADPCM waves referenced by their `.ctl` soundfont; 53 music waves carry loop state. Sequence programs 1–85 select music instruments. Stored sample encoding is VADPCM, not DEFLATE. The voice envelope player uses a linear volume path; the custom six-section reverb is audible in captured game audio and is not required to parse or play the sequences. Controller 7 changes volume, 10 pans and 91 sets effect send.

### 5.4 Music catalog and loop points

Verified from the 173 sequence assets and a 175-entry ROM song-name/volume table at decoded core1 data `+0x730` (`0x80275D40`). Name-only slots `0xAD` and `0xAE` have no sequence assets. Each eight-byte name/volume entry is:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | ptr | `name` | RAM address of the song name. |
| `0x04` | 2 | u16 | `defaultVolume` | Sequence-player volume. |
| `0x06` | 2 | u16 | `reserved_06` | Padding. |

The complete per-ID name, duration and loop catalog follows.

| ID | Asset | ROM name | Default volume | Loop start–end (s), or duration once |
|---|---|---|---:|---|
| `00` | `1516` | Blank | 15000 | once, 0.970 |
| `01` | `1517` | Scrap | 15000 | 2.666–181.322 |
| `02` | `1518` | Jungle 2 | 20000 | 2.525–126.259 |
| `03` | `1519` | Snow 2 | 20000 | 1.654–119.108 |
| `04` | `151A` | Bells | 21000 | once, 4.127 |
| `05` | `151B` | Beach | 20000 | 1.920–119.040 |
| `06` | `151C` | Swamp | 15000 | 7.109–127.955 |
| `07` | `151D` | Crab Cave | 20000 | 0.000–60.604 |
| `08` | `151E` | Title | 15000 | once, 62.562 |
| `09` | `151F` | Notes | 15000 | once, 1.002 |
| `0A` | `1520` | Jinjo | 15000 | once, 3.294 |
| `0B` | `1521` | Feather | 15000 | once, 0.771 |
| `0C` | `1522` | Egg | 15000 | once, 0.459 |
| `0D` | `1523` | Jigpiece | 28000 | once, 3.803 |
| `0E` | `1524` | Sky | 32767 | once, 22.139 |
| `0F` | `1525` | Spooky | 21000 | 14.758–129.132 |
| `10` | `1526` | Training | 15000 | 2.181–126.505 |
| `11` | `1527` | Lighthouse | 24000 | 0.000–87.994 |
| `12` | `1528` | Crab | 15000 | 3.097–55.738 |
| `13` | `1529` | Shell | 32767 | 3.000–128.992 |
| `14` | `152A` | Feather Inv | 15000 | once, 0.753 |
| `15` | `152B` | Extra life | 15000 | once, 2.404 |
| `16` | `152C` | Honeycomb | 15000 | once, 0.612 |
| `17` | `152D` | Empty honey piece | 15000 | once, 1.401 |
| `18` | `152E` | Extra honey | 15000 | once, 3.692 |
| `19` | `152F` | Mystery | 15000 | once, 0.901 |
| `1A` | `1530` | You lose | 20000 | once, 3.686 |
| `1B` | `1531` | Termite nest | 32767 | 0.000–92.237 |
| `1C` | `1532` | Outside whale | 15000 | 4.798–119.962 |
| `1D` | `1533` | Spell | 15000 | once, 7.010 |
| `1E` | `1534` | Witch House | 23000 | 7.419–121.175 |
| `1F` | `1535` | In whale | 18000 | 6.543–128.686 |
| `20` | `1536` | Desert | 20000 | 7.379–129.132 |
| `21` | `1537` | In spooky | 18000 | 4.362–128.670 |
| `22` | `1538` | Grave | 24000 | 2.399–117.562 |
| `23` | `1539` | Church | 28000 | 31.998–181.322 |
| `24` | `153A` | Sphinx | 20000 | 6.258–135.583 |
| `25` | `153B` | Invulnerabilty | 28000 | 1.548–26.321 |
| `26` | `153C` | Collapse | 15000 | once, 60.034 |
| `27` | `153D` | Snake | 15000 | once, 43.386 |
| `28` | `153E` | Sandcastle | 15000 | 2.525–106.058 |
| `29` | `153F` | Summer | 20000 | 2.000–137.991 |
| `2A` | `1540` | Winter | 27000 | 4.000–135.991 |
| `2B` | `1541` | Right | 28000 | once, 0.970 |
| `2C` | `1542` | Wrong | 32000 | once, 0.605 |
| `2D` | `1543` | Achieve | 32000 | once, 2.805 |
| `2E` | `1544` | Autumn | 22000 | 122.643–242.574 |
| `2F` | `1545` | Default forest | 30000 | 5.050–85.856 |
| `30` | `1546` | 5 Jinjos | 15000 | once, 5.186 |
| `31` | `1547` | Game over | 15000 | once, 11.410 |
| `32` | `1548` | Nintendo | 15000 | once, 11.584 |
| `33` | `1549` | Ship | 24000 | 2.000–113.993 |
| `34` | `154A` | Shark | 15000 | 0.005–2.000 |
| `35` | `154B` | Ship inside | 24000 | 0.000–126.720 |
| `36` | `154C` | 100 Notes | 15000 | once, 2.063 |
| `37` | `154D` | Door Open | 15000 | once, 2.698 |
| `38` | `154E` | Organ sequence | 18000 | once, 2.184 |
| `39` | `154F` | Advent | 15000 | 7.379–51.653 |
| `3A` | `1550` | Slalom | 15000 | 4.000–62.663 |
| `3B` | `1551` | Race win | 15000 | once, 2.921 |
| `3C` | `1552` | Race lose | 15000 | once, 3.002 |
| `3D` | `1553` | Jigsaw magic | 15000 | once, 4.127 |
| `3E` | `1554` | Oh dear | 15000 | once, 1.017 |
| `3F` | `1555` | Up | 15000 | once, 4.120 |
| `40` | `1556` | Down | 15000 | once, 4.120 |
| `41` | `1557` | Shamen Hut | 19000 | 0.000–54.663 |
| `42` | `1558` | Jig 10 | 25000 | once, 4.060 |
| `43` | `1559` | Carpet | 15000 | 0.005–4.000 |
| `44` | `155A` | Squirrel | 15000 | 0.000–81.168 |
| `45` | `155B` | Hornet | 15000 | 5.050–90.907 |
| `46` | `155C` | Treetop | 32000 | 0.000–66.748 |
| `47` | `155D` | Turtle Shell | 25000 | 0.000–74.662 |
| `48` | `155E` | House Summer | 15000 | 0.000–74.375 |
| `49` | `155F` | House Autumn | 15000 | 0.000–77.328 |
| `4A` | `1560` | Out Buildings | 15000 | 0.000–85.856 |
| `4B` | `1561` | Hornet 2 | 15000 | 2.525–65.655 |
| `4C` | `1562` | Cabins | 15000 | 0.000–67.996 |
| `4D` | `1563` | Rain | 15000 | 0.000–34.284 |
| `4E` | `1564` | Jigsaw Open | 15000 | once, 1.924 |
| `4F` | `1565` | Jigsaw Close | 15000 | once, 1.924 |
| `50` | `1566` | Witch 1 | 23000 | 7.419–126.121 |
| `51` | `1567` | Witch 2 | 23000 | 7.419–121.175 |
| `52` | `1568` | Witch 3 | 23000 | 4.946–123.648 |
| `53` | `1569` | Witch 4 | 23000 | 7.419–121.175 |
| `54` | `156A` | Witch 5 | 23000 | 7.419–121.175 |
| `55` | `156B` | Mr Vile | 15000 | once, 60.750 |
| `56` | `156C` | Bridge | 22000 | 0.000–69.796 |
| `57` | `156D` | Turbo Talon Trot | 28000 | 1.263–21.464 |
| `58` | `156E` | Long legs | 28000 | 1.499–28.926 |
| `59` | `156F` | Witch 6 | 23000 | 7.419–121.175 |
| `5A` | `1570` | Boggy sad | 15000 | 0.000–45.330 |
| `5B` | `1571` | Boggy happy | 15000 | 0.000–29.141 |
| `5C` | `1572` | Quit | 15000 | once, 3.836 |
| `5D` | `1573` | Witch 7 | 23000 | 7.419–121.175 |
| `5E` | `1574` | Witch 8 | 23000 | 7.419–121.175 |
| `5F` | `1575` | Spring | 18000 | 11.428–150.847 |
| `60` | `1576` | Squirrel attic | 26000 | 3.000–98.994 |
| `61` | `1577` | Lights | 15000 | once, 3.712 |
| `62` | `1578` | Box | 17000 | 3.889–55.745 |
| `63` | `1579` | Witch 9 | 23000 | 7.419–121.175 |
| `64` | `157A` | Open up | 15000 | once, 3.280 |
| `65` | `157B` | Puzzle complete | 25000 | once, 4.432 |
| `66` | `157C` | Xmas tree | 15000 | 0.000–38.855 |
| `67` | `157D` | Puzzle in | 15000 | once, 0.421 |
| `68` | `157E` | Lite tune | 15000 | 1.714–97.708 |
| `69` | `157F` | Open extra | 15000 | once, 3.130 |
| `6A` | `1580` | Ouija | 29000 | 2.181–106.875 |
| `6B` | `1581` | Wozza | 15000 | 0.000–43.186 |
| `6C` | `1582` | Intro | 20000 | once, 207.748 |
| `6D` | `1583` | Gnawty | 15000 | 4.172–66.748 |
| `6E` | `1584` | Banjo's Pad | 15000 | 2.034–79.313 |
| `6F` | `1585` | Pause | 15000 | 0.000–57.582 |
| `70` | `1586` | Cesspit | 25000 | 3.199–111.982 |
| `71` | `1587` | Quiz | 15000 | 27.671–145.734 |
| `72` | `1588` | Frog | 20000 | 2.666–59.996 |
| `73` | `1589` | GameBoy | 15000 | 0.000–29.516 |
| `74` | `158A` | Lair | 15000 | 2.666–135.991 |
| `75` | `158B` | Red Extra | 32000 | once, 1.268 |
| `76` | `158C` | Gold Extra | 32000 | once, 1.202 |
| `77` | `158D` | Egg Extra | 32000 | once, 1.155 |
| `78` | `158E` | Note door | 15000 | once, 3.519 |
| `79` | `158F` | Cheaty | 15000 | 7.999–39.997 |
| `7A` | `1590` | Fairy | 20000 | 0.000–50.061 |
| `7B` | `1591` | Skull | 25000 | once, 1.359 |
| `7C` | `1592` | Square Grunty | 25000 | once, 0.826 |
| `7D` | `1593` | Square Banjo | 25000 | once, 0.974 |
| `7E` | `1594` | Square Joker | 30000 | once, 2.164 |
| `7F` | `1595` | Square Music | 25000 | once, 0.694 |
| `80` | `1596` | Lab | 20000 | 0.000–117.326 |
| `81` | `1597` | Fade Up | 25000 | once, 1.383 |
| `82` | `1598` | Puzzle Out | 15000 | once, 0.421 |
| `83` | `1599` | Secret Gobi | 20000 | 15.151–65.655 |
| `84` | `159A` | Secret Beach | 20000 | 13.087–56.709 |
| `85` | `159B` | Secret Ice | 20000 | 14.395–62.380 |
| `86` | `159C` | Secret Spooky | 20000 | 33.589–88.772 |
| `87` | `159D` | Secret Squirrel | 20000 | 56.256–99.879 |
| `88` | `159E` | Secret Egg | 20000 | once, 3.261 |
| `89` | `159F` | Jinjup | 32000 | once, 4.957 |
| `8A` | `15A0` | Turbo Talon Trot short | 28000 | 1.263–2.525 |
| `8B` | `15A1` | Fade Down | 25000 | once, 1.586 |
| `8C` | `15A2` | Big Jinjo | 32000 | once, 17.714 |
| `8D` | `15A3` | T1000 | 15000 | once, 9.600 |
| `8E` | `15A4` | Credits | 15000 | 2.000–157.990 |
| `8F` | `15A5` | T1000x | 20000 | 28.295–104.489 |
| `90` | `15A6` | Big Door | 20000 | once, 4.008 |
| `91` | `15A7` | Descent | 20000 | 1.412–12.704 |
| `92` | `15A8` | Wind up | 20000 | once, 0.721 |
| `93` | `15A9` | Air | 20000 | once, 0.127 |
| `94` | `15AA` | Do jig | 20000 | 1.845–81.168 |
| `95` | `15AB` | Picture | 28000 | once, 4.905 |
| `96` | `15AC` | Piece up | 20000 | once, 0.303 |
| `97` | `15AD` | Piece down | 20000 | once, 0.303 |
| `98` | `15AE` | Spin | 20000 | 0.000–1.845 |
| `99` | `15AF` | BarBQ | 15000 | 1.777–65.755 |
| `9A` | `15B0` | Chord1 | 20000 | once, 1.310 |
| `9B` | `15B1` | Chord2 | 20000 | once, 1.310 |
| `9C` | `15B2` | Chord3 | 20000 | once, 1.310 |
| `9D` | `15B3` | Chord4 | 20000 | once, 1.310 |
| `9E` | `15B4` | Chord5 | 20000 | once, 1.310 |
| `9F` | `15B5` | Chord6 | 20000 | once, 1.310 |
| `A0` | `15B6` | Chord7 | 20000 | once, 1.310 |
| `A1` | `15B7` | Chord8 | 20000 | once, 1.310 |
| `A2` | `15B8` | Chord9 | 20000 | once, 1.310 |
| `A3` | `15B9` | Chord10 | 20000 | once, 2.383 |
| `A4` | `15BA` | Shock1 | 20000 | 1.714–3.428 |
| `A5` | `15BB` | Shock2 | 20000 | 1.714–3.428 |
| `A6` | `15BC` | Shock3 | 20000 | 1.714–3.428 |
| `A7` | `15BD` | Shock4 | 20000 | 1.714–3.428 |
| `A8` | `15BE` | Sad grunt | 20000 | 39.600–202.800 |
| `A9` | `15BF` | Podium | 20000 | 3.554–63.977 |
| `AA` | `15C0` | Endbit | 20000 | 2.000–89.994 |
| `AB` | `15C1` | Rock | 20000 | 2.001–11.144 |
| `AC` | `15C2` | Last Bit | 20000 | once, 9.536 |
| `AD` | — | Unnamed piece | 15000 | – |
| `AE` | — | Unnamed piece | 15000 | – |
The default channel mask is essential to reproduce arrangement and level. An offline render of Spiral Mountain `0x10` at mask `0x6FFF` matches captured audio within about 0.6–1.3 dB across four windows, with envelope correlation 0.76–0.82 and chroma cosine up to 0.969; unmasked render is 6–8 dB too loud. The `0x08` intro eight-second excerpt has 0.886 envelope correlation and 0.948 chroma cosine at nearly 1× speed. Mumbo's Mountain `0x02` at mask `0x103F` has 0.791 envelope correlation and 0.931 chroma cosine. These comparisons include game sound effects and reverb in the capture, so they are not sample-exact.

## 6. Unused and hidden content

### 6.1 Unreferenced assets

Verified by USA V1.0 setup, ActorInfo and model-prop cross-reference, but **not** by a complete code reachability proof: 145 of 618 registered ActorInfos are not directly placed by any setup; 142 of 597 object-model assets appear in neither ActorInfo nor model props. Many are dynamic effects, body parts or cutscene components. They are *static placement gaps*, not proven unused assets. Asset slots `0x9A3`–`0xA0A` contain 28 nonempty controller-demo recordings and 76 empty entries; empty slots are not automatically discarded demos. Each nonempty file begins with a u32 payload length equal to file size minus four, then six-byte input records.

Fourteen existing song sequences have no direct static map-table or call-site reference: `00`, `37`, `39`, `40`, `48`, `49`, `4D`, `5C`, `99`, `A4`–`A7`, `AB`. These are unresolved references, **not** verified unused songs: intro track `0x08` demonstrates that a spline event can start a song without a direct constant call. The two name-only slots `0xAD`–`0xAE` have no sequence assets.

### 6.2 Cut or inaccessible levels

Verified from the USA V1.0 map, section, setup, sky and music tables: 25 map IDs have no map model or section row: `03`, `04`, `08`, `09`, `0F`, `17`–`19`, `32`, `33`, `42`, `49`, `4E`–`52`, `54`–`59`, `5D`, `73`. These are **stub IDs**, not 25 complete lost levels. Map `03` retains a sky table row, and channel-mask code contains cases for `03` and `54`–`59`, evidence of surviving support. Map `73` is the one stub with a setup (`0x78F`): 16 nodes, including entrances and actors, plus four camera nodes. It lacks an environment model or section record. The label “original Freezeezy Peak lobby” is source-derived; the ROM has no corresponding name string.

Map `84`, although called `CS_UNUSED_MACHINE_ROOM` in a source enum, is **not unused**. Verified by the USA V1.0 credits-parade table and its installer at `0x8031ADB4`: the 58-entry post-battle parade includes map `84`, exit zero, for Klungo. It has setup `0x7A0` and the laboratory model `0x150F`. It should be listed with credits/cutscene maps.

### 6.3 Debug features

The lair overlay contains the development-flavored sentence `THIS IS A SLIGHTLY LONGER PIECE OF TEXT FOR THE QUIZ DIALOGS!`; code at `0x8038D0F4` references it for a text-display call. Its in-game reachability was not established. A scan of printable strings in core1, core2 and overlays found assert source filenames and audio trace strings, but no debug-menu labels or build timestamp; this cannot exclude non-text debug behavior. Sandcastle codes are obfuscated in the Treasure Trove Cove overlay; the stored string `knip68n3664j` decodes to `BANJOKAZOOIE` using its letter-substitution table. These cheats are intentionally hidden game features, not unused content.

### 6.4 Prototype or revision-specific content

The stub IDs and retained mask cases are compatible with prior development of additional areas, but the retail ROM alone does not establish their original geometry, completeness or intended release. USA V1.1 alters 13 map models and 14 dialog assets relative to V1.0; Europe retains those model changes and stores three dialog languages. Stop 'n' Swop's Ice Key and egg ActorInfo/model assets, three secret-item music overrides and the associated game-state logic survive in the retail image. Their complete placement and activation behavior is outside this specification.

## 7. nviewer implementation

### 7.1 Module mapping

The game contract should detect USA V1.0 by `NBKE`, revision zero and asset count `0x15C7`. `src/rom/inflate.ts` already decodes the raw DEFLATE body at stream offset six. A Banjo ROM module reads the asset table and core2 map/music/sky tables; model and display-list modules emit batches; a setup module resolves actors and props; sky and music modules build the viewer's environment and player. `src/rom/music/libultra.ts` and `cseq.ts` can parse the soundfont and sequences. Other revisions require their own high-ID and table-location maps, not just a header alias.

### 7.2 Supported features

The implementation target is 128 model-table maps selectable by group; 25 model-less stubs are excluded from the normal level list, while setup-only `0x73` may be offered as archival content. Every visible map model, object, prop and sky instance must have a viewer layer; collision belongs in a hidden-by-default collision layer. Build opaque and translucent models separately, applying the table's model scale only to geometry. Resolve actor model IDs from the core2 plus overlay registration lists; place sprite props as billboards. Use the game's black clear color, no level fog, a camera-centered ordered sky and a default entrance-based camera. The 173 sequence assets are exposed as music tracks, with the default per-map channel mask where relevant.

### 7.3 Approximations and omissions

Characters in bind pose, frame-zero animated textures, static water/mist UVs and vertices, and a nonrotating sky are recognizable but not frame-accurate. Runtime model-selector state and lighting-node tints can change geometry or actors. The player model, dynamic effects, scripted cutscenes, sample reverb, area-dependent music masks, and game-state-dependent spawns are not fully specified for static display. The exact rendering of mipmapped levels and the single observed incompatible stale-tile draw in map `0x6F` remain to be checked. These are limitations, not grounds for manually adjusting source geometry.

## 8. Verification and remaining work

### 8.1 Verification evidence

| Claim | Verification |
|---|---|
| ROM and revision map | Header values, SHA-1, ROM offset tables and decoded code images compared across available releases. |
| Compression | All 9,399 compressed assets in available USA V1.0/V1.1/Europe images inflate to their header sizes; 475 game RAM decompression outputs match decoded ROM assets. |
| Model and texture layout | All 823 model headers and command trees parse; vertex/triangle counts agree with reachable display lists; CI/RGBA/IA texture sheets decode coherently. |
| Render state, sky and fog | Full RDP command walks on 16 captured RAM frame lists; sky rotation checked against matrices and elapsed timer. |
| Collision | All 507 present grids parse; indexed triangles compared with visible geometry. |
| Setups and actors | All 129 setup assets parse without trailing bytes; 2,904 props resolve to valid assets; ActorInfo/yaw/scale compared with live RAM actors. |
| Camera and projection | Captured RAM eye/target/FOV projected through an offline renderer; geometry placement aligns with screenshots. |
| Music | All 173 sequence assets parse and render; default-mask excerpts compared with game audio for timing, pitch and level. |

The most useful exact-camera visual comparisons are Treasure Trove Cove map `0x07` at its jetty (opaque cutout planks over translucent water), Mad Monster Mansion `0x1B` (moving mist), and Spiral Mountain `0x01` (sky, actors and props). Each comparison uses the emulated game's RAM camera, not a hand-adjusted pose.

### 8.2 Known unknowns

- Runtime bone matrices, vertex/UV animation drivers and the gameplay rules behind some model selectors are not fully decoded.
- Collision flag behavior beyond observed bit distributions and its strong correlation with render twins needs controlled runtime tests.
- The exact source or executable revision of the embedded `n_aspMain` audio microcode is not established.
- Static reference scans cannot prove the 145 unplaced ActorInfos, 142 non-prop models or 14 unresolved songs unused.
- Japan ROM identification and late-asset mapping should be reverified against an available image before viewer support is claimed.

### 8.3 References

- [Raw DEFLATE and Rare wrappers](compression/raw-deflate.md) — bitstream and reference encoder/decoder.
