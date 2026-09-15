# BattleTanx — Nintendo 64 ROM format specification

This manual describes the shipped data formats needed to identify, extract, and
present BattleTanx content. Claims state their evidence inline; unsupported
interpretations are labelled hypotheses.

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | Fixed ROM tables and LZARI-compressed level resources. |
| Compression | LZARI with a 4 KiB dictionary. |
| Graphics microcode | F3DEX 1.21. |
| Geometry | Chunked level meshes and placed objects. |
| Textures | RDP-native textures selected by model display lists. |
| Collision | Spatial grid of triangle and object records. |
| Music driver | libultra `alSeqPlayer` with Standard MIDI files. |
| Audio microcode | Stock libultra RSP audio task; exact ABI revision is not established. |
| Sample encoding | Nintendo VADPCM; the bank format also permits RAW16. |
| Levels | Campaign and battle maps. |
| Memory requirement | Base 4 MiB. |
| Viewer support | USA revision 0. |

### 1.2 ROM identification

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| USA | `BATTLETANX` | `NBXE` | 0 | 8 MiB (`0x800000`) | `6AA4DDE7` | `E3E2F4E7` | `535860d941738ac1210c20a9b80114fea0e0ff17` | CIC-6102 | — |

Verified from the normalized ROM headers and complete-image SHA-1 hashes.

### 1.3 Terminology and conventions

ROM and memory ranges are half-open. Offsets, addresses, encoded sizes, masks,
and opcodes are hexadecimal unless stated otherwise. Multi-byte CPU fields are
big-endian. RAM addresses are virtual unless explicitly identified as physical;
segmented, VROM, and file-relative addresses are named at each use.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

#### Boot and code: Shared

- IPL3 copies ROM 0x1000.. to the entry point 0x80071000, so for the main image **RAM = ROM + 0x80070000**.
- The entry stub sets `sp`, zeroes BSS with a word loop, then `jal main`:

| | BTX1 | GA |
|---|---|---|
| Initial sp | 0x8014E0C8 | 0x8021E0B8 |
| BSS cleared | 0x80147040..0x803D8880 | 0x80127E30..0x803B17B0 |
| main | 0x800779CC | 0x8009ED9C |

#### Boot and code: BTX1

**Main code is not compressed.** The linked image is ROM 0x1000..0xD7040, which maps to RAM 0x80071000..0x80147040. The boundaries below come from disassembly, not from a symbol table.

| RAM | ROM | Content |
|---|---|---|
| 0x80071000-0x80071038 | 0x1000 | entry stub |
| 0x80071038-0x80076000 | 0x1038 | rodata: floats and jump tables (e.g. 0x800749B0) |
| 0x80076000-0x80125550 | 0x6000-0xB5550 | .text (last `jr ra` at 0x80125548) |
| 0x80125550-0x80147040 | 0xB5550-0xD7040 | data / rodata |

- **ROM 0xD7040-0xD7360:** a 0x320-byte asset copied to 0x803D8880 by 0x8007D4E8.
- **ROM 0xD7360-0x100000:** unreferenced junk from the PC build environment, e.g. UTF-16 strings like "SPECIFICADDRESSSPACE" at 0xE0000. The IPL3 copies it, but BSS clearing zeroes it.
- **No overlays, decompressed code or game TLB segments.** The only TLB write is libultra's osMapTLBRdb at 0x80113790.
- **Microcode:** F3DEX 1.21. G_VTX and triangle indices are stored doubled.

libultra and I/O functions:

| RAM | Function |
|---|---|
| 0x800779CC | main |
| 0x80077930 | `romread(u32 cartAddr, void *dst, u32 len)`: osInvalDCache + osPiStartDma(OS_READ) + blocking osRecvMesg. All asset reads go through it (48 call sites). |
| 0x801185D0 | osPiStartDma |
| 0x80119100 | osPiRawStartDma (reads osRomBase at 0x80000308) |
| 0x80112E70 | osEPiRawStartDma-style routine |
| 0x801191E0 | osPiRawReadIo (**Hypothesis**) |

### 2.2 Memory and address mapping

Address conversions and load destinations are specified with the executable and file tables above.

### 2.3 ROM map and asset organization

#### Filesystem: BTX1

**All reads** go through `romread` 0x80077930 (see 2.3).

**There is no numbered file table.** Callers load start/end pairs of cart addresses from lui/addiu constants and pass `end - start` as the length. There are 48 `romread` call sites and 32 LZARI call sites.

##### Tables
| RAM (ROM) | Layout | Used by |
|---|---|---|
| 0x80125A68 + 16*id (internal id, 4.2.1) | Level record: +0 A_start, +4 A_end, +8 B_start, +0xC B_end (cart addresses; ends exact, not aligned) | Filled at runtime by 0x800865E0; read by the level loader 0x80088CF0 (A) and 0x800DDA08 (B) |
| 0x801354EC (0xC54EC) | 28 pointers to level display names, in **menu-index order**. Map to internal ids through the u8 permutation 0x801352B0 (4.2.1). | 0x800D9F30 |
| 0x801416F8[id], then 0x80141768 + 16*k | img16 image record {u32 start, u32 end, u32 w, u32 h}; k = -1 means none | 0x800F5960 |
| 0x80141560[id], then 0x80141308 + 40*k | img40 image record {start, end, 4 x i32, 2 x f32, 8 x u8}; k = 0 means none | 0x800F5960 |
| 0x801259DC + 3*id (internal id) | 3 bytes (RGB) per level. The Arena entry, 0x909CA4, equals its in-game fog colour (section 5). | passed to 0x8007D430 |
| 0x80125714 | 20 pointers: song i is the byte range [t[i], t[i+1]). 19 Standard MIDI files. | 0x80079C28 |
| 0x80134058, 0x80134B88 | 20 pointers into the 10 LZARI image banks 0x2E2CD0-0x308290 | 0x800C80E8, 0x800CA8C0 |
| Jump table 0x800749B0 | World/scenario file by index `*(u32*)0x80137904` (0..11); level id per index at 0x8013790C | 0x800EC418 |

Audio bank addresses (set up by 0x8007A004):

| Bank | .ctl | .tbl |
|---|---|---|
| SFX | 0x215620-0x217EC0 | 0x100000 |
| Music | 0x298D60-0x29A710 | 0x217EC0 |

The font/HUD bank is chosen by 0x801053B0(a0): a0 = 0 selects 0x2C3E50, a0 = 1 selects 0x2CB230.

##### Codec
LZARI, identical to GA (section 3.1.2), with the decompressor at 0x800F4F60. The LZARI files are:
- 22 level-A files
- 18 level-B files
- 30 front-end / image banks

Together they are 0x20EED2 bytes stored and 0x3DF322 bytes decoded.

##### ROM map
Verified by static references, plus a dynamic check: 2500 `romread` calls logged in the debug emulator during three attract-demo loads of level 0 all fall inside extracted file boundaries.

| ROM range | Content | Codec | Referenced from |
|---|---|---|---|
| 0x000000-0x001000 | header + IPL3 | raw | |
| 0x001000-0x0D7040 | main image | raw | IPL3 |
| 0x0D7040-0x0D7360 | 0x320-byte blob copied to 0x803D8880 | raw | 0x8007D7DC / 0x8007D820 |
| 0x0D7360-0x100000 | PC build junk | | nothing |
| 0x100000-0x215620 | SFX sample table (.tbl) | raw | 0x8007A070 |
| 0x215620-0x217EC0 | SFX ALBankFile (.ctl, magic `B1`) | raw | 0x8007A038 |
| 0x217EC0-0x298D60 | music sample table (.tbl) | raw | 0x8007A02C |
| 0x298D60-0x29A710 | music ALBankFile (.ctl) | raw | 0x8007A0A4 |
| 0x29A710-0x2C19B0 | 19 Standard MIDI files (`MThd`) | raw | table 0x80125714 |
| 0x2C19B0-0x2C3E50 | third font bank | raw | **none**, only the MIDI table's end sentinel (section 10) |
| 0x2C3E50-0x2CB230 | font/HUD bank 0 | raw | 0x80105464 |
| 0x2CB230-0x2D2790 | font/HUD bank 1 | raw | 0x8010543C |
| 0x2D2790-0x2E2CD0 | front-end bank | LZARI | 0x800AB8BC |
| 0x2E2CD0-0x308290 | 10 image banks | LZARI | tables 0x80134058 / 0x80134B88 |
| 0x308290-0x319B30 | 5 raw banks | raw | 0x800F5960 |
| 0x319B30-0x3D16D0 | 11 world/scenario files | raw | 0x800EC418 |
| 0x3D16D0-0x3EA970 | 4 front-end banks | LZARI | menu code |
| 0x3EA970-0x49C740 | **geometry pool**: 4756 F3DEX1 DL+vertex chunks, plus 3 unreferenced gaps | raw | level A section 6 |
| 0x49C740-0x5A1110 | front-end data: 1 raw file + 15 LZARI menu-screen banks | raw / LZARI | menu code |
| 0x5A1110-0x6F9C40 | **texture pool**: 561 chunks (render-state DL + texels), plus 8 bytes of padding | raw | level A section 6 |
| 0x6F9C40-0x738900 | 18 level-B files | LZARI | level records |
| 0x738900-0x7B69A0 | 22 level-A files | LZARI | level records |
| 0x7B69A0-0x7E3210 | 17 img16 level images | raw | 0x800F5960 |
| 0x7E3210-0x7E3250 | 0x40 bytes of text junk | | nothing |
| 0x7E3250-0x7EA060 | 14 img40 level images, including the unreferenced 0x7E76D0-0x7E7C50 | raw | 0x800F5960 |
| 0x7EA060-0x800000 | 0xFF fill | | |

##### Stored-data conventions
- **Level A** (decoded) starts with 9 u32 **file-relative** section offsets `h[0..8] = [0x24, s1, s2, s3, s4, s5, s6, end, end]`. The loader adds the load address to each.
  - Section k spans `[h[k], h[k+1])`; section 0 is the part after the 0x24-byte header.
  - This reading gives whole record counts in every file checked: internal id 0 (Cinematic) has s5 = 0x410/4 and s6 = 0x44E0/16; id 9 (Chicago - Bonus) has s5 = 0x314/4 and s6 = 0x2320/16; id 17 (San Francisco - Bonus) has s5 = 0x3FC/4 and s6 = 0x3FB0/16.
  - Section 6, the pool index, has 16-byte entries: +0 u32 offset into the texture pool 0x5A1110, +4 u16 flags, +6 u16 size, +8 u32 offset into the geometry pool 0x3EA970, +0xC u32 size. Section 5 has 4-byte entries: {u8 count, u8 ?, u16 first section-6 index}. See section 5 for the rest.
- **Level B:** the u32 fields at +4, +0xC, +0x10, +0x14, +0x18 and +0x1C are file-relative and get relocated at load.
- **Pool chunks** use **chunk-relative** addresses. At load, 0x80085290 adds the chunk's load base to every G_VTX operand and 0x800852E0 to every G_SETTIMG operand.
- Chunks are deduplicated by offset into two lists: ctx+0x936C holds up to 256 texture chunks (read at 0x8008AA38) and ctx+0xA374 holds up to 1800 geometry chunks (read at 0x8008AB4C).
- Stored data contains no segmented or absolute RAM pointers.

##### Extracting every file
- **Command:** `python3 btx/fs1/extract.py [ROM] [OUTDIR]`, about 30 s. It writes 5473 files as `NNNN_{romoff}_{name}.bin`, decoded where applicable.
- **Index:** `index.csv` has the columns id, rom_offset, stored_size, decompressed_size, codec, first4, type_guess, name, group, filename, note and code_refs.
- **Levels:** `levels.csv` holds the per-level mapping. Its ranges are indexed correctly by internal id, but **its level names are wrong** (taken from the menu-order table). Use the names in 4.2.2.
- **How the pools are split:** chunk boundaries are the union of all levels' section-6 entries.

### 2.4 Compression formats

#### Mapping to the viewer: Codec (shared)

- **New module `src/rom/lzari.ts`:** one function `lzariDecode(src: Uint8Array, offset: number): Uint8Array`, used by both games.
  - Port it directly from `btx/fs2/lzari.py`, about 120 lines of TypeScript; the algorithm is specified in section 3.1.2.
  - Use typed arrays: `Uint16Array` for the symbol tables and `Int32Array` for `position_cum`.
  - Keep low/high/value as plain numbers: they stay below 2^18, and `range * cum` stays below 2^33, which is exact in doubles.
  - Allocate `size + 60` bytes and truncate.
- **Difficulty:** low.
- **Performance (measured):** the TypeScript ports `lvl1/lzari.ts` and `lvl2/lzari.ts` decode byte-identically to the extractors.
  - BTX1 level-A files (about 0x5000-0xB000 bytes decoded) take 70-80 ms each in Node 20.
  - A whole GA level (common + two world files) loads in under 1 s, including display-list interpretation.
  - Decode in the worker; this cost is acceptable.

#### Verification evidence: Filesystem and codec

| Check | Method | Result |
|---|---|---|
| GA main image uncompressed, RAM = ROM + 0x80070000 | Data pointer ROM 0xAB6D4 = 0x800732D4, which points to "WASHINGTON DC - MALL" at ROM 0x32D4 | Pass |
| GA LZARI decoder | `fs2/lzari.py` decodes all 271 LZARI blobs; decoded world headers are self-consistent (h0 = 0x20, h7 = file size, whole record counts, e.g. common world 0x3F6EE8: 1 / 244 / 327 / 1200 records) | Pass |
| GA level-file switch | Debug emulator, breakpoint at 0x800BA6C0 during the boot cutscene: level 0, mode 0, count 2, starts {0xB03F9B60, 0xB03FDA70}, ends {0xB03FCCB0, 0xB03FEA2A}, matching the cutscene column in 4.1 | Pass |
| GA world coverage | Every byte of 0x3F6EE8-0x46F652 belongs to one of the 75 referenced world files | Pass |
| BTX1 LZARI identical to GA | GA's decoder (`fs2/lzari.py`) decodes BTX1 internal level 0 (Cinematic) A (0x738900) to 0x7EC0 bytes with header [0x24, 0x304, …, 0x7EC0, 0x7EC0]; the BTX1 extractor decodes all 70 BTX1 LZARI files | Pass |
| BTX1 file boundaries | Debug emulator: 2500 `romread` calls logged over three attract-demo loads of level 0; all start at an extracted boundary and stay inside it. One false boundary at 0x320018 was found and fixed. After load, the in-RAM read lists (133 texture, 778 geometry chunks) are a subset of level 0's static section-6 set (138 / 840) | Pass |
| Cross-game leftover | The GA 0x100000 blob decodes byte-identical to BTX1 internal level 9 (Chicago - Bonus) A | Pass |

Scripts and logs:
- `fs1/extract.py`, `fs1/romlog.txt` (emulator read log)
- `fs2/extract.py`, `fs2/lzari.py`, `fs2/xref.py`, `fs2/romrefs.py`

### 2.5 Loading process

Level and asset selection is described by the tables and loader call paths above.

### 2.6 Revision differences

Revision-specific addresses and data differences are stated in the relevant tables.

## 3. Level data

### 3.1 Level catalog and identifiers

#### Levels: BTX1

##### Two level numberings (verified)
BTX1 numbers its levels in two ways, and they are easy to confuse. (fs1's `levels.csv` names are wrong for this reason: it took names from the menu-order table.)

**Internal level id (0..27).** Every per-level table is indexed by this id:
- the level record `0x80125A68 + 16*id` {A_start, A_end, B_start, B_end}, filled at runtime by 0x800865E0 (zero in ROM);
- the RGB table `0x801259DC + 3*id`;
- the f32 table at 0x8012596C: the vertex-colour scale, 1.92 for every id. At load, 0x80086DC0 multiplies the r, g, b bytes of every G_VTX vertex by it and clamps to 255;
- the i16 far-plane table 0x80125A30;
- the img16 index `0x801416F8[id]` and the img40 index `0x80141560[id]`;
- the level-music jump table 0x80071378.

The game-setup structure pointed to by `*(u32*)0x801B4ABC` holds the current internal id at +4. Internal names are fixed strings at ROM 0x1568 / RAM 0x80071568, padded to 4-byte alignment; stub table 0x80071668 returns name i.

**Menu index (0..27).** The display-name pointer table at 0x801354EC (ROM 0xC54EC) is in menu order. A menu index maps to an internal id through the u8 permutation at 0x801352B0 (ROM 0xC52B0), which the menu cursor 0x8013566C indexes (result stored to 0x80135674):
`[15, 11, 12, 8, 7, 24, 3, 1, 14, 16, 6, 2, 4, 25, 26, 9, 17, 13, 5, 0, 20, 21, 22, 23, 27, 10, 19, 18]`.

**Evidence for the mapping:**
1. The coordinator re-read the permutation and both name tables from ROM; every display name matches its internal name.
2. A RAM dump in New York - Queens holds exactly internal id 1's geometry chunks, and no other level contains all 8 sampled chunks.
3. The Arena's in-game fog colour 0x909CA4 equals RGB[24].
4. At runtime in campaign level 1 (Queens), setup+4 = 1 and the level-music handler receives a0 = 1.
5. The four bonus levels (5, 9, 13, 17) share img16 record 0x7B7FB0 and have no img40.

##### Level table (by internal id)
All ROM ranges are start-end, taken from the runtime-filled records.
- **A:** LZARI level file. **B:** LZARI companion file.
- **img16 / img40:** level title image (CI8) and radar map (CI4); formats in 5.1.2.
- **Chunks:** distinct geometry / texture pool chunks.
- **RGB:** table 0x801259DC.
- **Song:** level music (section 6.2).

| Id | Internal name | Menu | Display name | A | B | img16 | img40 | Chunks | RGB | Song |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | Cinematic | 19 | Cinematic | 738900-73B2ED | - | - | - | 840 / 138 | 3C3C3C | stop |
| 1 | Bronx | 7 | New York - Queens | 73B2F0-742D4E | 6F9C40-6FEE7B | 7D58F0 | 7E6160 | 859 / 156 | 191934 | 7 |
| 2 | Tunnel | 11 | New York - Tunnel | 742D50-7472BF | 6FEE80-7017CF | 7DB6F0 | 7E47A0 | 737 / 132 | 000004 | 2 |
| 3 | TimesSquare | 6 | New York - Times Square | 7472C0-74F0F3 | 7017D0-70510B | 7B9280 | 7E5AD0 | 937 / 166 | 181934 | 0 |
| 4 | NyBridge | 12 | New York - Washington Bridge | 74F0F8-754EEE | 705110-709533 | 7DD680 | 7E6890 | 652 / 120 | 504968 | 17 |
| 5 | NyBonus | 18 | New York - Bonus | 754EF0-756FA0 | 709538-709BFE | 7B7FB0 | - | 626 / 106 | 541C0C | 6 |
| 6 | Highway | 10 | Midwest - Highway | 756FA0-75EC8F | 709C00-70D997 | 7D7CD0 | 7E3C00 | 912 / 155 | 747080 | 3 |
| 7 | Lakeshore | 4 | Chicago - Lake Shore Drive | 75EC90-767ED4 | 70D998-711DCF | 7C3890 | 7E8C20 | 1164 / 186 | 514941 | 1 |
| 8 | StateSt | 3 | Chicago - State Street | 767ED8-76FE3E | 711DD0-716B2E | 7C74D0 | 7E8490 | 1068 / 190 | 494955 | 18 |
| 9 | ChBonus | 15 | Chicago - Bonus | 76FE40-771EA8 | 716B30-7175C6 | 7B7FB0 | - | 562 / 106 | 242420 | 6 |
| 10 | Desert | 25 | Desert | 771EA8-77A36E | 7175C8-71B3DA | 7CD1F0 | 7E3250 | 530 / 125 | 8C7448 | 16 |
| 11 | Area51 | 1 | Area 51 | 77A370-783327 | 71B3E0-722A4D | 7B69A0 | 7E6E90 | 1052 / 176 | 847C64 | 4 |
| 12 | FremontSt | 2 | Las Vegas - Fremont Street | 783328-78A974 | 722A50-726272 | 7BD750 | 7E7C50 | 1630 / 192 | 080400 | 5 |
| 13 | LvBonus | 17 | Las Vegas - Bonus | 78A978-7909F2 | 726278-727F76 | 7B7FB0 | - | 587 / 117 | 6C603C | 6 |
| 14 | SfBridge | 8 | San Francisco - Golden Gate Bridge | 7909F8-79731D | 727F78-72D02C | 7D14B0 | 7E5560 | 586 / 123 | 607C9C | 8 |
| 15 | Wharf | 0 | San Francisco - The Wharf | 797320-79EB33 | 72D030-730C8C | 7BB850 | 7E9370 | 1509 / 188 | 9498BC | 6 |
| 16 | QZone | 9 | San Francisco - Quarantine Zone | 79EB38-7A6187 | 731460-73789B | 7DA500 | 7E5000 | 936 / 158 | 8790D0 | 10 |
| 17 | SfBonus | 16 | San Francisco - Bonus | 7A6188-7A8868 | 730C90-731460 | 7B7FB0 | - | 919 / 126 | 48507C | 6 |
| 18 | MPWharf | 27 | MPWharf | no data | | | | | 808080 | stop |
| 19 | MPMissile | 26 | MPMissile | no data | | | | | 808080 | stop |
| 20-23 | Spare1..Spare4 | 20-23 | Spare1..Spare4 | no data | | | | | 808080 | 0 |
| 24 | Test1 | 5 | The Arena | 7A8868-7ADEE6 | 7378A0-7388F5 | 7E2040 | 7E9840 | 609 / 126 | 909CA4 | 0 |
| 25 | Test2 | 13 | Test 2 | 7ADEE8-7B0F3F | - | - | - | 508 / 115 | 808080 | 0 |
| 26 | Test3 | 14 | Test 3 | 7B0F40-7B4508 | - | - | - | 952 / 170 | 808080 | 0 |
| 27 | Test4 | 24 | Test4 | 7B4508-7B69A0 | - | - | - | 617 / 128 | 808080 | 0 |

Notes:
- **Loader:** 0x80088CF0(a0 = internal id) for A and the pools; B is loaded by 0x800DDA08, the images by 0x800F5960.
- **Song "0"** for ids 20-27 is the jump table's out-of-range default.
- **The Arena** is internally named "Test1".

##### Attract / scenario files
Jump table 0x800749B0 selects a raw world/scenario file by index `*(u32*)0x80137904` (0..11). Loader: 0x800EC418.

| Index | File | Internal id (0x8013790C) | Level |
|---|---|---|---|
| 0 | 0x319B30 | 0 | Cinematic |
| 1 | 0x334630 | 0 | Cinematic |
| 2 | 0x348DB0 | 0 | Cinematic |
| 3 | 0x364100 | 1 | Queens |
| 4 | 0x3747F0 | 6 | Highway |
| 5 | 0x380670 | 6 | Highway |
| 6 | 0x383CC0 | 6 | Highway |
| 7 | 0x38BBE0 | 25 | Test2 |
| 8 | 0x3A0820 | 14 | Golden Gate |
| 9 | 0x3B9630 | 27 | Test4 |
| 10 | 0x3C1550 | 26 | Test3 |
| 11 | 0x364100 | 1 | Queens |

- In attract-demo mode (setup mode 8) the loader takes its internal id from this table; level 0 was seen loading this way in the emulator.
- **Hypothesis:** the files are recorded demo or scenario data.

##### In-game menus and level order (BTX1)
Verified in the emulator unless marked otherwise. Screenshots are in `btx/ref1/shots/`; input sequences are in `notes/ref1.md`.

**Menu flow.** Title, then START, then the Controller Pak "Create BattleTanx Note" screen (B), then **GAME SETUP**: Players / Playmode / Options / Credits / Input Code / Load Game / Start Game.
- **Playmode** (1 player): Campaign, Battlelord, Deathmatch, Family Mode.
  - The mode-name table at ROM 0xC4E40 also has "Annihilation". **Hypothesis:** multi-player only.
- **Options:** SFX Volume, Music Volume, Difficulty, Powerups, Powerup Regen, Base Defense, Unlimited Ammo, Controller Config. There is no music test or jukebox.

**Campaign.**
- A new game shows the "THE FALL" story crawl, then loads **New York - Queens** (verified; runtime internal id 1).
- There is no level select. The Input Code screen accepts **level codes**: the checker 0x800DD544 decodes a level field that is the internal id, valid 2..17.
- Verified with HPJMKGMCJV, which gives "VALID LEVEL CODE". Starting a campaign then loads Chicago - Bonus (runtime id 9), with score 479000 as decoded.

**Campaign order: internal ids 1..17 in sequence, with a bonus stage after each region.** Only level 1 was played; the rest is a strong **hypothesis**. The evidence:
1. 15 valid public level codes decode to ids 2, 3, 4, 7, 8, 9, 11, 12, 13, 15 and 17, with their army and score fields rising monotonically with id.
2. The 13 briefing texts at ROM 0xD1877 and the objective strings at 0xD2712 follow this order.

| # | Id | Level | Briefing / objective |
|---|---|---|---|
| 1 | 1 | New York - Queens | "Ground Zero", DESTROY 5 TANKS |
| 2 | 2 | New York - Tunnel | "No Man's Land", CROSS THE TUNNEL |
| 3 | 3 | New York - Times Square | DESTROY 15 TANKS |
| 4 | 4 | New York - Washington Bridge | "Stranglehold Bridge", CROSS THE BRIDGE |
| 5 | 5 | New York - Bonus | |
| 6 | 6 | Midwest - Highway | "break through the Psycho Brigade" |
| 7 | 7 | Chicago - Lake Shore Drive | |
| 8 | 8 | Chicago - State Street | |
| 9 | 9 | Chicago - Bonus | |
| 10 | 10 | Desert | briefing calls it "Armageddon Highway" |
| 11 | 11 | Area 51 | |
| 12 | 12 | Las Vegas - Fremont Street | |
| 13 | 13 | Las Vegas - Bonus | |
| 14 | 14 | San Francisco - Golden Gate Bridge | "Crimson Gate" |
| 15 | 15 | San Francisco - The Wharf | |
| 16 | 16 | San Francisco - Quarantine Zone | RESCUE MADISON |
| 17 | 17 | San Francisco - Bonus | |

**Battlelord.** Start Game leads to TEAM ALIGNMENT (A), CHOOSE GANG (A), then **OCCUPIED TERRITORIES**, a US-map level select.
- With 1 player it shows **menu indices 0..7 only** (verified). D-right steps, wrapping after 8, and The Arena is the default.

| Menu index | Internal id | Level | Difficulty shown |
|---|---|---|---|
| 0 | 15 | San Francisco - The Wharf | Hard |
| 1 | 11 | Area 51 | Hard |
| 2 | 12 | Las Vegas - Fremont Street | Medium |
| 3 | 8 | Chicago - State Street | Medium |
| 4 | 7 | Chicago - Lake Shore Drive | Medium |
| 5 | 24 | The Arena (default) | Easy |
| 6 | 3 | New York - Times Square | Easy |
| 7 | 1 | New York - Queens | Easy |

- Selecting The Arena loaded internal id 24 (verified).
- Deathmatch, Family Mode and 2+ player lists were not checked.

**Not reachable from any normal menu seen:**
- 0 Cinematic: the attract fly-by, via scenario files.
- 25..27 Test2..Test4: referenced by the attract/scenario table 0x8013790C (world indices 7, 9, 10). Story and front-end code also selects world indices 7 and 9 (**hypothesis:** story cutscene sets; 9.2).
- 18..23: no data.
- Level codes reject ids of 18 and above.

**Suggested viewer level list** (BTX1):
1. The campaign, ids 1..17 in order. Ids 5, 9, 13 and 17 get kind `bonus`.
2. The Arena (24), kind `battle`.
3. Hidden or test content: 0 Cinematic, 25 Test2, 26 Test3, 27 Test4.

### 3.2 Level container

#### Level format: Level data format

##### Shared engine structure (both games)
Both games use the same 3DO engine design.

Level geometry is **not** stored as whole display lists. Each level file (LZARI) holds:
- a header of file-relative section offsets (section k = [h[k], h[k+1]));
- **placements**: position plus a yaw about Y, 65536 = 360°;
- **models**: bounding box plus LOD parts;
- **parts**: lists of pool references;
- **pool references**: offsets and sizes into **raw, uncompressed ROM pools** of small display-list chunks.

The chunks carry chunk-relative G_SETTIMG / G_VTX addresses, patched at load. Chunks are deduplicated by offset.

At draw time, each instance gets a G_MTX MODELVIEW LOAD with its placement matrix, then the texture/state lists, then the geometry list (G_VTX + G_TRI1 only).

Both games are right-handed with Y up, use 1 vertex unit = 1 world unit, and have no mirror (5.0).

| | BTX1 | GA |
|---|---|---|
| Header | 9 u32 | 8 u32 |
| Pools | texture+state 0x5A1110, geometry 0x3EA970 | TEX 0x102C70, PB (state) 0x2F8070, GEO 0x3013F0 |
| Vertex bytes 12..15 | RGBA colour (x1.92 at load) | s8 normal x,y,z + alpha (lit) |

##### BTX1 level files (verified)
- **Loaders:** 0x80088CF0(internal id, world buffer, ...) decodes file A with LZARI (caller 0x800820CC, into 0x803DA800), fixes up its header and reads the pool chunks. File B is loaded by 0x800DDA08.
- **Coverage:** all 22 ids with data (0-17, 24-27) load through the prototype `lvl1/loader.ts`, in 0.3-0.6 s each.

**Header:** 9 x u32 file-relative offsets h[0..8]. Section k = [h[k], h[k+1]). h[7] = h[8] = file size, so section 7 is empty.

| Section | Record | Layout |
|---|---|---|
| hdr0 | one 0x2E0-byte block at 0x24 | level header (below) |
| hdr1 | 20 B | object group: u16 count, u16 first hdr2 index, f32 x0, z0, x1, z1 |
| hdr2 | 28 B | object (below) |
| hdr3 | 12 B | model: u8 lodType, u8 0, u16 first hdr5 index, i16 xmin, zmin, xmax, zmax (footprint) |
| hdr4 | 4 B | model range: u8 count, u8 0, u16 first hdr3 model (used by kinds 5 (5 models), 6 (3), 8 (2)) |
| hdr5 | 4 B | LOD piece list: u8 count, u8 0, u16 first hdr6 index |
| hdr6 | 16 B | piece: u32 texture-pool offset (from ROM 0x5A1110), u16 anim, u16 texture-chunk size, u32 geometry-pool offset (from ROM 0x3EA970), u32 geometry-chunk size |

**hdr0:**

| Offset | Content |
|---|---|
| +0x00 | f32 xmin, zmin, xmax, zmax |
| +0x10 | f32 x4 outer bounds (negated, passed to the grid init 0x80106B60) |
| +0x20 | u32 flags |
| +0x24, +0x60, +0xD8, +0x18C | 5 / 10 / 15 / 20 x {f32 x, f32 z, f32 heading} spawn tables. These are prefixes of each other: four groups of 5 near the four base objects (kinds 11-14). Spawn yaw = heading x 0x2000. Verified: in the Arena dump the player tank sits at entry 15, (2588, 67, heading -2.0), drawn with yaw 0xC000. |
| +0x27C | u32 group count |
| +0x280 | i32 group start (-1: groups start at record 0) |
| +0x284.. | mission parameters |
| +0x2DC | u32 |

**hdr2 object:**

| Offset | Field |
|---|---|
| +0 | u8 flags: 0x01 private geometry copy (0x80088360); 0x02 player-count gate (bits 2-3 index 0x801260A4); **0x10 only when `0x8007C6D8()` is true; 0x40 only when it is false** |
| +1 | u8: high nibble = viewport visibility bits (0 = never drawn); low nibble = texture animation mode |
| +2 | u8 param |
| +3 | u8 layer |
| +4 | u16 param4 |
| +8 | u32 kind |
| +12 | f32 x |
| +16 | f32 z |
| +20 | u16 yaw (65536 = 360°) |
| +22 | i16 hdr4 index |
| +24 | i16 hdr3 model |

- **Modes.** The setup-struct mode `*(u32*)*0x801B4ABC` is 5 in Campaign, 0 in Battlelord, 7 for the code-loaded bonus stage, and 8 in the attract demo (runtime values from dumps). `0x8007C6D8()` is true for modes 3..6.
  - The spawn code at 0x80088748..0x80088784 skips flag-0x10 objects unless it is true, and skips flag-0x40 objects when it is true.
  - So **campaign shows flag 0x10 and hides flag 0x40; Battlelord does the opposite.** The Queens campaign frame draws 10 flag-0x10 objects.
- **Kinds** (spawn switch 0x80088788, jump table 0x80071768; kinds 1..31 dispatch through 0x800718D8).
  - **Markers, never drawn** (model 0): 10 = pickup spawn (ref1's medkit and green pickup sit exactly on kind-10 records), 21, 22, 23, 24, and 25 = player start (stored per team by 0x800887B0; the Queens start (1945, 2667, yaw 0x8000) is the ref1 tank position).
  - **Static drawables confirmed in frame display lists:** 0 (draw pass 0) and 1, 3, 5, 6, 7, 8, 9, 19, 27 (pass 2).
  - **Other kinds:** 11-17, 20, 26, 30 and 31 are treated as static by the dispatcher; their behaviour is not identified. No file contains kinds 28 or 29.
- **Models and LOD.**
  - lodType 0/1: one LOD.
  - lodType 2: LOD1 beyond 300.
  - lodType 3: LOD1 beyond 1000, LOD2 beyond 1700, by squared XZ distance from the camera (builder 0x800824E4).
  - The 13 lodType-3 models own the only pieces not used at LOD 0: 75 in every level.
  - Model 0 is a real one-piece model in every level.
- **Groups.** World draw 0x80083394 culls hdr1 groups along one axis with ±450 + far. Per object it tests the viewport-visibility bit (4 + viewport) and a box test (0x800962B4).

**Pool chunks** (deduplicated by offset: ctx+0x936C holds up to 256 texture chunks, ctx+0xA374 up to 1800 geometry chunks).
- **Geometry chunks (4756):**
  - They contain only G_VTX, G_TRI1 and G_ENDDL, with at most 32 vertices.
  - G_VTX w1 is chunk-relative; 0x80085290 adds the load base.
  - Vertex (16 B): s16 x, y, z, u16 0, s16 s, t, u8 r, g, b, a.
  - **At load, vertex r, g, b are multiplied by f32 0x8012596C[id] (1.92 for every id), truncated and clamped to 255** (0x80086DC0).
- **Texture chunks (561).**
  - **Layout:** a render-state DL, then G_SETTIMG (chunk-relative; 0x800852E0 adds the base), SETTILE, LOADTLUT / LOADBLOCK and SETTILESIZE (tile 0 corner always (0,0)), then G_ENDDL. The texels follow the ENDDL.
  - **Render modes in ROM:** ZB_OPA_SURF 387, AA_ZB_TEX_EDGE 161, ZB_XLU_SURF 7, ZB_XLU_DECAL 3, other 3.
  - **Culling:** set per chunk by G_SETGEOMETRYMODE 0x2000 (G_CULL_BACK, 382 chunks) or G_CLEARGEOMETRYMODE 0x3000 (179).
  - **Formats (tile 0):** RGBA16 270, CI4 with RGBA16 TLUT 214, RGBA32 51, I4 3, I8 1. Mostly 32x32, 64x64 and 64x32, up to 128x32.
  - **Sampling:** dxt is 64..2048 (texture.ts's odd-row emulation applies). cms/cmt use repeat, mirror and clamp.
  - **Colour combiners** (all 561): 531 TEXEL0 x SHADE; 22 PRIMITIVE, with the colour from a G_SETPRIMCOLOR in the chunk; 4 TEXEL0 only; 4 (ENV - PRIM) x TEXEL0 + PRIM, with colours set by game code.
- **Render-mode patch.** With the fog flag 0x80125854 = 1 (seen in every dump), the loader (0x80085330) replaces whole command words matching the 15-entry table 0x80125860 (ROM 0xB5860) with the words at 0x801258D8 (ROM 0xB58D8). These are fog versions of the modes and combiners. Examples:
  - cycle type 1CYCLE → 2CYCLE;
  - geometry mode 0x201 → 0x10201 (+G_FOG);
  - ZB_OPA_SURF → 0xC8112078;
  - AA_ZB_TEX_EDGE → 0xC8113078;
  - ZB_XLU_SURF → 0xC81049D8;
  - ZB_XLU_DECAL → 0xC8104E50.

  Verified in RAM (queens1.bin); the renders use the patched chunks.
- **Animated textures** (hdr6 anim != 0).
  - **File format:** the stored anim word is `nframes << 11 | byte offset` of a frame table after the chunk's G_ENDDL. The loader stores `(offset >> 3) | (n << 11)`.
  - **Chunk contents:** a CI4 image with N palettes, each loaded with G_LOADTLUT into slot n (TLUT address 0x100 + 16n, up to 14 slots). The table holds N G_SETTILE tile-0 commands that differ only in the palette field (w1 bits 20-23).
  - **Draw:** the game copies command #frame inline after the texture DL (0x8007EF64).
  - **Frame selection** (0x800837A4): object anim nibble < 14 → fixed frame nibble; 14 → frame counter 0x801B4AA0 / 2 mod n; 15 → counter mod n.
  - Most palette sets are **12 team colours**, chosen per object by the fixed nibble.
  - Frame sheets: `lvl1/sheets/anim_1.png`, `anim_24.png`.

**Draw pipeline.**
- **Per piece** (0x800824E4 → 0x80080728, bucketed by texture DL in 32 hash buckets per pass at 0x801C0840 + 128·pass):
  1. `G_DL` texture chunk;
  2. G_MTX MODELVIEW LOAD with the object matrix (only when it changes);
  3. inline animation G_SETTILE, if any;
  4. `G_DL` geometry chunk.
- **Object matrix** (0x800A76BC): m00 = cos, m02 = -sin, m20 = sin, m22 = cos, translation (x, 0, z). As a column-major 4x4: `[c,0,-s,0, 0,1,0,0, s,0,c,0, x,0,z,1]`, angle = yaw/65536·2π. Matches the dump, e.g. yaw 0x4000 at (2376, 0, 1944).
- **Passes:** kind 0 → 0, kind 28 → 6, kind 29 → two passes, other kinds → 2.
- **Flush order:** 0x800803B8 calls 0x80080EEC (passes 0, 6, 5, 1, 2, 3), then 0x80081934, then 0x80081788 (pass 4 last).
- **Frame setup:** 0x8007DE80..0x8007E0C0 (5.0).

**Images.**
- **img16** (records 0x80141768 + 16·k {start, end, w, h}; index 0x801416F8[id]): **level title images.** 256-entry RGBA16 palette (512 B), then CI8 w x h, padded to 16 bytes. Record 0 decodes to "GROUND ZERO" (`lvl1/img/img16_rec*.png`).
- **img40** (records 0x80141308 + 40·k: +0 start, +4 end, +8 w, +12 h, +16 cx, +20 cy, +24/+28 f32, +32 u8 x 8; index 0x80141560[id]): **radar maps.** 16-entry RGBA16 palette (32 B), then CI4 w x h, padded to 16 bytes. All 14 record sizes fit, and the aspect ratios match the level shapes (`lvl1/img/img40_*.png`).

**File B:** relocated fields at +4, +0xC..+0x1C; pointer global 0x80135834. Its meaning is a hypothesis (9.2).

**Scene split by kind** (viewer layers in `src/rom/battletanx.ts`). The file has no other grouping to split along (hdr1 groups only cull), so drawn objects are grouped by kind, following the draw pass and the collision class (5.1.3). Content was identified from renders of each kind alone (Queens, Golden Gate Bridge); it is an observation, not a game-defined name.

| Layer | Kinds | Content seen |
|---|---|---|
| ground | 0, 16, 17 | street and lot tiles (kind 0: draw pass 0, no collision, model height ≤ 8); flat pads (16, 17, height ≤ 6) |
| buildings and walls | 1, 26, 30 | walls and building walls, curved bridge rails (26), small bunkers (30); static collision |
| scenery (no collision) | 7 | large set pieces that register no collision: the crashed airliner, bridge cables and towers, distant blocks |
| destructibles | 5, 6, 8, 9, 20, 31 | ruined building shells (5), cars (6), wall and fence segments (8), drums, crates and kiosks (9) |
| bases | 11-14 | the four team bases |
| kerbs and tank traps | 19, 27 | tank-only collision: kerbs and rails (19), tank traps (27) |
| props | the rest (3, 15) | posts and small props that block nothing |

**Per-level placed geometry** (prototype, campaign/all filter; instances / triangles / textures):

| Id | Level | Instances | Triangles | Textures | Id | Level | Instances | Triangles | Textures |
|---|---|---|---|---|---|---|---|---|---|
| 0 | Cinematic | 198 | 4374 | 48 | 12 | Fremont Street | 948 | 9622 | 92 |
| 1 | Queens | 1392 | 20257 | 73 | 13 | LV Bonus | 1367 | 9892 | 37 |
| 2 | Tunnel | 705 | 10506 | 48 | 14 | Golden Gate | 1236 | 11417 | 46 |
| 3 | Times Square | 1205 | 16926 | 80 | 15 | Wharf | 980 | 7044 | 89 |
| 4 | Washington Bridge | 1042 | 8547 | 42 | 16 | Quarantine Zone | 1297 | 9548 | 60 |
| 5 | NY Bonus | 187 | 3062 | 26 | 17 | SF Bonus | 134 | 2334 | 30 |
| 6 | Highway | 1434 | 8829 | 56 | 24 | The Arena | 1127 | 5792 | 29 |
| 7 | Lake Shore | 1587 | 11401 | 80 | 25 | Test2 | 450 | 2557 | 29 |
| 8 | State Street | 1322 | 12700 | 84 | 26 | Test3 | 297 | 3267 | 63 |
| 9 | Chicago Bonus | 218 | 2960 | 27 | 27 | Test4 | 267 | 1078 | 44 |
| 10 | Desert | 1930 | 9830 | 43 | | | | | |
| 11 | Area 51 | 1605 | 15701 | 67 | | | | | |

##### BTX1 collision (verified)
BTX1 stores **no collision mesh, heightfield or collision section**. At load, the object handlers insert one **2D oriented rectangle** per collidable object into a spatial grid, and all tank and shell collision queries that grid. The ground (kind 0) never collides, and the world has no heights: ground vertices lie at y 0..49 in levels 1, 2, 4, 14 and 24, bridges and the tunnel included, and the tank's modelview translation has y = 0.

**Shape of an entry** (from level file A):
- Local box: the hdr3 footprint of the object's model (i16 xmin +4, zmin +6, xmax +8, zmax +10), grown by a margin m on every side. m = 1 (f32 1.0 at 0x80071894) for kinds 1, 8, 19 and 27, otherwise 0.
- Position: the hdr2 x and z, **truncated to integers**; yaw from hdr2 +20.
- World corners (0x80108E74, the same rotation as the draw matrix): with c = cos(yaw·2π/65536) and s = sin(...), `X = x + c·lx + s·lz`, `Z = z − s·lx + c·lz`. The footprints are therefore oriented rectangles, not axis-aligned boxes.
- The loader's mode filter applies first (0x80089A7C: flag 0x10 campaign only, 0x40 non-campaign only).

**Which kinds register** (handler table 0x800718D8, indexed by kind − 1; insert 0x80106D18(owner, x, z, xmin, xmax, zmin, zmax, flags, yaw)):

| Kind | Handler | Grid flags | Owner (+8) | Margin | Class |
|---|---|---|---|---|---|
| 1 | 0x80089D5C | 0xF85F | 0 | 1 | static |
| 26 | 0x80089EA0 | 0xF85F | 1 | 0 | static |
| 30 | 0x80089E10 | 0xF85F | 2 | 0 | static |
| 19, 27 | 0x80089F30 | 0x001A | 0 | 1 | blocks tanks, shells pass |
| 5, 11-14, 20, 31 | entity 0x80091E98 | 0xF85F | entity pointer | 0 | destructible |
| 8 | entity 0x800ECC1C | 0xF85F | pointer | 1 | destructible |
| 9 | 0x800907CC | 0xF95F | pointer | 0 | destructible |
| 6 | 0x80091D6C / 0x800F05F4 | 0x0056 | pointer | 0 | low destructible |
| 15 | 0x800907CC | 0x0020 | pointer | 0 | registered, blocks nothing |

- **Never registered:** kind 0 (ground), 7, the marker kinds 10 and 21-25, 28 and 29.
- **Kind 3** registers through 0x800EF984 with flags 0x52 and an inverted ±10 box, so it blocks nothing. The viewer leaves it out.
- **Flag 0x02** (player-count gate): the object is kept only if the mode is 0, 3, 4 or 6 (or 0x800EC644() is true) and `u8 0x801260A4[(flags >> 2) & 3] < *0x801B4AB8`. The table is runtime state ([0,1,2,3] in ROM, [3,2,1,0] with count 2 in the Arena dump), so these objects (base walls and bases) depend on the player setup. In campaign (mode 5) none exist.
- **3-4 viewports:** kinds 3, 6, 9, 15 and 18 become kind 7 (table 0x80071898, at 0x80089BEC) and lose collision.
- Every collidable object has a non-zero visibility nibble, so BTX1 has **no invisible collision-only objects**.

**Runtime grid:**
- Entry pool: 1300 × 40 B at 0x803B8248. Cell heads: 4 layers × 20×20 u16 at 0x803B75B0; cell = (coord + origin + {0 or 1024}) >> 11 (2048-unit cells). List heads: oversize 0x803B8230, free 0x803B8234, used 0x803B8240.
- Entry: +0 u16 grid flags, +2/+4 next/prev, +8 owner, +14/+16 s16 x, z, +18/+20/+22/+24 s16 xmin, xmax, zmin, zmax (margin included), +26 bounding radius, +28 u16 yaw, +30..+37 per-layer links.
- Grid init 0x80106B60 takes the hdr0 +0x10 outer rectangle (the +0x00 inner rectangle grown by 100) negated; origin = −outer min + 500 (globals 0x803B8238 / 0x803B823C). Insert rejects positions beyond ±origin.
- Other functions: remove 0x80107170, move 0x801074AC, set / clear flag bits 0x80106C9C / 0x80106CCC.
- **Queries.** Tank movement 0x80108B68(box, self, mask, velocity) sweeps the mover in each candidate's local frame (pair test 0x8010B9C8, then 0x8010B740 / 0x8010AC90), i.e. an oriented-box test. Tanks use mask 0x10 (tank byte +0x40A, set at 0x800979CC). The segment query 0x8010874C(start, end, mask, ...) is used by shells with mask 0x04 (0x8008D030).
- **After destruction** an entry's flags become 0xF802 (a kind 8 in Times Square) or 0x42 (kind 6): it no longer blocks tanks or shells.
- On a shell hit, owner 1 (kind 26) skips the effect call 0x80093D50 (branch at 0x8008D29C), while owner 2 (kind 30) calls 0x800A6688 / 0x800A51E8(..., 37). **Hypothesis:** different impact effects.

**Not collision:** 0x800962B4 is viewport frustum culling (via 0x80094C58); hdr1 groups only cull drawing; no collision code reads level B.

**Verification against RAM dumps** (walking the used list of the live grid and matching x, z, yaw, footprint, flags and owner; script `btxcol/r1/btxcol.ts {id} [campaign|battle] --ram dump.bin`):

| Dump | Level | Decoded entries matched | Left over |
|---|---|---|---|
| `ref1/arena1.bin` | 24, Battlelord | 268 of 277 | 9 flag-0x02 objects the gate removed (6 kind 1, kinds 11, 12, 14) |
| `ref1/queens1.bin` | 1, campaign | 458 of 493 | 24 flag-0x02 objects (absent in campaign), 5 kind 6 and 6 kind 9 (**hypothesis:** destroyed during play) |
| `lvl1/dumps/ts1.bin` | 3, campaign | 522 of 523 | 1 kind 6; 3 more matched with rubble flags |
| `ref1/bonus1.bin` | 9 | 40 of 40 | none |

- The static kinds 1, 19, 26 and 27 match exactly in every dump. The flag-0x02 gate is confirmed in the Arena: entries with object flags 0x0A, 0x0B, 0x0E and 0x0F are present, those with 0x02, 0x03, 0x06 and 0x07 absent.
- **Unverified (static evidence only):** kind 30 (in no dump), kinds 20 and 31, and any use of the hdr0 inner rectangle (no reader found; **hypothesis:** the drivable edge).

**Viewer overlay** (`src/rom/battletanx.ts`, hidden layer "collision"): one world-space mesh per class (static, destructible, low destructible, tank-only, passable, and flag-0x02 "conditional"), each rectangle drawn as a prism from y = 0 to the top of the object's model (the game has no heights), 1 unit outside the footprint and above the model so it does not z-fight. Batch.triSource holds the hdr2 record offset in decoded file A. Offline renders with the collision layer over the level: `btxcol/img1/` (`*_cmp.png`: level, level + collision, difference).

### 3.3 Geometry

#### Verification evidence: Level geometry decoded from level data

**GA** (prototype `lvl2/run.ts`, renders in `btx/lvl2/renders/`)

Each render uses the camera matrix from the RAM dump, so it can be placed side by side with the screenshot:

| Render | Level | Result |
|---|---|---|
| `sfairport_compare.png` (screenshot left, render right) | SF AIRPORT campaign, camera from `ref2/air1.bin` | **Match.** The grey terminal wall with red doors is on the right, the airliner tail upper left, and fog colour and horizon agree. Only dynamic objects (tank, fire, HUD) are missing. The coordinator inspected this image. |
| `breakout_compare.png` | SF BREAKOUT, camera from `brk1.bin` | Match: the garage doorway, blue drums and beams. |
| `panhandle_compare.png` | SF PANHANDLE battle, camera from `pan1.bin` | Match: row houses, pillared fence, trees and the end wall. |
| `cmp_panhandle_start.png` | PANHANDLE, chase view from the kind 17 player start (slot 3) | The layout matches `ref2/shots/50_*`. Yaw 0xC000 faces +X, and the tank's forward axis is model -Z. |
| `sfairport_cullccw_compare.png` vs `sfairport_cullcw_compare.png` | winding test | Culling screen-clockwise triangles matches the game (6. in the recipe). |
| `cmp_sfairport_lit_vs_baked.png` | lighting bake | Per-pixel lighting vs baked vertex colours are identical within 1/255. |
| `cmp_dcmall_capitol_smithsonian.png`, `dcmall_top.png` | DC MALL | **Landmarks recognisable.** A US Capitol (kind 10 dome plus kind 3 wings) at x ≈ 6192, z ≈ -1150; the Mall lawns and a long pool; a turreted red-brick Smithsonian-Castle-like building at x ≈ -2590. The coordinator inspected this image. There is no Washington Monument model. |
| `whitehouse_top.png` | WHITE HOUSE | A white building with an oval portico inside a walled square. |
| `champs_*_cam.png` | CHAMPS ELYSEE start | **Not matched.** Every player-start slot and direction tried faces a wall; the start camera of `ref2/shots/20_*` was not reproduced. |

- **Texture contact sheets** (`lvl2/sheets/`, each `.png` with a `.txt` index): `sfairport_campaign` (63 textures), `dcmall_battle` (91), `panhandle_battle` (46).
- Unused content renders are listed in section 10.1.

**BTX1** (prototype `lvl1/compare.ts`, renders in `btx/lvl1/renders/`)

Level renders use the exact PROJECTION matrices from RAM dumps: `ref1/queens1b.bin` and `arena1.bin`, plus a new dump `lvl1/dumps/ts1.bin`. That Times Square dump was reached with level code LHTTTBKRLS in an emulator session: VALID LEVEL CODE, then Campaign Start Game (mode 5, id 3). Screenshots are in `lvl1/shots/ts_before_dump.png` and `ts_after_dump.png`.

| Render | Result |
|---|---|
| `cmp_queens1b.png` (screenshot / cull-CW / cull-CCW / mirrorX) | **Match** with CCW front faces: road, building and gantry layout, wrecked car, colours at x1.92, fog. One unexplained difference: a thin white kerb edge on the right (model 3 piece 3, a TEXEL0 x SHADE RGBA16 texture). |
| `cmp_arena1.png` | **Match**: fortress wall blocks, tree line, fogged distant trees, kerb lines, lamp posts. Culling CCW removes the ground, and mirrorX displaces the layout. The coordinator inspected this image. |
| `cmp_ts1.png` | Match, although the screenshot is mostly covered by the tank. |
| `strips_14_obl40.png`, `top_14_campaign(_obl50).png` | **Landmark: Golden Gate Bridge**, with deck, towers and cables, plus a crashed airliner. |
| `top_1_campaign.png`, `top_3_campaign(_obl50).png`, `top_24_battle.png` | Overviews of Queens, Times Square and The Arena. |
| `top_0_all(_obl50).png`, `top_10_campaign_obl50.png`, `top_11_campaign_obl50.png`, `top_25/26/27_all(_obl50).png` | Cinematic, Desert, Area 51 and the test levels (10.2). |
| `levelb_1.png`, `levelb_24.png` | Level B records drawn as triangles over the map (9.2). |

**Mean absolute pixel difference against the screenshot** (lower is better):

| View | cull CW (front = CCW) | cull CCW | mirrorX |
|---|---|---|---|
| Queens | **11.4** | 18.3 | 16.7 |
| Arena | **21.6** | 63.5 | 31.5 |
| Times Square | **17.5** | 19.8 | 19.8 |

**Other checks:**
- **No mirror:** 0 of 255 / 387 / 275 geometry modelview matrices in the queens1b / arena1 / ts1 frames have a negative determinant.
- **Object filtering** (`lvl1/dlmatch.ts`): every unit-scale static geometry draw in the three frames matches a file object by (x, z, yaw, content-matched geometry chunk). Every in-view object with a non-zero visibility nibble is drawn, except the marker kinds.
- **Texture contact sheets:** `lvl1/sheets/tex_1.png`, `tex_24.png`; animated palette frames in `anim_1.png`, `anim_24.png`.

### 3.4 Display lists and render state

#### Level format: Runtime render state (both games; verified from RAM dumps of the running games)

This section covers state the game code sets, not the level files. It was captured by breaking on osSpTaskStartGo, dumping RDRAM, and walking the frame display list with the game's own segment table.

| | BTX1 (dumps: Queens, The Arena, Chicago - Bonus) | GA (dumps: SF Airport, SF Breakout, SF Panhandle) |
|---|---|---|
| Microcode | F3DEX 1.21 (task ucode 0x8010E230, ucode_data 0x801452A0) | F3DEX2 fifo 2.07 (ucode 0x800F8E80, data 0x80125EC0) |
| Graphics-task breakpoint | osSpTaskStartGo 0x8011CF8C (a0 = OSTask*) | `jal __osSpSetStatus` inside osSpTaskStartGo at 0x801103B8 |
| Frame DL | 0x8031AFF0 (Queens), 0x8031B0F0 (Arena, Bonus) | alternates 0x80157F80 / 0x80157E80 |
| Segments set by the frame DL | 0 = 0, 1 = 0x3C8880, 2 = 0x1B4B80 / 0x1B4B98; nearly all other addresses are plain KSEG0 | 0 = 0, 1 = 0x3B17B0, 2 = 0x129480 |
| Triangle commands | G_TRI1 only | G_TRI1 only |
| Projection | One G_MTX PROJECTION\|LOAD holding lookAt x perspective (16.16). Near 16.0, vertical fov 37.0°, aspect 4:3, perspNorm scale 1. **Far varies per frame**: Queens 1799 to 1900 during the level start, Arena 4949 to 4800, Chicago Bonus 2500 | Same form: view x perspective, near 16.0, fovy 37.0°, fovx 48.1°, aspect 4:3. Far at dump time: SF Airport 2799.9, SF Breakout 4998.0, SF Panhandle 3652.5. The far plane is adaptive, not per level (see below) |
| Modelview | G_MTX MODELVIEW\|LOAD per object: model to world placement, det +1. Yaw in 90° steps, translations on a 36-unit grid (Queens) | Same. Ground tiles are 288 x 576 unit quads at y = 0 on a 288/576 grid |
| **Handedness** | **Right-handed, Y up, no mirror** (view rotation det +1). Queens, camera facing -Z: the medkit at world x = 1764 projects to screen x 69 (left) and the pickup at x = 2124 to x 250 (right), as in the screenshot. A software render with the game matrices matches screenshots of Queens and The Arena (`ref1/shots/60_*`, `61_*`) | **Right-handed, Y up, no mirror** (det +1, right x up = -forward). A wireframe with the game matrices matches the screenshots: SF Airport terminal on the right and airliner tail upper left (`ref2/air1_wire.png` vs `ref2/shots/31_*`); SF Breakout garage (`brk1_wire.png`) |
| Fog | G_FOG on every triangle. Factor multiplier 25600, offset -25344 (= gSPFogPosition(995, 1000)) in every dump. Colour: Queens animates 0x431C22 to 0x3B1C25 while the far plane sweeps at level start; Arena 0x909CA4 (= RGB table 0x801259DC[24]); Chicago Bonus 0x242420 (= RGB[9]) | G_FOG on every triangle; same factor. Colour: SF Airport and SF Panhandle (121,124,160), SF Breakout (102,90,112) |
| Sky / background | **No sky geometry.** FILLRECT clears the z-buffer (0xFFFC), then a full-screen colour FILLRECT approximately equal to the fog colour: Queens 0x40C9 / 0x38C9, Arena 0x94E9, Bonus 0x2109 (RGBA5551) | **No sky geometry.** Z clear, then a colour FILLRECT: 0x7BE9 = (123,123,165) at SF Airport and SF Panhandle, where screenshot sky pixels read (123,123,164); 0x62DD at SF Breakout |
| Back-face culling | G_CULL_BACK on most triangles: 952/1611, 1349/1545, 424/456 | 935/1041, 855/1098, 665/805 |
| Lighting | Never on; vertex RGBA is colour | **G_LIGHTING on**; vertex colour bytes are normals (e.g. 00 7F 00 FF) |
| Textures | RDP tile style: SETTIMG + SETTILE + LOADTLUT/LOADBLOCK + SETTILESIZE. Formats CI4 (RGBA16 TLUT), RGBA16, some IA8, I4, RGBA32, IA16 | Same style (also G_LOADTILE). At draw: RGBA16 mostly, then CI4, I4, I8 |
| Vertices | Stored, model space, byte-identical between frames (only 56/508 dynamic-object vertices change) | Stored, byte-identical between frames (level heap about 0x8023F000-0x8033C000) |
| HUD | G_TEXRECT (34-40 per frame) | G_TEXRECT (CI4 minimap, IA8) |
| Scale examples | Tank about 70 wide x 45 tall x 167 long; buildings about 205 tall; chase camera about 170 behind and 74 above the tank | SF Airport camera 73 units above ground, looking 10° down |

What this means for level data (derived from the rows above):
- **Vertex units are world units.** Modelview matrices carry no scale (det +1), and the projection works in the same units (near 16).
- **Do not mirror.** The game's own matrices are unmirrored and right-handed, so the viewer must not negate X as it does for the Rush games.
- **Winding carries over unchanged.** The Rush games needed the mirror to reproduce their on-screen winding. Here the unmirrored data already gives the game's winding, so `cullBack` carries over with the viewer's counter-clockwise front-face convention.
  - **Verified for GA:** with the game's own camera from a RAM dump, culling screen-clockwise triangles (front = CCW) reproduces the frame, while culling CCW removes the ground (8.5).
  - **BTX1:** see 8.5.
- **The sky is a clear colour** equal (or nearly equal) to the fog colour.
- **Fog maps directly onto `Fog`:** `{color, multiplier: 25600, offset: -25344, near: 16, far}`. Where the values come from (verified from code by the level-format work):
  - **BTX1, far plane.** Its target is the i16 table 0x80125A30[internal id]: [5000, 2000, 2000, 2000, 2000, 2500, 5000, 3000, 5000, 2500, 5000, 5000, 5000, 2500, 2000, 3000, 2500, 2500, 2000, then 5000 for ids 19-27]. 0x80086AE8 returns it. The current far value is 0x80125858, which runs below the target (Queens 1800 to 1900, Arena 4950 to 4800).
  - **BTX1, fog and clear colour.** 0x8007D430 initialises the working colour 0x801257C4 from the RGB table 0x801259DC[internal id].
    - The frame setup 0x8007DE80..0x8007E0C0 uses it for G_SETFILLCOLOR + FILLRECT (the sky clear), G_SETFOGCOLOR, and the fog G_MOVEWORD 0x64009D00.
    - In Queens the colour animates from red towards the table value 0x191934 at level start.
  - **GA, fog colour.** It comes from the level's **kind 37 object definition** in its world file: bytes +1..+3 are the fog RGB. 0x800B05F4 stores them and 0x800B04E0 applies them; the same colour goes to G_SETFOGCOLOR and the sky FILLRECT (0x8007A250).
  - **GA, far plane.** It is global and adaptive: *(0x8023A060) starts at 3400, 2866 or 1800 depending on mode and player count (0x8009AE38), then 0x80099FE8 moves it ±50 per step within 1800..5000 according to frame timing.
  - **Viewer recommendation.** Use the BTX1 table value, and 5000 for GA. Or disable fog by default, as the viewer does for Rush.
- **Hypothesis:** with that mapping, fog starts at about 64% of the far distance (1155 of 1799 at the Queens level start).

### 3.5 Textures and materials

#### Mapping to the viewer: Levels, textures, placement, sky, fog

Requirements from the verified runtime state in 5.0:
- **No X mirror and no 1/16 vertex scale.**
  - `displaylist.ts` hardcodes `VERTEX_SCALE = 1/16` and negates X.
  - Add per-game options, e.g. `ctx.vertexScale` (1 for BattleTanx) and `ctx.mirrorX` (false for BattleTanx).
  - Don't call `mirrorPlacementX` / `mirrorMatrixX` on BattleTanx transforms.
- **Camera speed.** The viewer's movement speed and start view were tuned for Rush world units, which are 16 vertex units. BattleTanx levels span a few thousand units, so scale the defaults (`src/render/startView.ts`, `controls.ts`).
- **Fog:** `Fog {color: per level, multiplier: 25600, offset: -25344, near: 16, far: per level}`.
  - BTX1 colour: the RGB table 0x801259DC[internal id] (matches the Arena and Chicago Bonus captures).
  - GA colour: the kind-37 object definition in the level's world files. GA far: adaptive, so use 5000, the maximum (see 5.0).
- **Sky.** There is none, so `skies` stays empty. The background should be cleared to the fog colour.
  - `Level` has no clear-colour field today. Suggest adding `clearColor?: [r, g, b]`, or letting the renderer clear to `fog.color` when present.
- **GA lighting.** GA draws with G_LIGHTING on, and its vertex colour bytes are normals, not colours. Using them as RGBA would tint the geometry wrongly. Bake the level's own lights into vertex colours instead, as in step 4 of the GA recipe below (verified).

**GA level loader recipe** (verified by prototype renders that match the game, 8.5):
1. **Files.** Decode the common world file, then slot 0 and slot 1 for the chosen variant (tables in 4.1; `lvl2/levels.ts`).
2. **Instances.** For each placement in slot 0 and slot 1:
   - Resolve kind 39. With no game mode, use mode 0: skip cond 0, include cond 1.
   - Take the first model field for the kind (5.1.1). Skip logic kinds and 0xFFFF.
   - Instance matrix: RotY(yaw) + translation (5.1.1), in world units, not mirrored.
3. **Meshes.** One mesh per (file, model), from part 0 (LOD 0).
   - Run every pool ref in order as TEX (if any), then PB, then GEO through the display-list interpreter.
   - Carry RDP/RSP state from one ref to the next, starting from geometry mode 0x230405 and render mode 0x552078.
   - Apply the state patcher (5.1.1) to TEX and PB chunks.
   - Mesh radius: from the model bounding box.
4. **Lighting.** The `Batch` has no normals, so bake at load:
   - N = normalize(RotY(yaw)·(nx, ny, nz)/127); L_i = normalize(s8 direction_i).
   - rgb = min(255, ambient_kind38 + Σ_i colour_i · max(0, N·L_i)); keep the vertex alpha.
   - This needs one mesh copy per distinct (mesh, yaw); SF AIRPORT goes from 51 to 137 meshes.
   - Verified: it matches the prototype's per-pixel lighting (mean difference 0.001, max 1), and that lighting matches the game frames.
   - Alternative: add normals and lights to `types.ts` and light in the shader.
5. **Fog and background.** `Fog {color: kind 37 RGB, multiplier 25600, offset -25344, near 16, far 5000}`, and clear to the fog colour. The far plane is adaptive in game; 2800 is a typical value.
6. **Culling.** The patched G_CULL_BACK flag maps directly to `Batch.cullBack`. Front faces wind **counter-clockwise** with no mirror.
   - Evidence: culling screen-clockwise triangles reproduces `ref2/air1.bin`. Culling CCW removes the ground and shows the backs of walls (`lvl2/renders/sfairport_cullcw_compare.png` vs `sfairport_cullccw_compare.png`).

**Interpreter changes GA needs** (`displaylist.ts`):
- options `vertexScale` (1) and `mirrorX` (false), instead of the hardcoded 1/16 and X negation;
- when G_LIGHTING is set, read vertex bytes 12-14 as s8 normals (for baking);
- multi-palette LOADTLUT: place each 16-entry load at palette index (tmem - 0x800)/8 of one 256-entry TLUT;
- carry state between `runDisplayList` calls for TEX → PB → GEO, with an initial-state option;
- a chunk patch hook (or pre-patch the chunk bytes before interpreting).

`texture.ts` needs no change. A prototype with all of this is `lvl2/dl.ts` + `lvl2/loader.ts` (`loadGaLevel(rom, id, variant, {mode, bake})`).

**Suggested new modules:**
- `src/rom/battletanxga.ts`: level tables from 4.1, world parser, assembly, lighting bake.
- Shared `src/rom/lzari.ts` (7.2).
- The displaylist.ts options above.

**Difficulty:** medium; every piece is prototyped.

**Risks:**
- The initial model of multi-model kinds (destructible states) is a hypothesis.
- LOD parts are assumed.
- The unknown logic kinds may hide a few drawable objects.

**BTX1 level loader recipe** (verified by renders that match the game, 8.5):
1. **Load the level.**
   1. Decode file A. Collect the unique chunks of all hdr6 pieces.
   2. Relocate G_SETTIMG / G_VTX (or resolve addresses per chunk).
   3. Apply the 15-pair render-mode patch.
   4. Scale vertex RGB by 1.92 with truncate-and-clamp.
2. **Meshes.**
   - Build one mesh per (hdr3 model, anim nibble) from LOD 0 (`hdr5[model.firstLod]`).
   - Per piece, run a prelude display list: `G_DL` texture chunk, the frame's SETTILE if the piece is animated, then `G_DL` geometry chunk. Use the fixed frame for nibbles < 14, and frame 0 (or a palette animation) for 14 and 15.
   - Mesh radius: from the model footprint.
   - Models no object places (tanks, pickups, destruction states) go in `unplaced`.
3. **Instances.** Take hdr2 objects with visibility nibble != 0, model >= 0 and kind not in {10, 21, 22, 23, 24, 25}.
   - **Mode filter:** campaign view hides flag 0x40; battle view hides flag 0x10.
   - **Matrix:** `[c,0,-s,0, 0,1,0,0, s,0,c,0, x,0,z,1]`. No mirror, scale 1.
4. **Fog and background.** `Fog {color: RGB 0x801259DC[id], multiplier 25600, offset -25344, near 16, far: i16 0x80125A30[id]}`, and clear to the fog colour. There are no skies.
   - Verified: in the Times Square dump the steady-state far is 1999.98 and the fog colour 0x181934, both equal to the table entries for id 3.
5. **Culling.** The chunk's G_CULL_BACK state maps directly to `Batch.cullBack` (front = CCW, no winding swap; 8.5).

**Interpreter changes BTX1 needs** (`displaylist.ts`, F3DEX 1.21 path):
- options `vertexScale` = 1 and `mirrorX` = false (shared with GA);
- per-slot TLUTs: G_LOADTLUT into slot (tmem - 0x100)/16, selected by the SETTILE palette field;
- combiner colour sources:
  - PRIMITIVE → the prim colour from G_SETPRIMCOLOR;
  - TEXEL0 only → white vertex colour;
  - (ENV - PRIM)·TEXEL0 + PRIM → the prim colour, as a fallback;
- a vertex-colour scale hook (or pre-scale the chunk bytes);
- tolerate G_MTX / G_POPMTX (the pool lists contain none).

`texture.ts` needs no change.

**`types.ts` additions:**
- the game id and level kinds (7.1);
- optionally, animated palette textures (a list of RGBA frames plus a rate). The simplest viewer uses one fixed frame.

**Prototype:** `lvl1/loader.ts` with `lvl1/dl.ts`, `lzari.ts`, `render.ts`.

**Suggested new module:** `src/rom/battletanx.ts`, holding the level table from 4.2.2, the level-A parser, assembly, and the music hookup.

**Difficulty:** medium.

**Risks:**
- the behaviour of kinds 11-17, 20, 26, 30 and 31, which are drawn as static;
- palette-animation rate (hypothesis);
- a thin white kerb edge in the Queens render (8.5) is not explained.

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

#### Mapping to the viewer: Game detection and the model (both games)

- **`src/rom/index.ts`:** add `case 'NBXE'` and `case 'NBQE'` next to NRUE/NSFE. `normalizeByteOrder` already handles v64/n64.
- **`src/rom/types.ts`:**
  - Extend `Game.id` with `'battletanx' | 'battletanxga'`.
  - Extend `LevelKind` too. Suggested additions: `'campaign'` for BTX1 campaign levels and GA missions, `'bonus'` for BTX1 bonus levels, and `'test'` for BTX1 Test/Spare/MP ids with data.
  - `'battle'` already exists and fits GA battle arenas and BTX1 multiplayer arenas.
  - The sidebar may need labels for the new kinds.

### 4.3 Skeletons and animation

Static-pose or animation support and remaining omissions are stated in the object description.

### 4.4 Behaviors, triggers, and scripted objects

Behavioral records are documented only where they affect level extraction or presentation.

## 5. Audio

### 5.1 Audio storage and banks

Audio storage is described with the sequence and bank tables below.

### 5.2 Sequence format and driver

#### Music: BTX1: libultra alSeqPlayer + Standard MIDI files

Everything here is stock libultra 2.0 behaviour. Section 6.0 describes VADPCM.

##### System
- **Players:** music uses **alSeqPlayer** (Standard MIDI type 0, via `alSeqNew`); SFX use alSndPlayer. There is no alCSPlayer, no libmus and no streaming.
- **Init:** 0x8007AB24 calls 0x8007963C(a0 = 5), which calls 0x80079B08. That runs:
  1. **0x80079DC8 (synth):**
     - `alHeapInit(0x80150340, base 0x80152FA8, 0x61A80)`;
     - `osAiSetFrequency(22050)` at 0x80110490, which returns **22047** (outputRate 0x561F at 0x80150334, read in the debugger);
     - ALSynConfig: maxVVoices 48, maxPVoices 48, maxUpdates 196, dmaproc 0x8007A79C, **fxType 5 (AL_FX_ECHO)**;
     - `alInit` 0x8011C1DC.
     - Audio frame: 736 samples (min 720, max 832).
  2. **0x80079EFC:** `alSeqpNew` 0x8011B314 with maxVoices 48, maxEvents 64, maxChannels 16. Player pointer at 0x80150350, ALSeq at 0x80150354.
  3. **0x80079FA4:** `alSndpNew` 0x8011C8F4 with 32 sounds and 64 events.
  4. **0x8007A004:** the banks, via `alBnkfNew` 0x80110AB4.
- **Game music API:**
  - **play(song)** 0x80079BB4 calls 0x80079C20. If the song is already current (0x80125710), it returns. Otherwise it:
    1. stops the current song;
    2. `romread`s [T[n], T[n+1]) into the sequence buffer;
    3. calls `alSeqNew`;
    4. creates marker A at tick 0 and marker B = `alSeqNewMarker(-1)` (End of Track);
    5. calls `alSeqpLoop(A, B, -1)`, `alSeqpSetSeq`, `alSeqpSetBank(music bank 0)` and `alSeqpPlay`.
  - **stop** 0x80079BD4 calls 0x80079D58, which does `alSeqpSetVol(0)` then `alSeqpStop`.
  - **setVol** 0x80079BF4: callers pass the music option (0x80125794, default 5) << 12, i.e. **20480**.
  - **Level music** 0x8007D2A0(internal id), jump table 0x80071378.
- **libultra addresses:**

| Function | Address |
|---|---|
| alSeqNew | 0x80119A78 |
| alSeqNewMarker | 0x80119748 |
| alSeqSetLoc | 0x8011954C |
| __postNextSeqEvent | 0x80119FE0 |
| __handleMetaMsg (tempo) | 0x8011A0BC |
| __seqpVoiceHandler | 0x8011AB7C |
| alEvtqPostEvent | 0x8011B60C |
| alSeqpLoop / Play / SetBank / SetSeq / SetVol / Stop | 0x8011B8B0 / 0x8011B8F0 / 0x8011B920 / 0x8011B960 / 0x8011B9A0 / 0x8011B9E0 |
| _timeToSamples | 0x8011DC08 |
| alAudioFrame | 0x8011DD48 |

##### Data
| Item | ROM | Content |
|---|---|---|
| SFX .tbl | 0x100000-0x21561A | 49 VADPCM sounds |
| SFX .ctl | 0x215620-0x217EC0 | ALBankFile, 1 bank at +0x2880: 1 instrument, 49 sounds, 49 envelopes, sampleRate field 44100 |
| **Music .tbl** | 0x217EC0-0x298D58 | 29 VADPCM waves (order 2, 4 predictors) |
| **Music .ctl** | 0x298D60-0x29A710 | ALBankFile, 1 bank at +0x1970: 11 instruments, sampleRate 22050, no percussion |
| **Song table** | RAM 0x80125714 (ROM 0xB5714) | u32[20] cart addresses; song n = bytes [T[n], T[n+1]), n = 0..18; T[19] = 0x2C19B0 is the end sentinel |
| Songs 0..18 | 0x29A710-0x2C19B0 | Standard MIDI files |

**ALBankFile** (stock libultra). All pointers in the .ctl are offsets from the .ctl start, relocated by `alBnkfNew`; a wave `base` is an offset into the .tbl.

| Record | Layout |
|---|---|
| ALBankFile | +0 s16 revision 0x4231 ("B1"), +2 s16 bankCount, +4 u32 bankArray[] |
| ALBank | +0 s16 instCount, +2 u8 flags, +4 s32 sampleRate, +8 u32 percussion, +0xC u32 instArray[] |
| ALInstrument | +0 u8 volume, +1 u8 pan, +2 u8 priority, +3 u8 flags, +4..+7 tremolo type/rate/depth/delay, +8..+0xB vibrato type/rate/depth/delay, +0xC s16 bendRange (cents), +0xE s16 soundCount, +0x10 u32 soundArray[] |
| ALSound | +0 u32 envelope, +4 u32 keyMap, +8 u32 wavetable, +0xC u8 samplePan, +0xD u8 sampleVolume, +0xE u8 flags |
| ALEnvelope | +0 s32 attackTime, +4 s32 decayTime, +8 s32 releaseTime (µs), +0xC u8 attackVolume, +0xD u8 decayVolume |
| ALKeyMap | +0 u8 velocityMin, +1 velocityMax, +2 keyMin, +3 keyMax, +4 keyBase, +5 s8 detune (cents) |
| ALWaveTable / loop / book | as in 6.0 |

**Music bank contents:**
- **Instruments:** soundCount per instrument is 7, 2, 2, 2, 2, 2, 2, 3, 1, 4, 2. Instrument 0 has volume 100 and the rest 127. All have pan 64, priority 5, bendRange 200 cents, and no tremolo or vibrato.
- **Envelope:** all sounds share one: attack 0 µs to 127, decay 500000 µs to 100, release 200000 µs.
- **Loops:** looped waves have loop count -1.
- **Full dump:** `mus1/bank_summary.txt`.

##### MIDI files
- All 19 songs are format 0 with one track and division 480.
- Each has a single tempo meta event at tick 0, and End of Track 1 tick after the last event. There is no sysex, marker or text.
- Tempos (bpm), songs 0..18: 120, 210, 180, 133, 120, 120, 120, 120, 230, 105, 115, 120, 80, 123, 123, 123, 140, 130, 112.
- **Controllers:** CC0/CC32 bank select (ignored), CC7, CC10, and CC1 once in song 1 (ignored). Pitch bend appears in songs 1, 3 and 7. There is no CC64, CC91 or CC102/103.
- **Full dump:** `mus1/midi_summary.txt`.

##### Playback semantics (stock alSeqPlayer)
- **Ticks:** `usPerTick = (s32)((f32)tempo * (f32)(1.0/480))`; for example, 500000 gives 1041.
- **Event scheduling.**
  - The voice handler returns the µs until the next queued event: MIDI events, envelope-phase events, note-end events, and a 16000 µs API poll event.
  - `alAudioFrame` advances `samplesLeft += (s32)((f32)us * 22047 / 1e6 + 0.5)`.
  - Parameter updates land on `clock & ~15`, and ramp lengths are rounded to multiples of 16 (`_timeToSamples`).
- **Loop.** Game code loops tick 0 to End of Track forever. The final delta's delay is kept, so one pass is exactly `endTick` ticks. There are no intros.
- **Program change** copies the instrument's volume and pan into the channel. The songs send CC7/CC10 at tick 0 *before* their program change, so those values are lost and every channel ends up at pan 64. The music is effectively mono; the captures confirm this (side/mid -44 dB in both).
- **Note on.**
  - Keymap lookup is libultra's binary search over the instrument's sounds by key range.
  - Pitch = `alCents2Ratio((key - keyBase)*100 + detune)` x bend ratio (bendRange 200 cents). There is no sample-rate factor, and the resampler ratio is capped at 1.99996.
- **Volume.**
  - Voice volume = (tremolo 127 x velocity x envelope gain >> 6) x (sampleVolume x sequenceVolume x channelVolume >> 14) >> 15.
  - The synth squares it (`v*v >> 15`). Pan = channelPan + samplePan - 64, equal-power.
- **Envelope:** attack (0 µs) to attackVolume, decay to decayVolume over decayTime, release over releaseTime at note off.
- **Samples:** VADPCM (6.0). Past loop end, decoding restarts at the frame containing loop start, using the loop record's stored state.
- **Reverb:** the synth has an ECHO fx bus, but no song sends CC91, so music has no reverb send.

##### Song list
There are **no in-game song names**: no jukebox, and "Music Volume" is the only music option. Name tracks by use.

**Pass length** is in samples at 22047 Hz. **Render loop** is loopStart..loopEnd in `mus1/wav`.

| Song | ROM | bpm | Pass length | Render loop | Uses (internal level ids, see 4.2) |
|---|---|---|---|---|---|
| 0 | 0x29A710 | 120 | 1409904 (63.95 s) | 4384..1414288 | New York - Times Square (3); "CONQUEST" story screen (0x800BF9BC); default for ids 20-27, including The Arena (24) |
| 1 | 0x29C980 | 210 | 1410000 | 4400..1414400 | Chicago - Lake Shore Drive (7) |
| 2 | 0x29F250 | 180 | 1645536 | 4384..1649920 | New York - Tunnel (2) |
| 3 | 0x2A28F0 | 133 | 1431456 | 4384..1435840 | Midwest - Highway (6) |
| 4 | 0x2A5050 | 120 | 1234384 | 4384..1238768 | Area 51 (11) |
| 5 | 0x2A78F0 | 120 | 1586368 | 4384..1590752 | Las Vegas - Fremont Street (12) |
| 6 | 0x2AA200 | 120 | 1763408 (79.98 s) | 4384..1767792 | **title, attract, Controller Pak, GAME SETUP (verified)**; the four bonus levels (5, 9, 13, 17); San Francisco - The Wharf (15); story screens |
| 7 | 0x2ADCF0 | 120 | 1323088 (60.01 s) | 4384..1327472 | **New York - Queens (1), campaign level 1 (verified)**; "KINGDOM COME" story screen |
| 8 | 0x2B0C00 | 230 | 1655344 | 4400..1659744 | San Francisco - Golden Gate Bridge (14); "KINGDOM COME" story screen |
| 9 | 0x2B4380 | 105 | 1209648 | 4384..1214032 | **unused** |
| 10 | 0x2B74A0 | 115 | 1472272 | 4384..1476656 | San Francisco - Quarantine Zone (16); "THE QUEENLORD" story screen |
| 11 | 0x2B8BC0 | 120 | 727984 | 4384..732368 | **unused** |
| 12 | 0x2B8DD0 | 80 | 1322832 | 4384..1327216 | **unused** |
| 13 | 0x2B9840 | 123 | 301280 (13.7 s) | 4384..305664 | short piece: screens 0x800BD20C and 0x800C4254 |
| 14 | 0x2B98D0 | 123 | 602352 | 4384..606736 | **unused** |
| 15 | 0x2B9980 | 123 | 1914384 | 4400..1918784 | story screen 0x800B1520 ("THE FALL" / "AFTERMATH") |
| 16 | 0x2BB400 | 140 | 1360240 | 4400..1364640 | Desert (10) |
| 17 | 0x2BE380 | 130 | 1302208 | 4400..1306608 | New York - Washington Bridge (4) |
| 18 | 0x2C0080 | 112 | 1512512 | 4384..1516896 | Chicago - State Street (8) |

**Level music** is played through jump table 0x80071378: internal ids 0 (Cinematic), 18 (MPWharf) and 19 (MPMissile) stop the music.

**Call sites.** The 17 call sites of `play` (0x80079BB4) are listed in `notes/mus1.md` section 3. Sixteen pass a constant; the level jump table holds only constants.

##### Offline rendering
- **Prototype:** `btx/mus1/render.ts`. Run `npx tsx render.ts all|{ids} [--vol N] [--noloop]` from `mus1/`; all 19 songs take about 15 s.
  - It exports `renderSong(rom, song)`, returning {sampleRate, left, right, loopStart, loopEnd}, and `TRACKS`.
  - The parsers are `bank.ts` (`parseBankFile`) and `midi.ts` (`parseMidi`).
- **What it models:** the alSeqPlayer event queue above, RSP VADPCM with loop state, the 4-tap resampler, squared volume, equal-power pan and exponential envmixer ramps. It has no reverb.
- **Output:** `mus1/wav/song00.wav`..`song18.wav`, 22047 Hz stereo, with a `smpl` loop chunk. Each file is pass 0 plus the opening of pass 1, until pass 0's release tails end; `loopStart = length - passLength` and `loopEnd = length`.
- **DecodedMusic:** `{sampleRate: 22047, loopStart, loopEnd}` from the table.

#### Mapping to the viewer: Music

**GA** (spec in 6.1; working prototype `mus2/render.ts` + `mus2/libmus.ts`):
- **Suggested modules:**
  - `src/rom/music/vadpcm.ts`: VADPCM frame decoder (6.0), shared with BTX1.
  - `src/rom/music/synth.ts`: voice mixer with the 4-tap resampler, squared envmixer volume, equal-power pan, linear 367-sample ramps and BIGROOM reverb. BTX1 can share it: it also uses libultra's synth (verified, 6.2), but its music has no reverb send.
  - `src/rom/music/libmus.ts`: pointer-bank and song parser, plus the tick-loop sequencer.
  - `src/rom/battletanxga.ts`: exposes `music` and `decodeMusic`.
- **`MusicTrack` list:** 21 entries (songs 0..20). The names are uses from the table in 6.1.6, e.g. "Title / Menus", "SF Airport", "Unused (song 19)".
- **`decodeMusic(i)`:** returns `{sampleRate: 22047, channels: [L, R], loopStart: 0, loopEnd}`.
  - Omit the loop for songs 4 and 17.
  - WebAudio accepts a 22047 Hz AudioBuffer.
- **Difficulty:** medium, since the prototype exists and needs porting and cleanup.
- **Cost:** about 8 s of CPU per 2-minute song in Node, so render in the worker on demand and cache.
- **Risks:** the reverb isn't bit-exact (hypothesis), and PAL timing is untested (irrelevant for the USA ROMs).

**BTX1** (spec in 6.2; working prototype `mus1/render.ts` with `bank.ts` and `midi.ts`):
- **Suggested modules:**
  - `src/rom/music/albank.ts`: ALBankFile parser.
  - `src/rom/music/smf.ts`: Standard MIDI parser.
  - `src/rom/music/seqplayer.ts`: alSeqPlayer event model (µs scheduling, 16-sample quantisation, keymap lookup, envelopes, bend, loop markers).
  - Reuse `vadpcm.ts` and the voice mixer from the GA work. The ramp shape differs between the two prototypes (9.3), so make it a parameter.
  - `src/rom/battletanx.ts`: exposes `music` / `decodeMusic`.
- **`MusicTrack`:** 19 entries, named by use from 6.2.5, e.g. "Title / Menus", "New York - Queens", "Unused (song 9)".
- **`decodeMusic(i)`:** `{sampleRate: 22047, channels: [L, R], loopStart, loopEnd}`.
- **Difficulty:** medium (a port of the prototype).
- **Cost:** about 0.8 s per song.
- **Risks:** a 16-sample-per-pass loop drift, and a missing ECHO reverb. Both are inaudible here, since music has no fx send.

#### Verification evidence: Music, BTX1

- **Capture method:** the same audio-dump plugin as for GA (a copy in `mus1/tools/`). The log shows a DAC rate of 2207 (22047 Hz).
- **Breakpoint log:** breakpoints on 0x80079C20 (play) and 0x8007D2A0 (level music) were logged to `mus1/cap/songlog.txt`.
  - Title: `play(6)` from 0x800C589C at capture 12.05 s.
  - Level 1: `0x8007D2A0(a0=1)` from 0x8007F5FC, then `play(7)`.
- **Captures** (in `btx/mus1/cap/`):
  - `cap_menu_song6.wav` (GAME SETUP menu)
  - `cap_level1_song7_nosfx.wav` (New York - Queens, with SFX muted)
  - `cap_level1_song7.wav` (same, SFX on)
  - `cap1.raw`, `cap1_0_500.wav`, `cap1_490_560.wav` (story crawl), `cap_song6_attract.wav`

| Comparison | Menu vs song 6 | Queens vs song 7 (SFX muted) |
|---|---|---|
| 4 s windows aligned at a constant offset | 44 of 44, within ±24 samples, including across the loop seam at 412.3 s | 44 of 46, within ±16 samples over 92 s, including the loop wrap |
| Tempo slope | 0.999987 | (constant offset) |
| Spectral peaks | within 1.6 cents (131.49, 196.40, 98.47 Hz...) | within 1.4 cents (58.14, 43.95, 49.22, 116.83 Hz...) |
| Log-spectrum correlation | 0.9998 | 0.9997 |
| Level difference | -0.17 dB | -0.08 dB |
| 5 s envelope correlation | 0.91-0.99 | 0.69-0.84 |
| Stereo side/mid, capture vs render | -44.17 vs -44.18 dB | -44.09 vs -44.10 dB |
| Loop pass length, measured vs render | 1763392 vs 1763408 (song opening found at +1 and +5 passes) | 1323088 vs 1323088 |

- **SFX muting:** for the level measurement the SFX master volume (u16 at 0x80125774) was set to 0 in the debugger. With SFX on, the effects dominated: +4.8 dB, with no alignment.
- **Story crawl:** capture 490-528 s is song 6 continuing (waveform correlation 0.88).

### 5.3 Instruments and sample encoding

#### Music: Shared: VADPCM sample decoding

Both games play N64 VADPCM samples through libultra's synth and the RSP "audio" microcode. In GA every sample is VADPCM (6.1). BTX1 uses libultra ALBank files (6.2), whose waves are VADPCM or RAW16.

**Wave and codebook structures**
- `ALWaveTable` (20 bytes): +0 u32 base (offset into the sample file), +4 s32 len (bytes), +8 u8 type (0 = ADPCM, 1 = RAW16), +9 u8 flags, +0xC u32 loop offset (0 = none), +0x10 u32 book offset (ADPCM only).
- `ALADPCMBook`: s32 order, s32 npredictors, then s16 book[order * npredictors * 8]. GA's banks all use order 2 with 4 predictors.
- `ALADPCMloop`: u32 start, u32 end, u32 count (0 = no loop; 0xFFFFFFFF = infinite), s16 state[16].

**Frames.** Each frame is 9 bytes and produces 16 samples. The header byte gives `scale = hi nibble` and `pred = lo nibble`; 16 signed 4-bit residual nibbles follow, high nibble first.
- Residual: `r[i] = signExtend4(nibble) << scale`, which equals `((nibble << 12) as s16) >> (12 - scale)`.
- Coefficients (order 2): `b1 = book[pred*16 .. +8]`, `b2 = book[pred*16+8 .. +16]`.
- Each 8-sample half is predicted from the two previous output samples `(l1, l2)` and from that half's own residuals:
  `out[i] = clamp16((r[i] << 11) + b1[i]*l1 + b2[i]*l2 + sum_{k=0}^{i-1} b2[k] * r[i-1-k]) >> 11)`, for i = 0..7 within the half.
- The first half uses `(l1, l2) = (prev[14], prev[15])` of the previous frame's output. The second half uses `(out[6], out[7])` of the current frame. The state is zero when a voice starts.
- This is exactly the HLE RSP `alist_adpcm` computation, and the GA renderer reproduces the game's output with it (section 8).

**Looping.** When `loop.count != 0`, playback wraps `[loop.start, loop.end)`. The renderer decodes linearly and wraps. libultra restarts decoding at `loop.start` with the stored `state`; that is equivalent when the encoder stored the linear-decode state. **Hypothesis:** holds for all waves.

### 5.4 Music catalog and loop points

The complete known song catalog and loop policy are included above.

## 6. Unused and hidden content

### 6.1 Unreferenced assets

#### Unused or hidden content

Everything found in both ROMs: levels, level variants, pool data, images, music, cheats and leftovers. The evidence for each item is given with it, and remaining uncertainties are marked **Hypothesis**.

#### Unused or hidden content: BTX1

Level numbers here are **internal ids** (4.2.1).

**Levels**
- **Ids 18 MPWharf, 19 MPMissile and 20-23 Spare1..Spare4:** names only. Their level records are empty after 0x800865E0 and no files exist. For 18 and 19, the level-music handler has explicit "stop music" cases.
  - **Hypothesis:** planned multiplayer versions of The Wharf and a "Missile" map.
- **The Arena is internally "Test1" (id 24).** The internal name list at ROM 0x1568 calls it Test1, next to Test2..Test4. Evidence: the name string and the permutation in 4.2.1.
- **Ids 25 Test2, 26 Test3, 27 Test4:** complete A files with pool chunks, but no B file, no images, and the default grey RGB 808080.
  - They appear in the display-name table (menu indices 13, 14, 24).
  - The attract/scenario table uses them (indices 7, 10, 9).
  - **No normal menu reaches them.** The only level select (Battlelord territories) shows menu indices 0-7, campaign has no select, and level codes accept only ids 2-17.
  - **Contents** (renders `lvl1/renders/top_25/26/27_all(_obl50).png`):
    - Test2: a desert highway junction with a gas station and tank traps.
    - Test3: a city park with the blue gantry.
    - Test4: a San Francisco shoreline and bay with a crashed airliner.
  - Only 3 geometry chunks (288 bytes) are used exclusively by these three ids.
  - **Hypothesis:** they are played as story-cutscene sets (9.2).
- **Id 0 Cinematic:** an A file without B. It is the attract-demo level (scenario indices 0-2; loaded in attract mode in the emulator), not a playable level and in no menu. Its content is a New York street set (`lvl1/renders/top_0_all(_obl50).png`). 141 geometry chunks (30,000 bytes) and 1 texture chunk (2,304 bytes) are used only by id 0.

**Images, fonts and pools**
- **img16 records 4 (ROM 0x7BF860, 155x30) and 7 (0x7C8E50, 168x30):** present in the record table, but no per-level index selects them and their addresses appear nowhere else. Unlike every used record, they do not fit the palette + CI8 title-image layout; their format is unknown.
- **ROM 0x7E76D0-0x7E7C50:** an image in img40 format. Its address appears only as the end of img40 record 9.
- **ROM 0x2C19B0-0x2C3E50:** a third font bank, in the same format as the two used ones. Its address appears only as the end sentinel of the MIDI table 0x80125714.
- **Geometry pool gaps** at pool offsets 0x44978 (0x100 bytes), 0x56BD0 (0x9B0) and 0x7CDE0 (0x110), i.e. ROM 0x42F2E8, 0x441540 and 0x467750: display-list chunks that no level's section 6 lists. The level-format work confirmed these are the only unreferenced geometry chunks; every texture-pool chunk is referenced.
- **Area 51 (id 11)** is reachable (Battlelord list, campaign). It is noted here only because 276 geometry and 19 texture chunks are exclusive to it.
- **Junk:** ROM 0xD7360-0x100000 (PC build junk) and 0x7E3210 (0x40 bytes of text).

**Music**
- **Songs 9, 11, 12 and 14 are never played.**
  - 0x80079C20 has one caller, 0x80079BB4.
  - 0x80079BB4 has 17 `jal` call sites. Sixteen pass constants, and the level jump table 0x80071378 holds only constants.
  - No data pointers to either function exist anywhere in ROM.
  - Renders: `mus1/wav/song09.wav`, `song11.wav`, `song12.wav`, `song14.wav`.
- **Music bank instrument 7, sound 2** (wave at ROM 0x2823E0, 3960 bytes) is unreachable. It shares key range 49-74 with sound 1, and the keymap binary search always returns sound 1.
- **Silent notes:** keys above 74 on instrument 7 have no sound. Song 0 loses 31 notes, song 1 loses 28, song 2 loses 21 and song 3 loses 72.
- **Dead data in songs:**
  - Song 18's program change 11 is out of range, so it is ignored.
  - Song 12 has no program changes at all.
  - Every song's CC10 pans are overwritten by program changes.

**Cheats, codes and developer leftovers**
- **Cheat table:** ROM 0xC5698 / RAM 0x80135698, 14 slots of 10 bytes each, space-padded. The coordinator re-read the slots from ROM. The checker is 0x800DCA7C, and the result messages are at ROM 0x41A0.

  | Slot | Code | Effect (flag bytes set) |
  |---|---|---|
  | 0 | LTSFBLLTS | UNLIMITED AMMO (0x80135760) |
  | 1 | PLVRZM | ALL WEAPONS (0x80135765) |
  | 2 | MSTSRVV | INVULNERABLE (0x80135763) |
  | 3 | **DUMMYHAHA** | **"TOD CHEAT"**: sets 0x80135760, 0x80135763, 0x80135767 and 0x80135761 (unlimited ammo, invulnerability and two more flags) |
  | 4 | CRSTLCLR | INVISIBLE (0x8013576A) |
  | 5 | HVRL | HURL MODE (0x8013576B) |
  | 6 | WMNRSMRTR | STORM RAVENS (0x8012579A, 0x80135773) |
  | 7 | CDPLT | RUN STORY (0x80135770) |
  | 8 | CNCTHRTM | TRIPPY (0x80135771) |
  | 9 | LVFRVR | UNLIMITED LIVES (0x80135772) |
  | 10 | LTSLTSGNGS | CAMPAIGN GANGS (0x8012579A) |
  | 11 | FRGZ | FROGS (0x80135775) |
  | 12 | TDZ | TOADS (0x80135776) |
  | 13 | `??????????` | unused placeholder |

  **DUMMYHAHA is a hidden developer code that can't be entered.** The Input Code letter set (ROM 0xC5680, "BCDFGHJKLMN" "PQRSTVWXYZ") has no vowels, and the code contains U and A. It isn't in public code lists.
- **Level codes** (checker 0x800DD544, reimplemented in `ref1/lcode.py`):
  - A code is 8 letters from the alphabet "BCFGHJKLMNPRSTVW" at RAM 0x80135778, giving a 32-bit value (4 bits per letter), plus 2 checksum letters: `((v*0x19660D + 95) & 0xFF) ^ 0xB2`.
  - Decoding: `v ^= 0xEFF8DF2B`, then undo the 16 bit-toggle pairs at 0x8013578C.
  - Fields: level = `v & 0x1F` (the internal id, valid 2..17), army = `(v >> 5) & 0x3F`, score = `((v >> 11) & 0x7FFF) * 1000`.
  - One public web code (VVSLGGVHRF) fails the checksum.
- **Developer path string:** "d:\bs64\screenshot%d.raw" at ROM 0x1150. It is a leftover of a screenshot-dump feature; no caller was investigated.

### 6.2 Cut or inaccessible levels

Candidate levels are distinguished from alternate, debug, and intentionally hidden retail content above.

### 6.3 Debug features

Shipped debug strings and executable features are listed only when supported by a code or data reference.

### 6.4 Prototype or revision-specific content

Source-archive and prototype material is explicitly distinguished from shipped retail data.

## 7. nviewer implementation

### 7.1 Module mapping

#### Mapping to the viewer: File access

- **Neither game needs a runtime file table.** Transcribe the ranges in sections 3 and 4 as constants, as `rush1.ts` does for its tables. Alternatively, read the BTX1 tables from the uncompressed main image at `ROM = RAM - 0x80070000`.
  - BTX1 level records at 0x80125A68 are **filled at runtime** by 0x800865E0, so they are not present in ROM. Transcribe the table in 4.2.
  - GA's level files come from a code switch, not data. Transcribe the table in 4.1.
- **Pool chunks** hold chunk-relative addresses: G_VTX in GEO chunks, G_SETTIMG in TEX chunks.
  - The viewer doesn't need to patch them.
  - Give `runDisplayList` a `resolve` that adds the current chunk's base in the buffer: `addr => base + addr` when `addr < chunkSize`.
  - Or copy each chunk into its own `Uint8Array` and use an identity resolver.

### 7.2 Supported features

The Technical summary states the supported releases and principal decoded features.

### 7.3 Approximations and omissions

Viewer approximations are distinguished from facts about the game formats.

## 8. Verification and remaining work

### 8.1 Verification evidence

#### Verification evidence: Runtime captures (reference screenshots and RAM dumps)

**BTX1**, in `btx/ref1/`:
- **Screenshots** (`shots/`):
  - `00_title.png`, `02_game_setup.png`, `03_playmodes_1p_montage.png`, `08_occupied_territories_arena.png`, `09_occupied_territories_sweep_montage.png` (Battlelord level select)
  - `14_queens_wide_after_death_bluesky.png`, `15_queens_spawn_hud_redsky.png`, `17`-`20` (Queens pan and panorama)
  - `40_arena_spawn_fortress_trees.png`, `46`-`52` (Arena pan)
  - `71`-`77` (Chicago - Bonus)
  - `22_options_screen.png`, `23_input_code_screen.png`, `24_input_code_HPJMKGMCJV_valid.png`
  - `60_dlrender_vs_screenshot_arena1_queens1.png`, `61_dlrender_vs_screenshot_bonus1.png` (software renders of the dumped frame DL next to the game)
- **RDRAM dumps** (8 MiB from 0x80000000, with OSTask files `*_task.bin`, listings `*_dl.txt` and summaries `*_summary.txt`):
  - `queens1.bin` and `queens1b.bin` (8 s later): DL 0x8031AFF0
  - `arena1.bin` and `arena1b.bin`: DL 0x8031B0F0
  - `bonus1.bin`: DL 0x8031B0F0
- **Tools:**
  - `dldump.py` (F3DEX 1.21 DL walker)
  - `dlrender.py` (software render with the game matrices)
  - `lcode.py` (level-code decoder and encoder)
  - `catchgfx.sh` (break on a graphics task and dump)
  - `goto_queens.sh` (power-on to Queens)

**GA**, in `btx/ref2/`:
- **Screenshots** (`shots/`):
  - `00_title.png`, `02_game_setup.png`, `03_mode_*.png` (all 8 modes), `04_options.png`, `06_usa_map_levelselect.png`, `08_deathmatch_usa_map.png`, `08_deathmatch_europe_map.png`
  - `10_whitehouse_start.png`, `11_*`, `12_whitehouse_fog_*` (White House, fog)
  - `20_dm_champs_elysee_*`, `21_*` (Champs Elysee, night)
  - `31_sf_airport_dump_frame.png`, `40_sf_breakout_dump_frame.png`, `50_dm_sf_panhandle_start.png`, `51_dm_sf_panhandle_dump_frame.png`
- **RDRAM dumps** (listings `*_dl.txt`, summaries `*_summary.txt`, wireframes `*_wire.png`):
  - `air1.bin`: SF Airport, DL 0x80157F80
  - `air2.bin`: SF Airport, a later frame; its task type is unverified
  - `brk1.bin` / `brk2.bin`: SF Breakout, DL 0x80157F80 / 0x80157E80; a DEFEAT box overlays the level
  - `pan1.bin` / `pan2.bin`: SF Panhandle, DL 0x80157F80 / 0x80157E80
- **Tools:**
  - `dldump.py` (F3DEX2 walker; `--render` draws a wireframe)
  - `goto.sh` (menu driving)

#### Open questions and unknowns

Every item in this section is a **hypothesis** or an open question, not a verified fact.

#### Open questions and unknowns: BTX1

- **Attract demo files:** setup mode 8 is the attract demo (verified runtime mode values: 5 Campaign, 0 Battlelord, 7 code-loaded bonus, 8 attract). The 11 raw world/scenario files may be recorded demo or cutscene data, with body size `([+4]*12 + 48) * [+0] + [+0xC]*12`. **Hypothesis:** Test2..Test4 are story-cutscene sets, since story/front-end code sets world indices 7 and 9 via 0x800EC380 at 0x800BFF28 and 0x800C4D98, each followed by a read of the RUN STORY cheat flag 0x80135770. Static evidence only.
- **Level B** may be an AI navigation triangle mesh.
  - Layout: +8 u16 nNodes, +10 u16 nRecords; nodes of 8 B {f32 x, z} (node 0 a dummy); 12-byte records = 3 x {u16 node index, u16 value}; a byte table of nRecords + 7; a 256-byte table with values 0..3, identical in both levels checked.
  - Support: drawn as triangles, the records tile streets and open areas and avoid buildings (`lvl1/renders/levelb_1.png`).
  - Against a simpler reading: the u16 values are not node distances.
- **img40 trailing u8 x 8:** may be the pixel positions of the four Battlelord bases (kinds 11-14). The order and orientation match in 7 levels, but the pixel scale is inconsistent.
- **hdr0 spawn groups:** probably per-team spawn sets, with the high nibble of the kind-25 param = team.
- **Palette animation rate:** the frame counter 0x801B4AA0 is assumed to advance once per rendered frame.
- **Draw passes 1, 3, 4, 5:** probably dynamic objects and effects; not identified.
- **Kinds 11-17, 20, 26, 30, 31:** treated as static by the dispatcher but never seen in view. Their behaviour (e.g. bases for 11-14) is unknown. Verified: their collision registration (5.1.3): 11-14, 20 and 31 are destructible entities, 26 and 30 static entries, 15 a non-blocking one.
- **Queens white kerb edge:** unexplained difference in the render comparison (8.5).
- **0x801191E0:** probably osPiRawReadIo.
- **Campaign order:** internal ids 1..17 (4.2.4). Only level 1 was verified; the mission titles come from briefing texts.
- **Other mode lists:** Deathmatch, Family Mode, the multi-player "Annihilation" mode, and 2+ player territory lists were not checked. Presumably they draw from the same 28-entry menu-order table.
- **Far-plane animation (BTX1).** Verified: at level start the current far value (0x80125858) and the fog colour animate towards the table values, and at steady state (Times Square) both equal the table. Not identified: the animating code, and whether far also adapts to load (the Arena far dropped from 4949 to 4800 between two dumps).
- **Scaled matrices:** some per-frame BTX1 modelview matrices (0x802Fxxxx) carry a uniform scale of about 24-65 and sit behind the camera. Perhaps particles, sprites or a radar.
- **Cinematic (id 0):** the attract mode loads it (verified by the emulator read log, 8.1). No RAM dump confirms that it is the city fly-by shown after the title.
- **Music: song 15.** The "THE FALL" crawl of a new campaign did not start song 15 (song 6 continued). Song 15 may belong to "AFTERMATH" (the ending). The purpose of song 13 is unknown.
- **Music: unexercised play calls.** The screens 0x800AC2E8, 0x800C54F0 and 0x800CA980 have no direct callers, and the variants of the story-screen play calls were not exercised.
- **Music: volume option.** Range assumed 0..7; the code writing option 0x80125794 was not found.
- **Music: loop drift.** The -16 samples per pass on the menu is probably the unmodelled phase of the 16000 µs poll event.
- **Music: not modelled.** Voice stealing by SFX, and the ECHO fx bus. The music has no fx send, so neither should be audible.

#### Open questions and unknowns: Shared

- **Envmixer ramp shape.** The GA renderer uses linear per-8-sample ramps (libultra's own computation). The BTX1 renderer uses exponential ramps (as mupen64plus HLE interprets them). Both match captures within measurement, because the ramps last only ~16 ms. Which one the real RSP microcode uses was not checked against LLE.

### 8.2 Known unknowns

Unresolved semantics are labelled **Hypothesis** or **Open question** where they occur.

### 8.3 References

External documentation, decompositions, and source archives are cited inline where used.
