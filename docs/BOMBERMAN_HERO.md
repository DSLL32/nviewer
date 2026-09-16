# Bomberman Hero — Nintendo 64 ROM format specification

This manual describes the shipped data formats needed to identify, extract, and
present Bomberman Hero content. Claims state their evidence inline; unsupported
interpretations are labelled hypotheses.

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | Pointer-linked file chains and per-scene overlays. |
| Compression | Hudson LZSS with a 4 KiB ring. |
| Graphics microcode | F3DEX 1.21. |
| Geometry | Hudson “64” containers with stage and placement blobs. |
| Textures | RDP-native textures embedded in Hudson model containers. |
| Collision | Triangle data in stage blob A. |
| Music driver | libultra `alCSPlayer`. |
| Audio microcode | libultra `aspMain` ABI1. |
| Sample encoding | Nintendo VADPCM. |
| Levels | Five planets plus Gossick Star. |
| Memory requirement | Base 4 MiB. |
| Viewer support | USA revision 0. |

### 1.2 ROM identification

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| USA | `BOMBERMAN HERO` | `NBDE` | 0 | 12 MiB (`0xC00000`) | `4446FDD6` | `E3788208` | `a36364b7e59351f7551ab351cb3b41ebc4be285b` | CIC-6102 | — |
| Europe | `BOMBERMAN HERO` | `NBDP` | 0 | 12 MiB (`0xC00000`) | `D85C4E29` | `88E276AF` | `ba1e6a4cc323a83d7c14573c9128ab9f9b60e5f2` | CIC-6102 | — |
| Japan | `ﾎﾞﾝﾊﾞｰﾏﾝ ﾋｰﾛｰ` | `NBDJ` | 0 | 12 MiB (`0xC00000`) | `67FF12CC` | `76BF0212` | `ae3f4f7c31ddbd14843d9beb932fc5aa21746211` | CIC-6102 | — |

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

#### Bomberman Hero (verified: disassembly, PI load traces, RDRAM dumps equal to ROM)

| ROM | VRAM | Contents |
|---|---|---|
| 0x1000–0x4DFF0 | 0x80000400–0x8004D3F0 | seg1 (IPL3 copy): core, loaders, decompressor, libultra; BSS 0x8004D3F0–0x8005BAD0 |
| 0x4DFF0–0x126CB0 | 0x8005BAD0–0x80134790 | seg2 (game code and data tables), copied by `0x80000BE8 romRead(0x4DFF0, 0x8005BAD0, 0xD8CC0)` |
| 0x126CB0–0x128D20 | slots | two raw data files (see 3.5) |
| 0x128D20–0x147BB0 | 0x80280000 | 7 per-planet code overlays, uncompressed; ROM-range table (field layout below) at 0x8010CC68 (ROM 0xFF188), indexed by the planet byte at 0x8016523E (`0x800883A8`) |
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

### 2.2 Memory and address mapping

#### Bomberman Hero: chained LZSS files addressed by ROM offset

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
  (700 eight-byte entries), cleared per scene by 0x800819E0:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | pointer | Loaded resource pointer |
| 0x04 | 4 | u32 | unknown_04 | Unresolved |

- `0x8001E98C loadRaw(slot, start, end)`, `0x8001EA68 loadLzss(slot, start, end)`,
  `0x8001EB68(slot, start, end)` = loadLzss plus bookkeeping. Loaded data is not modified in place.

**Tables that reference files** (974 of 982 files are referenced; the other 8 are listed in section 10):

| Table (VRAM) | Record | Use |
|---|---|---|
| 0x80108238 | 192 pointers to 0x24-byte stage records below | main-game stages: A = blob loaded at 0x802D0000 (slot 0x1C), B = stage map container (slot 0x1B); index in s32 at 0x8016E428 |
| 0x8010CC68 | Seven ROM-range records below | planet code overlays |
| 0x80122B08 | About 550 sixteen-byte model records below | object models, loaded on demand by 0x80065CA4 |
| 0x80320534 (common overlay) | Twenty-byte picture records below | 2D pictures/sprites |
| 0x80100720 / 0x80101A14 / 0x80101F18 | 0x58-byte alternate-map records; known fields below | alternate modes; 0x80101F18 = the 23 attract-demo maps |
| 0x80104C20, 0x801051E0 | ROM-range record lists below | menu/story pictures |

ROM-range record, eight bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | start | Inclusive ROM start. |
| 0x04 | 4 | u32 | end | Exclusive ROM end. |

Stage record, 0x24 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | descriptor | Descriptor value/pointer. |
| 0x04 | 8 | RomRange | fileA | Stage-blob extent. |
| 0x0C | 8 | RomRange | fileB | Map-container extent. |
| 0x14 | 16 | s32[4] | unknown14 | Unknown signed words. |

Model record, 16 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | descriptor | Descriptor value/pointer. |
| 0x04 | 8 | RomRange | file | Model extent. |
| 0x0C | 4 | u32 | zero0C | Zero. |

Picture record, 20 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | slot | Load slot. |
| 0x04 | 8 | RomRange | file | Picture extent. |
| 0x0C | 4 | u32 | flags | Load flags. |
| 0x10 | 4 | u32 | descriptor | Descriptor. |

Alternate-map record, 0x58 bytes, known fields:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 8 | RomRange | fileA | First extent. |
| 0x08 | 8 | RomRange | fileB | Second extent. |
| 0x10 | 0x48 | u8[] | unknown10 | Remaining fields not decoded here. |

### 2.3 ROM map and asset organization

### 2.4 Compression formats

The shared [Hudson LZSS format and C++ codec](./compression/hudson-lzss.md)
covers the 4 KiB token stream. Hero's little-endian compressed-byte count is
an outer wrapper, not part of the token syntax.

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

#### LZSS, 4,096-byte ring (Bomberman Hero)

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

The 979 Hero files are numbered here in ROM order for convenience; those
numbers are not stored file IDs.

### 2.5 Loading process

### 2.6 Revision differences

## 3. Level data

### 3.1 Level catalog and identifiers

#### Bomberman Hero

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

### 3.2 Level container

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

#### Bomberman Hero (the "64" container is shared with BM64)

##### "64" container

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `+0x00` | 4 | `u32` | `0x36340038 ("64\0" 0x38)` | — |
| `+0x04` | 4 | `u32` | `nSections` | — |
| `+0x08` | 4 | `u32` | `0x02020202` | — |
| 0x0C | 12 × nSections | section[] | sections | Section records below. |

Section record, 12 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | type | Record type. |
| 0x04 | 4 | u32 | param | Type-specific parameter. |
| 0x08 | 4 | u32 | offset | Offset from container start. |

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

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `+0x00` | 4 | `s32` | `drawRecord` | record index to draw (−1 = none) |
| `+0x04` | 12 | `f32[3]` | `tx, ty, tz        emitted as a matrix only if non-zero` | — |
| `+0x10` | 12 | `f32[3]` | `rx, ry, rz        degrees; only if non-zero` | — |
| `+0x1C` | 12 | `f32[3]` | `sx, sy, sz        unused by the static draw path (always 1.0)` | — |
| `+0x28` | 4 | `s32` | `nextSibling` | relative node index (0 = none) |
| `+0x2C` | 4 | `s32` | `firstChild` | relative node index (0 = none) |

Traversal: for node i, push/multiply G_MTX if its translation or rotation is nonzero, draw its drawRecord, recurse to i + firstChild if present, then pop. Recurse to i + nextSibling if present.

In all 3,442 BM64 nodes R = 0 and S = 1, so the static pose is translations only. The list begins with a
root node (draw −1, child 1). Maps have identity nodes.

**Addressing:** everything (vertices, images, palettes, display lists) is segment 2 = container base. The
game sets `G_MOVEWORD seg 2 = file address` before each object. There is no runtime patching. Verified: frame
display list in RDRAM and renders.

**Textures:** plain F3DEX 1.x RDP tile code inside the lists. Palette via SETTIMG + LOADTLUT; texels via
SETTIMG + SETTILE + LOADBLOCK + SETTILESIZE; SETOTHERMODE_H TEXTLUT RGBA16. Formats are mostly CI4.
Pitfall: an early classifier missed `FD100000 02000930` (G_SETTIMG with non-zero low bits in w0) and wrongly
concluded that Hero has no SETTIMG. The type-5 CI files are 2D pictures (menus, HUD, backdrops), not model textures.

##### Stage records

For stage index `i`:
**Info record (0x38 bytes)** at `*(0x8010B3FC + 4*i)` (ROM 0xFD91C). Unlisted fields are unresolved or hypothetical (`hero_level.md`).

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 3 | u8[3] | location | Planet, area, map |
| 0x06 | 1 | u8 | kind | 0 normal; 1 Vs. Nitros; 2 Vs. The Big Four/Bagular; 3 special; 4 event; 5 index 110 |
| 0x07 | 1 | u8 | song | Song ID |
| 0x0C | 12 | s16[6] | activationBox | Object activation bounds |
| 0x18 | 8 | Unknown[2] | activationDistanceSquared | Two squared activation distances; scalar type unresolved |
| 0x2C | 4 | f32 | farPlane | 20000, 8200, 6300, 5400, 4400, 2400 or 2000 |

- **File record**, 0x24 bytes, `*(0x80108238 + 4i)`:

  | Offset | Size | Type | Field | Description |
  |---:|---:|---|---|---|
  | `0x00` | 4 | `u32` | `descriptor` | — |
  | `0x04` | 8 | `u32[2]` | `rangeA` | — |
  | `0x0C` | 8 | `u32[2]` | `rangeB` | — |
  | `0x14` | 16 | `s32[4]` | `sub` | — |

  - B = **map container** (slot 0x1B).
  - A = **stage blob**, linked and loaded at 0x802D0000 (slot 0x1C). u32 at +0 points to a header at the
    end of the blob. Header fields a viewer needs (verified from code 0x80066AE8–0x80066E60, 0x8001C7DC,
    0x8006E088, and against stage 1-1 runtime values):

**Stage-blob header environment fields.** Bounds and collision-grid fields are tabulated under collision.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x2B | 1 | u8 | fogMode | 0 = none; 2 = fog; mode 1 exists only in code |
| 0x2C | 1 | u8 | backdrop | 0 = none; otherwise picture-table index + 1 (table 0x801051E0) |
| 0x31 | 3 | u8[3] | fogRGB | Fog colour |
| 0x34 | 2 | s16 | fogMin | gSPFogPosition minimum |
| 0x36 | 2 | s16 | fogMax | gSPFogPosition maximum |

  - `sub[]` = offsets (−1 = none) of nested sub-containers inside B, drawn at identity in stage 1-1 (hypothesis:
    doors/platforms driven by stage code).

**Drawing a map:** draw every type-0 section of B at identity, plus the lists of the nested sub-containers
(`sub[]`). The game additionally skips map chunks (960-unit sections) behind the camera.

##### Object placement (verified: all 16 stage 1-1 records match the captured frame)

Placement blob ROM 0x2193A0–0x229650, linked at 0x80300000; pointer table 0x8010BC30 (192 entries, same index).
Block for stage `i` = `ROM 0x2193A0 + (*(0x8010BC30 + 4i) − 0x80300000)`. Records, 16 bytes big-endian:


| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | u16 | type | Index into 652-entry object class table; 0xFFFF ends list |
| 0x02 | 6 | s16[3] | position | World x, y, z |
| 0x08 | 2 | s16 | yaw | Degrees |
| 0x0A | 6 | s16[3] | parameters | Class-specific item/content parameters |

The first record is a sentinel: type 0x2D at (30000,30000,30000). Names are at ROM `0x1172F8 + type*0x60`, e.g. NAME_SOFTBLK1.

- Drawn x, z and yaw equal the record exactly.
- **Object class descriptor** (0x60 bytes; record start = ROM 0x1172F8 + type·0x60 − 0x48, name at +0x48).
  Verified on 10 classes against the stage 1-1 load trace:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x14 | 12 | u32[3] | behaviorFunctions | Linked function pointers at 0x14, 0x18 and 0x1C |
| 0x24 | 4 | u32 | modelResource | Model-file resource-record pointer; LZSS-chain layout below. |
| 0x28 | 4 | u32 | shape | Shape-structure pointer. |
| 0x34 | 4 | u32 | activationDistanceSquared | Usually 1920². |
| 0x38 | 4 | u32 | typeRecord | Pointer to the eight-byte type record below. |
| 0x48 | Unknown | u8[] | name | Class name; maximum occupied length not established here. |

  Model-file resource record, 12 bytes:

    | Offset | Size | Type | Field | Description |
    |---:|---:|---|---|---|
    | `0x00` | 2 | `u16` | `slot` | — |
    | `0x02` | 2 | `u16` | `flag` | — |
    | `0x04` | 4 | `u32` | `romStart` | — |
    | `0x08` | 4 | `u32` | `romEnd` | — |
  Type record, eight bytes:

    | Offset | Size | Type | Field | Description |
    |---:|---:|---|---|---|
    | 0x00 | 2 | u16 | zero | — |
    | 0x02 | 2 | u16 | type | — |
    | 0x04 | 2 | u16 | slot | — |
    | 0x06 | 2 | u16 | flags | — |

  So a loader goes type → descriptor → model file directly; no per-stage table is needed.
- **Y offset = shape struct s16[1]** (gates 360, door 120, crates 60, switch 35, plate 60; classes with shape 0
  → 0). Verified for 6 classes; MAPWOOD has 150 but is drawn at +240 (hypothesis: its code snaps it to the
  floor). Some classes are drawn scaled (switch 0.9); the scale source was not found.

##### Runtime-only render state (verified at stage 1-1 start, RDRAM `hero_level/rdram_s11.bin`)

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

##### Lighting bake

Hero uses the same lighting mechanism as BM64 (5.4.3): signed-byte normals, G_MOVEMEM lights, and LIGHTCOL overrides
at 0x20/0x24 and 0x40/0x44. Bake with the BM64 formula, in world space, using Hero's defaults: L2 colour C8C8C8,
direction (10, 42, 120); L1 black; ambient 323232; material overrides from LIGHTCOL. The world-space bake was
verified by measurement for BM64 and SA. For Hero it is a hypothesis: the map renders look right, but Bomberman's
material looked wrong in the frame replay. The debug menu's [LIGHT EDIT] page shows the same stage 1-1 values
(ambient 50, direction 10/42/120).

##### Verification

- `hero_level/renders/cmp_s11_cam.png`: map-only render at the game camera vs the emulator. Walls, path and gate
  line up (the red "B" gate is an object and is absent).
- `hero_level/renders/frame_s11_cmp.png`: replay of all 157 draw calls of the captured frame (segment bases and
  matrices from RAM). The gate, side gates and Bomberman appear in place; remaining differences are the HUD, the
  undrawn backdrop and filtering.

##### Collision (stage blob A; verified: code, RDRAM, all 103 viewer stages)

Hero's static collision is a grid of **planes** in the stage blob; the map container holds none. Blob A is loaded
at exactly 0x802D0000 and is linked there (absolute pointers, no relocation: stage 1-1 RAM from 0x802D0000 equals the
decompressed file, 0x48D0 bytes). The header (u32 at blob +0, the last 0x54 bytes) begins:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | s16 | xmin | Collision-grid bound; X/Z tests reject points on or outside the corresponding boundary. |
| 0x02 | 2 | s16 | ymin | Collision-grid bound; X/Z tests reject points on or outside the corresponding boundary. |
| 0x04 | 2 | s16 | zmin | Collision-grid bound; X/Z tests reject points on or outside the corresponding boundary. |
| 0x06 | 2 | s16 | xmax | Collision-grid bound; X/Z tests reject points on or outside the corresponding boundary. |
| 0x08 | 2 | s16 | ymax | Collision-grid bound; X/Z tests reject points on or outside the corresponding boundary. |
| 0x0A | 2 | s16 | zmax | Collision-grid bound; X/Z tests reject points on or outside the corresponding boundary. |
| 0x0C | 12 | s16[6] | secondaryBounds | Copied to 0x801778F0; not used by collision. |
| `+0x18` | 6 | `s16[3]` | `nx, ny, nz                            cells of 960 units from (xmin, zmin); x/z spans = nx·960, nz·960 in all 102 blobs` | — |
| 0x1E | 6 | s16[3] | tileCounts | Each is 16; query hardcodes 16 tiles of 60 units. |
| `+0x38` | 4 | `ptr` | `nx·ny·nz 16-byte records             not read by the collision code (hypothesis: draw lists)` | — |
| `+0x3C` | 4 | `ptr` | `u32[nx·nz] cell blocks, index iz·nx + ix, 0 = no collision in the cell` | — |
| `+0x40` | 4 | `ptr` | `push table for attribute 252 (2 blobs); +0x44 always 0` | — |

Cell block, 12 bytes. These three pointers are stored after the cell's data:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | tiles | Pointer to 256 three-byte tiles, index tz × 16 + tx. |
| 0x04 | 4 | u32 | planes | Pointer to 28-byte planes; array ends at lists. |
| 0x08 | 4 | u32 | lists | Pointer to byte-sized plane-index lists, each ending in 0xFF. |

Tile record, three bytes; tile size is 60×60 units:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 1 | u8 | diagonal | Selects the two triangle halves. |
| 0x01 | 1 | u8 | list0 | List offset for half 0. |
| 0x02 | 1 | u8 | list1 | List offset for half 1. |

Plane record, 28 bytes. The equation is a·x + b·y + c·z = d; b is never zero (routine 0x80015D2C).

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | s32 | a | X coefficient. |
| 0x04 | 4 | s32 | b | Y coefficient. |
| 0x08 | 4 | s32 | c | Z coefficient. |
| 0x0C | 4 | s32 | d | Plane distance. |
| 0x10 | 4 | s32 | facing | Repeated b: positive top, negative underside (3,085 of 13,033 planes). |
| 0x14 | 4 | s32 | attr | 200–255; 255 is plain. |
| 0x18 | 4 | s32 | param | 0xFFFF when unused. |

- **Tile halves:** diagonal 0 → half 0 is `lx + lz < 60`; diagonal 1 → half 0 is `lz < lx` (lx, lz local to the tile).
  A plane's surface is the union of the tile halves whose list names it; there are no vertices.
- **Query** 0x80067748(x, y, z) (header fields copied to 0x80177788.. by 0x80066AE8): in the tile half containing
  (x, z), the highest plane at or below y is the floor, the lowest above y the ceiling; none → y ∓30000, attr 255.
  Results at 0x801776F0.. (plane, attr 0x80177740, param 0x80177750, height 0x80177760); 0x801776E0 bit 0 is set
  when the surface below faces down or the one above faces up.
- **No wall polygons:** walls are steep planes (about 1,200 records steeper than 60°) and height steps between planes.
  0x80084430 compares the new plane with the previous one using 30- and 60-unit thresholds (hypothesis: the step
  limit). Moving platforms are runtime triangles (10 object slots × 6 at 0x80176610, 0x80068CC4, merged by 0x80069314).
- **Checks:** stage 1-1 RDRAM, Bomberman at (0, 0, 1560): the query returns plane (0, 1008, 0, 0), attr 255, the RAM
  result. Fog Route (`rd_s18.bin`), player at (0, 1382.857, 4400): cell 25 plane (0, 1764, −252, 1330560) gives exactly
  1382.857. Plain up-facing tiles lie within 2 units of a coplanar map triangle for 85–100% of most stages (Battle Room
  90.2%, Secret Room 98.5%, Fog Route 98.2%, Dark Prison 99.1%); mirroring X drops asymmetric maps to near 0 (Sky Room
  94.9% → 0.4%), so scale, offset and handedness match the map. Low scores: Vs. Baruda (37, attr-200 planes above a
  two-disc map), scene 170 (one plane under a sphere), Hades Crater (39, collision about 50 below the map: not
  explained), Killer Gate (33, ±100 offsets, probably moving parts).
- **Attributes** (+0x14, the value the MASTER DEBUG "NO ATTRIBUTE" flag s8 0x8016E404 disables): the player's floor
  handler 0x80085D54 dispatches attr 215..255 through the jump table 0x8010CCA8.

  | attr | Meaning | Evidence |
  |---|---|---|
  | 255 | plain surface (floor, steep or underside by its normal) | default |
  | 245, 217 | param 0: kill floor (678 planes, mostly pits and lava); else hazard (costs one health) | 0x80086AD0 → 0x8016E080 = 3/4/5; seg1 0x80023B8C; skipped with NO DAMAGE 0x8016E3FC |
  | 247, 248 | hazard kind 1 / 2 | 0x8016E080 = 1 / 2, same damage path |
  | 230, 231, 246, 254 | room exit; exit number = signed low byte of param | 0x80069D04 / 0x80069D88 → 0x80069AD8 reads target stage and entry from info record +8 |
  | 218 | special exit (stages 68, 105–107) | same table |
  | 238, 241 | door to another room, exit = low byte of param | overlay 0x802845C4: player state 45, sound 58 |
  | 239 | launch pad, heading 90·param | 0x802844D4: state 44 |
  | 227 | boost pad | 0x80284840: state 48 |
  | 233 | fall-in hole (all four points ±25 must be 233) | 0x80284758: state 47 |
  | 240 | knock-back (hypothesis) | 0x802828C0: state 5 or 8 by vertical speed |
  | 237, 236, 232, 215 | current 1..4: adds/subtracts 16 to player +36 / +44 (hypothesis: X / Z) | 0x8016E288; overlay 0x80280B6C |
  | 252 | push zone param + 1, directions from the header +0x40 table | overlay 0x80280928 |
  | 200, 223–226, 228, 229, 235, 242, 249, 250, 253 | unknown (228/229 only counted by object 0x8009CC88, Move Stone plates: hypothesis) | no other readers found |

- **Viewer** (`collision.ts`): tile halves, joined into rectangles where one plane covers whole tiles (80,754 triangles
  for the 103 stages, from 1.53 million halves), in hidden layers "collision" (up-facing planes, by class: floor,
  steep, kill, hazard, exit, door, launch, boost, hole, knock-back, current, push, other) and "collision undersides".

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

Sequence parsing, VADPCM decoding, and loop handling were checked against
captured audio.

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

##### Bomberman Hero: 32 songs, all named (Sound Test)

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

## 6. Unused and hidden content

### 6.1 Unreferenced assets

Source: `notes/unused.md` (tools and string dumps in `bm/unused/`). "Static" means
disassembly and cross-references: ROM scan resolves jal targets, lui/addiu pairs and data words over main code
and every overlay. Indices computed at run time (base + k, SA event scripts) are not resolved, so
file-level results are **candidates** unless marked high confidence.

#### Bomberman Hero

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
| ROM identity | header CRC1/CRC2 recomputed with the CIC-6102 algorithm (ROM analysis) | all three match |
| BM64 LZSS decoder | 125 decompressions (10 overlays, 115 assets) dumped from RDRAM at decoder exit from power-on through the Adventure intro (ROM extraction, cross-check, `dumps/`) | 125/125 byte-identical |
| SA LZSS and Yay0 | RDRAM at decoder exit: resource 3044 (LZSS), exec 0x1A (LZSS, TLB-mapped), resource 13 (Yay0) (`bm64safs/dumps/d1–d3.bin`) | byte-identical |
| SA/BM64/Hero code images | RDRAM dumps compared with ROM ranges | code identical; only small `.data` ranges differ |
| Hero LZSS | break at call/return of `lzssDecode`: source = ROM 0x4C9FD0, output 0xFE70 bytes (`herofs/v1_*.bin`); full-RDRAM slot comparisons | identical; 5/5 (attract) and 41/42 (stage 1-1) slots identical |
| BM64 container: no relocation | every container copy in RDRAM frames (Green Garden 1, Rock Garden, intro) compared with the extracted file | identical |
| BM64 decoder = game output | `bm64_model/check_textures.ts`: static decode vs triangles and bound textures of the RDRAM frame | 578: 802/802 triangles, 11/11 textures; 513: 152/152, 9/9; 315: 1,303/1,303, 26/26 |
| BM64 scale, handedness, lighting, cutout | renders with the camera extracted from RDRAM, next to the emulator frame | `bm64_model/renders/gg1_cmp_shot_vs_decode.png` (19.1 mean diff), `rockgarden_cmp_shot_vs_decode.png` (13.9) |
| Hero map decode, scale, handedness | map-only render at the game camera; replay of all draw calls of the frame | `hero_level/renders/cmp_s11_cam.png`, `frame_s11_cmp.png` (22.7) |
| Hero placement records | 16 placement records of stage 1-1 vs object positions in the frame | 16/16 match in x, z, yaw |
| SA NIFF relocation and segment resolver | every live NIFF in two RDRAM dumps; gSPSegment values in the frame list vs shape records (ROM analysis, cross-check) | all pointers = file + base; 27/27 and 38/45 draws match (other 7 = runtime texture sets) |
| SA texture upload emulation | static: textures produced by running all 4,750 lists vs direct decode of their records (`sa_niff/textest.ts`) | 3,940/3,941 identical |
| SA battle map, scale, handedness | Normal map rendered with the game camera from the frame matrix | `sa_niff/renders/battle2058_res17_gamecam_vs_emu.png` |
| Music data locations and VADPCM decoder | loop-state check: `ALADPCMloop.state` vs decoded PCM before the loop (audio analysis) | BM64 66/66, Hero 57/58, SA 105/113 exact |
| Sequence parser | parse every song to its end (audio analysis) | 155/155 with no errors |
| Output rate | AI_DACRATE in emulator audio captures | 1520 → 32,006 Hz in all three |
| Renderer timing and tuning | captured game audio (`audio/dumps/aicap/`) vs renders: RMS-envelope correlation and chroma | Hero song 24: NCC 0.88 at tempo 1.00, chroma 0.93 at 0 semitones; SA song 3 (bank 3): NCC 0.71, chroma 0.94 |
| Which song plays | RDRAM: sequence bytes and bank pointer of the sequence player (audio analysis) | SA intro 3, menu 1, character select 5, battle 42; Hero title 24; BM64 intro 1, title/menu 26, battle menu 29, battle 27 |
| Hero Sound Test mapping | code: song table 0x80334468 = 1..32 | song = BGM number + 1 |
| Hero debug menu | `write 0x8016E424 1`, pause, L | three debug pages shown |
| BM64 battle stage → overlay | emulator load log per stage-select position (`bm64_model/dbgdrive.log`) | Rock Garden 0x90, UP and Down 0x91, Pyramid 0x92, Greedy TraP 0x93, Top Rules 0x94 |
| BM64 lighting bake (world-space directions) | region means of a baked static render vs `shot_gg1_at_dump.png` (`bm64_model/light_test.ts`) | within about 3%; view-space variant clearly wrong |
| BM64 backgrounds | RDRAM frame lists in Pyramid and UP and Down (`bm64_model/rdram_pyramid.bin`, `rdram_updown.bin`) | TEXRECT backdrop from asset 662; translucent water quads 519/516 (alpha 0x99 ≈ measured 0.58) |
| SA lighting bake | env-record light evaluation vs light bytes in the frame; brightness vs emulator frames (`sa_niff/bakecheck.ts`) | bytes identical (Normal, area 2223); channel ratios 0.91–1.00 |
| SA animated water | two RDRAM dumps 50 frames apart in Park (`sa_niff/dumps/park4/5.bin`) | river vertex copy t +1000 = 20/frame, as the UV-track record predicts |
| SA battle maps | all 22 maps rendered with baked lights; 4 compared with reference shots at the game camera (`sa_niff/renders/battle_all/`) | geometry and camera coincide (mean diff 22.5–38.3, remainder = characters, blocks, objects) |
| SA first story area | map NIFF 177 at the captured camera vs screenshot (`sa_niff/renders/story2223_res177_gamecam_vs_emu.png`) | floor, bars and walls coincide |
| SA soft-block model | RDRAM resource cache walk + segment-4 bases (ROM analysis) | object id 25 → NIFF 586 at placement + (50, 0, 50) |
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
