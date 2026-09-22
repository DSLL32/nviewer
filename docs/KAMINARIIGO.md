# Kaminari no Gotoku: Choukousoku Igo — Nintendo 64 ROM format specification

This manual describes the preserved unreleased Japanese build of the Go game
*Kaminari no Gotoku: Choukousoku Igo* (雷のごとく 超高速囲碁). The supplied image is a
16 MiB physical dump whose unique, addressable program and asset data occupies the
first 4 MiB. It is a two-dimensional game and is documented for preservation and
ROM-hacking work rather than nviewer's 3D scene viewer.

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | Fixed ROM offsets and 34 table-driven graphics banks; ten uncompressed code overlays in a 20-slot table; no named filesystem. |
| Compression | Bespoke 4 KiB-window LZSS for graphics-bank tile, palette and pixel streams; one-bit packed fonts; Nintendo compressed-MIDI event back-references. |
| Graphics microcode | `gspFast3D.dram` family, RSP SW 2.0D dated 1996-04-01. |
| Geometry | No scene geometry; CPU-built RDP texture rectangles, text and solid primitives. |
| Textures | 361 CI4 and 98 CI8 images with RGBA5551 TLUTs, tiled by custom descriptors; two one-bit bitmap fonts. |
| Collision | Not applicable; board legality and Go rules are software state, not spatial collision. |
| Music driver | Nintendo `libaudio` `ALCSeq` sequence player and `ALSndPlayer`; five music sequences and five logical effects. |
| Audio microcode | Stock ABI1 `aspMain`. |
| Sample encoding | Nintendo VADPCM, order 2 with four predictors; all stored waves are one-shot. |
| Levels | No conventional levels; three title modes, match setup/gameplay, attract play, saved-game UI and a three-part tutorial. |
| Memory requirement | Base 4 MiB; the second 640×480 RGBA16 framebuffer ends exactly at `0x80400000`. |
| Viewer support | No scene-viewer implementation. Existing nviewer audio code can support the five songs with a thin fixed-offset adapter. |

### 1.2 ROM identification

Verified from the normalized big-endian ROM bytes. The internal title, maker,
game ID and region bytes are all zero; the image must therefore be identified by
hash and cartridge checksum rather than the usual N64 header fields.

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| Preserved unreleased Japanese build | — | — | 0 | 16 MiB (`0x1000000`) | `320C8BC2` | `FFD76984` | `28cd9cce375a37c120944121a4874a6acdb468a5` | 6102 | Unknown |

The revision value is only the raw byte at header `0x3F`; the otherwise blank
identity block does not establish a retail revision. The checksum pair exactly
recomputes with the CIC-6102 algorithm. IPL3 `[0x40,0x1000)` has CRC-32
`90BB6CB5`, the standard CIC-6102 signature.

The ROM's SHA-256 is
`1d94b0b4d1c02f7bb7c68bd68b47e0269ff0f8db35f3dbc775aab6a4ac2e037e`.

### 1.3 Terminology and conventions

Ranges are half-open. Multi-byte fields are big-endian unless stated otherwise.
RAM addresses are KSEG0. `Primary image` means the first 4 MiB, which contains
all unique bytes. `Bank` means one graphics descriptor/stream bundle, not an
audio instrument bank. `Module` means one entry in the code-overlay table.
Facts are identified by their verification method; uncertain interpretations
are explicitly marked **Hypothesis**.

### 1.4 Source archive

**Source-archive evidence:** the accompanying distribution ZIP contains the ROM
and a text NFO. The archive is 9,089,509 bytes and its SHA-256 is
`1b4d189dbc2612946c4c85bc7e898d01f42ec4bf828ac17d16e419f2a4a2146b`.

| ZIP member | Unpacked bytes | Deflated bytes | CRC-32 |
|---|---:|---:|---|
| `Kaminari no Gotoku Choukousoku Igo - CARROT.nfo` | 1,823 | 529 | `BA3E79F3` |
| `Kaminari no Gotoku Choukousoku Igo.z64` | 16,777,216 | 9,088,492 | `DAF9B36F` |

The NFO calls the image an unreleased Japanese 128-Mbit game and dates the
distribution 2026-09-22. Those are package claims, not ROM metadata or a build
timestamp.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

Verified by ROM bytes and entry-code disassembly. IPL3 enters ROM `0x1000` at
RAM `0x80000400`. The resident initialized image is ROM
`[0x1000,0xBFEB0)` → RAM `[0x80000400,0x800BF2B0)`. Startup clears BSS
`[0x800BF2B0,0x80174E00)`, sets the initial stack to `0x800C32B0`, and begins
the first thread at `0x800004AC`.

Ten uncompressed overlays share RAM `[0x802B9000,0x802D4000)`. The loader clears
the full `0x1B000`-byte window before copying one overlay and calls its common
entry at `0x802B9000`. The 20-slot ROM table is at `0x94E04`; its parallel
linked-RAM extent table is at `0x94EA4`.

Both tables contain 20 fixed eight-byte records. A zero pair denotes an empty
slot.

| Table | Record offset | Size | Type | Field | Pointer domain |
|---|---:|---:|---|---|---|
| ROM extents at `0x94E04` | `0x00` | 4 | `u32` | `start` | ROM-absolute start |
| ROM extents at `0x94E04` | `0x04` | 4 | `u32` | `end` | ROM-absolute exclusive end |
| RAM extents at `0x94EA4` | `0x00` | 4 | `u32` | `start` | linked KSEG0 start |
| RAM extents at `0x94EA4` | `0x04` | 4 | `u32` | `end` | linked KSEG0 exclusive end, including BSS |

| Module | ROM range | Stored size | Linked RAM range | RAM span |
|---:|---:|---:|---:|---:|
| 0 | `[0x239E70,0x241530)` | `0x76C0` | `[0x802B9000,0x802C5DE0)` | `0xCDE0` |
| 2 | `[0x241530,0x242930)` | `0x1400` | `[0x802B9000,0x802BEAF0)` | `0x5AF0` |
| 7 | `[0x242930,0x244DB0)` | `0x2480` | `[0x802B9000,0x802BBFE0)` | `0x2FE0` |
| 8 | `[0x244DB0,0x247DB0)` | `0x3000` | `[0x802B9000,0x802BC790)` | `0x3790` |
| 15 | `[0x247DB0,0x24AC50)` | `0x2EA0` | `[0x802B9000,0x802BC630)` | `0x3630` |
| 16 | `[0x24AC50,0x24D570)` | `0x2920` | `[0x802B9000,0x802BCD50)` | `0x3D50` |
| 10 | `[0x24D570,0x24DED0)` | `0x0960` | `[0x802B9000,0x802B9CC0)` | `0x0CC0` |
| 3 | `[0x24DED0,0x251950)` | `0x3A80` | `[0x802B9000,0x802BEA90)` | `0x5A90` |
| 4 | `[0x251950,0x254990)` | `0x3040` | `[0x802B9000,0x802BD030)` | `0x4030` |
| 5 | `[0x254990,0x2561A0)` | `0x1810` | `[0x802B9000,0x802BB800)` | `0x2800` |

Slots 1, 6, 9, 11–14 and 17–19 are zero. The ten populated ranges exactly tile
the overlay region; the extra linked size is zero-filled BSS, not compression.

### 2.2 Memory and address mapping

For the resident image, `RAM = ROM + 0x7FFFF400`. This mapping does not apply
to overlays, which all link at `0x802B9000`. A general arena occupies
approximately `[0x80174E00,0x802B8E00)`.

Normal boot selects a 640×480 RGBA16 double buffer at `0x802D4000` and
`0x8036A000`; each is `0x96000` bytes. A 320×240 VI configuration is retained
but is not selected by the observed startup path. No CPU or fixed-data reference
requires memory at or above the end of base RDRAM.

### 2.3 ROM map and asset organization

Verified from fixed loader constants, overlay tables, exhaustive graphics-bank
decoding and audio-structure parsing.

| ROM range | Stored size | Decoded size | Destination | Compression | Contents |
|---|---:|---:|---|---|---|
| `[0x000000,0x000040)` | `0x40` | same | header | none | N64 cartridge header |
| `[0x000040,0x001000)` | `0xFC0` | same | IPL3 | none | CIC-6102 boot code |
| `[0x001000,0x0BFEB0)` | `0xBEEB0` | same | `0x80000400` | none | resident executable and initialized data, including RSP tasks |
| `[0x0BFEB0,0x0C08B0)` | `0xA00` | runtime-expanded | heap textures | 1 bpp packing | 160 8×16 single-byte glyphs |
| `[0x0C08B0,0x0F5E78)` | `0x355C8` | runtime-expanded | heap textures | 1 bpp packing | 7,806 16×14 JIS-grid glyphs |
| `[0x0F5E78,0x0F73B0)` | `0x1538` | — | — | — | zero padding |
| `[0x0F73B0,0x239E5D)` | `0x142AAD` | `0x28DA00` pixel bytes plus records/TLUTs | graphics heap | mixed raw tables and custom LZSS | 34 graphics banks, 459 images, plus unclassified gap `[0x115C1E,0x115FB0)` |
| `[0x239E5D,0x239E70)` | `0x13` | — | — | — | alignment/padding before overlays |
| `[0x239E70,0x2561A0)` | `0x1C330` | varies with BSS | `0x802B9000` | none | ten code overlays |
| `[0x2561A0,0x2570D0)` | `0xF30` | same | audio heap | none | music `B1` bank control data |
| `[0x2570D0,0x2D48D0)` | `0x7D800` | VADPCM-decoded on demand | audio DMA cache | VADPCM | music wave table and six pad bytes |
| `[0x2D48D0,0x2D56C0)` | `0xDF0` | five event streams | sequence buffer | compressed MIDI | `S1` sequence archive and three pad bytes |
| `[0x2D56C0,0x2D5BE0)` | `0x520` | same | audio heap | none | effects `B1` bank control data |
| `[0x2D5BE0,0x2DBF00)` | `0x6320` | VADPCM-decoded on demand | audio DMA cache | VADPCM | effects wave table and four pad bytes |
| `[0x2DBF00,0x400000)` | `0x124100` | — | — | — | `0xFF` fill |
| `[0x400000,0x1000000)` | `0xC00000` | no unique data | — | — | shifted copies of primary-image suffixes plus `0xFF` fill |

The nonzero gap `[0x115C1E,0x115FB0)` lies between recognized graphics banks.
Its consumer and record format have not been established.

There is no named filesystem. CPU `0x80000F74` copies an explicit ROM offset to
RAM in chunks of at most `0x400`; CPU `0x80000E88` allocates and copies a ROM
range. Fonts use arithmetic indexing. Graphics and audio use fixed tables and
compiled-in offsets.

### 2.4 Compression formats

#### Graphics LZSS

Verified by disassembly of CPU `0x800068A0` and exhaustive decoding of all 102
graphics-bank streams. A stream has a four-byte little-endian decoded-size
header followed by flag groups. This local little-endian field is an exception
to normal N64 byte order.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `u32` | `decodedSize` | Requested output byte count; little-endian. |
| `0x04` | variable | `u8[]` | `tokens` | Flag groups and token data; no stored compressed size or terminator. |

Each flag byte supplies eight tokens from bit 7 to bit 0. A zero bit copies one
literal byte. A one bit consumes bytes `a,b`: distance is
`((a & 0x0F) << 8 | b) + 1`, and length is `(a >> 4) + 3`. Distances are
1–4,096 bytes, lengths are 3–18 bytes, and overlapping copies are allowed.
Input is staged through a `0x100`-byte DMA buffer. Decoding stops after the
declared output count.

| Bits | Mask | Name | Meaning |
|---:|---:|---|---|
| 15–12 | `0xF000` | `lengthMinus3` | High nibble of `a`; add 3. |
| 11–0 | `0x0FFF` | `distanceMinus1` | Low nibble of `a` followed by `b`; add 1. |

#### Other coding

Fonts are raw one-bit rows expanded into CI4 texels. Audio control data and
sequence archives have no outer compression. `ALCSeq` uses Nintendo's internal
`0xFE` back-reference event coding, and sample frames use Nintendo VADPCM; these
are described with their consumers under [Audio](#5-audio).

### 2.5 Loading process

Boot copies the resident image, clears BSS, initializes the two framebuffers,
graphics/audio tasks, arena and input subsystem, and enters a resident selector
loop. Module 8 implements the title/selector. Subsequent screens load one of the
ten overlays into the shared overlay window. Graphics-bank calls decode tile,
palette and pixel streams separately, expand eight-byte tiles into 16-byte
runtime records, and retain image descriptors as selectors. Audio loads both
bank-control files and the `S1` header at initialization; sequence payloads are
DMAed into a fixed `0x800`-byte buffer on demand, while VADPCM data streams from
ROM through the audio DMA cache.

### 2.6 Revision differences

Only one ROM image is known here. Its title and credits say ©1997 SETA and
license the algorithm from Toyogo, Inc. / David Fotland for 1990–1997. The
embedded engine's otherwise unused identification block instead retains a
1984–1995 copyright, `Rev 9.6`, and `Many Faces of Go, Release 3`. These identify
the component, not separate game revisions.

The 16 MiB file is not four exact mirror banks. For 4 MiB bank index `k=1..3`,
bank `k` equals primary bank bytes beginning at `k*0x2000`, followed by
`k*0x2000` bytes of `0xFF`. No unique alternate-build content exists outside
the first bank. The cause—mastering layout, cartridge mirroring or dumping
artifact—is **Unknown**.

## 3. Level data

### 3.1 Level catalog and identifiers

The game has no levels in the 3D sense. Verified by frame capture and overlay
flow, its principal user-visible states are:

| State | Content |
|---|---|
| Title / attract | Three modes (`仁王門`, `登竜門`, `囲碁入門`), 19×19 attract match and shoji-door wipe. |
| Match frontend | New game or record load; opponent, player colour, 9/13/19-line board, handicap and confirmation. |
| Match | Board, portrait/status panel, cursor, stones and six action icons. |
| Record UI | Three Controller Pak record slots. |
| Tutorial | Parts 1–3; part 1 exposes six lessons and board/character instruction screens. |

Runtime verified Human and COM1–COM5 choices. COM1 is labelled weak and COM5
strong. A stored COM6 label/value is discussed under unused content because it
is loadable but not offered by the normal selector.

### 3.2 Level container

Not applicable. Screens are assembled by overlay code from graphics-bank image
IDs and dynamic text. There is no general scene or level-container record.

### 3.3 Geometry

No model or scene geometry was found. The visible board, stones, faces, panels,
text and backgrounds are two-dimensional images or primitives.

### 3.4 Display lists and render state

Verified by disassembly. The CPU builds each frame's Fast3D list at
`0x800E8918`, appends display-list calls from active 496-byte render records,
and ends with `G_RDPFULLSYNC` and `G_ENDDL`. Sprite draws emit
`G_SETTIMG`, load sync/block, pipe sync, tile setup/size, `G_TEXRECT`, and the
two Fast3D RDP-half commands. CI8 selects a 256-entry TLUT; CI4 selects a
16-entry TLUT.

| Task part | ROM range | RAM address | Scheduled size |
|---|---:|---:|---:|
| RSP boot | `[0x92A90,0x92B60)` | `0x80091E90` | `0xD0` |
| Fast3D text | `[0x92B60,0x93B60)` | `0x80091F60` | `0x1000` |
| Fast3D data | `[0xBF3F0,0xBFBF0)` | `0x800BE7F0` | `0x800` |

Boot selects 640×480 output even though major art is authored at 320×240 and
scaled by the rectangle renderer. An optional depth-image clear is present but
disabled at boot; no resident-code write enabling it was found.

### 3.5 Textures and materials

#### Graphics-bank descriptor

Each bank begins with a raw array of 20-byte big-endian image descriptors.
Bank-specific code supplies the count.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | `u16` | `paletteUnit` | TLUT byte offset is `paletteUnit << 4`. |
| `0x02` | 2 | `u16` | `firstTile` | First expanded runtime tile; byte offset is `firstTile << 4`. |
| `0x04` | 2 | `u16` | `tileCount` | Number of tiles used by this image. |
| `0x06` | 2 | `u16` | `depth` | Indexed pixel size, observed 4 or 8. |
| `0x08` | 2 | `u16` | `widthMinusOne` | Output width minus one. |
| `0x0A` | 2 | `u16` | `heightMinusOne` | Output height minus one. |
| `0x0C` | 2 | `u16` | `nominalTileS` | Usually 16 or 32; precise engine name unknown. |
| `0x0E` | 2 | `u16` | `nominalTileT` | Usually 16 or 32; precise engine name unknown. |
| `0x10` | 1 | `u8` | `tileColumns` | Number of tile columns. |
| `0x11` | 1 | `u8` | `tileRows` | Number of tile rows. |
| `0x12` | 1 | `u8` | `lastColumnWidth` | Width of the final tile column. |
| `0x13` | 1 | `u8` | `lastRowHeight` | Height of the final tile row. |

CI4 TLUTs are 32 bytes; CI8 TLUTs are 512 bytes. Both contain RGBA5551 entries.
CI4 stores the high pixel nibble first. Tiles compose left-to-right, then
top-to-bottom.

Each bank is a code-sized sequence of the following elements; alignment bytes
may occur between compressed streams.

| Order | Count | Type | Field | Description |
|---:|---:|---|---|---|
| 0 | code-supplied | image descriptor | `images` | Raw 20-byte descriptors. |
| 1 | 1 | LZSS stream | `tiles` | Decodes to eight-byte tile records. |
| 2 | 1 | LZSS stream | `palettes` | Decodes to RGBA5551 TLUT bytes. |
| 3 | 1 | LZSS stream | `pixels` | Decodes to CI4/CI8 index bytes. |

#### Tile record

The decompressed tile stream contains eight-byte records. The loader expands
each to a 16-byte runtime record and rebases `pixelOffset` into the decoded
pixel blob.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 1 | `u8` | `nominalWidth` | Source line/width field copied to runtime halfword 0. |
| `0x01` | 1 | `u8` | `width` | Actual tile width. |
| `0x02` | 1 | `u8` | `height` | Actual tile height. |
| `0x03` | 1 | `u8` | `reserved` | Zero in all identified records. |
| `0x04` | 4 | `u32` | `pixelOffset` | Offset into decoded pixels; `0xFFFFFFFF` denotes an empty tile. |

An exhaustive parse found 34 banks, 459 descriptors, 28,076 tile records,
361 CI4 images, 98 CI8 images, and ten 320×240 composites. Every descriptor
has a valid tile range; descriptor use covers every decoded tile, palette byte
and pixel byte. The complete bank map is in [Appendix A](#appendix-a-graphics-bank-map).
Bank 5 contains three 368×368 CI4 9/13/19-line board grid or mask images; banks
7–16 hold the ten three-expression character sets; banks 31–33 are alternative
blue, red and gray/black 320×240 panel backgrounds.

#### Fonts

The single-byte font stores 160 8×16 glyphs at a 16-byte stride. The double-byte
font stores 7,806 16×14 glyphs at a 28-byte stride; the renderer appends two
blank rows. EUC-JP bytes are converted to JIS cells by clearing high bits,
subtracting `0x2121`, and using `row*94+column`. Both fonts are expanded
MSB-first into four-bit texture pixels.

### 3.6 Collision

Not applicable. Board positions are discrete Go intersections and are validated
by game logic.

### 3.7 Environment, sky, fog, and lighting

There is no 3D environment, sky, fog or lighting. Large CI4/CI8 images provide
the garden title photograph, dark setup/game backdrops, tutorial panels and
transition art. RDP colour and blending state supply tints and overlays.

### 3.8 Cameras and paths

Not applicable. Screens are fixed two-dimensional layouts. The shoji/aperture
transition and portrait-expression changes are code-driven descriptor changes,
not camera movement or stored animation tracks.

## 4. Objects

### 4.1 Placement records

The resident renderer maintains linked 496-byte render records beginning at RAM
`0x8013EA00`. Their complete field layout has not been recovered. They contain
or reference generated sublists and two-dimensional sprite state; there is no
general persistent object-placement archive.

### 4.2 Object and model formats

No 3D object/model format exists in the identified assets. Go stones, cursor
rings, icons, portraits and UI elements are graphics-bank images. Bank 0
contains 48×48/32×32 black and white stones, masks, three cursor sizes and two
specialized icons.

### 4.3 Skeletons and animation

There are no skeletons. Banks 7–16 each hold three 96×96 face/pose images for
one of ten people; code substitutes descriptors to change expression. The bank
format carries no frame duration.

### 4.4 Behaviors, triggers, and scripted objects

#### Input and state flow

The input layer handles two controller pads. Each frame records held, changed,
pressed and released button words plus signed stick axes, and derives repeat
events for 16 digital and four analog-direction controls. The menu help uses
the D-pad wording, while the tested emulator path responded reliably to the
analog stick.

Board points flatten as `y*boardSize+x`; supported sizes are 9, 13 and 19.
Normal 19×19 points are 0–360. Value 361 is treated as a special move consistent
with pass; 362 is a second out-of-board sentinel whose precise meaning varies
by caller.

Module 8 is the title/selector. Index 0 (`仁王門`) opens a two-item submenu:
new game enters module 7's setup then match module 0 with argument 0, while
record load enters module 16 then match module 0 with argument 2. Index 1
(`登竜門`) enters module 15's
ten-preset/progression/password setup and then match module 0; index 2
(`囲碁入門`) dispatches its three tutorial parts through modules 10+3, 4,
and 5. Idle timeout invokes module 2's demo. Module 16 handles Controller Pak
load and notification flow.

#### Controller Pak file

Verified by PFS call disassembly and runtime creation. Saves use controller 1's
Controller Pak, not cartridge EEPROM/SRAM.

The identity block is stored contiguously at ROM `0x94FA0`:

| ROM offset | Runtime address | Size | Type | Field | Value |
|---:|---:|---:|---|---|---|
| `0x94FA0` | `0x800943A0` | 2 | `u16` | companyCode | `0x3239` |
| `0x94FA2` | `0x800943A2` | 2 | `u16` | alignment | zero |
| `0x94FA4` | `0x800943A4` | 4 | `u32` | gameCode | `NIGJ` (`0x4E49474A`) |
| `0x94FA8` | `0x800943A8` | 16 | Pak-font bytes | gameName | `51 55 88 60 68 80 63 57 00 00 00 00 00 00 00 00` |
| `0x94FB8` | `0x800943B8` | 4 | Pak-font bytes | extension | all zero |
| `0x94FBC` | `0x800943BC` | 4 | `u32` | requestedSize | `0xC00` bytes / 12 Pak pages |

The file has three nominal `0x400`-byte slots, but the helpers transfer only
`0x300` bytes from each slot base.

| File range | Field | Description |
|---:|---|---|
| `[0x000,0x300)` | slot 0 data | Read/written in three `0x100`-byte operations. |
| `[0x300,0x400)` | slot 0 gap | Not transferred. |
| `[0x400,0x700)` | slot 1 data | Read/written in three `0x100`-byte operations. |
| `[0x700,0x800)` | slot 1 gap | Not transferred. |
| `[0x800,0xB00)` | slot 2 data | Read/written in three `0x100`-byte operations. |
| `[0xB00,0xC00)` | slot 2 gap | Not transferred. |

The live logical record has the following format before the defective transfer
truncation:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | `u16` | `valid` | Record-present marker. |
| `0x02` | 2 | `s16` | `opponent` | Human/COM index; value 6 denotes hidden COM6. |
| `0x04` | 2 | `u16` | `board` | Board-size enumeration: 0 = 9×9, 1 = 13×13, 2 = 19×19. |
| `0x06` | 2 | `u16` | `playerColour` | Black/white selection. |
| `0x08` | 2 | `u16` | `condition` | Komi/handicap condition. |
| `0x0A` | 2 | `u16` | `moveState` | Move or record state. |
| `0x0C` | `0x320` | `u16[0x190]` | `stateImage` | Direct big-endian game-state image; internal subfields are unknown. |

Only bytes through `0x2FF` are transferred, so the last `0x2C` serialized
state bytes are never persisted and reload from allocator contents. New-record creation
initializes only bytes `[0x000,0x01E)`, then writes all `0x300` transferred bytes.
A CRC-16/GENIBUS is computed over `0x400` bytes and
stored at work-buffer offset `0x400`, outside both the nominal slot and the
transferred range. Loads do not validate it, and post-write verification checks
only I/O success. This is verified unfinished persistence behavior in the
unreleased build, not a functional on-disk checksum.

## 5. Audio

### 5.1 Audio storage and banks

Verified from ROM structures, loader disassembly and complete VADPCM parsing.
The game uses stock `libaudio`; music and effects have separate revision-1
`B1` bank files and wave tables.

| Purpose | Control ROM | Wave-table ROM | Bank rate | Instruments/sounds |
|---|---:|---:|---:|---|
| Music | `[0x2561A0,0x2570D0)` | `[0x2570D0,0x2D48CA)` | 44,100 Hz | percussion + programs 1–4; 19 sounds/waves |
| Effects | `[0x2D56C0,0x2D5BE0)` | `[0x2D5BE0,0x2DBEFC)` | 44,100 Hz | one instrument; 12 sound records, five unique waves |

Initialization requests 44,100 Hz, creates 16 virtual and 16 physical voices,
256 updates, a `0x40000`-byte heap, sequence volume 24,000 and libaudio effect
type 1 (small room). Effects play at volume 30,000. The audio manager updates at
60 Hz; nominal buffers are 736 samples, with stored correction bounds of 720
and 832 samples.

### 5.2 Sequence format and driver

The `S1` archive at `0x2D48D0` contains exactly five Nintendo `ALCSeq`
sequences.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | `char[2]` | `magic` | `S1`. |
| `0x02` | 2 | `u16` | `count` | Five. |
| `0x04 + 8*i` | 4 | `u32` | `sequenceOffset` | Relative to archive start. |
| `0x08 + 8*i` | 4 | `u32` | `storedSize` | Event-stream bytes. |

Each sequence begins with sixteen big-endian track offsets followed by a `u32`
division at `0x40`; every sequence uses division 480. Track events use MIDI
running status, duration-bearing note-on events, and Nintendo `0xFE`
back-references. Meta `FF 2E` begins a loop and `FF 2D` ends it; loop count and
current value `0xFF` mean infinite repetition. Songs 0–2 use identical
`60→15420` loop intervals on every active track. Songs 3–4 end naturally.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x40` | `u32[16]` | `trackOffset` | Sequence-relative track starts; zero means absent. |
| `0x40` | 4 | `u32` | `division` | Ticks per quarter note; 480 in every sequence. |
| variable | variable | `u8[]` | `trackData` | Delta-time and compressed MIDI events at the referenced offsets. |

| Encoding | Length | Operands | Effect |
|---|---:|---|---|
| `8n` | 3 | key, velocity | Note Off. |
| `9n` | variable | key, velocity, duration VLQ | Note On with embedded duration. |
| `Bn` | 3 | controller, value | Controller change. |
| `Cn` | 2 | program | Program change. |
| `En` | 3 | LSB, MSB | Pitch bend. |
| `FF 51` | 5 | 24-bit tempo | Set microseconds per quarter note. |
| `FF 2F` | 2 | none | End track. |
| `FF 2E` | 4 | two marker bytes | Begin a per-track loop. |
| `FF 2D` | 8 | initial count, current count, back-distance `u32` | Loop backward; current `0xFF` repeats forever. |
| `FE FE` | 2 | none | Emit a literal `FE`. |
| `FE` block | 4 | back-distance `u16`, length `u8` | Copy `length` raw bytes beginning `back-distance` bytes before the `FE` marker; copied `FE` bytes are not recursively expanded. |

The active audio RSP instruction image is stock ABI1 `aspMain`; its `0xE20`
meaningful bytes and the first `0x2C0` data bytes match a known retail ABI1
image byte-for-byte.

### 5.3 Instruments and sample encoding

Every wave is `AL_ADPCM_WAVE` with an order-2, four-predictor book and a null
sample-loop pointer. Music repetition is entirely sequenced. Melodic instruments
use volume 127, pan 64, priority 5 and a 200-cent bend range. Percussion uses
priority 10. The music bank's common envelope is 5,000 µs attack, no decay,
and 100,000 µs release.

The music control file's bank record is at relative `0xF00`, its percussion
instrument is at `0xED8`, and melodic program pointers 1–4 are `0x198`,
`0x570`, `0x958`, and `0xB00`; program pointer 0 is null. The effects control
file's bank record is at relative `0x500` and its sole instrument is at
`0x4C0`. Both banks declare 44,100 Hz.

The complete music-wave catalog is in
[Appendix B](#appendix-b-music-wave-catalog). Book offsets, in catalog order,
are percussion `0xB48,0xC08,0xCC8,0xD88,0xE48`; program 1
`0x048,0x108`; program 2 `0x1E0,0x2A0,0x360,0x420,0x4E0`;
program 3 `0x5C8,0x688,0x748,0x808,0x8C8`; and program 4
`0x9B0,0xA70`, all relative to the music control file. Coefficients begin eight
bytes into each book.

The effects instrument has 12 sound records. Fixed mapping tables define
variation counts `[1,1,1,1,8]` and base sound indices `[0,1,2,3,4]` for the
five logical IDs. All effects use volume 127, pan 64, velocity 0–127, detune 0,
zero attack, decay volume 127, and 500 µs release.

| Effect ID | Sound records | Root | Book offset | Sample ROM | VADPCM bytes | Decoded samples |
|---:|---|---:|---:|---:|---:|---:|
| 0 | 0 | 1 | `0x048` | `0x2D5BE0` | `0x07FC` | 3,632 |
| 1 | 1 | 12 | `0x118` | `0x2D63E0` | `0x1B7E` | 12,512 |
| 2 | 2 | 23 | `0x1E8` | `0x2D7F60` | `0x1AB0` | 12,144 |
| 3 | 3 | 34 | `0x2B8` | `0x2D9A10` | `0x1BD0` | 12,656 |
| 4 | 4–11 | 114–121 | `0x3C0` | `0x2DB5E0` | `0x091C` | 4,144 |

Book offsets are effects-control-relative. Logical effect 4 round-robins eight
sound/key-map records which share the same wave and envelope; the game
explicitly sets playback pitch to 1.0, so seven are acoustically redundant.

### 5.4 Music catalog and loop points

The ROM contains no song names. Context is verified from call sites; the result
cue polarity remains uncertain.

| ID | ROM range | Size | Tracks | Programs | Tempo | Loop/end | Context |
|---:|---:|---:|---:|---|---|---|---|
| 0 | `[0x2D48FC,0x2D4D95)` | `0x499` | 3 | 1, 2 | 120 BPM, then 70 BPM at tick 60 | infinite `60→15420` | title/main selector |
| 1 | `[0x2D4D98,0x2D5297)` | `0x4FF` | 4 | 1, 3, 4, percussion | 120 BPM | infinite `60→15420` | secondary screens |
| 2 | `[0x2D5298,0x2D5559)` | `0x2C1` | 3 | 1, 3, percussion | 120 BPM, then 82 BPM at tick 60 | infinite `60→15420` | match |
| 3 | `[0x2D555C,0x2D55FD)` | `0xA1` | 1 | 1 | 75 BPM | ends tick 2182 | one match result |
| 4 | `[0x2D5600,0x2D56BD)` | `0xBD` | 2 | 1, percussion | 120 BPM, then 96 BPM at tick 60 | ends ticks 4382/4380 | alternate result(s) |

All five sequences are referenced. The hidden four-digit editor directly maps
codes `3300`–`3304` to these IDs. No second archive or unreferenced song was
found.

## 6. Unused and hidden content

### 6.1 Unreferenced assets

Verified by static cross-reference and full archive scans:

- The embedded engine-identification pointer table at ROM `0xBC660` is
  statically unreferenced. It names David Fotland, `Rev 9.6`, and
  `Many Faces of Go, Release 3`.
- CPU `0x80047310` is an uncalled recursive solution-tree reporter with six
  labels from Failure through Success; its only callers are itself and an
  otherwise unreferenced wrapper. CPU `0x80046F24` is an uncalled move
  formatter for coordinates, pass and invalid moves.
- A 26-entry verbose group-life explanation table, Black/White diagnostic
  table and board-dump format strings have no conventional references.
- Music program 4's low key zone 0–61 and sample at ROM `0x2BE0A0` are
  bank-referenced but never selected by any note in the complete song archive.
- No graphics descriptor, tile, palette region or pixel tail is structurally
  orphaned. Some broad Greek/Cyrillic/JIS font repertoire may be unused, but a
  complete glyph-reachability audit has not proven that.

Compact-encoded strings meaning `erase`, `erase ok`, `cancel`, `quit`, `game
notes`, `not used?`, and `no/data/to/erase` are active save/game-notes UI.
In particular, `not used?` labels a displayed state; these strings are not
developer leftovers.

### 6.2 Cut or inaccessible levels

There are no levels. Runtime did not reach the fiery full-screen image in bank
19 or the blue/red/gray two-panel backgrounds in banks 31–33, but all layouts
have code loader calls. They are usage-unknown assets, not established cuts.

The runtime opponent selector exposed Human and COM1–COM5. Module 7 explicitly
wraps the selectable opponent index between 0 and 5, but its fixed label table
contains Human plus COM1–COM6. Record field `0x02` stores the opponent index;
the load-summary renderer accepts index 6 without clamping and the load path
maps it to strength 6. COM6 is therefore code-referenced, displayable and
loadable from a crafted or older record, but is hidden/unselectable during a
normal new game.

### 6.3 Debug features

The release retains extensive thread-manager and Go-engine diagnostic text,
but all 40 direct diagnostic calls terminate at CPU `0x8000145C`, a variadic
ABI-shaped stub which only saves `a0`–`a3` and returns. Two active Japanese
stack-balance assertions consequently fail silently. No source paths, source
filenames, compiler banner or game build timestamp were found.

Verified hidden/system-facing features:

| Trigger | Effect |
|---|---|
| Hold Start during boot with a Controller Pak present | Enter a built-in 16-slot Pak browser/cleanup screen with file deletion. |
| If module 8's four-digit editor is reached, enter `3300`–`3304` | Play music IDs 0–4. |
| In the same editor, enter `3310`–`3314` | Play logical sound-effect IDs 0–4. |
| In the same editor, enter `5389` | Set global `0x80172468`; downstream meaning is unknown and it is not required for audio audition. |

The bounded runtime pass tested individual title-screen buttons/directions and
one simple chord without exposing a debug menu, counter or diagnostic overlay.
This is negative evidence, not proof that no other chord exists.

### 6.4 Prototype or revision-specific content

The image is plainly unfinished in several ways: header identity fields are
blank; its Pak record initialization writes uninitialized allocator contents;
the calculated save CRC is neither persisted nor validated; diagnostic output
is compiled to a sink; and the physical dump contains 12 MiB of shifted
redundancy. These are properties of this unreleased image. There is no second
revision or unique high-ROM build bank to compare.

The title credits ©1997 SETA and licenses the algorithm from Toyogo, Inc.
**Documented history:** preservation sources report that the game was publicly
announced but never released and place it around 1997. They disagree on the
precise romanization, with `Kaminari no Gotoku`, `Kaminari no Gotoki`, and
`Like Thunder Go` all in circulation; see [References](#83-references).

## 7. nviewer implementation

### 7.1 Module mapping

No game module is implemented. A future music-only adapter can use the existing
`src/rom/music/libultra.ts` bank/VADPCM support and the compressed-MIDI parser
used by Bomberman. Parse bank 0 as
`parseBank(rom, 0x2561A0, 0x2570D0, 0, null)`, parse each `S1` entry with that
compressed-MIDI parser, mark IDs 0–2 as looping and IDs 3–4 as one-shot, and
render at 44,100 Hz with 16 voices and sequence volume 24,000. Use neutral
labels `Sequence 0`–`Sequence 4`; the ROM stores no song names.

### 7.2 Supported features

None in the 3D viewer. All five sequences have been parsed and rendered through
the existing nviewer audio model without missing programs, invalid notes or
dropped voices. The common loop interval makes IDs 0–2 compatible with the
current single-loop abstraction.

### 7.3 Approximations and omissions

A music player would not yet reproduce the configured type-1 small-room effect
or exact N64 AI clock rounding. A general asset browser would additionally need
the custom LZSS decoder, graphics-bank parser, CI4/CI8 TLUT compositor, and both
font layouts. Fast3D triangle support is unnecessary for the verified visual
presentation.

## 8. Verification and remaining work

### 8.1 Verification evidence

| Area | Evidence |
|---|---|
| ROM identity | Whole-file hashes; decoded header; independently recomputed CIC-6102 cartridge checksum. |
| Program layout | Entry and loader disassembly; overlay tables; valid position-linked MIPS at every populated overlay start. |
| Compression | Decoder disassembly; all 102 graphics streams decode to declared sizes; every decoded record and byte range validates. |
| Graphics | Fast3D task ABI and fingerprint; complete 459-image decode; rendered frame correlation. |
| Runtime | One bounded emulator session covered title/attract, match setup, two plies, all six action icons, save slots, resignation, and tutorial part 1. |
| Save | PFS call graph, fixed file identity and I/O sizes; runtime creation of a 128 KiB Pak image. |
| Audio | Complete sequence/bank parse, VADPCM decode and structural offline renders; call-site mapping for every song/effect. |
| Unused content | Pointer/call cross-reference analysis with code-referenced UI strings excluded from the unused set. |

### 8.2 Known unknowns

- The exact purpose and format of graphics-adjacent gap
  `[0x115C1E,0x115FB0)`.
- Exact semantics of every preset/stage within the `登竜門` progression mode.
- Whether every one of the 459 image descriptors is reachable, especially the
  unseen full-screen backgrounds.
- Exact meanings of graphics descriptor fields `0x0C/0x0E` and tile byte
  `0x00`.
- Exact rules for scoring, suicide and ko/superko, and the COM strength/search
  parameters.
- The effect of hidden numeric code `5389`.
- The user-facing path, if any, into module 8's compiled four-digit editor.
- The internal subfield layout of the saved `0x320`-byte state image.
- Whether the two-pad input layer is used for an actual two-human match.
- Whether any overlay selects the retained low-resolution VI path or depth
  buffering.
- The visible Pak filename and exact no-Pak/error behavior on hardware.
- Exact result polarity for music IDs 3 and 4 and human-facing effect names.
- The cause of the shifted 16 MiB dump layout and the precise provenance/build
  date of the image.

### 8.3 References

- [NESWORLD: Kaminari no Gotoku: Choukousoku Igo (Unreleased)](https://www.64scener.com/index.php?page=kaminari-no-gotoku-choukousoku-igo-unreleased) — preserved announcement context, proposed features and cancellation history.
- [Unseen64: Like Thunder Go](https://www.unseen64.net/2010/10/26/like-thunder-go-n64-cancelled/) — contemporary magazine references and alternate title romanization.
- Nintendo 64 SDK ABI names are used descriptively from the binary-compatible public `libultra` interfaces; no proprietary source material was used.

## Appendix A: Graphics-bank map

Descriptor-table starts and counts are followed by compressed stream extents
and decoded record/byte counts. The end of a descriptor table is
`start + count*0x14`.

Bank 0 contains stones, cursors and Go icons; banks 1–5 contain title, menu,
setup and board art. Bank 6 mixes interface and illustrated face assets;
banks 7–16 are the ten three-expression character sets, and bank 17 is the
portrait set. Banks 18–20 contain gameplay and special-screen UI; banks 21–26
are help/dialogue collections; banks 27–29 are tutorial/board bundles; bank 30
holds status strips; and banks 31–33 are blue, red and gray/black panel
backgrounds. These uses are verified by decoded pixels and loader call sites;
reachability of every individual descriptor is not established.

| Bank | Descriptors | Tile stream / records | Palette stream / bytes | Pixel stream / bytes |
|---:|---|---|---|---|
| 0 | `0x0F73B0` / 23 | `[0x0F757C,0x0F7714)` / 165 | `[0x0F7714,0x0F77C8)` / `0xA0` | `[0x0F77CC,0x0F84DE)` / `0x2AC0` |
| 1 | `0x0F84E4` / 18 | `[0x0F864C,0x0F8B85)` / 473 | `[0x0F8B8C,0x0F8E6F)` / `0x320` | `[0x0F8E74,0x105056)` / `0x1B680` |
| 2 | `0x10505C` / 1 | `[0x105070,0x10528E)` / 160 | `[0x105290,0x1054D4)` / `0x200` | `[0x1054D8,0x115C1E)` / `0x12C00` |
| 3 | `0x115FB0` / 47 | `[0x11635C,0x117653)` / 1,745 | `[0x117654,0x11792B)` / `0x500` | `[0x11792C,0x131DE7)` / `0x3D300` |
| 4 | `0x131DEC` / 19 | `[0x131F68,0x13219F)` / 298 | `[0x1321A0,0x13232D)` / `0x300` | `[0x132330,0x133D6D)` / `0x3E40` |
| 5 | `0x133D70` / 3 | `[0x133DAC,0x1355D2)` / 3,174 | `[0x1355D4,0x1355FC)` / `0x20` | `[0x135604,0x138640)` / `0x19100` |
| 6 | `0x138644` / 8 | `[0x1386E4,0x138A02)` / 283 | `[0x138A04,0x138D83)` / `0x4C0` | `[0x138D84,0x13D344)` / `0x9200` |
| 7 | `0x13D344` / 3 | `[0x13D380,0x13D4B6)` / 108 | `[0x13D4B8,0x13DB2E)` / `0x600` | `[0x13DB30,0x141297)` / `0x5500` |
| 8 | `0x141298` / 3 | `[0x1412D4,0x141434)` / 108 | `[0x141434,0x141A96)` / `0x600` | `[0x141A9C,0x1462EB)` / `0x6600` |
| 9 | `0x1462EC` / 3 | `[0x146328,0x146459)` / 108 | `[0x146460,0x146A97)` / `0x600` | `[0x146A98,0x14A0DC)` / `0x5300` |
| 10 | `0x14A0E0` / 3 | `[0x14A11C,0x14A25C)` / 108 | `[0x14A25C,0x14A8A7)` / `0x600` | `[0x14A8AC,0x14E4B5)` / `0x5A00` |
| 11 | `0x14E4BC` / 3 | `[0x14E4F8,0x14E626)` / 108 | `[0x14E628,0x14EC5D)` / `0x600` | `[0x14EC60,0x1528BB)` / `0x5200` |
| 12 | `0x1528C0` / 3 | `[0x1528FC,0x152A29)` / 108 | `[0x152A2C,0x15302D)` / `0x600` | `[0x153034,0x1567AD)` / `0x5100` |
| 13 | `0x1567B4` / 3 | `[0x1567F0,0x15692A)` / 108 | `[0x156930,0x156F91)` / `0x600` | `[0x156F98,0x15B1BE)` / `0x5700` |
| 14 | `0x15B1C0` / 3 | `[0x15B1FC,0x15B32D)` / 108 | `[0x15B334,0x15B984)` / `0x600` | `[0x15B984,0x15FDD9)` / `0x5400` |
| 15 | `0x15FDDC` / 3 | `[0x15FE18,0x15FF60)` / 108 | `[0x15FF68,0x160569)` / `0x600` | `[0x160570,0x16477A)` / `0x5E00` |
| 16 | `0x164780` / 3 | `[0x1647BC,0x16491E)` / 108 | `[0x164924,0x164FB4)` / `0x600` | `[0x164FB4,0x1692E3)` / `0x6800` |
| 17 | `0x1692E4` / 18 | `[0x16944C,0x16993B)` / 432 | `[0x16993C,0x16B9F2)` / `0x2400` | `[0x16B9F4,0x17ACC4)` / `0x16700` |
| 18 | `0x17ACC4` / 30 | `[0x17AF1C,0x17B77C)` / 874 | `[0x17B77C,0x17BD19)` / `0x680` | `[0x17BD1C,0x18EA83)` / `0x1D000` |
| 19 | `0x18EA84` / 56 | `[0x18EEE4,0x1903BB)` / 1,956 | `[0x1903BC,0x190993)` / `0x780` | `[0x190994,0x1AFD10)` / `0x41E80` |
| 20 | `0x1AFD14` / 17 | `[0x1AFE68,0x1B1510)` / 2,485 | `[0x1B1510,0x1B238F)` / `0x10C0` | `[0x1B2390,0x1C3E5E)` / `0x37380` |
| 21 | `0x1C3E60` / 10 | `[0x1C3F28,0x1C4586)` / 784 | `[0x1C4588,0x1C45C2)` / `0x40` | `[0x1C45C8,0x1C78DA)` / `0xBD80` |
| 22 | `0x1C78E0` / 19 | `[0x1C7A5C,0x1C87AD)` / 1,540 | `[0x1C87B4,0x1C87EE)` / `0x40` | `[0x1C87F4,0x1D0161)` / `0x1AF00` |
| 23 | `0x1D0164` / 22 | `[0x1D031C,0x1D0FDA)` / 1,792 | `[0x1D0FDC,0x1D1016)` / `0x40` | `[0x1D101C,0x1D6C52)` / `0x15A00` |
| 24 | `0x1D6C54` / 19 | `[0x1D6DD0,0x1D79D9)` / 1,540 | `[0x1D79E0,0x1D7A1A)` / `0x40` | `[0x1D7A20,0x1DD5A5)` / `0x16480` |
| 25 | `0x1DD5A8` / 17 | `[0x1DD6FC,0x1DE198)` / 1,372 | `[0x1DE19C,0x1DE1D6)` / `0x40` | `[0x1DE1DC,0x1E321E)` / `0x12F00` |
| 26 | `0x1E3224` / 6 | `[0x1E329C,0x1E3646)` / 448 | `[0x1E364C,0x1E3686)` / `0x40` | `[0x1E368C,0x1E5513)` / `0x6F00` |
| 27 | `0x1E5514` / 14 | `[0x1E562C,0x1E5CD3)` / 738 | `[0x1E5CD4,0x1E61FB)` / `0x4E0` | `[0x1E61FC,0x1EDE0C)` / `0xF380` |
| 28 | `0x1EDE0C` / 31 | `[0x1EE078,0x1EF60D)` / 2,623 | `[0x1EF610,0x1F0230)` / `0xF20` | `[0x1F0230,0x203C5E)` / `0x30800` |
| 29 | `0x203C60` / 34 | `[0x203F08,0x20550D)` / 2,950 | `[0x205510,0x2060E9)` / `0xDA0` | `[0x2060F0,0x218B66)` / `0x2C800` |
| 30 | `0x218B68` / 14 | `[0x218C80,0x2192F0)` / 924 | `[0x2192F0,0x21933B)` / `0x40` | `[0x219340,0x21CAAD)` / `0xA500` |
| 31 | `0x21CAB0` / 1 | `[0x21CAC4,0x21CBD9)` / 80 | `[0x21CBDC,0x21CC61)` / `0x200` | `[0x21CC64,0x226E32)` / `0x12C00` |
| 32 | `0x226E34` / 1 | `[0x226E48,0x226F11)` / 80 | `[0x226F18,0x226F96)` / `0x200` | `[0x226F98,0x22D204)` / `0xCA00` |
| 33 | `0x22D208` / 1 | `[0x22D21C,0x22D331)` / 80 | `[0x22D334,0x22D3FF)` / `0x200` | `[0x22D404,0x239E5D)` / `0x12C00` |

## Appendix B: Music-wave catalog

Decoded sample count follows Nintendo's 9-byte/16-sample VADPCM frame rule.
Approximate seconds assume unity pitch at 44,100 Hz.

| Instrument | Sound | Key range | Root | Wave-table offset | Sample ROM | VADPCM bytes | Decoded samples | Seconds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| percussion | 0 | 42 | 42 | `0x6D5D8` | `0x2C46A8` | `0x1248` | 8,320 | 0.189 |
| percussion | 1 | 46 | 46 | `0x6E820` | `0x2C58F0` | `0x17AA` | 10,768 | 0.244 |
| percussion | 2 | 49 | 49 | `0x6FFD0` | `0x2C70A0` | `0x8CFA` | 64,160 | 1.455 |
| percussion | 3 | 60 | 60 | `0x78CD0` | `0x2CFDA0` | `0x2130` | 15,104 | 0.342 |
| percussion | 4 | 61 | 61 | `0x7AE00` | `0x2D1ED0` | `0x29FA` | 19,104 | 0.433 |
| program 1 | 0 | 0–63 | 63 | `0x00000` | `0x2570D0` | `0x9292` | 66,704 | 1.513 |
| program 1 | 1 | 64–87 | 75 | `0x09298` | `0x260368` | `0x8B54` | 63,408 | 1.438 |
| program 2 | 0 | 0–74 | 74 | `0x11DF0` | `0x268EC0` | `0xB3D4` | 81,840 | 1.856 |
| program 2 | 1 | 75–76 | 76 | `0x1D1C8` | `0x274298` | `0xB3D4` | 81,840 | 1.856 |
| program 2 | 2 | 77–79 | 79 | `0x285A0` | `0x27F670` | `0xB3D4` | 81,840 | 1.856 |
| program 2 | 3 | 80–81 | 81 | `0x33978` | `0x28AA48` | `0xB3D4` | 81,840 | 1.856 |
| program 2 | 4 | 82–95 | 83 | `0x3ED50` | `0x295E20` | `0xB3D4` | 81,840 | 1.856 |
| program 3 | 0 | 0–39 | 39 | `0x4A128` | `0x2A11F8` | `0x5C88` | 42,112 | 0.955 |
| program 3 | 1 | 40–42 | 42 | `0x4FDB0` | `0x2A6E80` | `0x5C88` | 42,112 | 0.955 |
| program 3 | 2 | 43–45 | 45 | `0x55A38` | `0x2ACB08` | `0x5C88` | 42,112 | 0.955 |
| program 3 | 3 | 46–48 | 48 | `0x5B6C0` | `0x2B2790` | `0x5C88` | 42,112 | 0.955 |
| program 3 | 4 | 49–66 | 54 | `0x61348` | `0x2B8418` | `0x5C88` | 42,112 | 0.955 |
| program 4 | 0 | 0–61 | 61 | `0x66FD0` | `0x2BE0A0` | `0x3532` | 24,208 | 0.549 |
| program 4 | 1 | 62–85 | 73 | `0x6A508` | `0x2C15D8` | `0x30CC` | 22,208 | 0.504 |
