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
 - Agents don't commit, don't restart the user's dev server, and verify with:
   `tsc`, `/home/n64/.ai-tmp/r49/impl/hashall.ts` (other games bit-identical),
   every level loading twice through `structuredClone` with all ArrayBuffers
   transferred (the web worker transfers them), offline renders against the
   research captures (`~/.ai-tmp/r49/bm/tools/raster.ts`, `compare.ts`), and
   in-app checks with Playwright's Chromium from a throwaway script outside the
   repo.
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

# Techniques

## Level loads

N64 games tend to load levels in one go. Breakpoint on the initiation of large
DMAs. This should give you the ROM extent of the level. If you suspect the game
to use compression for its assets, you can set a read breakpoint on the RDRAM
destination of the DMA, or perhaps at +32 in case it has a header which is
never read. This should give you the decompression routine.
