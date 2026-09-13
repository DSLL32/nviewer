// Off Road Challenge (U/E): nine static courses and the WESS soundtrack.
import type { Game } from '../types';
import { OffroadRom } from './fs';
import { loadOffroadLevel, OFFROAD_LEVELS } from './level';
import { offRoadMusic } from './music';

export function openOffRoadChallenge(bytes: Uint8Array): Game {
  const rom = new OffroadRom(bytes);
  const music = offRoadMusic(rom.rom);
  return {
    id: 'offroadchallenge',
    title: `Off Road Challenge (${rom.version.region === 'US' ? 'U' : 'E'})`,
    levels: OFFROAD_LEVELS,
    loadLevel: (index) => loadOffroadLevel(rom, index),
    music: music.tracks,
    decodeMusic: music.decode,
  };
}
