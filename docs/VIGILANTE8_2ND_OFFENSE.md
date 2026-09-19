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
| Collision | `ZONE` grids, `ZMAP`, and `BSP ` data are present; precise physical collision contract unverified. |
| Music driver | libmus-compatible `0x215` multichannel sequencer with counted and infinite repeats. |
| Audio microcode | **Unknown**. |
| Sample encoding | Nintendo 9-byte-frame VADPCM for the 86-entry music bank; the separate Luxo effects bank is not used by music wave maps. |
| Levels | Eight indexed arena DLL/EXP pairs. |
| Memory requirement | **Unknown**; audio setup has separate copied-bank and cartridge-bank paths. |
| Viewer support | USA revision 0: eight static arena scenes, panoramas and 36 music entries; collision and dynamic objects omitted. Post-implementation tests were skipped at user direction. |

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

The two `FORM/XOBF` banks contain a `BIN ` child. Its 32-byte header has
three count/relative-offset pairs, then a fixed-record count. The first
section begins after a `0x20`-byte header plus an array of 28-byte records.
Seven of eight first banks and all eight second banks meet that relation
exactly; OILFIELD's first bank is four bytes shorter, so loaders must honor
the stored section offset rather than computing it from the record count.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | u32 | `section0Count` | Number of first-section records. |
| `0x04` | 4 | u32 | `section0Offset` | Relative to start of `BIN ` payload. |
| `0x08` | 4 | u32 | `section1Count` | Number of second-section records. |
| `0x0C` | 4 | u32 | `section1Offset` | Relative to start of `BIN ` payload. |
| `0x10` | 4 | u32 | `section2Count` | Number of third-section records. |
| `0x14` | 4 | u32 | `section2Offset` | Relative to start of `BIN ` payload. |
| `0x18` | 4 | u32 | `fixedRecordCount` | Number of following 28-byte records. |
| `0x1C` | 4 | u32 | `reserved_1C` | Zero in examined banks. |
| `0x20` | `28 × fixedRecordCount` | u8[][28] | `fixedRecords` | Semantics incomplete. |

The 28-byte records form a forward-linked scene graph. All 5,523 non-sentinel
sibling indices examined across the 16 banks are forward and in range. Most,
but not all, non-sentinel child indices equal the next record: 213 of 1,300
skip ahead. The low eight bits of `modeAndModel` are usually a valid first
section model index or `0xFF`; ten exceptions need investigation.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 20 | u8[20] | `unknown_00` | Includes spatial/transform fields not yet typed. |
| `0x14` | 2 | u16 | `nextSibling` | Forward record index, or `0xFFFF`. |
| `0x16` | 2 | u16 | `firstChild` | Record index, or `0xFFFF`. |
| `0x18` | 2 | u16 | `modeAndModel` | Low eight bits usually model index or `0xFF`; high bits unresolved. |
| `0x1A` | 2 | u16 | `shapeIndexOrFlag` | Often `0xFFFF` or a middle-section index. |

The first section has a `u32` relative-offset array followed by variable
model records. Its offsets resolve within the section. A model record begins:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | u32 | `vertexCount` | Number of N64-format vertices. |
| `0x04` | 4 | u32 | `vertexDataOffset` | Relative to model start. |
| `0x08` | 4 | u32 | `displayListOffset` | Relative to model start. |
| `0x0C` | 4 | u32 | `unknown_0C` | Meaning not established. |
| `0x10` | 4 | u32 | `unknown_10` | Meaning not established. |
| `0x14` | 4 | u32 | `unknown_14` | Meaning not established. |
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
The 28-byte record semantics remain incompletely typed.
Verified from decoded ROM bytes; the stage's complete visual mesh has not
been independently rendered.

### 3.4 Display lists and render state

The embedded RSP string identifies F3DEX fifo 2.08. XOBF model records
contain direct F3DEX2 command streams, including `E7` pipe sync, `E2` render
state, `01` vertex loads, and `05`/`06` triangle commands. Exact per-material
blend and texture state remains to be decoded. Do not assume display-list
bytes are generic F3D or a custom triangle-list format.

### 3.5 Textures and materials

Each `XLSC` payload starts with four non-JPEG bytes followed by a baseline
JFIF JPEG; HARBOR's first image independently identifies as 320×96. All
eight arenas have 16 such chunks. These are menu-preview strips, not a
substitute for 3D materials.

`XBMP` begins with the common eight-byte texture header, followed by a
512-byte big-endian RGBA5551 palette and a 320×128 8-bit-index bitmap.
`XBGM` adds one four-byte field of unknown meaning before that same texture
header, so its palette begins at payload `+12` and its bitmap is 256×92.
Raw HARBOR and OILFIELD `XBGM` payloads have `0x0201`, 256 palette entries,
and 256×92 dimensions at `+4`; `+12` is palette data. [evidence: ROM bytes]

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
models; complete material-state handling remains to be implemented.

### 3.6 Collision

Every arena has a `ZMAP` chunk of `0x800` bytes and 6–9 `ZONE` chunks of
`0x4000` bytes each. A `ZONE` can be read as a 64×64 array of 32-bit words,
and `ZMAP` as 64×32 bytes. In the first game's matching format, nonzero
`ZMAP` cells correspond one-to-one with `ZONE` chunks, and the upper 16-bit
half of each zone word varies like a height field; the lower half varies
non-continuously like a material/flags field. That interpretation is a
**hypothesis** for the sequel until its world scaling and runtime consumer
are validated. Exact collision surface construction remains unproved. Each arena
also contains one `BSP ` chunk, plus `JUNC` and `RSEG` route records; their
collision roles require disassembly or RAM validation. The presence of these
chunks is verified; a collision decoder is not yet specified.

### 3.7 Environment, sky, fog, and lighting

`XBGM` contains the indexed sky image. The `SUNA` and `COLS` chunks are
plausible sun/color parameters from their tags and fixed sizes (`0x10` and
`0x20`), but their rendering semantics are **hypotheses**. Fog controls,
light direction/intensity, horizon mapping, and animation have not been
validated in a trustworthy in-game frame. The `HEAD` chunk is `0x1A` bytes
in HARBOR, but its field meanings remain unknown.

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
three signed 32-bit coordinate values are consistent with 16.16 fixed-point
position, but their axes should be verified against a rendered stage.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | u16 | `unknown_00` | Object class or flags; semantic role unresolved. |
| `0x02` | 2 | s16 | `unknown_02` | May be `-1`; role unresolved. |
| `0x04` | 2 | u16 | `unknown_04` | Role unresolved. |
| `0x06` | 2 | u16 | `unknown_06` | Role unresolved. |
| `0x08` | 4 | s32 | `positionX` | Hypothesized 16.16 fixed-point. |
| `0x0C` | 4 | s32 | `positionY` | Hypothesized 16.16 fixed-point. |
| `0x10` | 4 | s32 | `positionZ` | Hypothesized 16.16 fixed-point. |
| `0x14` | 14 | u16[7] | `unknown_14` | Additional flags/orientation/model association. |
| `0x22` | Variable | char[] | `name` | Raw ASCII, length is `payloadSize − 0x22`. |

### 4.2 Object and model formats

Placed objects can refer to XOBF model banks; shared `SHARED/COMMON.EXP`,
`ARMS.EXP`, and `HOTRODS.EXP` provide further compressed resources. The
second XOBF bank is byte-identical across seven arenas; ROUTE66 differs.
This establishes deliberate sharing, not exact object class mappings.
The exact `HEAD`/`BSPI` linkage remains unknown.

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
first game's LZSS decoder. `level.ts` walks `FORM/TERR`, decodes the sequel's
32-byte XOBF header, indexed models/textures and F3DEX2 lists, assembles
static scene-node instances, and renders `XBGM` as a panoramic sky.
`vigilante8_2.ts` exposes the eight arenas; `music.ts` adapts all 36 indexed
sequences to the shared libmus renderer.

### 7.2 Supported features

The viewer accepts `NVGE` revision 0 and lists all eight indexed arenas.
It builds a static scenery layer from the XOBF banks and offers 36 `MUSIC`
cues. These implementation claims are from source inspection only; no
post-implementation checks, renders or playback checks were run, at the
user's request.

### 7.3 Approximations and omissions

Scene-node translation fields and scale are not runtime-confirmed; unknown
rotation/scale data are omitted. The starting camera and cylindrical sky
projection are viewer approximations. Collision, `FORM/OBJ` binding,
animations, scripts, fog and routes are omitted. The music player uses
neutral dry mixer settings because game-specific volume/reverb have not been
measured. The JPEG preview strips are not used as in-game materials.

## 8. Verification and remaining work

### 8.1 Verification evidence

| Claim | Verification |
|---|---|
| ROM identity | Header fields and full-image SHA-1. |
| Directory | All six groups, 167 file records, bounds, non-overlap, and alignment checked against ROM bytes. |
| Compression | 98/98 independent decodes reach declared size and exact indexed end; all 98 shared-reference re-encodes round-trip byte-identically after decoding. |
| Level container | Eight `EXP` files parse as complete `FORM/TERR`; child walk ends at exact decoded size. |
| Geometry | XOBF section offsets and first HARBOR model's vertex-count/span/display-list consistency checked from decoded bytes. |
| Object catalog | All eight placement counts and `HEAD` names scanned from decoded chunks. |
| Music | 36/36 indexed sequences decode; file/title pointer tables and repeat opcode handlers checked by disassembly. |
| Runtime frame | Title logo captured only. Renderer combinations gave black or corrupted later frames, so no arena/frame-accurate validation is claimed. |

### 8.2 Known unknowns

The principal blockers for full-fidelity viewing are XOBF material-state and
middle-section interpretation, collision field semantics, environment parameters,
placement-to-model associations, and animation. For audio, game-side mixer
gain, reverb, output rate and playback fidelity remain unmeasured. A reliable game
capture is needed to validate sky projection, lighting, fog, camera, and
debug-feature reachability.

### 8.3 References

The ROM itself is the primary source for offsets, records, and names above.
The [shared Vigilante LZSS reference](compression/vigilante-lzss.md) documents
the common bitstream and encoder. No external decompilation labels are used.
