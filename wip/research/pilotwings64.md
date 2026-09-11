# Pilotwings 64 research: work in progress (paused)

Resume file for the Pilotwings 64 (N64, USA) research investigation for the viewer at `/home/n64/nviewer`. The rules are
in "Research investigations" in `/home/n64/nviewer/AGENTS.md`. The repo is read-only for this investigation.
- **Workspace:** `/home/n64/.ai-tmp/r49/pilotwings/`.
- **Deliverable:** `PILOTWINGS64.md` in the workspace.
- **Limits set by the user:** at most 3 subagents at a time (including sub-subagents), at most one emulator at a time,
  and each emulator session in a fresh subagent with its own run directory under the workspace. Subagents are told
  not to spawn agents.
- **Machine-wide cap:** spawning failed twice with "Concurrent subagent limit reached" (20 across all sessions).
  Retrying after some minutes worked.

`BRIEF.md` is the shared brief every subagent reads first: rules, ROM md5s, known facts, and agent A's results. Keep
it current when resuming.

## 1. State of PILOTWINGS64.md

| section | state |
|---|---|
| 1 ROM identification | written from verified notes, **not proofread** |
| 2 Boot and code (layout, microcode, key functions) | written, not proofread |
| 3 Filesystem and compression (container, MIO0, TABL/addressing, user files, file types) | written, not proofread |
| 4 Levels (concepts, load sequence, envGetCurrentId table, 61-task level list) | written, not proofread; the table was generated from `fs/notes/levels_us.tsv` |
| 5 Geometry and textures (packed lists, UVTX, state word, UVMD, UVCT/UVTR, coordinates) | written, not proofread |
| 9 Music | drafted in the separate file `part_music.md`; insert it after §8 when assembling |
| 0 At a glance, intro/evidence labels, research-material table | **missing** (write last) |
| 6 Environment (fog, sky, sea, clear colour, lights, camera) | **missing**; needs agent D's results and emulator verification |
| 7 Objects (UPWT task objects, UPWL island objects, SPTH/3VUE paths, UVCT set pieces, animated/toys) | **missing**; agent D |
| 8 Collision | **missing**; agent D (B found that UVCT collision triangles = render triangles) |
| 10 Version differences (US/E/J) | **missing**; material is in `fs/notes/fs.md` §5, `fs/notes/versions.txt`, `mus/notes/music.md` §2.1 |
| 11 Mapping onto `src/rom/` with difficulty | **missing**; material is in geometry.md §10, music.md §5.1, and D |
| 12 Verification evidence | **missing** |
| 13 Open questions | **missing** |
| 14 Unused and hidden content | **missing**; agent F (and music.md §7) |

The planned structure follows STARFOX.md: 0 glance, 1 ROM, 2 boot, 3 fs, 4 levels, 5 geometry, 6 environment,
7 objects, 8 collision, 9 music, 10 versions, 11 mapping, 12 verification, 13 open questions, 14 unused.
Proofreading is still to be done for the whole document.

## 2. Subagent results and where they live

### A: filesystem, code, levels (finished)
- **Notes:** `fs/notes/fs.md`, `fs/notes/levels.md`, `fs/notes/levels_{us,eu,jp}.tsv`, `fs/notes/romap.md`,
  `fs/notes/catalogue.txt`, `fs/notes/small_{us,eu,jp}.txt`, `fs/notes/versions.txt`.
- **Tools:**
  - `fs/tools/extract.py <rom>...` writes `fs/files/<us|eu|jp>/<global>_<type>_<typeidx>/<chunk>_<TAG>.bin` plus
    `inventory.tsv`/`.json`;
  - `fs/tools/levels.py`, `decode_small.py`, `romap.py`, `catalogue.py`, and `xmatch.py` (US→E/J function addresses);
  - `fs/proto/pwfs.ts` is the TS reader; `npx tsx fs/proto/test.ts` prints ALL OK on 3 ROMs;
  - `fs/dis/` holds disassembly listings.
- **References cloned:**
  - `fs/ref/Pilotwings64Decomp/`: gcsmith, a 100 % matching US decompilation. It is a strong lead; label its claims
    "decomp";
  - `fs/ref/pw64/` (UPWT parser, task modding);
  - `fs/ref/pilotwings_64/` (fs/terrain dumpers, hexpat).
- `mips-elf-objdump` is not installed; use `mips-linux-gnu-objdump`.

### B: geometry and textures (finished)
- **Notes:** `geo/notes/geometry.md`, which is complete and already condensed into spec §5.
- **Prototype:** `geo/proto/` has `pwrom.ts`, `pwformats.ts`, `pwtex.ts` and `pwlevel.ts`
  (`buildTerrainLevel(geo, [terra…], {sea})`), plus render scripts: `tex_sheet.ts`, `render_islands.ts`,
  `render_sea.ts`, `gallery.ts`, `render_collision.ts`, `test_patch.ts`.
  - It uses the unmodified `displaylist.ts` (`'f3d'` plus the C0 texture hook).
  - The optional `geo/displaylist.diff` (16 lines, standard texture path) was tested on a copy.
- **Renders:** `geo/renders/` has terra_*, sea_*, tex sheets, model galleries, collision, and cmp_boot01_vs_render.
- **Main findings:**
  - Fast3D;
  - packed geometry lists;
  - a per-material 32-bit state word (§5.3);
  - UVTX odd rows stored word-half swapped;
  - UVMD part hierarchy by depth, LOD by distance;
  - UVTR grids of UVCT cells; UVCT collision triangles = render triangles;
  - Z-up world, viewer transform (x, y, z) → (x, z, −y);
  - seas are UVMD 353/358/360/361 and skies 352/354-357/359/362.
- **B's emulator requests (not yet run; geometry.md §11):**
  - units (HUD altitude vs player z);
  - state OR/AND masks at 0x802491E0/E4 (is fog bit 31 ORed in?);
  - a frame DL capture (Gfx cursor word at 0x80298AB0);
  - LOD distances at 0x8022C7B8;
  - the active environment and sky placement;
  - whether terrains 2 and 8 are drawn together with 1 and 7;
  - a known-camera screenshot for a pixel comparison;
  - special paths: state bit 25, model flag bit 0 (0x80205814).

### C: music (finished)
- **Notes:** `mus/notes/music.md`, `mus/notes/songs_us.tsv`, `mus/notes/tracks_us.txt`, `scan_us.txt`,
  `bank_scan.txt`, `lookup.txt`. Condensed into `part_music.md`.
- **Prototype:** `mus/proto/pwmusic.ts` (layout from kernel literals, bank, render),
  `mus/proto/render_all.ts` (run with `/home/n64/nviewer/node_modules/.bin/tsx`), `proto/songs.ts` (names).
- **WAVs:** `mus/wav/` (repo modules unchanged), `mus/wav-patched/` (with `mus/libultra-lookup.diff`),
  `wav-eu/`, `wav-jp/`.
- **Main findings:**
  - stock libultra `ALCSPlayer`; 31 compact-MIDI songs, division 768; one music bank with velocity-layered hi-hat;
  - UVSX = sound effects only;
  - `cseq.ts` works unchanged;
  - `libultra.ts` needs a one-line `__lookupSoundQuick` fix, which changes 424 notes. Before merging, re-render the
    other `libultra.ts` games (PD, BM64, BattleTanx, Rush);
  - song 30 needs `maxVoices` 20 for an exact loop;
  - song 26 is unreachable in play.
- **C's emulator requests (not yet run; music.md §6):**
  - song ids at `uvaSeqNew` 0x802046E0 in each mode;
  - output rate / frameSize at 0x802611C0 / 0x80260CE8;
  - an audio capture from the Options sound test compared with `wav/` and `wav-patched/` (decides the hi-hat fix,
    calibrates level). The capture tools are `/home/n64/.ai-tmp/r49/ge/music/tools/headless-audio.sh`,
    `mupen64plus-audio-dump.so`, `bpmon.py` and `ge/music/ts/compare.ts`;
  - the title 110 BPM override; the Cannonball tempo log.

### E1: emulator session 1 (wound down; see §2a below for its final report)
- **Run directory:** `emu/run-e1`. **Outputs:** `emu/e1/shots/`, `emu/e1/ram/`, `emu/e1/notes/e1.md`.
- **Goals:** reference captures (menus; Beginner Hang Glider, Rocket Belt and Gyrocopter start frames), a PI DMA trace
  of a task load, finding the RAM task/island ids and a warp, and RAM dumps in flight.
- **Addresses forwarded to it** (from A's decomp work): game state pointer 0x80362690 (+4 map, +6 terra, +8 env),
  `taskLoadCommObj` 0x80345CE4, `uvUserFileRead` 0x802314D0, `uvLevelAppend` 0x80224CE0, `uvChanTerra` 0x80204E5C.

### D: objects, paths, environment, collision (wound down; see §2a)
- **Directory:** `obj/` (notes `obj/notes/objects.md` [+ `environment.md`, `collision.md`], prototype
  `obj/proto/pwtask.ts`, renders `obj/renders/`).
- **Scope:** all UPWT/UPWL record layouts with models and placement, ring order paths, SPTH/3VUE, UVEN → Fog/clear/sky
  (the game's fog units and projection from code), start camera, collision surface types and UVMD volumes, a full
  `Level` per task, renders, emulator requests.

### F: unused and hidden content (wound down; see §2a)
- **Directory:** `unused/` (notes `unused/notes/unused.md`, renders `unused/png/`).
- **Scope:** a reference graph over files (unreferenced models/textures/etc.), unused level data (SDFM/OBSV, PDAT,
  3VUE, SPTH, terra 9, palette 6, env 0/1/22/23), ADAT keys never shown, debug features (dev-cart check at 0xFFB000,
  level select UVLV 0x4A?), audio, version leftovers.

## 2a. Final reports from the wind-down

(Filled in below when they arrive.)

### E1 final report (finished; emulator stopped)

- **Process check.** E1 itself found no mupen64plus, headless-*.sh or tracer.py left from `emu/run-e1`. The lead
  re-checked: the only mupen64plus/tracer.py running belong to the Glover investigation.
- **Done:** goal 1 partly (Hang Glider and Rocket Belt Beginner; Gyrocopter not captured); goal 2 through boot and menus
  only; goal 3 found the variables but did not try the warp; goal 4 not done (no in-flight RAM dumps).
- **Shots:** `emu/e1/shots/`, 30 captures:
  - `boot01..04` (intro overhead of Crescent, flyover, logos, title);
  - `menu01..06` (title, SELECT FILE, SELECT VEHICLE & CLASS with only Beginner open, SELECT PILOT, pause, class
    summary);
  - `hg_beg_01..09` (Holiday "TEST1 Albatross Nest": briefing, start frame `hg_beg_03_first_frame_start_t01s14.png`,
    flight, crash, results);
  - `rb_beg_01..08` (Holiday "TEST1 Balloon Crash": briefing, start frame, climb).
- **RAM:** `emu/e1/ram/vs_hg.bin`, `vs_rb.bin`, `vs_gc.bin` are full RDRAM at vehicle select, not in flight.
- **Tools:** `emu/e1/tools/` (`tracer.py`, `dbg.sh`, `filemap.py` + `filemap.tsv` ROM→file map, `ramdiff.py`, `sheet.sh`,
  `keep.sh`). Notes: `emu/e1/notes/e1.md`, `emu/e1/notes/loads.tsv`.
- **Verified by the emulator:**
  - the app is copied from ROM 0x51E30 to 0x802CA900, length 0x8C8F0;
  - every ROM read goes through `_uvMediaCopy` 0x8022A760 in 0x1000-byte `osPiRawStartDma` pieces;
    `uvFileReadHeader` 0x80223E80 fires once per opened file (gives its ROM address);
  - at boot, `taskLoadCommObj(i)` runs for tasks 0-44, and `uvUserFileRead(0x27+i, 2)` returns the UPWT ROM offset
    (task 0 = 0x34D48C = levels_us.tsv);
  - opening the Hang Glider class card calls `uvLevelAppend` 0, 0x0B, 0x87, 0x5C, then UVSY#0, UVLV#0, UVTX#0..33;
  - the pointer at 0x80362690 holds 0x80362698 (game-state struct: +4 map, +6 terrain, +8 env; pilot 0x803626A4,
    vehicle 0x803626A6, class 0x803626A8, test 0x803626AA). This was also verified in the `testMenuInit` disassembly;
  - the vehicle-select cursor is at 0x8034F7A0 (column), 0x8034F7A4 (row), 0x8034F7A8 (column + 3×row).
- **Game facts from frames:**
  - a new save opens only the Beginner row; Class A/B/Pilot and all Extra Games (Birdman, bonus games) are locked, so
    other islands are unreachable without a warp or save;
  - the pause-menu cursor moves only with the analog stick;
  - HUD: TIME, speed km/h, PHOTO count, SEA LEVEL m, radar.
- **Emulator artefact:** in flight, the graphics plugin draws a black polygon in front of the pilot (not in the game).
- **Not yet checked:** map/terrain/env 1/0/2 at task start; `taskLoadCommObj(18)` → 0x357744; the island
  `uvLevelAppend` sequence; `uvChanTerra` in Dark Cavern.
- **Warp recipe (hypothesis, never run):** break at `testMenuInit` 0x80348B84 when pressing A on the class card, write
  class 1 / test 0 into the struct (vehicle unchanged), and expect "Shutter Bug" on Ever-Frost (map 10, terrain 7,
  env 18). Alternative: a save with everything unlocked.

### F final report (finished early; no emulator)

Notes are in `unused/notes/unused.md`: every item has location, evidence, label and confidence. Emulator experiments
are in its §9.
- **Tools:** `unused/tools/` (`callscan.py` constant loader arguments in the disassembly, `refgraph.py`, `adat_keys.py`,
  `bankuse.py`, `geodiff.py`, `uvbt_png.py`, `render_unused.ts`, `render_versions.ts`, `render_ct_versions.ts`).
- **Renders:** `unused/png/`.

**Findings:**
- **Debug overlay and RAM viewer** (address verified, behaviour decomp): u8 at 0x803626A2. Values 1-3 show timing
  bars and draw counters, value 6 a full-screen RAM viewer. Only init writes it (0).
- **"Unlock all" in class select** (read/write sites verified): flag 0x8034F7BC makes every class and bonus column
  selectable. It is written only as 0, at 0x8030E464, when the screen opens.
- **Dev-cartridge check** (verified in the disassembly): PI 0xFFB000. "-d" means the app thread never starts; "-z"
  clears memory regions.
- **Dead features:**
  - input recorder (mode 1, state byte 0x8034FAD0) and attitude recorder ("precord") never enabled;
  - OBSV observer cameras are checked every frame, but no task has any;
  - SDFM is parsed and never read.
- **Unreferenced files** (verified: reference graph + constant loader-argument scan):
  - UVLV records 0x15, 0x52 and 0x71 are never loaded;
  - US UVBT 0-3 are byte-identical to J blits with Japanese words (0, 1, 3 are listed only in 0x71; 2 nowhere);
  - UVTX 90, 91, 92, 110, 207, 212, 253, 337 and 460 are unreferenced;
  - UVTP palette 6 (423→448) is never selected;
  - 207 and 212 are the gaps in Little States' night-texture range (hypothesis).
- **Unused models** (code non-use from a decomp grep; geometry verified by render): 63 pier/trestle, 203 and 207 map
  markers, 237 and 238 yellow/red locked rings.
- **Everything else is reachable:** all 363 UVMD, 101 UVCT, 115 UVAN, 9 UVFT, 10 UVTR, 61 UPWT, 8 SPTH, 12 3VUE and
  25 PDAT.
  - **Correction to A:** terrains 4/5/6 (UVLV 6/7/8) are used by the **Congratulations screen**, not the replay.
  - Terra 9 and env 1 are used by Sky Diving.
- **Text:**
  - 18 ADAT keys have no lookup path, including "Sample photo" and "Select album" (a cut photo album?). Medium
    confidence: numeric ids in data tables were not scanned;
  - J has a font test page (`FIRST`) and a `DUMMY` key;
  - UPWT developer INFO strings show older task designs ("land at cape kennedy", "land on the empire state building")
    and internal island names.
- **Audio:**
  - song 26 is unreachable (confirms C);
  - 10 music-bank instruments are never selected, and 4 waves (87,814 bytes) belong only to them;
  - song 1 selects the empty program 2 but plays no notes with it;
  - 36 of 120 SFX ids have no static use (hypothesis: computed ids not traced).
- **Versions** (small polish, verified by geometry diffs and renders):
  - US textures the Crescent hut base (model 57), J leaves it untextured;
  - retriangulations: Wario/Mario heads 85/153, Little States overview 81, cells 50/80/93/99;
  - J Ever-Frost ESND records store emitter positions differently (not decoded);
  - US UVTX 326 is J's Japanese glyph texture, yet US Sky Diving code references it (open).
- **Unfinished:** E/J reference graphs; code references to UI textures 283-336 and animation ids; computed sound ids;
  the J ESND layout; texture 326; cross-checking D's object tables.
- **Proposed emulator experiments:**
  1. poke 0x803626A2 = 1..6 in flight and screenshot each;
  2. NOP the write at 0x8030E464 and set 0x8034F7BC = 1, then open class select on a fresh save (this also unlocks
     every island for the reference-capture work);
  3. log every sound id (0x8033F7F8 and related) on a tour, and audition the 36 unused ids;
  4. inject an OBSV record into a loaded task (task pointer 0x8035078C, offsets +0x42B/+0x474 decomp, unverified);
  5. check `_uvDebugPrintf` output, and set 0x8034FAD0 = 1 for the input recorder.

## 3. Tools and how to run them

- **Node TS:** `/home/n64/nviewer/node_modules/.bin/tsx script.ts` (or `npx tsx` from `/home/n64/nviewer`). Scripts
  import repo modules by absolute path. Never write into the repo.
- **Filesystem:**
  - `python3 fs/tools/extract.py "<rom>"...` → `fs/files/<us|eu|jp>/...` + inventory (~7 s per ROM);
  - `tsx fs/proto/test.ts` (ALL OK check);
  - `tools/pwfs.py` is the lead's minimal MIO0/TABL walker.
- **Geometry:** in `geo/proto/`, run `tsx render_islands.ts`, `render_sea.ts`, `tex_sheet.ts`, `gallery.ts`,
  `render_collision.ts`. `pwlevel.ts` exports `buildTerrainLevel(geo, [terra...], {sea})`, which returns a viewer
  `Level`.
- **Offline rasterizer:** `/home/n64/.ai-tmp/r49/bm/tools/` (README.md there): `raster.ts renderLevel`, `autoCameras`,
  `png.ts`, `sheet.ts`, `compare.ts sideBySide(emu, render, out)`.
- **Music:**
  - `tsx mus/proto/render_all.ts` renders `mus/wav/` (and patched variants); `mus/proto/pwmusic.ts` holds the layout
    and track list;
  - `python3 mus/tools/tracks.py` / `bank.py` / `scan_s1.py` for data censuses.
- **Unused:** `unused/tools/refgraph.py`, `callscan.py`, `adat_keys.py`, `bankuse.py`, `geodiff.py`, plus the render
  scripts.
- **Emulator helpers:** `emu/e1/tools/` (`tracer.py` breakpoint logger, `dbg.sh`, `filemap.py` ROM offset → file,
  `ramdiff.py`, `sheet.sh`, `keep.sh` copies shots out of the ring buffer).
- **Disassembly:** `mips-linux-gnu-objdump -D -b binary -m mips -EB --adjust-vma=...`.
  - Kernel: ROM 0x1050 → 0x802000A0. App: ROM 0x51E30 → 0x802CA900 (US).
  - Listings: `fs/dis/`, `geo/tools/code.asm`, `mus/dis/`.

## 4. Emulator recipes that worked (US ROM)

- **Run directory:** one per session under `emu/`, `M64P_RUN_DIR=/home/n64/.ai-tmp/r49/pilotwings/emu/run-<name>` on
  every command.
- **Stop:** `pkill -x -F $M64P_RUN_DIR/pid mupen64plus` (`headless-debug.sh quit` if paused in the debugger).
- **Hygiene check:** walk `pgrep -f 'mupen64plus|headless-|tracer.py'` and match `/proc/<pid>/environ` M64P_RUN_DIR
  or cwd against `pilotwings` (other investigations such as Glover run their own `tracer.py`).
- **Menus to a Beginner task** (new save): title → Start game → SELECT FILE (new file) → SELECT VEHICLE & CLASS (only
  Beginner open) → SELECT PILOT (Lark) → class card → briefing → task. Exact button/wait sequences are in
  `emu/e1/notes/e1.md`.
- The pause-menu cursor moves only with the analog stick (`hold x=0 y=-80 ...`), not the D-pad.
- **Debugger:** add every breakpoint once while paused at the first instruction (right after `--debug` start), then
  `run`. Break on the game's loaders, not on PI registers:
  - `_uvMediaCopy` 0x8022A760 (all ROM reads);
  - `uvFileReadHeader` 0x80223E80 (once per file, ROM address in args);
  - `uvLevelAppend` 0x80224CE0;
  - `taskLoadCommObj` 0x80345CE4;
  - `uvUserFileRead` 0x802314D0;
  - `testMenuInit` 0x80348B84.
- **Game state:** pointer 0x80362690 → struct 0x80362698 (+4 map, +6 terra, +8 env, +0xC pilot, +0xE vehicle,
  +0x10 class, +0x12 test).

## 5. Dead ends and pitfalls

- **PI DMA register breakpoints** (0x04600008/0C) froze the game when added while it was running. Use loader-function
  breakpoints instead.
- **`bp rm`** in this debugger console resolves the index from a stale list and can delete the wrong breakpoint.
  Never remove breakpoints; add them once.
- **"GZIP" chunks are MIO0**, not DEFLATE. Chunk payloads are 8-byte aligned, and the UVTR/UVMD/UVCT/UVTX payloads are
  packed streams (no struct alignment). The decomp doc's struct sizes are RAM layouts, not file layouts (e.g. UVTR
  header, 3VUE QUAT is 0x18 per entry, not 0x14).
- **The decomp `task.h` comment** for the Birdman class → island order is wrong: the data gives Beginner Holiday,
  A Ever-Frost, B Crescent, Pilot Little States.
- **Graphics-plugin artefact:** in flight a black polygon appears in front of the pilot. It is not in the game; ignore
  it in render comparisons.
- **A fresh save cannot reach other islands.** Use the class-select unlock (F: 0x8034F7BC + NOP the write at
  0x8030E464) or the game-state struct warp (E1, untested) instead of playing through.
- **`libultra.ts` is shared** by other games. The velocity-layer fix must be regression-checked on them.

## 6. Open questions and hypotheses (not yet resolved)

- **Environment (D was working on it):**
  - how UVEN fogMin/fogMax (≈ 996..1000) map to RSP fog factors, and the game's projection near/far/fovy;
  - whether fog is ORed into every state word at run time (state OR/AND masks 0x802491E0/E4);
  - sky dome placement (camera-relative?); lights; clear colour.
- **Units:** 1 unit = 1 m (hypothesis; compare HUD SEA LEVEL with player z).
- **Terrain layers:** are terrains 2 and 8 drawn together with 1 and 7, or only switched in by TPTS? The Crescent TPTS
  shift (∓490, ∓1478, ±215) suggests the cave interior is modelled elsewhere.
- **Geometry fields:** UVTX trailer fields (b15/b16/b35-b38/f40), UVMD volume records (36 bytes) and triples, UVMD f3c,
  UVCT tail float and sub-cell mask rule, UVTR f36.
- **Special draw paths:** state bit 25, model flag119 (0x80205814). Two-image combiners and scrolling textures are not
  modelled.
- **Files:** SPTH pair order {value, time} vs {time, value}; UPWT COMM +4/+9/+0x10 meaning.
- **Text:** J text glyph source.
- **Music:**
  - output rate 22047 (hypothesis) and level calibration;
  - whether the hi-hat velocity-layer fix matches the game (needs capture);
  - the title 110 BPM effect;
  - song 30 voice drops.
- **Unused:** 18 ADAT keys (numeric ids not scanned), 36 SFX ids, UVTX 326 in Sky Diving, J ESND layout.

### D final report (finished at wind-down; no emulator)

- **State.** All UPWT/UPWL/SPTH/3VUE/UVEN decoding is done and checked against the data. The Level builder
  `obj/proto/pwtask.ts` (+ `pwmesh.ts`) and the render script `render_tasks.ts` are **written but never run**: no
  renders, no emulator comparison.
- **Notes:** `obj/notes/objects.md` (main: layouts, models/placement §3.2, moving objects §4.2, unfinished work, next
  steps, emulator requests), `obj/notes/environment.md`, `obj/notes/collision.md`.
- **Tables:** `obj/notes/tasks_objects.tsv` (414 task objects), `tasks_summary.tsv` (per-task environment, start
  camera, ring course), `island_objects.tsv`.

**Verified findings not yet in the spec:**
- **Correction to A (verified, ROM bytes; fixed in spec §4.1):** the map table {1,3,5,10} is at US 0xD7CD8
  (E 0xD97F8, J 0xD8228), and the task → user-file table starts 4 bytes later (0xD7CDC).
- **UPWT.** All 61 decode; every chunk is count × record size; no task has SDFM or OBSV.
  - Matrices are row-major row-vector, Z up, +Y forward.
  - Record angles are degrees (heading, pitch, roll); UPWL landing-pad angles are radians.
  - The object matrix replaces the model's part 0 and is then scaled by 1/scaleDiv.
- **Rings.**
  - The model is chosen by active flag, child count, subtype and size; the game hides parts 2, 3, 5, 6 and part 1 or 4.
  - Subtype 2 has no model.
  - Pass test: diameters 7.5/10/12.5/17.5/25 plus a plane crossing.
  - Course order only through child links: tasks 0, 3, 6, 13 (timed) and 15. Tasks 1, 10, 18, 20 and 25 are free
    order.
- **Landing targets** snap to the nearest unused island LPAD within 100 units. **Photo targets** name moving objects:
  shuttle, ferry, Nessie, whale, fountain, oil plant.
- **SPTH is `u32 n; {f32 time, f32 value} × n` per axis** (verified, data: times run 0..100; the "u32 0" A saw is the
  first key's time).
  - SPTH 0x04 is the Ever-Frost ski lift (20 chairs); 0x6D/0x6E are the Little States planes.
  - 0x43-0x47 and 3VUE 0x48-0x4D are title-screen paths; 3VUE 0x4E-0x53 are replay paths (decomp).
- **Mario head.** The Mount Rushmore Mario head is a UVCT static object (model 0x99) at a TOYS point; hitting it swaps
  it to Wario 0x55 (decomp).
- **Moving objects.** Boats, glider toys, whale, shuttle, ferry, Nessie and oil spray have code-defined start positions
  (decomp, objects.md §4.2).
- **Fog** (verified, disassembly): factor clamped to 0.996, `gSPFogPosition(996, 1000)` → multiplier 32000, offset
  −31744. Only terrain beyond 2/3 of far is fogged, drawn with near 40 and far 2000 (decomp). Proposed
  `Level.fog = {multiplier 32000, offset −31744, near 40, far 2000}`, colour from UVEN.
- **Projection** (verified, disassembly): far 2000; frustum ±0.4906542 × ±0.35 per unit zoom; viewport 300×214.
  - fovY 38.6° for Hang Glider and Birdman, 47.3° for Rocket Belt and Gyrocopter.
  - Start camera offsets (decomp): Hang Glider (0, −6, 0.5), Gyrocopter (0, −4.45, 1.2), Rocket Belt 6 behind.
    Per-task values are in `tasks_summary.tsv`.
- **Sky dome** follows the camera in X/Y only, with its base at world z = 0. Sky and sea are drawn with depth off.
  Tasks never clear the screen (so no `clearColor` during tasks).
- **Time of day** (decomp): evening/night environments recolour vertex colours and texels once after load, with
  per-file weights: UVCT tail float, UVMD f3c, UVTX f40. The formulas are in environment.md §6, implemented but
  untested.
- **Collision** (collision.md).
  - Hit types: 1 terrain, 2 dynamic object, 4 water, 8 static object (decomp).
  - Surface class is a UVTX trailer field (verified, data): 4 = water (textures 25, 26, 40, 48, 60, 110, 111, 242),
    32 = unknown.
  - The UVMD 36-byte records are boxes: part, skip count, hollow flag, min/max in world units, cumulative end index
    into the triangle list (verified, data; one model fails the index check).
- **Proposed viewer layers:** sea, terrain (+ alternate terrain), static objects, island objects, moving objects, task
  objects, markers, ring course, paths (hidden), collision terrain by class (hidden), collision object boxes +
  triangles (hidden).
- **Proposed types.ts additions:** a polyline/path primitive (ring courses, SPTH paths, landing strips) and a sky
  anchor option (dome base at a world height, following the camera in the horizontal plane only).
- **Unused (for §14):**
  - SDFM and OBSV never appear;
  - 12 of 14 Meca Hawk (FALC) records are empty patrol areas;
  - island landing pads Crescent 2/5 and Ever-Frost 4 are never targets;
  - ring name strings are empty;
  - environments 22/23 and UVTP palette 6 are unused by tasks.
- **Open:** texture class 32; one model failing the box-index check; COMM +0x0C; camera lag at the Hang Glider start
  frame; how the sky dome and haze band look from altitude.
- **D's emulator requests** (details in objects.md):
  - O1/O2 start pose and camera struct (Hang Glider, Rocket Belt);
  - O3 ring dobj table;
  - F1 one display list for fog words and the two near planes;
  - F3 evening/night screenshots;
  - C1 collision hit records.

## 7. Prioritised next steps

1. **Run D's builder.** `tsx obj/proto/render_tasks.ts all`, fix what breaks, then compare task 18 and task 9 start
   frames with `emu/e1/shots/hg_beg_03_first_frame_start_t01s14.png` and `rb_beg_03_first_frame_start_t00s51.png`
   (`compare.ts sideBySide`). Check ring part hiding and the night recolour. One subagent, no emulator.
2. **Emulator session E2** (fresh subagent, run dir `emu/run-e2`): first unlock everything (F: NOP the write at
   0x8030E464 + 0x8034F7BC = 1), or test E1's struct warp at `testMenuInit` 0x80348B84. Then:
   - capture start frames for one task per island/vehicle, Birdman, the bonus games and evening/night variants
     (F3), keeping in-flight RDRAM dumps;
   - verify map/terra/env at task start, the island `uvLevelAppend` sequence, and `uvChanTerra` in Dark Cavern
     (whether terrains 2 and 8 are drawn together with 1 and 7);
   - read the state OR/AND masks 0x802491E0/E4;
   - capture one frame display list for fog words and near/far (F1; Gfx cursor word 0x80298AB0);
   - check units (HUD SEA LEVEL vs player z), LOD distances (0x8022C7B8), start pose/camera (O1/O2), ring dobj table
     (O3), collision records (C1);
   - run F's debug experiments 1-2 (0x803626A2 overlay values, class unlock).
3. **Emulator session E3** (after E2, run dir `emu/run-e3`): audio.
   - Song ids at `uvaSeqNew` 0x802046E0 across modes.
   - Output rate/frameSize (0x802611C0/0x80260CE8).
   - Sound-test captures (Options → Sound, SFX volume 0) with GoldenEye's `ge/music/tools/headless-audio.sh`, compared
     against `mus/wav/` and `wav-patched/`. This decides the hi-hat fix and calibrates the level.
   - Title 110 BPM check; Cannonball tempo log.
4. **Spec assembly.** Write §6 environment, §7 objects, §8 collision from `obj/notes/*`; insert `part_music.md` as §9;
   write §10 versions (fs.md §5, versions.txt, F's version diffs), §11 mapping (fs `pwfs.ts`; geometry.md §10;
   pwtask.ts; music.md §5.1; types.ts additions: path primitive, sky anchor, optional `Batch` two-texture use;
   `libultra.ts` fix with regression check; difficulty per part), §12 verification evidence, §13 open questions, §14
   unused (F's `unused/notes/unused.md` + D + music.md §7), then §0 at a glance and the intro. Update §4 with F's
   correction: UVLV 6/7/8 (terrains 4/5/6) are used by the Congratulations screen, not the replay. Label every claim.
5. **Proofread** the whole spec (a subagent or the lead): cross-check addresses against the notes, label coverage,
   consistency of ids (UVLV hex vs decimal), links to research paths.
6. **Report** only when the spec is proofread and every subagent has finished (AGENTS.md).

## 8. Status at pause

- **Subagents:** none running. A, B and C finished normally; E1, D and F wound down on request and sent final reports
  (above).
- **Processes:** no mupen64plus, headless-*.sh or tracer.py process of this investigation is running (lead sweep of
  all such processes by cmdline, M64P_RUN_DIR and cwd; at the last check none were running on the machine at all).
- **Repo:** `/home/n64/nviewer` was not modified by this investigation.
