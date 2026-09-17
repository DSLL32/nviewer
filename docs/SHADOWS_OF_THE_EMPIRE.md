# Star Wars: Shadows of the Empire — Nintendo 64 ROM format specification

This manual describes the shipped Nintendo 64 resource layout. Unless a release
is named, offsets and disassembly addresses refer to USA V1.0. A scene catalog
entry is not, by itself, proof that the scene is reachable in normal play.

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | `Ogre` root at ROM `0x1F30` (USA), with program/audio/shared-resource bounds, 32 indexed scenes, and a shared image archive. |
| Compression | Main program and scene IDs 01–31: adaptive-Huffman LZ (LZHUF); scene ID 00 and shared image archive: 4 KiB-ring LZSS. |
| Graphics microcode | `RSP SW Version: 2.0D, 04-01-96` occurs in the decoded program; scene command indices differ from stock F3DEX, and exact task identity remains **Unknown**. |
| Geometry | `LStb` tagged scene graph, transformed `0x2C`-byte meshes, 16-byte vertices, and custom-index display lists. |
| Textures | Shared image archive; CI4, CI8, I4, RGBA16, and RGBA32 base tiles. |
| Collision | Scene-local `f32` vertex pool and indexed polygon/strip groups attached to render mesh records; non-indexed path remains incomplete. |
| Music driver | Indexed libultra `ALSound` cue player with eight cue states; a separate sequence player has not been established. |
| Audio microcode | **Unknown**. |
| Sample encoding | Nintendo VADPCM, 98 distinct waves in one libultra bank. |
| Levels | 32 indexed scene members: 17 gameplay segments, 14 cutscene/end segments, one menu. |
| Memory requirement | Base 4 MiB; active gameplay was observed without an Expansion Pak. |
| Viewer support | Four releases; 32 scene entries, graph meshes/materials, indexed collision overlay, and audio cues. Authored music names remain unavailable. |

### 1.2 ROM identification

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| USA V1.0 | `Shadow of the Empire` | `NSWE` | 0 | 12 MiB (`0xC00000`) | `264D7E5C` | `18874622` | `271c285f6e5069133ab27a2a8324d4651591e35d` | CIC-6102 | `SotE Oct 17 1996` |
| USA V1.1 | `Shadow of the Empire` | `NSWE` | 1 | 12 MiB (`0xC00000`) | `4147B091` | `63251060` | `ded8f972d1e1d662614b1ec79822d649a8ce5430` | CIC-6102 | `v21Oct96.1827` |
| USA V1.2 | `Shadow of the Empire` | `NSWE` | 2 | 12 MiB (`0xC00000`) | `4DD7ED54` | `74F9287D` | `9ab85626c27372ee614b7c5301c2c4eb187fd9f6` | CIC-6102 | `v31Oct96.1141` |
| Europe | `Shadow of the Empire` | `NSWP` | 0 | 12 MiB (`0xC00000`) | `4D486681` | `AB7D9245` | `e014f60bea29bbc7fbd7f3ba4fcc6bdd228c8fe5` | CIC-6102 | `v26Dec96.1321` |

Verified from normalized ROM headers and full-file SHA-1 calculations. The
CIC-6102 IPL3 bytes match other known CIC-6102 images. The build strings are
stored after the 32 scene labels; they are not filesystem timestamps.

### 1.3 Terminology and conventions

Ranges are half-open. Multi-byte CPU fields are big-endian; codec bits may
have a different order as stated below. `ROM` is a physical cartridge byte
offset. `RAM` and `VRAM` are N64 virtual addresses. For a decoded `LStb`
scene, `scene+X` means offset `X` from its first decoded byte.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

Verified by disassembly and ROM bytes: the entry point is `0x80000400` at ROM
`0x1000`. The resident boot code occupies approximately ROM
`[0x1000, 0x1F30)`. Its first program load copies the LZHUF main stream from
ROM `[0x2AC0, 0x83590)` into temporary RAM at `0x80300000`, then decodes
`0xEBEC0` bytes at RAM `0x80001EC0`. The in-ROM `Ogre` directory and codec
position tables remain in the small uncompressed preamble.

The decoded program begins with MIPS code and includes game data and RSP
microcode data. The readable microcode string is `RSP SW Version: 2.0D,
04-01-96`. Verified against RAM: the decoded main agrees with a menu-state
RAM capture through offset `0xCE04F`; 262 bytes differ across the full image,
in small runtime-mutated clusters. This comparison supports the decoder but
does not classify every code/data boundary.

### 2.2 Memory and address mapping

The boot entry maps ROM `0x1000` to RAM `0x80000400`, or
`RAM = ROM - 0xC00 + 0x80000000` for the resident preamble. Each decoded scene
has two paired base/end values in its `LStb` header. The first base is
`0x80195F90` in all 32 V1.0 scenes and is the load address observed for the
menu scene in RAM. The second base is `0x007BAF00`; its address domain and
runtime use are **Unknown**. Scene-internal pointers in the first address
domain resolve by `offset = pointer - 0x80195F90`. The first address domain
is a genuine RAM address; the second must not be interpreted as a RAM address
without more evidence.

### 2.3 ROM map and asset organization

The USA V1.0 map is verified from the `Ogre` root, the bank structures, and
the 32 contiguous scene intervals. Names `shared A/B/C` intentionally do not
assert a resource type.

| ROM range | Stored size | Decoded size | Destination | Compression | Contents |
|---|---:|---:|---|---|---|
| `[0x000000, 0x001000)` | `0x1000` | same | boot | none | N64 header and CIC-6102 IPL3. |
| `[0x001000, 0x001F30)` | `0x0F30` | same | `0x80000400` | none | entry and boot decoder. |
| `[0x001F30, 0x002AC0)` | `0x0B90` | same | boot preamble | none | `Ogre` root, scene tables/labels, position-code lookup tables. |
| `[0x002AC0, 0x083590)` | `0x80AD0` | `0xEBEC0` | `0x80001EC0` | LZHUF | main executable/data. |
| `[0x083590, 0x088690)` | `0x5100` | same | copied control | none | libultra `B1` bank control. |
| `[0x088690, 0x4E8900)` | `0x460270` | same | ROM-streamed | none | VADPCM sample table. |
| `[0x4E8900, 0x618F50)` | `0x130650` | `0x2027E0` | decoded virtual base `0x80400000` | LZSS | shared image archive, 1,259 entries. |
| `[0x618F50, 0x65DD60)` | `0x44E10` | **Unknown** | **Unknown** | **Unknown** | shared B; type unverified. |
| `[0x65DD60, 0x67D980)` | `0x1FC20` | **Unknown** | **Unknown** | **Unknown** | shared C; type unverified. |
| `[0x67D980, 0xBFCAD0)` | `0x57F150` | per scene | `0x80195F90` | LZSS or LZHUF | 32 contiguous scenes. |
| `[0xBFCAD0, 0xC00000)` | `0x3530` | — | — | none | repeated filler text. |

The root begins with `Ogre` and is at `0x1F30` in each USA revision or
`0x1E70` in Europe. A `u32` scene start table begins at root+`0x40`, a
`u32` scene size/flag table at root+`0xC0`, and 32 fixed `0x40`-byte labels
at root+`0x140`. These locations are verified both by all 32 ROM intervals
and by the main program's scene-loader disassembly.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `char[4]` | `magic` | `Ogre`. |
| `0x04` | 4 | `u32` | `versionFlags` | `0x10000001` in all inspected images; boot code tests its low halfword as a compression switch. Other bits are unverified. |
| `0x08` | 4 | `u32` | `mainStart` | Physical ROM start of compressed main. |
| `0x0C` | 4 | `u32` | `mainEnd` | Exclusive end of compressed main. |
| `0x10` | 4 | `u32` | `bankStart` | `B1` control-file start. |
| `0x14` | 4 | `u32` | `bankEnd` | Control-file end. |
| `0x18` | 4 | `u32` | `sampleStart` | VADPCM table start. |
| `0x1C` | 4 | `u32` | `sampleEnd` | VADPCM table end. |
| `0x20` | 4 | `u32` | `sharedAEnd` | End of shared span A. |
| `0x24` | 4 | `u32` | `sharedBEnd` | End of shared span B. |
| `0x28` | 4 | `u32` | `sharedCStart` | Equals `sharedBEnd`; separate semantics unverified. |
| `0x2C` | 4 | `u32` | `scenesStart` | First indexed scene start. |
| `0x30` | 4 | `u32` | `sharedAStart` | Equals `sampleEnd`. |
| `0x34` | 4 | `u32` | `sharedAEndAgain` | Equals `sharedAEnd`. |
| `0x38` | 4 | `u32` | `scenesStartAgain` | Equals `scenesStart`. |
| `0x3C` | 4 | `u32` | `unknown_3C` | Zero in inspected images. |
| `0x40` | `0x80` | `u32[32]` | `sceneStart` | Physical ROM starts, by scene ID. |
| `0xC0` | `0x80` | `u32[32]` | `sceneSizeFlags` | High byte `0x01`; low 24 bits = stored length. The flag's meaning is unverified. |
| `0x140` | `0x800` | `char[32][0x40]` | `sceneName` | NUL-padded ASCII labels; the build string follows. |

The fixed root through labels has size `0x940` bytes before the build string
and codec tables. Each start/length pair is 16-byte aligned; each end is the
next start. The loader indexes this root by a 16-bit scene ID. Valid catalog
IDs are `0x00`–`0x1F`.

### 2.4 Compression formats

Reference codecs: [Shadows LZHUF](compression/shadows-lzhuf.md) and
[Shadows LZSS](compression/shadows-lzss.md).

Verified by boot disassembly and by decoding the entire program and all 32
scene members. The main stream and IDs 01–31 use an adaptive-Huffman LZ
variant with 314 symbol values, a 4 KiB history, and match lengths 3–60.
The first four stored bytes give the exact decoded length. Subsequent bits
are consumed most-significant first. Symbols below 256 are literals. Symbols
256–313 copy `symbol - 253` bytes from an already-output position; the
distance is decoded by a fixed prefix table at ROM
`[0x28C0, 0x2AC0)` in USA V1.0. The boot decoder uses adaptive Huffman
frequency updates, including node zero. It reconstructs the tree at root
frequency `0x8000`. A copy uses distance 1–4096 and permits overlapping
output. The stored block may have up to 15 trailing bytes after the last
consumed compressed byte; they are not assumed to be zero or a checksum.

The fixed position tables move between releases; each is 256 bytes of code
values followed by 256 bytes of code lengths in the preamble preceding the
main compressed stream:

| Release | Code table | Length table |
|---|---|---|
| USA V1.0 | `[0x28C0, 0x29C0)` | `[0x29C0, 0x2AC0)` |
| USA V1.1/V1.2 | `[0x28BC, 0x29BC)` | `[0x29BC, 0x2ABC)` |
| Europe | `[0x2804, 0x2904)` | `[0x2904, 0x2A04)` |

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `u32` | `decodedSize` | Exact output byte count. |
| `0x04` | variable | bitstream | `symbols` | Adaptive-Huffman symbols plus fixed-prefix match positions. |

Scene ID 00 instead uses the boot code's LSB-first LZSS reader. Each control
byte covers eight tokens, least-significant bit first: bit 1 copies a literal
byte; bit 0 reads the following two-byte token. Its 4 KiB ring write index
starts at one. A match length is `(firstByte >> 4) + 2`; its absolute ring
position is `((firstByte & 0x0F) << 8) | secondByte`. Position zero terminates
the stream. All bytes emitted by the intro stream come from written ring
positions; its complete output is `0x2A0F0` bytes and begins `LStb`.

Verified by main-program disassembly and complete bounded decoding: shared
resource A uses the same LSB-first LZSS grammar. Its decoded size is
`0x2027E0`; the ring-position-zero terminator occurs at stored offset
`0x130635`. The decoded bytes form the image catalog described under
[Textures and materials](#35-textures-and-materials).

| Offset | Bits | Field | Meaning |
|---:|---|---|---|
| `0x00` | `7:4` | `lengthCode` | Copy `lengthCode + 2` bytes. |
| `0x00` | `3:0` | `ringPositionHigh` | High four bits of absolute 12-bit ring position. |
| `0x01` | `7:0` | `ringPositionLow` | Low eight bits; position zero ends stream. |

### 2.5 Loading process

Verified by disassembly of the decoded main program around `0x80018C08`:
the loader indexes both the start and size/flag arrays with the requested
scene ID, masks the stored size to 24 bits, obtains a ROM range, and loads
and decodes it at `0x80195F90`. It then initializes game systems from the
`LStb` header. Menu scene ID 02 matches captured RAM at that address for
the first `0x130` bytes. The Battle of Hoth scene (ID 03) was also reached
in active gameplay, with a rear-chase camera and snowy terrain. This verifies
scene loading, not the meaning of every internal section pointer.

### 2.6 Revision differences

Verified from all four ROMs. USA V1.0 and V1.1 have byte-identical bank,
sample, shared A/B/C, and all 32 stored scene streams; only their compressed
main program and physical offsets differ. USA V1.2 retains byte-identical
bank/sample/shared A/B/C data but changes the compressed main and all 32
stored scene streams. Europe also retains USA-identical shared B and C; its
bank, sample data, shared A, program, and all scene streams differ. Stream
differences do not by themselves prove a distinct playable layout.

| Release | `Ogre` root | Main stored | Main decoded | First scene | Scene data end |
|---|---:|---:|---:|---:|---:|
| USA V1.0 | `0x1F30` | `[0x2AC0, 0x83590)` | `0xEBEC0` | `0x67D980` | `0xBFCAD0` |
| USA V1.1 | `0x1F30` | `[0x2AC0, 0x83420)` | `0xEBEC0` | `0x67D810` | `0xBFC960` |
| USA V1.2 | `0x1F30` | `[0x2AC0, 0x838C0)` | `0xEC880` | `0x67DCB0` | `0xBFCE20` |
| Europe | `0x1E70` | `[0x2A40, 0x84350)` | `0xEDEC0` | `0x67EDA0` | `0xBFDDF0` |

## 3. Level data

### 3.1 Level catalog and identifiers

Verified from the USA V1.0 `Ogre` table. IDs are zero-based and include
cutscenes and the main menu. All physical ranges are half-open; the 32
members fill `[0x67D980, 0xBFCAD0)` without a hole. A multi-part chapter
can have several scene IDs. Label numbers 5 and 8 are not proof of missing
levels, since cutscene transitions occupy those positions.

| ID | Kind | ROM range | Stored bytes | Stored label |
|---:|---|---|---:|---|
| `00` | cutscene | `[0x67D980, 0x68EFC0)` | `0x011640` | Cut 00 (Intro) |
| `01` | cutscene | `[0x68EFC0, 0x6A1210)` | `0x012250` | Cut 01 (Hoth) |
| `02` | menu | `[0x6A1210, 0x6CD410)` | `0x02C200` | Main Menu |
| `03` | gameplay | `[0x6CD410, 0x6F2EB0)` | `0x025AA0` | 1. Battle on Hoth |
| `04` | gameplay | `[0x6F2EB0, 0x73F820)` | `0x04C970` | 2a. Hoth Base |
| `05` | gameplay | `[0x73F820, 0x79EF40)` | `0x05F720` | 2b. Hoth Base |
| `06` | gameplay | `[0x79EF40, 0x7A7C00)` | `0x008CC0` | 3. Asteroid Chase |
| `07` | cutscene | `[0x7A7C00, 0x7EFEF0)` | `0x0482F0` | Cut 03 (Train) |
| `08` | gameplay | `[0x7EFEF0, 0x8693D0)` | `0x0794E0` | 4a. Train |
| `09` | cutscene | `[0x8693D0, 0x875B70)` | `0x00C7A0` | Cut 04 (IG 88) |
| `0A` | gameplay | `[0x875B70, 0x89B2F0)` | `0x025780` | 4b. Junk Heap |
| `0B` | cutscene | `[0x89B2F0, 0x89FCF0)` | `0x004A00` | Cut 05 (Gorge) |
| `0C` | cutscene/end | `[0x89FCF0, 0x8A26B0)` | `0x0029C0` | End Game (Cut 02) |
| `0D` | cutscene | `[0x8A26B0, 0x8B4240)` | `0x011B90` | Cut 06 (Gorge Trans) |
| `0E` | gameplay | `[0x8B4240, 0x8FB970)` | `0x047730` | 6a. Gall Cliff Base |
| `0F` | gameplay | `[0x8FB970, 0x961F30)` | `0x0665C0` | 6b. Gall Cliff Base |
| `10` | cutscene | `[0x961F30, 0x975280)` | `0x013350` | Cut 07 (Bike Intro) |
| `11` | gameplay | `[0x975280, 0x9BC6F0)` | `0x047470` | 7. Speeder Bike Chase |
| `12` | cutscene | `[0x9BC6F0, 0x9D9850)` | `0x01D160` | Cut 08 (Bike End) |
| `13` | cutscene | `[0x9D9850, 0x9E0010)` | `0x0067C0` | Cut 09 (Freighter) |
| `14` | gameplay | `[0x9E0010, 0xA166D0)` | `0x0366C0` | 9a. Space Freighter |
| `15` | gameplay | `[0xA166D0, 0xA53820)` | `0x03D150` | 9b. Space Freighter |
| `16` | gameplay | `[0xA53820, 0xA7E8B0)` | `0x02B090` | 9c. Space Freighter |
| `17` | cutscene | `[0xA7E8B0, 0xA8FF90)` | `0x0116E0` | Cut 10 (Throne) |
| `18` | cutscene | `[0xA8FF90, 0xAB1050)` | `0x0210C0` | Cut 11 (Sewer) |
| `19` | gameplay | `[0xAB1050, 0xB206E0)` | `0x06F690` | 10. Sewer |
| `1A` | gameplay | `[0xB206E0, 0xB71570)` | `0x050E90` | 11a. Xizor Palace |
| `1B` | gameplay | `[0xB71570, 0xBB78F0)` | `0x046380` | 11b. Xizor Palace |
| `1C` | cutscene | `[0xBB78F0, 0xBC8000)` | `0x010710` | Cut 12 (Battle) |
| `1D` | gameplay | `[0xBC8000, 0xBD1A20)` | `0x009A20` | 12. Station Chase |
| `1E` | gameplay | `[0xBD1A20, 0xBE3B10)` | `0x0120F0` | 13. Skyhook Battle |
| `1F` | cutscene | `[0xBE3B10, 0xBFCAD0)` | `0x018FC0` | Cut 13 (Finale) |

### 3.2 Level container

All 32 decoded scene members begin with an `LStb` header of at least `0x50`
bytes. The fixed first RAM base and pointer validity are verified against
all 32 decoded members; ID 02 is also verified against menu RAM. Pointers
at `0x14`–`0x44` all fall within their own decoded member (416 of 416
checked). Their eventual consumer/type is not established. The first four
fields after the magic establish paired ranges; the second pair is an
unidentified address domain, not a safe RDRAM address.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `char[4]` | `magic` | `LStb`. |
| `0x04` | 4 | `u32` | `ramBase` | `0x80195F90` in USA V1.0; menu RAM confirms this load base. |
| `0x08` | 4 | `u32` | `ramEnd` | `ramBase + decodedSize`. |
| `0x0C` | 4 | `u32` | `base_0C` | `0x007BAF00` in USA V1.0; address domain unverified. |
| `0x10` | 4 | `u32` | `end_10` | `base_0C + decodedSize`. |
| `0x14` | 4 | `u32` | `section_14` | In-member pointer; section type unverified. |
| `0x18` | 4 | `u32` | `section_18` | In-member pointer; section type unverified. |
| `0x1C` | 4 | `u32` | `section_1C` | In-member pointer; section type unverified. |
| `0x20` | 4 | `u32` | `section_20` | In-member pointer; section type unverified. |
| `0x24` | 4 | `u32` | `section_24` | In-member pointer; section type unverified. |
| `0x28` | 4 | `u32` | `section_28` | In-member pointer; section type unverified. |
| `0x2C` | 4 | `u32` | `section_2C` | In-member pointer; section type unverified. |
| `0x30` | 4 | `u32` | `section_30` | In-member pointer; section type unverified. |
| `0x34` | 4 | `u32` | `section_34` | In-member pointer; section type unverified. |
| `0x38` | 4 | `u32` | `section_38` | In-member pointer; section type unverified. |
| `0x3C` | 4 | `u32` | `section_3C` | Always points to header+`0x48`. |
| `0x40` | 4 | `u32` | `section_40` | In-member pointer; section type unverified. |
| `0x44` | 4 | `u32` | `section_44` | In-member pointer; section type unverified. |
| `0x48` | 4 | `u32` | `unknown_48` | Scene-dependent value. |
| `0x4C` | 4 | `f32` | `unknown_4C` | Constant `-0.25` (`0xBE800000`). |

No count or termination rule for the pointed-to sections has been established;
the end of an `LStb` member is determined by its decoded length. For example,
the Battle of Hoth (`0x03`) has `ramEnd=0x80235AB0`, and the menu (`0x02`)
has `ramEnd=0x801E93F0`.

### 3.3 Geometry

Verified from a Battle of Hoth gameplay frame: a broad snowy surface, low
distant ridges and scattered terrain features are drawn in 3D. In the decoded
Hoth scene, eight consecutive `0x2C`-byte mesh records beginning at
scene+`0x657D4` have ordered six-float bounds and a final pointer to a
graphics command stream. The first record has bounds approximately
`(-171.8, -109.3, -0.8)` to `(-124.9, -31.2, 9.2)` and points to RAM
`0x802137A8`, or scene+`0x7D818`. These bounds are not evidence of collision
use. A program dispatch at `0x800BB4B0`–`0x800BB4B8` tests the `0xD064`
and `0xD065` scene-node tags found at Hoth header targets +`0x18` and
+`0x14`, respectively; the same routine emits display-list calls. This links
those tagged nodes to the graphics hierarchy, but not every `LStb` section.

The `0x2C`-byte mesh record combines render and collision references. Its
middle fields were identified by the collision-query code:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x18` | `f32[6]` | `bounds` | Three lower and three upper coordinates; ordered in eight Hoth records. |
| `0x18` | 2 | `s16` | `polygonCount` | Collision polygon/strip group count. |
| `0x1A` | 2 | `s16` | `polygonType` | Observed types 3, 4, 5, 7. |
| `0x1C` | 4 | `u32` | `groupSizes` | Scene pointer to per-strip `u32` counts for types 5/7. |
| `0x20` | 4 | `u32` | `collisionIndices` | Scene pointer to `u16` indices; zero selects a separate non-indexed path. |
| `0x24` | 4 | `u32` | `material` | Scene pointer to render material binding. |
| `0x28` | 4 | `u32` | `displayList` | Pointer to sampled graphics command stream. |

The Hoth stream's three vertex loads address 40 contiguous 16-byte records
immediately before its commands. A separate main-menu stream addresses 125
such records. Verified by checking 43,019 first-batch vertices from six
scenes against their mesh bounds: position components are signed `s16`
scaled by `1/8`. Vertex S/T are signed `s16` with five fractional bits.
The game uses Z-up; the viewer maps scene Z to world Y. The remaining vertex
bytes serve colour/normal roles that depend on render state.

The scene graph rooted at header pointer `+0x1C` traverses tagged `0x5064`
and `0x5065` groups, then `0xD064`/`0xD065` nodes with 3×3 transforms and
translation, then `0x3064` mesh-pointer lists. This graph references 662
Hoth render meshes and 3,232 Train meshes; repeated references produce
multiple placed instances. Flat mesh bounds on one axis are legal, so
`min == max` there does not invalidate a mesh. Other scene-root roles and
complete cutscene traversal remain **Unknown**.

The renderer tests the high byte of each child node's flags at `+0x02` before
descending; a zero high byte disables that branch in the stored state
(main-program code `0x800BB2E0`–`0x800BB2E8`). For example, an untextured
Hoth Base mesh under a disabled `0x5064` node is coplanar with an enabled,
textured mesh under `0xD065`. The collision query at `0x80003DDC`–`0x80003E64`
does not apply this render-enable test. Stored enable bits are not necessarily
the final gameplay pose: some initially disabled Hoth actor parts are visible
after runtime activation.

### 3.4 Display lists and render state

Two bounded scene command streams have been verified by pointer and primitive
index checks. Hoth `[scene+0x7D818, scene+0x7D900)` contains three `0x04`
vertex loads, 24 `0xBF` triangles, a `0xBE` command, and a `0xB8` end. The
menu `[scene+0x8990, scene+0x8C88)` contains ten `0x04` vertex loads, 77
`0xBF` triangles, six `0xB5` quads, `0xBE` commands, and a `0xB8` end.
Each `0x04` command's low nine bits plus one equal 16 times its vertex count
in bits 9–14. For example, `04001CDF 80213528` loads 14 records from RAM
`0x80213528`. Every sampled `0xBF` and `0xB5` index byte is a multiple of
five and, divided by five, resolves within the current vertex batch;
`BF000000 0200050A` selects vertices 0, 1, and 2 under this convention.
These byte rules differ from stock F3DEX and a stock F3DEX parser cannot be
applied unchanged. Exact graphics task identity and `0xBE` semantics remain
**Unknown**, despite the decoded program's `RSP SW Version: 2.0D,
04-01-96` and `SGI U64 GFX SW TEAM` strings.

### 3.5 Textures and materials

Verified by scene records, decoded shared-A bytes, and the main renderer:
shared A is an LZSS-compressed image archive. Its first four `u32` fields
each equal `0x4EB` (1,259). Starting at decoded offset `0x10` are 1,259
interleaved records of stride `0x0C`:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `u32` | `commandPtr` | Image display-list pointer. |
| `0x04` | 4 | `u32` | `blockStart` | Inclusive image-block start. |
| `0x08` | 4 | `u32` | `blockEnd` | Exclusive image-block end. |

All three pointer values use virtual base `0x80400000`: subtract it to
index the **decoded** shared-A buffer. Image and palette pointers *inside*
the image display list instead use base `0x84400000`. Resource IDs index
the `0x0C`-byte catalog directly; main code at `0x8001889C` multiplies
the ID by 12.

Mesh record `+0x24` points to a scene-local `0x0C`-byte material binding:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `u32` | `flags` | RSP geometry-state controls; see below. |
| `0x04` | 4 | `u32` | `unknown_04` | Zero in checked bindings. |
| `0x08` | 4 | `u32` | `imageRecord` | Scene pointer to a `0x10`-byte image record. |

Image records reached from header pointer `+0x30` have this stored layout;
the game rewrites them during loading:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | `u16` | `widthLike` | Four times base-tile width in directly checked images. |
| `0x02` | 2 | `u16` | `heightLike` | Four times base-tile height in directly checked images. |
| `0x04` | 4 | `u32` | `unknown_04` | Zero in checked records. |
| `0x08` | 4 | `u32` | `resourceId` | Index into the shared-A catalog. |
| `0x0C` | 4 | `u32` | `unknown_0C` | Zero in checked records. |

The image display list supplies the actual base-tile dimensions and texel
format. Its `0xBB` `G_TEXTURE` command, at catalog `commandPtr + 0x08`, also
supplies unsigned 16-bit S/T factors in its second word. Multiply the vertex
S/T values by `factor / 65536` before dividing by the base-tile width/height;
omitting the factors over-repeats terrain and mountain textures. All 1,077
USA and 1,080 Europe image IDs referenced by the scene graphs have a valid
scale command. The following counts are distinct resource IDs in a structural
survey of all 32 scenes, not proof that every candidate mesh is reachable:

| Base tile format | Referenced IDs | Palette |
|---|---:|---|
| CI4 | 672 | 16-entry RGBA16 |
| CI8 | 31 | 256-entry RGBA16 |
| I4 | 337 | none |
| RGBA16 | 25 | none |
| RGBA32 | 12 | none |

All 1,077 referenced IDs resolve inside the 1,259-entry archive. Of their
image command lists, 940 are flat and 137 call an in-block mip-level list;
the base tile is still identified by the first load/tile-size commands.
For example, Hoth ground image `0x216` is CI4, 64×32, with texels at decoded
shared-A `+0xFD410` and RGBA16 palette at `+0xFD818`; Hoth sky image
`0x229` is CI4, 64×64, with texels at `+0x102C50` and palette at
`+0x103458`. Hoth scene header `+0x34` points to a separate resource-prefetch
list, not the per-mesh image binding.

Disassembly at `0x800BBB5C`–`0x800BBBC8` establishes that material flag
`0x10` disables back-face culling; flags `0x08`, `0x20`, and `0x40` control
smooth shading and linear texture generation. Other blend and depth-write
semantics remain **Unknown**.

### 3.6 Collision

Verified by disassembly of geometric query routines `0x80002FDC`–`0x80004088`:
the game traverses the tagged scene graph, tests each `0x3064` mesh's
six-float bounds, and reads separate collision polygons. Header pointer
`+0x44` locates a scene-local vertex pool at 12-byte stride:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `f32` | `x` | Scene X coordinate. |
| `0x04` | 4 | `f32` | `y` | Scene Y coordinate. |
| `0x08` | 4 | `f32` | `z` | Scene Z coordinate. |

Mesh `+0x20` indexes that pool with zero-based `u16`
indices. These are **not** the packed render vertices or display-list
triangles, despite sharing a mesh record and graph transform.

For polygon type 3, each group consumes three indices; type 4 consumes
four. Types 5 and 7 use one `u32` count per group from mesh `+0x1C`, then
consume that many indices as a strip. Consecutive triples alternate
winding. The semantic distinction between types 5 and 7, and the exact
intersection diagonal for quads, remain **Unknown**. A zero `+0x20` pointer
selects a separate sequential-vertex path; it must not be read as proof
that the mesh has no collision.

For example, Hoth mesh scene+`0x657D4` has eight type-5 groups. Counts at
scene+`0x75280` are `[3,3,4,4,4,5,6,11]`, totaling 40 `u16` indices at
scene+`0x752A0`. The first index `0x2A` selects the pool vertex at
scene+`0x6EC80 + 0x2A*12 = 0x6EE78`. A graph audit of all 32 scenes found
15,963 indexed records, 49,593 groups, and 117,387 visualization
triangles with valid finite referenced vertices. It also found 4,572
null-index records and 557 unclassified graph branches; indexed coverage
is therefore substantial but not exhaustive.

### 3.7 Environment, sky, fog, and lighting

Verified from a Battle of Hoth active-gameplay frame: a bright blue sky with
broad cloud patterns sits above a low snowy horizon; rolling white terrain
has exposed brown patches. Fog colour, distance, light configuration, sky
projection, and their binary records remain **Unknown**. The frame is an
appearance reference, not a claim about stored environment parameters.

### 3.8 Cameras and paths

Verified from active Battle of Hoth gameplay: the player craft is low and
central in a rear-chase view. The camera/path data representation and any
cutscene spline grammar remain **Unknown**.

## 4. Objects

### 4.1 Placement records

The Hoth member contains recurring tagged data at header pointer targets:
`D0 65 00 03`, `D0 64 FF 03`, `50 64 FF 00`, `50 65 FF 00`, and
`30 64 FF 00` (verified from decoded ROM bytes). The `D064`/`D065` tags
are read by a graphics-hierarchy dispatch. Header `+0x1C` reaches
`0x5064`/`0x5065` groups, `0xD064`/`0xD065` transform nodes, and `0x3064`
mesh lists. Their complete field layouts and non-render consumers remain
**Unknown**; this is a verified render placement path, not yet a general
gameplay-object placement format.

### 4.2 Object and model formats

Visible craft and terrain objects are present in gameplay. The tagged graph
places scene-local meshes using 3×3+translation transforms, sometimes
referencing one mesh more than once. The viewer exposes those static render
instances. Animated actors and shared-model ownership are not established;
shared spans B/C remain unclassified.

### 4.3 Skeletons and animation

Skeletal storage, animation tracks, and keyframe timing remain **Unknown**.

### 4.4 Behaviors, triggers, and scripted objects

The ROM catalogs cutscenes and gameplay segments, but no scene script opcode
or trigger record has been established. Treat the IDs as scene selectors,
not a script catalog.

## 5. Audio

### 5.1 Audio storage and banks

Verified from ROM bytes: a standard libultra `B1` bank control file occupies
`[0x83590, 0x88690)` and its sample table occupies
`[0x88690, 0x4E8900)`. There is one `ALBank`, one instrument, 131 indexed
`ALSound` slots, 98 distinct wave records, and 32 distinct wave-loop records.
The highest addressed wave ends at `0x4E88FE`, leaving two pad bytes before
the sample table's indexed end.

The `B1` header uses control-file-relative offsets:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 2 | `char[2]` | `revision` | ASCII `B1`. |
| `0x02` | 2 | `u16` | `bankCount` | `1`. |
| `0x04` | 4 | `u32` | `bankOffset_0` | `0x50E0`, pointing to the bank at ROM `0x88670`. |

The bank at `0x88670` stores `instCount=1`, a sample-rate field of 44,100
Hz, and the sole instrument pointer. The instrument at ROM `0x88450`
stores volume 127, pan 64, and `soundCount=131`; its sound-pointer array
selects sample cues by slot ID. Verified by main-program disassembly:
`0x80006698` copies only the bank control file to RAM and relocates its
sample bases against ROM `0x88690`. Sample bytes are streamed from ROM on
demand by a 1 KiB DMA cache, not copied wholesale with the bank.

### 5.2 Sequence format and driver

Verified by disassembly: `0x8000686C(index)` bounds-checks the requested
slot against 131 sounds, obtains its `ALSound`, and allocates a sound-player
voice. The cue request path at `0x80007128` passes slot ID and timing/pitch
parameters; an eight-state manager at `0x80006918` handles starts, stops,
and fades. This is direct indexed sample-cue playback. A separate music
sequence bytecode or player is not established. A structural scan found no
second valid `B1` bank or plain `MThd`/`N64 PtrTablesV2` header; this does
not exclude an unidentified compressed sequence format.

The program requests a 22,050 Hz AI output rate at `0x800061D8`.
The NTSC AI clock/divider observed in RAM yields approximately 22,047.92 Hz.
This output rate is distinct from the bank's 44,100 Hz sample-rate field.

### 5.3 Instruments and sample encoding

All 98 distinct waves are type-zero Nintendo VADPCM, with order-two,
four-predictor codebooks. Each indexed sound has pan 64 and volume 127.
The key map on every sound accepts velocities 0–127, and its only key is 44;
direct slot selection, rather than melodic key selection, is verified by
the cue routine. Multiple sound slots can share one wave while retaining
different envelopes, so a viewer must preserve slot identities.

The standard `ALWaveTable` record names the sample-table-relative byte
range and points to its codebook and optional loop. The wave for slot 12
at ROM `0x83F40` illustrates the fixed `0x14`-byte record:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | 4 | `u32` | `base` | Sample-table-relative byte offset; `0x23FB8` for slot 12. |
| `0x04` | 4 | `u32` | `len` | Encoded sample bytes; `0x4A476`. |
| `0x08` | 1 | `u8` | `type` | Zero denotes VADPCM. |
| `0x09` | 1 | `u8` | `flags` | Zero in this example. |
| `0x0A` | 2 | `u8[2]` | `pad_0A` | Zero in this example. |
| `0x0C` | 4 | `u32` | `loopOffset` | Control-file-relative; zero for slot 12. |
| `0x10` | 4 | `u32` | `bookOffset` | Control-file-relative VADPCM predictor book. |

### 5.4 Music catalog and loop points

No bank field identifies a slot as a song, and no level-to-music assignment
has been verified. The following are the 12 long-form cue slots (encoded
length over 64 KiB); they are **candidates**, not confirmed music titles.
Short looping sound effects also exist. Loop coordinates below are decoded
sample frames, given in decimal; `∞` is the stored `0xFFFFFFFF` repeat
count. Approximate durations use the bank's 44.1 kHz sample-rate field and
16 decoded frames per 9-byte VADPCM packet.

| Slot | Sample ROM | Encoded bytes | Approx. seconds | Loop start/end (decimal frames) | Repeats |
|---:|---:|---:|---:|---|---|
| 12 | `0x0AC648` | `0x4A476` | 12.26 | — | none |
| 13 | `0x0F6AC0` | `0x6AFB0` | 17.66 | 93122 / 778997 | ∞ |
| 51 | `0x1A3988` | `0x7A28C` | 20.17 | 0 / 889532 | ∞ |
| 52 | `0x21DC18` | `0x618A0` | 16.11 | 0 / 710245 | ∞ |
| 53 | `0x27F4B8` | `0x44BD4` | 11.35 | 0 / 500530 | ∞ |
| 54 | `0x2C4090` | `0x59C86` | 14.82 | 0 / 653765 | ∞ |
| 55 | `0x31DD18` | `0x39342` | 9.45 | 158 / 416543 | ∞ |
| 56 | `0x357060` | `0x3992A` | 9.51 | 1657 / 419216 | ∞ |
| 98 | `0x3BAF60` | `0x36292` | 8.94 | 79182 / 394358 | ∞ |
| 124 | `0x40D730` | `0x4ED06` | 13.01 | 0 / 573886 | ∞ |
| 125 | `0x45C438` | `0x44850` | 11.31 | 6102 / 498928 | ∞ |
| 126 | `0x4A0C88` | `0x4448E` | 11.28 | 0 / 497211 | ∞ |

The long-slot IDs are absent as immediate arguments at approximately 285
direct cue-wrapper call sites, but this is not proof they are unused: the
game can obtain IDs from scene data or runtime state. Their names, level
associations, and music-versus-ambience roles remain **Unknown**.

## 6. Unused and hidden content

### 6.1 Unreferenced assets

No asset inside the indexed scene span has been proven unreferenced. A full
reference audit of shared-resource spans A/B/C has not been completed.
The repeating text after the final indexed scene is outside all 32 scene
members and begins exactly at `0xBFCAD0`; it is post-asset ROM filler by
location, not a discovered gameplay asset.

### 6.2 Cut or inaccessible levels

The catalog has 32 nonempty members, including `End Game (Cut 02)` at
ID `0x0C`. No member has yet been proven inaccessible. Numeric gaps in
chapter labels are not evidence of cut levels. More control-flow work is
needed before classifying catalogued cutscenes as unused.

### 6.3 Debug features

The ROM preserves explicit scene labels and per-build version strings.
No accessible debug menu, controller code, or diagnostic scene has been
verified. The scene labels themselves are not a debug-feature claim.

### 6.4 Prototype or revision-specific content

Verified from ROM bytes: USA V1.0 stores `SotE Oct 17 1996`; later USA
revisions store `v21Oct96.1827` and `v31Oct96.1141`; Europe stores
`v26Dec96.1321` along with `American/European` and `PAL version` text.
The four releases share the 32-label catalog. Prototype-only content has not
been examined for this manual.

The USA V1.0 tail `[0xBFCAD0, 0xC00000)` repeats a text block every
`0x4BC` bytes, beginning `This space intentionally left blank...` and
including many repetitions of `Baby Wampas!`. Twelve block starts occur;
the last is truncated at the ROM boundary. This is an easter egg in ROM
padding. Whether code ever intentionally displays it remains unverified.

## 7. nviewer implementation

### 7.1 Module mapping

`src/rom/shadows/archive.ts` locates `Ogre` per release and uses
`codecs.ts` to decode the 32 scenes and shared image archive.
`scene.ts`, `geometry.ts`, and `texture.ts` read `LStb` graph nodes,
static render meshes, and material-bound base tiles. `shadows.ts` presents
levels through `src/rom/index.ts`; `music.ts` decodes the indexed libultra
cue bank. Four documented releases are recognized by ROM code and revision.

### 7.2 Supported features

The sidebar exposes all 32 catalog entries, including cutscenes and the menu.
Static scene-graph meshes and five base texture formats are decoded; render
instances belong to a toggleable main layer. Indexed collision polygons
form a separate hidden-by-default layer. The music box exposes all 131
indexed VADPCM cue slots with their stored loop metadata.

### 7.3 Approximations and omissions

Null-index collision records and unclassified graph branches remain omitted
from the collision overlay. Mipmapped image resources currently use their
base tile; precise blend/depth state, dynamic
actors, authored camera paths and complete cutscene setup are not reproduced.
For static inspection, the viewer includes unique geometry from potentially
runtime-activated branches. It suppresses only dormant untextured placements
whose transformed geometry and vertex colours exactly match an enabled
textured placement; this union is not one authored gameplay frame. Indexed
collision traverses those branches independently.
Cue labels use slot IDs because no song names or level associations are
verified. The player uses linear sample-rate conversion and omits runtime
pitch, envelope and fade scheduling.

## 8. Verification and remaining work

### 8.1 Verification evidence

| Subject | Method | Result |
|---|---|---|
| Release identity | normalized ROM bytes and full-file SHA-1 | Four images identified; `Ogre` roots and build strings located per release. |
| ROM map and scenes | root-table arithmetic and complete scene extraction | 32 contiguous members; every decoded member begins `LStb`, has valid paired lengths, and all 13 pointers resolve inside its member. |
| Main codec | boot disassembly plus full decode/RAM comparison | `0xEBEC0` decoded bytes; initial `0xCE04F` bytes match menu RAM; 262 total differing runtime bytes. |
| Scene codecs | boot disassembly plus full bounded decoding | ID 00 LZSS gives `0x2A0F0` bytes; IDs 01–31 LZHUF reach exact advertised sizes. |
| Cross-release decoder | complete scene load and independent extraction comparison | All 128 indexed scenes decode and pass `LStb` bounds; USA V1.0's 32 decoded scenes are byte-identical to independent extracts. |
| Menu scene | captured RAM and decoded ROM member comparison | First `0x130` bytes at `0x80195F90` match; later bytes include 791 differences. |
| Active Hoth scene | captured emulator frame | Snow terrain, clouded blue sky, rear-chase camera, live HUD. |
| Geometry sample | scene-pointer walk, main-program dispatch cross-reference, and bounded command/index verification | Eight Hoth mesh records with ordered bounds; Hoth and menu vertex/primitive streams resolve within their scenes. |
| Graph and materials | tagged-node traversal, pointer/index checks, RDP display lists and cross-scene survey | Hoth graph references 662 render meshes; 1,077 distinct image IDs resolve to the decoded shared-A catalog in a 32-scene structural scan. |
| Collision | gameplay-query disassembly, 32-scene indexed-polygon audit, and loader comparison | 15,963 indexed records yield 117,387 visualization triangles with no invalid pool references; the viewer matches those totals, while the null-index path remains unrendered. |
| Audio bank and driver | complete `B1` bank walk, sample bounds, program disassembly | 131 slots, 98 VADPCM waves, ROM-streamed samples and direct slot cue manager. |
| Revisions | root-table and byte-hash comparison | USA V1.1 scenes and shared assets are identical to V1.0; V1.2 changes all stored scene streams. |

### 8.2 Known unknowns

The primary remaining tasks are to decode the non-indexed collision path,
dynamic objects, scripts, camera paths, lighting and the full render-state policy. Also
unresolved: the meaning of the second `LStb` address range, shared-resource
spans B/C, precise graphics
and audio microcode identities, music-slot names and level assignments,
reachability of individual cutscenes, and what changes in USA V1.2/Europe
scene *content* as opposed to packing.

### 8.3 References

The primary reference is the normalized game ROM identified above. Format
claims are derived from its bytes, the boot and main-program disassembly,
bounded decompression, and comparisons with RAM and a gameplay frame. The
standard libultra `ALBankFile`/`ALWaveTable` terms identify on-ROM structures;
the game-specific driver behavior is derived from its own disassembly.
