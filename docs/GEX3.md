# Gex 3: Deep Cover Gecko — Nintendo 64 ROM format specification

This manual describes the shipped data formats needed to identify, extract, and
present Gex 3: Deep Cover Gecko content. Claims state their evidence inline; unsupported
interpretations are labelled hypotheses.

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | Level table, relocatable named objects, and one code overlay per level. |
| Compression | Headerless RFC 1951 DEFLATE. |
| Graphics microcode | F3DEX2 2.06. |
| Geometry | Pointer-based level mesh and object records. |
| Textures | Primarily CI4 with RGBA16 TLUTs; some CI8 and RGBA32. |
| Collision | Dedicated collision records in each level file. |
| Music driver | Nintendo Sound Tools libmus. |
| Audio microcode | **Unknown** |
| Sample encoding | Nintendo VADPCM. |
| Levels | 30 level-table entries. |
| Memory requirement | Expansion Pak. |
| Viewer support | USA revision 0. |

### 1.2 ROM identification

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| USA | `Gex 3 Deep Cover Gec` | `NX3E` | 0 | 32 MiB (`0x2000000`) | `3EDC7E12` | `E26C1CC9` | `467bc88942e02d542e1a4705dcab98ab7281819f` | CIC-6102 | — |
| Europe French/German | `Gex 3 Deep Cover Gec` | `NX3X` | 0 | 32 MiB (`0x2000000`) | `874733A4` | `A823745A` | `4bcd958526d9145acf4e3ee7ee484e62dc1bb4ba` | CIC-6102 | — |
| Europe English/Spanish/Italian | `Gex 3 Deep Cover Gec` | `NX3P` | 0 | 32 MiB (`0x2000000`) | `99179359` | `2FE7EBC3` | `54653ba26a12521ccd886212fffdf2f6427c2fea` | CIC-6102 | — |

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

### 2.3 ROM map and asset organization

#### ROM maps

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

Reference codec: [raw DEFLATE](compression/raw-deflate.md).

#### Compression: raw DEFLATE (both games, verified)

Every compressed file in both ROMs is a **raw RFC 1951 DEFLATE stream**: no zlib/gzip header, no
stored size, no checksum. The decompressor is zlib's `inflate_blocks` in the inflate overlay. The
decompressed size is not stored anywhere; the game inflates into a heap with a capacity limit and
uses the returned size, so a decoder must simply run to the final block.

Bits are read LSB-first. Each DEFLATE block begins with:

| Bit offset | Width | Field | Meaning |
|---:|---:|---|---|
| 0 | 1 | BFINAL | Last block when set. |
| 1 | 2 | BTYPE | 0 stored; 1 fixed Huffman; 2 dynamic Huffman; 3 invalid. |

Stored blocks align to the next byte boundary and use little-endian halfwords:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | u16 | LEN | Uncompressed byte count. |
| 0x02 | 2 | u16 | NLEN | Ones-complement of LEN. |
| 0x04 | LEN | u8[] | data | Literal bytes. |

Dynamic blocks follow the block header without alignment:

| Bit offset | Width | Field | Meaning |
|---:|---:|---|---|
| 0 | 5 | HLIT | Literal/length alphabet count minus 257. |
| 5 | 5 | HDIST | Distance alphabet count minus 1. |
| 10 | 4 | HCLEN | Code-length alphabet count minus 4. |
| 14 | 3 × (HCLEN + 4) | codeLengths | Three-bit lengths in order 16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15. |
| Following | Variable | treeDescriptions | Literal/length and distance code lengths; repeat symbols 16–18. |

Huffman codes are
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

#### Extracting every file

1. Normalise byte order (existing `normalizeByteOrder`).
2. Level files: iterate the level table (*Level tables*); inflate `[start, end)` (Gex 64 `+0/+4`, Gex 3 `+0x1C/+0x20`).
   The result is a flat image **linked at `0x8024B000`**: every pointer inside is an absolute address,
   so `fileOffset = ptr − 0x8024B000`. There is no relocation table.
3. Object files: iterate the object table until a zero name byte; inflate and apply *Relocatable file format (objects and the player model; both games, verified)*.
4. Player model: Gex 64 ROM `0x49D870..0x4B5750`, Gex 3 ROM `0x158E1B0..0x159C4C0`; inflate, *Relocatable file format (objects and the player model; both games, verified)*.
5. Code overlays and audio regions are plain ROM ranges.

The complete extraction indexes each file by its ROM range and decoded size.
Independent DEFLATE decoding agrees with zlib for the Gex 64 streams; the
verification results are tabulated below.

#### Filesystem and codec

| check | method | result | evidence |
|---|---|---|---|
| Gex 64 inflate, all streams | ROM extraction: pure-Python RFC 1951 inflater vs zlib | 767 streams (31 levels, 735 objects, common blob), 0 mismatches | ROM extraction, `g64fs/files/index.json` |
| Gex 64 level data vs RAM | extracted `map5` and `looney30` vs RDRAM at `0x8024B000` after the in-game load (ROM extraction) | map5: 1,064,000/1,064,000 bytes equal outside the two tables `FixupLevel` patches; looney30: 29 differing bytes, all runtime state | `g64fs/ram/map5_hub.bin`, `g64fs/ram/looney30_outoftoon.bin` |
| Gex 64 relocatable objects vs RAM | the 10 persistent objects rebuilt from files (reloc applied at their load addresses) | 171,645/171,664 bytes equal (only `DATA+4..5`, a runtime field) | same dumps |
| Gex 3 inflate vs RAM | exec breakpoint `0x800315C8` just after the level inflate; dump and `cmp` | opening1 (15,288 bytes) and fly77 (729,776 bytes) byte-identical | `g3fs/d/opening1_fresh.bin`, `g3fs/d/fly77_fresh.bin` |
| Gex 3 objects vs RAM | relocated objects located in an intro RAM dump | 20 of 25 byte-exact, the rest differ by a few runtime bytes | `g3fs/d/intro.bin` |
| viewer `inflate.ts` | `coord/inflate_check.ts` with the repo's `tsx` | Gex 64 map5 and Gex 3 gexcave6 identical to zlib | `coord/g64_map5.bin`, `coord/g3_gexcave6.bin` |
| Gex 3 DMA trace | breakpoints on PI DMA starts during boot, intro, title and anime1 | every table-listed file range read as expected; no read of ROM `0x1A92090..0x1D3B030` in those scenes (it is Agent Xtra video, read by the Mission Control overlay; *Unused or hidden content*) | `g3fs/dma_boot.txt` |
| level warps | debugger recipes (*Level lists* notes; `notes/g64_fs.md` *Sample banks (both games)*, `notes/g3_fs.md` *Open questions and unknowns*) | loads the requested level normally | `g64fs/shots/looney30_out_of_toon_warp.png`, `g64fs/shots/scifi10_umpire_strikes_out_warp.png`, `g64fs/shots/map5_hub_newgame_start.png`, `g3fs/shots/warp_lvl23_gexcave6_mission_control.png`, `g3fs/shots/warp_lvl08_anime1_when_sushi_goes_bad.png` |

### 2.5 Loading process

### 2.6 Revision differences

## 3. Level data

### 3.1 Level catalog and identifiers

#### Gex 3: Deep Cover Gecko (30 table entries; names from the string table, verified)

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

Mission names per TV level (string ids at record +0x0E) are listed in `notes/g3_fs.md`, “Level catalog”.
**Hub TV assignment** (verified from the level data: hub TV instances point at records that name
the target level; confirmed in game by the level pass): **Mission Control** — snow96, clue1;
**Lake Flaccid** — egypt01, war01, gtown2, pirate45, wwgex1; **Slappy Valley** — beane1, myth64,
anime1, oz01; **Funky Town** — city1, mob01, endboss1. The bonus and secret levels are spread across
the hubs (per-level placement in `notes/g3_level.md`). The in-game order in
the retail level-select page (*Unused or hidden content*) is ids 0..26.

### 3.2 Level container

#### Relocatable file format (objects and the player model; both games, verified)

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | n | Relocation count. |
| 0x04 | 4 × n | u32[] | relocOffsets | Offsets from DATA; each locates a u32 pointer. |
| 0x04 + 4 × n | Variable | u8[] | DATA | Marked pointers hold DATA-relative offsets. |
Loader (Gex 64 `0x8003B270`, Gex 3 `0x800314A0`): for each `i`, `*(DATA+off) += loadAddress`, then
`memmove(DATA → loadAddress)`. A viewer can keep pointers file-relative (base 0) instead: skip the
header, and treat each relocated word as an offset into `DATA`. Verified against RAM: Gex 64's 10
persistent objects match 171,645/171,664 bytes (only `DATA+4..5` is a runtime field set to 0xFFFF);
Gex 3: 20 of 25 relocated objects byte-exact, the rest differ in a few runtime bytes.

#### Level tables

**Gex 3** — ROM `0x8013C` (vaddr `0x8007F53C`), 30 records of 0x54 bytes, index = level id (verified
unless marked):
| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | name | String pointer, e.g. snow96. |
| `+0x1C` | 4 | `u32` | `level data ROM start (raw DEFLATE, -> 0x8024B000)` | — |
| `+0x04` | 2 | `u16` | `string id: title` | — |
| `+0x20` | 4 | `u32` | `level data ROM end` | — |
| `+0x06` | 2 | `u16` | `string id: genre` | — |
| `+0x24` | 4 | `u32` | `overlay ROM start (-> 0x80113910)` | — |
| `+0x08` | 2 | `u16` | `string id: channel` | — |
| `+0x28` | 4 | `u32` | `overlay ROM end` | — |
| 0x0A | 2 | u16 | missionCount | 3 for TV/secret, 1 for hub; mission count is a hypothesis. |
| `+0x2C` | 4 | `u32` | `overlay RAM end incl. BSS` | — |
| `+0x30` | 4 | `u32` | `address inside the overlay (hypothesis: entry/init)` | — |
| 0x0C | 2 | u16 | category | TV 5..0x10 (0x0D unused); bosses 0x11..0x13; bonus 0x14; secret 0x15; other 0. |
| 0x34 | 4 | u32 | voiceClip | Low byte is the first level-local voice-clip SFX id; upper bytes unknown. |
| `+0x38` | 4 | `u32` | `ROM of 0x310 raw bytes -> 0x800FEE48 (lip-sync timing; 0 = none)` | — |
| `+0x3C` | 4 | `u32` | `ROM of 0x820-byte 64x64 CI4 channel logo -> 0x801FF7E0 (0 = none)` | — |
| `+0x0E` | 6 | `u16[3]` | `x3 string ids: mission names` | — |
| `+0x40` | 4 | `u32` | `ROM "N64 WaveTables" (level sample bank)` | — |
| `+0x14` | 8 | `u16[4]` | `x4 unknown` | — |
| `+0x44` | 4 | `u32` | `ROM "N64 PtrTablesV2" (level bank pointer table)` | — |
| `+0x48` | 4 | `u32` | `ROM level sound table (0xB40 bytes -> 0x800CFD20)` | — |
| 0x4C | 4 | u32 | songRomStart | Raw-DEFLATE song ROM start. |
| 0x50 | 4 | u32 | songRomEnd | Exclusive ROM end; decoded song loads at 0x800FF290. |
String table: `char*[242]` at `0x80080110` (getter `0x800260A0`). Level lookup by name: `0x8004FF54`.
Pointers in the table are main-image addresses (convert with ROM = vaddr − `0x7FFFF400`).

#### Shared structure (both games)

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

#### Gex 3 level file (verified on gexcave6, anime1, snow96, endboss1 unless marked)

The design is the same as Gex 64 (*Shared structure (both games)*). The layouts differ, and world geometry is stored as
*fragments* that the game copies into the frame, not as callable display lists.

**Header:**
| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `+0x00` | 4 | `ptr` | `scene struct` | — |
| `+0x08` | 4 | `u32` | `2 (all levels)` | — |
| `+0x20` | 4 | `u32` | `sky patch count` | — |
| `+0x24` | 4 | `ptr` | `sky patch table (16 bytes)` | — |
| `+0x28` | 4 | `ptr` | `sky Vtx pool (segment 4)` | — |
| `+0x2C` | 4 | `ptr` | `materials` | — |
| `+0x30` | 6 | `s16[3]` | `x,y,z,` | — |
| `+0x36` | 2 | `s16` | `angle` | player start (hypothesis) |
| `+0x44` | 4 | `ptr` | `objectNames` | — |
| `+0x4C` | 3 | `u8[3]` | `r,g,b` | fog colour AND clear colour |
| `+0x50` | 3 | `u8[3]` | `r,g,b` | second colour (hypothesis: ambient/object tint) |
| `+0x54` | 2 | `u16` | `8000..15100 (hypothesis: draw distance / far plane)` | — |
| `+0x56` | 2 | `u16` | `fog min for gSPFogPosition(min, 1000); values >= 1000 clamp to 993` | — |
| `+0x74` | 4 | `s32` | `-40000 (hypothesis: kill plane)` | — |
| `+0x84` | 4 | `u32` | `instance count` | — |
| `+0x88` | 4 | `ptr` | `instance array (0x34-byte records)` | — |
| 0x108 | 12 | u32[3] | bufferSizes | Per-frame graphics/vertex buffer sizes. |

Scene known fields:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | rootNode | Data-relative root-node pointer. |
| 0x10 | 4 | u32 | instanceCount | Instance count. |
| 0x14 | 4 | u32 | instances | Data-relative instance-array pointer. |
| `+0x18` | 4 | `u32` | `world vertex count` | — |
| `+0x1C` | 4 | `u32` | `(hypothesis: collision related, e.g. hub 0xA9A)` | — |
| `+0x20` | 4 | `u32` | `collision record count` | — |
| `+0x24` | 4 | `u32` | `(unknown)` | — |
| `+0x28` | 4 | `u32` | `event table count` | — |
| `+0x2C` | 4 | `u32` | `collision normal count` | — |
| `+0x30` | 4 | `ptr` | `vertex pool (segment 1)` | — |
| `+0x38` | 4 | `ptr` | `collision records (*Gex 3 collision (verified by code and on all 30 level files unless marked)*; earlier hypothesis "visibility" was wrong)` | — |
| `+0x3C` | 4 | `ptr` | `event table (ptr[+0x28])` | — |
| `+0x40` | 4 | `ptr` | `collision normals (right after the vertex pool)` | — |
| `+0x58` | 4 | `ptr` | `material DL pool (segment 2)` | — |
| `+0x5C` | 4 | `ptr` | `texture/TLUT pool (segment 3)` | — |
Material table:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | n | Material count. |
| 0x04 | 4 × n | u32[] | entries | Material pointers. |

Object-name list; loader replaces names with object pointers:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | n | Object-name count. |
| 0x04 | 8 × n | u8[][8] | names | Eight-character names. |

Segments 1–4 are set every frame by `0x80022230` (F3DEX2 `G_MOVEWORD` `DB06…`).

**Tree** nodes are 24 bytes from `scene+0x00`:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 12 | `s16[6]` | `bounds` | Minimum and maximum X, Y, and Z. |
| `0x0C` | 1 | `u8` | `type` | 1 inner, 2 leaf. |
| `0x0D` | 1 | `u8` | `collisionCount` | Leaf collision-record count. |
| `0x0E` | 2 | `u16` | `splitOrId` | Inner split value (hypothesis), or leaf identifier. |
| `0x10` | 4 | `ptr` | `childAOrCollision` | Inner child A, or leaf collision records. |
| `0x14` | 4 | `ptr` | `childB` | Inner child B. |

The hub has 1,556 inner nodes and 1,557 leaves.

**Fragments** follow each leaf record inline and end with a `u32 0` plus 4 pad bytes `CDCDCDCD`:
| Fragment | Offset | Size | Type | Field | Description |
|---|---:|---:|---|---|---|
| A | `0x00` | 2 | `u16` | `flags` | Bit 0 is clear. |
| A | `0x02` | 2 | `u16` | `nbytes` | Command byte count. |
| A | `0x04` | 2 | `u16` | `material` | Material index. |
| A | `0x06` | 2 | `u16` | `zero06` | Zero. |
| A | `0x08` | 4 | `u32` | `zero08` | Zero. |
| A | `0x0C` | 4 | `u32` | `runtime` | Runtime field. |
| A | `0x10` | `nbytes` | Gfx | `commands` | Contains `G_VTX`, `G_TRI1`, and `G_TRI2`; no `G_DL` or `G_ENDDL`. |
| B | `0x00` | 2 | `u16` | `flags` | Bit 0 is set; observed values are 5 and 9. |
| B | `0x02` | 2 | `u16` | `nbytes` | Total fragment byte count. |
| B | `0x04` | 4 | `ptr` | `specialMaterial` | Special-material record. |
| B | `0x08` | `nbytes - 8` | Gfx | `commands` | Command bytes followed by `G_ENDDL`. |
Each frame, for every visible material, the game emits `DE000000 {material DL}` followed by a verbatim
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
- **2:** a flipbook driven by the global frame counter `[0x800A6174]`:

  | Offset | Size | Type | Field | Description |
  |---:|---:|---|---|---|
  | 0x00 | 2 | u16 | kind | Material kind. |
  | 0x02 | 2 | u16 | frameCount | Number of display-list pointers. |
  | 0x04 | 4 × frameCount | u32[] | displayLists | Linked display-list pointers. |

- **4:** a procedural texture (`0x80029690`);
- **6:** handled by `0x800295FC`;
- **8:** handled by `0x800291A0`.

For the viewer, use the first frame DL (`entry+4`). Special records, referenced by type-B fragments,
carry extra DLs and colours (hypothesis: animated screens and water).

**Fog, clear colour, projection** (code `0x8002D4EC..0x8002D5A0`, `0x80022464`; frame values match):
- Fog colour = clear colour = header +0x4C RGB. `gSPFogPosition(min(u16 +0x56, 993), 1000)` gives
  `DB080000 476DB993` (18285, −18029).
- Near 220. Far varies per level at runtime (10001 hub, 12009 anime1, 14010 snow96, 12000 endboss1),
  hypothesis related to header +0x54.
- Per-level values for all 30 levels: `g3lvl/levelheaders.txt`. The colour is black for most levels;
  snow96, beane1 and dsnw1 use 00A0F8, roo11 080838, tank11 00000C, water16 00141E, fly77 60C5DC.

**Sky** (header +0x20/+0x24/+0x28):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `u32` | `zero` | Zero. |
| `0x04` | 6 | `s16[3]` | `direction` | Direction X, Y, Z. |
| `0x0A` | 2 | `s16` | `cone` | Visibility cone. |
| `0x0C` | 4 | `ptr` | `displayList` | Segment-2 material followed by segment-4 vertices. |

- Each display list is a segment-2 material
  followed by segment-4 vertices.
- Drawn first with its own projection (`0x8007FF70`), a camera-centred modelview, the texel-only
  combiner `FCFFFFFF FFFCF279`, and no depth. The game only draws camera-facing patches; a viewer can
  draw all of them.
- 17 of 30 levels have one: snow96 14, clue1 1, war01 4, gtown2 2, pirate45 4, beane1 8, mob01 1,
  city1 8, dsnw1 11, burro1 2, roo11 5, tank11 1, wwgex1 2, endboss1 20, gexcave5 1, gexcave8 1,
  fly77 13.

**Instances** (0x34 bytes, header +0x88, count +0x84):
| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `+0x00` | 4 | `s32` | `name index into the header +0x44 list (-1 = none: 331 instances, triggers/cameras hypothesis)` | — |
| `+0x04` | 4 | `ptr` | `parameter block or 0` | — |
| `+0x08` | 2 | `s16` | `angle A,` | — |
| `+0x0A` | 2 | `s16` | `angle B,` | — |
| `+0x0C` | 2 | `s16` | `angle C   (4096 = 360°; C = Z verified visually)` | — |
| `+0x0E` | 2 | `u16` | `flags/variant (hypothesis: mission/state group — explains objects placed but not visible in game)` | — |
| `+0x10` | 6 | `s16[3]` | `x, y, z   world position (verified by placement render)` | — |
| `+0x16` | 2 | `u16` | `radius` | — |
| `+0x1C` | 4 | `ptr` | `TV/warp parameter record` | — |
| `+0x28` | 4 | `ptr` | `(door links)` | — |
TV/warp parameter record, four-byte prefix followed by a string:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | u16 | a | Hypothesis: remotes required. |
| 0x02 | 2 | u16 | b | Unknown. |
| 0x04 | Variable | u8[] | namePrefix | Target level-name prefix. |

The rotation order is **hypothesis**. Gex 64's verified order is `T · Rx · Ry · Rz`; Gex 3 was only
checked for Z rotations. Use the Gex 64 order and check in the viewer against the hub render.

**Object files** (relocated, data-relative pointers):
| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `+0x0C` | 4 | `ptr` | `mesh list` | — |
| `+0x10` | 4 | `ptr` | `animation list (0 for static props)` | — |
| `+0x14` | 8 | `u16[4]` | `x4 distances (hypothesis LOD/draw)` | — |
| `+0x1C` | 4 | `ptr` | `script names` | — |
| `+0x20` | 4 | `ptr` | `behaviour class name (8 chars)` | — |
| `+0x24` | 4 | `ptr` | `object name` | — |
| `+0x28` | 4 | `ptr` | `model list (344 objects)` | — |

Mesh known fields:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `+0x00` | 2 | `u16` | `nverts` | — |
| `+0x04` | 2 | `u16` | `nfaces` | — |
| `+0x06` | 2 | `u16` | `nsegments` | — |
| `+0x08` | 4 | `ptr` | `vertices (eight-byte layout below)` | — |
| `+0x0C` | 4 | `ptr` | `colours (u32 RGBA per vertex)` | — |
| `+0x14` | 4 | `ptr` | `faces (12-byte layout below)` | — |
| `+0x18` | 4 | `ptr` | `segments (bone/part table)` | — |
| `+0x34` | 4 | `ptr` | `texture pool (segment 5)` | — |

UV record, 20 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | u16 | zero00 | Zero. |
| 0x02 | 2 | u16 | materialOffset | Material display-list offset. |
| 0x04 | 12 | s16[6] | texcoords | S0,T0,S1,T1,S2,T2. |
| 0x10 | 4 | u8[4] | pad10 | Padding. |

Mesh vertex, eight bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 6 | s16[3] | position | X, Y, Z. |
| 0x06 | 2 | u16 | unknown06 | Unknown. |

Mesh face, 12 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 6 | u16[3] | vertices | Vertex indices. |
| 0x06 | 1 | u8 | unknown06 | Unknown. |
| 0x07 | 1 | u8 | flags | Face flags. |
| 0x08 | 2 | u16 | zero08 | Zero. |
| 0x0A | 2 | u16 | uvRecordOffset | UV-record offset. |
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
- Hub TVs are `lvltv*` instances whose +0x1C record names the target level prefix (*Gex 3: Deep Cover Gecko (30 table entries; names from the string table, verified)* for the
  mapping). Its `a` field is probably the remotes needed (hypothesis).
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

##### Gex 3 collision (verified by code and on all 30 level files unless marked)

**Collision records.** Each tree leaf lists `u8 count` (`+0x0D`) variable-length records at `ptr +0x10`. They are
stored in tree order from `scene+0x38`, and the total equals `scene+0x20` in every level (338,922 faces in all).
The reader is the collision loop at `0x80016F60..0x800172A4`:
| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `+0x00` | 2 | `u16` | `base` | — |
| `+0x02` | 2 | `u16` | `corners` | vertex k = base + ((corners >> 5k) & 0x1F), k = 0..2 (bit 15 unused); world vertex pool (segment 1) |
| `+0x04` | 2 | `s16` | `normal` | index into scene+0x40 (count scene+0x2C); negative = negated entry |
| `+0x06` | 2 | `u16` | `surface` | low 5 bits = type; the query skips a face when (1 << type) & mask (0x80016F9C) |
| `+0x08` | 2 | `u16` | `event index     only when surface & 1 and (surface & 0xE) is 4, 10 or 12 (record size 10, else 8)` | — |
- **Record size rule:** it comes straight from the loop step at `0x80017254`. With it every leaf's run ends where the
  next leaf's starts, in all 30 levels. The last run ends 4–12 bytes before `scene+0x3C`, padded with `CDCD`.
- **Corner decode:** also used by `0x80013AE8`, `0x80013C44` and `0x80013CC4`, which load `scene+0x30 + 16 × (base + delta)`.
  Typical quads are two records with corners `0x0820` (+2, +1, +0) and `0x0062` (+0, +3, +2).
- **Normals:**

  | Offset | Size | Type | Field | Description |
  |---:|---:|---|---|---|
  | `0x00` | 2 | `u16` | `w` | Low 14 bits are sign-extended X; high two bits are returned separately. |
  | `0x02` | 2 | `s16` | `y` | 4.12 Y. |
  | `0x04` | 2 | `s16` | `z` | 4.12 Z. |

  X, Y, and Z are in 4.12
  (`0x80012B0C`). The top 2 bits of w are returned separately: 0 = x-dominant, 1 = y-dominant, 2 = z-dominant, 3 =
  mixed (from the entries' directions in 3 levels; **hypothesis:** the projection axis for the point-in-triangle test).
  338,878 of 338,891 non-degenerate faces have dot ≥ 0.98 between this normal and the winding normal. The maximum
  |index| is `scene+0x2C − 1` in every level.
- **Vertices:** these are the render vertices, as in Gex 64: 96–98% of faces lie exactly on a drawn triangle (*Collision (both games)*).
- **Surface word:**
  - types (low 5 bits) over all levels: 0 (215,397 plain), 2 (54,668), 16 (16,471), 1, 4, 6, 24, 8, 9, 5, 18, 17, 13, 11,
    3, 7, 23;
  - upper bits `0x20`, `0x40`, `0x80`, `0x800` and `0x4000` also occur (e.g. `0x4000` on 7,995 faces);
  - events (surface with an index): type 5 (1,381), type 11 (167), type 13 (232). For types 5 and 11 (`(s & 0xE)`
    = 4 or 10) the table entry is passed to `0x80055194` with the actor. For type 13 (12) the entry + 4 is stored at
    actor `+0xF4`.
  - 23 type-5 indices in two levels exceed `scene+0x28`. The game does not check the bound (it only skips negative
    values in one path).
  - Entries of the `scene+0x3C` table are variable records, e.g. the hub's `00000001 00000048 "gexcave7"`.
    **hypothesis:** type 5 = warp or trigger surfaces; the type names are not traced.

**Invisible objects.** The viewer hides "marker" objects: meshes of at most 18 triangles whose textures are all black
(sound emitters and generators such as sfxwind, cricket, waterg; 278 placements in all). No other class is hidden.

**Viewer mapping (both games, `src/rom/gex`).** The collision faces make up one mesh in a hidden `collision` layer
(kind `collision`). Each face is coloured by its normal: floor (z > 0.5) green, wall orange, ceiling purple. A face with
a non-zero surface word gets a colour per value mixed in, and a face with an event record is tinted red. Faces are
lifted 1 unit along the normal and drawn as a translucent decal. `Batch.triSource` is the record offset, and the mesh
info lists offsets, counts and a flag/surface histogram. The hidden objects above are untextured, with a colour per
class, in a hidden `invisible objects` layer. The world and the drawn objects are in the `world` and `objects`
layers, shown as before. The overlay is appended after `buildLevel`, so bounds and the unplaced list are unchanged.

### 3.3 Geometry

#### Level geometry (Gex 3)

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
- The hub frame list emits 72 material groups; each is `DE000000 {material DL}` followed by a verbatim
  copy of the fragment commands.
- The fog moveword `DB080000 476DB993` and the clear colour `F7000000 053F053F` (snow96) equal the
  header-derived values.
- Frame DL opcode histograms: `g3lvl/hub_top.txt`, `anime_top.txt`, `snow_top.txt`, `endboss_top.txt`.

### 3.4 Display lists and render state

#### Display lists and coordinates (summary; details from the level passes in *Level format*)

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

### 3.6 Collision

No emulator was used. All checks are static (disassembly of the main images and the extracted level files) or run
through the viewer's loaders. Scratch scripts are in `gexcoll/`.

| check | method | result |
|---|---|---|
| Gex 64 record size | leaf pointers against sequential walks with 5 candidate rules (ROM analysis) | `flags & 0x4400` → 20 bytes: 0 misaligned leaf pointers in looney30/map5/scifi10/gillig1; other rules 2–652 |
| Gex 64 normals | face normal vs winding, edge normals vs face/edge | dot ≥ 0.995; edge normals in-plane and outward (8,995/9,000) |
| Gex 64 second BSP | every leaf list in 31 levels vs the instance array | 7,601 pointers, all on 48-byte instance records, all 6,007 instances covered |
| Gex 3 record size | loop code `0x80017254` + leaf gaps in 30 levels (ROM analysis) | 0 mismatches (last run padded with `CDCD`); the `surface & 4` rule gave 2,540 bad leaves |
| Gex 3 normals | `0x80012B0C` decode vs winding (ROM analysis) | 338,878 / 338,891 faces dot ≥ 0.98 |
| face counts | viewer load of all 31 + 30 levels (`loadtest.ts`) | decoded faces = `scene+0x1C` (Gex 64) / `scene+0x20` (Gex 3) in every level, 0 skipped records |
| alignment with the world | collision triangles (minus the 1-unit lift) keyed against world triangles (`render.ts`) | Gex 64: hub 95.7%, looney30 93.1%, scifi10 88.5%, kungfu4 98.9%; Gex 3: gexcave6 95.9%, snow96 96.7%, anime1 96.9%, endboss1 98.0% |
| visual | offline raster, start camera and top view, world vs world + collision | overlays follow floors, walls and ramps; images `renders/*_cmp.png`, `*_only.png` |

### 3.7 Environment, sky, fog, and lighting

### 3.8 Cameras and paths

## 4. Objects

### 4.1 Placement records

### 4.2 Object and model formats

#### Object tables (both games, same record layout, verified)

16-byte records, sorted by name:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 8 | u8[8] | name | Eight-character name. |
| 0x08 | 4 | u32 | romStart | Inclusive ROM start. |
| 0x0C | 4 | u32 | romEnd | Exclusive ROM end. |

Names are 8 characters
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

#### Detection and game objects

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

### 4.4 Behaviors, triggers, and scripted objects

## 5. Audio

### 5.1 Audio storage and banks

### 5.2 Sequence format and driver

#### Level load sequence

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

#### Engine (both games: libmus, verified)

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

#### Rendering offline to PCM (both games)

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

#### Gex 3 specifics (verified by disassembly and RDRAM unless marked)

**Loading** (`0x8005AAE8(level)`, on every level load), from the level record (*Level tables*):

| field | read to | meaning |
|---|---|---|
| `+0x44` | `0x80096F20` | level SFX pointer bank; `MusPtrBankInitialize(0x80096F20, wbk = rec+0x40)` |
| `+0x40` | – | level SFX wave bank (ROM offset, streamed) |
| `+0x48` | `0x800CFD20` | level *fx bank* (libmus effect file, below) |
| `+0x38` | `0x800FEE48` | **not audio**: lip-sync table for Gex's voice clips |
| `+0x4C` | `0x800FF290` | Level song ROM start (raw DEFLATE). The **music pointer bank** ROM `0xD204A0..0xD2D3C0` is then read to `0x800D1E80`, with music wave bank ROM `0xBD2050` |
| `+0x50` | — | Level song ROM end (exclusive). |
| `+0x37` (low byte of `+0x34`) | – | first level-local SFX id of the voice-clip table |

Global SFX: pointer bank ROM `0x255D10..0x25AEE0` (copied to `0x8010B370`), wave bank `0x25AEE0`, fx
bank ROM `0x31E5C0..0x31F2F0`. `musConfig` is built at `0x8005A970`: 24 voices, libmus allocates 28
channel structs, and channels 0–3 are voiceless master-track channels. Output rate: 22050 requested,
**22047 Hz actual** (ALSynth `+0x44`). Master volumes: songs `0x1FFF`, effects `0x31FE` (defaults
scaled by the options). Reverb is effectively off: `MusSetFxType(0)` gives a single section with gain 0.

**Song header** (version `0x215` in all 15 songs):
| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `+00` | 4 | `u32` | `version (0x215)` | — |
| `+04` | 4 | `u32` | `numChannels (14)` | — |
| `+08` | 4 | `u32` | `numWaves` | — |
| `+0C` | 4 | `u32` | `-> u32 channelData[numChannels]` | — |
| `+10` | 4 | `u32` | `-> volumeData[]` | — |
| `+14` | 4 | `u32` | `-> pitchBendData[]` | — |
| `+18` | 4 | `u32` | `-> envelope table (7 bytes/entry)` | — |
| `+1C` | 4 | `u32` | `drums` | — |
| `+20` | 4 | `u32` | `-> u16 waveTable[numWaves]  (song wave index -> music pointer-bank index; 0xFFFF = rest)` | — |
| `+24` | 4 | `u32` | `-> master track (tempo + rests; runs on a voiceless channel 0..3)` | — |
| `+28` | 4 | `u32` | `relocated flag (0 in ROM)` | — |
Drum record, six bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | u16 | wave | Wave index. |
| 0x02 | 2 | u16 | env | Envelope index. |
| 0x04 | 1 | u8 | pan | Pan. |
| 0x05 | 1 | u8 | note | Note. |

**Fx bank:**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `u32` | `effectCount` | Number of effect records. |
| `0x04` | 4 | `u32` | `effects` | Effect table pointer/offset. |
| `0x08` | 4 | `u32` | `waveCount` | Number of waves. |
| `0x0C` | 4 | `u32` | `flags` | Flags. |
| `0x10` | 4 | `u32` | `ptrBank` | Runtime pointer bank. |
| `0x14` | `2 * waveCount` | `u16[]` | `waveTable` | Wave map. |
| following | `8 * effectCount` | records | `effects` | Eight-byte effect records below. |

Effect record, eight bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | streamOffset | Effect stream offset. |
| 0x04 | 4 | u32 | priority | Effect priority. |

Effect streams use the same command language.

**Differences from the Gex 64 revision** (*Song format: Gex 64 revision and Gex 3 differences* applies otherwise):

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

**Loop rule:** every stream, including the master track, ends in `95 FF {body} 96`, and all bodies
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
**hypothesis:** the credit describes the shared Crystal Dynamics (PlayStation) music system.

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
{i|all} | samples`); verifier `g3audio/verify_ram.ts`; song listings in `g3audio/songs/`.

#### Difficulty and risks (music; level parts in *Level format*)

- **Music:** medium. Reference TypeScript implementations already exist (`g64audio/gex64music.ts`,
  `g3audio/gex3music.ts`) and match the game's player state exactly. Rendering a full looping song
  takes ~1 s of CPU per song, so render in the worker, one track on demand.
- **Risks:** reverb isn't rendered, so songs sound drier than in game. PCM loudness and rounding
  differences can't be checked by ear. Gex 64 levels with several songs (Toon TV, Circuit Central,
  Gecques Cousteau) switch between songs by area triggers, so list each song separately.

| check | method | result |
|---|---|---|
| player port vs game | `g3audio/verify_ram.ts` runs the port to the dump's song time and compares 23 fields of every channel | **all 15 music channels identical** in 3 dumps: war01 song 14 at tick 280 (`g3audio/run/r80080.bin`), push44 song 12 at ticks 197 and 1408 (`r2.bin`, `r3.bin`) |
| engine parameters | RDRAM | output rate 22047 Hz (ALSynth `0x8010A120+0x44`); 28 channels; tick 0x411A us; master volumes `0x31FE`/`0x1FFF`; music pointer bank at `0x800D1E80` relocated with `detune[0]` = −47.43 as predicted; song at `0x800FF290` equal to the inflated ROM song |
| song selection | attract demos | level 3 → song 14, level 17 → song 12 |
| static | all 15 songs inflate; every stream parses to one `95 FF..96` loop with equal body lengths; every wave index fits its bank; 31 PtrTables/WaveTables pairs, all referenced | pass |
| rendered audio | `g3audio/wav/gex3_songNN_*.wav` (gain 7, no clipping) + `summary.json` | **not** compared with real game audio; reverb is off in game anyway; state past a loop point not checked in RAM |

### 5.3 Instruments and sample encoding

#### Sample banks (both games)

**Pointer bank** (`.ptr`; offsets relative to the bank start, relocated at init by
`MusPtrBankInitialize`):
| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `+00` | — | `char` | `label[16]` | "N64 PtrTablesV2\0" |
| `+10` | 4 | `u32` | `flags` | (bit 31 set at runtime = relocated) |
| `+14` | — | `char` | `wbkName[12] e.g. "orchestr.wbk"` | — |
| `+20` | 4 | `u32` | `count` | — |
| `+24` | 4 | `u32` | `basenote` | -> u8[count] |
| `+28` | 4 | `u32` | `detune` | -> 4 bytes per wave; byte 0 = s8 cents (overwritten at init with an f32 pitch offset) |
| `+2C` | 4 | `u32` | `waveList` | -> u32[count] offsets of ALWaveTable records |
| 0x30 | Variable | wave records | waves | ALWaveTable records, each followed by its ALADPCMBook and ALADPCMloop. |

ALWaveTable, 24 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | base | Offset into wave bank; its ROM base is added unless the top byte is 0xFF. |
| 0x04 | 4 | s32 | len | Encoded length. |
| 0x08 | 1 | u8 | type | 0: VADPCM, as used by every Gex wave. |
| 0x09 | 1 | u8 | flags | Flags. |
| 0x0A | 2 | u16 | pad0A | Padding. |
| 0x0C | 4 | u32 | loop | ALADPCMloop pointer; zero means absent. |
| 0x10 | 4 | u32 | book | ALADPCMBook pointer. |
| 0x14 | 4 | u32 | pad14 | Padding. |

ALADPCMBook, eight-byte header plus coefficients:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | s32 | order | 2. |
| 0x04 | 4 | s32 | npredictors | 4. |
| 0x08 | 16 × order × npredictors | s16[] | book | Predictor coefficients. |

ALADPCMloop, 0x2C bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | start | First sample in loop. |
| 0x04 | 4 | u32 | end | Exclusive loop end. |
| 0x08 | 4 | s32 | count | −1 repeats forever. |
| 0x0C | 0x20 | s16[16] | state | Decoder state. |

Pitch offset per wave, in semitones: `pitchOffset[i] = (s8)detune[i*4] / 100 + (s8)(basenote[i] - 48)`.
For example, basenote 244 gives −60, so note 60 plays the sample at 22050 Hz.

**Wave bank** (`.wbk`): a 16-byte header `N64 WaveTables \0`, then raw 9-byte VADPCM frames (16 samples
each). The game streams it from ROM and never copies it. Decode with the standard libultra VADPCM
predictor using the wave's book. Loops follow `alAdpcmPull`: the loop body restarts from the stored
decoder state.

### 5.4 Music catalog and loop points

## 6. Unused and hidden content

### 6.1 Unreferenced assets

Findings from the filesystem, level and music passes (evidence column says how each was established):

| game | what | where | evidence it is unused / hidden |
|---|---|---|---|
| Gex 3 | *(not unused)* ROM `0x1A92090-0x1D3B030`, 2.7 MiB | Agent Xtra talking-head video, 1,341 frames x 0x820 bytes (64x64 CI4 + palette) | the filesystem pass flagged it as unreferenced (no table points to it, not read during boot/intro/title/anime1). The level pass found the Mission Control overlay reads it as base + frame x 0x820, with clips starting at frames 0, 402, 644, 900 and 1158. Sheet: `g3lvl/renders/unknown_region_CI4_frames_every16.png` |
| Gex 3 | **debug level select in retail** | pause, hold R, press B A B Z C-left C-right C-up Z (button table `0x800809D0`, checker `0x8002B360`) | opens pause-menu page 28 "select level" (handler `0x800370FC`, ids 0..26). **Confirmed in the emulator** by the level pass. Page 29, the "sound effects" / "level specific effects" test (`0x8003728C`), is opened from the pause options/stats/save-game menu (`0x80036E80`), so it is probably a normal menu page (not fully traced). Screenshot: `g3lvl/shots/cheat_select_level_page_endboss1.png` |
| Gex 3 | invulnerability code | pause, hold R, press C-up C-left B A C-down C-right C-up Z (table `0x800809E0`) | sets bit 0x400 in `0x800A55C4`; `0x8003F328` then skips the damage. Static analysis only |
| Gex 3 | debug font and camera | object `dbgfont_` (loaded in every level), string `dbg_cam_`, "start key, tween: %d, %d" | debug assets and strings left in retail |
| Gex 3 | skipped category slot | level record `+0x0C` runs 5..0x10 over the 11 TV levels with 0x0D missing | hypothesis: a cut 12th TV level slot |
| Gex 3 | no orphan files | all 30 level records, 29 audio banks and 963 objects | every object name occurs in at least one level file, overlay or main code (711 are used by exactly one level) |
| Gex 3 | unused music samples | music pointer-bank indices 61, 64, 160, 178, 179, 203, 219, 268, 274, 276, 287 (36,828 of 1,366,974 wave bytes) | referenced by no song `waveTable`, and no song uses drum maps. Exported: `g3audio/wav/unused/music_sample_NNN_romXXXXXX.wav` |
| Gex 3 | SFX pointer-bank entries missing from their fx bank | global 53; snow96 38; war01 18, 26; myth64 30; anime1 44; gexcave7 17 | not in the fx bank's `waveTable`, so no effect can play them (static scan) |
| Gex 3 | ignored effects change in a song | the Egypt song (song 7) master track contains `AA 02` | `MusSetSongFxChange` is never called, so the command does nothing |
| Gex 3 | unused libmus features | `MusStartSongFromMarker`, `MusStartEffect`, `MusHandleSetPan/SetFreqOffset/SetTempo/SetReverb/Pause`, `MusSetMarkerCallback`, `MusSetSongFxChange`; song commands 80 83 84 88-8A 8C 8E 8F 91-94 97 98 9A 9B 9D-A1 A3-A7 A9 AB | no callers or occurrences |
| Gex 3 | **540 unreferenced material entries** | 540 of 4,529 material-table entries in 27 levels, e.g. clue1 53, gtown2 55, hub 43; none in war01, push44, wwgex1 (`g3lvl/unused_materials.txt`) | referenced by no fragment, sky DL, special record or animation record. **Caveat:** per-level overlay code was not scanned, so some of these textures may still be drawn by code |
| Gex 3 | placed but hidden objects | hub (gexcave6) instances such as a purple paw box, a black cube and a red paw icon | render in the placement render (`g3lvl/renders/gexcave6_gamecam_with_objects.png`) but are absent from the game frame (`g3lvl/shots/hub_gexcave6_game_frame_of_ramdump.png`). hypothesis: shown only in certain game states or missions (instance +0x0E) |
| Gex 3 | logic-only instances | 331 instances with name index −1 | no object; hypothesis: triggers, cameras, spawn points |

### 6.2 Cut or inaccessible levels

### 6.3 Debug features

### 6.4 Prototype or revision-specific content

## 7. nviewer implementation

### 7.1 Module mapping

#### Reusable modules

| existing module | reuse for Gex | changes needed |
|---|---|---|
| `inflate.ts` `inflateRaw` | every compressed file in both games (*Compression: raw DEFLATE (both games, verified)*) | none (verified on Gex data) |
| `lzss.ts` | – | not used by Gex |
| `displaylist.ts` `runDisplayList` | world, material and object display lists (F3DEX 1.x for Gex 64, F3DEX2 for Gex 3) | see *Display lists and coordinates* and the detailed level-format passes |
| `texture.ts` | textures uploaded through `G_SETTIMG`/`G_SETTILE`/`G_LOADBLOCK`/`G_SETTILESIZE` in the material DLs | none expected; the Gex 64 level pass reports textures decode correctly with the existing code |
| `util.ts` `pruneUnused`, `emptyBounds` | level assembly | – |
| `music/rush1.ts` `decodeVadpcm`, `RESAMPLE_LUT` | libmus voices (*Rendering offline to PCM (both games)*) | export or move the loop preparation and voice mixer so they can be shared |

#### New modules (suggested names)

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

### 7.3 Approximations and omissions

## 8. Verification and remaining work

### 8.1 Verification evidence

### 8.2 Known unknowns

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

### 8.3 References
