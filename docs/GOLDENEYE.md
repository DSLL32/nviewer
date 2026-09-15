# GoldenEye 007 — Nintendo 64 ROM format specification

This manual describes the shipped data formats needed to identify, extract, and
present GoldenEye 007 content. Claims state their evidence inline; unsupported
interpretations are labelled hypotheses.

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | Named file table with BG, setup, stan, model, texture, and sequence files. |
| Compression | `1172` tag followed by raw DEFLATE. |
| Graphics microcode | Rare Fast3D-family GBI with custom `TRI4` and texture commands. |
| Geometry | Room-based BG files with room-relative vertices. |
| Textures | Global numbered texture table with paletted and bitstream codecs. |
| Collision | Convex stan floor polygons plus setup pads. |
| Music driver | libultra `alCSPlayer`. |
| Audio microcode | Stock libultra audio task; exact ABI revision is not separately identified. |
| Sample encoding | Nintendo VADPCM. |
| Levels | Mission and multiplayer stages. |
| Memory requirement | Base 4 MiB. |
| Viewer support | USA revision 0. |

### 1.2 ROM identification

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| USA | `GOLDENEYE` | `NGEE` | 0 | 12 MiB (`0xC00000`) | `DCBC50D1` | `09FD1AA3` | `abe01e4aeb033b6c0836819f549c791b26cfde83` | CIC-6102 | Jun 29 1997 20:46:05 |

Verified from the normalized ROM headers and complete-image SHA-1 hashes.

### 1.3 Terminology and conventions

ROM and memory ranges are half-open. Offsets, addresses, encoded sizes, masks,
and opcodes are hexadecimal unless stated otherwise. Multi-byte CPU fields are
big-endian. RAM addresses are virtual unless explicitly identified as physical;
segmented, VROM, and file-relative addresses are named at each use.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

### 2.2 Memory and address mapping

### 2.3 ROM map and asset organization

### 2.4 Compression formats

### 2.5 Loading process

#### Loading a stage in the emulator (verified; `notes/warp.md`)

From any front-end screen or any running stage, with the debugger core:
`write 0x80048384 w {difficulty}` (optional), then `write 0x800242FC w {stage id}`. For multiplayer maps also write
`0x8002A8F0 w 1` and `0x8002B520 w 2` first (with one player the MP-only maps would ask for a solo setup that
doesn't exist). Tested: Facility, Dam (from inside Facility), Runway, Temple with 2 players (split screen), Dam on
007, and back to the front end. Loading Dam takes about 26 s of wall time in the headless emulator; every stage
opens with its intro fly-by. Ids without a text-bank case (all unused ids, including the Citadel's 0x28) hang in
`0x7F0C15E0` according to the disassembly; *Unused and hidden content* reports what happens when they are requested.

### 2.6 Revision differences

## 3. Level data

### 3.1 Level catalog and identifiers

#### Stages (verified from the tables; names from the title text bank)

| id | code | BG file | stan | solo setup | MP setup | in-game |
|---|---|---|---|---|---|---|
| 0x21 | dam | bg_dam | Tbg_dam | UsetupdamZ | – | Mission 1 Arkangelsk: **Dam** |
| 0x22 | ark | bg_ark | Tbg_ark | UsetuparkZ | Ump_setuparkZ | Mission 1: **Facility**; MP Facility (4 players, unlocked by part 1) |
| 0x23 | run | bg_run | Tbg_run | UsetuprunZ | – | Mission 1: **Runway** |
| 0x24 | sevx | bg_sevx | Tbg_sevx | UsetupsevxZ | – | Mission 2 Severnaya: **Surface** (part i) |
| 0x09 | sevbunker | bg_sev | Tbg_sev | UsetupsevbunkerZ | – | Mission 2 Severnaya: **Bunker** (part ii) |
| 0x14 | silo | bg_silo | Tbg_silo | UsetupsiloZ | – | Mission 3 Kirghizstan: **Silo** |
| 0x1A | dest | bg_dest | Tbg_dest | UsetupdestZ | – | Mission 4 Monte Carlo: **Frigate** |
| 0x2B | sevxb | bg_sevx (shared) | Tbg_sevx | UsetupsevxbZ | – | Mission 5 Severnaya: **Surface** (part i) |
| 0x1B | sevb | bg_sevb | Tbg_sevb | UsetupsevbZ | Ump_setupsevbZ | Mission 5 Severnaya: **Bunker** (part ii); MP Bunker (3, part 8) |
| 0x16 | statue | bg_stat | Tbg_stat | UsetupstatueZ | Ump_setupstatueZ (not in the MP menu) | Mission 6 St. Petersburg: **Statue** Park |
| 0x18 | arch | bg_arch | Tbg_arch | UsetuparchZ | Ump_setuparchZ | Mission 6: Military **Archives**; MP Archives (3, part 10) |
| 0x1D | pete | bg_pete | Tbg_pete | UsetuppeteZ | – | Mission 6: **Streets** |
| 0x1E | depo | bg_depo | Tbg_depo | UsetupdepoZ | – | Mission 6: **Depot** |
| 0x19 | tra | bg_tra | Tbg_tra | UsetuptraZ | – | Mission 6: **Train** |
| 0x25 | jun | bg_jun | Tbg_jun | UsetupjunZ | – | Mission 7 Cuba: **Jungle** |
| 0x17 | control | bg_arec | Tbg_arec | UsetupcontrolZ | – | Mission 7: **Control** Center |
| 0x27 | cave | bg_cave | Tbg_cave | UsetupcaveZ | Ump_setupcaveZ | Mission 7: Water **Caverns**; MP Caverns (3, part 16) |
| 0x29 | crad | bg_crad | Tbg_crad | UsetupcradZ | Ump_setupcradZ (not in the MP menu) | Mission 7: Antenna **Cradle** |
| 0x1C | azt | bg_azt | Tbg_azt | UsetupaztZ | – | Mission 8 Teotihuacán: **Aztec** Complex (secret) |
| 0x20 | cryp | bg_cryp | Tbg_cryp | UsetupcrypZ | Ump_setupcrypZ | Mission 9 el-Saghira: **Egyptian** Temple (secret); MP Egyptian (2, part 19) |
| 0x26 | dish | bg_dish | Tbg_dish | – | Ump_setupdishZ | MP **Temple** (4) |
| 0x1F | ref | bg_ref | Tbg_ref | – | Ump_setuprefZ | MP **Complex** (4) |
| 0x32 | oat | bg_oat | Tbg_oat | – | Ump_setupoatZ | MP **Caves** |
| 0x30 | ame | bg_ame | Tbg_ame | – | Ump_setupameZ | MP **Library** |
| 0x2D | imp | bg_ame (shared) | Tbg_ame | – | Ump_setupimpZ | MP **Basement** |
| 0x2E | ash | bg_ame (shared) | Tbg_ame | – | Ump_setupashZ | MP **Stack** |
| 0x36 | len | bg_len (0xFA0 bytes) | Tbg_len | UsetuplenZ | – | **Cuba**, the end-credits stage: the menu requests 0x36 after Antenna Cradle (`0x7F0168D8`) |
| 0x28 | cat | bg_cat (0x5530 bytes) | Tbg_cat | – | – | unused: the **Citadel** (*Unused and hidden content*) |
| 0x15, 0x2A, 0x2C, 0x2F, 0x31, 0x33-0x35, 0x37-0x39 | sevbunker (duplicate name), sho, eld, lue, rit, ear, lee, lip, wax, pam, bgx | empty or missing | | | | unused (*Unused and hidden content*) |
| 0x5A | – | – | – | – | – | front end: logos, intro, file select, menus |

Every mission stage has a briefing `Ubrief{code}Z` and a text bank named in *Text banks (verified)*. Solo folder part numbers,
which the unlock conditions use: 0 Dam, 1 Facility, 2 Runway, 3 Surface, 4 Bunker, 5 Silo, 6 Frigate, 7 Surface 2,
8 Bunker 2, 9 Statue, 10 Archives, 11 Streets, 12 Depot, 13 Train, 14 Jungle, 15 Control, 16 Caverns, 17 Cradle,
18 Aztec, 19 Egyptian.

**Multiplayer menu order** (verified from the table): Random, Temple, Complex, Caves, Library, Basement, Stack,
Facility, Bunker, Archives, Caverns, Egyptian. The title bank also holds "Citadel" (`0x9CAE`), which is not in
the table (*Unused and hidden content*). The MP names were checked against the tables and text only: the MULTIPLAYER menu item is greyed
out with one controller in the headless emulator.

**Suggested viewer list:** the 20 missions in folder order (grouped by mission, `group` = "Mission 1:
Arkangelsk" …), then the multiplayer-only maps (Temple, Complex, Caves, Library; Basement and Stack share
Library's BG and differ only in setup, so list them only if the viewer shows setup objects), then Cuba (credits)
and the Citadel under "Unused".

#### How the game selects and loads a stage (verified: disassembly and breakpoints)

- Globals: `0x800241A8` current stage; `0x800242FC` requested stage (−1 = none); `0x8002A8F4` stage chosen in the
  menu; `0x80048384` difficulty (0 Agent … 3 007); `0x8002A8F0` mode (1 = multiplayer); `0x8002B520` MP player
  count. `getPlayerCount()` (`0x7F010290`) returns the MP count in multiplayer mode, else 1.
- At boot the stage is 0x5A (the front end). A debug build could pass `-level_NN` (two decimal digits) and `-hard`
  on the command line (`0x700060AC`); retail has no command line.
- Main loop: clear players → allocate player slots → `stageLoad(current)` → run frames until the requested stage is
  ≥ 0 → tear down → current = requested, requested = −1 → repeat. The menu starts a mission with `0x7F016064`:
  `requestStage(menu stage)`, then `setDifficulty`.
- `stageLoad` (`0x7F0BDAB0`) resets globals, stops audio, initialises BG (`0x7F0B4124`), then `0x7F003BF0(stage)`
  loads the setup (`Usetup`, or `Ump_setup` with ≥ 2 players), the text bank, and every object file the setup names.
- **ROM reads while loading Dam** (breakpoints on `romCopy`, inflate and name lookup; `fs/trace_dam2.txt`):
  1. the 0x1400-byte table at `0x29D160` and a first batch of textures;
  2. both fonts;
  3. the `bg_dam_all_p.seg` header (0x40 bytes, then 0x4090 bytes);
  4. `Tbg_dam_all_p_stanZ`;
  5. about 380 BG room reads, each inflated, interleaved with texture reads;
  6. music sequence 9;
  7. `UsetupdamZ`, `LdamE`, then the characters, heads, props and weapons the setup names;
  8. once play starts: animation reads, Bond's body, head and weapon, and code-page faults.

#### Detection, game object, level list

- `src/rom/index.ts` `openRom()`: `case 'NGEE'` on the game code at 0x3B, after `normalizeByteOrder()`.
- `src/rom/types.ts`: extend `Game.id` with `'goldeneye'`. Existing `LevelKind`s suffice: `'campaign'` for missions
  (with `group` = "Mission 1: Arkangelsk" …), `'battle'` for multiplayer maps, `'other'` for Cuba (credits) and the
  unused Citadel.
- `LevelInfo.name` = in-game name from the title text bank (*Stages (verified from the tables; names from the title text bank)*); `Level.id` = internal code (`dam`, `ark` …).
  Order as suggested in *Stages (verified from the tables; names from the title text bank)*.

#### ROM, codec, files, levels

| check | method | result | evidence |
|---|---|---|---|
| boot and segments | disassembly of ROM 0x1000 at 0x70000400, the 0x7F code at 0x7F000000, the boot inflater | *Boot and code (verified by disassembly)* | `fs/code0.dis`, `fs/code7f.dis`, `fs/decomp.dis` |
| TLB paging | RDRAM at the menu: resident frames vs ROM pages, page-table entries | 40 resident pages identical to ROM | `fs/ram/menu_diff.bin` |
| 1172 codec vs game | breakpoint on the inflater `0x7F0CE7F0` and its return during a Runway load, dump each output | 60/60 outputs byte-identical to zlib | `fs/infverify.py`, `fs/inf_run/log.tsv` |
| every stream | full-ROM scan | 6,863 streams, all reach end-of-stream | `fs/streams.tsv` |
| viewer `inflate.ts` | `inflateRaw(rom, start + 2, 0)` over all streams vs Node zlib | 6,863/6,863 identical | `fs/ts/inflate_check.ts` |
| files | `fs/extract.py` | 681 compressed files, all end-of-stream | `fs/index.json` |
| stage load order | breakpoints on `romCopy`, inflate and name lookup while starting Dam | *How the game selects and loads a stage (verified: disassembly and breakpoints)* | `fs/trace_dam2.tsv` |
| stage globals and warps | RAM writes; screenshots | Facility, Dam, Runway, Temple (2 players), Dam on 007, front end | `notes/warp.md`, `fs/shots/warp_test*.png` |
| names | text-bank decode vs screen | the difficulty page shows "Mission 1: Arkangelsk / Part i: Dam" (text ids `0x9C78`/`0x9C79`) | `fs/shots/menu_*.png` |

### 3.2 Level container

#### Tables (verified: data segment; generator `fs/levels/levels.py` → `fs/levels/levels.tsv`)

| table | address | layout |
|---|---|---|
| stage → solo setup name | `0x800374E4 + 4 × stage` | `char*` "Usetup{code}Z"; the MP name is built as `"Ump_" + name[1:]` when the player count ≥ 2 (`0x7F003D28`) |
| stage → BG / stan | `0x8004448C`, 38 × 24 bytes | `{u32 stage; char* bg; char* stan; f32 f0C, f10, f14}` (scales: *Units, scale, handedness, camera (verified)*) |
| stage → text bank | switch at `0x7F0C15E0` | stages without a case loop forever at `0x7F0C16DC` |
| stage → memory arguments | `0x800241BC` | `{u32 stage; char* args}`, e.g. `-ml0 -me0 -mgfx70 -mvtx50 -mt625 -ma275` |
| solo mission folders | `0x8002ABE4`, 28 bytes | `{char* label; u16 nameText; u16 altText; s32 stage; s32 mission; s32 isHeader; s32 partIndex; char* briefFile}`, header rows have stage −1, label 0 ends |
| multiplayer maps | `0x8002B074`, 12 × 24 bytes | `{u16 name; u16 nameCaps; s32 photo; s32 stage; s32 unlockAfterPart; s32 one; s32 maxPlayers}`, in menu order |

#### Portals and visibility (verified format; semantics partly hypothesis)

- **Portals:** 8-byte entries `{ptr polygon; u8 roomA; u8 roomB; u16 flags}`, ended by a zero pointer. Polygon =
  `{u8 n; 3 pad; n × f32 x, y, z}` in absolute BG space (e.g. Dam portal 0 joins rooms 134/133 with 4 points).
  Cradle and Cuba have no portals.
- **Visibility commands:** 8-byte `{u8 op; u8 arg; u16; u32 param}` until op 0; for op 0x64 the param is a
  segment-0x0F pointer. Most files hold only the terminator; Dam uses ops 04, 14, 1E, 1F, 20, 5A, 5C, 64, 65.
  Semantics not decoded (hypothesis: scripted visibility overrides). **A viewer draws every room** and can ignore
  portals and visibility.

#### Level assembly (`loadLevel`)

1. **Tables:** inflate the data segment once per ROM; read the stage tables (*Tables (verified: data segment; generator `fs/levels/levels.py` → `fs/levels/levels.tsv`)*), the environment tables (*Environment: fog, clear colour, sky (verified: disassembly and 12 captured frames)*), the
   texture table (*Textures (verified unless marked)*), the prop, character and item tables (*Model tables (verified: ROM data and code references)*).
2. **Space:** convert BG units to world units by ÷ f0C (*Units, scale, handedness, camera (verified)*), so every stage has the same scale. Keep right-handed Y-up
   with no mirroring; swap two indices per triangle for CCW-front culling.
3. **World geometry:** one `Mesh` per room ("room N", `info` = room number, file offsets) with primary batches and then
   secondary batches; one `Instance` per room with the identity matrix (the room position is baked into vertices through
   `vertexOffset`). Rooms can form a `LevelLayer` of kind 'main'. Set `cullBack = false` on every BG batch and
   `decal` from ZMODE_DEC; the renderer should draw batches without depth test before the depth-tested ones (*Render state (verified: frame DLs of 13 captures and game-camera composites)*).
4. **Objects:** parse the setup (`Usetup` for missions, `Ump_setup` for multiplayer-only maps), build each shown model once
   per model number (rest pose, LOD near = 0, root translation ignored), then one `Instance` per record with the *Placement (verified against RAM on 8 stages, 1,299 objects)*
   matrix (multiplied by 1/f0C when working in BG units). Guards: body + head posed with the sampled pose table.
   Layers "objects", "guards", "pickups"; markers for spawns and gas volumes.
5. **Environment:** `fog` from table A (omit for table-B stages); `clearColor` = record colour; sky (*Additions to `src/rom/types.ts` and the renderer*) when the sky
   flag is set; Frigate water.
6. **Camera:** the first set-0 spawn pad; eye = floor under the pad + 167.28 world units, target along the pad look,
   `fovY` 60 (*Units, scale, handedness, camera (verified)*, *Spawn camera (verified on 12 stages)*; floor from the stan file, *Clipping ("stan") files and floor height (verified: all 26 regular non-empty files; RAM on 14 captures; code)*).
7. `unplaced`: prop models no record references are not loaded, so nothing is listed there. Basement and Stack reuse
   Library's meshes with their own setups.

### 3.3 Geometry

#### BG file (verified on all 25 non-empty files: ROM data and the loader `0x7F0B4124`)

- `bg/bg_{code}_all_p.seg` is stored raw. Every pointer in it is **segment 0x0F, file-relative** (`0x0F000014` =
  offset 0x14). The loader reads the 0x40-byte header, relocates with `ptr + load − 0x0F000000`
  (`0x7F0B41FC..0x7F0B4214`) and inflates rooms on demand (`0x7F0B5FAC` → `0x7F0CE7F0`).
- **Header:** `+0 u32 0; +4 ptr rooms; +8 ptr portals; +C ptr visibility commands; +10 u32 0`.
- **Room table** (at +0x14 in every file), 0x18-byte entries:
  ```
  +00 ptr vertices      ; 11 72 + DEFLATE → N64 Vtx array (16 bytes: s16 x,y,z; u16 flag; s16 s,t; u8 r,g,b,a)
  +04 ptr primaryDL     ; 11 72 + DEFLATE → opaque display list
  +08 ptr secondaryDL   ; 11 72 + DEFLATE → translucent display list, or 0
  +0C f32 x, y, z       ; room position
  ```
  Entry 0 is all zero (room numbers start at 1). The **last entry is a sentinel** holding the end of the vertex
  region and the file end twice, so a stream's compressed size is the difference of consecutive pointers.
- **Vertices are room-relative:** BG position = vertex + room position. Verified: the game's runtime room bounding
  boxes (RAM `0x80041414 + room × 0x50`, +0x38..+0x4C) equal the vertex + position box for 83 of 136 Dam rooms and
  contain it for the rest; vertex-only boxes don't fit. The per-room modelviews in frame DLs confirm it (*Units, scale, handedness, camera (verified)*).
- Runtime room records (RAM `0x80041414 + room × 0x50`): `+0 flags (0x01000201 loaded); +4 vertices (identical to the
  inflated stream); +8 expanded primary DL; +C secondary DL; +10..+18 compressed sizes; +1C inflated vertex size;
  +38 f32 min xyz, max xyz`. The game resolves segment 0x0E to the room's vertices (`0x7F0BB694`).

#### Building meshes, renders and comparisons

**Mesh building** (prototype `bg/lib/gebg.ts`, with the patched `bg/lib/displaylist.ts`, `bg/lib/getex.ts` and
`bg/lib/sky.ts`):
1. Parse the header and room table; for rooms 1..n inflate the vertex, primary and secondary streams.
2. Put each room's DLs and vertices in one buffer; resolve `0x0E000000 + o` to the vertex block and segment-0 offsets
   to the DL.
3. `runDisplayList` with ucode `'f3d'`, `vertexOffset` = the room position, `vertexScale` 1 (BG units), `mirrorX: false`,
   `decals: true`, initial geometry mode G_ZBUFFER, and `rareTexture` resolving C0 to a decoded level-0 texture with
   the C0 wrap modes.
4. Swap two vertices per triangle; set `cullBack = false`. Primary batches, then secondary.
5. Convert to world units (÷ f0C) so placements, camera and environment line up (*Units, scale, handedness, camera (verified)*).

**Game-camera comparisons** (the BG agent viewed all; the lead viewed Frigate, Streets, Egyptian and the phase-1 Dam render). Each render uses the frame's own
projection, room matrices and scissors, and adds the *Environment: fog, clear colour, sky (verified: disassembly and 12 captured frames)* sky, fog and clear colour with bilinear filtering. Objects,
gun and HUD are not drawn. Composites are screenshot | render: `bg/renders/env/{stage}_final_composite.png`.

| stage | matches | differs |
|---|---|---|
| Dam | blue sky gradient and cloud shapes, cliffs, hazard barrier, red/white barriers, tunnel, gravel, fog darkening | gun/HUD only |
| Surface 1 | pink/orange clouds (with horizon offset 7), tree walls, road ruts, both snow banks | gun/HUD |
| Aztec | corridor walls, carved pillars, stairs, floor tiles | a dark doorway slot where the game shows a stone block (hypothesis: a door object) |
| Frigate | sky pixels equal within ±1, hull and railing, bow deck planks | the screenshot's water is brighter teal with a black wedge at the horizon; the render equals texel × shade computed from the frame's own RDP triangles, so these are Glide64 artefacts (hypothesis for hardware) |
| Streets | buildings, cornices, black window panes (decal fix), fence, door, brownish sky | gun/HUD, timer |
| Egyptian | pillar hall, translucent pool (ENV-alpha rule), back hall | gun/HUD |
| Runway | door frame, walls, floor tiles, sky colour | the shutter and barrels are objects (*Placement (verified against RAM on 8 stages, 1,299 objects)* covers them: `obj/renders/composite_runway.png`) |
| Jungle | ground shape, fog colour | trees, plants and Natalya are objects (`obj/renders/scene_jungle.png`) |
| Temple, 2 players | both split-screen viewports (`temple_mp2_final_composite.png`, `temple_mp2_p2_final_composite.png`): corridors, doorway, floor | weapons and radar |
| Facility (phase 1, no environment) | X-braced wall on the left, corridor on the right (`bg/renders/ark_gamecam_textured.png`) | point sampling, gun |

**Culling tests** (same cameras): the opposite winding rule shows cliff interiors on Dam, back faces on Facility and
loses the ground on Surface 1 (`bg/renders/test_*cull*.png`, `sevx_gamecam_textured_WRONGcull.png`), confirming
clockwise fronts. Culling with the correct rule still leaves the holes described in *Render state (verified: frame DLs of 13 captures and game-camera composites)* (`bg/renders/env/exp/`), so
BG is drawn double-sided.

**Viewer-style renders** (free camera, all rooms, fog, sky, clear colour): `bg/renders/env/viewer_dam_spawn.png`
(matches the game view from the spawn, plus a few sky-textured backdrop pieces above the cliffs, *Render state (verified: frame DLs of 13 captures and game-camera composites)*) and
`viewer_frigate_deck.png` (ship, helipad, mast, sky gradient, water fading to the horizon). Overviews of all 25 BG
files: `bg/renders/bg_{code}_{name}_overview.png` / `_top.png`. With objects and guards:
`obj/renders/overview_facility_guards.png`.

**Per-level statistics** (verified, `bg/scripts/stats.ts`; triangles as built, empty B1 slots skipped):

| BG | stage(s) | rooms | portals | triangles (primary / secondary) | vertices | textures |
|---|---|---|---|---|---|---|
| sev | Bunker 1 | 30 | 30 | 4,927 (4,671 / 256) | 8,498 | 62 |
| silo | Silo | 86 | 94 | 25,933 (23,693 / 2,240) | 43,328 | 74 |
| stat | Statue | 27 | 43 | 9,231 (7,737 / 1,494) | 17,390 | 134 |
| arec | Control | 91 | 141 | 13,862 (12,805 / 1,057) | 23,872 | 122 |
| arch | Archives | 65 | 103 | 10,957 (10,231 / 726) | 20,608 | 99 |
| tra | Train | 57 | 64 | 9,358 (8,238 / 1,120) | 16,321 | 62 |
| dest | Frigate | 58 | 94 | 16,677 (14,521 / 2,156) | 28,155 | 116 |
| sevb | Bunker 2 | 68 | 75 | 6,817 (6,175 / 642) | 12,625 | 69 |
| azt | Aztec | 92 | 95 | 11,342 (11,115 / 227) | 21,835 | 117 |
| pete | Streets | 18 | 61 | 5,964 (5,569 / 395) | 11,666 | 86 |
| depo | Depot | 89 | 118 | 13,594 (11,739 / 1,855) | 25,496 | 148 |
| ref | Complex | 44 | 60 | 2,512 (2,454 / 58) | 4,822 | 13 |
| cryp | Egyptian | 44 | 51 | 8,039 (7,971 / 68) | 14,688 | 12 |
| dam | Dam | 136 | 194 | 12,400 (11,348 / 1,052) | 21,722 | 74 |
| ark | Facility | 77 | 109 | 14,155 (13,625 / 530) | 25,493 | 82 |
| run | Runway | 17 | 27 | 2,991 (2,637 / 354) | 5,041 | 68 |
| sevx | Surface 1 and 2 | 39 | 101 | 8,100 (6,282 / 1,818) | 14,697 | 67 |
| jun | Jungle | 44 | 59 | 6,265 (4,414 / 1,851) | 10,618 | 62 |
| dish | Temple | 25 | 37 | 1,014 (1,014 / 0) | 1,697 | 5 |
| cave | Caverns | 63 | 76 | 10,707 (9,993 / 714) | 18,241 | 46 |
| cat | Citadel (unused) | 46 | 52 | 1,101 (1,101 / 0) | 1,968 | 3 |
| crad | Cradle | 36 | 0 | 5,031 (3,947 / 1,084) | 9,182 | 45 |
| ame | Library, Basement, Stack | 92 | 110 | 1,627 (1,605 / 22) | 3,142 | 11 |
| oat | Caves | 13 | 15 | 1,905 (1,905 / 0) | 3,018 | 1 |
| len | Cuba | 1 | 0 | 434 (434 / 0) | 712 | 7 |

1,013 distinct texture numbers are used by BG files.

#### Pitfalls

1. The last room-table entry is a sentinel, and entry 0 is empty.
2. Vertices are room-relative; without the room position every room piles up at the origin.
3. `B1` isn't F3DEX TRI2 (four 4-bit-index triangles); `BF` indices are ×10; `G_VTX` counts are 4 bits.
4. Texture entries aren't 1172 streams, and the table stores sizes, not offsets.
5. BG lists have no `G_SETTIMG`: textures come from `C0`, and the lists in RAM differ from those in ROM.
6. Don't mirror X; don't back-face cull BG.
7. Alpha comes from `FB` env alpha through the patched combiner, not from vertex alpha.
8. Decals need a depth offset.
9. Three spaces (BG, world = BG ÷ f0C, render = world × f10); pads are in BG units.
10. Game frames are letterboxed (320×220 at y 10) and multiplayer viewports are halves; the reference screenshots are
    Glide64 HLE, which differs from the RDP data on water.
11. The 0x7F game code is demand-paged: disassemble it from ROM, never from RAM.

### 3.4 Display lists and render state

#### Display-list microcode (verified: opcode histogram over every stored list, disassembly, frame DLs)

The graphics microcode is **Fast3D 2.0G** (*Identification (verified: ROM bytes)*), not F3DEX. Stored room lists use only these commands (counts over
all rooms): `04` G_VTX 24,103 · `B1` (Rare) 56,836 · `BF` G_TRI1 2,115 · `B6`/`B7` geometry mode 686/2,285 · `B8`
G_ENDDL 2,048 · `B9`/`BA` SETOTHERMODE_L/H 2,935/8,804 · `BB` G_TEXTURE 5,204 · `C0` (Rare) 10,348 · `E7` PIPESYNC
5,055 · `FB` SETENVCOLOR 2,776 · `FC` SETCOMBINE 4,231. There is no G_DL, G_SETTIMG, G_MTX or MOVEWORD in stored lists.

| command | encoding |
|---|---|
| `04` G_VTX (Fast3D) | `w0 = 04 · (n−1) << 20 · v0 << 16 · n × 16`; `w1 = 0x0E000000 + offset` into the room's vertices |
| `BF` G_TRI1 (Fast3D) | indices stored × 10: `BF000000 005A5096` = vertices 9, 8, 15 |
| **`B1` (Rare, four triangles)** | triangle k (k = 0..3) = `(w1 >> (8k+4) & 15, w1 >> 8k & 15, w0 >> 4k & 15)`; a (0, 0, 0) slot is unused. Verified: the game copies B1/BF unchanged into the lists it draws, and the geometry matches screenshots (*Building meshes, renders and comparisons*) |
| **`C0` (Rare, texture)** | `w1 & 0xFFF` = texture number; `(w0 >> 22) & 3` S wrap and `(w0 >> 20) & 3` T wrap (0 repeat, 1 clamp, 2 mirror); `(w0 >> 18) & 3` filter (2 = bilinear, tiles offset by half a texel); `w0 & 7` mode: 2 = one mipmapped texture (almost all), 1 = two textures (second number `(w1 >> 12) & 0xFFF`), 0/3/4 variants; `w1 >> 24` a parameter (modes 0/1) |
| `B6`..`BB`, `E7`, `FB`, `FC` | standard, with F3DEX 1.x numbering; `G_CULL_BACK` = 0x2000 |

**C0 expansion by the game** (`0x7F0CE118`, verified in RAM: every C0 of 11 Dam and 5 Facility lists paired with its
expansion, 0 mismatches): `FD SETTIMG` to the decoded texture; `F5/E6/F3` LOADBLOCK of the whole mip chain into tile 7;
for CI formats `F5 000300` + `F0 LOADTLUT` + `BA000E02` (TLUT mode); then per level `F5 SETTILE` + `F2 SETTILESIZE`.
The expander also patches the `BB` level counts and adds fog to the stored render modes and combiners (`0C182078` →
`C8102078`; the low 16 bits are kept).

`B7 0x60000` (LIGHTING | TEXTURE_GEN, environment mapping) occurs three times over all BG files; not modelled.

#### Frame structure (verified: captured frames, `runtime/captures/*/dl.txt`)

One Fast3D task per frame (OSTask at `0x8004EA00`/`0x8004EA60`, loaded by `osSpTaskLoad` `0x7000E60C`; ucode text
`0x80020E60`). Draw order:
1. Segment 1 = static state lists (copies at `0x7F0E2D70`/`0x7F0E2D90`); Z clear.
2. Viewport and perspective; letterbox bars.
3. **Sky and water** (*Environment: fog, clear colour, sky (verified: disassembly and 12 captured frames)*).
4. Lights, lookat, fog; **objects, opaque pass** (per-part matrices in segment 3, model in segment 5).
5. **BG rooms, primary lists**, each wrapped as in *Render state (verified: frame DLs of 13 captures and game-camera composites)*.
6. **BG rooms, secondary lists**, then **objects, translucent pass** (CPU fog: `SETFOGCOLOR` = fog colour × the
   object's fog fraction).
7. First-person gun (own matrices, environment-mapped chrome, no fog), then the HUD (FILLRECT/TEXRECT).

Frame-list Fast3D encodings: `BC` G_MOVEWORD (low byte 06 segment, 08 fog factor `mul << 16 | offset`, 0E perspnorm);
`01` G_MTX (byte 1: 1 projection, 2 load, 4 push); `03` G_MOVEMEM (80 viewport, 82/84 lookat, 86/88 lights);
`B4/B2/B3` RDPHALF carrying raw RDP triangles and TEXRECTs.

**Runtime check of the C0 expansion** (Dam room 135, stored vs the copy the frame calls): all non-texture commands are
copied verbatim except the fog-patched render mode; `C0080002 00000467` becomes `SETTIMG 0x801504F8`, LOADBLOCK into
tile 7, LOADTLUT, TLUT mode and six `SETTILE`/`SETTILESIZE` levels (32×32 down, with the bilinear half-texel offset).

**Other code-drawn things** (not level data): per-object CPU fog; the first-person gun and HUD; environment-mapped BG
surfaces (three `B7 0x60000` cases; drawable with plain UVs); an animated handler for texture 1508 (`0x7F0CE5F0`;
frame 0 is fine); multiplayer split-screen viewports.

#### Model file format (verified: all 503 P/C/G files parse and every display list decodes; RAM on Dam)

- The **ModelFileHeader** is in the data segment, not the file (0x20 bytes): `+00 root node*; +04 skeleton*;
  +08 switches*; +0C s16 numSwitches; +0E s16 numMatrices; +10 f32 radius; +16 s16 numTextures; +18 texture list*;
  +1C loaded flag`.
- **File layout:** `u32 × numSwitches`, then `numTextures` × 12-byte texture records `{u32 texture number; u8 width;
  u8 height; …}`, then nodes, rodata, vertices and display lists. The root node is the first byte after the texture
  list.
- **Pointers** are `0x05000000 + file offset`. At load the game relocates them, turns texture numbers into loaded
  textures and rewrites the DLs (expanding `C0` like the BG loader; verified on `Poil_drum7Z` in RAM).
- **Node**, 0x18 bytes: `u16 type (low byte type, high byte flags); ptr rodata; ptr parent; ptr next; ptr prev; ptr
  child`. Render dispatch `0x7F074534`.

| type | count | meaning | rodata (bold = verified) | viewer |
|---|---|---|---|---|
| 01 | 48 | root (characters, helicopter) | `s32; ptr; 0; 0` | – |
| 02 | 1140 | position (joint) | **f32 pos[3]; s16 joint (+0C); s16 matrix slot (+0E)**; s16 slot2/3; ptr child; f32 radius | transform |
| 04 | 606 | gun DL | **ptr primary; ptr secondary; ptr seg-5 base; ptr vertices; s16 count; u8 mode (+12)** | draw |
| 08 | 678 | distance LOD | **f32 near; f32 far; ptr child** | use the LOD with near = 0 |
| 09 | 345 | reorder | f32[6]; **ptr childA (+18); ptr childB (+1C)** | draw both |
| 0A | 1014 | bounding box | **s32 part; f32 xmin, xmax, ymin, ymax, zmin, zmax** | placement only |
| 0C | 21 | gunfire | f32 pos[3]; f32 size[3]; … | skip |
| 0D | 42 | effect (translucent pass) | … | skip |
| 0F | 2 | ? | … | skip |
| 12 | 291 | toggle (heads, parts) | **ptr child** | draw |
| 15 | 80 | position held (hands, guns) | f32 pos[3]; s16 slot; … | transform |
| 16 | 5 | star gunfire | … | skip |
| 17 | 28 | head spot (bodies) | … | attach the head model |
| 18 | 1469 | DL | **ptr primary; ptr secondary; ptr vertices (segment 4); s16 numVertices; …; s16 mode (+18); ptr seg-5 base (+1C)** | draw |

- **Display lists** use the same microcode as BG (*Display-list microcode (verified: opcode histogram over every stored list, disassembly, frame DLs)*): opcodes `01 04 B1 B6 B7 B8 B9 BA BB BF C0 E6 E7 F2 F3 F5 FC
  FD`, no unknowns. Segment 3 = the model's matrix slots (`01020040 030000xx` = G_MTX load slot xx/0x40), segment 4 =
  the node's vertices, segment 5 = the file. A few item models use raw `FD/F5/F3/F2/E6` texture setup.
- **Render state by node mode** (type 18 +0x18, type 04 +0x12): 1 and 3 opaque; 4 = the secondary list is drawn in the
  translucent pass. Viewer: primary = opaque (cutout when the texture has alpha), secondary with mode 4 = blend. Most
  model DLs set `B7 0x2000` (cull back); `B7 0x60000` marks environment-mapped parts. Vertex colours are prelit.
- **UVs:** `s × G_TEXTURE scale / 32 / width`, wrap from C0 (renders match the Runway screenshot).

### 3.5 Textures and materials

#### Textures (verified unless marked)

- **Table** at data `0x80049300`: 8-byte records `{u8 flags; u24 size; u32 0}`, 2,698 textures + a terminator (low 24
  bits `0xFFFF`). In ROM the u24 is the entry's **size**; boot code (`0x7F000BD0`) rewrites it to the running offset.
  Texture i starts at ROM `0x8F7DF0 + Σ size(0..i−1)`. Verified: the reconstruction equals the runtime table in RAM
  (0 mismatches over 2,699). The flag byte (0x11, 0x22, 0x33, 0x77, 0xAA …) is kept; its meaning is not decoded
  (hypothesis: surface or sound type).
- **Entries are not 1172 streams at their start.** First byte: bit 6 selects the zlib path (1,744 textures, CI formats
  only), otherwise the bit-packed path (954); bit 7 = all mip levels stored; low 6 bits = level count.
- **Formats** (tables `0x80049178..0x800492B0`): 0 RGBA32, 1 RGBA16, 2 RGB24 → RGBA32, 3 RGB15 → RGBA16, 4 IA16,
  5 IA8, 6 IA4, 7 I8, 8 I4, 9 CI8 with RGBA16 TLUT, 10 CI4/RGBA16, 11 CI8/IA16, 12 CI4/IA16.
- **zlib path** (`0x7F0C6658`): `u8 format; u8 paletteCount − 1; u16 palette[]`; then per stored level `u8 w; u8 h;
  11 72 + DEFLATE` of the indices.
- **Bit-packed path** (`0x7F0C7DFC`): per level `read4 format, read8 w, read8 h, read4 codec` with codecs 0..9 (jump
  table `0x8005BD30`): Huffman (`0x7F0C91D0`), LZ, palette lookup, a 7-mode prediction filter (codecs 8/9) and raw
  alpha bits; MSB-first bit reader `0x7F0CBF2C`.
- **Decoder:** `bg/lib/getex.ts` is an instruction-level port of the game's loader (1,230 lines, no imports,
  browser-safe). All 2,698 textures decode; 2,696 consume exactly their ROM size. #2246 and #2260 (64×32 I8) don't and
  decode as noise; no BG file uses them (hypothesis: garbage in the game too).
- **Against RAM** (`bg/scripts/ramtexcheck.ts`): every texture loaded in the Dam (25) and Facility (5) frames has
  **level-0 texels identical to RAM (30/30)**, covering CI4, CI8/RGBA16, CI8/IA16, I4, I8, IA4 and IA8; the whole
  buffer (mips + palette) is identical for 25/30, and the other 5 differ only inside mip levels the game generates.
- Wrap and clamp come from C0; a viewer uses level 0. Contact sheets of all 2,698 textures:
  `bg/renders/tex_sheet_000.png`..`tex_sheet_010.png`. 1,013 distinct texture numbers are used by BG files.

#### Level geometry and textures

| check | method | result | evidence |
|---|---|---|---|
| BG format | parse all 25 files; loader disassembly | all rooms, portals and streams parse; per-level stats in *Building meshes, renders and comparisons* | `bg/lib/bgfile.ts`, `bg/scripts/stats.ts` |
| room-relative vertices | runtime room boxes in RAM vs vertex + position boxes | equal for 83/136 Dam rooms, containing for the rest | `runtime/captures/dam/ram.bin` |
| C0 expansion | pair each stored C0 with the game's expanded commands in RAM | 11 Dam + 5 Facility lists, 0 mismatches | `bg/scripts/align2.py` |
| texture decoder | instruction-level port of the game's loader vs RAM | level-0 texels identical for all 30 textures loaded in the Dam and Facility frames; whole buffers identical for 25 | `bg/lib/getex.ts`, `bg/scripts/ramtexcheck.ts` |
| texture table | reconstruction vs runtime table in RAM | 2,699/2,699 records equal | `bg/scripts/texcheck.ts` |
| scale, handedness | frame DL room matrices and the combined projection | k = f10 / f0C on Dam, Facility and Surface 1 (to 5 digits); det +1, up +Y | `bg/scripts/framerooms.py` |
| game-camera renders | render the frame's rooms with its own matrices and viewport; compare with the screenshot of the same frame (lead viewed Dam) | Dam, Facility and Surface 1 match in layout, handedness and textures | `bg/renders/{dam,ark,sevx}_gamecam_textured.png` vs `runtime/captures/dam/shot_before.png`, `bg/captures/{ark,sevx}/shot_before.png` |
| culling | the same cameras with the opposite rule, with the lists' rule, and double-sided | the opposite rule shows cliff interiors (Dam), back faces (Facility) and loses the ground (Surface 1); the lists' rule leaves holes (Aztec floor, Surface 1 bank, Dam cliff, Frigate deck); double-sided matches all 10 composites | `bg/renders/test_*cull*.png`, `sevx_gamecam_textured_WRONGcull.png`, `bg/renders/env/exp/` |
| alpha and decals | Egyptian pool and Streets windows with and without the ENV-alpha rule and decal offset; the patched combiner in RAM (`1F1093FF` → `1F1493FF`) | translucent pool and clean windows only with the rules | `bg/renders/env/egyptian_final_composite.png`, `streets_final_composite.png` (lead viewed) |

### 3.6 Collision

### 3.7 Environment, sky, fog, and lighting

#### fog, clear colour, sky (verified: disassembly and 12 captured frames)

**Selection** (`0x7F0BAA64(stage, flag)`):
1. If flag ≠ 0: find id + 900 in table A. Only Dam and Surface 2 have one; they are alternate environments that
   level scripts switch to (hypothesis on purpose).
2. Find `stage + 100 × n` in table A, where n = the player count if > 1, else 0.
3. For n ≥ 2, find the generic `100 × n` record (200/300/400).
4. Otherwise: near 15, **no fog**, and table B by stage id (default record id −1).

The chosen record's near/far rebuild the perspective; the rest is copied to the live struct `0x80044DCC`, and fog is
on (`[0x800825C0] = 1`). A per-frame interpolator (`0x7F0BACA8`) can blend towards the next record for scripted changes.

**Table A** `0x80044E10`, 0x5C-byte records, zero-terminated (47 records):
```
+00 s32 id            +04 f32 near         +08 f32 far          +0C/+10/+14 f32 (not read by fog/sky code; hypothesis: draw distances)
+18 s32 0             +1C s32 999          +20 s32 fog min      +24 s32 fog max
+28 u8 r, g, b        (fog colour = clear colour = horizon colour)
+2B u8 sky enable     +2C f32 cloud plane height (world units)    +30 s16 cloud texture-list index
+34/+38/+3C f32 cloud r, g, b (0..255)    +40 u8 textured water    +44 f32 water plane height
+48 s16 water texture-list index    +4C..+54 f32 water r, g, b    +58 f32 horizon offset (pixels; the sky is shifted up by it)
```
**Table B** `0x80045F50`, 0x38-byte records with the live-struct layout from +8 (no near/far/fog): id −1 default
(colour 00 00 10), **0x1A Frigate** (colour 10 30 60, sky on, cloud height 3000, cloud 230 230 230, textured water at
−150 with texture-list entry 2, water 255 255 150), 0x36 Cuba (30 40 10, sky off).

Per stage (main records; full decode in `runtime/an/env_tables.json`):

| stage | near | far | fog min–max | colour | sky | cloud height | cloud RGB |
|---|---|---|---|---|---|---|---|
| Dam 0x21 | 5 | 15000 | 995–1000 | `103060` | on | 5000 | 255 255 255 |
| Facility 0x22 | 10 | 5000 | 990–1000 | `102010` | off | | |
| Runway 0x23 | 10 | 15000 | 996–1000 | `103040` | on | 5000 | 25 25 25 |
| Surface 1 0x24 | 2 | 2500 | 996–1000 | `606080` | on | 10000 | 240 120 30 |
| Surface 2 0x2B | 2 | 2000 | 957–1000 | `201010` | on | 5000 | 58 17 0 |
| Bunker 2 0x1B | 10 | 10000 | 996–1050 | `100000` | on | 5000 | 58 17 0 |
| Statue 0x16 | 15 | 3500 | 996–1000 | `000008` | on | 5000 | 170 100 40 |
| Control 0x17 | 10 | 10000 | 996–1000 | `000000` | off | | |
| Archives 0x18 | 10 | 3000 | 996–1000 | `000000` | on | 5000 | 255 255 255 |
| Train 0x19 | 10 | 1500 | 996–1000 | `000008` | on | 5000 | 255 255 255 |
| Streets 0x1D | 10 | 7500 | 996–1000 | `101820` | on | 5000 | 225 175 100 |
| Depot 0x1E | 10 | 3000 | 996–1000 | `000008` | on | 7500 | 70 199 186 |
| Jungle 0x25 | 10 | 2500 | 996–1000 | `182000` | off | | |
| Caverns 0x27 | 10 | 6000 | 993–1000 | `080008` | off | | |
| Cradle 0x29 | 10 | 9500 | 996–1000 | `6080A0` | on | 5000 | 255 255 0 |
| Aztec 0x1C | 10 | 15000 | 996–1000 | `000000` | on | 7500 | 83 72 65 |
| Egyptian 0x20 | 10 | 20000 | 996–1000 | `103060` | on | 5000 | 255 255 255 |
| Temple 0x26 (and MP 238/338/438) | 10 | 6000 | 996–1000 | `181828` (MP `181818`) | on | 10000 | 160 160 190 (MP 120) |
| Complex 0x1F (and MP 231…) | 10 | 5000 | 996–1000 | `280000` | on | 10000 | 220 0 20 |
| **Citadel 0x28** (and 240/340/440) | 10 | 20000 | 996–1000 | `185038` | on | 5000 | 255 108 0 |
| Frigate 0x1A | table B: near 15, no fog | | | `103060` | on + water | 3000 | 230 230 230 |
| Silo 0x14, Bunker 1 0x09, Caves, Library, Basement, Stack, Cuba | table B (Cuba its own record; others default id −1): near 15, no fog | | | `000010` / Cuba `304010` | off | | |

Multiplayer-only records exist for Bunker 1 (209/309/409), Cradle (241…), Caverns (239…) and generic 200/300/400.
Records 125, 128, 132, 134 (Train, Aztec, Egyptian, Facility + 100) cannot be selected with one player (hypothesis:
alternate environments or unused).

**Verified against frames:** in Dam, Facility, Surface 1, Aztec, Runway, Jungle, Streets, Egyptian, Cradle, Statue,
Caverns and Temple (2 players), the frame's `FOGFACTOR`, `SETFOGCOLOR` and projection near equal the record exactly,
and far equals it to the Mtx precision. Frigate and Silo have no fog command and near 15. The sky fill colour equals
the record colour (RGBA5551) in every capture.

**Viewer `Fog`:** `color` = record RGB; `multiplier = 128000 / (max − min)`; `offset = (500 − min) × 256 / (max − min)`
(Dam: 25600 / −25344, identical to the frame's `BC000008 64009D00`); `near`/`far` = record values ÷ f10 in world
units (*Units, scale, handedness, camera (verified)*; f10 = 0.2 for Dam, Surface 1 and 2, else 1.0). Omit `fog` for table-B stages. Rooms get fog from the
emitter `0x7F0BB070`; objects are fogged on the CPU with the same colour, so the viewer can apply the level fog to
everything.

**Clear colour and sky** (code `0x7F094488`, called by the frame builder `0x7F0BE598` before everything else):
- Sky flag 0: FILLRECT the viewport with the record colour (Facility, Jungle, Control, Caverns). `Level.clearColor` =
  record RGB.
- Sky flag set: the CPU intersects the four screen-corner rays with a **cloud plane** (height +0x2C, world units) and
  a **water plane** (+0x44), clips them to the screen and sends raw RDP triangles (`B4/B2/B3` half-commands): water
  first (a FILLRECT in the record colour unless textured), then the sky.
- Sky triangles: texture-list entry 0 = texture **2228** (0x8B4, 64×64 clouds), env colour = record colour, combine
  `(SHADE − ENV) × TEXEL0 + ENV`, render mode `0x00552048` (no Z), no fog.
- Vertex colour `c = env + planeRGB × (1 − env/255) × (1 − fade)`, `fade = 1 − min(1, 2|dir.y| / |dir.xz|)` for the
  ray through the vertex: the record colour at the horizon, the cloud colour about 27° up. Checked against the RDP shade
  of every sky/water vertex in 8 captures (±1).
- UV = `(x / 320, z / 320 + scroll / 32)` texels, with (x, z) the plane hit in world units and `scroll` the f32 at
  `0x8003FD94` (advanced per tick, wrapping at 4096 = two texture repeats). Verified near the eye (within three plane
  heights) to rms ≤ 0.07 texel on Dam, Aztec, Frigate, Runway, Egyptian and Cradle. An earlier apparent skew came from
  fitting far hits near the horizon, where the RDP's W precision is poor.
- **Horizon offset** (record +0x58, e.g. Streets 25, Surface 1 7): the ray for screen row y is cast through row y + off,
  so the sky is drawn shifted up by `off` pixels. Streets only fits with it applied (rms 0.009 texel).
- Frigate water: texture-list entry 2 = texture **1509** (32×32 CI8, mipmapped), UV = `(x / 32, z / 32 + scroll / 32)`
  (fit rms 0.001 texel), colour = texel × shade with the water RGB in the fade formula. Verified against texel × RDP
  shade at water pixels ((1,16,45) vs render (2,16,46)). The game blends a second, offset texture layer by an animated
  LOD fraction (`127 × sin(phase) + 128`, render mode `0x0C192078`); a viewer can ignore it.
- The sky texture list lives at `[0x8008D124]` (12-byte `{u32 texture; u8 w, h; …}`); entry 1 is texture 1508.

**What the viewer should draw:** `clearColor` = record colour. If the sky flag is set, a `Sky` mesh: a large
camera-relative horizontal quad (or disc) at the cloud height, texture 2228 repeating every 320 world units, colour
fading from the cloud RGB overhead to the record colour at the horizon (the combine above). The part below the horizon
is the clear colour; for Frigate add the water quad at −150. Draw it first without depth or fog, shifted up by the
horizon offset. A faithful version needs small renderer additions (*Additions to `src/rom/types.ts` and the renderer*).

#### Runtime rendering and environment

| check | method | result | evidence |
|---|---|---|---|
| captures | debugger breakpoint on `osSpTaskLoad` (`0x7000E60C`) at the frame's graphics task, 8 MiB RDRAM dump while paused, ring screenshots before and after; frame DL walked | 14 stages (Dam ×2, Facility, Surface 1, Aztec, Runway, Frigate, Jungle, Streets, Egyptian, Cradle, Statue, Caverns, Silo, Temple with 2 players); every screenshot viewed | `runtime/captures/{stage}/{manifest.json,ram.bin,dl.txt,shot_before.png}`, `runtime/captures/index.json` |
| microcode | OSTask ucode text/data; the data string; Glide64's checksum | Fast3D "RSP SW Version: 2.0G" (checksum `0xAE08D5B9` = Glide64 ucode 0) | manifests |
| environment table | disassembly of the selector `0x7F0BAA64`, copier `0x7F0BA758` and fog emitter `0x7F0BB070`; record fields vs frame commands | fog factor, fog colour and near exact, far to Mtx precision, in 12 frames; the no-fog fallback on Frigate and Silo; sky fill colour = record colour in every capture | `runtime/tools/decode_env.py`, `runtime/an/env_tables.json` |
| sky | disassembly of `0x7F094488`; decode of the raw RDP triangles in 8 captures | vertex shade formula ±1; UV fit rms ≤ 0.07 texel on 6 stages (*Environment: fog, clear colour, sky (verified: disassembly and 12 captured frames)*) | `runtime/an/sky/rdptri_out.txt`, `bg/scripts/skyfit2.py` |
| scale and camera | `0x800413F4/F8`, `0x80032310`, room Mtx diagonals, camera struct fields in 3 dumps | world = BG ÷ f0C, render = world × f10; right-handed Y up | manifests |
| spawn and eye height | player struct vs setup spawn pads (runtime), stan floor (obj) | camera on a spawn pad facing its look vector on 12 stages; eye = floor + 167.28 world units exactly | `runtime/tools/spawn.ts`, `obj/out/stan_verify.txt` |
| environment renders | the *Environment: fog, clear colour, sky (verified: disassembly and 12 captured frames)* model added to the game-camera renderer; composites viewed by the BG agent, 3 by the lead | 9 stages match (*Building meshes, renders and comparisons*) | `bg/renders/env/*_final_composite.png` |
| C0 expansion at runtime | Dam room 135 stored list vs the copy the frame calls | only C0 and the fog-patched render mode differ | `runtime/tools/texcheck.ts` |

### 3.8 Cameras and paths

#### Render state (verified: frame DLs of 13 captures and game-camera composites)

- The game calls every visible room's **primary** list, then the **secondary** lists after all primaries.
- Before each room: `G_MTX` projection load (combined view × projection), fog colour + fog factor, `B7` G_FOG, `G_MTX`
  modelview load (room matrix, *Units, scale, handedness, camera (verified)*), `BC003806` segment 14 = the room's vertices, `G_DL`.
- Each room call also sets a scissor rectangle from the portal chain; a viewer doesn't need it.
- Geometry mode at primary calls: ZBUFFER | SHADE | SHADING_SMOOTH | CULL_BACK | FOG; the lists' own B6/B7 change
  CULL_BACK for some geometry.
- **Culling: draw BG double-sided.** Most triangles wind clockwise on screen, and the opposite rule is clearly wrong
  (*Building meshes, renders and comparisons* culling tests). But rendering with the lists' cull flags leaves holes where the game shows geometry: Aztec's
  floor at the spawn, a Surface 1 snow bank, a Dam cliff face, Frigate's deck planks. Pixel probes show ordinary opaque
  triangles in `B7 00002000` lists, fully in front of the camera and inside the guard band, wound opposite to their
  neighbours. Drawing BG without back-face culling fills every hole and shows no artefact in any of 10 game-camera
  composites (verified). Why the game draws them is not known (hypothesis: Fast3D 2.0G's cull test differs from the
  screen-area sign; the reference frames come from the Glide64 HLE plugin, and an LLE check gave no usable image headless).
- **Blend, depth and decal** come from the stored `B9` render modes (the game only adds fog): `…2078` opaque;
  `…4DD8` / `…49D8` translucent (ZMODE_XLU, FORCE_BL); `…2D58` decal (ZMODE_DEC); `…2048` no depth.
  `displaylist.ts` already maps these bits. **Decals need a depth offset**: without one the Streets window panes and
  kerbs z-fight into stripes (verified by composite). **Batches without depth test** (e.g. Dam room 5, render mode
  `0C182048`, a backdrop) should be drawn before the depth-tested rooms (hypothesis from a render probe: drawn in room
  order they paint over nearer cliffs).
- **Vertex colours are prelit** RGBA (no RSP lighting except the three environment-mapped cases); colour = texture ×
  vertex colour (`FC26A004 1F1093FF` etc.).
- **Alpha = texel alpha × the list's `FB` env alpha**, not vertex alpha: the C0 expander patches the combiners' second
  alpha cycle from SHADE to ENV (`1F1093FF` stored → `1F1493FF` in RAM; shade alpha carries fog). Verified: Egyptian's
  pool (secondary list, `FB …7F`) is opaque without this rule and translucent like the screenshot with it.
- Fog, sky and clear colour are set by code (*Environment: fog, clear colour, sky (verified: disassembly and 12 captured frames)*).

#### Units, scale, handedness, camera (verified)

- **BG stage table** `0x8004448C`: `{u32 stage; char* bg; char* stan; f32 f0C; f32 f10; f32 f14}`, e.g. Dam 0.23364 /
  0.2 / 100, Facility 1.20648 / 1.0 / 64.1, Surface 1 0.45446 / 0.2 / 22.6.
- Three spaces:
  - **BG units** are the BG file's (room positions, vertices, portals) and **setup pads'** (verified on 12 stages, *Objects and props*).
  - **World units = BG units / f0C.** The camera struct, eye height and environment distances use them (verified:
    `[0x8007A0B0]` +04 eye, +10 target, +1C up, +38 render origin, on Dam, Facility, Surface 1). The eye height of
    167.28 suggests centimetres (hypothesis).
  - **Render units = world units × f10.** The frame's room modelview is `diag(f10/f0C)` with translation `(roomPos −
    origin) × f10/f0C` (builder `0x7F0BC85C`; `0x800413F4 = f0C`, `0x80032310 = f10 × 65536`). Verified to five digits:
    Dam 0.85602, Facility 0.82886, Surface 1 0.44009. The origin is one room's position (camera-relative rendering).
- **Handedness:** right-handed, +Y up, **no mirroring** (the view part of the combined matrix has det +1; screen right
  = forward × up in all 14 captures; renders match screenshots).
- **Winding:** most BG faces wind **clockwise on screen** (front). Swap two indices per triangle to follow the
  viewer's CCW-front convention, but set `cullBack = false` for BG batches (*Render state (verified: frame DLs of 13 captures and game-camera composites)*: some visible triangles are wound the
  other way). Don't negate X.
- **Projection:** fovY 60°, aspect 320/220 (letterboxed rows 0–9 and 230–239); near/far from the environment record in
  render units.
- **Recommended viewer space:** world units (BG × 1/f0C), which makes every stage the same scale (1 unit ≈ 1 cm,
  hypothesis). The viewer can divide by 100 for metres if its fly speed expects smaller numbers. Fog near/far then
  become `near / f10`, `far / f10`.
- **Start camera (`Level.camera`)** (verified on 12 stages): the player spawns on one of the setup's intro spawn pads
  (*Intro block (verified: walker `0x7F0057C4`)*). The eye is 167.28 world units above the floor under the pad, looking along the pad's look vector (camera
  yaw = pad look within 0.3° on all 12), fovY 60. Floor height isn't the pad Y (pads float 40–150 units above or below it): take the floor
  from the stan file (*Clipping ("stan") files and floor height (verified: all 26 regular non-empty files; RAM on 14 captures; code)*, *Spawn camera (verified on 12 stages)*). Stages with several spawn records (Dam 3, Facility 4, Silo 3): which one the
  game picks was not traced; use the first. Frames also show a constant ~3.9° downward pitch (hypothesis: head bob/aim).

#### Spawn camera (verified on 12 stages)

Eye = the stan floor under the spawn pad + **167.28 world units** (`167.28 × f0C` BG units), looking along the pad's
look vector, fovY 60. Against the 12 runtime captures' eye positions (`obj/out/stan_verify.txt`): 0.02–0.12 BG units on
5 stages, 0.75–10 on 6 (the idle sway and a small slide at spawn), 17.7 on Silo and 26.7 on Surface 1; Y exact except
Jungle (−1.7) and Temple (2.5). Which of several spawn records the game picks was not traced; the first set-0 record
matched in Facility and Streets.

## 4. Objects

### 4.1 Placement records

#### Placement (verified against RAM on 8 stages, 1,299 objects)

Work in world units (÷ level scale f0C) and multiply by f0C for BG units, or work in BG units throughout.

**Generic objects** (`0x7F001D9C`):
1. `scale = propTable[model].scale × extrascale / 256` (the extrascale factor is applied in step 4).
2. Normal pad: `P = pad.pos`; basis columns `[normalize(up × look), up, look]`.
3. Bound pad: `r = normalize(up × look)`; `centre = P + ½((xmin+xmax) r + (ymin+ymax) up + (zmin+zmax) look)`;
   `P = centre + ½(ymin − ymax) up` (bottom centre). With fit flags, scale each axis to the box: `fx = (xmax −
   xmin) / (model.xext × scale)` (flags 0x30), `fy` (0x50), `fz` (0x90), where flag 0x2 swaps y and z; 0x10 = uniform
   (min). Divide by the max, multiply `scale` by the max.
4. `rot = basis × diag(fx, fy, fz) × scale`.
5. Final position, with the model bounding box `m`:
   - flags 0x2 (wall): `rot = rot · rotY(π) · rotX(3π/2)`, `pos = P − col2(rot) × m.zmin`;
   - flags 0x4: `rot = rot · rotZ(π)`, `pos = P − col1(rot) × m.ymax`;
   - flags 0x8: `pos = P − col1(rot) × m.ymin`;
   - otherwise `pos.xz = P.xz − col1.xz × m.ymin` and `pos.y = floor(x, z) + 4 − col1.y × m.ymin` (`0x7F040AB4`),
     with `floor` the clipping (stan) height under the point (*Clipping ("stan") files and floor height (verified: all 26 regular non-empty files; RAM on 14 captures; code)*). On bound pads the box bottom is the floor.
6. Instance matrix = `T(pos) · rot`; model vertices are in the root frame.

**Doors** (`0x7F003480`): bound pad index; a preceding type-02 record scales `xmin, xmax`. Position = box centre
(closed). `rot = basis · rotZ(π/2) · rotX(π/2) · diag(sy', sz', sx')` with `sx = (ymax − ymin)/m.xext`, `sy = (zmax −
zmin)/m.yext`, `sz = (xmax − xmin)/m.zext`, normalised by the max as above.

**Guards:** position = pad x/z (verified on idle guards); the model origin is at **floor + 108.30 world units**
(verified: 228 idle guards on 8 stages); facing = pad look (hypothesis); model scale 0.1 × body scale; head = the head
model attached at the head spot.

**Verification** (`obj/scripts/verify_all.ts`, `obj/out/verify_summary.md`; captures of Dam, Facility, Runway,
Jungle, Frigate, Aztec, Streets and Surface 1):
- **Matrices exact** for 814/814 standard objects, 137/137 doors, 80/80 tinted glass, 115/116 monitors, 13/13 weapons,
  17/17 autoguns and 48/53 glass.
- **Positions:** x/z exact for 808/814 standard objects and for every closed door (114/137; the rest were open). With
  stan floors, Y is exact for 728/814 standard objects, 137/137 doors and 106/116 monitors. 110 of the 130 remaining
  Y differences are objects the game stacks on other objects at runtime (runtime flag `obj+0x64 & 0x8000`, set by a
  surface search in `0x7F03FAB0`/`0x7F03CC20` that is not reproduced); the rest are vehicles the game moved.
- Open: tinted glass and three Dam objects sit at the pad position instead of the box bottom in RAM; gas-release
  volumes are offset by a constant.

**Renders** (lead viewed `composite_runway.png`, `scene_dam.png`, `overview_facility_guards.png`):

| render | shows | result |
|---|---|---|
| `obj/renders/overlay_runway_frame.png` | Runway models drawn with the frame's own matrices over the screenshot | coincide |
| `obj/renders/composite_runway.png` | screenshot \| BG + placed objects | the roller door, its striped frame and the gas barrels line up; BG units = setup units = RAM units × level scale |
| `obj/renders/scene_dam.png` | screenshot \| BG + objects from the Dam spawn camera (camera from RAM: `MV = (f10/f0C)·v − f10·origin`, origin = camera +0x38, the room-call projection) | cliffs, hazard barrier and the red/white barriers match; the truck is drawn at its setup pad, where the game has already driven it away; no sky |
| `obj/renders/scene_jungle.png` | Jungle spawn | plants, trunk and fern positions match; the on-screen character had been moved by its AI and is absent from the render |
| `obj/renders/scene_aztec.png` | Aztec spawn | BG matches; no props in view |
| `obj/renders/overview_facility.png`, `overview_facility_guards.png` | free camera over Facility with objects and 65 posed guards | stacked crates, tables, doors, stairs and guards with heads, as the viewer would show |

Contact sheets: `sheet_props.png` (340), `sheet_chrs.png`, `sheet_chrs_posed.png`, `sheet_items.png` (84 G*Z).

### 4.2 Object and model formats

#### Setup files (verified: all 21 solo and 13 multiplayer setups parse; RAM on 8 stages)

`Usetup{code}Z` (solo) and `Ump_setup{code}Z` (multiplayer) are 1172 streams. The header is 10 `u32` **file
offsets** (no segment or base); the loader stores `base + offset` in the globals `0x80075D00..0x80075D24` (base in
`0x80075D28`):

| +off | field | notes |
|---|---|---|
| 0x00 | path tables | |
| 0x04 | path links | |
| 0x08 | intro block | always the end of the object list + 4 |
| 0x0C | object list | walked by `0x7F003BF0` (instantiate) |
| 0x10 | path sets (patrols) | |
| 0x14 | AI lists | 8-byte `{ptr list; u32 id}` (hypothesis) |
| 0x18 | pads | always 0x28 |
| 0x1C | bound pads | |
| 0x20 / 0x24 | pad names / bound pad names | 0 in most files |

#### Pads (verified: ROM data of all files; RAM Dam)

- **Pad**, 0x2C bytes: `+00 f32 pos[3]; +0C f32 up[3]; +18 f32 look[3]; +24 u32 name (file offset of a C string, e.g.
  "p1988e"); +28 u32 stan (0 in the file)`.
- **Bound pad**, 0x44 bytes: a pad followed by `+2C f32 xmin, xmax, ymin, ymax, zmin, zmax`. The box is in the pad
  frame: x along `normalize(up × look)`, y along `up`, z along `look` (`0x7F001BD4`).
- Both lists end with an all-zero record.
- **Pads are in BG units.** At load the game divides positions and boxes by the level scale f0C (*Units, scale, handedness, camera (verified)*), giving world
  units (verified in RAM on Dam: every compared pad = file value / 0.23364 exactly; up/look unchanged).
- Pad numbers in records: `≥ 10000` = bound pad `n − 10000` (`0x7F001FF0`); **doors store the bound-pad index
  directly** (`0x7F0034C0`); guards and spawns use normal pads.

#### Object list (record sizes verified; field names partly hypothesis)

Records are variable-sized; the type is the byte at +3, and the size comes from `0x7F0568F4` (jump table
`0x80053490`). The list ends at type 0x30. Every setup file walks exactly to its intro block (verified).

| type | size | meaning | count (34 files) | viewer |
|---|---|---|---|---|
| 01 | 0x100 | door | 564 | mesh (closed) |
| 02 | 0x08 | door scale `{hdr; s32 16.16}` for the next door | 3 | apply |
| 03 | 0x80 | standard object | 1525 | mesh |
| 04 | 0x84 | key | 26 | mesh |
| 05 | 0x80 | alarm | 7 | mesh |
| 06 | 0xEC | CCTV camera | 15 | mesh |
| 07 | 0x84 | ammo magazine | 48 | mesh |
| 08 | 0x88 | weapon | 1039 | mesh unless held (flags 0x4000) |
| 09 | 0x1C | guard / character | 665 | posed mesh or marker |
| 0A / 0B / 0C | 0x100 / 0x254 / 0x80 | single / multi / hanging monitor | 230 / 55 / 6 | mesh |
| 0D | 0xD8 | autogun | 41 | mesh |
| 0E | 0x0C | link items | 2 | skip |
| 0F, 10 | 0x04 | ? | 0 | – |
| 11 | 0x80 | hat | 349 | mesh unless on a guard (flags 0x4000) |
| 12 | 0x0C | guard attribute | 98 | skip |
| 13 | 0x10 | ? | 10 | skip |
| 14 | 0xB4 | ammo box | 234 | mesh |
| 15 | 0x88 | body armour | 76 | mesh |
| 16 | 0x10 | tag | 398 | skip |
| 17 / 18 | 0x10 / 0x04 | objective start `{hdr; num; text; difficulty}` / end | 80 / 80 | skip |
| 19–1E, 20–22 | 0x04–0x14 | objective conditions (destroy, complete, fail, collect, deposit, photograph, enter room, deposit in room, copy item) | 214 | skip |
| 1F | 0x04 | ? | 0 | – |
| 23 | 0x10 | watch-menu objective text | 105 | skip |
| 24 | 0x80 | gas release (invisible volume) | 19 | marker |
| 25 | 0x28 | rename | 59 | skip |
| 26 | 0x10 | lock door | 27 | skip |
| 27 / 28 | 0xB0 / 0xB4 | vehicle / aircraft (+ AI list at +0x80) | 9 / 6 | mesh at its pad |
| 29 | 0x04 | ? | 0 | – |
| 2A | 0x80 | glass | 141 | mesh (blend) |
| 2B / 2C | 0x80 / 0x14 | safe / safe item | 5 / 6 | mesh / skip |
| 2D | 0xE0 | tank | 2 | mesh |
| 2E | 0x1C | cutscene | 31 | skip (or camera marker) |
| 2F | 0x94 | tinted glass | 192 | mesh (blend) |
| 30 | 0x04 | end | 34 | – |

**Common header** of every model-bearing type and of doors (verified by code field use and RAM):
```
+00 u16 extrascale (0x100 = 1.0)   +02 u8 hidden2   +03 u8 type
+04 s16 model (prop table index)   +06 s16 pad (*Pads (verified: ROM data of all files; RAM Dam)*), or the character id when flags & 0x4000
+08 u32 flags                      +0C u32 flags2
runtime: +10 prop*  +14 model instance*  +18 f32[16] rotation × scale  +58 f32 pos[3]
```
Placement flags: `0x2` wall-mounted, `0x4` upside down, `0x8` no ground snap, `0x10` uniform bound-pad fit,
`0x20/0x40/0x80` fit x/y/z, `0x4000` attached to a character (not placed), `0x8000` not placed from a pad
(hypothesis: carried).

**Door** extras (`0x7F003480`): `+84..+94` five 16.16 values (hypothesis: open fraction, speed, acceleration,
deceleration …), `+98` portal flags, `+9A u16` door type (4/8 slide along look, otherwise along up).

**Guard**, 0x1C bytes (`0x7F02370C`): `+04 s16 character id; +06 s16 pad; +08 s16 body (−1 random); +0A u16 AI list;
+0C s16 path; +10/+12 s16 (typically 1000/100); +14 u16 flags; +16 s16 head (−1 random)`.

#### Intro block (verified: walker `0x7F0057C4`)

| type | words | meaning |
|---|---|---|
| 0 | 3 | **spawn** `{pad; set}` |
| 1 | 4 | starting weapon `{right item; left item; set}` |
| 2 | 4 | starting ammo `{type; amount; set}` |
| 3 | 8 | intro "swirl" camera `{?, x, y, z (16.16) …}` |
| 4 | 2 | intro animation |
| 5 | 2 | cuff |
| 6 | 10 | fixed camera `{x, y, z, lat, long, preset, text1, text2, ?}` |
| 7 | 3 | watch time `{hour; minute}` |
| 8 | 2 | credits |
| 9 | 1 | end |

Spawn (verified in RAM): in Facility and Streets the idle player sits exactly on the first set-0 spawn pad (x, z ÷
level scale) and faces its look vector; multiplayer setups have 8 set-0 spawns. The start camera is in *Units, scale, handedness, camera (verified)*.

#### Model tables (verified: ROM data and code references)

- **Props** `0x8003A228`: 340 × `{ModelFileHeader* hdr; char* file; f32 scale}`. Scale is 0.1 for most props and 1.0
  for doors and a few others. All 340 files exist.
- **Characters** `0x8003DE10`: 80 × 0x14 `{hdr; file; f32 scale; f32 scale2 (e.g. Jaws 1.199); u8; u8 isHead; u16}`:
  0x00–0x28 bodies, 0x29 `Csuit_lf_handZ`, 0x2A–0x4E heads, 0x4F `CspicebondZ`.
- **First-person items** (G*Z): `{hdr; file}` at `0x80033924 + 0x38 × item id` (ids 1..0x54); cartridge models at
  `0x8003246C`. `GdynamiteZ`, `GexplosivepenZ`, `GextinguisherZ`, `GfingergunZ`, `GwristdartZ` are named only in the
  file table and have no model header (*Unused props, characters, models and textures*).

#### Clipping ("stan") files and floor height (verified: all 26 regular non-empty files; RAM on 14 captures; code)

`Tbg_{code}_all_p_stanZ` (1172 stream, named by the stage table) holds the walkable floor as convex polygon tiles.
Coordinates are **s16 BG units**.
```
+00 u32 0
+04 u32 sectionOffset[] … u32 0      1..31 section starts, each on a tile boundary; tiles run contiguously from the first
tile (8 + 8n bytes):
  +0 u32  id << 8 | room             ids mostly descend (not strictly); room = BG room number
  +4 u16  flags                      low 12 bits: three 4-bit values; top 4 bits rarely set (see below)
  +6 u16  n << 12 | i0 << 8 | i1 << 4 | i2    n = 3..9 points; i0, i1, i2 define the plane
  n × {s16 x, y, z; u16 link}       link × 8 + first section offset = neighbour tile across edge k → k+1; < 16 = none
end: an all-zero 8-byte record, then 24-36 bytes of padding to the file end
```
- **Tile list** (verified over all 25 regular files, 33,138 tiles): every section start is a tile start, and the tiles
  run without gaps to the zero record. 95.2% of tiles are triangles (n = 3: 31,551; 4: 1,136; 5: 375; 6-9: 76).
- **Links** (verified in part): `link × 8 + sectionOffset[0]` is the file offset of a tile for 84.5% of the 79,792 links
  (89% on Dam, 99% on Jungle and Caves, 60% on Streets). The earlier "file offset / 8" holds only where the first section
  starts near 0. The other links point inside tiles (12,118) or past the list (218); their encoding is not known.
- **Flags** (hypothesis, medium): the low 12 bits look like three 4-bit brightness values, one per plane point. 32% of
  tiles have `0xFFF`, and most others three equal nibbles (`0x333`, `0x777` …). Jungle, Caves and Cuba have graded ones
  (`0x132`, `0x764` …). On triangle tiles with unequal nibbles, the nibbles correlate 0.45-0.80 with the brightness of the
  nearest room vertices (Dam, Facility, Jungle, Streets, Caves). That would be the lighting the game applies to guards and
  objects standing on the tile; not traced in code. The top four bits are set on 170 tiles (`0x1FFF`, `0x3EEE` …): meaning
  unknown.
- **Viewer overlay**: `stan.ts collisionBatch` draws every tile as a translucent decal lifted 2 world units, in the hidden
  "collision" layer. Colours: green floor (|normal y| ≥ 0.7), orange slope (≥ 0.3), magenta steep, cyan when a top flag
  bit is set; shaded by room. `triSource` is the tile's file offset.
- The game keeps the file as loaded (the RAM copy equals the file apart from the relocated section list) and multiplies
  world coordinates by the level scale (`0x80040F44`) to get tile units.
- **Floor height** `0x7F0B2970(tile, x, z)`: the plane through points i0, i1, i2 evaluated at (x, z) (16-bit deltas,
  64-bit cross products), times 1/levelScale → world units.
- **Tile walk** `0x7F0B0914`: from an object's current tile, for each edge whose outside the point lies on and that has
  a link, step to the linked tile (≤ 501 steps).
- **Viewer lookup** (no current tile): the highest tile plane at or below `yRef + 10` among tiles whose XZ polygon
  contains the point; a 256-unit grid makes it fast (`obj/lib/stan.ts floorAt`). Verified: equals the player's floor
  (`[player]+0x70 × levelScale`, to 0.01 BG units) and the player's current tile on 13/14 captures (the 14th player had
  moved); picks the same tile as the game's resolved pad tiles for 3,014 of 3,029 pads (11 of the 15 others are
  coplanar overlaps; 4 differ in height).
- **Older format** (`Tbg_cat_all_p_stanZ`, the Citadel, *Unused and hidden content*; verified from the bytes: 485 tiles in 46 rooms, every byte
  accounted for). The retail layout reads no tiles from it; the viewer decodes it (`stan.ts parseStan`):
  ```
  +00 u32 0; +04 u32 0xC (first tile); +08 u32 0
  tile (12 + 16n bytes):
    +0 u32 name        file offset of the tile's 8-byte name ("p502a2" …), one name per tile in tile order
    +4 u16 w           unknown (retail-flag-like values: 0x0FFF, 0x0CCC, 0x0AAA …)
    +6 u16 room        BG room number
    +8 u8  n           3..7 points
    +9 u8 b1, b2, b3   unknown (always three distinct point indices; every point lies in the plane of those three)
    n × {f32 x, y, z; u32 link}   BG units (whole numbers; every tile lies in its room's BG box);
                                  link = file offset of the neighbour tile across edge k → k+1, 0 = none (1,122 of 1,122)
  end: 8 zero bytes, 32 bytes holding the string "unstric" (unknown), then the name table (485 × 8 bytes), 8 zero bytes
  ```

#### Objects and setups

| check | method | result | evidence |
|---|---|---|---|
| setup format | walk all 34 setup files with record sizes from `0x7F0568F4` | every walk ends exactly at the intro block | `obj/lib/setup.ts`, `obj/out/setup_stats.md` |
| pads | RAM Dam pads vs file | pos and box = file ÷ level scale exactly | `runtime/captures/dam/ram.bin` |
| models | parse all 503 P/C/G files, decode every DL | no unknown opcodes; RAM relocation and C0 expansion confirmed on `Poil_drum7Z` | `obj/lib/model.ts` |
| placement | recompute every object's matrix and position; compare with the runtime object structs in 8 captures | matrices exact for 814/814 standard objects, 137/137 doors, 80/80 tinted glass, 115/116 monitors; Y exact for 728/814 (most of the rest are stacked on other objects at runtime) | `obj/scripts/verify_all.ts`, `obj/out/verify_summary.md` |
| stan floors | floor lookup vs the player's floor and current tile, and vs the game's resolved pad tiles | 13/14 captures exact; 3,014/3,029 pads same tile | `obj/lib/stan.ts`, `obj/out/stan_verify.txt` |
| guards | idle guard positions in 8 captures | floor + 108.30 world units on all 228 | `obj/out/verify_summary.md` |
| root translation ignored | three window instances in the Dam frame | a single consistent camera only when ignored | `notes/obj.md` *Verification evidence and open questions* |
| renders | screenshot \| BG + objects (lead viewed Runway and Dam), Jungle, Aztec; Facility overview with posed guards (lead viewed) | line up; differences are objects the game had moved | `obj/renders/composite_runway.png`, `scene_dam.png`, `scene_jungle.png`, `overview_facility_guards.png` |

### 4.3 Skeletons and animation

#### Skeleton and rest pose

- Position nodes are relative to the enclosing position node (`0x7F05892C`); the matrix slot is rodata +0x0E.
- **The root position node's translation is not applied** (verified on the Dam frame: three window instances give one
  consistent camera only when it is ignored). 282 of 340 prop roots have large offsets while their vertices are centred.
- **Characters:** all bodies share the 16-joint skeleton at `0x8003D400`; props use the 1-joint skeleton `0x8003C4D8`.
  The identity rest pose is **not standing** (legs along ±X, `obj/renders/sheet_chrs.png`): joint rotations come from
  animation data (region `0x124AC0`, not decoded). A standing pose sampled from a guard in the Dam frame (per-joint
  local rotations applied by joint id) makes all 42 bodies stand (`obj/renders/sheet_chrs_posed.png`,
  `obj/out/guard_pose_local_rotations.json`; lead viewed). Heads attach at the head-spot node (type 0x17).

### 4.4 Behaviors, triggers, and scripted objects

## 5. Audio

### 5.1 Audio storage and banks

### 5.2 Sequence format and driver

#### Engine (verified by disassembly, RAM and audio capture)

GoldenEye uses **stock libultra audio**: `ALBankFile` banks with VADPCM samples, the **compressed-MIDI sequence
player `alCSPlayer`**, and the standard synthesizer. The viewer's `src/rom/music/libultra.ts` parses the bank and
renders the sequences **unchanged**; only the sequence container and the loop handling are GoldenEye-specific.

- Audio init `0x70006A30`:
  - loads the SFX bank (ROM `0x2EBDE0`) and the music instrument bank (ROM `0x3B4450`) with `alBnkfNew`;
  - reads the sequence table (ROM `0x419790`) and relocates its offsets;
  - configures the synth: 24 physical voices, 128 updates, `fxType 6` (AL_FX_CUSTOM, a 6-section reverb whose
    parameters are at data `0x80023100`);
  - `osAiSetFrequency(22050)`.
- **Output rate 22047 Hz** (verified: AI_DACRATE 2207 in the capture log). Audio frame 736 samples.
- **Three `alCSPlayer`s**, each with 16 voices, no oscillator callbacks (so the vibrato/tremolo fields of four
  instruments are ignored by the game):

  | | player 1 (main) | player 2 (X / watch / MP death) | player 3 (ambient) |
  |---|---|---|---|
  | play(song) / stop | `0x70006E7C` / `0x70006FD0` | `0x70007204` / `0x70007358` | `0x7000758C` / `0x700076E0` |
  | current song | `0x80024334` | `0x8002433C` | `0x80024344` |

  `play` stops the player, copies the compressed sequence to the end of the player buffer, inflates it with the game's
  inflater, then `alCSeqNew` / `alCSPSetSeq` / `alCSPPlay`. There is no loop API: songs loop only through their own
  loop markers.
- **Volume:** `alCSPSetVol(player, (vol × songVolume[song]) >> 15)`, with `songVolume` an s16 table at data
  `0x80024358` (64 entries + `0xFFFF`) and `vol` = `0x7FFF` or the music option.
- **Music state machine** `setMusicState` (`0x7F0C0C3C`, state at `0x800484C0`), verified by disassembly:
  - Stage start (`0x7F0C11FC`) enters state 1 (main on player 1), or state 4 (main + ambient) if the stage has an
    ambient song.
  - **X music** (states 2/5): player 2 plays the stage's X song and player 1 fades out over 0.5 s. A setup AI command
    (handler `0x7F039FE0`) arms one of 4 timers; the music returns to main when all expire.
  - **Watch menu** (state 3): player 2 plays song 24 (verified at runtime in Dam).
  - Death (hypothesis, code only): one player → player 1 plays song 27; multiplayer → state 6, player 2 plays song 58,
    and player 1 fades back in over 2 s.
- Front end (stage 0x5A) songs come from code constants: 44 at power-on (Nintendo/Rare logos), 2 at the gun-barrel
  intro, 23 in the menus (all three verified at runtime).

#### Data (verified: ROM data and the init code)

| item | ROM | notes |
|---|---|---|
| SFX `.ctl` / `.tbl` | `0x2EBDE0` / `0x2F19A0` | "B1", 1 bank, 261 sounds, 186 waves |
| music `.ctl` / `.tbl` | `0x3B4450` / `0x3B87F0` | "B1", 1 bank at +0x4258, 75 instruments, 138 sounds, 106 waves, rate 22050, no percussion |
| sequence table | `0x419790` | `u16 count = 63, u16 0`, then 63 × `{u32 offset from 0x419790; u16 size; u16 compressedSize}` |
| sequences | `0x41998C-0x438660` | 63 streams `11 72` + raw DEFLATE (compressedSize includes the 2 tag bytes); all inflate to `size` |
| song volume | data `0x80024358` | s16 × 64 |
| stage → music | data `0x8004EB10` | 23 × `{s16 stage; s16 main; s16 ambient; s16 X}` (−1 = none), stage 0 ends |
| random music list | data `0x8004EBD0` | s16 list, 0 ends (43 songs): used for stages not in the stage table (multiplayer-only maps) |

**Sequence format:** libultra compressed MIDI (`alCSeq`): 16 × u32 track offsets, u32 division (**384** in every song),
then per track `{varlen delta; event}` with `FE FE` = literal 0xFE, `FE hi lo len` = back-reference, note-on followed by
a varlen duration, `FF 51` tempo, `FF 2F` end of track, `FF 2E` loop start, `FF 2D count current offset32` loop end
(count 0xFF = forever). The 59 non-stub songs use only note-on, CC 7 / 10 / 91, pitch bend and program change
(verified by parsing). Every song sends CC 91, so music is reverberated in game.

#### Loops (verified from the sequence data; loop period checked on a capture)

- Loops come only from `FF 2E` / `FF 2D` markers with count 0xFF, **per track**; the game never restarts a song.
  Songs whose tracks all end play once (1, 38, 51, 60, 61, 62).
- Tracks don't always agree: the conductor track often ends 2 ticks after the loop end, some tracks loop shorter
  figures, and seven songs (4, 8, 28, 44, 50, 53, 55) are polymetric, so their tracks drift apart in the game.
- **Song loop region** (prototype `parseGeSequence`): run every track like `alCSeqNextEvent`. loopStart = the latest
  loop-start tick over looping tracks (or the last note + 1 of tracks that end). Period = the LCM of the track loop
  lengths when that is ≤ 8× the longest and ≤ 300 s, otherwise the longest track loop (the "≈" songs). Unroll events to
  loopStart + period and render; the WAV loop starts after the first pass's release tails.
- **Bomberman's `parseCompressedMidi` must not be reused as is:** it takes the loop end from the first track that
  reaches a forever loop, which is wrong here (song 41 would end at tick 3072 instead of 49152; songs 8, 24, 42, 44
  similar).
- Game timing: the game's pass is about 0.05% longer than the render (song 23 capture loop 668,416 samples vs 668,073
  rendered), from libultra's per-callback rounding (reproduced by simulation, `music/ts/drift.ts`). Inaudible; use the
  render's loop points.

#### Offline rendering

Prototype: `music/ts/gemusic.ts` + `render_all.ts` (imports `src/rom/music/libultra.ts` unchanged; all 63 songs in
26 s, 0.3–1.2 s each).
1. Entry i of the table → ROM `0x419790 + offset`; skip `11 72`, inflate to `size`.
2. `parseGeSequence` → a libultra.ts `Sequence`: division 384, µs per tick `(s32)((f32)tempo × (f32)(1/384))`, default
   tempo before the first `FF 51`, note durations, loopStartTick.
3. Bank: `parseBank(rom, 0x3B4450, 0x3B87F0, 0, null)`.
4. `seqVol = ((0x7FFF × songVolume[song]) >> 15) × 0.936` (the song volume table is in the inflated data segment).
5. `renderSequence(rom, bank, seq, {rate: 22047, maxVoices: 16, seqVol, loop, pitchScale: 1})`.

Not modelled: the custom reverb, alCSPlayer voice stealing (up to 27 dropped notes per song), the 0.05% rounding.

| check | method | result | evidence |
|---|---|---|---|
| sequences | inflate all 63; sizes vs table | all match | `fs/music/seq_NN.bin` |
| bank | `parseBank` from the viewer's `libultra.ts` | all pointers resolve; 75 instruments, 106 waves | `music/ts/gemusic.ts` |
| song selection | breakpoints on the three players' play functions over one boot | logos 44, gun barrel 2, menus 23, Dam 9, watch menu 24, Facility 7, random 34 for a Temple warp | `music/cap/songlog.txt` |
| RAM | player 1 buffer in Facility | identical to inflated sequence 7 | `music/cap/ram_fac.bin` |
| output rate | AI_DACRATE in the capture log | 2207 → 22047 Hz | `music/cap/cap1.raw.log` |
| rendered audio | envelope NCC, stretch, chroma, loudness vs 240 s capture | NCC 0.81–0.88, stretch 1.00, chroma 0.96–0.98 at 0 semitones; render gain ×0.936 | *Verification against captured game audio (verified)*, `music/cap/cap_*.wav`, `music/wav/` |

#### Music and sound

| item | evidence | confidence |
|---|---|---|
| **Unreferenced songs 1, 54 and 59**, in no stage table, random list or code constant, and reachable only through the disabled debug menu's music selector (which steps through 1–62). Song 1 is an 11-track 16.7 s sting (250 → 145 BPM, notes in the first 4.8 s); song 54 a 5-track 8 s loop at 150 BPM; **song 59 is a byte-identical copy of song 52** (a multiplayer track). Renders: `music/wav/song01.wav`, `song54.wav`, `song59.wav` | stage music table `0x8004EB10`, random list `0x8004EBD0`, constant scan, debug selector `0x7F0BD9EC` | verified, medium–high (song ids computed at run time are not excluded) |
| **Silent stub sequences** 0, 20, 30 and 39 (one event each) | sequence data | verified, high |
| **Citadel's theme, song 6**, is still heard: it is in the multiplayer random list | tables | verified, high |
| Nine songs are heard only through the multiplayer random list (5, 13, 33, 34, 35, 36, 45, 52, 56) | tables | verified, high (not unused) |
| Music instrument 5 is never selected by any song | sequence scan | verified, high |
| **54 of 260 sound-effect ids are referenced by nothing found:** 6, 8–10, 16, 34, 44, 53, 55–57, 59, 67, 78, 84, 86–88, 90, 94, 99, 101, 103, 104, 108, 114, 115, 119, 127, 129–133, 158, 169, 171, 175–180, 190, 193, 205–207, 251, 252, 254, 256, 259, 260 (contiguous gaps suggest whole groups) | 231 call sites of `sndPlay` `0x70008E08` (206 constants), static id tables, per-surface sound lists, item fields, the AI command `0xC4` in every setup; `unused/sfx_used.json` | verified (scan), **medium-low** (some id sources unresolved) |

### 5.3 Instruments and sample encoding

### 5.4 Music catalog and loop points

#### Song list (verified: data tables; [rt] = also observed at runtime)

GoldenEye has no jukebox, so names describe where each song plays. "X" is the stage's alternate track (*Engine (verified by disassembly, RAM and audio capture)*). Loops are
in samples of the render at 22047 Hz (`music/wav/index.json`); "once" = the tracks end and the song stops; "≈" = a
polymetric song whose tracks drift against each other in the game (*Loops (verified from the sequence data; loop period checked on a capture)*).

| # | name | ROM | tracks | BPM | loop (samples) | where it plays |
|---|---|---|---|---|---|---|
| 0 | silence (stub) | `0x41998C` | 1 | 120 | – | unreferenced |
| 1 | unused sting | `0x4199B6` | 11 | 250→145 | once | unreferenced (*Unused and hidden content*) |
| 2 | Intro (gun barrel) | `0x419B8C` | 15 | 135–145 | 210..1829875 | gun-barrel intro [rt] |
| 3 | Train | `0x41A43A` | 16 | 120 | 573230..3659613 | Train main; random list |
| 4 | Depot | `0x41B024` | 13 | 130 | 254237..3019858 ≈ | Depot main; random |
| 5 | Multiplayer 5 | `0x41BDC4` | 15 | 113 | 329884..2389098 | random list only |
| 6 | Citadel | `0x41CB5C` | 11 | 200 | 27182..2830646 | main of the cut Citadel stage 0x28; random |
| 7 | Facility | `0x41D91C` | 15 | 120 | 2040..2647511 | Facility main [rt]; random |
| 8 | Control | `0x41E3EA` | 16 | 120 | 176365..2998200 ≈ | Control main; random |
| 9 | Dam | `0x41EF48` | 15 | 140 | 531601..3214864 | Dam main [rt]; random |
| 10 | Frigate | `0x41FD4C` | 15 | 130 | 164539..2970830 | Frigate main; random |
| 11 | Archives | `0x420B2C` | 14 | 134/144 | 3018475..5957887 | Archives main; random |
| 12 | Silo | `0x421480` | 14 | 125 | 381017..3090153 | Silo main; random |
| 13 | Multiplayer 13 | `0x4222F0` | 16 | 200 | 101010..3010283 | random only |
| 14 | Streets | `0x42325C` | 10 | 140 | 3196..3631270 | Streets main; random |
| 15 | Bunker 1 | `0x423F5E` | 13 | 120 | 11045..3361975 | Bunker 1 main; random |
| 16 | Bunker 2 | `0x4245D0` | 9 | 105 | 3156..2824991 | Bunker 2 main; random |
| 17 | Statue | `0x424C50` | 15 | 98 | 680..2213840 | Statue main; random |
| 18 | Control (X) | `0x4255E8` | 9 | 250/120 | 16939..1516039 | Control X; random |
| 19 | Cradle | `0x425FC2` | 13 | 190 | 608..2672899 | Cradle main; random |
| 20 | silence (stub) | `0x426D22` | 1 | 120 | – | unreferenced |
| 21 | Caverns (X) | `0x426D4C` | 11 | 140 | 41776..684248 | Caverns X; random |
| 22 | Egyptian | `0x427392` | 15 | 133 | 119236..3617814 | Egyptian main; random |
| 23 | Menus | `0x42812C` | 7 | 95 | 172714..840787 | menus, folders, briefing [rt] |
| 24 | Watch menu | `0x42850E` | 7 | 80 | 352744..4320950 | watch (pause) menu [rt] |
| 25 | Aztec | `0x428700` | 15 | 115 | 323446..3588564 | Aztec main; random |
| 26 | Caverns | `0x429372` | 15 | 98 | 108179..5614090 | Caverns main; random |
| 27 | Death (solo) | `0x42A19E` | 15 | 150–171 | 216240..286745 | player death, 1 player (hypothesis) |
| 28 | Surface 2 | `0x42A504` | 15 | 100 | 0..3385336 ≈ | Surface 2 main; also the empty stage 0x2A; random |
| 29 | Train (X) | `0x42B2BA` | 15 | 122 | 44..1213737 | Train X; random |
| 30 | silence (stub) | `0x42BB5A` | 1 | 120 | – | unreferenced |
| 31 | Facility (X) | `0x42BB84` | 14 | 135 | 349..1019052 | Facility X; random |
| 32 | Depot (X) | `0x42C4DC` | 12 | 132 | 618..1122335 | Depot X; random |
| 33–36 | Multiplayer 33–36 | `0x42CC98`, `0x42D1E0`, `0x42D934`, `0x42DE54` | 13–15 | 135, 105, 155, 145 | 16905..1113969, 101503..1310861, 878..1093201, 5479..1026688 | random only |
| 37 | Archives (X) | `0x42E416` | 13 | 146 | 2087..1161597 | Archives X; random |
| 38 | Silo (X) | `0x42EB3A` | 14 | 140 | once | Silo X; random |
| 39 | silence (stub) | `0x42F42E` | 1 | 120 | – | unreferenced |
| 40 | Streets (X) | `0x42F458` | 9 | 150 | 2040..1271134 | Streets X; random |
| 41 | Bunker 1 (X) | `0x42FAC4` | 8 | 125 | 1344..1355912 | Bunker 1 X; random |
| 42 | Bunker 2 (X) | `0x43026A` | 13 | 140 | 219..1209577 | Bunker 2 X; random |
| 43 | Jungle (X) | `0x4308B8` | 14 | 123 | 43052..1075232 | Jungle X; random |
| 44 | Nintendo / Rare logos | `0x4310CE` | 13 | 125 | 1490377..1956010 ≈ | power-on logos [rt] |
| 45 | Multiplayer 45 | `0x431500` | 10 | 110 | 0..1154092 | random only |
| 46 | Aztec (X) | `0x431BB8` | 15 | 120 | 216..1234769 | Aztec X; random |
| 47 | Egyptian (X) | `0x43248E` | 16 | 138 | 95858..1322554 | Egyptian X; random |
| 48 | Cradle (X) | `0x432D3E` | 10 | 190 | 855..1225655 | Cradle X; random |
| 49 | Cuba (end credits) | `0x433408` | 13 | 160 | 475..1322533 | Cuba stage 0x36 main |
| 50 | Runway | `0x433C52` | 16 | 125 | 254026..3428794 ≈ | Runway main; random |
| 51 | Runway (X) | `0x434970` | 10 | 145–155 | once | Runway X |
| 52 | Multiplayer 52 | `0x434C4A` | 15 | 110 | 2041..1348481 | random only |
| 53 | Dam / Surface 1 (X), Surface 2 ambience | `0x435372` | 3 | 80 | 220470..1675479 ≈ | Dam X, Surface 1 X, Surface 2 ambient |
| 54 | unused 54 | `0x435894` | 5 | 150 | 105758..176263 | unreferenced (*Unused and hidden content*) |
| 55 | Jungle | `0x435AA0` | 10 | 125 | 601442..5850392 ≈ | Jungle main |
| 56 | Multiplayer 56 | `0x436228` | 14 | 127 | 1345..1001016 | random only |
| 57 | Surface 1 | `0x43684A` | 16 | 125 | 936578..5423584 | Surface 1 main; random |
| 58 | Death (multiplayer) | `0x4375B2` | 14 | 150–215 | 152296..218399 | music state 6 (hypothesis: MP death) |
| 59 | unused 59 (copy of 52) | `0x43787A` | 15 | 110 | 2041..1348481 | unreferenced; byte-identical to 52 (*Unused and hidden content*) |
| 60 | Surface 2 (X) | `0x437FA2` | 5 | 130 | once | Surface 2 X |
| 61 | Statue (X) | `0x43823E` | 4 | 94 | once | Statue X |
| 62 | Frigate (X) | `0x4383A4` | 9 | 138 | once | Frigate X |

Stage → music (data `0x8004EB10`, main / ambient / X): Bunker 1 15/–/41, Silo 12/–/38, Statue 17/–/61, Control 8/–/18,
Archives 11/–/37, Train 3/–/29, Frigate 10/–/62, Bunker 2 16/–/42, Aztec 25/–/46, Streets 14/–/40, Depot 4/–/32,
Egyptian 22/–/47, Dam 9/–/53, Facility 7/–/31, Runway 50/–/51, Surface 1 57/–/53, Jungle 55/–/43, Caverns 26/–/21,
Citadel (0x28) 6/–/–, Cradle 19/–/48, stage 0x2A 28/–/–, Surface 2 28/53/60, Cuba 49/–/–. Stages not in the table
(the multiplayer-only maps) pick a **random** song from the 43-entry list; verified once at runtime (a warp to Temple
picked song 34).

## 6. Unused and hidden content

### 6.1 Unreferenced assets

#### Unused content

See *Unused and hidden content*: each item names its evidence. The emulator tests (Citadel hang, stage 0x15 breakpoint, Cuba load, debug menu
opened by a RAM poke) are in `unused/shots/` and `unused/*_dbg.txt`.

Every item gives its evidence and a confidence rating. **Verified** items were checked against this ROM's data or
code, or seen in the emulator; the rest are marked hypothesis. Paths are relative to `ge/`
(most evidence is in `unused/`, notes in `notes/unused.md`). Reference scans are conservative in one direction only:
a thing found "unreferenced" may still be reached by an address computed at run time, and that is reflected in the
confidence.

#### Cut and unfinished stages

| item | evidence | confidence |
|---|---|---|
| **Citadel (stage 0x28, code `cat`)**: a cut arena (multiplayer-style: it has multiplayer environment records and was never given a solo setup; hypothesis on intent). Its BG file `bg_cat_all_p.seg` (0x5530 bytes) and clipping file `Tbg_cat_all_p_stanZ` survive, as do an environment record (colour `185038`, sky on, far 20000, and multiplayer variants 240/340/440), a memory configuration (`-mgfx100 -mvtx50 -mt650 -ma150`), main music **song 6**, and the names "Citadel"/"CITADEL" in the title bank (`0x9CAE`/`0x9CAF`). There is no `UsetupcatZ` or `Ump_setupcatZ` (the setup table still names `UsetupcatZ`), no multiplayer menu record, an empty text bank `Lcat`, and no case for 0x28 in the stage → text-bank switch | file table, stage/BG/environment/music/memory tables, text reference scan (`unused/stage_inventory.tsv`, `unused/text/text_refs.tsv`) | verified, high |
| **The Citadel doesn't load.** Requesting stage 0x28 in the emulator hangs with the last front-end frame on screen; the registers show the switch default `0x7F0C16DC` (an endless `b .`) called from the setup loader (`ra 0x7F003D84`) | `unused/shots/citadel_warp_solo_frozen.png`, `unused/citadel_crash_dbg.txt` | verified, high |
| **The Citadel's clipping file is an older format** the retail code can't read: float points, per-tile names ("p502a2" …), and a name table. It holds 485 tiles in 46 rooms; every byte is accounted for, all 1,122 links resolve, and each room's tiles lie inside that room's BG box. All 26 other stan files use the compact s16 format of *Clipping ("stan") files and floor height (verified: all 26 regular non-empty files; RAM on 14 captures; code)*, which reads 0 tiles from `Tbg_cat`. So even with a setup and a text case, the retail game would have no usable floor for it. The layout is in *Clipping ("stan") files and floor height (verified: all 26 regular non-empty files; RAM on 14 captures; code)*; the viewer decodes it and shows the tiles in the Citadel's hidden "collision" layer (485 tiles over the 46 rooms, aligned with the floors) | `unused/stan.py`, `unused/stancheck.ts`, `unused/renders/citadel_stan_tiles_top_by_room.png`; viewer `stan.ts parseStan` | verified (format), high; "retail can't use it" is static inference, high |
| **Citadel renders** (the BG parses and renders like any retail BG): 46 rooms, 52 portals, 1,101 triangles, all opaque, and three textures (901, 315, 710), all shared with Severnaya, Control, Caverns and Facility. The layout is a square arena around a star-shaped central hub with a pyramid, four quadrants (a grove of cross-shaped pillars, a room of tilted blocks, triangular floor wedges, raised ramps and walkways) and a sunken area under the hub, with tall white spikes. Lead viewed the overview and an eye-level view | `bg/renders/bg_cat_citadel_unused_overview.png`, `_top.png`; `unused/renders/citadel_bg_cat_overview_34.png`, `citadel_bg_cat_top.png`, `citadel_eye_room01_open_floor.png`, `citadel_eye_room03_open_floor.png`, `citadel_eye_room04_open_floor.png` | verified, high |
| **Nine empty stage slots:** `sho` 0x2A, `eld` 0x2C, `lue` 0x2F, `rit` 0x31, `ear` 0x33, `lee` 0x34, `lip` 0x35, `wax` 0x37, `pam` 0x38. Each has names in the setup and BG tables, zero-byte BG and stan entries (`Tbg_sho` is not even in the file table), empty text banks, no setups, no menu entries and no text case (loading hangs). `sho` alone keeps a music entry (song 28, shared with Surface 2) | tables, file table | verified, high |
| **Duplicate stage 0x15 "sevbunker"**: a setup-table entry only (no BG record, briefing or menu). Requesting it loads `UsetupsevbunkerZ`, then hangs in the text switch (breakpoint on `0x7F0C16DC` hit with `a0 = 0x15`) | `unused/stage15_dbg.txt`, `unused/shots/stage15_hang.png` | verified, high |
| **`bgx` slot (0x39):** the BG table ends with id 0x39 naming `bg/bgx.seg` and `TbgxZ`; neither file exists (hypothesis: a generic or test BG slot) | BG table `0x8004448C` | verified, high |
| **Unused multiplayer setups for Statue and Cradle:** `Ump_setupstatueZ` and `Ump_setupcradZ` are complete multiplayer maps: 8 spawns, 9 weapon slots, 16 ammo boxes and 2 body armours, the same template as Archives or Complex. Neither is in the 12-entry multiplayer menu (Random, Temple, Complex, Caves, Library, Basement, Stack, Facility, Bunker, Archives, Caverns, Egyptian). They couldn't be tested live: the headless harness has one controller, so MULTIPLAYER is greyed out | `unused/mp_setups_summary.txt`; placement renders `unused/renders/setup_statue_mp_overview.png` (lead viewed: spawns in open areas between statues, weapon and ammo clusters), `setup_crad_mp_overview.png` | verified (data), high; reachability tested statically only |
| Lower-case placeholder names in the title bank: `0x9CB0`–`0x9CB7` "dest", "stat", "crad", "cradle", "azt" (unreferenced) | text reference scan | strings verified; reading them as planned multiplayer maps for Frigate, Statue, Cradle and Aztec: medium |
| Unused stan files `Tbg_imp_all_p_stanZ` and `Tbg_ash_all_p_stanZ`: Basement and Stack use Library's BG and `Tbg_ame`, so only the file table names their own (identical-size) files | BG table, name scan | verified (names), medium (unused) |
| Memory-config entries for stage ids **0x5B** and **0x63**, which have no setup, BG or text | table `0x800241BC` | verified; meaning unknown |
| **Not cut: Cuba (0x36, `len`)** is the ending stage after Antenna Cradle (the debrief requests 0x36 when the completed mission index is 17); it loads in the emulator with the jungle ending dialogue | `0x7F0168E0`; `unused/shots/cuba_0x36_warp_1.png` | verified, high |

#### Debug features

| item | evidence | confidence |
|---|---|---|
| **Debug menu, 77 items, still wired into the main loop but disabled.** The main loop calls `debugMenuTick` (`0x7F0905A0`) only while `0x80024300` ≠ 0, and nothing writes that flag. With the flag poked to 1 and C-Up + C-Down held on controller 1, the menu opens and responds to the D-pad (cursor moved 0 → 3 in Dam) | disassembly `0x70006508`, `0x70006580`; emulator (RAM) | verified, high |
| **The menu doesn't show in the emulator's video output**, though its text is written to the debug text grid (`0x80025030`, 80 × 35 cells) and the DL builder runs. The grid, drawn offline with the game's own 4×7 debug font (a 128×21 IA8 sheet at `0x80024520`), shows the whole menu: move view, stan view, bond view, level, region, scale, play title, bond die, select anim, gun pos, flash colour, hit colour, music, sfx, invincible, visible, collisions, all guns, max ammo, display speed, background, props, stan hit/region/problems, print man pos, port close/inf/approx, pr room loads, show mem use/bars, grab rgb/jpeg/task, rnd walk, record ramrom, record 1–3, replay/save/load ramrom, auto y/x aim, 007, agent, all, fast, objectives, marg top/bot/left/right/reset, screen size/pos, show patrols, intro, intro edit/pos, world pos, gun key pos, vis cvg, chr num, room blocks, profile, obj load, weapon load, joy2 sky/hits/detail edit, explosion info, magic fog, gun watch pos, testing man pos, fog. Lead viewed | `unused/dbgtextgrid.bin`, `unused/renders/debugmenu_textgrid_rendered_with_rom_font.png` | render verified, high; why Glide64 draws nothing: hypothesis (the plugin drops these TEXRECTs), medium |
| **What the items do** (jump table `0x800556FC`): background and props hide those layers (flags read by the BG renderer); **vis cvg** is the flag the Line Mode cheat sets, and **fast** the flag Turbo Mode sets; **music** steps through all songs (the only way to hear songs 1, 54, 59); **sfx** steps through sound ids; 007/agent/all unlock difficulties or missions in the front end; grab rgb/jpeg/task print IRIX host commands (`uix2pix`, `imgcopy -fjfif`, `u64.taskgrab.%d.core`); record/save/load ramrom use host files `replay/demo.%d`; **profile** calls empty stubs (profiler removed); **joy2 sky edit** has no reader; rnd walk and the five margin items do nothing | disassembly | verified (static), high for the listed handlers |
| **Development command-line options** parsed by code: `-level_NN`, `-hard`, the memory options `-ml -me -mgfx -mvtx -mt -ma` (default string `-ml0 -me0 -mgfx100 -mvtx50 -mt700 -ma400`), `-nochr`, `-noprop`, `-noobj`, `-stanlinelog`, `-stanshow_`. A retail cartridge has no argument source | `0x7000A6A0` call sites | verified, high |
| **Dead host code:** `"sleep 5; /etc/killall ghost gload"` (kills the SGI development kit's debugger/loader) is used only by `0x7F0D0154`, which has no callers | xref | verified, high |
| **Orphan "complete everything" routine** `0x7F01ED10`: sets all 20 missions × 3 difficulties to completed with time 99999999; no callers or pointers | xref | verified, high |
| Build date `Jun 29 1997 20:46:05` (`0x8005C000`): not referenced by code or data | pointer scan | verified, medium |
| `*_c_debug` markers (`deb boss memp mema vi joy stan bg ob dyn lv rsp game`), each loaded by one module-init instruction; a profiler overlay (`utz/rsp/tex %2.0f%%`, `%2d hz`); libultra assertion strings | xref | verified; purpose hypothesis |
| **Attract demos are present and used** (not unused, but hidden data): 14 controller recordings with a 232-byte header (stage +0x10, difficulty +0x14, random seeds, options) and checksummed frames of stick/button samples, filling ROM `0x2BF2D0..0x2E63F0` exactly. Stages: Dam ×2, Facility ×3, Runway ×2, Bunker 1 ×2, Silo ×2, Frigate ×2, Train; all are in the title-idle random pool | table `0x800483F0`, picker `0x7F0C0970` | verified (static), high |

#### ZX Spectrum emulator

| item | evidence | confidence |
|---|---|---|
| **A Z80 CPU core is present** (~61 KB of game code `0x7F0D2C84..0x7F0E2700`): a 256-entry opcode dispatch (`0x8005C12C`, 256 distinct handlers), a second 256-entry prefixed table and a 64-entry sub-dispatch; machine setup builds the Z80 parity table, a 32×24 attribute map and 64 KB of Z80 address space | pointer tables, disassembly | verified, high |
| It loads `em/data/spec_rom.seg.rz` (16 KB → Z80 address 0, the 48K ROM) and a game snapshot as a **.SNA** (27-byte header parsed into the Z80 registers, 48 KB copied to 0x4000). Names: Sabre Wulf, Atic Atac, Jetpac, Lunar Jetman, Alien 8, Gunfright, Underwurlde, Knight Lore, Pssst, Cookie; **indices ≥ 5 are clamped to 0**, so only the first five could ever load | `0x7F0D2FC4`, `0x7F0D30B0..0x7F0D3370`, name table `0x8004ED2C` | verified, high |
| **Launcher = front-end menu 25**, which picks a game from controller 3's buttons (`0x7F01A39C`). No code ever calls `setMenu(25)` | call-site scan of `setMenu` | verified (static), medium-high |
| **No Spectrum data in the ROM:** no `em/` files in the file table, and a signature search of the raw ROM and every DEFLATE stream (48K ROM start `F3 AF 11 FF FF C3 CB 11`, "1982 Sinclair Research", BASIC tokens, font bytes, titles) finds only the file-name strings | `unused/zxscan.py` | verified, high |

#### Cheats

- **Table** `0x8003F80C`: 74 × 16 bytes `{u8 id; u8 codeLength (0/10); u16; u16* code; u16 nameText; u16; u32 flags}`
  (flags: 0x01 front end, 0x02 solo, 0x04 multiplayer, 0x10 one-shot, 0x20 all players). A 10-press button code is
  matched against a 20-entry input ring (`0x7F09177C`). Unlocks: menu 21 lists a cheat when `cheatAvailable(id)`
  (`0x7F009848`) is true, which mostly means beating a mission under the target time in `0x8002B564` on a given
  difficulty (Paintball = Dam, Secret Agent, 2:40; Invincible = Facility, 00 Agent, 2:05 …). **Magnum, Laser and Golden
  Gun** are unlocked by completing Cradle, Aztec and Egyptian instead of by time. Full table with button codes:
  `unused/cheats.json`, `notes/unused.md` *Objects and props* (verified, high).

| item | evidence | confidence |
|---|---|---|
| **Cheats that can never be unlocked or entered:** 8 "super x2 health", 9 "super x2 armor", 13 "extra weapons", 16 "super x10 health", 25 (toggles the "testing man pos" debug flag). No button code, and `cheatAvailable` returns 0; their effect code and messages are intact | `unused/cheatavail.dis`, `cheats.json` | verified (static), high |
| **Code-only cheats with no menu entry:** 1, 4 (max ammo), 5 (no effect), 6 (multiplayer: switch other players' invincibility off), 7 (Line Mode has a code *and* a menu name), 22 (multiplayer), and 35–74. Codes 35–54 grant mission N's time reward; 55–74 appear to mark missions complete | button-code table `0x8003F430`, activation cases | verified (codes); meaning of 55–74 hypothesis |
| **Names with no cheat:** "Bond Phase" (`0xB005`) with orphaned "bond phase on/off" messages; "Super x2 Health", "Super x2 Armor", "Super x10 Health" names exist, but cheats 8/9/16 use "NO NAME" | text reference scan | verified, high |
| Unreferenced animation-speed messages "slowest/very slow/normal/very fast/fastest motion" and "radar on" (only "slow" and "fast" motion are used): a cut stepped speed control (hypothesis) | text reference scan | strings verified, high; meaning medium |

#### Unused props, characters, models and textures

| item | evidence | confidence |
|---|---|---|
| **103 of 340 props are placed by no setup and referenced by no code table found.** Finished models among them: crates and furniture (green ammo crates 4/5, bin, blotter, large card boxes, desk 2, letter tray, wire-cage metal crate, hazard crate, wooden crates), the second Severnaya "GoldenEye" console half `console_sev_GEb`, phone, sat box, oil drums 1/2/3/5/6, missile racks, torpedo rack, the Frigate harpoon launcher, 13 doors (sev_door, steel doors, roller doors, Arecibo, Frigate, gas-plant, train, depot gate and steel door), fur hats and the grey helmet, a jungle tree, a bollard, a magenta test tube, and **vehicles: an articulated lorry cab and trailer, a Hind helicopter, an APC, a speedboat, an Escort-style car and a black ZIL limousine** | obj agent's never-placed list minus the dropped-weapon table `0x8002BA38`, the thrown-item table `0x8002A23C` and front-end constants; `unused/props_unused_final.json`; sheet `unused/renders/props_unused_final_sheet.png` (lead viewed) | verified (scan); unused: medium-high for finished furniture, doors and vehicles |
| Magazine and shell props, silencer, extinguisher, explosion debris: probably spawned by code | same | low (as "unused") |
| **23 props are one byte-identical placeholder "cube"** (a wireframe-textured box), including the silver and gold PP7, bomb, credit card, dark glasses, door exploder, dynamite, explosive pen, finger gun, flare pistol, gold bar, heroin, lectre, lock exploder, microcode, microfilm, money, piton gun, spool tape, spy file and wrist dart props | md5 of the files | verified, high |
| **Characters never used:** `CbluewomanZ` (0x1A), `CgreymanZ` (0x1E) and `CbluemanZ` (0x1F) appear only in the random-body pool, which no setup guard uses (no guard has body −1). Every head and every other body is used: by setups, the multiplayer character select (`0x8002B198`), the cast roll (`0x8002B5FC`), or Bond's outfit code | `unused/renders/chr_candidates_posed.png` | verified (scan), medium (a script-spawned random guard could still reach the pool) |
| **Five gadget item models the game can't draw:** `GdynamiteZ`, `GexplosivepenZ`, `GextinguisherZ`, `GfingergunZ` and `GwristdartZ` are in the file table but have no `ModelFileHeader` in the data segment. With a synthesised header they render: dynamite, explosive pen, finger gun and wrist dart are byte-identical grenade-like placeholders, the same file 16 real items use as their first-person model. Only **the extinguisher is real art** (250 triangles) | file table; `unused/gadgets.ts`, `unused/renders/gadgets_unheadered_G_models.png` | verified, high; "planned gadgets": medium |
| **Textures: 310 of 2,698 are referenced by nothing found.** 1,685 aren't used by BG files; subtracting every model texture record (1,445 numbers), the sky and water textures (2228, 1508, 1509) and the texture lists in ROM `0x29DC28..0x29E54C` (front end, HUD, explosions, watch) leaves 310. Notable: maritime signal flags, mountain/sky photo strips (#950–958), signs "UNAUTHORISED", "PERSONNEL" and "RESTRICTED AREA", **face and head textures with no model** (#1556–1559, #1696–1710, #1817–1819, #1883–1889, #1928–1930, #2061–2063, #2503), explosion and smoke sequences, jungle foliage, **street signs** (give way, speed 50/70; #2388–2419), horizon strips, "OHMSS" (#2537) and a lava texture | `unused/texture_refs_final.json`; sheets `unused/renders/tex_final_unused_00.png`, `_01.png` | verified (scan), medium (code may build DLs with texture numbers directly, e.g. the explosion sprites) |
| **Two corrupt textures** #2246 and #2260 (64×32 I8): the only entries whose decode doesn't consume exactly their ROM size; they decode as noise and nothing references them | `bg/lib/getex.ts`; texture reference scan | verified, high (corrupt or placeholder: medium) |
| No leftover data after any compressed file: all 681 end in zero padding after the DEFLATE stream | tail scan | verified, high |

#### Text

Every English text bank and briefing was dumped (`unused/text/L*E.txt`) and each string id searched in code
immediates, the data segment, briefings and setups (`unused/text/text_refs.tsv`). Unreferenced strings (verified by the
scan; confidence medium, since the loose scans over-report and ids built at run time can't be seen):

| bank | unreferenced strings | reading |
|---|---|---|
| stat (Statue) | "null", Trevelyan/Bond reveal lines, "3 Minutes until helicopter bomb explodes.", five Mishkin arrest lines, "Proximity fuse triggered…" | a cut Statue Park ending |
| sevb (Bunker 2) | a Bond/jailer "stomach hurts" exchange, "Natalya: Nice work.", "Natalya has died." | a cut escape sequence |
| arch (Archives) | "Mishkin: General Ourumov is our traitor.", "Bond: Even trusted friends are capable of betrayal.", "Mishkin: It is in the safe." | cut interrogation lines |
| ark (Facility) | "Dr. Doak: You'll need this decoder to open the bottling room door. Good luck, 007.", "Ourumov: One...", **"Ourumov: 1"**, Trevelyan lines, "Double agent contact has been killed!" | cut dialogue and a placeholder |
| sev (Bunker 1) | **"hello"**, "The programmer has escaped without activating the computer!" | developer placeholder, cut objective |
| cave (Caverns) | "Mission Failure: Unacceptable non-military casualties!", **"pursue trevelyan"** | placeholder |
| azt (Aztec) | "This mainframe controls the shuttle launch sequence.", "Shuttle exhaust bay closed! Launch holding at T minus 10 seconds." | cut objective messages |
| tra (Train) | Natalya cracking Boris's password ("You're a slug-head, Boris!") | cut dialogue |
| arec, dest, pete, sevx, silo | Boris "Please don't shoot!", bomb-defused messages, civilian-casualty failure, "Surveillance camera disabled.", "Ourumov: Kill him!" … | cut or alternate messages |
| crad, jun | nine Trevelyan taunts, Natalya quips ("Oh, that's a nice plant.", "Advantage, Natalya Simonova.") | possibly chosen at random by AI scripts (not checked) |
| len (Cuba) | ten credit roles with no name (3rd Scenic Artist, Electrical Best Boy, Dolly Grip …) | credits may be table-driven |
| title | "Citadel"/"CITADEL", the lower-case map names (*Cut and unfinished stages*), "CHEAT OPTIONS:", "second", "s" | cut stage and menu leftovers |
| empty banks | `Lame Lash Lcat Ldish Lear Leld Limp Llee Llip Llue Loat Lpam Lref Lrit Lsho Lwax`: 32 zero bytes each, E and J | stages that never had text (multiplayer-only or cut) |

### 6.2 Cut or inaccessible levels

### 6.3 Debug features

### 6.4 Prototype or revision-specific content

## 7. nviewer implementation

### 7.1 Module mapping

#### What the viewer should show

- **Meshes:** standard objects, doors (closed), glass and tinted glass (blend), monitors, alarms, CCTV, autoguns, safes,
  vehicles, aircraft and tanks (at their setup pads), ammo boxes, body armour, keys, magazines, and weapons and hats
  on pads (skip flags 0x4000: held by or on a guard).
- **Guards:** body + head at the pad in the sampled standing pose (a static per-joint table from
  `obj/out/guard_pose_local_rotations.json`), or `Marker`s if that is out of scope.
- **Markers:** spawn pads ("spawn set N"), gas-release volumes, cutscene cameras.
- **Skip:** door scale (apply it), logic, AI and objective records (0x0E, 0x12, 0x13, 0x16–0x23, 0x25, 0x26, 0x2C, 0x2E),
  and gunfire/effect nodes inside models.
- **Layers:** "objects", "guards", "pickups" (weapons, ammo, armour, keys) and "markers" (`LevelLayer`), so users can
  hide pickups and markers.
- **Multiplayer maps:** load `Ump_setup{code}Z` (8 spawns, weapons and ammo as placed by the setup; the game swaps
  weapon models by the chosen weapon set, which the viewer can ignore). Basement and Stack differ from Library only
  in setup.

#### Reusable modules

| existing module | reuse for GoldenEye | changes needed |
|---|---|---|
| `inflate.ts` `inflateRaw` | every 1172 stream (files, rooms, zlib textures, sequences, the data segment) | none: call with `offset = start + 2` (*Compression: "1172" = two header bytes + raw DEFLATE (verified bit-exact)*; verified on all 6,863 streams) |
| `displaylist.ts` `runDisplayList` | BG room lists (and model lists, *New modules (suggested names)*) | new `'f3d'` ucode (*`displaylist.ts`: the `'f3d'` ucode (exact patch: `bg/lib/displaylist.diff`, 91 lines)*) |
| `texture.ts` | – | none; GoldenEye textures are decoded by a new module straight to RGBA (*Textures (verified unless marked)*) |
| `music/libultra.ts` `parseBank`, `renderSequence` | all music | none (verified by the prototype); a new per-track sequence parser (*Music mapping*) |
| `util.ts` `pruneUnused`, `emptyBounds` | level assembly | – |

#### `displaylist.ts`: the `'f3d'` ucode (exact patch: `bg/lib/displaylist.diff`, 91 lines)

- `Ucode = 'f3dex' | 'f3dex2' | 'f3d'`; `G_CULL_BACK.f3d = 0x2000`.
- New context options: `rareTexture?(w0, w1) → {texture, width, height, uls, ult} | null` (resolves C0) and
  `vertexOffset?: [x, y, z]` (the room position, added before scaling).
- The `'f3d'` command switch: `04` Fast3D G_VTX (4-bit count and start), `BF` G_TRI1 with indices ÷ 10, `B1` four
  triangles (*Display-list microcode (verified: opcode histogram over every stored list, disassembly, frame DLs)*), `C0` → `ctx.rareTexture`, `BB` G_TEXTURE, `B6`/`B7`/`B9`/`BA` as F3DEX 1.x, `06` G_DL, `B8` G_ENDDL,
  everything else to the shared RDP handler.
- Texture selection for `'f3d'`: the batch texture is `st.rare.texture` when texturing is on and the combiner uses
  the texel; UVs use the C0 tile (`(s × scale / 32 − uls) / width`).
- **Alpha:** for `'f3d'`, vertex alpha is multiplied by the ENV alpha (`FB`), reproducing the game's combiner patch
  (*Render state (verified: frame DLs of 13 captures and game-camera composites)*). The diff includes it.
- Callers pass `mirrorX: false`, `vertexScale: 1` (or the stage scale, *Units, scale, handedness, camera (verified)*), `decals: true`, and initial geometry
  mode G_ZBUFFER. For BG, force `cullBack = false` on the resulting batches (*Render state (verified: frame DLs of 13 captures and game-camera composites)*); models keep the lists' cull flags.
- GPU bilinear filtering: use `uls = ult = 0`. The game's half-texel tile offset compensates for the RDP's sampling
  position, which OpenGL already samples at texel centres.

#### New modules (suggested names)

| file | contents | difficulty |
|---|---|---|
| `src/rom/goldeneye/rom.ts` | data segment inflate (ROM 0x21990 → base 0x80020D90), file table (*File table (verified)*), text banks (*Text banks (verified)*), stage tables (*Tables (verified: data segment; generator `fs/levels/levels.py` → `fs/levels/levels.tsv`)*), texture table (*Textures (verified unless marked)*) | low |
| `src/rom/goldeneye/textures.ts` | port of `bg/lib/getex.ts`: the zlib and bit-packed texture codecs → level-0 RGBA, with a per-ROM cache keyed by texture number | medium (1,230 lines to port, but a verified reference exists and has no dependencies) |
| `src/rom/goldeneye/bg.ts` | BG file → meshes: room table, inflate streams, `runDisplayList('f3d')`, winding swap, blend/decal from the lists, no culling (port of `bg/lib/bgfile.ts` + `gebg.ts`) | low–medium |
| `src/rom/goldeneye/music.ts` | sequence table, song volumes, per-track compressed-MIDI parser with GoldenEye loop rules, names; renders through `libultra.ts` | low |
| `src/rom/goldeneye/goldeneye.ts` | `Game`: level list, `loadLevel` (BG + environment + setup objects), `music`/`decodeMusic` | medium |

#### Music mapping

- `Game.music`: 59 tracks, every sequence except the silent stubs 0, 20, 30, 39, in sequence order, named `NN Name`
  as in *Song list (verified: data tables; [rt] = also observed at runtime)* (e.g. `09 Dam`, `53 Dam / Surface 1 (X), Surface 2 ambience`).
- `decodeMusic(i)`: `{sampleRate: 22047, channels: [L, R], loopStart, loopEnd}`; no loop for songs 1, 38, 51, 60, 61,
  62. Gain `seqVol × 0.936` (*Verification against captured game audio (verified)*).
- Port `parseGeSequence` from `music/ts/gemusic.ts`. Do **not** reuse Bomberman's `parseCompressedMidi`: its
  first-track loop rule gives wrong loops here (*Loops (verified from the sequence data; loop period checked on a capture)*). A shared per-track parser should leave Bomberman unchanged where
  all tracks loop together (hypothesis: re-check Bomberman renders).
- Cost 0.3–1.2 s per song in Node: render on demand in the worker. Risks: no reverb (drier than the game), note drops
  where libultra would steal voices, approximate loops for the seven polymetric songs.

#### Additions to `src/rom/types.ts` and the renderer

| addition | why | suggested shape |
|---|---|---|
| `Game.id` `'goldeneye'` | new game | – |
| sky as a world-height plane | GoldenEye's cloud layer is a horizontal plane at a fixed world height whose texture is mapped by world x/z (*Environment: fog, clear colour, sky (verified: disassembly and 12 captured frames)*); a camera-centred mesh (the current `Sky`) loses the parallax and scrolling | `Sky.plane?: { height: number; uvScale: number; colorOverhead: [r,g,b]; colorHorizon: [r,g,b] }`: the renderer draws a large quad at `height` under the camera's x/z, UV = world xz / uvScale, colour faded by elevation as in *Environment: fog, clear colour, sky (verified: disassembly and 12 captured frames)*. Approximation without renderer changes: a camera-relative quad at `height − eye y` with a fixed vertex-colour gradient |
| texture × (shade − env) + env combine | the sky combine lerps between env colour and shade by the texel | bake into the sky texture: texel' = env + (cloud − env) × texel, drawn with vertex colour 1 at the zenith, faded to 0 at the horizon |
| optional water plane | Frigate | a second `Sky.plane` below the eye at −150 world units, texture 1509 |
| `Instance`/`Mesh` layers | objects, guards, pickups and markers are toggled independently | existing `LevelLayer` + `Marker` suffice |

No other type changes: `Fog`, `clearColor`, `CameraView`, `Marker` and `LevelLayer` already cover GoldenEye.

#### Suggested modules (continued from *New modules (suggested names)*)

| file | contents | difficulty |
|---|---|---|
| `src/rom/goldeneye/setup.ts` | setup header, pads, bound pads, object record sizes and model-bearing fields, intro spawns (port of `obj/lib/setup.ts`) | low |
| `src/rom/goldeneye/models.ts` | model file nodes → rest-pose batches through `runDisplayList('f3d')` with segment 3/4/5 resolution and the per-node matrix slots; the sampled guard pose table; heads (port of `obj/lib/model.ts`, `chr.ts`) | medium |
| `src/rom/goldeneye/place.ts` | *Placement (verified against RAM on 8 stages, 1,299 objects)* placement math (port of `obj/lib/place.ts`) | medium (many flag cases, but verified exactly against RAM) |
| `src/rom/goldeneye/stan.ts` | clipping-file floor lookup for object and camera Y (*Clipping ("stan") files and floor height (verified: all 26 regular non-empty files; RAM on 14 captures; code)*) | low (port `obj/lib/stan.ts`: tile parse + plane height + grid) |
| `src/rom/goldeneye/environment.ts` | tables A/B → `Fog`, `clearColor`, sky plane | low |

#### Difficulty summary

| part | difficulty | notes |
|---|---|---|
| ROM, codec, files, text, stage list | low | `inflateRaw` unchanged; tables are plain data |
| textures | medium | two codec families; an instruction-level reference port exists and matches RAM |
| BG geometry | low–medium | small `displaylist.ts` patch; rooms are independent |
| environment (fog, clear colour) | low | one table; verified against 12 frames |
| sky plane | medium | needs a small renderer feature for a faithful look; a static approximation is easy |
| props, doors, pickups | medium | model node walk + placement flags; verified exactly |
| guards | medium–high | no animation decoding; a sampled standing pose works for all bodies |
| music | low | `libultra.ts` unchanged; per-track loop parser |

#### Known gaps to list in the README (proposed)

- GoldenEye: animated textures and the water ripple are static; environment-mapped surfaces use plain UVs; guards
  stand in one sampled pose; objects spawned by AI scripts and objective logic are not shown; the visibility commands
  and portals are ignored (all rooms drawn); the sky is approximated; music has no reverb.

### 7.2 Supported features

### 7.3 Approximations and omissions

## 8. Verification and remaining work

### 8.1 Verification evidence

#### Verification against captured game audio (verified)

240 s of one boot (logos → menus → Dam → watch menu → Facility) captured with the audio-dump plugin
(`music/cap/cap1.raw`), compared with renders by 50 ms RMS-envelope NCC with an offset and time-stretch search, dBFS,
and 12-bin chroma (`music/ts/compare.ts`). The play calls were logged with breakpoints (`music/cap/songlog.txt`).

| piece | song | envelope NCC | best stretch | chroma at 0 semitones (best other shift) | capture / render dBFS | amplitude factor |
|---|---|---|---|---|---|---|
| Nintendo/Rare logos | 44 | 0.81 | 0.995 | 0.962 (0.779) | −15.7 / −13.8 | ×0.803 |
| gun-barrel intro | 2 | 0.83 | 1.000 | 0.979 (0.698) | −17.1 / −16.6 | ×0.950 |
| menus | 23 | 0.82 | 0.99 | 0.972 (0.688) | −22.9 / −21.2 | ×0.817 |
| Dam | 9 | 0.88 | 1.000 | 0.974 (0.755) | −20.4 / −19.6 | ×0.916 |
| Facility | 7 | 0.86 | 1.000 | 0.962 (0.737) | −23.5 / −22.5 | ×0.892 |

- Output rate 22047 Hz (AI_DACRATE 2207). Tempo stretch 1.00 on the long pieces; pitch correct (chroma peaks at 0
  semitones).
- Mean amplitude factor ×0.876 (−1.15 dB), i.e. **seqVol × 0.936** (the mixer squares volume). The loud front-end
  songs clip in the game's own output as well.
- RAM (Facility): player 1's buffer `0x802D1E10` holds exactly the 4,078 inflated bytes of sequence 7.
- Renders are drier than the game (no reverb).

### 8.2 Known unknowns

#### Open questions (all hypothesis or unverified)

ROM and files:
- Formats of the region-0 tables at `0x117940` / `0x123040` (probably Japanese glyphs), `0x28E980` (animation index?),
  `0x29E560` and `0x2A4D50` (front-end models?).
- Stage ids 0x5B and 0x63 in the memory-config table.

Level geometry:
- Why the game draws the reverse-wound BG triangles with CULL_BACK set (needs an LLE or hardware reference).
- The visibility command bytecode (Dam ops 04 14 1E 1F 20 5A 5C 64 65) and `0x7F0B5E88`; C0 modes 0/3/4 and the
  two-texture mode; the texture table's flag byte.
- Whether no-depth BG batches (backdrop rooms) must be drawn first; the animated handler of texture 1508; the three
  environment-mapped BG surfaces.
- Mip-level bytes differ from RAM in 5 textures (level 0 is exact); #2246 and #2260 don't decode cleanly.

Environment and camera:
- What selects the id + 100 environment records and when scripts switch to the id + 900 ones; table-A fields
  +0x0C..+0x1C.
- Which of several spawn records the game picks; the constant ~3.9° downward pitch of the frame's view.
- The Frigate water's second texture layer; whether the Glide64 water and horizon wedge differ on hardware.

Objects:
- Animation data (region `0x124AC0`) is not decoded: guards use one sampled standing pose.
- The runtime surface search that stacks objects on other objects; tinted glass and some glass sitting at the pad
  position instead of the box bottom; gas-release volumes offset by a constant; guard facing (pad look assumed) and
  guard fields +0x0E..+0x14; random body/head choice; intro camera fields; door open state.
- Tbg_pete's tile room byte reads 55 against 18 BG rooms.

Music:
- The custom 6-section reverb is not rendered; alCSPlayer voice stealing is not modelled; death songs 27/58 and the X
  music trigger are from code only; the real multiplayer menu (needs several controllers) was not run; a few front-end
  play sites are unidentified.

Unused content:
- Why the debug menu draws nothing under Glide64; the meaning of cheats 55–74; 54 sound effects with no reference found
  (medium-low); whether the unreferenced Cradle/Jungle taunts are picked by AI scripts.

### 8.3 References
