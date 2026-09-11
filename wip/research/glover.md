# Glover (N64, USA) research — work in progress (paused)

Paused at the coordinator's request. This file is enough to resume without the lead's conversation. Workspace:
`/home/n64/.ai-tmp/r49/glover/` (all paths below relative to it). The repo `/home/n64/nviewer` was only read, never
changed. Deliverable: `GLOVER.md` (to be copied into the repo by the main session once finished). Process rules from
`/home/n64/nviewer/AGENTS.md` "Research investigations" apply: at most 3 subagents at a time (including sub-subagents),
at most one emulator at a time, each emulator session in a fresh subagent with its own run directory
(`emuN/run`), stopping its emulator and checking for leftover mupen64plus / `headless-*.sh` processes.

ROM: `glover.z64` → `/data/software/ai-scratch/Glover (U) [!].z64` (NGVE, 8 MiB, MD5 87aa5740dff79291ee97832da1f86205).

---------------------------------------------------------------------------------------------------
## 1. State of GLOVER.md (1,030 lines)

No section has had its final proofread yet. Backups of earlier states: `GLOVER.md.bak1`, `GLOVER.md.bak2` (can be deleted
when done).

| section | state |
|---|---|
| header status table | written; music row still says "runtime comparison DRAFT" (now done, see §2) |
| 1 ROM identification | done |
| 2 Boot and code | done |
| 3 Filesystem and compression (ROM map, FLA2, texture/object banks, landscape and record chains, extraction) | done; wave-bank pairing already corrected (music samples 0x4E3EE0, SFX samples 0x607280) |
| 4 Level list (tables, load sequence, 48-level viewer table) | done; on-screen name composition is HYPOTHESIS (never seen a title card) |
| 5 Level format (space/camera, texture banks, object banks/nodes/DLs/face lists, render state, landscape opcodes, rotation, enemies `83`, garibs `86`, platforms, fog/lights, backdrop, water, start camera, objects table, collision) | done; backdrop draw path open (§5.5.3) |
| 6 Music | done statically; §6.1 has two errors to fix (see §2: song master and output rate) |
| 7 Mapping to the viewer | drafted, complete |
| 8 Verification evidence | 8.1 and 8.2 done; **8.3 music still DRAFT** (merge emu4); **8.4 hygiene still DRAFT** (emu1–4 all clean, see §6) |
| 9 Open questions | DRAFT; needs pruning (multi-axis rotation, garib frames, master volume, output rate are resolved) |
| 10 Unused and hidden content | merged from notes/unused.md; cheat button mapping and level-select runtime still marked DRAFT (resolved by emu4, see §2) |

`grep -n DRAFT GLOVER.md` lists the remaining spots.

---------------------------------------------------------------------------------------------------
## 2. Verified findings not yet in GLOVER.md (from emu4, `emu4/notes.md`, captures `emu4/d/`)

1. **Music engine values** (RAM, identical in the menu and in Atlantis 1): `0x802AB04C` = 60, `0x802AB050` = 16666,
   effects master `0x802AB054` = 22518, **songs master `0x802AB056` = 22518** (= the options values at
   `0x801E7658`/`0x801E765A`), **ALSynth output rate `0x802AB30C` = 22047**, song base `0x80290420` = `0x800856B0`,
   current song `0x80290428` (60 menu, 1 Atlantis 1), `0x802AB038` = 24, channel array `0x802AB040` = `0x8002DF30`.
   - **Correction for §6.1:** the `MusSetMasterVolume(2, 20000)` at `0x8011E8D4` belongs to the **level-select scene**
     (it runs every frame there; after it `0x802AB056` read 20000), not to the level loader. In normal play the song master
     is the options value (22518 default). Also replace "output rate 22050 requested" wording with "22050 requested,
     22047 actual (RAM)". The render gain advice (×3–4) may need rechecking at 22518 (renders used 20000).
2. **Player-state comparison:** `music/glover_music.ts verify` on 6 RDRAM dumps: menu song 60 (3 dumps, 34.7 s and 25.7 s
   apart) 210/210 fields equal each; Atlantis 1 song 1 (3 dumps, 55.3 s and 36.3 s apart) 189/189 each
   (`emu4/d/*.verify.txt`). So the libmus port matches the game's channel state exactly.
3. **Song trace** (breakpoint `0x80177A14`): boot 59 (ra `0x8012BD18`), title fly-through 33 (`0x8011DEC0`), menu 60
   (`0x8010FE18`), Atlantis 1 song 1 (`0x8011DEC0`), quit → 60. Attract demos call no song start. No jingle was triggered
   (walking into water, pausing and cheat entry play none).
4. **Cheat input buttons (verified):** C-Up = 1, C-Down = 0, C-Left = 2, C-Right = 3; D-pad, L, R add nothing; Z cleared the
   buffer once. So LEVEL SELECT = C-Up ×3, C-Left, C-Left, C-Right, C-Left, C-Right; entering it set `[0x80297BEC]` bit 23
   (`0x00800000`), closed the pause menu and showed "LEVEL SELECT ON!" (`emu4/d/cheat_levelselect_on_a.png`, `_b.png`);
   the game mode byte stayed 4, and no new entry appeared in the pause or main menu (`cheat_pause3.png`,
   `menu_after_cheat2.png`). Where normal play exposes the level select after the cheat is still unknown.
5. **Level-select scene (verified):** from a clean main menu, `write 0x801E747C w 0` and `write 0x801E7530 b 2` shows the
   SELECT LEVEL list (mode 2 alone only blanks the menu: the scene's setup runs only when `[0x801E747C] == 0`). The list has
   **42 entries in level order, HUB 1 … CAVE, ASSAULT COURSE, ATLANTIS 1 … SPBTWEEN, SPACE BOSS 2, SPACE BONUS**
   (i.e. levels 0–41, not WAYROOM/PRESENT/FLYTHRU/INTRO/OUTRO); it scrolls with the analog stick only
   (`emu4/d/lvlsel_p01.png..p13.png`). Starting a level from it and the song-preview button were not tried.
6. **Attract demos (verified):** the first starts about 35 s after the menu; demo 1 = level 10 with record 10, demo 2 =
   level 16 with record 16 (`emu4/d/demo1_*.png`, `demo2_*.png`); the demo index byte is `0x801E662C`; order by
   disassembly 10, 16, 20, 25, 30, then the presentation.

---------------------------------------------------------------------------------------------------
## 3. Open questions and hypotheses (current)

Levels:
- **Backdrop draw path** (`99`): the parser/update maths is decoded (GLOVER.md §5.5.3) but no G_TEXRECT/SETTIMG in the frame
  lists of HUB 1, Pirates 1, Space 2 references the panorama texels. Needs read breakpoints (next steps).
- Where Glover starts in **boss arenas** (the captures show the boss intro camera); the start camera's facing direction per
  level (camera records `9A..9C`? hoop orientation?).
- **Garib flag 1** (113 records) meaning; garib billboard size.
- Animation (object record `+0x18` keyframe blocks) not decoded: models stand in key 0.
- Platform parenting (`6F`/`A8`), `7F` spin fields, puzzle-driven visibility (doors, hidden platforms, bosses during intros).
- Node sprite fields beyond the texture; face-list flags `+0x1C`; semantics of `9A..9C`, `A1`, `02`, `BD`/`BE`, `C1..C8`,
  puzzle conditions/actions.
- Collision: face lists of root meshes (disassembly); not compared at runtime; surface types unknown.
- Level-table fields `+0x18` (text "95%"), `+0x2C` (save slot), `+0x30` (field C, copied to `0x801EF480`; values verified,
  meaning unknown), `+0x36` (bonus time limit: Atlantis Bonus counted down from 6:00 = 360, consistent).
- How the on-screen level names are composed (world name + LEVEL n / BOSS / BONUS) — never seen on screen.

Music:
- Which events play jingle pair A (`30 + 4w`) vs B (`32 + 4w`); whether `[0x801F1B14]` (reverb 60, volume 55) is underwater.
- BIGROOM reverb and the ramp shape follow libultra / Global Assault behaviour; not compared with captured audio (headless
  emulator has no audio output).
- Render loop seams: the WAVs end exactly at loopEnd; recommend rendering past the loop and looping the second pass.

Unused/hidden:
- SECRET CHEAT developer photos: static only (not seen in game).
- Debug song stepper / record tool trigger `[0x8020B110]` (upper 16 bits) — what fills it (second controller?).
- Tip 14 → tip 32 ("GET 40") selection byte `[0x801EAA55 + slot × 28]` = difficulty?
- Which screen starts FLYTHRU2 (`0x801326B0`); CAVE reached by "level + 1" from HUB 8?
- The Japanese font bank: for an unreleased Japanese version?

---------------------------------------------------------------------------------------------------
## 4. Subagents: what each did, where their notes and artifacts are

All finished; none running.

| worker | scope | notes | artifacts |
|---|---|---|---|
| filesystem (fork) | ROM map, FLA2, bank switches, chains, level/world tables, extractor, CRC names | `notes/fs.md` (its wave-bank pairing in §3.6 is swapped; GLOVER.md is correct) | `fs/extract.py`, `fs/files/` (232 files + `index.json`), `fs/fla2.py`, `fs/fla2.ts`, `fs/fla2_check.ts`, `fs/names.py` (`gcrc`), `fs/names.json`, `fs/banks_switch.json`, `fs/romconst.json`, `fs/switchmap.py` |
| music (fork) | libmus revision, banks, 60 songs, uses, renders, reuse verdict | `notes/music.md` (song master 20000 claim is wrong, see §2) | `music/glover_music.ts`, `music/wav/` (60 WAVs + `index.json`, `unused/`), `song_switch.json`, `level_songs.json`, `static_parse.json`, `stats.jsonl`, `handlers.asm`, `diff/` |
| level format (fork) | texture/object banks, nodes, DLs, face lists, landscape opcode table, environment, collision, PoC | `notes/level.md` §1–11 | `lvl/glover.ts`, `lvl/landscape.ts`, `lvl/level.ts`, `lvl/dl/displaylist.ts` (viewer copy with PROPOSED changes), `lvl/walk4.py`/`walk5.py`/`sizes5.json`, `lvl/gamecam.py`, `lvl/camcmp.ts`, `lvl/all_levels.ts`, `lvl/out/` |
| level follow-up (fork) | enemies/garibs/platforms in PoC, layers, cameras, 10 frame comparisons, garib sprites, backdrop maths, rotation check, node sprites, red line | `notes/level.md` §12 | `lvl/level2.ts`, `lvl/all_levels2.ts`, `lvl/camcmp2.ts`, `lvl/rotram.ts`, `lvl/rects.ts`, `lvl/bdfit.ts`, `lvl/sprnames.ts`, `lvl/nodesprites.ts`, `lvl/inventory.ts`, `lvl/out/cmp/v3_*_cmp.png`, `lvl/out/all2/levels.json` |
| unused/hidden (fork) | unreferenced objects/textures, font bank, photos, cut levels, reachability, debug features, text | `notes/unused.md` | `unused/refscan.py` → `refs.json`, `uobj_list.tsv`, `uobj_montage.png`, `utex_list.tsv`, `utex_<bank>.png`, `tex255740_split.png`, `ck_15/16/17.png`, `zoom_08_FORTRESS_TEX_BANK.png`, `text.txt`, `text_tips.txt`, `text_credits.txt` |
| emu1 | boot → title → menu → hub → assault course load trace; level byte; hub/acourse captures | final report only (summarised in GLOVER.md §8.1) | `emu1/loads.tsv`, `emu1/tracer.py`, `emu1/d/hub.bin/.png`, `acourse.bin/.png`, views, `title.png` |
| emu2 | warp recipe; 8 level loads traced; captures; FLA2 RAM check | final report (in GLOVER.md §8.1) | `emu2/loads.tsv` (501 rows), `emu2/tracer.py`, `emu2/dbg.sh`, `emu2/d/L10_at1 … L38_owboss1 (.bin/.png/_cam1/_cam2)`, `dec_tex03.bin`, `dec_obj13.bin` |
| emu3 | camera-yaw series with dumps | `emu3/captures.tsv` | `emu3/d/hub_y0..7`, `pc1_y0..7`, `pc1_p1/p2`, `at3_y0..3`, `ow2b_y0`, `t_cr1`; `emu3/cap.sh`, `emu3/yaw.sh` |
| emu4 | music engine values + verify, song trace, cheat buttons, level select, attract demos | `emu4/notes.md` | `emu4/d/` (menu1..3, at1_1..3 dumps with `.verify.txt`, cheat/level-select/demo screenshots), `emu4/tracer.py`, `emu4/dbg.sh`, `emu4/send.sh`, `emu4/demos.sh`, `emu4/trace.tsv` |

Lead's own artifacts: `main.asm` (disassembly of ROM 0x1000..0xF6680 at 0x80100000), `main.bin`, `boot.asm`,
`strings_all.txt` (all ROM strings ≥ 6 chars with offsets), `chain_scan.json`, `lvl/enemies83.json`.

---------------------------------------------------------------------------------------------------
## 5. Tools and how to run them

- TypeScript: `/home/n64/nviewer/node_modules/.bin/tsx <script>` (or `npx --prefix /home/n64/nviewer tsx`), run from the
  script's directory (scripts import by relative or absolute path; CommonJS, no top-level await).
- Disassembly: `mips-linux-gnu-objdump -D -b binary -m mips -EB --adjust-vma=0x80100000 main.bin > main.asm`
  (vaddr = ROM − 0x1000 + 0x80100000). The code is unoptimised; string refs are `lui 0x8010/0x8011` + `addiu`.
- Extract all files: `python3 fs/extract.py glover.z64 fs/files`. FLA2 check: `cd fs && tsx fla2_check.ts`.
- CRC name hash: `from names import gcrc` (in `fs/`), `gcrc(b"hoop.ndo") == 0x70210547`.
- Landscape walker (Python): see `lvl/walk5.py` (uses `walk4.walk(data)` with `sizes5.json` and a `V[0xAB]` handler; the
  snippet in `lvl/walk5.py` sets it up) — returns `(ok, [(pos, opcode, argBytes)], endPos)`. TS walker: `lvl/landscape.ts`.
- Level PoC: `lvl/level2.ts` (builder), `cd lvl && tsx all_levels2.ts` (all 48 levels, structuredClone, stats to
  `out/all2/levels.json`), `tsx camcmp2.ts` (game-camera comparisons to `out/cmp/`).
- Game camera from a RAM dump: `python3 lvl/gamecam.py <rdram.bin>` → JSON (eye, fwd, up, fovY, near, far, fog).
- Rotation check: `tsx lvl/rotram.ts <level> <dumps...>`.
- Offline raster/compare: `/home/n64/.ai-tmp/r49/bm/tools/raster.ts` (`renderLevel`), `compare.ts` (`sideBySide`),
  `sheet.ts`, `png.ts` (see its README).
- Music: `cd music && tsx glover_music.ts list | stats | render <id|all> | verify <rdram.bin>`.
- Unused scan: `python3 unused/refscan.py` → `unused/refs.json`.

---------------------------------------------------------------------------------------------------
## 6. Emulator recipes that worked

(`/home/n64/nviewer/EMULATOR.md`; always `M64P_RUN_DIR=<own run dir>`; debugger build `headless.sh --debug` starts paused.)
- **Warp to any level:** once the title is up, `write 0x8010E258 w 240400LL` (LL = level hex; the PRACTICE entry's delay
  slot `li a0, 9`), main menu DD then A (PRACTICE). To change level: re-patch, pause, DD, DD, A, wait ~1 s, A (main menu),
  PRACTICE again. Restore `24040009` at the end. Pick PRACTICE promptly (attract demo after ~30–35 s idle; START returns).
  Quitting from a bonus level doesn't return until its timer runs out.
- **Level byte** `0x801E7531`; world `0x801E7533`; game mode `0x801E7530` (4 in game, 1 menus). Writing the level byte before
  `0x8011D88C` does NOT warp (the function overwrites it at `0x8011D900`).
- **Useful breakpoints:** file load `0x80141DD8` (a0 dest, a1 ROM start, a2 end), FLA2 decompress call `0x80141FE8` /
  return `0x80141FF0`, tex bank `0x8014F510`, obj bank `0x80150EA4`, landscape `0x80152498`, record `0x801526C4`, start level
  `0x8011FF40`, song `0x80177A14`.
- **Camera yaw series:** C-left/C-right turn the camera by a fixed amount per press (5 polls ≈ 45°, uneven); measure the actual
  yaw with `lvl/gamecam.py` on a dump after each press. C-up = first-person look, C-down steps zoom levels.
- **Level select:** from a clean main menu `write 0x801E747C w 0` then `write 0x801E7530 b 2` (analog stick scrolls).
- **Cheats:** pause, then C-buttons: C-Down 0, C-Up 1, C-Left 2, C-Right 3 (e.g. `press CU 3`, `wait 15`). Or set bits in
  `u32 0x80297BEC` directly.
- **Captures:** `pause`; `dumpmem 0x80000000 0x800000 /abs/path.bin` (≤ 63 chars, no spaces); copy the newest
  `run/shots/*` next to it; `run`. Helper scripts: `emu2/tracer.py`, `emu2/dbg.sh`, `emu3/cap.sh`, `emu3/yaw.sh`,
  `emu4/tracer.py`.
- **Stop:** `headless-debug.sh quit` if paused in the debugger, else `pkill -x -F <run>/pid mupen64plus`. Don't use
  `pkill -f` patterns that can match the checking shell itself (emu4 hit its own shell).

---------------------------------------------------------------------------------------------------
## 7. Dead ends to avoid

- Web search: no Glover format documentation exists; everything came from the ROM.
- The FS notes' claim that 0x607280 is the music wave bank is wrong (pairing by wave extents: nosfx.wbk ↔ 0x4E3EE0).
- "Song master = 20000 from the level loader" is wrong (level-select scene only).
- Searching the frame display lists for the backdrop's panorama texels (texture rectangles / SETTIMG) found nothing in three
  levels; the wide texrects in Pirates 1 and Space 2 are a level-independent overlay. Use read breakpoints on the backdrop
  object instead.
- The level worker's early label of `9A`/`83` as "camera" records: `83` is the enemy placement; `9A..9C` follow enemies
  (their role is open).
- The red line near the Atlantis 1 horizon was the start hoop seen edge-on (hide the start hoop).
- Agent launches can fail with "Concurrent subagent limit reached (20)" (harness-wide); retry after one of your own agents
  finishes.
- Writing mode 1 from the level-select state left a black screen; writing mode 2 while an attract demo starts overlays the
  list on the demo with no input (restart the emulator).

---------------------------------------------------------------------------------------------------
## 8. Prioritised next steps

1. **Merge §2 into GLOVER.md:** §6.1 (song master = options value 22518, 20000 only in level select; output rate 22047 actual;
   re-check the playback gain advice), §8.3 (verify 6/6 dumps exact, song trace, engine values), §10 cheat buttons (verified)
   and the level-select runtime result (42 entries, levels 0–41, reached via `0x801E747C = 0` + mode 2; the cheat sets bit 23
   and shows "LEVEL SELECT ON!"), attract demos 10/16 verified, header status table music row, §8.4 hygiene (emu1–4 clean).
2. **One more emulator session (emu5)**, in priority order:
   a. Backdrop draw path in Pirates 1 (level 20): pause; read the backdrop list head `0x8028F350`; read breakpoints (physical
      address) on the first backdrop object's +76 and +72; run one frame; log pc/ra; disassemble the emitter; dump the display
      list range it writes; then fit the mapping against `emu3/d/pc1_y0..7` and `hub_y0..7`.
   b. Boss start: Atlantis Boss (13) after its intro: dump + screenshot; Glover's position vs the start hoop (−321, 64, −318).
   c. Garib flag 1: Carnival 2 (16) facing (−2159, −23, 861): screenshot.
   d. SECRET CHEAT photos: set `0x80297BEC |= 0x00200000`, warp to 19 (patch `24040013`), screenshot; warp again for the other set.
   e. Debug song stepper: `write 0x8020B110 w 00010000`, then `0x8020B10D` / `0x8020B10C` = 1 with a breakpoint on `0x80177A14`;
      write breakpoint on physical `0x0020B110` to find its source.
   f. Where the LEVEL SELECT cheat exposes the list in normal play (pause/main menu handlers `0x80114368..0x80114388`,
      `0x8011A900`); starting a level from the list.
   g. A jingle (breakpoint `0x80177A14` while collecting a garib group or losing a life), the third attract demo, tip 14 vs
      difficulty (`[0x801EAA55 + slot × 28]`), FLYTHRU2's trigger (`0x801326B0`).
3. **Update §9** (remove resolved items; add what emu5 leaves open) and fold results of emu5 into §5.5.3, §5.5.5, §5.4.3, §10.
4. **Proofread GLOVER.md end to end:** consistency of numbers (48 levels, 60 songs, 345 enemies, 1,507 garibs, 31
   backdrops, 76 FLA2 streams), labels on every claim, cross-references, typos; delete the `.bak` files.
5. Report to the coordinator: formats, difficulty, notable unused content, process hygiene.
