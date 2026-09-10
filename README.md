# Rush 2049 Level Viewer

A browser viewer for the levels of *San Francisco Rush 2049* (N64, USA). Load the ROM, pick a
level in the sidebar, and fly around freely. The ROM is parsed entirely in the browser (in a Web
Worker) and cached in IndexedDB; nothing is uploaded anywhere.

## Run

    npm install
    npm run dev          # or: npm run build && npm run preview

Open the page, then choose or drop `San Francisco Rush 2049 (U) [!].z64` (`.v64`/`.n64` byte orders
work too).

**Controls:** click the view to capture the mouse, then look around with the mouse · arrow keys look around · W A S D move ·
Space/E up · C/Q/Ctrl down · Shift faster · mouse wheel changes speed · R reset view · F nearest
filtering · H help · Esc releases the mouse.

## Layout

- `src/rom/`: ROM access and level decoding (no DOM dependencies; also runs under Node)
  - `rom.ts`: header check, main code image, asset file table, file decompression
  - `inflate.ts`, `lzss.ts`: the game's two codecs (raw DEFLATE, LZSS)
  - `level.ts`: level containers, F3DEX2 display-list interpretation, placement
  - `texture.ts`: N64 texture formats to RGBA8
- `src/worker.ts`: parses the ROM and levels off the main thread
- `src/render/`: WebGL2 renderer, free-fly camera and controls
- `src/ui/`: React UI (landing page, sidebar, viewport)
- `tools/`: Node scripts, run with `npx tsx`
  - `extract.ts rom.z64 outDir`: dump every decompressed asset file
  - `levelstats.ts rom.z64 [sheetDir]`: parse all levels, print stats, write texture contact sheets

## ROM format notes

- The boot segment (ROM 0x1000, loaded at 0x80000400) inflates the main code image from ROM
  0xB0CB10 to 0x80086A50 (0x9DFA0 bytes).
- **Asset file table.** 182 entries.
  - ROM offsets: main image at 0x8011B5BC (count + 1 entries).
  - Types: main image at 0x80123564 (0 raw, 1 LZSS, 2 raw DEFLATE).
  - Decompressed sizes: boot segment at 0x8002E580.
- **LZSS.** A flag byte is read LSB-first: bit 1 is a literal byte; bit 0 is a match `b0 b1`.
  - Distance `((b0 & 0xF0) << 4) | b1`; length `(b0 & 0x0F) + 2`.
  - A distance of 0 with a length nibble of 0 ends the stream.
- **Levels.** Model file 101+n, placement file 120+n, for n = 0..18: Track 1–6, Battle 1–8,
  Stunt 1–4, Obstacle Course.
- **Tagged containers.** Both level files end in a trailer of `{tag, offset, count|size}` records,
  pointed to by the u32 at offset 0.
  - **Model files:**
    - `IMAG`: texel data.
    - `TXLD`: texture-setup display lists.
    - `OBHD`: 88-byte object headers, holding name, radius, and LOD slots of
      `{flags, distance, display list, vertices}`.
    - `PLHD`/`TXHD`: named palettes and textures.
    - `OBJS`: vertices and F3DEX2 display lists. Vertex coordinates are 1/16 world unit;
      display-list and vertex addresses are file offsets; texture addresses are IMAG-relative.
    - `PATH`/`PTHD`: motion paths of scripted objects. PTHD entries are 36 bytes; keyframes are
      68 bytes (position, direction, scale, quaternion, timing).
  - **Placement files:**
    - `WHDR`: level id.
    - `WOBJ`: 104-byte instances (name, 3×3 matrix in row-vector convention, translation, ids,
      bounds).
    - `GTLD`/`GDAT`: not used by the viewer.
- **Texture memory.** Textures are uploaded with the RDP tile commands, not read in place.
  - `G_LOADBLOCK` copies texels into a 4 KB texture memory. `G_SETTILE` gives the tile's row
    length in bytes (`((w0 >> 9) & 0x1ff) * 8`) and its start offset (`(w0 & 0x1ff) * 8`).
  - Texture memory is organised in 64-bit words. Odd texel rows are fetched with the two halves
    of each word swapped (byte address xor 4; xor 8 for 32-bit texels).
  - The block load swaps odd rows as well when its dxt row counter is non-zero. So textures
    loaded with dxt = 0 are stored pre-swapped in the ROM, and decoding them as plain rows gives
    an interlaced look. `texture.ts` emulates both steps.
- Objects placed by name but stored elsewhere: per-track props in file 82+n (race tracks), coins in
  68, battle weapon icons in 76. Stored names carry suffixes such as `G1` and are truncated to 15
  characters.

## Known gaps

- Scripted objects are shown frozen at the start of their paths.
- Not shown: checkpoint flags, weapon power-up icons, invisible trigger/collision volumes, cars.
- No fog, and only the most detailed LOD is used.
