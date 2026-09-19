# Vigilante 8: 2nd Offense — Nintendo 64 ROM format specification

This manual describes the United States revision-0 ROM. Its archive, level
container, and sequence player are verified from ROM bytes and disassembly;
unresolved rendering and gameplay behavior is identified explicitly.

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | Named, six-group ROM directory with 167 indexed files. |
| Compression | Vigilante LZSS in 98 indexed files; see [shared codec](compression/vigilante-lzss.md). |
| Graphics microcode | `RSP Gfx ucode F3DEX fifo 2.08` (embedded identification string). |
| Geometry | `FORM/TERR` level file; two `FORM/XOBF` model banks with F3DEX2 display lists and 16-byte N64 vertices. |
| Textures | 16 JPEG preview strips per arena; indexed RGBA5551-palette sky/terrain images; XOBF CI4, CI8, RGBA16, RGBA32, and 8-bit intensity/alpha-class images. |
| Collision | `ZMAP` selects 64×64 `ZONE` height tiles; queries use 16.16 horizontal coordinates, 1/32-unit heights, and a fixed two-triangle cell split. |
| Music driver | libmus-compatible `0x215` multichannel sequencer with counted and infinite repeats. |
| Audio microcode | **Unknown**. |
| Sample encoding | Nintendo 9-byte-frame VADPCM for the 86-entry music bank; the separate Luxo effects bank is not used by music wave maps. |
| Levels | Eight indexed arena DLL/EXP pairs. |
| Memory requirement | **Unknown**; audio setup has separate copied-bank and cartridge-bank paths. |
| Viewer support | USA revision 0: eight textured terrain surfaces, authored static and initial-state dynamic object placements, panoramas, hidden terrain-collision layers, and 36 music entries. |

### 1.2 ROM identification

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| USA | `V8: SECOND OFFENSE` | `NVGE` | 0 | 12 MiB (`0xC00000`) | `F5C5866D` | `052713D9` | `9634247ca456c82a65bb33f552db036ba6f33f79` | **Unknown** | — |

Verified from the normalized ROM header and a whole-file SHA-1 digest. Other
releases were not audited.

### 1.3 Terminology and conventions

Ranges are half-open. Offsets and sizes are hexadecimal unless otherwise
stated. Multibyte fields are big-endian except the LZSS decoded-size word and
match token. `EXP` denotes a level/resource archive; `DLL` denotes a
level-specific executable overlay. A path in the directory is not evidence
that the game selects or executes that asset.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

The header entry point is `0x80125800`. ROM `0x1000` corresponds to that
address, establishing the resident-image mapping in the next section.
Resident code, strings, archive-directory metadata, audio metadata, and RSP
microcode occupy the region before the large wavetable resource. The F3DEX
identification string is at ROM `0x71708`. Eight arena `DLL` files are separately
compressed executable overlays; their exact runtime relocation contract is
not established. Verified from ROM bytes; overlay execution remains to be
traced.

### 2.2 Memory and address mapping

Resident addresses examined here map by `VRAM = ROM + 0x80124800`; for example,
the directory at ROM `0x70840` has resident address `0x80195040`. Indexed
file addresses use `0xB0000000 + ROM offset` and must not be interpreted as
resident-image VRAM.

### 2.3 ROM map and asset organization

| ROM range | Stored size | Decoded size | Destination | Compression | Contents |
|---|---:|---:|---|---|---|
| `[0x000000,0x001000)` | `0x1000` | — | boot | none | N64 header and IPL boot code. |
| `[0x001000,0x070800)` | `0x6F800` | — | resident address mapping | mixed | Code and linked data; exact code/data boundary unknown. |
| `[0x070800,0x0715C4)` | `0xDC4` | — | resident address mapping | none | Archive header and six directory groups. |
| `[0x0715C4,0x0737C0)` | `0x21FC` | — | resident address mapping | none | Linked data including F3DEX identification/microcode region. |
| `[0x0737C0,0x2A3AAC)` | `0x2302EC` | — | RDRAM or cartridge access | mixed | Two audio wavetable bases and pointer-table-controlled sample region. |
| `[0x2A3AB0,0xB9CEEE)` | `0x8F943E` | file dependent | heap/overlay | mixed | 167 named files, aligned individually to four bytes. |
| `[0xB9CEEE,0xC00000)` | `0x63112` | — | — | none | `0xFF` ROM padding. |

The six groups and file counts, verified by following the on-ROM directory
records, are `ROOT` 3, `LEVELS` 16, `SHARED` 26, `MUSIC` 36, `SHELL` 21, and
`SLIDES` 65. The 167 file extents do not overlap; only 0–3 alignment bytes
separate adjacent files, totaling 250 bytes. The final indexed byte is at
`0xB9CEED`.

A file record has a 20-byte stride:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 12 | char[12] | `name` | Space-padded ASCII basename, including extension. |
| `0x0C` | 4 | u32 | `cartAddress` | `0xB0000000 + ROM offset`. |
| `0x10` | 4 | u32 | `storedSize` | Excludes up to three following alignment bytes. |

A directory-group record is also 20 bytes, immediately followed by its file
records. Its pointer semantics beyond locating linked groups are not fully
established:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 8 | char[8] | `groupName` | Space-padded ASCII; blank for the root group. |
| `0x08` | 4 | u32 | `link_08` | Resident pointer or zero. |
| `0x0C` | 4 | u32 | `link_0C` | Resident pointer or zero. |
| `0x10` | 4 | u32 | `fileCount` | Number of immediately following 20-byte file records. |

The group records begin at ROM `0x70840`, `0x70890`, `0x709E4`, `0x70C00`,
`0x70EE4`, and `0x7109C`. Verified from ROM bytes.

### 2.4 Compression formats

The 98 compressed files use the same [Vigilante LZSS](compression/vigilante-lzss.md)
bitstream as the first Vigilante 8. The game-specific index stores the whole
container size and provides no separate decoded-size field.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | char[4] | `magic` | ASCII `LZSS`. |
| `0x04` | 4 | u32 LE | `decodedSize` | Exact decoded byte count. |
| `0x08` | Variable | u8[] | `tokenStream` | MSB-first flag groups and 2 KiB-ring LZSS tokens. |

All 98 indexed streams independently decoded to their declared byte counts
and consumed exactly their indexed extents. The complete corpus contains
12,666,848 decoded bytes and 8,213,749 retail container bytes. The shared
reference encoder at depth 64 round-trips the corpus into 8,056,788 bytes.
For the largest stream, `SHARED/COMMON.EXP`, 1,924,786 decoded bytes repack
from 952,079 retail bytes to 916,990 bytes at depth 2048 in 2.013 seconds.
That is below the agreed limit of two seconds per 10 KiB of output. These are
compatibility measurements, not part of the bitstream definition.

### 2.5 Loading process

The directory provides named path lookup into file records; the retail
lookup algorithm and case behavior have not been reconstructed. Startup
code chooses two audio pointer-table banks and addresses a shared raw
wavetable region. The shell overlay contains explicit paths for all eight
arena `EXP` files. The eight matching `DLL`/`EXP` pairs strongly suggest an
overlay/asset pair per selected arena; the order of their runtime loading
remains unverified.

### 2.6 Revision differences

Only USA revision 0 was examined. No other-region offsets or format
compatibility are asserted.

## 3. Level data

### 3.1 Level catalog and identifiers

Each arena title and description below comes from the decoded `TITL` and
`TEXT` chunks of its own indexed `EXP`. Counts describe decoded assets, not
runtime-selectable modes. Verified from ROM bytes and complete LZSS decoding.

| ID | Directory basename | `TITL` | `EXP` ROM start | Packed → decoded | `FORM/OBJ` placements | `ZONE` chunks |
|---:|---|---|---:|---:|---:|---:|
| 0 | HARBOR | Pacific Harbor | `0x2AC4B0` | `0x9A8E2` → `0xD5BFA` | 217 | 6 |
| 1 | STEELMIL | Steel Mill | `0x349EE8` | `0xAA0EB` → `0xE108C` | 177 | 6 |
| 2 | BAYOU | Ghastly Bayou | `0x3F61F4` | `0x97527` → `0xC6FBA` | 255 | 6 |
| 3 | OLYMPIC | Winter Games | `0x48FEBC` | `0xA249E` → `0xD3640` | 207 | 9 |
| 4 | NUCLEAR | Nuclear Plant | `0x5345C0` | `0x97BD5` → `0xD7252` | 242 | 6 |
| 5 | LAUNCH | Launch Site | `0x5CFFA0` | `0x9946E` → `0xD9202` | 233 | 6 |
| 6 | ROUTE66 | Meteor Crater | `0x66CB00` | `0xA71A1` → `0xDBE50` | 226 | 6 |
| 7 | OILFIELD | Alaskan Pipeline | `0x715B50` | `0x914B0` → `0xBDC6C` | 190 | 6 |

The matching `DLL` files are indexed immediately before each `EXP`, with
respective stored and decoded sizes `0x2268→0x3608`, `0x3152→0x48E0`,
`0x221E→0x3150`, `0x279E→0x42E8`, `0x2264→0x3294`, `0x3E06→0x5924`,
`0x36EE→0x5290`, and `0x1EAC→0x2AA0`. No ninth arena pair is indexed.

### 3.2 Level container

Every decoded arena `EXP` is an IFF-like `FORM/TERR`. Its root length equals
the decoded file size minus eight. Child chunks have the following envelope;
an odd payload is followed by one alignment byte outside the stored length:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | char[4] | `tag` | `FORM` at root, otherwise a four-character chunk type. |
| `0x04` | 4 | u32 | `payloadSize` | Excludes the eight-byte envelope and even-alignment pad. |
| `0x08` | `payloadSize` | u8[] | `payload` | For `FORM`, begins with a four-character form type. |
| Following | 0–1 | u8 | `pad` | Present when `payloadSize` is odd. |

The eight files all parse to their exact root end with no trailing child
bytes. Every file has `TITL`, `TEXT`, 16 `XLSC`, `HEAD`, `XBGM`, `SUNA`,
`COLS`, `XBMP`, `XTIN`, one `ZMAP`, two `FORM/XOBF`, one `AIMP`, and
placement/route chunks. `ZONE` count varies as in the catalog. Optional
chunks include `RECT`, `XWAT`, and extra `XRTP`. Verified by an exhaustive
chunk walk of all eight decoded files.

### 3.3 Geometry

The two `FORM/XOBF` banks contain a `BIN ` child. Its 28-byte header has
three count/relative-offset pairs, then a fixed-record count. The scene-node
array begins immediately at `+0x1C`. Fifteen banks have four padding bytes
between the array and the first indexed section; OILFIELD's first bank omits
that pad. Loaders must therefore honor the stored section offset.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | u32 | `section0Count` | Number of first-section records. |
| `0x04` | 4 | u32 | `section0Offset` | Relative to start of `BIN ` payload. |
| `0x08` | 4 | u32 | `section1Count` | Number of second-section records. |
| `0x0C` | 4 | u32 | `section1Offset` | Relative to start of `BIN ` payload. |
| `0x10` | 4 | u32 | `section2Count` | Number of third-section records. |
| `0x14` | 4 | u32 | `section2Offset` | Relative to start of `BIN ` payload. |
| `0x18` | 4 | u32 | `fixedRecordCount` | Number of following 28-byte records. |
| `0x1C` | `28 × fixedRecordCount` | u8[][28] | `sceneNodes` | Hierarchical model instances. |

The 28-byte records form forward-linked model graphs. They are not arena-world
placement records: the separately named `FORM/OBJ ` records select one graph
root and supply its world pose. Position within an XOBF graph is signed 24.8
fixed-point; the model coordinate shift described below scales the complete
local frame by another 1/256, making the effective world translation
`raw / 65536`. Each
orientation component is a 12-bit turn, where
`0x1000` is one revolution. Resident routine `0x8013B930` converts the three
components into the node's local 3×3 matrix, and the scene traversal composes
that local transform with its parent's transform. Resident spatial routine
`0x80144754` subtracts these translations and shifts right by eight, proving
the fractional width. The low 11 bits of the
first word select a first-section model; `0x7FF` means no model. Constructor
`0x80141C30` maps source bit 11 to runtime flag `0x10`. Recursive constructor
`0x80141E44` reads the word as signed: a negative node is not instantiated and
its child subtree is skipped, but traversal continues at its sibling. This is
essential scene selection, not optional visibility culling. Verified from
decoded records and resident disassembly.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | u16 | `modelAndFlags` | Low 11 bits are the first-section model index (`0x7FF` = none); bit 11 maps to runtime flag `0x10`; bit 15 disables this node and child subtree. Other flag bits are not named. |
| `0x02` | 2 | s16 | `shapeIndex` | Middle-section record index, or `-1`. |
| `0x04` | 4 | s32 | `translateX` | Signed 24.8 local translation. |
| `0x08` | 4 | s32 | `translateY` | Signed 24.8 local translation. |
| `0x0C` | 4 | s32 | `translateZ` | Signed 24.8 local translation. |
| `0x10` | 2 | u16 | `angleA` | Low 12 bits are a turn fraction. |
| `0x12` | 2 | u16 | `angleB` | Low 12 bits are a turn fraction. |
| `0x14` | 2 | u16 | `angleC` | Low 12 bits are a turn fraction. |
| `0x16` | 2 | u16 | `unknown_16` | Copied to the runtime node; role unresolved. |
| `0x18` | 2 | u16 | `nextSibling` | Forward record index, or `0xFFFF`. |
| `0x1A` | 2 | u16 | `firstChild` | Forward record index, or `0xFFFF`. |

The first section has a `u32` relative-offset array followed by variable
model records. Its offsets resolve within the section. A model record begins:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | u32 | `vertexCount` | Number of N64-format vertices. |
| `0x04` | 4 | u32 | `vertexDataOffset` | Relative to model start. |
| `0x08` | 4 | u32 | `displayListOffset` | Relative to model start. |
| `0x0C` | 4 | u32 | `unknown_0C` | Meaning not established. |
| `0x10` | 4 | u32 | `unknown_10` | Meaning not established. |
| `0x14` | 1 | u8 | `coordinateShift` | Binary shift applied when the renderer builds the RSP matrix; 8 in every arena model, giving 1/256-scale local vertices and node translations. |
| `0x15` | 1 | u8 | `unknown_15` | Meaning not established. |
| `0x16` | 2 | u16 | `radius` | Model extent used by runtime spatial tests. |
| `vertexDataOffset` | `16 × vertexCount` | u8[][16] | `vertices` | Standard N64 vertex records. |

The first HARBOR model has 245 vertices, vertex offset `0x598`, and display
list offset `0x18`; `0x598 + 245 × 16 = 0x14E8`, exactly its span to the next
model. Its display list begins with F3DEX2 render-state commands. The third
XOBF section is a texture-offset array and image records, detailed below.
The middle section is a `count + 1` relative-offset array of shape-like
records. Among 1,558 records across the sequel's 16 XOBF banks, 1,514 begin
with kind `1`, and 1,379 of those have a 32-byte span containing six signed
32-bit values consistent with minimum and maximum XYZ bounds. The remaining
44 begin with kind `2`; their nested shape grammar is not established.
Whether the section is used for collision, culling, or both is not yet proved.
Verified from decoded ROM bytes and the model-node construction, transform and
spatial routines in the resident executable. Directly treating every XOBF root
as an arena instance is disproved by coordinates and by the constructor path.
The level loader instead selects one bank/root pair from each `FORM/OBJ `
record, as detailed under *Placement records*. HARBOR's terrain and all 217 placements occupy
approximately X `832–958`, Z `1216–1406`; the selected, scaled assemblies fit
those bounds without the unrelated-root pile-up produced by whole-bank drawing.

### 3.4 Display lists and render state

The embedded RSP string identifies F3DEX fifo 2.08. XOBF model records
contain direct F3DEX2 command streams, including `E7` pipe sync, `E2` render
state, `01` vertex loads, and `05`/`06` triangle commands. The arena renderer
enters these lists with `G_LIGHTING` enabled; none of 171 HARBOR or 117
OILFIELD models enables lighting before its first vertex load, while later
`D9` commands explicitly clear or set it. The vertex RGB bytes at lit loads
are therefore signed normals, not authored colours. The lists also supply
their own combiner, depth, alpha and decal transitions. Do not assume
display-list bytes are generic F3D or a custom triangle-list format.

### 3.5 Textures and materials

Each `XLSC` payload starts with four non-JPEG bytes followed by a baseline
JFIF JPEG; HARBOR's first image independently identifies as 320×96. All
eight arenas have 16 such chunks. These are menu-preview strips, not a
substitute for 3D materials.

`XBMP` begins with the common eight-byte texture header, followed by a
512-byte big-endian RGBA5551 palette and a 320×128 8-bit-index bitmap.
It is the visible terrain atlas, arranged as 32×32-texel tiles (ten columns
by four rows).
`XBGM` has a four-byte prefix before that same header: the header begins at
payload `+4`, its palette begins at `+12`, and its bitmap is 256×92. Raw
HARBOR and OILFIELD payloads contain `0x0201`, 256 palette entries, and
256×92 dimensions in the header at `+4`. [evidence: ROM bytes]

The third XOBF section begins with a relative-offset table. Its final two
offsets coincide, so `section2Count − 1` actual image records occur. Across
both banks in all eight arenas, 1,098 image records obey the following exact
size rule with no exceptions: `align8(8 + 2 × paletteEntries) + height ×
align8(ceil(width × bitsPerPixel / 8))`. Rows are padded separately. The
header fields are big-endian:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | u16 | `format` | Pixel format/flags below. |
| `0x02` | 2 | u16 | `paletteEntries` | RGBA5551 entries before pixels. |
| `0x04` | 2 | u16 | `width` | Texels per row. |
| `0x06` | 2 | u16 | `height` | Number of rows. |
| `0x08` | `2 × paletteEntries` | u16[] | `palette` | Big-endian RGBA5551 entries. |
| Following | Variable | u8[] | `pixels` | Begins at an eight-byte-aligned offset; each row is independently aligned to eight bytes. |

| `format` | Bits/pixel | Interpretation | Evidence |
|---|---:|---|---|
| `0x2200` | 4 | CI4 | Palette count, exact size, and N64 texture commands. |
| `0x2201` | 8 | CI8 | Palette count and exact size. |
| `0x2002` | 16 | RGBA16 | Exact size; texture state still to confirm. |
| `0x2003` | 32 | RGBA32 | Exact size; texture state still to confirm. |
| `0x2401` | 8 | Intensity/alpha-class, exact mode **unknown** | No palette; exact size. |

The format IDs differ in high bits from those observed in the original
Vigilante 8, although record-size grammar is shared. Segment 1 display-list
addresses resolve against the current model's vertex array; segment 2
texture-image addresses resolve against the first image record, excluding
the offset table. This address interpretation is verified on the first
models.

`XTIN` is the terrain-material table. Its `0x2400`-byte payload contains 256
records of 36 bytes. The sequel loader at overlay-relative `0x6238` converts
each record to its 24-byte runtime form; this is distinct from the original
game's 40-byte source record.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | u16 | `flags` | Bit 4 suppresses terrain triangles for this material. |
| `0x02` | 1 | u8 | `atlasTile` | Low nibble is the 32-texel atlas column; high nibble is the row. |
| `0x03` | 1 | u8 | `orientationAndFlags` | Low three bits select a UV orientation; bit 3 selects the triangle diagonal; bit 4 maps to another runtime flag. |
| `0x04` | 12 | u16[6] | `renderState` | Copied to the runtime material; individual fields are not named. |
| `0x10` | 20 | u8[20] | `unusedByTerrainLoader` | Not read by the verified visual-terrain conversion. |

The resident orientation table supplies four atlas-local corner coordinates
`A`, `B`, `C`, and `D`; values are texels within a 32×32 tile:

| Orientation | A | B | C | D |
|---:|---|---|---|---|
| 0 | `(0,31)` | `(31,31)` | `(0,0)` | `(31,0)` |
| 1 | `(31,31)` | `(0,31)` | `(31,0)` | `(0,0)` |
| 2 | `(0,0)` | `(0,31)` | `(31,0)` | `(31,31)` |
| 3 | `(0,31)` | `(0,0)` | `(31,31)` | `(31,0)` |
| 4 | `(31,0)` | `(0,0)` | `(31,31)` | `(0,31)` |
| 5 | `(0,0)` | `(31,0)` | `(0,31)` | `(31,31)` |
| 6 | `(31,31)` | `(31,0)` | `(0,31)` | `(0,0)` |
| 7 | `(31,0)` | `(31,31)` | `(0,0)` | `(0,31)` |

The emitted S/T value is `(tileOrigin + corner − 0.5)` texels. With diagonal
bit 3 clear, a terrain quad emits `(A,B,C)` and `(D,C,B)`; when set it emits
`(A,B,D)` and `(D,C,A)`. The visible renderer samples the height field every
two world units, whereas collision retains every one-unit sample.

`COLS` supplies the terrain vertex-colour ramp. The renderer makes 32 opaque
colours by linearly interpolating RGB from `COLS + 0x0C` to `COLS + 0x10`,
using integer truncation. The source ZONE record's upper five colour bits
select this ramp. Actual XOBF light colours and directions remain to be
established from `SUNA` or runtime state.

### 3.6 Collision

Every arena has a `ZMAP` chunk of `0x800` bytes and 6–9 `ZONE` chunks of
`0x4000` bytes each. `ZMAP` is a row-major 32×32 array of big-endian zone
IDs, indexed as `zmap[tileZ][tileX]`; zero selects the shared default zone
and IDs 1–N select `ZONE` chunks in file order. A tile covers 64×64 samples.
Verified by the stage-overlay loader at relative address `0x6568`, which
builds the resident pointer grid at `0x801C27B8` with an X stride of `0x80`
bytes and a Z stride of four bytes.

A source `ZONE` is a 64×64 array of the following four-byte records in
`sample[localX][localZ]` order:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | u16 | `biasedHeight` | Runtime height bits are `(biasedHeight − 0x200) & 0x7FF`. |
| `0x02` | 1 | u8 | `colourBits` | Top five bits become runtime height-word bits 11–15 and index the `COLS` ramp; low three bits are ignored by the unpacker. |
| `0x03` | 1 | u8 | `material` | Copied to the parallel runtime attribute plane and selects an `XTIN` record for rendering. |

The stage-overlay unpacker at relative address `0x6470` expands each source
record into a 64×64 `u16` height/material plane followed by a 64×64 `u8`
attribute plane. Resident height query `0x80133204` accepts X and Z in 16.16
fixed-point and returns `(runtimeWord & 0x7FF) / 32` in 16.16 form. It
interpolates each cell across the anti-diagonal from `(x+1,z)` to `(x,z+1)`,
giving triangles `(00,10,01)` and `(11,01,10)`. These facts are verified by
sequel disassembly and decoded arena bytes; they do not rely on first-game
inference.

The source material byte selects the visual `XTIN` record; its additional
gameplay/physics meaning is not named here. Each arena also contains one `BSP ` chunk plus
`JUNC` and `RSEG` route records. Those structures may provide object or route
collision beyond the verified terrain height field, but their roles remain
unresolved.

### 3.7 Environment, sky, fog, and lighting

`XBGM` contains the indexed sky image. `COLS` supplies the verified terrain
colour ramp described above. `SUNA` is plausibly a sun/light record from its
tag and fixed `0x10`-byte size, but its semantics remain a **hypothesis**.
Fog controls, XOBF light direction/intensity, horizon mapping, and animation
have not been validated in a trustworthy in-game frame. The `HEAD` chunk is
`0x1A` bytes in HARBOR, but its field meanings remain unknown.

### 3.8 Cameras and paths

`JUNC`, `RSEG`, `XRTP`, and optional `RECT` chunks provide road/route-like
data. Their names and repetition are verified, but coordinate fields and
camera behavior remain untyped. No reliable in-game arena frame was captured
in this investigation; camera parameters cannot yet be corroborated against
runtime behavior.

## 4. Objects

### 4.1 Placement records

Each top-level `FORM/OBJ ` represents one placement and contains a `HEAD`
child, sometimes followed by `BSPI`. HARBOR's 217 placements include named
props and pickups such as `Railing`, `Container_1`, `Q_SupplyBox`, and
`I_RocktL`; eight records per arena bear `Placeholder`. The latter is a
runtime descriptor name, not by itself proof of debug-only content.

The `HEAD` payload starts with a 34-byte fixed prefix followed by a raw
ASCII name of `payloadSize − 34` bytes. Names are not NUL-terminated inside
the payload; an odd-size IFF pad often provides a following zero byte. The
three signed 32-bit coordinate values are 16.16 fixed-point. The loader
subtracts `0x00100000` (16 world units) from source Y before constructing the
object. Comparing the resulting poses with occupied ZMAP tiles establishes
the X, Y, Z order shown below.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 1 | u8 | `unknown_00` | Copied by the loader; role unresolved. |
| `0x01` | 1 | u8 | `constructionType` | Selects one of seven resident object-construction paths (`0–6`). |
| `0x02` | 2 | u16 | `objectId` | Runtime object/link identifier; `0xFFFF` is common. |
| `0x04` | 4 | u32 | `flags` | Runtime behavior/render flags; individual bits are not fully named. |
| `0x08` | 4 | s32 | `positionX` | Signed 16.16 runtime X coordinate. |
| `0x0C` | 4 | s32 | `positionY` | Signed 16.16 source Y; runtime Y is this value minus `0x00100000`. |
| `0x10` | 4 | s32 | `positionZ` | Signed 16.16 runtime Z coordinate. |
| `0x14` | 6 | u16[3] | `angles` | Three 12-bit turn fractions; `0x1000` is one revolution. |
| `0x1A` | 2 | s16 | `xobfBank` | `0` or `1` selects the arena's first or second XOBF; `-1` constructs no XOBF model. |
| `0x1C` | 2 | u16 | `xobfRoot` | Node index at which construction begins. |
| `0x1E` | 4 | u32 | `unknown_1E` | Additional constructor value; complete semantics unresolved. |
| `0x22` | Variable | char[] | `name` | Raw ASCII, length is `payloadSize − 0x22`. |

The exact binding path is verified in the decoded `LOAD.DLL` overlay. Its OBJ
parser at relative `0x1C2C` adds 44 to `xobfBank` and indexes the loaded-resource
table at `0x8020EE00`. It resolves `name` first through the level DLL's class
registry and then through the resident fallback registry. Resident constructor
`0x80148254` passes the selected XOBF and `xobfRoot` to graph constructor
`0x80141E44`.

Construction instantiates only the selected root, not its root-level sibling.
It recursively instantiates the root's child list and follows sibling links
within that list. A node whose first word is negative is skipped together with
its children, while traversal continues with its sibling. This reproduces the
retail selection of multi-part assemblies and conditional alternatives.

### 4.2 Object and model formats

Placed objects refer directly to the two arena XOBF model banks as described
above; shared `SHARED/COMMON.EXP`,
`ARMS.EXP`, and `HOTRODS.EXP` provide further compressed resources. The
second XOBF bank is byte-identical across seven arenas; ROUTE66 differs.
This establishes deliberate sharing. Arena placement coordinates line up with
the occupied ZMAP tiles and terrain heights—for example, HARBOR's source
`Lighthouse` pose is `(850.03,44.41,1246.98)` and selects bank 0/root 10.
The optional `BSPI` linkage remains unknown.

Construction types 4 and 5 take explicitly behavior-oriented resident paths.
Type 4 covers moving machinery or vehicles such as `CraneSmall`, `Barge`,
`CargoTruck`, trains, `ForkLift`, `LaunchVehicle`, and `Orca`. Type 5 covers
pickups, quest items, destructibles and triggered models such as `I_RocktL`,
`Q_SupplyBox`, `Q_Bomb`, `Glacier`, and `Meteor_small`; it invokes the resolved
class callback during construction. Type 6 `LightModel` records have bank
`-1` and construct lighting helpers without XOBF geometry. These classes are
genuinely runtime-controlled; a static viewer can show only their authored
initial pose. Type 0 contains most buildings and props, although individual
type-0 classes can still be destructible or scripted.
### 4.3 Skeletons and animation

Vehicle DLLs and XOBF resources exist in `SHARED`; skeletal and animation
records were not decoded. Static level meshes do not establish whether a
named object animates at runtime.

### 4.4 Behaviors, triggers, and scripted objects

Each stage has a `DLL` overlay, consistent with level-specific behavior.
The LAUNCH overlay includes the string `TestThruster`; it appears alongside
ordinary object identifiers such as `NASA`, `WindTunnel`, and `GuardTower`.
Its reachability and meaning are unverified. `QUEST.BIN` is a separately
indexed compressed root file, likely quest metadata by name only; its
behavior schema has not been reconstructed.

## 5. Audio

### 5.1 Audio storage and banks

The `MUSIC` group holds 36 LZSS-compressed sequence files at
`[0x97208C,0x9873D3)`. Two ROM-resident control banks share the raw
wavetable allocation `[0x737C0,0x2A3AAC)`. Startup disassembly verifies
these pairings:

| Bank | Metadata ROM | Signature | Entries | Wave base ROM |
|---:|---:|---|---:|---:|
| 0 | `0x592C0` | `N64 PtrTablesV2` | 86 | `0x737C0` |
| 1 | `0x5CEF0` | `Luxo-PtrTablesV2` | 238 | `0x15E0E0` |

The two bank counts total 324 sound records. All 36 music sequences map only
wave IDs `0–85` (82 distinct IDs), so they use the 86-entry N64 bank, not
the 238-entry Luxo bank. All 86 music wave records are type 0, have predictor
books, and address Nintendo 9-byte-frame VADPCM data from ROM `0x737D0`
through `0x14E0DD`; 17 have loop records. [evidence: ROM bank and sequence
bytes]

Setup at resident
`0x80137320–0x80137478` selects the bases and the bank parser at
`0x8016C500` relocates sample pointers. The boot literal
`Shared\Sounds.SND` points to a stub returning zero, so the absence of
that file from the directory is not evidence of missing audio data.

### 5.2 Sequence format and driver

All 36 music files independently decode and consume exactly their indexed
LZSS lengths. Each decoded sequence uses the libmus-compatible `0x215`
header. The fields match the repository's shared libmus parser. [evidence:
all 36 decoded headers, resident opcode table]

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | u32 | `version` | `0x00000215` in all 36 songs. |
| `0x04` | 4 | u32 | `channelCount` | 16 in `THEME.BIN`; 13 in `E_VIG.BIN`. |
| `0x08` | 4 | u32 | `waveMapCount` | Number of song-local wave IDs. |
| `0x0C` | 4 | u32 | `eventTableOffset` | BE32 per-channel event-stream offsets. |
| `0x10` | 4 | u32 | `volumeTableOffset` | Optional volume-stream offsets. |
| `0x14` | 4 | u32 | `bendTableOffset` | Optional pitch-bend stream offsets. |
| `0x18` | 4 | u32 | `envelopeTableOffset` | Envelope definitions. |
| `0x1C` | 4 | u32 | `drumTableOffset` | Drum definitions. |
| `0x20` | 4 | u32 | `waveMapOffset` | BE16 song-local to bank-wave IDs. |
| `0x24` | 4 | u32 | `masterTrackOffset` | Master/tempo events. |
| `0x28` | 4 | u32 | `relocationFlag` | Zero in on-ROM files; set by loader after rebasing. |

The resident event interpreter at `0x8016A624` has a 45-entry table at ROM
`0x71CB0`, covering every opcode `0x80–0xAC` recognized by the shared
libmus renderer. Opcode `0x80` ends a channel. `0x95` opens a counted loop;
`0x96` repeats it, and count `0xFF` repeats indefinitely. Game-specific
mixer settings remain unmeasured; bytecode compatibility does not establish
sample-for-sample playback fidelity.

### 5.3 Instruments and sample encoding

The music control bank at `0x592C0` is `N64 PtrTablesV2`: header `+0x20`
gives 86 wave records, `+0x24` and `+0x28` locate base-note and detune arrays,
and `+0x2C` locates the wave-offset list. These match the shared
`parseLibmusBank` contract. All 86 music records have predictor books and
refer to Nintendo 9-byte-frame VADPCM spans; exact game-side master volume,
reverb and output resampling remain **Unknown**. [evidence: ROM control bank,
sequence wave maps]

### 5.4 Music catalog and loop points

The executable's 11-element filename/title pointer tables at ROM `0x6AD00`
establish IDs 0–10. Each base name also has `D_` and `V_` files. The
result-screen caller selects these prefixes; their interpretation as defeat
and victory is an inference from the caller context. Every base song has one
`0x95 0xFF` infinite-repeat marker per channel. Of the result cues,
`D_`/`V_` CONVOY and TORQUE have such markers; the others do not.

| ID | File stem | Display title | Base | `D_` | `V_` |
|---:|---|---|---|---|---|
| 0 | THEME | V8 Theme | infinite repeat | no marker | no marker |
| 1 | BOOGIE | Boogie Fever | infinite repeat | no marker | no marker |
| 2 | NINA | OK to be Loco | infinite repeat | no marker | no marker |
| 3 | SHEILA | Rollerqueen | infinite repeat | no marker | no marker |
| 4 | CONVOY | Convoy Country | infinite repeat | infinite repeat | infinite repeat |
| 5 | TORQUE | Gimme Mo' Torque | infinite repeat | infinite repeat | infinite repeat |
| 6 | CHASSY | Chassey's Chase | infinite repeat | no marker | no marker |
| 7 | FAST | Go Team FAST | infinite repeat | no marker | no marker |
| 8 | CLYDE | Obsession in D- | infinite repeat | no marker | no marker |
| 9 | ASTRO | Stargazers | infinite repeat | no marker | no marker |
| 10 | CYBORG | Future Two | infinite repeat | no marker | no marker |

Three further indexed files are `E_VIG.BIN`, `E_COY.BIN`, and `E_DRF.BIN`.
Only `E_DRF` has infinite-repeat markers (14, one per channel); the
normal-play reachability of these ending cues is not established.

## 6. Unused and hidden content

### 6.1 Unreferenced assets

No indexed arena or song is proved unused. The decoded shell explicitly
references all eight arena `EXP` paths and all 65 indexed slideshow JPEGs.
Two shell literals, `Music\logo.bin` and `Shell\Sounds.SND`, have no
matching directory records; the boot also names absent
`Shared\Sounds.SND`, whose loader call is stubbed. These are dangling or
optional *references*, not evidence of missing playable content. The two
256-byte root files `DEMO0.APD` and `DEMO1.APD` are byte-identical, although
the executable contains demo-mode text. That duplication does not establish
two distinct demo scenes.

### 6.2 Cut or inaccessible levels

There is no ninth named level pair in the directory and no shell path to one.
The eight `EXP` files have distinct `TITL` labels. An unindexed or
code-generated level has not been disproved; no such candidate was verified
by this audit.

### 6.3 Debug features

The executable contains `CHEATS ENABLED` and exception-diagnostic strings;
the shell exposes Arcade, Quest, Survival, and multiplayer labels, but no
`DEBUG` or `EDITOR` menu label was found. `LOAD.DLL` contains `NO SUCH QUEST
PLACEHOLDER!`, and the LAUNCH overlay names `TestThruster`. These are
ROM-byte leftovers/leads, not verified accessible debug controls. Emulator
rendering did not produce a trustworthy menu or arena frame, so gameplay
reachability is **unknown**.

### 6.4 Prototype or revision-specific content

No prototype or other regional revision was analyzed. The `TERR` chunk
container and level-title list are specific to this USA image. No asset is
classified as cut solely because its name sounds developmental.

## 7. nviewer implementation

### 7.1 Module mapping

`src/rom/vigilante8_2/fs.ts` reads the six-group directory and reuses the
first game's LZSS decoder. `level.ts` walks `FORM/TERR`, decodes XOBF assets,
the XBMP/XTIN/COLS visible terrain, full-resolution ZMAP/ZONE collision, and
`XBGM` as a panoramic sky. It follows the retail `FORM/OBJ` bank/root binding,
node-selection rules, local transforms and world poses to assemble buildings,
props, pickups and initial-state dynamic objects.
`vigilante8_2.ts` exposes the eight arenas; `music.ts` adapts all 36 indexed
sequences to the shared libmus renderer.

### 7.2 Supported features

The viewer accepts `NVGE` revision 0 and lists all eight indexed arenas.
It builds a visible terrain layer from ZMAP/ZONE, XBMP, XTIN, and COLS, a
static-object layer, a separately toggleable dynamic-object layer, a hidden
full-resolution collision layer, and 36 `MUSIC` cues.

### 7.3 Approximations and omissions

The starting camera and cylindrical sky projection are viewer approximations.
The visible terrain reproduces the verified static height/material surface;
`BSP ` structures, runtime object motion/state changes, animations, scripts,
fog and routes are omitted. The music
player uses neutral dry mixer settings because game-specific volume/reverb
have not been measured. The JPEG preview strips are not used as in-game
materials.

## 8. Verification and remaining work

### 8.1 Verification evidence

| Claim | Verification |
|---|---|
| ROM identity | Header fields and full-image SHA-1. |
| Directory | All six groups, 167 file records, bounds, non-overlap, and alignment checked against ROM bytes. |
| Compression | 98/98 independent decodes reach declared size and exact indexed end; all 98 shared-reference re-encodes round-trip byte-identically after decoding. |
| Level container | Eight `EXP` files parse as complete `FORM/TERR`; child walk ends at exact decoded size. |
| Geometry | XOBF section offsets and first HARBOR model's vertex-count/span/display-list consistency checked from decoded bytes; node fields, 24.8 translation and transform construction checked against resident disassembly. |
| Object binding | `LOAD.DLL` relative `0x1C2C`, resident `0x80148254`/`0x80141E44`, all `FORM/OBJ` bank/root fields, and the level-DLL name registries establish deterministic selected-root construction. |
| Object placement | All eight arenas rendered offline with authored world poses; scaled assembly bounds coincide with occupied terrain bounds, without unrelated XOBF roots at the origin. |
| Lighting state | Entry-state dependency established by scanning the first vertex load of every HARBOR and OILFIELD model and by later explicit `D9` lighting toggles. |
| Visible terrain | ZMAP/ZONE position and height conversion, the 2-unit render grid, XTIN loader, UV-orientation table, triangle selection, XBMP atlas and COLS ramp checked from decoded bytes and sequel disassembly; all eight surfaces rendered coherently offline. |
| Terrain collision | ZMAP pointer-grid population, ZONE unpacking, one-unit grid, height scaling and interpolation checked in the sequel's level overlay and resident disassembly. |
| Object catalog | All eight placement counts and `HEAD` names scanned from decoded chunks. |
| Music | 36/36 indexed sequences decode; file/title pointer tables and repeat opcode handlers checked by disassembly. |
| Runtime frame | Title logo captured only. Renderer combinations gave black or corrupted later frames, so no arena/frame-accurate validation is claimed. |

### 8.2 Known unknowns

The principal blockers for full-fidelity viewing are exact `SUNA`/XOBF
lighting, middle-section interpretation, non-terrain collision structures,
environment parameters, runtime object behavior, and animation. For audio, game-side mixer
gain, reverb, output rate and playback fidelity remain unmeasured. A reliable game
capture is needed to validate sky projection, lighting, fog, camera, and
debug-feature reachability.

### 8.3 References

The ROM itself is the primary source for offsets, records, and names above.
The [shared Vigilante LZSS reference](compression/vigilante-lzss.md) documents
the common bitstream and encoder. No external decompilation labels are used.
