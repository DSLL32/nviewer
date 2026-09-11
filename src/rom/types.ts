// Render-ready level data shared by all supported games.

export type LevelKind = 'race' | 'battle' | 'stunt' | 'obstacle' | 'adventure' | 'campaign' | 'hub' | 'bonus' | 'boss' | 'other';

export interface LevelInfo {
  index: number;
  name: string;
  kind: LevelKind;
  // Sub-heading within the kind's group (e.g. the world or planet), shared by consecutive levels.
  group?: string;
}

export type WrapMode = 'repeat' | 'mirror' | 'clamp';
export type BlendMode = 'opaque' | 'cutout' | 'blend';

export interface Texture {
  width: number;
  height: number;
  rgba: Uint8Array;
  wrapS: WrapMode;
  wrapT: WrapMode;
  format: string; // e.g. "CI4/RGBA16", for diagnostics
  source?: string; // where the texels come from (image/palette addresses), for bug reports
}

// Loader-specific identity for bug reports (record indices, names, file offsets as hex strings).
export type DebugInfo = Record<string, string | number>;

export interface Batch {
  texture: number; // index into Level.textures, -1 for untextured
  blend: BlendMode;
  depthTest: boolean;
  depthWrite: boolean;
  // The game draws this batch with back-face culling (front faces wind counter-clockwise,
  // the OpenGL convention).
  cullBack: boolean;
  // Coplanar decal over other geometry (the RDP's decal depth mode): draw after the
  // surfaces it lies on, with a depth offset towards the camera.
  decal?: boolean;
  // Non-indexed triangles: 3 positions / 2 uvs / 4 colors per vertex.
  positions: Float32Array;
  uvs: Float32Array;
  colors: Uint8Array;
  // Per triangle: the address of the display-list command that drew it (in the loader's buffer, see
  // Mesh.info), for bug reports.
  triSource?: Uint32Array;
}

export interface Mesh {
  name: string;
  radius: number;
  batches: Batch[];
  info?: DebugInfo;
}

export interface Instance {
  name: string;
  mesh: number; // index into Level.meshes, -1 when no object of that name exists
  matrix: Float32Array; // 4x4 column-major, object -> world
  animated?: boolean; // scripted object, shown at the start of its motion path
  noFog?: boolean; // the game draws this instance without fog, even when the level has fog
  info?: DebugInfo;
}

// N64 RSP fog as the game sets it (gSPFogFactor / G_SETFOGCOLOR). Per vertex the RSP
// computes fog = clamp((zndc * multiplier + offset) / 255, 0, 1), where zndc is the
// perspective depth in [-1, 1] of the game's projection with the given near/far planes:
// zndc = (far + near) / (far - near) - 2 * far * near / ((far - near) * d) for view depth d.
// The fragment colour is mixed towards `color` by fog.
export interface Fog {
  color: [number, number, number]; // 0..255
  multiplier: number;
  offset: number;
  near: number; // world units
  far: number; // world units
}

// A sky mesh in Level.meshes, drawn around the camera (camera translation ignored),
// before the level, without depth or fog. Positions are relative to the camera.
export interface Sky {
  name: string;
  mesh: number;
}

// A 2D picture the game draws across the whole screen before the level (no depth, no fog).
// The texture window [u0, u1] x [v0, v1] (0..1 across the texture) spans the screen
// left to right and top to bottom.
export interface Backdrop {
  texture: number; // index into Level.textures
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  tint?: [number, number, number]; // multiplies the texture, 0..255
}

// A camera the game itself uses for the level, as a starting view.
export interface CameraView {
  eye: [number, number, number];
  target: [number, number, number];
  fovY?: number; // degrees
}

// A named group of instances the UI can show or hide (tile layers, objects, collision, markers).
export interface LevelLayer {
  name: string; // e.g. "far (wrd_1_1_1_enkei)", "main", "objects"
  kind: 'background' | 'main' | 'foreground' | 'objects' | 'collision' | 'markers';
  instances: number[]; // indices into Level.instances
  depth?: number; // the game's depth value, for display
  parallax?: number; // scroll factor relative to the main plane, for display
  visibleByDefault?: boolean; // default true
}

// Camera for side-scrolling games: a fixed-lens camera looking down -Z at the plane Z = 0, without
// rotation. The lens must not be re-framed: the game's parallax depends on it.
export interface SideView {
  fovY: number; // degrees
  distance: number; // eye distance from the Z = 0 plane
  start: [number, number]; // eye X, Y at level start
  bounds: { min: [number, number]; max: [number, number] }; // pan limits for the eye
}

// A labelled point, for objects without decoded art.
export interface Marker {
  label: string; // e.g. "4199 atamaheiho"
  position: [number, number, number];
  layer?: number; // index into Level.layers (its visibility toggle applies)
  info?: DebugInfo;
}

export interface Level {
  info: LevelInfo;
  layers?: LevelLayer[];
  sideView?: SideView;
  markers?: Marker[];
  pixelArt?: boolean; // default to nearest texture filtering
  fog?: Fog; // absent when the game shows no fog
  // Skies the game chooses between (at random, for Rush 1), if it builds them itself.
  skies?: Sky[];
  // Colour the game clears the screen to (0..255), when it clears it.
  clearColor?: [number, number, number];
  backdrop?: Backdrop;
  camera?: CameraView;
  id: string;
  textures: Texture[];
  meshes: Mesh[];
  instances: Instance[];
  // Meshes of the level file that no instance references (sky, scripted objects).
  unplaced: number[];
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

// A piece of the game's soundtrack.
export interface MusicTrack {
  index: number;
  name: string; // as the game names it (e.g. in an audio/jukebox menu), else "Track N"
}

// Decoded PCM, -1..1 per channel.
export interface DecodedMusic {
  sampleRate: number;
  channels: Float32Array[];
  // Loop region in samples, if the game loops the piece.
  loopStart?: number;
  loopEnd?: number;
}

// A loaded ROM of one supported game.
export interface Game {
  id: 'rush2049' | 'rush1' | 'bm64' | 'bm64sa' | 'bmhero' | 'battletanx' | 'battletanxga' | 'gex64' | 'gex3' | 'yoshistory';
  title: string;
  levels: LevelInfo[];
  loadLevel(index: number): Level;
  music?: MusicTrack[];
  decodeMusic?(index: number): DecodedMusic;
}
