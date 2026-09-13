import type { Batch, Mesh } from '../types';

const hex = (n: number) => `0x${n.toString(16)}`;

export interface CollisionHeader {
  header: number;
  vertexBank: number;
  cells: (number | null)[];
}

export function airBoarderCollision(data: Uint8Array, h: CollisionHeader, name: string): Mesh {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const records = new Map<string, { at: number; bytes: Uint8Array }>();
  for (const relative of h.cells) {
    if (relative === null) continue;
    const at = h.header + relative;
    if (at < 0 || at + 4 > data.length) throw new Error(`${name}: collision cell ${hex(at)} is out of bounds`);
    const count = dv.getUint32(at);
    if (count > 100000 || at + 4 + count * 20 > data.length) throw new Error(`${name}: invalid collision count ${count} at ${hex(at)}`);
    for (let i = 0; i < count; i++) {
      const source = at + 4 + i * 20, bytes = data.slice(source, source + 20);
      let key = '';
      for (const b of bytes) key += b.toString(16).padStart(2, '0');
      if (!records.has(key)) records.set(key, { at: source, bytes });
    }
  }
  const positions: number[] = [], colors: number[] = [], sources: number[] = [];
  for (const { at, bytes } of records.values()) {
    const r = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const indices = [0, 2, 4, 6].map((o) => r.getUint16(o));
    const flags = r.getUint32(16), shade = 120 + ((flags >>> 1) & 0x3f);
    for (const corner of [0, 1, 2, 0, 2, 3]) {
      const v = h.vertexBank + indices[corner] * 6;
      if (v < 0 || v + 6 > data.length) throw new Error(`${name}: collision vertex ${indices[corner]} is out of bounds`);
      positions.push(dv.getInt16(v), dv.getInt16(v + 2), dv.getInt16(v + 4));
      colors.push(40, Math.min(255, shade), 255, 115);
    }
    sources.push(at, at);
  }
  const batch: Batch = {
    texture: -1, blend: 'blend', depthTest: true, depthWrite: false, cullBack: false,
    positions: new Float32Array(positions), uvs: new Float32Array(positions.length / 3 * 2),
    colors: new Uint8Array(colors), triSource: new Uint32Array(sources),
  };
  let radius = 0;
  for (let i = 0; i < positions.length; i += 3) radius = Math.max(radius, Math.hypot(positions[i], positions[i + 1], positions[i + 2]));
  return { name, radius, batches: [batch], info: { header: hex(h.header), vertexBank: hex(h.vertexBank), faces: records.size, triSource: 'offset in decoded course archive' } };
}
