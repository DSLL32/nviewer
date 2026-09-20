import type { Game } from '../types';
import { KirbyArchive } from './fs';
import { loadKirbyLevel } from './level';
import { kirby64Music } from './music';

export function openKirby64(rom: Uint8Array): Game {
  const archive = new KirbyArchive(rom);
  const music = kirby64Music(rom);
  return {
    id: 'kirby64',
    title: 'Kirby 64: The Crystal Shards (USA)',
    levels: archive.areas.map((area) => area.info),
    loadLevel: (index) => loadKirbyLevel(archive, index),
    music: music.tracks,
    decodeMusic: music.decode,
  };
}
