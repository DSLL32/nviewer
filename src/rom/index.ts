// Entry point: detect which supported game a ROM is and open it.
import { openBattleTanx } from './battletanx';
import { openBattleTanxGA } from './battletanxga';
import { openBomberman64 } from './bomberman/bm64';
import { openBomberman64SA } from './bomberman/bm64sa';
import { openBombermanHero } from './bomberman/bmhero';
import { LEVELS, loadLevel } from './level';
import { decodeRush2049Music, listRush2049Music } from './music/rush2049';
import { normalizeByteOrder, RushRom } from './rom';
import { openRush1 } from './rush1';
import type { Game } from './types';

export type * from './types';

export function openRom(bytes: Uint8Array): Game {
  const rom = normalizeByteOrder(bytes);
  const code = String.fromCharCode(...rom.subarray(0x3b, 0x3f));
  switch (code) {
    case 'NRUE': {
      const r = new RushRom(rom);
      return {
        id: 'rush2049',
        title: 'San Francisco Rush 2049',
        levels: LEVELS,
        loadLevel: (i) => loadLevel(r, i),
        music: listRush2049Music(r),
        decodeMusic: (i) => decodeRush2049Music(r, i),
      };
    }
    case 'NSFE':
      return openRush1(rom);
    case 'NBME':
      return openBomberman64(rom);
    case 'NBDE':
      return openBombermanHero(rom);
    case 'NBVE':
      return openBomberman64SA(rom);
    case 'NBXE':
      return openBattleTanx(rom);
    case 'NBQE':
      return openBattleTanxGA(rom);
    default:
      throw new Error(`Unsupported ROM (game code "${code.replace(/[^\x20-\x7e]/g, '?')}"). ` +
        'Supported: San Francisco Rush 2049 (U), San Francisco Rush: Extreme Racing (U), Bomberman 64 (U), ' +
        'Bomberman 64: The Second Attack! (U), Bomberman Hero (U), BattleTanx (U), BattleTanx: Global Assault (U).');
  }
}
