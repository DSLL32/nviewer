#!/usr/bin/env bash
#
# Send commands to the debugger console of a running ./headless.sh --debug, wait until the console
# has handled them, then print what it wrote in the meantime.
#
#   ./headless-debug.sh 'bp add 0x04800004 4 4' 'run'
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="${M64P_RUN_DIR:-$ROOT/run}"
LOG="$RUN_DIR/debug.log"
deadline=$((SECONDS + ${M64P_SEND_TIMEOUT:-120}))

if [ ! -p "$RUN_DIR/debug" ] || [ ! -f "$LOG" ]; then
  echo "no debugger console in $RUN_DIR (start headless.sh with --debug)" >&2
  exit 1
fi

prompts() { grep -o '(dbg) ' "$LOG" | wc -l; }

before=$(prompts)
offset=$(stat -c %s "$LOG")
printf '%s\n' "$@" > "$RUN_DIR/debug"

# The console prints a "(dbg) " prompt whenever it's ready for the next command.
until [ "$(prompts)" -ge $((before + $#)) ]; do
  if ! kill -0 "$(cat "$RUN_DIR/pid")" 2>/dev/null; then
    echo "the emulator has exited" >&2
    break
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "timed out after ${M64P_SEND_TIMEOUT:-120}s waiting for the debugger console" >&2
    break
  fi
  sleep 0.1
done

tail -c +$((offset + 1)) "$LOG"
