# Off Road Challenge — Nintendo 64 ROM format specification

This manual describes the shipped data formats needed to identify, extract, and
present Off Road Challenge content. Claims state their evidence inline; unsupported
interpretations are labelled hypotheses.

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | 41 raw files in a 16-byte table at US ROM `0x6E310`; collectively and gaplessly cover `0x88BC0–0xC75030`; no file compression [evidence: ROM bytes, disassembly, deterministic decoding] |
| Compression | None in the 41-file archive; all entries are stored raw. |
| Graphics microcode | custom float-vertex/model and 24-byte polygon format converted at runtime to F3DEX.NoN 1.21; packed-CI4 atlases stored as 128-byte/256-texel rows, with 16-entry RGBA16 TLUT windows [evidence: ROM bytes, disassembly, deterministic decoding] |
| Geometry | Custom float-vertex models with 24-byte polygon records, converted at run time to F3DEX.NoN 1.21 display lists. |
| Textures | Packed-CI4 atlases with 16-entry RGBA16 TLUT windows. |
| Collision | Two placement categories reuse visible model geometry for collision; exact physics semantics remain partly unresolved. |
| Music driver | Williams WESS: `SN64` v2 bank, `SSEQ` v2 with 12 music + 153 SFX sequences, 196 VADPCM waves at 22,050 Hz; six named radio songs and six other music sequences [evidence: ROM bytes, disassembly, deterministic decoding] |
| Audio microcode | Standard `aspMain` ABI; exact SDK revision is not identified. |
| Sample encoding | Williams WESS: `SN64` v2 bank, `SSEQ` v2 with 12 music + 153 SFX sequences, 196 VADPCM waves at 22,050 Hz; six named radio songs and six other music sequences [evidence: ROM bytes, disassembly, deterministic decoding] |
| Levels | nine complete tracks: six ordinarily visible plus Flagstaff, El Cajon and Guadalupe as retail unlockables; each has one main file, while the three hidden tracks share an auxiliary file with their corresponding visible track [evidence: ROM bytes, disassembly, captured frames] |
| Memory requirement | **Unknown** |
| Viewer support | USA and European releases; all nine tracks, environments, object layers, collision diagnostics, and 12 music sequences. |
| Environment | user-selectable Random/Blue/Stormy/Dusk skies; fixed render-state templates disable hardware fog and lighting; nominal projection is 53.13° horizontal / 42.67° vertical [evidence: ROM bytes, disassembly, captured frames] |
| Versions | European `NOFP` uses the same parser: 40/41 raw files are structurally identical after self-pointer rebasing; the audio archive is byte-identical [evidence: ROM bytes, deterministic decoding] |
| Unused | all 41 top-level files have active references; the three extra tracks are intentional retail unlockables, not unused [evidence: ROM bytes, disassembly] |

### 1.2 ROM identification

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| USA | `OFFROAD` | `NOFE` | 0 | 16 MiB (`0x1000000`) | `319093EC` | `0FC209EF` | `9e754ca37d69424e9f82a421d5e69d4ad73046c1` | CIC-6102 | — |
| Europe | `OFFROAD` | `NOFP` | 0 | 16 MiB (`0x1000000`) | `812289D0` | `C2E53296` | `3476e0eb4048c76107bd2b404d19a136bfc15ad9` | CIC-6102 | — |

Verified from the normalized ROM headers and complete-image SHA-1 hashes.

### 1.3 Terminology and conventions

ROM and memory ranges are half-open. Offsets, addresses, encoded sizes, masks,
and opcodes are hexadecimal unless stated otherwise. Multi-byte CPU fields are
big-endian. RAM addresses are virtual unless explicitly identified as physical;
segmented, VROM, and file-relative addresses are named at each use.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

#### Boot and main program

The main image is uncompressed and contiguous. For ROM `0x1000–0x88BC0`, `RAM = ROM + 0x7FFFF400`, producing RAM `0x80000400–0x80087FC0`. [evidence: ROM bytes, disassembly]

Entry code at `0x80000400`:

1. clears `0xD6740` BSS bytes from `0x80087FC0` through `0x8015E700`;
2. sets `sp = 0x8012C470`;
3. jumps to startup at `0x8004EF70`.

The BSS begins exactly where the direct ROM mapping ends, independently confirming the program/file boundary. [evidence: disassembly]

The graphics microcode identifies itself as `RSP Gfx ucode F3DEX.NoN     1.21 Yoshitaka Yasumoto Nintendo.` [evidence: ROM bytes]

### 2.2 Memory and address mapping

Address conversions and load destinations are specified with the executable and file tables above.

### 2.3 ROM map and asset organization

#### Filesystem and loading: Physical ROM map

| ROM range | role | bytes |
|---|---|---:|
| `0x000000–0x001000` | header and IPL3 | `0x1000` |
| `0x001000–0x088BC0` | raw main image | `0x87BC0` |
| `0x088BC0–0xC75030` | 41 raw table files | `0xBEC470` |
| `0xC75030–0xC871B8` | SN64 module/SSEQ through final event payload | `0x12188` |
| `0xC871B8–0xC871C0` | WDD alignment padding | `0x8` |
| `0xC871C0–0xF05654` | indexed N64 VADPCM wave data | `0x27E494` |
| `0xF05654–0xF05660` | unindexed 32-byte-alignment tail; nonzero bytes unexplained [evidence: ROM bytes, hypothesis] | `0xC` |
| `0xF05660–0x1000000` | `FF` fill | `0xFA9A0` |

The main/file boundary is verified by both direct mapping and table continuity. The audio subdivisions come from the parsed SN64/SSEQ/WDD tables and are corroborated by the runtime-configured WDD address; the last wave's indexed extent establishes its endpoint. [evidence: ROM bytes, disassembly, deterministic decoding]

### 2.4 Compression formats

Compression framing and decoding rules are specified with each stored resource above.

### 2.5 Loading process

#### Filesystem and loading: Asset table

Startup passes RAM `0x8006D710` (US ROM `0x6E310`) and count 41 to the table setter at `0x8004DFD0`. Records are big-endian: [evidence: ROM bytes, disassembly]

```c
struct AssetFile {
    uint32_t romStart;
    uint32_t romEnd;       // exclusive
    uint32_t defaultDest;  // KSEG0
    uint32_t flags;
};
```

All 41 flags are zero. Sorted by `romStart`, their ranges partition `0x88BC0–0xC75030` exactly, without overlaps or gaps. Table order is logical ID order rather than physical order; alternatives reuse common destination arenas. The authoritative inventory is `fs/file_table.tsv`. [evidence: ROM bytes, deterministic decoding]

#### Filesystem and loading: Raw loader

`loadAssetFile` at `0x8004DFE8` indexes `id * 16`, chooses a nonzero caller destination or the record's `defaultDest`, calculates `romEnd-romStart`, and calls `0x8004EBF0` when `flags & 1` is clear. Every retail record follows that raw path. [evidence: disassembly]

`0x8004EBF0` divides transfers into chunks no larger than `0x6000`. `0x8004EE74` constructs an `OSIoMesg` and calls the `osPiStartDma` family at `0x800613C0`. Asset mode 6 waits for completion, so track loads are synchronous. [evidence: disassembly]

There is no filesystem compression. The zero flags and raw DMA control flow are decisive; absence of `MIO0`, `Yay0`, `Yaz0`, RNC and ZIP signatures is only supporting evidence. N64 VADPCM inside the separate audio archive is sample coding, not filesystem compression. [evidence: ROM bytes, disassembly]

The loader's unsigned bound check is `count < id` instead of `id >= count`, so ID 41 would pass for count 41. No caller supplies it; this is a latent static bug, not a demonstrated retail failure. [evidence: disassembly]

### 2.6 Revision differences

#### European version

The available European retail ROM is 16 MiB, title `OFFROAD`, game code `NOFP`, revision 0, CRC1/CRC2 `812289D0/C2E53296`, SHA-1 `3476e0eb4048c76107bd2b404d19a136bfc15ad9`, and SHA-256 `fa8bcf7ca006714b7cd7fa7d91f10e3abadce17ac187c5e8d64699fd7ac9cbe3`. Its IPL3 is byte-identical to US. [evidence: ROM bytes, deterministic decoding]

| content | US | Europe | result |
|---|---|---|---|
| main | `0x1000–0x88BC0` | `0x1000–0x88C40` | EU is `0x80` larger and has real code changes |
| 41 raw files | `0x88BC0–0xC75030` | `0x88C40–0xC750A0` | EU total is `0x10` shorter |
| SN64/tail | `0xC75030–0xF05660` | `0xC750A0–0xF056D0` | exactly identical, shifted `+0x70` |
| fill | from `0xF05660` | from `0xF056D0` | `FF` |

The EU file table is at `0x6E390`; root table `0x6EDA4`; optional track IDs `0x83408`; main track IDs `0x8342C`; audio base `0xC750A0`. Its main program and all default load addresses moved by `+0x80`. [evidence: ROM bytes, disassembly]

Forty of 41 files have the exact same length, totalling `0xBD6BD0`. Across 3,103,476 aligned words, 3,031,771 are identical and 71,705 differ only as `EU=US+0x80`; there are no other changes. Every changed value is a self-pointer into that file's own load interval. Thus every track and all its local content are byte-identical after pointer rebasing. [evidence: deterministic decoding]

Only file ID 5, the menu/controller-pak/unlock/UI overlay, is substantively rebuilt: US `0x38A370–0x39FC10`, EU `0x38A3F0–0x39FC80`, 16 bytes shorter. It is outside the level parser. [evidence: ROM bytes, disassembly, deterministic decoding]

The PAL build uses 50 rather than 60 as its audio frame/task cadence and buffer-sizing input, but requests 22,050 Hz in both cases. This is not sequence tempo: the WESS callback returns 8,333 microseconds (120 Hz), `GetIntsPerSec` returns 120, and all music tracks use PPQ/QPM 120/120, yielding 240 authored ticks per second in both regions. The archive is byte-identical, so musical assets, pitch, sample rate and sequence timing share one decoder; only low-level callback/buffer scheduling is regional. [evidence: ROM bytes, disassembly]

[viewer design] Support both with one parser and a small version descriptor. Resolve pointers as `pointer-defaultDest` offsets rather than hard-coding US RAM values. European level support is low additional difficulty.

## 3. Level data

### 3.1 Level catalog and identifiers

The level catalog is not independently indexed in the available data.

### 3.2 Level container

#### Tracks and track loading

The track loader at `0x80048430` indexes three parallel tables: optional file IDs at ROM `0x83388`, main IDs at `0x833AC`, and RAM root pointers at ROM `0x6ED24`. It loads the optional file unless its ID is `-1`, then the main file, and walks the selected root. [evidence: ROM bytes, disassembly]

| ID | track | status | aux | main | main ROM range | root |
|---:|---|---|---:|---:|---|---|
| 0 | Mojave | ordinary, Beginner | 0 | 7 | `0x5CED90–0x6C7710` | `0x802EA2F4` |
| 1 | El Paso | ordinary, Intermediate | 35 | 39 | `0x798DE0–0x893010` | `0x802EE928` |
| 2 | Vegas | ordinary, Advanced | 16 | 21 | `0xA7ECF0–0xBBB8D0` | `0x80333A7C` |
| 3 | Pikes Peak | ordinary, Intermediate | – | 26 | `0x9359E0–0xA74BC0` | `0x80322414` |
| 4 | Ol' South | ordinary, Advanced | – | 28 | `0x4A5860–0x5CA1B0` | `0x80306BFC` |
| 5 | Baja | ordinary, Beginner | – | 37 | `0x39FC10–0x4A5860` | `0x802E7FC4` |
| 6 | Flagstaff | retail hidden/unlockable | 0 | 18 | `0x6C7710–0x7914D0` | `0x802BB744` |
| 7 | El Cajon | retail hidden/unlockable | 35 | 31 | `0x893010–0x9359E0` | `0x802970B0` |
| 8 | Guadalupe | retail hidden/unlockable | 16 | 34 | `0xBBB8D0–0xC75030` | `0x802B0624` |

The six ordinary names, thumbnail layouts and difficulty labels are verified from retail selector frames. All nine names, the tables and the three hidden-track paths are verified statically. Flagstaff reuses Mojave's auxiliary file, El Cajon reuses El Paso's, and Guadalupe reuses Vegas's. [evidence: ROM bytes, disassembly, captured frames]

The retail instructions unlock/directly access each extra track by a controller gesture and then holding Z while selecting the corresponding ordinary track. Therefore the extra tracks are intentional shipped features, not unused data. [evidence: ROM bytes, disassembly]

#### Level format

Track files do not contain ready-made RSP display lists. They contain absolute RAM pointers to custom mesh, sector, placement, palette and texture structures; the runtime converts them to temporary `Vtx` arrays and F3DEX 1.21 commands. [evidence: ROM bytes, disassembly] Resolve every pointer relative to its file table record's default destination.

#### Level format: Track root and sectors

The per-track root has these established fields: [evidence: ROM bytes, disassembly, deterministic decoding]

| offset | meaning |
|---:|---|
| `+0x04` | resource bundle |
| `+0x08` | palette-selector lookup |
| `+0x0C` | sector table |
| `+0x10` | track-resident auxiliary-object list |
| `+0x14` | terminated type/callback map |
| `+0x18` | sector count |
| `+0x2C` | start-sector index |

Root `+0x1C`, `+0x20`, `+0x28`, `+0x30…+0x44` and the sector-sized lookup beginning at `+0x48` are accessed by the course loader but are not yet semantically named. `+0x20` is halved and stored in positive/negative form, suggesting a course extent or wrap value. [evidence: disassembly, open question]

A sector is 16 bytes:

```c
struct Sector {
    uint32_t flags;
    uint32_t ordinal;
    uint16_t field08;
    uint16_t field0A;
    uint32_t payloadPtr;
};
```

The ordinal equals the array index. Flags `1`, `8` and `0x80000000` each occur once per course; flags `2` and, on Vegas, `6` occur in a few sectors and are read by driving/physics code. Their names remain open. [evidence: ROM bytes, disassembly, open question]

Each sector payload begins with a `0x44`-byte header. Five `u32` counts at `+0x28…+0x38` partition the placement array; `+0x3C` is skipped/reserved, `+0x40` is total count, and `+0x44` begins `count` records of `0x24` bytes. Repeated payload boundaries equal `0x44 + count*0x24`, and collision routines select category slices by summing the five counts. [evidence: ROM bytes, disassembly, deterministic decoding]

#### Level format: Whole-ROM structural counts

The prototype `levels/analyze_orc.py` validates pointer bounds, vertices and face indices on all nine tracks. Counts below are sector-placement references, not unique models. [evidence: deterministic decoding]

| track | sectors | placements | valid mesh refs | unique terrain models | vertex refs | polygon refs | aux objects | atlas height |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Mojave | 81 | 4,695 | 4,658 | 847 | 62,748 | 38,116 | 78 | 1,073 |
| El Paso | 59 | 3,738 | 3,712 | 793 | 53,507 | 33,548 | 97 | 1,343 |
| Vegas | 88 | 4,053 | 3,977 | 776 | 61,573 | 40,021 | 124 | 1,571 |
| Pikes Peak | 64 | 3,682 | 3,588 | 951 | 54,925 | 35,828 | 19 | 1,124 |
| Ol' South | 74 | 5,617 | 5,535 | 932 | 64,782 | 48,430 | 220 | 998 |
| Baja | 71 | 4,076 | 4,054 | 787 | 65,360 | 41,863 | 148 | 1,280 |
| Flagstaff | 75 | 5,300 | 5,276 | 573 | 65,523 | 40,578 | 48 | 684 |
| El Cajon | 63 | 3,814 | 3,796 | 407 | 49,084 | 31,785 | 36 | 837 |
| Guadalupe | 81 | 4,370 | 4,318 | 508 | 58,694 | 35,302 | 36 | 733 |

#### Music and music-player design: SSEQ format

The SSEQ header declares version 2, 165 uncompressed sequences and a `0xA50`-byte table. Each 16-byte record is `{u16 trackCount,u16 compression,u32 payloadSize,u32 payloadRelativeOffset,u32 loadedPointer}`; payload offsets are relative to `0xC84DB0`, and on-ROM loaded pointers are zero. [evidence: ROM bytes, deterministic decoding]

Each payload contains one or more track headers, label offsets and event bytes. A 20-byte track header is `{u8 soundClass,u8 reverb,u16 initialPatch,s16 initialPitch,u8 volume,u8 pan,u8 substack,u8 muteBits,u16 PPQ,u16 QPM,u16 labelCount,u32 eventBytes}`. Events use a big-endian VLQ delta, one-byte opcode and fixed parameters; WESS multi-byte command parameters are little-endian. The music uses `PatchChg`, `NoteOn`, `NoteOff`, `NullEvent`, `TrkJump` and `TrkEnd`; the complete 36-opcode length table is required for safe validation and later SFX support. **[ROM bytes/deterministic decoding/source archive]**

Sequences 0–11 are sound class 1 music; 12–164 are class 0 SFX. Thus the archive contains 12 music sequences and 153 SFX sequences. [evidence: ROM bytes, deterministic decoding]

#### Mapping onto `src/rom/`: Level assembly and layers

Expose all nine tracks in internal order with `kind: 'race'`; identify Flagstaff, El Cajon and Guadalupe as unlockable in their display names or group. For one selected track: load its optional file when present, open its main file, resolve the root, walk every sector/category and root auxiliary record, intern each distinct model/texture, and emit one transformed instance per placement. Reflect the source world on X, consume the full 32-bit binary angle, and preserve the retail triangle order above. Preserve source file/record/polygon offsets in `DebugInfo`. [evidence: viewer design, deterministic decoding]

Every instance must belong to exactly one visible-control layer: [viewer design]

| layer | kind | default | contents |
|---|---|---|---|
| track | `main` | on | terrain/course meshes from render-active sector categories |
| objects | `objects` | on | auxiliary and object-category placements |
| collision | `collision` | off | diagnostic copies of collision-active category geometry |
| backdrop/sky, if decoded as geometry | `background` | on | camera-relative or distant environment art |

Do not move a visibly rendered record exclusively into collision merely because physics also references it. Either share the decoded mesh through a second diagnostic instance or generate collision wire geometry, keeping the ordinary instance in its visual layer. Files 14, 15 and 36 contain common race/vehicle material outside the per-track load path; omit them from the initial static course scene and add them later only as an explicit optional layer. [viewer design]

The `PanoramaSky` branch of `Level.skies` represents the verified camera-dependent compositor while preserving the existing selector shared with mesh skies. No hardware `Fog` should be synthesized from screenshots alone. [evidence: nviewer source, viewer design]

#### Unused and hidden content: Internal level data

The track format has no general model/texture directory from which a complete “defined versus referenced” orphan census can be made. Sector and root auxiliary placement pointers are the authoritative graph. All nine roots and every bounded placement/model reference parse successfully, but that establishes coverage of referenced material—not the absence of an accidental unreferenced structure elsewhere in a loaded file. A loose aligned model-signature scan produced many false positives inside known headers and is not evidence. [evidence: ROM bytes, deterministic decoding]

The root `+0x14` callback/type tables are enumerable: 290 `{entityID, callbackIndex}` records across the tracks. Sixty-six callback keys lack a matching static root-list auxiliary object ID. Race code can spawn entities dynamically, so these are leads for later runtime tracing, not 66 unused object types. Similarly, gaps between referenced atlas rectangles may be padding or dynamic/specialized art and are not claimed as hidden textures. [evidence: ROM bytes, disassembly, deterministic decoding]

No tenth track name, tenth track-table slot, extra top-level course file or obvious debug/test menu string was found. [evidence: ROM bytes, disassembly]

### 3.3 Geometry

#### Level format: Meshes and polygons

A model record exposes: [evidence: ROM bytes, disassembly]

| offset | meaning |
|---:|---|
| `+0x00` | `f32` radius |
| `+0x04…+0x18` | six `f32` AABB bounds |
| `+0x1C` | inclusive maximum vertex index |
| `+0x20` | pointer to `f32 x,y,z` vertices (12 bytes each) |
| `+0x24` | unresolved |
| `+0x28` | inclusive maximum polygon index |
| `+0x2C` | pointer to 24-byte polygons |

Polygon fields currently established: [evidence: ROM bytes, disassembly]

- `+0x00` packed flags; bit `0x100` selects the textured path;
- `+0x01` palette-selector index;
- bytes `+0x04…+0x0B` supply four S/T pairs, in logical-reference order `(5,4),(7,6),(9,8),(11,10)`, and are multiplied by 32;
- `+0x0E` selects a texture-atlas row;
- `+0x10/+0x12/+0x14/+0x16` are `u16` float-word offsets; divide by three for vertex indices;
- equal second/third indices encode a triangle; otherwise the face is a quad.

The runtime transforms float vertices to temporary N64 vertices and emits `gSPVertex` plus `BF`/`B1` triangle commands. The corrected sentinel, UV order and triangle winding follow the register/data flow in `0x80013E7C`: the comparison uses the low half of polygon `+0x10` (reference 1 at `+0x12`) and the high half of `+0x14` (reference 2 at `+0x14`); a triangle uses logical references `(1,0,3)`, while a quad uses `(1,0,3)` and `(1,3,2)`. [evidence: disassembly, deterministic decoding]

### 3.4 Display lists and render state

Display-list commands and game-supplied render state are described with geometry above.

### 3.5 Textures and materials

#### Level format: Textures and materials

For all nine tracks, root `+0x04` resolves a sole resource descriptor: [evidence: ROM bytes, disassembly, deterministic decoding]

```text
+00 u32 palette-bank/config count
+04 u32 RGBA16 palette-data base
+08 u32 0x80000000 | atlasHeight
+0C u32 packed-CI4 atlas base
```

The terrain builder describes the source as a 128-wide CI8 image for loading bytes into TMEM, but describes the render tile as CI4. Each 128-byte source row therefore contains 256 logical texels, with the high nibble first. Polygon `+0x0E * 128` selects the starting row; the per-face UV extrema determine the loaded rectangle. `G_SETTILE` uses wrap on both axes with mask and shift zero. Root `+0x08` is a `u32` lookup indexed by polygon byte `+0x01`; doubling the selected value produces the offset of a 16-entry RGBA16 TLUT window. Several tracks reference through exactly `atlasHeight-1`, independently validating the low 31 bits of descriptor `+0x08` as height. The normal reset render mode `0x0F0A7008` is the game's anti-aliased, Z-buffered textured-edge mode, so textured faces use one-bit alpha cutout; this restores the transparent surroundings of tree, cliff and other billboard art. The earlier research prototype's CI8 decode caused rainbow-smearing and transparent holes; packed-CI4 decoding and the cutout state were confirmed by coherent offline and browser renders. Remaining packed polygon/material bits are open. [evidence: ROM bytes, disassembly, deterministic decoding]

### 3.6 Collision

#### Level format: Collision

Collision-active records are categories within each sector's ordinary placement array, not a separate triangle file. Routine `0x8000B570` sums counts 0–2 and processes exactly category 3; `0x8000AB34` sums counts 0–3 and processes exactly category 4. Both use placement positions, model pointers and bounds. [evidence: disassembly] Whether their polygons are exact driveable surfaces or object-level collision proxies remains open. [open question]

[viewer design] The loader should always provide a hidden-by-default `collision` layer. If runtime collision reuses visible render meshes, make separate diagnostic instances for the collision layer rather than moving visible objects out of their main/object layers.

### 3.7 Environment, sky, fog, and lighting

#### Environment, camera and graphics state: Track environments

Each of the nine IDs loads a separate large main asset; the hidden tracks are not route flags over ordinary maps. [evidence: ROM bytes, disassembly] Retained frames establish the following ordinary-track presentation:

- Mojave: broad tan dirt, sparse scrub/cacti, trees and orange sandstone cliffs/mesas; sampled Random sky was orange-gray and clouded. [evidence: captured frames]
- El Paso: fenced dirt start, advertisements, spectators, flags, rustic gate/buildings, sparse trees and reddish distant terrain. Separate Random runs produced blue/white-cloud and dark storm-cloud backgrounds. [evidence: captured frames]
- Selector thumbnails depict Vegas's mine/tunnel, Pikes Peak's winding mountain road, Baja's palms/rustic structures and Ol' South's mansion/trees; these are thumbnail evidence, not full-course verification. [evidence: captured frames]

The US manual further describes Mojave construction zones/overpass traffic, El Paso ghost-town/graveyard/falling-aircraft events, Vegas's silver mine and city finish, Pikes Peak's snow and steep ascent/descent, Ol' South's ditches/dense trees, and Baja's dunes/tractors/shallow coastal water. **[game manual]** The hidden tracks' specialized object/art semantics remain unverified and must not be inferred merely from their paired auxiliary files. [open question]

#### Environment, camera and graphics state: Fog, lighting and colors

Three fixed full-/split-screen display-list initializers at ROM `0x83470`, `0x83540` and `0x83610` clear geometry-mode mask `0x001F3204` (including `G_FOG` and `G_LIGHTING`), then enable shade with `0x00000004`. They set fog color to white but do not set a fog multiplier/offset. An aligned whole-ROM command scan and executable construction audit found no plausible fog-factor command. [evidence: ROM bytes, disassembly, deterministic decoding]

The leading implementation model is therefore unlit F3DEX shading from vertex colors, without hardware fog. Distant lightening seen on El Paso is likely baked/per-vertex. [evidence: ROM bytes, captured frames, hypothesis] A dynamically copied track command could still enable fog indirectly, so implementation disagreement should trigger one serialized live GfxTask capture. [open question]

### 3.8 Cameras and paths

#### Environment, camera and graphics state: Skies

The Features menu offers `RANDOM`, `BLUE`, `STORMY` and `DUSK`; default is Random. [evidence: ROM bytes] Independent El Paso starts under Random produced different blue and storm-cloud art, proving that Random resolves per race. [evidence: captured frames]

Routine `0x800175C0` selects one of twelve raw sky files: IDs `22,13,32,6,30,2,23,1,24,40,20,33`. Each file is `0x11BD0` bytes and contains a 64-byte pair of RGBA16 palettes, a 256×567 packed-CI4 atlas, and a 16-byte header. Tables at `0x8006D13C`, `0x8006D0E0` and `0x8006D114` provide the file IDs, resource pointers and tint colours; the feature-option dispatcher at `0x80034C14` partitions them among Blue, Stormy, Dusk and Random. The consumer at `0x8001775C` draws eight panels using 77-row strides and a second palette bank at `+0xE700`. [evidence: ROM bytes, disassembly]

The viewer implements this as a screen-space panorama rather than a perspective sky mesh. It stitches the three upper slabs into a repeating 480×154 turn, repeats the 160×105 lower slab, and reproduces the eight quantized panels, tint, yaw scroll, pitch displacement and conditional black top fill. It exposes the twelve deterministic pictures as `Blue 1…3`, `Stormy 1…2`, `Dusk 1…4`, and the three Mode-5 variants. Random remains a game selection policy rather than a thirteenth picture. [evidence: nviewer source, deterministic decoding]

#### Environment, camera and graphics state: Viewports and projection

Viewport records at ROM `0x83440` encode one 320×240 full-screen viewport and two 320×120 split-screen viewports. [evidence: ROM bytes]

The only caller of frustum builder `0x8005D1A0`, at `0x80016E9C`, passes left/right `-128/+128`, bottom/top `-100/+100`, near `256`, far `32767`, and matrix scale `0.08`. This gives nominal horizontal FOV `53.13°` and vertical FOV `42.67°`; the projection matrix is written at `0x8013C130`. [evidence: disassembly]

Gameplay frames show a perspective third-person chase camera above and behind the truck. Camera is a remappable in-race action, but chase offsets and alternate modes were not captured. [evidence: captured frames, open question]

## 4. Objects

### 4.1 Placement records

#### Level format: Placements and auxiliary objects

The shared 36-byte placement schema is: [evidence: ROM bytes, disassembly]

```text
+00 u32 flags
+04 u32 modelPtr
+08 u32 field08
+0C u32 field0C
+10 u32 packed IDs/material/type
+14 f32 x
+18 f32 y
+1C f32 z
+20 u32 angle
```

Root `+0x10` holds a count followed by `{u32 templatePtr, u32 instanceId}` pairs; each template uses the same placement schema. These are track-resident auxiliary objects. Common vehicle/race files 14, 15 and 36 are not loaded by the track loader and should be omitted from the initial static scene; they can become an optional vehicle layer later. [evidence: ROM bytes, disassembly, viewer design]

The angle feeds a sin/cos transform. Routine `0x8004239C` consumes the full unsigned 32-bit word as one binary-angle turn: the high bits select a sine-table entry and the low 17 bits interpolate it. Y is vertical; physics uses X/Z for planar distance and the middle component for height. The source world must be reflected on X to enter the viewer's right-handed frame, including both placement translation and rotation. This was independently checked against the sidedness and location of signs, grandstands, tents and terrain in reports 0012–0019. Preserve the native float coordinates—often hundreds of thousands of units—and fit the viewer camera to their bounds rather than applying an unverified scale. The packed `+0x08/+0x0C/+0x10` names remain unresolved. [evidence: disassembly, deterministic decoding]

### 4.2 Object and model formats

Object geometry uses the model and display-list formats described above unless stated otherwise.

### 4.3 Skeletons and animation

Static-pose or animation support and remaining omissions are stated in the object description.

### 4.4 Behaviors, triggers, and scripted objects

Behavioral records are documented only where they affect level extraction or presentation.

## 5. Audio

### 5.1 Audio storage and banks

Audio storage is described with the sequence and bank tables below.

### 5.2 Sequence format and driver

#### Music and music-player design: Driver, rate and archive

The game uses Williams Entertainment Sound System (WESS): an `SN64` v2 module/bank and `SSEQ` v2 sequences driving Nintendo libaudio and the standard `aspMain` ABI. The exact SDK revision of `aspMain` is not identified. Uncommon diagnostics and imports correlate with the unstripped WESS object from the published *Mortal Kombat Trilogy* source and reconstructed WESS sources, but all addresses and format claims below are independently established in the Off Road Challenge ROM. **[ROM bytes/disassembly/source archive]**

Initialization at `0x8004FFA4` requests 22,050-Hz output and a 4,096-byte maximum audio-command buffer. The WESS callback at `0x80051004` returns 8,333 microseconds and `GetIntsPerSec` at `0x8005728C` returns 120; every music track is PPQ/QPM 120/120, hence 240 authored ticks per second. The regional 50/60 value sizes audio tasks/buffers and does not change song tempo. [evidence: ROM bytes, disassembly]

| ROM range | bytes | role |
|---|---:|---|
| `0xC75030–0xC84340` | 62,224 | `SN64` v2 WMD module/bank |
| `0xC84340–0xC84DB0` | 2,672 | `SSEQ` header and 165×16 sequence records |
| `0xC84DB0–0xC871B8` | 9,224 | sequence/track payloads |
| `0xC871B8–0xC871C0` | 8 | alignment before WDD |
| `0xC871C0–0xF05654` | 2,614,420 | indexed WDD VADPCM samples |

Runtime `0x80050038–0x80050044` explicitly stores `0xC871C0` in `WessConfig` and WESS passes it to `N64_wdd_location`. A diagnostic decode succeeds at that base and encounters invalid predictors at the earlier SSEQ endpoint, independently checking the alignment. [evidence: disassembly, deterministic decoding]

#### Music and music-player design: SN64/WMD bank

The 32-byte module header says version 2 and `data_size=0xF2D8`. Its 24-byte patch-group header at `0xC75050` has load flags `0x1F`, 196 patches (4 bytes), 196 patch maps (20 bytes), 196 wave records (24 bytes), no drum maps and `extra_size=0xCE18`. [evidence: ROM bytes, deterministic decoding]

| offset | records |
|---|---|
| `0xC75068` | 196× `{u8 mapCount,u8 pad,u16 firstMap}` |
| `0xC75378` | 196×20-byte patch maps |
| `0xC762C8` | 196×24-byte wave records |
| `0xC77528` | loop-info header: 196 waves, zero raw loops, 21 ADPCM loops |
| `0xC77530` | 21×48-byte `ALADPCMloop2` records |
| `0xC77920` | 196×264-byte predictor books |

A patch map holds priority, volume, pan, reverb, root/fine tuning, note and pitch-step ranges, wave ID and attack/decay/release envelope fields. A wave record is `{u32 relativeBase,u32 byteLength,u8 codec,u8 flags,u16 pad,s32 pitchCents,s32 loopIndex,u32 zero}` before WESS fixes it up in memory. All 196 waves use 4-bit N64 VADPCM. Ninety-one declared byte lengths include a one-byte remainder; decode only complete 9-byte/16-sample frames. [evidence: ROM bytes, disassembly, deterministic decoding]

Pitch ratio is `2^((wavePitch + pitchControl + (key-rootKey)*100 - fineAdj)/1200)`. A diagnostic extraction of patch 31 decodes 103,648 PCM frames at effective 11,025 Hz, lasting 9.401 s against sequence 0's 9.404-s NoteOff. This verifies the WDD base, predictor-book index, frame format, tuning and event timing, but it is not a mixed-song/audio-capture comparison. [evidence: deterministic decoding]

#### Music and music-player design: Complete music list, routing and loops

Game sound IDs are not SSEQ IDs. The common wrapper divides a sound ID by three and indexes the 470×8 descriptor table at ROM `0x82450`; its first `s16` is the WESS sequence. The radio UI's six names are at `0x82368`, and its sound-ID table routes to sequences 6–11. [evidence: ROM bytes, disassembly]

| seq | sound ID | viewer name | control | intro / body |
|---:|---:|---|---|---|
| 0 | 3 | Cue 0 | one-shot | 2,257 ticks / 9.404 s |
| 1 | 6 | Transition Cue 1 | one-shot | 1,313 ticks / 5.471 s |
| 2 | 9 | Music Cue 2 | infinite full loop | 9,503 ticks / 39.596 s |
| 3 | – | Unreferenced Music 3 | intro, then infinite loop | 995 ticks / 4.146 s intro; 2,376 ticks / 9.900 s loop |
| 4 | 12 | Music Cue 4 | infinite full loop | 7,080 ticks / 29.500 s |
| 5 | 15 | Startup/Menu Cue 5 | infinite full loop | 6,760 ticks / 28.167 s |
| 6 | 18 | BAJA BLAST | infinite full loop | 19,178 ticks / 79.908 s |
| 7 | 21 | KEEP ON TRUCKIN' | infinite full loop | 11,892 ticks / 49.550 s |
| 8 | 33 | COUNTRY JAMBOREE | infinite full loop | 38,813 ticks / 161.721 s |
| 9 | 27 | ROVIN' BAND | infinite full loop | 18,348 ticks / 76.450 s |
| 10 | 30 | PIKES PICK | infinite full loop | 29,916 ticks / 124.650 s |
| 11 | 24 | MOJAVE SWING | infinite full loop | 14,028 ticks / 58.450 s |

Names 0–4 are neutral viewer labels because the ROM supplies no titles; “Startup/Menu” for 5 describes its direct call at `0x80034BD0`, not an in-ROM song title. Sequences 0/1 reach `TrkEnd`. Every track of sequences 2 and 4–11 ends with `TrkJump 0`, where label 0 targets the initial `NullEvent`, so those entire bodies loop indefinitely. Sequence 3 first reaches its label at tick 995, ends at 3371 and repeats the 2,376-tick interval. The game triggers music with volume-only attributes; the WESS `TRIGGER_LOOPED` API flag is not what creates these loops. [evidence: ROM bytes, disassembly, deterministic decoding]

At 22,050 Hz, rounded `DecodedMusic` loop markers are: [evidence: deterministic decoding, viewer design]

| seq | loopStart | loopEnd |
|---:|---:|---:|
| 2 | 0 | 873,088 |
| 3 | 91,416 | 309,711 |
| 4 | 0 | 650,475 |
| 5 | 0 | 621,075 |
| 6 | 0 | 1,761,979 |
| 7 | 0 | 1,092,578 |
| 8 | 0 | 3,565,944 |
| 9 | 0 | 1,685,723 |
| 10 | 0 | 2,748,533 |
| 11 | 0 | 1,288,823 |

These are calculated event positions, not full-song render measurements: `frame = floor((tick*22050 + 120)/240)`, equivalent to JavaScript `Math.round` for nonnegative values. Retain rational tick time until final sample conversion to prevent accumulated rounding. The bank also contains 21 infinite sample-level ADPCM loops, separate from song control flow; none of the six radio songs depends on a sample loop. [evidence: ROM bytes, deterministic decoding]

Race setup reads the global radio selection and starts the corresponding sound ID. There is no fixed course-to-song mapping: any named radio song can accompany any track, and `RADIO OFF` selects silence. [evidence: disassembly]

#### Music and music-player design: Player scope

Expose all 12 class-1 sequences, including the explicitly labelled unreferenced sequence 3. A production decoder should: [viewer design]

1. validate the SN64/SSEQ/WDD bounds and all pointers before allocation;
2. reuse the repository's N64 VADPCM and 4-tap ABI1 resampler primitives, but parse this WESS bank rather than passing it to the incompatible standard `ALBankFile` parser;
3. schedule all sequence tracks at 240 ticks/sec and implement the six used music opcodes, while retaining the full opcode-length table for rejection/skipping;
4. apply patch-map attack/decay/release, volume, pan, pitch and track controls;
5. render stereo Float32 at 22,050 Hz and use the explicit loop markers above, allowing release tails only for one-shots;
6. cache prepared waves per loaded ROM, but decode songs on demand. The longest loop is about 28.5 MB as stereo Float32, so eager whole-soundtrack PCM caching is wasteful.

The container/parser work is bounded and moderate; exact WESS voice/envelope behavior is the main fidelity risk. A minimal first pass is unusually tractable because the music primarily plays long pre-rendered chunks around note 60 with simple patch switching, but implementing the scheduler is still preferable to concatenating samples—sequence 3 has an intro and the two-track songs alternate chunks for seamless playback. [evidence: ROM bytes, deterministic decoding, viewer design]

#### Mapping onto `src/rom/`: Music player

Implement the WESS/SN64 module as a bounded parser, keeping SSEQ event interpretation separate from N64 VADPCM bank/sample decode. Expose all 12 music sequences in sequence order using the six ROM titles and neutral labels from *Complete music list, routing and loops*; preserve sequence IDs in diagnostics. Decode on demand in the worker. Return exact authored loop points for the looping sequences and no loop for one-shots. [viewer design]

The existing `DecodedMusic` interface is adequate. The driver is not the standard Nintendo compressed-MIDI format, so reusing `libultra.ts` should be limited to genuinely compatible synthesizer primitives rather than feeding WESS events into an unrelated sequence parser. Initial scope may omit WESS effects/reverb, but must preserve sample tuning, volume/pan, tempo, simultaneous-track timing and voice termination. [viewer design]

#### Unused and hidden content: Statically unreferenced audio

The game-level sound descriptor table has 470 eight-byte entries at ROM `0x82450` and names 158 of the 165 SSEQ IDs. The only IDs absent from every descriptor are music sequence 3 and SFX sequences 12 and 65–69. Direct calls to the WESS trigger API occur only inside descriptor-based wrapper paths; no direct bypass was found. These are therefore **statically unreferenced candidates**, not proof of impossibility under every indirect or corrupt state. [evidence: ROM bytes, disassembly, deterministic decoding]

| sequence | class | payload | stored duration at 120 PPQ/QPM | initial patches |
|---:|---|---|---:|---|
| 3 | music | `0xC84E68+0x68` | 3,371 ticks / ~14.05 s | 189, 6 |
| 12 | SFX | `0xC85630+0x28` | 120 ticks / 0.50 s | 190 |
| 65 | SFX | `0xC86040+0x28` | 693 ticks / ~2.89 s | 191 |
| 66 | SFX | `0xC86068+0x28` | 129 ticks / ~0.54 s | 192 |
| 67 | SFX | `0xC86090+0x28` | 188 ticks / ~0.78 s | 193 |
| 68 | SFX | `0xC860B8+0x28` | 319 ticks / ~1.33 s | 194 |
| 69 | SFX | `0xC860E0+0x28` | 435 ticks / ~1.81 s | 195 |

Across all 165 sequences, 195 of 196 patches are used. Patch 131 is unused and maps only wave 138. Waves 71, 72, 73, 179, 184 and 188 are not mapped by any patch at all. Together with wave 138, these seven isolated VADPCM payloads total 42,184 bytes (41.2 KiB). The six unreferenced SFX sequences 12 and 65–69 isolate another 65,974 sample bytes. Music sequence 3 exclusively uses patch 189 → map 39 → wave 33, whose `0xDEFF8E–0xDF692A` payload adds 27,036 bytes. The combined candidate-unused sample payload is therefore 135,194 bytes (`0x2101A`, 132.0 KiB). None of these candidates was listened to, so no semantic name is assigned. [evidence: ROM bytes, deterministic decoding]

### 5.3 Instruments and sample encoding

Instrument banks, envelopes, loops, and sample encoding are described above.

### 5.4 Music catalog and loop points

The complete known song catalog and loop policy are included above.

## 6. Unused and hidden content

### 6.1 Unreferenced assets

#### Unused and hidden content

The top-level reference graph divides all IDs 0–40 among two 12-entry active selector tables, five direct loader IDs, and track main/aux tables. The sets are disjoint and exhaustive; no top-level raw file is statically orphaned. [evidence: ROM bytes, disassembly, deterministic decoding]

Flagstaff, El Cajon and Guadalupe are complete retail hidden/unlockable tracks, not unused. [evidence: ROM bytes, disassembly]

#### Unused and hidden content: Arcade-port residue

The ROM retains AAMA rating text plus `INSERT COINS`, `FREE PLAY`, `CREDITS`, `FREE RACE`, `JOIN NOW!`, multi-way join and placement UI. Several have direct code or pointer-table references. Two adjacent entry points at `0x80048408` and `0x80048410` are shipped as `jr ra; nop` stubs despite 15 and 25 direct callers respectively; the calls pass small event-like IDs. This is strong evidence of inert/removed interface behavior and likely arcade-port residue, but static analysis does not prove whether every surrounding N64 state path is unreachable. [evidence: ROM bytes, disassembly, hypothesis]

`ARCADE AI: OFF`, `TROPHY GIRLS: OFF` and `SKY TYPE: RANDOM` appear with the ordinary features/options text and must not be called a debug menu merely because of their wording. Audio error labels and source basenames such as `synthesizer.c`, `env.c` and `reverb.c` are compiled-library diagnostics, not a user-facing debug facility. [evidence: ROM bytes]

#### Unused and hidden content: End-of-ROM residue

The SSEQ event payload ends at `0xC871B8`, followed by eight bytes of alignment. Runtime initialization explicitly passes `0xC871C0` as the WDD/sample base. The final indexed wave ends at `0xF05654`; the following 12 bytes are unindexed and end exactly on the next 32-byte boundary at `0xF05660`: [evidence: ROM bytes, disassembly, deterministic decoding]

```text
a3e7ea2e52d31d2e8db1444f
```

The remaining `0xFA9A0` bytes through the 16 MiB end are `FF`. The 12-byte placement strongly suggests build/alignment residue, but its value is unexplained and is not promoted to hidden content. [evidence: ROM bytes, deterministic decoding, hypothesis]

### 6.2 Cut or inaccessible levels

Candidate levels are distinguished from alternate, debug, and intentionally hidden retail content above.

### 6.3 Debug features

Shipped debug strings and executable features are listed only when supported by a code or data reference.

### 6.4 Prototype or revision-specific content

Source-archive and prototype material is explicitly distinguished from shipped retail data.

## 7. nviewer implementation

### 7.1 Module mapping

#### Mapping onto `src/rom/`

This is an implementation design, not repository work performed by this investigation. Current shared interfaces were inspected in the repository. [evidence: nviewer source, viewer design]

#### Mapping onto `src/rom/`: Detection and file access

Add `'offroadchallenge'` to `Game.id`, detect `NOFE` and `NOFP` in `src/rom/index.ts`, and reject unsupported revisions or malformed tables before following any pointer. Normalize byte order before detection. Use a regional descriptor containing the main-image end, table offsets and audio base, then derive file extents and RAM pointer resolution from the ROM table itself. [viewer design]

Do not extract files at runtime. An `OffroadRom.file(id)` view over the normalized ROM can validate `romStart <= romEnd <= rom.length`, zero flags, and the expected destination interval, then return a subarray. Cache only immutable parse products that are shared by repeated level loads; the raw files are already views and need no copied-file cache. [viewer design]

#### Mapping onto `src/rom/`: Proposed modules

| module | responsibility | starting evidence | difficulty |
|---|---|---|---|
| `src/rom/offroad/fs.ts` | version profile, 41-entry table, bounded file views, pointer resolver | `fs/NOTES.md`, `fs/file_table.tsv`, `fs/extract.py` | low |
| `src/rom/offroad/level.ts` | track tables/root, sector/category walk, placement and model decoding | `levels/NOTES.md`, `levels/analyze_orc.py` | medium-high |
| `src/rom/offroad/texture.ts` | packed-CI4 atlas windows, palette selection, RGBA16 TLUT and material state | `levels/NOTES.md` | medium |
| `src/rom/offroad/music.ts` | WESS/SN64 archive, SSEQ event interpreter, bank/sample decode and song metadata | `music/NOTES.md`, `music/analyze_wess.py` | medium |
| `src/rom/offroad/offroad.ts` | `Game`, nine-entry level list, assembly, layers, camera/environment defaults | *Tracks and track loading* through *Environment, camera and graphics state* | medium |
| shared `types.ts` / `index.ts` | game ID and detection only | current repository contracts | low |

Production code derives offsets from the selected revision's tables and enforces
the bounds and invariants documented here. [viewer design]

#### Mapping onto `src/rom/`: Difficulty summary

| area | difficulty | principal risk |
|---|---|---|
| ROM/files | low | regional offsets and rejecting malformed pointers |
| track geometry/placement | medium-high | packed category/material fields and custom float-index face encoding |
| textures | medium | dynamic packed-CI4 atlas rectangles and palette-window selection |
| environment/camera | medium | sky mechanism and unverified chase offsets, rather than basic geometry |
| objects/collision | medium-high | exact five-category semantics and visual/collision overlap |
| music | medium | a small new WESS event scheduler; bank location is simple, exact envelope/voice fidelity is the risk |

### 7.2 Supported features

The Technical summary states the supported releases and principal decoded features.

### 7.3 Approximations and omissions

Viewer approximations are distinguished from facts about the game formats.

## 8. Verification and remaining work

### 8.1 Verification evidence

#### Verification plan and evidence: Research evidence

| subject | method/result | artifact |
|---|---|---|
| ROM/boot | full-file hashes, CIC CRC recomputation, static boot mapping | `fs/header.json`, `fs/NOTES.md` |
| filesystem | all 41 records validated and extracted byte-for-byte; sorted ranges are gapless | `fs/file_table.tsv`, `fs/extract.py` |
| loader | MIPS control flow through bounded chunked PI DMA | `fs/code.disasm`, `fs/NOTES.md` |
| tracks | all nine roots/file IDs parsed; six ordinary selector entries and gameplay visually sampled | `fs/tracks.tsv`, `environment/NOTES.md`, `environment/emulator-visuals/` |
| level structures | all nine roots, sectors, placements, model bounds/indices and texture windows checked | `levels/analyze_orc.py`, `levels/track_summary.tsv`, `levels/NOTES.md` |
| environment | menu strings/frames, display-list templates and projection call flow | `environment/NOTES.md` |
| Europe | exact header/hash check plus wordwise pointer-rebase comparison of every file | `versions/NOTES.md`, `versions/files.tsv` |
| music | archive/tables/events/bank parsed and all music sequences classified | `music/NOTES.md`, `music/tables/` |
| references | exhaustive top-level loader graph plus bounded internal audits | `unused/NOTES.md`, `unused/reference_graph.tsv` |

#### Verification plan and evidence: Required implementation gates

An implementation should pass the repository's normal gates. [evidence: nviewer source, viewer design]

1. `npm run typecheck`.
2. Load and hash all nine US tracks, twice each through `structuredClone` with all buffers transferred; load all nine European tracks through the same parser.
3. Compare the other games' all-level hashes against a clean worktree of `HEAD` and require bit-identical results.
4. Run `npm run check:layers -- Off Road`; require every drawn instance to have one layer and every track to have a nonempty hidden-by-default collision layer.
5. Validate that every sector/category walk, model vertex/face range, texture atlas rectangle, palette window and resolved pointer stays within its owning file.
6. Render at least Mojave and El Paso with the retained game frames as qualitative references, plus one track from each remaining auxiliary-file pattern and each hidden track. Image comparison must account for unmatched race timing/HUD/camera rather than treating raw pixel difference as a correctness score.
7. Enumerate and decode every exposed song; check duration, channel finiteness, sample range and exact loop endpoints. Render enough passes to prove the terminal jumps are seamless, then run soundtrack regressions for existing games if shared audio code changes.

Structural US/EU equivalence supplies a strong cross-version oracle: after normalizing each pointer by its file's `defaultDest`, every one of the 40 same-length files should produce the same decoded semantic hash. [evidence: deterministic decoding, viewer design]

#### Open questions

All items here are unresolved and must remain hypotheses until new evidence answers them:

1. The exact names/roles of all five sector placement categories, including which are both rendered and collision-active.
2. Complete bit assignments in placement `flags`, packed field `+0x10`, polygon flags/material fields, and the axis/sign/range of `angle`.
3. The resource and drawing mechanism for Blue, Stormy and Dusk skies, including how Random chooses one and whether the art is camera-relative.
4. Whether any dynamically copied display-list fragment enables hardware fog despite the fixed templates disabling it.
5. Exact gameplay chase-camera offsets and alternate camera modes.
6. The function of model field `+0x24`, sector fields `+0x08/+0x0A`, and sector flag bits `0x2/0x8`.
7. The semantics of common files 14, 15 and 36 and how much vehicle/race-state art belongs in a useful static scene.
8. Exact contextual names for non-radio WESS cues, precise envelope/voice behavior, and the SDK revision of the linked `aspMain` microcode.
9. The audible identity/purpose of unreferenced music sequence 3, SFX 12/65–69, and their isolated waves; a future offline WESS renderer can answer this without an emulator.
10. Whether any internally valid but unreferenced model, texture or arcade-mode resource is genuinely unreachable rather than an animation array, padding, dynamic spawn or indirect reference.
11. The meaning, if any, of the 12 unindexed bytes after the final WDD wave.

### 8.2 Known unknowns

Unresolved semantics are labelled **Hypothesis** or **Open question** where they occur.

### 8.3 References

External documentation, decompositions, and source archives are cited inline where used.
