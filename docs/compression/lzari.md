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
implements decoding and an arithmetic encoder with a bounded 4 KiB hash-chain
match search and stronger parsing at higher compression levels. Match lengths
and distances are coded with the same models as the game.
`lzari_encode_ex(src, size, dst, cap, written, level)` accepts levels 0–9:
level 0 emits arithmetic-coded literals only, levels 1–5 use increasingly deep
greedy search, levels 6–8 add one-byte lazy parsing, and level 9 uses a
20-pass, cost-estimated shortest-path parse over the cheapest available
distance for each match length. This is near-optimal under its estimated
symbol costs, not a proof of globally minimal compressed size. The stable
`lzari_encode` entry point uses level 9. Levels trade encode time and memory
for size; smaller output is not guaranteed for every input as the level
increases.

| Level | Search depth | Parse |
|---:|---:|---|
| 0 | 0 | Literals only |
| 1 | 1 | Greedy |
| 2 | 4 | Greedy |
| 3 | 16 | Greedy |
| 4 | 32 | Greedy |
| 5 | 64 | Greedy |
| 6 | 128 | One-byte lazy |
| 7 | 256 | One-byte lazy |
| 8 | 512 | One-byte lazy |
| 9 | 4,096 | 20-pass estimated-cost parse |

The codec has been checked against BattleTanx's front-end bank. Re-encoded
streams decode byte-for-byte with the independent viewer decoder.

## Reference source

<<< ../../codecs/lzari.c{c}
