// Off Road Challenge track roots, sectors, placements, custom float meshes,
// packed CI4 materials, track-resident objects and collision candidates.
import type { Batch, CameraView, Instance, Level, LevelInfo, Marker, Mesh } from '../types';
import { emptyBounds } from '../util';
import type { OffroadImage, OffroadRom } from './fs';
import { buildMaterialTextures, type MaterialTexture, type TextureWindow } from './texture';

const TRACK_NAMES = ['Mojave', 'El Paso', 'Vegas', 'Pikes Peak', "Ol' South", 'Baja', 'Flagstaff', 'El Cajon', 'Guadalupe'];
const IDS = ['mojave', 'el-paso', 'vegas', 'pikes-peak', 'ol-south', 'baja', 'flagstaff', 'el-cajon', 'guadalupe'];

export const OFFROAD_LEVELS: LevelInfo[] = TRACK_NAMES.map((name, index) => ({
  index, name, kind: 'race', ...(index >= 6 ? { group: 'Unlockable tracks' } : {}),
}));

type V3 = [number, number, number];
type V2 = [number, number];

interface Polygon {
  address: number;
  flags: number;
  vertices: [number, number, number, number];
  uv: [V2, V2, V2, V2];
  window: TextureWindow | null;
}

interface RawModel {
  address: number;
  file: number;
  radius: number;
  bounds: { min: V3; max: V3 };
  vertices: V3[];
  polygons: Polygon[];
}

interface Placement {
  address: number;
  flags: number;
  modelAddress: number;
  model: RawModel | null;
  words: [number, number, number];
  position: V3;
  angle: number;
  sector?: number;
  category?: number;
  instanceId?: number;
}

const hex = (n: number) => `0x${(n >>> 0).toString(16)}`;

// 0x80013E7C loads references in the order 1,0,3,2, attaches these
// four S/T pairs, then emits triangles (1,0,3) and (1,3,2). Converted
// back to the polygon's reference order, the pairs are therefore 4/5,
// 6/7, 8/9, A/B. The research prototype had the pairs swapped.
function polygonUv(image: OffroadImage, polygon: number): [V2, V2, V2, V2] {
  return [
    [image.u8(polygon + 5), image.u8(polygon + 4)],
    [image.u8(polygon + 7), image.u8(polygon + 6)],
    [image.u8(polygon + 9), image.u8(polygon + 8)],
    [image.u8(polygon + 11), image.u8(polygon + 10)],
  ];
}

function textureWindow(image: OffroadImage, polygon: number, paletteLookup: number): TextureWindow {
  const selector = image.u8(polygon + 1);
  const uv = polygonUv(image, polygon);
  const ss = uv.map((v) => v[0]), ts = uv.map((v) => v[1]);
  const paletteOffset = image.u32(paletteLookup + selector * 4);
  const row = image.u16(polygon + 0x0e);
  const minS = Math.min(...ss), maxS = Math.max(...ss), minT = Math.min(...ts), maxT = Math.max(...ts);
  return { key: `${paletteOffset}/${row}/${minS}/${maxS}/${minT}/${maxT}`, selector, paletteOffset, row, minS, maxS, minT, maxT };
}

function parsePlacement(image: OffroadImage, address: number, getModel: (address: number) => RawModel | null): Placement {
  if (!image.contains(address, 0x24)) throw new Error(`Off Road Challenge placement ${hex(address)} is out of bounds`);
  const position: V3 = [image.f32(address + 0x14), image.f32(address + 0x18), image.f32(address + 0x1c)];
  if (position.some((v) => !Number.isFinite(v))) throw new Error(`Off Road Challenge placement ${hex(address)} has non-finite coordinates`);
  const modelAddress = image.u32(address + 4);
  return {
    address, flags: image.u32(address), modelAddress, model: getModel(modelAddress),
    words: [image.u32(address + 8), image.u32(address + 0x0c), image.u32(address + 0x10)],
    position, angle: image.u32(address + 0x20),
  };
}

function yawMatrix(p: Placement): Float32Array {
  const yaw = (p.angle & 0xffff) * Math.PI * 2 / 0x10000;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, p.position[0], p.position[1], p.position[2], 1]);
}

function appendBounds(bounds: Level['bounds'], model: RawModel, matrix: Float32Array) {
  for (let bits = 0; bits < 8; bits++) {
    const x = bits & 1 ? model.bounds.max[0] : model.bounds.min[0];
    const y = bits & 2 ? model.bounds.max[1] : model.bounds.min[1];
    const z = bits & 4 ? model.bounds.max[2] : model.bounds.min[2];
    const p: V3 = [matrix[0] * x + matrix[8] * z + matrix[12], y + matrix[13], matrix[2] * x + matrix[10] * z + matrix[14]];
    for (let k = 0; k < 3; k++) { bounds.min[k] = Math.min(bounds.min[k], p[k]); bounds.max[k] = Math.max(bounds.max[k], p[k]); }
  }
}

function makeRenderMesh(model: RawModel, materials: Map<string, MaterialTexture>): Mesh {
  const groups = new Map<number, { pos: number[]; uv: number[]; color: number[]; source: number[] }>();
  const group = (key: number) => {
    let g = groups.get(key);
    if (!g) { g = { pos: [], uv: [], color: [], source: [] }; groups.set(key, g); }
    return g;
  };
  for (const polygon of model.polygons) {
    const material = polygon.window ? materials.get(polygon.window.key) : undefined;
    if (polygon.window && !material) throw new Error(`missing Off Road Challenge material ${polygon.window.key}`);
    const g = group(material?.texture ?? -1);
    const order = polygon.vertices[1] === polygon.vertices[2] ? [0, 1, 3] : [0, 1, 2, 0, 2, 3];
    for (let i = 0; i < order.length; i++) {
      const corner = order[i], vertex = model.vertices[polygon.vertices[corner]];
      g.pos.push(...vertex);
      if (material && polygon.window) {
        const [s, t] = polygon.uv[corner];
        g.uv.push((s + 0.5) / material.width, (polygon.window.row + t - material.firstRow + 0.5) / material.height);
      } else g.uv.push(0, 0);
      g.color.push(255, 255, 255, 255);
      if (i % 3 === 0) g.source.push(polygon.address);
    }
  }
  const batches: Batch[] = [];
  for (const [texture, g] of groups) batches.push({
    texture,
    // The terrain routine uses the opaque Z-buffered render mode (0x00504240).
    blend: 'opaque', depthTest: true, depthWrite: true, cullBack: false,
    positions: new Float32Array(g.pos), uvs: new Float32Array(g.uv), colors: new Uint8Array(g.color), triSource: new Uint32Array(g.source),
  });
  return {
    name: `model ${hex(model.address)}`, radius: model.radius, batches,
    info: { file: model.file, model: hex(model.address), polygons: model.polygons.length, triSource: 'runtime RAM address of 24-byte polygon' },
  };
}

function collisionBox(model: RawModel): Mesh {
  const { min, max } = model.bounds;
  const p = (i: number): V3 => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
  const faces = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  const pos: number[] = [], colors: number[] = [];
  for (const [a, b, c, d] of faces) for (const i of [a, b, c, a, c, d]) { pos.push(...p(i)); colors.push(255, 96, 32, 105); }
  return {
    name: `collision candidate bounds ${hex(model.address)}`, radius: model.radius,
    batches: [{ texture: -1, blend: 'blend', depthTest: true, depthWrite: false, cullBack: false,
      positions: new Float32Array(pos), uvs: new Float32Array(pos.length / 3 * 2), colors: new Uint8Array(colors) }],
    info: { sourceModel: hex(model.address), meaning: 'category 3/4 object-level collision candidate bounds' },
  };
}

function sectorCenter(placements: Placement[]): V3 | null {
  const valid = placements.filter((p) => p.model);
  if (!valid.length) return null;
  return [0, 1, 2].map((k) => valid.reduce((n, p) => n + p.position[k], 0) / valid.length) as V3;
}

function startCamera(sectors: Placement[][], start: number, bounds: Level['bounds']): CameraView {
  const a = sectorCenter(sectors[start]) ?? [
    (bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2,
  ];
  let b: V3 | null = null;
  for (let i = 1; i < sectors.length && !b; i++) b = sectorCenter(sectors[(start + i) % sectors.length]);
  b ??= [a[0], a[1], a[2] + 10000];
  let dx = b[0] - a[0], dz = b[2] - a[2], distance = Math.hypot(dx, dz);
  if (distance < 1) { dx = 0; dz = 1; distance = 10000; }
  dx /= distance; dz /= distance;
  const back = Math.max(3500, Math.min(10000, distance * 0.45));
  const lift = Math.max(1800, Math.min(5000, distance * 0.2));
  return {
    eye: [a[0] - dx * back, a[1] + lift, a[2] - dz * back],
    target: [a[0] + dx * Math.min(5000, distance * 0.25), a[1] + 300, a[2] + dz * Math.min(5000, distance * 0.25)],
    fovY: 42.67,
  };
}

export function loadOffroadLevel(rom: OffroadRom, index: number): Level {
  const info = OFFROAD_LEVELS[index];
  if (!info) throw new Error(`invalid Off Road Challenge level ${index}`);
  const { image, root, fileIds } = rom.trackImage(index);
  const paletteLookup = image.u32(root + 8), sectorTable = image.u32(root + 0x0c), auxList = image.u32(root + 0x10);
  const sectorCount = image.u32(root + 0x18), startSector = image.u32(root + 0x2c);
  if (!sectorCount || sectorCount > 4096 || startSector >= sectorCount || !image.contains(sectorTable, sectorCount * 16))
    throw new Error(`invalid Off Road Challenge ${info.name} sector table`);
  const bundle = image.u32(root + 4);
  if (!image.contains(bundle, 12)) throw new Error(`invalid Off Road Challenge ${info.name} resource bundle`);
  const descriptor = image.u32(bundle + 8);
  if (!image.contains(descriptor, 16)) throw new Error(`invalid Off Road Challenge ${info.name} resource descriptor`);
  const paletteConfigs = image.u32(descriptor), paletteBase = image.u32(descriptor + 4);
  const atlasWord = image.u32(descriptor + 8), atlasHeight = atlasWord & 0x7fffffff, atlasBase = image.u32(descriptor + 12);
  if (!paletteConfigs || paletteConfigs > 32 || !(atlasWord & 0x80000000) || !atlasHeight || atlasHeight > 8192)
    throw new Error(`invalid Off Road Challenge ${info.name} texture descriptor`);

  const modelCache = new Map<number, RawModel | null>();
  const getModel = (address: number): RawModel | null => {
    const known = modelCache.get(address);
    if (known !== undefined || modelCache.has(address)) return known ?? null;
    let result: RawModel | null = null;
    try {
      if (!address || !image.contains(address, 0x30)) throw new Error('not a standard model');
      const radius = image.f32(address), values = Array.from({ length: 6 }, (_, i) => image.f32(address + 4 + i * 4));
      const vertexCount = image.u32(address + 0x1c) + 1, verticesAddress = image.u32(address + 0x20);
      const polygonCount = image.u32(address + 0x28) + 1, polygonsAddress = image.u32(address + 0x2c);
      if (!Number.isFinite(radius) || radius < 0 || values.some((v) => !Number.isFinite(v)) ||
          vertexCount < 1 || vertexCount > 65536 || polygonCount < 1 || polygonCount > 262144 ||
          !image.contains(verticesAddress, vertexCount * 12) || !image.contains(polygonsAddress, polygonCount * 24))
        throw new Error('not a bounded standard model');
      const vertices: V3[] = Array.from({ length: vertexCount }, (_, i) => [
        image.f32(verticesAddress + i * 12), image.f32(verticesAddress + i * 12 + 4), image.f32(verticesAddress + i * 12 + 8),
      ]);
      if (vertices.some((v) => v.some((n) => !Number.isFinite(n)))) throw new Error('non-finite model vertex');
      const polygons: Polygon[] = [];
      for (let i = 0; i < polygonCount; i++) {
        const p = polygonsAddress + i * 24, flags = image.u32(p);
        const refs = [0x10, 0x12, 0x14, 0x16].map((o) => image.u16(p + o));
        if (refs.some((r) => r % 3 || r / 3 >= vertexCount)) throw new Error('invalid model vertex reference');
        const uv = polygonUv(image, p);
        polygons.push({ address: p, flags, vertices: refs.map((r) => r / 3) as [number, number, number, number], uv,
          window: flags & 0x100 ? textureWindow(image, p, paletteLookup) : null });
      }
      const source = image.source(address);
      result = { address, file: source.file.id, radius, bounds: { min: values.slice(0, 3) as V3, max: values.slice(3, 6) as V3 }, vertices, polygons };
      if (result.bounds.min.some((v, i) => v > result!.bounds.max[i])) throw new Error('invalid model bounds');
    } catch { result = null; }
    modelCache.set(address, result);
    return result;
  };

  const sectors: Placement[][] = [];
  const sectorFlags: number[] = [];
  for (let sector = 0; sector < sectorCount; sector++) {
    const record = sectorTable + sector * 16;
    if (image.u32(record + 4) !== sector) throw new Error(`Off Road Challenge ${info.name} sector ${sector} has wrong ordinal`);
    sectorFlags.push(image.u32(record));
    const payload = image.u32(record + 12);
    if (!image.contains(payload, 0x44)) throw new Error(`Off Road Challenge ${info.name} sector ${sector} payload is out of bounds`);
    const counts = Array.from({ length: 5 }, (_, i) => image.u32(payload + 0x28 + i * 4));
    const total = image.u32(payload + 0x40);
    if (total > 100000 || counts.reduce((a, b) => a + b, 0) > total || !image.contains(payload + 0x44, total * 0x24))
      throw new Error(`Off Road Challenge ${info.name} sector ${sector} has invalid placement counts`);
    const ends: number[] = []; counts.reduce((n, v, i) => ends[i] = n + v, 0);
    sectors.push(Array.from({ length: total }, (_, i) => {
      const p = parsePlacement(image, payload + 0x44 + i * 0x24, getModel);
      p.sector = sector; p.category = ends.findIndex((end) => i < end);
      return p;
    }));
  }

  if (!image.contains(auxList, 4)) throw new Error(`Off Road Challenge ${info.name} auxiliary list is out of bounds`);
  const auxCount = image.u32(auxList);
  if (auxCount > 4096 || !image.contains(auxList + 4, auxCount * 8)) throw new Error(`Off Road Challenge ${info.name} auxiliary count ${auxCount} is invalid`);
  const auxiliary = Array.from({ length: auxCount }, (_, i) => {
    const template = image.u32(auxList + 4 + i * 8), p = parsePlacement(image, template, getModel);
    p.instanceId = image.u32(auxList + 8 + i * 8);
    return p;
  });

  const rawModels = [...modelCache.values()].filter((m): m is RawModel => !!m);
  const uniqueWindows = new Map<string, TextureWindow>();
  for (const model of rawModels) for (const polygon of model.polygons) if (polygon.window) uniqueWindows.set(polygon.window.key, polygon.window);
  const materialSet = buildMaterialTextures(image, [...uniqueWindows.values()], paletteBase, atlasBase, atlasHeight,
    `${rom.version.region} track ${index} files ${fileIds.join(',')} descriptor ${hex(descriptor)}`);
  const meshes = rawModels.map((model) => makeRenderMesh(model, materialSet.materials));
  const meshByModel = new Map(rawModels.map((model, i) => [model.address, i]));
  const instances: Instance[] = [], trackInstances: number[] = [], objectInstances: number[] = [], collisionInstances: number[] = [];
  const markers: Marker[] = [];
  const bounds = emptyBounds();

  for (const placements of sectors) for (const p of placements) {
    if (!p.model) {
      markers.push({ label: `unresolved sector record ${hex(p.modelAddress)}`, position: p.position, layer: 0,
        info: { sector: p.sector!, category: p.category!, placement: hex(p.address), flags: hex(p.flags), model: hex(p.modelAddress) } });
      continue;
    }
    const matrix = yawMatrix(p), mesh = meshByModel.get(p.model.address)!;
    trackInstances.push(instances.length);
    instances.push({ name: `sector ${p.sector} category ${p.category}`, mesh, matrix,
      info: { files: fileIds.join(','), sector: p.sector!, category: p.category!, placement: hex(p.address), model: hex(p.modelAddress), flags: hex(p.flags), word08: hex(p.words[0]), word0c: hex(p.words[1]), packed10: hex(p.words[2]), angle: hex(p.angle) } });
    appendBounds(bounds, p.model, matrix);
  }
  for (const p of auxiliary) {
    const id = p.instanceId!;
    if (!p.model) {
      markers.push({ label: `object ${(id >>> 16) & 0xffff} (specialized model ${hex(p.modelAddress)})`, position: p.position, layer: 1,
        info: { instanceId: hex(id), template: hex(p.address), model: hex(p.modelAddress), flags: hex(p.flags) } });
      continue;
    }
    const matrix = yawMatrix(p), mesh = meshByModel.get(p.model.address)!;
    objectInstances.push(instances.length);
    instances.push({ name: `object ${(id >>> 16) & 0xffff}`, mesh, matrix,
      info: { files: fileIds.join(','), instanceId: hex(id), template: hex(p.address), model: hex(p.modelAddress), flags: hex(p.flags), angle: hex(p.angle) } });
    appendBounds(bounds, p.model, matrix);
  }

  const collisionMeshByModel = new Map<number, number>();
  for (const placements of sectors) for (const p of placements) if ((p.category === 3 || p.category === 4) && p.model) {
    let mesh = collisionMeshByModel.get(p.model.address);
    if (mesh === undefined) { mesh = meshes.push(collisionBox(p.model)) - 1; collisionMeshByModel.set(p.model.address, mesh); }
    collisionInstances.push(instances.length);
    instances.push({ name: `collision candidate category ${p.category}`, mesh, matrix: yawMatrix(p), noFog: true,
      info: { sector: p.sector!, category: p.category, placement: hex(p.address), sourceModel: hex(p.modelAddress) } });
  }
  if (!collisionInstances.length) throw new Error(`Off Road Challenge ${info.name} has no decoded collision candidates`);
  if (!Number.isFinite(bounds.min[0])) { bounds.min = [-1, -1, -1]; bounds.max = [1, 1, 1]; }

  return {
    info, id: IDS[index], textures: materialSet.textures, meshes, instances, unplaced: [], bounds,
    markers: markers.length ? markers : undefined,
    layers: [
      { name: 'track', kind: 'main', instances: trackInstances },
      { name: 'objects', kind: 'objects', instances: objectInstances },
      { name: 'collision candidates', kind: 'collision', instances: collisionInstances, visibleByDefault: false },
    ],
    camera: startCamera(sectors, startSector, bounds),
    // The four selectable sky pictures remain undecoded; blue is an explicit
    // retail choice and is a less misleading fallback than synthesized fog.
    clearColor: [112, 155, 196],
  };
}
