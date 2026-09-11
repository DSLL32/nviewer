# TWINE research — work in progress (paused 2026-09-11)

Investigation of *007: The World Is Not Enough* (N64, USA `NO7E`; Europe `NO7P` compared) for the nviewer level viewer,
following `/home/n64/nviewer/AGENTS.md` "Research investigations". The repo `/home/n64/nviewer` was only read; nothing
in it was changed. Workspace: `/home/n64/.ai-tmp/r49/twine/` (all paths below relative to it unless absolute).
Deliverable: `WORLDISNOTENOUGH.md`.

## 1. State of WORLDISNOTENOUGH.md

| section | state |
|---|---|
| header / conventions | done; remove the "DRAFT (lead)" line when finished |
| §1 ROM identification, versions (USA vs PAL address table), boot/code | done, proofread |
| §2 filesystem, ROM map, archive, EDL compression, text | done, proofread |
| §3 level list, tables, scene scripts, load chain, front end, warp | done, proofread |
| §4 level geometry (records, transform, D stream, textures, render state, renders vs 9 frames) | done, proofread |
| §5 environment (fog, clear, sky, spin, transitions), space, lighting, start camera | done, proofread (includes emu2 corrections) |
| §6 objects and characters | written from obj/NOTES.md; **not yet proofread** |
| §7 music (MusyX, data, song list with uses/names, loops, reuse of musyx.ts) | written; **capture verification pending** (emu3); not proofread |
| §8 mapping onto src/rom/ with difficulty | written, proofread except the §6-derived lines |
| §9 verification evidence | 9.1–9.5 done; **9.6 music "against the game" row TBD**; **9.7 hygiene TBD** |
| §10 open questions | draft; prune when captures land |
| §11 unused and hidden content | **TBD** — the unused agent was stopped mid-work (see §4 below; `unused/NOTES.md`) |

Section order in the file: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 (fixed).

## 2. Verified findings not yet in the spec
- The objects agent's runtime capture requests (A–G in `obj/NOTES.md` §7) were never run; nothing to add yet.
- **Audio capture (emu3, verified; not yet in §7/§9.6):**
  - Output rate 22047 Hz (AI dacrate 2207), 192-sample buffers; the engine counts at 22050 so capture and render align.
  - Music is exactly mono in both "Mono" and "Stereo" sound modes (L − R = 0).
  - **Song 12 plays on the MGM logo, title, main menu and debriefing** (forcePlaySong at 0x8002EC24 = the state-machine
    case `0x8002EBB8` path) — add "Title / menus" to its name in §7.3. Attract demo 1 (level 34) plays song 8, attract
    demo 2 (Cold Reception) song 17 (level start). Courier intro scene plays song 15 (scene script, ra 0x8000F31C;
    cut by a stop after 8 s). Courier gameplay: no music for 150 s standing still. King's Ransom: song 5 (level start).
    Mission failure plays no jingle (debriefing restarts song 12). Not observed: song 14 at boot, song 3 in Courier.
  - Volume options: Music byte 0x801002F1 (default 6/10 → group 253 = 76), SFX byte 0x801002F0 (group 254). The music
    volume follows musyx.ts's square-law table (76 → 127 = +10.0 dB measured, table 10.1 dB; linear would be 4.5 dB).
  - Gain: at Music 10 the game is +2.09 dB (song 12), +1.57 dB (song 5), +1.8 dB (song 15) above the renders at
    MASTER_GAIN 0.74 → **MASTER_GAIN ≈ 0.92** matches Music 10 (the default setting is that × 0.311).
  - Match: chroma 0.95–0.98 at 0 semitones; waveform correlation song 15 1.000, song 12 up to 0.996, song 5 up to 0.95
    (120 s envelope 0.862) → the keymap/layer/VolSelect patch works for these songs. Song 17 layers not evaluated.
  - Timing: the game runs 0.034 % slower than the render (+768 samples over 2.2 M for song 12, +960 over 2.87 M for
    song 5; cause open). Song 12's loop period in the game = render period + the same drift, seamless → loop points right.
  - Evidence: `emu3/NOTES.md`, `emu3/cap/s1.raw(.log)`, `emu3/cap/s1_songlog.txt`, `emu3/tools/`, `emu3/shots/`.
  - Not done: a level-song loop seam (song 5 or 2), clean song 17 (e.g. in a multiplayer arena with a RAM patch forcing
    the random pick at 0x8007627C / 0x80009ED0 — untested), mission-complete jingle (song 6?).
- **Unused/hidden content (unused agent, stopped early; details, confidence and 11 emulator checks E1–E11 in
  `unused/NOTES.md`). Corrections to the draft spec (verified, high):**
  - Entries/levels **27 and 37 are not unused sets**: both are in the common preload list 0x800C2BDC (137, 494, 493,
    505, 27, 42, 251, 37); 27 = effects model (muzzle flashes, sparks, smoke, bullet holes), 37 = a badge icon. Fix §3.2,
    §8.1 ("other" list), §10 and §2.1.
  - The **three 0x3840-byte blobs at ROM 0x1F282B0 are attract-demo input recordings** (900 frames × 16 bytes), paired
    with levels 34, 25, 1 by 0x80087E74; recorder 0x80087A80. Fix §2.1 and §10 ("end-screen images" is wrong).
  - **Speech table = u32 count (276) + 276 offsets; "MORT" is a 4-byte tag before every clip**; no 0x4D-flagged entries.
    Fix §2.1/§7.1 wording if needed and the §10 item.
  - **Song id 1 is used by scene 6** (the scene dump in `notes/scene_walk_full.txt` stops at 80 commands per scene, so
    my op31 scan missed it; re-scan with `unused/scene_ops.py` / `scene_ops.json`). Fix §7.3 row 5 and re-check the other
    script song starts against the full scan.
- **Unused findings for §11:**
  - Level 8: flat 145×145 arena, crate stacks, perimeter wall, one light, four player starts; no mission, overlay, scene,
    preload, respawns or pickups (verified high; cut arena = hypothesis medium). Render `unused/renders/`.
  - Level 17: island with a domed tower, sea, start on the roof; overlay record 6 empty; loaded by scene 36, which no
    code found plays (medium-high; cut Istanbul/Maiden's Tower set = hypothesis low-medium). Earlier RAM warp showed a
    near-empty map.
  - Demo record mode unreachable (nothing writes 1 to 0x800CEEB1; high).
  - Name-entry swear filter: 45 words shifted +1 in overlay-1 data, checked at 0x80019150 (high).
  - "Cheats Menu", "Cheats", "Development Menu" strings with no menu page; "Invulnerability", "All
    Weapons/Gadgets/Missions", "FPS,Position" not found as menu items (medium: ~95 of 255 text lookups use computed ids).
    A Password Menu page exists ("Code", "Weapon Mode"); how it is reached is untraced.
  - No debug print strings or source paths in code.
  - Skin/mode/map unlock messages used by code 0x8001CB50..0x8001CBA0 (conditions untraced).
  - 159 prop models never placed or referenced (ambulance, school bus, tube train, roulette wheel, test-pattern cube
    404; medium-high never placed, medium unused).
  - Song id 11: no reference anywhere (medium-high). All 667 samples named by some macro. Macro reachability
    inconclusive. Speech clips 272–275 have no dialogue string; clip i ≠ dialogue string i.
  - Unreferenced objectives: "Rescue Christmas undetected.", "Disabling reactor safeties.", "Ejecting Reactor Rod."
    (medium).
  - 0x28-byte tail at 0x54D8E8 = FFFF + zero padding; 16 bytes at 0x1F32B90 never read.
  - Not done: unused animations/textures/meshes, dialogue reference scan, unlock conditions, cutscene-set reachability.
- emu3 (audio capture) and unused results: see §4 of this file (filled in from their final reports).
- Minor: the geometry agent's Midnight Departure black box (record 629) and Istanbul sand-plane sky are noted in §4.6;
  PAL `archsem2.txt` has per-entry diff details not copied into §1.2.

## 3. Key facts for resuming (short)
- ROM copy `twine.z64` (USA). Main code at 0x80000400 = ROM 0x1000; disassembly `main.asm`. Overlays run at 0x80117740
  (table 0x800C2C14); overlay disassemblies `env/ovl/`.
- Archive base 0x54D910, entry table 0x800C0780 (507 entries; 0–41 levels). EDL codec: `fs/edl.py` (Python, verified
  byte-exact vs game), `geo/edl.ts` (TS).
- Level decoder: `geo/twine.ts` (world + fog/clear/sky/camera), `obj/twine.ts` (adds layers, bind-pose characters,
  markers: `decodeLevelLayers`). Render: `geo/render.ts`, `obj/render.ts` via `/home/n64/.ai-tmp/r49/bm/tools/`.
- Music: MusyX v1; prototype `audio/musyx_twine.ts` + `audio/render.ts` (renders in `audio/wav/`).

## 4. Subagents: what each did, where its output lives

| agent (dir) | task | status | notes / artifacts |
|---|---|---|---|
| fs | filesystem, EDL, levels, load chain | done | `fs/NOTES.md`, `fs/extract.py` → `fs/files/`, `fs/edl.py`, `fs/validate_edl.py`, `fs/levels.tsv` |
| emu1 | boot/menus, Courier load trace, EDL dumps, warp | done | `emu1/NOTES.md`, `emu1/trace_courier.tsv`, `emu1/shots/`, `emu1/dumps/` (Courier RDRAM, EDL in/out) |
| audio | MusyX driver/data/songs, musyx.ts patch | done | `audio/NOTES.md`, `audio/musyx_twine.ts(.diff)`, `audio/render.ts`, `audio/wav/`, `audio/songs.json` |
| geo | geometry decode, textures, render state, renders vs frames | done | `geo/NOTES.md` (§8 = frame comparisons), `geo/twine.ts`, `geo/edl.ts`, `geo/renders/`, `geo/framecams.json` |
| env | fog, sky, lighting, start camera, scene scripts | done | `env/NOTES.md`, `env/env.json`, `env/spawns.json`, `env/scene_walk.py`, `env/ovl/`, `notes/scene_walk_full.txt` |
| versions | PAL vs USA | done | `versions/NOTES.md`, `versions/addrmap.json`, `versions/archsem*.txt`, `versions/textdiff.txt` |
| emu2 | frame captures on 8 levels + Courier back view; env/camera/texture checks | done | `emu2/NOTES.md`, `emu2/captures/<level>/{shot,rdram.bin,dl.txt,manifest.json}`, `emu2/dlwalk.py`, `emu2/texcheck/` |
| obj | object types, models, tables, characters, anim bank | done | `obj/NOTES.md`, `obj/types.tsv`, `obj/models.tsv`, `obj/twine.ts`, `obj/renders/`, `obj/scripts/` |
| emu3 | audio capture vs renders | stopped early (wind-down); 841 s captured; emulator stopped | `emu3/NOTES.md`, `emu3/cap/`, `emu3/tools/` (findings in §2 above) |
| unused | unused and hidden content | stopped early (wind-down); no emulator used | `unused/NOTES.md`, `unused/renders/`, scripts `textrefs.py objrefs.py scene_ops.py modelrefs.py storagerefs.py menuitems.py samples_unused.ts render_sets.ts` (findings in §2 above) |

(Final reports of emu3 and unused are appended in §9 of this file.)

## 5. Tools and how to run them
- Disassemble: `mips-linux-gnu-objdump -D -b binary -m mips -EB --adjust-vma=0x80000400 file`; `fs/dis.py START END`.
- Extract everything: `python3 fs/extract.py` (~65 s) → `fs/files/`.
- Validate EDL: `python3 fs/validate_edl.py`.
- Header checksum: `python3 crc.py ROM...` (CIC-6102).
- Level decode/render: `cd geo && npx tsx render.ts ...` (see geo/NOTES.md §4/§8); objects `cd obj && npx tsx render.ts`.
- Type histogram per level: `python3 env/scan_types.py --hist`; scene scripts `python3 env/scene_walk.py --full`.
- Music renders: `cd audio && npx tsx render.ts [--voices N] [--stock] rows…` → `audio/wav/`.
- Offline rasterizer docs: `/home/n64/.ai-tmp/r49/bm/tools/README.md` (renderLevel, sideBySide, writeTextureSheet).
- Frame DL walker: `python3 emu2/dlwalk.py` on a capture's rdram.bin (see emu2/NOTES.md).

## 6. Emulator recipes that worked (each session in its own subagent + run dir; see EMULATOR.md)
- Title → Courier gameplay (normal core): `press START, wait 90` (main menu) → `press A` (mission select) → `press A`
  (difficulty) → `press A` (briefing) → `press A` → rumble prompt `press START` → loading → `press START` skips intro.
- Warp (debugger core, from gameplay or attract demo): `headless-debug.sh 'write 0x80102EDF b <level hex>' 'write
  0x80102EEC w 1' 'run'`; the level runs ~10 s later; **values are hex**. Warps skip intro scenes. Multiplayer arenas:
  also `u32 0x80102ED8 = 1` and `u8 0x801002A4 = <level>` (worked for Castle 0x04).
- Frame capture: exec breakpoint `osSpTaskStartGo` 0x800A223C, OSTask in a0 (type 1 = gfx; data_ptr +0x30), then
  `dumpmem 0x80000000 0x800000 /short/abs/path`.
- EDL decompress: breakpoint 0x80014A0C (a0 dst, a1 src); texture blob join point 0x800420A0.
- ROM reads: exec breakpoint 0x8000B900 (romCopy: a0 dst, a1 ROM offset, a2 len).
- Audio capture tooling: copies of `/home/n64/.ai-tmp/r49/ge/music/tools/` (headless-audio.sh, audio-dump plugin,
  bpmon.py) — see emu3/NOTES.md for what was adapted.

## 7. Dead ends / pitfalls
- Save states are not available with the headless tools; navigate by buttons, then warp.
- Debugger `write` values are hex (`11` = 0x11 loads the near-empty level 17).
- `dumpmem` truncates paths > 63 characters.
- A write watchpoint plus a console `write` to the same byte deadlocks the emulator (needed SIGKILL of own pid).
- Tracer scripts can leave breakpoints set; remove them before continuing.
- Restart from the pause menu re-requests `0x80102EE0` (doesn't warp); after a warp the pause menu wouldn't open.
- Raw byte diff of PAL vs USA archive entries is meaningless (archive-relative offsets shift) — compare decompressed.
- Anim rotation brute force (`obj/scripts/animbrute.py`) found no convention (best 75°): don't repeat without capture A.
- fs notes' table `0x800C3CF8` is really `0x800C3CF4`; env notes' fog word `DB08000C` is really `DB080000`; env notes'
  "eye offset only while swimming" is wrong (0.55 on land).
- The machine-wide subagent cap (20) refused launches twice; the lead ran ≤ 3 subagents at a time.

## 8. Prioritised next steps
1. Put the emu3 audio findings (§2 above) into spec §7.3/§7.5/§9.6 (song 12 = title/menus; rate 22047 mono; gain
   MASTER_GAIN ≈ 0.92; square-law music volume; 0.034 % drift). Optionally a short new audio session for a level-song
   loop seam (song 5 or 2) and clean song 17 (emu3/NOTES.md §9 has the plan).
2. Apply the unused agent's corrections to the spec (entries 27/37 are preloaded common models; the 0x3840 blobs are
   attract-demo recordings; speech table layout; song 1 in scene 6 — re-scan scene song starts with the full
   `unused/scene_ops.json`). Then write §11 from `unused/NOTES.md`; optionally finish the not-done scans and run the
   emulator checks E1–E11 (warps to levels 8 and 17, scene 36, demo record flag, song 11, Password Menu).
3. Optional emulator session for obj capture requests: A (anim rotation convention at 0x800055CC / 0x80004910 in
   Courier), G (helper-plane node lists in Cold Reception and Istanbul); B/C/D/E if cheap. Update §6.5, §10.
4. Proofread §6, §7, §10, §11; remove DRAFT marks; fill §9.7 hygiene (final process check).
5. Report to the main session (formats, difficulty, notable unused content, hygiene).

## 9. Final reports and hygiene
- emu3 and unused sent final reports (summarised in §2 and §4 above); all other subagents had finished earlier.
- Process check at pause: `ps -eo args | grep -E 'mupen64plus|headless-|bpmon' | grep /r49/twine/` → **0 processes**. No
  subagent of this investigation is running.
- `/home/n64/nviewer` was only read.
