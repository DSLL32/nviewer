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

For BattleTanx's front-end bank at ROM `0x2D2790–0x2E2CD0`, the original
stream is 66,880 bytes and decodes to 150,208 bytes. At level 9, the reference
encoder produces 63,343 bytes, 3,537 bytes (5.3%) smaller than the original.
Each level's output round-tripped, and level 9 decoded byte-for-byte with the
independent viewer decoder and passed sanitizer checks. The encode times below
are medians of three `-O3` runs measured with `CLOCK_MONOTONIC` around encoding
on the development host, not portable performance guarantees. All are well
below the 2 seconds per 10 KiB of compressed output budget (12.4 seconds for
level 9's 63,343-byte result).

| Level | Search depth | Parse | Bytes | Encode time |
|---:|---:|---|---:|---:|
| 0 | 0 | literals | 88,123 | 13 ms |
| 1 | 1 | greedy | 70,654 | 11 ms |
| 2 | 4 | greedy | 68,189 | 12 ms |
| 3 | 16 | greedy | 66,723 | 13 ms |
| 4 | 32 | greedy | 66,303 | 14 ms |
| 5 | 64 | greedy | 65,988 | 15 ms |
| 6 | 128 | lazy | 65,111 | 25 ms |
| 7 | 256 | lazy | 65,024 | 29 ms |
| 8 | 512 | lazy | 64,974 | 33 ms |
| 9 | 4,096 | 20-pass parse | 63,343 | 1,074 ms |

## Reference source

<<< ../../codecs/lzari.c{c}
