// Source-face geometry shared by tracks, scenery, and the camera-relative sky.
import type { Batch, Mesh } from '../types';
import type { Material } from './material';
import { s16, u32 } from './fs';

interface BatchParts { material: Material; positions: number[]; uvs: number[]; colors: number[]; sources: number[] }

/** Build one mesh from a GeometryMeta pointer in its containing inflated file. */
export function buildStuntMesh(data: Uint8Array, meta: number, materials: Material[], name: string,
                               origin: [number, number, number] = [0, 0, 0]): Mesh {
  if (meta <= 0 || meta + 0x20 > data.length) throw new Error(`Stunt Racer invalid GeometryMeta 0x${meta.toString(16)}`);
  const vertices = u32(data, meta), nv = u32(data, meta + 4);
  const faces = u32(data, meta + 8), nf = u32(data, meta + 0x0c);
  const texcoords = u32(data, meta + 0x10), nt = u32(data, meta + 0x14);
  const colors = u32(data, meta + 0x18), nc = u32(data, meta + 0x1c);
  const valid = (offset: number, count: number, stride: number) =>
    count <= 0x100000 && offset <= data.length && count * stride <= data.length - offset;
  if (!valid(vertices, nv, 6) || !valid(faces, nf, 0x20) || !valid(texcoords, nt, 4) || !valid(colors, nc, 4))
    throw new Error(`Stunt Racer invalid geometry extent at 0x${meta.toString(16)}`);
  const groups = new Map<number, BatchParts>();
  let radius = 0;
  for (let i = 0; i < nf; i++) {
    const at = faces + i * 0x20, mi = data[at + 4], material = materials[mi];
    if (!material) throw new Error(`Stunt Racer face at 0x${at.toString(16)} uses material ${mi}`);
    let group = groups.get(mi);
    if (!group) { group = { material, positions: [], uvs: [], colors: [], sources: [] }; groups.set(mi, group); }
    const indices = [0, 1, 2, ...(s16(data, at + 0x0e) === -1 ? [] : [0, 2, 3])];
    for (let c = 0; c < indices.length; c++) {
      const corner = indices[c];
      const vi = s16(data, at + 8 + corner * 2), ti = s16(data, at + 0x10 + corner * 2), ci = s16(data, at + 0x18 + corner * 2);
      if (vi < 0 || vi >= nv || ti < 0 || ti >= nt || ci < 0 || ci >= nc)
        throw new Error(`Stunt Racer invalid face corner at 0x${at.toString(16)}`);
      const x = s16(data, vertices + vi * 6) + origin[0];
      const y = s16(data, vertices + vi * 6 + 2) + origin[1];
      const z = s16(data, vertices + vi * 6 + 4) + origin[2];
      group.positions.push(-x, z, y);
      radius = Math.max(radius, Math.hypot(x, y, z));
      const s = s16(data, texcoords + ti * 4) / 32, t = s16(data, texcoords + ti * 4 + 2) / 32;
      group.uvs.push(...material.uv(s, t));
      const color = colors + ci * 4;
      group.colors.push(data[color], data[color + 1], data[color + 2], data[color + 3]);
      if (c % 3 === 0) group.sources.push(at);
    }
  }
  const batches: Batch[] = [];
  for (const group of groups.values()) {
    const mat = group.material;
    batches.push({
      texture: mat.texture, blend: mat.blend, depthTest: mat.depthTest,
      depthWrite: mat.depthWrite, cullBack: mat.cullBack,
      positions: new Float32Array(group.positions), uvs: new Float32Array(group.uvs),
      colors: new Uint8Array(group.colors), triSource: new Uint32Array(group.sources),
    });
  }
  return { name, radius, batches, info: { geometryOffset: meta, faces: nf, vertices: nv,
    triSource: 'source face offset in containing inflated file' } };
}
