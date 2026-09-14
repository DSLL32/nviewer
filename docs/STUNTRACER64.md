# Stunt Racer 64 (N64, US): ROM format specification for the level viewer

This document specifies the US retail ROM well enough to add its environments,
objects and music to nviewer. It covers ROM identity and layout, compression, the
complete course catalog, map geometry and materials, scenery and collision,
skydomes and atmospheric maps, the custom music engine, implementation boundaries,
verification, open questions, and unused/hidden content.

Evidence labels used throughout:

- **[V-ROM]**: checked directly against bytes or decoded structures in the supplied
  ROM.
- **[V-ASM]**: checked in the retail MIPS code.
- **[V-TOOL]**: reproduced by a bounded research tool across the stated complete
  dataset.
- **[V-EMU]**: observed in the emulator. This investigation verified boot/title
  rendering but no gameplay frame; see §12.2.
- **[UPSTREAM]**: found in Hack64's 2020 exact-game viewer and independently audited
  where combined with a verified label.
- **[HYP]**: plausible interpretation not proved by the available evidence.
- **[OPEN]**: an implementation or research question deliberately left unresolved.
- **[V-REPO]**: checked against the current nviewer source tree.
- **[DESIGN]**: recommended viewer behavior rather than a claim about the ROM.
- **[PROCESS]**: research-process observation or reusable workflow guidance.

ROM offsets are into the normalized big-endian `.z64`. Runtime addresses are KSEG0.
Unless explicitly qualified, all numeric fields are big-endian.

Research material is under `/home/n64/.ai-tmp/r49/stuntracer64/`:

| path | contents |
|---|---|
| `fs` | ROM identification, resident-code disassembly, compression and catalogs |
| `levels` | complete map/material/collision/scenery audit and generated summaries |
| `audio` | music/SFX tables, sequence decoder, banks and player notes |
| `env_unused` | sky, atmosphere, projection, unused-content audit and decoded sheets |
| `emulator` | two failed renderer attempts, one GLideN64 title-render session, and cleanup evidence |
| `upstream-rotm` | shallow sparse copy of the historical Hack64 viewer |

## 0. At a glance

| topic | result |
|---|---|
| ROM | 12 MiB big-endian US revision 0, game code `NR3E`, CIC-6102 |
| program | one resident initialized image, ROM `0x1000–0xCB250`, mapped by `RAM = ROM + 0x7FFFF400`; no executable overlays identified |
| storage | Boss chunked-zlib container: independent RFC 1950/DEFLATE streams producing at most 16,000 bytes each; 2,211 strict containers indexed |
| courses | 13 physical map archives; 14 public selector labels because `No Track` and `Stunt Bowl` both map to archive 11 |
| map data | primary pointer-rich map blob plus eight tables containing 1,808 exact secondary archives |
| geometry | 713 track mesh files, 76,011 vertices, 49,290 faces; 179 map-resident scenery objects; 33 named vehicles and 33 separately cataloged shared models |
| textures | material-indexed Gfx setup/load/TLUT lists; CI4, CI8, RGBA16, IA8 and one I4 material; exact payload size comes from `G_LOADBLOCK`, not `G_SETTILESIZE` |
| collision | 355 files, 66,497 vertices, 77,146 triangles, with validated cross-section adjacency records |
| environment | a real textured skydome plus a separate camera-projected spatial atmosphere map; nominal 89° vertical FOV and near plane 32 |
| music | custom six-channel packed tracker, 14 slots at 21,998 Hz, three instrument/sample palettes, exact order/restart loops |
| implementation | easy storage/catalogs; medium geometry/material TMEM path; medium scenery; medium-high animation and exact spatial-atmosphere reproduction; custom music player required |
| runtime evidence | GLideN64/HLE renders the legal/title screen; course/environment/camera claims remain static-only |
| unused/hidden | no orphan course; two strong catalog-omitted model-format IA-alpha planes; dormant path channel; compiled fog/sky controls of unproved retail reachability |

## 1. ROM identification and versions

### 1.1 Verified image

| field | value |
|---|---|
| byte order / size | `.z64` / `0xC00000` (12,582,912 bytes, 12 MiB) |
| MD5 | `e8b666a429fedb2a1a1228cd450cd4fc` |
| SHA-1 | `8570fa1f3e4cf7e62dc49da181353e4f301503b7` |
| SHA-256 | `d3b01e935aec87819bb053d2881ec59e7c4c66ed2843df144dab618e2bc3fd8c` |
| PI word / clock / entry | `80371240` / `0000000F` / `80000400` |
| release word | `00001449` |
| CRC1 / CRC2 | `9510D8D7` / `35100DD2` |
| internal title | `Stunt Racer 64` |
| game code / revision | `NR3E` / `0` |
| IPL3 | CRC32 `90BB6CB5`, MD5 `e24dd796b2fa16511521139d28c8356b`, CIC-NUS-6102 |

**[V-ROM]** All values above were read from the supplied image. The IPL3
fingerprint and header checksum pair identify the normal CIC-6102 build.

Detection should normalize `.z64`, `.v64`, and `.n64` byte order, require `NR3E`
at header offset `0x3B`, and accept revision byte 0. The fixed map-table structure
at `0xBBDA0` (§4) is a useful patched-ROM sanity check. **[V-ROM/DESIGN]**

### 1.2 Version scope

Only the US `NR3E` revision-0 image was supplied and audited. No regional or later
retail address set is claimed. A future image with a different game code or revision
must be table-located and structurally revalidated rather than assumed compatible.
**[V-ROM/OPEN]**

The credits data contains the literal `$September 2, 2000` at ROM `0xD1990`.
This is a shipped data string, not proof of a linker or source-build timestamp.
**[V-ROM]**

## 2. Boot and resident code

The initialized linked image begins at ROM `0x1000`, runtime `0x80000400`, with:

```text
runtime = ROM + 0x7FFFF400
ROM     = runtime - 0x7FFFF400
```

Startup clears `0x438E0` bytes from `0x800CA650` through `0x8010DF2F`, sets SP to
`0x800CAE50`, and jumps to `0x800021B4`. The initialized code/data image ends at ROM
`0xCB250` (size `0xCA250`); separate resource data starts there. **[V-ROM/V-ASM]**

No executable overlay table or overlay relocation path was identified. All observed
asset loaders are called by the resident program. This is strong negative static
evidence, not proof that no runtime-generated code could exist. **[V-ASM]**

The renderer transforms geometry through custom RSP microcode. Glide64mk2 rejects
ucode CRC `844B55B5`; GLideN64 with the same RSP-HLE stack can render the legal/title
screen, but this investigation did not reach an in-race frame that exercises the
course renderer. This does not affect an nviewer loader, which reads source geometry
structures directly. **[V-EMU/V-ROM]**

## 3. Filesystem and compression

### 3.1 Chunked-zlib container

General compressed assets use zlib 1.0.4; the linked image contains Mark Adler's
`inflate 1.0.4` identification at ROM `0xBE010`. Retail routine `0x80001BF0`
implements this outer format: **[V-ROM/V-ASM]**

```text
+0x00 u32 sourceSize       # complete outer container, including this header
+0x04 u32 destinationSize  # concatenated uncompressed byte count
+0x08 repeat until sourceSize bytes have been consumed:
      u32 blockCompressedSize
      u8  zlibStream[blockCompressedSize]
      pad stream end to 2-byte alignment
```

Each stream is independent. Every non-final block expands to exactly 16,000
(`0x3E80`) bytes; the final block produces the remainder. The runtime alternates two
16,000-byte staging buffers. **[V-ASM/V-TOOL]**

A single strict scan found 2,211 distinct, non-overlapping containers. Their stored
extents total `0x760F78` bytes and inflate to `0x1212D31` bytes. Of these, 2,198 use
zlib header `78 DA`; 13 use `78 9C`. A `78 DA`-only extractor therefore silently
misses valid files. The strict scanner validates outer bounds, every zlib checksum,
block output limits, and total output size. **[V-TOOL]**

No second general level-geometry codec was identified. Raw texture/palette and audio
pools coexist with the zlib containers, so absence of zlib framing does not imply
padding. **[V-ROM/V-ASM]**

### 3.2 Map bundles

Thirteen complete map bundles tile ROM `0x1775C0–0x7B36D0` without a gap. Each begins
with its primary map container. Retail loader `0x800494E0` computes the secondary
asset base as:

```text
secondaryBase = bundleStart + align2(primary.sourceSize)
```

All current sizes are already even, but the aligned expression is the actual format
contract. The old Hack64 viewer used `bundleStart + sourceSize` and marked it
uncertain; it happens to work for this image. **[V-ROM/V-ASM/UPSTREAM]**

Eight file tables inside each inflated primary map contain 12-byte records:

```text
+0x00 u32 packedStartRelativeToSecondaryBase
+0x04 u32 packedEndRelativeToSecondaryBase
+0x08 u32 metadataOffsetInInflatedPrimaryMap
```

All 1,808 table records resolve in the bundle, begin at a strict zlib container, and
end exactly at its declared `sourceSize`. Runtime fixup `0x80046DA8` adds the
secondary base to the first two words. No signature scan is needed at load time.
**[V-ASM/V-TOOL]**

Some bundles place a raw high-entropy prefix between the primary map and the first
table-listed file. These are map-resident image/palette resources addressed by
display-list pointers, not filesystem holes. **[V-ROM/V-ASM]**

### 3.3 Other catalogs and ROM tail

The 33-entry vehicle catalog is at ROM `0xACCC0`, stride `0x3C`; §7 describes it.
A 27-entry raw lookup table at `0xA8300` selects five 256-byte resources from
`0x7BABB0–0x7BB0B0` or small fallback indices. Its consumer suggests palettes,
but that name remains a hypothesis. **[V-ROM/V-ASM/HYP]**

After removing the map primary files, 1,808 map subfiles, and 66 vehicle containers,
324 strict containers remain. Most are reached through additional master arrays;
their bounded reachability audit is in §11. The ROM remains nonzero through
`0xBCD31A`, then has `0x32CE5` zero bytes to the 12 MiB boundary. **[V-TOOL/V-ROM]**

## 4. Complete course catalog

### 4.1 Internal map table

The internal table is at ROM `0xBBDA0`, runtime `0x800BB1A0`, with 13 records of
`0x5C` bytes. Code at `0x800495E8` selects `index * 0x5C` and calls loader
`0x800494E0`. Important fields are: **[V-ROM/V-ASM]**

| record offset | meaning |
|---:|---|
| `+0x00` | linked internal-name pointer |
| `+0x14/+0x18` | complete bundle ROM start/end |
| `+0x1C` | map flag; exact meaning unresolved |
| `+0x20..+0x28` | environment/render values; exact roles unresolved |

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
**[V-TOOL]**

### 4.2 Public names and viewer list

Fourteen public label pointers begin at ROM `0xC1788`; strings begin at `0xC824C`.
The corresponding internal IDs are the 14 words at `0xC1F24`: **[V-ROM]**

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

`No Track` is a UI sentinel rather than a separate archive **[HYP]**. The viewer
should expose 13 unique physical environments, preferably in public order while
omitting the duplicate: the eleven named courses followed by Stunt Bowl and
Halfpipe. It should retain internal IDs in diagnostics. **[DESIGN]**

## 5. Primary map format and grouping

Pointers in the inflated primary map are offsets from that blob's start. Its first
word is the exact inflated size in all 13 maps. Viewer-relevant header fields are:
**[V-ROM/V-ASM/V-TOOL]**

| offset | contents |
|---:|---|
| `00C` | skydome `GeometryMeta` |
| `048/04C/050/054/058` | collision file pointers/count, group pointers/count, file table |
| `05C/060/064/068/06C` | track-mesh equivalent |
| `074/078/07C/080/08C` | auxiliary/path-like equivalent |
| `090..100` | five further path-file descriptors |
| `108/10C` | tilt-line array/count |
| `11C..140` | material-table bundle |
| `144/148/14C` | parallel material setup/image/TLUT pointer arrays used by renderer |
| `324/328` | scenery-object array/count |
| `334..3A3` | spatial atmosphere/environment data |
| `3B0/3C4` | probable coin-group count/pointer |
| `3B4/3C8` | unresolved placement-group count/pointer |
| `3B8/3D0` | probable booster-group count/pointer |

Each group header is `{u32 memberCount; u32 u16MemberIndicesPtr}`. Mesh, collision,
and auxiliary descriptors have three groups: group 0 enumerates every file once;
groups 1 and 2 are empty. Some path descriptors repeat members in all three groups,
so a loader must honor actual groups instead of assuming only group 0. **[V-TOOL]**

Across all maps the eight secondary tables contain: **[V-TOOL]**

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

## 6. Geometry, materials and collision

### 6.1 Track meshes

A mesh secondary record's metadata offset points to: **[V-TOOL]**

```text
+00 u32 unknown/pointer
+04 u32 unknown/pointer
+08 u32 GeometryMeta
+0C s32 originX     # signed 20.11 fixed point; divide by 2048
+10 s32 originY
+14 s32 originZ
+18..24 unknown
```

The decoded origin is added to local vertices. `GeometryMeta` is shared by track,
scenery, and sky geometry:

```text
+00 u32 vertices      +04 u32 vertexCount    # 3*s16, stride 6
+08 u32 faces         +0C u32 faceCount      # stride 0x20
+10 u32 texcoords     +14 u32 texcoordCount  # 2*s16, stride 4
+18 u32 colors        +1C u32 colorCount     # RGBA8888, stride 4
```

Faces are:

```text
+00 u16 unknown00
+02 u16 unknown02
+04 u8  materialIndex
+05 u8  unknown05
+06 u8  unknown06
+07 u8  unknown07
+08 s16 vertex[4]
+10 s16 texcoord[4]
+18 s16 color[4]
```

`vertex[3] == -1` is a triangle; otherwise emit `(0,1,2)` and `(0,2,3)`.
`+5..+7` are not padding: 11,033 of 49,290 track faces use a nonzero value.
Their meaning, and the exact `+0/+2` visibility flags, remain open. All scenery and
sky faces have `+5..+7 == 0`. **[V-TOOL/OPEN]**

The 713 mesh files total 76,011 vertices and 49,290 source faces: 3,215 triangles
and 46,075 quads. Every vertex, UV, color, and material index is valid. UV components
are signed s10.5 texel coordinates divided by 32 **[HYP, strong]**; this matches
their value ranges and N64 convention. Native track position is local `s16` plus
20.11 origin. Collision and scenery floats use the same scale after multiplication
by 32. The historical viewer displays this frame as `(-x,z,y)`; axis conversion is a
viewer convention, not a stored field. **[V-TOOL/UPSTREAM]**

### 6.2 Material bundle and texture loads

Header `+0x11C` points to a 0x28-byte bundle relocated by retail routine
`0x800476A0`: **[V-ROM/V-ASM]**

```text
+00 setupDlByMaterial[N]
+04 textureLoadDlByMaterial[N]
+08 paletteLoadDlByMaterial[N]
+0C N
+10 uniqueSetupDlPtrs       +14 count
+18 uniqueTextureLoadDlPtrs +1C count
+20 uniquePaletteLoadDlPtrs +24 count
```

For face material `i`, execute the three parallel lists. Setup lists contain RDP
other modes, combine/color state, and one to six `G_SETTILE`/
`G_SETTILESIZE` pairs. Image lists contain `G_SETTIMG`, sync and `G_LOADBLOCK`;
palette lists use `G_SETTIMG`/`G_LOADTLUT` or end immediately for direct color.
Accurate rendering must preserve wrap/clamp, masks, shifts, mip tiles, combine,
primitive/environment colors, alpha and depth state. **[V-ROM/V-ASM]**

All 1,726 material slots load with the conventional raw-transfer `G_SETTIMG`
RGBA16/width-1 setup. Exact source storage is therefore: **[V-TOOL]**

```text
payloadOffset = G_SETTIMG.address
payloadBytes  = 2 * (G_LOADBLOCK.lrs + 1)
```

Never infer payload size from `G_SETTILESIZE`: that command describes sampling,
not storage. In 170 materials its rectangle exceeds the loaded base payload because
of wrap/shift/mip setup. This is expected and is the main correctness trap in this
format. Palette color count is `((G_LOADTLUT.word1 >> 14) & 0x3FF) + 1`.
**[V-TOOL]**

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
be reused after material-local TMEM reconstruction. **[V-TOOL/DESIGN]**

### 6.3 Skydome geometry

Map `+0x00C` uses the same `GeometryMeta` and face/material lookup. Across all maps
it has 989 vertices and 1,222 source faces. The construction/draw call chain proves
that it is a camera-relative backdrop, not unknown ordinary geometry (§8.1). Put it
in a separate `background` layer or `Level.skies`, never in the main track batch.
**[V-ASM/V-TOOL/DESIGN]**

### 6.4 Collision

Collision secondary metadata is: **[V-TOOL]**

```text
+00 faces       +04 faceCount       # stride 0x0A
+08 vertices    +0C vertexCount     # stride 0x14
+10 links       +14 linkCount       # stride 0x0C
+18 fourthPtr   +1C fourthCount     # zero in every file
```

A face is `{s16 vertex[3]; u16 unknown06; u16 unknown08}`. A vertex begins with
three `f32` positions followed by `u32/u16/u16` unknown fields. The trailing face
words have thousands of values, so calling them surface flags is unjustified.
**[V-TOOL/OPEN]**

Each link contains three `(s16 sectionIndex, s16 faceIndex)` pairs. Across 355 files
and 40,644 links, every pair is either `(-1,-1)` or targets a real section and an
in-range face. These are adjacency/connectivity references **[HYP, strong]**;
traversal semantics are not required to draw collision.

Totals are 66,497 collision vertices and 77,146 triangles, all index-valid. Draw
them in a hidden-by-default `collision` layer. **[V-TOOL/DESIGN]**

## 7. Objects, placement and paths

### 7.1 Map-resident scenery

Each primary-map scenery record is 0x28 bytes: **[V-ASM/V-TOOL]**

```text
+00 GeometryMeta
+04/+08/+0C unknown
+10 root transform node
+14 animation-header array
+18 animation-header count
+1C scalar/flags, unresolved
+20 runtime root-animation cache
+24 optional pointer (zero in all 179 ROM records)
```

The root node starts with `f32 x,y,z` translation. Base placement is local s16
vertex plus `translation * 32`. Relocation routine `0x80038940` proves recursive
child pointers at node `+0x28` with count `+0x2C`, plus another array of 8-byte
records at `+0x30/+0x34`. Intermediate transform fields may encode rotation/scale
but are unresolved. **[V-ASM/OPEN]**

All 179 scenery objects have at least one 0x20-byte animation header, 995 total.
Pointer fields are `+0x14/+0x18/+0x1C`; `+0x00` is count-like and event code changes
flag bits at `+0x10`. Routine `0x8004899C` caches the header whose `+0x18` transform
matches the root. Base geometry and translation are enough for an initial viewer;
keyframe/channel interpolation is a separate medium-high task. **[V-ASM/DESIGN]**

### 7.2 Vehicles

The vehicle catalog at ROM `0xACCC0` has 33 records of 0x3C bytes. `+0x00` is a
name pointer and `+0x04..+0x2B` holds five ROM start/end pairs. The entries are A/B
versions of Z-Bucket, Desperado, Surf, Superfuzz, Wild Truck, Scimitar, Hysterion,
Warbird, Del Raye, Cockroach, Apollo and Stottlemeyer, followed by Boss 1–5,
Interceptor, Milk Truck, Twisted and Cupra. **[V-ROM/V-ASM]**

Runtime loader `0x80045EC4` inflates the first two extents; the final three are
raw. The first inflated blob contains eight palette destinations at `+0x7C..+0x98`,
material bundles at `+0x9C` and `+0xC4`, their redundant slot counts at
`+0xEC/+0xF0`, and 54 sixteen-byte geometry records at `+0xF4`. Each geometry
record is a `GeometryMeta` pointer followed by three zero words. All 33 files reuse
the map/scenery vertex and face topology; slots 0–41 partition body faces by their
material byte, while slots 42–53 are special submeshes and two pointer pairs are
intentional duplicates. **[V-ASM/V-TOOL]**

Vehicle faces are not drop-in map faces. None of the 1,716 unique geometry records
has a separate UV array; face bytes `+0x10..+0x1F` instead hold packed per-corner
attributes whose exact UV/lighting meaning is unresolved. The first material bundle
has 42, 46, 47 or 48 slots; the second has four. Their setup/palette tables are null,
so some render state is resident/shared rather than self-contained. **[V-TOOL/OPEN]**

The second zlib extent is only concatenated raw texture data. Code at `0x80045C70`
copies successive slices to the first blob's unique texture-DL targets; for every
vehicle the sum of `2 * (G_LOADBLOCK.lrs + 1)` exactly equals the inflated extent
(13,704–39,048 bytes). The final three extents are each exactly 0x100 bytes and
provide three selectable variants of eight 16-entry RGBA16 palettes. Destination
pointers may alias, so preserve the eight DMA copies in order. **[V-ASM/V-TOOL]**

No keyframe/channel table exists in either zlib extent. Vehicle motion, wheel
placement and state changes are runtime transforms. Expose these records, if
desired, as a standalone 33-model catalog with palette variants 0–2; do not invent
per-course placements. A static preview is medium difficulty, while exact packed
corner attributes and special-submesh transforms are high/optional. **[V-TOOL/DESIGN]**

### 7.3 Separately cataloged shared models

Exactly 33 of the directly referenced non-map/non-vehicle containers validate as
standalone `GeometryMeta` model containers. Pointer table `0xC2204` has 30 entries
and 20 unique files (ten repeats); table `0xC2280` has 13 entries and 13 unique
files. They are consumed by routines `0x80073908` and `0x8007407C`, respectively,
but their gameplay names remain unresolved. **[V-ROM/V-ASM/V-TOOL]**

These models are not missing course scenery: all 179 scenery records and their
geometry/material pointers are wholly contained in their primary maps. Keep the 33
models out of course views; they may become a separate named catalog after their
semantics are identified. **[V-TOOL/DESIGN]**

### 7.4 Other map arrays

The following layouts validate across every map. Their gameplay labels are strong
hypotheses inherited from spatial appearance and the historical viewer: **[V-TOOL/HYP]**

- Tilt lines: count/pointer `+0x10C/+0x108`, stride `0x2C`, float endpoints at
  `+0x08/+0x14`.
- Coin groups: count/pointer `+0x3B0/+0x3C4`, stride `0x38`; `u8` point count at
  `+0x00`, float bounds at `+0x0C/+0x18`, and 0x10-byte point records via `+0x24`.
  Totals: 108 groups, 494 points.
- Booster groups: count/pointer `+0x3B8/+0x3D0`, stride `0x38`; `u8` line count at
  `+0x03`, paired float endpoint arrays at `+0x30/+0x34`. Totals: 50 groups,
  1,340 lines.
- Header `+0x3B4/+0x3C8` describes an unresolved placement group in every map.

All float positions use `*32` to reach mesh units. Paths/coins/boosters should be
markers or separate toggleable layers, not unlayered geometry. **[DESIGN]**

## 8. Environment, sky and camera

### 8.1 Sky construction and drawing

Retail code proves the backdrop role: main view code calls “Calc sky” at
`0x8001E080`, `0x80034DF0` transforms the map `+0x00C` geometry camera-relatively,
main calls “Draw sky” at `0x8001E764`, and
`0x80037870 → 0x80037898 → 0x800376A0` emits its materials and faces.
Immediately before drawing, `0x800378D0..0x80037920` sets primitive RGB from the
map environment color and alpha to `255 - view[0x141F]`. **[V-ASM]**

Sky faces use the same material pointer arrays at map `+0x144/+0x148/+0x14C`.
The common dome has six adjacent 64×32 CI8/256-color panels plus two 1×1 materials.
Space Race, Retro Metro and Four Player 2 use ten panels. Toys uses 42 distinct
64×32 CI8 panels and three palettes. Four Player 1 instead uses one 1×1 RGBA16
material. All 143 referenced sky images decode within bounds. **[V-TOOL]**

There are no normals in this geometry. The sky uses stored RGBA vertex colors,
textures and primitive-color modulation, not an N64 light structure. Treat it as
prelit/unlit. **[V-ROM/V-ASM]**

### 8.2 Spatial atmosphere map

The environment block is embedded in the primary map: **[V-ROM/V-ASM]**

```text
+334 Vec3f[4] world-space sampling quad
+364 Vec3f[4] byte-map coordinate quad
+394 u32      byte-map offset
+398 u32      width
+39C u32      height
+3A0 u8       red, green, blue, 0xFF
```

Routine `0x8001B040` (“Calc fog table”) projects/intersects the current view with
the two quads, interpolates 256 samples from the one-byte map, scales them by global
`fogBaseLevel` (`0x800A85B8`, initialized to `0xFFFF`), and writes a 256-byte ramp
at view context `+0x1318`; RGB is copied to `+0x141C` and final intensity to
`+0x141F`. On a failed/disabled calculation it writes a zero ramp. **[V-ASM]**

This is a camera-dependent spatial atmosphere overlay, not verified ordinary
linear depth fog. Draw paths do set `G_SETFOGCOLOR`, but neither the ROM nor any
inflated map contains F3DEX2 `gSPFogPosition` (`DB080000`), and the code has no
generator for it. A first viewer can preserve sky/clear modulation and expose the
map as a diagnostic texture; exact visual reproduction requires porting this
screen/view projection rather than inventing near/far fog. **[V-ROM/V-ASM/DESIGN]**

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
**[V-TOOL]**

### 8.3 Projection and camera

Projection builder `0x8001EF04` passes camera `+0x68` times
`114.591552734375` to the libultra perspective function at
`0x80099130`. Initialization derives `+0x68` from `+0x64 =
0.7766715288162231`, yielding approximately **89.0° vertical FOV**. Aspect is
viewport width/height times video-mode config `+0x14`; near is 32; far is the
caller view-distance value times 32. **[V-ASM/V-ROM]**

The per-view far source and authored starting eye/target remain open. Until traced,
an implementation should frame bounds with the verified FOV/near and explicitly
mark the camera placement as viewer-derived. **[OPEN/DESIGN]**

## 9. Music and sound

### 9.1 Driver and tables

This is a custom six-channel XM-like tracker, not Nintendo sequence data, MusyX,
libmus or libmus64. `0x800550C8` initializes it; `0x80055040` requests a 21,998 Hz
AI rate, with a separate lower-quality 10,999 Hz path at `0x80055084`.
`0x80056B14` starts game audio, selects bank mode 0, loads SFX IDs 60–144, and
starts song 7. **[V-ASM]**

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
alignment gaps. **[V-ROM/V-TOOL]**

### 9.2 Sample palettes and codec

There are three complete sample/instrument palettes. Runtime loads a base bank then a
sparse overlay; overlay flag `0x80` means retain that base slot and supplies no sample.
The first 33 overlay records are placeholders. **[V-ASM/V-TOOL]**

| mode | base ROM / records | overlay ROM / records | effective slots | instrument map |
|---:|---|---|---:|---|
| 0 | `A7E330–AB60C2` / 33 | `B1DB50–B4D506` / 54 (33 placeholders) | 54 | `BB31A0–BB35C4` |
| 1 | `AB60D0–AEE3A8` / 33 | `B4D510–B84740` / 56 (33 placeholders) | 56 | `BB35D0–BB39F4` |
| 2 | `AEE3B0–B1DB50` / 33 | `B84740–BB3194` / 55 (33 placeholders) | 55 | `BB3A00–BB3E24` |

Each instrument map is `u32 count` plus `count` 96-byte note maps; all have 11
instruments. `(instrument-1)*96 + note-1` selects a sample slot. **[V-ASM/V-TOOL]**

Normal sample records have a 0x94-byte header. `+0x04` is decoded PCM bytes (rounded
to 32); `+0x0C` is initial pan; `+0x10/+0x11` are base-note/fine-tune; `+0x12` is
default volume; `+0x14..+0x93` is the 128-byte predictor book. Flag bit 0 would add
a 0x400-byte auxiliary table, but no music sample sets it. Encoded audio is standard
N64 4-bit VADPCM: 9 bytes produce 16 samples, and stored bytes are
`round_even((decodedBytes >> 5) * 9)`. **[V-ASM/V-TOOL]**

Existing `decodeVadpcm` and `RESAMPLE_LUT` from `src/rom/music/libultra.ts` are useful;
the sequencing/bank layer must be new. **[V-REPO/DESIGN]**

### 9.3 Song and pattern formats

Every song metadata object is exactly `0x710` bytes: **[V-ROM/V-ASM/V-TOOL]**

```text
+000 u16 orderCount
+002 u16 restartOrder
+004 u16 channels       # always 6
+006 u16 patternCount
+008 u16 initialSpeed   # always 2
+00A u16 initialTempo   # always 130
+00C u8  order[256]
+110 u32 patternOffsets[256]  # relative to decoded pattern base
+510 u16 patternRows[256]
```

A pattern payload starts with `u32 rawSize, u32 packedSize`, then Boss's custom
LZ/RLE stream. The decoder consumes MSB-first 16-bit controls: 0 is a literal; 1 is
either a 12-bit backward distance plus `(lowNibble+3)` copy length, or, with zero
distance, `(next12+16)` repeats of the following byte. Leading `0x80` means an
uncompressed remainder. All 14 payloads decode to their exact sizes. **[V-ASM/V-TOOL]**

Cells use XM packed-cell syntax: note, instrument, volume, effect, parameter. If bit
7 of the first byte is set, bits 0–4 select which fields follow; otherwise all five
are present. The loader subtracts `0x10` from the volume column. Tick duration follows
the tracker rule `sampleRate * 5 / (2 * tempo)` samples; speed is ticks per row.
**[V-ASM]**

### 9.4 Complete song list and loops

The ROM contains no authored song titles or sound test. Credits name Zack Ohren, so
the player must use code-proven roles and numeric labels rather than invented titles.
**[V-ROM]**

All 14 songs loop. At a pattern end, `0x80054984..0x800549A4` advances the order and,
at `orderCount`, jumps to `restartOrder`. No stored Bxx/Dxx control-flow command is
used. Thus the exact loop is orders `[restartOrder, orderCount)`; earlier orders are
a one-time intro. **[V-ASM/V-TOOL]**

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
**[V-ASM/V-TOOL]**

Song 6 is selected with bank 1 when the race-state byte `+0x88` equals 17; its semantic
name is unresolved. Slots 8/9/10 are selected by finishing position. Slot 12 is tied
to the `OPPONENTS` racer-profile formatter; slot 13 is tied to the `MIDWAY STAFF` /
`THE END` presentation. These are code/text associations, not embedded titles.
**[V-ASM/V-ROM]**

### 9.5 Race music palettes and player design

The 13 rows at `0xC39E0` provide up to six ordered `(song, bankMode)` choices. All 18
combinations of race songs 0–5 and modes 0–2 occur; duplicates deliberately affect
random weighting. Exact rows are in `audio/race_music.tsv`. **[V-ASM/V-TOOL]**

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
reachable. **[DESIGN]**

Render at least the intro plus two loop passes. Record the output-sample position on
first entry to `restartOrder`; return that as `DecodedMusic.loopStart`, with the end
of the second pass as `loopEnd`. Cap to ten voices for exact stealing. **[DESIGN]**

### 9.6 Sound effects

The separate 85-entry table assigns IDs 60–144. Sorted extents exactly tile
`0x92DDC0–0xA7E330`. A resource has a 128-byte predictor book before encoded data at
`start+0x84`; extents may include trailing alignment. No authored names were found.
SFX are not hidden music/stingers and need not be exposed in the music player.
**[V-ROM/V-ASM/V-TOOL]**

## 10. Mapping onto `src/rom/`

Recommended loader layout: **[DESIGN]**

| file | responsibility | difficulty |
|---|---|---|
| `src/rom/stuntracer64/fs.ts` | ROM ID, fixed catalogs, chunked-zlib, bundle/table bounds | low |
| `src/rom/stuntracer64/material.ts` | three DL tables, TMEM loads, TLUT/direct texture decode and render state | medium |
| `src/rom/stuntracer64/geometry.ts` | GeometryMeta, mesh origins, face triangulation and vertex colors | low–medium |
| `src/rom/stuntracer64/collision.ts` | collision meshes and optional link diagnostics | low |
| `src/rom/stuntracer64/objects.ts` | base scenery hierarchy and optional animation | medium / medium-high |
| `src/rom/stuntracer64/vehicles.ts` | optional car catalog, packed texels, palette variants and specialized corner decode | medium / high for exact rendering |
| `src/rom/stuntracer64/environment.ts` | skydome and spatial atmosphere projection | medium / high for exact overlay |
| `src/rom/stuntracer64/music.ts` | banks, note maps, pattern decoder, tracker scheduler/mixer | medium-high |
| `src/rom/stuntracer64/stuntracer64.ts` | public level list, assembly, bounds, layers, music choices | low |

Shared `src/rom/inflate.ts` can perform RFC-1950 decompression, while the outer block
walker remains game-specific. Existing texture and libultra audio primitives are
reusable; no existing sequence engine matches the tracker. No shared type extension is
required for a first implementation: skydome geometry can use `MeshSky`; atmosphere
can initially be a diagnostic/background approximation unless a new renderer contract
is deliberately added. **[V-REPO/DESIGN]**

Every instance must be layered:

- `background`: skydome;
- `main`: grouped track meshes;
- `objects`: all 179 map-resident scenery roots as applicable;
- `collision`: all collision sections, hidden by default;
- `markers`: paths, tilt lines, coin/booster and unresolved placement groups, with
  visibility on by default but independently toggleable.

Unreferenced mesh assets should go in `unplaced`, not be silently instantiated.
**[DESIGN]**

A sensible staged implementation is:

1. catalogs/decompression, 13 unique public levels, vertex-color track meshes and
   hidden collision;
2. exact material/TMEM decode plus skydome;
3. base scenery roots and diagnostic paths/coins/boosters;
4. custom music player;
5. optional standalone vehicle catalog;
6. optional animation hierarchy and exact spatial-atmosphere compositor.

The format supports direct random access and does not benefit materially from a
persistent cache in the initial implementation: inflate only the selected primary map
and its referenced secondaries. A per-load memo of repeated material display lists is
enough. **[DESIGN]**

## 11. Unused and hidden content

This section follows the completed core spec as required. “Unreferenced” below is
always scoped to the stated test; absence of an absolute pointer alone is not proof
of runtime impossibility.

### 11.1 No orphan course

All 13 internal records resolve to valid, non-overlapping bundles, and those bundles
exactly tile `0x1775C0–0x7B36D0`. The public selector accounts for all 13 archives.
No extra map record or map-like bundle was established. Internal `Test Track` is public
`Nautical Adventure`, not unused content. **[V-ROM/V-TOOL]**

The header retains a complete fourth path-file channel, but its count is zero in all
13 maps. This is a dormant format path, not evidence that path data was cut.
**[V-TOOL]**

### 11.2 Bounded uncataloged-container audit

Of the 324 zlib containers left after the map and vehicle catalogs, 225 have their
exact ROM start stored as an aligned word, mainly in master arrays around `0xC1DA0`,
`0xC1EA0`, `0xC2204`, `0xC2280`, `0xC2454`, `0xC2630`, and `0xC2920`. They are
cataloged even though all higher-level table names are not yet known. **[V-TOOL]**
Thirty-three are the standalone models documented in §7.3.

Ninety-nine have no such absolute-start reference. They occur in nine physical runs.
The first, `0xD9340–0xDD034`, contains obviously live-looking biographies, dialogue,
menu text and credits, demonstrating why absence of a literal pointer cannot prove
unused status. Other candidate runs are recorded in `env_unused/orphan_audit.json`.
**[V-ROM/V-TOOL]**

### 11.3 Two strong omitted model assets

The strongest unused candidates immediately precede the model catalog whose first
entry is ROM `0x914EE0`: **[V-ROM/V-TOOL]**

- `0x9147D0`, container `0x3E2 → 0x12D0`: valid model geometry at inflated `+0x48`,
  11 vertices, six faces, 12 UVs, one color; a flat 500×500 plane using a 32×128 IA8
  alpha strip.
- `0x914BC0`, container `0x31A → 0x1180`: valid model geometry, four vertices and
  one 65×75 quad, using a 64×48 IA8 image with mip levels.

Neither address appears as an aligned absolute word anywhere in the ROM, while the
next physical file is the model catalog's first pointer. Their flat geometry and IA
alpha are consistent with shadow/decal planes **[HYP]**. What is verified is narrower:
two structurally valid model-format assets omitted from the adjacent catalog.

### 11.4 Compiled environment controls

Command cases `0x8000CC64..0x8000CD3C` set, decrement, increment, or byte-set
`fogBaseLevel`, clamp it, and print `fogBaseLevel = %d`. Case `0x8000BECC` controls
an oscillating sky transform through globals `0x800B8BD0..0x800B8BDC`.
The code exists, but no retail menu/controller path was proved; call these compiled
debug/control features with unknown reachability, not accessible cheats. **[V-ASM]**

Strings and table records for `Day`, `Day Fog`, `Night`, `Night Fog`, `Morning`, and
`Morning Fog` exist at ROM `0xC5560..0xC5593` and `0xAB5D8..0xAB677`, but their
consumer is unresolved. They are possible environment-mode names only. **[V-ROM/HYP]**

## 12. Verification evidence and open questions

### 12.1 Reproducible evidence

| artifact | coverage |
|---|---|
| `fs/analyze.py`, `fs/index.json` | strict codec scan, all map/subfile/car catalogs and bounds |
| `fs/main.dis` | complete initialized resident image disassembly |
| `levels/analyze.py`, `levels/summary.json` | all 13 maps, 1,808 secondary entries, 58,940 render faces, 1,726 materials, collision links and placements |
| `levels/analyze_vehicles.py`, `levels/vehicles.json` | all 33 vehicles, both compressed extents, 99 raw palette extents, geometry and exact texture-copy totals |
| `levels/audit_direct_catalogs.py`, `levels/direct_catalogs.json` | one aligned reference pass over 324 outside containers and structural classification of 225 referenced files |
| `env_unused/extract_env.py` | all environment/skydome fields and hashes |
| `env_unused/sky_images.py` | all 143 sky material images and all fog byte maps |
| `env_unused/audit_orphans.py` | bounded uncataloged-container reference audit |
| `audio/analyze_audio.py` | 14 songs, three bank modes, 85 SFX, patterns/cells/effects/loops |
| `emulator/gliden64_1/NOTES.md`, `selected/title.png` | exact GLideN64/HLE launch and boot/title frame; explicit non-validation of gameplay claims |

Generated JSON/TSV output is authoritative where the prose omits long per-asset
tables. Re-running the environment and orphan tools produced byte-identical outputs;
all specialist analyzers completed with bounds/index invariants intact.
**[V-TOOL]**

### 12.2 Emulator evidence and limitation

The first fresh session booted far enough for Glide64mk2 to reject custom graphics
ucode CRC `844B55B5`; it produced no screenshot. A second fresh session using the
installed z64 video and CXD4 RSP LLE plugins exited immediately before logging or
drawing. Neither was retried in-place. Both run directories contain exact commands and
cleanup notes. **[V-EMU]**

A third, separately authorized fresh session used GLideN64 and retained RSP-HLE.
The equivalent current setting is
`M64P_GFX_PLUGIN="$PWD/emu/install/lib/mupen64plus/mupen64plus-video-GLideN64.so"`.
GLideN64
rev.41c7ba27 rendered a correct 320×240 legal/title frame after startup black. A
second frame about 105 seconds later was byte-identical. The preserved frame is
`emulator/gliden64_1/selected/title.png`, SHA-256
`1aa960682208b325a0411f83f94f34c84f36a17c808469024c5a068fc360118e`.
**[V-EMU]**

The game did not advance in this bounded run: two START submissions drained, but
`input.status` remained `idle polls=0`, no menu/race frame appeared, and mupen64plus
used roughly one CPU core. The exact launch, config, timestamps, hashes and shutdown
audit are preserved in `emulator/gliden64_1/NOTES.md`. Thus this verifies boot/title
rendering only; it does **not** dynamically validate public course ordering/names,
skydomes, atmosphere, camera, FOV, RAM map loads or audio. Those claims remain based
on retail bytes, code and exhaustive decoded-structure checks. **[V-EMU/OPEN]**

### 12.3 Open questions

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

### 12.4 Process audit

Static work stayed inside this research directory and the nviewer repository was not
modified. The exact-game Hack64 viewer was cloned once, shallow and sparse, and used
only as a lead; retail code corrected its `78 DA`-only extraction, uncertain secondary
base, material interpretation and white-wireframe sky. **[V-TOOL]**

One process inefficiency was caught: the first audio exploration materialized 5,255
overlapping/duplicate zlib candidates. It was stopped, the 39 MiB candidate trees were
deleted by their owner, none of their results entered this spec, and the final analyzer
was rebuilt around the actual audio tables. This should be standardized as a rule:
magic scans may generate an in-memory index, but must not emit one file per candidate
unless a catalog/table has validated ownership. **[V-TOOL/PROCESS]**

Two further process failures were found after an earlier clean-process report. Root
terminated PIDs `2456194/2456215`, a recursive `grep -RIn` pipeline over this research
tree that had run for more than twelve minutes with output truncated through
`head -100`. Root also terminated PIDs `2392438/2392441`, alive for 41m46s, whose
Stunt-specific compression query recursively scanned all of `r49` and the nviewer
repository before `head -200`. The latter was expressly outside the bounded search
scope; its exact originating agent could not be reconstructed after termination, but
the query terms establish this investigation's provenance. **[PROCESS]**

These invalidate the earlier hygiene claim and show that a broad recursive search
plus a truncating pipe is not self-limiting. Future audits should query bounded file
lists with `rg`, sample first when appropriate, and inspect process ancestry and exact
arguments across the workspace/scratch scope before declaring cleanup complete.
**[PROCESS]**

At most one Stunt Racer emulator session was live at a time. Each attempt used a fresh
child/run directory and was cleaned before the next. The later GLideN64 validation was
also one launch in a fresh child/run directory; it stopped the scoped PID normally and
removed its waiting input helper. After all children finished, the final audit
inspected user-owned process arguments and ancestry, not only paths containing the
game name. No Stunt Racer emulator, helper, analyzer or search process remained.
**[PROCESS]**
