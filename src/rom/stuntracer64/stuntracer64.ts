// Stunt Racer 64 USA rev 0: thirteen unique public physical environments.
import type { Game, Instance, Level, LevelInfo } from '../types';
import { StuntRom, u32 } from './fs';
import { decodeMaterials } from './material';
import { buildStuntMesh } from './geometry';
import { appendSceneryAndSky } from './scenery';
import { appendCollision } from './collision';
import { appendPaths } from './paths';
import { decodeStuntRacerMusic, listStuntRacerMusic } from './music';

const COURSES: [string, number, LevelInfo['kind']][] = [
  ['Soda Mountain', 8, 'race'], ['Giant Toys', 6, 'race'], ['Medieval Mayhem', 10, 'race'],
  ['Wild West Ruckus', 3, 'race'], ['House of Horrors', 9, 'race'], ['Creepy Carnie', 7, 'race'],
  ['Tacky Tiki', 5, 'race'], ['Nautical Adventure', 0, 'race'], ['Retro Metro', 2, 'race'],
  ['Planet X', 4, 'race'], ['Space Race', 1, 'race'], ['Stunt Bowl', 11, 'stunt'],
  ['Halfpipe', 12, 'stunt'],
];
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

const LEVELS: LevelInfo[] = COURSES.map(([name, , kind], index) => ({ index, name, kind }));

function updateBounds(level: Level, indices: number[]): void {
  for (const i of indices) {
    const instance: Instance = level.instances[i], mesh = level.meshes[instance.mesh], m = instance.matrix;
    for (const batch of mesh.batches) {
      const p = batch.positions;
      for (let j = 0; j < p.length; j += 3) {
        const x = m[0] * p[j] + m[4] * p[j + 1] + m[8] * p[j + 2] + m[12];
        const y = m[1] * p[j] + m[5] * p[j + 1] + m[9] * p[j + 2] + m[13];
        const z = m[2] * p[j] + m[6] * p[j + 1] + m[10] * p[j + 2] + m[14];
        level.bounds.min[0] = Math.min(level.bounds.min[0], x);
        level.bounds.min[1] = Math.min(level.bounds.min[1], y);
        level.bounds.min[2] = Math.min(level.bounds.min[2], z);
        level.bounds.max[0] = Math.max(level.bounds.max[0], x);
        level.bounds.max[1] = Math.max(level.bounds.max[1], y);
        level.bounds.max[2] = Math.max(level.bounds.max[2], z);
      }
    }
  }
}

function loadLevel(archive: StuntRom, index: number): Level {
  const course = COURSES[index];
  if (!course) throw new Error(`Invalid Stunt Racer 64 level ${index}`);
  const [name, internalId] = course, map = archive.map(internalId), primary = map.primary;
  const level: Level = {
    info: LEVELS[index], id: `stuntracer64-${internalId}`, textures: [], meshes: [], instances: [], unplaced: [],
    bounds: { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }, layers: [],
    // This RGB participates in the sky/atmosphere calculation; it is a suitable
    // static clear approximation, not a claim of linear distance fog.
    clearColor: [primary[0x3a0], primary[0x3a1], primary[0x3a2]],
  };
  const materials = decodeMaterials(primary, 0x11c, level.textures);
  const trackInstances: number[] = [];
  for (let i = 0; i < map.count('mesh'); i++) {
    const file = map.load('mesh', i), { metadataOffset, start } = map.entry('mesh', i);
    const geometryMeta = u32(file, metadataOffset + 8);
    const view = new DataView(file.buffer, file.byteOffset + metadataOffset + 0x0c, 12);
    const origin: [number, number, number] = [view.getInt32(0) / 2048, view.getInt32(4) / 2048, view.getInt32(8) / 2048];
    const mesh = buildStuntMesh(file, geometryMeta, materials, `Track mesh ${i + 1}`, origin);
    mesh.info = { ...mesh.info, internalMap: internalId, meshFile: i, rom: `0x${start.toString(16)}` };
    const meshIndex = level.meshes.push(mesh) - 1;
    trackInstances.push(level.instances.push({
      name: mesh.name, mesh: meshIndex, matrix: IDENTITY.slice(),
      info: { internalMap: internalId, meshFile: i, rom: `0x${start.toString(16)}` },
    }) - 1);
  }
  level.layers!.push({ name: 'track', kind: 'main', instances: trackInstances });
  appendSceneryAndSky(primary, materials, level);
  // Only render geometry defines the default frame. Collision and route data
  // can extend beyond it and are added after bounds are established.
  updateBounds(level, level.layers!.flatMap((layer) => layer.kind === 'main' || layer.kind === 'objects' ? layer.instances : []));
  appendCollision(map, level);
  appendPaths(map, level);
  if (!level.bounds.min.every(Number.isFinite) || !level.bounds.max.every(Number.isFinite))
    throw new Error(`Stunt Racer ${name} has no renderable course bounds`);
  const center: [number, number, number] = [0, 1, 2].map((axis) => (level.bounds.min[axis] + level.bounds.max[axis]) / 2) as [number, number, number];
  const size = [0, 1, 2].map((axis) => level.bounds.max[axis] - level.bounds.min[axis]);
  const span = Math.max(...size, 100);
  level.camera = { eye: [center[0], center[1] + span * 0.36, center[2] + span * 0.48], target: center, fovY: 89 };
  return level;
}

export function openStuntRacer64(rom: Uint8Array): Game {
  const archive = new StuntRom(rom);
  return {
    id: 'stuntracer64', title: 'Stunt Racer 64 (USA)', levels: LEVELS,
    loadLevel: (index) => loadLevel(archive, index),
    music: listStuntRacerMusic(rom), decodeMusic: (index) => decodeStuntRacerMusic(rom, index),
  };
}
