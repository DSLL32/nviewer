// Vigilante 8 (USA, revision 0).
import type { Game, Level, LevelInfo } from '../types';
import { Vigilante8Fs } from './fs';
import { decodeVigilante8Level } from './level';
import { decodeVigilante8Music, listVigilante8Music } from './music';

const ARENAS = [
  ['SANDFACT', 'Sand Factory'],
  ['CANYNLND', 'Canyonlands'],
  ['CASNOCTY', 'Casino City'],
  ['HOOVRDAM', 'Hoover Dam'],
  ['OILFIELD', 'Oil Fields'],
  ['AIRGRAVE', 'Aircraft Graveyard'],
  ['SCRTBASE', 'Secret Base'],
  ['SKIRESRT', 'Ski Resort'],
  ['VALLYFRM', 'Valley Farms'],
  ['WILDWEST', 'Ghost Town'],
  ['DREAMLND', 'Super Dreamland 64'],
] as const;

const LEVELS: LevelInfo[] = ARENAS.map(([, name], index) => ({ index, name, kind: 'battle' }));

function loadLevel(fs: Vigilante8Fs, index: number): Level {
  const arena = ARENAS[index];
  if (!arena) throw new Error(`Invalid Vigilante 8 arena ${index}`);
  const level: Level = {
    info: LEVELS[index], id: `vigilante8-${arena[0].toLowerCase()}`,
    textures: [], meshes: [], instances: [], unplaced: [], layers: [],
    bounds: { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] },
  };
  decodeVigilante8Level(fs.file('TERRAIN', `${arena[0]}.EXP`), level);
  if (!level.bounds.min.every(Number.isFinite) || !level.bounds.max.every(Number.isFinite))
    throw new Error(`Vigilante 8 ${arena[1]} has no renderable scenery`);
  if (!level.camera) {
    const center: [number, number, number] = [0, 1, 2].map((axis) =>
      (level.bounds.min[axis] + level.bounds.max[axis]) / 2) as [number, number, number];
    const span = Math.max(...[0, 1, 2].map((axis) => level.bounds.max[axis] - level.bounds.min[axis]), 100);
    level.camera = {
      eye: [center[0], center[1] + span * 0.32, center[2] + span * 0.46],
      target: center,
      fovY: 60,
    };
  }
  return level;
}

export function openVigilante8(rom: Uint8Array): Game {
  const fs = new Vigilante8Fs(rom);
  return {
    id: 'vigilante8', title: 'Vigilante 8 (USA)', levels: LEVELS,
    loadLevel: (index) => loadLevel(fs, index),
    music: listVigilante8Music(rom),
    decodeMusic: (index) => decodeVigilante8Music(rom, index),
  };
}
