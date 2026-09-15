# Pokémon Snap — Nintendo 64 ROM format specification

This manual describes the shipped data formats needed to identify, extract, and
present Pokémon Snap content. Claims state their evidence inline; unsupported
interpretations are labelled hypotheses.

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | **none**: fixed ROM ranges per overlay/segment, position-dependent (absolute vram pointers), resolved per scene load list (*Position dependence and address resolution*) |
| Compression | VPK0 (Huffman-coded LZ), used by three identified menu/intro/check blobs; every decoded level asset is raw (*Compression*) |
| Graphics microcode | F3DEX2 and L3DEX2 2.08H. |
| Geometry | WorldSetup → model/scenery blocks placed at worldPos × 100, plain F3DEX2 lists in HAL's exporter order with runtime-built segment 0x0E material lists (*Level format*). Fog and clear colour from the WorldSetup; a camera-attached sky dome; no lighting on the world |
| Textures | RDP-native textures referenced by course and synthesized material display lists. |
| Collision | height map = BSP of 2D lines → plane patches with RGB surface types; a ceiling map in Tunnel and Cave; hitbox colliders on static objects; no separate terrain-wall structure identified (*Collision*) |
| Music driver | classic libultra ALCSPlayer, 37 statically selected compressed-MIDI songs, `B1` music bank, 32006 Hz. **`libultra.ts` + `cseq.ts` render unchanged** with a CC 21 extra-volume adapter; the renders match captured game audio (*Music*) |
| Audio microcode | `aspMain` ABI1, byte-identical to Super Mario 64 (USA). |
| Sample encoding | Nintendo VADPCM. |
| Levels | 7 courses: Beach, Tunnel, Volcano, River, Cave, Valley, Rainbow Cloud (*Level list*). The Pokémon Lab is 2D only; the album, report, gallery and camera check re-render course worlds for photos; the opening's 3D landscape lives in the main-menu VPK0 buffer |
| Memory requirement | Base 4 MiB. |
| Viewer support | detection/resolver small; world blocks medium (display-list normalisation, material lists); rail/collision small-medium; Pokémon models medium-high (`displaylist.ts` gaps: tile masks and command order, G_MODIFYVTX, F3DEX2 light spacing); music small (*Difficulty*) |
| Rail | per-block AnimCmd scripts drive B-spline control points (arc-length parameterised); eye ≈ cart + 100, fovy 55; block-visibility schedules; 60 updates per second. The decode matches RAM on every course (*Rail path*) |
| Objects | per-block ObjectSpawn lists (231) → per-course PokemonDef tables → PokemonInitData (DObj tree, materials, animations); lit, skinned (G_MODIFYVTX) models with near/far LOD; frame 0 of the first animation; 117 absolute spline paths; HD photo models (*Objects*) |
| Unused and hidden (*Unused and hidden content*) | unreachable Japanese gallery-slideshow overlay; Snap Station's 64 preset photos and 640×480 printer compositor; a dead compressed anti-piracy helper plus the live save-sabotage path; live crash screen and dead performance/watchdog tools; two unused Beach effect sets; two unique untriggered SFX samples; no orphaned course geometry or unique course texture image |

### 1.2 ROM identification

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| USA | `POKEMON SNAP` | `NPFE` | 0 | 16 MiB (`0x1000000`) | `CA12B547` | `71FA4EE4` | `edc7c49cc568c045fe48be0d18011c30f393cbaf` | CIC-6103 | — |
| Snap Station USA | `POKEMON SNAP` | `NPHE` | 0 | 16 MiB (`0x1000000`) | `39119872` | `07722E9F` | `1e16c19ff303f9283d7b53545c4d575c6df43158` | CIC-6103 | — |
| Australia | `POKEMON SNAP` | `NPFU` | 0 | 16 MiB (`0x1000000`) | `7BB18D40` | `83138559` | `eb388731bb7530f60e3ad4a1652f79296b5063ec` | CIC-6103 | — |
| Europe | `POKEMON SNAP` | `NPFP` | 0 | 16 MiB (`0x1000000`) | `4FF5976F` | `ACF559D8` | `d575b393812a0a59fbb52f3ce55ce4d7bc5f3225` | CIC-6103 | — |
| France | `POKEMON SNAP` | `NPFF` | 0 | 16 MiB (`0x1000000`) | `BA6C293A` | `9FAFA338` | `9ee1ed91ad6e00cc50e1a1513a256ccceb9a41df` | CIC-6103 | — |
| Germany | `POKEMON SNAP` | `NPFD` | 0 | 16 MiB (`0x1000000`) | `5753720D` | `2A8A884D` | `f1fe20e26c3803c0e4ea33711be5e0edf8e9c4be` | CIC-6103 | — |
| Italy | `POKEMON SNAP` | `NPFI` | 0 | 16 MiB (`0x1000000`) | `C0C85046` | `61051B05` | `f69bfbf1f5590b2f25a79400abcdafb884f5e3a0` | CIC-6103 | — |
| Spain | `POKEMON SNAP` | `NPFS` | 0 | 16 MiB (`0x1000000`) | `817D286A` | `EF417416` | `24da787140662d1fb40d8e17199ce6412d72dedc` | CIC-6103 | — |
| Japan | `POKEMON SNAP` | `NPFJ` | 0 | 16 MiB (`0x1000000`) | `EC0F690D` | `32A7438C` | `5d7b3b8d4bb64da5b7ae5e1f132b26a282c33909` | CIC-6103 | — |

Verified from the normalized ROM headers and complete-image SHA-1 hashes.

### 1.3 Terminology and conventions

ROM and memory ranges are half-open. Offsets, addresses, encoded sizes, masks,
and opcodes are hexadecimal unless stated otherwise. Multi-byte CPU fields are
big-endian. RAM addresses are virtual unless explicitly identified as physical;
segmented, VROM, and file-relative addresses are named at each use.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

#### Boot, main, microcode

- **ROM 0x1000 = vram 0x80000400:** the entry stub zeroes bss 0x80045670 (size 0x55250), sets sp 0x80045870 and jumps to `game_main` 0x80000870 (**verified** by disassembly).
- **main** is ROM 0x1000-0x46270 at vram 0x80000400 (`vram = rom + 0x7FFFF400`), with bss to 0x8009A8C0. It holds libultra, the RSP ucodes and HAL's `sys` library (object manager, renderer, audio, DMA).
- **Microcode ID strings** (**verified**, exact bytes; three spaces after `F3DEX.NoN`, seven after `L3DEX`):
  - ROM 0x45B98: `RSP Gfx ucode F3DEX.NoN   fifo 2.08H Yoshitaka Yasumoto 1999 Nintendo.` (F3DEX2);
  - ROM 0x45FB8: `RSP Gfx ucode L3DEX       fifo 2.08H Yoshitaka Yasumoto 1999 Nintendo.` (L3DEX2).
- The gtl ucode table in main .data holds the F3DEX2 text/data pair {0x8003E7A0, 0x80044E60} at ROM 0x4190C and the L3DEX2 pair at 0x4193C (**verified**). Level display lists are therefore **F3DEX2** (`displaylist.ts` ucode `'f3dex2'`).
- **Build string** `HAL_SNAP_V1.0-1` is at ROM 0x5EF80 in more_funcs (**verified**). There is no libultra version string. The release word 0x1449 suggests libultra 2.0I (hypothesis; the decomp builds with `VERSION_I`).

#### Overlays

Everything outside main is loaded from fixed ROM ranges. There is **no file table and no filesystem**: the ranges are hard-coded as `Overlay` structs or as constants in loader code.

**Overlay struct** (0x24 bytes, big-endian; **verified**, 31 of 31 structs in all dumps):
```
+0x00 u32 romStart     +0x04 u32 romEnd      +0x08 u32 vram
+0x0C u32 textStart    +0x10 u32 textEnd     +0x14 u32 dataStart
+0x18 u32 dataEnd      +0x1C u32 bssStart    +0x20 u32 bssEnd
invariants: textStart == vram; textEnd == dataStart; dataEnd == bssStart; dataEnd − vram == romEnd − romStart
```
- **app_render** (persistent): its struct is in main .data at ROM 0x418C0. It is loaded before the scene manager: rom 0x46270-0x5BF20 → vram 0x8009A8C0, bss to 0x800BF060.
- **The other 30 structs** form a table in app_render .data at **ROM 0x57580** (vram 0x800ABBD0), in a fixed order: unk_segment_AA18E0, window, camera_check, oaks_lab, pokemon_album, pokemon_report, photo_check, gallery, unk_end_level_8, more_funcs, main_menu, menu_new_game, credits, intro_code, app_level, world, then `{level}_assets`, `{level}_code` for beach, tunnel, cave, river, volcano, valley and rainbow.
- Level asset segments are also described as overlays, with a 0x10-byte text and 0x20-byte bss.

**Loaders** in main (**verified** by disassembly):
- `dmaLoadOverlay(ovl)` 0x80002B64 copies [romStart, romEnd) to vram in 0x10000-byte chunks, then zeroes bss.
- `dmaReadRom(rom, ram, size)` 0x80002C20 is a raw copy. The Pokémon segments and `*_extra` segments are loaded this way, with the ranges as code constants.
- `dmaReadVPK0(rom, ram)` 0x8000350C streams a VPK0 file into RAM (*Compression*).

### 2.2 Memory and address mapping

#### Position dependence and address resolution

**Asset data is position-dependent** (**verified**). Level asset segments hold absolute KSEG0 pointers linked at their vram: beach_assets has 2813 self-pointer words, which move exactly with each dump's vram delta. Assets also point:
- into app_render and world code;
- `{level}_extra` into `{level}_assets`;
- Pokémon `*_model` segments into their texture segment (`pikachu1`, `magikarp_textures`).

Different scenes reuse the same vram (splat `exclusive_ram_id`): 0x800F5D90 is magikarp_textures or rainbow_assets; 0x800FFF90 is pikachu1, volcano_assets or valley_assets; 0x8011B050 is zubat1 or beach_assets; 0x8011CB50 is bulbasaur1 or tunnel_assets; 0x8012A0C0 is cave_assets or river_assets. **A pointer can only be resolved within a scene's load list.**

**Static loader rule** (implemented and tested in `fs/proto/snapfs.ts`: every self-pointer in every level's assets resolves back into that segment, on all 9 dumps):
1. Take the scene's load list (*Scenes*): the play list for the level, or the view list for `*_extra`/HD models.
2. Add the persistent segments: main (0x80000400 ← ROM 0x1000), app_render, more_funcs.
3. For an address A, scan the list from the **last** load backwards. The first segment with `vram ≤ A < bssEnd` wins: `ROM = romStart + (A − vram)` inside the data, zero inside bss.

### 2.3 ROM map and asset organization

#### ROM map (US)

"ref" says how the game finds a range (**verified** from ROM bytes): ovl = Overlay struct, rd = `dmaReadRom` constant, pair = lui/addiu ROM constant in code, tbl = the audio ROM-offset table in main (ROM 0x42FF8), sbk = offsets inside the sequence bank.

| ROM | vram | contents | ref |
|---|---|---|---|
| 000000-001000 | – | header, CIC-6103 IPL3 | – |
| 001000-046270 | 80000400 | main: libultra, RSP ucodes (F3DEX2, L3DEX2, aspMain), HAL sys | boot |
| 046270-05BF20 | 8009A8C0 | app_render: scene manager, loaders, renderer, photo code | ovl |
| 05BF20-05F050 | 800BF080 | more_funcs | ovl |
| 05F050-0731B0 | 800E18A0 | world: rail movement, ground, collision code; shared world assets (gate, evolution controller) | ovl |
| 0731B0-0A74E0 | 800F5D90.. | Pokémon texture segments: magikarp_textures, pikachu1, zubat1, bulbasaur1 | rd |
| 0A74E0-13C780 / 13C780-162CB0 | 8011B050 / 801B0310 | beach_assets / beach_extra | ovl / rd |
| 162CB0-1D1D90 / 1D1D90-1F5E70 | 8011CB50 / 8018BC50 | tunnel_assets / tunnel_extra | ovl / rd |
| 1F5E70-27AB80 / 27AB80-29A190 | 8012A0C0 / 801AEDF0 | cave_assets / cave_extra | ovl / rd |
| 29A190-30AF90 / 30AF90-326C10 | 8012A0C0 / 8019AEE0 | river_assets / river_extra | ovl / rd |
| 326C10-3D0560 / 3D0560-3F63D0 | 800FFF90 / 801A9900 | volcano_assets / volcano_extra | ovl / rd |
| 3F63D0-47CF30 / 47CF30-4A8160 | 800FFF90 / 80186B10 | valley_assets / valley_extra | ovl / rd |
| 4A8160-4EC000 / 4EC000-4F0610 | 800F5D90 / 80139C50 | rainbow_assets / rainbow_extra | ovl / rd |
| 4F0610-54B5D0 | 80350200 | app_level: player, items, common Pokémon code | ovl |
| 54B5D0-55C110 | 8033F6C0.. | Pokémon play models (magikarp, pikachu, zubat, bulbasaur) | rd |
| 55C110-82F8E0 | 802BDD00.. | `{level}_code` ×7: level code, the level's Pokémon data and models | ovl |
| 82F8E0-83D730 | 803A71B0.. | Pokémon HD models ×4 | rd |
| 83D730-87A0B0 | 80369F80 | window (UI library) | ovl |
| 87A0B0-A08E30 | 801DC8C0 / 800E18C0 | camera_check, oaks_lab, photo_check, pokemon_album, pokemon_report, gallery, unk_end_level_8 | ovl |
| A08E30-A0F830 | 800E18A0 | main_menu | ovl |
| A0F830-A5CC50 | → 802B5000 | VPK0 main_menu_vpk0 + padding | pair |
| A5CC50-AA0650 | 800E18A0 / 801DC8A0 | menu_new_game, credits | ovl |
| AA0650-AA18E0 | 800E18A0 / → 802B5000 | intro_code, VPK0 intro_code_vpk0 | ovl / pair |
| AA18E0-AAA660 | 801DC8A0 / → 802B5000 | unk_segment_AA18E0 (printer path), its VPK0 | ovl / pair |
| AAA660-AB5860 | – | idle_script_beach, idle_script_tunnel (attract-demo input) | pair |
| AB5860-AE0510 | – | effect scripts and sprite sets (common, 7 levels, intro) | pair |
| **AE0510-AEFC10** | – | 4 gallery + 60 album preset `PhotoData` records; loaded only by Snap Station (*Unused and hidden content*) | Station pair |
| AEFC10-AFEEE0 | – | audio: sequence bank `S1` (37 entries) and 37 sequences | tbl / sbk |
| AFEEE0-BA6C20 | – | audio bank1 (`B1`) + table1 (samples) | tbl |
| BA6C20-F53540 | – | audio bank2 (`B1`) + table2 (samples) | tbl |
| F53540-1000000 | – | 0xFF padding | – |

### 2.4 Compression formats

#### Compression

**VPK0 is the only compression codec used by the identified loaders, with three located streams** (**verified**):
- A whole-ROM search finds `vpk0` at 0xA0F830, 0xAA0B80 and 0xAAA610, and no MIO0/Yay0/Yaz0 magic.
- Entropy (4 KB blocks): the only block run above 7.6 bits/byte is the main-menu stream. Audio samples are raw VADPCM at 7.0-7.4.
- **Every decoded level component (code, assets, textures, display lists, collision, Pokémon models and audio) is stored raw.** The magic/entropy and loader scans found no second codec; this is not a proof against an arbitrary headerless compressed byte range.

| stream | ROM | method | output | loaded to | used by |
|---|---|---|---|---|---|
| main_menu_vpk0 | A0F830-A5CC46 | 1 | 0xF3770 bytes, md5 44e4516d… | 0x802B5000 | scene 8 (title/menu images) |
| intro_code_vpk0 | AA0B80-AA18D3 | 1 | 0x7110 | 0x802B5000 | boot intro |
| unk_segment_AA18E0_vpk0 | AAA610-AAA65B | 1 | 0x50 | 0x80200000 | dead anti-piracy RSP-memory check; its loader has no caller (*Unused and hidden content*) |

**Format** (**verified**: `fs/proto/vpk0.ts` output is byte-identical to the decomp's Python codec on all three streams, and the consumed lengths end exactly at the next segment's padding):
```
+0 "vpk0"   +4 u32 BE decompressed size
+8 bitstream, MSB first:
   u8 method: 0 = one-sample offsets, 1 = two-sample offsets
   offsets tree, lengths tree
   tokens until size bytes are written
tree  = post-order stack code:
        bit 0 -> leaf; next 8 bits = bit width
        bit 1 -> if the stack has >= 2 entries: node(left = 2nd from top, right = top), push
                 else: end of tree (root = last node created)
tv(T) = walk from the root (0 = left, 1 = right) to a leaf, then read leaf.width bits
token bit 0: literal (8 bits)
token bit 1: back-reference
   method 1: v = tv(off); if v <= 2 { adj = v + 1; v = tv(off) } else adj = 0
             src = pos - 4*v - adj + 8
   method 0: src = pos - tv(off)
   len = tv(len); copy byte by byte (overlap allowed)
```
The viewer does not need VPK0 for levels. It needs it only for menu or title images.

#### ROM, code, overlays, codec

| claim | evidence |
|---|---|
| Headers, CRCs, CIC-6103, hashes of 9 dumps | `fs/romid.py` → `fs/romid.txt` (recomputes CRC1/CRC2) |
| Microcode strings, build string, gtl ucode table | ROM bytes (lead re-checked 0x45B98, 0x45FB8, 0x5EF80) |
| 31 Overlay structs, invariants, per-dump layouts | `fs/ovlscan.py`, `fs/ovltables.py` → `fs/ovltables.txt`; lead re-checked the structs at 0x418C0 and 0x57580-0x575C8 |
| Scene jump table, load lists, loader addresses | `fs/callsites.py` → `fs/callsites.txt` (const-propagated disassembly), `fs/disasm_scenemgr.txt`; independent parse `fs/proto/test_snapfs.ts` → `fs/snapfs_scenes.txt` (all 9 dumps). Lead re-checked the 25 table entries at ROM 0x57A08 (7/10/16 → loop head 0x8009B560; 11 = 13; 17-20 shared) |
| Position dependence, vram → ROM rule | `fs/reloc.py` → `fs/reloc.txt` (relocation word-diff US vs Station/E/J); `test_snapfs.ts`: every self-pointer of every level's assets resolves back into its segment |
| VPK0 streams and format | `fs/proto/test.ts`: ALL OK (sizes, consumed lengths, padding, md5 equal to the decomp's Python codec); lead re-ran it |
| ROM map coverage, AE0510 unreferenced | `fs/romrefs.py` → `fs/romrefs.txt`, `fs/entropy.txt` |
| Names | ROM strings (lead re-checked 0x5AD90 table, "Rainbow Cloud" 0x98BA68, "Pokémon Lab" 0x7C6427, `%s Course` 0x8A62EC and 0x9A59E8) |

### 2.5 Loading process

### 2.6 Revision differences

#### Out of scope for a first version

The opening's 3D model/material package (inventoried in *Negative result: no retained cut course*) could be ported as a viewer pseudo-level; the credits and photo scenes also remain out of scope. The Pokémon Lab is 2D only (*Level list*).

## 3. Level data

### 3.1 Level catalog and identifiers

#### Names

`gLevelNames[7]` (pointer table at vram 0x800AC0C4, right after `gLevelID`; strings at ROM 0x5AD90): **`Beach, Tunnel, Volcano, River, Cave, Valley, Rainbow`** (**verified** ROM bytes, lead re-checked). Camera check, photo check, album and report use it, next to a `%s Course` format string (ROM 0x8A62EC, 0x9A59E8) (**decomp** use sites).

Dialogue calls the secret course **"Rainbow Cloud"** (ROM 0x98BA68: "Rainbow Cloud, floating in the sky, is the secret course!") and the hub **"Pokémon Lab"** (ROM 0x7C6427; é is the two-byte code A6 C5) (**verified** strings). No "Oak's Lab" string exists.

#### Level list

Only the seven courses have 3D worlds of their own (**verified**: all seven WorldSetups decode, *WorldSetup*). The photo scenes (camera check, album, report, Gallery and dead scene 24) re-render a course's world through `loadLevelView` and `createWorld`, with no geometry of their own (**decomp**). The **Pokémon Lab draws no triangles at all**: its screens are texture rectangles from `oaks_lab` and `window` (**verified**, frame display lists). The **opening's 3D landscape** (1970 triangles in 148 lists, fog 989/1000 colour (120,120,150), fovy 29.9) is drawn from display lists inside the decompressed `main_menu_vpk0` buffer at 0x802B5000 (**verified**, frame display list); the title screen after START is 2D. The credits and the intro were not captured.

| index | name | kind | scene | assets (ROM) | code (ROM) | notes |
|---|---|---|---|---|---|---|
| 0 | Beach | campaign | 0 | 0x0A74E0 | 0x55C110 | 8 model + 4 scenery blocks |
| 1 | Tunnel | campaign | 1 | 0x162CB0 | 0x5DF5D0 | 6 blocks, no sky |
| 2 | Volcano | campaign | 2 | 0x326C10 | 0x7272E0 | 6 + 1 blocks |
| 3 | River | campaign | 3 | 0x29A190 | 0x6C05E0 | 6 + 4 blocks |
| 4 | Cave | campaign | 4 | 0x1F5E70 | 0x6401B0 | 5 + 1 blocks, no sky |
| 5 | Valley | campaign | 5 | 0x3F63D0 | 0x79F1B0 | 7 + 2 blocks |
| 6 | Rainbow Cloud | bonus | 6 | 0x4A8160 | 0x825E30 | one sky-drawn block, no rail, no collision |

Suggested viewer names: the table names, with "Rainbow Cloud" taken from dialogue. The Lab's course select shows the plain name as its header ("Beach", **verified** screenshot). The Lab and the menu scenes are not levels; the now-inventoried opening landscape could become a viewer pseudo-level if its model/material package is ported (*Out of scope for a first version*, *Negative result: no retained cut course*).

### 3.2 Level container

#### Scenes

`start_scene_manager` (0x8009B49C) first loads more_funcs (rom 0x5BF20-0x5F050 → 0x800BF080, persistent). It then runs the intro (`intro_code` + a VPK0 buffer) and sets scene 8 (main menu). **Verified** from ROM bytes (`fs/callsites.py`).

The loop dispatches the scene id through a **25-entry jump table at 0x800AC058 (ROM 0x57A08)**. Each case loads its overlays, calls the scene entry, and takes the return value as the next scene (**verified**). The level cases call `loadLevelPlay` 0x8009AE0C:
1. `world`;
2. `app_level`;
3. a 7-case jump table at 0x800AC03C that picks `{level}_code`, `{level}_assets` and the shared Pokémon segments;
4. `setLevelId` writes `gLevelID` (0x800AC0C0).

Shared Pokémon segments ("Pk"), each a `dmaReadRom` (**verified**):

| segment | ROM | vram | | segment | ROM | vram |
|---|---|---|---|---|---|---|
| magikarp_textures | 0731B0-07D3B0 | 800F5D90 | | magikarp_model | 54B5D0-54D6A0 | 8034E130 |
| pikachu1 | 07D3B0-098470 | 800FFF90 | | pikachu_model | 54D6A0-554130 | 803476A0 |
| zubat1 | 098470-099F70 | 8011B050 | | zubat_model | 554130-557050 | 80344780 |
| bulbasaur1 | 099F70-0A74E0 | 8011CB50 | | bulbasaur_model | 557050-55C110 | 8033F6C0 |
| | | | | magikarp/pikachu/zubat/bulbasaur_model_hd | 82F8E0 / 832960 / 837360 / 83A1E0 | 803B1F80 / 803AD580 / 803AA700 / 803A71B0 |

Scene table (US; **verified** load lists from `fs/callsites.txt` and the independent parse `fs/snapfs_scenes.txt`; enum names from the decomp):

| id | scene | load list, in order | entry |
|---|---|---|---|
| 0 | Beach | world, app_level, beach_code, beach_assets, magikarp_textures, magikarp_model, pikachu1, pikachu_model | 802C4740 |
| 1 | Tunnel | world, app_level, tunnel_code, tunnel_assets, magikarp_textures, magikarp_model, pikachu1, pikachu_model, zubat1, zubat_model | 802E2BB8 |
| 2 | Volcano | world, app_level, volcano_code, volcano_assets, magikarp_textures, magikarp_model | 802D67C4 |
| 3 | River | world, app_level, river_code, river_assets, bulbasaur1, bulbasaur_model, magikarp_textures, magikarp_model, pikachu1, pikachu_model | 802D9210 |
| 4 | Cave | world, app_level, cave_code, cave_assets, bulbasaur1, bulbasaur_model, magikarp_textures, magikarp_model, pikachu1, pikachu_model, zubat1, zubat_model | 802BE3B0 |
| 5 | Valley | world, app_level, valley_code, valley_assets, magikarp_textures, magikarp_model | 802C6544 |
| 6 | Rainbow Cloud | world, app_level, rainbow_code, rainbow_assets | 80346EF0 |
| 7, 10, 16 | – | none: the case is the loop head, so the id re-dispatches forever | – |
| 8 | Main menu (title) | `dmaReadVPK0(0xA0F830 → 0x802B5000)`, main_menu; for a new game: world, window, menu_new_game | 800E4830 |
| 9 | Camera check | window, camera_check | 801DCACC |
| 11, 13 | Pokémon Lab (Professor Oak) | world, window, oaks_lab (same case) | 800E1AD8 |
| 12 | PKMN Album | world, window, pokemon_album | 801DCCA0 |
| 14 | PKMN Report | world, window, pokemon_report | 801DCC74 |
| 15 | Photo check | window, photo_check | 801DCC74 |
| 17-20 | Credits (variants) | world, window, credits (one case) | 801DCB24 |
| 21 | Attract demo | no load; sets the demo flag and alternates Beach/Tunnel | – |
| 22, 23 | Gallery | world, window, gallery (22 stops audio first) | 801DCEBC |
| 24 | unreachable obsolete Japanese Gallery slideshow (`unk_end_level_8`) | world, window, unk_end_level_8 | 801DD09C |

- **Photo re-rendering.** A second loader, `loadLevelView` (0x8009A8F0, jump table 0x800AC020), loads `{level}_assets` + `{level}_extra` + the Pokémon segments with **HD models** (`*_model_hd`), without code. It re-renders stored photos in camera check, album, report, Gallery and dead scene 24 (**verified** load lists; use **decomp**). It is the only loader of the `*_extra` segments.
- **Overwritten world.** Scenes 11/13 load `world` (0x800E18A0-0x800F5D90) and then `oaks_lab` at 0x800E18C0, and the new-game path overwrites `world` with `menu_new_game`. The later load wins (**verified**, all 9 dumps).

#### Level format

Source notes: `notes/levels.md`. Prototype: `lv/proto/` (`rom.ts`, `anim.ts`, `gfx.ts`, `heightmap.ts`, `course.ts`, `main.ts`; `npx tsx main.ts [course]`, about 2 s per course). Renders: `lv/renders/`.

#### WorldSetup

Each course's code or asset segment holds one WorldSetup; the level entry passes it to `createWorld` (0x800E2F38).

| course | WorldSetup vram (ROM) | HeightMap struct ROM | ceiling map ROM |
|---|---|---|---|
| beach | 0x8011B914 (0x0A7DA4) | 0x5B0F70 | – |
| tunnel | 0x8011E6CC (0x16482C) | 0x623FB0 | 0x623FB8 |
| volcano | 0x800FFFB8 (0x326C38) | 0x76E6D0 | – |
| river | 0x8012AC90 (0x29AD60) | 0x709340 | – |
| cave | 0x8012A0E8 (0x1F5E98) | 0x699AC0 | 0x699AC8 |
| valley | 0x80100720 (0x3F6B60) | 0x7F8F50 | – |
| rainbow | 0x800F5DA0 (0x4A8170) | none | – |

Layout (**verified** by decoding all seven; lead re-checked the ROM bytes):
```c
struct WorldSetup {
  /*00*/ WorldBlockSetup* blocksSetup;
  /*04*/ StaticModelEntry* staticModelTable; // id -> attach handler + payload (*Static models*); NULL in 5 courses
  /*08*/ s32 unk_08;                         // 0 everywhere
  /*0C*/ CollisionModel* collisionModels;    // id -1 ends (*Object hitboxes*)
  /*10*/ f32 animSpeed;                      // added to GlobalTimer each game update (sky rotation, material animation)
  /*14*/ u16 fogMin, fogMax;                 // gSPFogPosition
  /*18*/ u8 fogR, fogG, fogB, bgR, bgG, bgB; // fog colour, clear colour
};
```

| course | animSpeed | fog min/max | fog RGB | clear RGB |
|---|---|---|---|---|
| beach | 0.4 | 996/1000 | 90,161,188 | 90,140,200 |
| tunnel | 0.2 | 996/1000 | 18,81,92 | 90,140,200 |
| volcano | 0.4 | 989/1000 | 121,77,23 | 150,90,57 |
| river | 0.7 | 993/1000 | 35,99,126 | 183,183,183 |
| cave | 6.0 | 996/1000 | 5,8,4 | 5,8,4 |
| valley | 2.0 | 996/1000 | 96,91,99 | 97,105,162 |
| rainbow | 1.0 | 996/1000 | 0,0,0 | 0,0,0 |

#### World blocks

**Verified** layout by decoding every block of all seven courses; semantics **decomp**.
```c
struct WorldBlockSetup { WorldBlockDescriptor** modelBlocks; WorldBlockDescriptor** sceneryBlocks; SkyBox* skybox; };
                                        // both lists NULL-terminated
struct WorldBlockDescriptor {           // 0x24
  /*00*/ WorldBlockGFX* gfx;
  /*04*/ Vec3f worldPos;                // block units; 1 block unit = 100 game units
  /*10*/ f32 yaw;                       // applies to the rail path only; 0 in every course
  /*14*/ s32 reversed;                  // rail played backwards; 0 in every course
  /*18*/ StaticObject* staticModels;    // props attached by id through WorldSetup.staticModelTable (*Static models*)
  /*1C*/ ObjectSpawn* spawn;            // Pokémon and effect spawns (*Objects*)
  /*20*/ StaticObject* staticObjects;   // collision-bearing objects (*Object hitboxes*)
};
struct WorldBlockGFX {
  /*00*/ void* gfxData;                 // Gfx* (render type A/C, skies) or DObj tree (B/D)
  /*04*/ Texture*** textures;           // per DObj: NULL-terminated Texture* list (materials)
  /*08*/ AnimCmd*** materialAnim;       // per DObj, per material: texture animation script
  /*0C*/ GObjFunc renderFunc;
  /*10*/ DObjTreeNode* road;            // rail control points (*Rail path*)
  /*14*/ s32 numControlLines;           // 2 or 3; 0 = no movement
  /*18*/ AnimCmd** movementAnim;        // one script per road node
  /*1C*/ s32 movementAnimDuration;      // 100 everywhere
  /*20*/ f32 cpTimeStamps[numControlLines - 2];
};
struct SkyBox { Gfx* gfx; GObjFunc renderFunc; Texture*** textures; AnimCmd*** animation; f32 animationSpeed; };
```
- **Render functions** (**verified** by value): every non-Rainbow course block uses `renderModelTypeAFogged` (0x800A1530), a plain Gfx list. Rainbow Cloud's only block uses `drawSkyBox2Cycle` (0x800E1D80): no Z, no fog, rotating. Tree types B/D (0x800A15D8, 0x800A1608) are never used for blocks. **A course loader needs only the plain-list path.**
- **Scenery blocks** (the decomp's "UV scroll" list) are ordinary pieces such as far terrain, sea and distant mountains. They have no road and are placed like model blocks (**verified** by renders).
- **Placement.** Instance matrix = translate(worldPos × 100). There is no rotation: the block's DObj is MTX_TYPE_TRANSLATE, and yaw is ignored by it. Vertices are s16 game units local to the block, Y up, no mirroring.
  - **Verified**: adjacent blocks join, and the rail path is continuous to 0.1 unit across every block boundary of the six railed courses.
  - At run time the game re-centres the world on the current block (`position = (worldPos_i − worldPos_current) × 100`), so RAM coordinates are block-local (**decomp**).

| course | model blocks: index (worldPos) | scenery blocks | control lines | materials | textures | triangles |
|---|---|---|---|---|---|---|
| beach | 0 (0,0,0), 1 (−10,0,40), 2 (10,0,60), 3 (40,0,40), 4 (60,0,20), 5 (90,0,40), 6 (100,0,55), 7 (120,0,35) | 8 (−70,0,0), 9 (−50,0,100), 10 (50,0,100), 11 (55,0,25) | 2 | 6 | 51 | 3157 |
| tunnel | 0 (0,0,0), 1 (0,0,40), 2 (40,0,40), 3 (40,0,80), 4 (40,0,120), 5 (80,0,120) | – | 3 | 1 | 44 | 2104 |
| volcano | 0 (0,0,0), 1 (20,0,15), 2 (10,0,35), 3 (−25,0,20), 4 (−70,0,10), 5 (−100,0,30) | 6 (−45,0,−10) | 3 | 12 | 17 | 1740 |
| river | 0 (0,0,0), 1 (30,0,−50), 2 (60,0,−35), 3 (30,0,0), 4 (20,0,25), 5 (45,0,70) | 6 (20,0,−10), 7 (−35,0,−15), 8 (5,0,10), 9 (30,0,−20) | 3 | 17 | 31 | 2535 |
| cave | 0 (0,0,0), 1 (5,0,40), 2 (25,0,90), 3 (−10,0,150), 4 (0,0,210) | 5 (0,0,25) | 2 | 10 | 20 | 2959 |
| valley | 0 (0,0,0), 1 (0,0,40), 2 (40,0,40), 3 (20,−20,120), 4 (80,−50,120), 5 (140,−60,120), 6 (160,−70,200) | 7 (150,−75,250), 8 (0,0,100) | 3 | 16 | 26 | 2457 |
| rainbow | 0 (0,0,0), sky-drawn, no road | – | 0 | 1 | 27 | 1132 (782 of them sky) |

Per-block addresses (descriptor, gfx, gfxData, textures, animations, road) are in `lv/dumps/{course}.json`.

**DObj trees** (`UnkEC64Arg3`, 0x2C: `{s32 id; Gfx* dl; Vec3f pos, rot, scale}`, terminated by id 18; **decomp**, used by roads, props and Pokémon, *Model format*):
- `id & 0xFFF` is the depth: a node at depth d is a child of the latest node at depth d − 1, and depth 0 is a root sibling.
- `id & 0xF000` adds extra matrix kinds.
- Materials attach to nodes in array order.

#### Units, axes, projection

- Right-handed, Y up. Vertex units are game units; block units × 100 are game units, used by collision and spawns (**decomp**; **verified** by the ground check in *Ground check* and by renders: the Beach start shows the terraced cliff left of the rails and a palm on the right, as in the game's opening straight).
- At view yaw 0 the camera looks along +Z.
- **Projection** (**verified**: RAM camera and the frame's projection matrix on every course): fovy **55** during play (the fixed-point matrix decodes to 54.88), aspect 4/3, near 10, far 25600, perspNorm 5. `createMainCameras` initialises fovy 60, which only Rainbow Cloud's intro camera keeps. The viewport is the full 320×240; the (14,12)-(304,232) border appears only during Rainbow Cloud's intro.
- **View** (**verified**): the look-at matrix decomposes to eye = RAM `CameraEyePos`, with right = −X when looking along +Z: right-handed, Y up, no mirroring. Prototype renders from the RAM camera line up with the screenshots (`rt/cmp/{course}.png`).

#### Model format

**DObj tree** (`UnkEC64Arg3`, 0x2C: `{s32 id; void* payload; Vec3f pos, rot, scale}`, terminated by id 18; **decomp**, **verified**: all 238 models decode):
- **Hierarchy:** `id & 0xFFF` is the depth; a node at depth d > 0 is a child of the latest node at depth d − 1. Node 0 is an empty root.
- **Billboards:** `id & 0xF000` selects camera-facing matrices (types 43-50: projection-only with node scale, optionally roll). They are used for flames, Snorlax's Zzz, the play Haunter sprite and smoke.
- **Node matrix:** RPY-TS, `hal_rotate_rpy_translate_scale`, r = rot.x, p = rot.y, h = rot.z:
  - row0 = (cp·ch, cp·sh, −sp)·sx;
  - row1 = (sr·sp·ch − cr·sh, sr·sp·sh + cr·ch, sr·cp)·sy;
  - row2 = (cr·sp·ch + sr·sh, cr·sp·sh − sr·ch, cr·cp)·sz;
  - row3 = pos.

  world(node) = local · world(parent), row vectors (**verified**: skinned joints meet).

**Payload by render type** (**decomp** `sys/render.c`; **verified**: every list decodes, 0 unknown opcodes):

| type | payload | per node |
|---|---|---|
| B | `Gfx*` | node matrix, material lists, draw |
| D | `{s32 dlistID; Gfx*}[]` until dlistID 4 | one list per RDP pass: 0 opaque, 1 translucent |
| I | `{Gfx* pre; Gfx* draw}` | `pre` under the **parent's** matrix, then the node matrix, materials, `draw` |
| J | `{s32 dlistID; Gfx* pre; Gfx* draw}[]` until 4 | as I, per pass |

- **Skinning:** `pre` loads vertices under the parent matrix. `draw` loads more under the node matrix, patches cached vertices with **G_MODIFYVTX (0x02)** (texture coordinates at 0x14, colour at 0x10) and draws triangles across both ranges (**verified**, e.g. Growlithe: 85 × `0214xxxx`). The vertex cache must survive the matrix change.
- **LOD:** every Pokémon list is `E1 near; 04 G_BRANCH_Z; far version`. The branch to the near version is taken when the list's bounding vertex is closer than its threshold (thresholds decode to 599-7936 units), and G_MODIFYVTX occurs only in near versions (**verified**, frame display lists). Use the near version.
- **Hidden parts:** AnimCmd 15 sets DObj flags: bit 1 skips the node's lists, bit 2 its subtree. Pikachu's lightning nodes 1/2/14, balloon node 15 and apple node 20 are hidden at spawn this way (728 → 343 triangles; **verified** in RAM and by animation/list decode). There is no surfboard node; Beach object 1006 supplies the surfing splash/wake assembly (*Object remnants*).
- **Materials:** the same `Texture` records and segment 0x0E sub-lists as the world (*Materials and the segment 0x0E lists*), with material animations (e.g. blinking eyes by image index) at frame 0.
- **Combiners:** `FC127FFF FFFFF238` (TEXEL0·SHADE), `FC327FFF FFFFF638` (PRIM·SHADE, untextured flat-colour parts with a list PRIM colour, e.g. Magmar's body), `FC1217FF FFFFFE38`. The combiner fold is required: without `combiner: true` the PRIM parts render white.
- **Render modes:** the wrappers set `DListRMFogOpaSet` for pass 0 and `DListRMFogXluSet` (0xC81049D8) for pass 1. Lists add TEX_EDGE cut-outs and a few others (`0C1849D8`, `00553078`). Back faces are culled.

**Lighting: Pokémon are lit; world geometry is not** (**verified**, lead re-checked the bytes):
- The level pre-render list at ROM 0x5A5C8 is:
  ```
  E7 | D9FFFFFF 00020000 set G_LIGHTING | DB020000 00000018 one light | DC08060A 800AEBD8 light 1 | DC08090A 800AEBD0 ambient | E3… | DF
  ```
- `Lights1` at ROM 0x5A580 (vram 0x800AEBD0): ambient 64 64 64 (100) at +0, light colour B4 B4 B4 (180) at +8, direction 1E 1E 1E at +0x10.
- Lists override the light colours with `G_MOVEWORD DB0A0000` / `DB0A0018` (e.g. Pikachu FFFFFF / 323232).
- **F3DEX2 lights are 0x18 bytes apart;** `displaylist.ts`'s MOVEWORD handler assumes 0x20.
- At run time the light direction follows the camera: the horizontal unit vector from the look-at point to the eye, with y = 1, normalised (**decomp**; **verified** in RAM: direction (0, 89, −89) at yaw 0, (−89, 89, 6) at yaw 1.64).

**Pose:** use **frame 0 of `animations[0]`** (what the game plays at spawn), falling back to the rest TRS when frame 0 hides everything. Frame 0 differs from the stored rest pose in 16 play models (**verified** renders). Tunnel props 1012/1013 are fully hidden at frame 0 and are shown as markers.

#### Formats

**Verified**: ROM bytes, and every table parses with the repo's unchanged modules.

- **Sequence file** (ROM 0xAEFC10): ALSeqFile `u16 revision 0x5331 ('S1'), u16 count = 37`, then 37 × `{u32 offset from the file start, u32 length}`. The 37 sequences are contiguous and 4-byte aligned from 0xAEFD3C to 0xAFEED6, followed by 2 bytes of padding (lead re-checked).
- **Sequences.** libultra compressed MIDI (ALCSeq), stored uncompressed: `u32 trackOffset[16]`, `u32 division` = **480 in all 37**. The body uses `FE` back-references, note-ons with varlen durations, `FF 51` tempo, `FF 2F` end, `FF 2E` loop start and `FF 2D count cur u32` loop end (count 0xFF = forever), as in GoldenEye and Perfect Dark.
  - Events used: note-on, CC 7, 10, 21, 64 (always 0), 91, program change, pitch bend.
  - Loops are **per track**: 26 songs have forever loops on every musical track, 9 have no loop markers, and songs 11 and 36 have only finite loops and play once.
- **Music bank** (ctl 0xAFEEE0, tbl 0xB04430): ALBankFile `B1`, one bank.
  - 128 instruments (all present) plus a 36-sound percussion instrument on channel 9, sample rate 32000.
  - 236 sounds, **all with sampleVolume 127**; 84 VADPCM waves, 51 of them looped.
  - Only instrument 78 has an oscillator: sine vibrato, ±10 cents at 6.9 Hz after 164 ms.
- **Effect bank** (ctl 0xBA6C20, tbl 0xBB6940): one instrument with 400 sounds (`auPlaySound(id)`) and 298 waves. It is not music.

#### Level assembly

- **Meshes:** one per block (model and scenery blocks), one per static-model prop, one sky mesh.
- **Instances:** blocks at translate(worldPos × 100); props at `(worldPos + pos)·100` with the RPY matrix (*Static models*); spawns per *Objects*.
- **Layers:**
  - "course" (main): model blocks;
  - "scenery" (background): scenery blocks;
  - "objects": props and Pokémon (*Objects*);
  - "height map", "ceiling map", "hitboxes": collision, hidden;
  - "spawns", "rail path": markers, hidden.
- **Environment:** `fog` per *Fog and clear colour*; `clearColor` = bg RGB; `skies` = the sky mesh (camera-relative); `camera` = the start eye/target of *Rail path* with fovY 55 (the game's play fovy, **verified**).
- **Rail path:** a polyline ribbon mesh or markers (`block N start`) from `lv/paths/{course}.json`.
- **Bounds:** from instances. Courses span up to about 20000 units.
- **Sky opacity:** the viewer's `Sky` draws blended with no culling. The game draws skies opaque (G_RM_AA_OPA_SURF). The single-layer domes look the same, but Rainbow Cloud's layered I4 sky needs opaque drawing: `Sky.opaque?: boolean`, or draw that course's sky as its only main-layer block without depth.

#### ROM, code, scenes

- The credits branches are mapped (scene 19/song 36 for progress bit 0x40; scene 18/song 11 for 0x40000 alone; scene 17/song 11 for 0x80000 with `PFID_14`), but the story meaning of those flags remains a hypothesis.
- The credits and the boot intro were not captured. The opening's five VPK0 model trees are inventoried, but only its visible landscape was compared with a frame.

#### Negative result: no retained cut course

- All seven course `*_assets`/`*_extra` pairs were scanned: 1,574 manifest-delimited
  assets and an independent 1,130 plausible terminated F3DEX2 geometry streams. Every
  geometry stream, vertex array and unique texture image has a pointer from the actual
  loaded source set (**verified** by `un/assets/audit_assets.py` → `audit.json`). No
  orphaned model or course-sized world was found.
- The large 1,972-triangle forest/landscape in `main_menu_vpk0` is unique, but it is the
  visible opening cinematic, not a hidden course: scene 8 constructs and animates its five
  DObj trees directly, then deletes them. It has no `WorldSetup`, block list, rail,
  movement setup, collision or height map (**verified** from decompressed bytes, decomp
  constructors and the captured `shots/menu_a.png`; `un/scene/analysis.json`).
- The five opening trees contain the landscape (226 nodes), two articulated models,
  three effect planes and one single-plane model. One articulated Type-I tree is a
  repacked Rainbow Cloud Mew model (**verified** by model-tree comparison). These are
  cinematic assets rather than evidence of an eighth playable course.

Known prerelease footage shows substantially different areas and Ekans, but this ROM's
complete course/reference scans and its 63 decoded Pokémon definitions contain neither an
Ekans definition (Pokédex id 23) nor an orphaned course world (**verified** for absence in
the retail ROM; the prerelease interpretation is external context, not evidence about
retail bytes).

#### Course-asset and effect remnants

- Two unreferenced 32-byte Jynx eye palettes at US ROM 0x260F60 and 0x261190 are exact
  duplicates of the live palette at 0x260D30. The European builds remove both plus 16
  alignment bytes, explaining their 80-byte Cave reduction. There is no unique artwork
  in them (**verified** by pointer and byte comparison).
- Tunnel and Volcano each contain six identical, unreferenced 256-byte render-state
  fragments. They have opaque/translucent RSP/RDP setup words but no `G_ENDDL`, vertex,
  triangle or texture command, so they are not hidden drawable models (**verified** by
  structure/reference scan). Exporter or linker residue is the likely explanation
  (**hypothesis**).
- Beach effect sprite sets 0 and 3 have no selection path: set 0 is two 64×64 I8
  speckled-disc frames and set 3 is three 32×32 RGBA16 leaf frames. No Beach script header
  names them, effect bytecode changes only the frame within the already selected set, and
  all explicit constructor paths derive the set from scripts/effect records. These are
  high-confidence genuinely unused graphics (**verified** by ROM/decomp static-reference
  scan; renders `un/assets/fx_beach_set0.png` and `fx_beach_set3.png`).
- The previously suspicious 111 words in Volcano's 0x80280xxx range are ordinary pixels
  in three frames of a live 16×32 RGBA32 flame/lava texture, not dangling pointers
  (**verified** by Texture-record decode and render;
  `un/png/volcano_rgba32_8012C2D0_frames.png`).

### 3.3 Geometry

### 3.4 Display lists and render state

#### Display lists

**Microcode: F3DEX2** (*Boot, main, microcode*). **Verified** by walking every course list, including sky and props, and following DE calls. The opcode histogram:
```
01:1691 03:58 05:362 06:7861 D7:67 D9:259 DE:88 DF:60 E2:92 E3:112 E6:753 E7:1427 E8:63 F0:320 F2:426 F3:433 F5:723 F9:13 FA:212 FC:101 FD:683
```
Absent: G_MTX, G_POPMTX, G_BRANCH_Z, G_QUAD, G_LOADTILE, G_MOVEWORD and lights.

**List structure** (HAL's exporter; **verified**):
```
prologue:      E7; D9 clear G_LIGHTING; 01 VTX 8 bounding-box vertices; D9 set lighting; 03 G_CULLDL 0..7; E7; D9 clear lighting
per material:  [E3 TEXTLUT] [FC combine] [FA prim] E8
               F5 SETTILE tile 5 (TLUT slot, tmem 0x800)
               F5 SETTILE tile 6 / tile 1 (TEXEL1, tmem 0x400)       ; frame blending only
               F5 SETTILE tile 7 / tile 0 (TEXEL0, tmem 0): fmt/siz, line = image width, masks = log2(size)
               FD SETTIMG palette; E6; F0 LOADTLUT tile 5; E7
               D7000002 FFFFFFFF   G_TEXTURE on
               F2 SETTILESIZE tile 1, F2 SETTILESIZE tile 0           ; the window, often 2-6× the image
               DE 0E0000xx  (material sub-list, *Materials and the segment 0x0E lists*)  or  FD SETTIMG image
               E6; F3 LOADBLOCK tile 7 (after the SETTILEs); E7
               01 VTX / 05 TRI1 / 06 TRI2 ...
```
- **The render-tile window usually exceeds the image.** Example: Volcano's lava is a 32×64 CI4 image with masks 5/6 and a 192×384 window. The RDP wraps inside the window with the masks, so the effective wrap is **repeat even though cms/cmt say clamp**. The image size is 1 << mask.
- **Texture formats** (**verified**, all course textures): CI4 with RGBA16 palettes 166 (mostly 64×64, 32×64, 32×32, 64×32, 32×128); CI8 4; I4 26 (all Rainbow Cloud; alpha = intensity); I8 4; RGBA16 16 (including the 64×32 skies). Palettes follow their images in the assets.
- **No lighting.** Vertex colours are prelit; G_LIGHTING is set only around the bounding-box cull vertices.

#### Render state set by game code

**Decomp**, with the fixed lists **verified** in ROM (lead re-checked the bytes). The frame starts from the `rdp_reset` list: G_ZBUFFER | G_SHADE | G_CULL_BACK | G_SHADING_SMOOTH, bilinear filtering, perspective correction, OPA_SURF. Each block is drawn as:
1. `gSPDisplayList(DListRMFogOpaSet)` (ROM 0x5A430 = vram 0x800AEA80):
   ```
   E7 pipesync | DB080000 16BAEABB  gSPFogPosition(968, 990) (patched per course) | F8 fog colour 3C6EB400 (patched)
   E3000A01 00100000 2-cycle | E200001C C8112078 G_RM_FOG_SHADE_A, G_RM_AA_ZB_OPA_SURF2 | D9 set G_FOG | DF
   ```
   `setFogDistance` (0x800A18AC) and `setFogColor` patch commands [1] and [2] of this list and of its translucent twin, `DListRMFogXluSet`.
2. `gSPMatrix(translate)`, the material sub-lists in segment 0x0E, `gSPDisplayList(gfxData)`, pop.
3. `DListRMFogOpaClear`: 1-cycle, AA_ZB_OPA_SURF, clear G_FOG.

Render modes inside the course lists (**verified**, every E2 word):

| mode word | meaning | viewer |
|---|---|---|
| C8112078 | FOG_SHADE_A, AA_ZB_OPA_SURF2 (the default) | opaque |
| C8113078 + `E2001E01 00000001` (G_AC_THRESHOLD) | AA_ZB_TEX_EDGE2: cut-outs (fences, palm leaves) | cutout |
| 00552078 + 1-cycle + clear G_FOG | AA_ZB_OPA_SURF unfogged: 2 materials in tunnel, 4 in cave (untextured G_CC_SHADE light cards near the cave entrance) | opaque, no fog |

- No course list uses a translucent or decal render mode. Translucent modes (`C8112878`, `C81049D9`) appear only on Pokémon and props (**verified**, frame display lists).
- Back faces are culled by default. Lists toggle culling with `D9FFFBFF 00000000` (off) and `D9FFFFFF 00000400` (on).
- **Combiners** (**verified** words): FC1217FF FFFFFE38 (TEXEL0·SHADE, the standard); FC272C04 1F0C93FF (lerp TEXEL0 → TEXEL1 by PRIM_LOD_FRAC, then ·SHADE: frame blending); FC121824 FF33FFFF (skies); FC127FFF FFFFF238; FCFFFFFF FFFE793C (G_CC_SHADE); FC1219FF FFFFFE38 and FC272C04 1F1093FF (Rainbow Cloud).
- **Skies** (`drawSkyBox1Cycle`): pipe sync, 1-cycle, G_RM_AA_OPA_SURF without Z, clear G_ZBUFFER | G_FOG, draw, restore. `drawSkyBox2Cycle` is the 2-cycle version with a rotation (**decomp**). Both are opaque (**verified**, frame display lists: `00552048` with G_ZBUFFER and G_FOG cleared for the dome skies; `0C192048` G_RM_PASS | AA_OPA_SURF2 for Rainbow Cloud's sky and cloud disc).

#### Display lists

**`runDisplayList` options:** `ucode: 'f3dex2'`, `vertexScale: 1`, `mirrorX: false`, `directImages: true`, geometry mode `G_ZBUFFER | G_SHADE | G_CULL_BACK | G_SHADING_SMOOTH | G_FOG`, render mode 0xC8112078, no lighting, `resolve` = the course's segment resolver plus a synthetic region for segment 0x0E.

The stored lists do not decode correctly with `displaylist.ts` as it is (**verified**, *Display lists*-*Materials and the segment 0x0E lists*). The five gaps:
1. **Segment 0x0E material lists** do not exist in ROM. The loader synthesises them from the Texture records (*Materials and the segment 0x0E lists*) at animation frame 0.
2. **Command order.** HAL's lists put SETTILE and SETTILESIZE before the LOADBLOCK of the image. `directImages` binds the image at SETTILE and takes its size from the first SETTILESIZE, so it binds the wrong or no image; TMEM mode decodes the window instead of the image.
3. **Tile masks.** The image size is `1 << mask`, and the texture repeats when the window exceeds the image, whatever cms/cmt say.
4. **Per-material fog off** (Tunnel, Cave) cannot be expressed: `Batch` has no fog flag.
5. **Frame blending** (TEXEL0 → TEXEL1 by PRIM_LOD_FRAC) needs `secondTexture`. At frame 0 the fraction is 0, so TEXEL0 alone is exact.

**Option A (no change to `displaylist.ts`), as in the prototype** (**verified**: 0 unbound draws, 0 unknown opcodes on all 7 courses):
1. Walk each list once, tracking tiles, texture-memory loads, TLUT loads and the synthesised material lists.
2. Write a flat list in libultra order into a synthetic region: `FD image, F3, F5 tile 0` (cms/cmt 0 when the window exceeds the image), `F2 tile 0` (size = image; uls/ult modulo the size).
3. Run `runDisplayList` on that.

**Option B:** a native `displaylist.ts` option (e.g. `tileMasks: true`: bind the image at draw time, size from the masks, repeat inside larger windows), plus a segment-0x0E hook. This is cleaner but touches a shared file (one owner at a time).

For gap 4: either a `Batch.fog?: boolean` field (contract change by the main session), or split unfogged materials into their own mesh with `Instance.noFog`.

**Pokémon and prop models** need more (**verified** by the `obj/` prototype, which works around each in `obj/proto/modelgfx.ts`):
6. **G_MODIFYVTX (0x02)** is not implemented. Skinned nodes patch cached vertices (texture coordinates at 0x14, colour at 0x10) after loading the next node's matrix, and the vertex cache must persist across that matrix change. The prototype reloads each patched vertex from a copy with the matrix it was loaded under.
7. **F3DEX2 light spacing.** `G_MOVEWORD` light colours are at offsets 0x00/0x18 (0x18 per light). `displaylist.ts` indexes lights at 0x20. Add a ucode-dependent spacing.
8. **`combiner: true`** is required so that PRIM·SHADE parts get the list's primitive colour.
9. **LOD:** Pokémon lists are `E1 near; 04 G_BRANCH_Z; far`, so `branchZ: 'near'` applies (it already exists for F3DEX2).
10. **Lighting:** lit presets with the level Lights1 (ambient 100, light 180, direction (30,30,30) rotated with the camera, *Model format*), via the `lighting` option. Bake it with a fixed direction, e.g. from the start camera.
11. **Matrices per node:** synthesise `G_MTX` loads of the absolute node matrix, the parent's before `pre` and the node's before `draw` (with `matrix` set, `runDisplayList` applies them). Billboard nodes need camera facing, which a static mesh cannot do; draw them unrotated.

### 3.5 Textures and materials

#### Materials and the segment 0x0E lists

Materials are 0x78-byte `Texture` records (copied into MObjs). **Verified** layout: Volcano block 0 material 0 decodes field for field like decomp `volcano/world/block0.c`.
```c
struct Texture {            // 0x78
 /*00*/ u16 pad; u8 fmt; u8 siz;               // SETTIMG format of images[imageIndex]
 /*04*/ u8** images;                           // animation frames
 /*08*/ u16 scale;                             // gSPTexture scale = 2^21 / scale / scaleS
 /*0A*/ u16 texelOffset;                       // added to the tile origin
 /*0C*/ u16 widthMain, heightMain;             // tile 0 window (texels)
 /*10*/ s32 halfS;                             // != 0: scaleS halved (mirrored S)
 /*14*/ f32 offS, offT;                        // UV scroll (animation params 14, 15)
 /*1C*/ f32 scaleS, scaleT;                    // (16, 17)
 /*24*/ f32 unk24, unk28;
 /*2C*/ u8** palettes;
 /*30*/ u16 flags; u8 blockFmt; u8 blockSiz;   // LOADBLOCK format
 /*34*/ u16 blockWidth, blockHeight;           // image size
 /*38*/ u16 widthAux, heightAux;               // tile 1 window
 /*3C*/ f32 auxOffS, auxOffT, unk44;
 /*48*/ u32 pad; u32 unk4C;
 /*50*/ u32 primRGBA; u8 lod255; u8 minLod; u8 pad2[2];
 /*58*/ u32 envRGBA, blendRGBA, light1, light2;
};
```
Every frame, `renLoadTextures` (0x80013E2C) builds one Gfx sub-list per material on the frame heap and binds it with `gSPSegment(0x0E, …)`. The block lists call entry i as `gSPDisplayList(0x0E000000 + 8·i)`. The lists are **decomp**; the DE 0E0000xx calls are **verified** in ROM. **The sub-lists do not exist in ROM, so a loader must synthesise them:**

| flags (0 = 0xA1) | emitted |
|---|---|
| 0x04 | SETTIMG palettes[paletteIndex]; with flags & 3: SETTILE tile 5 and LOADTLUT (16 or 256 entries) |
| 0x08 / 0x200 | SETPRIMCOLOR, LOD fraction = lodLevel·255 |
| 0x10 | frame blend: imageIndex = ⌊lod⌋, next = +1, PRIM_LOD_FRAC = frac(lod)·256 (the combiner lerps TEXEL0 → TEXEL1) |
| 0x400 / 0x800 | SETENVCOLOR / SETBLENDCOLOR |
| 0x02 or 0x10 | SETTIMG images[next]; with 0x01 or 0x10 also LOADBLOCK into tile 6 (TEXEL1) |
| 0x01 or 0x10 | SETTIMG images[imageIndex] (the list's own LOADBLOCK follows) |
| 0x20 | SETTILESIZE tile 0: uls = (offS·widthMain + texelOffset)/scaleS·4, ult = ((1 − scaleT − offT)·heightMain + texelOffset)/scaleT·4 |
| 0x40 | SETTILESIZE tile 1 from the aux fields |
| 0x80 | gSPTexture(2^21/scale/scaleS, 2^21/scale/scaleT) |
| 0x1000 / 0x2000 | light colour 1 / 2 |

With halfS set, scaleS ×= 0.5 and offS = (offS − unk24 + 1 − unk28/2)/2 (**decomp**).

**Material animation** (**decomp**; decode **verified**):
- `func_800E270C` sets each animated block's material scripts to `GlobalTimer mod 100` every frame, so the state is a pure function of the timer. Frame 0 = timer 0.
- Parameters: 13 imageIndex, 14 offS, 15 offT, 16 scaleS, 17 scaleT, 18 nextImageIndex, 19/20 aux offsets, 21 lodLevel, 22 paletteIndex; commands 18-21 set prim, env, blend and light colours.
- Examples: Volcano's lava blends 4 frames through lodLevel 0 → 3 → 0; water scrolls offS/offT.

#### Debug and untranslated material

- The exception thread starts during normal boot. Its crash display is gated behind an
  undocumented multi-step controller sequence before showing thread/PC/SR/VA, registers,
  FPU state and stack data. Its fatal-print path has 35 callers (**verified** by JAL scan,
  strings and decomp input logic). It is hidden diagnostic functionality, not dead code.
- A CPU/RSP/gfx/audio performance-meter camera, a 300-VI hang watchdog, and three custom
  crash-print callback functions have no call or pointer references (**verified** by
  whole-code call/pointer scan; their behavior is decomp evidence). Debug-named
  `blockModelCreate`/`blockUVCreate` and `animalAdd` validation stubs are live.
- The US ROM retains Japanese album prompts, album/report photo-detail labels (including
  sensor state and A/B/C grades), and scene 24's slideshow text (**verified** from EUC-JP
  bytes and decomp data references; `un/jp_strings.txt`). Presence and code use are
  verified; ordinary-screen reachability of the Japanese detail panels remains unknown.

### 3.6 Collision

Collision serves Pokémon, items and the ground under spawns: the cart follows its rail, not the ground. **No separate terrain-wall collision structure was identified.** A height map gives the ground, a ceiling map exists in Tunnel and Cave, and static-object box/cylinder hitboxes can stop thrown items and act as obstacles.

#### Height map and ceiling map

**Decomp** `world/ground_int.c`, `ground.c`; decode **verified** on all six courses. Rainbow Cloud has no height map (it never calls `setHeightMap`).
```c
struct HeightMap         { HeightMapPatch* patches; HeightMapTreeNode* tree; };
struct HeightMapTreeNode { f32 A, B, C; s32 leftChild, rightChild, leftPatch, rightPatch; }; // 0x1C; array indices in ROM, -1 = none
struct HeightMapPatch    { f32 a, b, c, d; u32 surface; };                                   // 0x14; surface = value >> 8 (24-bit RGB)
```
- **Lookup** (`findHeightMapPatch`) in global block units (x, z) = local/100 + worldPos.xz. At a node, `A·x + B·z + C ≤ 0` takes the right side (rightPatch if set, else rightChild), otherwise the left side.
- **Height** = −(a·x + b·z + d)/c in block units (0 if c = 0); × 100 is the absolute world Y. The normal is (a, c, b) normalised: the patch equation is Z-up.
- **Tree shape** (**verified**): every tree is a full binary tree with N nodes and N + 1 leaves, each leaf a distinct patch. The indices are relocated to pointers at load (`createHeightMapTree`).

| course | nodes | patches | patches ROM | tree ROM | ceiling map: nodes, patches ROM, tree ROM |
|---|---|---|---|---|---|
| beach | 6385 | 6386 | 0x566220 | 0x585508 | – |
| tunnel | 4007 | 4008 | 0x5ED4F0 | 0x600E10 | 657, 0x61C460, 0x61F7C8 |
| volcano | 4921 | 4922 | 0x734C00 | 0x74CC88 | – |
| river | 5166 | 5167 | 0x6CCA80 | 0x6E5E2C | – |
| cave | 4856 | 4857 | 0x64A610 | 0x662184 | 1909, 0x6834B0, 0x68C9E8 |
| valley | 4308 | 4309 | 0x7C6770 | 0x7DB814 | – |

The height maps live in the course code segments. The HeightMap struct pointers (*WorldSetup*) resolve through the code segment's vram; lead re-checked on Beach: 0x802CE1B0 → ROM 0x566220, 0x802ED498 → ROM 0x585508.

**Drawing the overlay** (implemented in `lv/proto/heightmap.ts`):
1. Start from the course geometry's XZ rectangle (block units, padded by 2).
2. Split it recursively by each node's line (Sutherland-Hodgman; the right side is `A·x + B·z + C ≤ 0`). The cells are convex.
3. At each leaf, clip the cell to where the patch height lies within the geometry's Y range ±5 block units (two more half-planes).
4. Lift the vertices onto the patch plane, fan-triangulate, and scale by 100.
5. Colour by surface type, shade by |normal.y|, draw translucent on both sides without depth write.

Known defect: the outermost cells of Tunnel and Cave cover large areas outside the playfield. Clipping them to the block footprints would fix it.

#### Surface types

The 24-bit surface value doubles as a debug RGB colour, which the overlay can use directly. Behaviour is from `app_level/items.c` and course code (**decomp**); the values are **verified** present in the ROM data.

| surface | courses | behaviour |
|---|---|---|
| 7F667F, 7F7F7F, 7F4C00, 4C1900, 4C4C33, 193333, FF7FB2 | beach, tunnel, cave, volcano, river | hard ground: bounce sound 25, speed ×0.3 |
| 7F6633 | all | rock/dirt; also the "forbidden ground" several Pokémon check |
| 4C7F00, 996666, FF9919 | beach, river | soft ground (grass): sound 24, ×0.2 |
| 331919 | river | sound 25, ×0.3 |
| B2997F | beach | sand: sound 27, ×0.2 |
| 0019FF, 007F66, 337FB2, 4CCCCC | beach, tunnel, cave, valley, volcano, river | water: splash, the item stops; 337FB2 can spawn Magikarp |
| 00FF00, FF4C19 | volcano | lava: splash; a pester ball on 00FF00 triggers the lava event |
| FF0000 | river | out of play: the item is deleted |

Build the height map and ceiling map cells as meshes in 'collision' layers (*What the viewer should draw*), with per-vertex colours from the surface RGB and alpha ~170, blended, no depth write, no culling. Hitboxes can be simple primitive meshes.

### 3.7 Environment, sky, fog, and lighting

#### Fog and clear colour

Fog is `gSPFogPosition(fogMin, fogMax)` with fog colour = WorldSetup fog RGB (*Render state set by game code*). With near 10 and far 25600, the viewer's `Fog` is `{color, multiplier: trunc(128000/(max−min)), offset: trunc((500−min)·256/(max−min)), near: 10, far: 25600}`:

| course | fog position | multiplier | offset |
|---|---|---|---|
| beach, tunnel, cave, valley, rainbow | 996-1000 | 32000 | −31744 |
| river | 993-1000 | 18285 | −18029 |
| volcano | 989-1000 | 11636 | −11380 |

The fog lies close to the far plane and mainly hides pop-in near 25600 units. The clear colour is WorldSetup bg RGB. **Only Cave fills the colour buffer** (fill colour 0x0040, RGBA5551 of (5,8,4)); the other courses clear only Z and rely on the sky or geometry to cover the screen (**verified**, frame display lists). The fog words and colours in the frame lists equal the table on all six fogged courses, and the fog is clearly visible on distant terrain in the screenshots, so the viewer must keep it (**verified**). Rainbow Cloud's world is drawn without fog.

#### Sky

- `createSkyBox` draws `SkyBox.gfx` in its own GObj. `setSkyBoxFollowPlayer` copies the camera eye into the sky position every frame, so the sky is **camera-attached**: `Level.skies`, no depth, no fog (**decomp**; **verified** in frame display lists: the sky's modelview is a translation to the eye).
- `GlobalTimer += animSpeed` per game update (60 per second), rounded to 1/1000 and taken mod 10000. The dome skies do not rotate: their modelview is a pure translation to the eye. `drawSkyBox2Cycle` (Rainbow Cloud) rotates `rotation.y = 2π·GlobalTimer/10000` (**verified** at four times in RAM and frame lists).
- Content (**verified**):
  - Beach, Volcano, River, Valley: a 28-triangle dome with one 64×32 RGBA16 cloud texture (Valley has two images), tinted by vertex colours.
  - Rainbow Cloud: 782 triangles, 25 animated I4 star and aurora materials, and a gradient.
  - Tunnel and Cave: no sky; the clear colour shows, and Tunnel has sky pieces inside its blocks.
- The game draws skies **opaque**. The viewer's `Sky` forces alpha blending, which is wrong for Rainbow Cloud's layered sky (*Level assembly*).

#### Level format and environment

- The Cave camera's extra +40 during the shaft drop (a shake or vibration term) was not identified.
- Rainbow Cloud's intro camera animation (`D_8011B3E0`, 290 frames) was not decoded.
- Frames per block at the default speed were not measured end to end (the per-update rate is verified).
- That the 54.88° projection (vs the camera's 55°) comes from the fixed-point `hal_perspective_fast_f` is a hypothesis.
- Animated materials (water, lava) are shown at frame 0; the game's state is GlobalTimer mod 100 (the emulation matches RAM at the captured times, **verified**).
- Per-material fog-off in Tunnel and Cave is not representable in `Batch`.
- The height-map boundary cells of Tunnel and Cave need clipping to the block footprints.

### 3.8 Cameras and paths

#### Rail path

**Decomp** semantics; decode **verified** on all courses (`lv/proto/anim.ts`, `lv/paths/{course}.json`).

- **Road.** `road` is a DObj tree with null display lists: node 0 is the root, followed by one (2 control lines) or two (3 control lines) control points. A control point's `position` is the cart position (block-local game units), `rotation.y` its heading, `scale.x` its speed.
- **movementAnim** holds one AnimCmd script per node:
  - The root script calls `setWorldBlocksVisibility(mask)` through command 17: a time schedule of block-visibility bitmasks over all blocks (e.g. Beach block 0: t 0 → 0x101, t 25 → 0x303, t 80 → 0x307).
  - Each control-point script does `SetPath(InterpData*)`, then keys the path parameter (0 → 1 across the block), heading and speed.
- **Evaluation.** `getMovementPos` sets the node animations to `100 × moveTime` and reads the control points:
  - with 2 control lines: cp 1;
  - with 3: `lerp(cp1, cp2, cpTime)`;
  - `reversed` uses 1 − t.
- **cpTime is a lateral lane.** It starts at 0.5 and changes by `sin(viewYaw)·0.005` per update while moving: looking sideways drifts the cart between the two control lines, about 200-300 units apart.
- **World position** = worldPos·100 + Ry(yaw)·pos.
- **Speed.** `moveSpeed = speedMult × lerp(speed, nextBlockSpeed, moveTime)` blocks per update, with `speedMult = 0.0005 × dashEngineMult × (1 + 0.25·cos(viewYaw))`. When moveTime passes 1 the cart enters the next block.
- **Update rate** (**verified**): levels run one game update per video interrupt (60 per second) and draw every second update. moveTime advances by moveSpeed once per update (Beach: +0.00045 = 0.0005 × 0.9 at the first update; speedMult 0.000625 afterwards, with the cos(viewYaw) factor at yaw 0).
- **Camera** (`player.c`; **verified** in RAM on every course):
  - `eye = cart + (0, 100 + shake + vibration, 0)`: River bobs ±15, Valley ±9, and Cave adds +40 during its shaft drop (the source of that offset was not identified);
  - `target = eye + Rz·Ry·Rx·(−20·cos(pitch)·sin(yawV), 20·sin(pitch), 20·cos(pitch)·cos(yawV))`;
  - `yawV = {−π, −π/2, 0, π/2, π}[index 2 at start] + viewYaw`; pitch limits −π/8..π/4;
  - fovy 55 during play (zoom narrows it).

**AnimCmd** (HAL's animation script; **decomp** `sys/anim.c`, **verified** by decoding every course script). A command word is `cmd << 25 | mask << 15 | duration`, followed by one f32 per set mask bit (two for cmds 5/6, a pointer for 1/13/14):

| cmd | name | effect per masked parameter |
|---|---|---|
| 0 | End | |
| 1 / 14 | Jump / SetAnimation | pointer; 14 resets the clock |
| 2 | Wait | advance the clock |
| 3 / 4 | SetValue(Last) | linear from the previous target over duration |
| 5 / 6 | SetValueWithRate(Last) | cubic Hermite to (value, end rate) |
| 7 | SetTargetRate | |
| 8 / 9 | SetValueZeroRate(Last) | Hermite, end rate 0 |
| 10 / 11 | SetValueAfter(Last) | step after duration |
| 12 | skip time | |
| 13 | SetPath(InterpData*) | parameter 4 follows the path |
| 15 / 16 / 17 | flags / sound callback / per-bit float callback | |
| 18-21 | texture colours (u32 RGBA per bit) | |

- The "Last" variants advance the script clock; the others start in parallel.
- Hermite, with k = 1/duration: `v = v0(2k³t³ − 3k²t² + 1) + v1(3k²t² − 2k³t³) + r0(k²t³ − 2kt² + t) + r1(k²t³ − kt²)`.
- Model parameters: 1-3 rotation, 4 path parameter (0..1), 5-7 position, 8-10 scale.

**InterpData** (0x18): `u8 type; s16 numPoints; f32 tension; Vec3f* points; f32 length; f32* knots; FittingParams* speed`.
- Types: 0 linear, 1 cubic Bézier, 2 uniform cubic B-spline over `points[s..s+3]`, 3 cardinal. **Course rails are type 2** (**verified**).
- The parameter is arc-length uniform: find segment s with `knots[s+1] ≥ p`, then bisect u until ∫₀ᵘ √(quartic in the speed fit) (Simpson, 8 intervals) ≈ (p − knots[s])·length.

**Start cameras and path lengths.** Decoded at block 0, moveTime 0, cpTime 0.5, view yaw 0. **Verified** in the emulator: movement starts at moveTime 0 on all six railed courses with the cart exactly at the decoded start, and the decoded path stays within 0.013 units of RAM at the later captures (0.12 on Valley's second). The game's eye at the first moving frame differs slightly by the camera terms (e.g. Beach (148.6, 219.9, −2593.5)):

| course | start eye | start target | rail length (game units) |
|---|---|---|---|
| beach | (148.6, 219.9, −2598.7) | (148.6, 219.9, −2578.7) | 26173 |
| tunnel | (0, 400, −1700) | (−1.7, 400, −1680.1) | 24225 |
| volcano | (75.0, 416.7, 691.7) | (92.3, 416.7, 701.7) | 21771 |
| river | (−774.8, 100, 329.3) | (−755.1, 100, 332.8) | 22048 |
| cave | (−700, 5732.6, −772.1) | (−700, 5727.5, −752.7) | 35259 |
| valley | (0, 1633.3, 0) | (0, 1624.3, 17.9) | 57138 |
| rainbow | (0, 100, 0): the cart never moves (**verified**); a 290-frame intro camera animation with fovy 60 plays first | (0, 100, 20) | – |

**Cave.** Block 0's control-point path descends vertically at x = −700, from y 7396 through 5633 (start) to 1954, above ground at −1142. The raw InterpData points really hold these values. **Verified** in the emulator: movement starts at moveTime 0 at (−700, 5632.6, −772.1), the cart falls down the shaft (y 1355.5 at moveTime 0.622) and leaves it in block 1. The first frame shows the shaft wall, looking down (pitch 0.26), and the prototype render from the RAM camera matches (`rt/cmp/cave_start_cmp.png`).

#### Ground check

Cart height minus the height-map ground along every rail sample (**verified**, `lv/dumps/ground_check.txt`): median 0.0 on Beach, 0.3 on Tunnel, 0.7 on Volcano, 0.0 on River and 2.8 on Valley, but **986 on Cave**, where the cart really falls through a shaft (*Rail path*). Five courses agree independently on the block placement, the animation and path decode, and the height-map conventions.

**Block visibility** (**verified** at all 21 course captures): the blocks whose model GObj is visible, and the block lists drawn in the frame, equal the `visibility` mask of the path schedule at the current block time (`worldBlocks[]` at 0x800F5A08).

#### Paths

- **In ROM:** 117 spawns have an `InterpData` path (*Rail path* format): Beach 25, Tunnel 14, Volcano 10, River 26, Cave 20, Valley 22. They are B-splines or linear, with 2-29 points.
- **Coordinates** (**verified**, `obj/proto/pathcheck.ts`): the points are **absolute block units**, and for all 117, `path(0) == worldPos + translation` (within 0.0001).
- **Viewer:** polyline = path(t)·100 in a hidden markers layer, and the instance stands at the spawn position with `animated: true`.
- **In the game,** each species' state machine advances `pathParam` by `speed/duration` per update when it chooses to, so a path is a route, not a guaranteed motion (**decomp**).

#### Level format, environment, rail, collision

| claim | evidence |
|---|---|
| WorldSetup layout and per-course values | `lv/proto/rom.ts`, `lv/dumpworld.py`; lead re-checked all 7 records in ROM |
| Blocks, render functions, placement ×100 | `lv/dumpblocks.py`, `lv/dumps/{course}.json`; path continuity across block joins (0.1 unit) in `lv/paths/*.json` |
| Display-list structure, opcode histogram, render modes, combiners | `lv/dlscan.py` over every course list |
| Fog list bytes | ROM 0x5A430 (lead re-checked: `E7 \| DB080000 16BAEABB \| F8 3C6EB400 \| E3 \| E2 C8112078 \| D9 set G_FOG \| DF`) |
| Material record layout | Volcano block 0 material 0 vs decomp `volcano/world/block0.c` |
| AnimCmd and InterpData decode | `lv/proto/anim.ts` over all course scripts; ground check `lv/proto/check_ground.ts` → `lv/dumps/ground_check.txt` (5 of 6 courses at median ≤ 3 units) |
| Height map layout and tree shape | `lv/proto/heightmap.ts`, `lv/dumps/{course}.json → heightMap`; lead re-checked the Beach HeightMap pointers |
| Offline renders | `lv/renders/{course}_{start,top,corner_*,heightmap_top,collision_*,textures}.png` (raster.ts); lead viewed the Beach start and Volcano overview |

#### Dead scene 24 and the Snap Station printer path

Scene 24 (`unk_end_level_8`, ROM 0xA084B0–0xA08E30) is a standalone Japanese version of
the four-best-Gallery-photo slideshow. It reconstructs each saved photo's course and
objects, supports A/B/Z and C-button auto-advance controls, then returns to scene 23. The
active Gallery contains a localized English implementation of the same behavior. Its only
selector setter, `func_801DD270` at 0x801DD270, has no J, JAL, raw pointer or source caller
in the US ROM; the selector initializes to zero. Scene 24 is therefore unreachable through
normal unmodified US control flow, although a scene-manager warp can start it (**verified**
by ROM-wide reference scan and decomp control flow;
`un/scene/SCENE_UNUSED.md`).

The adjacent `unk_segment_AA18E0` is unrelated. It is a hardware-specific 640×480 print
compositor: with the custom printer detected on controller port 4 and the extra 4 MiB RAM
test passing, boot loads it for 17 passes. It reconstructs the four Gallery photos, freezes
their objects, drives printer commands and overlays a 557×30 IA16
`©Nintendo/Creatures/GAME FREAK/HAL` notice (**verified** from overlay control flow and
decoded sprite; `un/scene/printer_rights_notice_preview.png`).

Scenes 7, 10 and 16 are empty scene-manager cases; scene 21's attract demo has recorded
input only for Beach and Tunnel (**verified** by the scene table and the two idle-script
ranges). They contain no additional world data.

## 4. Objects

### 4.1 Placement records

### 4.2 Object and model formats

#### Objects

Source notes: `notes/objects.md`. Prototype: `obj/proto/` (`npx tsx build_all.ts [course]`, then `npx tsx course_objects.ts [course]`). Tables: `obj/tables/` (`{course}_spawns.tsv`, `{course}_statics.tsv`, `id_models.tsv`, `hd_tables.json`). Renders: `obj/renders/models/_{course}_grid.png`, `obj/renders/courses/`.

#### How objects are created

- **Block spawn lists** (**decomp**; decode **verified** for all 231 records):
  - `createWorld` gets the course's add, delete and block-change callbacks.
  - When a block is created, `pokemonAdd` (0x80363A8C) walks `descriptor.spawn` (terminated by id 0xFFFFFFFF). For each record it takes the first `PokemonDef` with that id and calls its `init`.
  - Leaving the block calls `kill`. A block change calls `update`, which shifts positions by the worldPos delta (RAM coordinates are block-relative).
- **Code spawns** (**decomp**), from "single" PokemonDef records next to each table:
  - Rainbow Cloud: Mew at (0, 100, 500), hidden until its script shows it; object 1037 at Mew's position; 1038 at the origin (**verified** in RAM: both hidden at the start; later Mew is shown near (−21, 100, 546) with 1037 beside it, and 1038 moves).
  - Magikarp when an item lands on water surface 0x337FB2 (Beach, Volcano, Valley).
  - Growlithe/Arcanine, smoke puffs and evolutions from Volcano's spawners.

  Only Rainbow Cloud's have fixed positions.
- **Static models** (palm, tunnel computers; *Static models*) and the collision-only static objects (*Object hitboxes*).
- Items (apple, pester ball) and effect sprites have no records and are out of scope.

```c
struct ObjectSpawn {            // 0x30
 /*00*/ u32 id;                 // 1-151 National Dex number; 600-603 eggs/variants; 1001+ props and controllers
 /*04*/ s32 behavior;           // per-species variant 0..7
 /*08*/ Vec3f translation;      // block units, block-local
 /*14*/ Vec3f euler;            // radians; yaw only (166 records) or zero (65)
 /*20*/ Vec3f scale;            // not read by the spawn functions; (1,1,1) in 217 of 231
 /*2C*/ InterpData* path;       // or NULL
};
struct PokemonDef { u32 id; void* init; void* update; void* kill; };   // 0x10; all-zero record ends a table
```

**Placement rule** (`Pokemon_SpawnOnGround` 0x80362EE0 and `Pokemon_Spawn` 0x80362E5C, **decomp**). **Verified** by renders, which put every Pokémon on the terrain, and in RAM: at the Beach start, Doduo, Pikachu, three Pidgeys and Lapras stand at the decoded positions (one Pidgey within 3.3 units), with scales 0.2 and 0.3:
- `x, z = (worldPos + translation)·100`;
- `y = heightMap(worldPos.xz + translation.xz)·100` for on-ground spawners, else `(worldPos.y + translation.y)·100`;
- matrix = RPY-TS(position, euler, 0.1 × InitData.scale). The game applies it after the root node's own TRS.

Which spawn function each species uses is in `id_models.tsv`. Beach Meowth and Valley Magikarp intentionally use both, depending on behavior; the exact records and initializer branches are in *Object remnants*.

**Ids** (**verified** by renders):
- 1-151 are National Dex numbers. The decomp's enum is **wrong for 147**: `PokemonID_ARTICUNO = 147`, but 147 renders as Dratini and 144 as Articuno. The `lv/pokemon_ids.json` copy inherits the error.
- 600 is Moltres's egg (Volcano), 602 Zapdos's egg (Tunnel), and 601 is Articuno's egg (Cave; **verified** by its live spawn, decoded egg model, HD entry and adjacent Articuno). 603 is a River Shellder-family shell.
- 1001 is the "BACK TO THE LAB" gate (tree in `world` 0x800F1D10), 1002 the evolution controller, 1003 a 6-triangle app_level object. 1004-1038 are course props, controllers and effects (e.g. 1018 Cave's Mew-in-bubble shape, 1026-1031 Volcano spawners and smoke, 1037/1038 Rainbow Cloud's bubble rings and cloud). Their names beyond the decomp enum are unknown.

| course | spawns (with path, on ground) | spawn ids | def table vram (ROM) × entries | static models | instances / markers |
|---|---|---|---|---|---|
| beach | 37 (25, 9) | 12, 16, 25, 52, 84, 113, 115, 123, 131, 133, 143, 1001, 1004 | 0x802CBEE4 (0x563F54) ×16 | 3 (1007 palm) | 37 / 0 |
| tunnel | 47 (14, 29) | 14, 25, 41, 50, 51, 81, 93, 101, 125, 129, 145, 602, 1001, 1008-1010, 1012-1014 | 0x802EDFAC (0x5EB07C) ×21 | 6 (1015-1017) | 45 / 2 |
| volcano | 31 (10, 22) | 4, 5, 37, 78, 126, 146, 600, 1001, 1002, 1026, 1027, 1030, 1031 | 0x802E0D44 (0x731F44) ×20 | 0 | 30 / 1 |
| river | 40 (26, 20) | 1, 11, 25, 45, 54, 60, 79, 90, 137, 1001, 1019-1025 | 0x802E271C (0x6CA4FC) ×24 | 0 | 36 / 4 |
| cave | 33 (20, 12) | 1, 25, 39, 41, 70, 71, 88, 109, 124, 144, 601, 1001, 1018 | 0x802C6234 (0x6486E4) ×17 | 0 | 33 / 0 |
| valley | 43 (22, 31) | 7, 27, 28, 56, 74, 75, 120, 121, 129, 130, 147, 149, 1001, 1032-1035 | 0x802D282C (0x7ABDBC) ×20 | 0 | 43 / 0 |
| rainbow | 0 (code: 151, 1037, 1038) | – | 0x8034AB34 (0x82A2A4) ×5 | 0 | 3 / 3 |

Lead re-checked the Beach table in ROM: 16 records (ids 12, 84, 133, 115, 143, 131, 113, 52, 16, 123, 129, 25, 1003, 1004, 1005, 1001) and a zero record. The update functions are `pokemonChangeBlock` 0x80363DBC / `…OnGround` 0x80363EB4, and the kill function is `pokemonRemoveOne` 0x80364280.

#### Id → model

Almost every `init` is a 12-instruction stub that passes a `PokemonInitData*` as stack argument 6 to a spawn function. All 159 def records resolve to one each by constant propagation (**verified**, `obj/proto/defs.ts` → `defs.json`; 124 unique rows in `id_models.tsv`).
```c
struct PokemonInitData {        // 0x34
 /*00*/ DObjTreeNode* tree;  /*04*/ Texture*** textures;   // one NULL-terminated material list per tree node
 /*08*/ GObjFunc fnRender;   /*0C*/ PokemonAnimationSetup* animSetup;   // animSetup->animations[0] plays at spawn
 /*10*/ Vec3f scale;         // model scale = 0.1 × scale
 /*1C*/ Vec3f collisionCenter; /*28*/ f32 radius;
 /*2C*/ u16 flags;           // 0x10: node matrices use matrix1..3 instead of RPY-TS (Snorlax: 54)
 /*2E*/ u8 matrix1, matrix2, matrix3;
};
struct AnimationHeader { f32 speed; f32 length; AnimCmd** modelAnims /* per node */; AnimCmd*** matAnims /* per node, per material */; s32* soundIds; };
```
- **Where models live** (**verified** by resolving the tree pointers):
  - Course Pokémon trees and textures are in `{level}_code`, their animations in `{level}_assets`.
  - The shared Magikarp, Pikachu, Zubat and Bulbasaur trees are in the `*_model` segments, with textures and animations in `magikarp_textures`/`pikachu1`/`zubat1`/`bulbasaur1`.
  - Props are in `{level}_assets`; the gate, evolution controller and 1003 are in `world`.
- **Render functions** (by address):
  - `renderPokemonModelTypeI/J/B/DFogged` 0x8035942C / 0x80359484 / 0x803594DC / 0x80359534, which skip hidden Pokémon and feed the photo detector;
  - `renderModelTypeB/DFogged` for props;
  - two custom wrappers: Volcano `moltres_Render` (translucent) and `volcano_smoke_Render`.
- **HD photo models** (**verified**, ROM tables, lead re-checked the first entries). The photo scenes look up each photographed id in:
  - `D_800ADBEC` (ROM 0x5959C; 83 × `{u32 id; f32 scale; tree; textures; render}`);
  - `D_800ADA64` (ROM 0x59414; 13 × 0x1C, with animations).

  HD trees are in `{level}_extra` or `*_model_hd`, with about 1.5-2.5× the triangles (Pikachu 343 → 1422). Props reuse their play trees.

#### Static models

`descriptor.staticModels` entries are looked up by id in `WorldSetup.staticModelTable` (**verified**: 0xC-byte entries `{id, handler, payload}`, though the decomp says 0x28). The handler attaches the payload to the block (**decomp**):
- `func_800E30B0` attaches a Gfx child with RPY-TS at pos × 100;
- `func_800E3258` attaches a DObj tree.

Tables exist only in Beach (1007 palm → Gfx 0x80138C80) and Tunnel (1015 computer → 0x8013AB90, 1016 → 0x8013B080, 1017 → 0x8013BA20), all Gfx (**verified**).

#### Status of the prototype

- **Built** (**verified**): 231 models (124 play, 103 HD, 4 static props) with 0 unknown opcodes. All species read correctly in the model grids (textures, palettes, joints, flames), and course close-ups show Pokémon on the ground; the Beach start view shows the Pidgeys at the first bend.
- **Viewer gaps:**
  - G_MODIFYVTX;
  - F3DEX2 light offsets;
  - billboards (drawn without camera facing);
  - Snorlax's matrix 54, approximated by RPY-TS;
  - a fixed light direction (the game's follows the camera);
  - frame-0 animation only.

#### Object hitboxes

**Decomp** `world/collision.c`; decode **verified**.
```c
struct CollisionModel { s32 id; Collider* colliders; f32 scale; };   // 0xC; id -1 ends; scale > 0 overrides the object's scale
struct Collider { s32 depth; HitBox* hitBox; Vec3f pos, rot, scale; }; // 0x2C; depth 18 ends
struct HitBox { u8 type; Mtx4f localToGlobal, globalToLocal; f32 p84, p88, p8C; };
struct StaticObject { s32 id; Vec3f pos, rot, scale; };              // 0x28; id -1 ends; block-local block units
```
- **Hitbox types:** 1 sphere (radius p84); 2 and 3 cylinders (radius p84, height p88); 4 box (half extents p84, p88, p8C).
- **Matrices:** each collider's is `create_matrix(scale, rot, pos)` = S·Rx·Ry·Rz·T in row-vector form. The lowest-depth sphere is a broad-phase XZ circle.
- **Testing:** the objects tested are the `staticObjects` of the previous, current and next blocks whose id has a collision model. Their world position is (worldPos + pos)·100.

| course | collision models: id (colliders) | static objects |
|---|---|---|
| beach | 1001 gate (world 0x800EDF78: 3 boxes and a root sphere), 1004 (13), 1007 (6) | 5 |
| tunnel | 1001, 1008 (24), 1010 (26), 1015 computer, 1016, 1017 (one box each) | 9 |
| volcano | 1001 | 1 |
| river | 1001, 1022 (11), 1019 (16) | 3 |
| cave | 1001 | 1 |
| valley | 1001, 1032 (16) | 2 |

#### Detection and game object

- **`src/rom/index.ts`:** add `case 'NPFE'`, calling `openPokemonSnap(rom)`. The other dumps (`NPHE`, `NPFU`, `NPFP`, `NPFF`, `NPFD`, `NPFI`, `NPFS`, `NPFJ`) should throw "only Pokémon Snap (U) is supported", or be accepted later through `snapfs.ts`'s per-dump structure search (*Other dumps (detection level)*).
- **`src/rom/types.ts`:** extend `Game.id` with `'pokemonsnap'`. The title is `Pokémon Snap`.
- **Level list:** the seven courses of *Level list*. Use `LevelKind` `campaign` for Beach…Valley and `bonus` for Rainbow Cloud, or one group "Courses".
- **Confirmation:** after matching the game code, confirm with the overlay-table structure at ROM 0x57580 (30 strict Overlay structs, *Overlays*) and throw on a mismatch.

#### Objects

| claim | evidence |
|---|---|
| Spawn records, placement, counts | `obj/proto/spawns.ts` → `obj/tables/{course}_spawns.tsv` (all 231 records; counts agree with `lv/dumps`) |
| PokemonDef tables, init → InitData | ROM table scan + constant-propagating disassembly of each init (`obj/proto/defs.ts` → `defs.json`, `scan_defs.txt`); lead re-checked the Beach table (ROM 0x563F54) |
| Model tree format, payload types, G_MODIFYVTX, near/far LOD | every list of 231 models decodes (0 unknown opcodes, `build_all.txt`); Growlithe list words |
| Dex ids (147 = Dratini) | renders `obj/renders/models/_valley_grid.png`, `_cave_grid.png` |
| Lighting | ROM 0x5A580 (Lights1) and 0x5A5C8 (pre-render list), lead re-checked; list MOVEWORD words |
| HD tables | ROM 0x5959C, 0x59414 (`obj/tables/hd_tables.json`); lead re-checked the first entries |
| Paths absolute, start at spawns | `obj/proto/pathcheck.ts`, `pathstats.txt` (117 of 117) |
| Rendering | `obj/renders/models/_{course}_grid.png`, `obj/renders/courses/*` (lead viewed the Volcano grid and the Beach start view with objects) |

#### Objects

- Decorative names for several generic props in 1008-1034 remain deliberately unresolved; the six Pokémon Signs, controllers, spawners and major effects are identified in *Object remnants*.
- Billboard orientation and Snorlax's matrix type 54 are approximated.
- Whether the viewer's Pokémon light should follow the camera, as the game's does.
- Only Beach positions, Pikachu's node flags, the light direction and Rainbow Cloud's code objects were compared with RAM; a Butterfree's path over time and the visibility of Tunnel props 1012/1013 were not checked.

#### Object remnants

The complete course `PokemonDef`, `PokemonInitData`, spawn, model-tree and photo-HD tables
contain no extra cut Pokémon species mesh: every nonempty species model is block-placed or
created by reachable course code (**verified** by exhaustive ROM table cross-check;
`un/objects/OBJECT_ANIMATION_AUDIT.md`). In particular, no Ekans model appears.

Two definitions are genuinely unreachable through the audited retail construction paths,
but both are invisible one-node encounter controllers rather than hidden models:

| id | course | dormant behavior | evidence |
|---:|---|---|---|
| 1005 | Beach | randomly creates an ordinary Pidgey or Scyther | main def exists; no block spawn, HD entry or other constant creation site |
| 1036 | Valley | randomly creates an ordinary Staryu or Starmie | main def exists; no block spawn, HD entry or other constant creation site |

Their constituent species and behaviors are used elsewhere. The best interpretation is
abandoned/test encounter logic (**hypothesis**); their unreachability and empty models are
**verified** from ROM tables and decomp call sites.

The Pikachu accessory lead resolves to live content. Nodes 1, 2 and 14 are lightning;
node 15 carries two balloon textures and is enabled for the complete 64-frame balloon
animation; node 20 is the apple shown during the eating animation (**verified** by all 13
animation command streams and decoded node payloads; `un/objects/pikachu_flags.json`,
`un/objects/pikachu_nodes.json`). Cave behavior 7 selects the balloon animation, so balloon Pikachu
is not unused. Beach's surfing visual is separate object 1006, an eight-triangle
splash/wake assembly created by Beach code; there is no surfboard node in Pikachu's tree.

The special-id audit also identifies all six photographic Pokémon Signs and confirms the
following important cases (**verified** by live spawns, scoring paths and decoded models):
1004 Kingler rock; 1010 Pinsir shadow; 1018 Mewtwo constellation; 1022 Cubone tree/stump;
1028 Koffing smoke; 1035 Dugtrio mountain. ID 601 is the live four-node, 116-triangle
Articuno egg beside Articuno in Cave block 3. IDs 1020 and 1027 are deliberately invisible
but live placed controllers, unlike 1005/1036.

Finally, the apparent spawn-height ambiguity is resolved from initializer branches:
Beach Meowth behavior 1 alone uses the unsnapped `Pokemon_Spawn`; its behaviors 2-4 use
`Pokemon_SpawnOnGround`. Valley Magikarp behavior 3 alone is unsnapped and follows a
two-point linear path; behavior 2 is ground-spawned (**verified** from ROM spawn records
and decomp control flow).

### 4.3 Skeletons and animation

### 4.4 Behaviors, triggers, and scripted objects

## 5. Audio

### 5.1 Audio storage and banks

### 5.2 Sequence format and driver

Source notes: `notes/music.md`. Work dir: `mus/`; prototype `mus/proto/snapmusic.ts`; renders `mus/wav/`; capture `mus/cap/`.

#### System

Pokémon Snap uses **classic libultra 2.0I audio**: the alSynNew synthesizer, ALEnvMixer, the **ALCSPlayer compressed-MIDI sequence player** and ALSndPlayer for effects. It is not n_audio (**decomp**: the linked ultralib audio objects have no `n_*` files).
- The RSP audio ucode is **byte-identical to Super Mario 64 (U)'s aspMain** (standard ABI1): text 0xE20 bytes at ROM 0x3E580, data at 0x457A0 (**verified**, ROM bytes).
- HAL modified the player (`csplayer.c`, `seqplayer.c` and others, marked "Only in Pokemon Snap" in the decomp); the one change that matters for rendering is in *Rendering and reuse*.

**Configuration** `auPublicSettings`, main .data ROM 0x42FE4 (**verified**: ROM bytes, lead re-checked; the RAM copy at 0x80096930 matches):

| field | value | meaning |
|---|---|---|
| heap | 0x8004B250, 0x4B000 bytes | audio heap |
| outputRate | 32000 | `osAiSetFrequency` → AI_DACRATE 1520 → **32006 Hz** (**verified**, capture log) |
| maxPVoices / maxVVoices / maxUpdates / maxEvents | 22 / 24 / 64 / 64 | synthesizer |
| numSounds | 10 | effect slots |
| maxVoices[2] | 16, 16 | voices per BGM player |
| unk / channel priority | 50 / 100 | priority set on all 16 channels at every song start |
| effect bank ctl, tbl | 0xBA6C20, 0xBB6940 | **sound effects** (splat names this range `audio/bank2`) |
| music bank ctl, tbl | 0xAFEEE0, 0xB04430 | **music instruments** (splat `audio/bank1`) |
| sequence file | 0xAEFC10 | `sbk` |
| fxType | 6 = AL_FX_CUSTOM | reverb below |

The same ROM offsets are repeated in a 7-word table at ROM 0x42FF8 (**verified**; the Station dump shifts it by +0x8B0).

- **Players.** Two ALCSPlayers: player 0 "main" and player 1 "aux", 16 MIDI channels each, with oscillator callbacks installed, so instrument vibrato is heard (**decomp**).
- **Starting a song.** `auPlaySong(player, id)` flags the audio thread, which stops the player, DMA-reads the sequence into the player's buffer and plays it. There is no loop API: songs loop only by their own markers (**decomp**; RAM: the player buffers hold exactly the sequence bytes).
- **Course music.** `setBackgroundMusic(id)` stores the level song, and the per-frame `updateMusic` restarts it on player 0 whenever player 0 is idle (after a Poké Flute tune). It does nothing during the attract demo, which therefore has no music (**decomp**; **verified** in RAM: both song ids −1 during the demo).
- **Volume.** Every scene sets both players to 0x7F00 (**verified**, RAM ALCSPlayer +0x32).
- **Reverb.** `AL_FX_CUSTOM` with `auCustomFXParams1` (ROM 0x42B50, **verified** bytes): 8 sections on a 10400-sample (325 ms) delay line. A 14-section preset exists, but nothing selects it (*Unused and hidden content*). Songs send CC 91 between 2 and 64. Cave, Tunnel and Rainbow Cloud add an extra player FX mix (20, 20, 25; **decomp**).
- **"Sound quality".** The option is a stereo/mono switch: mono averages left and right (**decomp**). The default is stereo (**verified**, RAM 0x800423C0 = 1).

#### Rendering and reuse

**Snap's volume patch** (**decomp**; effect **verified**):
- Snap's `__vsVol` uses the player's `extraVol` in place of each sound's sampleVolume:
  - `t2 = (seqp.vol × seqp.extraVol × chanVol) >> 14`;
  - then `(chanExtraVol × t2) >> 7` if a channel extra volume is set;
  - `vol = (t1 × t2) >> 15`.
- **MIDI CC 21 sets `seqp.extraVol`** (default 120). Every song except 22 sends one CC 21 before its first note: 100 in most songs, 110 in songs 28, 31, 32, 33 and 35, and 120 in song 24 (**verified** by parsing; RAM ALCSPlayer +0x34 = 100 while songs 25/20 and 23 play).
- CC 8 (a per-channel extra volume) is sent only by game code, never by songs.

**Reuse verdict: `src/rom/music/libultra.ts` (`parseBank`, `renderSequence`) and `cseq.ts` (`parseCompressedSequence`) render every song unchanged** (**verified**: all 37 render):
- `parseBank(rom, 0xAFEEE0, 0xB04430, 0, null)`: the game's equal-power pan table (ROM 0x436B0) is identical to `libultra.ts`'s.
- Slice each sequence from the sbk and call `parseCompressedSequence`.
- `renderSequence(rom, bank, seq, {rate: 32006, maxVoices: 16, seqVol: 0x7F00, loop})`: classic squared volume and exponential ramps (the defaults), with the song's own per-track loops.
- **Adapter:** clone the bank with every sound's volume set to the song's first CC 21 value (default 120). Since every sound's sampleVolume is 127, this reproduces Snap's formula exactly. Without it, renders are about 4 dB too loud. A cleaner alternative is an `extraVolume` option in `renderSequence`.

Not modelled: reverb, the instrument-78 vibrato (6 songs), voice stealing (the renderer drops 1-13 notes in songs 11, 16, 18, 23, 31 and 36; peak 18 voices), and the decay-phase recompute.

**Checked against captured game audio** (**verified**, `mus/cap/cap1.raw`, `mus/compare.py`). One continuous headless capture ran from boot to the Beach course, with the song ids read from RAM:

| piece | song | envelope NCC | waveform corr. | level game/render |
|---|---|---|---|---|
| Opening | 25 | 0.888 | 0.844 | ×0.977 |
| Title | 23 | 0.912 | 0.811 | ×0.997 |
| Name entry | 12 | 0.948 | 0.928 | ×0.950 |
| Pokémon Lab | 8 | 0.942 | 0.912 | ×0.966 |
| Beach (effects muted, up to the loop seam) | 0 | 0.951 | 0.807 | ×1.055 |

- Tempo stretch is 1.000 ± 0.001, and chroma peaks at 0 semitones everywhere.
- The title's loop period is 13.697 s in the capture against 13.701 s in the render.
- Level: mean ×0.99 with the adapter, so **no gain** is needed.
- The Beach loop period was not reached in the capture.

`src/rom/pokemonsnap/music.ts`:
- `parseBank(rom, 0xAFEEE0, 0xB04430, 0, null)`;
- the sequence file at 0xAEFC10 (37 entries), each sequence through `parseCompressedSequence`;
- `renderSequence(rom, bankWithVolumes(extraVol), seq, {rate: 32006, maxVoices: 16, seqVol: 0x7F00, loop})`, where `extraVol` is the song's first CC 21 (default 120).

Track list: the 37 rows of *Song list*, `index` = song id, `name` = viewer name (with the id as a two-digit prefix, like GoldenEye). Loops follow the per-track loop markers. One-shot songs get no loop. **No changes to `src/rom/music/` are required.** An `extraVolume` option in `renderSequence` would replace the bank copy.

| claim | evidence |
|---|---|
| Library, aspMain = SM64's | ROM bytes (aspMain text/data compared with Super Mario 64 (U)) |
| Settings, reverb params, bank/sequence tables | ROM bytes at 0x42FE4, 0x42B50, 0x42FF8, 0xAEFC10 (lead re-checked settings, table, sbk and B1 headers); RAM copies in `mus/cap/ram*.bin` |
| All 37 sequences and both banks parse | `mus/survey.ts` → `mus/survey.json` with the repo's unchanged modules |
| CC 21 values, loops, instruments | `mus/ccdump.ts`, `mus/chk_cc7.ts`, `mus/proto/stats.ts` |
| Song ids at runtime | RDRAM dumps `mus/cap/ram1..9.bin` (`auBGMSongId` 0x800943D0) |
| Renders = game | `mus/cap/cap1.raw` + `cap1.log` (32006 Hz), `mus/compare.py` (table in *Rendering and reuse*); flute table ROM 0x5232D0 (lead re-checked) |

- Song names 15, 18, 19, 20, 21, 24 and 26 are context hypotheses. 26 (Course Select) was not heard at runtime.
- Song 28 (Mew) loops only a 1.5 s tail by the per-track analysis; not checked by ear.
- Song 22 has no CC 21 and inherits the previous song's extraVol.
- Which of songs 11 and 36 is the first ending.
- The 16-voice limit drops 1-13 notes in 6 songs; the game's priorities are not modelled.
- Reverb and vibrato are not modelled.
- SFX IDs 126 and 305 are unique, untriggered samples; their semantic identities have not been assigned by ear (*Audio remnants*).

#### Audio remnants

All 37 music sequences are selected somewhere, and 86 unselected music-bank instrument
slots contribute no exclusive sample: all 84 music wavetables are used by selected
programs or percussion (**verified** by sequence/instrument parse;
`un/bankwaves.py`). The second custom reverb preset is unreachable because the only
`auSetReverbType` call always selects type 6 (**verified** by call/constant scan; the
preset's structure is decomp evidence).

For the separate 400-entry SFX bank, 342 ids have an executable call or animation-event
trigger. Of the other 58, 56 are exact aliases of triggered records: 53 are the same
34 ms filler/live record as id 138, while ids 123, 362 and 364 alias other live ids. Only
two ids select unique untriggered VADPCM payloads (**verified** by source-call parsing,
ROM JAL-count comparison, recovery of opaque AnimationHeader sound tables and full bank
decode; `un/sfx/SFX_UNUSED.md`):

| SFX id | encoded sample ROM / bytes | decoded length | result |
|---:|---:|---:|---|
| 126 | 0xD09840 / 14,230 | 25,296 samples, 0.7905 s | unique, non-silent, no trigger |
| 305 | 0xE90300 / 10,800 | 19,200 samples, 0.6000 s | unique, non-silent, no trigger |

The decoded files are `un/sfx/wav/126.wav` and `305.wav`. Their semantic identities are
open; no name was assigned without an auditory/content match. Static absence cannot prove
that corruption or external debug tooling could never request an id, but it rules out the
ordinary retail calls and all declared animation sound-event tables.

### 5.3 Instruments and sample encoding

### 5.4 Music catalog and loop points

#### Song list

"used by" is from decomp call sites. **[rom]** = the literal id is also found as a `jal auPlaySong` argument in ROM code; **[ram]** = the id was seen in `auBGMSongId` (0x800943D0) at runtime. Loop = song time of the repeating part (s), from `cseq.ts`; "once" = no forever loop. Names describe where the game plays the song. Community track lists agree with the names of songs 0, 4-9, 11, 13, 14, 16, 23, 26, 27, 29 and 34 (leads only; Pixelated Audio, khinsider).

| id | ROM | used by | viewer name | loop (s) | length (s) |
|---|---|---|---|---|---|
| 0 | AEFD3C | Beach course [ram] | Beach | 10.02-70.01 | 70.2 |
| 1 | AF0A94 | Poké Flute, 1st tune (items table {1, 3, 2} at ROM 0x5232D0, **verified**) | Poké Flute: Tune 1 | once | 14.9 |
| 2 | AF0C30 | Poké Flute, 3rd tune | Poké Flute: Tune 3 | once | 14.5 |
| 3 | AF0DF4 | Poké Flute, 2nd tune | Poké Flute: Tune 2 | once | 12.6 |
| 4 | AF0FC4 | Tunnel course | Tunnel | 0.13-17.57 | 17.7 |
| 5 | AF15BC | River course | River | 0.10-53.43 | 53.9 |
| 6 | AF1F70 | Volcano course | Volcano | 0.10-60.09 | 60.1 |
| 7 | AF2B34 | Valley course | Valley | 4.02-51.99 | 52.0 |
| 8 | AF383C | Pokémon Lab [ram] | Professor Oak's Lab | 8.54-33.79 | 33.9 |
| 9 | AF3D74 | Camera check | Camera Check | 0.12-32.09 | 32.1 |
| 10 | AF444C | PKMN Album [rom] | PKMN Album | 20.14-40.14 | 40.2 |
| 11 | AF4918 | Credits scenes 17, 18, 20 [rom] | Staff Roll | once | 117.9 |
| 12 | AF5A8C | New game: name entry [rom] [ram] | Name Entry | 8.05-32.03 | 33.0 |
| 13 | AF5F4C | Cave course | Cave | 0.14-56.58 | 56.8 |
| 14 | AF6E84 | Rainbow Cloud course | Rainbow Cloud | 9.73-52.31 | 52.8 |
| 15 | AF7D3C | Cave, aux player, mid-course [rom] | Cave: Ambience (hypothesis) | 39.12-79.10 | 80.0 |
| 16 | AF7F88 | Photo evaluation (photo check, camera check) [rom] | Professor Oak's Check | 1.71-28.38 | 28.8 |
| 17 | AF8A10 | "You're out of film!" [rom] | Out of Film | once | 6.7 |
| 18 | AF8C88 | PKMN Report, photo-detail screen [rom] | PKMN Report: Photo (hypothesis) | 2.67-12.77 | 13.0 |
| 19 | AF9508 | Valley, an event script [rom] | Valley: Event (hypothesis) | 0.12-40.09 | 40.5 |
| 20 | AF9938 | aux: opening [ram], River and Valley events [rom] | Ambience: Opening, River, Valley (hypothesis) | 0.12-22.10 | 22.1 |
| 21 | AF9AC8 | aux: start of Tunnel and River [rom] | Ambience: Tunnel and River Start (hypothesis) | 0.12-28.10 | 28.1 |
| 22 | AF9BE4 | Cave, after song 13 fades | Cave: Silence | 0.05-2.05 | 2.1 |
| 23 | AF9C5C | Title screen and its menus [rom] [ram] | Title | 5.77-19.47 | 19.7 |
| 24 | AFA7F8 | Cave, aux: three channels follow a Pokémon's distance [rom] | Cave: Pokémon Trio (hypothesis) | 0.42-17.71 | 18.6 |
| 25 | AFA96C | Opening: HAL logo and intro [rom] [ram] | Opening | once | 70.4 |
| 26 | AFB44C | Pokémon Lab course select (window mode 1) | Course Select | 8.33-24.87 | 25.1 |
| 27 | AFB914 | Options [rom] | Options | 2.45-40.85 | 41.1 |
| 28 | AFBEF0 | Rainbow Cloud, aux: Mew encounter [rom] | Rainbow Cloud: Mew | 10.12-11.62 | 11.8 |
| 29 | AFC2D8 | PKMN Report [rom] | PKMN Report | 2.11-50.08 | 50.3 |
| 30 | AFCCE8 | PKMN Report, "PKMN Signs" [rom] | PKMN Report: PKMN Signs | 8.05-48.02 | 48.1 |
| 31 | AFD194 | aux: Oak's "Wonderful!" photo verdict [rom] | Jingle: Wonderful Photo | once | 0.7 |
| 32 | AFD298 | aux: Oak shows a new item [rom] | Jingle: New Item | once | 0.6 |
| 33 | AFD3A4 | aux: new course high score [rom] | Jingle: New High Score | once | 0.9 |
| 34 | AFD494 | Gallery [rom] | Gallery | 3.68-47.27 | 47.3 |
| 35 | AFDCD8 | aux: title menu select sting [rom] | Jingle: Menu Select | once | 1.5 |
| 36 | AFDDC4 | Credits scene 19 [rom] | Staff Roll (Alternate) | once | 124.9 |

- Every one of the 37 ids has a static selector/reference: the literal ids above, the flute table, the window-mode table {8, 26, 9}, or the level song variable. **No sequence is unreferenced; runtime reachability of every branch was not proven.**
- **Game-side mixing** the renders do not reproduce (**decomp**):
  - Tunnel starts song 4 with channels 6-12 muted and raises them with gameplay;
  - Cave fades song 13's channels by course progress and song 24's by a Pokémon's distance;
  - River drives song 5's channel 10;
  - the Mew encounter ducks song 14 under song 28;
  - courses layer the ambience songs 15/20/21/24 on player 1.

  The viewer should render each song alone, with every channel at full volume.

## 6. Unused and hidden content

### 6.1 Unreferenced assets

| claim | evidence |
|---|---|
| Scene 24 unreachable/obsolete; printer compositor; anti-piracy payload and save effect; opening trees | `un/scene/analyze_scene.py` → `analysis.json`; `SCENE_UNUSED.md`; decoded printer notice |
| Preset photo block layout, regional identity and Station-only consumer | `un/photos2.py` → `photos.json`; independent `un/photos_render/analyze_presets.py` → `summary.json`; Station/US disassembly; reconstructed Doduo PNG |
| No orphaned course geometry/images; Jynx palettes; render-state remnants; Beach FX sets; version identity | `un/assets/audit_assets.py` → `audit.json`; `REPORT.md`; decoded sprite sheets |
| Object-table negative, dormant controllers, Pikachu node flags, Signs and egg 601 | `un/objects/pikachu_audit.ts`, `pikachu_nodes.ts`; decoded renders; `OBJECT_ANIMATION_AUDIT.md` |
| 342/400 triggered SFX, 56 aliases, unique ids 126/305 | `un/sfx/analyze_refs.py`, `scan_animation_ids.py`, `bank_inventory.ts`, `summarize.py`; JSON inventories; decoded WAVs |
| Crash/debug/text/audio-bank remnants | `un/dbgcalls.py`, `strrefs.py`, `bankwaves.py`; `un/jp_strings.txt`; decomp call sites |

This pass treats a byte pattern as unused only after following the game's loaded-segment
set, direct and constructed code pointers, object/material tables and opaque animation
records. A static reference means “possibly used”, not “seen during ordinary play”; this
keeps the negative claims conservative. Detailed reports and machine-readable inventories
are under `un/scene/`, `un/assets/`, `un/sfx/` and `un/objects/`.

#### Anti-piracy code and save sabotage

The 0x50-byte output of the VPK0 stream at ROM 0xAAA610 is executable MIPS code, not
printer data. It checks the boot-time SP IMEM/DMEM integrity results at
0x801FFFF0/0x801FFFF4 and writes failure at 0x801FFFF8. App-level helper 0x80364360 would
decompress and execute it at 0x80200000 and set `PFID_ILLEGAL_COPY`, but that helper has no
J, JAL, pointer or source reference and is dead (**verified** by decompression,
disassembly and ROM-wide reference scan). Volcano performs the same check inline on its
live start path.

The flag's consequence is deliberately subtle. Before a confirmed Lab save recomputes the
MD4 and writes EEPROM, one of two callbacks conditionally passes the low byte of
`osGetTime()` through the Pokémon-to-report-slot map and marks the selected report photo
empty. Each gate passes one quarter of uniformly distributed values; only 63/256 low-byte
values map to photographable species, so the chance of targeting a valid slot on a
uniformly random save is 63/1024 (about 6.15%), before requiring that the slot actually
hold a photo. The deletion is persistently saved with a valid checksum, and the flag is
not cleared (**verified** from decomp save/control flow; exact functions and calculation
in `un/scene/SCENE_UNUSED.md`).

#### Preset photographs retained in the standard ROM

ROM 0xAE0510–0xAEFC10 is a complete preset save-photo block, not anonymous padding
(**verified** by `un/photos2.py` → `un/photos.json`):

- 4 × 0x3A0-byte Gallery `PhotoData` records;
- 60 × 0x3E0-byte Album records (0x3A0 photo + 0x40 comment);
- 28 Album photos from Beach, 26 from Tunnel and 6 from Volcano; all comments are empty;
- four Album records duplicate the four Gallery photos.

The stored level/block fields, 20-unit eye-to-target vectors, Pokémon ids and object ids
all fit the game's photo structures and those three courses. Snap Station's save
initializer copies the byte-identical block (shifted to its ROM layout) into the Gallery
and Album save regions; the normal US initializer does not. The block is also identical in
A/E/F/G/I/S and absent from J (**verified** by struct decode, whole-ROM references,
regional byte comparison and Station disassembly). The Station dialogue calls them four
“ready-made” pictures, making kiosk seed content the high-confidence purpose
(**hypothesis** from that text).

The first preset was also reconstructed statically using its exact Beach block, camera,
positions, rotations and HD photo models. Its centered Doduo is recognizable
(**verified**; `un/photos_render/gallery_00_primary.png`), independently confirming the
record interpretation. The prototype does not yet evaluate the stored animation variant
and fractional animation time, so the all-object image validates linkage and placement,
not pixel-perfect Station output (`un/photos_render/REPORT.md`).

#### Regional leftovers

- J `cave_assets` differs meaningfully in only 53 aligned words: pointer motion around an
  inserted scale `(1,1,1)`, a duration 30→29 adjustment, a duration 0→1 adjustment, two
  float-LSB changes and padding. All edits belong to Cave block 0's vertical-shaft rail
  camera; J retimes that opening camera (**verified** by pointer-normalised diff and
  AnimCmd decode; exact rows in `notes/unused.md` *How objects are created*).
- Every logical sprite set in all nine effect banks has identical dimensions, format,
  flags, pixels and palette in U/J/E and also A/F/G/I/S/Station. Earlier reported E/J
  sprite differences were false matches caused by a fixed-relative-offset probe landing
  on repeated content after overlay shifts (**verified** by descriptor-based parsing of
  all versions; `un/assets/audit.json`).
- The preset photo block is shared by every non-J retail dump but loaded only by Station
  (*Preset photographs retained in the standard ROM*), a concrete example of kiosk content retained in ordinary regional ROMs.

### 6.2 Cut or inaccessible levels

### 6.3 Debug features

### 6.4 Prototype or revision-specific content

## 7. nviewer implementation

### 7.1 Module mapping

#### What the viewer should draw

Hidden-by-default collision layers:
- "height map": surface-coloured BSP cells;
- "ceiling map": Tunnel and Cave;
- "hitboxes": boxes, cylinders and spheres of the static objects.

#### New modules (suggested)

| file | contents | port from |
|---|---|---|
| `src/rom/pokemonsnap/fs.ts` | overlay table, scene load lists, per-scene vram → ROM resolver (*Position dependence and address resolution*); VPK0 only if menu art is wanted | `fs/proto/snapfs.ts`, `fs/proto/vpk0.ts` (tested on all 9 dumps) |
| `src/rom/pokemonsnap/anim.ts` | AnimCmd interpreter (model and material parameters), InterpData B-spline with arc-length parameterisation | `lv/proto/anim.ts` |
| `src/rom/pokemonsnap/gfx.ts` | material records, synthesis of the segment 0x0E lists, list normalisation (*Display lists*) | `lv/proto/gfx.ts` |
| `src/rom/pokemonsnap/course.ts` | WorldSetup, blocks, sky, fog, clear colour, start camera, rail path layer | `lv/proto/course.ts` |
| `src/rom/pokemonsnap/collision.ts` | height map and ceiling map cells, hitboxes | `lv/proto/heightmap.ts`, `course.ts` |
| `src/rom/pokemonsnap/objects.ts` | spawns, Pokémon and prop models at rest (*Objects*) | `obj/proto/` |
| `src/rom/pokemonsnap/music.ts` | song table, adapter onto `music/libultra.ts` + `music/cseq.ts` (*Rendering and reuse*) | `mus/proto/snapmusic.ts` |
| `src/rom/pokemonsnap/pokemonsnap.ts` | `openPokemonSnap`: levels, `loadLevel`, music | – |

**Contamination warning:** the `lv/` prototype imports `buildLevel` and `fogPosition` from the repo's `src/rom/bomberman/common.ts`. The implementation should import `fogPosition` from wherever it ends up shared, or define its own.

#### Difficulty

| part | effort | notes |
|---|---|---|
| detection, overlay table, resolver | small | tested prototype |
| blocks, materials, list normalisation | medium | prototype ~600 lines; the display-list gaps of *Display lists* are the main work |
| fog, clear colour, sky, start camera | small | |
| rail path layer | small-medium | AnimCmd + B-spline port (`anim.ts`, ~300 lines) |
| collision overlays | small-medium | BSP cell clipping (`heightmap.ts`) |
| objects: spawns, def tables, placement | small-medium | table scan + init constant propagation (`obj/proto/defs.ts`, `spawns.ts`) |
| objects: Pokémon models at frame 0 | medium-high | DObj trees with four payload types, skinning with G_MODIFYVTX, near LOD, AnimCmd frame 0 with hidden-node flags, lit presets; `displaylist.ts` changes in *Display lists* items 6-11 |
| music | small | reuse; adapter ~90 lines |

### 7.2 Supported features

### 7.3 Approximations and omissions

## 8. Verification and remaining work

### 8.1 Verification evidence

#### Runtime (emulator)

All captures come from one headless debug-core emulator in `rt/run-rt` (notes `notes/runtime.md`; screenshots in `shots/`, described in `shots/index.md`): 7 courses × 3 moments, Rainbow Cloud's intro, 3 Lab frames and 3 menu frames, each with an RDRAM dump, the walked frame display list and a screenshot.

| claim | evidence |
|---|---|
| Warp to any scene | break at 0x8009B570 in the scene loop and write the id to `[sp+0x2C]` (`rt/cap.py warp`); courses 0-6 and the Lab load from boot with no save and no unlock |
| Load lists = *Scenes* | loader breakpoint log `rt/loads.txt` (116 calls: boot, 7 courses, Lab, menu); `createWorld` a0 = the *WorldSetup* WorldSetups |
| RAM = ROM for drawn assets | `rt/segcmp.py` → `rt/dl/{label}_segcmp.txt`; the only differences are relocated height-map trees, filled hitbox matrices and variables |
| Fog, clear, projection, viewport, render modes, combiners, sky modes, lights | 28 frame display lists captured at `osSpTaskStartGo` 0x80032E8C, walked by `rt/dlwalk2.py` → `rt/dl/*.txt` |
| Rail start, path agreement, update rate, visibility | `gMovementState` (0x80366BA4) in `rt/d/*.bin`; `rt/ts/ramcam.ts`; `rt/vischeck.py` |
| Renders = game | `rt/cmp/{course}.png` (screenshot, prototype from the RAM camera, difference). The lead viewed Beach: mean difference 17.4, from the HUD, animated material frames and the 1004 rock prop absent from the world-only render |
| Material sub-lists | `rt/ts/matcmp.ts`: `lv/proto/gfx.ts` output equals the runtime segment 0x0E lists at the captured GlobalTimer |
| Objects | `rt/objcheck.py` → `rt/obj/*.txt` (Beach positions, Pikachu node flags, light direction, Rainbow Cloud objects) |
| Lab 2D; opening landscape in the VPK0 buffer | `rt/dl/lab.txt`, `lab_b.txt`, `menu_a.txt`; `shots/lab_*.png`, `shots/menu_*.png` |

### 8.2 Known unknowns

### 8.3 References
