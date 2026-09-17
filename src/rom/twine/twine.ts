import type { Game } from '../types';
import { decodeLevelLayers, LEVELS, TwineRom } from './level';
import { decodeTwineMusic, listTwineMusic } from './music';

export function openTwine(rom: Uint8Array): Game {
  const archive = new TwineRom(rom);
  // The public level index is a sidebar slot; archive entry ids are deliberately sparse.
  const levels = LEVELS.map((entry, index) => ({ ...entry, index }));
  return {
    id: 'twine',
    title: `007: The World Is Not Enough (${archive.region})`,
    levels,
    music: listTwineMusic(rom),
    decodeMusic: (index) => decodeTwineMusic(rom, index),
    loadLevel(index) {
      const entry = LEVELS[index];
      if (!entry) throw new Error(`TWINE level ${index} is not selectable`);
      const { level, stats } = decodeLevelLayers(archive, entry.index);
      if (stats.failures.length) throw new Error(`TWINE ${level.info.name}: ${stats.failures.slice(0, 8).join('; ')}`);
      level.info = levels[index];
      return level;
    },
  };
}
