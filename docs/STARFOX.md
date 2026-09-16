# Star Fox 64 — Nintendo 64 ROM format specification

This manual describes the shipped data formats needed to identify, extract, and
present Star Fox 64 content. Claims state their evidence inline; unsupported
interpretations are labelled hypotheses.

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | DMA table of 64 sixteen-byte entries at ROM 0xDE480 (V1.1) / 0xD9A90 (V1.0), found by pattern; 51 files MIO0, 13 raw |
| Compression | MIO0 (header, control bits, back-reference and literal streams); trivial, and the viewer needs a new ~40-line decoder |
| Graphics microcode | F3DEX 1.x. |
| Geometry | 0x14-byte placement records; 400-entry object-info table (ids 0-399; id → display list / draw recipe); 108-entry event-actor model table; 0x44-byte environment record (fog, light, ambient, BGM); F3DEX 1.x display lists with **no render state** (the game prepends one of 88 presets); camera-attached ground planes; procedural Titania terrain; skeleton models |
| Textures | RGBA16, CI4/CI8 with RGBA16 TLUTs, IA8/IA16, and I textures. |
| Collision | Object hitboxes and level-specific collision routines; no single general-purpose level collision mesh. |
| Music driver | Nintendo EAD sequence engine; three-level bytecode, 44 music sequences, 32 kHz output, and 180 updates per second. |
| Audio microcode | NEAD SF RSP task. |
| Sample encoding | Nintendo VADPCM. |
| Levels | 21 level ids (19 real levels, an unused playable stub (4) and an empty slot (15)) plus all-range, warp and escape sub-lists, plus 3 Versus stages. A *scene* table maps each level to an overlay and up to 15 RSP segment files. Asset files are position-independent per segment |
| Memory requirement | Base 4 MiB. |
| Viewer support | Filesystem: easy. Scenery, placement and presets: easy-medium, since `displaylist.ts` already handles every command used. Space levels (event actors), skeletons, Titania terrain, lighting and backdrops: medium. Music: medium-high (a new ~1300-line engine port; VADPCM and resampler reusable) |
| Coordinates | 1 vertex unit = 1 world unit, right-handed Y-up, no mirroring; on-rails world z = −zPos1 − 3000 + zPos2 |
| Sky, fog, light | environment record + backdrop display lists + starfield (*Skies, backdrops, starfields*, *Fog, lights, clear colour, camera*) |
| Versions | viewer data is identical except the Venom 1 placement list (23 entries) and three event-script edits; code has 4 engine fixes + 3 overlay tweaks + a debug libultra. **V1.1 primary; one loader for both**, with per-version table addresses (*Addresses that differ per version*) |
| Unused and hidden (*Unused and hidden content*) | unused level 4 (loads and plays) and empty slot 15; an unused 1978-entry Venom 1 layout; 208 unreferenced assets (Japanese menu text, an older HUD, a versus effects set, a Corneria sky quad); 52 unused radio lines (an early control tutorial); a crash-debugger button code; 154 dead functions; about 186 KB of unreferenced music samples; leak-only content (a "BS" stage, an older Titania boss and Sector X boss, a Japanese config screen, test photos, songs not in the ROM) |
| Leak | a V1.0-lineage English build tree with iQue localisation; level and audio data byte-identical to the ROM (Venom 1 list = V1.0) |

### 1.2 ROM identification

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| USA V1.0 | `STARFOX64` | `NFXE` | 0 | 12 MiB (`0xC00000`) | `A7D015F8` | `2289AA43` | `d8b1088520f7c5f81433292a9258c1184afa1457` | CIC-6101 | — |
| USA V1.1 | `STARFOX64` | `NFXE` | 1 | 12 MiB (`0xC00000`) | `BA780BA0` | `0F21DB34` | `09f0d105f476b00efa5303a3ebc42e60a7753b7a` | CIC-6101 | — |

Verified from the normalized ROM headers and complete-image SHA-1 hashes.

### 1.3 Terminology and conventions

ROM and memory ranges are half-open. Offsets, addresses, encoded sizes, masks,
and opcodes are hexadecimal unless stated otherwise. Multi-byte CPU fields are
big-endian. RAM addresses are virtual unless explicitly identified as physical;
segmented, VROM, and file-relative addresses are named at each use.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

#### makerom and main

- **ROM 0x0000-0x0FFF:** the header and the 6101 IPL3.
- **ROM 0x1000-0x104F:** entry stub at vram 0x80000400. It zeroes bss (8 bytes per step), sets `sp`, and jumps to `bootproc` 0x80004DA8. **Verified** by disassembly.

| | V1.0 | V1.1 |
|---|---|---|
| bss start / size (stub immediates) | 0x800D8E90 / 0x95A50 | 0x800DD880 / 0x9B1F0 |
| initial sp | 0x801344A0 | 0x80138E90 |

**main** is DMA file 1. It is uncompressed, and ROM 0x1050 is loaded at vram 0x80000450, so `vram = rom - 0x1050 + 0x80000450`.

| section | V1.0 vram (ROM) | V1.1 vram (ROM) |
|---|---|---|
| text (starts with rspboot, aspMain, F3DEX) | 80000450-800BEE60 (0x1050-0xBFA60) | 80000450-800C32E0 (0x1050-0xC3EE0) |
| data + rodata | 800BEE60-800D8E90 (0xBFA60-0xD9A90) | 800C32E0-800DD880 (0xC3EE0-0xDE480) |
| bss | 800D8E90-8016E8E0 | 800DD880-80178A70 |
| gDmaTable copy (RAM) | 8016E8E0 | 80178A70 |
| ast_radio (RAM) | 8016EE80 | 80179010 |
| overlay and asset load base | **8017D390** | 80187520 |

The text contains the microcode ID string `RSP Gfx ucode F3DEX.NoN     1.22 Yoshitaka Yasumoto Nintendo.` (five spaces before 1.22; ROM 0xC4C80 in V1.1, 0xC0800 in V1.0) (**verified**). The leak's `Source/spec` links `gspF3DEX.NoN.fifo.o` into the `code` segment (leak-supported).

The decomp's rev0 yaml gives a V1.0 overlay vram of 0x80187520. That is **wrong**. V1.0 links and loads overlays and asset segments at 0x8017D390, which is V1.1 minus 0xA190:
- **verified** from V1.0 `Load_SceneFiles` (`lui s0,0x8018; addiu s0,-0x2C70`);
- **verified** from every V1.0 overlay's internal addresses;
- **verified** in V1.0 RDRAM (ovl_menu found at 0x8017D390).

### 2.2 Memory and address mapping

#### Addressing and units

- **Segmented addresses.** A pointer `0xSSOOOOOO` with SS in 1..15 resolves to `file(segment SS)[OOOOOO]` for the scene in *How a level is loaded*.
- **Pointers into main.** A few pointers point into main (0x80000450..): render presets and some engine display lists. They resolve to `main[addr - 0x80000450]` for the matching version.
- **Pointers into overlays.** Overlay addresses (0x8017xxxx-0x801Cxxxx) occur only in code-built lists and function pointers, and a static loader does not follow them.
- **Units and axes.**
  - One vertex unit is one world unit; there is no scaling.
  - The frame is right-handed, Y up, with the player flying towards −Z.
  - No X mirroring (**verified**: the "GOOD LUCK!" sign on a Corneria building reads correctly, and renders from the RAM camera match the game).
- **Matrices** are row-vector (v' = v·M). Game call order `T · RY · RX · RZ` means the vertex is rotated about Z, then X, then Y, then translated.
- **Rotation conventions** (decomp `sys_matrix.c`):
  - RY: x' = x cos + z sin, z' = −x sin + z cos;
  - RX: y' = y cos − z sin, z' = y sin + z cos;
  - RZ: x' = x cos − y sin, y' = x sin + y cos.

### 2.3 ROM map and asset organization

#### ROM map

vrom = decompressed image address; rom = stored range; C = MIO0. V1.1 ROM ranges shift by +0x49F0 for entries 2-54 (entry 1 only in romEnd; ast_radio's romEnd +0x4A20), and by +0x4A20 to +0x4CD0 from entry 55 on (**verified**; the complete V1.0 map is in `notes/lead_filecompare.txt`). "Same" means the decompressed bytes are identical in both versions.

| # | file (leak segment) | V1.1 vrom | size | V1.1 rom | C | V1.0 rom | same |
|---|---|---|---|---|---|---|---|
| 0 | makerom | 000000 | 1050 | 000000-001050 | 0 | 000000 | no (CRC, version, stub) |
| 1 | main (code) | 001050 | DD430 | 001050-0DE480 | 0 | 001050 (size D8A40) | no |
| 2 | dma_table (dmadata) | 0DE480 | 5A0 | 0DE480-0DEA20 | 0 | 0D9A90 | no (offsets) |
| 3 | audio_seq (Audioseq) | 0DEA20 | 3ACF0 | 0DEA20-119710 | 0 | 0DA030 | yes |
| 4 | audio_bank (Audiobank) | 119710 | 1E020 | 119710-137730 | 0 | 114D20 | yes |
| 5 | audio_table (Audiotable) | 137730 | 73C580 | 137730-873CB0 | 0 | 132D40 | yes |
| 6 | ast_common (jtshape) | 873CB0 | 32C10 | 873CB0-88B200 | 1 | 86F2C0 | yes |
| 7 | ast_bg_space (jtsshape) | 8A68C0 | 77E0 | 88B200-88D4F0 | 1 | 886810 | yes |
| 8 | ast_bg_planet (jtgshape) | 8AE0A0 | 11B60 | 88D4F0-899870 | 1 | 888B00 | yes |
| 9 | ast_arwing (awshape) | 8BFC00 | 19DF0 | 899870-8A4B00 | 1 | 894E80 | yes |
| 10 | ast_landmaster (tkshape) | 8D99F0 | 8590 | 8A4B00-8A7850 | 1 | 8A0110 | yes |
| 11 | ast_blue_marine (subshape) | 8E1F80 | 7350 | 8A7850-8AA0F0 | 1 | 8A2E60 | yes |
| 12 | ast_versus (vsshape) | 8E92D0 | 2F160 | 8AA0F0-8BE370 | 1 | 8A5700 | yes |
| 13 | ast_enmy_planet (e1shape) | 918430 | A300 | 8BE370-8C2450 | 1 | 8B9980 | yes |
| 14 | ast_enmy_space (e2shape) | 922730 | C510 | 8C2450-8C7430 | 1 | 8BDA60 | yes |
| 15 | ast_great_fox (gfshape) | 92EC40 | 11E90 | 8C7430-8D92C0 | 0 | 8C2A40 | yes |
| 16 | ast_star_wolf (wtshape) | 940AD0 | 147A0 | 8D92C0-8EDA60 | 0 | 8D48D0 | yes |
| 17 | ast_allies (npcshape) | 955270 | CA70 | 8EDA60-8F4EB0 | 1 | 8E9070 | yes |
| 18 | ast_corneria (cnshape) | 961CE0 | 3F780 | 8F4EB0-912380 | 1 | 8F04C0 | no (event script) |
| 19 | ast_meteo (asshape) | 9A1460 | 31B70 | 912380-928FB0 | 1 | 90D990 | yes |
| 20 | ast_titania (tijshape) | 9D2FD0 | A3C0 | 928FB0-92E030 | 1 | 9245C0 | no (event script) |
| 21 | ast_7_ti_2 (tib1shape) | 9DD390 | E250 | 92E030-93C280 | 0 | 929640 | yes |
| 22 | ast_8_ti (tib2shape) | 9EB5E0 | 92A0 | 93C280-945520 | 0 | 937890 | yes |
| 23 | ast_9_ti (tib3shape) | 9F4880 | 10120 | 945520-955640 | 0 | 940B30 | yes |
| 24 | ast_A_ti (tib4shape) | A049A0 | 99A0 | 955640-95EFE0 | 0 | 950C50 | yes |
| 25 | ast_7_ti_1 (tishape) | A0E340 | EDB0 | 95EFE0-968DB0 | 1 | 95A5F0 | yes |
| 26 | ast_sector_x (sxshape) | A1D0F0 | 32AC0 | 968DB0-987DA0 | 1 | 9643C0 | yes |
| 27 | ast_sector_z (szshape) | A4FBB0 | 93B0 | 987DA0-98D2E0 | 1 | 9833B0 | yes |
| 28 | ast_aquas (acshape) | A58F60 | 32510 | 98D2E0-9ACB00 | 1 | 9888F0 | yes |
| 29 | ast_area_6 (sbshape) | A8B470 | 28B90 | 9ACB00-9BE320 | 1 | 9A8110 | yes |
| 30 | ast_venom_1 (bmshape) | AB4000 | 1B960 | 9BE320-9CA610 | 1 | 9B9930 | no (placements, scripts) |
| 31 | ast_venom_2 (bm03shape) | ACF960 | 16740 | 9CA610-9D4090 | 1 | 9C5C20 | yes |
| 32 | ast_ve1_boss (bbshape) | AE60A0 | 24960 | 9D4090-9EB6B0 | 1 | 9CF6A0 | yes |
| 33 | ast_bolse (boshape) | B0AA00 | 12050 | 9EB6B0-9F3B70 | 1 | 9E6CC0 | yes |
| 34 | ast_fortuna (foshape) | B1CA50 | 10000 | 9F3B70-9FCA60 | 1 | 9EF180 | yes |
| 35 | ast_sector_y (swshape) | B2CA50 | 34890 | 9FCA60-A14090 | 1 | 9F8070 | yes |
| 36 | ast_solar (snshape) | B612E0 | 23280 | A14090-A2A270 | 1 | A0F6A0 | yes |
| 37 | ast_zoness (zoshape) | B84560 | 2CC70 | A2A270-A420E0 | 1 | A25880 | yes |
| 38 | ast_katina (ktshape) | BB11D0 | 11200 | A420E0-A490F0 | 1 | A3D6F0 | yes |
| 39 | ast_macbeth (mcshape) | BC23D0 | 38370 | A490F0-A64DE0 | 1 | A44700 | yes |
| 40 | ast_warp_zone (wpshape) | BFA740 | 1DD0 | A64DE0-A65A00 | 1 | A603F0 | yes |
| 41 | ast_title (dmshape) | BFC510 | 4CA30 | A65A00-A88180 | 1 | A61010 | yes |
| 42 | ast_map (mpshape) | C48F40 | 60EA0 | A88180-AB6F60 | 1 | A83790 | yes |
| 43 | ast_option (txtshape) | CA9DE0 | 16090 | AB6F60-ABDF30 | 1 | AB2570 | yes |
| 44 | ast_vs_menu (vtxshape) | CBFE70 | 125A0 | ABDF30-AC6BD0 | 1 | AB9540 | yes |
| 45 | ast_text (mojishape) | CD2410 | B890 | AC6BD0-AC9F40 | 1 | AC21E0 | yes |
| 46 | ast_font_3d (mojipshape) | CDDCA0 | C1D0 | AC9F40-ACDEB0 | 1 | AC5550 | yes |
| 47 | ast_andross (andshape) | CE9E70 | 3B290 | ACDEB0-AF5C50 | 1 | AC94C0 | yes |
| 48 | ast_logo (onshape) | D25100 | 2500 | AF5C50-AF8150 | 0 | AF1260 | yes |
| 49 | ast_ending (endshape) | D27600 | 1BE00 | AF8150-B046B0 | 1 | AF3760 | yes |
| 50 | ast_ending_award_front (end1) | D43400 | 25080 | B046B0-B175E0 | 1 | AFFCC0 | yes |
| 51 | ast_ending_award_back (end2) | D68480 | 29A90 | B175E0-B281F0 | 1 | B12BF0 | yes |
| 52 | ast_ending_expert (end3) | D91F10 | 4A100 | B281F0-B43B40 | 1 | B23800 | yes |
| 53 | ast_training (trshape) | DDC010 | 9D40 | B43B40-B47970 | 1 | B3F150 | yes |
| 54 | ast_radio (msgusa) | DE5D50 | E510 | B47970-B4CB70 | 1 | B42F80 | no (RAM pointers only) |
| 55 | ovl_i1 (i1prog) | DF4260 | 141A0 | B4CB70-B592D0 | 1 | B48150 (size 14160) | no |
| 56 | ovl_i2 (i2prog) | E08400 | E850 | B592D0-B61E50 | 1 | B54860 | no (relocation) |
| 57 | ovl_i3 (i3prog) | E16C50 | 3AD20 | B61E50-B87660 | 1 | B5D3E0 | no (relocation) |
| 58 | ovl_i4 (i4prog) | E51970 | 18EA0 | B87660-B97C40 | 1 | B82C10 | no (relocation) |
| 59 | ovl_i5 (i5prog) | E6A810 | 349C0 | B97C40-BB70D0 | 1 | B93190 | no (relocation) |
| 60 | ovl_i6 (i6prog) | E9F1D0 | 20A10 | BB70D0-BCAA00 | 1 | BB25E0 | no |
| 61 | ovl_menu (tomprog) | EBFBE0 | 30680 | BCAA00-BE63D0 | 1 | BC5EB0 | no |
| 62 | ovl_ending (endprog) | EF0260 | F7E0 | BE63D0-BEDAA0 | 1 | BE1750 | no (relocation) |
| 63 | ovl_unused (shpprog) | EFFA40 | A0 | BEDAA0-BEDAD0 | 1 | BE8DD0 | yes |

The names in the second column come from the decomp's `src/dmatable.c`. The names in parentheses come from the leak's `Source/spec` segment order, which maps 1:1 onto the 64 entries (leak-supported; the raw/compressed pattern is **verified** to match).

### 2.4 Compression formats

#### DMA file table

The table is 0x5A0 bytes: 90 slots of 16 bytes, of which 64 are used and the rest are zero. All values are big-endian.
| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `+0x00` | 4 | `u32` | `vromStart` | address of the file in the uncompressed linked image; the game's file id |
| `+0x04` | 4 | `u32` | `romStart` | ROM offset of the stored bytes |
| `+0x08` | 4 | `u32` | `romEnd` | end of the stored bytes (0 terminates the table) |
| `+0x0C` | 4 | `u32` | `compressed` | 1 = MIO0 stream, 0 = raw |
- **Location:** ROM 0xD9A90 (V1.0) or 0xDE480 (V1.1). The table is itself DMA file 2.
- **Pattern search (verified unique in both ROMs):** entry 0 = {0, 0, 0x1050, 0}, entry 1 = {0x1050, 0x1050, T, 0}, and entry 2's vromStart = T, where T is the table's own ROM offset. Scan 4-byte-aligned offsets from 0x1000 to 0x200000.
- **Reading:** read entries until romEnd == 0. The decompressed size is the next entry's vromStart minus this one's. For the last entry, use the MIO0 header size.
- **Invariants (verified):**
  - files are contiguous on ROM (`romEnd[i] == romStart[i+1]`);
  - all bounds are multiples of 16;
  - files 0-5 have vrom == rom;
  - after the last file, the ROM is 0xFF up to 12 MB.
- **Compression:** 51 files are MIO0. 13 are raw: makerom, main, dma_table, the three audio files, ast_great_fox, ast_star_wolf, ast_7_ti_2, ast_8_ti, ast_9_ti, ast_A_ti and ast_logo.
- **Leak cross-check:** the leak's `Source/fox_press` compresses exactly this set, and its `linux_tools/romaddress.c` writes the table after linking with the same vrom/rom semantics (leak-supported; the raw/compressed set is **verified** against the ROM flags).

#### MIO0

See the shared [MIO0 format and C codec](./compression/mio0.md). The DMA table
determines which Star Fox files use it.

**Verified** against the game routine `Mio0_Decompress` (0x8001EE70) and all 102 compressed files of both ROMs. The leak's `slidec/slid12.o` `slidstart` is byte-identical to the ROM routine.
| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u8[4] | magic | MIO0. |
| `+0x04` | 4 | `u32` | `decompressedSize` | — |
| `+0x08` | 4 | `u32` | `backrefOffset` | (from header start) |
| `+0x0C` | 4 | `u32` | `literalOffset` | (from header start) |
| 0x10 | Variable | u32[] | control | Control words, bits consumed MSB first. |
Decoding loop, until `decompressedSize` bytes have been written:
- **control bit 1:** copy one byte from the literal stream.
- **control bit 0:** read `u16 v` (BE) from the back-reference stream. Copy `(v >> 12) + 3` bytes (3..18), one at a time, from `out[pos - ((v & 0xFFF) + 1)]` (distance 1..4096). Overlapping copies act as runs.

Stream layout is contiguous in every file: control bits end at backrefOffset, back-references end at literalOffset, and literals end 0-14 zero bytes before romEnd.

Both versions produce byte-identical streams for identical content: 39 of 51 streams match, and the other 12 are exactly the files whose content changed.

Reference implementations:
- ROM extraction (Python);
- `sf/fs/proto/sf64fs.ts` (TypeScript, no dependencies). `npx tsx test.ts` decompresses every file of both ROMs and checks sizes and md5s: ALL OK, about 0.2 s per ROM.

#### Extracting every file

```
T = findDmaTable(rom)                       // *DMA file table* pattern
for i in 0..: {v, rs, re, c} = u32x4(rom, T + 16*i); if re == 0: break
  data = c ? mio0(rom, rs) : rom[rs:re]
  assert len(data) == next.vromStart - v    (last: MIO0 header size)
```
Both scripts produce identical md5s for all 64 files of both ROMs (**verified**). The extracted files are in `sf/files/v10/` and `sf/files/v11/`, each with an `index.txt`.

#### ROM, filesystem, codec, loader

| claim | evidence |
|---|---|
| Header, CRCs, CIC-6101, JP table | ROM extraction (recomputes CRC1/2 over 0x1000-0x100FFF) |
| DMA table layout, pattern, 64 entries, contiguity, 0xFF tail | ROM extraction, ROM extraction, `fs/proto/test.ts` (ALL OK on both ROMs) |
| MIO0 format; 102 streams decompress to exact size; contiguous streams; 39/51 identical across versions | ROM extraction → `fs/tmp/mio0check.out`; game routine disassembly (`fs/dis.sh`); leak `slidec/slid12.o` byte-identical |
| Loader functions, scene structs, segment map | disassembly `fs/tmp/foxload10.txt`, `foxload11.txt`; ROM extraction → `fs/tmp/scenes.out` |
| Segments in RAM = decompressed files | V1.1 Corneria RDRAM `fs/rdram_co11.bin` + ROM extraction (byte-identical except runtime-animated textures); V1.0 title RDRAM `fs/rdram_menu10.bin` + ROM extraction |
| V1.0 overlay base 0x8017D390 | V1.0 `Load_SceneFiles` immediates; overlay internal addresses; ovl_menu found at 0x8017D390 in V1.0 RAM |
| Per-file V1.0/V1.1 identity | `notes/lead_filecompare.txt` (md5 of decompressed files) |

### 2.5 Loading process

### 2.6 Revision differences

#### Version differences (V1.0 vs V1.1)

**Summary.** The versions differ in **both code and data**. For the viewer, the difference is almost nothing:
- all geometry, textures, display lists, render presets, environment records, audio files and scene compositions are byte-identical;
- the data changes are limited to event scripts in Corneria and Titania, the Venom 1 placement list and scripts, and pointer relocation in the radio messages;
- the code changes are four engine fixes, three overlay tweaks, and a libultra build that adds Nintendo's remote debugger.

**V1.1 is the primary version**: the decomp symbols target it. **One loader serves both versions**: it finds the table by pattern and picks the per-version address set in *Addresses that differ per version*.

Method (**verified**, ROM extraction, ROM analysis, cross-check, ROM analysis):
- Both main images and every overlay were aligned instruction by instruction, with relocatable fields masked (jal targets, lui, addiu/ori, load/store immediates).
- Every remaining differing word was checked against the text, data and bss address maps and the overlay base shift (+0xA190). That covers 23441 code relocation pairs and 4287 differing data words in main, and 44351 relocation words in the overlays.
- Decompressed asset files were byte-compared, and the differing ranges decoded.

#### main (+0x49F0 bytes: text +0x4480, data +0x570; bss +0x57A0)

| # | subsystem | V1.0 → V1.1 address | function (decomp / leak name) | change | status |
|---|---|---|---|---|---|
| 1-9 | libultra | 800227A0.. → 800227A0..8002E3E0 | osCreatePiManager (+ramromMain thread), osInitialize, `__osException` (+`__ptException`, calls kdebugserver), __osTimerInterrupt, `__osRdbSend`, kdebugserver, osReadHost, osInitRdb, the whole rmon (`__rmon*`), plus rmon data/rodata and bss | V1.1 links a libultra build with the remote debugger: +4380 instructions (text +0x4470), data +0x570, bss +0x57A0 (ramrom thread and stack, rmon buffers). rmonMain and osInitRdb are unreferenced. Strings `Set temp BP at %08x`, ` and %08x` are V1.1-only | verified |
| 10 | HUD | 800538E0/EC → 80057D50/5C | Display_Update / `game_display` | hit counter clamp 999 → **511** (`slti at,t0,1000; li t1,999` → `slti at,t0,512; li t1,511`; lead re-checked the bytes) | verified |
| 11 | player effects | 800A0230.. → 800A46A0.. | Player_DamageEffects / `player_kem_set_life` | `&& !gVersusMode` added to both broken-wing electric-arc spawns (+6 instructions) | verified |
| 12 | screen fade | 800A2108.. → 800A6590.. | Play_UpdateFillScreen / `fade_cont` | flash frame sets `gFillScreenAlpha = 254` (V1.0 left it 255) | verified |
| 13 | Landmaster | 800AEB84.. → 800B3010.. | Player_TankBoostBrake / `tank_dush_360` | boost/brake SFX condition: V1.0 on button press; V1.1 when `boostMeter == 0.0f` | verified |
| 14 | padding | 800B4944 → 800B8DCC | end of fox_play text | 3 zero words → 1 | verified |

Every other game-engine function (fox_*, sys_*, audio) is identical up to relocation (**verified**). Relocation side effects of the asset change:
- main's 20 references to ast_venom_1 segment-6 addresses after the insertion point move by +0xC (2 in code, 18 in object-info tables);
- main's references into ovl_i1 after the Golemech function move by a further +0x44.

Interpretation (hypotheses, strongest first):
- **#10** fixes a save bug. The save stores per-planet hits in 9 bits (`hitCount:8` + `hitCountOver256:1`, decomp `sf64save.h`), so 512-999 could not be stored.
- **#12** avoids a premature transition. Several level-complete sequences wait for `gFillScreenAlpha == 255`, which a V1.0 flash frame could satisfy.
- **#13** stops the sound retriggering on every press.
- **#11** is a Versus effects or performance fix.
- **#1-9** most likely come from linking the debug libultra by accident. It is inert on retail hardware and unrelated to PAL or Rumble; the motor code is unchanged.

#### Overlays

| overlay | V1.0 → V1.1 size | real change | status |
|---|---|---|---|
| ovl_i1 | 0x14160 → 0x141A0 | **Venom1_Ve1Golemech_Update** (leak `fox_bm1.o` `BM_Boss_move`). V1.1 adds `if (pos.z > gPlayer[0].trueZpos - 200) Math_SmoothStepToF(&pos.z, target, 0.5, 35, 0.01) else (the V1.0 call with 0.4, 10, 0.01)`: +17 instructions, and one new rodata float 0.01f in place of padding. The Golemech boss closes in faster when the player is within 200 units | verified (code); intent hypothesis |
| ovl_i6 | 0x20A10 | **Venom2_LevelComplete**: `player->csTimer = 180` → `250` (V1.0 8018CE48 `li t8,180`, V1.1 80196FD8 `li t8,250`, file offset 0xFAB8 in both; lead re-checked the bytes). Applies (per decomp) when the player is within 4000 units of the boss at cutscene start | verified (code); condition per decomp |
| ovl_menu | 0x30680 | **Map_801A2674**: a map animation factor `*= 1.04f` → `1.03f` (rodata V1.0 801AD528, V1.1 801B76B8) | verified |
| ovl_i2, i3, i4, i5, ending | same | relocation only | verified |
| ovl_unused | 0xA0 | byte-identical | verified |

Internal overlay addresses: V1.0 = V1.1 - 0xA190. For ovl_i1 text past V1.1 0x80198310, subtract a further 0x44; for its rodata and data, a further 0x40.

#### Asset files

| file | range | change | status |
|---|---|---|---|
| ast_corneria | 0x3BC74, 12 bytes | Event script. After `SET_TRIGGER(11, EVC_NONE)`, V1.0 `INIT_ACTOR(30,0); LOCAL_ROTATION; SET_SPEED(0,10)` → V1.1 `LOCAL_ROTATION; SET_SPEED(0,10); INIT_ACTOR(30,0)` | verified |
| ast_titania | 0x5BC7, 1 byte | Event script `STOP_SCRIPT; SET_SPEED(0, 200 → 150); STOP_BGM`: the music stops 50 frames sooner | verified (bytes); meaning hypothesis |
| ast_venom_1 | list 0xD726-0xDAD3; scripts 0x1AE88-0x1B95E | `aVe1LevelObjects`: 23 of 1664 entries reordered or moved (ids 1023/1097-1099 event actors, two OBJ_ACTOR_VE1_MONKEY_STATUE). The three wingman scripts (EVC_PEPPY/FALCO/SLIPPY_ACTIVE) gain `SET_WAIT(40)`. The +0xC is absorbed by end padding, so the file size is unchanged, but later segment-6 pointers move +0xC | verified |
| ast_radio | 0xCCB0-0xE50C | 779 absolute RAM pointers in the message table move by +0xA190 (the file loads at a different address). No text change | verified |

For a static viewer the only visible effect is in Venom 1: a few event-actor and statue positions differ. The placement code is the same.

#### makerom and dma_table

- **makerom:** CRC1/CRC2, the version byte, and the entry-stub bss start/size and `sp` immediates.
- **dma_table:** entries 1-54 shift +0x49F0 (ast_radio's romEnd +0x4A20); later entries shift +0x4A20 to +0x4CD0 on ROM and +0x4A30 on vrom. The compression flags are identical.

Both **verified**.

#### Addresses that differ per version

| item | V1.0 | V1.1 |
|---|---|---|
| DMA table ROM offset | 0xD9A90 | 0xDE480 |
| main data ROM range | 0xBFA60-0xD9A90 | 0xC3EE0-0xDE480 |
| scene tables (sNoOvl_Logo) | 0x800C59C4 | 0x800CA3B4 |
| sLevelSceneIds[21] | 0x800CDEC4 | 0x800D28B4 |
| gLevelObjectInits[21] (placement lists) | 0x800CB3B0 | 0x800CFDA0 |
| environment table [21] | 0x800CE5A8 | 0x800D2F98 |
| gObjectInfo[400] | 0x800C7734 | 0x800CC124 |
| gRcpSetupDLs[88] (render presets) | 0x800CE7C0 | 0x800D31B0 |
| sEventActorInfo[108] | 0x800CB64C | 0x800D003C |
| Venom 1 event-script table | ast_venom_1+0x1B1D8 | ast_venom_1+0x1B1E4 |
| Load_SceneSetup jump table | 0x800D15C4 | 0x800D5FB4 |
| audio tables, ROM (sample banks, sequences, fonts, seq→font, gAudioSpecs, sSoundTestTracks) | 0xBFD90, 0xBFDE0, 0xC0210, 0xC0430, 0xC3E38, 0xC2664 | 0xC4210, 0xC4260, 0xC4690, 0xC48B0, 0xC82B8, 0xC6AE4 |
| note_data tables, ROM | 0xD8920 | 0xDD310 |
| overlay/asset load base | 0x8017D390 | 0x80187520 |
| gSegments (RAM) | 0x800DD5E0 | 0x800E1FD0 |

The level tables listed here shift by exactly −0x49F0 from V1.1 to V1.0. The audio tables at the start of main's data shift by −0x4480 (note_data by −0x49F0, with relocated RAM pointers in its first 0x18 bytes). Their contents are identical, apart from the relocated segment-6 pointers noted in *main (+0x49F0 bytes: text +0x4480, data +0x570; bss +0x57A0)* (**verified**: `lv/proto/dump.txt`, `presets_v10.txt` = `presets_v11.txt`).

#### The leak and the versions

Relocation-masked matching of every leak `.o` function against both ROMs (ROM extraction): 1155 match both, 2 match only V1.0 (`game_display`, `fade_cont`), 0 match only V1.1, and 290 match neither (codegen differences). Every function V1.1 changed has its V1.0 behaviour in the leak.

The leak's English objects are therefore a **V1.0-lineage build that is not byte-identical to either US ROM** (leak-supported conclusion; the individual matches are **verified**). The tree also carries the iQue (Chinese) localisation (leak-supported; lead check), with details in *Leak-only content (absent from the ROM)*:
- `#if LOCALE==CHINA` blocks in `Source/spec` select `audio/zh/*`. The file is EUC-JP, so plain `grep` treats it as binary; `grep -a` finds them.
- `Source/fox_locale.h` has `#define CHINA 1`.
- The `audio/zh/` and `i10n/` directories.
- A Chinese ISBN in `Source/metadata/isbn.txt`. hypothesis: this is the iQue-era tree, restored from the V1.0 sources.

All level data in the leak (`Source/XX_data.o`: environment records and placement lists) is byte-identical to the ROM data in both versions (**verified**, `lv/proto/leakcheck.txt`), with one exception: the only list that differs between the versions. The leak's `BM_data.o` Venom 1 list is byte-identical to **V1.0**'s `aVe1LevelObjects`, and differs from V1.1 in exactly the changed range, 145 bytes in 0xD726-0xDAD3 (**verified** by the lead, comparing `.data` of `BM_data.o` against both extracted `ast_venom_1` files). This is independent data-side confirmation that the leak follows V1.0.

#### Version differences

| claim | evidence |
|---|---|
| main alignment and classification (23441 relocation pairs, 4287 data words) | ROM extraction, ROM extraction, ROM extraction → `fs/tmp/classify_main.out`, `fs/tmp/blocks_main.txt` |
| Function-level diffs | ROM extraction, `fs/fdiff.sh` → `fs/tmp/f10_*`, `f11_*`, `o10_ve1.txt`, `o11_ve1.txt` |
| Overlay diffs | ROM extraction, ROM analysis, ROM analysis → `fs/tmp/ovl_pos.out` |
| Asset diffs (event scripts, Venom 1 list) | ROM extraction, ROM extraction, cross-check → `vercmp.txt` |
| Lead re-checks | hit cap `slti 1000 / li 999` at V1.0 0x800538E0 vs `slti 512 / li 511` at V1.1 0x80057D50; Venom 2 `li t8,180` vs `li t8,250` at ovl_i6 file offset 0xFAB8 (objdump of ROM/extracted bytes) |
| Leak version | ROM extraction → `fs/tmp/leakver.out`; lead: leak `BM_data.o` .data = V1.0 Venom 1 list, V1.1 differs in 145 bytes (0xD726-0xDAD3); cross-check → `leakcheck2.txt` |

#### Filesystem and versions

- The intent of each behavioural V1.1 change is inferred and was not tested in the emulator. The 9-bit save field reason for the hit cap is the best supported.
- Whether V1.1's remote-debugger libultra is libultra_d linked by mistake or a newer library (no libultra archive in the leak).
- The exact semantics of the osInitialize / __osTimerInterrupt changes were not decoded instruction by instruction.
- The JP ROM's 63rd missing table entry was not identified. EU (Lylat Wars) was not examined.
- The leak's build identity: V1.0-lineage but not byte-identical; 290 functions match neither ROM.

#### Version-diff leftovers

The V1.0/V1.1 comparison (*Version differences (V1.0 vs V1.1)*) exposes little hidden content, but three things stand out:
- **V1.1's debug libultra.** V1.1 was linked against a libultra with Nintendo's remote debugger. It adds 4380 instructions: rmon, kdebugserver, osReadHost, osInitRdb and a "ramrom" thread. rmonMain and osInitRdb are never called, and the strings `Set temp BP at %08x` / ` and %08x` exist only in V1.1. This is dormant debug code shipped by accident or for a dev-kit build (7.1 #1-9).
- **Venom 1 placement edits.** V1.1 re-sorts 23 entries of the Venom 1 list: three event actors (1097-1099) move and pairs swap x. Its three wingman scripts gain `SET_WAIT(40)`. The +0xC growth is absorbed by V1.0's end padding (7.3).
- **Script tweaks.** V1.1 reorders one Corneria script (INIT_ACTOR after SET_SPEED) and changes one Titania BGM-stop delay from 200 to 150 frames (7.3).

The data side also confirms the leak's lineage: the leak's `BM_data.o` equals V1.0's Venom 1 list.

## 3. Level data

### 3.1 Level catalog and identifiers

#### Level list

`gCurrentLevel` (RAM V1.1 0x80178234) indexes every per-level table. The names come from each level's title-card texture: IA8 images at the start of each level file, decoded to `lv/titlecards/*.png` (**verified** by viewing them). The two-letter leak prefixes are the original internal names. Leak `Source/fox_play.o` .data relocations list the stage table in the same order as the ROM table (leak-supported, and consistent with the ROM).

| id | decomp | leak | title card | kind | level file (seg 6) | overlay |
|---|---|---|---|---|---|---|
| 0 | CORNERIA | CN | Corneria / Former Army Base | on-rails planet; all-range Granga arena list | ast_corneria | ovl_i1 |
| 1 | METEO | AS | Meteo / Asteroid Field | on-rails space; warp list | ast_meteo | ovl_i2 |
| 2 | SECTOR_X | SX | Sector X Combat Zone | on-rails space; warp list | ast_sector_x | ovl_i2 |
| 3 | AREA_6 | CL | Area 6 / Defense Station | on-rails space | ast_area_6 | ovl_i3 |
| 4 | UNK_4 | SB | (none) | stub, unused (*Unused and hidden content*) | ast_area_6 | ovl_i3 |
| 5 | SECTOR_Y | SW | Sector Y Combat Zone | on-rails space; all-range Shogun arena | ast_sector_y | ovl_i6 |
| 6 | VENOM_1 | BM | Venom / Andross' Homeworld | on-rails planet (Venom 1 route) | ast_venom_1 (+9 ast_ve1_boss) | ovl_i1 |
| 7 | SOLAR | SN | Solar | on-rails planet (lava) | ast_solar | ovl_i3 |
| 8 | ZONESS | ZO | Zoness / Toxic Waste Area | on-rails planet (sea) | ast_zoness | ovl_i3 |
| 9 | VENOM_ANDROSS | AND | Venom / Andross' Homeworld | on-rails tunnel, all-range Andross base, escape paths | ast_venom_2 (+C ast_andross) | ovl_i6 |
| 10 | TRAINING | TR | Training | on-rails, then all-range | ast_training | ovl_i1 |
| 11 | MACBETH | MC | Macbeth / Venom Army Supply Base | on-rails Landmaster | ast_macbeth | ovl_i5 |
| 12 | TITANIA | TI | Titania / Arid Desert | on-rails Landmaster, procedural terrain | ast_titania (+7 ast_7_ti_1) | ovl_i5 |
| 13 | AQUAS | AC | Aquas Ocean | on-rails Blue Marine | ast_aquas | ovl_i3 |
| 14 | FORTUNA | FO | Fortuna / Former Defense Post | all-range planet | ast_fortuna | ovl_i4 |
| 15 | UNK_15 | – | – | no data (NULL in the placement and environment tables; scene id 0) | – | – |
| 16 | KATINA | KT | Katina / Frontline Base | all-range planet | ast_katina | ovl_i4 |
| 17 | BOLSE | BO | Bolse Defense Outpost | all-range space (ground plane) | ast_bolse | ovl_i4 |
| 18 | SECTOR_Z | SZ | Sector Z Combat Zone | all-range space | ast_sector_z | ovl_i4 |
| 19 | VENOM_2 | BM03 | Venom / Andross' Homeworld | all-range planet (Venom 2 route) | ast_venom_2 | ovl_i6 |
| 20 | VERSUS | VS | – | multiplayer: Corneria, Katina and Sector Z stages | – (seg 3 ast_versus) | ovl_i2 |

Level mode (decomp `Play_Init`, consistent with every list's decode):
- `gLevelMode` is on-rails for ids 0-13, and all-range for ids 14 and up and for Venom Andross phase 1.
- Corneria, Sector Y, Training and Venom Andross switch to all-range at run time.
- `LEVEL_WARP_ZONE = 77` is not a table index. It marks the warp phases of Meteo and Sector X, which load `ast_warp_zone` into segment 7.

Suggested viewer list. `LevelInfo.name` is the title-card text; `group` is the section heading below.

| group | entries |
|---|---|
| Lylat, on-rails | Corneria, Meteo, Sector X, Area 6, Sector Y, Venom 1, Solar, Zoness, Macbeth, Titania, Aquas, Venom (Andross tunnel) |
| All-range | Fortuna, Katina, Bolse, Sector Z, Venom 2, Corneria boss arena, Sector Y boss arena, Andross base (all-range), Training (all-range) |
| Warp zones | Meteo warp zone, Sector X warp zone |
| Other | Training (on-rails), Andross escape paths 1-3 |
| Versus | Corneria, Katina, Sector Z, Sector Z (time match list) |
| Unused | UNK_4 stub, Venom 1 beta layout (*Unused and hidden content*) |

Title, map and ending scenes are driven by overlay code, not by placement lists. They are optional and not specified here.

#### Levels

| claim | evidence |
|---|---|
| Level tables (scene ids, list pointers, environment, object info, presets), both versions | `lv/proto/dump.ts` → `lv/proto/dump.txt`; ROM analysis → `presets_v10.txt` = `presets_v11.txt` |
| Placement record and on-rails world position | Corneria RDRAM `lv/ram_co1.bin` + cross-check: 15 live scenery objects equal decoded positions and rotations; gLevelObjects = seg 6 + 0x371A4 |
| Camera and layout agreement | `lv/renders/corneria_emucam.png` (camera read from RAM) vs `lv/emu_co1.png` |
| All-range z sign | disassembly `lv/disasm/*.txt` + ROM analysis (quoted instructions in *Object placement*) |
| Path items only translate | disassembly of ItemPathChange_Update (V1.1 0x80068C88); RAM log `lv/emu_fly2.log` (xPath = 0 on the main route) |
| Corneria surface switch | `lv/proto/events.ts`; RAM gGroundSurface 2 → 0 between progress 38960 and 43240 (`lv/emu_fly2.log`, `lv/ram_fly_*.bin`) |
| Opcode set of scenery lists | `lv/proto/dlscan.ts` |
| Event actors, skeletons, Titania terrain | `lv/proto/events.ts`, `extras.ts`, `titerrain.ts`; renders `lv/renders/{meteo,sectorx,area6,sectory,titania,aquas,macbeth}.png` |
| Leak level data = ROM | cross-check, cross-check |
| Title cards | `lv/titlecards/*.png` |
| Reference comparison | runtime screenshots `shots/*.png` vs `lv/renders/*.png`. Lead comparison (qualitative): Corneria (RAM camera), Fortuna (towers, mountains, base) and Titania (ruins on terrain) show the same features |

#### Levels

- Whether the Corneria all-range Granga arena list (136 objects) is used in normal play. It was not reached in the emulator.
- Titania terrain: implemented from the algorithm and deterministic, but not compared with the game. The z phase is uncertain to ±220 units, and the game's normal averaging is not reproduced exactly.
- Event actors: the static/moving classification ignores trigger branches. 12 Corneria and 11 Area 6 scripts resolve to no model. SY_ROBOT_1-3 drawing is not reproduced. Warp-zone prim colours are set by code.
- Ground UV anchoring is inferred from `gDPSetupTile` shift 5; the exact texel-to-world ratio is a hypothesis.
- The Corneria lake route and its surface switches were not observed in the emulator (the unattended Arwing died first).
- Moving event actors are placed at their spawn pose, which is not necessarily where the player sees them.

### 3.2 Level container

#### Overlays and scenes

Game code outside main lives in 9 overlays: `ovl_i1`..`ovl_i6` (level code), `ovl_menu` (title, option, map, game over), `ovl_ending` and `ovl_unused`. Each overlay is linked at the load base. At most one overlay is in RAM at a time.

What is loaded is described by **Scene** structs in main. Each is 0x98 bytes:
| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | overlayVromStart | Overlay-file VROM start; zero means none. |
| 0x04 | 4 | u32 | overlayVromEnd | Exclusive VROM end. |
| 0x08 | 4 | u32 | bssStart | RAM BSS start. |
| 0x0C | 4 | u32 | bssEnd | RAM BSS end. |
| 0x10 | 4 | u32 | textStart | RAM text start. |
| 0x14 | 4 | u32 | textEnd | RAM text end. |
| 0x18 | 4 | u32 | dataStart | RAM data start. |
| 0x1C | 4 | u32 | rodataEnd | RAM read-only data end. |
| 0x20 | 0x78 | assetSlot[15] | assets | Slot i binds RSP segment i+1; zero is empty. |

Asset slot, eight bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | vromStart | Inclusive virtual-ROM start. |
| 0x04 | 4 | u32 | vromEnd | Exclusive virtual-ROM end. |

**Verified:** all 44 structs decode in both versions (ROM extraction, `lv/proto/dump.txt`).

Tables of Scene structs start at V1.0 0x800C59C4 and V1.1 0x800CA3B4 (`sNoOvl_Logo`). Table order is: logo, ending (6 setups), title, option, map, game over, then the level scenes.

Two ids select a scene:
- **SceneId:** the `Load_SceneSetup` switch. Its jump table is at V1.0 0x800D15C4 and V1.1 0x800D5FB4, covering cases 0..24, plus 50 (Versus) and 99 (logo).
- **setup:** an index into that scene's array, `gSceneSetup`.

Which file sits in which segment is **identical in both versions** (**verified**). Only overlay RAM addresses and vrom values differ.

Load algorithm. **Verified** by disassembly of both versions against decomp `fox_load.c`, and in RAM.
1. `Load_InitDmaAndMsg` (V1.0 80055028, V1.1 80059498):
   - reads the DMA table from a hard-coded ROM offset (0xD9A90 / 0xDE480) into gDmaTable;
   - loads ast_radio into RAM right after it.
2. `Load_RomFile(vrom, dst, size)` (V1.0 80054710, V1.1 80058B80) finds the entry whose vromStart equals `vrom`.
   - Raw file: `Lib_DmaRead` (0x800033E0 in both) copies it.
   - Compressed file: the stream is copied to gFrameBuffers (0x8038F800), then `Mio0_Decompress(src, dst)` runs (0x8001EE70; the routine is byte-identical in both versions).
3. `Load_SceneFiles(scene)` (V1.0 800547D8, V1.1 80058C48) packs everything from the load base.
   - The overlay is loaded, then its bss is cleared.
   - Then, for each non-empty slot n = 1..15:
     - set `gSegments[n] = K0_TO_PHYS(ramPtr)`;
     - emit `gSPSegment(n, ...)`;
     - load the file;
     - advance by the file's decompressed size.
   - Empty slots keep stale `gSegments` values.
   - gSegments is at V1.0 0x800DD5E0 and V1.1 0x800E1FD0 (**verified** in RAM).

All asset files are **position-independent within their segment**. A pointer `0xSSOOOOOO` inside any asset is `file(slot SS)[OOOOOO]`. A static loader therefore needs only the scene's segment-to-file map. It never needs RAM addresses, except for the few pointers into main listed in *Addressing and units*.

#### How a level is loaded

All tables are **verified** by decoding both mains (`lv/proto/dump.txt`); addresses for V1.0 are in *Addresses that differ per version*.
1. `sLevelSceneIds[level]` (V1.1 0x800D28B4, s32 x 21) gives the SceneId: 5, 6, 8, 10, 12, 13, 18, 14, 15, 16, 17, 21, 7, 9, 11, 0, 19, 22, 23, 24, 50.
2. `Load_SceneSetup(sceneId, gSceneSetup)` loads `scene[gSceneSetup]` (*Overlays and scenes*). Setup 0 is used at level start. Code changes it (triggers per decomp) for:
   - Titania boss phases, setups 1-5, which swap files in segments 7-A;
   - level-complete cutscenes (setup 1; compositions **verified** from the scene tables): Sector X adds E great_fox; Fortuna and Venom 2 replace F star_wolf with E great_fox; Macbeth replaces D allies with E great_fox; Meteo's setup 1 equals setup 0;
   - Versus setup 1 (Sector Z stage), which uses bg_space and enmy_space.
3. Segments at setup 0. Common to every level: 1 ast_common, 3 player vehicle, 5 ast_text. Planet levels use 2 ast_bg_planet and 4 ast_enmy_planet; space levels use ast_bg_space and ast_enmy_space. The level file sits in segment 6. Extras:

   | level | extra segments |
   |---|---|
   | Meteo | 7 warp_zone, E great_fox |
   | Sector X | 7 warp_zone, D allies |
   | Area 6 / UNK_4 | E great_fox |
   | Venom 1 | 9 ve1_boss, D allies |
   | Solar, Zoness | D allies |
   | Venom Andross | C andross, D allies (no seg 4) |
   | Training | F star_wolf |
   | Macbeth | D allies |
   | Titania | 7 ast_7_ti_1, E great_fox |
   | Aquas | 3 blue_marine, E great_fox |
   | Fortuna, Bolse, Venom 2 | F star_wolf |
   | Katina | D allies, F star_wolf |
   | Sector Z | D allies, E great_fox |
   | Macbeth, Titania | 3 landmaster |
   | Versus | 3 ast_versus, 7 vs_menu |

4. Per-level data pointers, all segmented, indexed by level id, with [15] = NULL:
   - `gLevelObjectInits[21]` (V1.1 0x800CFDA0): placement list;
   - environment table (V1.1 0x800D2F98): environment record (*Fog, lights, clear colour, camera*).

   Alternative lists (all-range arenas, warp zones, escape paths, Versus stages, the Venom 1 beta list) are selected by level code. Their locations are in *Object placement*.

#### Terrain and ground planes

The game draws the ground **attached to the camera** and scrolls only its texture (decomp `fox_bg.c` `Background_DrawGround`; extents **verified** from vertex data). A static viewer must build a world-anchored strip or plane.

| level | ground list (extent) | game placement | preset |
|---|---|---|---|
| Corneria on-rails | D_CO_601B640 (8000×12000, y 0) | `T(xPath,−3,−4000)`, copies at z ±3000 with Scale(1,1,0.5) | 20 (45 for water) |
| Corneria all-range, Fortuna, Katina, Bolse, Venom 2, Versus | D_CO_601EAA0, D_FO_6001360, D_KA_6009250, D_BO_600A810, D_VE2_6010700, D_versus_3018800 / _30160A0 (12000×12000) | 4 copies at (±6000, −3, ±6000), recentred in 12000 steps | 20 (29 Bolse) |
| Venom 1, Macbeth | D_VE1_60066D0 / D_MA_60306D0 (8000×12000) | as Corneria | 29 |
| Training | aTrGroundDL | on-rails: `T(xPath,−3,0)` (groundType 11, no −4000 offset), copies at z ∓3000 + gPathTexScroll with Scale(1,1,0.5); all-range 4 copies, x scale 1.5 | 29 |
| Aquas | floor D_AQ_600AB10 + water surface D_AQ_602AC40 (Scale(2,1,0.5)) | as Corneria | 20 / 37 |
| Solar / Zoness | D_SO_60005B0 / D_ZO_6008830 (1600×1600 grid, 512 tris; alternates each frame with D_SO_6002E60 / D_ZO_600B0E0) | `T(xPath,−3,0)·T(0,0,−2000 / −1500)·S(3,2,3)`; the game moves edge vertices to ±1400 at init, giving ≈8400×8400 (*Ground rendering details*) | 29 |
| Titania | procedural (below) | – | 29 |
| Meteo, Sector X/Y/Z, Area 6 | none | – | – |

Ground textures are 32×32 RGBA16 tiles loaded by code with `gDPLoadTileTexture` + `gDPSetupTile` (wrap, shift 5; uls/ult carry the scroll).
- Tiles: Corneria grass D_CO_601B6C0, rock D_CO_6028260, water D_CO_6028A60 (preset 45, prim alpha 128, translucent).
- Venom 1 uses D_VE1_6006750 and Macbeth D_MA_602DCB8, loaded by `gDPLoadTextureBlock`.

**Corneria surface per section.** Event command 119 (SET_SURFACE) switches `gGroundSurface`. **Verified**: decoded from the scripts, and in RAM the switch to grass at progress 41181 was observed between 38960 and 43240.

| route | world z range | surface |
|---|---|---|
| main | 0 .. −41181 | water |
| main | −41181 .. −141510 | grass |
| main | −141510 .. −163464 | water |
| main | beyond −163464 | grass |
| lake (x ≈ 7000) | from −174929 | rock |
| lake (x ≈ 7000) | from −191164 | water |

**Titania terrain.** Decomp `ovl_i5/fox_ground.c`; implemented in the prototype (render `lv/renders/titania.png`).
- **Grid:** 27 rows × 16 columns. Rows are 220 units apart. Columns sit at x = −4000, 220·j − 1760 (j = 1..14) and +4000.
- **Rows:** one row of heights per 220 units of path progress. The heights come from the list's OBJ_ACTOR_TI_TERRAIN records, each `{type = yPos, x = xPos, width = rot.x, height = rot.y, length = rot.z}`, active from zPos1.
- **Record types:**
  - 1: cosine bump;
  - 2: plateau;
  - 3: winding ridge;
  - 4-7: toggles for flat plane or terrain;
  - 8: random mountains.

  The V1.1 list has 152 type 1, 6 type 2, 1 type 3, six toggles and **no type 8**, so the terrain is deterministic (**verified**).
- **Processing rules** (decomp, as implemented in the prototype):
  - toggles: 4 = flat plane on, 5 = terrain off, 6 = terrain on, 7 = flat plane off;
  - at most 20 records are active;
  - records registered while the flat plane is on are lost (types 1-3 are treated as 0 then);
  - heights are summed with integer truncation per addition;
  - the grid origin is z 200 in the draw frame, with 26 rows drawn behind it;
  - the flat plane is 6820×5720 at y 0;
  - preset 29, texture shift 5.

  The per-type deformer formulas are in decomp `ovl_i5/fox_ground.c` `Ground_801B4AA8` and in `lv/proto/extras.ts`.
- **World z:** the row built at progress P is at z = −P − 5520 (hypothesis ±220).
- **Mesh:** triangles (2i, 2i+1, 2i+3), (2i, 2i+3, 2i+2); s = (j % 2)·0x400; t = 0 far / 0x400 near.
- **Material:** texture D_TI_6001BA8, 32×32 RGBA16, mirror wrap. Flat-plane ranges: progress 47740-55660 and 82720-92000.
- **Not compared against the game:** Titania was not reached in the emulator.

**Aquas seabed props:**
- AQ_CORAL: skeleton, frame 0.
- AQ_SEAWEED: skeleton, frame 0, no culling.
- AQ_STONE_COLUMN: D_AQ_6014520 with preset 55 when rot.y ≠ 0, otherwise a skeleton.
- AQ_OYSTER: Scale 3, preset 56, prim (255,143,143).

#### Skies, backdrops, starfields

Source: `notes/runtime.md`.
- Frame state, matrices and counts are **verified** in the emulator from 25 captured frame display lists (`rt/dl/*.txt`, ROM analysis, ROM analysis).
- Display-list, vertex and texture facts are **verified** by decoding the V1.1 asset files (ROM analysis).
- Formulas come from decomp `fox_bg.c` / `fox_play.c` where marked.

**Per-frame draw order.** Decomp `Display_Update`; consistent with the captured display lists.
1. `Game_InitMasterDL`: scissor 8..312 × 8..232; Z-buffer FILLRECT 0xFFFC; **full-screen FILLRECT in `gBgColor`**. This clear colour is not the fog colour. The warp zone draws a translucent motion-blur rectangle instead.
2. Starfield, if `gStarCount` ≠ 0.
3. `Background_DrawBackdrop`.
4. Sun glare (planet all-range).
5. Camera look-at.
6. Ground: planet levels and Bolse; Titania uses its terrain. With SURFACE_WATER the ground is drawn **after** objects (Corneria water, Aquas), and `Object_Draw` draws every object a second time with Scale(1,−1,1) as a reflection (CO_HIGHWAY_3 skipped).
7. Player, objects, effects.
8. Lens flare, HUD.

**Clear colour** is `gBgColor`, RGBA5551: `r = ((c>>11)&31)·8, g = ((c>>6)&31)·8, b = ((c>>1)&31)·8`. It is black on space levels and the environment record's value on planet levels, apart from the code overrides in *Fog, lights, clear colour, camera*.

##### Planet backdrop (camera-space quad)

- **Geometry:** one quad, x ±3640, y 0..8680, z 0 (TRI2), with a 64×32 RGBA16 texture (SETTILESIZE 63×31), except BM03_BG02 (D_VE2_60038E0) and Versus Corneria (D_versus_302D4D0), which use 32×32 tiles. The quad shape is identical on every planet backdrop (**verified**, 14 lists).
- **State:** preset 17 (no Z, no fog, no lighting; render mode AA_OPA_SURF, decal combiner). **Verified** in the emulator: geometry mode 0, rmL 0x00552048.
- **Placement:** in view space, without the look-at, drawn twice side by side (second copy at +7280 in x). Decomp formulas, with captured matrices below.
  - Corneria, Venom 1, Fortuna, Katina, Venom 2, Versus:
    ```
    RotZ(camRoll) · T(xs, −2000 + yb [−2000 more on Fortuna, −2500 more on Katina], −6000)
    yb = camPitch(rad)·(−6000) − eye.y·(0.6 Corneria/Venom 1; 0.4 Fortuna/Katina/Venom 2/Versus)
    xs = fmod(yawDeg·(−7280/360)·5, 7280)
    ```
  - Titania, Macbeth, Zoness, Solar, Aquas (intro only):
    ```
    RotZ(camRoll) · S(1.5, 1, 1) · T(xs, yoff + yb, −7000)
    yoff = −3000 Titania/Zoness, −3500 Solar, −4000 Macbeth, 0 Aquas
    yb = camPitch·(−7000) − eye.y·0.6
    xs = fmod((yawDeg − player.yRot)·(−80.89), 7280)
    ```
    The second copy is at ±7280 (10920 world units with the 1.5 x scale).
  - Captured matrices (**verified**):
    - Corneria: T(0, −1935, −6000) and T(7280, −1935, −6000);
    - Katina: T(∓3640, −4483, −6000);
    - Titania: T(0 / −10920, −4327, −7000) with scale (1.5, 1, 1).

| level | backdrop DL | texture | wrap s/t | leak name |
|---|---|---|---|---|
| Corneria | D_CO_60059F0 | 0x06005A80 | wrap/clamp | CN_BG (texture `CN_BG_test_txt`) |
| Venom 1 | D_VE1_60046F0 | 0x06004780 | clamp/clamp | BM_BG |
| Venom 2, Venom Andross (modes 2/7) | D_VE2_600F670 | 0x0600F700 | clamp/clamp | BM03_BG |
| Venom Andross (modes 3/4, preset 62, prim tint) | D_VE2_60038E0 | 0x06003970 | | BM03_BG02 |
| Fortuna | D_FO_600D9F0 | 0x0600DA88 | clamp/clamp | FO_BG |
| Katina | D_KA_600F1D0 | 0x0600F260 | clamp/clamp | KT_BG |
| Macbeth | D_MA_6019220 | 0x060192B0 | clamp/clamp | MC_BG |
| Titania | D_TI_6000A80 | 0x06000B10 | clamp/clamp | TIJ_BG |
| Zoness | D_ZO_6013480 | 0x06013510 | clamp/clamp | ZO_BG |
| Solar | D_SO_601E150 | 0x0601E1E8 | clamp/clamp | SN_BG |
| Aquas (intro) | D_AQ_601AFF0 | 0x0601B080 | clamp/clamp | AC_BG |
| Versus Corneria / Katina / other | D_versus_302D4D0 / 30146B0 / 3011E40 | 0x0302D568 / 0x03014740 / 0x03011ED0 | | VS_BG |

- **Corneria UVs** (s10.5): s 0..2047 per copy; t −1304 at the top (y 8680) to 2144 at the bottom (y 0). The texture therefore covers quad y ≈ 2820..5397, and clamping repeats its edge rows above and below. Other levels: read the UVs from each display list's vertices.
- **Window at the in-level camera:**
  - Corneria (eye y 578, pitch −0.07 rad): texel rows 12.2 at the top of the screen to 73.9 at the bottom, i.e. v ≈ 0.38..2.31 with t clamped. Ground covers the lower part.
  - Katina (eye y 485): v ≈ −0.62..1.31.
  - Visible width at z 6000 with fovy 45 and 4:3: 6627 units, so u1 = 0.91.
  - These windows are computed, not pixel-matched (hypothesis).

##### Space backdrops (sprites)

- **Visibility:** drawn only while the camera yaw is within ±45° and pitch within ±40° of straight ahead.
- **Matrix:** `RotZ(starfieldRoll) · T(bgX − 120, −(bgY − 120), −290) · S(k)`, preset 36 unless listed. `bgX`/`bgY` are the starfield scroll values (0..480, 0..360; *Starfield*) plus per-level offsets.
- **Scale:** at z −290 with fovy 45 the half-height is 120.1, so **1 unit ≈ 1 pixel** of the 320×240 screen.

| level | DL | scale | preset / prim alpha | notes |
|---|---|---|---|---|
| Sector X | D_SX_6029890 (texture 0x06029918, 32×32 clamp) | 3.0 | 62 / 192 | only while gSceneSetup = 0 |
| Sector Y | D_SY_6001840 (400×400, texture 64×32) | 0.4 | 62 / 192 | **verified**: T(−60, 20, −290) S 0.4 |
| Area 6, UNK_4 | D_A6_601BB40 (8 × 64×32 textures: Venom planet) | (0.5 + progress·0.00004, max 3.5)·0.75 | 36 | leak SB_BG_01 |
| Meteo | D_ME_600DDF0 (8 × 32×64 textures AS_BG0..7) | 0.4 / 0.5 | 36 | only when gPathProgress > 185668 or at level complete |
| Bolse | D_BO_600D190 | 1.0 / 1.3 | 36 | |
| Sector Z | aSzBackgroundDL D_SZ_6002F80 (texture 0x06003010) | 0.5, RotX 90° | 36 | |
| Training | aTrBackdropDL 0x06003760 (Corneria planet) | 0.2 | 62 / 255 | Training is treated as space for the backdrop |
| Fortuna (space ending) | D_FO_600B4B0 | 1.5 / 0.75 | 36 | |
| Warp zone | D_WZ_7001540 (ast_warp_zone) | 1.7, wobbling | 62 / gWarpZoneBgAlpha | |

##### Starfield

Decomp `Background_DrawStarfield`, `Play_GenerateStarfield`; counts **verified** in RAM.
- **Stars:** `gStarCount` 1×1 FILLRECTs.
- **Colours:** `gStarColors[i % 16]` (RGBA5551): {108B, 108B, 1087, 1089, 39FF, 190D, 108B, 1089, 294B, 18DF, 294B, 1085, 39FF, 108B, 18CD, 108B}.
- **Positions:** `Rand_SetSeed(1, 29000, 9876)`, then 1000 × (x ∈ [−80, 400), y ∈ [−60, 300)).
- **Motion:** scrolled by camera yaw and pitch (`x = fmod(yawRad·(−8/3)·RTOD·2 + 3000, 480)`), rotated by camera roll.
- **Counts:** 600 by default; Area 6 300, Bolse 300, Fortuna 500 (space ending), Training 800, UNK_15 400, planet levels and Versus 0.

##### Ground rendering details

These complement *Terrain and ground planes*. **Verified** in the emulator for Corneria and Katina; the rest is decomp.
- **Visibility:** the ground is skipped when the eye is above y 4000 (except Venom 2) or `gDrawGround` = 0.
- **Height:** it is drawn at **y ≈ −3**.
- **On-rails quad pair:**
  - 6 vertices, x ±4000, z −6000..6000, y 0, normals (0,120,0);
  - drawn at T(0,0,∓3000)·S(1,1,0.5), with call translations 5985 apart (**verified**);
  - UVs s 0..20947 over 8000 units and t 10474 per 6000 model z. With the 32×32 tile that is a **texture period of 391 world units in x and 293 in z**.
- **All-range Corneria tile** D_CO_601EAA0: 5×5 grid at 3000 spacing, UV period 3000 units.
- **No-depth ground:** preset 20 draws with no depth test or write on Corneria, Katina, Fortuna, Venom 2, Versus and the Aquas floor (**verified** Corneria and Katina: geometry mode 0x032204). The ground never occludes scenery. The viewer should draw it first, with depth write off.
- **Solar and Zoness surfaces:**
  - 17×17 vertex grids: Solar D_SO_6001C50 / D_SO_6004500, Zoness D_ZO_6009ED0 / D_ZO_600C780.
  - The stored vertices all have y = 0 (**verified**). The waves are computed every frame by `Play_UpdateDynaFloor` (decomp `fox_play.c`), so a static render either ports it for one frame or shows a flat surface.
  - `Play_InitLevel` moves the edge vertices from ±800 to **±1400** (decomp), so under S(3,2,3) the grid covers x and z ±4200 around the path.
  - Draw lists: Solar D_SO_60005B0 (alternating with D_SO_6002E60), Zoness D_ZO_6008830 (alternating with D_ZO_600B0E0). Textures: Solar 0x06005710; Zoness 0x0600D990, animated by HUD_Texture_Wave from D_ZO_602C2CC. Apply the edge move before rendering.
- **Aquas water surface:** D_AQ_602AC40 at y = 1600 (D_bg_8015F970 at init), Scale(2,1,0.5), preset 37 with prim alpha 128, translucent and fogged.

#### File formats

**Locations.** The three audio files are byte-identical in V1.0 and V1.1; the leak's built `audio/fox64_{music,banks,table}.o` .data is md5-identical to them (**verified**).

| data | V1.1 ROM | V1.0 ROM | size |
|---|---|---|---|
| audio_seq (DMA 3) | 0xDEA20 | 0xDA030 | 0x3ACF0 |
| audio_bank (DMA 4) | 0x119710 | 0x114D20 | 0x1E020 |
| audio_table (DMA 5) | 0x137730 | 0x132D40 | 0x73C580 |
| sample-bank table (main) | 0xC4210 | 0xBFD90 | 0x50 |
| sequence table | 0xC4260 | 0xBFDE0 | 0x430 |
| soundfont table | 0xC4690 | 0xC0210 | 0x220 |
| sequence → font map | 0xC48B0 | 0xC0430 | 283 |
| gAudioSpecs | 0xC82B8 | 0xC3E38 | 29 × 0x30 |
| note_data tables | 0xDD310 | 0xD8920 | |
| sSoundTestTracks | 0xC6AE4 | 0xC2664 | 45 × 6 |

A loader can find the tables by structure: the sample-bank table header has n = 4 and contiguous entries, and the sequence and font tables follow it. That works for both versions (`mus/proto/sf64audio.ts findTables`).

**AudioTable** (sequences, fonts, sample banks). **Verified**; the lead re-checked the sequence table: 66 entries, 20 aliases, extents tile audio_seq exactly.
| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | s16 | numEntries | Entry count. |
| 0x02 | 2 | s16 | unknown02 | Unknown. |
| 0x04 | 4 | u32 | romAddr | Zero; add the file's ROM start. |
| 0x08 | 8 | u8[8] | padding | Padding. |
| 0x10 | 16 × numEntries | AudioTableEntry[] | entries | Entry records below. |

AudioTableEntry, 16 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | offset | Offset or alias sequence id. |
| 0x04 | 4 | u32 | size | Byte count; zero marks an alias. |
| 0x08 | 1 | s8 | medium | 2 is cartridge. |
| 0x09 | 1 | s8 | cachePolicy | Cache policy. |
| 0x0A | 6 | s16[3] | shortData | Type-specific metadata. |

- **Sequences:** 66 entries. `size == 0` marks an alias: `offset` is then another sequence id.

  | alias ids | target |
  |---|---|
  | 11 | 9 |
  | 15 | 10 |
  | 16 | 4 |
  | 21, 22, 26 | 18 |
  | 20, 23, 24, 27, 30, 32, 48 | 19 |
  | 29, 31 | 28 |
  | 41 | 34 |
  | 52, 53 | 37 |
  | 57 | 56 |
  | 59 | 43 |

  That leaves 46 distinct sequences: SFX, voice, and 44 music.
- **Fonts:** 33 entries. `shortData1 = sampleBank1<<8 | sampleBank2` (0xFF = none); `shortData2 = numInstruments<<8 | numDrums`.
- **Sample banks:** 4 entries.

  | bank | contents | offset | size |
  |---|---|---|---|
  | 0 | SFX | 0x000000 | 0x0E1E30 |
  | 1 | map | 0x0E1E30 | 0x0FF9D0 |
  | 2 | voice | 0x1E1800 | 0x497480 |
  | 3 | music instruments | 0x678C80 | 0x0C3900 |

**Sequence → font map.** Offsets are relative to the table start.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 132 | u16[66] | offsets | One list offset per sequence. |

Each referenced list is:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 1 | u8 | count | font count. |
| 0x01 | count | u8[] | fontIds | font identifiers. |

 Every music sequence has exactly one font. The player's default font is the last one listed.

| font | sequences |
|---|---|
| 21 | 34, 35, 37-40, 44, 45, 49-51, 54-56, 60, 64 |
| 22 | 36 |
| 23 | 42 |
| 24 | 2, 10 |
| 25 | 4, 7, 8, 13, 43, 47, 61-63 |
| 26 | 5 |
| 27 | 58 |
| 28 | 6, 12, 17, 18 |
| 29 | 3, 9, 46 |
| 30 | 14 |
| 31 | 19, 25, 28, 65 |
| 32 | 33 |

Aliases inherit their target's font.

**Soundfont** (offsets relative to the font start in audio_bank). **Verified**: 33 fonts, 941 instruments, 479 drums and 1732 sample references all land in bounds, and font and bank extents tile their files.
Font, four-byte header and instrument offsets:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | drumListOffset | Drum-list offset, zero if absent. |
| 0x04 | 4 × numInstruments | u32[] | instrumentOffset | Instrument offsets; zero means empty. |

Drum list:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 × numDrums | u32[] | drumOffset | Drum offsets. |

Tuned sample, eight bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | sampleOffset | Sample offset. |
| 0x04 | 4 | f32 | tuning | Pitch multiplier. |

Instrument, 0x20 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 1 | u8 | isRelocated | Relocation flag. |
| 0x01 | 1 | u8 | normalRangeLo | Low bound of normal range. |
| 0x02 | 1 | u8 | normalRangeHi | High bound of normal range. |
| 0x03 | 1 | u8 | releaseRate | Release rate. |
| 0x04 | 4 | u32 | envelopeOffset | Envelope offset. |
| 0x08 | 8 | TunedSample | low | Low-range sample, when present. |
| 0x10 | 8 | TunedSample | normal | Normal-range sample. |
| 0x18 | 8 | TunedSample | high | High-range sample, when present. |

Drum, 0x10 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 1 | u8 | releaseRate | Release rate. |
| 0x01 | 1 | u8 | pan | Pan. |
| 0x02 | 1 | u8 | isRelocated | Relocation flag. |
| 0x03 | 1 | u8 | padding | Padding. |
| 0x04 | 8 | TunedSample | sample | Drum sample and tuning. |
| 0x0C | 4 | u32 | envelopeOffset | Envelope offset. |

Sample, 0x10 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | flagsAndSize | Codec bits 31–28, medium 27–26, relocation 24, size 23–0. |
| 0x04 | 4 | u32 | sampleOffset | Sample-data offset. |
| 0x08 | 4 | u32 | loopOffset | Loop offset. |
| 0x0C | 4 | u32 | bookOffset | Predictor-book offset. |

AdpcmLoop, 0x10 bytes without history or 0x30 with history:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | start | Loop start. |
| 0x04 | 4 | u32 | end | Exclusive loop end. |
| 0x08 | 4 | u32 | count | Loop count. |
| 0x0C | 4 | u32 | padding | Padding. |
| 0x10 | 0x20 if count ≠ 0 | s16[16] | predictorState | Conditional decoder history. |

AdpcmBook:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | s32 | order | 2. |
| 0x04 | 4 | s32 | numPredictors | 2 or 4. |
| 0x08 | 16 × order × numPredictors | s16[] | book | Predictor coefficients. |

Envelope point, four bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | s16 | delay | Positive ramps; 0 ends; −1 hangs; −2 jumps; −3 restarts. |
| 0x02 | 2 | s16 | arg | Target or branch argument. |

- **Pitch:** `freq = gPitchFrequencies[note] · tuning`. gPitchFrequencies[39] = 1.0 = C4, i.e. 2^((n−39)/12).
- **VADPCM:** 9-byte frames make 16 samples, decoded exactly as the RSP does (the viewer's `decodeVadpcm`).
- **Loops:** play [0, end), then jump to start with the decoder history loaded from `predictorState`. predictorState equals the decoded samples of the frame containing `loop.start` (**verified** 56/56 looped samples, both versions). That is the convention libultra.ts `prepareWave` already implements.
- **Code tables** in note_data, used by the renderer (offsets from the note_data base):

  | Offset | Size | Type | Field | Description |
  |---:|---:|---|---|---|
  | 0x000 | 0x20 | u32[8] | wavePointers | RAM wave pointers; vibrato uses sine. |
  | 0x020 | 0x400 | f32[256] | bendOctave | Octave pitch-bend factors. |
  | 0x420 | 0x400 | f32[256] | bendTwoSemitones | ±2-semitone pitch-bend factors. |
  | 0x820 | 0x200 | f32[128] | pitchFrequencies | Pitch frequencies. |
  | 0xA40 | 12 | EnvelopePoint[3] | defaultEnvelope | Points (4,32000), (1000,32000), (−1,0); four-byte record defined above. |
  | 0xB70 | 0x200 | f32[128] | panDefault | Cosine-like; entries 0=1, 64=0.70272, 127=0. |
  | 0xD70 | 0x200 | f32[128] | panTable1 | Additional pan curve. |
  | 0xF70 | 0x200 | f32[128] | panTable2 | Additional pan curve. |

### 3.3 Geometry

### 3.4 Display lists and render state

#### Render state set by game code

Each object is drawn after `RCP_SetupDL(preset)` from `gRcpSetupDLs[88]` (V1.1 0x800D31B0; 72 bytes per entry; decoded from the ROM; **identical in both versions**). Every preset is:
```
PipeSync; clear all geometry modes; gSPTexture(on/off); SetCombine; SetGeometryMode; alpha compare none; render mode; othermode H; EndDL
```
`RCP_SetupDL_29(r,g,b,a,near,far)` and the other variants add `gDPSetFogColor` + `gSPFogPosition` (decomp).

| preset | geometry mode | combiner (w0 w1) | render mode | used for |
|---|---|---|---|---|
| 20 | SHADE SMOOTH CULL_BACK FOG LIGHTING (no Z) | FC127FFF FFFFF238 (MODULATEIDECALA) | C8112048 (FOG_SHADE_A / AA_OPA_SURF2) | ground planes (drawn first) |
| 29 | ZBUFFER SHADE SMOOTH CULL_BACK FOG LIGHTING | FC127FFF FFFFF238 | C8112078 (AA_ZB_OPA_SURF2) | default: scenery, actors, bosses, Titania ground |
| 34 | ZBUFFER SHADE SMOOTH CULL_BACK FOG | FC11FFFF FFFFF638 (MODULATEI_PRIM) | C8112078 | Fortuna base part, warp props |
| 37 | SHADE SMOOTH FOG | FC1197FF FFFFFE38 (MODULATEIA_PRIM) | C81041C8 (AA_XLU_SURF2) | Aquas water surface |
| 45 | ZBUFFER … CULL_BACK FOG LIGHTING | FC127E03 FF0FF3FF | C81049D8 (AA_ZB_XLU_SURF2) | Corneria water ground |
| 47 | ZBUFFER SHADE SMOOTH FOG | FC1197FF FFFFFE38 | C81049D8 | shadows, Aquas |
| 57 | ZBUFFER … CULL_BACK FOG LIGHTING | FC127FFF FFFFF238 | C8113078 (AA_ZB_TEX_EDGE2) | cut-out scenery |
| 60 | ZBUFFER SHADE SMOOTH FOG (unlit, no cull) | FCFFFFFF FFFCF238 (DECALRGBA) | C8113078 | sprites (trees, poles, cacti) |

- **Othermode H:** 2CYCLE, PERSP, BILERP (`00182C00` for 29/34/57/60).
- **Lighting:** presets 20/29/45/57 enable G_LIGHTING, so scenery vertex colours are **normals**. The colour is ambient + light·max(0, N·L) with the environment record's light and ambient.
- **Light direction:** `Camera_SetupLights` rotates the record's light angles by the camera's yaw, pitch and roll every frame (runtime detail in *Fog, lights, clear colour, camera*). Bosses add a second light.
- **Full dump** of all 88 presets: `lv/proto/presets_v11.txt`.

#### Display lists

- **`runDisplayList` options:**
  - `ucode: 'f3dex'`, `vertexScale: 1`, `mirrorX: false`;
  - `geometryMode: 0`, because the preset sets it;
  - `combiner: true`, `decals: true`;
  - `lighting` from the environment record;
  - `resolve` = segment resolver.
- **State:** SF64 object lists carry no render state (*Display lists, vertices, textures*). Build a small wrapper list for each drawn object in a scratch area appended to the buffer, and let `resolve` map it:
  1. `G_DL(push) → gRcpSetupDLs[preset]` (a main address);
  2. any recipe commands: `G_CLEARGEOMETRYMODE(G_CULL_BACK)`, `G_SETPRIMCOLOR`, point filter;
  3. `G_DL(push) → object list`;
  4. `G_ENDDL`.

  The prototype does exactly this with the unmodified `displaylist.ts` (**verified**).
- **Ground textures:** synthesise `G_SETTIMG`, `G_SETTILE`, `G_LOADBLOCK`, `G_SETTILESIZE` for the 32×32 tile (`gDPLoadTileTexture` + `gDPSetupTile` encoders in `lv/proto/decode.ts`, **verified** to decode correctly).
- **Changes needed in `displaylist.ts`:** none for geometry and textures. Optional:
  - (a) texture filter mode from `G_SETOTHERMODE_H` (G_TF_POINT on the Fortuna base and warp props). This needs a new `Batch.pointFilter?` (or `Texture.filter`) field: `types.ts` has none, and the renderer's filter is global;
  - (b) translucent presets 37/41/45/47 (Aquas water, Corneria water, Bolse shield) need nothing beyond emitting `G_SETPRIMCOLOR` in the wrapper. With `combiner: true` the fold already applies prim alpha (alpha = TEXEL0 × PRIM for presets 37 and 45), and render modes C81049D8 and C81041C8 are detected as `'blend'`. Preset 41: Z, combiner FC119623 FF2FFFFF, render mode 0x005049D8.
- **Lighting.** The game uses one directional light plus ambient on lit presets (*Render state set by game code*). Two options:
  - **Bake:** run per instance with `matrix` and `lighting` in world space. This is correct shading without instancing; the prototype does it.
  - **Normals:** extend `displaylist.ts` to emit per-vertex normals for `G_LIGHTING` batches and light them in the renderer. This is faster for big levels, but needs a new `Batch.normals?: Int8Array` field.

  Either way the colours are unlit normals unless lighting is applied: presets 20/29/45/57 have G_LIGHTING, so vertex colour bytes are normals. The light-direction convention is in *Fog, lights, clear colour, camera*.

### 3.5 Textures and materials

#### Display lists, vertices, textures

- **Microcode:** F3DEX 1.x, "F3DEX.NoN 1.22". **Verified**: the ID string is in main; opcodes decode consistently (G_VTX 0x04, G_TRI1 0xBF, G_TRI2 0xB1, G_ENDDL 0xB8). The leak's spec links `gspF3DEX.NoN.fifo.o`.
- **Vertices:** standard 16-byte `Vtx` records:

  | Offset | Size | Type | Field | Description |
  |---:|---:|---|---|---|
  | `0x00` | 6 | `s16[3]` | `position` | X, Y, Z. |
  | `0x06` | 2 | `u16` | `flag` | Vertex flag. |
  | `0x08` | 4 | `s16[2]` | `texcoord` | S, T. |
  | `0x0C` | 3 | `u8[3]` | `colorOrNormal` | RGB or signed normal XYZ. |
  | `0x0F` | 1 | `u8` | `alpha` | Alpha. |
- **What object lists contain.** Opcode histogram over all placed scenery lists of 13 levels (`lv/proto/dlscan.ts`, **verified**): `04 B1 BF B8 BA E6 E7 E8 F0 F2 F3 F5 FD` only.
  - Present: geometry, `gDPLoadTextureBlock`-style uploads (SETTIMG/SETTILE/LOADBLOCK/SETTILESIZE), `G_LOADTLUT` and TLUT-mode changes.
  - Absent: G_DL calls, matrices, geometry-mode, combiner or render-mode commands, BRANCH_Z.
  - **All render state comes from a preset the game calls first** (*Render state set by game code*).
- **Texture formats:** RGBA16 in most lists, CI4 and CI8 with RGBA16 TLUTs, IA8, IA16 and I (effects, title cards).
- **Filtering and wrap:** bilinear by default (the presets set G_TF_BILERP). Some lists and recipes switch to G_TF_POINT, e.g. the Fortuna base and warp props. Wrap comes from each list's SETTILE.
- **Code-built textures:** ground planes are textured by game code with `gDPLoadTileTexture` + `gDPSetupTile`, and a loader must synthesise those commands (*Terrain and ground planes*).
- **Viewer support:** everything in these lists is already handled by `displaylist.ts`. **Verified**: the prototype runs all lists through the unmodified `runDisplayList` with no unknown commands, and CI4/CI8 textures decode correctly.

### 3.6 Collision

### 3.7 Environment, sky, fog, and lighting

#### Environment

| game | `types.ts` | how |
|---|---|---|
| clear colour | `clearColor` | RGBA5551 → RGB from the effective colour in *Fog, lights, clear colour, camera*: Corneria (8,8,16), Zoness (64,32,24), space (0,0,0) |
| fog | `Fog` | `{color: record RGB (warp zone override), multiplier: trunc(128000/(far−near)), offset: trunc((500−near)·256/(far−near)), near: 10, far: 12800 (30000 Katina, Sector Z)}`. World units match the geometry (1 vertex unit = 1 world unit; captured modelviews have scale 1.00) |
| planet backdrop | `Backdrop` | texture = the level's backdrop texture (64×32; 32×32 for BM03_BG02 and Versus Corneria), u0 0, u1 0.91 (wrap), v window from *Planet backdrop (camera-space quad)* at the start camera, no tint. Approximate: the game's window follows camera height and pitch, and clamps v |
| space backdrops | – | skip, or add a screen sprite (below) |
| starfield | – | skip, or add a point layer (below) |
| ground | `meshes` + `instances` | generated strip or plane at y −3 (*Terrain and ground planes*, *Ground rendering details*): on-rails x ±4000 around each route's x along the level, UV period 391 × 293 units; all-range 24000 × 24000 tiles around the origin with the tile list's UVs. Corneria texture per z section (*Terrain and ground planes*). Batches with `depthWrite: false`, drawn first, for Corneria, Katina, Fortuna, Venom 2, Versus and the Aquas floor. Corneria's water sections are the exception: preset 45 is z-buffered and translucent, drawn after objects, over a mirrored copy of the objects |
| Solar / Zoness surface | mesh | the 17×17 grid with edges moved to ±1400, under S(3,2,3), tiled along the path; flat unless `Play_UpdateDynaFloor` is ported for one frame |
| Aquas water | mesh | translucent quad (alpha 128) at y 1600, Scale(2,1,0.5), `blend` |
| camera | `camera` | start eye and target from *Fog, lights, clear colour, camera*, fovY 45. For on-rails levels, place the eye at z = eyeZ (path progress 0) |
| lights | – (baked) | directional light `RotX(rx)·RotY(ry)·RotZ(rz)·(0,0,1)`, colour = record light, ambient = record ambient. Either baked into vertex colours through `runDisplayList`'s `lighting` option (world space, per instance) or a new `Level.light` |

**Proposed minimal `types.ts` extensions** (all optional; the level renders without them):
1. `Backdrop.clampV?: boolean`, since the game's backdrops wrap in u, clamp in v and use windows outside [0,1]. Better still, a camera-space sky quad `{texture, width 7280, height 8680, viewZ −6000, yOffset, uvs}` drawn ignoring camera rotation, as the game does.
2. A per-batch or per-mesh "draw first, no depth" flag for grounds, like `Sky` but with fog and camera translation.
3. `Level.light?: {dir, color, ambient}`, if the renderer should shade lit geometry itself.
4. `Level.starfield?: {count, seed, colors}` and `ScreenSprite {texture, center, size, alpha}` for space backdrops.
5. `Batch.normals?: Int8Array` for renderer-side lighting (*Display lists*).
6. `Batch.pointFilter?: boolean` (or `Texture.filter`) for G_TF_POINT lists (*Display lists*).

#### Environment and reference screenshots

| claim | evidence |
|---|---|
| Environment records = RAM, per level | 25 RDRAM dumps `rt/dumps/*_a.bin` (+ `.task`), `rt/envread.sh`, `rt/env/*.txt`, `rt/table.txt`; static ROM extraction |
| Clear, fog, projection, lights, presets, culling in real frames | frame display lists captured at `Graphics_SetTask` (`rt/capture.sh`), walked by ROM analysis / ROM analysis → `rt/dl/*.txt` |
| Backdrop, ground and water display lists, UVs | ROM analysis |
| Render presets = leak | ROM 0xD3DB0 vs leak `Source/fox_std_rcp.o` `fox_gsCPModeSet_Data` (0x18C0 bytes, 0 of 1584 words differ) |
| Level switching and crash analysis | `rt/goto.sh`, `rt/dumps/crash_sx.bin`, `rt/log.txt` |
| V1.0 environment | `rt/dumps/v10_corneria.bin` |

**Reference screenshots** (`shots/`, described in `shots/index.md`; 320×240, V1.1 unless marked):

| group | shots |
|---|---|
| menus | title, main menu, Lylat map |
| on-rails | Corneria (intro, 2 in level), Meteo, Sector X, Area 6, Sector Y, Venom 1, Solar, Zoness, Venom Andross, Training, Macbeth, Titania, Aquas |
| all-range and special | Meteo warp zone, Venom Andross phase 1, Fortuna, Katina, Bolse, Venom 2, Versus Corneria (4-way) |
| unused | UNK_4 (level 4) |
| V1.0 | Lylat map, Corneria intro, 2 Corneria in-level |

There is no Sector Z shot; the candidate frames are in `rt/cand/`. Prototype renders for comparison are in `lv/renders/`, and the lead compared Corneria, Fortuna and Titania qualitatively (*Levels*).

#### Environment

- The planet backdrop's vertical texture window is computed from the decomp formulas, not pixel-matched against a screenshot.
- The exact composition order of the world-space light vector. It is consistent with RAM on Corneria only.
- Which code writes the Aquas light colours at run time: RAM (30,70,90)/(15,22,37) matches neither record.
- Warp zone: whether the missing colour FILLRECT is the motion-blur path.
- The V1.0 addresses of the level-poke variables are assumed to be V1.1 − 0xA190, untested. V1.0 was only reached through the menus.
- Not captured: Versus Sector Z stage, Venom 2 phase 2, the Andross escape overrides.
- Bolse's dynamic ground (`Bolse_DrawDynamicGround`) is not decoded.
- Sector Z has no usable reference screenshot (mission card or plain starfield); its environment and display-list data were captured.
- Whether the unused Corneria sky quad D_CO_602ECB0 is referenced from any data table. Only code was checked.

### 3.8 Cameras and paths

#### Fog, lights, clear colour, camera

**Environment record**, 0x44 bytes, usually immediately before the level's main placement list (not on Macbeth or Titania); locate it through the pointer table below. The leak calls it `Stage_Data`. **Verified** by decode for all levels (`lv/proto/dump.txt`):
| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `+0x00` | 4 | `s32` | `type` | 0 planet, 1 space |
| `+0x04` | 4 | `s32` | `groundType` | — |
| `+0x08` | 2 | `u16` | `bgColor` | (encoding: see below) |
| `+0x0A` | 2 | `u16` | `seqId` | BGM |
| `+0x0C` | 12 | `s32[3]` | `fogR, fogG, fogB` | — |
| 0x18 | 4 | s32 | fogNear | gSPFogPosition near value, e.g. 996. |
| 0x1C | 4 | s32 | fogFar | gSPFogPosition far value, e.g. 1000. |
| `+0x20` | 12 | `f32[3]` | `lightRot x, y, z   degrees` | — |
| `+0x2C` | 12 | `s32[3]` | `lightR, lightG, lightB` | — |
| `+0x38` | 12 | `s32[3]` | `ambR, ambG, ambB` | — |
Example, Corneria: type 0, fog (25,35,56) 996-1000, lightRot (−80,60,0), light (160,150,150), ambient (15,20,20).

Extra records: Aquas has a second one at +0x44 (ast_aquas+0x2E584: light 255,255,255, ambient 20,20,20), used on the first start of the level (intro), with +0x2E540 on restarts (decomp `Play_InitEnvironment`); Versus has three.

**At run time.** `Play_InitEnvironment` copies the record into globals at level start. RAM matched the stored record on every level entered (**verified** in the emulator, `rt/env/*.txt`, `rt/table.txt`). The leak's `Source/*_data.o` `XX_Stage_Data` bytes are identical (**verified**).

The pointer table `D_800D2F98[21]` is at V1.1 ROM 0xD3B98 (**verified** contents):
```
06037160 06026C80 0602A120 06023F20 06028760 0602E4B0 06007E30 0601F1F0 060266D0 0C035110
06006A60 06030E30 06005000 0602E540 0600EA90 00000000 06011000 0600FF30 06006E70 06014D50 0302DD70
```
- Venom Andross uses segment C (ast_andross+0x35110).
- Versus uses ast_versus at 0x2DD70, 0x2DDB4 and 0x2DDF8 for stages 0/1/2 (by `gVersusStage`).
- Aquas uses +0x2E584 on first start and +0x2E540 afterwards.

**Per-level values.** All read in RAM and equal to the record except the overrides below. Clear colours are given as RGB of the effective colour.

| level | record | type | ground | clear (effective) | fog RGB | fog near/far | light RGB | ambient | light rot | stars |
|---|---|---|---|---|---|---|---|---|---|---|
| Corneria | ast_corneria+0x37160 | planet | 0 | (8,8,16) grass / (24,32,56) water | 25,35,56 | 996/1000 | 160,150,150 | 15,20,20 | −80,60,0 | 0 |
| Meteo | ast_meteo+0x26C80 | space | 0 | black | 0,0,0 | 995/1000 | 255,200,150 | 15,10,0 | −59,58,13 | 600 |
| Meteo warp (phase 1) | same | space | 0 | black (blur) | **178,190,90** | 995/1000 | **200,200,120** | **0,50,100** | −59,58,13 | 600 |
| Sector X | ast_sector_x+0x2A120 | space | 0 | black | 0,0,0 | 990/1000 | 176,140,54 | 42,10,21 | −59,58,13 | 600 |
| Area 6 | ast_area_6+0x23F20 | space | 0 | black | 0,0,0 | 995/1000 | 100,90,50 | 20,0,15 | −59,58,13 | 300 |
| UNK_4 | ast_area_6+0x28760 | space | 0 | black | 0,0,0 | 995/1000 | 86,58,25 | 11,8,24 | −59,58,13 | 600 |
| Sector Y | ast_sector_y+0x2E4B0 | space | 0 | black | 0,0,0 | 995/1000 | 200,200,200 | 0,10,10 | −59,58,13 | 600 |
| Venom 1 | ast_venom_1+0x7E30 | planet | 12 | black | 0,0,0 | 996/1000 | 137,160,10 | 15,10,0 | −80,60,0 | 0 |
| Solar | ast_solar+0x1F1F0 | planet | 10 | black | 255,255,143 | 996/1000 | 72,29,0 | 46,0,0 | −80,40,0 | 0 |
| Zoness | ast_zoness+0x266D0 | planet | 11 | (64,32,24) | 0,10,10 | 996/1000 | 90,100,50 | 10,20,0 | −106,−5,0 | 0 |
| Venom Andross | ast_andross+0x35110 | planet | 12 | black | 0,0,0 | 996/1000 | 255,80,20 | 10,0,20 | −80,60,0 | 0 |
| Training | ast_training+0x6A60 | planet (space backdrop) | 11 | black | 0,0,0 | 996/1000 | 200,200,200 | 40,40,40 | −106,−5,0 | 800 |
| Macbeth | ast_macbeth+0x30E30 | planet | 13 | (104,80,72) | 45,46,67 | 995/1000 | 100,70,60 | 35,35,38 | −106,30,0 | 0 |
| Titania | ast_titania+0x5000 | planet | 4 | (32,16,32) | 126,18,5 | 990/1000 | 134,138,67 | 11,34,47 | −80,60,0 | 0 |
| Aquas | ast_aquas+0x2E540 | planet | 1 | black | 0,0,0 | 995/1000 | 40,100,120 (RAM 30,70,90) | 20,30,50 (RAM 15,22,37) | −59,58,13 (RAM y 90) | 0 |
| Fortuna | ast_fortuna+0xEA90 | planet | 3 | (88,96,120) | 185,176,112 | 996/1000 | 101,88,62 | 3,27,50 | −80,60,0 | 0 |
| Katina | ast_katina+0x11000 | planet | 3 | (168,176,152) | 44,35,36 | 996/1000 | 100,70,50 | 20,10,10 | −80,60,0 | 0 |
| Bolse | ast_bolse+0xFF30 | space | 0 | black | 0,0,0 | 995/1000 | 200,80,110 | 150,30,30 | −80,60,0 | 300 |
| Sector Z | ast_sector_z+0x6E70 | space | 0 | black | 0,0,0 | 995/1000 | 150,150,150 | 30,10,0 | −20,60,0 | 600 |
| Venom 2 | ast_venom_2+0x14D50 | planet | 12 | black | 0,0,0 | 996/1000 | 130,160,10 | 60,0,0 | −80,60,0 | 0 |
| Versus Corneria | ast_versus+0x2DD70 | planet | 6 | (136,240,240) | 144,200,255 | 996/1000 | 160,150,70 | 15,12,30 | −80,60,0 | 0 |
| Versus Katina | ast_versus+0x2DDB4 | planet | 6 | (168,176,152) | 44,35,36 | 996/1000 | 100,70,50 | 20,10,10 | −80,60,0 | 0 |
| Versus Sector Z | ast_versus+0x2DDF8 | space | 0 | (0,0,0) | 0,0,0 | 996/1005 | 86,58,25 | 11,8,24 | −59,58,13 | 0 |

Versus Sector Z comes from the record only; it was not captured.

**Overrides set by code** (decomp; **verified** where marked):
- **Corneria clear colour** follows the ground surface every frame: 0x0845 = (8,8,16) on grass, rock and all-range; 0x190F = (24,32,56) on water (**verified**). The record's 0x1005 is never visible.
- **Zoness:** 0x4107 with the record's light (**verified**). Under the sea surface it switches to 0x0043, fog 990/994, light (0,7,10) and ambient 0.
- **Warp zone** (Meteo/Sector X phase 1): fog, light and ambient as in the table (**verified** for Meteo).
- **Versus** clear colours per stage: 0x8FBD, 0xADA7, 0x0001 (**verified** for stages 0 and 1).
- **Aquas:** light yaw is forced to 90/110 after the intro, and the light colours are changed by level code (RAM values above; the writer is unidentified).
- **Venom Andross escape:** fog 996/1007, clear 0x4081, far 30000 (not captured).
- **Titania cutscene:** clear 0x78C1 → 0x2089.
- **Far plane:** `gProjectFar` is 12800, raised to 30000 on Katina and Sector Z (**verified**) and in some cutscenes and events (Fortuna, Bolse, Macbeth, Sector X, Andross escape); 25000 at the Area 6 boss. **Viewer: 12800, or 30000 for Katina and Sector Z.**

**Projection** (**verified** from the captured PROJECTION matrix): `guPerspective(fovy 45, 4/3, near 10, far gProjectFar, scale 1)`, perspNorm 10. The camera look-at is baked into every modelview, and the viewport is full 320×240.

**Fog** is `gSPFogPosition(fogNear, fogFar)` on the 0..1000 scale, with `G_SETFOGCOLOR` = record RGB.
- Factors: `fm = trunc(128000/(far − near))`, `fo = trunc((500 − near)·256/(far − near))`.
- Emitted pairs (**verified**):

  | near/far | fm, fo |
  |---|---|
  | 996/1000 | 32000, −31744 |
  | 995/1000 | 25600, −25344 |
  | 990/1000 | 12800, −12544 |
  | 996/1005 | 14222, −14108 |
  | 990/1005 | 8533, −8362 |
  | 996/1002 | 21333, −21162 |
  | 995/1005 | 12800, −12672 |

- The player model uses (near, 1005); Katina actors also use (near, 1002).
- Fog applies to scenery, ground and most actors (G_FOG on 75-98 % of triangles). The backdrop, starfield and space sprites are unfogged.
- Where fog starts and saturates, in view depth:

  | near/far | far 12800 | far 30000 |
  |---|---|---|
  | 996/1000 | 2093 → 12549 | 2308 → 28657 |
  | 995/1000 | 1731 → 12488 | 1876 → 28340 |
  | 990/1000 | 928 → 12191 | 968 → 26854 |

**Lights** (decomp `Camera_SetupLights`, `Lights_SetOneLight`; **verified** consistent with RAM gLight1 on Corneria):
```
gLight1 = RotZ(camRoll)·RotX(−camPitch)·RotY(camYaw) · RotX(lightRotX)·RotY(lightRotY)·RotZ(lightRotZ) · (0, 0, 100)
```
- The RSP receives the light already rotated by the camera. In world space it is **`RotX(rx)·RotY(ry)·RotZ(rz)·(0,0,1)`**, with colour = record light RGB and ambient = record ambient; the exact composition order is hypothesis.
- `Lights_SetOneLight` puts the light in slots 0-3; slots 4-6 are black.
- The player uses light 2 with the same values.
- Water reflections flip light y.

**Camera start views.** Measured right after the player got control (**verified**, `rt/env/*.txt`); fovY 45.
- On-rails cameras live in path space. In placement world coordinates, eye z = eyeZ − gPathProgress (0 at start).
- All-range cameras are absolute.

| level | eye | target |
|---|---|---|
| Corneria | (329, 578, 400) | (329, 548, −1) |
| Meteo | (−855, 526, 400) | not recorded |
| Area 6, UNK_4, Training, Venom Andross | (0, 322, 400) | (0, 290, −1) |
| Sector X | (0, 182, 400) | (0, 150, −41) |
| Sector Y | (0, 50, 400) | (0, 21, −41) |
| Venom 1 | (165, 137, 400) | (165, 109, −1) |
| Solar | (0, 322, 400) | (0, 290, −41) |
| Zoness | (−181, 141, 400) | (−181, 114, −1) |
| Macbeth | (−172, 109, 200) | (−172, 27, −800) |
| Titania | (0, 35, 200) | (0, 224, −800) |
| Aquas | (0, 410, 240) | (0, 362, −1) |
| Fortuna | (0, 861, −11869) | (0, 812, −11131) |
| Katina | (0, 485, −11872) | (0, 462, −11135) |
| Bolse | (1, 993, −9670) | (1, 957, −10018) |
| Venom 2 | (0, 617, −3463) | (0, 575, −3923) |
| Sector Z | (−3095, −18, 5) | (−3417, −61, 0) |
| Versus Corneria | (−7890, 438, −7890) | (−8215, 394, −8215) |

**V1.0.** The environment globals sit 0xA190 lower in RAM, with identical values (**verified** on Corneria, dump `rt/dumps/v10_corneria.bin`). The records themselves are byte-identical.

**Reaching any level in the emulator** (V1.1, debug core; **verified** for every level id except 15, and for Versus stages 0-1):
1. Clear `sPlayerNoise[i].form` to 0xFF at 0x8014B8BC, 0x8014B92C, 0x8014B99C, 0x8014BA0C. Without this, a switch from inside a level crashed in `Audio_UpdateDopplerShift`.
2. For Versus, write `gVersusStage` (s32 0x8017789C).
3. Write `gNextLevel` (u16 0x80161A30) and `gNextLevelPhase` (u16 0x80161A2E; 1 = warp zone or Andross all-range).
4. Write `gNextGameState` (u16 0x80161A32) = 7 last.

It works from the main menu or inside a level (`rt/goto.sh`). Frame display lists are captured by breaking on `Graphics_SetTask` (0x80003C50) and reading `gGfxTask` (0x80137E54) (`rt/capture.sh`).

#### Instances, bounds, camera

- **Matrix:** column-major = transpose of the game's row-vector matrix.
  - On-rails: `T(x, y, −zPos1 − 3000 + zPos2)·RY·RX·RZ`.
  - All-range: `T(x, y, ±zPos1)·RY`, sign per loader (*Object placement*).
  - Event actors: *Event actors (ids ≥ 1000)*. Skeleton limbs: *Skeleton models (frame 0)*.
- **Meshes:** one `Mesh` per distinct (list, preset, recipe). Instances share meshes when lighting is done in the renderer; they don't share when baked.
- **Size:** on-rails levels are long. Corneria runs to about z −230000 and Venom 1 to about −635000. That is fine for Float32 at model sizes, but set the far plane from fog. Alternatively offer route sections as separate entries; the Corneria lake route is at x ≈ 7000 after z −171296.
- **Ground:** tile the *Terrain and ground planes* ground list or a generated strip every 6000 units along the path's z range (12000-unit tiles for all-range), with world-anchored UVs and Corneria's per-section surface texture.
- **Moving objects:** list moving enemies and event actors as `animated: true` instances at their spawn pose, or omit them. Items, effects and markers are skipped.
- **`bounds`:** computed from placed instances.
- **`camera`:** eye 3000 units behind the first scenery at y 300, looking −Z, for on-rails; above the origin for all-range. Runtime start-camera values are in *Fog, lights, clear colour, camera*.

## 4. Objects

### 4.1 Placement records

#### Object placement

**ObjectInit record**, 0x14 bytes. **Verified**: all 37 lists parsed; live RAM objects match field for field. The leak names it `enemy_set_data`.
| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `+0x00` | 4 | `f32` | `zPos1` | on-rails: path distance (>= 0, list sorted ascending); all-range: z |
| `+0x04` | 2 | `s16` | `zPos2` | on-rails extra z offset |
| `+0x06` | 2 | `s16` | `xPos` | world x |
| `+0x08` | 2 | `s16` | `yPos` | world y |
| `+0x0A` | 6 | `s16[3]` | `rot.x, rot.y, rot.z   degrees` | — |
| `+0x10` | 2 | `s16` | `id` | ObjectId; <= -1 ends the list; >= 1000 = event actor, script index id - 1000 |
**World position.**
- On-rails: `(xPos, yPos, −zPos1 − 3000 + zPos2)`.
  - **Verified**: all 15 live scenery objects in a Corneria RAM dump match exactly, e.g. id 55 at (−1046, 0, −40707.1) from zPos1 31707.1, zPos2 −6000.
  - `Scenery_Load` negates zPos1 (`neg.s` at V1.1 0x800614E4).
- All-range: the z sign depends on the loader. **Verified** by disassembly of V1.1:
  - `+zPos1`: Fortuna (ovl_i4 0x8018BB1C), Play_Setup360_CO (0x800A5424), Play_Setup360_SY (0x800A568C), Play_InitVsStage;
  - `−zPos1` (`neg.s`): Bolse (ovl_i4 0x80191FF4), Sector Z (0x8019EB90), Venom 2 (ovl_i6 0x80196A78), Andross (0x80193820), Training_Setup360 (ovl_i1 0x80198D3C).
  - Training_Setup360 also sets `y = yPos − RAND_FLOAT_SEEDED(300)` after `Rand_SetSeed(1, 29000, 9876)`.
  - All-range scenery uses only rot.y: `T(pos)·RY`.
- Versus: entries with id 147 (OBJ_SCENERY_LEVEL_OBJECTS) are bookkeeping and are not drawn.

**Path turns and route branches.** The target computation is **verified** by disassembly of `ItemPathChange_Update` (V1.1 0x80068C88). Path smoothing and camera banking follow decomp `Player_UpdatePath`. No turn was observed in RAM: xPath stayed 0 on the Corneria main route.
- Path items (`OBJ_ITEM_PATH_*`) only **translate** the path: `xPathTarget = xPath ± rot.z·100`, likewise for y. The yaw change is camera banking; the world never rotates.
- Static placement is therefore correct on every route, and alternative routes sit at other x or y ranges.

  | level | path items |
  |---|---|
  | Corneria | TURN_RIGHT at zPos1 168296, width 7000; the lake route is at x ≈ 7000 |
  | Sector X | SPLIT_X 117073 (4000); turns at 191038 and 192038 |
  | Sector Y | SPLIT_Y 108430 (3500); TURN_DOWN/UP 163628: vertical routes |
  | Venom 1 | 17 junction items |

**Object id classes** (`sf64object.h`, consistent with list contents):

| ids | class |
|---|---|
| 0-160 | scenery |
| 161-175 | sprites (trees, poles, cacti) |
| 176-291 | actors |
| 292-321 | bosses |
| 322-338 | items |
| 339-399 | effects |
| 400-405 | environment markers |
| 1000+ | event actors |

Level geometry is scenery, sprites, static actors and static event actors (*Event actors (ids ≥ 1000)*).

**Object info table** `gObjectInfo[400]` (ids 0-399; `OBJ_ID_MAX` is 406 but ids 400-405 have no entry; the table is followed by the `$Id: fox_edisplay.c` string), 0x24 each, at V1.1 0x800CC124. **Verified** layout by decode:
| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `+0x00` | 4 | `u32` | `dList (drawType 0) or draw function (drawType 1/2)` | — |
| `+0x04` | 1 | `u8` | `drawType` | 0: plain segmented list; 1: C function; 2: function building its own matrices (skeletons) |
| 0x08 | 4 | u32 | action | Function pointer. |
| 0x0C | 4 | u32 | hitbox | Float-array pointer. |
| `+0x10` | 4 | `f32` | `cullDistance;` | — |
| 0x14 | 4 | s16[2] | unknown14 | Unknown halfwords. |
| 0x18 | 1 | u8 | damage | Damage amount. |
| 0x19 | 1 | u8 | unknown_19 | Unknown byte. |
| `+0x1C` | 4 | `f32` | `targetOffset;` | — |
| `+0x20` | 1 | `u8` | `bonus` | — |

**Instance matrix** (decomp `Object_SetMatrix`, `Scenery_Draw`, `Sprite_Draw`; positions and angles **verified** in RAM, composition order per decomp and consistent with renders):
- On-rails scenery, sprites and actors: `T(pos)·RY(rot.y)·RX(rot.x)·RZ(rot.z)`.
- Objects with non-default drawing, **keyed by object id** (full table in `notes/levels.md` *MIO0*). Ids 8, 9, 19, 50 and 55 are drawType-0 lists whose preset and culling `Scenery_Draw` overrides by id, so a loader must dispatch these recipes on the id, not on drawType:
  - **Preset 57 + cull off:** CO_HIGHWAY_4, CO_TOWER, VE1_WALL_3, CO_ROCKWALL.
  - **Preset 60:** CO_HIGHWAY_3.
  - **Fixed transforms:**
    - CO_BUILDING_9: extra T(0,0,−95);
    - VE1_WALL_1/2: preset 57, RY(180);
    - AQ_BUMP_2: Scale(0.5);
    - TI_RIB_0..8: Scale {1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6} + D_TI1_700BB10.
  - **Preset 57 lists:** Macbeth tracks, signs and switches (D_MA_* lists), MA_TOWER (two lists, no cull).
  - **Skeletons (*Skeleton models (frame 0)*):** CO_DOORS (aCoDoorsSkel / aCoDoorsAnim), MA_TRAIN_STOP_BLOCK, MA_SWITCH_TRACK (aMaSwitchTrackSkel + D_MA_601C170 at RY(−10)·T(0,0,−1800)), AND_PASSAGE (gate skeleton, limb 13 only) / AND_DOOR (gate skeleton without limb 13), Venom 2 base (aVe2BaseSkel / aVe2BaseAnim).
  - **Other recipes:** CO_BUILDING_ON_FIRE no cull + D_CO_60199D0; TI_SKULL D_TI1_7007350; TI_PILLAR D_TI1_7002270; MA_PROXIMITY_LIGHT aMaProximityLightSidesDL, then preset 29 aMaProximityLightTopDL; Macbeth tracks, ids 92-105, preset 57 + the D_MA_* lists of `notes/levels.md` *MIO0* (105: preset 29 D_MA_602D380); Corneria all-range CO_BUMP_1 uses D_CO_6020760 instead of its info list.
  - **Shadow decals:** 164 OBJ_SPRITE_FOG_SHADOW (drawType 1): preset 47 + aCoShadow1DL scaled per scenery type.
  - **No geometry:** 147, 155 (NULL list), 156 (SY_SHOGUN_SHIP, draw unimplemented in the game), 167/168, 170-175.
- Fixed bases created by code at (0,0,0), not by lists:
  - Fortuna OBJ_BOSS_FO_BASE: preset 29 aFoBaseDL2, then preset 34 + cull + point filter + prim colour, aFoBaseDL1;
  - Katina FL base: T(0,20,0) aKaFLBaseDL; saucerer at (−15000, 3240, 15000);
  - Bolse base: D_BO_6002020, plus translucent shield aBoBaseShieldDL (preset 41);
  - Venom 2 base: skeleton aVe2BaseSkel;
  - Sector Z: Great Fox (aGreatFoxIntactDL).

##### Placement lists

Offsets are into the level file. **Verified** entry counts; all lists are byte-identical in V1.0 and V1.1 except Venom 1 (*Asset files*).

| list | file + offset | entries | notable content |
|---|---|---|---|
| Corneria on-rails [0] | ast_corneria+0x371A4 | 803 | 380 scenery, 213 sprites, 171 event actors |
| Corneria all-range (Granga arena) | ast_corneria+0x3B074 | 136 | 67 scenery, 69 CO_TREE |
| Meteo [1] | ast_meteo+0x26CC4 | 876 | 2 ME_TUNNEL, 756 event actors |
| Meteo warp | ast_meteo+0x2B148 | 323 | event actors |
| Sector X [2] | ast_sector_x+0x2A164 | 1025 | 1008 event actors (the base) |
| Sector X warp | ast_sector_x+0x2F18C | 166 | event actors |
| Area 6 [3] | ast_area_6+0x23F64 | 443 | event actors |
| UNK_4 [4] | ast_area_6+0x287A4 | 1 | one event actor |
| Sector Y on-rails [5] | ast_sector_y+0x2E4F4 | 487 | 6 scenery, event actors |
| Sector Y all-range | ast_sector_y+0x30B14 | 1 | Shogun ship |
| Venom 1 [6] | ast_venom_1+0x7E74 | 1664 | 565 scenery, 162 actors |
| Venom 1 beta (unused) | ast_venom_1+0x10088 | 1978 | *Unused and hidden content* |
| Solar [7] | ast_solar+0x1F234 | 179 | actors |
| Zoness [8] | ast_zoness+0x26714 | 500 | 143 scenery |
| Andross tunnel [9] | ast_andross+0x35154 | 67 | 29 AND_PASSAGE |
| Andross boss | ast_andross+0x356A4 | 1 | |
| Andross base (all-range) | ast_andross+0x356CC | 156 | 123 scenery |
| Andross escape 1/2/3 | ast_andross+0x36310 / 0x36B6C / 0x3733C | 106 / 99 / 100 | |
| Training on-rails [10] | ast_training+0x6AA4 | 464 | 220 TR_BUILDING |
| Training all-range | ast_training+0x8EF8 | 76 | |
| Macbeth [11] | ast_macbeth+0x31000 | 901 | 585 scenery |
| Macbeth trains | ast_macbeth+0x35678 / 0x357CC / 0x35920 | 16 / 16 / 6 | train cars |
| Titania [12] | ast_titania+0x6C60 | 605 | 110 scenery, 81 cacti, 165 terrain records |
| Aquas [13] | ast_aquas+0x2E5C8 | 322 | 103 scenery, seabed props |
| Fortuna [14] | ast_fortuna+0xEAD4 | 79 | 45 scenery, 26 FO_POLE |
| Katina [16] | ast_katina+0x11044 | 0 | base is created by code |
| Bolse [17] | ast_bolse+0xFF74 | 29 | 11 scenery |
| Sector Z [18] | ast_sector_z+0x6EB4 | 74 | 62 space-junk scenery |
| Venom 2 [19] | ast_venom_2+0x14D94 | 29 | towers, mountains |
| Versus Corneria [20] / Katina / Sector Z / Sector Z match | ast_versus+0x2DE3C / 0x2E0E4 / 0x2E170 / 0x2E378 | 33 / 6 / 25 / 24 | |

##### Event actors (ids ≥ 1000)

Almost everything visible in Meteo, Sector X, Area 6, Sector Y and the warp zones is an event actor. Many props elsewhere are too. **Verified** by decoding the scripts and tables (`lv/proto/events.ts`); semantics per decomp `fox_enmy2.c`.

- **Script tables** (u16* arrays; index = id − 1000):

  | level | table offset | level | table offset |
  |---|---|---|---|
  | Corneria | ast_corneria+0x3D9E8 | Solar | +0x20DD0 |
  | Meteo | +0x2F3AC | Zoness | +0x2AAC0 |
  | Sector X | +0x320D0 | Andross | ast_andross+0x37E3C |
  | Area 6 | +0x27F50 | Training | +0x9B34 |
  | UNK_4 | +0x289FC | Macbeth | +0x381D8 |
  | Sector Y | +0x32E18 | Titania | +0x631C |
  | Venom 1 | +0x1B1E4 (V1.0: +0x1B1D8) | Aquas | +0x308B8 |

  Warp lists use their level's table.
- **Script encoding.** A command is a pair of u16 words:
  - word 0: `opcode = (w >> 9) & 0x7F`, `arg1 = w & 0x1FF`;
  - word 1: arg2.

  Opcodes that matter:

  | opcode | command | arguments |
  |---|---|---|
  | 104 | INIT_ACTOR | arg2 = eventType, arg1 = health |
  | 0 | SET_SPEED | |
  | 1 | SET_ACCEL | |
  | 9-12, 16-21 | turn, pitch, yaw, roll | |
  | 40-47 | pursue, flee | |
  | 48 | SET_WAIT | |
  | 96 | SET_TRIGGER | arg1 < 200: command index; ≥ 200: switch to script arg1 − 200 |
  | 119 | SET_SURFACE | |
  | 126 | LOOP | |
  | 127 | STOP | |
- **Walker details** (`notes/levels.md`, “Event actor scripts”):
  - speed commands encode speed `w & 0x7F` and z mode `(w >> 7) & 3` in word 0; this matters for the static/moving test;
  - LOOP (126): arg1 < 200 goes to command arg1 after arg2 repetitions; arg1 ≥ 200 switches to script arg1 − 200;
  - `aiIndex` counts u16 words, so command k is at byte 4k;
  - levels without their own table fall back to the Corneria table;
  - eventType ≥ 200 (EVENT_HANDLER, ME_MORA) has no model.
EventActorInfo has 108 entries of 0x20 bytes at V1.1 0x800D003C or V1.0 0x800CB64C. Index by eventType. Known fields:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | displayList | Gfx pointer. |
| 0x04 | 4 | u32 | hitbox | Float-array pointer. |
| 0x08 | 4 | f32 | scale | Model scale. |
| 0x0C | 4 | f32 | cull | Culling distance. |

- **Model lookup:**
  - To find a static model, walk the script from command 0, following LOOP and script changes, to the first INIT_ACTOR. If there is none, follow trigger branches breadth-first.
  - Unresolved (trigger-only handlers): Corneria 12 scripts, Area 6 11 scripts.
  - Per-type draw extras for the main types:

    | type | extra |
    |---|---|
    | WZ_* | preset 34, point filter, prim colour |
    | SX_SPACE_MINE, SY_ROBOT_SPRITE_* | preset 60 |
    | MA_LASER_TURRET, MA_RAILROAD_CART | preset 57 |
    | A6_UMBRA_STATION | RX(90) |
    | ME_ROCK_GULL | orientation rotations |
    | VE1_PILLAR | Scale 0.6 |
    | CRUISER_GUN | RY(180), Scale 1.5, skeleton |
    | SX_WARP_GATE | skeleton (limb 5 with preset 34) |
    | TRIPOD | T(0,−30,0), skeleton |
    | ME_FLIP_BOT | aMeFlipBot1DL, then preset 53 aMeFlipBot2DL |
    | A6_NINJIN_MISSILE, A6_ROCKET | no cull |

  - Not reproduced: SY_ROBOT_1-3 (SectorY_SyRobot_Draw).
- **Matrix.** `T(pos)·RZ(orient.z)·RY(rot.y)·RX(rot.x)·RZ(obj.rot.z)`, with `pos = (xPos, yPos, −zPos1 − 3000 + zPos2)`. At load, `obj.rot = (rx, ry, 0)` and `orient.z = rz`. At INIT_ACTOR with `info.unk16 == 0`, `obj.rot.z = rz` and `orient.z = 0` (A6_UMBRA_STATION keeps orient.z). VENOM_TANK (`info.unk19 ≠ 0`) and A6_UMBRA_STATION use `T·RY·RX·RZ` instead. Preset 29 unless the type overrides it.
- **Static vs moving.** Static means the main script path never sets a speed, turn or pursuit before STOP.

  | level | static props / total with a model |
  |---|---|
  | Meteo | 231 (asteroid field) |
  | Sector X | 664 (the whole space base) |
  | Area 6 | 101 (cruisers, guns, Umbra stations) |
  | Sector Y | 61 ship props |

  Moving event actors can be listed as `animated` instances at their spawn pose.

##### Skeleton models (frame 0)

**Verified** by decoding aCoDoorsSkel, aVe2BaseSkel and aMaTrainStopBlockSkel; semantics per decomp `fox_std_lib.c`.

- **Limb** (0x20):

  | Offset | Size | Type | Field | Description |
  |---:|---:|---|---|---|
  | `0x00` | 4 | `Gfx*` | `displayList` | May be NULL. |
  | `0x04` | 12 | `f32[3]` | `translation` | X, Y, Z. |
  | `0x10` | 6 | `s16[3]` | `rotation` | Stored but unused. |
  | `0x18` | 4 | `Limb*` | `sibling` | Sibling limb. |
  | `0x1C` | 4 | `Limb*` | `child` | Child limb. |
- **Skeleton:** a NULL-terminated array of Limb*. Element 0 is the root; a limb's index is its array position + 1.
Animation header, 0x0C bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | s16 | frameCount | Frame count. |
| 0x02 | 2 | s16 | limbCount | Limb count. |
| 0x04 | 4 | u32 | frameData | Pointer to u16 frame values. |
| 0x08 | 4 | u32 | jointKey | Pointer to JointKey records. |

JointKey, 0x0C bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | u16 | xLen | X channel length. |
| 0x02 | 2 | u16 | x | X channel data index. |
| 0x04 | 2 | u16 | yLen | Y channel length. |
| 0x06 | 2 | u16 | y | Y channel data index. |
| 0x08 | 2 | u16 | zLen | Z channel length. |
| 0x0A | 2 | u16 | z | Z channel data index. |

Channel value for frame f is frameData[idx + (f < len ? f : 0)].
  - Key 0: root translation (s16).
  - Keys 1..limbCount: that limb's rotation, `value·360/65536` degrees.
- **Drawing:**
  - Root: `M = object · T(t) · RZ · RY · RX(key 1)`, with t = root limb trans (mode & 1) or key 0.
  - Each limb: `M_limb = M_parent · T(limb.trans) · RZ · RY · RX(key[index])`.
  - Children inherit M_limb; siblings inherit M_parent.

### 4.2 Object and model formats

#### Detection and game object

- **`src/rom/index.ts`:** add `case 'NFXE'` after `normalizeByteOrder()`. It calls `openStarFox64(rom)`.
- **`src/rom/types.ts`:**
  - extend `Game.id` with `'sf64'`;
  - add `LevelKind` values `'onrails' | 'allrange' | 'versus'` if wanted, or map on-rails to `campaign`, all-range to `battle` and warp zones to `other`;
  - use `LevelInfo.group` for the groups in *Level list*.
- **Game title:** `Star Fox 64` for V1.1, `Star Fox 64 (V1.0)` for V1.0.
- **Version choice:**
  1. Find the DMA table by pattern (*DMA file table*).
  2. Offset 0xDE480 means V1.1; 0xD9A90 means V1.0.
  3. Select the address set in *Addresses that differ per version*.
  4. Anything else: throw "unsupported revision".

### 4.3 Skeletons and animation

### 4.4 Behaviors, triggers, and scripted objects

## 5. Audio

### 5.1 Audio storage and banks

### 5.2 Sequence format and driver

Source notes: `notes/music.md`. Work dir: `sf/mus/`. The prototype renderer is in `mus/proto/`.

#### System

Star Fox 64 uses **Nintendo's EAD sequence driver**, the lineage between Super Mario 64 and Ocarina of Time. It is **not** libultra `alSeqPlayer`/`ALBank`.
- **Data:** a sequence table, a soundfont table and a sample-bank table.
- **Bytecode:** three levels: sequence player, channel, layer.
- **Engine:** its own ADSR and note allocator. The CPU builds an RSP command list for the "NEAD SF" audio microcode.

**Verified** three ways, plus leak support:
- every table and all 46 distinct sequences parse with this format;
- driver strings are in main, e.g. `Audio:Track:Warning: No Free Notetrack` at V1.1 ROM 0xC6520;
- the audio task's ucode data word `0x110412CC` is what rsp-hle maps to `alist_process_nead_sf` (lead re-checked in the ROM);
- the leak's `mml64.def` is headed "Nintendo64 Original Music Macro Language … Hideaki Shimizu (EAD)" (leak-supported).

| item | value | status |
|---|---|---|
| output rate | 32000 Hz requested; AI DAC 32006.4 Hz (NTSC); pitches computed for 32000 | verified (RAM, capture log) |
| update rate | 3 updates per video frame = 180/s; 176 samples per update (168..184) | verified (RAM) |
| tempo clock | `tempoAcc += BPM·48` per update; one tick whenever `tempoAcc ≥ 10770` (then subtract). Seconds per tick = 10770 / (180·48·BPM); music runs 0.28 % faster than nominal; BPM is capped at 224.375 | verified (RAM gMaxTempo 10770; title loop period in capture 21.29 s vs model 21.274 s) |
| time base | 48 ticks per quarter note | verified (ROM `gSeqTicksPerBeat`; leak `smf2mus.cfg`) |
| voices | 22 notes per spec (32 for specs 21, 22 opening, 23 title and 27 ending), shared with the SFX and voice players | verified |
| reverb | per audio spec: reverb 0 = delay 3072 samples (96 ms), decay 0x3000; reverb 1/2 per level (table in `notes/music.md`, “Audio specifications”). Music uses reverb 0 almost always | verified (ROM specs, RAM) |

#### Sequence bytecode

Semantics follow decomp `audio_seqplayer.c`; command names in brackets come from the leak's `mml64.def`. Argument encodings are **verified** by a reachability disassembly of all 46 sequences with zero errors (audio analysis, `mus/scan_all.txt`).

Encodings are big-endian. `var` = 1 byte, or 2 bytes if bit 7 is set: `((b0&0x7F)<<8)|b1`. Offsets are u16 from the sequence start. Every script has a 4-level call stack and 4 loop counters.

**Sequence player.** Runs once per tempo tick until a delay.

| op | args | meaning [mml] |
|---|---|---|
| FF | – | end/return [FIN]; at depth 0 disables the player |
| FD | var | wait n ticks [WAIT] |
| FB | s16 | jump [JUMP]; **every song loop is this** |
| FA / F9 / F5 | s16 | jump if value == 0 / < 0 / ≥ 0 |
| FC | s16 | call |
| F8 / F7 | u8 / – | loop start/end |
| F4 / F3 / F2 | s8 | relative branches |
| DD | u8 | tempo = BPM·48 [TEMPOCHG] |
| DC | s8 | tempo change |
| DB | u8 | volume = v/127 [VOLUMECHG] |
| DA | u8, s16 | fade |
| D9 | s8 | volume mod |
| D7 | u16 mask | allocate/initialise channels [ALLOCSUB] |
| D6 | u16 | free channels |
| D5 | s8 | mute volume |
| D3 | u8 | mute behaviour |
| DF / DE | s8 | transposition set / add |
| CC / C9 / C8 | u8 | value = / &= / −= |
| 8n / 7n / 5n | – | value = io / io = value / value −= io (io port 0 = the game's bgmParam) |
| 9n | u16 | start channel n [OPENSUB] |
| 0n | – | value = channel n finished |

**Channel.** Runs each tick while its delay is 0. The flow commands FF..F2 behave as in the player; FE yields.

| op | args | meaning [mml] |
|---|---|---|
| C1 | u8 | instrument (0x7F = drums) [PRG]; copies envelope and release |
| C6 | u8 | font by index [BANKCHG] |
| EB | u8, u8 | font + instrument |
| C4 / C3 | – | large / short note encoding [BMODE/AMODE]; **persists across script restarts** |
| DF | u8 | volume v/127 [SVOLUME] |
| E0 | u8 | volume scale v/128 |
| DD | u8 | pan [SPAN] |
| DC | u8 | pan weight 0..128 |
| D3 | u8 | pitch bend ±1 octave: bendOctave[(v+128)&255] |
| EE | u8 | ±2 semitone bend |
| DB | s8 | transposition |
| DA | s16 | envelope |
| D9 | u8 | release |
| D8 / D7 / E1 / E2 / E3 | | vibrato |
| D4 | u8 | reverb send [FXMIX] |
| E5 | u8 | reverb index [FXLINE] |
| ED | u8 | gain Q4.4 |
| E9 | u8 | priority |
| D0 / D1 / D2 / CA | u8 | stereo effects / note policy / sustain / mute behaviour |
| C2 | s16 | dyn table |
| E4 | – | dyn call |
| C8 / C9 / CC | u8 | value ops |
| EF | s16, u8 | debug print (ignore) |
| 0n | – | value = layer n finished |
| 5n / 7n / 8n | – | io ops (reading clears ports 0-3) |
| 6n | – | delay n |
| 9n | u16 | start layer n [OPENNOTE] |
| An | – | free layer n |

**Layer.** All 44 music sequences use only **C0 rest, C2 transpose, FC call, FF end, and the three large-note forms** (**verified** coverage):

| op | args (large mode) | meaning |
|---|---|---|
| 00-3F | var len, u8 vel, u8 gate | note = op & 0x3F |
| 40-7F | var len, u8 vel | note, gate 0 |
| 80-BF | u8 vel, u8 gate | note, previous length |
| C0 | var | rest |
| C2 | u8 | layer transposition (the decomp comment "gate time" is wrong: code, mml and data agree) |
| C1, C3-CD, Dn, En | | velocity, default length, legato, layer instrument, portamento, gate, pan, envelope, phase, table velocity/gate (not used by music) |

- **Note timing:** a note of `len` ticks sets `delay = len` and `gateDelay = (gate·len) >> 8`. It is released as soon as `gateDelay ≥ delay`; gate 0 holds it until the next event.
- **Velocity:** `velocitySquare = vel²/16129`.
- **Pitch:** `note = (op&0x3F) + player.transp + channel.transp + layer.transp`; a result ≥ 0x80 is muted.
- **Drums:** `drum = (op&0x3F) + channel.transp + layer.transp`, `freq = drum.tuning`, pan = drum pan.

**bgmParam** (player io port 0; −1 for normal BGM). Only these sequences read it (**verified** scan):

| seq | effect of bgmParam |
|---|---|
| 10 | 0 skips the 768-tick intro |
| 19, 25 | entry point |
| 33 | 0 = no drum channel |
| 62 | < 0 loops a short section |

Render everything with −1.

**Module.** Add `src/rom/music/sf64.ts` and set `Game.music` / `Game.decodeMusic` from it. It locates the data as follows:
- the three audio files come from DMA entries 3-5;
- the sequence, font and sample-bank tables are found in main by structure (*File formats*);
- `gAudioSpecs` and the note_data tables are found by signature.

The same code works for V1.0 and V1.1 (**verified**: identical tables and identical renders).

**Reuse from `src/rom/music/libultra.ts`:**
- `decodeVadpcm`: the same RSP VADPCM decode;
- the `prepareWave` loop convention: predictor state = decoded frame containing the loop start, **verified** 56/56;
- `RESAMPLE_LUT` (exported), and the 4-tap resampler inner loop, which lives in the non-exported `mixVoice` and must be copied.

**Do not reuse:**
- ALBank parsing;
- the MIDI scheduler;
- the libultra envelope mixer. NEAD uses linear 8-sample volume ramps, `(s·vol)>>16`, and its own pan tables.

**New code.** Port `mus/proto/sf64synth.ts` and `sf64audio.ts`: about 1300 lines covering the sequence player (*Sequence bytecode*), note pool, ADSR, reverb and synthesis (*Offline rendering and loop points*). The prototype's `renderSequence` returns `{sampleRate, left, right, loopStart?, loopEnd?, loopTicks?, info}`. A small adapter builds `DecodedMusic {channels: [left, right]}`, and the export should be renamed so it doesn't clash with `libultra.ts`'s `renderSequence`.

**Track list.** `MusicTrack[]`: the 44 rows of *Song list*, with `index` = sequence id and `name` = viewer name.
- Audio spec per track: from `sSoundTestTracks` in the ROM, or the table in `mus/proto/songs.ts`.
- bgmParam: −1.

**Loops.** Render the intro plus two passes. Set `loopStart`/`loopEnd` at the first and second executions of the sequence-level `FB` jump. One-shot tracks get no loop.

**Cost.** Up to 352 s for Corneria, about 90 MB of Float32 and 1-10 s of CPU per song in Node. Render in the worker, one track on demand. To save memory, render intro + 1 pass + tail and crossfade the tail into the loop start.

**Risks:**
- in-game SFX and voice steal notes, which is not modelled;
- two-part resampling above 2× and the downsample-2 reverb are approximations;
- a PAL (Lylat Wars) build would need a 50 Hz update clock.

| claim | evidence |
|---|---|
| Tables, fonts, samples in bounds; loop-state 56/56 | cross-check, audio analysis; lead re-check of the sequence table (66 entries, 20 aliases, tiles audio_seq) and V1.0 table equality |
| Opcode coverage, 0 errors | audio analysis → `mus/scan_all.txt` |
| Runtime constants (32000/32006 Hz, 3 updates/frame, gMaxTempo 10770, notes, reverbs) | RDRAM `mus/cap/ram_a.bin`, `mus/cap/ram_co.bin` + ROM analysis |
| RSP ucode NEAD SF | ROM word 0x110412CC at ucode_data+0x10 (V1.1 ROM 0xC3EE0; lead re-checked) and rsp-hle `try_audio_task_detection` |
| Sequence state = game | ROM analysis + `mus/proto/statecheck.ts` (Corneria, 181 fields, 0 mismatches) |
| Audio = game | capture `mus/cap/run1.raw` (audio-dump plugin) vs renders, `mus/proto/compare.ts`: title, map, game over (waveform ncc 1.000), mission start, Corneria (SFX muted with `mus/tools/mute_sfx.sh`) |
| All ids render, V1.0 = V1.1 | `mus/render_all.txt`, `mus/render_all_v10.txt` |
| Leak audio = ROM | objcopy + md5 of `audio/fox64_*.o`; `.cart` byte compare |

- Where the opening sequence 35 is heard. It was not matched in the capture; the prologue plays 60.
- In-game voice stealing by the SFX and voice players is not modelled.
- Two-part resampling (rate ≥ 2) and the downsample-2 reverb write delay are approximations.
- The meaning of the SEQ_FLAG 0x8000 "restart" bit comes from the decomp only.
- Font choice for leak-only sequences is a guess.

#### Audio

Consolidated from notes/music.md 11. VERIFIED unless noted.
- **Unreferenced sequence ids.** Six alias ids have no code references: 26 BOSS_FO (alias of 18), 41 END_DEMO (34), 52 AQ_START_DEMO and 53 VE_START_DEMO (37), 57 VS_RESULT (56), 59 STAGE_BM3 (43).
  - All 46 distinct sequences are reachable.
  - Sequence 25 (a separate copy of "BB") is used only for Sector Y's boss.
  - Label: decomp scan + VERIFIED table; high.
- **Expert Sound Options** (hidden sound test, 11.4): tracks 0-44 are sSoundTestTracks; 45-49 are five scripted medleys following the Lylat routes. decomp; high.
- **Unreferenced sample data.** About 186 KB of plausible VADPCM data in music sample bank 3 is not covered by any font: +0x5287A (31078 bytes), +0x62124 (19564), +0x6F1C8 (10136), +0x740EE (124706, about 6.9 s), +0xC2F8E (2418). Probably unused instrument samples. VERIFIED coverage; hypothesis on content; medium.
- **Unused spec ids.** Audio spec ids 18-21 and 26 are defined but never selected. decomp; high.
- **Unused drum slots.** Fonts 24-32 define 39 drums but use 1-6. One referenced drum sample (bank 3 +0x6C120) is never played. VERIFIED; high.
- **Leak-only sequences:** 11.7.

### 5.3 Instruments and sample encoding

### 5.4 Music catalog and loop points

#### Song list

Sequence ids, decomp names (`include/bgm.h`), leak file names (`assets/en/audio` `.com` files byte-matched to the ROM), per-level assignments from the environment records' `seqId`, and loop lengths from the prototype. The environment `seqId` carries flag 0x8000 (except Aquas, 0x000E; Venom 2 is 0xFFFF), which is stripped before playing.
- **Verified:** level `seqId` values (e.g. Corneria 0x8002, lead re-checked), the aliases, fonts and specs (`sSoundTestTracks` read from the ROM).
- **Leak-supported:** file names.
- **Decomp:** boss and intro call sites.

Type: S stage, B boss, M menu loop, D one-shot demo, J jingle.

| id | decomp | leak file | font | spec | type | used by | loop / length (s) | viewer name |
|---|---|---|---|---|---|---|---|---|
| 2 | CORNERIA | Music2.com | 24 | 0 | S | Corneria | 117.27 | Corneria |
| 3 | METEO | Asteroid.com | 29 | 1 | S | Meteo | 45.47 | Meteo |
| 4 | TITANIA | Titania.com | 25 | 2 | S | Titania, Macbeth (16) | 59.83 | Titania / Macbeth |
| 5 | SECTOR_X | SectorX.com | 26 | 3 | S | Sector X | 68.90 | Sector X |
| 6 | ZONESS | Zones.com | 28 | 4 | S | Zoness | 61.95 | Zoness |
| 7 | AREA_6 | Versus.com | 25 | 5 | S | Area 6 (and unused level 4) | 45.05 | Area 6 |
| 8 | VENOM_1 | Venom.com | 25 | 6 | S | Venom 1 | 48.72 | Venom |
| 9 | SECTOR_Y | Solar.com | 29 | 7 | S | Sector Y, Solar (11) | 58.94 | Sector Y / Solar |
| 10 | FORTUNA | Music3.com | 24 | 8 | S | Fortuna, Sector Z (15) | 47.87 | Fortuna / Sector Z |
| 12 | BOLSE | VSAfter.com | 28 | 10 | S | Bolse | 37.55 | Bolse |
| 13 | KATINA | Katarina.com | 25 | 11 | S | Katina | 64.22 | Katina |
| 14 | AQUAS | Aquarie.com | 30 | 12 | S | Aquas | 67.01 | Aquas |
| 17 | ANDROSS | RTB.com | 28 | 15 (level) / 23 (sound test) | S | Venom (Andross level) | 19.54 | Venom (Andross route) |
| 18 | BOSS_CO_1 | Boss.com | 28 | 0 | B | bosses of Corneria, Sector X, Zoness, Fortuna | 43.08 | Boss A |
| 19 | BOSS_ME | BB.com | 31 | 1 | B | bosses of Meteo, Titania, Area 6, Venom, Solar, Aquas, Macbeth; Corneria carrier | 33.24 | Boss B |
| 25 | BOSS_SY | BB.com | 31 | 7 | B | Sector Y boss | 33.24 | Boss B (Sector Y) |
| 28 | BOSS_BO | BC.com | 31 | 10 | B | bosses of Bolse, Katina, Sector Z | 37.06 | Boss C |
| 33 | BOSS_ANDROSS | Andorf.com | 32 | 6 | B | Andross | 55.13 | Andross |
| 34 | TITLE | title.com | 21 | 23 | M | title, attract | 21.27 (intro 42.0) | Title |
| 35 | OPENING | open.com | 21 | 22 | D | opening demo | 99.3 once | Opening |
| 36 | MENU | select.com | 22 | 23 | M | menus | 52.22 | Main menu |
| 37 | CO_INTRO | start.com | 21 | 0 | D | level intro | 55.8 once | Mission start |
| 38 | GOOD_END | clear.com | 21 | 0 | J (loops) | course clear | 24.34 | Course clear |
| 39 | DEATH | down.com | 21 | 0 | J | player down | 5.5 once | Player down |
| 40 | GAME_OVER | gameover.com | 21 | 25 | J (loops) | game over | 27.92 | Game over |
| 42 | STAFF_ROLL | end.com | 23 | 27 | D | credits | 312.6 once | Staff roll |
| 43 | STAR_WOLF | Wolf.com | 25 | 6 | B | Star Wolf | 55.84 | Star Wolf |
| 44 | INTRO_S | short.com | 21 | 1 | D | intros | 10.9 once | Mission start (short) |
| 45 | INTRO_M | midium.com | 21 | 1 | D | Titania intro | 20.2 once | Mission start (Titania) |
| 46 | VERSUS | BOrbital.com | 29 | 16 | S | Versus | 48.50 | Versus |
| 47 | VS_HURRY | Area6.com | 25 | 17 | S | Versus last stage | 52.91 | Versus (hurry) |
| 49 | BAD_END | dame.com | 21 | 0 | J (loops) | course failure | 34.81 | Course failure |
| 50 | ME_INTRO | long.com | 21 | 1 | D | Meteo intro | 29.9 once | Mission start (Meteo) |
| 51 | INTRO_51 | short2.com | 21 | 8 | D | Area 6, Solar, Sector Z, Fortuna, Katina, Bolse intros | 10.5 once | Mission start (Fortuna) |
| 54 | KATT | cat.com | 21 | 13 | J | Katt | 13.6 once | Katt |
| 55 | BILL | bill.com | 21 | 11 | J | Bill | 9.3 once | Bill |
| 56 | VS_MENU | vssel.com | 21 | 23 | M | versus select | 22.09 | Versus select |
| 58 | WARP_ZONE | Armada.com | 27 | 1 | S | warp zones | 53.93 | Warp zone |
| 60 | WORLD_MAP | map.com | 21 | 24 | M | Lylat map, prologue | 51.86 | Lylat map |
| 61 | AND_BRAIN | Andbrain.com | 25 | 6 | B | Andross brain | 39.89 | Andross brain |
| 62 | TO_ANDROSS | Venom2.com | 25 | 6 | S | Venom 2 escape (param −1) | 2.82 | Venom escape |
| 63 | TRAINING | Training.com | 25 | 28 | S | Training | 23.93 | Training |
| 64 | VE_CLEAR | allclear.com | 21 | 6 | J (loops) | all clear | 25.87 | All clear |
| 65 | BOSS_RESUME | BB2.com | 31 | 7 | B | Meteo/Sector Y boss resume | 33.24 | Boss B (resume) |

- Ids 0 (SFX) and 1 (voice) are not music.
- Venom 2's environment `seqId` is 0xFFFF: code starts its music (62, 43, 33).
- Proposed `MusicTrack` list: the 44 rows above, with index = sequence id and name = viewer name. Boss B, Boss B (Sector Y) and Boss B (resume) are near-identical arrangements; the viewer may keep only 19.

#### Offline rendering and loop points

The spec below is implemented by `mus/proto/sf64synth.ts`, a direct port of about 1300 lines.

- **Clock.**
  - A task covers `32000·numBuffers/60` samples (keep the fraction), split into `3·numBuffers` updates of 168/176/184 samples (last update takes the remainder).
  - Per update: tempo step and player script if a tick fires, then channel scripts, layers, volume/pan/pitch propagation, note processing (ADSR, vibrato), then synthesis.
  - numBuffers comes from the song's audio spec (*Song list* column "spec"; the 29 specs are in `notes/music.md`, “Audio specifications”).
- **Initial state.**
  - Player: tempo 120 BPM, fade 1, mute volume 0.5.
  - `D7` channel init: volume 1, pan 64, pan weight 128, priority 3, reverb send 0, release 0x20, default envelope, vibrato off, io −1.
  - Layer start copies the channel ADSR with release 0, and sets velocity 0, pan 64, gate 0x80, transposition 0.
  - `9n` resets only pc, delay and layers; large-note mode, volume and other channel settings persist.
- **Notes.** A global pool with disabled / decaying / releasing / active lists. Allocation takes, in order: a disabled note, a decaying note (released at 1/3 per update), or the lowest-priority note below the channel's priority.
- **Envelope.** `target = (arg/32767)²`. A delay ≥ 4 is scaled to `delay·ticksPerUpdate/numBuffers/4` updates (`delay·3/4` at 3 updates per buffer), minimum 1. Steps are linear. On release: `current −= releaseRate/2560` per update; free the note below 1e−5.
- **Mix parameters.**
  - `appliedVolume = (ch.volume·ch.volumeMod·fade·fadeMod)²`
  - `velocity = clamp(vel² · appliedVolume · adsr)`
  - `pan = (ch.pan·w + layer.pan·(128−w)) >> 7`
  - `panVolL = velocity·gDefaultPanVolume[pan]·4096`; R uses `[127−pan]`
  - `resampleRate = trunc(min(freq, 1.99998)·32768)`; freq ≥ 2 plays every other input sample at freq/2
  - vibrato (used once in music): `time += rate; idx = (time >> 10) & 63; v = sine[idx] >> 8; mod = 1 + depth/4096·(bendOctave[128 + v] − 1)`
- **Synthesis per note.**
  1. VADPCM decode with loop.
  2. RSP 4-tap resampler (same LUT as `libultra.ts RESAMPLE_LUT`).
  3. HILOGAIN.
  4. ENVMIXER: volume ramps linearly per 8 samples from the previous update's value; `dry = (s·vol)>>16`; `wet = (dry·send)>>16`; 16-bit clamping on every add.
- **Reverb r.**
  1. `wet ← ring` (a pure delay of window·64 samples).
  2. `main += wet`; `wet = wet·decay/32768`; optional leak `wetL += (wetR·leakRtL) >> 15`, `wetR += (wetL·leakLtR) >> 15`, with the gains read as s16.
  3. Add the notes' sends.
  4. `ring ← wet`.

  Downsample-2 specs (Aquas, Map, Andross) store every second sample and read the ring back through the resampler at pitch 0.5. `notes/music.md`, “Audio specifications”, quotes their windows doubled (raw windowSize·64 = 2560/4608/1536 for specs 12/15/24).
- **Output:** `clamp16(main)/32768`, stereo, 32000 Hz.
- **Loops.**
  - Every looping music sequence ends its loop with a sequence-level `FB` backward jump (**verified**).
  - Render the intro plus two passes. `loopStart` = first execution of the jump (start of pass 2); `loopEnd` = second execution (start of pass 3). Both edges then carry the same release tails and reverb, so [loopStart, loopEnd) repeats seamlessly.
  - Passes differ by at most one update (≤ 184 samples).
  - Example loop points at 32 kHz:

    | song | loopStart | loopEnd | ticks per loop |
    |---|---|---|---|
    | Corneria | 7511994 | 11264528 | 13536 |
    | Title | 2012266 | 2692976 | 2304 |
    | Boss A | 3079104 | 4457600 | 4320 |
- **End.** `FF` at depth 0 disables the player. Stop when no note has been enabled for 2 s. A loop with no note-ons is treated as the end. Jingles 38, 40, 49 and 64 loop in the data; the game fades them out.

**Verification against the game** (captures with the audio-dump plugin; `mus/cap/`, `mus/proto/compare.ts`):

| check | result |
|---|---|
| Title | RMS identical (−28.6/−27.7 dBFS both), log-spectrum correlation 0.994, identical top-8 peaks, loop 21.29 s vs 21.272 s |
| Lylat map | spectrum 0.999, energy 0.963 |
| Game over | **waveform correlation 1.000** over 1 s, i.e. sample-accurate: resampler, envelope mixer, ADSR, reverb and levels are right |
| Corneria | RAM sequence state matches the engine field for field (181 channel/layer fields at engine tick 5258); audio with SFX muted via debugger: energy 0.954, spectrum 0.998, waveform 0.827 |
| V1.0 | all 64 ids render identically to V1.1 |
| Opening (35) | not matched in the capture; the prologue crawl plays 60 |

(All **verified** except the last row.)

## 6. Unused and hidden content

### 6.1 Unreferenced assets

This section consolidates the unused and hidden content found by all research passes, with a dedicated final pass (`notes/unused.md`).
Every item has a location, evidence, a label and a confidence (high, medium or low).
- **Labels:** as in the rest of the document; "decomp" means read from the sf64 decomp.
- **Addresses:** V1.1 unless marked. V1.0 main addresses are identical below 0x800227A0; after that, subtract 0x4470 up to fox_play and 0x4480 after it. V1.0 overlay addresses are V1.1 − 0xA190 (*Addresses that differ per version*).
- **File offsets:** "file+0x" is an offset into the decompressed file.

#### Unused levels and level data

| item | location | evidence | label | conf. |
|---|---|---|---|---|
| **LEVEL_UNK_4** (leak prefix "SB") | Scene index 27 (`sOvli3_Unk4`, V1.1 0x800CB3BC, V1.0 0x800C69CC): ovl_i3 + the Area 6 file set. Environment ast_area_6+0x28760; list aA6Unk4LevelObjects ast_area_6+0x287A4 (1 entry); script table aA6Unk4EventScript +0x289FC | The list holds one event actor (script 0) at zPos1 100, zPos2 -4035, rot.y 180. No menu or map path selects level 4. It loads and plays after a RAM poke (`rt/goto.sh 4`): an empty on-rails space stage with a Venom-planet backdrop and 600 stars (`shots/v11_unk4_area6beta_01.png`). The leak's SB_Stage_Data matches the environment, and SB_BG_01 matches backdrop D_A6_601BB40. The SB model sources are the Area 6 assets | VERIFIED (ROM decode + emulator) + leak | high |
| **LEVEL_UNK_15** | Index 15 of gLevelObjectInits (0x800CFDA0) and of the environment table (0x800D2F98) | NULL in both ROMs and in the leak's stage table (fox_play.o .data 0x84 has no relocation). sLevelSceneIds maps it to SCENE_TITLE. Engine code still special-cases it: 400 stars, RCP_SetupDL_23 for actors, free vertical path movement, starfield scroll. No data remains. hypothesis: a removed free-flight space stage | VERIFIED (tables); behaviour decomp | high (unused), low (purpose) |
| **Venom 1 beta placement list** aVe1BetaLevelObjects | ast_venom_1+0x10088, 1978 entries (V1.0 at the same offset) | Used only when Venom 1 runs with gLevelPhase == 1, and no code sets that. Contents: 1744 pillar actors, 149 scenery objects, temple interiors, walls, the Golemech and a checkpoint (`lv/renders/venom1_beta_actors.png`). Leak `BM_69_enemy_set_data` has the same size (0x9A9C). The leak's `fox_enmy.o` `set_object` selects it for stage 6 with `mapno_2` set, next to the Sector X warp (SS) and Andross phase lists | VERIFIED (decode) + decomp + leak | high |
| **Scene 35 "Setup20"** | `sOvli2_Setup20` V1.1 0x800CB87C / V1.0 0x800C6E8C: ovl_i2 + planet set + ast_ve1_boss in segment 6 | SceneId 20 is not in sLevelSceneIds. The table is reachable only through the Load_SceneSetup switch | VERIFIED (tables) + decomp | high |
| **ovl_unused** = leak `shpprog` / `fox_shp.o` | DMA file 63 (0xA0 bytes, identical in both versions); scene 43 `sOvlUnused_Unk` V1.1 0x800CBD3C / V1.0 0x800C734C | The scene table is never referenced (hilo, jal and data scan). The file holds an empty `look_shape` function and a pointer to the Andross hitbox (0x0C038DC0). The leak object also defines `collision_data_{kuzuhara,morita,okajima,sasaki,sumiyosi,tarukado,yamamoto,yoshida}`. hypothesis: a per-developer shape/collision viewer stub | VERIFIED + leak | high |
| **Unused object ids** | gObjectInfo (0x800CC124) entries present for OBJ_SPRITE_SY_SHIP_2/3, OBJ_SPRITE_UNK_167/168, OBJ_ACTOR_AQ_UNK_188, OBJ_ACTOR_UNK_237, OBJ_BOSS_UNK_299/300, OBJ_BOSS_AQ_UNK_301, OBJ_SCENERY_UNK_155, OBJ_EFFECT_350/388 | These ids appear in none of the 37 placement lists (`lv/proto/unusedids.ts`). OBJ_EFFECT_350 is spawned only by the dead function `Effect_Effect350_Spawn` (11.5) | VERIFIED (lists) + decomp | high |
| **Leak "BS" stage** | Leak `fox_object.h` / `fox_Sdata.h` (BS_enemy_set_data / BS_Stage_Data commented out); `Source/fox_bs_poly.h`; models `nshape/US/bs.o` | The model set is absent from the ROM (11.7) | leak-supported + VERIFIED absence | high |

#### Unused and unreferenced assets

**Method** (ROM extraction, shared code scanner ROM extraction):
1. **Nodes.** All 3749 entries of the 49 decomp asset yamls.
2. **Roots:**
   - Segmented addresses built by `lui` + `addiu`/`ori`/load/store pairs in main and every overlay. This includes the IDO pattern where the `lui` sits in a branch delay slot.
   - Every data word in main .data/.rodata and in the overlay data sections.
3. **Edges:**
   - Display lists are walked to G_ENDDL, collecting every w1 (G_DL, G_VTX, G_SETTIMG and so on). G_DL targets and limb display lists that are not yaml nodes are walked from their exact address.
   - Skeleton limb trees, animation pointers, and texture-to-TLUT links are followed.
   - Words of script, list, environment, hitbox and blob extents are taken as references.
4. **Segment resolution.** A segment number resolves to every file that shares a scene with the referencing file or overlay (conservative).
5. **Reporting.** A node is reported only if the scan never reaches it **and** its symbol name occurs nowhere in the decomp `src/` and `include/` (mods excluded). Both independent methods therefore have to agree.
6. **Scanner validation.**
   - Only 2 unreached nodes have name references in the decomp. One is gMsgLookup, which is addressed by absolute RAM pointer. The other is aVsLandmasterCanonDL, a single pair the scanner misses.
   - The 25 font textures in ast_radio are reached through the absolute-pointer table gTextCharTextures, so they are excluded.

**Result:** 208 unreferenced nodes in 24 files: 87 textures, 32 TLUTs, 56 display lists, 2 vertex arrays, 6 animations, 3 skeletons, 6 blobs and 16 hitboxes (`un/assetrefs.txt`).
- **Label:** VERIFIED (ROM reference scan) + decomp name check.
- **Confidence:** high for textures and display lists; medium for blobs, TLUTs and hitboxes, which game code could in principle reach through computed offsets.
- **V1.0:** the asset files are byte-identical except for 4 files (none of them hold these nodes), and the code is identical up to relocation. The result therefore applies to V1.0 as well (inferred; high).

Renders:
- textures: `un/png/unref_{file}.png` (index `un/png/unref_index.txt`);
- display lists: `un/png/dl_{file}_{offset}.png` and the montage `un/png/montage_unref_dls.png`.

| file | notable unreferenced assets (file offset) | what they are (from the renders) |
|---|---|---|
| ast_corneria | **CN_sky**: D_CO_602ECB0 (DL) + D_CO_602ED50 (RGBA16 8x16) | Confirmed unreferenced by the full scan (code, data and every asset's DLs). A flat quad, x ±14560, z 0..-32767, at y 0 (`dl_ast_corneria_02ECB0.png`). Leak name `CN_sky` |
| ast_corneria | D_CO_6035430 (DL), D_CO_60354F0 (DL); hitboxes D_CO_603DC40, 603E2C0, 603E2F4 | A tall two-faced building, 706 x 2221 units, with a striped window texture; a flat dark 80x80 square (a shadow-like decal); collision boxes for objects that do not exist |
| ast_common (61 nodes) | IA8 menu textures D_1001480 (56x12 "ゲームへ" "to the game"), D_1002340 (40x10 "つづける" "continue"), D_10024D0 (96x32 "コースをやりなおす / ゲームをやりなおす / (GAME OVER)" "retry course / retry game"); frame pieces D_1001720, D_1001CC0, D_1002220, D_10022E0 | **Japanese** pause/game-over menu text left in the US common file |
| ast_common | CI4 HUD textures D_1010980 (Arwing icon), D_1010A10 ("BOM"), D_1010A90 (64x49 "CHARGE" gauge frame), D_10110C0-D_10111B0 (coloured "F", "P", "S", "F" teammate letters), D_1011200 ("HIT!"), D_1011750 ("PAUSE", 80x13), D_1011980 ("SHIELD"); CI8 D_1012290 (gauge), D_10126F0 (24x4 rainbow bar) | An older HUD set: bomb counter, charge gauge, teammate letters, pause banner |
| ast_common | DLs D_10171D0 / D_10173D0 / D_10175C0 with CI4 32x16 textures "x10", "x5", "x2" | Score-multiplier billboards |
| ast_common | DL D_101C770 (24 tris, red heart-like model); DL D_101D870 + vertices (20 tris, gold hexagonal badge); DL D_1026120 + D_1026230/D_1027230 (RGBA16 32x64 red/green/blue checker pattern); DL D_102AB30 + D_102AC40/D_102BC40 and DL D_102CC40 + D_102CD50/D_102DD50 (two copies of a 64x64 Falco portrait split into 32x64 halves); small sprites D_10237E0 (smoke), D_1028DE0, D_1028EF0 (pink sphere) | Test pattern, extra Falco portrait quads, unused pickups/effects |
| ast_versus (83 nodes) | D_versus_300C660 (CI8 112x25 **"WIN!"**); vehicle icons D_versus_3000840/3000900/3000A10; round icons 30000A0/3000140; about 30 DL + RGBA16 16x16 texture pairs 0x1E700-0x2CEF8 (4 coloured stars, 4 coloured orbs, sparkles, a colour-ramp and a purple grid, a white Arwing silhouette, three 32x32 pilot portraits (Fox, Falco and a third pilot), 7 smoke frames, 7 explosion frames); DL D_versus_301B640 (a textured 12000 x 12000 ground quad); anim D_versus_301E560; blobs 3000500/30006C0/3000830 | A versus-mode HUD/effects set that the retail versus code does not use |
| ast_vs_menu | D_VS_MENU_7007FC0 and D_VS_MENU_700DA80 (RGBA16 44x44 Falco and Slippy portraits), 70051D0 (CI8 blue gradient), 7003D70, DL 7012410 (grey gradient quad) | Unused menu portraits |
| ast_option | DL D_OPT_80147F0 + vertices 0x14B50 + CI4/RGBA16 textures 8015310, 80153B0, 8015450; D_OPT_800E0F0 | A low-poly Arwing model, 52 triangles, cream/blue (`dl_ast_option_0147F0.png`) |
| ast_title | DL D_TITLE_60456C0 (7 textures), D_TITLE_6045A28 (32x64) | A flat 40x40 red-outlined emblem |
| ast_text | aTextKanji_END (IA8 56x49) | The kanji 終 ("end"), unused in the US build |
| ast_ending | aEndNebulaeDL + aEndNebulaeTex (RGBA32 32x32) | A pink nebula sprite |
| ast_enmy_planet | DL D_ENMY_PLANET_4006280 (10 tris) | A small orange delta-shaped object with a dark cockpit piece |
| small items | aLandmasterShotGreenDL (green shot); D_ME_601EA00 (blue sparkle); D_A6_6018720 + D_A6_60187F8; D_SY_602D194 + D_SY_602D238 (white oval silhouette); D_SO_601D8B0 (black blob); D_GREAT_FOX_E011D80 + E011E08; D_AQ_6024938; D_VE1_90039F0 (CI8 32x32) | Sprite leftovers |
| animation/skeleton | aAwUnusedAnim (ast_arwing+0x15D68, already named unused by the decomp); D_BO_60086B4 + D_BO_6008760 skeletons with anims D_BO_6008668/60086F4; D_MA_6015500 skeleton + D_MA_6015494 anim; D_VE1_9002CD8 anim | Unused rigs in Bolse, Macbeth, the Venom 1 boss and the Arwing |
| hitboxes | D_TI_6006874; D_AQ_6030B68, 6030BAC; D_KA_60111D8; D_BO_6011B20; Macbeth D_MA_6035B44..6035D38 (six 0x64 boxes), 6036250, 6036668 | Collision data for removed objects |

Other asset leftovers:
- **Shipped "test" names** (leak names matched to ROM bytes):
  - the Corneria on-rails ground `CN_Ground_test` (D_CO_601B640) with texture `CN_Groundtest01_txt`;
  - the Corneria backdrop texture `CN_BG_test_txt`;
  - the Aquas water `AC_Ground_test`;
  - the Bolse ground `BO_Ground_test` (D_BO_600BEC0).
  - **Label and confidence:** leak-supported + ROM byte match; high.
- **Aquas backdrop AC_BG02** (D_AQ_601C080) is selected only in an `else` inside `if (player.state == LEVEL_INTRO)` (fox_bg.c:447), so in practice it is never drawn. It is referenced by code, so it is not in the scan list. decomp; medium.
- **Title cards.** No unused title cards or map text exist: ast_map and ast_font_3d have no unreferenced nodes, and every level title card texture is reached. VERIFIED; high.

#### Unused text

**Radio messages** (ROM analysis, `un/radio.txt`):
gMsgLookup is at ast_radio+0xCCAC (V1.1 RAM 0x80185CBC, V1.0 0x8017BB2C), with 779 eight-byte entries:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | s32 | id | Message identifier. |
| 0x04 | 4 | u32 | text | Pointer to u16 text codes. |

- **What counts as used:**
  - its text pointer is built by code or stored in main/overlay data: 492 entries;
  - or its id appears as arg2 of an EVOP_PLAY_MSG (opcode 120) command in any asset file: 324 entries. This scan is conservative, over every even offset.
- **Result.** **52 messages are never referenced.** None of their `gMsg_ID_*` names appear in the decomp source.
- **Encoding.** Text is u16 codes per the CharCode enum in the decomp ast_radio.yaml header. `/` marks a line break; `[C-left]` and similar are the button glyphs.
- **V1.0.** The table's ids and texts are identical to V1.1 (only the pointers differ by 0xA190).
- **Label and confidence:** VERIFIED (ROM scan) + decomp; high.
- **Voice clips.** Whether voice samples exist for these ids was not checked.

| id | ast_radio offset / V1.1 RAM | text |
|---|---|---|
| 2080 | 0x01E48 / 8017AE58 | Don't be doing / anything foolish! |
| 5080 | 0x03884 / 8017C894 | Something's / not right. |
| 15254 | 0x08070 / 80181080 | Enemy behind. / Descend! |
| 18130 | 0x09970 / 80182980 | Stick around for / awhile. |
| 18140 | 0x099A8 / 801829B8 | Here's something / for ya, Fox. |
| 19467 | 0x0A328 / 80183338 | Hurry, Fox. / I'm waiting for you. |
| 20020 | 0x0A604 / 80183614 | Are you OK? |
| 20264 | 0x0AD48 / 80183D58 | Peppy! |
| 20265 | 0x0AD5C / 80183D6C | Falco! |
| 20268 | 0x0ADB8 / 80183DC8 | Heh heh.. / try and stop me. |
| 20270 | 0x0AE44 / 80183E54 | Incoming! |
| 20279 | 0x0B010 / 80184020 | Position confirmed. / Everything OK. |
| 20284 | 0x0B158 / 80184168 | Hold A to lock on / to the enemy. |
| 20285 | 0x0B19C / 801841AC | To get rid of the / aim, pause and / press R. |
| 20286 | 0x0B1F8 / 80184208 | Press C[<] [C-left] to / boost! |
| 20287 | 0x0B228 / 80184238 | Press [v] and C[<] [C-left] / to do a somersault. |
| 20288 | 0x0B278 / 80184288 | For a U-turn, / press [v] and C[v] [C-down]. |
| 20289 | 0x0B2C0 / 801842D0 | Press B to bomb. |
| 20291 | 0x0B338 / 80184348 | Press C[v] [C-down] / to brake. |
| 20292 | 0x0B368 / 80184378 | To hover, / press Z and R. |
| 21070-21073 | 0x0BE48-0x0BEB4 | I'm going right! / left! / up! / down! (four separate messages) |
| 21080, 21082, 21083 | 0x0BED8, 0x0BF24, 0x0BF44 | I'm going right! / up! / down! |
| 21090-21093 | 0x0BF68-0x0BFD4 | I'm going right! / left! / up! / down! |
| 22000-22002 | 0x0BFF8-0x0C020 | Graaaaaa |
| 22003 | 0x0C034 | Ugh! |
| 22004 | 0x0C040 | Ha ha ha! |
| 22005 | 0x0C058 | Ha ha ha ha! |
| 22006 | 0x0C074 | Whoa! |
| 22007 | 0x0C084 | Aaargh! |
| 22008 | 0x0C098 | Gwaaaa! |
| 22009 | 0x0C0AC | Gwaaaaaaaa! |
| 22010 | 0x0C0C8 | WHAT?! |
| 22011 | 0x0C0D8 | This is ONE / steep bill, / but it's worth it. |
| 22012-22020 | 0x0C130-0x0C1FC | Twin laser / Hyper laser / Smart bomb / Shield ring / Check point / Supply / Wing repair / Supply ring / Wing damage |

Interpretation (hypothesis):
- **20284-20292** are control tutorial lines. "To hover, press Z and R" and "To get rid of the aim, pause and press R" describe controls that differ from the retail game, so they are probably an earlier training script.
- **21070-21093** are three sets of wingman direction call-outs, one set per teammate.
- **22000-22010** are scream and laugh voice captions.
- **22011** is a shop-style line.
- **22012-22020** are item-name captions.

Other text:
- **Japanese menu and HUD text textures** in ast_common and the kanji 終 in ast_text (11.2). VERIFIED; high.
- **Leak-only Japanese config screen** (cf.o): see 11.7.

#### Debug features, codes and developer leftovers

**Crash debugger (sys_fault.c).** VERIFIED (ROM disassembly, both versions); high.
- **Code location.** `Fault_ThreadEntry` is at 0x80007D58 in both versions (ROM 0x8958). Its disassembly is identical in V1.0 and V1.1 apart from data relocations (`un/fault_v11.txt`, `un/fault_v10.txt`).
- **Visible hint.** When a thread faults (priority 1-126), it prints "-" at (300,10) (Fault_Printf, 0x80007DE8). It then loops on `Controller_UpdateInput` (0x800029A8).
- **Code entry.** The code is a 16-state switch, not a data table:
  - the jump table is at V1.1 0x800C85DC (ROM 0xC91DC) and V1.0 0x800C403C (ROM 0xC4C3C);
  - its 16 entries are identical in both versions: 80007E60, 7E7C, 7E7C, 7EB8, 7EB8, 7EF4, 7EF4, 7E7C, 7EB8, 7EF4 x5, 7F30, 7F6C.
- **Button constants in the code:**

  | address | constant | meaning |
  |---|---|---|
  | 0x80007E64 | `li at,0x16` | R + C-down + C-left, compared as an exact hold |
  | 0x80007E90 | 0x8000 | A |
  | 0x80007ECC | 0x4000 | B |
  | 0x80007F08 | 0x0002 | C-left |
  | 0x80007F44 | 0x1000 | START |

  The timers are 4000 (0x80007E78) and 3000 polls.
- **How to enter it.** After the crash, hold exactly **R + C-down + C-left**. Then, keeping R held, press **A, A, B, B, C-left, C-left, A, B, C-left, C-left, C-left, C-left, C-left, START**.
  - A wrong button resets the sequence.
  - Taking longer than the timer between steps also resets it.
- **Result.** `Fault_DisplayDebugInfo` (0x80007910) waits 3 s, then draws the thread id and cause, PC/SR/VA, every GPR, FPCSR, and F0-F30 into the framebuffer at osMemSize-0x25800.
- **Emulator attempt:** inconclusive.
  - I forced a load fault in V1.1 (debug core, run dir run-un) by writing 0x8C000000 (`lw $zero,0($zero)`) over the first instruction of Graphics_SetTask (0x80003C50) during the intro.
  - The game froze: controller polls and screenshots stopped.
  - The CPU kept cycling through the exception vector (0x80000184) and the handler at 0x800257D0-0x80025900. The fault thread (gFaultMgr 0x80145360, priority 0x7F) stayed blocked on its own queue 0x80145D10. So the code could not be entered and no register-screen screenshot exists.
  - The runtime agent's natural fault (notes/runtime.md 1.3) did reach the polling loop. The hypothesis is that a fault inside Graphics_SetTask interacts badly with the V1.1 exception path.

| item | location | evidence | label | conf. |
|---|---|---|---|---|
| Developer $Id strings | main (both versions) | `$Id: fox_edisplay.c,v 1.196 1997/05/08 08:31:50 morita Exp , `$Id: sprintf.c,v 1.5 1997/03/19 02:28:53 hayakawa Exp  | VERIFIED (string scan) | high |
| `"play_time = %d\n"` | V1.1 main+0xD7EA0 | fox_play.c:6992 PRINTF, a no-op in retail | VERIFIED | high |
| Audio debug strings | main | `CAUTION:WAVE CACHE FULL %d`, `Alloc Error:Dim voice-Alloc %d`, `Err :Sub %x ,address %x:Undefined SubTrack Function %x`, `WARNING: Before Area Overlaid After.`; DMA mode names SUPERDMA/FastCopy/SLOWCOPY/BGCOPY | VERIFIED | high |
| V1.1 remote debugger | V1.1 main 0x80029BA0-0x8002E3E0 (rmon, kdebugserver, osReadHost, osInitRdb); ramromMain thread 0x8002296C | A debug libultra build. kdebugserver is called from `__osException` and ramromMain is started by osCreatePiManager; rmonMain and osInitRdb are unreferenced. The strings `Set temp BP at %08x` and ` and %08x` exist only in V1.1 | VERIFIED | high |
| DMA table capacity | ROM 0xDE480 (V1.0 0xD9A90) | 90 slots, 64 used | VERIFIED | high |
| Leak TITL_DEBUG / MAP_DEBUG | leak `fox_title.c` (CameraTest, debug_display), `fox_map.c` (R+L on the map returns to the title) | The `#define`s are commented out, so the code is compiled out | leak-supported; absence hypothesis | medium |
| Leak `make_debug` / sys_debug | leak `Source/make_debug(_linux)` | Generates `date[]`/`user[]` under `#if 0 < FOX_DEBUG`; no such string in the ROM | leak + VERIFIED (string scan) | medium |
| Leak `Source/light_color` | developer light notes | Values for mc/cl/as differ from the ROM Macbeth, Area 6 and Meteo environments (earlier tunings); bm/sz match | leak-supported (compared with ROM) | high |

**Hidden features (unlocks stored in the save; brief).** All decomp names; function addresses from the ROM boundary map (`un/funcmap.json`); save data at gSaveFile 0x80178870. `planet[i]` holds 16 bit-field bytes: `expertMedal`, `expertClear`, `played`, `normalMedal`, `normalClear`. Label and confidence: decomp + VERIFIED addresses; high.
- **Expert mode and Expert Sound Options.** Option_Setup (ovl_menu 0x80191B20, V1.0 0x80187990) sets `sExpertModesEnabled` only if `normalMedal` is set for every save slot except SAVE_SLOT_VENOM_1.
  - The flag enables the expert cursor on "Main Game" and the Expert Sound Options on "Sound".
  - The sound test runs in Option_ExpertSound_Update (0x80195944): 45 tracks plus 5 medleys (6.4 / notes/music.md 11).
- **Versus Landmaster and on-foot.** Versus_InitMatch (main 0x800C1368, V1.0 0x800BCEE8) reads the SAVE_SLOT_VENOM_2 slot:
  - `normalClear` sets `sUnlockLandmaster`;
  - `expertClear` sets `sUnlockOnFoot`.
  - In the vehicle menu, B selects the Landmaster and a second button selects on-foot (fox_versus.c:431-466). Neither is offered on the Sector Z stage.
- **Title screen variant.** Title_Screen_Setup (0x801881FC) checks `expertMedal` on every slot except VENOM_1. If all are set, the team members' title-screen placements change (fox_title.c:582-681).
- **Where the medals are written:** at level end (fox_hud.c:1293-1305), on the map (fox_map.c:1805-1826), and after the ending when the Andross clear status is 1 or 2 (fox_option.c:437-457).

#### Dead code

**Method** (ROM analysis):
1. **Function starts.** Taken from the V1.1 ROM: the instruction after `jr ra` + delay slot, unless a branch of the current function or a jump-table word targets beyond it.
2. **Names.** Mapped by order to the decomp C function definitions of each file. 146 of 187 C files map exactly; 41 have count mismatches and are not mapped by order.
3. **References.**
   - jal/j targets and lui-pair values in all code, and data words in main and overlay data;
   - an overlay address is credited only from the same overlay or from main.
4. **Decomp check.** Separately, every decomp function whose name is used nowhere else in src/include (mods excluded) is listed with its ROM references (`un/deadcode_decomp.txt`, 142 functions).

**Result:** 154 function starts are unreferenced in the ROM (`un/deadcode.txt`). The interesting ones are below. Rows with an address have zero ROM references (VERIFIED); names, sizes and descriptions are decomp. Most of the rest are unused library helpers (Math_*, Matrix_*, Lib_TextureRect_* variants, RCP_SetupDL_* presets, audio helpers) and the V1.1 rmon suite.

| function | V1.1 address / size | what it does | label | conf. |
|---|---|---|---|---|
| Graphics_Printf | 800999D8 / 0x54 | vsprintf into gGfxPrintBuffer: a debug text printer with no caller | VERIFIED + decomp | high |
| Display_Unused | 80053B00 / 0x18 | an empty stub with 4 arguments ("Unimplemented") | VERIFIED + decomp | high |
| func_blur_800846F0 | 800846F0 / 0x240 | a CPU framebuffer filter: walks RGBA16 pixels over a region that grows with gSysFrameCount and averages neighbours (fox_blur.c) | VERIFIED + decomp | high (unused), medium (purpose) |
| func_col1_80097380 .. func_col1_8009893C (10 functions) | 80097380-80098980 | fox_col1.c polygon collision helpers: triangle-to-plane conversion and point/triangle tests of a collision path the retail code does not call | VERIFIED + decomp | high |
| func_radio_800BC040 | 800BC040 / 0x470 | a second radio state machine (state 100 opens portrait RCID_1000, then timers and scaling); never called | VERIFIED + decomp | high |
| func_pause_800A3E00 | 800A3E00 / 0x150 | a pause-mode state machine that switches gDrawMode to DRAW_UNK_7 and sets a fixed cutscene camera | VERIFIED + decomp | high (unused), low (purpose) |
| func_bg_80042D38 | 80042D38 / 0x188 | a background/ground draw variant keyed on the camera eye, with remnants of commented-out code | VERIFIED + decomp | medium |
| Player_CheckAllGoldRings | 800A6A74 / 0x4C | returns true when gold-ring counters 0-3 are all non-zero; no caller | VERIFIED + decomp | high |
| Player_ArwingBoost2 | 800B2BE0 / 0x20 | a wrapper around Player_ArwingBoost | VERIFIED + decomp | high |
| Effect_Effect350_Spawn | fox_enmy.c:690 (in a file not mapped by order) | spawns OBJ_EFFECT_350, a ground-level decal (scale 3/2, alpha 120); the only spawner of that unused effect id | decomp | medium |
| ActorEvent_OverrideLimbDrawUnused | fox_enmy2.c:3869 | a limb override that enables G_TEXTURE_GEN environment mapping on limbs 3 and 5 | decomp | medium |
| Aquas_CsCamera_Update, Aquas_801BEC8C | fox_aq.c:402; 801BEC8C (no refs) | a smooth-stepping cutscene camera; an empty "Unimplemented" stub | decomp (+ VERIFIED for 801BEC8C) | medium |
| Zoness_80193628 | 80193628 (no refs) | enemy-laser spawn helper | VERIFIED + decomp | high |
| Macbeth_801A5FC4, 801A67BC, 801AC42C, 801AD6E8, Macbeth_CsGreatFox_Setup | ovl_i5 (address-named ones have no refs) | empty stubs, and a Great Fox cutscene actor setup that is never used | VERIFIED (addressed ones) + decomp | medium |
| Ground_801B7240 | ovl_i5 801B7240 / 0x50 | Titania terrain slope helper returning angles in degrees | VERIFIED + decomp | high |
| Ending_8018B16C, Ending_8018B3E0 | ovl_ending / 0x8 each | empty stubs | VERIFIED + decomp | high |
| func_edisplay_80059BB0, 80059C28, 8005A010, 8005A07C, 8005A088, 8005BAAC, 8005F9DC; stub_80094D10/18; Play_dummy_800A5330; Versus_dummy_800C1758 | main | empty draw and HUD stubs | VERIFIED + decomp | high |
| Audio_PlayBgm (8001DCB4), Audio_StartEngineNoise/StopEngineNoise (8001CEFC/8001CF60), Audio_KillAllSfx (8001DC2C), Audio_SetSfxVolumeMod | main | unused audio API | VERIFIED + decomp | high |
| Lib_TextureRect_RGBA32, _IA16 (+MirX/MirY/MirXY), _CI4_Flip/_MirX/_MirY, _IA8_FlipMirX/Y; Animation_GetDListBoundingBox / GetSkeletonBoundingBox; Matrix_RotateAxis, Matrix_FromMtx, Matrix_GetXYZAngles; Math_Factorial(F), Math_PowF; Timer_SetValue | main | unused 2D blit and math library functions | VERIFIED + decomp | high |
| rmonMain, osInitRdb and the rmon command set | V1.1 main 0x8002B140.. | debug libultra, not started | VERIFIED | high |
| ovl_unused `Unused_80187520` / leak `look_shape` | ovl_unused | an empty function in an overlay whose scene is never loaded | VERIFIED | high |

#### Leak-only content (absent from the ROM)

**Method** (ROM analysis, output `un/leakshape.txt`):
1. For each of the 56 segment composites `nshape/US/*.o`, take `.data`/`.rodata` and mask every R_MIPS_32 relocation word (objdump -r).
2. Search the unmasked runs (at least 16 bytes, not single-valued, 256-byte chunks) in all decompressed V1.1 files, using a 4-aligned 8-byte index plus byte compare.

**Result.** 49 composites are **100 %** present. This includes every earlier "weak search" candidate except the ones below: SB_boss and BM_Hatch_L are inside sb.o/bm.o, BM03_Base inside bm03.o, and wp, jts, zo, sn, ac and bm03 are all present. **Absent:** bs.o (11.9 % of bytes found, generic texture fragments), cf.o (0.4 %), tt.o (0 %), s1.o (15.1 %), s2.o (12.3 %), s3.o (7.4 %), s4.o (30.6 %).
- **Rendering.** The absent sets were linked at segment 6 (ROM analysis: REL addend + symbol) and drawn with the viewer's display-list interpreter (`un/renderleak.ts`).
- **Label:** VERIFIED (absence by relocation-masked search) + leak-supported (names and meaning).

| leak item | what it is | evidence / render | conf. |
|---|---|---|---|
| **`nshape/US/bs.o` "BS" stage** (0x211B0 bytes, 138 display lists, no ROM counterpart) | A tile-grid model set `BS_A01`..`BS_W03` (rows A-W, columns 01-11), plus `BS_test01-32_txt` textures and `BS_an01-03`. Drawn together at identity they form one large white/grey structure, about 54000 x 29000 x 49000 units, with green light strips: a big base or station built from grid pieces. It matches the commented-out BS stage entries (11.1) and `Source/fox_bs_poly.h` | `png/leak_bs_all_persp.png`, `png/leak_bs_all_top.png` | high (absent), medium (interpretation) |
| **`nshape/US/cf.o` config screen** (45 textures) | A Japanese options/config screen: katakana labels (フォックス, ファルコ, スリッピー, ペッピー, テスト, ターゲット, バックアップクリア "backup clear" ...), a 112x84 N64 controller picture (CF_con), normal/reverse Arwing pitch icons (CF_normal_AW / CF_revers_AW), a 3D icon, button letters A/B/C/R/Z, and frames. Sizes come from the rgb2c headers in `nshape/CF_txt_*/*.c` | `png/leak_tt_cf_textures.png` | high |
| **`nshape/US/tt.o` test textures** | Four RGBA16 64x48 photos of food: `gyouza` (gyoza), `gyumesi` (beef rice), `karaage` (fried chicken), `yakimesi` (fried rice) | `png/leak_tt_cf_textures.png` (top row) | high |
| **`nshape/US/s1.o`-`s4.o`: older snapshots of the Corneria, Meteo, Titania and Sector X shape sets** | Most names also exist in the retail composites but with different bytes (older revisions). Name groups that exist only here: **s1 (CN):** CN_Enemyface01/02, CN_ATC_Pilot_01/02 (face textures), CN_Takirock/Takiroad (waterfall), CN_Mt_Niji ("rainbow mountain"), CN_Gate_01, CN_Kumo/Kumo_04 (clouds), an older CN_Ground, CN_HiwayTX, CN_Boss_down(action). **s2 (AS):** AS_Bosspilot (Meteo boss pilot face). **s3 (TI):** a complete **different Titania boss** `TI_Boss_*` (about 100 parts: legs, wings, tail, heart, lips, hammer, beam hand, "ArwinHand"/"ArwinGuard" animations), enemies `TI_Tremars`, TI_sanddust01-06, TI_BG, TI_Ground. **s4 (SX):** an **older Sector X boss** `SX_Boss_*` (body, head, mouth, arms, `kama` sickles, `tama` projectiles, skeleton); the retail Spyborg (`SX_Handboss_*`) is also in s4 | `png/leak_s3_TI_Boss_parts.png`, `png/leak_s4_SX_Boss_parts.png` (parts at identity), `png/leak_s1_CN_only_*.png`; per-group coverage in `un/leakshape.json` | high (absent), medium (roles) |
| Sequences not in the ROM | `BGM_kondo/Seqs/atack.com` (1997-03-27), `BGM_wakai/Seqs/BossAF.com` (1997-02-05), older `Music2.com` (Corneria, 1996-12-13), `Titania.com`, `Aquarie.com`, `test.com`. Renders in `mus/wav/leak/` (font choice is a hypothesis) | notes/music.md 9 | high |
| `Source/AND360_map` | Map-editor output ("Ver1.4", dated Sun Mar 16 1997) of the Andross all-range placement: 155 entries against 156 in ROM aVe2AndLevelObjects (ast_andross+0x356CC). 149 positions are identical, 6 exist only in the map and 7 only in the ROM, so it is an earlier revision | `un/` inline python (entry compare) | high |
| Leak voice/SFX data and staff roll | SFX/voice sequences, bank 2 and seq 42 differ from the ROM (notes/music.md 9) | VERIFIED byte compare | high |

Unusual leak files (leak-supported):
- **`Source/fox_fuyeeeth.c`** (213 KB, EUC-JP, dated 96-10-02, no object file in the leak) is a HUD / "文字を表示する" (display characters) source. It contains mission_no_disp, score_suuji_disp, zanki (lives), nakama_stat (teammate status), new_shield_meter_disp, message_boad, FO_Base_disp/move, pilot_name and AW_p_init, i.e. an ancestor of the decomp's fox_hud.c.
- **`Source/tmp_motor.c`** is a temporary shim that defines `osMotorStart`/`osMotorStop` via `__osMotorAccess` and wraps `osInitialize`. It was probably used before the libultra in use had Rumble Pak calls.
- **`Source/fox_reset.c.bak`** (1996-10-23) is an early `call_reset` (reset wipe using Fast3D-era names). `fox_reset.o` references `gspFast3D*` microcode symbols, which suggests a pre-F3DEX build artefact. The decomp's fox_reset.c differs.
- **`Source/fox_tr2.o`, `fox_tom.o` and `fox_cl.o` are in the ROM**, so they are not leak-only:
  - fox_tr2.o holds the Training all-range code (TR_360_Stage_Set, TR_Cont, TR_enemy_move, TR_enemy_yama_check); 3 of 4 functions match both ROMs;
  - fox_tom.o is the `tomprog` overlay stub (`stage_prog`, `tomdt`) of ovl_menu and matches;
  - fox_cl.o is the Area 6 boss (Gorgon: cl_boss_*, core/shell/tentacle tables, CL_start_demo, CL_Clear_Demo); 9 functions match, 6 differ only in codegen (`fs/tmp/leakver.out`).
- **iQue (China) material:**
  - **`i10n/worksheet_ique.html`** is the "StarFox64 Asset Localization Worksheet". It covers voice text `voice/sf64msgs.txt` ("preserve # lines and 5 digit msg IDs") and the English demo, level-name, map, level-end ("moji") and menu textures, which were to be redrawn as `*_Z_*` Chinese versions following the "iQue game translation guideline".
  - `i10n/misc_words.txt` lists ranking/menu words (TOTAL HITS, RANK IN!!, the pilot names, OK, DOWN, TOP, CONGRATULATIONS, STARFOX RANKING, NAME, HITS, TOTAL SCORE), and `i10n/credits.txt` has the English credits.
  - **`Source/metadata`** holds the iQue Player title data: `title_e.txt` "StarFox"; `title_z.txt` "星际火狐" (GB2312); `isbn.txt` "ISBN 7-900381-09-0" (a Chinese ISBN); `title.inta`, an SGI image (magic 474) of 184x24 intensity+alpha showing "星际火狐"; `thumb.rgba`, a 56x56 RLE SGI RGB thumbnail of Fox and Slippy, saved from "E:/work/sf64/metadata/thmub.rgb". Decoded to `png/leak_ique_title.png` and `png/leak_ique_thumb.png` (ROM analysis).
  - **Region and version.** This is the iQue Player (mainland China) localisation. It was built from the English US code base of the **V1.0 lineage**: the leak's English objects carry V1.0 behaviour and none of the V1.1 fixes (*The leak and the versions*). `LOCALE==CHINA` in `Source/spec` and `audio/zh/` belong to the same effort.
  - Confidence: high for the region, medium for the build lineage.

### 6.2 Cut or inaccessible levels

### 6.3 Debug features

### 6.4 Prototype or revision-specific content

## 7. nviewer implementation

### 7.1 Module mapping

#### New modules (suggested)

| file | contents | port from |
|---|---|---|
| `src/rom/sf64/fs.ts` | table pattern search, MIO0, file cache by DMA index/vrom, per-version address sets, scene decoding | `fs/proto/sf64fs.ts` (tested on both ROMs) |
| `src/rom/sf64/space.ts` | segment resolver: scene setup → 15 segment files, plus main (0x80000450 base) | `lv/proto/sf.ts` `Space` |
| `src/rom/sf64/levels.ts` | level list (*Level list*), per-entry recipe: scene, placement list pointer, loader z sign, environment record, ground recipe | `lv/proto/decode.ts` |
| `src/rom/sf64/objects.ts` | ObjectInfo table, drawType-1 recipes, fixed bases, event-actor model walk, skeleton frame-0 walk, Titania terrain | `lv/proto/extras.ts`, `events.ts` |
| `src/rom/sf64/env.ts` | environment record → Fog, clearColor, lights, backdrop/sky (*Skies, backdrops, starfields*, *Fog, lights, clear colour, camera*) | runtime notes |
| `src/rom/music/sf64.ts` | sequence player and synthesizer (*Music*) | `mus/proto/` |

#### Difficulty

| part | effort | notes |
|---|---|---|
| file table, MIO0, scenes, segment resolver | small | reference TS exists and is tested |
| placement, scenery, sprites, presets, grounds | small-medium | prototype ~600 lines; everything decodes with the existing DL interpreter |
| event actors (space levels) | medium | script walk + 108-entry model table + per-type recipes |
| skeletons (frame 0) | small | |
| Titania terrain | medium | deterministic simulation, no type 8 in the data |
| lighting model | medium | needs normals or per-instance baking |
| backdrops, starfields, fog | see *Skies, backdrops, starfields*/*Fog, lights, clear colour, camera* | |
| music | see *Music* | |

### 7.2 Supported features

### 7.3 Approximations and omissions

## 8. Verification and remaining work

### 8.1 Verification evidence

The unreferenced-asset scan traversed 3,749 nodes. A disassembly cross-check found only
`gMsgLookup` and `aVsLandmasterCanonDL` name-referenced; radio-font textures are reached through
absolute pointers. Display lists and textures were rendered for visual inspection. V1.0 and
V1.1 message IDs and text matched. The crash debugger and unlock-function addresses were checked
against disassembly; composite asset candidates were checked with relocation-masked searches and renders.
An emulator fault test observed execution at 0x800257D0–0x80025900 and 0x80000184.

### 8.2 Known unknowns

#### Open questions

- Whether voice samples exist for the 52 unused radio ids. The voice sequence was not mapped to message ids.
- The purpose of several dead functions (func_pause_800A3E00, func_bg_80042D38, func_blur_800846F0) is inferred from their bodies only.
- 41 C files could not be name-mapped by boundary count, so dead functions in them (fox_edisplay, fox_enmy, fox_effect, fox_hud, most level overlays) are listed only when their decomp names encode addresses.
- The crash screen could not be shown in the emulator: the induced fault looped in the V1.1 exception path. A natural fault (runtime notes 1.3) should allow entering the code.
- The BS stage layout is drawn from the pieces' own coordinates; there is no placement data or code for it in the leak or the ROM.

### 8.3 References
