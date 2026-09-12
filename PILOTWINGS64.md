# Pilotwings 64 (N64, US/E/J): ROM format specification for the level viewer

This specification treats the US release as the primary implementation target and records the European M3 and
Japanese differences needed by a version-tolerant loader. Research paths are relative to
`/home/n64/.ai-tmp/r49/pilotwings/`.

**Evidence notation.** `[V-ROM]` means verified directly from ROM bytes or exhaustive decoded-data checks; `[V-ASM]`
means verified in disassembly; `[V-RAM]`, `[V-FRAME]`, and `[V-AUDIO]` mean verified in live memory, captured frames,
and decoded/captured audio respectively. `[V-REPO]` means verified against the current viewer source, and `[V-TOOL]`
means verified by the named deterministic research/checking tool. `[DECOMP]` is supported by the matching community
decompilation but was not independently proved at that point. `[DESIGN]` is a proposed implementation choice, `[HYP]`
is a hypothesis, and `[OPEN]` is intentionally unresolved. A verification label
in a heading applies to every factual statement in that subsection unless a narrower label overrides it.

## 0. At a glance

| topic | finding | evidence |
|---|---|---|
| releases | Three 8 MiB big-endian releases: US `NPWE`, Europe M3 `NPWP`, Japan `NPWJ`; CIC-6102; revision byte 0 | [V-ROM] header and CRC recomputation |
| code | Uncompressed kernel plus one app segment copied at boot; no overlays or relocation | [V-ASM] boot path and address constants |
| files | Paradigm `FORM UVRM` table and 1,272 US `FORM` files; `GZIP` chunks contain MIO0, not DEFLATE | [V-ROM] every file/chunk in all three ROMs; [V-ASM] reader/decompressor |
| playable content | 61 task records across four islands, three main vehicles, four bonus modes and Birdman | [V-ROM] `levels_us.tsv`, task lookup and ADAT |
| geometry | Packed UVMD models and UVCT/UVTR terrain expanded by the game into Fast3D 2.0D lists; Z-up, right-handed world | [V-ROM] all records; [V-ASM] parsers; [V-FRAME] offline/emulator landmarks |
| environment | UVEN sky/sea models, per-weather fog, palette substitution and vertex/texel recolouring; far/near terrain split | [V-ROM] UVEN/UVTP; [V-ASM]/[DECOMP] draw path; runtime fog words remain [OPEN] |
| objects | UPWL island records and UPWT task records cover static, moving and scoring objects; decoded census is 752 island rows and 414 task rows | [V-ROM] canonical TSVs and complete size checks |
| collision | Render triangles double as terrain collision; UVMD supplies box trees/leaf triangles; water includes an infinite sea plane | [V-ROM] geometry; [DECOMP] query semantics; live hit records remain [OPEN] |
| music | 31 libultra compact-MIDI sequences, one music bank and one SFX bank; every song is renderable and has a known loop policy | [V-ROM]/[V-ASM]/[V-AUDIO] sequence and bank walks plus offline WAVs |
| implementation | Prototype loaders already build all four islands and all 61 tasks with complete layer ownership; task 9's blank-foreground anomaly is diagnosed, while remaining fidelity risks include implementing the verified ground/model-origin correction, sky anchoring, two-texture rendering, fog split and animated state | [V-TOOL] structural check manifest; [V-RAM/V-FRAME] E3 camera capture; [OPEN] remaining runtime probes |

## 1. ROM identification [V-ROM]

All three releases are 8 MB big-endian ROMs with CIC-6102, entry 0x80200050, release 0x1444 and version byte 0. Byte-swapped `.v64` and little-endian `.n64` dumps are normalised first (`normalizeByteOrder`).

| field (offset) | US | E (M3) | J |
|---|---|---|---|
| md5 (whole ROM) | 8b346182730ceaffe5e2ccf6d223c5ef | 3fcd4969f9a080bd2bcb913ec5d7a3bd | e8e6ec0692009009f5dca6827b21f59a |
| 0x00 PI word / 0x04 clock / 0x08 entry | 80371240 / 0000000F / 80200050 | same | same |
| 0x0C release | 00001444 | same | same |
| 0x10 CRC1 / 0x14 CRC2 | C851961C / 78FCAAFA | 1AA05AD5 / 46F52D80 | 09CC4801 / E42EE491 |
| 0x20 name | `Pilot Wings64` + 7 spaces | same | same |
| 0x3B game code | `NPWE` | `NPWP` | `NPWJ` |
| 0x3F version byte | 0x00 | 0x00 | 0x00 |
| IPL3 0x40-0xFFF | CIC-NUS-6102 (CRC32 90BB6CB5) | identical | identical |
| file table (`FORM UVRM`) | ROM 0xDE720 | 0xE02A0 | 0xDEC30 |
| filesystem base / end | 0xDF5B0 / 0x618B6C | 0xE12D0 / 0x6B2384 | 0xDFAC0 / 0x612BB0 |

**Verified** (`fs/notes/fs.md` §1): CRC1/CRC2 recompute with the 6102 algorithm over ROM 0x1000-0x100FFF, and the IPL3 is the known 6102 one.

**Detection [V-ROM]:** accept `NPWE` at 0x3B (optionally `NPWP`/`NPWJ`), then find `FORM....UVRM` with a 4-byte-aligned scan (unique in all three ROMs). Every data address follows from UVRM; only code addresses are version-specific, and a loader needs none of them.

## 2. Boot and code

### 2.1 Layout [V-ASM; `fs/notes/fs.md` §2, `fs/notes/romap.md`]

Nothing in the code area is compressed or relocated: there are no overlays, and the only runtime copy is the app segment.

| ROM (US) | vram | contents |
|---|---|---|
| 0x000000-0x000040 | – | header |
| 0x000040-0x001000 | – | IPL3 (6102) |
| 0x001000-0x001050 | 0x80200050 | entry stub: clears kernel bss 0x80250E80 (+0x79A80), sp 0x802C3C90, jumps to `bootproc` 0x8022E440 |
| 0x001050-0x0464E0 | 0x802000A0 | kernel text (Paradigm "UV" engine + libultra 2.0D) |
| 0x0464E0-0x049C30 | 0x80245530 | rspboot, GFX ucode 1 (decomp name `gspF3DEX_fifo`), GFX ucode 2 (`gspFast3D`), aspMain text |
| 0x049C30-0x051E30 | 0x80248C80 | kernel data/rodata, then ucode 1 / ucode 2 / aspMain data |
| – | 0x80250E80-0x802CA900 | kernel bss |
| 0x051E30-0x0DE720 | 0x802CA900 | app (game) text + data, copied from ROM by `Thread_App`; bss 0x803571F0-0x803805E0 |
| 0x0DE720-0x0DF5A4 | – | `FORM UVRM` (file table) |
| 0x0DF5B0-0x618B6C | – | filesystem: 1272 FORM files |
| 0x618B70-0x62D460 | – | audio: `S1` compressed-sequence bank (31 sequences) |
| 0x62D460-0x6314D0 | – | audio: `B1` bank file (.ctl) |
| 0x6314D0-0x6FCBE0 | – | audio: sample table (.tbl) |
| 0x6FCBE0-0x800000 | – | 0xFF fill |

E and J have the same structure, shifted (E app ROM 0x51F10 → 0x802CCFC0, J 0x51CA0 → 0x802BCC50). The three audio blobs have identical sizes in all three ROMs (0x148F0 / 0x4070 / 0xCB710). The IPL3 copies 1 MB from ROM 0x1000, which overlaps the app. The entry stub clears that region, and `Thread_App` re-reads the app from ROM (**verified**: the constants 0x51E30, 0xDE720, 0x802CA900, 0x803571F0 and 0x803805E0 are loaded together at 0x8022E930).

**Boot chain** (decomp names, call order consistent with the disassembly): `bootproc` → `osInitialize` → `Thread_Kernel` (PI manager, `Thread_Render`, VI scheduler) → `Thread_App` (`_uvMediaCopy` of the app, bss clear) → `app_entrypoint`. The game state machine (`GameState`: 0 title, 2 test details, 3 pilot select, 4 test setup, 5 test update, 6 results, 7 options, 8/9 demo, 10 file menu, 11 vehicle/class select, 12 test overview, 13 cannonball results, 14 congratulations, 15 credits) calls `taskInitTest` and then `levelLoad` in state 4 (§4.2).

### 2.2 Microcode [V-ASM]

- Both GFX microcode data blocks carry `RSP SW Version: 2.0D, 04-01-96`. The two text blobs are both 0x1430 bytes and differ in 1953 bytes.
- `uvGfxEnd` (US 0x8022217C) first stores ucode 1 into the OSTask, then overwrites the same fields with ucode 2 (text 0x80246A30, data 0x802503C0, at 0x80222394/98). So **every graphics task runs ucode 2, Fast3D**.
- The model and contour parsers emit Fast3D commands: `G_VTX` 0x04, and `G_TRI1` 0xBF with vertex indices multiplied by 10 (§5).

### 2.3 Key functions [V-ASM; US symbols named by DECOMP]

| symbol | US | E | J | role |
|---|---|---|---|---|
| `mio0_decompress` | 80231A20 | 80231A90 | 802318F0 | MIO0 codec |
| `uvMemInitBlockHdr` | 802246A0 | 80224670 | 802245D0 | walks TABL, fills per-type offset tables |
| `uvFileReadHeader` / `uvFileReadBlock` | 80223E80 / 80223F7C | 80223E50 / 80223F4C | 80223DB0 / 80223EAC | FORM/chunk reader |
| `uvUserFileRead` | 802314D0 | – | 802313A0 | user-file access |
| `uvMemLoadDS` / `uvLevelInit` / `uvLevelAppend` | 80224A90 / 8022AF04 / 80224CE0 | 80224A60 / 8022AFF4 / 80224CB0 | 802249C0 / 8022AE34 / 80224C10 | single-file record load / level reset / manifest load |
| `levelLoad` / `levelLoadMapObjects` | 8030B6C0 / 8030BDC8 | 8030E220 / 8030E928 | 802FDFF0 / 802FE6F8 | island load |
| `taskInit` / `taskInitTest` / `taskLoadCommObj` | 803449B0 / 80344FC8 / 80345CE4 | 80348520 / 80348B38 / 80349854 | 80337330 / 80337948 / 80338664 | task table, task start |
| `envGetCurrentId` / `envLoadTerrainPal` | 802E12B4 / 802E1990 | 802E3A54 / 802E4130 | 802D3DE4 / 802D44C0 | environment id, night palettes |
| game state pointer `D_80362690` | 80362690 | – | – | +4 map, +6 terraId, +8 envId, +0xC pilot, +0xE vehicle, +0x10 class, +0x12 test |

E/J addresses come from masked-instruction matching of the US functions (`fs/tools/xmatch.py`, unique matches).

## 3. Filesystem and compression

### 3.1 Container [V-ASM, V-ROM: every chunk of all three ROMs]

```
file  := 'FORM' u32 size char[4] type chunk*     size counts the bytes after the size field; files are padded to 4 bytes
chunk := char[4] tag, u32 size, payload           payload sizes are multiples of 8 (all 36,722 US chunks)
GZIP  := 'GZIP' u32 size, char[4] innerTag, u32 decompressedSize, MIO0 stream
PAD   := 'PAD ' u32 4, 00000000                   every file starts with one or two PAD chunks
```

- **Reading.** The reader keeps one open file `{address, tag, length, offset}` and starts at +0xC. A `GZIP` chunk is decompressed to a scratch buffer, and the reader returns the inner tag and size in place of `GZIP`, so callers never see compression.
- **Naming.** Despite the tag, the payload is **MIO0**, not DEFLATE.
- **Unused wrapper.** `uvUserFileRead` also handles a `UVRW` wrapper, which no ROM file uses.

### 3.2 MIO0 [V-ASM; V-ROM: all 1,322 US GZIP chunks]

- **Header:** `+0 "MIO0"` (the magic is not checked), `+4 u32 size`, `+8 u32 back-reference offset`, `+0xC u32 literal offset`, `+0x10` control words.
- **Control words:** 32 bits, MSB first. Bit 1 copies one literal byte. Bit 0 reads a u16 `v` and copies `(v >> 12) + 3` bytes from `out − ((v & 0xFFF) + 1)` one byte at a time, so overlapping copies act as runs.
- **Stop:** when `size` bytes have been written.

This is the same codec as Star Fox 64 and Super Mario 64. Streams end 0-7 bytes before the chunk end.

### 3.3 File table and addressing [V-ROM, V-ASM]

- **TABL.** `FORM UVRM` holds `PAD PAD GZIP(TABL)`. TABL is `N × {char[4] type, u32 size}` with size = FORM size + 8, rounded up to 4. N is 1272 (US), 1434 (E) and 1281 (J).
- **File offsets.** File i starts at `base + Σ size[0..i−1]`.
  - `base` is a link-time constant: 0xDF5B0 in US, loaded at 0x802246F4 next to 0xDE720.
  - A loader finds it as the first `FORM` at or after the end of UVRM, past zero padding (true in all three ROMs).
- **Addressing.** `uvMemInitBlockHdr` fills a per-type offset table, so a file is named in one of three ways:
  - **engine types** (UVMD, UVCT, UVTX, UVAN, UVFT, UVBT, UVSX, UVSY): **(type, index within type)**. For example, model 352 is the 353rd UVMD in TABL order;
  - **single-file types** (UVEN, UVLT, UVTR, UVSQ, UVLV, UVTP): one file each, whose records are `COMM` chunks. A record id is the **ordinal of the COMM chunk** (`uvMemLoadDS(tag, id)`);
  - **game files** (UPWL, SPTH, UPWT, ADAT, 3VUE, PDAT): a shared **user-file index** in TABL order.
- **US TABL order:** UVSY 0, UVEN 1, UVLT 2, UVTR 3, UVLV 4, UVSQ 5, UVTP 6, UVMD 7-369, UVCT 370-470, UVTX 471-933, UVAN 934-1048, UVFT 1049-1057, user files 1058-1168, UVBT 1169-1270, UVSX 1271.
- **User files:**

| user index | type | contents |
|---|---|---|
| 0x00-0x03 | UPWL | island objects: Holiday, Crescent, Little States, Ever-Frost (§7) |
| 0x04 | SPTH | spline path (ski lift) |
| 0x05-0x41 | UPWT | the 61 tasks (§4) |
| 0x42 | ADAT | text (E also 0x6F German, 0x70 French) |
| 0x43-0x47 | SPTH | spline paths |
| 0x48-0x53 | 3VUE | camera paths (replay) |
| 0x54-0x6C | PDAT | demo recordings |
| 0x6D-0x6E | SPTH | spline paths (planes) |

### 3.4 File types [V-ROM: complete catalogue `fs/notes/catalogue.txt`]

| type | count US (E, J) | chunks | contents |
|---|---|---|---|
| UVSY | 1 | COMM | version 13 + record counts per type |
| UVEN | 1 | COMM ×24 | environments: fog, clear colour, sky models (§6) |
| UVLT | 1 | PAD only | lights (empty) |
| UVTR | 1 | COMM ×10 | terrains: grids of contour tiles (§5) |
| UVLV | 1 | COMM ×136 (E 187) | level manifests: lists of ids to load (§4.3) |
| UVSQ | 1 | COMM ×1 | texture animation sequence |
| UVTP | 1 | COMM ×7 | texture palettes (id substitutions for night/snow) |
| UVMD | 363 | COMM (MIO0) | models (§5) |
| UVCT | 101 | COMM (MIO0) | contours: terrain tiles (§5) |
| UVTX | 463 (E 475) | COMM (440 MIO0) | textures (§5) |
| UVAN | 115 | COMM + PART ×1-22 | animations |
| UVFT | 9 | STRG, FRMT, BITM, IMAG ×n | fonts |
| UVBT | 102 (E 250, J 111) | COMM | 2D blits (screens, logos, localized) |
| UVSX | 1 | .CTL, .TBL | sound-effect bank (§9) |
| UPWL | 4 | LEVL ESND WOBJ LPAD TOYS TPTS APTS BNUS | island objects (§7) |
| UPWT | 61 | JPTX NAME INFO COMM THER LWIN TPAD LPAD LSTP RNGS BALS TARG HPAD BTGT PHTS FALC CNTG HOPD | tasks (§7) |
| SPTH | 8 | SCPP SCPH SCPX SCPY SCPR SCPZ SCP# | spline paths |
| ADAT | 1 (E 3) | SIZE, NAME/DATA ×439 | text |
| 3VUE | 12 | COMM QUAT XLAT | camera paths |
| PDAT | 25 | PHDR PPOS RHDR RPKT | demo recordings |

**Tools:**
- `fs/tools/extract.py` dumps every file to `fs/files/<us|eu|jp>/<global>_<type>_<typeidx>/<chunk>_<TAG>.bin`, with an inventory (`inventory.tsv`/`.json`, md5 per chunk).
- `fs/proto/pwfs.ts` is the TypeScript reader (`openFs`, `file(type, i)`, `userFile(i)`, `comm(type, id)`). `fs/proto/test.ts` checks every file offset, index and chunk md5 against the Python inventory: **ALL OK** on US, E and J.

## 4. Levels

### 4.1 Concepts [V-ROM: tables, task COMM and decoded text; `fs/notes/levels.md`]

| concept | ids | where it lives |
|---|---|---|
| island ("map") | 1 Holiday Island, 3 Crescent Island, 5 Little States, 10 Ever-Frost Island | the map id **is** the UVLV manifest id; task byte COMM[3] (0-3) maps through `sTaskMapLookup = {1, 3, 5, 10}` (ROM US 0xD7CD8, E 0xD97F8, J 0xD8228; verified bytes `01 03 05 0A`) |
| island objects | UPWL user files 0x00-0x03 | `levelLoadMapObjects` |
| terrain | UVTR records: 0 Holiday; 1 (+2 cave) Crescent; 3 Little States; 7 (+8) Ever-Frost | `taskInitTest` picks the start terrain; UPWL `TPTS` switch points change it in flight (§5) |
| task | 61 UPWT files = user files 0x05-0x41, task index 0-60 | `sTaskUserFileIdxLookup` (61 bytes after the map table) |
| weather / time of day | COMM[8], 0-5 | `envGetCurrentId(map, weather)` → environment id 2-21 |
| sky + fog + clear colour | UVLV 0x70 + envId (sky and horizon models), UVEN record envId | §6 |
| night / snow textures | UVTP palette (texture id substitution) | `envLoadTerrainPal(envId)`: env 6→palette 0, 11→1, 17→2, 18/19→5, 20→4, 21→3 |
| names and texts | ADAT user file 0x42 (E: 0x42 English, 0x70 French, 0x6F German) | keys `<C>_<V>_<n>_N` name, `_H` hint, `_M` message |

### 4.2 How the game loads a task [DECOMP control flow; V-ROM/V-ASM tables and constants]

1. **Task table.** At boot, `taskInit` reads the COMM chunk of all 61 tasks and builds `[class][test][vehicle] → task index` from COMM bytes 0 (class), 2 (test) and 1 (vehicle).
2. **Test start.** `taskInitTest(class, vehicle, test, &map, &terraId, &envId)` loads the UPWT and sets:
   - `map = sTaskMapLookup[COMM[3]]`;
   - `terraId` = 0/1/3/7 for map 1/3/5/10;
   - `envId = envGetCurrentId()`, a switch on the map and then on COMM[8]:

   | map \ COMM[8] | 0 | 1 | 2 | 3 | 4 | 5 |
   |---|---|---|---|---|---|---|
   | Holiday (1) | 2 | 3 | 4 | – | 5 | 6 |
   | Crescent (3) | 7 | 8 | 9 | 10 | – | 11 |
   | Little States (5) | 12 | 13 | 14 | 15 | 16 | 17 |
   | Ever-Frost (10) | 18 | 19 | 20 | – | – | 21 |

   "–" is id 22, "bad environment specification"; no task uses it. The map compares (1/3/5/10) and the return constants (2-21, default 22) are **verified** by disassembly; the per-weather case order is decomp.
3. **`levelLoad(map, pilot, vehicle, animateToys)`** loads, in order:
   - `uvLevelInit()`;
   - `textLoadBlock(0x42)`;
   - `envLoadTerrainPal(envId)`;
   - `uvLevelAppend(map)`: island terrain, contours, models, textures;
   - `levelLoadMapObjects`: the UPWL file;
   - `uvLevelAppend(0x1A)`, plus `0x1B` for Hang Glider/Birdman;
   - the pilot × vehicle manifest 0x1C-0x46;
   - `uvLevelAppend(0x0C)`, `(0x0D)`, `(0x2E)`;
   - `uvLevelAppend(0x70 + envId)`: sky;
   - lights, `uvChanEnv`.
4. **Task objects.** `taskLoad` appends the task-object manifests on demand: rings 0x0E, bonus star 0x0F, ball target 0x10, balls 0x11, targets 0x12, hover pads 0x13, Falco 0x14, thermals 0x16, pads 0x17/0x18.
5. **Manifests.** `uvLevelAppend(id)` loads every id listed in UVLV record `id` in the order textures (with UVTP substitution), light, env, models, contours, terrains, sequences, animations, fonts, blits. Ids already loaded are skipped.

**For a static viewer**, an island in a given task is: UVLV[map] + UVTR[terraId] with its contours + UVLV[0x70 + envId] (sky) + UVEN[envId] (fog, clear colour) + the UVTP palette for envId + UPWL objects + UPWT task objects.

### 4.3 Level list [V-ROM: all 61 COMM records, tables and ADAT names]

Class A has no test 3, and Beginner has only test 1 for the three main vehicles. The bonus games use the class slot as their level (1-3). Cannonball has four UPWT files per level, one per target, all with the same JPTX id and name. Birdman has four tasks per island that differ only in weather/time.

| task | user file | JPTX | vehicle | class / level | test | island | COMM[8] | env | terrain | objects | in-game name |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 0x27 | E_GC_1 | Gyrocopter | Beginner | 1 | Holiday | 0 | 2 | 0 (start 0) | TPAD1 LSTP1 RNGS3 | Novice Rings |
| 1 | 0x28 | A_GC_1 | Gyrocopter | Class A | 1 | Crescent | 0 | 7 | 1,2 (start 1) | TPAD1 LSTP1 RNGS15 | Sky Maneuvers |
| 2 | 0x29 | A_GC_2 | Gyrocopter | Class A | 2 | Crescent | 1 | 8 | 1,2 (start 1) | TPAD1 LSTP1 TARG3 | Bull's Eye |
| 3 | 0x2A | B_GC_1 | Gyrocopter | Class B | 1 | Little States | 0 | 12 | 3 (start 3) | TPAD1 LSTP1 RNGS22 | River Run |
| 4 | 0x2B | B_GC_2 | Gyrocopter | Class B | 2 | Little States | 5 | 17 | 3 (start 3) | LWIN3 TPAD1 LSTP1 TARG10 | Metal Horizon |
| 5 | 0x2C | B_GC_3 | Gyrocopter | Class B | 3 | Little States | 2 | 14 | 3 (start 3) | TPAD1 LSTP1 FALC6 | Hawk Attack |
| 6 | 0x2D | P_GC_1 | Gyrocopter | Pilot Class | 1 | Ever-Frost | 2 | 20 | 7,8 (start 7) | TPAD1 LSTP1 RNGS24 | Ice Hornet |
| 7 | 0x2E | P_GC_2 | Gyrocopter | Pilot Class | 2 | Ever-Frost | 5 | 21 | 7,8 (start 7) | TPAD1 LSTP1 TARG30 | Balloon Rush |
| 8 | 0x2F | P_GC_3 | Gyrocopter | Pilot Class | 3 | Ever-Frost | 0 | 18 | 7,8 (start 7) | TPAD1 LSTP1 FALC8 | Meca Hawk Again |
| 9 | 0x30 | E_RP_1 | Rocket Belt | Beginner | 1 | Holiday | 1 | 3 | 0 (start 0) | TPAD1 LPAD1 BALS1 | Balloon Crash |
| 10 | 0x31 | A_RP_1 | Rocket Belt | Class A | 1 | Little States | 4 | 16 | 3 (start 3) | TPAD1 LPAD1 RNGS9 | Metropolis Dance |
| 11 | 0x32 | A_RP_2 | Rocket Belt | Class A | 2 | Little States | 1 | 13 | 3 (start 3) | LWIN3 TPAD1 LPAD1 HPAD6 | Touch & Go |
| 12 | 0x33 | B_RP_1 | Rocket Belt | Class B | 1 | Ever-Frost | 0 | 18 | 7,8 (start 7) | TPAD1 LPAD1 BALS2 | Balloon Bonanza |
| 13 | 0x34 | B_RP_2 | Rocket Belt | Class B | 2 | Ever-Frost | 2 | 20 | 7,8 (start 7) | TPAD1 LPAD1 RNGS15 | More Rings |
| 14 | 0x35 | B_RP_3 | Rocket Belt | Class B | 3 | Ever-Frost | 5 | 21 | 7,8 (start 7) | TPAD1 BALS1 BTGT1 | Iron Head |
| 15 | 0x36 | P_RP_1 | Rocket Belt | Pilot Class | 1 | Crescent | 1 | 8 | 1,2 (start 1) | LWIN1 TPAD1 RNGS3 | Dark Cavern |
| 16 | 0x37 | P_RP_2 | Rocket Belt | Pilot Class | 2 | Crescent | 3 | 10 | 1,2 (start 1) | TPAD1 BALS1 BTGT1 | Diamond Head |
| 17 | 0x38 | P_RP_3 | Rocket Belt | Pilot Class | 3 | Crescent | 0 | 7 | 1,2 (start 1) | TPAD1 LPAD1 HPAD10 | Touch & Go 2 |
| 18 | 0x39 | E_HG_1 | Hang Glider | Beginner | 1 | Holiday | 0 | 2 | 0 (start 0) | THER3 TPAD1 LPAD1 RNGS3 | Albatross Nest |
| 19 | 0x3A | A_HG_1 | Hang Glider | Class A | 1 | Ever-Frost | 0 | 18 | 7,8 (start 7) | THER8 TPAD1 LPAD1 PHTS1 | Shutter Bug |
| 20 | 0x3B | A_HG_2 | Hang Glider | Class A | 2 | Ever-Frost | 1 | 19 | 7,8 (start 7) | THER2 TPAD1 LPAD1 RNGS13 | Chicken Dive |
| 21 | 0x3C | B_HG_1 | Hang Glider | Class B | 1 | Crescent | 2 | 9 | 1,2 (start 1) | THER5 TPAD1 LPAD1 | Velocity Square |
| 22 | 0x3D | B_HG_2 | Hang Glider | Class B | 2 | Crescent | 1 | 8 | 1,2 (start 1) | THER10 TPAD1 LPAD1 PHTS2 | Shutter Bug 2 |
| 23 | 0x3E | B_HG_3 | Hang Glider | Class B | 3 | Crescent | 0 | 7 | 1,2 (start 1) | THER4 TPAD1 LPAD1 | Seagull Wing |
| 24 | 0x3F | P_HG_1 | Hang Glider | Pilot Class | 1 | Little States | 4 | 16 | 3 (start 3) | THER11 TPAD1 LPAD1 | Thermal Flyer |
| 25 | 0x40 | P_HG_2 | Hang Glider | Pilot Class | 2 | Little States | 0 | 12 | 3 (start 3) | THER3 LWIN1 TPAD1 LPAD1 RNGS15 | Rising Creek |
| 26 | 0x41 | P_HG_3 | Hang Glider | Pilot Class | 3 | Little States | 5 | 17 | 3 (start 3) | THER14 LWIN1 TPAD1 LPAD1 PHTS3 | Shutter Bug 3 |
| 27 | 0x11 | B_EX_1 | Sky Diving | Level 1 | 1 | Crescent | 1 | 8 | 1,2 (start 1) | TPAD1 LPAD1 | Sky Dive 1 |
| 28 | 0x12 | B_EX_2 | Sky Diving | Level 2 | 1 | Holiday | 2 | 4 | 0 (start 0) | TPAD1 LPAD1 | Sky Dive 2 |
| 29 | 0x13 | B_EX_3 | Sky Diving | Level 3 | 1 | Ever-Frost | 1 | 19 | 7,8 (start 7) | TPAD1 LPAD1 | Sky Dive 3 |
| 30 | 0x05 | A_EX_1 | Cannonball | Level 1 | Target 1 | Little States | 0 | 12 | 3 (start 3) | TPAD1 CNTG1 | Super Cannon |
| 31 | 0x06 | A_EX_1 | Cannonball | Level 1 | Target 2 | Little States | 0 | 12 | 3 (start 3) | TPAD1 CNTG1 | Super Cannon |
| 32 | 0x07 | A_EX_1 | Cannonball | Level 1 | Target 3 | Little States | 4 | 16 | 3 (start 3) | TPAD1 CNTG1 | Super Cannon |
| 33 | 0x08 | A_EX_1 | Cannonball | Level 1 | Target 4 | Little States | 4 | 16 | 3 (start 3) | TPAD1 CNTG1 | Super Cannon |
| 34 | 0x09 | A_EX_2 | Cannonball | Level 2 | Target 1 | Crescent | 1 | 8 | 1,2 (start 1) | TPAD1 CNTG1 | Ultra Cannon |
| 35 | 0x0A | A_EX_2 | Cannonball | Level 2 | Target 2 | Crescent | 1 | 8 | 1,2 (start 1) | TPAD1 CNTG1 | Ultra Cannon |
| 36 | 0x0B | A_EX_2 | Cannonball | Level 2 | Target 3 | Crescent | 3 | 10 | 1,2 (start 1) | TPAD1 CNTG1 | Ultra Cannon |
| 37 | 0x0C | A_EX_2 | Cannonball | Level 2 | Target 4 | Crescent | 2 | 9 | 1,2 (start 1) | TPAD1 CNTG1 | Ultra Cannon |
| 38 | 0x0D | A_EX_3 | Cannonball | Level 3 | Target 1 | Ever-Frost | 0 | 18 | 7,8 (start 7) | TPAD1 CNTG1 | Miracle Cannon |
| 39 | 0x0E | A_EX_3 | Cannonball | Level 3 | Target 2 | Ever-Frost | 1 | 19 | 7,8 (start 7) | TPAD1 CNTG1 | Miracle Cannon |
| 40 | 0x0F | A_EX_3 | Cannonball | Level 3 | Target 3 | Ever-Frost | 2 | 20 | 7,8 (start 7) | TPAD1 CNTG1 | Miracle Cannon |
| 41 | 0x10 | A_EX_3 | Cannonball | Level 3 | Target 4 | Ever-Frost | 5 | 21 | 7,8 (start 7) | TPAD1 CNTG1 | Miracle Cannon |
| 42 | 0x14 | P_EX_1 | Jumble Hopper | Level 1 | 1 | Holiday | 0 | 2 | 0 (start 0) | TPAD1 HOPD1 | Triple Jump |
| 43 | 0x15 | P_EX_2 | Jumble Hopper | Level 2 | 1 | Crescent | 5 | 11 | 1,2 (start 1) | TPAD1 HOPD1 | Moonlight Hop |
| 44 | 0x16 | P_EX_3 | Jumble Hopper | Level 3 | 1 | Little States | 1 | 13 | 3 (start 3) | TPAD1 HOPD1 | Go East |
| 45 | 0x17 | E_BD_1 | Birdman | Beginner | Variant 1 | Holiday | 0 | 2 | 0 (start 0) | TPAD1 | Skywalk 1 |
| 46 | 0x18 | E_BD_2 | Birdman | Beginner | Variant 2 | Holiday | 2 | 4 | 0 (start 0) | TPAD1 | Skywalk 2 |
| 47 | 0x19 | E_BD_3 | Birdman | Beginner | Variant 3 | Holiday | 4 | 5 | 0 (start 0) | TPAD1 | Skywalk 3 |
| 48 | 0x1A | E_BD_4 | Birdman | Beginner | Variant 4 | Holiday | 5 | 6 | 0 (start 0) | TPAD1 | Skywalk 4 |
| 49 | 0x1B | A_BD_1 | Birdman | Class A | Variant 1 | Ever-Frost | 0 | 18 | 7,8 (start 7) | TPAD1 | Skywalk 5 |
| 50 | 0x1C | A_BD_2 | Birdman | Class A | Variant 2 | Ever-Frost | 5 | 21 | 7,8 (start 7) | TPAD1 | Skywalk 6 |
| 51 | 0x1D | A_BD_3 | Birdman | Class A | Variant 3 | Ever-Frost | 2 | 20 | 7,8 (start 7) | TPAD1 | Skywalk 7 |
| 52 | 0x1E | A_BD_4 | Birdman | Class A | Variant 4 | Ever-Frost | 1 | 19 | 7,8 (start 7) | TPAD1 | Skywalk 8 |
| 53 | 0x1F | B_BD_1 | Birdman | Class B | Variant 1 | Crescent | 0 | 7 | 1,2 (start 1) | TPAD1 | Skywalk 9 |
| 54 | 0x20 | B_BD_2 | Birdman | Class B | Variant 2 | Crescent | 1 | 8 | 1,2 (start 1) | TPAD1 | Skywalk 10 |
| 55 | 0x21 | B_BD_3 | Birdman | Class B | Variant 3 | Crescent | 2 | 9 | 1,2 (start 1) | TPAD1 | Skywalk 11 |
| 56 | 0x22 | B_BD_4 | Birdman | Class B | Variant 4 | Crescent | 5 | 11 | 1,2 (start 1) | TPAD1 | Skywalk 12 |
| 57 | 0x23 | P_BD_1 | Birdman | Pilot Class | Variant 1 | Little States | 0 | 12 | 3 (start 3) | TPAD1 | Skywalk 13 |
| 58 | 0x24 | P_BD_2 | Birdman | Pilot Class | Variant 2 | Little States | 2 | 14 | 3 (start 3) | LWIN1 TPAD1 | Skywalk 14 |
| 59 | 0x25 | P_BD_3 | Birdman | Pilot Class | Variant 3 | Little States | 4 | 16 | 3 (start 3) | TPAD1 | Skywalk 15 |
| 60 | 0x26 | P_BD_4 | Birdman | Pilot Class | Variant 4 | Little States | 5 | 17 | 3 (start 3) | LWIN1 TPAD1 | Skywalk 16 |

## 5. Geometry and textures

Source: `geo/notes/geometry.md`, derived from the game's own parsers [V-ASM]:

| file | parser |
|---|---|
| UVTX | 0x802265B8, texel pass 0x80226A54 |
| UVMD | 0x802256B8 |
| UVCT | 0x80225FBC |
| UVTR | 0x802270BC |
| state draw | 0x802213A4 |

All four types are **packed big-endian byte streams read field by field**, not aligned structs: offsets depend on counts, so parse sequentially. Every file parses to its last byte (**verified**: 463 UVTX, 363 UVMD, 101 UVCT, 10 UVTR records; fewer than 8 bytes of zero padding remain).

### 5.1 Packed geometry lists [V-ASM, V-ROM: all files]

Models and terrain cells store geometry as a compact command stream that the parser expands into Fast3D:

```
u16 count
count × {
  u16 w
  if (w & 0x4000)  triangle on slots (w>>8)&15, (w>>4)&15, w&15    → BF000000, a*10<<16 | b*10<<8 | c*10   (G_TRI1)
  else             u8 b: load (b>>4)+1 vertices, starting at vertex (w & 0x3FFF), into slots from (b & 15)
                                                                  → 04 | (b>>4)<<20 | (b&15)<<16 | ((b>>4)+1)*16   (G_VTX)
}
→ B8000000 00000000 (G_ENDDL)
```

Vertices are the standard 16-byte `Vtx {s16 x, y, z; u16 flag; s16 s, t; u8 r, g, b, a}`:
- colours are prelit, and no stored state enables lighting;
- `flag` is 0 in models and 1 or 3 in terrain (meaning unknown, unused by the RSP).

### 5.2 UVTX textures [V-ASM, V-ROM: all 463 decode; V-FRAME sheets `geo/renders/tex_sheet_0..3.png`]

```
u16 dataSize        texel bytes (> 4096 clamped to 4096 with a warning)
u16 dlCount
f32 su0, sv0        scroll speed of tile 1 (if either is non-zero)
f32 su1, sv1        scroll speed of tile 0 (second image)
u8  texels[dataSize]           an RDP texture-memory image: level 0 and its mip levels
u32 dl[dlCount][2]             a Fast3D texture list
u16 width, height   (trailer +10/+12) level-0 size
u8  bpp             (+14)      4 / 8 / 16
u8  b15, b16        (+15/+16)  0..2, unknown
u16 flags18         (+18)      low 12 bits = own texture id (= file index); 0x8000 → translucent in render modes 6/7
u16 secondId        (+20)      0x0FFF none; else the texture whose texels the second SETTIMG uses
u16 surfaceClass (+32), u8 b34 (+34; 1 → translucent in mode 7), u8 b35..b38 (RGB-like; average colour [HYP]), f32 (+40)
```

- **Parsing.** The parser relocates the list: each `FD` (G_SETTIMG) word 1 gets the image address. The first `FD` points to this file's texels; later ones point to texture `secondId`'s texels.
- **The texture list:**
  - `BB` G_TEXTURE, where the **tile field is the render tile**: 1 for 431 textures, 0 for 32 two-image or scrolling ones;
  - `FC` combiner (usually G_CC_TRILERP / MODULATERGBA2);
  - `BA` other modes: 2-cycle, G_TL_LOD, G_TF_BILERP, detail/sharpen;
  - `E6`/`E8`;
  - then `FD`, `F5` SETTILE, `F3` LOADBLOCK, `F2` SETTILESIZE for each mip tile;
  - optional `FA`/`FB`; `B8`.
- **Formats:** RGBA16 255, I4 103, IA8 56, I8 20, IA4 20, IA16 9. There are **no CI textures** (no `F0` LOADTLUT) and **no RGBA32**.
- **Texel storage:** rows are 8-byte words; row y of a level is at `tmem + y·line`. **Odd rows are stored with the two halves of each 64-bit word swapped**, which `texture.ts` `loadBlock`/`decodeTexture` already undoes (**verified**: the swapped decode is smoother in 408 images and the straight decode in 3).
- **Wrap:** from the render tile's SETTILE flags. The common ones are repeat/repeat, clamp/clamp, mirror/clamp and repeat/clamp.
- **Scrolling (16 textures).** After the texture list, the draw re-emits `F2 SETTILESIZE`:
  - tile 1 gets `uls/ult += trunc(su·w·4), trunc(sv·h·4)` per frame (asm 0x8023031C);
  - tile 0 gets the size of `secondId`.
- **Two-image textures (32).** The combiner mixes TEXEL0 and TEXEL1. The prototype draws TEXEL0 only (`Batch.texture1` could carry the second).
- **Animated texture (UVSQ[0]).** 16 textures (69-84), one frame each at 20 fps, repeating. It is listed as sequence 0 by Crescent, Little States and Ever-Frost [V-ROM]; its identification as water is [HYP].
- **Night/snow palettes (UVTP).** Texture id substitutions `{u16 n; {u16 from, u16 to} × n}`, applied as textures load (§4.1).

### 5.3 Render state: one 32-bit word per material [V-ASM: `uvGfxStateDraw` 0x802213A4]

Display lists carry no render state. Each UVMD material and UVCT batch has a state word, and the draw code turns it into commands:

```
state = (word | OR[0x802491E0]) & AND[0x802491E4]        ROM initial OR 0, AND 0xFFFFFFFF
E7 PIPESYNC; B6 clear / B7 set geometry mode (only on change)
06 G_DL → the texture's list (+ scroll F2), or → 0x802491B0 (untextured: B7 G_SHADE, 2-cycle, G_CC_SHADE)
B900031D render mode (cycle 1 | cycle 2 from the table below)
06 G_DL → geometry
```

| bits | effect |
|---|---|
| 0-11 | global UVTX index; 0xFFF = untextured |
| 17 | G_SHADING_SMOOTH |
| 19 / 20 | G_CULL_FRONT / G_CULL_BACK (front culling never occurs) |
| 21 | G_ZBUFFER, and the low bit of the render-mode selector |
| 21-24 | render-mode selector (table) |
| 25 | special draw path 0x802210E8 (xlu with prim colour, special matrix); one UVMD material |
| 26 | with mode 7: translucent instead of TEX_EDGE |
| 27 | G_LIGHTING \| G_TEXTURE_GEN (environment map); never used by a file |
| 28 | depth-only render mode 0x111103F0 |
| 31 | G_FOG and cycle-1 blender G_RM_FOG_SHADE_A. **Never set in files**; the game ORs it in at run time (§6) |

| selector `(state >> 21) & 15` | render mode (cycle 2) | viewer blend |
|---|---|---|
| 0 | G_RM_OPA_SURF2 (FORCE_BL, no z) | opaque, depth off |
| 1 | G_RM_ZB_OPA_SURF2 | opaque |
| 2 | AA \| Z_CMP \| IM_RD \| ALPHA_CVG_SEL (no Z_UPD) | opaque, no depth write |
| 3 | G_RM_AA_ZB_OPA_SURF2 (most common) | opaque |
| 4 / 5 | G_RM_XLU_SURF2 / G_RM_ZB_XLU_SURF2 | blend |
| 6 | untextured or flags18 & 0x8000: AA_XLU_SURF2, else AA_TEX_EDGE-like | blend / cutout |
| 7 | untextured: AA_ZB_XLU_INTER2; flags18 & 0x8000, b34 = 1 or bit 26: AA_ZB_XLU_SURF2; else AA_ZB_TEX_EDGE2 | blend / cutout |
| 8-9 / 10-11 | G_RM_ZB_OPA_DECAL2 / G_RM_AA_ZB_OPA_DECAL2 | decal |
| 12-13 / 14-15 | G_RM_ZB_XLU_DECAL2 / G_RM_AA_ZB_XLU_DECAL2 | decal, blend |

**Frequencies:** 2,484 model materials (top high words 0x720, 0x700, 0x600) and 2,127 terrain batches (0x720 in 564). The `runDisplayList` render-mode classification maps these without changes (**verified** by the prototype: Holiday Island gives 19 blend, 20 cutout and 20 decal batches).

### 5.4 UVMD models [V-ASM 0x802256B8; V-ROM all 363; V-FRAME gallery `geo/renders/models_hierarchy_0..7.png`]

```
u16 nverts; u8 nLods; u8 nParts; u8 nVolumes; u8 flag119; u16 nTri6
Vtx[nverts]
nLods × {
  u8 nParts; u8 lodFlag (1 = billboard: yaw towards the camera; 27 LODs of 22 models: trees, palms)
  nParts × { u8 nMaterials; u8 partIndex; u8 depth
             nMaterials × { u32 state; u16 nv; u16 nt; packed list } }
  f32 distance            LOD switch distance
}
nParts × f32[16]          part matrices, row-major row-vector (translation in row 3), relative to the parent
nVolumes × 36 bytes       collision volumes {u8 part; pad3; f32 × 6; u16 n @+28; ...} (§8)
f32 radius                bounding radius, world units
f32 scaleDiv              vertex units per world unit: 10 (360 models), 20 (1), 100 (2); 1.0 for 352-362
f32 f3c                   0 / 1 / 0.5 / 0.1, unknown
nTri6 × {u16, u16, u16}   vertex-index triples used by volumes (§8)
```

- **Hierarchy (verified: asm 0x8022CC28 and render).** For each part the draw pushes the part matrix, draws the part's materials, then pops `depth[j] − depth[j+1] + 1` matrices (and `depth[last] + 1` at the end). The parent is therefore the previous part one level up. Examples: the Ferris wheel's cars ring the hub; the windmill rotor sits on its tower.
- **LOD (verified: asm 0x8022C674/0x8022C7B8).**
  - `d = |camera − object|`, multiplied by a camera factor (camera +0x200) unless it is 1.0.
  - If `d ≥ dist[n−1]` the model is not drawn. Otherwise the LOD is the largest i ≥ 1 with `dist[i−1] < d`, else 0.
  - A viewer draws LOD 0.
- **Model flag bit 0** (`flag119`, 49 models) takes an alternate draw path at 0x80205814 [V-ASM]; its effect is [OPEN].

### 5.5 Terrain: UVTR grids of UVCT cells [V-ASM 0x802270BC/0x80225FBC; V-ROM all records; V-FRAME renders]

**UVTR record** (one COMM chunk per terrain id):
```
f32 minX, minY, minZ, maxX, maxY, maxZ; u8 cols; u8 rows; f32 cellW, cellH, f32 approxRadius
cols × rows × { u8 present; if present: f32[16] Mtx (identity + translation = cell centre); u8 0; u16 uvct }
```
Cell centre = `(minX + (col + ½)·cellW, minY + (row + ½)·cellH, 0)`; row 0 is the south edge.

**UVCT cell:**
```
u16 nverts; u16 nTris; u16 nObjects; u16 nBatches
Vtx[nverts]                                  x, y relative to the cell centre; z = height
nTris × { u16 a, b, c; u16 mask }            collision triangles
nObjects × { u8 n; n × Mtx (16.16 fixed: 16 s16 integer parts, then 16 u16 fractions, row-major)
             u16 model (UVMD); f32 x, y, z; u16 mask; u16 0xFFFF }
nBatches × { u32 state; u16 nv; u16 nt; packed list; u16 firstTri; u16 triCount; u16 mask; u16 0xFFFF; f32 x, y, z, r }
f32 × 5                                      bounding sphere + 1.0
```

- **Static objects.**
  - An object's first matrix is its world placement relative to the cell, with scale `1/scaleDiv` (1364 of 1364). The remaining matrices repeat the model's part matrices.
  - These are the island's buildings, trees and set pieces.
  - Handles are `(terra << 24) | (cell << 12) | object`.
- **Collision.** The collision triangles are exactly the render triangles (**verified** on all 101 files: each batch's expanded list equals `tris[firstTri..firstTri+triCount]`).
- **Masks.** A batch mask is the OR of its triangle masks (all batches). The 16-bit mask looks like 4×4 sub-cell occupancy (hypothesis; 90.7 % reproduced from triangle bounds).
- **No LOD.** Terrain has no LOD or streaming structure.

| terra | grid × cell (units) | bounds | cells (UVCT) | island |
|---|---|---|---|---|
| 0 | 2×2 × 600 | ±600², z ≤ 80 | 4 (0-3) | **Holiday Island** |
| 1 | 8×8 × 512 | ±2048², z ≤ 502 | 45 (4-48) | **Crescent Island** |
| 2 | 8×8 × 512 | same | 2 (49-50) | Crescent cave interior, switched in by TPTS (§4.1, §7) |
| 3 | 8×5 × 1000 | ±4000 × ±2500, z ≤ 537 | 38 (51-88) | **Little States** |
| 4 / 5 / 6 | 8×5 × 1000 | same | 3 / 11 / 5 (subsets of 51-88) | reduced Little States (UVLV 6/7/8); used by the Congratulations screen [V-ASM reference graph/call sites] |
| 7 | 2×5 × 1000 | ±1000 × ±2500, z −42..787 | 10 (89-98) | **Ever-Frost Island** |
| 8 | 2×5 × 1000 | same | 1 (99) | Ever-Frost alternate (switched by TPTS) |
| 9 | 1×1 × 6000 | ±3000², z 0 | 1 (100) | flat plane, in the Sky Diving pilot manifests UVLV 0x3B-0x40 |

**Sea.** It is not in the terrain. Each island's environment manifest adds a sea model (UVMD 353 Holiday, 358 Crescent, 360 Little States, 361 Ever-Frost): a ±12,288-unit square with an island-shaped hole, centred at the origin (**verified** by render: the holes line up with the coastlines).

### 5.6 Coordinates and units [V-ROM, V-FRAME, V-RAM]

- **Axes (verified: render).** The game world is right-handed with **Z up**, +x east and +y north: Little States renders as an unmirrored map of the USA.
- **Viewer transform.** `(x, y, z) → (x, z, −y)`, a proper rotation, so winding is kept. The column-major matrix is `[1,0,0,0, 0,0,−1,0, 0,1,0,0, 0,0,0,1]`.
- **Game matrices.** They are row-vector with row-major storage, so their float arrays can be used directly as column-major arrays.
- **Instance matrix.** `ZUP_TO_YUP · cellMtx · objectMtx0`. Part matrices are applied inside the mesh (G_MTX).
- **Scale.** Terrain vertices are world units; model vertices are 1/scaleDiv world units, and the object matrix carries
  the scale [V-ROM/V-ASM]. Rocket Belt's live HUD path multiplies both altitude-above-ground and pose z by 0.7 before
  displaying integer metres: E3 pose z 5.745 produced SEA LEVEL 4 m, while 0.745 above ground produced altimeter 0 m
  [V-RAM/V-FRAME, DECOMP]. Whether the same 0.7 metres-per-unit convention is universal is [OPEN].

## 6. Environment

Source: `obj/notes/environment.md`, `fs/notes/small_us.txt`, and the task/environment columns generated in
`obj/notes/tasks_summary.tsv`.

### 6.1 UVEN records and task environments [V-ROM]

Each of the 24 COMM records in the single UVEN file is packed as follows; all records decode to their exact length.

```
u8 count
count × { u16 model; u8 flags }
u8 raw[0x3c] = {
  RGBA8 clear, RGBA8 fog, RGBA8 auxiliary, pad[8],
  f32 fogMin, f32 fogMax, u8 fogEnabled, pad[17],
  u8 clearEnabled @ 0x2e, runtime pointer/count fields
}
```

| ids | models | clear/fog state | use |
|---|---|---|---|
| 0 | none | clear `121060ff`, fog off, clear on | menu environment; not a task |
| 1 | none | clear `4c7fffff`, fog off, clear on | Sky Diving |
| 2–21 | one sky model (flag 8) and one island sea model (flag 0) | fog min/max 996/1000, fog on, clear off | all ordinary tasks; exact task mapping is §4.2/§4.3 |
| 22 | none | `4c7fffff`, fog off, clear on | error fallback for invalid map/weather; no task selects it |
| 23 | model 362 (flag 2) | fog disabled, clear disabled | menus/replay environment |

The task fog colours and chosen sky/sea ids are enumerated per task in the canonical
`obj/notes/tasks_summary.tsv`; the file, rather than a duplicated hand-maintained table, is authoritative.

### 6.2 Sky, sea and draw order [V-ROM, V-ASM, DECOMP]

The sky models are UVMD 352, 354–357 and 359. Their bounds are approximately x = ±1700, y = ±1788, z = 0–1604;
flag 8 makes `_uvEnvDraw` translate the dome to `(camera.x, camera.y, 0)`, so it follows the camera horizontally but
keeps its rim at world sea level. The sea models are UVMD 353/358/360/361: flat 24,576-by-24,576-unit surfaces at
z = 0 with island-shaped holes that match the coastlines in offline renders. Model 360 is offset 500 units in x.
They use water texture 26 and an untextured batch, with depth and fog disabled. Model 362 combines a much larger
sky/ocean (`±6000`, z = -100–2904) for environment 23.

The verified flag tests are: bit 3 follows the camera in x/y, bit 2 enables fog for that environment model, bit 1
uses a second projection whose far plane is 27,000, and bit 0 retains Z-buffer state. No task sky/sea model uses bits
2 or 0. [V-ASM]

The frame order inferred from matching decomp control flow is: projection and viewport; environment sky/sea; a
fog-coloured translucent horizon band; far terrain cells with the fog projection; far objects; Z-buffer reset; near
cells and objects without fog; sprites and HUD. [DECOMP] The dynamic haze quad begins at 0.875 of the far distance and
meets sea level; its precise viewer approximation is [OPEN].

### 6.3 Fog and projection [V-ASM, V-RAM; frame display list OPEN]

`uvGfxSetFogFactor` clamps its input to 0–0.996 and emits `gSPFogPosition(f · 1000, 1000)`. For task environments the
factor is 0.996, giving multiplier 32,000 and offset -31,744. Far terrain uses near = far/50 = 40 and far = 2,000,
so fog begins at view depth about 1,672 and reaches full strength at 2,000. A practical static-viewer value is:

```
fog = { color: UVEN.fog.rgb, multiplier: 32000, offset: -31744, near: 40, far: 2000 }
```

That mapping is [HYP] until a captured frame display list confirms the `G_FOG`, fog-factor and dual projection words.
The ordinary projection uses frustum half-extents `(±0.4906542, ±0.35) · near / zoom`, a 300×214 viewport, dynamic
near = 0.5–3 in flight and far = 2,000 (2,100 for Cannonball). The constants and writes are [V-ASM]; per-vehicle live
near values are otherwise [OPEN], while E3 measured Rocket Belt task 9 at near 1.0, far 2,000 and zoom 0.8 [V-RAM].
The live global geometry-mode words remained OR = `0x00000000` and AND = `0xFFFFFFFF`, so no geometry bits were
globally forced or masked in that frame [V-RAM]; this does not replace a display-list capture. Environments 5 and 16
adjust fog colour by camera heading through a nine-entry table [DECOMP].

### 6.4 Time-of-day palettes and recolouring [V-ROM, DECOMP]

`envLoadTerrainPal` installs UVTP substitutions before later UVLV appends: env 6 → palette 0, env 11 → 1,
env 17 → 2, env 18/19 → 5, env 20 → 4 and env 21 → 3. The tables and call constants are [V-ROM/V-ASM].
Palette 6 (423→448) has no caller.

After island, shared and sky records load, `env_802E1C1C` recolours loaded UVCT/UVMD vertex colours and UVTX texels.
The weights come from the UVCT tail float, UVMD `f3c` and UVTX `f40`; terrain vertex flags select linear weighting,
while model vertices use cubed weights. [DECOMP; V-ROM weights]

| environments | recolour |
|---|---|
| 4, 9, 10, 14, 15, 20 | HSV blend toward `(1,0,0)` with hue/saturation/value weights 1/0.5/0.8 |
| 5, 16 | additionally blend RGB 30% toward `(0.75,0.4,0.2)` |
| 6, 17 | multiply RGB by `(0.7,0.7,1.0)`; halve saturation; env 17 also multiplies value by 0.8 |
| 11 | same blue RGB multiply; saturation ×0.5, value ×0.85 |
| 21 | RGB ×`(0.4,0.4,1.0)`; saturation ×0.2, value ×0.8 |
| 2, 3, 7, 8, 12, 13, 18, 19 | no recolour |

The prototype implementation is in `obj/proto/pwmesh.ts`; its formulas are [DECOMP] and need evening/night frame
comparison [OPEN]. UVSQ[0] cycles textures 69–84 at 20 fps and repeats; that format/timing is [V-ROM], while the
identification as water/shore animation is [HYP].

### 6.5 Start cameras [V-ROM, V-ASM, DECOMP]

The take-off pose comes from the first TPAD record using the task's position and Z/X/Y rotation. All computed task
poses and approximate start views are generated in `obj/notes/tasks_summary.tsv`.

| vehicle | mode/rule | zoom | vertical FOV at 320×240 |
|---|---|---|---|
| Hang Glider | lagged chase; nominal `(0,-6,0.5)` in vehicle frame | 1.0 | 38.6° |
| Rocket Belt | heading-follow, six units behind at vehicle height | 0.8 | 47.3° |
| Gyrocopter | lagged chase; nominal `(0,-4.45,1.2)` | 0.8 | 47.3° |
| Birdman | lagged chase; nominal `(0,-3.5,0.5)` | 1.0 | 38.6° |
| Cannonball | cannon camera `(0,-1,-2)` | 1.0 | 38.6° |
| Sky Diving | distance 5 | 0.5 | 70.0° |
| Jumble Hopper | nominal `(0,-5,0)` | 0.7 | 53.1° |

Mode, zoom and camera algorithms are [DECOMP], while frustum constants and TPAD data are [V-ASM/V-ROM]. E2 verified
the live camera-pointer chain in task 19: state base 0x80362698, pointer field at base + 0x7C, camera 0x80362E88
[V-RAM]. E3 then captured Rocket Belt task 9 after start [V-RAM/V-FRAME]:

- `db_getstart` returned target translation `(-463.260010, 27.287300, 5.0)`. `rocketBeltEnterLeave` ground-snapped
  the pose using Lark's -0.745 model-origin offset, producing z = 5.7449999; this is a player placement correction,
  not proof of a separate camera-terrain collision displacement [V-RAM, DECOMP].
- The live camera used mode 4, zoom 0.800000012, near 1.0 and far 2,000. Its target row was
  `(-463.260010, 27.287300, 5.7449999)` and eye row was `(-466.999969, 22.595541, 5.7449999)`, exactly six units
  behind horizontally [V-RAM].
- The prototype eye `(-467.036, 22.624, 5.0)` was exactly coplanar with a paving triangle. The live eye differs by
  `(+0.036031, -0.028459, +0.7449999)`, so reproducing the ground/model-origin adjustment resolves the blank
  foreground without an arbitrary +0.5 nudge [V-RAM/V-FRAME]. Evidence is `emu/e3/notes/e3.md` and
  `emu/e3/ram/task9_camera.bin`.

## 7. Objects, paths and task logic

Source: `obj/notes/objects.md`; complete generated censuses are `obj/notes/tasks_objects.tsv` (414 rows),
`obj/notes/tasks_summary.tsv`, and `obj/notes/island_objects.tsv` (752 rows) [V-ROM/V-TOOL].

### 7.1 Placement and matrices [V-ROM, V-ASM]

Object/camera forward is +Y; rotations stored in most records are degrees in order Z, X, Y. `func_80313640` applies
those local rotations and then translation. UPWL LPAD is the exception: its angle is already radians. `uvDobjPosm`
replaces model part 0 with the object matrix and scales its axes by `1/scaleDiv`; child parts retain UVMD hierarchy
matrices. A viewer instance is `ZUP_TO_YUP · objectMtx · scale(1/scaleDiv)`, with part 0 identity inside the mesh.
UVMD 207 is the only model whose stored part-0 matrix is non-identity. [V-ROM census]

State bit 2 draws a dynamic object, bit 1 enables collision and bit 4 requests a separate near/far pass. Part
properties hide/show individual model parts and scale the cull/collision radius. [V-ASM]

### 7.2 UPWT record formats and visible objects [V-ROM; behavior DECOMP]

Every task's 16 object counts at COMM +0x41C exactly matches its chunk sizes, including padding. No SDFM or OBSV
chunk occurs in any task. The table below is the viewer-relevant summary; exact fields, values and per-instance rows
are preserved in `obj/notes/objects.md` and the canonical TSVs.

| chunk | bytes | essential fields | representation / behavior |
|---|---:|---|---|
| THER | 0x28 | position, radius, height, lift profile/rate | model 0x101 scaled as a cylinder; 104 records; marker/volume plus visible swirl |
| LWIN | 0x54 | endpoints/box pose, size, wind, radius, shape | all 11 records are oriented boxes; model 0xD6 |
| TPAD | 0x30 | position, rotation, initial velocity, flags, fuel | first record defines vehicle start; one in every task; marker only |
| LPAD | 0x30 | position and type | snaps to nearest unused island LPAD within 100 units; models 0x102–0x104 |
| LSTP | 0x24 | two endpoints, valid flag, width | nine 35-unit-wide Gyrocopter landing strips; ribbon/marker |
| RNGS | 0x84 | pose, terrain, child/timed links, size, active/type/motion | 122 records; models 0xD9–0xF1 selected by colour/type/size; hide parts as the game does |
| BALS | 0x68 | pose, terrain, type, scale, points, drag/gravity/split | five balloon/ball records; models 0xF4–0xF6 |
| TARG | 0x20 | pose, type, points | 43 missile targets; models 0xF7–0xF9 |
| HPAD | 0x40 | pose, terrain, type, fuel, activation links | 16 linked hover pads; models 0xFA–0xFC |
| BTGT | 0x1C | position, terrain, radius, height | two ball goals; model 0xF3, then 0xD2 after scoring |
| PHTS | 0x14 | subject id, optional heading/tolerance, points | six photo requirements; subject is an island object, so marker/metadata only |
| FALC | 0xAC | position, domain and behavior ranges, present flag | 14 domains but only two hawks; models 0xD3/0xFD/0xFE |
| CNTG | 0x1C | pose, target type | 12 Cannonball targets, models 0x106–0x108; cannon is model 0x105 [HYP placement from code] |
| HOPD | 0x20 | terrain, position, radius, height | three Jumble Hopper goals, model 0x109 |
| SDFM | 0x4C | parser/copy slot only | no data; no reader after copy [DECOMP] |
| OBSV | 0x10 | observer position and radius | no data; camera mode 2 support remains in code [DECOMP] |

RNGS size ids 0–4 have pass radii 7.5, 10, 12.5, 17.5 and 25. A ring is passed when the vehicle crosses its
plane inside that radius. Active rings enable ordinary children; timed-child edges start timed rings. The decoded
graph has linked courses only in tasks 0, 3, 6, 13 and 15; tasks 1, 10, 18, 20 and 25 are free order. Exact edges
come from `tasks_summary.tsv`. [V-ROM links; DECOMP pass semantics]

### 7.3 UPWL island objects [V-ROM; behavior DECOMP]

All four island files decode exactly. LEVL supplies counts for ESND, WOBJ, LPAD, TOYS, TPTS, APTS and BNUS.

| chunk | contents | viewer treatment |
|---|---|---|
| WOBJ | 6 Crescent windsocks; 13 Little States turbines | visible models 0x40/0x53 at data positions; animated flag |
| LPAD | 1/6/4/5 pads on Holiday/Crescent/Little States/Ever-Frost | plain model 0xD4 unless claimed by a task landing target |
| TOYS | 3 Holiday and 13 Little States proximity animations | marker attached to the UVCT static object at the same point |
| TPTS | terrain-side switch, position/direction/radius, time and shift | hidden marker; governs Crescent cave and Ever-Frost alternate terrain |
| APTS | position/direction/radius, mode and two volumes | hidden environmental-audio marker |
| BNUS | one position/rotation/terrain per island | spinning Birdman bonus star, model 0xF2 |
| ESND | matrix/line endpoints, sound id, pitch/volume/range/attributes | hidden sound-emitter marker; no geometry |

Three island pads are never selected by a task landing target: Crescent pads 2/5 and Ever-Frost pad 4. [V-ROM]
The Little States TOYS point at `(-1687.6,981.9,501.4)` identifies UVCT model 0x99, the Mount Rushmore Mario head;
repeated hits swap it with model 0x55 (Wario) and back [V-ROM placement; DECOMP behavior; runtime frame OPEN].

### 7.4 Code-driven moving objects [DECOMP; starts cross-referenced to ROM models/data]

Normal play creates additional moving scenery when `animateToys` is enabled. A static viewer should show the start
pose, mark instances `animated`, and optionally draw their paths.

| island | objects and start/path |
|---|---|
| Holiday | three orbiting low-poly gliders; speed boat 0x03 plus wake 0x02 around `(-600,-600,0)`; sailboat 0x01 around `(700,-500,0)` |
| Crescent | whale 0xD7/box 0xD8 near `(750,100,4.5)`; fountain 0x26 at `(-288,-99,5.75)`; speed boat 0x03, yacht 0x29 and three gliders |
| Little States | shuttle 0x56/0x57 at `(2870,-2230,57.51)`; ferry 0x52; Nessie 0x58; four gliders; two planes 0x27/0x1B following SPTH users 0x6D/0x6E |
| Ever-Frost | oil spray 0xA6; 20 ski-lift chairs 0xA7 following SPTH user 0x04; five whales 0xD7; exact glider start poses remain [OPEN] |

### 7.5 SPTH, 3VUE and demonstrations [V-ROM; interpolation DECOMP]

Each SPTH axis is `u32 count; count × {f32 time, f32 value}`. Across all 48 axes the first time is zero and keys
increase to 100, resolving the earlier value/time ambiguity. SCPX/Y/Z are position and SCPH/P/R are angles in degrees;
SCP# selects a mode. Cubic Hermite interpolation comes from the decomp. User 0x04 drives the ski lift, 0x43–0x47 the
title flyover and 0x6D/0x6E the Little States planes.

Each 3VUE file has COMM bounds/model id, a QUAT key per frame and an XLAT key per frame. Users 0x48–0x4D drive the
title; 0x4E–0x53 drive the six-pilot Congratulations sequence, not replay. All 25 PDAT files are reachable: 0x54 is
the credits attitude path, 0x55–0x5A attract demos and 0x5B–0x6C per-vehicle Beginner demonstrations. [V-ROM constants
and headers; DECOMP control flow]

## 8. Collision

Source: `obj/notes/collision.md` and `obj/tools/check_geo.ts`.

### 8.1 Query model [V-ROM geometry; DECOMP semantics]

A segment query returns at most five `{type, surfaceId, t, point, normal}` hits:

| type | source | identifier |
|---:|---|---|
| 1 | current UVTR's UVCT terrain triangles | `(cell << 22) | (batch << 12) | triangle` |
| 4 | a terrain triangle using water-class texture, or the infinite sea plane z=0 | sea plane uses -1 |
| 8 | UVCT static-object sphere/box tree | `(terra << 24) | (cell << 12) | object` |
| 2 | dynamic object with state bit 1 | dynamic-object index |

The UVCT render triangles exactly equal each batch's slice of the stored collision list in all 101 contours [V-ROM].
The 16-bit triangle/batch mask is likely a 4×4 cell-occupancy acceleration mask [HYP: 90.7% reconstructed from
bounds]. Textures 40 and 48 are ignored when they are the only terrain hits [DECOMP]; their meaning as pass-through
water over another surface is [HYP]. Camera collision uses the same system with masks 0xD/0x9 [DECOMP]. Live hit
records have not yet confirmed type/id packing [OPEN].

### 8.2 Surface classes [V-ROM]

The UVTX trailer class, selected by the batch's low-12-bit texture id, is the only per-surface classification:

| class | texture ids | interpretation |
|---:|---|---|
| 0 | 438 textures | ordinary ground |
| 4 | 25, 26, 40, 48, 60, 110, 111, 242 | water [DECOMP `func_802DC8E4`] |
| 32 | 0, 3, 5, 6, 18, 19, 32, 89, 99, 157, 165, 166, 167, 186, 194, 201, 235 | [OPEN] tested by a function with no located caller; likely non-landable/soft surface [HYP] |

### 8.3 UVMD box trees [V-ROM; DECOMP traversal]

Two hundred thirty-four models contain 830 36-byte volumes:

```
u8 part, u8 skipCount, u8 hollow, pad
f32 minX,minY,minZ,maxX,maxY,maxZ
u16 cumulativeTriangleEnd @ 0x1c
u32 runtimePointer @ 0x20
```

Bounds are world units in the part frame. A missed parent skips the following `skipCount` boxes. Of the 830 boxes,
293 leaf boxes own triangle-index triples into the model's Vtx array; a leaf without triangles collides as the box.
The cumulative end index is monotonic and ends at `nTri6` for every checked model except one still-unidentified model
[V-ROM, OPEN]. Box-less objects collide by their model-radius sphere [DECOMP].

### 8.4 Viewer overlay [V-TOOL]

`obj/proto/pwtask.ts` builds hidden-by-default `collision: terrain surfaces` and `collision: object boxes` layers.
Terrain is colour-coded by surface class; object parents/leaves/triangle leaves receive distinct translucent colours.
The prototype omits box-less bounding spheres, the infinite sea plane and dynamic terrain switching. Structural
validation confirms every generated collision instance belongs to exactly one hidden collision layer [V-TOOL:
`obj/renders/render_manifest_check-all.json`].

## 9. Music

Source: `mus/notes/music.md`, canonical `mus/notes/songs_us.tsv`, and render indexes under `mus/wav*/`.

### 9.1 Driver [V-ASM, V-ROM, V-RAM, V-AUDIO]

The game uses stock libultra 2.0D audio: one `ALCSPlayer` for compact MIDI and one `ALSndPlayer` for effects. Audio
initialization creates 32 virtual/physical synth voices, 256 updates, a 16-voice/16-channel sequence player and a
custom eight-section reverb on a 5,200-sample delay line. It calls `osAiSetFrequency(22050)`; E4 verified the actual
NTSC rate as 22,047 Hz in both `gALSynConfig.outputRate` 0x802611D0 and the audio plugin's AI_DACRATE 2207 log
[V-RAM/V-AUDIO]. Frame size 0x80260CE8 was 368 samples [V-RAM]. The E build divides by 50 rather than 60 when
calculating it; its expected 22,049-Hz PAL rate remains [HYP]. The previously documented 0x802611C0 address is
`gALSynConfig.maxUpdates`, verified live as 256; the config base is 0x802611B8 [V-ASM/V-RAM].

The kernel deliberately calls `alSeqp*` setters on an `ALCSPlayer`. This is safe because the event queue and state
fields used by those setters have identical offsets in both structures. Key entry points are:

| function | US address | action |
|---|---:|---|
| `uvaSeqNew(id)` | 0x802046E0 | copy the sequence, `alCSeqNew`, bind bank/sequence |
| `uvaSeqPlay` | 0x802047A8 | start |
| `uvaSeqSetTempo` | 0x802047E8 | set microseconds/quarter from BPM |
| `uvaSeqSetVol` | 0x80204840 | set signed-16 volume from 0–1 float |
| `uvaSeqStop` | 0x8020489C | stop and wait up to two seconds |

`sndSetMusic`/`sndSetMusicState` are at 0x8033F748/0x8033F964. Pause states only write an otherwise unread float, so
there is no music fade. Default music volume is 0.9 for Gyrocopter, 0.5 for Cannonball and 1.0 otherwise; touching the
Options volume setting overwrites every vehicle entry. The title issues a 110-BPM command only if a song is already
playing. Cannonball ramps 75→95 BPM while aiming, uses 165 in flight and returns to 75 on landing. [V-ASM; call-site
meaning DECOMP]

### 9.2 Audio data [V-ROM]

| data | US | E | J | logical size |
|---|---:|---:|---:|---:|
| `S1`, 31 compact-MIDI sequences | 0x618B70 | 0x6B2390 | 0x612BB0 | 0x148EB |
| `B1` music control bank | 0x62D460 | 0x6C6C80 | 0x6274A0 | 0x4070 |
| music sample table | 0x6314D0 | 0x6CACF0 | 0x62B510 | 0xCB706 |
| UVSX `.CTL` | 0x4B579C | 0x54EFB4 | 0x4AF7E0 | 0x67E8 |
| UVSX `.TBL` | 0x4BBF8C | 0x5557A4 | 0x4B5FD0 | 0x15CBE0 |

All five logical blobs are byte-identical across releases. Kernel literal pairs locate the three music blobs; `S1`
also follows the filesystem end after 0–4 padding bytes. `S1` is uncompressed and has 31 offset/length entries. Every
sequence has division 768 and parses with both `src/rom/music/cseq.ts` and an independent walker, with no unknown meta
events or finite loops.

The music bank has one 22,050-Hz bank, 48 non-null instrument slots, percussion, 127 sounds and 57 VADPCM waves (about
67 seconds). Closed hi-hat key 42 uses velocity layers split at 112/113. UVSX is effects only: 120 one-sound
instruments/107 waves corresponding to ids 0x00–0x77; its carousel "music" is a 0.88-second looping sample.

### 9.3 Complete song list [V-ROM, V-ASM/DECOMP selection]

Song id equals the S1 index and Options → Sound number minus one. The game displays no titles, so unquoted names are
descriptive. Loop/BPM/duration values below are generated from `mus/notes/songs_us.tsv`.

| id | descriptive name | principal use | loop | BPM | pass (s) |
|---:|---|---|---|---:|---:|
| 0 | Opening | first title/logo entry | 14.988→19.271 | 112 | 19.27 |
| 1 | Title ("Title Demo") | later title / attract | 0→4.282 | 112 | 4.28 |
| 2 | Game Menu | file, vehicle/class and pilot menus | whole | 105 | 73.14 |
| 3 | Mission Menu | overview and briefing | whole | 130 | 44.24 |
| 4 | Hang Glider | Hang Glider tasks | whole | 90 | 154.66 |
| 5 | Hang Glider: Good Landing | target landing | once | 90 | 5.33 |
| 6 | Hang Glider: Landing | off-target landing | once | 90 | 8.00 |
| 7 | Hang Glider: Crash | crash/splash | once | 90 | 8.00 |
| 8 | Rocket Belt | Rocket Belt tasks | whole | 100 | 112.76 |
| 9 | Rocket Belt: Good Landing | target/goal/last ring | once | 100 | 4.80 |
| 10 | Rocket Belt: Landing | off-target landing | once | 100 | 4.80 |
| 11 | Rocket Belt: Crash | crash | once | 90 | 5.33 |
| 12 | Gyrocopter | Gyrocopter tasks | whole | 135 | 106.54 |
| 13 | Gyrocopter: Good Landing | complete landing | once | 135 | 5.33 |
| 14 | Gyrocopter: Landing | other landing | once | 135 | 7.10 |
| 15 | Gyrocopter: Crash | crash | once | 135 | 5.33 |
| 16 | Cannonball | Cannonball, code-driven tempo | whole; end tick 9 late | 75 | 25.59 |
| 17 | Cannonball: Hit | hit below 25 points | once | 130 | 5.07 |
| 18 | Cannonball: Miss | miss/splash | once | 90 | 5.33 |
| 19 | Sky Diving | Sky Diving | whole | 160 | 47.97 |
| 20 | Sky Diving: Good Landing | target landing | once | 100 | 2.40 |
| 21 | Sky Diving: Landing | off-target landing | once | 100 | 4.80 |
| 22 | Sky Diving: Crash | crash/splash | once | 90 | 5.33 |
| 23 | Jumble Hopper | Jumble Hopper | whole | 145 | 92.55 |
| 24 | Jumble Hopper: Goal | goal | once | 130 | 5.07 |
| 25 | Birdman | free flight | whole | 72 | 206.65 |
| 26 | Birdman: Landing | sound test only; unreachable in play [DECOMP] | once | 72 | 10.00 |
| 27 | Birdman: Crash | crash | once | 72 | 6.67 |
| 28 | Results ("Replay") | results tally / Cannonball results | whole | 85 | 135.51 |
| 29 | Congratulations | congratulations | whole | 110 | 34.90 |
| 30 | Ending ("Bravissimo!") | credits | 11.996→161.320 | 100→90 | 161.32 |

Thirteen songs contain forever-loop markers (`FF 2E`/`FF 2D`); 18 end once with `FF 2F`. Code does not restart the
looping songs. Exact sample loop positions at 22,047 Hz are in the TSV.

### 9.4 Offline player and verification [V-TOOL, V-AUDIO]

`parseCompressedSequence`, `parseBank` and `renderSequence` render all 31 tracks with rate 22,047, 16 voices,
sequence volume 32767 and parsed loop points. The baseline `mus/wav/` run completes in about 13 seconds with no NaN
or clipped samples. Twelve of thirteen loop seams repeat sample-exactly.

One shared music-renderer fix is required: `src/rom/music/libultra.ts` currently ignores velocity ranges during sound
lookup [V-REPO]. The exact proposed change is `mus/libultra-lookup.diff`, matching libultra's
`key < keyMin || (velocity < velocityMin && key <= keyMax)` branch [V-ASM]. Baseline rendering drops 424 of 25,902 note-ons,
the low-velocity hi-hats in 14 songs; `mus/wav-patched/` restores them without breaking seams. GoldenEye is byte-for-
byte unchanged because its bank lacks velocity layers, but every other libultra-based game must be regression-rendered
before merge. Song 30 exceeds the game's 16-voice limit by four notes; its dropped voice differs between passes, while
20 voices makes the seam exact [V-TOOL/V-AUDIO]. The player should retain the authentic 16-voice limit.

E4 captured Options sound-test tracks 09/id 8 and 30/id 29 with SFX volume at its zero multiplier [V-AUDIO/V-RAM].
Using unchanged existing comparison tools, the patched renders aligned at +0.15 s and +0.13–0.14 s respectively and
consistently matched better. For id 8, patched versus baseline onset/log-energy NCC was 0.812/0.914 versus
0.736/0.884; in the hi-hat-focused 6–10.5 kHz band it was 0.722/0.860 versus 0.646/0.806. For id 29, patched versus
baseline log-energy/spectrum/fine-waveform NCC was 0.912/0.998/0.930 versus 0.904/0.951/0.891; band onset/log-energy
was 0.721/0.833 versus 0.685/0.737. This verifies that the velocity-lookup patch is the correct choice for Pilotwings.
Positive waveform correlations rule out a global polarity inversion, and both sides have effectively matching
channel balance [V-AUDIO/V-TOOL].

The patched render needs about ×0.97–0.98 amplitude gain to match these captures. Estimated time scale
0.9990–1.0005 shows no meaningful tempo error in either captured song [V-AUDIO/V-TOOL]. The prototype still omits
the game's custom reverb, so byte identity is neither expected nor claimed; title/Cannonball tempo behavior and loop
phase remain [OPEN]. The known 16-voice overflow concerns song id 30 (Ending), not captured Sound Track 30/id 29.

## 10. Release differences

Source: `fs/notes/versions.txt`, `unused/notes/geodiff_versions.txt`, and version renders under `unused/png/`.

### 10.1 Structural compatibility [V-ROM, V-ASM]

All releases use the same engine, formats, 61 task files, SPTH/3VUE/PDAT data, environment/terrain/palette data and
byte-identical audio. The app and filesystem bases differ, so code addresses are version-specific; a viewer derives
data locations from UVRM and needs no fixed app address. E adds a three-language text selector and uses a 50-Hz audio
frame calculation. J uses two-byte glyph codes and has the smallest app BSS.

| feature | US | Europe M3 | Japan |
|---|---:|---:|---:|
| FORM files | 1,272 | 1,434 | 1,281 |
| UVTX | 463 | 475 | 463 |
| UVLV COMM records | 136 | 187 | 136 |
| UVBT | 102 | 250 | 111 |
| ADAT user files | 1 English | 3 English/German/French | 1 Japanese |

E inserts 12 textures, 148 blits, 51 manifests and two ADAT files. Records 0–10, including all islands and overviews,
are identical across releases. Localization-bearing UVLV/UVBT/UVFT/ADAT requires per-version handling, while island
and task resolution does not.

### 10.2 Geometry and asset differences [V-ROM, V-FRAME]

| release/data | verified change |
|---|---|
| E UVMD | model 85 differs; E equals US visually in the investigated head render |
| E UVCT | 17/32/39 nudge or remove model-69 placements by 1–3 units; 52 retextures/reshapes nine triangles |
| E UVTX 318–326 | localized photo-album/UI labels |
| J UVMD 57 | Crescent resort-hut base is untextured instead of wood texture 38 |
| J UVMD 81 | low-poly Little States overview is 147 rather than 212 triangles in the east-central area |
| J UVMD 85/153 | Mario/Wario head hat-brim retriangulation, visually equivalent at checked scale |
| J UVCT 50/80/93/99 | local terrain retriangulations; no object additions/removals; checked renders look equivalent |
| J UPWL 1 | 86 Crescent ESND values differ only by <0.005 rounding |
| J UPWL 3 | all Ever-Frost ESND records differ; one record moves emitter coordinates between matrix and vector fields [OPEN export-layout meaning] |

UVAN differs by one to three bytes per PART in all 115 E files and 75 J files; these bytes are likely exporter padding
[HYP] and must be checked against the animation parser before being ignored. UVTX 318–326 supplies localized photo UI;
US texture 326 unexpectedly matches Japanese glyph art while E makes it empty, yet US Sky Diving code still uses id
326 [V-ROM/V-ASM, semantic purpose OPEN].

## 11. Mapping onto `src/rom/`

This section is a proposed implementation plan. Statements about current repository interfaces are [V-REPO];
choices not yet implemented are [DESIGN]. Prototype sources are under `fs/proto/`, `geo/proto/`, `obj/proto/`
and `mus/proto/`.

### 11.1 Detection and module boundaries [V-REPO, DESIGN]

Add `'pilotwings64'` to `Game.id` in `src/rom/types.ts`, detect `NPWE` (optionally `NPWP`/`NPWJ`) in
`src/rom/index.ts`, and create a `src/rom/pilotwings/` directory:

| proposed module | responsibility | starting artifact | difficulty |
|---|---|---|---|
| `fs.ts` | byte order, UVRM/TABL, FORM chunks, MIO0, per-type/user/COMM lookup | `fs/proto/pwfs.ts` | low |
| `tables.ts` | task/environment/manifest/palette/text metadata and level list | `fs/notes/levels_*.tsv`, prototype parsers | low–medium |
| `texture.ts` | UVTX decode, odd-row swap, two-image/scroll metadata | `geo/proto/pwtex.ts` | medium |
| `model.ts` | packed lists, UVMD hierarchy/LOD/boxes, UVCT/UVTR | `geo/proto/pwformats.ts`, `pwlevel.ts`, `obj/proto/pwmesh.ts` | medium–high |
| `objects.ts` | UPWT/UPWL/SPTH parsing and placement | `obj/proto/pwobj.ts` | high |
| `environment.ts` | UVEN sky/sea, palette/tint, fog/camera rules including verified Rocket Belt ground placement | `obj/proto/pwmesh.ts`, `pwtask.ts`, `emu/e3/notes/e3.md` | high |
| `pilotwings.ts` | `openPilotwings`, level list and `loadLevel` assembly | `obj/proto/pwtask.ts` | medium |
| `music.ts` | locate S1/B1/tbl, 31 track names, decode/loops | `mus/proto/pwmusic.ts`, `songs.ts` | low after shared fix |

Do not copy the five independent scratch FORM/MIO0 readers. Promote the already cross-checked `pwfs.ts` reader as
the sole implementation, and make all builders consume that interface. [DESIGN; efficiency finding]

### 11.2 Level list and assembly [DESIGN backed by V-ROM]

Expose all 61 task rows in the §4.3 order, grouped by vehicle/class or island, with `kind: 'stunt'` for main tests,
`'bonus'` for Cannonball/Sky Diving/Jumble Hopper/Birdman. `loadLevel(i)` should read the task through the ROM lookup,
select map/terrain/environment from its COMM, apply UVTP before asset decode, append the island/shared/vehicle/sky/task
manifests in game order, and build UPWL/UPWT objects. Include both terrain ids for Crescent and Ever-Frost but identify
the non-start side as switched terrain.

Required layers, each instance owned by exactly one layer:

| layer | kind | default |
|---|---|---|
| sea / sky-backed environment | background | on |
| terrain N and switched terrain N | main | on |
| static UVCT objects | main | on |
| island objects / moving objects / task objects | objects | on |
| task markers / ring course | markers | on |
| moving-object paths | markers | off |
| terrain collision / object boxes | collision | off |

Viewer aids such as start-heading ribbons must stay in a marker-kind layer and be excluded from clean comparison
renders. This corrects the task-18 green-triangle false alarm [V-FRAME].

### 11.3 Shared renderer contracts [V-REPO, DESIGN]

Current `Batch` already supports `texture1`, `uvs1`, `texBlend`, `decal`; `Instance` already supports `noFog`; and
`Level` supports skies, fog, layers, markers and a camera. Pilotwings therefore does not need game-specific rendering
paths for most state. Remaining choices:

- [DESIGN] Use `texture1`/`uvs1` and an appropriate `texBlend` approximation for the 32 two-image materials; preserve
  both UV sets even when a fallback renderer samples TEXEL0 only.
- [OPEN/DESIGN] Add a sky anchoring mode such as `Sky.anchor: 'cameraXZ'`, because the current sky contract ignores all
  camera translation while Pilotwings keeps world height zero.
- [DESIGN] Consider a reusable polyline/path primitive for SPTH, ring links, landing strips and orbit paths; until then,
  generated ribbon meshes are acceptable but should be centralized.
- [DESIGN] Preserve `noFog` on sea and `decal` on copied coplanar batches. The canonical offline rasterizer currently
  ignores both, so it cannot be the sole fidelity oracle.
- [OPEN] The exact two-pass terrain/fog ordering and horizon band may need renderer work; begin with the single `Fog`
  approximation and document the limitation.

### 11.4 Music player [DESIGN backed by V-ROM/V-AUDIO]

Reuse `src/rom/music/cseq.ts` and `src/rom/music/libultra.ts`. Apply `mus/libultra-lookup.diff` under a dedicated
regression gate: render representative/all tracks for GoldenEye, Perfect Dark, Bomberman, BattleTanx and Rush, and
show unchanged hashes where velocity layering is absent or explain authentic improvements where present. Expose all
31 sound-test tracks and return TSV-derived loop positions. Keep 16 voices, 22,047-Hz US output and sequence-native
tempo; custom reverb and Cannonball tempo modulation are optional later fidelity work.

### 11.5 Verification gates and performance [V-TOOL, V-REPO, DESIGN]

The scratch builder already passes `check-all` for four islands plus all 61 tasks. Port that structural checker into
normal repository checks rather than retaining another ad hoc script. Required implementation checks are the repository
standard: typecheck, all-level hashes against a clean HEAD baseline, transferable double-load, layer ownership, and
offline/in-app renders. Cache immutable decoded textures/models/terrain by ROM identity: rebuilding all assets and
hidden collision for every task currently costs roughly 0.4–1.4 seconds per task and 55 seconds for 65 structural
builds. Image comparisons should disable collision after the full collision gate and use representative scenes rather
than blanket supersampled output. [Measured: `obj/renders/render_manifest_check-all.json`]

## 12. Verification evidence

### 12.1 Static data and parser evidence [V-ROM]

- `fs/files/{us,eu,jp}/inventory.{tsv,json}` records every extracted file/chunk and decompressed MD5; the TypeScript
  reader reproduces every file offset, index and chunk hash in all three ROMs.
- `fs/notes/levels_{us,eu,jp}.tsv` is the generated task/version source. `obj/notes/tasks_objects.tsv`,
  `tasks_summary.tsv` and `island_objects.tsv` are generated from all 61 UPWT and four UPWL files.
- All 463 US textures, 363 models, 101 contours and ten terrain records parse to their exact ends. Texture and model
  sheets are in `geo/renders/`; version and unused renders are under `unused/png/`.
- `obj/tools/decode_tasks.ts`, `check_geo.ts` and `check_mtx0.ts` reran successfully in 0.90–1.15 seconds [V-TOOL].
  The one bad collision cumulative-index check remains an explicit [OPEN] issue, not a passing assertion.

### 12.2 Structural level builds and frames [V-TOOL, V-FRAME]

`obj/tools/render_tasks.ts check-all` validates finite cameras/bounds/matrices, mesh/texture references, exact batch
array lengths, texture byte lengths, exactly-one-layer instance ownership and hidden collision for every scene. The
durable 65-scene run passed in 55.02 seconds; manifest `obj/renders/render_manifest_check-all.json` has MD5
`f430595c8e4cc64094ef6bb0ab566026` and records ROM/tool hashes and per-scene timings.

Task 18's corrected start render aligns Holiday coastline, castle and horizon qualitatively with E1 frame
`emu/e1/shots/hg_beg_03_first_frame_start_t01s14.png`. Task 9's comparison exposed the camera/terrain coplanarity
bug; E3 subsequently resolved its cause as the omitted +0.745 Rocket Belt ground/model-origin correction [V-RAM].
Raw MAD 75.32/104.60 is not a fidelity score because captures include HUD/Start, timing differs and cameras are not
matched. Manifests and images are `obj/renders/render_manifest_{tasks,cmp}.json`,
`task_{18,9}_{start,top}.png`, and `cmp_task_{18,9}_vs_emu.png`.

### 12.3 Emulator sessions [V-RAM, V-FRAME]

E1 captured the title path, Hang Glider Beginner and Rocket Belt Beginner start sequences; evidence lives under
`emu/e1/`. Its camera reads were incomplete and must not be treated as final matrices.

E2 (`emu/e2/session-manifest.md`, `emu/e2/notes/e2.md`) ran from 19:05:02 to 19:11:52 UTC in a fresh directory with
the exact US ROM and a 900-second supervisor. A breakpoint verified instruction `A020F7BC` at 0x8030E464; NOPing it
and setting 0x8034F7BC to 1 unlocked Class A. `unlock_grid_hg_class_a_cursor.png`, MD5
`2a19c991202c69da3d58be8ba2e68975`, plus successful task selection is behavioral proof.

E2 entered task 19 (Hang Glider Class A, Shutter Bug) and read map 10, terrain 7, environment 18, pilot 0, vehicle 0,
class 1, test 0 from live RAM, matching the ROM table. Its complete 8 MiB dump is
`emu/e2/ram/task19.bin`, MD5 `4da4c731d7cc573632b3ec44bc1a65ab`, SHA-256
`a0184f2219f8be7a6f8c73f562a47c69f691c74de8ad84cf514bc54d1edcf5b7`. Start/in-flight frames and hashes are listed
in `emu/e2/notes/e2.md`. The state-pointer/camera-pointer chain was verified, but final camera fields were not dumped.

E3 (`emu/e3/session-manifest.md`, `emu/e3/notes/e3.md`) reached task 9 (Rocket Belt Beginner, Balloon Crash) and
verified state 5, map 1, terrain 0, environment 3, pilot 0, vehicle 1, class 0, test 0. It captured exact
`db_getstart` entry/return, the +0.745 ground snap, mode-4 camera matrices and projection fields, OR/AND graphics-state
words, an immutable-ring-provenance frame captured roughly one screenshot interval before the full-RAM pause
[V-RAM/V-FRAME]. `task9_inflight_matched.png` shows about 00'08"76, altimeter
0 m and SEA LEVEL 4 m; MD5 `f37b75ced315d4bd430b7addefc5ad9e`. The 8 MiB dump MD5 is
`169a4f4d42730a26214f44d95077124a`, SHA-256
`a106926af903a36932c27b769397e66b7205f2744bb0e6e52dc298989460ce66`.

E4 (`emu/e4-audio/session-manifest.md`, `emu/e4-audio/notes/e4-audio.md`) used the existing GoldenEye audio-dump
wrapper/plugin to capture provenance-separated sound-test tracks 09/id 8 (34.0509 s, MD5
`a9dfc2a33561143d1e452d2a7835e6ed`) and 30/id 29 (27.2445 s, MD5
`6c0b48fd2e66bef3e7c1b4a83e673c6d`) at SFX multiplier zero. Live RAM/logs verified current ids, output rate 22,047,
frame size 368 and AI DAC rate 2207 [V-RAM/V-AUDIO].

All four emulator sessions were stopped. E2/E3/E4 scoped sweeps and independent lead sweeps found no remaining
mupen64plus, headless helper or tracer process [V-TOOL]. Evidence is `emu/e1/notes/e1.md`,
`emu/e2/logs/hygiene.txt`, `emu/e3/logs/hygiene.txt` and `emu/e4-audio/logs/hygiene.txt`.

### 12.4 Music evidence [V-ROM, V-ASM, V-AUDIO]

`mus/notes/tracks_us.txt` walks every track and event; `scan_us.txt` and `bank_scan.txt` record parser/bank censuses;
`songs_us.tsv` is the generated song/loop/render table. `mus/wav/` and `mus/wav-patched/` contain baseline and corrected
renders plus indexes. E/J spot renders of songs 1, 5, 16 and 30 hash identically to US because the source blobs are
identical. E4 captures and the A/B metrics in §9.4 verify 22,047-Hz runtime output and the patched velocity lookup;
exact custom-reverb equivalence remains [OPEN]. Existing tools were used unchanged:
`../ge/music/ts/compare.ts` (MD5 `baa3a9e092ea9c49f50f96700bfbcede`) and
`../mk64/mus/tools/compare.ts` (MD5 `fa46f27c4f94eb4dd053d00a83f3cb41`). The latter's 10-ms onset, spectral and
band metrics resolved id 29's periodic alignment where the older 50-ms envelope comparator was ambiguous.

### 12.5 Reproducibility and tooling limits [V-TOOL]

`obj/tools/render_tasks.ts` now imports the repository's canonical `tools/render/{raster,png,compare}.ts`, validates
the exact US ROM, resolves scratch paths independently of the working directory, accepts explicit ROM/output/capture/
supersampling/layer options, and records commands, source hashes, ROM identity, timings and output hashes in JSON.
That replaces ten render scripts' historical dependency on `r49/bm/tools` for the primary verification path.

The resumed-investigation audit recorded five independent FORM/MIO0 parsers, duplicate geometry/CSeq probes,
hard-coded paths and debugger shell fragments [V-TOOL: `WIP.md` §§9–12]. They are research history, not implementation
sources. The durable port should retain
one filesystem reader, one renderer/check path and one emulator-session wrapper that validates ROM/address profile,
enforces timeouts, writes a manifest and performs scoped cleanup. Broad recursive scans are especially costly because
the extracted tree contains about 115,000 chunk files; use scoped `rg`/typed inventories rather than binary-tree grep.
E3 additionally exposed two races that a wrapper should standardize: wait for a new asynchronous pause-ack log line
before trusting `pc`, and atomically resolve/copy/hash an immutable screenshot-ring file instead of re-reading mutable
`latest.png`. Address validation should use one big-endian byte command and calculate ROM offsets from the documented
mapping rather than transcribing either by hand.
E4 further showed that fixed oversized input waits are unsafe: one `wait 3000` crossed the title's idle window into
an attract/controller flight, and generous per-menu waits consumed almost the entire 900-second session. A reusable
driver should wait for bounded observable state/frame transitions. Post-capture raw slicing should use byte-offset-aware,
large-block extraction rather than millions of tiny `dd bs=4` operations. For audio comparison, standardize the richer
10-ms onset/spectral/band comparator instead of maintaining the older periodicity-ambiguous 50-ms variant.

## 13. Open questions and hypotheses

Every item in this section is unresolved; none is required to parse the ROM safely unless stated.

### 13.1 Runtime rendering and camera [OPEN]

1. Capture one task frame display list to confirm fog words, both projection matrices and the near/far cell split;
   E3 already verified that live global state masks remained OR 0 / AND `0xFFFFFFFF` for task 9.
2. Capture evening env 16, night env 6 and high-altitude Sky Diving frames; verify recolouring, sky rim anchoring and
   horizon haze.
3. Determine UVMD flag bit 0's alternate draw path and texture class 32's gameplay meaning.
4. Identify the one UVMD that fails the cumulative collision-index invariant; determine whether its record is special
   or the checker assumption is wrong.

### 13.2 Objects and collision [OPEN]

1. Dump a live ring dobj and its hide mask/matrices to confirm model selection, part visibility and scale.
2. Capture ground, roof, water and texture-40/48 collision hits to verify type/id packing and pass-through behavior.
3. Finish exact Ever-Frost glider starts, whale paths and shuttle animation poses; verify ski-lift chair placement from
   SPTH in a frame/RAM dump.
4. Verify Mount Rushmore Mario↔Wario swapping in play and establish whether model 0x57's shuttle square is visible.
5. Establish COMM +0x0C (1.0 in 60 tasks, 0 in one) and any remaining scoring/wind field semantics.

### 13.3 Audio and releases [OPEN]

1. Model or quantify the custom reverb, verify title 110-BPM behavior, loop phase and Cannonball tempo call cadence.
   E4 already verified the NTSC output rate/frame size and the patched hi-hat lookup on sound-test ids 8 and 29.
2. Trace computed SFX ids before classifying the 36 no-static-reference ids as unused.
3. Check UVAN differing bytes against the parser, E's 51 extra UVLV records/148 extra blits, J Ever-Frost ESND export
   layout and US UVTX 326's Sky Diving purpose.
4. Determine whether `_uvDebugPrintf` is live in retail and whether debug overlay/RAM viewer behavior matches decomp.

## 14. Unused and hidden content

Source: `unused/notes/unused.md`, generated reference graph `unused/notes/refgraph_us.{txt,json}`, and renders under
`unused/png/`. Claims below distinguish unreachable data from merely unplaced or not statically referenced data.

### 14.1 Unloaded manifests and unreferenced assets [V-ROM, V-ASM]

The reference graph roots every constant/computed UVLV load and follows UVLV, UVTR, UVCT, UVMD, UVTX second-image,
UVTP, UVSQ and UVEN edges.

| item | status |
|---|---|
| UVLV 0x15 | never loaded; contains model 64, a redundant yellow/blue windsock also present in loaded records |
| UVLV 0x52 | never loaded in US; fonts only |
| UVLV 0x71 | never loaded; contains US blits 0/1/3, Japanese text remnants |
| UVBT 2 | in no record; byte-identical to a Japanese word blit |
| UVTX 90/91/92 | unreferenced foliage/bark/hedge-like textures [V-FRAME description] |
| UVTX 110 | unreferenced white-speckle I4 texture [V-FRAME; foam/snow meaning HYP] |
| UVTX 207/212 | unreferenced night-style facade/house textures [V-FRAME; intended role HYP] |
| UVTX 253 | unreferenced wooden panel/sign with blue screen [V-FRAME] |
| UVTX 337 | unreferenced down-arrow cursor [V-FRAME] |
| UVTX 460 | unreferenced wispy-cloud texture [V-FRAME] |
| UVTP 6 / UVTX 448 | substitution 423→448 is never installed; target is a grass/dirt-path texture |

All 363 UVMD, 101 UVCT, 115 UVAN, nine UVFT and ten UVTR files are reachable through some loaded manifest; "loaded"
does not imply placed or drawn. Models 63 (wooden pier/trestle), 203 (red cube marker), 207 (cannon pedestal), and
237/238 (yellow/red locked rings) are loaded but placed by no UVCT and named/numbered by no located code path
[V-ROM reference census; non-use DECOMP scan]. Fifty-four UI textures 283–336 lack data references but likely have code
constant uses; their individual reachability is [OPEN], so they are not classified as unused.

### 14.2 Dormant level/object systems [V-ROM, DECOMP]

All 61 task slots, all UPWL/SPTH/3VUE/PDAT files and all ten terrains are reachable; there is no cut playable island
or hidden 62nd task in these tables [V-ROM]. In particular, reduced Little States terrains 4/5/6 are used by the
Congratulations screen and terrain 9 by Sky Diving.

SDFM and OBSV are supported task chunks but appear in none of 61 files. OBSV would activate a fixed observer camera;
SDFM is copied but has no reader. Twelve of fourteen FALC records are empty patrol domains rather than hawks. Ring
subtype 2 creates no model (two records), one subtype-3 GOAL ring uses model 0xF1, and every stored ring name is empty.
Seventeen of 28 environment-sound lookup slots are used by no ESND record. [V-ROM census; behavior DECOMP]

The UPWT NAME/INFO strings are not displayed and retain development-era designs/names: `training`, `cisland`,
`arctic skydiver`, directions to Cape Kennedy/Grand Canyon/Empire State Building, a generic three-minute ring template
copied into 18 unrelated tasks, and a truncated B_RP_3 description. [V-ROM text; non-display DECOMP]

### 14.3 Text and photo-album remnants [V-ROM, V-ASM; interpretation HYP]

Eighteen US ADAT keys have no found name or constant-id lookup path: `WINDOW1`, `WINDOW2`, `OPTION2`, `CONTINUE`,
`HANG`, `ROCKET`, `GYRO`, `CANNON`, `SKYDIVER`, `LEVEL1`–`LEVEL3`, `CRASH`, `OUT`, `MUSHI`, `LAND_GAI`, `STRIKE`,
and empty `BD_ALL_S3`. `WINDOW2` includes "Sample photo" and `OPTION2` says "Select album"; together with localized
UVTX 318–326 these suggest a removed photo-album workflow [HYP]. Numeric text ids embedded in data were not exhaustively
scanned, so the non-use conclusion is medium confidence. J additionally contains `DUMMY` and `FIRST`, the latter a
0x00–0x3F glyph test page.

### 14.4 Debug and developer features [V-ASM; behavior DECOMP unless noted]

| feature | activation / status |
|---|---|
| timing overlay and RAM viewer | task/menu state byte at 0x803626A2: 1–3 timing/counters, 4–5 printf modes, 5 hides HUD, 6 enters RAM viewer; no normal writer except initialization |
| unlock-all | NOP 0x8030E464 and set 0x8034F7BC = 1; E2 verified cursor movement and successful Class A selection [V-RAM/V-FRAME] |
| input recorder | set `sDemoMode` 0x8034FAD0 = 1 at task start; prints 60 seconds of controller input if debug printf works |
| dev-cart modes | boot reads PI dev 0xFFB000; `-d` waits without starting app, `-z` clears memory regions |
| fault screen | CPU exception loop draws a green panel encoding the fault PC as 32 black/white squares |
| hidden level-select/cheat code | none found beyond retail class select [DECOMP scan; absence medium confidence] |

The ROM retains the UltraVision NU64 V1.5 banner, kernel/app/filesystem size diagnostics, GFX high-water messages,
camera self-check strings, Kanji/Japanese text errors in the US build, input/attitude recorder formats, and complete
credits strings [V-ROM]. Whether retail `_uvDebugPrintf` emits usable output is [OPEN].

### 14.5 Unused audio [V-ROM sequence/bank walk; reachability DECOMP]

Song 26, Birdman: Landing, is selectable in the sound test but no normal Birdman state starts it. Songs 11/22 are
near-duplicates; 10/21 and 17/24 are transposed/revoiced relatives, not unused.

Ten non-null music-bank instruments are never selected by a program-change event: 0, 9, 11, 12, 13, 17, 18, 25,
65 and 70. Instrument 0 may still act as a default on channels without program change [HYP]. Four waves reachable
only through instruments 9/11/12/13 total 87,814 bytes. Song 1 selects null program 2 but places no later notes on
that channel. A static call-site/ESND scan found no use for 36 of 120 SFX ids, but computed vehicle ids were not fully
traced; those 36 remain candidates, not verified-unused content [OPEN].
