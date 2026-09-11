# N64 Level Viewer

A browser viewer for the levels of these N64 games (USA versions): *San Francisco Rush 2049*,
*San Francisco Rush: Extreme Racing*, *Bomberman 64*, *Bomberman 64: The Second Attack!*,
*Bomberman Hero*, *BattleTanx*, *BattleTanx: Global Assault*, *Gex 64: Enter the Gecko* and
*Gex 3: Deep Cover Gecko*. Load one or more ROMs, pick a level in the sidebar, and fly around freely, with
each game's soundtrack in the music box. ROMs are parsed entirely in the browser (in a Web Worker)
and cached in IndexedDB; nothing is uploaded anywhere.

## Run

    npm install
    npm run dev          # or: npm run build && npm run preview

Open the page, then choose or drop ROM files such as `San Francisco Rush 2049 (U) [!].z64` or
`Bomberman Hero (U) [!].z64` (`.v64`/`.n64` byte orders work too).

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
  - `bomberman/`: the Bomberman games (full format notes in `BOMBERMAN.md`)
    - `codecs.ts`, `archive.ts`: LZSS (1 KB and 4 KB rings), Yay0, file archives
    - `container64.ts`, `bm64.ts`, `bmhero.ts`: "64" model containers, Bomberman 64 and Hero levels
    - `niff.ts`, `bm64sa.ts`: NIFF models and The Second Attack scenes
    - `music.ts`: song tables and compressed MIDI
  - `lzari.ts`, `battletanx.ts`, `battletanxga.ts`: BattleTanx and Global Assault (format notes
    in `BATTLETANX.md`)
  - `gex/`: Gex 64 and Gex 3 (format notes in `GEX.md`)
    - `common.ts`: object table, synthetic display lists, Z-up transform, object meshes
    - `gex64.ts`, `gex3.ts`: level tables, render trees, skies, placements
  - `music/`: `musyx.ts`, `rush2049.ts` (Rush 2049), `libultra.ts` (libultra bank/sequence
    synthesizer shared by Rush 1, the Bomberman games and BattleTanx), `rush1.ts`, `libmus.ts`
    (Software Creations' libmus as used by Global Assault and Gex 3), `libmus64.ts` (the older libmus
    revision in Gex 64)
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
  the Golden Gate Bridge appears left of the Rush 2049 start line instead of right of it. The
  games' own modelview matrices start with diag(−1, 1, 1).
- **Culling.** With X negated, front faces wind counter-clockwise. The games cull back faces, and
  double-sided faces are stored as reversed-winding twins. The viewer's culling is optional and off
  by default.
- **Fog.** Read from the per-frame display list in RAM during races.
  - Both games project with near 40 and far 32040 (vertex units) and use fog colour 0x9696BEFF.
  - Rush 1 sets gSPFogFactor(32000, −31744), fog position 996–1000. That gives haze from about
    480 world units away, complete by about 1980.
  - Rush 2049 sets fog position 1000–1042, beyond the far plane, so no fog is visible.

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
- **Music** (Factor 5 MusyX, mixed on the RSP at 22050 Hz). `src/rom/music/musyx.ts` renders
  songs offline.
  - **Files:** file 6 is the sound project, file 7 holds the instrument scripts (SoundMacros) and
    ADSR tables, file 8 is a 195-entry sample directory, and file 9 is the sample data.
  - **Songs:** song n is file 10+n, played with project group n. The names come from the AUDIO →
    MUSIC TRACK table at 0x80110030.
  - **Sample codec:** a 256-byte codebook (8 order-2 predictors), then 40-byte blocks of 64
    samples, each two subframes of 2 raw samples plus a predictor/shift byte and 30 nibbles.
  - **Song format:** a tempo table at 384 ticks per beat, loop-start ticks, up to 64 tracks of
    region entries, and region data of run-length delta times plus 2-byte note, program and
    controller events.
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
- **Sky.** Game code (0x800A7494) builds it at race start rather than loading it from level data.
  - A dome around the camera: a centre plus three rings of 8 vertices.
  - Tables in main code: positions 0x800C7D88, texture coordinates 0x800C7EB4, alpha 0x800C7F7C
    (fading to 0 at the horizon), polygons 0x800C7F98.
  - Texture: SKY01 or SKYFOUR from A[5], picked at random per race. Drawn blended, without depth
    or fog.
- **Music.** libultra MIDI sequence player at 22050 Hz. `src/rom/music/rush1.ts` renders songs offline.
  - **Instrument bank:** ALBankFile at ROM 0x5D9350, with VADPCM sample data (.tbl) at 0x5DF380.
  - **Songs:** ALSeqFile at 0x6F80A0 holds 16 LZSS-compressed, format-0 MIDI sequences.
  - **Race music:** the options pick from the 9 sequence numbers in the table at 0x800D2910; the
    names come from SETUP > AUDIO > Music Track.
  - **Per-song gain:** the f32 table at 0x800C3EF4.
  - **Accuracy:** renders line up with the game's own audio output. Not modelled: reverb (its send
    level is 0 for music) and a tempo drift of about 0.04%.
- **Placement.** The level name sits at +8, followed by 100-byte instances from 0x18 (name, matrix,
  translation, flags, bounds). Instances form a tree:
  - +68 (i16) is the next sibling and +70 (i16) the first child, as entry indices.
  - A child's translation is relative to its parent's, e.g. cones and trees parented to track
    pieces.

### Bomberman 64, The Second Attack!, Bomberman Hero

`BOMBERMAN.md` documents the formats in full; in short:
- **Files.** Bomberman 64 keeps assets in an indexed archive at ROM 0x300000 (1 KB-ring LZSS), The
  Second Attack in a resource block at 0x2A0000 (LZSS or Yay0). Hero's files are 4 KB-ring LZSS
  streams addressed by ROM offset.
- **Geometry.** Vertex units are world units, right-handed and Y up (no mirroring). Bomberman 64
  and Hero use "64" containers with F3DEX 1.x lists (segment 2 = container); The Second Attack uses
  NIFF models with F3DEX2 lists, whose render mode comes from each object's draw layer.
- **Render state from game code.** The lists rely on geometry and render modes set by the game
  (back-face culling, cutout alpha), and on RSP lighting: vertex colour bytes are normals. The
  loaders bake the lights the game sets up into vertex colours (world-space directions).
  `displaylist.ts` gained options for all of this, plus G_LOADTILE, matrices and a combiner fold
  for PRIM/ENV colours; the Rush loaders don't use them.
- **Levels.** The per-stage setup (map parts, fog, clear colour, lights, backdrop picture) is
  hard-coded in each Bomberman 64 stage overlay, so `bm64.ts` tables it. Hero and The Second
  Attack read it from stage tables, environment records and scene descriptors.
- **Backdrops.** Skies are 2D pictures drawn across the screen before the 3D pass
  (`Level.backdrop`).
- **Music.** libultra's compressed-MIDI player (alCSPlayer) with ALBankFile banks and VADPCM, read
  uncompressed from one "S2" blob per game, output at 32 kHz. Bomberman 64 and Hero loudness match
  captured game audio as is; The Second Attack's sequence volume needs a factor of 0.75.

### BattleTanx, BattleTanx: Global Assault

`BATTLETANX.md` documents the formats in full; in short:
- **Files.** Both games have uncompressed code with file ranges hard-coded in it; LZARI is the only
  asset codec. Level files hold placements, models and references into raw ROM pools of small
  display-list chunks (texture/render state and geometry) with chunk-relative addresses.
- **Loading.** Like the games, the loaders copy the chunks a level uses, relocate them and patch them:
  BattleTanx swaps in fog render modes and scales vertex colours by 1.92; Global Assault forces fog
  and culling in its state chunks and lights everything with the level's two lights and ambient
  colour (baked per placed yaw).
- **Space.** World units, right-handed, Y up, no mirroring; placements turn about Y.
- **Levels.** BattleTanx: the 17 campaign levels, the Battlelord territories and four levels no menu
  reaches (the attract-mode set and Test 2-4). Global Assault: the 19 missions, the battle arenas,
  cutscene variants, an unused SF Airport arena and a test maze. Palettes are per slot (BattleTanx,
  also team colours) or merged 16-entry loads (Global Assault).
- **Fog and sky.** Every level is fogged and the sky is cleared to the fog colour.
- **Music.** BattleTanx: Standard MIDI files on libultra's sequence player; Global Assault:
  Software Creations' libmus, emulated tick by tick with BIGROOM reverb. Both at 22047 Hz; loudness
  and loop lengths checked against captured game audio.

### Gex 64: Enter the Gecko, Gex 3: Deep Cover Gecko

`GEX.md` documents the formats in full; in short:
- **Files.** Every compressed file is raw DEFLATE. A level inflates to one image linked at 0x8024B000
  (absolute pointers); objects are relocatable files named in an 8-character object table.
- **Space.** World units, right-handed with Z up, no mirroring; the viewer turns Z up into Y up.
- **World geometry.** A render tree whose leaves hold small display-list fragments.
  - Gex 64 (F3DEX 1.x): the fragments of a leaf share the RSP vertex buffer, so each leaf runs in
    order. Chunk flags select translucency, a flipbook material (frame 0 shown) or an animated-texture
    record, whose frame 0 the loader loads with the same commands as the game's material lists.
  - Gex 3 (F3DEX2): fragments carry only vertices and triangles; the game draws them grouped by
    material, after its world render state. The loader rebuilds those lists.
- **Skies.** Patches drawn around the camera (`Level.skies`).
- **Fog.** Colour and start come from the level header (fog position about 994–1000); the sky is
  cleared to the fog colour.
- **Objects.** Placements use angles of 4096 per turn (T · Rx · Ry · Rz). Gex 64 objects are face
  lists or display-list meshes, skeletal ones built in the rest pose; Gex 3 rigid meshes are drawn,
  skinned ones are skipped.
- **Levels.** Gex 64: the Media Dimension hub, the 14 channel levels, bonus and boss levels, the intro
  and logo scenes. Gex 3: the four hub areas, 11 TV levels, bonus and Secret TV levels, bosses, the
  title screen and intros. Names come from the games' own tables.
- **Music.** Software Creations' libmus at 22050 Hz, one tick per video frame.
  - Gex 64 uses an older player revision with per-level banks. Its list includes the four jingles and
    an unused Pre-History Channel song that no table references.
  - Gex 3 shares Global Assault's revision, without reverb.
  - Both games play music quietly (about −33 dBFS; renders match captured game audio within about
    1 dB and without drift). The viewer boosts them for playback (Gex 64 ×2.25, Gex 3 ×6).

## Known gaps

- Rush 2049: scripted objects are shown frozen at the start of their paths.
- Rush: not shown: checkpoint flags, weapon power-up icons, invisible trigger/collision volumes, cars.
- Rush: no fog, and only the most detailed LOD is used.
- Bomberman 64: props placed by stage code, and boss arenas built only from object models, are not
  shown. The Second Attack: only map geometry and battle soft blocks; story objects and characters
  are not shown. Textures bound at run time from texture sets stay untextured.
- Bomberman: animated textures (UV scrolling water) are static; environment mapping is approximate;
  translucent effects that blend by fog alpha are not modelled.
- BattleTanx: tanks, pickups and destructible states other than the intact one are not shown; team
  colour palette animations show a fixed frame; only the most detailed LOD is used. BattleTanx music
  runs about 0.05% fast (the game's 16 ms audio poll rounding is not modelled).
- Gex: animated materials (flipbooks, scrolling water and lava) show their first frame; characters
  and enemies stand in their rest pose, and skinned Gex 3 objects are not shown. Objects that the
  level scripts spawn are not shown; invisible volumes and marker boxes (Gex 3 sound emitters) are
  hidden by class or by their all-black placeholder texture. Vertex-colour animation (flickering
  lights) shows the file's colours.
