# A Bug's Life (N64): ROM format specification for the level viewer

This document specifies the retail Nintendo 64 data used by *A Bug's Life*,
with the US release as the reference image. It is intended to be sufficient to
implement level and music support in nviewer without running the game.

Evidence labels used throughout:

- **[V-ROM]**: direct ROM or decompressed-file bytes.
- **[V-ASM]**: MIPS disassembly of the shipped executable.
- **[V-TOOL]**: deterministic parser/checker output from those bytes.
- **[V-RAM]**: retained RDRAM or RSP-task data from the sole emulator session.
- **[V-FRAME]**: retained emulator screenshot.
- **[V-AUDIO]**: decoded music-bank, sequence, or audio-task evidence.
- **[V-REPO]**: direct inspection of the current nviewer implementation.
- **[HYPOTHESIS]** and **[OPEN]**: interpretation or unfinished work, never a
  verified format fact.

All ROM and file intervals are half-open unless stated otherwise. Multi-byte
values are big-endian.

## 0. At a glance

- **[V-ROM]** The US ROM is 12 MiB, CIC-6102, ID `NBYE`, revision 0.
- **[V-ROM/V-ASM]** A 488-entry path manifest describes an archive containing
  463 RNC method-1, 20 RNC method-2, and five raw files.
- **[V-ROM/V-TOOL]** Seventeen complete 3-D packages exist: Training, fifteen
  story stages, and Bonus. No extra or cut 3-D map was found.
- **[V-ASM/V-TOOL]** Visible geometry is a custom CPU-decoded mesh stream in
  `level.dat`; `terrain.all` is collision, not the visible terrain.
- **[V-ROM/V-ASM]** Texture pages are custom `.tpg` files. Nine stages also
  have raw 256x41 parallax panoramas; every stage has an envmap page.
- **[V-RAM]** The live Training renderer uses F3DLX 1.23, a 75-degree vertical
  FOV, and a separate distant projection. A sampled pass uses blue fog.
- **[V-ROM/V-ASM/V-AUDIO]** Music is Sound Tools/libmus song format `0x215`
  over Nintendo ABI1 at 22,047 Hz. There are 20 unique songs, including two
  one-shots, with exact loop points below.
- **[V-ROM]** The strongest likely-unused file is `level96\\lose.pic`. Five
  valid ADPCM waves are referenced by neither shipped song maps nor the
  93-entry sound-effect bank.

Implementation difficulty is **medium-high** for levels and **medium** for
music. RNC1/RNC2 decoding and the custom mesh/texture parsers are new work;
the current `music/libmus.ts` renderer is reusable.

## 1. ROM identification and versions

### 1.1 Reference US release

**[V-ROM]**

| Property | Value |
|---|---|
| Source | `Bug's Life, A (U) [!].z64` |
| Size | `0xC00000` (12,582,912 bytes) |
| Byte order | native big-endian `.z64` |
| PI / clock / entry / release | `80371240 / 0000000F / 80006000 / 00001444` |
| Header CRC1 / CRC2 | `82DC04FD / CF2D82F4` |
| Internal title | `A Bug's Life` |
| Game code / revision | `NBYE` / 0 |
| CRC32 | `CF2EA0B6` |
| MD5 | `7fd6bffb80f920e01ef869829d485ea3` |
| SHA-1 | `697c1e895fc840826fcb6a6f37411a2af6d6f47c` |
| IPL3 CRC32 / CIC | `90BB6CB5` / CIC-6102 |

The CIC-6102 checksum was independently recalculated and exactly matches both
header words. The last non-`FF` byte is at `0xBAD883`.

### 1.2 Other compatible retail builds

**[V-ROM/V-TOOL]** All five surveyed builds are 12 MiB, revision 0,
CIC-6102, and enter at `0x80006000`. Their 488 manifest paths have identical
names and order. All gameplay packages, `.all`, `.anm`, `.n64`, envmap, and
parallax data decompress byte-identically; 28 localized UI, controller, font,
FX, and audio-metadata files differ.

| Build | Code | CRC1 / CRC2 | MD5 | SHA-1 |
|---|---|---|---|---|
| US | `NBYE` | `82DC04FD / CF2D82F4` | `7fd6bffb80f920e01ef869829d485ea3` | `697c1e895fc840826fcb6a6f37411a2af6d6f47c` |
| Europe | `NBYP` | `8F12C096 / 45DC17E1` | `ed3e962653a1cd56aab175deee6ee52a` | `2922c2281faa4106295830c617289292df4c377a` |
| France | `NBYF` | `2B38AEC0 / 6350B810` | `d2860d4fbd0ec4b2711a6ef8d78f9866` | `4970ecc65e8de25990a241b0d2ffbe274cb1619a` |
| Germany | `NBYD` | `DFF227D9 / 0D4D8169` | `cbef54768670f4b5602ccbc90150007a` | `daa7114a8d16c3e636b2808d4f256e07954f05dd` |
| Italy | `NBYI` | `F63B89CE / 4582D57D` | `e3609fd12369c464e832c6d2a4d20790` | `46f9c5d7eb822b19be6910b992949def27e46887` |

One parser can support all five builds. Detect by header/hash or locate the
manifest structurally; do not reuse US absolute offsets for PAL releases.

## 2. Boot and resident code

**[V-ROM/V-ASM]** IPL3 copies ROM `0x1000` to `0x80006000`. Within the
resident image, the static relation is therefore:

```text
virtual address = ROM offset + 0x80005000
```

Startup clears BSS `[0x8009DD40, 0x801FCE20)` and calls `0x8000805C`.
Linked RSP identifiers include F3DEX 1.23 at ROM `0x86970` and F3DLX 1.23 at
`0x87170`; live Training uses the latter. Retained source/debug strings include
`sched.c`, `synthesizer.c`, `save.c`, `env.c`, and `reverb.c`.

## 3. Filesystem and compression

### 3.1 Manifest

**[V-ROM/V-TOOL]** The US manifest occupies `0xA89A0..0xABEC0`. Its 488
variable-size records are:

```text
char path[]       NUL-terminated ASCII Windows path
padding           through the next four-byte boundary
u32 storedSize
u32 auxiliary     always zero in all five builds
```

If `string_end` points at the NUL, the size fields start at
`(string_end + 4) & ~3`. A four-byte empty-name record terminates the table.
Payloads begin at `0xABEC0`, follow manifest order, and each next file begins
on an eight-byte boundary. The final aligned archive end is `0x8D17D0`.

**[V-ASM]** `0x8005D834` loads a `0x4000`-byte manifest window, compares paths
case-insensitively while normalizing separators, walks records, and accumulates
stored sizes rounded to eight. `0x8005DA54` is the PI-DMA wrapper and chunks
transfers at 4096 bytes.

### 3.2 Compression

**[V-ROM/V-ASM/V-TOOL]** `0x8005D560` checks `RNC` and the method byte, reads
the unpacked size from header `+4`, and dispatches:

| Codec | Count | Decoder |
|---|---:|---:|
| RNC method 1 | 463 | `0x80018440` |
| RNC method 2 | 20 | `0x80017000` |
| raw | 5 | none |

The 20 RNC2 files are `level15/end00..04.tpg` and all fifteen
`charpage/*.tpg` pages. The five raw files are `level03/light.tpg`,
`backdrop/disint.pic`, `fonts/tahoma08.fnt`, `level98/font.bin`, and
`level98/blank.pic`. For every RNC file, the 18-byte header plus its encoded
payload length equals the manifest's stored size.

The archive needs no external allocation or checksum table: manifest, aligned
payload sequence, and RNC headers are sufficient.

### 3.3 Regional locations

**[V-TOOL]**

| Build | Manifest | Data base | Indexed end | RNC1 / RNC2 / raw |
|---|---:|---:|---:|---:|
| U | `A89A0` | `ABEC0` | `8D17D0` | 463 / 20 / 5 |
| E | `A9600` | `ACB20` | `8C4538` | 460 / 20 / 8 |
| F | `AA460` | `AD980` | `8DAA70` | 459 / 18 / 11 |
| G | `A9D60` | `AD280` | `8DAC00` | 457 / 20 / 11 |
| I | `A9B60` | `AD080` | `8E4C20` | 456 / 20 / 12 |

Compression choice varies by build; decompressed content is the stable API.

## 4. Levels

### 4.1 Complete selectable list

**[V-ROM/V-ASM]** Sixteen user-facing progression slots map through the BE
`u32` table at ROM `0x80EC0`, terminated by `FFFFFFFF`. Bonus is a deliberate
special case: `0x80023218..0x80023220` selects internal ID 16 directly.

| UI order | Display name | Internal ID | Package |
|---:|---|---:|---|
| 0 | Training | 17 | `level17` |
| 1 | Ant Island | 1 | `level01` |
| 2 | Tunnels | 3 | `level03` |
| 3 | Council Chamber | 2 | `level02` |
| 4 | Cliffside | 6 | `level06` |
| 5 | Riverbed Canyon | 10 | `level10` |
| 6 | Birdnest | 11 | `level11` |
| 7 | City Entrance | 4 | `level04` |
| 8 | City Square | 5 | `level05` |
| 9 | Bug Bar | 14 | `level14` |
| 10 | Clover Forest | 7 | `level07` |
| 11 | The Tree | 12 | `level12` |
| 12 | Battle Arena | 13 | `level13` |
| 13 | Anthill, Part Two | 9 | `level09` |
| 14 | Riverbed Flight | 8 | `level08` |
| 15 | Canyon Showdown | 15 | `level15` |
| special | Bonus | 16 | `level16` |

The scan/map routine is `0x8001413C..0x800141B8`. Challenge objectives reuse
the one package for their stage; no alternate 3-D setup file exists.

### 4.2 Per-stage principal files

**[V-ROM/V-TOOL]** Each package 01–17 has exactly one `level.dat`, one
`terrain.all`, one `creat/creatNN.bin`, and one `envmaps/levelNN.tpg`.

| ID | Name | `level.dat` ROM / decoded | `terrain.all` ROM / decoded |
|---:|---|---|---|
| 1 | Ant Island | `106758..12A091` / `3C27C` | `12A098..154FA8` / `39D8C` |
| 2 | Council Chamber | `16C490..1778F7` / `12B48` | `1778F8..184D02` / `13F28` |
| 3 | Tunnels | `18F1A8..1B1C64` / `3A85C` | `1B1C68..1DD861` / `41850` |
| 4 | City Entrance | `1ED1B8..212E93` / `491A4` | `212E98..233BC2` / `3131C` |
| 5 | City Square | `2462C0..268F04` / `43DAC` | `268F08..285E00` / `2E5C0` |
| 6 | Cliffside | `2950B8..2A604A` / `2221C` | `2A6050..2C668D` / `2B924` |
| 7 | Clover Forest | `2D3EB8..2F14D0` / `3B3F4` | `2F14D0..307B9D` / `1F0D8` |
| 8 | Riverbed Flight | `318B90..334D34` / `374F4` | `334D38..3568BF` / `31784` |
| 9 | Anthill, Part Two | `36A7F8..38AC5D` / `381F4` | `38AC60..3AFE68` / `32AB4` |
| 10 | Riverbed Canyon | `3B5AD8..3DC257` / `43ADC` | `3DC258..3F2CE1` / `22C08` |
| 11 | Birdnest | `405F00..40D7E9` / `FB94` | `40D7F0..417C94` / `F078` |
| 12 | The Tree | `424AB8..44B4FD` / `493B4` | `44B500..47384C` / `35B84` |
| 13 | Battle Arena | `487CB8..49C157` / `228EC` | `49C158..4A0A77` / `618C` |
| 14 | Bug Bar | `4B5C30..4BC4CF` / `C414` | `4BC4D0..4BD68B` / `42C0` |
| 15 | Canyon Showdown | `4C1A00..4E457F` / `448F4` | `4E4580..505A26` / `3056C` |
| 16 | Bonus | `52B7E0..533A72` / `D8A8` | `533A78..543730` / `166D4` |
| 17 | Training | `54BD90..557F70` / `17C78` | `557F70..5610E7` / `C584` |

### 4.3 Non-gameplay namespaces

**[V-ROM]** The only `level` roots are 00–17 and 96–99. There is no content
under 18–95.

- `level00`: front-end/menu dataset; it has `level.dat` but no `terrain.all`.
- `level96`: challenge/story/result images, including 44 generated story
  panels and the questionable `lose.pic`.
- `level97`: title bitmap.
- `level98`: save/options/controller assets and font.
- `level99`: fourteen UI sprite bitmaps.

These are presentation packages, not hidden 3-D stages.

## 5. Visible scene format

### 5.1 `level.dat` envelope and placements

**[V-ASM/V-TOOL]** The file begins with an `s32 initialTableCount`, then
variable tables. Each table begins `s16 n, s16 type`; its byte length is:

```text
type < 0   : ((3*n + 1) // 2) * 4 + 16
type == 63 : n * 16 + 4
otherwise  : n * 12 + 4
```

After these comes a relative `u32` optional pointer, then 20-byte placements
terminated by a record whose signed halfword at `+0x0E` is negative:

```text
+00 s32 x
+04 s32 y
+08 s32 z
+0C s16 field0 / flags
+0E s16 field1 / terminator test
+10 u32 relativeModel
```

The terminator is followed by a signed pointer-table count. A nonnegative
value means `count + 1` relative `u32` pointers follow; `-1` means none. A
second 20-byte placement list follows and likewise runs to its terminator or
the first model payload.

The loader relocates the normal variant's model pointer at runtime `+0x14`
and builds its fixed-point 3x3 transform at `+0x18`. When placement flag bit
`0x8` is set those locations become `+0x1C` and `+0x20`. Model halfwords
`+0x0C/+0x0E/+0x10` are the three source angles.

### 5.2 Custom mesh stream

**[V-ASM/V-TOOL]** The visible payload is not stored GBI. Renderer
`0x8003C858` converts this stream to F3D-family commands:

1. Signed `u32 vertexCount`.
2. For the common positive form, `vertexCount` eight-byte vertices:
   `s16 x,y,z; u16 packedColor`. The last word carries 5-bit RGB channels.
3. Face groups `u16 control; s16 count`, ending when the next control is
   signed `-1`.
4. `kind = control & 0x1F`; `texture = (control >> 8) & 0x1F`; render-mode
   bits are `control & 0x60`.
5. Kinds 0/2/4/6/8/10/12/14 have 16-byte quad records. Kinds 1/3/9/11 have
   12-byte triangle records. Kinds 5/7/13 use the renderer default branch.
6. Quad/triangle vertex references are BE `u16`, masked with `0x0FFF`.
   Remaining bytes are per-corner U/V values, shifted left four by the game.

The all-level parser encountered successful common meshes using kinds
0, 1, 2, 3, 4, and 6. Quads should be split consistently only after matching
the game's winding/cull behavior.

**[V-TOOL]** Across all 17 files, 8,437 placements resolve to 8,269 valid
positive-count meshes: 333,678 vertices and 218,802 face records. The checker
logged 110 non-common attempts—negative-count streams, negative/pre-relocated
pointers, or non-mesh placement kinds—rather than guessing them. These are
valid engine variants, not corrupt data.

### 5.3 Coordinates and transforms

**[V-ASM]** Stored placement positions and common-mesh vertices are signed
integers. The runtime constructs a model transform from placement translation
and three 16-bit model angles.

**[OPEN]** The exact fixed-point angle-to-radian convention at `0x8001554C`,
the viewer axis conversion, model scale, and front-face winding need a render
comparison before they are frozen in implementation. The research OBJ export
is structural and intentionally does not claim final world transforms.

## 6. Collision and object containers

### 6.1 `.all` container

**[V-ROM/V-ASM/V-TOOL]** `.all` is a generic group container used for terrain,
characters, plants, and props. At `+0`, a `u32` gives the metadata offset in
halfwords: `metadataByteOffset = readU32BE(file, 0) * 2`. Group bytes occupy
`[4, metadataByteOffset)`. Metadata begins
with `u32 groupCount`, followed by `groupCount` records of `0x4C` bytes:

```text
+00 u32 data size in halfwords
+04 s32 x
+08 s32 y
+0C s32 z
+10 u32 group ID
...  record size 0x4C
```

Runtime routines `0x80030A70`/`0x80030FE8` advance data by `size * 2` and
metadata by `0x4C`. A zero-size record reuses the preceding data pointer at a
new position.

### 6.2 `terrain.all` collision

**[V-ROM/V-ASM]** Every stage uses:

- ID `0x06`: ordinary finite collision;
- ID `0x08`: dynamic finite collision, present only in 03, 04, and 15;
- ID `0x0101`: infinite-wall collision;
- ID `0x0104`: one footer/end record.

A finite group's batches are:

```text
s16 enabled          must be 1 for another batch
u16 triangleCount
u16 unknown[4]
CollisionTri tris[triangleCount]   // 32 bytes each
```

A negative/non-1 first halfword terminates the group. In each 32-byte
triangle, halfwords 3–5 are a local origin, 6–8 the delta to vertex 2, and
9–11 the delta to vertex 3. Add the metadata X/Y/Z to all three vertices. The
other fields are collision attributes.

**[V-TOOL]** All 17 files land exactly on their metadata offsets. All 3,297
finite group instances terminate on `FFFF`; expanding reused group data at
each position produces 113,028 finite triangles. Infinite-wall groups are not
decoded yet.

Collision belongs in a hidden-by-default `collision` layer. Finite groups may
be emitted now; `0x0101` must stay explicitly incomplete rather than treated
as ordinary triangles.

### 6.3 Objects and creatures

**[V-ROM/V-ASM]** Object resources live under `chars*`, `creat`, `bits`,
`plants*`, and related roots. `.anm` contains animation data, `.tpg` page
images, and `.all` the same group container. `0x80030A70` explicitly loads
`bits\\plantter.all`, then a requested object `.all`, relocates its groups,
and recognizes collision IDs 6/8. Placement rendering dispatches on the low
nibble of the `level.dat` placement flag.

**[V-ROM/V-TOOL; HYPOTHESIS semantics]** Each `creatNN.bin` expands to
`0x700` bytes: 64 records of `0x1C`. Treating record byte `+0x0C` as a
one-based creature/model type, every value `0x01..0x29` occurs across the
stages and matches in order all 41 registered model stems at ROM
`0x7DC44..0x7DE7F`. This strongly suggests no registered actor family is
orphaned from all stage placement data, but the type field and one-based
mapping still need code/runtime proof. Type zero's exact semantics remain
**[OPEN]**.

Animation decoding, negative-count model streams, and non-common placement
kinds are required before the viewer can promise every animated object.

## 7. Textures and environment

### 7.1 `.tpg` pages

**[V-ROM/V-ASM/V-TOOL]** All 124 pages share this envelope. Sixteen BE `u32`
slot descriptors occupy `+0x00..+0x40`. A shared color/palette region follows;
ordinary image payload starts at `+0x240`. `FFFFFFFF` means an unused slot.

For live descriptor `d`, the loader computes:

```text
baseTexels = (((d & 2) + 2) * 512) << (d & 1)
payload scale by (d & 12): 0 or 4 => 1/2, 8 => 1, 12 => 2
```

The low six descriptor bits also supply an offset within a 64-byte aligned
runtime allocation. Common descriptors 4/5/6/7 therefore have
512/1024/1024/2048 payload bytes, corresponding to common 4-bit page shapes
32x32, 64x32, 32x64, and 64x64. `0x80013324` emits the runtime texture-load and
tile commands.

**[OPEN]** Palette selection, exact CI/IA interpretation for each descriptor,
and uncommon format bits need direct renderer-branch mapping. Do not infer
them solely from file size or appearance.

### 7.2 Envmap and parallax resources

**[V-ROM/V-TOOL]** Every stage has `envmaps/levelNN.tpg`. All are `0xA40`
bytes except level 09 (`0x8240`, one descriptor 10 plus fifteen descriptor-7
slots).

Stages 01, 06, 07, 08, 09, 10, 11, 12, and 17 additionally have a
`parallax/levelNN.par`. Each is exactly 20,992 bytes, a raw 256x41 array of
16-bit pixels. `0x80012FAC` retains its pointer and samples pixels at byte
offsets 504 and 506 to seed backdrop/environment colors. The bit operations
fit big-endian RGBA5551/RGB555-family storage.

Implement the panorama only for those nine packages; do not synthesize one
from collision or envmap data for the other eight. **[OPEN]** Capture
comparison should determine whether the low pixel bit is alpha or ignored.

### 7.3 Runtime camera, fog, and background

**[V-RAM/V-FRAME]** Playable Training was captured at 320x240. Its viewport is
the standard `(scale,translation)=(640,480,511,0)` quarter-pixel form. The root
frame DL is `0x19D8` bytes and uses F3DLX 1.23. It contains 277 `G_VTX`, 940
`G_TRI2`, 103 `G_TRI1`, 100 nested `G_DL`, and 107 texture-image commands.

Projection at physical `0x3E5040` is 4:3, vertical FOV 75 degrees, near about
4 and far about 32768. A second projection at `0x3E50C0` keeps 75 degrees but
uses near about 200 and far about 32000, consistent with a distant/backdrop
pass. A sampled pass sets fog color `7878FF00`, fog factor `011CFFE4`, enables
`G_FOG` around nine display lists, then disables it; standard equations give
roughly near 550/far 1000.

This verifies the engine capabilities and one Training frame only.
**[OPEN]** Per-level fog colors/distances, the semantic camera eye/target
derived from split runtime matrices, and camera-follow parameters remain to be
mapped. The viewer should default to 75 degrees and offer normal free camera.

## 8. Music

### 8.1 Driver and banks

**[V-ROM/V-ASM/V-RAM/V-AUDIO]** Audio is Software Creations Nintendo 64 Sound
Tools `libmus`, song format `0x215`, running over standard Nintendo ABI1—not
MusyX. Diagnostic signatures are `N64 PtrTablesV2`, `N64 WaveTables `, BFX,
the song headers, the player routines, and the live ABI1 task tuple.

Initialization at `0x80017898` loads `tunes/sfx.bfx` and `tunes/bugs.ptr`,
then calls `MusInitialize` at `0x80079FB8` with:

| Setting | Value |
|---|---:|
| voices/channels | 24 |
| scheduler priority | 12 |
| heap | `0x20000` bytes |
| FIFO / synth updates | 64 / 256 |
| requested / actual rate | 22050 / **22047 Hz** |
| RSP commands | 2048 |
| retrace count | 1 |
| DMA buffers | 48 x 1024 bytes |
| synth FX | 2 = `AL_FX_BIGROOM` |
| song and SFX master volume | `0x3FFF` each |

Live Training used a type-2 ABI1 task and streamed a `0x400`-byte slice of
ADPCM wave 86 from ROM `0x99CD74`.

**[V-ROM/V-TOOL]** `bugs.ptr` declares 271 type-0 N64 VADPCM waves. The raw
sample bank starts at `0x8D1800` and its used range ends at `0xBAD860`
(2,998,368 bytes). There are 43 infinite sample loops. `sfx.bfx` maps 93 waves
(0–26, 205–270). Songs collectively map 173 other waves; songs may share
samples with one another, but the aggregate song set is disjoint from SFX.

### 8.2 Song storage and selector behavior

**[V-ROM]** All tune files are RNC1. Relevant archive extents are:

| File group | ROM interval | Notes |
|---|---|---|
| `sfx.bfx` | `8A4B88..8A4EF4` | 93 effects |
| `bugs.ptr` | `8A4EF8..8AE642` | decoded `BB28` |
| `bugs01..15.bin` | `8AE648..8CEFA1` | 15 level cues |
| `bugsa.bin` | `8CEFA8..8D0511` | Training |
| `bugsb.bin` | `8D0518..8D0D59` | context unresolved |
| `bugtoken.bin` | `8D0D60..8D1196` | one-shot |
| `dead.bin` | `8D1198..8D1315` | one-shot |
| `title.bin` | `8D1318..8D17CF` | title cue |

**[V-ASM]** Selector `0x80017AB0` normalizes positive inputs `>=16` by
subtracting one, while negative inputs are simply negated. Its exact mapping:

| Caller request | Stored normalized value | File |
|---|---|---|
| `+1..+15` or `-1..-15` | 1..15 | `bugs01..15` |
| `+16` | 15 | `bugs15` alias |
| `+17..+20` | 16..19 | `dead`, `bugtoken`, `title`, `bugsb` |
| `+21,+22` | 20,21 | `bugsa` |
| `-16..-19` | 16..19 | `dead`, `bugtoken`, `title`, `bugsb` |
| `-20,-21` | 20,21 | `bugsa` |

`0x80084B38` is the normalized value, not necessarily the caller's original
request. **[V-RAM]** Training retained value 21 and a relocated `bugsa.bin` at
`0x8032C000`; bytes from its offset `+0xC0` onward matched exactly. This
resolves Training. The context of `bugsb` remains **[OPEN]**.

### 8.3 Complete music-player list and loops

**[V-ROM/V-ASM/V-TOOL]** Loop samples are in the 22,047-Hz renderer domain.
All looped tracks wrap every stream; `dead` and `bugtoken` terminate.

| UI track | File | Ch./waves | Loop start | Loop length | Seconds start / length |
|---|---|---:|---:|---:|---:|
| Ant Island | `bugs01` | 12/17 | 0 | 3,382,272 | 0.000 / 153.412 |
| Council Chamber | `bugs02` | 12/16 | 5,021,786 | 3,171,614 | 227.776 / 143.857 |
| Tunnels | `bugs03` | 12/15 | 5,400,757 | 5,379,853 | 244.966 / 244.017 |
| City Entrance | `bugs04` | 12/13 | 5,100,363 | 4,050,212 | 231.340 / 183.708 |
| City Square | `bugs05` | 12/15 | 5,400,384 | 4,725,492 | 244.949 / 214.337 |
| Cliffside | `bugs06` | 12/18 | 4,487,509 | 4,627,870 | 203.543 / 209.909 |
| Clover Forest | `bugs07` | 12/18 | 5,526,105 | 4,894,679 | 250.651 / 222.011 |
| Riverbed Flight | `bugs08` | 12/23 | 5,329,641 | 4,807,700 | 241.740 / 218.066 |
| Anthill Part Two | `bugs09` | 12/17 | 5,153,938 | 4,329,132 | 233.770 / 196.359 |
| Riverbed Canyon | `bugs10` | 12/16 | 5,431,032 | 5,042,947 | 246.339 / 228.736 |
| Birdnest | `bugs11` | 12/20 | 4,121,059 | 4,926,241 | 186.922 / 223.443 |
| The Tree | `bugs12` | 12/24 | 5,098,963 | 4,281,055 | 231.277 / 194.179 |
| Battle Arena | `bugs13` | 12/18 | 5,863,679 | 4,810,269 | 265.963 / 218.182 |
| Bug Bar | `bugs14` | 12/18 | 0 | 5,258,376 | 0.000 / 238.508 |
| Canyon Showdown | `bugs15` | 12/20 | 5,163,044 | 2,708,827 | 234.184 / 122.866 |
| Death | `dead` | 8/4 | — | one-shot | end about 13.400 s |
| Token | `bugtoken` | 7/8 | — | one-shot | end about 10.470 s |
| Title | `title` | 6/10 | 0 | 224,971 | 0.000 / 10.204 |
| Unidentified context | `bugsb` | 12/11 | 2,603,065 | 2,237,599 | 118.069 / 101.492 |
| Training | `bugsa` | 12/13 | 0 | 2,722,773 | 0.000 / 123.499 |

The 1–15 names follow the exact shared internal level ID space. The UI should
list 20 unique files, not duplicate selector aliases 16 and 22.

### 8.4 Viewer renderer mapping

**[V-REPO/V-ROM/V-ASM/V-TOOL]** Reuse `parseLibmusBank` and `renderLibmusSong` from
`src/rom/music/libmus.ts` with `{ masterVolume: 0x3FFF, reverb: true }`. This
is the newer `0x215` player used by Global Assault/Gex 3, not the older
`libmus64.ts` path. Every executed audio-significant command is already
supported. The existing `AA` no-op is acceptable because every executed
change-FX value is 2, the already-active BIGROOM mode.

Decode `bugs.ptr` and the selected song with RNC1. Cache the parsed pointer and
sample bank per source ROM. A shared overload accepting separate pointer-bank
and sample-bank buffers would avoid concatenating roughly 2.91 MiB, but is not
required for the first implementation.

## 9. Mapping onto nviewer

### 9.1 Proposed module ownership

Suggested new directory:

```text
src/rom/bugslife/
  archive.ts       manifest detection, lookup, RNC1/RNC2
  level.ts         level.dat envelope, placements, assembly
  mesh.ts          custom mesh stream -> viewer geometry
  all.ts           .all containers and finite collision
  texture.ts       .tpg and .par decoding
  objects.ts       creature/object resource selection
  music.ts         tune list and libmus bank assembly
  bugslife.ts      ROM detection, game/level/music API
```

Shared-file changes should be minimized. `src/rom/index.ts` must register
`NBYE/NBYP/NBYF/NBYD/NBYI`. `types.ts` needs no speculative new contract if
meshes, collision, backdrop, and objects are emitted as ordinary instances and
layers. `music/libmus.ts` only needs an overload if avoiding the temporary
contiguous bank copy is worth shared-file churn.

### 9.2 Level assembly and layers

For a selected internal ID:

1. Locate/decode its `levelNN/level.dat`, `levelNN/terrain.all`, texture pages,
   envmap, optional parallax, `creat/creatNN.bin`, and referenced object roots.
2. Parse both placement lists and positive common meshes.
3. Decode/bind `.tpg` slots and material/render-mode groups.
4. Emit visible world geometry in a `main` layer.
5. Emit discrete creatures/props in one or more `objects` layers; unsupported
   animation/model variants should be named omissions, not malformed meshes.
6. Decode finite terrain groups into a hidden-by-default `collision` layer.
7. Emit `.par` as a `backdrop` layer only for its nine packages.
8. Default camera FOV to 75 degrees; derive a useful overview camera from
   visible bounds until per-level game cameras are mapped.

Every drawn instance must belong to a layer. There is no evidence for room or
setup variants, so do not create artificial duplicates in the level selector.

### 9.3 Difficulty and implementation order

| Piece | Difficulty | Main risk |
|---|---|---|
| Detection/manifest | low | regional absolute offsets |
| RNC1/RNC2 | medium | exact bitstream and bounds handling |
| Common visible meshes | medium | material kinds, transforms, winding |
| `.tpg` textures | medium-high | palette/format interpretation |
| Finite collision | low-medium | coordinate conversion |
| Parallax/envmap | medium | projection and pixel alpha semantics |
| Full animated objects | high | non-common streams and `.anm` |
| Music | medium | archive decode/bank assembly; synth exists |

Recommended first vertical slice: US archive -> Training common meshes ->
finite collision -> textures/parallax -> all 17 stages -> music -> animated
objects -> regional detection. Run all-level structural validation after each
parser change rather than fixing one reported stage in isolation.

### 9.4 Required verification

- `npm run typecheck`.
- `npm run check:hashes`, compared with a clean HEAD worktree for all existing
  games.
- `npm run check:transfer`.
- `npm run check:layers -- "Bug's Life"` and the global layer check.
- Load and hash every one of the 17 entries for each supported build available.
- Offline-render at least Training against `emulator/training-playable.png`,
  then choose stages covering panorama/no-panorama, dynamic collision, dense
  geometry, and uncommon texture descriptors.
- Render/audition one zero-start loop, one long-intro loop, one one-shot, and
  one high-reverb cue; verify exact PCM loop metadata.
- In-app Chromium smoke: open ROM, enumerate 17 entries, load representative
  levels, toggle every layer, switch levels repeatedly, and exercise music.

## 10. Verification evidence and limitations

### 10.1 Reproducible static artifacts

**[V-TOOL]** Primary research artifacts under `bugs_life/`:

- `parse_manifest.py` and `manifest.tsv`: independent US manifest walk.
- `fsgeom/extract_fs.py`: auto-detect/extract/decompress all five builds.
- `fsgeom/parse_level.py`: all-level level/mesh/collision structural parser.
- `fsgeom/REPORT.md`: full format evidence and regional comparison.
- `levels_hidden/RESULTS.md`: complete stage and reachability audit.
- `music/analyze.ts`, `analysis.txt`, and `NOTES.md`: banks, selectors,
  command execution, complete loop analysis, and implementation mapping.

The extractors compile and reproduce all 488 records. All 17 `level.dat`
placement envelopes and all `.all` containers reach their structural
endpoints; only the common positive-count mesh form is decoded within the
placements. The song loop
analyzer executes every channel/master stream and avoids a prior fixed-duration
probe ceiling that would miss long introductions.

### 10.2 Sole emulator session

**[V-RAM/V-FRAME]** `emulator/NOTES.md` records the one authorized session.
It reached playable Training and retained:

- `title.png` — SHA-256
  `46f61e5ea7f0b925c8ec352b95cae33f3183dbdbe1d1d1322f77738c7b85320c`;
- `training-playable.png` — SHA-256
  `d033f86c18f54d53db9f90c8de9dc10bb7393bc1a49c064a0cbed01eb870b368`;
- `rdram-training.bin` — 8 MiB, SHA-256
  `f23a57eadf9eea6ca3188225021f09c7dba17ee7d415d16d9d399b8796881fca`;
- `frame-80240000.bin` — `0x19D8` bytes, SHA-256
  `fecab3c82fce021c56673ab00b33afe186d40e43d20a9450bb4943f369051f7e`;
- `audio-task-803177a0.bin` — `0x12A8` bytes, SHA-256
  `80b4ae21d3ad14b98d8d27a4d93b4ac12de41046293045df04e2a15f64a8120c`.

The screenshot callback was asynchronous, so the retained frame DL and image
must not be described as the exact same VI. After a PI breakpoint, the session
stopped producing new frames and remained in a kernel receive/exception path;
it was stopped rather than reset or relaunched. No full level-load DMA or
additional stage was captured. The child and lead both verified that no
`mupen64plus` or `headless-*.sh` process remained.

### 10.3 Open questions

1. Decode negative-vertex-count meshes and all non-common placement kinds.
2. Resolve exact angle scaling, handedness, world scale, winding, and culling.
3. Finish `.tpg` palette/format semantics and panorama low-bit behavior.
4. Decode infinite-wall collision ID `0x0101` and name collision attributes.
5. Decode `.anm` sufficiently for animated character/object previews.
6. Map per-level fog, camera-follow, and any static light parameters.
7. Identify the runtime context of `bugsb.bin`.
8. Audition the shared renderer against captured game output during
   implementation; this investigation retained task data but no raw audio.

## 11. Unused and hidden content

### 11.1 No hidden 3-D map

**[V-ROM/V-TOOL]** The complete manifest contains no extra level directory or
additional `level.dat`/`terrain.all` pair. All 17 gameplay datasets correspond
to Training, the fifteen story stages, or Bonus. No cut 3-D map was found.

An exhaustive filename reachability audit classifies 487 of 488 records via
exact full paths, basenames inside resource descriptors, or verified filename
generators: level pairs, creature names, actor/plant stems, music numbers,
story panels, or demo paths.

### 11.2 Likely-unused result bitmap

**[V-ROM; HYPOTHESIS unused]** `level96/lose.pic` is manifest record 418,
stored at `0x790940..0x79698E` and RNC1-decoded to `0x88E8`. It is the sole
archive entry with neither an explicit pre-manifest full/basename reference nor
coverage by a known filename generator. Challenge UI explicitly names
`level96/chal.pic`, and failure text uses `Please Try Again.`; no second
`lose` string exists outside the manifest.

A numeric-index load has not been disproved, so call it **likely unused**, not
proven unreachable.

### 11.3 Unreferenced audio waves

**[V-ROM/V-TOOL]** Five valid VADPCM waves are referenced by neither any song
nor the 93-entry BFX bank:

| Wave | ROM start | Encoded bytes | Decoded samples | Loop |
|---:|---:|---:|---:|---|
| 159 | `A3E690` | `AE6` | 4,960 | 4,105..4,915 infinite |
| 181 | `A6FDF0` | `396` | 1,632 | 778..1,603 infinite |
| 193 | `A92400` | `8E86` | 64,864 | none |
| 194 | `A9B290` | `84D2` | 60,448 | none |
| 204 | `ACA770` | `1878` | 11,136 | none |

Their intended sounds cannot be named from static data alone.

### 11.4 Demo recordings and development residue

**[V-ROM; HYPOTHESIS record semantics]** `pad/path01.bin`, `path04.bin`,
`path10.bin`, and `path13.bin` decode to patterned four-byte records and are
strongly associated with shipped attract/demo paths for Ant Island, City
Entrance, Riverbed Canyon, and Battle Arena. Interpreting the two halfwords in
each record as controller input plus run duration remains unverified. The
mutable template `PAD\\PATH00.BIN` at `0x80B20` and UI text `DEMO` corroborate
their normal shipped use. They are not cut levels.

The executable retains the authoring path
`D:\\BUGS\\N64\\CD\\PAD\\PATH00.BIN` at `0x80B30`, plus dormant generic
loader basenames `level1.dat`, `level2.dat`, and `level3.dat`; the archive has
no matching split-level payloads.

**[V-ROM negative audit]** No `DEBUG`, `ASSERT`, warp, test-map,
collision-view, or free-camera label was found. `MOVING CAMERA` and
`STILL CAMERA` are normal pause-menu options, not evidence of a debugger.
