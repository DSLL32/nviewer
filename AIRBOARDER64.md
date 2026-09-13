# Air Boarder 64 (Nintendo 64, Japan and PAL): ROM formats for nviewer

This document specifies the two retail versions of *Air Boarder 64* sufficiently to add their courses and soundtrack to nviewer. It covers ROM identification, boot and overlays, the archive and compression codec, every course and setup, visible geometry, textures, collision, environment, course objects, music, regional differences, implementation design, verification, open questions, and a separate unused/hidden-content audit.

Evidence labels:

- **[V-ROM]** verified directly from the ROM bytes or structurally decoded data.
- **[V-ASM]** verified from correctly bounded resident/overlay MIPS disassembly.
- **[V-RAM]** verified in the running Japanese game; the session/artifact is named.
- **[V-FRAME]** verified from a captured emulator frame; the session/artifact is named.
- **[V-TOOL]** verified by a reproducible investigation tool or render.
- **[EXTERNAL]** title/release context from a cited external source, not relied on for binary-format claims.
- **[HYPOTHESIS]** a supported interpretation not established by the available evidence.
- **[OPEN]** unresolved.

All research artifacts are under `/home/n64/.ai-tmp/r49/airboarder64/`:

| Directory | Contents |
|---|---|
| `fs/`, `shared/` | ROM maps, bounded disassemblies, archive manifests, extractor and LH5 decoder |
| `levels/` | course/header/placement catalogs, geometry/texture/collision decoders, OBJ/PNG exports and structural renders |
| `environment/` | environment/render-state decoder and bounded draw-path disassembly |
| `music/` | audio analyzer, machine-readable catalogs, old-libmus reuse proof and eight audition WAVs |
| `hidden/` | archive/reference audits and unused-content evidence |
| `emulator/session{1,2}/` | failed-launch provenance and successful runtime captures/RAM evidence |

Offsets are hexadecimal byte offsets into a normalized big-endian `.z64` ROM unless explicitly called RAM/VROM. Ranges are half-open `[start,end)`. Multi-byte values are big-endian. Japanese is the primary build; `P` means the PAL/European build.

## 0. At a glance

| Topic | Result |
|---|---|
| ROMs | 8 MiB, codes `NABJ` and `NABP`, revision byte 0, CIC-6102; Japanese and PAL retail builds are supported |
| code | resident image plus ten raw code/data overlays; overlay 2 front end, overlay 3 common gameplay, overlays 4–9 one per course |
| archive | 76 J / 77 P records `{storedSize, relativeOffset}`; P inserts one localized file at ID 3 |
| compression | big-endian decoded size followed by headerless LH5-family data: 8 KiB dictionary, block/static Huffman, 509 character/length symbols |
| courses | Tutorial/Lecture plus Green Park, Lost Forest, Snow Festival '64, Sunset Island and Giant House; Giant House has three simultaneous connected areas |
| geometry | grid-binned old F3DLX 1.21 display lists, standard 16-byte vertices, Y-up identity scale; two geometry passes |
| textures | CI8 texels with RGBA5551 TLUTs, 162 resolved specifications, dimensions from 16x16 through 128x16 |
| collision | grid-binned 20-byte quad/plane records using a packed s16 XYZ bank; eight course/area meshes fully decoded |
| setups | three static setup slots for Street Work, Time Attack and Coin; all 75 descriptor selections decoded. Two-player aliases Time/Coin data |
| objects | 24-byte transformed disk-marker records and 10-byte view-facing animated star-coin records; board/rider assets are separate player equipment |
| environment | fog color doubles as viewport clear; one ambient and one directional light; no separate sky resource/pass; 65° default FOV, near 10, per-course far clip |
| music | eight raw old-libmus songs, one 303-wave VADPCM bank, every song referenced and looping; parameterize and reuse `music/libmus64.ts` |
| regional | five normal course payloads and all audio data are identical; menus/shared data and Tutorial differ; PAL uses 50 Hz player timing and 16 voices vs J 60 Hz/24 |
| hidden | strongest candidate is an unreferenced 2,400-sample controller recording; three empty recording-size placeholders; likely stale per-course fog-start fields; no hidden course or song |
| difficulty | archive/environment/collision low; F3DLX geometry/CI8/materials medium; marker/coin objects low-medium; exact material/fog parity medium; old-libmus profile extraction medium |

## 1. ROM identification, names and versions

### 1.1 Exact images [V-ROM]

| Field | Japan | PAL/Europe |
|---|---|---|
| file used | `Airboarder 64 (J) [!].z64` | `Airboarder 64 (E) [!].z64` |
| size | `0x800000` (8 MiB) | same |
| CRC32 | `58FCB771` | `C14D45AC` |
| MD5 | `ccee2fcf38dc2200128d75d15db53283` | `e8891f8f498a615a6cbaf75b7ddc9fa6` |
| SHA-1 | `4a70c9ca027ecc8d05337993204e1ef76f5f0ac9` | `2171fe2c0a9253cba56828f24a5e6153726c1516` |
| SHA-256 | `e3fa6d6f13671237e703f32d01f48aff62071114a7a92086c9e3229d1b943ecc` | `adc68241f2472aa5b4cd71f189f0b04f44d99e4d29776e831feb0ef86e6ceb79` |
| PI word / entry | `80371240` / `80025C00` | same |
| CRC1 / CRC2 | `6C45B60C` / `DCE50E30` | `27C425D0` / `8C2D99C1` |
| internal title | half-width Shift-JIS `ｴｱｰﾎﾞｰﾀﾞｰ64` | `AIR BOARDER 64` |
| cart/country/revision | `AB` / `J` / 0 | `AB` / `P` / 0 |
| IPL3 CRC32 / CIC | `90BB6CB5` / CIC-6102 | same |

Detection after `normalizeByteOrder`: accept cartridge ID bytes `AB` at header `0x3C`, country `J` or `P` at `0x3E`, revision 0 at `0x3F`, then require the structurally valid region-specific archive table (§3). This is safer than trusting a patched title or CRC alone.

Japanese padding begins at `0x76A3D0`; PAL padding begins at `0x763CB0`; the remainder to 8 MiB is `FF`. **[V-ROM]**

### 1.2 Naming and version prospects

The header, linked ASCII token `AIRBOARDER64` (J `0x404F4`, P `0x40BD4`), and retail packaging support both “Air Boarder 64” and “Airboarder 64.” The Japanese title is `エアーボーダー64`. The proposed North American title was *AirBoardin' USA*, but the North American release was cancelled; no `NABE` retail image is known here. This historical alias is **[EXTERNAL]**, supported by the archived 1998 ASCII announcement and release reporting summarized by the [Air Boarder 64 release history](https://en.wikipedia.org/wiki/Air_Boarder_64). It is not a ROM detector.

Both examined ROMs contain `AB64001`, but `0x80029768` uses it as a save signature and writes `?B64001` after invalid/reset state; it is not a build ID. No source path, build timestamp, game-version string or DWARF/debug information was found. The `F3DLX 1.21` strings are RSP microcode versions only. **[V-ROM/V-ASM]**

## 2. Boot and executable layout

IPL3 loads ROM `0x1000` to entry `0x80025C00`; the resident conversion is `RAM = ROM + 0x80024C00`. Startup clears BSS and enters `0x80039BD0`. Do not extend that conversion through later ROM bytes: ten separately linked overlays reuse load addresses. **[V-ASM]**

### 2.1 Japanese executable map [V-ROM/V-ASM]

| Image | VROM | RAM/data end | text end | BSS end | Role |
|---|---:|---:|---:|---:|---|
| resident | `1000–2B0F0` | `80025C00–8004FCF0` | `8004FCF0` | clear continues to `800A1CA0` | boot, system, archive, audio, save |
| overlay 0 | `2B0F0–2D900` | `800A1CA0–800A44B0` | `800A41D0` | `800A4840` | small overlay; precise role open |
| overlay 1 | `2D900–2DF20` | `800A1CA0–800A22C0` | `800A2210` | none | small overlay; precise role open |
| overlay 2 | `2DF20–41510` | `800A1CA0–800B5290` | `800B3840` | `800B74F0` | front end, save/unlocks, rider/board selection |
| overlay 3 | `41510–8B7F0` | `800A1CA0–800EBF80` | `800E4050` | `80127120` | common gameplay, course renderer, collision, placements |
| overlay 4 | `8B7F0–8D230` | `80127120–80128B60` | `80128630` | `80128E70` | Tutorial/Lecture |
| overlay 5 | `8D230–92B90` | `80127120–8012CA80` | `8012B230` | `8012CBD0` | Green Park |
| overlay 6 | `92B90–95190` | `80127120–80129720` | `801283C0` | `80129730` | Lost Forest |
| overlay 7 | `95190–9BFD0` | `80127120–8012DF60` | `8012A700` | `8012E1A0` | Snow Festival '64 |
| overlay 8 | `9BFD0–A2130` | `80127120–8012D280` | `8012B730` | `8012D8B0` | Sunset Island |
| overlay 9 | `A2130–A4750` | `80127120–80129740` | `80128590` | `80129790` | Giant House |

The ten `0x24`-byte descriptors start at J `0x27C34`; resident function `0x80028D18` loads them. PAL uses the same logical images but different bounds (`shared/e_rom_map.tsv`): resident ends `0x2B0A0`, overlay load bases are `0x8009DC50` and `0x80123340`, final overlay ends `0xA5090`. **[V-ASM]**

Common gameplay at J `0x800A1F70` loads stage overlay `course+4`, so legal course IDs 0–5 map directly to overlays 4–9. Overlay 2's preload loops and nearby rider/board/menu strings establish its front-end role; overlay 3 selects the course, board/rider assets, common course data and renderer. **[V-ASM]**

The ROM contains `RSP Gfx ucode F3DLX 1.21 Yoshitaka Yasumoto Nintendo.` at J `0x2A3A0` and `F3DLX.Rej 1.21` at `0x2ABA0` (P `0x2A350` / `0x2AB50`). **[V-ROM]**

## 3. Archive, ROM map and compression

### 3.1 Top-level table [V-ROM/V-ASM]

| Version | Table | Records | Payload base | Payload end |
|---|---:|---:|---:|---:|
| J | `454BF0–454E50` | 76 | `454E50` | `76A3C4` |
| P | `455530–455798` | 77 | `455798` | `763CAE` |

Each eight-byte record is:

```text
u32 storedSize
u32 payloadRelativeOffset
```

Records tile the payload with two-byte alignment:

```text
next.relativeOffset = align2(relativeOffset + storedSize)
ROM start = payloadBase + relativeOffset
```

J `0x80027BD8` reads `table + id*8`; raw accessor `0x80027CA8` returns/copies the extent, while wrapper `0x80027E5C` decodes compressed entries. All record extents are in bounds and contiguous. The complete regional manifests are `fs/j_manifest.csv` and `fs/e_manifest.csv`. **[V-ASM/V-TOOL]**

### 3.2 Resource groups

| J IDs | Storage and established role |
|---|---|
| 0–3 | compressed global/mode assets; fixed loads in overlays 0–2 |
| 4–5 | raw fixed assets |
| 6–21 | sixteen compressed indexed rider/board-related resources; front end preloads all, gameplay selects one |
| 22–37 | sixteen alternate compressed indexed resources |
| 38–49 | twelve raw board resources |
| 50–61 | twelve paired raw presentation resources |
| 62 | raw fixed gameplay asset |
| 63 | likely unused alternate recorded-input stream (§12.1) |
| 64 | used prerecorded input stream |
| 65–67 | zero placeholders |
| 68 | compressed shared course/gameplay asset |
| 69–73 | Green Park, Lost Forest, Snow Festival '64, Sunset Island, Giant House |
| 74 | Tutorial/Lecture |
| 75 | compressed fixed gameplay asset |

Every direct archive call in resident and all ten bounded overlays was inventoried in `shared/j_archive_xrefs.tsv`; computed bases 6, 22, 38 and 50 cover all indexed groups. **[V-TOOL]**

The archive is not the whole post-code ROM. Songs begin at J `0xA4750`, followed by pointer bank `0xB5B00`, wave bank `0xC29A0`, sample payload ending at `0x454BE7`, padding `[0x454BE7,0x454BF0)`, then the archive table. Every meaningful J byte before padding at `0x76A3D0` is assigned to header/boot/code/overlay, linked graphics/audio, archive table/payload or the 12-byte alignment tail `[0x76A3C4,0x76A3D0)`. **[V-ROM/V-ASM]**

### 3.3 Headerless LH5 codec [V-ASM/V-TOOL]

Compressed files are:

```text
u32 decodedSize
LH5-family bitstream, MSB-first
```

There is no magic. Decoder `0x80026A80` reads the size and fills an 8 KiB circular dictionary with spaces (`0x20`); `0x80026B74` decodes blocks:

- `u16` symbol count per block;
- 19-symbol PT Huffman tree, five-bit count, special zero-run index 3;
- 509-symbol character/length Huffman tree, nine-bit count;
- 14-symbol distance tree, four-bit count;
- symbols `<256` are literals; otherwise length is `symbol-253` and distance is the LH5 8 KiB wrapped form.

`fs/extract.py` is a region-aware reference decoder. It exactly terminates at declared sizes for all 44 J and 45 P compressed records. J compressed storage `0x2D2601` expands to `0x71C538`; 32 raw records total `0x42F5C`. No MIO0/Yay0/Yaz0/RNC magic occurs, but the codec identification rests on code and successful decoding rather than the negative magic scan. **[V-TOOL]**

### 3.4 Regional mapping

PAL inserts localized compressed ID 3; J IDs 0–2 map directly to P IDs 0–2, while J `n >= 3` maps to P `n+1`. Of the first three, only J0/P0 and J2/P2 are byte-identical. After decoding:

- normal course packages J69–73 equal P70–74 byte for byte;
- all music sequences/bank/sample payload are identical at a fixed `+0x940` PAL displacement;
- global/UI assets J1/P1, J3/P4, J4/P5, shared gameplay J68/P69, Tutorial J74/P75 and fixed J75/P76 differ;
- the three zero placeholders match;
- despite localized Tutorial payloads, all eight exported collision meshes are identical.

A single loader should use a small region profile for table IDs/offsets, then share every parser. **[V-ROM/V-TOOL]**

## 4. Complete courses and setup list

State base is J `0x8004FE88`; course is signed halfword `+0x20C` (`0x80050094`), setup/level `+0x218`, and mode `+0x21A`. **[V-ASM/V-RAM: session2]**

| ID | Course | J overlay VROM | J archive/header | Grid/context |
|---:|---|---:|---:|---|
| 0 | Tutorial / Lecture | `8B7F0–8D230` | 74 `+35898` | 4x17 |
| 1 | Green Park | `8D230–92B90` | 69 `+08940` | 9x9 |
| 2 | Lost Forest | `92B90–95190` | 70 `+00440` | 9x20 |
| 3 | Snow Festival '64 | `95190–9BFD0` | 71 `+1A850` | 16x13 |
| 4 | Sunset Island | `9BFD0–A2130` | 72 `+0EEC8` | 20x20 |
| 5 | Giant House | `A2130–A4750` | 73 `+02790`, `+5D348`, `+B15B0` | three 8x5 areas |

Each stage overlay's initializer at runtime `0x80127180` contains the fixed course-archive load, so all six are proven live. Course names/order and the menu labels `LECTURE`, `STREET WORK`, `TIME ATTACK`, `COIN`, `FREE RUN` are corroborated by retail screens; session2 directly observed `STREET WORK`, `GREEN PARK`, `LEVEL 1`. **[V-ASM/V-RAM]**

Giant House parses all three headers unconditionally into runtime contexts `0x800EC058`, `0x800F9190` and `0x801062C8`, stride `0xD138`. They share environment values but have different grids/geometry/collision and are connected areas, not difficulty variants. **[V-ASM]**

### 4.1 Mode/setup dispatch [V-ASM/V-TOOL]

Every normal course has three static setup slots for each applicable family. Runtime directly observed only setup value 0 labeled `LEVEL 1`; retail labels/availability for values 1 and 2 remain open. **[V-ASM/V-RAM]**

| Context | mode | family | meaning |
|---|---:|---|---|
| 1P | 1 | A `setup*8` | Street Work markers/checkpoints |
| 1P | 2 | A `0x18 + setup*8` | Time Attack markers/checkpoints |
| 1P | 3 | B `setup*8` | Coin collectibles |
| 2P | 0 | A `0x30 + setup*8` | aliases 1P Time Attack family |
| 2P | 1 | B `0x18 + setup*8` | aliases 1P Coin family |

Lecture/course 0 has its own path. Free Run selects no A/B course placement set in this dispatch. Descriptor `{s16 count; pad; u32 records}` arrays are linked stage-overlay data, so all sets are decoded without RAM extraction.

| Course | Street Work S0/S1/S2 | Time Attack S0/S1/S2 | Coin S0/S1/S2 |
|---|---:|---:|---:|
| Green Park | 3/3/3 | 3/3/3 | 20/26/43 |
| Lost Forest | 5/6/8 | 5/6/8 | 74/89/128 |
| Snow Festival '64 | 4/6/8 | 4/6/8 | 125/125/125 |
| Sunset Island | 4/6/7 | 6/7/8 | 111/116/129 |
| Giant House | 5/6/7 | 4/6/7 | 110/119/114 |

The exact 75 descriptor selections, including aliased selections, and every record are in `levels/course_catalog.json` and `levels/placement_obj/`. Coin counts independently match the retail mode's reported totals, establishing family B's semantics. **[V-ROM/V-TOOL]**

For nviewer, list six base courses and expose mode/setup as selectors or optional object presets; do not duplicate the identical world geometry fifteen times. Giant House's three physical areas belong together.

## 5. Course geometry, materials and textures

### 5.1 Header and spatial grid [V-ASM/V-TOOL]

The source header begins with a `0x2C` environment prefix (§7), followed by:

```text
gridX*gridZ u32 header-relative display-list offsets, pass 0
gridX*gridZ u32 header-relative display-list offsets, pass 1
gridX*gridZ records {s16 minX,minY,minZ,maxX,maxY,maxZ}
u32 header-relative collision vertex-bank offset
gridX*gridZ u32 header-relative collision-cell offsets
4 * 4 u32 header-relative auxiliary/group pointers
gridX*gridZ u32 auxiliary-cell offsets
two final header-relative targets
```

Parser `0x800CECC0` copies scalars, rebases pointers and initializes the grid; traversal/rendering is in `0x800CDDB4` and `0x800D2980`. Pass 0 binds header pointer `+0x24` as F3DLX segment 2; pass 1 binds `+0x28`; both bind texture/palette pointer `+0x20` as segment 3. Grid entries themselves are CPU/header-relative display-list pointers. **[V-ASM]**

### 5.2 Vertices and display lists

Vertices use the standard 16-byte form:

```text
s16 x,y,z; u16 flag; s16 s,t; u8 r,g,b,a
```

Old F3DLX commands used include `04` VTX, `B1` TRI2, `BF` TRI1, `06` DL and `B8` END, plus standard RDP material/texture state. Coordinates are signed world units, Y up, identity scale. Every decoded list terminates in bounds and every triangle references a loaded slot. **[V-ROM/V-TOOL]**

| Course/area | vertex loads | unique XYZ | triangles | XYZ extent |
|---|---:|---:|---:|---|
| Tutorial | 10,454 | 2,595 | 8,818 | `[-1100,1100] [-600,650] [-4351,4350]` |
| Green Park | 5,750 | 2,266 | 5,244 | `[-2250,2250] [-150,658] [-2250,2250]` |
| Lost Forest | 25,029 | 5,996 | 21,202 | `[-2250,2050] [-1023,1500] [-5000,5000]` |
| Snow Festival '64 | 11,505 | 6,428 | 9,985 | `[-4000,4000] [-120,810] [-3250,3250]` |
| Sunset Island | 18,002 | 4,742 | 15,620 | `[-5000,5000] [-100,970] [-5000,5000]` |
| Giant area 0 | 5,820 | 1,936 | 6,038 | `[-1880,0] [0,625] [-340,1250]` |
| Giant area 1 | 4,714 | 1,589 | 4,946 | `[-500,1660] [485,1125] [-425,1100]` |
| Giant area 2 | 3,080 | 1,033 | 3,146 | `[-1880,1660] [0,1125] [-1237,22]` |

`levels/green_park_structural.png`, generated by a thin adapter into nviewer's existing `tools/render/raster.ts`, shows the same rectangular park, central openings, ramps and surrounding terrain as the retail selection/demo imagery. A backface-culling variant remains coherent with counter-clockwise fronts. This is a structural winding/scale check, not a claim of exact camera/material parity. **[V-TOOL]**

### 5.3 Textures/materials

The textured pass uses CI8 texels and RGBA5551 TLUTs from segment 3. Width/height come from `G_SETTILESIZE`; observed dimensions are 16x16, 16x32, 32x16, 32x32, 32x64, 64x8, 64x16, 64x32 and 128x16. All 162 unique texture/TLUT/dimension specifications decode cleanly. `levels/course_textures_sheet.png` visibly resolves grass, snow, pavement, metal, wood, signage and Giant House art, verifying palette/channel order. Raw row 0 is image top. **[V-ROM/V-TOOL]**

Pass 0 is commonly vertex-colored/untextured; pass 1 contains CI/TLUT setup. A production parser must preserve display-list material state, UVs, tile masks/shifts/wrap, culling and blend/depth mode rather than flatten all triangles into one material. Exact state words and fog/light setup are in §7. **[V-ASM]**

## 6. Collision

Collision uses packed `s16 x,y,z` vertices (stride 6) and per-grid-cell lists:

```text
u32 faceCount
face[faceCount] {                 // 20 bytes
  u16 vertexIndex[4]
  s8 normalX, normalY, normalZ; u8 pad
  s32 plane
  u32 flagsOrMaterial
}
```

The same source face can occur in multiple cells; deduplicate the exact 20-byte record before emitting viewer geometry. Runtime routine `0x800C7864` consumes it. **[V-ASM/V-TOOL]**

| Course/area | vertices | unique quads | binned refs |
|---|---:|---:|---:|
| Tutorial | 1,437 | 808 | 1,922 |
| Green Park | 2,484 | 1,789 | 4,053 |
| Lost Forest | 7,486 | 7,347 | 15,942 |
| Snow Festival '64 | 6,044 | 4,500 | 8,597 |
| Sunset Island | 6,322 | 5,875 | 14,689 |
| Giant area 0 | 2,373 | 1,699 | 2,985 |
| Giant area 1 | 2,175 | 1,608 | 2,841 |
| Giant area 2 | 1,450 | 1,086 | 2,412 |

High-Y faces near 10,000 in Green/Snow are valid indexed faces, not parser overruns; boundary/sentinel geometry is their likely purpose. Exported `levels/collision_obj/*.obj` preserves source quads. Emit all collision in a hidden-by-default `collision` layer. **[V-TOOL/HYPOTHESIS]**

## 7. Environment, sky and camera

### 7.1 Environment prefix [V-ASM/V-TOOL]

| Source | Type | Runtime | Meaning |
|---:|---|---:|---|
| `+00,+02` | u16,u16 | `+04,+06` | grid X/Z dimensions |
| `+04` | RGB8 | `+08` | ambient light |
| `+07` | RGB8 | `+0C` | directional light color |
| `+0A` | s8x3 | `+10` | directional-light vector |
| `+0D` | RGB8 | `+14` | fog and viewport clear color |
| `+10,+12` | u16,u16 | `+18,+1A` | 1P far clip / distance split |
| `+14,+16` | u16,u16 | `+1C,+1E` | 2P far clip / distance split |
| `+18,+1A` | u16,u16 | skipped | stale fog-start-like fields (§12.2) |
| `+1C` | u32 | skipped | zero/reserved |
| `+20,+24,+28` | u32 | rebased | texture/vertex/data banks |

| Course | Ambient | Directional | direction | fog/clear | 1P clip/split | 2P clip/split |
|---|---|---|---|---|---:|---:|
| Tutorial | 137,145,153 | 224,220,235 | 5,45,5 | `#50607B` | 3000/1200 | 2000/700 |
| Green Park | 100,100,100 | 255,255,255 | 30,35,30 | `#108CFF` | 5500/1800 | 2200/1300 |
| Lost Forest | 122,122,122 | 239,239,228 | -18,53,25 | `#8C8C94` | 1700/1000 | 1100/600 |
| Snow Festival '64 | 80,80,90 | 210,210,240 | 2,80,2 | `#061940` | 1300/1600 | 900/1100 |
| Sunset Island | 145,78,47 | 224,208,184 | 80,4,68 | `#8C4B1E` | 3000/800 | 1600/500 |
| Giant House | 60,60,70 | 235,230,209 | 20,80,20 | `#3C4146` | 2000/300 | 1000/300 |

Renderer `0x800CF20C` constructs one ambient and one directional `Lights1` block, optionally halving both colors under a visibility/culling branch. Preserve source direction bytes; normalize only at the viewer API boundary if needed. **[V-ASM]**

### 7.2 Clear, fog and sky

The course overlay converts fog RGB to duplicated RGBA5551 and fills its gameplay viewport. The same RGB is emitted as `G_SETFOGCOLOR`. Common static DL J ROM `0x845E0` selects two-cycle mode and hardcodes `gSPFogPosition(996,1000)` (`BC000008 7D008400`) with raw render/combine words `C8113078` and `FC127FFF FFFFF238`. The cell/material path uses state words `00552078` and `FC127E24 FFFFF3F9`, then installs course lighting. **[V-ASM]**

There is no separate sky texture, skydome resource or stage-overlay sky draw pass. Background color is the fog-colored clear; any distant scenery is ordinary course-cell geometry and stays in `main`, not a fabricated `sky` layer. **[V-ASM]** Runtime captures are used only as visual confirmation, not as the basis for this absence claim.

### 7.3 Camera/projection

Normal gameplay FOV is 65°. A mode selected by state `+0x202 == 1` uses 45°. Projection is 4:3, near 10, scale 1, and uses the course's 1P/2P far clip. FOV lives at J `0x8004C830`; projection setup starts `0x800B4324`. **[V-ASM]**

The view path uses a `guLookAtF` equivalent. In the ordinary state, camera base J `0x80113470` contains eye at `+0x24`, target `+0x34`, up `+0x44`; a player-follow branch instead takes eye at `+0x39C`, target from active entity `+0x440`, and up `(0,1,0)`. A Z-axis yaw from camera `+0xBC` is combined with look-at. Session2 RAM confirms the ordinary triplet layout and `(0,1,0)` up. **[V-ASM/V-RAM]**

Session2 measured the following stable initial 1P cameras; each uses up `(0,1,0)` and 65° FOV: **[V-RAM/V-FRAME]**

| Environment | Eye | Target |
|---|---:|---:|
| Tutorial | `(747.881, 18.841, 4207.749)` | `(750, 12, 4170)` |
| Green Park | `(-999.995, 316.274, -1033.936)` | `(-1000, 312, -1000)` |
| Lost Forest | `(-1823.807, 1026.259, -4500)` | `(-1790, 1022, -4500)` |
| Snow Festival '64 | `(1533.807, 16.259, 50)` | `(1500, 12, 50)` |
| Sunset Island | `(2103.807, 86.259, 2450)` | `(2070, 82, 2450)` |
| Giant House | `(36.193, 704.259, 220)` | `(70, 700, 220)` |

Use these as default viewer cameras. If a regional/version variation later needs a fallback, use a decoded start/marker location, 65° vertical FOV, near 10 and the course far clip. Do not invent a static camera field in the course header. **[V-RAM/V-ASM]**

## 8. Course objects and player assets

### 8.1 Family A: transformed disk markers [V-ASM/V-TOOL]

Descriptor points to 24-byte records:

```text
+00 u32 runtime state/visibility (cleared at initialization)
+04 s16 x; +06 s16 y; +08 s16 z
+0A s16 uniform scale numerator, divided by 5.0
+0C 4 bytes not consumed by initializer
+10 f32 orientation parameter A
+14 f32 orientation parameter B
```

`0x800DF650` builds a 64-byte matrix per record; `0x800DF7D0` draws it. Bits `0x100/0x200` distinguish player views. Street Work and Time Attack select these records. The fixed overlay-3 asset is an untextured 18-triangle disk: vertices at J RAM `0x800E9EA0`, setup DL at `0x800E9FD0`, and draw DL at `0x800EA020` (J VROM `0x89710`, `0x89840`, `0x89890` respectively). Put the exact positions, orientations and disk meshes in a `markers` layer; only the retail gameplay label/role remains open.

### 8.2 Family B: coins [V-ASM/V-TOOL]

The ten-byte record is:

```text
+00 s16 runtime visibility/state (cleared)
+02 s16 frame/variant index
+04 s16 x; +06 s16 y; +08 s16 z
```

`0x800DFA10` initializes them; `0x800DFA48` view-transforms/culls at most 40 in 1P or 80 otherwise; `0x800DFF6C` constructs view-facing textured quads. Family B's use only by Coin mode and exact retail counts proves the semantic label. Fixed Gfx at J RAM `0x800EA080` and `0x800EA100` supplies two tint variants; archive 68 is referenced through runtime pointer `0x800EBF98` and contains the RGBA5551 TLUT at `+0x7630` plus nine 24x24 CI8 animation frames at `+0x7830 + n*0x240`. Put them in an `objects` or `coins` layer, separately toggleable from `main`. **[V-ASM/V-ROM]**

### 8.3 Boards/riders

Gameplay selects board `n` from archive `38+n` and paired resource `50+n`; parallel player-two code does the same. Overlay 2 starts with four boards, and one condition expands the selector bound to eight. Another flag-controlled path expands it to twelve, proving a code path to resources 8–11 but not whether normal retail progression can set that flag. The assets and selection path are **[V-ASM]**; their intended retail/debug status is **[OPEN]**. Rider/board animation is not needed to show course geometry; if implemented later, keep it separate from world objects.

## 9. Music player

### 9.1 Driver, banks and regional timing [V-ROM/V-ASM]

Air Boarder uses the older Software Creations/N64 Sound Tools `libmus` revision already modeled for Gex 64 by `src/rom/music/libmus64.ts`: 0x120-byte channel state, commands `0x80–0xA9`, libultra synthesizer. It is not the newer `music/libmus.ts` revision.

| Region | songs | pointer bank | wave bank | engine configuration |
|---|---:|---:|---:|---|
| J | `A4750–B5B00` | `B5B00` | `C29A0` | 32,000 Hz requested, 24 voices, 60 VI/s |
| P | `A5090–B6440` | `B6440` | `C32E0` | 32,000 Hz requested, 16 voices, 50 VI/s |

The pointer bank identifies `N64 PtrTablesV2` / `KO_MD00.WBK`; the wave bank identifies `N64 WaveTables`. All eight sequences, pointer data and wave payload are byte-identical between regions at `+0x940`. There are 303 type-0 N64 VADPCM waves; 34 have infinite sample loops. Nominal 32,000 Hz becomes approximately 32,006 Hz NTSC or 31,995 Hz PAL through each television clock/divider. **[V-ROM/V-ASM]**

Songs are raw/uncompressed. Header:

```text
+00 u32 channel slots (16)
+04 u32 channel-stream offset-list (0x18)
+08 u32 volume-stream offset-list (0x58)
+0C u32 pitch-bend offset-list (0x98)
+10 u32 envelope-table offset (0xD8)
+14 u32 drum-list offset (0xD8)
```

Offsets are song-relative; wave numbers directly index the common bank. All used commands are implemented by `libmus64.ts`. The musical timebase is 48 PPQ. Tempo opcode `85` uses `trunc(trunc(BPM*24576/120)/VSYNCS)` before channel scale. **[V-ASM/V-TOOL]**

### 9.2 Complete soundtrack and loops

Names are descriptive because the ROM embeds none. Every song has a direct static caller and every active channel encodes one forever loop; there is no unreferenced ninth song or one-shot. **[V-ROM/V-ASM/V-TOOL]**

| ID | J range | BPM | use | J intro / loop | P intro / loop |
|---:|---:|---:|---|---:|---:|
| 0 | `A4750–A5510` | 134 | Front-end music 1 (exact screen open) | 0 / 28.667 s | 0 / 28.700 s |
| 1 | `A5510–A6BE0` | 135 | Tutorial and Giant House | 0 / 58.783 s | 0 / 58.780 s |
| 2 | `A6BE0–A9810` | 128 | Sunset Island | 1.867 / 75.167 s | 1.860 / 75.040 s |
| 3 | `A9810–ABB90` | 144 | Green Park, 1 Player | 1.833 / 80.083 s | 1.820 / 80.120 s |
| 4 | `ABB90–AE8E0` | 90 | Front-end music 2 (exact screen open) | 104.067 / 5.333 s | 104.180 / 5.340 s |
| 5 | `AE8E0–B10E0` | 190 | Green Park, 2 Players | 1.267 / 60.683 s | 1.260 / 60.660 s |
| 6 | `B10E0–B2AF0` | 180 | Lost Forest | 1.333 / 46.700 s | 1.340 / 46.680 s |
| 7 | `B2AF0–B5B00` | 130 | Snow Festival '64 | 0 / 73.967 s | 0 / 73.900 s |

Authored tick bounds, before regional frame quantization, are: ID0 `0+3072`; ID1 `0+6339`; ID2 `192+7680`; ID3 `192+9216`; ID4 `7488+384`; ID5 `192+9216`; ID6 `192+6720`; ID7 `0+7680`. ID4's 104-second introduction and short loop are independently encoded by all ten channels, not an analyzer artifact. **[V-ROM/V-TOOL]**

Gameplay selector J `0x800E0310` uses overlay-3 table at ROM `0x899E0` / RAM `0x800EA170`, mapping `[0,1,2,3,5,6,7]`. Course-overlay calls prove all course associations; state `0x8005008A = state+0x202` distinguishes 1P/2P Green Park. Session2 corroborated Green Park 1P (`a0=3`) and Lost Forest (`a0=5`). Front-end selector J `0x800AF604`, while overlay 2 is loaded, indexes table ROM `0x404A4` / RAM `0x800B4224` mapping `[0,4,3]`; direct calls use slots 0 and 1. **[V-ASM/V-RAM]**

### 9.3 nviewer implementation

Refactor `src/rom/music/libmus64.ts` into a profile-driven old-libmus core instead of copying it. Profile fields: nominal/sample update rate, VI rate, EQ table offset, pointer/wave banks, song extents/labels, voice limit and gameplay volume (112; front-end default-volume behavior remains an inference). Cache parsed/prepared waves per ROM using `WeakMap`.

`music/wav/` contains eight 32,000-Hz stereo audition renders driven by the existing proven old-libmus engine. They cover song start through one loop plus about three seconds. They validate parsing and loop seams but are not emulator/DAC bit comparisons. The research harness temporarily substitutes a profile at build time; production must replace that ad hoc substitution with the declarative core above. **[V-TOOL]**

## 10. Mapping onto `src/rom/`

Suggested modules and ownership:

| File | Responsibility | Difficulty |
|---|---|---|
| `src/rom/airboarder64/index.ts` | region profile, ROM detection, six levels, mode/setup metadata | low |
| `archive.ts` | table validation, raw access, headerless LH5 decoder | low-medium |
| `course.ts` | environment header, grid rebasing, two F3DLX passes, Giant contexts | medium |
| `collision.ts` | packed vertices/cell lists/quad deduplication | low |
| `objects.ts` | A markers and animated CI8 coin billboards | low-medium |
| `music.ts` | eight definitions and wrapper around shared old-libmus profile | low after shared refactor |
| shared `music/libmus64.ts` | extract Gex constants into profile without changing its output | medium/risky shared owner |
| shared F3DLX path | only add commands/state actually absent from `displaylist.ts`/`texture.ts` | medium |

Level construction:

- `main`: both course grid geometry passes, with all material state.
- `objects` (or sublayers `markers` and `coins`): chosen A/B setup.
- `rooms` group for the three Giant House areas if independent toggling aids inspection.
- hidden-by-default `collision`: all deduplicated quads.
- no `sky` layer; `clearColor = fog RGB`.
- default camera: 65°, near 10, course far clip; prefer measured stable start transforms.
- music: course association from §9; front-end tracks remain available in the music box.

Regional contract: select table/ID/overlay/audio offsets from `NABJ` vs `NABP`; use identical decoders and normal-course payload logic. Do not identify a build from CRC only. Transfer every generated `ArrayBuffer`, keep every drawn instance in a layer, and use existing offline renderer/clean-worktree checks when implementing.

## 11. Verification evidence and open questions

### 11.1 Static/tool verification

- `fs/extract.py` validates every regional table recurrence and decodes 44/45 compressed entries to exact declared sizes.
- `fs/make_disasm.py` derives resident/overlay bounds structurally; `archive_xrefs.py` inventories archive calls across every mapped text image.
- `levels/analyze.py` parses all course headers, eight collision contexts and all 75 placement selections; `decode_geometry.py` reports zero malformed lists/vertex references and decodes 162 texture specs.
- normal-course decoded packages match J/P byte-for-byte; all eight collision OBJ hashes match across versions.
- `environment/scan_env.py` reproduces every environment scalar and regional header identity.
- `music/analyze_audio.py` parses all eight songs, 303 waves, 257 indexed effects, regional timing and every loop; the audition player completes all tracks.
- Green Park structural/culling renders use nviewer's existing rasterizer, not a second raster implementation.

### 11.2 Runtime verification

Session1 produced no game evidence: `headless.sh` was backgrounded in a short-lived command execution context and was reaped before debugger initialization, leaving zero-byte logs. Session2 was a fresh serialized child using a persistent foreground exec session and successfully booted the J ROM. It captured Tutorial plus all five courses, 65° FOV and initial camera triplets for each, live environment sources for each, Green Park/Lost Forest disk-marker records, all 110 original Giant House Coin level-1 records, and five gameplay music-selector calls. Screenshots, RAM dumps, debugger contexts and provenance are in `emulator/session2/`; `NOTES.md` identifies two invalid signed-address dumps that are excluded from all claims. **[V-RAM/V-FRAME]**

### 11.3 Open implementation/research questions

1. Exact F3DLX tile mask/shift/wrap and blend/depth translation should be checked against game-camera captures during implementation.
2. Static setup values 1 and 2 need their exact retail availability and UI labels confirmed; only value 0=`LEVEL 1` was observed live.
3. The disk marker's retail gameplay label/role (checkpoint, goal or generic course marker) needs visual confirmation; its exact model, format and every transform are decoded.
4. Front-end song IDs 0 and 4 have proven front-end callers, but their exact screen labels remain open.
5. Determine whether the flag-controlled path to board resources 8–11 is retail-reachable, residual or debug, and recover their display names.
6. Determine whether any non-libmus direct code path selects one of the 52 wave records not referenced by the eight songs or 257 indexed effects (§12.4).
7. The likely unused controller recording can be substituted into the used demo path to identify its intended course/character, but this is optional hidden-content work, not loader work.

## 12. Unused and hidden content

Core formats were completed before this bounded reference audit.

### 12.1 Likely unused alternate controller recording

J archive ID63 (`0x51D490–0x51E750`, SHA-256 `0033613f2ab66ee64ac0ebabf58806667addd01d700eebf805e8b9af535f6963`) is 2,400 big-endian `u16` controller samples; P ID64 is byte-identical. It has no fixed or computed archive-access path in resident or ten overlays. **[V-ROM/V-TOOL]**

Adjacent used J64 is loaded by overlay 3 `0x800B01B4`; input-source case 2 at `0x800B32D4` consumes one indexed `u16` per frame into the same internal input word as live controls. The used recording is region-specific (2,500 J vs 2,400 P samples), consistent with VI-timed attract/demo input. **[V-ASM]**

Therefore ID63 is a strong obsolete alternate-demo/controller-recording candidate. Its absolute unreachability and intended scenario remain **[HYPOTHESIS]** because a synthesized index/call path cannot be disproved solely from direct-call auditing.

### 12.2 Empty placeholders and stale fog fields

J65–67 / P66–68 are each `0x12C0` zero bytes, the size of 2,400 empty `u16` samples, with no located reference. They may reserve more recording slots but contain no recoverable content. **[V-ROM/V-TOOL]**

Every course header carries uncopied u16s at `+0x18/+0x1A`: Tutorial 996/996, Green 996/996, Lost 988/974, Snow 990/987, Sunset 996/992, Giant 995/985. No bounded source-header read was found; active world fog hardcodes 996–1000. They are likely abandoned per-1P/2P fog-start values. Bytes/skipping are **[V-ROM/V-ASM]**; semantic name is **[HYPOTHESIS]**.

### 12.3 Things that looked hidden but are accounted for

- All six large course packages have fixed calls in stage overlays; no unreferenced/cut course package exists. **[V-ASM]**
- Giant House's three headers are all initialized and represent connected areas. **[V-ASM]**
- All eight music sequences have callers; ID4 is omitted from the main seven-pair table but explicitly referenced by the front end. **[V-ASM]**
- Board resources 8–11 exist and a flag-controlled selector path can reach all twelve indices; whether normal retail progression reaches that path is open. **[V-ASM/OPEN]**

### 12.4 Narrow unused-wave candidates

The eight songs reference 35 distinct waves; all 257 indexed effect streams reference 220. Their union leaves 52 distinct records (584,577 encoded VADPCM bytes) unreferenced by either bytecode source; five have infinite sample loops (212, 214, 221, 223, 230). **[V-TOOL]** This is deliberately not a global-unused claim: direct/dynamic wave users outside indexed libmus song/effect bytecode remain **[OPEN]**. Full IDs/extents are in `music/REPORT.md` and `music/J.json`.

### 12.5 Debug/text/build audit

A targeted CP932 scan of the J ROM and extracted archive data found none of the explicit Japanese terms for test, debug, sound, stage, course, character, mode, unused, boss, ending, demo, hidden or sample. This bounded negative does not exclude image text or unlabeled code. Save signatures and microcode IDs are accounted for; no timestamp or developer debug menu/string was found. **[V-TOOL]**

## 13. Process and artifact hygiene

The investigation standardized one archive extractor, one structural overlay mapper and shared bounded disassemblies. Early exploratory flattened disassemblies assigned plausible but wrong RAM addresses after overlay boundaries; they were isolated under `rejected/`, their canonical copies were removed, and every address citation re-audited. Two specialists' redundant code dumps and unsupported trial image decodes were removed.

Two recurring workflow hazards were exposed:

1. MIPS `lui 0x800F; addiu reg,reg,negative` resolves into `0x800E....`, not `0x800F....`. Several plausible-looking environment/object addresses were caught and corrected. Future work should resolve address-forming instruction pairs with a small canonical analyzer rather than mental arithmetic.
2. Backgrounding `headless.sh` inside a short-lived command context can silently reap it; a persistent foreground exec session is reliable. Input senders also wait forever while the debugger is paused, so remove/pause breakpoints before a bounded send and audit the specific helper afterward.

Every emulator attempt had a fresh run directory; session2 never overlapped another Air Boarder emulator. The lead waits for all children, proofreads the final spec, and performs a final scoped process audit before delivery.
