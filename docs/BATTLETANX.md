# BattleTanx and BattleTanx: Global Assault (N64): ROM format specification

Status: complete research specification (2026-09-11). Statements are verified unless labelled **Hypothesis**; section 9 collects the open questions.

Conventions:
- **BTX1** is *BattleTanx* (USA) and **GA** is *BattleTanx: Global Assault* (USA).
- All multi-byte values are big-endian.
- "RAM" means KSEG0 virtual addresses (0x80xxxxxx). "Cart" addresses (0xB0xxxxxx) are ROM offset + 0xB0000000.
- Statements are verified unless labelled **Hypothesis**.

## 1. ROM identification

Both ROMs are 8 MiB (0x800000 bytes), stored z64 big-endian (first word 0x80371240). `.v64`/`.n64` byte orders must be normalised as the existing `normalizeByteOrder` does.

| Field (offset) | BTX1 | GA |
|---|---|---|
| Name (0x20) | `BATTLETANX` | `BATTLETANXGA` |
| Game code (0x3B, 4 chars) | `NBXE` | `NBQE` |
| Version (0x3F) | 0x00 | 0x00 |
| CRC1 / CRC2 (0x10 / 0x14) | 0x6AA4DDE7 / 0xE3E2F4E7 | 0x75A4E247 / 0x6008963D |
| MD5 of z64 | 3406a505c22bac2f40d9bfc6ff08cf86 | 654557c316f901a2ca6f7f4b43343147 |
| Entry point (0x08) | 0x80071000 | 0x80071000 |
| Release field (0x0C) | 0x00001444 | 0x00001444 |
| RSP graphics microcode string | `RSP Gfx ucode F3DEX 1.21 Yoshitaka Yasumoto Nintendo.` | `RSP Gfx ucode F3DEX fifo 2.07 Yoshitaka Yasumoto 1998 Nintendo.` |

**Telling them apart:** switch on the 4-character game code at 0x3B, as `src/rom/index.ts` does for NRUE/NSFE: `NBXE` is BattleTanx, `NBQE` is Global Assault.

## 2. Boot and code

### 2.1 Shared
- IPL3 copies ROM 0x1000.. to the entry point 0x80071000, so for the main image **RAM = ROM + 0x80070000**.
- The entry stub sets `sp`, zeroes BSS with a word loop, then `jal main`:

| | BTX1 | GA |
|---|---|---|
| Initial sp | 0x8014E0C8 | 0x8021E0B8 |
| BSS cleared | 0x80147040..0x803D8880 | 0x80127E30..0x803B17B0 |
| main | 0x800779CC | 0x8009ED9C |

### 2.2 GA
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

### 2.3 BTX1

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

## 3. Filesystem

### 3.1 GA
**All asset reads** go through `0x8009ED00 rom_read(u32 cartAddr, void *dst, u32 len)`, which is osPiStartDma(OS_READ) plus osRecvMesg.

**There is no numbered file table.** Assets are found by:
1. cart addresses hard-coded in code as lui/addiu pairs; or
2. small tables of `(cartStart, cartEndInclusive)` pairs. A blob's length is `end - start + 1`, read as `(end - start + 1) & ~1`. A few end values overlap the next blob's start by one byte, which is harmless.

#### 3.1.1 Tables
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

#### 3.1.2 Codec: LZARI (shared: identical in BTX1 and GA)
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
- **Reference implementation:** `/home/n64/.ai-tmp/r49/btx/fs2/lzari.py`. It decodes all 271 LZARI blobs.

#### 3.1.3 ROM map
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

#### 3.1.4 Extracting every file
- **Command:** `python3 /home/n64/.ai-tmp/r49/btx/fs2/extract.py [ROM] [OUTDIR]`. It is self-contained (LZARI plus a tiny MIPS interpreter that evaluates the level switch in code) and takes about 21 s.
- **Output:**
  - `NNNN_<romoff>_<kind>.bin` (decompressed);
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

### 3.2 BTX1

**All reads** go through `romread` 0x80077930 (see 2.3).

**There is no numbered file table.** Callers load start/end pairs of cart addresses from lui/addiu constants and pass `end - start` as the length. There are 48 `romread` call sites and 32 LZARI call sites.

#### 3.2.1 Tables
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

#### 3.2.2 Codec
LZARI, identical to GA (section 3.1.2), with the decompressor at 0x800F4F60. The LZARI files are:
- 22 level-A files
- 18 level-B files
- 30 front-end / image banks

Together they are 0x20EED2 bytes stored and 0x3DF322 bytes decoded.

#### 3.2.3 ROM map
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

#### 3.2.4 Stored-data conventions
- **Level A** (decoded) starts with 9 u32 **file-relative** section offsets `h[0..8] = [0x24, s1, s2, s3, s4, s5, s6, end, end]`. The loader adds the load address to each.
  - Section k spans `[h[k], h[k+1])`; section 0 is the part after the 0x24-byte header.
  - This reading gives whole record counts in every file checked: internal id 0 (Cinematic) has s5 = 0x410/4 and s6 = 0x44E0/16; id 9 (Chicago - Bonus) has s5 = 0x314/4 and s6 = 0x2320/16; id 17 (San Francisco - Bonus) has s5 = 0x3FC/4 and s6 = 0x3FB0/16.
  - Section 6, the pool index, has 16-byte entries: +0 u32 offset into the texture pool 0x5A1110, +4 u16 flags, +6 u16 size, +8 u32 offset into the geometry pool 0x3EA970, +0xC u32 size. Section 5 has 4-byte entries: {u8 count, u8 ?, u16 first section-6 index}. See section 5 for the rest.
- **Level B:** the u32 fields at +4, +0xC, +0x10, +0x14, +0x18 and +0x1C are file-relative and get relocated at load.
- **Pool chunks** use **chunk-relative** addresses. At load, 0x80085290 adds the chunk's load base to every G_VTX operand and 0x800852E0 to every G_SETTIMG operand.
- Chunks are deduplicated by offset into two lists: ctx+0x936C holds up to 256 texture chunks (read at 0x8008AA38) and ctx+0xA374 holds up to 1800 geometry chunks (read at 0x8008AB4C).
- Stored data contains no segmented or absolute RAM pointers.

#### 3.2.5 Extracting every file
- **Command:** `python3 /home/n64/.ai-tmp/r49/btx/fs1/extract.py [ROM] [OUTDIR]`, about 30 s. It writes 5473 files as `NNNN_<romoff>_<name>.bin`, decoded where applicable.
- **Index:** `index.csv` has the columns id, rom_offset, stored_size, decompressed_size, codec, first4, type_guess, name, group, filename, note and code_refs.
- **Levels:** `levels.csv` holds the per-level mapping. Its ranges are indexed correctly by internal id, but **its level names are wrong** (taken from the menu-order table). Use the names in 4.2.2.
- **How the pools are split:** chunk boundaries are the union of all levels' section-6 entries.

## 4. Levels

### 4.1 GA

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

#### 4.1.1 In-game menus and level order (GA)
Verified in the emulator unless marked otherwise. Screenshots are in `/home/n64/.ai-tmp/r49/btx/ref2/shots/`; input sequences are in `notes/ref2.md`.

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

### 4.2 BTX1

#### 4.2.1 Two level numberings (verified)
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

#### 4.2.2 Level table (by internal id)
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

#### 4.2.3 Attract / scenario files
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

#### 4.2.4 In-game menus and level order (BTX1)
Verified in the emulator unless marked otherwise. Screenshots are in `/home/n64/.ai-tmp/r49/btx/ref1/shots/`; input sequences are in `notes/ref1.md`.

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

## 5. Level format

### 5.0 Runtime render state (both games; verified from RAM dumps of the running games)
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

### 5.1 Level data format

#### 5.1.0 Shared engine structure (both games)
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

#### 5.1.1 GA world files (verified)
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

#### 5.1.2 BTX1 level files (verified)
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

#### 5.1.3 BTX1 collision (verified)
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

**Verification against RAM dumps** (walking the used list of the live grid and matching x, z, yaw, footprint, flags and owner; script `/home/n64/.ai-tmp/btxcol/r1/btxcol.ts <id> [campaign|battle] --ram dump.bin`):

| Dump | Level | Decoded entries matched | Left over |
|---|---|---|---|
| `ref1/arena1.bin` | 24, Battlelord | 268 of 277 | 9 flag-0x02 objects the gate removed (6 kind 1, kinds 11, 12, 14) |
| `ref1/queens1.bin` | 1, campaign | 458 of 493 | 24 flag-0x02 objects (absent in campaign), 5 kind 6 and 6 kind 9 (**hypothesis:** destroyed during play) |
| `lvl1/dumps/ts1.bin` | 3, campaign | 522 of 523 | 1 kind 6; 3 more matched with rubble flags |
| `ref1/bonus1.bin` | 9 | 40 of 40 | none |

- The static kinds 1, 19, 26 and 27 match exactly in every dump. The flag-0x02 gate is confirmed in the Arena: entries with object flags 0x0A, 0x0B, 0x0E and 0x0F are present, those with 0x02, 0x03, 0x06 and 0x07 absent.
- **Unverified (static evidence only):** kind 30 (in no dump), kinds 20 and 31, and any use of the hdr0 inner rectangle (no reader found; **hypothesis:** the drivable edge).

**Viewer overlay** (`src/rom/battletanx.ts`, hidden layer "collision"): one world-space mesh per class (static, destructible, low destructible, tank-only, passable, and flag-0x02 "conditional"), each rectangle drawn as a prism from y = 0 to the top of the object's model (the game has no heights), 1 unit outside the footprint and above the model so it does not z-fight. Batch.triSource holds the hdr2 record offset in decoded file A. Offline renders with the collision layer over the level: `/home/n64/.ai-tmp/btxcol/img1/` (`*_cmp.png`: level, level + collision, difference).

#### 5.1.4 GA collision (verified)
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

**Verification against RAM dumps** (`/home/n64/.ai-tmp/btxcol/r2/btxcollision.ts <id> <variant> --dump ram.bin`, comparing all 13 fields of every live entry; the dump's kind-39 inputs match the viewer's default rule):

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
- Offline renders: `/home/n64/.ai-tmp/btxcol/img2/` (`*_cmp.png`).


## 6. Music

### 6.0 Shared: VADPCM sample decoding
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

### 6.1 GA: libmus ("N64 PtrTablesV2" / "N64 WaveTables")

#### 6.1.1 System
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

#### 6.1.2 Files
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

#### 6.1.3 Song file (version 0x215)
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

#### 6.1.4 Channel bytecode
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

#### 6.1.5 Timing, loops, pitch, envelope, mixing
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

#### 6.1.6 Song list and selection
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
- **Cutscenes:** script opcode `0x2F <file>`. Every scene executor's case 47 calls `play`. Scripts are listed at 0x801253D0, and `mus2/scriptmusic.py` walks them all.
- **Title and front end:** `play(5, 0 or 10)` from 0x800BFEA0, 0x800CD970 and 0x800C7514.
- **Battle modes:** a random pick at 0x8009D168: `file = trunc(rand*19) + 6`, remapping 9→10, 22→23 and 24→25.
- **Mission end** (campaign modes only): `play(*0x80235F74 == 1 ? 22 : 9, 0)`. The flag is set when the mission timer exceeds record +0x68.

#### 6.1.7 Offline rendering
- **Prototype:** `/home/n64/.ai-tmp/r49/btx/mus2/render.ts`, with parsers in `libmus.ts`. Run `npx tsx render.ts all` from `mus2/`.
- **What it emulates:** everything above, i.e. the libmus tick loop, HLE ADPCM, the 4-tap resampler, envmixer and BIGROOM reverb.
- **Output:** `mus2/wav/song00.wav`..`song20.wav`, 22047 Hz stereo. It takes about 8 s per 2-minute song in Node 20.
- **Seamless loops:** it renders to `loopEnd` and adds the reverb and release tails rendered past `loopEnd` back onto the start.
- **DecodedMusic:** `sampleRate: 22047`, `loopStart: 0`, `loopEnd` from the table in 6.1.6 (absent for songs 4 and 17).

### 6.2 BTX1: libultra alSeqPlayer + Standard MIDI files

Everything here is stock libultra 2.0 behaviour. Section 6.0 describes VADPCM.

#### 6.2.1 System
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

#### 6.2.2 Data
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

#### 6.2.3 MIDI files
- All 19 songs are format 0 with one track and division 480.
- Each has a single tempo meta event at tick 0, and End of Track 1 tick after the last event. There is no sysex, marker or text.
- Tempos (bpm), songs 0..18: 120, 210, 180, 133, 120, 120, 120, 120, 230, 105, 115, 120, 80, 123, 123, 123, 140, 130, 112.
- **Controllers:** CC0/CC32 bank select (ignored), CC7, CC10, and CC1 once in song 1 (ignored). Pitch bend appears in songs 1, 3 and 7. There is no CC64, CC91 or CC102/103.
- **Full dump:** `mus1/midi_summary.txt`.

#### 6.2.4 Playback semantics (stock alSeqPlayer)
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

#### 6.2.5 Song list
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

#### 6.2.6 Offline rendering
- **Prototype:** `/home/n64/.ai-tmp/r49/btx/mus1/render.ts`. Run `npx tsx render.ts all|<ids> [--vol N] [--noloop]` from `mus1/`; all 19 songs take about 15 s.
  - It exports `renderSong(rom, song)`, returning {sampleRate, left, right, loopStart, loopEnd}, and `TRACKS`.
  - The parsers are `bank.ts` (`parseBankFile`) and `midi.ts` (`parseMidi`).
- **What it models:** the alSeqPlayer event queue above, RSP VADPCM with loop state, the 4-tap resampler, squared volume, equal-power pan and exponential envmixer ramps. It has no reverb.
- **Output:** `mus1/wav/song00.wav`..`song18.wav`, 22047 Hz stereo, with a `smpl` loop chunk. Each file is pass 0 plus the opening of pass 1, until pass 0's release tails end; `loopStart = length - passLength` and `loopEnd = length`.
- **DecodedMusic:** `{sampleRate: 22047, loopStart, loopEnd}` from the table.

## 7. Mapping to the viewer

### 7.1 Game detection and the model (both games)
- **`src/rom/index.ts`:** add `case 'NBXE'` and `case 'NBQE'` next to NRUE/NSFE. `normalizeByteOrder` already handles v64/n64.
- **`src/rom/types.ts`:**
  - Extend `Game.id` with `'battletanx' | 'battletanxga'`.
  - Extend `LevelKind` too. Suggested additions: `'campaign'` for BTX1 campaign levels and GA missions, `'bonus'` for BTX1 bonus levels, and `'test'` for BTX1 Test/Spare/MP ids with data.
  - `'battle'` already exists and fits GA battle arenas and BTX1 multiplayer arenas.
  - The sidebar may need labels for the new kinds.

### 7.2 Codec (shared)
- **New module `src/rom/lzari.ts`:** one function `lzariDecode(src: Uint8Array, offset: number): Uint8Array`, used by both games.
  - Port it directly from `/home/n64/.ai-tmp/r49/btx/fs2/lzari.py`, about 120 lines of TypeScript; the algorithm is specified in section 3.1.2.
  - Use typed arrays: `Uint16Array` for the symbol tables and `Int32Array` for `position_cum`.
  - Keep low/high/value as plain numbers: they stay below 2^18, and `range * cum` stays below 2^33, which is exact in doubles.
  - Allocate `size + 60` bytes and truncate.
- **Difficulty:** low.
- **Performance (measured):** the TypeScript ports `lvl1/lzari.ts` and `lvl2/lzari.ts` decode byte-identically to the extractors.
  - BTX1 level-A files (about 0x5000-0xB000 bytes decoded) take 70-80 ms each in Node 20.
  - A whole GA level (common + two world files) loads in under 1 s, including display-list interpretation.
  - Decode in the worker; this cost is acceptable.

### 7.3 File access
- **Neither game needs a runtime file table.** Transcribe the ranges in sections 3 and 4 as constants, as `rush1.ts` does for its tables. Alternatively, read the BTX1 tables from the uncompressed main image at `ROM = RAM - 0x80070000`.
  - BTX1 level records at 0x80125A68 are **filled at runtime** by 0x800865E0, so they are not present in ROM. Transcribe the table in 4.2.
  - GA's level files come from a code switch, not data. Transcribe the table in 4.1.
- **Pool chunks** hold chunk-relative addresses: G_VTX in GEO chunks, G_SETTIMG in TEX chunks.
  - The viewer doesn't need to patch them.
  - Give `runDisplayList` a `resolve` that adds the current chunk's base in the buffer: `addr => base + addr` when `addr < chunkSize`.
  - Or copy each chunk into its own `Uint8Array` and use an identity resolver.

### 7.4 Levels, textures, placement, sky, fog
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

### 7.5 Music
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

## 8. Verification evidence

### 8.1 Filesystem and codec
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

### 8.2 Music, GA
- **Captures:** the game's AI output was captured with a copy of an audio-dump mupen64plus plugin, which appends every AI buffer and the DAC rate. Capture WAVs are in `/home/n64/.ai-tmp/r49/btx/mus2/cap/`:
  - `boot_cap.wav`: attract loop, title and Game Setup menu (first 640 s)
  - `menu_cap.wav`: 353 s of the Game Setup menu
  - `level_sfairport_cap.wav`: 218 s of the SF AIRPORT mission, including game SFX
  - The raw capture and its log are in `boot.raw` / `.log`.
- **DAC rate:** 2207 in the log, i.e. 22047 Hz, which matches the code.
- **Renders:** `/home/n64/.ai-tmp/r49/btx/mus2/wav/song00.wav`..`song20.wav`.
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

### 8.3 Music, BTX1
- **Capture method:** the same audio-dump plugin as for GA (a copy in `mus1/tools/`). The log shows a DAC rate of 2207 (22047 Hz).
- **Breakpoint log:** breakpoints on 0x80079C20 (play) and 0x8007D2A0 (level music) were logged to `mus1/cap/songlog.txt`.
  - Title: `play(6)` from 0x800C589C at capture 12.05 s.
  - Level 1: `0x8007D2A0(a0=1)` from 0x8007F5FC, then `play(7)`.
- **Captures** (in `/home/n64/.ai-tmp/r49/btx/mus1/cap/`):
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

### 8.4 Runtime captures (reference screenshots and RAM dumps)
**BTX1**, in `/home/n64/.ai-tmp/r49/btx/ref1/`:
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

**GA**, in `/home/n64/.ai-tmp/r49/btx/ref2/`:
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

### 8.5 Level geometry decoded from level data

**GA** (prototype `lvl2/run.ts`, renders in `/home/n64/.ai-tmp/r49/btx/lvl2/renders/`)

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

**BTX1** (prototype `lvl1/compare.ts`, renders in `/home/n64/.ai-tmp/r49/btx/lvl1/renders/`)

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

## 9. Open questions and unknowns

Every item in this section is a **hypothesis** or an open question, not a verified fact.

### 9.1 GA
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

### 9.2 BTX1
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

### 9.3 Shared
- **Envmixer ramp shape.** The GA renderer uses linear per-8-sample ramps (libultra's own computation). The BTX1 renderer uses exponential ramps (as mupen64plus HLE interprets them). Both match captures within measurement, because the ramps last only ~16 ms. Which one the real RSP microcode uses was not checked against LLE.


## 10. Unused or hidden content

Everything found in both ROMs: levels, level variants, pool data, images, music, cheats and leftovers. The evidence for each item is given with it, and remaining uncertainties are marked **Hypothesis**.

### 10.1 GA
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
  - Verified by decoding both files and comparing every byte (script run from `/home/n64/.ai-tmp/r49/btx/`, using `fs2/lzari.py` and `fs1/files/`).
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

### 10.2 BTX1
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
