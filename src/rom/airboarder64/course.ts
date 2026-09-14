import { fogPosition, meshFromBatches } from '../bomberman/common';
import { runDisplayList, type DlLighting } from '../displaylist';
import type { Batch, CameraView, Instance, LevelLayer, Mesh, Texture } from '../types';
import type { AirBoarderRom } from './archive';
import { addPlacementObjects, type PlacementPreset } from './objects';
import { airBoarderCollision } from './collision';

type V3 = [number, number, number];
const IDENTITY = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const hex = (n: number) => `0x${n.toString(16)}`;

export const COURSE_NAMES = ['Tutorial', 'Green Park', 'Lost Forest', "Snow Festival '64", 'Sunset Island', 'Giant House'] as const;
export const COURSE_CAMERAS: readonly CameraView[] = [
  { eye: [747.881, 18.841, 4207.749], target: [750, 12, 4170], fovY: 65 },
  { eye: [-999.995, 316.274, -1033.936], target: [-1000, 312, -1000], fovY: 65 },
  { eye: [-1823.807, 1026.259, -4500], target: [-1790, 1022, -4500], fovY: 65 },
  { eye: [1533.807, 16.259, 50], target: [1500, 12, 50], fovY: 65 },
  { eye: [2103.807, 86.259, 2450], target: [2070, 82, 2450], fovY: 65 },
  { eye: [36.193, 704.259, 220], target: [70, 700, 220], fovY: 65 },
];

interface CourseHeader {
  base: number;
  nx: number;
  nz: number;
  ambient: [number, number, number];
  directional: [number, number, number];
  direction: V3;
  fog: [number, number, number];
  far: number;
  split: number;
  textureBank: number;
  vertexBanks: [number, number];
  lists: [(number | null)[], (number | null)[]];
  collisionVertexBank: number;
  collisionCells: (number | null)[];
}

function parseHeader(data: Uint8Array, base: number, name: string): CourseHeader {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (base < 0 || base + 0x2c > data.length) throw new Error(`${name}: course header ${hex(base)} is outside archive`);
  const nx = dv.getUint16(base), nz = dv.getUint16(base + 2), cells = nx * nz;
  if (!nx || !nz || nx > 64 || nz > 64) throw new Error(`${name}: invalid course grid ${nx}x${nz}`);
  const relative = (at: number): number => {
    const value = dv.getUint32(at), result = base + value;
    if (!value || result < 0 || result >= data.length) throw new Error(`${name}: invalid relative pointer ${hex(value)} at ${hex(at)}`);
    return result;
  };
  const table = (at: number): (number | null)[] => Array.from({ length: cells }, (_, i) => {
    const value = dv.getUint32(at + i * 4);
    if (!value) return null;
    if (base + value + 8 > data.length) throw new Error(`${name}: cell pointer ${hex(value)} is outside archive`);
    return value;
  });
  const grid0 = base + 0x2c, grid1 = grid0 + cells * 4, bounds = grid1 + cells * 4;
  const collisionRoot = bounds + cells * 12, collisionCells = collisionRoot + 4;
  if (collisionCells + cells * 4 > data.length) throw new Error(`${name}: course header tables exceed archive`);
  return {
    base, nx, nz,
    ambient: [data[base + 4], data[base + 5], data[base + 6]],
    directional: [data[base + 7], data[base + 8], data[base + 9]],
    direction: [dv.getInt8(base + 10), dv.getInt8(base + 11), dv.getInt8(base + 12)],
    fog: [data[base + 13], data[base + 14], data[base + 15]],
    far: dv.getUint16(base + 16), split: dv.getUint16(base + 18),
    textureBank: relative(base + 0x20),
    vertexBanks: [relative(base + 0x24), relative(base + 0x28)],
    lists: [table(grid0), table(grid1)],
    collisionVertexBank: relative(collisionRoot), collisionCells: table(collisionCells),
  };
}

function lightingOf(h: CourseHeader): DlLighting {
  const n = Math.hypot(...h.direction) || 1;
  return {
    ambient: h.ambient,
    lights: [{ color: h.directional, dir: [h.direction[0] / n, h.direction[1] / n, h.direction[2] / n] }],
  };
}

function visibleMesh(data: Uint8Array, h: CourseHeader, name: string, textures: Texture[], textureKeys: Map<string, number>): Mesh {
  const batches: Batch[] = [], light = lightingOf(h);
  for (let pass = 0; pass < 2; pass++) for (const [cell, relative] of h.lists[pass].entries()) {
    if (relative === null) continue;
    const vertexBank = h.vertexBanks[pass];
    const resolve = (address: number): number => {
      const segment = address >>> 24, offset = address & 0xffffff;
      if (segment === 2) return vertexBank + offset;
      if (segment === 3) return h.textureBank + offset;
      // The top-level cell pointer is already an offset in the decoded archive.
      if (address < data.length) return address;
      return -1;
    };
    batches.push(...runDisplayList({
      buf: data, ucode: 'f3dex', resolve, resolveImage: resolve,
      textures, textureKeys, keyPrefix: `${h.base.toString(16)}/`,
      vertexScale: 1, mirrorX: false,
      // Pass 0 follows the main-world setup at J ROM 0x845e0: authored
      // vertex RGBA, no lighting. Pass 1 follows the cell/material setup at
      // 0x84698: Lights1 shading and threshold alpha compare for CI edges.
      geometryMode: pass === 0 ? 0x00812205 : 0x00032205,
      renderMode: pass === 0 ? 0xc8113078 : 0x00552078,
      alphaCompare: pass === 0 ? 0 : 1,
      textureScale: [0.5, 0.5],
      textureScaleAtVertex: true,
      otherModeH: pass === 0 ? 0x00108000 : 0x00008000,
      combineMode: pass === 0 ? [0xfc127fff, 0xfffff238] : [0xfc127e24, 0xfffff3f9],
      lighting: light, lightingPresets: [light], combiner: true,
    }, h.base + relative));
    void cell;
  }
  const mesh = meshFromBatches(name, batches);
  mesh.info = {
    header: hex(h.base), grid: `${h.nx}x${h.nz}`, textureBank: hex(h.textureBank),
    vertexBank0: hex(h.vertexBanks[0]), vertexBank1: hex(h.vertexBanks[1]),
    displayLists: h.lists[0].filter((p) => p !== null).length + h.lists[1].filter((p) => p !== null).length,
    triSource: 'offset in decoded course archive',
  };
  return mesh;
}

export interface CourseBuild {
  textures: Texture[];
  meshes: Mesh[];
  instances: Instance[];
  layers: LevelLayer[];
  clearColor: [number, number, number];
  far: number;
  lightingName: string;
}

export function buildAirBoarderCourse(rom: AirBoarderRom, course: number, preset: PlacementPreset): CourseBuild {
  const name = COURSE_NAMES[course];
  if (!name) throw new Error(`invalid Air Boarder course ${course}`);
  const archiveId = rom.version.courseIds[course], data = rom.file(archiveId), headers = rom.version.courseHeaders[course].map((at, area) => parseHeader(data, at, `${name} area ${area + 1}`));
  const textures: Texture[] = [], meshes: Mesh[] = [], instances: Instance[] = [], layers: LevelLayer[] = [], textureKeys = new Map<string, number>();
  const collisionInstances = new Map<string, number[]>();
  for (const [area, h] of headers.entries()) {
    const suffix = headers.length > 1 ? ` area ${area + 1}` : '';
    const mesh = meshes.push(visibleMesh(data, h, `${name}${suffix}`, textures, textureKeys)) - 1;
    const instance = instances.push({ name: `${name}${suffix}`, mesh, matrix: IDENTITY(), info: { archive: archiveId, header: hex(h.base), area } }) - 1;
    layers.push({ name: headers.length > 1 ? `area ${area + 1}` : 'course', kind: 'main', instances: [instance], ...(headers.length > 1 ? { group: 'areas' } : {}) });

    const collisionMesh = meshes.push(airBoarderCollision(data, { header: h.base, vertexBank: h.collisionVertexBank, cells: h.collisionCells }, `${name}${suffix} collision`)) - 1;
    const collisionInstance = instances.push({ name: `${name}${suffix} collision`, mesh: collisionMesh, matrix: IDENTITY(), noFog: true, info: { archive: archiveId, header: hex(h.base), area } }) - 1;
    const key = headers.length > 1 ? `area ${area + 1} collision` : 'collision';
    collisionInstances.set(key, [collisionInstance]);
  }
  addPlacementObjects(rom, course, preset, textures, meshes, instances, layers);
  for (const [name, indices] of collisionInstances) layers.push({ name, kind: 'collision', instances: indices, visibleByDefault: false, ...(headers.length > 1 ? { group: 'collision' } : {}) });
  const h = headers[0];
  return { textures, meshes, instances, layers, clearColor: h.fog, far: h.far, lightingName: 'Course lighting' };
}

export function environmentForCourse(course: number, built: CourseBuild) {
  return {
    clearColor: built.clearColor,
    fog: fogPosition(996, 1000, built.clearColor, 10, built.far),
    camera: COURSE_CAMERAS[course],
    lighting: { presets: [built.lightingName], default: 0 },
  };
}
