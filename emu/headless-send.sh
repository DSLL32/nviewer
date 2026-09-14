#!/usr/bin/env bash
#
# Send controller commands to a running ./headless.sh, wait until the game has received all of
# them, then wait for a screenshot taken after that and print its path.
#
#   ./headless-send.sh 'press START' ['wait 60' ...]
#
# The command protocol is documented at the top of mupen64plus-input-pipe/src/plugin.c.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="${M64P_RUN_DIR:-$ROOT/run}"
STATUS="$RUN_DIR/input.status"
deadline=$((SECONDS + ${M64P_SEND_TIMEOUT:-120}))

polls() { sed -n 's/^\(idle\|busy\) polls=\([0-9]*\)$/\2/p' "$STATUS" 2>/dev/null; }

check_alive() {
  if grep -qs '^stopped' "$STATUS"; then
    echo "headless emulator has stopped" >&2
    exit 1
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    local newest
    newest=$(ls -t --time-style=+%T -l "$RUN_DIR"/shots/*.png 2>/dev/null | awk 'NR==2 {print $6}')
    echo "timed out after ${M64P_SEND_TIMEOUT:-120}s waiting for $1 (status: $(cat "$STATUS"); newest screenshot: ${newest:-none})" >&2
    exit 1
  fi
}

before=$(polls)
if [ -z "$before" ] || [ ! -p "$RUN_DIR/input" ]; then
  echo "headless emulator doesn't seem to be running (no input FIFO in $RUN_DIR)" >&2
  exit 1
fi

printf '%s\n' "$@" > "$RUN_DIR/input"

# The status goes back to "idle", with a higher poll count, once every queued poll was delivered.
until grep -q '^idle' "$STATUS" && [ "$(polls)" -gt "$before" ]; do
  check_alive "the game to read the commands"
  sleep 0.1
done

# Then wait for the next periodic screenshot, so it shows the result of the input. Right after
# startup there may be none yet.
marker=$(mktemp)
until latest=$(ls -t "$RUN_DIR"/shots/*-latest.png 2>/dev/null | head -n1) && [ -n "$latest" ] && [ "$latest" -nt "$marker" ]; do
  check_alive "a new screenshot"
  sleep 0.1
done
rm -f "$marker"

echo "$latest"
