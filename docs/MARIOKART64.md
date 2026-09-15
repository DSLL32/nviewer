# Mario Kart 64 (N64, USA): ROM format specification for the level viewer

This document specifies the *Mario Kart 64* formats used by the viewer and records the implemented representation:

- ROM identification, code layout, and how assets are located (there is no file table) with the MIO0 codec;
- the course list and how a course is loaded;
- the course format: compressed vertices, the packed display-list bytecode, textures, the per-course draw recipes and render state;
- collision (built from display lists) with surface types;
- objects at rest and the kart path;
- sky, fog, clouds and the start camera;
- the music driver, with an offline renderer spec and loop points;
- the differences between US, EU V1.0/V1.1 and J V1.0/V1.1;
- the mapping onto `src/rom/`;
- verification evidence, open questions, and unused or hidden content.

**Evidence labels:**

- **Verified:** checked against the ROM bytes (decoded data, disassembly) or the running game (emulator RAM, screenshots, audio captures); the method is named.
- **Decomp:** read from the public decompilation (github.com/n64decomp/mk64, which builds US, EU V1.0 and EU V1.1 byte-identically); strong, but not independently re-checked where so labelled.
- **Leak-supported:** rests only on the source-tree leak (`~/bbgames/mk64`, a Nintendo build tree with iQue/Chinese localisation, plus an older snapshot in its `kimura.lzh`).
- **Hypothesis:** inference.

**Research material** is under `/home/n64/.ai-tmp/r49/mk64/`:

| path | contents |
|---|---|
| `roms/` | symlinks to the five ROMs |
| `decomp/` | public decompilation at commit `58cfcb022e10f83bc3b889d7e97508cae6837098` (no assets) |
| `leak/kimura/` | the leak's `kimura.lzh`, extracted |
| `fs/` | ROM identification, code layout, codecs, version diff; `fs/proto/mk64fs.ts` is the reusable decoder |
| `files/us/` | every course's decoded segments with `index.txt` |
| `lv/` | geometry, render recipes, collision; `lv/proto/mk64level.ts` is the prototype loader; `lv/renders/` |
| `ob/` | objects, kart path, environment, start camera |
| `ob2/` | resumed targeted object/environment closure and reproducible commands |
| `rt/` | emulator captures: screenshots, RAM dumps, audio dumps |
| `emu2/` | resumed runtime validation using only the repository emulator interface |
| `mus/` | music: prototype renderer and WAVs |
| `mus2/` | comparison of existing game audio with the offline renderer |
| `unused2/` | final unused/hidden-content audit |
| `archive_cut/` | bbgames/Kimura non-retail and alternate-course audit |
| `*/notes/*.md` | detailed notes per topic |

Unless marked, addresses are US. RAM addresses are KSEG0 (0x80...), ROM offsets are into the big-endian `.z64`, and a segmented address `0xSSoooooo` is offset `oooooo` into segment `SS` as loaded for a race (§3.4).

## 0. At a glance

Mario Kart 64 stores each of its 20 playable courses as six related resources selected by a fixed 20-entry course
table: compressed course data (segment 6), a raw offsets file (segment 9), compressed 14-byte vertices expanded into
segment 4, a compact bytecode expanded into F3DEX display lists in segment 7, and a list of individually MIO0-compressed
textures assembled into segment 5. The four battle arenas use the same format. The award ceremony is a 21st viewer
scene assembled from Royal Raceway geometry and a separate ceremony archive. **Verified** by decoding every resource
and rendering all 21 scenes; Mario Raceway's loaded segments and all 1,291 collision records match an emulator RAM dump.

There is no general filesystem. The relevant tables and blocks are located structurally, so US and both European
revisions can share a loader despite different ROM offsets. Japanese revisions need their own draw-recipe addresses
and include small geometry and texture changes. Course display lists use F3DEX 0.95 and the viewer's existing
`displaylist.ts` understands every opcode they execute. Collision is reconstructed from tagged display-list groups,
not loaded from a separate file. Object placement comes from segment-6 spawn lists, code tables, and the course paths.

The implemented viewer supports the USA revision-0 ROM: all twenty courses plus the award ceremony, hidden course-path
and collision layers, decoded static objects with runtime Y-axis billboards, a camera-centred approximation of the
screen-space sky gradient, and all 29 music sequences. PAL and Japanese revisions are rejected explicitly: Japanese
draw addresses differ, and PAL's 50 Hz music timing/envelope branches have not been verified. **Verified** by all-level
hash, transfer and layer audits, offline renders of all 21 entries, exact report-camera renders, and browser checks.

## 1. ROM identification

All five dumps are 12 MB (0xC00000) big-endian ROMs with the internal name `MARIOKART64` + 9 spaces. Byte-swapped `.v64` and little-endian `.n64` dumps are normalised first (`normalizeByteOrder`). **Verified** (header bytes, sha1).

| file | game code (0x3B) | version (0x3F) | CRC1 / CRC2 | md5 | sha1 |
|---|---|---|---|---|---|
| Mario Kart 64 (U) | NKTE | 0 | 3E5055B6 / 2E92DA52 | 3a67d9986f54eb282924fca4cd5f6dff | 579c48e211ae952530ffc8738709f078d5dd215e |
| Mario Kart 64 (E) (V1.0) | NKTP | 0 | C3B6DE9D / 65D2DE76 | 8fad1e4fa7baf1443b7f21ad1947b429 | a729039453210b84f17019dda3f248d5888f7690 |
| Mario Kart 64 (E) (V1.1) | NKTP | 1 | 2577C7D4 / D18FAAAE | 2bb149a583fdefea96805f628fe42fd9 | f6b5f519dd57ea59e9f013cc64816e9d273b2329 |
| Mario Kart 64 (J) (V1.0) | NKTJ | 0 | 6BFF4758 / E5FF5D5E | bf964ceca78a13a82055ebda80b95cca | afeeec65b9a03f0cb8ec92f9ba7a9f0122e8bd0e |
| Mario Kart 64 (J) (V1.1) | NKTJ | 1 | C9C3A987 / 5810344C | 60535265bae43ddfcbdb0d71594b1693 | 9f439457585146a4e1da7e1dd9104f7f94381688 |

Common to all five: PI word 80371240, clock 0000000F, entry 0x80000400, release 00001446, and the same IPL3 (0x40-0xFFF, CRC32 0x90BB6CB5: the CIC-NUS-6102/7101 boot code). **The US release has a single revision (V1.0, version byte 0)**; V1.1 exists only for Europe and Japan. The decomp's `mk64.us.sha1` equals the US file's sha1.

Detection: accept `NKTE` at 0x3B (and optionally `NKTP`, §10), then confirm by locating `gCourseTable` by pattern (§3.2); its ROM offset differs in all five ROMs and identifies the version.

## 2. Boot and code

Three code segments, all stored uncompressed. ROM ranges **Verified** from the constants main loads with `lui`/`addiu` pairs (`init_segment_ending` ROM 0x1C78, `init_segment_racing` 0x1CF0, `setup_game_memory` 0x1F10/0x1F30); names Decomp (`mk64.ld`, `include/segments.h`).

| segment | vram | US ROM | size | contents |
|---|---|---|---|---|
| header + IPL3 | - | 0x000000-0x001000 | 0x1000 | |
| main | 0x80000400 | 0x001000-0x0F7510 | 0xF6510 | game code, libultra, audio driver, data, rodata, `rsp.o` (rspboot, F3DEX, F3DLX, aspMain) |
| racing (decomp "code_8028DF00") | 0x8028DF00 | 0x0F7510-0x123640 | 0x2C130 (bss to +0x2C470) | race logic, `render_courses`, actors, skybox, the course loader (`memory.c`), collision, `gCourseTable` |
| ending | 0x80280000 | 0x123640-0x12AAE0 | 0x74A0 | podium ceremony, credits, the ceremony course list |

main: `vram = rom - 0x1000 + 0x80000400`; racing: `vram = rom - 0xF7510 + 0x8028DF00`; ending: `vram = rom - 0x123640 + 0x80280000`. The racing and ending segments are copied from ROM at boot.

Microcode: the ROM holds `RSP Gfx ucode F3DEX         0.95 Yoshitaka Yasumoto Nintendo.` (ROM 0xF4BB0, RAM 0x800F3FB0) and the same string for F3DLX 0.95 (ROM 0xF53B0) (**Verified**, ROM bytes). The leak's `spec` links `gspF3DEX.fifo.o` and `gspF3DLX.fifo.o` into the boot segment (Leak-supported). The decomp builds with the F3DEX 0.95 GBI (`F3DEX_GBI`, `F3D_OLD`).

Useful US RAM addresses (**Verified** by disassembly unless marked):

| address | what |
|---|---|
| 0x800400D0 (ROM 0x40CD0) | `mio0decode(src, dst)` |
| 0x80150258 | `gSegmentTable[16]` (physical base per RSP segment) |
| 0x800DC5A0 | `gCurrentCourseId` (s16) |
| 0x800DC604 | `gIsMirrorMode` |
| 0x800F2BB4 (ROM 0xF37B4) | `gCupCourseOrder[5][4]` (s16) |
| 0x802A9B78 | `displaylist_unpack` dispatch loop (jump table 0x802B9C94, 89 entries) |
| 0x802B8CE8-0x802B8D7F | the unpacker's template Gfx words (racing rodata) |
| 0x802B8D80 (ROM 0x122390) | `gCourseTable[20]` |
| 0x8015F580 / 0x8015F588 | `gCollisionMesh` / `gCollisionMeshCount` (§6) |

## 3. Filesystem and compression

### 3.1 No file table

Mario Kart 64 has no DMA table. Assets are linked at fixed ROM offsets and located by code:
- common data by `lui`/`addiu` constant pairs in main (`setup_game_memory`, `init_segment_*`);
- course data through `gCourseTable` (racing segment rodata, §3.2);
- course textures by offsets stored in each course's texture list, relative to the `other_textures` ROM block (§3.8);
- the ceremony data and the startup logo by `decompress_segments(start, end)` constant pairs;
- kart textures and TKMK00 menu images by tables in main (not needed by a course viewer).

US ROM map. Ranges marked (D) come only from decomp `mk64.ld` comments; all others are **Verified** (code constants, table decode, stream ends).

| ROM range | what | loaded as |
|---|---|---|
| 0x000000-0x001000 | header, IPL3 | - |
| 0x001000-0x0F7510 | main | RAM 0x80000400 |
| 0x0F7510-0x123640 | racing segment | RAM 0x8028DF00 |
| 0x123640-0x12AAE0 | ending segment | RAM 0x80280000 |
| 0x12AAE0-0x132B50 | data_segment2 (raw, 0x8070 bytes) | segment 2 |
| 0x132B50-0x145470 | common textures (MIO0, decodes to 0x2D158 bytes) | segment D |
| 0x145470-0x63E278 (D) | kart textures and palettes (MIO0 per frame), staff ghost data | segment F offsets |
| 0x641F70-0x724220 | other_textures: course textures, 418 MIO0 streams | segment 5 after decoding |
| 0x724220-0x729A30 (D) | trig tables (raw) | RAM 0x802BA370 |
| 0x729A30-0x7E684F (D) | textures_0a (MIO0: course select and other 2D images) | segment A |
| 0x7FA3C0-0x821D10 | textures_0b: 63 TKMK00 images | segment B |
| 0x821D10-0x825800 | ceremony data (MIO0, decodes to 0x8D88 bytes) | segment B |
| 0x825800-0x8284D0 | startup logo (MIO0, decodes to 0x9480 bytes) | segment 6 on the logo screen |
| 0x8284D0-0x88CD70 | 20 course data streams (MIO0) | segment 6 |
| 0x88CD70-0x88FA10 | 20 course offsets files (raw) | segment 9 |
| 0x88FA10-0x966260 | 20 course vertex blobs (MIO0 CourseVtx + raw packed display list) | segment F (load time only) |
| 0x966260-0xBE9160 | audio data (§9) | audio heap |
| 0xBE9160-0xC00000 | 0xFF fill | - |

All 3354 `MIO0` magics in each ROM are 4-byte aligned, decode without error and none overruns the next stream (**Verified**, `fs/proto/streams.ts`, all five ROMs).

### 3.2 gCourseTable

20 entries of 0x30 bytes at US ROM 0x122390 (RAM 0x802B8D80), followed by an all-zero entry: the award ceremony (id 20) has no entry. **Verified** by decoding all 20 entries in all five ROMs (and by the raw bytes of entries 0 and 1).
```
+0x00 u32 dlRomStart        ROM offset of the MIO0 course-data stream -> segment 6
+0x04 u32 dlRomEnd          = next course's dlRomStart = align16(stream end)
+0x08 u32 vertexRomStart    ROM offset of the vertex blob (copied raw -> segment F)
+0x0C u32 vertexRomEnd      = align16(end of the packed display list)
+0x10 u32 offsetsRomStart   ROM offset of the offsets file (raw -> segment 9)
+0x14 u32 offsetsRomEnd
+0x18 u32 vertexStart       always 0x0F000000: the CourseVtx MIO0 stream starts the blob
+0x1C u32 vertexCount
+0x20 u32 packedStart       0x0F......: the packed display list, at align4(end of the CourseVtx stream)
+0x24 u32 finalDisplaylistOffset   offset of the last Gfx of the unpacked list (unpacked size - 8)
+0x28 u32 textures          always 0x09000000: the texture list starts the offsets file
+0x2C u16 unknown1          1 for Choco Mountain and Banshee Boardwalk, else 0; passed to unpack handlers that ignore it
+0x2E u16 padding           0
```
Pattern search (unique in all five ROMs): +0x18 = 0x0F000000, +0x28 = 0x09000000, +0x00 and +0x08 point at `MIO0`, and the next entry's +0x00 equals this entry's +0x04.

Size checks that pass for every course of every ROM (**Verified**, `fs/proto/extract.ts`):
- `align16(dlRomStart + MIO0 bytes consumed) == dlRomEnd`;
- decoded CourseVtx size == vertexCount x 14; `align4(stream end) == packedStart`;
- `align16(packedStart + packed bytes incl. the 0xFF terminator) == vertexRomEnd - vertexRomStart`;
- unpacked Gfx bytes == finalDisplaylistOffset + 8, with no undefined packed opcode;
- every texture decodes to its listed size, and its stream fits in align16(compressedSize);
- US/EU: the leak's generated headers `include/KTn.h` match exactly (`VTX_NUMBER` = vertexCount, `VTX_ROM_SIZE` = CourseVtx stream length, `GFX_ROM_SIZE` = packed bytes, `GFX_RAM_SIZE` = finalDisplaylistOffset, `TRI_NUMBER` = triangles in the unpacked list, `TEXT_NUMBER` = texture-list entries), so leak course KTn = course id n - 1.

### 3.3 Per-course data (US)

| id | course | entry ROM | course data MIO0 (ROM) | seg 6 bytes | vertex blob (ROM) | vertices | packed bytes | Gfx (unpacked bytes) | triangles | textures (seg 5 bytes) | offsets file (ROM, bytes) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | Mario Raceway | 122390 | 8284D0-82B620 | 38904 | 88FA10-89B510 | 5757 | 9213 | 3367 (0x6938) | 2549 | 30 (92160) | 88CD70-88D070 (768) |
| 1 | Choco Mountain | 1223C0 | 82B620-82DF40 | 29960 | 89B510-8A7640 | 5560 | 8312 | 2910 (0x5AF0) | 2397 | 20 (57344) | 88D070-88D340 (720) |
| 2 | Bowser's Castle | 1223F0 | 82DF40-831DC0 | 38144 | 8A7640-8B9630 | 9527 | 15482 | 4900 (0x9920) | 4792 | 28 (63488) | 88D340-88D6C0 (896) |
| 3 | Banshee Boardwalk | 122420 | 831DC0-835BA0 | 46560 | 8B9630-8C2510 | 4945 | 9719 | 3689 (0x7348) | 2668 | 22 (57344) | 88D6C0-88D9C0 (768) |
| 4 | Yoshi Valley | 122450 | 835BA0-83F740 | 99808 | 8C2510-8CC900 | 3720 | 9809 | 4140 (0x8160) | 2456 | 14 (36864) | 88D9C0-88DAB0 (240) |
| 5 | Frappe Snowland | 122480 | 83F740-842E40 | 31520 | 8CC900-8D8E50 | 5529 | 10273 | 3274 (0x6650) | 3183 | 8 (20480) | 88DAB0-88DB40 (144) |
| 6 | Koopa Troopa Beach | 1224B0 | 842E40-84ABD0 | 104392 | 8D8E50-8EC390 | 9376 | 14266 | 5720 (0xB2C0) | 3608 | 16 (40960) | 88DB40-88DC50 (272) |
| 7 | Royal Raceway | 1224E0 | 84ABD0-84E8E0 | 57312 | 8EC390-8FE640 | 8306 | 13891 | 5670 (0xB130) | 3514 | 43 (131072) | 88DC50-88E120 (1232) |
| 8 | Luigi Raceway | 122510 | 84E8E0-852E20 | 66224 | 8FE640-90B3E0 | 5936 | 13719 | 6376 (0xC740) | 3022 | 40 (133120) | 88E120-88E590 (1136) |
| 9 | Moo Moo Farm | 122540 | 852E20-857E80 | 83744 | 90B3E0-91B980 | 7972 | 10917 | 3304 (0x6740) | 3219 | 28 (86016) | 88E590-88E8D0 (832) |
| 10 | Toad's Turnpike | 122570 | 857E80-8666A0 | 146464 | 91B980-928C70 | 6359 | 11542 | 3427 (0x6B18) | 3732 | 19 (61440) | 88E8D0-88ECD0 (1024) |
| 11 | Kalimari Desert | 1225A0 | 8666A0-86ECF0 | 144288 | 928C70-936FD0 | 6393 | 12230 | 5328 (0xA680) | 2932 | 25 (90112) | 88ECD0-88EFB0 (736) |
| 12 | Sherbet Land | 1225D0 | 86ECF0-872A00 | 40160 | 936FD0-93CC60 | 2678 | 4745 | 1803 (0x3858) | 1276 | 10 (22528) | 88EFB0-88F2A0 (752) |
| 13 | Rainbow Road | 122600 | 872A00-8804A0 | 91512 | 93CC60-9438C0 | 3111 | 4610 | 1057 (0x2108) | 1634 | 5 (12288) | 88F2A0-88F300 (96) |
| 14 | Wario Stadium | 122630 | 8804A0-885630 | 52536 | 9438C0-951780 | 6067 | 13541 | 5272 (0xA4C0) | 3655 | 20 (59392) | 88F300-88F600 (768) |
| 15 | Block Fort | 122660 | 885630-885780 | 352 | 951780-953890 | 1088 | 2089 | 699 (0x15D8) | 633 | 7 (14336) | 88F600-88F680 (128) |
| 16 | Skyscraper | 122690 | 885780-8858A0 | 328 | 953890-955620 | 1086 | 1809 | 548 (0x1120) | 576 | 23 (73728) | 88F680-88F800 (384) |
| 17 | Double Deck | 1226C0 | 8858A0-885A10 | 384 | 955620-956670 | 555 | 883 | 234 (0x750) | 299 | 2 (4096) | 88F800-88F830 (48) |
| 18 | D.K.'s Jungle Parkway | 1226F0 | 885A10-88CC50 | 83664 | 956670-963EF0 | 5679 | 13342 | 4997 (0x9C28) | 3744 | 24 (81920) | 88F830-88F9C0 (400) |
| 19 | Big Donut | 122720 | 88CC50-88CD70 | 288 | 963EF0-966260 | 1165 | 2028 | 528 (0x1080) | 696 | 4 (8192) | 88F9C0-88FA10 (80) |

"triangles" counts G_TRI1 + 2 x G_TRI2 in the whole unpacked list; it equals the leak's `TRI_NUMBER`.

### 3.4 How a course is loaded

Decomp `load_course` (`src/racing/memory.c`), `setup_game_memory` (`src/main.c`), `setup_race`; the unpacker, templates and jump table are **Verified** by disassembly. RAM placement is Decomp (the actual bases are read from `gSegmentTable` in the RAM dumps, §12).

At boot, `setup_game_memory` sets up the memory pool (up to 0x80242F00), copies the trig tables to 0x802BA370, copies data_segment2 raw into the pool as segment 2 and decodes the common textures into the pool as segment D.

`setup_race` calls `load_course(id)` when the course changes, then `course_generate_collision_mesh()` (§6):
1. `gHeapEndPtr = 0x8028DF00` (0x80280000 for the ending and credits); the pool pointer restarts after segment D.
2. Segment 9 = raw copy of the offsets file.
3. Segment 6 = the decoded course-data stream (skipped in the ending game state).
4. The vertex blob is copied raw into the pool = segment F.
5. `decompress_vtx`: the CourseVtx stream at segF+0 is decoded into the pool, then expanded (§3.6) to `gHeapEndPtr -= align16(count x 16)` = segment 4.
6. `displaylist_unpack(packedStart, finalDisplaylistOffset)` writes F3DEX Gfx to `gHeapEndPtr -= align16(final) + 8` = segment 7.
7. `decompress_textures(list)`: `gHeapEndPtr -= total size`; each list entry's stream is read from `other_textures ROM + (image & 0xFFFFFF)` and decoded back to back = segment 5.
8. The pool pointer is reset to its value before step 4 (segment F and the CourseVtx are scratch).

| seg | contents during a race | source |
|---|---|---|
| 1 | per-frame graphics pool | code |
| 2 | data_segment2 | ROM, raw |
| 3 | actor textures | code |
| 4 | expanded course vertices (16-byte Vtx) | CourseVtx |
| 5 | course textures, back to back | texture list, one MIO0 stream per texture |
| 6 | course data: F3DEX section lists, TrackSections, path points, spawn lists, object models | MIO0 |
| 7 | unpacked course Gfx | packed bytecode |
| 9 | offsets file: texture list, section Gfx* tables | ROM, raw |
| B | ceremony data (podium and credits only) | MIO0 |
| D | common textures | MIO0 |
| F | vertex blob (only during `load_course`) | ROM, raw |

Course assets are position-independent within their segments: a static loader needs only the segment-to-file map (`courseSpace` in `fs/proto/mk64fs.ts`).

The podium ceremony (`load_ceremony_cutscene`, Decomp) sets `gCurrentCourseId` to Royal Raceway (7), loads that course, loads the ceremony data as segment B and then **replaces segment 6** with Banshee Boardwalk's course-data stream. It draws a fixed list in the ending segment that calls only Royal Raceway packed lists (§5.3), so segment 6 does not matter for its geometry. The credits (`load_credits`) load a race course and draw it with `render_course_credits`.

### 3.5 MIO0

**Verified**: the TypeScript decoder reproduces every stream in all five ROMs; the game routine `mio0decode` (0x800400D0) reads the header fields as below.
```
+0x00 "MIO0"
+0x04 u32 decompressedSize
+0x08 u32 backrefOffset   (from the header start)
+0x0C u32 literalOffset
+0x10 control stream: u32 BE words, bits consumed MSB first
bit 1: copy one byte from the literal stream
bit 0: u16 v from the back-reference stream; copy (v >> 12) + 3 bytes, one at a time, from out[pos - (v & 0xFFF) - 1]
```
This is the same codec as Star Fox 64 (STARFOX.md §3.2): one shared decoder serves both games. Streams are contiguous (control words, back-references, literals), padded to 16 bytes (course and texture streams) or not padded (CourseVtx streams, followed by the packed list at the next 4-byte boundary).

### 3.6 Vertices: CourseVtx to Vtx

The CourseVtx stream decodes to vertexCount x 14 bytes (**Verified**, all courses). Expansion per Decomp `func_802A86A8`:
```
CourseVtx (14 bytes): s16 x, y, z; s16 s, t; u8 ca[4]
Vtx (16 bytes, segment 4): s16 x, y, z; u16 flag; s16 s, t; u8 r, g, b, a
  x    = mirror mode ? -x : x          (a viewer ignores mirror mode)
  y    = (s16)(y * vtxStretchY)        (1.0 in normal play)
  flag = (ca[0] & 3) | ((ca[1] & 3) << 2)
  r    = ca[0] & 0xFC;  g = ca[1] & 0xFC;  b = ca[2];  a = 0xFF   (ca[3] ignored)
```
The 4-bit flag is used only by collision (§6.4). Some lists get their vertex alpha and colour rewritten after loading (§5.6).

### 3.7 Packed display lists

A byte stream: an opcode, then 0-4 argument bytes; 0xFF ends it. Undefined opcodes (0x31, 0x32, 0x59-0xFE) are skipped without arguments. The output is F3DEX 0.95 Gfx in segment 7; addresses inside the stream are segment-relative. Handler grouping **Verified** by disassembly (one handler per row); the constant words **Verified** against the templates in ROM; field layouts Decomp (`memory.c`) and consistent with every course unpacking to exactly the table's size and the leak's triangle count.

| op | args | emits | used by retail data |
|---|---|---|---|
| 0x00-0x14 | 0 | `BC000002 80000040` (gsSPNumLights(1)), then two G_MOVEMEM light loads from `0x09000000 + op * 0x18` | no |
| 0x15 | 0 | `FC121824 FF33FFFF` combiner MODULATERGBA (= MODULATEIA) | yes |
| 0x16 | 0 | `FC127E24 FFFFF3F9` combiner MODULATERGBDECALA (= MODULATEIDECALA) | yes |
| 0x17 | 0 | `FCFFFFFF FFFE793C` combiner SHADE | yes |
| 0x18 | 0 | `B900031D 00552078` render mode AA_ZB_OPA_SURF(2) | yes |
| 0x19 | 0 | `B900031D 00553078` render mode AA_ZB_TEX_EDGE(2) | yes |
| 0x1A-0x1F, 0x2C | 2 | `E8000000 0` (TILESYNC), G_SETTILE (render tile 0), G_SETTILESIZE | yes |
| 0x20-0x25 | 3 | G_SETTIMG, TILESYNC, G_SETTILE (load tile), `E6000000 0` (LOADSYNC), G_LOADBLOCK | yes |
| 0x26 | 0 | `BB000001 FFFFFFFF` gsSPTexture(0xFFFF, 0xFFFF, 0, 0, G_ON) | yes |
| 0x27 | 0 | `BB000000 00010001` gsSPTexture(1, 1, 0, 0, G_OFF) | yes |
| 0x28 | 4 | G_VTX: w0 = `04 << 24 \| (v0 * 2) << 16 \| ((n << 10) + 16n - 1)`, w1 = `04000000 + u16le(b0, b1) * 16`; n = b2 & 0x3F, v0 = b3 & 0x3F | yes |
| 0x29 | 2 | G_TRI1 `BF000000`, `a*2 << 16 \| b*2 << 8 \| c*2` | yes |
| 0x2A | 0 | `B8000000 0` G_ENDDL | yes |
| 0x2B | 2 | G_DL `06000000`, `07000000 + u16le * 8` | yes |
| 0x2D | 0 | `BE000000 00000140` gsSPCullDisplayList(0, 7) | no |
| 0x2E | 0 | `FC127E24 FFFFF3F9` (as 0x16, separate template) | no |
| 0x2F | 0 | `B900031D 005049D8` AA_ZB_XLU_SURF | no |
| 0x30 | 3 | G_QUAD `B5000000`, indices as below | no |
| 0x33-0x52 | 2 | G_VTX with n = op - 0x32 (1..32), v0 = 0, address as 0x28 | yes |
| 0x53 | 0 | `FCFFFFFF FFFCF279` DECALRGBA | no |
| 0x54 | 0 | `B900031D 00442D58` AA_ZB_OPA_DECAL | no |
| 0x55 | 0 | `B900031D 00404DD8` AA_ZB_XLU_DECAL | no |
| 0x56 | 0 | `B7000000 00002000` set G_CULL_BACK | no |
| 0x57 | 0 | `B6000000 00002000` clear G_CULL_BACK | Frappe Snowland (2) |
| 0x58 | 4 | G_TRI2 `B1 \| a0*2 << 16 \| a1*2 << 8 \| a2*2`, `c0*2 << 16 \| c1*2 << 8 \| c2*2` | yes |
| 0xFF | - | end of stream | |

Triangle indices (0x29 and each half of 0x58): two bytes `b0 b1` hold three 5-bit indices: `first = b0 & 0x1F`, `mid = (b0 >> 5) | ((b1 & 3) << 3)`, `last = (b1 >> 2) & 0x1F`. The triangle is (first, mid, last), or (last, mid, first) in mirror mode. The quad (0x30) uses the same packing for x0..x2 plus `x3 = ((b1 >> 7) & 1) | ((b2 & 0xF) << 1)`, emitted as (x3, x0, x1, x2). Vertex indices are therefore 0..31, and no list loads more than 32 vertices at a time.

Tile commands (0x1A-0x1F, 0x2C): `b0 = masks << 4 | cms`, `b1 = maskt << 4 | cmt`.

| op | size | format | tmem |
|---|---|---|---|
| 0x1A / 0x1B / 0x1C | 32x32 / 64x32 / 32x64 | RGBA16 | 0 |
| 0x1D / 0x1E / 0x1F | 32x32 / 64x32 / 32x64 | IA16 | 0 |
| 0x2C | 32x32 | RGBA16 | 0x100 (Moo Moo Farm only: a second texture that the calling segment-6 list preloads on load tile 6) |

```
G_SETTILE     w0 = F5 << 24 | fmt << 21 | 2 << 19 | line << 9 | tmem      line = (width * 2 + 7) >> 3
              w1 = cmt << 18 | maskt << 14 | cms << 8 | masks << 4          (render tile 0)
G_SETTILESIZE w0 = F2000000, w1 = ((width - 1) << 2) << 12 | (height - 1) << 2
```
Load commands (0x20-0x25, the same size and format order as 0x1A-0x1F): `b0 = texture index`, `b1` ignored, `b2 = tile << 4 | tmem`:
```
G_SETTIMG   w0 = FD << 24 | fmt << 21 | 2 << 19,  w1 = 0x05000000 + (b0 << 11)
G_SETTILE   w0 = F5 << 24 | fmt << 21 | 2 << 19 | tmem,  w1 = tile << 24      (retail: tile 7, tmem 0)
G_LOADBLOCK w0 = F3000000, w1 = tile << 24 | min(w * h - 1, 0x7FF) << 12 | dxt   dxt = 256 (32 wide) or 128 (64 wide)
```
The texture address is `segment 5 + index x 0x800`: every course texture is 0x800 or 0x1000 bytes and segment 5 packs them back to back, so the index is exact (**Verified**: every load resolves to the start of a texture-list entry).

Caution: the decomp's packer tool (`tools/displaylist_packer.c`) swaps 0x26 and 0x27 and differs elsewhere; the game's unpacker above is authoritative (**Verified** against the ROM templates).

### 3.8 Texture lists and segment 5

The offsets file (segment 9) starts with the texture list (**Verified**, all courses):
```
16 bytes per entry, terminated by an all-zero entry:
+0x0 u32 image            0x0F offset into other_textures: ROM = otherTexturesBase + (image & 0xFFFFFF)
+0x4 u32 compressedSize   MIO0 stream bytes (the game copies align16 of it)
+0x8 u32 size             decoded bytes: 0x800 (32x32) or 0x1000 (64x32, 32x64)
+0xC u32 0
```
The segment-5 offset of entry k is the sum of align16(size) of the entries before it. The rest of the offsets file holds the section Gfx* tables (§5.2). The other_textures base per version is found by searching for the unique base at which every Mario Raceway entry points at a MIO0 stream of the listed size: US 0x641F70 (**Verified**; the other versions in §10).

### 3.9 TKMK00

63 `TKMK00` images at US ROM 0x7FA3C0-0x821D10 (**Verified** count and range) are decoded by `tkmk00decode` (main) into RGBA16 for menus (player select, options, character names). Header (Decomp `tools/libtkmk00.c`): `"TKMK00"`, u8 flags at +6, u16 width at +8, u16 height at +0xA, 8 x u32 stream offsets at +0xC, u32 bit flags at +0x2C, data from +0x30. No course, collision or 3D asset uses TKMK00; the viewer does not need a decoder.

### 3.10 Extracting everything

`cd /home/n64/.ai-tmp/r49/mk64/fs/proto && npx tsx extract.ts` decodes every course of every ROM in about 3 s, checks all sizes of §3.2 and writes `files/us/` (per course: `seg6_course_data.bin`, `seg9_offsets.bin`, `segF_vertex_packed.bin`, `course_vtx14.bin`, `packed_dl.bin`, `seg4_vtx.bin`, `seg7_gfx.bin`, `seg5_textures.bin`, `textures/*.bin`; common: `seg2_data_segment2.bin`, `segD_common_textures.bin`, `segB_ceremony_data.bin`, `seg6_startup_logo.bin`) with an `index.txt` of sizes and sha1. It reports "ALL CHECKS OK" for US and both EU versions.

## 4. Courses

### 4.1 Course list

`gCurrentCourseId` indexes every per-course table. Names **Verified** as ROM strings (`gCourseNames`, stored in lower case, e.g. `mario raceway`); debug names (`gDebugCourseNames`) **Verified** in all five ROMs; cup order **Verified** from the bytes of `gCupCourseOrder` (US ROM 0xF37B4: `8 9 6 11 / 10 5 1 0 / 14 12 7 2 / 18 4 3 13 / 19 15 17 16`). Leak numbering **Verified** by the `KTn.h` counts; the ceremony is the leak's `RESULT`.

| id | name | debug name | cup (slot) | kind | leak |
|---|---|---|---|---|---|
| 0 | Mario Raceway | m circuit | Flower (4) | race | KT1 |
| 1 | Choco Mountain | mountain | Flower (3) | race | KT2 |
| 2 | Bowser's Castle | castle | Star (4) | race | KT3 |
| 3 | Banshee Boardwalk | ghost | Special (3) | race | KT4 |
| 4 | Yoshi Valley | maze | Special (2) | race | KT5 |
| 5 | Frappe Snowland | snow | Flower (2) | race | KT6 |
| 6 | Koopa Troopa Beach | beach | Mushroom (3) | race | KT7 |
| 7 | Royal Raceway | p circuit | Star (3) | race | KT8 |
| 8 | Luigi Raceway | l circuit | Mushroom (1) | race | KT9 |
| 9 | Moo Moo Farm | farm | Mushroom (2) | race | KT10 |
| 10 | Toad's Turnpike | highway | Flower (1) | race | KT11 |
| 11 | Kalimari Desert | desert | Mushroom (4) | race | KT12 |
| 12 | Sherbet Land | sherbet | Star (2) | race | KT13 |
| 13 | Rainbow Road | rainbow | Special (4) | race | KT14 |
| 14 | Wario Stadium | stadium | Star (1) | race | KT15 |
| 15 | Block Fort | block | Battle (2) | battle | KT16 |
| 16 | Skyscraper | skyscraper | Battle (4) | battle | KT17 |
| 17 | Double Deck | deck | Battle (3) | battle | KT18 |
| 18 | D.K.'s Jungle Parkway | jungle | Special (1) | race | KT19 |
| 19 | Big Donut | doughnut | Battle (1) | battle | KT20 |
| 20 | Award Ceremony (podium at Royal Raceway) | - | - | other | RESULT |

There is no test/debug course slot in the retail table or selector: the course table ends after 20 entries, and the debug course menu cycles ids 0..19 only (Decomp `menus.c`; §14.1).

### 4.2 Suggested sidebar

`LevelInfo.name` is the course name; `group` is the cup.

| group | kind | entries, in cup order |
|---|---|---|
| Mushroom Cup | race | Luigi Raceway (8), Moo Moo Farm (9), Koopa Troopa Beach (6), Kalimari Desert (11) |
| Flower Cup | race | Toad's Turnpike (10), Frappe Snowland (5), Choco Mountain (1), Mario Raceway (0) |
| Star Cup | race | Wario Stadium (14), Sherbet Land (12), Royal Raceway (7), Bowser's Castle (2) |
| Special Cup | race | D.K.'s Jungle Parkway (18), Yoshi Valley (4), Banshee Boardwalk (3), Rainbow Road (13) |
| Battle | battle | Big Donut (19), Block Fort (15), Double Deck (17), Skyscraper (16) |
| Other | other | Award Ceremony (20) |

### 4.3 Other 3D scenes

- **Startup logo** (segment 6 from US ROM 0x825800): the spinning "Mario Kart 64" logo; lists at seg6+0x2B00, 0x2C88, 0x2D58, 0x2F20, 0x2FF0 (Decomp `startup_logo.yml`). Optional.
- **Award ceremony**: Royal Raceway geometry from the ending list plus the podium and trophies from segment B (§5.3, §7).
- **Credits**: race courses drawn with `render_course_credits` (one whole-course list per course, incomplete, §5.2).

The title screen and menus are 2D.

## 5. Course geometry and render state

### 5.1 Microcode, vertices, units

- **Microcode:** F3DEX 0.95. Course lists use F3DEX 1.x opcodes (G_VTX 0x04, G_TRI1 0xBF, G_TRI2 0xB1, G_DL 0x06, G_ENDDL 0xB8).
- **Vertices:** standard 16-byte Vtx (§3.6). Vertex colours are colours: every course draw function clears G_LIGHTING, so there is no RSP lighting on course geometry.
- **Units and axes:** 1 vertex unit = 1 world unit, no scaling; right-handed, Y up; **no mirroring**. **Verified** visually: signs read correctly ("MARIO STAR", "Luigi's", "Nintendo", DK's arrow signs) with X unmirrored, and the start-line stripe lies across the first path point (e.g. Mario Raceway (0, 0, -232), the path heading -Z). Courses span about ±5000 units.

### 5.2 What makes up a static course

The game draws only the part of a course around the camera:
- `render_course_segments(table)` draws one entry of a Gfx* table: `table[(section - 1) * 4 + direction]`, where `section` is the path section id of the collision triangle under the camera (§6.1 `sectionId`) and `direction` is the camera yaw quadrant (0 south, 1 east, 2 north, 3 west). Each entry is a segment-6 list that sets a texture and calls the packed lists visible from there.
- Per-course draw functions (`render_<course>`, Decomp `src/racing/render_courses.c`) add unconditional lists and state.
- A second pass after karts and objects (`func_8029122C`) draws translucent parts: water, ice, Rainbow Road, the Wario Stadium screen frame.
- The credits instead draw one whole-course segment-6 list per race course.

**Coverage** (**Verified**, `lv/proto/coverage.ts`): the credits lists are incomplete (Mario Raceway 1856 of 2549 triangles, Yoshi Valley 1944 of 2456). The union of every section-table entry (all sections x 4 directions) plus the unconditional lists reaches more (Mario Raceway 2370, Yoshi Valley 2440, Moo Moo Farm all 3219). Remaining lists include multiplayer, mode-specific and camera-state variants plus small fragments whose reachability is unresolved (§14).

**Viewer recipe** (prototype `lv/proto/mk64level.ts`, **Verified** by renders of all 21 courses):
1. For each step of the course's draw function and of the second pass, take the accumulated state words and the step's lists; for a table step, take every distinct table entry.
2. Run each through `runDisplayList` (unmodified) and keep each triangle once, keyed by its source command address and three positions. If any draw of that triangle has culling off, emit it unculled.
3. Put camera-dependent lists in a hidden layer, and translucent second-pass lists in their own layer.

| id | course | TrackSections (seg 6) | path sections | section Gfx* table | credits list | drawn triangles | textures | bounds |
|---|---|---|---|---|---|---|---|---|
| 0 | Mario Raceway | 0x06009650 x53 | 17 | 0x090001F0 x68 | 0x06009348 | 2370 | 30 | (-1479, -50, -1949)..(4325, 255, 2721) |
| 1 | Choco Mountain | 0x060072D0 x71 | 24 | 0x09000150 x96 | 0x060071B8 | 2316 | 20 | (-1015, -80, -1553)..(2096, 250, 1400) |
| 2 | Bowser's Castle | 0x060093D8 x37 | 27 | 0x090001D0 x108 | 0x06009148 | 4613 | 28 | (-1553, -151, -2820)..(3848, 420, 2413) |
| 3 | Banshee Boardwalk | 0x0600B458 x49 | 25 | 0x09000170 x100 | 0x0600B308 | 2610 | 22 | (-3657, -82, -2607)..(653, 220, 2007) |
| 4 | Yoshi Valley | 0x06018240 x54 | 31 | 0x060183F0 x124 | 0x06018020 | 2440 | 14 | (-4606, -500, -3761)..(1528, 600, 2373) |
| 5 | Frappe Snowland | 0x060079A0 x48 | 17 | 0x06007890 x68 | 0x060076A0 | 3130 | 8 | (-3722, -50, -3722)..(3122, 300, 3122) |
| 6 | Koopa Troopa Beach | 0x06018FD8 x106 | 37 | 0x06019328 x148 (opaque), 0x06019578 x148 (water) | 0x06018D68 | 3481 | 15 | (-4318, -100, -3127)..(3294, 238, 4485) |
| 7 | Royal Raceway | 0x0600DC28 x119 | 33 | 0x090002C0 x132 | 0x0600D8E8 | 3452 | 43 | (-4076, -173, -3635)..(2289, 763, 1208) |
| 8 | Luigi Raceway | 0x0600FF28 x113 | 30 | 0x09000290 x120 | 0x0600FD40 | 2892 | 40 | (-1884, -250, -3474)..(177, 174, 1835) |
| 9 | Moo Moo Farm | 0x060144B8 x77 | 23 | 0x090001D0 x92 | 0x06014088 | 3219 | 30 | (-1217, -20, -3045)..(2913, 270, 2368) |
| 10 | Toad's Turnpike | 0x06023B68 x23 | 20 | 0x060239A0 x80 | 0x06023930 | 3732 | 19 | (-2699, -256, -3233)..(3730, 113, 1283) |
| 11 | Kalimari Desert | 0x06023070 x102 | 20 | 0x090001A0 x80 | 0x06022E00 | 2835 | 25 | (-5873, -18, -2911)..(3266, 383, 5551) |
| 12 | Sherbet Land | 0x06009C20 x24 | 18 | 0x090000B0 x72 (opaque), 0x090001D0 x72 (ice) | 0x06009AE8 | 1269 | 10 | (-3450, -536, -2602)..(761, 536, 2150) |
| 13 | Rainbow Road | 0x06016440 x15 | 12 | 0x060164B8 x48 (second pass) | 0x06016220 | 1622 | 5 | (-3465, 467, -5451)..(2190, 1520, 4107) |
| 14 | Wario Stadium | 0x0600CC38 x32 | 27 | 0x09000150 x108 | 0x0600CA78 | 3236 | 20 | (-3350, -124, -2750)..(650, 762, 2250) |
| 15 | Block Fort | - | - | - | - | 632 | 7 | (-779, -167, -780)..(781, 92, 780) |
| 16 | Skyscraper | - | - | - | - | 576 | 23 | (-1830, -485, -1830)..(1830, 600, 1830) |
| 17 | Double Deck | - | - | - | - | 299 | 2 | (-767, 0, -768)..(769, 110, 768) |
| 18 | D.K.'s Jungle Parkway | 0x06014338 x115 | 26 | 0x06013D20 x104 | 0x06013C30 | 3651 | 24 | (-2185, -500, -4290)..(4612, 493, 2547) |
| 19 | Big Donut | - | - | - | - | 664 | 4 | (-1000, 100, -1000)..(1000, 340, 1000) |
| 20 | Award Ceremony | - | - | - (ending list 0x80284F70) | - | 1145 | 22 | (-4076, -60, -3402)..(-269, 763, 650) |

Addresses **Verified** by locating the decomp's element lists byte for byte in the decoded US segments (`lv/proto/scan.ts`); they hold for US and EU (identical files, §10) but not for J. The section table has 4 x (highest section id) entries.

### 5.3 Draw recipes

Frame setup before `render_course` (Decomp `init_rdp`, `render_player_one_1p_screen`): combiner SHADE, geometry mode `G_ZBUFFER | G_SHADE | G_CULL_BACK | G_LIGHTING | G_SHADING_SMOOTH`, render mode AA_ZB_OPA_SURF, texture filter BILERP, perspective correction on, 1-cycle, no fog unless the course sets it. Every course function clears G_LIGHTING first.

Shorthands: combiners IA = MODULATEIA `FC121824 FF33FFFF`, I = MODULATEI `FC127E24 FFFFF9FC`, IDECALA = MODULATEIDECALA `FC127E24 FFFFF3F9`, DECAL = DECALRGBA `FCFFFFFF FFFCF279`, SHADE `FCFFFFFF FFFE793C`; render modes (G_SETOTHERMODE_L w0 `B900031D`) OPA = AA_ZB_OPA_SURF `00552078`, TEX_EDGE = AA_ZB_TEX_EDGE `00553078`, XLU = AA_ZB_XLU_SURF `005049D8`, XLU_INTER = AA_ZB_XLU_INTER `004045D8`. [cam] marks a list drawn only while `func_80290C20(camera)` holds (camera collision state): untextured black geometry along track edges, best kept in a hidden layer (§14). Lists are segmented addresses (7 = unpacked, 6 = course data). Recipes are Decomp (`render_courses.c`); every address is **Verified** in the decoded segments.

| id | opaque pass (`render_<course>`) | second pass (`func_8029122C`) |
|---|---|---|
| 0 Mario Raceway | [cam] SHADE/OPA 7003050; IA/OPA: 70008E8 (1P; 7002D68 in multiplayer) and 7001140 by section/direction; 7003508, 7003240, 70014A0; section table; IDECALA/TEX_EDGE no cull: 7000450, 7000240; cull: 70000E0, 7000160 | - |
| 1 Choco Mountain | [cam] SHADE 7004608; fog (§8), 2-cycle, MODULATERGB+PASS2 / FOG_SHADE_A+OPA2: 7005A70, 7000828, 70008E0, 7005868; section table; no cull, FOG+TEX_EDGE2, DECAL+PASS2: 7000448, 70005D8; cull 7000718 | - |
| 2 Bowser's Castle | [cam] SHADE 7006A80; IA/OPA section table; IA/TEX_EDGE 7000248 | 6009228 (1P, sections 6-9: lava glow quads, 50 triangles, blended) |
| 3 Banshee Boardwalk | DECAL 7007228; fog position set (§8); IA/OPA 7005CD0, 7004E60, 70069B0; section table; IA/TEX_EDGE 7000580, 7000060, 7000540; 7006310 when the camera y < -20; 600B278 translated to (camera x, -82, camera z): a 500-unit octagon of water with segment-6 vertices and texture | IA / XLU_INTER 7000878 (vertex alpha 128) |
| 4 Yoshi Valley | I/OPA section table | - |
| 5 Frappe Snowland | [cam] SHADE 70065E0; IA/OPA section table | - |
| 6 Koopa Troopa Beach | [cam] SHADE 7009CC0; IA/OPA 7009688; section table 1; no cull, IDECALA/TEX_EDGE 70002C0 | IA/XLU_INTER: 7009E70 no cull (sections 22, 23, 29-31, 37); table 2 translated to (0, waterY, 0), no cull: the sea surface (waterY oscillates between 0 and -20 by 0.1 per frame, starting at 0) |
| 7 Royal Raceway | [cam] SHADE 700B030; IA/OPA 700A648; section table; 70011A8; no cull, IDECALA/TEX_EDGE 70008A0 | - |
| 8 Luigi Raceway | [cam] SHADE 7009EC0; IA/OPA section table; IDECALA/TEX_EDGE 70000E0, 7000068; the TV screen (1P, sections 10-16) shows the previous frame copied into seg5+0xF800..0x14800 | - |
| 9 Moo Moo Farm | I/OPA 7004DF8, 7005640; section table; 6013FF8 and I/OPA 7005410, 6014060 by section/direction; IDECALA/TEX_EDGE 70010C0 | - |
| 10 Toad's Turnpike | fog (§8): I+PASS2 / FOG_SHADE_A+OPA2 section table; FOG+TEX_EDGE2, DECAL+PASS2: 7000000, 7000068, 70000D8 | - |
| 11 Kalimari Desert | [cam] SHADE 70071C8; I/OPA section table; 7001ED8, 7001B18, 7008330; no cull, IDECALA/TEX_EDGE 7000998, 7000270 | - |
| 12 Sherbet Land | I/OPA table 90000B0 | IA: table 90001D0 (ice, vertex alpha 180/150, render mode XLU with alpha dither `005049F8` from the lists); [cam, player above the ice] SHADE/OPA 7002B48 |
| 13 Rainbow Road | state only (IA/OPA) | no cull: table 60164B8 (the whole road; state XLU_INTER, BILERP, perspective from the lists) |
| 14 Wario Stadium | [cam] SHADE 700A0C8; MODULATERGBA/OPA section table; 700A228; no cull, IDECALA/TEX_EDGE 7000A88; the jumbotron (1P) shows the previous frame copied into seg5+0x8800..0xD800 | no cull, IDECALA / XLU with prim colour (255, 255, 0, 255): 7000EC0 |
| 15 Block Fort | 70015C0 | - |
| 16 Skyscraper | 7000FE8, 7000C60, 7000B70, 70006B8, 7000570; no cull 70010C8; cull 7000258 | - |
| 17 Double Deck | no cull 7000738 | - |
| 18 D.K.'s Jungle Parkway | no cull throughout; [cam] texture off, SHADE 70092D8; IDECALA/TEX_EDGE section table | IA/XLU_INTER 7003E40, 7003EB0, 7003DD0, 7003F30 (the river, by section/direction); IDECALA 70036A8 (sections 21-24) |
| 19 Big Donut | [cam] SHADE 7000DE8; 7000450, 7000AC0, 7000D20, 7000230 | - |
| 20 Award Ceremony | ending-segment list at RAM 0x80284F70 (US ROM 0x1285B0, 41 commands): IA/OPA/texture on, then 35 Royal Raceway packed lists | - |

### 5.4 Render state inside the lists

Opcode census over every list any route draws (**Verified**, `lv/proto/census.ts`):

| segment | opcodes |
|---|---|
| 6 (course-data F3DEX lists) | G_DL, G_ENDDL, G_RDPTILESYNC, G_SETTILE, G_SETTILESIZE, G_SETTIMG, G_RDPLOADSYNC, G_LOADBLOCK, G_SETOTHERMODE_L, G_SETGEOMETRYMODE, G_CLEARGEOMETRYMODE, G_MOVEWORD (NumLights; Moo Moo Farm's fog factor), G_SETOTHERMODE_H, G_TEXTURE, G_RDPPIPESYNC, G_NOOP, G_TRI2, G_VTX, G_SETFOGCOLOR, G_SETCOMBINE |
| 7 (unpacked) | G_TRI2, G_TRI1, G_VTX, G_DL, G_ENDDL, G_RDPTILESYNC, G_SETTILE, G_SETTILESIZE, G_RDPLOADSYNC, G_LOADBLOCK, G_SETTIMG, G_TEXTURE, G_SETCOMBINE, G_SETOTHERMODE_L, G_CLEARGEOMETRYMODE |

Absent everywhere: G_QUAD, G_CULLDL, G_MTX, G_POPMTX, G_MOVEMEM, G_LOADTLUT, G_SETPRIMCOLOR, G_SETENVCOLOR, texture rectangles.

**The viewer's `displaylist.ts` handles every opcode used without modification** (**Verified**: all 21 courses run through the unmodified `runDisplayList` with `ucode 'f3dex'`, `vertexScale 1`, `mirrorX false`, `combiner true`; textures decode correctly through its texture-memory emulation, including Moo Moo Farm's second load tile). It ignores G_SETOTHERMODE_H (filter and cycle type), the fog factor and fog colour, and G_NOOP, none of which affect the batches.

| command | values seen (course ids) |
|---|---|
| G_SETCOMBINE | IA (all), IDECALA (all but 1, 15, 17), MODULATEI+PASS2 `FC127FFF FFFFF838` (9, 10), DECAL+PASS2 `FCFFFFFF FFFCF238` (10), SHADE (8, 15, 17, 18, 19) |
| G_SETOTHERMODE_L | OPA (all), TEX_EDGE (all but 13, 15, 17), XLU_INTER (2, 12, 13, 18), XLU (13, 14), `005049F8` XLU with alpha dither (12), FOG_SHADE_A+OPA2 `C8112078` (9, 10), FOG+TEX_EDGE2 `C8113078` (10), alpha compare none `B9000002 0` (2, 14, 18) |
| G_SETGEOMETRYMODE / CLEAR | CULL_BACK (all race courses); clear G_LIGHTING (2, 3, 9, 13); FOG + SMOOTH (9); SHADE + SMOOTH (3) |
| G_SETOTHERMODE_H | `BA000C02 00002000` filter BILERP; `BA001301 00080000` perspective (13, 14, 18); `BA001402 0 / 00100000` cycle type 1/2 (9) |
| G_MOVEWORD | `BC000002 80000040` NumLights(1) (0, 1); `BC000008 476DB925` gsSPFogFactor(18285, -18139) (9) |
| G_SETFOGCOLOR | `3C3C3CFF` (9); other fog colours are set by game code (§8) |
| G_TEXTURE | on `BB000001 FFFFFFFF`, off `BB000000 00010001` |

- **Cut-outs and translucency:** TEX_EDGE (coverage x alpha) is an alpha cut-out (fences, trees, signs); XLU and XLU_INTER blend (water, ice, Rainbow Road) with the vertex alpha of §5.6. `displaylist.ts`'s existing blend/cutout classification gets these right.
- **Culling:** G_CULL_BACK is on by default, cleared by recipes and by packed opcode 0x57; front faces wind counter-clockwise. Different section variants reach some packed lists with different cull state (Frappe Snowland, Banshee Boardwalk, Luigi Raceway, Bowser's Castle, Sherbet Land); such triangles are drawn unculled.
- **Inherited state:** in Moo Moo Farm (543 triangles) and D.K.'s Jungle Parkway (572), packed lists take their texture or render mode from the calling section list, and different section variants supply different values; the prototype keeps the first draw (§13). A viewer must run section lists with their texture loads, not the packed lists alone.
- **Filtering:** bilinear everywhere; no point-sampled course textures.

### 5.5 Textures

- Formats: RGBA16 and IA16 only (IA16 in Banshee Boardwalk, Koopa Troopa Beach, Rainbow Road, Wario Stadium, D.K.'s Jungle Parkway); sizes 32x32, 64x32 and 32x64. No CI, TLUT or mip-maps (**Verified**, census of every G_SETTILE and G_LOADBLOCK).
- Wrap: from each render-tile G_SETTILE (cms/cmt 0 wrap, 1 mirror, 2 clamp; masks 5 or 6); all combinations occur.
- Banshee Boardwalk's water list 0x0600B278 uses a segment-6 texture and segment-6 vertices.
- Framebuffer textures: Luigi Raceway's TV screen and Wario Stadium's jumbotron are overwritten every frame with a copy of the previous frame (Decomp `copy_framebuffer`); a viewer shows the ROM texture there.
- Texture sheets: `lv/renders/NN_<course>_textures.png`.

### 5.6 Load-time edits and animation

`find_vtx_and_set_colours(list, alpha, r, g, b)` runs after collision generation and rewrites every vertex a list loads: alpha, and r/g/b when r != 0 (Decomp; applied by the prototype, and the renders show the expected translucency):

| course | list: alpha (rgb) |
|---|---|
| 2 Bowser's Castle | 7001350: 0x32 |
| 3 Banshee Boardwalk | 7000878: 128 |
| 6 Koopa Troopa Beach | 700ADE0, 700A540, 7009E70, 7000358: 150 |
| 12 Sherbet Land | 7001EB8: 180; 7002308: 150 |
| 13 Rainbow Road | 7002068, 7001E18: 150; 7001318: 255 with rgb (255, 255, 0); 7001FB8: 150 (not in the credits) |
| 14 Wario Stadium | 7000C50, 7000BD8, 7000B60, 7000AE8, 7000CC8, 7000D50, 7000DD0, 7000E48: 100 |
| 18 D.K.'s Jungle Parkway | 7003FA8: 120 |

Scrolling textures (`course_update_water`, per frame, changes uls/ult of the first G_SETTILESIZE of a list): Koopa Troopa Beach 7009D58 (t += 9 per frame, mod 256), 7009CD0 (t += 3), 70002E8 (random jitter); Banshee Boardwalk 600B278 (t += 1); Royal Raceway 700A6A8, 700A648 (t -= 20); D.K.'s Jungle Parkway 7003DD0, 7003E40, 7003EB0, 7003F30, 70036A8 (t += 2), 7009880 (t -= 20). Units are G_SETTILESIZE's 10.2 fixed point, so 256 steps = 64 texels (Hypothesis for the exact period). Animating them needs a per-batch UV scroll that `types.ts` does not have; static is acceptable.

## 6. Collision

### 6.1 How the game builds it

There is no collision file. At course load, `course_generate_collision_mesh` (racing 0x80295DC4; **Verified** by disassembly, logic Decomp `render_courses.c`, `collision.c`) walks display lists, turns their triangles into `CollisionTriangle` records and bins them into a 32 x 32 grid:
- race courses: `parse_course_displaylists(TrackSections table)` (§5.2 table). Mario Raceway first adds 0x07001140 and 0x070008E8 (1P; 0x07002D68 in multiplayer) with surface -1 and section 0xFF;
- battle courses: fixed lists with one surface: Block Fort 0x070015C0 (1), Skyscraper 0x07001110 and 0x07000258 (1), Double Deck 0x07000738 (1), Big Donut 0x07001018, 0x07000450, 0x07000AC0, 0x07000B58, 0x07000230 (6);
- the ceremony and credits build none.

**TrackSections** (segment 6, 8 bytes per record, terminated by a zero `addr`; **Verified**, all 15 tables parsed):
```
+0 u32 addr          display list (0x07...)
+4 u8  surfaceType   read as s8 (§6.3)
+5 u8  sectionId     path section 1..N; 255 = none. Also the render section of §5.2
+6 u16 flags         0x8000: skip floors and ceilings (|normal.y| > 0.9)
                     0x2000: skip walls (|normal.y| < 0.1)
                     0x4000: set triangle flag 0x200
```

**generate_collision_mesh(list, surface, section)** follows at most 0x1FFF commands up to G_ENDDL: G_DL recurses; G_VTX binds `vtxBuffer[v0 + k] = &segment4[addr + 16k]`; G_TRI1 adds one triangle, G_TRI2 two, G_QUAD two. `add_collision_triangle(v1, v2, v3, surface, section)`:
1. skip when all three `Vtx.flag == 4`;
2. if v1 and v2 share x and z, swap v2 and v3;
3. bounding box (s16); normal = normalize((v2 - v1) x (v3 - v2)); skip degenerate; distance = -(n . v1);
4. apply the section flags 0x8000 / 0x2000;
5. grow the course bounds (they start at 0, so they always include the origin);
6. flags = sectionId, | 0x400 if all three vertex flags are 1, | 0x800 if all are 2, | 0x1000 if all are 3, else | 0x200 when section flag 0x4000 is set; plus the dominant normal axis 0x4000 (Y), 0x8000 (X) or 0x2000 (Z);
7. surfaceType = (u16)(s8)surface.

### 6.2 CollisionTriangle (RAM, 0x2C bytes)

```
+0x00 u16 flags          low byte: section id; 0x200/0x400/0x800/0x1000 as above; 0x2000/0x4000/0x8000 facing axis
+0x02 u16 surfaceType
+0x04 s16 minX, minY, minZ, maxX, maxY, maxZ
+0x10 Vtx* vtx1, vtx2, vtx3   (segment-4 vertices)
+0x1C f32 normalX, normalY, normalZ
+0x28 f32 distance
```
Layout Decomp (`common_structs.h`); size **Verified** from `count * 44` in `func_80295C6C`. RAM (**Verified** by disassembly): `gCollisionMesh` 0x8015F580, `gCollisionMeshCount` 0x8015F588 (u16), slot counter 0x8015F58C, course bounds 0x8015F6E8-0x8015F6F2 (s16 maxX, minX, maxY, minY, maxZ, minZ). The grid cells widen by 20 units on each side.

### 6.3 Surface types

Names Decomp (`include/mk64.h`); usage **Verified** from the TrackSections data of all courses (`lv/proto/analysis.txt`).

| value | name | used by |
|---|---|---|
| 0x00 | AIRBORNE | runtime only |
| 0x01 | ASPHALT | Mario, Koopa (tunnel), Royal, Luigi, Toad's, Rainbow, Block Fort, Skyscraper, Double Deck |
| 0x02 | DIRT | Choco, Yoshi, Royal, Moo Moo, Kalimari (track), Wario, DK |
| 0x03 | SAND | Koopa, Royal |
| 0x04 | STONE | Bowser, Banshee, Royal (castle entrance) |
| 0x05 | SNOW | Frappe (track), Sherbet |
| 0x06 | BRIDGE | Banshee, Royal, DK, Big Donut |
| 0x07 | SAND_OFFROAD | Mario, Luigi |
| 0x08 | GRASS | Mario, Bowser, Yoshi, Royal, Luigi, Moo Moo, DK |
| 0x09 | ICE | Sherbet |
| 0x0A | WET_SAND | Koopa |
| 0x0B | SNOW_OFFROAD | Frappe |
| 0x0C | CLIFF | Choco, Koopa |
| 0x0D | DIRT_OFFROAD | Kalimari |
| 0x0E | TRAIN_TRACK | Kalimari |
| 0x0F | CAVE | DK |
| 0x10 | ROPE_BRIDGE | Bowser, DK |
| 0x11 | WOOD_BRIDGE | Bowser, Yoshi, Frappe, DK |
| 0xFC (stored 0xFFFC) | BOOST_RAMP_WOOD | DK |
| 0xFD (stored 0xFFFD) | OUT_OF_BOUNDS | DK (river island) |
| 0xFE (stored 0xFFFE) | BOOST_RAMP_ASPHALT | Royal (the big ramp) |
| 0xFF (stored 0xFFFF) | RAMP / walls (same value as SURFACE_DEFAULT) | every race course |

The decomp's `docs/courses/surfacetypes.md` gives other names for some values (4 "Cement", 12 "Rock walls", 255 "walls/ramps"); the enum above is the one the code uses.

### 6.4 Vertex flags

| Vtx.flag | effect (when all three vertices of a triangle share it) |
|---|---|
| 0 | none |
| 1 | triangle flag 0x400 |
| 2 | triangle flag 0x800 |
| 3 | triangle flag 0x1000 |
| 4 | no collision (decoration) |

The physics meaning of 0x400/0x800/0x1000 (and 0x200) is open (§13).

### 6.5 Per-course results (US)

| id | course | collision triangles | skipped (flag 4 / degenerate / floor / wall) | surfaces (triangles) |
|---|---|---|---|---|
| 0 | Mario Raceway | 1291 | 356/0/0/0 | asphalt 268, sand off-road 87, grass 631, 0xFF 305 |
| 1 | Choco Mountain | 1348 | 211/0/64/0 | dirt 350, cliff 891, 0xFF 107 |
| 2 | Bowser's Castle | 1458 | 1657/4/0/0 | stone 1093, grass 71, rope bridge 16, wood bridge 12, 0xFF 266 |
| 3 | Banshee Boardwalk | 647 | 411/6/6/295 | stone 178, bridge 467, 0xFF 2 |
| 4 | Yoshi Valley | 1876 | 30/2/0/0 | dirt 602, grass 124, wood bridge 96, 0xFF 1054 |
| 5 | Frappe Snowland | 1435 | 610/0/0/0 | snow 176, snow off-road 848, wood bridge 10, 0xFF 401 |
| 6 | Koopa Troopa Beach | 2203 | 124/0/0/0 | asphalt 60, sand 934, wet sand 438, cliff 723, 0xFF 48 |
| 7 | Royal Raceway | 1904 | 387/1/0/0 | asphalt 375, dirt 101, sand 50, stone 27, bridge 40, grass 1025, 0xFE 8, 0xFF 278 |
| 8 | Luigi Raceway | 1501 | 670/1/0/0 | asphalt 292, sand off-road 240, grass 263, 0xFF 706 |
| 9 | Moo Moo Farm | 1909 | 167/0/0/0 | dirt 823, grass 636, 0xFF 450 |
| 10 | Toad's Turnpike | 1854 | 0/0/0/0 | asphalt 401, 0xFF 1453 |
| 11 | Kalimari Desert | 1730 | 300/0/0/0 | dirt 218, dirt off-road 748, train track 368, 0xFF 396 |
| 12 | Sherbet Land | 502 | 298/0/0/0 | snow 182, ice 85, 0xFF 235 |
| 13 | Rainbow Road | 1566 | 0/0/0/0 | asphalt 530, 0xFF 1036 |
| 14 | Wario Stadium | 2138 | 0/0/0/0 | dirt 875, 0xFF 1263 |
| 15 | Block Fort | 553 | 58/22/0/0 | asphalt 553 |
| 16 | Skyscraper | 504 | 72/0/0/0 | asphalt 504 |
| 17 | Double Deck | 296 | 0/3/0/0 | asphalt 296 |
| 18 | D.K.'s Jungle Parkway | 2798 | 399/1/4/0 | dirt 977, bridge 30, grass 412, cave 364, rope bridge 64, wood bridge 64, 0xFC 2, 0xFD 45, 0xFF 840 |
| 19 | Big Donut | 656 | 0/0/0/0 | bridge 656 |

Every TrackSections table ends with section-255 records (walls, ramps, out-of-bounds pieces). A few small lists (at most 32 triangles per course) are reached only by the collision walk and never drawn: candidates for invisible walls and hidden floors (Yoshi Valley 12, Koopa Troopa Beach 6, Luigi Raceway 28, Sherbet Land 7, Rainbow Road 12, Wario Stadium 9, Big Donut 32 triangles; list addresses in `lv/notes/collision.md`). The viewer gets them from the collision layer.

### 6.6 Viewer presentation

Following `rushcollision.ts`: a hidden `collision` layer with one mesh per surface type (`collision <surface>`), translucent (alpha 150), depth test without depth write, no culling, decal, lifted 0.5 along the normal; floors (|ny| > 0.5) full brightness, walls darker. `Mesh.info` carries the surface value and triangle count; `Batch.triSource` the segmented address of the triangle command. Colours in the prototype: asphalt grey, dirt brown, sand beige, stone grey-brown, snow white, bridge and wood brown-orange, grass green, ice light blue, cliff dark brown, boost ramps orange, out of bounds red, 0xFF walls and ramps magenta. Optional extras: colour by section id, and flag layers for 0x400/0x800/0x1000 once their meaning is known.

## 7. Objects and the kart path

### 7.1 Runtime systems

The game has two relevant object pools. `gActorList[100]` at US RAM 0x8015F9B8 uses 0x70-byte actors for foliage,
item boxes, signs, vehicles and some course hazards. Position is three f32 values at +0x18, rotation three s16 values
at +0x10, type s16 at +0, flags s16 at +2 and state s16 at +6. **Verified** by disassembly and the Mario Raceway RAM
dump. A separate `gObjectList[550]` at 0x80165C18 holds 0xE0-byte particles, sprite/animated hazards and other
code-created objects. **Verified** by `clear_object_list` zeroing exactly 0x1E140 bytes, indexed accesses multiplying by
0xE0, and the next BSS symbol at 0x80183D58.

`ActorSpawnData` in segment 6 is 8 bytes, big-endian: `s16 x, y, z; u16 id`, terminated by x = -32768. D.K.'s Jungle
Parkway foliage instead uses 10 bytes: `s16 x, y, z, id, originalY`, with type in the low id byte and flags in the
high byte. Mirror mode negates x; the viewer always uses the authored, unmirrored coordinates. **Verified:** every list
below was decoded to its terminator and its segmented address appears as the constant passed by game code.

| id | course | spawn lists (segment 6, entries) |
|---|---|---|
| 0 | Mario Raceway | item boxes 0x06009498 (15), Piranha Plants 0x06009518 (10), trees 0x06009570 (27) |
| 1 | Choco Mountain | rocks 0x06007230 (3), item boxes 0x06007250 (15) |
| 2 | Bowser's Castle | bushes 0x06009290 (27), item boxes 0x06009370 (12) |
| 3 | Banshee Boardwalk | item boxes 0x0600B3D0 (16) |
| 4 | Yoshi Valley | trees 0x060180A0 (13), item boxes 0x06018110 (37) |
| 5 | Frappe Snowland | trees 0x06007718 (30), item boxes 0x06007810 (15) |
| 6 | Koopa Troopa Beach | item boxes 0x06018E78 (30), palms 0x06018F70 (12) |
| 7 | Royal Raceway | Piranha Plants 0x0600D9F0 (16), trees 0x0600DA78 (32), item boxes 0x0600DB80 (20) |
| 8 | Luigi Raceway | item boxes 0x0600FDE8 (18), trees 0x0600FE80 (20) |
| 9 | Moo Moo Farm | cows 0x06014200 (37), trees 0x06014330 (21), item boxes 0x060143E0 (26) |
| 10 | Toad's Turnpike | item boxes 0x06023AE0 (16) |
| 11 | Kalimari Desert | item boxes 0x06022E88 (15), cacti 0x06022F08 (44) |
| 12 | Sherbet Land | item boxes 0x06009B80 (19) |
| 13 | Rainbow Road | item boxes 0x06016338 (32) |
| 14 | Wario Stadium | item boxes 0x0600CB40 (30) |
| 15 | Block Fort | item boxes 0x06000038 (36) |
| 16 | Skyscraper | item boxes 0x06000080 (24) |
| 17 | Double Deck | item boxes 0x06000028 (42) |
| 18 | D.K.'s Jungle Parkway | item boxes 0x06013EC0 (22), 10-byte trees 0x06013F78 (95) |
| 19 | Big Donut | item boxes 0x06000058 (24) |

### 7.2 Placement and actor rendering

Foliage is grounded against the generated collision mesh: among Y-facing triangles whose XZ triangle contains the
point, the game selects the eligible plane near the authored Y and replaces Y with its plane height. Trees then draw
as Y-axis billboards; the plane normal affects only their shadow rotation. **Verified:** `ob/proto/spawns.ts` reproduces
all 27 Mario Raceway trees in RAM, including six raised to the ground plane. Item boxes rise to authored Y + 8.66 and
spin; 11 resting boxes match exactly in RAM, while four are visibly in their respawn state. They do not spawn in Time
Trials. The viewer should place them at rest and mark them animated.

Foliage, cows and Piranha Plants generally use CI8 32x64 billboard textures loaded into runtime segment 3, with shared
TLUTs from segment D. Segment 3 begins with shell and finish-banner animation frames, two common textures, and then the
course-specific actor textures. Models and render state are addressed by the segment-6 lists catalogued in
`ob/proto/models.txt`; railroad crossings, Koopa palms, the Yoshi egg and the D.K. ferry use RSP lighting, while most
billboards do not. **Verified** for addresses/texture layout from ROM and disassembly; model names are **Decomp** where
not independently identified by a render.

`buildSegment3(0)` compared with Mario Raceway RAM is identical from 0x2000 through 0xDFFF, covering blue shells,
finish banners, common textures, trees and Piranha Plants. The only 17 differences in the whole 0xE000 bytes are zeroed
tails of green-shell frames 4 and 5: the game DMAs 8 and 9 bytes less than their MIO0 streams consume. **Verified** by
byte comparison and the original DMA constants. Complete normal MIO0 decoding is correct for course objects; emulating
the short-DMA zero fill matters only if shells are later displayed exactly.

Hard-coded actors include two Mario Raceway signs, the Yoshi Valley egg, Koopa Beach balloon item box, four Kalimari
railroad-crossing halves, three Wario Stadium signs and one D.K. fruit per human player. The Mario signs' exact positions
match RAM. Other code-created course objects include Bowser's Castle Thwomps and fire, Banshee's bin/fish/bats/Boos,
Yoshi flags and hedgehogs, Frappe snowmen/snow, Koopa crabs/seagulls, Luigi's balloon, Moo Moo moles, Sherbet penguins,
Rainbow Road neon signs/Chain Chomps and D.K. smoke. Their fixed tables are **Verified** in ROM where listed in
`ob/proto/romtables.txt`; motion and sprite/model selection are **Decomp**. Static viewer policy: render a known mesh at
its initial position, otherwise emit a labelled marker in the `objects` layer.

Sherbet Land's 15 penguin origins are **Verified** from US main-code immediates/rodata: `(-383,2,-690)` (1P only);
pairs at `(-2960,-80,1521)`, `(-2490,-80,1612)`, `(-2098,-80,1624)`, `(-2080,-80,1171)`; and singles at
`(146,0,-380)`, `(380,0,-766)`, `(-2300,0,-210)`, `(-2500,0,-250)`, `(-535,0,875)`, `(-250,0,953)`. The first is a
large spline-driven penguin, the pairs are phase separated, and the remaining six move on the surface (**Decomp**).
Use animated markers until static armature poses are decoded.

Rainbow Road neon-sign origins are **Verified** from code and the table at RAM 0x800E6734:

| sign | position | sign | position |
|---|---|---|---|
| mushroom | (-1431,827,-2957) | Mario | (799,1193,-5891) |
| Boo | (-2013,555,0) | Peach | (1443,1044,-5478) |
| Luigi | (1678,1012,-4840) | Donkey Kong | (-3924,921,2566) |
| Yoshi | (-3311,790,3524) | Bowser | (-1284,1341,4527) |
| Wario | (2268,1041,4456) | Toad | (2820,1109,1985) |

The three Chain Chomps start at track-path indices 500, 800 and 1100: `(-1035,769,-2570)`,
`(-1703,672,325)` and `(-790,692,1928)` after the -15 Y offset (**Verified** path bytes and initializer). Signs are
camera-yaw billboards and Chomps follow the path at speed 4 with vertical oscillation (**Decomp**). Mark Chomps
animated; markers are acceptable until their armature is supported.

First-pass model roots previously missing from the symbol matcher are **Verified** from list structure and direct code
references: Mario sign 0x06009330; Luigi tree 0x0600FC70; Moo Moo cows 0x06013C00/13CA0/13D20/13DA0/13E20 and tree
0x06013F20; Kalimari cacti 0x06008528/8628/8728. Toad traffic is assembled from small main-code wrappers around the
course model roots documented in `ob2/OBJECTS_ENV.md`; use the near LOD for a fixed viewer snapshot.

### 7.3 Vehicles

- **Kalimari Desert trains (Decomp; path pointer Verified):** segment-6 path 0x06006C60, 75 control points, resampled
  approximately every 20 units; two trains start half a path apart plus index 160. A full 1-player train is engine,
  tender and five passenger cars; multiplayer removes cars. Show one complete train at its deterministic start and
  mark it animated.
- **D.K.'s Jungle Parkway ferry (Decomp; path pointer Verified):** path 0x06007520, 31 points, one boat at index 0,
  Y = -40, inactive for three or four players. Show it at path start and mark it animated.
- **Toad's Turnpike traffic (Decomp):** seven each of box truck, bus, tanker and car (eight in Time Trials), distributed
  around track path 0 with offsets 0, 75, 50 and 25 points and one of three lanes. The viewer should use the deterministic
  non-Time-Trials distribution and label it animated.

### 7.4 Kart and auxiliary paths

`TrackPathPoint` is `s16 x, y, z; u16 trackSectionId` (8 bytes), terminated by all three coordinates 0x8000. The
pointer table at US ROM 0xDD4D0 / RAM 0x800DC8D0 holds up to four track paths per course; the allocation-size table is
at ROM 0xDE5D0 / RAM 0x800DD9D0. **Verified** by ROM decode. Race-course point counts are:

| course | points | course | points |
|---|---:|---|---:|
| Mario | 499 | Choco | 605 |
| Bowser | 684 | Banshee | 657 |
| Yoshi | 677 / 666 / 678 / 792 | Frappe | 646 |
| Koopa | 608 / 558 | Royal | 902 |
| Luigi | 631 | Moo Moo | 464 |
| Toad's | 912 | Kalimari | 663 |
| Sherbet | 665 | Rainbow | 1,760 |
| Wario | 1,400 | D.K. | 786 |

The game derives left/right boundary paths by offsetting each point perpendicular to its next segment by a per-course
width. A second pointer table at ROM 0xDD380 / RAM 0x800DC780 holds shorter auxiliary paths; the 16 race-course rows
are not used for racing, while the ceremony row's four segment-B paths are used by its karts. (**Verified** tables;
**Decomp** use.) Expose track paths as a `paths` markers/line layer, colourable by `trackSectionId`, with train/ferry
paths separately named and path point 0 marked as the start.

### 7.5 Viewer scope

The implemented static scope includes decoded spawn-list foliage and item boxes, hard-coded static actors where their
retail models and placements are reconstructable, continuous path ribbons, path starts, and markers for the remaining
code-created or moving objects. It does not simulate actor state machines, particles, splines, item respawning,
vehicle motion or karts. Authored flat sprites use `Instance.billboard: 'y'`; rendering, picking, highlights and
selection diagnostics all derive the same camera-facing matrix.

## 8. Environment: sky, fog, clouds, camera

### 8.1 Screen-space sky

The sky is not a dome. `render_skybox` draws two untextured orthographic 320x240 gradients: screen top to a computed
horizon row, then the horizon row to screen bottom. The split row is the projection of world point `(0,0,30000)` using
the active camera/FOV/near/far; it is stored in each screen structure at +0x28 (144 in the earlier Mario Raceway
attract dump and 110 at a different point in the resumed attract-camera transition). Choco Mountain and Banshee
Boardwalk replace every sky vertex colour with the fog colour. **Decomp** rendering formula; **Verified** colour tables
and Mario runtime rows.

The four RGB values per course are **Verified** at US ROM 0x1220E0 and 0x1221DC (21 records each):

| course | screen top -> upper horizon | lower horizon -> screen bottom |
|---|---|---|
| Mario | (128,184,248) -> (216,232,248) | (0,0,0) -> (0,0,0) |
| Choco | white -> white (fog override) | white -> white |
| Bowser | (48,8,120) -> black | black -> black |
| Banshee | black -> black (fog override) | black -> black |
| Yoshi | (113,70,255) -> (255,184,99) | (95,40,15) -> black |
| Frappe | (28,11,90) -> (0,99,164) | (0,99,164) -> black |
| Koopa | (48,152,120) -> (216,232,248) | (48,152,120) -> black |
| Royal / Award Ceremony | (238,144,255) -> (255,224,240) | (255,224,240) -> black |
| Luigi | (128,184,248) -> (216,232,248) | (216,232,248) -> black |
| Moo Moo | (0,18,255) -> (197,211,255) | (255,184,99) -> black |
| Toad's | (0,2,94) -> (209,65,23) | (209,65,23) -> black |
| Kalimari | (195,231,255) -> (255,192,0) | (255,192,0) -> black |
| Sherbet | (128,184,248) -> (216,232,248) | (216,232,248) -> (128,184,248) |
| Rainbow / Skyscraper / Big Donut | black -> black | black -> black |
| Wario | (20,30,56) -> (40,60,110) | black -> black |
| Block Fort | (128,184,248) -> (216,232,248) | (216,232,248) -> black |
| Double Deck | (113,70,255) -> (255,184,99) | (255,224,240) -> black |
| D.K. | (255,174,0) -> (255,229,124) | (22,145,22) -> black |

A `Level.skyGradient` contract with these four colours and the horizon point is the faithful solution. A camera-centred
vertex-coloured dome only matches one camera pitch/FOV and is an explicit fallback.

### 8.2 Clouds, stars and particles

Cloud/star records are 8 bytes: `u16 yaw, screenHeight, scalePercent, subtype`, terminated by yaw 0xFFFF. **Verified**
lists: Luigi/Mario clouds 13, Yoshi/Moo Moo 10, Koopa 6, Royal 13, Sherbet 12, Kalimari 13, Toad/Rainbow stars 43 and
Wario stars 40. Game code tests camera yaw/FOV, maps yaw to the 320-pixel width, places the sprite relative to the
computed horizon row, and draws common I4 cloud (64x32) or star (16x16) textures; stars vary alpha in five phases.
(**Decomp** formulas; **Verified** records/textures.) They require optional camera-yaw screen sprites for fidelity.
Frappe Snowland's 50 falling snow particles (25 in multiplayer) are dynamic and may be omitted.

### 8.3 Fog

`gSPFogPosition(min,max)` becomes `multiplier = trunc(128000/(max-min))` and
`offset = trunc((500-min)*256/(max-min))`. Constants are **Verified** by racing-segment disassembly:

| course | colour | position | multiplier, offset | projection near/far |
|---|---|---|---|---|
| Choco Mountain | (255,255,255) | 995-1000 | 25600, -25344 | 2 / 1500 |
| Toad's Turnpike | (43,13,4) | 993-1000 | 18285, -18029 | 9 / 4500 |
| Banshee Boardwalk | black | 995-1000 | 25600, -25344 | 2 / 2700 |

Banshee sets the position and black sky override but its course render path never enables the RSP/RDP fog mode, so it
does not visibly fog geometry (**Decomp**). Moo Moo Farm lists contain fog colour (60,60,60) and factor
(18285,-18139), but the effective inherited render-mode interaction is open. Choco and Toad map directly to
`Level.fog` with the table's projection planes.

### 8.4 Projection and default camera

Perspective values are **Verified** by disassembly of `set_perspective_and_aspect_ratio`:

| courses | far / near |
|---|---|
| Bowser, Banshee, Rainbow, Block Fort, Skyscraper | 2700 / 2 |
| Choco, Double Deck | 1500 / 2 |
| Koopa | 5000 / 1 |
| Wario | 4800 / 10 |
| Kalimari | 7000 / 10 |
| Mario, Yoshi, Frappe, Royal, Luigi, Moo Moo, Toad, Sherbet, D.K. | 4500 / 9 |
| Big Donut, Award Ceremony and non-race screens | 6800 / 3 |

Normal one-player aspect is 4:3 and FOV Y is 40 degrees. The stable viewer camera uses the Time Trials grid rule:
kart at track path point 0 plus 30 in Z, facing -Z; eye offset `(0,9.5,50)` and target offset `(0,0,-70)` in that kart's
space. The offsets and FOV are **Verified** in Mario Raceway RAM; per-course start position follows the **Decomp** rule.
Grand Prix instead stages karts into ranked slots and begins with an FOV-80 fly-in, so it is less useful as a fixed
default view.

### 8.5 Lighting and clear colour

Course geometry clears `G_LIGHTING` and uses vertex colour. The two common lights at US ROM 0xDD210 are ambient 175 or
115, directional white 255 with direction `(0,0,120)`; a few actor models named in §7 use them. Choco and Yoshi rotate
a light direction for their lit objects. **Verified** bytes and call constants; bake those actor colours through the
existing display-list lighting path. The game has framebuffer clear-colour globals, but the sky quads cover the view;
using the bottom sky colour as `Level.clearColor` is a safe fallback.

## 9. Music

Research material: `mus/notes/music.md` (full notes), `mus/proto/` (prototype: `mk64audio.ts` data, `mk64synth.ts` engine, `render.ts` song table and loops), `mus/wav/` (renders with `smpl` loop chunks).

### 9.1 System

Mario Kart 64 uses Nintendo EAD's sequence driver ("Nas"), the Super Mario 64 lineage: **the code is the SM64 EU revision, the data files use the SM64 US/JP container formats**. It is older than Star Fox 64's driver (`src/rom/music/sf64.ts`).

| item | value | evidence |
|---|---|---|
| driver | EAD "Nas" driver: EU-revision code (NoteSubEu, EU command queue, 0x28-byte presets) with SM64-style files: sequence file, ctl banks, one tbl sample blob, bank sets | **Verified** (driver strings such as `Audio:Track:Warning: No Free Notetrack` at ROM 0xEA640; structures) + Decomp (`src/audio/`, `port_eu.c`) |
| leak | `audio/kart_sou.music`, `.banks`, `.table`, `.sbmap` are byte-identical to the US ROM data; `audio.o` (`Nas_*` symbols) has the same preset table as the ROM | **Verified** (full-file search, objdump) |
| RSP microcode | aspMain "NEAD MK": leak `aspMain.o` .text = ROM 0xDC430, .data = ROM 0xF5900; data word 0x11181350 is what mupen64plus-rsp-hle maps to `alist_process_nead_mk` | **Verified** (ROM bytes) |
| output rate | 26800 Hz requested (`osAiSetFrequency`); the DAC runs at 26807 Hz (dacrate 1815) | **Verified** (preset table in ROM; the emulator audio log shows dacrate 1815 / 26807 Hz) |
| updates | 3 per video frame (NTSC); 136/144/152-sample chunks; AI buffers of 432, 448 or 464 samples | Decomp (formulas) + **Verified** constants |
| tempo | `tempoAcc += tempo` per update with tempo = BPM x 48; a tick when `tempoAcc >= 10770`, so 0.80223 x BPM ticks per second; 48 ticks per beat | Decomp + **Verified** constants (2880000.0f, 16.713f; gTatumsPerBeat at ROM 0xEB1CC = 48) |
| voices | 24 in menus, 16 in races and battles, 28 in the ceremony and credits (shared with sound effects) | **Verified** (preset table) + Decomp (callers) |
| reverb | one delay line of 2560 samples, feedback 0.625; Mario Raceway and Luigi Raceway 1280 samples, feedback 0.75 | **Verified** (preset table) + Decomp |

**Audio session presets** (`gAudioSessionPresets`, US ROM 0xEB0D8, 6 x 0x28; reverb settings at 0xEB0D0) (**Verified** ROM; callers Decomp):

| preset | voices | reverb (window x 64 samples, gain) | used for |
|---|---|---|---|
| 0 | 24 | 2560, 0x4FFF | logo, title, menus |
| 1 | 20 | 2560, 0x4FFF | no caller (unused) |
| 2 | 28 | 2560, 0x4FFF | staff credits |
| 3 | 28 | 2560, 0x4FFF | award ceremony |
| 4 | 16 | 2560, 0x4FFF | races and battles |
| 5 | 16 | 1280, 0x5FFF | Mario Raceway (0) and Luigi Raceway (8) |

Reverb feedback = `1 + s16(0x8000 + gain) / 32768`: 0x4FFF gives 0.625, 0x5FFF gives 0.75.

### 9.2 Data locations

| data | US ROM | size | how to find it (`mus/proto/mk64audio.ts`) |
|---|---|---|---|
| ctl bank file (revision 1, 21 banks) | 0x966260 | 0x13810 | 16-aligned header `u16 rev, u16 n`, first entry offset `align16(4 + 8n)`; rev 1 and each entry starts with `u32 numInstruments < 256, u32 numDrums < 256` |
| tbl sample file (revision 2, 21 entries) | 0x979AA0 | 0x24C4A0 | rev 2 with the same count as the ctl |
| sequence file (revision 3, 30 sequences) | 0xBC5F60 | 0x23170 | rev 3 with every size < 0x40000 |
| bank sets | 0xBE90E0 | 0x78 | first 16-aligned offset after the sequence file with `u16[0] == 2 x numSeqs`, offsets < 0x400, counts 1..8, bank ids < numBanks |
| gAudioSessionPresets | 0xEB0D8 (RAM 0x800EA4D8) | 0xF0 | `u32 freq in 8000..48000, u8 1, u8 voices, u8 numReverbs <= 4, u8 0, u32 0x80xxxxxx, u16 0x7FFF` every 0x28 |
| gPitchBendFrequencyScale | 0xF6820 (RAM 0x800F5C20) | 0x400 | f32 `0.5, 0.5, 0.502736`; then gNoteFrequencies at +0x400, the default envelope at +0x620, the pan tables at +0x650..+0xAF0, gWaveSamples pointers at -0x20 |

All sequences, banks, instruments, drums, samples, loops, books and envelopes parse in all five ROMs (**Verified**, `mus/proto/check.ts`). Music data (sequences 1-29, music banks and samples) is identical in US, EU V1.0/V1.1 and J V1.0/V1.1; only the sound-effect sequence, bank and samples and build padding differ (**Verified**, `verdiff.ts`). The per-version offsets are in §10.

### 9.3 File formats (big-endian)

**Sequence file:**
```
+0x00 u16 revision = 3
+0x02 u16 count = 30
+0x04 count x { u32 offset (from the file start), u32 size }   size 0 = alias (none in MK64)
entries tile the file: offset[i+1] = align16(offset[i] + size[i])
```

**ctl bank file** and **AudioBank**:
```
file: u16 revision = 1, u16 count = 21, count x { u32 offset, u32 size }
bank entry: +0x00 u32 numInstruments; +0x04 u32 numDrums; +0x08 u32 1; +0x0C u32 0x19960624 (a date);
            +0x10 AudioBank, all offsets relative to entry + 0x10:
AudioBank:  u32 drumListOffset (0 = none); u32 instrumentOffset[numInstruments] (0 = empty slot)
drum list:  u32 drumOffset[numDrums] (0 = empty)
Instrument (0x20): u8 loaded; u8 normalRangeLo; u8 normalRangeHi; u8 releaseRate; u32 envelopeOffset;
                   3 x { u32 sampleOffset; f32 tuning }   (low, normal, high: note < lo -> low; <= hi -> normal; else high)
Drum (0x10):       u8 releaseRate; u8 pan; u8 loaded; u8 pad; u32 sampleOffset; f32 tuning; u32 envelopeOffset
Sample (0x14):     u8 unused; u8 loaded (0x80 = preloaded); u16 pad; u32 sampleAddr (within the bank's tbl entry);
                   u32 loopOffset; u32 bookOffset; u32 sampleSize
AdpcmLoop:         u32 start; u32 end; u32 count (0 none, 0xFFFFFFFF forever); u32 pad; if count != 0: s16 state[16]
AdpcmBook:         s32 order (2); s32 npredictors; s16 book[8 x order x npredictors]
Envelope:          s16 pairs {delay, arg}: delay > 0 ramp to arg; 0 disable; -1 hang; -2 goto index arg; -3 restart
```
- 21 banks, 279 instruments, 146 drums, 452 distinct samples, 113 envelopes; every book has order 2; sample data is 9-byte VADPCM frames of 16 samples (**Verified**).
- **Tunings** are `sampleRate / 26800` (26800, 22050, 16000 Hz ... all occur), and the driver does not scale pitch by the output rate (**Verified** tunings; Decomp code). Pitch: `freqScale = gNoteFrequencies[note] x tuning`, with gNoteFrequencies[39] = 1.0; drums play at `tuning`.
- **Loop state**: `state` holds the decoded samples of the frame containing `loop.start` for 199 of the 200 looped samples (the exception is a sound-effect sample): the convention of `libultra.ts prepareWave`. Non-looped samples stop at `loop.end`.

**tbl file:** `u16 revision = 2, u16 count = 21, count x { u32 offset, u32 size }`; all 21 entries are `{0xB0, 0x24C3F0}`, one shared blob. Sample ROM offset = tbl + entry[bank].offset + sampleAddr.

**Bank sets:** `u16 offset[30]` (from the table start), and at each offset `u8 count, u8 bankId[count]`. Every sequence has exactly one bank: sequences 1-10 use banks 1-10; 11-15, 20, 22 use bank 11; 16 and 24 bank 12; 23 bank 13; 17 bank 14; 18 bank 15; 19 bank 16; 21 bank 17; 25 bank 18; 26, 27, 29 bank 19; 28 bank 20; sequence 0 (sound effects) bank 0.

### 9.4 Sequence bytecode

Three script levels (sequence player, channel, layer) as in Star Fox 64 (STARFOX.md §6.3). Semantics Decomp (`seqplayer.c`); argument encodings **Verified** by a reachability disassembly of all 30 sequences with no undefined opcodes (`mus/proto/scan.ts`). `var` = 1 byte, or 2 when bit 7 is set: `((b0 & 0x7F) << 8) | b1`. Opcodes used by the music (sequences 1-29): player `D3 D5 D7 DD DB FD 9n FB FF D6 F8 F7`; channel `C1 C4 D3 D4 D7 D8 D9 DC DD DF E3 E9 FD FF 9n` (plus `CC 7n` in the title); layer `C0 C2 FC FF` and the three large-note forms.

Differences from `sf64.ts` (everything else matches STARFOX.md §6.3):

| level | op | Mario Kart 64 | Star Fox 64 |
|---|---|---|---|
| player | DC s8 | tempo += v x 48 | per-update tempo change |
| player | D2 / D1 s16 | short-note velocity / duration table = sequence + offset | skips 2 bytes (fixed tables) |
| player | C7 | undefined, no arguments | write into the sequence |
| channel | D3 u8 | freqScale = gPitchBendFrequencyScale[(v + 127) & 255] (**Verified**, disassembly 0x800C01F0) | index v + 128 |
| channel | 1n s16 / 2n | start channel n / disable channel n | 1n resets io, 2n starts a channel, CD disables |
| channel | ED, EE, CD, CE, CF | undefined, no arguments | gain (HILOGAIN), bend, disable channel, store/write |
| channel | E6 u8 | ADPCM book offset (unused by music) | ignored |
| channel | D0 u8 | stereo headset effects flag (1 bit) | stereo mode bits |
| layer | C7 | portamento modes 2 and 4 have extent 0 | computed |
| layer | Dn / En | velocity / duration from the player's relocatable tables | fixed tables |
| layer | CD | undefined | stereo effects |

Note timing: `delay = len; duration = (gate x len) >> 8`; the note decays when `delay <= duration`; gate 0 holds it until the next event. Pitch: `note = (op & 0x3F) + player, channel and layer transpositions` (u8; >= 0x80 is muted).

### 9.5 Engine and synthesis

The prototype `mus/proto/mk64synth.ts` (about 1200 lines) ports decomp `seqplayer.c`, `effects.c`, `playback.c`, `heap.c`, `synthesis.c`, `port_eu.c` and rsp-hle's NEAD MK handlers. What differs from Star Fox 64 (full detail in `mus/notes/music.md` §5):
- **Frame schedule:** all 3 updates' sequence processing runs first (each ending with a snapshot of every note's sub-state); then the 3 synthesis updates use the snapshots. A non-looped sample that ends in update u is disabled in the later snapshots of that frame.
- **Start:** `play_sequence` fades in over 8 updates from the first `DB`; channel init: volume 1, pan 0x40, weight 0x80, priority 3, release 0x20, vibrato rate 0x800, io -1.
- **Notes:** allocation from disabled notes (channel pool, player pool, global pool), then decaying notes, then **stealing the lowest-priority active note** (only the active list; Star Fox 64 also searches the releasing list). Decay: `fadeOutVel = releaseRate x 0.001171875 / 3` per update; release on steal or stop: 1/3 per update. Envelope point delay `d >= 4` becomes `d x 3 / 4` updates; linear ramps to `(arg / 32767)^2`.
- **Resampling:** below rate 2 one ADPCM part; at 2 or above, two parts decoded and decimated by 2 (no filter) with rate / 2. 4-tap interpolation with `RESAMPLE_LUT`.
- **Mixer (NEAD MK):** volume ramps from the previous chunk in `len >> 3` steps of 8 samples; per-side sign flips for strong left/right pans; the reverb send is a constant `(l x (reverbVol << 8)) >> 16` with **no ramp, no HILOGAIN, no reverb leak, no downsampled reverbs**; 16-bit clamping on every add.
- **Reverb (per update):** clear wet, load `len` samples from the ring, `dry += (wet x 0x7FFF) >> 15`, `wet = wet x (0x8000 + gain) >> 15` (feedback), mix the notes with reverb index 0, save `len` samples back. The ring is a pure delay of `window x 64` samples. Output = dry L/R, no master gain.
- **Pan:** stereo tables (`gStereoPanVolume`, strong-side flags for pan < 0x20 / > 0x60), mono 0.707, headphones (Haas delay, not ported; stereo is the default).

### 9.6 Song list

30 sequences: id 0 is the sound-effect player; ids 1-29 are music. Ids and decomp names from `include/seq_ids.h` (Decomp); internal names from the leak's `kart_sou_inc.h` (Leak-supported); uses from the call sites (`play_music_for_current_track`, `menus.c`, `ceremony_and_credits.c`) (Decomp); bank, tempo and loop structure **Verified** (parse and render). **The game has no sound test and no track titles: the viewer names below are descriptive** (course names are the official course names).

| id | decomp name | leak name | BPM | preset | used for | viewer name |
|---|---|---|---|---|---|---|
| 1 | SEQ_MENU_TITLE_SCREEN | TITLE_BGM | 140 | 0 | title screen (continues into the attract demo) | Title |
| 2 | SEQ_MENU_MAIN_MENU | SELECT_BGM | 132 | 0 | game, character and course select, options, data | Menu |
| 3 | SEQ_TRACK_RACEWAY | CIRCUIT_BGM | 140 | 5 / 4 | Mario Raceway, Luigi Raceway (preset 5); Royal Raceway, Wario Stadium (preset 4) | Raceway |
| 4 | SEQ_TRACK_FARM | COUNTRY_BGM | 138 | 4 | Moo Moo Farm, Yoshi Valley | Moo Moo Farm / Yoshi Valley |
| 5 | SEQ_TRACK_MOUNTAIN | MOUNTAIN_BGM | 148 | 4 | Choco Mountain; battle: Block Fort, Double Deck | Choco Mountain |
| 6 | SEQ_TRACK_BEACH | BEACH_BGM | 118 | 4 | Koopa Troopa Beach | Koopa Troopa Beach |
| 7 | SEQ_TRACK_SCARY | OBAKE_BGM | 104 | 4 | Banshee Boardwalk | Banshee Boardwalk |
| 8 | SEQ_TRACK_SNOW | SNOW_BGM | 124 | 4 | Frappe Snowland, Sherbet Land | Frappe Snowland / Sherbet Land |
| 9 | SEQ_TRACK_CASTLE | CASTLE_BGM | 120 | 4 | Bowser's Castle | Bowser's Castle |
| 10 | SEQ_TRACK_DESERT | DIRT_BGM | 128 | 4 | Kalimari Desert | Kalimari Desert |
| 11 | SEQ_EVENT_RACE_STARTING | GRID_BGM | 120 | 4 | starting grid fanfare, Grand Prix | Starting grid (Grand Prix) |
| 12 | SEQ_EVENT_RACE_FINAL_LAP | FINALLAP_FAN | 138 | 4 | final lap fanfare | Final lap |
| 13 | SEQ_EVENT_RACE_FINISH_FIRST | GOALIN_A_BGM | 121 / 105 | 4 | finish in 1st | Goal (1st place) |
| 14 | SEQ_EVENT_RACE_FINISH_OTHER | GOALIN_B_BGM | 110 | 4 | finish 2nd-4th | Goal (2nd-4th place) |
| 15 | SEQ_EVENT_RACE_FINISH_LOSE | GOALIN_C_BGM | 82-98 | 4 | finish 5th-8th | Goal (5th-8th place) |
| 16 | SEQ_MENU_RESULTS_SCREEN_WIN | RESULT_BGM | 160 | 4 | results after 1st-4th | Results |
| 17 | SEQ_EVENT_RACE_POWERUP_STAR | STAR_BGM | 161 | 4 | Star power-up (1-2 players) | Star |
| 18 | SEQ_TRACK_RAINBOW | RAINBOW_BGM | 138 | 4 | Rainbow Road | Rainbow Road |
| 19 | SEQ_TRACK_JUNGLE | JUNGLE_BGM | 127 | 4 | D.K.'s Jungle Parkway | D.K.'s Jungle Parkway |
| 20 | SEQ_EVENT_CEREMONY_TROPHY_LOSE | GAMEOVER_BGM | 106 | 3 | end of the losing award ceremony | No trophy |
| 21 | SEQ_TRACK_TURNPIKE | HIGHWAY_BGM | 136 | 4 | Toad's Turnpike | Toad's Turnpike |
| 22 | SEQ_EVENT_RACE_STARTING_VS | TIMEGRID_BGM | 150 | 4 | starting grid fanfare outside Grand Prix | Starting grid (Time Trials / VS / Battle) |
| 23 | SEQ_MENU_RESULTS_SCREEN_WIN_VS | VSRESULT_BGM | 123 | 4 | VS and battle results | Results (VS / Battle) |
| 24 | SEQ_MENU_RESULTS_SCREEN_LOSE | LOSTRESULT_BGM | 110 | 4 | results after 5th-8th | Results (lost) |
| 25 | SEQ_TRACK_BATTLE | BATTLE_BGM | 124 | 4 | battle: Skyscraper, Big Donut | Battle |
| 26 | SEQ_EVENT_CEREMONY_PRESENTATION_PART1 | PRIZE_A_BGM | 86-90 | 3 | award ceremony, first part | Award ceremony (opening) |
| 27 | SEQ_EVENT_CEREMONY_PRESENTATION_PART2_WIN | PRIZE_B_BGM | 146 | 3 | award ceremony, presentation | Award ceremony |
| 28 | SEQ_EVENT_CEREMONY_TROPHY_CREDITS | ENDING_BGM | 130 | 2 | staff credits | Staff credits |
| 29 | SEQ_EVENT_CEREMONY_PRESENTATION_PART2_LOSE | PRIZE_C_BGM | 146 | 3 | losing ceremony (a detuned variant of 27) | Award ceremony (lost) |

Behaviour notes (Decomp): 3- and 4-player split screen plays no course music. The final lap and the Star do not resume the course song: it fades out, the overlay plays on player 1, and the course song then restarts from its beginning (at 125 % tempo on the final lap, capped at 300 BPM; Hypothesis on the exact tempo, §13). Race end stops the course song, plays the goal fanfare and queues the results song.

Suggested viewer track list: the 29 music sequences with `MusicTrack.index` = sequence id and the names above.

### 9.7 Loops and offline rendering

Every looping song ends its section with a **sequence-level backward jump** (`FB`; Results uses `F8 40 ... F7`); non-looping songs end with `D6 mask; FF` (**Verified**, static scan and render). Standard layout: `D3 20; D5 32; D7 mask`, channel setup scripts, `DD bpm; DB vol; FD 08`, then the loop: start the section's channel scripts, `FD len`, `FB loop`. Songs with a real intro (4, 6, 8, 9, 23) jump back to a later section.

**Loop rule** (prototype `render.ts`): render until the second execution of the first backward sequence-level jump (`FB`, or an `F7` loop-back). `loopStart` is the sample at its first execution, `loopEnd` at its second; the jump's sample position is the start of the chunk of the update in which it executes. Both edges carry the previous pass's release tails and reverb, so `[loopStart, loopEnd)` repeats seamlessly. A song that ends renders until no note has been enabled for 0.25 s (at most 8 s after the player ends).

Loop points at 26800 Hz (US; sequence 3 with preset 5 has the same points) (**Verified** by render and by the tick arithmetic: ticks / (0.80223 x BPM) reproduces every loop length):

| id | name | loopStart | loopEnd | loop (s) | loop ticks | rendered (s) |
|---|---|---|---|---|---|---|
| 1 | Title | - | - | plays once | 6528 + 8 setup | 58.47 |
| 2 | Menu | 779736 | 1557232 | 29.011 | 3072 | 58.12 |
| 3 | Raceway | 1926328 | 3850568 | 71.800 | 8064 | 143.68 |
| 4 | Moo Moo Farm / Yoshi Valley | 1628840 | 3162696 | 57.233 | 6336 | 118.02 |
| 5 | Choco Mountain | 2428976 | 4856008 | 90.561 | 10752 | 181.20 |
| 6 | Koopa Troopa Beach | 1796192 | 3318288 | 56.795 | 5376 | 123.83 |
| 7 | Banshee Boardwalk | 1236216 | 2469760 | 46.028 | 3840 | 92.17 |
| 8 | Frappe Snowland / Sherbet Land | 1864528 | 3519728 | 61.761 | 6144 | 131.35 |
| 9 | Bowser's Castle | 2781840 | 4492272 | 63.822 | 6144 | 167.63 |
| 10 | Kalimari Desert | 1806320 | 3610256 | 67.311 | 6912 | 134.72 |
| 11-15 | jingles | - | - | once | | 3.9-8.6 |
| 16 | Results | 1325264 | 2648136 | 49.361 | 6336 | 98.82 |
| 17 | Star | 161248 | 320552 | 5.944 | 768 | 11.97 |
| 18 | Rainbow Road | 3534328 | 7066568 | 131.800 | 14591 | 263.68 |
| 19 | D.K.'s Jungle Parkway | 406312 | 810400 | 15.078 | 1536 | 30.25 |
| 20 | No trophy | - | - | once | | 9.40 |
| 21 | Toad's Turnpike | 2077296 | 4152504 | 77.433 | 8448 | 154.95 |
| 22 | Starting grid (TT/VS/Battle) | - | - | once | | 3.55 |
| 23 | Results (VS / Battle) | 999648 | 1834016 | 31.133 | 3072 | 68.45 |
| 24 | Results (lost) | 469152 | 935616 | 17.405 | 1536 | 34.92 |
| 25 | Battle | 2278296 | 4554352 | 84.927 | 8448 | 169.95 |
| 26 | Award ceremony (opening) | - | - | once | | 19.67 |
| 27 | Award ceremony | 704992 | 1407888 | 26.227 | 3072 | 52.55 |
| 28 | Staff credits | - | - | once | | 169.88 |
| 29 | Award ceremony (lost) | 704992 | 1407888 | 26.227 | 3072 | 52.55 |

- Results (16) plays section A 64 times (52.6 minutes) before a section B (§14); the viewer loops section A.
- Rainbow Road's section delay is 14591 ticks (one short of 14592) in the data.
- In the game the DAC runs at 26807 Hz, so loop lengths in captured samples scale by 26807/26800 (0.03 %).

Renders: all 29 songs in about 50 s of CPU, no undefined opcodes, no note-allocation failures; per-second RMS medians -23 to -14 dBFS, peaks reaching full scale in 8 songs (16-bit clamping as on the RSP); spectral peaks within ±9 cents of the A440 grid in 27 of 29 songs (**Verified**, `mus/proto/analyze.ts`). Game comparison: §12.4.

### 9.8 Reuse verdict

**`sf64.ts` cannot be reused as is, with parameters, or behind a format adapter**: the containers differ (sequence file / ctl / tbl vs AudioTable / soundfonts / sample banks; 0x14 vs 0x10 sample structs; 6 x 0x28 presets vs spec tables; 26800 vs 32000 Hz), and so do about 25 engine behaviours (§9.4, §9.5). **Recommended: fork it** into `src/rom/music/mk64.ts` with the same architecture (data, engine, note pool, ADSR, vibrato and portamento, mixer loop, reverb ring, PCM output with loop points); the prototype `mus/proto/mk64synth.ts` + `mk64audio.ts` is already written in that shape. Reuse from `libultra.ts`: `decodeVadpcm`, `RESAMPLE_LUT` and the `prepareWave` loop-state convention. Estimate: about 1400 lines, difficulty small-medium. A shared EAD core with per-revision flags would risk Star Fox 64's bit-identical renders and is not worth it for two games.

## 10. Version differences

`fs/proto/versiondiff.ts` and `mus/proto/verdiff.ts` compare every decoded course file, common segment and audio file of the five ROMs (**Verified**).

**EU V1.0 and V1.1:** every course file (segments 4, 5, 6, 7, 9, the CourseVtx and packed streams, every texture), the common segments 2, D and B, the startup logo, and all music data are byte-identical to US. Only ROM offsets move. One loader serves US and both EU versions with a per-version course-table offset (found by pattern); every segment-internal address of §5 and §6 applies unchanged. The EU sound-effect sequence differs (and EU V1.0 retunes one sound-effect instrument), which does not affect music. EU runs at 50 Hz: the music's tempo constant and envelope timing differ (150 updates per second, tempo constant 8986), which a PAL render would need (Hypothesis, not rendered).

**J V1.0 and V1.1** differ from US in:
- the common segments: data_segment2 (526 bytes), common textures (Japanese text), ceremony data (J V1.1 only);
- billboard textures with English text (Luigi's, Mario Star, Nintendo, Yoshi, Koopa Air, Moo Moo Farm signs) in Mario Raceway, Choco Mountain, Royal Raceway, Moo Moo Farm, Toad's Turnpike and Kalimari Desert;
- Luigi Raceway geometry and textures (5949 vs 5936 vertices, 3026 vs 3022 triangles, a 64-wide texture #2);
- Bowser's Castle geometry in J V1.0 only (9523 vs 9527 vertices; J V1.1 matches US);
- the segment-6 layout of most courses (smaller, e.g. Mario Raceway 38048 vs 38904 bytes) and the section tables in segment 9, so the §5/§6 addresses do not apply; J V1.1 also changes segment 6 of Frappe Snowland and Rainbow Road at equal size;
- J V1.1 moves the ceremony data and startup logo behind the common textures;
- audio: 0x190 more bytes of sound-effect sample data and a different sound-effect sequence; music identical.

Per-version addresses (**Verified**, `detectLayout` in `fs/proto/mk64fs.ts` and `mus/proto/check.ts`):

| | US | EU V1.0 | EU V1.1 | J V1.0 | J V1.1 |
|---|---|---|---|---|---|
| racing segment ROM (vram 0x8028DF00) | 0xF7510 | 0xF7650 | 0xF7570 | 0xF7FC0 | 0xF6DB0 |
| ending segment ROM (vram 0x80280000) | 0x123640 | 0x123840 | 0x123760 | 0x124070 | 0x122EA0 |
| gCourseTable ROM | 0x122390 | 0x122570 | 0x122490 | 0x122DC0 | 0x121BF0 |
| gCourseTable RAM | 0x802B8D80 | 0x802B8E20 | 0x802B8E20 | 0x802B8D00 | 0x802B8D40 |
| data_segment2 ROM | 0x12AAE0 | 0x12ACE0 | 0x12AC00 | 0x12B500 | 0x12A330 |
| common textures ROM | 0x132B50 | 0x132D50 | 0x132C70 | 0x133570 | 0x1323A0 |
| other_textures base | 0x641F70 | 0x642170 | 0x642090 | 0x642940 | 0x64D7B0 |
| ceremony data ROM | 0x821D10 | 0x821F10 | 0x821E30 | 0x821890 | 0x144CC0 |
| startup logo ROM | 0x825800 | 0x825A00 | 0x825920 | 0x825380 | 0x1487D0 |
| course 0 data stream | 0x8284D0 | 0x8286D0 | 0x8285F0 | 0x828050 | 0x826EF0 |
| ctl bank file | 0x966260 | 0x966460 | 0x966380 | 0x965840 | 0x964470 |
| tbl sample file | 0x979AA0 | 0x979CA0 | 0x979BC0 | 0x979100 | 0x977D30 |
| sequence file | 0xBC5F60 | 0xBC6160 | 0xBC6080 | 0xBC5740 | 0xBC4370 |
| bank sets | 0xBE90E0 | 0xBE93E0 | 0xBE9300 | 0xBE8900 | 0xBE7530 |

Recommendation: **US primary**. EU V1.0 and V1.1 can be accepted cheaply (courses by pattern, music by structure; PAL music timing aside). J needs its own recipe address tables (or a pattern lookup of the TrackSections and section tables) and should be left out at first.

## 11. Mapping onto the viewer

### 11.1 Detection and files

The implementation adds `mk64` to `Game.id`, accepts `NKTE` revision 0, and locates `gCourseTable` with the structural
test in §3.2. It rejects PAL despite largely shared course data because its 50 Hz driver timing and envelope branches
are not yet verified, and rejects Japanese ROMs until their relocated recipe addresses are supplied. **Verified basis:**
the research detector finds all five known revisions structurally; the shipped loader deliberately exposes only the
fully verified USA revision.

Suggested ownership:

| module | responsibility | difficulty |
|---|---|---|
| `src/rom/mk64/fs.ts` | layout detection, course table, MIO0, CourseVtx expansion, packed-list expansion, texture lists and segmented address space | small |
| `src/rom/mk64/courses.ts` | course names, cup grouping, per-course draw recipes, TrackSections and path addresses | small-medium |
| `src/rom/mk64/level.ts` | run recipes/tables, merge duplicate triangles, build layers, meshes, bounds and camera | medium |
| `src/rom/mk64/collision.ts` | reproduce the display-list collision walk and surface meshes | small |
| `src/rom/mk64/objects.ts` | spawn lists, foliage snapping, actor models, code-placed markers, vehicles and paths | medium-large |
| `src/rom/mk64/environment.ts` | sky gradient, fog, clouds/stars and perspective table | medium |
| `src/rom/music/mk64.ts` | ctl/tbl/sequence parsing and the NEAD MK driver/synthesizer | medium-large, about 1,400 lines from the prototype |
| `src/rom/mk64/mk64.ts` and `src/rom/index.ts` | `Game`, level/music lists, detection and integration | small |

Use the existing MIO0 implementation if it exposes the consumed compressed length; otherwise port the short decoder
from `fs/proto/mk64fs.ts`. Reuse `decodeVadpcm`, `RESAMPLE_LUT` and the loop-state convention from `music/libultra.ts`,
but do not parameterize `sf64.ts`: §9.8 lists engine differences that would put Star Fox's verified output at risk.

### 11.2 Level assembly and layers

For each race course, the implementation creates a `SegmentSpace` for 2/4/5/6/7/9/D and executes the retail
`render_course_credits` whole-course root. This is the game's coherent unsplit static model: each course part appears
once and inherited texture/material state remains intact. The section tables are camera-section × direction
alternatives, not additive chunks; unioning them caused duplicate surfaces, mutually exclusive route geometry,
all-direction overlays and texture-state restarts during implementation. Battle arenas use their explicit draw recipes,
and genuinely camera-dependent extras remain inspectable in a hidden layer. The implemented layers are:

| layer | kind | default | contents |
|---|---|---|---|
| `main` | main | on | opaque/cut-out geometry from the coherent whole-course root or battle recipe |
| `translucent` | foreground | on | translucent geometry emitted by that same root/recipe |
| `objects` | objects | on | decoded item boxes, foliage and static actor models |
| `paths` | markers | off | continuous main/secondary/boundary ribbons, train/ferry/ceremony paths and start markers |
| `camera-dependent` | foreground | off | the conditional black SHADE lists whose exact gameplay purpose remains open |
| `collision` | collision | off | one coloured mesh per surface type, including collision-only triangles |

Every instance belongs to one of these layers. Moving/static-frame objects are marked `animated` where applicable.
Paths use thin quad ribbons because the renderer has no line primitive. `Batch.triSource`, `Mesh.info` and
`Instance.info` retain segmented display-list addresses, surface ids, section ids, object records and presentation
notes for reports.

Implemented `runDisplayList` defaults are `ucode: 'f3dex'`, scale 1, no mirror, initial geometry mode
`G_ZBUFFER | G_SHADE | G_CULL_BACK | G_SHADING_SMOOTH`, render mode AA_ZB_OPA_SURF, SHADE combiner, combiners and
decals enabled, and lighting disabled for course geometry. The recipe supplies inherited texture/render state; never
execute packed segment-7 leaf lists in isolation.

### 11.3 Contract additions and approximations

The relevant renderer additions and deferred features are:

- implemented `Instance.billboard?: 'y'` for camera-facing actor art;
- a screen-space sky-gradient structure holding four colours and the world horizon point `(0,0,30000)`; the renderer
  projects that point using the level camera and splits two vertical gradients at its screen row;
- optional camera-yaw screen sprites for clouds and stars;
- optional per-batch UV scroll for water and other animated textures.

The current loader represents the four-colour sky on a camera-centred mesh; this is not pixel-equivalent to the game's
screen-space split. Clouds/stars are omitted, and animated textures use a static frame. Billboards are fully dynamic,
not fixed to the start camera. The framebuffer-fed screens on Luigi Raceway and Wario Stadium necessarily show their
ROM texture in an offline viewer.

### 11.4 Camera, fog and music

Use the Time Trials start rule for a stable default: kart at path point 0 plus `(0,0,30)`, eye 50 units behind and 9.5
above, target 70 ahead, FOV 40; use the course near/far values of §8. Fog maps directly to `Level.fog` for Choco
Mountain and Toad's Turnpike. Course paths and collision remain in native units with Y up and no axis reflection.

Expose music sequences 1-29 with the descriptive names in §9.6. `decodeMusic` chooses the normal caller's audio preset
(Raceway uses preset 5 for Mario/Luigi and preset 4 for Royal/Wario; use preset 5 for the standalone track) and returns
the loop points in §9.7 at 26,800 Hz. Do not include sequence 0, which is sound effects.

### 11.5 Implementation outcome and remaining risk

The USA implementation passes all-level hashes, transfer and layer audits, all 21 offline renders, report-camera
regressions and browser integration checks. It uses no shared display-list special case. Remaining fidelity risk is
concentrated in dynamic objects, the approximate sky, omitted cloud/star sprites and texture animation. Bowser's Castle
lava deliberately receives a material-wide planar presentation at the median authored texel density: the retail data's
per-face UV bases decode correctly, but their independently rotated orientations create dominant radial seams from
unrestricted overhead viewer angles. This is labelled as a presentation normalization in debug metadata, not as a
decoder correction. Supporting Japanese revisions remains a separate task; PAL support additionally requires verified
50 Hz music timing and envelope behavior.

## 12. Verification evidence

### 12.1 ROMs, tables and codecs

- **Verified, ROM bytes:** header ids, versions and hashes in §1; unique structural discovery of `gCourseTable` and
  `other_textures` in all five ROMs.
- **Verified, exhaustive decode:** `fs/proto/extract.ts` validates all 20 course entries, MIO0 boundaries, CourseVtx
  sizes, packed display-list output sizes/opcodes and every texture stream. US and both EU revisions also match the
  leaked generated course-header counts. Japanese mismatches are version differences recorded in §10, not decode errors.
- **Verified, byte comparison:** `fs/proto/versiondiff.ts` establishes byte-identical US/EU course resources and the
  Japanese differences. `fs/proto/streams.ts` decodes all 3,354 aligned MIO0 signatures in each ROM without overrun.

### 12.2 Geometry, textures and collision

- **Verified, exhaustive static analysis:** `lv/proto/scan.ts`, `coverage.ts`, `census.ts`, `analysis.ts` and
  `tilecfg.ts` resolve every recipe address, enumerate every reachable display list, texture command, render state and
  collision group, and show that existing `displaylist.ts` handles every executed opcode.
- **Verified, offline frames:** `lv/renders/` contains top, two corner, start, collision and texture-sheet views for all
  20 courses plus the award ceremony. Visual review confirms complete recognizable layouts, correct unmirrored text,
  texture assignment, cut-outs and the translucent water/ice/Rainbow Road passes.
- **Verified, emulator RAM:** `rt/d/demo1_c00_attract.bin` is Mario Raceway in an attract race. Running
  `lv/proto/ramcompare.ts` shows segment 9, 6, 4, 7, 5 and D byte-identical to the decoder. Segment 2 has 60 bytes of
  expected runtime mutation. `gCollisionMeshCount` is 1,291 and every 0x2C-byte collision record matches the offline
  builder (zero mismatches). Output: `resume-checks/c00_ramcompare.txt`.
- **Verified, independent resumed emulator RAM:** `emu2/dumps/mario.bin`, captured with the current repository emulator
  interface, repeats the segment and collision result: segments 9/6/4/7/5/D byte-identical, 60 runtime bytes changed in
  segment 2, and 1,291/1,291 collision records matching. Output: `emu2/analysis/mario_ramcompare.txt`.

### 12.3 Objects, environment and camera

- **Verified, all ROM course data:** `ob/proto/spawns.ts` finds every actor spawn list and terminator in segment 6,
  cross-checks each pointer against a code constant, decodes every track/auxiliary path, and applies foliage grounding.
- **Verified, Mario Raceway RAM:** `ob/proto/ramactors.ts` checks actor positions against the attract dump. All 27 trees,
  including six ground-adjusted trees, match; 11 item boxes at rest match the data Y plus 8.66; four remaining boxes are
  in their respawn animation. Both hard-coded Mario signs match. `ramprobe.ts` verifies the segment table, camera layout,
  FOV 40, perspective 9/4500 and screen horizon row.
- **Verified, resumed runtime:** `emu2/analysis/mario_ramactors.txt` matches all 52 actors predicted from static course
  data by type and position (worst error 0.000); four additional live actors are the two hard-coded signs and two moving
  or falling objects. `mario_ramprobe.txt` reads the live 320x240 screen, horizon row 110, path section 10, camera eye and
  target, stored eye/target offsets `(0,9.5,-50)` / `(0,0,70)`, current attract-camera FOV 42.9976 and perspective
  9/4500. Screenshots: `emu2/shots/title.png`, `mario_raceway_attract.png`.
- **Verified, ROM bytes/disassembly:** sky colour, cloud/star, path-size, path-pointer, object-position, lighting,
  perspective and fog constants are indexed in `ob/proto/romtables.txt` and `code_consts.txt`. Where rendering behaviour
  is taken only from the matching decompilation, §§7-8 retain the **Decomp** label.
- **Verified, targeted closure:** `ob2/OBJECTS_ENV.md` resolves Toad's Turnpike fog to RGB (43,13,4), proves
  `gObjectList` at 0x80165C18 as 550 x 0xE0 bytes, extracts all Sherbet penguin and Rainbow sign/Chain Chomp starts,
  and compares reconstructed segment 3 with RAM. Its 17 differences are exactly the zero tails caused by undersized
  DMAs for two green-shell frames; the entire course-object texture region 0x2000-0xDFFF is byte-identical.

### 12.4 Music

- **Verified, exhaustive parsers:** `mus/proto/check.ts`, `scan.ts`, `verdiff.ts`, `tblcover.ts` and `unusedinst.ts`
  parse all sequences, banks, instruments, drums, envelopes, books, samples and bank sets; every reachable music opcode
  is defined and the sample table has no uncovered bytes.
- **Verified, offline audio:** `mus/proto/render.ts` renders all 29 music sequences without allocation or bytecode errors,
  writes WAV `smpl` loop chunks, and independently agrees with sequence tick arithmetic for every loop length.
  `analyze.ts` checks level, clipping and pitch-grid placement.
- **Verified, emulator state/audio metadata:** the first runtime session observed the correct sequence ids on title,
  menus and Luigi Raceway and recorded DAC rate 26,807 Hz (dacrate 1815), matching the 26,800 Hz preset request.
- **Verified, captured menu music:** `mus2/MUSIC_VERIFY.md` measures the game-select capture's stable loop five times at
  29.07 s versus the render's 29.011 s (0.20% longer), with zero semitones the unique chroma match, 1.000 log-spectrum
  correlation over 0-8 kHz, and matching rounded stereo RMS (-21.7/-20.1 dBFS). This independently supports the rate,
  tuning, instrumentation, stereo balance, level and near-correct tempo; it does not establish sample-identical output.
- **Verified, mixed Luigi Raceway capture:** runtime sequence id 3, coherent approximately one-to-one time alignment,
  zero semitones as the unique chroma match (0.972), and 0.989 log-spectrum correlation support the song mapping,
  pitch and near-correct tempo. Engine/SFX overlap makes the capture 1.3-1.7 dB louder and prevents a clean waveform,
  reverb-preset or voice-stealing comparison. Its roughly 55 seconds of confirmed race music is shorter than the
  71.800-second loop, so that loop boundary remains verified by ROM bytecode and model arithmetic, not runtime audio.

### 12.5 Research process and reproducibility

The reusable decoders and targeted analyzers are under `fs/proto`, `lv/proto`, `ob/proto` and `mus/proto`; their inputs
and outputs are named in the detailed notes. The resumed runtime validation uses only the repository emulator described
in `EMULATOR.md`, with a private `M64P_RUN_DIR`, documented start/stop commands and run-specific process cleanup. See
`emu2/SESSION.md` and `PROGRESS.md`. It launched `/home/n64/nviewer/emu/headless.sh --debug` as a retained child, used
only the repository `headless-debug.sh`/`headless-send.sh`, stopped PID 2801601 with the run-specific debugger `quit`,
and verified the PID and all `emu2`-scoped emulator/headless processes gone. No emulator is needed to reproduce the
exhaustive ROM/resource checks.

## 13. Open questions and hypotheses

The following gaps do not block a useful US viewer implementation:

- **Camera-dependent geometry:** the section-direction ambiguity is resolved by using the retail whole-course credits
  roots rather than a union. Conditional SHADE lists remain hidden and inspectable; the exact visual purpose of
  `func_80290C20` is unresolved. (**Implementation verified; conditional purpose open.**)
- **Dynamic screens and animation:** the exact segment-5 rectangles overwritten by Luigi Raceway's TV and Wario
  Stadium's jumbotron, and frame-zero offsets for scrolling textures, are not independently checked in RAM. A static
  ROM texture and zero scroll are the proposed viewer representation. (**Decomp-supported; runtime open.**)
- **Collision:** gameplay meanings of triangle flags 0x200/0x400/0x800/0x1000 remain unidentified. Their geometry,
  values and source rules are verified and can be exposed diagnostically. (**Open.**)
- **Objects:** karts and fully animated hazards are outside the static viewer scope. Code-created sprite/spline objects
  can begin as labelled markers. Some actor display-list names are inferred from decomp call sites rather than visual
  model renders. (**Explicit approximation.**)
- **Environment:** clouds/stars are camera-yaw screen sprites and the sky split depends on a projected fixed world
  point; a dome approximation is not pixel-equivalent. Moo Moo Farm writes fog state inside lists, but its visible
  interaction with inherited RDP state is not fully established. (**Decomp-supported; pixel comparison open.**)
- **Versions:** Japanese revisions require relocated recipe/table addresses and selective content handling. PAL music
  needs 50 Hz scheduling and EU-revision envelope/note branches before it can be called timing-accurate. (**Verified
  version differences; implementation open.**)
- **Music:** the menu and mixed Luigi Raceway comparisons strongly support pitch, spectrum, level and approximate tempo,
  but sample-identical synthesis remains unverified. Clean title/course waveform alignment, Raceway's runtime loop
  boundary, race-time voice stealing by the shared SFX player, headphone Haas panning and the exact final-lap tempo
  handoff remain open. Sequence data, driver model and loop points are independently verified. Sequence 3 has two
  legitimate reverb presets which the mixed capture cannot distinguish; use preset 5 for the standalone viewer track.
  (**Open where stated.**)

## 14. Unused and hidden content

This pass separates data that is genuinely unreachable in the retail program from content that is merely hidden behind a dormant debug gate, restricted to a game mode, or misleadingly named in the decompilation. `Verified` means checked in the retail ROM bytes or by an exhaustive parser; `Decomp` means control flow in the matching public decompilation; `Leak-supported` means the local development-source snapshot agrees but is not retail-ROM proof.

### 14.1 No retail test-course slot was found

- **Verified (ROM bytes):** the US course table begins at ROM `0x122390` and has exactly twenty `0x30`-byte records, for course IDs 0--19. The next record at `0x122750` is zero. The corresponding offsets are `0x122570` (EU 1.0), `0x122490` (EU 1.1), `0x122DC0` (JP 1.0), and `0x121BF0` (JP 1.1). The award ceremony is ID 20 but has no course-table record; it loads Royal Raceway through ceremony code.
- **Decomp:** `gCourseTable` has twenty initializers and the course enum contains the sixteen race courses, four battle courses, then `COURSE_AWARD_CEREMONY`. The splash debug selector also wraps within the ordinary twenty playable courses; it exposes no additional test ID.
- **Leak-supported:** the development snapshot has the same twenty `KT1`--`KT20` course units and `course1`--`course20` headers. No additional course unit was found in that production set.

This proves that the retail course filesystem and selector contain no extra/cut course. It does not prove that no isolated, unreferenced art fragment exists anywhere in otherwise unclassified ROM padding.

### 14.2 Retail debug facilities

- **Decomp:** the complete splash-screen debug menu remains in retail code. Its options toggle debug mode, choose one of the twenty courses, screen mode, player and sound mode, or grant all gold cups. Start/A can launch the selection; holding L selects demo behavior; Z-modified selections reach the ending or credits paths.
- **Decomp:** an IDO retail build initializes `gEnableDebugMode` to zero and `gDebugMenuSelection` to `DEBUG_MENU_DISABLED`; the source contains no normal retail transition into the menu. `ENABLE_DEBUG_MODE` is one only for `GCC` or `DEBUG` builds. Thus the menu is **present but dormant**, not deleted content.
- **Decomp:** other retained debug controls include R+B resource meters, A+B with L/R path-direction UI, D-pad shortcuts for the final lap, controller-5 Z to start a race, A+B+L+R reset, and ceremony character selection with C/D-pad. These are debug-mode or special-state features, not unused assets.

### 14.3 Course display lists and texture-list entries

The structural reachability scan in `unused2/coverage.txt` starts at every command after `G_ENDDL` and follows known race recipes, credits roots, and track-section roots. Its `never` set is deliberately an over-approximation: many addresses are internal fragments, terminal sentinels, or roots selected by control flow that the static route model does not encode. It did not establish any coherent cut course or model as genuinely unreachable.

Several apparent candidates are demonstrably used:

- **Decomp:** Mario Raceway `0x070008E8` is the one-player variant and `0x07002D68` the multiplayer variant.
- **Decomp:** Choco Mountain lists `0x07000000`, `0x07000098`, `0x07000178`, `0x07000280`, `0x07000340`, and `0x070003C8` are guardrails retained only for 50cc and Time Trials; other modes replace their first command with `G_ENDDL`.
- **Decomp:** Rainbow Road `0x07001FB8` has its vertex alpha changed outside the credits. It is a state variant, not unused.
- **Decomp:** twelve untextured SHADE lists are called only when `func_80290C20(camera)` is true: Mario `0x07003050`, Choco `0x07004608`, Bowser `0x07006A80`, Frappe `0x070065E0`, Koopa Beach `0x07009CC0`, Royal `0x0700B030`, Luigi `0x07009EC0`, Kalimari `0x070071C8`, Wario `0x0700A0C8`, DK Jungle `0x070092D8`, Big Donut `0x07000DE8`, and Sherbet `0x07002B48`. They are camera/collision-state geometry.
- **Decomp:** battle courses have no credits route; the credits dispatcher uses a Sherbet Land placeholder for their IDs. That absence is not evidence of cut battle-course credits geometry.

The earlier three apparent unused course texture-list entries are false positives:

- **Verified + Decomp:** Banshee Boardwalk entry 1 (`gTexture676FB0`, segment 5 `0x05000800`) is loaded by packed lists reached from `d_course_banshee_boardwalk_dl_B308`, the credits whole-course list.
- **Verified + Decomp:** Koopa Troopa Beach entry 4 (`gTexture643430`, segment 5 `0x05003000`), labelled in the decomp as a possibly unused waterfall-bubbling effect, is reached from `d_course_koopa_troopa_beach_dl_18D68` in the credits.
- **Verified:** Moo Moo Farm entry 2 (`gTexture64AF50`, segment 5 `0x05001800`) is loaded repeatedly by the normal segment-6 course lists.

After those credits and normal-course routes are included, every course texture-list entry has a consumer. None requires an object-code explanation. The Koopa Beach comment is a decomp naming/comment artifact, not proof of unused content.

### 14.4 Genuinely unused paths and object data

- **Verified (ROM table) + Decomp:** `gCoursePathTable` contains a secondary coordinate path for each of the sixteen race courses (44--109 points each). `load_track_path` uses `gCoursePathTable2` during races and consults `gCoursePathTable` only for `COURSE_AWARD_CEREMONY`, whose row contains four used ceremony paths. The sixteen race-course secondary paths are therefore genuine unused retail coordinate data.
- **Decomp:** `D_800E5740`, `D_800E579C`, and `D_800E57F8` are three 16-position particle tables consumed only by uncalled function `func_80076884`.
- **Decomp:** spline `D_800E5D54` is consumed only by uncalled `func_8007D070`; zero spline `D_800E5D78` has no consumer. `D_800E641C` and `D_800E64D8` are referenced only by unused pointer table `D_800E6724`. Flat table `D_800E5FD0` likewise has no code reference outside its declaration.

These are small abandoned placement/path resources, not hidden levels. `indexObjectList4` is not one of them: despite its old “unused list” description, allocation and deletion code both reference it.

### 14.5 Dormant packed-display-list operations

- **Verified (all twenty packed streams):** no retail course stream emits opcodes `0x00`--`0x14`, `0x2D`--`0x30`, or `0x53`--`0x56`. `0x31` and `0x32` have no useful handler (`0x32` would encode a zero-count vertex load).
- **Decomp:** the unused implemented operations cover light loads, `G_CULLDL`, an alternate combiner, translucent/decal render modes, `G_QUAD`, and back-face-culling state. The light operations address segment 9 as if it held `Light` structures, whereas retail course segment 9 begins with the texture list; no retail stream invokes them.

This is unused **converter/engine capability**, not hidden visual content. The decomp's standalone `displaylist_packer` reverses the ROM meanings of packed opcodes `0x26` and `0x27` (texture on/off); that is a reconstruction-tool mismatch, not a retail leftover.

### 14.6 Audio that is unused or practically hidden

- **Verified (sequence disassembly and offline render):** Results sequence 16 repeats section A 64 times (`64 x 49.36 s`, about 52.6 minutes) before section B, which then loops twice at 6,336 ticks per pass. Section B is reachable, but practically unheard in normal play; the patched render places it at 49.4--148.2 seconds.
- **Verified + Decomp:** audio preset 1 (20 voices) is never selected. It is genuine unused configuration data.
- **Verified (all music sequence paths):** 37 defined drum slots in the music banks are never played. Every defined melodic instrument is played. Empty/null instrument slots are capacity, not unused content.
- **Verified:** the title sequence's setup scripts select instruments 12--15 although bank 1 has only twelve slots; the affected channels are restarted with valid scripts before producing sound. These commands are harmless script/build residue.
- **Verified:** sequences 1, 4, 5, and 8 contain 2--13 unreachable trailing bytes that differ by version, consistent with uninitialized build padding.
- **Verified:** the sample table has 1,406 unreferenced bytes, all alignment gaps; no unreferenced sample payload was found. All 21 bank headers contain the date word `0x19960624`.
- **Verified + Decomp:** sequence 29 is a used, detuned version of sequence 27 for the losing ceremony. Channel opcode `E6` and headphone Haas panning are unused by the music sequences but are retained driver capabilities, not hidden songs.
- **Leak-supported:** internal names such as `PRIZE_A_BGM`, `PRIZE_B_BGM`, and `PRIZE_C_BGM` agree with the three ceremony tracks; they do not identify an extra song.

JP's additional `0x190` bytes of SFX sample data and changed sequence 0, EU 1.0's retuned SFX instrument 80, JP 1.0's slightly smaller Bowser geometry, and the JP Luigi Raceway changes are version-specific **used revisions**, not unused content.

### 14.7 Why the ceremony loads Banshee Boardwalk segment 6

- **Decomp:** `load_ceremony_cutscene` loads Royal Raceway, then separately decompresses Banshee Boardwalk's course-data stream into segment 6.
- **Decomp:** ending-state object update calls `update_cheep_cheep(1)`; initialization assigns `d_course_banshee_boardwalk_dl_cheep_cheep`, and rendering calls the Banshee fish display lists at `0x7650`, `0x78C0`, `0x7978`, and `0x7B38`.

The extra segment-6 load therefore supplies the animated Cheep Cheep used in the award ceremony. It is intentional cross-course asset reuse, not an unexplained or unused load.

### 14.8 Remaining open classification

- **Hypothesis/Open:** individual addresses in the conservative `coverage.txt` `never` sets may include truly dead display-list fragments, but no candidate was proven to be a complete object or scene. Classifying them requires command-by-command ownership and every runtime mode, not merely rendering the raw address.
- **Hypothesis/Open:** an arbitrary orphan texture or tiny geometry fragment could exist outside all known filesystem records. The complete twenty-entry course table and matching leak build units rule out an additional normal course package, not every possible byte-level remnant.

### 14.9 Development-archive course material

A read-only audit of `~/bbgames/mk64` and its original `kimura.lzh` is recorded in
`archive_cut/ARCHIVE_COURSE_AUDIT.md`. **Leak-supported:** `TOWN` is the only distinct non-retail course identity.
Its static-art package is nearly complete—5,699 vertices, 2,817 triangles, opaque and translucent roots, and all 73
texture streams survive; two stale texture-size entries are recoverable. It is not a complete playable build: no
course-table/draw slot, collision classifications, placements, environment, camera or dedicated music survives, and
its two 296-entry route arrays are renamed copies of Luigi Raceway's paths.

#### 14.9.1 TOWN archive payloads

Unlike the retail course resources described in §3, TOWN survives as generated C arrays and symbol/address metadata,
not as a block inside any released ROM. The relevant July 1996 files are self-contained for static rendering:

| archive input | representation | decoded use |
|---|---|---|
| `map/TOWN_pk.c:TOWN_VERTEX` | one MIO0 stream | 79,786 bytes = 5,699 packed 14-byte `CourseVtx` records; each expands by the normal MK64 rule to a 16-byte segment-4 `Vtx` |
| `map/TOWN_pk.c:TOWN_GFX` | 15,429-byte, `0xFF`-terminated packed command stream | 68,720 bytes of segment-7 F3DEX commands; `TOWN.h` records 68,712 bytes before the unpacker's final eight-byte `G_ENDDL` |
| `map/TOWN_pk.c:TOWN_MATERIAL` | 11 records of six bytes | ambient RGB followed by directional-light RGB; the course loader supplies the engine's archived `(0,120,0)` light direction |
| `map/TOWN_info.c` plus `image/*_txt.c` | 73 named MIO0 texture streams | 223,232 decoded bytes concatenated in manifest order as segment 5 |

All 73 texture streams decode to their declared output sizes. Two compressed-size fields in `TOWN_info.c` are stale:
`renga4_pk` is 540 bytes rather than 294 and `green_pk` is 1,502 rather than 1,111. The package generator reads the
complete C arrays and validates their MIO0 output sizes, so it does not truncate either stream or repair texture data.
The model reaches 72 of the 73 resulting segment-5 offsets; `te_pk` is retained in the package but neither full-model
root references it. **Leak-supported; mechanically validated by `tools/mk64-town-package.ts`.**

#### 14.9.2 July packed display-list variant

TOWN predates the October 1996 F3DEX/32-slot packed format used by the retail courses. Its command framing, texture
commands, display-list calls and 5-bit packed triangle indices are otherwise the same, but vertex loads target only
cache slots 0--15 and encode a full-to-end load with the value `1`:

| packed record | arguments after opcode | July interpretation |
|---|---|---|
| general vertex load `0x28` | `sourceLo, sourceHi, encodedCount, v0` | `source = sourceLo | sourceHi << 8`; if `encodedCount == 1`, `n = 16 - v0`, otherwise `n = encodedCount`; load source vertices `[source, source+n)` into cache slots `[v0, v0+n)` |
| compact vertex load `0x33` | `sourceLo, sourceHi` | the `v0=0`, 16-vertex sentinel |
| compact vertex loads `0x34`--`0x3B` | `sourceLo, sourceHi` | `v0=0`, literal `n = opcode - 0x32` (2--9 vertices) |

The conversion emits an ordinary F3DEX `G_VTX` targeting segment 4 at `source * 16`; it does not change a source
index, cache destination or triangle index. Across both roots, the stream contains 705 loads: 70 general sentinels,
37 general literal loads, 235 compact sentinels and 363 compact literal loads. Executing the converted lists through
a 16-slot cache reaches all 2,817 archived triangles with no uninitialised reference, source overrun or cache overrun.
The roots are `TOWN_grp_ALLT = 0x07002C18` (332 cutout/translucent triangles) and
`TOWN_model = 0x07010C60` (2,485 opaque triangles).

The later surviving `memory.c` decoder treats every general count literally and maps compact `0x33` to one vertex, so
it cannot by itself decode this earlier stream. The count-1 sentinel is established by the complete TOWN stream: the
literal interpretation corrupts cache provenance and produces cross-surface triangles, while the sentinel/literal
split preserves local surfaces at every reported camera; treating every value as a complemented endpoint corrupts
the values 2 and above. These comparisons are diagnostics for determining the old encoding, not edits to the model.
No vertex, source pointer, cache destination, triangle or texture is adjusted by the generator. **Leak-supported;
verified by complete-stream execution, deterministic package generation, and report-camera renders 0053--0065.**

#### 14.9.3 Viewer package and presentation

There is no separate TOWN collision payload: `TOWNDATA.c` only includes the texture table, `TOWN.h` declares only the
packed visual model/material/texture data, and no TOWN `TrackSections`, surface records, section display-list table or
retail 16-byte collision vertices are referenced by the surviving integration code. The visible 14-byte source
vertices and display lists could only be used to invent an unclassified collision mesh, so the viewer does not do so.

The viewer exposes `Town` after the retail courses and award ceremony (the archive's internal name remains `TOWN`). It fetches the optional, deterministic
gzip-9 package `public/assets/mk64-town.bin.gz` only while a Mario Kart 64 ROM is active. The versioned package holds
only TOWN's 5,699 decoded source vertices, expanded F3DEX display-list bytes, 73 decoded texture streams and the model's
66-byte, 11-entry light-material table; it deliberately
omits the copied Luigi Raceway routes, minimap, common/retail data, collision, objects, environment and music. The
opaque `TOWN_model` and cutout/translucent `TOWN_grp_ALLT` roots are separate toggleable layers. The empty hidden
`collision (not recovered)` layer and bounds-framed viewer camera state explicitly reflect what the archive lacks.
No recovered TOWN environment is claimed: by user choice, the viewer uses Luigi Raceway's sky gradient and clear colour
as an explicitly labelled presentation fallback, not as archival evidence. Asset fetch or validation failure leaves every retail course usable and
is reported only when TOWN is selected. `tools/mk64-town-package.ts` regenerates and validates the package from the
Kimura source snapshot using the format above. It verifies every load against the 16-slot cache and 5,699-entry source
array, executes both roots with no uninitialized cache references, preserves all 2,817 triangles and the archived
display-list offsets, and contains no geometry-scoring or report-specific repair. The viewer applies all 11
archived material changes with their recovered `+Y` light direction through the shared F3DEX lighting path and exposes
the resulting per-material shading as an interactive lighting preset; its CPU shading remains an approximation of RSP
fixed-point lighting.

The archives also retain self-contained earlier visual revisions of Mario Raceway, Banshee Boardwalk, Yoshi Valley
and Rainbow Road without matching gameplay data; smaller old recipes/metadata; an orphan Mario Raceway route with a
likely erroneous `z=7680` point; and an incomplete loose `dokan` pipe model. Every archived packed `KT1`--`KT20`
course model matches a shipped ROM revision (the unusual Kimura KT3 and KT9 files are Japanese retail data), and no
alternate award ceremony was found. These distinctions were verified by the reusable
`archive_cut/audit_course_builds.ts` structural and binary comparison.
