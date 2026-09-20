import { decodeRows, ImFmt, ImSiz, Tlut } from '../texture';
import type { CameraView, Level, Texture } from '../types';
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

interface BackdropRecord {
  at: number;
  imageId: number;
  type: number;
  flags: number;
  colorId: number;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  speedX: number;
  speedY: number;
  texture: Texture;
}

function backdropTexture(archive: KirbyArchive, imageId: number): Texture | null {
  const extent = archive.member('image', imageId), rom = archive.rom;
  if (extent.end - extent.start < 0x10) return null;
  const fmt = rom[extent.start] as ImFmt, siz = rom[extent.start + 1] as ImSiz;
  const width = u16(rom, extent.start + 4), height = u16(rom, extent.start + 6);
  const data = extent.start + u32(rom, extent.start + 8), paletteAt = u32(rom, extent.start + 0xc);
  const bits = [4, 8, 16, 32][siz] ?? 0, bytes = Math.ceil(width * height * bits / 8);
  if (!width || !height || width > 1024 || height > 1024 || !bits || data < extent.start || data + bytes > extent.end) return null;
  const palette = fmt === ImFmt.CI && paletteAt >= 0x10 && extent.start + paletteAt < extent.end
    ? rom.subarray(extent.start + paletteAt, extent.end) : null;
  const rgba = decodeRows(rom, data, fmt, siz, width, height, palette, Tlut.Rgba16);
  const formatName = `${['RGBA', 'YUV', 'CI', 'IA', 'I'][fmt] ?? `fmt${fmt}`}${bits}${fmt === ImFmt.CI ? '/RGBA16' : ''}`;
  return { width, height, rgba, wrapS: 'clamp', wrapT: 'clamp', format: formatName,
    source: `backdrop image ${extent.bank}:${extent.index} ROM 0x${extent.start.toString(16)}` };
}

function backdropColor(rom: Uint8Array, id: number, offset: number): [number, number, number] {
  const at = COLOR_TABLE + id * 0xc + offset;
  return [rom[at] ?? 255, rom[at + 1] ?? 255, rom[at + 2] ?? 255];
}

function compositeBackdrop(archive: KirbyArchive, level: Level, area: AreaRecord): void {
  if (!area.backdropId) return;
  const pointer = u32(archive.rom, BACKDROP_TABLE + area.backdropId * 4);
  if (!pointer) return;
  const records: BackdropRecord[] = [];
  let at = pointer - OVL1_BIAS;
  for (let record = 0; record < 32 && at + 0x30 <= archive.rom.length && u32(archive.rom, at); record++, at += 0x30) {
    const imageId = u32(archive.rom, at), texture = backdropTexture(archive, imageId);
    if (!texture) continue;
    const sx = f32(archive.rom, at + 0x10), sy = f32(archive.rom, at + 0x14);
    records.push({ at, imageId, texture, type: u32(archive.rom, at + 4), flags: u16(archive.rom, at + 8),
      colorId: u16(archive.rom, at + 0xa), x: s16(archive.rom, at + 0xc), y: s16(archive.rom, at + 0xe),
      scaleX: Number.isFinite(sx) && sx > 0 ? sx : 1, scaleY: Number.isFinite(sy) && sy > 0 ? sy : 1,
      speedX: f32(archive.rom, at + 0x18), speedY: f32(archive.rom, at + 0x1c) });
  }
  if (!records.length) return;

  // The game feeds these records to its S2DEX screen-sprite path, clipped to
  // the gameplay safe area inside the 320x240 frame. Compose the initial
  // (unscrolled) frame so it stays screen-fixed while the viewer camera moves.
  const width = 320, height = 240, rgba = new Uint8Array(width * height * 4);
  const clear = level.clearColor ?? [0, 0, 0];
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = clear[0]; rgba[i * 4 + 1] = clear[1]; rgba[i * 4 + 2] = clear[2]; rgba[i * 4 + 3] = 255;
  }
  // The per-frame callback rephases Y from the live camera pitch. Preserve
  // the authored relative offsets but choose the runtime-verified static phase
  // with the first layer at the top of the viewer (and omit the native VI
  // safe-area border). M31SEASIDE01's 50/70/90 become 0/20/40, matching RAM-
  // selected gameplay while keeping the scrolling/parallax animation frozen.
  const phaseY = Math.min(...records.map((record) => record.y));
  for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
    const record = records[recordIndex], base = recordIndex === 0;
    const source = record.texture, repeatX = !!(record.flags & 0x105) || record.speedX !== 0;
    const repeatY = !!(record.flags & 0x200) || record.speedY !== 0;
    const prim = backdropColor(archive.rom, record.colorId, 0), env = backdropColor(archive.rom, record.colorId, 3);
    const originX = record.x, originY = record.y - phaseY;
    for (let y = 0; y < height; y++) {
      let sy = (y + 0.5 - originY) / record.scaleY;
      if (repeatY) sy = ((sy % source.height) + source.height) % source.height;
      else if (base) sy = Math.max(0, Math.min(source.height - 0.5, sy));
      else if (sy < 0 || sy >= source.height) continue;
      const sourceY = Math.min(source.height - 1, Math.floor(sy));
      for (let x = 0; x < width; x++) {
        let sx = (x + 0.5 - originX) / record.scaleX;
        if (repeatX) sx = ((sx % source.width) + source.width) % source.width;
        else if (base) sx = Math.max(0, Math.min(source.width - 0.5, sx));
        else if (sx < 0 || sx >= source.width) continue;
        const si = (sourceY * source.width + Math.min(source.width - 1, Math.floor(sx))) * 4;
        let r = source.rgba[si], g = source.rgba[si + 1], b = source.rgba[si + 2];
        if (record.flags & 0x40) {
          r = env[0] + (prim[0] - env[0]) * r / 255;
          g = env[1] + (prim[1] - env[1]) * g / 255;
          b = env[2] + (prim[2] - env[2]) * b / 255;
        } else if (record.flags & 0x80) {
          r = r * prim[0] / 255; g = g * prim[1] / 255; b = b * prim[2] / 255;
        }
        const alpha = record.flags & 0x20 ? source.rgba[si + 3] : 255, di = (y * width + x) * 4;
        rgba[di] = Math.round((r * alpha + rgba[di] * (255 - alpha)) / 255);
        rgba[di + 1] = Math.round((g * alpha + rgba[di + 1] * (255 - alpha)) / 255);
        rgba[di + 2] = Math.round((b * alpha + rgba[di + 2] * (255 - alpha)) / 255);
      }
    }
  }
  const description = records.map((record) => {
    const id = `${record.imageId >>> 16}:${record.imageId & 0xffff}`;
    return `${id}/type0x${record.type.toString(16)}/flags0x${record.flags.toString(16)}/ROM0x${record.at.toString(16)}`;
  }).join(', ');
  const texture = level.textures.push({ width, height, rgba, wrapS: 'clamp', wrapT: 'clamp',
    format: 'S2DEX composite', source: `backdrop ${area.backdropId}: ${description}` }) - 1;
  level.backdrop = { texture, u0: 0, v0: 0, u1: 1, v1: 1 };
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
  const collisionInstances: number[] = [], waterInstances: number[] = [];
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
  compositeBackdrop(archive, level, area);
  if (waterInstances.length) level.layers!.push({ name: 'water', kind: 'background', instances: waterInstances, visibleByDefault: false });
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
