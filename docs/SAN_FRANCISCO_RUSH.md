# San Francisco Rush: Extreme Racing — Nintendo 64 ROM format specification

This document describes the USA Nintendo 64 release of *San Francisco Rush:
Extreme Racing*. It is a binary-format reference for ROM analysis and for the
`nviewer` implementation. Unless marked as a hypothesis, claims below are
verified from ROM bytes, decompressed data, MIPS disassembly, emulator RAM, or
captured audio/video.

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | Two code-resident tables of absolute ROM offsets; no named filesystem |
| Compression | Custom 4 KiB-ring LZSS for the main image and asset files |
| Graphics microcode | `F3DEX.NoN 1.21`; `F3DLX.NoN 1.21` is also present |
| Geometry | Named object containers, F3DEX display lists, and hierarchical placement records |
| Textures | RDP-native CI, RGBA, IA, and I images referenced by display lists |
| Collision | Per-track polygon mesh with path sections and a ground-plane quadtree |
| Music driver | Nintendo libultra `alSeqPlayer` with format-0 MIDI |
| Audio microcode | Nintendo ABI audio task; exact ABI revision **Unknown** |
| Sample encoding | Nintendo VADPCM |
| Levels | Six selectable race tracks plus one complete hidden track |
| Memory requirement | **Unknown** |
| Viewer support | USA revision 0; geometry, objects, sky, fog, collision, and 16 music entries |

### 1.2 ROM identification

Hashes apply to the canonical `.z64` image.

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| USA, multilingual (`M3`) | `S.F. RUSH` | `NSFE` | 0 | 8 MiB | `2A6B1820` | `6ABCF466` | `cc62539cb30b180c3c7e0aa927786ed061d8d9ab` | CIC-6102 | **Unknown** |

The header values and full-file SHA-1 were read directly from the verified ROM.
The emulator identifies the IPL3 as CIC type X102. The ROM contains both
`RSP Gfx ucode F3DEX.NoN 1.21` and `RSP Gfx ucode F3DLX.NoN 1.21` identification
strings.

### 1.3 Terminology and conventions

- Ranges are half-open: `[start, end)`.
- Offsets and addresses are hexadecimal unless stated otherwise.
- Multi-byte fields are big-endian.
- `A[n]` and `B[n]` denote entries in the two asset-offset tables.
- “File” means one LZSS stream addressed by a table entry; there is no filename
  directory.
- Segmented display-list addresses are written `ss:oooooo`, where `ss` is the
  segment and `oooooo` is its 24-bit offset.
- The game uses a row-vector placement matrix: `world = local × R + t`.
- Stored render coordinates are transformed to nviewer's right-handed, Y-up
  frame by mirroring X. Collision uses a different stored basis, described in
  section 3.6.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

The IPL3 enters the boot program at `0x80000400`. Boot code at `0x80003B18`
decompresses the main executable from ROM `0x7A7930` to `0x8005BB10` with the
ring-buffer LZSS codec. The decompressed main image contains both asset tables
and the level, render, collision, and audio control code cited below.

| ROM range or address | Destination | Contents | Evidence |
|---|---:|---|---|
| `[0x000000,0x001000)` | — | N64 header and CIC-NUS-6102 IPL3 | ROM bytes; emulator CIC identification |
| `0x001000` onward | `0x80000400` | Boot program and resident support code | header entry point; disassembly |
| `0x7A7930` | `0x8005BB10` | LZSS-compressed main executable image | boot decompressor disassembly; decoded image |

The exact packed end of the main stream is not stored separately. Its LZSS
terminator determines the end.

### 2.2 Memory and address mapping

The two tables contain absolute physical ROM offsets. After decompression,
race assets use N64 segmented addresses:

| Segment | Contents during a race | Construction |
|---:|---|---|
| `5` | Track model followed by shared track textures | `A[29+n]`, then `A[29]` at the next 16-byte boundary |
| `6` | Shared prop models and their textures | `A[5]` |

Track display lists deliberately reference segment-5 offsets beyond the end of
their own model stream. They become valid only after `A[29]` is appended in the
same heap segment. Decoding the model in isolation therefore loses textures.

### 2.3 ROM map and asset organization

The main image holds two arrays of `u32` ROM offsets:

| Table | RAM address | Entries | Use |
|---|---:|---:|---|
| A | `0x800C7C38` | 65 | Models, textures, collision, and other assets |
| B | `0x800C7BA4` | Entries 30–36 are populated | Track placements |

For a track number `n` in `1..7`:

| Purpose | File |
|---|---|
| Track model container | `A[29+n]` |
| Track placement | `B[29+n]` |
| Shared track textures | `A[29]` |
| Shared props | `A[5]` |
| Normal collision | `A[36+n]` |
| Alternate collision set | `A[43+n]` |

The game normally reads the first collision family. Code at `0x800AA340`
selects the alternate family when byte `0x800EA13E` is nonzero. The two sets
contain nearly the same course surfaces; nviewer displays the normal family.

Fixed-offset music data lies outside these level tables:

| ROM address | Contents |
|---:|---|
| `0x5D9350` | Music `ALBankFile` control data (`0x6030` bytes) |
| `0x5DF380` | Music VADPCM sample table |
| `0x6F80A0` | `S1` sequence archive, 16 entries |
| `0x70A1D0` | Sound-effect bank control data; its sample table begins at `0x70DCC0` |

### 2.4 Compression formats

Reference codec: [Rush 1 LZSS](compression/rush-lzss.md).

All table-addressed files and the main executable use the same token syntax,
but matches refer to an absolute position in a 4096-byte history ring. The ring
is initially zero-filled and its write position starts at 1.

Each group begins with a flag byte consumed least-significant bit first. A set
bit encodes one literal byte. A clear bit encodes this two-byte match:

<table class="byte-layout">
<thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
<tbody><tr><th><code>0x00</code></th><td colspan="2"><code>match: u16</code></td><td colspan="6">—</td></tr></tbody>
</table>

| Field | Bits | Meaning |
|---|---:|---|
| Ring position | `b0[7:4] || b1[7:0]` | Absolute 12-bit source position |
| Length | `b0[3:0] + 2` | Number of bytes copied, with ring wrap |
| Terminator | `b0 = 0`, `b1 = 0` | End of stream |

The format has no decoded-size header. A decoder must grow its output until it
encounters the zero match. This codec is verified against the boot routine and
all files needed by the seven tracks.

### 2.5 Loading process

For track `n`, the game decompresses the model and shared texture files into a
single segment-5 heap, loads `A[5]` as segment 6, decompresses `B[29+n]`, and
resolves each placement by its 16-byte object name. A placement may refer to a
track object or to a shared prop. Its transform is composed with its parent as
described in section 3.2.

The collision file is independent of the rendered mesh. Physics queries use
its quadtree and surface polygons rather than rendered triangles.

### 2.6 Revision differences

Only USA revision 0 has been structurally verified and is accepted by nviewer.
No claim is made that offsets are shared by other regions or revisions.

## 3. Level data

### 3.1 Level catalog and identifiers

| Number | Internal identifier | Selection status | Model | Placement | Collision |
|---:|---|---|---|---|---|
| 1 | `TRACK1` | Selectable | `A[30]` | `B[30]` | `A[37]` |
| 2 | `TRACK2` | Selectable | `A[31]` | `B[31]` | `A[38]` |
| 3 | `TRACK3` | Selectable | `A[32]` | `B[32]` | `A[39]` |
| 4 | `TRACK4` | Selectable | `A[33]` | `B[33]` | `A[40]` |
| 5 | `TRACK5` | Selectable | `A[34]` | `B[34]` | `A[41]` |
| 6 | `TRACK6` | Selectable | `A[35]` | `B[35]` | `A[42]` |
| 7 | `TRACK7` | Hidden from normal selection | `A[36]` | `B[36]` | `A[43]` |

All seven rows have a valid model, placement tree, textures, and collision file.

### 3.2 Level container

The placement stream begins with a 24-byte header. Records continue to the end
of the decoded stream in 100-byte strides.

<table class="byte-layout">
<thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
<tbody>
<tr><th><code>0x00</code></th><td colspan="4"><code>version: u32</code></td><td colspan="4"><code>headerSize: u32</code> = <code>0x18</code></td></tr>
<tr><th><code>0x08</code></th><td colspan="8" rowspan="2"><code>levelName: char[16]</code></td></tr>
<tr><th><code>0x10</code></th></tr>
</tbody>
</table>

A placement record has this established layout:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x10` | `char[16]` | `name` | Object lookup key |
| `0x10` | `0x24` | `f32[9]` | `basis` | Row-major rotation/scale matrix |
| `0x34` | `0x0C` | `f32[3]` | `translation` | Position relative to the parent translation |
| `0x40` | `0x04` | `u32` | `flags` | Exact bit meanings are not identified |
| `0x44` | `0x02` | `s16` | `nextSibling` | Record index, or `-1` |
| `0x46` | `0x02` | `s16` | `firstChild` | Record index, or `-1` |
| `0x48` | `0x04` | `u32` | `unknown_48` | Not identified |
| `0x4C` | `0x18` | `f32[6]` | `bounds` | Stored minimum and maximum bounds |

The list is a first-child/next-sibling tree rooted at record 0. Code at
`0x800829E4` adds a parent's stored translation to each child. The retained
hierarchy explains track-side props whose local coordinates otherwise cluster
near the origin.

### 3.3 Geometry

The model container has a 32-byte header followed by 52-byte object records.
Its pointers are segmented addresses. Known header fields are:

<table class="byte-layout">
<thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
<tbody>
<tr><th><code>0x00</code></th><td colspan="4"><code>nameTable: segptr</code></td><td colspan="4"><code>objectCount: u32</code></td></tr>
<tr><th><code>0x08</code></th><td colspan="4"><code>unknown_08</code></td><td colspan="4"><code>unknown_0C</code></td></tr>
<tr><th><code>0x10</code></th><td colspan="4"><code>textureTable: segptr</code></td><td colspan="4"><code>textureCount: u32</code></td></tr>
<tr><th><code>0x18</code></th><td colspan="4"><code>paletteTable: segptr</code></td><td colspan="4"><code>paletteCount: u32</code></td></tr>
</tbody>
</table>

Each name-table record is 24 bytes:

<table class="byte-layout">
<thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
<tbody>
<tr><th><code>0x00</code></th><td colspan="8" rowspan="2"><code>name: char[16]</code></td></tr>
<tr><th><code>0x08</code></th></tr>
<tr><th><code>0x10</code></th><td colspan="4"><code>radius: f32</code></td><td colspan="4"><code>flags: u32</code></td></tr>
</tbody>
</table>

The corresponding object record is 52 bytes. The verified display-list pointer
is a segmented `u32` at `+0x0C`; the remaining fields have not been assigned
stable semantic names. Vertices use the standard 16-byte N64 `Vtx` layout.

### 3.4 Display lists and render state

Geometry uses F3DEX 1.x commands and segmented pointers. The loader executes
nested display lists, vertex loads, triangle commands, texture-image setup,
tile setup, TLUT loads, and the relevant RDP combine and render state.

The source represents visually double-sided faces as opposite-winding triangle
pairs; the game normally enables back-face culling. Texture coordinates are
relative to the upper-left corner set by `G_SETTILESIZE`. A decoder must sample
`(s - uls, t - ult)`: several Rush textures use nonzero `uls` or `ult`.

### 3.5 Textures and materials

Texture descriptors are named table entries. A descriptor records its name,
dimensions, image pointer, format information, and palette selection; palette
descriptors contain segmented palette pointers. The display lists remain the
authority for active RDP format, size, tile line, wrapping, mirroring, clamping,
and combiner state.

The observed data uses standard RDP-native formats including CI4/CI8 with
RGBA16 TLUTs, RGBA16, IA, and intensity textures. `G_LOADBLOCK` data must be
interpreted through TMEM: odd-row 64-bit word swaps and `dxt` row progression
are significant.

### 3.6 Collision

#### 3.6.1 File organization

The decoded collision stream contains:

1. a `0x20`-byte header;
2. 132-byte course/path sections;
3. 20-byte ground-plane quadtree nodes;
4. 26-byte polygon records;
5. 8-byte vertices;
6. quadtree leaf-list bytes; and
7. polygon index streams.

Known header fields are:

<table class="byte-layout">
<thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
<tbody>
<tr><th><code>0x00</code></th><td colspan="2"><code>sectionCount: u16</code></td><td colspan="2"><code>nodeCount: u16</code></td><td colspan="2"><code>polygonCount: u16</code></td><td colspan="2"><code>vertexCount: u16</code></td></tr>
<tr><th><code>0x08</code></th><td colspan="2"><code>leafListBytes: u16</code></td><td colspan="6"><code>unknown_0A</code></td></tr>
<tr><th><code>0x10</code></th><td colspan="8" rowspan="2"><code>unknown_10: u8[16]</code></td></tr>
<tr><th><code>0x18</code></th></tr>
</tbody>
</table>

#### 3.6.2 Polygon record

The 18-byte basis crosses eight-byte display rows, so a field table is clearer
than a byte grid for this record:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x02` | `u16` | `flags` | Low nibble is the surface class |
| `0x02` | `0x02` | `u16` | `countWord` | Low nibble is the vertex count |
| `0x04` | `0x02` | `u16` | `unknown_04` | Not identified |
| `0x06` | `0x12` | `s16[9]` | `basis` | 3×3 Q14 plane basis |
| `0x18` | `0x02` | `u16` | `streamOffset` | Offset into the index-stream area |

The polygon vertex count is `countWord & 0xF`. The surface class is
`flags & 0xF`; game code at `0x8007A490` interprets the flags. Class 5 is a wall:
nearly all such polygons are vertical, and the ground query at `0x8007ADB0`
skips them. Other classes are not yet named with confidence.

#### 3.6.3 Vertex and index stream

<table class="byte-layout">
<thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
<tbody><tr><th><code>0x00</code></th><td colspan="2"><code>x: s16</code></td><td colspan="2"><code>y: s16</code></td><td colspan="2"><code>z: s16</code></td><td colspan="2"><code>fractions: u16</code></td></tr></tbody>
</table>

Each coordinate is `(integer × 32 + fraction) / 32`. Fraction bits 14–10 are
X, 9–5 are Y, and 4–0 are Z.

An index stream consists principally of big-endian `u16` vertex indices. After
an index, a byte `>= 0xC0` adds `byte & 0x3F` consecutive indices. The first
vertex supplies the polygon's world origin. Remaining vertices lie in the
polygon plane and are transformed by the stored Q14 basis without transposing
it. Collision coordinates correspond to `(Z, X, -Y)` of the render frame.

### 3.7 Environment, sky, fog, and lighting

The sky is generated by code at `0x800A7494`, not stored as a level object. It
is a camera-centred dome of 25 vertices: a center and three rings of eight.

| Table | RAM address | Contents |
|---|---:|---|
| Positions | `0x800C7D88` | `f32` XYZ, 16 vertex units per world unit |
| Texture coordinates | `0x800C7EB4` | `f32` UV |
| Alpha | `0x800C7F7C` | Horizon fade |
| Polygons | `0x800C7F98` | Four vertex indices; `0xFF` marks a triangle and `0xFFFFFFFF` ends the table |

The game randomly chooses `SKY01` or `SKYFOUR` from `A[5]` for each race. The
dome is blended and drawn without depth or fog.

Race display lists captured in RAM set fog color `(150,150,190,255)` and
`gSPFogFactor(32000,-31744)`, equivalent to fog position 996–1000. With the
observed `guPerspective` near/far values of 40 and 32040 vertex units, fog begins
at approximately 480 world units and becomes opaque near 1980, immediately
before the far plane. This state was identical on sampled Tracks 1 and 2.

Static mesh lighting is represented by the authored display-list and vertex
state. The viewer does not emulate dynamic vehicle or effect lighting.

### 3.8 Cameras and paths

The collision file's 132-byte sections describe the course path, including
position, orientation, and extents. Their complete field semantics are not yet
decoded. Camera behavior is code-driven and is not stored in the placement
record format documented above. nviewer derives its initial inspection camera
from level bounds rather than reproducing the race camera.

## 4. Objects

### 4.1 Placement records

Placements resolve their 16-byte names first against the track model container,
then against shared container `A[5]`. The tree relationships are material:
children inherit a parent translation. Missing this step puts cones, trees, and
other roadside objects close to the world origin.

### 4.2 Object and model formats

The container records retain object radii, flags, and model data. The game has
level-of-detail behavior, but the object-record fields that select alternate
LODs have not been fully named. nviewer renders the most detailed decoded model.

### 4.3 Skeletons and animation

Track placements are rigid transforms. Cars, checkpoint flags, weapon icons,
and other run-time entities are created by game code and are not represented by
the static placement tree. Skeletal animation is outside the decoded level
format.

### 4.4 Behaviors, triggers, and scripted objects

The static files establish scene placement but do not encode all race logic.
Checkpoint order, traffic, vehicle starts, shortcuts, and run-time effects have
not been mapped into viewer objects.

## 5. Audio

### 5.1 Audio storage and banks

The game creates a 22050 Hz libultra synthesizer with 24 voices and 16 MIDI
channels. The music bank is an `ALBankFile` marked `B1`: one bank, 52 instrument
slots, one percussion instrument, and 110 sounds. Its offsets are relative to
the control file. VADPCM wave data is streamed from ROM in `0x800`-byte DMA
reads by code at `0x80070BFC`.

### 5.2 Sequence format and driver

The archive at `0x6F80A0` begins:

<table class="byte-layout">
<thead><tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr></thead>
<tbody>
<tr><th><code>0x00</code></th><td colspan="2"><code>magic: u16</code> = <code>0x5331</code></td><td colspan="2"><code>count: u16</code> = 16</td><td colspan="4"><code>entry[0].offset: u32</code></td></tr>
<tr><th><code>0x08</code></th><td colspan="4"><code>entry[0].length: u32</code></td><td colspan="4"><code>entry[1].offset: u32</code></td></tr>
</tbody>
</table>

Each eight-byte entry is `{offset:u32, length:u32}`; `offset` is relative to the
archive. The pointed stream is LZSS-compressed and decodes to a standard
format-0 MIDI file.

Function `0x8006F054(sequence, loopCount)` decompresses a sequence, calls
`alSeqNew`, configures `alSeqPlayer`, places markers at tick 0 and the track end,
and uses `alSeqpLoop`. Race selection code at `0x80099E44` reads nine sequence
numbers from `s16[9]` at `0x800D2910`. Per-sequence gains are `f32[16]` at
`0x800C3EF4`.

### 5.3 Instruments and sample encoding

Samples use Nintendo VADPCM with the predictor books and loop states stored by
the `ALBankFile` structures. All 110 music waves, totaling 2,044,272 decoded
samples, were compared against the emulator's HLE ADPCM implementation with
zero sample mismatches.

The renderer models libultra sequence scheduling, envelopes, resampling, voice
allocation, sample loops, and the game's gain table. Reverb is omitted; music
channels have an effect send of zero. Measured tempo drift is approximately
0.04%.

### 5.4 Music catalog and loop points

Loop points are output sample indices at 22050 Hz. “No loop” entries are played
once by the corresponding game path.

| Viewer index | Sequence | Name | Loop start | Loop end | Game use |
|---:|---:|---|---:|---:|---|
| 0 | 5 | Power-on Jingle | — | — | Power-on, once |
| 1 | 4 | Title | 7,331 | 1,300,867 | Midway logo, title, and attract mode |
| 2 | 11 | Menus | 2,178 | 3,322,720 | Menus |
| 3 | 0 | Blue Fog | 2,183 | 7,514,017 | Race option 1 |
| 4 | 1 | Desert Walk | 6,276 | 1,820,584 | Race option 2 |
| 5 | 2 | Who It Is | 10,272 | 1,596,979 | Race option 3 |
| 6 | 7 | Pulp Country | 2,179 | 3,744,079 | Race option 4 |
| 7 | 3 | Blind Chase | 7,701 | 1,277,392 | Race option 5 |
| 8 | 10 | Rave Rush | 2,185 | 7,945,636 | Race option 6 |
| 9 | 6 | Night Hunt | 6,871 | 2,519,145 | Race option 7 |
| 10 | 12 | STL | 2,183 | 2,732,691 | Race option 8 |
| 11 | 15 | Zethno | 2,181 | 3,556,039 | Race option 9 |
| 12 | 13 | Track 13 | 40,986 | 452,000 | Other code path, loops |
| 13 | 14 | Track 14 | 2,179 | 977,305 | Other code path, loops |
| 14 | 8 | Track 8 | — | — | Other code path, once |
| 15 | 9 | Track 9 | — | — | Other code path, once |

Names for the nine race songs are the strings shown by **Setup → Audio → Music
Track**. The purpose of sequences 8, 9, 13, and 14 is not yet assigned a stable
descriptive name.

## 6. Unused and hidden content

### 6.1 Unreferenced assets

The 65-entry A table contains many non-level assets not cataloged in this
document. No claim is made that every unreferenced object, string, or audio
sequence has been exhaustively audited.

### 6.2 Cut or inaccessible levels

#### Hidden Track 7

`TRACK7` is a complete seventh course retained in the normal model, placement,
texture, and collision families but omitted from the retail track-selection
interface. It is exposed by nviewer as **Track 7 (hidden)**. Its presence is
verified from the decoded files rather than inferred from an isolated model.

### 6.3 Debug features

No static debug menu or debug-only level has been verified in the level-file
families documented here.

### 6.4 Prototype or revision-specific content

#### Alternate collision files

`A[44]` through `A[50]` hold an alternate collision family selected by a
run-time byte. These are retained variants rather than a separate set of level
models. Their exact intended mode or development use remains unknown.

## 7. nviewer implementation

### 7.1 Module mapping

| Module | Responsibility |
|---|---|
| `src/rom/rush1.ts` | ROM validation, table access, LZSS file loading, containers, placements, sky, and fog |
| `src/rom/rushcollision.ts` | Rush-family collision decode and hidden collision layers |
| `src/rom/lzss.ts` | Ring-buffer LZSS decoder |
| `src/rom/displaylist.ts` | F3DEX command and material decode |
| `src/rom/texture.ts` | TMEM upload and N64 texture decode |
| `src/rom/music/rush1.ts` | Sequence catalog, libultra bank loading, and music rendering |
| `src/rom/music/libultra.ts` | MIDI/VADPCM software synthesizer |

### 7.2 Supported features

nviewer exposes seven tracks with separate track, object, and hidden collision
layers. It reconstructs parented placements, shared textures and props, the two
randomly selected sky domes, captured race fog, surface-class collision colors,
and all 16 retained music sequences.

### 7.3 Approximations and omissions

- Only the most detailed model representation is rendered.
- Cars, checkpoint flags, weapon icons, traffic, and other run-time objects are
  absent.
- The collision file's 132-byte course sections are not visualized.
- Collision classes other than class 5 are not semantically named.
- The game camera, effects, and dynamic lighting are not reproduced.
- Music reverb is omitted; this does not affect channels whose send remains zero.

## 8. Verification and remaining work

### 8.1 Verification evidence

| Subject | Method | Result |
|---|---|---|
| ROM identity | Direct header read and full-file SHA-1 | Values in section 1.2 |
| CIC | Emulator boot identification | CIC X102 |
| Main executable | Boot disassembly and independent LZSS decode | Loads at `0x8005BB10` from `0x7A7930` |
| Asset tables | Main-image disassembly and all seven decoded track sets | Table addresses and track mapping agree |
| Placement hierarchy | MIPS routine `0x800829E4`; decoded records; object-position checks | Parent translations reproduce prop placement |
| Display lists and textures | F3DEX decode; texture sheets; in-game/viewer frame comparisons | Geometry, signs, wrap/mirror state, and culling agree |
| Fog and sky | Captured RAM display lists and code-table reconstruction | Fog parameters and both sky textures reproduced |
| Collision | File parser across seven tracks; render/collision overlays; physics disassembly | Counts, basis orientation, surface class 5, and track alignment agree |
| Audio | 110-wave sample comparison; sequence renders; captured game audio | VADPCM sample output is exact; timing and mix closely align |

### 8.2 Known unknowns

- Semantics of unnamed model-header, object-record, placement, collision-header,
  quadtree-node, and course-section fields.
- Names and uses of collision surface classes other than walls.
- Meaning of the alternate collision-selection mode.
- Stable descriptive names and exact use sites for sequences 8, 9, 13, and 14.
- Cross-region and revision compatibility.

### 8.3 References

- N64 ROM header and CIC conventions.
- Nintendo F3DEX 1.x graphics binary interface.
- Nintendo libultra `ALBankFile`, `ALSeqFile`, `alSeq`, and VADPCM formats.
- The implementation modules listed in section 7.1, which cite the relevant ROM
  and RAM addresses beside the decoded behavior.
