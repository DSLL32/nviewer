# AGENTS.md

 - Use `~/.ai-tmp/{some-session-id}` as scratch rather than `/tmp`
 - mips-elf gcc/binutils is installed if necessary 
 - mupen64plus is available, see `EMULATOR.md`. Dispatch the emulator in a
   subagent with a concrete task or result, so as not to waste your context. Do
   not leave emulators running when they are no longer needed.

# Techniques

## Level loads

N64 games tend to load levels in one go. Breakpoint on the initiation of large
DMAs. This should give you the ROM extent of the level. If you suspect the game
to use compression for its assets, you can set a read breakpoint on the RDRAM
destination of the DMA, or perhaps at +32 in case it has a header which is
never read. This should give you the decompression routine.
