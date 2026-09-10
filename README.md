# Rush Level Viewer

A browser viewer for the levels of the N64 games *San Francisco Rush 2049* (USA) and *San Francisco
Rush: Extreme Racing* (USA). Load a ROM, pick a level in the sidebar, and fly around freely. The
ROM is parsed entirely in the browser (in a Web Worker) and cached in IndexedDB; nothing is uploaded
anywhere.

## Run

    npm install
    npm run dev          # or: npm run build && npm run preview

Open the page, then choose or drop `San Francisco Rush 2049 (U) [!].z64` or
`San Francisco Rush - Extreme Racing (U) (M3) [!].z64` (`.v64`/`.n64` byte orders work too).

**Controls:** click the view to capture the mouse, then look around with the mouse · arrow keys look around · W A S D move ·
Space/E up · C/Q/Ctrl down · Shift faster · mouse wheel changes speed · R reset view · F nearest
filtering · H help · Esc releases the mouse.

## Layout

- `src/rom/`: ROM access and level decoding (no DOM dependencies; also runs under Node)
  - `index.ts`: `openRom()` detects the game from the header and returns its levels
  - `types.ts`: the render-ready level data shared by both games
  - `displaylist.ts`: F3DEX 1.x and F3DEX2 display-list interpretation
  - `texture.ts`: RDP texture memory emulation and N64 texture formats to RGBA8
  - `inflate.ts`, `lzss.ts`: codecs (raw DEFLATE, and both games' LZSS variants)
  - `rom.ts`, `level.ts`: Rush 2049 file table and level containers
  - `rush1.ts`: Rush (Extreme Racing) file tables and track containers
- `src/worker.ts`: parses the ROM and levels off the main thread
- `src/render/`: WebGL2 renderer, free-fly camera and controls
- `src/ui/`: React UI (landing page, sidebar, viewport)
- `tools/`: Node scripts, run with `npx tsx`
  - `levelstats.ts rom.z64 [sheetDir]`: parse all levels, print stats, write texture contact sheets
  - `extract.ts rom.z64 outDir`: dump every decompressed asset file (Rush 2049 only)

## ROM format notes

Both games draw with the RDP tile commands and share several conventions:
- Vertex coordinates are 1/16 of a world unit.
- Placement matrices are 3×3 in row-vector convention, followed by a translation.
- **Handedness.** Both worlds are mirrored relative to a right-handed, Y-up frame, so the viewer
  negates X in vertices and transforms. Without that, signs read backwards and landmarks swap sides:
  the Golden Gate Bridge appears left of the Rush 2049 start line instead of right of it.

### Texture memory (both games)

Textures are uploaded with the RDP tile commands, not read in place.
- `G_LOADBLOCK` copies texels into a 4 KB texture memory. `G_SETTILE` gives the tile's row length in
  bytes (`((w0 >> 9) & 0x1ff) * 8`) and its start offset (`(w0 & 0x1ff) * 8`).
- Texture memory is organised in 64-bit words. Odd texel rows are fetched with the two halves of each
  word swapped (byte address xor 4; xor 8 for 32-bit texels).
- The block load swaps odd rows as well when its dxt row counter is non-zero. So textures loaded with
  dxt = 0 are stored pre-swapped in the ROM, and decoding them as plain rows gives an interlaced
  look. `texture.ts` emulates both steps.
- Texture coordinates are relative to the tile's upper-left corner from `G_SETTILESIZE`: the RDP
  samples texel (s − uls, t − ult). Rush 1 often sets a non-zero corner. Ignoring it shows the
  mirrored copy of mirror-wrapped textures (e.g. the START banner) or smears clamped ones.

### San Francisco Rush 2049

- The boot segment (ROM 0x1000, loaded at 0x80000400) inflates the main code image from ROM 0xB0CB10
  to 0x80086A50 (0x9DFA0 bytes).
- **Asset file table.** 182 entries.
  - ROM offsets: main image at 0x8011B5BC (count + 1 entries).
  - Types: main image at 0x80123564 (0 raw, 1 LZSS, 2 raw DEFLATE).
  - Decompressed sizes: boot segment at 0x8002E580.
- **LZSS.** A flag byte is read LSB-first: bit 1 is a literal byte; bit 0 is a match `b0 b1`.
  - Distance `((b0 & 0xF0) << 4) | b1`; length `(b0 & 0x0F) + 2`.
  - A distance of 0 with a length nibble of 0 ends the stream.
- **Levels.** Model file 101+n, placement file 120+n, for n = 0..18: Track 1–6, Battle 1–8, Stunt
  1–4, Obstacle Course.
- **Tagged containers.** Both level files end in a trailer of `{tag, offset, count|size}` records,
  pointed to by the u32 at offset 0.
  - **Model files:**
    - `IMAG`: texel data.
    - `TXLD`: texture-setup display lists.
    - `OBHD`: 88-byte object headers, holding name, radius, and LOD slots of
      `{flags, distance, display list, vertices}`.
    - `PLHD`/`TXHD`: named palettes and textures.
    - `OBJS`: vertices and F3DEX2 display lists. Display-list and vertex addresses are file offsets;
      texture addresses are IMAG-relative.
    - `PATH`/`PTHD`: motion paths of scripted objects. PTHD entries are 36 bytes; keyframes are 68
      bytes (position, direction, scale, quaternion, timing).
  - **Placement files:**
    - `WHDR`: level id.
    - `WOBJ`: 104-byte instances (name, matrix, translation, ids, bounds).
    - `GTLD`/`GDAT`: not used by the viewer.
- **Objects placed by name but stored elsewhere:** per-track props in file 82+n (race tracks), coins
  in 68, battle weapon icons in 76. Stored names carry suffixes such as `G1` and are truncated to
  15 characters.

### San Francisco Rush: Extreme Racing

- The boot segment decompresses the main code image with LZSS from ROM 0x7A7930 to 0x8005BB10.
- **LZSS.** Same flag and match encoding as Rush 2049, but a match gives an absolute position in a
  4096-byte ring buffer (the write position starts at 1). There is no stored size.
- **File tables.** Both hold u32 ROM offsets, and every file is LZSS-compressed.
  - Table A: main image at 0x800C7C38, 65 entries.
  - Table B: 0x800C7BA4, entries 30–36.
- **Tracks.** For track n (1–7; the track select shows 1–6):
  - A[29+n]: model container.
  - B[29+n]: placement.
  - A[29]: shared track textures.
  - A[5]: shared objects (trees, cones, keys, meters).
- **Segments.** Races load files one after another into a heap addressed as segment 5: the model,
  then A[29] (16-byte aligned). Track display lists address textures past the end of the model
  file. A[5] is segment 6.
- **Model container.** A header of segmented pointers:
  - +0: 24-byte name records (name, radius, flags).
  - +4: object count.
  - +0x10 and +0x18: texture and palette name tables.
  - From 0x20: 52-byte object records, with the display list at +12.
  - Display lists are F3DEX 1.21.
- **Placement.** The level name sits at +8, followed by 100-byte instances from 0x18 (name, matrix,
  translation, flags, bounds). Instances form a tree:
  - +68 (i16) is the next sibling and +70 (i16) the first child, as entry indices.
  - A child's translation is relative to its parent's, e.g. cones and trees parented to track
    pieces.

## Known gaps

- Rush 2049: scripted objects are shown frozen at the start of their paths.
- Not shown: checkpoint flags, weapon power-up icons, invisible trigger/collision volumes, cars.
- No fog, and only the most detailed LOD is used.
