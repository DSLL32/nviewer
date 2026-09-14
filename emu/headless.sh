#!/usr/bin/env bash
#
# Run a ROM with no display server and no audio. The emulator keeps a circular buffer of
# periodic screenshots and reads controller 1 from a FIFO of text commands.
#
#   ./headless.sh [mupen64plus options...] rom.z64
#
# Everything goes under $M64P_RUN_DIR (default: ./run):
#   shots/<rom>-latest.png      newest screenshot
#   shots/<rom>-ring-NNNN.png   the last M64P_RING_SIZE screenshots (ls -t lists newest first)
#   input                       command FIFO, e.g.  echo 'press START' > run/input
#   input.status                "idle polls=N" once every queued command has been delivered
#   save/                       in-game saves and save states
#   config/                     mupen64plus.cfg for this run directory (options set below win)
#   pid                         emulator PID; stop just this one: pkill -x -F run/pid mupen64plus
#   emulator.log                everything the emulator prints, recreated at each start
#   debug, debug.log            with --debug: FIFO for debugger console commands, and its output
#
# To run several emulators at once, give each its own M64P_RUN_DIR (headless-send.sh reads it too).
#
# ./headless-send.sh 'press START' 'wait 60' sends commands, waits until they've been delivered
# and a fresh screenshot exists, then prints the path of <rom>-latest.png.
# With --debug, ./headless-debug.sh 'bp add 0x04800004 4 4' 'run' drives the debugger console.
#
# Tunables: M64P_RING_SIZE (screenshots kept, default 60), M64P_INTERVAL_MS (emulated time
# between screenshots, default 1000), M64P_GFX_PLUGIN (video plugin path, default Glide64mk2),
# PREFIX (default ./install). The input command protocol is documented at the top of
# mupen64plus-input-pipe/src/plugin.c.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${PREFIX:-$ROOT/install}"
RUN_DIR="${M64P_RUN_DIR:-$ROOT/run}"
GFX_PLUGIN="${M64P_GFX_PLUGIN:-$PREFIX/lib/mupen64plus/mupen64plus-video-glide64mk2.so}"

if [ $# -lt 1 ]; then
  echo "usage: $0 [mupen64plus options...] rom.z64" >&2
  exit 2
fi

mkdir -p "$RUN_DIR/shots" "$RUN_DIR/save" "$RUN_DIR/config"
# Start with an empty buffer, so old runs (possibly of other ROMs) don't mix in.
rm -f "$RUN_DIR"/shots/*.png "$RUN_DIR"/shots/*.tmp

# Everything the emulator prints goes to a fresh emulator.log, so callers don't need to redirect.
exec > "$RUN_DIR/emulator.log" 2>&1

export M64P_INPUT_PIPE="$RUN_DIR/input"
export SDL_VIDEODRIVER="${SDL_VIDEODRIVER:-offscreen}"
export EGL_PLATFORM="${EGL_PLATFORM:-surfaceless}"
# With no GPU device node, Mesa has to render in software. Default to softpipe: llvmpipe is faster
# once warmed up, but it stalls the emulator for seconds whenever a scene needs newly compiled
# shaders.
if [ ! -e /dev/dri ]; then
  export LIBGL_ALWAYS_SOFTWARE="${LIBGL_ALWAYS_SOFTWARE:-1}"
  export GALLIUM_DRIVER="${GALLIUM_DRIVER:-softpipe}"
fi

# With --debug, use the core built with the debugger (normal runs keep the faster core). Its console
# reads commands from the "debug" FIFO and writes to debug.log.
rm -f "$RUN_DIR/debug.log"
debug_args=()
for arg in "$@"; do
  if [ "$arg" = --debug ]; then
    debug_args=(--corelib "$PREFIX/lib/libmupen64plus-dbg.so.2.0.0" --debug-log "$RUN_DIR/debug.log")
  fi
done
if [ ${#debug_args[@]} -gt 0 ]; then
  [ -p "$RUN_DIR/debug" ] || mkfifo -m 600 "$RUN_DIR/debug"
  # Open it read-write, so the console never sees end-of-file when a writer closes it.
  exec 0<> "$RUN_DIR/debug"
else
  # Without a reader, writes to a leftover FIFO would block forever.
  rm -f "$RUN_DIR/debug"
fi

# exec keeps this PID, so the pid file ends up naming the emulator itself.
echo $$ > "$RUN_DIR/pid"

# Each run directory has its own config dir, so ~/.config/mupen64plus doesn't leak in and instances
# don't share settings. mupen64plus.cfg is written there on first start, and the options below
# override it on every start. Plugins are named explicitly because the default config names plugins
# that aren't built here. stdbuf line-buffers the log so it can be followed live; it execs
# mupen64plus, so the pid file stays correct.
exec stdbuf -oL -eL "$PREFIX/bin/mupen64plus" \
  --configdir "$RUN_DIR/config" \
  --windowed --resolution 320x240 --audio dummy \
  --gfx "$GFX_PLUGIN" \
  --rsp "$PREFIX/lib/mupen64plus/mupen64plus-rsp-hle.so" \
  --input "$PREFIX/lib/mupen64plus/mupen64plus-input-pipe.so" \
  --set "Core[ScreenshotPath]=$RUN_DIR/shots" \
  --set "Core[SaveSRAMPath]=$RUN_DIR/save" \
  --set "Core[SaveStatePath]=$RUN_DIR/save" \
  --set "Core[ScreenshotRingSize]=${M64P_RING_SIZE:-60}" \
  --set "Core[ScreenshotRingIntervalMs]=${M64P_INTERVAL_MS:-1000}" \
  --emumode 0 \
  "${debug_args[@]}" "$@"
