# Yoshi's Story — Nintendo 64 ROM format specification

This manual describes the shipped data formats needed to identify, extract, and
present Yoshi's Story content. Claims state their evidence inline; unsupported
interpretations are labelled hypotheses.

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | no file table: two ROM segments addressed by segmented pointers. Segment 3 castData (0x528430) holds cast records, sprite/tile "units", Yoshi cells and messages; segment 4 worldDatabase (0xB16170) holds world records |
| Compression | `CMPR` + `SMSR00` slide-LZ (16-bit control words, separate literal stream), 702 records, all image data (*Compression: `CMPR` + `SMSR00` slide-LZ (verified bit-exact)*) |
| Graphics microcode | S2DEX 1.06 (task microcode) with in-list switches to F3DEX.NoN 1.23 |
| Geometry | 0x118-byte world record + one scene + 12-byte actor records in world pixels (*Level format*) |
| Textures | **2D tile layers**: 16 × 16 CI8 tiles, RGBA5551 palette, 256 px blocks, 1 to 3 layers per world. Composed on the CPU into 336 × 256 buffers and drawn with S2DEX `G_BG_1CYC` (*Layers*, *How the game builds a frame*) |
| Collision | per-unit u16 map on the main layer: kind/attr bits plus one of 128 16 × 16 shape masks (*Tile maps and collision (verified pixel-exact against the game's BG buffers)*) |
| Music driver | Nintendo EAD “Nas” sequence engine; 62 sequences and 62 banks at 32 kHz. |
| Audio microcode | `aspMain`, identified by rsp-hle as `nead_ys`. |
| Sample encoding | Nintendo VADPCM in two sample banks. |
| Levels | **world** (one room); 143 worlds; 24 courses on 6 pages, with sub-areas linked by 227 exits (*Levels*) |
| Memory requirement | Base 4 MiB. |
| Viewer support | layer planes at the game's depths under the game's 40° camera: a side view with panning, plus free fly (*Mapping onto the viewer*) |
| Parallax | `r = 329.7 / (floor(z) − 500 + 329.7)`; layer pixel at screen (0, 0) = `r·cam + floor16(r·cam0 − a) − r·cam0` on both axes. This is exactly a 40° perspective camera 329.7 px in front of the main plane, with a per-layer anchor |
| Objects | sprites (S2DEX objects, CI8/CI4 with TLUT) and, for Yoshi and some actors, F3DEX textured quads under the 40° projection (*How the game builds a frame*) |
| Handedness / units | world pixels, y down; no mirroring |
| Source leak | an internal North American product build compiled 30 April 1998 (sources dated 18–31 March 1998). It is not the J build, but 77% of its bytes are found in the J ROM (*Unused and hidden content*) |

### 1.2 ROM identification

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| Japan | `YOSHI STORY` | `NYSJ` | 0 | 16 MiB (`0x1000000`) | `2DCFCA60` | `8354B147` | `ff320b4122894c773f465a8996e82a00f3116e83` | CIC-6106 | — |

Verified from the normalized ROM headers and complete-image SHA-1 hashes.

### 1.3 Terminology and conventions

ROM and memory ranges are half-open. Offsets, addresses, encoded sizes, masks,
and opcodes are hexadecimal unless stated otherwise. Multi-byte CPU fields are
big-endian. RAM addresses are virtual unless explicitly identified as physical;
segmented, VROM, and file-relative addresses are named at each use.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

#### Entry and code segment (verified)

- **Entry stub** at 0x80000400 (ROM 0x1000): clears bss 0x800B9B90–0x801172C0 (size 0x5D730), sets
  sp = 0x801011C8 and jumps to `boot` at 0x80065D4C. `boot` runs `osInitialize` and starts the idle and main
  threads (leak: `SRC_GWY/yoshi_systemS_v1/system.c:boot`, `main.c:mainproc`).
- **Code segment:** ROM 0x1000–0xBA790 ↔ RAM 0x80000400–0x800B9B90, **stored uncompressed and not relocated**. An RDRAM
  dump taken at Yoshi Select equals the ROM except for 209 words of run-time-modified `.data`, all at 0x8009A8B0 or
  above. The makerom stub takes up 0x80000400–0x8000045F; `.text` starts at 0x80000460, so
  `_codeSegmentRomStart` = 0x1060.
- **Link order** is the leak's `SRC_GWY/codesegment.mmap` (`audio.o`, `actor_yoshi.o`, the managers, `systemS.o`,
  `y_fault`, libbg, libu64, libc64, libultra), but the sizes differ.
- **Microcodes** sit at the end of `.text`:

  | Microcode | Text | Data | Evidence |
  |---|---|---|---|
  | rspboot | 0x80095C50 (0xD0 bytes) | – | hypothesis (leak order) |
  | `gspS2DEX.fifo` | 0x80095D20, ROM 0x96920 (6,128 bytes) | 0x800B83E0 | text 100% match with the leak; string "RSP Gfx ucode S2DEX 1.06 Yoshitaka Yasumoto Nintendo." at ROM 0xB9118 |
  | `gspF3DEX.NoN.fifo` | 0x80097510, ROM 0x98110 (5,168 bytes) | 0x800B87A0 | gap size equals the leak size; string "RSP Gfx ucode F3DEX.NoN 1.23 …" at ROM 0xB9650 |
  | `aspMain` | 0x80098940, ROM 0x99540 (3,920 bytes) | 0x800B8FA0 | 100% match with the leak |

- **Memory map at run time** (verified with RDRAM dumps):
  - `.bss` runs 0x800B9B90–0x801172C0.
  - The "buffer" segment (frame buffers, RDP FIFO, yield buffer, dynamic display-list buffer, audio heap)
    runs up to `_bufferSegmentEnd` = 0x8020BEB0.
  - Malloc'd memory follows. Level data, sprites and overlays are allocated from the top of the 8 MB, just below
    0x80800000.
- **Game state root:** `__Game` (the leak's `struct game_born`, `yoshi_Gameh_and_message/main.h`) is at 0x800FC0B0.
  Around the page fields, J offsets are the leak's plus 8 (verified by disassembling change_gamePage at 0x80066E48). Storage widths were not established in this description:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x3EC | Unknown | Unknown | page | Current page. |
| 0x3F0 | Unknown | Unknown | newPage | New page. |
| 0x992 | Unknown | Unknown | birthEntry.entryCnt | Entry count. |

#### Overlays (verified)

308 relocatable modules sit back to back from ROM 0xB35EF0 to 0xE67FD0, in the order of the leak's `yoshi.spec`.
They hold enemy and object code (`actor_*`), level gimmicks (`*Master`), the story-book pages (`bkpg_*`, `bookpg_*`:
3D display lists and textures in `.data`), title, select, pause and message screens. Each module is stored **linked at its own
virtual address**. The link addresses are unique and ascend from `OVERLAY_SEGMENT_START` 0x80400000 to 0x807A5040. The
leak's `ovlsegment1..6.o` files are only `ld -r` groupings used by the build.

Module layout (big-endian):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | textSize | u8[] | text | Executable section. |
| textSize | dataSize | u8[] | data | Initialized data. |
| textSize + dataSize | rodataSize | u8[] | rodata | Read-only data. |
| Following | 0x14 + 4 × nRelocs | RelocationHeader | relocations | Header and packed words below. |
| moduleEnd − 4 | 4 | u32 | headerDistance | moduleEnd minus relocation-header offset. |

Relocation header, 20 bytes plus counted relocation words:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | textSize | Stored .text size. |
| 0x04 | 4 | u32 | dataSize | Stored .data size. |
| 0x08 | 4 | u32 | rodataSize | Stored .rodata size. |
| 0x0C | 4 | u32 | bssSize | Unstored .bss size. |
| 0x10 | 4 | u32 | nRelocs | Relocation count. |
| 0x14 | 4 × nRelocs | u32[] | relocations | Packed relocation words. |

Relocation-word fields:

| Bits | Mask | Field | Description |
|---:|---:|---|---|
| 31–30 | 0xC0000000 | section | Section selector. |
| 29–24 | 0x3F000000 | type | Relocation type. |
| 23–0 | 0x00FFFFFF | offset | Byte offset in section. |

- **Relocation entries:** section 1 = `.text`, 2 = `.data`, 3 = `.rodata`. Type 2 = R_MIPS_32, 4 = R_MIPS_26,
  5 = HI16, 6 = LO16. `.bss` isn't stored; its size in RAM is ROM size + bssSize.
**Overlay descriptor (0x10 bytes).** In castData, usually at `castdt + 0x08` (source archive: `castDataObj1.o` relocations `_ovlActor_*SegmentRomStart…`). Four modules are empty stubs without descriptors.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | romStart | Inclusive ROM start |
| 0x04 | 4 | u32 | romEnd | Exclusive ROM end |
| 0x08 | 4 | u32 | vramStart | Linked RAM start |
| 0x0C | 4 | u32 | vramEnd | Linked RAM end |

- **Loader:**
  - `LoadFragment2` (0x80085DD4) → `LoadFragmentFix2` (0x80085D28) → `dmacopy_fg`, then `relocate_fragment`
    (0x80085650), `bzero` of the bss, and a cache flush.
  - castDBManager keeps a ROM → RAM record, so each module is loaded once.
  - Relocation, with Δ = load address − vramStart. R_MIPS_32 adds Δ only when `(w & 0x0F000000) == 0`, which leaves
    segmented `0x03…`/`0x04…` pointers alone. R_MIPS_26 retargets `((w & 0x3FFFFFF) << 2 | 0x80000000) + Δ`.
    HI16/LO16 pairs are matched by register and get the same test.
  - A Python relocation of two loaded modules equals RDRAM with 0 differing words.
- **Relevance to the viewer:** the book pages and 3D set pieces (*Level format*, *How the game builds a frame*) are display lists in overlay `.data`. The
  viewer only needs the pointer rule (`vram` → module offset); it doesn't need to run the relocation.

The full module list is `layout/ovl_names.tsv` (index, ROM and VRAM ranges, section sizes, relocations, name, name
source).

### 2.2 Memory and address mapping

#### Segment tables and addressing (verified)

- **`SegmentRomStart[]`** is at RAM 0x800AB4E4 (ROM 0xAC0E4) and holds `{0x1060, 0, 0, 0x528430, 0xB16170, 0}`.
  The indexes follow the leak's `SRC_GWY/yoshi_spec.h`: 0 code, 1 STATIC, 2 DYNAMIC, 3 CASTDATA, 4 WORLDDATABASE,
  5 AUTOPLAYDATA. Slot 5 is 0 because J has no attract-demo data.
- **Segments 3 and 4 are never loaded whole.**
  - Every read goes through `foregroundDMA(dst, segaddr, size)` (0x80065E9C), which reads ROM
    `SegmentRomStart[segaddr >> 24 & 0xF] + (segaddr & 0xFFFFFF)`.
  - Pointers inside cast and world records are these segmented ROM addresses. For the viewer:
    `0x03xxxxxx` → ROM `0x528430 + x`, and `0x04xxxxxx` → ROM `0xB16170 + x`.
- **Display-list segments:** `SegmentBaseAddress[16]` is at 0x800FF188.
  - [1] = 0x0020BEB0 (STATIC).
  - [13] = the RCP dynamic list buffer (0x1986C0 at Yoshi Select).
  - [14] = the Z-buffer.
  - [15] = the current frame buffer. It alternates between two buffers: 0x1622C0 at Yoshi Select, 0x13CAC0 in a captured course frame.
  - Frame display lists use these through `gsSPSegment` (*How the game builds a frame*).

### 2.3 ROM map and asset organization

#### ROM map (verified; covers every byte)

| ROM start | ROM end | Name | Addressed as |
|---|---|---|---|
| 0x000000 | 0x000040 | header | – |
| 0x000040 | 0x001000 | IPL3 (6106) | – |
| 0x001000 | 0x0BA790 | code | RAM 0x80000400 |
| 0x0BA790 | 0x0E6870 | Audiobank (instrument banks) | ROM offset (*Music*) |
| 0x0E6870 | 0x4F50B0 | Audiotable (VADPCM samples) | ROM offset |
| 0x4F50B0 | 0x528430 | Audioseq (sequences) | ROM offset |
| 0x528430 | 0xB16170 | castData: cast tables, units (sprites), Yoshi cells, messages | segment 3, `0x03xxxxxx` |
| 0xB16170 | 0xB35EF0 | worldDatabase: world records + warp data | segment 4, `0x04xxxxxx` |
| 0xB35EF0 | 0xE67FD0 | 308 overlays | VRAM 0x80400000… |
| 0xE67FD0 | 0x1000000 | 0xFF padding | – |

- **Audio ends:** the audio segment ends are inferred from where the next segment starts. The game only loads the
  three start constants, at 0x80007DBC/DD0/DE4. It then relocates each file table by its start: sequences at
  0x800B9770, banks at 0x800B9280, samples at 0x800B9B60.
- **Segment boundaries:** segment 3 (castData) ends exactly where segment 4 (worldDatabase) starts, at 0xB16170 (`SegmentRomStart[4]`).

### 2.4 Compression formats

#### Compression: `CMPR` + `SMSR00` slide-LZ (verified bit-exact)

- **Inventory:**
  - This is the only codec in the ROM: 702 records, all 4-byte aligned, all inside unitData
    (ROM 0x562780–0x942B60).
  - Code, overlays, audio, Yoshi cells, messages and the world database are uncompressed.
  - The ROM has no Yay0, Yaz0 or MIO0 data.
- **Where it comes from in the leak:**
  - `PR/dmamgr.h` (`head_t`, `DMAMGR_MAGIC`).
  - `TOOLS/srdpress` and `SRC_GWY/srcpress.c`, which run the "slienc" encoder; the encoder itself isn't in the
    leak.
  - `PR/slidec.o:slidec`. The J decompressor `slidec` at 0x8006D950 is byte-identical to the leak's
    `SRC_GWY/melt.o:slidec`.

**CMPR wrapper**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u8[4] | magic | ASCII CMPR. |
| 0x04 | 4 | u32 | storedSize | compsize: bytes the game reads after this header (the stream length + 16, rounded up to even) |
| 0x08 | 4 | u32 | decodedSize | origsize: decompressed size |
| 0x0C | 4 | u32 | reserved | 0 |
| 0x10 | Variable | u8[] | stream | SMSR stream |

**SMSR00 stream**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 8 | u8[8] | magic | `SMSR00\0\0` |
| 0x08 | 4 | u32 | decodedSize | decompressed size |
| 0x0C | 4 | u32 | literalOffset | literal offset, relative to +0x10 |
| 0x10 | literalOffset | u16[] | controlAndMatches | stream A: control words and match words, interleaved, big-endian |
| 0x10 + literal offset | Variable | u8[] | literals | stream B: literal bytes |

```
a = 0x10; b = 0x10 + litOffset; out = 0; bits = 0
while out < size:
  if bits == 0: ctrl = u16(a); a += 2; bits = 16
  if ctrl & 0x8000: dst[out++] = src[b++]                     # 1 = literal (MSB first)
  else: w = u16(a); a += 2
        len = (w >> 12) + 3; from = out - (w & 0xFFF) - 1       # length 3..18, distance 1..4096
        repeat len: dst[out++] = dst[from++]                   # byte-wise, overlap allowed
  ctrl <<= 1; bits -= 1
```

There is no end marker; decoding stops when the output reaches the size.

**How reads work** (J libbg dmamgr, verified by disassembly):
- `dmacopy_fg(dst, rom, size)` (0x800814E0) → `dmacopy_bg` (0x80081400) first reads 16 bytes.
- If they start with `CMPR`, it reads compsize bytes into a malloc'd work buffer, runs `slidec`, and frees the
  buffer. Otherwise it reads the whole range.
- So "read N bytes at segaddr X" is `dmaRead(rom, SegmentRomStart[seg] + off, N)`: CMPR records come back
  decompressed to origsize.

**Proof:**
- At a breakpoint on `slidec`, the work buffer held ROM record 0x637C20. The 0x7E00-byte output in RDRAM equals
  ROM analysis and `layout/slide.ts` byte for byte.
- All 702 records decode to exactly origsize.
- The lead re-checked `slide.ts` (`slideDecode`, `readCmpr`, `dmaRead`) against the extracted files: 702 of 702
  are identical (`lead/slidecheck.ts`).
- For the viewer, a new `src/rom/yoshi/slide.ts` can copy `layout/slide.ts` almost verbatim. The existing
  `lzss.ts` doesn't apply: it has a different token layout and no separate literal stream.

#### Extraction

ROM extraction splits the whole ROM in about 2 s:
- output: 1,037 files plus the 702 raw CMPR records; `manifest.tsv` gives path, ROM start and size, kind,
  compression, output size, load address and segment.
- checks: it asserts NYSJ revision 0, the `SegmentRomStart` values, the overlay chain, the padding, and gap-free
  coverage of the ROM.
- reproducibility: the lead re-ran it into `lead/fs_check/`, and the manifest is identical.
- output tree: `boot/`, `code/` (with `code/ucode/`), `audio/{Audiobank,Audiotable,Audioseq}.bin`,
  `seg3_castData/` (per-object files and `cmpr/{rom}_{unit}.bin`), `seg4_worldDatabase/`,
  `overlays/NNN_{name}.bin`.

#### ROM identification, boot, codec, filesystem

| # | Check | Result | Files |
|---|---|---|---|
| 1 | crc32 of IPL3 | 0xACC8580A = CIC-6106 | – |
| 2 | Breakpoint on the PI length write during IPL3 | PC 0x8000005C copies 0x100004 bytes from ROM 0x1000 to RAM 0x400 | `layout/pitrace_boot.tsv` |
| 3 | RDRAM 0x80000400–0x800B9B90 vs ROM 0x1000–0xBA790 | equal except 209 words of run-time `.data` | `layout/r_code.bin` |
| 4 | `SegmentRomStart[]` read at ROM 0xAC0E4; J `foregroundDMA` disassembly loads 0x800AB4E4 | {0x1060, 0, 0, 0x528430, 0xB16170, 0} | – |
| 5 | Overlay chain walked through the trailer words | 308 modules from 0xB35EF0 to 0xE67FD0 exactly | `layout/ovl_names.tsv` |
| 6 | Relocating overlays P_S_hand and P_S_heiho (Python) vs RDRAM | 0 differing words in 3,248 and 1,132 | `layout/r_ovl1.bin`, `r_ovl2.bin` |
| 7 | Breakpoint on `slidec`, dump of its output | ROM analysis = `slide.ts` = RDRAM (0x7E00 bytes, record 0x637C20) | `layout/d1full.bin` |
| 8 | All 702 CMPR records decoded | sizes exact; the lead's `slide.ts` check matches 702 of 702 extracted files | `lead/slidecheck.ts` |
| 9 | ROM extraction re-run by the lead into a separate directory | identical manifest, 1,037 entries, full ROM coverage asserted | `lead/fs_check/` |
| 10 | Course-load DMA trace (Yoshi Select → 1-1) | 1,867 reads: cast tables, cells, units, 50 overlays, messages, world records | `layout/ltrace_lvl3.tsv`, `layout/level_load_summary.txt` |
| 11 | Leak symbol matching (relocation-masked) | 8,397 J symbols | `layout/symbols_j.txt` |

### 2.5 Loading process

### 2.6 Revision differences

## 3. Level data

### 3.1 Level catalog and identifiers

#### Terms (verified)

- **World.** One playable room: a course's main area, a sub-area behind a pipe or door, a boss arena, a menu
  screen. A world has one scene, a list of placed actors and its background layers. The J ROM has **143
  distinct worlds**.
- **Course.** One of 24 story courses, 4 per page on 6 pages. A course consists of several worlds linked by exits.
- **World ID.** An index into the world table (176 entries). Leak names come from `SRC_GWY/worldManager.o`
  `.rel.data`, one relocation per entry (177 in the leak). They are confirmed for J because every course world's
  background casts are named `castdt_wrd_{page}_{course}_{n}*` after the same world. The one quirk: worlds
  `world_5_1_1..4` use layer files numbered `wrd_5_1_0..3`.
- **Page themes** (from the leak's `SOUND_GWY/yoshi_sound.h` page events): 1 grassland (SOGEN), 2 cave/lava (MAGMA),
  3 mountain/sky (MOUNTAIN), 4 jungle (JUNGLE), 5 sea (WATER), 6 castle (CASTLE).

#### Tables (verified)

| Table | ROM | RAM | Layout |
|---|---|---|---|
| World table | 0xACB60 | 0x800ABF60 | 176 eight-byte world-table records (below) |
| Course start/warp rows | 0xACA90 | 0x800ABE90 | `u8[4]` × 26, indexed by course number; rows 0 and 25 are dummies (0x0B). Byte 0 = the course's start world; the 4 slots are the destinations of the in-course warp actors 0x4507–0x450A (slot meaning: hypothesis). Identical to the leak's `warpManager.o` `.data+0x60` |
| Warp EXITIF template | 0xACA30 | 0x800ABE30 | 4 × 24-byte EXITIF (*Exits (EXITIF, 24 bytes; verified)*) |
| Cast table | 0xA6520 | 0x800A5920 | 1,572 twelve-byte cast-table records (below); the leak has 1,582, with six extra 0x473A–0x473F entries plus 0x8129/0x812A and 0x42C0/0x42C1 |
| Collision shape masks | pointer table 0xA5EB4 | 0x800A52B4 | 128 pointers to `u16[16]` masks (*Tile maps and collision (verified pixel-exact against the game's BG buffers)*) |

World-table record, eight bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | attr | 0x01000000 for course/test worlds; zero for menus. |
| 0x04 | 4 | u32 | world | Segment-4 pointer to the world structure. |

Cast-table record, 12 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | u16 | id | Cast identifier. |
| 0x02 | 2 | u16 | zero02 | Zero. |
| 0x04 | 4 | u32 | castdt | Segmented cast-data pointer. |
| 0x08 | 4 | u32 | attribute | Segmented attribute pointer. |

**Placeholder slots.** 32 world-table slots point at the placeholder record 0x04000CD8, which is also slot 11
`worldTester`: IDs 33, 38, 41, 42, 44, 45, 47–50, 53–65, 67–74 and 77. Slot 80 is an alias of 4 (`worldPanorama`). The viewer
should list each distinct world struct once.

#### How the game selects and loads a world (verified with breakpoints and RDRAM)

1. `nextTo_newScene(a0, u8 gameMode, u8 worldId)` at 0x8006C6E0 stores the mode in `__Game+1` (0x800FC0B1) and
   the world ID in 0x800FC648. It then schedules `setAll_restart(deconst_sceneInfo, const_sceneInfo,
   init2_gameproc)` (names from the leak).
2. On restart, `const1_worldInfo` (0x8006C3B0) reads the 0x118-byte world struct from segment 4 into a
   worldInfo entry (pointer at 0x800FC64C). Its layout is:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 1 | u8 | used | Used flag |
| 0x01 | 1 | u8 | worldId | World ID |
| 0x02 | 2 | u16 | unknown_02 | Unresolved |
| 0x04 | 0x118 | World | world | Copy of the world structure |

   It then
   reads the scene table, the scene and the actor array. Actors are expanded to 16-byte RAM records carrying a
   `castInfo*`.
3. Observed Story-mode chain (a breakpoint on `nextTo_newScene`):
   - Nintendo logo (mode 0, world 0) → menus → page select;
   - fruit roulette (mode 0, world 5 `worldFruitSelect`);
   - Yoshi colour select (mode 6, world 2 `worldP_select`);
   - course 1-1 (**mode 7**, world 43 `world_1_1_1`).
   Mode 7 is "in course". Code also tests modes 2, 5 and 8 (their meaning is a hypothesis).
4. **Sub-areas** are entered through exit actors: pipes `tubo`, doors `nextDoor`, side gates `lrNextGate` and pipe
   lifts `pipelift*`. Each exit has its own cast ID, and its attribute points to an EXITIF record (*Exits (EXITIF, 24 bytes; verified)*)
   naming the destination world and arrival point. `jumpTo_newScene(EXITIF*)` calls
   `nextTo_newScene(0, rec.mode, rec.world)` (the call is leak-only; the data is verified). All **227 exit links** decode, and the
   destinations agree with the leak's attribute names; for example 1-1 pipe 0x4208 `tubo_111_112` → world 81
   `world_1_1_2`, arriving at (0, 240).
5. **Bosses, Bowser rooms, demos and the practice world** are referenced by no warp row or exit record, so
   game code must load them (hypothesis; not traced).

**Run-time variables** (J RAM; verified in 1-1, 2-1 and 6-2)

| Address | Meaning |
|---|---|
| 0x800FC0B1 (u8) | game mode (7 in a course, 6 Yoshi select, 0 menus) |
| 0x800FC648 (u8) | current world ID (player 0) |
| 0x800FC64C (u32) | pointer to the current worldInfo entry (world copy at +4) |
| 0x800FC664 (u32) | current course number |
| 0x800FC52C (f32) | Camera-frame X: left edge in world pixels |
| 0x800FC530 (f32) | Camera-frame Y: top edge in world pixels |
| 0x800FC564 (f32) | Camera-frame Z: 500 |
| 0x800FC4A8 | View-info structure, known fields below |

View-info fields at 0x800FC4A8 (verified against RAM; the rendering notes explicitly identify the camera-plane offset as 0x10):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | f32 | fovy | 40.0 degrees. |
| 0x04 | 4 | f32 | tanHalfFovy | 0.36397. |
| 0x10 | 4 | f32 | cameraPlaneZ | 500.0. |

`__Game` is at 0x800FC0B0. For these fields the J offsets are the leak's (`main.h: struct game_born`) plus 8;
`+1` (mode) is not shifted.

**Level select for research and screenshots** (verified; reproducible in the debug emulator)
- Pause the emulator. Write `0x24050007` at 0x8006AE68 (`addiu a1,zero,7`), `0x0801B1B8` at 0x8006AE6C (`j 0x8006C6E0`)
  and `0x240600WW` at 0x8006AE70 (`addiu a2,zero,WORLD`).
- Add an execute breakpoint at 0x8006C6E0 and run.
- At the break, restore `27BDFFD8 AFBF0014 C4840008` at 0x8006AE68–70, remove the breakpoint and run.
- `viewProc` runs every frame, so one call becomes `nextTo_newScene(?, 7, WORLD)`.

#### Course list (verified; titles from the leak's `messageData.c` (J) and `E_messageData.c` (US))

The Japanese titles are valid for this ROM: J's message data matches the leak's Japanese `messageDatac.o` at 99.4% (*The leak: which build it is, and what it contains*). The US titles are leak-only.

"Start" is byte 0 of the course's warp row. The other worlds carry the same course number at world +0x110. ✗ marks
a world that no warp row or exit record reaches (entered by code, or unused).

| P-C | Japanese title | US title | Start | Worlds (ID `name`, actor count) |
|---|---|---|---|---|
| 1-1 | ポチと たからさがし | Treasure Hunt | 43 | 43 `_1_1_1` (100), 81 `_1_1_2` (112); 25 `_0_1` ✗ (122; the practice course) |
| 1-2 | ビックリンで びっくり | Surprise!! | 51 | 51 `_1_2_1` (139), 85 `_1_2_2` (102); 148 `Bs_okmti_hajimete` ✗ (11) |
| 1-3 | スーパーレールリフト | Rail Lift | 13 | 13 `_1_3_1` (145), 104 `_1_3_2` (56), 119 `_1_3_3` (98), 160 `_1_3_4` (30) |
| 1-4 | たかいとうを のりこえて | Tower Climb | 18 | 18 `_1_4_1` (149), 90 `_1_4_2` (88), 91 `_1_4_3` (128), 92 `_1_4_4` (73); 152 `Bs_haba_hajimete` ✗ (15) |
| 2-1 | ホネホネりゅうの あな | Bone Dragon Pit | 46 | 46 `_2_1_1` (112), 149 `Bs_okmti_heiho` (12), 120 `_2_1_2` (119), 153 `_2_1_3` (8); 171 `_2_1_4` ✗ (12) |
| 2-2 | ウンババの すむところ | Blargg's Boiler | 19 | 19 `_2_2_1` (125), 155 `Bs_okmti_saka` (13), 93 `_2_2_2` (132) |
| 2-3 | ぷるぷるゼリーな どかん | Jelly Pipe | 16 | 16 `_2_3_1` (104), 106 `_2_3_2` (92), 151 `_2_3_3` (13) |
| 2-4 | げきりゅう めいろ | Torrential Maze | 23 | 23 `_2_4_1` (97), 107–111 `_2_4_2`…`_2_4_6` (35, 46, 39, 53, 12) |
| 3-1 | くものあいだを ぬけて | Cloud Cruising | 52 | 52 `_3_1_1` (113), 82 `_3_1_2` (55), 84 `_3_1_3` (83), 174 `_3_1_4` (39), 83 `_3_1_bonus` (26); 162 `Boss_kumo` ✗ (24) |
| 3-2 | たかいぞ Qちゃんのとう | The Tall Tower | 40 | 40 `_3_2_1` (78), 102 `_3_2_2` (97), 103 `_3_2_3` (128); 164 `Boss_predator` ✗ (16), 156 `Bs_yoidon_slider` ✗ (60) |
| 3-3 | さむくても ポチがいれば | Poochy & Nippy | 32 | 32 `_3_3_1` (90), 124–131 `_3_3_2_1`…`_8` (28, 29, 23, 22, 24, 37, 50, 34), 170 `_3_3_2_9` (5); 163 `Boss_majin` ✗ (18) |
| 3-4 | ムカデで イライラ！ | Frustration | 14 | 14 `_3_4_1` (75), 105 `_3_4_2` (67); 165 `Boss_donbaba` ✗ (5), 76 `NigeruKuppa` ✗ (3) |
| 4-1 | ガボンの いえ | Jungle Hut | 17 | 17 `_4_1_1` (73), 112–117 `_4_1_2`…`_4_1_7` (39, 39, 41, 31, 22, 24) |
| 4-2 | ジャングルの みずたまり | Jungle Puddle | 22 | 22 `_4_2_1` (111), 150 `Bs_okmti_kaidan` (15), 97 `_4_2_2` (93) |
| 4-3 | パックンの ふるさと | Piranha Grove | 12 | 12 `_4_3_0` (51), 147 `Bs_okmti_packn` (23), 145 `_4_3_1` (118), 86 `_4_3_2` (102) |
| 4-4 | ジャングルの ニョロロン | Neuron Jungle | 27 | 27 `_4_4_1` (123), 161 `Bs_yoidon_swim` (44), 118 `_4_4_2` (134) |
| 5-1 | うみといえば クラゲボン | Lots O' Jelly Fish | 21 | 21 `_5_1_1` (28), 146 `Bs_habatobi` (20), 94 `_5_1_2` (103), 95 `_5_1_3` (39), 96 `_5_1_4` (99) |
| 5-2 | おさかな たっぷり | Lots O' Fish | 166 | 166 `_5_2_0` (31), 30 `_5_2_1` (143), 121 `_5_2_2` (30), 154 `_5_2_3` (13), 172 `_5_2_4` (81), 173 `_5_2_5` (10) |
| 5-3 | ビバ・バンブーダンサーズ | Shy Guy Limbo | 31 | 31 `_5_3_1` (111), 122 `_5_3_2` (141), 123 `_5_3_3` (61) |
| 5-4 | ヘイホーの かいぞくせん | Shy Guy's Ship | 28 | 28 `_5_4_1` (113), 158 `Bs_yoidon_hock` (59), 101 `_5_4_2` (117) |
| 6-1 | キカイな おしろ | Mecha Castle | 15 | 15 `_6_1_1` (89), 159 `Bs_yoidon_knife` (74), 87 `_6_1_2` (56), 88 `_6_1_3` (29), 89 `_6_1_4` (44) |
| 6-2 | リフトな おしろ | Lift Castle | 142 | 142 `_6_2_3` (56), 35 `_6_2_1` (84), 141 `_6_2_2` (16), 143 `_6_2_4` (32), 144 `_6_2_5` (93), 157 `_6_2_6` (23); 167 `Kupa_room2` ✗ (10) |
| 6-3 | オバケな おしろ | Ghost Castle | 34 | 34 `_6_3_1` (38), 132–139 `_6_3_2`…`_6_3_9` (32, 37, 61, 20, 14, 42, 8, 23), 140 `_6_3_10` (10); 168 `Kupa_room3` ✗ (10) |
| 6-4 | マグマな おしろ | Magma Castle | 175 | 175 `_6_4_5` (20), 24 `_6_4_1` (31), 98 `_6_4_2` (96), 99 `_6_4_3` (46), 100 `_6_4_4` (55) |

**Other worlds**

| IDs | Worlds | Notes |
|---|---|---|
| 0–10, 20, 26, 29, 75 | `worldNintendo`, `worldNameEntry2`, `worldP_select`, `worldSeisan`, `worldPanorama`, `worldFruitSelect`, `worldSeisan2`, `worldNameEntry`, `worldTuresariDemo`, `worldPurikura`, `worldShintaku`, `worldBossSeisan`, `worldBossSeisan2`, `worldGameOver`, `worldEscape` | menus, results, demos: 2–3 actors, no background layers |
| 78, 167–169 | `worldKupa_room`, `worldKupa_room2..4` | the Bowser arena. The main cast `kupa_room` (0x8016) is collision-only, and the far layer is 0x80F8 |
| 162–165 | `worldBoss_kumo`, `_majin`, `_predator`, `_donbaba` | page-3 boss arenas (course field 9–12) |
| 79 | `worldClearDemo` | ending demo (collision-only `damybg`) |
| 11, 36, 37, 39, 66 | `worldTester`, `worldHashi`, `worldDrum`, `worldBosstest`, `worldKumo_boss_enkei` | test worlds, unreachable in normal play (*Cut and test levels*) |

#### Levels

| # | Check | Result | Files |
|---|---|---|---|
| 1 | Segment bases solved from data: `world+0x5C == world−8` in 30 of 30 entries; `castdt+0x18 == ID` | equal to `SegmentRomStart` | ROM analysis |
| 2 | All 143 world structs, 7,150 actor records and 273 BG casts parsed; every CMPR in them decodes | – | `level/worlds_J.json`, `level/layers_all.json` |
| 3 | Breakpoint on `nextTo_newScene` from a fresh boot | (0, 0) logo … (0, 5) fruit select, (6, 2) Yoshi select, (7, 43) course 1-1 | – |
| 4 | RDRAM in 1-1, 2-1 and 6-2 (level-select patch *How the game selects and loads a world (verified with breakpoints and RDRAM)*) | world copies equal ROM except +0x5C; 100/100, 112/112 and 84/84 actor records equal ROM | `level/r111a.bin`, `r111b.bin`, `r211a.bin`, `r621a.bin` |
| 5 | On-screen positions: coins at world (200, 392) and (232, 392) appear at screen (145, 120) and (177, 120) with the camera frame at (54.6, 272) | match | `level/shot_111b.png` |
| 6 | Decoded layers vs the game's `G_BG_1CYC` buffers in 1-1 | main: 0 differing pixels of 86,016; chukan and enkei: 0 differences in displayed rows; TLUTs byte-identical to `utPal` | render agent `render/f_111b.bin` |
| 7 | Parallax factors from `imageX` in three 1-1 frames (camX −1, 10.748, 359.096) | r = 0.6224 / 0.7673 / 1.0, equal to the formula to 1/32 px | `render/f_111a.*`, `f_111b.*`, `f_111c.*` |
| 8 | Screenshot vs render at the RAM camera | layouts match | `level/cmp_111b.png`, `cmp_211a.png`, `cmp_621a.png` |
| 9 | 227 exit records | destinations agree with the leak's attribute names | `level/worlds_J.json` (`links`) |
| 10 | World IDs 36/37/39 vs the leak's `worldManager.o` relocations (lead) | 36 Hashi, 37 Drum, 39 Bosstest; J projection pointers agree | – |
| 11 | Test-named casts across all worlds' actor and preload lists (lead) | *Unused graphics and actors* | – |
| 12 | Layer anchor formula reproduced by the lead from ROM data only (world start frame + the s16 pair before each BG attribute) | 1-1 enkei/chukan c_y = +86.70 / −208.70; 6-2 enkei P at (816, 768) = (496, 528) = r·cam + (−11.874, 49.976) as in RAM | `lead/layer_anchors.csv` |
| 13 | Viewer placement (*Coordinates (world pixels → viewer units, 1 px = 1 unit)*) simulated against the game formula: perspective camera at distance K, planes at −(floor(z) − 500), anchors X0/Y0, 20 random cameras × 300 placements | max screen error 4e-12 px; with the 0.1 · frac(z) order offset ≤ 0.017 px | – |

#### Cut and test levels

| Item | Where | Evidence | Conf. |
|---|---|---|---|
| **29 cut world IDs.** IDs 33, 38, 45, 47–50, 53–65, 67–74 and 77 all point at the placeholder record 0x04000CD8, the same record as ID 11 `worldTester`. The numbering was kept after the worlds were removed | world ID table, ROM 0xACB60 (176 world-table entries, defined under Tables) | J pointer histogram (0x04000CD8 × 33); the leak `worldManager.o` `.rel.data` names the same slots `worldTester` | verified, high |
| IDs **41, 42, 44** are placeholders in J; the leak's US build fills them with `worldPcAmerica`, `worldPcFrench`, `worldPcGermany` (region screens, with `unit_pc*` art) | same table | J table vs leak table; `unit_pc*` not in J (≤0.7% match) | verified, high |
| Leak ID 176, `world_6_4_6`, has no J counterpart. Only `world_6_4_6_US.wdt` exists, so the course gained a sub-area for the US release | leak `files.txt`, `worldDatabase.o` `.mdebug` | J table has only IDs 0–175 | verified, high |
| **`worldTester`** is real data in J: a world record with camera floats (500.0, 1.0), a code pointer 0x8006AA10 and a 0xFFFF-terminated list of about 60 16-bit IDs (0x4002…0x4035). In the leak it is an empty 280-byte `.bss` object whose source was being edited on 19 March 1998 | ROM 0xB16E48 (seg 4 +0xCD8) | J bytes; leak symbols | bytes verified; meaning (an actor/cast test list) hypothesis, medium |
| **Test worlds compiled into J:** ID 36 `worldHashi` (a bridge test), ID 37 `worldDrum`, ID 39 `worldBosstest`, ID 66 `worldKumo_boss_enkei` (a "distant view" test for the cloud boss). All carry course number 26 ("test"). 36 and 37 use the test tile layer `jumptest` (0x800A, 5120×512); 39 uses the collision-only `damybg` (0x801E) and `bossZoom_projection`; 66 uses `kumo_boss_enkei` (0x8066, 512×512) | seg 4; world table slots at ROM 0xACB60 + 8·ID | IDs verified against the leak's `worldManager.o` `.rel.data` names and the J projection pointers; 96–97% byte match with the leak's world blocks | present verified, high |
| **None of the test worlds is reachable in normal play.** IDs 11 (as a level), 36, 37, 39 and 66 appear in no course warp row (ROM 0xACA90, rows 1–24), none of the 227 exit records (EXITIF), and no constant `nextTo_newScene` call (constant callers load only worlds 0, 3, 8, 9, 20 and 29). `worldTester` is only the dummy target of warp rows 0 and 25. All of them load and play with the level-select patch in *How the game selects and loads a world (verified with breakpoints and RDRAM)* | code and data | static search over the data and constant call sites; indirect code paths not traced exhaustively | verified (data), high; medium overall |
| Worlds listed only in `files.txt`: `worldDemoPlay`, `worldDemoPlay2`–`6` (attract demos), `worldToBoss`, `world_maptool`, `world_maptoolDark` (map-tool ROM, `TOOL_VERSION`) | leak | never linked into any database (not in the `.mdebug` include list) | leak-only, high |
| 75 courses were edited for the US release (`*_US.wdt`: most courses' first sub-area and all 11 `worldBs_*` worlds) | leak | J matches the plain `.wdt` worlds at a 97.9% mean and the `_US` ones at 55.4% | verified, high |

### 3.2 Level container

#### Level loading (verified with the emulator: Story mode, page 1, course 1)

Levels aren't loaded in one block. Tracing `dmacopy_bg`, `LoadFragment2` and `slidec` from the Yoshi Select A
press into gameplay recorded 1,867 reads:

| ROM region | Reads | Bytes |
|---|---|---|
| castData tables (0x528430–0x562780) | 828 | 0x5EDC |
| Yoshi cells (ucellData) | 583 | 0x92502 (largest single read 0x25180) |
| unitData (60 CMPR records → 60 `slidec` calls) | 236 | 0x3C66E compressed |
| overlays (50 modules) | 50 | 0x309B0 |
| mesgData | 6 | 0xA6 |
| worldDatabase | 4 | 0x5D4 |

- **Callers** (J return addresses; names from the leak):
  - `cellManager read_unpackageCell` reads the Yoshi cells.
  - `castDBManager get_castdtType`, `read_castAttr`, `read_objCrossInfo`, `getP_castInfoData` and
    `chkRd_readromData` read the cast records and compressed images.
  - `infodbManager SetObjCrsInfoDB`, `SetBgCrsInfoDB` and `SetObjCrsLiftInfoDB` read the collision records.
  - `worldManager` and `frameManager` read the course record.
- **Actor spawns** keep reading during play. Traces: `layout/ltrace_lvl3.tsv`, `layout/level_load_summary.txt`,
  `layout/level_load_callers.txt`.
- **Consequence for the viewer:** a level is the graph reachable from its world record (*Level format*). The loader follows
  segmented pointers and never needs a file table.

#### Level format

All values are big-endian. `0x04xxxxxx` → ROM `0xB16170 + x` and `0x03xxxxxx` → ROM `0x528430 + x` (*Segment tables and addressing (verified)*); code
pointers are J RAM addresses. **A parser needs no relocation.**

#### World struct (0x118 bytes, segment 4)

The layout is verified: all 143 worlds parse, and the RAM copies are byte-identical apart from +0x5C. Meanings are
leak-only unless marked.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 12 | f32[3] | cameraPosition | camera position (0, 0, 500 in every course) |
| 0x0C | 12 | f32[3] | viewVector0 | first further view vector (0) |
| 0x18 | 12 | f32[3] | viewVector1 | second further view vector (0) |
| 0x24 | 4 | u32 | projection | projection function: 0x8006AA10 `standardPrj_motionView` (menus), 0x8006B524 `yoshiZoom_projection` (courses), 0x8006B560 `bossZoom_projection`, 0x8006AAF0 and 0x8006B5B4 (others) |
| 0x28 | 4 | f32 | cameraX | initial camera frame X, left edge in px (**verified**) |
| 0x2C | 4 | f32 | cameraY | initial camera frame Y, top edge in px (**verified**: 1-1 has 272) |
| 0x30 | 4 | f32 | cameraZ | initial frame Z (500) |
| 0x34 | 36 | f32[9] | viewParameters | view and zoom parameters (1-1: 0, 1, 1, 0, 8300, 500, 1500, 0, 480; menus: 0, 1, 1, 0, 320, 500, 1500, 0, 240). The meaning is open. Hypothesis: 0x48 = 500 and 0x4C = 1500 are depth bounds, and 0x44/0x54 are view extents |
| 0x58 | 1 | u8 | gridWidth | scene grid width (always 1 in J) |
| 0x59 | 1 | u8 | gridHeight | scene grid height (always 1 in J) |
| 0x5C | 4 | u32 | scenes | scene table pointer (seg 4); the only field relocated in RAM |
| 0x60 | 0xA0 | u16[0x50] | preloadCasts | cast preload list, 0xFFFF-terminated, zero-padded to 0x100 |
| 0x100 | 4 | u32 | soundScene | **sound scene id** (`NA_SCENE_*`), passed to `Na_SceneChange`, which selects the song (*Song list*). Verified at run time: 1-1 = 1 (seq 1), `worldP_select` = 0x24 (seq 12) |
| 0x104 | 4 | u32 | unknown_104 | unknown_104: 0x3E in typical courses |
| 0x108 | 4 | u32 | unknown_108 | unknown_108: 0x60000000 in typical courses |
| 0x10C | 4 | u32 | spawnPolicy | spawn policy: 0x80058D30 `anotherActor_OnStage` (spawn when entering the frame; almost all courses), 0x80058BB4 `setup_onStage` (spawn everything; 5-1-3, 6-2-2), 0 |
| 0x110 | 2 | s16 | course | course number 1–24 (page = (n−1)/4+1, course = (n−1)%4+1), 25 Bowser, 26 test, 0 none (**verified**) |
| 0x112 | 2 | u16 | unknown_112 | unknown_112 |
| 0x114 | 4 | u32 | unknown_114 | unknown_114 |

#### Scene table, scene and actor records (verified)


**Scene-pointer table.**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 × w × h | u32[] | scene | Segment-4 scene pointers |
| 4 × w × h | 4 | u32 | terminator | Zero |

In ROM, a world's records are ordered actorData, scene, scene table, world structure.

**Scene (8 bytes).**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | s16 | count | Actor count; asserted below 150 |
| 0x02 | 2 | u16 | padding | Reserved |
| 0x04 | 4 | u32 | actorData | Segment-4 actor-array pointer |

**Actor (0x0C bytes).**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | u16 | castId | Cast-table key |
| 0x02 | 2 | u16 | serial | Instance number per cast ID |
| 0x04 | 4 | f32 | x | World pixels |
| 0x08 | 4 | f32 | y | World pixels; downward positive |

  - `x`, `y` are world pixels, y down, origin at the top-left of the main layer. For sprite objects the anchor is
    the base (bottom-centre). Verified on screen: 1-1 coins at (200, 392) and (232, 392) appear at screen
    (145, 120) and (177, 120) with the camera frame at (54.6, 272).
  - `castId` 0x4xxx = object or enemy (the value is a cast-table key, not a class). 0x8xxx = a background layer
    or map cast, placed at a nominal (160, 120).
  - `serial` = instance number per repeated ID (0, 1, 2…); some actors use it as a parameter (hypothesis).
  - In RAM each record gains a `castInfo*`, and spawned records have castId overwritten with 0xFFFF.
- **Totals:** 7,150 actor records in 143 worlds (6,850 objects and 300 layer placements). RAM equals ROM for 1-1
  (100 records), 2-1 (112) and 6-2 (84).

#### Casts: castdt, data records, attributes (segment 3; verified layout)

**BG castdt (0x64 bytes)**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x08 | 4 | u32 | boot | boot function: 0x8006CB38 `boot_mainBG_scaling2ZrationScroll` (267 of 273 layers), 0x8006C9C0 `boot_BG_speedScroll` (`_kinkei` ×3), 0x8001BBC0 `boot_switchscalingZrationmainScrollBG` (`_mask` ×2), 0x8006C8F0 `boot_mainBG_Scroll` (`damybg`) |
| 0x18 | 2 | u16 | castId | cast ID |
| 0x1C | 0x40 | DataSlot[8] | slots | slots: 0 `bii`, 1 `ut`, 2 `utPal`, 3 `utID`, 4 `utIdBk`, 5 `utAdd`, 6 `crUtID`, 7 unused |
| 0x5C | 2 | u16 | viewW | viewW: composition-buffer width (0 → 320) |
| 0x5E | 2 | u16 | viewH | viewH: composition-buffer height (0 → 240); zoomed arenas use 480 × 352/368 or 576 × 416 buffers |
| 0x60 | 1 | u8 | wrap | wrap flag (0 in every J layer) |

DataSlot, eight bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | recordSize | 12, the DataRecord size. |
| 0x04 | 4 | u32 | record | Segmented DataRecord pointer. |

**Object castdt** uses the same data-slot system.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x04 | 4 | u32 | tag | 0x01000000 |
| 0x08 | 0x10 | OverlayDescriptor | overlay | Descriptor defined under Overlays |
| 0x18 | 2 | u16 | castId | Cast identifier |

Slots hold cell dimensions, CI8 frames (`ut_*`), palette (`utPal_*`), cell table (`utID_*`) and animation records. For example, `castdt_apple` has 24 × 21-pixel frames. *How the game builds a frame* covers sprite decoding.

**Data record (0x0C bytes).**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | size | Decoded byte count |
| 0x04 | 4 | u32 | storedSize | Stored byte count |
| 0x08 | 4 | u32 | data | Segmented payload pointer |

If data begins with `CMPR`, it decompresses to size bytes (*Compression: `CMPR` + `SMSR00` slide-LZ*); otherwise it is raw.

**Attribute** (0x54 bytes, all actors)

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 1 | u8 | kind | kind: 5 BG, 2 door, 0 pipe, … |
| 0x04 | 4 | f32 | z | z: depth, and for layers the parallax (*Layers*) |
| 0x14 | 12 | f32[3] | scale | scale |
| 0x30 | 4 | u32 | extraSize | Extra-block size |
| 0x34 | 4 | u32 | extra | Extra-block pointer; its eight-byte length/zero header and EXITIF payload are defined under Exits |

#### Layers

##### What a course layer is (verified)

- Every background layer is a BG cast placed in the world's actor list.
- Names by depth:
  - `_enkei`: far, z ≈ 641–900;
  - `_chukan`: middle, z ≈ 582–1350;
  - no suffix: main, z = 500.5, or 500.2 when a far layer sits at 500.6;
  - `_kinkei`: near foreground, z = 490.5, with speed scroll (4-3 courses);
  - `_mask`: an overlay the size of the main layer, z = 500.18 (4-1 sub-areas).
- Draw order is by descending z, back to front.
- **The sky, clouds and scenery are ordinary tile layers.** In 1-1 the enkei layer is sky and clouds, the chukan
  layer is mountains, and the main layer is ground and trees.
- No course in J places a 3D polygon layer. `castdt_bgpolygon` exists but no world places or preloads it (*Unused graphics and actors*).
- `level/layers_all.json` lists all 273 BG casts; `level/layers_by_world.json` and `.csv` list the 300
  placements per world (cast, name, px size, z, r, view size).

**Examples** (px, z):

| World | Main | Chukan | Enkei | Other |
|---|---|---|---|---|
| 43 `1-1-1` | 6656 × 512, 500.5 | 4608 × 256, 600.5 | 6144 × 512, 700.5 | |
| 46 `2-1-1` | 7168 × 512, 500.2 | 7168 × 1792, 1350.5 | | |
| 21 `5-1-1` | 2816 × 256 | 4096 × 256, 600.5 | 3328 × 512, 700.5 | |
| 35 `6-2-1` | 2048 × 1024 | | 2560 × 1280, 700.5 | |
| 145 `4-3-1` | 2816 × 2304 | | 5120 × 1792, 600.5 | kinkei 9216 × 256, 490.5 |
| 112 `4-1-2` | 1024 × 768 (view 480 × 352) | | 1280 × 1024, 829 | mask 1024 × 768, 500.2 |
| 162 `Boss_kumo` | 768 × 512 | | 3072 × 1280, 500.9 (×2) | |
| 78 `Kupa_room` | collision only | | 2560 × 1536, 829 | room art drawn by actors |

##### Parallax and scrolling

- **Formula:** `r = K / (floor(attr.z) − viewZ + K)` with `K = 120 / tan(fovy/2)`. With fovy = 40° and viewZ = 500,
  K = 329.70, and every J course uses these values. Source: the leak's `actorS.o` `commonSetup_birthBG` (leak-only);
  the constants were verified in RAM.
- `boot_mainBG_scaling2ZrationScroll` also divides the layer's scale by r, so layer pixels stay 1:1 on screen.
- **Scroll position, both axes** (verified; `notes/render.md` section 2.2–2.5, reproduced by the lead from ROM data):

  ```
  P = r · cam + floor16(r · cam0 − a) − r · cam0        (separately for x and y)
  ```

  - `P` is the layer pixel shown at screen (0, 0). The screen shows layer pixels P … P + (320, 240).
  - `cam` is the camera frame (the top-left of the screen in main-layer pixels; RAM 0x800FC52C/30).
  - `cam0` is the world's start frame (world +0x28/+0x2C).
  - The anchor pair a is stored 16 bytes before the BG cast's attribute record; its fields are listed below. The attribute has kind 5 and supplies the layer depth z.
  - `floor16` rounds down to a multiple of 16.
  - Main layers (z 500.x, a = 0) give `P = cam` exactly.

  Anchor fields, offsets relative to the BG attribute record:

  | Offset | Size | Type | Field | Description |
  |---:|---:|---|---|---|
  | −0x10 | 2 | s16 | ax | Horizontal anchor. |
  | −0x0E | 2 | s16 | ay | Vertical anchor. |
- **Checks:**
  - 1-1: enkei a = (0, −100) gives c_y = floor16(169.30 + 100) − 169.30 = +86.70; chukan a = (0, 200) gives −208.70.
    Both equal RAM (+0x24 of the layer's scroll struct).
  - 6-2 enkei: a = (0, −64), cam0 = (816, 768) gives c = (−11.90, 49.97); RAM (−11.874, 49.976).
  - Horizontal slope from 1-1 frames at camX −1, 10.748 and 359.096: r = 0.6224 / 0.7673 / 1.0, exact to 1/32 px.
  - Vertical slope from 6-2 frames at camY 784 → 768: main 1.000, enkei 0.621–0.623 (= r).
  - The lead's anchors for all 300 placements: `lead/layer_anchors.csv` (world, cast, z, r, a, cam0, c).
  - The simpler rule "far layer bottom-aligned at the lowest camera" holds in 1-1 only by coincidence.
- **At run time:** the game steps P towards its target by at most ±15 px per frame (leak `move_bgScreenWPos`), so
  layers catch up gradually after a camera jump. A static viewer uses the formula directly.
- **Ring buffer** (`notes/render.md` section 2.5): the 336 × 256 buffer is a 1-D ring, and the display list carries
  `imageX = P.x mod 336`, `imageY = (P.y + floor(P.x / 336)) mod 256`. Decoding the buffer as a 2-D image shows
  apparent streaks and drift; always work in layer coordinates P.
- **Draw order:** courses use **no Z buffer**, so draw order is occlusion.
  - Observed in the captured frames: layers and actors come in painter's order.
  - That the sort key is the exact z (larger first) is a hypothesis consistent with 1-1, 2-1 and 6-2 (*Draw order of a gameplay frame*).
  - 1-1: main z 500.5 is drawn before Yoshi at 500.3.
  - 2-1: the cave front layer, main z 500.18, is drawn **after** the 3D actors.
  - Ordering uses the fractional z, while r uses floor(z).
- **Edges** (verified by J disassembly and in the running game; `edge/edge.md`):
  - A layer is a **finite** worldW × worldH image. Wherever the screen window extends past it on either axis, the
    game draws **nothing** (transparent): no wrapping, no clamping.
  - Mechanism: `makeUtId_bgDraw` (0x8004EA68) zero-fills the per-frame unit buffer. `copynUnit` (0x80069DF8) then
    skips units for which `wColwRow_to_bColbRow` (0x80069094) returns 255, i.e. a negative column or row, or a block
    index beyond the grid when the wrap flag is not 1. Unit 0 is an all-index-0 tile, and index 0 is transparent.
  - Runtime test: 1-1's chukan layer (4608 px wide) was forced to P.x = 5127.5. All 315 ring units were index 0,
    against 82 of 315 under a wrap model, and the screenshot shows the sky layer straight behind the terrain.
  - Real cases: 1-1 chukan needs x up to 5181 at the right end of the course, so no mountains are visible there.
    Several middle layers start hundreds of px below the top of the scroll range (1-1 chukan c_y = −208.7).
  - The wrap flag (castdt +0x60, copied to unitInfo +0x28) would take the block index modulo the grid, repeating
    the layer to the right and bottom only. It is 0 in every J layer, so that branch is never used (code only).
- **`_kinkei` layers** use `boot_BG_speedScroll`, an extra speed-based scroll (not decoded).

##### Collision-only and special casts

- `kupa_room` (0x8016), `boss_majin` (0x8117) and `damybg` (0x801E) have `bii` block sizes of 0 and no tiles or
  palette. They carry only maps and collision.
- Those arenas' visuals are drawn separately. In the Bowser room (world 78) it is an F3DEX textured mesh of CI8 64 × 32 tiles, plus a far layer drawn through a 496 × 384 ring buffer (verified from frame `render/f_078a`; *Other meshes*). `boss_majin` and `damybg` were not captured.

#### Exits (EXITIF, 24 bytes; verified)


| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | u16 | destActorId | Upper half of uniqueName |
| 0x02 | 2 | u16 | param | Lower half of uniqueName |
| 0x04 | 1 | u8 | destWorld | Destination world |
| 0x05 | 3 | u8[3] | padding | Alignment |
| 0x08 | 4 | f32 | x | Destination x |
| 0x0C | 4 | f32 | y | Destination y |
| 0x10 | 4 | f32 | z | 500 |
| 0x14 | 1 | u8 | gameMode | Destination mode |
| 0x15 | 1 | u8 | effect | Transition effect |
| 0x16 | 2 | u16 | exitType | Exit type |


The exit cast's attribute pointer at +0x34 targets this 0x20-byte wrapper:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | size | 0x20 |
| 0x04 | 4 | u32 | reserved | Zero |
| 0x08 | 0x18 | EXITIF | exit | Exit record above |

- The arrival actor is usually 0x44CA `cyberGate`.
- All 227 links are in `level/worlds_J.json` (`links`); the reachability closure is in `level/reachability.json`.

#### Formats

**Sequence scripts** (all addresses are u16 offsets from the sequence start; relative forms add a signed offset to the
address after the argument):
- **Variable-length value:** `b0 & 0x80 ? ((b0 & 0x7F) << 8) | b1 : b0`.
- **Script state** (per sequence, channel and layer): `pc`, a 4-deep call/loop stack with u8 loop counters, and an
  s8 `value`.
**Common commands (all script levels).**

| Opcode | Operands | Effect |
|---|---|---|
| FF | None | End or return |
| FE | None | Delay one tick |
| FD | var delay | Delay |
| FC | Address | Call |
| FB | Address | Jump |
| FA / F9 / F5 | Address | Jump if value = 0 / < 0 / ≥ 0 |
| F8 | u8 count | Start loop |
| F7 | None | End loop |
| F6 | None | Break loop |
| F4 / F3 / F2 | Relative address | Relative jumps |

Channel argument metadata is one byte per opcode B0–FF in `SCOM_TABLE` (ROM 0x9E0A0):

| Bits | Mask | Field | Meaning |
|---|---|---|
| 0–1 | 0x03 | argc | Argument count |
| 7−k | 0x80 >> k | wide[k] | Argument k is u16 when set |

At layer level, any delay or end command ends that layer's command run.

**Sequence commands used by music** (full table: `notes/music.md`, section 3.2):

| Opcode | Operands | Effect |
|---|---|---|
| 9n / An | u16 / s16 address | Start channel n |
| 4n | None | Stop channel n |
| DB | u8 a | Volume a/127 |
| DA | mode, time | Fade |
| DD | bpm | Tempo |
| DC | s8 delta | Tempo change |
| DE / DF | Transpose | Change transposition |
| D1 / D2 | u16 address | Short-note gate / velocity table |
| D7 | u16 mask | Copy player settings to masked channels |
| D3 / D4 / D5 | Behavior parameter | Mute behavior |

**Channel commands.**

| Opcode | Operands | Effect |
|---|---|---|
| 0n | None | Delay n |
| 8n / 7n | u16 / s16 address | Start layer n (0–3) |
| 9n | None | Free layer n |
| C1 | u8 instrument | 0–126 = bank instrument; 127 = drums |
| C3 / C4 | None | Short / large notes; persists across restarts |
| C6 | u8 bank | Select bank |
| DF | u8 a | Volume a/127 |
| E0 | u8 a | Volume scale a/128 |
| DD / DC | u8 a | Pan / pan weight |
| D4 | u8 a | Reverb |
| D3 | u8 a | Pitch bend 2^(a/127), ±1 octave |
| EE | u8 a | Fine bend, ±2 semitones |
| DE | u16 a | Frequency scale a/32768 |
| DB | s8 transpose | Transposition |
| D7 / D8 / E1 / E2 / E3 | Command-specific | Vibrato |
| D9 | u8 rate | Release rate |
| DA | u16 address | Envelope |
| E7 / E8 | Eight parameters | Channel setup |
| EB | u8 bank, u8 instrument | Set bank and instrument |
| EA | None | Halt script |

**Layer level** (`__Command_Seq`):
- **Notes** (note = op & 0x3F):

  | Opcode | Large notes | Short notes |
  |---|---|---|
  | `00–3F` | var delay, u8 velocity, u8 gate | var delay |
  | `40–7F` | var delay, u8 velocity | uses the C3 default delay |
  | `80–BF` | u8 velocity, u8 gate | uses the last delay |

**Other layer commands.**

| Opcode | Operands | Effect |
|---|---|---|
| C0 | var delay | Rest |
| C1 | Velocity | Set velocity |
| C2 | Transpose | Set transpose |
| C3 | Delay | Set default delay |
| C4 / C5 | None | Legato on/off |
| C6 | Instrument | 127 = drums; 255 = channel instrument |
| C9 | Gate | Set gate |
| CA | Pan | Set pan |
| CB | Envelope, release | Set envelope and release |
| CE | Bend | Set pitch bend |
| CF | Release | Set release |
| D0–DF | None | Velocity-table index in low nibble |
| E0–EF | None | Gate-table index in low nibble |

- **Default tables:** velocity `0C 19 26 33 39 40 47 4C 53 59 60 66 6D 73 79 7F`; gate
  `E5 CB B1 97 8B 7E 71 64 57 4A 3D 30 24 17 0A 00`.
- **Timing:** `velocitySquare = vel² / 16129`, `duration = gate × delay >> 8`, and the note is released once the
  remaining delay ≤ duration.
- **Never used by J music:** portamento, filters, random variance, gain, headset effects and IO-port reads.
- **Checked:** a static walk of all 62 sequences (audio analysis) finds 0 unknown opcodes and no out-of-range
  addresses.

**Bank formats.** Offsets are relative to the bank start.

**Bank header (4 + 4 × numInstruments bytes).**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | drumListOffset | Zero = no drums |
| 0x04 | 4 × numInstruments | u32[] | instrumentOffset | Zero = empty instrument |

**Drum pointer list (0x100 bytes).**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 0x100 | u32[64] | drumOffset | Bank-relative drum offsets |

**TunedSample (8 bytes).**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | sample | Bank-relative Sample offset |
| 0x04 | 4 | f32 | tuning | Pitch multiplier |

**Instrument (0x20 bytes).**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 1 | u8 | loaded | Relocation flag |
| 0x01 | 1 | u8 | rangeLo | Low-note boundary |
| 0x02 | 1 | u8 | rangeHi | High-note boundary |
| 0x03 | 1 | u8 | releaseRate | Release rate |
| 0x04 | 4 | u32 | envelope | Bank-relative envelope offset |
| 0x08 | 8 | TunedSample | low | Used below rangeLo |
| 0x10 | 8 | TunedSample | mid | Normal range |
| 0x18 | 8 | TunedSample | high | Used above rangeHi |

**Drum (0x10 bytes).**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 1 | u8 | releaseRate | Release rate |
| 0x01 | 1 | u8 | pan | Pan |
| 0x02 | 1 | u8 | loaded | Relocation flag |
| 0x03 | 1 | u8 | padding | Alignment |
| 0x04 | 8 | TunedSample | sample | Sample and tuning |
| 0x0C | 4 | u32 | envelope | Bank-relative envelope offset |

**Sample (0x10 bytes).**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | flagsSize | High nibble = codec (zero/VADPCM for all 1,025); low 24 bits = size |
| 0x04 | 4 | u32 | address | Offset into the sample bank |
| 0x08 | 4 | u32 | loop | Bank-relative Loop offset |
| 0x0C | 4 | u32 | book | Bank-relative Book offset |

**Loop (0x10 or 0x30 bytes).**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | start | First loop sample |
| 0x04 | 4 | u32 | end | Loop end |
| 0x08 | 4 | s32 | count | −1 = forever; 0 = none |
| 0x0C | 4 | u32 | reserved | Zero |
| 0x10 | 32 if count ≠ 0 | s16[16] | state | Predictor history |

**Book (0x48 bytes for order 2 and two predictors).**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | s32 | order | 2 |
| 0x04 | 4 | s32 | numPredictors | 2 |
| 0x08 | 16 × order × numPredictors | s16[] | coefficients | Predictor coefficients |

**Envelope point (4 bytes).**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | s16 | delay | Positive = ramp; 0 disable; −1 hang; −2 jump to arg; −3 restart |
| 0x02 | 2 | s16 | arg | Ramp target or point index |

Positive delays ramp to `(arg/32767)^2` over `max(1, trunc(delay × 0.75))` updates. Default points are `(1,32000)`, `(1000,32000)`, `(−1,0)`.

**VADPCM:**

**Frame (9 bytes; 16 decoded samples).**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 1 | u8 | header | High nibble = scale; low nibble = predictor |
| 0x01 | 8 | packed s4[16] | residuals | High nibble first |

- **Decoder:** the same as `src/rom/music/libultra.ts` `decodeVadpcm`.
- **Loops:** playback restarts from the frame that contains loopStart, with the loop's `state` as history. The
  decoded frames match the stored loop states for 590 of 595 looped samples; the other 5 differ by at most ±1.

#### Levels and data

1. **Collision semantics.** What the `crUtID` kind bits (`v >> 11`: 2, 5, 6, 7, 12–14, 31) and attr bits
   (`(v >> 8) & 7`) mean as surface types (one-way, water, lava, spikes, ice…). Structure and shapes are verified.
   Approach: `bgCrossManager` `*_BGKindCheck` / `BGReviseProc` in J, or probing in the running game.
2. **Tile animation timing.** `utAdd` frames: frame durations and who advances the per-layer animation base.
   The renders show frame 0.
3. **Far-layer edges** (resolved: nothing is drawn beyond a layer's extent, *Parallax and scrolling*). What remains:
   - The wrap-flag branch is known from code only.
   - The x ≥ W case was forced with RAM writes rather than reached in normal play.
   - The y ≥ H case rests on the same code path.
4. **World struct fields.** +0x34–0x57 (nine floats) and +0x100–0x117 (the scene id is +0x100; see *Song list*). The meaning of
   `serial` for some actors.
5. **Warp slots.** The four slots of each course's warp row (actors 0x4507–0x450A).
6. **Code-entered worlds.** How boss arenas (162–165), Bowser rooms (78, 167–169) and demo worlds are entered.
   They are not referenced by data, so presumably code loads them (not traced).
7. **US edits.** A systematic diff of J course data against the leak's US worlds (75 worlds were edited for the
   US release).
8. **Speed scroll.** The `boot_BG_speedScroll` formula for `_kinkei` layers (4-3), and the `_mask` overlay
   behaviour (4-1).

### 3.3 Geometry

#### Layers at run time, and the real 3D geometry

**Layers** (full format and formulas in *Tile maps and collision (verified pixel-exact against the game's BG buffers)*–5.5):
- **Command:** each layer is one S2DEX `G_BG_1CYC` (`01000000 <uObjScaleBg*>`) of a **336 × 256 CI8 ring buffer** in
  heap RAM, with its 256-colour RGBA5551 TLUT loaded just before (`FD` set image, `F5`/`F0` load TLUT).
- **Screen area:** the frame is the whole screen, except that the first layer uses (1, 1, 319.75, 239.75).
- **State** (identical in 1-1, 2-1, 5-1 and 6-2):
  - `G_OBJ_RENDERMODE 0x0C` (antialias, bilinear);
  - other mode H `0xAC30` (TLUT RGBA16, bilinear);
  - render mode `0x00A0300D` (AA, coverage × alpha, alpha compare threshold);
  - combiner `0x119623/0xFF2EFB7D`.
- **Composition:** each frame the CPU copies the visible 16 × 16 units into the ring when `floor(P)` crosses a unit
  boundary (leak `copynUnit`, `bgScrWpos_to_offset`). The uObjBg carries `imageX = P.x mod 336` and
  `imageY = (P.y + floor(P.x/336)) mod 256`; the 1-D ring wrap explains the apparent 15→16→17 px drift.
- **Beyond the layer's extent** the unit buffer holds unit 0, the transparent tile, on both axes (*Parallax and scrolling*).
- **Pixel check:** in 1-1 the buffers equal the level decoder's layers pixel for pixel.
Per-layer scroll-state known fields:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x20 | 4 | f32 | Px | Layer pixel X at screen origin. |
| 0x24 | 4 | f32 | Py | Layer pixel Y at screen origin. |
| 0x34 | 4 | f32 | ratioX | Horizontal ratio. |
| 0x38 | 4 | f32 | ratioY | Vertical ratio. |

- **Scroll-state functions:**
  - `set_bgScreenWPos` (0x8004E13C, breakpoint-verified);
  - `set_bgScrPosProc(obj, cam0x, cam0y, z)` (0x8004EBB8) computes `r` and the anchor at world load;
  - `bgScrProc` (0x8004F1C0) runs every frame;
  - `move_bgScreenWPos` clamps steps to ±15 px (leak-only).

**3D geometry** (F3DEX 1.x, `gspF3DEX.NoN.fifo`, no near clipping):

- **Projection** (every F3DEX run):

  ```
  [2.0606 0 0 0] [0 2.7474 0 0] [0 0 −1.01613 −1] [0 0 −253.73 −170.33]
  = translate(0, 0, +170.33) · guPerspective(fovy 40°, aspect 4/3, near 40, far 5000)
  ```

  - 170.33 = 500 − K with K = 120/tan(20°) = 329.67; `G_MW_PERSPNORM` is 26.
  - Leak `viewManager.projection` builds `guPerspective(persInfo.fovy, 4/3, 40, 5000) · T(0, 0, −120/tan(fovy/2)) ·
    R · T`. Courses use `yoshiZoom_projection` (0x8006B524, from world +0x24).
  - `persInfo` at 0x800FC4A8 holds fovy 40.0, tan(fovy/2) 0.36397 and z0 500.0.
- **Modelview per actor:** a loaded matrix with translation `(sx − 160, 120 − sy, −zdepth)`.
  - `(sx, sy)` is the screen position, which equals world − camera for z = 500.
  - `zdepth` is 500.0–500.5: Yoshi 500.3, other actors 500.4 and 500.5.
  - The eye-space depth of an actor at z = 500 is ≈ K, so **1 unit = 1 pixel** on the main plane.
  - Yoshi is scaled ±0.8, the sign flipping X for his facing.
  - Leak `frameManager World_to_3DWorld` (0x800578A0): `X = wx − camX − 160`, `Y = 120 − (wy − camY)`,
    `Z = wz − camZ + 500`, with frameInfo at 0x800FC52C.
- **Yoshi mesh:** a per-frame animation blob addressed as segment 3 (1-1: 0x806CC950).
  The animation blob contains:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x0000 | Variable | Gfx[] | displayList | G_VTX loads 24 vertices. |
| 0x0200 | 24 × 16 | Vtx[] | vertices | Standard vertices with signed XYZ/ST and white RGBA. |
| 0x0400 | 0x200 | u16[256] | palette | 256-color TLUT. |
| 0x2E00 | Variable | u8[] | texels | CI8 texels. |

  - 6 quads, 24 × 14 to 32 × 25 texels, each drawn as SETTIMG/LOADBLOCK/SETTILESIZE/TRI2.
  - Combiner `0x127E24/0xFFFFF3F9`, render mode `0x0F0A7008`.
  - Built each frame by copying one of Yoshi's cells (display list, vertices, TLUT and part textures) from ucellData
    into the blob (*Yoshi: "ucell" cells drawn as F3DEX quads*). The leak's `cellManager` (`read_unpackageCell`, `setup_dwUCellInfo`) does this.
- **Other 3D:** small textured fans and meshes for some actors (1-1: 5-vertex fans; 2-1: 70 vertices; 6-2: 28 vertices).
- **Where the 3D is:** the title and page-select pop-up books are fully F3DEX (180–230 triangles, overlays `bkpg_*`/
  `bookpg_*`). **No course layer is 3D.**
- **Consequence for the viewer:** the game's 3D camera and its 2D parallax are the same projection, so one perspective
  camera serves layers, sprites and meshes (*Mapping onto the viewer*).

#### Building the meshes (level loader)

For each BG cast placed in the world (*Scene table, scene and actor records (verified)*, IDs 0x8xxx), in descending z:
1. Read the castdt slots (*Casts: castdt, data records, attributes (segment 3; verified layout)*). `bii` gives worldW × worldH, `utIdBk` the block layout, `utID` the unit map.
   Decompress CMPR records with the slide codec (*Compression: `CMPR` + `SMSR00` slide-LZ (verified bit-exact)*).
2. **Tile atlas texture.** `ut` holds nTiles × 16 × 16 CI8 tiles. Decode them through `utPal` (RGBA5551, a = 0 → alpha
   0) into one RGBA atlas 64 tiles wide (1024 px). No layer has more than 899 tiles (checked over all 270
   tiled BG casts; 899 × 256 bytes looks like a tool limit), so an unpadded atlas is at most 1024 × 240, and with 18 × 18
   padded cells at 56 per row it is 1008 × 306. Every atlas fits in 1024 × 512. Pad each tile by one repeated edge texel in the atlas (18 × 18 cells) if linear
   filtering is allowed; the tiles are pixel art, so default to nearest filtering.
3. **Geometry.** For every block position and every unit with a non-zero tile number, emit a quad (2 triangles) with the atlas
   UVs of that tile. Put its vertices in layer pixels with Y negated, `(u, −v, 0)`. Emit quads only inside the layer's
   worldW × worldH. The game shows nothing outside it (*Parallax and scrolling*), so there is no repeat and no edge clamp. Resolve animated units (bit 15) to `utAdd` frame 0. The 1-1 main layer (6656 × 512) is at most
   13,312 quads; empty units are skipped.
4. **Batch:** `blend: 'cutout'` (binary alpha), `depthTest: true`, `depthWrite: true`, `cullBack: false`,
   colours 255. One mesh and one instance per layer, with the instance matrix = translate(X0, −Y0, Z) · scale(1/r, 1/r, 1). The quads are then at `(X0 + u/r, −(Y0 + v/r), Z)`.
5. **Collision-only casts** (`bii` blockW = 0: kupa_room, boss_majin, damybg) produce no textured layer.
   - The Bowser room's floor and walls are drawn as an F3DEX textured mesh (*Other meshes*); the code and ROM data behind
     it aren't identified.
   - A first version shows the far layer and the collision overlay; boss_majin and damybg aren't captured.
6. **Collision overlay (optional):** from `crUtID` of the main layer. For each unit, turn the 16 × 16 shape
   mask into a small RGBA texture (or merge them into an overlay atlas), colour by kind/attr, alpha ≈ 0.4,
   `blend: 'blend'`, at Z = +0.5.
7. **Objects** (every non-0x8xxx actor record, *Scene table, scene and actor records (verified)* and *Sprites, cells and animation*):
   - **Units sprite:** the object castdt has a slot-0 size W × H and a slot-1 `ut`. Decode frame `utID[0]` (CI8,
     W × H bytes at `frame · W · H`) through slot 2 `utPal` into a per-level sprite atlas.
     - Emit a quad centred at `(x, y − H/2)` in world px, i.e. its bottom at the anchor.
     - Place it at `Z = −(floor(z) − 500) − 0.1 · (z − floor(z))` with z = the cast attribute's +4.
     - `blend: 'cutout'`, no flip.
     - This path is verified for the Shy Guy family (*Enemy and item sprites ("units" in object casts)*). The frame chosen at run time depends on slot-4
       animation records (undecoded), so frame 0 is a stand-in.
   - **Player start (0x4001):** draw Yoshi cell 0 (`playA_stand`) with palette 0.
     - The 6 part quads come from the cell's 24 vertices (pixels, y up, origin at the feet) scaled by 0.8.
     - Place the cell at `(x, −y)` on Z = −0.03 (z 500.3).
   - **Everything else** (actors whose art comes from overlay code, sfim or meshes, and invisible logic actors such as
     `cyberGate`, `warp`, exits): add a `Marker` labelled `castId leakName` from `level/castnames_J.json`.
   - **Actors with z ≠ 500** (background enemies): placing them on their own plane follows the same projection
     (leak `World_to_3DWorld`: Z = wz − camZ + 500). This is a hypothesis, not captured (*Rendering*).

### 3.4 Display lists and render state

#### How the game builds a frame

Everything here is verified against the running game unless marked: RSP task breakpoints, full RDRAM dumps at
`osSpTaskLoad`, and display lists decoded with render comparison. The source is the render agent's
`notes/render.md`, and the captured frames are in `render/f_*.{bin,task.json,dl.txt}`:
- `f_title`: title screen;
- `f_page1`: page-1 select;
- `f_111a`, `f_111a2`, `f_111b`, `f_111c`: course 1-1 at camera x = −1, 10.7 and 359.1;
- `f_211a`, `f_211b`: 2-1;
- `f_511a`: 5-1;
- `r621a`: 6-2.

#### Tasks, microcode and segments

**Tasks and microcode**
- **One graphics task per frame**, submitted by the libbg RCP manager (0x80070F64) through `osSpTaskLoad`
  (0x800870AC) and `osSpTaskStartGo` (0x80087214).
- **Task fields:** type 1, flags 4 (`OS_TASK_LOADABLE`), boot microcode rspboot 0x80095C50, **task microcode S2DEX**
  (text 0x80095D20, data 0x800B83E0), FIFO output buffer 0x80187AC0 (0x10000 bytes), yield buffer 0x80197AC0.
- **Display lists** alternate between two dynamic buffers (list bodies at 0x801988A0 and 0x801B2418).
- **Audio** is a separate task (aspMain).
- **Microcode switches happen inside the list.** Whenever the next object needs the other microcode, libbg
  `change_ucode` emits:

  ```
  B4000000 {data}        G_RDPHALF_1 carrying the microcode data pointer
  AF0007FF {text}        G_LOAD_UCODE (low 16 bits = data size − 1)
  ```

  It then re-initialises the new microcode's state: `E7` pipe sync, `BC003406` segment 13, `06` → segment-table list.
  For F3DEX it also sends the viewport, the projection matrix, `G_MW_PERSPNORM` 26, an identity modelview, texture
  scale 0.5, clears the geometry mode, sets the scissor, and resets the other modes. A gameplay frame switches 2–6 times.
- `ucode_info[]` at 0x800AE170 has 12-byte records: `[0]` = S2DEX (text 0x80095D20, data 0x800B83E0),
  `[1]` = F3DEX.NoN 1.23 (text 0x80097510, data 0x800B87A0).
- **Implementer note:** the viewer's `displaylist.ts` has no S2DEX support. Nothing in a course needs it, because
  layers and sprites are built from data (*Level format*, *Sprites, cells and animation*). F3DEX 1.x is only needed for 3D pieces (*Layers at run time, and the real 3D geometry*).

**Segments** (the per-frame header in segment 13, the RCP dynamic buffer):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x070 | 0x40 | Mtx | projection | N64 fixed-point matrix. |
| 0x0B0 | 0x10 | Viewport | viewport | 320 × 240, centered. |
| 0x0C0 | 0x80 | Gfx[16] | segments | BC00xx06 commands for segments 0–15. |
| 0x150 | 8 | Gfx | colorImage | G_SETCIMG using segment 15. |
| 0x168 | 8 | Gfx | depthImage | G_SETZIMG using segment 14. |
| 0x180 | 8 | Gfx | scissor | 0,0 to 320,240. |

- Segment values: seg1 = 0x0020BEB0; seg14 = the Z buffer (0x0020DE40 on the title and in menus, **0 in courses**);
  seg15 = the colour frame buffer (0x0013CAC0).
- Sprites point segments 11 (TLUT base) and 12 (texture base) at their data before each draw.
- F3DEX meshes use segment 3 for their animation blob.

#### Draw order of a gameplay frame

Course 1-1, frame `f_111c`, camera (359.1, 272): 810 commands in 7 microcode runs.

| # | Microcode | Content | Counts |
|---|---|---|---|
| 0 | S2DEX | header (segments, scissor, other modes); **no colour clear, no Z buffer**. BG layers far → near: enkei, chukan, main, each `G_BG_1CYC` after its TLUT load. Then near-ground sprites (fruit, shadows) | 3 BG, 4 objects |
| 1 | F3DEX | **Yoshi**: 24 vertices, 6 CI8-textured quads (12 triangles) | 1 VTX |
| 2 | S2DEX | enemy and object sprites | 2 objects |
| 3 | F3DEX | an actor drawn as a 5-vertex textured fan under a shear/scale matrix (a wobble effect) | 4 triangles |
| 4 | S2DEX | a sprite | 1 object |
| 5 | F3DEX | a second 5-vertex fan actor | 4 triangles |
| 6 | S2DEX | foreground sprites and the **HUD**: the fruit frame (30 × 24 × 21 `G_OBJ_LDTX_SPRITE` tiles), smiley flowers, counters (CI8 16 × 16, CI4 32 × 24); ends with `E9` full sync and `B8` end | 31 objects |

**Other frames**
- **2-1** (`f_211b`): S2DEX 1 BG + 5 objects → F3DEX 70 vertices / 52 triangles → S2DEX **1 BG** (the cave's front layer,
  z 500.18, is drawn after the 3D actors) + 31 objects.
- **6-2** (`r621a`): 2 BG + 6 objects / F3DEX 28 vertices, 14 triangles / 4 objects / Yoshi / 33 objects.
- **Title** (`f_title`): S2DEX header with a Z clear, then F3DEX 377 vertices / 179 triangles (the pop-up book) and a
  gradient TEXRECT, then 3 objects ("PUSH START").
- **Page-1 select** (`f_page1`): F3DEX 487 vertices / 231 triangles with 95 matrices, then 4 objects.

**Ordering rule.** The order in these frames is verified; the mechanism is leak-only (libbg `bg.o` `DrawFrameBuffer`).
- The game walks one list of drawable objects (leak `BGzsPtr[]`, "z-sorted"), with layers, sprites and meshes
  interleaved.
- That the list is sorted by z, far to near, is a hypothesis consistent with every captured frame. In 1-1 the main
  layer (z 500.5) comes before Yoshi (500.3); in 2-1 the main layer (500.18) comes after the actors.
- Each object is drawn by a per-type callback, mostly `makeGfx_display` 0x8005DFE0 and `makeGfx_unitImg` 0x8005DF20.
- The microcode is switched as needed.
- There is no depth buffer in courses, so the order is the occlusion.

#### Presentation options (render agent's assessment)

Summary of `notes/render.md` section 8. The lead's recommendation in *Recommended presentation: the game's own camera over depth-placed layer planes* follows it.

| Option | Assessment |
|---|---|
| (a) Stitched layers as planes at depth | The most faithful, **if** built as the game's own geometry: planes at depth floor(z) − 500 behind the main plane, scaled by 1/r, offset by the anchor term (*Coordinates (world pixels → viewer units, 1 px = 1 unit)*). A 40° perspective camera at distance K then reproduces `P = r·cam + c` exactly. Omitting the anchor term would misplace 1-1's far layer by 86.7 px vertically and 6-2's by (−11.9, 50.0) |
| (b) Orthographic side view with explicit parallax | Numerically identical to (a) for a panning camera (`screen = layer px − (r·cam + c)`), and the simplest 2D implementation. Zooming out to show a whole level breaks parallax semantics, and 3D meshes (Bowser room floor, pipe lifts) need projecting |
| (c) Free fly over layered planes | Good for inspecting depth, but not how the game ever looks: courses have no camera rotation, and flat planes and sprites look like cardboard. Layer edges and seams never meant to be seen become visible |

- **Recommendation:** (a)'s geometry through a perspective camera locked to the game's (40°, K, no rotation) as the
  default "game view". Offer free fly or a limited orbit as an optional inspection mode.
- **Actor order:** actors and Yoshi sit on the depth-0 plane and are ordered by their z tie-breakers
  (Yoshi 500.3, others 500.4/500.5).
- **Layer order:** layers are not always behind actors (2-1's cave front layer at 500.18 is drawn after them).
- **Correction to the assessment:** its pitfall that far layers need texture wrap is superseded. The game draws nothing outside a layer's extent (*Parallax and scrolling*), so finite quads without repeat are exact.

### 3.5 Textures and materials

#### Palettes, texture formats and run-time tricks

Details are in `notes/render.md` section 5.

- **Colours of Yoshi:** the same cells drawn with a different TLUT, palette k of `yoshi_outpalette` (verified).
- **Texture formats:**
  - Every textured element in a course is colour-indexed: CI8 layers, sprites and Yoshi; CI4 on some HUD elements.
  - Palettes are RGBA5551 TLUTs; alpha is 1 bit and index 0 is transparent in practice.
  - I4/I8 are used only for text, shadows and "PUSH START".
  - Course frames contain no RGBA16 or RGBA32 textures.
- **Combiners:**

  | Used for | Combiner |
  |---|---|
  | layers | `TEX0 · PRIM + ENV` (prim FFFFFFFF, env 01010101, effectively plain texture) |
  | tinted intensity sprites (shadows prim 0x00000070, text) | `(PRIM − ENV) · TEX0 + ENV` |
  | CI sprites | `TEX0` decal |
  | a flash or tint towards PRIM (hypothesis: damage or blinking) | `(PRIM − TEX0) · ENV + TEX0` |
  | Yoshi mesh and pop-up book | `TEX0 · SHADE` |

- **Render modes:**

  | Used for | Mode |
  |---|---|
  | layers | `0x00A0300D` (AA, coverage × alpha, alpha threshold) |
  | sprites | `0x00504245` (force blend, IN·α + MEM·(1 − α), alpha threshold via blend colour) |
  | Yoshi | `0x0F0A7008` (AA, textured edge, opaque) |
  | Bowser room mesh | `0x00553048` (AA translucent) |
  | S2DEX object render mode | 0x18 for sprites, 0x0C for layers |

- **Not used in courses:** fog, frame-buffer reads, and a Z buffer (menus have one). The libbg coverage and Z
  visualisers (`bg_viscvg`, `bg_viszbuf`) and screen effects were not observed.
- **Textures generated at run time:**
  - the 336 × 256 layer ring buffers, filled by the CPU from 16 × 16 units, including animated units;
  - the per-frame Yoshi blob;
  - sprite frames decompressed from CMPR `ut` records.
- **For the viewer:** decode to RGBA8 once. Use binary alpha from the RGBA5551 bit (the existing `'cutout'` mode) for
  layers, sprites and Yoshi, and a blended quad for shadows (black with alpha 0x70/255).

### 3.6 Collision

#### Tile maps and collision (verified pixel-exact against the game's BG buffers)

A layer is a grid of **units** (16 × 16 px) grouped into **blocks** of 16 × 16 units (256 × 256 px).

| Slot | Record | Format |
|---|---|---|
| 0 | `bii` (12 bytes) | `u16 blockW (256), blockH (256), unitW (16), unitH (16), worldW, worldH` in px. `blockW = blockH = 0` marks a collision-only cast (*Collision-only and special casts*) |
| 4 | `utIdBk` | `u8[blocksAcross × blocksDown]`, row-major: the block number at each block position. Blocks can repeat, e.g. the 1-1 chukan layer is `00 01 02 00 01 02 …` |
| 3 | `utID` (usually CMPR) | `u16[16 × stride]`, stride = nBlocks × 16. Unit (lx, ly) of block b is at `ly·stride + b·16 + lx`. Value: bit 15 = 0 → tile number (0 = empty); bit 15 = 1 → animated unit `k = v & 0x7FFF` |
| 1 | `ut` (CMPR) | `256 × nTiles` bytes; tile t is 16 × 16 **CI8** at `t << 8`, row-major |
| 2 | `utPal` (raw, 0x200) | 256 × u16 **RGBA5551** (`rrrrrgggggbbbbba`); a = 0 is transparent, and index 0 is transparent in practice |
| 5 | `utAdd` (41 layers) | 10-byte records `u16 frame[5]` (tile numbers, 0x8000 = end). Record k animates every unit with utID `0x8000 \| k`. Frame timing is not decoded (*Open questions and hypotheses*) |
| 6 | `crUtID` (121 layers) | collision, same geometry as `utID` |

Neither map has flip or priority bits (checked over all 273 layers).

**To decode a layer to an image** (what render comparison does):

```
for by in 0..worldH/256-1, bx in 0..worldW/256-1:
  b = utIdBk[by * (worldW/256) + bx]
  for ly, lx in 0..15:
    v = utID[ly * stride + b*16 + lx]; if v & 0x8000: v = utAdd[v & 0x7FFF].frame[0]
    if v: blit ut[v*256 .. +256] (CI8 → utPal RGBA5551) at (bx*256 + lx*16, by*256 + ly*16)
```

**Collision value** (`crUtID` u16 v; structure verified from code, semantics partly open):

| Bits | Mask | Field | Meaning |
|---|---|---|---|
| 11–15 | 0xF800 | kind | Collision kind |
| 8–10 | 0x0700 | attr | Surface attributes |
| 0–7 | 0x00FF | lo | Shape or coin index, as below |

- If `lo >> 6` is 0 or 1, `lo` selects a shape: `mask = shapes[(lo >> 6) · 64 + (lo & 0x3F)]`, 16 u16 rows with
  bit 15 the leftmost pixel and 1 = solid. There are 128 pointers and 33 distinct masks (empty, full, halves, and
  1:1, 1:2 and 2:1 slopes); they are dumped to `level/shapes_J.json`.
- If `lo >> 6 == 3`, the unit is a **BG coin** with index `lo & 0x3F`. It is collected through
  `findActor(0x406F2000 | index)` and the unit rewritten.
- Common values: 0x0701 solid, 0x0601 platform, 0x0640–0x0651 slopes. Kinds 2, 5, 6, 7, 12–14 and 31 also occur;
  their surface types (one-way, water, lava, spikes…) are open (*Open questions and hypotheses*).
- Only the **main** layer carries collision, aligned 1:1 with its drawn units. Unit = world px >> 4 (arithmetic).

### 3.7 Environment, sky, fog, and lighting

### 3.8 Cameras and paths

#### Camera and projection summary

| Quantity | Value | Where |
|---|---|---|
| Camera frame (top-left of the screen in main-layer px) | Fields listed under Run-time variables | frameInfo |
| Start frame | world +0x28/+0x2C | *World struct (0x118 bytes, segment 4)* |
| Field of view | 40° vertical, aspect 4/3 | `persInfo` 0x800FC4A8 |
| Eye distance from the main plane | K = 120 / tan(20°) = 329.67 px | projection matrix |
| Near / far | 40 / 5000 | projection matrix |
| Layer parallax | `r = K / (floor(z) − 500 + K)`; `P = r·cam + floor16(r·cam0 − a) − r·cam0` | *Parallax and scrolling* |
| Zoomed arenas | `bossZoom_projection` (0x8006B560) and larger layer buffers (the Bowser room uses a 496 × 384 ring with frame (−80, −64, 480 × 368)) | zoom behaviour not captured (*Rendering*) |

#### Recommended presentation: the game's own camera over depth-placed layer planes

**Key fact (derived from the verified formula).** The game's parallax is an exact perspective projection:
- The per-layer factor `r = K / (floor(z) − 500 + K)` with `K = 120 / tan(20°) = 329.70` (*Parallax and scrolling*) is what a
  pinhole camera with a **40° vertical field of view** produces.
- The camera sits K world pixels in front of the main plane (so the main plane shows 240 px of height), and a
  layer's plane lies `floor(z) − 500` further back.
- Each layer is enlarged by 1/r in the game, so its texels stay 1:1 on screen.

So these planes, seen through that camera, reproduce the game's scrolling exactly, and the viewer's existing
perspective renderer can draw them as ordinary textured triangles.

**This is literally the game's camera, not just an equivalent.**
- The game draws Yoshi and some actors as F3DEX textured quads under a real perspective projection: fovy 40°,
  aspect 4/3, near 40, far 5000 (verified from frame display lists, *How the game builds a frame*).
- It composes the tile layers on the CPU with the parallax factor derived from that same projection.
- Frames f_111a, f_111b and f_111c confirm `imageX = (r · camX + c_x) mod 336` to 1/32 px on all three layers
  (c_x = 0 in 1-1), including at camX = 359.1.

**Recommendation:** build each world as flat textured meshes (one per tile layer), placed at the game's depths
and scaled by 1/r, plus sprite quads for objects and an optional collision overlay. Present it in two camera
modes over the same data:
1. **Side view (default):** the game camera. fovY = 40°, the eye on +Z at distance K scaled to the viewport
   height, rotation locked, and WASD/arrows/drag panning in X and Y within the level bounds. The wheel changes
   the distance (a zoom; parallax then deviates from the game, as in the game's own zoomed arenas).
2. **Free fly (toggle):** the existing controls. The layers separate in depth like a pop-up book, which is a
   useful way to inspect them.

**Options compared**

| Option | Faithfulness | Work | Problems |
|---|---|---|---|
| **A. Depth-placed planes + perspective camera (recommended)** | Exact on both axes: with the anchors of *Coordinates (world pixels → viewer units, 1 px = 1 unit)* the screen position of every layer texel equals the game's to 4e-12 px (lead simulation over all 300 placements); the ordering offset costs ≤ 0.017 px | Small renderer changes (camera mode and field of view); the data model gains layer metadata only | Layers are finite and show nothing beyond their extent, like the game (*Parallax and scrolling*), so no texture repeat or clamping is needed. Coplanar layers (z 500.2/500.6, `_mask` 500.18) need a tiny Z order offset. Very large far-layer quads (a 7168 × 1792 layer at r = 0.28 is 25,600 world units wide) are harmless with the log depth buffer |
| B. Orthographic side view with explicit per-layer scroll factors | Exact, if the renderer applies `P = r · cam + c` per layer and axis each frame | New render path (per-layer uniform offset, orthographic projection) that bypasses `Instance.matrix`; UI must drive it | No free fly; duplicates what A gets for free |
| C. One stitched image per layer as a single quad | Visually exact at r = 1 | Least code | Textures up to 9216 × 256 and 7168 × 1792 px exceed common WebGL limits (WebGL2 guarantees only 2048); memory waste for repeated blocks; tile animation impossible later |
| D. Free fly only (what the viewer does today) | Parallax only by accident | None | Loses the side-scroller reading entirely |

A in detail is just C's content cut into atlas-textured unit quads (*Building the meshes (level loader)*), positioned as in B's formula, and
viewed with the game's lens.

## 4. Objects

### 4.1 Placement records

#### Object placement

- Every actor record whose ID is not 0x8xxx is an object. Cast IDs map to leak names through the cast table
  relocations (`level/castnames_J.json`).
- Examples:
  - player and pickups: 0x4001 `yoshi` (player start), 0x4002 `tamago` (egg), 0x4030… fruit, 0x406F coins;
  - enemies: 0x4199/0x419C `atamaheiho` (Shy Guy variants);
  - course flow: 0x414A `timeAttack_Goal`, 0x44CA `cyberGate`, 0x4507–0x450A `warp`, 0x4208… `tubo`,
    0x42AE… `nextDoor`, 0x4450… `lrNextGate`, 0x43xx `pipelift*`.
  - One leak actor (e.g. `tubo`) owns many IDs that differ only in their attribute (destination or variant).
- **Spawn:** with `anotherActor_OnStage`, an actor spawns when it enters the frame (size from castInfo+0x2A,
  default 64). BG casts and "always" objects spawn at once.
- **For a viewer:** show every object at its placement, drawn with its first sprite frame where decodable (*Sprites, cells and animation*),
  otherwise as a labelled marker, since placement alone doesn't say which animation plays.
- **Prototype renders** (`level/out/{id}_{name}/`): `layer_{cast}_{name}.png` (each layer stitched 1:1),
  `composite.png` (parallax composite viewed column by column), `collision.png` (per-pixel masks) and
  `actors.png` (IDs at positions). Worlds rendered: 43 (1-1), 46 (2-1), 21 (5-1), 30 (5-2), 35 (6-2), 32 (3-3),
  17 (4-1), 162 (Boss_kumo), 78 (Kupa_room). Screenshot-versus-render strips: `level/cmp_111b.png`,
  `cmp_211a.png`, `cmp_621a.png`.

### 4.2 Object and model formats

#### Inside castData (segment 3; boundaries from leak objects matched byte for byte)

| Seg-3 offset | ROM | Leak object | Contents |
|---|---|---|---|
| 0x000000 | 0x528430 | `castDataObj1.o` | `castdt_*` records: actor casts (overlay descriptor, unit and palette pointers, attributes) |
| 0x00CA20 | 0x534E50 | `castDataObj2.o` | " |
| 0x019370 | 0x5417A0 | `castDataObj3.o` | " |
| 0x020B40 | 0x548F70 | `castDataBG.o` | BG casts (layers, *Level format*) |
| 0x033BB0 | 0x55BFE0 | `castDataMain.o` | main cast list |
| 0x033CC0 | 0x55C0F0 | `castDataNext.o` | "next" (goal and warp) casts |
| 0x03A350 | 0x562780 | `unitData.o` (`unit_*c.o`) | unit tables (sprite and layer images), mostly CMPR-compressed |
| 0x41BF40 | 0x944370 | `ucellData.o` (`ucell_yoshi.o`) | Yoshi's sprite cells, uncompressed, 0x1CA5C0 bytes |
| 0x5E6500 | 0xB0E930 | `mesgData.o` | message table and Japanese messages only (E/F/G absent) |

**Segment 4:** worldDatabase at ROM 0xB16170, then warp data at 0xB355F0 (2,304 bytes; the leak's `warpDatabase.o`,
100% match). The record formats are in *Level format*.

### 4.3 Skeletons and animation

#### Sprites, cells and animation

Verified against the running game unless marked; details in `notes/render.md` section 4.

##### How a sprite is drawn (S2DEX 1.x)

Per object, `oamManager makeGfx_display` (0x8005DFE0) emits:

```
E7000000 00000000              G_RDPPIPESYNC
FA000000 {prim}  FB000000 {env}
06000000 {mode DL}             static sub-list in code data: 0x800ACD68 / 0x800AD368 / 0x800AD568 / 0x800AD868
                               (other mode H 0xAC30 TLUT RGBA16 + bilinear; render mode 0x00504245)
05170000 <uObjMtx*>            G_OBJ_MOVEMEM (or 05070002 <uObjSubMtx*>)
BC002C06 {TLUT base}           segment 11 = palette
C1000017 <uObjTxtr*>           G_OBJ_LOADTXTR, TLUT {type 0x30, image 0x0B000000, phead 256, pnum−1 255 or 15}
BC003006 {image base}          segment 12 = CI texels
B1000000 00000018              G_OBJ_RENDERMODE (bilinear | shrink 1)
C200002F <uObjTxSprite*>       G_OBJ_LDTX_SPRITE (HUD digits: C400002F G_OBJ_LDTX_RECT_R)
```

**S2DEX 1.x opcodes:** 01 `G_BG_1CYC`, 02 `G_BG_COPY`, 03 `G_OBJ_RECTANGLE`, 04 `G_OBJ_SPRITE`, 05 `G_OBJ_MOVEMEM`,
06 `G_DL`, AF `G_LOAD_UCODE`, B0 `G_SELECT_DL`, B1 `G_OBJ_RENDERMODE`, B2 `G_OBJ_RECTANGLE_R`, B3/B4
`G_RDPHALF_2/1`, B6–BF as F3DEX 1.x, C1 `G_OBJ_LOADTXTR`, C2 `G_OBJ_LDTX_SPRITE`, C3 `G_OBJ_LDTX_RECT`, C4
`G_OBJ_LDTX_RECT_R`, E4 and up RDP.

**Structures** (big-endian; S2DEX 1.x layouts):

uObjTxtr, 24 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | type | TXTRBLOCK 0x00001033; TXTRTILE 0x00FC1034; TLUT 0x00000030. |
| 0x04 | 4 | u32 | image | Image or palette pointer. |
| 0x08 | 2 | u16 | a | Block/tile: TMEM address; TLUT: palette head. |
| 0x0A | 2 | u16 | b | Block: bytes/8 − 1; tile: width; TLUT: color count − 1. |
| 0x0C | 2 | u16 | c | Block: 0x4000/width; tile: height. |
| 0x0E | 2 | u16 | sid | Status identifier. |
| 0x10 | 4 | u32 | flag | Status flag. |
| 0x14 | 4 | u32 | mask | Status mask. |

uObjSprite, 24 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | s16 | objX | S10.2 X. |
| 0x02 | 2 | u16 | scaleW | U5.10 horizontal scale. |
| 0x04 | 2 | s16 | imageW | S10.5 width. |
| 0x06 | 2 | u16 | padding06 | Padding. |
| 0x08 | 2 | s16 | objY | Y. |
| 0x0A | 2 | u16 | scaleH | Vertical scale. |
| 0x0C | 2 | s16 | imageH | Height. |
| 0x0E | 2 | u16 | padding0E | Padding. |
| 0x10 | 2 | u16 | imageStride | Image stride. |
| 0x12 | 2 | u16 | imageAdrs | TMEM address. |
| 0x14 | 1 | u8 | fmt | 0 RGBA; 2 CI; 3 IA; 4 I. |
| 0x15 | 1 | u8 | siz | 0: 4-bit; 1: 8-bit; 2: 16-bit. |
| 0x16 | 1 | u8 | pal | Palette. |
| 0x17 | 1 | u8 | flags | Flags. |

uObjTxSprite, 48 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 24 | uObjTxtr | texture | Texture load record. |
| 0x18 | 24 | uObjSprite | sprite | Sprite record. |

uObjMtx, 24 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 16 | s32[4] | linear | A,B,C,D in 16.16. |
| 0x10 | 4 | s16[2] | translation | X,Y in 10.2. |
| 0x14 | 4 | u16[2] | baseScale | BaseScaleX, BaseScaleY. |

For a 32×32 CI8 TXTRBLOCK, a/b/c are 0x0000/0x007F/0x0200.

About `uObjMtx`:
- X, Y are the screen position of the sprite origin.
- A = ±scale, where negative A flips horizontally. D = −1, because object space is y-up. B and C carry rotation
  (the HUD flower tilts).
- Drop shadows use A = 0.35 or 0.5 with D = −A.
- The BaseScale fields decoded as implausible values (open).

**Placement** (verified in `f_111b`, camera (10.748, 272)):

| Object | Placement record | Sprite | `uObjMtx` origin |
|---|---|---|---|
| Shy Guy | – | object rectangle (−16, −16), 32×32 | (188.5, 177) |
| Shy Guy's shadow | – | I8 32×16, prim 0x00000070 (translucent black) | (188.5, 193), 16 px lower, at the feet |
| apple | (136, 456) | object rectangle (−12, −10.5), 24×21 | (125.25, 174.5) |

- **Main-plane actors:** screen = world − camera, so a sprite is centred at `(x − camX, y − camY − h/2)`. Its bottom
  edge sits at the placement anchor.

##### Enemy and item sprites ("units" in object casts)

- **Object castdt** (*Casts: castdt, data records, attributes (segment 3; verified layout)*) uses the same 8 data slots as layers:
  - slot 0: dimensions (`0020 0020 0020 0020 0020 0280` = 32×32 for the Shy Guy family);
  - slot 1: `ut`, the concatenated CI8 frames, W × H bytes each, usually CMPR;
  - slot 2: `utPal`, 256 × RGBA5551, raw, often shared;
  - slot 3: `utID`, a u16 frame index table;
  - slot 4: per-actor animation records (format open).
- **Shy Guy** (cast 0x401F, verified):
  - `ut` holds 20 × 32×32 frames (20,480 bytes, stored compressed as 12,100 at seg-3 0x0312A920).
  - The palette at ROM 0x567EF8 is shared by 60 casts (heiho, atamaheiho, dashheiho, bowerheiho, snow_heiho, …).
  - The RAM sprite texture in `f_111a` (0x807DC900, TLUT 0x807FA220) equals decompressed frame 0 byte for byte.
  - Sheet: `render/out/enemy_401f_extraHeiho_sheet.png`.

##### Yoshi: "ucell" cells drawn as F3DEX quads

**Data** (ucellData, ROM 0x944370–0xB0E930, uncompressed; leak sources `SRC_GWY/ucell_yoshi.tex`, `.shp`, `.tbl`, `.idx`):

| Part | Location | Contents |
|---|---|---|
| `yoshi_outpalette` | 8 × 256 × u16 RGBA5551 at ROM 0x944370 + 0x200·k | k = 0 green, 1 red, 2 yellow, 3 blue, 4 light blue, 5 pink, 6 white, 7 black. Palettes 0 and 1 equal the in-game TLUTs of green and red Yoshi (256 of 256 entries) |
| 904 part images `{part}_outtexture` | after the palettes (e.g. `head_kihon` 800 bytes at 0x965130, `body_kihon` at 0x9A78C8) | CI8 |
| 1,187 cells (`.shp`) | – | Shape record below, containing six textured quads. The list uses translucent textured-edge render mode, TLUT RGBA16, bilinear, decal combiner, `gsSPVertex(24)`, `gsDPLoadTLUT_pal256`, then 6 × (`gsDPLoadTextureBlock` CI8 W×H + `gsSP2Triangles`). Vertices use the Vtx layout below with z = 0: units are pixels, y up, origin at the centre of the feet, s/t ×32 with texture scale 0.5 |
| Cell table (`.tbl`) | – | 0x80-byte cell records below |
| Face sequences (`.idx`, 114) | – | Face-sequence records below; for example ashibumi has eight three-frame head_furi_eat entries |

Shape payload (source archive and nviewer yoshicell.ts):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 0x200 | Gfx[] | displayList | F3DEX 1.x commands. |
| 0x200 | 24 × 16 | Vtx[] | vertices | Twenty-four vertices. |

Vtx, 16 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 6 | s16[3] | position | X,Y,Z; Z is zero. |
| 0x06 | 2 | u16 | flag | Vertex flag. |
| 0x08 | 4 | s16[2] | texcoord | S,T. |
| 0x0C | 4 | u8[4] | color | R,G,B,A. |

Cell record, 0x80 bytes (nviewer yoshicell.ts):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | shape | Segmented shape pointer. |
| 0x04 | 1 | u8 | nparts | 6. |
| 0x05 | 3 | u8[3] | padding05 | Alignment. |
| 0x08 | 6 × 8 | part[] | parts | Six part records. |
| 0x38 | 0x48 | u8[] | unknown38 | Not consumed by the viewer. |

Part record, eight bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 1 | u8 | partnum | Part number. |
| 0x01 | 1 | u8 | unknown01 | Unknown. |
| 0x02 | 2 | u16 | bytes | Width × height. |
| 0x04 | 4 | u32 | texture | Segmented CI8 texture pointer. |

Face-sequence record, sequential fields; duration storage width is not established here:

| Order | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 1 | Unknown | Unknown | duration | Frame count. |
| 2 | 4 | u32 | headTexture | Head-texture pointer. |

- **Animations,** as cell ranges in table order: `playA_stand`, `walk` (16), `ashibumi` (9), `runTWO` (16), `playB`
  crouch/stretch/turn, `playC` jump (12), flutter `bataStwo/bataLtwo` (16), damage, fall, `playD` tongue, `playE`
  swallow/throw, `playF` swim, `playG_walkMAE` (43), `playH_tamagoP`, `playI` idle and emotes.
- **Full cell index:** `render/out/yoshi_ucell_index.txt`.
- **Body-cell timing** lives in `actor_yoshi` and is not decoded.
- **Run time** (verified):
  - Each frame the game copies one cell into a heap blob addressed as segment 3: display list at +0, 24 vertices
    at +0x200, the selected colour's TLUT at +0x400, the 6 part textures from +0x2E00.
  - It draws the blob with F3DEX under a modelview of scale **(±0.8, 0.8)**, so Yoshi appears at 80% of cell size;
    the sign gives his facing.
  - The captured blobs match cells `playI_hey_075` and `playA_ashibumi_091` by vertices and textures.
- **Sheets:** `render/out/yoshi_ucell_pal0_000_063.png` (green, cells 0–63), `yoshi_ucell_pal1_*.png` (red).

##### Other meshes

- **Unidentified course actors:** 1-1 has 5-vertex textured fans (4 triangles) under shear/scale matrices, a wobble
  effect; 2-1 has a 70-vertex, 52-triangle mesh; 6-2 a 28-vertex mesh. Their actors and data sources are not
  identified (leak `sfimManager SfimDListSet*` builds vertex-quad lists for "animation characters"; hypothesis).
- **Bowser room** (world 78, frame `f_078a`):
  - The collision-only main cast is drawn as an **F3DEX textured mesh**: modelview T(225, 280, −500.5); 4 batches
    of 32/32/32/24 vertices, the first vertex at (−320, 256, 0); CI8 64×32 tiles, TLUT 0x807FC7A0; TRI1 pairs.
  - The far layer is one `G_BG_1CYC` with a **496×384** ring buffer and frame (−80, −64, 480×368), for the boss zoom.
  - The frame also has Yoshi and 104 S2DEX objects.
  - The mesh's ROM source isn't identified (hypothesis: the arena actor's overlay).
- **Not captured:** `boss_majin`, `damybg`, `pipelift3D`.
- **Menus:** the title and page-select pop-up books are F3DEX with a Z buffer (0x8020DE40) and a Z clear
  (180–230 triangles, 56–57 TLUT loads; overlays `bkpg_*`/`bookpg_*`).

### 4.4 Behaviors, triggers, and scripted objects

## 5. Audio

### 5.1 Audio storage and banks

### 5.2 Sequence format and driver

Everything here is verified unless marked. The sources are the J code (the script interpreters are the leak's
`SOUND_GWY/audio.o` functions with only relocations changed), the ROM data, RDRAM dumps and audio captures. Details,
opcode tables and tools are in `notes/music.md` and `music/`.

#### Engine

| Item | Value |
|---|---|
| Driver | Nintendo EAD "Nas" driver, revision `Driver/VerH` (leak `audio.o` `.mdebug`: `./Driver/VerH/driverH.2.m`), the Super Mario 64 (Shindou) / Ocarina of Time family: three-level sequence scripts (sequence → channel → layer), instrument banks with 64-entry drum kits, two VADPCM sample banks, point-list envelopes. **Not libultra**: no ALBank, no MIDI |
| J differences from the leak | none in the interpreters `Common_Com`, `Nas_NoteSeq`, `__Command_Seq`, `__SetVoice`, `__SetNote`, `Nas_GroupSeq`. `Nas_SubSeq` has 20 changed struct offsets: J channels have **4 layers** (the leak has 6) |
| Game interface | `Na_SceneChange` 0x80010690, `Na_GetSeqNum` 0x80011424, `Na_BgmChange` 0x80011360, `Na_FanfareBgmStart` 0x80011194, `Na_BgmStop` 0x800110DC, `Na_SubBgmStart` 0x80011110 |
| RSP microcode | `aspMain` (ROM 0x99540, byte-identical to the leak); mupen64plus-rsp-hle recognises it as `nead_ys` (signature 0x1F08122C), 24 commands |
| Output | 32,000 Hz nominal (AI dacrate 1520 → 32,006 Hz), stereo, 24 voices, 3 sequence players |
| Update rate | 544 samples per video frame (varied 528–560 to stay in sync), **3 updates per frame** (≈180 per second) |
| Tempo | `DD bpm` sets tempo = bpm × 48. Each update: `acc += tempo + tempoChange`; if `acc ≥ 10770`: `acc −= 10770` and run one tick. The constant comes from J rodata: `trunc(3 × 2880000 / 48 / 16.713)`. So there are 48 ticks per beat at bpm × 1.0028, and at most one tick per update |

#### Data locations (J ROM)

| Table (in code `.data`) | ROM | RAM | Entries |
|---|---|---|---|
| Audiobank table | 0xB9E80 | 0x800B9280 | 62 |
| Sequence → bank map | 0xBA270 | 0x800B9670 | 62 |
| Audioseq table | 0xBA370 | 0x800B9770 | 62 |
| Audiowave (sample bank) table | 0xBA760 | 0x800B9B60 | 2 |

| Segment | ROM | Size | Contents |
|---|---|---|---|
| Audiobank | 0xBA790 | 0x2C0E0 | 62 instrument banks |
| Audiowave | 0xE6870 | 0x40E840 | sample bank 0 (SFX, 0x2628F0 bytes), sample bank 1 (music, 0x1ABF50 bytes at 0x349160) |
| Audioseq | 0x4F50B0 | 0x33380 | 62 sequences |

The entries tile each segment exactly, with no gaps.

**AudioTable header (0x10 bytes).**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | s16 | count | Entry count |
| 0x02 | 2 | s16 | reserved_02 | Zero |
| 0x04 | 4 | u32 | romAddr | Zero = linked segment start |
| 0x08 | 8 | u8[8] | padding | Reserved |

**AudioTable entry (0x10 bytes).**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | offset | Segment-relative data offset |
| 0x04 | 4 | u32 | size | Byte count |
| 0x08 | 1 | u8 | medium | 2 = cartridge |
| 0x09 | 1 | u8 | cachePolicy | Cache policy |
| 0x0A | 2 | u16 | shortData1 | For banks: sampleBank << 8, low byte 0xFF; banks 0–3 use sample bank 0, 4–61 use bank 1 |
| 0x0C | 2 | u16 | shortData2 | For banks: numInstruments << 8 plus numDrums |
| 0x0E | 2 | u16 | shortData3 | Additional metadata |

**Sequence-to-bank map.**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 124 | u16[62] | offset | Map-relative list offsets |

**Bank list (1 + count bytes).**

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 1 | u8 | count | Bank count |
| 0x01 | count | u8[] | bank | Bank IDs |

Sequence 0 selects banks 1, 3, 2, 0. Sequence n selects n + 3, except 26–29 select 29. Channel command `C6 a` selects `bank[count − a]`.

**Compared with the leak:**
- No sequence is byte-identical, and J has 62 against the leak's 65.
- 42 of 62 banks are identical.
- Music sample bank 1 is identical, but SFX sample bank 0 differs.
- The leak's `audio.*.cart` files are an older SFX sequence, bank and sample set, not J data.

#### Rendering a song offline to PCM

This follows `music/render.ts` (a self-contained TypeScript prototype, about 2 s per 160 s song), whose semantics
were read from the J/leak code.

1. **Timing loop:**
   - The update length is `spu = 32000 / 180` samples; round cumulative positions.
   - Per update: player tick check (at most one tick: sequence script, then channels 0–15 with their scripts and
     layers 0–3).
   - Then `Nas_MainCtrl`: fades; `channel.appliedVolume = (volume × volumeScale × playerVolume)²`;
     `layer.velocity = velocitySquare × that`; `layer.freqScale × channel.freqScale`; pan mix
     `(chanPan × weight + layerPan × (128 − weight)) >> 7`.
   - Then voice updates (envelope, vibrato, gains), then mix `spu` samples.
2. **Initial state:**
   - Player: tempo 5760 (120 BPM), fade scale 1, mute scale 0.5, velocity/gate tables = defaults.
   - Channel: volume 1, pan 64, pan weight 128, release 240, envelope `DEFAULT_ENV`, vibrato rate 2048, depth 0,
     short notes.
   - Layer: gate 0x80, pan 64, instrument 255 (the channel's).
3. **Notes → voices:**
   - Drums: `drum[(note + transposes) & 0xFF]`, frequency = drum tuning; the drum's pan applies unless `CC`.
   - Instruments: `n = note + seq/channel/layer transposes` (skipped if ≥ 128); pick low/mid/high by range;
     `freq = 2^((n − 39)/12) × tuning × bend` (`PITCHTABLE` at ROM 0x9BCB4).
   - A legato note on the same sample continues the voice.
   - Envelope: the layer's if it has a release set, otherwise the channel's.
4. **Envelope** (per update): the point list in *Formats*, levels squared. On release, the frequency, velocity and pan
   freeze; the level falls by `RELEASE_TABLE[rate]` per update down to the sustain level, where `sustain =
   channelSustain × level / 256`. With x = 1/3:
   - `[255] = x/0.25`, `[254] = x/0.33`, `[253] = x/0.5`, `[252] = x/0.66`, `[251] = x/0.75`;
   - `[128–250] = x/(251 − i)`, `[16–127] = x/(60 + 4(128 − i))`, `[1–15] = x/(480 + 60(15 − i))`, `[0] = 0`.
5. **Vibrato:** after the delay, depth and rate ramp to their targets; `time += rate`;
   `v = sine64[(time >> 10) & 63] >> 8`; factor `1 + (PCENTTABLE[128 + v] − 1) × depth/4096`.
6. **Voice output:**
   - Resample the VADPCM stream with the RSP 4-tap resampler (`RESAMPLE_LUT`), step = `freq` (the output rate is the
     32,000 Hz native rate); the driver splits steps ≥ 2 into two halves.
   - Gain `L = vel × StereoLeft[pan]`, `R = vel × StereoLeft[127 − pan]` (`StereoLeft` = 128 f32 at ROM 0x9C428),
     ramped linearly across the update.
   - Samples without a loop stop at their end.
7. **Reverb** (hypothesis): `NA_DELAY_NORMAL` (ROM 0x9E430) describes one delay line of 0x30 × 64 = 3,072 samples
   with decay 0x2000. The prototype approximates it with a feedback delay of gain 0.25, and it can be left out.
   Master level is not modelled; normalise, or use a fixed gain with clipping protection.
8. **Loop points:**
   - At every tick, fingerprint the whole script state: the sequence's pc, stack, loop counters, value, delay,
     tempo and volume, and each enabled channel's and layer's pc, stack, delay and large-notes flag.
   - The first tick whose fingerprint equals an earlier tick T0 closes the loop. A sequence reaching `FF` at
     depth 0 is a one-shot.
   - For a seamless PCM loop, render **intro + two passes** and report `loopStart = end of pass 1` and
     `loopEnd = loopStart + passLength`. The second pass already carries the release tails from the first.
   - One-shots render to their end plus a 2–4 s tail.
   - Every sequence 1–61 loops or ends within 900 s.
9. **Not modelled:** the 24-voice limit and voice stealing, headset/wide/mono pan modes, and portamento, filters
   and random variance (J music doesn't use them).

| # | Check | Result | Files |
|---|---|---|---|
| 1 | Leak interpreter functions vs J code (relocations masked) | 0 differences in six interpreters; `Nas_SubSeq` differs only in struct offsets | audio analysis, `music/leak/codematch.txt` |
| 2 | AudioTables tile their segments exactly | 62 banks, 62 sequences, 2 sample banks | audio analysis |
| 3 | Static walk of all 62 sequences | 0 unknown opcodes, no address out of range | audio analysis |
| 4 | VADPCM decode vs stored loop states | 590 of 595 exact, 5 within ±1 | audio analysis |
| 5 | `aspMain` vs the leak; HLE detection | byte-identical; `nead_ys` | – |
| 6 | RDRAM: `na_scene` and the loaded sequences at intro, title, Yoshi Select, 1-1 | 22 → seq 11; 36 → seq 12; 1 → seq 1 | `music/cap/r_*.bin` |
| 7 | Audio captures vs renders | seq 11: NCC 0.813, chroma 0.959; seq 1: NCC 0.918, chroma 0.826; stretch 1.000 | `music/cap/run2.raw`, `music/out/` |
| 8 | Lead re-render of seq 12 | byte-identical WAV | `music/out/seq12.wav` |
| 9 | Lead check of seq 1's loop from its script (123 BPM, 7,536-tick backward jump) | 76.37 s = the scanned loop length | – |

1. **Reverb.** The algorithm and parameters (`NA_DELAY_NORMAL` fields, `Nas_Synth_Delay`), the ENVMIXER ramp
   shape and the master output level.
2. **Variable-argument songs.** Which sequences the page, sub-game and game-over fanfares use (probably 31–34).
3. **Story, staff-roll and map demo.** How J reaches scenes 22, 41, 49 and 50 without a direct call (seq 11 for
   the title is verified).
4. **Unreferenced sequences.** Whether seqs 15, 24, 28, 29, 38, 39, 51, 52 and 57 are reachable.
5. **Mood-dependent music.** The J values `Na_YoshiStatusChange` applies per scene (tempo offsets, tune ratios,
   mute masks), and the Yoshi Select mute masks. A viewer could offer happy and sad variants once these are
   extracted.
6. **Sample flag.** Bit 25 of the sample flags (265 music samples).
7. **Voice limit.** The effect of the 24-voice limit on dense songs.

#### Music and sound

| Item | Evidence | Conf. |
|---|---|---|
| **9 sequences with no reference found:** 15 `DOWN` (10.5 s jingle), 24 `NAGOMI` ("soothing", an 18 s loop), 28 `DOWN_PAKKUN` and 29 `DOWN_YOGAN` (death jingles for being eaten and for lava, sharing seq 27's bank), 38 `COURSE_CLEAR` and 39 `COURSE_CLEAR_BOSS` (the events play 49 and 59 instead), 51 `WIN_MID`, 52 `KUPPA_DEMO02` (a 3.3 s two-channel loop), 57 `DOWN02`. Rendered WAVs can be made with `music/render.ts --seq N` | not a world scene id, not a J `Na_Event` constant, not observed in RAM. The static search also misses the title song (seq 11), which is used, and the fanfares 31–34 are started with variable arguments | hypothesis, low–medium |
| The leak's US build adds seqs 62–64 (`FANFARE_NORMAL_OKA`, `FANFARE_BEST_OKA`, …); J has 62 sequences | leak `audio_hs.o`, `audio_hm.o` | verified, high |
| The leak's `SOUND_GWY/audio.music.cart`, `audio.banks.cart` and `audio.table.cart` are an **older sound-effect set** (their first bytes equal J seq 0 and J sample bank 0, then diverge), and `audio.sbmap` maps 12 sequences | byte comparison | verified, high |

- `yoshi_sound.h` ends its scene enum with `NA_SCENE_KESU, NA_SCENE_TEST2, NA_SCENE_TEST3, NA_SCENE_STOP`, and it
  defines 70 test sound-effect IDs, `NA_SE_TEST01..70` (leak-only, high).
- J keeps the sound-event debug names (`NA : Na_Event OPEN_SOGEN_PAGE` … `NYORO_DANGER_OUT`, ROM 0xB1920–0xB1E1C), and
  it has joke debug strings: `さうんど「わけわからん地面の上を歩いています。」` ("sound: walking on some weird ground I don't get")
  (verified).

### 5.3 Instruments and sample encoding

### 5.4 Music catalog and loop points

#### Song list

Songs are chosen three ways:
- **World scene id:** the world's scene id (world +0x100, first u32) is passed to `Na_SceneChange` →
  `Na_GetSeqNum` (a jump table at 0x800B13A4, identical to the leak for scenes 1–63) → `Na_BgmChange(seq, 120)`.
  Boss worlds use scene 65, which is out of range, so they keep playing until the boss event starts the music.
- **Event constants:** `Na_Event` starts event songs with constants in J code.
- **Confirmed in RAM:** the title and intro play seq 11 (scene 22), Yoshi Select seq 12 (scene 36), course 1-1
  seq 1 (scene 1).

**Names.** The game has no sound test. The names below are the leak's `NA_SCENE_*` enum (`SOUND_GWY/yoshi_sound.h`), a
leak-only name source whose mapping is verified. "Use" sources: W = world data, E = event constant in J code,
R = RAM at run time, L = leak-only. Loops come from the renderer's timing scan (`music/out/scan.json`), in seconds.

| Seq | ROM / size | Name | Kind | Loop or end (s) | Use |
|---|---|---|---|---|---|
| 0 | 4F50B0 / 52F0 | sound effects | SFX | – | all SE |
| 1 | 4FA3A0 / 1D80 | MAIN | music | 4.144–80.517 | W: Treasure Hunt, Surprise!!; R: 1-1 |
| 2 | 4FC120 / 1170 | FANTASY / WATER | music | 4.144–59.111 | W: Tower Climb, Lots O' Jelly Fish, Lots O' Fish |
| 3 | 4FD290 / 19C0 | LATIN | music | 6.211–83.556 | W: Rail Lift, Cloud Cruising, Shy Guy Limbo, Shy Guy's Ship |
| 4 | 4FEC50 / 1B20 | EXOTIC | music | 4.628–98.028 | W: Bone Dragon Pit, Blargg's Boiler |
| 5 | 500770 / 15C0 | CELLO | music | 7.722–65.683 | W: The Tall Tower |
| 6 | 501D30 / 1940 | DOJIN | music | 6.567–64.161 | W: Jungle Puddle, Neuron Jungle |
| 7 | 503670 / 2A50 | REGGAE | music | 6.444–98.844 | W: Jungle Hut |
| 8 | 5060C0 / 16D0 | HIPHOP / PAKKUN | music | 5.417–74.161 | W: Jelly Pipe, Torrential Maze, Piranha Grove |
| 9 | 507790 / 2200 | DMG | music | 3.694–59.183 | W: Rail Lift and Shy Guy Limbo sub-areas |
| 10 | 509990 / 15E0 | CASTLE | music | 4.467–73.750 | W: the four castle courses |
| 11 | 50AF70 / 16D0 | MAP01 | music | 7.789–36.978 | R: intro and title |
| 12 | 50C640 / 06C0 | SELECT | music | 0.256–24.189 | W, R: Yoshi Select |
| 13 | 50CD00 / 0C80 | SCORE | music | 5.483–30.767 | W: score tally |
| 14 | 50D980 / 0CD0 | MID_BOSS | music | 8.033–55.222 | E: mid-boss battle |
| 15 | 50E650 / 04A0 | DOWN | jingle | end 10.539 | none found |
| 16 | 50EAF0 / 02A0 | OPEN_SOGEN | music | 0.506–8.483 | E/L: page 1 opens |
| 17 | 50ED90 / 33F0 | SNOW | music | 10.189–73.344 | W: Poochy & Nippy, Frustration |
| 18 | 512180 / 0470 | OPEN_MAGMA | music | 0.006–10.889 | E/L: page 2 opens |
| 19 | 5125F0 / 0570 | OPEN_CASTLE | music | 5.100–15.283 | E/L: page 6 opens |
| 20 | 512B60 / 0B80 | SUBGAME | music | 8.294–22.850 | L: bonus sub-game |
| 21 | 5136E0 / 0310 | OPTION | music | 0.006–12.472 | W: worldShintaku |
| 22 | 5139F0 / 0580 | OPEN_MOUNTAIN | music | 0.006–11.228 | E/L: page 3 opens |
| 23 | 513F70 / 05D0 | OPEN_WATER | music | 8.872–26.600 | E/L: page 5 opens |
| 24 | 514540 / 0450 | NAGOMI | music | 3.994–18.250 | none found |
| 25 | 514990 / 0770 | OPEN_JUNGLE | music | 3.378–16.861 | E/L: page 4 opens |
| 26 | 515100 / 01B0 | DOWN_NORMAL | music | 5.833–12.483 | E: Yoshi down |
| 27 | 5152B0 / 0200 | DOWN_OCHIRU | music | 2.500–9.150 | E: fell, burned, eaten |
| 28 | 5154B0 / 0210 | DOWN_PAKKUN | music | 3.333–9.978 | none found |
| 29 | 5156C0 / 0220 | DOWN_YOGAN | music | 3.883–10.533 | none found |
| 30 | 5158E0 / 0CD0 | MAP_DEMO | jingle | end 35.317 | L: storybook demo |
| 31 | 5165B0 / 0230 | FANFARE_NORMAL | jingle | end 5.189 | L: sub-game end |
| 32 | 5167E0 / 0290 | FANFARE_BEST | jingle | end 5.789 | L: sub-game best |
| 33 | 516A70 / 0270 | PAGE_NORMAL | jingle | end 3.750 | R: loaded at intro; L: page fanfare |
| 34 | 516CE0 / 0380 | PAGE_SOGEN | jingle | end 5.217 | L: first page fanfare |
| 35 | 517060 / 08B0 | SMALL_BOSS | music | 8.733–25.828 | W: rooms in Bone Dragon Pit, Jelly Pipe, Lots O' Jelly Fish |
| 36 | 517910 / 0C00 | MINOBON_ROOM | music | 6.528–18.800 | W: Jungle Hut room |
| 37 | 518510 / 14D0 | KUPPA01 | music | 6.861–55.061 | E: Baby Bowser battle 1 |
| 38 | 5199E0 / 0790 | COURSE_CLEAR | jingle | end 9.678 | none found (the event plays 49) |
| 39 | 51A170 / 0530 | COURSE_CLEAR_BOSS | jingle | end 11.228 | none found (the event plays 59) |
| 40 | 51A6A0 / 2D30 | OHANASHI | jingle | end 218.883 | L: story/ending |
| 41 | 51D3D0 / 0300 | STAFFROLL | jingle | end 96.061 | L: staff roll |
| 42 | 51D6D0 / 0310 | RESCUE_YOSHI | jingle | end 10.300 | W: worldEscape |
| 43 | 51D9E0 / 03A0 | MID_BOSS_DEMO | music | 9.933–13.922 | E: mid-boss intro |
| 44 | 51DD80 / 0930 | KUPPA_DEMO01 | music | 4.089–20.406 | E: Bowser intro |
| 45 | 51E6B0 / 12E0 | TOWER_ROOM | music | 5.094–62.533 | W: Tower Climb rooms |
| 46 | 51F990 / 1000 | TRIAL | music | 0.006–140.922 | W: worldPurikura |
| 47 | 520990 / 0E90 | NAME_ENTRY | music | 4.361–69.633 | W: name entry |
| 48 | 521820 / 04B0 | GURUGURU01 | jingle | end 11.061 | E: 30 fruits collected |
| 49 | 521CD0 / 0420 | GURUGURU02 | jingle | end 5.078 | E: course clear |
| 50 | 5220F0 / 0EA0 | CASTLE_OUTER | music | 0.283–35.739 | W: Ghost and Lift Castle rooms |
| 51 | 522F90 / 0F60 | WIN_MID | jingle | end 16.289 | none found |
| 52 | 523EF0 / 00F0 | KUPPA_DEMO02 | music | 0.561–3.883 | none found |
| 53 | 523FE0 / 1030 | KUPPA02 | music | 5.244–35.161 | E: Baby Bowser battle 2 |
| 54 | 525010 / 07E0 | WIN_KUPPA01 | music | 11.478–28.883 | E: Bowser defeated |
| 55 | 5257F0 / 0740 | WIN_KUPPA02 | jingle | end 13.989 | E: Bowser carried away |
| 56 | 525F30 / 0E40 | SCORE_BOSS | music | 8.928–44.622 | W: boss score tally, name entry |
| 57 | 526D70 / 0180 | DOWN02 | jingle | end 9.078 | none found |
| 58 | 526EF0 / 0330 | GURUGURU_BOSS01 | jingle | end 5.539 | E: 30 fruits (boss) |
| 59 | 527220 / 0250 | GURUGURU_BOSS02 | jingle | end 7.539 | E: boss course clear |
| 60 | 527470 / 0E00 | WIN_MID01 | jingle | end 14.122 | E: mid-boss defeated |
| 61 | 528270 / 01C0 | WIN_MID02 | jingle | end 1.750 | E: mid-boss defeated 2 |

**Bank use:** seq n uses bank n + 3, except seqs 26–29, which share bank 29. The lead re-derived seq 1's loop from
its script: `DD 7B` sets 123 BPM, i.e. 98.67 ticks per second, and the backward `FB 0026` jump after `FD 1D70`
(7,536 ticks) spans 76.37 s. That matches the scan's 80.517 − 4.144 = 76.373 s.

**Music that changes in play** (hypothesis backed by leak code):
- `Na_YoshiStatusChange` (leak `audio.o`) changes tempo offset, tuning and channel mute masks per scene when
  Yoshi's mood changes (normal, happy, sad, super).
- The Yoshi Select screen mutes channels per highlighted Yoshi (`Na_GetSelectBgmMuteMask`).
- A plain render reproduces the normal-mood song. That is what the captures match (see *Verification against the game*).

## 6. Unused and hidden content

### 6.1 Unreferenced assets

#### Leak and hidden content

| # | Check | Result | Files |
|---|---|---|---|
| 1 | Relocation-masked matching of 1,241 leak objects against J | 77% of leak bytes found; 90.7% of ROM data covered | `leak/obj_match.tsv`, `leak/match.json` |
| 2 | Per-world block match | plain `.wdt` worlds 97.9%, `_US` worlds 55.4% | `leak/world_match.json` |
| 3 | `files.txt` sizes vs leak objects | 926 of 927 `.o` equal (the Apr 30 build) | – |
| 4 | Register editor on a pad-1 patched copy | "Debug Registers 0" displayed | `leak/ys_regedit_pad1.z64`, `leak/regpad1_title_zdl.png` |
| 5 | Crash-screen test on a patched copy (checksum recomputed with ROM analysis) | crash reproduced; screen not observed (inconclusive) | `leak/ys_crash_World_to_Unit.z64`, `leak/crash_lastframe.png` |
| 6 | Full ROM string scans | *Messages and strings* | `leak/rom_ascii.txt`, `leak/rom_eucjp.txt` |

This section combines the ROM and the leak. **Evidence** says how each item was established, and **Conf.** gives
the confidence (high, medium or low). "Present in J" means the bytes were found in the Japanese ROM. "Unused"
claims based on the leak rest on the leak's relocations and symbol references, not on a trace of the J game.
Details are in `notes/leak.md`; the byte matches are in `leak/obj_match.tsv` and `leak/world_match.json`.

#### The leak: which build it is, and what it contains

**Verdict** (high confidence): the leak is **not** the Japanese build.
- It is an internal **North American product-ROM build**: `make rompro` with `AMERICA=1`, `SYS_ROMCASSETTE=1`,
  `PRODUCT_ROM=1`, `USE_FAULT=1`, `DEBUG=0`.
- Its objects were compiled on **30 April 1998**, from sources dated 18–31 March 1998.
- The tree already carries French and German messages and a PAL message table (`msgDataTbl_PAL.c`), so it was on
  its way to the European release.
- Whether it equals US retail 1.0 (March 1998) or a later rebuild is open, since there is no US ROM to compare.
- The J ROM (December 1997) is an older sibling build of the same code base.

| Evidence | Detail | Tag |
|---|---|---|
| Region switch | `SRC_GWY/Makefile_h.mk`: `AMERICA=1` active (`JAPAN` and `EUROPE` commented out) | leak-only |
| Build command | `SRC_GWY/test_msg1.log`: makerom line with `-DSYS_ROMCASSETTE=1 -DAMERICA=1 … -DPRODUCT_ROM=1 -DUSE_CIC6104=0 -DUSE_FAULT=1 -DDISABLE_FAULT_DISPLAY=0 -DDEBUG=0` | leak-only |
| Object dates | `SRC_GWY/files.txt` (an `ls -l` of the original tree) dates the `.o` files "Apr 30"; 926 of 927 leak `.o` sizes equal that listing | leak-only |
| World sources | `worldDatabase.o` `.mdebug` includes 147 `.wdt` files, 75 of them `*_US.wdt` | leak-only |
| Library timestamps | `.mdebug` stamps: `LIB/romdebug.o` 1998-03-23, `LIB/y_fault.o` 1998-03-26 (from `srd61:/project/ZELDA/lib/fault`) | leak-only |
| SDK | `v2.0i` (N64 OS 2.0I) and `980305SGI` (patch of 5 March 1998), both later than the J release | leak-only |
| J lacks the US additions | J has no E/F/G message data (0–3% match), no `unit_pcAmerica/French/Germany`, no attract-demo segment, no `world_6_4_6` | verified |
| J matches the non-US world data | plain `.wdt` worlds 97.9% mean match, `_US` worlds 55.4% | verified |
| J version stamp | none: the ROM has no ASCII version or date string (`version.c` exists only in `files.txt`) | verified |

**Byte similarity** (relocation-masked matching of 1,241 leak objects; `leak/obj_match.tsv`):
- **Overall:** 77.0% of the leak's 19.8 MB of section bytes occur in J, and leak runs cover 90.7% of J's data.
- **Near-identical groups:**
  - sound data 94.7% (sequences differ);
  - sprite units 92.2%;
  - Yoshi cells 100% (ROM 0x944370);
  - cast data 98.9%;
  - actor code 87.8%.
- **In J without a leak counterpart:**
  - the J `audio.o` and `actor_yoshi.o` code revisions;
  - most sequence bytes;
  - J-only art (course 1-4 sub-area 2, kana name-entry/message/label units, the book back page);
  - the world records of the 75 US-edited worlds;
  - the debug register editor `bg_debug.o` (*Debug features*).

**Inventory** (`~/bbgames/yoshi`):

| Path | Contents | Use for an implementer |
|---|---|---|
| `YOSHI/SRC_GWY/*.o` (927) | all game code and all data (units, casts, worlds, messages, demo) as MIPS ELF with symbols, relocations and `.mdebug` (procedure and static names, line tables; no type records) | symbol names and data boundaries: `worldDatabase.o`, `worldManager.o` (world ID table), `castData*.o`, `unit_*c.o`, `ucell_yoshi.o` |
| `YOSHI/SRC_GWY/*.c`/`*.h` (81) | only messages (JP/E/F/G), system (`yoshi_systemS_v1/`), region UI (`yoshi_Gameh_and_message/`), `srcpress.c`, `patch.c` | message text, boot and segment logic |
| `YOSHI/SRC_GWY` maps and specs | `yoshi.mmap`, `codesegment.mmap`, `ovlsegment1..6.mmap`, `*Data.mmap`, `yoshi.spec`, `yoshi_spec.h`, 309 `.rel`/314 `.spc` overlay stubs, `ActorList.lst`, `TAGS` (identifier index of the missing sources), `files.txt` | link layout and names |
| `YOSHI/SOUND_GWY` | `audio.o` (Nas driver), `aspMain.o`, `audio_{seq,bank,wave}.o`, heap configs, `yoshi_sound.h`, `sound_flag.dvi`, older `.cart` SFX set | sound names and driver code |
| `YOSHI/PR`, `YOSHI/LIB`, `YOSHI/TOOLS` | SRD libraries (libbg, libu64, libc64), `slidec.o`, `dmamgr.h`; `y_fault.o`, `romdebug.o`; `mapcnv`, `srdpress` | codec and BG library |
| `v2.0i/`, `980305SGI/`, `README.kyoto`, `home/yoshi/ys_make.sh` | SDK and rebuild instructions | – |

**Missing relative to `files.txt`:** 2,507 `.c`, 1,564 `.h`, all 230 `.wdt` world sources, 17 `.doc` files (`world.doc`,
`forUSA.doc`, `actor.doc`, …). Nothing can be recompiled. The leak's own relink attempt failed (`test1.log`).

#### Debug features

| Feature | In J? | How to reach it | Evidence | Conf. |
|---|---|---|---|---|
| **Crash screen** (`LIB/y_fault.o`, the fault manager shared with the Zelda team) | yes: `.data` at ROM 0xAD2B0, strings at 0xB53D0–0xB5CA0, `.text` 93% (an older revision) | After a CPU exception, hold L+R+Z, then press D-Up, C-Down, C-Up, D-Down, D-Left, C-Left, C-Right, D-Right, B, A, START (string `KeyWaitB (ＬＲＺ 上下 上下 左左 右右 ＢＡスタート)`). The register, FPU, thread and stack pages then follow (KeyWaitA: A/B/C/START) | leak build flags `USE_FAULT=1 DISABLE_FAULT_DISPLAY=0`; key-wait state machine disassembled; J `.data` identical | bytes verified, high. A live test was **inconclusive**: a patched copy (`leak/ys_crash_World_to_Unit.z64`, checksum fixed with ROM analysis) crashes at the 1-1 load and keeps polling the controller, consistent with the fault thread waiting. The key sequence was consumed but no screen appeared, probably because the fault screen is drawn by the CPU directly into the frame buffer, which the Glide64 plugin does not show (hypothesis) |
| **Debug register editor** (libbg `bg_debug.o`): register pages named after programmers (KOMATU, NISIWAKI, OTSUKI, TAKAHATA), string `禁断のレジスタ発動!!` ("forbidden register activated!!") | **J only**: `.text` at ROM 0x787B0, `.rodata` at 0xB7450. The leak's April 1998 build doesn't link it | Called every frame by J-only code at 0x80076FD4, gated by the word at 0x800AC6B8 (which is 1 while the game runs). Toggle: hold Z, press D-Left (help text `Z+ﾋﾀﾞﾘﾃﾞｷｴﾙﾖ`, "Z+Left makes it go away") | **verified live**: it reads **controller 2** (pad array 0x80112980 + 0x18), so hold Z + D-Left on pad 1 does nothing. A copy patched to read pad 1 (`leak/ys_regedit_pad1.z64`) opens **"Debug Registers 0"** on the title screen: R(0)–R(14) with VERBOSE, OAM SELECT (ReadOnly), FrameOffSetX/Y, and the help line "Z+ひだりできえるよ" (screenshot `leak/regpad1_title_zdl.png`). Navigation from disassembly (medium): Z + D-Up/Down/Right and START select pages and modes, the D-pad moves and steps, R + stick changes values | high |
| Other libbg debug pages driven by the register system: `NEWRENDER_*`, `LOADGRAPH_*` (load-time graph), `BGTASK_TEST`, `OBJ2S_*`, `DRAWBITMAPTILE_MODE`, `RASTER_COPY/TILE` | strings at ROM 0xB66BC–0xB8630 | through the register editor | strings verified | low |
| `osSyncPrintf` debug output (sound traces `NA :`, EEPROM, DMA, pad and thread logs, actor-spawn messages) | strings in J; no output sink in a retail build | needs an emulator hook on `osSyncPrintf` | strings verified | medium |
| PARTNER debugger support | not built: `fault_partner_debug` = 0 | – | J `.data` | high |
| **Attract-mode demo** (`apd_demoPlay`, the autoplayData segment, `demoPlayData1..6`) | **no**: `SegmentRomStart[5]` = 0 and neither the loader nor the data is in the ROM. It was added for the US release | – | verified | high |
| Other build variants: CM (TV-commercial) ROM with a debug controller and BGM off; map-tool ROM; Gateway 64 kiosk freeze; editor frame advance (`FOR_EDITOR`) | not in J | – | leak `Makefile_h.mk`, `main.c` | leak-only, high |
| CIC-6104 check (`cic6104.o`) | present but disabled (`USE_CIC6104=0`); J boots on 6106 | – | 100% byte match | medium |

#### Unused graphics and actors

| Item | J ROM | Evidence | Conf. |
|---|---|---|---|
| Unit graphics that no cast table or code references: `unit_effkirac` (0x631B30), `unit_eftwinkc` (0x631CC0), `unit_firec` (0x63D480), `unit_kira0c` (0x690870), `unit_pushBlockc` (0x71C200, a push-block object), `unit_ruggetc` (0x722910; the `IAM_RUGGET` actor is `#if UNUSE`), `unit_sernosec` (0x72D8E0), `unit_wrd_2_2_enkeic` (0x7EC780, 26.7 KB of distant-view art for course 2-2) | as listed | 100% present in J; no `ut_*` relocation targets these in any leak object | present verified; unused medium |
| Cast entries that nothing references: `castdt_boss_kumo_chukan` (cloud-boss midpoint), `castdt_chain`, `castdt_teresalens` (Boo lens), `castdt_demoPlay`, `oci_wanwan` | castData | leak relocations | leak-only, medium |
| **Unused test and polygon layers:** casts `bgpltest` (`unit_bgpltestc`, ROM 0x598080), `enmyTestBG` (`unit_enmyTestBGc`, 0x631D30) and `bgpolygon` (the 3D polygon background system: `actor_bgpolygon` overlay, `unit_bgpolygonc`) are in the J cast table, but no world places them or lists them for preload | castData | lead check over all 143 worlds' actor lists and preload lists (`level/worlds_J.json`, `level/castnames_J.json`) | verified (data), medium (code could spawn them) |
| `jumptest` (`unit_jumptestc`, 0x668700, 41.8 KB, a 5120×512 test tile layer) is used only by the unreachable test worlds 36 and 37. `damybg` (collision-only) is used by the test world 39 and by the ending demo world 79 | castData | same check | verified, high |
| **Misleading "test" names that are used in normal play:** `dummyYoshi` and `smokeTest` are in the cast preload list of 127 worlds, and their overlays load when entering 1-1 (`layout/ltrace_lvl3.tsv`). `test_bee5` (the `actor_test_beeMaster` bee swarm) is preloaded by 4-1-5, 5-2-2 and 5-2-4. `octstool` is preloaded by 6-1-2 | castData, overlays | same check + course-load trace | verified, high |
| 22 actor IDs marked `#if UNUSE` in `ActorList.lst` (BOMB, BREATH, DISA, FIREBREATH, FOXFIRE, GRAVIMET, GRAVIMET2, HUMMER, IRONBALL, KAMINARI, KONG16, KONG256, NOISEFIRE, PACKN3, POLEFIRE, POT, POTGHOST, QBLOCK, RUGGET, TELEVI, TEKKYU, TEKKYURING). `actor_rugget.o` is a 32-byte stub; `televi` is an empty overlay in J (ROM 0xBD4700) | leak, J | `ActorList.lst`; J overlay stubs | leak-only, high; the stubs are verified |
| Overlays in the leak but not in the spec: `actor_cpackBackBoard`, `actor_cpackMenu` (Controller Pak menu), `actor_hata` (flag), `actor_sfwall`. Actors that exist only as source files: `actor_viewer`, `actor_mihon` ("sample"), `actor_hiraDbg`, `actor_panoramaDebug*`, `eff_tester` | leak | `files.txt`, `.spc` | leak-only, high |
| Test casts that exist only as source files: `castdt_bg_waterTest`, `castdt_jungle_test`, `castdt_teppomizu_test`, `castdt_viewer` | leak | `files.txt` | leak-only, high |

#### Messages and strings

| Item | J ROM | Evidence | Conf. |
|---|---|---|---|
| `msgNo_test`, a test message (source dated 19 November 1997): `ヨッシーストーリー / じゆうに たんけん / いろんな はっけん / はこにわの せかい` ("Yoshi's Story / explore freely / many discoveries / a miniature-garden world"), a tagline apparently from development | 0xB0F1AC (message table entry 1) | bytes equal to the leak | present verified; unused hypothesis, medium |
| `msgNo00_00_00`: a digit test pattern `99999999 / 88888888 / 77777777` | 0xB0F170 (entry 0) | bytes | present verified; unused medium |
| Developer strings: `__FILE__` names of every manager (0xB45A0–0xB5344); `## ROM上の指定ワールドの情報を読み込んでくる ##` ("read the specified world's info from ROM", 0xB52F0); `コインが登録できなかった` ("coin could not be registered"); `振動パック ぶるぶるぶるぶる` (Rumble Pak "buzz buzz"); `スタックは大丈夫みたいです` ("stack seems fine"); dynamic-link loader messages (0xB8640–0xB8C60) | as listed | ROM scan (`leak/rom_eucjp.txt`) | verified, high |
| No build date, version or programmer string except the register-page names | whole ROM | full ASCII/EUC-JP scan | verified, high |
| Region differences in the leak: US adds the option-screen text (`baseAlgol_USA`), a US staff roll and wider text boxes (`msgDataTbl_NES`); PAL replaces the test message with French `msgNo_test_fra`; the pause screen's kana fruit strings become "Lucky....Fruit" / "Favorite....Fruit" | leak | sources | leak-only, high |

### 6.2 Cut or inaccessible levels

### 6.3 Debug features

### 6.4 Prototype or revision-specific content

## 7. nviewer implementation

### 7.1 Module mapping

#### Proposed viewer list

- **Kind `'adventure'`, grouped by page.** Use the group title "Page N – theme" and a level name "1-1 Treasure Hunt ·
  area 2 (world_1_1_2)". Within a course, order the worlds as: start world, the other `_P_C_n` worlds, the
  course's `Bs_*` rooms, then the ✗ worlds that belong to it.
- **Bosses and Bowser:** under page 3 and page 6 respectively, or under a "Bosses" group.
- **Kind `'other'`:** the practice course (25 `world_0_1`) and the test worlds (11, 36, 37, 39, 66), labelled
  "unused".
- **Hide:** menu and demo worlds without background layers (0–10, 20, 26, 29, 75, 76, 79), or list them under
  "System".
- **Titles:** use the US titles by default, since the viewer's other games are US. The Japanese title can go in
  the level name suffix. The J ROM stores its own titles as custom-encoded text (*Messages and strings*), so a loader should
  hard-code the two title lists above.

#### Coordinates (world pixels → viewer units, 1 px = 1 unit)

- **Main plane:** `X = x`, `Y = −y` (the game's y points down), `Z = 0`.
- **Layer with depth z and anchor a** (*Parallax and scrolling*):
  - `r = K / (floor(z) − 500 + K)`
  - `c = floor16(r · cam0 − a) − r · cam0`, per axis, with cam0 = world +0x28/+0x2C and a = the s16 pair
    16 bytes before the BG attribute.
  - `X0 = 160 − (160 + c_x) / r` and `Y0 = 120 − (120 + c_y) / r`; the main layer has c = 0 and r = 1, so X0 = Y0 = 0.
  - Texel (u, v) of the layer lands at `X = X0 + u / r`, `Y = −(Y0 + v / r)`.
  - `Z = −(floor(z) − 500) − 0.1 · (z − floor(z))`. The integer part carries the parallax; the fractional part keeps
    the game's painter's order (larger z = farther = drawn first) for layers **and** actors, e.g. 2-1's main layer
    at 500.18 in front of Yoshi at 500.3.
- **Derivation.** The game shows layer pixel `P = r · cam + c` at screen (0, 0). A pinhole at
  `(camX + 160, camY + 120)` and distance K maps a point at depth d = K/r to screen `160 + (X − camX − 160) · r`.
  Equating the two for all cameras gives X0 above.
- **Checks (lead simulation):**
  - Placing the plane at floor(z) reproduces the game formula to 4e-12 px for random cameras over all 300
    placements (`lead/layer_anchors.csv`).
  - The 0.1 · frac(z) offset changes on-screen positions by at most 0.017 px.
- **Camera for the side view:**
  - start: eye `(camX + 160, −(camY + 120), K)` looking down −Z, where `camX/camY` = world +0x28/+0x2C
    (the initial frame);
  - for a viewport of height H pixels, the eye distance K keeps 240 world px on screen; the viewer may scale by
    H/240 in presentation only, never by changing the field of view.
- **Objects:** sprite quads use the same depth rule `Z = −(floor(z) − 500) − 0.1 · (z − floor(z))`, with z from the
  cast attribute. Most objects have z = 500.x, on the main plane. Anchor at the base: the quad spans
  `x − w/2 … x + w/2` and `y − h … y`, in y-down px, before the Y flip (*Building the meshes (level loader)* step 7).
- **No X mirroring** (unlike Rush). Front faces wind counter-clockwise as built; culling is off.

#### Additions to `src/rom/types.ts`

```ts
export interface Game {
  id: /* … */ | 'yoshistory';
  // …
}

// A named group of instances the UI can show or hide (layers, objects, collision).
export interface LevelLayer {
  name: string;            // e.g. "far (wrd_1_1_1_enkei)", "main", "objects", "collision"
  kind: 'background' | 'main' | 'foreground' | 'objects' | 'collision' | 'markers';
  instances: number[];     // indices into Level.instances
  depth?: number;          // the game's z (attr+4), for sorting and display
  parallax?: number;       // r, for display
  visibleByDefault?: boolean;
}

// Camera setup for side-scrolling games: a fixed-lens camera looking down −Z at the plane Z = 0.
export interface SideView {
  fovY: number;                      // degrees; the game's lens (40 for Yoshi's Story), must not be re-framed
  distance: number;                  // eye distance from the Z = 0 plane (329.7)
  start: [number, number];           // eye X, Y at level start
  bounds: { min: [number, number]; max: [number, number] }; // pan limits for the eye (main layer extent)
}

// A labelled point for objects without decodable art (or for all objects, as an overlay).
export interface Marker {
  label: string;                     // e.g. "4199 atamaheiho"
  position: [number, number, number];
  layer?: number;                    // index into Level.layers
}

export interface Level {
  // … existing fields …
  layers?: LevelLayer[];
  sideView?: SideView;
  markers?: Marker[];
  pixelArt?: boolean;                // default to nearest filtering
}
```

- Everything else maps onto the existing types: tile layers, sprites and the collision overlay are `Mesh`,
  `Batch` and `Instance`; `textures` hold the atlases.
- `bounds` comes from the placed layer quads.
- `unplaced` is empty.
- `fog`, `skies` and `backdrop` are unused; the far layer is the sky.
- `clearColor` = the layer palette's index 0 colour of the farthest layer, or black.

#### Renderer and UI changes

| Change | Where | Why |
|---|---|---|
| Honour `Level.sideView`: set `camera.fovY` to its value (not re-framed), place the eye at `start` and `distance`, zero yaw and pitch | `ui/Viewport.tsx` (level effect), `render/startView.ts` (skip `computeStartView` when present) | exact parallax (*Recommended presentation: the game's own camera over depth-placed layer planes*). `fromGameCamera` re-frames to the viewer's 60° lens, which would change r (at 60°, a layer 200 px back would scroll at 0.51 instead of 0.62) |
| **Pan controls** for side view: WASD/arrows/drag move the eye in X and Y, clamped to `bounds`; the wheel moves in Z; a key (e.g. V) toggles free fly | `render/controls.ts` (a `PanControls` mode next to `FlyControls`) | side-scroller navigation |
| Layer visibility toggles from `Level.layers` | `ui/Viewport.tsx` panel, `render/renderer.ts` (skip hidden instances) | inspect layers and collision |
| Default nearest filtering when `pixelArt` | `render/renderer.ts` `setLevel` | tiles are 16 × 16 pixel art; linear filtering bleeds across atlas cells |
| Draw order for coplanar cutout layers | none if ε offsets are used (*Coordinates (world pixels → viewer units, 1 px = 1 unit)*); otherwise add `Instance.order` | layers at equal floor(z) |
| Marker labels (optional) | a DOM overlay projecting `Level.markers` with the camera | object IDs and names |
| `LevelKind`: reuse `'adventure'` with `group = "Page N · theme"`; bosses and tests under `'other'` | `ui/Sidebar.tsx` groups already support this | *Proposed viewer list* |

Everything else (log depth, cutout discard, blending, culling off) already works. **No `displaylist.ts` changes are
needed for courses**, since layers and sprites are built directly from data. F3DEX is needed only if 3D pieces are
added later (*How the game builds a frame*).

#### Modules

| File | Contents |
|---|---|
| `src/rom/yoshi/slide.ts` | CMPR/SMSR00 decoder (port of `layout/slide.ts`) |
| `src/rom/yoshi/rom.ts` | detection (`NYSJ` rev 0), segment resolver (`0x03…`, `0x04…`), `dmaRead`, the world, cast and warp tables |
| `src/rom/yoshi/world.ts` | world, scene, actor and EXITIF parsers; level list (*Levels*) |
| `src/rom/yoshi/layer.ts` | BG castdt → tile atlas texture + unit quads; collision overlay |
| `src/rom/yoshi/sprites.ts` | object castdt / unit / ucell decoding → sprite quads (*How the game builds a frame*) |
| `src/rom/yoshi/index.ts` | `openYoshiStory(rom): Game` |
| `src/rom/music/vadpcm.ts` | move `decodeVadpcm`, the loop preparation of `prepareWave`, `RESAMPLE_LUT` and the 4-tap inner loop out of `libultra.ts` so both drivers share them |
| `src/rom/music/nas.ts` | EAD "Nas" driver: AudioTable/map/bank/sample parser, the three script interpreters, tick/tempo model, envelopes and release table, vibrato, squared volume, `StereoLeft` pan, loop fingerprinting, intro + 2 passes (port of `music/render.ts`) |
| `src/rom/yoshi/music.ts` | table addresses (*Data locations (J ROM)*), song list with names (*Song list*) → `Game.music` (seqs 1–61, e.g. "01 MAIN · Treasure Hunt"), `decodeMusic(i)` → `{sampleRate: 32000, channels: [L, R], loopStart, loopEnd}` |
| `src/rom/index.ts` | `case 'NYSJ': return openYoshiStory(rom);` |

#### Difficulty

- **Filesystem and codec: low.** Fully specified and verified bit-exact; about 60 lines of TypeScript exist.
- **Tile layers, parallax and level list: low to medium.** The formats are verified pixel-exact against the game's
  buffers, and a Python renderer exists (render comparison). The renderer work is a camera mode and toggles.
- **Objects: medium.**
  - Unit sprite frames (Shy Guy family) and Yoshi's cells are verified byte-exact against RAM, and they use the
    same record system and codec as layers.
  - Open: which frame each actor shows (slot-4 animation records), and the art of actors drawn by overlay code or
    meshes. These need per-actor work or fall back to markers.
  - The Bowser-room mesh and pipe lifts would need `displaylist.ts`'s F3DEX 1.x path with a segment-3 resolver.
- **Music: medium.** Everything is specified and a working TypeScript prototype exists (`music/render.ts`, matched against captures at loudness NCC 0.8–0.9 and exact tempo). The work is porting it cleanly into the worker and sharing the VADPCM and resampler code. Risks: reverb and master level are approximate, and in-game music changes with Yoshi's mood (tempo, tuning, mutes), which a plain render does not reproduce.

### 7.2 Supported features

### 7.3 Approximations and omissions

## 8. Verification and remaining work

### 8.1 Verification evidence

#### Verification against the game

Captures used the audio-dump plugin (32,006 Hz AI stream) with RDRAM dumps to identify the loaded sequence.
Comparisons are a 50 ms loudness envelope with normalised cross-correlation (NCC) and 12-bin chroma at the best
alignment.

| Song | Window | Loudness NCC | Time stretch | Chroma at 0 semitones (±1) |
|---|---|---|---|---|
| seq 11 title | 40 s | 0.813 | 1.000 | 0.959 (0.39/0.41) |
| seq 1 course 1-1 | 11 s, undisturbed play | 0.918 | 1.000 | 0.826 (≤ 0.47) |
| seq 12 Yoshi Select | 20 s | 0.735 | 1.000 | – (the game mutes channels per cursor) |
| seq 1, second run with constant jumping and damage | first 10 s / later windows | 0.877 / 0.17–0.29 | – | 0.610 over 40 s (mood-dependent tempo and mute changes; *Song list*) |

The lead re-ran `render.ts --seq 12 --passes 2 --tail 3`. It produced a **byte-identical WAV** to the agent's (51.1 s,
loopStart 8,178 and loopEnd 774,044 samples, 0.57 s of render time). The renderer maps instrument value 127 to the
drum kit (stored internally as instrument 0), as *Formats* states.

Runtime verification used mupen64plus with glide64mk2, HLE RSP, debugger
breakpoints, and RDRAM dumps.

#### Rendering

| # | Check | Result | Files |
|---|---|---|---|
| 1 | Breakpoint on `osSpTaskLoad` 0x800870AC; OSTask read; full RDRAM dump | one gfx task per frame, S2DEX task microcode, FIFO buffer 0x80187AC0, alternating list buffers | `render/f_*.task.json`, `f_*.bin` |
| 2 | Display lists decoded with render comparison (S2DEX + F3DEX + RDP, following G_LOAD_UCODE and segments) | frames: title, page 1, 1-1 ×4, 2-1 ×2, 5-1, 6-2; 2–6 microcode switches per gameplay frame | `render/f_*.dl.txt`, `r621a.dl.txt` |
| 3 | `ucode_info[]` in RAM | S2DEX and F3DEX.NoN text/data pointers equal the code-segment microcodes | – |
| 4 | Projection matrix at seg13+0x70 | `translate(0,0,170.33) · guPerspective(40°, 4/3, 40, 5000)` | `render/f_111c.dl.txt` |
| 5 | BG `G_BG_1CYC` imageX/imageY vs camera across frames | `imageX = P.x mod 336`, `imageY = (P.y + floor(P.x/336)) mod 256` with the *Parallax and scrolling* formula, exact to 1/32 px in 1-1, 2-1, 6-2 | `render/f_111a`–`f_111c`, `f_211a`, `f_211b` |
| 6 | Per-frame sampler while Yoshi jumps in 6-2 (camX fixed, camY 784 → 768) | vertical slopes: main 1.000, enkei 0.621–0.623 | `render/s621_jump.tsv` |
| 7 | Breakpoints on `set_bgScreenWPos` 0x8004E13C and `set_bgScrPosProc` 0x8004EBB8 | stored P and the (cam0, z, a) arguments match the formula | – |
| 8 | Ring buffers vs the level decoder's layer PNGs | pixel-exact (main 0 differences) | render comparison, `level/out/043_world_1_1_1/` |
| 9 | Yoshi palettes 0 and 1 in ROM vs the in-game TLUT (green in 1-1, red in 5-1) | 256 of 256 entries equal | `render/out/yoshi_ucell_pal*.png` |
| 10 | Captured Yoshi blobs vs leak cells | cells `playI_hey_075` and `playA_ashibumi_091` match by vertices and part textures; the textures are in ROM from 0x944370 | `render/out/yoshi_ucell_index.txt` |
| 11 | Shy Guy RAM sprite texture vs decompressed ROM `ut` of cast 0x401F | frame 0 byte for byte; palette at ROM 0x567EF8 | `render/out/enemy_401f_extraHeiho_sheet.png` |
| 12 | Sprite placement in `f_111b` (Shy Guy, shadow, apple) | screen = world − camera, sprite centred at anchor − h/2 | `render/f_111b.dl.txt` |
| 13 | Bowser room frame | F3DEX floor mesh plus a 496×384 far-layer ring | `render/f_078a.*` |
| 14 | Layer edges: J disassembly of `makeUtId_bgDraw`, `copynUnit` and `wColwRow_to_bColbRow`, equal to the leak with relocations masked; 1-1 chukan forced to P.x = 5127.5 past its 4608 px width | out-of-range units empty on both axes; ring 315/315 index 0 (wrap model 82/315); screenshot shows no mountain band | `edge/edge.md`, `edge/ring_chukan_over.png`, `edge/shot_over.png` |

#### Reference screenshots of the real game

All of these are 320 × 240 emulator screenshots (glide64). They may be up to about one emulated second older than the
RAM read, so the frame dumps carry the exact state. `cam` = RAM 0x800FC52C/30.

| File | World | Camera (x, y) | How reached | Frame dump |
|---|---|---|---|---|
| `render/shots/00_title_pushstart.png` | title | – | boot; START on the pop-up intro; A × 3 + START | `f_title` |
| `render/shots/01_page1_select.png` | page-1 book | – | title START → main menu A (おはなしモード, Story) | `f_page1` |
| `render/shots/02_yoshi_select.png` | 2 `worldP_select` | – | page 1: A → lucky fruit: A | – |
| `render/shots/10_w111_start_shot.png` | 43 (1-1) | (−1, 272) | Yoshi Select: A | `f_111a`, `f_111a2` |
| `render/shots/11_w111_right1_shot.png` | 43 | ≈(10.7, 272) | hold right 150 polls | `f_111b` (10.748, 272) |
| `render/shots/12_w111_right2_shot.png` | 43 | ≈(359, 272) | hold right ~500 more polls | `f_111c` (359.096, 272) |
| `render/shots/20_w211_start_shot.png` | 46 (2-1) | (−1, 250.996) | level-select patch, world 0x2E | `f_211a` |
| `render/shots/21_w211_right_shot.png` | 46 | (169.047, 272) | hold right 400 polls | `f_211b` |
| `render/shots/30_w621_start_shot.png` | 35 (6-2) | (683.815, 784) | patch, world 0x23 | `render/s621_jump.tsv` |
| `render/shots/31_w621_left_shot.png` | 35 | (490.862, 784) | hold left 150 polls | – |
| `render/shots/40_w511_start_shot.png` | 21 (5-1) | (−1, 0) | patch, world 21 | `f_511b` |
| `render/shots/41_w511_right_shot.png` | 21 | (12.147, 0) | patch again, wait, hold right 70 polls | – |
| `render/shots/50_w078_kuparoom_shot.png` | 78 Bowser room | (−1, 671.999) | patch, world 78 | `f_078a` |
| `render/shots/39_gameover_world8_shot.png` | 8 `worldGameOver` | (0, 0) | Game Over after a warp | – |
| `level/shot_111b.png`, `shot_211a.png`, `shot_621a.png` | 43, 46, 35 | as in *Levels* | level agent (same patch) | `level/r111b.bin`, `r211a.bin`, `r621a.bin` |
| `leak/regpad1_title_zdl.png` | title with the debug register editor | – | pad-1 patched copy, hold Z + D-Left | – |

**Caveats:**
- **Plugin artefacts:** glide64 draws white dots on many shots (fruit-frame border and sprites), and the lower half of
  the Bowser room is black. The display lists themselves are complete.
- **Game Over after warps:** a course reached by warp falls to Game Over after a few seconds, so take shots right after
  the load.
- **Prototype renders to compare against:** `level/out/{id}_{name}/`, with the screenshot-vs-render strips
  `level/cmp_111b.png`, `cmp_211a.png`, `cmp_621a.png`.

#### Rendering

1. **Unidentified 3D actors.** The 5-vertex F3DEX fans in 1-1 and the 70-vertex and 28-vertex meshes in 2-1 and
   6-2: which actors, and which data (sfim? polygon actors?).
2. **Zoom.** How `yoshiZoom_projection` and `bossZoom_projection` zoom (FOV or distance), and how layer frames scale
   (the Bowser room's 480 × 368 frame on a 496 × 384 ring).
3. **Actors with z ≠ 500.** Whether they use the layer parallax r for position and scale (leak `realposXY`); not
   captured.
4. **`uObjMtx` BaseScale.** The last 4 bytes decode as implausible values; the S2DEX 1.x layout is unconfirmed (X
   and Y are verified).
5. **Animation data.** Unit animation records (object castdt slot 4), Yoshi's body-cell timing tables
   (`actor_yoshi`), and `utAdd` tile animation timing (*Levels and data*).
6. **Uncaptured arenas.** `boss_majin`, `damybg` and `pipelift3D`; where the Bowser-room mesh comes from in ROM.
7. **Game Over after a warp.** Why a course reached by the level-select patch ends in Game Over after a few seconds
   (harmless for captures).
8. **CPU-sync display-list splits** (libbg `bgfuncx_sync_draw`) were never observed.

#### ROM layout and leak

1. **Audio segment ends.** They are inferred from contiguity; no RomEnd constants are in the code.
2. **Unlocated objects.** 17 of the leak's 525 unit objects were not located in J; 14 overlay names come only from
   spec order.
3. **Crash screen.** A live confirmation needs a video path that shows CPU frame-buffer writes.
4. **Register editor.** Whether the NEWRENDER or DRAWBITMAPTILE pages visibly change rendering (needs controller 2
   input).
5. **US build.** Whether the leak's April 1998 US build equals US retail 1.0 or a later revision.
6. **Leak-only files.** Contents of `RomEmulate.dat`, `NextList.mem` and `n64_usa.mem`, which are listed in
   `files.txt` but not in the leak.

### 8.2 Known unknowns

### 8.3 References
