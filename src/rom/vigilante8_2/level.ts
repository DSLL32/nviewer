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

function mirrorBatchesY(batches: Batch[]): void {
  const swap = (array: Float32Array | Uint8Array, width: number, a: number, b: number) => {
    for (let component = 0; component < width; component++) {
      const ai = a * width + component, bi = b * width + component, value = array[ai];
      array[ai] = array[bi]; array[bi] = value;
    }
  };
  for (const batch of batches) {
    for (let vertex = 0; vertex < batch.positions.length / 3; vertex++)
      batch.positions[vertex * 3 + 1] = -batch.positions[vertex * 3 + 1];
    // X was reflected by the display-list decoder. The Y reflection restores
    // the source handedness, so undo the decoder's winding correction.
    for (let vertex = 0; vertex < batch.positions.length / 3; vertex += 3) {
      swap(batch.positions, 3, vertex + 1, vertex + 2);
      swap(batch.uvs, 2, vertex + 1, vertex + 2);
      swap(batch.colors, 4, vertex + 1, vertex + 2);
      if (batch.unlitColors) swap(batch.unlitColors, 4, vertex + 1, vertex + 2);
      for (const colors of batch.lightingColors ?? []) swap(colors, 4, vertex + 1, vertex + 2);
      if (batch.uvs1) swap(batch.uvs1, 2, vertex + 1, vertex + 2);
    }
  }
}

function appendBank(bytes: Uint8Array, bin: Chunk, level: Level, bankIndex: number): void {
  const base = bin.data;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const modelCount = dv.getUint32(base);
  // Most banks pad four bytes after the node array; OILFIELD's first bank
  // does not, so the stored section offset is authoritative.
  const modelSection = base + dv.getUint32(base + 4);
  const textureCount = dv.getUint32(base + 16);
  const textureSection = base + dv.getUint32(base + 20);
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
      mirrorBatchesY(batches);
    }
    const mesh: Mesh = {
      name: `Bank ${bankIndex + 1} model ${i}`,
      radius: meshRadius(batches), batches,
      info: { bank: bankIndex, model: i, record: `0x${record.toString(16)}`, bytes: recordEnd - record },
    };
    models.push(level.meshes.push(mesh) - 1);
  }

  // XOBF graphs describe model-local assemblies. Arena-world placements are
  // the named FORM/OBJ records, whose name-to-model lookup is not decoded yet.
  // Keep the model assets available without piling every archetype at its
  // local origin as if the graph itself were the arena scene.
  level.unplaced.push(...models);
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

interface TerrainSample {
  height: number;
  color: number;
  material: number;
}

interface TerrainMaterial {
  skip: boolean;
  diagonal: boolean;
  uv: readonly number[];
}

interface TerrainData {
  samples: Map<number, TerrainSample>;
  colors: Array<[number, number, number, number]>;
  materials: TerrainMaterial[];
  texture: number;
  zones: number;
}

const TERRAIN_UV_ORIENTATIONS = new Uint8Array([
  0, 31, 31, 31, 0, 0, 31, 0,
  31, 31, 0, 31, 31, 0, 0, 0,
  0, 0, 0, 31, 31, 0, 31, 31,
  0, 31, 0, 0, 31, 31, 31, 0,
  31, 0, 0, 0, 31, 31, 0, 31,
  0, 0, 31, 0, 0, 31, 31, 31,
  31, 31, 31, 0, 0, 31, 0, 0,
  31, 0, 31, 31, 0, 0, 0, 31,
]);

function decodeTerrain(bytes: Uint8Array, top: Chunk[], level: Level): TerrainData | undefined {
  const zmap = top.find((chunk) => chunk.tag === 'ZMAP');
  const zones = top.filter((chunk) => chunk.tag === 'ZONE');
  const bitmap = top.find((chunk) => chunk.tag === 'XBMP');
  const xtin = top.find((chunk) => chunk.tag === 'XTIN');
  const cols = top.find((chunk) => chunk.tag === 'COLS');
  if (!zmap || zmap.end - zmap.data !== 0x800 || !zones.length || !bitmap || !xtin || !cols)
    return undefined;
  if (xtin.end - xtin.data !== 256 * 36 || cols.end - cols.data < 20)
    throw new Error('Invalid Vigilante 8: 2nd Offense terrain material data');

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const texture = level.textures.push(
    decodeIndexedBitmap(bytes, bitmap.data, `XBMP 0x${bitmap.start.toString(16)}`),
  ) - 1;
  const textureInfo = level.textures[texture];
  const materials: TerrainMaterial[] = [];
  for (let i = 0; i < 256; i++) {
    const at = xtin.data + i * 36;
    const flags = dv.getUint16(at);
    const tile = bytes[at + 2], orientationAndFlags = bytes[at + 3];
    const orientation = orientationAndFlags & 7;
    const source = TERRAIN_UV_ORIENTATIONS.subarray(orientation * 8, orientation * 8 + 8);
    const u0 = (tile & 15) * 32, v0 = (tile >>> 4) * 32;
    const uv = Array.from(source, (value, index) => {
      const texel = (index & 1 ? v0 : u0) + value - 0.5;
      return texel / (index & 1 ? textureInfo.height : textureInfo.width);
    });
    materials.push({ skip: (flags & 0x10) !== 0, diagonal: (orientationAndFlags & 8) !== 0, uv });
  }

  const colors: Array<[number, number, number, number]> = [];
  for (let i = 0; i < 32; i++) {
    const color: [number, number, number, number] = [0, 0, 0, 255];
    for (let component = 0; component < 3; component++) {
      const from = bytes[cols.data + 12 + component], to = bytes[cols.data + 16 + component];
      color[component] = from + Math.trunc((to - from) * i / 31);
    }
    colors.push(color);
  }

  const samples = new Map<number, TerrainSample>();
  const key = (x: number, z: number) => x * 2048 + z;
  for (let tileZ = 0; tileZ < 32; tileZ++) for (let tileX = 0; tileX < 32; tileX++) {
    const zoneId = dv.getUint16(zmap.data + (tileZ * 32 + tileX) * 2);
    if (!zoneId) continue;
    const zone = zones[zoneId - 1];
    if (!zone || zone.end - zone.data !== 0x4000)
      throw new Error(`Invalid Vigilante 8: 2nd Offense ZMAP zone ${zoneId}`);
    for (let localX = 0; localX < 64; localX++) for (let localZ = 0; localZ < 64; localZ++) {
      const packed = dv.getUint32(zone.data + (localX * 64 + localZ) * 4);
      samples.set(key(tileX * 64 + localX, tileZ * 64 + localZ), {
        height: (((packed >>> 16) - 0x200) & 0x7ff) / 32,
        color: (packed >>> 11) & 31,
        material: packed & 0xff,
      });
    }
  }
  return { samples, colors, materials, texture, zones: zones.length };
}

function appendTerrain(terrain: TerrainData, level: Level): number[] {
  const { samples, colors: palette, materials } = terrain;
  const key = (x: number, z: number) => x * 2048 + z;
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [];
  const vertex = (x: number, z: number, sample: TerrainSample, uv: readonly number[], corner: number) => {
    positions.push(-x, -sample.height, z);
    uvs.push(uv[corner * 2], uv[corner * 2 + 1]);
    colors.push(...palette[sample.color]);
  };
  for (const [packed, a] of samples) {
    const x = Math.floor(packed / 2048), z = packed % 2048;
    if ((x & 1) || (z & 1)) continue;
    const b = samples.get(key(x + 2, z));
    const c = samples.get(key(x, z + 2));
    const d = samples.get(key(x + 2, z + 2));
    if (!b || !c || !d) continue;
    const material = materials[a.material];
    if (!material || material.skip) continue;
    if (material.diagonal) {
      vertex(x, z, a, material.uv, 0); vertex(x + 2, z, b, material.uv, 1);
      vertex(x + 2, z + 2, d, material.uv, 3);
      vertex(x + 2, z + 2, d, material.uv, 3); vertex(x, z + 2, c, material.uv, 2);
      vertex(x, z, a, material.uv, 0);
    } else {
      vertex(x, z, a, material.uv, 0); vertex(x + 2, z, b, material.uv, 1);
      vertex(x, z + 2, c, material.uv, 2);
      vertex(x + 2, z + 2, d, material.uv, 3); vertex(x, z + 2, c, material.uv, 2);
      vertex(x + 2, z, b, material.uv, 1);
    }
  }
  if (!positions.length) return [];
  const batches: Batch[] = [{
    texture: terrain.texture, blend: 'opaque', depthTest: true, depthWrite: true, cullBack: true,
    positions: new Float32Array(positions), uvs: new Float32Array(uvs), colors: new Uint8Array(colors),
  }];
  const mesh = level.meshes.push({
    name: 'ZONE visible terrain', radius: meshRadius(batches), batches,
    info: { source: 'ZMAP/ZONE/XBMP/XTIN/COLS', zones: terrain.zones, triangles: positions.length / 9 },
  }) - 1;
  return [level.instances.push({ name: 'ZONE visible terrain', mesh, matrix: IDENTITY.slice() }) - 1];
}

function appendCollision(terrain: TerrainData, level: Level): void {
  const { samples } = terrain;
  const key = (x: number, z: number) => x * 2048 + z;

  const positions: number[] = [], uvs: number[] = [], colors: number[] = [];
  const vertex = (x: number, z: number, sample: TerrainSample) => {
    // Reflect the game's X/right and Y/down axes into the viewer's frame.
    positions.push(-x, -sample.height, z);
    uvs.push(0, 0);
    colors.push(64, 224, 255, 128);
  };
  for (const [packed, h00] of samples) {
    const x = Math.floor(packed / 2048), z = packed % 2048;
    const h10 = samples.get(key(x + 1, z));
    const h01 = samples.get(key(x, z + 1));
    const h11 = samples.get(key(x + 1, z + 1));
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
    info: { source: 'ZMAP/ZONE', zones: terrain.zones, triangles: positions.length / 9 },
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
  for (let i = 0; i < banks.length; i++) {
    const bin = chunks(bytes, banks[i].data + 4, banks[i].end).find((chunk) => chunk.tag === 'BIN ');
    if (!bin) throw new Error('Vigilante 8: 2nd Offense XOBF has no BIN chunk');
    appendBank(bytes, bin, level, i);
  }
  const terrain = decodeTerrain(bytes, top, level);
  if (terrain) {
    const terrainInstances = appendTerrain(terrain, level);
    level.layers!.push({ name: 'terrain', kind: 'main', instances: terrainInstances });
    updateBounds(level, terrainInstances);
    appendCollision(terrain, level);
  }
  const sky = top.find((chunk) => chunk.tag === 'XBGM');
  if (sky) appendSky(bytes, sky, level);
}
