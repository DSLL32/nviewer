# Compression

The game manuals describe where compressed data is stored. This catalog groups
the byte-stream formats themselves. The C and C++ examples are independent reference
implementations; the decoder appears before the encoder. Encoders produce valid
streams but do not attempt to match a game's original compression decisions.

| Format | Known games | Reference code |
|---|---|---|
| [MIO0](./mio0.md) | [Mario Kart 64](../MARIOKART64.md), [Pilotwings 64](../PILOTWINGS64.md), [Star Fox 64](../STARFOX.md) | Decoder and encoder |
| [Yaz0](./yaz0.md) | [Ocarina of Time](../OCARINA_OF_TIME.md), [Majora's Mask](../MAJORAS_MASK.md) | Decoder and encoder |
| [Yay0](./yay0.md) | [Bomberman 64: The Second Attack!](../BOMBERMAN64_SECOND_ATTACK.md) | Decoder and encoder |
| Rare `1172` + raw DEFLATE | [GoldenEye 007](../GOLDENEYE.md) | — |
| Rare `1173` + raw DEFLATE | [Perfect Dark](../PERFECTDARK.md) | — |
| Headerless raw DEFLATE | [Gex 64](../GEX64.md), [Gex 3](../GEX3.md), [Rush 2049](../SAN_FRANCISCO_RUSH_2049.md) | — |
| Chunked zlib | [Stunt Racer 64](../STUNTRACER64.md) | — |
| [Hudson LZSS](./hudson-lzss.md), 1 KiB ring | [Bomberman 64](../BOMBERMAN64.md), [The Second Attack!](../BOMBERMAN64_SECOND_ATTACK.md) | C++ template |
| [Hudson LZSS](./hudson-lzss.md), 4 KiB ring | [Bomberman Hero](../BOMBERMAN_HERO.md) | Same template |
| Rush LZSS | [San Francisco Rush](../SAN_FRANCISCO_RUSH.md), [Rush 2049](../SAN_FRANCISCO_RUSH_2049.md) | — |
| LZARI | [BattleTanx](../BATTLETANX.md), [Global Assault](../BATTLETANX_GLOBAL_ASSAULT.md) | — |
| RNC methods 1 and 2 | [A Bug's Life](../BUGSLIFE.md) | — |
| LH5-family stream | [Air Boarder 64](../AIRBOARDER64.md) | — |
| `CMPR`/`SMSR00` slide-LZ | [Yoshi's Story](../YOSHISTORY.md) | — |
| VPK0 | [Pokémon Snap](../POKEMONSNAP.md) | — |
| ERZ2 | [Spider-Man](../SPIDERMAN.md) | — |

Nintendo VADPCM and other audio sample encodings are documented in each game's
audio section; they are not general-purpose asset compression formats. The 1997
Ocarina of Time prototype and Off Road Challenge store their documented level
data without one of the compressed containers above.
