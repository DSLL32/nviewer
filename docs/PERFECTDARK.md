# Perfect Dark — Nintendo 64 ROM format specification

This manual describes the shipped data formats needed to identify, extract, and
present Perfect Dark content. Claims state their evidence inline; unsupported
interpretations are labelled hypotheses.

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | 2,013 named files; ROM offset table in the data segment, name table at ROM 0x1D5CA00. BG `.seg` containers, `_tilesZ`, `_padsZ`, setups `U*`, models `P*`/`C*`/`G*`, text `L*`, MP3 voice clips `A*` (*File table (verified: ROM, RAM, loader disassembly, load trace)*) |
| Compression | "rarezip" `11 73` + u24 size + raw DEFLATE, bit-exact against the game (498/498 decompressions in RAM); the viewer's `inflate.ts` works unchanged (*Compression: rarezip "1173" (verified bit-exact against the game)*) |
| Graphics microcode | Rare's GBI1-family microcode (glide64 "ucode 7"): 12-byte `G_VTX`, `G_COL` colour arrays, `TRI4`, and a file-only `C0` texture macro. It **can't be run by `displaylist.ts` unchanged** (*Display lists (verified: opcode histogram of all 4,367 leaf lists; decoded identically by the frame-DL walker; renders)*) |
| Geometry | BG file of rarezip sections: rooms (tree of blocks with display lists, 12-byte vertices, RGBA colour arrays), portals, visibility commands, lights, bounding boxes (*Level geometry*) |
| Textures | global store of 3,503 textures by number, two decoders (zlib paletted; bitstream Huffman/RLE/lookup/blur), texels identical to RDRAM (*Global textures (verified: disassembly, all 3,502 non-empty textures decode, texels identical to RDRAM)*); plus embedded tiles in model files |
| Collision | Per-stage tile polygons plus pad records in named `_tilesZ` and `_padsZ` files. |
| Music driver | libultra `n_audio` / `n_alCSPlayer` compressed-MIDI engine; 119 sequences and a stage table with primary, ambient, and X tracks. |
| Audio microcode | Rare's `naudio_mp3` task. |
| Sample encoding | Nintendo VADPCM for music and sound effects; MP3 for voice clips. |
| Levels | stage: one stage-table record = BG + tiles + pads + solo setup + MP setup (61 records; *Levels*). 17 solo missions, 4 special assignments, Carrington Institute, 16 Combat Simulator arenas; several stages share a BG |
| Memory requirement | Expansion Pak; a separate reduced-memory menu path exists. |
| Viewer support | USA and European retail data; stages, objects, collision, environment, characters, and music. |
| Outside the file table | animations, fonts, sound and music banks, sequences, global textures (*ROM map (verified; 41 regions cover every byte, `fs/rommap.tsv`)*) |
| Space | right-handed, +Y up, game units (the player's eye is 159 units above the floor), no mirroring; three stages are drawn at 0.5 scale in the game, which the viewer can ignore (*Coordinates, units, culling (verified)*, *How the game draws a frame, environment, fog and sky (verified: 13 RDRAM captures with frame display lists, disassembly)*) |
| Environment | two environment tables by stage: fog (`gSPFogPosition`), sky and clear colour, clouds/water/suns; sky rooms drawn camera-relative (*How the game draws a frame, environment, fog and sky (verified: 13 RDRAM captures with frame display lists, disassembly)*) |
| Lighting | baked vertex colours; the game dims some entries at run time (*Lighting at run time (verified: RAM colour arrays vs BG file in 9 stages)*) |
| Objects | pads + setup command lists (0x3B types); models with node trees (LOD, bbox, head spot) in the same microcode; placement math verified against 285 RAM objects (*Objects and props*) |
| Characters | body + head models authored in a "splits" bind pose; animation format decoded (joint matrices equal RAM), so characters can stand in their idle frame (*Animations and standing characters (verified: lib `anim.c` disassembly, all 1,207 table records, joint matrices vs RAM)*) |
| Viewer | a new `src/rom/perfectdark/` module set; medium difficulty overall (*Mapping onto the viewer*) |

### 1.2 ROM identification

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| USA V1.0 | `Perfect Dark` | `NPDE` | 0 | 32 MiB (`0x2000000`) | `DDF460CC` | `3CA634C0` | `60dfe17923c03875b499b3cd3200f05cb538b7ad` | CIC-6105 | — |
| USA V1.1 | `Perfect Dark` | `NPDE` | 1 | 32 MiB (`0x2000000`) | `41F2B98F` | `B458B466` | `af8788ac4d1a57260eae9c53ffe851fcf2a3319b` | CIC-6105 | — |
| Europe | `Perfect Dark` | `NPDP` | 0 | 32 MiB (`0x2000000`) | `E4B08007` | `A602FF33` | `a663d3f4eee0b198471132db92e9639a9edd1985` | CIC-6105 | — |
| Japan | `PERFECT DARK` | `NPDJ` | 0 | 32 MiB (`0x2000000`) | `96747EB4` | `104BB243` | `99bcaaa4841b09c845e1094006df8f637862f02e` | CIC-6105 | — |

Verified from the normalized ROM headers and complete-image SHA-1 hashes.

### 1.3 Terminology and conventions

ROM and memory ranges are half-open. Offsets, addresses, encoded sizes, masks,
and opcodes are hexadecimal unless stated otherwise. Multi-byte CPU fields are
big-endian. RAM addresses are virtual unless explicitly identified as physical;
segmented, VROM, and file-relative addresses are named at each use.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

### 2.2 Memory and address mapping

#### Addressing of loaded data (verified: disassembly and trace)

| Data | Pointer convention |
|---|---|
| models `C*`, `G*`, `P*` | virtual addresses based at **0x05000000**. The loader (0x70022A24) adds `load − 0x05000000` to the header fields and walks the node tree. A viewer uses `ptr − 0x05000000` as the file offset |
| setups `Usetup*`, `Ump_setup*` | file-relative offsets in the header (+0x0C, +0x10, +0x14, +0x18) |
| BG `.seg` | read in parts: a 0x40-byte header, a primary block, then compressed room sections at file offsets (*Level geometry*) |
| global display lists | ROM 0x7EB270, segment 2 (`[0x800AB550] = ptr − 0x02000000`) |
| global textures | by texture number (*Level geometry*) |
| voice clips | ROM address and size, streamed |

### 2.3 ROM map and asset organization

#### ROM map (verified; 41 regions cover every byte, `fs/rommap.tsv`)

| ROM | Contents |
|---|---|
| 0x0000000–0x0001000 | header, IPL3 (CIC-6105) |
| 0x0001000–0x0194785 | boot, lib, data, boot inflater, game pages (*Boot chain and code segments (verified: disassembly; RDRAM equal to the decompressed images)*); stale bytes and an unused page duplicate |
| 0x0194440–0x01A15C0 | an older Japanese glyph set (small 16×12 cells from 0x194440, overlapping the duplicate page run; large 16×16 cells from 0x19FB40), addressed by U code but never used because U text is ASCII (*Text and strings*) |
| 0x01A15C0–0x07CD1A0 | animation data, read in place in small pieces (base constant at lib 0x70023828) |
| 0x07CD1A0–0x07D0A40 | animation table (read whole) |
| 0x07D0A40–0x07D1C20 | Combat Simulator challenge configurations |
| 0x07D1C20–0x07E9D20 | multiplayer strings: 7 blocks × 0x3700 (ranges in data at 0x800887C4) |
| 0x07E9D20–0x07EB270 | Carrington Institute firing-range data (loaded by 0x7F19D320; identity medium-high) |
| 0x07EB270–0x07EBDC0 | global display lists and texture-config tables linked at **0x02000000** (segment 2) |
| 0x07EBDC0–0x07F2390 | block loaded by 0x7F015E28 (size 0x65D0; hypothesis: more segment-2 data) |
| 0x07F2390–0x07F7860 | an unused font in the game's font format (*ROM leftovers and revision-only content*) |
| 0x07F7860–0x0803DA0 | 6 fonts |
| 0x0803DA0–0x080A250 | a second unused font (*ROM leftovers and revision-only content*) |
| 0x080A250–0x0839DD0 | sound-effect instrument bank (`sfx.ctl`, "B1") |
| 0x0839DD0–0x0CFBF30 | sound-effect samples (`sfx.tbl`) |
| 0x0CFBF30–0x0D05F90 | music instrument bank ("B1") |
| 0x0D05F90–0x0E82000 | music samples |
| 0x0E82000–0x0ED83A0 | sequence table (u16 count = 119, 8-byte records) + 119 rarezip sequences |
| 0x0ED83A0–0x1D5CA00 | the 2,013 files (*File table (verified: ROM, RAM, loader disassembly, load trace)*) |
| 0x1D5CA00–0x1D6573D | file name table |
| 0x1D6573D–0x1D65F40 | zeros |
| 0x1D65F40–0x1FF7C95 | global textures, 3,503 entries (*Level geometry*) |
| 0x1FF7CA0–0x1FFEA20 | global texture table; field layout is documented under *Global textures* |
| 0x1FFEA20–0x1FFFE00 | two rarezip boot screens, 507×48 RGBA5551: "Copyright Rare Ltd. 2000" and "Accessing Controller Pak" (lib 0x7000D740) |
| 0x1FFFE00–0x2000000 | 0xFF fill (0x1FFFF00 is the developer boot-argument area, *Debug features left in the retail code*) |

### 2.4 Compression formats

#### Compression: rarezip "1173" (verified bit-exact against the game)

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 1 | `u8` | `magic0` | `0x11`. |
| `0x01` | 1 | `u8` | `magic1` | `0x73`. |
| `0x02` | 3 | `u24` | `decodedSize` | Exact big-endian decompressed size. |
| `0x05` | variable | raw DEFLATE | `payload` | RFC 1951 stream without a zlib/gzip wrapper or checksum. File-table entries may add zero to 15 padding bytes after the stream. |
- **Other magics:** `rarezipInflate` also accepts `11 72` (GoldenEye's format: magic only, no size, DEFLATE after 2
  bytes), but PD doesn't use it anywhere. Any other magic fails with `RareZipAsmDecompress: input not in any known
  rare zip format`.
- **Where 1173 is used:** compressed files, the game pages, lib, data, global textures, BG sections and music
  sequences.
- **Verified against the game:** during a Defection stage load, a breakpoint at the decompressor's entry
  (0x700074F0) and its success return (0x700077EC) dumped every output buffer. All **498 of 498** outputs are
  byte-identical to `zlib.decompressobj(-15)` of the ROM stream (`fs/trace/defection.tsv`, `fs/trace/z/`). They
  cover:
  - 7 language files, the setup, pads and tiles files;
  - 49 prop and 17 character models;
  - 409 global textures, 10 BG sections and 3 music sequences.
- **The viewer's decoder works unchanged:** `src/rom/inflate.ts` `inflateRaw(rom, off + 5, size)` equals zlib on all
  1,403 compressed files plus lib and data (`fs/scripts/inflate_check.ts`, about 0.8 s in total).

#### File table (verified: ROM, RAM, loader disassembly, load trace)

| Location | Count | Type | Field | Description |
|---|---:|---|---|---|
| `data + 0x28080` / `0x80082060` | 2015 | `u32` | `romOffset` | Absolute ROM offsets. Entry 0 is zero; entries 1–2013 are files; entry 2014 is the terminal offset `0x1D5CA00`. File `k` occupies `[romOffset[k], romOffset[k+1])`. |
| ROM `0x1D5CA00` | 2014 | `u32` | `nameOffset` | Offsets relative to `0x1D5CA00`, each naming a NUL-terminated string. |
The game loads files by numeric id and never reads the name table. The ids are compiled-in constants and stage-table
fields. A viewer can rely on the names for lookup, because they are stable within this revision.

| Kind | Names | Count | Stored |
|---|---|---|---|
| BG geometry | `bgdata/bg_{code}.seg` (ids 1–60) | 60 | raw file; sections inside are 1173. Many are 0x200-byte stubs |
| marker | `ob/ob_mid.seg` (id 61) | 1 | size 0 |
| characters and heads | `C*Z` | 148 | 1173 |
| guns, hands, items | `G*Z` | 106 | 1173 |
| props | `P*Z` | 433 | 1173 (`PexplosionbitZ` has size 0) |
| solo setups | `Usetup{code}Z` | 61 | 1173 |
| multiplayer setups | `Ump_setup{code}Z` | 60 | 1173 |
| pads, clipping tiles | `bgdata/bg_{code}_padsZ`, `bgdata/bg_{code}_tilesZ` | 60 + 60 | 1173 |
| text | `L{name}E/J/P`, `L{name}_str_g/f/s/iZ` | 476 (7 × 68) | 1173 |
| voice clips | `A*M` | 548 | raw MPEG-2 Layer III, 24 kbit/s, 22,050 Hz mono (all 69,155 frames parse), streamed from ROM |

**Loader** (`fileLoadToNew`, 0x7F166EBC):
1. Allocate `align16(u24 size + 32)` bytes (plus 0x8000 slack for models) from the stage memory pool.
2. Read the compressed bytes to the end of that buffer and inflate them to the start.
3. Shrink the allocation to the real size.

The file layer never relocates; format code converts pointers afterwards (*Addressing of loaded data (verified: disassembly and trace)*).

#### ROM, boot, codec, files

| Check | Method | Result | Evidence |
|---|---|---|---|
| CIC-6105 | header CRCs recomputed with the 6105 algorithm; IPL3 crc32; RAM word 0x800002E8 | all four dumps match; `98BC2C86`; `C86E2000` | `fs/scripts/cic.py`, `fs/ram/title1.bin` |
| code images | RDRAM at the title screen vs decompressed boot, lib, data, game (8 MiB); demand-paged game code (4 MiB) | boot, lib and game identical; data differs only in 1,292 bytes of globals; 129/129 pages identical | `fs/scripts/cmp_ram.py`, `fs/ram/boot4mb.bin` |
| rarezip vs the game | breakpoints at the decompressor entry and return during a Defection load; output buffers dumped | 498/498 identical to zlib (text, setup, pads, tiles, 66 models, 409 textures, 10 BG sections, 3 sequences) | `fs/trace/defection.tsv`, `fs/trace/z/` |
| viewer `inflate.ts` | tsx over all compressed files + lib + data | 1,405 streams identical to zlib | `fs/scripts/inflate_check.ts` |
| voice clips | MPEG frame parser | 548/548 MPEG-2 Layer III 24 kbit/s 22,050 Hz mono | `fs/scripts/afiles.py` |
| ROM map | contiguity and fill checks | 41 regions cover the ROM | `fs/rommap.tsv` |
| revisions | structural extraction of U V1.0/V1.1, E, J; decompressed file comparison by name | *Revisions (verified: `fs/scripts/revs.py`, `revcode.py`, `fs/revs.txt`)* | `fs/revs.txt`, `unused/revs/fundiff_U10_U11.txt` |

### 2.5 Loading process

### 2.6 Revision differences

#### ROM leftovers and revision-only content

| Item | Evidence | Confidence |
|---|---|---|
| **two unused fonts** in the game's font format at ROM 0x7F2390 (a squared "Handel Gothic"-like face with small caps) and 0x803DA0 (a square pixel face). Not referenced in U, V1.1 or E; removed in J; not GoldenEye fonts. Sheet `unused/rom/fonts_all_8_sheets.png`, rows 7–8 | format match, renders, reference scans of all revisions | high |
| boot screens at 0x1FFEA20/0x1FFF550 (507 × 48 RGBA5551): "Copyright Rare Ltd. 2000 / Published by Rareware." and "Accessing Controller Pak" (hold START at power-on). Used; English even in J. `unused/rom/bootimg_*_x3.png` | disassembly lib 0x7000D740, decoded | high (used) |
| 0x2EA72–0x39850: a stale byte copy of ROM 0x1050–0xBE2E (build-tool padding); present in every revision | ROM compare | high |
| 0x156DB4–0x194786: a truncated second copy of the game-code zip block (103 of 442 pages) with a zeroed page table; every revision has one | ROM compare | high (leftover), medium (cause) |
| 0x7E9D20: Carrington Institute firing-range data (used); 0x7EBDC0: a segment-2 block loaded by title code (content unknown) | disassembly | medium-high / low |
| V1.1 code: 28 game and 3 lib functions changed. Controller Pak/EEPROM code; BG decompression slack 0x800→0x8000; a Deep Sea-specific check; an audio-library NULL check | relocation-masked function diff `unused/revs/fundiff_U10_U11.txt` | high (what), low–medium (why) |
| E and J setups add or remove no objects or characters (edits inside AI lists and field values); J changes 15 Joanna models and adds the two logo models | setup and file diffs | high |

## 3. Level data

### 3.1 Level catalog and identifiers

#### Tables (verified: ROM data plus disassembly of the users; `stages/stagetable.py`, `stages/menus.py`)

| Table | vaddr (data offset) | Layout | Users |
|---|---|---|---|
| stage table | 0x8007FCC0 (+0x25CE0) | 61 × 0x38 bytes, then a zero record | `stageGetIndex(id)` 0x7F15B00C (loops 61 times); the index is kept at 0x8007FC00 |
| solo mission list | 0x80071E6C (+0x17E8C) | 21 × `SoloMissionRecord` (`0x0C`; below) | 0x7F105438 |
| mission groups | 0x80071F68 (+0x17F88) | 10 × `MissionGroupRecord` (`0x08`; below) | 0x7F10475C |
| Combat Simulator arenas | 0x80084B98 (+0x2ABB8) | 17 × `ArenaRecord` (`0x06`; below) | 0x7F178ED4… |
| arena groups | 0x80084C00 (+0x2AC20) | 3 × `ArenaGroupRecord` (`0x08`; below) | 0x7F178F8C |
| text bank → file | 0x80084124 (+0x2A144) | u16 fileId[69] | `langGetFileNum` 0x7F16E4B4 |
| stage → text bank | code | `switch` in 0x7F16DFA0 (jump table 0x7F1B77C0, stage ids 9..0x50) | setup and briefing loaders |
| per-stage memory arguments | 0x8005D9D8 (8 MiB), 0x8005DBD0 (4 MiB) | `StageMemoryArgs` (`0x08`; below) | lib 0x7000DE28 |

| Structure | Offset | Size | Type | Field | Meaning |
|---|---:|---:|---|---|---|
| `SoloMissionRecord` | `0x00` | 4 | `u32` | `stage` | Stage ID. |
| `SoloMissionRecord` | `0x04` | 1 | `u8` | `unknown04` | Unknown selector `k`. |
| `SoloMissionRecord` | `0x05` | 1 | `u8` | `zero05` | Always zero. |
| `SoloMissionRecord` | `0x06` | 2 | `u16` | `nameId` | Mission-name text ID. |
| `SoloMissionRecord` | `0x08` | 2 | `u16` | `subtitleId` | Subtitle text ID. |
| `SoloMissionRecord` | `0x0A` | 2 | `u16` | `shortNameId` | Short-name text ID. |
| `MissionGroupRecord` | `0x00` | 4 | `u32` | `firstSoloIndex` | First mission index in the group. |
| `MissionGroupRecord` | `0x04` | 2 | `u16` | `textId` | Group label (`Mission 1` through `Mission 9`, then `Special Assignments`). |
| `MissionGroupRecord` | `0x06` | 2 | `u16` | `zero06` | Always zero. |
| `ArenaRecord` | `0x00` | 2 | `u16` | `stage` | Arena stage ID. |
| `ArenaRecord` | `0x02` | 1 | `u8` | `unlock` | Unlock requirement. |
| `ArenaRecord` | `0x03` | 1 | `u8` | `zero03` | Always zero. |
| `ArenaRecord` | `0x04` | 2 | `u16` | `nameId` | Arena-name text ID. |
| `ArenaGroupRecord` | `0x00` | 4 | `u32` | `firstIndex` | First arena index in the group. |
| `ArenaGroupRecord` | `0x04` | 2 | `u16` | `textId` | Group label (`Dark`, `Classic`, or `Random`). |
| `ArenaGroupRecord` | `0x06` | 2 | `u16` | `zero06` | Always zero. |
| `StageMemoryArgs` | `0x00` | 4 | `u32` | `stage` | Stage ID. |
| `StageMemoryArgs` | `0x04` | 4 | `char*` | `args` | Argument string, such as `-ml0 -me0 -mgfx120 -mvtx100 -ma500`. |

**Stage record** (`0x38` bytes):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | `s16` | `stageId` | Verified stage ID. |
| `0x02` | 4 | `u8[4]` | `environment02` | Usually `02 FF 64 64`; Deep Sea uses `08 60 50 C8`. Fog/light semantics are a hypothesis. |
| `0x06` | 2 | `u16` | `unknown06` | Not yet interpreted. |
| `0x08` | 2 | `u16` | `bgFileId` | Verified `bgdata/bg_*.seg` file ID. |
| `0x0A` | 2 | `u16` | `tilesFileId` | Verified collision-tile file ID. |
| `0x0C` | 2 | `u16` | `padsFileId` | Verified pads file ID. |
| `0x0E` | 2 | `u16` | `soloSetupFileId` | Verified `Usetup*Z` file ID. |
| `0x10` | 2 | `u16` | `multiplayerSetupFileId` | Verified `Ump_setup*Z` file ID, used when `[0x8009A2D8] != 0`. |
| `0x12` | 2 | `u16` | `unknown12` | Not yet interpreted. |
| `0x14` | 4 | `f32` | `scale14` | Usually 1.0; 0.1004 for stage `0x36` (`len`). World-scale semantics are a hypothesis. |
| `0x18` | 4 | `f32` | `scale18` | Usually 1.0; 0.5 for stages `0x1C`, `0x27`, `0x2C`, and `0x4C`; copied to a per-player field. |
| `0x1C` | 4 | `f32` | `scale1C` | Usually 100.0; 6.684 for stage `0x36`; `0x7F15C664` returns `scale1C / scale14`. |
| `0x20` | 4 | `u32` | `unknown20` | Hypothesized sky/fog parameter. |
| `0x24` | 4 | `u32` | `unknown24` | Hypothesized sky/fog parameter. |
| `0x28` | 4 | `f32` | `unknown28` | Usually 0.15; hypothesized sky/fog parameter. |
| `0x2C` | 2 | `u16` | `unknown2C` | Example value: `0x02BC`. |
| `0x2E` | 2 | `u16` | `unknown2E` | Example value: `0x0190`. |
| `0x30` | 4 | `u32` | `unknown30` | Hypothesized sky/fog parameter. |
| `0x34` | 4 | `f32` | `unknown34` | Usually 1.0; hypothesized sky/fog parameter. |

**Global variables** (verified by RAM reads in Defection and Skedar):

| Address | Meaning |
|---|---|
| 0x8005D9B4 | current stage (s32; data-segment initial value 0x5A) |
| 0x8005DD54 | pending stage, written by `mainChangeToStage` (0x7000E95C) |
| 0x80099FC0 | `g_Vars`; +0x4B4 holds the stage number again |
| 0x8007FC00 | stage-table index |

#### How a stage loads (verified: disassembly; order confirmed with file-load breakpoints for stages 0x30 and 0x32)

1. `mainChangeToStage(s)` stores the pending stage; the lib main loop moves it to 0x8005D9B4 and applies the
   stage's memory arguments.
2. `langReset` (0x7F00B320) loads the global text banks: Lgun, Lmpmenu, Lpropobj, Lmpweapons, Loptions, Lmisc, plus
   Ltitle for stage 0x5C.
3. `stageLoad` (0x7F167C3C) loads, in order:
   - the tiles file (+0x0A);
   - the BG file in parts (+0x08, `bgInit` 0x7F15B304): a 0x40-byte header, the primary block, then room sections on
     demand;
   - the setup (+0x0E, or +0x10 in multiplayer). The loader converts its section offsets, then loads the stage text
     bank (`LameE`…) and the pads (+0x0C);
   - every prop, character and head model that the setup lists, then the player's body and head.
4. Traces (file ids in load order):
   - Defection: `bg_ame_tilesZ` 0x14C, `bg_ame.seg` 0x1C, `UsetupameZ` 0x126, `LameE` 0x570, `bg_ame_padsZ` 0x14B,
     then 63 model files (`stages/bp_defection_named.tsv`, `fs/trace/defection.tsv`).
   - Skedar arena: 0x178, 0x1E, `Ump_setupoatZ` 0x118, `LoatE` 0x6C0, 0x177 (`stages/bp_skedar_named.tsv`).

A viewer loads a stage from the table in the same way: BG + tiles + pads + (solo or MP) setup, with names from the
text files (*Text files (verified: all 476 parse; `langGet` 0x7F16E584)*).

#### Stage list

**Solo missions** (menu order; names from Loptions, verified):

| # | Stage | Code | In-game name | BG file | Pads / setup |
|---|---|---|---|---|---|
| 1.1 | 0x30 | ame | dataDyne Central - Defection | bg_ame (0x3F560) | ame / Usetupame |
| 1.2 | 0x33 | ear | dataDyne Research - Investigation | bg_ear (0x301F0) | ear / Usetupear |
| 1.3 | 0x22 | ark | dataDyne Central - Extraction | **bg_ame** | ark / Usetupark |
| 2 | 0x2C | eld | Carrington Villa - Hostage One | bg_eld (0x38F30) | eld / Usetupeld |
| 3.1 | 0x1D | pete | Chicago - Stealth | bg_pete (0x1E180) | pete / Usetuppete |
| 3.2 | 0x1E | depo | G5 Building - Reconnaissance | bg_depo (0x19B60) | depo / Usetupdepo |
| 4.1 | 0x2F | lue | Area 51 - Infiltration | bg_lue (0x71ED0) | lue / Usetuplue |
| 4.2 | 0x35 | lip | Area 51 - Rescue | **bg_lue** | lip / Usetuplip |
| 4.3 | 0x19 | tra | Area 51 - Escape | **bg_lue** | tra / Usetuptra |
| 5.1 | 0x27 | cave | Air Base - Espionage | bg_cave (0x2E6D0) | cave / Usetupcave |
| 5.2 | 0x31 | rit | Air Force One - Antiterrorism | bg_rit (0x41FE0) | rit / Usetuprit |
| 5.3 | 0x1C | azt | Crash Site - Confrontation | bg_azt (0x2ACA0) | azt / Usetupazt |
| 6.1 | 0x21 | dam | Pelagic II - Exploration | bg_dam (0x4D0C0) | dam / Usetupdam |
| 6.2 | 0x38 | pam | Deep Sea - Nullify Threat | bg_pam (0x56C70) | pam / Usetuppam |
| 7 | 0x2D | imp | Carrington Institute - Defense | **bg_dish** | imp / Usetupimp |
| 8 | 0x34 | lee | Attack Ship - Covert Assault | bg_lee (0x4BDC0) | lee / Usetuplee |
| 9 | 0x2A | sho | Skedar Ruins - Battle Shrine | bg_sho (0x36F00) | sho / Usetupsho |

**Special Assignments:**

| Stage | Code | Name | BG | Pads / setup |
|---|---|---|---|---|
| 0x37 | wax | Mr. Blonde's Revenge | bg_ame | **ame** / Usetupwax |
| 0x09 | sev | Maian SOS | bg_lue | sev / Usetupsev |
| 0x16 | stat | WAR! | bg_sho | stat / Usetupstat |
| 0x4F | ate | The Duel | bg_dish | ate / Usetupate |

**Hub:** 0x26 `dish` Carrington Institute (bg_dish 0x28C00). The title screen's exit goes to 0x26 (verified by
disassembly).

**Combat Simulator arenas** (menu order; the unlock byte is non-zero for arenas unlocked by challenges):

| Group | Arenas (stage, code) |
|---|---|
| Dark | Skedar 0x32 oat · Pipes 0x29 crad · Ravine 0x17 arec · G5 Building 0x20 cryp · Sewers 0x42 mp10 · Warehouse 0x3C mp4 · Grid 0x47 mp15 · Ruins 0x41 mp9 · Area 52 0x3B mp3 · Base 0x39 mp1 · Fortress 0x44 mp12 · Villa 0x45 mp13 · Car Park 0x3D mp5 |
| Classic (GoldenEye arenas) | Temple 0x25 jun · Complex 0x1F ref · Felicity 0x43 mp11 |
| Random | stage 0x01 (not a level) |

**Stages without a BG** (no BG work is done for them; loaders reject stage ids ≥ 0x5A):

| Stage | Meaning | Status |
|---|---|---|
| 0x5A | title screen / attract | verified |
| 0x5B | boot Controller Pak menu (hold START at power-on) | verified by code constants (`li a0,91` in 6 places, *Debug features left in the retail code*) |
| 0x5C | end credits (loads Ltitle) | verified: a forced load shows the credits (*Cut, test and unfinished stages*) |
| 0x5D | menu without Expansion Pak | verified by code constants (`li a0,93` in 4 places); not load-tested |

**Table entries with no menu entry:**
- **Real geometry:**
  - 0x14 `silo` (the Skedar arena's BG, tiles and pads, stub setups);
  - 0x1B `sevb` (the Carrington Institute BG with a stub pads file);
  - 0x2E `ash` (a 0x660-byte BG).
- **Stub BGs** (0x200 bytes): 0x18, 0x1A, 0x23, 0x24, 0x28, 0x2B, 0x36, 0x4D, 0x4E, 0x50, and 10 unused multiplayer
  slots (mp2, mp6–8, mp14, mp16–20).

These appear in the unused-content catalogue in *Unused and hidden content*.

#### Text files (verified: all 476 parse; `langGet` 0x7F16E584)

- **Naming:** 68 topics × 7 language slots. The slots are `L{topic}E`, `J`, `P`, `_str_gZ`, `_str_fZ`, `_str_sZ`
  and `_str_iZ`.
- **Topics:** one per stage code, plus gun, title (the credits), mpmenu, propobj, mpweapons, options (menus and mission
  names) and misc.
- **Container** (decompressed): `u32 offset[n]` with `n` = smallest non-zero offset / 4, each offset relative to the file start
  (0 = no string), followed by NUL-terminated strings padded to 4 bytes.
- **Text id:** `id = bank << 9 | index`. The file is `u16 bankFile[bank]` (at 0x80084124) plus 1 when `[0x80084120]`
  is non-zero.
  - Example: 0x5685 = bank 43 (Loptions) string 133, "dataDyne Central".
- **Encoding in the U ROM:** every string is 7-bit ASCII. P is PAL English, and g/f/s/i are byte copies of P. The J
  slot is an older English draft (*Text and strings*). NTSC code reads slot E, or slot J when `[0x80084120]` is non-zero (the
  `-j` boot argument).
- **E (PAL) ROM:** the g/f/s/i slots hold real German, French, Spanish and Italian (Latin-1).
- **Japanese ROM:** the bank order and most text ids are the same as U. The `L*J` files are Japanese: ASCII plus 2-byte
  glyph codes `c = (lead & 0x7F) << 7 | (trail & 0x7F)`, drawn from a 16×12 4bpp glyph table at J ROM
  `0x178C40 + (c + 24) × 0x60` (verified by disassembly and renders).
- **U vs E/J text ids:** some differ. E and J drop 61 GoldenEye strings from `Lmisc` and move 198 strings from `Lmisc`
  to `Ldish`. Use per-revision text.
- **Dumps:** `unused2/text/{U,E,J}/*.txt` (all ROMs). The first dumper, `stages/text/`, missed every string of the seven `Ldish` files, because string 0 is null: the table length is the smallest non-zero offset / 4, not offset[0] / 4.

### 3.2 Level container

#### Room gfx data (one stream per room; pointers relative to the room pointer)

Header (`0x18` bytes; verified in RDRAM with Defection room 2 at `0x80161470`, relocated as
`base + (pointer − roomPointer)`):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `ptr` | `vertices` | Vertex array. |
| `0x04` | 4 | `ptr` | `colors` | RGBA color array. |
| `0x08` | 4 | `ptr` | `opaqueBlocks` | Opaque block tree. |
| `0x0C` | 4 | `ptr` | `translucentBlocks` | Translucent block tree, or zero. |
| `0x10` | 2 | `s16` | `lightsIndex` | First room-light index. |
| `0x12` | 2 | `s16` | `lightCount` | Room-light count. |
| `0x14` | 2 | `s16` | `vertexCount` | Set at load. |
| `0x16` | 2 | `s16` | `colorCount` | Set at load. |

The header is followed by `0x14`-byte block records. Leaf records use:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 1 | `u8` | `type` | Zero for a leaf. |
| `0x01` | 3 | byte array | `padding01` | Alignment padding. |
| `0x04` | 4 | `ptr` | `nextSibling` | Next block at the same tree depth. |
| `0x08` | 4 | `ptr` | `displayList` | Display-list pointer. |
| `0x0C` | 4 | `ptr` | `vertices` | Vertex array bound to RSP segment 14. |
| `0x10` | 4 | `ptr` | `colors` | Color array bound to RSP segment 13. |

Parent records use:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 1 | `u8` | `type` | One for a parent. |
| `0x01` | 3 | byte array | `padding01` | Alignment padding. |
| `0x04` | 4 | `ptr` | `nextSibling` | Next block at the same tree depth. |
| `0x08` | 4 | `ptr` | `firstChild` | First child block. |
| `0x0C` | 4 | `ptr` | `splitPlane` | Position and normal coordinates; camera-dependent child ordering is a hypothesis. |
| `0x10` | 4 | `u32` | `zero10` | Unused in parent records. |

- Stream order: header, blocks, vertices, colours, display lists. 4,367 leaves, 542 parents in all BGs.
Vertex record (`0x0C` bytes; verified):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 6 | `s16[3]` | `position` | X, Y, and Z. |
| `0x06` | 1 | `u8` | `flags` | Vertex flags. |
| `0x07` | 1 | `u8` | `colorOffset` | Byte offset, always a multiple of four, added to the current `G_COL` offset. |
| `0x08` | 4 | `s16[2]` | `texcoord` | S and T texture coordinates. |

The color is the `u32 RGBA` value at `colorArray[G_COL offset + colorOffset]`. All offsets are in range in every BG;
RDRAM vertex bytes and renders verify the layout.
- **Colours:** u32 RGBA baked vertex colours. **verified** (RAM colour buffer = file for Defection room 2).

#### Level assembly (`loadLevel`)

1. Stage record (*Tables (verified: ROM data plus disassembly of the users; `stages/stagetable.py`, `stages/menus.py`)*) → BG, pads, setup (solo +0x0E or MP +0x10) file ids.
2. BG (*Level geometry*): one `Mesh` per room (room-local positions), `Instance` = `translate(room.pos)`; sky rooms → `Level.skies`;
   textures from the global store (one viewer texture per number × wrap mode).
3. Setup (*Objects and props*): one `Mesh` per model file (lowest LOD distance band, opaque + xlu batches), one `Instance` per placed
   object with the *Placement (verified against RAM: rotations 238/285, positions 257/285; doors 45/46 and 44/46)* matrix (column-major, already in world units); layers "props", "doors", "glass", "weapons",
   "characters", "vehicles" and "markers" (spawn pads, MP pads, chr pads when characters are markers).
4. Environment (*How the game draws a frame, environment, fog and sky (verified: 13 RDRAM captures with frame display lists, disassembly)*): `Level.fog`, `Level.clearColor`, sky.
5. `Level.camera`: first SPAWN pad + 112 up, target = eye + look (*Placement (verified against RAM: rotations 238/285, positions 257/285; doors 45/46 and 44/46)*).
6. Optional: tiles as a hidden `collision` layer (*Tiles (collision) and pads (verified: all 60 tiles files parse exactly)*); difficulty filter default Agent.

### 3.3 Geometry

#### Level geometry

The public n64decomp/perfect_dark decompilation was used only as a lead: claims that rest on it alone are marked
hypothesis.

#### At a glance

| | Perfect Dark |
|---|---|
| level unit | stage = one BG file (rooms + portals) + tiles (collision) + pads + setup |
| BG container | 12-byte header, then separate 1173 streams: primary data, one stream per room, texture-number list, per-room bbox/size/light-count table |
| addressing | primary data linked at segment 0x0F (`0x0F000000`); room streams linked at their room pointer (also 0x0F…) |
| geometry | per room a tree of blocks; leaf blocks = display list + 12-byte vertices (room-relative s16) + u32 RGBA colour array |
| microcode | Rare's GBI1-family microcode (F3DEX 1.x/Fast3D opcode numbering; 12-byte `G_VTX 04`, `G_COL 07`, `G_TRI4 B1`, file-only texture macro `C0`) |
| textures | global store of 3,503 textures by number; zlib CI4/CI8 + bitstream formats (8 methods, 9 pixel formats) |
| space | right-handed, +Y up, game units (~cm), no mirroring; world = room position + vertex |
| lighting | baked vertex colours (prelit); environment-mapped surfaces store normals and are lit by room lights at run time |
| totals | 31 non-stub BG files (29 are 0x200-byte stubs); e.g. lue 270 rooms / 36,350 triangles, mp15 32 rooms / 1,562 |

#### BG file container (verified: all 31 non-stub BGs parse exactly to the file end; disassembly of `bgReset` 0x7F15B304..0x7F15B6C4)

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `u32` | `primaryInflatedSize` | Inflated primary-data size `P`. |
| `0x04` | 4 | `u32` | `section2OffsetDelta` | Bytes `S1` from `0x0C` to the section-2 header. |
| `0x08` | 4 | `u32` | `primaryStoredSize` | Padded primary-stream length. |
| `0x0C` | `primaryStoredSize` | rarezip stream | `primaryData` | Primary data. |
| `0x0C + primaryStoredSize` | variable | rarezip stream array | `rooms` | Room `r` begins at `0x0C + primaryStoredSize + (roomPtr[r] - 0x0F000000 - P)` and ends at the next room pointer. |
| `0x0C + S1` | 4 | stream header | `section2Header` | Header defined below. |
| `0x10 + S1` | variable | rarezip stream | `textureNumbers` | Section 2; decoded as the stage's `u16` texture numbers. |
| after section 2 | variable | stream header and rarezip stream | `roomMetadata` | Section 3; header and decoded layout are defined below. |

Sections 2 and 3 use this stream header:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | `u16` | `inflatedSizeFlags` | `0x8000 \| inflatedSize`. |
| `0x02` | 2 | `u16` | `streamLength` | Stored stream length. |

Decoded section 3, where `N` is the BG room-table count:

| Order | Count | Type | Field | Description |
|---:|---:|---|---|---|
| 1 | `N − 1` | `s16[6]` | `roomBounds` | Room-relative minimum XYZ followed by maximum XYZ. |
| 2 | `N − 1` | `u16` | `gfxLengthUnits` | Graphics allocation length in 16-byte units; allocation is `align16(value × 16 + 0x100)`. |
| 3 | `N − 1` | `u8` | `lightCount` | Per-room light count. |

The game reads the file in parts (`fileLoadPart`): the 0x40-byte header, the primary stream, section 2 and 3, then
room streams on demand as rooms become visible (*How a stage loads (verified: disassembly; order confirmed with file-load breakpoints for stages 0x30 and 0x32)*). **Stubs:** 0x200-byte files (one trivial room);
`bg_ash.seg` (0x660, stage 0x2E) holds a single room of 40 triangles.

#### Primary data (inflated; pointers are `0x0F000000 + offset`)

Header (verified: the loader adds `base − 0x0F000000` to words 1..5):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `u32` | `zero00` | Always zero. |
| `0x04` | 4 | `ptr` | `rooms` | Array of `0x14`-byte room records. |
| `0x08` | 4 | `ptr` | `portals` | Array of eight-byte portal records. |
| `0x0C` | 4 | `ptr` | `commands` | Array of eight-byte BG visibility commands. |
| `0x10` | 4 | `ptr` | `lights` | Array of `0x22`-byte lights, or zero. |
| `0x14` | 4 | `ptr` | `unused14` | Zero in retail. |

Room record (`0x14` bytes; verified):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `ptr` | `gfxData` | Link address that also locates the room stream. Entry 0 is zero; the entry after the final room contains only the end pointer. |
| `0x04` | 12 | `f32[3]` | `origin` | Room X, Y, and Z origin. |
| `0x10` | 1 | `u8` | `brightnessMin` | Hypothesized minimum brightness. |
| `0x11` | 1 | `u8` | `brightnessMax` | Hypothesized maximum brightness. |
| `0x12` | 2 | `u16` | `zero12` | Always zero. |

The room count is the number of nonzero entries from entry 1, excluding the final end-marker entry.

Portal record (`0x08` bytes; verified from data and RAM):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | `u16` | `verticesRef` | One-based vertex-list index in file order; zero terminates the portal array. Rewritten to an offset at load. |
| `0x02` | 2 | `s16` | `roomA` | First connected room. |
| `0x04` | 2 | `s16` | `roomB` | Second connected room. |
| `0x06` | 1 | `u8` | `flags` | Portal flags; semantics remain unknown. |
| `0x07` | 1 | — | `padding07` | Padding. |

Portal vertex lists follow the terminating portal:

| Order | Count | Type | Field | Description |
|---:|---:|---|---|---|
| 1 | 1 | `u8` | `count` | Number of points. |
| 2 | 3 | — | `padding` | Float alignment. |
| 3 | `count` | `f32[3]` | `points` | Absolute world-space XYZ coordinates. |

BG visibility command (`0x08` bytes):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 1 | `u8` | `type` | Visibility-language opcode. |
| `0x01` | 1 | `u8` | `length` | Command length. |
| `0x02` | 2 | `u16` | `zero02` | Always zero. |
| `0x04` | 4 | `s32` | `parameter` | Opcode parameter. |

The command count is verified, but the small stack language's semantics are a hypothesis. Most BGs contain only END;
`eld` contains 709 commands. A viewer ignores portals and commands and draws all rooms.

Light record (`0x22` bytes, grouped by room):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | `u16` | `room` | BG room number. |
| `0x02` | 2 | `u16` | `color` | Packed color; interpretation is a hypothesis. |
| `0x04` | 1 | `u8` | `brightness` | Hypothesized brightness. |
| `0x05` | 1 | `u8` | `flags` | Hypothesized flags. |
| `0x06` | 1 | `u8` | `multiplier` | Hypothesized multiplier. |
| `0x07` | 3 | `s8[3]` | `direction` | Hypothesized direction vector. |
| `0x0A` | 24 | `s16[4][3]` | `fixtureQuad` | Four XYZ fixture points. |

Record size, count, and grouping are verified. Fifteen BGs have lights (all solo stages and MP Ruins). They describe
fixtures used for dynamic effects such as shooting lights out; baked lighting does not require them.

#### Coordinates, units, culling (verified)

- Right-handed, **+Y up**, game units; **no X mirroring** (the game's own matrices reproduce the screenshot with the
  file geometry, sign orientation intact). A viewer uses `mirrorX: false`, `vertexScale: 1`.
- Room placement: `world = room.pos + vertex` (identity rotation, no scale). In the Defection frame all 26 BG calls
  used modelview `translate(room.pos − worldOffset)` with one camera-relative offset.
- Projection in the Defection frame: fovY 60°, aspect 320/220, near 10, far 10000; viewport 320×220 centred in the
  320×240 frame. A standing player's eye is 158.8 units above the floor.
- Culling: back faces culled, counter-clockwise front faces (OpenGL convention); lists set `G_CULL_BACK` themselves
  (opaque) or clear culling (most translucent lists). Rendering with the opposite rule removes the helipad floor
  (`bg/renders/defection_a_gamecam_cullfront.png`).
- Stage table +0x18 is 0.5 for Crash Site, Air Base, Villa and stage 0x4C: the game renders the whole world (BG, props,
  characters) at that scale. A viewer ignores it and draws everything in BG units (verified, *How the game draws a frame, environment, fog and sky (verified: 13 RDRAM captures with frame display lists, disassembly)*).

### 3.4 Display lists and render state

#### Display lists (verified: opcode histogram of all 4,367 leaf lists; decoded identically by the frame-DL walker; renders)

| Op | Count | Meaning (PD encoding) |
|---|---|---|
| `04` G_VTX | 37,857 | w0 bits 20–23 = count−1, bits 16–19 = first slot, bits 0–15 = count×12; w1 = `0x0E000000 + offset` (segment 14 = block vertices). 16 slots |
| `07` G_COL | 4,395 | w0 bits 16–23 = (n−1)×4, bits 0–15 = n×4; w1 = `0x0D000000 + offset` (segment 13 = block colours) |
| `B1` G_TRI4 | 90,281 | triangle k (0..3) = (`w1 >> 8k & 15`, `w1 >> (8k+4) & 15`, `w0 >> 4k & 15`); skip triangles with three equal indices |
| `BF` G_TRI1 | 0 | F3D layout, index = byte / 10 (used by models, *Objects and props*) |
| `B6` / `B7` | 1,499 / 4,267 | clear / set geometry mode (F3DEX 1.x bits: CULL_BACK 0x2000; LIGHTING \| TEXTURE_GEN 0x60000 on env-mapped surfaces) |
| `B8` | 4,367 | end |
| `B9` | 5,438 | render mode (shift 3, len 0x1D) |
| `BA` | 19,715 | cycle type, TEXTLOD, TEXTDETAIL, TEXTFILT (bilinear), TEXTLUT |
| `BB` | 14,336 | G_TEXTURE (scale 0xFFFF; level patched at load) |
| `C0` | 22,308 | **file-only texture macro** (NOOP for the RSP), expanded by the game at room load |
| `E7`, `FB`, `FC` | 6,906, 2,142, 6,663 | pipesync, env colour, combiner |
| `E6 F2 F3 F5 FD` | ≤ 8 | pre-expanded tile loads in two lists (ignorable) |

No `G_DL`, `G_MTX`, `G_MOVEWORD`, lights or fog commands occur in BG lists.

**`C0` texture macro** (field layout from the lead, consistent with the expanded list in the frame):

| Word | Bits | Field | Meaning |
|---|---:|---|---|
| `w0` | 31–24 | `opcode` | `0xC0`. |
| `w0` | 23–22 | `sMode` | S wrap mode. |
| `w0` | 21–20 | `tMode` | T wrap mode. |
| `w0` | 19–18 | `offsetMode` | Value 2 applies a half-texel offset. |
| `w0` | 17–14 | `shiftS` | S coordinate shift. |
| `w0` | 13–10 | `shiftT` | T coordinate shift. |
| `w0` | 9 | `flag` | Unknown flag. |
| `w0` | 2–0 | `subcommand` | Texture-load form. |
| `w1` | 31–24 | `minimum` | Minimum/LOD parameter. |
| `w1` | 23–12 | `texture2` | Secondary or detail texture number. |
| `w1` | 11–0 | `texture` | Primary texture number. |

| Field | Value | Meaning |
|---|---:|---|
| `sMode`, `tMode` | 0 | Wrap. |
| `sMode`, `tMode` | 1 | Clamp. |
| `sMode`, `tMode` | 2 | Mirror. |
| `subcommand` | 0 | Detail-tile form; 186 uses. |
| `subcommand` | 1 | Detail-tile form using `texture2`; 89 uses. |
| `subcommand` | 2 | Texture with LOD tiles; approximately 21,100 uses. |
| `subcommand` | 4 | Single tile; 906 uses. |
Verified in the Defection frame: the expansion loads the texture's pool data with `SETTIMG`/`LOADBLOCK`/`LOADTLUT`,
emits one `SETTILE`/`SETTILESIZE` pair per LOD, patches `BB002801` to `BB002001`, and `offset == 2` sets
`SETTILESIZE` uls/ult = 2 (half-texel offset, `F2002002 0007E07E` for 32×32). UV: `u = (s·scale/32 − uls/4)/width`.
Some water/monitor textures get UVs animated by code (hypothesis).

**Render modes and combiners** (verified histogram; decoded from GBI bits):

| Render mode (`B900031D` w1) | Uses (opaque / xlu list) | Batch |
|---|---|---|
| `0C182078` G_RM_PASS + AA_ZB_OPA_SURF2 | 3,154 / 0 | opaque |
| `00502078` AA_ZB_OPA_SURF (1-cycle) | 561 / 0 | opaque |
| `0C1849D8` PASS + AA_ZB_XLU_SURF2 | 0 / 1,269 | blend, no depth write |
| `0C184DD8` PASS + AA_ZB_XLU_DECAL2 | 0 / 299 | blend + decal |
| `00504DD8`, `005049D8` | 0 / 99, 24 | blend decal / blend |
| `0C193078`, `0C192D58`, `0F0A4000`, … | < 20 | cutout (TEX_EDGE), decals |

Combiners: `FC26A004 1F1093FF` (TRILERP then COMBINED×SHADE, 5,080), `FC26A004 1FFC93FC` (alpha 1), `FC121824 FF33FFFF`
(MODULATEIA), `FC127E24 FFFFF9FC` (MODULATE rgb, alpha 1). For the viewer: colour = texture × vertex colour, alpha =
texture alpha × vertex alpha (alpha 1 for the `…93FC`/`…F9FC` forms). At load the game rewrites cycle-1 `G_RM_PASS` to
`G_RM_FOG_SHADE_A` when the stage has fog, and SHADE-alpha combiners take ENV alpha instead (verified: RAM lists vs file in
Crash Site 9/9, Villa 17/17, Pelagic II 8/8; no change on non-fog stages; Attack Ship changes combiners only).

**The viewer's `displaylist.ts` can't run these lists unchanged:** its F3DEX `04` expects 16-byte `Vtx` with the
count in bits 10–15, `07` is unknown to it, `B1` is decoded as TRI2, `C0` is ignored (textures come from the global
store, not from tile uploads in the list), and `texture.ts` masks texture memory to 4 KiB (`TMEM_SIZE`) while PD
textures reach 16 KiB. Recommendation: a PD-specific interpreter ported from `bg/lib/pdbg.ts` `buildRoomBatches`
(~200 lines, emits viewer `Batch`es with texture, blend, depth, cullBack, decal and triSource; reuses `evalCombine`'s
approach for the combiner fold).

### 3.5 Textures and materials

#### Global textures (verified: disassembly, all 3,502 non-empty textures decode, texels identical to RDRAM)

- **List:** ROM 0x1FF7CA0 contains 3,504 eight-byte entries:

  | Offset | Bits | Field | Meaning |
  |---:|---:|---|---|
  | `0x00` | 23–0 | `dataOffset` | Unaligned offset relative to ROM `0x1D65F40`. Texture `n` occupies `[offset[n], offset[n+1])`. |
  | `0x00` | 27–24 | `surfaceType` | Surface classification; name is a hypothesis. |
  | `0x00` | 31–28 | `soundType` | Sound classification; name is a hypothesis. |
  | `0x04` | 31–0 | `detailTiles` | Detail-tile nibbles; interpretation is a hypothesis. |

  Texture numbers at or above 3503 are rejected. BG `C0` macros and model-file commands (`FD…… ABCDnnnn`) refer
  to these entries by number.
- **Header byte:**

  | Bits | Field | Meaning |
  |---:|---|---|
  | 7 | `hasLodData` | Stored LOD data follows. |
  | 6 | `zlib` | Selects the paletted zlib representation. |
  | 5–0 | `numLods` | LOD count, clamped to 5. |
- **zlib (paletted) textures** (2,886) use an MSB-first bit reader:

  | Order | Size | Type | Field | Description |
  |---:|---:|---|---|---|
  | 1 | 1 | `u8` | `format` | 9 = CI8/RGBA16, 10 = CI4/RGBA16, 11 = CI8/IA16, 12 = CI4/IA16. |
  | 2 | 1 | `u8` | `colorCountMinus1` | Stored palette size minus one. |
  | 3 | `2 × colorCount` | `u16[]` | `palette` | RGBA16 or IA16 palette selected by `format`. |
  | 4 | per stored image | image record | `images` | Image record defined below. |

  | Order | Size | Type | Field | Description |
  |---:|---:|---|---|---|
  | 1 | 1 | `u8` | `width` | Stored-image width. |
  | 2 | 1 | `u8` | `height` | Stored-image height. |
  | 3 | variable | rarezip 1173 | `indices` | CI8 uses one byte per texel; CI4 uses one byte per two texels. |

  Without stored LODs, the game generates smaller levels by 2×2 averaging and choosing the nearest palette color;
  total texture-memory use remains at most `0x800` bytes.
- **Bitstream textures** (616) begin each image with this 24-bit header:

  | Bits | Field | Meaning |
  |---:|---|---|
  | 23–20 | `format` | Pixel format listed below. |
  | 19–12 | `width` | Image width. |
  | 11–4 | `height` | Image height. |
  | 3–0 | `method` | Compression method listed below. |

  | Format | Pixel representation |
  |---:|---|
  | 0 | RGBA32 |
  | 1 | RGBA16 |
  | 2 | RGB24 |
  | 3 | RGB15 |
  | 4 | IA16 |
  | 5 | IA8 |
  | 6 | IA4 |
  | 7 | I8 |
  | 8 | I4 |

  | Method | Encoding |
  |---:|---|
  | 0, 1 | Uncompressed. |
  | 2 | Huffman with a shared table. |
  | 3 | Huffman per channel. |
  | 4 | RLE. |
  | 5 | Lookup palette of at most 2,047 colors plus packed indices. |
  | 6 | Huffman lookup. |
  | 7 | RLE lookup. |
  | 8 | Huffman plus blur predictor 0–6 with modular differences. |
  | 9 | RLE plus blur. |

  Exact bit layouts are implemented by `bg/lib/pdtex.ts`, a port that reproduces the game's pool bytes including
  three game bugs.
- **Pool layout:** rows padded to 4 texels/8 bytes, odd rows "swizzled" (halves of each 64-bit word swapped, 16-byte
  halves for 32-bit texels) — the same rule as the viewer's `texture.ts`.
- **RAM check** (Defection, `bg/scripts/texram.ts`): of the stage's 118 textures, 116 found in the pool; LOD 0 +
  palette identical for 115 (1 false hit on a 1×1), all levels identical for 106 (the other 9 are I8 textures whose
  generated levels read an uninitialised variable in the game).
- **Wrap/filter:** wrap from the `C0` macro (wrap/clamp/mirror → `Texture.wrapS/T`), bilinear filtering; mip-maps can
  be approximated from LOD 0. Contact sheets: `bg/renders/textures/{arec,ame,dam,pete,dish,lue}_sec2.png`.

#### Level geometry, textures and environment

| Check | Method | Result | Evidence |
|---|---|---|---|
| BG container, rooms, portals, lights, bboxes | parse of all 31 non-stub BGs with cross-checks (vertices inside boxes, light counts, texture lists, colour offsets, no unknown opcodes) | 0 problems | `bg/renders/overview_all.log`, `bg/renders/{code}_overview.png` |
| BG relocation in RAM | Defection RDRAM: primary data at segment 15, room 2 header and leaf pointers, vertex bytes | match | `runtime/captures/defection_a/ram.bin` |
| microcode | glide64 ucode checksum; 13 frames walked with no unknown opcodes; BG vertices found byte-exact in the frame (98 runs in Defection) | ucode 7 "Perfect Dark" | `runtime/tools/pdwalk.py`, `runtime/captures/*/dl_*.txt` |
| textures | 3,502/3,503 decode; 116 Defection pool textures vs RDRAM | LOD 0 + palette identical 115/116 (1 false hit); all levels 106 (9 hit a game bug) | `bg/scripts/texram.ts`, `bg/dumps/texram_defection_a.json` |
| **game-camera renders** | BG rendered with each frame's own projection, view, world scale and draw offset, next to the screenshot of the same moment | layout, handedness, textures and vertex colours match in all 11 gameplay/cutscene captures (*How the game draws a frame, environment, fog and sky (verified: 13 RDRAM captures with frame display lists, disassembly)* table); sky polygons, particles and HUD are not drawn | `bg/renders/{defection_a,chicago_a,ci_a,crashsite_a,villa_a,pelagic_a,pelagic_intro_cutscene,airbase_a,airbase_b,attackship_a,skedarruins_a,skedarruins_b,mp_skedar_a}_side_by_side.png` |
| culling | same camera, opposite cull rule | the helipad floor disappears | `bg/renders/defection_a_gamecam_cullfront.png` |
| sky rooms | frame modelview of ame room 1, sho room 2, lee room 0x71 = room position with a translation-free projection | exact | frame DLs |
| world scale | room modelviews in Crash Site, Villa, Air Base | 0.5 on the diagonal, constant offset | `bg/scripts/scalecheck.ts` |
| fog replacement | room lists in RAM vs file | Crash Site 9/9, Villa 17/17, Pelagic 8/8 and 10/10: PASS → FOG_SHADE_A; none on non-fog stages | `bg/scripts/fogmodes.py` |
| fog values | frame movewords vs environment table | equal in Crash Site, Villa, Pelagic II | `runtime/captures/*/manifest.json` |
| clear colour, near/far | FILLRECT colour and view struct vs environment record | 6 stages (colour), 13 captures (near/far) | same |
| run-time lighting | RAM colour arrays vs BG file | identical in Defection/CI/Villa; 0.8–0.97 dimming of some entries elsewhere | `runtime/tools/colordiff.py` |
| sky planes and colours | CPU-rasterised RDP triangles decoded from 5 frames vs the model from `skyRender` | W·depth constant per plane; vertex colours within ~2/255; horizon = sky colour | `runtime/tools/rdptri.py`, `skymodel.py`, `runtime/captures/*/sky_compare.png` |
| world-space camera | player struct `+0x1BB0` vs frame eye in 10 stages | `campos − eye/scale` = the constant draw offset per stage, equal to the offsets solved from BG calls | `notes/runtime.md` *How a stage loads (verified: disassembly; order confirmed with file-load breakpoints for stages 0x30 and 0x32)*, `obj/dumps/capture_offsets.json` |

#### Textures

- **Coverage:** 3,188 of the 3,503 global textures are referenced by BG and model files. Code tables in the global
  display-list block and code constants add most of the rest.
- **Unreferenced: 100**, plus 2 referenced only in the decompilation. Sheet: `unused3/renders/textures_unreferenced.png`;
  exact numbers are in its `.txt`. Scan limit: textures chosen by computed numbers would also appear here.

| Textures | Content | Confidence |
|---|---|---|
| 0x1D0, 0x1D1 | handwritten, mirrored white scrawl | high (meaning low) |
| 0x581, 0x582, 0xD2F | photographs of real faces (chin, mouth, ear), not used by any head | high |
| 0x713, 0x71A, 0x71C, 0x873 | warning signs ("no guns", biohazard, worker hazard), a ring gauge | high |
| 0x720–0x722 | three blurry painted portraits | high |
| **0xBA0–0xBC5** (~30) | a jungle/temple set: foliage walls, green marble tiles, red/gold column, stone door panels, palm and fern leaves (hypothesis: a cut stage or GoldenEye Jungle/Temple re-exports; not compared) | high (unused) |
| 0xC17–0xC30 | brick-wall explosion chunks, foliage clumps, pebbles, skin/leather tones | high |
| 0xD02–0xD0E | 13 dark reflection/environment panels | high |
| 0x058 and others | a dotted test grid, noise, bars, a faded face | high |

### 3.6 Collision

#### Tiles (collision) and pads (verified: all 60 tiles files parse exactly)

- **Tiles** (`bg_{code}_tilesZ`, 1173-compressed) begin with:

  | Offset | Size | Type | Field | Description |
  |---:|---:|---|---|---|
  | `0x00` | 4 | `u32` | `roomCount` | BG room count plus one. |
  | `0x04` | `4 × (roomCount + 1)` | `u32[]` | `roomOffset` | File-relative offsets; room `r` spans `[roomOffset[r], roomOffset[r+1])`. |

  Every room contains variable-length collision records beginning with this common header:

  | Offset | Size | Type | Field | Description |
  |---:|---:|---|---|---|
  | `0x00` | 1 | `u8` | `type` | Shape type. |
  | `0x01` | 1 | `u8` | `vertexCount` | Vertex count. |
  | `0x02` | 2 | `u16` | `flags` | Surface and collision flags. |

  Retail files contain only type 0 records (`14 + 6 × vertexCount` bytes):

  | Offset | Size | Type | Field | Description |
  |---:|---:|---|---|---|
  | `0x04` | 2 | `u16` | `floorType` | Surface-material selector. |
  | `0x06` | 6 | `u8[6]` | `extremaIndices` | Vertex indices for minimum and maximum X, Y, and Z. |
  | `0x0C` | 2 | `u16` | `floorColor` | 12-bit `0x0RGB` baked-floor color. |
  | `0x0E` | `6 × vertexCount` | `s16[][3]` | `vertices` | Absolute world-space XYZ coordinates. |

  Loader support also exists for type 1 (floating-point vertices, with 16 extra bytes), type 2 (block), and type 3
  (cylinder), but none occurs in retail.
  - **Survey of the 50 distinct non-empty files** (verified, `../impl/pd_col/explore.ts`):
    - 119,842 tiles, all type 0: 77,104 quads, 42,267 triangles, a few 5–12-gons (convex polygons).
    - The six index bytes name the vertex with the minimum / maximum x, y, z: true for every tile.
    - Every tile lies inside its BG room's section-3 box, so the record's room is the BG room number.
  - **Flags** (names from the lead; bits counted over all tiles):
    - Combinations: 0x1C (83,385: 0x4 wall | 0x8 blocks sight | 0x10 blocks shots) and 0x1B (30,297: floor 0x1 | 0x2
      | 0x8 | 0x10).
    - Other bits: 0x2000 step (2,436), 0x100 slope (195, with 0x80 and wall), 0x40 ladder (127), 0x800 (67) and 0x1000 (4)
      on floors (lead: AI crouch/duck), 0x4000 death (62), 0x200 underwater (38), 0x8000 player-only ladder (37).
      0x20 (lift floor) never occurs.
    - Floor and wall bits against the polygon normal (verified): floor-flagged tiles face up (31,348) or sideways
      (1,722, ramps); wall-flagged ones are vertical (73,461) but also face up (6,867, unwalkable tops) or down (4,588,
      ceilings). So "wall" means any surface that isn't walkable.
  - **floorType**: 0–8 on floors and walls alike. Meaning hypothesis: surface material (footsteps, impacts).
  - **floorColour**: 12-bit `0x0RGB`. It follows the baked vertex colours of the room floor under the tile (verified):
    - brightness correlation 0.82–0.99 (Defection 0.82, Villa 0.95, Pelagic II 0.98, Air Base 0.92, Chicago 0.88, MP
      Skedar 0.99);
    - mean per-channel difference between colour × 17 and the vertex colour 8–24/255 (`../impl/pd_col/floorcolour.ts`).
    - Its run-time use (shading characters standing on it) is a hypothesis (object struct field `floorcol`).
  - **Viewer:** a hidden `collision` layer (`tiles.ts`). Tiles are translucent polygons drawn as decals:
    - floor green, step floor yellow-green, wall orange, ceiling purple, unwalkable top yellow;
    - sight/shot blocker grey-blue, ladder cyan, underwater blue, death red;
    - darker for higher floor types.
    - Overlay renders: `../impl/pd_col/renders/*_overlay.png`.
- **Pads**: *Objects and props*.

### 3.7 Environment, sky, fog, and lighting

#### How the game draws a frame, environment, fog and sky (verified: RDRAM captures with frame display lists, disassembly)

Captures (`runtime/captures/{name}/`: screenshots, 8 MiB RDRAM, walked display lists, `cam.json`, `manifest.json`):

| Capture | Stage | BG | World scale | Near/far | Fog (mul, off) | Clear colour | Game-camera render vs screenshot (`bg/renders/{name}_side_by_side.png`) |
|---|---|---|---|---|---|---|---|
| defection_a | 0x30 Defection | ame | 1 | 10/10000 | – | black | matches (layout, sign, helipad, textures, colours); moon sky room placed as in the frame |
| ci_a | 0x26 Carrington Institute | dish | 1 | 15/10000 | – | (98, 180, 255) | matches (skylight grid, panels, floor) |
| chicago_a | 0x1D Chicago | pete | 1 | 10/10000 | – | black | matches (alley, brick wall, stairs, red door, cobbles) |
| crashsite_a | 0x1C Crash Site | azt | 0.5 | 15/10000 | 21333, −21077 | (156, 41, 24) | layout matches, fog from frame values; orange cloud sky and snow particles missing |
| villa_a | 0x2C Carrington Villa | eld | 0.5 | 15/20000 | 1939, −1865 | (65, 164, 255) | matches incl. distant cliff and haze; clouds and wind turbine (object) missing |
| pelagic_a | 0x21 Pelagic II | dam | 1 | 15/15000 | 25600, −25344 | (41, 57, 98) | matches (pillars, pipes, lit floor) |
| pelagic_intro_cutscene | 0x21 (intro camera, 16:9) | dam | 1 | 15/15000 | 25600, −25344 | (41, 57, 98) | layout matches |
| airbase_a, airbase_b | 0x27 Air Base | cave | 0.5 | 15/20000 | – | (0, 16, 65) | layout matches; night cloud sky and hoverbike missing |
| attackship_a | 0x34 Attack Ship | lee | 1 | 15/10000 | – | black | matches (corridor, door frame) |
| skedarruins_a, _b | 0x2A Skedar Ruins | sho | 1 | 15/10000 | – | (98, 98, 255) | matches incl. gradient sky room |
| mp_skedar_a | 0x32 Combat Simulator Skedar | oat | 1 | 15/10000 | – | black | matches |

With placed objects: `obj/renders/defection_side_by_side.png`, `villa_side_by_side.png`, `crashsite_side_by_side.png`,
`chicago_side_by_side.png`, `bg/renders/ci_a_objects_side_by_side.png` (props at the right place and size).

**Microcode** (verified): the graphics task's ucode text (0x8005A0B0) checksums to 0x47D46E86, which glide64mk2 maps to
its ucode 7 "Perfect Dark"; all 13 frames decode with no unknown opcodes. It is a GBI1-family (Fast3D/F3DEX 1.x
numbering) Rare variant with the vertex/colour/TRI4 changes of *Display lists (verified: opcode histogram of all 4,367 leaf lists; decoded identically by the frame-DL walker; renders)*, plus `B5` TRI2 (index/2), `BE` CULLDL (/40),
Fast3D `MOVEWORD` types (0x06 segment, 0x08 fog, 0x0E perspnorm) and `B4/B2/B3` raw RDP words (CPU-rasterised
triangles for the sky).

**Frame order** (condensed walk of `villa_a`, confirmed in Defection, Crash Site, Air Base):

| # | Pass | Matrices | State |
|---|---|---|---|
| 1 | setup | – | shared state DLs 0x800613A0 (textfilt bilerp, 1-cycle) and 0x80061380 (`ZBUFFER \| SHADE \| SMOOTH`) |
| 2 | Z clear, colour clear | – | viewport 320×220 (centred on 320×240); colour fill 0x0001, then the environment sky colour when non-black |
| 3 | sky | sky projection (near 3), camera rotation only | Defection: ~34 two-pixel FILLRECT stars; Air Base/Villa/Crash Site: FILLRECT + CPU-built textured RDP triangles (clouds) (*Sky*) |
| 4 | world rooms (opaque) | projection slot = V·P; modelview = `worldScale · T(roomOrigin)` | render mode `C8102078` (fog) or `C4112078`; G_FOG when the stage has fog; each room scissored to its portal box |
| 5 | props and characters, interleaved with rooms | P + full modelview (characters 0.1 × body scale × world scale) | `C4112078`; G_LIGHTING + TEXGEN on some parts |
| 6 | translucent room lists | V·P | `C41049D8` |
| 7 | gun/hands, HUD | own projections | – |

**Camera convention** (verified): N64 row-vector `clip = v · MV · PROJ`; `P = guPerspective(fovy 60, aspect 320/220,
near, far)`; `V` rigid. A room vertex p reaches clip space as `(s · (p + roomOrigin − offset)) · V · P` where `s` =
stage world scale (stage table +0x18: 0.5 for Crash Site, Air Base, Villa and stage 0x4C) and `offset` a per-frame
draw-world offset: constant across all BG calls of a frame and across captures of the same stage, e.g. Defection
(71, 3003, 0). BG file coordinates are world coordinates: the player struct's camera `[0x8009A244]+0x1BB0` equals
`eye/s + offset` in all 10 stages checked, and setup and pad positions use the same space. The world camera in BG units
is therefore `eye/s + offset`; the eye is 159 BG units above the floor in all 11 gameplay captures. **The world scale scales
everything (BG, props, characters, held weapons) uniformly: a viewer draws BG and objects unscaled in BG units**
(verified: villa placement vs RAM 272/334 exact, crash-site model matrices = 0.5 × gameplay scale).

##### Environment table (verified: disassembly 0x7F165D40/0x7F16574C/0x7F165A0C, ROM data, RAM live struct = record in every capture)

`envChoose(stage, allowOverride)` (0x7F165D40) looks up `stage + 900` (if allowed) or `stage` in the **fog table**
(0x80081164, 0x2C-byte records, s16 id, 0-terminated). If found it applies the record with fog on; otherwise it uses
the **no-fog table** (0x800813CC, 0x38-byte records, s32 id, first record id −1 = default). Both fill the live struct
0x80081058 and call `0x7000BE84(near, far)`.

Fog record (`0x2C` bytes):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | `s16` | `id` | Stage or override identifier. |
| `0x02` | 2 | `s16` | `near` | Near plane. |
| `0x04` | 2 | `s16` | `far` | Far plane. |
| `0x06` | 2 | `s16` | `unknown06` | Unknown. |
| `0x08` | 2 | `s16` | `unknown08` | Unknown. |
| `0x0A` | 2 | `s16` | `vec` | Environment vector parameter. |
| `0x0C` | 2 | `s16` | `fogMin` | Fog-range minimum. |
| `0x0E` | 2 | `s16` | `fogMax` | Fog-range maximum. |
| `0x10` | 3 | `u8[3]` | `skyColor` | Sky RGB. |
| `0x13` | 1 | `u8` | `numSuns` | Sun count. |
| `0x14` | 4 | `ptr` | `suns` | Pointer to sun records. |
| `0x18` | 1 | `u8` | `cloudsOn` | Enables clouds. |
| `0x19` | 1 | — | `padding19` | Alignment. |
| `0x1A` | 2 | `s16` | `cloudsScale` | Cloud scale. |
| `0x1C` | 1 | `u8` | `cloudsType` | Cloud texture/type selector. |
| `0x1D` | 3 | `u8[3]` | `cloudColor` | Cloud RGB. |
| `0x20` | 1 | `u8` | `waterOn` | Enables water. |
| `0x21` | 1 | — | `padding21` | Alignment. |
| `0x22` | 2 | `s16` | `waterScale` | Water scale. |
| `0x24` | 1 | `u8` | `waterType` | Water texture/type selector. |
| `0x25` | 3 | `u8[3]` | `waterColor` | Water RGB. |
| `0x28` | 1 | `u8` | `waterOffset` | Water offset. |
| `0x29` | 3 | — | `padding29` | Tail padding. |

No-fog record (`0x38` bytes):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `s32` | `id` | Stage identifier; -1 is the default record. |
| `0x04` | 2 | `s16` | `near` | Near plane. |
| `0x06` | 2 | `s16` | `far` | Far plane. |
| `0x08` | 2 | `s16` | `unknown08` | Unknown. |
| `0x0A` | 2 | `s16` | `unknown0A` | Unknown. |
| `0x0C` | 2 | `s16` | `vec` | Environment vector parameter. |
| `0x0E` | 3 | `u8[3]` | `skyColor` | Sky RGB. |
| `0x11` | 1 | `u8` | `numSuns` | Sun count. |
| `0x12` | 2 | — | `padding12` | Pointer alignment. |
| `0x14` | 4 | `ptr` | `suns` | Pointer to sun records. |
| `0x18` | 1 | `u8` | `cloudsOn` | Enables clouds. |
| `0x19` | 3 | `u8[3]` | `cloudColor` | Cloud RGB. |
| `0x1C` | 4 | `f32` | `cloudsScale` | Cloud scale. |
| `0x20` | 2 | `s16` | `cloudsType` | Cloud texture/type selector. |
| `0x22` | 1 | `u8` | `waterOn` | Enables water. |
| `0x23` | 3 | `u8[3]` | `waterColor` | Water RGB. |
| `0x26` | 2 | — | `padding26` | Float alignment. |
| `0x28` | 4 | `f32` | `waterScale` | Water scale. |
| `0x2C` | 2 | `s16` | `waterType` | Water texture/type selector. |
| `0x2E` | 2 | — | `padding2E` | Float alignment. |
| `0x30` | 4 | `f32` | `waterOffset` | Water offset. |
| `0x34` | 4 | `s32` | `flag` | Environment flag. |

Sun record (`0x14` bytes):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 1 | `u8` | `lensflare` | Lens-flare selector or enable flag. |
| `0x01` | 3 | `u8[3]` | `color` | Sun RGB. |
| `0x04` | 12 | `f32[3]` | `direction` | Direction vector, with components on the order of one million. |
| `0x10` | 2 | `u16` | `unknown10` | Unknown. |
| `0x12` | 2 | `u16` | `unknown12` | Unknown. |
All records are decoded in `runtime/envtable.json` (`runtime/tools/envtable.py`). Menu stages:

| Stage | Near/far | Sky/clear colour | Fog min..max | Suns | Clouds (rgb, scale) | Water |
|---|---|---|---|---|---|---|
| 0x1C Crash Site | 15/10000 | (155, 45, 30) | 994..1000 | 1 | on (250, 250, 0) 1500 | off |
| 0x21 Pelagic II | 15/15000 | (45, 62, 96) | 995..1000 | 0 | on (240, 240, 240) 5000 | off |
| 0x2C Villa | 15/20000 | (70, 160, 255) | 981..1047 | 1 | on (255, 255, 255) 5000 | off |
| 0x27 Air Base | 15/20000 | (0, 16, 64) | – | 1 | on (255, 255, 255) 5000 | off |
| 0x31 Air Force One | 15/20000 | (0, 16, 64) | – | 0 | on (255, 255, 255) 5000 | **on** (255, 255, 255) type 2 |
| 0x26 CI, 0x2D CI Defense, 0x4F The Duel | 15/10000 (Duel 10) | (101, 178, 255) | – | 1 | off | off |
| 0x2A Skedar Ruins, 0x16 WAR! | 15/10000 | (101, 101, 255) | – | 3 | off | off |
| 0x2F Infiltration, 0x19 Escape | 15/12000, 15/10000 | black | – | 1 | off | off |
| 0x30 Defection, 0x22 Extraction, 0x37 Mr. Blonde | 10/10000 | black | – | 0 | off | off |
| 0x1D Chicago | 10/10000 | black | – | 0 | on (80, 40, 10) | off |
| 0x33 Investigation, 0x1E G5, 0x35 Rescue, 0x09 Maian SOS, 0x34 Attack Ship, 0x38 Deep Sea | 15/10000 | black ((5,0,0) Deep Sea) | – | 0 | off | off |
| arenas | 15/10000 (Base 15/20000, Felicity 10/10000) | black or near-black; Temple (0, 16, 128); Villa arena (136, 136, 220) | – | 0 | mostly on, arena-specific colours | Temple off |
| default (−1) | 15/10000 | (0, 16, 64) | – | 0 | off | off |

Also present (no menu stage): fog records for 0x24 and 0x2B (`sevx`/`sevxb` slots), override ids 0x3A5 (= Pelagic
+ 900) and 0x3AF, and ids 200/238/300/338/400/438; no-fog records for 0x18, 0x1A (water on), 0x1B, 0x23, 0x2E,
0x36 (sky (48, 64, 16)), 0x14, 0x3A, 0x3E–0x40, 0x46–0x4C. The stage table's +0x2C/+0x2E fields are not fog (Villa uses
981..1047 from the fog table).

##### Fog and clear colour (verified: frame movewords equal the formula in 3 stages; clear colour in 6)

- Fog only for stages in the fog table: rooms get G_FOG and the cycle-1 fog render mode (*Display lists (verified: opcode histogram of all 4,367 leaf lists; decoded identically by the frame-DL walker; renders)*), and the frame
  sets `gSPFogPosition(fogMin, fogMax)`: `multiplier = 128000/(max − min)`, `offset = (500 − min)·256/(max − min)`
  (Crash Site 994..1000 → 21333/−21077, Villa 981..1047 → 1939/−1865, Pelagic 995..1000 → 25600/−25344, all equal to
  the frames). Fog colour = sky colour. The viewer's `Fog` type takes these directly with `near`/`far` = the stage's
  near/far **in game (render) units**; for the half-scale stages divide near/far by the world scale when the viewer
  draws in BG units (hypothesis on the conversion; the depth values themselves are verified).
- `Level.clearColor` = sky colour (black stages clear to black).
- Some rooms use a darker fog colour with alpha < 0xFF (hypothesis: per-room brightness); non-fog stages set odd
  `SETFOGCOLOR` values without G_FOG (unused by the viewer).

##### Sky
Verified by disassembly (`skyRender` 0x7F11F754) and against the RDP primitives decoded from Air Base (two frames),
Villa, Crash Site and Air Force One (`runtime/tools/rdptri.py`, `skymodel.py`):

- **Order:** clear to the sky colour → sky → world. If `cloudsOn` is 0, the sky is just that fill. Otherwise the sky
  colour is filled below the horizon line, and above it the CPU emits "shade + texture, no Z" RDP triangles
  (command 0xCE via `B4/B2/B3`).
  - Defection's star field is about 34 two-pixel FILLRECTs (hypothesis: a separate star routine).
  - Fog stages use the same sky; fog affects only world geometry.
- **Geometry: two horizontal planes.**
  - Clouds: `t = (cloudHeight − cam.y) / dir.y`, where `cloudHeight` = env +0x14 (fog record +0x1A, no-fog record
    +0x1C). It is a world height: 5000 on most stages, 1500 on Crash Site.
  - Water below the horizon (dir.y < 0): `waterHeight` = env +0x2C, e.g. −5000 on Air Force One and −1850 on
    Villa/Temple (drawn only when `waterOn`).
  - Horizontal distance is clamped to 300000.
  - Verified: `W · depth` is constant over each primitive, as for a plane at that height.
  - The camera is the player struct's `+0x1BB0` position, in world (BG) units.
- **Colour** (0x7F11F208, verified to about 2/255 at every decoded corner):
  - `frac = 1 − min(1, 2·|dir.y| / sqrt(dir.x² + dir.z² + 0.0001))`;
  - `rgb = sky + cloud·(1 − sky/255)·(1 − frac)`, Gouraud-shaded;
  - water likewise with the water colour.
- **Combiner:** clouds `fc40fe81 55fef97c` = `(SHADE − ENV)·TEXEL0 + ENV` with ENV = the sky colour, render mode
  `00552048`, so a texel of 0 shows the sky colour. Water: `TEXEL0·SHADE`.
- **Textures:** from a 12-byte texture list at `[0x800AB598]`, indexed by `cloudsType`/`waterType`.
  - Cloud type 0 is a 64×64 IA8 texture, wrap, bilinear (identical in all captured stages).
  - Water type 2 (Air Force One) is CI4 with mip levels.
  - Global texture numbers not resolved: the list holds RAM pointers once loaded.
- **Mapping:** `S/W = k·x`, `T/W = −k·z` in world coordinates with `k = 3.04e−6` on four frames, i.e. about 320 world
  units per texel. Scroll: `[0x8007DB80]` grows by 1 per 60 Hz frame, wraps at 4096, and is added to z. The exact texel
  phase and the texture's axis order are hypotheses.
- **Suns** (0x7F12583C, disassembly only): the sun direction is projected and eight Z-buffer samples decide
  visibility. A textured sprite is drawn in the sun colour, with flare artefacts from 0x7F126154. Not seen in a frame.
- **Prototype:** `runtime/tools/skyrender.py`, with `runtime/captures/{villa_a,airbase_a,crashsite_a,airforceone_a}/sky_compare.png`
  (screenshot | render). Colours, gradient and horizon match; the cloud pattern is the right texture and scale but not
  pixel-identical; water is untextured.
- **For the viewer:** clear colour = sky colour. `Level.skies`: one camera-centred disc mesh that follows the camera in
  x and z but not in y.
  - Placed at `cloudHeight − camY`, radius 300000, tessellated radially.
  - Vertex colours from the formula above, drawn first without depth or fog.
  - IA8 texture with `u = x/320, v = −z/320` in world x/z, so the pattern stays fixed in the world; optional scroll.
  - A mirrored disc at `waterHeight` when water is enabled.
  - Sky rooms (Defection moon, Skedar Ruins gradient, Attack Ship) are extra entries in `Level.skies`.

#### Lighting at run time (verified: RAM colour arrays vs BG file in 9 stages)

| Capture | Room VTX runs | Colour arrays identical to the file | Modified in RAM |
|---|---|---|---|
| defection_a | 98 | 98 | 0 |
| ci_a | 35 | 35 | 0 |
| villa_a | 108 | 108 | 0 |
| chicago_a | 86 | 85 | 1 |
| crashsite_a | 67 | 38 | 29 |
| skedarruins_a | 137 | 95 | 42 |
| airbase_a | 104 | 46 | 58 |
| pelagic_a | 94 | 26 | 68 |
| attackship_a | 37 | 13 | 24 |

- Baked: BG vertex colours are the full-brightness prelit colours; Defection, CI and Villa draw them unmodified.
- Run time: in other stages some colour-array entries are CPU-modified copies with RGB scaled by 0.8–0.97 and alpha
  untouched (e.g. Skedar Ruins `fefefeff → d2d2d2ff` next to unchanged entries). Hypothesis: PD's dynamic room lighting
  (light levels, flicker, shot-out lights, driven by the BG light records and room brightness fields).
- No room colour multiplier through the combiner (room combiner texel × shade, env colour white).
- Environment-mapped BG surfaces and props/characters use G_LIGHTING with ambient + one directional light per model
  set by code (hypothesis on the light source).
- **For the viewer: use the file's vertex colours.** That is exactly what 3 of 9 stages draw and within 0.8–1.0 of the
  others.

### 3.8 Cameras and paths

## 4. Objects

### 4.1 Placement records

#### Placement (verified against RAM: rotations 238/285, positions 257/285; doors 45/46 and 44/46)

Mismatches are all expected: chr-held weapons/shields, lifts and hovercars (moved at run time), 4 consoles and 2
stacked crates (floor raycast finds a different floor).

**Generic objects** (`obj/lib/place.ts placeGeneric`):
1. `ms = modelState.scale / 4096`. `centre = pad.pos`; if the pad has a bbox: `centre = padCentre(pad)` moved to the
   bbox bottom (`centre += 0.5·(ymin − ymax)·up`).
2. Rotation `R` = **columns (normal, up, look)** (local X → up × look, Y → up, Z → look). Pitfall: the game's look-at
   helper writes these as rows; objects use the transpose (verified: 238 vs 69 matches).
3. Pad bbox fit (only with a pad bbox): `r = (1,1,1)`; flag 0x20 `r0 = padX/(modelX·ms)`; 0x40 `r1 = padY/(modelY·ms)`
   (with flag 0x2: `r2 = padZ/(modelY·ms)`); 0x80 `r2 = padZ/(modelZ·ms)` (with 0x2: `r1 = padY/(modelZ·ms)`);
   `max = max(r)`; unfitted axes with model extent 0 take `max`; `r /= max` (values ≤ 1e−6 become 1).
4. Columns `*= r`, then all columns `*= ms · max · extraScale/256`.
5. Stand on floor: flag 0x2: `R = R·rotY(π)·rotX(3π/2)`, `pos = centre − col2·zmin`; flag 0x4: `R = R·rotZ(π)`,
   `pos = centre − col1·ymax`; flag 0x8: `pos = centre − col1·ymin`; else take the column with the largest |y|,
   `lo` = that axis' bbox min (max if negative), `pos = centre − col·lo`, then `pos.y = floorY − col.y·lo + 4`
   (+0 for weapons). The pad height as floorY matches 67 of 70 BASIC objects (the game raycasts the collision).
6. **Draw the model with its root joint at the object position** (ignore the root POSITION offset): verified for 25/25
   objects with a non-zero root offset (e.g. `Pdd_windowZ` root (6875, −13833, 10917)).

**Doors** (`placeDoor`): `R = L·rotZ(90°)·rotX(90°)` (local X → up, Y → look, Z → normal); column scales `padY/modelX`,
`padZ/modelY`, `padX/modelZ` (no model-state scale); `pos = padCentre`; drawn closed.

**Characters:** pad position, yaw = `atan2(look.x, look.z)`, scale `0.1 × body.scale`, body + head at HEADSPOT, root
lifted by the stand frame's root height (*Animations and standing characters (verified: lib `anim.c` disassembly, all 1,207 table records, joint matrices vs RAM)*).

**Matrices:** PD's Mtxf is column-major (`f[col·4 + row]`), `0x700159FC(a, b)` = `b = a·b`; rotX/Y/Z at
0x700162E8/0x70016374/0x70016400. World space = BG space (right-handed, +Y up, no mirror).

**Start camera** (verified in one capture): Defection SPAWN pad 467 at (−4, 47, −4) looking +X; the game camera in
RAM stood at (14.9, 159, −20.8) facing (1.0, 0.0002, −0.003): **eye = spawn pad + ~112 units up** (159 above the
helipad floor), looking along the pad's look vector.

**Comparison with the game:** `obj/renders/defection_side_by_side.png` (screenshot | BG + all placed objects through
the frame's matrices): the sculpture, helipad markings, towers and light beams line up; `defection_obj_chr12.png` vs
`defection_noobj_chr12.png`: the lobby reception desk gains its two monitors and plants exactly on the desk.

### 4.2 Object and model formats

#### Objects and props

Placement was checked against the 285 placed objects in the
Defection RDRAM capture (`obj/scripts/compare_ram.ts`).

#### Where things are (verified: disassembly, data, RAM)

| Thing | Address / file |
|---|---|
| stage setup globals `g_StageSetup` | 0x8009D030; fields listed below |
| setup command lengths | `setupGetCmdLength` 0x7F091E10 (types 1..0x3B) |
| setup loop (creates props) | 0x7F00F5C0..0x7F0102B8 (jump table 0x7F1A7E28) |
| generic object placement | 0x7F00CEE4 → `objInit` 0x7F06A730 |
| door setup | 0x7F00E368 |
| chr spawn | 0x7F02D4FC → body/head model 0x7F02CE8C |
| intro command parser | 0x7F0118F4 |
| model table `g_ModelStates` | data 0x8007B06C: 441 × `ModelState` (`0x08`; below) |
| bodies/heads `g_HeadsAndBodies` | data 0x8007CF04: 151 × `HeadBodyRecord` (`0x14`; below) |
| skeletons | data 0x80089990 (NULL-terminated pointers to records beginning with an `s16` ID) |
| model loader | 0x7F1A7604(fileId) → 0x7F1A7554: load, skeleton fix-up, relocate from 0x05000000 (0x70022A24), texture rewrite (0x7F175480) |
| animations | ROM 0x1A15C0..0x7CD1A0 + table 0x7CD1A0..0x7D0A40 (*Animations and standing characters (verified: lib `anim.c` disassembly, all 1,207 table records, joint matrices vs RAM)*) |

`g_StageSetup` fields:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `ptr` | `waypoints` | Waypoint table. |
| `0x04` | 4 | `ptr` | `waygroups` | Waypoint-group table. |
| `0x08` | 4 | `ptr` | `covers` | Cover table. |
| `0x0C` | 4 | `ptr` | `intro` | Intro-command list. |
| `0x10` | 4 | `ptr` | `props` | Prop-command list. |
| `0x14` | 4 | `ptr` | `paths` | Path table. |
| `0x18` | 4 | `ptr` | `aiLists` | AI-list table. |
| `0x1C` | 4 | `ptr` | `padsFile` | Loaded pads file. |

| Structure | Offset | Size | Type | Field | Description |
|---|---:|---:|---|---|---|
| `ModelState` | `0x00` | 4 | `ptr` | `modelDef` | Zero in ROM; populated at runtime. |
| `ModelState` | `0x04` | 2 | `u16` | `fileId` | Model file ID. |
| `ModelState` | `0x06` | 2 | `u16` | `scale4096` | Scale multiplied by 4096. |
| `HeadBodyRecord` | `0x00` | 2 | `u16` | `flags` | Head/body flags. |
| `HeadBodyRecord` | `0x02` | 2 | `u16` | `fileId` | Model file ID. |
| `HeadBodyRecord` | `0x04` | 4 | `f32` | `scale` | Model scale. |
| `HeadBodyRecord` | `0x08` | 4 | `f32` | `animationScale` | Animation scale. |
| `HeadBodyRecord` | `0x0C` | 4 | `ptr` | `modelDef` | Runtime model-definition pointer. |
| `HeadBodyRecord` | `0x10` | 2 | `u16` | `handFileId` | Hand model file ID. |
| `HeadBodyRecord` | `0x12` | 2 | `u16` | `unknown12` | Unknown. |

#### Pads file `bgdata/bg_<code>_padsZ` (verified: `padUnpack` 0x7F115A30 disassembly field by field; all 37 populated pads files parse)

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `+0x00` | 4 | `s32` | `numPads` | — |
| `+0x04` | 4 | `s32` | `numCovers` | — |
| `+0x08` | 4 | `s32` | `waypointsOffset` | — |
| `+0x0C` | 4 | `s32` | `waygroupsOffset` | — |
| `+0x10` | 4 | `s32` | `coversOffset` | — |
| `+0x14` | `2 × numPads` | `u16[]` | `padOffset` | File offsets of pad records. |

Each `padOffset` selects a variable-length pad record:

| Order | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 1 | 4 | packed `u32` | `header` | `flags = header >> 14`; `room` is signed bits 13–4 and is always -1 in ROM; `lift = header & 0xF`. |
| 2 | 8 or 12 | vector | `position` | With `INTPOS` flag `0x1`, three `s16` coordinates plus two padding bytes; otherwise three `f32` coordinates. |
| 3 | 0 or 12 | vector | `up` | Flags `0x2`, `0x4`, or `0x8` select +X, +Y, or +Z, with `0x10` negating it; otherwise stored as three `f32` values. |
| 4 | 0 or 12 | vector | `look` | Flags `0x20`, `0x40`, or `0x80` select +X, +Y, or +Z, with `0x100` negating it; otherwise stored as three `f32` values. |
| 5 | 0 or 24 | bounds | `bbox` | Flag `0x200` stores six `f32` values in `xmin, xmax, ymin, ymax, zmin, zmax` order; otherwise all limits default to -100 and 100. |

The local normal is `up × look`. Bounding-box X follows the normal, Y follows `up`, and Z follows `look`; the center
is `position + 0.5 × ((xmin+xmax) × normal + (ymin+ymax) × up + (zmin+zmax) × look)`.

Cover record (`0x1C` bytes):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 12 | `f32[3]` | `position` | World position. |
| `0x0C` | 12 | `f32[3]` | `look` | Facing vector. |
| `0x18` | 2 | `u16` | `flags` | Cover flags. |
| `0x1A` | 2 | `u16` | `unknown1A` | Unknown. |

Waypoint record (hypothesis; repeated until `padnum < 0`):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `s32` | `padnum` | Pad number; a negative value terminates the array. |
| `0x04` | 4 | `s32` | `neighboursOffset` | Offset of the neighbor list. |
| `0x08` | 4 | `s32` | `groupnum` | Waypoint-group number. |
| `0x0C` | 4 | `s32` | `step` | Step value. |
Pad positions are world coordinates (verified by RAM object positions).

#### Setup files `Usetup<code>Z`, `Ump_setup<code>Z` (verified)

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `u32` | `waypoints` | Zero in the file; populated from the pads file at runtime. |
| `0x04` | 4 | `u32` | `waygroups` | Zero in the file; populated from the pads file at runtime. |
| `0x08` | 4 | `u32` | `covers` | Zero in the file; populated from the pads file at runtime. |
| `+0x0C` | 4 | `u32` | `intro offset` | — |
| `+0x10` | 4 | `u32` | `props offset (0x20)` | — |
| `+0x14` | 4 | `u32` | `paths offset` | — |
| `+0x18` | 4 | `u32` | `aiListsOffset` | AI-list offset. |
| `+0x1C` | 4 | `u32` | `zero1C` | Always zero. |
- **Props list** (from +0x10): commands until type 0x34 END; the **low byte of the first word is the type**; length in
  32-bit words per type from `setupGetCmdLength` (every populated setup's list ends exactly at its intro offset).
- **Links** between commands are relative command indices (`target = index + value`).
- Stub setups are 0x40 bytes. Path and AI-list entries are:

  | Structure | Offset | Size | Type | Field | Description |
  |---|---:|---:|---|---|---|
  | Path | `0x00` | 4 | `u32` | `padsOffset` | Offset of the path's pad list. |
  | Path | `0x04` | 1 | `u8` | `id` | Path identifier. |
  | Path | `0x05` | 1 | `u8` | `flags` | Path flags. |
  | Path | `0x06` | 2 | `u16` | `length` | Pad-list length. |
  | AI list | `0x00` | 4 | `u32` | `offset` | AI bytecode offset. |
  | AI list | `0x04` | 4 | `s32` | `id` | AI-list identifier. |

  (layout hypothesis; the AI bytecode was only decoded far enough for the music commands, *Unused and hidden content*).

| Type | Name | Words | Count in all setups | Viewer |
|---|---|---|---|---|
| 0x01 | DOOR | 55 | 1,303 | mesh (closed) |
| 0x02 | DOORSCALE | 2 | 4 | sets door scale (s32/65536) |
| 0x03 | BASIC | 23 | 1,487 | mesh |
| 0x04 | KEY | 24 | 15 | mesh |
| 0x05 | ALARM | 23 | 0 | – |
| 0x06 | CCTV | 49 | 17 | mesh |
| 0x07 | AMMOCRATE | 24 | 32 | mesh |
| 0x08 | WEAPON | 26 | 1,148 | mesh (floor) or skip (held by a chr, flag 0x4000); +0x5C weapon number, 0xF0..0xFF = MP weapon-set slot (marker) |
| 0x09 | CHR | 11 | 1,002 | marker or posed body + head (*Animations and standing characters (verified: lib `anim.c` disassembly, all 1,207 table records, joint matrices vs RAM)*) |
| 0x0A / 0x0B | SINGLEMONITOR / MULTIMONITOR | 53 / 140 | 158 / 76 | mesh |
| 0x0C | HANGINGMONITORS | 23 | 0 | – |
| 0x0D | AUTOGUN | 43 | 31 | mesh |
| 0x0E | LINKGUNS | 2 | 17 | link |
| 0x0F | DEBRIS | 23 | 30 | mesh |
| 0x11 | HAT | 23 | 0 | – |
| 0x12 | GRENADEPROB | 2 | 0 | – |
| 0x13 | LINKLIFTDOOR | 5 | 96 | link |
| 0x14 | MULTIAMMOCRATE | 42 | 364 | mesh plus 19 `AmmoCrateContent` records (below) |
| 0x15 | SHIELD | 26 | 35 | mesh |
| 0x16 | TAG | 4 | 1,607 | info |
| 0x17 / 0x18 | BEGIN/ENDOBJECTIVE | 4 / 1 | 102 / 102 | info (text id, difficulty bits) |
| 0x19..0x1D | objective conditions | 2 | COMPFLAGS 110, FAILFLAGS 104, COLLECTOBJ 11; DESTROYOBJ, THROWOBJ 0 | info |
| 0x1E | OBJECTIVE_HOLOGRAPH | 4 | 2 | info |
| 0x20 / 0x21 | OBJECTIVE_ENTERROOM / THROWINROOM | 4 / 5 | 0 | – |
| 0x23 | BRIEFING | 4 | 89 | info |
| 0x24 | GASBOTTLE | 23 | 0 | – |
| 0x25 | RENAME | 10 | 64 | info |
| 0x26 | PADLOCKEDDOOR | 4 | 0 | – |
| 0x27 / 0x28 | TRUCK / HELI | 34 / 35 | 0 | – |
| 0x2A | GLASS | 24 | 441 | blended mesh |
| 0x2B / 0x2C | SAFE / SAFEITEM | 23 / 5 | 0 | – |
| 0x2D | TANK | 32 | 0 | – |
| 0x2E | CAMERAPOS | 7 | 10 | `CameraPosRecord` view (below) |
| 0x2F | TINTEDGLASS | 26 | 293 | blended mesh |
| 0x30 | LIFT | 37 | 84 | mesh at its start stop |
| 0x31 | CONDITIONALSCENERY | 5 | 40 | link |
| 0x32 | BLOCKEDPATH | 4 | 3 | link |
| 0x33 | HOVERBIKE | 56 | 4 | mesh at pad / marker |
| 0x35 | HOVERPROP | 39 | 14 | mesh at pad |
| 0x36 | FAN | 29 | 24 | mesh |
| 0x37 | HOVERCAR | 38 | 28 | mesh at pad / marker (moves along AI paths) |
| 0x38 | PADEFFECT | 3 | 61 | marker |
| 0x39 | CHOPPER | 58 | 4 | marker |
| 0x3A | MINE | 26 | 9 | mesh (placed like a weapon) |
| 0x3B | ESCASTEP | 27 | 40 | mesh |

| Structure | Offset | Size | Type | Field | Description |
|---|---:|---:|---|---|---|
| `AmmoCrateContent` | `0x00` | 2 | `u16` | `model` | Ammunition model ID. |
| `AmmoCrateContent` | `0x02` | 2 | `u16` | `quantity` | Ammunition quantity. |
| `CameraPosRecord` | `0x00` | 4 | `s32` | `x100` | X position multiplied by 100. |
| `CameraPosRecord` | `0x04` | 4 | `s32` | `y100` | Y position multiplied by 100. |
| `CameraPosRecord` | `0x08` | 4 | `s32` | `z100` | Z position multiplied by 100. |
| `CameraPosRecord` | `0x0C` | 4 | `s32` | `theta65536` | Horizontal angle multiplied by 65536. |
| `CameraPosRecord` | `0x10` | 4 | `s32` | `vertical65536` | Vertical angle multiplied by 65536. |
| `CameraPosRecord` | `0x14` | 4 | `s32` | `padding` | Padding/unknown. |

(Types 0x10, 0x1F, 0x22 and 0x29 are 1-word unnamed commands, never used.)

**Object header** (first 0x5C bytes of every object record; verified):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | `u16` | `extraScale` | Divide by 256. |
| `0x03` | 1 | `u8` | `type` | Object type. |
| `0x04` | 2 | `s16` | `modelNum` | `g_ModelStates` index. |
| `0x06` | 2 | `s16` | `pad` | Character number when flags include `0x4000`; negative means unplaced. |
| `0x08` | 4 | `u32` | `flags` | `0x2/0x4/0x8` alignment; `0x20/0x40/0x80` fit to pad box; `0x4000` held by character. |
| `0x0C` | 4 | `u32` | `flags2` | Difficulty and player-count exclusions. |
| `0x14` | variable | runtime | `runtime` | Runtime fields through the end of the 0x5C-byte common header. |

Difficulty bits are `0x10` Agent, `0x20` Special Agent, `0x40` Perfect Agent, and `0x80` Perfect Dark;
`0x400000/0x800000/0x1000000` exclude 2/3/4-player modes. The setup loop skips an object when
`flags2 & (1 << (difficulty + 4))`.

**Type-specific fields** are verified where their handlers read them.

| Object type | Offset | Size | Type | Field | Description |
|---|---:|---:|---|---|---|
| DOOR | `0x5C` | 4 | word | `maxFraction` | Maximum opening fraction. |
| DOOR | `0x60` | 4 | word | `perimeterFraction` | Perimeter fraction. |
| DOOR | `0x64` | 4 | word | `acceleration` | Opening acceleration. |
| DOOR | `0x68` | 4 | word | `deceleration` | Opening deceleration. |
| DOOR | `0x6C` | 4 | word | `maxSpeed` | Maximum opening speed. |
| DOOR | `0x70` | 2 | `u16` | `doorFlags` | Door flags. |
| DOOR | `0x72` | 2 | `u16` | `doorType` | Values 4 and 8 open along the look axis; other values open along the up axis. |
| DOOR | `0xBC` | 4 | relative reference | `siblingDoor` | Relative reference to a sibling door. |
| LIFT | `0x5C` | unknown | pad references | `stopPads` | Lift stops; layout remains a hypothesis. |
| TINTEDGLASS | `0x5C` | 2 | unknown | `fadeNear` | Near fade distance; semantics are a hypothesis. |
| TINTEDGLASS | `0x5E` | 2 | unknown | `fadeFar` | Far fade distance; semantics are a hypothesis. |

Door-link structures remain unresolved. MINE records are rewritten to WEAPON. CHR records are `0x2C` bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x04` | 4 | flags | `spawnFlags` | Difficulty mapping is a hypothesis. |
| `0x0A` | 2 | `u16` | `pad` | Spawn pad. |
| `0x0C` | 1 | `u8` | `body` | 255 selects randomly. |
| `0x0D` | 1 | `s8` | `head` | Negative selects randomly. |
| `0x0E` | 2 | `u16` | `aiListId` | AI-list identifier. |

**Intro commands** follow the props list:

| Opcode | Name | Operands / meaning |
|---:|---|---|
| 0 | SPAWN | Pad and flag; player start pads. Multiplayer setups contain 12–21. |
| 1 | WEAPON | Starting weapon; name is a hypothesis. |
| 2 | AMMO | Starting ammunition; name is a hypothesis. |
| 5 | OUTFIT | Starting outfit; name is a hypothesis. |
| 7 | WATCHTIME | Watch time. |
| 8 | CREDITS | Credits data. |
| 9 | MPCASEPAD | Multiplayer case pad; name is a hypothesis. |
| 10 | MPRESPAWNPAD | Multiplayer respawn pad; name is a hypothesis. |
| 11 | MPHILLPAD | Multiplayer hill pad; name is a hypothesis. |
| 12 | END | Terminates the intro-command list. |

Command lengths are verified.

#### Detection and game object

- `src/rom/index.ts` `openRom()`: add `case 'NPDE'` (after `normalizeByteOrder()`), accepting `rom[0x3F] === 0`
  (V1.0; addresses in this spec). V1.1 (`rom[0x3F] === 1`), `NPDP` and `NPDJ` need their own address maps (*Revisions (verified: `fs/scripts/revs.py`, `revcode.py`, `fs/revs.txt`)*);
  reject them at first or derive the tables from the boot code as `fs/extract.py` does.
- `src/rom/types.ts`: `Game.id` += `'perfectdark'`. `LevelKind` already has `'campaign'`, `'hub'`, `'battle'` and
  `'other'`; use `campaign` (groups "Mission 1" … "Mission 9", "Special Assignments"), `hub` (Carrington
  Institute), `battle` (groups "Combat Simulator – Dark", "Combat Simulator – Classic") and `other` (group "Unused": 0x14
  silo, 0x1B sevb). `LevelInfo.name` = menu name (*Stage list*); `Level.id` = e.g. `ame-30`.

#### Objects

| Check | Method | Result | Evidence |
|---|---|---|---|
| setup command lengths | disassembly + data | every populated props list ends exactly at its intro | `obj/scripts/test_rom.ts` |
| models | all 686 model files | 0 unknown opcodes, 0 missing textures, 0 errors | `obj/dumps/models_survey.json`, `obj/renders/all_props_sheet.png` |
| placement | Defection RAM objects vs the *Placement (verified against RAM: rotations 238/285, positions 257/285; doors 45/46 and 44/46)* math | rotations 238/285, positions 257/285; doors 45/46 and 44/46; root offset ignored 25/25 | `obj/scripts/compare_ram.ts` |
| scaled stages | Villa RAM (334 objects) and Crash Site frame model matrices | 272/334 exact; matrices = 0.5 × gameplay scale | `obj/scripts/scalecheck_ram.ts` |
| renders with objects | BG + placed objects through the frame's matrices | match (Defection sculpture and lights, lobby desk monitors, Villa wind turbine, CI desk) | `obj/renders/{defection,villa,crashsite,chicago}_side_by_side.png`, `bg/renders/ci_a_objects_side_by_side.png` |
| start camera | Defection spawn pad vs camera in RAM | eye = pad + 112 up along the pad's look | `obj/renders/defection_spawn.png` |
| animation decoder | port of lib anim.c/model.c vs `model->matrices` in RAM (runtime dumps; breakpoints at 0x7F0241E0 in Chicago and the Defection intro) | 28/28 joints, 4/4 elbow/knee, 2/2 roots; max element error 5.7e−7 | `anim/scripts/verify_ram.ts`, `verify_hits.ts`, `anim/dumps/verify_*.txt` |
| standing characters | stand animation frame 0 per body type | natural standing poses; root height = lowest vertex within 1% | `anim/renders/chars_standing.png`, `defection_posed_chr12.png` |

#### Models and props

The object agent's first pass found 105 of the 441 model numbers never placed by any setup (*Objects and props*). Part 3 then split
them by code references, checked in the ROM through slot cross-references and data tables:

| Item | Evidence | Confidence | Reachable |
|---|---|---|---|
| used by code, not setups: `PnintendologoZ` and `PrarelogoZ` (title screen), 5 MP weapon-table models (knife, N-bomb, timed mine, speed pill, laser), 6 projectile models | slot references 0x7F019464/0x7F019AC8; `g_MpWeapons` 0x80087268; weapon data 0x8006B1E4.. | high | yes |
| **test and placeholder props:** `PtestobjZ` (a large car-shaped test object, 1908 × 1110 × 5925 units), `PmarkerZ` (a 100-unit cube with a magenta rainbow debug texture), `PflagZ` (a flat 10-triangle sheet), `Pborg_crateZ` (a Borg-cube-textured crate) | no setup, AI or code reference; `unused3/renders/misc_unreferenced.png` | high | no |
| **`PgoldeneyelogoZ`**: the textured GOLDENEYE logo with the red 007 ring, a GoldenEye leftover outside the model table | file table vs model table; no reference | high | no |
| `Psk_fighter1Z` (a Skedar fighter craft), `PchrflashbangZ` (a flashbang grenade; PD has no Flashbang weapon), `PbodyarmourZ` (GoldenEye body armour), `PbriefcaseZ` (superseded by `PchrbriefcaseZ`), empty `PexplosionbitZ` | no reference | high | no |
| 17 doors never placed (Chicago crypt door, three Villa doors, Area 51 lockers, reactor door, weapon-cache door, CI doors, Alaska doors, Air Force One cargo door) | doors are only created by setups | high | no |
| **a complete Carrington Institute office set** (`Pci_cabinetZ`, `Pci_deskZ`, `Pci_carr_deskZ`, `Pci_f_chairZ`, `Pci_loungerZ`, `Pci_f_sofaZ`, `Pci_tableZ`) plus chair/table/lamp variants for G5, Villa, Pelagic, Investigation and Air Base | no setup or code reference | high | no |
| four door-lock panels (keypad, thumbprint, retinal, card lock); lab and base equipment (microscope, mainframe, radar console, generator, dumpster, mine sign…); Skedar temple column, consoles, drone gun, ruin bridge | no reference | high | no |
| unused title-logo variants `Pnlogo3Z`, `PperfectdarkZ`, `PpdoneZ`, `PpdfourZ` (the title uses `Pnlogo`, `Pnlogo2`, `Ppdtwo`, `Ppdthree` per the decompilation) | no slot reference found | medium | no |
| 12 duplicate model-table entries pointing at one crate file | table data | high | – |
| **J-only models:** `PjaplogoZ` (katakana title logo パーフェクトダーク™), `PjappdZ` (outlined PERFECT DARK logo) | file tables of all revisions; `unused/revs/J_only_models_front.png` | high | J only |

### 4.3 Skeletons and animation

#### Animations and standing characters (verified: lib `anim.c` disassembly, all 1,207 table records, joint matrices vs RAM)

**Table** (ROM 0x7CD1A0, read whole by `animsInit` 0x700233C0): `u32 count = 1207`, then 12-byte records:
| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `+0x00` | 2 | `u16` | `numFrames (0 = empty; 262 empty)` | — |
| `+0x02` | 2 | `u16` | `bytesPerFrame` | — |
| `+0x04` | 4 | `u32` | `dataOffset (from ROM 0x1A15C0)` | — |
| `+0x08` | 2 | `u16` | `headerLength` | — |
| `+0x0A` | 1 | `u8` | `angleBits (12 in all)` | — |
| `+0x0B` | 1 | `u8` | `flags` | Animation flags defined below. |

| Mask | Meaning |
|---:|---|
| `0x01` | Loop. |
| `0x02` | Absolute root motion for cutscenes. |
| `0x04` | Frame-remap table is present. |
| `0x08` | Unknown; set on 29 animations. |
- Records chain through the data region exactly, with at most 16 padding bytes. 945 non-empty animations total 6.47 MB.
- Playback speed is passed by the caller, not stored: 0.25 for human stands, 0.5 for other races.

**Header:** one descriptor per skeleton part (in the model's POSITION/CHRINFO `part` order). Each starts with a
`u8 flags`, followed by channel blocks of `{base, bits}`:

| Flag | Channel | Frame data |
|---|---|---|
| 0x08 | root motion: x, y, z + yaw | 4 deltas (u16 base) |
| 0x02 | s16 translation | 3 deltas (u16 base) |
| 0x20 | translation × 0.001 | 3 deltas (u32 base) |
| 0x01 | rotation x, y, z | 3 deltas (u16 base) |
| 0x10 | rotation | 3 raw f32 |
| 0x40 | scalar × 0.001 | 1 delta |
| 0x80 | scale | 3 raw f32 |

Human headers are 162 bytes: part 0 is root + rotation, parts 1–14 rotation only. Skedar headers have 36 parts.

**Frames:** `bytesPerFrame` bytes, packed MSB-first in descriptor order.
- Translations: `(s16)(base + signExtend(delta, bits))`.
- Angles: `((base + delta) & 0xFFFF) << (16 − angleBits)`, times `6.282185/65536` (the game's own 2π).
- Frames can be missing (flag 0x04): the header ends with s16 `{end, start}` pairs, read backwards, naming frame ranges
  that aren't stored.
- **Mirrored animations** take the part from the skeleton mirror table (`g_Skeletons` 0x80089990) and negate the Y and
  Z angles.

**Joint matrices** (`model.c`): `joint = parent × T(position) × R`, with `R` = rotations in Z·Y·X order.
- Between frames the game interpolates angles and translations. Characters far from the camera snap to the nearest
  whole frame.
- Elbows and knees (0x102 POSITION nodes) get a second matrix with half the rotation, used for skinning.
- The root gets the chr yaw. Animations with flag 0x02 also get their root translation × the stage scale ratio (stage
  table +0x1C / +0x14).
- After drawing, the game converts `model->matrices` in place to 16.16 fixed point.

**Verification:** a port of the decoder (`anim/lib/anim.ts`, `pose.ts`) reproduces the game's joint matrices.

| Source | Characters and animation | Result |
|---|---|---|
| runtime RDRAM captures | characters on screen | 28/28 joints, 4/4 elbow/knee matrices |
| own debugger breakpoints at 0x7F0241E0 | Chicago CIA agent; Joanna in the Defection intro, cutscene anim 265 mid-frame | 28/28 joints, 4/4 elbow/knee, 2/2 root rotations; worst element error 5.7e−7 |

**Standing pose for the viewer** (from the game's stand routine, verified by disassembly):

| Body | Stand animation |
|---|---|
| humans, one-handed gun | 1 |
| humans, two-handed gun | 106 |
| Skedar, mini Skedar, Skedar King | 192 |
| Dr Caroll and the CamSpy | 318 |
| robot (chicrob) | 567 |
| unarmed humans | whatever the AI sets (not traced) |

- **Pose:** frame 0 of the stand animation through `poseModel(modelDef, anim, 0, {animScale})`, then build the mesh with
  the joint matrices loaded by each `G_MTX` slot. The head model is attached with the HEADSPOT joint's matrix (looks
  right in renders; not verified in RAM).
- **World matrix** (hypothesis assembled from verified parts):
  `T(pad.pos) · RotY(atan2(look.x, look.z)) · S(0.1 · body.scale) · T(0, rootY · animScale, 0)`.
  - The root height matches the lowest vertex of all ten sample bodies and one RAM sample within 1%.
  - Some chr pads sit above the floor (a Defection guard is about 20 units up), so snap characters to the floor.
- **Cost:** about 9 µs per frame decode and 0.26 ms per pose, so pose each body type once at load.

Renders: `anim/renders/chars_standing.png` (the ten characters of `obj/renders/chars_sheet.png`, standing);
`anim/renders/defection_posed_chr12.png` (two security guards at the Defection lobby desk).

### 4.4 Behaviors, triggers, and scripted objects

## 5. Audio

### 5.1 Audio storage and banks

### 5.2 Sequence format and driver

#### Engine (verified: code, RAM, captured audio)

| Item | Value |
|---|---|
| library | Nintendo's newer libultra **n_audio**: `n_alSynNew`, the `n_alCSPlayer` compressed-MIDI player, `n_env` envelope mixer. Runs on the `naudio_mp3` RSP microcode; voice clips are MP3 (*File table (verified: ROM, RAM, loader disassembly, load trace)*) |
| output rate | **22018 Hz** (AI dacrate 2210; `N_ALSynth.outputRate` = 0x5602 at 0x800918C0) |
| synth frame | 184 samples per update |
| voices | 44 virtual, 30 physical; 2 custom FX (reverb) busses; 16 MIDI channels |
| players | 3 sequence players (`seqinstance[3]` at 0x80094ED8, `0x108` bytes each; known tail fields below) |
| player volume | `musicVolume (default and maximum 0x5000) × seqVolTable[seq] >> 15`; `seqVolTable` = s16[119] at 0x8005ECF8 (data segment offset 0x4D18) |
| **voice volume** | **linear**: the envelope mixer volume is the sequence player's voice volume itself, **not squared** as in libultra ABI1 and the viewer's `libultra.ts`. Verified: in RAM, a menu voice's computed volume 16744 equals `em_volume` 16744 (squared would be 8555). Squared renders are 4–16 dB too quiet against captures |
| reverb | per-voice dry/wet sends from the channel FX mix; the FX parameters are not decoded, and reverb is not rendered |

Known `seqinstance` tail fields:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0xF8` | 4 | `ptr` | `player` | Compressed-sequence player. |
| `0xFC` | 4 | `ptr` | `sequenceBuffer` | Inflated sequence buffer. |
| `0x100` | 4 | `u32` | `volume` | Sequence-player volume. |
| `0x104` | 4 | `u32` | `sequenceNumber` | Current sequence number. |

#### Data (ROM, outside the file table; referenced only from lib code)

| ROM | Contents |
|---|---|
| 0x80A250–0x839DC0 | sound-effect bank `.ctl` (ALBankFile `B1`: 1 instrument, 1,545 sounds, 773 waves) |
| 0x839DC0–0xCFBF30 | sound-effect samples `.tbl` (VADPCM) |
| 0xCFBF30–0xD05F90 | **music bank** `.ctl`: ALBankFile `B1`, 1 bank, 126 instruments (no percussion), 258 sounds, 188 VADPCM waves, sampleRate 22050 |
| 0xD05F90–0xE82000 | music samples `.tbl` |
| 0xE82000–0xED83A0 | **sequence table** and 119 rarezip-1173 sequence streams; format below |

Sequence-table header and entries:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | `u16` | `count` | Always 119. |
| `0x02` | 2 | `u16` | `padding` | Padding. |
| `0x04` | `8 × count` | entry array | `entries` | Eight-byte records defined below. |

| Entry offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `u32` | `offset` | Offset relative to ROM `0xE82000`. |
| `0x04` | 2 | `u16` | `uncompressedLength` | Exact inflated length. |
| `0x06` | 2 | `u16` | `compressedLength` | Stored rarezip-1173 byte count. |

- **Bank:** standard libultra `.ctl` (ALBank, ALInstrument, ALSound, ALEnvelope, ALKeyMap, ALWaveTable,
  ALADPCMloop, ALADPCMBook) with offsets relative to the ctl start. The viewer's
  `parseBank(rom, 0xCFBF30, 0xD05F90, 0, null)` parses all 126 instruments unchanged (verified).
- **Sequences:** libultra compressed MIDI (ALCSeq), the same format as the Bomberman games.
  - Header:

    | Offset | Size | Type | Field | Description |
    |---:|---:|---|---|---|
    | `0x00` | 64 | `u32[16]` | `trackOffset` | Sequence-relative track offsets; zero denotes an unused track. |
    | `0x40` | 4 | `u32` | `division` | Ticks per quarter note; 384 in all 119 sequences. |

  - Meta events: `FF 51` tempo, `FF 2E` loop start and `FF 2D count cur back` loop end, where count 0xFF means
    forever.
  - Verified: all 119 inflate to exactly `uncompressedLen` and parse with the viewer's `parseCompressedMidi`
    (`music/seqsurvey.ts`).
- **Playback** (lib `seqPlay` 0x7000FC48): copy `compressedLen` bytes from ROM, inflate (0x700074F0),
  `n_alCSeqNew`, `alCSPSetSeq`, set the volume (0x7000FD9C), `alCSPPlay`.

#### Where music plays (verified: data tables and disassembly; RAM where marked)

- **Stage music table** at 0x80084500 contains 24 records:

  | Offset | Size | Type | Field | Description |
  |---:|---:|---|---|---|
  | `0x00` | 2 | `s16` | `stage` | Stage ID; zero terminates the table. |
  | `0x02` | 2 | `s16` | `primary` | Primary sequence ID, or −1. |
  | `0x04` | 2 | `s16` | `ambient` | Ambient sequence ID, or −1. |
  | `0x06` | 2 | `s16` | `xTrack` | Alternate/danger sequence ID, or −1. |

  It is terminated by stage
  0; −1 = none.
  - Multiplayer stages and stages missing from the table use the Combat Simulator picker.
  - RAM: in Defection the players hold seq 9 (primary) and seq 8 (ambient).
- **Track types** (3 players shared through a channel table at 0x800AAA38):

  | Type | Meaning |
  |---|---|
  | 1 | primary |
  | 2 | X (alternate/danger) |
  | 3 | menu |
  | 4 | death sting (seq 25, with a 1200-frame timer; hypothesis for "death") |
  | 5 | ambient |

  - Stage start plays primary + ambient.
  - **X music** (0x7F16D7EC) stops types 2–4, fades the primary out over 0.5 s and starts the X track. When it ends
    (0x7F16D864), X fades out over 1 s and the primary fades back in over 0.5 s.
  - Triggers: combat state (0x7F16D480, hypothesis) and AI script commands.
- **Combat Simulator "Soundtrack"** at 0x80087A70 has 42 records:

  | Offset | Size | Type | Field | Description |
  |---:|---:|---|---|---|
  | `0x00` | 2 | `u16` | `trackAndSeconds` | Track in the high seven bits; default seconds in the low nine. |
  | `0x02` | 2 | `u16` | `textId` | Text identifier. |
  | `0x04` | 2 | `s16` | `unlock` | Unlock condition. |
  - Names come from `LmiscE` strings 124–165.
  - Each match picks a random enabled entry and switches after `defaultSeconds`. RAM, in a Skedar Quick Start match:
    entry 3 "dataDyne Action" = seq 62, timer 10800 frames = 180 s.
- **Menus** (`0x7F0FC9D4`, track type 3):
  - RAM-verified: seq 89 on the file select and Carrington Institute menus, seq 72 in the Combat Simulator setup
    menus.
  - Other menu states select 27, 71, 73, 103 and 3 (state meanings are hypotheses).
  - Seq 108 plays as type 1 on the file select; seq 107 plays during the boot logos (RAM).
- **Cutscenes and AI scripts** (verified: AI command table at data 0x80068490, command-length table 0x80068C14; a walk of all 1,610 setup AI lists and 46 global lists parses without errors, `unused3/scripts/aiwalk.py`):
  - Music opcodes: `0x15B` play track isolated, `0x17D` play cutscene track, `0x17F` play temporary track, `0x1DA` play music continuously. The music notes gave table indices one higher, from a table start 4 bytes early.
  - `UsetupameZ` starts 34 and ambient 11 in its intro list, matching the RAM state during the Defection intro.
  - Of the 51 sequences in no code table, **42 are started by setup AI lists** (intro, outro and cutscene music).
  - Referenced nowhere: 0 (400 s of silence), 21 (an earlier multiplayer death sting), 48 (a first version of the Villa intro), 60 (a 205 s looping theme), 95 (one note), 114 and 118 (alternate Escape outros), and 117 (a short jingle).
  - Seq 1 is a medium-confidence case: the decompilation says the title screen starts it, but no ROM constant was found. See *Unused and hidden content*.
  - The credits play seq 88.

#### Rendering offline (prototype verified against game audio)

1. Read sequence `n` from the table and inflate it; parse it with a per-track loop parser (`src/rom/music/cseq.ts`
   `parseCompressedSequence`, shared with GoldenEye). **Correction (implementation):** the prototype used Bomberman's
   `parseCompressedMidi`, which takes the loop of the first track to reach one; in n_audio every track loops on its own,
   so that rule collapses the layered ambiences 5, 109 and 110 and silences layers of 8, 102 and 106. The per-track
   rule fixes them (loops in *Song list* updated for 5, 27, 109, 110), with one addition: when the tracks' loops share no
   common period but all end on the same tick, loop from the earliest start (only seq 27).
2. Render with `renderSequence` from a copy of `libultra.ts` that adds one option, `squareVolume: false`
   (`music/naudio.ts`: `v.vol = opts.squareVolume === false ? vol : (vol * vol) >> 15`). Settings:
   - bank `parseBank(rom, 0xCFBF30, 0xD05F90, 0, null)`;
   - output rate 22018 Hz, 44 voices;
   - sequence volume `0x5000 × seqVolTable[n] >> 15`.
3. **Loop:** sequences with an infinite `FF 2D` loop get `loopStart`/`loopEnd` from the renderer's second pass. The
   52 one-shots have none.
4. Apply output gain **1.0** to every song. All 119 render in about 2.5 minutes (`music/render.ts`,
   `music/wav/NNN_name.wav`). 13 renders clip on up to 220 samples; the game's 16-bit mixer clips the same way.

**Captured game audio vs renders** (audio-dump plugin at 22018 Hz; `music/cap/boot.raw`, `music/cap/mp.raw`;
`music/tools/cmp2.py`):

| Game state (sequence ids from RAM) | Render | Loudness-envelope NCC | Tempo | Chroma at 0 / ±1 semitone | Game − render level |
|---|---|---|---|---|---|
| boot logos, 107 | 107 | 0.846 | 1.000 | 0.939 / 0.87 | +2.7 dB (squared model: +12.5) |
| attract intro, 34 + 11 | 34 + 11 | 0.511 | 1.000 | 0.894 / 0.35 | +0.5 dB (squared: +16.4) |
| file select, 89 (+108, SFX) | 89 | 0.57–0.76 | exact, including across the loop jump at 63.13 s → 2.525 s | 0.902 / 0.54 | −2.9 dB (squared: +4.3) |
| Defection gameplay, 9 + 8 | 9 | 0.850 | 1.000 over 80 s | 0.905 / 0.50 | −1.6 dB |
| Combat Simulator match (Skedar), 62 | 62 | 0.883 | 1.000 over 80 s | 0.926 / 0.47 | −3.0 dB |

- **Level:** the mean offset is −0.9 dB with a ±3 dB spread, which includes reverb, sound effects and ducking. No
  per-song gain is justified.
- **Tempo:** RAM tempos agree with the sequence data (e.g. seq 9 at 117 BPM: 1335 µs per tick).
- **Not modelled:** reverb (about 1–2 dB and the room sound) and the 184-sample
  event quantisation.

| Check | Method | Result | Evidence |
|---|---|---|---|
| engine parameters | RDRAM (synth struct, players) and AI dacrate | 22018 Hz, 184-sample updates, 3 players, linear voice volume | `music/ram/*.bin`, `music/cap/boot.log` |
| sequences and bank | all 119 inflate to their size and parse; `parseBank` on the music bank | pass | `music/seqsurvey.ts` |
| song selection | RDRAM during boot logos, attract, file select, Defection, Combat Simulator | seqs 107; 34 + 11; 89 + 108; 9 + 8; 62 | `music/tools/ramvoices.py` |
| AI music commands | walk of all 1,610 setup and 46 global AI lists with the game's length table | 0 errors; Defection intro starts 34/11 | `unused3/scripts/aiwalk.py` |
| rendered audio | 5 captures (audio-dump plugin) vs renders: loudness envelope, onset/loop timing, chroma | tempo exact, pitch correct, level −3.0..+2.7 dB | `music/tools/cmp2.py`, `music/cap/` |

#### Music and sound

| Item | Evidence | Confidence | Reachable |
|---|---|---|---|
| **seq 60**: a 205.6 s looping piece (5,778 notes, 16 channels, 113→120 BPM), the longest unused track. The decompilation calls it DEEPSEA_BETA with the file name `crashsite-intro-amb.seq`: probably a cut stage theme. Render: `music/wav/060_Track_60.wav` | no code table and no AI list (all 1,610 setup lists walked) | high | no |
| seq 48: first version of the Villa intro (the game uses 67/68) | same | high | no |
| seqs 114 and 118: alternate Escape outros (UFO effects layer; short version) | same | high | no |
| seq 21: an earlier version of the multiplayer death sting (25) | same | high | no |
| seq 0 (400 s of silence), seq 95 (one 0.27 s "bloop"), seq 117 (a 1.6 s melody test) | same | high | no |
| seq 1 (a 10 s title sting): the decompilation starts it on the title screen, but no ROM constant was found | scan | medium (probably used) | ? |
| **stage-music row for stage 0x1B `sevb`** (CI geometry, no setup): primary/X track 61 "CI Operative" | data | high | no (the track itself is in the Soundtrack menu) |
| instruments 42 and 57 own the only truly unused music samples: 7 waves, 35,780 bytes | program changes of all 119 sequences vs the bank; wave sharing checked | high | no |
| 29 other never-selected instruments only reuse shared waves | same | high | – |
| **voice clips never referenced:** `Am6_l1_aM`, `Acifema08M`, `Acimale11M`, `Acimale13M`, `Acicarr09M` (a Deep Sea/Pelagic line, CI staff remarks, a Carrington line) | AI lists, sound mapping table (0x8005DDE4), quip banks, lib constants: 543/548 referenced | medium (a computed CI quip index could reach them) | ? |
| sound effects: 715 of 1,545 are referenced by AI lists, the mapping table and quip banks; code constants were not scanned | – | no claim | – |
| no sound-test menu; the Combat Simulator Soundtrack menu is the only track selection | code/menu scan | high | – |

### 5.3 Instruments and sample encoding

### 5.4 Music catalog and loop points

#### Song list

Names: Combat Simulator Soundtrack names where they exist; otherwise the proposed name in the "use" column. Loop
start–end are in seconds of song time. "one-shot" means there is no infinite loop. The WAV loop points in samples are
in `music/wav/index.json`.

| # | ROM | BPM | loop (s) | length (s) | name | use |
|---|---|---|---|---|---|---|
| 0 | 0xE823BC | 120 | 0.000–399.974 | 399.974 | – | **unreferenced** (decomp MUSIC_NONE; "no music" placeholder, *Unused and hidden content*) |
| 1 | 0xE823EA | 120 | one-shot | 10.002 | – | title sting? The decompilation (MUSIC_TITLE2) starts it on the NTSC title screen, but no ROM constant was found (medium, *Music and sound*) |
| 2 | 0xE826BA | 180 | 5.333–135.991 | 135.991 | dD Extraction | primary dataDyne Central - Extraction (0x22); Soundtrack #11 (120 s) |
| 3 | 0xE83BB0 | 125 | 0.000–46.080 | 46.080 | – | menu track (0x7F0FC9D4 fallback) |
| 4 | 0xE8415C | 152 | 9.465–170.367 | 170.367 | Institute Defense | primary Carrington Institute - Defense (0x2D); Soundtrack #35 (120 s) |
| 5 | 0xE84F7C | 110 | 198.48–394.78 | 398.5 | – | ambient dataDyne Research - Investigation (0x33) |
| 6 | 0xE851D2 | 135 | 0.000–167.052 | 167.052 | A51 Escape | primary Area 51 - Escape (0x19); Soundtrack #23 (120 s) |
| 7 | 0xE863A6 | 113/120 | 57.594–251.581 | 251.581 | Deep Sea | primary Deep Sea - Nullify Threat (0x38); Soundtrack #33 (120 s) |
| 8 | 0xE86F34 | 140 | 5.143–113.136 | 113.136 | – | ambient dataDyne Central - Defection (0x30); ambient dataDyne Central - Extraction (0x22); ambient Mr. Blonde's Revenge (special) (0x37) |
| 9 | 0xE88974 | 117 | 0.000–229.663 | 229.663 | dD Central | primary dataDyne Central - Defection (0x30); Soundtrack #7 (120 s) |
| 10 | 0xE89E3A | 190/150 | 20.135–64.906 | 64.906 | – | primary started by 0x7F16D964 after stopping all (hypothesis: mission complete/failed or MP end) |
| 11 | 0xE8AB14 | 110 | one-shot | 65.402 | – | attract demo & Defection intro cutscene, ambient (RAM title1) |
| 12 | 0xE8CE60 | 140 | 0.000–164.561 | 164.561 | Carrington Villa | primary Carrington Villa - Hostage One (0x2C); Soundtrack #13 (120 s) |
| 13 | 0xE8D9F0 | 160 | 5.997–149.914 | 149.914 | Carrington Institute | primary Carrington Institute (hub) (0x26); Soundtrack #6 (120 s) |
| 14 | 0xE8E458 | 90 | 10.666–170.656 | 170.656 | Chicago | primary Chicago - Stealth (0x1D); Soundtrack #15 (120 s) |
| 15 | 0xE8EB58 | 140 | 13.713–205.701 | 205.701 | G5 Building | primary G5 Building - Reconnaissance (0x1E); Soundtrack #17 (120 s) |
| 16 | 0xE8F5C0 | 150 | 0.005–76.751 | 76.751 | dD Central X | X dataDyne Central - Defection (0x30); Soundtrack #8 (120 s) |
| 17 | 0xE8FE90 | 220 | 8.724–61.071 | 61.071 | dD Extraction X | X dataDyne Central - Extraction (0x22); Soundtrack #12 (120 s) |
| 18 | 0xE9091E | 125 | 23.040–207.360 | 207.360 | dD Research | primary dataDyne Research - Investigation (0x33); Soundtrack #9 (120 s) |
| 19 | 0xE9120A | 190 | 5.050–65.655 | 65.655 | dD Research X | X dataDyne Research - Investigation (0x33); Soundtrack #10 (120 s) |
| 20 | 0xE91C28 | 120 | 2.000–137.991 | 137.991 | A51 Infiltration | primary Area 51 - Infiltration (0x2F); Soundtrack #19 (120 s) |
| 21 | 0xE92502 | 120 | one-shot | 4.002 | – | **unreferenced** (decomp MUSIC_DEATH_BETA; cut ("beta"), *Unused and hidden content*) |
| 22 | 0xE927B0 | 105 | 36.569–292.553 | 292.553 | A51 Rescue | primary Area 51 - Rescue (0x35); Soundtrack #21 (120 s) |
| 23 | 0xE932DE | 90 | 2.666–205.320 | 205.320 | Air Base | primary Air Base - Espionage (0x27); Soundtrack #25 (120 s) |
| 24 | 0xE940FE | 140 | 5.143–176.560 | 176.560 | Air Force One | primary Air Force One - Antiterrorism (0x31); Soundtrack #27 (120 s) |
| 25 | 0xE94D04 | 140 | one-shot | 5.384 | – | tracktype 4 sting with 1200-frame timer (0x7F16DAD4; hypothesis: player death) |
| 26 | 0xE94E50 | 120 | one-shot | 45.968 | – | setup AI: ark 0x412/0xC01 (temporary) (decomp name EXTRACTION_OUTRO_SFX) |
| 27 | 0xE95176 | 90 | 0.0017–21.332 | 21.332 | – | menu track (0x7F0FC9D4 default, state 7) |
| 28 | 0xE95330 | 140 | 13.713–185.131 | 185.131 | Pelagic II | primary Pelagic II - Exploration (0x21); Soundtrack #31 (120 s) |
| 29 | 0xE95FDE | 132 | 18.171–159.904 | 159.904 | Crash Site | primary Crash Site - Confrontation (0x1C); Soundtrack #29 (120 s) |
| 30 | 0xE97492 | 181 | 0.005–58.325 | 58.325 | Crash Site X | X Crash Site - Confrontation (0x1C); Soundtrack #30 (120 s) |
| 31 | 0xE983B8 | 109 | 2.212–188.006 | 188.006 | Attack Ship | primary Attack Ship - Covert Assault (0x34); Soundtrack #37 (120 s) |
| 32 | 0xE9A896 | 160 | 8.995–58.466 | 58.466 | Attack Ship X | X Attack Ship - Covert Assault (0x34); Soundtrack #38 (120 s) |
| 33 | 0xE9B748 | 135 | 46.206–255.910 | 255.910 | Skedar Ruins | primary Skedar Ruins - Battle Shrine (0x2A); Soundtrack #39 (120 s) |
| 34 | 0xE9C150 | 95 | one-shot | 66.018 | – | attract demo & Defection intro cutscene, primary (RAM title1, stage 0x30 intro) |
| 35 | 0xE9CE4E | 104 | one-shot | 9.231 | – | setup AI: ame 0x416 (decomp name DEFECTION_OUTRO) |
| 36 | 0xE9D130 | 200 | 0.004–67.178 | 67.178 | Institute Defense X | X Carrington Institute (hub) (0x26); X Carrington Institute - Defense (0x2D); Soundtrack #36 (120 s) |
| 37 | 0xE9D9C6 | 90/93 | one-shot | 31.008 | – | setup AI: ear 0x416 (decomp name INVESTIGATION_INTRO) |
| 38 | 0xE9E43C | 95 | one-shot | 41.897 | – | setup AI: ear 0x417 (decomp name INVESTIGATION_OUTRO) |
| 39 | 0xE9ED0C | 190 | 0.004–60.604 | 60.604 | Carrington Villa X | X Carrington Villa - Hostage One (0x2C); Soundtrack #14 (120 s) |
| 40 | 0xE9F6CC | 150 | 0.005–70.355 | 70.355 | Chicago X | X Chicago - Stealth (0x1D); Soundtrack #16 (120 s) |
| 41 | 0xEA000E | 150 | 0.005–60.761 | 60.761 | G5 Building X | X G5 Building - Reconnaissance (0x1E); Soundtrack #18 (120 s) |
| 42 | 0xEA079C | 160 | 0.005–59.965 | 59.965 | A51 Infiltration X | X Area 51 - Infiltration (0x2F); Soundtrack #20 (120 s) |
| 43 | 0xEA10F2 | 79 | one-shot | 13.634 | – | setup AI: pete 0x40B/0xC01 (decomp name CHICAGO_OUTRO) |
| 44 | 0xEA183C | 95/97 | one-shot | 45.788 | – | setup AI: ark 0x412/0xC01 (decomp name EXTRACTION_OUTRO) |
| 45 | 0xEA27D6 | 89/91 | one-shot | 22.577 | – | setup AI: ark 0x100D/0xC00 (decomp name EXTRACTION_INTRO) |
| 46 | 0xEA3172 | 92/88/93 | one-shot | 19.580 | – | setup AI: depo, sev, stat, wax, **old** (UsetupoldZ) (decomp name G5_INTRO) |
| 47 | 0xEA366A | 78/77 | one-shot | 48.464 | – | setup AI: pete 0x401 (decomp name CHICAGO_INTRO) |
| 48 | 0xEA42E8 | 93 | one-shot | 44.384 | – | **unreferenced** (decomp MUSIC_VILLA_INTRO1; cut alternate cutscene score, *Unused and hidden content*) |
| 49 | 0xEA53EC | 73 | one-shot | 77.853 | – | setup AI: lue 0x410 (decomp name INFILTRATION_INTRO) |
| 50 | 0xEA5906 | 190 | 5.050–60.604 | 60.604 | A51 Rescue X | X Area 51 - Rescue (0x35); Soundtrack #22 (120 s) |
| 51 | 0xEA61C0 | 215 | 0.004–62.448 | 62.448 | A51 Escape X | X Area 51 - Escape (0x19); Soundtrack #24 (120 s) |
| 52 | 0xEA6C38 | 195 | 0.004–61.517 | 61.517 | Air Base X | X Air Base - Espionage (0x27); Soundtrack #26 (120 s) |
| 53 | 0xEA7882 | 185 | 0.004–62.226 | 62.226 | Air Force One X | X Air Force One - Antiterrorism (0x31); Soundtrack #28 (120 s) |
| 54 | 0xEA8244 | 180 | 0.004–69.329 | 69.329 | Pelagic II X | X Pelagic II - Exploration (0x21); Soundtrack #32 (120 s) |
| 55 | 0xEA8DE4 | 160 | 0.005–62.964 | 62.964 | Deep Sea X | X Deep Sea - Nullify Threat (0x38); Soundtrack #34 (120 s) |
| 56 | 0xEA98AC | 200 | 0.004–67.178 | 67.178 | Skedar Ruins X | X Skedar Ruins - Battle Shrine (0x2A); Soundtrack #40 (120 s) |
| 57 | 0xEAA2EE | 66 | one-shot | 24.670 | – | setup AI: cave 0x401 (decomp name AIRBASE_OUTRO_LONG) |
| 58 | 0xEAA846 | 170 | 0.006–148.216 | 148.216 | Dark Combat | primary Mr. Blonde's Revenge (special) (0x37); Soundtrack #0 (160 s) |
| 59 | 0xEAB55C | 70 | 0.013–164.561 | 164.561 | Skedar Mystery | Soundtrack #1 (170 s) |
| 60 | 0xEAC12A | 113/120 | 0.000–205.584 | 205.584 | – | **unreferenced** (decomp MUSIC_DEEPSEA_BETA; **a cut stage theme** (hypothesis), *Unused and hidden content*) |
| 61 | 0xEADCD8 | 96 | 2.499–167.438 | 167.438 | CI Operative | primary sevb: unused CI-geometry stage without setup (0x1B); Soundtrack #2 (170 s) |
| 62 | 0xEAFEEC | 87 | 0.011–183.085 | 183.085 | dataDyne Action | Soundtrack #3 (180 s) |
| 63 | 0xEB14DA | 80 | 0.012–197.987 | 197.987 | Maian Tears | primary Maian SOS (special) (0x09); Soundtrack #4 (200 s) |
| 64 | 0xEB3874 | 89 | 0.011–195.195 | 195.195 | Alien Conflict | primary WAR! (special) (0x16); primary end credits (stage 0x5C, hypothesis per stages.md) (0x5C); Soundtrack #5 (197 s) |
| 65 | 0xEB5740 | 100 | one-shot | 74.570 | – | setup AI: tra (decomp name ESCAPE_INTRO) |
| 66 | 0xEB5D7A | 116 | one-shot | 14.324 | – | setup AI: lip (decomp name RESCUE_OUTRO) |
| 67 | 0xEB6424 | 93/94 | one-shot | 56.419 | – | setup AI: eld 0x1002/0x409/0xC00 (both) (decomp name VILLA_INTRO2) |
| 68 | 0xEB7D36 | 94 | one-shot | 51.827 | – | setup AI: eld 0x1002/0x409/0xC00 (both) (decomp name VILLA_INTRO3) |
| 69 | 0xEB905C | 97/98/96/95 | one-shot | 48.365 | – | setup AI: depo, sev, stat, wax (decomp name G5_OUTRO) |
| 70 | 0xEB9E22 | 96/97 | one-shot | 102.494 | – | setup AI: depo (decomp name G5_MIDCUTSCENE) |
| 71 | 0xEBAE5C | 70 | 0.011–68.567 | 68.567 | – | menu track (0x7F0FC9D4 states 1/5, condition) |
| 72 | 0xEBB2AE | 140 | 0.006–38.569 | 38.569 | – | menu track (0x7F0FC9D4 states 3/11) |
| 73 | 0xEBB82A | 135 | 0.006–42.652 | 42.652 | – | menu track (0x7F0FC9D4 when [0x8007FC00]==25) |
| 74 | 0xEBBEBE | 62/67 | one-shot | 47.681 | – | setup AI: azt (decomp name CRASHSITE_INTRO) |
| 75 | 0xEBC41E | 99/97/95/93.. | one-shot | 68.619 | – | setup AI: cave (decomp name AIRBASE_INTRO) |
| 76 | 0xEBCE14 | 57 | one-shot | 64.211 | – | setup AI: lee (decomp name ATTACKSHIP_INTRO) |
| 77 | 0xEBDAD6 | 91/89 | one-shot | 75.502 | – | setup AI: pam (decomp name DEEPSEA_MIDCUTSCENE) |
| 78 | 0xEBED18 | 98/97 | one-shot | 63.012 | – | setup AI: rit (decomp name AIRFORCEONE_INTRO) |
| 79 | 0xEBFA8E | 77/86 | one-shot | 37.560 | – | setup AI: lee (decomp name ATTACKSHIP_OUTRO) |
| 80 | 0xEC049A | 71/77 | one-shot | 61.571 | – | setup AI: tra (decomp name ESCAPE_MIDCUTSCENE) |
| 81 | 0xEC07BC | 74 | one-shot | 58.162 | – | setup AI: lip (decomp name RESCUE_INTRO) |
| 82 | 0xEC0B7C | 73 | one-shot | 58.403 | – | setup AI: pam (decomp name DEEPSEA_INTRO) |
| 83 | 0xEC14CE | 95 | one-shot | 40.406 | – | setup AI: lue (decomp name INFILTRATION_OUTRO) |
| 84 | 0xEC199A | 62 | one-shot | 47.233 | – | setup AI: dam (decomp name PELAGIC_INTRO) |
| 85 | 0xEC1F62 | 116 | one-shot | 12.149 | – | setup AI: tra 0x1021/0x414/0xC02 (decomp name ESCAPE_OUTRO_LONG) |
| 86 | 0xEC2AFC | 59/96/102/101 | one-shot | 76.494 | – | setup AI: imp (decomp name DEFENSE_INTRO) |
| 87 | 0xEC40AA | 56/98 | one-shot | 80.123 | – | setup AI: azt (decomp name CRASHSITE_OUTRO) |
| 88 | 0xEC5AF8 | 125 | 9.600–120.960 | 120.960 | End Credits | primary The Duel (special) (0x4F); Soundtrack #41 (120 s); credits: menu channel after music stage 92 (0x7F13ACE8) |
| 89 | 0xEC720E | 95 | 2.525–63.130 | 63.130 | – | menu track: file select / Carrington Institute & stage 0x5D menus (0x7F0FC9D4; RAM menu3) |
| 90 | 0xEC7B76 | 135 | one-shot | 26.614 | – | setup AI: pam (decomp name DEEPSEA_OUTRO) |
| 91 | 0xEC88BC | 90 | one-shot | 21.520 | – | setup AI: rit (decomp name AIRFORCEONE_MIDCUTSCENE) |
| 92 | 0xEC93C6 | 68 | one-shot | 32.941 | – | setup AI: dam (decomp name PELAGIC_OUTRO) |
| 93 | 0xEC9C3E | 80 | one-shot | 40.131 | – | setup AI: rit (decomp name AIRFORCEONE_OUTRO) |
| 94 | 0xECB7DA | 54/52 | one-shot | 84.096 | – | setup AI: sho (decomp name SKEDARRUINS_INTRO) |
| 95 | 0xECC7E0 | 60 | one-shot | 0.273 | – | **unreferenced** (decomp MUSIC_BETA_NOTE; test, *Unused and hidden content*) |
| 96 | 0xECC802 | 75 | one-shot | 26.166 | – | setup AI: cave (decomp name AIRBASE_OUTRO) |
| 97 | 0xECD2DC | 103/102 | one-shot | 25.723 | – | setup AI: imp (decomp name DEFENSE_OUTRO) |
| 98 | 0xECEB40 | 58/59/56/57 | one-shot | 96.393 | – | setup AI: sho (decomp name SKEDARRUINS_OUTRO) |
| 99 | 0xECFB8C | 60 | one-shot | 63.022 | – | setup AI: eld (decomp name VILLA_OUTRO) |
| 100 | 0xED025C | 180 | 10.666–175.989 | 175.989 | – | setup AI: sho 0x40C (isolated) (decomp name SKEDARRUINS_KING) |
| 101 | 0xED30D4 | 135 | 7.109–138.618 | 138.618 | – | setup AI: dish 0x1035 (isolated) (decomp name CI_TRAINING) |
| 102 | 0xED3C58 | 110 | 0.004–69.796 | 69.796 | – | ambient Crash Site - Confrontation (0x1C) |
| 103 | 0xED45F2 | 160 | 0.005–59.965 | 59.965 | – | menu track (0x7F0FC9D4 state 4 / flag g_Vars+0x314) |
| 104 | 0xED56B4 | 100 | 0.000–67.177 | 67.177 | – | ambient Carrington Villa - Hostage One (0x2C); ambient Pelagic II - Exploration (0x21) |
| 105 | 0xED59D4 | 110 | 0.004–69.796 | 69.796 | – | ambient Air Base - Espionage (0x27) |
| 106 | 0xED6198 | 140 | 5.143–113.136 | 113.136 | – | ambient Chicago - Stealth (0x1D); ambient G5 Building - Reconnaissance (0x1E) |
| 107 | 0xED6982 | 120 | one-shot | 26.001 | – | boot/attract: logos (RAM title2, capture 4-24 s) |
| 108 | 0xED6DE0 | 120 | one-shot | 8.009 | – | file-select screen primary (RAM menu3) |
| 109 | 0xED6EF4 | 100 | 0.008–8.397 | 8.397 | – | ambient Area 51 - Infiltration (0x2F) |
| 110 | 0xED6F50 | 100 | 0.008–91.171 | 91.171 | – | ambient Deep Sea - Nullify Threat (0x38) |
| 111 | 0xED700E | 100 | 0.006–19.194 | 19.194 | – | ambient Air Force One - Antiterrorism (0x31) |
| 112 | 0xED7066 | 120 | 2.000–4.000 | 4.000 | – | ambient Attack Ship - Covert Assault (0x34) |
| 113 | 0xED70B2 | 120 | 0.007–43.997 | 43.997 | – | ambient Skedar Ruins - Battle Shrine (0x2A); ambient WAR! (special) (0x16) |
| 114 | 0xED7244 | 116 | one-shot | 10.900 | – | **unreferenced** (decomp MUSIC_ESCAPE_OUTRO_SFX; cut alternate outro layer (the game uses 85 ESCAPE_OUTRO_LONG), *Unused and hidden content*) |
| 115 | 0xED772C | 110 | 0.007–167.946 | 167.946 | – | ambient Area 51 - Rescue (0x35) |
| 116 | 0xED77FE | 110 | 0.007–167.946 | 167.946 | – | ambient Area 51 - Escape (0x19); ambient Maian SOS (special) (0x09) |
| 117 | 0xED78D2 | 120 | one-shot | 1.627 | – | **unreferenced** (decomp MUSIC_BETA_MELODY; test, *Unused and hidden content*) |
| 118 | 0xED793C | 116 | one-shot | 8.014 | – | **unreferenced** (decomp MUSIC_ESCAPE_OUTRO_SHORT; cut alternate, *Unused and hidden content*) |

## 6. Unused and hidden content

### 6.1 Unreferenced assets

#### Unused content

| Check | Method | Evidence |
|---|---|---|
| crash screen | patched fault thread + forced TLB fault in Defection | `unused/shots/crash_screen_textgrid.txt` |
| boot arguments | `-level_48` injected at the argument parser | `unused/shots/level_arg_48_boot_direct_defection_intro.png` |
| cut stages | pending-stage write (control: 0x26 loads) for 0x1B (twice), 0x14, 0x2E, 0x36, 0x4E, 0x5C | 0x1B and 0x14 crash, 0x2E/0x36/0x4E hang, 0x5C shows the credits: `unused2/shots/warp_*` |
| reference scans | code immediates, lui/addiu pairs, data words, setup bytes, AI lists, BG and model texture references | `unused/strings_code.txt`, `unused2/dumps/textrefs_*.tsv`, `unused3/dumps/*.json` |

Each item has its location, the evidence behind it, a confidence rating (high, medium or low) for the claim that it is
unused or hidden, and whether retail play can reach it. The sources are four catalogues: `notes/unused_debug.md` (part 1),
`notes/unused_text_stages.md` (part 2), `notes/unused_assets.md` (part 3) and `notes/music.md` *Music*. "Unreferenced" is
always relative to a reference scan, and the limits of each scan are noted with it. The public decompilation was used
only to find tables and names; anything that rests on it alone is marked "decomp only".

#### Cut, test and unfinished stages

Stage-table entries with no menu entry (verified: stage table, file table, md5 grouping of stub files; the table and all
these files are byte-identical in U, E and J):

| Stage | Code | Files | Content | Loads? | Confidence |
|---|---|---|---|---|---|
| **0x1B** | sevb | **Carrington Institute BG and tiles** (`bg_dish`), stub pads (0 pads), stub setups; text bank `Lsevb`; stage-music row track 61 | **The cut special assignment "Retaking the Institute".** `Lsevb` (the bank `stageToBank(0x1B)` loads) holds "Retaking the Institute.\nLead the team and clean out the building.", "Kill All Enemy Agents", and the placeholder objectives "Do Something Else" / "And Something Else". The menu name 0x56A9 is translated in all languages (G "Die Übernahme", F "Sauver l'Institut", S "Retomando el Instituto", I "Il riscatto dell'istituto", J 協会の奪回) but referenced nowhere in U, E or J. An early mission list in the U "J" text slot reads "Mr. Blonde's Revenge, Maian SOS, Retaking the Institute, WAR!, The Duel" | **no**: hangs (from Defection) or crashes to the exception vector 0x80000184 (from CI) in two emulator runs (`unused2/shots/warp_1b_sevb_*`) | high |
| 0x14 | silo | the Skedar arena's BG, tiles and pads (`bg_oat`); stub setups | GoldenEye "Silo" slot pointing at Skedar geometry, no objects. Render: `bg/renders/oat_overview.png` | **no**: crash to the exception vector (PC 0x80000180, stage 0x14, table index 1) (`unused2/shots/warp_14_silo/`) | high |
| 0x2E | ash | `bg_ash.seg` (0x660): a one-room placeholder like the 0x200 stubs, plus 0xAC0 bytes of 16-bit colour-like words in its primary block (meaning low) | placeholder | **no**: hang, no frame for 5 min (PC 0x7003B1C0 in lib) (`unused2/shots/warp_2e_ash/`) | high (structure) |
| 0x36 | len | stub BG; `UsetuplenZ`/`Ump_setuplenZ` 0x50 (intro only) | unique stage-table scale fields (+0x14 0.1004, +0x1C 6.684) and entries in both memory-argument tables: purpose unknown | **no**: hang, no frame for 6 min (PC 0x7003B054) (`unused2/shots/warp_36_len/`) | high (files) |
| 0x4E | old | stub BG; `UsetupoldZ` 0x330: three tagged Area 51 crates with no pad and one shared AI list | a minimal test setup (hypothesis, medium) | **no**: hang, no frame for 6 min (PC 0x70027B54) (`unused2/shots/warp_4e_old/`) | high |
| 0x18, 0x1A, 0x23, 0x24, 0x28, 0x2B, 0x4D, 0x50, and the MP slots mp2, mp6–8, mp14, mp16–20 | arch, dest, run, sevx, cat, sevxb, uff, lam | stubs only (GoldenEye stage slots Archives, Frigate, Runway, Surface; 0x28 even selects the Pelagic text bank) | nothing to show | not tested | high |

- **Environment records for cut stages:** fog records exist for 0x24 and 0x2B (`sevx`/`sevxb`), and a no-fog record
  for 0x1A has water on (*Environment table (verified: disassembly 0x7F165D40/0x7F16574C/0x7F165A0C, ROM data, RAM live struct = record in every capture)*). They are leftovers of stages whose BGs are stubs. High.
- **Code-only stages 0x5B, 0x5C, 0x5D are reachable:**
  - 0x5B, the Controller Pak menu: `li a0,91` in 6 places.
  - 0x5C, the credits: `li 92` at 0x7F017170 and 0x7F10DAE8.
  - 0x5D, the no-Expansion-Pak menu: `li a0,93` in 4 places.
  - Emulator: a forced load of 0x5C shows the end credits (staff names over a starfield, `unused2/shots/warp_5c_credits/`); 0x5B and 0x5D were not load-tested. None of the cut stages loads with a RAM warp, so their files can only be shown statically (e.g. the silo and sevb BGs in the viewer).
- **"Rooftop" (0x5081), a Combat Simulator arena name:** translated in all languages (G "Dächer", F "Toit", S "Tejado",
  I "Tetto", J 屋上) but with no arena record, file name, text bank or reference in U, E or J. Which stage it was is
  unknown. High for the orphan string.
- **Unused stage files:**
  - `bg_wax_padsZ` equals `bg_ame_padsZ` apart from one garbage u16 per cover record. It is an export from another tool
    session; Mr. Blonde's Revenge uses the ame pads.
  - `UsetupsevxbZ` is a byte-identical stub.
  - 12 stub BG/tiles/pads files are referenced by no stage record.
  - All high.

#### Debug features left in the retail code

| Item | Where | Evidence | Confidence | Reachable |
|---|---|---|---|---|
| **Crash screen "Another Perfect Crash (tm)"**: FPU and CPU registers, TID/EPC/cause, the IRIX host command `dshex -a …`, a stack trace | printer 0x7000C548; text grid 71 × 30 at `[0x8005D994]`; renderer 0x7000CF54 | the printer has no caller, the fault thread only records the thread, the grid is never allocated and the glyph bitmaps are gone. **Emulator:** after patching the fault thread to call the printer and forcing a TLB fault in Defection, the complete report was written to the grid (`unused/shots/crash_screen_textgrid.txt`; offline render with a PD font: `unused/shots/crash_screen_textgrid_offline_render.png`). The framebuffer shows only the blank text box, confirming the missing font | high | no |
| **Developer boot arguments**: `-level_NN`, `-hard N`, `-play N`, `-coop`, `-anti`, `-mpbots`, `-nomp3`, `-d`, `-s`, `-j` (Japanese text slot), `-nochr/-noprop/-noobj`, `-mpwpnset`, `-forceversion`, `-scrub`, memory args | read from ROM 0x1FFFF00 only if stub 0x7002FA08 returns 0; it always returns 1 | disassembly. **Emulator:** injecting `-level_48` boots straight into the Defection intro, skipping title and menus (`unused/shots/level_arg_48_boot_direct_defection_intro.png`) | high | no |
| 124 named debug variables (`debugdoors`, `wallhit`, radar/HUD, rain/snow, PD-controller gains, menu colours…) | registered through the empty stub 0x7000DB30; list `unused/debugvars.tsv` | disassembly; no editor exists. The Controller Pak actions `pakdump`, `wipeeeprom`, `corruptme`, `dumpeeprom` are still polled (effects from function names, not tested) | high | debugger only |
| ROM "RAM patch" table: eight `RamPatchRecord` entries with blobs copied into RAM | ROM 0x1D65740, loader 0x7F082D74 | the code runs; the table is zero in all four revisions | high (purpose low) | runs, loads nothing |
| about 600 compiled-out debug printf strings (`AISOUND: …`, `BriGun: …`, `vtxstore: GROSS! CorspeCount > MAX_CORPSES`, `MUSIC(Play) : SERIOUS -> Out of MIDI channels`) | lib/game rodata | string scan with code/data cross-references | high | no |
| anti-tamper checksum in the cheat-menu handler (corrupts boot code if modified) | 0x7F107970 | disassembly (not tested) | medium-high | yes, silently |
| searched for and **not** found: a GoldenEye-style debug menu, level select, free camera, collision/portal overlay, profiler | full string dump and joypad-mask scan | – | high (strings), medium (computed button masks) | – |

`RamPatchRecord` (`0x08` bytes):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `u32` | `destination` | RAM destination address. |
| `0x04` | 4 | `u32` | `length` | Blob length in bytes. |

#### Cheats

- **Cheat table:** 0x80073A90, 42 records:

  | Offset | Size | Type | Field | Description |
  |---:|---:|---|---|---|
  | `0x00` | 2 | `u16` | `nameText` | Cheat-name text ID. |
  | `0x02` | 2 | `u16` | `time` | Unlock time. |
  | `0x04` | 1 | `u8` | `soloIndex` | Solo-mission index. |
  | `0x05` | 1 | `u8` | `difficulty` | Required difficulty. |
  | `0x06` | 1 | `u8` | `flags` | Cheat flags. |

  All 42
  entries are named and unlockable. Unlock conditions for each are in `unused/cheats_table.md`: target times,
  mission completion, firing-range golds for the classic guns, or Game Boy Perfect Dark in a Transfer Pak (Hurricane
  Fists, Cloaking Device, All Guns in Solo, R-Tracker). Verified, high.
- **Dead "auto-apply" path:** stage start forces the active bit for cheats with flag 0x01, but no entry has that
  flag (0x7F1075B8). High; not reachable.
- **GoldenEye cheat names and messages in `LmiscE` 0x5800–0x5843:** "Super x2 Health", "Phase", "Tiny", "Silver PP7",
  "Gold PP7", "Paintball Mode On", "Happy?", "Line Mode", "Turbo Mode" and others, plus GoldenEye messages ("OBJECTIVES
  FAILED - abort mission.", "Guard Greeting", "What's that gun?"). No code immediate or table references them. High;
  not reachable.

#### Characters and heads

| Item | Evidence | Confidence | Reachable |
|---|---|---|---|
| **`CtestchrZ`**: a man in a red suit, standing in a natural pose (not the splits bind pose) and at about 1/60 of the other bodies' units, i.e. an early test character | body table entry 0x70; no setup, AI, code-table or decompilation reference; `unused3/renders/chars_unreferenced.png` | high | no |
| **`CheadgreyZ`**: a greyscale photo-textured face | entry 0x15, no reference | high | no |
| `Cpresident_cloneZ` (headless President-clone body; setups use `Cpresident_clone2Z`) | entry 0x84, no reference | high | no |
| **older character versions outside the body table:** `Ca51guardZ` (brown/white Area 51 guard), `CelvisZ` (a naked grey Maian body with blue hands), `Cdd_shockZ` (dark blue shock trooper, replaced by `CddshockZ`) | file table vs body table; no reference | high | no |
| `CheadthekingZ` (Elvis-style head), used only by a code head swap | decomp only | medium | code |
| every developer ("Perfect Head" staff) head is used in the 75-entry MP head table; the Bond bodies (Connery, Dalton, Moore, Brosnan tuxedos) are MP bodies | code tables located by byte match | high | yes |

#### Weapons and items (weapon table 0x8006FF18)

| Item | Evidence | Confidence | Reachable |
|---|---|---|---|
| **"Tester" (weapon 0x33, `GtestgunZ`)**: a developer test weapon with a name and a grenade-like model (black knurled cylinder, silver blade) | no setup, intro, AI or MP-table reference | high (code not excluded) | no |
| **"Suicide Pill" (weapon 0x5D)**: a name and a weapon slot, but no model | no reference | high | no |
| **`GjoypadZ`**: a model of an N64 controller (838 triangles) in no weapon definition | no reference | high | no |
| weapons 0x59 and 0x5A with empty names (decompilation names CHOPPERGUN and WATCHLASER) | no reference | medium | no |
| the classic guns CC13 … RC-P45 (GoldenEye gun models) appear in no setup, AI list or MP table; they are reachable only through the Classic Guns cheats | usage scan; the code path is decomp only | medium | yes (cheats) |

#### Setup data

- **19 object types never used in any of the 121 setups**, though the setup loop still handles them: ALARM, HANGINGMONITORS,
  HAT, GRENADEPROB, OBJECTIVE_DESTROYOBJ, OBJECTIVE_THROWOBJ, OBJECTIVE_ENTERROOM, OBJECTIVE_THROWINROOM, GASBOTTLE,
  PADLOCKEDDOOR, TRUCK, HELI, SAFE, SAFEITEM, TANK, and the unnamed 0x10/0x1F/0x22/0x29. TANK has a length but no placement
  branch. Most are GoldenEye setup types kept in the format (hypothesis). High.
- **GoldenEye briefing text inside PD multiplayer setups:**
  - `Ump_setupdamZ` holds GoldenEye's Dam briefing ("B Y E L O M O R Y E  D A M", "mi6 has confirmed the existence of a
    secret chemical warfare facility at the arkhangelsk dam…").
  - `Ump_setuppeteZ` holds GoldenEye Streets text ("use the stolen tank to chase the car containing natalya…").
  - Verified from ROM bytes (`unused3/dumps/Ump_setupdamZ_tail.txt`). High; not reachable.
- **V1.1 change:** `UsetupaztZ` (Crash Site) gains one short AI command in list 0x0C01. Verified byte diff; the meaning is
  open.
- **No object is excluded on all four difficulties.** Eight objects sit on pads outside every room's bounding box
  (e.g. an Area 51 crate shared by three stages). Low–medium that they are hidden.
- **Solo setup on an MP stage:** `Usetupmp10Z` (Sewers) holds 3 object records. **Test setup:** `UsetupoldZ` (stage 0x4E)
  places three crates with no pad. High.
- **AI debug labels inside setups:** 322 strings in 20 solo setups, e.g. "DR CHANGELIST", "TELEPORT FAIL", "BUG C1".."C4",
  "PLLACED WRONG", "COOP PLLACED WRONG", "EPROMFLAG NOTSET", "BACK TO ELVIS", "LIMO READY TO GO", "shot 1..8"
  (`unused2/dumps/setup_strings.txt`). High that they are strings; their effect in retail was not traced.
- **Pre-text-bank format:** `Ump_setuppeteZ` stores its GoldenEye briefing and objective texts as file-relative string
  pointers instead of text ids. The tank sentence appears nowhere in GoldenEye (U) (all 706 decompressed GE files
  searched), and the Dam text is an earlier draft than GoldenEye's retail text ("arkhangelsk dam", "destroyed without
  prejudice", a different bungee paragraph). High.

#### Text and strings

Text files (all three ROMs dumped: `unused2/text/{U,E,J}/`; reference scan `unused2/scripts/textrefs.py` over code
immediates, data u16/u32 and every byte offset of every setup. A string is "NONE" when no id reference was found: 303
of 3,573 English strings in U. NONE is strong for stage banks; the global banks also compute ids, so NONE there is only a
candidate):

| Item | Where | Evidence | Confidence | Reachable |
|---|---|---|---|---|
| **The U ROM's "J" text slot is an older English draft**, not Japanese; 2,388 of 3,644 strings differ from the E slot. `LwaxJ` "You are Mr Blonde. Stop mincing around and capture cassandra.", the GoldenEye Moneypenny line "Underground in Siberia, James? Some of us don't get further than the Northern Line.", "Assasinate Datadyne Head Of Security"; `LstatJ` "Mopping Up The Skedar Homeworld", "Elvii Leader Has Been Killed."; `LsevJ` "Destroy Captured Maian Saucer", "Sabotage Enemy Medical Experiment"; `LateJ` "Joanna's Graduation Test - The Duel"; CamSpy called "Eye Spy"; "Pelagic 2" | slot comparison `unused2/dumps/diff_U_E_vs_U_J.txt` | high | no (NTSC code reads slot +1 only when `[0x80084120] != 0`, i.e. the `-j` boot argument) |
| dropped licence credits and slogan: "RAD Game Tools, Inc. MPEG Layer-3 audio compression technology", "licensed by Fraunhofer IIS and THOMSON multimedia", **"rare designs on the future <<<"** | `Loptions` #90–92; present only in the draft J slot of U and E, empty in every shipped slot | high | no |
| the U "P" slot is a PAL-English edit ("Night Sight", "PAL version 8.7 final") that the E ROM did not ship | slot comparison | medium–high | no |
| **GoldenEye cheat list** `LmiscE` 0x5800–0x5843 (61 strings; *Cheats*) is removed in E and J, which shifts all later `Lmisc` ids; E/J also move 198 CI strings from `Lmisc` to `Ldish` | revision diff | high | no |
| GoldenEye item names in `LpropobjE`: "explosive pen", "explosive case", "flare", "piton", "stick(s) of dynamite", **"GoldenEye key"** | NONE | high | no |
| GoldenEye gun real names ("PP7", "TT33", "Skorpion", "AK47", "Uzi 9mm", "MP5K", "M-16", "FNP90") in `LdishE` | referenced by `UsetupdishZ` AI lists (probably firing-range lines); display not verified | high (strings) | ? |
| cut or renamed weapon and gadget names in `LgunE`: "MagSec SMG", "MaianGrenade", "FlashBang" (cf. the unused `PchrflashbangZ` model), "Alien Medpack", "Big King Rocket", "JonesCorp", "Data Uplink", and attachments "Silencer", "Telescopic Sight", "Magazine Extension" | NONE | medium | no |
| cut mission lines (NONE in stage banks): Area 51 Rescue autopsy scene ("What the hell do you think you're doing? This is supposed to be a sealed room!…", "Director Easton will hear about this, young lady."), Escape ("That specimen is government property and should not leave the base.", "Inner hangar door is closing."), Air Force One "Unable to detach UFO.", Chicago "Greetings, citizen.", G5 "CamSpy has been destroyed - abort mission.", CI "Switch Code 1..4 has been obtained.", Pelagic "Cripple the engines and the ship will drift... Perfect!", Deep Sea "Antibody masking has been obtained." | stage-bank scan | medium | no |
| sound-direction notes written as subtitles: "Machinery scream sound Fx." (`LearE`), "Gasps, chokes, and wheezes." (`LtraE`); placeholders "NULL3".."NULL7" (`LameE`) | NONE / coincidental hits | high | no |
| build page strings "NTSC version 8.7 final" (U), "PAL version 8.7 final" (E), "Japanese version 8.7 final" (J), with "NUS-NPDE-USA", "Rare Ltd. (twycross)" | referenced by a menu record at data 0x80062658 (used) | high (used) | yes |
| **Japanese encoding (J ROM):** bytes < 0x80 are ASCII; otherwise the code is `c = (lead & 0x7F) << 7 \| (trail & 0x7F)`, a 16×12 4bpp glyph at J ROM `0x178C40 + (c + 24) × 0x60`. Japanese names render correctly: データダイン本社, ミスター・ブロンド, 協会の奪回, 屋上 (`unused2/font/j_stage_names.png`) | J disassembly 0x7F154C3C, 0x7F16E7C8 + renders | high | J |
| **an older, smaller Japanese glyph set in the U and E ROMs** (U ROM 0x194440 small 16×12, 0x19FB40 large 16×16), still addressed by U code (0x7F16E1BC) but never used, because U text is 7-bit ASCII; J has neither | U disassembly + renders `unused2/font/u_small_try_16x12.png` | high | no |

Code and data segment strings (`unused/strings_code.txt`, 1,992 runs):
- **Build dates:** `Apr  6 2000 15:05:01` in V1.0 and, identically, in V1.1. E is `Apr 28 2000`, J `Jul 19 2000`. High.
- **GoldenEye source names and leftovers:** `bondwalk.c`, `bondmove.c`, `bondgrab.c`, `bondeyespy.c`, `bondbike.c`;
  `ai_ifbondintank: tank code has been removed.`; `set shot list(void) doesn't work for …truck!/heli!`; `BOND IN ROOM`. High.
- **Developer tags (initials only):** `RWI : Door Stuck Mate -> Sort it out`, `DGD WARNING: portalAVInit no portals!`,
  `(BNC:Menu) findItem Warning`, `RUSSES SOUND GUARD STRING`. High.
- **Humour:** `PakDamage_UjiWipedMyAss`, `Cam -> Save Failed - Cant get it small enough - oo-er`,
  `OI! DUPLICATE FILE NAME! NO!`, `Hand : Look ma no hands!`. High.
- **PerfectHead (Game Boy Camera face mapping):**
  - About 110 menu strings ("PerfectHead Editor", "Take A Picture Now", "Shape Head", "Your Mission heads will now
    appear in any of the missions you play.") have no reference.
  - The camera and face-compression code remains (`camdraw.c`, `Pak_StartCapture`, `Cam_DctUnCompressSlot`, `GBCHead`).
  - The removed menus are high confidence; whether the code is still reachable is medium; no retail route.
- **Cut multiplayer scenario "Touch That Box" / "Boxes":** a 7th scenario name with "Boxes Options" and "Boxes on
  Radar" strings, but no entry in the 6-entry scenario table at 0x80087148. High that it is unreferenced, medium that
  it was a scenario.
- **"Test" and "4mb Test"** strings with no reference. Medium: text ids can be computed.

### 6.2 Cut or inaccessible levels

### 6.3 Debug features

### 6.4 Prototype or revision-specific content

## 7. nviewer implementation

### 7.1 Module mapping

#### Proposed viewer level list

- **Groups:**
  - "Mission 1" … "Mission 9", then "Special Assignments": 21 levels, each with its own pads and setup even when the
    BG is shared.
  - "Carrington Institute": 1.
  - "Combat Simulator – Dark" and "Combat Simulator – Classic": 13 + 3 levels.
  - "Unused": 0x14 silo and 0x1B sevb (real geometry, no setup).
- **Names:** the menu names above. `Level.id` = the stage code plus the stage id (e.g. `ame-30`).
- **Hidden:** entries with stub BGs.
- **Setup:** the solo setup for missions, the hub and special assignments; the multiplayer setup for arenas.
- **Counts:** 41 table entries over 31 distinct BG files have real geometry. 38 of them are reachable from menus.

#### Building viewer meshes

- One `Mesh` per room (room-local positions, opaque and translucent blocks in the same mesh, batches carry `blend`),
  one `Instance` per room with `matrix = translate(room.pos)` and `info = {room, fileOffset}`. Mesh radius and
  `Level.bounds` from the section-3 boxes.
- Sky rooms (*How the game draws a frame, environment, fog and sky (verified: 13 RDRAM captures with frame display lists, disassembly)*) go to `Level.skies`.
- Environment-mapped surfaces: normals from the colour entries with the room lights, or draw them with their vertex
  colour treated as white (the prototype's approximation, visibly wrong on chrome).
- Textures: one viewer `Texture` per (texture number, wrap mode).
- Start camera: the first SPAWN pad + 112 units up (the eye ends 159 units above the floor), looking along the pad's look
  vector (*Placement (verified against RAM: rotations 238/285, positions 257/285; doors 45/46 and 44/46)*).
- Per-stage numbers (all verified):

| Code | Stage(s) | Rooms | Portals | Lights | Leaf lists | Triangles | Textures |
|---|---|---|---|---|---|---|---|
| ame | dataDyne Central (Defection, Extraction, Mr. Blonde's Revenge) | 167 | 295 | 327 | 298 | 19,780 | 118 |
| ear | dataDyne Research | 110 | 133 | 135 | 132 | 14,276 | 88 |
| eld | Carrington Villa | 149 | 304 | 58 | 205 | 17,211 | 114 |
| pete | Chicago | 106 | 128 | 63 | 191 | 8,205 | 98 |
| depo | G5 Building | 98 | 149 | 76 | 226 | 6,734 | 81 |
| lue | Area 51 (Infiltration, Rescue, Escape, Maian SOS) | 270 | 345 | 416 | 527 | 36,350 | 112 |
| cave | Air Base | 146 | 199 | 61 | 192 | 13,380 | 67 |
| rit | Air Force One | 103 | 123 | 116 | 172 | 21,577 | 72 |
| azt | Crash Site | 101 | 163 | 9 | 109 | 12,511 | 73 |
| dam | Pelagic II | 129 | 156 | 202 | 280 | 26,961 | 123 |
| pam | Deep Sea | 195 | 207 | 107 | 260 | 27,967 | 138 |
| dish | Carrington Institute (+ Defense, The Duel) | 140 | 178 | 161 | 188 | 11,519 | 78 |
| lee | Attack Ship | 113 | 127 | 265 | 152 | 30,245 | 89 |
| sho | Skedar Ruins (+ WAR!) | 137 | 191 | 82 | 238 | 15,395 | 70 |
| oat | MP Skedar (+ stage 0x14) | 66 | 81 | 0 | 68 | 2,246 | 15 |
| crad | MP Pipes | 76 | 106 | 0 | 104 | 2,141 | 13 |
| arec | MP Ravine | 41 | 51 | 0 | 47 | 804 | 24 |
| cryp | MP G5 Building | 35 | 53 | 0 | 55 | 2,298 | 22 |
| mp10 | MP Sewers | 85 | 104 | 0 | 99 | 2,535 | 24 |
| mp4 | MP Warehouse | 48 | 63 | 0 | 75 | 2,583 | 30 |
| mp15 | MP Grid | 32 | 44 | 0 | 35 | 1,562 | 18 |
| mp9 | MP Ruins | 103 | 121 | 15 | 113 | 2,149 | 31 |
| mp3 | MP Area 52 | 41 | 59 | 0 | 42 | 2,326 | 19 |
| mp1 | MP Base | 52 | 63 | 0 | 65 | 2,391 | 25 |
| mp12 | MP Fortress | 118 | 137 | 0 | 150 | 5,962 | 28 |
| mp13 | MP Villa | 70 | 79 | 0 | 70 | 2,882 | 25 |
| mp5 | MP Car Park | 40 | 53 | 0 | 115 | 1,912 | 15 |
| jun | MP Temple | 25 | 37 | 0 | 31 | 1,272 | 12 |
| ref | MP Complex | 44 | 60 | 0 | 74 | 2,559 | 17 |
| mp11 | MP Felicity | 39 | 53 | 0 | 53 | 4,954 | 37 |
| ash | unused stage 0x2E | 1 | 0 | 0 | 1 | 40 | 2 |

(Rooms exclude room 0.)

**Pitfalls found:** (1) don't inflate a BG file as one stream; locate room streams through room pointers; (2) room 0
is unused and the last room entry is an end marker; (3) vertex colours are indexed through `G_COL` + the vertex byte;
(4) `G_VTX`/`B1` layouts differ from F3DEX 1.x; (5) `C0` is file-only, textures are not uploaded by the lists;
(6) compare texture texels, not raw pool bytes (padding the game never writes); (7) some rooms are skies with their own
projection; (8) the dataDyne Central overview looks exploded because its rooms really are spread out (tower floors,
city backdrop boxes).
(9) coplanar overlapping room triangles (verified by a scan of all 31 BGs, `../impl/pd_zf/scan.ts`):
- The data has 2,627 triangles that can z-fight when BG is drawn double-sided: 1,276 surfaces modelled from both sides
  (opposite-facing, usually in two rooms, with `G_CULL_BACK`), 899 same-side overlaps within a room, 309 across rooms, and
  211 translucent triangles lying on solid ones.
- The game hides them through back-face culling and draw order (the later draw passes the RDP depth test).
- Room draw order (verified in frames): the first BG call per room has non-decreasing portal-hop depth from the camera's
  room in 10 of 12 captured frames. Villa and Skedar Ruins draw script-shown rooms first.
- For cross-room overlaps, the viewer takes the copy the game would show from where the player sees the surface. It
  counts votes from playable eyes in front of the surface: a room counts only where the surface point lies in one of the
  clip boxes of the portals it is reached through (the game scissors each room to those). If both rooms count, the deeper
  one (drawn later) gets the vote.
  - Chicago rooms 73/77: from the stairs landing, room 73's copy (vertex colours black at two corners) is drawn later but
    clipped away, so room 77's lit grate shows. Viewer bug report 0001: ignoring the clipping had made the black copy win.
- With no clear vote (e.g. a surface nobody sees from play, like Air Base's roof parapet in viewer bug report 0002) the
  data gives no order: the viewer keeps the lower room number's copy. A copy beaten by k rooms moves k units behind, so
  three or more copies of one surface don't fight either.
- The viewer's `coplanar.ts` applies these rules: a 1-unit nudge towards the front, decals for later draws, hidden
  triangles dropped, and losing cross-room copies moved behind.
- 25 triangles remain: 6 opposite-facing, 11 same-room, 5 cross-room and 3 translucent.

#### What's practical in the viewer

| Content | Practicality |
|---|---|
| static props (BASIC, KEY, crates, DEBRIS, monitors, CCTV, autoguns, shields, fans, escalator steps) | **easy**: one Mesh per model file, one Instance per record (*Placement (verified against RAM: rotations 238/285, positions 257/285; doors 45/46 and 44/46)*) |
| glass, tinted glass | **easy**: blended meshes |
| doors | **easy** closed; open states need door motion |
| lifts | **easy** at their start stop |
| floor weapons | **easy** (`Pchr*` world models); MP weapon-set slots 0xF0..0xFE as markers |
| characters | **medium**: body + head posed with the body type's stand animation frame 0 (*Animations and standing characters (verified: lib `anim.c` disassembly, all 1,207 table records, joint matrices vs RAM)*), placed at the pad with floor snap; or markers labelled with body/head names |
| hovercars, choppers, hoverbikes, hover props | positioned by AI paths at run time: show at their pad or as markers |
| pads, spawns, MP case/hill pads, PADEFFECT, waypoints | markers (layer "markers") |
| objectives, tags, briefings, links | info only |
| CAMERAPOS | extra camera views |
| difficulty | filter by `flags2` (a difficulty selector in the UI, default Agent) |
| first-person guns (G*) | not needed for levels (they contain muzzle-flash geometry toggled by code) |

**Pitfalls found:** transposed look-at basis; ignore the root joint offset of placed objects; the vertex colour byte is
a byte offset into the colour table (which follows the vertices); `G_VTX`/TRI4 layouts; INTPOS pads are 8 bytes; the
bbox fit uses the model-state scale before extraScale and normalises by the maximum; floor snap +4 (not weapons);
setups in RAM are live objects (parse the ROM files); links are relative indices; flag 0x4000 objects use the pad
field as a chr number.

#### Reusable modules

| Existing module | Reuse for PD | Changes |
|---|---|---|
| `inflate.ts` `inflateRaw` | every rarezip stream (`off + 5`, size from the header) | none (verified on all 1,405 streams, *Compression: rarezip "1173" (verified bit-exact against the game)*) |
| `displaylist.ts` | only the combiner fold (`evalCombine`) and render-mode → Batch rules | PD's microcode differs (*Display lists (verified: opcode histogram of all 4,367 leaf lists; decoded identically by the frame-DL walker; renders)*): write a PD interpreter instead of a third ucode |
| `texture.ts` | the swizzle rule, formats and embedded model tiles (*Model files `P*Z`, `C*Z`, `G*Z` (verified: loader and relocation disassembly; all 686 models parse with 0 unknown opcodes and 0 missing textures)*) | global textures need `TMEM` > 4 KiB or the PD decoder (`bg/lib/pdtex.ts`) producing RGBA directly |
| `src/rom/music/libultra.ts` `parseBank`, `renderSequence` | music bank and sequences (*Music*) | add a `squareVolume?: boolean` render option (PD passes `false`) |
| `src/rom/music/cseq.ts` `parseCompressedSequence` (per-track loops) | all 119 sequences | none; Bomberman's `parseCompressedMidi` loop rule is wrong for Perfect Dark (*Rendering offline (prototype verified against game audio)*) |
| `util.ts` `pruneUnused`, `emptyBounds` | level assembly | none |

#### New modules (suggested)

| File | Contents | Source prototype | Size |
|---|---|---|---|
| `src/rom/perfectdark/rom.ts` | data segment inflate, file table and names, stage table, text banks (`langGet`) | `obj/lib/rom.ts`, `stages/*.py` | ~150 lines |
| `src/rom/perfectdark/texture.ts` | global texture list and both texture decoders (zlib palette, bitstream methods), pool layout → RGBA | `bg/lib/pdtex.ts` | ~600 lines |
| `src/rom/perfectdark/gbi.ts` | Rare F3DEX variant interpreter: `04` VTX (12-byte, slot bits), `07` colour arrays, `B1` TRI4, `BF` TRI1/10, `C0` texture references, embedded tiles, geometry/other modes, `01` G_MTX slots (models) → `Batch[]` | `bg/lib/pdbg.ts` `buildRoomBatches`, `obj/lib/model.ts` | ~300 lines |
| `src/rom/perfectdark/bg.ts` | BG container, rooms, sky rooms, section 3 bounds → room meshes and instances | `bg/lib/pdbg.ts` | ~250 lines |
| `src/rom/perfectdark/setup.ts` | pads, setup props list, intro spawns, placement math, difficulty filter | `obj/lib/pads.ts`, `setup.ts`, `place.ts`, `stage.ts` | ~500 lines |
| `src/rom/perfectdark/model.ts` | model files (nodes, LOD, rest pose / animation pose, head attachment) → meshes | `obj/lib/model.ts` (+ `anim/`) | ~400 lines |
| `src/rom/perfectdark/perfectdark.ts` | `Game`: level list (*Proposed viewer level list*), `loadLevel` (BG + setup + env), music list | – | ~250 lines |
| `src/rom/perfectdark/music.ts` | sequence table, song names (*Song list*), `decodeMusic` | `music/render.ts` | ~120 lines |

#### Additions to `types.ts` (proposals)

- None required for a first version (Mesh/Instance/Sky/Fog/LevelLayer/Marker/CameraView cover it).
- Optional: `Level.cameras?: CameraView[]` for CAMERAPOS cutscene cameras and MP spawn pads; a per-level
  `difficulty` filter would need `Instance.info.flags2` plus a UI selector.
- `Batch` needs no new fields: environment-mapped surfaces can be approximated by treating their colour entries as
  white, or supported with a `textureGen` normal channel later.

#### Environment and sky in the viewer

- `Level.clearColor` = environment sky colour (*Environment table (verified: disassembly 0x7F165D40/0x7F16574C/0x7F165A0C, ROM data, RAM live struct = record in every capture)*): fog record if the stage has one, else no-fog record, else the
  default record −1.
- `Level.fog` for fog-table stages:
  - `color` = sky colour;
  - `multiplier = 128000/(fogMax − fogMin)`, `offset = (500 − fogMin)·256/(fogMax − fogMin)`;
  - `near`/`far` from the record. For the three 0.5-scale stages, divide by the world scale when rendering in BG units
    (hypothesis).
- `Level.skies`:
  - sky rooms (*Sky*, *Building viewer meshes*);
  - when `cloudsOn`, a generated cloud disc (*Sky*), and a water disc when `waterOn`.
  - `Sky` needs a "follow camera in x/z only" flag and world-space UVs; alternatively bake a large disc around the level
    centre (the 300000 clamp makes the difference small).
- `Level.camera`: the first SPAWN pad + 112 units up, looking along the pad's look vector (*Placement (verified against RAM: rotations 238/285, positions 257/285; doors 45/46 and 44/46)*).
- The player struct's camera at `[0x8009A244] + 0x1BB0` gives world-space eye positions when capturing new reference
  views.

#### Difficulty

| Part | Difficulty | Notes |
|---|---|---|
| ROM access, rarezip, file table, stage list, text | low | all formats verified; prototypes exist |
| global textures | medium | two decoders with many methods; prototype matches RAM texels |
| BG geometry | medium | PD-specific GBI interpreter; prototype renders match the game camera |
| props, doors, glass, weapons | medium | placement math is intricate but verified against 285 RAM objects |
| characters | medium | animation decoder (verified port exists) + stand animation per body type (*Animations and standing characters (verified: lib `anim.c` disassembly, all 1,207 table records, joint matrices vs RAM)*) |
| environment (fog, sky, clear colour) | low–medium | tables fully decoded; the cloud/water sky needs a generated camera-following disc with the colour formula (*Sky*) |
| music | low | existing libultra renderer + one volume option; verified against game audio |
| animated textures, env-mapped chrome, portals, dynamic lights | not planned | cosmetic; see *Open questions* |

#### Corrections found during implementation

0. **Envelopes:** n_audio ramps voice volume linearly (`n_env.c` `_getRate`), starting a note's attack at volume 1;
   the viewer renders with `linearRamps` (verified: capture correlation improves on the pause menu, seq 3, and the
   Combat Simulator match, seq 62; slow attacks and long releases, e.g. the pause menu's pads, were too brief with
   exponential ramps). Seq 3 is the pause-menu music (RAM while paused).

Found while implementing objects and characters (checked against the research RAM captures and frames):
1. **Stand animations:** the labels are swapped. Anim 1 is the two-handed-gun stand; 106 is one-handed, two guns or
   unarmed. Weapon definition +0x4C & 8 means one-handed (Crash Site guards with Avengers run anim 1, Villa's unarmed
   secretary 106).
2. **Display-list node colour table:** it starts at `vertices + align8(vertexCount × 12)`, not right after the
   vertices. All 2,867 nodes then end exactly at their rodata; the old reading shifted colours for 816 nodes (the
   black Attack Ship door).
3. **Floor snap:** objects snap to collision and to the top of objects below them, not to pad height; objects on
   objects get no +4 (room floors +4, weapons +0).
4. **Heads and difficulty:** heads attach only to skeleton-9 bodies; random heads come from 0x80062B68 (male) and
   0x80062C58 (female), body 104 from 0x80062C8C. Character spawn flags 0xE0 list the allowed difficulties.
5. **Toggle nodes** are switched by code; the first sibling matches 5 of 6 toggle models seen in frames.
6. Multiplayer ammo crates after a no-ammo slot are not created; object records with pad < 0 are AI-moved cutscene
   props.
7. **Music loops:** see *Rendering offline (prototype verified against game audio)* (tracks loop independently).

### 7.2 Supported features

### 7.3 Approximations and omissions

## 8. Verification and remaining work

### 8.1 Verification evidence

#### Model files `P*Z`, `C*Z`, `G*Z` (verified: loader and relocation disassembly; all 686 models parse with 0 unknown opcodes and 0 missing textures)

Pointers use `0x05000000 + fileOffset`; display lists likewise use segment 5 as the file base.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `+0x00` | 4 | `ptr` | `rootNode` | — |
| `+0x04` | 4 | `u32` | `skeleton id` | — |
| `+0x08` | 4 | `ptr` | `parts` | Node pointers followed by `s16` part numbers. |
| `+0x0C` | 2 | `s16` | `numParts` | — |
| `+0x0E` | 2 | `s16` | `numMatrices` | — |
| `+0x10` | 4 | `f32` | `radius-like size` | — |
| `+0x14` | 2 | `s16` | `rwDataLen (set at load)` | — |
| `+0x16` | 2 | `s16` | `numTexConfigs` | — |
| `+0x18` | 4 | `ptr` | `texConfigs` | Array of 12-byte texture configurations defined below. |

Texture configuration (`0x0C` bytes):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `u32` | `texture` | Global texture number or `0x05xxxxxx` embedded-texel pointer. |
| `0x04` | 1 | `u8` | `width` | Texture width. |
| `0x05` | 1 | `u8` | `height` | Texture height. |
| `0x06` | 6 | unknown | `unknown06` | Remaining configuration bytes. |

Model node (`0x18` bytes):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | `u16` | `type` | Node type is the low byte. |
| `0x02` | 2 | `u16` | `unknown02` | Unknown. |
| `0x04` | 4 | `ptr` | `rodata` | Type-specific read-only data. |
| `0x08` | 4 | `ptr` | `parent` | Parent node. |
| `0x0C` | 4 | `ptr` | `next` | Next sibling. |
| `0x10` | 4 | `ptr` | `prev` | Previous sibling. |
| `0x14` | 4 | `ptr` | `child` | First child. |

| Node | Name | Function |
|---|---|---|
| 0x01 | CHRINFO | Character root and matrix slot. |
| 0x02 | POSITION | Joint-relative position and matrix slots. |
| 0x04 | GUNDL | Opaque/translucent gun display lists. |
| 0x08 | DISTANCE | Distance LOD; draws `target` when `near ≤ distance < far`. |
| 0x09 | REORDER | Draws two subtrees in camera-dependent order. |
| 0x0A | BBOX | Hit-part bounds; the first BBOX supplies the placement bounds. |
| 0x0C / 0x16 | CHRGUNFIRE / STARGUNFIRE | Muzzle flash. |
| 0x12 | TOGGLE | Code-controlled subtree visibility. |
| 0x15 | POSITIONHELD | Position node used by held objects. |
| 0x17 | HEADSPOT | Separate head-model attachment. |
| 0x18 | DL | General opaque/translucent display-list node. |
| 0x19 | unnamed | Four to six points, probably collision for lifts and desks. |

Known rodata fields:

| Node | Offset | Size | Type | Field | Description |
|---|---:|---:|---|---|---|
| CHRINFO | `0x00` | 2 | `u16` | `animationPart` | Animation-part index. |
| CHRINFO | `0x02` | 2 | `s16` | `matrixIndex` | Root matrix slot. |
| CHRINFO | `0x04` | 4 | `f32` | `unknown04` | Unknown. |
| CHRINFO | `0x08` | 2 | `u16` | `rwDataIndex` | Runtime-data index. |
| POSITION | `0x00` | 12 | `f32[3]` | `position` | Position relative to the parent joint. |
| POSITION | `0x0C` | 2 | `u16` | `part` | Skeleton part. |
| POSITION | `0x0E` | 6 | `s16[3]` | `matrixIndex` | Matrix-slot indices. |
| POSITION | `0x14` | 4 | `f32` | `drawDistance` | Hypothesized draw distance. |
| GUNDL | `0x00` | 4 | `ptr` | `opaqueDl` | Opaque display list. |
| GUNDL | `0x04` | 4 | `ptr` | `translucentDl` | Translucent display list. |
| GUNDL | `0x08` | 4 | `ptr` | `base` | Segment-5 base. |
| GUNDL | `0x0C` | 4 | `ptr` | `vertices` | Vertex array. |
| GUNDL | `0x10` | 2 | `s16` | `vertexCount` | Vertex count. |
| DISTANCE | `0x00` | 4 | `f32` | `near` | Near LOD distance. |
| DISTANCE | `0x04` | 4 | `f32` | `far` | Far LOD distance. |
| DISTANCE | `0x08` | 4 | `ptr` | `target` | Target subtree. |
| BBOX | `0x00` | 4 | `s32` | `hitPart` | Hit-part index. |
| BBOX | `0x04` | 24 | `f32[6]` | `bounds` | Minimum and maximum X, Y, and Z. |
| TOGGLE | `0x00` | 4 | `ptr` | `target` | Target subtree. |
| TOGGLE | `0x04` | 2 | `u16` | `rwDataIndex` | Runtime visibility-data index. |
| POSITIONHELD | `0x00` | 12 | `f32[3]` | `position` | Position relative to the parent. |
| POSITIONHELD | `0x0C` | 2 | `u16` | `part` | Skeleton part. |
| POSITIONHELD | `0x0E` | 2 | `s16` | `matrixIndex` | Matrix-slot index. |
| DL | `0x00` | 4 | `ptr` | `opaqueDl` | Opaque display list. |
| DL | `0x04` | 4 | `ptr` | `translucentDl` | Translucent display list. |
| DL | `0x08` | 4 | `ptr` | `base` | Segment base. |
| DL | `0x0C` | 4 | `ptr` | `vertices` | Vertex array. |
| DL | `0x10` | 2 | `s16` | `vertexCount` | Vertex count. |
| DL | `0x12` | 2 | `s16` | `unknown12` | Unknown. |
| DL | `0x14` | 2 | `u16` | `rwDataIndex` | Runtime-data index. |
| DL | `0x16` | 2 | `u16` | `colorCount` | Color count; the color table follows the vertices. |
| unnamed 0x19 | `0x00` | 4 | `s32` | `pointCount` | Four to six. |
| unnamed 0x19 | `0x04` | 48 | `f32[12]` | `points` | Point data. |

**Display lists** use the same Rare microcode as BG lists (*Display lists (verified: opcode histogram of all 4,367 leaf lists; decoded identically by the frame-DL walker; renders)*) plus: `01020040 03xxxxxx` G_MTX = load modelview
matrix slot `(w1 & 0xFFFFFF) / 0x40` (segment 3 = the model's matrix array; the following vertices are relative to
that joint), `G_VTX` from segment 4 (DL node vertices) or 5 (GUNDL, file offset), `07` colours from segment 6 (DL
node colour table) or 5, `BF` TRI1 (index = byte / 10, 403 uses), and **embedded textures** as ordinary
`FD SETTIMG 05xxxxxx` + `F3`/`F5`/`F2`/`F0` tile commands (1,341 uses; decodable with the viewer's `texture.ts`) next to
`C0` global texture references. The xlu list is the translucent pass.

**Rest pose:** slot k = sum of POSITION offsets from the root to the node owning slot k (CHRINFO = origin). Humanoid
bodies are authored in a **"splits" bind pose** (arms and legs along ±X; `obj/renders/chars_sheet.png`); Skedar
models look natural in it. Heads are separate models (`Chead*`) attached at the body's HEADSPOT joint; body scale
`0.1 × body.scale`. Standing poses come from an animation frame (*Animations and standing characters (verified: lib `anim.c` disassembly, all 1,207 table records, joint matrices vs RAM)*).

#### Stages and text

| Check | Method | Result | Evidence |
|---|---|---|---|
| stage table fields | loader disassembly + file-load breakpoints | Defection (0x30) loads tiles/BG/setup/text/pads 0x14C, 0x1C, 0x126, 0x570, 0x14B; Skedar arena (0x32) loads the MP setup `Ump_setupoatZ` | `stages/bp_defection_named.tsv`, `stages/bp_skedar_named.tsv`, `stages/shot_skedar.png` |
| stage ids in RAM | RAM reads and warps to 9 stages | current stage 0x8005D9B4, pending 0x8005DD54 | `notes/warp.md` |
| text container and ids | disassembly of `langGet`; all 476 files of U, E and J parse | – | `unused2/text/{U,E,J}/` |
| Japanese glyphs | J disassembly + renders | stage names render correctly | `unused2/font/j_stage_names.png` |

### 8.2 Known unknowns

#### Open questions

Everything here is unverified.

**ROM and files**
- The u16 before each game page stream is never read; its meaning is unknown.
- The contents of the loaded ROM block 0x7EBDC0 (title code, segment 2) are unidentified.
- A-file (MP3) playback, and the PI-level read patterns of sound effects and samples, were not traced.
- Non-file ROM regions (animations, textures, audio) were not compared across revisions.

**Stages**
- Meaning of stage-table fields +0x02..+0x05, +0x14/+0x1C (0x36 `len`), +0x20..+0x34.
- Which setup Co-op and Counter-op load. Arena unlock numbers.
- What the environment override ids (stage + 900, 200/238/300/338/400/438) are used for.

**Geometry and rendering**
- Environment-mapped surfaces: how PD generates their UVs and shade (normals verified).
- Semantics of the portal flags and BG visibility commands; the room draw order; the parent-block plane records.
- Detail textures (`C0` subcommands 0/1), code-animated textures (water, monitors), light-record fields.
- What drives the run-time dimming of vertex colours (light records, room brightness).
- Whether sky rooms stay unfogged on a stage that has both fog and a sky room.
- Sky: the exact cloud texel phase and axis order, the water texture decode, suns and lens flares (code only), Defection's star field routine, and the global texture numbers of the sky texture list.

**Objects and characters**
- Chr spawn-flag difficulty mapping; TOGGLE default visibility (muzzle flashes); secondary matrix slots.
- Door fields +0x74/+0x78/+0xC8, DOORSCALE axes, lift stop pads, LINKLIFTDOOR layout; waypoint and path layouts.
- The exact floor snap: the game raycasts collision; the pad height is off by up to 28 units in 3 of 70 cases.
- Animations: record flag 0x08 and the scalar channel (hypothesis: cutscene camera tracks), the s16 list before the remap pairs (event frames?), where unarmed characters get their first animation, whether first-person gun/hand animations use the same system, and left/right part labels.

**Music**
- What exactly triggers X music; the Combat Simulator track rotation timer.
- The reverb (FX) parameters.
- The sound-effect bank beyond its header, and code-started sound effects (no unused-SFX list claimed).
- Whether title sting seq 1 plays.

**Unused content**
- Why the cut stages 0x1B, 0x14 (crash) and 0x2E, 0x36, 0x4E (hang) fail to load; the meaning of the 16-bit block in `bg_ash.seg`.
- Which title-logo parts load.
- Whether the jungle texture run 0xBA0–0xBC5 comes from GoldenEye.
- Whether any PerfectHead code path is reachable.
- The effects of the `-d`/`-s` boot arguments and of the Controller Pak debug actions.

### 8.3 References
