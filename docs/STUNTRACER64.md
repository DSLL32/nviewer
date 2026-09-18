# Stunt Racer 64 — Nintendo 64 ROM format specification

This manual describes the shipped data formats needed to identify, extract, and
present Stunt Racer 64 content. Claims state their evidence inline; unsupported
interpretations are labelled hypotheses.

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | Thirteen map archives, eight secondary-file catalogs, and separate vehicle and model catalogs; 2,211 containers indexed. |
| Compression | Boss chunked-zlib for general assets (independent RFC 1950/DEFLATE blocks of at most 16,000 decoded bytes); separate Boss LZ/RLE for music patterns. |
| Graphics microcode | Custom RSP graphics task, CRC `844B55B5`; GLideN64 supports it. |
| Geometry | primary pointer-rich map blob plus eight tables containing 1,808 exact secondary archives |
| Textures | material-indexed Gfx setup/load/TLUT lists; CI4, CI8, RGBA16, IA8 and one I4 material; exact payload size comes from `G_LOADBLOCK`, not `G_SETTILESIZE` |
| Collision | 355 files, 66,497 vertices, 77,146 triangles, with validated cross-section adjacency records |
| Music driver | custom six-channel packed tracker, 14 slots at 21,998 Hz, three instrument/sample palettes, exact order/restart loops |
| Audio microcode | **Unknown** |
| Sample encoding | Nintendo 4-bit VADPCM. |
| Levels | 13 physical map archives; 14 public selector labels because `No Track` and `Stunt Bowl` both map to archive 11 |
| Memory requirement | **Unknown** |
| Viewer support | easy storage/catalogs; medium geometry/material TMEM path; medium scenery; medium-high animation and exact spatial-atmosphere reproduction; custom music player required |
| Environment | a real textured skydome plus a separate camera-projected spatial atmosphere map; nominal 89° vertical FOV and near plane 32 |
| Unused/hidden | no orphan course; two strong catalog-omitted model-format IA-alpha planes; dormant path channel; compiled fog/sky controls of unproved retail reachability |

### 1.2 ROM identification

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| USA | `Stunt Racer 64` | `NR3E` | 0 | 12 MiB (`0xC00000`) | `9510D8D7` | `35100DD2` | `8570fa1f3e4cf7e62dc49da181353e4f301503b7` | CIC-6102 | — |

Verified from the normalized ROM headers and complete-image SHA-1 hashes.

### 1.3 Terminology and conventions

ROM and memory ranges are half-open. Offsets, addresses, encoded sizes, masks,
and opcodes are hexadecimal unless stated otherwise. Multi-byte CPU fields are
big-endian. RAM addresses are virtual unless explicitly identified as physical;
segmented, VROM, and file-relative addresses are named at each use.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

#### Boot and resident code

The initialized linked image begins at ROM `0x1000`, runtime `0x80000400`, with:

```text
runtime = ROM + 0x7FFFF400
ROM     = runtime - 0x7FFFF400
```

Startup clears `0x438E0` bytes from `0x800CA650` through `0x8010DF2F`, sets SP to
`0x800CAE50`, and jumps to `0x800021B4`. The initialized code/data image ends at ROM
`0xCB250` (size `0xCA250`); separate resource data starts there. [evidence: ROM bytes, disassembly]

No executable overlay table or overlay relocation path was identified. All observed
asset loaders are called by the resident program. This is strong negative static
evidence, not proof that no runtime-generated code could exist. [evidence: disassembly]

The renderer transforms geometry through custom RSP microcode. Glide64mk2 rejects
ucode CRC `844B55B5`; GLideN64 with the same RSP-HLE stack can render the legal/title
screen, but this investigation did not reach an in-race frame that exercises the
course renderer. This does not affect an nviewer loader, which reads source geometry
structures directly. [evidence: emulator observation, ROM bytes]

### 2.2 Memory and address mapping

The resident image maps ROM offset `r` in `[0x1000,0xCB250)` to KSEG0 address
`r + 0x7FFFF400`. Map-header pointers and geometry pointers instead use offsets
from the start of the inflated primary map; secondary-file start/end fields use
offsets from `secondaryBase`, while each secondary metadata pointer is relative
to its own inflated file. Audio tables contain ROM offsets. Do not apply the
resident-image conversion to either asset-pointer class. [evidence: disassembly,
ROM bytes]

### 2.3 ROM map and asset organization

The linked image occupies `0x1000–0xCB250`. The thirteen complete map bundles
tile `0x1775C0–0x7B36D0`. General assets occupy the regions between and after
those spans; the audio allocation covers `0x92DDC0–0xBCD31C`. The ROM is zero
filled from `0xBCD31B` to `0xC00000`. The indexed containers are organized by
tables and map-relative extents, not by filename strings. [evidence: ROM bytes,
deterministic decoding]

### 2.4 Compression formats

Reference codecs: [chunked zlib](compression/chunked-zlib.md) for general assets;
[Boss pattern LZ/RLE](compression/boss-pattern.md) for packed music patterns.

#### Chunked-zlib container

General compressed assets use zlib 1.0.4; the linked image contains Mark Adler's
`inflate 1.0.4` identification at ROM `0xBE010`. Retail routine `0x80001BF0`
implements this outer format: [evidence: ROM bytes, disassembly]

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | sourceSize | Complete container size including header. |
| 0x04 | 4 | u32 | destinationSize | Concatenated decoded byte count. |
| 0x08 | Variable | block[] | blocks | Repeat until sourceSize bytes are consumed. |

Each compressed block has a four-byte length header:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | blockCompressedSize | Compressed stream length. |
| 0x04 | blockCompressedSize | u8[] | zlibStream | Independent zlib stream. |
| Following | 0–1 | u8 | padding | Pads the stream end to two-byte alignment. |

Each stream is independent. Every non-final block expands to exactly 16,000
(`0x3E80`) bytes; the final block produces the remainder. The runtime alternates two
16,000-byte staging buffers. [evidence: disassembly, deterministic decoding]

A single strict scan found 2,211 distinct, non-overlapping containers. Their stored
extents total `0x760F78` bytes and inflate to `0x1212D31` bytes. Of these, 2,198 use
zlib header `78 DA`; 13 use `78 9C`. A `78 DA`-only extractor therefore silently
misses valid files. The strict scanner validates outer bounds, every zlib checksum,
block output limits, and total output size. [evidence: deterministic decoding]

No second general level-geometry codec was identified. Music pattern payloads
have the separate Boss LZ/RLE format specified under *Song and pattern formats*.
Raw texture/palette and audio pools coexist with the zlib containers, so absence
of zlib framing does not imply padding. [evidence: ROM bytes, disassembly]

#### Map bundles

Thirteen complete map bundles tile ROM `0x1775C0–0x7B36D0` without a gap. Each begins
with its primary map container. Retail loader `0x800494E0` computes the secondary
asset base as:

```text
secondaryBase = bundleStart + align2(primary.sourceSize)
```

All current sizes are already even, but the aligned expression is the actual format
contract. The old Hack64 viewer used `bundleStart + sourceSize` and marked it
uncertain; it happens to work for this image. [evidence: ROM bytes, disassembly, upstream source]

Eight file tables inside each inflated primary map contain 12-byte records:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `+0x00` | 4 | `u32` | `packedStartRelativeToSecondaryBase` | — |
| `+0x04` | 4 | `u32` | `packedEndRelativeToSecondaryBase` | — |
| `+0x08` | 4 | `u32` | `metadataOffsetInInflatedSecondaryFile` | Points to that file's metadata header. |

All 1,808 table records resolve in the bundle, begin at a strict zlib container, and
end exactly at its declared `sourceSize`. Runtime fixup `0x80046DA8` adds the
secondary base to the first two words. No signature scan is needed at load time.
[evidence: disassembly, deterministic decoding]

Some bundles place a raw high-entropy prefix between the primary map and the first
table-listed file. These are map-resident image/palette resources addressed by
display-list pointers, not filesystem holes. [evidence: ROM bytes, disassembly]

#### Audio sample storage

There are three complete sample/instrument palettes. Runtime loads a base bank then a
sparse overlay; overlay flag `0x80` means retain that base slot and supplies no sample.
The first 33 overlay records are placeholders. [evidence: disassembly, deterministic decoding]

| mode | base ROM / records | overlay ROM / records | effective slots | instrument map |
|---:|---|---|---:|---|
| 0 | `A7E330–AB60C2` / 33 | `B1DB50–B4D506` / 54 (33 placeholders) | 54 | `BB31A0–BB35C4` |
| 1 | `AB60D0–AEE3A8` / 33 | `B4D510–B84740` / 56 (33 placeholders) | 56 | `BB35D0–BB39F4` |
| 2 | `AEE3B0–B1DB50` / 33 | `B84740–BB3194` / 55 (33 placeholders) | 55 | `BB3A00–BB3E24` |

Each instrument map contains 11 instruments. The entry at (instrument − 1) × 96 + note − 1 selects a sample slot. [evidence: disassembly, deterministic decoding]

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | count | Instrument count, 11. |
| 0x04 | 96 × count | u8[][96] | noteMaps | One sample-slot byte per note. |

Normal sample records have a 0x94-byte header; known fields are below. Field widths not established in the evidence remain unknown. Flag bit 0 would add a 0x400-byte auxiliary table, but no music sample sets it. [evidence: disassembly, deterministic decoding]

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x04 | 4 | u32 | decodedBytes | Decoded PCM byte count, rounded to 32. |
| 0x0C | 2 | u16 | initialPan | Initial pan; 128 in authored music samples. |
| 0x10 | 1 | s8 | baseNote | Base-note offset added to tracker note. |
| 0x11 | 1 | s8 | fineTune | Signed fine-tuning value used by pitch calculation. |
| 0x12 | 1 | s8 | volume | Default volume; 64 in authored music samples. |
| 0x13 | 1 | s8 | unknown13 | Copied to runtime descriptor; audible role unresolved. |
| 0x14 | 0x80 | u8[] | predictorBook | 128-byte predictor book. |
| 0x94 | Variable | u8[] | payload | Optional auxiliary table, then encoded audio. |

Encoded audio is standard N64 4-bit VADPCM: 9 bytes produce 16 samples. Stored length is round_even((decodedBytes >> 5) × 9).

Existing `decodeVadpcm` and `RESAMPLE_LUT` from `src/rom/music/libultra.ts` are useful;
the sequencing/bank layer must be new. [evidence: nviewer source, viewer design]

### 2.5 Loading process

The map loader selects one 0x5C-byte internal-map record, inflates the bundle's
primary file, computes `secondaryBase` from its aligned stored size, then fixes up
secondary table extents and internal pointers. Each secondary file can be fetched
and decoded independently; the eight primary-map tables are authoritative for
the files needed by that map. [evidence: disassembly, deterministic decoding]

### 2.6 Revision differences

Only the USA revision-0 image was audited. No offset or format compatibility is
claimed for other revisions. The shipped credits contain `$September 2, 2000`
at ROM `0xD1990`; this is a data string, not a verified build timestamp.
[evidence: ROM bytes]

## 3. Level data

### 3.1 Level catalog and identifiers

#### Other catalogs and ROM tail

The 33-entry vehicle catalog is at ROM `0xACCC0`, stride `0x3C`; *Objects, placement and paths* describes it.
A 27-entry raw lookup table at `0xA8300` selects five 256-byte resources from
`0x7BABB0–0x7BB0B0` or small fallback indices. Its consumer suggests palettes,
but that name remains a hypothesis. [evidence: ROM bytes, disassembly, hypothesis]

After removing the map primary files, 1,808 map subfiles, and 66 vehicle containers,
324 strict containers remain. Most are reached through additional master arrays;
their bounded reachability audit is in *Unused and hidden content*. The ROM remains nonzero through
`0xBCD31A`, then has `0x32CE5` zero bytes to the 12 MiB boundary. [evidence: deterministic decoding, ROM bytes]

#### Internal map table

The internal table is at ROM `0xBBDA0`, runtime `0x800BB1A0`, with 13 records of
`0x5C` bytes. Code at `0x800495E8` selects `index * 0x5C` and calls loader
`0x800494E0`. Important fields are: [evidence: ROM bytes, disassembly]

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | name | Linked internal-name pointer. |
| 0x14 | 4 | u32 | romStart | Complete bundle ROM start. |
| 0x18 | 4 | u32 | romEnd | Exclusive bundle ROM end. |
| 0x1C | 4 | u32 | flags | Map flags; semantics unresolved. |
| 0x20 | 12 | u32[3] | environmentParameters | Environment/render values; meanings unresolved. |

| internal ID | internal name | bundle ROM | primary packed → unpacked | meshes | collision | scenery | materials |
|---:|---|---|---:|---:|---:|---:|---:|
| 0 | Test Track | `7478F0–7B36D0` | `29E7C → 70F58` | 57 | 36 | 25 | 115 |
| 1 | Space Race | `1AEB60–2435E0` | `31654 → 6D798` | 63 | 30 | 16 | 178 |
| 2 | Retro Metro | `2435E0–2DA080` | `266DA → 646F8` | 51 | 41 | 13 | 108 |
| 3 | Wild West | `4175D0–4BCE30` | `3DBC6 → 8B530` | 72 | 28 | 16 | 184 |
| 4 | Planet X | `2DA080–3885A0` | `32E06 → 916A8` | 84 | 54 | 12 | 142 |
| 5 | Tacky Tiki | `4BCE30–556860` | `44E08 → A98E8` | 57 | 52 | 22 | 146 |
| 6 | Toys | `556860–5D97B0` | `362DC → A5B48` | 51 | 48 | 20 | 178 |
| 7 | CarnEvil | `5D97B0–670350` | `41FD6 → B09B0` | 87 | 15 | 18 | 123 |
| 8 | Soda Fountain | `670350–6B5F60` | `1E8E4 → 47F58` | 42 | 6 | 7 | 97 |
| 9 | Haunted House | `3885A0–4175D0` | `49882 → B40F0` | 54 | 16 | 15 | 208 |
| 10 | Kingdom O Karnage | `6B5F60–7478F0` | `489B2 → A0560` | 68 | 25 | 15 | 184 |
| 11 | Four Player 1 | `18C380–1AEB60` | `D7D4 → 2BC50` | 15 | 2 | 0 | 27 |
| 12 | Four Player 2 | `1775C0–18C380` | `ABE4 → 24AD0` | 12 | 2 | 0 | 36 |

All counts, spans, pointer targets, and archive outputs were exhaustively validated.
[evidence: deterministic decoding]

#### Separately cataloged shared models

Exactly 33 of the directly referenced non-map/non-vehicle containers validate as
standalone `GeometryMeta` model containers. Pointer table `0xC2204` has 30 entries
and 20 unique files (ten repeats); table `0xC2280` has 13 entries and 13 unique
files. They are consumed by routines `0x80073908` and `0x8007407C`, respectively,
but their gameplay names remain unresolved. [evidence: ROM bytes, disassembly, deterministic decoding]

These models are not missing course scenery: all 179 scenery records and their
geometry/material pointers are wholly contained in their primary maps. Keep the 33
models out of course views; they may become a separate named catalog after their
semantics are identified. [evidence: deterministic decoding, viewer design]

#### Bounded uncataloged-container audit

Of the 324 zlib containers left after the map and vehicle catalogs, 225 have their
exact ROM start stored as an aligned word, mainly in master arrays around `0xC1DA0`,
`0xC1EA0`, `0xC2204`, `0xC2280`, `0xC2454`, `0xC2630`, and `0xC2920`. They are
cataloged even though all higher-level table names are not yet known. [evidence: deterministic decoding]
Thirty-three are the standalone models documented in *Separately cataloged shared models*.

Ninety-nine have no such absolute-start reference. They occur in nine physical runs.
The first, `0xD9340–0xDD034`, contains obviously live-looking biographies, dialogue,
menu text and credits, demonstrating why absence of a literal pointer cannot prove
unused status. The remaining runs have not been proved unreachable by relative
addressing or computed references.
[evidence: ROM bytes, deterministic decoding]

### 3.2 Level container

#### Primary map format and grouping

Pointers in the inflated primary map are offsets from that blob's start. Its first
word is the exact inflated size in all 13 maps. Viewer-relevant header fields are:
[evidence: ROM bytes, disassembly, deterministic decoding]

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x000 | 4 | u32 | fileSize | Exact inflated file size. |
| 0x00C | 4 | u32 | sky | File-relative GeometryMeta pointer. |
| 0x048 | 4 | u32 | collisionFiles | File-relative file-pointer-array offset. |
| 0x04C | 4 | u32 | collisionFileCount | File count. |
| 0x050 | 4 | u32 | collisionGroups | File-relative group-array offset. |
| 0x054 | 4 | u32 | collisionGroupCount | Group count. |
| 0x058 | 4 | u32 | collisionTable | File-relative secondary-file-table offset. |
| 0x05C | 4 | u32 | meshFiles | File-relative file-pointer-array offset. |
| 0x060 | 4 | u32 | meshFileCount | File count. |
| 0x064 | 4 | u32 | meshGroups | File-relative group-array offset. |
| 0x068 | 4 | u32 | meshGroupCount | Group count. |
| 0x06C | 4 | u32 | meshTable | File-relative secondary-file-table offset. |
| 0x074 | 4 | u32 | auxiliaryFiles | File-relative file-pointer-array offset. |
| 0x078 | 4 | u32 | auxiliaryFileCount | File count. |
| 0x07C | 4 | u32 | auxiliaryGroups | File-relative group-array offset. |
| 0x080 | 4 | u32 | auxiliaryGroupCount | Group count. |
| 0x08C | 4 | u32 | auxiliaryTable | File-relative secondary-file-table offset. |
| 0x090 | 4 | u32 | path0Files | File-relative file-pointer-array offset. |
| 0x094 | 4 | u32 | path0FileCount | File count. |
| 0x098 | 4 | u32 | path0Groups | File-relative group-array offset. |
| 0x09C | 4 | u32 | path0GroupCount | Group count. |
| 0x0A4 | 4 | u32 | path0Table | File-relative secondary-file-table offset. |
| 0x0A8 | 4 | u32 | path1Files | File-relative file-pointer-array offset. |
| 0x0AC | 4 | u32 | path1FileCount | File count. |
| 0x0B0 | 4 | u32 | path1Groups | File-relative group-array offset. |
| 0x0B4 | 4 | u32 | path1GroupCount | Group count. |
| 0x0BC | 4 | u32 | path1Table | File-relative secondary-file-table offset. |
| 0x0C0 | 4 | u32 | path2Files | File-relative file-pointer-array offset. |
| 0x0C4 | 4 | u32 | path2FileCount | File count. |
| 0x0C8 | 4 | u32 | path2Groups | File-relative group-array offset. |
| 0x0CC | 4 | u32 | path2GroupCount | Group count. |
| 0x0D4 | 4 | u32 | path2Table | File-relative secondary-file-table offset. |
| 0x0D8 | 4 | u32 | path3Files | File-relative file-pointer-array offset. |
| 0x0DC | 4 | u32 | path3FileCount | File count. |
| 0x0E0 | 4 | u32 | path3Groups | File-relative group-array offset. |
| 0x0E4 | 4 | u32 | path3GroupCount | Group count. |
| 0x0EC | 4 | u32 | path3Table | File-relative secondary-file-table offset. |
| 0x0F0 | 4 | u32 | otherPathFiles | File-relative file-pointer-array offset. |
| 0x0F4 | 4 | u32 | otherPathFileCount | File count. |
| 0x0F8 | 4 | u32 | otherPathGroups | File-relative group-array offset. |
| 0x0FC | 4 | u32 | otherPathGroupCount | Group count. |
| 0x100 | 4 | u32 | otherPathTable | File-relative secondary-file-table offset. |
| 0x108 | 4 | u32 | tiltLines | File-relative tilt-line pointer. |
| 0x10C | 4 | u32 | tiltLineCount | Tilt-line count. |
| 0x11C | 40 | u8[0x28] | materials | Material-table bundle; internal layout unresolved here. |
| 0x144 | 4 | u32 | materialSetup | File-relative material setup-array pointer. |
| 0x148 | 4 | u32 | materialImages | File-relative image-pointer array. |
| 0x14C | 4 | u32 | materialTluts | File-relative TLUT-pointer array. |
| 0x324 | 4 | u32 | scenery | File-relative scenery-object array. |
| 0x328 | 4 | u32 | sceneryCount | Scenery-object count. |
| 0x334 | 112 | u8[0x70] | environment | Spatial atmosphere/environment data. |
| 0x3B0 | 2 | u16 | coinGroupCount | Probable coin-group count. |
| 0x3B4 | 2 | u16 | placementGroupCount | Unresolved placement-group count. |
| 0x3B8 | 2 | u16 | boosterGroupCount | Probable booster-group count. |
| 0x3C4 | 4 | u32 | coinGroups | File-relative probable coin-group pointer. |
| 0x3C8 | 4 | u32 | placementGroups | File-relative unresolved placement-group pointer. |
| 0x3D0 | 4 | u32 | boosterGroups | File-relative probable booster-group pointer. |

Field widths are corroborated by the source-derived MapHeader decoder in the archived reference implementation; semantic uncertainty is retained above.

Each group header is eight bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | memberCount | Number of members. |
| 0x04 | 4 | u32 | memberIndices | Pointer to memberCount u16 indices. |

Mesh, collision,
and auxiliary descriptors have three groups: group 0 enumerates every file once;
groups 1 and 2 are empty. Some path descriptors repeat members in all three groups,
so a loader must honor actual groups instead of assuming only group 0. [evidence: deterministic decoding]

Across all maps the eight secondary tables contain: [evidence: deterministic decoding]

| set | count field | table field | files |
|---|---:|---:|---:|
| collision | `04C` | `058` | 355 |
| mesh | `060` | `06C` | 713 |
| auxiliary | `078` | `08C` | 207 |
| path 0 | `094` | `0A4` | 95 |
| path 1 | `0AC` | `0BC` | 122 |
| path 2 | `0C4` | `0D4` | 122 |
| path 3 | `0DC` | `0EC` | 0 |
| other path | `0F4` | `100` | 194 |

#### Map-resident scenery

Each primary-map scenery record is 0x28 bytes: [evidence: disassembly, deterministic decoding]

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | geometry | GeometryMeta pointer. |
| 0x04 | 12 | u32[3] | unknown04 | Unknown. |
| 0x10 | 4 | u32 | root | Root transform-node pointer. |
| 0x14 | 4 | u32 | animations | Animation-header array pointer. |
| 0x18 | 4 | u32 | animationCount | Animation-header count. |
| 0x1C | 4 | u32 | unknown1C | Unresolved scalar/flags. |
| 0x20 | 4 | u32 | animationCache | Runtime root-animation cache. |
| 0x24 | 4 | u32 | optional | Optional pointer, zero in all 179 ROM records. |

Transform node, known fields through +0x38. Base placement is local s16 vertex plus translation × 32. Recursive children and the auxiliary array are established by relocation routine 0x80038940. [evidence: disassembly, open question]

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 12 | f32[3] | translation | X, Y, Z. |
| 0x0C | 0x1C | u8[] | unknown0C | May encode rotation/scale; unresolved. |
| 0x28 | 4 | u32 | children | Recursive child-array pointer. |
| 0x2C | 4 | u32 | childCount | Child count. |
| 0x30 | 4 | u32 | auxiliary | Pointer to eight-byte records. |
| 0x34 | 4 | u32 | auxiliaryCount | Auxiliary record count. |

All 179 scenery objects have at least one animation header, 995 total. Headers are 0x20 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | countLike | Count-like value; exact semantics unresolved. |
| 0x04 | 12 | u8[] | unknown04 | Unknown. |
| 0x10 | 4 | u32 | flags | Event code changes flag bits. |
| 0x14 | 4 | u32 | pointer14 | Pointer, role unresolved. |
| 0x18 | 4 | u32 | transform | Transform pointer. |
| 0x1C | 4 | u32 | pointer1C | Pointer, role unresolved. |

Routine 0x8004899C caches the header whose transform matches the root. Base geometry and translation suffice for an initial viewer; keyframe/channel interpolation remains a separate task. [evidence: disassembly, viewer design]

#### Song and pattern formats

Every song metadata object is exactly `0x710` bytes: [evidence: ROM bytes, disassembly, deterministic decoding]

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x000` | 2 | `u16` | `orderCount` | Number of active order entries. |
| `0x002` | 2 | `u16` | `restartOrder` | Restart order. |
| `0x004` | 2 | `u16` | `channels` | Always 6. |
| `0x006` | 2 | `u16` | `patternCount` | Pattern count. |
| `0x008` | 2 | `u16` | `initialSpeed` | Always 2. |
| `0x00A` | 2 | `u16` | `initialTempo` | Always 130. |
| `0x00C` | `0x100` | `u8[256]` | `order` | Pattern order. |
| `0x110` | `0x400` | `u32[256]` | `patternOffsets` | Relative to the decoded pattern base. |
| `0x510` | `0x200` | `u16[256]` | `patternRows` | Row counts. |

Pattern payload:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | rawSize | Decoded size. |
| 0x04 | 4 | u32 | packedSize | Packed size. |
| 0x08 | Variable | u8[] | stream | Boss's custom LZ/RLE stream. |

The stream begins with a mode byte. Retail streams all use `0x40` for the
compressed path; `0x80` selects a raw remainder. Compressed data starts with
MSB-first 16-bit controls: 0 is a literal; 1 is either a 12-bit backward
distance plus `(lowNibble+3)` copy length, or, with zero distance,
`(next12+16)` repeats of the following byte. All 14 payloads decode to their
exact sizes. The [Boss pattern LZ/RLE format](compression/boss-pattern.md)
specifies token bytes and provides a reference decoder and encoder. [evidence:
disassembly, deterministic decoding]

For the USA revision-0 ROM, the 14 packed streams total 78,155 retail bytes
and 309,984 decoded bytes. The reference encoder produces 49,784 bytes over
the same corpus and roundtrips every stream. The largest retail stream, song 5
at ROM `0xBC4238`, repacks from 9,883 to 5,791 bytes in about 0.20 seconds.
These sizes exclude the eight-byte payload header and alignment padding.
[evidence: deterministic decoding and independent roundtrip]

Cells use XM packed-cell syntax: note, instrument, volume, effect, parameter. If bit
7 of the first byte is set, bits 0–4 select which fields follow; otherwise all five
are present. The loader subtracts `0x10` from the volume column. Tick duration follows
the tracker rule `sampleRate * 5 / (2 * tempo)` samples; speed is ticks per row.
[evidence: disassembly]

#### No orphan course

All 13 internal records resolve to valid, non-overlapping bundles, and those bundles
exactly tile `0x1775C0–0x7B36D0`. The public selector accounts for all 13 archives.
No extra map record or map-like bundle was established. Internal `Test Track` is public
`Nautical Adventure`, not unused content. [evidence: ROM bytes, deterministic decoding]

The header retains a complete fourth path-file channel, but its count is zero in all
13 maps. This is a dormant format path, not evidence that path data was cut.
[evidence: deterministic decoding]

### 3.3 Geometry

#### Track meshes

A mesh secondary record's metadata offset points to: [evidence: deterministic decoding]

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `+00` | 4 | `u32` | `unknown/pointer` | — |
| `+04` | 4 | `u32` | `unknown/pointer` | — |
| `+08` | 4 | `u32` | `GeometryMeta` | — |
| `+0C` | 4 | `s32` | `originX` | # signed 20.11 fixed point; divide by 2048 |
| `+10` | 4 | `s32` | `originY` | — |
| `+14` | 4 | `s32` | `originZ` | — |
| 0x18 | 0x10 | u8[] | unknown18 | Fields at +0x18, +0x1C, +0x20, +0x24 are unresolved. |

The decoded origin is added to local vertices. `GeometryMeta` is shared by track,
scenery, and sky geometry:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `+00` | 4 | `u32` | `vertices` | — |
| `+04` | 4 | `u32` | `vertexCount` | # 3*s16, stride 6 |
| `+08` | 4 | `u32` | `faces` | — |
| `+0C` | 4 | `u32` | `faceCount` | # stride 0x20 |
| `+10` | 4 | `u32` | `texcoords` | — |
| `+14` | 4 | `u32` | `texcoordCount` | # 2*s16, stride 4 |
| `+18` | 4 | `u32` | `colors` | — |
| `+1C` | 4 | `u32` | `colorCount` | # RGBA8888, stride 4 |

Faces are:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `+00` | 2 | `u16` | `unknown00` | — |
| `+02` | 2 | `u16` | `unknown02` | — |
| `+04` | 1 | `u8` | `materialIndex` | — |
| `+05` | 1 | `u8` | `unknown05` | — |
| `+06` | 1 | `u8` | `unknown06` | — |
| `+07` | 1 | `u8` | `unknown07` | — |
| `+08` | 8 | `s16[4]` | `vertex[4]` | — |
| `+10` | 8 | `s16[4]` | `texcoord[4]` | — |
| `+18` | 8 | `s16[4]` | `color[4]` | — |

`vertex[3] == -1` is a triangle; otherwise emit `(0,1,2)` and `(0,2,3)`.
`+5..+7` are not padding: 11,033 of 49,290 track faces use a nonzero value.
Their meaning, and the exact `+0/+2` visibility flags, remain open. All scenery and
sky faces have `+5..+7 == 0`. [evidence: deterministic decoding, open question]

The 713 mesh files total 76,011 vertices and 49,290 source faces: 3,215 triangles
and 46,075 quads. Every vertex, UV, color, and material index is valid. UV components
are signed s10.5 texel coordinates divided by 32 **[hypothesis, strong]**; this matches
their value ranges and N64 convention. Native track position is local `s16` plus
20.11 origin. Collision and scenery floats use the same scale after multiplication
by 32. The historical viewer displays this frame as `(-x,z,y)`; axis conversion is a
viewer convention, not a stored field. [evidence: deterministic decoding, upstream source]

### 3.4 Display lists and render state

Each material index addresses three parallel display lists: setup state,
texture-image load, and palette load. Their RDP commands set tile format and
sampling state, load the image into TMEM, and optionally load a TLUT. Track and
sky faces use the same material-table mechanism. Geometry topology is stored
as source face records rather than recovered from triangle commands. A viewer
must interpret the material lists to reconstruct TMEM and combine, alpha, and
depth state; ignoring the lists loses the authored surface appearance.
[evidence: ROM bytes, disassembly]

### 3.5 Textures and materials

#### Material bundle and texture loads

Header `+0x11C` points to a 0x28-byte bundle relocated by retail routine
`0x800476A0`: [evidence: ROM bytes, disassembly]

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | setupDlByMaterial | Pointer to N setup-DL pointers. |
| 0x04 | 4 | u32 | textureLoadDlByMaterial | Pointer to N texture-load-DL pointers. |
| 0x08 | 4 | u32 | paletteLoadDlByMaterial | Pointer to N palette-load-DL pointers. |
| 0x0C | 4 | u32 | N | Material count. |
| 0x10 | 4 | u32 | uniqueSetupDlPtrs | Pointer to unique setup-DL pointer array. |
| 0x14 | 4 | u32 | setupCount | Unique setup count. |
| 0x18 | 4 | u32 | uniqueTextureLoadDlPtrs | Pointer to unique texture-DL pointer array. |
| 0x1C | 4 | u32 | textureCount | Unique texture count. |
| 0x20 | 4 | u32 | uniquePaletteLoadDlPtrs | Pointer to unique palette-DL pointer array. |
| 0x24 | 4 | u32 | paletteCount | Unique palette count. |

For face material `i`, execute the three parallel lists. Setup lists contain RDP
other modes, combine/color state, and one to six `G_SETTILE`/
`G_SETTILESIZE` pairs. Image lists contain `G_SETTIMG`, sync and `G_LOADBLOCK`;
palette lists use `G_SETTIMG`/`G_LOADTLUT` or end immediately for direct color.
Accurate rendering must preserve wrap/clamp, masks, shifts, mip tiles, combine,
primitive/environment colors, alpha and depth state. [evidence: ROM bytes, disassembly]

All 1,726 material slots load with the conventional raw-transfer `G_SETTIMG`
RGBA16/width-1 setup. Exact source storage is therefore: [evidence: deterministic decoding]

```text
payloadOffset = G_SETTIMG.address
payloadBytes  = 2 * (G_LOADBLOCK.lrs + 1)
```

Never infer payload size from `G_SETTILESIZE`: that command describes sampling,
not storage. In 170 materials its rectangle exceeds the loaded base payload because
of wrap/shift/mip setup. This is expected and is the main correctness trap in this
format. Palette color count is `((G_LOADTLUT.word1 >> 14) & 0x3FF) + 1`.
[evidence: deterministic decoding]

All indexed image loads have `G_LOADBLOCK.dxt = 0`, so the block enters TMEM
linearly. Sampling is different: odd rows exchange the 32-bit halves of each
64-bit TMEM word. On a repeating axis, the `G_SETTILE` mask defines the period
even when `G_SETTILESIZE` names a smaller sampling rectangle. For example, a
Giant Toys CI4 material has a 32×30 rectangle but a 32×32 mask period; decoding
it as 32×30 with linear row addressing smears the source artwork. The viewer
applies both rules to every material, not only this example. [evidence: ROM
display-list words, bounded decoding, viewer render]

Final tile-0 formats across all material slots are:

| format | slots |
|---|---:|
| CI4 | 904 |
| CI8 | 439 |
| RGBA16 | 254 |
| IA8 | 128 |
| I4 | 1 |

There are 1,010 one-tile and 641 six-tile materials; 75 use two to five tiles.
For a faithful loader, emulate the small `SETTIMG`/`SETTILE`/`LOADBLOCK` TMEM path,
then sample the selected tile(s). Existing nviewer RGBA16, IA/I and TLUT decoders can
be reused after material-local TMEM reconstruction. [evidence: deterministic decoding, viewer design]

### 3.6 Collision

Collision secondary metadata is: [evidence: deterministic decoding]

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | faces | Pointer to 0x0A-byte faces. |
| 0x04 | 4 | u32 | faceCount | Face count. |
| 0x08 | 4 | u32 | vertices | Pointer to 0x14-byte vertices. |
| 0x0C | 4 | u32 | vertexCount | Vertex count. |
| 0x10 | 4 | u32 | links | Pointer to 0x0C-byte links. |
| 0x14 | 4 | u32 | linkCount | Link count. |
| 0x18 | 4 | u32 | fourthPtr | Unused pointer; zero. |
| 0x1C | 4 | u32 | fourthCount | Zero in every file. |

A face is:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 6 | `s16[3]` | `vertices` | — |
| `0x06` | 2 | `u16` | `unknown06` | — |
| `0x08` | 2 | `u16` | `unknown08` | — |

Vertex record, 0x14 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 12 | f32[3] | position | X, Y, Z. |
| 0x0C | 4 | u32 | unknown0C | Unknown. |
| 0x10 | 2 | u16 | unknown10 | Unknown. |
| 0x12 | 2 | u16 | unknown12 | Unknown. |

The trailing face
words have thousands of values, so calling them surface flags is unjustified.
[evidence: deterministic decoding, open question]

Each 0x0C-byte link contains three four-byte reference pairs:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 2 | s16 | sectionIndex | Section index. |
| 0x02 | 2 | s16 | faceIndex | Face index within section. |

Across 355 files
and 40,644 links, every pair is either `(-1,-1)` or targets a real section and an
in-range face. These are adjacency/connectivity references **[hypothesis, strong]**;
traversal semantics are not required to draw collision.

Totals are 66,497 collision vertices and 77,146 triangles, all index-valid. Draw
them in a hidden-by-default `collision` layer. [evidence: deterministic decoding, viewer design]

### 3.7 Environment, sky, fog, and lighting

#### Skydome geometry

Map `+0x00C` uses the same `GeometryMeta` and face/material lookup. Across all maps
it has 989 vertices and 1,222 source faces. The construction/draw call chain proves
that it is a camera-relative backdrop, not unknown ordinary geometry (*Sky construction and drawing*). Put it
in a separate `background` layer or `Level.skies`, never in the main track batch.
[evidence: disassembly, deterministic decoding, viewer design]

#### Sky construction and drawing

Retail code proves the backdrop role: main view code calls “Calc sky” at
`0x8001E080`, `0x80034DF0` transforms the map `+0x00C` geometry camera-relatively,
main calls “Draw sky” at `0x8001E764`, and
`0x80037870 → 0x80037898 → 0x800376A0` emits its materials and faces.
Immediately before drawing, `0x800378D0..0x80037920` sets primitive RGB from the
map environment color and alpha to `255 - view[0x141F]`. [evidence: disassembly]

Sky faces use the same material pointer arrays at map `+0x144/+0x148/+0x14C`.
The common dome has six adjacent 64×32 CI8/256-color panels plus two 1×1 materials.
Space Race, Retro Metro and Four Player 2 use ten panels. Toys uses 42 distinct
64×32 CI8 panels and three palettes. Four Player 1 instead uses one 1×1 RGBA16
material. All 143 referenced sky images decode within bounds. [evidence: deterministic decoding]

There are no normals in this geometry. The sky uses stored RGBA vertex colors,
textures and primitive-color modulation, not an N64 light structure. Treat it as
prelit/unlit. [evidence: ROM bytes, disassembly]

#### Compiled environment controls

Command cases `0x8000CC64..0x8000CD3C` set, decrement, increment, or byte-set
`fogBaseLevel`, clamp it, and print `fogBaseLevel = %d`. Case `0x8000BECC` controls
an oscillating sky transform through globals `0x800B8BD0..0x800B8BDC`.
The code exists, but no retail menu/controller path was proved; call these compiled
debug/control features with unknown reachability, not accessible cheats. [evidence: disassembly]

Strings and table records for `Day`, `Day Fog`, `Night`, `Night Fog`, `Morning`, and
`Morning Fog` exist at ROM `0xC5560..0xC5593` and `0xAB5D8..0xAB677`, but their
consumer is unresolved. They are possible environment-mode names only. [evidence: ROM bytes, hypothesis]

### 3.8 Cameras and paths

#### Vehicles

The vehicle catalog at ROM 0xACCC0 has 33 records of 0x3C bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | name | Name pointer. |
| 0x04 | 0x28 | u32[5][2] | romRanges | Five inclusive-start/exclusive-end ROM pairs. |
| 0x2C | 0x10 | u8[] | unknown2C | Fields not decoded here. |

The entries are A/B
versions of Z-Bucket, Desperado, Surf, Superfuzz, Wild Truck, Scimitar, Hysterion,
Warbird, Del Raye, Cockroach, Apollo and Stottlemeyer, followed by Boss 1–5,
Interceptor, Milk Truck, Twisted and Cupra. [evidence: ROM bytes, disassembly]

Runtime loader `0x80045EC4` inflates the first two extents; the final three are
raw. Known fields in the first inflated blob:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x7C | 0x20 | u32[8] | paletteDestinations | Eight palette destination pointers. |
| 0x9C | 0x28 | materialBundle | materials0 | First material bundle. |
| 0xC4 | 0x28 | materialBundle | materials1 | Second material bundle. |
| 0xEC | 4 | u32 | slotCount0 | Redundant first-bundle slot count. |
| 0xF0 | 4 | u32 | slotCount1 | Redundant second-bundle slot count. |
| 0xF4 | 54 × 16 | geometryRecord[] | geometry | Geometry records. |

Geometry record, 16 bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 4 | u32 | geometry | GeometryMeta pointer. |
| 0x04 | 12 | u32[3] | zero04 | Zero words. |

All 33 files reuse
the map/scenery vertex and face topology; slots 0–41 partition body faces by their
material byte, while slots 42–53 are special submeshes and two pointer pairs are
intentional duplicates. [evidence: disassembly, deterministic decoding]

Vehicle faces are not drop-in map faces. None of the 1,716 unique geometry records
has a separate UV array. Their face tail replaces map UVs:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x10 | 16 | u8[] | cornerAttributes | Packed per-corner attributes; exact UV/lighting meaning unresolved. |

The first material bundle
has 42, 46, 47 or 48 slots; the second has four. Their setup/palette tables are null,
so some render state is resident/shared rather than self-contained. [evidence: deterministic decoding, open question]

The second zlib extent is only concatenated raw texture data. Code at `0x80045C70`
copies successive slices to the first blob's unique texture-DL targets; for every
vehicle the sum of `2 * (G_LOADBLOCK.lrs + 1)` exactly equals the inflated extent
(13,704–39,048 bytes). The final three extents are each exactly 0x100 bytes and
provide three selectable variants of eight 16-entry RGBA16 palettes. Destination
pointers may alias, so preserve the eight DMA copies in order. [evidence: disassembly, deterministic decoding]

No keyframe/channel table exists in either zlib extent. Vehicle motion, wheel
placement and state changes are runtime transforms. Expose these records, if
desired, as a standalone 33-model catalog with palette variants 0–2; do not invent
per-course placements. A static preview is medium difficulty, while exact packed
corner attributes and special-submesh transforms are high/optional. [evidence: deterministic decoding, viewer design]

#### Other map arrays

The following layouts validate across every map. Their gameplay labels are strong
hypotheses inherited from spatial appearance and the historical viewer: [evidence: deterministic decoding, hypothesis]

Map header references:

| Array | Count offset | Pointer offset | Record stride |
|---|---:|---:|---:|
| Tilt lines | 0x10C | 0x108 | 0x2C |
| Coin groups | 0x3B0 | 0x3C4 | 0x38 |
| Unresolved placement groups | 0x3B4 | 0x3C8 | Unknown |
| Booster groups | 0x3B8 | 0x3D0 | 0x38 |

Tilt-line known fields:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x08 | 12 | f32[3] | endpoint0 | First endpoint. |
| 0x14 | 12 | f32[3] | endpoint1 | Second endpoint. |

Coin-group known fields; 108 groups and 494 points:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x00 | 1 | u8 | pointCount | Point count. |
| 0x0C | 12 | f32[3] | bounds0 | First bound. |
| 0x18 | 12 | f32[3] | bounds1 | Second bound. |
| 0x24 | 4 | u32 | points | Pointer to 0x10-byte point records. |

Booster-group known fields; 50 groups and 1,340 lines:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| 0x03 | 1 | u8 | lineCount | Line count. |
| 0x30 | 4 | u32 | endpoints0 | Pointer to first f32 XYZ endpoint array. |
| 0x34 | 4 | u32 | endpoints1 | Pointer to second f32 XYZ endpoint array. |

All float positions use `*32` to reach mesh units. Paths/coins/boosters should be
markers or separate toggleable layers, not unlayered geometry. [viewer design]

#### Spatial atmosphere map

The environment block is embedded in the primary map: [evidence: ROM bytes, disassembly]

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x334` | `0x30` | `Vec3f[4]` | `worldQuad` | World-space sampling quad. |
| `0x364` | `0x30` | `Vec3f[4]` | `mapQuad` | Byte-map coordinate quad. |
| `0x394` | 4 | `u32` | `mapOffset` | Byte-map offset. |
| `0x398` | 4 | `u32` | `width` | Map width. |
| `0x39C` | 4 | `u32` | `height` | Map height. |
| `0x3A0` | 4 | `u8[4]` | `color` | Red, green, blue, and `0xFF`. |

Routine `0x8001B040` (“Calc fog table”) projects/intersects the current view with
the two quads, interpolates 256 samples from the one-byte map, scales them by global
`fogBaseLevel` (`0x800A85B8`, initialized to `0xFFFF`), and writes a 256-byte ramp
at view context `+0x1318`; RGB is copied to `+0x141C` and final intensity to
`+0x141F`. On a failed/disabled calculation it writes a zero ramp. [evidence: disassembly]

This is a camera-dependent spatial atmosphere overlay, not verified ordinary
linear depth fog. Draw paths do set `G_SETFOGCOLOR`, but neither the ROM nor any
inflated map contains F3DEX2 `gSPFogPosition` (`DB080000`), and the code has no
generator for it. A first viewer can preserve sky/clear modulation and expose the
map as a diagnostic texture; exact visual reproduction requires porting this
screen/view projection rather than inventing near/far fog. [evidence: ROM bytes, disassembly, viewer design]

| internal map | byte map | RGB | value range |
|---|---|---|---|
| Test Track | 128×128 | 20,37,77 | 46–255 |
| Space Race | 1×1 | 112,112,112 | 255 |
| Retro Metro | 128×64 | 255,244,255 | 151–253 |
| Wild West | 1×1 | 112,112,112 | 255 |
| Planet X | 128×128 | 103,70,149 | 188–255 |
| Tacky Tiki | 128×128 | 160,247,230 | 41–255 |
| Toys | 1×1 | 112,112,112 | 255 |
| CarnEvil | 128×64 | 39,19,40 | 163–246 |
| Soda Fountain | 32×32 constant | 255,255,255 | 242 |
| Haunted House | 128×128 | 42,38,63 | 74–255 |
| Kingdom O Karnage | 128×64 | 56,47,91 | 17–255 |
| Four Player 1 | 128×128 | 73,73,31 | 171–233 |
| Four Player 2 | 1×1 | 112,112,112 | 255 |

The four 1×1 maps (byte value 255) are verified uniform placeholders. The other
eight maps have
structured masks; Soda Fountain is spatially constant but uses value `0xF2`.
[evidence: deterministic decoding]

#### Projection and camera

Projection builder `0x8001EF04` passes camera `+0x68` times
`114.591552734375` to the libultra perspective function at
`0x80099130`. Initialization derives `+0x68` from `+0x64 =
0.7766715288162231`, yielding approximately **89.0° vertical FOV**. Aspect is
viewport width/height times video-mode config `+0x14`; near is 32; far is the
caller view-distance value times 32. [evidence: disassembly, ROM bytes]

The per-view far source and authored starting eye/target remain open. Until traced,
an implementation should frame bounds with the verified FOV/near and explicitly
mark the camera placement as viewer-derived. [evidence: open question, viewer design]

## 4. Objects

### 4.1 Placement records

The primary-map header at `+0x324/+0x328` gives the scenery-record pointer
and count. Its 179 records across thirteen maps are 0x28 bytes each; their
geometry, root transform, and animation fields are specified under *Map-resident
scenery*. The separately stored 33 vehicle records form a model catalog, not
per-course placements. [evidence: deterministic decoding]

### 4.2 Object and model formats

Scenery uses the same `GeometryMeta`, face, and material layouts as track meshes.
Its root transform can attach recursive child nodes; the current static decode
establishes base translation but not every transform component. Vehicle model
records reuse `GeometryMeta` with a distinct packed per-corner face tail, so
they must not be rendered through the track-mesh UV path. The two catalog-omitted
plane models below share the standalone geometry format. [evidence: ROM bytes,
deterministic decoding]

#### Two strong omitted model assets

The strongest unused candidates immediately precede the model catalog whose first
entry is ROM `0x914EE0`: [evidence: ROM bytes, deterministic decoding]

- `0x9147D0`, container `0x3E2 → 0x12D0`: valid model geometry at inflated `+0x48`,
  11 vertices, six faces, 12 UVs, one color; a flat 500×500 plane using a 32×128 IA8
  alpha strip.
- `0x914BC0`, container `0x31A → 0x1180`: valid model geometry, four vertices and
  one 65×75 quad, using a 64×48 IA8 image with mip levels.

Neither address appears as an aligned absolute word anywhere in the ROM, while the
next physical file is the model catalog's first pointer. Their flat geometry and IA
alpha are consistent with shadow/decal planes [hypothesis]. What is verified is narrower:
two structurally valid model-format assets omitted from the adjacent catalog.

### 4.3 Skeletons and animation

No bone/skinning format was established for track or sky geometry. All 179
scenery records have at least one 0x20-byte animation header (995 total);
`+0x14/+0x18` in a scenery record select that header array and count. The
retail program caches the header whose transform matches the root. Keyframe
channels, rotation/scale terms, and interpolation remain unresolved, so static
placement should not be described as complete animation support. [evidence:
disassembly, deterministic decoding]

### 4.4 Behaviors, triggers, and scripted objects

The map contains tilt-line, probable coin-group, probable booster-group, and
unresolved placement-group arrays; their known coordinates and pointers are
specified under *Other map arrays*. Their game behavior is not proved by the
static record shapes. The dormant fourth path-file channel has no files in
this ROM. [evidence: deterministic decoding, hypothesis]

## 5. Audio

### 5.1 Audio storage and banks

The contiguous audio allocation at `0x92DDC0–0xBCD31C` contains 85 SFX
resources, three complete sample banks with sparse overlays, three instrument
maps, fourteen metadata objects, and fourteen packed pattern payloads. The
resident tables beginning at ROM `0xBE3F0`, plus `0xC39E0`, locate these resources;
the table addresses and bank extents are given below. [evidence: ROM bytes,
disassembly, deterministic decoding]

### 5.2 Sequence format and driver

#### Driver and tables

This is a custom six-channel XM-like tracker, not Nintendo sequence data, MusyX,
libmus or libmus64. `0x800550C8` initializes it; `0x80055040` requests a 21,998 Hz
AI rate, with a separate lower-quality 10,999 Hz path at `0x80055084`.
`0x80056B14` starts game audio, selects bank mode 0, loads SFX IDs 60–144, and
starts song 7. [evidence: disassembly]

| purpose | runtime | ROM | contents |
|---|---:|---:|---|
| sample bank pairs | `800BD7F0` | `0BE3F0` | 3 overlay/base offset pairs |
| instrument maps | `800BD808` | `0BE408` | 3 offsets |
| song metadata | `800BD814` | `0BE414` | 14 offsets |
| song payloads | `800BD84C` | `0BE44C` | 14 offsets |
| SFX extents | `800BD8B0` | `0BE4B0` | 85 start/end pairs, IDs 60–144 |
| race choices | `800C2DE0` | `0C39E0` | 13 rows of six song IDs, six bank IDs, and count |

Every pointer, count, payload boundary, pattern reference and cell in these tables
was validated by the table-driven analyzer. The owned audio allocation is nearly contiguous
from `0x92DDC0` through `0xBCD31C` (2,749,788 bytes, 2.622 MiB), with 161 bytes of
alignment gaps. [evidence: ROM bytes, deterministic decoding]

#### Race music palettes and player design

The 13 rows at `0xC39E0` provide up to six ordered `(song, bankMode)` choices. All 18
combinations of race songs 0–5 and modes 0–2 occur; duplicates deliberately affect
random weighting. The complete rows follow. [evidence: disassembly, deterministic decoding]

| internal map | ordered authored choices (`song/bank`) |
|---|---|
| Test Track | 0/0, 1/1, 2/1, 3/1, 4/1 |
| Space Race | 0/1, 1/1, 2/1, 3/1, 4/1, 0/1 |
| Retro Metro | 0/1, 1/2, 2/2, 3/2, 5/1 |
| Wild West | 1/2, 2/2, 3/2, 4/2, 5/2 |
| Planet X | 0/1, 1/1, 2/1, 3/1, 4/1, 5/1 |
| Tacky Tiki | 0/0, 2/0, 3/0, 4/0, 5/0 |
| Toys | 0/2, 1/2, 2/2, 4/2, 5/2 |
| CarnEvil | 0/0, 1/0, 3/2, 4/2, 5/2 |
| Soda Fountain | 0/0, 2/0, 3/0, 4/0 |
| Haunted House | 0/2, 1/0, 3/0, 4/2, 5/0 |
| Kingdom O Karnage | 1/0, 2/2, 5/2 |
| Four Player 1 | 0/0, 1/0, 2/2, 3/0, 4/2, 5/2 |
| Four Player 2 | 0/1, 1/1, 2/2, 3/0, 4/2, 5/2 |

The level loader can attach the row for its internal map and choose one authored pair.
The global player has no palette sub-selector, so a complete straightforward mapping
is to expose separate `Race Music N — Palette M` entries for all 18 used race variants,
then expose slots 6–13 with their code-proven/default palette and document that some
post-race cues retain the preceding race palette. An alternative is to enumerate the
full 14×3 structural cross-product, but that would present combinations not proven
reachable. [viewer design]

Render at least the intro plus two loop passes. Record the output-sample position on
first entry to `restartOrder`; return that as `DecodedMusic.loopStart`, with the end
of the second pass as `loopEnd`. Cap to ten voices for exact stealing. [viewer design]

#### Sound effects

The separate 85-entry table assigns IDs 60–144. Sorted extents exactly tile
`0x92DDC0–0xA7E330`. A resource has a 128-byte predictor book before encoded data at
`start+0x84`; extents may include trailing alignment. No authored names were found.
SFX are not hidden music/stingers and need not be exposed in the music player.
[evidence: ROM bytes, disassembly, deterministic decoding]

### 5.3 Instruments and sample encoding

Each bank mode has 11 instrument note maps of 96 sample-slot bytes. The base
bank is loaded before its sparse overlay; an overlay record with flag `0x80`
retains the base slot. Sample records carry a 128-byte VADPCM predictor book
at `+0x14` and 9-byte frames yielding 16 PCM samples. The bank extents and
sample-record fields are specified under *Audio sample storage*. No separate
music sample codec was identified. [evidence: disassembly, deterministic decoding]

### 5.4 Music catalog and loop points

#### Complete song list and loops

The ROM contains no authored song titles or sound test. Credits name Zack Ohren, so
the player must use code-proven roles and numeric labels rather than invented titles.
[evidence: ROM bytes]

All 14 songs loop. At a pattern end, `0x80054984..0x800549A4` advances the order and,
at `orderCount`, jumps to `restartOrder`. No stored Bxx/Dxx control-flow command is
used. Thus the exact loop is orders `[restartOrder, orderCount)`; earlier orders are
a one-time intro. [evidence: disassembly, deterministic decoding]

| slot | defensible label | metadata | payload | orders / restart | intro rows | loop rows |
|---:|---|---:|---|---:|---:|---:|
| 0 | Race Music 0 | `BB3E30` | `BBA110–BBBF67` | 42 / 1 | 128 | 4928 |
| 1 | Race Music 1 | `BB4540` | `BBBF70–BBDD19` | 43 / 1 | 128 | 5024 |
| 2 | Race Music 2 | `BB4C50` | `BBDD20–BBFCAA` | 32 / 0 | 0 | 3776 |
| 3 | Race Music 3 | `BB5360` | `BBFCB0–BC1C6D` | 30 / 1 | 128 | 3392 |
| 4 | Race Music 4 | `BB5A70` | `BC1C70–BC4223` | 39 / 1 | 128 | 4544 |
| 5 | Race Music 5 | `BB6180` | `BC4230–BC68D3` | 37 / 1 | 128 | 4352 |
| 6 | Special race state 17 | `BB6890` | `BC68E0–BC73A5` | 16 / 0 | 0 | 1696 |
| 7 | Startup / default menu | `BB6FA0` | `BC73B0–BC7FA4` | 13 / 1 | 128 | 1280 |
| 8 | First-place / winner cue | `BB76B0` | `BC7FB0–BC8D70` | 13 / 1 | 128 | 1280 |
| 9 | Middle-placement cue | `BB7DC0` | `BC8D70–BC9B6D` | 13 / 1 | 128 | 1280 |
| 10 | Last-place cue | `BB84D0` | `BC9B70–BCA880` | 13 / 1 | 128 | 1280 |
| 11 | Menu / return cue | `BB8BE0` | `BCA880–BCBECC` | 24 / 1 | 128 | 2624 |
| 12 | Opponents / racer-profile screen | `BB92F0` | `BCBED0–BCC8E0` | 13 / 1 | 128 | 1280 |
| 13 | Staff / credits screen | `BB9A00` | `BCC8E0–BCD31C` | 13 / 1 | 128 | 1280 |

Authored effects are note/pitch/pan/volume plus `01/02` pitch slides (song 10), `08`
pan, `0F` speed/tempo and `10` global volume (songs 6/12). Unused effect handlers need
not be implemented for these ROM tracks. The mixer is stereo, has ten voice slots,
and permits overlapping/releasing voices beyond the six pattern channels.
[evidence: disassembly, deterministic decoding]

Song 6 is selected with bank 1 when the race-state byte `+0x88` equals 17; its semantic
name is unresolved. Slots 8/9/10 are selected by finishing position. Slot 12 is tied
to the `OPPONENTS` racer-profile formatter; slot 13 is tied to the `MIDWAY STAFF` /
`THE END` presentation. These are code/text associations, not embedded titles.
[evidence: disassembly, ROM bytes]

## 6. Unused and hidden content

### 6.1 Unreferenced assets

An aligned exact-word scan finds no direct ROM-start reference for 99 of 324
containers outside the map and vehicle catalogs. This is only a bounded
negative result: relative addressing and computed/range loaders can still
reach them. The run `0xD9340–0xDD034` contains biographies, dialogue, menu
text, and credits, illustrating that caveat. The strongest model-format
candidates are the two IA-alpha planes at `0x9147D0` and `0x914BC0`, neither
listed in the adjacent model catalog. Their interpretation as shadows or decals
remains a hypothesis. [evidence: ROM bytes, deterministic decoding]

### 6.2 Cut or inaccessible levels

No extra map archive was established. The thirteen table entries are all valid,
tile the map-bundle span without gaps, and cover the public selector's eleven
courses plus two unique multiplayer environments. Internal `Test Track` is
public `Nautical Adventure`; `No Track` and `Stunt Bowl` both select Four
Player 1. This is not evidence of a hidden fourteenth map. [evidence: ROM
bytes, deterministic decoding]

### 6.3 Debug features

The compiled command dispatcher can adjust `fogBaseLevel` and sky oscillation,
as described under *Compiled environment controls*. No retail menu/controller
path to those cases was established. The `Day`, `Night`, and `Morning` strings
and records are present, but their consumer is unknown; do not present them as
verified selectable environment modes. [evidence: ROM bytes, disassembly]

### 6.4 Prototype or revision-specific content

No prototype ROM or second retail revision was available for comparison. The
fourth path-file channel is structurally present but empty in all thirteen
maps; by itself it does not establish cut content. [evidence: ROM bytes]

## 7. nviewer implementation

### 7.1 Module mapping

#### Public names and viewer list

Fourteen public label pointers begin at ROM `0xC1788`; strings begin at `0xC824C`.
The corresponding internal IDs are the 14 words at `0xC1F24`: [evidence: ROM bytes]

| public ID | public label | internal ID / name |
|---:|---|---|
| 0 | Soda Mountain | 8 / Soda Fountain |
| 1 | Giant Toys | 6 / Toys |
| 2 | Medieval Mayhem | 10 / Kingdom O Karnage |
| 3 | Wild West Ruckus | 3 / Wild West |
| 4 | House of Horrors | 9 / Haunted House |
| 5 | Creepy Carnie | 7 / CarnEvil |
| 6 | Tacky Tiki | 5 / Tacky Tiki |
| 7 | Nautical Adventure | 0 / Test Track |
| 8 | Retro Metro | 2 / Retro Metro |
| 9 | Planet X | 4 / Planet X |
| 10 | Space Race | 1 / Space Race |
| 11 | No Track | 11 / Four Player 1 |
| 12 | Stunt Bowl | 11 / Four Player 1 |
| 13 | Halfpipe | 12 / Four Player 2 |

`No Track` is a UI sentinel rather than a separate archive [hypothesis]. The viewer
exposes 13 unique physical environments in public order, omitting the duplicate:
the eleven named courses followed by Stunt Bowl and Halfpipe. Internal IDs remain
available in level diagnostics. [evidence: nviewer source]

#### Mapping onto `src/rom/`

Implemented loader modules and remaining extensions: [evidence: nviewer source]

| file | responsibility | status |
|---|---|---|
| `src/rom/stuntracer64/fs.ts` | Fixed catalogs, chunked-zlib, bundle/table bounds | Implemented |
| `src/rom/stuntracer64/material.ts` | Material display lists, TMEM loads, texture and palette decode | Implemented; runtime combiner tint and distant mip selection unresolved |
| `src/rom/stuntracer64/geometry.ts` | Geometry metadata, mesh origins, faces and vertex colors | Implemented |
| `src/rom/stuntracer64/collision.ts` | Collision meshes | Implemented |
| `src/rom/stuntracer64/scenery.ts` | Static scenery roots and skydomes | Implemented; child transforms and animation unresolved |
| `src/rom/stuntracer64/paths.ts` | Paths and placement diagnostics | Implemented; hidden by default |
| `src/rom/stuntracer64/music.ts` | Banks, note maps, pattern decoder, tracker mixer | Implemented; no reference PCM comparison |
| `src/rom/stuntracer64/stuntracer64.ts` | Public level list, assembly, bounds, layers, music choices | Implemented |
| Vehicle and spatial-atmosphere extensions | Vehicle variants, exact camera-projected atmosphere | Not implemented |

Shared `src/rom/inflate.ts` performs RFC-1950 decompression; the outer block walker
is game-specific. Existing texture and VADPCM primitives are reused, while the
tracker mixer is game-specific. The viewer draws the textured skydome and retains
ROM clear colors; it does not emulate the spatial atmosphere compositor.
[evidence: nviewer source]

Every drawn instance is layered: [evidence: nviewer source]

- `background`: skydome;
- `main`: grouped track meshes;
- `objects`: all 179 map-resident scenery roots as applicable;
- `collision`: all collision sections, hidden by default;
- `diagnostics`: paths, tilt lines, coin/booster and unresolved placement groups,
  hidden by default but independently toggleable.

Unreferenced mesh assets are not silently instantiated. The vehicle catalog,
animation hierarchy, and exact spatial-atmosphere compositor remain future work.

The format supports direct random access and does not benefit materially from a
persistent cache in the initial implementation: inflate only the selected primary map
and its referenced secondaries. A per-load memo of repeated material display lists is
enough. [viewer design]

### 7.2 Supported features

The viewer loads all 13 unique physical environments from the map and file tables,
including track meshes, skydomes, static scenery roots, hidden collision, and
toggleable path/placement diagnostics. The music box exposes 26 choices: the
18 authored race-song/palette pairs and eight other song slots. All 14 source
tracker streams decode. [evidence: nviewer source and bounded load checks]

### 7.3 Approximations and omissions

Scenery animation and children, vehicle corner attributes, distant mip selection,
runtime combiner tint, authored camera positions, and the camera-projected
atmosphere effect remain unresolved or absent. Static course data establishes
asset extents and topology, but no in-race emulator frame has validated final
compositing. The viewer does not substitute guessed linear-distance fog.
[evidence: nviewer source, emulator observation]

## 8. Verification and remaining work

### 8.1 Verification evidence

Verified from ROM bytes and bounded structural decoders: all 2,211 strict
chunked-zlib containers; 13 complete map bundles; 1,808 secondary-file records;
all 713 track meshes, 355 collision files, 1,726 material slots, and 33 vehicle
records. Every referenced asset extent, geometry index, and texture load was
checked against its containing file. The 14 music payloads decode to their
declared sizes; all pattern references/cells, three bank modes, and 85 SFX
extents were checked against their tables.

Disassembly establishes the linked-image address mapping, catalog consumers,
decompressor, sky/environment call chain, tracker timing, and order/restart
logic. GLideN64 with RSP-HLE rendered the legal/title screen, but did not reach
gameplay. The emulation observation therefore does not validate course views,
camera placement, atmosphere, or in-race audio. Those claims retain the ROM-byte
and code evidence stated at their respective sections.

### 8.2 Known unknowns

#### Open questions

- Resolve face words `+0/+2` and bytes `+5..+7` beyond their verified non-padding
  status.
- Finish recursive scenery rotation/scale and animation channel/keyframe semantics.
- Decode vehicle packed per-corner attributes, resident render state and special-
  submesh runtime transforms.
- Name the two directly referenced standalone-model catalogs before exposing them.
- Name the auxiliary/path families and the placement group at map `+0x3B4/+0x3C8`.
- Determine exact gameplay meanings of collision face trailing words and link
  traversal.
- Trace authored starting camera eye/target and per-view far distance.
- Port the camera-projected atmosphere ramp exactly; do not substitute arbitrary
  linear depth fog.
- Establish retail reachability of the environment command cases and identify the
  Day/Night/Morning table consumer.
- Identify the two omitted IA-plane model assets, and only then decide whether to
  expose them as unplaced/debug models.
- Give song 6's game-state-17 association a semantic name if later dynamic evidence
  supports one.
- Obtain in-race runtime or hardware captures for final course/environment comparison.

### 8.3 References

- [Chunked-zlib container and reference codec](compression/chunked-zlib.md).
- [Boss pattern LZ/RLE and reference codec](compression/boss-pattern.md).
- [Historical Stunt Racer 64 ROM viewer source](https://github.com/hack64-net/rotm/tree/9b84d3b5e13fb9795896850ad8e2c53bb34afb4e/stunt_racer_64), used as a documented lead; the claims above were checked against the retail ROM and executable.
