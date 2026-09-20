import type { Game } from '../types';
import { JfgArchive } from './fs';
import { loadJfgLevel } from './level';
import { jetForceGeminiMusic } from './music';

const EXPECTED_SIZE = 0x02000000;
const EXPECTED_CRC1 = 0x8a6009b6;
const EXPECTED_CRC2 = 0x94ace150;

export function openJetForceGemini(rom: Uint8Array): Game {
  const code = String.fromCharCode(...rom.subarray(0x3b, 0x3f));
  const view = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
  if (rom.length !== EXPECTED_SIZE || code !== 'NJFE' || rom[0x3f] !== 0 ||
      view.getUint32(0x10) !== EXPECTED_CRC1 || view.getUint32(0x14) !== EXPECTED_CRC2) {
    throw new Error('Unsupported Jet Force Gemini ROM: only the USA revision 0 release is supported.');
  }

  const archive = new JfgArchive(rom);
  const music = jetForceGeminiMusic(rom);
  return {
    id: 'jetforcegemini',
    title: 'Jet Force Gemini (USA)',
    levels: archive.levels,
    loadLevel: (index) => loadJfgLevel(archive, index),
    music: music.tracks,
    decodeMusic: music.decode,
  };
}
