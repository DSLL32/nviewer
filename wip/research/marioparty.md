# Mario Party (J) research: work in progress (paused)

Paused on the coordinator's instruction on 2026-09-11. This file is written so the investigation can resume without the
original conversation. Workspace: `/home/n64/.ai-tmp/r49/mparty/`. Deliverable: `MARIOPARTY.md` (same directory).
Rules as before: `/home/n64/nviewer` is read-only; at most 3 subagents at a time (including emulator sessions), at most one
emulator at a time, each emulator session in a fresh subagent with its own run directory that stops its emulator and checks
for leftover `mupen64plus` / `headless-*.sh` processes; follow the "Research investigations" section of
`/home/n64/nviewer/AGENTS.md`.

Start by reading `notes/00_facts.md` (the shared fact sheet given to every subagent), then this file, then `MARIOPARTY.md`.

## 1. State of MARIOPARTY.md (896 lines, not proofread yet)

| section | state |
|---|---|
| header, evidence labels, material table | done (draft wording; §0 "At a glance" not written yet: write it last) |
| 1 ROM identification (J/U/E) | done, draft |
| 2 Boot and code, overlays, overlay classification, key J functions | done, draft |
| 3 ROM map, mainfs, LZSS (reuse of `bomberman/codecs.ts lzss1kDecode` verified on all 2274 files), file formats, HVQ FS | done, draft |
| 4 Text: string tables, J encoding, names (boards, places, 58 mini-games) | done, draft |
| 5 Levels: kinds, boards/maps table, arenas, hub | done, draft; §5.3 needs the final level list from g_scenes |
| 6.1 board definition + space graph | done, draft |
| 6.2 FORM, 6.3 render state, 6.4 arena assembly | done, draft; 6.4 needs g_scenes placements |
| 6.5 HVQ 2.0 codec + how the game shows it | done, draft |
| 6.6 board camera, spaces, objects | done except the static board prop list (TODO marker, from g_scenes) |
| 6.7 collision (MAP1) | done, draft |
| 7 Environment | 7.1 fog and 7.2 camera statics written; TODO markers for emulator captures (fog/clear colours, start cameras, lights). The board lights and camera are known (see §2 below) but not yet written in |
| 8 Music | done from static work; TODO marker for audio-capture results (gain, parser verdict, reverb) |
| 9 Mapping | done except scenes.ts details and arena start cameras (TODO markers) |
| 10 Open questions | **not written** (TODO) |
| 11 Unused and hidden | 11.1-11.6 written; TODO for emulator findings and g_scenes unused FORMs; jukebox placeholder visibility TODO |
| 12 Verification evidence | **not written** (TODO) |

`grep -n TODO MARIOPARTY.md` lists every open marker.

## 2. Verified findings not yet in the spec

- **Board lights** (e1_emu RAM, all boards seen): 24 bytes at *(0x800EBF88) = `78 78 78 00 78 78 78 00 00 00 64 00 | 40 40 60 00 40 40 60 00 dc 24 6c 00`; probably two libultra Light structs {col, colc, s8 dir}: grey 120 dir (0, 0, 100), and (64, 64, 96) dir (−36, 36, 108). Interpretation not verified. Fog off on boards (0x800EDDE8 = 0).
- **Board music events** (e1_emu breakpoints): board opening event 4 plays song 0x2B (A43 "Where Have the Stars Gone"); the turn loop (event 2) plays the board theme (DK 0x08, Peach 0x09, Yoshi 0x0A). The debug menu plays 0x09.
- **Fast scene access recipe** (e1_emu): break at 0x8005E414, write the overlay index to u32 0x800EFE54 (0x83 = debug mini-game menu), run. Script: `e1_emu/tools/boot_to.sh`. See §6.
- **HVQ threads**: 0x8004A214 is the entry of HVQ thread 100 (created at 0x8004A334) and calls the decoder; the "HVQDecode" name in a_code notes is that thread entry (f_hvq §2 has the full map). The spec's §2.1 table still calls 0x8004A214 HVQDecode: fix during proofreading.
- **Spec correction to apply:** §2.1 key functions list says "HVQDecode 0x8004A214"; the decoder entry is `Decode` 0x8007ECBC, init 0x8007F230.
- **Scene API** (g_scenes, verified by disassembly and by e1_emu's `mg_skate` / `mg_bumper` RDRAM dumps; `notes/g_scenes.md` §1):
  - model slot table at *(0x800F1FCC), 128 slots × 0xC0 bytes; ModelPos / ModelRot / ModelScale J 0x800256C8 / 0x80025714 / 0x80025760; attribute bit 4 hides a model; a clone function exists;
  - lights set by 0x80023378 / 0x800233E8 / 0x80023434: record 0 = ambient colour, light 1 always takes the material diffuse colour, lights 2..n keep scene colours; default grey 64 with one light along +z (reconcile with the board light bytes above);
  - clear colour setter 0x8002883C; fog colour blue argument resolved (see g_scenes notes);
  - camera omOutView 0x8005E6E8: eye = Center + CZoom · (sin ry · cos rx, −sin rx, cos ry · cos rx), target = Center (also verified in RAM);
  - board pieces come from MBModelCreate with a type table at 0x800C3AB0; `g_scenes/board_props.txt` lists each board's resting pieces (Koopa, Bowser, Toad, Boo, star, DK's boulder, Wario's cannons, the volcano) with the space they sit on.
- **Emulator checks of arenas:** Skateboard Scamper and Bumper Balls: slots, camera, lights and clear colour match; slot positions of Skateboard Scamper equal the static scan; renders line up with the frames (`g_scenes/renders/cmp_*.png`). All other arenas are offline renders only.
- **Arena facts:** 2D mini-games not worth listing: overlays 3, 13, 37, 41, 46. Handcar Havoc's ground is a scaled lava plane (40/7) and every piece is loaded twice (split screen). Bobsled Run places every section at the origin itself (so identity is right). Mushroom Village comes from a placement table in overlay 105. Platform Peril's layout is random (unlisted until a RAM dump). Code-placed props in about ten arenas and Teetering Towers' middle sections are still missing; the opening's camera and pieces are unknown; light directions are assumed world-space (hypothesis).
- **Level list proposal:** `notes/g_scenes.md` §7 (groups from the overlay 111 category byte: 1-Player / 4-Player / 2 vs 2 / 1 vs 3, naming a hypothesis). The overlay 111 table's record i is mini-game id i + 1 (the spec §2.2 already says so; a_code.md says i, which is wrong).
- **Unused FORMs:** 130 with no code or data reference (`g_scenes/unused_forms.txt`): Paddle Battle river variants, 3D Slot Car Derby tracks, a 3D Hot Rope Jump room, Treasure Divers coral and a ship, among others. To go into spec §11.4.
- **Spec corrections from g_scenes:** §6.4 says Bobsled Run sections overlap because they are "placed by code"; the code actually places them all at the origin. §6.4 calls Handcar Havoc's ground "probably a 2D backdrop"; it is the scaled lava plane 40/7.
- e1_emu's final report is summarised in its §4 row and the verified-results block below the table.

## 3. Open questions and hypotheses (to become spec §10)

Filesystem / code
- Record fields of the overlay 111 mini-game table after the overlay index (category meaning, image/string ids): hypothesis.
- Why the E ROM has an extra overlay (E index 112): hypothesis language select.
- Unreferenced mainfs files: 1659 without constant references, mostly computed ids (dirs 1-6, 16); true leftovers unknown. Dir 16 (578 64×64 images) loader not found (needs a DataRead log in the emulator).
- 33 unidentified mainfs files (header 0x1B etc.).
- Bowser's Tug o' War (mini-game id 58) is in neither the debug-menu nor the overlay 111 table: which overlay plays it?

Boards
- Unresolved links: Yoshi Thwomp gates (72, 77) and tails 75/78; Bowser roulette merges (73/75/77); Wario cannons (tails 90/94/103/107); Luigi doors (tails 99-102); Mario tails 4/60; DK tail 7; Eternal Star tails 53, 89-92; island mini-game nodes.
- DK spaces 128/132 change type 0 → 1 at run time: meaning unknown. Luigi's 15 spaces with flags 0x8000: hypothesis door-controlled.
- Island/Stadium/training board cameras: strong hypothesis (same code path, offline alignment) but not RAM-verified. Mario is RAM-verified by e1_emu (fovY 17 logged, while the bg 47 metadata says 16: resolve).
- Static board props: `g_scenes/board_props.txt` names each board's resting pieces and the space they sit on (static); still to confirm in the game (h_boards §7.3) and to build into the board levels.
- Space texture set 1 (8×8 icons): hypothesis map view.

Geometry / environment
- Translucency alpha sense: textured translucent faces use diffuse alpha as opacity, untextured/IA faces use 255 − alpha in the code; which the viewer should follow needs a frame comparison (c_geom E4).
- RGB24 bitmaps turned grey by the loader, 64×64 RGBA32 bitmaps drawn as 16×16: code reading, not seen in game (c_geom E5).
- Mini-game start cameras (eye/target are runtime), clear colours, per-scene lights: need emulator captures (c_geom E2/E3).
- Code-placed courses (Bobsled Run 48/*, Handcar Havoc 67/*): placement tables (g_scenes).
- MAP1 grid origin (hypothesis: model minimum X/Z) and attribute meanings.

Music
- Gain (51 songs clip at gain 1; SA used 0.75): needs capture.
- Parser choice for A9 (Bomberman parser repeats a one-shot track; cseq.ts breaks A2's drone): capture decides.
- Mini-game reverb preset table index (overlay number vs mini-game id).
- Win/lose meaning of end jingles A50-A55, A60; A65 played anywhere outside the jukebox?
- The four "きけなくなります" titles = A22, A23, A45, A46 by string order (hypothesis); are they shown in the jukebox?
- Table A stub slots 1, 20, 40, 41, 44 = former places of table B songs (hypothesis).

Text / unused
- Meaning of disabled debug-menu dev names (cut mini-games): interpretation only.
- Where J displays the English board logos (10/360-377, "KOOPA'S").
- 64DD error images (dir 17): unused leftovers (hypothesis).
- HVQ backgrounds without reference (4, 14, 23, 33, 36, 44, 53, 61, 64, 66, 72, 74, 103): computed index or unused.

## 4. Subagents: what each did, where the notes and artifacts are

All notes are in `notes/`; each agent's scripts and outputs are in its own directory.

| id | status | topic | notes | key artifacts |
|---|---|---|---|---|
| (lead) | paused | fact sheet, extraction, spec | `notes/00_facts.md`, this file | `tools/extract_mainfs.py` → `files/mainfs/DD/FFFF.bin` + `index.tsv`, `files/ovl/NNN.bin` + `index.tsv`; `lead_music/probe.ts` (music reuse probe), `lead_music/lzcheck.ts` (LZSS reuse check); `ext/` clones (PartyPlanner64 `pp64`, US decomp `mp1decomp`, `mpcomp`) |
| a_code | finished | ROM id, code layout, overlays, filesystems, board graphs, unused hints | `notes/a_code.md` (Appendix A overlay table, B dir table) | `a_code/romlib.py`, `fnmap.py`→`fnmap_J.tsv` (US→J function map), `jalscan.py`→`jalcalls_J.tsv`, `ovlscan.py`→`ovlscan_J.tsv`, `fsclass.py`→`fsclass_J.tsv`, `regions.py`, `rommap.py`, `boardevents.py`, `boardgraph.py`→`boards/*.json`, `unref.py`→`unref_J.txt`, `dis.sh`, `spacetex/` |
| b_text | finished | J text encoding, fonts, names, leftover text | `notes/b_text.md` | `b_text/decode_strings.py`, `strings_{j,u,e_en,e_de,e_fr}.txt`, `align_j_u.tsv`, `names_table.tsv`, `names_places.tsv`, `debug_menu_122.tsv`, `ascii_scan.tsv`, `png/` (font sheets, logos) |
| c_geom | finished | FORM format, render state, environment statics, collision, prototype decoder | `notes/c_geom.md` | `c_geom/form.ts` (parser + buildLevel), `verify.ts`→`verify.txt`, `render.ts`, `loads.tsv` (all constant model loads), `env_calls.txt` (fog/camera calls), `gbi.py` (F3DEX2 decoder), `main.dis`, `renders/` |
| d_music | finished | driver, two song tables, song list, loops, reuse verdict | `notes/d_music.md` | `d_music/seqinfo.ts`, `renderall.ts`, `cseqcmp.ts`, `musicsites.py`→`musicsites.txt`, `songs.tsv`, `wav/` (20 renders) |
| f_hvq | finished | HVQ 2.0 decoder (byte-exact vs RAM), background display, unused backgrounds | `notes/f_hvq.md` | `f_hvq/hvq.ts`, `run.ts`, `dir11.ts`, `ramcheck.py`, `align.ts`, `project.ts`, `out/` (all 105 backgrounds, contact sheet, comparisons) |
| h_boards | finished | board level prototype (15 maps), camera/units, space drawing, presentation | `notes/h_boards.md` | `h_boards/boards.ts` (buildBoardLevel), `render.ts`, `ramcheck_spaces.ts`, `ramcheck_props.ts`, `out/` (contact sheet, emulator comparisons, ground-plane experiments) |
| e1_emu | **finished (stopped at a safe point)**; emulator and helpers stopped, process check clean. Goals 1-2 done (scene access; all 8 boards), goal 3 partial (Bumper Balls, Skateboard Scamper, Bobsled Run, Desert Dash captured with frames, RDRAM dumps, camera args, lights, fog on/off, song; fog is ON in Bobsled Run and Desert Dash, colour not read; Knock Block Tower frame), goals 4-5 partial (no title / hub / text / jukebox shots; audio: board songs ~30-55 s each for all 8 per e1, Bumper Balls 25 s, Desert Dash ~110 s, board opening and intro songs, all logged in `audio/songlog.txt`; e2_audio found only ~11 s stretches of A8 in `cap1.raw`, so check the log before relying on it). Not done: Mini-Game Island (114), Stadium (127), Key-pa-Way, Piranha's Pursuit, Bumper Ball Maze (ready: `e1_emu/tools/all_direct.sh keypaway:44 piranha:49 bbmaze:52`), title/hub (`e1_emu/tools/title_hub.sh`, written, never run). GwSystem is at 0x800EDA18 | emulator session 1: scene access, board screenshots, RDRAM dumps, cameras, lights, songs, two mini-game starts | `notes/e1_emu.md` | `e1_emu/shots/` (dk_overview_toad, dk_turn_dump, peach_turn3, mg_knockblock_ovl32, mg_bumper_start, mg_skate_start, …), `e1_emu/ram/` (dk_overview, dk_turn, dk_spaces, peach_turn, peach_turn3, peach_spaces, mg_bumper, mg_skate), `e1_emu/audio/` (cap1.raw, cap_peach.raw, songlog.txt), `camlog.txt`, `e1_emu/tools/`, run dir `e1_emu/run` |

e1_emu verified results (RAM, breakpoints, frames; not yet in the spec):
- All 8 boards: RAM spaces = board def × 5 (DK 134, Peach 87, Yoshi 79, Wario 108, Luigi 119, Mario 64, Bowser 82, Eternal Star 100); type differences are only star candidates (5 → 1) and the chosen star (Yoshi 76: 0 → 5). Camera slot 0 = bg metadata × 5 with fovY 17, near 1000, far 20000 on all 8. Eyes/targets: DK and Wario eye (−27.58, 8900.85, 6775.35), Wario target (0, 0, −250); Peach, Yoshi, Bowser, Eternal Star eye (0, 9000, 7000) → 0; Luigi eye (−27.58, 7725.85, 7055.35) → (0, 0, 380); Mario eye (0, 8350, 6410) → (0, 0, −90). (Spec §6.6 says Mario's fov is 16 from the bg metadata; e1 logged 17: check in proofreading.)
- Board music: opening (event 4) 0x2B, except Eternal Star 0x30; turn loop (event 2) 0x08..0x0F in board order. Board intro overlay 98 plays 0x3A then 0x11 before Bowser's board, and 0x39, 0x3A, 0x11, 0x12 before Eternal Star. The debug menu plays 0x09.
- Overlay 71 runs between every player's turn on DK (turn hand-over scene, bg 2).
- Knock Block Tower launched from the debug menu: omOvlCallEx(0x20, 0, 0x94), no instructions overlay, music 0x1E, then 0x34 at the end.
- Bumper Balls (overlay 30) start: guPerspective(20, 4/3, 80, 8000), guLookAt(eye (0, 1589.758, 2404.144), at (0, 0, −140), up (0, 0.848, −0.530)) = omOutView orbit camera CRot.x 328°, CZoom 3000, Center (0, 0, −140); full-screen viewport; lights *(0x800EBF88) = `2c 2c 40 00 2c 2c 40 00 00 00 64 00 … 60 60 10 00 60 60 10 00 49 3b 49`; fog off; music 0x1B.
- Skateboard Scamper (overlay 22) start: orbit camera CRot (325, 150, 0), CZoom 1000, Center (−225, 525, 9400) → eye (184.6, 1098.6, 8690.6); guPerspective(20, 4/3, 80, 8000); lights `ff ff ff 00 ff ff ff 00 00 00 64 … 40 40 60 … 40 40 60 … bb 45 45`; fog off; music 0x21.
| g_scenes | **finished (stopped at a safe point)**; no emulator, no processes | mini-game/hub scene composition, placements, cameras, prototype levels (59 levels build and pass the clone test), board props, level list | `notes/g_scenes.md` (§1 scene API, §6 boards, §7 level list, §9 capture requests) | `g_scenes/scenes.json` (overlays 0-52, hub 105, opening 97, staff roll 99, debug room 112; every value with its source pc), `make_scenes.py`, `levels.ts`, `renders/contact_sheet.png`, `renders/cmp_skateboard_scamper.png`, `renders/cmp_bumper_balls.png`, `board_props.txt`, `unused_forms.txt` |
| e2_audio | **finished (stopped in preparation)**: never started an emulator, no captures; process check clean; `e2_audio/` directory was never created | emulator session 2: audio captures to verify music | `notes/e2_audio.md` (plan for the next audio session) | none. Findings: output rate 32006 Hz (AI_DACRATE 1520, from e1_emu's audio-dump logs); gain = 1/√(render RMS / capture RMS); e1_emu's `audio/cap1.raw` has only ~11 s stretches of A8 (from byte 27987744), `cap_peach.raw` ~55 s of A9 (from byte 9194056, too short for the 85 s second-pass test); the mini-game reverb index can only be settled by reading s16 0x800ECA36 at Hammer Drop (overlay 27 → overlay numbering, 55 → id − 1), reached through the debug menu (a direct overlay jump skips the preset calculation). Plan: capture from the Option House jukebox (overlay 110): A8, B1, A26, A9 ≥ 90 s, A2, A12, A65 |


## 5. Tools and how to run them

- Extraction: `python3 tools/extract_mainfs.py` (J ROM path default) → `files/`.
- Offline rasterizer (mirrors the viewer): `/home/n64/.ai-tmp/r49/bm/tools/` (`raster.ts renderLevel`, `png.ts`, `sheet.ts`, `compare.ts sideBySide`; README.md). Run TS with `npx tsx script.ts` from any directory; import repo modules by absolute path (read-only use). It has no Backdrop support: h_boards/render.ts composites the picture itself.
- FORM renders: `npx tsx c_geom/render.ts <out> dir/file[@flags] … [--fog n,f,r,g,b] [--persp fov,n,f] [--eye x,y,z --target x,y,z] [--views top,corner_px_pz,game]`.
- HVQ: `npx tsx f_hvq/run.ts [bg…|all]` → `f_hvq/out/bg_NNN.png`.
- Boards: `npx tsx h_boards/render.ts` (builds all 15 levels, clone test, comparisons, contact sheet).
- Music: `npx tsx d_music/renderall.ts` (all 88 songs with the repo's `bomberman/music.ts` + `music/libultra.ts`).
- Disassembly: `a_code/dis.sh <J RAM> <n>`; `mips-linux-gnu-objdump -b binary -m mips -EB --adjust-vma=0x80000400` on ROM 0x1000..0xCCF00 (main), overlays at 0x800F5A30.
- Function names: `a_code/fnmap_J.tsv` (US decomp names mapped to J addresses).
- Text: `python3 b_text/decode_strings.py` (importable `load_table`, `decode`).
- Audio capture tools (other investigation, reusable): `/home/n64/.ai-tmp/r49/ge/music/tools/headless-audio.sh` (headless.sh with an audio dump plugin: env `M64P_AUDIO_DUMP`, `M64P_AUDIO_DUMP_LOG`), `raw2wav.py`, `rmsprof.py`, `findstart.py`, `chroma_check.py`, `compare_capture.py`.

## 6. Emulator recipes that worked (from e1_emu; details in notes/e1_emu.md)

- Start with the debugger: `M64P_RUN_DIR=<own run dir> ~/mupen64plus/headless.sh --debug '/data/software/ai-scratch/Mario Party (J) [!].z64'` (background), then `headless-debug.sh 'run'`.
- **Jump to any overlay:** break at 0x8005E414 (object-manager main loop, before OvlLoad), `write` u32 0x800EFE54 = overlay index, `run`. 0x83 opens the debug mini-game menu (which lists every mini-game, the boards MB01-MB08, stadium, island, staff roll). Script `e1_emu/tools/boot_to.sh`.
- Camera: breakpoints 0x8001D528 / 0x8001D56C catch guPerspective / guLookAt arguments; camera slot 0 at *(0x800C2870) (eye +0, target +0xC, up +0x18, fov/near/far +0x40..0x48).
- Board RAM: spaces array *(0x800D75B8) (32 bytes per space), count u16 0x800D75B0; HVQ scroll s16 0x800D5BE2/E4; tile cache 0x800D5BF0 (40 × 0x14).
- Current overlay u32 0x800EFE54; current song s16 0x800C50D6; sndplayer state 0x800CCF80 block (see d_music §9.1).
- RDRAM dumps: `dumpmem 0x80000000 0x800000 /abs/path.bin` (≤ 63-char names, no spaces).
- Stop: `pkill -x -F <run dir>/pid mupen64plus` (or `headless-debug.sh quit` when paused).
- **Jump details** (e1_emu notes): at the 0x8005E414 break (jal OvlLoad; the delay slot loads a0 from 0x800EFE54) also write the overlay to history slot 0x800F2C48, remove the breakpoint, run. The debug menu appears within ~1 s emulated.
- **Mini-games boot directly:** `e1_emu/tools/boot_to.sh <overlay>` (e.g. 30) starts that mini-game at once with 4 Mario players (zeroed player data = character 0), CPU or idle, with its music. No debug menu or player setup is needed for arenas. At the end the game returns to the logos (history slot 0 = boot entry).
- **Debug menu (overlay 131):** D-pad right = next page, D-pad down = next entry, A = select. Entries 72..79 = MB01..MB08 (boards): MB01 → character screen → A → board intro (overlay 98, Koopa) → A presses → overlay 53 → board overlay 54 (event 4). Blank entries and page changes make counting presses unreliable: check the cursor on screen (e1 landed on entry 40 instead of 38).
- **Board flow seen:** board overlay → omOvlGotoEx(53, 1, 0x92) → hub 53 → omOvlCallEx(71, 0, 0x92) (a DK-specific ~10 s scene between every player's turn, using bg 2) → back to 53 → omOvlCallEx(54, 2, 0x92) → board event 2 (turn loop, board theme restarts).
- **Audio dump while running:** e1 used `/home/n64/.ai-tmp/r49/ge/music/tools/headless-audio.sh` with `M64P_AUDIO_DUMP` / `M64P_AUDIO_DUMP_LOG` and `e1_emu/tools/bpmon.py` to log music/overlay calls against the dump offset (`e1_emu/audio/songlog.txt`, `cap1.raw`, `cap_peach.raw`).
- **e1 helper tools** (`e1_emu/tools/`): `d.sh` (debugger wrapper), `s.sh` (input wrapper), `waitbp.sh`, `bpmon.py`, `camread.py`, `camhit.py`, `spacecmp.py` (RAM spaces vs board def).
- **Debugger bug:** ui-console's `bp rm` shifts its list wrongly unless the last breakpoint is removed; remove by index, highest first.
- **More debugger pitfalls** (e1_emu final report): breakpoint sizes are inclusive, so use size 0 for a single address. Commands sent before `PC at 0xA4000040` appears in `debug.log` fail silently. Save states can't be used: the console only loads a state at startup.
- **Board timing:** reaching a board's turn loop through the debug menu takes about 2-3 minutes emulated per board (`e1_emu/tools/go_board.sh`, `board_menu.sh`, `all_boards.sh`, `board_capture.py`). Mini-games reached by direct jump were tested on overlays 30, 22, 29, 39 (`direct_mg.sh`, `all_direct.sh`, `mg_capture.py`; camera logs `mgcam_*.txt`).
- **RDRAM dumps available** (`e1_emu/ram/`, 8 MiB from 0x80000000): `dk_overview`, `dk_turn`, `peach_turn3` (background on screen), `peach_turn` (black fade); space arrays `{dk,peach,yoshi,wario,luigi,mario,bowser,eternal}_spaces`; mini-game starts `mg_bumper`, `mg_skate`, `mg_bobsled`, `mg_desert`.
- The "FB READ ALWAYS / MOTION…" text at the bottom of some frames is the glide64 plugin's on-screen message, not the game.

## 7. Dead ends to avoid

- PartyPlanner64's board parser reads the space type as u8 @3, swaps y/z and ignores the ×5 load scale; its HVQ.ts returns black ("FIXME"). Use a_code §5.2 and f_hvq instead.
- PP64's FORM "global indices" are STRG name indices; mesh Xforms, FAC1 tail bytes, MAT1 f32/u16 and HBINMODE are never read by the game.
- "T3 at ROM 0x1767560" was a false magic hit inside sample data; other "S2"/"T3" hits past the real blobs are also false.
- Magic string scans for "S2"/"B1" as separate blobs: B1 lives inside S2.
- The FORM `cam_int1_*` points are exporter leftovers, not game cameras.
- Board ground-plane projection of the HVQ picture: tested, flattens scenery; keep the locked camera + backdrop (h_boards §5).
- Unreferenced-file counts from constant scans overstate unused content (computed ids).
- The main bss is 0x800CC300..0x800F5A30 (an early fact sheet value 0x800DC300 was wrong).

## 8. Prioritised next steps

1. Collect the final notes of g_scenes (`notes/g_scenes.md`), e1_emu (`notes/e1_emu.md`), e2_audio (`notes/e2_audio.md`); fold them into the spec (§5.3 level list, §6.4 placements, §6.6 board props, §7 captures, §8 capture results, §11 findings).
2. Emulator session(s), one at a time, fresh subagent each:
   a. Audio (d_music §9 requests; e2_audio's prompt/notes): gain from A8 and B1 captures, A9 second pass, Engine Room reverb preset, jukebox list, mini-game preset index.
   b. Visual extras (e1_emu already captured Bumper Balls, Skateboard Scamper, Bobsled Run, Desert Dash and all 8 boards): run `e1_emu/tools/all_direct.sh keypaway:44 piranha:49 bbmaze:52` (plus Paddle Battle 51) for start cameras, lights, clear colour and fog colour (read FogOn args; fog is on in Bobsled Run and Desert Dash); translucency frame (c_geom E4); hub building RGB24 grey and 16×16 fallback (E5) with `e1_emu/tools/title_hub.sh`; Mini-Game Island 114/116, Stadium 127 and training 62 frames + dumps (h_boards §7.1-7.2); board prop LoadFormFile log (h_boards §7.3); b_text §7 text screenshots; f_hvq §7 background loads; RAM slot dumps for code-placed arena props and Platform Peril's random layout (g_scenes §9); DK spaces 128/132 type writes.
   c. Offline, no emulator: fold e1_emu's `mg_*.bin` model slot tables into `g_scenes/make_scenes.py` (g_scenes' suggested next tool); combine `h_boards/boards.ts` with `g_scenes/board_props.txt` for board props.
3. Write spec §10 (open questions: start from §3 of this file) and §12 (verification evidence: per claim, the files listed in each agent's notes), then §0 At a glance.
4. Proofread the whole spec (consistency of ids: mini-game ids are 1-based in §4.3; overlay 111 table records are 0-based; fix the 0x8004A214 naming in §2.1), and remove all TODO markers.
5. Report to the coordinator with the summary (formats, difficulty, unused content, process hygiene).
