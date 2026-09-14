# Emulator sources

This directory contains the Mupen64Plus stack used for runtime research.

Modified components are vendored so their local patches are part of nviewer's
history:

- `mupen64plus-core`
- `mupen64plus-ui-console`
- `mupen64plus-input-pipe`
- the build and headless-control scripts in this directory

Unmodified upstream components are pinned Git submodules, including GLideN64.
Initialize them after cloning nviewer:

```sh
git submodule update --init --recursive
```

Build the complete stack, including the normal and debugger cores and GLideN64:

```sh
./emu/build.sh
```

The build requires the usual Mupen64Plus development packages plus CMake for
GLideN64; `build.sh` reports missing packages before compilation.

Release code defaults to `-O3 -flto -march=native -fomit-frame-pointer` across
all Make and CMake components. This optimizes for the build host rather than a
portable binary. Set `OPTFLAGS` explicitly to override the policy.

Build products and default runtime state stay in `emu/install/` and `emu/run/`
and are ignored by Git. See [`../EMULATOR.md`](../EMULATOR.md) for operation.
