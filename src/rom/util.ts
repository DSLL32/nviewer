import type { Instance, Mesh, Texture } from './types';

export const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

export function cstr(buf: Uint8Array, o: number, len: number): string {
  let s = '';
  for (let i = 0; i < len && buf[o + i]; i++) s += String.fromCharCode(buf[o + i]);
  return s;
}

// Placement matrices are 3x3 rotation/scale plus translation in row-vector
// convention (world = x*row0 + y*row1 + z*row2 + t); returns a column-major 4x4.
export function placementMatrix(m: number[]): Float32Array {
  return new Float32Array([
    m[0], m[1], m[2], 0,
    m[3], m[4], m[5], 0,
    m[6], m[7], m[8], 0,
    m[9], m[10], m[11], 1,
  ]);
}

// Keeps the level file's own meshes (the first `levelMeshCount`, indices unchanged)
// plus the extra meshes instances actually use, and only the textures those meshes
// reference. Remaps instance mesh indices in place.
export function pruneUnused(meshes: Mesh[], textures: Texture[], instances: Instance[], levelMeshCount: number) {
  const used = new Set(instances.map((i) => i.mesh));
  const keep = meshes.map((_, i) => i).filter((i) => i < levelMeshCount || used.has(i));
  const meshRemap = new Map(keep.map((old, i) => [old, i]));
  const textureRemap = new Map<number, number>();
  const keptTextures: Texture[] = [];
  const keptMeshes = keep.map((i): Mesh => ({
    ...meshes[i],
    batches: meshes[i].batches.map((b) => {
      if (b.texture < 0) return b;
      let t = textureRemap.get(b.texture);
      if (t === undefined) {
        t = keptTextures.push(textures[b.texture]) - 1;
        textureRemap.set(b.texture, t);
      }
      return { ...b, texture: t };
    }),
  }));
  for (const inst of instances) if (inst.mesh >= 0) inst.mesh = meshRemap.get(inst.mesh)!;
  return {
    meshes: keptMeshes,
    textures: keptTextures,
    unplaced: keep.slice(0, levelMeshCount).filter((i) => !used.has(i)),
  };
}

export function emptyBounds() {
  return {
    min: [Infinity, Infinity, Infinity] as [number, number, number],
    max: [-Infinity, -Infinity, -Infinity] as [number, number, number],
  };
}
