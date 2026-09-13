# AGENTS.md

 - Use `~/.ai-tmp/{some-session-id}` as scratch rather than `/tmp`
 - mips-elf gcc/binutils is installed if necessary 
 - mupen64plus is available, see `EMULATOR.md`. Dispatch the emulator in a
   subagent with a concrete task or result, so as not to waste your context. Do
   not leave emulators running when they are no longer needed.

# Research investigations

When asked to investigate a game (ROM formats for the viewer):

 - Run it as a background lead agent. The lead may read this repo but must not
   change it; it works in `~/.ai-tmp/r49/<game>/`. It may spawn subagents,
   within any concurrency limit the user sets.
 - Every emulator session runs in a fresh subagent with its own run directory;
   it stops the emulator and checks that no mupen64plus or `headless-*.sh`
   process is left.
 - At most one emulator session may be live per game investigation, including
   sessions launched by nested agents. Emulator tasks run serially, with
   process cleanup verified before the next session starts.
 - Deliverable: `<GAME>.md`, structured like the existing specs (`STARFOX.md`,
   `GOLDENEYE.md`, `ZELDA64.md`): ROM identification and versions, filesystem
   and compression, level list, geometry and textures, environment (fog, sky,
   camera), objects, music (every game gets a music player: driver, song list,
   loops), mapping onto `src/rom/` with difficulty, verification evidence, open
   questions. Label every claim verified (and how: ROM bytes, disassembly, RAM,
   frames, audio) or hypothesis.
 - Unless told otherwise, finish the spec first, then surface unused and hidden
   content (cut levels, debug features, unreferenced assets, text, music) in
   its own section.
 - The lead reports only when the spec is proofread and every subagent has
   finished. The main session then copies the spec into the repo, commits it,
   relays the findings and checks for leftover processes.

# Implementing a game

 - The main session orchestrates and commits; loaders, music and frontend work
   go to subagents (frontend work always in its own subagent). Give each agent
   the files it owns; shared files (`types.ts`, `index.ts`, `displaylist.ts`,
   `texture.ts`, `libultra.ts`) get one owner at a time, and contract fields in
   `types.ts` are added by the main session.
 - Agents don't commit, don't restart the user's dev server, and verify with the
   checking scripts in `tools/` (see README.md; ROMs come from `$NVIEWER_ROMS`):
   - `npm run typecheck`;
   - `npm run check:hashes` — every level of every game hashed; compare against a
     baseline from a worktree of HEAD (`tsx tools/hashall.ts --src <worktree>`)
     to show the other games are bit-identical;
   - `npm run check:transfer` — every level loaded twice through
     `structuredClone` with all ArrayBuffers transferred, as the web worker does;
   - `npm run check:layers` — the layer rule below;
   - offline renders against the research captures with `tools/render/`
     (`raster.ts`, `compare.ts`, `sheet.ts`);
   - in-app checks with Playwright's Chromium from a throwaway script outside the
     repo.
 - Every drawn instance belongs to a layer so the user can toggle it: the level
   geometry (`main`, or rooms in a `rooms` group), objects, backdrops and so on,
   plus a hidden-by-default `collision` layer. The viewer always draws instances
   that are in no layer and gives them no checkbox of their own (only a generic
   "other geometry" fallback). Verify with
   `npm run check:layers [-- <rom name filter>]`: every level, exit code 0.
 - The main session commits each piece separately, staging only that agent's
   files (or hunks), checks the commit in a clean `git worktree` of HEAD
   (tsc + level loads), and keeps README.md and the game's spec up to date,
   correcting the spec where implementation proves it wrong.
 - Bug reports from the app's Copy button go to the agent that owns the code,
   with the copy text verbatim; fix the class of bug (scan every level), not
   just the reported spot.

# Viewer bug reports

The viewer's Report button (dev server only) writes reports to `reports/` in the
repo root (or `$NVIEWER_REPORTS_DIR`), ignored by git:
 - `NNNN.view.png` (the view), `NNNN.highlight.png` (with the selected face or
   object highlighted; identical for whole-view reports), `NNNN.json`
   (description, kind, copy text, game, level, exact camera, canvas and aspect
   rectangle, layers, toggles). A report is complete once `NNNN.json` exists;
   `.serial` holds the last number.
 - The main session watches the folder. For each new report: look at both
   images and the JSON, route it verbatim (paths to all three files) to the
   agent that owns the code (the game's loader agent, or the frontend agent),
   and have it fix the class of bug, not just the spot.
 - When the fix is committed, write `NNNN.done` containing the commit hash and a
   one-line note (or "no change needed: <reason>"). Never delete reports.

# Scratch directories

`~/.ai-tmp/r49` is a symlink to `~/.ai-tmp/4e5bcc90-63d3-4729-b96c-d3f32b8822ea`;
either path works. Each research directory holds the lead's working copy of the
spec (the repo copy is authoritative once committed), extracted files, notes,
tools, emulator run directories and captures.

Implemented (spec in the repo):

| Game | Research | Other |
|---|---|---|
| San Francisco Rush 2049, Rush 1 | `r49/` root files (`rush.z64`, `rush1.z64`, disassembly, probe scripts), `files/` (2049 filesystem), `r1files/` (Rush 1), `sheets/`, `sheets2/`, `sheets_r1/` (texture sheets), `e1/`..`e5/` (emulator sessions: DMA traces, frames, audio), `music1/`, `music2049/`, `dbg/`, `dbg2/` | collision: `~/.ai-tmp/rushcol/` |
| Bomberman 64, Second Attack, Hero | `r49/bm/` | collision: `~/.ai-tmp/bmcol/` |
| BattleTanx, Global Assault | `r49/btx/` | collision and layers: `~/.ai-tmp/btxcol/` |
| Gex 64, Gex 3 | `r49/gex/` | collision: `~/.ai-tmp/gexcoll/` |
| Yoshi's Story | `r49/ys/` | |
| Star Fox 64 | `r49/sf/` | |
| GoldenEye 007 | `r49/ge/` (unused content in `ge/unused/`, including the Citadel stan decoder) | |
| Off Road Challenge | `r49/offroad/` | |
| Air Boarder 64 | `r49/airboarder64/` | |
| Perfect Dark | `r49/pd/` | |
| Pokémon Snap | `r49/snap/` | |
| Zelda 64 (OoT, MM, 1997 alpha) | `r49/zelda/` (alpha in `zelda/alpha/`) | |

Research complete (spec in the repo, implementation pending):

| Game | Research |
|---|---|
| Pilotwings 64 | `r49/pilotwings/` |

Research in progress (spec not yet in the repo):

| Game | Research |
|---|---|
| The World Is Not Enough | `r49/twine/` |
| Banjo-Kazooie | `r49/banjo/` |
| Glover | `r49/glover/` |
| Mario Party (J) | `r49/mparty/` |
| Mario Kart 64 | `r49/mk64/` |
| Spider-Man | `r49/spiderman/` |
| Stunt Racer 64 | `r49/stuntracer64/` |

Shared:
 - `r49/impl/`: per-agent check directories (`ge_core`, `pd_obj`, `zelda_mus`,
   `fe_*` …) and the clean-worktree scripts in `impl/ge/`. The checking scripts
   themselves now live in the repo under `tools/`; the copies here are historical.
 - `r49/bm/tools/`: where the offline renderer came from, now `tools/render/`.
 - `r49/pw/`: the Playwright install used for in-app checks.
 - `r49/fe/`, `r49/buildtest/`, `r49/headrom/`: early frontend screenshots, a
   build output and an old copy of `src/rom`.
 - `r49/yoshicol/`: abandoned (Yoshi's Story collision gaps, not pursued).

New research goes in `r49/<game>/`; add it to this list when it starts, and move
it to the implemented table when its loader lands.

# Techniques

## Level loads

N64 games tend to load levels in one go. Breakpoint on the initiation of large
DMAs. This should give you the ROM extent of the level. If you suspect the game
to use compression for its assets, you can set a read breakpoint on the RDRAM
destination of the DMA, or perhaps at +32 in case it has a header which is
never read. This should give you the decompression routine.
