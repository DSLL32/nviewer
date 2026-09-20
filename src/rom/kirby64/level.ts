import { decodeRows, ImFmt, ImSiz, Tlut } from '../texture';
import type { CameraView, Level, Mesh, Texture } from '../types';
import { appendCollision } from './collision';
import { f32, KirbyArchive, s16, u16, u32 } from './fs';
import { decodeGeometry, identityMatrix, placeModel } from './geometry';
import { appendObjects } from './objects';
import type { AreaRecord, SetupRecord } from './types';
import { describeAreaType } from './fs';

const BACKDROP_TABLE = 0x7c8b8;
const COLOR_TABLE = 0x7c9dc;
const OVL1_BIAS = 0x80057db0;
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function expandBounds(level: Level, indices: number[]): void {
  for (const index of indices) {
    const instance = level.instances[index], mesh = level.meshes[instance.mesh], m = instance.matrix;
    for (const batch of mesh.batches) for (let i = 0; i < batch.positions.length; i += 3) {
      const p = batch.positions;
      const x = m[0] * p[i] + m[4] * p[i + 1] + m[8] * p[i + 2] + m[12];
      const y = m[1] * p[i] + m[5] * p[i + 1] + m[9] * p[i + 2] + m[13];
      const z = m[2] * p[i] + m[6] * p[i + 1] + m[10] * p[i + 2] + m[14];
      level.bounds.min[0] = Math.min(level.bounds.min[0], x); level.bounds.max[0] = Math.max(level.bounds.max[0], x);
      level.bounds.min[1] = Math.min(level.bounds.min[1], y); level.bounds.max[1] = Math.max(level.bounds.max[1], y);
      level.bounds.min[2] = Math.min(level.bounds.min[2], z); level.bounds.max[2] = Math.max(level.bounds.max[2], z);
    }
  }
}

function cameraFromPaths(archive: KirbyArchive, setup: SetupRecord, center: [number, number, number], span: number): CameraView {
  const rom = archive.rom, h = setup.paths;
  let fov = 45;
  if (h && h + 0x10 <= setup.extent.end && u32(rom, h) && u32(rom, h + 4)) {
    const pathHeader = setup.extent.start + u32(rom, h + 4), node = setup.extent.start + u32(rom, pathHeader);
    const footer = setup.extent.start + u32(rom, pathHeader + 4);
    const candidate = f32(rom, node + 0x58);
    if (candidate >= 20 && candidate <= 100) fov = candidate;
    const pointCount = u16(rom, footer + 2), positionsRaw = u32(rom, footer + 8);
    if (pointCount && positionsRaw) {
      const positions = setup.extent.start + positionsRaw;
      // Path positions are an array of XYZ triplets. The footer describes it
      // as a 3xN matrix, but live/sample records establish point-major order.
      const path: [number, number, number] = [f32(rom, positions), f32(rom, positions + 4), f32(rom, positions + 8)];
      const focusRaw: [number, number, number] = [f32(rom, node + 0x2c), f32(rom, node + 0x30), f32(rom, node + 0x34)];
      const focus = focusRaw.map((value, axis) => Math.abs(value) >= 9000 ? path[axis] : value) as [number, number, number];
      const distance = Math.max(10, Math.abs(f32(rom, node + 0x50)));
      const target: [number, number, number] = [-focus[0], focus[1], focus[2]];
      return { eye: [target[0], target[1], target[2] + distance], target, fovY: fov };
    }
  }
  return { eye: [center[0], center[1] + span * 0.22, center[2] + span * 0.55], target: center, fovY: fov };
}

function backdropTexture(archive: KirbyArchive, level: Level, imageId: number): number {
  const extent = archive.member('image', imageId), rom = archive.rom;
  if (extent.end - extent.start < 0x10) return -1;
  const fmt = rom[extent.start] as ImFmt, siz = rom[extent.start + 1] as ImSiz;
  const width = u16(rom, extent.start + 4), height = u16(rom, extent.start + 6);
  const data = extent.start + u32(rom, extent.start + 8), paletteAt = u32(rom, extent.start + 0xc);
  const bits = [4, 8, 16, 32][siz] ?? 0, bytes = Math.ceil(width * height * bits / 8);
  if (!width || !height || width > 1024 || height > 1024 || !bits || data < extent.start || data + bytes > extent.end) return -1;
  const palette = fmt === ImFmt.CI && paletteAt >= 0x10 && extent.start + paletteAt < extent.end
    ? rom.subarray(extent.start + paletteAt, extent.end) : null;
  const rgba = decodeRows(rom, data, fmt, siz, width, height, palette, Tlut.Rgba16);
  const formatName = `${['RGBA', 'YUV', 'CI', 'IA', 'I'][fmt] ?? `fmt${fmt}`}${bits}${fmt === ImFmt.CI ? '/RGBA16' : ''}`;
  const texture: Texture = { width, height, rgba, wrapS: 'clamp', wrapT: 'clamp', format: formatName,
    source: `backdrop image ${extent.bank}:${extent.index} ROM 0x${extent.start.toString(16)}` };
  return level.textures.push(texture) - 1;
}

function backdropMesh(texture: number, width: number, height: number, name: string, rom: number, type: number): Mesh {
  const hw = width / 2, hh = height / 2;
  return {
    name, radius: Math.hypot(hw, hh), info: { backdropROM: `0x${rom.toString(16)}`, backdropType: type },
    batches: [{
      texture, blend: 'blend', depthTest: true, depthWrite: false, cullBack: false,
      positions: new Float32Array([-hw, -hh, 0, hw, -hh, 0, hw, hh, 0, -hw, -hh, 0, hw, hh, 0, -hw, hh, 0]),
      uvs: new Float32Array([0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0]),
      colors: new Uint8Array(24).fill(255), triSource: new Uint32Array([rom, rom]),
    }],
  };
}

function appendBackdrops(archive: KirbyArchive, level: Level, area: AreaRecord, instances: number[], center: [number, number, number], span: number): void {
  if (!area.backdropId) return;
  const pointer = u32(archive.rom, BACKDROP_TABLE + area.backdropId * 4);
  if (!pointer) return;
  let at = pointer - OVL1_BIAS;
  for (let record = 0; record < 32 && at + 0x30 <= archive.rom.length && u32(archive.rom, at); record++, at += 0x30) {
    const imageId = u32(archive.rom, at), type = u32(archive.rom, at + 4), texture = backdropTexture(archive, level, imageId);
    if (texture < 0) continue;
    const t = level.textures[texture], sx = f32(archive.rom, at + 0x10), sy = f32(archive.rom, at + 0x14);
    const mesh = backdropMesh(texture, t.width, t.height, `Backdrop ${area.backdropId}.${record + 1}`, at, type);
    const meshIndex = level.meshes.push(mesh) - 1;
    const scaleX = Number.isFinite(sx) && sx !== 0 ? sx : 1, scaleY = Number.isFinite(sy) && sy !== 0 ? sy : 1;
    const x = -s16(archive.rom, at + 0xc), y = s16(archive.rom, at + 0xe), z = center[2] - Math.max(span, 100);
    const matrix = new Float32Array([scaleX, 0, 0, 0, 0, scaleY, 0, 0, 0, 0, 1, 0, center[0] + x, center[1] + y, z - record, 1]);
    instances.push(level.instances.push({
      name: mesh.name, mesh: meshIndex, matrix, billboard: 'y', noFog: true,
      info: { backdropId: area.backdropId, record, imageId: `${imageId >>> 16}:${imageId & 0xffff}`, type, approximation: 'camera-facing static environment sprite' },
    }) - 1);
  }
}

export function loadKirbyLevel(archive: KirbyArchive, index: number): Level {
  const area = archive.areas[index];
  if (!area) throw new Error(`Kirby 64: invalid level ${index}`);
  const level: Level = {
    info: area.info, id: `kirby64-${area.world}-${area.stage}-${area.area}-${area.name.toLowerCase()}`,
    textures: [], meshes: [], instances: [], unplaced: [], markers: [], layers: [], pixelArt: true,
    bounds: { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] },
    clearColor: [archive.rom[COLOR_TABLE + area.colorId * 0xc], archive.rom[COLOR_TABLE + area.colorId * 0xc + 1], archive.rom[COLOR_TABLE + area.colorId * 0xc + 2]],
  };
  const primaryInstances: number[] = [], secondaryInstances: number[] = [], objectInstances: number[] = [];
  const backdropInstances: number[] = [], collisionInstances: number[] = [], waterInstances: number[] = [];
  level.layers!.push({ name: area.secondaryGeometry ? 'primary geometry' : 'main', kind: 'main', instances: primaryInstances, ...(area.secondaryGeometry ? { group: 'sections' } : {}) });
  if (area.secondaryGeometry) level.layers!.push({ name: 'secondary geometry', kind: 'main', instances: secondaryInstances, group: 'sections' });
  level.layers!.push({ name: 'objects', kind: 'objects', instances: objectInstances });
  const markerLayer = level.layers!.push({ name: 'unresolved actors', kind: 'markers', instances: [] }) - 1;

  const primary = decodeGeometry(archive, level, area.primaryGeometry, `${area.name} primary`);
  placeModel(level, primary, identityMatrix(), primaryInstances, `${area.name} primary`, { areaRecord: area.recordIndex, section: 'primary' });
  let secondaryFog: [number, number, number] | null = null;
  if (area.secondaryGeometry) {
    const secondary = decodeGeometry(archive, level, area.secondaryGeometry, `${area.name} secondary`);
    secondaryFog = secondary.fogColor;
    placeModel(level, secondary, identityMatrix(), secondaryInstances, `${area.name} secondary`, { areaRecord: area.recordIndex, section: 'secondary' });
  }
  const setup = archive.setup(area.setupId);
  appendObjects(archive, level, setup, objectInstances, markerLayer);
  expandBounds(level, [...primaryInstances, ...secondaryInstances, ...objectInstances]);

  appendCollision(archive, level, setup, collisionInstances, waterInstances);
  if (!level.bounds.min.every(Number.isFinite)) expandBounds(level, collisionInstances);
  if (!level.bounds.min.every(Number.isFinite)) {
    level.bounds = { min: [-100, -100, -100], max: [100, 100, 100] };
  }
  const center = [0, 1, 2].map((axis) => (level.bounds.min[axis] + level.bounds.max[axis]) / 2) as [number, number, number];
  const span = Math.max(100, ...[0, 1, 2].map((axis) => level.bounds.max[axis] - level.bounds.min[axis]));
  level.camera = cameraFromPaths(archive, setup, center, span);
  appendBackdrops(archive, level, area, backdropInstances, center, span);
  if (backdropInstances.length) level.layers!.push({ name: 'backdrops', kind: 'background', instances: backdropInstances });
  if (waterInstances.length) level.layers!.push({ name: 'water', kind: 'background', instances: waterInstances });
  level.layers!.push({ name: 'collision', kind: 'collision', instances: collisionInstances, visibleByDefault: false });

  const fc = primary.fogColor ?? secondaryFog;
  if (fc) {
    const special = area.world === 2 && area.stage === 3, min = special ? 102 : 920, max = special ? 1003 : 1000;
    level.fog = { color: fc, multiplier: 128000 / (max - min), offset: (500 - min) * 256 / (max - min), near: 10, far: 12800 };
  }
  // Keep key format facts visible in reports without inventing friendly names.
  level.meshes[0] && (level.meshes[0].info = { ...level.meshes[0].info, internalName: area.name,
    reachability: area.reachability, areaType: describeAreaType(area.areaType), backdropId: area.backdropId,
    backgroundColorId: area.colorId, musicId: area.musicId, setupId: `${area.setupId >>> 16}:${area.setupId & 0xffff}` });
  return level;
}
