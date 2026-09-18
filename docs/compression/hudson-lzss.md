# Hudson LZSS

[Bomberman 64](../BOMBERMAN64.md),
[The Second Attack!](../BOMBERMAN64_SECOND_ATTACK.md), and
[Mario Party](../MARIOPARTY.md) use the 1 KiB variant;
[Bomberman Hero](../BOMBERMAN_HERO.md) uses the 4 KiB variant. These are the
same absolute-ring token scheme with different constant fields. The game-specific
file wrappers supply the stopping rule and are documented in the game manuals.

| Parameter | Bomberman 64 / Second Attack | Mario Party | Bomberman Hero |
|---|---:|---:|---:|
| Ring size | 1,024 bytes | 1,024 bytes | 4,096 bytes |
| Initial write index | `0x3BE` | `0x3BE` | `0xFEE` |
| Length bits in second match byte | 6 | 6 | 4 |
| Match length | 3–66 bytes | 3–66 bytes | 3–18 bytes |
| Outer size | Big-endian decoded size | Mainfs file-record decoded size | Little-endian compressed size |

The ring begins zero-filled. Each flag byte is consumed least-significant bit
first: 1 means a literal byte; 0 means a two-byte match `a,b`. With `L` length
bits, the absolute ring source index is `a | ((b >> L) << 8)` and the copied
length is `(b & ((1 << L) - 1)) + 3`. Every emitted byte also enters the ring,
so matches may overlap the write cursor. There is no token-level end marker.

## Reference C++ codec

`LenBits` is a compile-time parameter (`6` or `4`), which also determines the
ring size and initial write index. The decoder accepts an optional expected
decoded length: pass it for Bomberman 64 and The Second Attack; for Hero pass
only the compressed payload length after reading its outer four-byte size.
The encoder writes the token stream but not either game's outer size word.
The decoder does not allocate memory. The encoder precomputes match lengths,
then uses dynamic programming over output position and the current bit of the
eight-token flag byte. It chooses the smallest stream available from those
matches, including flag-byte overhead, instead of committing to a greedy
match. The encoder uses memory linear in the decoded size. The maintained source is
[codecs/hudson_lzss.hpp](https://github.com/DSLL32/nviewer/blob/master/codecs/hudson_lzss.hpp).

`hudson_encode_ex<LenBits>(..., effort)` exposes efforts 0–9. They increase
the number of same-hash candidates searched per input position; effort 9
checks the entire ring and is the default used by `hudson_encode`. Higher
effort cannot make the output larger, since it only adds match choices.

The codec has been checked against the indexed Bomberman Hero assets and
representative 1 KiB-ring assets from both Bomberman 64 games. Re-encoded
streams decode byte-for-byte with the independent viewer decoder. Bounds
checks cover both ring sizes and short output buffers.

<<< ../../codecs/hudson_lzss.hpp{cpp}
