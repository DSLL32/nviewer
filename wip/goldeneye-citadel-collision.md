# GoldenEye: Citadel collision (old-format stan file)

**Committed as dcabac1** (stan.ts and GOLDENEYE.md; the main session checked tsc in a clean worktree). The notes below
describe the state at wind-down. The only item left is the optional in-app screenshot. In the offline top view, the
central hub and the outer ring don't show collision, probably because roofs cover them in that view; check it in the
app if it matters.

## Done and working

- `src/rom/goldeneye/stan.ts` `parseStan`: if the retail layout finds no tiles and the first tile offset is 0xC, it decodes
  the older float layout into the same `StanTile` shape. Only the Citadel's `Tbg_cat_all_p_stanZ` is affected: every
  retail file yields tiles from the retail parse.
  - `offset` = the tile's file offset; `id` = tile index; `room`; `flags` = `w`; `plane` = [b1, b2, b3].
  - Points hold floats in BG units; `link` keeps the raw u32.
- The Citadel (level 32, "Citadel (unused)") now has the usual hidden `collision` layer: 485 tiles, 606 triangles. It has
  the same colours and 2-unit lift as retail, world units at an identity instance, and `triSource` = tile file offset.
  `goldeneye.ts` needed no change: it already calls `collisionBatch` whenever the stan file has tiles.
- GOLDENEYE.md:
  - §4.10: a compact byte layout of the old format, replacing the line "Tbg_cat doesn't follow this layout".
  - §8: the Citadel stan row now says the viewer decodes the file and shows it in the collision layer.

## Old stan layout (from the bytes of Tbg_cat_all_p_stanZ, 0x88A0 bytes, identical to the ROM file)

| offset | field | status |
|---|---|---|
| +00 | u32 0 | verified |
| +04 | u32 0xC, the first tile offset | verified |
| +08 | u32 0 | verified |
| tile +0 | u32 name: file offset of an 8-byte NUL-padded name ("p502a2" …) | verified: 485 names, one per tile in tile order, table 0x7970..0x8898 |
| tile +4 | u16 w: values 0xFFF (196), 0xCCC (196), 0xAAA, 0xBBB … like the retail flags | meaning unknown |
| tile +6 | u16 room: BG room number | verified: all 485 tiles lie inside their room's BG box read as BG units (only 339 fit as world units) |
| tile +8 | u8 n: point count 3..7 (416 × 3, 37 × 4, 19 × 5, 6 × 6, 7 × 7) | verified |
| tile +9..+B | u8 b1, b2, b3: always three distinct indices < n | meaning unknown per scope. Fact: every point of every tile lies in the plane of those three points (max deviation 0), like retail i0/i1/i2 |
| tile +C | n × {f32 x, y, z; u32 link}: whole-number BG units; link = absolute file offset of the neighbour tile across edge k → k+1, 0 = none | verified: 1,122 of 1,122 links hit a tile and share that edge; 1,120 are reciprocal |
| after the tiles (0x7948) | 8 zero bytes, then 32 bytes holding "unstric" padded with zeros, then the name table (485 × 8 bytes), then 8 zero bytes | layout verified; "unstric" unknown |

Research decoder, for comparison: `/home/n64/.ai-tmp/4e5bcc90-63d3-4729-b96c-d3f32b8822ea/ge/unused/stan.py`. It agrees,
but doesn't describe the name table.

## Verification status

- **tsc:** `npx tsc --noEmit -p .` exit 0.
- **hashall, other games:** the working tree and a `git archive HEAD src` copy give identical hashes for all 12 ROMs.
  - Hashes: `/home/n64/.ai-tmp/r49/impl/ge_core/hash_now7.txt` and `hash_head7.txt`.
  - HEAD copy: `/home/n64/.ai-tmp/r49/impl/ge_core/head3/`.
- **GoldenEye per level:** full hash (textures, meshes with triSource/info, instances, layers, markers, environment, camera,
  bounds) against the HEAD copy. Only `32 cat` differs, as expected.
  - Script: `/home/n64/.ai-tmp/r49/impl/ge_core/gehash3.ts <src root>`.
  - Outputs: `gehash3_head.txt` and `gehash3_now.txt`.
- **structuredClone:** every GoldenEye level loaded twice (66 loads), each with all whole-buffer typed arrays transferred:
  OK. Script: `/home/n64/.ai-tmp/r49/impl/ge_core/transfer2.ts`.
- **layeraudit:** `npx tsx /home/n64/.ai-tmp/r49/impl/layeraudit.ts goldeneye` exit 0, "collision in 33".
- **Render:** offline raster overhead view of Citadel rooms | rooms + collision; the tiles lie on the quadrant and corridor
  floors.
  - Image: `/home/n64/.ai-tmp/r49/impl/ge_core/renders/citadel_collision_top.png`.
  - Script: `/home/n64/.ai-tmp/r49/impl/ge_core/citadel.ts`.
  - An in-app Playwright screenshot from a worktree build was NOT taken; the coordinator's scope change said one overhead
    screenshot is enough.
- **Byte analysis:** `/home/n64/.ai-tmp/r49/impl/ge_core/oldstan.ts` (header, tiles, name table, plane check, links, units).

## Left

- The main session reviews and commits the stan.ts and GOLDENEYE.md hunks.
- Optional, if wanted: an in-app Playwright screenshot of the Citadel with the collision layer on, from a clean worktree
  build on a free port (not 5174).
- Skipped by scope: what `w` and b1–b3 mean, tile names in the selection info, deeper link work.

## Pitfalls

- **Detection:** a retail file with a single section has the same 12-byte header (0, 0xC, 0). The old layout is therefore
  only tried when the retail parse yields no tiles.
- **Links:** old links are absolute file offsets; retail links are ×8 plus the first section offset (84.5%).
- **Units:** coordinates are BG units, like retail s16, not world units; `collisionBatch` divides by the stage scale.
- **Waiting on processes:** `pgrep -f "hashall.ts"` inside a wait loop matched the waiting shell itself. Wait on explicit
  PIDs, or use a background task notification.

## Next steps

1. `git diff src/rom/goldeneye/stan.ts GOLDENEYE.md` and review.
2. Re-run the checks: `npx tsc --noEmit -p .`; `npx tsx /home/n64/.ai-tmp/r49/impl/layeraudit.ts goldeneye`; `npx tsx
   /home/n64/.ai-tmp/r49/impl/ge_core/transfer2.ts`; and, if the tree moved, `gehash3.ts` against a fresh `git archive
   HEAD src` copy plus hashall for the other games.
3. Commit the two files (main session).
