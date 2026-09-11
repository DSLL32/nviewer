# Pokémon Snap (N64, US) research: work in progress

Paused on the coordinator's instruction. This file lets the research resume without the conversation. Everything lives under `/home/n64/.ai-tmp/r49/snap/`. The repo `/home/n64/nviewer` was only read; nothing was changed or committed there.

The task (from the user, via the coordinator): follow the "Research investigations" section of `/home/n64/nviewer/AGENTS.md` and `EMULATOR.md`. The deliverable is `POKEMONSNAP.md` (US ROM `/data/software/ai-scratch/Pokemon Snap (U) [!].z64`, md5 fc3c9329b7cdd67cf7650abf63b9a580). Constraints:
- at most 3 subagents at a time, and at most one emulator at a time;
- each emulator session in a fresh subagent with its own run directory, stopped at the end, with a check for leftover processes;
- every claim labelled verified (and how) or hypothesis;
- an unused and hidden content section after the rest of the spec is done;
- report only once the spec is proofread and every subagent has finished.

## 1. State of POKEMONSNAP.md

| section | state |
|---|---|
| header, evidence labels, research-material table | done, proofread |
| §0 At a glance | done and proofread, except the last row ("unused and hidden") |
| §1 ROM identification (9 dumps) | done, proofread |
| §2 Boot, overlays, scenes, position dependence | done, proofread |
| §3 VPK0 | done, proofread |
| §4 ROM map, names, level list | done, proofread |
| §5 Level format (WorldSetup, blocks, display lists, materials, render state, projection) | done, proofread, runtime corrections applied |
| §6 Environment, rail path, camera | done, proofread, runtime corrections applied |
| §7 Objects | done, proofread, runtime checks applied |
| §8 Collision | done, proofread |
| §9 Music | done, proofread |
| §10 Mapping onto the viewer | done, proofread |
| §11 Verification evidence 11.1-11.5 | done, proofread. **§11.6 "Emulator hygiene" is missing**: add the runs listed in §5 below plus the final lead check |
| §12 Open questions | done, proofread; update with the unused pass's findings |
| §13 Unused and hidden content | **not written**: placeholder only; waits for `notes/unused.md` |

Not yet done: §13, the §0 unused row, §11.6, a final proofread of those additions, and the final report to the coordinator. Patch scripts used for bulk edits: `patch_rt.py` (runtime corrections), `patch_pr1.py` (proofreading). They assert unique anchors; don't re-run them, since they have already been applied.

## 2. Verified findings not yet in the spec

- **ROM 0xAE0510-0xAEFC10 is preset photo save data** (from the unused pass, `notes/unused.md`, `un/photos2.py` → `un/photos.json`; **verified** by struct decode and disassembly, high confidence):
  - 4 gallery photos and 60 album photos from Beach, Tunnel and Volcano, with no comments.
  - Only the Snap Station build reads it: its save-init function copies the block into the save. The US build has no read, so the block is dead there.
  - It is byte-identical in the A/E/F/G/I/S dumps, which contradicts fs.md's "E differs"; J lacks it.
  - Hypothesis: the kiosk's "ready-made" pictures.
- **The VPK0 blob at ROM 0xAAA610 is a dead anti-piracy check** (**verified**, high):
  - Decompressed (`fs/vpk0_py/AAA610.bin`), it tests bytes 0x801FFFF0/F4 and writes 0x801FFFF8.
  - A loader in app_level would decompress it to 0x80200000 and set the illegal-copy save flag, but no call or pointer to that loader exists.
  - A live inline copy of the same check runs in volcano_code.
  - The flag's effect on the save is **decomp** only.
- **Debug:**
  - The crash screen is live (its thread starts in main), gated by the button sequence Z+L+R / Up / A+Left / B+Right / Down (the sequence is **decomp**).
  - The performance meter, the hang watchdog and the custom crash-print functions have no callers.
  - Two debug stubs are called, with names like "blockModelCreate()" and "animalAdd()" (**verified**, call scan).
- **Japanese (EUC-JP) text left in US** (**verified** bytes; on-screen use unverified): an album prompt in `window`; album and report photo-detail labels (a score panel with "sensor on/off" and A/B/C grades); the text of scene 24, a Japanese-text photo slideshow reached from the gallery. List: `un/jp_strings.txt`.
- **Other resolved items** (**verified**):
  - the 111 volcano_assets 0x80280xxx words are pixels of a 16×32 RGBA32 3-frame flame texture (`un/png/volcano_rgba32_8012C2D0_frames.png`);
  - J `cave_assets` differs in only 53 words, all in the Cave opening rail camera script (a scale reset, a 30→29 frame key);
  - E drops 80 bytes of an unreferenced palette-like region in cave_assets;
  - the 86 unselected music-bank instruments share all their samples with used ones;
  - the second reverb preset is unreachable (the game only selects type 6).
- **Objects:**
  - 1003 and 1006 are spawned by code (**verified**).
  - 1005 (Beach) and 1036 (Valley) have no geometry, HD entry, spawn record or literal id load anywhere: maybe cut controllers (medium).
  - Beach fx sprite sets 0 and 3 are named by no script header; unused is a hypothesis (medium; `un/png/fx_beach_set0.png`, `fx_beach_set3.png`).
- **Runtime extras in `notes/runtime.md` not spelled out in the spec:**
  - `gtlFrameCounter` 0x80040CF4, `gtlDrawnFrameCounter` 0x80040CF8;
  - `D_800F5C50[index]` stores the last visibility command;
  - the main-menu opening uses a second fog word (256, −512 → 1500/2000) for its sprite pass, with its 3D camera at fovy 29.9, near 47, far ≈12800;
  - the Lab loads an unused perspective camera (fovy 32.9);
  - the Rainbow Cloud eye bobs vertically while the cart stays at the origin;
  - Butterfree was already on its path at the Beach start (pathParam 0.9125 at frame 304).
- **Repo note:** `lv/proto` imports `buildLevel`/`fogPosition` from the repo's `src/rom/bomberman/common.ts`. Other sessions have been changing the repo (Bomberman collision commit; uncommitted Perfect Dark/startView changes), so re-running the `lv/` prototype may break if that file changes. Copies of the lv prototype that `obj/` uses are in `obj/proto/lvcopy/`.

## 3. Open questions and hypotheses

The full list is POKEMONSNAP.md §12. The most important:
- (answered by the unused pass: 0xAE0510 is Snap Station preset photo data; 0xAAA610 is a dead anti-piracy check. POKEMONSNAP.md §3, §4.1 and §12.1 still say "unknown" and must be updated);
- the roles of scene 24 (`unk_end_level_8`) and `unk_segment_AA18E0` (Snap Station printing is a hypothesis);
- which credits variant goes with which completion flag; which of songs 11 and 36 is the first ending;
- (answered: the 0x80280xxx words are flame texture pixels; J `cave_assets` differs only in the Cave opening rail camera script, 53 words);
- whether US can reach scene 24 (the Japanese photo slideshow): who calls the gallery setter;
- what the illegal-copy save flag does;
- the Cave camera's extra +40 during the shaft drop;
- Rainbow Cloud's intro camera animation (`D_8011B3E0`) is not decoded;
- the opening's 3D landscape (display lists inside `main_menu_vpk0`) is not decoded;
- names of props 1004-1036; whether 601 is Articuno's egg; spawn Y for Beach Meowth and Valley Magikarp;
- the names of songs 15, 18-21, 24 and 26 are context hypotheses; song 28's 1.5 s loop has not been heard.

## 4. Subagents and their artifacts

| topic | state | notes | artifacts |
|---|---|---|---|
| ROM, code, overlays, VPK0, ROM map, names | finished | `notes/fs.md` | `fs/` (romid, ovltables, callsites, reloc, romrefs, entropy); `fs/proto/vpk0.ts`, `fs/proto/snapfs.ts` + tests; `fs/vpk0_py/*.bin` |
| world geometry, render state, environment, rail, collision | finished | `notes/levels.md` | `lv/proto/` (rom, anim, gfx, heightmap, course, main, check_ground), `lv/paths/*.json`, `lv/dumps/*.json`, `lv/renders/` |
| objects (spawns, def tables, models, paths) | finished | `notes/objects.md` | `obj/proto/` (defs, spawns, models, modelgfx, build_all, course_objects, hdtable, pathcheck…), `obj/tables/`, `obj/renders/` |
| music | finished | `notes/music.md` | `mus/proto/snapmusic.ts`, `render_all.ts`, `stats.ts`; `mus/wav/`; `mus/cap/` (capture + RAM dumps); `mus/compare.py`; `mus/tools/` (audio-dump tooling) |
| runtime (emulator) | finished | `notes/runtime.md` | `rt/cap.py`, `dbg.py`, `course.sh`, `scene.sh`, `loadlog.py`, `dlwalk2.py`, `segcmp.py`, `objcheck.py`, `vischeck.py`, `ts/ramcam.ts`, `ts/matcmp.ts`; `rt/d/*.bin` dumps; `rt/dl/*.txt`; `rt/cmp/*.png`; `shots/` + `shots/index.md` |
| unused and hidden content | **wound down on request**: tasks 3 and 4 mostly done; 1, 2, 5, 6, 7 partial (see §8) | `notes/unused.md` (sections marked done/partial/not started) | `un/` (`photos2.py`, `photos.json`, `dbgcalls.py`, `romrefs_all.py`, `strrefs.py`, `strrefs.txt`, `jp_strings.txt`, `fxbanks.py`, `bankwaves.py`, `png/`) |

The decomp clone is `decomp/` (github ethteck/pokemonsnap at 1978bb5, read-only).

## 5. Tools and how to run them

- **fs:** `cd fs/proto && npx tsx test.ts` (VPK0, ALL OK) and `npx tsx test_snapfs.ts` (all 9 dumps).
- **Levels:** `cd lv/proto && npx tsx main.ts [course]` → `lv/renders`, `lv/paths`, `lv/dumps`; `npx tsx check_ground.ts`.
- **Objects:** `cd obj/proto && npx tsx build_all.ts [course] [--rest] [--no-png]`, then `npx tsx course_objects.ts [course]`.
- **Music:** `cd mus/proto && npx tsx render_all.ts` (37 WAVs); compare with `PYTHONPATH=mus/pylib python3 mus/compare.py`.
- **Runtime:** `rt/course.sh`, `rt/scene.sh` (restart + warp + capture); walker `python3 rt/dlwalk2.py`; `npx tsx rt/ts/ramcam.ts`.
- **Offline renderer:** `/home/n64/.ai-tmp/r49/bm/tools/raster.ts`, `compare.ts` (`sideBySide`), `sheet.ts`, `png.ts` (README there).
- **Python:** no pyyaml system-wide (agents parsed splat.yaml by hand); numpy is in `mus/pylib`.

## 6. Emulator recipes that worked

Read `/home/n64/nviewer/EMULATOR.md`. Always set `M64P_RUN_DIR` to a per-agent run directory under this workspace, run one instance at a time, and stop it with `pkill -x -F <run>/pid mupen64plus` or `headless-debug.sh quit`.
- **Warp to any scene** (debug core): break at **0x8009B570** in the scene-manager loop, read sp, write the scene id to `[sp+0x2C]`, continue. The debugger cannot set registers. Courses 0-6 and the Lab (11) load straight from boot, with no save or unlock.
- **Scene ids:** 0 Beach, 1 Tunnel, 2 Volcano, 3 River, 4 Cave, 5 Valley, 6 Rainbow Cloud, 8 menu, 9 camera check, 11/13 Lab, 12 album, 14 report, 15 photo check, 17-20 credits, 21 attract demo, 22/23 gallery, 24 print progress. **Don't use 7, 10 or 16: they hang.**
- **Movement start:** exec breakpoint `Movement_Update` 0x800E3D04. It first runs at gtl frame 302 with moveTime 0.
- **Frame display list:** break on `osSpTaskStartGo` 0x80032E8C (task type 1), dump RDRAM, walk the list with `rt/dlwalk2.py`.
- **Loader log:** `dmaLoadOverlay` 0x80002B64, `dmaReadRom` 0x80002C20, `dmaReadVPK0` 0x8000350C.
- **RAM:**
  - `gMovementState` 0x80366BA4; `CurrentWorldBlock` 0x800E6AD0; `GlobalTimer` 0x800E6AEC; `worldBlocks[]` 0x800F5A08;
  - `gMainCamera` 0x80382C30 (+0x20 fovy); `CameraEyePos`/`AtPos` 0x803AE410/0x803AE420;
  - Pokémon GObj link 3 at 0x8004A9F4; Lights1 0x800AEBD0;
  - `auBGMSongId` → 0x800943D0; `auGlobalSoundVolume` 0x800423D8 (write 0 to mute sound effects).
- **Audio capture:** `mus/tools/headless-audio.sh` (audio-dump plugin) → raw big-endian s16 stereo at 32006 Hz; see `notes/music.md` §5.
- **Booting through the menus:** music.md §5 describes new game → name entry → Lab → Beach (tutorial).

## 7. Dead ends and pitfalls

- `bp add ADDR 4 8` covers ADDR..ADDR+4 and also breaks on the next instruction; use size 1.
- `bp rm 0xADDR` removed the wrong entries; remove by index.
- RDRAM write watches (e.g. `bp add 0x00366BA4 4 4`) stalled the core; use execution breakpoints.
- Setting `v1` for a warp is impossible: write the stack slot instead.
- The decomp enum `PokemonID_ARTICUNO = 147` is wrong (147 is Dratini); `lv/pokemon_ids.json` inherits the error.
- levels.md's fog list address 0x800AEA88 / ROM 0x5A438 is command [1]; the list starts at 0x800AEA80 / ROM 0x5A430.
- levels.md's "fovy 60" is only the initial camera value: play uses 55.
- splat calls the music bank "bank1" and the SFX bank "bank2", which is the reverse of the game's settings struct naming.
- `displaylist.ts` as-is mis-binds HAL's texture commands (SETTILE before LOADBLOCK, tile masks), lacks G_MODIFYVTX and uses 0x20 light spacing. Use the prototypes' normalisers (`lv/proto/gfx.ts`, `obj/proto/modelgfx.ts`).
- The machine-wide cap of 20 concurrent subagents refused launches several times; retry only after an agent finishes.

## 8. Unused-content pass (wound down)

Stopped at a safe point on the coordinator's instruction. It never started an emulator (`un/run-un` was never created); its own check at 21:52 UTC showed nothing referencing `r49/snap/un`. The Cutting Room Floor was not consulted, so no community leads were checked.

Unfinished, in its notes' order:
- whether US can reach scene 24 (who calls the gallery setter that sets `D_801EA1FC`);
- a scan for unreferenced display lists and textures in the level asset and `*_extra` segments;
- unused sound effects in the 400-sound bank (ids never passed to `auPlaySound*` or sound tables);
- which Pikachu animations show the balloon and surfboard nodes;
- rendering a preset photo from 0xAE0510 (re-render through the photo scene code path, or the objects prototype at the stored camera);
- what the illegal-copy flag does to the save;
- the main-menu VPK0 content (the opening landscape);
- the E/J fx sprite differences.

## 9. Prioritised next steps

1. Finish the unused and hidden content pass from `notes/unused.md`, resuming at the unfinished items in §8. Optionally check community leads (TCRF) and verify each against ROM bytes.
2. Write POKEMONSNAP.md §13 and the §0 unused row from `notes/unused.md`. Correct §3 (0xAAA610 row: a dead anti-piracy check), §4.1 (0xAE0510 row: Snap Station preset photos), §1.1/§12.1 (E does not differ in 0xAE0510; the J cave difference is a camera script), and §12 (remove the answered questions).
3. Add §11.6 emulator hygiene: runs in `mus/run-mus` (stopped with pkill -F, checked) and `rt/run-rt` (stopped with quit, checked); the unused pass ran no emulator; add the lead's final `pgrep` check (at pause time: none from `r49/snap`).
4. Proofread the additions, then report to the coordinator: formats, difficulty, notable unused content, hygiene.
5. Optional depth: decode the opening's landscape in `main_menu_vpk0` (DObj trees, a possible extra level) and Rainbow Cloud's intro camera; check the Butterfree path over time and Tunnel props 1012/1013 in RAM.
