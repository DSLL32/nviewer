# Bomberman 64: The Second Attack! — Nintendo 64 ROM format specification

This manual describes the shipped data formats needed to identify, extract, and
present Bomberman 64: The Second Attack! content. Claims state their evidence inline; unsupported
interpretations are labelled hypotheses.

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | Indexed resource block with 3,134 files and executable overlays. |
| Compression | Hudson LZSS and Yay0. |
| Graphics microcode | F3DEX2 with S2DEX for 2D. |
| Geometry | NIFF scenes and object models. |
| Textures | NIFF materials using RDP-native texel and palette formats. |
| Collision | Dedicated collision companion files. |
| Music driver | libultra `alCSPlayer`. |
| Audio microcode | libultra `aspMain` ABI1. |
| Sample encoding | Nintendo VADPCM. |
| Levels | Story areas and battle stages. |
| Memory requirement | Expansion Pak usage. |
| Viewer support | USA revision 0. |

### 1.2 ROM identification

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| USA | `BOMBERMAN64U2` | `NBVE` | 0 | 16 MiB (`0x1000000`) | `237E73B4` | `D63B6B37` | `66b1fd763793ecc6e03aa6c5d023df8de5351b9e` | CIC-6102 | — |

Verified from the normalized ROM headers and complete-image SHA-1 hashes.

### 1.3 Terminology and conventions

ROM and memory ranges are half-open. Offsets, addresses, encoded sizes, masks,
and opcodes are hexadecimal unless stated otherwise. Multi-byte CPU fields are
big-endian. RAM addresses are virtual unless explicitly identified as physical;
segmented, VROM, and file-relative addresses are named at each use.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

#### Boot and code

All three are Hudson Soft games built on the same in-house kernel design. Boot code is uncompressed and
copied by IPL3. Cross-segment calls go through a "ZeroJump" stub: the caller does `jr` to a
TLB-mapped virtual address and passes `t0 = (table << 8) | function`; the stub looks the target up in
a table of tables. None of this matters for asset extraction except that code addresses in overlays are
position-dependent.

#### Bomberman 64: The Second Attack! (verified: disassembly + RDRAM dump compare)

| ROM | VRAM | Contents |
|---|---|---|
| 0x1000–0x98510 | 0x80000400–0x80097910 | main code + data, uncompressed; BSS 0x80097910–0x800B04F0 |
| 0x98510–0x98640 | phys 0x1D0000, virtual 0x10000000 | ZeroJump stub |
| 0xFF000 (0x1000) | 0x800EF250 | exec (overlay) id table, 2 bytes per id: block ROM = `hi << 17 \| lo << 11` |
| 0x100000–0x270702 | TLB-mapped | 39 LZSS "exec" overlays linked at 0x40000000–0x45000000 or 0x60000000, backed by 8 KB pages from 0x80250000–0x802D0000 |
| 0x280000–0x28F5A0 | (0x803E0000) | Function-name table with 2,645 entries (header and record layouts below); `namePtr - 0x803E0000 + 0x280000` = ROM offset of the name |
| 0x2A0000–0xFE2E32 | heap | resource block "block 21" (3,134 files) |

Function-name table header, eight bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | tag | 0x10000000. |
| 0x04 | 4 | u32 | names | 0x803E52C0. |
| 0x08 | 2645 × 8 | entry[] | entries | Function-name records. |

Function-name record, eight bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | address | Function address. |
| 0x04 | 4 | u32 | namePtr | Name pointer in the 0x803E0000 image. |

- 0x80000698 dmaRead(vaddr, len, romOffset) wraps osPiStartDma.
- `0x800024C0 fexecLoadAddress(execId, vaddr)`: id → block → directory (file 0) → file with the SA exec header defined under File payloads, decoded into `vaddr`, then called; each exec returns its function table.
  `moduleLoadRP 0x800516BC` maps slots 0–6 at `0x40000000 + (slot << 24)`; `moduleLoad 0x800517A4` uses
  0x60000000.
- RSP microcode: "F3DEX.NoN fifo 2.08" (F3DEX2 family) and "S2DEX fifo 2.08"; audio: libultra aspMain (ABI1).
- The function-name table makes the code very readable; a sorted dump is in
  `bm/bm64safs/symbols.txt`.

### 2.2 Memory and address mapping

### 2.3 ROM map and asset organization

### 2.4 Compression formats

#### File payloads

| Game | Payload | Codec selection |
|---|---|---|
| BM64 asset / overlay | `u32 BE decompressedSize` + LZSS stream | always LZSS, except 7 raw assets: 32 (music "S2" blob), 33 (SFX "T2" blob), 71, 72, 220, 221, 267 |
| SA resource | `u32 BE decompressedSize` + payload | if the u32 at +4 is `Yay0` (0x59617930): Yay0 image starting at +4; else LZSS stream from +4 |
| SA exec | Eight-byte exec header below, followed by LZSS data | LZSS |

SA exec header, eight bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | codeSize | Decoded executable byte count. |
| 0x04 | 4 | u32 | bssSize | BSS byte count. |
| 0x08 | Variable | u8[] | stream | LZSS executable payload. |

SA exceptions: resources 0 (music blob, "S2") and 1 (SFX blob, "T3") are raw and used by ROM address;
resource 2 is 64 KB of zeros; 46 resources (2527–2540, 2562–2573, 2595–2605, 2621–2629) are
`u32 1000` + 1,000 spaces, stored; resource 3060 has size 0. Counts: Yay0 1,558, LZSS 1,527, stored 46, raw 3.

For BM64 there is no codec flag: the extractor detects raw files as those where LZSS decoding does not
consume exactly the entry (0 or 1 byte of padding allowed). A viewer only needs the indices above.

#### LZSS, 1,024-byte ring (identical in BM64 and SA)

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

#### Yay0 (SA only)

Standard Nintendo Yay0, decoder slidstart 0x80073F10:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u8[4] | magic | Yay0. |
| 0x04 | 4 | u32 | decompressedSize | Output length. |
| 0x08 | 4 | u32 | linkTableOffset | Offset of back-reference halfwords. |
| 0x0C | 4 | u32 | chunkOffset | Offset of literal/extended-length bytes. |
| 0x10 | Variable | u32[] | flags | Read most-significant bit first. |

A set flag copies one chunk byte. A clear flag consumes this two-byte link:

| Bits | Mask | Field | Meaning |
|---:|---:|---|---|
| 15–12 | 0xF000 | lengthCode | Nonzero: length = code + 2. Zero: consume a chunk byte and add 18. |
| 11–0 | 0x0FFF | distanceMinus1 | Copy from output minus this value minus one. |

Copy references one byte at a time to allow overlap. Stop after decompressedSize output bytes.

Offsets are relative to the `Yay0` magic (i.e. SA file offset 4). Verified: resource 13 dumped from
RDRAM, byte-identical.

#### Extracting everything

Reference extractors (Python 3, no dependencies):
- Hero: `bm/herofs/extract.py` → `files/` (chain files, overlays, raw blobs), `files/index.txt` with static references per file
- BM64: `bm/bm64fs/extract.py` (+ `lz.py`) → `files/a{ARCHIVE}/{idx}.bin`, `files/index.txt`
- SA: `bm/bm64safs/extract.py` → `files/res/NNNN.bin`, `files/exec/`, `files/index.txt` (7 s)

### 2.5 Loading process

### 2.6 Revision differences

## 3. Level data

### 3.1 Level catalog and identifiers

#### Bomberman 64: The Second Attack!

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

### 3.2 Level container

#### Archive format (Bomberman 64 and The Second Attack share the design)

An archive sits at a ROM offset on a 0x800 boundary:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | dataOffset | BM64 0x2008; SA 0x8008. |
| 0x04 | 4 | u32 | capacity | BM64 0x400; SA 0x1000. |
| 0x08 | 8 × capacity | entry[] | entries | Eight-byte directory entries below. |
| dataOffset | Variable | u8[] | fileData | Files contiguous in index order. |

Directory entry, eight bytes; both fields 0xFFFFFFFF mark an unused slot:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | offset | Relative to archive + dataOffset. |
| 0x04 | 4 | u32 | size | Stored file size. |

The games read the table in pages of 256 entries (0x800 bytes) and file data through a small cache
(BM64 1 KB, SA 2 KB), which is why individual PI DMAs look like page reads.

In overlay archives, file 0 is a raw directory:

| Order | Count | Type | Field | Description |
|---:|---:|---|---|---|
| 1 | 1 | `u8` | `count` | Declared entry count. |
| 2 | count | directoryEntry | entries | Three-byte records below. |

Overlay-directory entry, three bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | u16 | overlayId | Overlay identifier. |
| 0x02 | 1 | u8 | fileIndex | Archive file index. |

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

#### Common conclusions

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

#### Bomberman 64: The Second Attack! (NIFF)

Source: `notes/sa_niff.md`; annotated disassembly of the model library (0x8000C540–0x80016BE0) in
`sa_niff/nd.dis`; TypeScript decoder `sa_niff/niff.ts` + `dl_bm.ts`.

##### Header (version 0x05000100; also 0x04020100 with the same layout)

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u8[4] | magic | ASCII niff. |
| 0x04 | 4 | u32 | version | version |
| 0x08 | 4 | u32 | flags | 0x00020000 in the file; bit 31 is set after relocation |
| 0x0C | 4 | u32 | fileSize | file size |
| 0x10 | 4 | u32 | scene | scene record (always 0 in this game) |
| 0x14 | 4 | f32 | unknown_14 | 10.0 in models, 1.0 in texture sets (unknown) |
| 0x18 | 16 | u32[4] | texelSegments | default bases of segments 5..8 (texel areas) |
| 0x28 | 16 | u32[4] | paletteSegments | default bases of segments 9..12 (palette areas) |
| 0x38 | 4 | u32 | objects | File-relative pointer to the objects record-pointer table. |
| 0x3C | 4 | u32 | shapes | File-relative pointer to the shapes record-pointer table. |
| 0x40 | 4 | u32 | textures | File-relative pointer to the textures record-pointer table. |
| 0x44 | 4 | u32 | animations | File-relative pointer to the animations record-pointer table. |
| 0x48 | 4 | u32 | class4 | File-relative pointer to the class4 record-pointer table. |
| 0x54 | 4 | u32 | class5Table | class 5 table |
| 0x58 | 2 | u16 | objectCount | Corresponding record-table count. |
| 0x5A | 2 | u16 | shapeCount | Corresponding record-table count. |
| 0x5C | 2 | u16 | textureCount | Corresponding record-table count. |
| 0x5E | 2 | u16 | animationCount | Corresponding record-table count. |
| 0x60 | 2 | u16 | class4Count | Corresponding record-table count. |
| 0x62 | 2 | u16 | reserved62 | Always zero. |
| 0x64 | 2 | u16 | reserved64 | Always zero. |
| 0x66 | 2 | u16 | class5Count | Corresponding record-table count. |

All pointers are file offsets. `ndResLinkAbs` (0x800133BC) adds the load address to every pointer field.
Texture-record image/palette offsets are relative to the header's segment bases, **not** to the file.

##### Records

**Object node** (72 bytes):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | `u16` | `kind` | 1 group, 2 shape node, 3 billboard. |
| `0x04` | 4 | `u32` | `flags` | `(flags >> 8) & 15` is the draw layer. |
| `0x08` | 12 | `f32[3]` | `translation` | Translation. |
| `0x14` | 12 | `f32[3]` | `rotation` | Radians. |
| `0x20` | 12 | `f32[3]` | `scale` | Scale. |
| `0x2C` | 2 | `s16` | `shapeIndex` | −1 means none. |
| `0x34` | 2 | `s16` | `animationIndex` | Animation index. |
| `0x38` | 4 | `u32` | `rotationOrder` | Axis codes from low to high byte; 1 X, 2 Y, 3 Z. Shape nodes use `0x020103`. |
| `0x3C` | 2 | `u16` | `childCount` | Number of child offsets. |
| `0x40` | 4 | `ptr` | `children` | `s16` child offsets relative to this object's index. |

The game instantiates object 0 and all descendants. With row vectors,
`World = S · R_hi · R_mid · R_lo · T · ParentWorld`. R_lo is the axis in the lowest byte of the order code, so
0x020103 rotates about Y, then X, then Z; the rotations are standard right-handed ones. Row-major storage of this
row-vector matrix equals the viewer's column-major `Instance.matrix`.

**Shape** (80 bytes):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `ptr` | `displayList` | Display-list start. |
| `0x04` | 4 | `ptr` | `vertices` | Vertex array. |
| `0x08` | 2 | `u16` | `vertexCount` | Vertex count. |
| `0x0A` | 2 | `u16` | `vertexSegment` | Always 4. |
| `0x0C` | 16 | `ptr[4]` | `imageBases` | Segment 5–8 bases. |
| `0x1C` | 16 | `ptr[4]` | `paletteBases` | Segment 9–12 bases. |
| `0x2C` | 2 | `u16` | `imageSegment` | 5. |
| `0x2E` | 2 | `u16` | `paletteSegment` | 9. |
| 0x30 | 4 | u32 | vertexGroups | File-relative pointer to four-byte vertex-group records below. |
| 0x38 | 4 | u32 | uvTracks | File-relative pointer to eight-byte UV-track records below. |
| 0x3C | 2 | u16 | uvTrackCount | UV-track count. |
| `0x3E` | 12 | `s16[6]` | `bounds` | Bounding box used by `G_CULLDL`. |

| Vertex offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 6 | `s16[3]` | `position` | X, Y, Z. |
| `0x06` | 2 | `u16` | `flag` | Vertex flag. |
| `0x08` | 4 | `s16[2]` | `texcoord` | S, T. |
| `0x0C` | 4 | `u8[4]` | `colorOrNormal` | RGBA, or signed normal components in RGB when lit. |

**Texture record (0x18 bytes).** Image/palette offsets are relative to their segment bases.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | u16 | type | 2 = CI with RGBA16 TLUT; 0 = RGBA |
| 0x02 | 1 | u8 | logSize | 0 = 4 bpp through 3 = 32 bpp |
| 0x03 | 1 | u8 | unknown_03 | Unresolved |
| 0x04 | 2 | u16 | width | Image width |
| 0x06 | 2 | u16 | height | Image height |
| 0x08 | 2 | u8[2] | unknown_08 | Unresolved |
| 0x0A | 2 | u16 | paletteCount | Palette entries |
| 0x0C | 4 | u32 | paletteOffset | Palette segment offset |
| 0x10 | 4 | u32 | imageOffset | Image segment offset |
| 0x14 | 2 | u8[2] | unknown_14 | Unresolved |
| 0x16 | 1 | u8 | imageSegment | Image segment number |
| 0x17 | 1 | u8 | paletteSegment | Palette segment number |

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

##### Display lists and textures

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
  - Shapes with nonzero vertexGroups and uvTrackCount are cloned by
    `ndAttachAnimation` (0x80011C14).
  - Each frame the game copies the vertices into the gfx heap and adds per-group offsets. With T = frame count:
    - `ds = (sLin·T)·2 [+ sin((sFreq·T & 0x3FF)·2π/1023)·sAmp·8] & MASK[masks >> 4]`
    - `dt = (tLin·T)·2 [+ sin((tFreq·T & 0x3FF)·2π/1023 + PHASE[phaseIdx])·tAmp·8] & MASK[masks & 15]`
  - UV-track records are:

    | Offset | Size | Type | Field | Description |
    |---:|---:|---|---|---|
    | 0x00 | 1 | s8 | sLin | — |
    | 0x01 | 1 | s8 | tLin | — |
    | 0x02 | 1 | u8 | sAmp | — |
    | 0x03 | 1 | u8 | tAmp | — |
    | 0x04 | 1 | u8 | sFreq | — |
    | 0x05 | 1 | u8 | tFreq | — |
    | 0x06 | 1 | u8 | phaseIdx | — |
    | 0x07 | 1 | u8 | masks | — |

  - MASK (0x8008EC74) = {0, 0x7F, 0xFF, 0x1FF, 0x3FF, 0x7FF, 0xFFF, 0}; PHASE (0x8008EC84) = f32 {0, π/16, π/8, …}.
  - The vertexGroups list uses four-byte records:

    | Offset | Size | Type | Field | Description |
    |---:|---:|---|---|---|
    | 0x00 | 2 | s16 | deformIdx | — |
    | 0x02 | 2 | s16 | group | — |
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

##### Render mode comes from the object's draw layer, not the list

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

##### Lighting

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

##### Units and placement

Vertex units are world units. A battle map is entered with `obj2APIEntry(res, 29, 0)` with identity transform.
The Normal map spans x 0..1300, z 0..1100, floor y 0..100, and its descriptor's placements use the same space
(player starts at (0|1200, 0, 0|1000), soft blocks on a 100-unit grid, randomised per round).

##### Verification

- `sa_niff/renders/battle2058_res17_gamecam_vs_emu.png`: Normal map rendered at the game camera (fovy 10, target
  (650, 0, 500), eye (650, 4979, 4678)), scale 1, not mirrored, culling on, versus the emulator frame. The crate
  grid, floor grates and back wall coincide; differences are the players, the random soft blocks and lighting.
  The arena is nearly symmetric, so handedness rests on the camera matrix (positive determinant, +X = screen right).
- Texture sheets: `sa_niff/renders/sheet_stages_17_19_21_23.png` (the four battle maps), `sheet_ram_normal.png`.

##### Levels: scene descriptor and companion resources (static from code, checked against all data files)

**Scene descriptor** (resources 2056–2237 except the camera files 2054/2055). Loaded by `gamesceneSetupBattle`
0x8002D5C4 / `gamesceneSetup` 0x8002E0C4. Size = 16 + 32·nKinds + 76·nObjects for all 182 files.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `+0x00` | 4 | `u32` | `mapModelRes` | map NIFF → obj2APIEntry(res, 29, 0): identity transform (verified in RAM) |
| `+0x04` | 4 | `u32` | `attrRes` | collision/attribute file (−1 = none) |
| `+0x08` | 4 | `u32` | `nKinds` | 32-byte kind records at +0x10 |
| `+0x0C` | 4 | `u32` | `nObjects` | 76-byte placement records after the kinds |

Kind record (32 bytes):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | class | class: 0 event trigger, 1 map object (moving/animated, behaviour in "RP" overlays), 3 player start / exit, 4 destructible block or prop with a box |
| 0x04 | 4 | u32 | flags | flags; bit 0 on class 4 = member of the random soft-block pool |
| 0x08 | 12 | f32[3] | boxSize | Box size XYZ; object position = placement position + half size |
| 0x14 | 4 | u32 | id | class 0: event id (overlay `0x8008F5F0[id / 100]` = exec 0x22–0x2B, sub-event `id % 100`); class 3: player index (battle) or entrance id (story); class 1/4: object id |
| 0x18 | 4 | u32 | destinationEntrance | class 3: entrance id in the destination area |
| 0x1C | 4 | u32 | destinationArea | class 3: destination area descriptor (story) |

Placement record (76 bytes):

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | kind | kind index |
| 0x04 | 12 | f32[3] | position | Position XYZ in world units |
| 0x10 | 4 | u32 | subtype | sub-type |
| 0x18 | 4 | u32 | spawnCondition | low 16 bits: spawn condition mode (1 = only for entrance +0x1C, 2 = game-flag test); bits 16–18: **Y rotation code** 0→0°, 1→90°, 2→180°, 3→225°, 4→270°, 5→315°, 6→135°, 7→45° |
| 0x1C | 4 | u32 | conditionValue | condition value / flag number (bit 31 = negated) |
| 0x20 | 4 | u32 | initialState | initial state (−1 none) |
| 0x24 | 4 | u32 | flags | flags |
| 0x38 | 20 | u32[5] | linkedPlacements | linked placement indices (−1 none) |

Which NIFF each class 1/4 object id draws is decided by the resource-program overlays. Only a few ids are
resolved; for example soft block id 25 → NIFF 586 (5.3.10). A viewer can show the map NIFF plus placement markers
(or the known models). Soft blocks are chosen at random per round (area-info count), so the data holds every
candidate position.

**Area-info file** (res 2036 + world; 2045 in battle) uses variable records:

| Order | Count | Type | Field | Description |
|---:|---:|---|---|---|
| 1 | 1 | u32 | areaRes | Area resource. |
| 2 | 1 | u32 | envRes | −1 means none. |
| 3 | 1 | u32 | softBlockCount | Soft-block count. |
| 4 | 1 | u32 | nSP | Number of following SP records. |
| 5 | nSP | u32[2] | sp | SP records; individual word meanings unknown. |
| 6 | 1 | u32 | nItemSets | Item-set count. |
| 7 | nItemSets | ItemSet | itemSets | Variable-sized item-set records below. |

Item-set record, 16-byte header plus counted items:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | a | Unknown. |
| 0x04 | 4 | u32 | b | Unknown. |
| 0x08 | 4 | u32 | c | Unknown. |
| 0x0C | 4 | u32 | count | Item count. |
| 0x10 | 8 × count | item[] | items | Item records. |

Item record, eight bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | id | Item identifier. |
| 0x04 | 4 | u32 | weight | Selection weight. |

Records are terminated by areaRes 0. The matching record's environment becomes the current scene. Then
`obj2SetFog(env+0x230 & 1, u16 env+0x60, 1000, u32 env+0x64)` and `rspSetClearColor(env[0x58..0x5A])` run.

**Environment record** (res 2238–2298, 3120–3132, 0x234 bytes) = a raw copy of the renderer's scene buffer
(verified: RAM equals the file except runtime light bytes). Defaults when absent: fovy 30, near 200, far 8000,
ambient 127, light colour 255.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | s16 | viewportY0 | viewport y0 |
| 0x02 | 2 | s16 | viewportY1 | viewport y1 |
| 0x04 | 2 | s16 | viewportX0 | viewport x0 |
| 0x06 | 2 | s16 | viewportX1 | viewport x1 |
| 0x58 | 4 | u32 | clearColor | clear colour RGBA |
| 0x60 | 2 | u16 | fogMin | Fog minimum |
| 0x62 | 2 | u16 | fogMax | Fog maximum; set to 1000 when fog is enabled |
| 0x64 | 4 | u32 | fogColor | fog colour RGBA |
| 0x6C | 4 | f32 | fovy | Vertical field of view; not used for the level projection |
| 0x70 | 4 | f32 | aspect | Aspect ratio; not used for the level projection |
| 0x7C | 2 | s16 | near | Near field |
| 0x7E | 2 | s16 | far | Far field; the level projection uses 8000 instead |
| 0x9C | 0x188 | Light[7] | lights | Seven 0x38-byte light slots; known fields below |
| 0x224 | 3 | u8[3] | ambient | ambient colour |
| 0x22E | 2 | u16 | lightCount | light count |
| 0x230 | 4 | u32 | flags | bit 0 = fog enable |

Light slot, stride 0x38. The field types are corroborated by the implemented parser in src/rom/bomberman/niff.ts; enabled-light shading is verified against RAM and frames above.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | u16 | flags | 0x8000 enabled; bit 0 point, bit 1 distance fade, bit 2 spot. |
| 0x02 | 10 | u8[10] | unknown_02 | Not interpreted. |
| 0x0C | 3 | u8[3] | color | RGB. |
| 0x0F | 1 | u8 | unknown_0F | Not interpreted. |
| 0x10 | 12 | f32[3] | direction | Directional or spotlight XYZ direction. |
| 0x1C | 12 | f32[3] | position | Point-light XYZ position. |
| 0x28 | 4 | f32 | near | Distance-fade near bound. |
| 0x2C | 4 | f32 | far | Distance-fade far bound. |
| 0x30 | 4 | f32 | cutoff | Spotlight cutoff. |
| 0x34 | 4 | f32 | exponent | Spotlight exponent. |

**Camera records** (res 2046–2053 story, 2055 battle) begin with `u32 count`, followed by 52-byte entries:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `u32` | `area` | Area identifier. |
| `0x04` | 4 | `s32` | `entrance` | −1 matches any entrance. |
| `0x08` | 4 | `f32` | `yaw` | Degrees. |
| `0x0C` | 4 | `f32` | `pitch` | Degrees. |
| `0x10` | 4 | `f32` | `distance` | Camera distance. |
| `0x14` | 12 | `f32[3]` | `lookAt` | Look-at point. |
| `0x20` | 12 | `f32[3]` | `secondPoint` | Second point. |
| `0x2C` | 4 | `f32` | `fovY` | Degrees. |
| `0x30` | 4 | `u32` | `mode` | 2 fixed, 0 follow. |

Verified: the Normal projection × view decomposes exactly to its
record (yaw 0, pitch 50°, distance 6500, look-at (650, 0, 500), eye (650, 4979, 4678), fovy 10). This is a
ready-made initial viewer camera for battle stages.

**Collision file** (descriptor +0x04): bounds plus a grid of 52-byte polygons; used for hit tests and to clamp
the follow camera; not drawn by the game. Format in 5.3.11.

Bitmap resources (380 files) have a 0x20-byte header. Pixels start at pixOff; the RGBA16 palette starts at palOff.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | total | Total size. |
| 0x04 | 4 | u32 | pixOff | Pixel offset, 0x20. |
| 0x08 | 4 | u32 | palOff | Palette offset. |
| 0x0C | 4 | u32 | bpp | Bits per pixel: 4 or 8. |
| 0x10 | 4 | u32 | width | Width. |
| 0x14 | 4 | u32 | height | Height. |
| 0x18 | 4 | u32 | nColors | Palette color count. |
| 0x1C | 4 | u32 | zero1C | Zero. |

##### Backdrop (drawn by game code)

`bgfunc` 0x8002F67C draws a 2D backdrop before the 3D pass: a 160×112 bitmap (res **2354**, CI8 250 colours;
res **3072**, CI4 14 colours, for Casino and Ivory Halls), stretched 2× into a 320×224 image at y = 7..231 in
14 G_TEXRECT strips (dsdx = dtdy = 0.5). Modes 0/1 draw the texture only; modes 2/3/4 multiply by prim colour
FFFF00 / 646464 / 00FF00. It is used by the battle stages listed in 4.2 and in story world 2 (Horizon) and areas
2138, 2225, 2165, 2178, 2180, 2164, 2181, 2224 (mode 2 for 2225). Verified on Rope Bridge: the RAM image equals
res 2354 and the frame list starts with this list. Viewer mapping: a screen-space background (or a large
camera-relative quad) textured with the bitmap and tinted by the mode colour.

##### Runtime render state (verified in RAM: Normal 2058, first area 2223, Rope Bridge 2065)

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

##### Collision file (verified: code, all 168 files, 4 RDRAM dumps)

Scene descriptor +0x04 names the resource (−1 = none; 168 distinct files for the 182 descriptors). Big-endian:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `+0x00` | 4 | `u32` | `nGrids` | 1 in every file |
| `+0x04` | 12 | `f32[3]` | `maxX, maxY, maxZ                camera clamp bounds (see below)` | — |
| `+0x10` | 12 | `f32[3]` | `minX, minY, minZ` | — |
| 0x1C | 36 × nGrids | grid[] | grids | Grid records below. |

Grid record, 36 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `+0x00` | 4 | `u32` | `nx;` | — |
| `+0x04` | 4 | `u32` | `ny (always 1);` | — |
| `+0x08` | 4 | `u32` | `nz` | — |
| `+0x0C` | 12 | `f32[3]` | `originX, originY, originZ` | — |
| `+0x18` | 4 | `u32` | `cells` | File offset of nx × nz eight-byte cells (layout below). |
| `+0x1C` | 4 | `u32` | `polyCount` | — |
| `+0x20` | 4 | `u32` | `polys` | file offset of polyCount × 52-byte polygons |

Cell record, eight bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | count | Polygon-index count. |
| 0x04 | 4 | u32 | list | File offset of count u32 polygon indices. |

Polygon, 52 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `+0x00` | 12 | `f32[3]` | `nx, ny, nz          unit normal` | — |
| `+0x0C` | 12 | `f32[3]` | `x, y, z             vertex 0      (world units, the map NIFF's space)` | — |
| `+0x18` | 12 | `f32[3]` | `x, y, z             vertex 1` | — |
| `+0x24` | 12 | `f32[3]` | `x, y, z             vertex 2` | — |
| `+0x30` | 4 | `u32` | `attr` | attribute bits |

- **Loader** `gamesceneSetupAttr` 0x8002D418: `gameresAlloc(res)` → 0x8008F4BC, first grid → 0x8008F4C0; bounds +0x04/+0x0C/+0x10/+0x18
  → 0x800ABD20/28/2C/34 (the Y fields are replaced by constants from 0x80095878/7C); relocates grid +0x18 and +0x20, every
  cell list pointer, and rewrites each polygon index in place as `polys + 52·index`. RDRAM (Normal res 16, Park 18, Rope Bridge
  30, area 2101 res 112): header, grid and polygons identical to the file; all 2,214 cell references relocated exactly so.
- **Cell lookup** 0x8002F32C (`gamesceneGetBoun…`, called by the map hit test at 0x8004DC4C): `ix = trunc(x − originX) >> 8`,
  `iz = trunc(z − originZ) >> 8`, i.e. **256-unit cells**; out of range → none; cell record = `cells + 8·(ix·nz + iz)`. Static
  check: 53,028 of 53,162 cell references overlap their polygon's XZ extent (±1 unit); every polygon is referenced.
  `gamesceneChkMapR…` 0x8002F24C tests a point against the bounds with a margin.
- **Winding:** the stored normal equals `normalize((v1 − v0) × (v2 − v0))` for all 16,094 polygons: front faces are
  counter-clockwise, as in the viewer.
- **Attribute bits:**
  - **0x2 = floor**: `rpRM_CHK_FLOOR` 0x80057800 reports a hit as floor when `attr & 2` (else it tests the normal). 3,968
    of the 4,222 attr-0x2 polygons face up.
  - **0xC00 = which objects collide**: `hitchkIgnore` 0x8004C1C4(attr, mask) accepts a polygon for a hit-check object when
    `attr & 0xC00` is 0 (everyone), 0x400 and `mask & 0xF00` = 0, 0x800 and `mask & 0xF00` = 0x300, or 0xC00 and
    `mask & 0xF00` is neither 0 nor 0x300. Which objects carry which mask class was not traced.
  - `hitchkAreaMain` ORs the attributes of all polygons touched; `hitchkMapFoot` stores the floor polygon's attribute in
    the hit object (+0x58). The other bits are tested outside main code (overlays) and are not decoded. Hypothesis: 0x1C
    = solid wall (10,318 of the 11,094 attr-0x1C polygons are walls, 746 ceilings).
  - Values over all files (polygons; w/f/c = wall/floor/ceiling by normal): 0x0 16, **0x2 4,222**, 0x17 100 (w), **0x1C 11,094**,
    0x1D 140, 0x92 8 (f), 0xD2 14 (f), 0x112 6 (f), 0x11D 182 (w), 0x240 8, 0x31C 7, 0x389 58, 0x41D 38 (w), 0x7DD 5 (c),
    0x81C 92 (w), 0x1202 50, 0x12C0 48, 0x1352 6 (f).
- The battle arenas are boxed in by tall invisible walls (Normal: to y = 1000 around x 0..1300, z 0..1100).
- **Viewer** (`collision.ts`): hidden layer "collision", one mesh per attribute value; floor (bit 0x2) green, bits 0x1C
  orange, restricted (0xC00) blue, others purple.

### 3.3 Geometry

### 3.4 Display lists and render state

### 3.5 Textures and materials

### 3.6 Collision

### 3.7 Environment, sky, fog, and lighting

### 3.8 Cameras and paths

## 4. Objects

### 4.1 Placement records

### 4.2 Object and model formats

### 4.3 Skeletons and animation

### 4.4 Behaviors, triggers, and scripted objects

## 5. Audio

### 5.1 Audio storage and banks

#### Where the data is (verified)

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

### 5.2 Sequence format and driver

All three games use **standard Nintendo libultra audio**: the compressed-MIDI sequence player
(alCSPlayer), ALBankFile instrument banks ("B1") with VADPCM samples, and the common RSP audio microcode
(aspMain, ABI1). Hudson wraps it in the SDK sample audio manager (SA function names: `amMusPlay`,
`musSeqHRomCopy`, `initOsc/updateOsc/stopOsc`, `__amMain`, ...). There is no custom audio microcode
and no MusyX. Music data is **uncompressed** and read in place from ROM.

#### S2 song table (verified)

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | u16 | magic | S2 (0x5332); loader also accepts S1. |
| 0x02 | 2 | u16 | count | Song count. |
| 0x04 | 8 × count | sequenceEntry[] | sequences | Sequence offset/length table. |
| 0x04 + 8 × count | 16 × count | song[] | songs | One song record per sequence. |

Sequence entry, eight bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | seqOffset | 0xFFFFFFFF marks an empty entry. |
| 0x04 | 4 | u32 | seqLength | Sequence length. |

Song record, 16 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 1 | u8 | bank | Bank-array index. |
| 0x01 | 1 | u8 | volume | Master volume, 0–127. |
| 0x02 | 2 | u16 | unknown02 | 0xFFFF. |
| 0x04 | 4 | u32 | ctlOffset | Control-bank offset. |
| 0x08 | 4 | u32 | ctlSize | Control-bank length. |
| 0x0C | 4 | u32 | tblOffset | Wave-bank offset. |

SA's loader (0x800249A8–0x80024BB4) reads `bank`, `ctlOffset`, `ctlSize`, `tblOffset` from the record at
`table + song·16` and binds `ctl->bankArray[bank]` to the sequence player. Song → bank:
- BM64: bank 0 for all 47 songs (banks 1 and 2 are unused by music; purpose unknown).
- Hero: bank 0 for all songs.
- SA: bank per song, 0..75: `0 1 2 3 4 5 0 6 7 50 8 51 9 52 10 53 11 54 12 13 14 55 15 0 16 17 18 19 0 0 0 0 0 0 20 21 22 23 24 25 26 27 28 28 29 29 30 30 31 31 32 32 33 34 35 36 37 0 38 0 39 40 40 41 42 43 44 45 46 47 0 48 56 57 0 0`.
  Verified from RAM on four screens (intro song 3/bank 3, main menu 1/1, character select 5/5, battle 42/28)
  and by rendering song 3 with bank 3 against captured game audio.

#### Sequence format: libultra compressed MIDI (verified: all 155 songs parse to the end)

Sequence header, 0x44 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 0x40 | s32[16] | trackOffsets | Relative to sequence start; zero marks unused tracks. |
| 0x40 | 4 | s32 | division | 480 ticks per quarter note. |

Track unit (variable length), repeated until end of track:

| Order | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 1 | Variable | VLQ | delta | Delta time. |
| 2 | Variable | event | event | Event encoding below. |

| Component | Encoding | Meaning |
|---|---|---|
| Header | 0x44-byte header below | Track offsets are relative to the sequence start; zero means unused. Division is 480 in every song. |
| Track | Repeated delta/event units below | Time-ordered event stream. |
| Escape | `FE FE` | Literal byte `0xFE`. |
| Back-reference | `FE hi lo len` | Read `len` bytes from `escapeOffset - ((hi << 8) \| lo)`, then resume after the four-byte escape. |
| Tempo | `FF 51 t1 t2 t3` | Microseconds per quarter note. |
| End | `FF 2F` | End of track. |
| Loop start | `FF 2E nn FF` | Start marker; the two payload bytes are ignored. |
| Loop end | `FF 2D cnt cur o1 o2 o3 o4` | Initialize/decrement `cur` and jump backward by the big-endian `u32` offset; `cnt = cur = 0xFF` loops forever. |
| MIDI | `8n..En` | Channel messages with running status; meta events reset running status. |
| Note | `9n key vel {varlen dur}` | Note-on with an inline duration; no note-off event is stored. |

Only controllers 7 (volume), 10 (pan) and 91 (effects/reverb send) occur, plus program change and
pitch bend. BM64 has some finite loops (`cnt = 3`); Hero and SA loop forever.

#### Rendering to PCM

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

Reference implementation (Python): `bm/audio/scripts/n64audio.py` (S2 parser,
VADPCM decoder, sequence parser including back-references and loops, simple sampler, WAV writer);
`render_one.py {game} {song} {bank} {seconds}`.

### 5.3 Instruments and sample encoding

#### Instrument bank (.ctl) (verified: all pointers resolve in all three games)

Standard libultra ALBankFile, big-endian, offsets relative to the .ctl start (relocated by adding the
base, as `alBnkfNew` does):

ALBankFile, four-byte header and counted offsets:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | s16 | revision | 0x4231 (B1). |
| 0x02 | 2 | s16 | bankCount | Bank count. |
| 0x04 | 4 × bankCount | s32[] | bankOffset | Bank offsets. |

ALBank, 0x0C-byte header and counted offsets:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | s16 | instCount | Instrument count. |
| 0x02 | 1 | u8 | flags | Relocation flags. |
| 0x03 | 1 | u8 | padding | Padding. |
| 0x04 | 4 | s32 | sampleRate | 32000 Hz. |
| 0x08 | 4 | s32 | percussion | Instrument offset or zero. |
| 0x0C | 4 × instCount | s32[] | instOffset | Instrument offsets. |

ALInstrument, 0x10-byte header and counted offsets:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 1 | u8 | volume | Volume. |
| 0x01 | 1 | u8 | pan | Pan. |
| 0x02 | 1 | u8 | priority | Priority. |
| 0x03 | 1 | u8 | flags | Flags. |
| 0x04 | 4 | u8[4] | tremolo | Type, rate, depth, delay. |
| 0x08 | 4 | u8[4] | vibrato | Type, rate, depth, delay. |
| 0x0C | 2 | s16 | bendRange | Pitch-bend range. |
| 0x0E | 2 | s16 | soundCount | Sound count. |
| 0x10 | 4 × soundCount | s32[] | soundOffset | Sound offsets. |

ALSound, 0x10 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | s32 | envelope | Envelope offset. |
| 0x04 | 4 | s32 | keyMap | Key-map offset. |
| 0x08 | 4 | s32 | wavetable | Wave-table offset. |
| 0x0C | 1 | u8 | samplePan | Pan. |
| 0x0D | 1 | u8 | sampleVolume | Volume. |
| 0x0E | 1 | u8 | flags | Flags. |
| 0x0F | 1 | u8 | padding | Padding. |

ALEnvelope, 0x10 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | s32 | attackTime | Microseconds. |
| 0x04 | 4 | s32 | decayTime | Microseconds. |
| 0x08 | 4 | s32 | releaseTime | Microseconds. |
| 0x0C | 1 | u8 | attackVolume | Attack target. |
| 0x0D | 1 | u8 | decayVolume | Decay target. |
| 0x0E | 2 | u8[2] | padding | Alignment padding. |

ALKeyMap, six bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 1 | u8 | velocityMin | Minimum velocity. |
| 0x01 | 1 | u8 | velocityMax | Maximum velocity. |
| 0x02 | 1 | u8 | keyMin | Minimum key. |
| 0x03 | 1 | u8 | keyMax | Maximum key. |
| 0x04 | 1 | u8 | keyBase | Base key. |
| 0x05 | 1 | s8 | detune | Cents. |

ALWaveTable, 0x14 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | s32 | base | Offset into .tbl. |
| 0x04 | 4 | s32 | len | Encoded byte count. |
| 0x08 | 1 | u8 | type | 0 VADPCM; 1 RAW16. |
| 0x09 | 1 | u8 | flags | Flags. |
| 0x0A | 2 | u16 | padding | Padding. |
| 0x0C | 4 | s32 | loop | Loop offset. |
| 0x10 | 4 | s32 | book | Predictor-book offset. |

ALADPCMloop, 0x2C bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | start | Loop start sample. |
| 0x04 | 4 | u32 | end | Exclusive loop end. |
| 0x08 | 4 | s32 | count | −1 repeats forever. |
| 0x0C | 0x20 | s16[16] | state | Decoder history. |

ALADPCMBook, eight-byte header and coefficients:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | s32 | order | Observed: 2. |
| 0x04 | 4 | s32 | npredictors | Observed: 4. |
| 0x08 | 16 × order × npredictors | s16[] | book | Predictor coefficients. |

All wave tables in all three games are type 0 (VADPCM), order 2, 4 predictors.

#### VADPCM decoding (verified bit-exact)

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

### 5.4 Music catalog and loop points

#### Song lists

Evidence levels: **obs** = observed in RAM or captured audio; **code** = constant or table in code (the
screen it belongs to may still be inferred); **name** = in-game Sound Test; **H** = hypothesis.

##### The Second Attack: 76 songs, no in-game names (no sound test)

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

Rendered samples (Python prototype): `bm/audio/wav/` contains `bm64sa_seq01_bank1.wav` (main menu), `bm64sa_seq03_bank3.wav` (intro), and `bm64sa_seq42_bank28.wav` (Survival battle).

## 6. Unused and hidden content

### 6.1 Unreferenced assets

Source: `notes/unused.md` (tools and string dumps in `bm/unused/`). "Static" means
disassembly and cross-references: `xref.py` resolves jal targets, lui/addiu pairs and data words over main code
and every overlay. Indices computed at run time (base + k, SA event scripts) are not resolved, so
file-level results are **candidates** unless marked high confidence.

#### Bomberman 64: The Second Attack!

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

### 6.2 Cut or inaccessible levels

### 6.3 Debug features

### 6.4 Prototype or revision-specific content

## 7. nviewer implementation

### 7.1 Module mapping

#### Detection and plumbing (straightforward)

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

#### New and reused modules

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

#### Extensions to `displaylist.ts` (all backwards compatible with the Rush loaders)

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

#### Difficulty and risks (preliminary)

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

### 7.2 Supported features

### 7.3 Approximations and omissions

## 8. Verification and remaining work

### 8.1 Verification evidence

All paths are under `bm/`. Emulator: headless mupen64plus (glide64mk2 software
rendering, HLE RSP). Its `--debug` core was used for breakpoints and RDRAM dumps.

#### Reference screenshots of the real games

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

#### What was checked against the running game or the ROM

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
| SA collision file | relocated file in RDRAM (Normal, Park, Rope Bridge, area 2101); cell lookup code vs polygon extents; stored normals vs cross products (`bmcol/sa/`) | identical; 53,028/53,162 references overlap; 16,094/16,094 normals |
| Hero collision planes | floor query port vs RAM results (stage 1-1, Fog Route); plain floors vs coplanar map triangles, with a mirrored control (`bmcol/hero/stats.txt`) | results equal; 85–100% on most stages, mirrored near 0 |
| BM64 attribute grid | RAM grids (4 dumps) vs file; `groundHeight` port vs object heights; floors, slopes and walls vs map geometry (`bmcol/bm64/run.out`, `align.out`) | equal except runtime edits; 85 of 101 objects; 91–100% floors |
| SA fog formula | warp to area 2101 at `gamesceneSetup`; frame lists from RDRAM (`verify/sa/`) | DB08 fm 3282 / fo −3026 and colour 000F2E as predicted; fog render modes active; objects fogged |

#### Sample extractions

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

### 8.2 Known unknowns

#### Open questions and hypotheses

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
  Garden 1 only).
- Attribute grid (5.4.7): bits 0x2000/0x4000/0x8000; floor shapes 2, 9, 10, 11; per-stage trigger callbacks (id 5
  fills large empty volumes: a fall zone?); battle markers 1–4 as player starts; whether maps chamfer corner cells;
  Green Garden 1 (43) and Switches and Bridges 1 (84) floor cells without a map surface (props, hypothesis).
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
- Class-3 animation channel semantics, class 4/5 data, NIFF header +0x14.
- Collision attribute bits other than 0x2 (floor) and 0xC00 (object filter), e.g. 0x1C as solid wall; which objects have
  mask classes 0 / 0x300 (5.3.11).

**Hero**
- Only stages 1-1 and 18 (Fog Route) were loaded in the emulator; the other maps are verified by static decode
  only. Fog mode 1 (no stage uses it) was not observed.
- Whether the backdrop picture scrolls with the camera.
- Scale source of some object classes (switch 0.9); MAPWOOD's Y offset; a placement-record-driven render of 1-1.
- Lighting bake: F3DEX 1.x light-direction transform, alpha, combiner; Bomberman's material looks wrong in the replay.
- Collision (5.2.7): attributes 200, 223–226, 228, 229, 235, 242, 249, 250, 253; X/Z meaning of player +36/+44 for
  currents; knock-back 240; the step rule of 0x80084430; Hades Crater's −50 and Killer Gate's ±100 offsets.
- Which label slot the select screen shows per area (name mapping by area order is consistent with every count
  and boss position, but the index was not traced); info-record fields +3/+4/+5/+8/+0x20/+0x30/+0x34.

**Music**
- Voice limits of BM64/Hero (16 assumed) and voice stealing; which reverb BM64 and Hero use; the exact volume
  formula and live controller updates; vibrato scaling and delay (6.6).
- Names of BM64 and SA songs (no sound test); screens of several code-referenced songs.
- SA event scripts (`evexecAudio`) that also start songs; the unused-song lists depend on them.

### 8.3 References
