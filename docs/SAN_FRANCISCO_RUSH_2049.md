# San Francisco Rush 2049 — Nintendo 64 ROM format specification

This document describes the USA Nintendo 64 release of *San Francisco Rush
2049*. It is a binary-format reference for ROM analysis and for the `nviewer`
implementation. Unless marked as a hypothesis, claims below are verified from
ROM bytes, decompressed data, MIPS disassembly, emulator RAM, or captured
audio/video.

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | 182-entry numeric file table in the main executable |
| Compression | Raw files, custom LZSS, and raw RFC 1951 DEFLATE |
| Graphics microcode | `F3DEX.NoN fifo 2.08` |
| Geometry | Tagged model containers, F3DEX2 display lists, and named placements |
| Textures | RDP-native CI, RGBA, IA, and I images referenced by display lists |
| Collision | Per-level polygon mesh with quadtree, course sections, and scripted alternates |
| Music driver | Factor 5 MusyX with SNG sequences |
| Audio microcode | Custom MusyX task |
| Sample encoding | MusyX N64 ADPCM |
| Levels | 6 race tracks, 8 battle arenas, 4 stunt arenas, 1 obstacle course |
| Memory requirement | **Unknown** |
| Viewer support | USA revision 0; all 19 levels, collision, scripted-object start states, and 12 songs |

### 1.2 ROM identification

Hashes apply to the canonical `.z64` image.

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| USA | `Rush 2049` | `NRUE` | 0 | 12 MiB | `B9A9ECA2` | `17AAE48E` | `3f99351d7bb61656614bdb2aa1a90cfe55d1922c` | CIC-6102 | **Unknown** |

The header values and full-file SHA-1 were read directly from the verified ROM.
The emulator identifies the IPL3 as CIC type X102. The graphics task contains
the identification string `RSP Gfx ucode F3DEX.NoN fifo 2.08 Yoshitaka
Yasumoto 1999 Nintendo.`

### 1.3 Terminology and conventions

- Ranges are half-open: `[start, end)`.
- Offsets and addresses are hexadecimal unless stated otherwise.
- Multi-byte fields are big-endian.
- `file n` means numeric file-table entry `n` after decompression.
- A container “section count” is tag-dependent: it is an element count for
  record sections and a byte size for blob sections.
- The game uses a row-vector placement matrix: `world = local × R + t`.
- Stored render coordinates are transformed to nviewer's right-handed, Y-up
  frame by mirroring X.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

The boot program is loaded from ROM `0x1000` at `0x80000400`. At power-on it
inflates the main executable from ROM `0xB0CB10` to `0x80086A50`. The decoded
image is exactly `0x9DFA0` bytes.

| ROM range or address | Destination | Contents | Evidence |
|---|---:|---|---|
| `[0x000000,0x001000)` | — | N64 header and CIC-NUS-6102 IPL3 | ROM bytes; emulator CIC identification |
| `0x001000` onward | `0x80000400` | Boot program, decompressed-size table, and resident support code | disassembly |
| `[0x02F4E0,0xB0CB10)` | Allocated by loader | 182 table-addressed asset files | file-offset table and terminal offset |
| `0xB0CB10` | `0x80086A50` | Raw-DEFLATE main executable, decoded size `0x9DFA0` | boot inflate path; decoded image |

The main stream has no zlib or gzip wrapper. Its final DEFLATE block determines
the packed end.

### 2.2 Memory and address mapping

File-table offsets are physical ROM addresses. Level-container pointers are
offsets within their decoded file rather than N64 segmented addresses.
Texture-image addresses are the exception: inside display-list texture setup,
they are relative to the model container's `IMAG` section.

| Purpose | RAM address | Location |
|---|---:|---|
| Main image base | `0x80086A50` | Decoded executable |
| File ROM offsets | `0x8011B5BC` | Main image, 183 `u32` values including terminal offset |
| File compression types | `0x80123564` | Main image, 182 `u32` values |
| File decoded sizes | `0x8002E580` | Boot image, 182 `u32` values |

### 2.3 ROM map and asset organization

Each file-table entry is assembled from three parallel arrays:

| Array base | Offset | Size | Type | Field | Description |
|---|---:|---:|---|---|---|
| ROM-offset array | 4 × i | 4 | u32 | romStart | Inclusive physical ROM start. |
| ROM-offset array | 4 × (i + 1) | 4 | u32 | romEnd | Exclusive physical ROM end. |
| Compression array | 4 × i | 4 | u32 | type | 0 raw, 1 LZSS, 2 raw DEFLATE. |
| Decoded-size array | 4 × i | 4 | u32 | decodedSize | Decoded byte count. |

The 182 entries comprise one raw file, 48 LZSS files, and 133 raw-DEFLATE
files. File 9, the MusyX sample payload, is the raw entry.

Level-related file families are:

| Purpose | File numbers |
|---|---|
| Shared object library | 68 |
| Shared battle pickups | 76 |
| Per-race prop libraries | 82–87 |
| Level model containers | 101–119 |
| Level placement containers | 120–138 |
| Level collision | 139–157 |

Music occupies files 6–21 as described in section 5.

### 2.4 Compression formats

Reference codecs: [Rush 2049 LZSS](compression/rush-lzss.md) and
[raw DEFLATE](compression/raw-deflate.md).

#### 2.4.1 LZSS

Flag bytes are consumed least-significant bit first. A set bit encodes one
literal byte. A clear bit encodes a two-byte match:

<table class="byte-layout">
<thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
<tbody><tr><th><code>0x00</code></th><td colspan="2"><code>match: u16</code></td><td colspan="6">—</td></tr></tbody>
</table>

| Field | Bits | Meaning |
|---|---:|---|
| Distance | `b0[7:4] || b1[7:0]` | 12-bit backward distance from the output cursor |
| Length | `b0[3:0] + 2` | Number of bytes copied |
| Terminator | `b0 = 0`, `b1 = 0` | End of stream |

The decoded-size table supplies an upper bound and expected output length. This
codec is verified against `lz_decode` at `0x80004AFC` and all 48 LZSS files.

#### 2.4.2 DEFLATE

Type 2 files and the main executable use RFC 1951 DEFLATE streams without zlib
or gzip headers. Stored, fixed-Huffman, and dynamic-Huffman blocks occur. The
game contains a port of gzip's `inflate.c`; nviewer's independent decoder
handles the same raw block stream.

### 2.5 Loading process

For level index `n` in `0..18`, the game loads model file `101+n`, placement
file `120+n`, and collision file `139+n`. Placement names resolve against the
level's own model container first. On demand, race levels also load prop file
`82+n`; every level may resolve shared objects from files 68 and 76.

The model and placement containers use a common trailer directory described in
section 3.2. Display lists resolve vertices and commands as file offsets and
texture images relative to `IMAG`.

### 2.6 Revision differences

Only USA revision 0 has been structurally verified and is accepted by nviewer.
No claim is made that file numbers, executable addresses, or record layouts are
shared by other regions or revisions.

## 3. Level data

### 3.1 Level catalog and identifiers

| Index | Kind | Display name | Internal identifier | Model | Placement | Collision |
|---:|---|---|---|---:|---:|---:|
| 0 | Race | Track 1 | `TRACK1` | 101 | 120 | 139 |
| 1 | Race | Track 2 | `TRACK2` | 102 | 121 | 140 |
| 2 | Race | Track 3 | `TRACK3` | 103 | 122 | 141 |
| 3 | Race | Track 4 | `TRACK4` | 104 | 123 | 142 |
| 4 | Race | Track 5 | `TRACK5` | 105 | 124 | 143 |
| 5 | Race | Track 6 | `TRACK6` | 106 | 125 | 144 |
| 6 | Battle | Battle 1 | `DM1` | 107 | 126 | 145 |
| 7 | Battle | Battle 2 | `DM2` | 108 | 127 | 146 |
| 8 | Battle | Battle 3 | `DM3` | 109 | 128 | 147 |
| 9 | Battle | Battle 4 | `DM4` | 110 | 129 | 148 |
| 10 | Battle | Battle 5 | `DM5` | 111 | 130 | 149 |
| 11 | Battle | Battle 6 | `DM6` | 112 | 131 | 150 |
| 12 | Battle | Battle 7 | `DM7` | 113 | 132 | 151 |
| 13 | Battle | Battle 8 | `DM8` | 114 | 133 | 152 |
| 14 | Stunt | Stunt 1 | `STUNT1` | 115 | 134 | 153 |
| 15 | Stunt | Stunt 2 | `STUNT2` | 116 | 135 | 154 |
| 16 | Stunt | Stunt 3 | `STUNT3` | 117 | 136 | 155 |
| 17 | Stunt | Stunt 4 | `STUNT4` | 118 | 137 | 156 |
| 18 | Obstacle | Obstacle Course | `OBSTACLE1` | 119 | 138 | 157 |

### 3.2 Level container

The file header points to 12-byte section descriptors, which continue to the end of the file.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | directory | File-relative offset of the first section descriptor. |

Section descriptor:

<table class="byte-layout">
<thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
<tbody>
<tr><th><code>0x00</code></th><td colspan="4"><code>tag: char[4]</code></td><td colspan="4"><code>offset: u32</code></td></tr>
<tr><th><code>0x08</code></th><td colspan="4"><code>countOrSize: u32</code></td><td colspan="4">—</td></tr>
</tbody>
</table>

| Field | Description |
|---|---|
| `tag` | Four ASCII bytes identifying the section |
| `offset` | File-relative section start |
| `countOrSize` | Element count for record sections; byte length for blob sections |

### 3.3 Geometry

#### 3.3.1 Model container

| Tag | Contents | Unit |
|---|---|---|
| `IMAG` | Texture texel payload | Bytes |
| `TXLD` | Texture-setup display lists | Bytes |
| `OBHD` | Object headers | 88-byte records |
| `PLHD` | Named palette descriptors | Records |
| `TXHD` | Named texture descriptors | Records |
| `OBJS` | Vertices and F3DEX2 display lists | Bytes |
| `PATH` | Scripted-object keyframes | Bytes |
| `PTHD` | Scripted-object path headers | 36-byte records |

`PATH` and `PTHD` occur on race tracks and the obstacle course; they are absent
from ordinary battle and stunt containers.

An object header has four LOD slots:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x10` | `char[16]` | `name` | Placement lookup key; commonly limited to 15 visible characters |
| `0x10` | `0x04` | `f32` | `radius` | Object bounding radius |
| `0x14` | `0x04` | `u32` | `unknown_14` | Not identified |
| `0x18` | `0x40` | `Lod[4]` | `lod` | Four 16-byte LOD slots |

Each LOD slot is:

<table class="byte-layout">
<thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
<tbody>
<tr><th><code>0x00</code></th><td colspan="4"><code>flags: u32</code></td><td colspan="4"><code>maxDistance: f32</code></td></tr>
<tr><th><code>0x08</code></th><td colspan="4"><code>displayList: u32</code></td><td colspan="4"><code>vertices: u32</code></td></tr>
</tbody>
</table>

Both pointers are file-relative. Slot 0 is the most detailed representation and
is the one decoded by nviewer. Vertices use the standard 16-byte N64 `Vtx`
layout; model-space coordinates are 1/16 world unit.

#### 3.3.2 Placement container

Placement files contain these tags:

| Tag | Contents | Status |
|---|---|---|
| `WHDR` | 24-byte world header; internal level identifier at `+0x08` | Decoded |
| `WOBJ` | Named placed objects | Decoded |
| `GTLD` | Game-specific level data | Not decoded by nviewer |
| `GDAT` | Game-specific level data | Not decoded by nviewer |

Each `WOBJ` record is 104 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x10` | `char[16]` | `name` | Model lookup key |
| `0x10` | `0x24` | `f32[9]` | `basis` | Row-major rotation/scale matrix |
| `0x34` | `0x0C` | `f32[3]` | `translation` | World position |
| `0x40` | `0x04` | `u32` | `flagsOrId_40` | Not fully identified |
| `0x44` | `0x02` | `u16` | `unknown_44` | Not identified |
| `0x46` | `0x02` | `u16` | `unknown_46` | Not identified |
| `0x48` | `0x04` | `u32` | `unknown_48` | Not identified |
| `0x4C` | `0x04` | `u32` | `unknown_4C` | Not identified |
| `0x50` | `0x18` | `f32[6]` | `bounds` | Stored minimum and maximum bounds |

Stored model names may carry a `G1` suffix and are truncated to 15 characters.
Placements of direction-specific objects may append `_FW` or `_BW`. Resolution
tries an exact name, the directionless base, the base plus `G1`, and finally a
prefix match that does not consume another digit.

### 3.4 Display lists and render state

Object geometry uses F3DEX2 display lists. Display-list and vertex pointers are
file-relative. Texture setup is commonly factored into `TXLD` sublists;
`G_SETTIMG` addresses are relative to `IMAG`.

Back-face culling is expected. Authored double-sided surfaces use
opposite-winding triangle pairs. Commands in the object and texture sublists
establish tile, combiner, geometry, and render state.

### 3.5 Textures and materials

The game uploads texture data through the RDP's 4 KiB TMEM. `G_SETTILE`
supplies line length and TMEM position. Odd texel rows swap the two 32-bit
halves of each 64-bit word; `G_LOADBLOCK` also performs row-dependent swaps
when `dxt` is nonzero. Files using `dxt = 0` may therefore contain pre-swapped
rows. Treating the data as a conventional linear bitmap creates an interlaced
appearance.

Observed display lists use standard CI, RGBA, IA, and intensity formats,
RGBA16/IA16 TLUT modes, texture wrapping, mirroring, clamping, and normal RDP
combine/render state. `PLHD` and `TXHD` provide named palette and texture
descriptors; display-list state remains authoritative for the active format,
size, tile line, wrapping, and sampling behavior.

### 3.6 Collision

#### 3.6.1 File organization

The decoded collision stream contains:

1. a 16-byte header;
2. 132-byte course/path sections;
3. 20-byte ground-plane quadtree nodes;
4. 24-byte polygon records;
5. 8-byte vertices;
6. 32-byte scripted alternate records;
7. polygon index streams; and
8. quadtree leaf lists.

<table class="byte-layout">
<thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
<tbody>
<tr><th><code>0x00</code></th><td colspan="2"><code>sectionCount: u16</code></td><td colspan="2"><code>nodeCount: u16</code></td><td colspan="2"><code>polygonCount: u16</code></td><td colspan="2"><code>vertexCount: u16</code></td></tr>
<tr><th><code>0x08</code></th><td colspan="2"><code>alternateCount: u16</code></td><td colspan="2"><code>indexStreamBytes: u16</code></td><td colspan="4"><code>leafListBytes: u32</code></td></tr>
</tbody>
</table>

Race files have course sections; arenas normally do not.

#### 3.6.2 Polygon record

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x02` | `u16` | `flags` | Low nibble is the surface class |
| `0x02` | `0x02` | `u16` | `countWord` | Low nibble is the vertex count |
| `0x04` | `0x12` | `s16[9]` | `basis` | 3×3 Q14 plane basis |
| `0x16` | `0x02` | `u16` | `streamOffset` | Offset into the index-stream area |

Game code at `0x800AE0D8` interprets surface flags. Class 5 is a wall; class 15
marks collision switched off by a scripted object. Most other classes are
floors but their material semantics are not named with confidence.

#### 3.6.3 Vertex and index stream

<table class="byte-layout">
<thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
<tbody><tr><th><code>0x00</code></th><td colspan="2"><code>x: s16</code></td><td colspan="2"><code>y: s16</code></td><td colspan="2"><code>z: s16</code></td><td colspan="2"><code>fractions: u16</code></td></tr></tbody>
</table>

Each coordinate is `(integer × 32 + fraction) / 32`. Fraction bits 14–10 are
X, 9–5 are Y, and 4–0 are Z.

An index stream consists principally of big-endian `u16` vertex indices. After
an index, a byte `>= 0xE0` adds `byte & 0x1F` consecutive indices. The first
vertex supplies the polygon's world origin. Remaining vertices lie in its
plane and are transformed with the transpose of the stored basis.

#### 3.6.4 Scripted alternates

Because the 18-byte basis crosses eight-byte display rows, a field table is
clearer than a byte grid for this record:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x02` | `u16` | `group` | Scripted-object collision group |
| `0x02` | `0x02` | `u16` | `polygon` | Polygon record to replace |
| `0x04` | `0x12` | `s16[9]` | `basis` | Alternate Q14 basis |
| `0x16` | `0x02` | `u16` | `vertexRef` | Vertex reference; detailed semantics not fully identified |
| `0x18` | `0x08` | vertex | `origin` | Alternate world origin |

Code at `0x800B2D20` copies a group's records over active polygons when a
scripted object moves. Code at `0x800B2CB4` disables a group by setting polygon
flags to `0x000F`. Doors, trapdoors, rotors, and spiked balls use this mechanism.

### 3.7 Environment, sky, fog, and lighting

Most model containers retain an unplaced object whose name ends in `SKY`
(`SKYSKY`, or `STUNTSKYSKY` on Stunt 4). It is a camera-centered sky mesh,
identified by its placement-independent behavior and verified against game
frames. Levels without such an object use their normal clear/background path.

Captured race display lists use fog color `(150,150,190,255)`, near/far
projection values 40 and 32040 vertex units, and fog position 1000–1042. The
fog interval lies beyond the far plane, so no fog is visible. nviewer therefore
does not expose active Rush 2049 fog.

Lighting and materials are established by display-list and vertex state.
Dynamic vehicle and effect lighting is outside the static level decoder.

### 3.8 Cameras and paths

`PTHD` records are 36 bytes. Their first 16 bytes name the moving object; the
file-relative `PATH` pointer is at `+0x1C`. The remaining flags and identifiers
are not fully named.

Each PATH keyframe is 68 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x0C` | `f32[3]` | `position` | World position |
| `0x0C` | `0x0C` | `f32[3]` | `direction` | Direction vector |
| `0x18` | `0x0C` | `f32[3]` | `scale` | XYZ scale |
| `0x24` | `0x10` | `f32[4]` | `rotation` | Quaternion `(x,y,z,w)`; all zero when unused |
| `0x34` | `0x10` | `f32[4]` | `timingOrParams` | Timing/behavior values; detailed semantics incomplete |

Some paths begin with an origin keyframe followed by the effective start.
Course collision sections also store path position, orientation, and extents,
but their complete 132-byte layout is not decoded. Camera behavior is
code-driven; nviewer derives an inspection camera rather than reproducing a
race or attract camera.

## 4. Objects

### 4.1 Placement records

Static instances come from `WOBJ`. Names resolve against the level model first,
then the per-race prop library and shared libraries. The latter supply trees,
signs, coins, battle weapons, and other reusable props.

### 4.2 Object and model formats

Each `OBHD` record carries four LOD slots with maximum-distance thresholds.
nviewer renders slot 0, the most detailed model. The other slots remain in the
container and can be decoded with the same F3DEX2 rules.

### 4.3 Skeletons and animation

Objects such as doors, trains, rotors, trapdoors, and obstacle-course hazards
may exist only in `PTHD`, without a `WOBJ` entry. Their PATH keyframes provide
translation, scale, and quaternion rotation. Collision alternate groups mirror
their scripted states.

nviewer displays each scripted object at the first effective keyframe. It does
not animate the path or switch collision states over time.

### 4.4 Behaviors, triggers, and scripted objects

`GTLD`, `GDAT`, path timing values, race logic, pickups, and trigger semantics
are not fully decoded. The static files establish geometry and initial object
states but not complete gameplay behavior.

## 5. Audio

### 5.1 Audio storage and banks

The game uses Factor 5's MusyX system. Music is sequenced and mixed at 22050 Hz;
it is not streamed PCM music.

| File | Contents |
|---:|---|
| 6 | MusyX project: song groups 0–11, program pages, and MIDI setups; groups 12–15 are SFX |
| 7 | MusyX pool: SoundMacro programs and ADSR tables |
| 8 | Sample directory, 195 entries |
| 9 | Raw MusyX ADPCM sample payload, streamed from ROM |
| 10–21 | SNG song 0–11 |

Song `n` uses project group `n`, MIDI setup `n`, and file `10+n`. The music-track
names are read from the pointer table at main-image address `0x80110030`.

### 5.2 Sequence format and driver

SNG data contains a region-index table, channel map, tempo table, initial tempo,
per-channel or shared loop-start ticks, and as many as 64 tracks. Timing uses
384 ticks per beat. Track region entries select delta-time event streams and
encode terminal or loop-back records. Event streams contain note, program, and
controller operations with run-length delta times.

The complete SNG header varies with track count and loop mode, so a field table
is more useful than a fixed byte grid:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x04 | 4 | u32 | regionIndexOffset | File-relative pointer to event-region offsets. |
| 0x0C | 4 | u32 | tempoTableOffset | Pointer to eight-byte tempo records; tick 0xFFFFFFFF terminates. |
| 0x10 | 4 | u32 | tempoWord | Low 31 bits initial BPM; high bit selects per-channel loop starts. |
| 0x14 | 4 × loopCount | u32[] | loopStartTicks | loopCount is one in shared mode, otherwise the channel count. |

Tempo record, eight bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | tick | Absolute tick; 0xFFFFFFFF terminates the table. |
| 0x04 | 4 | u32 | tempo | Tempo value. |

### 5.3 Instruments and sample encoding

MusyX SoundMacros are eight-byte commands. Project pages map MIDI programs to
SoundMacro object IDs, priorities, and voice limits; MIDI setups provide
program, volume, pan, reverb, and chorus for 16 channels.

Each sample-directory entry is 28 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x02` | `u16` | `id` | Sample identifier |
| `0x02` | `0x02` | — | `unknown_02` | Not identified |
| `0x04` | `0x04` | `u32` | `offset` | Offset in file 9 |
| `0x08` | `0x04` | — | `unknown_08` | Not identified |
| `0x0C` | `0x04` | packed `u32` | `pitchRate` | Root MIDI pitch in high byte; native rate in low 16 bits |
| `0x10` | `0x04` | packed `u32` | `formatCount` | Format in high byte; sample count in low 24 bits |
| `0x14` | `0x04` | `u32` | `loopStart` | Sample loop start, or `0xFFFFFFFF` |
| `0x18` | `0x04` | `u32` | `loopLength` | Loop length in samples; zero means no loop |

Each compressed sample begins with a 256-byte codebook containing eight order-2
predictors. A 40-byte ADPCM block decodes to 64 samples as two 32-sample
subframes. Each subframe stores two raw seed samples, a predictor/shift byte,
and 30 four-bit residuals. The predictor applies an eight-tap correction.

All 195 samples, totaling 4,634,958 decoded PCM samples, compare byte-for-byte
with the emulator's MusyX RSP-HLE decoder.

### 5.4 Music catalog and loop points

Loop points are output sample indices at 22050 Hz. All 12 retained songs loop.

| Index | File | Name | Loop start | Loop end | Approximate loop |
|---:|---:|---|---:|---:|---:|
| 0 | 10 | Bassy | 88,128 | 5,710,848 | 4.00–259.00 s |
| 1 | 11 | Garage | 88,128 | 4,959,552 | 4.00–224.92 s |
| 2 | 12 | Night | 88,128 | 5,959,488 | 4.00–270.27 s |
| 3 | 13 | Trancey | 88,128 | 5,998,656 | 4.00–272.05 s |
| 4 | 14 | Seventies | 88,128 | 5,380,224 | 4.00–244.00 s |
| 5 | 15 | Credits | 2,220,819 | 4,195,539 | 100.72–190.27 s |
| 6 | 16 | Title | 3,218,653 | 6,051,037 | 145.97–274.42 s |
| 7 | 17 | Retro | 88,128 | 5,531,328 | 4.00–250.85 s |
| 8 | 18 | Stunted | 88,128 | 5,431,488 | 4.00–246.33 s |
| 9 | 19 | Flier | 88,128 | 5,950,080 | 4.00–269.84 s |
| 10 | 20 | Battle1 | 88,128 | 844,224 | 4.00–38.29 s |
| 11 | 21 | Battle2 | 88,128 | 792,960 | 4.00–35.96 s |

Every song was compared with a 45-second in-game music-menu capture. Envelope
correlation ranged from 0.60 to 1.00 after alignment; all showed the correct
time scale, spectral balance, and stereo orientation. The title-screen capture
confirms that song 6 is `Title` and that name-table order matches file order.

## 6. Unused and hidden content

### 6.1 Unreferenced assets

An unplaced object is not necessarily unused. Objects whose names end in `SKY`
are camera-centered sky meshes. Objects named by `PTHD` are scripted movers and
may intentionally have no `WOBJ` record. Shared-library models are loaded on
demand by name.

The 182-file archive also includes UI, vehicles, effects, audio, and other
assets outside the level families. It has not been exhaustively classified for
unreferenced models, strings, or development remnants.

### 6.2 Cut or inaccessible levels

#### Level-family audit

The contiguous model, placement, and collision families each contain exactly
19 entries, matching the retail list in section 3.1. No additional complete
level triplet is present immediately adjacent to those families.

No additional cut level is claimed by this specification.

### 6.3 Debug features

No static debug menu or debug-only level has been verified in the level-file
families documented here.

### 6.4 Prototype or revision-specific content

No prototype or alternate-revision image is covered. Only USA revision 0 has
been structurally verified.

## 7. nviewer implementation

### 7.1 Module mapping

| Module | Responsibility |
|---|---|
| `src/rom/rom.ts` | ROM validation, main-image inflate, file table, and file decompression |
| `src/rom/level.ts` | Tagged containers, object libraries, placements, paths, and level assembly |
| `src/rom/rushcollision.ts` | Rush-family collision and scripted alternate layers |
| `src/rom/lzss.ts` | Rush 2049 LZSS decoder |
| `src/rom/inflate.ts` | Raw RFC 1951 decoder |
| `src/rom/displaylist.ts` | F3DEX2 command and material decode |
| `src/rom/texture.ts` | TMEM upload and N64 texture decode |
| `src/rom/music/rush2049.ts` | MusyX file mapping, names, and player integration |
| `src/rom/music/musyx.ts` | Project, macro, SNG, ADPCM, resampler, and mixer implementation |

### 7.2 Supported features

nviewer exposes all 19 levels with separate track/arena, object, collision, and
scripted-alternate collision layers. It resolves level, per-track, and shared
model libraries; renders embedded skies; places scripted movers at their first
effective keyframe; and provides all 12 MusyX songs with authored loops.

### 7.3 Approximations and omissions

- Scripted objects are frozen at their initial state; path animation and live
  collision replacement are not simulated.
- Only LOD slot 0 is rendered.
- `GTLD`, `GDAT`, course sections, trigger logic, vehicles, and dynamic effects
  are not decoded.
- MusyX sample decode, event timing, resampling, and frame mixing follow the
  N64 path; volume curve, pan law, ADSR shapes, voice stealing, and some
  controller details are approximated.
- The game camera and dynamic lighting are not reproduced.

## 8. Verification and remaining work

### 8.1 Verification evidence

| Subject | Method | Result |
|---|---|---|
| ROM identity | Direct header read and full-file SHA-1 | Values in section 1.2 |
| CIC | Emulator boot identification | CIC X102 |
| Main executable | Boot disassembly and independent raw inflate | `0x9DFA0` bytes at `0x80086A50` |
| File table | All 182 entries extracted with table types and sizes | 1 raw, 48 LZSS, 133 DEFLATE |
| Level families | All 19 model, placement, and collision triples decoded | Every retail slot loads |
| Containers | Trailer tags and counts checked across files 101–138 | Section mappings and strides are consistent |
| Display lists and textures | F3DEX2/TMEM decode; texture sheets; in-game/viewer frame comparisons | Geometry, signage, culling, and texture addressing agree |
| Collision | Parser across files 139–157; overlays; physics disassembly | Meshes align; classes 5 and 15 and scripted alternates confirmed |
| Sky and fog | Unplaced sky meshes; captured frame display lists | Camera-centered skies reproduce frames; fog is beyond far plane |
| Audio codec | 195 samples compared with emulator RSP-HLE MusyX decoder | 4,634,958 samples are byte-identical |
| Music | All songs rendered and compared with emulator captures | Names, playback order, timing, stereo orientation, and loops verified |

### 8.2 Known unknowns

- Semantics of unnamed `WOBJ`, `WHDR`, `GTLD`, `GDAT`, `PTHD`, PATH timing,
  quadtree-node, and 132-byte course-section fields.
- Meanings of collision surface classes other than class 5 (wall) and class 15
  (disabled).
- Complete gameplay trigger, camera, vehicle, and effect formats.
- Exhaustive classification of all 182 archive files and unreferenced content.
- Exact MusyX runtime behavior for the approximated synthesis controls.
- Cross-region and revision compatibility.

### 8.3 References

- N64 ROM header and CIC conventions.
- Nintendo F3DEX2 graphics binary interface and RDP texture-memory behavior.
- RFC 1951 DEFLATE.
- Factor 5 MusyX version-1 project, SNG, SoundMacro, and N64 ADPCM data as
  established by the ROM and emulator RSP-HLE comparison.
- The implementation modules listed in section 7.1, which cite relevant ROM and
  RAM addresses beside decoded behavior.
