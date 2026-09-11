# Orchestration: state at wind-down (2026-09-11)

The main session coordinates agents and commits. This note records where
everything stood when the user paused all agents, so work can resume without the
conversation.

## Committed and done

- **Games:** all supported games are implemented and listed on the landing page:
  Rush 2049 and Rush 1, the three Bomberman games, BattleTanx and Global Assault,
  Gex 64 and Gex 3, Yoshi's Story, Star Fox 64, GoldenEye, Perfect Dark, Zelda 64
  (OoT, MM, debug ROMs) and the 1997 OoT alpha.
- **Collision:** every game except Star Fox 64 (excluded by the user) has a hidden
  collision layer.
- **Layer completeness:** every drawn instance is in a layer.
  `~/.ai-tmp/r49/impl/layeraudit.ts` passes over every level of all 16 ROMs.
  - The viewer shows an "other geometry" toggle as a fallback (45b2740).
  - BattleTanx layers by kind (6bb6f03).
  - Rule in AGENTS.md (d2f761e).
- **UI:**
  - Help popup sections are collapsible and collapsed by default (4a7cd46).
  - Wireframe overlays: f for meshes, Shift+F for collision (63902c3).
  - Cutaway (X), room actions, camera persistence across hot reloads.
  - Report button: dev server only, writes `reports/`.
- **Reports:** 0001–0003 are fixed, with `.done` files.
- **AGENTS.md:** procedures for research, implementation and bug reports, plus
  the scratch directory list.

## In flight at wind-down

- **GoldenEye Citadel collision:** committed as dcabac1. The old float stan
  format is decoded into the hidden collision layer for "Citadel (unused)".
  - Checks passed:
    - tsc in a clean worktree;
    - hashall (other games identical);
    - only GoldenEye level 32 changed;
    - structuredClone loads;
    - layeraudit reports collision in 33/33.
  - Not done: an in-app screenshot. The offline top view doesn't show collision
    on the hub and outer ring, probably because roofs cover them in that view;
    check it in the app.
  - Notes: `wip/goldeneye-citadel-collision.md`.
- **Reports watcher:** turned off at the user's request. Check `reports/` by hand
  for new `NNNN.json` files without a `.done` file, or restart a watcher.
- **Research, seven games:** each lead writes `WIP.md` in its scratch directory.
  - Scratch directories:
    - The World Is Not Enough: `~/.ai-tmp/r49/twine/`
    - Banjo-Kazooie: `banjo/`
    - Glover: `glover/`
    - Pokémon Snap: `snap/`
    - Mario Party (J): `mparty/`
    - Mario Kart 64: `mk64/`
    - Pilotwings 64: `pilotwings/`
  - None of the specs is finished or committed.
  - All seven leads confirmed their `WIP.md` and that nothing is left running
    (2026-09-11, about 22:05).
  - To resume, start a new lead per game from its `WIP.md` and the "Research
    investigations" procedure in AGENTS.md.

  | Game | Spec state | Next step |
  |---|---|---|
  | The World Is Not Enough | §1–5 and most of §8 proofread; §6, 7, 10 drafts; §11 unused not written | fold in audio findings and corrections, write §11 |
  | Banjo-Kazooie | §0–10 drafted (from `spec/` parts via `assemble.py`), not proofread; §11 unused not written | merge emulator session 2, one short session, relaunch the unused stream |
  | Glover | all sections have content; music evidence, hygiene and open questions still DRAFT; the §6.1 volume claim is wrong | merge findings, one emulator session (sky, boss starts, SECRET CHEAT photos), proofread |
  | Pokémon Snap | §0–12 written and proofread; §13 unused and §11.6 not written | finish the unused pass, write §13, apply two corrections |
  | Mario Party (J) | §1–9 and §11.1–6 drafted, not proofread; §0, 10, 12 missing | fold in results, audio and visual emulator sessions |
  | Mario Kart 64 | §1–6, 9, 10 drafted; §0, 7, 8, 11–14 placeholders | emulator session for start-grid dumps (debug-menu routes) |
  | Pilotwings 64 | §1–5 written, music in `part_music.md`; §6–8, 10–14 missing | run the task-level builder, visual then audio emulator sessions |

  Pilotwings found that `libultra.ts` drops 424 hi-hat notes because it doesn't
  handle velocity layers. The one-line fix affects every game using that player,
  so re-check their music when it goes in.

## Dropped

- **Yoshi's Story collision gaps** (7 levels without a main tile layer): the user
  said collision in a 2D game tells us little. Leftovers are in
  `~/.ai-tmp/r49/yoshicol/`; nothing reached the repo.

## Learnings about orchestration

- **Collision:** its main value for the user is spotting leftover or unused
  content. Keep collision work minimal.
- **Dev server:** never restart the user's Vite server (port 5174). A new
  `vite.config.ts` needs a restart by the user, not a hot reload.
- **Commits:**
  - Commit each agent's files separately.
  - Verify in a clean worktree of HEAD (tsc, level loads) because other agents'
    files are in progress in the working tree.
  - `git diff HEAD~1` includes the working tree; use `git show` to check a commit.
- **Loaders and levels:**
  - The web worker transfers every ArrayBuffer, so loaders must never share typed
    arrays (textures, identity matrices) between levels. Check with
    structuredClone plus transfer, loading each level twice.
  - Start views must ignore instances in hidden-by-default and collision layers.
- **Agents:**
  - The UI lets the user message worker agents directly. If a report reaches the
    wrong agent, redirect it and tell that agent to disregard it.
  - After a session restart, agents whose transcripts are gone can't be resumed.
    Relaunch from their files.
  - A lead's "completed" notification can arrive while its subagents are still
    running. Don't treat the lead as finished until they are done.
- **Self-matching wait loops:** `until ! pgrep -f "<pattern>"` inside `bash -c`
  matches its own command line and never ends. At wind-down this hung the MK64
  lead and left three orphaned loops from earlier agents (GoldenEye objects,
  Bomberman collision, a Perfect Dark hashall wait) running for up to 5 hours; I
  killed them.
  - Use `pgrep -f "[p]attern"`, wait on explicit PIDs, or use background task
    notifications.
  - After any agent finishes, check for leftover `sleep` loops.
- **Concurrency:** my own cap is 3 subagents and 1 emulator per research lead,
  which the user called reasonable. There is no global cap.
