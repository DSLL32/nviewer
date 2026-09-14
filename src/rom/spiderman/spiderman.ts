// Spider-Man (USA): campaign, training/alternate/demo scenes and Sound Tools music.
import type { Game } from '../types';
import { SpiderManFs } from './fs';
import { SpiderManLevelSource } from './level';
import { spiderManMusic } from './music';

export function openSpiderMan(bytes: Uint8Array): Game {
  const fs = new SpiderManFs(bytes);
  const title = String.fromCharCode(...fs.rom.subarray(0x20, 0x34)).replace(/\0/g, '').trim();
  if (title !== 'SPIDERMAN') throw new Error(`invalid Spider-Man internal title ${JSON.stringify(title)}`);
  const source = new SpiderManLevelSource(fs), music = spiderManMusic(fs);
  const sidebarCount = source.levels.filter((level) => level.setupParent === undefined).length;
  if (sidebarCount !== 57) throw new Error(`internal Spider-Man sidebar table has ${sidebarCount} entries (expected 57)`);
  return {
    id: 'spiderman',
    title: 'Spider-Man',
    levels: source.levels,
    loadLevel: (index) => source.load(index),
    music: music.tracks,
    decodeMusic: music.decode,
  };
}
