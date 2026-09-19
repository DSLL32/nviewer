import { runDisplayList } from '../displaylist';
import type { Batch, Level, Mesh, Texture } from '../types';

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

interface Chunk {
  tag: string;
  start: number;
  data: number;
  end: number;
  type?: string;
}

function text(bytes: Uint8Array, offset: number, size: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + size));
}

function chunks(bytes: Uint8Array, start: number, end: number): Chunk[] {
  const result: Chunk[] = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = start; at + 8 <= end;) {
    const tag = text(bytes, at, 4);
    const size = dv.getUint32(at + 4);
    const chunkEnd = at + 8 + size;
    if (chunkEnd > end) throw new Error(`Vigilante 8: 2nd Offense ${tag} chunk outside FORM`);
    result.push({
      tag, start: at, data: at + 8, end: chunkEnd,
      ...(tag === 'FORM' ? { type: text(bytes, at + 8, 4) } : {}),
    });
    at = chunkEnd + (size & 1);
  }
  return result;
}

function sectionRecord(dv: DataView, section: number, index: number, count: number): [number, number] {
  if (index < 0 || index >= count) throw new Error(`Vigilante 8: 2nd Offense section index ${index}/${count}`);
  const start = section + dv.getUint32(section + index * 4);
  const end = section + dv.getUint32(section + (index + 1) * 4);
  if (start < section || end < start || end > dv.byteLength)
    throw new Error('Invalid Vigilante 8: 2nd Offense indexed section');
  return [start, end];
}

function meshRadius(batches: Batch[]): number {
  let radius2 = 0;
  for (const batch of batches) for (let i = 0; i < batch.positions.length; i += 3) {
    const x = batch.positions[i], y = batch.positions[i + 1], z = batch.positions[i + 2];
    radius2 = Math.max(radius2, x * x + y * y + z * z);
  }
  return Math.sqrt(radius2);
}

function appendBank(bytes: Uint8Array, bin: Chunk, level: Level, bankIndex: number): number[] {
  const base = bin.data;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const modelCount = dv.getUint32(base);
  // Use the stored offsets. OILFIELD's first bank does not obey the usual
  // computed header-plus-node-array relation.
  const modelSection = base + dv.getUint32(base + 4);
  const textureCount = dv.getUint32(base + 16);
  const textureSection = base + dv.getUint32(base + 20);
  const nodeCount = dv.getUint32(base + 24);
  const textureBase = textureCount ? textureSection + dv.getUint32(textureSection) : 0;
  const textureKeys = new Map<string, number>();
  const models: number[] = [];

  for (let i = 0; i < modelCount; i++) {
    const [record, recordEnd] = sectionRecord(dv, modelSection, i, modelCount);
    const vertexCount = dv.getUint32(record);
    const vertexOffset = dv.getUint32(record + 4);
    const displayListOffset = dv.getUint32(record + 8);
    let batches: Batch[] = [];
    if (vertexCount && displayListOffset) {
      const vertexBase = record + vertexOffset;
      const resolve = (address: number): number => {
        const segment = address >>> 24, offset = address & 0xffffff;
        if (segment === 1) return vertexBase + offset;
        if (segment === 2 && textureBase) return textureBase + offset;
        return address < bytes.length ? address : -1;
      };
      batches = runDisplayList({
        buf: bytes, ucode: 'f3dex2', resolve, resolveImage: resolve,
        textures: level.textures, textureKeys, keyPrefix: `v8-2/${bankIndex}/`,
        vertexScale: 1, mirrorX: true, cullBackByDefault: true,
      }, record + displayListOffset);
    }
    const mesh: Mesh = {
      name: `Bank ${bankIndex + 1} model ${i}`,
      radius: meshRadius(batches), batches,
      info: { bank: bankIndex, model: i, record: `0x${record.toString(16)}`, bytes: recordEnd - record },
    };
    models.push(level.meshes.push(mesh) - 1);
  }

  const nodes = Array.from({ length: nodeCount }, (_, index) => {
    const at = base + 0x20 + index * 28;
    return {
      position: [dv.getInt32(at + 4) / 256, dv.getInt32(at + 8) / 256, dv.getInt32(at + 12) / 256] as [number, number, number],
      sibling: dv.getUint16(at + 20),
      child: dv.getUint16(at + 22),
      model: dv.getUint16(at + 24) & 0xff,
      at,
    };
  });
  const referred = new Set<number>();
  for (const node of nodes) {
    if (node.sibling !== 0xffff) referred.add(node.sibling);
    if (node.child !== 0xffff) referred.add(node.child);
  }
  const roots = nodes.map((_, index) => index).filter((index) => !referred.has(index));
  const placed: number[] = [], visited = new Set<number>();
  const stack = roots.reverse().map((index) => ({ index, parent: [0, 0, 0] as [number, number, number] }));
  while (stack.length) {
    const { index, parent } = stack.pop()!;
    if (index >= nodes.length || visited.has(index)) continue;
    visited.add(index);
    const node = nodes[index];
    const world: [number, number, number] = [
      parent[0] + node.position[0], parent[1] + node.position[1], parent[2] + node.position[2],
    ];
    if (node.sibling !== 0xffff) stack.push({ index: node.sibling, parent });
    if (node.child !== 0xffff) stack.push({ index: node.child, parent: world });
    if (node.model >= models.length || !level.meshes[models[node.model]].batches.length) continue;
    const matrix = IDENTITY.slice();
    matrix[12] = -world[0];
    matrix[13] = world[1];
    matrix[14] = world[2];
    placed.push(level.instances.push({
      name: `Bank ${bankIndex + 1} node ${index}`, mesh: models[node.model], matrix,
      info: { bank: bankIndex, node: index, model: node.model, record: `0x${node.at.toString(16)}` },
    }) - 1);
  }
  return placed;
}

function rgba5551(value: number): [number, number, number, number] {
  const five = (v: number) => (v << 3) | (v >>> 2);
  return [five(value >>> 11), five((value >>> 6) & 31), five((value >>> 1) & 31), value & 1 ? 255 : 0];
}

function decodeIndexedBitmap(bytes: Uint8Array, offset: number, source: string): Texture {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const format = dv.getUint16(offset), paletteCount = dv.getUint16(offset + 2);
  const width = dv.getUint16(offset + 4), height = dv.getUint16(offset + 6);
  if (format !== 0x0201) throw new Error(`Unsupported Vigilante 8: 2nd Offense bitmap format 0x${format.toString(16)}`);
  const pixels = offset + ((8 + paletteCount * 2 + 7) & ~7);
  const rowBytes = (width + 7) & ~7;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = bytes[pixels + y * rowBytes + x];
    rgba.set(rgba5551(dv.getUint16(offset + 8 + index * 2)), (y * width + x) * 4);
  }
  return { width, height, rgba, wrapS: 'repeat', wrapT: 'clamp', format: 'CI8/RGBA16', source };
}

function appendSky(bytes: Uint8Array, skyChunk: Chunk, level: Level): void {
  // XBGM has one four-byte field before the common eight-byte texture header.
  const texture = level.textures.push(
    decodeIndexedBitmap(bytes, skyChunk.data + 4, `XBGM 0x${skyChunk.start.toString(16)}`),
  ) - 1;
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [];
  const segments = 32, radius = 1000, low = -420, high = 420;
  const vertex = (i: number, y: number, v: number) => {
    const angle = i / segments * Math.PI * 2;
    positions.push(Math.sin(angle) * radius, y, -Math.cos(angle) * radius);
    uvs.push(i / segments, v);
    colors.push(255, 255, 255, 255);
  };
  for (let i = 0; i < segments; i++) {
    vertex(i, low, 1); vertex(i + 1, low, 1); vertex(i + 1, high, 0);
    vertex(i, low, 1); vertex(i + 1, high, 0); vertex(i, high, 0);
  }
  const mesh = level.meshes.push({
    name: 'Panoramic sky', radius: Math.hypot(radius, high),
    batches: [{
      texture, blend: 'opaque', depthTest: false, depthWrite: false, cullBack: false,
      positions: new Float32Array(positions), uvs: new Float32Array(uvs), colors: new Uint8Array(colors),
    }],
    info: { chunk: 'XBGM', offset: `0x${skyChunk.start.toString(16)}` },
  }) - 1;
  level.unplaced.push(mesh);
  level.skies = [{ name: 'Panoramic sky', mesh }];
}

function updateBounds(level: Level, instances: number[]): void {
  for (const index of instances) {
    const instance = level.instances[index], matrix = instance.matrix;
    for (const batch of level.meshes[instance.mesh].batches) for (let i = 0; i < batch.positions.length; i += 3) {
      const x = batch.positions[i] + matrix[12];
      const y = batch.positions[i + 1] + matrix[13];
      const z = batch.positions[i + 2] + matrix[14];
      level.bounds.min[0] = Math.min(level.bounds.min[0], x);
      level.bounds.max[0] = Math.max(level.bounds.max[0], x);
      level.bounds.min[1] = Math.min(level.bounds.min[1], y);
      level.bounds.max[1] = Math.max(level.bounds.max[1], y);
      level.bounds.min[2] = Math.min(level.bounds.min[2], z);
      level.bounds.max[2] = Math.max(level.bounds.max[2], z);
    }
  }
}

export function decodeVigilante8SecondOffenseLevel(bytes: Uint8Array, level: Level): void {
  if (text(bytes, 0, 4) !== 'FORM' || text(bytes, 8, 4) !== 'TERR')
    throw new Error('Invalid Vigilante 8: 2nd Offense TERR FORM');
  const top = chunks(bytes, 12, bytes.length);
  const banks = top.filter((chunk) => chunk.tag === 'FORM' && chunk.type === 'XOBF');
  const placed: number[] = [];
  for (let i = 0; i < banks.length; i++) {
    const bin = chunks(bytes, banks[i].data + 4, banks[i].end).find((chunk) => chunk.tag === 'BIN ');
    if (!bin) throw new Error('Vigilante 8: 2nd Offense XOBF has no BIN chunk');
    placed.push(...appendBank(bytes, bin, level, i));
  }
  level.layers!.push({ name: 'scenery', kind: 'main', instances: placed });
  updateBounds(level, placed);
  const sky = top.find((chunk) => chunk.tag === 'XBGM');
  if (sky) appendSky(bytes, sky, level);
}
