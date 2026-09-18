# Glover — Nintendo 64 ROM format specification

## 1. Overview

### 1.1 Technical summary

| Property | Value |
|---|---|
| Asset organization | ROM ranges embedded in loader code; size-linked landscape and controller-record chains. |
| Compression | FLA2 LZSS wrapper for texture and object banks; landscapes, music, and controller records are uncompressed. |
| Graphics microcode | F3DEX 1.21. |
| Geometry | Object-bank node trees with F3DEX display lists or CPU-built face-list meshes. |
| Textures | CI4, CI8, and RGBA16; palette entries use RGBA5551. |
| Collision | Plane records generated from root-mesh triangle face lists; actor and platform flags control participation. |
| Music driver | Software Creations libmus sequence player using the libultra synthesizer. |
| Audio microcode | **Unknown**; the ROM contains a libultra RSP software version string but the active audio task has not been identified. |
| Sample encoding | VADPCM. |
| Levels | 48 landscape records, including 30 world levels and non-gameplay scenes. |
| Memory requirement | Base 4 MiB. |
| Viewer support | Research specification; a viewer loader is not yet published. |

### 1.2 ROM identification

Verified from the normalized USA ROM header and checksum computation:

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|
| USA | `Glover` | `NGVE` | 0 | 8 MiB (`0x800000`) | `8E6E01FF` | `CCB4F948` | `270be17b3c8da9b88a7b99c2a545b0bce16837f4` | 6102 | `V25 08AUG98` |

The header entry point is `0x80100000`. The boot-code CRC-32 over `[0x40, 0x1000)` is `90BB6CB5`.
The ROM contains `RSP SW Version: 2.0H, 02-12-97` at `0xF40B0` and the F3DEX 1.21 string at `0xF38F0`.
English, French, and German UI strings coexist in the image. Only USA revision 0 was examined; the PAL game code
`NGVP` is documented by its header convention, but its ROM layout has not been verified here.

### 1.3 Terminology and conventions

ROM ranges are half-open offsets into the normalized `.z64` image. RAM addresses are KSEG0 virtual addresses.
Multi-byte values are big-endian unless a field states otherwise. Landscape scripts embed truncated
object names, while object and texture records store CRC-32 IDs derived from full names. Full names
reconstructed from IDs are not themselves ROM filenames; loader strings supply some bank names.
**Hypothesis:**
the `oddballs` component of a compiled record path is an earlier project name.

## 2. Program and storage architecture

### 2.1 Boot and executable layout

Verified by disassembly:

- Entry stub (ROM `0x1000` = `0x80100000`): `sp = 0x8025F158`, clears BSS `[0x801F5680, 0x802B0D10)`, then calls `0x80139DE8`.
- **Main image:** ROM `0x1000..0xF6680` → `0x80100000..0x801F5680` (vaddr = ROM − 0x1000 + 0x80100000). It fits in
  the 1 MiB that IPL3 copies, so nothing is decompressed or relocated at boot, and there are no code overlays.
  The code retains frame pointers and repeatedly reloads stack values.
- ROM `0xF6680..0xF6780`: `$Revision: 1.17 $` / `$Revision: 1.49 $` strings copied into what becomes BSS and zeroed
  (**HYPOTHESIS**: linker leftover).
- Cartridge reads: `0x801D1C50` (block read through the PI handle `0x8025D558`) and `0x801C7430` (message wait).

### 2.2 Memory and address mapping

The main image maps ROM `[0x1000, 0xF6680)` to KSEG0 `[0x80100000, 0x801F5680)` by adding `0x800FF000`.
Boot BSS spans `[0x801F5680, 0x802B0D10)`. Bank pointers are bank-relative on ROM and relocated with
`(pointer & 0xFFFFFF) + bankBase` at load. The observed game runs within base 4 MiB RDRAM.

### 2.3 ROM map and asset organization

Verified by disassembly and ROM-byte coverage: there is no central directory. Loader functions embed
asset ROM-range constants (`0xB0xxxxxx`); landscapes and controller recordings form size-linked chains.

| ROM range | Stored size | Decoded size | Destination | Compression | Contents |
|---|---:|---:|---|---|---|
| `[0x000000, 0x001000)` | `0x1000` | same | IPL3 | None | Header and boot code. |
| `[0x001000, 0x0F6680)` | `0xF5680` | same | `0x80100000` | None | Main image. |
| `[0x0F6680, 0x0F6780)` | `0x100` | same | BSS, then cleared | None | Revision strings. |
| `[0x0F6780, 0x2607C0)` | `0x16A040` | Varies | Allocated banks | FLA2 | 19 addressed texture banks and one unreferenced bank. |
| `[0x2607C0, 0x492500)` | `0x231D40` | Varies | Allocated banks | FLA2 | 56 object banks. |
| `[0x492500, 0x4D5890)` | `0x43390` | same | Level buffer | None | 48 landscape files. |
| `[0x4D58A0, 0x4E3EE0)` | `0xE640` | same | Audio banks | None | Music and effects pointer banks. |
| `[0x4E3EE0, 0x6F8720)` | `0x214840` | same | Audio banks | None | Music and effects wave banks. |
| `[0x6F8720, 0x77BBE0)` | `0x834C0` | same | Song buffer | None | 60 libmus songs. |
| `[0x77BBE0, 0x77DE20)` | `0x2240` | same | Record buffer | None | 44 `.moo` controller recordings. |
| `[0x77DE20, 0x800000)` | `0x821E0` | same | — | None | Zero padding. |

All nonzero bytes are accounted for by the program or an asset region. The revision-string region is not
loaded as an asset.

#### Texture banks

`LoadTexBank(id)` (prints `Loaded texture bank %s [%d]`); all FLA2.

| id | name | ROM | unpacked |
|---|---|---|---|
| 0 | TITLE_TEX_BANK | `0x0F6780-0x115240` | 0xA71F4 |
| 1 | LEVELEND_TEX_BANK | `0x1B0AC0-0x1E5F40` | 0xA85DC |
| 2 | GENERIC_TEX_BANK | `0x115240-0x1266C0` | 0x33BAC |
| 3 | ATLANTIS_TEX_BANK | `0x1266C0-0x1373C0` | 0x1C444 |
| 4 | CARNIVAL_TEX_BANK | `0x1373C0-0x143B00` | 0x1F7F4 |
| 5 | OOTW_TEX_BANK | `0x180F00-0x18F800` | 0x24794 |
| 6 | PIRATES_TEX_BANK | `0x143B00-0x157A80` | 0x22734 |
| 7 | PREHISTORIC_TEX_BANK | `0x157A80-0x16BEC0` | 0x1FBBC |
| 8 | FORTRESS_TEX_BANK | `0x16BEC0-0x180F00` | 0x22DA4 |
| 9 | HUB_TEX_BANK | `0x18F800-0x1B0AC0` | 0x361F4 |
| 10 | FONT_TEX_BANK | `0x1E5F40-0x1EA940` | 0x14A54 |
| 11 | CAMEO_TEX_BANK | `0x1EA940-0x206500` | 0x405F4 |
| 12 | PRESENT_TEX_BANK | `0x23AB40-0x24DEC0` | 0x35554 |
| 13 | FLYTHRU_TEX_BANK | `0x24DEC0-0x250880` | 0x6274 |
| 14 | LEVELEND_TEX_BANK (second set, different data) | `0x206500-0x23AB40` | 0xA85DC |
| 15 | CKBONUS_TEX_BANK | `0x250880-0x251FC0` | 0x31B4 |
| 16 | CKCHEAT1_TEX_BANK | `0x251FC0-0x253C00` | 0x31B4 |
| 17 | CKCHEAT2_TEX_BANK | `0x253C00-0x255740` | 0x31B4 |
| 18 | RCDEMO_TEX_BANK | `0x25EFC0-0x2607C0` | 0x5DBC |

LEVELEND 1 or 14 is chosen by a byte near `0x801E7534` (< 4 → 1; **HYPOTHESIS**: two end-of-level picture sets).
CKBONUS / CKCHEAT1 / CKCHEAT2 replace each other for level 19 (Carnival Bonus) when cheat bit 21 (SECRET CHEAT, [Unused and hidden content](#6-unused-and-hidden-content)) is
set, alternating through `0x801E7590` (disassembly).

#### Object banks

`LoadObjBank(id)` (prints `Loaded object bank %s (size %d)`); ids without a case print
`ERROR: no object bank specified....`. All FLA2.

| id | name | ROM | | id | name | ROM |
|---|---|---|---|---|---|---|
| 0 | SYSTEM | `0x47D680-0x47DA80` | | 38 | PIRATES_SHARED | `0x2E8BC0-0x2EE880` |
| 1 | GENERIC | `0x2607C0-0x282600` | | 39 | PIRATES_L1 | `0x2EE880-0x2F8580` |
| 2 | HUB_PART1 | `0x37EF00-0x38BC40` | | 40 | PIRATES_L2A | `0x2F8580-0x304800` |
| 3-9 | HUB_PART2..HUB_PART8 | `0x40A540`, `0x417340`, `0x4239C0`, `0x430040`, `0x43C6C0`, `0x448D00`, `0x455640`, each to the next, the last to `0x462040` | | 41, 42 | *(no case)* | |
| 10 | CAVE | `0x3DB380-0x3E15C0` | | 43 | PIRATES_L3B | `0x38BC40-0x396D80` |
| 11 | ASSAULT COURSE | `0x462040-0x465DC0` | | 44 | PIRATES_BOSS | `0x304800-0x314A40` |
| 12 | ATLANTIS_SHARED | `0x282600-0x287700` | | 45 | PIRATES_BONUS | `0x314A40-0x316400` |
| 13 | ATLANTIS_L1 | `0x287700-0x28C700` | | 46 | PREHISTORIC_SHARED | `0x316400-0x320C80` |
| 14 | ATLANTIS_L2 | `0x28C700-0x293680` | | 47 | PREHISTORIC_L1A | `0x320C80-0x327DC0` |
| 15 | ATLANTIS_L3A | `0x293680-0x2A0200` | | 48 | *(no case)* | |
| 16 | *(no case)* | | | 49 | PREHISTORIC_L2A | `0x327DC0-0x330840` |
| 17 | ATLANTIS_BOSS | `0x2A0200-0x2B0440` | | 50, 51 | *(no case)* | |
| 18 | ATLANTIS_BONUS | `0x2B0440-0x2B1B40` | | 52 | PREHISTORIC_L3B | `0x396D80-0x39E280` |
| 19 | CARNIVAL_SHARED | `0x2B1B40-0x2B92C0` | | 53 | PREHISTORIC_BOSS | `0x330840-0x337D80` |
| 20 | CARNIVAL_L1 | `0x2B92C0-0x2C5980` | | 54 | PREHISTORIC_BONUS | `0x337D80-0x33C5C0` |
| 21 | CARNIVAL_L2A | `0x2C5980-0x2CCA00` | | 55 | FORTRESS_SHARED | `0x33C5C0-0x3458C0` |
| 22 | *(no case)* | | | 56 | FORTRESS_L1A | `0x3458C0-0x351400` |
| 23 | CARNIVAL_L3A | `0x2CCA00-0x2D6980` | | 57 | *(no case)* | |
| 24 | *(no case)* | | | 58 | FORTRESS_L2A | `0x351400-0x35DDC0` |
| 25 | CARNIVAL_BOSS | `0x2D6980-0x2E6540` | | 59, 60 | *(no case)* | |
| 26 | CARNIVAL_BONUS | `0x2E6540-0x2E8BC0` | | 61 | FORTRESS_L3B | `0x35DDC0-0x369000` |
| 27 | OOTW_SHARED | `0x3D3D80-0x3DB380` | | 62 | FORTRESS_BOSS | `0x36CBC0-0x37A100` |
| 28 | *(no case)* | | | 63 | FORTRESS_BONUS | `0x369000-0x36CBC0` |
| 29 | OOTW_L2A | `0x39E280-0x3AB800` | | 64 | HUB_SHARED | `0x37A100-0x37EF00` |
| 30 | OOTW_L2B | `0x3AB800-0x3B4540` | | 65 | INTRO | `0x3E15C0-0x402540` |
| 31 | OOTW_L3 | `0x3B4540-0x3BF440` | | 66 | OUTRO | `0x46B180-0x47D680` |
| 32 | *(no case)* | | | 67 | WAYROOM | `0x402540-0x40A540` |
| 33 | OOTW_BOSS1 | `0x3BF440-0x3CB680` | | 68 | PRESENTATION | `0x47DA80-0x485880` |
| 34, 36, 37 | *(no case)* | | | 69 | FLYTHRU | `0x485880-0x492500` |
| 35 | OOTW_BONUS | `0x3CFB40-0x3D3D80` | | 70 | TITLE_BANK | `0x465DC0-0x46B180` |
| | | | | 71 | TWEEN | `0x3CB680-0x3CFB40` |

#### Landscape chain

ROM `[0x492500, 0x4D5890)` contains 48 variable-length entries, each with a `0x0C`-byte header:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `u32` | `size` | Entire entry length, including header. |
| `0x04` | `0x08` | `u8[8]` | `name` | At most seven characters plus NUL. |
| `0x0C` | `size - 0x0C` | `u8[]` | `script` | Landscape command stream. |

Names include `ATBOSS.`, `ACOURSE`, and `TWEEN.l`. `0x80152498(n)` walks `n` entries from
`0xB0492500` by their sizes (failing with `LEVEL UNPLAYABLE - NO LEV FILE` past the end) and copies the entry; it is
not compressed. The parser (`0x80182090`) starts after the name string. **Landscape index = level index** (verified:
runtime a0 = 43, 44, 46, 0, 9 for PRESENT, the title fly-through, the intro, the hub and the assault course). The body
is the level script ([Level data](#3-level-data)).

#### Controller-record chain

ROM `[0x77BBE0, 0x77DE20)` contains 44 entries walked like landscapes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `u32` | `size` | Entire entry length, including this field. |
| `0x04` | `size - 0x04` | `u8[]` | `recordData` | Controller record body. |

`0x801201AC` loads the entry with the level index when demo mode is 2. Record 43 plays during
the boot presentation; RAM capture places its body at `0x803FEF80`. **Hypothesis:** the body
uses 4-byte `{frame, buttons}` pairs of two `u16` fields. Only records 10, 15, 16, 20, 25, 30, 35, 39 (and 43) are distinct recordings; the rest are
placeholders ([Unused and hidden content](#6-unused-and-hidden-content)). Attract demos (`0x80114664`, table `0x801005E0`) start levels 10, 16, 20, 25 and 30 (disassembly).

### 2.4 Compression formats

The FLA2 wrapper uses a 64-byte-aligned stored stream. Its token grammar and reference codec
are specified in [FLA2](./compression/fla2.md). The game-specific container is:

The FLA2 stream has an 8-byte header followed by variable-length tokens. The stored file ends at
the next 64-byte boundary.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `u8[4]` | `magic` | ASCII `FLA2`. |
| `0x04` | `0x04` | `u32` | `decodedSize` | Little-endian decoded byte count. |
| `0x08` | variable | `u8[]` | `stream` | Flag bytes and literal/match tokens through the end marker. |
- The decoded-size field is little-endian, unlike the ROM's other multi-byte fields.
- The stored stream is zero-padded to the next 64-byte ROM boundary.
Verified by disassembly and full-corpus decoding: all 76 FLA2 streams reach their end marker and produce
exactly the byte count in the header. Two independent decoder implementations produce identical SHA-1
digests for every output.

### 2.5 Loading process

Verified by disassembly and runtime load traces:

- **File helpers:**
  - `0x80141C2C(romStart, romEnd)` → unpacked size: reads 8 bytes; if they start `FLA2`, the little-endian u32 at +4,
    else `end − start`.
  - `0x80141DD8(dest, romStart, romEnd)`: the common file load. For `FLA2` files it reads the compressed bytes into a
    temporary allocation (`0x8013FCDC` alloc, `0x80141720` free) and calls the decompressor `0x8012C3BC(src + 8,
    dest)`; otherwise a plain copy. Verified at runtime: every texture bank, object bank, landscape, song and demo
    record in the boot/title/hub/assault-course load traces goes through it (67 observed calls).
- **Name hash** `0x80139CA0(char*)`: table-driven CRC-32, polynomial `0x04C11DB7`, MSB-first, **initial value 0, no
  final XOR** (table built at run time at `0x8020B2A0`). Objects and textures are looked up by this hash of their full
  names. Verified by value: `crc("hoop.ndo") = 0x70210547`, the ID stored beside a truncated name in landscape files.
- **Globals:** u8 `0x801E7530` game mode (1 menus, 4 in game; verified RAM), u8 `0x801E7531` current level index
  (verified RAM: 0 hub, 9 assault course, 0x2C title/menus), u8 `0x801E7533` current world (disassembly),

Levels are started by `0x8011FF40(level)` (20 callers: menu, continue, portals, attract demos, level select), which calls
`0x8011D88C(level)`; that function stores the level in `0x801E7531` (at `0x8011D900`) and runs the load below (verified:
disassembly and runtime).

1. texture bank 2 GENERIC (in demo mode also 18 RCDEMO);
2. levels < 46: texture bank = the world's (42 WAYROOM: the hub's; 43 PRESENT: 12), object bank = the world's shared
   bank; 46/47 (INTRO/OUTRO): texture bank 11 CAMEO;
3. level 19: texture bank 15, 16 or 17;
4. level 44: texture bank 13 and object bank 69 FLYTHRU; every other level: object bank 1 GENERIC;
5. the level's object bank (+0x28), the landscape, the song (+0x35).

Verified against RAM and frames: boot loads PRESENT (43) with OOTW_SHARED, GENERIC, PRESENTATION and record 43; the title screen is
level 44 (HUB_SHARED, FLYTHRU, HUB_PART8; textures GENERIC, HUB, FLYTHRU); a new game plays INTRO (46); START skips to
HUB 1 (0); PRACTICE on the main menu loads the ASSAULT COURSE (9). Every screen also loads FONT_TEX_BANK and the SYSTEM
object bank.

### 2.6 Revision differences

Only USA revision 0 was examined. PAL addresses, timing, and assets require separate verification;
the program contains a 50 Hz audio path and a PAL-specific tempo adjustment for song 26.

## 3. Level data

A level is **not** a world mesh plus objects: everything visible is an object-bank model placed by the level's
landscape script ([Level container](#32-level-container)). The level's texture banks (GENERIC + the world's) and object banks (GENERIC + the world's shared
bank + the level's own, [Loading process](#25-loading-process)) supply the models and textures; objects and textures are referenced by the CRC-32 of their
file names ([Program and storage architecture](#2-program-and-storage-architecture)).

### 3.1 Level catalog and identifiers

Verified from ROM bytes and disassembly: the table at ROM `0xE7910` (VRAM `0x801E6910`)
contains 48 records of stride `0x38`. Its index is both the level and landscape index.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x18` | `u8[24]` | `name` | NUL-terminated debug name, e.g. `ATLANTIS 1`. |
| `0x18` | `0x10` | `u8[16]` | `text` | Percentage or empty string; **Hypothesis:** completion threshold. |
| `0x28` | `0x04` | `u32` | `objBank` | Level-specific object bank ID. |
| `0x2C` | `0x04` | `u32` | `slot` | `0`–`0x1D` for world levels, `0x1E` otherwise; **Hypothesis:** save slot. |
| `0x30` | `0x04` | `u32` | `unknown_30` | `800`–`5000`, copied to `0x801EF480`; purpose unknown. |
| `0x34` | `0x01` | `u8` | `unknown_34` | Zero in the examined records. |
| `0x35` | `0x01` | `u8` | `songId` | `0` means silence. |
| `0x36` | `0x02` | `s16` | `unknown_36` | `-1` or a bonus duration-like value; **Hypothesis:** time limit. |

The world table at ROM `0xE8390` (VRAM `0x801E7390`) has seven records of stride `0x18`:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x01` | `u8` | `sharedObjectBank` | Shared object bank ID. |
| `0x01` | `0x01` | `u8` | `textureBank` | World texture bank ID. |
| `0x02` | `0x01` | `u8` | `level1` | First adventure level. |
| `0x03` | `0x01` | `u8` | `level2` | Second adventure level. |
| `0x04` | `0x01` | `u8` | `level3` | Third adventure level. |
| `0x05` | `0x01` | `u8` | `boss` | Boss level. |
| `0x06` | `0x01` | `u8` | `bonus` | Bonus level. |
| `0x07` | `0x01` | `u8` | `unknown_07` | Equals `level3` in examined records. |
| `0x08` | `0x10` | `u8[16]` | `backdropName` | NUL-terminated texture name. |

| world | shared objects | textures | levels | backdrop |
|---|---|---|---|---|
| 0 hub | 64 HUB_SHARED | 9 HUB | – | `endlev2.bmp` |
| 1 Atlantis | 12 | 3 | 10 11 12 13 14 | `atlantis.bmp` |
| 2 Carnival | 19 | 4 | 15 16 17 18 19 | `carnivbg.bmp` |
| 3 Pirates | 38 | 6 | 20 21 22 23 24 | `pirmoon.bmp` |
| 4 Prehistoric | 46 | 7 | 25 26 27 28 29 | `prehist.bmp` |
| 5 Fortress of Fear | 55 | 8 | 30 31 32 33 34 | `fearme.bmp` |
| 6 Out of This World | 27 | 5 | 35 36 37 38 41 | `space2.bmp` |

`WorldOf(level)` (`0x80124F2C`): 0..9, 44, 45 → 0; 10..14 → 1; 15..19 → 2; 20..24 → 3; 25..29 → 4; 30..34 → 5;
35..41, 43 → 6; 42 keeps the current world; 46, 47 → 7 (no record).

On-screen names are composed from the world names (`ATLANTIS`, `CARNIVAL`, `PIRATES`, `PREHISTORIC`, `FORTRESS OF
FEAR`, `OUT OF THIS WORLD`) and `LEVEL 1/2/3`, `BOSS`, `BONUS`; the hub is `THE CASTLE` (strings verified in ROM; how
the game combines them on screen was not observed: practice warps and the hub show no title card; **HYPOTHESIS**). The
level table's own names are debug names.

Suggested viewer list (index = level index = landscape index; "obj bank" is the level's own bank; kinds map onto
`LevelKind`; names in quotes are composed from the ROM strings, the rest are the table's debug names):

| idx | table name | file | world | viewer name | kind | obj bank | song | enemies | fog |
|---|---|---|---|---|---|---|---|---|---|
| 0-7 | HUB 1..HUB 8 | HUB1..HUB8 | castle | "The Castle" part 1..8 | hub | HUB_PART1..8 | 28 28 29 30 31 32 32 33 | 11–19 each | yes |
| 8 | CAVE | CAVE | castle | The Castle: cave (HYPOTHESIS) | hub | CAVE | – | 3 | no |
| 9 | ASSAULT COURSE | ACOURSE | castle | "Training" / Assault Course (runtime: PRACTICE on the main menu) | other | ASSAULT COURSE | 25 | 6 | yes |
| 10 | ATLANTIS 1 | AT1 | Atlantis | "Atlantis Level 1" | adventure | ATLANTIS_L1 | 1 | 8 | yes |
| 11 | ATLANTIS 2 | AT2 | Atlantis | "Atlantis Level 2" | adventure | ATLANTIS_L2 | 2 | 7 | yes |
| 12 | ATLANTIS 3 | AT3A | Atlantis | "Atlantis Level 3" | adventure | ATLANTIS_L3A | 3 | 15 | yes |
| 13 | ATLANTIS BOSS | ATBOSS | Atlantis | "Atlantis Boss" | boss | ATLANTIS_BOSS | 4 | 4 | yes |
| 14 | ATLANTIS BONUS | ATBONUS | Atlantis | "Atlantis Bonus" | bonus | ATLANTIS_BONUS | 58 | 4 | yes |
| 15 | CARNIVAL 1 | CK1 | Carnival | "Carnival Level 1" | adventure | CARNIVAL_L1 | 5 | 13 | yes |
| 16 | CARNIVAL 2 | CK2A | Carnival | "Carnival Level 2" | adventure | CARNIVAL_L2A | 6 | 7 | yes |
| 17 | CARNIVAL 3 | CK3A | Carnival | "Carnival Level 3" | adventure | CARNIVAL_L3A | 7 | 14 | yes |
| 18 | CARNIVAL BOSS | CKBOSS | Carnival | "Carnival Boss" | boss | CARNIVAL_BOSS | 8 | 2 | no |
| 19 | CARNIVAL BONUS | CKBONUS | Carnival | "Carnival Bonus" | bonus | CARNIVAL_BONUS | 58 | – | no |
| 20 | PIRATES 1 | PC1 | Pirates | "Pirates Level 1" | adventure | PIRATES_L1 | 9 | 16 | yes |
| 21 | PIRATES 2 | PC2A | Pirates | "Pirates Level 2" | adventure | PIRATES_L2A | 10 | 10 | yes |
| 22 | PIRATES 3 | PC3B | Pirates | "Pirates Level 3" | adventure | PIRATES_L3B | 11 | 12 | yes |
| 23 | PIRATES BOSS | PCBOSS | Pirates | "Pirates Boss" | boss | PIRATES_BOSS | 12 | 4 | no |
| 24 | PIRATES BONUS | PCBONUS | Pirates | "Pirates Bonus" | bonus | PIRATES_BONUS | 58 | 1 | yes |
| 25 | PREHIST 1 | PH1A | Prehistoric | "Prehistoric Level 1" | adventure | PREHISTORIC_L1A | 13 | 4 | yes |
| 26 | PREHIST 2 | PH2A | Prehistoric | "Prehistoric Level 2" | adventure | PREHISTORIC_L2A | 14 | 7 | yes |
| 27 | PREHIST 3 | PH3B | Prehistoric | "Prehistoric Level 3" | adventure | PREHISTORIC_L3B | 15 | 12 | yes |
| 28 | PREHIST BOSS | PHBOSS | Prehistoric | "Prehistoric Boss" | boss | PREHISTORIC_BOSS | 16 | 2 | yes |
| 29 | PREHIST BONUS | PHBONUS | Prehistoric | "Prehistoric Bonus" | bonus | PREHISTORIC_BONUS | 58 | 1 | yes |
| 30 | FEAR 1 | FF1A | Fortress of Fear | "Fortress of Fear Level 1" | adventure | FORTRESS_L1A | 17 | 8 | yes |
| 31 | FEAR 2 | FF2A | Fortress of Fear | "Fortress of Fear Level 2" | adventure | FORTRESS_L2A | 18 | 4 | yes |
| 32 | FEAR 3 | FF3B | Fortress of Fear | "Fortress of Fear Level 3" | adventure | FORTRESS_L3B | 19 | 7 | yes |
| 33 | FEAR BOSS | FFBOSS | Fortress of Fear | "Fortress of Fear Boss" | boss | FORTRESS_BOSS | 20 | 2 | no |
| 34 | FEAR BONUS | FFBONUS | Fortress of Fear | "Fortress of Fear Bonus" | bonus | FORTRESS_BONUS | 58 | 3 | yes |
| 35 | SPACE 1 | OW2A | Out of This World | "Out of This World Level 1" | adventure | OOTW_L2A | 21 | 7 | yes |
| 36 | SPACE 2 | OW2B | Out of This World | "Out of This World Level 2" | adventure | OOTW_L2B | 22 | 8 | yes |
| 37 | SPACE 3 | OW3 | Out of This World | "Out of This World Level 3" | adventure | OOTW_L3 | 23 | 6 | yes |
| 38 | SPACE BOSS 1 | OWBOSS1 | Out of This World | "Out of This World Boss" (stage 1) | boss | OOTW_BOSS1 | 24 | 2 | no |
| 39 | SPBTWEEN | TWEEN | Out of This World | Out of This World Boss (between stages; HYPOTHESIS) | boss | TWEEN | 24 | 2 | yes |
| 40 | SPACE BOSS 2 | OWBOSS3 | Out of This World | "Out of This World Boss" (stage 2) | boss | OOTW_BOSS1 | 24 | 2 | no |
| 41 | SPACE BONUS | OWBONUS | Out of This World | "Out of This World Bonus" | bonus | OOTW_BONUS | 58 | – | yes |
| 42 | WAYROOM | WAYROOM | current | Way room (HYPOTHESIS) | other | WAYROOM | – | – | no |
| 43 | PRESENT | PRESENT | – | Presentation (runtime: the boot logo scene) | other | PRESENTATION | 59 | – | yes |
| 44 | FLYTHRU | FLYTHRU | castle | Title fly-through (runtime: the title screen) | other | HUB_PART8 + FLYTHRU | 33 | 13 | no |
| 45 | FLYTHRU2 | FLYTHRU | castle | Fly-through 2 (HYPOTHESIS) | other | HUB_PART8 | 33 | 20 | no |
| 46 | INTRO | INTRO | – | Intro cutscene (runtime) | other | INTRO | 26 | – | yes |
| 47 | OUTRO | OUTRO | – | Ending cutscene | other | OUTRO | 27 | – | no |

Enemy counts are the `83` records ([Behaviors and triggers](#44-behaviors-triggers-and-scripted-objects)); fog "no" = `A5` with `on = 0` or no `A5` command ([Environment](#37-environment-sky-fog-and-lighting)). Fly-throughs and
cutscenes can be omitted from the viewer or listed last.

---------------------------------------------------------------------------------------------------

### 3.2 Level container

- A landscape file is the chain entry ([Landscape chain](#landscape-chain)) followed by a stream of **big-endian u16 opcodes with inline arguments**,
  ended by `7D00`. The parser offers each opcode to 11 handler functions in turn, then to inline cases.
- **All 48 files walk exactly to their end word** with the table below (89 opcodes in use). Strings are fixed 8-byte
  truncated names stored next to the CRC id of the full name (`hoop.nd` + crc(`hoop.ndo`)); vectors are three f32.
- Six opcodes have variable length:
  - `95` Condition: `u16 type`; types 34..41 carry {28, 24, 16, 24, 16, 24, 16, 20} bytes, the others 4 (`0x801910AC`).
  - `96` Action: `u16 type`; types 70..77 and 84..86 carry {6, 6, 6, 14, 10, 2, 2, 14, 30, 6, 12} bytes, 53 and 59..64
    carry 12, 79 carries 8, the others 0; then a 12-byte tail (`0x80191024`, switch `0x80184CB8`).
  - `9A`/`9B`/`9C` camera records (`0x80197360`): `u16 type, u16`, then 24 (type 3), 12 (types 0, 1, 2, 9, 10, 11, 13, 22,
    23) or 4 bytes (4..8, 12, 14..21, 24), then `f32 ×4, u16`.
  - `AB` CameoInst: `u16 type` (table `0x80108DD0`), payload {10, 14, 18, 6, 6, 2, 4}, then `u16 ×2`.

Opcodes (size = argument bytes; uses = count in all 48 files; the debug tag strings the parser allocates with are quoted;
meanings without a label are from the handlers, **HYPOTHESIS** where marked):

| op | size | uses | meaning |
|---|---|---|---|
| `02` | 14 | 22 | `u16`, vec3 (HYPOTHESIS: camera or zone point) |
| `04` | 0 | 428 | Puzzle start |
| `05` / `06` | 0 | 32 / 3 | AND / OR |
| `07` / `08` | 2 | 125 / 30 | NUMTIMES / ANY |
| `5B` | 14 | 9 | "Plat_Push" |
| `5C` | 2 | 11 | platform flag |
| `5D` | 0 | 20 | platform without a model |
| `60`, `61` | 8 | 2, 1 | two f32 |
| **`62`** | 12 | 1110 | **"Platform"**: `u32 objectId, name[8]` (`exitpost.ndo` special-cased); the first command of every file places `hoop.ndo` |
| `63` | 6 | 90 | `u16, f32` (HYPOTHESIS: "Plat_Rest") |
| `64` | 0 | 146 | end of a platform block (HYPOTHESIS) |
| `65` | 18 | 59 | "Plat_Dest": `u16 ×3, u32 debrisId, name[8]` (breakable) |
| `66 68 6A 6E 6F 71` | 0 12 2 6 2 2 | 2 15 162 3 527 110 | platform parameters |
| `67` | 8 | 49 | `u16, u16, f32` |
| **`6B`** | 14 | 761 | "Path_Point": `u16`, vec3 |
| `6C` / `6D` | 4 | 332 / 346 | path f32 parameters ("Plat_Path") |
| `70` | 16 | 21 | "Plat_Spin" with blur |
| `72` | 24 | 10 | "Plat_Conf" |
| `75 76` | 18 4 | 21 3 | "Plat_Orbit" and its parameter |
| `7C 7D` | 4 6 | 18 5 | platform parameters |
| **`79`** | 12 | 263 | platform **scale** vec3 |
| `7B 7F 80 81` | 0 10 24 28 | 42 410 18 5 | spin variants |
| `82` | 0 | 53 | spike |
| `83` / `84` | 20 / 0 | 345 / 345 | Enemy placement and closing record; see [enemy payload](#44-behaviors-triggers-and-scripted-objects). |
| **`85`** | 4 | 468 | "GaribGp" (garib group) |
| **`86`** | 16 | 1507 | **Garib**: vec3, `u16 type, u16` |
| `87` | 18 | 34 | `u16 ×3`, vec3 |
| `89 8B` | 20 30 | 17 2 | "Plat_Tele", "Plat_Magnet" |
| `8C` | 52 | 13 | wind |
| **`91`** | 24 | 168 | **"Bkg_Actor"**: `u32 objectId, name[8]`, vec3 position; no collision |
| **`92`** | 24 | 1990 | **"Land_Actor"**: same; collides |
| **`93`** | 12 | 382 | actor **rotation**: Euler angles in radians ([Placement records](#41-placement-records)) |
| **`94`** | 12 | 343 | actor **scale** vec3 |
| `95` / `96` | var | 522 / 876 | "Condition" / "Action" |
| **`97`** | 14 | 97 | Directional light; see field table below. |
| **`98`** | 6 | 49 | Ambient colour; see field table below. |
| **`99`** | 26 | 31 | Backdrop layer; see field table below. |
| `9A 9B 9C` | var | 1386 109 367 | camera records ("CamCond", "CamAction") |
| **`A0`** | 62 | 32 | **"Wtr_Actor"** (water): vec3, vec3, f32 ×3, `u16`, `u32 objectId, name[8]`, vec3 position |
| `A1` | 24 | 7 | AABB (HYPOTHESIS: zone) |
| `A2` | 30 | 61 | "Vent" |
| **`A5`** | 8 | 48 | Fog and projection far plane; see field table below. |
| **`A6`** | 12 | 782 | platform **position** vec3 (adds the parent platform's position when linked) |
| `AA` / `AB` | 0 / var | 19 / 152 | "Cameo" / "CameoInst" (cutscene actors) |
| `B5` | 48 | 17 | "Buzzer" |
| `BB` | 14 | 33 | tip (Mr Tip hint) |
| `BC` | 24 | 8 | actor like `91`/`92` with type 63 (INTRO, OUTRO, Carnival Boss) |
| `BD` | 6 | 4 | `u16 ×3` (HYPOTHESIS: level ambience sound) |
| `BE` | 32 | 102 | `u16 id, u16 volume, u16, u16, f32 ×6` (HYPOTHESIS: positional sound emitter) |
| `BF` | 6 | 23 | "CamColSph" |
| `A3 A4 A7 A8 A9 B3 B4 B6..B9 C1..C8` | 4 0 2 4 4 0 2 4 4 0 0 6 | 81 32 8 126 6 32 37 12 4 7 296, 119 168 23 1 12 0 21 47 | not decoded |

Opcodes defined by the handlers but used by no file: `03` (20), `58 59 5A 73 74` (Plat_MvSpn variants), `69` (Plat_Cat),
`77`, `78`, `7A` (Plat_Str), `7E`, `8A` (Plat_Fan), `8D` (Rope_Plat), `8E`, `8F` (Orbit_Plat), `90` (Sine_Plat), `9D`,
`9E`, `9F`, `BA`, `C0` (PlatAnim), `C6` ([Unused and hidden content](#6-unused-and-hidden-content)).

Opcode `99` has a 26-byte payload:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `u32` | `textureId` | Panorama texture ID. |
| `0x04` | `0x02` | `s16` | `x` | Horizontal origin. |
| `0x06` | `0x02` | `s16` | `y` | Vertical origin. |
| `0x08` | `0x02` | `s16` | `depth` | Layer-sort key. |
| `0x0A` | `0x10` | `u16[8]` | `params` | Scroll, scale, and placement parameters; individual meanings partly unresolved. |

Opcode `A5` has an 8-byte payload:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x01` | `u8` | `on` | Fog enable. |
| `0x01` | `0x01` | `u8` | `r` | Red fog channel. |
| `0x02` | `0x01` | `u8` | `g` | Green fog channel. |
| `0x03` | `0x01` | `u8` | `b` | Blue fog channel. |
| `0x04` | `0x02` | `u16` | `fogMin` | Near fog position. |
| `0x06` | `0x02` | `u16` | `far` | Projection far plane. |

Opcode `97` has a 14-byte payload and opcode `98` uses its first six bytes:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x02` | `u16` | `r` | Red light channel. |
| `0x02` | `0x02` | `u16` | `g` | Green light channel. |
| `0x04` | `0x02` | `u16` | `b` | Blue light channel. |
| `0x06` | `0x04` | `f32` | `a` | First direction angle (opcode `97` only). |
| `0x0A` | `0x04` | `f32` | `b` | Second direction angle (opcode `97` only). |

Placement state (disassembly): `91`/`92`/`BC` start an actor (`[0x801EFCF0]`) that the following `93`/`94` modify; `62`
and `5D` start a platform (a 384-byte object with an embedded actor at +0x80) that `A6`, `79` and the platform commands
modify.

### 3.3 Geometry

The mesh header is `0x24` bytes. Its pointers are bank-relative before load and relocated to RAM.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x02` | `s16` | `nFaces` | Triangle count. |
| `0x02` | `0x02` | `s16` | `nVerts` | Vertex count. |
| `0x04` | `0x04` | `u32` | `positions` | Pointer to `nVerts` triples of `f32` x/y/z. |
| `0x08` | `0x04` | `u32` | `indices` | Pointer to `nFaces` triples of `u16` vertex indices. |
| `0x0C` | `0x04` | `u32` | `normals` | Pointer to `nFaces` 4-byte signed-normal records; zero for display-list meshes. |
| `0x10` | `0x04` | `u32` | `uvs` | Pointer to three `u16` s/t pairs per face; zero for display-list meshes. |
| `0x14` | `0x04` | `u32` | `runtimeUvs` | RAM copy of `uvs`, scrolled for water. |
| `0x18` | `0x04` | `u32` | `colors` | Pointer to `nVerts` RGBA8 records. |
| `0x1C` | `0x04` | `u32` | `flags` | Pointer to `nFaces` `u8` flags (0–7); semantics unknown. |
| `0x20` | `0x04` | `u32` | `textureIds` | Pointer to `nFaces` `u32` texture IDs. |
- The 160 nodes without a display list are drawn from this list on the CPU (`0x80152A08..0x80152F8C`): three 16-byte
  vertices per face (positions truncated to s16, s/t copied, colour from +18, alpha = node alpha), one `G_TRI1` per face,
  the texture state rebuilt when the id changes (`0x80154300`). Frame state (verified RAM, Atlantis 1): texture scale 1.0
  (s, t in 1/32 texel), combiner `FC127FFF FFFFF638`, render mode `C81049D8` (fog, translucent surface), vertex alpha 0x80.
  They are mostly water, mist and fade planes.
- Nodes with a display list also carry a face list (1,969 of 2,762) with **exactly the same triangles** (52,604 faces =
  52,604 display-list triangles over all banks) but only positions and indices: the collision mesh ([Collision](#36-collision)).

### 3.4 Display lists and render state

- **F3DEX 1.x**, ending in `B8`. Commands used: `B6`/`B7` clear/set geometry mode (lighting; 926 lists are lit), `BE`
  CULLDL, `04` VTX, `BF` TRI1, `B1` TRI2, **`B2` MODIFYVTX**, `BA` (TEXTLUT RGBA16 or none), `E6`/`E7`/`E8` syncs, `FD`
  SETTIMG, `F0` LOADTLUT, `F5` SETTILE, `F3` LOADBLOCK, `F2` SETTILESIZE. No `G_DL`, `G_MTX`, combiner or render-mode
  commands: those come from the draw code ([Display lists and render state](#34-display-lists-and-render-state)).
- `G_VTX` addresses are bank offsets; vertices are standard 16-byte `Vtx` with **s = t = 0 in the file**.
- **All texture coordinates are set by `B2 14 00 vv <s16 s><s16 t>`** (G_MODIFYVTX with G_MWO_POINT_ST; vertex index × 2),
  39,890 of them, after the `G_VTX` and before or between the triangles that use them.
- **`G_SETTIMG` carries a texture id, not an address.** At load the game replaces w1 with the texture record's palette
  pointer when the next command is `E8` (a TLUT load), else with its texel pointer (`0x80150224`, `0x80150588`). It also
  marks the ball's textures by node name (`gball`, `cball`, `GShinL`, `GShinR`, `gbl_bt`).
- **`G_SETTILE`'s format field is always 0 (RGBA)**, also for CI4 and CI8 textures (15,494 × 4-bit, 416 × 8-bit tiles):
  the RDP decides colour-indexed from TEXTLUT and the texel size.
- Lit lists (`B7000000 00020000`) have normals in the vertex colour bytes; the game loads 2 directional lights and ambient
  every frame (verified RAM: NUMLIGHTS 2 and three MOVEMEMs from `0x80297C38`, `0x80297C58`, `0x802991A0`), from the
  landscape light commands ([Environment](#37-environment-sky-fog-and-lighting)). Light directions are world space.

World objects: geometry mode ZBUFFER | SHADE | SMOOTH | CULL_BACK | FOG, lit when the list sets G_LIGHTING; combiner
`FC127FFF FFFFF238` (modulate); render mode `C8112078` (fog, anti-aliased opaque surface); translucent nodes `C81049D8`.
Renders with back-face culling show no missing faces against the frames.

### 3.5 Textures and materials

Verified from all 20 decoded texture banks: a bank starts with `u32 count`, then `count`
variable-size records. Each record header is `0x24` bytes; `recordLength` includes the header,
texels, palette, and four-byte alignment.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `u32` | `id` | CRC-32 of texture name; e.g. `hubevil.bmp` hashes to `0x34B343D3`. |
| `0x04` | `0x04` | `u32` | `unknown_04` | Observed value 2. |
| `0x08` | `0x04` | `u32` | `unknown_08` | Observed zero. |
| `0x0C` | `0x02` | `u16` | `width` | Texel width. |
| `0x0E` | `0x02` | `u16` | `height` | Texel height. |
| `0x10` | `0x02` | `u16` | `logWidth` | Base-two logarithm of width. |
| `0x12` | `0x02` | `u16` | `logHeight` | Base-two logarithm of height. |
| `0x14` | `0x04` | `u32` | `recordLength` | Aligned byte length to the next record. |
| `0x18` | `0x04` | `u32` | `format` | 0 CI4, 1 CI8, 2 RGBA16. |
| `0x1C` | `0x04` | `u32` | `texelOffset` | Record-relative, normally `0x24`; made absolute on load. |
| `0x20` | `0x04` | `u32` | `paletteOffset` | Record-relative; zero for RGBA16. Palette entries are RGBA5551. |
- `LoadTexBank` registers a bank in one of 5 slots (`0x8028F7D8`); lookup by id (`0x8014FCF8`) searches slot 4 down to 0,
  so a later bank wins (disassembly).
- `texture.ts` `decodeRows` decodes all of them unchanged. Wrap modes are not in
  the record; they come from the display lists' `G_SETTILE`.
- Animated textures: none are described in the banks (water scrolls its face-list UVs at run time, [Geometry](#33-geometry)).

### 3.6 Collision

After the script, the loader walks the actor list. For each actor of type 60 (Land_Actor / Bkg_Actor) or 62 (platform)
whose root mesh has faces, it allocates `nFaces × 120` bytes ("Obj_Planes") and builds planes with
`0x801570AC(mesh, position, rotation, scale, planes, collide)`, where `collide = (type == 60 && !(flags & 4))` for actors;
a mesh without faces prints `WARNING - zero poly object %s`.
- **Collision geometry = the root meshes' face lists** of Land_Actors and platforms, in the instance transform. Bkg_Actors
  get planes but are marked non-colliding.
- The face lists are triangle-for-triangle the rendered triangles ([Geometry](#33-geometry)), so an overlay can reuse them or read
  `+04`/`+08` directly. No surface types were found in display-list meshes (their flags pointer is 0).
- Water, "Plat_Plane" and "CamColSph" (`BF`) are further collision-like objects (not decoded).

### 3.7 Environment, sky, fog, and lighting



- Opcode `A5` (fields in the [level-container table](#32-level-container)) sets `gSPFogPosition(fogMin, 1000)`
  (e.g. `BC000008 1900E800` for 980); fog
  colour = the adjusted colour below, projection far = `far`.
- The game adjusts the colour (`0x80181DC8`), per channel with `f = c / 255`, truncated and clamped to 255:
  `R' = c / (1 + 0.086 (1 − f))`, `G' = c (1 + 0.04 (1 − f))`, `B' = c / (1 + 0.06 (1 − f))`. This reproduces the colours in
  RAM exactly: HUB 1 `A41002` → `9F1001`, Atlantis 1 `C8C8FF` → `C4C9FF`, Atlantis Boss `C8F0FF` → `C4F0FF`.
- **Clear colour** = the adjusted fog colour (as a 16-bit fill colour; verified RAM), visible wherever the backdrop does
  not cover the sky.
- `on = 0` (no fog) in Cave, Carnival Boss and Bonus, Pirates Boss, Fear Boss, Space Boss 1 and 2, Wayroom, the
  fly-throughs and the Outro.
- HUB 1's red look (fog `A41002`, lights 200/160,100,100, ambient 110,70,70) is the level's data, not an emulator artefact
  (verified against a game frame).

Opcode `97` (twice per level) gives an RSP light with RGB colour and direction
`(cos a · sin b, −sin a, cos a · cos b)` (fits both HUB 1 lights, `(−67, 0, −107)` and `(0, 115, −53)` as s8);
Opcode `98` gives the ambient RGB colour. Both payload layouts are in the [level-container tables](#32-level-container).

The `99` command creates a 2D backdrop layer from a 160-texel-wide RGBA16 sky panorama.
Its payload is documented in the [level-container opcode table](#32-level-container).
31 of the 48 levels have one (HUB 1–8, Atlantis 2–3, Carnival 1–3, Pirates 1–3 and Boss,
Prehistoric 2, Fortress of Fear 1–3, Out of This World 1–3, Space Boss 1, TWEEN, Space Boss 2, both fly-throughs, Intro and
Outro); the other 17 show the clear colour (verified: walker; the frames show sky pictures in HUB 1, Carnival 2, Pirates 1
and Space 2, and none in Atlantis 1 and 3).
- Parser `0x801845A8` (disassembly): a 112-byte object; texture id → +72, x / y → f32 +12 / +16, depth → +84 (the list
  `0x8028F350` is kept sorted by it); the eight u16 → +102, +88, +90, +92, +94, +98, +100 and one more; a per-level tint
  byte from `0x801ED40C[level]` (levels < 8).
- Update `0x8014CFA0` (disassembly): width `W = texW · u88 >> 9`, height `H = texH · u90 >> 9` in quarter pixels, so a
  160-texel panorama at 4096 is 320 pixels, one screen wide; when `u98 ≠ 0`, `x = −yaw · u98 · W / π + W · u98`, wrapped
  into ±2W, so the panorama scrolls by two widths per full turn (it repeats twice around the horizon); y comes from the
  camera-transformed point (0, 0, 500) plus u102, halved, plus 136, clamped.
- **Not verified:** the draw itself. No texture rectangle or `G_SETTIMG` in the frame lists of the HUB 1, Pirates 1 and
  Space 2 dumps references the panorama texels, so the drawing path, and a fit against the camera-yaw captures, is open ([Known unknowns](#82-known-unknowns)). Viewer mapping (**HYPOTHESIS**): a `Backdrop` window of one panorama
  repeat across the screen for the start yaw.

`A0` water actors place face-list models ([Geometry](#33-geometry)), translucent (node alpha 0x80), whose UVs the game scrolls. Atlantis 1
and Atlantis Boss water matches the frames in colour and coverage.

### 3.8 Cameras and paths

- One world unit = one vertex unit. **Right-handed, Y up, no mirroring** (verified: renders of HUB 1, Atlantis 1 and
  Atlantis Boss from the game's camera match the frames with the same handedness; the view matrix in the frame display
  list is a proper rotation).
- The game projects with `guPerspective(fovY 45°, 4/3, near 6, far)`, where far comes from the level's fog command
  ([Environment](#37-environment-sky-fog-and-lighting); verified RAM: HUB 1 1200, Atlantis 1 1500, Atlantis Boss 2000). The view is multiplied onto the projection stack;
  objects push their own modelview (`01040040`).
- Object placement: `world = T(position) · R(rotation) · S(scale)` (verified: RAM modelviews of four HUB 1 actors equal
  the file values to 3 decimals).

- The first command of every landscape is `62 hoop.ndo` followed by `A6` position: the start hoop. In six start
  captures the game camera looks straight at it: the distance of the hoop from the camera's view ray is 54 (HUB 1), 11
  (Assault Course), 36 (Atlantis 1), 21 (Atlantis Bonus), 71 (Carnival 2) and 17 units (Pirates 1), at 100–256 units
  along the ray. Glover stands at the hoop (frames).
- In the boss levels it does not hold (Atlantis Boss 392, Prehistoric Boss 676 units off the ray); those captures show the
  boss intro camera framing the boss, so where Glover starts in boss arenas is open (**HYPOTHESIS**: placed by code).
- Start camera for the viewer: target = start hoop position; eye about 130 units back horizontally with the view pitched
  down about 17° (the forward vector's y is −0.30 in five of the captures). The facing direction differs per level and
  was not traced to data (**HYPOTHESIS**: the camera records `9A..9C` or the hoop's orientation); the eight captured
  cameras can be hard-coded for those levels.
- The start hoop itself is not visible in any of the eight start frames (verified: rendering only that instance gives the
  thin line near the horizon of the first Atlantis 1 render, absent from the frame), so the viewer should hide it.

## 4. Objects

### 4.1 Placement records

`q = identity; for axis in Y, Z, X (table 0x801EFC80 = 01 02 00): if angle ≠ 0: q = q ⊗ axisAngle(axis, angle)`
(Hamilton product, half angle = angle / 2). 45 of the 382 rotation commands turn about two or three axes. Verified in RAM:
the Atlantis 3 Land_Actor `at3bspr` (0.097, 2.637, −0.080 rad) has exactly this modelview in four dumps, as do the Y-only actors of HUB 1.

### 4.2 Object and model formats



An object-bank directory consists of 8-byte entries, terminated by an all-zero entry.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `u32` | `objectId` | CRC-32 of the full `.ndo` name. |
| `0x04` | `0x04` | `u32` | `recordOffset` | Bank-relative offset of an object record. |

Each object record has stride `0x1C`:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `u32` | `id` | Object ID. |
| `0x04` | `0x04` | `u32` | `unknown_04` | Unknown. |
| `0x08` | `0x04` | `u32` | `unknown_08` | Unknown. |
| `0x0C` | `0x04` | `u32` | `rootNode` | Bank-relative node pointer. |
| `0x10` | `0x04` | `u32` | `unknown_10` | Unknown. |
| `0x14` | `0x04` | `u32` | `unknown_14` | Unknown. |
| `0x18` | `0x04` | `u32` | `animation` | Bank-relative animation-block pointer; structure not decoded. |
Pointers are bank-relative; the loader relocates `(ptr & 0xFFFFFF) + base` (`0x80150110`). Lookup by id (`0x80151FD0`)
searches the 5 object-bank slots from slot 0 upward; the first match wins.

Each node has stride `0x3C`; pointers are bank-relative before relocation.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `u32` | `id` | CRC-32 node ID. |
| `0x04` | `0x08` | `u8[8]` | `name` | Truncated node name. |
| `0x0C` | `0x02` | `u16` | `alpha` | `0xFF` for opaque nodes, `0x80` for water and similar face-list nodes. |
| `0x0E` | `0x02` | `u16` | `nScaleKeys` | Number of scale keys. |
| `0x10` | `0x02` | `u16` | `nTransKeys` | Number of translation keys. |
| `0x12` | `0x02` | `u16` | `nRotKeys` | Number of rotation keys. |
| `0x14` | `0x04` | `u32` | `mesh` | Mesh pointer. |
| `0x18` | `0x04` | `u32` | `displayList` | Zero selects CPU face-list drawing. |
| `0x1C` | `0x04` | `u32` | `scaleKeys` | Pointer to 20-byte scale-key records. |
| `0x20` | `0x04` | `u32` | `translationKeys` | Pointer to 20-byte translation-key records. |
| `0x24` | `0x04` | `u32` | `rotationKeys` | Pointer to 20-byte quaternion-key records. |
| `0x28` | `0x04` | `u32` | `nSprites` | Sprite count. |
| `0x2C` | `0x04` | `u32` | `sprites` | Pointer to 24-byte sprite entries. |
| `0x30` | `0x04` | `u32` | `unknown_30` | Unknown. |
| `0x34` | `0x04` | `u32` | `firstChild` | Child-node pointer. |
| `0x38` | `0x04` | `u32` | `nextSibling` | Sibling-node pointer. |

Each key has stride `0x14`:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `f32` | `x` | X component. |
| `0x04` | `0x04` | `f32` | `y` | Y component. |
| `0x08` | `0x04` | `f32` | `z` | Z component. |
| `0x0C` | `0x04` | `f32` | `w` | W component; rotation keys use a quaternion. |
| `0x10` | `0x04` | `f32` | `time` | Key time. |
Node transform = parent · T(translation key 0) · R(rotation key 0) · S(scale key 0) (verified by render: multi-part
objects assemble correctly; animated models then stand in their first key, **HYPOTHESIS** that it is the rest pose).

### 4.3 Skeletons and animation

Node trees carry scale, translation, and rotation keys. Their animation blocks are not yet decoded; static rendering uses key 0.

### 4.4 Behaviors, triggers, and scripted objects

Opcode **`83`** places an enemy. Its 20-byte payload is:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x02` | `u16` | `type` | Enemy type index. |
| `0x02` | `0x02` | `u16` | `flag` | Behavior flag; semantics partly unknown. |
| `0x04` | `0x04` | `f32` | `x` | World X. |
| `0x08` | `0x04` | `f32` | `y` | World Y. |
| `0x0C` | `0x04` | `f32` | `z` | World Z. |
| `0x10` | `0x04` | `f32` | `yaw` | Radians; `-1.0` denotes no rotation. |

The parser case
(`li v0, 0x83` at `0x801827FC`) reads the fields and calls `SpawnEnemy(type, x, y, z, flag, yaw)` (`0x80191640`), which
allocates a 0x300-byte object, creates its actor from the model name `table[type]` (`0x801F00A8`, ROM `0xF10A8`),
applies the rotation and calls the per-type setup `0x80191284`. The `9A`/`9B`/`9C` records that follow up to the closing
`84` belong to that enemy (**HYPOTHESIS**: its behaviour/path records; the parser's earlier "camera" label comes from
the shared record reader).

Type table: 0–6 `X` (placeholder), 7 bovva, 8 cannon, 9 samtex, 10 mallet, 11 generalw, 12 lionfish, 13 chester, 14 keg,
15 reggie, 16 swish, 17 thrice, 18 robes, 19 fumble, 20 mike, 21 raptor, 22 crumpet, 23 tracey, 24 yoofow, 25 opec, 26
cymon, 27 sucker, 28 bugle, 29 dennis, 30 chuck, 31 hubchicken1, 32 frankie2, 33 kloset, 34 willy, 35 joff, 36 cancer, 37
kirk, 38 robot, 39 evilrobot, 40 spank, 41 babyspk2, 42 evilglove, 43 dibber, 44 brundle, 45 malcom, 46 spotty, 47 gordon,
48 sidney, 49 weevil, 50 chopstik, 51 butterfly, 52 spider, 53 bat, 54 frog, 55 dragfly, 56 boxthing, 57 bug, 58 nmefrog
(all `.ndo`).

- 36 of the 48 levels place enemies (345 in total). Every model is present in the object banks the level loads (verified:
  CRC lookup, 0 missing).
- The boss levels place their bosses this way: Atlantis Boss `joff`, `cancer`, `kirk`; Carnival Boss `kloset`; Pirates
  Boss `spank` and two `babyspk2`; Prehistoric Boss `willy`; Fortress of Fear Boss `frankie2`; Space Boss 1 `robot`;
  Space Boss 2 `evilrobot`; TWEEN `boxthing`. `evilglove` appears in every boss level and Atlantis Bonus; `hubchicken1`
  in every hub part and fly-through.
- Types 14 keg, 46 spotty, 57 bug and 58 nmefrog are placed by no landscape ([Unused and hidden content](#6-unused-and-hidden-content)).
- **Scale:** the f32 table `0x801EFDE8 + type × 12` (first float of 12-byte records; bat 0.05 … robot 0.5) is written to the
  actor scale (`0x80191870`). **Yaw:** −1.0 (constant `0x80109D3C`) means no rotation; any other value becomes the actor's
  Euler Y (`0x801918E8`) (disassembly). Verified by render: the Prehistoric Boss `willy` matches its frame in size, position
  and facing; the Atlantis Boss `evilglove` matches its position.
- Enemies stand in the first key frame of their nodes (animation not decoded).

Opcode **`86`** places a garib (the collectible). Its 16-byte payload is:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `f32` | `x` | World X. |
| `0x04` | `0x04` | `f32` | `y` | World Y. |
| `0x08` | `0x04` | `f32` | `z` | World Z. |
| `0x0C` | `0x02` | `u16` | `type` | Garib sprite type. |
| `0x0E` | `0x02` | `u16` | `flag` | Meaning unknown. |

The case (`li v0, 0x86`)
allocates a 176-byte sprite object (type at +0x0E, flag at +0x0F) and starts its sprite animation (`0x8014B7F0`) from a
16-byte sprite definition: `0x801EFD64 + type × 16`, and for type 0 the definition at `0x801EFD94` instead while cheat bit
13 (MAD GARIBS) is set. Types used: 0 (1,418 records, flag 0 or 1; the flag's meaning is HYPOTHESIS) and 2 (89 records). `85` (GaribGp) groups
the following garibs.

Sprite animations are verified from ROM bytes and texture-name CRCs. A definition has stride `0x10`:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `u32` | `animation` | Pointer to animation record. |
| `0x04` | `0x04` | `u8[4]` | `unknown_04` | Meaning unknown. |
| `0x08` | `0x02` | `u16` | `width` | `0x40` in examined definitions. |
| `0x0A` | `0x02` | `u16` | `height` | `0x40` in examined definitions. |
| `0x0C` | `0x04` | `u32` | `unknown_0C` | Meaning unknown. |

An animation record also has stride `0x10` and lies in `[0x801F1B24, 0x801F1D84)`:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `u32` | `frameTable` | Runtime frame-table pointer. |
| `0x04` | `0x04` | `u32` | `unknown_04` | Meaning unknown. |
| `0x08` | `0x08` | `u8[8]` | `name` | Truncated frame-name stem. |

Frame `k` addresses the texture named by the stem plus a two-digit index and `.bmp`
(38 of 39 records resolve, e.g. `trop0001..0016`,
`smk01..07`). Garib type 0 is `acard00` (the spinning garib card: 13 frames of 32×32 RGBA16 in the GENERIC bank), type 1
`ohno` (placed by no level), type 2 `marble` (8 frames), and MAD GARIBS uses `rgarib` (2 frames). Verified by render: the
garib cards over the Pirates 1 pier line up with the frame.

- Position = `A6`, or the first `6B` path point when there is no `A6` (verified by render: the Atlantis Boss
  exit door `exitdoo` has path points at y 700, 0, 500 and no `A6`; placed at y 700 it matches the frame).
- `79` scales a platform; `7F` spins it. **Hypothesis:** the `0x0A`-byte payload fields below
  are axis, initial angle, and speed. Parenting through
  `6F`/`A8` is not decoded. Moving platforms stand at their first position (`Instance.animated`); the Atlantis Bonus frame
  shows its turtles and crate elsewhere because they move.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x02` | `u16` | `axis` | **Hypothesis:** rotation axis. |
| `0x02` | `0x04` | `f32` | `angle` | **Hypothesis:** initial angle. |
| `0x06` | `0x04` | `f32` | `speed` | **Hypothesis:** angular speed. |
- Interactive platform objects over all 48 levels: `exitpost.ndo` (level exit, 21 levels), `exitdoo` (boss exit door, 5
  boss levels), `ballbut` / `glovebu` (ball and glove switches, 16 levels), `target`, `spikes`, `ballbit`, further `hoop`s,
  `crusher`, `magnet`, `smshblk` (breakable, `65`).

## 5. Audio

### 5.1 Audio storage and banks

| pointer bank (ROM) | name | waves | wave bank (ROM) | RAM copy | used for |
|---|---|---|---|---|---|
| `0x4D58A0-0x4DA9A0` | `nosfx.wbk` | 111 | `0x4E3EE0-0x607280` | `0x80077070` (runtime) | all music (`MusBankStartSong([0x80290418], song)` at `0x801780B4`) |
| `0x4DA9A0-0x4E3EE0` | `SFX.WBK` | 210 | `0x607280-0x6F8720` | `0x8007C170` (runtime) | 420 sound-effect streams (pointer table `0x801E9CB4`, priorities `0x801EA344`) |

The largest `base + length` among `nosfx.wbk` waves is `0x123382` within its `0x1233A0`-byte
wave bank; for `SFX.WBK` it is `0xF148F` within `0xF14A0` bytes. Initialization passes
`0xB04E3EE0` and `0xB0607280` as their respective wave-bank addresses.

### 5.2 Sequence format and driver

Both audio banks are libmus pointer banks (`N64 PtrTablesV2`) with libmus wave banks (`N64 WaveTables`); there is no
ALBank `.ctl`/`.tbl` and no MIDI. The player runs on libultra's synthesizer. Compared with the two revisions documented
in [Gex 64](GEX64.md#5-audio):

| aspect | Gex 64 (`libmus64.ts`) | **Glover** | Gex 3 / Global Assault (`libmus.ts`) |
|---|---|---|---|
| channel struct | 0x120 | **0x134** | 0x13C |
| commands | 42, `0x80..0xA9` | **43, `0x80..0xAA`** (jump table `0x801F40C0`, dispatch `0x801C15F8`) | 45, `0x80..0xAC` |
| song header | `u32 numChannels`; channel / volume / bend list offsets; envelope table; drum table | **same as Gex 64** (no version word, wave map or master track) | version `0x215`, wave map, master track |
| wave number (`81`) | pointer-bank index | **pointer-bank index** | song wave-map index |
| tempo | `85` in channel streams | **same** | master track |
| volume / bend streams | both serviced only when the bend timer is behind (quirk) | **each on its own timer** | separate timers |
| transpose | added in every pitch update | **folded into the pitch at note fetch** | at note fetch |
| For/Next bend restore | unsigned byte (bug) | **same bug** | saved float |
| `A8` bend range | bend = bendVal² (quirk) | **same quirk** | bendVal × range |
| vibrato | sin(t / speed × 2π) × depth | like Gex 3 (no song uses vibrato) | – |
| `AA` | – | u8, FX change only if `[0x802AB068] == 1` (no song uses it) | `AA changefx` |
| reverb | bus configured | **AL_FX_BIGROOM** (hard-coded in `MusInitialize` `0x801C0510`); songs use `A2` sends 7,560 times | off (`MusSetFxType(0)`) |

Library entry points (disassembly): `MusInitialize 0x801C0300`, `MusSetMasterVolume 0x801C066C`, `__MusIntStartSong
0x801C0694`, `MusHandleStop 0x801C0B70`, `MusHandleAsk 0x801C0C1C`, `MusHandleSetVolume 0x801C0C70`,
`MusHandleSetTempo 0x801C0DAC`, `MusHandleSetReverb 0x801C0E3C`, `MusPtrBankInitialize 0x801C249C`,
`MusBankStartSong 0x801C0EE0`, `__MusIntMain 0x801C1338`, pitch update `0x801C1C1C`.

Configuration (audio init `0x801326F0`, musConfig `0x8020A940`; disassembly): 24 channels = voices; output rate 22050
requested; tick `1000000 / 60` = 16,666 µs (367 samples at 22050; 50 Hz path for PAL); equal-power pan table at ROM
`0xF55B0`. Master volumes: `MusSetMasterVolume(3, 0x7FFF)` at init; normal play uses options values
from `[0x801E7658]` / `[0x801E765A]`; each new song's handle volume is 80. Verified in RAM:
the menu and Atlantis 1 use music and effects master volume 22518 (`0x57F6`) and actual output
rate 22047 Hz. The level-select scene sets music master 20000 (`0x4E20`) every frame.

### 5.3 Instruments and sample encoding

The pointer-bank wave records use ALWaveTable descriptors, ADPCM books, and loop records as in
[Gex 64](GEX64.md#5-audio). Every examined wave uses VADPCM. All 111 music waves have
pitch offset −48.00 (base note 0, detune 0).

### 5.4 Music catalog and loop points

All 60 songs are uncompressed and stored back to back in ROM `0x6F8720..0x77BBE0`; the 60-case switch in
`SongSelect(id)` `0x80177A14` (jump table `0x801085B0`) gives their ranges, which tile the region with no gap.
The song header is `0x18` bytes; `__MusIntStartSong` relocates its song-relative offsets on load:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x04` | `u32` | `numChannels` | 24. |
| `0x04` | `0x04` | `u32` | `channelData` | Offset to 24 `u32` channel-stream pointers. |
| `0x08` | `0x04` | `u32` | `volumeData` | Offset to 24 `u32` volume-stream pointers. |
| `0x0C` | `0x04` | `u32` | `pitchBendData` | Offset to 24 `u32` bend-stream pointers. |
| `0x10` | `0x04` | `u32` | `envelopes` | Offset to 7-byte envelope entries. |
| `0x14` | `0x04` | `u32` | `drums` | Equals `envelopes`; unused by these songs. |
`SongSelect(id)`: sets the old handle's reverb 0 and volume 80, returns if `id` is already playing, stops the old song,
`id == 0` → silence; reads the song from ROM to `[0x80290410] + 0x9540` (runtime: `0x800856B0`), starts it on nosfx.wbk,
handle volume 80; song 26 gets tempo scale 106 on PAL. Ids above 60 print `Error, so song specified`.

Commands used by the songs: `80 81 82 85 86 87 8A 8B 8D 8F 90 95 96 97 99 9A 9B 9C A2 A8`. Looping channels wrap their
stream in exactly one `95 FF … 96` (33 songs); one-shot songs end every channel with `80` (27 songs). Loop points: the
latest `95 FF` over the looping channels gives loopStart and that channel's first jump back the loop end, times 367
samples per tick. Songs 1–60 render with valid wave indices, no unknown commands and no
clipping (peaks −10 … −26 dBFS, so the viewer needs a playback gain of about ×3–×4). Notes whose pitch ratio exceeds 2.0
are silenced by libmus's cap (`0x801C1CF0`), mostly in songs 6, 7, 8 and 16.

**How songs are chosen** (disassembly):
- level table `+0x35` ([Level catalog](#31-level-catalog-and-identifiers)), played by the level loader `0x8011DEB4`; song 25 instead when the game state
  `[0x801E7530]` is 15;
- 60 in the front-end menu (`domenu`, `0x8010FE10`); 59 on the end-of-level and end-of-world screens (`0x80121440`,
  `0x80122448`) and after the presentation (`0x8012BD10`);
- per-world jingles `SongSelect(30 + 4w + rand(2))` (`0x80125444` and the timer/HUD function `0x8012D0A4`) and
  `SongSelect(32 + 4w + rand(2))` (object handlers including the Garib-group handler `0x80196088`), w = world
  (`0x80124F2C`); after a jingle `0x8011E92C` restarts the level song. Which events play pair A (30/31) or B (32/33):
  **HYPOTHESIS** (A timer/life-related, B Garib-group/object events);
- `0x801B5980`: while `[0x801F1B14] != 0` the song gets reverb 60 and volume 55, else reverb 0 and volume 80
  (**HYPOTHESIS**: underwater).

| ID | ROM range | BPM | Channels | Offline loop samples at nominal 22050 Hz, or one-shot length | Use |
|---|---|---|---|---|---|
| 1 | `0x6F8720-0x6FB420` | 90 | 9 | 0..6815557 | Atlantis Level 1 |
| 2 | `0x6FB420-0x6FE820` | 160 | 10 | 0..4624934 | Atlantis Level 2 |
| 3 | `0x6FE820-0x701460` | 103 | 8 | 0..6475348 | Atlantis Level 3 |
| 4 | `0x701460-0x706220` | 136 | 9 | 0..5287002 | Atlantis Boss |
| 5 | `0x706220-0x70C5E0` | 130 | 10 | 0..5537663 | Carnival Level 1 |
| 6 | `0x70C5E0-0x7126C0` | 130 | 9 | 0..5038910 | Carnival Level 2 |
| 7 | `0x7126C0-0x7187E0` | 120 | 10 | 0..6527462 | Carnival Level 3 |
| 8 | `0x75C440-0x7630A0` | 154 | 11 | 144965..3443561 | Carnival Boss |
| 9 | `0x7187E0-0x71D800` | 97 | 9 | 0..5920077 | Pirates Level 1 |
| 10 | `0x71D800-0x7245A0` | 60 | 10 | 0..6542876 | Pirates Level 2 |
| 11 | `0x758CE0-0x75C440` | 108 | 9 | 0..6568199 | Pirates Level 3 |
| 12 | `0x7245A0-0x7282E0` | 147 | 9 | 71932..2808284 | Pirates Boss |
| 13 | `0x7282E0-0x72DDC0` | 120 | 10 | 0..5645194 | Prehistoric Level 1 |
| 14 | `0x72DDC0-0x7318E0` | 120 | 7 | 0..5997881 | Prehistoric Level 2 |
| 15 | `0x7318E0-0x7356A0` | 142 | 9 | 0..5366641 | Prehistoric Level 3 |
| 16 | `0x7356A0-0x7371E0` | 140 | 8 | 0..2117590 | Prehistoric Boss |
| 17 | `0x7371E0-0x73B320` | 112 | 8 | 330300..6374790 | Fortress of Fear Level 1 |
| 18 | `0x73B320-0x73E7A0` | 102 | 7 | 0..6738487 | Fortress of Fear Level 2 |
| 19 | `0x73E7A0-0x7437C0` | 107 | 10 | 0..6276434 | Fortress of Fear Level 3 |
| 20 | `0x7437C0-0x747080` | 135 | 10 | 158544..2197596 | Fortress of Fear Boss |
| 21 | `0x747080-0x74C440` | 130 | 9 | 44040..5332510 | Out of This World Level 1 (OW2A) |
| 22 | `0x74C440-0x74F5C0` | 101 | 7 | 0..6292215 | Out of This World Level 2 (OW2B) |
| 23 | `0x74F5C0-0x752EC0` | 102 | 9 | 0..3939378 | Out of This World Level 3 |
| 24 | `0x752EC0-0x756920` | 151 | 9 | 0..3222627 | Out of This World Boss (all three stages 38–40) |
| 25 | `0x76A8A0-0x76D5A0` | 112 | 8 | 0..1888582 | Assault Course (runtime: loaded for PRACTICE) |
| 26 | `0x756920-0x758340` | 76–124 | 9 | one-shot 63.9 s | Intro (runtime: loaded for the intro) |
| 27 | `0x758340-0x758CE0` | 101 | 7 | one-shot 38.6 s | Outro |
| 28 | `0x7630A0-0x763DA0` | 60 | 9 | 0..1502498 | The Castle: HUB 1, HUB 2 (runtime: loaded in HUB 1) |
| 29 | `0x763DA0-0x765980` | 60 | 8 | 0..1767839 | The Castle: HUB 3 |
| 30 | `0x765980-0x7669C0` | 75 | 11 | 0..1197521 | The Castle: HUB 4 |
| 31 | `0x7669C0-0x7683A0` | 100 | 10 | 0..1269453 | The Castle: HUB 5 |
| 32 | `0x7683A0-0x768D40` | 100 | 7 | 0..1110542 | The Castle: HUB 6, HUB 7 |
| 33 | `0x768D40-0x76A8A0` | 105 | 10 | 0..2015197 | The Castle: HUB 8; title fly-through (runtime: loaded on the title screen) |
| 34 | `0x770540-0x770900` | 180 | 10 | one-shot 7.0 s | Atlantis jingle A1 |
| 35 | `0x770900-0x770CA0` | 180 | 11 | one-shot 6.8 s | Atlantis jingle A2 |
| 36 | `0x770CA0-0x771020` | 180 | 11 | one-shot 6.2 s | Atlantis jingle B1 |
| 37 | `0x771020-0x771340` | 180 | 9 | one-shot 6.0 s | Atlantis jingle B2 |
| 38 | `0x771340-0x7717E0` | 180 | 9 | one-shot 6.2 s | Carnival jingle A1 |
| 39 | `0x7717E0-0x771A60` | 180 | 7 | one-shot 5.9 s | Carnival jingle A2 |
| 40 | `0x771A60-0x771D60` | 180 | 9 | one-shot 6.6 s | Carnival jingle B1 |
| 41 | `0x771D60-0x772040` | 180 | 7 | one-shot 6.5 s | Carnival jingle B2 |
| 42 | `0x76FB00-0x76FD80` | 100 | 6 | one-shot 5.6 s | Pirates jingle A1 |
| 43 | `0x76FD80-0x76FF00` | 120 | 1 | one-shot 8.5 s | Pirates jingle A2 |
| 44 | `0x76FF00-0x770200` | 110 | 6 | one-shot 8.2 s | Pirates jingle B1 |
| 45 | `0x770200-0x770540` | 120 | 8 | one-shot 8.8 s | Pirates jingle B2 |
| 46 | `0x76D5A0-0x76D820` | 127 | 5 | one-shot 6.8 s | Prehistoric jingle A1 |
| 47 | `0x76D820-0x76DB00` | 127 | 10 | one-shot 8.7 s | Prehistoric jingle A2 |
| 48 | `0x76DB00-0x76DF20` | 127 | 9 | one-shot 11.7 s | Prehistoric jingle B1 |
| 49 | `0x76DF20-0x76E440` | 127 | 9 | one-shot 10.6 s | Prehistoric jingle B2 |
| 50 | `0x76F0E0-0x76F340` | 80 | 8 | one-shot 6.9 s | Fortress of Fear jingle A1 |
| 51 | `0x76F340-0x76F540` | 100 | 8 | one-shot 6.2 s | Fortress of Fear jingle A2 |
| 52 | `0x76F540-0x76F7C0` | 90 | 7 | one-shot 7.0 s | Fortress of Fear jingle B1 |
| 53 | `0x76F7C0-0x76FB00` | 120 | 10 | one-shot 5.8 s | Fortress of Fear jingle B2 |
| 54 | `0x76E440-0x76E700` | 120 | 7 | one-shot 6.9 s | Out of This World jingle A1 |
| 55 | `0x76E700-0x76EA80` | 120 | 9 | one-shot 6.4 s | Out of This World jingle A2 |
| 56 | `0x76EA80-0x76EDC0` | 120 | 9 | one-shot 9.7 s | Out of This World jingle B1 |
| 57 | `0x76EDC0-0x76F0E0` | 120 | 9 | one-shot 9.7 s | Out of This World jingle B2 |
| 58 | `0x772040-0x775580` | 128 | 9 | 0..2647905 | all six bonus levels |
| 59 | `0x775580-0x777420` | 108 | 7 | one-shot 180.9 s | presentation (runtime: loaded at boot), end-of-level / end-of-world screens |
| 60 | `0x777420-0x77BBE0` | 119 | 10 | 0..2132270 | front-end menu (runtime: loaded after START) |

CAVE (8) and WAYROOM (42) have no music. No in-game jukebox or track names exist; names above are by use.

**Loop seams (verified by offline audio render):** all 33 looping songs end at their declared loop point. A player
looping `[loopStart, loopEnd)` jumps from the end of the first pass back into a state with no sounding release tails and
an empty reverb. For seamless loops the viewer should render past the loop and loop over the second pass (ticks
`[L + P, L + 2P)`), which carries the first pass's tails and reverb.

## 6. Unused and hidden content

### 6.1 Unreferenced assets

Verified from ROM-byte inventories, loader disassembly, decoded images, and level-script scans,
except where marked as a hypothesis.

| what | where | evidence it is unused / hidden |
|---|---|---|
| **Developer photos behind SECRET CHEAT** | Texture banks 16 CKCHEAT1 (ROM `0x251FC0`) and 17 CKCHEAT2 (`0x253C00`): 12 64×64 photographs of team members, one labelled `STEVE`. | **Verified by disassembly, RAM, and frames:** with cheat bit 21 set, Carnival Bonus visibly replaces its cartoon panels with developer photographs. The loader alternates banks 16 and 17 via `[0x801E7590]`. |
| **Japanese font** | FLA2 ROM `[0x255740, 0x25EFC0)`, one RGBA16 64×928 texture (ID `0x4D0AB24D`). | No embedded loader constant among 303 scanned ROM constants or data reference addresses it. Decoding reveals hiragana, katakana, Latin capitals, digits, punctuation, and N64 button glyphs. **Hypothesis:** prepared for a Japanese release. |
| **Cut Out of This World level 1** | landscapes OW2A, OW2B, OW3 and banks OOTW_L2A / L2B / L3 exist; no OW1 or OOTW_L1; object bank id 28 (between OOTW_SHARED 27 and OOTW_L2A 29) has no case; the table calls OW2A "SPACE 1" | ROM bytes (chain names), disassembly (bank switch). The level table's save slots (`+0x2C`) run 0..29 without a gap, so the cut predates the save layout (**HYPOTHESIS**) |
| **Missing boss stage file** | OWBOSS1 (38) and OWBOSS3 (40, "SPACE BOSS 2") exist, no OWBOSS2; TWEEN (39) between them | ROM bytes; 38 → 39 → 40 are entered by the "level + 1" exit event (`0x80123C18`, disassembly) |
| **A/B level variants** | surviving files and banks carry A/B suffixes (AT3A, CK2A, CK3A, PC2A, PC3B, PH1A, PH2A, PH3B, FF1A, FF2A, FF3B, OW2A, OW2B); 16 object bank ids have no case exactly where the missing variants would sit (16, 22, 24, 28, 32, 34, 36, 37, 41, 42, 48, 50, 51, 57, 59, 60) | disassembly (switch gaps), ROM bytes (names); the gap names are **HYPOTHESIS** |
| **Level-select scene** | `0x8011E51C` | **Verified by disassembly and RAM:** mode 2 presents 42 selectable entries and starts a chosen level. Cheat bit 23 enables the cheat; the normal route into this mode remains unclear. |
| **Debug song stepper and record tool** | `0x80180A80`, called every frame from the main loop (`0x8013DE18`); its debug part (`0x80180B78`) runs only when the upper 16 bits of `[0x8020B110]` are non-zero: `.moo` recording/playback (`c:\n64\oddballs\incbins\records\%s.moo`, "reckey") and previous/next song (`[0x80290428] ∓ 1 mod 61`) on flags `0x8020B10C` / `0x8020B10D` | disassembly; no code writes `0x8020B0F0..0x8020B113` with a direct address, so the flags come from a controller-state block (**HYPOTHESIS**: a second or debug controller) |
| **Unused Mr Tip hint** | tip 19: "IF YOU TURN THE BALL INTO A BALL-BEARING, IT BECOMES MAGNETIC." (and its French and German copies) | the landscapes place tips (`BB {vec3; u16 tip}`) 0–18 and 20–31 only (script over all 48); tip 32 ("GET 40, AND WIN AN EXTRA LIFE!") is only a code substitute for tip 14 ("GET 50") when a per-save-slot byte `[0x801EAA55 + slot × 28]` is 0 (`0x80183820`; **HYPOTHESIS**: the difficulty) |
| **13 unreferenced objects** | Table below. | No landscape command, enemy table entry, string hash, code constant, or data word references them in the scanned ROM. |
| **237 unreferenced textures** | Counts below. | No display list, face list, node sprite, backdrop, animation record, string hash, code constant, or data word references them in the scanned ROM. This is an upper bound on unused textures: unrecovered runtime name construction could still address some. |
| **Tombstones with initials** | FORTRESS_TEX_BANK, 5 unreferenced 32×32 CI4 textures (ids `0xFF296157`, `0xB62406DA`, `0x4DC72DCE`, `0x04CA4A43`, `0xDFDDE2D4`) | viewed: headstones with a cross and initials read as `W.I.K / K.E.U`, `R.M.A / T.C.R`, `M.A.T / D.I.B`, `J.S.S / D.F.`, `H.U. / S.T.E` (uncertain at 32×32; **HYPOTHESIS**: team in-jokes) |
| sound-option icons | TITLE_TEX_BANK: `music.bmp`, `sfx.bmp` and four more menu icons, unreferenced | Verified by ROM-byte reference scan and decoded images. **Hypothesis:** an earlier options or sound-test menu. |
| placeholder demo records | 44 `.moo` records: 31 identical and 3 identical placeholders; distinct recordings for levels 10, 15, 16, 20, 25, 30, 35, 39 (and small ones for 0, 24) | SHA-1 of the extracted records; the attract demos start 10, 16, 20, 25, 30 (disassembly `0x80114684..0x801146C4`; runtime saw 10 and 30), so 15, 35 and 39 are real recordings no demo plays |
| enemy types never placed by a landscape | 14 `keg`, 46 `spotty`, 57 `bug`, 58 `nmefrog` | all 345 `83` records; 58 (and 38 `robot`) are also spawned by code (`li a1, 58` at `0x80176A74`, `0x80195BE0`; **HYPOTHESIS**: the frog spell); 14, 46, 57 may still be spawned by the variable-type call at `0x8015D194` |
| landscape opcodes no file uses | `03`, `58 59 5A 73 74` (Plat_MvSpn), `69` (Plat_Cat), `77 78 7A 7E`, `8A` (Plat_Fan), `8D` (Rope_Plat), `8E`, `8F` (Orbit_Plat), `90` (Sine_Plat), `9D 9E 9F BA C0 C6` | parser handlers vs a walk of all 48 files |
| development leftovers | working title "oddballs", build `V25 08AUG98`, `Loading Level: %s`, `Parsing landscape file %s`, `COLLISION PROB FOUND!!!…`, `Uh-oh - memory crobbed on frame %d` / `clodged`, `DMAMemory:%d`, `Stop/Start Drawing Requested from '%s'`, scene names `freelevel2`, `loadlevel`, `stnewlevel`, `levelseect` / `levelselec`, `IMP:level:%d` | ROM strings; the "LEVEL EDITING" credit has no editor code or strings behind it |
| music | No orphan songs; 14 music waves no song plays (nosfx.wbk 3, 12, 16, 44, 45, 50, 57, 66, 78, 79, 81, 83, 87, 102); PAL-only intro tempo; 23 libmus commands no song uses. | Verified from all 60 song streams: the union of wave sets is 97 of 111. |
| sound effects | – | not established statically: only 15 constant effect ids appear at the 117 effect-start call sites; most come from tables and variables |

**Unreferenced objects** (identification from decoded model geometry):

| bank | object | what it shows |
|---|---|---|
| ASSAULT COURSE | `0x445CFCAF` | a tall green crystal (210 units) |
| ATLANTIS_BOSS | `wheyes.ndo` | two small green eyes |
| ATLANTIS_BOSS | `0x9EDB0885` | a sandstone column / urn piece |
| ATLANTIS_BOSS | `0xB1B16E93` | a corner wall section with a hole |
| CARNIVAL_BOSS | `0x2D068D9E` | a red target disc |
| OOTW_BOSS1 | `arch.ndo`, `0x86C60656` | a green tech archway and a teal/yellow arch half |
| PREHISTORIC_L2A | `0x53478D01` | a small yellow gem |
| FORTRESS_BOSS | `ffegate.ndo` | a two-triangle gate with a magenta/green lattice |
| FORTRESS_BONUS | `mabot21.ndo`, `0xC08D161D` | two stone pillars |
| HUB_SHARED | `0x58C079E1`, `0x11CD1E6C` | a pink and a purple chicken on a swing (the placed hub chicken is enemy type 31 `hubchicken1.ndo`) |

**Unreferenced textures per bank:** TITLE 6 (menu icons incl. `music.bmp`, `sfx.bmp`),
LEVELEND 1 + 1, GENERIC 8 ("!" and "?" signs, a red arrow), ATLANTIS 42 (tiles, an octopus relief, test tiles), CARNIVAL 19
(`can.bmp`, `eye.bmp`, `magnet.bmp`, signs), OOTW 22 (a red arrow, circuit panels, `jet.bmp`, `ramp.bmp`), PIRATES 17 (a
skull and crossbones, wood), PREHISTORIC 30 (rock, vines, ice, lava), FORTRESS 42 (the tombstones, a bolt, a bloodshot eye),
HUB 36 (grass, brick, an arched window), CAMEO 14 (skies, a sun glare, an explosion), PRESENT 7 (marble, nebula, a small
"HASBRO Interactive" logo), and the Japanese font bank.

**Level reachability** (disassembly of the exit-event switch `0x80123A80` on `[0x801E7541] − 1`, 24 cases, jump table
`0x80101528`, and the `0x8011FF40` callers): every one of the 48 levels is started by normal play or the boot/attract flow.
PRESENT at boot (`0x8012BD08`, runtime), FLYTHRU on the title (`0x8012BF6C`, runtime), FLYTHRU2 at `0x801326B0` (which
screen: **HYPOTHESIS**), INTRO on a new game, OUTRO by an exit event, the ASSAULT COURSE from PRACTICE and a hub exit event
(tip 1 "JUMP INTO THE WELL"), WAYROOM by several exit events including one per world (it holds tip 31 "TO OPEN THIS DOOR
YOU MUST COLLECT EVERY GARIB FROM THIS WORLD."), TWEEN and SPACE BOSS 2 by "level + 1", the world levels through the world
table; CAVE has no constant (**HYPOTHESIS**: "level + 1" from HUB 8; tip 2 "RETURN BALLS TO THE CAVE TO OPEN THE GATEWAYS
TO OTHER WORLDS").

**Text**: Mr Tip has 99 messages, 33 per language (English 0–32,
French 33–65, German 66–98) in the line table `0x801EB538..0x801EC738` (`{char* line; u32 flag}`, flag 1 end of page, 2 end
of message). Credits `0x801EAF00..0x801EB52C` (programmers Darren Wood, Steve Bond, Matt Cloy; music by Perfect Audio
Design). No text refers to content that is not in the game, apart from the magnet hint (**HYPOTHESIS**).

Cheat system (verified by ROM bytes and disassembly): the table at ROM `0xF31BC`
(VRAM `0x801F21BC`) has 26 records of stride `0x2C`.

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|
| `0x00` | `0x20` | `u8[32]` | `name` | NUL-terminated cheat label. |
| `0x20` | `0x08` | `u8[8]` | `code` | Eight symbols, each 0–3. |
| `0x28` | `0x04` | `u32` | `flag` | Cheat-specific flag. |

Bit `k` of `[0x80297BEC]` enables cheat `k` (loop `0x801BC064`).
- Order: 0 LOCATE GARIBS, 1 CALL BALL, 2 CHECKPOINTS, 3 INFINITE LIVES, 4 POWERBALL, 5 CONTROL BALL, 6 INFINITE ENERGY,
  7 ENEMY BALL, 8 LOW GRAVITY, 9 BIG BALL, 10 FISH EYE, 11 CAMERA ROTATE R, 12 CAMERA ROTATE L, 13 MAD GARIBS, 14 DEATH
  SPELL, 15 FROG SPELL, 16 HERCULES, 17 SPEEDUP, 18 BOOMERANG BALL, 19 VANISH BALL, 20 FROGGY, 21 SECRET CHEAT, 22 ALL
  CHEATS OFF!, 23 LEVEL SELECT, 24 OPEN PORTALS, 25 OPEN LEVELS.
- Input: `0x801BB8D4` maps four per-pad pressed flags at `0x8020AAD0 + pad × 0x190` (+0, +1, +2, +3) to symbols 2, 3,
  1, 0, appends them to an 8-byte buffer `0x801F2198` (count `0x801F21A1`) and plays one of four sounds from
  `0x801F21AC`; after 8 symbols `0x801BB938` compares the buffer with the 26 codes and `0x801BB9AC` toggles the match.
  Verified against runtime input: symbol 0 = C-Down, 1 = C-Up, 2 = C-Left, 3 = C-Right.
  LEVEL SELECT is C-Up ×3, C-Left ×2, C-Right, C-Left, C-Right; entering it sets bit 23.
- Where the bits are tested (disassembly): 0 LOCATE GARIBS `0x801672AC`; 1 CALL BALL `0x8018163C`; 2 CHECKPOINTS `0x80126A24`;
  3 INFINITE LIVES `0x801747D8`; 4 POWERBALL `0x801AEE78`; 5 CONTROL BALL `0x80180AA4`; 6 INFINITE ENERGY `0x80174498`; 10 FISH
  EYE `0x801B59A4`; 13 MAD GARIBS `0x80185160` (garib sprite swap); 21 SECRET CHEAT `0x8011DD8C` (Carnival Bonus photos); 23
  LEVEL SELECT `0x80114378`; 24 OPEN PORTALS `0x80123D70` (portal state forced to 7); 25 OPEN LEVELS `0x80120260`,
  `0x80128D38`; the ball-type cheats in `0x8018DB24` / `0x8018DB74`.
- Codes (verified: ROM bytes; flag = the u32 at +0x28):

| ID | Cheat | Code symbols | Flag |
|---:|---|---|---:|
| 0 | LOCATE GARIBS | 2 1 3 0 2 1 2 2 | 0 |
| 1 | CALL BALL | 1 2 2 1 3 2 0 1 | 0 |
| 2 | CHECKPOINTS | 0 0 3 2 1 1 0 2 | 0 |
| 3 | INFINITE LIVES | 1 1 1 1 1 3 0 3 | 0 |
| 4 | POWERBALL | 1 0 1 0 1 0 2 1 | 0 |
| 5 | CONTROL BALL | 2 3 2 3 1 0 3 3 | 0 |
| 6 | INFINITE ENERGY | 3 3 0 3 3 3 1 2 | 0 |
| 7 | ENEMY BALL | 2 0 1 3 2 2 0 0 | 0 |
| 8 | LOW GRAVITY | 2 2 1 2 3 1 1 1 | 0 |
| 9 | BIG BALL | 0 0 1 0 0 2 3 0 | 0 |
| 10 | FISH EYE | 2 3 2 3 2 3 2 3 | 0 |
| 11 | CAMERA ROTATE R | 2 3 1 1 0 3 0 3 | 1 |
| 12 | CAMERA ROTATE L | 3 0 3 0 1 1 3 2 | 1 |
| 13 | MAD GARIBS | 0 3 0 1 2 0 2 1 | 0 |
| 14 | DEATH SPELL | 1 2 2 2 2 1 3 1 | 0 |
| 15 | FROG SPELL | 0 2 0 0 2 0 1 2 | 0 |
| 16 | HERCULES | 0 0 0 2 2 0 3 2 | 0 |
| 17 | SPEEDUP | 2 2 3 1 3 2 0 0 | 0 |
| 18 | BOOMERANG BALL | 3 1 1 1 1 2 2 0 | 0 |
| 19 | VANISH BALL | 0 0 2 2 1 1 0 1 | 0 |
| 20 | FROGGY | 1 3 0 3 1 2 2 1 | 0 |
| 21 | SECRET CHEAT | 0 1 3 3 0 2 3 3 | 0 |
| 22 | ALL CHEATS OFF! | 0 0 0 0 0 0 0 0 | 1 |
| 23 | LEVEL SELECT | 1 1 1 2 2 3 2 3 | 0 |
| 24 | OPEN PORTALS | 1 3 3 0 2 0 1 3 | 0 |
| 25 | OPEN LEVELS | 0 0 2 1 1 1 3 0 | 0 |

Level-select scene (verified by disassembly and mode-2 runtime observation):
- `0x8011E51C` draws "SELECT LEVEL" (scene name `levelselect`, ROM 0x2098/0x20A4), keeps the chosen level in
  `[0x801E75A0]` and starts it with `0x8011FF40(level)`, the start-level-by-index function (20 callers: continue,
  attract demos, portals, presentation...).
- Its only caller is the main loop at `0x8013DC68`, which runs it every frame while the game mode byte
  `[0x801E7530] == 2`. Mode 2 is set by `0x8010FB80(2)` from the menu handler `0x8011A900` (a function pointer in the menu
  definition at `0x801E6114`), whose entry depends on cheat bit 23 (`0x80114368..0x80114388`; the exact gate is
  **HYPOTHESIS**).
- It lists the level table's debug names (`HUB 1`, `ATLANTIS 1`, …, `SPBTWEEN`) in a scrolling window and previews each
  level's song (`SongSelect(level +0x35)` at `0x8011E928`).

### 6.2 Cut or inaccessible levels

The ROM has no `OW1` landscape or `OOTW_L1` object-bank case, although the surviving
Out of This World assets are named `OW2A`, `OW2B`, and `OW3`; the level table calls
`OW2A` “SPACE 1”. It also has `OWBOSS1` and `OWBOSS3` but no `OWBOSS2` file;
`TWEEN` occupies the intervening level index. These absences are verified from
the landscape chain and bank-loader switch. Whether either missing file was
ever completed is **unknown**. The 48 surviving landscapes have observed or
disassembled entry paths, but the ordinary-play route into `CAVE` has not been
established independently of a level-index increment.

### 6.3 Debug features

The eight C-button presses for `LEVEL SELECT` set cheat bit 23 in RAM. Mode 2
then draws a 42-entry level list covering indices 0–41; its handler calls the
start-level function for the selected index. The cheat input and mode-2 screen
were verified at runtime, while the normal menu path that exposes the screen
remains unknown. A separate per-frame routine contains `.moo` recording and
song-step controls behind a controller-state condition; this is verified by
disassembly, but its input combination has not been established.

### 6.4 Prototype or revision-specific content

The surviving A/B landscape and object-bank suffixes, alongside bank-switch
IDs with no case, suggest earlier level variants; no corresponding alternate
files were found in this ROM. An unreferenced texture bank contains a Japanese
font sheet. Its intended release or menu use is **hypothesis**. No separate
prototype or non-USA ROM was examined.

## 7. nviewer implementation

### 7.1 Module mapping

- `src/rom/index.ts` `openRom()`: `case 'NGVE'` → `openGlover(rom)`.
- `src/rom/types.ts`: add `'glover'` to `Game.id`. No other contract change is
  needed: instances with matrices, `fog`, `clearColor`, `camera`, `markers`, `layers` (objects, platforms, water, enemies,
  pickups, a hidden collision layer) and `backdrop`/`skies` cover what the levels need.
- Level list: [Level catalog](#31-level-catalog-and-identifiers) (the hub parts, the assault course, the six worlds grouped by world, then the cutscene scenes).
  `LevelInfo.name` from the composed names; `Level.id` = the landscape name.

| module | use for Glover | changes |
|---|---|---|
| `displaylist.ts` `runDisplayList` | Object display lists (`ucode 'f3dex'`, `vertexScale 1`, `mirrorX false`, `cullBackByDefault true`, level lights). | Add `G_MODIFYVTX` (`B2`) point-ST handling and optional CI texture interpretation when TEXTLUT is on, regardless of `G_SETTILE`'s format field. |
| `texture.ts` | tile and TLUT loads through the lists; `decodeRows` for face-list textures and backdrops | none |
| `lzss.ts` | – | not directly: FLA2 needs its own decoder ([Compression formats](#24-compression-formats)) |
| `music/libmus64.ts` | the libmus player, bank parser, song header, voice mixer | a revision switch for the Glover differences ([Sequence format and driver](#52-sequence-format-and-driver)); take `Reverb` (BIGROOM) from `music/libmus.ts`; neither module exports its player today, so both need refactoring |
| `music/libultra.ts` | VADPCM (`prepareWave`), resampler | none (already used by `libmus64.ts`) |

| file | contents |
|---|---|
| `src/rom/glover/fla2.ts` | the FLA2 decoder |
| `src/rom/glover/fs.ts` | hard-coded bank and chain tables ([ROM map and asset organization](#23-rom-map-and-asset-organization)–[Controller-record chain](#controller-record-chain)), level and world tables ([Level catalog](#31-level-catalog-and-identifiers)), CRC-32 name hash |
| `src/rom/glover/banks.ts` | texture banks ([Textures and materials](#35-textures-and-materials)), object banks, node trees, display-list texture-id patching, face lists ([Object and model formats](#42-object-and-model-formats)) |
| `src/rom/glover/landscape.ts` | the script walker with the opcode size table and the six variable-length handlers ([Level container](#32-level-container)) |
| `src/rom/glover/glover.ts` | `Game`: levels ([Level catalog](#31-level-catalog-and-identifiers)), placement (actors, platforms, water, enemies, garibs), environment ([Environment](#37-environment-sky-fog-and-lighting)), collision layer ([Collision](#36-collision)) |
| `src/rom/music/glover.ts` | song table (60 ROM ranges or the switch at `0x801085B0`), names by use ([Music catalog](#54-music-catalog-and-loop-points)), `decodeMusic` |

### 7.2 Supported features

The following mapping is proposed for a future loader; the game is not yet registered in nviewer.

| placement | source | show as |
|---|---|---|
| world pieces | `92` Land_Actor, `91` Bkg_Actor, `BC` | object-bank models at T · R · S ([Placement records](#41-placement-records)) |
| platforms, doors, switches, exits | `62`/`5D` + `A6`/`6B`, `79`, `7F` | models at their first position, `animated` ([Behaviors and triggers](#44-behaviors-triggers-and-scripted-objects)) |
| water, mist | `A0` | face-list models, translucent ([Geometry](#33-geometry), [Environment](#37-environment-sky-fog-and-lighting)) |
| enemies and bosses | `83` | models in their first key frame with per-type scale and yaw ([Behaviors and triggers](#44-behaviors-triggers-and-scripted-objects)) |
| garibs | `86` (+ `85` groups) | sprite frame 1 (`acard0001.bmp`, `marble01.bmp`) as a billboard or marker ([Behaviors and triggers](#44-behaviors-triggers-and-scripted-objects)) |
| start hoop | first `62 hoop.ndo` | hidden layer / marker; camera target ([Cameras and paths](#38-cameras-and-paths)) |
| node sprites | Node `+0x28`/`+0x2C`, 36 nodes. | Game-drawn screen-space texture rectangles (verified against RAM); not yet decoded for viewer support. |
| cutscene actors, tips, buzzers, sounds, cameras, puzzles | `AB`, `BB`, `B5`, `BE`, `9A..9C`, `04..08`/`95`/`96` | markers at most |

Offline assembly of all 48 levels confirms the loader mapping above: every object ID resolves.
Level 44 FLYTHRU references texture `0x019750A0` from an enemy model, but its loaded world
texture banks do not contain it. All assembled levels survive `structuredClone` with every
ArrayBuffer transferred.

1. Load texture banks GENERIC + the world's (+ level 43/44/46/47 specials) and object banks GENERIC + world shared + the
   level's own ([Loading process](#25-loading-process)) — decompress FLA2, relocate pointers `(ptr & 0xFFFFFF) + base` or keep them bank-relative.
2. For each object node with a display list: patch `G_SETTIMG` ids to texture records ([Display lists and render state](#34-display-lists-and-render-state)), run the list with the
   node's matrix (parent · T · R · S of key 0) and the instance matrix; nodes without a list: build triangles from the face
   list ([Geometry](#33-geometry)) as translucent batches with the node alpha.
3. Walk the landscape: `91`/`92`/`BC` actors (+ `93` rotation, `94` scale), `62`/`5D` platforms (+ `A6` position, `79`
   scale; place at their first position and mark `animated`), `A0` water, `83` enemies (first key frame, per-type scale, yaw),
   `86` garibs (sprite frame 1 as a billboard or marker); hide the start hoop.
4. Environment: `fog` from `A5` (colour adjusted as [Environment](#37-environment-sky-fog-and-lighting); multiplier `128000 / (1000 − fogMin)`, offset
   `(500 − fogMin) · 256 / (1000 − fogMin)`, near 6, far = `far`), `clearColor` = the adjusted fog colour, lights `97`/`98`
   baked into lit lists, camera from the start hoop ([Cameras and paths](#38-cameras-and-paths)), backdrop ([Environment](#37-environment-sky-fog-and-lighting)).
5. Collision: a hidden `collision` layer with the root-mesh face lists of Land_Actors and platforms ([Collision](#36-collision)).

### 7.3 Approximations and omissions

- Animated objects, platform motion, node sprites, and puzzle-driven state are not yet decoded.
- The exact backdrop draw path and camera orientation source remain unknown.
- Collision plane contents are inferred from disassembly, not matched against live gameplay.
- The missing FLYTHRU texture appears to reflect the game's own bank selection; its fallback behavior is unknown.

## 8. Verification and remaining work

### 8.1 Verification evidence

| Check | Method | Result |
|---|---|---|
| FLA2 | Decode all 76 streams with two independent implementations; compare SHA-1 and header lengths. | Every stream reaches its end marker at exactly the declared size; all 76 outputs match. |
| FLA2 versus game | Break on decompressor return during Atlantis 1 load and compare RAM with decoded ROM bytes. | Texture bank (`0x1C444` bytes) and object bank (`0xB8EC` bytes) match exactly. |
| ROM coverage | Classify every nonzero byte by program or asset region. | Only revision strings at `0xF6680` are outside named asset ranges. |
| Load trace | Observe 67 file loads from boot through hub and Assault Course. | Loaded ranges agree with embedded tables; landscape index equals level index; record 43 loads at boot. |
| Level tables | Observe bank, landscape, song, and world loads for eight levels across six worlds. | IDs and table fields match ROM; Space Boss 1 uses texture 5, object banks 27/1/33, song 24, world 6. |
| Geometry | Render ten levels from each game's captured camera and compare with emulator frames. | Mean RGB absolute differences range from 10.5 (HUB 1) to 60.0 (Space Boss 1); animated bosses, player, HUD, and omitted backdrop account for much of the residual. |
| All levels | Decode and assemble all 48 landscapes, then transfer all ArrayBuffers with `structuredClone`. | 48/48 succeed; no missing object models and one missing texture in FLYTHRU. |
| Audio state | Compare reference player fields with emulator RAM for menu song 60 and Atlantis 1 song 1 at three timestamps each. | 210/210 menu fields and 189/189 Atlantis fields agree at every timestamp; output rate 22047 Hz, song master 22518. |
| Song selection | Break on `SongSelect` during boot, menus, game, and attract demos. | Boot 59, title 33, menu 60, Atlantis 1 song 1; attract demos do not start a new song. |

Verified against RAM: the captured projection is 45° vertical FOV with near plane 6;
fog colours reproduce the level data after the game's colour adjustment. Actor transforms match
`T · R · S`, including the three-axis Atlantis 3 actor `at3bspr`.

### 8.2 Known unknowns

The following semantics remain unverified unless explicitly noted.

Filesystem and tables:
- Level table `+0x18` text (`95%`, `50%`: a completion threshold?), `+0x2C` slot (save/progress), `+0x30` field C (copied
  to `0x801EF480`; values confirmed at runtime, meaning unknown), `+0x36` (bonus time limit in seconds; Atlantis Bonus
  counted down from 6:00 = 360 at runtime, consistent).
- The `.moo` record body layout (`{u16 frame; u16 buttons}`?) and which record each attract demo plays.
- Other releases (PAL `NGVP`, Japan if any) were not examined; their hard-coded ROM addresses will differ.

Levels:
- Animation: object animation blocks (record `+0x18`) are not decoded; models stand in their first key frame.
- The backdrop's draw path and screen mapping ([Environment](#37-environment-sky-fog-and-lighting)), camera records `9A..9C` and their link to enemies, `83`/`84` block structure,
  zones `A1`/`02`, sounds `BD`/`BE`, the `C1..C8` family, puzzle condition/action semantics, platform motion and parenting.
- Where boss arenas place Glover; the start camera's facing direction.
- Garib flag 1; node sprite fields beyond the texture; face-list flags `+0x1C`; node `+0x0C` as opacity for display-list nodes.
- Carnival 1's translucent floor pieces `ca1flco*` may be invisible in game.

Music:
- Which events play jingle pair A (30 + 4w) or B (32 + 4w); whether `[0x801F1B14]` (reverb 60, volume 55) is underwater.
- Reverb (BIGROOM) and the ramp shape follow libultra / Global Assault behaviour; not compared with captured audio.

### 8.3 References

- [FLA2 compression format](./compression/fla2.md).
- [Gex 64 audio storage](GEX64.md#5-audio) for the related libmus pointer-bank layout.
