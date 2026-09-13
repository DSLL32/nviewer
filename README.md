# N64 Level Viewer

A browser viewer for the levels of these N64 games (USA versions): *San Francisco Rush 2049*,
*San Francisco Rush: Extreme Racing*, *Bomberman 64*, *Bomberman 64: The Second Attack!*,
*Bomberman Hero*, *BattleTanx*, *BattleTanx: Global Assault*, *Gex 64: Enter the Gecko*,
*Gex 3: Deep Cover Gecko*, *Yoshi's Story* (Japan), *Star Fox 64* (V1.0 and V1.1), *GoldenEye 007*,
*Off Road Challenge* (USA and Europe), *Pilotwings 64* (USA, Europe and Japan), *Pokémon Snap*,
*Perfect Dark* (V1.0), and *The Legend of Zelda: Ocarina of Time* and
*Majora's Mask* (retail and debug builds, plus the 1997 Ocarina of Time prototype preserved on an F-Zero X development
cartridge). Load one or more ROMs, pick a level in the sidebar, and fly around freely, with
each game's soundtrack in the music box. ROMs are parsed entirely in the browser (in a Web Worker)
and cached in IndexedDB; nothing is uploaded anywhere.

The viewer can also open the `bbgames` source root and expose a first set of hidden and historical
Zelda scene objects from `z_ocarina2` (preferred) or `z_ocarina`. This mode uses
`showDirectoryPicker()` to obtain a real directory handle and reads only its explicit 124-file
allowlist; it does not upload or enumerate the folder, and it does not cache the source files.
Firefox does not currently provide this directory-handle API, so source-folder mode requires a
supporting browser such as Chromium. Normal ROM loading continues to work in Firefox.

## Run

    npm install
    npm run dev          # or: npm run build && npm run preview
    npm run build:single # one self-contained dist/nviewer.html: open it from the filesystem, no server

Open the page, then choose or drop ROM files such as `San Francisco Rush 2049 (U) [!].z64` or
`Bomberman Hero (U) [!].z64` (`.v64`/`.n64` byte orders work too).

While the development server is running, research PNGs beneath `~/.ai-tmp/r49` are available at
`/__artifacts/<relative-path>`. Set `NVIEWER_ARTIFACTS_DIR` to use a different artifact root. This
read-only endpoint is development-only and serves PNG files without directory listings.

For side-by-side comparison, Shift-click a level to open it in a right-hand pane. Ordinary clicks
continue to choose the left pane. The panes synchronize their cameras and every compatible View
setting; options without a matching setup, lighting preset, or layer in the other level remain local.
Use **Close pane** in the right pane's View panel to return to a single view.

For the Zelda source maps, choose **Open bbgames folder…** and select the `bbgames` directory itself,
not either Zelda child directory. It must directly contain `z_ocarina2` and/or `z_ocarina`.

**Side-scrollers** (Yoshi's Story) open in a side view through the game's own camera: drag or W A S D / arrow keys
pan, the wheel (or Space/E, C/Q) zooms, V switches to free fly, and the Layers panel shows or hides background
layers, objects, collision and markers.

**Controls:** click the view to capture the mouse, then look around with the mouse · arrow keys look around · W A S D move ·
Space/C move along world up/down · E/Q move along camera up/down · Ctrl+click selects an object and Alt+click a face (details, and a Report button that saves a bug report with screenshots when running the dev server; Report view reports the whole view) · Shift faster · mouse wheel changes speed · R reset view · X cutaway (hides the nearest surface, to look into enclosed areas) · F wireframe ·
Z shows or hides collision · Shift+F collision wireframe · the View panel can hide markers · H help · Esc releases the mouse.

## Layout

- `src/rom/`: ROM access and level decoding (no DOM dependencies; also runs under Node)
  - `index.ts`: `openRom()` detects the game from the header and returns its levels
  - `types.ts`: the render-ready level data shared by both games
  - `displaylist.ts`: F3DEX 1.x and F3DEX2 display-list interpretation
  - `texture.ts`: RDP texture memory emulation and N64 texture formats to RGBA8
  - `inflate.ts`, `lzss.ts`: codecs (raw DEFLATE, and both games' LZSS variants)
  - `rom.ts`, `level.ts`: Rush 2049 file table and level containers
  - `rush1.ts`: Rush (Extreme Racing) file tables and track containers
  - `rushcollision.ts`: both Rush games' collision polygons (hidden overlay layers)
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
  - `yoshi/`: Yoshi's Story (format notes in `YOSHISTORY.md`)
    - `slide.ts`: the CMPR/SMSR00 slide-LZ codec
    - `yoshi.ts`: world list, tile layers at parallax depths, collision overlay, sprites and markers
    - `yoshicell.ts`: Yoshi's animation cells; `music.ts`: song table; `names.ts`: leak cast and world names
  - `sf64/`: Star Fox 64 (format notes in `STARFOX.md`)
    - `fs.ts`: DMA file table, MIO0, scene segment maps, per-version tables, the display-list address space
    - `sf64.ts`: level list, placement lists, render-preset recipes, skeletons, event actors, grounds, Titania
      terrain, environment; `names.ts`: object and event-actor names from the decompilation
  - `goldeneye/`: GoldenEye 007 (format notes in `GOLDENEYE.md`)
    - `rom.ts`: data segment, file table, text banks, stage tables; `textures.ts`: the zlib and bit-packed texture codecs
    - `bg.ts`: BG rooms; `environment.ts`: fog, clear colour, sky planes; `setup.ts`, `stan.ts`: setup files, floors
    - `models.ts`, `place.ts`: prop and character models at rest, object placement; `goldeneye.ts`: levels;
      `music.ts`: songs and their loop rules
  - `pilotwings/`: Pilotwings 64 (USA, Europe and Japan; format notes in `PILOTWINGS64.md`)
    - `fs.ts`, `tables.ts`: UVRM/TABL filesystem, FORM/MIO0 decoding, task and environment tables
    - `texture.ts`, `model.ts`, `objects.ts`: UVTX textures, UVMD/UVCT/UVTR geometry, UPWT/UPWL objects and paths
    - `environment.ts`, `pilotwings.ts`: island assembly, skies, fog, layers and levels; `music.ts`: songs and loops
  - `offroad/`: Off Road Challenge (USA and Europe; format notes in `OFFROADCHALLENGE.md`)
    - `fs.ts`: regional file tables, raw file views and RAM-pointer resolution
    - `level.ts`, `texture.ts`: sectors, placements, float meshes, packed-CI4/RGBA16 materials, objects, collision candidates
    - `offroad.ts`: nine tracks and game assembly; `music.ts`: WESS songs and authored loops
  - `perfectdark/`: Perfect Dark (format notes in `PERFECTDARK.md`)
    - `rom.ts`: data segment, file and stage tables, text; `texture.ts`: the global texture store and its two decoders
    - `gbi.ts`: Perfect Dark's display-list microcode; `bg.ts`: rooms and sky rooms; `environment.ts`: fog, sky planes;
      `pads.ts`: pads and spawns; `setup.ts`, `models.ts`, `anim.ts`, `place.ts`, `objects.ts`: setup records, model
      files, animations (standing poses), placement and object layers; `perfectdark.ts`: levels; `music.ts`: songs
  - `zelda/`: Ocarina of Time and Majora's Mask (format notes in `ZELDA64.md`)
    - `fs.ts`, `tables.ts`: build detection, Yaz0 filesystem, code tables; `scene.ts`: scene and room headers
    - `elf.ts`, `source.ts`, `sourceManifest.ts`: bounded MIPS ELF relocation and the explicit bbgames
      hidden-map allowlist/source loader
    - `drawconfig.ts`: animated materials at frame 0; `env.ts`, `sky.ts`, `jpeg.ts`: lights, fog, skyboxes, prerendered
      backgrounds; `collision.ts`, `actors.ts`, `names.ts`: collision, static actors, names; `zelda.ts`: levels;
      `music.ts` with `music/zelda64.ts` (Zelda's revision of the EAD sequence driver)
    - `alpha.ts`: the Ocarina of Time prototype in the F-Zero X ROM (identified by hash; its 52 scenes are raw in the
      upper half of the ROM)
  - `music/`: `musyx.ts`, `rush2049.ts` (Rush 2049), `libultra.ts` (libultra bank/sequence
    synthesizer shared by Rush 1, the Bomberman games and BattleTanx), `rush1.ts`, `libmus.ts`
    (Software Creations' libmus as used by Global Assault and Gex 3), `libmus64.ts` (the older libmus
    revision in Gex 64), `nas.ts` (Nintendo EAD's "Nas" sequence driver, used by Yoshi's Story), `sf64.ts`
    (Star Fox 64's EAD sequence driver)
- `src/worker.ts`: parses the ROM and levels off the main thread
- `src/render/`: WebGL2 renderer, free-fly camera and controls
- `src/ui/`: React UI (landing page, sidebar, viewport)
- `tools/`: Node scripts, run with `npx tsx`
  - `levelstats.ts rom.z64 [sheetDir]`: parse all levels, print stats, write texture contact sheets
  - `extract.ts rom.z64 outDir`: dump every decompressed asset file (Rush 2049 only)
  - checking scripts, over every supported ROM (`roms.ts`; the ROM directory is `$NVIEWER_ROMS`,
    default `/data/software/ai-scratch`; each takes optional ROM name filters):
    - `npm run check:hashes` (`hashall.ts`): hash every level of every game, to show that a change to
      one loader leaves the others bit-identical. `--src <checkout>` loads the loaders from another
      checkout, e.g. a worktree of HEAD, for the baseline.
    - `npm run check:transfer` (`transfer.ts`): load every level twice through `structuredClone` with
      all ArrayBuffers transferred, as `src/worker.ts` does. Catches buffers shared between levels.
    - `npm run check:layers` (`layeraudit.ts`): every drawn instance must be in a toggleable layer, and
      every game except Star Fox 64 must have a collision layer.
    - `npm run check:render` (`render/selftest.ts`): numeric self-checks of the offline renderer.
    - `npm run check:zelda-source -- /path/to/bbgames`: load the 21 allowlisted Zelda source maps twice,
      exercise transferable buffers, audit their layers, and test the linked `zelda_tool_rom.o` fallback.
  - `tools/render/`: offline software rasterizer for the `Level` model (`raster.ts`), PNG read/write
    (`png.ts`), side-by-side image comparison (`compare.ts`), texture contact sheets (`sheet.ts`) and a
    tiny font (`font.ts`). Used to compare renders with emulator captures without a browser.

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
- **Collision.** File 139+n (`rushcollision.ts`). A 16-byte header of counts, then 132-byte track sections (the
  track's path; none in arenas), 20-byte quadtree nodes, 24-byte polygons, 8-byte vertices, 32-byte alternates,
  index streams and quadtree leaf lists.
  - Polygon: u16 flags (low nibble: surface class, 5 = walls), u16 (low nibble: vertex count), a 3×3 Q14 basis,
    u16 index-stream offset.
  - Index stream: big-endian u16 vertex indices; a following byte ≥ 0xE0 adds (byte & 0x1F) consecutive indices.
  - Vertex: i16 x, y, z plus a u16 of 5-bit fractions (1/32 unit), in the render frame. The first vertex is the
    polygon's world position; the others lie in its plane and are placed with the transposed basis.
  - Alternates: other placements of scripted objects' polygons (doors, trapdoors, rotors), copied over them by
    0x800B2D20; 0x800B2CB4 switches a group off (flags 0x000F).

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
- **Collision.** A[36+n] (A[43+n] when the byte at 0x800EA13E is set). Same format as Rush 2049, except: a 0x20-byte
  header, 26-byte polygons (an extra u16 before the basis), no alternates, leaf lists before the index streams,
  run bytes ≥ 0xC0 (count & 0x3F), the basis applied untransposed, and axes (Z, X, −Y) of the render frame.

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
- **Collision.** Hidden layers draw each game's collision, coloured by surface type: Bomberman 64's 3-D attribute
  grid (100-unit cells in layers; solid, floor, slope and corner shapes, plus object, trigger and spawn-marker
  cells), Hero's planes (60-unit tiles in 960-unit cells, with kill, hazard, exit, door and pad attributes) and The
  Second Attack's polygon files (256-unit cells; floor bit and object-filter bits).

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
- **Collision (hidden layers).** BattleTanx has no collision mesh: each collidable object's model footprint is a 2D
  rotated rectangle, drawn as a prism coloured by class (static, destructible, low destructible, tank-only,
  passable, player-setup-dependent). Global Assault uses boxes: solid and see-through walls, invisible solids,
  5000-high boundary walls, the platform/ramp/mound boxes that give ground height, and destructibles, with kind-30
  zones (no-spawn, shell blocker, trigger, play area) in a separate "collision zones" layer. Both were checked against
  the games' live collision tables in RAM dumps.

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
- **Collision.** Hidden layers: "collision" holds the static collision triangles (Gex 64: the face records of the
  render-BSP leaves; Gex 3: the per-leaf collision records), floors green, walls orange, ceilings purple, other
  surface flags or types in their own colour and faces with an event record tinted red; "invisible objects" holds
  the objects the game never draws (Gex 64 invisible volumes, proximity triggers and hub menu hotspots, Gex 3
  sound-emitter markers). The world and placed objects have "world" and "objects" layers.
- **Music.** Software Creations' libmus at 22050 Hz, one tick per video frame.
  - Gex 64 uses an older player revision with per-level banks. Its list includes the four jingles and
    an unused Pre-History Channel song that no table references.
  - Gex 3 shares Global Assault's revision, without reverb.
  - Both games play music quietly (about −33 dBFS; renders match captured game audio within about
    1 dB and without drift). The viewer boosts them for playback (Gex 64 ×2.25, Gex 3 ×6).

### Yoshi's Story (Japan)

`YOSHISTORY.md` documents the formats in full; in short:
- **Files.** No file table: cast and world records are read through segmented pointers (castData at ROM
  0x528430, worldDatabase at 0xB16170), and image records may be CMPR/SMSR00 slide-LZ compressed.
- **Levels.** A world (one room) lists actors in world pixels; actors 0x8xxx are tile layers (16 × 16 CI8 units
  grouped in 256 × 256 blocks, with an RGBA5551 palette), the others objects. Worlds are grouped into the 24
  courses by page; boss rooms, the practice course and unused test worlds are listed too.
- **Side view.** The game's parallax is an exact perspective projection: layers are placed as planes at their
  depths (`floor(z) − 500` behind the main plane), scaled so their texels stay 1:1 and offset by each layer's
  anchor, and shown through the game's 40° camera 329.7 px in front of the main plane (`Level.sideView`). The
  viewer pans that camera; free fly shows the layers apart.
- **Objects.** Unit sprites show their first listed frame, Yoshi stands at the player start (cell 0, green),
  and objects drawn by code (exits, lifts, effects) are labelled markers. The collision map of the main layer
  is an optional overlay.
- **Music.** Nintendo EAD's "Nas" driver (sequence, channel and layer scripts, instrument banks and drum kits,
  VADPCM, envelopes, vibrato) rendered at 32 kHz; tempo and loop points follow the game.

### Star Fox 64

`STARFOX.md` documents the formats in full; in short:
- **Files.** A DMA table (found by content) lists 64 files, 51 of them MIO0-compressed. A level is a scene: up
  to 15 asset files loaded into RSP segments, whose pointers are segment-relative.
- **Levels.** Placement lists of 0x14-byte records place scenery, sprites, actors, items and event actors
  (whose scripts name the model). On-rails levels lie along −Z (`z = −zPos1 − 3000 + zPos2`); all-range levels
  and Versus stages are absolute. Alternative lists (boss arenas, warp zones, the Venom escapes, Versus stages,
  the unused level 4 and the Venom 1 beta layout) are listed too.
- **Drawing.** Object display lists carry no render state: each draw is a synthesised list of one of the game's
  88 render presets, the per-object recipe (culling, scale, prim colour) and the object list. Skeleton models
  show frame 0 of their animation. Lit presets shade normals with the environment record's light, baked in.
- **Grounds.** The game draws the ground attached to the camera; the viewer tiles it along the level (Corneria's
  grass, rock and water sections follow the event scripts), and Titania's terrain is simulated from its records.
- **Environment.** Fog, clear colour and the planet backdrop window come from the environment record and the
  game's start camera. Space levels get the game's starfield and backdrop sprite as a sky around the camera.
  The level light counts four times (the game fills four RSP light slots with it).
- **Music.** Nintendo EAD's sequence driver (the Mario 64 / Ocarina lineage, with its note pool, integer mixer
  and per-song reverb) rendered at 32 kHz at the game's own level; loops follow the sequences' jumps.

### Perfect Dark

`PERFECTDARK.md` documents the formats in full; in short:
- **Files.** Game code is paged from compressed 4 KiB pages; files and sections are "rarezip" streams (`11 73`, a 24-bit
  size, raw DEFLATE). A stage record names its BG, pads and setups.
- **Levels.** BG files hold rooms (block trees with display lists, 12-byte vertices, colour arrays), portals and
  sky rooms, drawn with Rare's own microcode (`gbi.ts`); textures come from a global store of 3,503. Missions,
  special assignments, Carrington Institute and the Combat Simulator arenas are listed.
- **Environment.** Fog and sky colour from the environment tables; clouds and water as sky planes; sky rooms drawn
  around the camera. The start camera stands on a spawn pad.
- **Objects.** Setup records place props, doors, glass, weapons, vehicles and characters (difficulty Agent), snapped
  to the floor or the prop below as the game does and checked against RAM; characters stand in the first frame of
  their stand animation with heads attached.
- **Layers.** One layer per room (grouped), rooms never visible from play hidden, and the collision tiles as a
  hidden overlay coloured by what each tile does; coplanar double-modelled surfaces are resolved so they don't
  z-fight.
- **Music.** 119 sequences for libultra's n_audio player with linear voice volume; every track loops on its own
  (`music/cseq.ts`, shared with GoldenEye).

### Zelda 64

`ZELDA64.md` documents the formats in full; in short:
- **Detection.** Ocarina of Time and Majora's Mask, retail and debug builds, are found by structure: the `zelda@`
  build string next to the file table, and the scene table's record size.
- **Levels.** Scenes (with their alternate layers or setups as sub-levels) and rooms, F3DEX2 display lists with
  animated materials at their first frame, textures read as whole images with palette memory and a second
  texture where the combiner blends two, skyboxes and prerendered JPEG backgrounds, light settings by time of day,
  collision and waterboxes as overlays, static actors from recipes and the rest as markers.
- **Music.** Zelda's revision of Nintendo EAD's sequence driver, sample-identical to the research renderer, which
  matches captured game audio.
- **The 1997 prototype.** The upper half of an F-Zero X development ROM (`F-ZERO X [CFZE].z64`, identified by its MD5)
  holds 52 scenes of a Spaceworld 97-era Ocarina of Time, stored raw without a file table, code, objects, skyboxes or
  audio. They use F3DEX display lists, no palette textures, 12-byte waterboxes and raw RGBA16 prerendered
  backgrounds; actor ids are shifted by one from 0x24. The level list follows `ZELDA64.md` §11.4, and each room's
  info names its retail counterpart and how much collision and texture data it shares with it.

### GoldenEye 007

`GOLDENEYE.md` documents the formats in full; in short:
- **Files.** The game code is uncompressed; a compressed data segment holds the tables. Files, rooms, textures and
  songs are "1172" streams: two tag bytes and raw DEFLATE.
- **Levels.** A BG file is a set of rooms with room-relative vertices and Fast3D display lists with two Rare commands
  (`B1` four triangles, `C0` texture number; `displaylist.ts` ucode `'f3d'`). Textures come from a global table of 2,698
  in two codec families. The viewer works in world units (BG units ÷ the stage scale, about 1 cm), draws rooms
  without back-face culling as the game effectively does, and alpha comes from the lists' environment alpha.
- **Environment.** Fog and clear colour come from per-stage records; the sky is a cloud plane at a world height (and
  Frigate's water plane) the game projects per pixel (`Level.skyPlanes`). Backdrop pieces the game shows only
  through portals are a hidden layer.
- **Objects.** Setup files place doors, props, glass, pickups and guards on pads; models are built at rest, guards in
  a sampled standing pose with heads, and placed as the game does (checked against RAM). The start camera stands on
  the first spawn pad over the clipping-file floor.
- **Layers.** One layer per room (grouped), backdrop rooms the game can show, and the clipping tiles as a hidden
  collision overlay coloured by slope.
- **Music.** 63 compressed-MIDI sequences for libultra's player, rendered by `libultra.ts` with GoldenEye's per-track
  loop rules.

### Off Road Challenge

`OFFROADCHALLENGE.md` documents the formats in full; in short:
- **Files.** Forty-one raw, uncompressed files are accessed through the regional ROM table. One bounded parser supports
  the USA and European releases and resolves their absolute RAM pointers against each file's load address.
- **Levels.** All nine tracks are shown, including unlockable Flagstaff, El Cajon and Guadalupe. The viewer walks every
  sector, reconstructs the custom float meshes and placements, and decodes packed-CI4 atlas windows with RGBA16 palettes.
- **Environment.** The tracks use their verified no-fog render state and 42.67° vertical field of view. The start view
  follows the first sectors. All twelve sky resources are available as selectable Blue, Stormy, Dusk and alternate-mode
  panoramas, rendered through the game's camera-dependent eight-panel yaw/pitch compositor.
- **Objects and collision.** Track-resident standard objects are placed with the course, while specialized records are
  markers. A hidden layer shows the category-3/4 object bounds used as collision candidates.
- **Music.** All 12 WESS music sequences are decoded on demand at 22,050 Hz: two one-shots and ten authored loops,
  including the six named radio songs and the statically unreferenced sequence 3.

### Pokémon Snap

`POKEMONSNAP.md` documents the formats in full; in short:
- **Files.** The game has no filesystem: fixed ROM ranges hold overlays and position-dependent segments. The viewer
  resolves each course's load list into one address space. Identified level assets are stored uncompressed; the VPK0
  streams used by menus and the boot intro are outside the course loader.
- **Levels.** The seven courses are Beach, Tunnel, Volcano, River, Cave, Valley and Rainbow Cloud. World and scenery
  blocks are translated by their course positions and rendered from F3DEX2 display lists; material lists that the
  game builds in RAM are reconstructed from its texture records.
- **Environment.** Course fog and clear colours, camera-attached sky domes and the verified starting camera are shown.
  Hidden marker layers trace the on-rails camera path and object paths.
- **Objects.** Course spawn lists place Pokémon and static props on the world. Pokémon use the first frame of their
  initial animation, including its hidden parts, and the most detailed model LOD.
- **Collision.** Hidden layers show the surface-coloured height map, Tunnel and Cave ceiling maps, and static-object
  boxes, cylinders and spheres.
- **Music.** All 37 compressed-MIDI sequences use Snap's modified libultra sequence player. The viewer applies each
  song's extra-volume controller and renders each soundtrack entry on its own with its authored loops.

## Known gaps

- Rush 2049: scripted objects are shown frozen at the start of their paths.
- Rush: not shown: checkpoint flags, weapon power-up icons, cars, and the collision files' track sections. The
  collision layer is coloured by surface class, but only walls (class 5) are identified.
- Rush: no fog, and only the most detailed LOD is used.
- Bomberman 64: props placed by stage code, and boss arenas built only from object models, are not
  shown. The Second Attack: only map geometry and battle soft blocks; story objects and characters
  are not shown. Textures bound at run time from texture sets stay untextured.
- Bomberman collision: some attribute values are not identified (Bomberman 64 cell flags 0x2000/0x4000/0x8000 and
  floor shapes 2, 9–11; about a dozen Hero attributes; most The Second Attack bits besides floor and object filter).
  Moving platforms, whose collision exists only at run time, are not shown.
- Bomberman: animated textures (UV scrolling water) are static; environment mapping is approximate;
  translucent effects that blend by fog alpha are not modelled.
- BattleTanx: tanks, pickups and destructible states other than the intact one are not shown; team
  colour palette animations show a fixed frame; only the most detailed LOD is used. BattleTanx music
  runs about 0.05% fast (the game's 16 ms audio poll rounding is not modelled). BattleTanx collision has no heights (prisms
  reach the model top) and shows every player-setup-gated object; Global Assault's collision leaves out kinds
  24/28/32/36 (registered in code but not seen in dumps; probably moving vehicles) and the fixed boxes of kinds 4 and
  8, and the meanings of the kind-30 zone flags are hypotheses.
- Gex: animated materials (flipbooks, scrolling water and lava) show their first frame; characters
  and enemies stand in their rest pose, and skinned Gex 3 objects are not shown. Objects that the
  level scripts spawn are not shown; invisible volumes and marker boxes (Gex 3 sound emitters) are
  hidden by class or by their all-black placeholder texture (shown in a hidden layer). Vertex-colour animation
  (flickering lights) shows the file's colours. The meanings of Gex 64 collision flag bits and Gex 3 surface types
  are not decoded (colours only tell them apart), nor the event records they point to (warps, triggers); Gex 64
  logic objects without geometry (collide_, qcoll___, gatesph_, camswch_, …) are not shown.
- Yoshi's Story: sprites show one frame; actors drawn by code or meshes (lifts, the Bowser
  room arena, bosses) are markers; menu worlds are not listed; music plays Yoshi's normal mood (the game's
  per-song channel mute masks), without the happy, sad and "super" variants, and reverb is not modelled.
- Star Fox 64: enemies and props drawn by code without a plain model (fish, birds, Titania rovers, Bolse
  cannons, Sector Y robots) are markers; moving event actors stand at their spawn point (the "scripted"
  toggle hides them); water reflections, Solar and Zoness waves and Bolse's dynamic ground are not shown; the
  ground is tiled statically, so its texture seams may not line up; space backdrops are placed for the start view
  (Area 6's planet at its starting size, Meteo's planet where it rises at the end).
- Perfect Dark: characters hold no weapons, stand at their pads in a stand-in random head, at the nearest LOD and
  unflipped; vehicles and lifts are at their pads, doors closed; monitor screens show a placeholder and CI's light beam
  is missing; toggled model parts show the first variant; multiplayer weapon slots use one captured weapon set and
  there are no simulants; Defection's star field, suns and lens flares and cloud
  scrolling are not drawn; some city backdrop rooms the game hides are drawn; environment-mapped surfaces use an
  approximation; music has no reverb.
- Zelda 64: skeletal actors (people, enemies, animated objects), torch flames and the sun and moon are markers or not
  shown; animated materials show their first frame; Majora's Mask's sky rotation is fixed; Hyrule Field's music
  plays its random parts in a fixed order; music has no reverb. The 1997 prototype has no objects, skyboxes or music
  in the ROM: actors are markers, keep-object textures are untextured, animated-material segments are unresolved, and
  some scene names are the sw97 project's guesses.
- GoldenEye: portals and visibility are ignored (all rooms are drawn), so a few distant Dam mountain tops show above
  the cliffs and rooms the game never shows together can overlap (Aztec rooms 18 and 44); translucent surfaces are
  sorted per room, not per triangle; animated textures, the water ripple and the
  sky's scroll are static; environment-mapped surfaces use plain UVs and objects get no room lighting; guards stand in
  one sampled pose at their pads; doors are closed, stacked objects sit on the floor, vehicles stay at their pads, and
  objects spawned by AI scripts or held by characters are not shown; multiplayer weapon slots show weapon set 11, not
  the set chosen in the menu; grenade records flagged 0x100000, which the game creates but never draws, are hidden;
  static-pose guards show small gaps at some joints; the Bunker monitors whose setup records have no pad are not shown;
  music has no reverb.
- Off Road Challenge: Random sky selection is exposed as its twelve deterministic choices rather than rerolled;
  specialized object models remain markers; collision is shown as object bounds rather than exact driveable surfaces;
  WESS reverb/effects and exact priority-based voice stealing are not modelled.
