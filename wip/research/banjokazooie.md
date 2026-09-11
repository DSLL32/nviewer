# Banjo-Kazooie (N64, USA V1.0) research — work in progress (paused 2026-09-11)

Resume point for the lead of the Banjo-Kazooie research investigation for the level viewer at `/home/n64/nviewer`
(read-only; procedure: `/home/n64/nviewer/AGENTS.md` "Research investigations", emulator: `EMULATOR.md`). Workspace
`/home/n64/.ai-tmp/r49/banjo/` (`r49` is a symlink to `/home/n64/.ai-tmp/4e5bcc90-63d3-4729-b96c-d3f32b8822ea`).
Deliverable: `BANJOKAZOOIE.md` (assembled from `spec/`). ROM: `/data/software/ai-scratch/Banjo-Kazooie (U) (V1.0) [!].z64`.
User limits: at most 3 subagents at a time (including sub-subagents) and at most one emulator at a time; each emulator
session in a fresh subagent with its own run dir, stopped at the end, with a check that no mupen64plus/headless-*.sh of
ours remains. The harness also refused new subagents twice with "20 concurrent subagents" (session-wide), so launches
can fail even under the user limit — wait for a completion and retry.

## 0. Final state at pause

- **Running:** nothing. All 9 subagents have finished (fs, geo, music, obj, env, geo2, emu1 done; emu2 and unused stopped
  early on the pause). Process check at pause: no mupen64plus or headless-*.sh process with a path under `/r49/banjo/`.
- **Spec:** `BANJOKAZOOIE.md` assembled (1,601 lines), sections 0–10 drafted, §11 missing, nothing proofread (§1).
- **emu2 verified results not yet in the spec** (`notes/emu2.md`, log `emu2/notes/musiclog.txt`, audio
  `emu2/audio/a1.raw` = 731 s s16 BE stereo 21,998 Hz with event times ±0.1 s, captures `emu2/captures/` + `index.tsv`):
  - Song 0x08 (intro musical) is started by a **cutscene spline-path event**, not a code constant:
    `coMusicPlayer_playMusic` called at 0x80342398 in `func_803422D4` (actor path event handler), from the spline update
    loop 0x803437C0; volume 0x4C70; t = 24.64 s (breakpoints; event field meaning = decomp lead).
  - Channel masks at runtime (breakpoint on 0x80250530 + audio times): SM 0x6FFF (169.4 s); MM start pad 0x103F
    (352.3 s); MM near Ticker's Tower (warp exit 0x02) 0x513F (493.5 s); TTC jetty 0x60FF (697.5 s); title attract demo
    cycles 0x513F / 0x103F / 0xB0C0. All match the static table in spec §7.4.
  - File select: mask **0x0200 while Game 1 (the saved file) is highlighted, 0x01FF on Game 2/3 (empty)** — so the spec's
    "0x0200 without a chosen game / 0x01FF with one" wording is probably wrong; the decomp tests the slot index, not
    emptiness (can't be proven with only slot 1 used). Fix §7.4 / music.md accordingly (hypothesis until a second save).
  - Pause music 0x6F on slot 5 (196.0–277.2 s). RAM 0x80383340 (music, music2, flags): MM 0x02/−1/1, TTC 0x05/0x11/1
    (matches the map music table).
  - Captures: file select 0x91 with RDRAM (O4 data for obj; not analysed yet); SM horizon first-person shot with camera and
    sky timer (V1, one usable view; compare with `env/lib/sky.ts` composites); pause totals pages GAME TOTAL and SPIRAL
    MOUNTAIN (R5; other worlds only appear once they have play time); TTC jetty with RDRAM and notes on rail posts (O3
    partial).
  - Pitfalls: `musicSlot_loadTrack` 0x8024F890 fires every frame in TTC (981 hits) — remove it before TTC work;
    0x8024FCE0 in `requests/music.md` is not `musicSlot_setVolume` (the volume setter is **0x8024FD28**); first-person
    view is C-up, and stick up looks down.
  - emu2 not done: TTC underwater (0x0600) and lighthouse crossfade/volume log, a jingle (note/death), horizon views of
    MM/TTC/FP/GV/MMM/RBB/0x75, MM close-ups, pause pages of two worlds, GV animated texture, warps to 0x84/0x73/0x03.
- **unused stream:** see §8 step 2.

## 1. State of BANJOKAZOOIE.md

Built by `python3 spec/assemble.py` (writes `/home/n64/.ai-tmp/r49/banjo/BANJOKAZOOIE.md`; prints missing parts and
unresolved `@@PLACEHOLDER@@`s). Part files in `spec/`, in order: `00_header.md`, `00_glance.md`, `01_rom_fs_levels.md`
(§1–2), `03_levels.md` (§3, includes `maptable.md` and `03b_loading.md`), `04_geometry.md` (§4.1–4.6, 4.10; includes
`04b_env.md` = §4.7–4.9 with `captable.md`), `05_collision.md`, `06_objects.md`, `07_music.md` (includes `songtable.md`),
`08_mapping.md` (includes `08b_mapping_env.md`), `09_evidence.md` (includes `09b_evidence2.md`), `10_open.md` (includes
`10b_open_geo2.md`), `11_unused.md` (not written). `spec/TODO.md` is the lead's running checklist.

**Nothing is proofread yet.** All sections are drafts written from the stream notes; content is believed correct.

| section | state | missing / to do |
|---|---|---|
| header, §0 at a glance | draft | fill `@@GLANCESKY@@`, `@@GLANCEOBJ@@`, `@@GLANCEMUS@@` in `00_glance.md` from emu2 results (or reword) |
| §1 ROM, versions, boot, code | draft, complete | proofread |
| §2 filesystem, compression, text | draft, complete | proofread |
| §3 levels, tables, loading/warp, viewer list | draft, complete | §3.4 "84 unused" claim must be checked against the unused stream / emu2 warp to 0x84 |
| §4 geometry, render state, env, projection, camera | draft, complete incl. geo2 corrections | add emu2 horizon sky comparison (§4.8) and emu2 captures to `captable.md`; GV animated surface (§4.5) |
| §5 collision | draft, complete | proofread |
| §6 objects | draft, complete | emu2 O3 (sprite size / model-prop roll in a close frame) and O4 (file-select 5/3 positions at runtime) → §6.4 |
| §7 music | draft | `@@MUSICRUNTIME@@` (create `07b_music_runtime.md` from emu2's song/mask log and new audio: what starts song 0x08, MM 0x103F→0x513F, TTC 0x60FF/0x0600, file select 0x01FF/0x0200, crossfades) — or delete the placeholder |
| §8 mapping onto the viewer | draft, complete | proofread; numbers (lines, difficulty) consistent with §4/§6/§7 |
| §9 evidence | draft | `@@EVIDENCEEMU2@@` (create `09d_evidence_emu2.md`), `@@HYGIENE2@@` (create `09c_hygiene2.md`: emu2 hygiene line) |
| §10 open questions | draft | `@@OPENMUSIC2@@` (`10c_open_music2.md`), fold in emu2/unused open items; numbering is continuous (geo2 items 9–12) |
| §11 unused and hidden content | **not written** | from `notes/unused.md` (+ emu2 warps to 0x84/0x73/0x03) |

## 2. Verified findings not yet in the spec

- emu1: title-screen attract music is song 0x02; boot logos play 0x32 (+0x0E, 0x4E) and 0x43; the intro musical 0x08
  (in §3.3 already); the gfx task display lists alternate between 0x80080A70 and 0x80087E20 (in notes).
- geo2: per-capture ranking of render-vs-screenshot differences and region statistics (`geo2/out/regionsummary.txt`);
  GV's 10 non-info texture loads are animated-texture frames of model 0x1474 (arithmetic verified).
- env: sky-model table with triangle counts per layer (in §4.8 already); `raster.ts` ignores `Level.clearColor`.
- emu2 and unused results: see §0 above (FINALSTATE) and their notes; not yet merged.

## 3. Open questions and hypotheses

See `spec/10_open.md` (20 items) plus: what starts song 0x08; channel masks at runtime (emu2); sky pixels vs the game
(emu2 horizon captures V1); sprite size/prop roll (O3); file-select object scale at runtime (O4); which GV surface
animates; hardware LOD blending (screenshots are Glide64 HLE — an LLE check would need a different plugin); the one
incompatible stale-tile draw in map 0x6F; the driver of runtime UV/vertex animation; 1,408 unidentified actor ids;
kind-flag-1 node records; lighting-node tinting; unused content (whole §11).

## 4. Streams (subagents), notes and artifacts

All paths under `/home/n64/.ai-tmp/r49/banjo/`. Each stream's spec-section draft is `notes/<stream>.md`; its emulator
requests are `requests/<stream>.md`. Shared brief for subagents: `BRIEF.md` (rules, established facts, leads).

| stream | status | did | notes | artifacts |
|---|---|---|---|---|
| fs | done | ROM id, versions (V1.1/PAL/JP), boot, code segments, rarezip vs `inflate.ts`, asset table, text, map tables, level list, static environment | `notes/fs.md` | `fs/` (`code.py`, `code/<ver>/*.bin` decompressed code, `dis/` disassembly, `levels.tsv`, `tables/`, `text/`, `ts/inflate_check.ts`, `verdiff.py`, `idmap.py`, `classify.py`, `assets/` + `index.tsv`) |
| geo | done | model format, F3DEX 1.21 DLs, textures, render modes, collision, prototype loader, renders of all 128 maps | `notes/geo.md` | `geo/lib/{bkmodel,bkdl,bklevel}.ts`, `geo/scripts/`, `geo/out/renders/`, `closeup/`, `allmaps.tsv` |
| music | done | n_audio engine, banks, 173 sequences, song names/volumes, map music, channel masks, renders, capture comparison | `notes/music.md` | `music/{lib,survey,render,compare}.ts`, `music/out/wav/` (+`index.json`), `out/songlist.tsv`, `tools/callsites.py`, `dis/` |
| obj | done | setup format, ActorInfo tables, props, sprites, collectibles, start positions, renders with objects, RAM checks | `notes/obj.md` | `obj/lib/{setup,resolve,bksprite,bkobjects,exits}.ts`, `obj/scripts/`, `obj/out/{actorinfo,resolve,entrances,cameras}.tsv`, `obj/out/renders/` (`emucmp_*`), `obj/dis/` overlay disassembly |
| env | done | sky drawing, frame order, projection, camera RAM, fog scan, sky composites, capture comparisons | `notes/env.md` | `env/lib/{sky,bkdl_ordered}.ts`, `env/scripts/{framedl.py,framemtx.py,perspcheck.py,fogscan.py,composites.ts,capcompare.ts}`, `env/out/` |
| geo2 | done | render state from RAM frames: dock cutout rule, MMM mist, RAM render-mode tables, stale tile, filter | `notes/geo2.md` | `geo2/scripts/{rdpwalk.py,coverage.py,rmtable.py,framecensus.py,staletile.py,capfix.ts,regionstats.ts}`, `geo2/lib/` (patched prototype, `ctx.rule`), `geo2/out/capfix/` |
| emu1 | done (emulator stopped) | boot, RAM warp, 16 captures with RAM cameras, 475 inflate outputs vs ROM, asset-load and music logs, audio | `notes/emu1.md`, `emu1/notes/procedures.md` | `emu1/captures/*` (+`index.tsv`), `emu1/audio/wav/`, `emu1/tools/`, `emu1/savebackup/game1_sm_after_intro.eep` |
| emu2 | **stopped early** (paused; emulator stopped, pid 1352876 dead) | music song/mask log + audio (M1–M3), horizon sky views (V1), sprite/prop close-ups (O3/O4), pause names (R5), GV animated texture, warps to 0x84/0x73/0x03 | `notes/emu2.md` | `emu2/captures/` (+`index.tsv`), `emu2/audio/a1.raw`, `emu2/notes/musiclog.txt`, `emu2/tools/` |
| unused | **stopped at ~15%** (paused; no emulator run) | §11: stub maps, unreferenced assets/actors/text, debug features, cheats, Stop 'n' Swop, unused songs, version leftovers | `notes/unused.md` | `unused/` |

## 5. Tools and how to run them

- Asset extraction: `python3 tools/extract.py [ROM] [OUTDIR]` → `fs/assets/XXXX.bin` (inflated) + `fs/index.tsv`.
- Code segments: `fs/code.py` (decompresses boot/core1/core2/overlays for all four ROMs into `fs/code/<ver>/`).
- Disassembly: `mips-linux-gnu-objdump -b binary -m mips -EB --adjust-vma=<vram> -D <segment>.text.bin` (see `fs/dis/`,
  `obj/dis/`); core1 vram 0x8023DA20, core2 0x80286F90, overlays 0x803863F0.
- TypeScript prototypes: `cd <dir> && npx tsx scripts/<name>.ts` (static imports only; import viewer modules by absolute
  path read-only). Geometry: `geo/scripts/render.ts`; objects: `obj/scripts/render.ts`; sky composites
  `env/scripts/composites.ts`; capture comparisons `geo2/scripts/capfix.ts <variant>` (variants base/fix/fix_ramxlu …).
- Offline renderer mirroring the viewer: `/home/n64/.ai-tmp/r49/bm/tools/` (`raster.ts renderLevel`, `compare.ts
  sideBySide`, `sheet.ts`; pass `background: [0,0,0]` for BK since raster ignores `clearColor`).
- Music: `cd music && npx tsx render.ts all` (or `id[:mask]`) → `out/wav/`; `npx tsx compare.ts` (capture vs render).
- RAM frame walkers: `env/scripts/framedl.py`, `geo2/scripts/rdpwalk.py` on `emu*/captures/<cap>/rdram.bin`.
- Spec assembly: `python3 spec/assemble.py`.

## 6. Emulator recipes that worked (details: `emu1/notes/procedures.md`, `notes/emu1.md`, `notes/emu2.md`)

- Run dir per session: `M64P_RUN_DIR=/home/n64/.ai-tmp/r49/banjo/<session>/run` on every command; audio with
  `emu1/tools/headless-audio.sh` (copy of the GoldenEye one; env `M64P_AUDIO_DUMP`, `M64P_AUDIO_DUMP_LOG`; raw = s16 BE
  stereo at 21,998 Hz).
- Boot: N64 logo → Rareware logo → Banjo intro → START (title) → START (file select). A new game's intro can't be skipped
  while all files are empty (≈440 × `press A` + `wait 25`, ~9 min). Faster: copy `emu1/savebackup/game1_sm_after_intro.eep`
  into the run dir's `save/` as procedures.md says; cold boot → Spiral Mountain in ~4 min (START, START, A).
- **RAM warp** (debugger core, during normal play): `headless-debug.sh 'pause' 'write 0x8037E8F5 b MAP' 'write
  0x8037E8F6 b EXIT' 'write 0x8037E8F8 b 00' 'write 0x8037E8F4 b 01' 'run'`; 30–60 s later the map runs (check
  `0x803835D4`). Exits: MM 05, TTC 04, CC 05, BGS 02, FP 01, GV 08, MMM 14, RBB 10, CCW lobby 07, CCW spring 01, lair 0x69
  12, Banjo's house 01, file select 00.
- RAM: camera eye 0x80280EB0, pitch/yaw/roll (deg) 0x80280EC0, look 0x80280EA0, fovY/aspect/near/far 0x80275D20..2C,
  player 0x8037C5A0, map 0x803835D4, gfx task 0x80275950 (data_ptr +0x30), sky timer 0x8038242C, map env RGB 0x8038237C.
- Breakpoints: after inflate in `assetcache_get` 0x8033B9E0 (s0 id, [sp+52] buffer); `musicSlot_loadTrack` 0x8024F890;
  `musicSlot_func_8024FC1C` (every start/stop); `musicSlot_stepToChannelMask` 0x80250530; `osSpTaskLoad` 0x8026569C.
  Capture: `dumpmem 0x80000000 0x800000 <abs path ≤ 63 chars>`.

## 7. Dead ends and pitfalls

- `mem /3f ADDR` is not a float format: it read address 0xF and crashed the emulated game. Use `mem /Nw 0x80xxxxxx` only.
- `bp add X 4` breaks twice per call — use size 1; `bp list` is wrong after `bp rm` (the core removes the right one).
- `dumpmem` truncates paths to 63 characters. No save states in the headless build.
- Breakpoints on `assetcache_get` entry and on music slot functions fire every frame in game — remove after the load.
- Camera input must be consumed before pausing (`hold CL 30` + `wait 200`).
- The screenshots are Glide64mk2 HLE (trilinear lists at level 0, no AA): don't treat LOD/edge differences as loader bugs.
- geo's first blend mapping (FULL k4/k5 as blend) was wrong; use geo2's cutout-with-depth rule. geo's merge-by-state
  interpreter reorders triangles; skies need display-list order (`env/lib/bkdl_ordered.ts`).
- The map-model table's s16[3] pairs are grid deltas, not bounds (fs originally assumed bounds).
- Reading CC 0x2D loop-end bytes through the back-reference expander breaks two songs (read them raw, as `cseq.ts` does).
- Decomp asset names can mislead (0x36E "MODEL_EXTRA_LIFE" is a sprite; 0x7CA/0x7CB names swapped) — trust asset types.
- The harness's 20-subagent limit refused two launches; retry only after a completion.

## 8. Prioritised next steps

1. Merge emu2's results (`notes/emu2.md`, summarised in §0 above), including the file-select mask correction: `07b_music_runtime.md`, emu2 rows in `captable.md`, §4.8 horizon sky check,
   §6.4 O3/O4, §2.5 pause-screen names, §4.5 GV animated surface, `09c_hygiene2.md`, `09d_evidence_emu2.md`,
   `10c_open_music2.md`, glance placeholders. Then schedule **emu3** (one emulator, fresh subagent, run dir `emu3/run`,
   starting from emu1's save and warp) for emu2's unfinished items, in this order: TTC underwater mask + lighthouse
   crossfade (log 0x8024FD28, no loadTrack breakpoint in TTC); horizon sky views of MM, TTC, FP, GV, MMM, RBB, 0x75
   (first-person C-up); MM/TTC sprite and sign close-ups (O3); GV animated texture; one jingle; warps to 0x84, 0x73, 0x03
   and, for the unused stream, 0x56/0x50 (U2) and the attract-demo asset log (U1). Optional: geo2's G2-2 (lobby 0x6F
   stale-tile draw).
2. **Unused stream (§11) is ~15% done** — relaunch it (static, no emulator) with `notes/unused.md` as its starting point.
   Verified so far: quiz test string "THIS IS A SLIGHTLY LONGER PIECE OF TEXT FOR THE QUIZ DIALOGS!" at lair .data +0x2410
   (0x803950C0), used by lair code at 0x8038D0F4; sandcastle cheat codes stored scrambled in TTC .data +0xAA0…+0x12D4
   (12 short + ~60 long; `knip68n3664j` = BANJOKAZOOIE by the decomp's letter map, one hand-checked); plain "BANJOKAZOOIE"
   at MMM .data +0xA80 (hypothesis: Tumblar's shed); no debug-menu text in V1.0 (only assert file names such as
   `bsant.c`, `gczoombox.c` and audio trace strings); 85 character names in core2 .data (credits parade, lead); demo
   files 0x9A3–0xA0A: 28 non-empty, `u32 payloadLength (= size − 4)` + 6-byte input records (verified), decomp base
   0x504 doesn't match V1.0 — real base id not found; type-2 assets 0x6FE/0x6FF = 16-byte header + 2,048 bytes (hypothesis
   32×32 RGBA16). Unfinished core: a code scanner for constant ids passed to the asset/dialog/map-change/actor-spawn
   functions + id tables in .data (every "unused" verdict depends on it), full cheat decode and effects, renders (0x73
   objects, unused-model sheet, the two images), dialog/quiz counts, V1.0/V1.1 text diff, Stop 'n' Swop placements.
   Emulator requests (low priority): `requests/unused.md` U1 attract-demo asset log, U2 warps to stubs 0x56/0x50, U3 the
   quiz test string. Then write `spec/11_unused.md` (collect also: 25 stub maps, 0x03 sky + stub masks 0x03/0x54–0x59,
   0x73 setup with 16 objects, 145 unplaced actors, 142 candidate unused models, 14 unreferenced songs).
3. Run `spec/assemble.py` until no placeholder remains; resolve `spec/TODO.md`.
4. Proofread the whole `BANJOKAZOOIE.md` (consistency of numbers across §0/§4/§6/§7/§8, every claim labelled, section
   cross-references, table formatting), then final hygiene check (`pgrep -af mupen64plus; pgrep -af headless-` → nothing
   under `/r49/banjo/`) and report to the main session.
