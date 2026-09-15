# BattleTanx: Global Assault — Nintendo 64 ROM format specification

This manual describes the shipped data formats needed to identify, extract, and
present BattleTanx: Global Assault content. Claims state their evidence inline; unsupported
interpretations are labelled hypotheses.

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | Fixed ROM range tables and LZARI-compressed resources. |
| Compression | LZARI with a 4 KiB dictionary. |
| Graphics microcode | F3DEX2 2.07. |
| Geometry | World files containing display-list and placement sections. |
| Textures | RDP-native textures selected by model display lists. |
| Collision | Runtime spatial grid decoded from level records. |
| Music driver | Nintendo Sound Tools libmus. |
| Audio microcode | Stock libultra RSP audio task; exact ABI revision is not established. |
| Sample encoding | Nintendo VADPCM. |
| Levels | Campaign, battle, and bonus maps. |
| Memory requirement | Base 4 MiB. |
| Viewer support | USA and European retail data. |

### 1.2 ROM identification

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| USA | `BATTLETANXGA` | `NBQE` | 0 | 8 MiB (`0x800000`) | `75A4E247` | `6008963D` | `805248fb0a0ee694cad8d7dc927b631d860dd8cf` | CIC-6102 | — |
| Europe | `BATTLETANXGA` | `NBQP` | 0 | 8 MiB (`0x800000`) | `0CAD17E6` | `71A5B797` | `aefade7a37a4716ddc82a6b67ba085cbf7c27259` | CIC-6102 | — |

Verified from the normalized ROM headers and complete-image SHA-1 hashes.

### 1.3 Terminology and conventions

ROM and memory ranges are half-open. Offsets, addresses, encoded sizes, masks,
and opcodes are hexadecimal unless stated otherwise. Multi-byte CPU fields are
big-endian. RAM addresses are virtual unless explicitly identified as physical;
segmented, VROM, and file-relative addresses are named at each use.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

#### Shared

- IPL3 copies ROM 0x1000.. to the entry point 0x80071000, so for the main image **RAM = ROM + 0x80070000**.
- The entry stub sets `sp`, zeroes BSS with a word loop, then `jal main`:

| | BTX1 | GA |
|---|---|---|
| Initial sp | 0x8014E0C8 | 0x8021E0B8 |
| BSS cleared | 0x80147040..0x803D8880 | 0x80127E30..0x803B17B0 |
| main | 0x800779CC | 0x8009ED9C |

#### GA

- **Main code is not compressed.** ROM 0x1000..0xB7E30 maps to RAM 0x80071000..0x80127E30. This is verified by data pointers, e.g. ROM 0xAB6D4 holds 0x800732D4, which points to the string "WASHINGTON DC - MALL" at ROM 0x32D4.
- **Layout.**
  - A small rodata area (jump tables, floats) starts at 0x80071000.
  - .text runs to about 0x80117FFF; libultra .text is at about 0x800FF000..0x80117xxx.
  - rodata/data run from 0x80118000 to 0x80127E30.
  - These boundaries are estimates from function density.
  - There is no TLB-mapped code.
- **No decompression at boot.** A single raw blob is loaded at boot: function 0x80079CB8 (called from 0x8009D270) does `rom_read(0xB00B7E30, 0x803B17B0, 0x10400)`, i.e. ROM 0xB7E30..0xC8230 goes to 0x803B17B0, right after BSS.
  - This is **RSP segment 0x01**: 0x800A72C8 converts 0x01xxxxxx addresses with base 0x803B17B0.
  - It holds viewport tables and static F3DEX2 display lists from ROM 0xB7EB0.
  - The tail from about ROM 0xB9000 is stale build padding: compiler symbol-table strings and copies of sound data.
- **Microcode:** F3DEX2 ("F3DEX fifo 2.07").
- **libultra functions**, identified by body:

| RAM | Function |
|---|---|
| 0x80105B10 | osInitialize |
| 0x80103860 | osCreateThread |
| 0x80110560 | osStartThread |
| 0x8010CE60 | osPiStartDma (only caller 0x8009ED00) |
| 0x8010CF70 | osPiGetCmdQueue |
| 0x8010CFA0 | osCreatePiManager |
| 0x8010D130 | __osDevMgrMain |
| 0x8010D740 | osPiRawStartDma |
| 0x8010D820 | osPiRawReadIo |
| 0x8010D5C0 / 0x8010D610 | osEPiRawReadIo / osEPiRawWriteIo |
| 0x80104EC0 | osEPiStartDma (only caller: audio ROM pager 0x800FF21C) |
| 0x80111568 | osCreateViManager |
| 0x80102FB0 | osCartRomInit |

- 0x80078274 is a development-host stub that reads 0xB1FFFFF4 and similar addresses; it is not asset I/O.

### 2.2 Memory and address mapping

### 2.3 ROM map and asset organization

#### GA

**All asset reads** go through `0x8009ED00 rom_read(u32 cartAddr, void *dst, u32 len)`, which is osPiStartDma(OS_READ) plus osRecvMesg.

**There is no numbered file table.** Assets are found by:
1. cart addresses hard-coded in code as lui/addiu pairs; or
2. small tables of `(cartStart, cartEndInclusive)` pairs. A blob's length is `end - start + 1`, read as `(end - start + 1) & ~1`. A few end values overlap the next blob's start by one byte, which is harmless.

##### Tables
| Table | ROM / RAM | Record | Count | Users |
|---|---|---|---|---|
| Image records | 0xA6860 / 0x80116860 | 28 bytes: +0 u8 format, +1 u8 flags, +2 u16 width, +4 u16 height, +6/+8/+0xA u16 (unknown), +0xC and +0x10 pointers filled at runtime, +0x14 u32 cartStart, +0x18 u32 cartEndIncl | 196 (record 4 has start 0) | 0x8007BCF0(record, compressedFlag) |
| Sound blobs | 0xA4710 / 0x80114710 | 8 bytes: u32 cartAddr, u32 size | 26 | 0x80097BC4, 0x80097CC8, 0x80097D14, 0x80097DF8 |
| Scripts/cutscenes | 0xB53D0 / 0x801253D0 | 16 bytes: u32 type (=1), u32 cartStart, u32 cartEndIncl, u32 0 | 15 | 0x800D520C |
| Campaign steps | 0xB54C0 / 0x801254C0 | u32 pointer to a step record, NULL-terminated | 34 | 0x800E9424 returns `ptrs[*(u32*)0x803A8310]` |
| Mission (step) record | e.g. 0x80124B80 | +0 u32 type (0 = mission, 1 = script), +4 u32 levelId, +8 u32 mode, +0xC u8, +0xD..+0x11 u8[5], +0x50 u32, +0x64 u8, +0x6C u32 music id | 19 missions | 0x8009A6F8 |
| Level file switch | code 0x800E8380(levelId, flag, starts[], ends[]) returns the count; jump table 0x80075F60 | | 27 cases | 0x800AF43C |
| Level names | code 0x800E8C88(levelId) returns char*; jump table 0x80075FD0 | | 27 cases | |
| Map select (campaign and battle) | ROM 0xAB6A8 (8 USA tables) and 0xABCD8 (8 Europe tables), contiguous; RAM 0x8011B6A8 / 0x8011BCD8 | 16 bytes: u16 x, u16 y, char* name, u32 a (1..5), u32 levelId (27 = "GO TO EUROPE...." / "GO TO THE USA"). Verified by decoding the bytes (e.g. AIRPORT 26, BREAKOUT 0, SECRET BOATS 24, PANHANDLE 18). | 4..12 entries per table | 0x800C288C / 0x800C2D84 |
| Cheat codes | 0xB1C3C / 0x80121C3C (effect names at ROM 0xB1B14) | 33 char* | 33 | 0x800D0070; dispatcher 0x800D00F8, jump table 0x80074140 (section 10.1) |

##### Codec: LZARI (shared: identical in BTX1 and GA)
LZARI is the only asset codec in **both** games; everything else is stored raw. Both games use the same parameters and stream layout. In BTX1 every one of its 70 LZARI files decodes, and each decode consumes between (stored size - 16) and (stored size + 4) bytes. The helper functions are:

| Function | GA | BTX1 |
|---|---|---|
| lzari(inSize, src, maxOut, dst) | 0x800A0750 | 0x800F4F60 |
| StartDecode | 0x800A0918 | 0x800F5128 |
| StartModel | 0x800A0968 | 0x800F5178 |
| UpdateModel | 0x800A0A54 | 0x800F5264 |
| DecodeChar | 0x800A0BA8 | 0x800F53B8 |
| DecodePosition | 0x800A0E00 | 0x800F5610 |
| symbol / position binary search | 0x800A1040 / 0x800A1090 | 0x800F5850 / 0x800F58A0 |
| GetBit | 0x800A10E0 | 0x800F58F0 |

In BTX1 the word after the size header is often 0xFFFFFFxx. That is coded data, not a header field.

- **Callers (GA):** 0x8007BCF0 (image records), 0x800BA6C0 (level world files), 0x800BB53C (common world file).
- **Callers (BTX1):** 32 call sites, including the level loader 0x80088CF0 (file A), 0x800DDA08 (file B) and the front-end image-bank loaders.

The stream and algorithm are exactly Haruhiko Okumura's LZARI (1989):
- **Header:** `+0 u32` decoded size. The function returns -1 if it is 0 or greater than maxOut. The arithmetic-coded bitstream starts at +4.
- **Constants:** N = 4096 (ring), F = 60, THRESHOLD = 2, N_CHAR = 256 - THRESHOLD + F = 314. M = 15, so Q1 = 0x8000, Q2 = 0x10000, Q3 = 0x18000, Q4 = 0x20000, MAX_CUM = Q1 - 1 = 0x7FFF.
- **Bit input:** MSB-first within each byte. GetBit shifts the mask right and loads the next byte with mask 0x80 when the mask reaches 0.
  - The decoder can look ahead up to about one byte past the compressed data.
  - The game reads whatever bytes follow; a port may supply zero bytes, and the output is the same.
- **StartDecode:** `value` = the first 17 bits (M + 2). low = 0, high = Q4.
- **StartModel:**
  - Symbols: `sym_freq[i] = 1` for i = 1..314; `sym_cum[i-1] = sym_cum[i] + sym_freq[i]`; `sym_to_char[i] = i - 1`.
  - Positions: `position_cum[N] = 0`; `position_cum[i-1] = position_cum[i] + 10000 / (i + 200)` (integer division) for i = N..1.
- **Ring buffer:** `text[0..N-F-1] = 0x20` (4036 spaces). The write position starts at r = N - F = 4036.
- **DecodeChar:**
  - range = high - low.
  - Binary-search sym such that `sym_cum[sym] <= ((value - low + 1) * sym_cum[0] - 1) / range < sym_cum[sym-1]`.
  - high = low + range * sym_cum[sym-1] / sym_cum[0]; low += range * sym_cum[sym] / sym_cum[0].
  - Renormalise in a loop:
    - if low >= Q2: value -= Q2, low -= Q2, high -= Q2;
    - else if low >= Q1 and high <= Q3: subtract Q1 from all three;
    - else if high > Q2: stop.
    - Each iteration that doesn't stop then doubles low and high and sets value = 2 * value + GetBit.
  - Then `c = sym_to_char[sym]`; UpdateModel(sym); return c.
- **UpdateModel(sym):**
  - If `sym_cum[0] >= MAX_CUM`, halve the frequencies: c = 0; for i = 314..1: `sym_cum[i] = c; c += (sym_freq[i] = (sym_freq[i] + 1) >> 1)`; then `sym_cum[0] = c`.
  - Find i = sym, moving down while `sym_freq[i] == sym_freq[i-1]`. If i < sym, swap `sym_to_char[i]`/`sym_to_char[sym]` and update `char_to_sym`.
  - `sym_freq[i]++`; then while i-- > 0: `sym_cum[i]++`.
- **DecodePosition:** range = high - low.
  - Binary-search i in 1..N (start i = 1, j = N; while i < j: k = (i + j) / 2; if `position_cum[k] > x` then i = k + 1, else j = k) for x = `((value - low + 1) * position_cum[0] - 1) / range`; position = i - 1.
  - high = low + range * `position_cum[position]` / `position_cum[0]`; low += range * `position_cum[position+1]` / `position_cum[0]`.
  - Renormalise as in DecodeChar. There is no model update.
- **binsearch_sym** (used by DecodeChar): i = 1, j = 314; while i < j: k = (i + j) / 2; if `sym_cum[k] > x` then i = k + 1, else j = k; returns i. All divisions are unsigned integer divisions.
- **Main loop:** while out < size:
  - c = DecodeChar().
  - If c < 256, output c and store it in `text[r++ & (N-1)]`.
  - Otherwise: i = (r - DecodePosition() - 1) & (N-1); length j = c - 255 + THRESHOLD, i.e. 3..60. Copy j bytes from `text[(i+k) & (N-1)]`, outputting each and storing it at `text[r++ & (N-1)]`.
- **Termination:** there is no end marker; decoding stops when `size` bytes have been output.
  - The count is only checked between tokens, so the final match can write a few bytes past `size`.
  - Allocate `size + 60` and truncate.
- **Reference implementation:** `btx/fs2/lzari.py`. It decodes all 271 LZARI blobs.

##### ROM map
| ROM range | Content | Codec | Reached by |
|---|---|---|---|
| 0x000000-0x001000 | header + IPL3 | raw | |
| 0x001000-0x0B7E30 | main image (code + data) | raw | IPL3, to 0x80071000 |
| 0x0B7E30-0x0C8230 | RSP segment 1 blob (tail stale) | raw | 0x80079CB8, to 0x803B17B0 |
| 0x0C8230-0x100000 | stale build padding (duplicates of pool and sound bytes) | | nothing |
| 0x100000-0x102068 | LZARI blob, 9-word header, decoded size 0x5CB4: a leftover BTX1 level file (byte-identical to BTX1 internal level 9 "Chicago - Bonus" file A) | LZARI | **no reference found** (section 10.1) |
| 0x102068-0x102C68 | 3 x 0x400-byte raw buffers | raw | 0x800F09C0, to 0x803AA750 / 0x803AAB50 / 0x803AAF50 |
| 0x102C70-0x2F8070 | **TEX pool**: texture chunks | raw | world-file pool references |
| 0x2F8070-0x3013F0 | **PB pool**: render-state display-list chunks | raw | world-file pool references |
| 0x3013F0-0x3F6EE8 | **GEO pool**: geometry display-list + vertex chunks | raw | world-file pool references |
| 0x3F6EE8-0x3F9B5C | common world file (loaded for every level) | LZARI | hard-coded in 0x800BB53C |
| 0x3F9B60-0x46F652 | 74 level world files | LZARI | level switch 0x800E8380 |
| 0x46F660-0x514714 | image-record data (195 LZARI) + 4 raw aux blobs at 0x4729C0-0x47317C (4 x 0x1EC) | LZARI / raw | table 0x80116860 / 0x80096810 |
| 0x514720-0x58FAD1 | 17 scripts/cutscenes (64-byte header; byte 0 = scene type) | raw | table 0x801253D0, cheats, 0x800C08E8 |
| 0x58FAE0-0x7BE9AE | 26 sound blobs ("N64 PtrTablesV2", "N64 WaveTables", ...) | raw | table 0x80114710 |
| 0x7BE9AE-0x800000 | 0xFF padding | | |

##### Extracting every file
- **Command:** `python3 btx/fs2/extract.py [ROM] [OUTDIR]`. It is self-contained (LZARI plus a tiny MIPS interpreter that evaluates the level switch in code) and takes about 21 s.
- **Output:**
  - `NNNN_{romoff}_{kind}.bin` (decompressed);
  - `index.csv` (id, rom_offset, stored_size, decompressed_size, codec, first4, type_guess, source, note);
  - `levels.csv`;
  - `campaign.csv`.
- **Counts:** 6251 index rows, 271 of them LZARI.

| Kind | Rows |
|---|---|
| geo | 4638 |
| tex | 736 |
| pb | 409 |
| image | 195 |
| world | 75 |
| sound | 26 |
| script | 17 |
| imgaux | 4 |
| buf400 | 3 |
| boot, main, seg1, stale, unrefLZ | 1 each |
| gap (unreferenced pool bytes) | 142 |

- **Porting to the viewer:** the switch can simply be transcribed as the static table in section 4.

### 2.4 Compression formats

#### Codec (shared)

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

#### Filesystem and codec

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

### 2.6 Revision differences

## 3. Level data

### 3.1 Level catalog and identifiers

#### GA

GA identifies levels by a **level id from 0 to 26**.
- **Level names:** 0x800E8C88(id) returns the name; the switch jumps through table 0x80075FD0.
- **Level files:** 0x800E8380(id, flag, starts[], ends[]) fills in the files to load; it jumps through table 0x80075F60 and is called by the level-load master 0x800AF43C.
- **Load order:** the master first loads the **common world file** 0x3F6EE8-0x3F9B5C, which is shared by every level. It then loads 1-2 LZARI world files: slot 0 (base) and slot 1 (variant).
- **flag:** `0x8009D144()`, which is `7 <= *(u32*)0x802294A0 (mode) < 15`. Campaign missions use modes 7..14 (flag 1); battle modes use the other values (flag 0).
- **Cutscene variant:** in cases 0, 2, 4, 5 and 14, the flag-0 path also tests game state `*(u32*)0x80117EB4 == 10`, which the cutscene script player sets. When it is set, a cutscene-specific slot 1 is used.

File ranges in the table below are ROM start-end, inclusive. **Verified** (static, and in the emulator for level 0's cutscene load).

| Id | Name (0x800E8C88) | Slot 0 | Slot 1: campaign (flag 1) | Slot 1: battle (flag 0) | Slot 1: cutscene |
|---|---|---|---|---|---|
| 0 | SF BREAKOUT | 3F9B60-3FCCB0 | 3FCCB0-3FD8A7 | 3FD8A8-3FDA6A | 3FDA70-3FEA2A |
| 1 | TRUCK STOP | 3FEA30-40259E | 4025A0-402B16 | 402B18-403929 | |
| 2 | TEXAS SLAVE FORTRESS | 403930-405C4C | 405C50-4077E2 | 4077E8-409019 | 409020-40A178 |
| 3 | DRIVE IN | 40A178-40E945 | 40E948-40FAF8 | 40FAF8-4107F4 | |
| 4 | DC MALL | 4107F8-415096 | 415098-4162A0 | 4162A0-417227 | 417228-417670 |
| 5 | WHITE HOUSE | 417670-419A6B | 419A70-41AE90 | 41AE90-41B95B | 41B960-41BA29 |
| 6 | HOUSES OF PARLIAMENT | 41BA30-420708 | 420708-4223AA | 4223B0-4232B4 | |
| 7 | TOWER BRIDGE | 4232B8-424A72 | 424A78-4266F4 | 4266F8-426D32 | |
| 8 | TOWER OF LONDON | 426D38-42AD5E | 42AD60-42B853 | 42B858-42C4FD | |
| 9 | BISTRO | 42C500-43096D | 430970-431B56 | 431B58-432758 | |
| 10 | CHAMPS ELYSEE | 432758-4362D8 | 4362D8-4380D7 | 4380D8-4394F5 | |
| 11 | EIFFEL TOWER | 4394F8-43DE28 | 43DE28-43F98A | 43F990-440BAB | |
| 12 | BERLIN WAR ZONE | 440BB0-443F61 | 443F68-4458F9 | 445900-44652D | |
| 13 | BRANDENBURG GATE | 446530-448DAA | 448DB0-449C3A | 449C40-44ABAF | |
| 14 | ESCAPE FROM BERLIN | 44ABB0-44D267 | 44D268-44EDCE | 44EDD0-44FF18 | 44FF18-45031D |
| 15 | ASSAULT ON SF | 450320-454AA7 | 454AA8-4556C0 | 4556C0-456696 | |
| 16 | ALCATRAZ | 456698-459984 | 459988-45A821 | 45A828-45B5E1 | |
| 17 | LAKEPARK | battle: 45B5E8-45EB00 | falls through to 24 | 45EB00-45F54D | |
| 18 | PANHANDLE | battle: 45F550-462571 | falls through to 24 | 462578-463012 | |
| 19 | RAILYARD | battle: 463018-465733 | falls through to 24 | 465738-46662B | |
| 20 | SFO | battle: 466630-468950 | falls through to 24 | 468950-469345 | |
| 21 | CROSSFIRE | battle: 469348-46A854 | falls through to 24 | 46A858-46B170 | |
| 22 | (NULL name) | battle: 46B170-46B4EA | falls through to 24 | 46B4F0-46B4FE | |
| 23 | (NULL name) | battle: 46B500-46B54A | falls through to 24 | 46B550-46B6A4 | |
| 24 | SHORE PATROL | campaign: 3F9B60-3FCCB0 | 46B6A8-46CE5C | battle loads only 46B550-46B6A4 | |
| 25 | (NULL name) | 46B550-46B6A4 (single file, either flag) | | | |
| 26 | SF AIRPORT | 46CE60-46E821 | 46E828-46ED1A | 46ED20-46F652 | |

Notes on the table:
- **Ids 17-23 with flag 1** each branch into the next case, so they all end up in case 24's campaign path. That path loads 3F9B60 (SF BREAKOUT's base) plus 46B6A8, so Shore Patrol re-uses SF Breakout's terrain.
- **Ids 17-23 with flag 0** load two files. The "battle:" column is the first; it acts as that arena's own base.

**Campaign order** comes from the step list at 0x801254C0, indexed by `*(u32*)0x803A8310`. Records of type 0 are missions (level id at +4, mode at +8, music id at +0x6C); type 1 records are cutscene scripts. The 19 missions, in order:

| # | Id | Level |
|---|---|---|
| 1 | 26 | SF AIRPORT |
| 2 | 0 | SF BREAKOUT |
| 3 | 1 | TRUCK STOP |
| 4 | 2 | TEXAS SLAVE FORTRESS |
| 5 | 3 | DRIVE IN |
| 6 | 4 | DC MALL |
| 7 | 5 | WHITE HOUSE |
| 8 | 6 | HOUSES OF PARLIAMENT |
| 9 | 7 | TOWER BRIDGE |
| 10 | 8 | TOWER OF LONDON |
| 11 | 9 | BISTRO |
| 12 | 10 | CHAMPS ELYSEE |
| 13 | 11 | EIFFEL TOWER |
| 14 | 13 | BRANDENBURG GATE |
| 15 | 12 | BERLIN WAR ZONE |
| 16 | 14 | ESCAPE FROM BERLIN |
| 17 | 24 | SHORE PATROL |
| 18 | 15 | ASSAULT ON SF |
| 19 | 16 | ALCATRAZ |

The full step list, with the cutscenes interleaved, is in `fs2/files/campaign.csv`.

##### In-game menus and level order (GA)
Verified in the emulator unless marked otherwise. Screenshots are in `btx/ref2/shots/`; input sequences are in `notes/ref2.md`.

**GAME SETUP** has PLAYERS / PLAY MODE / OPTIONS / CREDITS / INPUT CODE / LOAD GAME / START.

**PLAY MODE** (1 player, D-right order): CAMPAIGN, DEATHMATCH, BATTLELORD, FRENZY, HOLD-EM, FAMILY MODE, TANK WARS, CONVOY. The ROM string order differs: CAMPAIGN, BATTLELORD, DEATHMATCH, ...

**OPTIONS** has SOUND FX, MUSIC (volume sliders), DIFFICULTY, POWER UPS, UNLIMITED AMMO, CONTROLLER CONFIG, EXIT. There is no music test or jukebox.

**Campaign.**
- A new game starts at SF AIRPORT (verified); the next mission, SF BREAKOUT, was also seen.
- The mission order is the step list given earlier in 4.1. It is verified from code, and the in-level titles, briefings and objectives in ROM share the same order.
- With cheat 80DYS, the campaign map lets you walk all 19 missions.
  - USA map: SAN FRANCISCO - AIRPORT, SAN FRANCISCO - ASSAULT, SAN FRANCISCO - BREAKOUT, SAN FRANCISCO - ALCATRAZ, SAN FRANCISCO - SECRET BOATS, ARIZONA - TRUCK STOP, TEXAS - SLAVE FORTRESS, ROUTE 66 - DRIVE IN, WASHINGTON DC - WHITE HOUSE, WASHINGTON DC - MALL.
  - Europe map: LONDON - TOWER, LONDON - PARLIAMENT, LONDON - TOWER BRIDGE, PARIS - BISTRO, PARIS - EIFFEL TOWER, PARIS - CHAMPS ELYSEES, GERMANY - BRANDENBURG GATE, GERMANY - BERLIN WAR ZONE, GERMANY - ESCAPE FROM BERLIN.
- Map names differ from the level names in three places: SECRET BOATS is SHORE PATROL (24), SAN FRANCISCO - ASSAULT is ASSAULT ON SF (15), and LONDON - TOWER is TOWER OF LONDON (8).
- Campaign missions load the flag-1 variant files.

**Map node tables.**
- There are 16 tables: USA#0..#7 from ROM 0xAB6A8, then Europe EU#0..#7 from ROM 0xABCD8. Record layout is in 3.1.1.
- The USA ids below were decoded from the bytes. The EU ids are given by name (via 0x800E8C88).
- #0 is the campaign map.

| Table | Level ids in order |
|---|---|
| USA#0 | 26 AIRPORT, 15 ASSAULT, 0 BREAKOUT, 16 ALCATRAZ, 24 SECRET BOATS, 1 TRUCK STOP, 2 SLAVE FORTRESS, 3 DRIVE IN, 5 WHITE HOUSE, 4 DC MALL, 27 GO TO EUROPE |
| USA#1, #5, #6 | 20 SFO, 15 ASSAULT, 16 ALCATRAZ, 18 PANHANDLE, 1 TRUCK STOP, 2 SLAVE FORTRESS, 3 DRIVE IN, 5 WHITE HOUSE, 4 DC MALL, 27 |
| USA#2, #3, #4 | as USA#1 without 1 TRUCK STOP |
| USA#7 | 1 TRUCK STOP, 2 SLAVE FORTRESS, 4 DC MALL, 27 |
| EU#0 | 27 GO TO THE USA, 8 LONDON TOWER, 6 PARLIAMENT, 7 TOWER BRIDGE, 9 BISTRO, 11 EIFFEL TOWER, 10 CHAMPS ELYSEES, 13 BRANDENBURG GATE, 12 BERLIN WAR ZONE, 14 ESCAPE FROM BERLIN |
| EU#1, #5 | 27, 8 LONDON TOWER, 6 PARLIAMENT, 9 BISTRO, 11 EIFFEL TOWER, 10 CHAMPS ELYSEES, 17 LAKEPARK, 21 CROSSFIRE, 13 BRANDENBURG GATE, 12 BERLIN WAR ZONE, 14 ESCAPE FROM BERLIN, 19 RAILYARD |
| EU#2, #3, #4, #6 | as EU#1 without 8 LONDON TOWER |
| EU#7 | 7 TOWER BRIDGE, 10 CHAMPS ELYSEES, 13 BRANDENBURG GATE, 14 ESCAPE FROM BERLIN |

**Deathmatch** (1 player, 80DYS active, walked in game) lists 20 arenas in exactly the USA#1 + EU#1 order: SFO, ASSAULT, ALCATRAZ, PANHANDLE, TRUCK STOP, SLAVE FORTRESS, DRIVE IN, WHITE HOUSE, DC MALL, then LONDON - TOWER, PARLIAMENT, BISTRO, EIFFEL TOWER, CHAMPS ELYSEES, LAKEPARK, CROSSFIRE, BRANDENBURG GATE, BERLIN WAR ZONE, ESCAPE FROM BERLIN, RAILYARD.
- Battle modes load the flag-0 variant files.
- LAKEPARK, PANHANDLE, RAILYARD, SFO and CROSSFIRE never appear in the campaign.

**Hypothesis:** tables #1..#7 correspond to DEATHMATCH, BATTLELORD, FRENZY, HOLD-EM, FAMILY MODE, TANK WARS and CONVOY. Only DEATHMATCH = #1 is verified. That would give:
- BATTLELORD, FRENZY and HOLD-EM 19 arenas each;
- FAMILY MODE 20;
- TANK WARS 19;
- CONVOY the 7 in USA#7 + EU#7.

**Suggested viewer level list** (GA):
1. The 19 campaign missions in campaign order, with the campaign (flag 1) variant.
2. The 5 battle-only arenas: 17 LAKEPARK, 18 PANHANDLE, 19 RAILYARD, 20 SFO, 21 CROSSFIRE (flag 0).
3. Optionally, the battle variants of the campaign maps and the hidden ids 22, 23 and 25 (section 10).

### 3.2 Level container

#### Level data format

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

##### GA world files (verified)
Loaders: 0x800BA6C0 per file, 0x800BB53C for the common file.

**Level assembly.** A level loads the common world file (0x3F6EE8), then slot 0, then slot 1 of its variant (4.1).
- Each file's model, part and pool-ref arrays are file-local. The loader concatenates them, with per-file bases in the 0x38-byte descriptor at +0x1C / +0x28 / +0x34.
- Placements in a file index models of the same file.
- The viewer should take instances from slot 0 and slot 1 only; the common file holds global objects, such as a 263-entry global model list (kind 33) used by 0x800BB2A0.

**Sections** (header: 8 x u32, h0 = 0x20, h7 = file size):

| Section | Record | Layout |
|---|---|---|
| [h0,h1) | 4 B | u32 groupCount |
| [h1,h2) | 16 B x groupCount | u16 placementCount, u16 firstPlacement, s16 minX, minY, minZ, maxX, maxY, maxZ |
| [h2,h3) | 12 B | placement: s16 x, s16 y (up), s16 z, u16 yaw (0x10000 = 360°), u32 defOffset (relative to h3) |
| [h3,h4) | variable | object definition; byte 0 = kind 0..45 (spawn switch 0x800DFA5C, jump table 0x80075950) |
| [h4,h5) | 16 B | model: u8 partCount, u8 0, u16 firstPart, s16 minX, minY, minZ, maxX, maxY, maxZ |
| [h5,h6) | 4 B | part: u8 poolRefCount, u8 0, u16 firstPoolRef. **Hypothesis:** parts are LOD levels. Only common-file models have more than one part, with triangle counts falling per part. |
| [h6,h7) | 24 B | pool ref: s32 geoOff, geoSize, pbOff, pbSize, texOff (-1 = none), texSize |

**Placement transform** (0x8009EFD4, then guMtxF2L 0x80108DC0):
- Column-vector form: `world = RotY(θ)·v + (x, y, z)`, with θ = yaw·2π/65536 and `RotY = [[c,0,s],[0,1,0],[-s,0,c]]`.
- Row-vector form (as N64 Mtx): rows `[c 0 -s 0] [0 1 0 0] [s 0 c 0] [x y z 1]`.
- Verified against the dump. SF AIRPORT placement (792, 0, -287, yaw 0x4000) appears in `ref2/air1.bin` as MODELVIEW rows [0 0 -1][0 1 0][1 0 0][792 0 -287].

**Object kinds.** Model indices are file-local; 0xFFFF or out of range means no model.

| Kind(s) | Meaning | Model field(s) |
|---|---|---|
| 0, 1, 2, 11, 14, 22, 34, 35, 43, 44 | static model (0x800DF0D0) | u16 at +2 |
| 12 | model gated by a player-count test | +4 |
| 13 | 16 B; case 0x800E0E2C, then 0x800DE930 | u16 at +12. 223 of 248 have none, including all 23 in SF AIRPORT. |
| 3, 4, 5, 10, 15, 21, 24, 26, 28, 29, 31, 32, 36, 40 | multi-model spawners (destructibles and animated objects). Take the first field as the initial model (**hypothesis:** the intact state). | 3: +2..+16; 4: +2..+10; 5: +2, +4, +6; 10: +2, +4, +6; 15: +2, +4, +6, +10; 21: +2..+12; 24: +2, +4, +6; 26: +6, +8, +10; 28: +2, +4, +6; 29: +2; 31: +2; 32: +2..+14; 36: +2, +4; 40: +2. Table `MODEL_FIELDS` in `lvl2/loader.ts`. |
| 39 | conditional include {u8 39, u8 cond, u16 flag, u32 defOffset} (case 0x800E1468) | recurses into the target def |
| 6 | waypoint {06, u8 chain, u8 index, 00} | none |
| 7 | pickup (u8 +1 = type) | none |
| 17 | player start {u8 17, u8 slot, u16 value}. Stored at *(0x80219498)+500+24·slot as f32 x, z, sin, cos, value. Campaign variants have none. | none |
| 30 | collision box, trigger or play-area rectangle (16 B, sub-switch on +1; 5.1.4) | none |
| 42 | invisible solid with a model's bounds (4 B {42, 0, u16 model}; 5.1.4) | model u16 at +2, collision only |
| 37 | fog and lights, 24 B (below) | none |
| 38 | group ambient light, 4 B {38, r, g, b} | none |
| 33 | global model list (common file) | none |
| 8, 16, 20, 23, 27, 41, 45 | logic, payload unknown | none |
| 9, 18, 19, 25 | no-op | none |

- **Kind 39 condition.** f(flag) = mode `*(u32)0x802194A0` ∈ {1, 3, 11} and `u8 0x80219582[flag] < u8 *0x802194A6` (function 0x800E8090). cond 0 includes the target if f is true; cond 1 if f is false.
  - Battle files carry four identical cond-0 groups (flags 0-3). In mode 0 none are included.
  - Following all of them stacks duplicates. PANHANDLE has 48 such includes.
- **Multi-player skips.** If `u8 *0x802194A4 >= 2`, kinds 10 and 4 are skipped, and kind 15 is kept only if def+8 ∈ {1, 6}.

**Pool chunks and load-time fix-ups.** Chunks are read with `rom_read(poolBase + off, heap, size)`. Registration and dedupe happen at 0x800B9FD4: up to 2800 GEO, 256 PB and 256 TEX, then packed with 8-byte alignment.
- **GEO** (read at 0x800BB048):
  - Contents: G_VTX, G_TRI1 and G_ENDDL only; G_VTX w1 += chunk base.
  - Vertex (16 B): s16 x, y, z, u16 0, s16 s, t, **s8 nx, ny, nz**, u8 alpha.
  - One malformed chunk sits at GEO offset 0x5D40 (vertices before commands); it is used only by unreachable level 23.
- **TEX** (read at 0x800BAF74):
  - Command sequence: E3 (TLUT mode), FD G_SETTIMG (chunk-relative; w1 += chunk base), F5/E8 tile 7, E6, optional F0 LOADTLUT, F3 LOADBLOCK, DF. Texels start at +0x30.
  - Palettes: each F0 loads 16 RGBA16 entries at texture memory 0x800 + 0x80·k. Several loads form one 256-entry TLUT indexed by texel value.
  - The LOADBLOCK is labelled "CI16"; the PB's G_SETTILE on tile 0 gives the real format.
  - Formats: RGBA16 (most), CI4/CI8 with RGBA16 TLUT, I4, I8, RGBA32.
  - Wrap: 0 repeat, 1 mirror, 2 clamp. dxt is 0x40..0x800, so texture.ts's odd-row emulation applies. Width can be checked as bytes per row = 16384 / dxt.
  - The chunk at TEX offset 0x94740 has no DL header; it is used only by level 23.
- **PB** (read at 0x800BB0E0): E7, F5 (tile 0 descriptor), F2 (tile size, corner always 0), E3 (cycle, texture persp, TLUT type), D7 (G_TEXTURE on = bit 1, scale 0x8000), D9, FC, E2, sometimes FA/FB, then DF. No addresses.
- **State patcher 0x800B9B8C** (applied to every TEX and PB chunk at load; **required for correct colours and culling**). It walks 8-byte commands up to G_ENDDL:
  - A G_GEOMETRYMODE (D9) with a non-zero set word gets `set |= 0x10400` (G_FOG | G_CULL_BACK) and `set &= ~0x200` (G_CULL_FRONT).
  - A D9 with a zero set word gets `w0 |= 0xFFFBFF`, so it can only clear G_CULL_BACK. **G_LIGHTING can never be cleared, so all level geometry is lit.**
  - 17 whole-command substitutions: table 0x80116710 to 0x80116798, covering one cycle type, nine render modes (E2) and seven combiners (FC). Transcribed as `STATE_PATCH` in `lvl2/loader.ts`.
  - Without this patch, the SF AIRPORT terminal wall renders blue.

**Draw pipeline.**
- Frame setup, in the segment-1 static DL at +0x80: geometry mode 0x220405 | G_FOG (i.e. 0x230405), render mode 0x552078.
- Draw lists: nodes are added by 0x8007B1F0 (32 hash buckets per view, up to 2288 nodes {geo, tex, pb, mtx, flags, light, next}) and drawn by 0x8007B65C / 0x8007B8EC.
- Per node, the frame DL issues:
  1. G_MTX MODELVIEW | LOAD with the instance Mtx;
  2. `gSPDisplayList(TEX)`, only when it changed;
  3. `gSPDisplayList(PB)`, only when it changed;
  4. the group light DL (G_MOVEMEM lights + ambient);
  5. `gSPDisplayList(GEO)`.
- The PROJECTION matrix is view × perspective (0x8007AB64).
- Which caller culls or LODs static instances has not been identified (9.1).

**Lighting.**
- Kind 37 (24 B): +1..3 fog RGB (also the sky fill colour); +4..6 light 0 RGB; +7..9 light 0 direction (s8); +10..12 light 1 RGB; +13..15 light 1 direction; +16..21 unknown (passed to 0x800F7150).
  - Stored by 0x800B05F4, applied by 0x800B04E0 and 0x800A9C24.
- Kind 38: group ambient RGB (0x800B06A8).
- The runtime light MOVEMEMs in all three dumps equal the data:
  - air1: light 0 ccbca3/ec4491, light 1 464389/386c88, ambient 727273.
  - brk1: b4aa5d/494949, 9085a5/4949b7, 464650.
  - pan1: ccbca3/494949, 464389/4949b7, 727273.

**Per-level examples** (fog RGB): DC MALL 797CA0, WHITE HOUSE 8C7F66, CHAMPS ELYSEE 11111E (night).

**Scene split by kind** (viewer layers in `src/rom/battletanxga.ts`). The world file's groups are few (one per file in most levels), so drawn placements are grouped by kind along their collision registration (5.1.4). Content was identified from renders of each kind alone (SF Breakout, Tower Bridge); it is an observation, not a game-defined name.

| Layer | Kinds | Content seen |
|---|---|---|
| terrain | 2, 11, 22, 34, 44 | ground tiles and platforms (2), rubble mounds (11), ramps (22), flat water and pavement tiles (34, height 0), arrow decals (44) |
| scenery (no collision) | 0 | pieces that register no collision: cliff edges with trees, the Tower Bridge superstructure and parkland |
| buildings and walls | 1, 35 | walls and building walls (solid) |
| fences and tank traps | 14 | see-through solids: fences, rails, tank traps |
| edge walls | 43 | long thin walls whose collision reaches y 5000 |
| destructibles | 3, 4, 5, 10, 15, 21, 26, 28, 29, 31, 32, 36, 40 | buildings (3), trees (4), posts and rails (5), guard towers (10), drums (15), crates (21), a blimp (28) |
| vehicles | 24 | parked cars |
| other objects | the rest (12, 13) | small flat pads (12, player-count gated) and single items (13) |

##### GA collision (verified)
GA has **no triangle collision against the level geometry and no heightfield**. The spawn switch 0x800DFA5C adds a flat list of **boxes** through 0x800B1898 while it spawns each placement. Walls are boxes, and the ground height comes from three kinds of "surface" box (platform, ramp, mound). Only the slot files (base and variant) register collision, not the common world file.

**Collision entry** (40 B; 1400 slots at 0x803978E0; free-list head u16 at 0x803977E8; s16 unless noted):

| Offset | Field |
|---|---|
| +0 | u32 flags |
| +4 | owner pointer (0 for level statics) |
| +8 | u16[4] grid-cell next links |
| +16 / +18 / +20 | x / z / y base |
| +22 / +24 / +26 / +28 | minX / maxX / minZ / maxZ |
| +30 / +32 | bottom / top (world span: y base + bottom .. y base + top) |
| +34 | radius = max + 3·min/8 of the half extents |
| +36 | u16 residual yaw |
| +38 | u16 group |

**Entry from a placement:**
- **Centre:** the placement (x, z).
- **Model-based entries:** the model record's bounds (h4 +4..+14). y base = 0, bottom = s16(placement y + model minY), top = s16(placement y + model maxY). Kind 43 is the exception: its top is the constant 5000.
- **Kind 30 entries:** y base = placement y; bottom/top are the definition's minY/maxY.
- **Yaw** (only if `flags & 0x039BEF67`):
  - Flag exactly 0x800 forces yaw 0.
  - A yaw snaps to quadrant t if `(t − yaw) & 0xFFFF <= 4096` (0x8009D6DC). This is asymmetric: only yaws up to 22.5° *below* a quadrant snap; e.g. 0x0CCC stays unsnapped (seen in the dumps).
  - 90°, 180° and 270° are then baked into the extents with the placement's RotY (at 90°: x ∈ [minZ, maxZ], z ∈ [−maxX, −minX]), and the residual yaw becomes 0.
  - Any other yaw is kept as an oriented box. Ramps (0x80) are outside the mask and always keep their full yaw.
- **Oriented-box corners** (0x800B2BE4): `X = x + c·lx + s·lz`, `Z = z − s·lx + c·lz`, the same rotation as the model matrix.
- **Per-group grids** (24 B each at 0x803977F0; built by 0x800B06E0 / 0x800B07D4): origin at the group's minX/minZ (the union of the slot files' group bounds), `(size >> 10) + 3` cells of 1024 units per axis. An entry whose box does not overlap its group's grid is freed (4 fences in SF Airport are never registered). If only the centre is outside, 0x800B14A8 moves the centre onto the grid's min edge and keeps the absolute extents. Only placements listed in a group spawn.

**Kind 30** (16 B, spawn case 0x800E11EC, sub jump table 0x80075A18): `{u8 30, u8 sub, s16 minX, minY, minZ, maxX, maxY, maxZ, u16 0}`, extents relative to the placement.

| sub | Effect | Count (all world files) |
|---|---|---|
| 0 | writes the rectangle `[x+minX, z+minZ, x+maxX, z+maxZ]` into the group's runtime record +12..+18 (default: the group bounds); heights ignored. Its readers (0x800857F0, 0x8008FA6C, 0x800E7174) pick random points inside it, so it is a play area, not a wall | 23 (one per base file) |
| 1 | box, flag 0x01000000 | 31 |
| 2 | box, flag 0x00080000 (call at 0x800E13C8) | 45 |
| 3, 4 | trigger object (0x800E9990) with a box, flag 0x10000 | 11 / 0 |

**Kind 42** (4 B): `{42, 0, u16 model}`, an invisible solid (flag 0x1) with that model's bounds; nothing is drawn. 18 in all files (DC Mall 3, Shore Patrol 14, SF Airport 1).

**What registers** (all inside the spawn switch, so excluded kind-39 includes and the multi-player skips of kinds 10, 4 and 15 register nothing):

| Kind | Flag | Rule | Code |
|---|---|---|---|
| 1 | 0x1 | model +2 | 0x800E03BC |
| 14 | 0x4000 | model +2 | 0x800E03BC |
| 2 | 0x20 | only if the model exists and its maxY >= 2 (flat ground tiles have no entry) | 0x800DFD44 |
| 11 | 0x40 | model +2 | 0x800E017C |
| 22 | 0x80 | model +2 | 0x800DFFEC |
| 35 | def+6 = 0: 0x1, else 0x20 | model +2 | 0x800E0940 |
| 42 | 0x1 | model +2, not drawn | 0x800E030C |
| 43 | def+5 = 0: 0x1, else 0x4000 | model +2, top 5000 | 0x800E0690 |
| 3, 21 | 0x2 | model +2 at spawn | 0x800DD554, 0x800EA044 |
| 5 | model maxY = 36: 0x800000, else 0x400 | model +2 | 0x800E1674 |
| 15 | def+8 ∈ {2, 3, 6}: 0x2, else 0x8000 | model +2 | 0x800EAD84 |
| 10 | 0x100000 (a 0x100002 variant exists; its condition is not pinned) | model +2 | 0x800ED460 |
| 0, 34, 44 | none (drawn only) | | |

- **Hypothesis (code only, not seen in any dump):** kind 24 registers 0x8000, kind 28 0x2, kind 32 0x40000 and kind 36 0x100000 with model +2. Adding them does not raise the dump matches (SF Airport 57, SF Breakout 76); the kind 24 boxes (car-sized, odd yaws) are probably vehicles that move. The viewer leaves all four out.
- **Kinds 4 and 8** use fixed boxes instead of model bounds: kind 4 is ±10 wide and 0..199 high with flag 0x800; kind 8 has flag 0x2000 (box not decoded). Not drawn by the viewer.

**Flags:**

| Flag | Meaning | Status |
|---|---|---|
| 0x1 | solid wall | verified: in the tank-movement mask 0x00E4540F (callers 0x800B78F8...) and the shot masks |
| 0x4000 | solid but see-through (fences) | **Hypothesis:** in the movement and shot masks, absent from the AI sight masks 0x64940B and 0x241009 |
| 0x20 / 0x40 / 0x80 | platform / mound / ramp | only in mask 0xE0, the ground-height query; they do not stop tanks sideways |
| 0x80000 (kind 30 sub 2) | blocks shells | **Hypothesis:** only in the segment-query masks 0x87007 and 0x2C700F; a hit spawns an effect at 0x8007EA48 |
| 0x01000000 (sub 1) | excluded from random spawn/destination picks | **Hypothesis:** only in the clearance masks 0x0104700F (0x80085954, 0x800E7234) |
| 0x10000 (sub 3/4) | trigger volume | **Hypothesis:** a level exit; queried by 0x800F5470, which calls the handler of whatever touched it |
| 0x2, 0x400, 0x8000, 0x100000, 0x800000 | destructibles | from the spawner call sites |

**Ground height** (0x800B9094 at spawn, 0x800B88DC per frame): for each of the object's four corners, the first surface box containing the corner (0x800B2890) gives its height.
- **Platform (0x20):** y + top, or y + bottom when |bottom| is larger.
- **Ramp (0x80):** the point in box-local space (0x800B2364) gets `h = y + bottom + (top − bottom)·(lz − minZ)/(maxZ − minZ)`, rising toward local +Z.
- **Mound (0x40, 0x800B83A8):** a flat top at P with edges sloping over max(width, depth)/4; within the slope the height is P·(distance to edge)/(slope width).
- **No surface:** the base height at object +40 (**hypothesis:** the ground plane, 0).

**Other queries:** object-vs-object tests use a circle pre-test on the radius, then an oriented-box separating-axis test (0x800B3018 / 0x800B2DF4). The vertical overlap test runs only when u16 0x80397650 is non-zero, which most callers clear, so most tests are 2D. The shell segment query 0x800B49E0 walks the grid cells along the segment; its per-entry test 0x800B4684 is not fully decoded.

**Verification against RAM dumps** (`btxcol/r2/btxcollision.ts {id} {variant} --dump ram.bin`, comparing all 13 fields of every live entry; the dump's kind-39 inputs match the viewer's default rule):

| Dump | Level | Static and zone entries | Destructibles (initial) | Live entries not predicted |
|---|---|---|---|---|
| `ref2/air1.bin` | 26 SF Airport, campaign | 229 of 229 | 57 of 68 | 3 ownerless flag-0x40 entries with odd yaws (runtime debris) |
| `ref2/brk1.bin` | 0 SF Breakout, campaign | 359 of 359 | 76 of 86 | 1 (debris) |
| `ref2/pan1.bin` | 18 Panhandle, battle | 483 of 483 | 68 of 72 | none |

Unmatched destructibles were destroyed or moved before the dump. The grid origin, cell counts and the kind-30 sub-0 rectangle match in every dump, including SF Breakout's second group.

**Viewer overlay** (`src/rom/battletanxga.ts`):
- Hidden layer **"collision"**: solid, see-through, invisible (kind 42), kind-43 walls to 5000 (faint), platform, ramp (a wedge rising along local +Z), mound (a frustum with the max(width, depth)/4 slope) and destructible meshes.
- Hidden layer **"collision zones"**: kind 30 subs 1, 2 and 3/4 as boxes, and each group's play-area rectangle as a 150-unit fence.
- The per-class counts equal the reference decoder for SF Airport, SF Breakout and Panhandle. Boxes are drawn 1 unit outside their extents and above their tops. Batch.triSource is `slot << 24 | placement record offset` in the decoded world file.
- Offline renders: `btxcol/img2/` (`*_cmp.png`).

### 3.3 Geometry

#### Level geometry decoded from level data

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

#### Runtime render state (both games; verified from RAM dumps of the running games)

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

#### Levels, textures, placement, sky, fog

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

### 3.7 Environment, sky, fog, and lighting

### 3.8 Cameras and paths

## 4. Objects

### 4.1 Placement records

### 4.2 Object and model formats

#### Game detection and the model (both games)

- **`src/rom/index.ts`:** add `case 'NBXE'` and `case 'NBQE'` next to NRUE/NSFE. `normalizeByteOrder` already handles v64/n64.
- **`src/rom/types.ts`:**
  - Extend `Game.id` with `'battletanx' | 'battletanxga'`.
  - Extend `LevelKind` too. Suggested additions: `'campaign'` for BTX1 campaign levels and GA missions, `'bonus'` for BTX1 bonus levels, and `'test'` for BTX1 Test/Spare/MP ids with data.
  - `'battle'` already exists and fits GA battle arenas and BTX1 multiplayer arenas.
  - The sidebar may need labels for the new kinds.

### 4.3 Skeletons and animation

### 4.4 Behaviors, triggers, and scripted objects

## 5. Audio

### 5.1 Audio storage and banks

### 5.2 Sequence format and driver

#### GA: libmus ("N64 PtrTablesV2" / "N64 WaveTables")

##### System
- **Player library:** Software Creations' **libmus**, running on libultra's alSynth. There are no libultra sequences, .ctl/.tbl banks or MIDI files. The libultra type-name strings at ROM ~0xBD4C6 are leftover compiler debug info in stale padding.
- **Init:** game code at 0x80097540 builds `musConfig` and calls **MusInitialize 0x800FAFBC** with:

  | Field | Value |
  |---|---|
  | channels | 42 (synth voices) |
  | thread_priority | 20 |
  | heap_length | 0x3EBC0 |
  | fifo_length | 64 |
  | syn_updates | 256 |
  | syn_output_rate | 22050 |
  | syn_rsp_cmds | 4096 |
  | syn_retraceCount | 2 |
  | DMA buffers | 58 x 2048 |

- **Output rate: 22047 Hz.** osAiSetFrequency 0x801029F0 returns 22047 and AI_DACRATE = 2207. This is confirmed by the capture log.
- **Reverb:** always libultra **BIGROOM**, forced at init (0x800FEE60, preset table 0x801266B8). The fx-change commands are ignored.
- **Player tick:** handler 0x800FC02C runs every 16666 µs, which is **367 output samples** (NTSC).
- **libmus API:**

  | Function | Address |
  |---|---|
  | MusStartSong | 0x800FB270 (internal 0x800FDA60) |
  | MusSetMasterVolume | 0x800FB244 |
  | MusStop | 0x800FB688 |
  | MusHandleStop | 0x800FB7D4 |
  | MusPtrBankInitialize | 0x800FBB34 (0x800FD2A0) |
  | MusPtrBankSetSingle | 0x800FBB98 |
  | Command jump table | 0x80126590 |
  | Random | 0x800FD438 (seed 0x12345678) |

- **Game music driver:** state struct 0x801B4540.
  - `play(fileIndex, fade)` = **0x80097D14**: copies the song into a spare buffer and calls MusHandleStop on the old handle.
  - The per-frame function 0x80097DF8 starts the new song once the old one has stopped.
  - Song master volume is 12603 at boot. The options slider sets `360*n`, with default n = 35.

##### Files
Sound file table: ROM 0xA4710 / RAM 0x80114710, 26 x {u32 cartAddr, u32 len}. All files are raw.

| File | ROM | Length | Content |
|---|---|---|---|
| 0 | 0x58FAE0 | 0x3498 | pointer bank A (SFX), 76 waves |
| 1 | 0x592F78 | 0xAAC | fx bank, 93 effects (same bytecode as songs; not music) |
| 2 | 0x593A28 | 0x86C6E | wave bank A (SFX samples) |
| 3 | 0x61A698 | 0x9970 | **pointer bank B (music)**, 231 waves; the default bank for songs |
| 4 | 0x624008 | 0x118F84 | **wave bank B (music samples)**; 16-byte header "N64 WaveTables ", sample data from +0x10 |
| 5..25 | 0x73CF90..0x7BE9AE | | songs 0..20 (song n = file n + 5) |

**Pointer bank** (offsets are file-relative until initialised):

| Offset | Size | Field |
|---|---|---|
| 0x00 | 16 | `"N64 PtrTablesV2\0"` |
| 0x10 | 4 | flags (bit 31 set once initialised) |
| 0x14 | 12 | wave-bank name (zero) |
| 0x20 | 4 | count |
| 0x24 | 4 | offset of u8 basenote[count] |
| 0x28 | 4 | offset of the detune array: 4 bytes per wave, only the MSB is read, as s8 cents |
| 0x2C | 4 | offset of u32[count] pointers to ALWaveTable records |

- Wave `base` is relative to the wave-bank file start, so sample data starts at +0x10.
- At initialisation 0x800FD2A0 stores `detune = s8(detuneMSB)/100 + s8(basenote - 48)`, in semitones. In bank B every basenote and detune is 0, so **every music wave has detune -48.0**.
- All waves in both banks are ADPCM, order 2, 4 predictors. Only 4 bank-B waves loop (29, 35, 37, 41).
- A per-wave listing is in `mus2/dump.txt`.

##### Song file (version 0x215)
All offsets are file-relative. They are relocated in place on the first MusStartSong, and the flag at +0x28 records that.

| Offset | Field |
|---|---|
| 0x00 | u32 version = 0x215 |
| 0x04 | s32 num_channels (12..24) |
| 0x08 | s32 num_waves |
| 0x0C | u32 offset of u32[num_channels] channel bytecode offsets (0 = unused channel) |
| 0x10 | u32 offset of u32[num_channels] volume-stream offsets (0 = none) |
| 0x14 | u32 offset of u32[num_channels] pitch-bend-stream offsets (0 = none) |
| 0x18 | u32 offset of envelope records, 7 bytes each: {speed, init, attackTime, peak, decayTime, sustain, releaseTime} |
| 0x1C | u32 offset of drum records, 6 bytes each: {u16 wave, u16 envelopeIndex, u8 pan (0..254, used >>1), u8 note} |
| 0x20 | u32 offset of u16[num_waves]: song wave to pointer-bank wave index (0xFFFF = notes on it are rests) |
| 0x24 | u32 offset of the master-track bytecode (tempo; no volume/bend streams) |
| 0x28 | u32 relocated flag (0 in ROM) |
| 0x2C..0x37 | 0 |

**Song start** (0x800FDA60):
- The master channel runs `MasterTrack`.
- Each channel i with a non-zero bytecode offset gets a synth voice, velocity mode on, its streams, and pointer bank B.
- Channel defaults:
  - volume 127, velocity 127, pan centre;
  - bend range 2/64;
  - envelope {speed 1, init 0, attack 1, peak 127, decay 255, sustain 127, release 15}.
- The song starts on the next player tick.

##### Channel bytecode
**Notes (bytes < 0x80).**
- The note byte is 0..127; 96 is a rest.
- In velocity mode a velocity byte follows. A byte >= 0x80 sets velocity = b & 0x7F, turns velocity mode off and makes that the default velocity.
- A length follows unless a fixed length is active (and no `ignore` is pending): 1 byte (< 0x80), or 2 bytes `((b0 & 0x7F) << 8) | b1`.
- Lengths are in **ticks** (1 tick = 256 time units). Length 32767 holds forever.

**Commands (bytes >= 0x80)**, dispatched through table 0x80126590. "v" means a variable-length value, encoded like a note length (1 or 2 bytes).

| Byte | Name | Arguments | Semantics |
|---|---|---|---|
| 80 | stop | - | end of channel (voice ramps to 0 and stops) |
| 81 | wave | v | select song wave number |
| 82 | port | 1 | portamento time in ticks (0 = off) |
| 83 | portoff | - | portamento off |
| 84 | envelope (inline) | 7 | envelope record inline |
| 85 | tempo | 1 | tempo t: time units per player tick = `trunc(trunc(t*24576/120)/60)`, applied to all channels |
| 86 | endit | 2 | release starts u16 ticks after note start (cancels cutoff) |
| 87 | cutoff | 1 | release starts n ticks before note end (cancels endit) |
| 88 | vibup | 3 | delay, speed, depth: `vib = sin((ticks - delay)*2π/speed) * depth/50` semitones |
| 89 | vibdown | 3 | as vibup with negative depth |
| 8A | viboff | - | vibrato off |
| 8B | length | v | fixed note length (notes carry no length bytes) |
| 8C | ignore | - | the next note reads a length anyway |
| 8D | transpose | 1 | s8 semitones |
| 8E | ignore_transpose | - | ignore transpose from now on |
| 8F | distort | 1 | s8/100 semitone offset |
| 90 | envelope | v | select envelope record from the song table |
| 91 / 92 | envoff / envon | - | don't / do restart the envelope on notes |
| 93 / 94 | troff / tron | - | tie: don't / do restart the sample on notes |
| 95 | for | 1 | push loop with count (255 = infinite); saves bytecode position, stream positions and counters, volume and bend |
| 96 | next | - | loop back, restoring saved stream state, until the count reaches 0 |
| 97 | wobble | 3 | s8 semitones, on ticks, off ticks: square LFO on pitch |
| 98 | wobbleoff | - | wobble off |
| 99 / 9A | velon / veloff | - | velocity bytes after notes on / off |
| 9B | velocity | 1 | default velocity; velocity mode off |
| 9C | pan | 1 | pan = b >> 1 (0..127, 64 = centre) |
| 9D | stereo | 2 | ignored |
| 9E | drums | v | drum map base = DrumData + v*6; note n plays drum record n |
| 9F | drumsoff | - | drum map off |
| A0 | print | 1 | ignored |
| A1 | goto | 6 | u16 channel, u16 volume-stream and u16 bend-stream offsets, each from its stream start |
| A2 | reverb | 1 | fx send: fxmix = b for songs |
| A3 / A4 / A5 | randnote / randvolume / randpan | 2 | value = rand(b0) + b1 |
| A6 | volume | 1 | channel volume 0..127 |
| A7 | startfx | v | start a sound effect |
| A8 | bendrange | 1 | bend scale = b/64 |
| A9 | sweep | 1 | automatic pan sweep speed |
| AA | changefx | 1 | ignored in this game |
| AB | marker | 1 + v | marker for MusStartSongFromMarker |
| AC | length0 | - | clear fixed length |

- **Commands the 21 songs use:** wave, port, tempo (once, in the master track), endit, cutoff, vibup, viboff, length, transpose, envelope, for/next, velon, pan, drums/drumsoff, reverb, bendrange and length0. `stop` appears only in the two jingles.
- **Volume stream** (per channel): a byte b < 0x80 sets volume = b for 1 tick. A byte b >= 0x80 sets volume = b & 0x7F for (next byte + 2) ticks, or for `(((b1 & 0x7F) << 8) | b2) + 2` ticks when b1 >= 0x80.
- **Pitch-bend stream:** encoded the same way, with value = (b & 0x7F) - 64 and bend = value * bendScale semitones.

##### Timing, loops, pitch, envelope, mixing
- **Timing.**
  - Each player tick (367 samples at 22047 Hz) adds `inc = trunc(trunc(tempo*24576/120)/60)` time units, 16-bit.
  - Notes are fetched while `nextNoteTime - time < 0`. A note of length L advances nextNoteTime by `L << 8`.
  - Ticks per second is therefore about 0.8 x tempo. Songs use tempos 94..142.
- **Loops.**
  - Every looping song wraps each channel and the master track in `for 255 … next`. All channels have the same loop length, and every loop starts at time 0, so there are no intros.
  - Loop length in samples = loopUnits / inc * 367; per-song values are in 6.1.6.
  - Songs 4 and 17 do not loop (jingles).
- **Pitch** (0x800FC31C, 0x800FCA34, 0x800FD10C).
  - `noteBase = note + waveDetune (-48 for bank B) + s8 transpose`.
  - `p = (portamento-interpolated noteBase) + distort + vibrato + wobble + bend` (semitones, float32).
  - `ratio = musPow2(p/12)`, where musPow2(x) is the series `1 + y + y^2/2 + ... + y^6/720` with y = x·ln2. For x < 0 it is `1/series(-x)`. This is **not** exact 2^x.
  - If ratio > 2.0, ratio is clamped to 2.0 and the note is muted (velocity 0).
  - Playback rate = 22047 x ratio, so note 48 plays a sample at 22047 Hz.
- **Envelope** (libmus's own, not ALEnvelope; 0x800FCB40 start, 0x800FCBB0 per tick).
  - It updates every `speed` ticks (speed 0 is treated as 1), with `t = floor(elapsedTicks * floor(1024/speed) / 1024)`.
  - Attack: `vol = init + trunc((peak - init)/attackT * t)` while t < attackT.
  - Decay: `vol = peak + trunc((sustain - peak)/decayT * t')` while t' < decayT, then `vol = sustain`.
  - Release is checked every tick. It triggers when `time > releaseTime`, where releaseTime is `noteStart + (endit << 8)` or `noteEnd - (cutoff << 8)` (never for length 32767). Rest notes also trigger release.
  - During release, `vol = relVol - trunc(t/releaseT * relVol)`, then 0.
  - Retrigger: a new note on a sounding voice first ramps to 0 for one tick and starts the sample on the next tick.
- **Volume and pan** (0x800FC8E0).
  - `v = (volume * envVol * velocity * 128) >> 13`, clamped to 32767; then `v = v * 12603 >> 15` (song master); with a fade, `v = v * count / total`.
  - libultra's envmixer then **squares** it: `vol = v*v >> 15`.
  - Pan is equal-power: `L = vol * eqpower[pan] >> 15`, `R = vol * eqpower[127 - pan] >> 15`, with a 128-entry table at 0x80126A20 (32767..0).
  - Volume ramps are linear over 367 samples.
  - Fx send: `dry = eqpower[fxmix]`, `wet = eqpower[127 - fxmix]`.
- **Reverb** (libultra alFxPull BIGROOM; delay line 4000 samples).
  - Input = 0.707 x (auxL + auxR).
  - Four sections {input, output, fbcoef, ffcoef, gain, lpcoef}: {0, 2640, 9830, -9830, 0, 0}, {880, 2160, 3276, -3276, 16383, 0}, {2640, 3640, 3276, -3276, 16383, 0}, {0, 3760, 8000, 0, 0, 0x5000}.
  - The summed output is added to both channels. The mix details are a **hypothesis** (ported from libultra, consistent with captures).
- **Resampling:** the RSP 4-tap RESAMPLE_LUT interpolator with a Q1.15 pitch.

##### Song list and selection
There are **no in-game song names**: there's no jukebox or music test, and "MUSIC" / "SOUND FX" are only option sliders. Name tracks "Track N", or by use.

In the table, **Loop end** is in samples at 22047 Hz; loops start at 0.

| Song | File | ROM | Channels | Tempo | Loop end | Loop length (s) | Uses |
|---|---|---|---|---|---|---|---|
| 0 | 5 | 0x73CF90 | 24 | 94 | 1367002 | 62.00 | title and front-end menus; mission ALCATRAZ |
| 1 | 6 | 0x7418E0 | 12 | 102 | 2488108 | 112.85 | cutscene after SF AIRPORT; battle pool |
| 2 | 7 | 0x7427B0 | 18 | 104 | 2445937 | 110.94 | battle pool only |
| 3 | 8 | 0x745050 | 19 | 107 | 2372224 | 107.60 | mission BISTRO; two opening cutscenes; battle pool |
| 4 | 9 | 0x749428 | 22 | 96 | one-shot (~5 s) | | mission-end jingle |
| 5 | 10 | 0x749A30 | 24 | 131 | 2582734 | 117.15 | mission SF BREAKOUT; three cutscenes; battle pool (x2) |
| 6 | 11 | 0x74EFA8 | 24 | 107 | 2471066 | 112.08 | mission DRIVE IN; battle pool |
| 7 | 12 | 0x754E50 | 24 | 120 | 2293440 | 104.03 | mission TEXAS SLAVE FORTRESS; battle pool |
| 8 | 13 | 0x75B448 | 24 | 97 | 2479652 | 112.47 | mission ESCAPE FROM BERLIN; two cutscenes; battle pool |
| 9 | 14 | 0x761B88 | 24 | 89 | 2619493 | 118.81 | mission CHAMPS ELYSEE; two cutscenes; battle pool |
| 10 | 15 | 0x76BF68 | 24 | 134 | 2210442 | 100.26 | mission TRUCK STOP; battle pool |
| 11 | 16 | 0x772250 | 24 | 120 | 2381649 | 108.03 | mission TOWER BRIDGE; battle pool |
| 12 | 17 | 0x779D10 | 24 | 120 | 2293440 | 104.03 | missions DC MALL, SHORE PATROL; battle pool |
| 13 | 18 | 0x782760 | 24 | 94 | 2705818 | 122.73 | mission HOUSES OF PARLIAMENT; one cutscene; battle pool |
| 14 | 19 | 0x78AFF8 | 24 | 126 | 2517040 | 114.17 | mission BRANDENBURG GATE; battle pool |
| 15 | 20 | 0x792E80 | 24 | 98 | 2700417 | 122.48 | missions SF AIRPORT, EIFFEL TOWER, ASSAULT ON SF; battle pool |
| 16 | 21 | 0x79C560 | 24 | 91 | 2269395 | 102.93 | mission WHITE HOUSE; battle pool |
| 17 | 22 | 0x7A6170 | 24 | 107 | one-shot (~6 s) | | mission-end jingle, timer case |
| 18 | 23 | 0x7A6850 | 24 | 120 | 2646276 | 120.03 | mission TOWER OF LONDON; three cutscenes; battle pool (x2) |
| 19 | 24 | 0x7AE648 | 24 | 120 | 2469858 | 112.03 | **unused** (section 10) |
| 20 | 25 | 0x7B70F8 | 24 | 91 | 2443964 | 110.85 | mission BERLIN WAR ZONE; battle pool (x2) |

How the game picks a song:
- **Campaign mission:** `play(missionRecord[+0x6C], 10)` at 0x8009A8B8. Mission records are 0x70 bytes each at 0x80124B80..0x80125360.
- **Cutscenes:** script opcode `0x2F {file}`. Every scene executor's case 47 calls `play`. Scripts are listed at 0x801253D0, and `mus2/scriptmusic.py` walks them all.
- **Title and front end:** `play(5, 0 or 10)` from 0x800BFEA0, 0x800CD970 and 0x800C7514.
- **Battle modes:** a random pick at 0x8009D168: `file = trunc(rand*19) + 6`, remapping 9→10, 22→23 and 24→25.
- **Mission end** (campaign modes only): `play(*0x80235F74 == 1 ? 22 : 9, 0)`. The flag is set when the mission timer exceeds record +0x68.

##### Offline rendering
- **Prototype:** `btx/mus2/render.ts`, with parsers in `libmus.ts`. Run `npx tsx render.ts all` from `mus2/`.
- **What it emulates:** everything above, i.e. the libmus tick loop, HLE ADPCM, the 4-tap resampler, envmixer and BIGROOM reverb.
- **Output:** `mus2/wav/song00.wav`..`song20.wav`, 22047 Hz stereo. It takes about 8 s per 2-minute song in Node 20.
- **Seamless loops:** it renders to `loopEnd` and adds the reverb and release tails rendered past `loopEnd` back onto the start.
- **DecodedMusic:** `sampleRate: 22047`, `loopStart: 0`, `loopEnd` from the table in 6.1.6 (absent for songs 4 and 17).

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

#### Music, GA

- **Captures:** the game's AI output was captured with a copy of an audio-dump mupen64plus plugin, which appends every AI buffer and the DAC rate. Capture WAVs are in `btx/mus2/cap/`:
  - `boot_cap.wav`: attract loop, title and Game Setup menu (first 640 s)
  - `menu_cap.wav`: 353 s of the Game Setup menu
  - `level_sfairport_cap.wav`: 218 s of the SF AIRPORT mission, including game SFX
  - The raw capture and its log are in `boot.raw` / `.log`.
- **DAC rate:** 2207 in the log, i.e. 22047 Hz, which matches the code.
- **Renders:** `btx/mus2/wav/song00.wav`..`song20.wav`.
- **Coordinator check:** WAV headers are 22047 Hz stereo; frame counts equal the loop ends (song00 1367002, song15 2700417, song19 2469858). The table at ROM 0xA4710, the "N64 PtrTablesV2" magic and song version 0x215 were re-read from the ROM.

| Comparison | Menu capture vs song 0 | SF Airport capture vs song 15 |
|---|---|---|
| Loop period, capture vs render | 62.006 s vs 62.004 s | 122.479 s vs 122.485 s |
| Best time scale (±0.25% scan) | 1.0000 | 1.0000 |
| Onset-envelope correlation at best alignment | 0.64 | 0.31 (gunfire SFX in capture) |
| Dominant spectral peaks | identical (78.2 / 155.9 / 102.5 / 60.1 / 183.6 Hz) | identical (193.5 / 63.6 / 114.7 / 390.6 / 439.1 / 786.1 Hz) |
| Log-spectrum correlation at 0 Hz shift | 0.987 | 0.981 |
| RMS level, render vs capture | -21.1 vs -21.6 dBFS | -25.6 vs -24.9 dBFS |

- **Title segment:** the attract loop's title segment matches song 0 from its start (onset correlation 0.65; next best song 0.26).
- **Intro cinematic:** matches no song (best 0.13), consistent with its script having no music opcode.
- **Envmixer squaring:** before the squared volume was added, renders were 9 dB too loud, which confirms that detail.
- **Scripts:** `mus2/compare.ts`, `mus2/levels.ts`, `mus2/findsong.ts`.

### 5.3 Instruments and sample encoding

#### Shared: VADPCM sample decoding

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

## 6. Unused and hidden content

### 6.1 Unreferenced assets

Everything found in both ROMs: levels, level variants, pool data, images, music, cheats and leftovers. The evidence for each item is given with it, and remaining uncertainties are marked **Hypothesis**.

#### GA

- **Level ids 22 and 23.**
  - 0x800E8C88 returns NULL for their names.
  - They are absent from the campaign step list, both map-select tables and the script-type-to-level table 0x80074D30.
  - Their world files, 0x46B170-0x46B4EA, 0x46B4F0-0x46B4FE and 0x46B500-0x46B54A, are referenced only by those switch cases.
  - 0x46B4F0 is an empty 0x24-byte world.
  - **Level 22 content** (rendered: `lvl2/renders/lvl22_top.png`): a **test maze**. A 3x3 grid about 6600 units square, made of 181 kind-1 wall segments (288x210) and posts with a single texture, and no fog or lights.
  - **Level 23 content** (`lvl23_top.png`): a single 288x144 flat model. Its GEO chunk (offset 0x5D40) is malformed, with vertices before the commands, and its TEX chunk (0x94740, 0x1030 bytes) is raw texels with no DL header. Together with PB 0x1088, these are **the only pool chunks referenced solely by unreachable levels**.
  - **Level 25** (and level 24's battle variant): the single file 0x46B550 holds 29 logic placements and no models.
- **Level 26 (SF AIRPORT) battle variant** 0x46ED20-0x46F652: no map-select entry and no script leads to level 26 with flag 0. Its content is an **unused SF AIRPORT battle arena**: 4 player starts, kinds 20 and 31, and 41 pickups (`lvl2/renders/sfairport_battle_top.png`). It uses only pool chunks that reachable files also use.
- **Levels 17-23 in campaign mode**: the switch falls through, so these combinations are never used.
- **ROM 0x100000-0x102068: a leftover BattleTanx (BTX1) level file.**
  - It is a valid LZARI blob that no GA code references.
  - Decoded (0x5CB4 bytes), it is **byte-for-byte identical** to BTX1's decoded level A for internal level id 9, "Chicago - Bonus" (internal name "ChBonus", BTX1 ROM 0x76FE40-0x771EA8). Its header is `[0x24, 0x304, 0x1420, 0x2CBC, 0x367C, 0x3680, 0x3994, 0x5CB4, 0x5CB4]`.
  - GA has neither a BTX1-format loader nor BTX1's pools, so the game cannot use it.
  - Verified by decoding both files and comparing every byte (script run from `btx/`, using `fs2/lzari.py` and `fs1/files/`).
- **Unreferenced pool bytes** (the "gap" rows in `fs2/files/index.csv`):
  - TEX pool: 24 regions, 0x1E0D0 bytes, holding **48 complete, unused texture chunks** (contact sheet `lvl2/sheets/unref_tex.png` with index `unref_tex.txt`). Among them:
    - Route 66 road signs ("Grip's Gateway 1 mile", "66 Ahead") and western wooden storefronts;
    - Paris statues and Eiffel Tower / treeline backdrop cards;
    - a Washington dome skyline card;
    - trees, brick, and purple eye banners.
  - Evidence: checked against all 75 world files (`lvl2/unref.ts` → `unref.txt`).
  - PB pool: 27 regions, 0x1000 bytes, all small, complete state lists.
  - GEO pool: 91 regions, 0x191F8 bytes, holding **599 complete, unused geometry chunks** (2358 triangles; `lvl2/sheets/unref_geo.png`): walls, debris shards, boxes, a cone and hull-like shapes.
- **Cutscene script 0x564C78-0x580EF1** (type 1, plays in level 0): not in the campaign list. It can only be reached through cheat code "DCPTCM" (the code table at 0x80121C3C is handled by 0x800D0070).
- **ROM 0x0C8230-0x100000 and the tail of the segment-1 blob (from ~0xB9000)**: stale build padding with IDO symbol-table strings (struct and function names) and copies of pool and sound data. One example is libmus song headers (version 0x215, 0x18 channels): 0x12 waves at ROM 0xC0000 and 0x14 waves at ROM 0xE0000. For comparison, song 0 (ROM 0x73CF90) has 0x16 waves. Other shipped songs weren't compared, so these may be copies of shipped songs or earlier revisions (**hypothesis**).
- **Song 19 (sound file 24, ROM 0x7AE648, tempo 120, 112.03 s loop): unused.**
  - None of the 19 mission records use it; their +0x6C values are 5, 8, 10..21, 23 and 25.
  - None of the 16 cutscene scripts play it; all were walked with the game's own command parser.
  - The battle randomiser explicitly remaps 24 to 25.
  - No other call site passes 24. `play` 0x80097D14 is only called with the constants 5, 9 or 22, a mission-record field, a script byte, or the randomiser result. The file loader 0x80097BC4 is only called with 0, 1 and 3. The copy routine 0x80097CC8 has no callers.
  - A full render is `mus2/wav/song19.wav`.
- **60 music-bank waves that no song references** (bank B indices): 6, 40, 42, 51, 52, 63, 64, 67, 81, 82, 89, 99, 101-108, 111-126, 128-133, 141, 150, 152, 162, 163, 174, 177, 178, 184, 190, 193, 198, 200-204, 223. Evidence: they are absent from all 21 song wave tables (`mus2/dump.txt`). SFX use is not analysed, but songs only use bank B.
- **Cheat codes** (pointer table ROM 0xB1C3C / RAM 0x80121C3C, 33 entries; effect names at ROM 0xB1B14; dispatcher 0x800D00F8, jump table 0x80074140). Entered on the INPUT CODE screen, whose grid has consonants and digits only. Static analysis; only 80DYS was tested in game.

  | Index | Code | Effect |
  |---|---|---|
  | 0 | TRDDYBRRKS | CUSTOM GANG |
  | 1 | 80DYS | LEVEL SELECT (tested: the campaign map opens all 19 missions) |
  | 2 | HPPYHPPY | INVULNERABILITY (toggles 0x80125AB0) |
  | 3 | RCKTSRDGLR | ALL WEAPONS (toggles 0x80125AB1) |
  | 4 | `?` | SUPER HAPPY CODE (both toggles): **untypeable, a disabled debug cheat** |
  | 5 | `?` | CINEMATICS LOOP: **untypeable** |
  | 6..21 | DCPTCB, DCPTCC, DCPTCD, DCPTCF, DCPTCG, DCPTCH, DCPTCJ, DCPTCK, DCPTCL, DCPTCM, DCPTCP, DCPTCQ, DCPTCR, DCPTCS, DCPTCT, DCPTC0 | CINEMATIC TEST: each plays one cutscene script |
  | 22 | `?` | NO CINEMATICS: **untypeable** |
  | 23 | WRDRB | SECRET LEVEL (target unknown) |
  | 24 | PRSSTNCFTM | SCRAMBLE MODELS |
  | 25 | BRNCSSTS | WHAT THE |
  | 26 | DRMWVR | CASSANDRA GANG |
  | 27 | NNKNHCKS | BRANDON GANG |
  | 28..32 | DR1NKM3, SHR1MP, T0MTHMB, M1N1M3, PYGMY | MINI TANKS 1..5 |

  Any other valid entry is treated as a GAME PASSWORD (campaign password). The three `?` codes (ROM 0xB1B10, 0xB1A88, 0xB1B0C) can't be entered because the grid has no `?`. They are hidden debug cheats reachable only by patching RAM.

### 6.2 Cut or inaccessible levels

### 6.3 Debug features

### 6.4 Prototype or revision-specific content

## 7. nviewer implementation

### 7.1 Module mapping

#### File access

- **Global Assault has no runtime file table.** Its level files are selected by a code switch, so transcribe the recovered ranges.
- **Pool chunks** hold chunk-relative addresses: G_VTX in GEO chunks, G_SETTIMG in TEX chunks.
  - The viewer doesn't need to patch them.
  - Give `runDisplayList` a `resolve` that adds the current chunk's base in the buffer: `addr => base + addr` when `addr < chunkSize`.
  - Or copy each chunk into its own `Uint8Array` and use an identity resolver.

### 7.2 Supported features

### 7.3 Approximations and omissions

## 8. Verification and remaining work

### 8.1 Verification evidence

#### Runtime captures (reference screenshots and RAM dumps)

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

#### GA

- **Image records:** formats 0x00/0x02 look like 16 bpp (decoded size = w\*h\*2) and 0x03 like 8-bit CI, with palettes in the raw aux blobs at 0x4729C0. This is checked by output size only.
- **Map-select field `a`** (values 1..5, e.g. AIRPORT 3, ASSAULT 5, DRIVE IN 4, GO TO EUROPE 1): perhaps the difficulty rating shown on the map. The mapping of tables #2..#7 to BATTLELORD, FRENZY, HOLD-EM, FAMILY MODE, TANK WARS and CONVOY is inferred from table membership; only DEATHMATCH = #1 was walked in game.
- **"CI16" tile format** seen at load time: perhaps CI data converted through the palette at load.
- **Cheat effects:** all come from static analysis of the INPUT CODE switch (dispatcher 0x800D00F8, jump table 0x80074140). Only 80DYS was tested. The target of WRDRB "SECRET LEVEL" is unknown.
- **Level 24 (Shore Patrol), battle flag:** it loads only 0x46B550, the same file as level 25. Verified contents: 29 logic placements and no models (20 kind-6 waypoints in 4 chains, 7 pickups, 2 kind-12 entries without a model). **Hypothesis:** a stub.
- **Audio ROM pager:** the base address of the 0xFFxxxxxx EPi handle (*0x803ADA50) is unresolved.
- **Text/data boundary:** only estimated (about 0x80118000).
- **Level format: LOD.** Parts are LOD levels. The code that picks the part and culls static instances is not identified (0x800A509C.. turned out to be fog/light colour interpolation).
- **Level format: multi-model kinds.** The first model field is the intact/initial state.
- **Level format: kind 39.** Modes 1, 3 and 11 are base-style battle modes (e.g. BATTLELORD / HOLD-EM), and kind 39 flags are team slots.
- **Level format: unknown payloads.** Kinds 8, 16, 20, 23, 27, 41 and 45; kind 37 bytes +16..21; kind 13 bytes +2/+3 (possibly references to kind-6 path chains); the meaning of the kind 17 u16 value (850 / 625 / 1150).
- **Level format: CHAMPS ELYSEE start.** The in-game start view was not reproduced from any kind 17 start; the player-start convention may differ in campaign variants, which have no kind 17.
- **Music: jingles.** File 9 (song 4) is probably the normal mission-end sting, and file 22 (song 17) the "time expired" sting. Only the code condition was verified.
- **Music: envmixer ramps.** libultra computes linear per-8-sample ramp rates. The emulator's HLE treats them as exponential, so the captures may differ in the ~17 ms ramps. The renderer uses linear ramps.
- **Music: reverb.** The BIGROOM mixing is ported from libultra's alFxPull. It matches the preset tables and the capture spectra but hasn't been checked bit for bit.
- **Music: voice restarts.** The renderer assumes a stopped and restarted voice keeps its envmixer volume/pan state.
- **Music: PAL.** At 50 Hz the tick length and tempo increments would differ. Untested, and irrelevant for these USA ROMs.
- **Music: SFX.** Bank A and fx-bank usage (SFX) was not analysed.

#### Shared

- **Envmixer ramp shape.** The GA renderer uses linear per-8-sample ramps (libultra's own computation). The BTX1 renderer uses exponential ramps (as mupen64plus HLE interprets them). Both match captures within measurement, because the ramps last only ~16 ms. Which one the real RSP microcode uses was not checked against LLE.

### 8.2 Known unknowns

#### Open questions and unknowns

Every item in this section is a **hypothesis** or an open question, not a verified fact.

### 8.3 References
