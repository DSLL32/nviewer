import type { Batch, Level, Texture } from '../types';

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export interface Vigilante8TerrainChunk {
  start: number;
  data: number;
  end: number;
}

export interface Vigilante8TerrainSample {
  height: number;
  material: number;
  shade: number;
  source: number;
}

export interface Vigilante8TerrainSurface {
  samples: Map<number, Vigilante8TerrainSample>;
  key(x: number, z: number): number;
}

function rgba5551(value: number): [number, number, number, number] {
  const five = (v: number) => (v << 3) | (v >>> 2);
  return [five(value >>> 11), five((value >>> 6) & 31), five((value >>> 1) & 31), value & 1 ? 255 : 0];
}

export function decodeVigilante8Bitmap(
  bytes: Uint8Array,
  offset: number,
  source: string,
  forceOpaque = false,
): Texture {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const format = dv.getUint16(offset), paletteCount = dv.getUint16(offset + 2);
  const width = dv.getUint16(offset + 4), height = dv.getUint16(offset + 6);
  if (format !== 0x0201) throw new Error(`Unsupported Vigilante 8 bitmap format 0x${format.toString(16)}`);
  const pixels = offset + ((8 + paletteCount * 2 + 7) & ~7), rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = bytes[pixels + y * ((width + 7) & ~7) + x];
    const color = rgba5551(dv.getUint16(offset + 8 + index * 2));
    if (forceOpaque) color[3] = 255;
    rgba.set(color, (y * width + x) * 4);
  }
  return { width, height, rgba, wrapS: 'repeat', wrapT: 'clamp', format: 'CI8/RGBA16', source };
}

export function readVigilante8Terrain(
  bytes: Uint8Array,
  zmap: Vigilante8TerrainChunk | undefined,
  zones: Vigilante8TerrainChunk[],
): Vigilante8TerrainSurface | undefined {
  if (!zmap || zmap.end - zmap.data !== 0x800 || !zones.length) return undefined;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Map<number, Vigilante8TerrainSample>();
  const key = (x: number, z: number) => x * 2048 + z;

  // ZMAP is indexed [zoneZ][zoneX], while each 64x64 ZONE is indexed
  // [localX][localZ]. The renderer emits these global sample coordinates
  // directly; only height receives a later 1/32 matrix scale.
  for (let zoneZ = 0; zoneZ < 32; zoneZ++) for (let zoneX = 0; zoneX < 32; zoneX++) {
    const zoneId = dv.getUint16(zmap.data + (zoneZ * 32 + zoneX) * 2);
    if (!zoneId) continue;
    const zone = zones[zoneId - 1];
    if (!zone || zone.end - zone.data !== 0x4000)
      throw new Error(`Invalid Vigilante 8 ZMAP zone ${zoneId}`);
    for (let localX = 0; localX < 64; localX++) for (let localZ = 0; localZ < 64; localZ++) {
      const source = zone.data + (localX * 64 + localZ) * 4;
      const storedHeight = dv.getUint16(source);
      samples.set(key(zoneX * 64 + localX, zoneZ * 64 + localZ), {
        // The ZONE loader removes the disk bias, then packs byte 2's upper
        // five bits above the eleven-bit height for the renderer.
        height: ((storedHeight - 0x200) & 0x7ff) / 32,
        shade: bytes[source + 2] >>> 3,
        material: bytes[source + 3],
        source,
      });
    }
  }
  return { samples, key };
}

function terrainTiles(bytes: Uint8Array, xbmp: Vigilante8TerrainChunk, level: Level): number[] {
  const atlas = decodeVigilante8Bitmap(bytes, xbmp.data, `XBMP 0x${xbmp.start.toString(16)}`, true);
  if ((atlas.width & 31) || (atlas.height & 31)) throw new Error('Vigilante 8 XBMP is not a 32x32 tile atlas');
  const columns = atlas.width / 32, rows = atlas.height / 32, textures: number[] = [];
  for (let tileY = 0; tileY < rows; tileY++) for (let tileX = 0; tileX < columns; tileX++) {
    const rgba = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y++) {
      const source = ((tileY * 32 + y) * atlas.width + tileX * 32) * 4;
      rgba.set(atlas.rgba.subarray(source, source + 32 * 4), y * 32 * 4);
    }
    textures.push(level.textures.push({
      width: 32, height: 32, rgba, wrapS: 'repeat', wrapT: 'repeat', format: atlas.format,
      source: `${atlas.source} tile ${tileX},${tileY}`,
    }) - 1);
  }
  return textures;
}

const UV_CORNERS: readonly (readonly [number, number])[][] = [
  [[0, 31], [31, 31], [0, 0], [31, 0]],
  [[31, 31], [0, 31], [31, 0], [0, 0]],
  [[0, 0], [0, 31], [31, 0], [31, 31]],
  [[0, 31], [0, 0], [31, 31], [31, 0]],
  [[31, 0], [0, 0], [31, 31], [0, 31]],
  [[0, 0], [31, 0], [0, 31], [31, 31]],
  [[31, 31], [31, 0], [0, 31], [0, 0]],
  [[31, 0], [31, 31], [0, 0], [0, 31]],
];

interface TerrainMaterial {
  texture: number;
  uvs: readonly (readonly [number, number])[];
  diagonal: boolean;
  source: number;
}

export function appendVigilante8Terrain(
  bytes: Uint8Array,
  surface: Vigilante8TerrainSurface | undefined,
  xbmp: Vigilante8TerrainChunk | undefined,
  tinf: Vigilante8TerrainChunk | undefined,
  cols: Vigilante8TerrainChunk | undefined,
  level: Level,
): number[] {
  if (!surface || !xbmp || !tinf || !cols) return [];
  if (tinf.end - tinf.data !== 256 * 40 || cols.end - cols.data < 20)
    throw new Error('Invalid Vigilante 8 terrain material data');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const textures = terrainTiles(bytes, xbmp, level);
  const atlasColumns = dv.getUint16(xbmp.data + 4) / 32;
  const materials: TerrainMaterial[] = [];
  for (let i = 0; i < 256; i++) {
    const source = tinf.data + i * 40;
    const flags = dv.getUint16(source + 6);
    const tileX = dv.getUint16(source + 2) / 32, tileY = dv.getUint16(source + 4) / 32;
    const texture = tileX + atlasColumns * tileY;
    if (!Number.isInteger(texture) || texture < 0 || texture >= textures.length)
      throw new Error(`Invalid Vigilante 8 terrain texture ${tileX},${tileY}`);
    materials.push({ texture: textures[texture], uvs: UV_CORNERS[flags & 7], diagonal: !!(flags & 8), source });
  }

  const color0 = cols.data + 3 * 4, color1 = cols.data + 4 * 4;
  const shades = Array.from({ length: 32 }, (_, i) => [
    Math.floor(bytes[color0] + (bytes[color1] - bytes[color0]) * i / 31),
    Math.floor(bytes[color0 + 1] + (bytes[color1 + 1] - bytes[color0 + 1]) * i / 31),
    Math.floor(bytes[color0 + 2] + (bytes[color1 + 2] - bytes[color0 + 2]) * i / 31),
    255,
  ] as const);
  const builders = new Map<number, { positions: number[]; uvs: number[]; colors: number[]; triSource: number[] }>();
  let radius = 0, triangles = 0;
  const { samples, key } = surface;
  for (const [packed, s0] of samples) {
    const x = Math.floor(packed / 2048), z = packed % 2048;
    const corners = [s0, samples.get(key(x + 1, z)), samples.get(key(x, z + 1)), samples.get(key(x + 1, z + 1))];
    if (corners.some((sample) => !sample)) continue;
    const material = materials[s0.material], builder = builders.get(material.texture) ?? {
      positions: [], uvs: [], colors: [], triSource: [],
    };
    builders.set(material.texture, builder);
    const order = material.diagonal ? [0, 1, 3, 3, 2, 0] : [0, 1, 2, 3, 2, 1];
    for (const corner of order) {
      const sample = corners[corner]!;
      const px = x + (corner & 1), pz = z + (corner >>> 1), py = sample.height;
      builder.positions.push(-px, -py, pz);
      // The runtime uses S/T=-16 or 976, i.e. texel centres at -0.5/30.5,
      // against a repeating 32x32 tile loaded from the XBMP atlas.
      builder.uvs.push((material.uvs[corner][0] - 0.5) / 32, (material.uvs[corner][1] - 0.5) / 32);
      builder.colors.push(...shades[sample.shade]);
      radius = Math.max(radius, Math.hypot(px, py, pz));
    }
    builder.triSource.push(s0.source, s0.source);
    triangles += 2;
  }
  const batches: Batch[] = [...builders.entries()].map(([texture, builder]) => ({
    texture, blend: 'opaque', depthTest: true, depthWrite: true, cullBack: false,
    positions: new Float32Array(builder.positions), uvs: new Float32Array(builder.uvs),
    colors: new Uint8Array(builder.colors), triSource: new Uint32Array(builder.triSource),
  }));
  if (!batches.length) return [];
  const mesh = level.meshes.push({
    name: 'ZONE visible terrain', radius, batches,
    info: { source: 'ZMAP/ZONE + TINF/XBMP/COLS', triangles },
  }) - 1;
  return [level.instances.push({
    name: 'ZONE visible terrain', mesh, matrix: IDENTITY.slice(),
    info: { source: 'ZMAP/ZONE + TINF/XBMP/COLS' },
  }) - 1];
}
