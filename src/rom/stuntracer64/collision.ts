import type { Batch, Level, Mesh } from '../types';
import type { StuntMap } from './fs';

const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const hex = (n: number) => `0x${n.toString(16)}`;

function extent(data: Uint8Array, offset: number, count: number, stride: number, label: string): void {
  if (!Number.isInteger(offset) || !Number.isInteger(count) || count < 0 ||
      offset > data.length || count > Math.floor((data.length - offset) / stride)) {
    throw new Error(`Stunt Racer 64: invalid ${label} at ${hex(offset)} (${count} records)`);
  }
}

/** Collision pointers and the table's metadata offset are relative to each decoded secondary file. */
export function collisionMesh(file: Uint8Array, meta: number, section: number): Mesh {
  extent(file, meta, 1, 0x20, 'collision metadata');
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const faceAt = dv.getUint32(meta), faceCount = dv.getUint32(meta + 4);
  const vertexAt = dv.getUint32(meta + 8), vertexCount = dv.getUint32(meta + 12);
  const linksAt = dv.getUint32(meta + 16), linkCount = dv.getUint32(meta + 20);
  extent(file, faceAt, faceCount, 10, 'collision faces');
  extent(file, vertexAt, vertexCount, 20, 'collision vertices');
  extent(file, linksAt, linkCount, 12, 'collision adjacency');
  const positions = new Float32Array(faceCount * 9);
  const colors = new Uint8Array(faceCount * 12);
  const triSource = new Uint32Array(faceCount);
  let radius = 0;
  for (let face = 0; face < faceCount; face++) {
    const at = faceAt + face * 10;
    for (let corner = 0; corner < 3; corner++) {
      const index = dv.getInt16(at + corner * 2);
      if (index < 0 || index >= vertexCount) throw new Error(`Stunt Racer 64: collision section ${section}, face ${face}, vertex ${index}`);
      const v = vertexAt + index * 20;
      const x = -dv.getFloat32(v) * 32, y = dv.getFloat32(v + 8) * 32, z = dv.getFloat32(v + 4) * 32;
      if (![x, y, z].every(Number.isFinite)) throw new Error(`Stunt Racer 64: non-finite collision vertex ${index}`);
      positions.set([x, y, z], face * 9 + corner * 3);
      colors.set([40, 210, 240, 105], face * 12 + corner * 4);
      radius = Math.max(radius, Math.hypot(x, y, z));
    }
    triSource[face] = at;
  }
  const batch: Batch = {
    texture: -1, blend: 'blend', depthTest: true, depthWrite: false, cullBack: false,
    positions, uvs: new Float32Array(faceCount * 6), colors, triSource,
  };
  return {
    name: `Collision section ${section}`, radius, batches: [batch],
    info: { section, metadata: hex(meta), faces: faceCount, vertices: vertexCount, links: linkCount,
      triSource: 'offset in decoded collision secondary file' },
  };
}

export function appendCollision(map: StuntMap, level: Level): void {
  const instances: number[] = [];
  for (let i = 0; i < map.count('collision'); i++) {
    const { metadataOffset } = map.entry('collision', i);
    const mesh = level.meshes.push(collisionMesh(map.load('collision', i), metadataOffset, i)) - 1;
    instances.push(level.instances.push({ name: `Collision section ${i}`, mesh, matrix: identity(),
      info: { section: i, metadata: hex(metadataOffset) } }) - 1);
  }
  (level.layers ??= []).push({ name: 'collision', kind: 'collision', visibleByDefault: false, instances });
}
