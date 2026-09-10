# Running N64 games headless (mupen64plus)

A patched mupen64plus in `~/mupen64plus` runs a ROM with no display or audio. It saves a
screenshot about once per emulated second and reads controller 1 input from a FIFO.

Each emulator keeps all its files (input FIFO, status, screenshots, saves, config, pid) in one run
directory: `$M64P_RUN_DIR`, default `~/mupen64plus/run`. Nothing in `~/.config/mupen64plus` is
read or written. The examples below use the default. To run
your own instance next to others, see [Running several at once](#running-several-at-once).

## Start

It keeps running until the emulator exits, so start it in the background: use your shell tool's
background mode if it has one (such as Claude Code's `run_in_background`), or a plain `&`. Either
way, send its output to a log. Warnings end up there, and the output can't fill up a pipe nobody
reads:

    mkdir -p ~/mupen64plus/run
    ~/mupen64plus/headless.sh '/path/to/game.z64' > ~/mupen64plus/run/emulator.log 2>&1 &

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
`kill $(pgrep mupen64plus)`: those stop every agent's emulator.

## Running several at once

Give each emulator its own run directory, and set `M64P_RUN_DIR` on every command for it. Shell
variables usually don't survive between separate tool calls, so repeat it each time:

    mkdir -p ~/mupen64plus/run-rush
    M64P_RUN_DIR=~/mupen64plus/run-rush ~/mupen64plus/headless.sh '/path/to/game.z64' > ~/mupen64plus/run-rush/emulator.log 2>&1 &
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
