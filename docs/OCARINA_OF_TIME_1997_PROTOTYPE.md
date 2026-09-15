# The Legend of Zelda: Ocarina of Time (1997 prototype) — Nintendo 64 ROM format specification

This manual describes the shipped data formats needed to identify, extract, and
present The Legend of Zelda: Ocarina of Time — 1997 prototype content. Claims state their evidence inline; unsupported
interpretations are labelled hypotheses.

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | Absolute ROM ranges in the upper half of an F-Zero X development cartridge. |
| Compression | None identified for scene and room data. |
| Graphics microcode | F3DEX 1.x. |
| Geometry | 52 scenes and 145 rooms using an earlier Zelda scene format. |
| Textures | RDP textures and raw RGBA16 prerendered backgrounds. |
| Collision | Early scene collision with 12-byte water boxes. |
| Music driver | No prototype audio data is present. |
| Audio microcode | Not present in the recovered prototype data. |
| Sample encoding | Not present in the recovered prototype data. |
| Levels | 52 prototype scenes. |
| Memory requirement | Not executable as a standalone game image. |
| Viewer support | Detected by the complete development-cartridge SHA-1. |

### 1.2 ROM identification

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| F-Zero X development cartridge | `F-ZERO X` | `CFZE` | 0 | 32 MiB (`0x2000000`) | `B30ED978` | `3003C9F9` | `6aa870ec53602650638b50d7c89cac026be481f0` | CIC-6106 | — |

Verified from the normalized ROM headers and complete-image SHA-1 hashes.

### 1.3 Terminology and conventions

ROM and memory ranges are half-open. Offsets, addresses, encoded sizes, masks,
and opcodes are hexadecimal unless stated otherwise. Multi-byte CPU fields are
big-endian. RAM addresses are virtual unless explicitly identified as physical;
segmented, VROM, and file-relative addresses are named at each use.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

#### Identification

| item | value | evidence |
|---|---|---|
| file | `_folders/F-ZERO X [CFZE].z64`, 33,554,432 bytes | verified (ls) |
| SHA-1 | `6aa870ec53602650638b50d7c89cac026be481f0` | verified over the complete image |
| header | title `F-ZERO X`, game code `CFZE`, version byte 0, CRC `B30ED978 3003C9F9` | verified (xxd 0x0-0x40) |
| lower half 0x0-0xFFFFFF | F-Zero X (US game code). No retail F-Zero X ROM is available to compare the half against. | verified header; build not identified |
| upper half 0x1000000-0x1FFFFFF | second half of a 32 MiB OoT prototype ROM, late 1997 (Spaceworld 97 era) | doc (sw97 project README; VGC and TechRaptor articles, 2021) |
| Zelda data | 0x1000000-0x19A446F; 0xFF padding from 0x19A4470 to 0x1FFFFFF | verified (0x1000-byte block scan: every block from 0x19A5000 is all 0xFF; the last scene's last room ends at 0x19A4470) |
| build string / dmadata / code | none. `zelda@` and `Yaz0` occur nowhere in the file. No scene or file table: every scene start address occurs as a u32 only as the *end* of the previous scene's last room-list entry (plus 2 chance hits in the lower half), and the first scene start 0x10FA150 occurs nowhere. No MIPS code in the upper half (0x1000000 disassembles to nonsense; its bytes are small values < 0x70, i.e. texel indices). | verified (grep -abo over the whole file; u32 search script, output in this session; objdump) |
| compression | none: every scene/room file is stored raw | verified (headers and display lists parse in place at their ROM offsets) |

**How a loader recognises it.** Identify by the complete-image SHA-1. Structural sanity check (cheap): the header reads `F-ZERO X`/`CFZE`, and at 0x10FA150 there is a scene header `15 04 00 00 00 00 00 18 | 04 0A 00 00 02 00 01 08 | ...` whose room list (segment 2 offset 0x108) holds 10 ascending absolute ROM ranges, the first being 0x1108550-0x11118B0. Verified (ROM bytes).

### 2.2 Memory and address mapping

Address conversions and load destinations are specified with the executable and file tables above.

### 2.3 ROM map and asset organization

#### ROM map of the upper half

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

#### How files are delimited

- **Scenes:** found by structure (`v2/alpha.py: find_scenes`). For every 4-aligned `04 nn 00 00 02 xx xx xx` room-list command, try header starts up to 24 commands back. Accept one when the room table (segment-2 offset relative to that start) lists `nn` ascending, non-overlapping absolute ROM ranges inside 0x1000000-0x19A4470, the first starting after the header, and when the command list is valid up to its `14 00 00 00 00 00 00 00` END. This finds exactly 52 scenes; together with their rooms they tile 0x10FA150-0x19A4470 without gaps. Verified.
- **Scene file end** = start of its first room. **Room files** = the room-list ranges, which are absolute ROM offsets: VROM == ROM, uncompressed. Verified (the rooms parse at those offsets).
- **Segments:** scene = segment 2, room = segment 3, as in retail. Verified (all pointers in headers and DLs resolve inside the file).
- **For the viewer:** since the ROM is identified by hash, a static table of the 52 scene start offsets (*Level list*) is safe; running the structural scan as a check costs under 1 s in Python.

### 2.4 Compression formats

Compression framing and decoding rules are specified with each stored resource above.

### 2.5 Loading process

Level and asset selection is described by the tables and loader call paths above.

### 2.6 Revision differences

Revision-specific addresses and data differences are stated in the relevant tables.

## 3. Level data

### 3.1 Level catalog and identifiers

#### Level list

The scene table lived in `code` and is lost. The numbering is ROM order, which is also the numbering of the sw97 project's `z_scene_table.c` (**doc (sw97 project)**).
- **Col=**: share of the alpha scene's collision vertices found at identical coordinates in the retail counterpart (`v2/layoutcmp.txt`; retail = US 1.0, test maps = debug ROM).
- **Tex=**: share of the alpha room textures found byte-identical in any debug-ROM file (`v2/texcmp.txt`).
- **Mesh**: room mesh types. 1 = prerendered background (raw RGBA16, see *Formats compared with retail OoT*).

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

### 3.2 Level container

#### Formats compared with retail OoT

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
- No audio data: no Audioseq/Audiobank/Audiotable, which retail stores at the start of the ROM, in the overwritten half. Verified by the *ROM map of the upper half* map; doc: VGC 2021 ("no music files").
- Only the per-scene command 15 (seq id + nature ambience id) survives; seq ids follow retail numbering where checkable (above).
- The viewer should offer no music for this ROM.

### 3.3 Geometry

Geometry representation is described with the level container above.

### 3.4 Display lists and render state

#### Rendering

- **Pipeline:** `v2/render/render.py` builds jobs (scene file = segment 2, room file = segment 3, all mesh DLs of the main header, lighting from env setting 0). `export.ts` runs them through the viewer's `runDisplayList` (`ucode 'f3dex'`, `vertexScale 1`, `mirrorX false`, `combiner`, `decals`, `textureGen`). `raster.c` is a z-buffered, perspective-correct, near-clipped rasterizer with bilinear textures and back-face culling (CCW front). Views: top-down orthographic, three-quarter overview, and player entry 0 (eye 260 units behind and 110 above).
- **Two module variants:**
  - `--repo`: `the repository/src/rom/displaylist.ts` as it is now;
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
| `alpha/renders/aXX_{name}_{top,overview,start}.png` | per scene; `_repo` suffix = unmodified repo module |
| `alpha/renders/aXX_{name}_bgN_roomN.png` | decoded RGBA16 prerender backgrounds (0x07, 0x08, 0x2A, 0x2B, 0x30, 0x33) |
| `alpha/renders/r_{retail}_*.png` | retail renders |

### 3.5 Textures and materials

Texture storage and material binding are described with geometry above.

### 3.6 Collision

Collision storage and interpretation are described with the corresponding level records above.

### 3.7 Environment, sky, fog, and lighting

Environment records and runtime render state are described with the level data above.

### 3.8 Cameras and paths

Camera defaults and path data are described with the level data where known.

## 4. Objects

### 4.1 Placement records

Placement records are structurally coupled to the level format and are described in Level data.

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

Sequence bytecode and playback behavior are described below.

### 5.3 Instruments and sample encoding

Instrument banks, envelopes, loops, and sample encoding are described above.

### 5.4 Music catalog and loop points

The complete known song catalog and loop policy are included above.

## 6. Unused and hidden content

### 6.1 Unreferenced assets

#### Content differing from retail (per level, concise)

The metrics are Col= and Tex= from *Level list*; "layout" judgements are from the pair renders.
- **0x09 Hyrule Field (SW97):** outline similar to retail (36% collision shared). Actors in the day header: drawbridge (0x4B), two torches (En_Light 0x08), Field_Keep trees (0x22), three cuccos (En_Niw 0x19), a horse (0x3D), Ganondorf's horse (0x43) and Zelda's horse (0x5C) near the castle bridge. The night header (alternate 1) has blue ambient light (10,10,60), a different spawn and five 0x2B actors. Retail spot00 has no cuccos or horses there (doc: TechRaptor/VGC summaries).
- **0x2D Hyrule Field (older):** a different map (0% shared), no actors or objects.
- **0x0D Kokiri Forest:** half of the collision is shared, but the forest is smaller (one room vs three) and the Deku Tree meadow is joined to the village. 15 objects in alpha-only numbering ranges (0x4B-0x55: object_oe3-oe12, Kokiri NPC objects unused in retail).
- **0x0A, 0x0B, 0x0C, 0x0E, 0x0F, 0x10, 0x2D:** completely different layouts (0% collision, 0-21% textures). The Lost Woods (0x0C) is one open area with 136 actors instead of retail's 10-room maze.
- **0x12 Gerudo Valley, 0x13 Hyrule Castle, 0x14 Death Mountain Trail, 0x15 Crater:** recognisable shape, rebuilt geometry (castle 11%, trail 70%, crater 0% shared), partly retail textures.
- **Dungeons 0x01, 0x1A, 0x1B, 0x20, 0x2F, 0x32:** all older layouts with fewer rooms (10/14/18/14/18/11 vs retail 17/27/23/12/23/11). Only 0-12% of collision vertices are shared; 13-29% of textures are identical to retail (mostly the dungeon object texture files, e.g. `object_hidan_objects`, `object_mori_tex`, `object_blkobj`). Dodongo's Cavern keeps the retail topology (stair hall, lava hexagon room); Deku Tree, Fire, Forest and Water Temple are laid out differently (pair renders).
- **Absent from retail:** 0x00 fstdan (10-room dungeon), 0x05, 0x06, 0x26, 0x29 (unfinished rooms), 0x08 item shop, 0x11 pond, 0x16, 0x17, 0x1C archery range, 0x21 jabu_test, 0x2C, 0x2E.
- **Prerender interiors (0x08, 0x2A, 0x2B, 0x30, 0x33):** their backgrounds are present as raw RGBA16 images (no JPEG); the retail counterparts' backgrounds differ.
- **Test maps 0x02, 0x03, 0x07, 0x1D, 0x28:** geometry identical to the debug ROM. 0x04 and 0x1F are older revisions (99% / 72%). The actor placements all differ (0 position matches).
- **Formats absent in retail:** F3DEX lists, no CI textures, 12-byte waterboxes, raw prerender images, command 09 in rooms (*Formats compared with retail OoT*).
- **UI data:** the item/place-name textures include items that are not in retail (Wind Medal, Soul Medal, Dark Etude). Their order is roughly the retail item list's. Verified by visual inspection only.

### 6.2 Cut or inaccessible levels

Candidate levels are distinguished from alternate, debug, and intentionally hidden retail content above.

### 6.3 Debug features

Shipped debug strings and executable features are listed only when supported by a code or data reference.

### 6.4 Prototype or revision-specific content

Source-archive and prototype material is explicitly distinguished from shipped retail data.

## 7. nviewer implementation

### 7.1 Module mapping

#### Viewer mapping

- **Module:** a variant of the retail OoT loader, e.g. `src/rom/zelda/alpha.ts`. Game id `'oot-alpha'` (extend the `Game['id']` union in `types.ts`), title "Ocarina of Time (1997 prototype, F-Zero X cartridge)". Detection uses the complete-image SHA-1 before the F-Zero X/other checks.
- **Shared with retail:**
  - scene/room header parser (commands identical; must not require 0x19, 0x15, 0x10, 0x16);
  - room mesh types 0/2;
  - collision header, polygon and surface parsing;
  - env light settings;
  - actor/transition/object list parsing;
  - segment resolution 2/3, with dynamic segments 7-0xD unresolved.
- **Alpha variant needed:**
  1. **level list:** no dmadata or scene table; use a static table of the 52 scene starts (*Level list*) or the structural scan. Room lists are absolute ROM offsets, files raw;
  2. **DL microcode** `'f3dex'`, already supported by `displaylist.ts`;
  3. **textures:** use a direct-image path; the current 4 KB tile-memory emulation mis-decodes 5 of 1,554. No CI/TLUT handling needed;
  4. **waterbox** struct 12 bytes;
  5. **prerender backgrounds** type 1: raw RGBA16 320x240 → `Level.backdrop` texture, no JPEG decoder;
  6. **actor names:** a small table from the *Formats compared with retail OoT* rule (alpha→retail id), labelled as derived; markers only, since no object models exist;
  7. **no music.**
- **`types.ts` needs:** nothing beyond the retail Zelda additions (backdrop and markers already exist); the new Game id only.
- **Level extras:** View-panel setup choice for 0x09's alternate header; `clearColor` from fog colour; `camera` from player entry 0; for type-1 rooms show the backdrop plus the (mostly invisible) mesh.
- **Difficulty:** low once the retail OoT loader exists (about half a day). The only new code is the static level table, the waterbox size switch and the RGBA16 backdrop; the DL interpreter works as is apart from the texture-path fix it shares with retail.

### 7.2 Supported features

The Technical summary states the supported releases and principal decoded features.

### 7.3 Approximations and omissions

Viewer approximations are distinguished from facts about the game formats.

## 8. Verification and remaining work

### 8.1 Verification evidence

#### Emulator

No emulator request (`alpha/EMU-REQUESTS.md` not written). The upper half has no boot code or engine. The only runnable form is the sw97 project, which is not cheap:
- building it needs the MQ debug ROM, IDO recompilers and ZAPD;
- the prebuilt patch sits on mega.nz, which is not scriptable here;
- it runs a retail-based engine with recreated actors and prerenders, so its screenshots would not show original rendering.

#### Verification evidence

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

#### Open questions

1. Exact build/date: nothing in the ROM. sw97 and press say Spaceworld 1997 (Nov 1997); only the Hyrule Field alt/day setup ties it to the demo.
2. Identity of 0x16, 0x17, 0x2C, 0x2E, 0x11 and the "unfinished" scenes; names for 0x05/0x06 are sw97 guesses.
3. Waterbox properties bit layout (hypothesis in *Formats compared with retail OoT*).
4. Draw configs (animated material segments 7-0xA) are lost; which textures scroll is unknown (sw97 guesses are not evidence).
5. Which light setting the alpha used by default (several outdoor settings 0 have zero directions).
6. The content of 0x1000000-0x1014000 and 0x10ED200-0x10FA150 is not identified; it does not matter for levels.
7. Why the repo module's tile-memory emulation mis-decodes 5 32x32 textures (a stale texture-memory cache is suspected, not traced); relevant to retail OoT too.
8. No comparison with Spaceworld 97 footage yet (TCRF not reachable from here; screenshots not fetched).

### 8.2 Known unknowns

Unresolved semantics are labelled **Hypothesis** or **Open question** where they occur.

### 8.3 References

External documentation, decompositions, and source archives are cited inline where used.
