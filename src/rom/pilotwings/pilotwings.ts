// Pilotwings 64 (U/E/J): FORM/UVRM assets, all 61 task scenes, and the libultra soundtrack.
import type { Game } from '../types';
import { buildTaskLevel } from './environment';
import { PwRom } from './fs';
import { pilotwingsMusic } from './music';
import { parseTask, PwData } from './objects';
import { SUPPORTED_CODES, TASK_NAMES, taskLevelInfo } from './tables';

export function openPilotwings(bytes: Uint8Array): Game {
  const rom = new PwRom(bytes);
  if (!SUPPORTED_CODES.has(rom.gameCode)) throw new Error(`unsupported Pilotwings 64 ROM code ${rom.gameCode}`);
  if (rom.rom.length !== 0x800000) throw new Error(`unsupported Pilotwings 64 ROM size 0x${rom.rom.length.toString(16)} (expected 8 MiB)`);
  if (rom.rom[0x3f] !== 0) throw new Error(`unsupported Pilotwings 64 revision ${rom.rom[0x3f]} (expected revision 0)`);

  const data = new PwData(rom);
  const tasks = Array.from({ length: 61 }, (_, index) => parseTask(data, index));
  const levels = tasks.map((task) => taskLevelInfo(task.index, TASK_NAMES[task.index] ?? task.jptx, task.comm.veh, task.comm.cls, task.comm.test));
  const music = pilotwingsMusic(rom.rom);

  return {
    id: 'pilotwings64',
    title: 'Pilotwings 64',
    levels,
    loadLevel(index) {
      if (!Number.isInteger(index) || index < 0 || index >= tasks.length) throw new Error(`invalid Pilotwings 64 level ${index}`);
      const level = buildTaskLevel(data, index);
      level.info = levels[index];
      return level;
    },
    music: music.tracks,
    decodeMusic: music.decode,
  };
}
