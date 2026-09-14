#!/usr/bin/env bash
#
# Build and install all Mupen64Plus modules found in this directory.
#
#   ./build.sh                 build + install into ./install
#   PREFIX=/usr/local ./build.sh   install system-wide (needs write access)
#   ./build.sh clean           remove all build products
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${PREFIX:-$ROOT/install}"
JOBS="${JOBS:-$(nproc)}"
APIDIR="$ROOT/mupen64plus-core/src/api"

# Core must be built first: the plugins and the UI compile against its headers.
CORE=mupen64plus-core
MODULES=(
  mupen64plus-rsp-hle
  mupen64plus-rsp-cxd4
  mupen64plus-video-glide64mk2
  mupen64plus-video-z64
  mupen64plus-audio-sdl
  mupen64plus-input-sdl
  mupen64plus-input-pipe
  mupen64plus-ui-console
)

# Debian/Ubuntu package for each pkg-config module the makefiles require.
declare -A PKGS=(
  [sdl2]=libsdl2-dev
  [zlib]=zlib1g-dev
  [libpng]=libpng-dev
  [freetype2]=libfreetype-dev
  [gl]=libgl-dev
  [glu]=libglu1-mesa-dev
  [vulkan]=libvulkan-dev
  [glew]=libglew-dev
  [speexdsp]=libspeexdsp-dev
  [samplerate]=libsamplerate0-dev
)

check_deps() {
  local missing=() have_pc=1
  command -v pkg-config >/dev/null 2>&1 || { have_pc=0; missing+=(pkgconf); }

  for mod in "${!PKGS[@]}"; do
    local pkg="${PKGS[$mod]}"
    if [ "$have_pc" = 1 ]; then
      pkg-config --exists "$mod" 2>/dev/null || missing+=("$pkg")
    else
      # Without pkg-config we cannot probe the modules, so fall back to asking
      # dpkg directly. This keeps the report to a single pass.
      dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q '^install ok installed$' \
        || missing+=("$pkg")
    fi
  done
  command -v nasm >/dev/null 2>&1 || missing+=(nasm)
  # The debugger build of the core disassembles with libopcodes.
  [ -e /usr/include/dis-asm.h ] || missing+=(binutils-dev)

  if [ ${#missing[@]} -ne 0 ]; then
    echo "Missing build dependencies. Install them with:" >&2
    echo >&2
    echo "  sudo apt-get install -y $(printf '%s\n' "${missing[@]}" | sort -u | tr '\n' ' ')" >&2
    echo >&2
    exit 1
  fi
}

# COREDIR/PLUGINDIR/SHAREDIR get compiled into the binaries as the default
# search paths. Without them a non-/usr/local prefix builds fine but fails at
# runtime: the core cannot find mupen64plus.ini, the cheat file or the OSD font.
# COREDIR must end in a slash -- see the note in ui-console's Makefile.
run_make() {
  local dir="$1"; shift
  echo "==> $dir: $*"
  make -C "$ROOT/$dir/projects/unix" -j"$JOBS" \
    PREFIX="$PREFIX" APIDIR="$APIDIR" \
    COREDIR="$PREFIX/lib/" \
    PLUGINDIR="$PREFIX/lib/mupen64plus" \
    SHAREDIR="$PREFIX/share/mupen64plus" \
    "$@"
}

if [ "${1:-}" = "clean" ]; then
  for m in "$CORE" "${MODULES[@]}"; do run_make "$m" clean; done
  run_make "$CORE" clean POSTFIX=-dbg
  exit 0
fi

check_deps

# The core installs its headers and libmupen64plus.so; everything else links
# against the in-tree API headers, so build order matters only for the core.
run_make "$CORE" all
run_make "$CORE" install
# A second core with the debugger compiled in, used by headless.sh --debug. It runs slower, so the
# normal core stays the default. POSTFIX gives it separate objects and a separate library name.
run_make "$CORE" all DEBUGGER=1 POSTFIX=-dbg
run_make "$CORE" install DEBUGGER=1 POSTFIX=-dbg
for m in "${MODULES[@]}"; do
  run_make "$m" all
  run_make "$m" install
done

cat <<MSG

Build complete. Installed under: $PREFIX

Run it with:
  "$PREFIX/bin/mupen64plus" /path/to/rom.z64
or with no display, periodic screenshots and FIFO input (see headless.sh):
  "$ROOT/headless.sh" /path/to/rom.z64
MSG
