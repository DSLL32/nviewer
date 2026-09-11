# Mario Kart 64 research: work in progress (paused)

Paused on the user's request while the investigation was running. Everything needed to resume without the original
conversation is here. Workspace: `/home/n64/.ai-tmp/r49/mk64/`. The repo `/home/n64/nviewer` was never modified
(read-only rule). Deliverable: `/home/n64/.ai-tmp/r49/mk64/MARIOKART64.md`.

Task (from the user, via the main session): a research investigation of Mario Kart 64 (USA) for the viewer, following
the "Research investigations" section of `/home/n64/nviewer/AGENTS.md`: ROM ids and versions, boot/code layout, filesystem
and compression, level list with names, geometry and render state, environment (fog, sky, clouds, clear colour, start
camera), objects (item boxes, trees, Piranha Plants, trains...; kart path as a path layer), collision with surface types,
music (driver, song list, loops; whether `src/rom/music/` can be reused), mapping onto `src/rom/` with difficulty,
verification evidence, open questions; every claim labelled. After the spec is otherwise complete: an unused/hidden
content section. Limits set by the user: **at most 3 subagents at a time (including sub-subagents), at most one emulator
at a time**, each emulator session in a fresh subagent with its own run directory under the workspace, stopped at the
end, and checked for leftover mupen64plus / `headless-*.sh` processes (never touch other investigations' emulators).
Report only when the spec is proofread and every subagent has finished.

Shared brief given to every subagent (rules, labels, material, layout): `notes/BRIEF.txt`.

**At pause: no subagent running, no emulator running** (checked with `ps`; only the grep itself matched).

## 1. State of MARIOKART64.md

| section | state |
|---|---|
| header, evidence labels, material table | done (draft wording) |
| §0 At a glance | **empty placeholder** |
| §1 ROM identification | done from fs notes; not proofread |
| §2 Boot and code | done; not proofread |
| §3 Filesystem and compression (3.1-3.10) | done; not proofread. Key bytes spot-checked by the lead (course table entries 0/1, zero entry at 0x122780, F3DEX 0.95 string at 0xF4BB0, gCupCourseOrder at 0xF37B4) |
| §4 Courses (list, sidebar, other scenes) | done; not proofread |
| §5 Geometry and render state | done; not proofread |
| §6 Collision | done; not proofread |
| §7 Objects and the kart path | **placeholder** (material: `ob/notes/ob-wip.md`) |
| §8 Environment: sky, fog, clouds, camera | **placeholder** (material: `ob/notes/ob-wip.md`; fog words in `lv/notes/geometry_render.md` §4.2) |
| §9 Music | done from mus notes (9.1-9.8); the game-verification part (§12.4) is not written |
| §10 Version differences | done |
| §11 Mapping onto the viewer | **placeholder** (material: lv notes §6, mus notes §9, collision notes §4, ob-wip proposals) |
| §12 Verification evidence | **placeholder** |
| §13 Open questions | **placeholder** (material: open-question sections of every notes file, §3 below) |
| §14 Unused and hidden content | **placeholder**; the hunt has not started (hints: `lv/notes/unused.md`, `mus/notes/music.md` §12, `ob/notes/ob-wip.md`) |

Nothing has been proofread yet. The spec text is condensed from the subagent notes; when a section needs changing,
re-read the notes it came from. One known inconsistency to settle: the Toad's Turnpike fog colour, (43, 4, 13) in
§5.3/lv notes vs (43, 13, 4) in the decomp (see §3, objects).

## 2. Verified findings not yet in the spec

- **RAM check of Mario Raceway (course 0)** by the lead, with the attract-demo dump `rt/d/demo1_c00_attract.bin` and
  `lv/proto/ramcompare.ts` (output `notes/ramcheck/c00_demo1_attract.txt`): gCurrentCourseId = 0; gSegmentTable
  (0x80150258) physical bases: 2 0x1978D0, 4 0x277730, 5 0x25A5F8, 6 0x1CCDA0, 7 0x270DF8, 9 0x1CCAA0, D 0x19F940,
  F 0x1D65A0; **segments 9, 6, 4, 7, 5 and D in RAM are byte-identical to the decoder's output**; segment 2 differs in 60
  bytes (runtime data); **gCollisionMeshCount = 1291 = decoder, and all 1291 collision records match** (flags, surface,
  vertex, normal). Put this in §12 and upgrade the course-0 labels of §3.4 (RAM placement) and §6.
- **Audio DAC rate**: `rt/audio/session1.log` shows dacrate 1815 = 26807 Hz, as the music notes predicted (already in §9.1).
- **RAM addresses confirmed in the running game** (emulator session; details in `rt/notes/session1.md`): gGamestate
  0x800DC50C; gRaceState 0x800DC510 (read as s32); gModeSelection 0x800DC53C; gCurrentCourseId 0x800DC5A0 (0 in the
  Mario Raceway demo, 8 in Luigi Raceway); gMenuSelection 0x800E86A0 (10 title, 11 game select, 12 player select, 13 map
  select); gSequencePlayers 0x803B1510; gAudioFrameCount 0x803B70B8. From the demo dump: cameras 0x801646F0 (0xB8 each),
  gPlayers 0x800F6990, gCameraZoom 0x80150130 (fov 40), gCourseFarPersp 0x8015014C = 4500, gCourseNearPersp 0x80150150 = 9
  (Mario Raceway).
- **Objects / environment (objects agent, `ob/notes/ob-wip.md`)**, verified on the course-0 demo dump or by disassembly:
  - actor list at RAM 0x8015F9B8 (100 x 0x70); screen structs at 0x8015F480 (+0x28 horizon row, +0x38 path section);
    camera struct 0xB8 with fovY at +0xB4; at rest the camera sits (0, 9.5, 50) behind the kart aiming 70 ahead, fovY 40;
  - every spawn list of all 20 courses located in segment 6 (each address also a code constant); tree ground-snapping
    rule matches 27/27 Mario Raceway trees in RAM (6 lifted onto the ground); item boxes rest at data y + 8.66 (11 match,
    4 were mid-respawn); Mario sign hard-coded positions match;
  - kart path tables: "unknown" paths 0x800DC780 (used only by the award ceremony), track paths 0x800DC8D0, path sizes
    0x800DD9D0; point counts per course, plus the Kalimari train path and the DK ferry path;
  - sky colour tables 0x802B8AD0 / 0x802B8BCC decoded per course; all cloud and star lists; object position tables
    (Thwomps, fire breaths, flag poles, hedgehogs, snowmen, crabs, moles, cheep cheeps); light sets at ROM 0xDD210;
    default fog position 995-1000;
  - near/far per course (disassembly): 2700/2 Bowser's Castle, Banshee Boardwalk, Rainbow Road, Block Fort, Skyscraper;
    1500/2 Choco Mountain, Double Deck; 5000/1 Koopa Troopa Beach; 4800/10 Wario Stadium; 7000/10 Kalimari Desert;
    4500/9 most other race courses; 6800/3 Big Donut, award ceremony, non-race screens;
  - fog: Choco Mountain white, position 995-1000 (multiplier 25600, offset -25344); Toad's Turnpike position 993-1000
    (18285, -18029).
  - Decomp only (not checked in game): sky = two screen-space gradients meeting at a horizon row (Choco Mountain and
    Banshee Boardwalk replace the sky with the fog colour); clouds and stars are 2D sprites placed by camera yaw; vehicle
    start rules; start-grid and intro camera rules. Proposed contract additions: `Level.skyGradient`,
    `Level.screenSprites`, `Instance.billboard`.

## 3. Subagents: what each did, where its work lives (all finished)

| agent | final state | directory | notes / artifacts |
|---|---|---|---|
| filesystem + geometry + collision | complete (offline); screenshot comparison not done | `fs/`, `lv/` | `fs/notes/rom_filesystem.md`, `lv/notes/geometry_render.md`, `lv/notes/collision.md`, `lv/notes/unused.md`; decoder `fs/proto/mk64fs.ts` (API at the top of the fs notes); `fs/proto/extract.ts`, `versiondiff.ts`, `streams.ts`; extracted files `files/us/`; loader prototype `lv/proto/mk64level.ts` + `courses.ts` (draw recipes) + `mk64collision.ts`; `lv/proto/ramcompare.ts`; renders `lv/renders/` (top, corners, start, collision, texture sheets, all 21 courses). Open: Moo Moo Farm / DK inherited texture state, camera-dependent black lists, framebuffer-screen texture indices, collision flags 0x200-0x1000, why the ceremony loads Banshee's segment 6 |
| music | complete offline; game comparison pending | `mus/` | `mus/notes/music.md` (§11 = captures needed); prototype `mus/proto/mk64audio.ts`, `mk64synth.ts`, `render.ts`, checks; WAVs `mus/wav/`; comparison tools `mus/tools/` (compare.ts, raw2wav.py, compare_capture.py, chroma_check.py, rmsprof.py). Open: pitch/tempo/level vs game, final-lap tempo, seq 3 preset 4 vs 5, PAL timing, SFX voice stealing |
| emulator session 1 | stopped at wind-down; emulator stopped and checked | `rt/` | `rt/notes/session1.md` (addresses with sources, menu navigation, timing lessons, next steps), `rt/dumps/index.md`, `rt/audio/session1.raw` (53,958,592 bytes, 26807 Hz, ~503 s emulated) + `.log` + `timeline.txt`, `rt/phase.txt`, `rt/d/demo1_c00_attract.bin`, `rt/shots/`, run dir `rt/run/`, helper scripts `rt/tools/` (headless-audio.sh, dbg.sh, send.sh, tl.sh, dump.sh, vals.py, watch.sh). Captured: boot logo, title (~10 s), attract demos 1 (Mario Raceway 1P) and 2 (Choco Mountain 2P), game select idle ~160 s of menu music (bytes 15,770,368-32,994,560), player select, map select, Luigi Raceway first start shots + ~55 s of race music (to ~53.9M). **Not captured**: grid dumps of all race courses, battle arenas, ceremony, credits, SFX-muted long race captures, title from power-on |
| objects, path, environment, start camera | stopped at wind-down | `ob/` | `ob/notes/ob-wip.md` (findings, verified vs draft, next steps); `ob/proto/`: `romtables.ts/.txt`, `spawns.ts/.txt` + `out/spawns_us.json`, `ramactors.ts`, `ramprobe.ts`, `models.ts/.txt`, `codeconsts.py` + `code_consts.txt`, `otherstreams.txt`, `main_us.dis`. Not started: object-level prototype and renders, start-camera table and screenshot comparisons, Sherbet Land penguin and Rainbow Road sign/chomp position tables, RAM address of the code-object list. Partial: object model naming (`models.txt`; Mario sign, cows, Moo Moo trees, cacti, Luigi's tree, Toad's vehicles unnamed), segment 3 actor textures not compared with RAM. Open: Toad's Turnpike fog colour order (disassemble around racing 0x80296200) |

## 4. Tools and how to run them

- Decode/extract all courses of all five ROMs with size checks: `cd fs/proto && npx tsx extract.ts` (~3 s, "ALL CHECKS OK").
- Render all courses offline: `lv/proto/render.ts` (lv notes §5; uses `/home/n64/.ai-tmp/r49/bm/tools/raster.ts`).
- RAM comparison of geometry and collision: `npx tsx lv/proto/ramcompare.ts <rdram.bin> <courseId>` (stdout).
- Actors/objects in RAM: `ob/proto/ramactors.ts`, `ramprobe.ts`; spawn lists: `ob/proto/spawns.ts`; ROM tables: `romtables.ts`.
- Music: `cd mus/proto && npx tsx render.ts` (all songs, ~50 s) or `--ids 3 --preset 5`; `check.ts`, `scan.ts`,
  `verdiff.ts`, `analyze.ts`; capture comparison `mus/tools/compare.ts CAP.raw RATE START DUR RENDER.wav`;
  `raw2wav.py RAW LOG OUT.wav --start-byte N --dur-sec D` slices the capture.
- Offline rasterizer and comparison: `/home/n64/.ai-tmp/r49/bm/tools/README.md` (renderLevel, autoCameras, sideBySide).
- Public decomp clone: `decomp/` (US build; `include/course.h`, `src/racing/`, `src/audio/`, `courses/*/course_data.c`).
- Leak: `/home/n64/bbgames/mk64` (read-only; iQue/Chinese-localised build tree: `spec`, `map/KTn_*.c`, `include/KTn.h`,
  `audio/kart_sou.*` byte-identical to the US ROM); `leak/kimura/` = its `kimura.lzh` extracted with `7z x`.
- ROM symlinks: `roms/mk64u.z64` (primary), `mk64e10`, `mk64e11`, `mk64j10`, `mk64j11`.

## 5. Emulator recipes that worked (details in `rt/notes/session1.md`)

- Start with audio capture: `M64P_RUN_DIR=/home/n64/.ai-tmp/r49/mk64/rt/run
  M64P_AUDIO_DUMP=/home/n64/.ai-tmp/r49/mk64/rt/audio/sessionN.raw M64P_AUDIO_DUMP_LOG=/home/n64/.ai-tmp/r49/mk64/rt/audio/sessionN.log
  /home/n64/.ai-tmp/r49/mk64/rt/tools/headless-audio.sh --debug /home/n64/.ai-tmp/r49/mk64/roms/mk64u.z64` in the
  background, then `headless-debug.sh 'run'` (with the same M64P_RUN_DIR). Use a new sessionN file per start.
- Stop: `pkill -x -F /home/n64/.ai-tmp/r49/mk64/rt/run/pid mupen64plus`, or `headless-debug.sh quit` when a breakpoint
  has paused it (pkill is ignored while paused).
- The title screen shows only ~10 s emulated before the attract demo (demo 1 Mario Raceway 1P, demo 2 Choco Mountain 2P;
  6 demos per decomp); the title music keeps playing. A RAM dump during demo 1 is a valid in-race course-0 dump.
- gMenuSelection (0x800E86A0) tells which menu is showing (10 title, 11 game select, 12 player select, 13 map select).
- Time Trials has no course flyover: load to race start is ~10 s, too short for 1-second screenshot polling. To dump
  before the countdown, break on a write to gRaceState (0x800DC510) **after** the course has started loading, not before.
- Planned but untried route to battle arenas, ceremony and credits: the hidden debug menu. On the title screen write 2
  to gDebugMenuSelection (0x8018EDEF; reads 1 in retail), then choose the course; Z+A for the ceremony, Z+START or Z+B
  for the credits (gDebugGotoScene 0x8018EDFA). Addresses derived from decomp names, not tested.
- Music-only race capture: clear bit 7 of RAM 0x803B17A0 (flags of gSequencePlayers[2], the SFX player) after the
  course loads (mus notes §11).

## 6. Dead ends and pitfalls

- A write breakpoint on gRaceState set on the pause menu (before RETRY) fired immediately and halted the game; screenshots
  stopped and inputs were not read. Set it only once loading has started.
- `until ! pgrep -f "mk64/rt/run"` matches its own shell command line and never ends; use `pgrep -f "[m]k64/rt/run"`
  or exclude the shell's PID.
- Launching subagents hit the environment's global "concurrent subagent limit (20)" several times early on (other
  investigations running); wait for a completion notification before launching, do not retry in a loop.
- Foreground `sleep N` is blocked by the harness; wait with a bounded `until <condition>; do sleep 10; done` loop.
- The leak's `lha` binary is MIPS; use `7z x`.
- The decomp's `tools/displaylist_packer.c` swaps packed opcodes 0x26/0x27; trust the ROM templates.
- The credits course lists are incomplete; build courses from the per-course draw recipes (lv notes §2-§3).
- J ROMs have different segment-6/9 layouts; the recipe addresses are US/EU only.
- gRaceState must be read as s32 (a u16 read of the high half is always 0).

## 7. Prioritised next steps

1. **Emulator session 2** (fresh subagent, one emulator): per race course a start-grid RAM dump + screenshots + >= 60 s
   music (break on the gRaceState write after loading starts); battle arenas, ceremony and credits via the debug menu;
   Mario Raceway and Toad's Turnpike SFX-muted for >= 160 s with two RAM dumps ~30 s after the music starts (record
   gAudioFrameCount and the audio byte size); title from power-on (>= 70 s after the title music starts, two RAM dumps
   ~10 s in). Index everything in `rt/dumps/index.md` and `rt/audio/timeline.txt`.
2. Run `lv/proto/ramcompare.ts` on every grid dump; record results for §12.
3. Objects / path / environment / start camera: continue from `ob/notes/ob-wip.md` (object-level prototype and renders,
   start-camera table, screenshot comparisons with camera values from the dumps, remaining position tables, model naming,
   Toad's Turnpike fog colour by disassembly); then write §7 and §8.
4. Music verification against the captures (a subagent with `mus/notes/music.md` §11 and `mus/tools/`); write §12.4.
5. Write §11 (mapping and difficulty), §12, §13 and §0; proofread the whole spec.
6. Only then: the unused/hidden content hunt (§14), in a subagent, from the collected hints (lv/mus/ob notes, the leak's
   `kimura.lzh` snapshot, `mkartDiffSource/`, the debug menu and decomp `src/debug/`, unused audio preset 1, Results
   section B, unused packed opcodes, unreferenced lists and textures, the ceremony's Banshee segment 6).
7. Report to the main session: concise summary of formats, difficulty, notable unused content, process hygiene.
