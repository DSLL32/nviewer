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

function nodeMatrix(position: [number, number, number], angles: [number, number, number]): typeof IDENTITY {
  const radians = Math.PI * 2 / 0x1000;
  const sa = Math.sin(angles[0] * radians), ca = Math.cos(angles[0] * radians);
  const sb = Math.sin(angles[1] * radians), cb = Math.cos(angles[1] * radians);
  const sc = Math.sin(angles[2] * radians), cc = Math.cos(angles[2] * radians);
  // Exact matrix built by the game's 0x8013B930 XOBF-node routine. The X
  // reflection on both sides converts it to the viewer's handedness.
  const r00 = sc * sa * sb + cc * cb, r01 = cc * sa * sb - sc * cb, r02 = ca * sb;
  const r10 = sc * ca, r11 = cc * ca, r12 = -sa;
  const r20 = sc * sa * cb - cc * sb, r21 = cc * sa * cb + sc * sb, r22 = ca * cb;
  return new Float32Array([
    r00, -r10, -r20, 0,
    -r01, r11, r21, 0,
    -r02, r12, r22, 0,
    -position[0], position[1], position[2], 1,
  ]);
}

function multiplyMatrix(a: Float32Array, b: Float32Array): typeof IDENTITY {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    let value = 0;
    for (let i = 0; i < 4; i++) value += a[i * 4 + row] * b[column * 4 + i];
    out[column * 4 + row] = value;
  }
  return out;
}

function appendBank(bytes: Uint8Array, bin: Chunk, level: Level, bankIndex: number): number[] {
  const base = bin.data;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const modelCount = dv.getUint32(base);
  // Most banks pad four bytes after the node array; OILFIELD's first bank
  // does not, so the stored section offset is authoritative.
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
        // The arena renderer enters XOBF lists with lighting enabled. Lists
        // then toggle it with G_GEOMETRYMODE; without a lighting context the
        // signed normal bytes are mistaken for authored RGB vertex colours.
        geometryMode: 0x20401,
        lighting: { lights: [], ambient: [255, 255, 255] },
        combiner: true, decals: true,
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
    const at = base + 0x1c + index * 28;
    const modelWord = dv.getUint16(at);
    return {
      model: modelWord & 0x7ff,
      disabled: (modelWord & 0x8000) !== 0,
      position: [dv.getInt32(at + 4) / 0x10000, dv.getInt32(at + 8) / 0x10000,
        dv.getInt32(at + 12) / 0x10000] as [number, number, number],
      angles: [dv.getUint16(at + 16) & 0xfff, dv.getUint16(at + 18) & 0xfff,
        dv.getUint16(at + 20) & 0xfff] as [number, number, number],
      sibling: dv.getUint16(at + 24),
      child: dv.getUint16(at + 26),
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
  const stack = roots.reverse().map((index) => ({ index, parent: IDENTITY }));
  while (stack.length) {
    const { index, parent } = stack.pop()!;
    if (index >= nodes.length || visited.has(index)) continue;
    visited.add(index);
    const node = nodes[index];
    if (node.sibling !== 0xffff) stack.push({ index: node.sibling, parent });
    // The runtime constructor reads the first word as signed. Negative nodes
    // are disabled alternatives: their sibling chain remains live, but the
    // node and its child subtree are not instantiated.
    if (node.disabled) continue;
    const world = multiplyMatrix(parent, nodeMatrix(node.position, node.angles));
    if (node.child !== 0xffff) stack.push({ index: node.child, parent: world });
    if (node.model >= models.length || !level.meshes[models[node.model]].batches.length) continue;
    placed.push(level.instances.push({
      name: `Bank ${bankIndex + 1} node ${index}`, mesh: models[node.model], matrix: world,
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

function appendCollision(bytes: Uint8Array, top: Chunk[], level: Level): void {
  const zmap = top.find((chunk) => chunk.tag === 'ZMAP');
  const zones = top.filter((chunk) => chunk.tag === 'ZONE');
  if (!zmap || zmap.end - zmap.data !== 0x800 || !zones.length) return;

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const heights = new Map<number, number>();
  const key = (x: number, z: number) => x * 2048 + z;
  for (let tileZ = 0; tileZ < 32; tileZ++) for (let tileX = 0; tileX < 32; tileX++) {
    const zoneId = dv.getUint16(zmap.data + (tileZ * 32 + tileX) * 2);
    if (!zoneId) continue;
    const zone = zones[zoneId - 1];
    if (!zone || zone.end - zone.data !== 0x4000)
      throw new Error(`Invalid Vigilante 8: 2nd Offense ZMAP zone ${zoneId}`);
    for (let localX = 0; localX < 64; localX++) for (let localZ = 0; localZ < 64; localZ++) {
      const packed = dv.getUint32(zone.data + (localX * 64 + localZ) * 4);
      const height = (((packed >>> 16) - 0x200) & 0x7ff) / 32;
      heights.set(key(tileX * 64 + localX, tileZ * 64 + localZ), height);
    }
  }

  const positions: number[] = [], uvs: number[] = [], colors: number[] = [];
  const vertex = (x: number, z: number, y: number) => {
    // Display-list vertices are reflected on X to enter the viewer's handedness.
    positions.push(-x, y, z);
    uvs.push(0, 0);
    colors.push(64, 224, 255, 128);
  };
  for (const [packed, h00] of heights) {
    const x = Math.floor(packed / 2048), z = packed % 2048;
    const h10 = heights.get(key(x + 1, z));
    const h01 = heights.get(key(x, z + 1));
    const h11 = heights.get(key(x + 1, z + 1));
    if (h10 === undefined || h01 === undefined || h11 === undefined) continue;
    // The game's height query divides the cell on the xFraction + zFraction = 1
    // diagonal: (00,10,01) and (11,01,10).
    vertex(x, z, h00); vertex(x + 1, z, h10); vertex(x, z + 1, h01);
    vertex(x + 1, z + 1, h11); vertex(x, z + 1, h01); vertex(x + 1, z, h10);
  }
  if (!positions.length) return;
  const batches: Batch[] = [{
    texture: -1, blend: 'blend', depthTest: true, depthWrite: false, cullBack: false, decal: true,
    positions: new Float32Array(positions), uvs: new Float32Array(uvs), colors: new Uint8Array(colors),
  }];
  const mesh = level.meshes.push({
    name: 'ZONE terrain collision', radius: meshRadius(batches), batches,
    info: { source: 'ZMAP/ZONE', zones: zones.length, triangles: positions.length / 9 },
  }) - 1;
  const instance = level.instances.push({ name: 'ZONE terrain collision', mesh, matrix: IDENTITY.slice() }) - 1;
  level.layers!.push({
    name: 'collision', kind: 'collision', instances: [instance], visibleByDefault: false,
  });
}

function updateBounds(level: Level, instances: number[]): void {
  for (const index of instances) {
    const instance = level.instances[index], matrix = instance.matrix;
    for (const batch of level.meshes[instance.mesh].batches) for (let i = 0; i < batch.positions.length; i += 3) {
      const px = batch.positions[i], py = batch.positions[i + 1], pz = batch.positions[i + 2];
      const x = matrix[0] * px + matrix[4] * py + matrix[8] * pz + matrix[12];
      const y = matrix[1] * px + matrix[5] * py + matrix[9] * pz + matrix[13];
      const z = matrix[2] * px + matrix[6] * py + matrix[10] * pz + matrix[14];
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
  appendCollision(bytes, top, level);
  const sky = top.find((chunk) => chunk.tag === 'XBGM');
  if (sky) appendSky(bytes, sky, level);
}
