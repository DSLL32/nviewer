# Bomberman 64 — Nintendo 64 ROM format specification

This manual describes the shipped data formats needed to identify, extract, and
present Bomberman 64 content. Claims state their evidence inline; unsupported
interpretations are labelled hypotheses.

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | Indexed archive at ROM `0x300000`; stage code in overlays. |
| Compression | Hudson LZSS with a 1 KiB ring. |
| Graphics microcode | F3DEX 1.x. |
| Geometry | Hudson “64” model containers and stage map parts. |
| Textures | RDP texture commands plus `G_LOADTILE`. |
| Collision | Per-stage attribute grid. |
| Music driver | libultra `alCSPlayer`. |
| Audio microcode | libultra `aspMain` ABI1. |
| Sample encoding | Nintendo VADPCM. |
| Levels | Adventure areas and battle stages. |
| Memory requirement | Base 4 MiB. |
| Viewer support | USA revision 0. |

### 1.2 ROM identification

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| USA | `BOMBERMAN64U` | `NBME` | 0 | 8 MiB (`0x800000`) | `F568D51E` | `7E49BA1E` | `8a7648d8105ac4fc1ad942291b2ef89aeca921c9` | CIC-6102 | — |
| Europe | `BOMBERMAN64E` | `NBMP` | 0 | 8 MiB (`0x800000`) | `5A160336` | `BC7B37B0` | `01e50f41733994bf229bee3b3d8aa9fd46441175` | CIC-6102 | — |

Verified from the normalized ROM headers and complete-image SHA-1 hashes.

### 1.3 Terminology and conventions

ROM and memory ranges are half-open. Offsets, addresses, encoded sizes, masks,
and opcodes are hexadecimal unless stated otherwise. Multi-byte CPU fields are
big-endian. RAM addresses are virtual unless explicitly identified as physical;
segmented, VROM, and file-relative addresses are named at each use.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

#### Boot and code

All three are Hudson Soft games built on the same in-house kernel design. Boot code is uncompressed and
copied by IPL3. Cross-segment calls go through a "ZeroJump" stub: the caller does `jr` to a
TLB-mapped virtual address and passes `t0 = (table << 8) | function`; the stub looks the target up in
a table of tables. None of this matters for asset extraction except that code addresses in overlays are
position-dependent.

#### Bomberman 64 (verified: disassembly + RDRAM dump compare)

| ROM | VRAM | Contents |
|---|---|---|
| 0x1000–0x1CBC0 | 0x80000400–0x8001BFC0 | kernel: libultra, scheduler, loaders; BSS 0x8001BFC0–0x80028460 |
| 0x1CBC0–0x1CCF0 | phys 0x42000, virtual 0x00000000 | ZeroJump stub (copied by `romRead`, mapped with osMapTLB) |
| 0x30000 (0x100) | 0x80024820 | segment size table: byte *i* = size of block *i* in 0x800 units (0 = 0x80000); block *i* lives at ROM `i << 17` |
| 0x30800 (0x1000) | 0x8019B0D0 | overlay id table: 2 bytes per id, archive ROM = `b0 << 17 \| b1 << 11` |
| 0x40000–0xC0000 | 0x80225800–0x802A5800 | main game code ("seg2"), uncompressed; BSS 0x802A5300–0x802B36D0 and 0x80063000–0x800BEA60 |
| archives 0x120000–0x2E0000 | 0x80043000 | 95 LZSS-compressed stage/menu overlays, all linked at and loaded to 0x80043000 (window 0x20000) |
| 0x300000–0x7B75A4 | heap | asset archive (873 files) |

- `0x80000698 romRead(dst, len, romOffset)`: every cartridge read goes through osPiStartDma here.
- `0x8022691C loadOverlay(id)`: id → archive via the table at ROM 0x30800 → archive file 0 (overlay
  directory) → file index → `u32 size` + LZSS stream decompressed to 0x80043000 → `jalr 0x80043000`.
- Build string "SAT SEP  6 14:57:59 JST 1997" at ROM 0xBD500.
- RSP microcode: F3DEX 1.x ("RSP Gfx ucode F3DEX.NoN 1.21"); audio: libultra aspMain (ABI1).

### 2.2 Memory and address mapping

### 2.3 ROM map and asset organization

### 2.4 Compression formats

#### File payloads

| Game | Payload | Codec selection |
|---|---|---|
| BM64 asset / overlay | `u32 BE decompressedSize` + LZSS stream | always LZSS, except 7 raw assets: 32 (music "S2" blob), 33 (SFX "T2" blob), 71, 72, 220, 221, 267 |
| SA resource | `u32 BE decompressedSize` + payload | if the u32 at +4 is `Yay0` (0x59617930): Yay0 image starting at +4; else LZSS stream from +4 |
| SA exec | Eight-byte exec header below, followed by LZSS data | LZSS |

SA exec header, eight bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | codeSize | Decoded executable byte count. |
| 0x04 | 4 | u32 | bssSize | BSS byte count. |
| 0x08 | Variable | u8[] | stream | LZSS executable payload. |

SA exceptions: resources 0 (music blob, "S2") and 1 (SFX blob, "T3") are raw and used by ROM address;
resource 2 is 64 KB of zeros; 46 resources (2527–2540, 2562–2573, 2595–2605, 2621–2629) are
`u32 1000` + 1,000 spaces, stored; resource 3060 has size 0. Counts: Yay0 1,558, LZSS 1,527, stored 46, raw 3.

For BM64 there is no codec flag: the extractor detects raw files as those where LZSS decoding does not
consume exactly the entry (0 or 1 byte of padding allowed). A viewer only needs the indices above.

#### Extracting everything

Reference extractors (Python 3, no dependencies):
- Hero: `bm/herofs/extract.py` → `files/` (chain files, overlays, raw blobs), `files/index.txt` with static references per file
- BM64: `bm/bm64fs/extract.py` (+ `lz.py`) → `files/a{ARCHIVE}/{idx}.bin`, `files/index.txt`
- SA: `bm/bm64safs/extract.py` → `files/res/NNNN.bin`, `files/exec/`, `files/index.txt` (7 s)

### 2.5 Loading process

### 2.6 Revision differences

## 3. Level data

### 3.1 Level catalog and identifiers

#### Bomberman 64

On-screen menus (verified by screenshots, `ref_bm64/shots/`): main menu Adventure / Battle / Custom /
Options; Battle → Single Battle / Team Battle / Options.

**Battle stages**, in stage-select order (verified; screenshots `battle_stage_select_01..06_*`,
`battle_play_01..06_*`). The capitalisation is as shown on screen:

| # | Name | Look |
|---|---|---|
| 1 | Rock Garden | nearly top-down fixed camera, no sky |
| 2 | UP and Down | arena over a rippled water surface |
| 3 | Pyramid | sea with a horizon and gradient sky |
| 4 | Greedy TraP | |
| 5 | Top Rules | |
| 6 | Field of Grass | grass strip between cliffs, blue-white gradient sky |

**Adventure worlds**, World Select order on a new file (verified): Green Garden, Blue Resort, Red
Mountain, White Glacier. Black Fortress (the "Central Base" of the intro) and Rainbow Palace are not
listed on a new file (hypothesis: unlocked later). Four stage slots per world. Stage 1 title cards:
Green Garden "Untouchable Treasure", Blue Resort "Switches and Bridges", Red Mountain "Hot on the Trail",
White Glacier "Blizzard Peaks".

**Stage → files.** Every stage is a code overlay that loads its map container with `li a0,N` → ZeroJump
0x0C00 and its attribute (collision) file → ZeroJump 0x0D00. Table from a static scan of every overlay
(`bm64_model.md` *At a glance*/*Open questions and hypotheses*):

| Overlay (archive/file) | Map | Attribute | Status |
|---|---|---|---|
| 0x90 (0x2E0000/1) | 513 | 537 | **Rock Garden** (verified: emulator load log, RDRAM, screenshot) |
| 0x91 | 514 | 538 | UP and Down |
| 0x92 | 518 | 539 | Pyramid |
| 0x93 | 520 | 540 | Greedy TraP |
| 0x94 | 525 | 541 | Top Rules |
| 0x95 | 529 | 542 | Field of Grass |
| 0x96 | 530 | 543 | In the Gutter (locked on a new save) |
| 0x97 | 534 | 544 | Sea Sick (locked) |
| 0x98 | 535 | 545 | Blizzard Battle (locked) |
| 0x99 | 536 | 546 | Lost at Sea (locked) |
| 0x1A (0x140000/2) | 315 (+826) | 321 (+825) | Adventure intro town cutscene (verified) |

Adventure stages are in the tables further below.

- **Mapping:** the battle stage-select code (overlay 0x23) computes `overlay = cursor + 0x90` (at 0x80046274)
  and draws names from a 10-entry table at **0x80049194**. The names are strings in the game font's encoding
  (byte + 0x27 = ASCII), not sprites.
- **Verified in the emulator** (load logs, RDRAM dumps and screenshots in `bm64_model/`): Rock Garden 0x90, UP and
  Down 0x91, Pyramid 0x92, Greedy TraP 0x93, Top Rules 0x94. Field of Grass (0x95) follows from the code.
- **Locked stages** (static, overlay 0x23):
  - 6 stages are selectable by default, 8 when save flag 2 is set, all 10 when save flag 1 is set; an options
    value at 0x802AC654 also unlocks all.
  - Flag 2 is set when world == 5 and stage == 3 are reached. Flag 1 is set when a counter out of 120 reaches
    120. The in-game meaning (hypothesis) is a Rainbow Palace stage and all 120 Gold Cards.
  - The four locked maps show as brick pillars, a ship deck, ice, and stone towers.

**Scene switching** (verified, disassembly):
- A scene is an overlay. The main loop loads `loadOverlay([0x802AC5D4])` when bit 0 of `[0x802AC5D0]` is set.
- Overlays call `changeScene(id, entryParam, a2)` (seg2 0x8023AE6C, ZeroJump 0x0F00), almost always with constant
  ids, so the scene graph is static. The entry param (17..24) selects the entry point (hypothesis).
- `0x802AC5E8` = world and `0x802AC5EC` = stage, both 0-based (verified in RAM: Green Garden 1 = 0/0, Blizzard
  Peaks = 3/0).

**Adventure: world/stage → start overlay** (verified: overlay 0x21 copies 24 u32 from 0x8004A19C and calls
`changeScene(table[world·4 + stage], 16, 0)`; entries (0,0) and (3,0) confirmed in the emulator):

| World (index) | Stage 1 | Stage 2 | Stage 3 | Stage 4 |
|---|---|---|---|---|
| 0 Green Garden | 0x28 | 0x31 | 0x2D | 0x88 |
| 1 Blue Resort | 0x38 | 0x3E | 0x3C | 0x89 |
| 2 Red Mountain | 0x48 | 0x56 | 0x50 | 0x8A |
| 3 White Glacier | 0x58 | 0x62 | 0x5E | 0x8B |
| 4 Black Fortress | 0x68 | 0x8C | 0x6E | 0x74 |
| 5 Rainbow Palace | 0x78 | 0x8D | 0x7B | 0x7E |

World names 0–3 are verified on the World Select screen (index 3 = White Glacier in the emulator). Worlds 4/5 are named by
elimination (hypothesis): they were locked on the saves used, and world names are textures, not text.

**Stage names** are text in a 1-byte encoding: letters are ASCII − 0x27 (0x1A–0x33 'A'–'Z', 0x3A–0x53 'a'–'z'),
0x0F space, 0xF6 '!', 0xF7 '?', 0xF8 '.', 0xF9 '-', 0 terminator. Digits are a hypothesis (0x10–0x19 per the
stage agent's decoder; ASCII − 0x27 would give 0x09–0x12). No stage name contains a digit. Seg2 **0x802A08F8** holds 24 name pointers
(world·4 + stage), followed by 24 u32 target times (entry 0 = 12000 matches the title card; verified):

| World | Stage 1 | Stage 2 | Stage 3 | Stage 4 |
|---|---|---|---|---|
| Green Garden | Untouchable Treasure | Friend or Foe? | To Have or Have Not | Winged Guardian |
| Blue Resort | Switches and Bridges | VS Artemis | Pump it Up! | Sewer Savage |
| Red Mountain | Hot on the Trail | VS Orion | On the Right Track | Hot Avenger |
| White Glacier | Blizzard Peaks | VS Regulus | Shiny Slippy Icy Floor | Cold Killers |
| Black Fortress | Go for Broke | High-Tech Harvester | Trap Tower | VS Altair |
| Rainbow Palace | Beyond the Clouds... | Spellmaker | Doom Castle | Final Battle! |

Stage 1 names of worlds 0–3 are also verified on title cards. Boss stages (hypothesis, from boss music and
single-area structure) are every Stage 2 and Stage 4 entry: Friend or Foe?, Winged Guardian, VS Artemis, Sewer
Savage, VS Orion, Hot Avenger, VS Regulus, Cold Killers, High-Tech Harvester, VS Altair, Spellmaker, Final Battle!.
Stages 1 and 3 are multi-area action stages. The large overlays 0x88–0x8D are boss arenas built mostly from object
models, with no map file.

**Areas and files per stage.** Areas are separate overlays linked by constant `changeScene` calls or exit records in
overlay data; the start area comes first. Columns:
- **map** = `loadMap` (ZeroJump 0x0C00)
- **parts** = extra `loadMapPart` (0x0C01, at the origin unless a position is given)
- **attr** = attribute file (0x0D00/0x0D0C)
- **bg** = background texture (`setBackground`, 0x1A00)
- **fog** = `setFog` min–max (0x2104)
- **clear** = `setClearColor` (0x2201)

"?" = computed argument, "–" = no call. Static scan; the rows marked verified were checked in RAM.

| Stage | Area | Archive/file | Map | Parts | Attr | Bg | Fog | Clear |
|---|---|---|---|---|---|---|---|---|
| GG1 Untouchable Treasure | 0x28 (verified) | 0x180000/1 | 578 | – | 588 | – | – | 55,77,255 (verified) |
| | 0x29 | /2 | 579 | – | 589 | – | – | 55,77,255 |
| | 0x2A, 0x2B, 0x2C | /3, /4, /5 | 580, 581, 582 | – | 590, 591, 592 | – | – | – |
| GG2 Friend or Foe? | 0x31 | /10 | 587 | – | 597 | 662 | – | 55,77,255 |
| GG3 To Have or Have Not | 0x2D, 0x2E, 0x2F, 0x30 | /6–/9 | 583, 584, 585, 586 | – | 593–596 | – | – | – / – / – / 55,77,255 |
| GG4 Winged Guardian | 0x88 | 0x260000/1 | models | – | 661 | 662 | – | – |
| BR1 Switches and Bridges | 0x38, 0x39, 0x3A, 0x3B, 0x3D | 0x1A0000/1,2,3,4,6 | 314, 315, 316, 317, 319 | – | 320, 321, 322, 323, 325 | – | – | 0,0,0 (0x38) |
| BR2 VS Artemis | 0x3E | /7 | model 369 | – | 368 | – | – | 0,40,70 |
| BR3 Pump it Up! | 0x3C (+ 0x3D, which links to 0x3B) | /5 | 318 | – | 324 | – | – | – |
| BR4 Sewer Savage | 0x89 | 0x260000/2 | models | – | 374 | – | 991–996 | 0,128,255 |
| RM1 Hot on the Trail | 0x48–0x4C | 0x1C0000/1–5 | 389, 391, 393, 395, 397 | – | 400–404 | – | – | 255,161,29 |
| | side rooms 0x4D, 0x4E, 0x4F | /6–/8 | 399 | – | 405–407 | – | 850–930 | – |
| RM2 VS Orion | 0x56 | /15 | 426 | – | 427 | – | – | – |
| RM3 On the Right Track | 0x50, 0x51, 0x52, 0x53, 0x54 | /9–/13 | 409, 411, 413, 416, 418 | – | 421–425 | – | 943/920/915/910/890–990 | 255,161,29 |
| | side room 0x55 | /14 | 399 | – | 408 | – | 850–930 | – |
| RM4 Hot Avenger | 0x8A | 0x280000/1 | 465 | – | 466 | – | – | – |
| WG1 Blizzard Peaks | 0x58 (verified), 0x59, 0x5A, 0x5B | 0x1E0000/1–4 | 547, 548, 550, 551 | – | 567–570 | – | 945–970 (verified), 930–950, 945–970, 860–960 | 230,240,255 (verified) |
| WG2 VS Regulus | 0x62 | 0x240000/6 | 566 | – | 577 | 633 | – | – |
| WG3 Shiny Slippy Icy Floor | 0x5E, 0x5F, 0x60, 0x61, 0x5C | 0x1E0000/7,8,9,10,5 | 554, 557, 560, 563, 554 | – | 573, 574, 575, 576, 573 | ? (0x5C: 633) | – | – |
| WG4 Cold Killers | 0x8B | 0x280000/2 | 638 | – | 635 | – | 971–975 | 0,0,0 |
| BF1 Go for Broke | 0x68 | 0x200000/1 | 468 | 467, 469, 470, 471 | 481 | ? | – | – |
| | 0x69 / 0x6B | /2 / /4 | 472 | 473, 474 / 473, 475 | 482 / 484 | ? | – | – |
| | 0x6A | /3 | 476 | 477, 468, 469, 469 at x 7600 | 483 | ? | – | – |
| | 0x6C / 0x6D | /5 / /6 | 468 / 480 | 478, 479, 469 at x 7600 / – | 485 / 486 | ? | – | – |
| BF2 High-Tech Harvester | 0x8C | 0x2A0000/1 | 700 | – | 701 | – | – | – |
| BF3 Trap Tower | 0x6E, 0x6F, 0x70, 0x71, 0x72, 0x73 | 0x200000/7–12 | 489, 491, 493, 495, 496, 497 | tower part 199 at y 0 and y 12000 (0x71: 199 only); plus 490 / 492 / 494 + 186 / – / – / 498 | 499, 500, 502, 503, 504, 505 | ? | 966–1000 | 0,255,255 |
| BF4 VS Altair | 0x74 | /13 | 506 | – | 507 | ? | – | – |
| RP1 Beyond the Clouds... | 0x78, 0x79 | 0x240000/1, 2 | 729, 730 | – | 735, 736 | 741 | – | – |
| RP2 Spellmaker | 0x8D | 0x2A0000/2 | models | – | 743 | 744 | – | – |
| RP3 Doom Castle | 0x7B, 0x7C | 0x240000/3, 4 | 731, 730 | – | 737, 738 | 741 | 885–955 (0x7B) | – |
| RP4 Final Battle! | 0x7E | /5 | models | – | 739, 740 | 855, 741 | – | – |

Full table with music columns: `bm64_stage/leveltable.md`. Map parts with flags 0x60 (471, 477, 475, 479, 490, 492,
494, 498) take a special code path (hypothesis: animated or transparent part).

**Battle stage files** (static; 0x90 and 0x95 verified in RAM):

| Stage | Overlay (0x2E0000 file) | Map | Parts | Attr | Bg | Clear |
|---|---|---|---|---|---|---|
| Rock Garden | 0x90 (1) | 513 | – | 537 | – | – |
| UP and Down | 0x91 (2) | 514 | – | 538 | – | – |
| Pyramid | 0x92 (3) | 518 | – | 539 | 662 | – |
| Greedy TraP | 0x93 (4) | 520 | 523 | 540 | – | – |
| Top Rules | 0x94 (5) | 525 | – | 541 | – | – |
| Field of Grass | 0x95 (6) | 529 | – | 542 | 662 | – |
| In the Gutter | 0x96 (7) | 530 | – | 543 | 662 | – |
| Sea Sick | 0x97 (8) | 534 | – | 544 | – | 200,200,255 |
| Blizzard Battle | 0x98 (9) | 535 | 218 | 545 | – | 90,140,255 |
| Lost at Sea | 0x99 (10) | 536 | – | 546 | – | – |

**Other scenes:**

| Overlay | Scene |
|---|---|
| 0x20 | title + main menu |
| 0x1F | file select |
| 0x21 | world/stage select |
| 0x22/0x23 | battle menus and stage select |
| 0x24 | Controller Pak screens |
| 0x25 | Custom |
| 0x1B | title attract |
| 0x19, 0x1A, 0x1C, 0x1D, 0x26 | story cutscenes on the town map 826/attr 825 (0x1A = intro, verified) |
| 0x14–0x17 | "debmap" test maps (section 10) |

Seg2 0x802A2A40 holds two lists of 25 (scene, entry param) pairs; hypothesis: the ending/credits scene tour.

### 3.2 Level container

#### Common conclusions

- **Vertex scale 1 and no X mirroring** (right-handed, Y up) in Hero and SA. Both were verified by rendering
  at the game's own camera and comparing with emulator frames, and by camera matrices with positive determinant.
  The viewer's `displaylist.ts` hardcodes the Rush values (1/16, negate X); these must become parameters.
  BM64 was verified the same way (5.4.3).
- **Back-face culling is on** in all three games (BM64 and Hero geometry mode 0x22205 set by game code; SA lists
  set G_CULL_BACK themselves).
- **Lighting:** most level geometry is lit. **Vertex colour bytes are signed normals**, not colours. The viewer's
  Batch carries only colours, so a loader must bake lighting in world space (5.4.3 BM64, 5.3.5 SA, 5.2.5 Hero).
- **Textures** are uploaded with the RDP tile commands (SETTIMG / SETTILE / LOADBLOCK / SETTILESIZE), exactly
  as in the Rush games; `texture.ts` reproduces them unchanged.

#### Bomberman 64

Source: `notes/bm64_model.md`; decoder `bm64_model/decode.ts` + `displaylist_bm64.ts`; frame walker `frame.ts`.

##### Container and binding

- Same "64" container as Hero (5.2.1). The game loads containers byte-for-byte and binds them at draw time
  with `G_MOVEWORD(G_MW_SEGMENT)`: **segment 2 = container base**. Verified: every container copy found in
  RDRAM is identical to its extracted file, and the frame lists set segment 2 to its address.
- **Maps** use only segment 2 (textures inside the file).
- **Characters and props** take textures from a separate **texture-bank container** (image + palette records)
  bound to **segments 3..14** (code `0x80228CE8`). The record at `obj + 76` is:

  | Offset | Size | Type | Field | Description |
  |---:|---:|---|---|---|
  | 0x00 | 4 | s32 | count | — |
  | 0x04 | 4 | u32 | references | — |
  | 0x08 | 4 | u32 | animation | — |

  For `i < count`,
  segment 3 + i = refs[i].container + record[refs[i].record].offset. The reference fields are sequential; the record-index width was not established here:

| Order | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 1 | 4 | u32 | container | Container pointer. |
| 2 | Unknown | Unknown | record | Record index. |

If animation is present, each segment steps through frame records. Their field widths remain unspecified:

| Order | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 1 | Unknown | Unknown | record | Record index. |
| 2 | Unknown | Unknown | duration | Frame duration. |

This animates textures by segment swapping. Example: Bomberman = container 73 with bank 74 (player 1), 75–77 (players 2–4).
- Per object the frame contains: `G_CLEARGEOMETRYMODE(G_FOG)`, alpha compare none, modelview load + push (object
  matrix), `G_MOVEWORD seg 2`, bank segments, the container's record or node tree, `G_POPMTX`.

##### Textures

Standard libultra `gDPLoadTextureBlock` / `gDPLoadTextureTile` sequences (LOADBLOCK 3,885 uses, **LOADTILE 184**
in 42 files, LOADTLUT 3,976). Mostly CI4, CI8 in character skins and some map parts, RGBA32 in 26 lists, TLUT
always RGBA16. Wrap from SETTILE: cm 0 repeat, 1 mirror, 2 clamp; 45 lists use a non-zero SETTILESIZE corner.
No BRANCH_Z LODs. `texture.ts` decodes everything correctly unchanged.

##### Render state (from game code; the asset lists never set it)

- **Geometry mode 0x22205** (ZBUFFER | SHADE | SMOOTH | CULL_BACK | LIGHTING) from the master list and main-code
  setup list 0x8029F6D8. Asset lists never contain B6/B7. **Back-face culling on, fog off.**
- **Render mode 0x00553078** (Z_CMP | Z_UPD | CVG_X_ALPHA | ALPHA_CVG_SEL): **cutout** by texel alpha. A
  decoder must default to it, or fences and leaves come out opaque. 169 lists toggle alpha compare
  (`B9000002`). Translucent objects (shadows, effects) get `0x055079D8` plus `G_SETFOGCOLOR xxxxxxAA` from game
  code: the blender uses the fog alpha as the blend factor (not modelled by `Batch`).
- **Lighting:** vertex bytes 12..14 are a signed normal. Master list: `NUMLIGHT 2`; L0 colour 0x323232 and L1
  colour 0xC8C8C8, both direction (0, 0x72, 0x37); ambient 0x505050. **Every model list begins with
  `G_MOVEWORD LIGHTCOL`** at 0x20/0x24 (light 2 = L1) and 0x40/0x44 (ambient), e.g. FFFFFF/FFFFFF or
  999999/4C4C4C; L0 keeps its master colour. Colour = ambient + Σ max(0, n·l)·colour, clamped; combiner
  usually `FC127E24 FFFFF3F9` (texel × shade).
- **Lighting bake for the viewer** (verified by render brightness, `bm64_model/light_test.ts`):
  `colour = min(255, ambient + Σ_i col_i · max(0, n̂ · l̂_i))` per channel, where:
  - n̂ = the vertex's signed-byte normal, normalised, rotated by the object → world 3×3 (identity for maps);
  - l̂ = the light direction, normalised, **in world space** (the camera sits on the projection stack, so the
    modelview at G_MOVEMEM time is object → world);
  - lights: L0 colour 0x323232 and L1 colour from the list's LIGHTCOL (offset 0x20, default 0xC8C8C8), both
    direction (0, 0x72, 0x37); ambient from LIGHTCOL offset 0x40 (default 0x505050).

  Each LIGHTCOL applies to the triangles that follow it in that record until the next LIGHTCOL. Green Garden stage 1
  (map 578), region means emulator vs world-space bake: grass 156/166/93 vs 161/174/94, fence 97/97/46 vs
  100/102/46 (bake about 3% brighter); a view-space bake is clearly wrong (fence 66/66/28). Renders:
  `bm64_model/renders/light_world_space_dirs.png`, `light_view_space_dirs.png`.
- **Projection:** guPerspective fovY 30°, aspect 4:3, near 200, far 20000; viewport scale (152, 114), translate
  (160, 120), i.e. a 304×228 image centred in 320×240. Cameras: Green Garden stage 1 eye (−1034, 1814, 1500)
  looking +X/−Y; Rock Garden eye (2300, 2400, 3101) looking −Z with pitch 55°.
- **Units and handedness:** vertex scale 1, no X mirror, right-handed Y-up; modelview = object → world
  (identity for maps).
- **Backgrounds** (verified from RDRAM frame lists and screenshots):
  - Most scenes clear the colour buffer to black (master list: SETFILLCOLOR 0x00010001 + FILLRECT). This covers
    Green Garden 1, Rock Garden and UP and Down.
  - **Pyramid**:
    - No colour clear.
    - The 3D pass begins with a **2D backdrop**: three G_TEXRECT strips (0,0)–(320,92), (0,92)–(320,184),
      (0,184)–(320,239). The texture is **asset 662**: a container with a CI4 160×160 image at +0x28 and a
      16-colour RGBA16 palette at +0x3228, loaded with LOADTILE. Texel rows start at t = 57, 80, 104 with
      dsdx = dtdy = 0.25, so each texel covers 4×4 pixels.
    - The sea around the pyramid is **asset 519**: a translucent textured quad at y −59, placed at (0, −400, 0).
  - **UP and Down**:
    - Black clear.
    - The water is **asset 516**: one 6600×6600 quad at y −59, placed at (0, −400, 0), UV 15 repeats.
    - It is drawn with render mode 0x055079D8 and `G_SETFOGCOLOR` alpha 0x99, i.e. **60% over black** (measured
      brightness ratio 0.58).
    - A viewer should draw 516 blended at alpha 0.6 over a black background.
  - Asset 515 there is a central platform object at (2350, 800, 1550).
  - **Field of Grass** (verified, `bm64_stage/dumps/rd_fog95.bin`):
    - No colour clear. The background texture 662 is drawn by game code as 8 screen-space G_TEXRECT bands
      (y 0–240 in ~34.5-pixel steps, dsdx 0.5, dtdy 0.666, per-band T offsets).
    - It is driven by the background slot table 0x802B0260: `setBackground` (ZeroJump 0x1A00 = 0x80287DC0) is
      called by the stage overlay, and the drawing is done by 0x802879AC.
    - Stages calling `setBackground` are listed in the section 4.1 tables (column Bg: 633, 662, 741, 744, 855).
  - White Glacier stage 1 uses real fog (5.4.6). Blue Resort was not captured.
- **Animation:**
  - Type-6 "scroll" globals 0x802A2D50/54 are constant 0x80 and never written, so type-6 records are static.
  - The real texture scroll is a **vertex UV scroll** (verified from code):
    - Table at 0x800A8C68: six 24-byte entries:

      | Offset | Size | Type | Field | Description |
      |---:|---:|---|---|---|
      | `0x00` | 4 | `u32` | `object` | — |
      | `0x04` | 4 | `u32` | `vertexPtr` | — |
      | `0x08` | 4 | `u32` | `count` | — |
      | `0x0C` | 2 | `s16` | `dS` | — |
      | `0x0E` | 2 | `s16` | `dT` | — |
      | `0x10` | 2 | `s16` | `limitS` | — |
      | `0x12` | 2 | `s16` | `limitT` | — |
      | `0x14` | 2 | `s16` | `accS` | — |
      | `0x16` | 2 | `s16` | `accT` | — |
    - Updated once per game frame by 0x8022997C. It adds dS/dT to every vertex s/t (vertex +8/+10) of the loaded
      container in RAM while `acc + d` stays within the limit; otherwise it subtracts `acc` and resets it.
      1024 units = one repeat of a 32-texel texture.
    - Registered by 0x80229C90(obj, record, dS, limitS, dT, limitT) from stage overlays (e.g. Green Garden dS 10,
      limit 1024).
    - The table was empty in all six captured frames, so the file's UVs are a valid static frame.
  - Texture-bank animation (5.4.1) exists in code but was not active in any capture.
- **Billboards (type 5):** 0x8022D744 multiplies the object modelview by the camera view matrix, replaces the
  result with the inverse of its 3×3 (zero translation) and pushes it as `G_MTX(modelview, mul, push)` around the
  list. The geometry therefore keeps a fixed screen orientation at the object's position: draw type-5 records as
  camera-facing sprites.

##### Changes needed in `displaylist.ts` (implemented in `bm64_model/displaylist_bm64.ts`)

1. `vertexScale` parameter (1) and `mirrorX` parameter (false).
2. A segment table updated by `G_MOVEWORD(G_MW_SEGMENT)` (the static resolver `segment 2 = file` is enough for maps).
3. A modelview matrix stack (`G_MTX`, `G_POPMTX`) for node trees.
4. RSP lighting from `G_MOVEMEM` lights and `G_MOVEWORD NUMLIGHT/LIGHTCOL`, with the master defaults above.
5. `G_LOADTILE` (same semantics as 5.3.3).
6. Default render mode 0x00553078.
7. Approximate `G_TEXTURE_GEN` UVs for type-8 records. `G_CULLDL` can be ignored.

The unmodified interpreter renders normals as colours and mirrors X (`renders/intro315_viewer_displaylist.png`).

##### Verification

- Emulator runs (`bm64_model/run`, breakpoints on `getAsset` 0x8026CE28 and `loadOverlay` 0x8022691C):
  - **Green Garden stage 1** loads overlay 0x28, then assets 578, 588, 222, 34, 143, 144, 147, 847, 228, 73, 74,
    681, 685, 679, 680, 691, 699, 686, 687, 682, 683, 808, 304, 856 (RDRAM `rdram_gg1s1.bin`).
  - **Rock Garden** loads overlay 0x90, then 513, 537, 211, 73 + 74–77, 34, 0, 17, 14, 15, 285/286, 19, 274/275
    (`rdram_rockgarden.bin`).
- Static decode equals game output (`check_textures.ts`). Every decoded triangle appears in the frame at the same
  world position, and every decoded texture is byte-identical to one the frame bound:
  - map 578: 802/802 triangles, 11/11 textures;
  - map 513: 152/152 triangles, 9/9 textures;
  - intro map 315: 1,303/1,303 triangles, 26/26 textures.
- Side-by-sides with the extracted game camera (emulator | render | diff):
  - `renders/gg1_cmp_shot_vs_decode.png` (mean abs diff 19.1; map 578 plus pots 147/143): path, walls,
    spikes, fence cutout and lighting line up.
  - `renders/rockgarden_cmp_shot_vs_decode.png` (13.9).
  - Frame replays: `gg1_cmp_shot_vs_frame.png` (17.4), `rockgarden_cmp_shot_vs_frame.png` (12.7).
- All ten battle maps: `renders/battle_overviews_montage.png`.

Pitfalls: lighting is mandatory (vertex colours are normals); type-4 offsets and type-7 contents are not
pointers; translucent shadows/effects come out as white blobs without the fog-alpha blend and PRIM/ENV combiner.

##### Levels: map parts, objects, attribute grids, per-stage environment

Source: `notes/bm64_stage.md`.

- **Map loading** (verified, disassembly):
  - `loadMap(asset)` = ZeroJump 0x0C00 = 0x80243BA8.
  - `loadMapPart(asset, f32 x, y, z, flags, s16)` = 0x0C01 = 0x80243A50. It keeps a part table at 0x800AED78
    and creates a draw object whose position field is documented in the drawable-object record below. The part-table record has these sequential fields (asset-index width unresolved):

| Order | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 1 | 4 | u32 | object | Object pointer. |
| 2 | 4 | u32 | data | Data pointer. |
| 3 | Unknown | Unknown | assetIdx | Asset index. |

  - `loadAttributes(asset)` = 0x0D00 = 0x8026FF64 (parser 0x8026FC08).
  - In RAM, map 578 is byte-identical to its file and drawn with position 0, rotation 0 and scale 1, so **map
    vertex coordinates are world coordinates**.
- **Multi-part maps:** Black Fortress areas load several map files at the origin; asset 469 is instanced at the
  origin and at x = 7600 (0x6A, 0x6C); Trap Tower instances part 199 at y = 0 and y = 12000.
- **Drawable object pool** (verified from RAM, `bm64_stage/scripts/objpool.py`): 0x50-byte records from 0x800A0DF0.

  | Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | Unknown | id | Identifier. |
| 0x04 | 4 | Unknown | linkId | Link identifier. |
| 0x08 | 4 | Unknown | flags | 0x40 prop, 0x50 map, 0x60 special. |
| 0x0C | 4 | Unknown | kind | Object kind. |
| 0x10 | 12 | f32[3] | position | X,Y,Z. |
| 0x1C | 12 | f32[3] | rotation | Degrees. |
| 0x28 | 12 | f32[3] | scale | Scale. |
| 0x3C | 4 | u32 | data | Data pointer. |

  The asset index comes from the getAsset cache 0x800A7F30. Props are placed by overlay code, from float records in
  overlay data. For example, overlay 0x28 at 0x8004A520 places asset 685 at (4450, 700, 50), scale (1,1,1), matching the RAM instance. There is no single placement format: a viewer needs per-overlay extraction or the RAM
  positions. Green Garden 1 prop positions from RAM are in `bm64_stage.md` *Bomberman Hero* (e.g. six pots, asset 147, at
  (900|1100|1300, 200, 1300|1800)).
- **Attribute file:** the 3-D collision and object grid, section 5.4.7.
- **Per-stage environment API** (verified, disassembly; values confirmed in Green Garden 1 and Blizzard Peaks):
  - 0x2201 `setClearColor(r, g, b)` becomes the FILLCOLOR: Green Garden (55, 77, 255) → 0x327F.
  - 0x2104 `setFog(min, max, r, g, b)`; 0x2103 fog off.
  - 0x2101 `setLightDir(x, y, z)` (s8, L0 and L1); 0x2102 `setLightColor(r, g, b)`.
  - Default light direction (0, 114, 55). Overrides: Blue Resort 0x39 (45, 110, −44), 0x3A (55, 114, 0),
    0x3B/0x3C/0x3D (45, 110, 44); 0x69/0x6B/0x7B (15, 126, 0). Colour overrides: 0x89 (128, 128, 128), 0x8C (2, 2, 25).
- **Fog** (verified in Blizzard Peaks RAM, `bm64_stage/dumps/rd_wg58.bin`):
  - When fog is on, the frame sets G_FOG, `G_MOVEWORD FOG` with **fm = 128000/(max − min)** and
    **fo = 256·(500 − min)/(max − min)**, and **G_SETFOGCOLOR = r<<24 | g<<16 | b<<8 | 0x80**.
  - Blizzard Peaks (945–970, colour 230, 240, 255): fm 5120, fo −4556, colour E6F0FF80, clear (230, 240, 255) — exactly
    as predicted.
  - For the viewer's `Fog`: colour (r, g, b), multiplier fm, offset fo, near 200, far 20000.
  - Per-area fog values are in the section 4.1 table; the title screen uses 900–960.

##### Attribute grid: the collision (verified: code, 4 RDRAM dumps, map geometry)

The attribute file is Bomberman 64's **only map collision**: ground height (`groundHeight` 0x8026E938, 23 seg2 and 16
overlay call sites) and wall blocking (0x80290498 inside 0x802909FC) read the grid, never the map containers. Moving
platforms are objects (0x8026E8E0 walks the object list 0x802A55F4).

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 1 | u8 | layerCount | Layer count. |
| 0x01 | 1 | u8 | originX | Zero in all 67 files. |
| 0x02 | 1 | u8 | originLayer | Zero in all 67 files. |
| 0x03 | 1 | u8 | originZ | Zero in all 67 files. |
| 0x04 | 1 | u8 | floorByte | Bit 7: bottomless; low 7 bits b: fall-out height = −100 × b. |
| 0x05 | Variable | layer[] | layers | Counted layer records. |

Layer record, three-byte header followed by blocks:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 1 | u8 | blocksX | 6. |
| 0x01 | 1 | u8 | blocksZ | 4. |
| 0x02 | 1 | u8 | unit | Layer height in hundreds; 0xFF on the top layer. |
| 0x03 | 130 × blocksX × blocksZ | block[] | blocks | Block records. |

Block record, 130 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | u16 | blockId | Column in high byte, row in low byte. |
| 0x02 | 128 | u16[64] | cells | 8×8 cells, row-major. |

- **Loading:** ZeroJump table 0x0D at 0x802A1450: 0x0D00 `loadAttributes` 0x8026FF64, 0x0D0C parser 0x8026FC08 (fills
  each layer with 0x2010, then `setCell(col·8 + originX + i % 8, layer + originLayer, row·8 + originZ + i / 8)`),
  0x0D0D random soft blocks and spawn markers 0x8026F8B0, 0x0D04 `setCell` 0x8026D620, 0x0D0B `getCell` 0x8026D7D8
  (outside the grid → 0x2010; below layer 0 → 0x000F under a non-empty layer-0 cell), 0x0D08 `worldToCell` 0x8026DCAC,
  0x0D11 `layerBase` 0x8026E2B0, 0x0D15 `groundHeight`. Grid in RAM at 0x800B15D8. Blue Resort (0x38–0x3D) and 0x6F call
  the parser directly, skipping the random-block and marker pass. The unused debug printer 0x8026ECF4 calls the
  per-layer byte "Layer Unit". File size = 5 + 3123·layerCount; every layer is 48 × 32 cells.
- **Cell space:** cell (i, k) is **centred** on (100·i, 100·k) and spans ±50 (`worldToCell` rounds at 0x8026DE88;
  movement uses `int((x + 50)·0.01)` at 0x80290AE0). Layer L spans `base(L) = 100·Σ unit(k < L)` up by `100·unit(L)`
  (0x8026E2B0; `layerOfY` 0x8026EE18); y < 0 is layer −1. There is no per-cell height: only slopes lie between layers.
- **Ground** (0x8026E938): from the cell at the object's layer, step down while the cell's shape is empty and the
  cell below has no object bits (0x60); ground = base of that layer, or the slope height for shapes 3–6; below
  layer 0: floorY, or no ground (20000.0) when bottomless. Objects at or below floorY have fallen (0x80233428,
  0x8023FAE4).
- **Cell code bits:**

  | Bits | Meaning | Evidence |
  |---|---|---|
  | 0x000F | shape: 0 empty; 1 floor; 3/4/5/6 slope rising towards +z/−z/+x/−x over the run of equal cells and the layer height; 7/8/12/13 corner (solid half towards (−x,−z)/(−x,+z)/(+x,−z)/(+x,+z)); 15 solid for the whole layer; 2, 9, 10, 11 walkable floors of unknown kind | slope run 0x8026DFB8, height 0x8026E3AC, test 0x8026E278; blocking 0x80290498 (jump table 0x802A460C, directions 0x802A45D8) |
  | 0x0010 | excluded from random soft-block placement (needs `(code & 0x70) == 0`) | 0x8027E124, 0x8026FA24 |
  | 0x0060 | grid object kind 1–3 (per stage; kind 1 = battle soft block), solid when scanning a column | model tables 0x802B0190 / 0x802B01D8, `placeObject` 0x8026F068 |
  | 0x0380 | spawn marker 1–7 (battle 1–4: hypothesis, player starts) | 0x8026F5E8 → 0x802511EC / 0x80286CA8; GG1 marker 4 = asset 222 (×4), 5 = 847 (×3) |
  | 0x1C00 | trigger id 1–7 → per-stage callback table 0x802B01F4 (0x8027F858), registered by overlays (0x8027F88C) | e.g. GG1 id 1 = the water strip (the old 0x0411 "water" code) |
  | 0x2000, 0x4000, 0x8000 | unknown (0x2010 is the fill value; 0x4000 marks a cell as not free; 0x8000 tested with mask 0x11) | 0x80247358, 0x8026E608; 0x80273A6C; 0x80245190 |

- **RDRAM checks** (Green Garden 1, Blizzard Peaks, Field of Grass, Rock Garden): header and cells equal the file
  except runtime edits (Rock Garden 12 and Field of Grass 6 cells 0x0001 → 0x0021 exactly under the random soft blocks;
  Green Garden 1: prop footprints and closed passages). `groundHeight(x, y + 1, z) == y` for 39/42, 21/30, 8/10 and
  17/19 objects (misses are floating or animated), including a slope (object at y 190.0679).
- **Against the map:** floor cells at base(L) coincide with map floors for 91–100% (Rock Garden 100%, Green Garden 1
  97%, Switches and Bridges 1 91%, Field of Grass 100%, Hot on the Trail 1 95.5%); all slopes match (81/81, 106/106,
  78/78, 56/60); horizontal rays find map walls at the solid-cell faces for 74–84% (cells taken to start at 100·i
  instead: 0–6.5%). Blizzard Peaks' snow is drawn 40 units above the collision (544 of 613 floors, all 278 slopes);
  objects in RAM stand at the collision height.
- **Mismatches with the overlay scan:** 0x9B passes asset 564, a "64" container, to `loadAttributes`
  (0x9B is unused, section 10).
- **Viewer** (`collision.ts`): hidden layers "collision" (solid boxes without shared faces, floor quads, slope ramps,
  corner prisms, the fall-out plane under empty columns when not bottomless; open top layers drawn 300 high),
  "attribute volumes" (object-kind boxes, trigger-id volumes of empty cells, the bottomless fall-out height) and
  "attribute markers" (spawn markers). "Side room" (map 399, shared by overlays 0x4D–0x4F and 0x55, whose attribute
  files 405–408 differ) uses 405.

### 3.3 Geometry

### 3.4 Display lists and render state

### 3.5 Textures and materials

### 3.6 Collision

### 3.7 Environment, sky, fog, and lighting

### 3.8 Cameras and paths

## 4. Objects

### 4.1 Placement records

### 4.2 Object and model formats

### 4.3 Skeletons and animation

### 4.4 Behaviors, triggers, and scripted objects

## 5. Audio

### 5.1 Audio storage and banks

#### Where the data is (verified)

One contiguous blob per game: `S2 song table | .ctl | .tbl | sequences`. All offsets inside the
S2 table are relative to the S2 header.

| Game | Blob / S2 header | Songs | .ctl ("B1") | Banks | .tbl | Sequences |
|---|---|---|---|---|---|---|
| BM64 | asset 32, ROM 0x30A898 | 47 | 0x30AD08 | 3 (every song uses bank 0) | 0x314150 | 0x3EB5C0–0x407978 |
| Hero | ROM 0x38A1F0 | 33 (entry 0 empty) | 0x38A510 | 1 (128 instruments) | 0x390858 | 0x46C960–0x47A4D8 |
| SA | resource 0, ROM 0x2A8008 | 76 | 0x2A8730 | 58 (per-song) | 0x2C5C10 | 0x3C6C10–0x41AE48 |

The .tbl has no header of its own: it starts immediately after the .ctl (sizes from the song record).

Sound effects are a separate blob (BM64 asset 33 "T2" at 0x407978, Hero "T1" 0x229650, SA resource 1
"T3" 0x41AE48) with its own bank; not needed for music and not documented beyond its location.

### 5.2 Sequence format and driver

All three games use **standard Nintendo libultra audio**: the compressed-MIDI sequence player
(alCSPlayer), ALBankFile instrument banks ("B1") with VADPCM samples, and the common RSP audio microcode
(aspMain, ABI1). Hudson wraps it in the SDK sample audio manager (SA function names: `amMusPlay`,
`musSeqHRomCopy`, `initOsc/updateOsc/stopOsc`, `__amMain`, ...). There is no custom audio microcode
and no MusyX. Music data is **uncompressed** and read in place from ROM.

#### S2 song table (verified)

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | u16 | magic | S2 (0x5332); loader also accepts S1. |
| 0x02 | 2 | u16 | count | Song count. |
| 0x04 | 8 × count | sequenceEntry[] | sequences | Sequence offset/length table. |
| 0x04 + 8 × count | 16 × count | song[] | songs | One song record per sequence. |

Sequence entry, eight bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | seqOffset | 0xFFFFFFFF marks an empty entry. |
| 0x04 | 4 | u32 | seqLength | Sequence length. |

Song record, 16 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 1 | u8 | bank | Bank-array index. |
| 0x01 | 1 | u8 | volume | Master volume, 0–127. |
| 0x02 | 2 | u16 | unknown02 | 0xFFFF. |
| 0x04 | 4 | u32 | ctlOffset | Control-bank offset. |
| 0x08 | 4 | u32 | ctlSize | Control-bank length. |
| 0x0C | 4 | u32 | tblOffset | Wave-bank offset. |

SA's loader (0x800249A8–0x80024BB4) reads `bank`, `ctlOffset`, `ctlSize`, `tblOffset` from the record at
`table + song·16` and binds `ctl->bankArray[bank]` to the sequence player. Song → bank:
- BM64: bank 0 for all 47 songs (banks 1 and 2 are unused by music; purpose unknown).
- Hero: bank 0 for all songs.
- SA: bank per song, 0..75: `0 1 2 3 4 5 0 6 7 50 8 51 9 52 10 53 11 54 12 13 14 55 15 0 16 17 18 19 0 0 0 0 0 0 20 21 22 23 24 25 26 27 28 28 29 29 30 30 31 31 32 32 33 34 35 36 37 0 38 0 39 40 40 41 42 43 44 45 46 47 0 48 56 57 0 0`.
  Verified from RAM on four screens (intro song 3/bank 3, main menu 1/1, character select 5/5, battle 42/28)
  and by rendering song 3 with bank 3 against captured game audio.

#### Sequence format: libultra compressed MIDI (verified: all 155 songs parse to the end)

Sequence header, 0x44 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 0x40 | s32[16] | trackOffsets | Relative to sequence start; zero marks unused tracks. |
| 0x40 | 4 | s32 | division | 480 ticks per quarter note. |

Track unit (variable length), repeated until end of track:

| Order | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 1 | Variable | VLQ | delta | Delta time. |
| 2 | Variable | event | event | Event encoding below. |

| Component | Encoding | Meaning |
|---|---|---|
| Header | 0x44-byte header below | Track offsets are relative to the sequence start; zero means unused. Division is 480 in every song. |
| Track | Repeated delta/event units below | Time-ordered event stream. |
| Escape | `FE FE` | Literal byte `0xFE`. |
| Back-reference | `FE hi lo len` | Read `len` bytes from `escapeOffset - ((hi << 8) \| lo)`, then resume after the four-byte escape. |
| Tempo | `FF 51 t1 t2 t3` | Microseconds per quarter note. |
| End | `FF 2F` | End of track. |
| Loop start | `FF 2E nn FF` | Start marker; the two payload bytes are ignored. |
| Loop end | `FF 2D cnt cur o1 o2 o3 o4` | Initialize/decrement `cur` and jump backward by the big-endian `u32` offset; `cnt = cur = 0xFF` loops forever. |
| MIDI | `8n..En` | Channel messages with running status; meta events reset running status. |
| Note | `9n key vel {varlen dur}` | Note-on with an inline duration; no note-off event is stored. |

Only controllers 7 (volume), 10 (pan) and 91 (effects/reverb send) occur, plus program change and
pitch bend. BM64 has some finite loops (`cnt = 3`); Hero and SA loop forever.

#### Rendering to PCM

- Output rate: **32006 Hz** (AI_DACRATE 1520, read from all three games in the emulator); the bank rate
  is 32000. Pitch ratio of a voice = `2^(((key − keyBase)·100 + detune + bend·bendRange/8192) / 1200)`
  (verified by chroma comparison against captured game audio: 0.93–0.94 at 0 semitones versus ≤ 0.72
  shifted).
- Tick time = tempo / 480 microseconds; verified against captured audio at tempo stretch 1.00.
- **Voices:** SA builds its ALSynConfig in `initAudioLib` 0x80026C88 with maxVVoices = maxPVoices = 22 and
  maxUpdates 350 (verified). BM64 16/350 (ROM 0xBBA50) and Hero 16/512 (ROM 0x4AEA0) are hypotheses from
  config-like data. Voice stealing by instrument priority is not researched; with 16–22 voices it is probably rare.
- **Envelope ramps are exponential** (verified from the ABI1 ENVMIXER as implemented in mupen64plus-rsp-hle
  `alist_envmix_exp`). Every 8 output samples the target level is multiplied by a 16.16 rate
  (`expSeq = expSeq · rate >> 16`), with linear steps between those points, clamped at the target. Voice gain per
  sample = `(ramp · dry + 0x4000) >> 15`; mix `out += (in · gain) >> 15`. Envelope order (hypothesis, libultra
  behaviour): ramp from 0 to attackVolume over attackTime, then to decayVolume over decayTime, hold, and at note
  end ramp from the *current* level to 0 over releaseTime. Times are microseconds. BM64/Hero envelopes have attack
  time 0; SA's are mostly attack 225 µs, decay 32 µs, decayVolume 124, release 2000–5124 µs.
- **Pan:** all three ROMs contain libultra's 128-entry equal-power table (Q15: 32767, 32764, 32757, … 810, 405, 0;
  BM64 ROM 0x1BFE0, Hero 0x4C3B0, SA 0x953D0). Left gain = `table[pan]`, right = `table[127 − pan]` (verified).
  Hypothesis: `pan = clamp(channelPan − 64 + samplePan, 0, 127)`.
- **Volume** (hypothesis, libultra `__vsVol`): `v = (127 · velocity · envGain) >> 6`,
  `w = (sampleVolume · playerVolume(0..0x7FFF) · channelVolume) >> 14`, `voiceVolume = (v · w) >> 15`. A program
  change copies the instrument's volume, pan, priority and bendRange into the channel; CC7/CC10 override them.
  The S2 song volume byte is assumed to set the player volume.
- **Controllers** (verified in SA's handler 0x8007BA10): 7 channel volume, 10 channel pan, 64 sustain, 91 effects
  send. Pitch bend `value − 8192`; ratio `2^(((value − 8192)/8192) · bendRange / 1200)` with bendRange in cents
  (200 in most instruments). Applying CC and bend to already sounding notes is a hypothesis.
- **Reverb** (effects bus fed by CC91):
  - All three ROMs contain libultra's preset tables (BM64 ROM 0x1BE50, Hero 0x4C220, SA 0x95240). Each preset
    is `{sections, totalLength, then per section {input, output, fbcoef, ffcoef, gain, chorusRate, chorusDepth,
    lowpassCoef}}`:
    - SMALLROOM {3, 4000: (0,2160,9830,−9830,0,0,0,0) (760,1520,3276,−3276,16383,0,0,0) (0,2400,5000,0,0,0,0,20480)}
    - BIGROOM {4, 4000: (0,2640,9830,−9830,0,0,0,0) (880,2160,3276,−3276,16383,0,0,0) (2640,3640,3276,−3276,16383,0,0,0) (0,3760,8000,0,0,0,0,20480)}
    - ECHO {1, 8000: (0,7160,12000,0,32767,0,0,0)}
    - CHORUS {1, 800: (0,200,16384,0,32767,7600,700,0)}
    - FLANGE {1, 800: (0,200,0,24575,32767,380,500,0)}
  - **SA** (verified): fxType 6 = custom, params at 0x8008F2C0 = {2, 8000: (0, 2560, 16383, −16383, 2949, 0, 0,
    19004), (0, 5760, 16383, −16383, 16383, 0, 0, 19004)}.
  - BM64 and Hero have custom tables next to their configs (BM64 ROM 0xBBAC8 {3, 6400: …}, Hero ROM 0x4AF18
    {1, 12800: (0, 8000, 12000, 0, 32767, 0, 0, 16000)}), but a config byte suggests SMALLROOM. Which is active is
    unresolved.
  - The reverb algorithm (libultra `reverb.c`) is optional for a recognisable render.
- **Vibrato/tremolo:** no instrument in any game uses tremolo. Vibrato is set on 6 instruments in BM64, 1 in Hero
  and 55 in SA. From SA code (verified: `initOsc` 0x8002372C, `updateOsc` 0x80022744, `_depth2Cents` 0x80020C3C):
  - Updates every 16,000 µs; depth in cents = `1.0309929847717285 ^ vibDepth`.
  - Type 128 (sine): period `259 − vibRate` updates, value `sin(2π·cur/period) · depth`.
  - Type 136 (saw): period `256 − rate`.
  - Types 132/137 (4-phase steps): period `(259 − rate)/4`.
  - Type 138: sine with negated depth.
  - Output scaling and vibDelay are open.
- **Resampler:** the RSP uses a 4-tap interpolator (verified, `alist_resample`); linear interpolation is an
  acceptable stand-in.
- **Rate for the viewer:** render and declare 32,000 Hz. The hardware's 32,006 Hz differs by 0.02%, which is
  inaudible; use 32,006 only when aligning with emulator captures.
- The Python prototype does not implement the exponential ramps, pan table, live controllers, reverb or vibrato
  yet. Its measured match (Hero song 24: loudness correlation 0.88, chroma 0.93; SA song 3: 0.71, 0.94) is the
  baseline.
- Loops for `DecodedMusic` (verified on every looping track of Hero song 2, and consistent in all
  songs checked): in a looping song, FF 2E (loop start) and FF 2D (loop end) sit at the **same tick in
  every track**, and FF 2D's back-offset jumps to the byte right after FF 2E. So
  `loopStartTick` = tick of FF 2E and `loopEndTick` = tick of FF 2D (cnt = 0xFF = forever). Convert ticks
  to samples by integrating the tempo map: `seconds = Σ ticks · usPerQuarter / 1e6 / 480`,
  `samples = seconds · outputRate`. Render from 0 to `loopEndTick` plus the release tails. Example: Hero
  song 2 "Action Scene A" has loopStart tick 15362 = sample 448,474 and loopEnd tick 61444 = sample
  1,793,780 at 32,000 Hz. Songs without markers (e.g. Hero song 24, the title theme) play once and have
  no loop. Finite loops (cnt = 3, BM64 only) must be unrolled (jump back `cnt` times) before the final
  forever loop, if any.

Reference implementation (Python): `bm/audio/scripts/n64audio.py` (S2 parser,
VADPCM decoder, sequence parser including back-references and loops, simple sampler, WAV writer);
`render_one.py {game} {song} {bank} {seconds}`.

### 5.3 Instruments and sample encoding

#### Instrument bank (.ctl) (verified: all pointers resolve in all three games)

Standard libultra ALBankFile, big-endian, offsets relative to the .ctl start (relocated by adding the
base, as `alBnkfNew` does):

ALBankFile, four-byte header and counted offsets:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | s16 | revision | 0x4231 (B1). |
| 0x02 | 2 | s16 | bankCount | Bank count. |
| 0x04 | 4 × bankCount | s32[] | bankOffset | Bank offsets. |

ALBank, 0x0C-byte header and counted offsets:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | s16 | instCount | Instrument count. |
| 0x02 | 1 | u8 | flags | Relocation flags. |
| 0x03 | 1 | u8 | padding | Padding. |
| 0x04 | 4 | s32 | sampleRate | 32000 Hz. |
| 0x08 | 4 | s32 | percussion | Instrument offset or zero. |
| 0x0C | 4 × instCount | s32[] | instOffset | Instrument offsets. |

ALInstrument, 0x10-byte header and counted offsets:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 1 | u8 | volume | Volume. |
| 0x01 | 1 | u8 | pan | Pan. |
| 0x02 | 1 | u8 | priority | Priority. |
| 0x03 | 1 | u8 | flags | Flags. |
| 0x04 | 4 | u8[4] | tremolo | Type, rate, depth, delay. |
| 0x08 | 4 | u8[4] | vibrato | Type, rate, depth, delay. |
| 0x0C | 2 | s16 | bendRange | Pitch-bend range. |
| 0x0E | 2 | s16 | soundCount | Sound count. |
| 0x10 | 4 × soundCount | s32[] | soundOffset | Sound offsets. |

ALSound, 0x10 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | s32 | envelope | Envelope offset. |
| 0x04 | 4 | s32 | keyMap | Key-map offset. |
| 0x08 | 4 | s32 | wavetable | Wave-table offset. |
| 0x0C | 1 | u8 | samplePan | Pan. |
| 0x0D | 1 | u8 | sampleVolume | Volume. |
| 0x0E | 1 | u8 | flags | Flags. |
| 0x0F | 1 | u8 | padding | Padding. |

ALEnvelope, 0x10 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | s32 | attackTime | Microseconds. |
| 0x04 | 4 | s32 | decayTime | Microseconds. |
| 0x08 | 4 | s32 | releaseTime | Microseconds. |
| 0x0C | 1 | u8 | attackVolume | Attack target. |
| 0x0D | 1 | u8 | decayVolume | Decay target. |
| 0x0E | 2 | u8[2] | padding | Alignment padding. |

ALKeyMap, six bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 1 | u8 | velocityMin | Minimum velocity. |
| 0x01 | 1 | u8 | velocityMax | Maximum velocity. |
| 0x02 | 1 | u8 | keyMin | Minimum key. |
| 0x03 | 1 | u8 | keyMax | Maximum key. |
| 0x04 | 1 | u8 | keyBase | Base key. |
| 0x05 | 1 | s8 | detune | Cents. |

ALWaveTable, 0x14 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | s32 | base | Offset into .tbl. |
| 0x04 | 4 | s32 | len | Encoded byte count. |
| 0x08 | 1 | u8 | type | 0 VADPCM; 1 RAW16. |
| 0x09 | 1 | u8 | flags | Flags. |
| 0x0A | 2 | u16 | padding | Padding. |
| 0x0C | 4 | s32 | loop | Loop offset. |
| 0x10 | 4 | s32 | book | Predictor-book offset. |

ALADPCMloop, 0x2C bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | start | Loop start sample. |
| 0x04 | 4 | u32 | end | Exclusive loop end. |
| 0x08 | 4 | s32 | count | −1 repeats forever. |
| 0x0C | 0x20 | s16[16] | state | Decoder history. |

ALADPCMBook, eight-byte header and coefficients:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | s32 | order | Observed: 2. |
| 0x04 | 4 | s32 | npredictors | Observed: 4. |
| 0x08 | 16 × order × npredictors | s16[] | book | Predictor coefficients. |

All wave tables in all three games are type 0 (VADPCM), order 2, 4 predictors.

#### VADPCM decoding (verified bit-exact)

9-byte frames of 16 samples: header byte `scale << 4 | predictorIndex`, then 8 bytes = 16 signed 4-bit
residuals, `r = signExtend4(nibble) << scale`. With `cb = book[predictorIndex]` (16 s16: `b1 = cb[0..7]`,
`b2 = cb[8..15]`), each frame is decoded in two halves of 8 samples:

```
half 0: l1 = prev[14], l2 = prev[15]     (prev = previous frame's 16 outputs; zeros at start)
half 1: l1 = out[6],   l2 = out[7]
for i in 0..7:
    acc = (r[i] << 11) + b1[i]·l1 + b2[i]·l2 + Σ_{k<i} b2[k]·r[i-1-k]
    out[i] = clamp16(acc >> 11)
```

This is the ABI1 `A_ADPCM` command (mupen64plus-rsp-hle `alist_adpcm`). Verified: for looped waves, the
16-sample `ALADPCMloop.state` equals the decoded PCM just before the loop start (BM64 66/66, Hero 57/58,
SA 105/113 exact; the rest are near misses, likely loop-state rounding in the tools).

### 5.4 Music catalog and loop points

#### Song lists

Evidence levels: **obs** = observed in RAM or captured audio; **code** = constant or table in code (the
screen it belongs to may still be inferred); **name** = in-game Sound Test; **H** = hypothesis.

##### Bomberman 64: 47 songs, no in-game names (no sound test)

Stage music: seg2 `0x8023C84C` plays song `W + 3` for world W (u32 at 0x802AC5E8, stage at 0x802AC5EC). If
flag `0x802AC5D0 & 8` is set (H: boss stage), world 0 → 14, worlds 1–3 → 11, world 4 → 12 or 13, world 5 →
15 or 16. Overlays play music through ZeroJump id 0x2B02 (0x2B01 stops, 0x2B03 fades).

| Song | Use |
|---|---|
| 1 | Adventure intro town cutscene, overlay 0x1A (obs + code) |
| 2 | World/Stage Select (overlay 0x21, code) |
| 3–8 | adventure stage theme for world 0–5 (code): Green Garden, Blue Resort, Red Mountain, White Glacier (world indices verified), Black Fortress, Rainbow Palace (by elimination) |
| 10, then 18 | Stage 2 bosses: Friend or Foe? (0x31), VS Artemis (0x3E), VS Orion (0x56), VS Regulus (0x62) (code; 18 is presumably the victory cue) |
| 11 / 12, 13 / 14 / 15, 16 | boss music: worlds 1–3 / world 4 / world 0 / world 5 (code; "boss" is H) |
| 19 | short cue after 42 in the boss arenas 0x88–0x8D (code) |
| 20, 24, 28, 33, 45, 46 | seg2 constant calls (code; screens unidentified) |
| 21 | seg2 0x802400A8, alternative to 45 by a flag (code) |
| 22 | story cutscene overlay 0x1C (code) |
| 26 | attract intro, title, main menu (obs) |
| 27 | battle match (obs; seg2 0x8023C41C) |
| 29 | Battle menu (obs; overlays 0x23 battle menu, 0x25 Custom) |
| 31, 32 | battle menu overlay 0x22 (code) |
| 35 | VS Altair (0x74) and Final Battle! (0x7E) (code) |
| 42 | boss arenas 0x88–0x8D: Winged Guardian, Sewer Savage, Hot Avenger, Cold Killers, High-Tech Harvester, Spellmaker (14-second cue; code) |
| 44, 13 | VS Altair (0x74) (code) |
| 16 | Final Battle! (0x7E) (code; also a world-5 boss song) |
| 0, 9, 23, 25, 34, 36, 37, 41, 43 | identical 1-track 0xB8-byte cues, no reference found: unused candidates (section 10) |
| 17, 39, 40 | three near-identical variants of one full looping song, no reference found: unused candidates (section 10) |
| 30, 38 | short cues, no reference found: weak unused candidates |

## 6. Unused and hidden content

### 6.1 Unreferenced assets

Source: `notes/unused.md` (tools and string dumps in `bm/unused/`). "Static" means
disassembly and cross-references: `xref.py` resolves jal targets, lui/addiu pairs and data words over main code
and every overlay. Indices computed at run time (base + k, SA event scripts) are not resolved, so
file-level results are **candidates** unless marked high confidence.

#### Bomberman 64

| Finding | Where | Evidence | Confidence |
|---|---|---|---|
| "*** MAP INFORMATION ***" debug printer (offset, layer, size) | function 0x8026ECF4, strings 0x802A3B74 | no caller in main code or any of the 95 overlays | high (static) |
| "debmap0" test-map overlays (strings "debmap0 : Mapchange happened!" etc.) | overlay ids 0x14–0x17 = archive 0x120000 files 1–4; asset 835 is loaded only by 0x16 | No scene change targets 0x15–0x17, and only 0x16 → 0x14 exists. At power-on the next-scene variable reads 0x14, but the loader log from power-on (bm64fs/dbgdrive.log: first loads 0x20, 0x1B, …) never loads 0x14–0x17. | medium |
| 12 overlay ids with no file | 0x18, 0x7A, 0x7D, 0x9C–0xA4 (id table ROM 0x30800) | the archive directories don't list them | high |
| Area overlays with no incoming scene change | 0x5D (map 553), 0x9B (map 563, "request resource %d") | scene-change scan | medium |
| 23 asset indices never used as constants | 143, 173, 181, 215, 311, 362, 605, 612, 614, 615, 621, 625, 628, 641, 645–647, 756, 778, 785, 833, 839, 842 | Constant scan only; 143 is in fact loaded in Green Garden stage 1 (bm64_model *Level format*), so indices are also computed at run time | low |
| Unused music candidates: songs 0, 9, 23, 25, 34, 36, 37, 41, 43 (identical short cues), 17/39/40 (three near-identical versions of one full looping song), 30, 38; music banks 1 and 2 | music blob (section 6) | no code reference found | low–medium |
| Leftover text: "move.c" source name, EEPROM revision error, sched.c asserts, "trap task:entry failed" (13 overlays), build date "SAT SEP  6 14:57:59 JST 1997" (ROM 0xBD500) | main code, overlays | strings | high (presence) |

Locked but not unused: battle stages 7–10 (In the Gutter, Sea Sick, Blizzard Battle, Lost at Sea) are in the
stage-select name table but hidden on a new save. Code unlocks 7–8 with save flag 2 and 9–10 with save flag 1
(section 4.1).

### 6.2 Cut or inaccessible levels

### 6.3 Debug features

### 6.4 Prototype or revision-specific content

## 7. nviewer implementation

### 7.1 Module mapping

#### Detection and plumbing (straightforward)

- `src/rom/index.ts openRom()`: add cases `NBME` → `openBomberman64`, `NBVE` → `openBomberman64SA`,
  `NBDE` → `openBombermanHero`. Byte-order normalisation is already there.
- `types.ts`: widen `Game.id` to include `'bm64' | 'bm64sa' | 'bmhero'`. `LevelKind` currently has
  `'race' | 'battle' | 'stunt' | 'obstacle'`; Bomberman needs story levels, e.g. add `'adventure'` (BM64
  Adventure, SA Story Mode, Hero planets). Battle stages can reuse `'battle'`.
- `src/ui/Sidebar.tsx` groups levels by the fixed `GROUPS` list: add a group for the new kind (e.g.
  "Adventure" / "Story"). Level names for story levels are best written as "World – Stage – Area" (BM64),
  "Planet – Area – Map" (Hero).
- `src/render/startView.ts` looks for an interior start view when `kind === 'battle' || 'stunt'`; the
  Bomberman battle stages are small arenas seen from above, so the existing battle heuristic is a
  reasonable default.
- The worker (`src/worker.ts`) already exposes `Game.music` and `decodeMusic(index)`; nothing to add
  beyond implementing them. `romCache.ts` keys by game id.
- `APP_NAME = 'Rush Level Viewer'` in Sidebar.tsx will need renaming once non-Rush games are supported.

#### New and reused modules

| Piece | Reuse | New module (suggested name) |
|---|---|---|
| ROM detection, byte order | `rom.ts normalizeByteOrder`, `index.ts` | — |
| BM64/SA LZSS (1,024 ring, start 0x3BE, size-terminated) | not `lzss.ts` (different ring, match layout, terminator) | `src/rom/bomberman/lz1k.ts` |
| Hero LZSS (4,096 ring, start 0xFEE, pos12/len4+3, LE input-size header) | not `lzss.ts` | `src/rom/bomberman/lz4k.ts` (or one parameterised ring-LZSS in `lzss.ts`, done without changing Rush behaviour) |
| SA Yay0 | — | `src/rom/yay0.ts` |
| BM64/SA archives (header + page table) | — | `src/rom/bomberman/archive.ts` (one class, parameterised by dataOffset/capacity) |
| Hero chained files by ROM offset | — | `src/rom/bomberman/heroFiles.ts` |
| F3DEX 1.x display lists (BM64, Hero) | `displaylist.ts` F3DEX path, extended (see below) | options on `DisplayListContext`, not a fork |
| F3DEX2 display lists (SA) | `displaylist.ts` F3DEX2 path, extended (see below) | same |
| Texture decoding / RDP tile emulation | `texture.ts` **unchanged** (verified for all three games) | a `loadTile()` helper next to `loadBlock()` for G_LOADTILE |
| Lighting bake (all three) | — | `src/rom/bomberman/lighting.ts` (normal × light → vertex colour) |
| "64" containers (BM64 + Hero share the format) | — | `src/rom/bomberman/container64.ts` |
| SA NIFF models | — | `src/rom/bomberman/niff.ts` |
| Level loaders | pattern of `rush1.ts` | `bm64.ts`, `bm64sa.ts`, `bmhero.ts` |
| Music (all three: S2 + B1 ctl + VADPCM tbl + compressed MIDI) | nothing in the repo yet | `src/rom/music/libultra/{s2.ts, bank.ts, vadpcm.ts, cseq.ts, synth.ts}`, shared by all three games; per-game offsets and song names in the game loaders |

#### Extensions to `displaylist.ts` (all backwards compatible with the Rush loaders)

Implemented and tested in three research copies: `bm64_model/displaylist_bm64.ts` (F3DEX, BM64),
`hero_level/herodl.ts` (F3DEX, Hero) and `sa_niff/dl_bm.ts` (F3DEX2, SA).

| Change | Why | Games |
|---|---|---|
| `vertexScale` (default 1/16) and `mirrorX` (default true) in the context | Bomberman: scale 1, no mirroring | all |
| Segment table updated by G_MOVEWORD(G_MW_SEGMENT) (BM64/Hero: F3DEX `0xBC` index 6), falling back to `resolve` | BM64 banks on segments 3..14; frame replays | BM64, Hero |
| Modelview stack (G_MTX push/mul/load, G_POPMTX) applied to positions | node trees with translations | BM64, Hero |
| `lighting` hook: when G_LIGHTING is set, treat vertex RGB as a signed normal and call a shader with the current modelview, lights (G_MOVEMEM) and light colours (G_MOVEWORD LIGHTCOL: 0x20/0x24 light 2, 0x40/0x44 ambient) | lit geometry | all |
| G_LOADTILE (0xF4) with `rdp_load_tile` semantics, and remembering the SETTIMG width field + 1 as the image stride | characters (BM64 184 uses), SA textures (416 uses) | BM64, SA |
| Caller-supplied initial render mode / alpha compare (BM64 and Hero default 0x00553078 cutout; SA per draw layer) | lists never set SETOTHERMODE_L | all |
| Caller-supplied initial geometry mode (SA: 0, lists set it; BM64/Hero: 0x22205) instead of `cullBackByDefault` only | | all |
| Ignore G_CULLDL (0xBE F3DEX, 0x03 F3DEX2) safely; type-8/TEXTURE_GEN: approximate UVs | every list starts with a CULLDL | all |
| Track SETPRIMCOLOR (0xFA), SETENVCOLOR (0xFB) and the 16 SETCOMBINE fields; fold the combiner into vertex colour/alpha with TEXEL0 = 1 (5.3.3) | 15% of SA triangles use PRIM/ENV; texture-only lists must ignore shade | SA (BM64 translucent effects too) |
| Texture cache key must include the file (the existing `keyPrefix`) | texture offsets repeat across files | all |

#### Difficulty and risks (preliminary)

- Filesystem and codecs: low. They are fully specified above and verified byte-exact against RAM.
- Music: medium. The formats are standard and fully specified, and a Python renderer already matches game
  timing and pitch. The work is a faithful synthesizer (envelopes, pitch bend, pan, voice limit, reverb
  optional) that runs in a worker in reasonable time. Songs must be rendered to a finite PCM buffer with
  a loop region.
- Geometry, BM64 and Hero: medium. The container format is simple and fully decoded (triangle-exact against
  RDRAM for BM64), and all BM64 battle maps and all 102 Hero map files decode. The work is the display-list
  extensions, lighting bake, and hard-coded per-stage file lists (tables in section 4). Risks:
  - Hero names are only available as bitmaps, so a loader must hard-code them.
  - Props and objects: Hero placement records are verified. BM64 props have no single placement format (5.4.6),
    so a first version should show map geometry only.
  - Skies and backgrounds are 2D blits drawn by game code, not meshes, so the `Sky` type needs a screen-space
    background or an approximating mesh.
- Geometry, SA: medium. NIFF is richer: object trees with rotation orders, draw layers, texture sets bound at run
  time, lights evaluated from environment records, and combiners. All of it is specified (5.3), and all 22
  battle maps and the first story area render correctly. Story placements beyond the map need the object id →
  model mapping, which is mostly unresolved. Models whose textures come from run-time texture sets will be
  untextured unless the loader picks the set the game uses.
- Visual fidelity risks for all three: fog-alpha blending of translucent effects (BM64 water uses it: draw at
  alpha 0.6), static frames of animated textures (UV scroll), about 3–5% lighting brightness error, and the lerp
  combiners in about 410 SA triangles.

### 7.2 Supported features

### 7.3 Approximations and omissions

## 8. Verification and remaining work

### 8.1 Verification evidence

All paths are under `bm/`. Emulator: headless mupen64plus (glide64mk2 software
rendering, HLE RSP). Its `--debug` core was used for breakpoints and RDRAM dumps.

#### Reference screenshots of the real games

| Game | Directory | Contents |
|---|---|---|
| BM64 | `ref_bm64/shots/` (62) | title, menus, all 6 battle stage-select previews and starts, Adventure intro, World Select for 4 worlds, stage-1 title cards and gameplay starts of all 4 worlds |
| SA | `ref_bm64sa/shots/` (56) | title, battle menus, 4 battle stages in play (incl. Tropical Island flood, Park water animation frames), story intro, first area, World Select |
| Hero | `ref_hero/shots/` (36) | title, file menu, planet/area/stage select, Battle Room gameplay and camera views, Sound Test, Score pages |
| BM64 | `bm64_model/shot_gg1_at_dump.png`, `shot_rockgarden_at_dump.png` | frames matching the RDRAM dumps |
| Hero | `hero_level/emu_s11_start.png`; `unused/shots/hero_master_debug_page10{0,1,2}*.png` | stage 1-1 start; hidden debug menu |
| SA | `sa_niff/dumps/normal2_shot.png`, `sa_niff/renders/emu_story2057_*.png`, `sa_stage/shots/` | battle in play; intro cell |
| BM64 | `bm64_stage/shots/` (32), `bm64_model/shot_*_at_dump.png` | Green Garden 1, White Glacier 1, Field of Grass, UP and Down, Pyramid, Greedy TraP, Top Rules |
| Hero / SA | `verify/shots/hero_s18_fogroute.png`, `verify/shots/sa_2101_aquanet.png` | fogged stages used to verify the fog formulas |

#### What was checked against the running game or the ROM

| Claim | Method | Result |
|---|---|---|
| ROM identity | header CRC1/CRC2 recomputed with the CIC-6102 algorithm (`notes/crc.py`) | all three match |
| BM64 LZSS decoder | 125 decompressions (10 overlays, 115 assets) dumped from RDRAM at decoder exit from power-on through the Adventure intro (`bm64fs/dbgdrive.py`, `verify.py`, `dumps/`) | 125/125 byte-identical |
| SA LZSS and Yay0 | RDRAM at decoder exit: resource 3044 (LZSS), exec 0x1A (LZSS, TLB-mapped), resource 13 (Yay0) (`bm64safs/dumps/d1–d3.bin`) | byte-identical |
| SA/BM64/Hero code images | RDRAM dumps compared with ROM ranges | code identical; only small `.data` ranges differ |
| Hero LZSS | break at call/return of `lzssDecode`: source = ROM 0x4C9FD0, output 0xFE70 bytes (`herofs/v1_*.bin`); full-RDRAM slot comparisons | identical; 5/5 (attract) and 41/42 (stage 1-1) slots identical |
| BM64 container: no relocation | every container copy in RDRAM frames (Green Garden 1, Rock Garden, intro) compared with the extracted file | identical |
| BM64 decoder = game output | `bm64_model/check_textures.ts`: static decode vs triangles and bound textures of the RDRAM frame | 578: 802/802 triangles, 11/11 textures; 513: 152/152, 9/9; 315: 1,303/1,303, 26/26 |
| BM64 scale, handedness, lighting, cutout | renders with the camera extracted from RDRAM, next to the emulator frame | `bm64_model/renders/gg1_cmp_shot_vs_decode.png` (19.1 mean diff), `rockgarden_cmp_shot_vs_decode.png` (13.9) |
| Hero map decode, scale, handedness | map-only render at the game camera; replay of all draw calls of the frame | `hero_level/renders/cmp_s11_cam.png`, `frame_s11_cmp.png` (22.7) |
| Hero placement records | 16 placement records of stage 1-1 vs object positions in the frame | 16/16 match in x, z, yaw |
| SA NIFF relocation and segment resolver | every live NIFF in two RDRAM dumps; gSPSegment values in the frame list vs shape records (`sa_niff/ramniff.py`, `verify_wrappers.py`) | all pointers = file + base; 27/27 and 38/45 draws match (other 7 = runtime texture sets) |
| SA texture upload emulation | static: textures produced by running all 4,750 lists vs direct decode of their records (`sa_niff/textest.ts`) | 3,940/3,941 identical |
| SA battle map, scale, handedness | Normal map rendered with the game camera from the frame matrix | `sa_niff/renders/battle2058_res17_gamecam_vs_emu.png` |
| Music data locations and VADPCM decoder | loop-state check: `ALADPCMloop.state` vs decoded PCM before the loop (`audio/scripts/loopstate_check.py`) | BM64 66/66, Hero 57/58, SA 105/113 exact |
| Sequence parser | parse every song to its end (`audio/scripts/seqcheck.py`) | 155/155 with no errors |
| Output rate | AI_DACRATE in emulator audio captures | 1520 → 32,006 Hz in all three |
| Renderer timing and tuning | captured game audio (`audio/dumps/aicap/`) vs renders: RMS-envelope correlation and chroma | Hero song 24: NCC 0.88 at tempo 1.00, chroma 0.93 at 0 semitones; SA song 3 (bank 3): NCC 0.71, chroma 0.94 |
| Which song plays | RDRAM: sequence bytes and bank pointer of the sequence player (`audio/scripts/ramsong.py`) | SA intro 3, menu 1, character select 5, battle 42; Hero title 24; BM64 intro 1, title/menu 26, battle menu 29, battle 27 |
| Hero Sound Test mapping | code: song table 0x80334468 = 1..32 | song = BGM number + 1 |
| Hero debug menu | `write 0x8016E424 1`, pause, L | three debug pages shown |
| BM64 battle stage → overlay | emulator load log per stage-select position (`bm64_model/dbgdrive.log`) | Rock Garden 0x90, UP and Down 0x91, Pyramid 0x92, Greedy TraP 0x93, Top Rules 0x94 |
| BM64 lighting bake (world-space directions) | region means of a baked static render vs `shot_gg1_at_dump.png` (`bm64_model/light_test.ts`) | within about 3%; view-space variant clearly wrong |
| BM64 backgrounds | RDRAM frame lists in Pyramid and UP and Down (`bm64_model/rdram_pyramid.bin`, `rdram_updown.bin`) | TEXRECT backdrop from asset 662; translucent water quads 519/516 (alpha 0x99 ≈ measured 0.58) |
| SA lighting bake | env-record light evaluation vs light bytes in the frame; brightness vs emulator frames (`sa_niff/bakecheck.ts`) | bytes identical (Normal, area 2223); channel ratios 0.91–1.00 |
| SA animated water | two RDRAM dumps 50 frames apart in Park (`sa_niff/dumps/park4/5.bin`) | river vertex copy t +1000 = 20/frame, as the UV-track record predicts |
| SA battle maps | all 22 maps rendered with baked lights; 4 compared with reference shots at the game camera (`sa_niff/renders/battle_all/`) | geometry and camera coincide (mean diff 22.5–38.3, remainder = characters, blocks, objects) |
| SA first story area | map NIFF 177 at the captured camera vs screenshot (`sa_niff/renders/story2223_res177_gamecam_vs_emu.png`) | floor, bars and walls coincide |
| SA soft-block model | RDRAM resource cache walk + segment-4 bases (`sa_stage/objmap.py`) | object id 25 → NIFF 586 at placement + (50, 0, 50) |
| BM64 adventure selection | RAM scene/world/stage variables and screenshots after selecting Green Garden 1 and White Glacier 1 (`bm64_stage/shots/`, `dumps/rdram_gg1_ovl28.bin`, `rd_wg58.bin`) | 0x28 (world 0, stage 0, title card "Untouchable Treasure"); 0x58 (world 3, stage 0) |
| BM64 Field of Grass | stage select position 6 → RAM (`bm64_stage/dumps/rd_fog95.bin`) | overlay 0x95, map 529, TEXRECT background from 662 |
| BM64 fog formula | frame list in Blizzard Peaks vs `setFog(945, 970, 230, 240, 255)` | fm 5120, fo −4556, SETFOGCOLOR E6F0FF80, clear 0xE7BF: as predicted |
| BM64 map placement | object pool in RAM; map asset in RAM vs file | map 578 at origin, byte-identical; prop records match overlay data floats |
| Hero names | label sprite files decoded and read; stage-index table 0x80106DA0 disassembled | full named list (4.3) |
| Hero all maps decode | `hero_level/render_all_maps.ts` | 102/102 map files render, 0 failures (`renders/maps/contact_sheet.png`) |
| Hero fog formula | stage-select table patch to Fog Route; frame list from RDRAM; fogged render vs screenshot (`verify/`) | BC fog word fm 2560 / fo −2304 and colour DCE1E6 as predicted; map-only fog; render diff 20.6 (fog) vs 37.6 (no fog) |
| SA collision file | relocated file in RDRAM (Normal, Park, Rope Bridge, area 2101); cell lookup code vs polygon extents; stored normals vs cross products (`bmcol/sa/`) | identical; 53,028/53,162 references overlap; 16,094/16,094 normals |
| Hero collision planes | floor query port vs RAM results (stage 1-1, Fog Route); plain floors vs coplanar map triangles, with a mirrored control (`bmcol/hero/stats.txt`) | results equal; 85–100% on most stages, mirrored near 0 |
| BM64 attribute grid | RAM grids (4 dumps) vs file; `groundHeight` port vs object heights; floors, slopes and walls vs map geometry (`bmcol/bm64/run.out`, `align.out`) | equal except runtime edits; 85 of 101 objects; 91–100% floors |
| SA fog formula | warp to area 2101 at `gamesceneSetup`; frame lists from RDRAM (`verify/sa/`) | DB08 fm 3282 / fo −3026 and colour 000F2E as predicted; fog render modes active; objects fogged |

#### Sample extractions

- **Texture sheets:**
  - `bm64_model/renders/gg1_decode_textures.png`, `rockgarden_decode_textures.png`, `intro315_textures.png`, `sheet_bomber_banks_74_77.png`
  - `sa_niff/renders/sheet_17.png`, `sheet_stages_17_19_21_23.png`, `sheet_ram_normal.png`
  - `hero_level/renders/s0map_textures.png`, `sheet_areaselect.png`
- **Geometry renders:**
  - `bm64_model/renders/battle_overviews_montage.png` (all 10 BM64 battle maps), `gg1_decode_overview.png`, `rockgarden_decode_overview.png`
  - `hero_level/renders/s0map_lit_top.png`, `bm64_model/renders/hero_1_1_container_overview.png`
  - `hero_level/renders/maps/contact_sheet.png`: all 102 distinct Hero map files (0 decode failures)
  - `hero_level/renders/names/labels_all.png`: Hero area/map name labels
  - `sa_niff/renders/area2057_models_overview.png`, `test_17_top.png`
- **Songs:** `audio/wav/`: 10 WAVs (section 6.7).
- **Extracted files:** `bm64fs/files/`, `bm64safs/files/`, `herofs/files/`, each with an `index.txt`.

### 8.2 Known unknowns

#### Open questions and hypotheses

Everything here is **unverified**. Verified facts are in sections 1–8 and 10.

**All games / viewer**
- The lighting bake is verified for BM64 and SA (world-space directions); for Hero it is assumed to be the same.
  About 3–5% residual over-brightness (hypothesis: RSP fixed-point rounding / emulator filtering).
- Fog-alpha blending of BM64 translucent objects (blend factor = SETFOGCOLOR alpha) has no equivalent in `Batch`;
  per-batch alpha is the proposed approximation. The SA combiner fold (5.3.3) is verified for 99.6% of
  triangles; the ~410 lerp-combiner triangles are not handled.
- SA billboard objects (kind 3) and environment-mapped lists (BM64 type 8, SA G_TEXTURE_GEN): the exact texgen
  formula is not modelled.

**Bomberman 64**
- Names of worlds 4/5 (Black Fortress, Rainbow Palace) by elimination only; which stages are bosses (inferred from
  music and structure); Blue Resort area 0x3D shared by stages 1 and 3; entry param → spawn point mapping.
- Prop placement has no single data format: positions come from overlay code and data records (verified for Green
  Garden 1 only).
- Attribute grid (5.4.7): bits 0x2000/0x4000/0x8000; floor shapes 2, 9, 10, 11; per-stage trigger callbacks (id 5
  fills large empty volumes: a fall zone?); battle markers 1–4 as player starts; whether maps chamfer corner cells;
  Green Garden 1 (43) and Switches and Bridges 1 (84) floor cells without a map surface (props, hypothesis).
- The map-part flag 0x60 path (Black Fortress, Trap Tower parts).
- Blue Resort's water (animated?) was not captured. The per-band texture-offset formula of the `setBackground`
  backdrop is unknown.
- Which stages register UV scrolls and at what speeds (code call sites known, none active in captures);
  texture-bank animation frame durations; meaning of record types 2, 3, 7.
- In-game meaning of the battle unlock flags (world 5 stage 3; a 120-item counter, probably Gold Cards).
- The seg2 lists at 0x802A2A40 as an ending/credits scene tour.

**The Second Attack**
- Battle unlock rule (exec 0x1C); purpose of rows 5–6 of the battle table.
- Default camera without a record: which angle component is pitch.
- Which NIFF each object id (class 1/4 placements) draws, except id 25 → 586. Also: play order of areas within a
  world; world-name index equals world index (order match only).
- UV-scroll speeds on maps other than Park; deform tracks (shape+52, class 4); normals of rotated objects in the bake;
  texture-set selection for characters.
- Class-3 animation channel semantics, class 4/5 data, NIFF header +0x14.
- Collision attribute bits other than 0x2 (floor) and 0xC00 (object filter), e.g. 0x1C as solid wall; which objects have
  mask classes 0 / 0x300 (5.3.11).

**Hero**
- Only stages 1-1 and 18 (Fog Route) were loaded in the emulator; the other maps are verified by static decode
  only. Fog mode 1 (no stage uses it) was not observed.
- Whether the backdrop picture scrolls with the camera.
- Scale source of some object classes (switch 0.9); MAPWOOD's Y offset; a placement-record-driven render of 1-1.
- Lighting bake: F3DEX 1.x light-direction transform, alpha, combiner; Bomberman's material looks wrong in the replay.
- Collision (5.2.7): attributes 200, 223–226, 228, 229, 235, 242, 249, 250, 253; X/Z meaning of player +36/+44 for
  currents; knock-back 240; the step rule of 0x80084430; Hades Crater's −50 and Killer Gate's ±100 offsets.
- Which label slot the select screen shows per area (name mapping by area order is consistent with every count
  and boss position, but the index was not traced); info-record fields +3/+4/+5/+8/+0x20/+0x30/+0x34.

**Music**
- Voice limits of BM64/Hero (16 assumed) and voice stealing; which reverb BM64 and Hero use; the exact volume
  formula and live controller updates; vibrato scaling and delay (6.6).
- Names of BM64 and SA songs (no sound test); screens of several code-referenced songs.
- SA event scripts (`evexecAudio`) that also start songs; the unused-song lists depend on them.

### 8.3 References
