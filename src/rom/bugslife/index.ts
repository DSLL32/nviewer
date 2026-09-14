// A Bug's Life (U/E/F/G/I): seventeen stages and the Sound Tools/libmus soundtrack.
import type { Game } from '../types';
import { openBugsLifeArchive } from './archive';
import { BUGSLIFE_LEVELS, loadBugsLifeLevel } from './level';
import { bugsLifeMusic } from './music';

const ROM_SIZE = 0xc00000;

export function openBugsLife(rom: Uint8Array): Game {
  if (rom.length !== ROM_SIZE)
    throw new Error(`unsupported A Bug's Life ROM size 0x${rom.length.toString(16)} (expected 12 MiB)`);

  const dv = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
  if (dv.getUint32(0) !== 0x80371240)
    throw new Error(`A Bug's Life ROM must be normalized to big-endian byte order`);

  if (rom[0x3f] !== 0)
    throw new Error(`unsupported A Bug's Life revision ${rom[0x3f]} (expected revision 0)`);

  const title = String.fromCharCode(...rom.subarray(0x20, 0x34)).replace(/\0/g, '').trim();
  if (title !== "A Bug's Life")
    throw new Error(`invalid A Bug's Life internal title ${JSON.stringify(title)}`);

  // The archive owns the single authoritative code/CRC/manifest profile table.
  const profile = openBugsLifeArchive(rom).version;

  if (BUGSLIFE_LEVELS.length !== 17)
    throw new Error(`internal A Bug's Life level table has ${BUGSLIFE_LEVELS.length} entries (expected 17)`);
  const music = bugsLifeMusic(rom);
  return {
    id: 'bugslife',
    title: `A Bug's Life (${profile.region})`,
    levels: BUGSLIFE_LEVELS,
    loadLevel(index) {
      if (!Number.isInteger(index) || index < 0 || index >= BUGSLIFE_LEVELS.length)
        throw new Error(`invalid A Bug's Life level ${index}`);
      return loadBugsLifeLevel(rom, index);
    },
    music: music.tracks,
    decodeMusic: music.decode,
  };
}
