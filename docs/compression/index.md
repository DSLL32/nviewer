# Compression

The game manuals describe where compressed data is stored. This catalog groups
the byte-stream formats themselves. The C and C++ examples are independent reference
implementations; the decoder appears before the encoder. Encoders produce valid
streams but do not attempt to match a game's original compression decisions.
Decoder-only cases are identified explicitly. Verification uses actual ROM
streams; no codec tests are kept in the repository.

To compare reference encoders with the largest indexed retail stream for each
format, set `NVIEWER_ROMS` to the ROM directory and run
`npm run bench:codecs -- --jobs 4`. The [benchmark manifest and runner](https://github.com/DSLL32/nviewer/blob/master/tools/codec-table.ts)
record each chosen stream and print a Markdown table. The comparison excludes
archive alignment bytes and verifies every re-encoded stream by decoding it.

An optional [bounded match finder](./common.md) is provided; the current
reference encoders implement their own format-specific searches.
Build the C++ sources with C++17. The DEFLATE-based C sources use zlib and
link with `-lz`.

| Format | Known games | Reference code |
|---|---|---|
| [MIO0](./mio0.md) | [Mario Kart 64](../MARIOKART64.md), [Pilotwings 64](../PILOTWINGS64.md), [Star Fox 64](../STARFOX.md) | Decoder and encoder |
| [Yaz0](./yaz0.md) | [Ocarina of Time](../OCARINA_OF_TIME.md), [Majora's Mask](../MAJORAS_MASK.md) | Decoder and encoder |
| [Yay0](./yay0.md) | [Bomberman 64: The Second Attack!](../BOMBERMAN64_SECOND_ATTACK.md) | Decoder and encoder |
| [Rare `1172` + raw DEFLATE](./raw-deflate.md) | [GoldenEye 007](../GOLDENEYE.md) | Decoder and encoder, zlib |
| [Rare `1172` + u32 size + raw DEFLATE](./raw-deflate.md) | [Banjo-Kazooie](../BANJOKAZOOIE.md) | Same codec, distinct wrapper |
| [Rare `1173` + raw DEFLATE](./raw-deflate.md) | [Perfect Dark](../PERFECTDARK.md) | Same codec |
| [Headerless raw DEFLATE](./raw-deflate.md) | [Gex 64](../GEX64.md), [Gex 3](../GEX3.md), [Rush 2049](../SAN_FRANCISCO_RUSH_2049.md) | Same codec |
| [Chunked zlib](./chunked-zlib.md) | [Stunt Racer 64](../STUNTRACER64.md) | Decoder and encoder, zlib |
| [Boss pattern LZ/RLE](./boss-pattern.md) | [Stunt Racer 64](../STUNTRACER64.md) | Decoder and encoder |
| [FLA2](./fla2.md) | [Glover](../GLOVER.md) | Decoder and encoder |
| [Hudson LZSS](./hudson-lzss.md), 1 KiB ring | [Bomberman 64](../BOMBERMAN64.md), [The Second Attack!](../BOMBERMAN64_SECOND_ATTACK.md), [Mario Party](../MARIOPARTY.md) | C++ template |
| [Hudson LZSS](./hudson-lzss.md), 4 KiB ring | [Bomberman Hero](../BOMBERMAN_HERO.md) | Same template |
| [Rush LZSS](./rush-lzss.md) | [San Francisco Rush](../SAN_FRANCISCO_RUSH.md), [Rush 2049](../SAN_FRANCISCO_RUSH_2049.md) | Both variants: decoder and encoder |
| [LZARI](./lzari.md) | [BattleTanx](../BATTLETANX.md), [Global Assault](../BATTLETANX_GLOBAL_ASSAULT.md) | Decoder and arithmetic encoder |
| [RNC methods 1 and 2](./rnc.md) | [A Bug's Life](../BUGSLIFE.md) | Both decoders and encoders |
| [LH5-family stream](./airboarder-lh5.md) | [Air Boarder 64](../AIRBOARDER64.md) | Decoder and encoder |
| [`CMPR`/`SMSR00` slide-LZ](./smsr.md) | [Yoshi's Story](../YOSHISTORY.md) | Decoder and encoder |
| [VPK0](./vpk0.md) | [Pokémon Snap](../POKEMONSNAP.md) | Decoder and encoder |
| [ERZ2](./erz2.md) | [Spider-Man](../SPIDERMAN.md) | Decoder and encoder |
| [EDL](./edl.md) | [007: The World Is Not Enough](../WORLDISNOTENOUGH.md) | Stored, Huffman-LZ, and fixed-code LZ; decoder and encoder |
| [Shadows LZHUF](./shadows-lzhuf.md) | [Star Wars: Shadows of the Empire](../SHADOWS_OF_THE_EMPIRE.md) | Decoder and encoder; release-specific position tables |
| [Shadows LZSS](./shadows-lzss.md) | [Star Wars: Shadows of the Empire](../SHADOWS_OF_THE_EMPIRE.md) | Decoder and encoder; absolute 4 KiB ring |

Nintendo VADPCM and other audio sample encodings are documented in each game's
audio section; they are not general-purpose asset compression formats. The 1997
Ocarina of Time prototype and Off Road Challenge store their documented level
data without one of the compressed containers above.
