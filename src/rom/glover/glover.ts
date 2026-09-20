import type { Game } from '../types';
import { gloverMusic } from '../music/glover';
import { GLOVER_LEVELS, loadGloverLevel } from './level';

const EXPECTED_SIZE = 0x800000;
const EXPECTED_CRC1 = 0x8e6e01ff;
const EXPECTED_CRC2 = 0xccb4f948;

export function openGlover(rom: Uint8Array): Game {
  const code = String.fromCharCode(...rom.subarray(0x3b, 0x3f));
  const view = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
  if (rom.length !== EXPECTED_SIZE || code !== 'NGVE' || rom[0x3f] !== 0 ||
      view.getUint32(0x10) !== EXPECTED_CRC1 || view.getUint32(0x14) !== EXPECTED_CRC2) {
    throw new Error('Unsupported Glover ROM: only the USA revision 0 release is supported.');
  }
  const music = gloverMusic(rom);
  return {
    id: 'glover',
    title: 'Glover (USA)',
    levels: GLOVER_LEVELS,
    loadLevel: (index) => loadGloverLevel(rom, index),
    music: music.tracks,
    decodeMusic: music.decode,
  };
}
