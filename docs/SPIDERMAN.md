# Spider-Man — Nintendo 64 ROM format specification

This manual describes the shipped data formats needed to identify, extract, and
present Spider-Man content. Claims state their evidence inline; unsupported
interpretations are labelled hypotheses.

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | resident loader + 995,056-byte ERZ2-compressed main image; an 8-group master directory contains 1,789 leaves and 3,285 nonempty logical assets; 30 late overlays |
| Compression | ERZ2 for the main image and archive payloads. |
| Graphics microcode | F3DEX2-family display lists with game-specific compact tokens. |
| Geometry | model shell + recursive native render bank, transposed F3DEX2 vertices and compact display-list tokens; object-shell and TRG placement |
| Textures | 2,582 global records, mostly CI4; RGBA16, I, IA and auxiliary-plane formats; authored wrap and alpha/render class |
| Collision | A geometry group is the strongest collision candidate; its gameplay query remains unverified. |
| Music driver | Nintendo Sound Tools adaptive sample/effect engine at 22,047 Hz; level schedules select prerecorded fragments. |
| Audio microcode | ABI1-compatible Nintendo audio task; exact binary revision is not identified. |
| Sample encoding | ABI1 ADPCM, order 2 with four predictors; 996 waves. |
| Levels | 34 campaign areas; 22 additional geometry-bearing choices (Bank Approach alternate, 17 training arenas, Dem1–4), with a second Dem1 setup; 2 incomplete stale TRGs excluded |
| Memory requirement | **Unknown** |
| Viewer support | medium-high: compression and base geometry are bounded; faithful placement overlays, camera/background behavior and adaptive music scheduling are the main work |
| Environment | per-restart TRG commands create backgrounds and set sky/fade/fog colours; fixed static light rig; exact runtime camera and fog interpretation are verified separately below |
| Objects | stage O bundles plus 5,913 retail TRG spatial nodes; platform/manipulable-object bytecode resolves model hashes and optional What-If variants |
| Unused/hidden | incomplete L3A1a trigger, declaratively unreferenced recording-studio model family, one dangling L8A2 background reference, complete training content and live debug/cheat menus (*Unused and hidden content*) |

### 1.2 ROM identification

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| USA | `SPIDERMAN` | `NSLE` | 0 | 32 MiB (`0x2000000`) | `A60ED171` | `3D85D06E` | `382c9c5d4e416444c4f6f9f4f6a5914d679fedf1` | CIC-6102 | — |

Verified from the normalized ROM headers and complete-image SHA-1 hashes.

### 1.3 Terminology and conventions

ROM and memory ranges are half-open. Offsets, addresses, encoded sizes, masks,
and opcodes are hexadecimal unless stated otherwise. Multi-byte CPU fields are
big-endian. RAM addresses are virtual unless explicitly identified as physical;
segmented, VROM, and file-relative addresses are named at each use.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

### 2.2 Memory and address mapping

### 2.3 ROM map and asset organization

#### ROM map and byte accounting

`fs/extracted/rom_ranges.csv` expands every table, leaf, pad and overlay. Its
adjacency check has zero gaps and zero overlaps across the entire ROM.
**Verified—ROM/tool.**

| ROM range | size | contents |
|---|---:|---|
| `0000000..000003F` | `0x40` | cartridge header |
| `0000040..0000FFF` | `0xFC0` | CIC-6102 IPL3 |
| `0001000..0013B2F` | `0x12B30` | resident loader/code/data |
| `0013B30..0013B33` | 4 | master-root cart pointer |
| `0013B34..0080515` | `0x6C9E2` | boot table and 16 ERZ2 blocks |
| `0080516..1D52449` | `0x1CD1F34` | master directory, groups and leaves |
| `1D5244A..1D52455` | 12 | unused zero prefix |
| `1D52456..1DEC8A1` | `0x9A44C` | overlay code/relocation payloads |
| `1DEC8A2..1FFFFFF` | `0x21375E` | `00`/`FF` cartridge padding |

### 2.4 Compression formats

#### Boot, executable layout, filesystem and compression

The cartridge has a small resident loader, a compressed main load image, a
master asset directory, and a late overlay region. **Verified—ROM and
disassembly** (`fs/spiderman_fs.py`, `fs/boot-loader.disasm`,
`fs/main.disasm`).

The resident image occupies ROM `0x1000..0x13B30` and runs at `0x80000400`.
Startup at `0x80000870` reads the cart pointer at ROM `0x13B30`, saves it at
RAM `0x80011C4C`, then consumes the boot block table at ROM `0x13B34`.
Sixteen blocks concatenate at RAM `0x80016AE0`: fifteen decode to `0x10000`
bytes and the final block to `0x2EF0`, for `0xF2EF0` / 995,056 bytes total.
The resulting image's SHA-256 is
`1d3ed3384f45ada2ebf6cb0666ddc7fec4c4ffdb6fdb993b8d566aa3cd4f3867`;
control transfers to its main entry `0x800C16CC`.

#### Table grammar and master directory

The common table is a BE `u32 count` followed by `count+1` relative BE `u32`
offsets. Offsets are nondecreasing; equal neighbors are authored empty slots.
**Verified—ROM.** The pointer `0xB0080516` immediately before the boot table
masks to master-root ROM offset `0x80516`. Its eight children are group
directories. Leaves in compressed groups are ERZ pages which concatenate into
one logical stream containing another table; group 5 instead consists of raw,
independent audio leaves.

| group | directory through data end | leaves | decoded/stored bytes | logical slots (nonempty) | role |
|---:|---|---:|---:|---:|---|
| 0 | `8053E..584CC5` | 437 | `0x6D047C` | 264 (261) | model bundles |
| 1 | `584CC6..5B6875` | 34 | `0x84FD0` | 69 (59) | TRG 2.1 files |
| 2 | `5B6876..89E9CD` | 509 | `0x7F2920` | 284 (280) | native render banks |
| 3 | `89E9CE..B24CBD` | 262 | `0x4179EE` | 2,594 (2,582) | texture dictionary |
| 4 | `B24CBE..D3233D` | 315 | `0x4EAF28` | 51 (46) | full-screen CI8 images |
| 5 | `D3233E..1D2BD6D` | 217 | `0xFF96BE` raw | n/a | Sound Tools wavetables plus 216 raw leaves |
| 6 | `1D2BD6E..1D50865` | 13 | `0x31F88` | 3 (2) | BFX and PTR audio banks |
| 7 | `1D50866..1D52449` | 2 | `0x7A50` | 55 (55) | SFX cue banks |

Main-image paging is at `0x800BB2A4..0x800BB7DC`.
`0x800BB550` maps logical offset `>>14` to a leaf, DMAs and decodes a cache
miss; `0x800BB3A0` copies arbitrary ranges across page boundaries.
**Verified—disassembly.**

#### Overlays

Thirty overlay records at main-image offset `0xE0030` / RAM `0x800F6B10`
name code and relocation payloads for JPEG, front-end data, bosses/actors,
level scripts, training, and `sm_relocdata`. Each `0x1C` record contains a
name pointer, code address/size, relocation address/size, and two zero words.
**Verified—ROM/disassembly.**

The runtime forms storage bias `0xB0106A20 - [0x80011C4C] = 0x8650A` at
`0x8008A0A4`. The first roster address therefore maps to ROM `0x1D52456`, not
the directory end `0x1D5244A`. The intervening 12 zero bytes are never loaded;
the 60 code/relocation slices tile `0x1D52456..0x1DEC8A2`. This corrects a
12-byte early-slice error in the external reference carver.

### 2.5 Loading process

### 2.6 Revision differences

#### ERZ version 2

All compressed data uses ERZ version 2. **Verified—ROM/disassembly:** all
1,584 streams decode to the sizes in their headers using a state-machine
transcription of the resident decoder at `0x80000CF8`.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `+0x00` | 3 | `char[3]` | `"ERZ"` | — |
| `+0x03` | 1 | `u8` | `version = 2` | — |
| `+0x04` | 4 | `u32` | `decoded size` | — |
| `+0x08` | 4 | `u32` | `compressed size` | — |
| 0x0C | 6 | u8[6] | unknown0C | Skipped by the decoder. |
| 0x12 | Variable | u8[] | bitstream | Compressed data. |

The bitstream is an LZ-family code with literals, backreferences, a
distance-zero fill path, extended distances, an aligned raw-run escape, and an
explicit end escape. `fs/spiderman_fs.py:decode_erz2` is the implementation
reference; it is preferable to reusing a name-only ERZ decoder without testing
the version. Boot blocks use `0x10000` output pages. Compressed asset groups use
`0x4000` output pages; four group-0 leaves are stored raw because they do not
compress profitably.

## 3. Level data

### 3.1 Level catalog and identifiers

### 3.2 Level container

#### Levels and loading

The unique 34-record retail level table is at main-image offset `0xDEC14`.
Records are 20 bytes and begin with pointers to the displayed title and TRG
stem. **Verified—ROM** (`levels/survey_levels.py`). Group-1 slot number is not
the campaign index: the attract-demo record at slot 30 interrupts the sequence,
and L5A7/L8A3/L8A5/L8A6 occupy slots 31–34.

| index | TRG stem | displayed title |
|---:|---|---|
| 0 | `L1A1_T` | Get to the Bank! |
| 1 | `L1A2_T` | Bank Approach |
| 2 | `L1A3_T` | Hostage Situation |
| 3 | `L1A4_T` | Stop the Bomb! |
| 4 | `L2A1_T` | Race to the Bugle |
| 5 | `L2A2_T` | Spidey vs. Scorpion! |
| 6 | `L3A1_T` | Police Chopper Chase |
| 7 | `L3A2_T` | Missile Attack |
| 8 | `L3A3_T` | Building Top Chase |
| 9 | `L3A4_T` | Scale the Girders |
| 10 | `L3A5_T` | Police Evaded |
| 11 | `L4A1_T` | Spidey vs. Rhino! |
| 12 | `L5A1_T` | Catch Venom |
| 13 | `L5A2_T` | Spidey vs. Venom! |
| 14 | `L5A3_T` | Sewer Entrance |
| 15 | `L5A4_T` | Sewer Cavern |
| 16 | `L5A5_T` | Subway |
| 17 | `L5A6_T` | Sewage Plant |
| 18 | `L5A7_T` | Hidden Switches |
| 19 | `L6A1_T` | Tunnel Crawl |
| 20 | `L6A2_T` | Venom's Puzzle |
| 21 | `L6A3_T` | The Lizard's Maze |
| 22 | `L6A4_T` | Spidey vs. Venom Again! |
| 23 | `L7A1_T` | Symbiotes Infest Bugle |
| 24 | `L7A2_T` | Elevator Descent |
| 25 | `L7A3_T` | Stop the Presses! |
| 26 | `L7A4_T` | Bugle's Basement |
| 27 | `L7A5_T` | Spidey vs. Mysterio! |
| 28 | `L8A1_T` | Waterfront Warehouse |
| 29 | `L8A2_T` | Underwater Trench |
| 30 | `L8A3_T` | Stopping the Fog |
| 31 | `L8A4_T` | Spidey vs. Doc Ock! |
| 32 | `L8A5_T` | Spidey vs. Carnage! |
| 33 | `L8A6_T` | Spidey vs. Monster-Ock! |

#### Extra, alternate and incomplete stages

Group 1 has 59 nonempty TRGs. **Verified—ROM.** In addition to the campaign:

| TRG slot(s) | family | status |
|---:|---|---|
| 30, 35 | `Dem1` | two scripts over one complete G/L/O demo family |
| 36 | `Dem2` | complete demo family |
| 37 | `Demo1` | TRG exists; requested G/L/O family is absent |
| 38 | `L1A2a` | complete alternate Bank Approach G; reuses L1A2 O, requested L is absent |
| 39–42 | `L9A1`–`L9A4` | complete training arenas |
| 43–46 | `LBA1`–`LBA4` | complete training arenas |
| 47–50 | `LCA1`–`LCA4` | complete training arenas |
| 51–53 | `LDA1`–`LDA3` | complete training arenas |
| 55 | `LGA1` | complete training arena |
| 56 | `LHA1` | complete training arena |
| 57 | `Dem3` | complete demo family |
| 58 | `Dem4` | complete demo G with L5A5 L/O |
| 59 | `L3A1a` | complete stale TRG; all requested G/L/O files are absent |

The L9/LB/LC/LD/LG/LH TRGs explicitly load `training` and carry the countdown
strings `TRAINING IN : 3`, `2`, `1`, `Go!!!`; their role is not inferred from
the stem alone. **Verified—decoded TRG bytes.**

Expose 56 geometry-bearing sidebar choices: the 34 campaign areas, L1A2a, 17
training arenas, and Dem1–4. Give Dem1's second TRG as a setup variant, making
57 selectable setups. Exclude Demo1 and L3A1a because the normal filename
loader cannot obtain their model families. `levels/stages.csv` is the exact
TRG/G/L/O association and per-stage census.

#### Stage composition

Most level families have three model bundles: `*_G` contains world geometry,
`*_L` is an authored-empty shell, and `*_O` contains static/scripted props.
The unique main-image table at offset `0xD3A08` has 298 stride-8
`{name.psx pointer, model slot}` records, resolving 258 nonempty model slots.
**Verified—ROM.** A level loader combines:

1. the G shell and its group-2 render bank as `main`;
2. the O shell and TRG-resolved PLATFORM/MANIPOB overlays as `objects`;
3. descriptor-kind `0x0800` skipped geometry as a hidden candidate
   `collision` layer;
4. unresolved/path/camera/pickup TRG positions as `markers`.

### 3.3 Geometry

#### Mesh backdrops

Skylines/backgrounds are ordinary model objects, not group-4 full-screen
images. TRG opcode `0xAB` reads a model checksum and three angular velocities,
calls constructor `0x80055E60`, and enables the background subsystem. The
constructor resolves checksum against the loaded O bank; missing values fail
softly. Draw path `0x800570F4` builds a camera-relative matrix, rotates by
`-pi`, adds authored translation and calls object renderer `0x80051368`.
**Verified—disassembly.**

Backdrop translation is a real exception to ordinary shell placement. Live
background records hold on-disk signed 20.12 translation divided by 4096; the
draw path then divides those floats by 16. Use `raw/(4096*16)`, followed by
`(x,-y,-z)`, for a backdrop—not ordinary `raw/(4096*2.25)`. **Verified—RAM/
disassembly.**

`environment/background_catalog.py` resolves 52 of 53 distinct stage
references to exact O-bank objects. The sole dangling value is L8A2 checksum
`0x37FAF2CD`; its other two backgrounds resolve. Backdrop instances belong in
a separate toggleable `background` layer and should ignore camera translation
while retaining rotation. City stages use rotating skyline meshes; most
indoor/training stages use black/no sky and issue BackgroundOff.

### 3.4 Display lists and render state

### 3.5 Textures and materials

#### Geometry groups and materials

Descriptor word 0 is the global texture slot. Kind bit 0 enables texturing;
`0x0400` is active-low lighting; `0x8000` is non-display-list data; `0x0800`
selects groups skipped by the normal renderer. **Verified—disassembly at
`0x800D1DF0` and neighboring branches.** Triangle side-table low bits retain
the PS1-family face flags: `0x0040` semitransparent, `0x0080` draw/ABR,
`0x0180` blend-rate mask, `0x0200` double-sided, `0x0800` Gouraud.

The native renderer uses F3DEX.NoN FIFO 2.08 (ID string at main-image
`0xE4398`, RAM `0x800FAE78`); L3DEX FIFO 2.08 is also present. Ordinary model
drawing begins at `0x800D1CE8`. **Verified—ROM/disassembly.**

#### Texture dictionary

Group 3 contains 2,594 slots, of which 2,582 are nonempty. **Verified—ROM.**
Each record begins:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 0x20 | u8[0x20] | name | Printable name. |
| 0x20 | 2 | u16 | width | Width in texels. |
| 0x22 | 2 | u16 | height | Height in texels. |
| 0x26 | 2 | u16 | format | Format/bits-per-pixel word. |
| 0x2A | 2 | u16 | dataSize | Stored pixel-data byte count. |
| 0x2C | 1 | u8 | wrapS | 0 repeat, 1 mirror, 2 clamp. |
| 0x2D | 1 | u8 | wrapT | 0 repeat, 1 mirror, 2 clamp. |
| 0x2E | 1 | u8 | alphaThreshold | Alpha threshold. |
| 0x2F | 2 | u16 | renderFlags | Intentionally unaligned. |
| 0x3F | dataSize | u8[] | pixels | Pixel data, followed by palette when applicable. |

Rows are padded to 64-bit TMEM words and odd rows exchange their two 32-bit
halves. CI4 palettes are sixteen BE RGBA5551 entries following `dataSize`.
The corpus contains 2,402 CI4, 105 I4, 25 IA8, 19 I8, 16 RGBA16 plus a
full-resolution 4-bpp auxiliary plane, 11 plain RGBA16, and 4 IA4 records.
Complete mip chains may be stored. **Verified—ROM and texture-state
disassembly at `0x800D4B30`/`0x800D4CF4`.**

When alpha threshold is `0xFF`, render-flags low bits mean opaque (0/2),
coverage/cutout (1), or translucent (3). I4/I8 intensity supplies both colour
and alpha. Unlit vertex alpha participates in blending; the lit path carries
normal data in those bytes.

### 3.6 Collision

#### Collision candidate

Kind-`0x0800` groups contain valid private display lists but the normal model
renderer skips them. Decoding without advancing the visible group's cache
exposes substantial simplified geometry: every retail G bank except L8A5 has
24–1,204 such triangles. **Verified—ROM.** Their invisibility, simplicity and
spatial fit make them the best collision-layer candidate, but the N64 gameplay
query has not been found. **Hypothesis:** treat them as collision. A viewer may
expose them in a hidden-by-default `collision` layer, labelled by source kind,
without claiming every triangle is physical collision. `bounds.bin` is only a
24-byte culling/bounding record per mesh, not polygon collision.

### 3.7 Environment, sky, fog, and lighting

#### Lighting and model render state

The static setup display list at `0x800FF408` points to a Lights1 body at
`0x800FF360`: ambient `(70,70,70)` and directional `(105,105,105)`, vector
`(0,-127,0)`. **Verified—ROM.** There are no level-local light nodes. A viewer
can bake grayscale ambient plus downward Lambert, yielding intensity 70–175
out of 255.

The ordinary renderer uses baseline combiner `FCFFFFFF FFFE7838` and render
mode `0x0C184B50`. Special kind `0x10000` selects `0x0F0A4000`, or
`0x0C192078` when kind `0x20000` is also set. Global
`0x80101678` selects front/back culling. A tint path controlled by
`0x80105034` uses environment bytes `0x80105080..83`, primitive bytes
`0x80105084..87`, and textured/untextured combiners
`FC127E05 FFFFF2F8` / `FC527E1F FFFFF2F8`. **Verified—disassembly.**

#### Sky, fade and fog

TRG opcode `0xCA` (`0x800A7244`) packs sky RGB as R in the first operand's low
byte and G/B in the second operand's high/low bytes. `0x800598C8` stores the
current colour at `0x800EDF3C..3E`; it is consumed by a full-screen fill path.
Common colors are warm city yellow `#FFFD9C`, muted blue-gray `#466973`, teal
`#50A86D`, dark blue `#223249`, and black. **Verified—ROM/disassembly.** Use
the active restart's value as `Level.clearColor`.

Fade opcode `0xC8` stores a separate packed value at `0x800EAEC0`; it must not
be confused with clear color. Fog opcode `0x68` supplies `{transitionFrames,
start, range}`. The handler stores start at `0x800EAEAC`, end at
`0x800EAEA8`, and interpolated state at `0x800EAEB4..BC`; it passes
`(0,(start+range)/16)` to the projection/view routine. Per-frame code emits
`FOGPOSITION` and `SETFOGCOLOR`. It begins with current sky RGB, but specific
game modes substitute hard-coded colors. **Verified—ASM.** In the captured
L1A1 opening, authored sky was `#FFFD9C` while the cutscene override emitted
fog `#FFCD87`.

The precise group rule is conditional: untextured groups clear `G_FOG`, while
textured groups preserve the incoming state. **Verified—disassembly, corrected
by runtime capture.** In the captured L1A1 frame, root DL `0x8011C1F8` sets
geometry mode `0x00210405` including fog immediately before scene DL
`0x8022C840`. A backdrop group was drawn earlier with fog off. Apply authored
fog to textured scene groups but not ordinary untextured groups or backdrops;
split instances by fog class if the existing instance-level `noFog` contract
requires it.

### 3.8 Cameras and paths

#### Environment and camera

Environment state is authored in each TRG's restart/autoexec command stream.
The strict scanner parses all 59 files without restart/autoexec errors and
finds 86 restarts, 75 BackgroundCreate commands, 75 fog commands, 65 sky-color
commands, 61 fade-color commands and 22 BackgroundOff commands. There are no
LIGHT/OFFLIGHT nodes. **Verified—ROM/tool** (`environment/scan_environment.py`,
`trg_environment.json`). Multiple restarts can carry different state; a loader
must not collapse a stage to one unconditional environment tuple.

#### Spawn and camera

Restart records contain BE signed positions, three signed 16-bit angles where
4096 is one turn, a NUL name and command list. Convert positions by `/2.25`
and axes `(x,-y,-z)`; native rotation order is Y*X*Z. **Verified—ROM and stage
cross-check.** Use a chosen restart as the static viewer camera origin/facing.

Gameplay follow cameras are script-driven. Verified handlers cover camera
angle (`0x82`), XZ/Y distance (`0x87/0x8F`), XYZ offsets (`0x90..92`), mode
(`0xA0`), zoom (`0xA7`), pitch/Y damping (`0xA8/0xAC`), tripod focus
(`0xAD`), five-value Spider-Man camera configuration (`0xB4`), and angle lock
(`0xBB`). Reproducing that state machine is unnecessary for an initial viewer;
one static restart view is an honest starting camera.

#### L1A1 runtime reference

A serialized clean New Game path captured the L1A1 opening, then paused and
dumped 8 MiB RDRAM 0.052 seconds after the reference frame. Frame SHA-256 is
`dbfda260ea6e46ff036a77a803a28b8ea8d89739077908b06f103949faf323c1`;
RAM SHA-256 is
`8f89d70b16ba69cf4488e0f70b64e666d9c963ff318e2676c7fb07689b9ad147`.
**Verified—frame/RAM.** Captured values include sky `#FFFD9C`, two background
objects, fog start/end 10000/12048, completed transition, tint disabled, and
cutscene-mode hardware fog color `#FFCD87`.

At root DL `0x8011C1F8`, immediately before principal world DL `0x8022C840`,
the game emits fog position/color and geometry mode `0x00210405` including
`G_FOG`. The earlier background pass runs with fog disabled. The two live
L1A1 backdrops join exactly to static checksums/meshes:

| checksum | mesh | camera-relative draw position |
|---|---:|---|
| `DE834642` | 5 | `(-221, 70.3125, -1087)` |
| `160FC566` | 4 | `(-214.5, 87.4375, -1092.125)` |

`environment/analyze_runtime.py` reproduces these values from the immutable
capture rather than relying on ad hoc debugger transcription.

## 4. Objects

### 4.1 Placement records

#### Model bundles and placement

A group-0 file is a four-child relative-offset table containing object records,
bounds, a big-endian PSX-v4-style model shell (`0x00020004`), and a BE group-2
render-bank id. The shell header gives metadata and object count; each 36-byte
object record includes flags, three signed 20.12 translations, and a mesh
index. Each shell mesh index selects the same-index root node in the render
bank. **Verified—ROM and complete corpus cross-check.**

Render-bank tables are recursive:

| Structure | Contents |
|---|---|
| Record | Mesh-node references. |
| Node | Floating-point bounds, geometry-group table, and vertex pool. |
| Group | 12-byte descriptor, compact display-list tokens, and triangle-flag table. |
| Vertex pool header | Eight-byte header below. |
| Vertex pool body | `count` 16-byte F3DEX2 `Vtx` records, stored byte-plane-transposed as described below. |

Vertex-pool header, eight bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | count | Vertex count. |
| 0x04 | 4 | u32 | zero04 | Zero. |

The pool is byte-plane-transposed: byte `k` of vertex `i` lives at
`body[k*count+i]`. Node bounds distinguish this decisively from an ordinary
interleaved pool. Reassembled vertices are 16 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 6 | s16[3] | position | X, Y, Z. |
| 0x06 | 2 | u16 | flag | Vertex flag. |
| 0x08 | 4 | s16[2] | texcoord | S, T. |
| 0x0C | 4 | u8[4] | color | R, G, B, A. |

Compact token grammar, **verified—ROM and renderer disassembly**:

- `00`: end;
- high bit: triangle in two bytes, three 5-bit cache slots; emit `(c2,c1,c0)`
  to restore engine-facing winding;
- `0x20` class: vertex load, `n=word&31` (0 means 32),
  `v0=(word>>5)&31`;
- `0x40` class: matrix index in the next byte;
- `0x60` class: five-byte cache-slot S/T rewrite.

Static matrix binding is placement-relative: shell placing object plus the
token's matrix index. Coordinates are:

```
render vertex = raw / 2.25
shell offset  = raw / (4096 * 2.25)
viewer axes   = (x, -y, -z)
```

### 4.2 Object and model formats

### 4.3 Skeletons and animation

#### Objects, placements and animation

All 59 nonempty group-1 files are big-endian TRG 2.1: `GRT_`, version word
`0x00010002`, node count, then absolute node offsets. **Verified—ROM.** Relevant
spatial nodes include BADDY/SEEDABLEBADDY, POINT, POWERUP, RESTART, RAILDEF and
RAILPOINT, CAMPT, LIGHT/OFFLIGHT, SCRIPTPOINT/CAMERAPATH, and ENHANCEDSPAWN.
Positions use `/2.25`; angles use the low 12 bits with 4096 per turn. Native
rotation order is Y·X·Z before the `(x,-y,-z)` viewer conversion.

The 34 retail TRGs contain 5,913 decoded spatial nodes. The bounded stack-script
subset resolves 991 PLATFORM model assignments and every MANIPOB primary and
associated checksum plus 388 alternate/damage-state hashes. 1,064 of 1,070
primary model assignments join to the same TRG's O bank; all six misses are in
the tiny Dem1 attract script and likely use externally spooled models.
**Verified—structural cross-check.** Thirty-two PLATFORM records are inside
What-If conditionals and should be retained as an optional setup/sublayer.

The O shell provides base object placement. Coincident PLATFORM/MANIPOB nodes
decorate the same object with TRG rotation/state; off-bank nodes add instances.
For unresolved visual models and inherently point-like nodes, emit markers with
TRG slot/node, checksum, subtype, position, angles and links in `info`.

Model shells may carry direct `0x2A` or compressed `0x2C` animation chunks.
Both have BE headers and eight-byte table entries. Direct matrices are 24-byte
all-BE s16 records; compressed channel values are LE s16. **Verified—ROM.**
Static/frame-zero rendering is sufficient for the level viewer. Runtime
animation cadence and per-clip loop/clamp behavior remain open.

### 4.4 Behaviors, triggers, and scripted objects

## 5. Audio

### 5.1 Audio storage and banks

### 5.2 Sequence format and driver

#### Music player

Spider-Man has no conventional gameplay song-sequence files. Its soundtrack is
adaptive playback of prerecorded mono Nintendo VADPCM loop fragments through a
Nintendo Sound Tools/Software Creations effect engine on libultra's synth.
**Verified—ROM/disassembly.** Effects 364–471 form 108 music stems; the retail
fixed scheduler and adaptive selector use 79 of them. Effect 988 is the
separate title/menu loop.

#### Bank and driver

| role | extracted file | bytes | SHA-256 |
|---|---|---:|---|
| WBK samples | `group5/leaf000.bin` | 14,032,866 | `bd3b492ac36fd015f102a6634134de5430f05038ab2bae8e9cf7312336f0980e` |
| BFX effects | `group6/files/0000_raw.bin` | 28,366 | `911ed097ec9349cbe78109d60b5ec175be69f37bde6fa909c012c567b9c8e5c1` |
| PTR descriptors | `group6/files/0001_ptr.bin` | 176,294 | `e466a46e88b3c94b4779459de15c2d1d95dae7ae2133be338f3718fc97eb9140` |

PTR magic is `N64 PtrTablesV2\0`; WBK magic is `N64 WaveTables \0`. The PTR
describes 996 waves, each using order-2/four-predictor ABI1 ADPCM, plus base
note, signed fine tune, codebook, byte extent and optional loop state. There
are 165 looped waves. **Verified—ROM.** BFX has 994 one-component effects and
a 992-entry local-wave-to-PTR map:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | componentCount | 994. |
| 0x04 | 4 | u32 | effectCount | 994. |
| 0x08 | 4 | u32 | localWaveCount | 992. |
| 0x0C | 8 | u32[2] | zero0C | Zero. |
| 0x14 | 4 | u32 | localWaveTableOffset | 0x670E. |
| 0x18 | 8 × componentCount | component[] | components | Component index records. |
| Following | Variable | u8[] | bytecode | Component commands. |
| localWaveTableOffset | 2 × localWaveCount | u16[] | localWaveToPtrWave | Local-wave to PTR-wave indices. |

Component index record, eight bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | componentOffset | Component bytecode offset. |
| 0x04 | 4 | s32 | defaultPriority | Default priority. |

Music components use `81 wave; 84 envelope[7]; 9C pan; A6 volume note length;
80`. All effects 364–471 have indefinite event length and infinite PTR loop,
priority 100, center pan and note 48. Initialization at `0x8003120C` requests
22,050 Hz; the NTSC divisor is 2,208/DACRATE 2,207, yielding **22,047 Hz**.
**Verified—disassembly.** Gameplay uses packed routing mode `0x00010000`
through dispatcher `0x8002FAD4`, which replaces the dedicated music voice.

Music stems have net pitch -11 semitones. Sound Tools' single-precision
polynomial gives ratio `0.529734075...` and effective source rate
`11679.047...` Hz, not exactly ideal `2^(-11/12)`. **Verified—disassembly/tool.**

#### Production music list

Expose 36 production entries: title/menu, 26 fixed arrangements, and nine
adaptive profiles. Shared rows are genuinely shared compiled schedules, not
missing names. Mysterio and LG each retain two retail variants.

Fixed arrangements, **verified—ROM/disassembly**:

| use/code | effect order | duration ticks |
|---|---|---|
| Race to the Bugle `0201` | 415,416,431,432,433 | 208 ×5 |
| Spidey vs. Scorpion `0202` | 458,459,457 | 410,210,210 |
| Missile Attack `0302` | 436,436,434,434,437,436,435,437,436,434,434,435 | 115,115,230,230,115,115,471,115,115,230,230,471 |
| Spidey vs. Rhino `0401` | 396,397,398,398,400 | 122,122,122,242,242 |
| Catch Venom `0501` | 393,394,395 | 108 ×3 |
| Spidey vs. Venom `0502` | 389,390,391 | 115 ×3 |
| Subway `0505` | 364,365,366,367 | 235 ×4 |
| Tunnel Crawl `0601` | 410,411,410,411 | 208 ×4 |
| Venom's Puzzle `0602` | 373,374,373,374 | 208 ×4 |
| Lizard's Maze `0603` | 373,374,373,374,373 | 208 ×5 |
| Venom Again `0604` | 438,439,440 | 287 ×3 |
| Symbiotes Infest Bugle `0701` | 419,419,420,420,420,421,421,422,422,422 | 158,158,158,158,158,158,161,161,158,158 |
| Elevator Descent `0702` | 396,396,398,398,396,396,397,398,398 | 119,119,119,119,119,119,238,119,119 |
| Bugle's Basement `0704` | 379,379,380,380,381,381,380,380,381,381 | 132,132,132,132,266,266,132,132,266,266 |
| Mysterio `0705`, variant 0 | 423,423,424,424,424,424,428,428,428,428,428,427,427,427,424,424,424,424 | 117,117,235,235,235,235,117,117,235,235,235,235,117,117,235,235,235,235 |
| Mysterio `0705`, variant 1 | 427,427,427,427,425,424,425,424,428,428 | 235 ×8,117 ×2 |
| Underwater Trench `0802` | 405,405,405,406,406,406,408,408,408,409,409,409 | 256 ×12 |
| Doc Ock `0804` | 386,386,386 | 300,320,245 |
| Carnage `0805` | 368,369,370,371 | 235 ×4 |
| Monster-Ock `0806` | 452,453,454,455,452 | 235 ×5 |
| L9 training `0901–0904` | 458,458,459,459,459,459 | 204 ×6 |
| LB/LC training `1101–1104,1201–1204` | 460×4,461×4,462×3,463×3 | 124 ×4,248 ×10 |
| LD training `1301–1303` | 468,469,470,471 | 112,112,112,113 |
| LG training `1601`, variant A | 403 | 400 |
| LG training `1601`, variant B | 404 | 400 |
| LH training `1701` | 447,447,448,448,449,449,449,450,450,450,449,449,450 | 317 ×13; loop restarts at entry 3 |

Adaptive selector `0x8004C560` fades one loop in/out according to level state:

| profile | stages | active effect |
|---|---|---:|
| city approach | `0101,0102` | 444 when gate nonzero |
| hostage/bomb | `0103,0104` | 375 when gate nonzero |
| chopper rooftops | `0301,0303,0304,0305` | 435 when gate nonzero |
| sewer entrance/cavern | `0503,0504` | 441 when gate nonzero |
| sewage plant | `0506` | 418 when gate nonzero |
| hidden switches | `0507` | 414 when gate nonzero |
| presses | `0703` | 378 when gate nonzero |
| waterfront | `0801` | 404 when gate nonzero |
| stopping the fog | `0803` | 465 when gate zero |

Title/menu effect 988 is a 15.264-second sample with decoded loop
`5466..178266`, count `0xFFFFFFFF`. Its start at `0x8003173C` and stop at
`0x80031708` were also **verified—runtime**: breakpoint entry saw effect 988,
caller return `0x80031764`.

#### Decode, scheduling and loops

Implementation order:

1. Resolve BFX local wave through the EOF u16 map to PTR, then WBK bytes.
2. Decode 9-byte ABI1 frames to 16 PCM16 samples with existing
   `libultra.ts` semantics: predictor/scale nibble, two eight-sample halves,
   signed wrapping Q11 accumulation, PCM16 saturation and carried history.
3. Apply Sound Tools' pitch ratio and the existing 64-phase, four-tap Q1.15
   resampler at the 22,047-Hz mixer rate. A simpler preview may emit 11,679-Hz
   PCM, but it is not the exact game filter.
4. Play `[0,loopEnd)` once, then repeat `[loopStart,loopEnd)` until the compiled
   schedule duration expires; do not play stored bytes after loopEnd.
5. Fixed profiles concatenate their entries and loop the whole arrangement.
   LHA1 alone has a one-time entries-0–2 intro and loops entries 3–12. Adaptive
   and title entries return the single wave with rescaled PTR loop points.

Duration words are **hypothesized** to tick at 30 Hz; static values and ordering
are verified, but the live 30-versus-60 measurement remains pending. Preserve
BFX relative volume operands; exact final Sound Tools envelope/pan gain is an
optional capture-fidelity question.

### 5.3 Instruments and sample encoding

### 5.4 Music catalog and loop points

## 6. Unused and hidden content

### 6.1 Unreferenced assets

This section deliberately separates incomplete/unreferenced material from live,
gated features. Evidence comes from `hidden/audit_hidden.py`, complete
filename/TRG/model/texture reference censuses, and overlay disassembly.

#### Incomplete alternate L3A1 section

Group-1 slot 59 is a complete 5,342-byte TRG with 110 nodes and requests
`L3A1a_G`, `L3A1a_L`, `L3A1a_O`, `expgrnd` and `CHOPPER`. Retail L3A1 itself
retains a linked `LoadNewTrg("L3A1a_T")` after KillEverything/ClearAllPSXs/
ClearAllCodeModules. **Verified—decoded ROM.** Yet:

- the 56-row TRG filename registry omits L3A1a;
- the 298-row model registry contains none of its G/L/O names;
- the complete group-0 inventory has no unnamed candidate family.

Therefore the transition and authored trigger survived but the unique model
family was stripped. **Inference:** removed/obsolete alternate section. It is
not a playable hidden level and should not appear as a viewer level.

#### Declaratively unreferenced recording studio

Group-0 slot 262 is the only substantive model bundle absent from the model
filename registry. Its shell has 21 objects, render bank 252, 291 visible
triangles and no skipped groups. Thirteen textures (2403–2415) are exclusive to
that bank and visibly show a wood floor, treated walls/curtain, pipe details and
a mixing console. A unique cross-port content key names it `studio`, while the
art independently establishes a recording-studio interior.

It is absent from all 59 TRGs' filename operands and all 298 model-name rows;
the ordinary name loader cannot resolve it. **Verified—ROM/reference census.**
The engine also has dynamic numeric model access, and static analysis did not
prove that slot 262 can never reach it. Label this **unreferenced by every
declarative route; numeric runtime reachability open**, not provably dead. It
has no TRG and is a model scene rather than a complete playable stage.

Evidence images: `levels/renders/0262_studio.png` and
`hidden/studio-textures.png`.

#### Dangling L8A2 background

L8A2 creates backgrounds with three checksums. Two resolve in its O bank;
`0x37FAF2CD` occurs once in that TRG and nowhere in any group-0 object table.
Constructor `0x80055E60` simply returns after a failed lookup. **Verified—ROM/
disassembly.** This is a nonfatal dangling request, plausibly residue from a
removed backdrop, whose image cannot be recovered from this ROM.

The same TRG contains unique text `Cheat Code!: STRUDL`. It does not match any
row in the 24-entry Special/Cheats table; its activation/meaning remains open.

#### Candidate unused music stems

Twenty-nine valid looped effects inside the homogeneous music range are absent
from both production music selectors:

```
372 376 377 382 383 384 385 387 388 392
399 401 402 407 412 413 417 426 429 430
442 443 445 446 451 456 464 466 467
```

Six—372, 377, 413, 417, 443, 467—remain as constants in branch-delay slots but
are overwritten by the taken branch before return, unusually strong evidence
of abandoned alternatives. **Verified—ROM/disassembly.** These are
candidate-unused production stems, not globally unreachable: the developer All
Sound Menu can audition arbitrary effects 0–993. Effect 363 is excluded because
ordinary alias 154 uses it as a looping SFX.

#### Live cheats, debug and easter eggs

These are shipped, referenced facilities and are not unused content. The
24-row table and checker at `0x80042074` verify, among others:

| input | facility |
|---|---|
| `LVLSKIPPER` | Level Select |
| `LISTEN` | All Sound Menu |
| `LLADNEK` | debug info |
| `TRUBLEVR` | everything |
| `HELP ME` | full health |
| `STICKYSTUF` | webbing |
| `TURTLE` | invulnerability |

Other rows gate costumes, storyboards, comics, slide shows, Character Viewer,
What If Contest and Special Things. **Verified—ROM/disassembly.** The checksum
routine derives a length-dependent multiplier, iteratively XOR/adds each byte,
and applies final XOR `0x2EF13981`; the listed inputs reproduce their table
hashes exactly.

Rostered overlay `sm_relocdata` contains executable lookup code plus two
29-entry string tables: profanity in, intentionally sweet words such as
`FLOWER`, `PUPPY`, `RAINBOW` and `ICECREAM` out. **Verified—overlay
disassembly.** It is an input easter egg, not dead strings. Rostered
`sm_epanelinfo` also contains developer/gag captions; their precise menu route
was not exhaustively proved.

#### Negative audit results

- Demo1 and L3A1a are the only complete TRGs whose requested model families
  are absent; only L3A1a is omitted from the executable TRG registry.
- Group-0 slots 235 and 257 are empty shells; slot 262 is the sole unregistered
  bundle with content.
- The 46 group-4 full-screen images cover title/save/costume/comic/boss/end art;
  visual review found no clear orphan, but did not prove reachability of every
  image.
- 397 nonempty texture slots are unreferenced by parsed named render banks.
  They are not called unused because UI, image, numeric-model and other paths
  can consume global textures.
- All 30 overlay roster entries are referenced by the roster; none is labelled
  unused solely because it lives after the master directory.

### 6.2 Cut or inaccessible levels

### 6.3 Debug features

### 6.4 Prototype or revision-specific content

## 7. nviewer implementation

### 7.1 Module mapping

#### Mapping onto `src/rom/`

No new shared renderer contract appears necessary for an initial implementation.
Use the existing `Level`, `LevelLayer`, `Mesh`, `Batch`, `Instance`, `Marker`,
`Texture`, `CameraView`, `MusicTrack` and `DecodedMusic` types. Add game id
`spiderman` in the shared type/index only under main-session ownership.

#### Implemented viewer coverage

The implementation exposes 57 sidebar entries: the recommended 56 complete
stage families plus the coherent slot-262 recording studio as an explicitly
unreferenced diagnostic model scene. It expands authored restart state and the
second Dem1 TRG into 85 total selectable setup records, preserving their
separate cameras, backgrounds, sky/fog colours and command state. All emitted
instances belong to `main`, `objects`, optional `objects (What If)`,
`background`, `markers` or hidden `collision` layers. **Verified—repository/tool:**
all 85 records load twice through transferable structured clones, the layer
audit reports no loose instances, and the implementation hash is
`1c065804200781e9bfae8d88d933acfcac605b36`.

All 36 production music profiles are implemented with cached WBK/PTR/BFX
parsing, ABI1 VADPCM decoding, the Sound Tools pitch calculation and resampler,
fresh transferable stereo buffers and authored loops. **Verified—repository/tool.**
The 30 Hz fixed-schedule duration conversion and exact final envelope/pan gain
remain the *Decode, scheduling and loops* research limitations.

Implemented ownership/files:

| file | responsibility | difficulty |
|---|---|---|
| `src/rom/spiderman/fs.ts` | identify `NSLE`, boot/master tables, ERZ2 page decode and logical group access | medium; exact bounded reference exists |
| `model.ts` | group-0 shells, group-2 recursive banks, transposed vertices, compact tokens and matrix placement | medium-high; cache/S-T updates and skipped groups need care |
| `texture.ts` | global dictionary, TMEM row swap, CI palettes, I/IA/RGBA, wrap and authored render classes | medium |
| `trg.ts` | TRG node records, restart/environment commands, model-file requests and bounded PLATFORM/MANIPOB stack bytecode | medium-high |
| `level.ts` | 57 sidebar entries/85 setup records, G/O composition, backdrop, lighting, camera, layers and diagnostics | medium-high |
| `music.ts` | PTR/WBK/BFX parsing, 36 profiles, ADPCM cache, resampling and schedule composition | medium |
| `spiderman.ts` | game object and version/profile assertions | easy |

The loader should emit:

- `main`, `objects`, `background` and `markers` layers, plus hidden-by-default
  `collision` for kind-`0x0800` geometry;
- one mesh/instance per stable source object or a safely batched equivalent,
  preserving source group/token/model/TRG ids in `info` and `triSource`;
- active restart sky color and static camera, with alternate restarts/setups
  exposed rather than discarded;
- What-If conditioned placements as optional variants;
- all geometry-bearing extra stages in *Extra, alternate and incomplete stages*, while incomplete TRGs fail softly
  and stay out of the sidebar;
- 36 production music profiles, with the 29 unused candidates optionally
  appended under explicit names.

The implementation caches decoded ERZ pages, textures and distinct music waves
inside the opened game instance. It does not repeatedly decode the 14 MiB WBK
or duplicate the same loop stem each time it appears in an arrangement. The
filesystem extractor and `levels/stages.csv` are references, not runtime data
files to bundle into the frontend.

First implementation risk is faithful TRG/O-bank composition and environment
selection, not the already bounded base geometry. Animated actors, the full
gameplay camera state machine and bit-identical Sound Tools envelope mixing are
follow-up features; frame-zero actors, restart camera and deterministic music
profiles are honest initial behavior.

### 7.2 Supported features

### 7.3 Approximations and omissions

## 8. Verification and remaining work

### 8.1 Verification evidence

| claim | evidence / reproducer |
|---|---|
| header, hashes, CIC and identity | direct header/hash commands; `fs/NOTES.md` |
| complete physical ROM map | `fs/spiderman_fs.py`; `fs/extracted/rom_ranges.csv` adjacency has zero gaps/overlaps |
| ERZ2 | resident `0x80000CF8`; all 1,584 blocks decode to declared sizes |
| master directory/files/overlays | `fs/spiderman_fs.py`, CSV manifests, loader disassembly; overlay bias checked at `0x8008A0A4` |
| retail/extra levels and G/L/O slots | `levels/survey_levels.py`, `stages.csv`, 59/59 TRGs parse |
| geometry/texture/material formats | complete bank/dictionary census, bounds/reference cross-checks, renderer disassembly; `levels/NOTES.md` |
| representative static renders | `levels/renders/contact.png` and component PNG/SVG files |
| environment/backdrops | `environment/scan_environment.py`, `background_catalog.py`, handler/renderer disassembly |
| L1A1 runtime environment | `emulator/session2/L1A1-title.png`, `L1A1-rdram.bin`, `d0.bin`, `d1.bin`, `g.bin`; reproduced by `environment/analyze_runtime.py` |
| placements | 5,913 retail spatial nodes; 1,064/1,070 primary assignments join to their O bank |
| music bank/effects/schedules | `music/analyze_audio.py`, `extract_music.py`, `music_schedules.json`; scheduler/selectors in disassembly |
| title/menu music | runtime breakpoint at `0x800DA77C`: effect 988, return `0x80031764` |
| hidden/unreferenced claims | `hidden/audit_hidden.py`, `audit.json`, exclusive texture and table-reference censuses |

All research scripts are standard-library Python or direct disassembly helpers,
hash-pin their critical input where appropriate, use bounded table traversal,
and write only beneath this research directory.

### 8.2 Known unknowns

#### Open questions

1. Do kind-`0x0800` triangles feed the gameplay collision query, or are some a
   different engine-only class? They are verified renderer-skipped geometry;
   “collision” remains a hypothesis.
2. Are schedule duration words 30-Hz game ticks or 60-Hz video frames? Ordering
   and raw durations are exact; the seconds conversion awaits two live ticks.
3. Can any dynamic numeric model-loader path reach unregistered slot 262
   (`studio`)? Every declarative route omits it.
4. What was the missing L8A2 background `0x37FAF2CD`? The ROM retains only the
   dangling request.
5. What are the exact actor animation cadence/loop policy and full behavior of
   texture format `0x0014`'s auxiliary plane?
6. Which complete training/demo stages are ordinary-save unlock/parade content
   versus developer-only? Geometry/loading does not depend on that answer.

### 8.3 References
