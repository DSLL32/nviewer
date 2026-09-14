import type { Batch, Mesh } from '../types';

const dvOf = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

export interface BugsLifeCollisionResult {
  mesh: Mesh;
  groups: number;
  finiteGroups: number;
  infiniteGroups: number;
  triangles: number;
}

export function parseFiniteCollision(data: Uint8Array, name: string): BugsLifeCollisionResult {
  const dv = dvOf(data);
  if (data.length < 8) throw new Error(`${name}: terrain.all is truncated`);
  const metadata = dv.getUint32(0) * 2;
  if (metadata < 4 || metadata + 4 > data.length) throw new Error(`${name}: invalid .all metadata offset`);
  const groups = dv.getUint32(metadata);
  if (groups > 0x10000 || metadata + 4 + groups * 0x4c > data.length) throw new Error(`${name}: .all metadata exceeds file`);
  let cursor = 4, lastData = -1, lastSize = 0, finiteGroups = 0, infiniteGroups = 0, triangleCount = 0;
  const positions: number[] = [], colors: number[] = [], sources: number[] = [];
  for (let group = 0; group < groups; group++) {
    const record = metadata + 4 + group * 0x4c, size = dv.getUint32(record) * 2;
    const x = dv.getInt32(record + 4), y = dv.getInt32(record + 8), z = dv.getInt32(record + 12), kind = dv.getUint32(record + 0x10);
    if (cursor + size > metadata) throw new Error(`${name}: group ${group} overlaps .all metadata`);
    const source = size ? cursor : lastData, sourceSize = size || lastSize;
    if (kind === 0x101) infiniteGroups++;
    if ((kind === 6 || kind === 8) && source >= 0) {
      finiteGroups++;
      const limit = source + sourceSize;
      let p = source;
      while (p + 2 <= limit && dv.getUint16(p) === 1) {
        if (p + 12 > limit) throw new Error(`${name}: truncated collision batch in group ${group}`);
        const count = dv.getUint16(p + 2);
        p += 12;
        if (p + count * 32 > limit) throw new Error(`${name}: collision triangles exceed group ${group}`);
        for (let tri = 0; tri < count; tri++, p += 32) {
          const ox = x + dv.getInt16(p + 6), oy = y + dv.getInt16(p + 8), oz = z + dv.getInt16(p + 10);
          const bx = ox + dv.getInt16(p + 12), by = oy + dv.getInt16(p + 14), bz = oz + dv.getInt16(p + 16);
          const cx = ox + dv.getInt16(p + 18), cy = oy + dv.getInt16(p + 20), cz = oz + dv.getInt16(p + 22);
          positions.push(ox, oy, oz, cx, cy, cz, bx, by, bz);
          for (let i = 0; i < 3; i++) colors.push(kind === 8 ? 255 : 32, kind === 8 ? 160 : 210, kind === 8 ? 32 : 255, 96);
          sources.push(p); triangleCount++;
        }
      }
      if (p + 2 > limit || dv.getUint16(p) === 1) throw new Error(`${name}: unterminated finite collision group ${group}`);
    }
    if (size) { lastData = cursor; lastSize = size; cursor += size; }
  }
  if (cursor !== metadata) throw new Error(`${name}: group data ends at 0x${cursor.toString(16)}, metadata begins at 0x${metadata.toString(16)}`);
  const batch: Batch = {
    texture: -1, blend: 'blend', depthTest: true, depthWrite: false, cullBack: false,
    positions: new Float32Array(positions), uvs: new Float32Array(triangleCount * 6), colors: new Uint8Array(colors),
    triSource: new Uint32Array(sources),
  };
  let radius = 0;
  for (let p = 0; p < positions.length; p += 3) radius = Math.max(radius, Math.hypot(positions[p], positions[p + 1], positions[p + 2]));
  return {
    mesh: { name, radius, batches: [batch], info: {
      file: 'terrain.all', groups, finiteGroups, infiniteGroups, triangles: triangleCount,
      limitation: 'finite collision IDs 6/8 only; infinite-wall ID 0x101 is not decoded',
      triSource: 'offset in decoded terrain.all',
    } },
    groups, finiteGroups, infiniteGroups, triangles: triangleCount,
  };
}
