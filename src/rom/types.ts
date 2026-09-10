// Render-ready level data shared by all supported games.

export type LevelKind = 'race' | 'battle' | 'stunt' | 'obstacle';

export interface LevelInfo {
  index: number;
  name: string;
  kind: LevelKind;
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
}

export interface Batch {
  texture: number; // index into Level.textures, -1 for untextured
  blend: BlendMode;
  depthTest: boolean;
  depthWrite: boolean;
  // Non-indexed triangles: 3 positions / 2 uvs / 4 colors per vertex.
  positions: Float32Array;
  uvs: Float32Array;
  colors: Uint8Array;
}

export interface Mesh {
  name: string;
  radius: number;
  batches: Batch[];
}

export interface Instance {
  name: string;
  mesh: number; // index into Level.meshes, -1 when no object of that name exists
  matrix: Float32Array; // 4x4 column-major, object -> world
  animated?: boolean; // scripted object, shown at the start of its motion path
}

export interface Level {
  info: LevelInfo;
  id: string;
  textures: Texture[];
  meshes: Mesh[];
  instances: Instance[];
  // Meshes of the level file that no instance references (sky, scripted objects).
  unplaced: number[];
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

// A loaded ROM of one supported game.
export interface Game {
  id: 'rush2049' | 'rush1';
  title: string;
  levels: LevelInfo[];
  loadLevel(index: number): Level;
}
