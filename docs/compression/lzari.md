# LZARI

[BattleTanx](../BATTLETANX.md) and
[BattleTanx: Global Assault](../BATTLETANX_GLOBAL_ASSAULT.md) use the same
LZARI variant. A big-endian `u32` decoded size precedes an MSB-first arithmetic
bitstream. The adaptive character model has 314 symbols: 256 literal bytes and
match lengths 3–60. Match distances use a separate static position model.
Output history is a 4 KiB ring, initialized with spaces before its initial
write position at 4,036. There is no end token; decoding stops at the declared
size. The arithmetic decoder may read a few zero padding bits beyond the last
meaningful bit.

The [C reference codec](https://github.com/DSLL32/nviewer/blob/master/codecs/lzari.c)
implements decoding and a compact arithmetic encoder that emits literal
symbols only. It does not search for LZ matches, but adaptive arithmetic coding
still compresses suitable input: BattleTanx's `0x738900` stream decoded to
32,448 bytes (FNV-1a `877EBE04`) and re-encoded to 18,866 bytes (0.581×
decoded size). The C output matches the viewer, and the re-encoded stream
round-trips under sanitizers.

## Reference source

<<< ../../codecs/lzari.c{c}
