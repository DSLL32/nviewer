# Gex 64: Enter the Gecko and Gex 3: Deep Cover Gecko (N64) — ROM formats for the level viewer

> Research document (read-only analysis; nothing in the viewer was changed). Everything stated without
> a **HYPOTHESIS** label was checked by disassembly and/or against the running game (headless
> mupen64plus RAM dumps, breakpoints and screenshots). Section 9 collects everything open.
>
> Status and confidence:
>
> | area | Gex 64 | Gex 3 |
> |---|---|---|
> | ROM identification, boot, code | high | high |
> | filesystem, DEFLATE, extraction | high (byte-exact vs RAM) | high (byte-exact vs RAM) |
> | level list and in-game names | high (progression order not traced) | high (hub TV assignment verified) |
> | world geometry, textures, coordinates, culling | high (renders match screenshots) | high (renders match screenshots) |
> | fog, clear colour, sky | high (one sky mismatch, one sky not shown) | high |
> | instances | high (rotation order verified) | medium (rotation order unproven) |
> | object models | medium (rest pose only; no animation) | medium (rigid only; skinning not decoded) |
> | animated textures | medium (flipbooks); flag-4 records undecoded | medium (flipbooks); procedural kinds undecoded |
> | music engine, formats, song list | high (player matches RAM exactly) | high (player matches RAM exactly) |
> | rendered PCM accuracy | medium (not heard; no reverb) | medium (not heard) |

Contents
1. ROM identification
2. Boot and code
3. Filesystem and compression
4. Level lists
5. Level format
6. Music
7. Mapping to the viewer
8. Verification evidence
9. Open questions and unknowns
10. Unused or hidden content

Conventions: all offsets are hexadecimal; "ROM" offsets are into the big-endian `.z64` image; RAM
addresses are KSEG0 virtual addresses (`0x80…`). Multi-byte values are big-endian.

---------------------------------------------------------------------------------------------------
## 1. ROM identification (both games, verified)

| field (header offset) | Gex 64: Enter the Gecko (USA) | Gex 3: Deep Cover Gecko (USA) |
|---|---|---|
| file | `Gex 64 - Enter the Gecko (U) [!].z64` | `Gex 3 - Deep Cover Gecko (U) [!].z64` |
| first word (0x00) | `80371240` (z64, big-endian) | `80371240` |
| image name (0x20, 20 bytes) | `GEX: ENTER THE GECKO` | `Gex 3 Deep Cover Gec` |
| game code (0x3B, 4 bytes) | `NX2E` | `NX3E` |
| version (0x3F) | 0 | 0 |
| CRC1 / CRC2 (0x10 / 0x14) | `89FED774` / `CAAFE21B` | `3EDC7E12` / `E26C1CC9` |
| entry point (0x08) | `0x80000400` | `0x80000400` |
| boot code (IPL3) | CIC-6102 (crc32 of 0x40..0x1000 = `90BB6CB5`) | same |
| size | 16 MiB (0x1000000) | 32 MiB (0x2000000) |
| MD5 | `47f9d900c97ece154bb40a9c6dccd3fd` | `6770ddec84eb21a5e0d0f55dfd52a01a` |
| SHA-1 | `16042cd0dfa5439ca436f1bf05ebfb7e9f730cda` | `467bc88942e02d542e1a4705dcab98ab7281819f` |
| RSP graphics microcode (string) | `RSP Gfx ucode F3DEX 1.23 Yoshitaka Yasumoto Nintendo.` | `RSP Gfx ucode F3DEX fifo 2.06 Yoshitaka Yasumoto 1998 Nintendo.` |
| developer strings | `REALTIME ASSOCIATES INC.`, `[1998 CRYSTAL DYNAMICS.` | `crave entertainment, inc.`, `[1999 crystal dynamics` |

**Telling them apart:** use the game code at 0x3B (`NX2E` / `NX3E`), exactly like `openRom()` in
`src/rom/index.ts` does for the Rush games (after byte-order normalisation). `.v64`/`.n64` dumps are
handled by the existing `normalizeByteOrder()`.

---------------------------------------------------------------------------------------------------
## 2. Boot and code

**Shared design.** Both games use the same engine layout (the Gex 3 port reuses the Gex 64 loader
design): an uncompressed main image, an uncompressed *inflate overlay* loaded to `0x801DA800` before
every load, one uncompressed MIPS *code overlay per level* copied to a fixed link address (no
relocation), level data DEFLATE-inflated to a fixed address `0x8024B000`, and named relocatable
object files. No part of the code is compressed; nothing needs to be decompressed to find the tables.

| | Gex 64 | Gex 3 |
|---|---|---|
| entry stub (ROM 0x1000 = 0x80000400) | clears BSS `0x8007F340` len `0xDA3E0`, sp `0x800D1810`, jumps `0x8003B590` | clears BSS `0x8008B3D0` len `0x88540`, sp `0x800A5960`, jumps `0x80031970` |
| main image | ROM `0x1000..0x7FF40` → `0x80000400..0x8007F340` (vaddr = ROM + `0x7FFFF400`) | ROM `0x1000..0x8BFD0` → `0x80000400..0x8008B3D0` (same formula) |
| inflate overlay (zlib `inflate_blocks`) | ROM `0xED0F0..0xEF120` → `0x801DA800` | ROM `0x8BFD0..0x8DEB0` → `0x801DA800` |
| level code overlays | 18 unique (shared per theme), ROM `0x7FF40..0xED0F0`, linked at `0x80159720` | 30 (one per level), ROM `0x8DEB0..0x255D10`, linked at `0x80113910` |
| game ROM read | `0x8003BA7C RomRead(rom, dest, len)`; `0x8003310C` chunked (audio) | `0x80031E70(rom, dest, len)` |
| PI DMA | `0x8005C0B0` osPiStartDma | `0x800716A0` osPiRawStartDma, `0x80076D00` osEPiRawStartDma |
| RAM | 8 MiB used (heap to `0x80400000`): Expansion Pak | 8 MiB used: Expansion Pak |
| graphics microcode | **F3DEX 1.23** (verified: world DLs use F3DEX 1.x opcodes `04 VTX`, `BF TRI1`, `B1 TRI2`, `06 DL`, `B8 ENDDL`, `BC MOVEWORD`) | **F3DEX2 2.06 fifo** (verified: `01 VTX`, `05 TRI1`, `06 TRI2`, `DA MTX`, `DB MOVEWORD`, `DF ENDDL`) |

### 2.1 Level load sequence

Gex 64 (loader thread `0x8003BFB8`, verified):
1. heap pointer `[0x800EB7F4] = 0x8024B000`; load inflate overlay (`0x8003B54C`);
2. `lvl = u8 [0x800C5761]`; `LoadLevelData` (`0x8003B300`): inflate ROM `[rec+0, rec+4)` to `0x8024B000`;
3. `FixupLevel` (`0x8003B198`): load every object named in the level's object list (§3.4) and patch
   the instance table;
4. `LoadOverlay` (`0x8003B484`): copy ROM `[rec+8, rec+0xC)` to `0x80159720`, zero-fill to `rec+0x10`;
5. load the *common blob* (Gex player model) with `malloc`.

Gex 3 (verified): `0x8003152C(idx)` inflates the level data to heap `[0x800FDCD0]` (= `0x8024B000`),
`0x800317B4(idx)` copies the overlay to `0x80113910` and zero-fills to `rec+0x2C`, `0x800313DC` loads
the objects listed at level header `+0x44`, `0x800316F4` loads the player object `gex_____`,
`0x800318BC` loads the per-level 0x820 block, and the audio loaders read the audio fields of the
level record (§6).

---------------------------------------------------------------------------------------------------
## 3. Filesystem and compression

### 3.1 Compression: raw DEFLATE (both games, verified)

Every compressed file in both ROMs is a **raw RFC 1951 DEFLATE stream**: no zlib/gzip header, no
stored size, no checksum. The decompressor is zlib's `inflate_blocks` in the inflate overlay. The
decompressed size is not stored anywhere; the game inflates into a heap with a capacity limit and
uses the returned size, so a decoder must simply run to the final block.

Bit level (standard DEFLATE): bits are read LSB-first; each block starts with `BFINAL`(1 bit) and
`BTYPE`(2 bits). `BTYPE` 0 = stored (skip to byte boundary, `u16 LEN`, `u16 ~LEN`, `LEN` bytes,
little-endian); 1 = fixed Huffman; 2 = dynamic Huffman (`HLIT`(5)+257, `HDIST`(5)+1, `HCLEN`(4)+4,
3-bit code-length code lengths in the order 16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15, then
run-length coded literal/length and distance code lengths using symbols 16/17/18). Huffman codes are
canonical and read MSB-first code-bit order. Literal 0..255, 256 = end of block, 257..285 = lengths
3..258 with extra bits, distance codes 0..29 = distances 1..32768 with extra bits. The stream ends
after the block with `BFINAL` = 1. **ROM ranges in the tables are padded to a 16-byte boundary**:
0..15 bytes after the end of the stream are junk and must be ignored.

- Offline: `zlib.decompressobj(-15).decompress(rom[start:end])` in Python.
- Viewer: `src/rom/inflate.ts` `inflateRaw(src, offset, outSize)` (written for Rush 2049) can be
  reused unchanged. It grows its output buffer on demand and returns `out.subarray(0, bytesWritten)`,
  so the unknown size is not a problem: pass `outSize = 0`, or a hint to avoid regrowth (largest Gex 64
  level `0x137250` bytes, largest Gex 3 level `0x146A64`, objects under `0x20000`). It stops at the
  final block and ignores the ROM padding after it. **Verified:** `coord/inflate_check.ts` (run with
  the repo's `tsx`) decodes Gex 64 `map5` (ROM `0x8C1700`, `0x1072C4` bytes) and Gex 3 `gexcave6`
  (ROM `0x10DC040`, `0x115C08` bytes) with `outSize = 0`, identical to zlib, in about 80 ms each.

Verification: all 767 Gex 64 streams and all ~1,080 Gex 3 streams decode with `eof` reached. Level
loads were compared byte-for-byte against RDRAM right after the in-game inflate returned: Gex 3
opening1 (15,288 bytes) and fly77 (729,776 bytes) identical; Gex 64 map5 1,064,000/1,064,000 bytes
identical outside the two tables the loader patches (see §8).

### 3.2 Relocatable file format (objects and the player model; both games, verified)

```
u32 n
u32 relocOffset[n]   ; offsets relative to DATA start; each marks a u32 pointer
u8  DATA[]           ; every u32 at DATA+relocOffset[i] holds a DATA-relative offset
```
Loader (Gex 64 `0x8003B270`, Gex 3 `0x800314A0`): for each `i`, `*(DATA+off) += loadAddress`, then
`memmove(DATA → loadAddress)`. A viewer can keep pointers file-relative (base 0) instead: skip the
header, and treat each relocated word as an offset into `DATA`. Verified against RAM: Gex 64's 10
persistent objects match 171,645/171,664 bytes (only `DATA+4..5` is a runtime field set to 0xFFFF);
Gex 3: 20 of 25 relocated objects byte-exact, the rest differ in a few runtime bytes.

### 3.3 Object tables (both games, same record layout, verified)

16-byte records `{char name[8]; u32 romStart; u32 romEnd}`, sorted by name; names are 8 characters
padded with `_` and **not** NUL-terminated (e.g. `gexeyes_`, `10tons__`). Lookup compares the two name
words and stops at a record whose first byte is 0. Each file is DEFLATE of a §3.2 relocatable file.

| | Gex 64 | Gex 3 |
|---|---|---|
| table | ROM `0x745F0` (vaddr `0x800739F0`), 735 records, ends at ROM `0x773E0` | ROM `0x818C0` (vaddr `0x80080CC0`), 963 records, ends at `0x800848F0` |
| files | ROM `0xC495B0..0xF821C0` | ROM `0x159C4C0..0x1A92090` |
| lookup/loader | `0x8003AF10` | `0x80031128` |
| player model | "common blob", ROM `0x49D870..0x4B5750` (not in the table; contains `gex_____` and Gex's animations) | `gex_____`, ROM `0x158E1B0..0x159C4C0` (not in the table; hard-coded in `0x800316F4`) |
| always-loaded objects | `shadow__ shadow2_ hud_____ gexeyes_ fonts___ cammode_ introfx_ etvbtn__ remrfx__ remsfx__ lvltv___` (list at `0x800700C0`, persistent heap from `0x801B0000`) | fonts `yellfont`, `dbgfont_` (fonts heap `0x801D8800`), `hud_____`, shadows, etc. |

Full per-object ROM ranges, sizes and reloc counts: `g64fs/files/index.json`, `g64fs/objtable.txt`,
`g3fs/files/index.tsv` and the file tables in `notes/g64_fs.md` §8 and `notes/g3_fs.md` §12.

### 3.4 Level tables

**Gex 64** — ROM `0x708E0` (vaddr `0x8006FCE0`), 31 records of 32 bytes (verified):
```
+0x00 u32 dataRomStart     ; raw DEFLATE, inflated to 0x8024B000
+0x04 u32 dataRomEnd       ; padded end (see 3.1)
+0x08 u32 overlayRomStart  ; uncompressed MIPS, copied to 0x80159720
+0x0C u32 overlayRomEnd
+0x10 u32 overlayRamEnd    ; zero-fill up to here (BSS); stored in [0x800E8184]
+0x14 char name[12]        ; NUL-terminated internal name
```
A parallel 24-byte menu/info table at `0x800782A8` (ROM `0x78EA8`) gives the in-game names:
```
+0x00 char* internalName   +0x04 char* titleLine1   +0x08 char* titleLine2 (or 0)
+0x0C char* categoryLine1  +0x10 char* categoryLine2
+0x14 u16 redRemotes       +0x16 u16 tvLogo (index into object lvltv___)
```
Levels are selected by name (`0x8004B520` NameToLevelIndex over this table); hub warp gates build the
name with `sprintf("%s%d", prefix, number)`; EXIT LEVEL uses `"map5"`.

**Gex 3** — ROM `0x8013C` (vaddr `0x8007F53C`), 30 records of 0x54 bytes, index = level id (verified
unless marked):
```
+0x00 char* name ("snow96")        +0x1C u32 level data ROM start (raw DEFLATE, -> 0x8024B000)
+0x04 u16 string id: title         +0x20 u32 level data ROM end
+0x06 u16 string id: genre         +0x24 u32 overlay ROM start (-> 0x80113910)
+0x08 u16 string id: channel       +0x28 u32 overlay ROM end
+0x0A u16 3 = TV/secret, 1 = hub   +0x2C u32 overlay RAM end incl. BSS
      (HYPOTHESIS: mission count)  +0x30 u32 address inside the overlay (HYPOTHESIS: entry/init)
+0x0C u16 category/slot: TV 5..0x10 +0x34 u32; low byte (+0x37) = first level-local voice-clip SFX id (§6.6)
      (0x0D unused), bosses 0x11-0x13, +0x38 u32 ROM of 0x310 raw bytes -> 0x800FEE48 (lip-sync timing; 0 = none)
      bonus 0x14, secret 0x15, 0 other +0x3C u32 ROM of 0x820-byte 64x64 CI4 channel logo -> 0x801FF7E0 (0 = none)
+0x0E u16 x3 string ids: mission names +0x40 u32 ROM "N64 WaveTables" (level sample bank)
+0x14 u16 x4 unknown                +0x44 u32 ROM "N64 PtrTablesV2" (level bank pointer table)
                                    +0x48 u32 ROM level sound table (0xB40 bytes -> 0x800CFD20)
                                    +0x4C u32 / +0x50 u32 ROM range of the DEFLATE level song -> 0x800FF290
```
String table: `char*[242]` at `0x80080110` (getter `0x800260A0`). Level lookup by name: `0x8004FF54`.
Pointers in the table are main-image addresses (convert with ROM = vaddr − `0x7FFFF400`).

### 3.5 ROM maps

**Gex 64** (16 MiB, all regions accounted for):

| ROM | contents |
|---|---|
| `0x000000-0x001000` | header, IPL3 (CIC-6102) |
| `0x001000-0x07FF40` | main code + data (level table `0x708E0`, object table `0x745F0`, info table `0x78EA8`) |
| `0x07FF40-0x0ED0F0` | 18 level code overlays |
| `0x0ED0F0-0x0EF120` | inflate overlay |
| `0x0EF120-0x102A90` | audio pointer bank "N64 PtrTablesV2" (read to `0x800D1820`) |
| `0x102A90-0x386450` | audio wave data (streamed from ROM; base stored at `0x800C5914`) |
| `0x386450-0x49A200` | music: 8 pointer/wave bank pairs, DEFLATE level songs stored after their banks, EXTRAS bank and 4 raw jingles `0x497E00..0x49A200` (level audio table `0x8006F5A8`, §6.4) |
| `0x49A200-0x49B600` | 5 attract-demo controller recordings (0x400 each) |
| `0x49B600-0x49BA00` | zero / unused 6th demo slot (§10) |
| `0x49BA00-0x49D870` | table read to `0x800E6010` during audio init (first byte = count); not music data, purpose unknown |
| `0x49D870-0x4B5750` | common blob: Gex player model + animations (DEFLATE, relocatable) |
| `0x4B5750-0xC495B0` | 31 level data files (DEFLATE) |
| `0xC495B0-0xF821C0` | 735 object files (DEFLATE, relocatable) |
| `0xF821C0-0x1000000` | zero padding |

**Gex 3** (32 MiB):

| ROM | contents |
|---|---|
| `0x0000000-0x0001000` | header, IPL3 (CIC-6102) |
| `0x0001000-0x008BFD0` | main code + data (level table `0x8013C`, object table `0x818C0`, strings `0x88000-0x8B400`) |
| `0x008BFD0-0x008DEB0` | inflate overlay |
| `0x008DEB0-0x0255D10` | 30 level code overlays |
| `0x0255D10-0x031F2F0` | global SFX bank: "N64 PtrTablesV2" at `0x255D10` + "N64 WaveTables" at `0x25AEE0` |
| `0x031F2F0-0x0BD2050` | 29 per-level audio banks (PtrTablesV2 + sound table + WaveTables; opening1/opening3 share one) |
| `0x0BD2050-0x0D204A0` | global "N64 WaveTables" (music samples, streamed during play) |
| `0x0D204A0-0x0D2D3C0` | global "N64 PtrTablesV2" (read to `0x800D1E80`) |
| `0x0D2D3C0-0x0D52B60` | 15 DEFLATE level songs (record +0x4C/+0x50, §6.6) |
| `0x0D52B60-0x0D53F60` | per-level 0x310-byte lip-sync tables (record +0x38); a global 0x340 table at `0xD53180` |
| `0x0D53F60-0x158E1B0` | 30 level data files (DEFLATE), sorted by name |
| `0x158E1B0-0x159C4C0` | `gex_____` player object |
| `0x159C4C0-0x1A92090` | 963 object files |
| `0x1A92090-0x1D3B030` | Agent Xtra talking-head video: 1,341 frames of 0x820 bytes (64x64 CI4 + palette), addressed by the Mission Control overlay as base + frame x 0x820 (§10). No table entry points here |
| `0x1D3B030-0x1D43230` | per-level 0x820-byte blocks (record +0x3C): 64x64 CI4 TV channel logos (same frame format as the video) |
| `0x1D43230-0x2000000` | zero padding |

### 3.6 Extracting every file

1. Normalise byte order (existing `normalizeByteOrder`).
2. Level files: iterate the level table (§3.4); inflate `[start, end)` (Gex 64 `+0/+4`, Gex 3 `+0x1C/+0x20`).
   The result is a flat image **linked at `0x8024B000`**: every pointer inside is an absolute address,
   so `fileOffset = ptr − 0x8024B000`. There is no relocation table.
3. Object files: iterate the object table until a zero name byte; inflate and apply §3.2.
4. Player model: Gex 64 ROM `0x49D870..0x4B5750`, Gex 3 ROM `0x158E1B0..0x159C4C0`; inflate, §3.2.
5. Code overlays and audio regions are plain ROM ranges.

Reference extractors (Python, stdlib only): `g64fs/g64extract.py [ROM] [OUTDIR]` (with
`--selftest`, which cross-checks a pure-Python inflater against zlib) and `g3fs/g3extract.py [ROM]
[OUTDIR]` (1,079 files). Both write an index (`index.json` / `index.tsv`) with ROM ranges and sizes.

---------------------------------------------------------------------------------------------------
## 4. Level lists

### 4.1 Gex 64: Enter the Gecko (31 table entries; names verified from the info table)

The hub is the **Media Dimension** (`map5`), whose TV gates warp by name. Order below is the table
order, which is also the order of the info table; the unlock order in the hub was **not traced**
(HYPOTHESIS: 0..13 is the intended progression).

| idx | internal | in-game title | channel | red remotes | role |
|---|---|---|---|---|---|
| 0 | looney30 | Out of Toon | Toon TV | 3 | main level |
| 1 | horror4 | Smellraiser | Scream TV | 3 | main level |
| 2 | rta1 | Gecques Cousteau | Sea Span | 3 | main level |
| 3 | horror2 | Frankensteinfeld | Scream TV | 3 | main level |
| 4 | circuit5 | WWW.DotCom.Com | Circuit Central | 2 | main level |
| 5 | kungfu02 | Mao Tse Tongue | Kung-Fu Theater | 2 | main level |
| 6 | scifi10 | The Umpire Strikes Out | Rocket Channel | 2 | main level |
| 7 | prehst1 | Pangaea 90210 | Pre-History Channel | 2 | main level |
| 8 | looney69 | Fine Tooning | Toon TV | 2 | main level |
| 9 | prehst2 | This Old Cave | Pre-History Channel | 3 | main level |
| 10 | circuit9 | Honey I Shrunk the Gecko | Circuit Central | 3 | main level |
| 11 | scifi14 | Pain in the Asteroids | Rocket Channel | 3 | main level |
| 12 | kungfu1 | Samurai Night Fever | Kung-Fu Theater | 3 | main level |
| 13 | rezop3 | No Weddings and a Funeral | Rezopolis | 1 | main level |
| 14 | aztec16 | Aztec 2 Step | Bonus Bonanza | 0 | bonus |
| 15 | horror6 | Thursday the 12th | Bonus Bonanza | 0 | bonus |
| 16 | nypd01 | In Drag Net | Bonus Bonanza | 0 | bonus |
| 17 | spy2 | The Spy Who Loved Himself | Bonus Bonanza | 0 | bonus |
| 18 | kungfu4 | Lizard in a China Shop | Bonus Bonanza | 0 | bonus |
| 19 | rezop2 | Bugged Out | Bonus Bonanza | 0 | bonus |
| 20 | circuit0 | Chips and Dips | Bonus Bonanza | 0 | bonus |
| 21 | gillig1 | Gilligex Isle | Boss TV | 0 | boss |
| 22 | mooshu1 | MooShoo Pork | Boss TV | 0 | boss |
| 23 | gexzil9 | Gexzilla vs. Mecharez | Boss TV | 0 | boss |
| 24 | final01 | Channel Z | Boss TV | 0 | final boss (Rez) |
| 25 | map5 | Media Dimension (hub; also the title/main-menu background) | — | — | hub |
| 26 | intro1 | intro cutscene | — | — | cutscene |
| 27-30 | logo4, logo3, logo2, logo1 | boot logos (boot sets 28 = logo3; the logo overlay chains "logo"+n) | — | — | logos |

In-game names are stored upper-case; they are title-cased here. Multi-part/areas: each entry is one
DEFLATE file; see §5 for areas inside a file. Attract demos play horror4, circuit5, rezop3, scifi10,
prehst2 (table `0x8006CF98`). Suggested viewer list: 0–24 grouped by channel, then the hub (25);
26–30 contain almost no geometry.

### 4.2 Gex 3: Deep Cover Gecko (30 table entries; names from the string table, verified)

Boot flow (verified): 28 `opening1` (intro) → 27 `fly77` (title screen) → START → 29 `opening3`
(story intro) → 23 `gexcave6` Mission Control. The hub is split into four level files that warp to
each other (gexcave6 names gexcave5/7/8, each of those names gexcave6).

| id | internal | in-game title | channel / genre | role |
|---|---|---|---|---|
| 23 | gexcave6 | Mission Control | gexcave | hub (main) |
| 24 | gexcave5 | Lake Flaccid | gexcave | hub area |
| 25 | gexcave7 | Slappy Valley | gexcave | hub area |
| 26 | gexcave8 | Funky Town | gexcave | hub area |
| 0 | snow96 | Totally Scrooged | Holiday Broadcasting | TV level (3 missions) |
| 1 | clue1 | Clueless in Seattle | Mystery TV | TV level |
| 2 | egypt01 | Holy Moses! | Tut TV | TV level |
| 3 | war01 | War is Heck | Army Channel | TV level |
| 4 | gtown2 | The Organ Trail | Western Station | TV level |
| 5 | pirate45 | Cutcheese Island | Bucaneer Program | TV level |
| 6 | myth64 | Et Tu Gecko? | Mythology Network | TV level |
| 7 | beane1 | Bean Stalker | Fairytales TV | TV level |
| 8 | anime1 | When Sushi Goes Bad | Anime Channel | TV level |
| 9 | mob01 | My Three Goons | Gangster TV | TV level |
| 10 | city1 | Superzeroes | Superhero Show | TV level |
| 11 | dsnw1 | Gextreme Sports | Bonus Bonanza | bonus |
| 12 | burro1 | True Grits | Bonus Bonanza | bonus |
| 13 | gator13 | What a Crock! | Bonus Bonanza | bonus |
| 14 | roo11 | Marsupial Madness | Bonus Bonanza | bonus |
| 15 | tank11 | War and Pieces | Bonus Bonanza | bonus |
| 16 | spider01 | Temple of Gloom | Secret TV | secret level ("play as gex") |
| 17 | push44 | Peg Leg Polka | Secret TV | secret level |
| 18 | joyz1 | Cheesy Rider | Secret TV | secret level |
| 19 | water16 | The Abyssmal | Secret TV | secret level |
| 20 | wwgex1 | On the Ropes | WWGEX Wrestling | boss |
| 21 | oz01 | Lions Tigers and Gex | Lizard of Oz | boss |
| 22 | endboss1 | Rez-Raker | Spacestation Rez | final boss |
| 27 | fly77 | title screen (Gex on the beach) | — | title |
| 28 | opening1 | intro cutscene | — | cutscene |
| 29 | opening3 | story intro | — | cutscene |

Mission names per TV level (string ids at record +0x0E) are listed in `notes/g3_fs.md` §12.
**Hub TV assignment** (verified from the level data: hub TV instances point at records that name
the target level; confirmed in game by the level pass): **Mission Control** — snow96, clue1;
**Lake Flaccid** — egypt01, war01, gtown2, pirate45, wwgex1; **Slappy Valley** — beane1, myth64,
anime1, oz01; **Funky Town** — city1, mob01, endboss1. The bonus and secret levels are spread across
the hubs (per-level placement in `notes/g3_level.md`). The in-game order in
the retail level-select page (§10) is ids 0..26.

## 5. Level format

### 5.1 Shared structure (both games)
- A level file is **one flat image linked at `0x8024B000`**. Every pointer in it is an absolute
  address: `fileOffset = ptr − 0x8024B000`.
- **World geometry** is a spatial tree whose leaves hold short F3DEX display-list fragments. The
  game culls the tree against the view and, each frame, calls the visible chunk DLs (Gex 64) or copies
  the visible fragments behind their material DLs (Gex 3). There are
  no rooms or portals, and each file has one tree for the whole level.
- **Segments**, set every frame from the level header or scene struct:

  | segment | contents |
  |---|---|
  | 1 | vertex pool (N64 `Vtx`, 16 bytes) |
  | 2 | material display lists |
  | 3 | texture + palette pool |

- **Textures** are uploaded with the tile commands (`G_SETTIMG` / `G_SETTILE` / `G_LOADBLOCK` /
  `G_SETTILESIZE`, `G_LOADTLUT`) inside the material DLs. They decode correctly with the viewer's
  existing `texture.ts`.
- **Coordinates:** right-handed with **+Z up** in both games (verified independently for each), and
  **no X mirroring**, unlike Rush. Convert to the viewer's Y-up frame with `(x, y, z) → (x, z, −y) ×
  scale`. This is a rotation, so the winding is kept. Back faces are culled, and front faces are
  counter-clockwise in the OpenGL convention after the conversion.
- **Objects** are separate relocatable files (§3.2), named in a list in the level header and placed
  by fixed-size instance records: Gex 64 uses 48 bytes, Gex 3 uses 0x34 bytes. Object textures use
  segment 5 in both games.
- **Fog and clear colour** come from the level header. **Skies** are stored in the level file as
  camera-relative display lists: both games put the sky
  vertex pool in segment 4 (header +0x28).

### 5.2 Gex 64 level file (verified unless marked)

Offsets below are into the decompressed level file (`g64fs/files/levels/NN_name.bin`); examples use
looney30.

**Header** (the fields a viewer needs; others in `notes/g64_level.md` §10):
```
+0x00 ptr   scene struct (0x40 bytes)
+0x0C ptr   vertex-colour animation list (flickering lights; HYPOTHESIS layout) — use file colours
+0x20 u32   sky record count          +0x24 ptr sky records (16 bytes)    +0x28 ptr sky Vtx pool (segment 4)
+0x2C s16 x,y,z  player start
+0x40 ptr   object-name list: u32 n, then n x char[8]   (the loader patches it into object pointers)
+0x48 u8 r,g,b   clear colour AND fog colour
+0x52 u16   fog min (gSPFogPosition min; >= 1000 -> 980), fog max = 1000
+0x7C u32   instance count            +0x80 ptr instance array (48-byte records)
+0x90..+0x9C, +0xA4  ptrs to 12-byte names (theme/music/sky names, e.g. "looney", "carrot")
scene: +0x00 ptr render-BSP root   +0x18 u32 vertex count   +0x24 ptr vertex pool (segment 1)
       +0x28 ptr collision faces   +0x2C ptr plane normals (6-byte s16 4.12)
       +0x34 ptr second BSP (HYPOTHESIS: collision)   +0x38 ptr material DLs (segment 2)   +0x3C ptr texture pool (segment 3)
```
Segments are set by `0x8002BBFC` each frame: `BC000406 <seg1>`, `BC000806 <seg2>`, `BC000C06 <seg3>`,
`BC001006 <hdr+0x28>` (F3DEX 1.x `G_MOVEWORD`).

**Render BSP** (24-byte nodes, from `scene+0x00`):
```
+0x00 s16 cx, cy, cz; u16 radius    bounding sphere of the node
+0x08 u16 kind                      1 = interior, 2 = leaf
interior: +0x0A s16 planeIndex (into scene+0x2C; negative = negated normal)
          +0x0C s32 distance   +0x10 ptr childA   +0x14 ptr childB
leaf:     +0x0A u16 collisionFaceCount   +0x0C ptr collision faces
          +0x10 chunks: {u16 flags; u16 dlSize; u32 extra} + F3DEX 1.x DL[dlSize] ... ; dlSize 0 ends the leaf
```
Chunk DLs contain `06000000 02xxxxxx` (G_DL to a segment-2 material), `04` G_VTX from segment 1,
`B1` G_TRI2, `BF` G_TRI1 and `B8` G_ENDDL. looney30 has 1,080 leaves, 3,890 chunks and 11,040
triangles. **Pitfall: the RSP vertex buffer carries over between the chunks of a leaf.** Later chunks
often have no G_VTX and use vertices loaded by an earlier chunk, so run a leaf's chunks in order with
shared vertex state.

Chunk flags:

| flags | meaning |
|---|---|
| 0 | opaque, back-face culled |
| bit 0 | sorted translucent pass with culling off; contains reversed-winding twins |
| bit 1 | **flipbook**: `extra` points to `{u16 period; u16 count; ptr materialDL[count]}`, and the chunk has no material G_DL of its own. Use frame 0, or cycle with `frame = (time / period) % count` (HYPOTHESIS timing) |
| bit 2 without bit 1 (flags 4/5) | animated-texture record (probably water or lava drawn by special code; layout HYPOTHESIS, `notes/g64_level.md` §9). No material; not drawn in the analysed frames |

**Materials** (151 in looney30): `E7 PIPESYNC; BA000E02 00008000` (TLUT RGBA16); SETTIMG TLUT (seg 3);
`F0` LOADTLUT 16 colours; SETTIMG texels (seg 3); `F3` LOADBLOCK; `F5` SETTILE CI4; `F2` SETTILESIZE;
`B8`. The texture-pool record is a 32-byte TLUT followed by CI4 texels, mostly 32×32 with clamp wrap;
there are a few 16×32/16×16 textures and two RGBA32 ones. Only 29 of 3,001 world materials (all
levels) are unreferenced.

**Fog, clear colour, projection** (code `0x800376D0`, `0x8002BE78`; verified against the frame DL):
- Clear colour = `G_SETFILLCOLOR` of hdr+0x48..0x4A. Fog colour = hdr+0x48..0x4A with alpha 0xFF.
- `gSPFogPosition(min = u16 hdr+0x52, max 1000)`, giving multiplier `128000 / (1000 − min)` and
  offset `(500 − min) × 256 / (1000 − min)`. looney30: min 994 → `BC000008 5355ADAB` (21333, −21077).
- Projection: `guPerspective(fovy 40°, 4/3, near = 220, far = 10000)`, and the world modelview
  includes a 0.5 scale. Near and far are in game units.

**Sky** (verified on kungfu4):
- hdr+0x20 count, hdr+0x24 records `{u32 0; s16 dx, dy (HYPOTHESIS: sector direction); u32; ptr DL}`;
  segment 4 = hdr+0x28 vertex pool.
- The DL is `G_DL` material, `G_VTX` from segment 4, then `G_TRI1`s: a ring of sectors around the camera.
- It is drawn first with camera rotation only, no depth or fog, and the texture-colour-only combine
  `FCFFFFFF FFFCF279`.
- Levels with a sky: scifi10, prehst1, scifi14, kungfu1, kungfu4, gillig1. The others show the clear
  colour.

**Instances** (48 bytes, hdr+0x80, count hdr+0x7C):
```
+0x00 s32 objIndex (into the hdr+0x40 list; -1 = logic-only entry, 211 in all levels)
+0x04 ptr optional parameter block
+0x08 s16 rotX   +0x0A s16 rotY   +0x0C s16 rotZ     (4096 = 360°, rotZ is the usual yaw)
+0x0E s16 variant (HYPOTHESIS)
+0x10 s16 x, y, z  world position     +0x16 u16 activation radius
+0x18 u16, +0x1A u16 (HYPOTHESIS: behaviour parameters)   +0x1C u32 flags
+0x20 ptr, +0x28 ptr optional parameter blocks (paths, warp records, text)   +0x24, +0x2C runtime
```
**world = T(x, y, z) · Rx(rotX) · Ry(rotY) · Rz(rotZ) · v** (column vectors; right-handed positive
angles). Verified: the actor pose matrices of 4 spawned actors with 2–3 non-zero angles match within
0.0004. There is no scale field and there are no parent links.

**Object files** (after relocation; pointers are data-relative):
```
object: +0x00 u32 flags   +0x08 u16 nMeshes, u16 nAnims   +0x0C ptr -> u32 meshPtr[nMeshes] (mesh 0 = default)
        +0x10 ptr animation table (non-zero = skeletal)   +0x20 ptr class name (8 chars)   +0x24 ptr object name
mesh:   +0x00 u32 nVerts  +0x04 ptr verts  +0x10 u32 nFaces  +0x14 ptr faces | DL stream | 0 (no geometry)
        +0x18 u32 nParts  +0x1C ptr parts (24 bytes)  +0x24 u16 radius  +0x30 ptr texture pool (segment 5)
```
There are two mesh kinds:
- **Face-list meshes** (`nFaces > 0`, CPU-transformed by the game):
  - verts are 12 bytes `{s16 x, y, z; s16; u8 r, g, b, a}`;
  - faces are 12 bytes `{u16 v0, v1, v2; u8; u8 flags; ptr aux}`;
  - `flags & 2` = textured, with aux = `{ptr materialDL; u8 s0, t0, s1, t1, s2, t2 (texels; s = byte << 6 at G_TEXTURE scale 0.5); u8 opaque}`;
  - `flags & 8` = aux is an RGBA colour.
- **DL meshes** (`nFaces == 0`):
  - N64 Vtx vertices, plus records `{u16 nCmd; u8 nVtx; u8 kind; ptr material}` followed by nCmd
    inline F3DEX commands;
  - for each record, load the next `nVtx` vertices, apply the material by `kind & 0x7F`
    (1 = G_DL, 2 = flipbook `{u16 period; u16 count; ptr dl[]}`, 5 = untextured, 0 = keep), then run
    the inline list;
  - `kind & 0x80` = translucent; `nCmd == 0` marks the last record.

**Parts** are 24 bytes `{u16; u16 type; u16; u16; u16 vStart; u16 vEnd; s16 px, py, pz; u16 parent;
ptr}`. For skeletal objects, a joint's vertices are local and the joint rest position is `pivot +
parent`. On rigid face-list objects, `type 1` parts are camera-facing sprites. Animation data is not
decoded, so only rest poses are available. The Gex player model (common blob) uses the same format as
a skeletal DL mesh.

**Object classes for filtering** (`g64lvl/object_classes.json`): class name at obj+0x20 plus geometry
kind. Examples:

| group | classes / objects |
|---|---|
| invisible logic (no geometry) | `camswch_ collide_ follow__ gatesph_ qcoll___ slider__ z*`; volumes `invis___`, `jinvis__` |
| collectibles | `cola____ colb____ colc____ remsilv_`, flies; red remotes `remred__` are spawned by code |
| props | `leafgen_ bldg____ funguy__` |
| enemies | skeletal objects with `nAnims > 1` |
| effects | `fxgen___`, `*fx_` |
| platforms / scripted | `funplat_ plat____ ppath___ fallobj_ door____` |

Class meanings are HYPOTHESIS; they are inferred from names.

**Multi-area:** none. Each file has one render BSP; bonus rooms and bosses are separate level files.

**Pitfalls found:**
1. Chunks share vertex state within a leaf.
2. Chunk flags 2 and 4 carry material through `extra`, not a G_DL.
3. The sky needs a texture-only combine; the viewer currently always multiplies by vertex colour.
4. The debugger `write` takes hex: `write 0x800c5761 b 12` loads index 0x12 = kungfu4.
5. Object vertices are drawn by the game from CPU-transformed copies, so RAM display lists don't
   reference object files directly.
6. gillig1 has 19 sky records, but the reference renderer shows no sky for it (not resolved).

### 5.3 Gex 3 level file (verified on gexcave6, anime1, snow96, endboss1 unless marked)

The design is the same as Gex 64 (§5.1). The layouts differ, and world geometry is stored as
*fragments* that the game copies into the frame, not as callable display lists.

**Header:**
```
+0x00 ptr   scene struct
+0x08 u32   2 (all levels)
+0x20 u32   sky patch count   +0x24 ptr sky patch table (16 bytes)   +0x28 ptr sky Vtx pool (segment 4)
+0x2C ptr   material table {u32 n; ptr entry[n]}
+0x30 s16 x,y,z, +0x36 s16 angle   player start (HYPOTHESIS)
+0x44 ptr   object-name list {u32 n; char[8] x n} (patched into object pointers by the loader)
+0x4C u8 r,g,b   fog colour AND clear colour
+0x50 u8 r,g,b   second colour (HYPOTHESIS: ambient/object tint)
+0x54 u16   8000..15100 (HYPOTHESIS: draw distance / far plane)
+0x56 u16   fog min for gSPFogPosition(min, 1000); values >= 1000 clamp to 993
+0x74 s32   -40000 (HYPOTHESIS: kill plane)
+0x84 u32   instance count    +0x88 ptr instance array (0x34-byte records)
+0x108/+0x10C/+0x110  sizes of the per-frame gfx/vertex buffers
scene: +0x00 ptr root node  +0x10/+0x14 instance count/array  +0x18 u32 world vertex count
       +0x30 ptr vertex pool (segment 1)   +0x38 ptr per-leaf aux records (8 bytes; HYPOTHESIS visibility)
       +0x58 ptr material DL pool (segment 2)   +0x5C ptr texture/TLUT pool (segment 3)
```
Segments 1–4 are set every frame by `0x80022230` (F3DEX2 `G_MOVEWORD` `DB06…`).

**Tree** (24-byte nodes from `scene+0x00`): `+0x00 s16 minX, minY, minZ, maxX, maxY, maxZ` (AABB);
`+0x0C u8 type` (1 = inner, 2 = leaf); `+0x0D u8` (leaf: aux count); `+0x0E u16` (inner: split
value, HYPOTHESIS; leaf: id); `+0x10 ptr` (inner: child A; leaf: aux records); `+0x14 ptr` (inner:
child B). The hub has 1,556 inner nodes and 1,557 leaves.

**Fragments** follow each leaf record inline and end with a `u32 0` plus 4 pad bytes `CDCDCDCD`:
```
Type A (flags bit0 = 0): u16 flags; u16 nbytes; u16 material; u16 0; u32 0; u32 0 (runtime)  + nbytes of commands
Type B (flags bit0 = 1): u16 flags (5 or 9); u16 nbytes; ptr special-material record  + (nbytes-8) of commands + G_ENDDL
commands: 01 G_VTX (segment-1 address), 05 G_TRI1, 06 G_TRI2 — type A has no G_DL and no G_ENDDL
```
Each frame, for every visible material, the game emits `DE000000 <material DL>` followed by a verbatim
copy of the commands of all visible type-A fragments with that material. That is why a level file
has only ~300 `G_ENDDL`s. Flags value 2 marks fragments whose material is an animation record.
Vertex state is shared *within* a fragment only. 2–4 fragment lists per level still fail to parse
(listed as anomalies by `g3lvl/ts/g3level.ts`).

**World render state** (static DL `0x8007F228`): ZBUFFER | SHADE | CULL_BACK | SMOOTH, no lighting
(prelit vertex colours), G_TEXTURE scale 0.5, combiner `FC127FFF FFFFF238` (MODULATERGB), render mode
`C8113078`.

**Materials** (table at header +0x2C). Each entry is one of:
- a 0x68-byte texture DL in segment 2: `E7; E3001001 00008000` (TLUT RGBA16); SETTIMG TLUT (seg 3);
  LOADTLUT; SETTIMG texels; LOADBLOCK; SETTILE CI4 clamp; SETTILESIZE; `DF`;
- an animation or special record;
- 0 (empty slot).

The texture pool holds 32-byte TLUTs followed by CI4 texels (mostly 32×32; some 32×16, 16×16, 64×16;
a few CI8; one RGBA32). Animated materials are driven by `0x8002A2C8` each frame. The kind is
`(u16 record+0) & 0xE`:
- **0:** a plain DL;
- **2:** a flipbook `{u16 kind; u16 nframes; ptr DL[nframes]}` driven by the global frame counter
  `[0x800A6174]`;
- **4:** a procedural texture (`0x80029690`);
- **6:** handled by `0x800295FC`;
- **8:** handled by `0x800291A0`.

For the viewer, use the first frame DL (`entry+4`). Special records, referenced by type-B fragments,
carry extra DLs and colours (HYPOTHESIS: animated screens and water).

**Fog, clear colour, projection** (code `0x8002D4EC..0x8002D5A0`, `0x80022464`; frame values match):
- Fog colour = clear colour = header +0x4C RGB. `gSPFogPosition(min(u16 +0x56, 993), 1000)` gives
  `DB080000 476DB993` (18285, −18029).
- Near 220. Far varies per level at runtime (10001 hub, 12009 anime1, 14010 snow96, 12000 endboss1),
  HYPOTHESIS related to header +0x54.
- Per-level values for all 30 levels: `g3lvl/levelheaders.txt`. The colour is black for most levels;
  snow96, beane1 and dsnw1 use 00A0F8, roo11 080838, tank11 00000C, water16 00141E, fly77 60C5DC.

**Sky** (header +0x20/+0x24/+0x28):
- Records are `{u32 0; s16 dirX, dirY, dirZ; s16 cone; ptr DL}`. Each DL is a segment-2 material
  followed by segment-4 vertices.
- Drawn first with its own projection (`0x8007FF70`), a camera-centred modelview, the texel-only
  combiner `FCFFFFFF FFFCF279`, and no depth. The game only draws camera-facing patches; a viewer can
  draw all of them.
- 17 of 30 levels have one: snow96 14, clue1 1, war01 4, gtown2 2, pirate45 4, beane1 8, mob01 1,
  city1 8, dsnw1 11, burro1 2, roo11 5, tank11 1, wwgex1 2, endboss1 20, gexcave5 1, gexcave8 1,
  fly77 13.

**Instances** (0x34 bytes, header +0x88, count +0x84):
```
+0x00 s32 name index into the header +0x44 list (-1 = none: 331 instances, triggers/cameras HYPOTHESIS)
+0x04 ptr parameter block or 0
+0x08 s16 angle A, +0x0A s16 angle B, +0x0C s16 angle C   (4096 = 360°; C = Z verified visually)
+0x0E u16 flags/variant (HYPOTHESIS: mission/state group — explains objects placed but not visible in game)
+0x10 s16 x, y, z   world position (verified by placement render)    +0x16 u16 radius
+0x1C ptr parameter record (TV/warp links: {u16 a, u16 b, char namePrefix[]})   +0x28 ptr (door links)
```
The rotation order is **HYPOTHESIS**. Gex 64's verified order is `T · Rx · Ry · Rz`; Gex 3 was only
checked for Z rotations. Use the Gex 64 order and check in the viewer against the hub render.

**Object files** (relocated, data-relative pointers):
```
+0x0C ptr mesh list   +0x10 ptr animation list (0 for static props)   +0x14 u16 x4 distances (HYPOTHESIS LOD/draw)
+0x1C ptr script names   +0x20 ptr behaviour class name (8 chars)   +0x24 ptr object name   +0x28 ptr model list (344 objects)
mesh: +0x00 u16 nverts  +0x04 u16 nfaces  +0x06 u16 nsegments  +0x08 ptr vertices (8 bytes: s16 x,y,z; u16)
      +0x0C ptr colours (u32 RGBA per vertex)  +0x14 ptr faces (12 bytes: u16 v0,v1,v2; u8; u8 flags; u16 0; u16 uvRecordOffset)
      +0x18 ptr segments (bone/part table)  +0x34 ptr texture pool (segment 5)
uv record (20 bytes): u16 0; u16 material DL offset; s16 s0,t0,s1,t1,s2,t2; 4 bytes pad
```
This layout is valid for 958 of 964 objects. The game draws objects like Gex 64: segment 5 = texture
pool, the object's material DL, then CPU-transformed triangles. Rigid meshes (`nsegments == 1`) render
correctly. Multi-segment (skinned) meshes need the segment transforms, which were **not decoded**:
their parts collapse at the origin. Behaviour class at object +0x20 (full list in
`g3lvl/objclasses.txt`):
- props: `generic_` (474), `none____`, `billbrd_`;
- pickups: `coin____`, `collect_`, `remred__`, `openmag_`;
- characters/enemies: `hank____`, `monster_`, `bird____`, `fish____`, …;
- scripted: `boinger_`, `funplat_`, `zipline_`, `teeter__`, …;
- portals: `lvltv___`, `tvend___`, `powertv_`;
- FX: `chunk___`, `anibomb_`;
- invisible: index −1 instances.

**Hubs and areas:**
- The hub is four level files: 23 Mission Control, 24 Lake Flaccid, 25 Slappy Valley, 26 Funky Town.
  They are linked by door warps.
- Hub TVs are `lvltv*` instances whose +0x1C record names the target level prefix (§4.2 for the
  mapping). Its `a` field is probably the remotes needed (HYPOTHESIS).
- TV levels are single files with no sub-areas.

**Pitfalls found:**
1. World geometry has no ENDDL and no G_DL: build one synthetic list per material, the material DL
   plus the concatenated fragment commands, and run it through `runDisplayList` (`g3lvl/ts/g3level.ts`
   `buildBatches()`).
2. Header offsets are shifted by +4 compared with Gex 64 for the name list, instances, fog colour and
   fog min.
3. Some placed hub objects are hidden in game depending on state or mission.
4. The earlier guess of hub TV assignment from shared objects was wrong (egypt01 and war01 are in Lake
   Flaccid).

## 6. Music

### 6.1 Engine (both games: libmus, verified)

Both games use **libmus**, the N64 SDK "MUS" music driver by Software Creations. Its pointer bank
starts with the signature `N64 PtrTablesV2` and its wave bank with `N64 WaveTables`. It runs on top of
the libultra synthesizer (alSyn: VADPCM decoding, RSP resampler, envelope mixer). It is *not* the
MIDI sequence player (`alSeqPlayer`), and there is no ALBank `.ctl`/`.tbl`. Songs are libmus song
binaries: per-channel command streams, one libmus channel per voice. Music and sound effects share
the same channel pool.

| | Gex 64 | Gex 3 |
|---|---|---|
| libmus revision | older: channel struct 0x120 bytes, 42 commands `0x80..0xA9` | newer: channel struct 0x13C bytes, 45 commands |
| output rate | 22050 Hz stereo | 22047 Hz (22050 requested; actual value read from RAM) |
| channels / voices | 24 | 24 |
| player tick | once per video frame (60 Hz NTSC); **HYPOTHESIS**: 367 output samples per frame | once per frame, 367 samples (verified) |
| songs | 27 (23 level songs + 4 jingles) | 15 (one per level; song 2 shared by 13 levels) |
| per-level switching | crossfades between songs through area-trigger lists | none. "Adaptive audio" on N64 means fade in/out and ducking only (a flag shared with Gex's lip-sync) |
| reverb | the synth FX bus is configured; per-song and per-channel sends | same (**not rendered** by the reference renderers) |

The player port in each reference renderer matches the running game's per-channel player state in
RAM exactly (§8). So everything below reproduces the game's note, envelope, volume and pitch
*control*. The final PCM mix (libultra envmixer and resampler rounding, reverb) is an approximation
that could not be compared by ear: the headless emulator has no audio output.

### 6.2 Sample banks (both games)

**Pointer bank** (`.ptr`; offsets relative to the bank start, relocated at init by
`MusPtrBankInitialize`):
```
+00 char label[16]   "N64 PtrTablesV2\0"
+10 u32  flags       (bit 31 set at runtime = relocated)
+14 char wbkName[12] e.g. "orchestr.wbk"
+20 u32  count
+24 u32  basenote   -> u8[count]
+28 u32  detune     -> 4 bytes per wave; byte 0 = s8 cents (overwritten at init with an f32 pitch offset)
+2C u32  waveList   -> u32[count] offsets of ALWaveTable records
+30 ...  ALWaveTable records, each followed by its ALADPCMBook and ALADPCMloop
ALWaveTable (24 bytes): u32 base (offset into the wave bank; the ROM address of the wave bank is added
  unless the top byte is 0xFF), s32 len, u8 type (0 = AL_ADPCM_WAVE; every Gex wave is VADPCM),
  u8 flags, u16 pad, u32 loop (-> ALADPCMloop, 0 = none), u32 book (-> ALADPCMBook), u32 pad
ALADPCMBook: s32 order (2), s32 npredictors (4), s16 book[order * npredictors * 8]
ALADPCMloop: u32 start, u32 end, s32 count (-1 = forever), s16 state[16]
```
Pitch offset per wave, in semitones: `pitchOffset[i] = (s8)detune[i*4] / 100 + (s8)(basenote[i] - 48)`.
For example, basenote 244 gives −60, so note 60 plays the sample at 22050 Hz.

**Wave bank** (`.wbk`): a 16-byte header `N64 WaveTables \0`, then raw 9-byte VADPCM frames (16 samples
each). The game streams it from ROM and never copies it. Decode with the standard libultra VADPCM
predictor using the wave's book. Loops follow `alAdpcmPull`: the loop body restarts from the stored
decoder state.

### 6.3 Song format (Gex 64 revision; Gex 3 differences in §6.6)

Header (offsets relative to the song start; relocated by `__MusIntStartSong`):
```
+00 u32 numChannels   (always 24 slots; 6..18 used)
+04 u32 channelList -> u32[numChannels] offsets of channel command streams (0 = unused)
+08 u32 volumeList  -> u32[numChannels] offsets of volume streams (0 = none)
+0C u32 pbendList   -> u32[numChannels] offsets of pitch-bend streams (0 = none)
+10 u32 envTable    -> 7-byte envelope records
+14 u32 drumList    -> u32 offsets of 4-byte drum maps (unused by Gex; equals envTable)
```
**Channel command stream.** A byte below 0x80 is a note: pitch `0x00..0x5F`, or `0x60` = rest. It is
followed by `[velocity u8]` only when velocity mode is on (command 0x99), and by `[length var]` unless a
fixed length is set (0x8B; 0x8C forces a length for the next note). `var`: a byte `b < 0x80` is the
value itself; otherwise the value is `((b & 0x7F) << 8) | next byte`. Lengths are in ticks, **48 ticks
per quarter note**, and the tempo command's value is BPM.

Timing: each frame the channel time advances by
`inc = trunc(trunc(bpm * 24576 / 120) / vsyncsPerSecond) * tempoScale(128) >> 7` in 1/256-tick units
(NTSC: 120 BPM → 409, 145 BPM → 494, 75 BPM → 256; verified in RAM). A note is read while
`nextNoteTime < channelTime`; then `nextNoteTime += length * 256`.

Commands (Gex 64, handler addresses in main code; jump table `0x80079470`):

| cmd | args | meaning |
|---|---|---|
| 80 | – | stop channel |
| 81 | var | wave (instrument) number |
| 82 / 83 | u8 / – | portamento over N ticks / off |
| 84 | 7 bytes | inline envelope |
| 85 | u8 | tempo in BPM (applies to every channel of the song) |
| 86 | u16 | cutoff: release starts N ticks after note start |
| 87 | u8 | endit: release starts N ticks before note end |
| 88 / 89 / 8A | u8 delay, u8 speed, u8 depth / same / – | vibrato up / down (depth/50 semitones, period = speed ticks) / off |
| 8B | var | fixed note length (0 = lengths in stream) |
| 8C | – | next note carries a length |
| 8D | s8 | transpose |
| 8E | – | next note ignores transpose |
| 8F | s8 | detune (cents) |
| 90 | var | envelope = envTable[i] |
| 91 / 92 | – | envelope retrigger off / on |
| 93 / 94 | – | tie on / off (notes don't restart the sample) |
| 95 | u8 count | For: push loop state (max depth 4); `0xFF` = forever |
| 96 | – | Next: decrement and jump back (bend restored as an unsigned byte — libmus bug, reproduce it) |
| 97 / 98 | u8 amount, u8 on, u8 off / – | wobble: +amount semitones for `on` frames, 0 for `off` frames / off |
| 99 / 9A | – | velocity bytes on / off |
| 9B | u8 | default velocity (velocity bytes off) |
| 9C | u8 | pan = v >> 1 |
| 9D | 2 bytes | ignored |
| 9E / 9F | u8 / – | drum map on (entry per note {wave, envelope, pan×2, note}) / off |
| A0 | 1 byte | ignored |
| A1 | u16 data, u16 vol, u16 pbend | goto |
| A2 | u8 | channel reverb amount |
| A3 / A4 / A5 | u8 range, u8 base | random transpose / volume / pan |
| A6 | u8 | channel volume |
| A7 | var | start a sound effect |
| A8 | u8 | pitch-bend range (v/64 semitones per bend step) |
| A9 | u8 | pan sweep speed |

The Gex 64 songs use only 80 81 82 85 87 8A 8B 8D 8F 90 95 96 97 99 9A 9B 9C 9F A2 A8 A9. Every
looping channel uses exactly one `95 FF … 96`, which gives the loop points.

**Envelope record** (7 bytes): `speed` (0 → 1; value recomputed every `speed` frames), `initial`,
`attackSteps`, `peak`, `decaySteps`, `sustain`, `releaseSteps`. Phases:
- **Attack:** value = init + trunc((peak − init) / attack × t).
- **Decay:** value = peak + trunc((sustain − peak) / decay × t).
- **Sustain:** value = sustain.
- **Release:** value = relVol − trunc(t / release × relVol), where t counts steps since the release
  started.

Release starts at note start + cutoff, or at note end − endit, or on a rest. Channel defaults: volume
127, pan 64, velocity 127, envelope {1, 0, 1, 127, 255, 127, 15}, 120 BPM, bend range 2/64.

**Volume and pitch-bend streams** are run-length per tick. A byte `b < 0x80` is value `b` for 1 tick.
Otherwise it is value `b & 0x7F` for `c + 2` ticks (`c < 0x80`) or `((c & 0x7F) << 8) + next + 2`
ticks. Bend value `v` gives `(v − 64) × bendRange` semitones. Quirk: both streams are only serviced
when the *pitch-bend* timer is behind the channel time.

**Per frame, per channel** (`__MusIntMain`, Gex 64 `0x80054510`):
1. Advance time and read notes.
2. On a note: unless tied, start the wave. If the voice is sounding, ramp it to volume 0 for one frame
   and restart it on the next.
3. Update the envelope, vibrato, wobble and pan sweep.
4. Pitch: `ratio = 2^((note + pitchOffset + transpose + detune + bend + vibrato) / 12)`, computed with a
   6th-order Taylor series. A ratio above 2.0 is clamped to 2.0 **and the note is silenced**.
5. Volume: `v = (chanVol × envValue × velocity × handleVolume) >> 13`, clamped to 32767, then
   `v × masterSongVolume >> 15`.
6. Pan: `(pan × handlePan >> 7) & 0x7F`.

libultra then squares the volume in the envelope mixer and pans with its 128-entry equal-power table.

### 6.4 Gex 64 locations and tables (verified)

Banks (ROM):

| pointer bank | wave bank | name | waves | used by |
|---|---|---|---|---|
| `0x0EF120-0x102A90` | `0x102A90-0x386450` | gexsfx.wbk | 458 | all sound effects (default bank) |
| `0x3E7060-0x3EB590` | `0x386450-0x3E7060` | orchestr.wbk | 88 | Toon TV, Rocket Channel, hub/title, spy2, aztec16, gillig1, gexzil9 |
| `0x401250-0x401F70` | `0x3EC2A0-0x401250` | CIRCUIT.WBK | 19 | Circuit Central, mooshu1, intro1, logos |
| `0x41AC70-0x41B390` | `0x4066F0-0x41AC70` | horrormx.wbk | 9 | Scream TV, rta1, horror6 |
| `0x4382E0-0x439330` | `0x41CE00-0x4382E0` | KungFu.wbk | 23 | Kung-Fu Theater |
| `0x456C70-0x457A80` | `0x43B180-0x456C70` | NYPD.wbk | 21 | nypd01 |
| `0x4795F0-0x47A340` | `0x45DC50-0x4795F0` | prehismx.wbk | 19 | Pre-History Channel |
| `0x490000-0x490EC0` | `0x47CCB0-0x490000` | REZOP.WBK | 20 | Rezopolis, final01 |
| `0x4973A0-0x497E00` | `0x4958F0-0x4973A0` | EXTRAS.WBK | 12 | the 4 jingles |

Level songs are raw DEFLATE and stored right after the pointer bank they use. The 4 jingles are
uncompressed at ROM `0x497E00..0x49A200`. Sound effects are 512 libmus effect streams in main data
(pointer table `0x800729F0`, priorities `0x800731F0`).

**Level audio table** `0x8006F5A8` (ROM `0x701A8`), 31 × 36 bytes, indexed like the level table:
```
+00 u32 volume      handle volume of slot 0 (0x40..0xA0)
+04 u32 reverb      MusHandleSetReverb value (0x19; 0x14 for prehst1/2)
+08 u32 triggers    -> music trigger list (12-byte records {s16 kind, id, fromSlot, toSlot, fadeStep, extra}, end: kind < 0)
+0C u32 wbkRom      wave bank ROM address
+10 u32 ptrRomStart +14 u32 ptrRomEnd   pointer bank
+18 u32 songs       single song: ROM start; else (>= 0x80000000) pointer to {u32 romStart, u32 volume}[] (0-terminated)
+1C u32 songsEnd    single song: ROM end;   else pointer to u32 romEnd[]
+20 u32 flags       bit 0: don't autostart slot 0
```
The jingle table `0x8006FA0C` has 4 × {u32 romStart, u32 romEnd, u32 volume}. Crossfades between slots
come from the trigger lists: looney30, looney69, circuit5/9/0 and rta1 have entries. **Quirk:** a fade-in
always targets the *first* list entry's volume (verified in the Out of Toon RAM dump). One-shot songs
are restarted by the game when every channel has stopped.

**Song list (Gex 64)** — loop points in samples at 22050 Hz, frame-exact:

| ROM | bank | BPM | used by (level # slot) | loop / length | reference WAV (`g64audio/wav/`) |
|---|---|---|---|---|---|
| `0x3EB590-0x3EC2A0` | orchestr | 136 | Aztec 2 Step | 0..738404 | `3eb590_aztec16_aztec2step.wav` |
| `0x401F70-0x402880` | CIRCUIT | 127 | WWW.DotCom.Com, Honey I Shrunk the Gecko, Chips and Dips, MooShoo Pork, intro1, logos (#0) | 0..1999416 | `401f70_circuit_intro_logo_a.wav` |
| `0x402880-0x4030B0` | CIRCUIT | 127 | same levels, slot 1 | 0..333236 | `402880_circuit_intro_logo_b.wav` |
| `0x4030B0-0x403DD0` | orchestr | 88 | Gexzilla vs. Mecharez | 234880..1821421 | `4030b0_gexzil9_gexzilla_vs_mecharez.wav` |
| `0x403DD0-0x405C60` | orchestr | 85 | Gilligex Isle | 141662..1633517 | `403dd0_gillig1_gilligex_isle.wav` |
| `0x405C60-0x4066F0` | REZOP | 120 | Channel Z | 0..1587642 | `405c60_final01_channel_z.wav` |
| `0x41B390-0x41CA80` | horrormx | 75 | Smellraiser, Frankensteinfeld, Thursday the 12th, Gecques Cousteau (#0) | 0..3945617 | `41b390_horror_scream_tv.wav` |
| `0x41CA80-0x41CE00` | horrormx | 104 | Gecques Cousteau slot 1 | 0..203685 | `41ca80_rta1_gecques_cousteau_b.wav` |
| `0x439330-0x43B180` | KungFu | 97 | Mao Tse Tongue, Samurai Night Fever, Lizard in a China Shop | 0..2016298 | `439330_kungfu_theater.wav` |
| `0x457A80-0x458B70` | NYPD | 179 | In Drag Net | 62023..771434 | `457a80_nypd01_in_drag_net.wav` |
| `0x458B70-0x459FF0` | orchestr | 140 | Out of Toon #1, Fine Tooning #1 | 0..2665888 | `458b70_toon_tv_a.wav` |
| `0x459FF0-0x45A5C0` | orchestr | 140 | Fine Tooning #2 | 0..193776 | `459ff0_toon_tv_fine_tooning_slot2.wav` |
| `0x45A5C0-0x45AE70` | orchestr | 140 | Out of Toon #4, Fine Tooning #6 | 0..604816 | `45a5c0_toon_tv_c.wav` |
| `0x45AE70-0x45B420` | orchestr | 140 | Out of Toon #3 | 0..704273 | `45ae70_toon_tv_out_of_toon_slot3.wav` |
| `0x45B420-0x45CBC0` | orchestr | 120 | Out of Toon #2, Fine Tooning #0 | 66060..2028776 | `45b420_toon_tv_b.wav` |
| `0x45CBC0-0x45D100` | orchestr | 140 | Out of Toon #0, Fine Tooning #5 | one-shot 30.2 s | `45cbc0_toon_tv_d.wav` |
| `0x45D100-0x45D6D0` | orchestr | 140 | Fine Tooning #3 | 0..680418 | `45d100_toon_tv_fine_tooning_slot3.wav` |
| `0x45D6D0-0x45DC50` | orchestr | 157 | Fine Tooning #4 | 0..235981 | `45d6d0_toon_tv_fine_tooning_slot4.wav` |
| `0x47A340-0x47B670` | prehismx | 140 | Pangaea 90210, This Old Cave | 0..2419998 | `47a340_prehistory_channel.wav` |
| **`0x47B670-0x47CCB0`** | prehismx (HYPOTHESIS) | 140 | **unreferenced** (§10) | 0..2722773 | `47b670_UNUSED_prehistory_b.wav` |
| `0x490EC0-0x4918E0` | REZOP | 126 | No Weddings and a Funeral, Bugged Out | 83676..1677924 | `490ec0_rezopolis.wav` |
| `0x4918E0-0x4931C0` | orchestr | 100 | The Umpire Strikes Out, Pain in the Asteroids | 0..1957211 | `4918e0_rocket_channel.wav` |
| `0x4931C0-0x4958F0` | orchestr | 145 | Media Dimension hub **and title menu** (verified), The Spy Who Loved Himself | 147534..3634768 | `4931c0_hub_media_dimension_and_spy2.wav` |
| `0x497E00-0x498300` raw | EXTRAS | 120 | jingle 1 (HYPOTHESIS: remote-related fanfare) | one-shot | `497e00_jingle1.wav` |
| `0x498300-0x498A50` raw | EXTRAS | 181 | jingle 2 (HYPOTHESIS: level exit/complete) | one-shot | `498300_jingle2.wav` |
| `0x498A50-0x499550` raw | EXTRAS | 115 | jingle 3 (HYPOTHESIS: alternative exit) | 0..160746 | `498a50_jingle3.wav` |
| `0x499550-0x49A200` raw | EXTRAS | 202 | jingle 4 (HYPOTHESIS: red remote collected) | one-shot | `499550_jingle4.wav` |

`MusicTrack` names for the viewer: use the level titles in the "used by" column. No in-game jukebox
names exist.

### 6.5 Rendering offline to PCM (both games)

1. Parse the pointer bank (§6.2) and the song (§6.3). Inflate level songs first.
2. Run the channel player once per frame. Each frame is 367 output samples: 22050/60 rounded, and 367
   was verified for Gex 3.
3. For each voice, decode VADPCM with the wave's book (including loops), resample with the RSP 4-tap
   interpolator (pitch step `trunc(ratio × 32768) × 2`, ratio capped below 2.0), apply the squared
   volume with ramps and equal-power pan, and mix.
4. **Loop points:** the latest first `95 FF` over all looping channels gives loopStart. The same
   channel's first `96` jump gives the loop length. Both are multiplied by 367 samples. The channel
   loop lengths agree within one frame on every Gex 64 song.

Reusable from the viewer: `src/rom/music/rush1.ts` exports `decodeVadpcm` (libultra VADPCM; identical
book format) and `RESAMPLE_LUT` (RSP resampler), and both reference renderers import them. Its
unexported loop preparation and voice mixer were copied into them. Its MIDI/`alSeqPlayer` sequence
code does not apply. Reference implementations: `g64audio/gex64music.ts` (render all 27 songs in ~20
s: `npx tsx render.ts all`) and `g3audio/gex3music.ts`.

### 6.6 Gex 3 specifics (verified by disassembly and RDRAM unless marked)

**Loading** (`0x8005AAE8(level)`, on every level load), from the level record (§3.4):

| field | read to | meaning |
|---|---|---|
| `+0x44` | `0x80096F20` | level SFX pointer bank; `MusPtrBankInitialize(0x80096F20, wbk = rec+0x40)` |
| `+0x40` | – | level SFX wave bank (ROM offset, streamed) |
| `+0x48` | `0x800CFD20` | level *fx bank* (libmus effect file, below) |
| `+0x38` | `0x800FEE48` | **not audio**: lip-sync table for Gex's voice clips |
| `+0x4C/+0x50` | `0x800FF290` | the level **song** (raw DEFLATE). The **music pointer bank** ROM `0xD204A0..0xD2D3C0` is then read to `0x800D1E80`, with music wave bank ROM `0xBD2050` |
| `+0x37` (low byte of `+0x34`) | – | first level-local SFX id of the voice-clip table |

Global SFX: pointer bank ROM `0x255D10..0x25AEE0` (copied to `0x8010B370`), wave bank `0x25AEE0`, fx
bank ROM `0x31E5C0..0x31F2F0`. `musConfig` is built at `0x8005A970`: 24 voices, libmus allocates 28
channel structs, and channels 0–3 are voiceless master-track channels. Output rate: 22050 requested,
**22047 Hz actual** (ALSynth `+0x44`). Master volumes: songs `0x1FFF`, effects `0x31FE` (defaults
scaled by the options). Reverb is effectively off: `MusSetFxType(0)` gives a single section with gain 0.

**Song header** (version `0x215` in all 15 songs):
```
+00 u32 version (0x215)    +04 u32 numChannels (14)   +08 u32 numWaves
+0C u32 -> u32 channelData[numChannels]   +10 u32 -> volumeData[]   +14 u32 -> pitchBendData[]
+18 u32 -> envelope table (7 bytes/entry)  +1C u32 -> drum table (6 bytes/entry {u16 wave, u16 env, u8 pan, u8 note})
+20 u32 -> u16 waveTable[numWaves]  (song wave index -> music pointer-bank index; 0xFFFF = rest)
+24 u32 -> master track (tempo + rests; runs on a voiceless channel 0..3)
+28 u32 relocated flag (0 in ROM)
```
**Fx bank:** `+00 u32 n`, `+04 u32 effects`, `+08 u32 waves`, `+0C u32 flags`, `+10 u32 ptrBank`
(runtime), `+14 -> u16 waveTable[waves]`, then `{u32 streamOffset, u32 priority}[n]`. Effect streams
use the same command language.

**Differences from the Gex 64 revision** (§6.3 applies otherwise):

| aspect | Gex 64 | Gex 3 |
|---|---|---|
| channel struct | 0x120 bytes, 24 channels = voices | 0x13C bytes, 28 channels (4 voiceless master-track channels) |
| commands | 42: `0x80..0xA9` (table `0x80079470`) | 45: `0x80..0xAC` (table `0x800853C0`). Adds `AA changefx` (u8; ignored because `MusSetSongFxChange` is never called), `AB marker` (u8 id, var; no callback installed) and `AC` (fixed length := 0) |
| wave numbers (`81`) | pointer-bank index | index into the song's `waveTable` |
| tempo | `85` inside channel streams | master track. `85` applies to every channel of the song: `inc = trunc(trunc(bpm*24576/120)/60)` |
| velocity byte | plain `u8` | `b & 0x7F`; if `b & 0x80`, velocity mode turns off and the value becomes the fixed velocity |
| volume / bend streams | both gated by the bend timer (quirk) | separate timers |
| For/Next bend restore | unsigned byte (bug) | saved f32 |
| `A8` bend range | also sets bendVal² (sic) | bend = bendVal × range (default 1/32) |
| `8E` ignore transpose | cleared on pitch change | sticky |
| API | `MusBankStartSong(ptrBank, song)`; effects from a u32[512] table | `MusPtrBankSetCurrent` + `MusStartSong`; `MusFxBank*` fx banks |
| envelope | – | same phases; the step time is `t = (elapsedTicks * trunc(1024/speed)) >> 10`, evaluated every `speed` ticks |

Commands used by the 15 songs: `81 82 85 86 87 8B 8D 90 95 96 99 9C A2 A8 AA AC`.

**Loop rule:** every stream, including the master track, ends in `95 FF <body> 96`, and all bodies
have the same length P in ticks. The audio is periodic from L = the latest channel loop start (the
master track counts only if it has a tempo change inside its loop). The reference renderer outputs
ticks `[0, L+2P)` and sets loopStart/loopEnd to the sample positions of ticks L+P and L+2P, i.e. the
second pass, which already includes the release tails of the first. The game never stops a song:
`0x8005AC94` restarts it if `MusHandleAsk` reports it ended.

**"Adaptive audio"** (credits): on N64 this is volume only. There is one song per level, and no song
switching, markers, crossfades or tempo changes. The adaptive parts are:
- a fade-in on level load;
- a fade-out on warps and pause;
- **ducking** while Gex speaks. The voice-quip player `0x80058918` sets flag `[0x8010A40A] = 3`, and
  music state 3 lowers the song volume by target/6 per frame down to half. After 31 frames without
  speech it fades back over 30 frames.

The lip-sync tables use 12-byte rows of 48 two-bit mouth values; one value is consumed per 3 frames.
**HYPOTHESIS:** the credit describes the shared Crystal Dynamics (PlayStation) music system.

**Song list (Gex 3)** — all 15 songs are raw DEFLATE in ROM `0xD2D3C0..0xD52B60`, and all are
referenced. Reference WAVs are in `g3audio/wav/`; loop points are in `g3audio/wav/summary.json`.

| # | ROM | BPM | used by (level id, in-game title) | loop length |
|---|---|---|---|---|
| 0 | `0xD2D3C0` | 140 | 8 When Sushi Goes Bad | 120.1 s |
| 1 | `0xD2F340` | 132/155 | 7 Bean Stalker | 89.7 s |
| 2 | `0xD32A90` | 140 | bonus 11–15 (Gextreme Sports, True Grits, What a Crock!, Marsupial Madness, War and Pieces); secret 16, 18, 19 (Temple of Gloom, Cheesy Rider, The Abyssmal); bosses 20–22 (On the Ropes, Lions Tigers and Gex, Rez-Raker); intros 28, 29 | 96.0 s |
| 3 | `0xD34950` | 129 | hub areas 24 Lake Flaccid, 25 Slappy Valley, 26 Funky Town | 22.3 s |
| 4 | `0xD34F30` | 129 | hub 23 Mission Control | 22.3 s |
| 5 | `0xD35CE0` | 129/128 | 10 Superzeroes | 124.7 s |
| 6 | `0xD39060` | 107 | 1 Clueless in Seattle | 94.1 s |
| 7 | `0xD3B490` | 140 | 2 Holy Moses! | 130.3 s |
| 8 | `0xD3D080` | 102 | 27 title screen (fly77) | 18.8 s |
| 9 | `0xD3E440` | 114 | 4 The Organ Trail | 122.0 s |
| 10 | `0xD41760` | 138 | 6 Et Tu Gecko? | 90.3 s |
| 11 | `0xD44A20` | 87/103 | 9 My Three Goons | 79.2 s |
| 12 | `0xD47720` | 120 | 5 Cutcheese Island; secret 17 Peg Leg Polka | 108.0 s |
| 13 | `0xD4B290` | 155 | 0 Totally Scrooged | 123.7 s |
| 14 | `0xD4FEA0` | 125 | 3 War is Heck | 107.5 s |

Confirmed at runtime: level 3 → song 14 and level 17 → song 12 (attract demos). The rest follows
from the unconditional loader `0x8005AAE8(current level)`. Song 2's use on bonus, secret and boss
levels was **not** observed at runtime. Reference renderer: `g3audio/gex3music.ts` (`list | render
<i|all> | samples`); verifier `g3audio/verify_ram.ts`; song listings in `g3audio/songs/`.

## 7. Mapping to the viewer

### 7.1 Detection and game objects
- `src/rom/index.ts` `openRom()`: add `case 'NX2E'` (Gex 64) and `case 'NX3E'` (Gex 3) on the game
  code at ROM 0x3B, after `normalizeByteOrder()`.
- `src/rom/types.ts`:
  - extend `Game.id` with `'gex64' | 'gex3'`;
  - extend `LevelKind`, e.g. `'hub' | 'level' | 'bonus' | 'secret' | 'boss' | 'cutscene'`, and map
    §4 roles onto it. `LevelInfo.name` = in-game title (§4); `Level.id` = internal name.
- Suggested level list order:
  - Gex 64: channels in table order 0–24, then the hub (25); intro and logos can be omitted.
  - Gex 3: hub files 23–26, then TV levels 0–10, bonus 11–15, secret 16–19, bosses 20–22, and fly77
    (title) last.

### 7.2 Reusable modules
| existing module | reuse for Gex | changes needed |
|---|---|---|
| `inflate.ts` `inflateRaw` | every compressed file in both games (§3.1) | none (verified on Gex data) |
| `lzss.ts` | – | not used by Gex |
| `displaylist.ts` `runDisplayList` | world, material and object display lists (F3DEX 1.x for Gex 64, F3DEX2 for Gex 3) | see §7.3 |
| `texture.ts` | textures uploaded through `G_SETTIMG`/`G_SETTILE`/`G_LOADBLOCK`/`G_SETTILESIZE` in the material DLs | none expected; the Gex 64 level pass reports textures decode correctly with the existing code |
| `util.ts` `pruneUnused`, `emptyBounds` | level assembly | – |
| `music/rush1.ts` `decodeVadpcm`, `RESAMPLE_LUT` | libmus voices (§6.5) | export or move the loop preparation and voice mixer so they can be shared |

### 7.3 Display lists and coordinates (summary; details from the level passes in §5)
- **Addressing:**
  - Both games point RSP segments 1/2/3 at the level's vertex pool, material display lists and
    texture pool every frame.
  - World geometry in both games uses segmented addresses (Gex 64 chunk DLs; Gex 3 fragments, e.g.
    `01062050` = segment 1 + 0x62050). Other pointers in a level file are absolute (`0x8024B000`-based).
  - `ctx.resolve(addr)` must map segment 1/2/3 addresses to the pool offsets, and absolute KSEG0
    addresses to `addr − 0x8024B000`. For objects, it maps file-relative pointers (§3.2).
- **Handedness and axes:**
  - Both level passes report a right-handed, **+Z-up** world with **no X mirroring**. This is unlike
    Rush, where `displaylist.ts` negates X and assumes Y-up.
  - Make the vertex transform a context parameter (scale and axis mapping) instead of the hard-coded
    `-x/16`. Right-handed Z-up to right-handed Y-up is `(x, y, z) → (x, z, −y)`, which preserves the
    winding.
- **Culling:** both games cull back faces; front faces wind counter-clockwise as seen on screen.
- **Gex 64 specifics (from the level pass):**
  - Run a BSP leaf's chunks in **one** `runDisplayList` call, or pass in the vertex state, because
    chunks reuse vertices loaded by earlier ones.
  - Resolve segments 1/2/3 (world), 4 (sky) and 5 (per object, its texture pool), plus absolute
    `0x8024B000`-based pointers for chunk flipbook tables.
  - Honour a texture-only `G_SETCOMBINE` (the sky uses `FCFFFFFF FFFCF279`); today every batch is
    multiplied by vertex colour.
  - Batch settings: world flag-0 chunks `cullBack = true`; translucent chunks (flag bit 0) `blend`
    with culling off; objects and sky with culling off.
  - `texture.ts` needs no change.
- **Gex 3 specifics (from the level pass):**
  - world fragments have no `G_DL` and no `G_ENDDL`. For each material, build a synthetic list:
    `G_DL <material DL>`, then the concatenated commands of that material's type-A fragments, then
    `G_ENDDL`. Append it to the buffer and let `resolve` map that synthetic address range. This is
    what `g3lvl/ts/g3level.ts` `buildBatches()` does with the **unmodified** `runDisplayList`.
  - type-B fragments run with their special record's first DL.
  - use the first frame DL for animation records.
  - set `cullBackByDefault: true` for the world.
- **Not handled today:** `G_MTX`/`G_POPMTX`, `G_MOVEWORD`, fog and lighting commands. In both games these appear only in the frame lists built by code, never in level or object data, so static geometry doesn't need them. World
  geometry is stored in model space with identity transforms. Object models need the per-instance
  matrix built from the instance record, and must not rely on `G_MTX`.

### 7.4 New modules (suggested names)
| file | contents |
|---|---|
| `src/rom/gex/common.ts` | level-table readers for both games, object-table lookup, the relocatable loader (§3.2), and the address resolver for images linked at `0x8024B000` |
| `src/rom/gex/gex64.ts` | Gex 64 `Game`: level list (§4.1), level loader (§5, Gex 64 parts) |
| `src/rom/gex/gex3.ts` | Gex 3 `Game`: level list (§4.2), level loader (§5, Gex 3 parts) |
| `src/rom/gex/objects.ts` | object model format → `Mesh`; instance records → `Instance` |
| `src/rom/music/vadpcm.ts` | move `decodeVadpcm`, wave loop preparation, `RESAMPLE_LUT`, the voice mixer and the equal-power pan model out of `rush1.ts` so Rush and Gex share them |
| `src/rom/music/libmus.ts` | shared libmus pointer-bank, song and player port plus the mixer (§6); a revision switch for the Gex 64 and Gex 3 command sets |
| `src/rom/music/gex64.ts`, `src/rom/music/gex3.ts` | song tables → `MusicTrack[]` and `decodeMusic` |

`MusicTrack.name`: the level title(s) that use the song (§6.4 and §6.6), e.g. "Scream TV (Smellraiser,
Frankensteinfeld, …)". `DecodedMusic.loopStart/loopEnd`: from the For/Next loop detection (§6.5).
Jingles and one-shot songs have no loop.

### 7.5 Difficulty and risks (music; level parts in §5)
- **Music:** medium. Reference TypeScript implementations already exist (`g64audio/gex64music.ts`,
  `g3audio/gex3music.ts`) and match the game's player state exactly. Rendering a full looping song
  takes ~1 s of CPU per song, so render in the worker, one track on demand.
- **Risks:** reverb isn't rendered, so songs sound drier than in game. PCM loudness and rounding
  differences can't be checked by ear. Gex 64 levels with several songs (Toon TV, Circuit Central,
  Gecques Cousteau) switch between songs by area triggers, so list each song separately.

## 8. Verification evidence

Paths are relative to `/home/n64/.ai-tmp/r49/gex/`. The headless mupen64plus (debugger build) was
used for every running-game check; see `/home/n64/nviewer/EMULATOR.md`.

### 8.1 Filesystem and codec
| check | method | result | evidence |
|---|---|---|---|
| Gex 64 inflate, all streams | `g64extract.py --selftest`: pure-Python RFC 1951 inflater vs zlib | 767 streams (31 levels, 735 objects, common blob), 0 mismatches | `g64fs/g64extract.py`, `g64fs/files/index.json` |
| Gex 64 level data vs RAM | extracted `map5` and `looney30` vs RDRAM at `0x8024B000` after the in-game load (`g64fs/tools/verify_ram.py`) | map5: 1,064,000/1,064,000 bytes equal outside the two tables `FixupLevel` patches; looney30: 29 differing bytes, all runtime state | `g64fs/ram/map5_hub.bin`, `g64fs/ram/looney30_outoftoon.bin` |
| Gex 64 relocatable objects vs RAM | the 10 persistent objects rebuilt from files (reloc applied at their load addresses) | 171,645/171,664 bytes equal (only `DATA+4..5`, a runtime field) | same dumps |
| Gex 3 inflate vs RAM | exec breakpoint `0x800315C8` just after the level inflate; dump and `cmp` | opening1 (15,288 bytes) and fly77 (729,776 bytes) byte-identical | `g3fs/d/opening1_fresh.bin`, `g3fs/d/fly77_fresh.bin` |
| Gex 3 objects vs RAM | relocated objects located in an intro RAM dump | 20 of 25 byte-exact, the rest differ by a few runtime bytes | `g3fs/d/intro.bin` |
| viewer `inflate.ts` | `coord/inflate_check.ts` with the repo's `tsx` | Gex 64 map5 and Gex 3 gexcave6 identical to zlib | `coord/g64_map5.bin`, `coord/g3_gexcave6.bin` |
| Gex 3 DMA trace | breakpoints on PI DMA starts during boot, intro, title and anime1 | every table-listed file range read as expected; no read of ROM `0x1A92090..0x1D3B030` in those scenes (it is Agent Xtra video, read by the Mission Control overlay; §10) | `g3fs/dma_boot.txt` |
| level warps | debugger recipes (§4 notes; `notes/g64_fs.md` §6.2, `notes/g3_fs.md` §9) | loads the requested level normally | `g64fs/shots/looney30_out_of_toon_warp.png`, `g64fs/shots/scifi10_umpire_strikes_out_warp.png`, `g64fs/shots/map5_hub_newgame_start.png`, `g3fs/shots/warp_lvl23_gexcave6_mission_control.png`, `g3fs/shots/warp_lvl08_anime1_when_sushi_goes_bad.png` |

### 8.2 Music (Gex 64)
| check | method | result |
|---|---|---|
| player port vs game | `g64audio/verify.ts` compares, for every song channel, data pointer, channel time, next-note time, wave, voice flag, envelope phase and value, volume, pan, last `alSynSetVol` value and velocity against RAM | **16/16 channels identical** at 3 snapshots: title song frames 101 and 1484, Gecques Cousteau frame 1882 (dumps `g64audio/run/t1_*.bin`, `t2_*.bin`, `r_*.bin`) |
| song selection | live: title menu (level 25) and a warp to rta1 | title plays `0x4931C0`; rta1 loads `horrormx.wbk` with slots `0x41B390`/`0x41CA80`, slot 0 at volume 96, tempo 256 |
| table order | libmus state in the fs agent's dumps | hub slot 0 = `0x4931C0`; Out of Toon slots 0..4 in table order, current slot 1 at volume 112 (the first-entry fade quirk) |
| static | all 23 DEFLATE songs inflate; every wave index fits its bank; every command byte has a handler | pass |
| rendered audio | `g64audio/wav/*.wav` (27 songs + `index.json` with loop points) | **not** compared with real game audio (no audio output headless); reverb not rendered |

### 8.3 Music (Gex 3)
| check | method | result |
|---|---|---|
| player port vs game | `g3audio/verify_ram.ts` runs the port to the dump's song time and compares 23 fields of every channel | **all 15 music channels identical** in 3 dumps: war01 song 14 at tick 280 (`g3audio/run/r80080.bin`), push44 song 12 at ticks 197 and 1408 (`r2.bin`, `r3.bin`) |
| engine parameters | RDRAM | output rate 22047 Hz (ALSynth `0x8010A120+0x44`); 28 channels; tick 0x411A us; master volumes `0x31FE`/`0x1FFF`; music pointer bank at `0x800D1E80` relocated with `detune[0]` = −47.43 as predicted; song at `0x800FF290` equal to the inflated ROM song |
| song selection | attract demos | level 3 → song 14, level 17 → song 12 |
| static | all 15 songs inflate; every stream parses to one `95 FF..96` loop with equal body lengths; every wave index fits its bank; 31 PtrTables/WaveTables pairs, all referenced | pass |
| rendered audio | `g3audio/wav/gex3_songNN_*.wav` (gain 7, no clipping) + `summary.json` | **not** compared with real game audio; reverb is off in game anyway; state past a loop point not checked in RAM |

### 8.4 Level geometry (Gex 64)
Method: the level pass took an in-game screenshot and an 8 MiB RDRAM dump at the same moment, with Gex
standing still. It read the game's projection, modelview and fog from the frame's display list in RAM,
and rendered the level file with its proof-of-concept TypeScript renderer (`g64lvl/g64render.ts`, using
the viewer's `displaylist.ts` and `texture.ts`) from that camera.

| level | screenshot + dump | render(s) | result |
|---|---|---|---|
| looney30 Out of Toon | `g64lvl/shots/looney30_start_A.png` + `g64lvl/ram/looney30_A.bin` | `g64lvl/renders/final_looney30_ramcam.png`, `looney30_ramcam_all.png`, `looney30_objects_A.png` | **matches**. Coordinator viewed both: same layout, handedness (tree trunk left, signpost centre, flower bushes both sides, palm plant right), textures and clear colour. Missing only Gex and a code-spawned collectible, as expected. Culling test: `looney30_ramcam_f0_cullback.png` (opposite rule removes the ground) vs `_f0_cullfront.png` |
| map5 Media Dimension hub | `g64lvl/shots/map5_hub_start_A.png` + `g64lvl/ram/map5_A.bin` | `final_map5_ramcam.png`, `map5_objects_A.png`, `final_map5_overview.png` | matches in layout per the level pass. Known differences: a stray white quad on the floor, and the hub's big blue crystal renders as a small purple object |
| kungfu4 Lizard in a China Shop (bonus) | `g64lvl/shots/kungfu4_start_A.png` + `g64lvl/ram/kungfu4_A.bin` | `final_kungfu4_bonus_ramcam.png`, `kungfu4_sky_objects_A.png` | **layout, objects and handedness match** (coordinator viewed: lantern poles, "Sushi" sign, building right). **Differences:** the sky backdrop shows dock-like silhouettes where the game shows pagoda roofs, and the front wall texture differs (brick-like vs wooden fence). HYPOTHESIS: wrong sky sector/UV selection and a flipbook/animated material frame |
| scifi10 The Umpire Strikes Out | `g64fs/shots/scifi10_umpire_strikes_out_warp.png` | `final_scifi10_start.png` (free camera, flipbook frame 0, starfield sky) | similar view (free camera, not frame-exact) |
| gillig1 Gilligex Isle (boss) | – | `final_gillig1_boss_overview.png` | overview only; its 19 sky records do not show in the render (unresolved) |

Texture contact sheets: `g64lvl/renders/*_textures.png` (with `.txt` listings). Frame checks: every
`G_DL` into the level blob in the looney30 frame targets a flag-0 chunk of a visible leaf (273 calls,
64 leaves). The fog moveword `BC000008 5355ADAB` equals the formula from hdr+0x52. The instance
rotation order was checked against 4 actor pose matrices in RAM (error ≤ 0.0004).

### 8.5 Level geometry (Gex 3)
Method: the same as Gex 64. The level pass took an RDRAM dump and an in-game frame from the same
moment. It read the view and projection matrices (`DA38…` commands) from the frame DL in RAM, and
rendered the level file with `g3lvl/ts/g3level.ts`, which uses the viewer's `displaylist.ts` and
`texture.ts`.

| level | screenshot + dump | render(s) | result |
|---|---|---|---|
| 23 gexcave6 Mission Control | `g3lvl/shots/hub_gexcave6_game_frame_of_ramdump.png` + `g3fs/ram/hub_gexcave6.bin` | `g3lvl/renders/gexcave6_gamecam.png`, `gexcave6_gamecam_with_objects.png` | **matches.** The coordinator viewed both: same layout, the "LAKE FLACCID" sign reads correctly (no mirroring), the Agent Xtra monitor sits above the console, same console panels and textures. The render also shows a purple paw box and a black cube that are not visible in game (state-dependent objects). Culling test: `test_hub_cullback.png` vs `test_hub_cullfront.png` |
| 8 anime1 When Sushi Goes Bad | `g3lvl/shots/anime1_game_frame_of_ramdump.png` + `g3fs/ram/lvl08_anime1.bin` | `anime1_gamecam.png` | **matches** (coordinator viewed: ledge on the left, door pillars, red grid wall, floor tiles). Objects are not in this world-only render |
| 22 endboss1 Rez-Raker | `g3lvl/shots/endboss1_game_frame_of_ramdump.png` + `g3lvl/ram/lvl22_endboss1.bin` | `endboss1_gamecam.png`, `endboss1_sky_gamecam.png` | **matches** (coordinator viewed: shuttle orientation and textures; the sky render uses the same starfield texture as the game). Objects (satellites, characters) are not in the world render |
| 0 snow96 Totally Scrooged | `g3lvl/shots/snow96_game_frame_of_ramdump.png` + `g3lvl/ram/lvl00_snow96.bin` | `snow96_gamecam.png`, `snow96_sky_gamecam.png`, `snow96_sky_panorama.png` | world matches per the level pass. The sky patches (clouds) render, but the matching screenshot shows no sky area, so the sky could not be compared there |
| level-select cheat | `g3lvl/shots/cheat_select_level_page_endboss1.png` | – | confirmed in the emulator: pause-menu "SELECT LEVEL" page showing REZ-RAKER |
| Agent Xtra video region | – | `g3lvl/renders/unknown_region_CI4_frames_every16.png`, `blk820_CI4_64x64.png` | coordinator viewed: 64×64 talking-head frames with TV-static frames between clips; the channel-logo sheet decodes as 64×64 CI4 |

Texture contact sheets: `g3lvl/renders/sheet_{gexcave6,anime1,snow96,endboss1}.png`. Frame checks:
- The hub frame list emits 72 material groups; each is `DE000000 <material DL>` followed by a verbatim
  copy of the fragment commands.
- The fog moveword `DB080000 476DB993` and the clear colour `F7000000 053F053F` (snow96) equal the
  header-derived values.
- Frame DL opcode histograms: `g3lvl/hub_top.txt`, `anime_top.txt`, `snow_top.txt`, `endboss_top.txt`.

### 8.6 Emulator hygiene
Every run used its own run directory `<agent>/run` under `/home/n64/.ai-tmp/r49/gex/`. At the end,
`pgrep -a mupen64plus` and `ps -ef | grep -E 'headless|mupen'` showed no process under
`/home/n64/.ai-tmp/r49/gex/`, and every run-dir pid had exited.

## 9. Open questions and unknowns

Everything in this section is unverified. Items are **HYPOTHESIS** unless stated otherwise.

Filesystem and level lists:
- **Gex 64:** the hub unlock/progression order was not traced; table order 0..13 is assumed to be the intended progression.
- **Gex 64:** the meaning of ROM `0x49BA00-0x49D870` (loaded to `0x800E6010` during audio init; not music data) is unknown.
- **Gex 3:** the fields at level record `+0x0A`, `+0x14..+0x1A` and `+0x30` are not decoded. The upper bytes of `+0x34` are unknown (fog colour is in the level header, §5.3).
- **Gex 3:** the invulnerability button code comes from static analysis only. The level-select code
  was confirmed in the emulator by the level pass (§10).

Levels:
- **Gex 64:** skeletal animation data (object +0x10) is not decoded, so only rest poses are available,
  and Gex himself needs the common blob's skeleton.
- **Gex 64:** chunk flag-4/5 records (animated texture, probably water or lava), the vertex-colour
  animation list at header +0x0C, and header +0x60/+0x78/+0x8C and scene +0x50/+0x64/+0x78 (possibly
  event or camera scripts) are not decoded.
- **Gex 64:** gillig1's 19 sky records don't appear in the reference render. kungfu4's rendered sky
  shows different silhouettes from the game, and its front wall texture differs (§8.4). Both are
  unresolved.
- **Gex 64:** chunk flags 5/7 without a material were never drawn in the analysed frames; they are
  assumed to be collision-only or special surfaces.
- **Gex 3:** the rotation order of the three instance angles is not proven (only Z was checked).
  Multi-segment (skinned) object meshes and animations are not decoded.
- **Gex 3:** header +0x54 is assumed to be the draw distance or far plane. The per-leaf aux records
  and the procedural material kinds 4/6/8 are not decoded. 2–4 fragment lists per level fail to parse.
- **Gex 3:** level record `+0x0C` skips 0x0D among the TV levels; it may be a cut 12th TV level. The
  hub TV record field `a` is assumed to be the remote count needed.
- **Gex 3:** the 540 unreferenced materials may partly be drawn by overlay code (not scanned).

Music:
- **Gex 3:** song 2 on the bonus, secret and boss levels was not observed at runtime; the mapping rests
  on the unconditional per-level loader. Player state past a loop point was not compared with RAM.
- **Gex 64:** the meanings of jingles 1–3 (jingle 4 is probably the red remote) and of the trigger-list
  `kind`/`id` values (assumed area/zone events) were not traced. Whether intro1 and the logos start
  music from overlay code is unknown (they load the CIRCUIT songs with autostart off).
- **Gex 64:** one player tick = 367 output samples is assumed from libultra rounding; it was verified
  for Gex 3 only.
- **Both:** the rendered PCM could not be compared with real game audio (no audio output from the
  headless emulator). Reverb is not rendered (Gex 64 configures a reverb bus; in Gex 3 it is off). The
  volume-squaring, ramp shape and Gex 3 dry-gain factor follow libultra behaviour rather than the games'
  own mixer code. PAL (50 Hz) timing is untested.

## 10. Unused or hidden content

Findings from the filesystem, level and music passes (evidence column says how each was established):

| game | what | where | evidence it is unused / hidden |
|---|---|---|---|
| Gex 64 | 6th attract-demo slot | demo pointer table `0x8006CF68` has 6 pointers (6th = ROM `0x49B600`); demo level table `0x8006CF98` has a 6th value 26 (`intro1`) | the demo counter wraps at 5 (`0x8001A898: sltiu v0,5`), so slot 6 is never played; ROM `0x49B600-0x49BA00` is zero or small data |
| Gex 64 | no debug menu or cheats found | main code, overlays, strings (`g64fs/strings_all.txt`) | string and button-mask table scans found nothing. There is a password system (strings "see password", "PASSWORD IS" in the map5 overlay). Codes built from combined input logic were not traced |
| Gex 64 | every table level is reachable | hub file `map5` offset `0x13C60..0x13D80` | the hub holds one warp record for each of the 25 playable levels (0..24); intro and logos are entered from code |
| Gex 3 | *(not unused)* ROM `0x1A92090-0x1D3B030`, 2.7 MiB | Agent Xtra talking-head video, 1,341 frames x 0x820 bytes (64x64 CI4 + palette) | the filesystem pass flagged it as unreferenced (no table points to it, not read during boot/intro/title/anime1). The level pass found the Mission Control overlay reads it as base + frame x 0x820, with clips starting at frames 0, 402, 644, 900 and 1158. Sheet: `g3lvl/renders/unknown_region_CI4_frames_every16.png` |
| Gex 3 | **debug level select in retail** | pause, hold R, press B A B Z C-left C-right C-up Z (button table `0x800809D0`, checker `0x8002B360`) | opens pause-menu page 28 "select level" (handler `0x800370FC`, ids 0..26). **Confirmed in the emulator** by the level pass. Page 29, the "sound effects" / "level specific effects" test (`0x8003728C`), is opened from the pause options/stats/save-game menu (`0x80036E80`), so it is probably a normal menu page (not fully traced). Screenshot: `g3lvl/shots/cheat_select_level_page_endboss1.png` |
| Gex 3 | invulnerability code | pause, hold R, press C-up C-left B A C-down C-right C-up Z (table `0x800809E0`) | sets bit 0x400 in `0x800A55C4`; `0x8003F328` then skips the damage. Static analysis only |
| Gex 3 | debug font and camera | object `dbgfont_` (loaded in every level), string `dbg_cam_`, "start key, tween: %d, %d" | debug assets and strings left in retail |
| Gex 3 | skipped category slot | level record `+0x0C` runs 5..0x10 over the 11 TV levels with 0x0D missing | HYPOTHESIS: a cut 12th TV level slot |
| Gex 3 | no orphan files | all 30 level records, 29 audio banks and 963 objects | every object name occurs in at least one level file, overlay or main code (711 are used by exactly one level) |
| Gex 64 | **unreferenced song** | ROM `0x47B670-0x47CCB0` (DEFLATE → 10,173 bytes; 17 channels, 140 BPM, 123.5 s loop) | not referenced by the level audio table, the jingle table or any code/data constant; `0x47B670` occurs only as the *end* of the Pre-History song. It sits between the Pre-History song and REZOP.WBK. Bank HYPOTHESIS prehismx.wbk: 0 notes exceed the pitch cap with it (8..15 with any other bank), and it uses 6 prehismx waves (2, 6, 13, 14, 15, 18) no referenced song uses. Likely a cut second Pre-History Channel track. Rendered: `g64audio/wav/47b670_UNUSED_prehistory_b.wav` |
| Gex 64 | unused sample waves | orchestr.wbk 1 2 4 6 11 14 17 18 41 44 45 46 47 52 70 72; CIRCUIT.WBK 0 10; KungFu.wbk 16 17; NYPD.wbk 0 1 3 6 13; prehismx.wbk 1 4 8 17; REZOP.WBK 11-15; EXTRAS.WBK 4 5 7; gexsfx.wbk 69 74 78 82 85 88 95 100 122 215 218 221 229 233 254 255 261 304 | static scan: no song's `0x81` command and none of the 512 sound effects select them |
| Gex 64 | unterminated music trigger list | rta1 trigger list `0x8006F4B0` | no terminator, so the scan runs into the song-range data at `0x8006F4C8` (latent bug) |
| Gex 64 | unused libmus features | `MusBankStartEffect(2)`, `MusHandleSetPan`, `SetFreqOffset`, `SetTempo`; song commands 83 84 86 88 89 8C 8E 91-94 98 9D 9E A0 A1 A3-A7 | no callers / not used by any song |
| Gex 3 | unused music samples | music pointer-bank indices 61, 64, 160, 178, 179, 203, 219, 268, 274, 276, 287 (36,828 of 1,366,974 wave bytes) | referenced by no song `waveTable`, and no song uses drum maps. Exported: `g3audio/wav/unused/music_sample_NNN_romXXXXXX.wav` |
| Gex 3 | SFX pointer-bank entries missing from their fx bank | global 53; snow96 38; war01 18, 26; myth64 30; anime1 44; gexcave7 17 | not in the fx bank's `waveTable`, so no effect can play them (static scan) |
| Gex 3 | ignored effects change in a song | the Egypt song (song 7) master track contains `AA 02` | `MusSetSongFxChange` is never called, so the command does nothing |
| Gex 3 | unused libmus features | `MusStartSongFromMarker`, `MusStartEffect`, `MusHandleSetPan/SetFreqOffset/SetTempo/SetReverb/Pause`, `MusSetMarkerCallback`, `MusSetSongFxChange`; song commands 80 83 84 88-8A 8C 8E 8F 91-94 97 98 9A 9B 9D-A1 A3-A7 A9 AB | no callers or occurrences |
| both | no orphan songs or banks in Gex 3 | every PtrTables/WaveTables pair and all 15 songs are referenced | static scan (Gex 64's orphan song is listed above) |
| Gex 64 | **12 objects never referenced** | `bridgex_ bubsnd__ mwfly___ sprkshr_ zblockb_ zfisha__ zjumpb__ zmylot__ zweed___ zweeda__ zweedb__ zweedc__` (object table ROM `0x745F0`) | named in no level's object list (hdr+0x40) and nowhere in main code, overlays, other objects or the common blob (`g64lvl/object_refs.json`) |
| Gex 64 | **debug camera object** `dbg_cam_` | object file in the table (has face-list geometry) | in no level list and placed by no instance; only reference is its name string in main data at ROM `0x7E2B0` |
| Gex 64 | 8 object names with no file | `shadow3_ archmon_ colc____ sphere__ box_____ xing____ newfaces dbgfont_` in level name lists (e.g. `dbgfont_` in logo4, `newfaces` in rezop3) | the loader finds no table entry and silently skips them: removed debug/test assets |
| Gex 64 | loaded but never placed | 168 objects in level name lists with no instance | mostly spawned by code (remotes, effects, HUD); not necessarily unused (`g64lvl/object_placements.json`) |
| Gex 64 | unreferenced world materials | 29 of 3,001: horror4 3, scifi14 8, kungfu1 10, horror6 2, spy2 1, circuit0 5 | referenced by no chunk, sky DL or flipbook table |
| Gex 64 | no cheat input found (second search) | – | the level pass also searched pad-bit tests in code: only HUD/menu uses of L and Z, plus the password screen (map5 overlay, button table `0x80161160`). HYPOTHESIS: any cheats are special passwords |
| Gex 3 | **540 unreferenced material entries** | 540 of 4,529 material-table entries in 27 levels, e.g. clue1 53, gtown2 55, hub 43; none in war01, push44, wwgex1 (`g3lvl/unused_materials.txt`) | referenced by no fragment, sky DL, special record or animation record. **Caveat:** per-level overlay code was not scanned, so some of these textures may still be drawn by code |
| Gex 3 | placed but hidden objects | hub (gexcave6) instances such as a purple paw box, a black cube and a red paw icon | render in the placement render (`g3lvl/renders/gexcave6_gamecam_with_objects.png`) but are absent from the game frame (`g3lvl/shots/hub_gexcave6_game_frame_of_ramdump.png`). HYPOTHESIS: shown only in certain game states or missions (instance +0x0E) |
| Gex 3 | logic-only instances | 331 instances with name index −1 | no object; HYPOTHESIS: triggers, cameras, spawn points |
| both | no orphan level or object files | every Gex 3 table object is named somewhere; Gex 64 has the 12 orphans listed above | static reference scans |
