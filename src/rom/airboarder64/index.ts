// Air Boarder 64 (J/E): six course environments, their setups, and the old-libmus soundtrack.
import type { Game } from '../types';
import { AIRBOARDER_LEVELS, loadAirBoarderLevel } from './level';
import { airBoarderMusic } from './music';

const ROM_SIZE = 0x800000;

export function openAirBoarder64(rom: Uint8Array): Game {
  const code = String.fromCharCode(...rom.subarray(0x3b, 0x3f));
  if (code !== 'NABJ' && code !== 'NABP') throw new Error(`unsupported Air Boarder 64 ROM code ${code}`);
  if (rom.length !== ROM_SIZE)
    throw new Error(`unsupported Air Boarder 64 ROM size 0x${rom.length.toString(16)} (expected 8 MiB)`);
  if (rom[0x3f] !== 0)
    throw new Error(`unsupported Air Boarder 64 revision ${rom[0x3f]} (expected revision 0)`);

  const music = airBoarderMusic(rom);
  return {
    id: 'airboarder64',
    title: `Air Boarder 64 (${code === 'NABJ' ? 'J' : 'E'})`,
    levels: AIRBOARDER_LEVELS,
    loadLevel: (index) => loadAirBoarderLevel(rom, index),
    music: music.tracks,
    decodeMusic: music.decode,
  };
}
