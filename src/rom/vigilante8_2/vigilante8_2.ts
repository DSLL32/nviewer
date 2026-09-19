// Vigilante 8: 2nd Offense (USA, revision 0).
import type { Game, Level, LevelInfo } from '../types';
import { Vigilante8SecondOffenseFs } from './fs';
import { decodeVigilante8SecondOffenseLevel } from './level';
import {
  decodeVigilante8SecondOffenseMusic,
  listVigilante8SecondOffenseMusic,
} from './music';

const ARENAS = [
  ['HARBOR', 'Pacific Harbor'],
  ['STEELMIL', 'Steel Mill'],
  ['BAYOU', 'Ghastly Bayou'],
  ['OLYMPIC', 'Winter Games'],
  ['NUCLEAR', 'Nuclear Plant'],
  ['LAUNCH', 'Launch Site'],
  ['ROUTE66', 'Meteor Crater'],
  ['OILFIELD', 'Alaskan Pipeline'],
] as const;

const LEVELS: LevelInfo[] = ARENAS.map(([, name], index) => ({ index, name, kind: 'battle' }));

function loadLevel(fs: Vigilante8SecondOffenseFs, index: number): Level {
  const arena = ARENAS[index];
  if (!arena) throw new Error(`Invalid Vigilante 8: 2nd Offense arena ${index}`);
  const level: Level = {
    info: LEVELS[index], id: `vigilante8-2-${arena[0].toLowerCase()}`,
    textures: [], meshes: [], instances: [], unplaced: [], layers: [],
    bounds: { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] },
  };
  decodeVigilante8SecondOffenseLevel(fs.file('LEVELS', `${arena[0]}.EXP`), level);
  if (!level.bounds.min.every(Number.isFinite) || !level.bounds.max.every(Number.isFinite))
    throw new Error(`Vigilante 8: 2nd Offense ${arena[1]} has no renderable scenery`);
  const center: [number, number, number] = [0, 1, 2].map((axis) =>
    (level.bounds.min[axis] + level.bounds.max[axis]) / 2) as [number, number, number];
  const span = Math.max(...[0, 1, 2].map((axis) => level.bounds.max[axis] - level.bounds.min[axis]), 100);
  level.camera = {
    eye: [center[0], center[1] + span * 0.32, center[2] + span * 0.46],
    target: center,
    fovY: 60,
  };
  return level;
}

export function openVigilante8SecondOffense(rom: Uint8Array): Game {
  const fs = new Vigilante8SecondOffenseFs(rom);
  return {
    id: 'vigilante8_2', title: 'Vigilante 8: 2nd Offense (USA)', levels: LEVELS,
    loadLevel: (index) => loadLevel(fs, index),
    music: listVigilante8SecondOffenseMusic(rom),
    decodeMusic: (index) => decodeVigilante8SecondOffenseMusic(rom, index),
  };
}
