# Gex 64: Enter the Gecko — Nintendo 64 ROM format specification

This manual describes the shipped data formats needed to identify, extract, and
present Gex 64: Enter the Gecko content. Claims state their evidence inline; unsupported
interpretations are labelled hypotheses.

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | Level table, relocatable named objects, and one code overlay per theme. |
| Compression | Headerless RFC 1951 DEFLATE. |
| Graphics microcode | F3DEX 1.23. |
| Geometry | Pointer-based level mesh and object records. |
| Textures | Primarily CI4 with RGBA16 TLUTs; some CI8 and RGBA32. |
| Collision | Dedicated collision records in each level file. |
| Music driver | Nintendo Sound Tools libmus. |
| Audio microcode | **Unknown** |
| Sample encoding | Nintendo VADPCM. |
| Levels | 31 level-table entries. |
| Memory requirement | Expansion Pak. |
| Viewer support | USA revision 0. |

### 1.2 ROM identification

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| USA | `GEX: ENTER THE GECKO` | `NX2E` | 0 | 16 MiB (`0x1000000`) | `89FED774` | `CAAFE21B` | `16042cd0dfa5439ca436f1bf05ebfb7e9f730cda` | CIC-6102 | — |
| Europe | `GEX: ENTER THE GECKO` | `NX2P` | 0 | 16 MiB (`0x1000000`) | `E68A000E` | `639166DD` | `c5318e2660fed61782bb170e780b89305aa8c3dc` | CIC-6102 | — |

Verified from the normalized ROM headers and complete-image SHA-1 hashes.

### 1.3 Terminology and conventions

ROM and memory ranges are half-open. Offsets, addresses, encoded sizes, masks,
and opcodes are hexadecimal unless stated otherwise. Multi-byte CPU fields are
big-endian. RAM addresses are virtual unless explicitly identified as physical;
segmented, VROM, and file-relative addresses are named at each use.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

#### Boot and code

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

### 2.2 Memory and address mapping

Address conversions and load destinations are specified with the executable and file tables above.

### 2.3 ROM map and asset organization

#### Filesystem and compression: ROM maps

**Gex 64** (16 MiB, all regions accounted for):

| ROM | contents |
|---|---|
| `0x000000-0x001000` | header, IPL3 (CIC-6102) |
| `0x001000-0x07FF40` | main code + data (level table `0x708E0`, object table `0x745F0`, info table `0x78EA8`) |
| `0x07FF40-0x0ED0F0` | 18 level code overlays |
| `0x0ED0F0-0x0EF120` | inflate overlay |
| `0x0EF120-0x102A90` | audio pointer bank "N64 PtrTablesV2" (read to `0x800D1820`) |
| `0x102A90-0x386450` | audio wave data (streamed from ROM; base stored at `0x800C5914`) |
| `0x386450-0x49A200` | music: 8 pointer/wave bank pairs, DEFLATE level songs stored after their banks, EXTRAS bank and 4 raw jingles `0x497E00..0x49A200` (level audio table `0x8006F5A8`, *Gex 64 locations and tables (verified)*) |
| `0x49A200-0x49B600` | 5 attract-demo controller recordings (0x400 each) |
| `0x49B600-0x49BA00` | zero / unused 6th demo slot (*Unused or hidden content*) |
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
| `0x0D2D3C0-0x0D52B60` | 15 DEFLATE level songs (record +0x4C/+0x50, *Gex 3 specifics (verified by disassembly and RDRAM unless marked)*) |
| `0x0D52B60-0x0D53F60` | per-level 0x310-byte lip-sync tables (record +0x38); a global 0x340 table at `0xD53180` |
| `0x0D53F60-0x158E1B0` | 30 level data files (DEFLATE), sorted by name |
| `0x158E1B0-0x159C4C0` | `gex_____` player object |
| `0x159C4C0-0x1A92090` | 963 object files |
| `0x1A92090-0x1D3B030` | Agent Xtra talking-head video: 1,341 frames of 0x820 bytes (64x64 CI4 + palette), addressed by the Mission Control overlay as base + frame x 0x820 (*Unused or hidden content*). No table entry points here |
| `0x1D3B030-0x1D43230` | per-level 0x820-byte blocks (record +0x3C): 64x64 CI4 TV channel logos (same frame format as the video) |
| `0x1D43230-0x2000000` | zero padding |

### 2.4 Compression formats

#### Filesystem and compression: Compression: raw DEFLATE (both games, verified)

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
identical outside the two tables the loader patches (see *Verification evidence*).

#### Filesystem and compression: Extracting every file

1. Normalise byte order (existing `normalizeByteOrder`).
2. Level files: iterate the level table (*Level tables*); inflate `[start, end)` (Gex 64 `+0/+4`, Gex 3 `+0x1C/+0x20`).
   The result is a flat image **linked at `0x8024B000`**: every pointer inside is an absolute address,
   so `fileOffset = ptr − 0x8024B000`. There is no relocation table.
3. Object files: iterate the object table until a zero name byte; inflate and apply *Relocatable file format (objects and the player model; both games, verified)*.
4. Player model: Gex 64 ROM `0x49D870..0x4B5750`, Gex 3 ROM `0x158E1B0..0x159C4C0`; inflate, *Relocatable file format (objects and the player model; both games, verified)*.
5. Code overlays and audio regions are plain ROM ranges.

Reference extractors (Python, stdlib only): `g64fs/g64extract.py [ROM] [OUTDIR]` (with
`--selftest`, which cross-checks a pure-Python inflater against zlib) and `g3fs/g3extract.py [ROM]
[OUTDIR]` (1,079 files). Both write an index (`index.json` / `index.tsv`) with ROM ranges and sizes.

#### Verification evidence: Filesystem and codec

| check | method | result | evidence |
|---|---|---|---|
| Gex 64 inflate, all streams | `g64extract.py --selftest`: pure-Python RFC 1951 inflater vs zlib | 767 streams (31 levels, 735 objects, common blob), 0 mismatches | `g64fs/g64extract.py`, `g64fs/files/index.json` |
| Gex 64 level data vs RAM | extracted `map5` and `looney30` vs RDRAM at `0x8024B000` after the in-game load (`g64fs/tools/verify_ram.py`) | map5: 1,064,000/1,064,000 bytes equal outside the two tables `FixupLevel` patches; looney30: 29 differing bytes, all runtime state | `g64fs/ram/map5_hub.bin`, `g64fs/ram/looney30_outoftoon.bin` |
| Gex 64 relocatable objects vs RAM | the 10 persistent objects rebuilt from files (reloc applied at their load addresses) | 171,645/171,664 bytes equal (only `DATA+4..5`, a runtime field) | same dumps |
| Gex 3 inflate vs RAM | exec breakpoint `0x800315C8` just after the level inflate; dump and `cmp` | opening1 (15,288 bytes) and fly77 (729,776 bytes) byte-identical | `g3fs/d/opening1_fresh.bin`, `g3fs/d/fly77_fresh.bin` |
| Gex 3 objects vs RAM | relocated objects located in an intro RAM dump | 20 of 25 byte-exact, the rest differ by a few runtime bytes | `g3fs/d/intro.bin` |
| viewer `inflate.ts` | `coord/inflate_check.ts` with the repo's `tsx` | Gex 64 map5 and Gex 3 gexcave6 identical to zlib | `coord/g64_map5.bin`, `coord/g3_gexcave6.bin` |
| Gex 3 DMA trace | breakpoints on PI DMA starts during boot, intro, title and anime1 | every table-listed file range read as expected; no read of ROM `0x1A92090..0x1D3B030` in those scenes (it is Agent Xtra video, read by the Mission Control overlay; *Unused or hidden content*) | `g3fs/dma_boot.txt` |
| level warps | debugger recipes (*Level lists* notes; `notes/g64_fs.md` *Sample banks (both games)*, `notes/g3_fs.md` *Open questions and unknowns*) | loads the requested level normally | `g64fs/shots/looney30_out_of_toon_warp.png`, `g64fs/shots/scifi10_umpire_strikes_out_warp.png`, `g64fs/shots/map5_hub_newgame_start.png`, `g3fs/shots/warp_lvl23_gexcave6_mission_control.png`, `g3fs/shots/warp_lvl08_anime1_when_sushi_goes_bad.png` |

### 2.5 Loading process

Level and asset selection is described by the tables and loader call paths above.

### 2.6 Revision differences

Revision-specific addresses and data differences are stated in the relevant tables.

## 3. Level data

### 3.1 Level catalog and identifiers

#### Level lists: Gex 64: Enter the Gecko (31 table entries; names verified from the info table)

The hub is the **Media Dimension** (`map5`), whose TV gates warp by name. Order below is the table
order, which is also the order of the info table; the unlock order in the hub was **not traced**
(hypothesis: 0..13 is the intended progression).

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
DEFLATE file; see *Level format* for areas inside a file. Attract demos play horror4, circuit5, rezop3, scifi10,
prehst2 (table `0x8006CF98`). Suggested viewer list: 0–24 grouped by channel, then the hub (25);
26–30 contain almost no geometry.

### 3.2 Level container

#### Filesystem and compression: Relocatable file format (objects and the player model; both games, verified)

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

#### Filesystem and compression: Level tables

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
      (hypothesis: mission count)  +0x30 u32 address inside the overlay (hypothesis: entry/init)
+0x0C u16 category/slot: TV 5..0x10 +0x34 u32; low byte (+0x37) = first level-local voice-clip SFX id (*Gex 3 specifics (verified by disassembly and RDRAM unless marked)*)
      (0x0D unused), bosses 0x11-0x13, +0x38 u32 ROM of 0x310 raw bytes -> 0x800FEE48 (lip-sync timing; 0 = none)
      bonus 0x14, secret 0x15, 0 other +0x3C u32 ROM of 0x820-byte 64x64 CI4 channel logo -> 0x801FF7E0 (0 = none)
+0x0E u16 x3 string ids: mission names +0x40 u32 ROM "N64 WaveTables" (level sample bank)
+0x14 u16 x4 unknown                +0x44 u32 ROM "N64 PtrTablesV2" (level bank pointer table)
                                    +0x48 u32 ROM level sound table (0xB40 bytes -> 0x800CFD20)
                                    +0x4C u32 / +0x50 u32 ROM range of the DEFLATE level song -> 0x800FF290
```
String table: `char*[242]` at `0x80080110` (getter `0x800260A0`). Level lookup by name: `0x8004FF54`.
Pointers in the table are main-image addresses (convert with ROM = vaddr − `0x7FFFF400`).

#### Level format: Shared structure (both games)

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
- **Objects** are separate relocatable files (*Relocatable file format (objects and the player model; both games, verified)*), named in a list in the level header and placed
  by fixed-size instance records: Gex 64 uses 48 bytes, Gex 3 uses 0x34 bytes. Object textures use
  segment 5 in both games.
- **Fog and clear colour** come from the level header. **Skies** are stored in the level file as
  camera-relative display lists: both games put the sky
  vertex pool in segment 4 (header +0x28).

#### Level format: Gex 64 level file (verified unless marked)

Offsets below are into the decompressed level file (`g64fs/files/levels/NN_name.bin`); examples use
looney30.

**Header** (the fields a viewer needs; others in `notes/g64_level.md` *Unused or hidden content*):
```
+0x00 ptr   scene struct (0x40 bytes)
+0x0C ptr   vertex-colour animation list (flickering lights; hypothesis layout) — use file colours
+0x20 u32   sky record count          +0x24 ptr sky records (16 bytes)    +0x28 ptr sky Vtx pool (segment 4)
+0x2C s16 x,y,z  player start
+0x40 ptr   object-name list: u32 n, then n x char[8]   (the loader patches it into object pointers)
+0x48 u8 r,g,b   clear colour AND fog colour
+0x52 u16   fog min (gSPFogPosition min; >= 1000 -> 980), fog max = 1000
+0x7C u32   instance count            +0x80 ptr instance array (48-byte records)
+0x90..+0x9C, +0xA4  ptrs to 12-byte names (theme/music/sky names, e.g. "looney", "carrot")
scene: +0x00 ptr render-BSP root   +0x10 u32 instance count  +0x14 ptr instances (= hdr+0x7C/+0x80)
       +0x18 u32 vertex count   +0x1C u32 collision face count   +0x20 u32 normal count   +0x24 ptr vertex pool (segment 1)
       +0x28 ptr collision faces (*Gex 64 collision (verified on all 31 level files unless marked)*)   +0x2C ptr normals (6-byte s16 4.12)
       +0x34 ptr instance BSP (*Gex 64 collision (verified on all 31 level files unless marked)*; not collision)   +0x38 ptr material DLs (segment 2)   +0x3C ptr texture pool (segment 3)
```
Segments are set by `0x8002BBFC` each frame: `BC000406 {seg1}`, `BC000806 {seg2}`, `BC000C06 {seg3}`,
`BC001006 <hdr+0x28>` (F3DEX 1.x `G_MOVEWORD`).

**Render BSP** (24-byte nodes, from `scene+0x00`):
```
+0x00 s16 cx, cy, cz; u16 radius    bounding sphere of the node
+0x08 u16 kind                      1 = interior, 2 = leaf
interior: +0x0A s16 planeIndex (into scene+0x2C; negative = negated normal)
          +0x0C s32 distance   +0x10 ptr childA   +0x14 ptr childB
leaf:     +0x0A u16 collisionFaceCount   +0x0C ptr first collision face of the leaf (*Gex 64 collision (verified on all 31 level files unless marked)*)
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
| bit 1 | **flipbook**: `extra` points to `{u16 period; u16 count; ptr materialDL[count]}`, and the chunk has no material G_DL of its own. Use frame 0, or cycle with `frame = (time / period) % count` (hypothesis timing) |
| bit 2 without bit 1 (flags 4/5) | animated-texture record (probably water or lava drawn by special code; layout hypothesis, `notes/g64_level.md` *Open questions and unknowns*). No material; not drawn in the analysed frames |

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
- hdr+0x20 count, hdr+0x24 records `{u32 0; s16 dx, dy (hypothesis: sector direction); u32; ptr DL}`;
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
+0x0E s16 variant (hypothesis)
+0x10 s16 x, y, z  world position     +0x16 u16 activation radius
+0x18 u16, +0x1A u16 (hypothesis: behaviour parameters)   +0x1C u32 flags
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

Class meanings are hypothesis; they are inferred from names.

**Multi-area:** none. Each file has one render BSP; bonus rooms and bosses are separate level files.

**Pitfalls found:**
1. Chunks share vertex state within a leaf.
2. Chunk flags 2 and 4 carry material through `extra`, not a G_DL.
3. The sky needs a texture-only combine; the viewer currently always multiplies by vertex colour.
4. The debugger `write` takes hex: `write 0x800c5761 b 12` loads index 0x12 = kungfu4.
5. Object vertices are drawn by the game from CPU-transformed copies, so RAM display lists don't
   reference object files directly.
6. gillig1 has 19 sky records, but the reference renderer shows no sky for it (not resolved).

##### Gex 64 collision (verified on all 31 level files unless marked)

**Collision faces.** There is no separate collision BSP: every render-BSP leaf lists its own collision faces with
`+0x0A u16 count` and `+0x0C ptr` to the first face of a run in the face array at `scene+0x28`. The runs are
contiguous. Together they cover every face exactly once, and the total equals `scene+0x1C` in every level (231,586
faces in all).
```
+0x00 u16 v0, v1, v2      indices into the world vertex pool (segment 1, scene+0x24): the render vertices
+0x06 u16 flags           surface flags (below)
+0x08 s16 normal          face normal: index into scene+0x2C (s16 4.12 x, y, z; count scene+0x20); negative = -entry[-i]
+0x0A s16 edge x 3        edge-plane normals for v0->v1, v1->v2, v2->v0 (same table, same sign rule)
+0x10 ptr event record    present only when flags & 0x4400 (record size 20 instead of 16)
```
- **Record size rule:** a face record is 20 bytes when `flags & 0x4400`, otherwise 16. With this rule every leaf pointer
  lands on a record start in looney30, map5, scifi10 and gillig1, and looney30's array ends exactly at the next section
  (`0x570A0`). The other rules tried (`0xC000`, `0x4000`, `0x400`, `0xC400`) leave 55–652 misaligned leaf pointers.
  Every level loads with the rule, and the faces found equal `scene+0x1C`.
- **Normals:** the face normal agrees with the winding: dot product ≥ 0.995 with the normalised cross product
  (v1−v0)×(v2−v0) for 3,000 looney30 faces. The edge normals are perpendicular to the face normal (|dot| < 0.0004) and
  to their edge (|dot| < 0.09). They point away from the face centre (8,995 of 9,000). Shared edges use opposite
  signs, e.g. index 4 and −4.
- **Vertices:** the faces use the render vertices, so the collision coincides with the drawn world. The overlay check
  (*Collision (both games)*) finds 88–99% of faces exactly on a drawn triangle. The rest are invisible surfaces.
- **Event records:** the pointer at +0x10 points into the level header area (e.g. looney30 `0x29C..0x1A60`; 55 distinct
  records). Records are variable-length lists of u32s, e.g. `00000003 00000011 0000003C 0000000F 8024CE68 0000000D ...`,
  with embedded pointers. **hypothesis:** event scripts (warps, music/camera triggers). The format is not decoded.
- **Flags** (`u16 +0x06`): every bit except 0x10 and 0x2000 occurs. Bit counts over levels 0–25 as floor/wall/ceiling
  faces (normal z > 0.5 / between / < −0.5):
  `0x1` 5,740/53,254/11,336; `0x2` 207/2,272/1,306; `0x4` 1,443/817/34; `0x8` 3,704/883/307; `0x20` 680/1,631/644;
  `0x40` 1,230/3,917/726; `0x80` 5,181/15,132/3,903; `0x100` 742/6,056/1,984; `0x200` 4,868/303/0;
  `0x400` 1,216/138/38 (always with an event record); `0x800` 776/812/138; `0x1000` 21,403/45,003/9,261 (on most
  faces of horror4, horror2, rezop3, kungfu1, prehst1 and prehst2); `0x4000` 1,098/7,651/266 (always with an event
  record); `0x8000` 3,195/12,304/741. Code that tests them (main image):
  - `0x8000DF0C` skips faces with `0x4000` or `0x40` in a wall/point test (**hypothesis:** 0x4000 = non-solid
    trigger face);
  - `0x800076CC` tests `0x1000` on the player's current face;
  - `0x8001E270` tests `0x201`, `0x8001EB60` `0x1`, `0x8001ED30` `0x8`/`0x20`, `0x8001EDE4` `0x40`, `0x800201A4`
    `0x2`, `0x8002FFAC`/`0x80049438` `0x800`.

  The meaning of the individual bits was **not** traced.

**Second BSP (`scene+0x34`) = instance BSP, not collision (resolves the earlier hypothesis).** Its nodes use the same
24-byte layout as the render BSP (kinds 1 and 2, planes from `scene+0x2C`). A leaf's `+0x0A u16 count` and `+0x0C ptr`
point to a `u32[count]` list of pointers to 48-byte instance records (*Gex 64 level file (verified unless marked)* Instances). Over all 31 levels: 7,601
pointers, 0 not on an instance record, and each of the 6,007 instances listed at least once. `scene+0x10` always equals
the instance count. **hypothesis:** the game uses it to activate or cull instances near the camera. The code that walks
it was not identified (the generic tree walker `0x80034DB8` has no direct `jal` callers).

**Invisible objects.** Objects of the classes `invis___` (34 placements), `jinvis__` (2), `proxsig_` (31), `tvmenu__`
(2), `select__` (2), `password` (1) and `loadtv__` (1) have face-list geometry that the game never draws. **hypothesis:**
volumes, proximity triggers and hub menu hotspots. The no-geometry logic classes (`collide_` 9, `qcoll___` 2,
`gatesph_` 8, `camswch_` 5, `slider__` 9, `follow__` 11, `qcsph___` 3) have no parameter block. Their only size is the
instance `+0x16` radius (e.g. 1827 for every `collide_`), so their shape is unknown.

### 3.3 Geometry

#### Verification evidence: Level geometry (Gex 64)

Method: the level pass took an in-game screenshot and an 8 MiB RDRAM dump at the same moment, with Gex
standing still. It read the game's projection, modelview and fog from the frame's display list in RAM,
and rendered the level file with its proof-of-concept TypeScript renderer (`g64lvl/g64render.ts`, using
the viewer's `displaylist.ts` and `texture.ts`) from that camera.

| level | screenshot + dump | render(s) | result |
|---|---|---|---|
| looney30 Out of Toon | `g64lvl/shots/looney30_start_A.png` + `g64lvl/ram/looney30_A.bin` | `g64lvl/renders/final_looney30_ramcam.png`, `looney30_ramcam_all.png`, `looney30_objects_A.png` | **matches**. Coordinator viewed both: same layout, handedness (tree trunk left, signpost centre, flower bushes both sides, palm plant right), textures and clear colour. Missing only Gex and a code-spawned collectible, as expected. Culling test: `looney30_ramcam_f0_cullback.png` (opposite rule removes the ground) vs `_f0_cullfront.png` |
| map5 Media Dimension hub | `g64lvl/shots/map5_hub_start_A.png` + `g64lvl/ram/map5_A.bin` | `final_map5_ramcam.png`, `map5_objects_A.png`, `final_map5_overview.png` | matches in layout per the level pass. Known differences: a stray white quad on the floor, and the hub's big blue crystal renders as a small purple object |
| kungfu4 Lizard in a China Shop (bonus) | `g64lvl/shots/kungfu4_start_A.png` + `g64lvl/ram/kungfu4_A.bin` | `final_kungfu4_bonus_ramcam.png`, `kungfu4_sky_objects_A.png` | **layout, objects and handedness match** (coordinator viewed: lantern poles, "Sushi" sign, building right). **Differences:** the sky backdrop shows dock-like silhouettes where the game shows pagoda roofs, and the front wall texture differs (brick-like vs wooden fence). hypothesis: wrong sky sector/UV selection and a flipbook/animated material frame |
| scifi10 The Umpire Strikes Out | `g64fs/shots/scifi10_umpire_strikes_out_warp.png` | `final_scifi10_start.png` (free camera, flipbook frame 0, starfield sky) | similar view (free camera, not frame-exact) |
| gillig1 Gilligex Isle (boss) | – | `final_gillig1_boss_overview.png` | overview only; its 19 sky records do not show in the render (unresolved) |

Texture contact sheets: `g64lvl/renders/*_textures.png` (with `.txt` listings). Frame checks: every
`G_DL` into the level blob in the looney30 frame targets a flag-0 chunk of a visible leaf (273 calls,
64 leaves). The fog moveword `BC000008 5355ADAB` equals the formula from hdr+0x52. The instance
rotation order was checked against 4 actor pose matrices in RAM (error ≤ 0.0004).

### 3.4 Display lists and render state

#### Mapping to the viewer: Display lists and coordinates (summary; details from the level passes in *Level format*)

- **Addressing:**
  - Both games point RSP segments 1/2/3 at the level's vertex pool, material display lists and
    texture pool every frame.
  - World geometry in both games uses segmented addresses (Gex 64 chunk DLs; Gex 3 fragments, e.g.
    `01062050` = segment 1 + 0x62050). Other pointers in a level file are absolute (`0x8024B000`-based).
  - `ctx.resolve(addr)` must map segment 1/2/3 addresses to the pool offsets, and absolute KSEG0
    addresses to `addr − 0x8024B000`. For objects, it maps file-relative pointers (*Relocatable file format (objects and the player model; both games, verified)*).
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
    `G_DL {material DL}`, then the concatenated commands of that material's type-A fragments, then
    `G_ENDDL`. Append it to the buffer and let `resolve` map that synthetic address range. This is
    what `g3lvl/ts/g3level.ts` `buildBatches()` does with the **unmodified** `runDisplayList`.
  - type-B fragments run with their special record's first DL.
  - use the first frame DL for animation records.
  - set `cullBackByDefault: true` for the world.
- **Not handled today:** `G_MTX`/`G_POPMTX`, `G_MOVEWORD`, fog and lighting commands. In both games these appear only in the frame lists built by code, never in level or object data, so static geometry doesn't need them. World
  geometry is stored in model space with identity transforms. Object models need the per-instance
  matrix built from the instance record, and must not rely on `G_MTX`.

### 3.5 Textures and materials

Texture storage and material binding are described with geometry above.

### 3.6 Collision

#### Verification evidence: Collision (both games)

No emulator was used. All checks are static (disassembly of the main images and the extracted level files) or run
through the viewer's loaders. Scratch scripts are in `gexcoll/`.

| check | method | result |
|---|---|---|
| Gex 64 record size | leaf pointers against sequential walks with 5 candidate rules (`g64faces.py`) | `flags & 0x4400` → 20 bytes: 0 misaligned leaf pointers in looney30/map5/scifi10/gillig1; other rules 2–652 |
| Gex 64 normals | face normal vs winding, edge normals vs face/edge | dot ≥ 0.995; edge normals in-plane and outward (8,995/9,000) |
| Gex 64 second BSP | every leaf list in 31 levels vs the instance array | 7,601 pointers, all on 48-byte instance records, all 6,007 instances covered |
| Gex 3 record size | loop code `0x80017254` + leaf gaps in 30 levels (`g3aux.py`) | 0 mismatches (last run padded with `CDCD`); the `surface & 4` rule gave 2,540 bad leaves |
| Gex 3 normals | `0x80012B0C` decode vs winding (`g3norm.py`) | 338,878 / 338,891 faces dot ≥ 0.98 |
| face counts | viewer load of all 31 + 30 levels (`loadtest.ts`) | decoded faces = `scene+0x1C` (Gex 64) / `scene+0x20` (Gex 3) in every level, 0 skipped records |
| alignment with the world | collision triangles (minus the 1-unit lift) keyed against world triangles (`render.ts`) | Gex 64: hub 95.7%, looney30 93.1%, scifi10 88.5%, kungfu4 98.9%; Gex 3: gexcave6 95.9%, snow96 96.7%, anime1 96.9%, endboss1 98.0% |
| visual | offline raster, start camera and top view, world vs world + collision | overlays follow floors, walls and ramps; images `renders/*_cmp.png`, `*_only.png` |

### 3.7 Environment, sky, fog, and lighting

Environment records and runtime render state are described with the level data above.

### 3.8 Cameras and paths

Camera defaults and path data are described with the level data where known.

## 4. Objects

### 4.1 Placement records

Placement records are structurally coupled to the level format and are described in Level data.

### 4.2 Object and model formats

#### Filesystem and compression: Object tables (both games, same record layout, verified)

16-byte records `{char name[8]; u32 romStart; u32 romEnd}`, sorted by name; names are 8 characters
padded with `_` and **not** NUL-terminated (e.g. `gexeyes_`, `10tons__`). Lookup compares the two name
words and stops at a record whose first byte is 0. Each file is DEFLATE of a *Relocatable file format (objects and the player model; both games, verified)* relocatable file.

| | Gex 64 | Gex 3 |
|---|---|---|
| table | ROM `0x745F0` (vaddr `0x800739F0`), 735 records, ends at ROM `0x773E0` | ROM `0x818C0` (vaddr `0x80080CC0`), 963 records, ends at `0x800848F0` |
| files | ROM `0xC495B0..0xF821C0` | ROM `0x159C4C0..0x1A92090` |
| lookup/loader | `0x8003AF10` | `0x80031128` |
| player model | "common blob", ROM `0x49D870..0x4B5750` (not in the table; contains `gex_____` and Gex's animations) | `gex_____`, ROM `0x158E1B0..0x159C4C0` (not in the table; hard-coded in `0x800316F4`) |
| always-loaded objects | `shadow__ shadow2_ hud_____ gexeyes_ fonts___ cammode_ introfx_ etvbtn__ remrfx__ remsfx__ lvltv___` (list at `0x800700C0`, persistent heap from `0x801B0000`) | fonts `yellfont`, `dbgfont_` (fonts heap `0x801D8800`), `hud_____`, shadows, etc. |

Full per-object ROM ranges, sizes and reloc counts: `g64fs/files/index.json`, `g64fs/objtable.txt`,
`g3fs/files/index.tsv` and the file tables in the *Verification evidence* sections of `notes/g64_fs.md` and `notes/g3_fs.md`.

#### Mapping to the viewer: Detection and game objects

- `src/rom/index.ts` `openRom()`: add `case 'NX2E'` (Gex 64) and `case 'NX3E'` (Gex 3) on the game
  code at ROM 0x3B, after `normalizeByteOrder()`.
- `src/rom/types.ts`:
  - extend `Game.id` with `'gex64' | 'gex3'`;
  - extend `LevelKind`, e.g. `'hub' | 'level' | 'bonus' | 'secret' | 'boss' | 'cutscene'`, and map
    *Level lists* roles onto it. `LevelInfo.name` = in-game title (*Level lists*); `Level.id` = internal name.
- Suggested level list order:
  - Gex 64: channels in table order 0–24, then the hub (25); intro and logos can be omitted.
  - Gex 3: hub files 23–26, then TV levels 0–10, bonus 11–15, secret 16–19, bosses 20–22, and fly77
    (title) last.

### 4.3 Skeletons and animation

Static-pose or animation support and remaining omissions are stated in the object description.

### 4.4 Behaviors, triggers, and scripted objects

Behavioral records are documented only where they affect level extraction or presentation.

## 5. Audio

### 5.1 Audio storage and banks

Audio storage is described with the sequence and bank tables below.

### 5.2 Sequence format and driver

#### Boot and code: Level load sequence

Gex 64 (loader thread `0x8003BFB8`, verified):
1. heap pointer `[0x800EB7F4] = 0x8024B000`; load inflate overlay (`0x8003B54C`);
2. `lvl = u8 [0x800C5761]`; `LoadLevelData` (`0x8003B300`): inflate ROM `[rec+0, rec+4)` to `0x8024B000`;
3. `FixupLevel` (`0x8003B198`): load every object named in the level's object list (*Level tables*) and patch
   the instance table;
4. `LoadOverlay` (`0x8003B484`): copy ROM `[rec+8, rec+0xC)` to `0x80159720`, zero-fill to `rec+0x10`;
5. load the *common blob* (Gex player model) with `malloc`.

Gex 3 (verified): `0x8003152C(idx)` inflates the level data to heap `[0x800FDCD0]` (= `0x8024B000`),
`0x800317B4(idx)` copies the overlay to `0x80113910` and zero-fills to `rec+0x2C`, `0x800313DC` loads
the objects listed at level header `+0x44`, `0x800316F4` loads the player object `gex_____`,
`0x800318BC` loads the per-level 0x820 block, and the audio loaders read the audio fields of the
level record (*Music*).

#### Music: Engine (both games: libmus, verified)

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
| player tick | once per video frame (60 Hz NTSC); **hypothesis**: 367 output samples per frame | once per frame, 367 samples (verified) |
| songs | 27 (23 level songs + 4 jingles) | 15 (one per level; song 2 shared by 13 levels) |
| per-level switching | crossfades between songs through area-trigger lists | none. "Adaptive audio" on N64 means fade in/out and ducking only (a flag shared with Gex's lip-sync) |
| reverb | the synth FX bus is configured; per-song and per-channel sends | same (**not rendered** by the reference renderers) |

The player port in each reference renderer matches the running game's per-channel player state in
RAM exactly (*Verification evidence*). So everything below reproduces the game's note, envelope, volume and pitch
*control*. The final PCM mix (libultra envmixer and resampler rounding, reverb) is an approximation
that could not be compared by ear: the headless emulator has no audio output.

#### Music: Gex 64 locations and tables (verified)

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
| **`0x47B670-0x47CCB0`** | prehismx (hypothesis) | 140 | **unreferenced** (*Unused or hidden content*) | 0..2722773 | `47b670_UNUSED_prehistory_b.wav` |
| `0x490EC0-0x4918E0` | REZOP | 126 | No Weddings and a Funeral, Bugged Out | 83676..1677924 | `490ec0_rezopolis.wav` |
| `0x4918E0-0x4931C0` | orchestr | 100 | The Umpire Strikes Out, Pain in the Asteroids | 0..1957211 | `4918e0_rocket_channel.wav` |
| `0x4931C0-0x4958F0` | orchestr | 145 | Media Dimension hub **and title menu** (verified), The Spy Who Loved Himself | 147534..3634768 | `4931c0_hub_media_dimension_and_spy2.wav` |
| `0x497E00-0x498300` raw | EXTRAS | 120 | jingle 1 (hypothesis: remote-related fanfare) | one-shot | `497e00_jingle1.wav` |
| `0x498300-0x498A50` raw | EXTRAS | 181 | jingle 2 (hypothesis: level exit/complete) | one-shot | `498300_jingle2.wav` |
| `0x498A50-0x499550` raw | EXTRAS | 115 | jingle 3 (hypothesis: alternative exit) | 0..160746 | `498a50_jingle3.wav` |
| `0x499550-0x49A200` raw | EXTRAS | 202 | jingle 4 (hypothesis: red remote collected) | one-shot | `499550_jingle4.wav` |

`MusicTrack` names for the viewer: use the level titles in the "used by" column. No in-game jukebox
names exist.

#### Music: Rendering offline to PCM (both games)

1. Parse the pointer bank (*Sample banks (both games)*) and the song (*Song format: Gex 64 revision and Gex 3 differences*). Inflate level songs first.
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

#### Mapping to the viewer: Difficulty and risks (music; level parts in *Level format*)

- **Music:** medium. Reference TypeScript implementations already exist (`g64audio/gex64music.ts`,
  `g3audio/gex3music.ts`) and match the game's player state exactly. Rendering a full looping song
  takes ~1 s of CPU per song, so render in the worker, one track on demand.
- **Risks:** reverb isn't rendered, so songs sound drier than in game. PCM loudness and rounding
  differences can't be checked by ear. Gex 64 levels with several songs (Toon TV, Circuit Central,
  Gecques Cousteau) switch between songs by area triggers, so list each song separately.

#### Verification evidence: Music (Gex 64)

| check | method | result |
|---|---|---|
| player port vs game | `g64audio/verify.ts` compares, for every song channel, data pointer, channel time, next-note time, wave, voice flag, envelope phase and value, volume, pan, last `alSynSetVol` value and velocity against RAM | **16/16 channels identical** at 3 snapshots: title song frames 101 and 1484, Gecques Cousteau frame 1882 (dumps `g64audio/run/t1_*.bin`, `t2_*.bin`, `r_*.bin`) |
| song selection | live: title menu (level 25) and a warp to rta1 | title plays `0x4931C0`; rta1 loads `horrormx.wbk` with slots `0x41B390`/`0x41CA80`, slot 0 at volume 96, tempo 256 |
| table order | libmus state in the fs agent's dumps | hub slot 0 = `0x4931C0`; Out of Toon slots 0..4 in table order, current slot 1 at volume 112 (the first-entry fade quirk) |
| static | all 23 DEFLATE songs inflate; every wave index fits its bank; every command byte has a handler | pass |
| rendered audio | `g64audio/wav/*.wav` (27 songs + `index.json` with loop points) | **not** compared with real game audio (no audio output headless); reverb not rendered |

### 5.3 Instruments and sample encoding

#### Music: Sample banks (both games)

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

### 5.4 Music catalog and loop points

The complete known song catalog and loop policy are included above.

## 6. Unused and hidden content

### 6.1 Unreferenced assets

#### Unused or hidden content

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
| Gex 3 | skipped category slot | level record `+0x0C` runs 5..0x10 over the 11 TV levels with 0x0D missing | hypothesis: a cut 12th TV level slot |
| Gex 3 | no orphan files | all 30 level records, 29 audio banks and 963 objects | every object name occurs in at least one level file, overlay or main code (711 are used by exactly one level) |
| Gex 64 | **unreferenced song** | ROM `0x47B670-0x47CCB0` (DEFLATE → 10,173 bytes; 17 channels, 140 BPM, 123.5 s loop) | not referenced by the level audio table, the jingle table or any code/data constant; `0x47B670` occurs only as the *end* of the Pre-History song. It sits between the Pre-History song and REZOP.WBK. Bank hypothesis prehismx.wbk: 0 notes exceed the pitch cap with it (8..15 with any other bank), and it uses 6 prehismx waves (2, 6, 13, 14, 15, 18) no referenced song uses. Likely a cut second Pre-History Channel track. Rendered: `g64audio/wav/47b670_UNUSED_prehistory_b.wav` |
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
| Gex 64 | no cheat input found (second search) | – | the level pass also searched pad-bit tests in code: only HUD/menu uses of L and Z, plus the password screen (map5 overlay, button table `0x80161160`). hypothesis: any cheats are special passwords |
| Gex 3 | **540 unreferenced material entries** | 540 of 4,529 material-table entries in 27 levels, e.g. clue1 53, gtown2 55, hub 43; none in war01, push44, wwgex1 (`g3lvl/unused_materials.txt`) | referenced by no fragment, sky DL, special record or animation record. **Caveat:** per-level overlay code was not scanned, so some of these textures may still be drawn by code |
| Gex 3 | placed but hidden objects | hub (gexcave6) instances such as a purple paw box, a black cube and a red paw icon | render in the placement render (`g3lvl/renders/gexcave6_gamecam_with_objects.png`) but are absent from the game frame (`g3lvl/shots/hub_gexcave6_game_frame_of_ramdump.png`). hypothesis: shown only in certain game states or missions (instance +0x0E) |
| Gex 3 | logic-only instances | 331 instances with name index −1 | no object; hypothesis: triggers, cameras, spawn points |
| both | no orphan level or object files | every Gex 3 table object is named somewhere; Gex 64 has the 12 orphans listed above | static reference scans |

### 6.2 Cut or inaccessible levels

Candidate levels are distinguished from alternate, debug, and intentionally hidden retail content above.

### 6.3 Debug features

Shipped debug strings and executable features are listed only when supported by a code or data reference.

### 6.4 Prototype or revision-specific content

Source-archive and prototype material is explicitly distinguished from shipped retail data.

## 7. nviewer implementation

### 7.1 Module mapping

#### Mapping to the viewer: Reusable modules

| existing module | reuse for Gex | changes needed |
|---|---|---|
| `inflate.ts` `inflateRaw` | every compressed file in both games (*Compression: raw DEFLATE (both games, verified)*) | none (verified on Gex data) |
| `lzss.ts` | – | not used by Gex |
| `displaylist.ts` `runDisplayList` | world, material and object display lists (F3DEX 1.x for Gex 64, F3DEX2 for Gex 3) | see *Display lists and coordinates* and the detailed level-format passes |
| `texture.ts` | textures uploaded through `G_SETTIMG`/`G_SETTILE`/`G_LOADBLOCK`/`G_SETTILESIZE` in the material DLs | none expected; the Gex 64 level pass reports textures decode correctly with the existing code |
| `util.ts` `pruneUnused`, `emptyBounds` | level assembly | – |
| `music/rush1.ts` `decodeVadpcm`, `RESAMPLE_LUT` | libmus voices (*Rendering offline to PCM (both games)*) | export or move the loop preparation and voice mixer so they can be shared |

#### Mapping to the viewer: New modules (suggested names)

| file | contents |
|---|---|
| `src/rom/gex/common.ts` | level-table readers for both games, object-table lookup, the relocatable loader (*Relocatable file format (objects and the player model; both games, verified)*), and the address resolver for images linked at `0x8024B000` |
| `src/rom/gex/gex64.ts` | Gex 64 `Game`: level list (*Gex 64: Enter the Gecko (31 table entries; names verified from the info table)*), level loader (*Level format*, Gex 64 parts) |
| `src/rom/gex/gex3.ts` | Gex 3 `Game`: level list (*Gex 3: Deep Cover Gecko (30 table entries; names from the string table, verified)*), level loader (*Level format*, Gex 3 parts) |
| `src/rom/gex/objects.ts` | object model format → `Mesh`; instance records → `Instance` |
| `src/rom/music/vadpcm.ts` | move `decodeVadpcm`, wave loop preparation, `RESAMPLE_LUT`, the voice mixer and the equal-power pan model out of `rush1.ts` so Rush and Gex share them |
| `src/rom/music/libmus.ts` | shared libmus pointer-bank, song and player port plus the mixer (*Music*); a revision switch for the Gex 64 and Gex 3 command sets |
| `src/rom/music/gex64.ts`, `src/rom/music/gex3.ts` | song tables → `MusicTrack[]` and `decodeMusic` |

`MusicTrack.name`: the level title(s) that use the song (*Gex 64 locations and tables (verified)* and *Gex 3 specifics (verified by disassembly and RDRAM unless marked)*), e.g. "Scream TV (Smellraiser,
Frankensteinfeld, …)". `DecodedMusic.loopStart/loopEnd`: from the For/Next loop detection (*Rendering offline to PCM (both games)*).
Jingles and one-shot songs have no loop.

### 7.2 Supported features

The Technical summary states the supported releases and principal decoded features.

### 7.3 Approximations and omissions

Viewer approximations are distinguished from facts about the game formats.

## 8. Verification and remaining work

### 8.1 Verification evidence

#### Open questions and unknowns

Everything in this section is unverified. Items are **hypothesis** unless stated otherwise.

Filesystem and level lists:
- **Gex 64:** the hub unlock/progression order was not traced; table order 0..13 is assumed to be the intended progression.
- **Gex 64:** the meaning of ROM `0x49BA00-0x49D870` (loaded to `0x800E6010` during audio init; not music data) is unknown.
- **Gex 3:** the fields at level record `+0x0A`, `+0x14..+0x1A` and `+0x30` are not decoded. The upper bytes of `+0x34` are unknown (fog colour is in the level header, *Gex 3 level file (verified on gexcave6, anime1, snow96, endboss1 unless marked)*).
- **Gex 3:** the invulnerability button code comes from static analysis only. The level-select code
  was confirmed in the emulator by the level pass (*Unused or hidden content*).

Levels:
- **Gex 64:** skeletal animation data (object +0x10) is not decoded, so only rest poses are available,
  and Gex himself needs the common blob's skeleton.
- **Gex 64:** chunk flag-4/5 records (animated texture, probably water or lava), the vertex-colour
  animation list at header +0x0C, and header +0x60/+0x78/+0x8C and scene +0x50/+0x64/+0x78 (possibly
  event or camera scripts) are not decoded.
- **Gex 64:** gillig1's 19 sky records don't appear in the reference render. kungfu4's rendered sky
  shows different silhouettes from the game, and its front wall texture differs (*Level geometry (Gex 64)*). Both are
  unresolved.
- **Gex 64:** chunk flags 5/7 without a material were never drawn in the analysed frames; they are
  assumed to be collision-only or special surfaces.
- **Gex 3:** the rotation order of the three instance angles is not proven (only Z was checked).
  Multi-segment (skinned) object meshes and animations are not decoded.
- **Gex 3:** header +0x54 is assumed to be the draw distance or far plane. The procedural material kinds 4/6/8 are
  not decoded. 2–4 fragment lists per level fail to parse. (The per-leaf "aux records" are the collision records,
  *Gex 3 collision (verified by code and on all 30 level files unless marked)*.)
- **Collision, both games:** the meanings of the Gex 64 face flag bits and of the Gex 3 surface types and upper
  bits were not traced; only the code sites that test them are listed (*Gex 64 collision (verified on all 31 level files unless marked)*, *Gex 3 collision (verified by code and on all 30 level files unless marked)*). The event records (Gex 64
  face +0x10 pointer, Gex 3 `scene+0x3C` table) are not decoded. Gex 3 `scene+0x1C` and `+0x24` are unknown counts.
  The code that walks the Gex 64 instance BSP (`scene+0x34`) was not found. Nothing was checked in the running game.
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

### 8.2 Known unknowns

Unresolved semantics are labelled **Hypothesis** or **Open question** where they occur.

### 8.3 References

External documentation, decompositions, and source archives are cited inline where used.
