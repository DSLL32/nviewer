# Running N64 games headless (mupen64plus)

A patched mupen64plus in `~/mupen64plus` runs a ROM with no display or audio. It saves a
screenshot about once per emulated second and reads controller 1 input from a FIFO.

Each emulator keeps all its files (input FIFO, status, screenshots, saves, config, pid) in one run
directory: `$M64P_RUN_DIR`, default `~/mupen64plus/run`. Nothing in `~/.config/mupen64plus` is
read or written. The examples below use the default. To run
your own instance next to others, see [Running several at once](#running-several-at-once).

## Start

It keeps running until the emulator exits, so start it in the background: use your shell tool's
background mode if it has one (such as Claude Code's `run_in_background`), or a plain `&`:

    ~/mupen64plus/headless.sh '/path/to/game.z64' &

Its output goes to `~/mupen64plus/run/emulator.log`, which is recreated at each start.

It's ready once `~/mupen64plus/run/shots/*-latest.png` exists, usually within a few seconds. If new
screenshots stop appearing (`ls -lt ~/mupen64plus/run/shots`), the game isn't running, so check the
log. `input.status` can't tell you that, because it only changes when the input queue becomes busy
or idle.

## Send input and look

    ~/mupen64plus/headless-send.sh 'press START' 'wait 60'

This queues the commands, waits until the game has received all of them, waits for a newer
screenshot, and prints its path. View that PNG (320x240) to see the result. It returns only after
everything queued has been delivered, and gives up after 120s. Loading screens can run far slower
than real time, so raise the limit for long sequences, e.g. `M64P_SEND_TIMEOUT=600`. To send
without waiting: `echo 'clear' > ~/mupen64plus/run/input`.

Pass one command per argument:

| Command | Effect |
|---|---|
| `press BUTTONS [N]` | hold for N polls (default 3), then release for 3 polls |
| `hold BUTTONS [N]` | hold for N polls (default 1), with no release afterwards |
| `wait N` | leave the controller neutral for N polls |
| `clear` | drop everything still queued |

- **BUTTONS:** any of `A B Z L R START DU DD DL DR CU CD CL CR` (D = d-pad, C = C buttons),
  joined with spaces or `+`.
- **Analog stick:** add `x=N y=N` (-128..127; a full push is about ±80). For example,
  `hold A x=0 y=80 120` holds A with the stick pushed up for 120 polls.
- **Polls:** a poll is one controller read by the game. The rate varies by game (Super Mario 64
  does about 60 per second).
- **Neutral when idle:** with nothing queued the controller is neutral, so continuous input
  (like accelerating) needs one long `hold`.

## Screenshots and saves

`~/mupen64plus/run/shots/` holds `<rom>-latest.png` and the last 60 shots as `<rom>-ring-NNNN.png`.
It's cleared at each start. `ls -t` lists them newest first, which is useful for seeing what
happened between your commands.

In-game saves and save states go to `save/` in the run directory, so they carry over only when
you reuse that directory.

## Speed

There's no GPU, so the N64 graphics are rendered in software (Mesa's softpipe), and that's the
bottleneck. Busy 3D scenes run roughly 2–4x slower than real time, while menus and 2D screens run at
full speed. Screenshots are one emulated second apart, so their timestamps show the current speed.
The CPU uses the pure interpreter (`--emumode 0`), which is not the bottleneck. With
`GALLIUM_DRIVER=llvmpipe` rendering gets faster once warmed up, but the emulator stalls for seconds
whenever a new scene needs shaders compiled.

## Stop

    pkill -x -F ~/mupen64plus/run/pid mupen64plus

This stops only the emulator belonging to that run directory. Don't use `pkill mupen64plus` or
`kill $(pgrep mupen64plus)`: those stop every agent's emulator. An emulator paused in the debugger
ignores `pkill`; stop it with `~/mupen64plus/headless-debug.sh quit` instead.

## Debugging

`--debug` swaps in a core built with mupen64plus's debugger, which runs somewhat slower:

    ~/mupen64plus/headless.sh --debug '/path/to/game.z64' &

The emulator starts paused at its first instruction. While it's paused, no screenshots are taken
and no input is read, so `headless-send.sh` just waits. Send debugger commands with:

    ~/mupen64plus/headless-debug.sh 'bp add 0x04800004 4 4' 'run'

This waits until the console has handled every command, then prints what the console wrote. The
whole session is in `~/mupen64plus/run/debug.log`. When a breakpoint pauses the emulator, a
`PC at 0x...` line appears there, and `bp trig` shows what triggered it.

| Command | Effect |
|---|---|
| `run`, `pause`, `step [N]` | resume, pause, or execute N instructions (only while paused) |
| `regs`, `pc`, `asm [ADDR [COUNT]]` | registers, the PC, or disassembly (at the PC by default) |
| `mem ADDR`, `write ADDR VALUE`, `dumpmem ADDR LEN FILE` | read, write, or dump memory (hex) |
| `translate ADDR` | convert a virtual address to a physical one |
| `bp add ADDR [SIZE [FLAGS]]` | break on ADDR up to ADDR+SIZE; FLAGS: 2 read, 4 write, 8 execute (default: all) |
| `bp list`, `bp rm ADDR`, `bp trig` | list breakpoints, remove one, or show what triggered the last break |

- **Addresses:** execution breakpoints use virtual addresses (like the PC, `0x80...`). Read/write
  breakpoints use physical ones (RDRAM is `0x00000000`–`0x007FFFFF`).
- **What memory breakpoints see:** only the game's CPU. DMA copies and the RSP write memory
  directly, so they don't trigger them.
- **Catching a DMA:** break on the register write that starts it:

  | DMA | Register writes that start it |
  |---|---|
  | PI (cartridge) | `0x04600008`, `0x0460000C` |
  | SI (controllers) | `0x04800004`, `0x04800010` |
  | SP (RSP memory) | `0x04040008`, `0x0404000C` |
  | AI (audio) | `0x04500004` |

- **Dumping memory:** `dumpmem 0x80000000 0x800000 /absolute/path/rdram.bin` writes RDRAM in the
  N64's big-endian byte order.
  - Use `0x80...` addresses. Lower ones count as TLB-mapped, and an unmapped one silently dumps from
    physical address 0.
  - Hex lengths need the `0x` prefix.
  - Use an absolute filename: relative ones land in the directory `headless.sh` was started from.
    Filenames are limited to 63 characters, with no spaces.
- **More formats:** `mem` and `write` accept more; see
  `~/mupen64plus/mupen64plus-ui-console/src/debugger.c`.

## Running several at once

Give each emulator its own run directory, and set `M64P_RUN_DIR` on every command for it. Shell
variables usually don't survive between separate tool calls, so repeat it each time:

    M64P_RUN_DIR=~/mupen64plus/run-rush ~/mupen64plus/headless.sh '/path/to/game.z64' &
    M64P_RUN_DIR=~/mupen64plus/run-rush ~/mupen64plus/headless-send.sh 'press START' 'wait 60'
    pkill -x -F ~/mupen64plus/run-rush/pid mupen64plus

Everything else in this file then applies with `~/mupen64plus/run` replaced by your directory.
Each emulator uses roughly one CPU core for software rendering.

## Tips

- **The game doesn't wait for you.** You take seconds between looking and acting. Title screens
  time out into attract demos, and presses during boot or screen transitions are ignored. Queue
  whole sequences in one call with generous `wait`s, and check older ring shots when a result
  looks off.
- **Text boxes** often block movement. Dismiss them first.
- **Bad commands** are ignored, with a warning in the emulator log.
