# The Legend of Zelda: Ocarina of Time and Majora's Mask (N64): ROM format specification for the level viewer

This document specifies what is needed to add the two N64 Zelda games to the viewer, as one loader family detected
generically, plus an Ocarina of Time prototype identified by hash:
- ROM identification and version detection for OoT US 1.0, OoT Master Quest (GameCube debug build), MM US and MM debug PAL;
- boot and code layout, the dmadata file table, Yaz0, and the tables in `code` a loader needs;
- the level list (scenes, rooms, alternate headers), names from the ROMs and a proposed sidebar;
- scene and room formats, display lists, textures, draw configs and animated materials, collision and waterboxes;
- actors and objects: placement, static scenery recipes and markers;
- environment: skyboxes, light settings, fog, time of day, start positions and cameras;
- music: audio tables, the sequence driver compared with the Star Fox 64 and Yoshi's Story ports, the song list;
- the mapping onto `src/rom/`, verification evidence and open questions;
- the Ocarina of Time alpha stored in the upper half of an F-Zero X development ROM (§11).

**Evidence labels:**
- **Verified:** checked against ROM bytes (decoded data, disassembly) or the running game (emulator RAM, screenshots,
  captured audio, offline render compared with a screenshot); the method is named.
- **Doc:** from the zeldaret decompilations (`oot`, `mm`), the sw97 project or community documentation; the source is named.
- **Leak:** from the partial source trees in `~/bbgames/z_ocarina`, `z_ocarina2`, `z_majora`.
- **Hypothesis:** inference.

Unused or hidden content was deliberately not searched for in the four retail/debug ROMs. The alpha ROM is the
exception: it is prototype data throughout, and §11 lists what differs from retail.

**Research material** is under `/home/n64/.ai-tmp/r49/zelda/`:

| path | contents |
|---|---|
| `roms/` | symlinks to the five ROMs |
| `extracted/<rom>/` | every dmadata file of the four ROMs, decompressed, with `table.tsv` |
| `tools/` | `zfs.py` (extractor), `yaz0` (C decoder) |
| `fs/` | filesystem verification, code tables, scene lists, map select lists |
| `lead/` | level names and tables, actor classification and recipes, scene dumps, the assembler of this document |
| `scenes/` | scene/room/environment research renderer (`render.ts`, patched `dl/displaylist.ts`), side-by-side renders |
| `scene-oot/`, `scene-mm/`, `env/`, `actors/` | censuses and parsers from the first round |
| `ref/<rom>/` | reference screenshots with RAM sidecars (camera, player, lights) |
| `runs/` | emulator run directories with RAM dumps |
| `music/` | audio tables, driver comparison, research renderer, WAVs, audio captures (`cap/`) |
| `alpha/` | the F-Zero X / OoT alpha ROM (`v2/` scripts, `renders/`) |
| `drafts/` | the section drafts this document was assembled from |
| `oot-decomp/`, `mm-decomp/` | shallow clones of zeldaret/oot and zeldaret/mm |

Unless marked otherwise, ROM offsets are into the big-endian `.z64` file, "file N" is a dmadata index, "code +0x..." is an
offset into the decompressed `code` file, and RAM addresses are KSEG0 (0x80...).

## 0. At a glance

| topic | summary |
|---|---|
| ROMs | OoT US 1.0 (32 MiB, `CZLE`), OoT MQ GameCube debug (64 MiB, `NZLE`), MM US (32 MiB, `NZSE`), MM debug PAL (64 MiB, `NZSP`, big-endian despite `.rom`); one build string `zelda@...` + build date per ROM |
| filesystem | dmadata right after the build string: 16-byte `{vromStart, vromEnd, romStart, romEnd}` records; Yaz0 per file (OoT MQ debug uncompressed); files addressed by VROM everywhere |
| code tables | found by structure in `code`: scene table (0x14 bytes OoT / 0x10 MM), actor overlay table, object table, entrance tables, map select list; `code` VRAM computed from `boot` |
| levels | a level is a scene (segment 2) plus room files (segment 3): OoT US 101 scenes / 388 rooms, MQ debug 110 / 401, MM 102 / 299 (debug PAL 113 ids / 310); names from MM message data, OoT/MM map select lists and the decomps |
| layers | alternate headers: OoT child day / child night / adult day / adult night / cutscenes; MM setups; default layer 0 at noon |
| geometry | F3DEX2 display lists in world space (1 unit = 1 world unit, right-handed, Y up, no mirroring), mesh types 0/1/2, prerendered JPEG backgrounds in OoT interiors |
| display-list changes | direct texture fetch instead of the 4 KB tile memory, TLUT memory, F3DEX2 BRANCH_Z, caller-supplied initial combiner/prim/env, second texture per batch; renderer: two-texture lerp, half-texel offset |
| dynamic materials | OoT: 53 draw-config functions in code (static frame table in §5.4); MM: animated material lists in the scene file |
| environment | light settings per scene (ambient, sun, moon, fog, zFar), time-of-day blending, sky cube textures (OoT vr_*, MM d2 sky with colour tables); verified equal to RAM in all captures |
| actors | 16-byte placement records (MM with degree rotations, half-day masks); ~40 static prop/background recipes per game cover ~85 % of static instances; skeletal and logic actors as markers |
| music | same EAD driver family as Star Fox 64 / Yoshi's Story (3 updates per frame, maxTempo 10770) with a different opcode layout, 8 IO ports, filters, comb filter, 2-bit ADPCM and per-scene reverb specs; OoT 110 sequence ids, MM 128; renders match captured game audio in 11 scenes; recommended as a new module `music/zelda64.ts` |
| verification | offline renders of 9 captures match the emulator to a mean error of 1.7-4.7 (8 captures); tables found generically in all four ROMs |
| alpha | F-Zero X dev cartridge, md5 95bf2153aaad6faff3fb42fecd2f0200: 52 scenes / 145 rooms of a late-1997 OoT at ROM 0x10FA150-0x19A4470, no file table or code, F3DEX 1.x display lists, raw RGBA16 backgrounds, 12-byte waterboxes, no audio |
| difficulty | filesystem, tables, level list, scenes/rooms, environment, collision: low; display-list changes, draw configs, skies, static actors, music: medium; prerendered backgrounds: medium-high; the alpha: low once the retail loader exists (§9) |

## 1. ROM identification and version detection

| ROM | file | size | md5 | sha1 | header code / title | build string (ROM offset) | dmadata (ROM offset, entries) |
|---|---|---|---|---|---|---|---|
| OoT US 1.0 | `Legend of Zelda, The - Ocarina of Time (U) (V1.0) [!].z64` | 32 MiB | 5bd1fe107bf8106b2ab6650abecd54d6 | ad69c91157f6705e8ab06c79fe08aad47bb57ba7 | `CZLE` rev 0, `THE LEGEND OF ZELDA` | `zelda@srd44` `98-10-21 04:56:31` @0x7400 | 0x7430, 1510 (1456 Yaz0, 54 raw) |
| OoT MQ debug | `Zelda no Densetsu - Toki no Ocarina - Master Quest (J) (Debug Version).z64` | 64 MiB | 8ca71e87de4ce5e9f6ec916202a623e9 | 50bebedad9e0f10746a52b07239e47fa6c284d03 | `NZLE` rev 15, `THE LEGEND OF ZELDA` | `zelda@srd022j` `03-02-21 00:16:31` @0x12F40 | 0x12F70, 1532 (all raw) |
| MM US | `Legend of Zelda, The - Majora's Mask (U) [!].z64` | 32 MiB | 2a0a8acb61538235bc1094d297fb6556 | d6133ace5afaa0882cf214cf88daba39e266c078 | `NZSE` rev 0, `ZELDA MAJORA'S MASK` | `zelda@srd44` `00-07-31 17:04:16` @0x1A4D0 | 0x1A500, 1552 (1513 Yaz0, 22 raw, 17 absent) |
| MM debug PAL | `_folders/rare-roms/ZELDA_Majoras_Mask_Debug_PAL.rom` | 64 MiB | 02f963fa8f95e3a7f0b6c13d81999ba9 | 55541662a192c66e34a011d4bf6f4a0ec69899ae | `NZSP` rev 1, `ZELDA MAJORA'S MASK` | `zelda@srd44` `00-09-29 09:29:05` @0x24F30 | 0x24F60, 1575 (1519 Yaz0, 39 raw, 17 absent) |

**Verified** (`xxd` of the headers, `md5sum`/`sha1sum`, a search for `zelda@` over each whole file: exactly one hit per ROM,
`fs/verify_dma.py`). All four files are in big-endian z64 byte order, including the `.rom` file (first word `0x80371240`).

Detection, generically (no hashes):

1. **Byte order:** first word `80 37 12 40` = z64, `37 80 40 12` = v64 (swap each byte pair), `40 12 37 80` = n64 (reverse
   each 32-bit word). **Doc** (N64 ROM conventions); only z64 occurs in these files.
2. **Zelda engine:** find the ASCII `zelda@` (followed by the builder id, a NUL, and a `YY-MM-DD HH:MM:SS` build date).
   The file table follows within 0x100 bytes: the first 16-byte record equal to `{0, 0x1060, 0, 0}` (the `makerom` entry).
   It is at build string + 0x30 in all four ROMs. **Verified** (ROM bytes).
3. **Game:** the scene table record size, found by structure in the `code` file (below): 0x14 bytes = OoT, 0x10 = MM.
   Cross-check: header game code letters `ZL` (OoT) / `ZS` (MM). **Verified**.
4. **Debug vs retail:** the actor overlay table's name pointers are non-zero in debug builds (OoT debug: 429 actors, MM
   debug: 575) and zero in retail. Debug ROMs are also 64 MiB. OoT MQ debug additionally has every file uncompressed and a
   file name table in `boot`. **Verified** (`fs/tables-*.json`, ROM bytes).
5. **Master Quest:** the MQ debug ROM's dungeon scenes (0x00-0x09, 0x0B, 0x0D) and some boss rooms have different scene and
   room files from OoT US 1.0 (MQ layouts). Of the 101 common scenes, 76 have byte-identical rooms and 69 also have
   identical scene files (room-list VROMs masked). Nine overworld scenes (Kakariko 0x52, Graveyard 0x53, Kokiri Forest 0x55,
   Lake Hylia 0x57, Zora's Fountain 0x59, Gerudo Valley 0x5A, Death Mountain Trail 0x60 and Crater 0x61, Lon Lon Ranch
   0x63) and one fairy fountain differ too: several of their rooms were rebuilt from one mesh entry into cullable type-2
   meshes with the same actors and objects (§5.7). **Verified** (md5 of every scene and room file, lead's
   comparison script in this session; `scenes/ootcmp.py`); "MQ layouts" is **doc** (the build is the GameCube Master Quest
   debug build; the emulator capture of the Deku Tree showed the MQ variant, `ref/oot-mqdbg/deku-tree-mq-1`).
6. A loader should present the version it found: game, retail/debug, build date string (unique per build).

## 2. Boot and code

| ROM | entry point | `boot` bss start + size (from the entry code) | `code` file (index, VROM, size, storage) | `code` VRAM |
|---|---|---|---|---|
| OoT US 1.0 | 0x80000400 | 0x80006830 + 0x4910 | 27, 0xA87000, 0x103D30, Yaz0 | 0x800110A0 |
| OoT MQ debug | 0x80000400 | 0x80012370 + 0x4A30 | 28, 0xA94000, 0x13AF30, raw | 0x8001CE60 |
| MM US | 0x80080000 | 0x80099500 + 0x63B0 | 31, 0xB3C000, 0x13E4E0, Yaz0 | 0x800A5AC0 |
| MM debug PAL | 0x80080000 | 0x800A3F60 + 0xC7E0 | 49, 0xC95000, 0x17D600, Yaz0 | 0x800B6AC0 |

- Files 0/1/2 are `makerom` (ROM header + IPL3, 0x1060 bytes), `boot` (loaded at entry point + 0x60: 0x80000460 for OoT,
  0x80080060 for MM) and `dmadata`. Audio files are 3/4/5 in all four ROMs (§8.1).
- **`code` VRAM** = `(bootBssStart + bootBssSize + dmadataSize + 0x1F) & ~0x1F`. `bootBssStart`/`size` come from the first
  instructions at ROM 0x1000 (`lui t0; addiu t0` = bss start; `li t1` or `lui/ori t1` = size). **Verified**: the formula
  gives an address under which the actor profiles of the internal actors (in `code`) carry their own ids, for all four
  ROMs (`fs/tables.py`: `profileIdMatchesInternal = 3`). The loader only needs it for VRAM pointers inside `code` (MM entrance
  tables, actor profiles, debug names); scene, object and actor overlay tables store VROM ranges.
- **Finding `code`:** the only file containing a run of at least 60 scene-table records whose VROM pairs match dmadata files.
  In that file, by structure (`fs/tables.py`, **verified** in all four):

| table | record | OoT US 1.0 (code offset, VRAM, count) | OoT MQ debug | MM US | MM debug PAL | how to find |
|---|---|---|---|---|---|---|
| scene table | OoT 0x14 `{RomFile scene; RomFile title; u8 unk10; u8 drawConfig; u8 unk12; u8 pad}`, MM 0x10 `{RomFile scene; u16 titleTextId; u8 unkA; u8 drawConfig; u8 unkC; pad}` | +0xEA440, 0x800FB4E0, 101 | +0x10CBB0, 0x80129A10, 110 | +0x11E1E0, 0x801C3CA0, 113 (102 set) | +0x1562B0, 0x8020CD70, 113 | run of records whose RomFile is a dmadata file; OoT drawConfig < 0x40 |
| entrance table (OoT) | 4: `{s8 scene; s8 spawn; u16 flags}` | +0xE8BF0, 1556 | +0x10B360, 1556 | - | - | ends at the scene table; first record `00 00 41 02` |
| scene entrance tables (MM) | 0xC: `{u8 count; ptr table; ptr name}` | - | - | +0x11FC60, 110 | +0x157D38, 110 | run of such records with pointers into `code` |
| actor overlay table | 0x20 (§6.1) | +0xD7490, 471 | +0xF9440, 471 | +0x109510, 690 | +0x140A50, 690 | run starting with the 3 internal actors' records |
| object table | 8: RomFile | +0xE7F58, 402 | +0x10A6C8, 402 | +0x11CC80, 643 | +0x154D50, 643 | longest RomFile run; entry 0 empty |
| effect overlay table | 0x1C | 37 | 37 | 39 | 39 | similar to the actor table (do not confuse) |
| game state table | 0x30 | 6 | 6 | 7 | 7 | contains the map select overlay (state 1) |

The map select overlay (`ovl_select`, game state 1) is present in all four ROMs, including retail, and holds the map select
list: 12-byte records `{char* name; func; u32 entrance}` (OoT US: 118 entries, MQ debug: 126, MM: 143). **Verified** (`fs/maps.py`).

## 3. Filesystem and compression

**dmadata** (**verified**, `fs/verify_dma.py` decodes every file with an independent Yaz0 decoder and compares with the extraction):

- 16-byte records `{u32 vromStart, vromEnd, romStart, romEnd}`, terminated by a record with vromStart = vromEnd = 0 (after
  record 0). Entry 2 describes the table itself.
- `romEnd == 0`: stored uncompressed, `romStart` .. `romStart + size`. `romStart == 0xFFFFFFFF` (and `romEnd == 0xFFFFFFFF`):
  file absent from this ROM (MM: 17 entries, e.g. indices 8, 9, 21, 652, 1539-1551 in MM US). Otherwise Yaz0 data at
  `romStart .. romEnd` decompressing to `vromEnd - vromStart` bytes.
- Game data refers to files only by VROM (`RomFile {vromStart, vromEnd}` pairs in `code`, scene room lists, etc.), so a
  loader indexes files by `vromStart` (or by the exact pair).
- VROM ranges are contiguous and ascending in the retail ROMs, with many files padded to 0x1000 boundaries. The MQ debug
  table is not sorted by ROM offset in two places (records 27 and 1069). Do not assume ordering.
- Compressed ROMs store files in ROM order with `romStart != vromStart` for most raw files (OoT US: 47 of 54).
- Compressed sizes are multiples of 4.

**Yaz0** (**verified** by decoding all 4488 compressed files): header `"Yaz0"`, `u32` decompressed size, 8 zero bytes; then
groups of a code byte (MSB first; 1 = copy one literal byte, 0 = back-reference) and references `b1 b2`: distance
`((b1 & 0x0F) << 8 | b2) + 1`, length `b1 >> 4` + 2, or when `b1 >> 4 == 0` a third byte + 0x12. This is the same Yaz0 as
other Nintendo EAD games; `src/rom/` has no Yaz0 decoder yet (small; the SF64 module uses MIO0).

**File names:** only OoT MQ debug has them: a table of string pointers in `boot` (find the string `makerom\0`, then the
pointer to it in `boot` at its load address 0x80000460 - 0x1060; 1532 names, identical to the decomp's list). MM debug PAL
has no name table (no `makerom\0` string). Retail ROMs have none. Names for other versions can be derived: code-table owners
give file names (scene files `<name>_scene`, rooms `<name>_room_N` / MM `<name>_room_NN`, objects, overlays): **verified**
equal to the true names for 1011 (OoT US), 1020 (MQ debug) and 1183 (MM US) files (`fs/tables.py` vs the decomps'
`segments.csv` / the debug name table).

## 4. Levels

### 4.1 Scene list and names

A level is a scene: a scene file plus the room files listed by its command 0x04 (8-byte RomFile records). **Verified**
(`fs/scenes.py`): OoT US 1.0 101 scenes / 388 rooms; OoT MQ debug 110 scenes / 401 rooms; MM US 102 scenes (11 unset ids) /
299 rooms; MM debug PAL 113 ids / 310 rooms (the 11 ids unset in US all point to one extra debug-only file, dmadata 1559,
with one room and 9 non-cutscene setups; not examined further).

Names from the game's own data:

- **MM:** each scene-table record has a message id (`titleTextId`, 0x100-0x149) of the area name shown on entry. The English
  message table is in `code` (8-byte records `{u16 id; u8 typePos; u8 0; u32 0x08xxxxxx offset}`, ascending, ended by id
  0xFFFF; MM US: code +0x1210D8, 4589 messages) pointing into `message_data_static` (dmadata 29); text starts 11 bytes into
  a message and ends at byte 0xBF. This names 70 of the 102 MM scenes (e.g. 0x6F "South Clock Town", 0x2D "Termina Field");
  the rest have no title (boss rooms, moon, cutscene maps) or share one (Zora Cape shows "Great Bay Coast"). **Verified**
  (ROM bytes, `lead/levels.py`). The MM debug PAL ROM keeps its message tables in another layout (not located; its scene
  ids and files match US one-to-one, so the US names apply by id).
- **OoT:** area names are title-card textures (`g_pn_*` files referenced by the scene table), not text. The ROMs' map
  select lists (Japanese kana, or `SPOTnn` for the overworld) give a name for most scenes (**verified**, ROM bytes).
  English names come from the decomp's scene enum (**doc**).
- Map select names exist for MM too (Japanese). The tables below list all three.

### 4.2 Alternate headers (layers)

- A scene or room header may contain command 0x18: a list of segment pointers to alternate headers; slot `k` is used for
  layer `k + 1`, layer 0 is the main header. Room files have their own 0x18 lists that follow the same layer number.
  **Verified** (`fs/scenes.py`; no alternate header changes a scene's room list in any of the four ROMs), **doc** (z_scene.c).
- **OoT layers:** 0 child day, 1 child night, 2 adult day, 3 adult night, 4+ cutscene layers (entrance cutscenes; layer =
  4 + cutscene index). A null slot falls back: layer 1 or 2 -> main header; layer 3 -> the adult day header if present,
  else the main header. **Doc** (`oot-decomp/src/code/z_scene.c` Scene_CommandAlternateHeaderList, `z_play.c`).
- **MM setups:** layer = the low 4 bits of the entrance; a null slot uses the main header; there is no age/night meaning.
  Time of day is handled by the actors' half-day masks and the environment. **Doc** (`mm-decomp/src/code/z_scene.c`).
- **Viewer default:** layer 0 (child day for OoT, setup 0 for MM) at noon. The View panel offers the non-empty OoT
  layers 1-3 (child night, adult day, adult night: e.g. Kakariko Village and Lon Lon Ranch have all four) and the
  non-cutscene MM setups (a few scenes: North Clock Town, Termina Field, Romani Ranch, Snowhead, Path to Mountain
  Village, Clock Tower rooftop). Alternate setups are hidden from the sidebar. Cutscene layers remain unavailable.
- Several places are separate scenes per state rather than layers, and group naturally as variants of one level: OoT Market,
  Market Entrance, Back Alley and Temple of Time exterior (day / night / ruins), Castle Courtyard (day / night); MM Southern
  Swamp (poisoned 0x45 / cleared 0x00), Mountain Village (0x50 / 0x5A), Goron Village (0x4D / 0x48), Twin Islands (0x5D / 0x5E),
  Stone Tower (0x58 / 0x59), Stone Tower Temple (0x16 / 0x18).

### 4.3 Proposed sidebar

`LevelInfo.kind` / `group` as in the tables: `hub` for overworld regions (grouped by region), `adventure` for dungeons,
`boss` for boss rooms, `other` for interiors, grottos, cutscene and test maps. One entry per scene; layer variants as
extra entries directly after the main one (e.g. "Kakariko Village (adult, night)"), or as a variant selector if the UI gets
one. The test maps (MQ debug 0x65-0x6D) and the MM debug placeholder scene only appear for debug ROMs.

The full tables follow (generated from ROM data by `lead/leveltables.py`; group assignment and the English names
without a ROM title are the lead's proposal / **doc**).

### 4.4 Scene tables

#### Ocarina of Time: scenes (OoT US 1.0: 0x00-0x64; MQ debug: 0x00-0x6D)

Name = decomp scene enum, title-cased (**doc**); map select = the name in the ROM's own map select list (**verified**, ROM bytes; Japanese/romanised). Rooms and layers from the scene files (**verified**); layers list the non-empty alternate headers of the scene (cutscene layers counted).

| kind / group | id | file | name | map select (ROM) | rooms | layers |
|---|---|---|---|---|---|---|
| hub / Hyrule Field and Castle | 0x51 | spot00_scene | Hyrule Field | SPOT00 | 1 | child day, child night, adult day + 9 cutscene |
| hub / Hyrule Field and Castle | 0x63 | spot20_scene | Lon Lon Ranch | SPOT20 | 1 | child day, child night, adult day, adult night + 8 cutscene |
| hub / Hyrule Field and Castle | 0x5F | spot15_scene | Hyrule Castle | SPOT15 | 1 | child day |
| hub / Hyrule Field and Castle | 0x64 | ganon_tou_scene | Outside Ganon's Castle |  | 1 | child day + 1 cutscene |
| hub / Castle Town | 0x1B | entra_scene | Market Entrance Day | じょうかまち いりぐち | 1 | child day |
| hub / Castle Town | 0x1C | entra_n_scene | Market Entrance Night |  | 1 | child day |
| hub / Castle Town | 0x1D | enrui_scene | Market Entrance Ruins |  | 1 | child day |
| hub / Castle Town | 0x1E | market_alley_scene | Back Alley Day | うらろじ | 1 | child day |
| hub / Castle Town | 0x1F | market_alley_n_scene | Back Alley Night |  | 1 | child day |
| hub / Castle Town | 0x20 | market_day_scene | Market Day | じょうかまち | 1 | child day |
| hub / Castle Town | 0x21 | market_night_scene | Market Night |  | 1 | child day |
| hub / Castle Town | 0x22 | market_ruins_scene | Market Ruins |  | 1 | child day |
| hub / Castle Town | 0x23 | shrine_scene | Temple Of Time Exterior Day | ときのしんでん まえ | 1 | child day |
| hub / Castle Town | 0x24 | shrine_n_scene | Temple Of Time Exterior Night |  | 1 | child day |
| hub / Castle Town | 0x25 | shrine_r_scene | Temple Of Time Exterior Ruins |  | 1 | child day |
| hub / Castle Town | 0x45 | hairal_niwa_scene | Castle Courtyard Guards Day | ハイラルにわゲーム | 1 | child day |
| hub / Castle Town | 0x46 | hairal_niwa_n_scene | Castle Courtyard Guards Night |  | 1 | child day |
| hub / Castle Town | 0x4A | nakaniwa_scene | Castle Courtyard Zelda | ハイラルなかにわ | 1 | child day + 3 cutscene |
| hub / Kokiri Forest and Lost Woods | 0x55 | spot04_scene | Kokiri Forest | SPOT04 | 3 | child day, adult day, adult night + 10 cutscene |
| hub / Kokiri Forest and Lost Woods | 0x5B | spot10_scene | Lost Woods | SPOT10 | 10 | child day, adult day + 1 cutscene |
| hub / Kokiri Forest and Lost Woods | 0x56 | spot05_scene | Sacred Forest Meadow | SPOT05 | 1 | child day, adult day + 2 cutscene |
| hub / Kakariko and Death Mountain | 0x52 | spot01_scene | Kakariko Village | SPOT01 | 1 | child day, child night, adult day, adult night + 5 cutscene |
| hub / Kakariko and Death Mountain | 0x53 | spot02_scene | Graveyard | SPOT02 | 2 | child day, child night, adult day, adult night + 2 cutscene |
| hub / Kakariko and Death Mountain | 0x60 | spot16_scene | Death Mountain Trail | SPOT16 | 1 | child day, adult day + 5 cutscene |
| hub / Kakariko and Death Mountain | 0x61 | spot17_scene | Death Mountain Crater | SPOT17 | 2 | child day, adult day + 2 cutscene |
| hub / Kakariko and Death Mountain | 0x62 | spot18_scene | Goron City | SPOT18 | 4 | child day, adult day + 2 cutscene |
| hub / Zora's River and Lake Hylia | 0x54 | spot03_scene | Zora's River | SPOT03 | 2 | child day, adult day |
| hub / Zora's River and Lake Hylia | 0x58 | spot07_scene | Zora's Domain | SPOT07 | 2 | child day, adult day + 1 cutscene |
| hub / Zora's River and Lake Hylia | 0x59 | spot08_scene | Zora's Fountain | SPOT08 | 1 | child day, child night, adult day + 3 cutscene |
| hub / Zora's River and Lake Hylia | 0x57 | spot06_scene | Lake Hylia | SPOT06 | 1 | child day, adult day + 2 cutscene |
| hub / Gerudo | 0x5A | spot09_scene | Gerudo Valley | SPOT09 | 1 | child day, adult day + 3 cutscene |
| hub / Gerudo | 0x5D | spot12_scene | Gerudo's Fortress | SPOT12 | 2 | child day, adult day, adult night + 3 cutscene |
| hub / Gerudo | 0x5E | spot13_scene | Haunted Wasteland | SPOT13 | 2 | child day |
| hub / Gerudo | 0x5C | spot11_scene | Desert Colossus | SPOT11 | 1 | child day, adult day + 2 cutscene |
| adventure / Dungeons | 0x00 | ydan_scene | Deku Tree | ようせいのきの ダンジョン | 12 | child day |
| adventure / Dungeons | 0x01 | ddan_scene | Dodongos Cavern | ドドンゴ ダンジョン | 17 | child day |
| adventure / Dungeons | 0x02 | bdan_scene | Jabu-Jabu's Belly | きょだいぎょ ダンジョン | 16 | child day + 1 cutscene |
| adventure / Dungeons | 0x03 | Bmori1_scene | Forest Temple | もりのしんでん | 23 | child day |
| adventure / Dungeons | 0x04 | HIDAN_scene | Fire Temple | ひのしんでん | 27 | child day |
| adventure / Dungeons | 0x05 | MIZUsin_scene | Water Temple | みずのしんでん | 23 | child day |
| adventure / Dungeons | 0x06 | jyasinzou_scene | Spirit Temple | じゃしんぞう ダンジョン | 29 | child day |
| adventure / Dungeons | 0x07 | HAKAdan_scene | Shadow Temple | はかした ダンジョン | 23 | child day |
| adventure / Dungeons | 0x08 | HAKAdanCH_scene | Bottom of the Well | いどした ダンジョン | 7 | child day |
| adventure / Dungeons | 0x09 | ice_doukutu_scene | Ice Cavern | こおりのどうくつ | 12 | child day + 1 cutscene |
| adventure / Dungeons | 0x0B | men_scene | Gerudo Training Ground | ゲルドのしゅうれんじょう | 11 | child day |
| adventure / Dungeons | 0x0C | gerudoway_scene | Thieves Hideout | ゲルドつうろ 1-2 | 6 | child day |
| adventure / Dungeons | 0x0D | ganontika_scene | Inside Ganon's Castle | ガノンちか ダンジョン | 20 | child day |
| adventure / Dungeons | 0x0A | ganon_scene | Ganon's Tower | ガノンのとう | 10 | child day |
| adventure / Dungeons | 0x0E | ganon_sonogo_scene | Ganon's Tower Collapse Interior | ガノンのとう そのご 1 | 5 | child day |
| adventure / Dungeons | 0x0F | ganontikasonogo_scene | Inside Ganon's Castle Collapse | ガノンちか そのご | 2 | child day |
| adventure / Dungeons | 0x1A | ganon_final_scene | Ganon's Tower Collapse Exterior | ガノンさいしゅうせん | 1 | child day |
| boss / Boss rooms | 0x11 | ydan_boss_scene | Deku Tree Boss | ようせいのきの ダンジョン ボス | 2 | child day |
| boss / Boss rooms | 0x12 | ddan_boss_scene | Dodongos Cavern Boss | ドドンゴ ダンジョン ボス | 2 | child day |
| boss / Boss rooms | 0x13 | bdan_boss_scene | Jabu-Jabu's Belly Boss | きょだいぎょ ダンジョン ボス | 2 | child day |
| boss / Boss rooms | 0x14 | moribossroom_scene | Forest Temple Boss | もりのしんでん ボス | 2 | child day |
| boss / Boss rooms | 0x15 | FIRE_bs_scene | Fire Temple Boss | ひのしんでん ボス | 2 | child day |
| boss / Boss rooms | 0x16 | MIZUsin_bs_scene | Water Temple Boss | みずのしんでん ボス | 2 | child day |
| boss / Boss rooms | 0x17 | jyasinboss_scene | Spirit Temple Boss | じゃしんぞう ダンジョン アイアンナック | 4 | child day + 3 cutscene |
| boss / Boss rooms | 0x18 | HAKAdan_bs_scene | Shadow Temple Boss | はかした ダンジョン ボス | 2 | child day |
| boss / Boss rooms | 0x19 | ganon_boss_scene | Ganondorf Boss | ガノンのとうボス | 1 | child day |
| boss / Boss rooms | 0x4F | ganon_demo_scene | Ganon Boss | ガノンさいしゅうせん デモ & バトル | 1 | child day + 1 cutscene |
| other / Houses, shops and minigames | 0x34 | link_home_scene | Link's House | りんくのいえ | 1 | child day + 2 cutscene |
| other / Houses, shops and minigames | 0x26 | kokiri_home_scene | Know-It-All Brothers' House | こきりのむら ものしりきょうだいのいえ | 1 | child day |
| other / Houses, shops and minigames | 0x27 | kokiri_home3_scene | Twins' House | こきりのむら ふたごのいえ | 1 | child day |
| other / Houses, shops and minigames | 0x28 | kokiri_home4_scene | Mido's House | こきりのむら ミドのいえ | 1 | child day |
| other / Houses, shops and minigames | 0x29 | kokiri_home5_scene | Saria's House | こきりのむら サリアのいえ | 1 | child day |
| other / Houses, shops and minigames | 0x2D | kokiri_shop_scene | Kokiri Shop | こきりぞくのみせ | 1 | child day |
| other / Houses, shops and minigames | 0x2A | kakariko_scene | Kakariko Center Guest House | カカリコむらのながや | 1 | child day |
| other / Houses, shops and minigames | 0x2B | kakariko3_scene | Back Alley House | うらろじの いえ | 1 | child day |
| other / Houses, shops and minigames | 0x35 | impa_scene | Dog Lady House | うらろじ いぬおばさんのいえ | 1 | child day |
| other / Houses, shops and minigames | 0x37 | labo_scene | Impa's House | かかりこむら インパのいえ | 1 | child day |
| other / Houses, shops and minigames | 0x30 | drag_scene | Potion Shop Kakariko | カカリコむら  くすりや | 1 | child day |
| other / Houses, shops and minigames | 0x39 | tent_scene | Carpenters' Tent | テント | 1 | child day |
| other / Houses, shops and minigames | 0x3A | hut_scene | Gravekeeper's Hut | はかもりのいえ | 1 | child day |
| other / Houses, shops and minigames | 0x2C | shop1_scene | Bazaar | たてのみせ | 1 | child day |
| other / Houses, shops and minigames | 0x31 | alley_shop_scene | Potion Shop Market | じょうかまち くすりや | 1 | child day |
| other / Houses, shops and minigames | 0x32 | night_shop_scene | Bombchu Shop | うらろじ よるのみせ | 1 | child day |
| other / Houses, shops and minigames | 0x33 | face_shop_scene | Happy Mask Shop | おめんや | 1 | child day |
| other / Houses, shops and minigames | 0x2E | golon_scene | Goron Shop | ゴロンのみせ | 1 | child day |
| other / Houses, shops and minigames | 0x2F | zoora_scene | Zora Shop | ゾーラのみせ | 1 | child day |
| other / Houses, shops and minigames | 0x4E | mahouya_scene | Potion Shop Granny | まほう の くすりや | 1 | child day |
| other / Houses, shops and minigames | 0x10 | takaraya_scene | Treasure Box Shop | たからばこや | 7 | child day |
| other / Houses, shops and minigames | 0x42 | syatekijyou_scene | Shooting Gallery | しゃてきじょう | 1 | child day + 3 cutscene |
| other / Houses, shops and minigames | 0x4B | bowling_scene | Bombchu Bowling Alley | ボムチュウボーリング | 1 | child day |
| other / Houses, shops and minigames | 0x49 | turibori_scene | Fishing Pond | つりぼり | 1 | child day |
| other / Houses, shops and minigames | 0x50 | kinsuta_scene | House Of Skulltula | きん スタルチュラ ハウス | 1 | child day |
| other / Houses, shops and minigames | 0x36 | malon_stable_scene | Stable | うまごや | 1 | child day |
| other / Houses, shops and minigames | 0x4C | souko_scene | Lon Lon Buildings | ロンロンぼくじょう そうこ 1 | 3 | child day |
| other / Houses, shops and minigames | 0x4D | miharigoya_scene | Market Guard House | みはり ごや | 1 | child day, adult day |
| other / Houses, shops and minigames | 0x38 | hylia_labo_scene | Lakeside Laboratory | ハイリア けんきゅうじょ | 1 | child day |
| other / Houses, shops and minigames | 0x43 | tokinoma_scene | Temple Of Time | ときのま | 2 | child day + 11 cutscene |
| other / Houses, shops and minigames | 0x44 | kenjyanoma_scene | Chamber of the Sages | けんじゃのま | 1 | child day + 3 cutscene |
| other / Fairy fountains, grottos and graves | 0x3B | daiyousei_izumi_scene | Great Fairy's Fountain Magic | だいようせいのいずみ | 1 | child day + 3 cutscene |
| other / Fairy fountains, grottos and graves | 0x3D | yousei_izumi_yoko_scene | Great Fairy's Fountain Spells | まほうせき ようせいのいずみ | 1 | child day + 3 cutscene |
| other / Fairy fountains, grottos and graves | 0x3C | yousei_izumi_tate_scene | Fairy's Fountain | とびこみ ようせい あな | 1 | child day |
| other / Fairy fountains, grottos and graves | 0x3E | kakusiana_scene | Grottos | かくしとびこみあな 0 | 14 | child day |
| other / Fairy fountains, grottos and graves | 0x3F | hakaana_scene | Redead Grave | はかしたとびこみあな | 1 | child day |
| other / Fairy fountains, grottos and graves | 0x40 | hakaana2_scene | Grave With Fairy's Fountain | はかしたとびこみあな 2 | 1 | child day |
| other / Fairy fountains, grottos and graves | 0x41 | hakaana_ouke_scene | Royal Family's Tomb | おうけ の はかあな | 3 | child day + 2 cutscene |
| other / Fairy fountains, grottos and graves | 0x48 | hakasitarelay_scene | Windmill and Dampé's Grave | はかしたリレー | 7 | child day |
| other / Cutscene map | 0x47 | hiral_demo_scene | Cutmap | ハイラル デモ | 1 | child day + 9 cutscene |
| other / Test maps (MQ debug only) | 0x65 | test01_scene | Test01 | テストマップ | 1 | child day |
| other / Test maps (MQ debug only) | 0x66 | besitu_scene | Besitu | べっしつ (たからばこワープ) | 1 | child day |
| other / Test maps (MQ debug only) | 0x67 | depth_test_scene | Depth Test | depthテスト | 1 | child day |
| other / Test maps (MQ debug only) | 0x68 | syotes_scene | Syotes | ちゅうスタロフォスべや | 1 | child day |
| other / Test maps (MQ debug only) | 0x69 | syotes2_scene | Syotes2 | ボススタロフォスべや | 1 | child day |
| other / Test maps (MQ debug only) | 0x6A | sutaru_scene | Sutaru | Sutaru | 1 | child day |
| other / Test maps (MQ debug only) | 0x6B | hairal_niwa2_scene | Castle Courtyard test (hairal_niwa2) | ハイラルにわゲーム2 | 1 | child day |
| other / Test maps (MQ debug only) | 0x6C | sasatest_scene | Sasatest | ささテスト | 1 | child day, child night, adult day, adult night |
| other / Test maps (MQ debug only) | 0x6D | testroom_scene | Testroom | テストルーム | 5 | child day |

#### Majora's Mask: scenes (MM US and MM debug PAL, ids 0x00-0x70)

Title = the area name message the scene table points to, decoded from the US ROM's message data (**verified**, ROM bytes); name = title or, where the scene has no title or shares one, a documented name (**doc**: decomp scene/entrance names, community names); map select = the ROM's map select name (**verified**). Setups = alternate headers (cutscene setups counted).

| kind / group | id | file | name | title (ROM) | map select (ROM) | rooms | setups |
|---|---|---|---|---|---|---|---|
| hub / Clock Town | 0x6F | Z2_CLOCKTOWER | South Clock Town | South Clock Town | クロックタウン -みなみ- | 1 | setup 0 + 3 cutscene |
| hub / Clock Town | 0x6E | Z2_BACKTOWN | North Clock Town | North Clock Town | クロックタウン -きた- | 1 | setup 0, setup 1 |
| hub / Clock Town | 0x6C | Z2_TOWN | East Clock Town | East Clock Town | クロックタウン -ひがし- | 1 | setup 0 + 2 cutscene |
| hub / Clock Town | 0x6D | Z2_ICHIBA | West Clock Town | West Clock Town | クロックタウン -にし- | 1 | setup 0 + 1 cutscene |
| hub / Clock Town | 0x70 | Z2_ALLEY | Laundry Pool | Laundry Pool | せんたくじょう | 1 | setup 0 |
| hub / Clock Town | 0x19 | Z2_OKUJOU | Clock Tower rooftop |  | とけいとう おくじょう | 1 | setup 0, setup 3 + 2 cutscene |
| hub / Clock Town | 0x63 | Z2_INSIDETOWER | Clock Tower interior |  | とけいとうないぶ | 2 | setup 0 |
| hub / Termina Field and Romani Ranch | 0x2D | Z2_00KEIKOKU | Termina Field | Termina Field | タウン こうがい | 1 | setup 0, setup 5, setup 6 + 7 cutscene |
| hub / Termina Field and Romani Ranch | 0x22 | Z2_ROMANYMAE | Milk Road | Milk Road | ミルクロード | 1 | setup 0 |
| hub / Termina Field and Romani Ranch | 0x35 | Z2_F01 | Romani Ranch | Romani Ranch | ロマニー ぼくじょう | 1 | setup 0, setup 1 + 5 cutscene |
| hub / Termina Field and Romani Ranch | 0x41 | Z2_F01_B | Doggy Racetrack | Doggy Racetrack | ドッグレースじょう | 1 | setup 0 |
| hub / Termina Field and Romani Ranch | 0x6A | Z2_KOEPONARACE | Gorman Track | Gorman Track | ゴーマン トラック | 1 | setup 0 |
| hub / Southern Swamp and Woodfall | 0x40 | Z2_24KEMONOMITI | Road to Southern Swamp |  | けものみち | 1 | setup 0 |
| hub / Southern Swamp and Woodfall | 0x45 | Z2_20SICHITAI | Southern Swamp (poisoned) | Southern Swamp | ぬまち | 3 | setup 0 |
| hub / Southern Swamp and Woodfall | 0x00 | Z2_20SICHITAI2 | Southern Swamp (cleared) | Southern Swamp | ぬまち そのご | 3 | setup 0 |
| hub / Southern Swamp and Woodfall | 0x64 | Z2_26SARUNOMORI | Woods of Mystery | Woods of Mystery | ふしぎ の もり | 9 | setup 0 |
| hub / Southern Swamp and Woodfall | 0x2B | Z2_22DEKUCITY | Deku Palace | Deku Palace | デクナッツ の しろ | 3 | setup 0 |
| hub / Southern Swamp and Woodfall | 0x46 | Z2_21MITURINMAE | Woodfall | Woodfall | ウッドマウンテン | 1 | setup 0 + 2 cutscene |
| hub / Snowhead | 0x1C | Z2_13HUBUKINOMITI | Path to Mountain Village |  | ふぶき の みち | 1 | setup 0, setup 1 |
| hub / Snowhead | 0x50 | Z2_10YUKIYAMANOMURA | Mountain Village (winter) | Mountain Village | やまざと -ふゆ- | 1 | setup 0 |
| hub / Snowhead | 0x5A | Z2_10YUKIYAMANOMURA2 | Mountain Village (spring) | Mountain Village | やまざと -はる- | 2 | setup 0 + 1 cutscene |
| hub / Snowhead | 0x5D | Z2_17SETUGEN | Twin Islands (winter) |  | せつげん バトル -ふゆ- | 1 | setup 0 |
| hub / Snowhead | 0x5E | Z2_17SETUGEN2 | Twin Islands (spring) |  | せつげん バトル -はる- | 1 | setup 0 |
| hub / Snowhead | 0x4D | Z2_11GORONNOSATO | Goron Village (winter) | Goron Village | ゴロン の さと -ふゆ- | 2 | setup 0 |
| hub / Snowhead | 0x48 | Z2_11GORONNOSATO2 | Goron Village (spring) | Goron Village | ゴロン の さと -はる- | 2 | setup 0 + 1 cutscene |
| hub / Snowhead | 0x5B | Z2_14YUKIDAMANOMITI | Path to Snowhead |  | ゆきだま の みち | 1 | setup 0 + 1 cutscene |
| hub / Snowhead | 0x5C | Z2_12HAKUGINMAE | Snowhead | Snowhead | スノーヘッド | 1 | setup 0, setup 1 |
| hub / Snowhead | 0x6B | Z2_GORONRACE | Goron Racetrack | Goron Racetrack | ゴロンレース じょう | 1 | setup 0 + 1 cutscene |
| hub / Great Bay | 0x37 | Z2_30GYOSON | Great Bay Coast | Great Bay Coast | グレートベイ の かいがん | 1 | setup 0 + 2 cutscene |
| hub / Great Bay | 0x38 | Z2_31MISAKI | Zora Cape | Great Bay Coast | みさき | 1 | setup 0 + 1 cutscene |
| hub / Great Bay | 0x3B | Z2_TORIDE | Pirates' Fortress exterior | Pirates' Fortress | かいぞくのとりでまえ | 1 | setup 0 |
| hub / Great Bay | 0x14 | Z2_KAIZOKU | Pirates' Fortress (moat and courtyard) |  | かいぞくのとりで | 1 | setup 0 + 2 cutscene |
| hub / Great Bay | 0x33 | Z2_33ZORACITY | Zora Hall | Zora Hall | ゾーラ の ほこら | 1 | setup 0 + 1 cutscene |
| hub / Great Bay | 0x4A | Z2_35TAKI | Waterfall Rapids | Waterfall Rapids | たきうえ の けいりゅう | 1 | setup 0 |
| hub / Great Bay | 0x25 | Z2_SINKAI | Pinnacle Rock | Pinnacle Rock | とんがり いわ | 1 | setup 0 |
| hub / Great Bay | 0x62 | Z2_KONPEKI_ENT | Great Bay (cutscene) | Great Bay | グレートベイ | 1 | setup 0 |
| hub / Ikana | 0x53 | Z2_IKANAMAE | Road to Ikana |  | イカーナ への みち | 1 | setup 0 |
| hub / Ikana | 0x43 | Z2_BOTI | Ikana Graveyard | Ikana Graveyard | イカーナ の はかば | 2 | setup 0 + 1 cutscene |
| hub / Ikana | 0x13 | Z2_IKANA | Ikana Canyon | Ikana Canyon | イカーナ けいこく | 5 | setup 0 + 4 cutscene |
| hub / Ikana | 0x58 | Z2_F40 | Stone Tower | Stone Tower | ロックビル の たてあな | 1 | setup 0 |
| hub / Ikana | 0x59 | Z2_F41 | Stone Tower (inverted) |  | てんち ぎゃくてん | 1 | setup 0 |
| adventure / Temples | 0x1B | Z2_MITURIN | Woodfall Temple | Woodfall Temple | デクひめ の ろうや | 13 | setup 0 |
| adventure / Temples | 0x21 | Z2_HAKUGIN | Snowhead Temple | Snowhead Temple | スノーヘッド の しんでん | 14 | setup 0 |
| adventure / Temples | 0x49 | Z2_SEA | Great Bay Temple | Great Bay Temple | グレートベイ の しんでん | 16 | setup 0 |
| adventure / Temples | 0x16 | Z2_INISIE_N | Stone Tower Temple | Stone Tower Temple | ロックビル の しんでん-おもてー | 12 | setup 0 |
| adventure / Temples | 0x18 | Z2_INISIE_R | Stone Tower Temple (inverted) | Stone Tower Temple | ロックビル の しんでん-うらー | 12 | setup 0 |
| adventure / Other dungeons | 0x23 | Z2_PIRATE | Pirates' Fortress interior |  | かいぞくのとりでないぶ0 | 15 | setup 0 |
| adventure / Other dungeons | 0x1D | Z2_CASTLE | Ancient Castle of Ikana | Ancient Castle of Ikana | イカーナ こじょう | 10 | setup 0 |
| adventure / Other dungeons | 0x4B | Z2_REDEAD | Beneath the Well | Beneath the Well | いど の した | 14 | setup 0 |
| adventure / Other dungeons | 0x0C | Z2_HAKASHITA | Beneath the Graveyard | Beneath the Graveyard | はか の した0 | 5 | setup 0 |
| adventure / Other dungeons | 0x30 | Z2_DANPEI2TEST | Dampé's House | Beneath the Graveyard | はか の した-ダンペイ- | 2 | setup 0 |
| adventure / Other dungeons | 0x52 | Z2_DANPEI | Deku Shrine | Deku Shrine | デクナッツ の ほこら | 9 | setup 0 |
| adventure / Other dungeons | 0x27 | Z2_KINSTA1 | Swamp Spider House | Swamp Spider House | ぬま の くもやかた | 6 | setup 0 |
| adventure / Other dungeons | 0x28 | Z2_KINDAN2 | Oceanside Spider House | Oceanside Spider House | うみ の くもやかた | 6 | setup 0 |
| adventure / Other dungeons | 0x60 | Z2_RANDOM | Secret Shrine | Secret Shrine | ひみつ の ほこら | 6 | setup 0 |
| adventure / Other dungeons | 0x1A | Z2_OPENINGDAN | Clock Tower basement (opening dungeon) |  | オープニング ダンジョン | 2 | setup 0 + 1 cutscene |
| adventure / The Moon | 0x67 | Z2_SOUGEN | The Moon |  | ソウゲン | 1 | setup 0 |
| adventure / The Moon | 0x2A | Z2_LAST_DEKU | Moon: Deku trial |  | ラスト デク ダンジョン | 2 | setup 0 |
| adventure / The Moon | 0x3F | Z2_LAST_GORON | Moon: Goron trial |  | ラスト ゴロン ダンジョン | 2 | setup 0 |
| adventure / The Moon | 0x47 | Z2_LAST_ZORA | Moon: Zora trial |  | ラスト ゾーラ ダンジョン | 1 | setup 0 |
| adventure / The Moon | 0x66 | Z2_LAST_LINK | Moon: Link trial |  | ラスト リンク ダンジョン | 8 | setup 0 |
| boss / Boss rooms | 0x1F | Z2_MITURIN_BS | Odolwa's Lair |  | ウッドマウンテン の しんでん-ボス- | 1 | setup 0 |
| boss / Boss rooms | 0x44 | Z2_HAKUGIN_BS | Goht's Lair |  | スノーヘッド の しんでん-ボス- | 1 | setup 0 |
| boss / Boss rooms | 0x5F | Z2_SEA_BS | Gyorg's Lair |  | グレートベイ の しんでん-ボス- | 1 | setup 0 |
| boss / Boss rooms | 0x36 | Z2_INISIE_BS | Twinmold's Lair |  | ロックビル の しんでん-ボス- | 1 | setup 0 |
| boss / Boss rooms | 0x56 | Z2_IKNINSIDE | Igos du Ikana's Lair | Ancient Castle of Ikana | イカーナ の こじょう ボスべや | 2 | setup 0 + 1 cutscene |
| boss / Boss rooms | 0x0B | Z2_LAST_BS | Majora's Lair |  | ラストダンジョン -ボス- | 1 | setup 0 |
| other / Houses, shops and minigames | 0x61 | Z2_YADOYA | Stock Pot Inn | Stock Pot Inn | ナベかま てい | 5 | setup 0 + 1 cutscene |
| other / Houses, shops and minigames | 0x15 | Z2_MILK_BAR | Milk Bar | Milk Bar | ミルクバー | 1 | setup 0 + 4 cutscene |
| other / Houses, shops and minigames | 0x12 | Z2_SONCHONOIE | The Mayor's Residence | The Mayor's Residence | ちょうちょう の いえ | 4 | setup 0 |
| other / Houses, shops and minigames | 0x68 | Z2_BOMYA | Bomb Shop | Bomb Shop | ばくだん や | 1 | setup 0 |
| other / Houses, shops and minigames | 0x0D | Z2_AYASHIISHOP | Curiosity Shop | Curiosity Shop | マニや | 2 | setup 0 |
| other / Houses, shops and minigames | 0x34 | Z2_8ITEMSHOP | Trading Post | Trading Post | ざっか や | 1 | setup 0 |
| other / Houses, shops and minigames | 0x39 | Z2_TAKARAKUJI | Lottery Shop | Lottery Shop | たからくじや | 1 | setup 0 |
| other / Houses, shops and minigames | 0x2E | Z2_POSTHOUSE | Post Office | Post Office | ぽすとはうす | 1 | setup 0 |
| other / Houses, shops and minigames | 0x54 | Z2_DOUJOU | Swordsman's School | Swordsman's School | けんどうじょう | 1 | setup 0 |
| other / Houses, shops and minigames | 0x17 | Z2_TAKARAYA | Treasure Chest Shop | Treasure Chest Shop | たからばこや | 1 | setup 0 |
| other / Houses, shops and minigames | 0x11 | Z2_BOWLING | Honey & Darling's Shop | Honey & Darling's Shop | ハニー アンド ダーリン の みせ | 1 | setup 0 |
| other / Houses, shops and minigames | 0x20 | Z2_SYATEKI_MIZU | Town Shooting Gallery | Town Shooting Gallery | まち の しゃてきじょう | 1 | setup 0 |
| other / Houses, shops and minigames | 0x29 | Z2_TENMON_DAI | Astral Observatory | Astral Observatory | てんもんかんそくじょ | 2 | setup 0 |
| other / Houses, shops and minigames | 0x10 | Z2_OMOYA | Romani Ranch house and barn | Mama's House | おもや | 3 | setup 0 |
| other / Houses, shops and minigames | 0x42 | Z2_F01C | Cucco Shack | Cucco Shack | コッコ ごや | 1 | setup 0 + 1 cutscene |
| other / Houses, shops and minigames | 0x0A | Z2_WITCH_SHOP | Magic Hags' Potion Shop | Magic Hags' Potion Shop | まほうおばば の くすりや | 1 | setup 0 |
| other / Houses, shops and minigames | 0x57 | Z2_MAP_SHOP | Tourist Information | Tourist Information | ぬま の かんこうあんない | 1 | setup 0 |
| other / Houses, shops and minigames | 0x24 | Z2_SYATEKI_MORI | Swamp Shooting Gallery | Swamp Shooting Gallery | もり の しゃてきじょう | 1 | setup 0 |
| other / Houses, shops and minigames | 0x3E | Z2_DEKU_KING | Deku King's Chamber | Deku King's Chamber | デクおう の ま | 1 | setup 0 + 1 cutscene |
| other / Houses, shops and minigames | 0x1E | Z2_DEKUTES | Deku Scrub Playground |  | デクナッツ ミニゲーム | 1 | setup 0 |
| other / Houses, shops and minigames | 0x2C | Z2_KAJIYA | Mountain Smithy | Mountain Smithy | やまざと の かじや | 1 | setup 0 |
| other / Houses, shops and minigames | 0x3D | Z2_GORONSHOP | Goron Shop | Goron Shop | ゴロン の みせ | 1 | setup 0 |
| other / Houses, shops and minigames | 0x32 | Z2_16GORON_HOUSE | Goron Shrine | Goron Shrine | ゴロン の ほこら | 2 | setup 0 + 1 cutscene |
| other / Houses, shops and minigames | 0x2F | Z2_LABO | Marine Research Lab | Marine Research Lab | かいよう けんきゅうじょ | 1 | setup 0 |
| other / Houses, shops and minigames | 0x3C | Z2_FISHERMAN | Fisherman's Hut | Fisherman's Hut | りょうし の いえ | 1 | setup 0 |
| other / Houses, shops and minigames | 0x4C | Z2_BANDROOM | Zora Hall rooms |  | ゾーラ の みせ | 5 | setup 0 |
| other / Houses, shops and minigames | 0x4E | Z2_GORON_HAKA | Goron Graveyard | Goron Graveyard | ゴロン の はか | 1 | setup 0 |
| other / Houses, shops and minigames | 0x4F | Z2_SECOM | Sakon's Hideout | Sakon's Hideout | セコム の いえ | 2 | setup 0 |
| other / Houses, shops and minigames | 0x51 | Z2_TOUGITES | Ghost Hut | Ghost Hut | ゆうれいごや | 1 | setup 0 |
| other / Houses, shops and minigames | 0x55 | Z2_MUSICHOUSE | Music Box House | Music Box House | オルゴール ハウス | 1 | setup 0 |
| other / Houses, shops and minigames | 0x26 | Z2_YOUSEI_IZUMI | Fairy's Fountain | Fairy's Fountain | ようせい の いずみ 0 | 5 | setup 0 + 1 cutscene |
| other / Houses, shops and minigames | 0x69 | Z2_KYOJINNOMA | Giants' Chamber |  | きょじん の ま | 1 | setup 0 + 10 cutscene |
| other / Grottos | 0x07 | KAKUSIANA | Grottos |  | はなれやま の ほこら | 15 | setup 0 |
| other / Cutscene maps | 0x08 | SPOT00 | Cutscene map (opening forest) |  | OPデモよう しんりん | 1 | setup 0 + 11 cutscene |
| other / Cutscene maps | 0x65 | Z2_LOST_WOODS | Lost Woods (intro) |  | まよい の もり | 3 | setup 0 + 3 cutscene |
| other / Debug (debug PAL only) | 0x01-0x06, 0x09, 0x0E, 0x0F, 0x31, 0x3A | dmadata 1559 | one placeholder scene all unset ids point to | | | 1 | setup 0 + 9 |

### 4.5 Rooms

Rooms are world-space (room vertices are not offset per room) and all rooms of a scene are drawn together for a level view;
in game only the current and previous room are drawn. Per-room `LevelLayer`s (e.g. "room 3") are useful toggles for
dungeons with overlapping rooms. **Doc** (z_room.c); **verified** by the scene renders (§5.6).

## 5. Scene and room format

- Scenes are one scene file (segment 2) plus room files (segment 3). Both are lists of 8-byte header commands ending with
  0x14; alternate headers select per-layer variants. The two games share command ids 0x00-0x19 (a few differ), MM adds
  0x1A-0x1E.
- Room geometry is F3DEX2 display lists in mesh headers (types 0/1/2), drawn in world space with an identity modelview
  after `SETUPDL_25`, under two directional lights and fog from the scene's light settings. Segments 8-0xD (and 6) are
  filled every frame by code (OoT: 53 per-scene draw config functions; MM: animated material lists in the scene file).
- Units: 1 vertex unit = 1 world unit, right-handed, Y up, no mirroring. `mirrorX: false`, `vertexScale: 1`.
- `displaylist.ts` needs: a direct-image texture path (the 4 KB texture memory model breaks many textures), a TLUT memory,
  RDPHALF_1/BRANCH_Z for F3DEX2, initial combiner/othermode/prim/env from the caller, and (for correct appearance) the
  second texture and combiner per batch. The renderer needs a 2-texture lerp and a half-texel offset.
- Offline renders from ROM data + captured cameras match the emulator closely: mean absolute error over the best 75% of
  pixels (excluding HUD/actors) 0.4-4.7 on 13 of 14 captures of both games and all four ROMs, 11.3 on MM US Termina
  Field (§10.2). Environment values computed from scene data (lights, fog, zFar, sky indices/colours) equal the RAM values
  in every capture. Renders with placed static actors are in §6.5.

### 5.1 Scene and room headers

#### 5.1.1 Scene table (how the loader finds scenes)

| game | entry | layout | location (by structure) |
|---|---|---|---|
| OoT | 0x14 | `RomFile scene {vs, ve}; RomFile title {vs, ve} or 0; u8 unk10; u8 drawConfig; u8 unk12; u8 0` | US code +0xEA440 (101 entries), MQ code +0x10CBB0 (110) |
| MM | 0x10 | `RomFile scene; u16 titleTextId; u8; u8 drawConfig; u8; u8` | US code +0x11E1E0, dbg PAL code +0x1562B0 (113 each; unset slots are {0,0}) |

Finder (**verified**, `scenes/zscene.ts findSceneTable`, used by every render of all four ROMs): scan files ≥ 64 KB for a
run of ≥ 60 entries whose (vromStart, vromEnd) equals a filesystem file whose first bytes parse as a header containing
0x04 (room list); OoT also requires the title RomFile to be a file or zero; MM allows {0,0} gaps. drawConfig: OoT
byte +0x11 (0..52), MM byte +0x0B (0..7). MM dbg PAL fills the 11 slots that are unset in US with one extra debug file
(not investigated: unused-content rule).

#### 5.1.2 Commands

8 bytes: `u8 code, u8 data1, u16 pad, u32 data2`; pointers are segment 2 in scene files and segment 3 in room files. A
header ends at 0x14 (loader: at most 64 commands; no other terminator). Layouts **doc** (`oot-decomp/include/scene.h`,
`src/code/z_scene.c`; `mm-decomp/include/z64scene.h`, `src/code/z_scene.c`); usage counts **verified** for OoT US by
`scene-oot/census.py` → `scene-oot/census-oot-us10.txt` (main headers, 101 scenes / 388 room headers).

| id | OoT name / MM name | data1 | data2 / bytes 4-7 | where | viewer use |
|---|---|---|---|---|---|
| 00 | PLAYER_ENTRY_LIST / SPAWN_LIST | count | ptr ActorEntry[0x10] `{s16 id; Vec3s pos; Vec3s rot; s16 params}` | scene (101/101) | start positions |
| 01 | ACTOR_LIST | count | ptr ActorEntry[0x10] | room (369/388) | actors (§6) |
| 02 | UNUSED_2 / ACTOR_CUTSCENE_CAM_LIST | — / count | ptr | scene (MM) | no |
| 03 | COLLISION_HEADER | 0 | ptr CollisionHeader (§5.5) | scene (101) | collision/water overlay, bg cameras |
| 04 | ROOM_LIST | count | ptr RomFile[8] `{vs, ve}` | scene (101) | rooms |
| 05 | WIND | 0 | bytes s8 x, y, z, u8 strength | room (7) | no |
| 06 | SPAWN_LIST / ENTRANCE_LIST | 0 | ptr `{u8 playerEntryIndex; u8 room}[]`, no count | scene (101) | start room + position |
| 07 | SPECIAL_FILES | navi hint file | u32 keep object id (→ segment 5) | scene (93) | actors (§6) |
| 08 | ROOM_BEHAVIOR | room type | bits 0-7 env type, 8 lens mode, 10 disable warp songs; MM +11 enablePosLights, +12 storm | room (388) | MM point lights (hypothesis: ignore) |
| 09 | undefined | | | | |
| 0A | ROOM_SHAPE (mesh) | 0 | ptr mesh header (§5.2) | room (388) | geometry |
| 0B | OBJECT_LIST | count | ptr s16[] | room (388) | actors (§6) |
| 0C | LIGHT_LIST (positional) | count | ptr LightInfo[0x0E] | room | no (see §7.4) |
| 0D | PATH_LIST | 0 | ptr Path[8] | scene (30) | optional markers |
| 0E | TRANSITION_ACTOR_LIST | count | ptr [0x10] `{s8 room, s8 bgCam}×2; s16 id; Vec3s pos; s16 rotY; s16 params}` | scene (62) | doors (§6) |
| 0F | LIGHT_SETTINGS_LIST | count | ptr EnvLightSettings[0x16] (§7.3) | scene (101) | lights, fog, zFar |
| 10 | TIME_SETTINGS | 0 | bytes hour, min, speed (0xFF = keep) | room (388) | fixed-time rooms |
| 11 | SKYBOX_SETTINGS | OoT 0; MM area texture file (0-8) | OoT bytes skyboxId, skyboxConfig, lightMode; MM byte4 & 3 = skyboxId | scene (101) | sky, light mode, MM segment 6 |
| 12 | SKYBOX_DISABLES | 0 | bytes skyDisabled, sunMoonDisabled | room (388) | sky |
| 13 | EXIT_LIST | 0 | ptr s16[] | scene (100) | no |
| 14 | END | | | | |
| 15 | SOUND_SETTINGS | spec | byte6 ambience, byte7 sequence | scene (101) | music (§8) |
| 16 | ECHO | 0 | byte7 | room | no |
| 17 | CUTSCENE_DATA / CUTSCENE_SCRIPT_LIST | — / count | OoT ptr script; MM ptr `{script*, s16 nextEntrance, u8 spawn, u8 flags}[8]` | scene alt headers | no |
| 18 | ALTERNATE_HEADER_LIST | 0 | ptr to header pointers (§5.1.3) | scene (32) and room (83) | layers |
| 19 | MISC_SETTINGS / SET_REGION_VISITED | camera type | world map area | scene | no |
| 1A | — / ANIMATED_MATERIAL_LIST | 0 | ptr AnimatedMaterial[8] (§5.4.2) | MM scene | segments 8-0xD |
| 1B | — / ACTOR_CUTSCENE_LIST | count | ptr [0x10] | MM scene | no |
| 1C | — / MAP_DATA | 0 | ptr | MM scene | no |
| 1E | — / MAP_DATA_CHESTS | count | ptr | MM scene | no |

#### 5.1.3 Alternate headers (layers)

- **OoT** (**doc** `Scene_CommandAlternateHeaderList`): `gSaveContext.sceneLayer` 0 = child day, 1 = child night,
  2 = adult day, 3 = adult night, 4+ = cutscene layers (cutsceneIndex 0xFFF0 + n → layer 4 + n). Layer 0 uses the main
  header; layer L > 0 uses `altList[L-1]`; if that pointer is 0 the main header's remaining commands run, except that
  layer 3 falls back to `altList[1]` (adult day). The 0x18 command must come first in the main header (it ends the main
  header after running the alternate one). Room files carry their own 0x18 lists indexed by the same layer. The list has
  no length: read pointers while they are 0 or segment-2/3 addresses of parsable headers.
- Census (**verified**, `scene-oot/census-oot-us10.txt`): scene alternate list lengths {0: 69 scenes, 3: 2, 4: 6, 5: 8,
  6: 9, 8: 2, 11: 1, 12: 2, 13: 1, 14: 1}; 32 scenes have alternate headers, and in those the alternate headers point
  to their own room lists (often the same room files).
- **MM** (**doc** `z_scene.c`): `sceneLayer` = low 4 bits of the entrance value (`scene << 9 | spawn << 4 | layer`);
  `altList[layer-1]`, 0 → main header, no fallback. The MM Termina Field capture used layer 5 (**verified**, RAM:
  `sceneLayer=5`, entrance 0x5400).
- Recommendation: default = layer 0 for every scene (OoT child day). Offer layers whose alternate pointer is non-zero as
  variants; label OoT 1-3 as child night / adult day / adult night and 4+ as "cutscene n"; MM 1+ as "setup n". §4.2 gives
  the recommended list (many cutscene layers only change actors).

### 5.2 Mesh headers (command 0x0A)

Layouts **doc** (`oot-decomp/include/room.h`, `mm-decomp/include/z64scene.h`), parser **verified** on every rendered
room (`scenes/zscene.ts parseMesh`).

| type | layout | draw |
|---|---|---|
| 0 normal | `u8 0; u8 n; ptr entries; ptr entriesEnd`; entry `{Gfx* opa; Gfx* xlu}` (8) | all entries in order |
| 1 image | `u8 1; u8 amount (1 single, 2 multi); ptr entry {opa, xlu}`; single: `+8 source, +0xC unk, +0x10 tlut, +0x14 u16 w, h, +0x18 u8 fmt, siz, +0x1A u16 tlutMode, tlutCount` (0x20); multi: `+8 u8 n, +0xC ptr bg[0x1C] {u16 unk, u8 bgCamIndex, source, unk, tlut, u16 w, h, u8 fmt, siz, u16 tlutMode, tlutCount}` | opa, 2D background, xlu |
| 2 cullable | `u8 2; u8 n (≤ 64); ptr entries; ptr end`; entry `{Vec3s center; s16 radius; Gfx* opa; Gfx* xlu}` (0x10) | entries sorted near to far, skipped when the sphere is behind the eye or beyond zFar |
| 3 (MM) none | nothing drawn | |

Either list pointer may be 0 (US: 1621 null list pointers). The game draws all OPA lists (after `SETUPDL_25`) into the
opaque buffer and all XLU lists (after `SETUPDL_25` on the XLU buffer) into the translucent buffer, which is drawn after
all opaque geometry and actors (**doc** `z_room.c`, `Play_Draw`). A viewer ignores culling and draws every entry.

Census (**verified**, `scene-oot/meshscan-*.txt`, `scene-oot/census-*.txt`, `scene-mm/report-*.txt`): OoT US rooms
type 2: 216, type 0: 144, type 1 single: 23, type 1 multi: 5; OoT MQ debug 226 / 145 / 24 / 5 (§5.7); MM US: all 299 rooms
type 2 (no type 0/1 in retail rooms).

#### 5.2.1 Prerendered backgrounds (type 1, OoT only in practice)

- Scenes (**verified**, `meshscan`): 0x1B-0x1F market entrances/back alleys, 0x23-0x25 Temple of Time exterior (multi),
  0x26-0x3A shops and houses (single).
- Image data: segment-3 pointer to a baseline JFIF JPEG (`FF D8 FF E0 … JFIF`), 320×240; header fmt RGBA (0), siz 16b
  (2). `Room_DecodeJpeg` decodes it in place into an RGBA16 320×240 frame and it is drawn with S2DEX `gSPBgRectCopy`
  (**doc** `z_room.c`). **Verified**: `scenes/bgimage.py` extracts and decodes them with Pillow (e.g. market entrance
  25 294 bytes, ToT exterior bgCam 0/1 17 037 / 21 288 bytes) → `scenes/renders/bg-oot-us10-1b-r0-0.png`,
  `bg-oot-us10-23-r0-{0,1}.png`; the images are correct pictures (checked visually).
- Which camera: the background is drawn only when the active camera setting is `CAM_SET_PREREND_FIXED` (0x19). For
  multi images the entry whose `bgCamIndex` equals the camera's bg camera index (or its `roomImageOverrideBgCamIndex`)
  is used (**doc**). The camera itself: collision bg camera data (§5.5) with setting 0x19: eye = `pos`,
  at = eye + VecGeo(pitch = −rot.x, yaw = rot.y), fov = data fov (≤ 360: degrees; else /100; −1: 60) (**doc**
  `Camera_Fixed3`). **Verified exactly** (capture `ref/oot-us10/market-entrance-1`): RAM camera setting 25, bgCamIndex 0,
  eye (−260, 820, 2200) = bg cam 0 pos; at − eye direction (0.409, −0.865, 0.287) = formula with rot (10923, 10012)
  (pitch −60°, yaw 55°); fovy 46.83 = 4683/100; zFar 3000 from the light setting. The decoded JPEG as the whole frame
  matches the screenshot: best-75% error 3.3 (`scenes/renders/sbs-oot-us10-market-entrance-1.png`; the differences are the
  HUD, Navi and the player). Collision drawn from that camera lines up with the painted road/stairs
  (`scenes/renders/sbs-oot-us10-prerendered.png`, also ToT exterior bgCam 0/1).
- The OPA list of an image room is drawn before the background and gets overwritten by it (it only leaves depth for
  actors); the XLU list is drawn over it. In market entrance room 0 the OPA list is 12 untextured triangles.
- Viewer: show the JPEG as `Level.backdrop` (u 0..1, v 0..1) together with a `CameraView` from the bg camera, as a
  "fixed camera" variant; free-flying over a prerendered room shows only the depth geometry and collision. Decoding needs
  a baseline JPEG decoder (browser `createImageBitmap` in the worker, or a small in-repo decoder). MM keeps the code
  but never draws a background (`isFixedCamera = false`, **doc** MM `z_room.c`).

### 5.3 Display lists and render state

#### 5.3.1 Microcode and opcodes

F3DZEX2 (F3DEX2 opcodes). Opcodes reached from room lists (**verified**, `scene-oot/census-oot-us10.txt`,
`scene-mm/report-mm-us.txt`):

| | OoT US (164 228 tris) | MM US (159 934 tris) |
|---|---|---|
| geometry | VTX 22390, TRI1 4318, TRI2 79955 | VTX 18204, TRI1 2434, TRI2 78750 |
| state | GEOMETRYMODE 12745, SETOTHERMODE_L 3861 / _H 4503, SETCOMBINE 4250, TEXTURE 3298, SETPRIMCOLOR 3517, SETENVCOLOR 141 | 6378, 4495 / 4981, 4495, 4447, 5606, 36 |
| textures | SETTIMG 18335, SETTILE 33822, LOADBLOCK 15381, SETTILESIZE 15487, LOADTLUT 2954, TILESYNC/LOADSYNC | 15372, 24962, 9590, 11021, 5782 |
| flow | DL 1696, ENDDL 3278, CULLDL 3007, RDPHALF_1 + BRANCH_Z 38 | 3601, 7017, 4495, 801 |
| matrix | MTX 303 | MTX 96, POPMTX 48 |

Vertices are always segment 3. Textures: SETTIMG segment 3 (9236) and 2 (9072) in OoT, plus 6/8/9 from draw configs;
MM segment 2 (12013), 3 (2568), 6 (790, area textures), 8 (1). No room list references segments 4/5 (gameplay_keep /
field keep). G_DL targets: segment 3 and 8-0xD (and 6 in MM).

- **G_CULLDL** (`03 …`): view-frustum test of a vertex range; a viewer ignores it.
- **G_RDPHALF_1 + G_BRANCH_Z** (`E1000000 nearDL` then `04000000 zval`): after loading one bounding vertex,
  branch to the detailed list if the vertex's screen depth is below `zval` (raw values 0x3E8, 0xC80, 0xE10, 0xFA0 seen),
  otherwise continue (usually `ENDDL`): distance culling of detail. **Verified** by dumping instances
  (`scenes/branchz.ts`: MM scene 0 room 0 +0x2620, OoT scene 0x52 room +0x5468). Viewer: always take the branch.
  `displaylist.ts` today treats 0xE1/0x04 in F3DEX2 as unknown RDP words and never draws the near list.
- **G_MTX** in OoT rooms (101 × segment 0 load, 101 × segment 3 load, 101 × segment 0xD multiply): segment 0xD is Jabu-
  Jabu's pulsing-wall scale matrix from the draw config (§5.4.1); the segment 0/3 loads are open questions.

#### 5.3.2 State when rooms are drawn

`Play_Draw` (**doc**): segments 2 = scene, 4 = gameplay_keep, 5 = sub keep; fog (§7.5); projection
`guPerspective(fovy, 4:3, zNear, lightCtx.zFar)` with the look-at folded into the projection; Scene_Draw (draw config,
§5.4); `Lights_BindAll` + `gSPSetLights` (ambient + directional lights, §7.4); then each room: `gSPSegment(3, room)`,
`SETUPDL_25`, `gSPMatrix(identity, LOAD|MODELVIEW)`, the room lists (MM also `gSPSegment(6, area texture file)`).

`SETUPDL_25` (**doc** `z_rcp.c`, identical in both games except MM `AD_PATTERN`):

| state | value |
|---|---|
| texture | `gsSPTexture(0xFFFF, 0xFFFF, 0, 0, ON)` |
| combiner | G_CC_MODULATEIDECALA, G_CC_MODULATEIA_PRIM2 = `FC127E03 FF0FF3FF` |
| othermode H | 2CYCLE, BILERP, TT_NONE, TC_FILT, PERSP = `0x00102C10` |
| othermode L | G_RM_FOG_SHADE_A \| G_RM_AA_ZB_OPA_SURF2 = `0xC8112078` |
| geometry | ZBUFFER, SHADE, CULL_BACK, FOG, LIGHTING, SHADING_SMOOTH |
| prim / env | not set: left by the draw config (§5.4) |

State found at triangles (**verified**, OoT US census; MM similar in `report-mm-us.txt`):
- Render modes: AA_ZB_OPA_SURF2 139 130 tris, AA_ZB_TEX_EDGE2 (CVG_X_ALPHA) 17 949, AA_ZB_XLU_SURF2 5 786, ZMODE_DEC
  variants ~650, non-fog c1 `0x0C18…` modes ~550. Blend cycle 1 is always FOG/SHADE_A (fog) or IN/0 (no fog).
- Geometry mode: 42 488 opaque and 1 171 translucent triangles have G_LIGHTING set (the room lists clear/set
  FOG|LIGHTING around each material); CULL_BACK on most; TEXTURE_GEN on ~320 (environment-mapped).
- Othermode H: TT_NONE 105 655 tris, TT_RGBA16 58 573 (CI textures); no IA16 TLUTs; always bilinear, 2-cycle.
- Combiners (top): `(TEXEL0·SHADE ; ·PRIM)` 102 183 (+9 957 with TEXEL0 alpha); `SHADE·PRIM` 26 202;
  `lerp(TEXEL0, TEXEL1, ENV_ALPHA) ; ·SHADE` 19 357 (+638 +92 +91 +36 variants); alpha `TEXEL1·PRIM_LOD_FRAC + COMBINED`
  1 985 + 539; `PRIM` 503; `TEXEL0·PRIM` 374. MM has many more two-texture blends (`FC20AC04 FF0F93FF`,
  `FC272C04 1F0C93FF`, ~1 300 render-tile-1 uses). PRIM_LOD_FRAC is the low byte of `G_SETPRIMCOLOR` w0.

#### 5.3.3 Textures and palettes

Load sequence as stored (**verified**, `scenes/dldump.py oot-us10 1026 0x2790`):
```
FD100000 0201AB98   G_SETTIMG image
F5100000 07014C53   G_SETTILE tile 7 (load tile): fmt, load siz, tmem
F3000000 073FF100   G_LOADBLOCK tile 7: lrs = texels-1 in load-siz units (capped 0x7FF), dxt
F5101000 00014C53   G_SETTILE render tile 0: fmt, siz, line = row bytes/8, pal, cmt/maskt/shiftt, cms/masks/shifts
F2000000 0007C07C   G_SETTILESIZE tile 0: (0,0)-(31,31) = true image size
...                 second texture: same with render tile 1 (e.g. F5101100 01017C5F / F2000000 0107C07C)
FD100000 02013D70 / E8000000 / F5000100 07000000 / F0000000 0703C000   palette: TLUT entries (tmem field - 0x100), count-1 at w1 bits 14+
```
4-bit textures are loaded with a 16-bit load tile (count = w·h/4), so the load count is not the texel count.

Direct-image model for Zelda (**verified**: all 7 renders with 0 size mismatches between G_SETTILESIZE, the line
field and the load count; `sizeMismatchCount` in `scenes/renders/*.json`):
1. On G_LOADBLOCK remember the image address (last G_SETTIMG).
2. On G_SETTILE for render tile 0 or 1: that tile shows the remembered image with this fmt/siz, wrap cms/cmt, masks,
   shifts, palette slot.
3. The first G_SETTILESIZE after it gives the image width/height; later G_SETTILESIZE commands (scroll lists in segments
   8-0xD) only move uls/ult.
4. CI texels index TLUT[pal·16 + texel]; the TLUT memory is filled by G_LOADTLUT at entry (tmem field − 0x100).
5. Texture coordinate: texel = s/32 · G_TEXTURE scale · shift(tile) − uls (s10.5 vertex s; shift 1..10 divide, 11..15
   multiply).

The existing 4 KB tile-memory emulation truncates: OoT US has 1 649 G_LOADBLOCKs at the 0x7FF cap; MM US has 903 of
11 021 texture uses larger than 4 KB (e.g. CI8 64×128, RGBA16 64×64) (**verified**, `scene-oot/census.py`,
`scene-mm/texcensus.py`). Formats at triangles: RGBA16, CI4/CI8 (RGBA16 TLUT), I4/I8, IA4/IA8/IA16; sizes 4×4 to
256×32.

**Filtering**: the RDP's bilinear filter has texel centres at integer texel coordinates. Sampling with the GL convention
(centres at +0.5) shifts every texture by half a texel; at clamped edges and skybox seams this pulls in padding texels.
**Verified**: the offline renderer showed a dark seam between skybox faces and blurred decal edges; removing the offset
removed the seam and lowered the error on every capture (MAE KF 11.5 → 8.9, HF US 17.7 → 14.8, HF MQ 20.1 → 17.1, Deku
Tree 12.2 → 10.6). Viewer: add 0.5/size to u and v (or sample with a half-texel shift) for Zelda batches.

#### 5.3.4 Lighting

Rooms are lit by the RSP: vertex colour bytes are a normal when G_LIGHTING is set; colour = ambient + Σ light colour ·
max(0, N·L) (clamped), alpha from the vertex. The bound lights are the scene's two directional lights (§7.4) in world
space (identity modelview; the look-at is in the projection matrix, so light directions need no transform). **Verified**:
renders use `runDisplayList`'s existing `lighting` option with these two lights and match the screenshots (§10.2).
Point lights (room command 0x0C, actor glows) are not bound for rooms in OoT (`Lights_BindAll(…, vec = NULL)` skips
point lights, **doc**); MM rooms bind them when ROOM_BEHAVIOR bit 11 is set (**doc**, not rendered).

#### 5.3.5 Changes `displaylist.ts` needs

Implemented and exercised in the research copy `scenes/dl/displaylist.ts` (diff against `scenes/dl/displaylist.orig.ts`,
the HEAD copy; every change marked `ZELDA:`; 322 changed lines):

| # | change | needed for | evidence |
|---|---|---|---|
| 1 | `directImages` option: §5.3.3 model, UVs normalised by the image size (not the tile window), texture key by image/format/size/TLUT | any correct texture | renders |
| 2 | TLUT memory for `directImages` (256 entries, index = tmem field − 0x100) | CI textures | renders |
| 3 | F3DEX2 `0xE1` RDPHALF_1 and `0x04` BRANCH_Z (take the branch: option `branchZ: 'near'`); `0x03` CULLDL no-op | 38 OoT / 801 MM detail lists | `branchz.ts` |
| 4 | caller-supplied initial `combineMode`, `otherModeH`, `primColor`, `envColor` (today the combiner is hard-coded and prim/env are white) | SETUPDL_25 + draw config | renders |
| 5 | keep all of othermode H (texture filter point/bilinear, TLUT type from the initial state) | filter flag | — |
| 6 | PRIM_LOD_FRAC from `G_SETPRIMCOLOR` w0 low byte | alpha `TEXEL1·PRIM_LOD_FRAC` | renders |
| 7 | `extended` output `Batch.ext`: render tile 1 texture + `uvs1`, the 16 combiner inputs, prim, env, primLod, render mode, geometry mode | two-texture materials | viewer-model renders (§10.2) |
| 8 | treat TEXEL0 in alpha inputs as texture use (alpha-only decals) | shadows/decals | — |

Options a Zelda loader passes: `ucode 'f3dex2'`, `vertexScale 1`, `mirrorX false`, `geometryMode`/`renderMode`/
`alphaCompare` from SETUPDL_25, `lighting` from §7.4, `decals true`, `textureGen true`, `combiner true` (fold prim/env/shade
into vertex colours for single-texture materials).

### 5.4 Draw configs and animated materials

#### 5.4.1 OoT: per-scene draw config functions

`sSceneDrawConfigs[53]` in code, indexed by the scene table's drawConfig byte, run every frame before the rooms
(**doc** `oot-decomp/src/code/z_scene_table.c`). They set segments 8-0xD separately in the OPA and XLU display
buffers (a room's OPA lists and XLU lists can see different segment contents), and usually `gDPSetEnvColor(128,128,
128,128)` on both. SDC_DEFAULT (0) calls `sDefaultDisplayList`: segments 8-0xD = empty list, prim = env =
(128,128,128,128). Other configs do not set unused segments or prim.

Building blocks (frame f = gameplayFrames; x/y in 1/4 texel, `%= 2048`):
- `TexScroll(x, y, w, h)` = `TILESYNC; SETTILESIZE(tile 0, x, y, x+(w−1)·4, y+(h−1)·4); ENDDL`.
- `TwoTexScroll(0, x1, y1, w1, h1, 1, x2, y2, w2, h2)` = same for tiles 0 and 1 (`…EnvColor`/`…PrimColor` variants append
  `SETENVCOLOR`/`SETPRIMCOLOR`).
- `W(a)` below = `TwoTexScroll(0, 127−f%128, a·f%128, 32, 32, 1, f%128, a·f%128, 32, 32)` (the common water scroll).
- `tex[i]` = the day/night texture pointer i+nightFlag from the table below.

Static frame f = 0, day (nightFlag 0, dayTime 0x8000), child, drawParams 0 (the recommended viewer default). "e128" = env
(128,128,128,128) on both buffers.

| SDC | scene(s) | OPA segments | XLU segments | colours |
|---|---|---|---|---|
| 0 default | many | 8-D empty | 8-D empty | prim, env 128 |
| 1 Hyrule Field | spot00 | — | 8 W(3), 9 W(10), A: day (07:00 < t ≤ 18:30) empty, night prim (255,255,255,dp0) + room DL 0x03012B20 | e128 |
| 2 Kakariko | spot01 | 8 tex[30] window | — | e128 |
| 3 Zora's River | spot03 | — | 8 W(6), 9 W(3), A W(1) | e128 |
| 4 Kokiri Forest | spot04 | A env(128,128,128, 128); B env(…, 50); C TwoTexScroll(0,0,−dp0·0.02,32,16,…) | 9 W(1), 8 W(10), B env(…, 50) | e128; env alpha B = 215 after EVENTCHKINF_07, layer 4/6 use dp0 |
| 5 Lake Hylia | spot06 | 8 TwoTexScrollEnv(f,f,32,32 / 0,0,32,32, env a 168+dp0), 9 (−f,−f / 0,0,16,64, same) | — | OPA env (255,255,255,128); adult unrestored/cutscene layers: dp0 = 87 |
| 6 Zora's Domain | spot07 | C TwoTexScroll(0,0,64,32 / 0,127−f%128 (adult 0),64,32) | 8 tex[32] | OPA e128 |
| 7 Zora's Fountain | spot08 | 8 TwoTex(f%128,0 / 0,0) | 9 (0,255−2f %256, 64×64 both), A (0,f%128 both) | e128 |
| 8 Gerudo Valley | spot09 | B (0,0 / 0,127−3f%128) | 8 (0,3f%1024, 32×256 both), 9 (0,f%256, 64×64), A (0,2f%128), C (0,f%128), D (0,f%64, 16×16) | e128 |
| 9 Lost Woods | spot10 | — | 8 TwoTex(f%128,0,32,16 both), 9 (127−f%128,f%128 / f%128,f%128) | e128 |
| 10 Desert Colossus | spot11 | 8 (0,0 / 0,127−f%128) | — | e128 |
| 11 Gerudo's Fortress | spot12 | 8 tex[34] wall | — | none |
| 12 Haunted Wasteland | spot13 | 8 (0,f%128 both) | 9 same | e128 |
| 13 Hyrule Castle | spot15 | — | 8 W(10), 9 W(3) | e128 |
| 14 Death Mountain Trail | spot16 | — | 8: day (07:00 < t ≤ 18:00) empty, night prim + room DL | e128 |
| 15 Death Mountain Crater | spot17 | 8 (0,f%128 both) | — | OPA env (c,c,255,128), c = (coss(f·1500)>>8>>1)+192 → 255 at f 0; XLU e128 |
| 16 Goron City | spot18 | 8 (0,127−f%128 / f%128,0) | 8 tex[36] | e128 |
| 17 Lon Lon Ranch | spot20 | 8 tex[38] window | — | e128 |
| 18 Fire Temple | HIDAN | 8 (0,127−f%128 / 127−f%128,0), 9 (3f%128,127−6f%128 / 6f%128,127−3f%128) | — | env (128,128,128,64) both |
| 19 Deku Tree | ydan | 8 tex[0] entrance | 9 W(1) | XLU e128 |
| 20 Dodongo's Cavern | ddan | 8 tex[2], 9 lava tex[4 + (f&14)/2], A (0,f%128 / 0,2f%128), B/C env (255,255,255, eye alpha 0) | 9 (f%256,0,64,32 / 0,f%128,64,32) | e128 |
| 21 Jabu-Jabu | bdan (+boss) | 8 (f%128,2f%128 / 127−f%128,2f%128), B (0,255−4f%256,32,64 both); boss: 8 TexScroll; D = Mtx Scale(1.005, sin(t)·0.8, 1.005) | — | e128 |
| 22 Forest Temple | Bmori1 | A W(1) | 8 tex[26], 9 W(1) | e128 |
| 23 Water Temple | MIZUsin | 8, 9 TwoTexScrollEnv(f,0 / 0,0, env a 255), A (…, a 160), B (3f, a 185) | US: 6 tex[14]; MQ: 8 tex[14]; C (f,f / 0,127−f, a 128), D (4f,0 / 4f,0, a 128) | env alphas depend on drawParams[1] (water level) |
| 24 Shadow Temple, Well | HAKAdan, HAKAdanCH | boss scene: 8 (2f%128,0 both) | others: 8 same | e128 |
| 25 Spirit Temple | jyasinzou | — | 8 tex[28] | none |
| 26 Inside Ganon's Castle | ganontika | A W(1) | 8 (127−f%128,f%512,32,128 / f%128,f%512), 9 W(1) | e128 |
| 27 Gerudo Training Ground | men | 9 W(1) | 8 tex[18], A W(1) | e128 |
| 28 Deku Tree boss | ydan_boss | — | 8 (2f%256,0,64,32 / 0,2f%128,64,32) | XLU e128 |
| 29 Water Temple boss | MIZUsin_bs | 8 TwoTex(f,0 / 0,0) | — | OPA env (128,128,128,dp0), XLU (…,145) |
| 30 Temple of Time | tokinoma | 8 prim(255,255,255), 9 prim(76,76,76), A env(0,0,0,dp0), B prim(89,89,89)+env(0,0,0,dp0), C prim(255,…)+env, D env(0,0,0,dp1) | same | set only through segments |
| 31 Grottos | kakusiana | A (0,0 / 0,127−f%128), B TexScroll(0,f%128,32,32), D (0,0,32,64 / 0,f%128) | 8 TexScroll(0,f%64,256,16), 9 W(1), C (0,50f%2048,8,512 / 0,60f%2048,8,512) | e128 |
| 32 Chamber of the Sages | kenjyanoma | A W(1) | 8 TexScroll(0,2f%256,64,64), 9 (127−f%128,f%256,32,64 / 0,0,32,128) | e128 |
| 33 Great Fairy's Fountain | daiyousei_izumi | — | 8 (127−f%128,3f%256,32,64 / f%128,3f%256), 9 W(3) | e128 |
| 34 Shooting Gallery | syatekijyou | 8 TexScroll(0,f%64,4,16) | — | OPA e128 |
| 35 Castle courtyard guards | hairal_niwa(_n) | — | 8 W(3); day scene: 9 TexScroll(0,10f%256,32,64) | e128 |
| 36 Outside Ganon's Castle | ganon_tou, others | B (255−f%128,f%128 / f%128,f%128) | scene 0x64: 9 TexScroll(0,f%256,64,64), 8 (0,255−f%256 / 0,f%256, 64×64) | OPA env (255,255,255,128) at f 0; XLU e128 |
| 37 Ice Cavern | ice_doukutu | 9 W(1) | 8 tex[16], A W(1) | e128 |
| 38 Ganon's Tower collapse exterior | ganon_final etc. | 8 (0,f%512,64,128 / 0,511−f%512), 9 (0,f%256,32,64 / 0,255−f%256) | A (0,20f%2048,16,512 / 0,30f%2048) | OPA env (255,255,255,128), XLU e128 |
| 39 Fairy's Fountain | yousei_izumi_tate | — | 8 W(3), 9 TexScroll(0,f%64,256,16) | e128 |
| 40 Thieves' Hideout | gerudoway | 9 TexScroll(0,3f%128,32,32) | 8 tex[12] | none |
| 41 Bombchu Bowling | bowling | 9 TexScroll(0,5f%64,16,16), A TexScroll(0,63−2f%64,16,16) | 8 TexScroll(127−4f%128,0,32,32), B (0,127−3f%128 / 0,0) | e128 |
| 42 Royal Family's Tomb | hakaana_ouke | A (127−f%128,0 / f%128,0) | 8 TexScroll(0,f%64,256,16), 9 (0,60f%2048,8,512 / 0,50f%2048), B (0,1023−6f%1024,16,256 / 0,1023−3f%1024) | e128 |
| 43 Lakeside Laboratory | hylia_labo | 8 (0,0 / 0,f%128) | A W(1), 9 TexScroll(0,255−10f%256,32,64) | e128 |
| 44 Lon Lon buildings | souko, … | — | 8 tex[20] | e128 |
| 45 Market guard house | miharigoya | 8 tex[24] view 2, 9 tex[22] view 1 (index adult ? 1 : nightFlag) | — | e128 |
| 46 Potion shop (granny) | mahouya | 8 TexScroll(0,3f%128,32,32) | 9 (0,1023−3f%1024,16,256 / 0,1023−6f%1024) | e128 |
| 47 Calm water | several | — | 8 W(1) | e128 |
| 48 Grave exit light | hakasitarelay etc. | — | 8 TexScroll(0,f%64,256,16) | e128 |
| 49 Besitu | debug scene | 8 TexScroll(127−2f%128,0,32,64), 9 TexScroll(0,2f%512,128,128) | — | e128 |
| 50 Fishing pond | turibori | — | 8 TwoTexScrollPrim(W(1), prim (255,255,255, dp0+127)) | e128 |
| 51, 52 | collapse interiors | screen shake only | | none |

The full executable version (all 53, any frame/time) is `scenes/drawcfg.ts ootDrawConfig`; the scene-name column is
from `oot-decomp/include/tables/scene_table.h` (**doc**). **Verified** in renders: SDC 1 (Hyrule Field, both versions),
2 (Kakariko Village; the window texture is not in that view), 4 (Kokiri Forest), 19 (Deku Tree, US and MQ).

**Day/night texture pointers** (tex[i]): 40 segment-2 pointers in 17 arrays in source order (Deku Tree entrance 0-1,
Dodongo's Cavern entrance 2-3, DC lava floor 4-11, Thieves' Hideout 12-13, Water Temple 14-15, Ice Cavern 16-17, GTG
18-19, Lon Lon house 20-21, guard house view 1 22-23, view 2 24-25, Forest Temple 26-27, Spirit Temple 28-29, Kakariko
windows 30-31, Zora's Domain 32-33, Gerudo Fortress walls 34-35, Goron City 36-37, Lon Lon Ranch windows 38-39); element
0 of each pair is used when nightFlag = 0. Loader (**verified**, `scenes/findsdc.py`, `drawcfg.ts findDayNightTextures`):
find `sDefaultDisplayList` in code by its signature `DB060020 … DB060034` (6 × gsSPSegment 8-0xD) + PipeSync + prim +
env + ENDDL, skip following 0x80xxxxxx words (N64 builds place the 53-entry function table there: OoT US), take the next
40 words (all 0x02xxxxxx). US code +0xEAC28 (pointers +0xEAD4C, first `0200BA08 0200CA08`), MQ code +0x10D448 (pointers
+0x10D498, `0200BA18 0200CA18`). The two night display lists of SDC 1/14 are room-list addresses inside code
instructions (not in data): **hypothesis** 0x03012B20 (spot00 room 0) and 0x0300A9C8 / 0x0300AA48 (spot16) per the decomp
XMLs; only needed for night views.

#### 5.4.2 MM: draw configs and animated materials

Draw configs (**doc** `mm-decomp/src/code/z_scene_proc.c`): 0 default (segments 8-0xD and 6 empty, prim/env 128);
1 animated materials; 2 nothing (SPOT00); 3/4 unused OoT leftovers (grotto and calm-water configs); 5 unused; 6 Great
Bay Temple (animated materials + segment 6 = 9 × prim colour DLs with LOD fraction 0/68/255 from switch flags);
7 animated materials with a manual step (Sakon's hideout, music box house). Segment 6 in rooms is the area texture
file unless config 6 overrides it.

AnimatedMaterial list (scene command 0x1A): entries `{s8 segment; s16 type; ptr params}` (8 bytes); segment used =
|segment| + 7; the list ends after the first entry with a negative segment; a first segment of 0 means no list.

| type | params | static frame (step 0) |
|---|---|---|
| 0 tex scroll | `{s8 xStep, yStep; u8 w, h}` | TexScroll(0, 0, w, h) |
| 1 two-layer scroll | 2 × the above | TwoTexScroll with offsets 0 |
| 2 colour, no interpolation | `{u16 keyFrameLength, keyFrameCount; F3DPrimColor* (r,g,b,a,lodFrac); F3DEnvColor* or 0; u16* keyFrames}` | prim = primColors[0] (alpha × ratio), env = envColors[0] |
| 3 colour, linear | same | key frame 0 colours when keyFrames[0] = 0 |
| 4 colour, Lagrange | same | Lagrange polynomial at 0 (= key 0 when keyFrames[0] = 0) |
| 5 texture cycle | `{u16 keyFrameLength; TexturePtr* list; u8* indices}` | segment = list[indices[0]] |

Census MM US (**verified**, `scene-mm/report-mm-us.txt`): type 1 × 165, 2 × 3, 4 × 1, 5 × 1, and 42 empty lists; no type 0
or 3. Renderer: `scenes/drawcfg.ts mmAnimatedMaterials`, **verified** on South Clock Town and Termina Field (§10.2).

Area textures (MM scene command 0x11 data1 = N): `scene_texture_0N` loaded into segment 6 (**doc**
`Scene_LoadAreaTextures`). Table `sSceneTextureFiles[9]` = `{0,0}` then 8 RomFiles; located (**verified**) as the run
{0,0} + 8 files with consecutive filesystem indices followed by a non-RomFile word (a 0x80xxxxxx pointer): US code
+0x11CBA0 (files 1114-1121), dbg PAL code +0x154C70 (files 1131-1138). Five other {0,0}+8 runs (object table) fail the
last condition.

### 5.5 Collision and waterboxes

Same layout in both games (**doc** `bgcheck.h`, MM `z64bgcheck.h`; **verified** parser `scenes/zscene.ts parseCollision`,
`scenes/camcheck.ts`; overlay render below):

```
CollisionHeader (0x2C): Vec3s min, max; u16 numVertices @0x0C; Vec3s* vertices @0x10; u16 numPolys @0x14;
  CollisionPoly* polys @0x18; SurfaceType* surfaceTypes @0x1C; BgCamInfo* bgCams @0x20; u16 numWaterBoxes @0x24;
  WaterBox* waterBoxes @0x28
CollisionPoly (0x10): u16 type (surface type index); u16 vIA (bits 13-15 ignore flags camera/entity/projectile);
  u16 vIB (bit 13 conveyor flag); u16 vIC; Vec3s normal (/0x7FFF); s16 dist
SurfaceType (8): u32 w0: bgCamIndex 0-7, exit 8-12, floorType 13-17, wallType 21-25, floorProperty 26-29, soft 30,
  horse block 31; u32 w1: material 0-3, floorEffect 4-5, lightSetting 6-10, echo 11-16, hookshot 17, conveyor speed
  18-20 / direction 21-26, wall damage 27
BgCamInfo (8): u16 setting; s16 count; ptr data (0 = no data). No count: size = highest bgCamIndex used by surface
  types or waterboxes + 1
BgCamFuncData (0x12): Vec3s pos; Vec3s rot; s16 fov; s16 flags/roomImageOverrideBgCamIndex; s16 unused
  (crawlspace settings point at `count` Vec3s points instead)
WaterBox (0x10): s16 xMin, ySurface, zMin, xLength, zLength; u32 properties: bgCam 0-7, light setting 8-12
  (0x1F none), room 13-18 (0x3F all rooms), bit 19 disabled
```

Examples (**verified**, `camcheck.ts`): Hyrule Field 1 162 vertices, 1 579 polys, 61 surface types, 4 bg cams, 6
waterboxes (ySurface −60 / −315); Kokiri Forest 1 081 / 1 692 / 46 / 15 bg cams / 1 waterbox; Deku Tree 1 399 / 2 321 /
30 (US) or 31 (MQ) / 11 / 3 (per-room waterboxes rooms 3, 5, 9).

Overlay drawing (**verified**, `render.ts --collision`: `scenes/renders/sbs-oot-us10-kokiri-forest-1-collision.png`,
`oot-us10-hyrule-field-1-collision.png`): one mesh of world-space triangles (no transform), flat-coloured by surface type
(or by floor/wall/ceiling from the normal's y), translucent, depth-tested without depth write; waterboxes as translucent
quads from (xMin, zMin) to (xMin + xLength, zMin + zLength) at y = ySurface (optionally extruded downward). Both line up
exactly with the room geometry. Dynamic collision (actors) is not in the scene file.

### 5.6 Units and coordinates

- 1 vertex unit = 1 world unit; right-handed, Y up; the N64 look-at/perspective are the standard GL-like ones.
  **Verified**: renders with `mirrorX: false`, `vertexScale: 1` reproduce every screenshot (ladder left / vines right on the
  Kokiri balcony; castle and hills positions in Hyrule Field; Clock Town walls); a mirrored render would swap sides.
- Rooms are already in world space: the game loads the identity modelview before each room (**doc**); every room of a
  scene shares the scene's coordinate frame (collision is one scene-wide mesh). Viewer: one instance per room with the
  identity matrix.
- Winding: front faces are counter-clockwise on screen with G_CULL_BACK (**verified** by render culling).
- Angles: s16 binary angles (0x8000 = 180°); collision normals s16/0x7FFF; world coordinates up to ±32 760
  (BGCHECK_XYZ_ABSMAX); OoT room vertices span x −11 048..11 320, y −4 055..5 701, z −11 491..17 911 (US census).

### 5.7 Per-version differences (scenes and rooms)

#### 5.7.1 OoT US 1.0 vs MQ GameCube debug

(**verified**, `scenes/ootcmp.py`, `scenes/ootroomdiff.py`, `scenes/ootroomhdr.py`, room-list vroms masked)
- Scene table 101 vs 110 entries (101-109: debug scenes, not investigated). 69 scenes byte-identical (scene + all rooms).
- The 12 Master Quest dungeons differ completely (ids 0-9, 11, 13; e.g. Deku Tree scene 0xDA10/0xDA20, 30 vs 31 surface
  types; all rooms differ).
- Overworld rooms were restructured: US mesh type 0 with one entry → MQ type 2 with n cullable entries, same actor and
  object counts: Kokiri Forest rooms 0/1/2 (1 → 18/3/7 entries), spot02 rooms 0/1 (1 → 9/20), spot09 (1 → 32), spot16
  (1 → 9); spot01/08/17 rooms differ slightly in size with identical header summaries. Scene files of these scenes are
  identical or differ in a few bytes (spot00 6, spot15 4, spot16 7, spot12 1 139, spot17 772, spot20 52 302).
- Draw config: day/night pointer table placement (US after the 53-entry function table at +0xEAD4C, MQ directly after
  sDefaultDisplayList at +0x10D498) and values (Deku Tree 0x0200BA08 vs 0x0200BA18, Water/Spirit/GTG/Ice Cavern MQ
  values); Water Temple entrance texture segment 6 (US) vs 8 (MQ) (**doc** `#if OOT_MQ`; US census shows XLU SETTIMG
  segment 6 in scene 5).
- Renders: Hyrule Field US and MQ render to the same image apart from the time-of-day sun (identical data).

#### 5.7.2 MM US vs debug PAL

(**verified**, `scene-mm/compare2.py`, `scenes/mmdiff.py`; region attribution is coarse: a "region" runs from one pointer
target to the next)
- Rooms byte-identical except scenes 50 Z2_16GORON_HOUSE, 86 Z2_IKNINSIDE, 97 Z2_YADOYA, 101 Z2_LOST_WOODS (checkpoint).
- 67 of 102 scene files identical after masking main-header room lists. Of the other 35, most differ only in
  alternate-header room lists (vroms; e.g. Z2_OKUJOU, Z2_KYOJINNOMA, Z2_ICHIBA, Z2_BACKTOWN, Z2_33ZORACITY). Real data
  differences fall in light-settings regions (Z2_LABO 103 bytes, Z2_MILK_BAR alt 3, Z2_YOUSEI_IZUMI, Z2_10YUKIYAMANOMURA2,
  Z2_CLOCKTOWER alt 1, Z2_11GORONNOSATO2, Z2_DEKU_KING, Z2_F01C, Z2_OPENINGDAN), path regions (Z2_IKANA, Z2_KAIZOKU,
  Z2_00KEIKOKU alt 9, Z2_F01 alt 5, Z2_TOWN alt 1, Z2_CLOCKTOWER alt 3, Z2_BOTI, Z2_30GYOSON), collision polys
  (Z2_AYASHIISHOP 2 bytes, Z2_11GORONNOSATO 8) and size changes (SPOT00 alt-10 lights −0x20, 16GORON_HOUSE lights +0xA0,
  IKNINSIDE −0x20, YADOYA paths −0x1E0, INSIDETOWER −0x1C0, LOST_WOODS +0x10).
- South Clock Town renders pixel-identically from both ROMs with the same camera (**verified**,
  `scenes/renders/mm-dbgpal-sct-with-mmus-camera.png`: 0 differing pixels), and the loader's structure finders work
  unchanged on debug PAL.
- Debug PAL captures (`ref/mm-dbgpal/`): South Clock Town day and Termina Field render as well as US (best-75% error
  3.2 / 3.4). RAM equals the scene-data computation on debug PAL too: SCT lights and sky; Termina Field from layer 0
  (the debug load ended in layer 0, US in layer 5) gives header sky config 10 → 25 on day 1, textures 1/1, blend 255,
  exactly the RAM values, while US layer 5 has config 0 (RAM 0/0/0). PAL runs time at 3 units/frame (sceneTimeSpeed 3)
  instead of 5; sky rotation read from RAM (−0.066 / −0.1017 rad) as on US.

## 6. Actors and objects

Scripts and outputs: `lead/dumpscene.py` (lists of one scene/layer), `lead/actorclass.py` -> `lead/actors-<rom>.tsv`
(every actor id used by the ROM: usage counts, category, object, scale, draw class, display lists resolved to
object offsets and checked against the ROM), `lead/drawfuncs.py` -> `lead/drawfuncs-<rom>.txt` (init scale and
draw function source of the 40 most used static actors), `actors/zdata.py`, `actors/count.py` -> `actors/counts_<rom>.tsv`
(usage counts over all unique room actor lists of all setups), `fs/tables.py` (overlay/object tables).

### 6.1 Where actors come from

| data | command / table | record | notes |
|---|---|---|---|
| room actor list | room cmd 0x01: count in byte 1, segment-3 pointer | 0x10: `s16 id; Vec3s pos; Vec3s rot; s16 params` | per room and per layer (room files have their own alternate headers, cmd 0x18) |
| transition actors | scene cmd 0x0E | 0x10: `s8 frontRoom, s8 frontCam, s8 backRoom, s8 backCam; s16 id; Vec3s pos; s16 rotY; s16 params` | doors and loading planes between two rooms; belong to the scene, draw once |
| player entries (spawns) | scene cmd 0x00 | ActorEntry with id 0 (Player); params = start mode | e.g. OoT Kokiri Forest has 12 |
| entrance list | scene cmd 0x06 | 2 bytes: `u8 playerEntryIndex; u8 room` | indexed by the spawn number of an entrance |
| object list | room cmd 0x0B: count, pointer to `u16` object ids | | objects loaded for the room (plus the keep objects) |
| special files | scene cmd 0x07: byte 1 = OoT Navi hint file, `u16` keep object id | | 2 = gameplay_field_keep, 3 = gameplay_dangeon_keep, loaded as segment 5; gameplay_keep (object 1) is always segment 4 |
| object table | in `code` | 8: RomFile {vromStart, vromEnd} | OoT 402 ids, MM 643 ids; entry 0 empty |
| actor overlay table | in `code` | 0x20: RomFile; vramStart; vramEnd; loadedRamAddr (0 in ROM); profile pointer; name pointer (debug builds only); u16 allocType; s8 numLoaded | OoT 471 ids, MM 690 ids; 3 internal actors (in `code`) have no RomFile |
| actor profile | pointed to by the table | `s16 id; u8 category; u32 flags; s16 objectId; u32 size; init; destroy; update; draw` | category and objectId are readable generically from the ROM |

**Verified** (ROM bytes: `lead/dumpscene.py oot-us10 0x55` Kokiri Forest and `lead/dumpscene.py mm-us 0x6F` South Clock Town
give plausible positions inside the rooms, actor ids that match the rooms' object lists, and rotations as described below;
table locations and counts from `fs/tables.py`, where the profile id equals the table index for 420 of 426 OoT and 571 of 573 MM
overlays; the debug ROMs carry name pointers for 429 (OoT) and 575 (MM) actors, the retail ROMs none).
Record layouts: **doc** (`oot-decomp/include/scene.h`, `mm-decomp/include/z64scene.h`, `z64actor.h`).

#### Rotation and id encoding

- **OoT:** `rot` and transition `rotY` are binary angles (0x10000 = 360 degrees), used as is. Kokiri Forest room 0 has
  e.g. `En_Ko rot.y = 0x4000` (90 degrees). **Verified** (ROM bytes), **doc** (`z_actor.c` Actor_SpawnEntry).
- **MM** (`mm-decomp/src/code/z_actor.c` Actor_SpawnEntry, Actor_SpawnSetupActors, Actor_SpawnTransitionActors; **doc**,
  spot-checked in ROM bytes):
  - actor id = `id & 0x1FFF`; bits 15/14/13 flag rot.y / rot.x / rot.z as "raw".
  - each rotation: `v = (rot >> 7) & 0x1FF`; without the flag the angle is `v` degrees (converted to a binary angle);
    with the flag `v` (minus 360 if above 180) is passed on unconverted (actors with the flag use it as data; a viewer
    should treat it as a binary angle, which is what the game does).
  - `rot.y & 0x7F` = cutscene id (0x7F = none); half-day mask = `((rot.x & 7) << 7) | (rot.z & 0x7F)`, 0 = always.
    Bits: 0x200 day 0 dawn (day), 0x100 day 0 night, 0x80 day 1 day, 0x40 day 1 night, ... 0x02 day 4 day, 0x01 day 4 night.
  - transition actors: `rotY` = `(rotY >> 7) & 0x1FF` degrees, `rotY & 0x7F` = cutscene id.
  - Examples (MM US South Clock Town room 0): `En_Akindonuts rot = (0x0007, 0x2D7F, 0x007F)` -> yaw 90 degrees, no cutscene,
    all half-days; `Obj_Syokudai rot.x = 0x0002, rot.z = 0x0055` -> mask 0x155 = the five night bits (torches only at night);
    `En_Talk id = 0xE261` -> actor 0x261 with all three raw flags; transition `En_Door rotY = 0x70FF` -> 225 degrees.
    **Verified** (ROM bytes).
  - Default filter for the viewer: day 1 daytime (bit 0x80), which is also the reference capture time.

#### Entrances (for markers and the default spawn)

- **OoT:** `gEntranceTable` in `code`, 1556 records `{s8 sceneId, s8 spawn, u16 flags}`, ending exactly where the scene
  table begins (found by structure: a run of records with sceneId <= 0x6E and spawn < 0x20 before the scene table; first
  record `00 00 41 02`). Entrance numbers come in groups of four for the layers child day, child night, adult day, adult
  night, followed by cutscene entrances. **Verified** (both OoT ROMs: `lead/levels.py`), **doc** (`include/tables/entrance_table.h`).
  37 records of the US ROM (4 of the MQ debug ROM) name scene 0x6E, which does not exist (test scenes absent from retail).
- **MM:** entrance = `(sceneEntranceIndex << 9) | (spawn << 4) | layer`; per-scene tables in `code`: 110 records
  `{u8 count, EntranceTableEntry** table, char* name}`, each entry `{s8 sceneId, s8 spawn, u16 flags}` (a negative scene id
  is stored for some scenes; use its absolute value). **Verified** (`fs/maps.py` maps every map-select entrance of both
  MM ROMs to a scene), **doc** (`mm-decomp` z_play/entrance code).
- For a level view, spawn 0 (player entry referenced by entrance list entry 0) is the natural start marker; OoT and MM
  also start Link there when a scene is entered from the map select. **Doc** (z_select.c).

### 6.2 How the game draws an actor

`Actor_Draw` (**doc**: `oot-decomp/src/code/z_actor.c`, same in MM):

    model = T(world.pos + (0, shape.yOffset * scale.y, 0)) * Ry(shape.rot.y) * Rx(shape.rot.x) * Rz(shape.rot.z) * S(scale)

- `world.rot = shape.rot = spawn rot`; `Actor_Init` sets scale to 0.01, then the overlay's init chain
  (`ICHAIN_VEC3F_DIV1000(scale, n)` = n/1000) or `Actor_SetScale` overrides it. So object vertices are typically in units
  of 1/100 world unit per scale 0.01; some actors use 0.1 or 1.0 (see recipes).
- Segment 6 = the actor's object (its profile objectId unless the actor chooses another object at run time);
  segments 4/5 = gameplay_keep / the scene's keep object. Point lights and the scene's directional lights are bound
  first (`Lights_BindAll`), so lit display lists need the environment lights (§7.4).
- Draw functions call `Gfx_SetupDL_25Opa` / `_25Xlu` (the same setup display list as rooms), then one or more display
  lists, often with extra matrices, primitive/environment colours or texture scroll segments 8/9.

### 6.3 Census: what kinds of actors the levels use

Instances = entries over all unique room actor lists of all setups plus transition actors (`actors/counts_<rom>.tsv`, ROM
bytes). Draw class from the decomp source of each actor (`lead/actorclass.py`): `dl` = draws fixed display lists,
`dyna` = has a collision mesh (DynaPoly), `skel` = skeletal model, `none` = no draw function or effects only.

| draw class | OoT US ids | OoT US instances | MM US ids | MM US instances |
|---|---|---|---|---|
| dl | 64 | 2672 | 75 | 2932 |
| dyna+dl | 91 | 1131 | 78 | 1274 |
| dyna (draws via tables) | 16 | 439 | 15 | 139 |
| skel | 83 | 937 | 137 | 1017 |
| skel+dl | 47 | 819 | 75 | 692 |
| dyna+skel (+dl) | 6 | 273 | 9 | 551 |
| none | 41 | 1398 | 56 | 1353 |
| total | 348 | 7669 | 445 | 7958 |

OoT US by category: PROP 85 ids / 2923, BG 89 / 1289, ENEMY 49 / 820, ITEMACTION 27 / 715, NPC 75 / 689, DOOR 3 / 638,
CHEST 1 / 179, MISC 1 / 173, SWITCH 5 / 117, BOSS 12 / 40.

Static candidates (class with `dl` or `dyna`, category PROP/BG/SWITCH/CHEST/DOOR): OoT US 154 ids with 4311 instances,
of which the 40 most used cover 3637 (84 %); MM US 142 ids / 3947 instances, top 40 cover 3377 (86 %). **Verified**
(ROM counts) + **doc** (classification).

The most used actors (both games): pots (Obj_Tsubo), torches (Obj_Syokudai), doors (En_Door, Door_Shutter), loading planes
(En_Holl), trees and bushes (En_Wood02, En_Kusa), rocks (En_Ishi), crates (Obj_Kibako2), chests (En_Box), bomb rocks
(Obj_Bombiwa), signs (En_Kanban), gossip stones (En_Gs), switches (Obj_Switch), item drops (En_Item00) and invisible
helpers (En_Wonder_Item, Elf_Msg, En_River_Sound, Obj_Mure2). MM adds Deku flowers (Obj_Etcetera), lily pads (Bg_Lotus),
the Clock Town clock tower parts (Obj_Tokeidai, Obj_Tokei_Step, Obj_Tokei_Turret), snowballs, barrels, En_Twig and the
moon (En_Fall).

### 6.4 Recommendation for the viewer

1. **Static scenery, drawn by default:** props and background actors with fixed display lists (a recipe table, below).
   Several set pieces are actors, not room geometry: e.g. MM South Clock Town's clock face, gears, stairs and scaffold
   (Obj_Tokeidai x5, Obj_Tokei_Step, Obj_Tokei_Turret x7 in room 0), OoT's gravestones (Bg_Haka), Spirit Temple pillars
   (Bg_Jya_Ironobj), Ice Cavern icicles, dungeon doors (Door_Shutter) and wooden doors (En_Door). **Verified** by render
   (§6.5): the carnival tent left of the South Clock Town start view is Obj_Tokei_Turret, Kakariko's windmill sails are
   Bg_Spot01_Fusya and the night torches are Obj_Syokudai; without them the renders show holes where the screenshots have
   these set pieces.
2. **Skeletal models** (NPCs, enemies, chests, flags, doors with a skeleton): markers by default. Optional later: draw the
   skeleton in its bind pose or frame 0 of the actor's idle animation. Formats (**doc**, `include/animation.h`):
   `SkeletonHeader {Limb** limbs; u8 limbCount}`, `FlexSkeletonHeader {SkeletonHeader; u8 dListCount}`,
   `StandardLimb {Vec3s jointPos; u8 child; u8 sibling; Gfx* dList}` (0x0C), `LodLimb` (0x10, near/far display lists),
   `AnimationHeader {s16 frameCount; s16* frameData; JointIndex* jointIndices; u16 staticIndexMax}` with
   `JointIndex {u16 x, y, z}` (index < staticIndexMax: a constant from frameData). Flex skeletons (most NPCs) pass limb
   matrices to their skinned meshes; that is the hard part. Wooden doors (En_Door) and chests (En_Box) are skeletal but
   their closed pose is the bind pose plus a per-scene door display list (**hypothesis** for the closed pose).
3. **Invisible logic actors** (class `none`: loading planes En_Holl, En_Wonder_Item, Elf_Msg*, En_River_Sound, Obj_Mure*,
   Object_Kankyo, En_Light's flames): markers in a layer hidden by default.
4. **Spawns and transitions:** a marker for every player entry (label with the spawn number and the room from the entrance
   list) and every transition actor (label with the two rooms).
5. **Markers:** label = actor name + params in hex (e.g. "En_Ko 0xFF02"), `info` = id, params, raw rotation, room,
   category, object; one `LevelLayer` of kind `markers` per category group (NPCs, enemies, items, logic), all but spawns
   hidden by default. Names: a static table from the decomp `actor_table.h` (both games; the ids are the same in all
   versions of a game), cross-checked against the debug ROMs' own name pointers.
6. **Layer/time filtering:** OoT actor sets come from the room header of the selected layer (child day, child night, adult
   day, adult night). Many actors also kill themselves in their init for the wrong age or time (e.g. `LINK_IS_ADULT`,
   `IS_DAY` checks in source); that is not derivable from data, so draw everything the layer lists. MM: filter by the
   half-day mask against the selected time (default day 1 daytime, bit 0x80).

#### Recipe table (most used static actors)

Offsets are into the dmadata file of the object (object table id -> file), for OoT US 1.0 and MM US; `lead/actors-<rom>.tsv`
lists every display list the source references, with its offset for that ROM and whether the offset parses as a display
list in that ROM (`ok`/`bad`). DL offsets: **doc** (decomp asset XMLs, with `<Version Pattern>` blocks applied for the ROM),
checked against ROM bytes (**verified** that each listed offset starts a well-formed F3DEX2 display list; drawing correctness
not yet verified by render). Params rules and scales: **doc** (actor source; `lead/drawfuncs-<rom>.txt`).

**OoT US 1.0**

| actor (id) | object | display list(s) | selection | scale | notes |
|---|---|---|---|---|---|
| Obj_Tsubo (0x111) | gameplay_dangeon_keep / object_tsubo | 0x17870 (pot) / 0x17C0 | params bit 8: 0 dangeon_keep, 1 object_tsubo | 0.15 | object chosen by params |
| Obj_Syokudai (0x05E) | object_syokudai | golden 0x3A0, timed 0xB90, wooden 0x870 | params >> 12 | 1.0 | flame (gameplay_keep gEffFire1DL, billboard, +52 Y) optional |
| En_Wood02 (0x077) | object_wood02 | opaque + translucent pairs, e.g. 0x78D0/0x7968, 0x7CA0/0x7D38, 0x80D0/0x81A8 (trees), 0x90/0x160, 0x340/0x440 (bushes), 0x700 (leaf) | params = type; draw type and scale set in init | per type | env colour per type (green 50,170,70; yellow 180,155,0; else white) |
| Obj_Kibako2 (0x1A0) | object_kibako2 | 0x960 | - | 0.1 | large crate |
| Obj_Bombiwa (0x127) | object_bombiwa | 0x9E0 | - | 0.1 | yOffset -200 |
| En_Kusa (0x125) | gameplay_field_keep / object_kusa | field bush 0xB9D0 / 0x140 | params & 3: 0 field_keep, 1-2 object_kusa | 0.4 | |
| En_Ishi (0x14E) | gameplay_field_keep | small 0xA880, large silver rock 0xA3B8 | params & 1 | per type | |
| Bg_Haka (0x09D) | object_haka | stone 0x1B0 (opaque), earth 0x2A8 (translucent) | - | 0.1 | gravestone |
| Bg_Ice_Turara (0x1C7) | object_ice_objects | 0x23D0 | - | 0.1 | yOffset 1200 |
| En_Kanban (0x141) | object_kanban | material 0xC30 and the 11 sign parts 0xCB0..0x1540 in one pass (the material list only sets state) | - | 0.01 | translate Z -100; a child's sign is lowered 15 units in init (**verified** by render) |
| Bg_Spot01_Fusya (Kakariko windmill) | object_spot01_objects | sails 0x100 | - | 0.1 | rot.z animated; pick a phase (**verified** by render) |
| Door_Ana (0x09B) | gameplay_field_keep | 0x1390 (translucent) | - | grows from 0 | grotto hole |
| Obj_Switch (0x12A) | gameplay_dangeon_keep | floor 1/2/3, rusty, eye (texture on segment 8), crystal (opaque + translucent) | params & 7 = type, subtype bits | 0.1 | |
| En_Gs (0x1B9) | object_gs | material 0x950, stone 0x9D0, 0xA60 | - | 0.1 | primitive colour white |
| Bg_Jya_Ironobj (0x169) | object_jya_iron | pillar 0x240, throne 0x1050 | params | 0.1 | |
| Bg_Spot02_Objects (0x09C) | object_spot02_objects | 0x13F0, 0x126F0, ... | params type | 0.1 | Graveyard/Kakariko set pieces |
| Door_Shutter (0x02E, transition) | per scene (object_ydan_objects 0x67A0 / 0x6910, object_ddan_objects 0xC0, object_bdoor 0x10C0, ...) | door + bars display lists from its per-scene graphics table | scene + params | 0.1 | |
| En_Door (0x009, transition) | gameplay_keep / gameplay_field_keep (left 0x47A0, right 0x4978) / object_hidan_objects / object_haka_door | skeleton + door DL by scene | scene | 0.01 | skeletal |
| En_Box (0x00A) | object_box | skeleton gTreasureChestSkel + front/side DLs (0x6F0, 0x10C0; boss key 0xAE8, 0x1678) | params type | 0.005 small, 0.01 big | skeletal |

**MM US**

| actor (id) | object | display list(s) | selection | scale | notes |
|---|---|---|---|---|---|
| Obj_Tsubo (0x082) | per type (`sPotTypeData`) | type's model DL | params type | per type | |
| En_Kusa (0x090) | gameplay_keep | sprout (gKusaSproutDL) | - | 0.4 | |
| Obj_Syokudai (0x039) | object_syokudai | three torch types | params type | 1.0 | often night-only via the half-day mask |
| En_Ishi (0x0B0) | gameplay_keep / object_ishi | small rock, silver boulder / gSmallRockDL | params size/object flags | per size | |
| Obj_Etcetera (0x183) | gameplay_keep | pink flower 0xED80 (types 0/1), gold flower 0x11BD0 (types 2/3) when idle; skeleton when animated | type = (params & 0xFF80) >> 7 | 0.01, scale.y 0.02 | **verified** by render (SCT gold flower) |
| Obj_Tokei_Turret (0x221) | object_tokei_turret | base 0x2508, top 0x2A88, flags 0x3038 | params & 3 | 0.1 | carnival tower tiers stacked by half-day mask (**verified** by render) |
| En_Twig (0x1A5) | object_twig | 0x1C38 (type 1), 0x14C8 (type 2) | params | varies | Deku race rings |
| Bg_Lotus (0x1B9) | object_lotus | gLilyPadDL | - | 0.1 | |
| En_Wood02 (0x041) | object_wood02 | as OoT | params type | per type | |
| Obj_Tokeidai (0x19C) | object_obj_tokeidai | clock face assembly (minute ring, centre and hand, face, sun/moon panel), counterweight + spotlight, exterior gear, wall clocks; opaque/translucent DL chosen in init | params type | 0.1 (some types 0.15, 0.02, 0.01) | draws with pivot translations (e.g. Z -1791); rest pose = zero rotations |
| Obj_Snowball (0x1DC), Obj_Snowball2 (0x1F9) | object_goroiwa | 0x8B90 | - | 0.1 x size / 0.025 | |
| En_Kanban (0x0A8) | object_kanban | material + sign parts | - | 0.01 | |
| En_Gs (0x0EF) | object_gs | material, stone, bottom | - | 0.1 | primitive colour per params |
| Obj_Switch (0x093) | gameplay_dangeon_keep | floor, rusty, eye, crystal | params type | per type | |
| Obj_Kibako2 (0x0E5) | object_kibako2 | gLargeCrateDL | - | 0.1 | |
| Obj_Taru (0x22D) | object_taru | barrel / breakable pirate panel | params & 0x80 | 0.1 | |
| Bg_Umajump (0x07C) | gameplay_keep | gHorseJumpFenceDL | - | 0.1 | |
| Obj_HsStump (0x25E) | object_hsstump | 0x3B8 | - | 0.18 | |
| Bg_Icicle (0x11F), Obj_Tree (0x229), Obj_Bombiwa (0x092), Obj_Comb (0x0E4), Obj_Visiblock (0x1C0), Bg_Lbfshot (0x297) | own objects | single DL each | - | 0.1-0.15 | |
| En_Fall (0x17C) | object_fall / object_lodmoon | the moon (gMoonDL / gLodmoonMoonDL) | params type | per type | the moon in the sky of Clock Town and Termina Field |
| En_Door (0x005, transition), En_Box (0x006) | per scene / object_box | skeletal | | 0.01 / 0.0075 | as OoT |

#### Version differences that affect recipes

- Actor ids and object ids are identical across the versions of each game (same tables: OoT 471/402, MM 690/643).
  **Verified** (table sizes; profile ids).
- Object files: OoT US vs MQ debug: 267 identical, 115 differ (sizes or bytes, e.g. gameplay_keep); MM US vs debug PAL:
  453 identical, 12 differ. **Verified** (`actors/objcmp.py`). So display-list offsets must be per version.
- Of the display-list offsets resolved from the decomp XMLs, 589 parse as display lists in OoT US (9 fail), 568 in MQ debug
  (18 fail), 901 in MM US (4 fail), 892 in MM debug PAL (13 fail; the MM XMLs describe the US build). Failures are
  objects whose layout differs in that build and the XML has no version block for it (e.g. object_fa, object_sd,
  object_bv in OoT; object_market_obj in MM). **Verified** (ROM bytes, `lead/actorclass.py`).
- gameplay_keep entries in the OoT XML have no explicit offsets (lengths only), so they resolve as `?` in the TSV; the
  loader needs those offsets by another route (see open questions).

#### Generic alternative to hard-coded offsets

Actors reference their display lists either from pointer tables in the overlay's data section (e.g. Obj_Syokudai's
`{gGoldenTorchDL, gTimedTorchDL, gWoodenTorchDL}`) or from `lui rX, 0x0600` + `addiu rX, rX, imm` pairs in code
(segment addresses are not relocated). Scanning an overlay for both forms and keeping targets that parse as display lists
in the actor's object finds the same offsets as the decomp XMLs: Obj_Syokudai (data table 0x3A0/0x870/0xB90), Obj_Bombiwa
(0x9E0), Obj_Kibako2 (0x960, 0x1000), Bg_Haka (0x1B0, 0x2A8) in OoT US; Obj_Tokeidai (8 display lists), Bg_Lotus (0x40),
Obj_Taru, Obj_Kibako2 (0x960, 0x1040) in MM US. **Verified** (ROM bytes; lead's scan script in this session). Actors
whose object is chosen at run time (Obj_Tsubo: profile object gameplay_keep, draws from gameplay_dangeon_keep or
object_tsubo) need the scan against the other candidate objects. The scan gives candidates, not the params rule, so a
hand-written recipe table keyed by actor name remains necessary; the scan can supply per-version offsets for its entries.

### 6.5 Verification by render

Method: `scenes/actors.ts` reads room actor lists (per layer) and transition actors, decodes MM ids/rotations and the
half-day mask; `scenes/inview.ts` lists the actors that project into a capture's view; `scenes/actordraw.ts` holds draw
recipes transcribed from the actors' draw functions; `render.ts --actors` draws them with the actor's object as segment 6,
gameplay_keep as segment 4, the scene's keep object (command 0x07) as segment 5, SETUPDL_25 state and the scene lights,
matrix `T(pos + (0, yOffset·scale.y, 0)) · Ry · Rx · Rz · S(scale)` followed by the draw function's own matrices.
Skeletal actors (NPCs, En_Box, En_Door, En_Akindonuts, ...) are left out. Object files by id from `fs/tables-<rom>.json`.

| capture | static actors drawn (in view) | MAE all / best 75%, rooms only → with actors | render |
|---|---|---|---|
| MM US South Clock Town day 1 | Obj_Tokei_Turret base + top (the carnival tent with the red sign, left of the start view), Obj_Etcetera gold Deku flower | 14.25 / 2.60 → 13.25 / 2.55 | `scenes/renders/sbs-mm-us-south-clock-town-day-1-actors.png` |
| MM US South Clock Town night | + Obj_Syokudai ×2 (night-only mask) with flames | 11.58 / 1.71 → 11.17 / 1.68 | `sbs-mm-us-south-clock-town-night-1-actors.png` |
| MM dbg PAL South Clock Town day | as US day | 16.39 / 3.16 → 15.35 / 3.02 | `sbs-mm-dbgpal-south-clock-town-day-1.png` |
| OoT US Kokiri Forest balcony | En_Kanban (sign below the ladder) | 8.89 / 3.16 → 8.83 / 3.04 | `sbs-oot-us10-kokiri-forest-1-actors.png` |
| OoT US Kakariko gate, day | Bg_Spot01_Fusya (windmill sails; rot.z set to 0x2000 to match the animation phase) | 11.08 / 3.05 → 10.65 / 3.02 | `sbs-oot-us10-kakariko-village-1-actors.png` |
| OoT US Kakariko gate, midnight (layer 1) | same, rot.z 0 (the screenshot has another sails phase); the street lamp at the left edge (night layer) has no recipe | 6.91 / 1.93 → 6.80 / 1.87 | `sbs-oot-us10-kakariko-village-night-1.png` |

Identification: the tent/stall left of the SCT start view is **Obj_Tokei_Turret** (room 0 actors 20-26, all at
(−290, y, 160)): params & 3 = 0 base (`gClockTownTurretPlatformBaseDL` 0x2508), 1 top (`…PlatformTopDL` 0x2A88), 2 flags
(`gClockTownFlagsDL` 0x3038); the seven instances stack the carnival tower by half-day (y 0/80/160/240): on day 1 daytime
only base@0 (mask 0xFC) and top@80 (mask 0xC0) pass, which is exactly the tent in the screenshot.

Findings on the actor recipes (§6.1-6.4):

| claim | result |
|---|---|
| draw transform `T(pos + (0, yOffset·scale.y, 0)) · Ry · Rx · Rz · S(scale)` | **confirmed** by render: tent, flower, torches, KF sign and Kakariko sails land exactly on the screenshot; `Matrix_SetTranslateRotateYXZ` rotation sense = x' = x cos + z sin (checked in `sys_matrix.c`) |
| extra draw-function matrices (En_Kanban `T(0,0,−100)`, Obj_Syokudai flame `T(0,52,0)·RY(camYaw − rot.y + 0x8000)·S(0.0027)`) | **confirmed** (sign plank and flames at the right place) |
| scales (turret 0.1, Deku flower 0.01 with scale.y 0.02, torch 1.0, En_Kanban 0.01) | **confirmed** |
| En_Kanban init lowers a child's sign by 15 (`world.pos.y −= 15`) | needed for the match (now in the recipe table) |
| En_Kanban draws `gSignRectangularDL` (gameplay_keep, offset unknown in the OoT XML) | equivalent: object_kanban material 0xC30 followed by the 11 parts 0xCB0…0x1540 in one pass (the material list only sets state; drawing it separately gives no textures) |
| MM half-day mask `((rot.x & 7) << 7) \| (rot.z & 0x7F)`, day-1-day bit 0x80 | **confirmed**: day render shows 2 of 7 turret parts and no torches, night render (bit 0x40) shows the torches (mask 0x155), both matching the screenshots |
| MM rotation in degrees (`(rot >> 7) & 0x1FF`) | consistent (flower yaw 90°) but not a strong test: the actors in the captured views are near-symmetric; the transition door (225°) is skeletal |
| Obj_Etcetera type `(params & 0xFF80) >> 7`, types 0/1 pink 0xED80, 2/3 gold 0x11BD0 in gameplay_keep | **confirmed**: SCT params 0x017F → type 2 → gold flower, as in the screenshot |
| Obj_Syokudai type `params >> 12` → {0x3A0, 0xB90, 0x870}; flame gameplay_keep 0x7D590 (MM US) | **confirmed** (type 2 wooden torch) |
| DL offsets for object_tokei_turret, object_kanban, object_spot01_objects (0x100 sails), gameplay_keep (MM flower, flame) | **confirmed** by render; MM dbg PAL uses the same offsets for these objects |
| Bg_Spot01_Fusya: static sails DL, rot.z animated | **confirmed**; phase matters visually (0 vs 0x2000) |
| which actors matter | the set pieces: Obj_Tokei_Turret (tent), Obj_Syokudai at night (bright flames), Bg_Spot01_Fusya (windmill against the sky); signs, pots, bushes, crates are small or hidden by walls in these views; the largest remaining actor errors are skeletal (Link, NPCs, the Deku Scrub, the gate guard, Kakariko's carpenters) |

Not tested by the captures: OoT Obj_Tsubo/Obj_Kibako2/En_Kusa/En_Ishi/Bg_Spot01_Idohashira recipes are drawn in Kakariko
but hidden behind the gate walls from the capture camera (they produce geometry; placement unverified).

Viewer notes: actors are instances with the formula above; lists that only set material state must be concatenated with
the lists they prepare; half-day filtering (MM) is required or night-only torches and later-day tent tiers appear.

## 7. Environment

### 7.1 Skyboxes: OoT

`skyboxId` from command 0x11 (**doc** `include/skybox.h`, `z_vr_box.c`, `z_vr_box_draw.c`, `Play_Draw`):
- 0 none; 29 (0x1D, SKYBOX_UNSET) none (most dungeons and Kokiri Forest); 1 normal sky; 5 cutscene map (6 faces);
  the other ids are "256" skyboxes: the pictures of shops, houses and the market (see "256 skyboxes" below).
- Drawn first, only if `skyboxId ∉ {0, 29}` and the room's SKYBOX_DISABLES byte is 0; no depth, no fog, cube around the
  eye (`Matrix_Translate(eye)`), `SETUPDL_40` combiner `lerp(TEXEL0, TEXEL1, PRIM_ALPHA)` with prim alpha = skyboxBlend.
- Normal sky files: `gNormalSkyFiles[9] = {RomFile texture, RomFile palette}` = vr_fine0-3, vr_cloud0-3, vr_holy0,
  filesystem files 941-958 in both OoT ROMs; the table is found (**verified**, `env.ts findSkyFiles`) as 9 consecutive
  16-byte pairs of files with 0x100-byte palettes (US code +0xE07AC, MQ code +0x102EDC). Texture file 0xC000 bytes:
  four 128×64 CI8 side faces at 128·64·k, then the 128×128 top face; palette file 128 RGBA16 colours. The two palettes of
  the blended pair are concatenated into one 256-entry TLUT (order: sky 1 first if `(i1 & 1) ^ ((i1 & 4) >> 2)`, else
  sky 2 first).
- Which textures: `gTimeBasedSkyboxConfigs[skyboxConfig][9]` = {start, end, changeSkybox, index1, index2}; config 0 clear
  (fine0 dawn 5:00-6:00, fine1 day 8:00-16:00, fine2 dusk 17:00-18:00, fine3 night, with blends between); config 1
  cloudy/rain (cloud0-3). Blend = LerpWeight(end, start, time)·255 in changing entries; non-changing entries use 255 or 0
  (both textures equal). **Verified**: Hyrule Field noon → fine1/fine1 = RAM skybox1Index/skybox2Index 1/1, blend 0;
  Hyrule Field dusk 0xB3CA → fine1/fine2 blend 218 (changing entry 16:00-17:00) = RAM, render matches the screenshot's
  orange sky; Kakariko midnight → fine3/fine3 blend 255 = RAM.
- Geometry (`Skybox_CalculateFace128`, note the swapped inner/outer arguments): face params {xStart, yStart, zStart,
  outer, inner} = {−64,64,−64,32,−32}, {64,64,64,−32,−32}, {−64,64,64,−32,−32}, {64,64,−64,32,−32}, {−64,64,64,32,−32}
  (+ {−64,−64,−64,32,32} bottom for the cutscene map); 5×5 grid per face; s = 0..124 texels, side-face t = 0, 31, 62,
  31, 0 (the lower half mirrors the upper), top face t = 0..124. **Verified**: `render.ts` builds exactly this and the
  Hyrule Field sky matches the screenshot.
- Viewer mapping: a `Sky` mesh (existing type: drawn around the camera, no depth/fog) with the day texture; bake the two
  textures' blend for other times.

**256 skyboxes** (OoT houses, shops, market; **doc** `z_vr_box.c Skybox_Setup/Skybox_Calculate256`, `Play_Draw`):
- Files: one texture file with 256×256 CI8 faces at face·0x10000 and one palette file with a 256-colour RGBA16 palette per
  face at face·0x200. They follow the normal-sky files in filesystem order (spec order), identical indices in both OoT
  ROMs (**verified** by file sizes, `extracted/*/table.tsv`): 961/962 vr_MDVR (market child day, id 9), 963 MNVR (market
  child night, 10), 965 RUVR (market adult, 4), 967 LHVR (Link's house, 7), 969 KHVR (Know-It-All brothers, 12), 971 K3VR
  (house of twins, 14, 3 faces), 973 K4VR (Mido, 32, 3), 975 K5VR (Saria, 33, 3), 977 SP1a (bazaar, 2, 2 faces), 979 MLVR
  (stables, 15), 981 KKRVR (Kakariko house, 16), 983 KR3VR (alley house, 34, 3), 985 IPVR (Richard's house, 26), 987 KSVR
  (Kokiri shop, 17, 2), 989 GLVR (Goron shop, 19, 2), 991 ZRVR (Zora shop, 20, 2), 993 DGVR (Kakariko potion shop, 22, 2),
  995 ALVR (market potion shop, 23, 2), 997 NSVR (bombchu shop, 24, 2), 999 LBVR (Impa's house, 27); TTVR (tent, 28) and
  FCVR (Happy Mask shop, 11) follow. Texture file sizes 0x40000 / 0x30000 / 0x20000 = 4 / 3 / 2 faces. The file ↔ id
  mapping is code (`Skybox_Setup` switch), so a loader needs a table per id (or the size rule plus spec order).
- Geometry: face params {xStart, yStart, zStart, outer, inner} = {−126,124,−126,63,−31}, {126,124,−126,63,−31},
  {126,124,126,−63,−31}, {−126,124,126,−63,−31} (inner/outer swapped at the call as for 128 skies); faces 0/2 lie in
  z = zStart with x stepping, faces 1/3 in x = xStart with z stepping; 9 rows × 5 columns; s = 63·j texels, t = 31·i texels
  (whole 256×256 texture). Camera-centred, no depth, no fog, TEXEL0 only (blend 0).
- Draw order: after all room lists (unless the camera setting is PREREND_FIXED), so it covers the room's opaque lists
  (they only leave depth for actors); XLU lists and actors come after it.
- **Verified**: `ref/oot-us10/links-house-1` (scene 0x34, skybox 7, pivot camera at (0,34,0)) rendered from files 967/968
  alone: best-75% error 0.4, overall 4.6 (only Link and the HUD differ): `scenes/renders/sbs-oot-us10-links-house-1.png`.
  Viewer: the same `Sky` mesh type, with a camera fixed at the room's bg camera position (the look only works from there).

### 7.2 Skyboxes: MM

- `skyboxId = byte & 3`: 1 normal sky (d2 skybox), 2/3 special (not used by the rendered scenes), 5 cutscene map.
- Files (**verified**, structure scan in `render.ts`): `sNormalSkyFiles = {d2_fine_static, 0}, {d2_cloud_static, 0}` in
  code (US +0x118A14: files 1132/1133; dbg PAL +0x150944: files 1153/1154), 0xC000 bytes each (same face layout as OoT);
  the palette `d2_fine_pal_static` (0x200 bytes, 256 colours) is the next filesystem file in both ROMs (**hypothesis** as
  a rule; true in both).
- `skyboxConfig` from the header is remapped per day by `Environment_Init` (**doc**): `c = dayOffset + cfg·3` (dayOffset
  = day − 1), except cfg 4 → 14, 5 → 16, 6 → 17, 7 → 18 + dayOffset, 8 → 21 + dayOffset, 9 → 24, 10 → 25 + dayOffset;
  dayOffset ≥ 3 → 13; ≥ 28 → 0. **Verified**: South Clock Town header config 10, day 1 → RAM skyboxConfig 25.
- `sTimeBasedSkyboxConfigs[28][9]` = {start, end, index1 (0 fine, 1 cloud), index2, colorIndex1, colorIndex2}; sky colours
  `sSkyboxPrimColors[104]`, `sSkyboxEnvColors[104]` lerped by the entry's weight; combiner `lerp(TEXEL0, TEXEL1,
  PRIM_ALPHA) ; (PRIM − ENV)·COMBINED + ENV` (a tinted greyscale sky). **Verified** against RAM: SCT day 12:50 →
  textures 1/1, colours 93 → prim (235,250,235) env (0,4,199); SCT night 23:08 → 0/0, colour 95 → prim (55,53,91) env
  (26,7,0); Termina Field 15:00 config 0 → 0/0, colour 1 → prim (255,255,255) env (0,15,69). Tables transcribed from the
  decomp for the renderer by `scenes/mmtables.py` (**doc**); a loader must read them from code (offsets not located yet).
- The MM sky rotates: `skyboxCtx.rot.y −= R_TIME_SPEED·1e-4` per frame (**doc**); captured rot.y −0.2365 / −0.5875 /
  −0.8295 rad (**verified** RAM `PlayState+0x46E0+0x208`). A viewer uses 0.

### 7.3 Light settings (command 0x0F)

`EnvLightSettings` (0x16 bytes, same in both games): `u8 ambient[3]; s8 light1Dir[3]; u8 light1Color[3]; s8 light2Dir[3];
u8 light2Color[3]; u8 fogColor[3]; s16 blendRate<<10 | fogNear (10 bits); s16 zFar`. **Verified**: `env/zenv.py`'s layout
reproduces RAM `envCtx.lightSettings` exactly for every capture (via `scenes/env.ts`, §7.4); blend rate = bits 10-15 × 4.

Which entry (**doc** `z_kankyo.c Environment_Update`; MM `Environment_UpdateLights`):
- `lightMode` (command 0x11 byte 6) **1 (settings)**: entry `lightSetting`, 0 at scene start; changed at run time by floor
  polygons (SurfaceType w1 bits 6-10), waterboxes and actors, with blends. Viewer: entry 0. Directions are the stored
  s8 vectors.
- **0 (time)**: `sTimeBasedLightConfigs[lightConfig = 0][7]` picks entries by time and lerps them:
  OoT {0:00-4:00 → 3,3; 4:00-6:00 → 3→0; 6:00-8:00 → 0→1; 8:00-16:00 → 1; 16:00-17:00 → 1→2; 17:00-19:00 → 2→3;
  19:00-24:00 → 3} (end times +1); MM identical except 4:00-6:00 → 3→12 in config 0 (and night→dawn next settings 8,
  8, 16, 16, 20, 24 in configs 1-6). Configs 1-4 (OoT, weather) use entries 4-7, 8-11, 12-15, 20-23. Colours and fogNear/
  zFar are lerped (`LERP` truncating); light directions are not stored values but the sun: `l1 = (−sin(t − 12:00)·120,
  cos(t − 12:00)·120, cos(t − 12:00)·20)`, `l2 = −l1` (moon). The stored directions of entries 0-3 are unused.
- MM day ≥ 2 adds offsets to entries 4-7 from entries (day + 1)·4 + n (`func_800F6CEC`) and rain darkens them.
- Clamps: fogNear ≤ 996, zFar ≤ 12800 (OoT) / 15000 (MM).
- **Verified** (computed from ROM data by `scenes/env.ts currentLights` = RAM `lightCtx`/`envCtx.lightSettings`):
  Kokiri Forest noon (80,80,80 / dir (0,120,20) / (255,255,255) / (70,70,90) / fog (200,200,150) 994 / 5800),
  Hyrule Field dusk 0xB3CA (entries 1 → 2 at t 0.855: ambient (114,88,11), l1 (250,152,79) dir (−114,35,5), fog
  (117,74,60), all = RAM),
  Kakariko Village midnight (layer 1: entry 3, sun direction (0,−120,−20), ambient (40,70,100), fog (0,0,30) 992; sky
  fine3/fine3 with blend 255 from the non-changing entry, all = RAM), Lake Hylia 0x838E, Market Entrance and Link's House
  (lightMode 1 entry 0),
  Hyrule Field 0x8A8C US and 0x871C MQ (dir (−30,116,19) and (−20,118,19)), Deku Tree MQ lightMode 1 entry 0, SCT day
  and night, Termina Field (fog (70,80,70), zFar 12850).

The viewer's **View → Lighting** radio buttons switch the baked RSP vertex lighting between the canonical Dawn, Noon,
Dusk and Night settings for `lightMode` 0 scenes, or the stored Setting 1…N records for `lightMode` 1 scenes. **Off**
uses full-bright shade colour. This control changes lighting only; fog, sky and other time-dependent scene state remain
those of the loaded level variant.

### 7.4 Lights used for rooms

`dirLight1` = light 1 (sun) direction/colour, `dirLight2` = light 2 (moon), ambient = settings ambient (+ adjustments,
0 by default). Both are bound as directional lights for room drawing (§5.3.4). Viewer: `DlLighting {ambient, lights: [{color:
l1Color, dir: normalize(l1Dir)}, {color: l2Color, dir: normalize(l2Dir)}]}`; the direction points toward the light (a
floor facing up is lit by the noon sun (0,120,20)) (**verified** by render).

### 7.5 Fog, clear colour, draw distance

- OoT `Play_SetFog` = `Gfx_SetFog(fogColor, near = fogNear, far = 1000)`; MM far = max(1000, trunc(zFar·5/64)) with
  `Gfx_SetFogWithSync`. `near ≥ 1000`: no fog; `near > 996`: factors (0x7FFF, −0x7F00); else gSPFogPosition(near, far):
  mul = trunc(128000/(far − near)), offset = trunc((500 − near)·256/(far − near)) (**doc** `z_rcp.c`).
- The fog is evaluated with the game projection: zNear 10 (from the View), far = lightCtx.zFar (OoT; MM min(zFar,
  12800)). This is exactly the viewer's `Fog {color, multiplier, offset, near: 10, far: zFar}` formula (`renderer.ts`).
  **Verified** by render (fog colour in the distance of Hyrule Field/Termina Field matches) and RAM projection matrices
  (e.g. zFar 5800 → [2][2] −1.0034, [3][2] −20.0345).
- Blend: render modes with cycle 1 `(FOG, SHADE_A, IN, 1MA)` get fog; `0x0C18…` modes are unfogged.
- Clear colour: black (`Gfx_SetupFrame(0,0,0)`); scenes without a sky show black beyond zFar (**doc**).
- Draw distance: zFar per light setting (4000 Deku Tree, 5800 Kokiri Forest, 12800 fields); room type 2 entries beyond
  zFar are culled by the game. Viewer: use zFar as the far plane default or ignore.

### 7.6 Time of day, sun, default view

- Default time: noon (0x8000) for lightMode 0 (outdoor) scenes: nightFlag 0 (day textures and draw-config day lists),
  light entry 1, sky fine1 (OoT) / MM config colours. lightMode 1 scenes ignore time. Fixed-time rooms (command 0x10 hour
  ≠ 0xFF) set their own time. Offer dawn/dusk/night variants (dusk and midnight blends verified, §7.1, §7.3; dawn not captured).
- Sun/moon billboards and lens flare (`Environment_DrawSunAndMoon`, gameplay_keep textures, position eye + sunPos with
  sunPos = (−sin·3000, cos·3000, cos·500)) are not in scene data; overhead at noon; skip.
- Start position: spawn 0 → `playerEntries[spawns[0].playerEntryIndex]` pos/rot (rot.y s16 binary angle), room =
  `spawns[0].room` (**verified**: Hyrule Field player home pos (160,0,1415) rot −3641 = entry 0; Kokiri Forest entrance
  0xEE uses spawn 3 → (−31,100,1073)… RAM home (−30,100,1025) differs by the entrance's cutscene walk (**hypothesis**)).
- Start camera: the bg camera of the floor under the player. **Verified**: Kokiri Forest balcony camera = bg cam 4
  (setting 24 PIVOT_IN_FRONT) pos (−97,170,906) = RAM eye exactly, looking at the player. Hyrule Field uses bg cam 0
  setting 2 (normal) without data: RAM at = player + (0,44,0), eye = at − 176·(sin yaw, 0, cos yaw) + (0,31,0).
  Recommended `CameraView`: spawn 0 position; if its floor bg cam has data, eye = data pos, target = player + (0,40,0),
  fov 60; otherwise the normal-camera offset above (MM: same rule is a **hypothesis**).

## 8. Music

Work dir: `/home/n64/.ai-tmp/r49/zelda/music/`. Paths below are relative to it unless absolute.

- **Engine.** Both games use Nintendo EAD's sequence driver ("Audio" in the decomps; original names `Nas_*`), the
  same family as Star Fox 64 (`src/rom/music/sf64.ts`) and Yoshi's Story (`src/rom/music/nas.ts`): three-level
  scripts (sequence player → 16 channels → 4 layers per channel), soundfonts, VADPCM samples, point-list envelopes,
  a note pool with stealing, 32 kHz output, **3 driver updates per video frame**, 48 ticks per beat,
  `maxTempo = 10770` (NTSC). OoT and MM differ from each other only in details (§8.2.3); both differ from SF64 in many
  opcodes, the note/voice path, vibrato, reverb, filters and 2-bit ADPCM (§8.2).
- **Data.** Audiobank / Audioseq / Audiotable are dmadata files 3 / 4 / 5 (stored raw) in all four ROMs; the four
  code tables (soundfont, sequence→font map, sequence, sample bank) sit contiguously in `code` and are found by
  structure; every other table the renderer needs is found by signature (§8.1). OoT has 110 sequence ids (109
  distinct), MM 128 (123 distinct).
- **Research renderer.** `render/zdata.ts` (data), `render/zengine.ts` (driver), `render/zsynth.ts` (synthesis),
  `render/zelda.ts` (CLI), run with `/home/n64/nviewer/node_modules/.bin/tsx`. It renders any sequence of either
  game from the ROM's files to WAV with loop points (`wav/`).
- **Verification.** Renders compared with audio captured from the emulator (mupen64plus, rsp-hle, audio-dump
  plugin): OoT title, file select, Inside the Deku Tree, Kakariko (child), Market Entrance, Link's house; MM title
  theme, file select, Woodfall Temple, South Clock Town day 1 match in pitch (chroma ≥ 0.997 at 0 semitones), tempo (stretch 0.9989–1.000,
  within the method's resolution), level (within 0.1 dB where the capture holds only music, ≤ 1.1 dB with in-game
  sound; Market Entrance after applying the game's BGM volume scale 90/127 read from RAM) and waveform (NCC
  0.28–0.94 on the loudest second). Lake Hylia (random field parts) matches statistically. MM Termina Field, entered by
  walking out of South Clock Town in a second capture session, matches too (§8.5).
- **Viewer.** A new module `src/rom/music/zelda64.ts` (≈1300 lines, derived from `sf64.ts`) is better than
  extending `sf64.ts` or `nas.ts`; difficulty medium (§8.2.6, §9.4).

### 8.1 Audio data

#### 8.1.1 Files (verified: `scripts/tables.py` → `out/tables_summary.txt`; `render/probe.ts`)

| ROM | Audiobank (file 3) | Audioseq (file 4) | Audiotable (file 5) | code file |
|---|---|---|---|---|
| oot-us10 | vrom 0xD390, 0x1CA50 | 0x29DE0, 0x4F690 | 0x79470, 0x460AD0 | 27, vrom 0xA87000 (Yaz0, ROM 0xA62840), RAM 0x800110A0 |
| oot-mqdbg | 0x19030, 0x2BDC0 | 0x44DF0, 0x4FA80 | 0x94870, 0x451390 | 28, vrom = ROM 0xA94000 (raw), RAM 0x8001CE60 |
| mm-us | 0x20700, 0x263F0 | 0x46AF0, 0x51480 | 0x97F70, 0x548770 | 31, vrom 0xB3C000 (Yaz0, ROM 0xA684D0), RAM 0x800A5AC0 |
| mm-dbgpal | 0x2B2D0, 0x263F0 | 0x516C0, 0x51480 | 0xA2B40, 0x548770 | 49, vrom 0xC95000 (Yaz0, ROM 0xBB1320), RAM 0x800B6AC0 |

The three audio files are stored uncompressed (ROM offset = VROM). The `code` RAM base is derived from the
`gWaveSamples` pointer table (§8.1.3); it reproduces the decomp symbol addresses (OoT NTSC 1.0 gSoundFontTable
0x80113740, gc-eu-mq-dbg 0x801550D0, MM US 0x801E1180) (**verified** against the decomp maps quoted in
`CHECKPOINT.md`).

#### 8.1.2 Code tables (verified: `render/zdata.ts` finds all of them in the four ROMs; `render/probe.ts`)

Offsets are into the decompressed `code` file.

| table (decomp name) | oot-us10 | oot-mqdbg | mm-us | mm-dbgpal | entries |
|---|---|---|---|---|---|
| gSoundFontTable | 0x1026A0 | 0x138270 | 0x13B6C0 | 0x17A7E0 | OoT 38, MM 41 |
| gSequenceFontTable (seq→font map) | 0x102910 | 0x1384E0 | 0x13B960 | 0x17AA80 | one per sequence id |
| gSequenceTable | 0x102AD0 | 0x1386A0 | 0x13BB70 | 0x17AC90 | OoT 110, MM 128 |
| gSampleBankTable | 0x1031C0 | 0x138D90 | 0x13C380 | 0x17B4A0 | OoT 7, MM 3 |
| gAudioSpecs | 0xF36D8 | 0x116968 | 0x135E98 | 0x1671B8 | OoT 18, MM 21 (0x38 bytes each) |
| gPitchFrequencies (f32[128], [39] = 1.0) | 0xEFB24 | 0x112A54 | 0x12FAF4 | 0x160954 | |
| gBendPitchOneOctaveFrequencies / TwoSemitones (f32[256] each, adjacent) | 0xEF324 / 0xEF724 | 0x112254 / 0x112654 | 0x12F2F4 / 0x12F6F4 | 0x160154 / 0x160554 | |
| gHeadsetPanVolume / gStereoPanVolume / gDefaultPanVolume (f32[128]) | 0xEFE98 / 0xF0098 / 0xF0298 | 0x112DC8 / … | 0x12FE68 / 0x130068 / 0x130268 | 0x160CC8 / … | |
| gDefaultShortNoteVelocityTable + GateTime (u8[16] each) | 0xEFD24 | 0x112C54 | 0x12FCF4 | 0x160B54 | |
| gDefaultEnvelope `{1,32000},{1000,32000},{-1,0},{0,0}` | 0xEFD44 | 0x112C74 | 0x12FD14 | 0x160B74 | |
| gLowPassFilterData (s16[16×8]) / gHighPassFilterData (s16[15×8]) | 0xF0498 / 0xF0598 | 0x1133C8 / 0x1134C8 | 0x12D3C0 / 0x12D4C0 | 0x15E220 / 0x15E320 | |
| gSawtoothWaveSample / gWaveSamples (9 pointers) | 0xEE300 / 0xEF300 | 0x111230 / 0x112230 | 0x12E2D0 / 0x12F2D0 | 0x15F130 / 0x160130 | |

**Finding them generically.**
- The four AudioTables (header `s16 count; s16 0; u32 0; 8 bytes 0`, then 16-byte entries) are the tables whose
  entries tile a file exactly (gaps ≤ 0x100): the one with > 64 entries tiling Audioseq is the sequence table, the
  one tiling Audiobank the font table, the one with < 16 entries tiling Audiotable the sample-bank table. Order in
  `code`: font table, seq→font map (starts at font table + 16 + 16·count), sequence table, sample-bank table.
- Float tables by their first three values (0.105112/0.111362/0.117984; 0.5/0.5/0.502736; 1.0/0.995386; 0.707/
  0.716228; 1.0/0.999924), byte tables by content, the envelope and filter tables by their first words.
- `gWaveSamples`: 9 pointers whose last two are equal; `RAM base = pointer[0] − offset(gSawtoothWaveSample)`, where
  the sawtooth starts `0, 1023, 2047, 3071`.
- `gAudioSpecs`: ≥ 16 consecutive 0x38-byte records `{u32 32000|22050; u8 1; u8 numNotes 8..32; u8 players 2..5;
  u8 0; u8 0; u8 numReverbs 1..3; ptr reverbSettings}`.

#### 8.1.3 AudioTable, aliases, seq→font map (verified; doc `include/audio.h`)

```
header (16): s16 numEntries; s16 unkMediumParam; u32 romAddr (0 = start of the file); 8 bytes 0
entry  (16): u32 offset (in its file); u32 size; u8 medium (2 = cart); u8 cachePolicy; u16 shortData1..3
```
- **size 0 = alias**: `offset` is the real index (`AudioLoad_GetRealTableIndex`). Sequence aliases:
  OoT 87 (NA_BGM_FILE_SELECT) → 40 (NA_BGM_GREAT_FAIRY); MM 35 → 22, 40 → 24 (NA_BGM_FAIRY_FOUNTAIN → FILE_SELECT),
  86 → 60, 96 → 87, 97 → 81. Sample bank 1 is an alias of bank 0 in both games (music fonts name bank 1).
- **Font entries:** `shortData1 = sampleBankId1 << 8 | sampleBankId2` (0xFF = none), `shortData2 = numInstruments << 8
  | numDrums`, `shortData3 = numSfx`.
- **seq→font map:** `u16 offset[numSeqs]` indexed by the requested id (aliases have their own row), then at each
  offset `u8 count, u8 fontId[count]`. Every sequence lists 1 font except the SFX sequences (0 and 109 in OoT: fonts
  1, 0; 0 in MM: 1, 0). The player's default font is the **last** entry; channel commands C6/EB pick
  `fontId[count − 1 − index]`. OoT US and MQ debug maps are identical, MM US and debug identical (**verified**,
  `out/compare.txt`).

#### 8.1.4 Soundfonts and samples (verified: `render/zdata.ts` parses all fonts; doc `load.c` AudioLoad_RelocateFont)

Offsets are relative to the font's start in Audiobank unless stated.
```
Font:        u32 drumListOffset; u32 sfxListOffset; u32 instrumentOffset[numInstruments] (0 = empty; ids ≥ 126 unusable)
Drum list:   u32 drumOffset[numDrums]
Sfx list:    numSfx × {u32 sampleOffset; f32 tuning}           (inline TunedSamples)
Instrument:  u8 isRelocated; u8 normalRangeLo; u8 normalRangeHi; u8 adsrDecayIndex; u32 envelopeOffset;
             {u32 sampleOffset; f32 tuning} low, normal, high  (low used below rangeLo if lo ≠ 0; high above rangeHi if hi ≠ 127)
Drum (0x10): u8 adsrDecayIndex; u8 pan; u8 isRelocated; pad; u32 sampleOffset; f32 tuning; u32 envelopeOffset
Sample (0x10): u32 bits {unk 31, codec 30..28, medium 27..26, bit 25, isRelocated 24, size 23..0};
             u32 sampleAddr (offset in the sample bank named by medium: 0 → bank 1 of the font, 1 → bank 2);
             u32 loopOffset; u32 bookOffset
Loop:        u32 start; u32 end; s32 count (0 = none, −1 = forever; MM: 2 = loop until note off, then play to sampleEnd);
             u32 sampleEnd; s16 predictorState[16] only if count ≠ 0
Book:        s32 order (2); s32 numPredictors; s16 book[8 · order · numPredictors]
Envelope:    s16 pairs {delay, arg}: delay > 0 ramp; 0 disable; −1 hang; −2 goto arg; −3 restart
```
- Sample data address = `Audiotable + sampleBankTable[realIndex(bank)].offset + sampleAddr`.
- Differences from SF64: fonts gained the **sfx list** (second word, SF64 had instruments from word 1); the sample
  header's codec field is 3 bits; loops gained `sampleEnd`.

| | OoT US | OoT MQ dbg | MM US / dbg |
|---|---|---|---|
| sample references (instruments + drums + sfx) | 1754 | 1758 | 2492 |
| codec 0 VADPCM / codec 3 SMALL_ADPCM | 1664 / 90 | 1668 / 90 | 2217 / 275 |
| loop count 0 / −1 (no other values) | 1061 / 693 | 1057 / 701 | 1610 / 882 |
| looped samples whose stored predictor state equals the decoded frame containing loop start | 692 / 692 | 700 / 700 | 872 / 876 (max diff 3) |
| book sizes (entries) | 64, 128 (4 or 8 predictors) | same | same |

- **VADPCM (codec 0):** 9-byte frames → 16 samples, as SF64/libultra.
- **SMALL_ADPCM (codec 3):** 5-byte frames: 1 header byte (scale high nibble, predictor low nibble) + 4 bytes of
  2-bit residuals, MSB first; residual = `((code << 14) as s16) >> (14 − scale)` (scale ≥ 14 → no shift), then the
  same order-2 predictor as VADPCM (doc `synthesis.c` `aADPCMdec(flags | 4)`; rsp-hle `adpcm_predict_frame_2bits`).
- **Loops:** restart from the frame containing `start` with `predictorState` as history (**verified** by the table
  above).

#### 8.1.5 Audio specs and reverbs (verified: `render/probe.ts` decodes all specs; values equal
`src/audio/game/session_config.c` (OoT) / `src/audio/session_config.c` (MM), doc)

Record: `{u32 samplingFrequency; u8 unk_04 (1); u8 numNotes; u8 numSequencePlayers; u8 0; u8 0; u8 numReverbs;
ptr reverbSettings; …cache sizes}`. ReverbSettings (0x18): `u8 downsampleRate; u16 windowSize (×64 samples);
u16 decayRatio; u16 subDelay (OoT unk_6); u16 subVolume; u16 volume; u16 leakRtl; u16 leakLtr; s8 mixReverbIndex;
u16 mixReverbStrength; s16 lowPassCutoffLeft; s16 lowPassCutoffRight`.

| game | specs | notes / players | reverb 0 (every spec) | reverb 1 (per spec) |
|---|---|---|---|---|
| OoT | 18 | 24 (16–28) / 4 (3 for specs 10–12) | ds 1, 3072 samples, decay 0x3000 | e.g. spec 1: 3072, 0x1800, low-pass 11; spec 2: 3584, 0x2800, lp 7; spec 3: 4096, 0x5000, leak 0x1800, lp 7; specs 7/9/14: ds 2, 5120, 0x5000, leak 0xD000/0x3000 |
| MM | 21 | 24 (16–28) / 5 (3 for 10–11) | same | specs 0–9, 15: 5120, 0x1800, lp 11; spec 13: a third reverb (ds 2); spec 14: three reverbs |

- Specs 16 (OoT) / 19 (MM) run at 22050 Hz (not used by music scenes seen so far).
- **Which spec plays:** the scene header's `SCENE_CMD_SOUND_SETTINGS` (0x15: `{0x15, specId, 0, 0, 0, 0,
  natureAmbienceId, seqId}`) resets the audio heap with `specId` (doc `z_scene.c`); menus use spec 10
  (`SEQCMD_RESET_AUDIO_HEAP(0, 10)` in OoT `z_file_choose.c`, `Audio_SetSpec(0xA)` in MM). Reverb index per note is
  the channel's `E5` value & 3; notes with an index ≥ numReverbs get no reverb.
- MM: `delayNumSamples = max(windowSize, 4) · 64 / downsampleRate`, minimum 256 (doc MM `heap.c`
  AudioHeap_SetReverbData).

#### 8.1.6 US vs debug ROMs (verified: `scripts/compare.py` → `out/compare.txt`, `scripts/samplecmp.py` →
`out/samplecmp_*.txt`, `scripts/seqscan.py` outputs diffed)

- **OoT US 1.0 vs MQ debug:** same seq→font map and table sizes. Sequences differ only in 0 (SFX, 1 byte), 42
  (NA_BGM_FIRE_TEMPLE: 0xE70 vs 0x1240 bytes, 7 vs 8 channels) and 109 (NA_BGM_CUTSCENE_EFFECTS). Sample bank 0
  differs in size (0x3FA9E0 vs 0x3EB2A0) so sample offsets in 19 fonts shift by a few bytes; sample content is equal
  for all references except font 10 (the Fire Temple font, 12 instrument samples replaced) and font 37 (size 0x3940
  vs 0x12B60). That the change removes the chant from the Fire Temple theme is community knowledge
  (**hypothesis** here; not checked by ear).
- **MM US vs debug PAL:** fonts, sample banks and tables identical; only sequences 0 (SFX) and 43 differ (same
  sizes). The debug ROM is PAL: its audio runs with PAL constants (refresh 50 Hz, `maxTempoTvTypeFactors` 20.03042,
  doc MM `load.c`); a renderer should use the NTSC constants for all four ROMs (the music data is the same).
- **Shared between the games:** 22 MM sequences are byte-identical to OoT sequences, e.g. MM 24 = OoT 40 (file
  select / fairy fountain), MM 64–66 = OoT 64–66, MM 25 = OoT 59, MM 37 = OoT 108 (**verified**, md5 of every
  sequence).

### 8.2 Driver: differences from Star Fox 64 (`sf64.ts`) and Yoshi's Story (`nas.ts`)

Sources: OoT `src/audio/internal/{seqplayer,playback,effects,heap,load,synthesis}.c`, MM `src/audio/lib/*.c`
(doc); rsp-hle `alist_nead.c`/`alist.c` (doc for the emulated RSP); `sf64.ts` and `nas.ts` as ported in the viewer.
Opcode argument sizes are **verified** by `scripts/seqscan.py`, a reachability disassembly of every distinct
sequence in all four ROMs with the decomp argument tables: 0 unknown or undefined opcodes; one read past the end in
OoT seq 2, which is the field-logic sequence loading other sequences into its own buffer at run time (§8.3.3). Its
coverage agrees with the decomp's own disassembler (`notes/songlist/disasm/oot-us10/*.seq`, 105 files): e.g.
channel `combfilter` 2385 = 2385, `bend` 2866 vs 2864, `vol` 25539 vs 25651, layer `notevg` 17360 = 17360.

#### 8.2.1 Common structure (unchanged from SF64)

Sequence player (16 channels) → channel (4 layers) → layer; scripts with 4-deep call/loop stacks; compressed u16
lengths; control flow F2–FF (same encodings, `FD var` delay, `FB` jump, `FC` call); note pools (channel, player,
global) with disabled/decaying/releasing/active lists and the same allocation policies; ADSR point envelopes with
decay/release/sustain states; 3 driver updates per frame, 176 (168–184) samples per update at 32 kHz; `tempoAcc +=
tempo`, one tick when ≥ `maxTempo` = trunc(3·2880000/48/16.713) = **10770** (NTSC; PAL 50 Hz uses 20.03042, MPAL
16.546, doc `load.c`); per-update NoteSampleState snapshots (all 3 script updates of a task run before the 3
synthesis updates); VADPCM; the 4-tap RSP resampler; HILOGAIN; ENVMIXER with 8-sample linear ramps and 16-bit
clamping.

#### 8.2.2 Opcode tables (OoT; MM additions marked **MM**)

**Sequence player** (`AudioSeq_SequencePlayerProcessSequence`)

| op | args | OoT meaning | vs SF64 | vs YS (`nas.ts`) |
|---|---|---|---|---|
| F2–FF | as SF64 | flow | same | same |
| F1 / F0 | u8 / – | reserve / free notes in player pool | same | ignored |
| DF / DE | s8 | transpose set / add | same | same |
| DD / DC | u8 / s8 | tempo = v·48 (clamp maxTempo) / tempoChange = v·48 | same; **MM**: tick uses min(tempo + tempoChange, maxTempo) | same |
| DB / DA / D9 | u8 / u8 s16 / s8 | volume, fade mode, fade volume scale | same | same |
| D7 | u16 | **init channels: only copies font, mute behaviour, note policy** (channels are pre-allocated and reset at sequence start) | SF64 D7 allocates and initialises channels | same as OoT |
| D6 | u16 | **no-op** (argument read) | SF64 D6 frees channels | same |
| D5 / D4 / D3 | s8 / – / u8 | mute scale / mute / mute behaviour | same | ignored |
| D2 / D1 | u16 | short-note velocity / gate table in sequence data | SF64 skips the argument | same as OoT |
| D0 | u8 | note allocation policy | same | ignored |
| CE | u8 | value = random % n | new | ignored |
| CD | u16 | dyn call through a table indexed by value (if value ≠ −1, depth ≠ 3) | new | ignored |
| CC / C9 / C8 | u8 | value = / &= / −= | same | same |
| C7 | u8 u16 | write value + a into the sequence | same | same |
| C6 | – | stop script | new | same |
| C5 | u16 | script counter | new | ignored |
| C4 | u8 u8 | **run sequence b on player a** (0xFF = this player: the sequence replaces itself, IO ports persist); MM ignores it while fading out | new | – |
| EF | u16 u8 | debug (ignored) | same | – |
| **MM** C2 | u16 | jump through a table indexed by value | – | – |
| **MM** C3 | u16 | channel mute mask from a table indexed by value | – | – |
| 0n | – | value = channel n disabled | SF64: finished | same |
| 4n | – | disable channel n | new | same |
| 5n / 7n / 8n | – | value −= io[n] / io[n] = value / value = io[n] (reading ports 0–1 resets them to −1) | SF64 has only port 0 (bgmParam) | same |
| 6n | u8 u8 | async load (font/sample bank), result in io[n] | new | ignored |
| 9n / An | u16 / s16 | start channel n absolute / relative | SF64 has only 9n | same |
| Bn | u8 u16 | **load sequence u8 into this sequence's data at u16**; io[n] = −1 while loading, 1 when done (doc `load.c` slow loads) | new | args skipped |

Script `value` is a persistent s8 per script (SF64 used a fresh 0 each tick at player level).

**Channel** (`AudioSeq_SequenceChannelProcessScript`). Opcodes ≥ 0xB0 (**MM ≥ 0xA0**) take arguments from
`sSeqInstructionArgsTable` (u8/s16 flags per opcode, like YS's `SCOM_TABLE`); below that the layout is:

| op | args | meaning | vs SF64 |
|---|---|---|---|
| 0n | – | delay n ticks (**MM**: n = 0 is a no-op) | SF64 0n = test layer finished |
| 1n | – | load sample (value = instrument; n ≥ 8 uses unk_22 + 0x100) async, status in io | SF64 1n = io[n] = −1 |
| 2n / 3n / 4n / 5n | u16 / u8 / u8 / – | start channel n / write, read another channel's io / value −= io[n] | same meaning, 2n same |
| 6n | – | value = io[n] (ports 0–1 reset on read) | SF64 6n = delay |
| 70–77 / 78–7F | – / s16 | io[n] = value / start layer n relative | SF64 7n = io write only |
| 80–87 / 88–8F | – / u16 | value = layer n finished (−1 if none) / start layer n | SF64 8n = io read, 9n = start layer |
| 90–97 / 98–9F | – | free layer n / start layer n from dyn table | SF64 An / Bn |
| A0–AF | – | no-op in OoT; **MM**: A0–A3 SFX-state read/write, A4 u8 surround index, A5 value += channel index, A6 u8 u16 write into sequence at u16 + channel index, A7 u8 shift value, A8 s16 s16 random pointer | new |
| B0 / B1 / B3 | u16 / – / u8 | filter = 8 s16 in the sequence at u16 / no filter / write low-pass (hi nibble) + high-pass (lo nibble) coefficients into it | new |
| B2 / B4 / B5 / B6 | u16 / – / – / – | unk_22 = u16 at seq[arg + 2·value] / dynTable = unk_22 / unk_22 = dynTable[value] / value = dynTable[0][value] | new |
| B7 / B8 | s16 / u8 | unk_22 / value = random % n | new |
| B9 / BA | u8 | velocity / gate-time random variance (%) | new |
| BB | u8 u16 | comb filter: delay = u8 bytes (u8/2 samples), gain | new |
| BC | s16 | unk_22 += | new |
| BD | s16 s16 (**MM**: s16) | random pointer (**MM**: note start sample position; 1 = loop start) | new |
| BE | – (**MM** u8) | **MM** custom game function (value = f(value)) | new |
| C1 | u8 | instrument: 0–125 font instrument, **0x7E sound effects of the font**, 0x7F drums, ≥ 0x80 synthetic wave | SF64 has no 0x7E |
| C2 / C5 | u16 / – | dyn table / dyn table = table[value] (**MM**: jump to table[value]) | same (MM differs) |
| C3 / C4 | – | short / large notes | same |
| C6 / EB | u8 / u8 u8 | font by index (only if loaded) / font + instrument | same |
| C7 C8 C9 CC CD | | value ops, stop channel u8 | same |
| CA | u8 | mute behaviour (marks volume changed) | same |
| CB | u16 | value = seq[u16 + value] | same |
| CE / CF | u16 | unk_22 = / write unk_22 into sequence | SF64 CE/CF = stored value (same idea) |
| D0 | u8 | **bit 7 = stereo headset effects; bits 0–6 = stereo data** (type, strong L/R, wet inversion) | SF64: whole byte |
| D1 D2 D3 D4 | u8 | note policy, sustain, bend ±1 octave, reverb send | same |
| D7 D8 E1 E2 E3 | | vibrato rate/depth (×32 / ×8, delays ×16) | same |
| D9 DA DB DC DD DE DF E0 | | release (decay index), envelope, transpose, pan weight, pan, freq scale u16/32768, volume /127, volume scale /128 | same |
| E4 | – | dyn call | same |
| E5 | u8 | reverb index (& 3 at note start) | same |
| E6 | u8 | book offset (1 = silent book, 2/3 = RSP commands absent from rsp-hle) | SF64 skips it |
| E7 / E8 | u16 / u8 u8 u8 + 5 bytes | 8 channel parameters; **priority byte: low nibble note priority, high nibble priority of released notes** | SF64: one priority byte |
| E9 | u8 | priorities (two nibbles) | SF64: note priority only |
| EA / EC / ED / EE / EF | | stop script / reset vibrato **and filter, gain, sustain, random variances, comb filter, book offset, freq scale** / gain Q4.4 / bend ±2 semitones / debug | SF64 EC resets vibrato + freq only |
| F0 / F1 | – / u8 | free / reserve notes | same |

**Layer** (`AudioSeq_SeqLayerProcessScriptStep2/3/4/5`)

| op | args | meaning | vs SF64 |
|---|---|---|---|
| 00–3F / 40–7F / 80–BF | large: var u8 u8 / var u8 / u8 u8; short: var / – / – | notes | same |
| C0 | var | rest | same |
| C1 C2 C3 C4 C5 C6 C7 C8 C9 CA CB CC CD | | velocity, transpose, default length, legato on/off, instrument (0x7E sfx), portamento, off, gate, pan, envelope + release, ignore drum pan, stereo | same (C6 adds sfx) |
| CE | u8 | **layer bend ±2 semitones** (multiplies the note frequency) | new |
| CF | u8 | release rate (decay index) | new |
| D0–DF / E0–EF | – | velocity / gate from the player's tables | same |
| **MM** F0 | u16 | clear bits of `unk_0A` (default 0xFFFF; 0x2000 → layer's own reverb send, 0x0040 → gain 0, 0x1000 → layer vibrato) | – |
| **MM** F1 | u8 | layer surround effect index | – |

Layer semantics that differ from SF64:
- **Instrument sound effects**: with instrument 0x7E, `sfxId = (layer transposition << 6) + note`, sample from the
  font's sfx list, frequency = tuning.
- **Zero-length notes**: a note with length 0 lasts `sample.loopEnd · tempo · (60 · 3 / 32006 / maxTempo) / freq + 1`
  ticks (plays the sample once).
- **Random variance**: velocity² ± rand % variance % and gate ± (the decomp bug uses the velocity variance for gate).
- **MM** runs Step2/Step3 again while a rest of length 0 was read.
- A delay command (FD/FE) inside a layer disables the layer (as SF64/YS).

Script coverage in music (seqscan totals over distinct sequences): OoT uses comb filters (4 sequences), channel
filters (8), random (field logic, ambience), dyn calls (SFX, ambience), IO reads (seq ports 0, 2, 4–7), LDSEQ (field
logic), portamento, stereo effects, gain and reverb index mostly in the SFX/ambience sequences; MM additionally uses
RUNSEQ (5 sequences: 29 Clock Town, 103, 104, 116, 122), SAMPLESTART, surround and custom functions (SFX sequence).
Full lists: `out/seqscan_<rom>.txt`.

#### 8.2.3 Player/channel/layer/note state and processing

| item | OoT / MM | SF64 (`sf64.ts`) | YS (`nas.ts`) |
|---|---|---|---|
| IO ports | player 8, channel 8 (s8, −1 = none; ports 0–1 cleared on read) | player port 0 only | player/channel 8 |
| channel reset | at every sequence start all 16 channels are re-initialised (volume 1, pan 64, weight 128, priority 3, released-note priority 1, decay index 0xF0, default envelope, vibrato rate 0x800) | D7 allocates | similar |
| envelope delay | `delay = trunc(delay · 0.75)`, 0 → 1 (all delays) | only delays ≥ 4 scaled | same as OoT |
| decay table | `[251..255] = (1/3)/{0.75,0.66,0.5,0.33,0.25}`; `[128..250] = (1/3)/(251−i)`; `[16..127] = (1/3)/(4·(143−i))`; `[1..15] = (1/3)/(60·(23−i))` | linear `i·3/2560/3` | same as OoT |
| released note priority | channel high nibble (default 1) | 1 | – |
| vibrato | `pitch = sine64[(time >> 10) & 63] + 32768`; `d = 1 + depth/4096`; `f = 1 / ((d − 1/d) · pitch / 65536 + 1/d)` (**MM** can use a per-layer vibrato) | `1 + depth/4096 · (bendOctave[128 + sine >> 8] − 1)` | as SF64 |
| portamento | u16 `cur += speed` (speed = 0x20000/(time·3) or tempo-based, clamp 1..0x7FFF), index `(cur >> 8)`, stops at 127 | float | not modelled |
| note frequency | `freq × vibrato × portamento × (32000 / samplingFrequency)` | same without rate factor | float step |
| pan (default "stereo" option) | `gDefaultPanVolume[pan]` / `[127 − pan]`; with channel D0 bit 7: `gStereoPanVolume` and phase inversion of the far side for pan < 32 / > 96 (stereo type selects override/or/xor); headset mode: `gHeadsetPanVolume` + Haas delay 0–30 samples; mono 0.707 | pan tables + strong L/R | equal-power table |
| volume | `(vol · volScale · fadeVolume · fadeVolumeScale)²·velocity²`, target `vel·pan·(4096 − 0.001)` | same | float |
| **MM** surround | only in surround sound mode (volume halved, extra delay line mixed with gDefaultPanVolume[index]) | – | – |

#### 8.2.4 Synthesis (per note, per update)

1. Sample stream: VADPCM or SMALL_ADPCM decode with loop (the RSP decodes per frame; decoding the whole sample and
   appending the loop body is equivalent, as in `sf64.ts`); synthetic waves (gWaveSamples 64-sample periods,
   harmonic chosen by frequency; OoT/MM ids 0x80–0xBF) (**MM** loop count 2 ends the loop after note-off; MM
   `startSamplePos`).
2. Frequency ≥ 2: two parts, **every other sample** (`INTERL`) then resampled at freq/2 (SF64 port approximated).
3. RESAMPLE 4-tap (state = last 4 inputs + fraction), HILOGAIN (gain < 0x10 → 0x10).
4. **Channel FILTER** (new): 8-tap FIR `y[n] = Σ c[j]·x[n−j] >> 15` (rounded); rsp-hle averages the coefficient table
   with the previous set in place on every call (so a static table converges to half gain after the first update).
   Coefficients from gLowPassFilterData[lp], gHighPassFilterData[hp − 1] or their average.
5. **Comb filter** (new): `y[n] = x[n − d] + (x[n] · gain) >> 15`.
6. ENVMIXER: dry `(x · vol) >> 16` per side with 8-sample ramps; wet = `(dry · send) >> 16` with
   **send = (reverb & 0x7F) · 2 << 8** (twice SF64's) and bit 7 of the reverb byte swapping wet L/R.
7. Haas delay (headset only), **MM** surround (surround only).

Per reverb (in index order; notes of that reverb are mixed in between the load and save):
- load the delay line (downsample 1: ring position; downsample 2: from the ring through the resampler at 0.5; the
  CPU writes every second wet sample into the ring two tasks later),
- `dry += wet · volume (0x7FFF) >> 15` (SF64 adds wet directly),
- `wet += wet · (decayRatio − 0x8000) >> 15`, optional L/R leak (`aMix` with leakRtl/leakLtr),
- **MM** sub-delay tap and mixing another reverb (unused by the specs: subDelay 0, mix index −1),
- mix the notes' sends, then **low-pass FIR** on the wet signal when the spec sets a cutoff (OoT specs 1–6, 10, 17;
  MM most specs), then save to the ring.

Output: `clamp16(dry)`, 32 kHz stereo (the AI runs at 32006 Hz).

#### 8.2.5 Heap and loading behaviour that affects playback

- All fonts in a sequence's map row are loaded before it starts; C6/EB switch only to loaded fonts.
- Bn (LDSEQ) and 1n/6n loads are asynchronous in the game (the script polls io); a renderer can complete them
  immediately with status 1. OoT's Hyrule Field logic depends on this.
- The game writes player IO before starting a scene sequence: port 7 = resume point or 1 (skip harp intro) or −1;
  port 0 = 1 for the morning variant (`Audio_PlayMorningSceneSequence`); MM port 4 = day − 1; port 2 = enemy/still
  mode (§8.3.3). Sound-mode (stereo/mono/headset/surround) comes from the save file.
- Voices are shared with the SFX player (sequence 0) and ambience players; a music-only render has all notes.
- Game-side volume: `gActiveSeqs[].volScales` (fanfare, SFX ducking 0x40, sub-BGM distance, BGM main) multiply into
  the player's `fadeVolumeScale` (doc `sequence.c`); the amplitude goes with its square. Observed in RAM: 90/127 in
  OoT Market Entrance (−6 dB), 1.0 in the other captured scenes (§8.5).

#### 8.2.6 Extend `sf64.ts` / `nas.ts`, or a new module?

**Recommendation: a new module** `src/rom/music/zelda64.ts`, ported from the research renderer
(`render/zdata.ts` 330 lines + `render/zengine.ts` 1150 + `render/zsynth.ts` 330). Reasons:
- The opcode layout below 0xB0 of `sf64.ts` is incompatible (channel 0n–Bn all mean different things); `nas.ts`
  has the OoT layout but no note pool, priorities, reverb, filters or IO semantics, and uses a float mixer and
  state fingerprint loops.
- Shared helpers worth factoring out of `sf64.ts`: the linked-list note pool, ADSR state machine (with the OoT
  delay rule as an option), ENVMIXER, resampler, ring reverb.

If extending `sf64.ts` were preferred, the concrete changes are: arg-table channel decoding (≥ 0xB0 / MM ≥ 0xA0) and
the new low-opcode layout; 8 IO ports per player/channel with clear-on-read; persistent script values; channel
pre-allocation and reset at start (D7/D6 semantics); seq ops C4 C5 C6 CD CE D1 D2 4n 6n An Bn (+ MM C2 C3); channel
ops A0–A8, B0–BE, D0, E6, E7/E8/E9 nibbles, EC; layer CE CF (+ MM F0 F1); instrument 0x7E sound effects and the
font sfx list; zero-length notes; random variance; OoT decay table and envelope delay rule; released-note priority;
new vibrato and integer portamento; stereo/headset pan tables and strong L/R; SMALL_ADPCM; exact two-part resampling;
FIR filter (channel and reverb) with rsp-hle coefficient averaging; comb filter; doubled reverb send and 0x7FFF
reverb return; spec-dependent reverbs with low-pass, leak and downsample 2; MM tempo clamp, 0n no-op, C5 jump,
unk_0A bits, loop count 2, startSamplePos. **Difficulty: medium** (≈1.5–2× the `sf64.ts` port; the research code is
the reference).

### 8.3 Song list

#### 8.3.1 How the tables were made

`scripts/songlist.py` → `out/songlist_<rom>.tsv` / `.md`, from:
- **enum names** (doc: `include/tables/sequence_table.h`, condensed in `oot_seq_enum.txt` / `mm_seq_enum.txt`),
  including the sequence flags (FANFARE, ENEMY, RESUME, RESUME_PREV, RESTORE, NO_AMBIENCE, SKIP_HARP_INTRO);
- **fonts** from the ROM's seq→font map and **loops** from a full render of each sequence (`render/scanall.ts`,
  spec 0, all IO −1: "loop L s from T s" = loop length and the time of the third execution of the loop jump;
  "ends" = the sequence reaches its end; verified for every id, `out/renderscan_*.json`);
- **scene uses** from every scene header's `SCENE_CMD_SOUND_SETTINGS` (`notes/songlist/scenesound_<rom>.tsv`;
  verified: 11 of 11 scenes spot-checked against the ROM scene files, header/spec shown as `main/spec1`, `alt4/…`);
- **cutscene uses** from a heuristic scan for cutscene START_SEQ commands in scene files (`cutsceneseq_<rom>.tsv`;
  hypothesis-grade, not all cutscenes live in scene files);
- **code uses** from a grep of the decomp for the enum name (doc, `callsites_<game>.tsv`; overlay or file names).
- **Names:** OoT names are the community names used by the OoT Randomizer's `Music.py` (fetched, community-
  derived) where one exists, else the enum name made readable; MM names are the enum names made readable (the
  games have no sound test).
- **kind:** sfx player / ambience / logic / field part / ocarina (font 0 or OCARINA in the name) / fanfare (FANFARE
  flag: played on the fanfare player) / jingle-cutscene (music that ends) / music (loops).

MQ debug and MM debug PAL use the same ids and names; their only different sequences are listed in §8.1.6.

#### 8.3.2 Ocarina of Time (US 1.0; MQ debug identical except 0, 42, 109)

| id | enum (NA_BGM_) | name | kind | fonts | loop / length | uses |
|---|---|---|---|---|---|---|
| 0 | GENERAL_SFX | General Sfx | sfx player | [1, 0] |  | scenes: GERUDOS_FORTRESS (alt4/spec1); LINKS_HOUSE (alt5/spec5); LON_LON_RANCH (alt4/spec2) | code: En_Syateki_Man, En_Zl1, file_choose, general, sfx, z_common_data, z_kankyo |
| 1 | NATURE_AMBIENCE | Nature Ambience | ambience | [2] | ends 1.033 s | scenes: CHAMBER_OF_THE_SAGES (alt6/spec4); DESERT_COLOSSUS (alt5/spec8); GANONS_TOWER_COLLAPSE_EXTERIOR (main/spec6); GANONS_TOWER_COLLAPSE_INTERIOR (main/spec6); INSIDE_GANONS_CASTLE_COLLAPSE (main/spec6) | code: En_Okarina_Effect, En_Syateki_Man, debug.inc, general, z_kankyo |
| 2 | FIELD_LOGIC | Hyrule Field | logic | [3] | no loop within 420 s (IO/random driven or silent) | scenes: DEATH_MOUNTAIN_TRAIL (main/spec2, alt2/spec2); HYRULE_CASTLE (main/spec2); HYRULE_FIELD (main/spec2, alt1/spec2, alt2/spec2, alt12/spec2); LAKE_HYLIA (main/spec2, alt2/spec2, alt4/spec2); OUTSIDE_GANONS_CASTLE (alt4/spec2); ZORAS_FOUNTAIN (main/spec0, alt1/spec0, alt2/spec0, alt4/spec1, alt5/spec1, alt6/spec1); ZORAS_RIVER (main/spec2, alt2/spec2) | code: En_Syateki_Man, general |
| 3 | FIELD_INIT | Field Init | field part | [3] | ends 14.383 s |  |
| 4 | FIELD_DEFAULT_1 | Field Default 1 | field part | [3] | ends 14 s |  |
| 5 | FIELD_DEFAULT_2 | Field Default 2 | field part | [3] | ends 14.467 s |  |
| 6 | FIELD_DEFAULT_3 | Field Default 3 | field part | [3] | ends 14.05 s |  |
| 7 | FIELD_DEFAULT_4 | Field Default 4 | field part | [3] | ends 14.1 s |  |
| 8 | FIELD_DEFAULT_5 | Field Default 5 | field part | [3] | ends 13.95 s |  |
| 9 | FIELD_DEFAULT_6 | Field Default 6 | field part | [3] | ends 14.067 s |  |
| 10 | FIELD_DEFAULT_7 | Field Default 7 | field part | [3] | ends 14.017 s |  |
| 11 | FIELD_DEFAULT_8 | Field Default 8 | field part | [3] | ends 14.033 s |  |
| 12 | FIELD_DEFAULT_9 | Field Default 9 | field part | [3] | ends 14 s |  |
| 13 | FIELD_DEFAULT_A | Field Default A | field part | [3] | ends 13.917 s |  |
| 14 | FIELD_DEFAULT_B | Field Default B | field part | [3] | ends 13.983 s |  |
| 15 | FIELD_ENEMY_INIT | Field Enemy Init | field part | [3] | ends 13.867 s |  |
| 16 | FIELD_ENEMY_1 | Field Enemy 1 | field part | [3] | ends 13.95 s |  |
| 17 | FIELD_ENEMY_2 | Field Enemy 2 | field part | [3] | ends 13.967 s |  |
| 18 | FIELD_ENEMY_3 | Field Enemy 3 | field part | [3] | ends 14.233 s |  |
| 19 | FIELD_ENEMY_4 | Field Enemy 4 | field part | [3] | ends 14.233 s |  |
| 20 | FIELD_STILL_1 | Field Still 1 | field part | [3] | ends 15.5 s |  |
| 21 | FIELD_STILL_2 | Field Still 2 | field part | [3] | ends 15.65 s |  |
| 22 | FIELD_STILL_3 | Field Still 3 | field part | [3] | ends 15.583 s |  |
| 23 | FIELD_STILL_4 | Field Still 4 | field part | [3] | ends 15.55 s |  |
| 24 | DUNGEON | Dodongo's Cavern | music | [11] | loop 89.75 s from 179.5 s | scenes: DEATH_MOUNTAIN_CRATER (main/spec4, alt2/spec4, alt4/spec4, alt5/spec4); DODONGOS_CAVERN (main/spec4); DODONGOS_CAVERN_BOSS (main/spec4); GERUDO_TRAINING_GROUND (main/spec3); GRAVEYARD (alt5/spec0); GRAVE_WITH_FAIRYS_FOUNTAIN (main/spec3); KAKARIKO_VILLAGE (alt7/spec1); REDEAD_GRAVE (main/spec3); ROYAL_FAMILYS_TOMB (main/spec3, alt4/spec3, alt5/spec3); THIEVES_HIDEOUT (main/spec3); WINDMILL_AND_DAMPES_GRAVE (main/spec3) | cutscenes: DEATH_MOUNTAIN_CRATER | code: En_Syateki_Man |
| 25 | KAKARIKO_ADULT | Kakariko Village (adult) | music | [3] | loop 89.2 s from 181.733 s | scenes: KAKARIKO_VILLAGE (alt2/spec1, alt3/spec1) | code: En_Syateki_Man, Fishing |
| 26 | ENEMY | Battle | music | [3] | loop 52.65 s from 110.1 s | code: En_Dnt_Demo, En_Dnt_Jiji, En_Syateki_Man, Fishing, general |
| 27 | BOSS | Boss Battle | music | [3] | loop 65.817 s from 137.367 s | code: Boss_Goma, Boss_Mo, Boss_Sst, Boss_Tw, Boss_Va, En_Syateki_Man, En_fHG |
| 28 | INSIDE_DEKU_TREE | Inside the Deku Tree | music | [4] | loop 67.017 s from 143.6 s | scenes: DEKU_TREE (main/spec3); DEKU_TREE_BOSS (main/spec4); GRAVEKEEPERS_HUT (main/spec5); GROTTOS (main/spec4); HOUSE_OF_SKULLTULA (main/spec5) | code: En_Syateki_Man |
| 29 | MARKET | Market | music | [5] | loop 39.35 s from 79.5 s | scenes: BACK_ALLEY_DAY (main/spec0); MARKET_DAY (main/spec1); MARKET_ENTRANCE_DAY (main/spec0) | code: En_Syateki_Man |
| 30 | TITLE | Title Theme | music | [6] | loop 66.817 s from 144.483 s | scenes: CUTMAP (alt8/spec0); HYRULE_FIELD (alt7/spec10) | code: En_Syateki_Man |
| 31 | LINK_HOUSE | House | music | [3] | loop 26.05 s from 53.567 s | scenes: BACK_ALLEY_HOUSE (main/spec5); CARPENTERS_TENT (main/spec5); DOG_LADY_HOUSE (main/spec5); IMPAS_HOUSE (main/spec5); KAKARIKO_CENTER_GUEST_HOUSE (main/spec5); KNOW_IT_ALL_BROS_HOUSE (main/spec5); LINKS_HOUSE (main/spec5, alt4/spec5); LON_LON_BUILDINGS (main/spec5); MARKET_GUARD_HOUSE (main/spec5); MIDOS_HOUSE (main/spec5); POTION_SHOP_KAKARIKO (main/spec5); SARIAS_HOUSE (main/spec5); SHOOTING_GALLERY (alt4/spec5, alt5/spec5, alt6/spec5); STABLE (main/spec5); TWINS_HOUSE (main/spec5) | code: En_Syateki_Man |
| 32 | GAME_OVER | Game Over | jingle/cutscene | [35] | ends 10.733 s | code: En_Syateki_Man, player_actor |
| 33 | BOSS_CLEAR | Boss Defeated | jingle/cutscene | [3] | ends 12.667 s | code: Boss_Dodongo, Boss_Fd, Boss_Ganondrof, Boss_Goma, Boss_Mo, Boss_Sst, Boss_Tw, Boss_Va … |
| 34 | ITEM_GET | Item Get | fanfare | [35] | ends 4.033 s | cutscenes: JABU_JABU | code: En_Hy, En_Ru1, En_Syateki_Man, En_Yabusame_Mark, Fishing, player_actor |
| 35 | OPENING_GANON | Ganondorf Appears | fanfare | [3] | ends 16.983 s | scenes: CUTMAP (alt7/spec0, alt12/spec0) | cutscenes: HYRULE_FIELD | code: Boss_Ganon2, En_Syateki_Man, En_Viewer, En_fHG |
| 36 | HEART_GET | Heart Container Get | fanfare | [35] | ends 4.983 s | cutscenes: GREAT_FAIRYS_FOUNTAIN_MAGIC, GREAT_FAIRYS_FOUNTAIN_SPELLS, TEMPLE_OF_TIME | code: En_Syateki_Man, Fishing, player_actor |
| 37 | OCA_LIGHT | Oca Light | ocarina | [18] | ends 18.333 s | cutscenes: TEMPLE_OF_TIME | code: En_Syateki_Man, z_message |
| 38 | JABU_JABU | Jabu-Jabu | music | [7] | loop 50.4 s from 100.767 s | scenes: JABU_JABU (main/spec3, alt4/spec3); JABU_JABU_BOSS (main/spec3) | code: En_Syateki_Man |
| 39 | KAKARIKO_KID | Kakariko Village (child) | music | [8] | loop 91.417 s from 186.333 s | scenes: KAKARIKO_VILLAGE (main/spec1, alt1/spec1) | code: En_Syateki_Man, Fishing |
| 40 | GREAT_FAIRY | Fairy Fountain | music | [9] | loop 24.55 s from 52.033 s | scenes: FAIRYS_FOUNTAIN (main/spec9); GREAT_FAIRYS_FOUNTAIN_MAGIC (main/spec9, alt4/spec3, alt5/spec3, alt6/spec3); GREAT_FAIRYS_FOUNTAIN_SPELLS (main/spec9) | code: En_River_Sound, En_Syateki_Man, general |
| 41 | ZELDA_THEME | Zelda's Theme | music | [9] | loop 41.167 s from 82.35 s | scenes: CASTLE_COURTYARD_ZELDA (main/spec0, alt5/spec0, alt6/spec0) | code: En_Syateki_Man, En_Zl1 |
| 42 | FIRE_TEMPLE | Fire Temple | music | [10] | loop 93.2 s from 190.617 s | scenes: FIRE_TEMPLE (main/spec4); FIRE_TEMPLE_BOSS (main/spec4) | code: En_Syateki_Man |
| 43 | OPEN_TRE_BOX | Treasure Chest | fanfare | [3] | ends 9.633 s | code: En_Box, En_Syateki_Man |
| 44 | FOREST_TEMPLE | Forest Temple | music | [12] | loop 96.75 s from 198.6 s | scenes: FOREST_TEMPLE (main/spec6); FOREST_TEMPLE_BOSS (main/spec6) | code: En_Syateki_Man |
| 45 | COURTYARD | Castle Courtyard | music | [3] | loop 22.983 s from 45.95 s | scenes: CASTLE_COURTYARD_GUARDS_DAY (main/spec0); CASTLE_COURTYARD_GUARDS_NIGHT (main/spec0) | code: En_Dnt_Demo, En_Syateki_Man |
| 46 | GANON_TOWER | Ganondorf's Theme | music | [30] | no loop within 420 s (IO/random driven or silent) | scenes: GANONDORF_BOSS (main/spec6); GANONS_TOWER (main/spec6) | code: En_River_Sound, En_Syateki_Man, general |
| 47 | LONLON | Lon Lon Ranch | music | [13] | loop 118.267 s from 244.967 s | scenes: LON_LON_RANCH (main/spec2, alt1/spec2, alt2/spec2, alt3/spec2) | code: En_Ma1, En_Ma2, En_Ma3, En_Syateki_Man, general |
| 48 | GORON_CITY | Goron City | music | [14] | loop 66.6 s from 150.1 s | scenes: GORON_CITY (main/spec3, alt2/spec3) | cutscenes: DEATH_MOUNTAIN_TRAIL, GORON_CITY | code: En_Syateki_Man |
| 49 | FIELD_MORNING | Field Morning | jingle/cutscene | [3] | ends 31.283 s | code: general |
| 50 | SPIRITUAL_STONE | Spiritual Stone Get | fanfare | [3] | ends 15.383 s | cutscenes: DEATH_MOUNTAIN_TRAIL, KOKIRI_FOREST, ZORAS_FOUNTAIN | code: En_Syateki_Man |
| 51 | OCA_BOLERO | Oca Bolero | ocarina | [18] | ends 19.75 s | cutscenes: DEATH_MOUNTAIN_CRATER | code: En_Syateki_Man, z_message |
| 52 | OCA_MINUET | Oca Minuet | ocarina | [18] | ends 17.4 s | cutscenes: SACRED_FOREST_MEADOW | code: En_Syateki_Man, z_message |
| 53 | OCA_SERENADE | Oca Serenade | ocarina | [18] | ends 18.1 s | cutscenes: ICE_CAVERN | code: En_Syateki_Man, z_message |
| 54 | OCA_REQUIEM | Oca Requiem | ocarina | [18] | ends 25.933 s | cutscenes: DESERT_COLOSSUS | code: En_Syateki_Man, z_message |
| 55 | OCA_NOCTURNE | Oca Nocturne | ocarina | [18] | ends 24.083 s | cutscenes: KAKARIKO_VILLAGE | code: En_Syateki_Man, z_message |
| 56 | MINI_BOSS | Miniboss Battle | music | [3] | loop 57.433 s from 117.283 s | cutscenes: SPIRIT_TEMPLE_BOSS | code: En_Bigokuta, En_Dh, En_Fd, En_GeldB, En_Ik, En_Po_Sisters, En_Syateki_Man, En_Test … |
| 57 | SMALL_ITEM_GET | Heart Piece Get | fanfare | [35] | ends 4.033 s | code: En_Diving_Game, En_Si, En_Syateki_Man, En_Ta, player_actor |
| 58 | TEMPLE_OF_TIME | Temple of Time | music | [9] | loop 71.267 s from 144.917 s | scenes: TEMPLE_OF_TIME (main/spec6, alt7/spec6, alt8/spec6, alt9/spec6, alt10/spec6, alt11/spec6, alt12/spec6) | cutscenes: TEMPLE_OF_TIME | code: En_Syateki_Man |
| 59 | EVENT_CLEAR | Escape from Ranch | fanfare | [3] | ends 9.033 s | cutscenes: HYRULE_FIELD | code: En_Syateki_Man |
| 60 | KOKIRI | Kokiri Forest | music | [15] | loop 42.917 s from 94.083 s | scenes: KOKIRI_FOREST (main/spec1, alt2/spec1, alt3/spec1, alt13/spec1) | cutscenes: KOKIRI_FOREST | code: Bg_Treemouth, En_Syateki_Man |
| 61 | OCA_FAIRY_GET | Learn Song | ocarina | [9] | ends 10.067 s | cutscenes: CASTLE_COURTYARD_ZELDA, LON_LON_RANCH, LOST_WOODS, ROYAL_FAMILYS_TOMB, SACRED_FOREST_MEADOW, TEMPLE_OF_TIME, WINDMILL_AND_DAMPES_GRAVE | code: En_Syateki_Man |
| 62 | SARIA_THEME | Lost Woods | music | [5] | loop 30.783 s from 63.25 s | scenes: LOST_WOODS (main/spec9, alt2/spec9); SACRED_FOREST_MEADOW (main/spec9, alt2/spec9) | cutscenes: GORON_CITY, SACRED_FOREST_MEADOW | code: En_Dnt_Demo, En_River_Sound, En_Syateki_Man |
| 63 | SPIRIT_TEMPLE | Spirit Temple | music | [16] | loop 104.917 s from 268.017 s | scenes: SPIRIT_TEMPLE (main/spec3); SPIRIT_TEMPLE_BOSS (main/spec4, alt4/spec4, alt5/spec4, alt6/spec4) | cutscenes: SPIRIT_TEMPLE_BOSS | code: En_Syateki_Man |
| 64 | HORSE | Horse Race | music | [17] | loop 37.05 s from 77.85 s | cutscenes: GERUDOS_FORTRESS, LON_LON_RANCH | code: En_In, En_Syateki_Man |
| 65 | HORSE_GOAL | Epona Race Goal | jingle/cutscene | [17] | ends 4.517 s | code: En_Horse, En_Horse_Game_Check, En_Syateki_Man |
| 66 | INGO | Ingo's Theme | music | [17] | loop 47.867 s from 101.717 s | code: En_Horse_Game_Check, En_Syateki_Man |
| 67 | MEDALLION_GET | Medallion Get | fanfare | [3] | ends 12.917 s | cutscenes: CHAMBER_OF_THE_SAGES | code: Demo_Du, Demo_Im, Demo_Sa, En_Nb, En_Ru2, En_Syateki_Man |
| 68 | OCA_SARIA | Oca Saria | ocarina | [0] | ends 6.35 s | code: En_Syateki_Man, z_message |
| 69 | OCA_EPONA | Oca Epona | ocarina | [0] | ends 7.883 s | code: En_Syateki_Man, z_message |
| 70 | OCA_ZELDA | Oca Zelda | ocarina | [0] | ends 10.05 s | code: En_Syateki_Man, z_message |
| 71 | OCA_SUNS | Oca Suns | ocarina | [0] | ends 6.917 s | code: En_Syateki_Man, z_message |
| 72 | OCA_TIME | Oca Time | ocarina | [0] | ends 10.5 s | code: En_Syateki_Man, z_message |
| 73 | OCA_STORM | Oca Storm | ocarina | [0] | ends 5.567 s | code: En_Syateki_Man, z_message |
| 74 | NAVI_OPENING | Fairy Flying | music | [3] | loop 12.517 s from 28.683 s | cutscenes: DEATH_MOUNTAIN_TRAIL, KOKIRI_FOREST, LAKE_HYLIA | code: En_Syateki_Man |
| 75 | DEKU_TREE_CS | Deku Tree | music | [9] | loop 25.867 s from 51.75 s | scenes: KOKIRI_FOREST (alt5/spec1, alt6/spec1, alt7/spec1) | cutscenes: KOKIRI_FOREST | code: Bg_Treemouth, En_Syateki_Man |
| 76 | WINDMILL | Windmill Hut | music | [8] | loop 39.5 s from 82.567 s | code: En_Syateki_Man, general |
| 77 | HYRULE_CS | Hyrule Cs | jingle/cutscene | [19] | ends 117.383 s | scenes: CUTMAP (alt4/spec0, alt6/spec0, alt11/spec0); DEATH_MOUNTAIN_TRAIL (alt4/spec2); GERUDO_VALLEY (alt4/spec1, alt5/spec1); KOKIRI_FOREST (alt4/spec1) | cutscenes: CUTMAP | code: En_Syateki_Man, En_Zl1 |
| 78 | MINI_GAME | Shooting Gallery | music | [20] | loop 28.717 s from 60.733 s | scenes: BOMBCHU_BOWLING_ALLEY (main/spec5); FISHING_POND (main/spec0); SHOOTING_GALLERY (main/spec5); TREASURE_BOX_SHOP (main/spec3) | code: En_Syateki_Man |
| 79 | SHEIK | Sheik's Theme | music | [9] | loop 24.567 s from 49.15 s | scenes: TEMPLE_OF_TIME (alt13/spec6) | cutscenes: DEATH_MOUNTAIN_CRATER, DESERT_COLOSSUS, ICE_CAVERN, KAKARIKO_VILLAGE, LAKE_HYLIA, SACRED_FOREST_MEADOW, TEMPLE_OF_TIME | code: En_Syateki_Man |
| 80 | ZORA_DOMAIN | Zora's Domain | music | [21] | loop 71.8 s from 153.883 s | scenes: ZORAS_DOMAIN (main/spec4, alt2/spec4) | code: En_Syateki_Man |
| 81 | APPEAR | Zelda Turns Around | fanfare | [3] | ends 5.4 s | code: En_Daiku, En_Du, En_Go2, En_Ru1, En_Ru2, En_Syateki_Man, En_Zl1, En_Zl4 |
| 82 | ADULT_LINK | Adult Link | music | [3] | loop 41.167 s from 82.35 s | scenes: HYRULE_FIELD (alt11/spec2); TEMPLE_OF_TIME (alt14/spec6) | cutscenes: TEMPLE_OF_TIME | code: En_Syateki_Man |
| 83 | MASTER_SWORD | Master Sword | jingle/cutscene | [3] | ends 13.25 s | code: Bg_Toki_Swd, En_Syateki_Man |
| 84 | INTRO_GANON | Intro Ganon | fanfare | [3] | loop 31.283 s from 62.55 s | cutscenes: CUTMAP, HYRULE_FIELD, TEMPLE_OF_TIME | code: En_Syateki_Man |
| 85 | SHOP | Shop | music | [22] | loop 54.717 s from 114.533 s | scenes: BAZAAR (main/spec5); BOMBCHU_SHOP (main/spec5); GORON_SHOP (main/spec5); HAPPY_MASK_SHOP (main/spec5); KOKIRI_SHOP (main/spec5); POTION_SHOP_MARKET (main/spec5); ZORA_SHOP (main/spec5) | code: En_Dnt_Demo, En_Syateki_Man |
| 86 | CHAMBER_OF_SAGES | Chamber of the Sages | music | [19] | loop 55.85 s from 147.583 s | scenes: CHAMBER_OF_THE_SAGES (main/spec4, alt4/spec4, alt5/spec4) | cutscenes: CUTMAP | code: En_Syateki_Man, general |
| 87 → 40 | FILE_SELECT | File Select | music | [9] | loops (static) | code: En_Syateki_Man, file_choose, general |
| 88 | ICE_CAVERN | Ice Cavern | music | [23] | loop 32.35 s from 67.917 s | scenes: ICE_CAVERN (main/spec5, alt4/spec3) | cutscenes: ICE_CAVERN | code: En_Syateki_Man |
| 89 | DOOR_OF_TIME | Door of Time | fanfare | [18] | ends 14.633 s | code: En_Okarina_Tag, En_Syateki_Man |
| 90 | OWL | Kaepora Gaebora | fanfare | [36] | loop 49.417 s from 101.933 s | code: En_Owl, En_Syateki_Man |
| 91 | SHADOW_TEMPLE | Shadow Temple | music | [24] | loop 73.633 s from 165.7 s | scenes: BOTTOM_OF_THE_WELL (main/spec3); SHADOW_TEMPLE (main/spec3); SHADOW_TEMPLE_BOSS (main/spec4) | code: En_Syateki_Man |
| 92 | WATER_TEMPLE | Water Temple | music | [25] | loop 143.05 s from 297.1 s | scenes: WATER_TEMPLE (main/spec4); WATER_TEMPLE_BOSS (main/spec4) | code: En_Syateki_Man |
| 93 | BRIDGE_TO_GANONS | Ganon's Rainbow Bridge | fanfare | [19] | ends 21.467 s | cutscenes: OUTSIDE_GANONS_CASTLE | code: En_Syateki_Man |
| 94 | SEAL_OF_SAGES | Seal of Sages | jingle/cutscene | [32] | ends 29.017 s | cutscenes: CHAMBER_OF_THE_SAGES | code: En_Syateki_Man |
| 95 | GERUDO_VALLEY | Gerudo Valley | music | [27] | loop 71.8 s from 157.567 s | scenes: DESERT_COLOSSUS (main/spec8, alt2/spec8); GERUDOS_FORTRESS (main/spec1, alt2/spec1, alt3/spec1, alt6/spec1); GERUDO_VALLEY (main/spec1, alt2/spec1); HAUNTED_WASTELAND (main/spec8) | code: En_Syateki_Man |
| 96 | POTION_SHOP | Potion Shop | music | [28] | loop 40.75 s from 84.017 s | scenes: LAKESIDE_LABORATORY (main/spec5); MARKET_GUARD_HOUSE (alt2/spec5); POTION_SHOP_GRANNY (main/spec5) | code: En_Syateki_Man |
| 97 | KOTAKE_KOUME | Kotake and Koume | music | [29] | loop 34.817 s from 82.133 s | cutscenes: SPIRIT_TEMPLE_BOSS | code: Boss_Tw, En_Syateki_Man |
| 98 | ESCAPE | Castle Escape | music | [3] | loop 22.983 s from 71.383 s | code: En_Syateki_Man, En_Zl3, general |
| 99 | UNDERGROUND | Castle Underground | music | [31] | loop 76.583 s from 155.567 s | scenes: INSIDE_GANONS_CASTLE (main/spec3) | code: En_Syateki_Man |
| 100 | GANONDORF_BOSS | Ganondorf Battle | music | [32] | loop 62.783 s from 129.55 s | code: Boss_Ganon, En_Syateki_Man |
| 101 | GANON_BOSS | Ganon Battle | music | [32] | loop 58.217 s from 152.283 s | code: Boss_Ganon2, En_Syateki_Man |
| 102 | OCARINA_OF_TIME | Ocarina of Time | ocarina | [9] | ends 31.367 s | cutscenes: HYRULE_FIELD | code: En_Syateki_Man |
| 103 | STAFF_1 | Staff 1 | jingle/cutscene | [33] | ends 157.75 s | scenes: DEATH_MOUNTAIN_TRAIL (alt7/spec2); GERUDOS_FORTRESS (alt5/spec1); GERUDO_VALLEY (alt6/spec1); GORON_CITY (alt5/spec3); HYRULE_FIELD (alt9/spec2); KAKARIKO_VILLAGE (alt8/spec1); KOKIRI_FOREST (alt10/spec1, alt11/spec1); LAKE_HYLIA (alt5/spec2); ZORAS_DOMAIN (alt4/spec4) |
| 104 | STAFF_2 | Staff 2 | jingle/cutscene | [34] | ends 148.317 s | scenes: DEATH_MOUNTAIN_TRAIL (alt8/spec2); LON_LON_RANCH (alt6/spec2, alt7/spec2, alt8/spec2, alt9/spec2, alt10/spec2, alt11/spec2) |
| 105 | STAFF_3 | Staff 3 | jingle/cutscene | [33] | ends 68.833 s | scenes: TEMPLE_OF_TIME (alt5/spec6) |
| 106 | STAFF_4 | Staff 4 | jingle/cutscene | [9] | ends 50.9 s | scenes: CASTLE_COURTYARD_ZELDA (alt4/spec0) |
| 107 | FIRE_BOSS | Fire Boss | music | [32] | loop 52.15 s from 115.133 s | code: Boss_Dodongo, Boss_Fd |
| 108 | TIMED_MINI_GAME | Mini-game | music | [3] | loop 23.283 s from 49.167 s | code: En_Diving_Game, En_Ta, general |
| 109 | CUTSCENE_EFFECTS | Cutscene Effects | sfx player | [1, 0] | ends 1.05 s | code: En_Syateki_Man, general |

Water Temple (92) loops after 154 s (143.05 s loop) in a 1100 s render with spec 4 (`out/renderscan_oot-us10_extra.json`).

#### 8.3.3 Majora's Mask (US; debug PAL identical except 0 and 43)

| id | enum (NA_BGM_) | name | kind | fonts | loop / length | uses |
|---|---|---|---|---|---|---|
| 0 | GENERAL_SFX | General Sfx | sfx player | [1, 0] |  | scenes: 00KEIKOKU (alt1/spec1, alt3/spec1, alt6/spec1, alt7/spec12, alt8/spec12, alt9/spec12); 10YUKIYAMANOMURA2 (alt1/spec1); 11GORONNOSATO2 (alt1/spec1); 30GYOSON (alt2/spec1); 8ITEMSHOP (main/spec5); BANDROOM (main/spec3); BOMYA (main/spec5); BOWLING (main/spec5); CLOCKTOWER (alt2/spec0); DEKU_KING (alt1/spec3); F01 (alt2/spec2); F01C (alt1/spec1); GORONSHOP (main/spec5); ICHIBA (alt1/spec0); IKANA (alt2/spec1, alt4/spec1); IKNINSIDE (alt1/spec3); INISIE_BS (main/spec2); KAIZOKU (alt1/spec2); KONPEKI_ENT (main/spec1); KYOJINNOMA (alt4/spec0, alt5/spec0, alt6/spec0, alt7/spec0, alt8/spec0, alt9/spec0, alt10/spec0); LOST_WOODS (alt2/spec0, alt3/spec0); MAP_SHOP (main/spec5); MILK_BAR (main/spec5, alt1/spec5, alt2/spec5, alt3/spec12, alt4/spec12); OKUJOU (main/spec2, alt1/spec2, alt2/spec2); OPENINGDAN (alt1/spec3); SECOM (main/spec5); SPOT00 (main/spec0, alt1/spec0, alt2/spec0, alt4/spec0, alt6/spec0, alt7/spec0, alt8/spec0, alt9/spec7, alt10/spec0, alt11/spec7); SYATEKI_MIZU (main/spec5); SYATEKI_MORI (main/spec5); TAKARAKUJI (main/spec5); TAKARAYA (main/spec5); YOUSEI_IZUMI (alt1/spec3) | code: Obj_Sound, code_8019AF00, sfx, z_common_data, z_kankyo |
| 1 | AMBIENCE | Ambience | ambience | [2] | ends 1.033 s | scenes: 00KEIKOKU (alt5/spec1) | code: code_8019AF00 |
| 2 | TERMINA_FIELD | Termina Field | music | [3] | loop 66.017 s from 132.183 s | scenes: 00KEIKOKU (main/spec1, alt2/spec1, alt4/spec1); 10YUKIYAMANOMURA2 (main/spec1); 11GORONNOSATO2 (main/spec1); 12HAKUGINMAE (alt1/spec1); 13HUBUKINOMITI (main/spec1, alt1/spec1); 14YUKIDAMANOMITI (alt1/spec1); 17SETUGEN2 (main/spec1); 20SICHITAI2 (main/spec1); 21MITURINMAE (alt2/spec1); 24KEMONOMITI (main/spec1); 30GYOSON (alt1/spec1); 31MISAKI (alt1/spec1); IKANA (alt3/spec1); IKANAMAE (main/spec1); ROMANYMAE (main/spec1) | code: code_8019AF00 |
| 3 | CHASE | Chase | music | [3] | loop 26.317 s from 55.45 s | cutscenes: LOST_WOODS | code: En_Bsb, En_Suttari, Obj_Um |
| 4 | MAJORAS_THEME | Majoras Theme | music | [17] | loop 65.817 s from 131.633 s | cutscenes: LOST_WOODS, OKUJOU, OPENINGDAN, SPOT00 |
| 5 | CLOCK_TOWER | Clock Tower | music | [23] | loop 76.167 s from 156.967 s | scenes: INSIDETOWER (main/spec5) | cutscenes: INSIDETOWER |
| 6 | STONE_TOWER_TEMPLE | Stone Tower Temple | music | [25] | loop 76.583 s from 157.967 s | scenes: F40 (main/spec2); INISIE_N (main/spec2) |
| 7 | INV_STONE_TOWER_TEMPLE | Inv Stone Tower Temple | music | [25] | loop 76.583 s from 157.967 s | scenes: F41 (main/spec2); INISIE_R (main/spec2) |
| 8 | FAILURE_0 | Failure 0 | fanfare | [3] | ends 5.917 s |  |
| 9 | FAILURE_1 | Failure 1 | fanfare | [3] | ends 9.017 s | code: En_Ma_Yto |
| 10 | HAPPY_MASK_SALESMAN | Happy Mask Salesman | music | [27] | loop 45.583 s from 91.183 s | cutscenes: INSIDETOWER |
| 11 | SONG_OF_HEALING | Song of Healing | music | [23] | loop 63.15 s from 130.05 s | scenes: SPOT00 (alt5/spec0) | cutscenes: MUSICHOUSE, SPOT00 |
| 12 | SWAMP_REGION | Swamp Region | music | [28] | loop 78.533 s from 163.05 s | scenes: 20SICHITAI (main/spec1); 21MITURINMAE (main/spec1) |
| 13 | ALIEN_INVASION | Alien Invasion | music | [22] | loop 23.933 s from 49.867 s | scenes: F01 (alt6/spec2) | code: En_Invadepoh |
| 14 | SWAMP_CRUISE | Swamp Cruise | fanfare | [5] | loop 50.033 s from 106.617 s |  |
| 15 | SHARPS_CURSE | Sharps Curse | music | [3] | loop 31.917 s from 63.817 s | code: En_Po_Composer |
| 16 | GREAT_BAY_REGION | Great Bay Region | music | [29] | loop 78.533 s from 163.05 s | scenes: 30GYOSON (main/spec1); 31MISAKI (main/spec1); SINKAI (main/spec0) |
| 17 | IKANA_REGION | Ikana Region | music | [30] | loop 83.767 s from 183.483 s | scenes: IKANA (main/spec1, alt1/spec1) |
| 18 | DEKU_PALACE | Deku Palace | music | [25] | loop 64.117 s from 132.483 s | scenes: 22DEKUCITY (main/spec1); DEKU_KING (main/spec1) |
| 19 | MOUNTAIN_REGION | Mountain Region | music | [21] | loop 78.533 s from 169.033 s | scenes: 10YUKIYAMANOMURA (main/spec1); 11GORONNOSATO (main/spec1); 12HAKUGINMAE (main/spec1); 14YUKIDAMANOMITI (main/spec1); 17SETUGEN (main/spec1) |
| 20 | PIRATES_FORTRESS | Pirates Fortress | music | [3] | loop 63.817 s from 137.617 s | scenes: KAIZOKU (main/spec2); PIRATE (main/spec5); TORIDE (main/spec2) |
| 21 | CLOCK_TOWN_DAY_1 | Clock Town Day 1 | music | [25] | loop 52.217 s from 108.783 s |  |
| 22 | CLOCK_TOWN_DAY_2 | Clock Town Day 2 | music | [25] | loop 45.95 s from 95.733 s |  |
| 23 | CLOCK_TOWN_DAY_3 | Clock Town Day 3 | music | [25] | loop 31.917 s from 67.017 s |  |
| 24 | FILE_SELECT | File Select | music | [6] | loop 24.55 s from 52.033 s | code: code_8019AF00, file_choose |
| 25 | CLEAR_EVENT | Clear Event | jingle/cutscene | [3] | ends 9.033 s | code: En_Fishing, En_Invadepoh, Obj_Um |
| 26 | ENEMY | Enemy | music | [3] | loop 24.083 s from 81.283 s | code: En_Fishing, Obj_Nozoki, code_8019AF00 |
| 27 | BOSS | Boss | music | [3] | loop 65.133 s from 141.483 s | code: Boss_01, Boss_02, Boss_03, Boss_Hakugin |
| 28 | WOODFALL_TEMPLE | Woodfall Temple | music | [20] | loop 67.817 s from 147.583 s | scenes: LAST_DEKU (main/spec4); MITURIN (main/spec3); MITURIN_BS (main/spec4) |
| 29 | CLOCK_TOWN_MAIN_SEQUENCE | Clock Town Main Sequence | logic | [3] | loop 52.217 s from 108.8 s | scenes: ALLEY (main/spec0); BACKTOWN (main/spec0, alt1/spec0); CLOCKTOWER (main/spec1); ICHIBA (main/spec0); TOWN (main/spec1) |
| 30 | OPENING | Opening | jingle/cutscene | [17] | ends 70.8 s | scenes: LOST_WOODS (main/spec0, alt1/spec0) |
| 31 | INSIDE_A_HOUSE | Inside A House | music | [3] | loop 26.05 s from 53.567 s | scenes: FISHERMAN (main/spec5); OMOYA (main/spec5); POSTHOUSE (main/spec5); SONCHONOIE (main/spec5); YADOYA (main/spec5) | code: En_Pamera |
| 32 | GAME_OVER | Game Over | fanfare | [15] | ends 9.583 s | code: player_actor, z_game_over |
| 33 | CLEAR_BOSS | Clear Boss | jingle/cutscene | [3] | ends 12.667 s | code: Boss_01, Boss_02, Boss_03, Boss_Hakugin |
| 34 | GET_ITEM | Get Item | fanfare | [15] | ends 4.033 s | cutscenes: MUSICHOUSE, YOUSEI_IZUMI | code: En_Bomjimb, En_Elforg, En_Fishing, En_Fu, En_Mm3, En_Si, En_Stone_heishi, En_Syateki_Dekunuts … |
| 35 → 22 | CLOCK_TOWN_DAY_2_PTR | Clock Town Day 2 Ptr | fanfare | [25] | loops (static) |  |
| 36 | GET_HEART | Get Heart | fanfare | [15] | ends 4.983 s | cutscenes: YOUSEI_IZUMI | code: En_Fishing, player_actor |
| 37 | TIMED_MINI_GAME | Timed Mini Game | music | [3] | loop 23.283 s from 49.167 s | code: En_Az, En_Fu, En_Jgame_Tsn, En_Lift_Nuts, En_Syateki_Man, En_Takaraya, code_8019AF00 |
| 38 | GORON_RACE | Goron Race | music | [38] | loop 37.05 s from 77.85 s | code: En_Mt_tag |
| 39 | MUSIC_BOX_HOUSE | Music Box House | music | [5] | loop 47.867 s from 95.783 s | cutscenes: IKANA | code: En_Fishing, En_Pamera, z_actor |
| 40 → 24 | FAIRY_FOUNTAIN | Fairy Fountain | music | [6] | loops (static) | scenes: YOUSEI_IZUMI (main/spec3) | code: code_8019AF00 |
| 41 | ZELDAS_LULLABY | Zeldas Lullaby | music | [6] | loop 41.167 s from 82.35 s | scenes: SPOT00 (alt3/spec0) |
| 42 | ROSA_SISTERS | Rosa Sisters | music | [31] | loop 27.367 s from 58.167 s | cutscenes: ICHIBA | code: En_Rz |
| 43 | OPEN_CHEST | Open Chest | fanfare | [3] | ends 9.633 s | code: En_Box |
| 44 | MARINE_RESEARCH_LAB | Marine Research Lab | music | [13] | loop 40.75 s from 84.017 s | scenes: AYASHIISHOP (main/spec5); LABO (main/spec5); TOUGITES (main/spec5) |
| 45 | GIANTS_THEME | Giants Theme | music | [18] | loop 43.5 s from 89.033 s | scenes: KYOJINNOMA (main/spec6, alt1/spec4, alt2/spec6, alt3/spec6) |
| 46 | SONG_OF_STORMS | Song of Storms | music | [5] | loop 39.483 s from 82.783 s | code: En_Guruguru, code_8019AF00 |
| 47 | ROMANI_RANCH | Romani Ranch | music | [7] | loop 118.267 s from 244.967 s | scenes: F01 (main/spec2); F01C (main/spec1); F01_B (main/spec1) | code: code_8019AF00 |
| 48 | GORON_VILLAGE | Goron Village | music | [38] | loop 66.6 s from 150.1 s | scenes: 16GORON_HOUSE (main/spec4, alt1/spec4); GORONRACE (main/spec0, alt1/spec0) |
| 49 | MAYORS_OFFICE | Mayors Office | music | [3] | loop 39.883 s from 80.283 s | code: En_Dt |
| 50 | OCARINA_EPONA | Ocarina Epona | ocarina | [0] | ends 7.883 s | code: z_message |
| 51 | OCARINA_SUNS | Ocarina Suns | ocarina | [0] | ends 6.917 s | code: z_message |
| 52 | OCARINA_TIME | Ocarina Time | ocarina | [0] | ends 10.5 s | cutscenes: SPOT00 | code: z_message |
| 53 | OCARINA_STORM | Ocarina Storm | ocarina | [0] | ends 5.567 s | code: z_message |
| 54 | ZORA_HALL | Zora Hall | music | [11] | loop 71.8 s from 153.883 s | scenes: 33ZORACITY (main/spec3, alt1/spec3); 35TAKI (main/spec2) |
| 55 | GET_NEW_MASK | Get New Mask | fanfare | [15] | ends 7.15 s | cutscenes: 30GYOSON, GORON_HAKA, INSIDETOWER, MUSICHOUSE, YADOYA, YOUSEI_IZUMI | code: player_actor |
| 56 | MINI_BOSS | Mini Boss | music | [3] | loop 49.95 s from 106.35 s | scenes: OKUJOU (alt3/spec2) | cutscenes: MUSICHOUSE, OKUJOU | code: Boss_04, En_Bigpo, En_Bigslime, En_Bsb, En_Death, En_Dinofos, En_Gb2, En_Ik … |
| 57 | GET_SMALL_ITEM | Get Small Item | fanfare | [15] | ends 4.033 s | code: En_Si, player_actor |
| 58 | ASTRAL_OBSERVATORY | Astral Observatory | music | [23] | loop 31.917 s from 66.483 s | code: code_8019AF00 |
| 59 | CAVERN | Cavern | music | [26] | loop 89.75 s from 179.6 s | scenes: DANPEI (main/spec3); DANPEI2TEST (main/spec3); DEKUTES (main/spec6); GORON_HAKA (main/spec4); HAKASHITA (main/spec4); KAKUSIANA (main/spec3); KINDAN2 (main/spec5); KINSTA1 (main/spec3); LAST_LINK (main/spec6); OPENINGDAN (main/spec3); RANDOM (main/spec3); REDEAD (main/spec3); TENMON_DAI (main/spec5) | cutscenes: GORON_HAKA, OPENINGDAN | code: code_8019AF00 |
| 60 | MILK_BAR | Milk Bar | music | [32] | loop 55.55 s from 112.833 s | code: code_8019AF00 |
| 61 | ZELDA_APPEAR | Zelda Appear | fanfare | [3] | ends 5.4 s |  |
| 62 | SARIAS_SONG | Sarias Song | music | [4] | loop 30.783 s from 63.25 s | scenes: 26SARUNOMORI (main/spec0) | cutscenes: 00KEIKOKU | code: En_Kakasi |
| 63 | GORON_GOAL | Goron Goal | jingle/cutscene | [38] | ends 4.617 s | code: En_Mt_tag |
| 64 | HORSE | Horse | music | [8] | loop 37.05 s from 77.85 s | scenes: F01 (alt1/spec2) | code: En_Aob_01, En_In |
| 65 | HORSE_GOAL | Horse Goal | jingle/cutscene | [8] | ends 4.517 s | code: En_Aob_01, En_Horse, En_Horse_Game_Check, En_Ma4, En_Racedog |
| 66 | INGO | Ingo | music | [8] | loop 47.867 s from 101.717 s | scenes: KOEPONARACE (main/spec1) |
| 67 | KOTAKE_POTION_SHOP | Kotake Potion Shop | music | [14] | loop 34.817 s from 82.133 s | scenes: WITCH_SHOP (main/spec5) |
| 68 | SHOP | Shop | music | [12] | loop 54.717 s from 114.533 s | scenes: KAJIYA (main/spec5) |
| 69 | OWL | Owl | fanfare | [16] | loop 49.417 s from 101.933 s | code: En_Owl |
| 70 | SHOOTING_GALLERY | Shooting Gallery | music | [10] | loop 28.717 s from 60.733 s |  |
| 71 | OCARINA_SOARING | Ocarina Soaring | ocarina | [0] | ends 5.817 s | code: z_message |
| 72 | OCARINA_HEALING | Ocarina Healing | ocarina | [0] | ends 9.2 s | code: z_message |
| 73 | INVERTED_SONG_OF_TIME | Inverted Song of Time | ocarina | [0] | ends 10.267 s | code: z_message |
| 74 | SONG_OF_DOUBLE_TIME | Song of Double Time | ocarina | [0] | ends 10.033 s | code: En_Test6, z_message |
| 75 | SONATA_OF_AWAKENING | Sonata of Awakening | fanfare | [18] | ends 25.167 s | cutscenes: DEKU_KING |
| 76 | GORON_LULLABY | Goron Lullaby | fanfare | [18] | ends 25.9 s | cutscenes: SPOT00 |
| 77 | NEW_WAVE_BOSSA_NOVA | New Wave Bossa Nova | fanfare | [19] | ends 28.383 s |  |
| 78 | ELEGY_OF_EMPTINESS | Elegy of Emptiness | fanfare | [18] | ends 33.2 s | cutscenes: IKNINSIDE |
| 79 | OATH_TO_ORDER | Oath To Order | fanfare | [18] | ends 26.417 s | cutscenes: KYOJINNOMA |
| 80 | SWORD_TRAINING_HALL | Sword Training Hall | music | [24] | loop 41.017 s from 82.067 s | scenes: DOUJOU (main/spec5) |
| 81 | OCARINA_LULLABY_INTRO | Ocarina Lullaby Intro | ocarina | [0] | ends 5.933 s |  |
| 82 | LEARNED_NEW_SONG | Learned New Song | fanfare | [6] | ends 10.067 s | cutscenes: 10YUKIYAMANOMURA, 14YUKIDAMANOMITI, 17SETUGEN, 20SICHITAI, 20SICHITAI2, F01, HAKASHITA |
| 83 | BREMEN_MARCH | Bremen March | fanfare | [9] | loop 19.95 s from 39.883 s | code: player_actor |
| 84 | BALLAD_OF_THE_WIND_FISH | Ballad of the Wind Fish | fanfare | [18] | ends 10.017 s | code: En_Toto, player_actor |
| 85 | SONG_OF_SOARING | Song of Soaring | jingle/cutscene | [9] | ends 9.433 s | code: En_Test7, code_8019AF00, z_kankyo |
| 86 → 60 | MILK_BAR_DUPLICATE | Milk Bar Duplicate | music | [32] | loops (static) | scenes: F01 (alt3/spec2, alt4/spec2); TOWN (alt2/spec0) | code: code_8019AF00 |
| 87 | FINAL_HOURS | Final Hours | music | [23] | loop 111 s from 235.867 s | code: code_8019AF00, z_kankyo, z_play, z_scene |
| 88 | MIKAU_RIFF | Mikau Riff | fanfare | [19] | loop 7.367 s from 18.317 s | cutscenes: 30GYOSON |
| 89 | MIKAU_FINALE | Mikau Finale | fanfare | [19] | ends 5.517 s | cutscenes: 30GYOSON |
| 90 | FROG_SONG | Frog Song | ocarina | [0] | loop 8.233 s from 16.45 s | code: En_Minifrog, code_8019AF00 |
| 91 | OCARINA_SONATA | Ocarina Sonata | ocarina | [0] | ends 6 s | code: z_message |
| 92 | OCARINA_LULLABY | Ocarina Lullaby | ocarina | [0] | ends 9.15 s | code: z_message |
| 93 | OCARINA_NEW_WAVE | Ocarina New Wave | ocarina | [0] | ends 7.867 s | code: z_message |
| 94 | OCARINA_ELEGY | Ocarina Elegy | ocarina | [0] | ends 6.983 s | code: z_message |
| 95 | OCARINA_OATH | Ocarina Oath | ocarina | [0] | ends 7.65 s | code: z_message |
| 96 → 87 | MAJORAS_LAIR | Majoras Lair | music | [23] | loops (static) | scenes: LAST_BS (main/spec4) | code: z_message |
| 97 → 81 | OCARINA_LULLABY_INTRO_PTR | Ocarina Lullaby Intro Ptr | ocarina | [0] | ends (static) | code: z_message |
| 98 | OCARINA_GUITAR_BASS_SESSION | Ocarina Guitar Bass Session | ocarina | [19] | ends 35.233 s | cutscenes: SPOT00 |
| 99 | PIANO_SESSION | Piano Session | fanfare | [19] | ends 31.5 s | cutscenes: SPOT00 |
| 100 | INDIGO_GO_SESSION | Indigo Go Session | fanfare | [19] | ends 35.233 s | code: En_Zod |
| 101 | SNOWHEAD_TEMPLE | Snowhead Temple | music | [21] | loop 119.667 s from 254.3 s | scenes: HAKUGIN (main/spec4); HAKUGIN_BS (main/spec4); LAST_GORON (main/spec4) |
| 102 | GREAT_BAY_TEMPLE | Great Bay Temple | music | [22] | loop 77.367 s from 193.4 s | scenes: LAST_ZORA (main/spec3); SEA (main/spec4); SEA_BS (main/spec4) |
| 103 | NEW_WAVE_SAXOPHONE | New Wave Saxophone | fanfare | [19] | ends 28.4 s | cutscenes: LABO |
| 104 | NEW_WAVE_VOCAL | New Wave Vocal | fanfare | [19] | ends 28.4 s | cutscenes: 31MISAKI |
| 105 | MAJORAS_WRATH | Majoras Wrath | music | [17] | loop 52.5 s from 113.717 s | code: Boss_07 |
| 106 | MAJORAS_INCARNATION | Majoras Incarnation | music | [17] | loop 81.383 s from 171.783 s | code: Boss_07 |
| 107 | MAJORAS_MASK | Majoras Mask | music | [17] | loop 101.05 s from 209.1 s | code: Boss_07 |
| 108 | BASS_PLAY | Bass Play | fanfare | [19] | loop 26.583 s from 55.85 s | code: En_Zob |
| 109 | DRUMS_PLAY | Drums Play | fanfare | [19] | loop 25.017 s from 52.217 s | code: En_Zod |
| 110 | PIANO_PLAY | Piano Play | fanfare | [19] | loop 25.683 s from 53.333 s | code: En_Zos |
| 111 | IKANA_CASTLE | Ikana Castle | music | [33] | loop 65.267 s from 160.467 s | scenes: CASTLE (main/spec3); IKNINSIDE (main/spec3) | code: Obj_Demo |
| 112 | GATHERING_GIANTS | Gathering Giants | jingle/cutscene | [33] | ends 106.333 s | cutscenes: 00KEIKOKU |
| 113 | KAMARO_DANCE | Kamaro Dance | fanfare | [34] | loop 27.35 s from 54.817 s | code: player_actor, z_actor |
| 114 | CREMIA_CARRIAGE | Cremia Carriage | music | [8] | loop 23.933 s from 53.85 s | cutscenes: F01 |
| 115 | KEATON_QUIZ | Keaton Quiz | fanfare | [39] | loop 79.783 s from 159.55 s | code: En_Kitan |
| 116 | END_CREDITS | End Credits | jingle/cutscene | [36] | ends 379.533 s | cutscenes: 00KEIKOKU |
| 117 | OPENING_LOOP | Opening Loop | music | [3] | loop 46.45 s from 102.733 s |  |
| 118 | TITLE_THEME | Title Theme | jingle/cutscene | [35] | ends 131.667 s | scenes: BOTI (alt1/spec1); CLOCKTOWER (alt1/spec0, alt3/spec11); F01 (alt5/spec11); KAIZOKU (alt2/spec2); TOWN (alt1/spec1); YADOYA (alt1/spec5) |
| 119 | DUNGEON_APPEAR | Dungeon Appear | fanfare | [15] | ends 9.017 s | cutscenes: 12HAKUGINMAE, 21MITURINMAE, 31MISAKI | code: code_8019AF00 |
| 120 | WOODFALL_CLEAR | Woodfall Clear | fanfare | [15] | ends 21.567 s | cutscenes: 21MITURINMAE, 31MISAKI |
| 121 | SNOWHEAD_CLEAR | Snowhead Clear | fanfare | [15] | ends 29.55 s | cutscenes: 10YUKIYAMANOMURA2, IKANA |
| 122 | SEQ_122 | Seq 122 | ocarina | [0] | no loop within 420 s (IO/random driven or silent) | scenes: MUSICHOUSE (main/spec1) |
| 123 | INTO_THE_MOON | Into the Moon | music | [17] | loop 18.617 s from 41.883 s | cutscenes: OKUJOU |
| 124 | GOODBYE_GIANT | Goodbye Giant | jingle/cutscene | [33] | ends 36.233 s | cutscenes: 00KEIKOKU |
| 125 | TATL_AND_TAEL | Tatl And Tael | music | [33] | loop 37.317 s from 74.617 s | cutscenes: OKUJOU, YADOYA |
| 126 | MOONS_DESTRUCTION | Moons Destruction | jingle/cutscene | [33] | ends 31.433 s | cutscenes: 00KEIKOKU |
| 127 | END_CREDITS_SECOND_HALF | End Credits Second Half | jingle/cutscene | [37] | ends 253 s | scenes: 21MITURINMAE (alt1/spec1); BOTI (main/spec1); SOUGEN (main/spec2) |

#### 8.3.4 Special sequences and game IO (doc: OoT `src/audio/game/general.c`, MM `src/audio/code_8019AF00.c`; renders verified where stated)

| sequence | what the game does | render |
|---|---|---|
| 0 (both), OoT 109 | SFX players (font 1 + 0); channels driven by the SFX system | not music |
| OoT 1 / MM 1 ambience | nature ambience player: game sets player io 0 = 1, io 4/5 = channel mask, then channel IO per `sNatureAmbienceDataIO[natureAmbienceId]` (scene header byte 6) | ends after 1 s without IO |
| OoT 2 field logic (Hyrule Field, Zora's River, Lake Hylia) | reads io 0 (1 = morning: `Audio_PlayMorningSceneSequence`, plays 49 first) and io 2 (sequence mode written by `general.c` with `SEQCMD_SET_SEQPLAYER_IO(BGM_MAIN, 2, seqMode)`: normal / enemy nearby / standing still); keeps its own state in io 3–7; picks parts 3–23 with random numbers (CE), writes the part id into its own LDSEQ operand (C7) and loads the part into buffers inside itself (Bn at 0x110 / 0x1308), then plays them (verified by `out/seqdump_oot-us10_002.txt`) | verified: loads 3, 7, 6 … and plays; random; `wav/oot-us10-002-hyrule-field.wav` |
| RESUME / RESUME_PREV flags (OoT RESUME 25, 39, 60, 80, 95 and RESUME_PREV 24, 31, 78, 85; MM RESUME 25, 54, 60 and RESUME_PREV 31, 68, 70) | a `RESUME` sequence gets io 7 = resume point when its scene is re-entered from a `RESUME_PREV` scene (house, shop) | io 7 = −1 plays from the start |
| file select (OoT 87→40, MM 24) | io 7 = 1 skips the harp intro | verified with io7=1 against captures |
| OoT 46 Ganon's Tower | `general.c` ("incrementally increase volume of NA_BGM_GANON_TOWER for each new room", called from `En_River_Sound`): volume scale plus channel 15 io 4 = low-pass cutoff | nearly silent without IO (−58.8 dBFS) |
| OoT Lost Woods / Sacred Forest (62) and Great Fairy (40) near actors | `Audio_PlaySariaBgm`: plays on the sub-BGM player with io 7 = 2, volume by distance, main BGM ducked | plain render = full song |
| OoT Lon Lon (47), Windmill (76) | special handling on the sub player / not restarted | plain render |
| MM 29 Clock Town main sequence | io 0 = 1 (morning): plays its own dawn intro channels first; then value = max(io 4, 0) + 21 is written into its RUNSEQ operand and the player restarts as 21/22/23 (day 1/2/3) | verified: io4 0/1/2/−1 → 21/22/23/21 |
| MM Clock Town day 2 pointer (35→22), Final Hours (87) | `Audio_PlaySceneSequence` does not restart 87 when already playing | |
| MM 113 Kamaro's dance, 39 music box house | positional (`Audio_PlaySequenceAtPos` from `z_actor.c`) | plain render |
| MM 103, 104, 116, 122 | RUNSEQ on the own player | verified: 103 and 104 (New Wave saxophone / vocal) continue as 77, 116 (credits) as 127; 122 is silent |
| scene seqId 0x7F | no sequence: the scene plays only its nature ambience (OoT e.g. Hyrule Field at night, Graveyard, Temple of Time exterior) | |

### 8.4 Research renderer

Files (`render/`, TypeScript, run with `TMPDIR=$PWD /home/n64/nviewer/node_modules/.bin/tsx`; nothing is written
into the repo; it imports only `RESAMPLE_LUT` from `/home/n64/nviewer/src/rom/music/libultra.ts`):

| file | lines | content |
|---|---|---|
| `zdata.ts` | 330 | loads the extracted dmadata files of a ROM, finds every table (§8.1.2), parses fonts/samples, decodes VADPCM and SMALL_ADPCM with loops |
| `zengine.ts` | 1150 | sequence player / channel / layer interpreters (OoT and MM variants), note pool, ADSR, vibrato, portamento, ProcessNotes and sample-state snapshots |
| `zsynth.ts` | 330 | reverbs (ring, downsample 2, leak, low-pass FIR), per-note resample / gain / FIR / comb / ENVMIXER |
| `zelda.ts` | 90 | `render()` + CLI: `zelda.ts <rom> <seqId> <specId> <out.wav> [io=port:value,…] [--max s] [--passes n] [--mode stereo] [--volscale f]` → WAV + JSON (loop points, RMS, log); `--volscale` sets the player's fadeVolumeScale (game-side BGM volume) |
| `scanall.ts` | 40 | renders every sequence without audio output → `out/renderscan_<rom>.json` |

- **Clock:** per task `32000/60` samples (fraction kept), split into 3 updates of 176 ± 8 (last takes the rest);
  3 script updates, then 3 synthesis updates (as `AudioSynth_Update`).
- **Start:** `AudioLoad_SyncInitSeqPlayerInternal` + `AudioSeq_ResetSequencePlayer`; fonts = the seq→font map row;
  player IO ports set from the command line after the reset (the game sets them before the start and the reset does
  not clear them).
- **Asynchronous loads** complete immediately (Bn LDSEQ copies the sequence into the script's buffer, io = 1;
  1n/6n io = 1). **RUNSEQ** on the own player restarts the player with the new sequence, keeping IO.
- **Loops:** a sequence-level backward jump (FB/F5/F9/FA taken to an earlier address) marks a pass; the render
  stops at its third execution; `[second, third)` is the loop (as `sf64.ts`). A sequence that ends renders until 1 s
  of silence (≤ 8 s). IO/random driven sequences run to `--max`.
- **Random numbers:** a fixed LCG (the game mixes the task counter and `osGetCount`), so random choices (field
  logic, ambience) are reproducible but not the game's.
- **Not modelled:** Haas delay (headset mode), MM surround mode, book offsets 2/3 (commands absent from rsp-hle),
  noise wave (book offset on a synthetic wave), other sequence players (SFX, ambience, fanfare, sub-BGM), game-side
  volume scales and fades, channel IO written by game code (e.g. Ganon's Tower low-pass), MM custom sequence
  functions (BE) and SFX channel state (A0–A3).
- **Speed:** 3–9 s of CPU per 1–4 min song in Node on this machine (Water Temple 440 s: 27 s); all 109 OoT and 123
  MM distinct sequences render without errors (`out/renderscan_*.json`).

**WAVs** (32000 Hz stereo, with `.json` sidecars: loop points, RMS; `wav/`):

| game | file | seq / spec / IO | length, loop |
|---|---|---|---|
| OoT | `wav/oot-us10-030-title.wav` | 30 / 10 | 211.3 s, loop 66.817 s from 77.683 s |
| OoT | `wav/oot-us10-087-file-select.wav` (Fairy Fountain) | 87→40 / 10 / io7=1 | 73.7 s, loop 24.55 s from 24.55 s |
| OoT | `wav/oot-us10-060-kokiri.wav` | 60 / 1 | 137.0 s, loop 42.917 s from 51.167 s |
| OoT | `wav/oot-us10-002-hyrule-field.wav` (also Lake Hylia) | 2 / 2 / io2=0 | 240 s, random parts, no loop |
| OoT | `wav/oot-us10-028-inside-deku-tree.wav` | 28 / 3 | 210.6 s, loop 67.017 s from 76.583 s |
| OoT | `wav/oot-us10-039-kakariko-kid.wav` | 39 / 1 | 277.8 s, loop 91.417 s from 94.917 s |
| OoT | `wav/oot-us10-092-water-temple.wav` | 92 / 4 | 440.2 s, loop 143.05 s from 154.05 s |
| OoT | `wav/oot-us10-029-market.wav`, `wav/oot-us10-029-market-entrance-volscale90.wav` | 29 / 0 (second with fadeVolumeScale 90/127) | 118.9 s, loop 39.35 s from 40.167 s |
| OoT | `wav/oot-us10-031-link-house.wav` | 31 / 5 | 79.6 s, loop 26.05 s from 27.517 s |
| MM | `wav/mm-us-118-title-theme.wav` | 118 / 0 | 131.7 s, plays once |
| MM | `wav/mm-us-030-opening.wav`, `wav/mm-us-117-opening-loop.wav` | 30, 117 / 0 | 70.8 s once; loop 46.45 s |
| MM | `wav/mm-us-024-file-select.wav` | 24 / 10 / io7=1 | 73.7 s, loop 24.55 s |
| MM | `wav/mm-us-021-clock-town-day-1.wav`, `wav/mm-us-029-clock-town-main-seq.wav` | 21, 29 / 1 / io4=0 | 161.0 s, loop 52.217 s from 56.567 s |
| MM | `wav/mm-us-002-termina-field.wav` | 2 / 1 | 198.2 s, loop 66.017 s from 66.167 s |
| MM | `wav/mm-us-028-woodfall-temple.wav` | 28 / 3 | 215.4 s, loop 67.817 s from 79.783 s |

### 8.5 Verification against captured game audio

**Captures** (made by the lead): mupen64plus with rsp-hle and the audio-dump plugin, AI at 32006 Hz, stereo
big-endian PCM plus per-buffer log and a timestamped segment log: `cap/mm-us/` (boot, title, file select, new-game
intro, South Clock Town day and night, Termina Field, Woodfall Temple), `cap/mm-us-tf/` (Termina Field entered on foot, layer 0), `cap/oot-us10/` (title, file select,
intro, Inside the Deku Tree, Kakariko Village child, Lake Hylia). Loudness timelines: `out/captimeline_<rom>.txt`
(`scripts/captimeline.py`).

**Method** (`scripts/compare.py`): capture span resampled 32006 → 32000 Hz; render offset chosen by the best NCC of
20 ms log-loudness envelopes; time stretch from the offsets of the first and last thirds (resolution ≈ ±0.0006 for
55 s); Welch log-magnitude spectrum correlation (40 Hz–12 kHz); 12-bin chroma correlation at 0 semitones (and the
best other shift); waveform NCC over the loudest 1 s after ±40 ms sample alignment. Renders use the scene's spec
and the game's IO (§8.3.4), stereo mode.

| capture span (raw byte / time) | render | env NCC | stretch | RMS cap / render (dBFS) | spectrum | chroma 0 (other) | wave NCC | result |
|---|---|---|---|---|---|---|---|---|
| MM file select 18945472 / 148.0 s, 40 s | 24 / spec 10 / io7=1 | 0.984 | 1.000 | −33.18 / −33.13 | 0.9987 | 0.9993 (0.35) | 0.717 | match |
| MM Woodfall Temple 124500000 / 972.5 s, 55 s | 28 / 3 | 0.972 | 0.9995 | −20.64 / −20.64 | 0.9867 | 1.000 (0.40) | 0.943 | match |
| MM title logo 11000000 / 85.9 s, 35 s | 118 / 0 | 0.997 | 1.000 | −26.07 / −26.03 | 0.9990 | 0.9994 (0.63) | 0.643 | match |
| MM after boot 3500000 / 27.3 s, 18 s | 118 / 0 (offset 0.46 s) | 0.995 | 1.000 | −28.04 / −28.08 | 0.9991 | 0.9987 (0.47) | 0.489 | match: 118 starts 26.9 s after boot |
| MM South Clock Town day 1 42435136 / 331.5 s, 58 s | 21 / 1 / io4=0 | 0.764 | 0.9995 | −23.29 / −24.39 | 0.9504 | 0.972 (0.52) | 0.631 | match with dialogue/SFX/ambience in the capture |
| OoT title 1837056 / 14.3 s, 60 s | 30 / 10 | 0.822 | 0.9995 | −22.58 / −23.25 | 0.9362 | 0.9991 (0.38) | 0.891 | match (title demo SFX in capture) |
| OoT file select 10652736 / 83.2 s, 45 s | 87→40 / 10 / io7=1 | 0.973 | 1.000 | −33.05 / −33.04 | 0.9987 | 0.9999 (0.39) | 0.889 | match |
| OoT Inside the Deku Tree 26400000 / 206.2 s, 55 s | 28 / 3 | 0.940 | 0.9989 | −23.94 / −23.73 | 0.9984 | 0.9968 (0.28) | 0.900 | match |
| OoT Kakariko child 40400000 / 315.6 s, 55 s | 39 / 1 | 0.935 | 0.9995 | −28.15 / −28.62 | 0.855 | 0.9991 (0.33) | 0.595 | match with nature ambience in the capture |
| OoT Market Entrance day 75600000 / 590.5 s, 45 s | 29 / 0 | 0.908 | 1.000 | −29.92 / −24.46 | 0.9839 | 0.943 (0.26) | 0.276 | tune/tempo match, game 5.5 dB quieter |
| same span | 29 / 0, fadeVolumeScale 90/127 (value from RAM `me1.bin`) | 0.908 | 1.000 | −29.92 / −30.45 | 0.9838 | 0.943 (0.26) | 0.276 | match (level within 0.5 dB); crowd/ambience in capture |
| OoT Market Entrance later 78300000 / 611.6 s, 28 s | 29 / 0, fadeVolumeScale 90/127 | 0.898 | 1.000 | −30.81 / −31.06 | 0.9833 | 0.9973 (0.24) | 0.547 | match |
| OoT Link's house 90500000 / 706.9 s, 35 s | 31 / 5 | 0.942 | 1.000 | −26.19 / −26.83 | 0.9852 | 0.9845 (0.28) | 0.548 | match |
| OoT Lake Hylia 52900000 / 413.2 s, 30 s | 2 / 2 / io2=0 | 0.317 | – | −24.27 / −23.44 | 0.9542 | 0.714 (0.61) | 0.063 | same instruments and level; the field logic picks random parts, so not note-identical (expected) |
| MM Termina Field 73676096 and 99000000, 58–80 s (first session) | 2 / 1 | 0.07–0.23 | – | −41.4 / −21.7 | – | – | – | no field music in that capture: the warp loaded Termina Field in layer 5 (the first cycle before the ocarina is recovered), whose header plays the ambience sequence 1 instead of field music (§8.3.3: AMBIENCE, 00KEIKOKU alt5); RAM dumps `runs/lead-mmus-1/tf1*.bin` hold 29 and 21, not 2 |
| MM Termina Field `cap/mm-us-tf/audio.raw` 37837696 / 295.6 s, 45 s (second session: walked out of South Clock Town's south gate, layer 0, 09:17) | 2 / 1 | 0.904 | 0.9993 | −21.08 / −21.12 | 0.9953 | 0.9984 (0.27) | 0.639 | **match**; RAM dump `runs/lead-mmus-2/tfm.bin` holds sequence 2 (lead's check, same method) |
| MM boot 8.3–22.3 s | all sequences 1–127 (`scripts/idmatch.py` → `out/idmatch_mm-boot-demo.txt`) | best 0.46 | – | −19.9 | – | best 0.73 (seq 105) | – | **no sequence matches** (open question) |

**RAM cross-check** (verified: lead's RAM dumps; each sequence found by its first 64 bytes, the player by the
pointer to it at `SequencePlayer + 0x18`, layout doc `include/audio.h`):
- MM (`runs/lead-mmus-1/*.bin`): the audio heap holds 118 during the new-game intro, 29 + 21 in South Clock Town day
  and night, 28 in Woodfall Temple, and 24 (file select) everywhere after the file select; no 2 in the first session's Termina
  Field dumps (layer 5), sequence 2 in the second session's `runs/lead-mmus-2/tfm.bin` (layer 0).
- OoT US 1.0 (`runs/lead-ootus-1/*.bin`): `gAudioCtx.seqPlayers[0]` (BGM main) is at RAM **0x80128B60**; sequence data
  at 0x801C0BD0. Player fields per dump:

  | dump (scene) | seqId | tempo (BPM) | fadeVolume | fadeVolumeScale | io[0..7] |
  |---|---|---|---|---|---|
  | `dt1.bin` (Inside the Deku Tree) | 28 | 50 | 0.5512 (70/127) | 1.0 | all −1 |
  | `kv1.bin` (Kakariko, child) | 39 | 100 | 0.5512 | 1.0 | −1 −1 2 5 −1 −1 −1 −1 |
  | `lh3.bin` (Lake Hylia) | 2 | 137 | 0.5118 (65/127) | 1.0 | 0 −1 2 2 2 0 0 21 |
  | `me1.bin` (Market Entrance day) | 29 | 146 | 0.5118 | **0.7087 (90/127)** | 0 −1 2 2 2 2 0 −1 |
  | `lk1.bin` (Link's house) | 31 | 147 | 0.5118 | 1.0 | −1 −1 2 −1 −1 −1 −1 −1 |

  fadeVolume and tempo are the values the sequences set themselves (renders reach the same); the field logic's
  io 7 = 21 is the last part it loaded (NA_BGM_FIELD_STILL_2), io 2 = 2 is the sequence mode written by the game.

**Fixes made while verifying:** none of the renderer's audio behaviour had to change to match the captures (the
first renders matched). The Market Entrance level difference was traced to the game's BGM volume scale (RAM), not
the renderer; `--volscale` reproduces it. Bugs fixed during bring-up (before the comparisons): LDFILTER must read the coefficients
already stored in the sequence; RUNSEQ restarting the own player (MM Clock Town, credits); a name clash in the
engine. The render scan's 420 s limit was too short for the Water Temple (143 s loop after 154 s).

**What the numbers show:** pitch and instrument choice are right (chroma at 0 semitones ≥ 0.997 while other shifts
stay ≤ 0.63); tempo is right to the method's resolution (so `maxTempo` 10770 and 3 updates per frame hold for both
games); levels are right to 0.05 dB where only music plays, which also checks the doubled reverb send, the 0x7FFF
reverb return and the spec 10 low-pass reverb with rsp-hle's coefficient averaging (file selects); waveform NCC
0.64–0.94 shows sample-level agreement is close but not exact (the game's AI buffer lengths vary 510–544 samples per
task, which shifts note starts by up to one update relative to the render).

## 9. Mapping onto the viewer

### 9.0 Summary and module plan

One loader family, `src/rom/zelda/`, serves the four retail/debug ROMs through structure-based detection; the alpha is a
variant selected by hash. The existing viewer types cover almost everything; the display-list interpreter and the
renderer need the most work.

| module (proposed) | contents | depends on | difficulty |
|---|---|---|---|
| `zelda/fs.ts` | byte order, `zelda@` + dmadata, Yaz0, files by VROM | - | low |
| `zelda/tables.ts` | `code` detection and VRAM; scene, object, actor overlay, entrance, map select tables | fs | low |
| `zelda/names.ts` | scene names (OoT decomp enum names; MM titles decoded from messages + static names), sidebar groups, actor names | tables | low |
| `zelda/scene.ts`, `room.ts` | header commands, alternate headers, mesh types 0/1/2, spawns, light and sky settings, sound settings | tables | low |
| `displaylist.ts` changes | direct texture fetch, TLUT memory, F3DEX2 RDPHALF_1/BRANCH_Z, caller-supplied initial state, second texture and combiner per batch (§5.3.5) | - | medium |
| `zelda/drawconfig.ts` | OoT 53 draw configs at frame 0 + day/night texture table finder; MM animated materials | scene | medium |
| `zelda/env.ts`, `skybox.ts` | time-of-day light blend, sun direction, fog, zFar; OoT vr_* and MM d2 sky cubes | scene | low / medium |
| `zelda/collision.ts` | collision and waterbox overlay meshes, bg cameras (start camera) | scene | low |
| `zelda/prerender.ts` | JPEG backdrop + fixed camera for OoT image rooms (needs a JPEG decoder in the worker) | scene | medium-high |
| `zelda/actors.ts` | placement parsing (OoT/MM encodings), markers, ~40 static recipes per game | scene, tables | medium |
| `zelda/alpha.ts` | hash detection, static scene table, F3DEX, RGBA16 backgrounds, 12-byte waterboxes, alpha actor id map | scene, room | low (once retail exists) |
| `music/zelda64.ts` | EAD driver variant for OoT and MM, tables by structure, SMALL_ADPCM, FIR/comb filters, spec reverbs | fs, tables | medium |
| renderer | two-texture lerp, half-texel sampling offset for Zelda batches, optional point filter | types | medium |

`types.ts` changes, all small:
- `Game.id`: add `'oot'`, `'mm'`, `'ootalpha'`.
- `Batch`: optional second texture (`texture1`, `uvs1`) and a mix mode/factor (or full combiner inputs) (§9.2).
- Optional: `LevelInfo.music?` (level -> track), `MusicTrack.group?`, a variant selector for layers/time of day
  (`Level.variants?`) if sub-level entries in the list are not wanted, `Marker.yaw?`.

Suggested order: fs/tables/names and the level list; rooms with the display-list changes (first visible result, with
the second texture and half-texel fix in the renderer); environment and sky; draw configs; collision overlay; static
actors and markers; music; prerendered backgrounds; the alpha.

### 9.1 Filesystem, tables and level list

- `src/rom/zelda/fs.ts`: byte order normalisation, `zelda@` + dmadata detection, Yaz0 decoder, file access by VROM.
- `src/rom/zelda/tables.ts`: `code` detection, `code` VRAM, scene/object/actor/entrance tables by structure.
- `src/rom/zelda/names.ts`: OoT English names (static, from the decomp enum), MM title decoding from messages plus static
  names for untitled scenes, sidebar grouping tables.
- `src/rom/zelda/zelda.ts`: `Game` with levels = scenes (+ layer variants); `Game.id` gains `'oot'` and `'mm'` (and the alpha).
- Difficulty: low (well-defined structures, all found generically and verified in four ROMs).

### 9.2 Scenes, rooms, display lists and environment

| item | proposal | difficulty |
|---|---|---|
| `src/rom/zelda/scenetable.ts` | §5.1.1 finder, drawConfig byte, per-game stride | low |
| `scene.ts` | header commands, alternate headers (§5.1.3), spawns, light settings, skybox settings, collision pointer | low |
| `room.ts` | mesh types 0/1/2, per room one `Mesh` with OPA batches then XLU batches (or two meshes) | low |
| `displaylist.ts` | §5.3.5 changes 1-8 | medium |
| `drawconfig.ts` | OoT 53-config table at frame 0 (§5.4.1, port of `scenes/drawcfg.ts`) + pointer table finder; MM animated materials | medium |
| `env.ts` | time → light entry blend, sun direction, fog factors, zFar (§7.3-7.5) | low |
| `skybox.ts` | OoT normal sky and MM d2 sky as a `Sky` mesh; baked blend/tint per time; shop 256-skies later | medium |
| `collision.ts` | collision + waterbox overlay meshes (§5.5), bg camera list | low |
| `prerender.ts` | JPEG backdrop + bg camera variant (§5.2.1); needs a JPEG decoder in the worker | medium-high |
| renderer | second texture + lerp mode, half-texel offset, point filter flag | medium |

`types.ts` extensions (all optional):
1. `Batch.texture1?: number; uvs1?: Float32Array; texMix?: {mode: 'lerp'; factor: number}` (factor = env alpha or prim
   LOD frac, constant per batch) — or the full `combine?: number[16]` with prim/env for a generated shader.
2. `Batch.pointFilter?: boolean` (G_TF_POINT; rare in rooms).
3. Layers: one `LevelLayer` per room (`kind 'main'`, name "room N"), plus `'collision'` (collision mesh) and a waterbox
   layer, both `visibleByDefault: false`; translucent room lists stay in the same instance (blend batches draw last).
4. Variants: alternate headers and time of day as sub-levels (`LevelInfo` entries per variant) or a `Level.variants?:
   {name, index}[]` selector: "child day (default) / child night / adult day / adult night / cutscene n" (OoT), "setup n"
   (MM), and "noon (default) / dawn / dusk / night" for lightMode 0 scenes.
5. `Level.fog` (existing), `clearColor` (0,0,0), `skies` (existing `Sky`), `camera` (existing `CameraView`, §7.6),
   `backdrop` (existing, prerendered rooms).
6. Lights: baked through `runDisplayList`'s `lighting` (rooms are static and in world space, so baking is exact).

### 9.3 Actors

- `src/rom/zelda/actors.ts`: parse actor/transition/spawn/entrance/object lists (OoT and MM encodings); read category and
  objectId from the overlay table's profiles; static name tables per game; a recipe table (actor name -> object, display
  lists by params, scale, yOffset, extra transforms, colours) with per-version offsets.
- Draw static actors as `Instance`s whose matrix is the formula above, sharing one `Mesh` per (object, display list,
  colour state); lit display lists use the scene lights like rooms do.
- `Marker` already has `label`, `position`, `layer`, `info`: enough for NPCs, enemies, logic actors, spawns and
  transitions. `LevelLayer` kinds `objects` and `markers` give the toggles; `visibleByDefault: false` for logic actors.
- No `types.ts` change is required for actors. A marker orientation (yaw) would help for spawns and doors (optional
  extension: `Marker.yaw?`).
- Difficulty: lists and markers low; 40 static recipes per game medium (each needs its params rule); skeletal bind pose
  medium; flex-skinned NPCs high (not needed for a first version).

### 9.4 Music

#### 9.4.1 Module

`src/rom/music/zelda64.ts`, one module for both games (a `game: 'oot' | 'mm'` flag selects the MM variants of §8.2),
ported from `render/zdata.ts` + `zengine.ts` + `zsynth.ts`:
```ts
export function zelda64Music(files: { code: Uint8Array; audiobank: Uint8Array; audioseq: Uint8Array; audiotable: Uint8Array },
                             game: 'oot' | 'mm'): { tracks: MusicTrack[]; decode(index: number): DecodedMusic }
```
- Inputs come from the Zelda filesystem loader (dmadata files 3–5 raw; `code` decompressed with Yaz0). All tables
  are found by structure/signature (§8.1.2), so the same code serves the four ROMs; the alpha ROM needs its own check.
- Each track carries `{ seqId, specId, io }`: `specId` = the spec of the first scene header that plays the sequence
  (§8.3), 10 for menu music, 0 otherwise; `io` = the game's settings (file select `7: 1`; MM Clock Town `4: day − 1`;
  field logic `2: 0`).
- `decode`: render intro + two passes and report `loopStart/loopEnd` like `sf64.ts`; for sequences without a
  sequence-level loop (§8.3.3: field logic, IO-driven) render a fixed length (e.g. 4 min, fixed random seed) with no
  loop, or leave them out.
- Output gain 1 (`clamp16(dry)/32768`): songs sit at −18 to −34 dBFS RMS, inside the range of the other games.
- Reuse from `sf64.ts` (copy or factor out): the linked-list note pool, ADSR, ENVMIXER ramps, resampler loop, ring
  reverb; from `libultra.ts`: `RESAMPLE_LUT`.

#### 9.4.2 `types.ts`

No change is required for a flat list. Two optional additions help a 100+ song soundtrack:
- `MusicTrack.group?: string` (e.g. "Areas", "Dungeons", "Bosses and battles", "Menus and title", "Cutscenes",
  "Fanfares", "Ocarina"), shown as sub-headings like `LevelInfo.group`.
- `LevelInfo.music?: number` (a track index) so the player can start the song of the selected level (scene header
  seqId, §8.3.4).

#### 9.4.3 Track list and level association (recommendation)

- **Show:** every sequence of kind *music* (OoT 47, MM 61, aliases once), the title and menu pieces,
  cutscene/credits pieces that play to their end (OoT 77, 94, 103–106; MM 30, 112, 116, 118, 124, 126, 127) and,
  in a separate group, fanfares and the ocarina/song sequences (they are short and on the fanfare player in game).
- **Leave out:** SFX sequences (OoT 0, 109; MM 0), ambience (OoT 1, MM 1; they only sound with game IO), field parts
  OoT 3–23 (played by the field logic), logic sequences (OoT 2 may be offered as a fixed-length "Hyrule Field"
  render; MM 29 → use 21–23 directly), OoT 46 Ganon's Tower (silent without game IO; offer with channel 15 io4 =
  0x40 if wanted), MM 122, alias rows (OoT 87, MM 35, 40, 86, 96, 97).
- **Names:** the decomp enum names made readable (§8.3), with community names for OoT where they exist (labelled
  community-derived); the games have no in-game sound test.
- **Level → song:** the scene header `SCENE_CMD_SOUND_SETTINGS` gives `seqId` (0x7F = no sequence, the scene plays
  only nature ambience `natureAmbienceId`), per header (child/adult day/night and cutscene headers differ, §8.3.4).
  The viewer's level for a scene header should point at that track; for 0x7F show no song or the ambience note.

#### 9.4.4 Difficulty

| part | effort | notes |
|---|---|---|
| tables, fonts, SMALL_ADPCM, spec reverbs | small | research code exists and is checked on four ROMs |
| sequence interpreter (OoT + MM variants) | medium | ≈1100 lines; opcode tables verified against all sequences |
| synthesis (FIR, comb, reverbs) | medium | verified against captures for Woodfall/title/file select/Deku Tree/Kakariko |
| track metadata (names, groups, specs, IO, scene links) | small-medium | generated tables in `out/songlist_*.tsv` |
| IO-driven pieces (field logic, Clock Town days, Ganon's Tower) | medium | optional; fixed presets are enough for a player |
| CPU/memory | as `sf64.ts` | render in the worker, one track on demand |

### 9.5 Alpha ROM

See §11.9.

## 10. Verification evidence

### 10.0 Emulator sessions and reference captures

All sessions used the headless mupen64plus described in `/home/n64/nviewer/EMULATOR.md` (debug core for RAM access,
rsp-hle, software rendering), one run directory each. Each reference capture is a 320x240 screenshot plus a sidecar with
RAM values read by `env/zram.py` (scene, layer, room, time, player, View eye/at/fovy/zNear/zFar, light context, skybox),
and an 8 MB RAM dump in the run directory. Warps were done by RAM pokes on the SaveContext/PlayState fields named in
`env/EMU-BRIEF.txt`; the exact input sequences are in the `env/emu-*-notes.txt` files. Two traps for repeat
captures: in OoT the sky and time-based lights follow `skyboxTime` (SaveContext + 0x141A), which only moves forward, so
a warp back to noon must write it too; in both games the clock keeps running during loads and camera settling, so each
sidecar records the time at the dump, not the poked time.

| session | ROM | captures (`ref/<rom>/`) | audio (`music/cap/`) | addresses verified |
|---|---|---|---|---|
| env-1 (first round) | OoT US 1.0 | kokiri-forest-1, hyrule-field-1 | - | PlayState 0x801C84A0, SaveContext 0x8011A5D0 |
| env-2 (first round) | OoT MQ debug | deku-tree-mq-1, hyrule-field-1 (via the map select) | - | PlayState 0x80212020, SaveContext 0x8015E660 |
| lead-mmus-1 | MM US | south-clock-town-day-1, south-clock-town-night-1, termina-field-1 (layer 5), woodfall-temple-1 | `mm-us/`: boot, title, file select, intro, South Clock Town day/night, Termina Field (no field music), Woodfall Temple; 138.9 MB at 32006 Hz with segment log | PlayState 0x803E6B20, SaveContext 0x801EF670 |
| lead-mmdbg-1 | MM debug PAL | south-clock-town-day-1 (same spawn, camera and lights as US), termina-field-1 (layer 0; different spawn/camera settle) | - | PlayState 0x80448700, SaveContext 0x8023F790; field offsets as US |
| lead-ootus-1 | OoT US 1.0 | deku-tree-1, kakariko-village-1, lake-hylia-1, market-entrance-1 (prerendered background, fixed camera setting 25), links-house-1 (pivot camera, 3D room), kakariko-village-night-1 (layer 1), hyrule-field-dusk-1 (sky blend 1→2); Hyrule Field at night skipped (enemies attack at the spawn) | `oot-us10/`: title, file select, Deku Tree, Kakariko child, Lake Hylia, Market Entrance, Link's house, Hyrule Field night, game over, Kakariko night, Hyrule Field dusk; 140.7 MB at 32006 Hz with segment log | PlayState 0x801C84A0, SaveContext 0x8011A5D0 (re-verified) |
| lead-mmus-2 | MM US | - | `mm-us-tf/`: walked from South Clock Town (day 1, 09:00) through the south gate into Termina Field (layer 0; the guard flag and the ocarina in the inventory are needed, otherwise the first-cycle layer 5 without field music loads); 44.1 MB with segment log; RAM dump `tfm.bin` | as lead-mmus-1 |

Process hygiene: every session was run by a separate subagent with its own run directory and stopped with
`pkill -x -F <rundir>/pid mupen64plus`; each agent checked that its emulator and `headless-*.sh` helpers were gone. The lead-mmus-2 agent was stopped after its RAM dump; its emulator had already exited (emulator log "Rom closed", pid gone), and the lead re-checked that no mupen64plus or helper process remained.

### 10.1 Identification, filesystem, tables, levels

| claim | method |
|---|---|
| hashes, header codes, build strings, byte order | ROM bytes (md5sum, sha1sum, xxd, string search) |
| dmadata location and record rules, absent files, ordering | ROM bytes (`fs/verify_dma.py`) |
| Yaz0 format | ROM bytes (independent decoder, all files match the C decoder's output) |
| `code` VRAM formula | ROM bytes (internal actor profile ids line up, `fs/tables.py`) |
| code table locations and sizes | ROM bytes (`fs/tables.py`) |
| OoT entrance table size and position | ROM bytes (`lead/levels.py`) |
| file names derivable from code tables | ROM bytes vs decomp `segments.csv` / debug name table |
| scene and room counts, alternate header presence, room lists unchanged by layers | ROM bytes (`fs/scenes.py`) |
| MM scene titles from message data | ROM bytes (`lead/levels.py`) |
| map select names | ROM bytes (`fs/maps.py`) |
| MQ debug dungeons differ from US 1.0; 76 scenes identical | ROM bytes (md5 per file) |
| layer meanings and fallback | doc (z_scene.c); layer 0 matches the reference captures (sidecars: sceneLayer 0) |
| sidebar grouping, English names of untitled scenes | doc / proposal |

### 10.2 Scenes, display lists, environment

#### Offline renders compared with screenshots

Research renderer (`scenes/render.ts`): ROM data → scene table, headers, rooms (`zscene.ts`), draw config
(`drawcfg.ts`), lights/fog/sky (`env.ts`), display lists through the patched `scenes/dl/displaylist.ts` with SETUPDL_25
state, software rasteriser `scenes/raster.ts` (perspective-correct textures, screen-linear shade and RSP per-vertex fog,
full two-cycle combiner per pixel, TEX_EDGE coverage threshold, XLU blending, decal depth, near/far clipping, 2×2
supersampling) → PNG (`png.ts`). Camera, time, room and layer come from the capture sidecar. `--mode viewer` renders what
the viewer model gives (texture 0 × folded vertex colour). `scenes/runrefs.sh` renders all OoT captures;
`scenes/sbs.py` builds side-by-sides and error numbers. The player, HUD, sun and particles are not rendered; static actors are drawn only in the §6.5 renders.

| capture | render (full) | MAE all / best 75% / bias RGB | viewer model best 75% |
|---|---|---|---|
| OoT US Kokiri Forest (balcony, fixed cam) | `scenes/renders/sbs-oot-us10-kokiri-forest-1.png` | 8.9 / 3.2 / −3 −3 −2 | 3.5 |
| OoT US Hyrule Field noon | `scenes/renders/sbs-oot-us10-hyrule-field-1.png` | 14.8 / 4.7 / +4 +4 +2 | 9.8 (blurry ground) |
| OoT MQ Hyrule Field | `scenes/renders/sbs-oot-mqdbg-hyrule-field-1.png` | 17.1 / 4.7 / +4 +5 +2 | 10.1 |
| OoT MQ Deku Tree entrance | `scenes/renders/sbs-oot-mqdbg-deku-tree-mq-1.png` | 10.6 / 2.7 / −2 −2 −1 | 2.7 (no TEXEL1 there) |
| OoT US Deku Tree entrance | `scenes/renders/sbs-oot-us10-deku-tree-1.png` | 7.2 / 1.9 / −1 −1 0 | 1.9 |
| OoT US Kakariko Village gate, noon | `scenes/renders/sbs-oot-us10-kakariko-village-1.png` | 11.1 / 3.1 / +3 +2 0 | 7.6 (blurry ground) |
| MM US South Clock Town day | `scenes/renders/sbs-mm-us-south-clock-town-day-1.png` | 14.3 / 2.6 / +2 +2 0 | — |
| MM US South Clock Town night | `scenes/renders/sbs-mm-us-south-clock-town-night-1.png` | 11.6 / 1.7 / +1 0 +1 | — |
| MM US Termina Field (layer 5) | `scenes/renders/sbs-mm-us-termina-field-1.png` | 24.9 / 11.3 / +3 +5 +4 | — |
| OoT US Lake Hylia (child, 12:20) | `scenes/renders/sbs-oot-us10-lake-hylia-1.png` | 10.7 / 3.0 / +2 +2 +1 | 9.0 (blurry ground) |
| OoT US Market Entrance (prerendered JPEG) | `scenes/renders/sbs-oot-us10-market-entrance-1.png` | 5.8 / 3.3 / +3 +3 +3 | — |
| OoT US Link's House (256 skybox) | `scenes/renders/sbs-oot-us10-links-house-1.png` | 4.6 / 0.4 / 0 0 0 | — |
| MM dbg PAL South Clock Town day | `scenes/renders/sbs-mm-dbgpal-south-clock-town-day-1.png` | 16.4 / 3.2 / +2 +3 0 (actors: 15.4 / 3.0) | — |
| OoT US Hyrule Field dusk (16:50) | `scenes/renders/sbs-oot-us10-hyrule-field-dusk-1.png` | 11.8 / 4.3 / −2 +1 +5 | — |
| OoT US Kakariko Village gate, midnight (layer 1) | `scenes/renders/sbs-oot-us10-kakariko-village-night-1.png` | 6.9 / 1.9 / +1 +2 0 | — |
| MM dbg PAL Termina Field (layer 0) | `scenes/renders/sbs-mm-dbgpal-termina-field-1.png` | 14.5 / 3.4 / +3 +4 +1 | — |
| prerendered: collision over JPEG | `scenes/renders/sbs-oot-us10-prerendered.png` | visual alignment | — |

Fixes made along the way (each changed the match visibly):
1. Texture size from G_SETTILESIZE (a first attempt derived height from the load count, which is in load-siz units): the
   Kokiri wall drawing was stretched vertical bars → correct.
2. No half-texel offset in bilinear sampling (§5.3.3): removed a dark skybox seam, sharpened decals, error down 1.5-3.
3. Crack-free rasterisation of shared edges (pixel-distance inside test).
4. MM time from the SaveContext line (not the warp note) → sun direction equal to RAM.
5. MM sky: per-day config remap and colour tables; sky rotation from RAM (the opposite sign gave a worse sky MAE,
   19.7 vs 24.0).

Remaining differences and why: actors/player/HUD/sun (largest errors); Termina Field spires and ground (two-layer I8
scroll materials at animation phase 0 vs the game frame, MM fog far 1003; sky clouds still offset); Kokiri Forest slightly
darker (−3) and Hyrule Field slightly brighter (+4): RDP dithering, 3-point filter, colour-combiner integer rounding and
the emulator plugin's output (not investigated); anti-aliasing of edges.

Viewer-model conclusion: the current texture 0 × vertex colour model is close for single-texture scenes (Deku Tree:
identical) but loses the detail layer of two-texture materials (Hyrule Field best-75% error 9.8 vs 4.7; the ground is
the blurry low-frequency layer). Supporting `lerp(TEXEL0, TEXEL1, k) × shade × prim` per batch covers the TEXEL1
combiners in the census (~21 000 OoT US triangles and ~1 300 MM tile-1 uses).

#### Evidence list

| claim | method |
|---|---|
| Scene table layouts/locations, all 4 ROMs | structure finder `scenes/zscene.ts` used by renders of all ROMs; `scene-oot/zrom.py`, `scene-mm/mmscene.py` |
| Header command usage counts (OoT) | `scene-oot/census.py` → `census-oot-*.txt` |
| Mesh layouts and type counts | `zscene.ts parseMesh` in renders; `scene-oot/meshscan-*.txt`, `scene-mm/report-*.txt` |
| JPEG backgrounds are baseline JFIF 320×240 | `scenes/bgimage.py` decode with Pillow, images inspected |
| Prerendered bg camera formula | collision rendered over JPEG, `sbs-oot-us10-prerendered.png` (visual) |
| DL opcode set, render state, combiner census | `scene-oot/census-*.txt`, `scene-mm/report-mm-us.txt` |
| Texture load sequence, direct-image model, TLUT indexing | `scenes/dldump.py`; renders; `sizeMismatchCount` 0 |
| 4 KB model inadequate | census capped loads (OoT 1 649), `scene-mm/texcensus.py` (MM 903 > 4 KB) |
| Half-texel convention | render seam and error before/after (`scenes/renders/*-full.json` history in §10.2) |
| BRANCH_Z semantics | `scenes/branchz.ts` dumps |
| Draw config table | decomp `z_scene_table.c`; renders SDC 1, 4, 19 |
| Day/night pointer table location/values | `scenes/findsdc.py` ROM bytes (US, MQ) vs decomp XML offsets |
| MM animated materials | decomp `z_scene_proc.c`; renders SCT, Termina Field |
| MM area texture table location | ROM scan (both MM ROMs), filelist names (`mm-decomp/tools/filelists/n64-us/all.csv`) |
| Light settings layout and selection, sun direction | RAM (`ref/*/…txt` lightCtx/envCtx) equals `env.ts` output for every capture |
| MM skybox config remap and colours | RAM skyboxCtx prim/env/config/indices (`runs/lead-mmus-1/sctd1c.bin`, `sctn1.bin`, `tf1c.bin`) |
| OoT sky files and geometry | `env.ts findSkyFiles` ROM scan; Hyrule Field sky render vs screenshot |
| Fog factors and projection | decomp `z_rcp.c`, RAM projection matrices, renders |
| Start camera from bg cam data | `scenes/camcheck.ts` bg cam 4 = RAM eye (Kokiri Forest) |
| Spawn → player entry | `camcheck.ts` vs RAM player home pos (Hyrule Field) |
| Units, no mirror, world-space rooms | 14 renders vs screenshots |
| Prerendered bg camera formula and JPEG = frame | RAM camera of `ref/oot-us10/market-entrance-1`; JPEG vs screenshot (§5.2.1) |
| 256 skybox files, layout and draw order | Link's House render vs screenshot (best-75% error 0.4); file sizes in both OoT ROMs |
| MM debug PAL sky/light computation | RAM of `ref/mm-dbgpal/*` vs `env.ts` output; renders |
| Actor transform, MM rotation/half-day decoding, recipes | renders with actors vs screenshots (§6.5) |
| Dusk light and sky blends | RAM of `ref/oot-us10/hyrule-field-dusk-1` = `env.ts` output (sky fine1/fine2 blend 218); render |
| Collision/waterbox layout | `camcheck.ts`, `render.ts --collision` overlays aligned with geometry |
| OoT US vs MQ differences | `scenes/ootcmp.py`, `ootroomdiff.py`, `ootroomhdr.py` |
| MM US vs debug PAL differences | `scene-mm/compare2.py`, `scenes/mmdiff.py`, pixel-identical SCT render |


### 10.3 Actors

| claim | method |
|---|---|
| actor/transition/spawn/entrance/object record layouts, OoT binary-angle rotations | ROM bytes (`lead/dumpscene.py oot-us10 0x55`) + doc (scene.h) |
| MM id flags, degree rotations, cutscene id, half-day mask | ROM bytes (`lead/dumpscene.py mm-us 0x6F`) + doc (z_actor.c) |
| overlay/object table locations and sizes, profile id = index | ROM bytes (`fs/tables.py`) |
| debug builds have actor name pointers, retail none | ROM bytes (`fs/tables-*.json`) |
| OoT entrance table: 1556 records ending at the scene table | ROM bytes (`lead/levels.py`) |
| usage counts and categories | ROM bytes (`actors/count.py`) + doc (profiles in source) |
| draw classes, scales, params rules | doc (decomp source, `lead/actorclass.py`, `lead/drawfuncs-*.txt`) |
| display-list offsets parse as display lists in each ROM | ROM bytes (`lead/actorclass.py`) |
| object files that differ between versions | ROM bytes (`actors/objcmp.py`) |
| draw transform (T, Ry Rx Rz, S, yOffset), scales, extra draw matrices, MM half-day mask | render vs screenshots (§6.5): South Clock Town day/night, Kokiri Forest, Kakariko day/night |
| static actors make up visible set pieces | render vs screenshots (§6.5): tent, windmill, night torches |
| MM degree rotations | ROM bytes + doc; render only with near-symmetric actors (weak test) |

### 10.4 Music

| claim | method / evidence |
|---|---|
| audio files 3/4/5, raw; code file index per ROM | `scripts/tables.py` → `out/tables_summary.txt` |
| table locations by structure and signature, code RAM base | `render/zdata.ts` + `render/probe.ts` on all four ROMs; RAM base reproduces decomp symbol addresses |
| aliases, seq→font map, US vs debug differences | `scripts/tables.py`, `scripts/compare.py` → `out/compare.txt`; `scripts/samplecmp.py` → `out/samplecmp_*.txt` |
| font/sample layout, codec counts, loop predictor states (692/692, 700/700, 872/876) | `render/probe.ts` (zdata parser over every font) |
| SMALL_ADPCM decoding | doc (synthesis.c, rsp-hle `adpcm_predict_frame_2bits`); renders with 2-bit samples match captures (e.g. Woodfall Temple) |
| audio specs and reverb settings | `render/probe.ts` decode = decomp `session_config.c` values |
| opcode argument sizes, coverage, 0 unknown opcodes | `scripts/seqscan.py` → `out/seqscan_<rom>.txt/json`; agrees with the decomp disassembler output `notes/songlist/disasm/oot-us10/*.seq` |
| MM sequences identical to OoT ones (22) | md5 of every sequence (python snippet in this session, uses `scripts/seqscan.py` locator) |
| driver semantics (§8.2) | doc (decomp sources named in §8.2); rsp-hle for the RSP commands |
| scene → sequence/spec | `notes/songlist/scenesound.py` output, 11/11 spot-checked against ROM scene headers via `fs/scenes-*.json` |
| loops and lengths of every sequence | `render/scanall.ts` → `out/renderscan_*.json` (+ `_extra` for Water Temple) |
| field logic loads parts, MM 29 day mapping, RUNSEQ chains | renders with logs (`wav/*.json`, `out/renderscan_*.json`), `scripts/seqdump.py` → `out/seqdump_oot-us10_002.txt` |
| renders match the game | `scripts/compare.py` on the captures (§8.5); RAM dumps for the active sequences |
| OoT US 1.0 BGM player at RAM 0x80128B60, per-scene tempo/fade/volume scale/IO | lead RAM dumps `runs/lead-ootus-1/{dt1,kv1,lh3,me1,lk1}.bin` decoded with the decomp `SequencePlayer` layout (python snippet in this session) |
| Market Entrance BGM volume scale 90/127 explains −6 dB | render with `--volscale 0.708661` vs capture (§8.5) |
| menus use spec 10; title OoT spec 10 (Hyrule Field header alt 7), MM title Clock Tower alt 1 spec 0 | doc (`z_file_choose.c`), scene sound table, captures |

### 10.5 Alpha ROM

See §11.10.

## 11. The Ocarina of Time alpha in the F-Zero X ROM

Main scripts: `v2/alpha.py` (ROM access, structural scene scan, F3DEX walker), `v2/census.py` -> `v2/census.txt/.json`, `v2/files.tsv`;
`v2/layoutcmp.py` -> `layoutcmp.txt`; `v2/texcmp.py` -> `texcmp.txt`; `v2/actormap.py` -> `actormap.txt`; `v2/sw97actors.py` -> `sw97actors.txt`, `idrule.txt`;
`v2/sw97diff.py` -> `sw97diff.txt`; `v2/render/{render.py,export.ts,raster.c}` plus the patched copy of the viewer's DL modules in `v2/dl/`.

### 11.1 Identification

| item | value | evidence |
|---|---|---|
| file | `_folders/F-ZERO X [CFZE].z64`, 33,554,432 bytes | verified (ls) |
| md5 / sha1 | `95bf2153aaad6faff3fb42fecd2f0200` / `6aa870ec53602650638b50d7c89cac026be481f0` | verified (md5sum, sha1sum) |
| byte order | z64 big-endian (`80 37 12 40` at 0) | verified (xxd) |
| header | title `F-ZERO X`, game code `CFZE`, version byte 0, CRC `B30ED978 3003C9F9` | verified (xxd 0x0-0x40) |
| lower half 0x0-0xFFFFFF | F-Zero X (US game code). No retail F-Zero X ROM is available to compare the half against. | verified header; build not identified |
| upper half 0x1000000-0x1FFFFFF | second half of a 32 MiB OoT prototype ROM, late 1997 (Spaceworld 97 era) | doc (sw97 project README; VGC and TechRaptor articles, 2021) |
| Zelda data | 0x1000000-0x19A446F; 0xFF padding from 0x19A4470 to 0x1FFFFFF | verified (0x1000-byte block scan: every block from 0x19A5000 is all 0xFF; the last scene's last room ends at 0x19A4470) |
| build string / dmadata / code | none. `zelda@` and `Yaz0` occur nowhere in the file. No scene or file table: every scene start address occurs as a u32 only as the *end* of the previous scene's last room-list entry (plus 2 chance hits in the lower half), and the first scene start 0x10FA150 occurs nowhere. No MIPS code in the upper half (0x1000000 disassembles to nonsense; its bytes are small values < 0x70, i.e. texel indices). | verified (grep -abo over the whole file; u32 search script, output in this session; objdump) |
| compression | none: every scene/room file is stored raw | verified (headers and display lists parse in place at their ROM offsets) |

**How a loader recognises it.** Identify by md5 (or sha1) of the whole file. Structural sanity check (cheap): the header reads `F-ZERO X`/`CFZE`, and at 0x10FA150 there is a scene header `15 04 00 00 00 00 00 18 | 04 0A 00 00 02 00 01 08 | ...` whose room list (segment 2 offset 0x108) holds 10 ascending absolute ROM ranges, the first being 0x1108550-0x11118B0. Verified (ROM bytes).

### 11.2 ROM map of the upper half

| ROM range | contents | evidence |
|---|---|---|
| 0x1000000-~0x1014000 | texel data (byte values mostly < 0x70; probably the tail of an 8-bit image file cut by the F-Zero X overwrite) | verified bytes; file identity hypothesis |
| ~0x1014000-~0x1064000 | UI textures: icon-like images. 0x101AE40 matches the first 0x1068 bytes of sw97's `icon_item_static` | verified (greyscale view `v2/probe/g8_1000000.png`; prefix compare) |
| ~0x1064000-~0x10DB000 | item-name and place-name textures (Japanese text drawn as pixels), e.g. 風のメダル, 魂のメダル, 闇のエチュード, ルトの封印, ロンロン牛乳 | verified (view `v2/probe/g8_1064000.png`) |
| 0x10DD500-0x10ED200 | Japanese message text (Shift-JIS), e.g. at 0x10E0000 `さぁ、ゼルダ姫の待つ ハイラル城へいそげ！！`, `たてふだＮｏ．７`… | verified (Shift-JIS decode, byte-class scan) |
| 0x10ED200-0x10FA14F | low-entropy 4-bit-like data, not identified (hypothesis: font or map textures) | verified byte statistics only |
| 0x10FA150-0x19A446F | 52 scenes, each scene file immediately followed by its room files, contiguous, no gaps or overlaps | verified (`v2/census.txt` "file layout": first file 0x10FA150, last end 0x19A4470, gaps []) |
| 0x19A4470-0x1FFFFFF | 0xFF padding | verified |

Not present: `code`, overlays, `gameplay_keep`/`field_keep`/`dangeon_keep` and all other object files, skybox (`vr_*`) files, prerender JPEGs, and all audio. Retail places boot, dmadata, Audiobank/Audioseq/Audiotable, code and objects before the scenes. Verified by the map above: every upper-half byte is accounted for as UI textures, text or scenes. The file order differs from retail, where message data, code and objects sit between the UI textures and the scenes (compare `fs/oot-mqdbg-names.txt`).

### 11.3 How files are delimited

- **Scenes:** found by structure (`v2/alpha.py: find_scenes`). For every 4-aligned `04 nn 00 00 02 xx xx xx` room-list command, try header starts up to 24 commands back. Accept one when the room table (segment-2 offset relative to that start) lists `nn` ascending, non-overlapping absolute ROM ranges inside 0x1000000-0x19A4470, the first starting after the header, and when the command list is valid up to its `14 00 00 00 00 00 00 00` END. This finds exactly 52 scenes; together with their rooms they tile 0x10FA150-0x19A4470 without gaps. Verified.
- **Scene file end** = start of its first room. **Room files** = the room-list ranges, which are absolute ROM offsets: VROM == ROM, uncompressed. Verified (the rooms parse at those offsets).
- **Segments:** scene = segment 2, room = segment 3, as in retail. Verified (all pointers in headers and DLs resolve inside the file).
- **For the viewer:** since the ROM is identified by hash, a static table of the 52 scene start offsets (§11.4) is safe; running the structural scan as a check costs under 1 s in Python.

### 11.4 Level list

The scene table lived in `code` and is lost. The numbering is ROM order, which is also the numbering of the sw97 project's `z_scene_table.c` (**doc (sw97 project)**).
- **Col=**: share of the alpha scene's collision vertices found at identical coordinates in the retail counterpart (`v2/layoutcmp.txt`; retail = US 1.0, test maps = debug ROM).
- **Tex=**: share of the alpha room textures found byte-identical in any debug-ROM file (`v2/texcmp.txt`).
- **Mesh**: room mesh types. 1 = prerendered background (raw RGBA16, see §11.5).

| id | display name (proposed) | sw97 name | ROM range | rooms | mesh | retail counterpart | Col= | Tex= | status |
|---|---|---|---|---|---|---|---|---|---|
| 00 | Fstdan (test dungeon) | fstdan | 10FA150-116BF80 | 10 | 0 | none | – | 0% | absent from retail; leak `Fstdan_SCENE/ROOM0-9` data share 80-94% of 32-byte windows (leak) |
| 01 | Dodongo's Cavern (1997) | dodongos_cavern | 116BF80-11D7CA0 | 10 | 2 | ddan (17 rooms) | 8% | 18% | older version, same overall topology |
| 02 | syotes (test) | syotes_old | 11D7CA0-11E6860 | 1 | 0 | syotes (debug) | 100% | 81% | test map, geometry as in debug ROM |
| 03 | syotes2 (test) | syotes2_old | 11E6860-11F2C30 | 1 | 0 | syotes2 (debug) | 100% | 71% | test map |
| 04 | test01 (test map) | test_map | 11F2C30-1200B10 | 1 | 0 | test01 (debug) | 99% | 33% | test map; leak `Test01_BAK` 85-97% (leak) |
| 05 | Deku Tree, unfinished | unfinished_deku_tree | 1200B10-1209B40 | 1 | 0 | none | 0% | 0% | absent from retail (name: sw97) |
| 06 | Gohma room, unfinished | unfinished_gohma | 1209B40-1213480 | 1 | 0 | ydan_boss? | 0% | 0% | absent from retail (name: sw97) |
| 07 | depth_test (prerendered) | old_depth_test | 1213480-125EE70 | 1 | 1 | depth_test (debug) | 100% | – | test map; background image present |
| 08 | Item shop (prerendered) | i_shop | 125EE70-12875B0 | 1 | 1 | none (not shop1/kokiri_shop: 0%) | 0% | – | absent from retail; background present (stone-floored shop) |
| 09 | Hyrule Field (Spaceworld 97) | hyrule_field | 12875B0-12B1C30 | 1 | 2 | spot00 | 36% | 41% | demo version; 1 scene + 1 room alternate header (night) |
| 0A | Kakariko Village (old) | old_kakariko_village | 12B1C30-12D2DF0 | 1 | 0 | spot01 | 0% | 0% | different layout |
| 0B | Graveyard (old) | old_graveyard | 12D2DF0-12E8A70 | 1 | 0 | spot02 | 0% | 0% | different layout |
| 0C | Lost Woods (old) | old_lost_woods | 12E8A70-130C490 | 1 | 2 | spot10 (10 rooms) | 0% | 21% | one open area instead of the room maze |
| 0D | Kokiri Forest (1997) | kokiri_forest | 130C490-1335A90 | 1 | 0 | spot04 (3 rooms) | 51% | 38% | older version; leak `Spot04_OLD` is a related but different revision (38% of room windows) |
| 0E | Sacred Forest Meadow (old) | old_sacred_forest_meadow | 1335A90-133CD40 | 1 | 2 | spot05 | 0% | 0% | different layout |
| 0F | Lake Hylia (old) | old_lake_hylia | 133CD40-1356E50 | 1 | 2 | spot06 | 0% | 0% | different layout |
| 10 | Zora's River (old) | old_zoras_river | 1356E50-135D420 | 1 | 2 | spot03 | 0% | 0% | different layout |
| 11 | Pond (unknown) | old_pond | 135D420-1366200 | 1 | 0 | none found | – | 12% | absent from retail |
| 12 | Gerudo Valley (1997) | gerudo_valley | 1366200-138EFC0 | 1 | 2 | spot09 / spot12 | 0% | 32% | textures from `object_spot09_obj`/spot09/spot12; leak `Spot12_OLD(ver2)` rooms share 11-14% |
| 13 | Hyrule Castle (1997) | hyrule_castle | 138EFC0-13A8AA0 | 1 | 2 | spot15 | 11% | 30% | path layout recognisably the same, geometry rebuilt |
| 14 | Death Mountain Trail (1997) | death_mountain_trail | 13A8AA0-13C2D50 | 1 | 2 | spot16 | 70% | 36% | close to retail |
| 15 | Death Mountain Crater (1997) | death_mountain_crater | 13C2D50-13E4860 | 1 | 0 | spot17 | 0% | 3% | same star-shaped outline, different geometry |
| 16 | Unknown 0x16 | unk_0x16 | 13E4860-13E74B0 | 1 | 0 | ? | – | 0% | absent from retail |
| 17 | Unknown 0x17 | unk_0x17 | 13E74B0-13F4780 | 1 | 0 | ? (HIDAN textures) | – | 20% | absent from retail |
| 18 | Market, prerender placeholder 1 | pr_market_1 | 13F4780-13F8FC0 | 1 | 0 | market_day | 8% | – | untextured placeholder geometry; background image absent |
| 19 | Market, prerender placeholder 2 | pr_market_2 | 13F8FC0-13FC0C0 | 1 | 0 | market_day | 6% | – | as above |
| 1A | Fire Temple (1997) | fire_temple | 13FC0C0-1516950 | 14 | 0 | HIDAN (27 rooms) | 3% | 22% | different layout |
| 1B | Forest Temple (1997) | forest_temple | 1516950-160BB40 | 18 | 2 | Bmori1 (23 rooms) | 3% | 29% | different layout; leak `Bmori1_OLD(ver2)` rooms 7-9 share ~8% |
| 1C | Archery range | archery | 160BB40-161B1E0 | 1 | 2 | none (not syatekijyou) | 0% | 0% | absent from retail ("archery test map": doc VGC) |
| 1D | sasatest (test) | old_sasatest | 161B1E0-16225B0 | 1 | 0 | sasatest (debug) | 100% | – | test map |
| 1E | Behind Temple of Time, prerender placeholder | pr_behind_tot | 16225B0-1624320 | 1 | 0 | ? | – | – | untextured placeholder; background absent |
| 1F | testroom (test) | old_testroom | 1624320-16336C0 | 4 | 0 | testroom (debug, 5 rooms) | 72% | 94% | test map, older revision |
| 20 | Inside the Deku Tree (1997) | deku_tree | 16336C0-16AA080 | 14 | 2 | ydan (12 rooms) | 0% | 13% | different layout |
| 21 | Jabu-Jabu test | jabu_test | 16AA080-16AD480 | 1 | 0 | none | – | 0% | absent from retail |
| 22 | Chamber of Sages (1997) | chamber_of_sages | 16AD480-16BF4E0 | 1 | 0 | kenjyanoma | 29% | 5% | older version |
| 23 | Temple of Time exterior, prerender placeholder | pr_outside_tot | 16BF4E0-16C36C0 | 1 | 0 | shrine | 0% | – | untextured placeholder; background absent |
| 24 | Great Fairy Fountain (1997) | fairy_fountain | 16C36C0-16D0CC0 | 1 | 0 | yousei_izumi_tate | 27% | 12% | older version |
| 25 | Temple of Time (1997) | temple_of_time | 16D0CC0-16E1C10 | 1 | 0 | tokinoma (2 rooms) | 0% | 60% | different layout, retail textures |
| 26 | Forest Temple room, unfinished | unfinished_forest_temple | 16E1C10-16ECFE0 | 1 | 0 | none | 0% | 100% | absent from retail |
| 27 | lod_test | lod_test | 16ECFE0-16EED40 | 1 | 0 | none | – | 0% | test map (2 triangles) |
| 28 | sutaru (test) | old_sutaru | 16EED40-16F6BA0 | 1 | 0 | sutaru (debug) | 100% | 100% | test map; leak `Sutaru` 91-94% |
| 29 | Fire Temple rooms, unfinished | unfinished_fire_temple | 16F6BA0-1733F00 | 3 | 0 | none | 0% | 33% | absent from retail |
| 2A | Link's House (prerendered) | pr_links_house | 1733F00-175B4C0 | 1 | 1 | link_home | 23% (85% within 16 u) | – | background present |
| 2B | Kokiri house 1 (prerendered) | pr_kokiri_house_1 | 175B4C0-17856A0 | 1 | 1 | kokiri_home | 4% | – | background present |
| 2C | Unknown 0x2C | unk_0x2C | 17856A0-1789C10 | 1 | 0 | ? | – | 50% | absent from retail |
| 2D | Hyrule Field (older) | old_hyrule_field | 1789C10-17C6920 | 1 | 2 | spot00 | 0% | 0% | older, very different map; no actors |
| 2E | Unknown 0x2E | unk_0x2E | 17C6920-17D3120 | 1 | 2 | ? (mori textures) | – | 40% | absent from retail |
| 2F | Water Temple (1997) | water_temple | 17D3120-18C2CA0 | 18 | 0 | MIZUsin (23 rooms) | 0% | 27% | different layout |
| 30 | Kokiri house 2 (prerendered) | pr_kokiri_house_2 | 18C2CA0-18EE2C0 | 1 | 1 | kokiri_home3 | 0% | – | background present |
| 31 | Grotto (1997) | grottos | 18EE2C0-18F9B10 | 1 | 2 | kakusiana (14 rooms) | 68% | 36% | one grotto |
| 32 | Gerudo Training Ground (old) | poe_race | 18F9B10-197D860 | 11 | 2 | men (11 rooms) | 12% | 25% | older version. sw97 calls it "poe_race"; leak `Men_OLD(ver2)` rooms 0/4 share 26-31% and it uses `object_menkuri_objects` textures |
| 33 | Market Entrance (prerendered) | unk_0x33 | 197D860-19A4470 | 1 | 1 | entra | 42% (92% within 16 u) | – | background present |

Totals: 52 scenes, 145 rooms (mesh types: 74 type 0, 65 type 2, 6 type 1), 64,140 triangles. Alternate headers occur only in scene 0x09 and its room. Verified (`v2/scene_summary.txt`, `census.txt`).

**Sidebar proposal:** groups in this order (ids in ROM order within a group), `LevelKind` in brackets:
- **Overworld** [hub]: 09, 2D, 0D, 0C, 0E, 0A, 0B, 0F, 10, 11, 12, 13, 14, 15, 1C.
- **Dungeons** [adventure]: 20, 01, 1B, 1A, 2F, 32, 00.
- **Interiors and prerendered** [other]: 25, 22, 24, 31, 08, 2A, 2B, 30, 33, 18, 19, 1E, 23.
- **Unfinished and unknown** [other]: 05, 06, 26, 29, 16, 17, 2C, 2E.
- **Test maps** [other]: 02, 03, 04, 07, 1D, 1F, 21, 27, 28.

Scene 0x09 gets a "Night" choice (alternate header 1) in the View panel. Names marked "(name: sw97)" are the sw97 project's guesses; say so in the UI info panel.

### 11.5 Formats compared with retail OoT

#### Scene header commands
Same command ids and 8-byte layout as retail (`include/scene.h`). Verified: every header of all 52 scenes and 145 rooms parses with the retail layout, and all pointers resolve (`census.txt`, "command usage").

| cmd | alpha use (main headers) | payload | difference from retail US 1.0 (retail usage from `scene-oot/census-oot-us10.txt`) |
|---|---|---|---|
| 00 player entries | 52/52 | 16-byte ActorEntry | same |
| 01 actor list | 1 scene (0x17, 1 actor 0x0013) | same | retail uses 01 in scene headers only in alternate headers |
| 03 collision | 52/52 | header 0x2C | same header; **waterbox differs** (below) |
| 04 room list | 52/52 | 8-byte {romStart, romEnd} | same layout; the values are absolute ROM offsets |
| 06 spawn list | 52/52 | 2-byte entries | same |
| 07 special files | 38/52 | b1 = Navi message file (always 0), data = keep object (2 = field_keep, 3 = dangeon_keep) | retail 93/101 |
| 0E transition actors | 9/52 | 16-byte | same layout |
| 0F env light settings | 52/52, 1-13 entries | 22 bytes (ambient, dir1, col1, dir2, col2, fog, blend<<10 &#124; fogNear, zFar) | same (values plausible, e.g. fogNear 0x3E0, zFar 12800) |
| 11 skybox settings | 52/52 | byte 4 skyboxId, 5 config, 6 envLightMode | same layout. Ids used: 0, 1, 2, 5, 6, 7, 8, 9, 10, 12, 13. The prerender scenes agree with retail enum values where comparable (Link's house 7 = `SKYBOX_HOUSE_LINK`, market 9 = `SKYBOX_MARKET_CHILD_DAY`); 6, 8, 12, 13 are unused/unset slots in retail (hypothesis: early house/shop panoramas) |
| 13 exit list | 25/52 | u16 | same |
| 15 sound settings | 34/52 | b1 specId, byte 6 nature ambience, byte 7 seq id | same layout; retail always present. Seq ids agree with retail names where checkable: 0x02 field (Hyrule Field), 0x1C inside Deku Tree (deku_tree), 0x1D market (pr_market_1), 0x1F Link's house (houses) (doc `include/tables/sequence_table.h`) |
| 18 alternate headers | 1 (0x09) | seg-2 pointer list | same |
| 0D paths, 17 cutscene, 19 misc | never | – | retail: 19 in all 101 scenes, 0D in 30, 17 in alt headers. A loader must not require 19. |

#### Room header commands
Same ids and layouts: 16 echo (byte 7), 08 behavior, 12 skybox disables (bytes 4-5), 0A mesh, 0B objects, 01 actors, 10 time (hour, minute, speed), 05 wind (x, y, z, strength). Verified (`census.txt`). Differences:
- **09** (no payload) appears in 19 alpha rooms; never in retail US 1.0 rooms.
- **16 echo** is missing in those same 19 rooms.
- **10 time** appears in only 33 of 145 rooms (retail: all 388).
- **18 alternate headers**: 1 room.

#### Mesh (room shape) headers
| type | alpha | retail | evidence |
|---|---|---|---|
| 0 | 74 rooms; {n, entries, entriesEnd}, 8-byte {opa, xlu} | same | verified |
| 2 | 65 rooms; 16-byte {center, radius, opa, xlu} | same | verified |
| 1 single | 6 rooms (0x07, 0x08, 0x2A, 0x2B, 0x30, 0x33): header 0x20 with `width=0x140 height=0xF0 fmt=0 siz=2`. `source` points to a **raw RGBA16 320x240 image** (0x25800 bytes) filling the end of the room file. | retail: `source` is a JPEG (scene-oot census: all 35 prerender images are 320x240 JPEG) | verified: room sizes minus source offset = 0x25800 exactly; the decoded image is a coherent picture (`renders/a08_i_shop_bg0_room0.png`) |
| 1 multi | never | 5 retail rooms | verified |

In 0x07 `old_depth_test` the header has `unk_0C = 0x03000030` and `tlutCount = 0x10`; the other five have 0 there.
Scenes 0x18, 0x19, 0x1E and 0x23 (sw97 "pr_" names) have type-0 meshes with untextured, flat-coloured placeholder geometry; their background images are not in the ROM (doc: sw97 README says it recreated those prerenders).

#### Display lists
- **Microcode: F3DEX 1.x opcode numbering**, not retail's F3DZEX/F3DEX2. Verified: bytes at 0x11F2BE8 are `06000000 03001B50 … B8000000`, and a census walk of all room meshes (`census.txt`, "F3DEX census") meets only these opcodes: 01 MTX 36, 04 VTX 8188, 06 DL 487, B0 BRANCH_Z 2, B1 TRI2 25758, B4 RDPHALF_1 2, B6/B7 geometry mode, B8 ENDDL, B9/BA othermode, BB TEXTURE, BE CULLDL 554, BF TRI1 12624, E6 LOADSYNC, E7 PIPESYNC, F2 SETTILESIZE, F3 LOADBLOCK, F5 SETTILE, FA PRIM, FC COMBINE, FD SETTIMG. No unknown opcodes. Also doc: sw97's ZAPD uses `DListType::F3DEX` for `ZGame::OOT_SW97` (`sw97/tools/ZAPD/ZAPD/ZDisplayList.cpp:31`).
- `displaylist.ts` handles every opcode seen with `ucode: 'f3dex'`; CULLDL falls to the no-op default. Verified by the offline renders below.
- **Vertices:** 16-byte Vtx, segment 3 only. With G_LIGHTING set, bytes 12-14 are a normal: 17,596 of 64,140 triangles, mostly in outdoor areas (dungeons 0%). Verified (census `lit`).
- **Textures:** loaded with the retail `gsDPLoadTextureBlock` sequence (SETTIMG, SETTILE tile 7, LOADSYNC, LOADBLOCK, PIPESYNC, SETTILE tile 0, SETTILESIZE); 1,122 LOADBLOCKs have lrs capped at 2047.
  - Formats: RGBA16 2571, IA16 58, I4 49, I8 32, IA8 24, IA4 11 (per SETTILESIZE).
  - **No CI textures at all**: no LOADTLUT, TEXTLUT always 0. Retail rooms use CI4/CI8 heavily (e.g. retail ydan: 90 of 109 textures CI8).
  - Sizes: 8x16 to 128x64; no texture exceeds 4 KB (0 of 1,703).
  - Segments: SETTIMG 2 (953) / 3 (1791); one segment-4 reference in 0x2C.
  - Verified (`census.txt`; the ">4KB" check was run in this session).
- **Animated materials / dynamic segments:** DL calls into segments 8 (19), 9 (14), 0xA (2) and 7 (1), in 0x01, 0x09, 0x0C, 0x0D, 0x12, 0x13, 0x15, 0x1A, 0x20, 0x25, 0x2F, 0x31 and 0x2C (segment 7). In retail these segments are set by per-scene draw configs in `code` (lost). A viewer must treat them as unresolved (skip the call). sw97's `gSceneTable` assigns guessed draw configs (e.g. hyrule_field 1, kokiri_forest 10, deku_tree 3): **doc (sw97 project)**, not original data.
- **Keep objects:** `07` names field/dangeon keep, and one texture is in segment 4; none of these files exist in the ROM. Fallback: untextured (the interpreter already returns texture -1 when resolve fails).

#### Collision
- Header (0x2C), 16-byte polygons (the vertex-index flag bits are used as in retail: flags 1/2/3 present), 8-byte surface types (values like `00200000 000007C0`, `40000001 000007C2`, same bit meanings plausible) and bgCam entries: same as retail. Verified: parse and bounds are consistent; the collision of five test maps is byte-identical in geometry to the debug ROM's (100% vertex and polygon match).
- **WaterBox is 12 bytes in the alpha**, not 16: `s16 xMin, ySurface, zMin, xLength, zLength; u16 properties`. Verified: in 0x09 four boxes occupy exactly 48 bytes before the collision header; single boxes in 0x0D, 0x2F, 0x04 and 0x11 end 12 bytes before it.
- Properties seen: 0x0202, 0x0105, 0x0401, 0x0901, 0x1F01. **Hypothesis:** high byte = light index (0x1F = none, as retail `WATERBOX_LIGHT_INDEX_NONE`), low byte = bgCam index; no room field.

#### Actors and objects
- **Actor ids** (derived rule; sources `v2/idrule.txt`, `v2/sw97actors.txt`, `v2/actormap.txt`):
  - alpha id = retail id for 0x00-0x1F (20 ids confirmed);
  - 0x20 = En_Fish and 0x21 = En_Insect (swapped relative to retail);
  - 0x22 = Field_Keep and 0x23 = Dungeon_Keep, which exist only in the alpha;
  - **alpha id = retail id + 1 for 0x24-0x63** (44 ids confirmed, e.g. 0x24 En_Holl, 0x2F Door_Shutter, 0x30 En_Dodojr, 0x3F Bg_Treemouth, 0x4B Bg_Spot00_Hanebasi, 0x5F Obj_Syokudai);
  - 0x54 = En_Npc exists only in the alpha.
- **Evidence for the actor rule:**
  - (a) **doc (sw97 project)**: its committed, hand-edited scene C sources (`sw97/assets/scenes/**`) name 953 of 1,037 alpha placements at identical positions, 908 with identical params; mapping those names to retail indices gives delta 0 below 0x20 and +1 from 0x24;
  - (b) **verified independently**: alpha placements at positions identical to retail US 1.0 placements give 0x24→En_Holl 0x23, 0x2F→Door_Shutter 0x2E, 0x3C→En_River_Sound 0x3B, 0x3F→Bg_Treemouth 0x3E, 0x4B→Bg_Spot00_Hanebasi 0x4A (`actormap.txt`).
  - Reliability: high for the ids listed; ids above 0x63 are not used in the alpha. Five sw97 names break the rule (0x03 En_Ik, 0x0C Bg_Hidan_Curtain, 0x2B En_Light, 0x49 Demo_Im, 0x4A Bg_Hidan_Fwbig); treat them as sw97 substitutions, not identifications.
- **Object ids = retail object ids** for 0x06-0x55 (71 ids consistent, e.g. 0x0E object_box, 0x2B object_ddan_objects, 0x36 object_ydan_objects, 0x48 object_warp1). 0x04, 0x05, 0x10 and 0x11 are alpha-only (sw97 names object_skeleton, object_ironknack, object_slime, object_baby_skel). **Doc (sw97 project)** plus consistency with retail indices (`idrule.txt`).
- Actor-list placement layout: identical 16-byte entries. No object files are present, so a viewer can show actors only as labelled markers.

#### Environment
Env light settings and skybox commands as above. Skybox texture files are absent: the viewer should use the fog colour of light setting 0 as the clear colour.
Some outdoor scenes have zero light directions in setting 0 (0x0B, 0x0C, 0x0F, 0x10, 0x1C), so lit geometry comes out dark with ambient light only (hypothesis: the game picks another setting by time of day; `envLightMode` 0 vs 1).

#### Music and sound
- No audio data: no Audioseq/Audiobank/Audiotable, which retail stores at the start of the ROM, in the overwritten half. Verified by the §11.2 map; doc: VGC 2021 ("no music files").
- Only the per-scene command 15 (seq id + nature ambience id) survives; seq ids follow retail numbering where checkable (above).
- The viewer should offer no music for this ROM.

### 11.6 Rendering

- **Pipeline:** `v2/render/render.py` builds jobs (scene file = segment 2, room file = segment 3, all mesh DLs of the main header, lighting from env setting 0). `export.ts` runs them through the viewer's `runDisplayList` (`ucode 'f3dex'`, `vertexScale 1`, `mirrorX false`, `combiner`, `decals`, `textureGen`). `raster.c` is a z-buffered, perspective-correct, near-clipped rasterizer with bilinear textures and back-face culling (CCW front). Views: top-down orthographic, three-quarter overview, and player entry 0 (eye 260 units behind and 110 above).
- **Two module variants:**
  - `--repo`: `/home/n64/nviewer/src/rom/displaylist.ts` as it is now;
  - default: `v2/dl/` = copies of the repo's `displaylist.ts`, `texture.ts`, `types.ts`, `util.ts` taken at 13:25 today (the repo's `displaylist.ts` gained an `'f3d'` path since), patched with `directTextures`: the texture is the SETTIMG image itself, sized by render tile 0 and SETTILESIZE, read without the 4 KB texture memory.
- **Texture check** (`v2/render/dbg/texverify.ts`): against a straight decode of the image bytes, the patched path matches all 1,554 RGBA16 textures of all rooms; the repo module mismatches 5 (all 32x32, in 0x01, 0x09, 0x0D, 0x13; loaded with the normal LOADBLOCK sequence; mechanism in the tile-memory emulation not traced). Verified.
- **Result:** every scene decodes and renders without errors or magenta (unknown-format) textures (`v2/render/run-alpha.log`). Visually checked (contact sheets): textured, correct winding, recognisable areas (Kokiri Forest ladder and treehouse, Temple of Time checker floor, Dodongo's Cavern lava hexagons). Retail counterparts rendered with the same pipeline (`ucode 'f3dex2'`) look consistent (`run-retail.log`).
- **Known render limitations (research renderer, not ROM problems):** dynamic segments 7-0xA skipped; flat lighting from setting 0 (dark scenes as noted); no fog, skybox or actors.
- **Not done:** comparison with Spaceworld 97 footage or sw97 screenshots. The TCRF overdump pages could not be fetched (anti-bot page); sw97's `images/` holds only box art.

| render | what |
|---|---|
| `alpha/renders/sheet_alpha.png`, `sheet_alphatop.png`, `sheet_alphastart.png` | all 52 scenes: overview / top / start view |
| `alpha/renders/sheet_retail.png` | 21 retail US 1.0 counterparts, overview |
| `alpha/renders/pairs_top_1.png`, `pairs_top_2.png`, `pairs_overview_{1,2}.png` | alpha (left) vs retail (right), same pipeline, 20 pairs |
| `alpha/renders/aXX_<name>_{top,overview,start}.png` | per scene; `_repo` suffix = unmodified repo module |
| `alpha/renders/aXX_<name>_bgN_roomN.png` | decoded RGBA16 prerender backgrounds (0x07, 0x08, 0x2A, 0x2B, 0x30, 0x33) |
| `alpha/renders/r_<retail>_*.png` | retail renders |

### 11.7 Content differing from retail (per level, concise)

The metrics are Col= and Tex= from §11.4; "layout" judgements are from the pair renders.
- **0x09 Hyrule Field (SW97):** outline similar to retail (36% collision shared). Actors in the day header: drawbridge (0x4B), two torches (En_Light 0x08), Field_Keep trees (0x22), three cuccos (En_Niw 0x19), a horse (0x3D), Ganondorf's horse (0x43) and Zelda's horse (0x5C) near the castle bridge. The night header (alternate 1) has blue ambient light (10,10,60), a different spawn and five 0x2B actors. Retail spot00 has no cuccos or horses there (doc: TechRaptor/VGC summaries).
- **0x2D Hyrule Field (older):** a different map (0% shared), no actors or objects.
- **0x0D Kokiri Forest:** half of the collision is shared, but the forest is smaller (one room vs three) and the Deku Tree meadow is joined to the village. 15 objects in alpha-only numbering ranges (0x4B-0x55: object_oe3-oe12, Kokiri NPC objects unused in retail).
- **0x0A, 0x0B, 0x0C, 0x0E, 0x0F, 0x10, 0x2D:** completely different layouts (0% collision, 0-21% textures). The Lost Woods (0x0C) is one open area with 136 actors instead of retail's 10-room maze.
- **0x12 Gerudo Valley, 0x13 Hyrule Castle, 0x14 Death Mountain Trail, 0x15 Crater:** recognisable shape, rebuilt geometry (castle 11%, trail 70%, crater 0% shared), partly retail textures.
- **Dungeons 0x01, 0x1A, 0x1B, 0x20, 0x2F, 0x32:** all older layouts with fewer rooms (10/14/18/14/18/11 vs retail 17/27/23/12/23/11). Only 0-12% of collision vertices are shared; 13-29% of textures are identical to retail (mostly the dungeon object texture files, e.g. `object_hidan_objects`, `object_mori_tex`, `object_blkobj`). Dodongo's Cavern keeps the retail topology (stair hall, lava hexagon room); Deku Tree, Fire, Forest and Water Temple are laid out differently (pair renders).
- **Absent from retail:** 0x00 fstdan (10-room dungeon), 0x05, 0x06, 0x26, 0x29 (unfinished rooms), 0x08 item shop, 0x11 pond, 0x16, 0x17, 0x1C archery range, 0x21 jabu_test, 0x2C, 0x2E.
- **Prerender interiors (0x08, 0x2A, 0x2B, 0x30, 0x33):** their backgrounds are present as raw RGBA16 images (no JPEG); the retail counterparts' backgrounds differ.
- **Test maps 0x02, 0x03, 0x07, 0x1D, 0x28:** geometry identical to the debug ROM. 0x04 and 0x1F are older revisions (99% / 72%). The actor placements all differ (0 position matches).
- **Formats absent in retail:** F3DEX lists, no CI textures, 12-byte waterboxes, raw prerender images, command 09 in rooms (§11.5).
- **UI data:** the item/place-name textures include items that are not in retail (Wind Medal, Soul Medal, Dark Etude). Their order is roughly the retail item list's. Verified by visual inspection only.

### 11.8 Emulator

No emulator request (`alpha/EMU-REQUESTS.md` not written). The upper half has no boot code or engine. The only runnable form is the sw97 project, which is not cheap:
- building it needs the MQ debug ROM, IDO recompilers and ZAPD;
- the prebuilt patch sits on mega.nz, which is not scriptable here;
- it runs a retail-based engine with recreated actors and prerenders, so its screenshots would not show original rendering.

### 11.9 Viewer mapping

- **Module:** a variant of the retail OoT loader, e.g. `src/rom/zelda/alpha.ts`. Game id `'oot-alpha'` (extend the `Game['id']` union in `types.ts`), title "Ocarina of Time (1997 prototype, F-Zero X cartridge)". Detection by md5/sha1 of the whole file, before the F-Zero X/other checks.
- **Shared with retail:**
  - scene/room header parser (commands identical; must not require 0x19, 0x15, 0x10, 0x16);
  - room mesh types 0/2;
  - collision header, polygon and surface parsing;
  - env light settings;
  - actor/transition/object list parsing;
  - segment resolution 2/3, with dynamic segments 7-0xD unresolved.
- **Alpha variant needed:**
  1. **level list:** no dmadata or scene table; use a static table of the 52 scene starts (§11.4) or the structural scan. Room lists are absolute ROM offsets, files raw;
  2. **DL microcode** `'f3dex'`, already supported by `displaylist.ts`;
  3. **textures:** use a direct-image path; the current 4 KB tile-memory emulation mis-decodes 5 of 1,554. No CI/TLUT handling needed;
  4. **waterbox** struct 12 bytes;
  5. **prerender backgrounds** type 1: raw RGBA16 320x240 → `Level.backdrop` texture, no JPEG decoder;
  6. **actor names:** a small table from the §11.5 rule (alpha→retail id), labelled as derived; markers only, since no object models exist;
  7. **no music.**
- **`types.ts` needs:** nothing beyond the retail Zelda additions (backdrop and markers already exist); the new Game id only.
- **Level extras:** View-panel setup choice for 0x09's alternate header; `clearColor` from fog colour; `camera` from player entry 0; for type-1 rooms show the backdrop plus the (mostly invisible) mesh.
- **Difficulty:** low once the retail OoT loader exists (about half a day). The only new code is the static level table, the waterbox size switch and the RGBA16 backdrop; the DL interpreter works as is apart from the texture-path fix it shares with retail.

### 11.10 Verification evidence

| claim | method |
|---|---|
| hashes, byte order, header | md5sum/sha1sum, xxd 0x0-0x40 |
| Zelda data ends 0x19A4470, then 0xFF | block scan of upper half; last room end from census |
| no build string / Yaz0 / scene table / dmadata | grep -abo over the whole file; u32 search for all 52 scene starts |
| 52 scenes, 145 rooms, contiguous 0x10FA150-0x19A4470 | `v2/census.py` structural scan + file-layout check |
| message text, name textures | Shift-JIS decode at 0x10E0000; greyscale images in `v2/probe/` |
| F3DEX microcode | hex dump at 0x11F2BE8; opcode census over all meshes; sw97 ZAPD source |
| no CI textures, sizes ≤ 4 KB | census (0 LOADTLUT, TEXTLUT 0); per-texture size check |
| 12-byte waterbox | raw dumps: boxes end exactly at the collision header in 5 scenes |
| prerender = raw RGBA16 | room size − source offset = 0x25800 for all 6; decoded images coherent |
| test-map geometry = debug ROM | `v2/layoutcmp.py` (100% vertex/polygon identity) |
| per-scene retail similarity | `v2/layoutcmp.txt`, `v2/texcmp.txt` (byte-identical textures via hash index) |
| actor id rule | sw97 C sources by position (`sw97actors.txt`) + retail position matches (`actormap.txt`) → `idrule.txt` |
| object ids = retail | sw97 C object lists mapped to retail object_table indices (`idrule.txt`) |
| decoding works through the viewer interpreter | offline renders of all scenes via `displaylist.ts` (`renders/sheet_*.png`) |
| repo texture path mis-decodes 5 textures | `v2/render/dbg/texverify.ts`, patched vs repo vs raw decode |
| sw97 baserom = overdump files | `v2/sw97diff.py`: 185 identical, 10 differ in one byte, 2 absent (gerudo_valley) |
| leak correspondences | 32-byte window matching of leak `.o` data (`leakcmp/`), symbol names via `mips-linux-gnu-nm` |

### 11.11 Open questions

1. Exact build/date: nothing in the ROM. sw97 and press say Spaceworld 1997 (Nov 1997); only the Hyrule Field alt/day setup ties it to the demo.
2. Identity of 0x16, 0x17, 0x2C, 0x2E, 0x11 and the "unfinished" scenes; names for 0x05/0x06 are sw97 guesses.
3. Waterbox properties bit layout (hypothesis in §11.5).
4. Draw configs (animated material segments 7-0xA) are lost; which textures scroll is unknown (sw97 guesses are not evidence).
5. Which light setting the alpha used by default (several outdoor settings 0 have zero directions).
6. The content of 0x1000000-0x1014000 and 0x10ED200-0x10FA150 is not identified; it does not matter for levels.
7. Why the repo module's tile-memory emulation mis-decodes 5 32x32 textures (a stale texture-memory cache is suspected, not traced); relevant to retail OoT too.
8. No comparison with Spaceworld 97 footage yet (TCRF not reachable from here; screenshots not fetched).

## 12. Open questions and hypotheses

Cross-area items first, then the open questions of each area.

- **Texture memory in `displaylist.ts`:** both the scenes and the alpha work found that the 4 KB tile-memory emulation
  mis-decodes Zelda textures (retail: textures above 4 KB; alpha: 5 of 1,554 textures of at most 4 KB, mechanism not
  traced). The direct image fetch fixes both; whether other games in the viewer rely on the tile-memory behaviour
  should be checked before changing the default (keep it behind an option).
- **Actors in renders:** the transform, scales, half-day filtering and the set pieces in the captured views are verified
  by render (§6.5); MM degree rotations and most small props were not in a view that tests them (§12.3).
- **Naming:** OoT area names are title-card textures, not text; MM debug PAL's message table layout was not located.
  English names for untitled scenes are documented or proposed names.
- **Time-of-day variants:** dawn, dusk and night lights, skies and draw-config night lists are implemented from the
  decomps; night/dusk captures exist only where §10 lists them.
- **Alpha:** no comparison with Spaceworld 1997 footage; several scene names are the sw97 project's guesses (§11.11).

### 12.1 Filesystem and levels

- MM debug PAL English message table layout (only needed if names should come from that ROM itself).
- OoT English names could be shown as the title-card textures (US ROM, `g_pn_*` files) instead of decomp names; format not
  examined.
- The content of the MM debug placeholder scene (dmadata 1559) is not examined (it may be a test map).

### 12.2 Scenes and environment

1. OoT room lists with `G_MTX` on segments 0 and 3 (101 each, US census): which scenes and what they load.
2. Night-only display lists of SDC 1/14 (Hyrule Field, Death Mountain Trail): addresses are in code instructions; confirm
   per version (a Hyrule Field night capture would show the night list; see item 8).
3. Jabu-Jabu segment 0xD matrix: best static value (identity vs the game's first frame, y scale ≈ 0.12).
4. MM positional room lights (ROOM_BEHAVIOR bit 11, command 0x0C): how much they change the look.
5. MM environment tables in code (sky configs, sky colours, light configs): ROM offsets for a loader not located yet
   (values verified via RAM).
6. 256 skyboxes: only Link's House rendered; the file ↔ id list for the remaining ids comes from the spec order and sizes
   (TTVR/FCVR indices after 1000 not checked); which scenes use which id is in the scene headers (§4.4 scene list).
7. Remaining Termina Field differences (spires, ground) — animation phase or a combiner detail.
8. Dusk (light-entry and sky-texture blends) and midnight are verified (Hyrule Field dusk, Kakariko night); dawn is
   not captured.
   A Hyrule Field night capture was not possible: Stalchildren attack Link at the spawn
   within 1-2 s, so there is no clean start camera. Night lights are therefore verified only indirectly, via Kakariko
   Village at midnight. The Kakariko night capture does not show a window with the swapped
   texture from the start position, so the night pointer of SDC 2 is still unverified.
9. MM Termina Field spires keep the same residual on debug PAL (so not a version issue).
10. MM alternate header meanings per scene (setups) for labelling variants (§4.2 lists the non-cutscene setups).

### 12.3 Actors

- MM degree rotations need a render check with an asymmetric static actor in view; pots, crates, bushes and rocks were
  drawn in Kakariko but hidden from the capture camera (placement unverified by render).
- Offsets of gameplay_keep display lists for each version (XML gives only lengths): derive from the decomp's version
  offsets file, by pointer scanning, or by sequential layout from the XML order.
- Which OoT actors hide themselves by age/time in init (for per-layer filtering beyond the room lists).
- Skeleton rest pose: bind pose vs frame 0 of each actor's idle animation (per-actor choice).

### 12.4 Music

1. **MM Termina Field** layers: the first-cycle layer 5 header plays the ambience sequence instead of field music (first capture); layer 0 plays sequence 2, verified in the second capture (§8.5). Which setups play which sequence is in §8.3.3.
2. **MM boot audio 8–27 s** before the title theme matches no sequence; possibly sound effects of the boot/opening
   (not a music track). A RAM dump in that window would settle it (request 2, low priority).
3. The code that sets OoT Market Entrance's BGM volume scale to 90/127 was not located in the decomp (the value is
   verified in RAM); other scenes may apply similar scales. A viewer should play songs at scale 1.0 (as composed).
   The Temple of Time exterior (no sequence in the scene header, seqId 0x7F) was not captured.
4. **rsp-hle vs RSP:** the FIR coefficient averaging in place (halving static tables), the ENVMIXER wet inversion
   values (−4/−2) and the missing book-offset commands are rsp-hle behaviour; real hardware may differ
   (hypothesis). The captures come from rsp-hle, and level matches with spec 10 low-pass reverbs support rsp-hle's
   behaviour for that emulator only.
5. Downsample-2 reverbs (OoT specs 7, 9, 14; MM spec 13) and leak settings are implemented from the decomp but no
   captured scene used them.
6. Headset (Haas) and MM surround modes, game-side volume scales and fades, and channel IO written by actors (Ganon's
   Tower, Saria's song distance) are not modelled.
7. Readable names: OoT uses community names (OoT Randomizer), MM enum names; an official name source was not found.
8. The cutscene START_SEQ scan is heuristic; code call sites are a grep of the decomp (doc) and may miss indirect
   uses.
9. MM debug PAL: the audio code uses PAL timing constants on a PAL console; a viewer should probably play all four
   ROMs with NTSC timing (the music data is the same) (hypothesis about the desired behaviour).
10. The alpha ROM has no audio data (§11.5, music and sound).

### 12.5 Alpha ROM

See §11.11.
