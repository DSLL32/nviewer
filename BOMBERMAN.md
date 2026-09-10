# Bomberman on N64: ROM formats for the level viewer

## 0. At a glance

This document specifies how to load the levels and music of three Hudson Soft N64 games into the viewer's data
model (`src/rom/types.ts`). All ROM offsets are into the big-endian `.z64`; "VRAM" is the N64 virtual address.
Every statement is verified unless it is labelled as a hypothesis. Section 8 lists the evidence, and section 9
collects the open questions. Research scripts, dumps, screenshots and renders are under
`/home/n64/.ai-tmp/r49/bm/`.

| | Bomberman 64 (NBME) | Bomberman 64: The Second Attack! (NBVE) | Bomberman Hero (NBDE) |
|---|---|---|---|
| Code | uncompressed; stage/menu code in 95 LZSS overlays | uncompressed; 39 LZSS overlays; function-name table | uncompressed; scene/planet overlays |
| Asset storage | archive at ROM 0x300000, 873 files, indexed | resource block at ROM 0x2A0000, 3,134 files, indexed | chained files addressed by ROM offset |
| Compression | LZSS, 1 KB ring (3.3) | LZSS, 1 KB ring (same) and Yay0 (3.4) | LZSS, 4 KB ring (3.6) |
| Microcode | F3DEX 1.x | F3DEX2 (+ S2DEX for 2D) | F3DEX 1.x |
| Model format | "64" container (5.2.1, 5.4) | NIFF (5.3) | "64" container (5.2) |
| Level unit | overlay per area: map container + attribute file | scene descriptor: map NIFF + placements + environment + camera records | stage index: map container + stage blob + placement block |
| Levels | 24 adventure stages (multi-area), 10 battle stages | 22 battle stages, 8 story worlds + 1 ship (about 155 areas) | 5 planets + hidden Gossick Star: 72 maps (69 + 3 hidden), 192 stage indices |
| Vertex scale / handedness | 1 / right-handed, no mirroring | 1 / right-handed, no mirroring | 1 / right-handed, no mirroring |
| Culling / lighting | back faces culled; lit (vertex colour bytes = normals) | same | same |
| Textures | RDP tile commands (`texture.ts` works unchanged) + LOADTILE | same + LOADTILE + PRIM/ENV combiners | RDP tile commands |
| Fog | per stage, set by the overlay (gSPFogPosition) | per area, environment record | per stage, stage blob header |
| Sky | 2D background bitmap drawn by game code on some stages | 2D backdrop bitmap on 13 battle stages and some areas | 2D stage picture behind every outdoor stage |
| Music | libultra alCSPlayer, S2 table + B1 bank + VADPCM, 47 songs (section 6) | same, 76 songs | same, 32 songs with Sound Test names |

Section 5 describes Hero first because it introduces the "64" container that BM64 shares; the BM64 specifics
follow in 5.4.

## 1. ROM identification (all three games)

Verified by the coordinator (header parsing; CRCs recomputed with the CIC-6102 algorithm, script
`notes/crc.py`).

| | Bomberman 64 (U) | Bomberman 64: The Second Attack! (U) | Bomberman Hero (U) |
|---|---|---|---|
| Header name (0x20) | `BOMBERMAN64U` | `BOMBERMAN64U2` | `BOMBERMAN HERO` |
| Game code (0x3B) | `NBME` | `NBVE` | `NBDE` |
| Version (0x3F) | 0 | 0 | 0 |
| CRC1 / CRC2 | F568D51E / 7E49BA1E | 237E73B4 / D63B6B37 | 4446FDD6 / E3788208 |
| Size | 8 MB | 16 MB | 12 MB |
| MD5 (.z64) | 093058ece14c8cc1a887b2087eb5cfe9 | aec1fdb0f1caad86c9f457989a4ce482 | ef2453bff7ad0c4bfa9ab0bd6324ebf3 |
| CIC | 6102 | 6102 | 6102 |
| Entry point | 0x80000400 | 0x80000400 | 0x80000400 |

- Byte order: all three dumps are `.z64` (big-endian, magic `80 37 12 40`). `normalizeByteOrder()` in
  `src/rom/rom.ts` already handles `.v64`/`.n64`.
- Tell the games apart by the 4-character game code at 0x3B (the viewer's `openRom()` already switches on it).

## 2. Boot and code

All three are Hudson Soft games built on the same in-house kernel design. Boot code is uncompressed and
copied by IPL3. Cross-segment calls go through a "ZeroJump" stub: the caller does `jr` to a
TLB-mapped virtual address and passes `t0 = (table << 8) | function`; the stub looks the target up in
a table of tables. None of this matters for asset extraction except that code addresses in overlays are
position-dependent.

### 2.1 Bomberman 64 (verified: disassembly + RDRAM dump compare)

| ROM | VRAM | Contents |
|---|---|---|
| 0x1000–0x1CBC0 | 0x80000400–0x8001BFC0 | kernel: libultra, scheduler, loaders; BSS 0x8001BFC0–0x80028460 |
| 0x1CBC0–0x1CCF0 | phys 0x42000, virtual 0x00000000 | ZeroJump stub (copied by `romRead`, mapped with osMapTLB) |
| 0x30000 (0x100) | 0x80024820 | segment size table: byte *i* = size of block *i* in 0x800 units (0 = 0x80000); block *i* lives at ROM `i << 17` |
| 0x30800 (0x1000) | 0x8019B0D0 | overlay id table: 2 bytes per id, archive ROM = `b0 << 17 \| b1 << 11` |
| 0x40000–0xC0000 | 0x80225800–0x802A5800 | main game code ("seg2"), uncompressed; BSS 0x802A5300–0x802B36D0 and 0x80063000–0x800BEA60 |
| archives 0x120000–0x2E0000 | 0x80043000 | 95 LZSS-compressed stage/menu overlays, all linked at and loaded to 0x80043000 (window 0x20000) |
| 0x300000–0x7B75A4 | heap | asset archive (873 files) |

- `0x80000698 romRead(dst, len, romOffset)`: every cartridge read goes through osPiStartDma here.
- `0x8022691C loadOverlay(id)`: id → archive via the table at ROM 0x30800 → archive file 0 (overlay
  directory) → file index → `u32 size` + LZSS stream decompressed to 0x80043000 → `jalr 0x80043000`.
- Build string "SAT SEP  6 14:57:59 JST 1997" at ROM 0xBD500.
- RSP microcode: F3DEX 1.x ("RSP Gfx ucode F3DEX.NoN 1.21"); audio: libultra aspMain (ABI1).

### 2.2 Bomberman 64: The Second Attack! (verified: disassembly + RDRAM dump compare)

| ROM | VRAM | Contents |
|---|---|---|
| 0x1000–0x98510 | 0x80000400–0x80097910 | main code + data, uncompressed; BSS 0x80097910–0x800B04F0 |
| 0x98510–0x98640 | phys 0x1D0000, virtual 0x10000000 | ZeroJump stub |
| 0xFF000 (0x1000) | 0x800EF250 | exec (overlay) id table, 2 bytes per id: block ROM = `hi << 17 \| lo << 11` |
| 0x100000–0x270702 | TLB-mapped | 39 LZSS "exec" overlays linked at 0x40000000–0x45000000 or 0x60000000, backed by 8 KB pages from 0x80250000–0x802D0000 |
| 0x280000–0x28F5A0 | (0x803E0000) | function-name table: header `u32 0x10000000, u32 0x803E52C0`, 2,645 `{u32 address, u32 namePtr}` pairs; `namePtr - 0x803E0000 + 0x280000` = ROM offset of the name |
| 0x2A0000–0xFE2E32 | heap | resource block "block 21" (3,134 files) |

- `0x80000698 dmaRead(vaddr, len, romOffset)` wraps osPiStartDma.
- `0x800024C0 fexecLoadAddress(execId, vaddr)`: id → block → directory (file 0) → file = `u32 codeSize,
  u32 bssSize, LZSS stream` decoded into `vaddr`, then called; each exec returns its function table.
  `moduleLoadRP 0x800516BC` maps slots 0–6 at `0x40000000 + (slot << 24)`; `moduleLoad 0x800517A4` uses
  0x60000000.
- RSP microcode: "F3DEX.NoN fifo 2.08" (F3DEX2 family) and "S2DEX fifo 2.08"; audio: libultra aspMain (ABI1).
- The function-name table makes the code very readable; a sorted dump is in
  `/home/n64/.ai-tmp/r49/bm/bm64safs/symbols.txt`.

### 2.3 Bomberman Hero (verified: disassembly, PI load traces, RDRAM dumps equal to ROM)

| ROM | VRAM | Contents |
|---|---|---|
| 0x1000–0x4DFF0 | 0x80000400–0x8004D3F0 | seg1 (IPL3 copy): core, loaders, decompressor, libultra; BSS 0x8004D3F0–0x8005BAD0 |
| 0x4DFF0–0x126CB0 | 0x8005BAD0–0x80134790 | seg2 (game code and data tables), copied by `0x80000BE8 romRead(0x4DFF0, 0x8005BAD0, 0xD8CC0)` |
| 0x126CB0–0x128D20 | slots | two raw data files (see 3.5) |
| 0x128D20–0x147BB0 | 0x80280000 | 7 per-planet code overlays, uncompressed; table of {start, end} at 0x8010CC68 (ROM 0xFF188), indexed by the planet byte at 0x8016523E (`0x800883A8`) |
| 0x147BB0–0x20F5B0 | 0x8032E000–0x8033FFFF | 67 uncompressed scene overlays (common part 0x147BB0–0x14C540 at 0x80320000 plus per-scene parts), loaded by `0x80000C2C`–`0x80001A44` |
| 0x20F5B0–0x2193A0 | 0x8033A000 | pointer-linked data blob (stage index ≥ 128 and intro), paged in 0x4000 bytes at a time by `0x80000F8C` |
| 0x2193A0–0x229650 | 0x80300000 (linked), read to 0x8016E450 | per-stage 0x800-byte data pages, `0x80000FF4(stage)` |
| 0x229650–0x38A1F0 | — | sound effects: "T1" table, .ctl, .tbl |
| 0x38A1F0–0x47A4E0 | — | music blob ("S2", see section 6) |
| 0x47A4E0–0xB588B0 | heap | asset chain A (970 LZSS files) |
| 0xB588B0–0xB61ED0 | — | raw title picture (CI8 320×240) |
| 0xB61ED0–0xB864B0 | heap | asset chain B (9 LZSS files) |

- `0x8000068C romRead(romOffset, dst, len)` (note the argument order differs from BM64/SA) reads in
  0x4000-byte chunks; every cartridge read goes through it.
- RSP microcode: "F3DEX 1.21" (string at ROM 0x4D7E0); audio: libultra aspMain (ABI1).
- The asset heap starts at 0x8024C000; stage "A" blobs are always loaded at exactly 0x802D0000.

## 3. Filesystem and compression

### 3.1 Archive format (Bomberman 64 and The Second Attack share the design)

An archive sits at a ROM offset on a 0x800 boundary:

```
+0x0000  u32 dataOffset      BM64: 0x2008   SA: 0x8008
+0x0004  u32 capacity        BM64: 0x400    SA: 0x1000
+0x0008  capacity × { u32 offset; u32 size }   offset relative to archive + dataOffset
                                              unused slot: offset = size = 0xFFFFFFFF
+dataOffset  file data, contiguous in index order
```

The games read the table in pages of 256 entries (0x800 bytes) and file data through a small cache
(BM64 1 KB, SA 2 KB), which is why individual PI DMAs look like page reads.

In overlay archives, file 0 is a directory, stored raw: `u8 n; n × { u16 overlayId (BE); u8 fileIndex }`.
Some directories declare more entries than they contain (BM64 0x160000: n = 9, 7 present; SA 0x240000:
n = 3, 2 present); the loader stops at the first match, so a parser must bound the loop by file size.

**Bomberman 64 archives** (982 files): overlay archives at 0x120000, 0x140000, 0x160000, 0x180000,
0x1A0000, 0x1C0000, 0x1E0000, 0x200000, 0x240000, 0x260000, 0x280000, 0x2A0000, 0x2C0000, 0x2E0000, and
the **asset archive at 0x300000** (873 files, data ends 0x7B75A4). Assets are loaded by
`0x8026CE28 getAsset(index)`, where the index is the archive slot; indices are hard-coded in main code
and stage overlays.

**The Second Attack archives:** overlay blocks at 0x100000, 0x120000, 0x130000, 0x140000, 0x160000,
0x180000, 0x1E0000, 0x220000, 0x240000, 0x250000, and the **resource block at 0x2A0000** (3,134 files,
0–3133 contiguous). `0x80002F88 gameresAlloc(resno)` loads resource `resno` = slot index.

### 3.2 File payloads

| Game | Payload | Codec selection |
|---|---|---|
| BM64 asset / overlay | `u32 BE decompressedSize` + LZSS stream | always LZSS, except 7 raw assets: 32 (music "S2" blob), 33 (SFX "T2" blob), 71, 72, 220, 221, 267 |
| SA resource | `u32 BE decompressedSize` + payload | if the u32 at +4 is `Yay0` (0x59617930): Yay0 image starting at +4; else LZSS stream from +4 |
| SA exec | `u32 codeSize; u32 bssSize;` LZSS stream | LZSS |

SA exceptions: resources 0 (music blob, "S2") and 1 (SFX blob, "T3") are raw and used by ROM address;
resource 2 is 64 KB of zeros; 46 resources (2527–2540, 2562–2573, 2595–2605, 2621–2629) are
`u32 1000` + 1,000 spaces, stored; resource 3060 has size 0. Counts: Yay0 1,558, LZSS 1,527, stored 46, raw 3.

For BM64 there is no codec flag: the extractor detects raw files as those where LZSS decoding does not
consume exactly the entry (0 or 1 byte of padding allowed). A viewer only needs the indices above.

### 3.3 LZSS, 1,024-byte ring (identical in BM64 and SA)

Decoders: BM64 `0x80292BD0(stream, dst, size)`, SA `decode 0x80002730(handle, dst, size)`.
Okumura-style LZSS with N = 1024, F = 66, threshold 2, **absolute** ring positions:

```
ring = 1024 bytes of 0x00; r = 958 (0x3BE)
flags = 0
while remaining > 0:                          # no end marker; size comes from the container
    flags >>= 1
    if (flags & 0x100) == 0:
        flags = nextByte() | 0xFF00           # 8 flag bits, least significant first
    if flags & 1:                             # literal
        c = nextByte(); emit(c); ring[r] = c; r = (r + 1) & 0x3FF; remaining -= 1
    else:                                     # match: 2 bytes
        b0 = nextByte(); b1 = nextByte()
        pos = b0 | ((b1 & 0xC0) << 2)         # 10-bit absolute ring index
        len = (b1 & 0x3F) + 3                 # 3..66
        for k in 0 .. len-1:
            c = ring[(pos + k) & 0x3FF]; emit(c); ring[r] = c; r = (r + 1) & 0x3FF
        remaining -= len
```

Copies are byte by byte, so overlapping runs work. Neither game clamps a match that runs past the
size; a decoder should clamp. This is not the viewer's `lzss.ts` (4096-byte ring, different match
layout): it needs a new decoder.

Verification: BM64: 125 decompressions (10 overlays, 115 assets) dumped from RDRAM from power-on to the
Adventure-mode intro cutscenes (overlays 0x1A and 0x19), all byte-identical to the Python decoder. SA: resource 3044 and overlay 0x1A
dumped from RDRAM at decoder exit, byte-identical.

### 3.4 Yay0 (SA only)

Standard Nintendo Yay0, decoder `slidstart 0x80073F10`:

```
+0x0 'Yay0'   +0x4 u32 decompressedSize   +0x8 u32 linkTableOffset   +0xC u32 chunkOffset
+0x10 flag words (u32, most significant bit first)
bit 1: copy one byte from the chunk stream
bit 0: u16 L from the link table; n = L >> 12; dist = (L & 0xFFF) + 1
       len = n == 0 ? nextChunkByte() + 18 : n + 2; copy len bytes from (out - dist)
stop when decompressedSize bytes have been written
```

Offsets are relative to the `Yay0` magic (i.e. SA file offset 4). Verified: resource 13 dumped from
RDRAM, byte-identical.

### 3.5 Bomberman Hero: chained LZSS files addressed by ROM offset

Hero has **no index-based file table**. Every asset is named by a `(romStart, romEnd)` pair of ROM offsets,
hard-coded in loader calls or stored in data tables. The viewer should key Hero files by ROM offset.

**Physical layout** (verified: walking the chains hits every boundary that code, tables and load traces use):
- Chain A: 0x47A4E0–0xB588B0, 970 files. Chain B: 0xB61ED0–0xB864B0, 9 files.
- File = `u32 LITTLE-endian n` (compressed byte count) + `n` bytes of LZSS; the next file starts at
  `align16(start + 4 + n)`.
- Raw files outside the chains: 0x126CB0–0x127FF0 (alternate stage "A" blob), 0x127FF0–0x128D20
  (slot 0 template), 0xB588B0–0xB61ED0 (title picture). ROM 0xB864B0–0xC00000 is zero.

**Loaders** (verified: disassembly, traces, RDRAM):
- Heap cursor u32 at 0x801776D4, aligned to 16 before each load; slot table at 0x8016CAA0
  (700 × {u32 ptr, u32}), cleared per scene by 0x800819E0.
- `0x8001E98C loadRaw(slot, start, end)`, `0x8001EA68 loadLzss(slot, start, end)`,
  `0x8001EB68(slot, start, end)` = loadLzss plus bookkeeping. Loaded data is not modified in place.

**Tables that reference files** (974 of 982 files are referenced; the other 8 are listed in section 10):

| Table (VRAM) | Record | Use |
|---|---|---|
| 0x80108238 | 192 pointers → 0x24-byte records `{u32 desc, A start, A end, B start, B end, s32 × 4}` | main-game stages: A = blob loaded at 0x802D0000 (slot 0x1C), B = stage map container (slot 0x1B); index in s32 at 0x8016E428 |
| 0x8010CC68 | 7 × {start, end} | planet code overlays |
| 0x80122B08 | 16-byte `{u32 desc, start, end, 0}` (~550) | object models, loaded on demand by 0x80065CA4 |
| 0x80320534 (common overlay) | 20-byte `{slot, start, end, flags, desc}` | 2D pictures/sprites |
| 0x80100720 / 0x80101A14 / 0x80101F18 | 0x58-byte map records `{A start, end; B start, end; ...}` | alternate modes; 0x80101F18 = the 23 attract-demo maps |
| 0x80104C20, 0x801051E0 | {start, end} lists | menu/story pictures |

### 3.6 LZSS, 4,096-byte ring (Bomberman Hero)

Decoder `0x80014BA0 lzssDecode(src, dst)` returns the decompressed size. Okumura LZSS.C
(N = 4096, F = 18, threshold 2), with a zero-filled window:

```
n = u32 little-endian at src[0..3]         # compressed bytes that follow; no decompressed size stored
ring = 4096 bytes of 0x00; r = 0xFEE
flags = 0
while input remains (checked before every flag byte, literal, b0 and b1):
    flags >>= 1
    if (flags & 0x100) == 0: flags = nextByte() | 0xFF00      # least significant bit first
    if flags & 1:                                             # literal
        c = nextByte(); emit(c); ring[r] = c; r = (r + 1) & 0xFFF
    else:                                                     # match
        b0 = nextByte(); b1 = nextByte()
        pos = b0 | ((b1 & 0xF0) << 4)                         # absolute ring index
        len = (b1 & 0x0F) + 3                                 # 3..18
        for k in 0 .. len-1:
            c = ring[(pos + k) & 0xFFF]; emit(c); ring[r] = c; r = (r + 1) & 0xFFF
```

The game zero-fills only indices 0..0xFED; 0xFEE..0xFFF keep stale bytes from the previous call. A
fully zero-filled window gave identical output for all 46 files checked (hypothesis: the encoder never
references those bytes before writing them).

This differs from the viewer's `lzss.ts`: `lzssRingDecode` (Rush 1) uses a 4096 ring starting at 1 with
the match bytes laid out `((b0 & 0xF0) << 4) | b1` and length `(b0 & 0x0F) + 2`, and it stops at a match
whose position and length nibble are both 0. **Pitfall:** in the Bomberman streams that pair is an
ordinary 3-byte copy from ring index 0, so any end-marker check must be removed; the Bomberman decoders
stop only on the size (BM64/SA) or the input byte count (Hero). A shared, parameterised
ring-LZSS decoder (ring size, start index, match layout, length bias, size source) could serve all
four variants.

Verification: breakpoints on the call to and return from `lzssDecode` inside `loadLzss` during the
attract demo. The source buffer equalled ROM 0x4C9FD0, and the decoder's 0xFE70 bytes were identical to
RAM. In full RDRAM dumps, 5/5 loaded slots (attract demo) and 41/42 (stage 1-1) were identical to the
extractor's output; the mismatch is a picture whose memory had been reused after display.

Reference extractor: `/home/n64/.ai-tmp/r49/bm/herofs/extract.py` → `files/` + `files/index.txt` (files
numbered 0–978 in ROM order for convenience only).

### 3.7 Extracting everything

Reference extractors (Python 3, no dependencies):
- Hero: `/home/n64/.ai-tmp/r49/bm/herofs/extract.py` → `files/` (chain files, overlays, raw blobs), `files/index.txt` with static references per file
- BM64: `/home/n64/.ai-tmp/r49/bm/bm64fs/extract.py` (+ `lz.py`) → `files/a<ARCHIVE>/<idx>.bin`, `files/index.txt`
- SA: `/home/n64/.ai-tmp/r49/bm/bm64safs/extract.py` → `files/res/NNNN.bin`, `files/exec/`, `files/index.txt` (7 s)

## 4. Levels


### 4.1 Bomberman 64

On-screen menus (verified by screenshots, `ref_bm64/shots/`): main menu Adventure / Battle / Custom /
Options; Battle → Single Battle / Team Battle / Options.

**Battle stages**, in stage-select order (verified; screenshots `battle_stage_select_01..06_*`,
`battle_play_01..06_*`). The capitalisation is as shown on screen:

| # | Name | Look |
|---|---|---|
| 1 | Rock Garden | nearly top-down fixed camera, no sky |
| 2 | UP and Down | arena over a rippled water surface |
| 3 | Pyramid | sea with a horizon and gradient sky |
| 4 | Greedy TraP | |
| 5 | Top Rules | |
| 6 | Field of Grass | grass strip between cliffs, blue-white gradient sky |

**Adventure worlds**, World Select order on a new file (verified): Green Garden, Blue Resort, Red
Mountain, White Glacier. Black Fortress (the "Central Base" of the intro) and Rainbow Palace are not
listed on a new file (hypothesis: unlocked later). Four stage slots per world. Stage 1 title cards:
Green Garden "Untouchable Treasure", Blue Resort "Switches and Bridges", Red Mountain "Hot on the Trail",
White Glacier "Blizzard Peaks".

**Stage → files.** Every stage is a code overlay that loads its map container with `li a0,N` → ZeroJump
0x0C00 and its attribute (collision) file → ZeroJump 0x0D00. Table from a static scan of every overlay
(`bm64_model.md` §0/§9):

| Overlay (archive/file) | Map | Attribute | Status |
|---|---|---|---|
| 0x90 (0x2E0000/1) | 513 | 537 | **Rock Garden** (verified: emulator load log, RDRAM, screenshot) |
| 0x91 | 514 | – | UP and Down |
| 0x92 | 518 | 539 | Pyramid |
| 0x93 | 520 | 540 | Greedy TraP |
| 0x94 | 525 | – | Top Rules |
| 0x95 | 529 | 542 | Field of Grass |
| 0x96 | 530 | 543 | In the Gutter (locked on a new save) |
| 0x97 | 534 | 544 | Sea Sick (locked) |
| 0x98 | 535 | 545 | Blizzard Battle (locked) |
| 0x99 | 536 | 546 | Lost at Sea (locked) |
| 0x1A (0x140000/2) | 315 (+826) | 321 (+825) | Adventure intro town cutscene (verified) |

Adventure stages are in the tables further below.

- **Mapping:** the battle stage-select code (overlay 0x23) computes `overlay = cursor + 0x90` (at 0x80046274)
  and draws names from a 10-entry table at **0x80049194**. The names are strings in the game font's encoding
  (byte + 0x27 = ASCII), not sprites.
- **Verified in the emulator** (load logs, RDRAM dumps and screenshots in `bm64_model/`): Rock Garden 0x90, UP and
  Down 0x91, Pyramid 0x92, Greedy TraP 0x93, Top Rules 0x94. Field of Grass (0x95) follows from the code.
- **Locked stages** (static, overlay 0x23):
  - 6 stages are selectable by default, 8 when save flag 2 is set, all 10 when save flag 1 is set; an options
    value at 0x802AC654 also unlocks all.
  - Flag 2 is set when world == 5 and stage == 3 are reached. Flag 1 is set when a counter out of 120 reaches
    120. The in-game meaning (hypothesis) is a Rainbow Palace stage and all 120 Gold Cards.
  - The four locked maps show as brick pillars, a ship deck, ice, and stone towers.

**Scene switching** (verified, disassembly):
- A scene is an overlay. The main loop loads `loadOverlay([0x802AC5D4])` when bit 0 of `[0x802AC5D0]` is set.
- Overlays call `changeScene(id, entryParam, a2)` (seg2 0x8023AE6C, ZeroJump 0x0F00), almost always with constant
  ids, so the scene graph is static. The entry param (17..24) selects the entry point (hypothesis).
- `0x802AC5E8` = world and `0x802AC5EC` = stage, both 0-based (verified in RAM: Green Garden 1 = 0/0, Blizzard
  Peaks = 3/0).

**Adventure: world/stage → start overlay** (verified: overlay 0x21 copies 24 u32 from 0x8004A19C and calls
`changeScene(table[world·4 + stage], 16, 0)`; entries (0,0) and (3,0) confirmed in the emulator):

| World (index) | Stage 1 | Stage 2 | Stage 3 | Stage 4 |
|---|---|---|---|---|
| 0 Green Garden | 0x28 | 0x31 | 0x2D | 0x88 |
| 1 Blue Resort | 0x38 | 0x3E | 0x3C | 0x89 |
| 2 Red Mountain | 0x48 | 0x56 | 0x50 | 0x8A |
| 3 White Glacier | 0x58 | 0x62 | 0x5E | 0x8B |
| 4 Black Fortress | 0x68 | 0x8C | 0x6E | 0x74 |
| 5 Rainbow Palace | 0x78 | 0x8D | 0x7B | 0x7E |

World names 0–3 are verified on the World Select screen (index 3 = White Glacier in the emulator). Worlds 4/5 are named by
elimination (hypothesis): they were locked on the saves used, and world names are textures, not text.

**Stage names** are text in a 1-byte encoding: letters are ASCII − 0x27 (0x1A–0x33 'A'–'Z', 0x3A–0x53 'a'–'z'),
0x0F space, 0xF6 '!', 0xF7 '?', 0xF8 '.', 0xF9 '-', 0 terminator. Digits are a hypothesis (0x10–0x19 per the
stage agent's decoder; ASCII − 0x27 would give 0x09–0x12). No stage name contains a digit. Seg2 **0x802A08F8** holds 24 name pointers
(world·4 + stage), followed by 24 u32 target times (entry 0 = 12000 matches the title card; verified):

| World | Stage 1 | Stage 2 | Stage 3 | Stage 4 |
|---|---|---|---|---|
| Green Garden | Untouchable Treasure | Friend or Foe? | To Have or Have Not | Winged Guardian |
| Blue Resort | Switches and Bridges | VS Artemis | Pump it Up! | Sewer Savage |
| Red Mountain | Hot on the Trail | VS Orion | On the Right Track | Hot Avenger |
| White Glacier | Blizzard Peaks | VS Regulus | Shiny Slippy Icy Floor | Cold Killers |
| Black Fortress | Go for Broke | High-Tech Harvester | Trap Tower | VS Altair |
| Rainbow Palace | Beyond the Clouds... | Spellmaker | Doom Castle | Final Battle! |

Stage 1 names of worlds 0–3 are also verified on title cards. Boss stages (hypothesis, from boss music and
single-area structure) are every Stage 2 and Stage 4 entry: Friend or Foe?, Winged Guardian, VS Artemis, Sewer
Savage, VS Orion, Hot Avenger, VS Regulus, Cold Killers, High-Tech Harvester, VS Altair, Spellmaker, Final Battle!.
Stages 1 and 3 are multi-area action stages. The large overlays 0x88–0x8D are boss arenas built mostly from object
models, with no map file.

**Areas and files per stage.** Areas are separate overlays linked by constant `changeScene` calls or exit records in
overlay data; the start area comes first. Columns:
- **map** = `loadMap` (ZeroJump 0x0C00)
- **parts** = extra `loadMapPart` (0x0C01, at the origin unless a position is given)
- **attr** = attribute file (0x0D00/0x0D0C)
- **bg** = background texture (`setBackground`, 0x1A00)
- **fog** = `setFog` min–max (0x2104)
- **clear** = `setClearColor` (0x2201)

"?" = computed argument, "–" = no call. Static scan; the rows marked verified were checked in RAM.

| Stage | Area | Archive/file | Map | Parts | Attr | Bg | Fog | Clear |
|---|---|---|---|---|---|---|---|---|
| GG1 Untouchable Treasure | 0x28 (verified) | 0x180000/1 | 578 | – | 588 | – | – | 55,77,255 (verified) |
| | 0x29 | /2 | 579 | – | 589 | – | – | 55,77,255 |
| | 0x2A, 0x2B, 0x2C | /3, /4, /5 | 580, 581, 582 | – | 590, 591, 592 | – | – | – |
| GG2 Friend or Foe? | 0x31 | /10 | 587 | – | 597 | 662 | – | 55,77,255 |
| GG3 To Have or Have Not | 0x2D, 0x2E, 0x2F, 0x30 | /6–/9 | 583, 584, 585, 586 | – | 593–596 | – | – | – / – / – / 55,77,255 |
| GG4 Winged Guardian | 0x88 | 0x260000/1 | models | – | 661 | 662 | – | – |
| BR1 Switches and Bridges | 0x38, 0x39, 0x3A, 0x3B, 0x3D | 0x1A0000/1,2,3,4,6 | 314, 315, 316, 317, 319 | – | 320, 321, 322, 323, 325 | – | – | 0,0,0 (0x38) |
| BR2 VS Artemis | 0x3E | /7 | model 369 | – | 368 | – | – | 0,40,70 |
| BR3 Pump it Up! | 0x3C (+ 0x3D, which links to 0x3B) | /5 | 318 | – | 324 | – | – | – |
| BR4 Sewer Savage | 0x89 | 0x260000/2 | models | – | 374 | – | 991–996 | 0,128,255 |
| RM1 Hot on the Trail | 0x48–0x4C | 0x1C0000/1–5 | 389, 391, 393, 395, 397 | – | 400–404 | – | – | 255,161,29 |
| | side rooms 0x4D, 0x4E, 0x4F | /6–/8 | 399 | – | 405–407 | – | 850–930 | – |
| RM2 VS Orion | 0x56 | /15 | 426 | – | 427 | – | – | – |
| RM3 On the Right Track | 0x50, 0x51, 0x52, 0x53, 0x54 | /9–/13 | 409, 411, 413, 416, 418 | – | 421–425 | – | 943/920/915/910/890–990 | 255,161,29 |
| | side room 0x55 | /14 | 399 | – | 408 | – | 850–930 | – |
| RM4 Hot Avenger | 0x8A | 0x280000/1 | 465 | – | 466 | – | – | – |
| WG1 Blizzard Peaks | 0x58 (verified), 0x59, 0x5A, 0x5B | 0x1E0000/1–4 | 547, 548, 550, 551 | – | 567–570 | – | 945–970 (verified), 930–950, 945–970, 860–960 | 230,240,255 (verified) |
| WG2 VS Regulus | 0x62 | 0x240000/6 | 566 | – | 577 | 633 | – | – |
| WG3 Shiny Slippy Icy Floor | 0x5E, 0x5F, 0x60, 0x61, 0x5C | 0x1E0000/7,8,9,10,5 | 554, 557, 560, 563, 554 | – | 573, 574, 575, 576, 573 | ? (0x5C: 633) | – | – |
| WG4 Cold Killers | 0x8B | 0x280000/2 | 638 | – | 635 | – | 971–975 | 0,0,0 |
| BF1 Go for Broke | 0x68 | 0x200000/1 | 468 | 467, 469, 470, 471 | 481 | ? | – | – |
| | 0x69 / 0x6B | /2 / /4 | 472 | 473, 474 / 473, 475 | 482 / 484 | ? | – | – |
| | 0x6A | /3 | 476 | 477, 468, 469, 469 at x 7600 | 483 | ? | – | – |
| | 0x6C / 0x6D | /5 / /6 | 468 / 480 | 478, 479, 469 at x 7600 / – | 485 / 486 | ? | – | – |
| BF2 High-Tech Harvester | 0x8C | 0x2A0000/1 | 700 | – | 701 | – | – | – |
| BF3 Trap Tower | 0x6E, 0x6F, 0x70, 0x71, 0x72, 0x73 | 0x200000/7–12 | 489, 491, 493, 495, 496, 497 | tower part 199 at y 0 and y 12000 (0x71: 199 only); plus 490 / 492 / 494 + 186 / – / – / 498 | 499, 500, 502, 503, 504, 505 | ? | 966–1000 | 0,255,255 |
| BF4 VS Altair | 0x74 | /13 | 506 | – | 507 | ? | – | – |
| RP1 Beyond the Clouds... | 0x78, 0x79 | 0x240000/1, 2 | 729, 730 | – | 735, 736 | 741 | – | – |
| RP2 Spellmaker | 0x8D | 0x2A0000/2 | models | – | 743 | 744 | – | – |
| RP3 Doom Castle | 0x7B, 0x7C | 0x240000/3, 4 | 731, 730 | – | 737, 738 | 741 | 885–955 (0x7B) | – |
| RP4 Final Battle! | 0x7E | /5 | models | – | 739, 740 | 855, 741 | – | – |

Full table with music columns: `bm64_stage/leveltable.md`. Map parts with flags 0x60 (471, 477, 475, 479, 490, 492,
494, 498) take a special code path (hypothesis: animated or transparent part).

**Battle stage files** (static; 0x90 and 0x95 verified in RAM):

| Stage | Overlay (0x2E0000 file) | Map | Parts | Attr | Bg | Clear |
|---|---|---|---|---|---|---|
| Rock Garden | 0x90 (1) | 513 | – | 537 | – | – |
| UP and Down | 0x91 (2) | 514 | – | 538 | – | – |
| Pyramid | 0x92 (3) | 518 | – | 539 | 662 | – |
| Greedy TraP | 0x93 (4) | 520 | 523 | 540 | – | – |
| Top Rules | 0x94 (5) | 525 | – | 541 | – | – |
| Field of Grass | 0x95 (6) | 529 | – | 542 | 662 | – |
| In the Gutter | 0x96 (7) | 530 | – | 543 | 662 | – |
| Sea Sick | 0x97 (8) | 534 | – | 544 | – | 200,200,255 |
| Blizzard Battle | 0x98 (9) | 535 | 218 | 545 | – | 90,140,255 |
| Lost at Sea | 0x99 (10) | 536 | – | 546 | – | – |

**Other scenes:**

| Overlay | Scene |
|---|---|
| 0x20 | title + main menu |
| 0x1F | file select |
| 0x21 | world/stage select |
| 0x22/0x23 | battle menus and stage select |
| 0x24 | Controller Pak screens |
| 0x25 | Custom |
| 0x1B | title attract |
| 0x19, 0x1A, 0x1C, 0x1D, 0x26 | story cutscenes on the town map 826/attr 825 (0x1A = intro, verified) |
| 0x14–0x17 | "debmap" test maps (section 10) |

Seg2 0x802A2A40 holds two lists of 25 (scene, entry param) pairs; hypothesis: the ending/credits scene tour.

### 4.2 Bomberman 64: The Second Attack!

On-screen menus (verified): Story Mode / Battle Mode / Custom Bomberman / Options / Tutorial. Battle type
select has 5 panels (only Survival unlocked on a new save).

A level is a **scene descriptor** resource (2056–2237; format in 5.3.8). Every descriptor is one map NIFF plus
placements. Source: `notes/sa_stage.md`; per-level dependency table `sa_stage/levels.txt` (all 182 descriptors:
map, attribute, environment, camera records, backdrop, event overlays, warps, object ids).

**Battle stages.** `gameProc` 0x80037A00 reads `descriptor = *(0x8008FF44 + battleType·32 + slot·4)`
(battleType at 0x800ABD68, slot at 0x800ABE88). The battle menu overlay exec 0x1C has a parallel table (file
offset 0xAE08) of name indices into text resource **2032** (Shift-JIS text drawn with the game font). All 40
slots agree, and all 22 names are used (static, all data). On-screen order on a new save: Survival slots 0–3
(Normal, Park, Tropical Island, Miniature City), verified by screenshots; the unlock rule for other slots and
battle types is not traced.

| Battle type (res 2032 name) | slot 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| 0 Survival Mode | Normal | Park | Tropical Island | Miniature City | Abandoned Mine | Desert Shrine | Crystal Palace | Rope Bridge |
| 1 KO mode (name stored in Japanese, 破壊王) | same as type 0 | | | | | | | |
| 2 King & Knights | Altar | Park | Ivory Halls | River | Royal Palace | Hanging Gardens | Crystal Palace | Rope Bridge |
| 3 Treasure (宝探し) | Castle Garden | Underground Maze | Ivory Halls | Plains | Royal Palace | Hanging Gardens | Underground River | Floating Halls |
| 4 Score Attack | Ranch | Castle Garden | Cloud Castle | River | Royal Palace | Ranch (Nighttime) | Underground River | Casino |

The 22 distinct battle stages, in descriptor order (from `levels.txt`; fovy from camera file 2055, "–" = no record):

| Descriptor | Name | Map NIFF | Attr | Env | fovy | Backdrop (5.3.9) |
|---|---|---|---|---|---|---|
| 2058 | Normal | 17 | 16 | 2238 | 10 | – |
| 2059 | Park | 19 | 18 | 3120 | 10 | – |
| 2060 | Tropical Island | 21 | 20 | 3121 | 15 | – |
| 2061 | Miniature City | 23 | 22 | 3122 | 10 | – |
| 2062 | Abandoned Mine | 25 | 24 | 3123 | 10 | – |
| 2063 | Desert Shrine | 27 | 26 | 3123 | 30 | – |
| 2064 | Altar | 29 | 28 | 3123 | 15 | – |
| 2065 | Rope Bridge | 31 | 30 | 3123 | 20 | mode 0, res 2354 (verified in RAM) |
| 2066 | Castle Garden | 33 | 32 | 3124 | – | mode 0, 2354 |
| 2068 | Cloud Castle | 37 | 36 | 3126 | – | mode 0, 2354 |
| 2069 | River | 39 | 38 | 3120 | 15 | mode 4, 2354 |
| 2070 | Royal Palace | 41 | 40 | 3127 | 15 | mode 3, 2354 |
| 2071 | Casino | 43 | 42 | 3127 | – | mode 1, 3072 |
| 2072 | Underground Maze | 45 | 44 | 3125 | 30 | mode 3, 2354 |
| 2073 | Underground River | 47 | 46 | 3125 | – | mode 3, 2354 |
| 2074 | Ivory Halls | 49 | 48 | 3128 | 20 | mode 1, 3072 |
| 2075 | Crystal Palace | 51 | 50 | 3123 | 10 | – |
| 2076 | Hanging Gardens | 53 | 52 | 3126 | 20 | mode 0, 2354 |
| 2077 | Plains | 55 | 54 | 3120 | – | mode 4, 2354 |
| 2078 | Floating Halls | 57 | 56 | 3126 | – | mode 0, 2354 |
| 2080 | Ranch | 61 | 60 | 3129 | – | mode 0, 2354 |
| 2081 | Ranch (Nighttime) | 61 | 60 | 3130 | – | – |

Rows 5–6 of 0x8008FF44 hold story-area descriptors with no names (purpose unknown). 2067 and 2079 are
unreferenced empty arenas (section 10).

**Story mode.** World index at 0x800ABD44, current area descriptor at 0x800ABD48, entrance id at 0x800ABD4C. Per
world: area-info file `2036 + world`, camera file `2046 + world`. World names are text resource **2031** entries
0–8; the name index equals the world index by order (hypothesis). Area names do not exist as text. Areas are
listed in file order, which is not necessarily play order; areas are connected by warps (exit placements).

| World | Name (res 2031) | Area descriptors |
|---|---|---|
| 0 | Lost Planet Alcatraz | 2223 2217 2227 2120–2130 2230 2131 |
| 1 | Ocean Planet Aquanet | 2101–2106 2108–2112 2222 2228 2113 2116 2117 2118 2107 2115 2119 (+ 2114) |
| 2 | Sky Planet Horizon | 2132–2148 |
| 3 | Game Planet Starlight | 2218 2156 2149–2155 2157–2162 |
| 4 | Nature Planet Neverland | 2219 2229 2082–2092 2094–2100 (+ 2093) |
| 5 | Amusement Planet Epikyur | 2220 2167–2177 2179 2182 (+ 2163–2166, 2178, 2180, 2181) |
| 6 | Prison Planet Thantos | 2183–2201 2225 |
| 7 | Warship Noah | 2221 2202–2216 2232 2233 2234 |
| – | Merchant Ship Frontier (res 2031 #8, hypothesis) | 2235 |

- **New game (verified in RAM):** the intro cutscene uses descriptor **2057**, map res 13, a 4000 × 4000 textured
  plane. The first playable area is **2223**, the Alcatraz cell (map NIFF 177).
- Areas in parentheses have no area-info record: default scene settings, reachable by warps.
- Areas 2219–2227 also load area overlays exec 0x50–0x58; exec 0x60–0x62 are hypothesised to be boss fights.
- The world-select overlay exec 0x1F holds 17 `{world, startArea}` pairs at file offset 0x55CC.
- On-screen check: a new save shows only "Lost Planet Alcatraz" at World Select; the other map nodes are drawn in
  an unreadable glyph script until unlocked.

### 4.3 Bomberman Hero

Hero has no battle mode. Structure as shown on screen: Planet → Area → Map. Planet names come from the Score
screen (verified): 1 Bomber, 2 Primus, 3 Kanatia, 4 Mazone, 5 Garaden.

**Names.** Area and map names are not text. They are bitmap label sprites: files **#956–#969** (ROM
0xB4EE90–0xB581E0), one per area, each a chain of type-5 CI images. The first is a 128×16 area label, followed by
96×16 map labels in map order. The names below were read from decoded sheets (`hero_level/renders/names/labels_all.png`);
Planet 1 Area 1 also matches the stage-select screenshot.

**Selection → stage index** (verified, disassembly of 0x80069F0C):
`stageIndex = byte[0x80106DA0 + p·42 + a·14 + m·2 + v]`. Here p, a, m are the 0-based planet/area/map (s8 at
0x80134801/02/03), and v = 0 for the entry scene (often an intro/event scene ≥ 128) or 1 for the room itself;
0x7F = no map. The stage index (s32 at 0x8016E428) keys every per-stage table (section 5.2.2).

| Planet | Area | Maps in order (stage index of the room; entry scene in parentheses when different) |
|---|---|---|
| 1 Bomber | 1 Bomber Base | Battle Room 2 (0), Hyper Room 3, Secret Room 6, Heavy Room 4, Sky Room 5 |
| | 2 Sea of Trees | Blue Cave 9, Hole Lake 10, Red Cave 11, Big Cannon 13, Dark Wood 12, Dragon Road 14, Vs. Nitros 15 (131) |
| | 3 Peace Mountains | Clown Valley 16, Great Rock 17, Fog Route 18, Vs. Endol 19 (138) |
| 2 Primus | 1 Woods of Esuram | Groog Hills 21 (166), Bubble Hole 22, Erars Lake 23, Waterway 24, Water Slider 25 |
| | 2 Primus Castle | Rock'n Road 28 (133), Water Pool 27, Millian Road 31, Warp Room 30, Dark Prison 29, Vs. Nitros 87 (134) |
| | 3 Clock Tower | Killer Gate 33, Spiral Tower 34, Snake Route 35, Vs. Baruda 37 (145) |
| 3 Kanatia | 1 Lavana Volcano | Hades Crater 39 (152), Magma Lake 40, Magma Dam 41, Crysta Hole 42, Emerald Tube 8 |
| | 2 Death Pyramid | Death Temple 45 (148), Death Road 48, Death Garden 47, Float Zone 49, Aqua Tank 50, Aqua Way 51 (169), Vs. Nitros 88 (137) |
| | 3 Kanatia Shrine | Hard Coaster 53, Dark Maze 54, Mad Coaster 55, Move Stone 56, Vs. Bolban 57 (149) |
| 4 Mazone | 1 Louie's Jungle | Hopper Land 61 (155), Junfalls 60, Freeze Lake 59, Cool Cave 62 |
| | 2 Slush Mountains | SnowLand 64 (150), Storm Valley 65, Snow Circuit 74, Heaven Sky 67, Eye Snake 66 |
| | 3 Mazone Dome | Vs. Nitros 89 (146), Air Room 69 (68), Zero G Room 70 (105), Mirror Room 71 (106), Vs. Natia 90 (151) |
| 5 Garaden | 1 Garaden Star | Boss Room 1 76 (156), Boss Room 2 77, Boss Room 3 78, Boss Room 4 79 (157), Boss Room 5 80, Boss Room 6 81, Vs. Bagular 82 (159) |
| 6 Gossick (hidden) | 1 Gossick Star | Outer Road 102 (163), Inner Road 103, Vs. ???? 85 (164) |

- Map counts match the Score pages. An earlier count of 7 for Primus Castle was wrong: its labels list 6 maps.
- Kind byte (info +6): 1 = boss with "Vs. Nitros" music, 2 = boss with "Vs. The Big Four"/"Vs. Bagular".
- Indices 128–191 are event/cutscene scenes (kind 4) that reuse story maps, and several are entry scenes.
  Indices 97–100 (kind 3) are special scenes.
- Placeholders (info bytes 0–3 = `00 00 00 01`, silent song, dummy files): 1, 7, 20, 26, 32, 36, 44, 52, 58,
  63, 72, 75, 86, 91, 96, 109, 113–124, 126, 127, 175, 176, 186–191.
- Indices with real data that the selection table never reaches (section 10): 43, 73, 84, 101, 110, 111,
  112. Also 92–95, 104, 107, 108 and 125 (extra rooms, possibly reached by in-stage transitions; not checked).
- Full tables: `hero_level/levels_named.txt` (in-game order), `hero_level/levels.txt` (per index),
  `hero_level/stage_fog_backdrop.txt` (fog and backdrop per index).

## 5. Level format

### 5.1 Common conclusions

- **Vertex scale 1 and no X mirroring** (right-handed, Y up) in Hero and SA. Both were verified by rendering
  at the game's own camera and comparing with emulator frames, and by camera matrices with positive determinant.
  The viewer's `displaylist.ts` hardcodes the Rush values (1/16, negate X); these must become parameters.
  BM64 was verified the same way (5.4.3).
- **Back-face culling is on** in all three games (BM64 and Hero geometry mode 0x22205 set by game code; SA lists
  set G_CULL_BACK themselves).
- **Lighting:** most level geometry is lit. **Vertex colour bytes are signed normals**, not colours. The viewer's
  Batch carries only colours, so a loader must bake lighting in world space (5.4.3 BM64, 5.3.5 SA, 5.2.5 Hero).
- **Textures** are uploaded with the RDP tile commands (SETTIMG / SETTILE / LOADBLOCK / SETTILESIZE), exactly
  as in the Rush games; `texture.ts` reproduces them unchanged.

### 5.2 Bomberman Hero (the "64" container is shared with BM64)

#### 5.2.1 "64" container

```
+0x00 u32 0x36340038 ("64\0" 0x38)
+0x04 u32 nSections
+0x08 u32 0x02020202
+0x0C nSections × { u32 type; u32 param; u32 offset }   offset from the container start
```

Vertex, texel, palette and display-list data sit before the record table; records are in ascending
offset order. The layout is confirmed from BM64 game code (record parser `0x8022D58C` reads
`container + 12 + 12·i`), and the same decoder renders Hero maps correctly. Record types:

| Type | Param | Meaning |
|---|---|---|
| 0 | 1.0f | display list: `G_DL(container + offset)`. Every list starts with a G_VTX of 8 bounding-box vertices and **G_CULLDL (0xBE)** 0..7 |
| 5 | 1.0f | billboard list: game code pushes the inverse of the model × view 3×3 (`G_MTX push-mul`), then the list, then `G_POPMTX`, so it faces the screen (BM64 code, 5.4.3) |
| 6 | 1.0f | "scrolling-texture" list (BM64): game code runs a setup list, then `G_SETTILESIZE` tile 0 from s/t globals 0x802A2D50/54, then the list. The globals are constant 0x80 (never written), so in practice static (5.4.3) |
| 8 | 1.0f | environment-mapped list: `G_SETGEOMETRYMODE(G_TEXTURE_GEN)`, list; the next non-8 record clears it |
| 1 | start node | node tree, 48-byte nodes (below) |
| 4 | 0 | nothing (the offset field holds junk, often ASCII; do not follow it) |
| 2, 3 | count | probably animation data used by object code (hypothesis) |
| 7 | 4 | BM64: always a constant 24-byte tag `00000011 00000013 00000015 00000035 00000033 00000034`. Hero map files: a list followed by **nested "64" containers** (sub-models) |
| 0x12 / 0x15 / 0x19 | `u16 width << 16 \| u16 height` | CI4 / CI8 / RGBA32 image |
| 0x16 | same | RGBA16 image (only in containers built in RAM) |
| 0x1A | colour count | RGBA16 palette, usually right after its image |

Image and palette data are padded to 4/8 bytes; a CI4 row is `ceil(width/2)` bytes. Map containers have no
image records: their textures are only reachable through the display lists.

**Node (48 bytes)**, walked by BM64 `0x8022D414`:

```
+0x00 s32 drawRecord        record index to draw (−1 = none)
+0x04 f32 tx, ty, tz        emitted as a matrix only if non-zero
+0x10 f32 rx, ry, rz        degrees; only if non-zero
+0x1C f32 sx, sy, sz        unused by the static draw path (always 1.0)
+0x28 s32 nextSibling       relative node index (0 = none)
+0x2C s32 firstChild        relative node index (0 = none)
walk(i): if T or R non-zero: G_MTX push·mul; draw drawRecord; if firstChild: walk(i + firstChild); pop;
         if nextSibling: walk(i + nextSibling)
```

In all 3,442 BM64 nodes R = 0 and S = 1, so the static pose is translations only. The list begins with a
root node (draw −1, child 1). Maps have identity nodes.

**Addressing:** everything (vertices, images, palettes, display lists) is segment 2 = container base. The
game sets `G_MOVEWORD seg 2 = file address` before each object. There is no runtime patching. Verified: frame
display list in RDRAM and renders.

**Textures:** plain F3DEX 1.x RDP tile code inside the lists. Palette via SETTIMG + LOADTLUT; texels via
SETTIMG + SETTILE + LOADBLOCK + SETTILESIZE; SETOTHERMODE_H TEXTLUT RGBA16. Formats are mostly CI4.
Pitfall: an early classifier missed `FD100000 02000930` (G_SETTIMG with non-zero low bits in w0) and wrongly
concluded that Hero has no SETTIMG. The type-5 CI files are 2D pictures (menus, HUD, backdrops), not model textures.

#### 5.2.2 Stage records

For stage index `i`:
- **Info record**, 0x38 bytes, `*(0x8010B3FC + 4i)` (ROM 0xFD91C):
  - +0/+1/+2 planet, area, map
  - +6 kind (0 normal, 1 boss with "Vs. Nitros", 2 boss with "Vs. The Big Four/Bagular", 3 special, 4 event, 5 index 110)
  - +7 song
  - +0xC 6 × s16 object activation box
  - +0x18/+0x1C squared activation distances
  - +0x2C f32 **far plane** (20000, 8200, 6300, 5400, 4400, 2400, 2000)
  - the other fields are hypotheses (`hero_level.md` §2.1)
- **File record**, 0x24 bytes, `*(0x80108238 + 4i)`:
  `{u32 desc, u32 A start, A end, u32 B start, B end, s32 sub[4]}`.
  - B = **map container** (slot 0x1B).
  - A = **stage blob**, linked and loaded at 0x802D0000 (slot 0x1C). u32 at +0 points to a header at the
    end of the blob. Header fields a viewer needs (verified from code 0x80066AE8–0x80066E60, 0x8001C7DC,
    0x8006E088, and against stage 1-1 runtime values):
    - +0x2B u8 **fog mode**: 0 none, 2 fog (mode 1 exists in code but no stage uses it)
    - +0x2C u8 **backdrop picture**: 0 none, n ≥ 1 = entry n − 1 of the 30-entry picture table 0x801051E0
    - +0x31/+0x32/+0x33 u8 **fog colour** R, G, B
    - +0x34/+0x36 s16 **fog min / max** (gSPFogPosition arguments)
    - the rest, probably per-cell collision/attribute data (a 4 × 6 grid of 960-unit cells), is a hypothesis
      and not needed for drawing
  - `sub[]` = offsets (−1 = none) of nested sub-containers inside B, drawn at identity in stage 1-1 (hypothesis:
    doors/platforms driven by stage code).

**Drawing a map:** draw every type-0 section of B at identity, plus the lists of the nested sub-containers
(`sub[]`). The game additionally skips map chunks (960-unit sections) behind the camera.

#### 5.2.3 Object placement (verified: all 16 stage 1-1 records match the captured frame)

Placement blob ROM 0x2193A0–0x229650, linked at 0x80300000; pointer table 0x8010BC30 (192 entries, same index).
Block for stage `i` = `ROM 0x2193A0 + (*(0x8010BC30 + 4i) − 0x80300000)`. Records, 16 bytes big-endian:

```
u16 type      index into the 652-entry object class table (0x60-byte records; name at ROM 0x1172F8 + type·0x60, e.g. NAME_SOFTBLK1)
s16 x, y, z   world units
s16 yaw       degrees
s16 p1, p2, p3  per-class parameters (item id, crate contents, ...)
first record: type 0x2D at (30000, 30000, 30000) (sentinel); list ends at type 0xFFFF
```

- Drawn x, z and yaw equal the record exactly.
- **Object class descriptor** (0x60 bytes; record start = ROM 0x1172F8 + type·0x60 − 0x48, name at +0x48).
  Verified on 10 classes against the stage 1-1 load trace:
  - +0x14/+0x18/+0x1C behaviour functions
  - +0x24 → resource record `{u16 slot, u16 flag, u32 romStart, u32 romEnd}` = the model file (LZSS chain file)
  - +0x28 → shape struct
  - +0x34 u32 activation distance² (1920²)
  - +0x38 → `{u16 0, u16 type, u16 slot, u16 flags}`

  So a loader goes type → descriptor → model file directly; no per-stage table is needed.
- **Y offset = shape struct s16[1]** (gates 360, door 120, crates 60, switch 35, plate 60; classes with shape 0
  → 0). Verified for 6 classes; MAPWOOD has 150 but is drawn at +240 (hypothesis: its code snaps it to the
  floor). Some classes are drawn scaled (switch 0.9); the scale source was not found.

#### 5.2.4 Runtime-only render state (verified at stage 1-1 start, RDRAM `hero_level/rdram_s11.bin`)

- **Projection:** fovy 50°, aspect 4:3, near 100, far = info +0x2C (20000 here).
- **Clear:** Z buffer only; no colour clear.
- **Fog** (verified: code, data, and a running frame of Fog Route). It comes from the stage blob header (5.2.2).
  Draw code 0x8001C7DC runs before each map section:
  - fog mode 0 → no fog;
  - fog mode 2 → SETOTHERMODE_L 0xC8113078 (mode 1: 0xC8117038), then `G_SETFOGCOLOR(r, g, b, 255)` and
    G_MOVEWORD index 8 = `gSPFogPosition(min, max)`, i.e. **multiplier = 128000 / (max − min)**,
    **offset = (500 − min) · 256 / (max − min)**.

  For the viewer's `Fog`: `color = (r, g, b)`, multiplier/offset as above, `near = 100`, `far` = info +0x2C.
  39 stage entries use fog, e.g.:

  | Stage | Colour | Range | Far |
  |---|---|---|---|
  | Fog Route (18) | DCE1E6 | 950–1000 | 2000 |
  | Blue Cave (9) | 002050 | 970–1000 | — |
  | Hades Crater (39) | FF0000 | 948–1000 | — |
  | Magma Lake (40) | 6E001E | 995–1000 | 2400 |
  | SnowLand (64) | 0A0050 | 990–1000 | — |
  | Dark Prison (29) | 202020 | 930–980 | 20000 |

  Full table: `hero_level/stage_fog_backdrop.txt`.

  **Runtime check, Fog Route (stage 18; RDRAM `verify/hero/rd_s18.bin`, screenshot
  `verify/shots/hero_s18_fogroute.png`):**
  - The frame contains 7 × `BC000008 0A00F700` (fm 2560, fo −2304, exactly the formula for 950–1000),
    7 × `F8000000 DCE1E6FF` and 7 × SETOTHERMODE_L `B900031D C8113078`.
  - **Only the map sections are fogged**; objects, Bomberman and the HUD draw without fog.
  - The projection far plane is the stage's 2000, and the colour buffer is cleared to the fog colour.
  - A fogged map render at the game camera matches the screenshot better than an unfogged one: mean diff 20.6 vs
    37.6, and 55.5 with far 20000 (`verify/hero/renders/cmp_s18_fog.png`).
  - **Level-select method for testing:** at the Bomber Base stage select, write the stage index into both bytes
    0x80106DA0/0x80106DA1 (Battle Room's entry/room slots), then press A.
- **Backdrop ("sky"):** not a mesh. It is drawn first as two screen-space G_TEXRECT strips (0,0)–(320,120) and
  (0,120)–(320,240), CI4 with TLUT, from the **stage picture** in slot 0x18 (type-5 picture 320×180, 4×
  magnified, window uls 20, ult 103). The picture number is stage blob header +0x2C: 0 = none, n = entry
  n − 1 of the 30-entry {start, end} table 0x801051E0 (files #90–#119), loaded by 0x8006E088. Verified: stage
  1-1 uses n = 12 → ROM 0x668420, matching slot 0x18 in RAM. Whether it scrolls with the camera is a
  hypothesis (the RAM texels differ from the file by about 43%). A viewer can approximate it with a screen-space
  background or a large camera-relative textured cylinder.
- **Lights:** 2 lights + ambient. L1 colour 000000, L2 colour C8C8C8, both direction (10, 42, 120); ambient 323232.
  Display lists override the L2 and ambient colours per material with `G_MOVEWORD index 0x0A` (offsets
  0x20/0x24 = light 2, 0x40/0x44 = ambient; e.g. FFFFFF/7F7F7F, 939300/494900).
- **Camera at start:** eye (0, 516.5, 2413.9), pitch −26°, looking −Z; Bomberman at (0, 38, 1560). A good
  initial viewer camera.

#### 5.2.5 Lighting bake

Hero uses the same lighting mechanism as BM64 (5.4.3): signed-byte normals, G_MOVEMEM lights, and LIGHTCOL overrides
at 0x20/0x24 and 0x40/0x44. Bake with the BM64 formula, in world space, using Hero's defaults: L2 colour C8C8C8,
direction (10, 42, 120); L1 black; ambient 323232; material overrides from LIGHTCOL. The world-space bake was
verified by measurement for BM64 and SA. For Hero it is a hypothesis: the map renders look right, but Bomberman's
material looked wrong in the frame replay. The debug menu's [LIGHT EDIT] page shows the same stage 1-1 values
(ambient 50, direction 10/42/120).

#### 5.2.6 Verification

- `hero_level/renders/cmp_s11_cam.png`: map-only render at the game camera vs the emulator. Walls, path and gate
  line up (the red "B" gate is an object and is absent).
- `hero_level/renders/frame_s11_cmp.png`: replay of all 157 draw calls of the captured frame (segment bases and
  matrices from RAM). The gate, side gates and Bomberman appear in place; remaining differences are the HUD, the
  undrawn backdrop and filtering.

### 5.3 Bomberman 64: The Second Attack! (NIFF)

Source: `notes/sa_niff.md`; annotated disassembly of the model library (0x8000C540–0x80016BE0) in
`sa_niff/nd.dis`; TypeScript decoder `sa_niff/niff.ts` + `dl_bm.ts`.

#### 5.3.1 Header (version 0x05000100; also 0x04020100 with the same layout)

| Off | Type | Meaning |
|---|---|---|
| 0x00 | char[4] | `niff` |
| 0x04 | u32 | version |
| 0x08 | u32 | 0x00020000 in the file; bit 31 is set after relocation |
| 0x0C | u32 | file size |
| 0x10 | ptr | scene record (always 0 in this game) |
| 0x14 | f32 | 10.0 in models, 1.0 in texture sets (unknown) |
| 0x18 | ptr[4] | default bases of segments 5..8 (texel areas) |
| 0x28 | ptr[4] | default bases of segments 9..12 (palette areas) |
| 0x38 / 0x3C / 0x40 / 0x44 / 0x48 | ptr | tables of record pointers: objects, shapes, texture records, animations, class 4 |
| 0x54 | ptr | class 5 table |
| 0x58.. | u16 × 7 | counts of the tables in the same order (0x58 objects, 0x5A shapes, 0x5C textures, 0x5E anims, 0x60 class 4, 0x62/0x64 always 0, 0x66 class 5) |

All pointers are file offsets. `ndResLinkAbs` (0x800133BC) adds the load address to every pointer field.
Texture-record image/palette offsets are relative to the header's segment bases, **not** to the file.

#### 5.3.2 Records

**Object node** (72 bytes):
- +0 u16 kind (1 group, 2 shape node, 3 billboard)
- +4 u32 flags; `(flags >> 8) & 15` = draw layer (section 5.3.4)
- +8 f32 × 3 translation, +20 f32 × 3 rotation (radians), +32 f32 × 3 scale
- +44 s16 shape index (−1 none)
- +52 s16 animation index
- +56 u32 rotation order code (bytes low..high = axes, 1 = X, 2 = Y, 3 = Z; shape nodes use 0x020103)
- +60 u16 child count, +64 ptr to s16 child offsets **relative to this object's index**

The game instantiates object 0 and all descendants. With row vectors,
`World = S · R_hi · R_mid · R_lo · T · ParentWorld`. R_lo is the axis in the lowest byte of the order code, so
0x020103 rotates about Y, then X, then Z; the rotations are standard right-handed ones. Row-major storage of this
row-vector matrix equals the viewer's column-major `Instance.matrix`.

**Shape** (80 bytes):
- +0 ptr display list
- +4 ptr vertices, +8 u16 count, +10 u16 vertex segment (always 4)
- +12 ptr[4] image segment bases, +28 ptr[4] palette segment bases, +44 u16 image segment (5), +46 u16 palette segment (9)
- +62 s16[6] bounding box (used for G_CULLDL)

Vertices are 16 bytes: `s16 x, y, z; u16; s16 s, t; u8 r, g, b, a` (normal in r, g, b when lit).

**Texture record** (24 bytes):
- +0 u16 type (2 = CI with RGBA16 TLUT, 0 = RGBA)
- +2 u8 log size (0 = 4 bpp .. 3 = 32 bpp)
- +4/+6 width/height
- +10 palette count, +12 palette offset, +16 image offset
- +22 image segment, +23 palette segment

Counts: CI4 3046, CI8 293, RGBA32 281, RGBA16 234.

**Segment resolver** for a decoder: display-list start = shape+0 (file offset); for `addr`,
`seg = addr >>> 24, off = addr & 0xFFFFFF` →
- seg 4: shape vertex pointer + off
- seg 5..8: `shape.imgBase[seg − 5]` + off
- seg 9..12: `shape.palBase[seg − 9]` + off

Bases that are 0 in the file (about 500 texture uses in segments 6–8/10–12) are filled at run time from
**texture-set NIFFs** (version 0x00000100, 337 LZSS files, e.g. character colour variants); such lists
cannot be textured from the model alone. Verified: RDRAM relocation of every live NIFF, and the frame display
list's gSPSegment values equal the relocated shape fields (27/27 and 38/45; the other 7 use texture-set
overrides).

#### 5.3.3 Display lists and textures

- Commands used by all 4,750 shape lists:
  - geometry: VTX 01, TRI1 05, TRI2 06, TEXTURE D7, GEOMETRYMODE D9, OTHERMODE_H E3 (TEXTLUT only)
  - textures: LOADTLUT F0, SETTILESIZE F2, LOADBLOCK F3, **LOADTILE F4 (416 uses)**, SETTILE F5, SETTIMG FD
  - colour: SETPRIMCOLOR FA (314), SETENVCOLOR FB (2,157), SETCOMBINE FC
  - SYNC E6–E8, ENDDL DF

  There are no DL calls, matrices, SETOTHERMODE_L or lights.
- Texture upload is the Rush 2049 scheme (LOADBLOCK with dxt, so the odd-row half-word swap applies); `texture.ts`
  reproduces it. Static self-test: 3,940 of 3,941 textures produced by running all lists equal a direct decode of
  their record. The exception is a 48×43 RGBA16 upload larger than the 4 KB texture memory.
- **G_LOADTILE (0xF4)** is missing from `displaylist.ts`. Semantics follow mupen64plus-video-z64 `rdp_load_tile`
  and are implemented in `sa_niff/dl_bm.ts`:

  ```
  on G_SETTIMG: timg = resolve(w1); timgSiz = (w0 >> 19) & 3; timgWidth = (w0 & 0x3FF) + 1
  on G_LOADTILE: tile = tiles[(w1 >> 24) & 7]
      sl = ((w0 >> 12) & 0xFFF) >> 2;  tl = (w0 & 0xFFF) >> 2
      sh = ((w1 >> 12) & 0xFFF) >> 2;  th = (w1 & 0xFFF) >> 2
      bpt = 1 / 2 / 4 bytes for timgSiz 8 / 16 / 32-bit (4-bit images are not loaded this way)
      L = tile.line bytes (doubled for 32-bit)
      for j in 0..th−tl, i in 0..sh−sl, b in 0..bpt−1:
          src = timg + ((tl + j) · timgWidth + sl + i) · bpt + b
          dst = ((tile.tmem + L · j + i · bpt + b) XOR (j odd ? (32-bit ? 8 : 4) : 0)) & 0xFFF
          mem[dst] = rom[src]
      tile.siz = timgSiz; current image = timg; texture cache key includes the rectangle
  ```

  Uses:
  - CI4 8×8/4×4 textures uploaded as CI8 rows;
  - sub-rectangles of 64×32 RGBA32 atlases;
  - 128×128 CI8 windows.
- Wrap: all SETTILE cms/cmt = 0 (repeat). Environment mapping (G_TEXTURE_GEN) in 148 lists.
- **Animated water = per-frame UV scroll of a vertex copy** (verified on Park: two RAM dumps 50 frames apart differ
  by +1000 in t on every vertex of the river shape; texels and palettes unchanged). Mechanism:
  - Shapes with shape+48 ≠ 0 and a UV track (shape+60 count ≠ 0, records at shape+56) are cloned by
    `ndAttachAnimation` (0x80011C14).
  - Each frame the game copies the vertices into the gfx heap and adds per-group offsets. With T = frame count:
    - `ds = (sLin·T)·2 [+ sin((sFreq·T & 0x3FF)·2π/1023)·sAmp·8] & MASK[masks >> 4]`
    - `dt = (tLin·T)·2 [+ sin((tFreq·T & 0x3FF)·2π/1023 + PHASE[phaseIdx])·tAmp·8] & MASK[masks & 15]`
  - Record: 8 bytes `{s8 sLin, s8 tLin, u8 sAmp, u8 tAmp, u8 sFreq, u8 tFreq, u8 phaseIdx, u8 masks}`.
  - MASK (0x8008EC74) = {0, 0x7F, 0xFF, 0x1FF, 0x3FF, 0x7FF, 0xFFF, 0}; PHASE (0x8008EC84) = f32 {0, π/16, π/8, …}.
  - The vertex group is an s16 per vertex from the shape+48 list `{s16 deformIdx, s16 group}`.
  - Battle maps with scrolling shapes (static data; only Park verified in the emulator), per frame in s/t units
    (64 = 1 texel at the usual 0.5 texture scale):
    - Park 19/shape 2 dt 20 (blend);
    - Desert Shrine 27/2 dt 20;
    - Castle Garden 33/2 ds 100;
    - River 39/3 ds 10 (blend);
    - Underground River 47/11 ds 30 (blend);
    - Crystal Palace 51/0 ds 100 (blend);
    - Tropical Island 21/6 has amplitude but frequency 0 (static, as observed in game).

  The file UVs are frame T = 0, a valid static frame. (`ndUVShift` itself is an empty stub.)
- Character/item texture animation uses class-5 tracks in texture-set NIFFs that flip image/palette segments 6/10 per
  key; none target level maps.
- **PRIM/ENV combiners:** 15% of triangles use PRIM or ENV (111,016 triangles over all lists). PRIM and ENV are
  constant per list section, so all but about 410 triangles (two lerp forms) fold exactly into the vertex colour.
  Evaluate the combiner per vertex with TEXEL0 = 1 (both cycles, clamp 0..1; COMBINED feeds cycle 2;
  NOISE/K4/K5/SCALE/CENTER/LOD = 0, ONE = 1) and multiply the texture by the result. Without this, texture-only
  lists (e.g. Park's grass, combiner `(1 − 0)·TEX0`) come out dark orange; with it, Park matches the emulator
  (mean diff 22.5, from 33.6).

#### 5.3.4 Render mode comes from the object's draw layer, not the list

The game's draw-bucket builder (`dpmBuild` 0x80014160) clears the whole geometry mode and sets the render mode
before each priority bucket. The lists never send SETOTHERMODE_L. So the loader must choose blend state from
`(object.flags >> 8) & 15`:

| Layer | Render mode | Viewer `BlendMode` |
|---|---|---|
| 12–15 (flags 0xD00, most geometry), 10–11 | G_RM_AA_ZB_OPA_SURF | opaque |
| 8–9 (0x900) | G_RM_AA_ZB_OPA_DECAL | opaque, no depth write |
| 6–7 (0x700) | G_RM_AA_ZB_TEX_EDGE | cutout |
| 1 (0x100) | G_RM_ZB_XLU_DECAL | blend |
| 0, 2–5 (0x500) | G_RM_AA_ZB_XLU_SURF | blend |

(Tables: layer → priority 0x8008ECD0, priority → material 0x8008EE58, 32-byte materials 0x8008ECF8; fog variants
exist.) Since the geometry mode is cleared, 4,646 of 4,750 lists begin with `D9FFFFFF 00000401` (G_ZBUFFER |
G_CULL_BACK) and then `00220004` (shade, lighting, smooth; 3,678 lists) or `00200004` (unlit, 929).
For `displaylist.ts` this means an initial geometry mode of 0 and a caller-supplied render mode.

#### 5.3.5 Lighting

Lights are not in the NIFF: `ndSetupLightset` (0x8000E2F0) emits them per object from the scene's 7 light slots
(point lights become directional toward the object). In Survival "Normal" each object gets 1 light, diffuse
FEFEFE, and ambient 0x93. The light direction depends on the object's position, because the light is a point
light: for example (16, 123, 22) for one object and (33, 117, 33) for the map at the origin.

**Lighting bake** (verified: bytes reproduced exactly, brightness compared with emulator frames). Per object,
`ndSetupLightset` 0x8000E2F0 / `ndEvalLight` 0x8000DFD4 take each enabled slot (u16 flags & 0x8000) of the level's
**environment record** (5.3.8; 7 × 56-byte slots at +0x9C, ambient RGB at +0x224):
- point light (flags bit 0): `L = normalize(slot.pos(+28) − objectOrigin)`, objectOrigin = the translation of the
  object's world matrix. Distance fade (bit 1): 0 outside [near(+40), far(+44)], else `1 − (d − near)/(far − near)`.
  Spot (bit 2): intensity from dir(+16), cutoff(+48), exponent(+52).
- directional (bit 0 clear): `L = −slot.dir(+16)`.
- light bytes = `trunc(L · 127)`; colour = `slot.colour(+12) · trunc(intensity · 255) >> 8` (so FF becomes FE).

The game sends 1 light + ambient per object. The RSP shades lit vertices as
`clamp(ambient + Σ max(0, N · L) · colour)`, alpha = vertex alpha. The modelview is the object's world matrix, so
**light directions are in world space**. Normals of rotated objects must be rotated by the object's world 3×3.
The combiner is applied after that (5.3.3).

Checks:
- Normal map (env 2238, slot-0 point light at (2000, 7000, 2000), colour FFFFFF, origin 0) gives light FEFEFE,
  direction (33, 117, 33), ambient 939393. This equals the frame's bytes; the direction differs per object
  because it is a point light.
- Area 2223 (env 2239) gives 9A9F5E, (24, 118, 39), ambient 6E7857, exactly the frame's bytes.
- Brightness (median emulator/render ratio per channel):
  - Normal 0.96/0.95/0.93 (unlit full-bright control 0.78/0.75/0.69);
  - Park 1.00/0.97/1.00;
  - Tropical Island 0.91/0.94/1.00.

Code: `sa_niff/niff.ts` (`parseEnv`, `envLights`, `makeLight`).

#### 5.3.6 Units and placement

Vertex units are world units. A battle map is entered with `obj2APIEntry(res, 29, 0)` with identity transform.
The Normal map spans x 0..1300, z 0..1100, floor y 0..100, and its descriptor's placements use the same space
(player starts at (0|1200, 0, 0|1000), soft blocks on a 100-unit grid, randomised per round).

#### 5.3.7 Verification

- `sa_niff/renders/battle2058_res17_gamecam_vs_emu.png`: Normal map rendered at the game camera (fovy 10, target
  (650, 0, 500), eye (650, 4979, 4678)), scale 1, not mirrored, culling on, versus the emulator frame. The crate
  grid, floor grates and back wall coincide; differences are the players, the random soft blocks and lighting.
  The arena is nearly symmetric, so handedness rests on the camera matrix (positive determinant, +X = screen right).
- Texture sheets: `sa_niff/renders/sheet_stages_17_19_21_23.png` (the four battle maps), `sheet_ram_normal.png`.

#### 5.3.8 Levels: scene descriptor and companion resources (static from code, checked against all data files)

**Scene descriptor** (resources 2056–2237 except the camera files 2054/2055). Loaded by `gamesceneSetupBattle`
0x8002D5C4 / `gamesceneSetup` 0x8002E0C4. Size = 16 + 32·nKinds + 76·nObjects for all 182 files.

```
+0x00 u32 mapModelRes   map NIFF → obj2APIEntry(res, 29, 0): identity transform (verified in RAM)
+0x04 u32 attrRes       collision/attribute file (−1 = none)
+0x08 u32 nKinds        32-byte kind records at +0x10
+0x0C u32 nObjects      76-byte placement records after the kinds
```

Kind record (32 bytes):

| Off | Type | Meaning |
|---|---|---|
| +0x00 | u32 | class: 0 event trigger, 1 map object (moving/animated, behaviour in "RP" overlays), 3 player start / exit, 4 destructible block or prop with a box |
| +0x04 | u32 | flags; bit 0 on class 4 = member of the random soft-block pool |
| +0x08 / +0x0C / +0x10 | f32 | box size X, Y, Z (object position = placement position + half size) |
| +0x14 | u32 | class 0: event id (overlay `0x8008F5F0[id / 100]` = exec 0x22–0x2B, sub-event `id % 100`); class 3: player index (battle) or entrance id (story); class 1/4: object id |
| +0x18 | u32 | class 3: entrance id in the destination area |
| +0x1C | u32 | class 3: destination area descriptor (story) |

Placement record (76 bytes):

| Off | Type | Meaning |
|---|---|---|
| +0x00 | u32 | kind index |
| +0x04 / +0x08 / +0x0C | f32 | position X, Y, Z (world units) |
| +0x10 | u32 | sub-type |
| +0x18 | u32 | low 16 bits: spawn condition mode (1 = only for entrance +0x1C, 2 = game-flag test); bits 16–18: **Y rotation code** 0→0°, 1→90°, 2→180°, 3→225°, 4→270°, 5→315°, 6→135°, 7→45° |
| +0x1C | u32 | condition value / flag number (bit 31 = negated) |
| +0x20 | u32 | initial state (−1 none) |
| +0x24 | u32 | flags |
| +0x38..+0x48 | u32 × 5 | linked placement indices (−1 none) |

Which NIFF each class 1/4 object id draws is decided by the resource-program overlays. Only a few ids are
resolved; for example soft block id 25 → NIFF 586 (5.3.10). A viewer can show the map NIFF plus placement markers
(or the known models). Soft blocks are chosen at random per round (area-info count), so the data holds every
candidate position.

**Area-info file** (res 2036 + world; 2045 in battle): records `{u32 areaRes, u32 envRes (−1 none), u32
softBlockCount, u32 nSP, nSP × {u32, u32}, u32 nItemSets, nItemSets × {u32 a, b, c, u32 n, n × {u32 id, u32 weight}}}`,
terminated by areaRes 0. The matching record's environment becomes the current scene. Then
`obj2SetFog(env+0x230 & 1, u16 env+0x60, 1000, u32 env+0x64)` and `rspSetClearColor(env[0x58..0x5A])` run.

**Environment record** (res 2238–2298, 3120–3132, 0x234 bytes) = a raw copy of the renderer's scene buffer
(verified: RAM equals the file except runtime light bytes). Defaults when absent: fovy 30, near 200, far 8000,
ambient 127, light colour 255.

| Off | Type | Meaning |
|---|---|---|
| +0x00..+0x06 | s16 × 4 | viewport y0, y1, x0, x1 |
| +0x58 | u32 | clear colour RGBA |
| +0x60 / +0x62 | u16 | fog values (the second is set to 1000 when fog is enabled) |
| +0x64 | u32 | fog colour RGBA |
| +0x6C / +0x70 | f32 | fovy / aspect (not used for the level projection) |
| +0x7C / +0x7E | s16 | near / far field (the level projection uses far 8000, not this) |
| +0x9C.. | 56-byte light slots | u16 flags (0x8000 directional, 0x8001 point), colour at +0x0C, vectors at +0x10/+0x1C |
| +0x224 | u8 × 3 | ambient colour |
| +0x22E | u16 | light count |
| +0x230 | u32 | bit 0 = fog enable |

**Camera records** (res 2046–2053 story, 2055 battle): `u32 count; count × 52 bytes`. Each record is
`{u32 area, s32 entrance (−1 any), f32 yaw°, f32 pitch°, f32 distance, f32 lookAt X/Y/Z, f32 second point X/Y/Z,
f32 fovy°, u32 mode (2 fixed, 0 follow)}`. Verified: the Normal projection × view decomposes exactly to its
record (yaw 0, pitch 50°, distance 6500, look-at (650, 0, 500), eye (650, 4979, 4678), fovy 10). This is a
ready-made initial viewer camera for battle stages.

**Collision file** (descriptor +0x04): bounds plus a grid of 52-byte polygons; used for hit tests and to clamp
the follow camera; not drawn.

**Bitmap resources** (380 files): `u32 total; u32 pixOff (0x20); u32 palOff; u32 bpp (4|8); u32 width; u32
height; u32 nColors; u32 0`; pixels at pixOff, RGBA16 palette at palOff.

#### 5.3.9 Backdrop (drawn by game code)

`bgfunc` 0x8002F67C draws a 2D backdrop before the 3D pass: a 160×112 bitmap (res **2354**, CI8 250 colours;
res **3072**, CI4 14 colours, for Casino and Ivory Halls), stretched 2× into a 320×224 image at y = 7..231 in
14 G_TEXRECT strips (dsdx = dtdy = 0.5). Modes 0/1 draw the texture only; modes 2/3/4 multiply by prim colour
FFFF00 / 646464 / 00FF00. It is used by the battle stages listed in 4.2 and in story world 2 (Horizon) and areas
2138, 2225, 2165, 2178, 2180, 2164, 2181, 2224 (mode 2 for 2225). Verified on Rope Bridge: the RAM image equals
res 2354 and the frame list starts with this list. Viewer mapping: a screen-space background (or a large
camera-relative quad) textured with the bitmap and tinted by the mode colour.

#### 5.3.10 Runtime render state (verified in RAM: Normal 2058, first area 2223, Rope Bridge 2065)

- Projection: guPerspective with **fovy from the camera record** (default 30), aspect 4:3, **near 200, far 8000**.
  Viewport scale (152, 114) centred at (160, 120); perspNorm 15.
- Clear colour from the environment record (Normal 0x414141, 2223 and Rope Bridge black).
- **No fog** in all three captures: SETFOGCOLOR 0 and no fog MOVEWORD (verified negative case).
- **Fog formula** (code `obj2SetFog` 0x8001B20C and `ndBuildSceneGfx` 0x8000D844; verified in a running frame, see
  below).
  If environment +0x230 bit 0 is set: `min = u16 env+0x60`, `max = 1000`, colour = env+0x64. Once per frame the
  game emits `G_MOVEWORD fog (DB080000 (fm << 16) | (fo & 0xFFFF))` with `fm = 128000 / (max − min)` and
  `fo = ((500 − min) · 256) / (max − min)` (C integer division, truncation toward zero), then
  `G_SETFOGCOLOR(env+0x64)`. This is libultra `gSPFogPosition(min, 1000)`. `dpmSetFog` only switches the
  32 render-mode sets to their fog variants.
  - For the viewer's `Fog`: `color` = env+0x64 RGB, `multiplier = fm`, `offset = fo`, `near = 200`, `far = 8000`.
  - Example: env 2244 (area 2101) gives fm 3282, fo −3026, colour 000F2E.
  - 22 environment records have fog, all used by story areas; no battle stage has fog. Each entry is
    env (min, colour) → areas:

    | Env | min | Colour | Areas |
    |---|---|---|---|
    | 2241 | 800 | 0D0D00 | 2126 |
    | 2244 | 961 | 000F2E | 2101 |
    | 2247 | 970 | 000F32 | 2107, 2115 |
    | 2249 | 899 | 9D92CE | 2132–2136, 2138, 2140 |
    | 2255 | 940 | A00A6E | 2149–2152, 2154, 2161 |
    | 2256 | 870 | 1E1E00 | 2155, 2157 |
    | 2261 | 895 | 6E0000 | 2083, 2085–2087, 2089–2091 |
    | 2264 | 891 | 1E1E4C | 2220, 2168–2172 |
    | 2265 | 911 | 5A7A7E | 2167 |
    | 2266 | 860 | 000000 | 2176, 2177 |
    | 2269 | 870 | 000000 | 2144, 2146, 2147, 2183, 2184, 2195, 2197 |
    | 2270 | 920 | 000000 | 2145, 2187, 2188, 2191, 2193 |
    | 2285 | 990 | 1E1E4C | 2153 |
    | 2290 | 891 | 1E1E4C | 2179 |
    | 2291 | 920 | 000000 | 2186 |
    | 2292 | 870 | 000000 | 2194 |

    2246, 2294 and 2295–2298 are not used by any area.
  - **Runtime check, area 2101** (RDRAM `verify/sa/rd_2101.bin`, screenshot `verify/shots/sa_2101_aquanet.png`):
    - Both frame buffers contain `DB080000 0CD2F42E` (fm 3282, fo −3026, confirming truncation toward zero) and
      `F8000000 000F2EFF`.
    - The projection is fovy 30, near 200, far 8000, so the fog spans view depth ≈ 3173–8000 and looks faint.
    - With fog on, 22 of the 32 draw-layer render-mode sets switch to fog variants and set G_FOG:
      00552078 → FA004230, 00553078 → FA005230, 00552D58 → FA006D10.
    - **Unlike Hero, objects are fogged too:** 80 draws use fog modes and 8 use unchanged modes.
    - Warp method used: breakpoint on `gamesceneSetup`, start a new Story game, then write area 0x835 to
      0x800ABD48, world 1 to 0x800ABD44, and flags 0x800 to 0x800ABD40.
- Frame list: FILLRECT clear, geometry mode ZBUFFER | SHADE | CULL_BACK | LIGHTING, render mode 0x00553078, one
  projection × view G_MTX, then per object: draw-layer render state, model matrix (G_MTX LOAD), 1 light colour
  and direction + ambient (G_MOVEWORD), segment bases, shape DL. Then the S2DEX HUD.
- Lights: Normal diffuse FEFEFE direction (16, 123, 22), ambient 939393. Area 2223: diffuse 9A9F5E direction (24, 118,
  39), ambient 6E7857.
- Placement conventions: a battle grid cell is 100 units (Normal is 13 × 11 cells, cell centres at 50 + 100i);
  Y is up with the floor at 0. Map NIFF objects are drawn with identity model matrices, and placements are translated
  to their record position and rotated about Y by the rotation code.
- **Default camera** (static, `gameprocSetDefaultCamera` 0x8002B934). With a camera record: angles from the record
  (degrees), fixed look-at (mode 2) or follow the player at +50 Y, clamp bounds from the record's points, and
  `viewSetPerspective(record fovy, 4/3, 200, 8000)`. Without a record: angle vector {42°, 0, 1600}, follow the player
  (+50 Y), and the projection stays at the boot value (fovy 30, 200/8000). Which component is pitch is a
  hypothesis: area 2223 has no record and showed pitch 33.2°, yaw ≈ 0, distance ≈ 900 in RAM. A viewer start view
  for record-less levels: look at the first player start + (0, 50, 0), pitch 33–42° down, distance 1600, fovy 30.
- **Object models** (verified in RAM by walking the resource cache lists 0x800A015C/60/64 and matching segment-4
  bases, `sa_stage/objmap.py`): battle soft block id 25 draws **NIFF 586** at placement + (50, 0, 50), scale 1.
  On Rope Bridge, ids 241/213 draw NIFFs 676 and 930 (which is which not separated). Other ids are open; a
  static lead is a possible id → resource table in exec 0x27 (file 0x3F66).

### 5.4 Bomberman 64

Source: `notes/bm64_model.md`; decoder `bm64_model/decode.ts` + `displaylist_bm64.ts`; frame walker `frame.ts`.

#### 5.4.1 Container and binding

- Same "64" container as Hero (5.2.1). The game loads containers byte-for-byte and binds them at draw time
  with `G_MOVEWORD(G_MW_SEGMENT)`: **segment 2 = container base**. Verified: every container copy found in
  RDRAM is identical to its extracted file, and the frame lists set segment 2 to its address.
- **Maps** use only segment 2 (textures inside the file).
- **Characters and props** take textures from a separate **texture-bank container** (image + palette records)
  bound to **segments 3..14** (code `0x80228CE8`). `obj + 76 → { s32 n; ptr refs; ptr anim }`; for `i < n`,
  segment `3 + i` = `refs[i].container + record[refs[i].record].offset` (refs are `{container ptr, record index}`).
  If `anim` is set, each segment steps through frames `{record index, duration}`: this is texture animation by
  segment swapping. Example: Bomberman = container 73 with bank 74 (player 1), 75–77 (players 2–4).
- Per object the frame contains: `G_CLEARGEOMETRYMODE(G_FOG)`, alpha compare none, modelview load + push (object
  matrix), `G_MOVEWORD seg 2`, bank segments, the container's record or node tree, `G_POPMTX`.

#### 5.4.2 Textures

Standard libultra `gDPLoadTextureBlock` / `gDPLoadTextureTile` sequences (LOADBLOCK 3,885 uses, **LOADTILE 184**
in 42 files, LOADTLUT 3,976). Mostly CI4, CI8 in character skins and some map parts, RGBA32 in 26 lists, TLUT
always RGBA16. Wrap from SETTILE: cm 0 repeat, 1 mirror, 2 clamp; 45 lists use a non-zero SETTILESIZE corner.
No BRANCH_Z LODs. `texture.ts` decodes everything correctly unchanged.

#### 5.4.3 Render state (from game code; the asset lists never set it)

- **Geometry mode 0x22205** (ZBUFFER | SHADE | SMOOTH | CULL_BACK | LIGHTING) from the master list and main-code
  setup list 0x8029F6D8. Asset lists never contain B6/B7. **Back-face culling on, fog off.**
- **Render mode 0x00553078** (Z_CMP | Z_UPD | CVG_X_ALPHA | ALPHA_CVG_SEL): **cutout** by texel alpha. A
  decoder must default to it, or fences and leaves come out opaque. 169 lists toggle alpha compare
  (`B9000002`). Translucent objects (shadows, effects) get `0x055079D8` plus `G_SETFOGCOLOR xxxxxxAA` from game
  code: the blender uses the fog alpha as the blend factor (not modelled by `Batch`).
- **Lighting:** vertex bytes 12..14 are a signed normal. Master list: `NUMLIGHT 2`; L0 colour 0x323232 and L1
  colour 0xC8C8C8, both direction (0, 0x72, 0x37); ambient 0x505050. **Every model list begins with
  `G_MOVEWORD LIGHTCOL`** at 0x20/0x24 (light 2 = L1) and 0x40/0x44 (ambient), e.g. FFFFFF/FFFFFF or
  999999/4C4C4C; L0 keeps its master colour. Colour = ambient + Σ max(0, n·l)·colour, clamped; combiner
  usually `FC127E24 FFFFF3F9` (texel × shade).
- **Lighting bake for the viewer** (verified by render brightness, `bm64_model/light_test.ts`):
  `colour = min(255, ambient + Σ_i col_i · max(0, n̂ · l̂_i))` per channel, where:
  - n̂ = the vertex's signed-byte normal, normalised, rotated by the object → world 3×3 (identity for maps);
  - l̂ = the light direction, normalised, **in world space** (the camera sits on the projection stack, so the
    modelview at G_MOVEMEM time is object → world);
  - lights: L0 colour 0x323232 and L1 colour from the list's LIGHTCOL (offset 0x20, default 0xC8C8C8), both
    direction (0, 0x72, 0x37); ambient from LIGHTCOL offset 0x40 (default 0x505050).

  Each LIGHTCOL applies to the triangles that follow it in that record until the next LIGHTCOL. Green Garden stage 1
  (map 578), region means emulator vs world-space bake: grass 156/166/93 vs 161/174/94, fence 97/97/46 vs
  100/102/46 (bake about 3% brighter); a view-space bake is clearly wrong (fence 66/66/28). Renders:
  `bm64_model/renders/light_world_space_dirs.png`, `light_view_space_dirs.png`.
- **Projection:** guPerspective fovY 30°, aspect 4:3, near 200, far 20000; viewport scale (152, 114), translate
  (160, 120), i.e. a 304×228 image centred in 320×240. Cameras: Green Garden stage 1 eye (−1034, 1814, 1500)
  looking +X/−Y; Rock Garden eye (2300, 2400, 3101) looking −Z with pitch 55°.
- **Units and handedness:** vertex scale 1, no X mirror, right-handed Y-up; modelview = object → world
  (identity for maps).
- **Backgrounds** (verified from RDRAM frame lists and screenshots):
  - Most scenes clear the colour buffer to black (master list: SETFILLCOLOR 0x00010001 + FILLRECT). This covers
    Green Garden 1, Rock Garden and UP and Down.
  - **Pyramid**:
    - No colour clear.
    - The 3D pass begins with a **2D backdrop**: three G_TEXRECT strips (0,0)–(320,92), (0,92)–(320,184),
      (0,184)–(320,239). The texture is **asset 662**: a container with a CI4 160×160 image at +0x28 and a
      16-colour RGBA16 palette at +0x3228, loaded with LOADTILE. Texel rows start at t = 57, 80, 104 with
      dsdx = dtdy = 0.25, so each texel covers 4×4 pixels.
    - The sea around the pyramid is **asset 519**: a translucent textured quad at y −59, placed at (0, −400, 0).
  - **UP and Down**:
    - Black clear.
    - The water is **asset 516**: one 6600×6600 quad at y −59, placed at (0, −400, 0), UV 15 repeats.
    - It is drawn with render mode 0x055079D8 and `G_SETFOGCOLOR` alpha 0x99, i.e. **60% over black** (measured
      brightness ratio 0.58).
    - A viewer should draw 516 blended at alpha 0.6 over a black background.
  - Asset 515 there is a central platform object at (2350, 800, 1550).
  - **Field of Grass** (verified, `bm64_stage/dumps/rd_fog95.bin`):
    - No colour clear. The background texture 662 is drawn by game code as 8 screen-space G_TEXRECT bands
      (y 0–240 in ~34.5-pixel steps, dsdx 0.5, dtdy 0.666, per-band T offsets).
    - It is driven by the background slot table 0x802B0260: `setBackground` (ZeroJump 0x1A00 = 0x80287DC0) is
      called by the stage overlay, and the drawing is done by 0x802879AC.
    - Stages calling `setBackground` are listed in the section 4.1 tables (column Bg: 633, 662, 741, 744, 855).
  - White Glacier stage 1 uses real fog (5.4.6). Blue Resort was not captured.
- **Animation:**
  - Type-6 "scroll" globals 0x802A2D50/54 are constant 0x80 and never written, so type-6 records are static.
  - The real texture scroll is a **vertex UV scroll** (verified from code):
    - Table at 0x800A8C68: 6 × 24-byte entries `{u32 object, u32 vertexPtr, u32 count, s16 dS, s16 dT, s16 limitS,
      s16 limitT, s16 accS, s16 accT}`.
    - Updated once per game frame by 0x8022997C. It adds dS/dT to every vertex s/t (vertex +8/+10) of the loaded
      container in RAM while `acc + d` stays within the limit; otherwise it subtracts `acc` and resets it.
      1024 units = one repeat of a 32-texel texture.
    - Registered by 0x80229C90(obj, record, dS, limitS, dT, limitT) from stage overlays (e.g. Green Garden dS 10,
      limit 1024).
    - The table was empty in all six captured frames, so the file's UVs are a valid static frame.
  - Texture-bank animation (5.4.1) exists in code but was not active in any capture.
- **Billboards (type 5):** 0x8022D744 multiplies the object modelview by the camera view matrix, replaces the
  result with the inverse of its 3×3 (zero translation) and pushes it as `G_MTX(modelview, mul, push)` around the
  list. The geometry therefore keeps a fixed screen orientation at the object's position: draw type-5 records as
  camera-facing sprites.

#### 5.4.4 Changes needed in `displaylist.ts` (implemented in `bm64_model/displaylist_bm64.ts`)

1. `vertexScale` parameter (1) and `mirrorX` parameter (false).
2. A segment table updated by `G_MOVEWORD(G_MW_SEGMENT)` (the static resolver `segment 2 = file` is enough for maps).
3. A modelview matrix stack (`G_MTX`, `G_POPMTX`) for node trees.
4. RSP lighting from `G_MOVEMEM` lights and `G_MOVEWORD NUMLIGHT/LIGHTCOL`, with the master defaults above.
5. `G_LOADTILE` (same semantics as 5.3.3).
6. Default render mode 0x00553078.
7. Approximate `G_TEXTURE_GEN` UVs for type-8 records. `G_CULLDL` can be ignored.

The unmodified interpreter renders normals as colours and mirrors X (`renders/intro315_viewer_displaylist.png`).

#### 5.4.5 Verification

- Emulator runs (`bm64_model/run`, breakpoints on `getAsset` 0x8026CE28 and `loadOverlay` 0x8022691C):
  - **Green Garden stage 1** loads overlay 0x28, then assets 578, 588, 222, 34, 143, 144, 147, 847, 228, 73, 74,
    681, 685, 679, 680, 691, 699, 686, 687, 682, 683, 808, 304, 856 (RDRAM `rdram_gg1s1.bin`).
  - **Rock Garden** loads overlay 0x90, then 513, 537, 211, 73 + 74–77, 34, 0, 17, 14, 15, 285/286, 19, 274/275
    (`rdram_rockgarden.bin`).
- Static decode equals game output (`check_textures.ts`). Every decoded triangle appears in the frame at the same
  world position, and every decoded texture is byte-identical to one the frame bound:
  - map 578: 802/802 triangles, 11/11 textures;
  - map 513: 152/152 triangles, 9/9 textures;
  - intro map 315: 1,303/1,303 triangles, 26/26 textures.
- Side-by-sides with the extracted game camera (emulator | render | diff):
  - `renders/gg1_cmp_shot_vs_decode.png` (mean abs diff 19.1; map 578 plus pots 147/143): path, walls,
    spikes, fence cutout and lighting line up.
  - `renders/rockgarden_cmp_shot_vs_decode.png` (13.9).
  - Frame replays: `gg1_cmp_shot_vs_frame.png` (17.4), `rockgarden_cmp_shot_vs_frame.png` (12.7).
- All ten battle maps: `renders/battle_overviews_montage.png`.

Pitfalls: lighting is mandatory (vertex colours are normals); type-4 offsets and type-7 contents are not
pointers; translucent shadows/effects come out as white blobs without the fog-alpha blend and PRIM/ENV combiner.

#### 5.4.6 Levels: map parts, objects, attribute grids, per-stage environment

Source: `notes/bm64_stage.md`.

- **Map loading** (verified, disassembly):
  - `loadMap(asset)` = ZeroJump 0x0C00 = 0x80243BA8.
  - `loadMapPart(asset, f32 x, y, z, flags, s16)` = 0x0C01 = 0x80243A50. It keeps a part table at 0x800AED78
    (`{object*, data*, assetIdx}`) and creates a draw object with the position at object +0x10/+0x14/+0x18.
  - `loadAttributes(asset)` = 0x0D00 = 0x8026FF64 (parser 0x8026FC08).
  - In RAM, map 578 is byte-identical to its file and drawn with position 0, rotation 0 and scale 1, so **map
    vertex coordinates are world coordinates**.
- **Multi-part maps:** Black Fortress areas load several map files at the origin; asset 469 is instanced at the
  origin and at x = 7600 (0x6A, 0x6C); Trap Tower instances part 199 at y = 0 and y = 12000.
- **Drawable object pool** (verified from RAM, `bm64_stage/scripts/objpool.py`): 0x50-byte records from 0x800A0DF0.

  ```
  +0x00 id
  +0x04 link id
  +0x08 flags (0x40 prop, 0x50 map, 0x60 special)
  +0x0C kind
  +0x10 position (x, y, z)
  +0x1C rotation (degrees)
  +0x28 scale
  +0x3C data pointer
  ```

  The asset index comes from the getAsset cache 0x800A7F30. Props are placed by overlay code, from float records in
  overlay data, e.g. overlay 0x28 at 0x8004A520: `{u32 asset 685, f32 4450, 700, 50, …, f32 scale 1,1,1}` equals
  the instance in RAM. There is no single placement format: a viewer needs per-overlay extraction or the RAM
  positions. Green Garden 1 prop positions from RAM are in `bm64_stage.md` §4.3 (e.g. six pots, asset 147, at
  (900|1100|1300, 200, 1300|1800)).
- **Attribute file** (collision and object grid; the layout parses every byte):

  ```
  u8 layerCount; u8 originX; u8 originLayer; u8 originZ; u8 floorByte
  layerCount × { u8 blocksX (6); u8 blocksZ (4); u8 flag;
                 blocksX·blocksZ × { u16 blockId = col << 8 | row; u16 cell[64] (8 × 8, row-major) } }
  ```

  - Each layer is 48 × 32 cells; **one cell = 100 × 100 world units**, origin (0, 0). This was verified by sampling
    the Green Garden prop positions, which give one code per prop type: pots 147 → 0x0061, 144 → 0x0041.
  - Codes (hypothesis): 0x0010 empty, 0x0011 floor, 0x001F solid, 0x0411 water strip. The mapping of layer to height
    is open.
  - Not needed for drawing.
- **Per-stage environment API** (verified, disassembly; values confirmed in Green Garden 1 and Blizzard Peaks):
  - 0x2201 `setClearColor(r, g, b)` becomes the FILLCOLOR: Green Garden (55, 77, 255) → 0x327F.
  - 0x2104 `setFog(min, max, r, g, b)`; 0x2103 fog off.
  - 0x2101 `setLightDir(x, y, z)` (s8, L0 and L1); 0x2102 `setLightColor(r, g, b)`.
  - Default light direction (0, 114, 55). Overrides: Blue Resort 0x39 (45, 110, −44), 0x3A (55, 114, 0),
    0x3B/0x3C/0x3D (45, 110, 44); 0x69/0x6B/0x7B (15, 126, 0). Colour overrides: 0x89 (128, 128, 128), 0x8C (2, 2, 25).
- **Fog** (verified in Blizzard Peaks RAM, `bm64_stage/dumps/rd_wg58.bin`):
  - When fog is on, the frame sets G_FOG, `G_MOVEWORD FOG` with **fm = 128000/(max − min)** and
    **fo = 256·(500 − min)/(max − min)**, and **G_SETFOGCOLOR = r<<24 | g<<16 | b<<8 | 0x80**.
  - Blizzard Peaks (945–970, colour 230, 240, 255): fm 5120, fo −4556, colour E6F0FF80, clear (230, 240, 255) — exactly
    as predicted.
  - For the viewer's `Fog`: colour (r, g, b), multiplier fm, offset fo, near 200, far 20000.
  - Per-area fog values are in the section 4.1 table; the title screen uses 900–960.

## 6. Music (shared system, all three games)

All three games use **standard Nintendo libultra audio**: the compressed-MIDI sequence player
(alCSPlayer), ALBankFile instrument banks ("B1") with VADPCM samples, and the common RSP audio microcode
(aspMain, ABI1). Hudson wraps it in the SDK sample audio manager (SA function names: `amMusPlay`,
`musSeqHRomCopy`, `initOsc/updateOsc/stopOsc`, `__amMain`, ...). There is no custom audio microcode
and no MusyX. Music data is **uncompressed** and read in place from ROM.

### 6.1 Where the data is (verified)

One contiguous blob per game: `S2 song table | .ctl | .tbl | sequences`. All offsets inside the
S2 table are relative to the S2 header.

| Game | Blob / S2 header | Songs | .ctl ("B1") | Banks | .tbl | Sequences |
|---|---|---|---|---|---|---|
| BM64 | asset 32, ROM 0x30A898 | 47 | 0x30AD08 | 3 (every song uses bank 0) | 0x314150 | 0x3EB5C0–0x407978 |
| Hero | ROM 0x38A1F0 | 33 (entry 0 empty) | 0x38A510 | 1 (128 instruments) | 0x390858 | 0x46C960–0x47A4D8 |
| SA | resource 0, ROM 0x2A8008 | 76 | 0x2A8730 | 58 (per-song) | 0x2C5C10 | 0x3C6C10–0x41AE48 |

The .tbl has no header of its own: it starts immediately after the .ctl (sizes from the song record).

Sound effects are a separate blob (BM64 asset 33 "T2" at 0x407978, Hero "T1" 0x229650, SA resource 1
"T3" 0x41AE48) with its own bank; not needed for music and not documented beyond its location.

### 6.2 S2 song table (verified)

```
+0          u16 'S2' (0x5332)           libultra ALSeqFile uses 'S1'; the loader accepts both
+2          u16 count
+4          count × { u32 seqOffset; u32 seqLength }      seqOffset 0xFFFFFFFF = empty entry
+4+8·count  count × 16-byte song record:
              u8  bank        index into the .ctl's bank array
              u8  volume      per-song master volume (0..127)
              u16 0xFFFF
              u32 ctlOffset   u32 ctlSize   u32 tblOffset
```

SA's loader (0x800249A8–0x80024BB4) reads `bank`, `ctlOffset`, `ctlSize`, `tblOffset` from the record at
`table + song·16` and binds `ctl->bankArray[bank]` to the sequence player. Song → bank:
- BM64: bank 0 for all 47 songs (banks 1 and 2 are unused by music; purpose unknown).
- Hero: bank 0 for all songs.
- SA: bank per song, 0..75: `0 1 2 3 4 5 0 6 7 50 8 51 9 52 10 53 11 54 12 13 14 55 15 0 16 17 18 19 0 0 0 0 0 0 20 21 22 23 24 25 26 27 28 28 29 29 30 30 31 31 32 32 33 34 35 36 37 0 38 0 39 40 40 41 42 43 44 45 46 47 0 48 56 57 0 0`.
  Verified from RAM on four screens (intro song 3/bank 3, main menu 1/1, character select 5/5, battle 42/28)
  and by rendering song 3 with bank 3 against captured game audio.

### 6.3 Instrument bank (.ctl) (verified: all pointers resolve in all three games)

Standard libultra ALBankFile, big-endian, offsets relative to the .ctl start (relocated by adding the
base, as `alBnkfNew` does):

```
ALBankFile   { s16 revision = 0x4231 'B1'; s16 bankCount; s32 bankOffset[bankCount]; }
ALBank       { s16 instCount; u8 flags; u8 pad; s32 sampleRate (32000); s32 percussion (offset or 0);
               s32 instOffset[instCount]; }
ALInstrument { u8 volume; u8 pan; u8 priority; u8 flags;
               u8 tremType, tremRate, tremDepth, tremDelay; u8 vibType, vibRate, vibDepth, vibDelay;
               s16 bendRange (cents); s16 soundCount; s32 soundOffset[soundCount]; }
ALSound      { s32 envelope; s32 keyMap; s32 wavetable; u8 samplePan; u8 sampleVolume; u8 flags; u8 pad; }
ALEnvelope   { s32 attackTime; s32 decayTime; s32 releaseTime;   (microseconds)
               u8 attackVolume; u8 decayVolume; }
ALKeyMap     { u8 velocityMin, velocityMax, keyMin, keyMax, keyBase; s8 detune (cents); }
ALWaveTable  { s32 base (offset into .tbl); s32 len; u8 type (0 ADPCM, 1 RAW16); u8 flags; u16 pad;
               s32 loop (offset or 0); s32 book (offset); }
ALADPCMloop  { u32 start; u32 end; s32 count (-1 = forever); s16 state[16]; }
ALADPCMBook  { s32 order (2); s32 npredictors (4); s16 book[order · npredictors · 8]; }
```

All wave tables in all three games are type 0 (VADPCM), order 2, 4 predictors.

### 6.4 VADPCM decoding (verified bit-exact)

9-byte frames of 16 samples: header byte `scale << 4 | predictorIndex`, then 8 bytes = 16 signed 4-bit
residuals, `r = signExtend4(nibble) << scale`. With `cb = book[predictorIndex]` (16 s16: `b1 = cb[0..7]`,
`b2 = cb[8..15]`), each frame is decoded in two halves of 8 samples:

```
half 0: l1 = prev[14], l2 = prev[15]     (prev = previous frame's 16 outputs; zeros at start)
half 1: l1 = out[6],   l2 = out[7]
for i in 0..7:
    acc = (r[i] << 11) + b1[i]·l1 + b2[i]·l2 + Σ_{k<i} b2[k]·r[i-1-k]
    out[i] = clamp16(acc >> 11)
```

This is the ABI1 `A_ADPCM` command (mupen64plus-rsp-hle `alist_adpcm`). Verified: for looped waves, the
16-sample `ALADPCMloop.state` equals the decoded PCM just before the loop start (BM64 66/66, Hero 57/58,
SA 105/113 exact; the rest are near misses, likely loop-state rounding in the tools).

### 6.5 Sequence format: libultra compressed MIDI (verified: all 155 songs parse to the end)

```
header: s32 trackOffset[16] (from sequence start; 0 = unused), s32 division (480 in every song)
track:  { varlen delta; event }*
byte fetch (applies to every byte read, including deltas):
  FE FE          -> literal 0xFE
  FE hi lo len   -> back-reference: read `len` bytes starting at (position of this FE) - (hi << 8 | lo),
                    then continue after the 4-byte escape
events:
  FF 51 t1 t2 t3            tempo, microseconds per quarter note
  FF 2F                     end of track
  FF 2E nn FF               loop start marker (2 payload bytes ignored)
  FF 2D cnt cur o1 o2 o3 o4 loop end: if cur == 0 { cur = cnt; fall through } else { if cur != 0xFF: cur--;
                            jump to (address after these 6 payload bytes) - (o1..o4 as u32) }
                            cnt = cur = 0xFF loops forever
  8n..En                    MIDI channel messages with running status (reset after meta events)
  9n key vel <varlen dur>   NOTE-ON CARRIES ITS DURATION in ticks; there are no note-off events
```

Only controllers 7 (volume), 10 (pan) and 91 (effects/reverb send) occur, plus program change and
pitch bend. BM64 has some finite loops (`cnt = 3`); Hero and SA loop forever.

### 6.6 Rendering to PCM

- Output rate: **32006 Hz** (AI_DACRATE 1520, read from all three games in the emulator); the bank rate
  is 32000. Pitch ratio of a voice = `2^(((key − keyBase)·100 + detune + bend·bendRange/8192) / 1200)`
  (verified by chroma comparison against captured game audio: 0.93–0.94 at 0 semitones versus ≤ 0.72
  shifted).
- Tick time = tempo / 480 microseconds; verified against captured audio at tempo stretch 1.00.
- **Voices:** SA builds its ALSynConfig in `initAudioLib` 0x80026C88 with maxVVoices = maxPVoices = 22 and
  maxUpdates 350 (verified). BM64 16/350 (ROM 0xBBA50) and Hero 16/512 (ROM 0x4AEA0) are hypotheses from
  config-like data. Voice stealing by instrument priority is not researched; with 16–22 voices it is probably rare.
- **Envelope ramps are exponential** (verified from the ABI1 ENVMIXER as implemented in mupen64plus-rsp-hle
  `alist_envmix_exp`). Every 8 output samples the target level is multiplied by a 16.16 rate
  (`expSeq = expSeq · rate >> 16`), with linear steps between those points, clamped at the target. Voice gain per
  sample = `(ramp · dry + 0x4000) >> 15`; mix `out += (in · gain) >> 15`. Envelope order (hypothesis, libultra
  behaviour): ramp from 0 to attackVolume over attackTime, then to decayVolume over decayTime, hold, and at note
  end ramp from the *current* level to 0 over releaseTime. Times are microseconds. BM64/Hero envelopes have attack
  time 0; SA's are mostly attack 225 µs, decay 32 µs, decayVolume 124, release 2000–5124 µs.
- **Pan:** all three ROMs contain libultra's 128-entry equal-power table (Q15: 32767, 32764, 32757, … 810, 405, 0;
  BM64 ROM 0x1BFE0, Hero 0x4C3B0, SA 0x953D0). Left gain = `table[pan]`, right = `table[127 − pan]` (verified).
  Hypothesis: `pan = clamp(channelPan − 64 + samplePan, 0, 127)`.
- **Volume** (hypothesis, libultra `__vsVol`): `v = (127 · velocity · envGain) >> 6`,
  `w = (sampleVolume · playerVolume(0..0x7FFF) · channelVolume) >> 14`, `voiceVolume = (v · w) >> 15`. A program
  change copies the instrument's volume, pan, priority and bendRange into the channel; CC7/CC10 override them.
  The S2 song volume byte is assumed to set the player volume.
- **Controllers** (verified in SA's handler 0x8007BA10): 7 channel volume, 10 channel pan, 64 sustain, 91 effects
  send. Pitch bend `value − 8192`; ratio `2^(((value − 8192)/8192) · bendRange / 1200)` with bendRange in cents
  (200 in most instruments). Applying CC and bend to already sounding notes is a hypothesis.
- **Reverb** (effects bus fed by CC91):
  - All three ROMs contain libultra's preset tables (BM64 ROM 0x1BE50, Hero 0x4C220, SA 0x95240). Each preset
    is `{sections, totalLength, then per section {input, output, fbcoef, ffcoef, gain, chorusRate, chorusDepth,
    lowpassCoef}}`:
    - SMALLROOM {3, 4000: (0,2160,9830,−9830,0,0,0,0) (760,1520,3276,−3276,16383,0,0,0) (0,2400,5000,0,0,0,0,20480)}
    - BIGROOM {4, 4000: (0,2640,9830,−9830,0,0,0,0) (880,2160,3276,−3276,16383,0,0,0) (2640,3640,3276,−3276,16383,0,0,0) (0,3760,8000,0,0,0,0,20480)}
    - ECHO {1, 8000: (0,7160,12000,0,32767,0,0,0)}
    - CHORUS {1, 800: (0,200,16384,0,32767,7600,700,0)}
    - FLANGE {1, 800: (0,200,0,24575,32767,380,500,0)}
  - **SA** (verified): fxType 6 = custom, params at 0x8008F2C0 = {2, 8000: (0, 2560, 16383, −16383, 2949, 0, 0,
    19004), (0, 5760, 16383, −16383, 16383, 0, 0, 19004)}.
  - BM64 and Hero have custom tables next to their configs (BM64 ROM 0xBBAC8 {3, 6400: …}, Hero ROM 0x4AF18
    {1, 12800: (0, 8000, 12000, 0, 32767, 0, 0, 16000)}), but a config byte suggests SMALLROOM. Which is active is
    unresolved.
  - The reverb algorithm (libultra `reverb.c`) is optional for a recognisable render.
- **Vibrato/tremolo:** no instrument in any game uses tremolo. Vibrato is set on 6 instruments in BM64, 1 in Hero
  and 55 in SA. From SA code (verified: `initOsc` 0x8002372C, `updateOsc` 0x80022744, `_depth2Cents` 0x80020C3C):
  - Updates every 16,000 µs; depth in cents = `1.0309929847717285 ^ vibDepth`.
  - Type 128 (sine): period `259 − vibRate` updates, value `sin(2π·cur/period) · depth`.
  - Type 136 (saw): period `256 − rate`.
  - Types 132/137 (4-phase steps): period `(259 − rate)/4`.
  - Type 138: sine with negated depth.
  - Output scaling and vibDelay are open.
- **Resampler:** the RSP uses a 4-tap interpolator (verified, `alist_resample`); linear interpolation is an
  acceptable stand-in.
- **Rate for the viewer:** render and declare 32,000 Hz. The hardware's 32,006 Hz differs by 0.02%, which is
  inaudible; use 32,006 only when aligning with emulator captures.
- The Python prototype does not implement the exponential ramps, pan table, live controllers, reverb or vibrato
  yet. Its measured match (Hero song 24: loudness correlation 0.88, chroma 0.93; SA song 3: 0.71, 0.94) is the
  baseline.
- Loops for `DecodedMusic` (verified on every looping track of Hero song 2, and consistent in all
  songs checked): in a looping song, FF 2E (loop start) and FF 2D (loop end) sit at the **same tick in
  every track**, and FF 2D's back-offset jumps to the byte right after FF 2E. So
  `loopStartTick` = tick of FF 2E and `loopEndTick` = tick of FF 2D (cnt = 0xFF = forever). Convert ticks
  to samples by integrating the tempo map: `seconds = Σ ticks · usPerQuarter / 1e6 / 480`,
  `samples = seconds · outputRate`. Render from 0 to `loopEndTick` plus the release tails. Example: Hero
  song 2 "Action Scene A" has loopStart tick 15362 = sample 448,474 and loopEnd tick 61444 = sample
  1,793,780 at 32,000 Hz. Songs without markers (e.g. Hero song 24, the title theme) play once and have
  no loop. Finite loops (cnt = 3, BM64 only) must be unrolled (jump back `cnt` times) before the final
  forever loop, if any.

Reference implementation (Python): `/home/n64/.ai-tmp/r49/bm/audio/scripts/n64audio.py` (S2 parser,
VADPCM decoder, sequence parser including back-references and loops, simple sampler, WAV writer);
`render_one.py <game> <song> <bank> <seconds>`.

### 6.7 Song lists

Evidence levels: **obs** = observed in RAM or captured audio; **code** = constant or table in code (the
screen it belongs to may still be inferred); **name** = in-game Sound Test; **H** = hypothesis.

#### Bomberman Hero: 32 songs, all named (Sound Test)

The Sound Test (scene overlay ROM 0x15C0D0 → 0x80330000) plays the byte at `0x80334468 + BGM number`;
that table is 1..32, so **song index = BGM number + 1** (code). The names are drawn from graphics, not
stored as text. Per-stage music comes from the 0x38-byte info records (section 5.2.2; pointer table VRAM
0x8010B3FC = ROM 0xFD91C, 192 entries): bytes 0–2 are planet/area/map, byte 7 is the song (0xFF = keep the
current song).

| Song | BGM | Name | Use |
|---|---|---|---|
| 1 | 00 | BGM Stop | silence; placeholder stage records |
| 2 | 01 | Action Scene A | stages, e.g. Bomber A1 M2/M5 (Hyper Room, Sky Room) |
| 3 | 02 | Action Scene B | stages, e.g. Bomber A1 M1/M3/M4 (Battle, Secret, Heavy Room) |
| 4 | 03 | Action Scene C | stages (Primus A1 M2, A2 M4; Kanatia A2 M2; Mazone A3 M4) |
| 5 | 04 | Dark Cave | stages (Bomber A2 M1/M3, ...) |
| 6 | 05 | Bomber Jet | jet stages (Bomber A2 M4, ...) |
| 7 | 06 | Bomber Marine | submarine stages (Bomber A2 M2, ...) |
| 8 | 07 | Bomber Copter | helicopter stages (Primus A3 M1, Kanatia A1 M1) |
| 9 | 08 | Mad Garden | stages (Bomber A2 M5, Kanatia A2 M3) |
| 10 | 09 | Non-Gravity | stages (Kanatia A2 M4, Mazone A3 M3) |
| 11 | 10 | Pyramid Eye | stages (Kanatia A2 M1/M5, A3 M2/M4) |
| 12 | 11 | Bomber Slider | surfing stages (Kanatia A1 M5, Mazone A2 M3/M5, ...) |
| 13 | 12 | Louie | stages (Mazone A1 M1/M2, A2 M2) |
| 14 | 13 | Vs. Nitros | boss records (kind 1) |
| 15 | 14 | Vs. The Big Four | boss records (kind 2) |
| 16 | 15 | Vs. Bagular | final bosses (Garaden A1 M7, planet 6 A1 M3) |
| 17 | 16 | Forever | event records |
| 18 | 17 | Dark Trap | Bomber A1 M1 record 0, event records |
| 19 | 18 | United Scene-Short | cutscenes (4 constant calls) |
| 20 | 19 | Silent Pressure | event records |
| 21 | 20 | I am Nitros | Mazone A3, event records |
| 22 | 21 | Garaden's Defeat | event records |
| 23 | 22 | Rescue | event records |
| 24 | 23 | Bomberman Hero | title and attract intro (obs: RAM and audio capture) |
| 25 | 24 | Game Over | overlay 0x1528A0 |
| 26 | 25 | Cosmo Space | seg2 constant (planet select, H) |
| 27 | 26 | Good Job! | overlay 0x157A00 |
| 28 | 27 | Bomber Techno | seg2 constants, event records |
| 29 | 28 | Ending | seg2 constant |
| 30 | 29 | Map Clear | seg2 constants |
| 31 | 30 | Stage Clear | overlay 0x157A00 |
| 32 | 31 | United Scene-Long | 4 seg2 constants |

Every Hero song is referenced; no unused music.

#### Bomberman 64: 47 songs, no in-game names (no sound test)

Stage music: seg2 `0x8023C84C` plays song `W + 3` for world W (u32 at 0x802AC5E8, stage at 0x802AC5EC). If
flag `0x802AC5D0 & 8` is set (H: boss stage), world 0 → 14, worlds 1–3 → 11, world 4 → 12 or 13, world 5 →
15 or 16. Overlays play music through ZeroJump id 0x2B02 (0x2B01 stops, 0x2B03 fades).

| Song | Use |
|---|---|
| 1 | Adventure intro town cutscene, overlay 0x1A (obs + code) |
| 2 | World/Stage Select (overlay 0x21, code) |
| 3–8 | adventure stage theme for world 0–5 (code): Green Garden, Blue Resort, Red Mountain, White Glacier (world indices verified), Black Fortress, Rainbow Palace (by elimination) |
| 10, then 18 | Stage 2 bosses: Friend or Foe? (0x31), VS Artemis (0x3E), VS Orion (0x56), VS Regulus (0x62) (code; 18 is presumably the victory cue) |
| 11 / 12, 13 / 14 / 15, 16 | boss music: worlds 1–3 / world 4 / world 0 / world 5 (code; "boss" is H) |
| 19 | short cue after 42 in the boss arenas 0x88–0x8D (code) |
| 20, 24, 28, 33, 45, 46 | seg2 constant calls (code; screens unidentified) |
| 21 | seg2 0x802400A8, alternative to 45 by a flag (code) |
| 22 | story cutscene overlay 0x1C (code) |
| 26 | attract intro, title, main menu (obs) |
| 27 | battle match (obs; seg2 0x8023C41C) |
| 29 | Battle menu (obs; overlays 0x23 battle menu, 0x25 Custom) |
| 31, 32 | battle menu overlay 0x22 (code) |
| 35 | VS Altair (0x74) and Final Battle! (0x7E) (code) |
| 42 | boss arenas 0x88–0x8D: Winged Guardian, Sewer Savage, Hot Avenger, Cold Killers, High-Tech Harvester, Spellmaker (14-second cue; code) |
| 44, 13 | VS Altair (0x74) (code) |
| 16 | Final Battle! (0x7E) (code; also a world-5 boss song) |
| 0, 9, 23, 25, 34, 36, 37, 41, 43 | identical 1-track 0xB8-byte cues, no reference found: unused candidates (section 10) |
| 17, 39, 40 | three near-identical variants of one full looping song, no reference found: unused candidates (section 10) |
| 30, 38 | short cues, no reference found: weak unused candidates |

#### The Second Attack: 76 songs, no in-game names (no sound test)

| Song | Use |
|---|---|
| 1 | main menu (obs); also exec 0x1A/0x20 |
| 3 | boot intro (obs; played by an event script) |
| 5 | battle setup / Character Select (obs) |
| 42, 44, 46, 48, 50 | battle music for battle types 0–4 (table 0x8008F8B8; type 0 Survival = 42 obs) |
| 43, 45, 47, 49, 51 | hurry-up variants of those (`_BattleHurryEffect`) |
| 8, 10, 12, 15, 17, 18, 21, 22 | story worlds 0–7, event flag 0 (table 0x8008FE8C) |
| 9, 11, 13, 14, 16, 18, 20, 22 | story worlds 0–7, event flag 1 (same table) |
| 19, 18 | special areas (resources 2167/2176, 2165/2164) in world 5 (table 0x8008FEE8) |
| 24, 25 | common cues in all story modules exec 0x22–0x28 (H: boss/clear) |
| 38 / 54 | story areas 2235 / 2223 (code) |
| 63 | `gameprocOverEffect` (H: results/game over) |
| 69 | `gameprocBattleDraw` (H: draw game) |
| 2, 4, 7, 52, 53, 60, 66, 67 | exec overlays 0x20, 0x1F, 0x1C, 0x1D, 0x2B (code; screens unknown) |
| 0, 6, 23, 28–33, 57, 59, 70, 74, 75 | 1-track 0x70-byte silent stubs (H: placeholders) |
| 26, 27, 34–37, 39–41, 55, 56, 58, 61, 62, 64, 65, 68, 71–73 | no static reference found; weak unused candidates, because event scripts (`evexecAudio`) also start music and were not parsed |

World indices 0–7 of the story table are named in section 4.2 (0 Lost Planet Alcatraz … 7 Warship Noah).

Rendered samples (Python prototype): `/home/n64/.ai-tmp/r49/bm/audio/wav/` holds `bmhero_seq02_bank0.wav`
(Action Scene A), `bmhero_seq24_bank0.wav` (Bomberman Hero), `bm64_seq01_bank0.wav` (adventure intro),
`bm64_seq26_bank0.wav` (title), `bm64_seq27_bank0.wav` (battle), `bm64_seq03_bank0.wav` (world 0 stage theme),
`bm64_seq42_bank0.wav`, `bm64sa_seq01_bank1.wav` (main menu), `bm64sa_seq03_bank3.wav` (intro),
`bm64sa_seq42_bank28.wav` (Survival battle).

## 7. Mapping onto the viewer

### 7.1 Detection and plumbing (straightforward)

- `src/rom/index.ts openRom()`: add cases `NBME` → `openBomberman64`, `NBVE` → `openBomberman64SA`,
  `NBDE` → `openBombermanHero`. Byte-order normalisation is already there.
- `types.ts`: widen `Game.id` to include `'bm64' | 'bm64sa' | 'bmhero'`. `LevelKind` currently has
  `'race' | 'battle' | 'stunt' | 'obstacle'`; Bomberman needs story levels, e.g. add `'adventure'` (BM64
  Adventure, SA Story Mode, Hero planets). Battle stages can reuse `'battle'`.
- `src/ui/Sidebar.tsx` groups levels by the fixed `GROUPS` list: add a group for the new kind (e.g.
  "Adventure" / "Story"). Level names for story levels are best written as "World – Stage – Area" (BM64),
  "Planet – Area – Map" (Hero).
- `src/render/startView.ts` looks for an interior start view when `kind === 'battle' || 'stunt'`; the
  Bomberman battle stages are small arenas seen from above, so the existing battle heuristic is a
  reasonable default.
- The worker (`src/worker.ts`) already exposes `Game.music` and `decodeMusic(index)`; nothing to add
  beyond implementing them. `romCache.ts` keys by game id.
- `APP_NAME = 'Rush Level Viewer'` in Sidebar.tsx will need renaming once non-Rush games are supported.

### 7.2 New and reused modules

| Piece | Reuse | New module (suggested name) |
|---|---|---|
| ROM detection, byte order | `rom.ts normalizeByteOrder`, `index.ts` | — |
| BM64/SA LZSS (1,024 ring, start 0x3BE, size-terminated) | not `lzss.ts` (different ring, match layout, terminator) | `src/rom/bomberman/lz1k.ts` |
| Hero LZSS (4,096 ring, start 0xFEE, pos12/len4+3, LE input-size header) | not `lzss.ts` | `src/rom/bomberman/lz4k.ts` (or one parameterised ring-LZSS in `lzss.ts`, done without changing Rush behaviour) |
| SA Yay0 | — | `src/rom/yay0.ts` |
| BM64/SA archives (header + page table) | — | `src/rom/bomberman/archive.ts` (one class, parameterised by dataOffset/capacity) |
| Hero chained files by ROM offset | — | `src/rom/bomberman/heroFiles.ts` |
| F3DEX 1.x display lists (BM64, Hero) | `displaylist.ts` F3DEX path, extended (see below) | options on `DisplayListContext`, not a fork |
| F3DEX2 display lists (SA) | `displaylist.ts` F3DEX2 path, extended (see below) | same |
| Texture decoding / RDP tile emulation | `texture.ts` **unchanged** (verified for all three games) | a `loadTile()` helper next to `loadBlock()` for G_LOADTILE |
| Lighting bake (all three) | — | `src/rom/bomberman/lighting.ts` (normal × light → vertex colour) |
| "64" containers (BM64 + Hero share the format) | — | `src/rom/bomberman/container64.ts` |
| SA NIFF models | — | `src/rom/bomberman/niff.ts` |
| Level loaders | pattern of `rush1.ts` | `bm64.ts`, `bm64sa.ts`, `bmhero.ts` |
| Music (all three: S2 + B1 ctl + VADPCM tbl + compressed MIDI) | nothing in the repo yet | `src/rom/music/libultra/{s2.ts, bank.ts, vadpcm.ts, cseq.ts, synth.ts}`, shared by all three games; per-game offsets and song names in the game loaders |

### 7.2.1 Extensions to `displaylist.ts` (all backwards compatible with the Rush loaders)

Implemented and tested in three research copies: `bm64_model/displaylist_bm64.ts` (F3DEX, BM64),
`hero_level/herodl.ts` (F3DEX, Hero) and `sa_niff/dl_bm.ts` (F3DEX2, SA).

| Change | Why | Games |
|---|---|---|
| `vertexScale` (default 1/16) and `mirrorX` (default true) in the context | Bomberman: scale 1, no mirroring | all |
| Segment table updated by G_MOVEWORD(G_MW_SEGMENT) (BM64/Hero: F3DEX `0xBC` index 6), falling back to `resolve` | BM64 banks on segments 3..14; frame replays | BM64, Hero |
| Modelview stack (G_MTX push/mul/load, G_POPMTX) applied to positions | node trees with translations | BM64, Hero |
| `lighting` hook: when G_LIGHTING is set, treat vertex RGB as a signed normal and call a shader with the current modelview, lights (G_MOVEMEM) and light colours (G_MOVEWORD LIGHTCOL: 0x20/0x24 light 2, 0x40/0x44 ambient) | lit geometry | all |
| G_LOADTILE (0xF4) with `rdp_load_tile` semantics, and remembering the SETTIMG width field + 1 as the image stride | characters (BM64 184 uses), SA textures (416 uses) | BM64, SA |
| Caller-supplied initial render mode / alpha compare (BM64 and Hero default 0x00553078 cutout; SA per draw layer) | lists never set SETOTHERMODE_L | all |
| Caller-supplied initial geometry mode (SA: 0, lists set it; BM64/Hero: 0x22205) instead of `cullBackByDefault` only | | all |
| Ignore G_CULLDL (0xBE F3DEX, 0x03 F3DEX2) safely; type-8/TEXTURE_GEN: approximate UVs | every list starts with a CULLDL | all |
| Track SETPRIMCOLOR (0xFA), SETENVCOLOR (0xFB) and the 16 SETCOMBINE fields; fold the combiner into vertex colour/alpha with TEXEL0 = 1 (5.3.3) | 15% of SA triangles use PRIM/ENV; texture-only lists must ignore shade | SA (BM64 translucent effects too) |
| Texture cache key must include the file (the existing `keyPrefix`) | texture offsets repeat across files | all |

### 7.3 Difficulty and risks (preliminary)

- Filesystem and codecs: low. They are fully specified above and verified byte-exact against RAM.
- Music: medium. The formats are standard and fully specified, and a Python renderer already matches game
  timing and pitch. The work is a faithful synthesizer (envelopes, pitch bend, pan, voice limit, reverb
  optional) that runs in a worker in reasonable time. Songs must be rendered to a finite PCM buffer with
  a loop region.
- Geometry, BM64 and Hero: medium. The container format is simple and fully decoded (triangle-exact against
  RDRAM for BM64), and all BM64 battle maps and all 102 Hero map files decode. The work is the display-list
  extensions, lighting bake, and hard-coded per-stage file lists (tables in section 4). Risks:
  - Hero names are only available as bitmaps, so a loader must hard-code them.
  - Props and objects: Hero placement records are verified. BM64 props have no single placement format (5.4.6),
    so a first version should show map geometry only.
  - Skies and backgrounds are 2D blits drawn by game code, not meshes, so the `Sky` type needs a screen-space
    background or an approximating mesh.
- Geometry, SA: medium. NIFF is richer: object trees with rotation orders, draw layers, texture sets bound at run
  time, lights evaluated from environment records, and combiners. All of it is specified (5.3), and all 22
  battle maps and the first story area render correctly. Story placements beyond the map need the object id →
  model mapping, which is mostly unresolved. Models whose textures come from run-time texture sets will be
  untextured unless the loader picks the set the game uses.
- Visual fidelity risks for all three: fog-alpha blending of translucent effects (BM64 water uses it: draw at
  alpha 0.6), static frames of animated textures (UV scroll), about 3–5% lighting brightness error, and the lerp
  combiners in about 410 SA triangles.

## 8. Verification evidence

All paths are under `/home/n64/.ai-tmp/r49/bm/`. Emulator: headless mupen64plus (glide64mk2 software
rendering, HLE RSP). Its `--debug` core was used for breakpoints and RDRAM dumps.

### 8.1 Reference screenshots of the real games

| Game | Directory | Contents |
|---|---|---|
| BM64 | `ref_bm64/shots/` (62) | title, menus, all 6 battle stage-select previews and starts, Adventure intro, World Select for 4 worlds, stage-1 title cards and gameplay starts of all 4 worlds |
| SA | `ref_bm64sa/shots/` (56) | title, battle menus, 4 battle stages in play (incl. Tropical Island flood, Park water animation frames), story intro, first area, World Select |
| Hero | `ref_hero/shots/` (36) | title, file menu, planet/area/stage select, Battle Room gameplay and camera views, Sound Test, Score pages |
| BM64 | `bm64_model/shot_gg1_at_dump.png`, `shot_rockgarden_at_dump.png` | frames matching the RDRAM dumps |
| Hero | `hero_level/emu_s11_start.png`; `unused/shots/hero_master_debug_page10{0,1,2}*.png` | stage 1-1 start; hidden debug menu |
| SA | `sa_niff/dumps/normal2_shot.png`, `sa_niff/renders/emu_story2057_*.png`, `sa_stage/shots/` | battle in play; intro cell |
| BM64 | `bm64_stage/shots/` (32), `bm64_model/shot_*_at_dump.png` | Green Garden 1, White Glacier 1, Field of Grass, UP and Down, Pyramid, Greedy TraP, Top Rules |
| Hero / SA | `verify/shots/hero_s18_fogroute.png`, `verify/shots/sa_2101_aquanet.png` | fogged stages used to verify the fog formulas |

### 8.2 What was checked against the running game or the ROM

| Claim | Method | Result |
|---|---|---|
| ROM identity | header CRC1/CRC2 recomputed with the CIC-6102 algorithm (`notes/crc.py`) | all three match |
| BM64 LZSS decoder | 125 decompressions (10 overlays, 115 assets) dumped from RDRAM at decoder exit from power-on through the Adventure intro (`bm64fs/dbgdrive.py`, `verify.py`, `dumps/`) | 125/125 byte-identical |
| SA LZSS and Yay0 | RDRAM at decoder exit: resource 3044 (LZSS), exec 0x1A (LZSS, TLB-mapped), resource 13 (Yay0) (`bm64safs/dumps/d1–d3.bin`) | byte-identical |
| SA/BM64/Hero code images | RDRAM dumps compared with ROM ranges | code identical; only small `.data` ranges differ |
| Hero LZSS | break at call/return of `lzssDecode`: source = ROM 0x4C9FD0, output 0xFE70 bytes (`herofs/v1_*.bin`); full-RDRAM slot comparisons | identical; 5/5 (attract) and 41/42 (stage 1-1) slots identical |
| BM64 container: no relocation | every container copy in RDRAM frames (Green Garden 1, Rock Garden, intro) compared with the extracted file | identical |
| BM64 decoder = game output | `bm64_model/check_textures.ts`: static decode vs triangles and bound textures of the RDRAM frame | 578: 802/802 triangles, 11/11 textures; 513: 152/152, 9/9; 315: 1,303/1,303, 26/26 |
| BM64 scale, handedness, lighting, cutout | renders with the camera extracted from RDRAM, next to the emulator frame | `bm64_model/renders/gg1_cmp_shot_vs_decode.png` (19.1 mean diff), `rockgarden_cmp_shot_vs_decode.png` (13.9) |
| Hero map decode, scale, handedness | map-only render at the game camera; replay of all draw calls of the frame | `hero_level/renders/cmp_s11_cam.png`, `frame_s11_cmp.png` (22.7) |
| Hero placement records | 16 placement records of stage 1-1 vs object positions in the frame | 16/16 match in x, z, yaw |
| SA NIFF relocation and segment resolver | every live NIFF in two RDRAM dumps; gSPSegment values in the frame list vs shape records (`sa_niff/ramniff.py`, `verify_wrappers.py`) | all pointers = file + base; 27/27 and 38/45 draws match (other 7 = runtime texture sets) |
| SA texture upload emulation | static: textures produced by running all 4,750 lists vs direct decode of their records (`sa_niff/textest.ts`) | 3,940/3,941 identical |
| SA battle map, scale, handedness | Normal map rendered with the game camera from the frame matrix | `sa_niff/renders/battle2058_res17_gamecam_vs_emu.png` |
| Music data locations and VADPCM decoder | loop-state check: `ALADPCMloop.state` vs decoded PCM before the loop (`audio/scripts/loopstate_check.py`) | BM64 66/66, Hero 57/58, SA 105/113 exact |
| Sequence parser | parse every song to its end (`audio/scripts/seqcheck.py`) | 155/155 with no errors |
| Output rate | AI_DACRATE in emulator audio captures | 1520 → 32,006 Hz in all three |
| Renderer timing and tuning | captured game audio (`audio/dumps/aicap/`) vs renders: RMS-envelope correlation and chroma | Hero song 24: NCC 0.88 at tempo 1.00, chroma 0.93 at 0 semitones; SA song 3 (bank 3): NCC 0.71, chroma 0.94 |
| Which song plays | RDRAM: sequence bytes and bank pointer of the sequence player (`audio/scripts/ramsong.py`) | SA intro 3, menu 1, character select 5, battle 42; Hero title 24; BM64 intro 1, title/menu 26, battle menu 29, battle 27 |
| Hero Sound Test mapping | code: song table 0x80334468 = 1..32 | song = BGM number + 1 |
| Hero debug menu | `write 0x8016E424 1`, pause, L | three debug pages shown |
| BM64 battle stage → overlay | emulator load log per stage-select position (`bm64_model/dbgdrive.log`) | Rock Garden 0x90, UP and Down 0x91, Pyramid 0x92, Greedy TraP 0x93, Top Rules 0x94 |
| BM64 lighting bake (world-space directions) | region means of a baked static render vs `shot_gg1_at_dump.png` (`bm64_model/light_test.ts`) | within about 3%; view-space variant clearly wrong |
| BM64 backgrounds | RDRAM frame lists in Pyramid and UP and Down (`bm64_model/rdram_pyramid.bin`, `rdram_updown.bin`) | TEXRECT backdrop from asset 662; translucent water quads 519/516 (alpha 0x99 ≈ measured 0.58) |
| SA lighting bake | env-record light evaluation vs light bytes in the frame; brightness vs emulator frames (`sa_niff/bakecheck.ts`) | bytes identical (Normal, area 2223); channel ratios 0.91–1.00 |
| SA animated water | two RDRAM dumps 50 frames apart in Park (`sa_niff/dumps/park4/5.bin`) | river vertex copy t +1000 = 20/frame, as the UV-track record predicts |
| SA battle maps | all 22 maps rendered with baked lights; 4 compared with reference shots at the game camera (`sa_niff/renders/battle_all/`) | geometry and camera coincide (mean diff 22.5–38.3, remainder = characters, blocks, objects) |
| SA first story area | map NIFF 177 at the captured camera vs screenshot (`sa_niff/renders/story2223_res177_gamecam_vs_emu.png`) | floor, bars and walls coincide |
| SA soft-block model | RDRAM resource cache walk + segment-4 bases (`sa_stage/objmap.py`) | object id 25 → NIFF 586 at placement + (50, 0, 50) |
| BM64 adventure selection | RAM scene/world/stage variables and screenshots after selecting Green Garden 1 and White Glacier 1 (`bm64_stage/shots/`, `dumps/rdram_gg1_ovl28.bin`, `rd_wg58.bin`) | 0x28 (world 0, stage 0, title card "Untouchable Treasure"); 0x58 (world 3, stage 0) |
| BM64 Field of Grass | stage select position 6 → RAM (`bm64_stage/dumps/rd_fog95.bin`) | overlay 0x95, map 529, TEXRECT background from 662 |
| BM64 fog formula | frame list in Blizzard Peaks vs `setFog(945, 970, 230, 240, 255)` | fm 5120, fo −4556, SETFOGCOLOR E6F0FF80, clear 0xE7BF: as predicted |
| BM64 map placement | object pool in RAM; map asset in RAM vs file | map 578 at origin, byte-identical; prop records match overlay data floats |
| Hero names | label sprite files decoded and read; stage-index table 0x80106DA0 disassembled | full named list (4.3) |
| Hero all maps decode | `hero_level/render_all_maps.ts` | 102/102 map files render, 0 failures (`renders/maps/contact_sheet.png`) |
| Hero fog formula | stage-select table patch to Fog Route; frame list from RDRAM; fogged render vs screenshot (`verify/`) | BC fog word fm 2560 / fo −2304 and colour DCE1E6 as predicted; map-only fog; render diff 20.6 (fog) vs 37.6 (no fog) |
| SA fog formula | warp to area 2101 at `gamesceneSetup`; frame lists from RDRAM (`verify/sa/`) | DB08 fm 3282 / fo −3026 and colour 000F2E as predicted; fog render modes active; objects fogged |

### 8.3 Sample extractions

- **Texture sheets:**
  - `bm64_model/renders/gg1_decode_textures.png`, `rockgarden_decode_textures.png`, `intro315_textures.png`, `sheet_bomber_banks_74_77.png`
  - `sa_niff/renders/sheet_17.png`, `sheet_stages_17_19_21_23.png`, `sheet_ram_normal.png`
  - `hero_level/renders/s0map_textures.png`, `sheet_areaselect.png`
- **Geometry renders:**
  - `bm64_model/renders/battle_overviews_montage.png` (all 10 BM64 battle maps), `gg1_decode_overview.png`, `rockgarden_decode_overview.png`
  - `hero_level/renders/s0map_lit_top.png`, `bm64_model/renders/hero_1_1_container_overview.png`
  - `hero_level/renders/maps/contact_sheet.png`: all 102 distinct Hero map files (0 decode failures)
  - `hero_level/renders/names/labels_all.png`: Hero area/map name labels
  - `sa_niff/renders/area2057_models_overview.png`, `test_17_top.png`
- **Songs:** `audio/wav/`: 10 WAVs (section 6.7).
- **Extracted files:** `bm64fs/files/`, `bm64safs/files/`, `herofs/files/`, each with an `index.txt`.

## 9. Open questions and hypotheses

Everything here is **unverified**. Verified facts are in sections 1–8 and 10.

**All games / viewer**
- The lighting bake is verified for BM64 and SA (world-space directions); for Hero it is assumed to be the same.
  About 3–5% residual over-brightness (hypothesis: RSP fixed-point rounding / emulator filtering).
- Fog-alpha blending of BM64 translucent objects (blend factor = SETFOGCOLOR alpha) has no equivalent in `Batch`;
  per-batch alpha is the proposed approximation. The SA combiner fold (5.3.3) is verified for 99.6% of
  triangles; the ~410 lerp-combiner triangles are not handled.
- SA billboard objects (kind 3) and environment-mapped lists (BM64 type 8, SA G_TEXTURE_GEN): the exact texgen
  formula is not modelled.

**Bomberman 64**
- Names of worlds 4/5 (Black Fortress, Rainbow Palace) by elimination only; which stages are bosses (inferred from
  music and structure); Blue Resort area 0x3D shared by stages 1 and 3; entry param → spawn point mapping.
- Prop placement has no single data format: positions come from overlay code and data records (verified for Green
  Garden 1 only). Meaning of attribute-cell codes beyond prop kinds; layer ↔ height.
- The map-part flag 0x60 path (Black Fortress, Trap Tower parts).
- Blue Resort's water (animated?) was not captured. The per-band texture-offset formula of the `setBackground`
  backdrop is unknown.
- Which stages register UV scrolls and at what speeds (code call sites known, none active in captures);
  texture-bank animation frame durations; meaning of record types 2, 3, 7.
- In-game meaning of the battle unlock flags (world 5 stage 3; a 120-item counter, probably Gold Cards).
- The seg2 lists at 0x802A2A40 as an ending/credits scene tour.

**The Second Attack**
- Battle unlock rule (exec 0x1C); purpose of rows 5–6 of the battle table.
- Default camera without a record: which angle component is pitch.
- Which NIFF each object id (class 1/4 placements) draws, except id 25 → 586. Also: play order of areas within a
  world; world-name index equals world index (order match only).
- UV-scroll speeds on maps other than Park; deform tracks (shape+52, class 4); normals of rotated objects in the bake;
  texture-set selection for characters.
- Class-3 animation channel semantics, class 4/5 data, NIFF header +0x14; 52-byte collision polygon layout.

**Hero**
- Only stages 1-1 and 18 (Fog Route) were loaded in the emulator; the other maps are verified by static decode
  only. Fog mode 1 (no stage uses it) was not observed.
- Whether the backdrop picture scrolls with the camera.
- Scale source of some object classes (switch 0.9); MAPWOOD's Y offset; a placement-record-driven render of 1-1.
- Lighting bake: F3DEX 1.x light-direction transform, alpha, combiner; Bomberman's material looks wrong in the replay.
- Which label slot the select screen shows per area (name mapping by area order is consistent with every count
  and boss position, but the index was not traced); info-record fields +3/+4/+5/+8/+0x20/+0x30/+0x34.

**Music**
- Voice limits of BM64/Hero (16 assumed) and voice stealing; which reverb BM64 and Hero use; the exact volume
  formula and live controller updates; vibrato scaling and delay (6.6).
- Names of BM64 and SA songs (no sound test); screens of several code-referenced songs.
- SA event scripts (`evexecAudio`) that also start songs; the unused-song lists depend on them.

## 10. Unused and hidden content

Source: `notes/unused.md` (tools and string dumps in `/home/n64/.ai-tmp/r49/bm/unused/`). "Static" means
disassembly and cross-references: `xref.py` resolves jal targets, lui/addiu pairs and data words over main code
and every overlay. Indices computed at run time (base + k, SA event scripts) are not resolved, so
file-level results are **candidates** unless marked high confidence.

### 10.1 Bomberman Hero

| Finding | Where | Evidence | Confidence |
|---|---|---|---|
| **MASTER DEBUG menu**: pages [MAIN MENU] (timer bar, debug display mode, no damage, no attribute, G button debug, bomb/fire level, disptype), [LIGHT EDIT] (ambient/diffuse RGB, light direction), [FOG EDIT] (fog RGB, min/max, z far) | strings ROM 0x126754.. (VRAM = ROM + 0x8000DAE0); opener 0x800242F0; dispatcher 0x800FF7B4 on s8 0x8016E3EC (100/101/102) | The pause handler opens it on **L** only if s8 **0x8016E424 ≠ 0**. Retail code only clears that byte at boot or rewrites 1 → 1; no overlay or blob references it. **Emulator:** after `write 0x8016E424 1`, pause + L drew all three pages (`unused/shots/hero_master_debug_page100_main_menu.png`, `_page101.png`, `_page102.png`). The same flag enables Z+START and Z+L combos (hypothesis: warp/clear helpers). | verified |
| **[BOMBERMAN ACTION MENU]** boot scene selector: GAME START, MAP NUMBER, MAP TEST, CAMERA TYPE, TITLE TEST, ENTRY EDIT, MUSIC/SOUND NUMBER, DEMO, SHOCK TEST | draw 0x800FDD48, installer 0x800FE898, seg1 main loop 0x80001A74 (jump table 0x8004BA74) | Breakpoints on its installer, draw and input code never hit from power-on through the attract demo, title and file select. How retail bypasses it was not traced. | medium |
| BACKUP MEMORY TEST screen (Pak/EEPROM write/read) | 0x80020844 | no jal, pointer or data reference anywhere | high (static) |
| SHOCK TEST screen and object SET/RESET/SAVE placement editor | 0x80020F18; 0x8002E8B4 / 0x8002EB58 / 0x8002EF00 | reachable only from the debug scene selector | medium |
| 6 map files only loadable through ACTION MENU "DEMO" modes 2–4/6–8 | chain files 40–45: 0x5DBEE0, 0x5DE0B0, 0x5E6E70, 0x5E9120, 0x5F0C90, 0x5F29E0 (map-record tables 0x80100720, 0x80100A90, 0x80100E00) | retail calls the loader only with modes 0, 1, 5; nothing else references the files | medium |
| 8 "64" containers never loaded; #586 is a byte-identical copy of #585, #412–414 are near-identical variants of one small model | ROM 0x9971C0, 0x997850, 0x9979C0, 0x997FC0, 0x9AEE10, 0x9EBD80, 0x9F85D0, 0x9F9A80 | no reference as a load start (five appear only as the end offset of the previous file's pair) | high (static) |
| Hidden planet 6 **"Gossick Star"** (Outer Road, Inner Road, Vs. ????; stage indices 102/163, 103, 85/164) | label sprite file #969; selection table 0x80106DA0 | named and selectable in the data but absent from the Score screen; the unlock condition was not traced | verified in data; unlock unknown |
| Stage entries with real map data that the selection table never reaches: 43, 73, 84 (planet byte 5, area 2), 101, 110, 111, 112 (planet 6, areas 2–3; several reuse Planet 1/3 files) | info/file records | not indexed by 0x80106DA0 and no labels | verified (static) |
| Stage-record slots 8 (0x8010744C) and 106 (0x80108214), small maps reached only by filler stage indices ≥ 105; placeholder stage indices (section 4.3) | 0x80108238 table | static | medium |
| Placeholder item classes NAME_ITMDUMMY9..15 | ROM 0x118858.. | names only | hypothesis |

All 32 Hero songs are used (section 6.7). No Japanese text or build date was found in Hero.

### 10.2 Bomberman 64

| Finding | Where | Evidence | Confidence |
|---|---|---|---|
| "*** MAP INFORMATION ***" debug printer (offset, layer, size) | function 0x8026ECF4, strings 0x802A3B74 | no caller in main code or any of the 95 overlays | high (static) |
| "debmap0" test-map overlays (strings "debmap0 : Mapchange happened!" etc.) | overlay ids 0x14–0x17 = archive 0x120000 files 1–4; asset 835 is loaded only by 0x16 | No scene change targets 0x15–0x17, and only 0x16 → 0x14 exists. At power-on the next-scene variable reads 0x14, but the loader log from power-on (bm64fs/dbgdrive.log: first loads 0x20, 0x1B, …) never loads 0x14–0x17. | medium |
| 12 overlay ids with no file | 0x18, 0x7A, 0x7D, 0x9C–0xA4 (id table ROM 0x30800) | the archive directories don't list them | high |
| Area overlays with no incoming scene change | 0x5D (map 553), 0x9B (map 563, "request resource %d") | scene-change scan | medium |
| 23 asset indices never used as constants | 143, 173, 181, 215, 311, 362, 605, 612, 614, 615, 621, 625, 628, 641, 645–647, 756, 778, 785, 833, 839, 842 | Constant scan only; 143 is in fact loaded in Green Garden stage 1 (bm64_model §5), so indices are also computed at run time | low |
| Unused music candidates: songs 0, 9, 23, 25, 34, 36, 37, 41, 43 (identical short cues), 17/39/40 (three near-identical versions of one full looping song), 30, 38; music banks 1 and 2 | music blob (section 6) | no code reference found | low–medium |
| Leftover text: "move.c" source name, EEPROM revision error, sched.c asserts, "trap task:entry failed" (13 overlays), build date "SAT SEP  6 14:57:59 JST 1997" (ROM 0xBD500) | main code, overlays | strings | high (presence) |

Locked but not unused: battle stages 7–10 (In the Gutter, Sea Sick, Blizzard Battle, Lost at Sea) are in the
stage-select name table but hidden on a new save. Code unlocks 7–8 with save flag 2 and 9–10 with save flag 1
(section 4.1).

### 10.3 Bomberman 64: The Second Attack!

| Finding | Where | Evidence | Confidence |
|---|---|---|---|
| Debug printing compiled out: `osSyncPrintf` and `dprintf` are empty; calls that printed "RESKEY2=", "Castle=", "KingWarp=", "BOSS : INIT" print nothing. Host file-write code (fwrite → dmaWrite) is only reachable through a ZeroJump table. Source names remain: rpmapobj.c, blast.c, ndeval.c, dpm.c | 0x80000FA0, 0x80047FEC, 0x80001824 | disassembly | high |
| Japanese text in the US ROM: menu/system strings "爆ボンバーマン２", ストーリーモード, バトルモード, カスタムボンバー, オプション, ゲームオーバー, コンティニュー, はい いいえ (res 2030); battle names 破壊王, 宝探し (res 2032); result captions "Ｐの優勝。" / "チームの優勝。" | res 2030, 2032; main VRAM 0x800958FC (pointer table 0x8008FB38) | The strings are present; the US menus show English, so they are hypothesised unused | high (presence), hypothesis (unused) |
| Unreferenced scene descriptors: 2067 and 2079 (battle-style slots with 4 player starts and no model); 2231 (variant of world-0 room 2217/2227); 2056 (tiny scene, map NIFF 15) | resources | not referenced by code, execs or data; not in the battle table | high / medium / hypothesis (2056) |
| Battle table rows 5–6 (0x8008FF44) hold 16 story-area descriptors with no name-table rows, plus 2206 at 0x80090024 | main data | the battle menu cannot select them | hypothesis |
| Dangling exec ids 0x63/0x64; 46 placeholder resources of 1,000 spaces; resource 2 (64 KB zeros); resource 3060 (size 0); unread ROM block 0xFE800–0xFF000 | section 3 | static | high |
| Weak unused music candidates: songs 26, 27, 34–37, 39–41, 55, 56, 58, 61, 62, 64, 65, 68, 71–73 | music blob | no static reference; event scripts not parsed | low |

Not done: a visual pass over textures for baked-in Japanese text or placeholders, unused sound effects, and SA
event-script parsing.
