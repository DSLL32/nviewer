// A Bug's Life uses Software Creations' newer Sound Tools/libmus player. The
// songs and pointer bank live in the path archive, while the raw VADPCM sample
// bank follows the archive at a region-specific ROM address.
import type { DecodedMusic, MusicTrack } from '../types';
import { parseLibmusBank, renderLibmusSong, type Wave } from '../music/libmus';
import { openBugsLifeArchive, type BugsLifeArchive } from './archive';

const MASTER_VOLUME = 0x3fff;

interface SongDef {
  name: string;
  path: string;
  loop: readonly [start: number, end: number] | null;
}

// These are the twenty unique shipped files. The game's numeric selector also
// aliases bugs15 as request 16 and bugsa as request 22; those aliases are not
// duplicated in the viewer.
const SONGS: readonly SongDef[] = [
  { name: 'Ant Island', path: 'tunes/bugs01.bin', loop: [0, 3382272] },
  { name: 'Council Chamber', path: 'tunes/bugs02.bin', loop: [5021786, 8193400] },
  { name: 'Tunnels', path: 'tunes/bugs03.bin', loop: [5400757, 10780610] },
  { name: 'City Entrance', path: 'tunes/bugs04.bin', loop: [5100363, 9150575] },
  { name: 'City Square', path: 'tunes/bugs05.bin', loop: [5400384, 10125876] },
  { name: 'Cliffside', path: 'tunes/bugs06.bin', loop: [4487509, 9115379] },
  { name: 'Clover Forest', path: 'tunes/bugs07.bin', loop: [5526105, 10420784] },
  { name: 'Riverbed Flight', path: 'tunes/bugs08.bin', loop: [5329641, 10137341] },
  { name: 'Anthill Part Two', path: 'tunes/bugs09.bin', loop: [5153938, 9483070] },
  { name: 'Riverbed Canyon', path: 'tunes/bugs10.bin', loop: [5431032, 10473979] },
  { name: 'Birdnest', path: 'tunes/bugs11.bin', loop: [4121059, 9047300] },
  { name: 'The Tree', path: 'tunes/bugs12.bin', loop: [5098963, 9380018] },
  { name: 'Battle Arena', path: 'tunes/bugs13.bin', loop: [5863679, 10673948] },
  { name: 'Bug Bar', path: 'tunes/bugs14.bin', loop: [0, 5258376] },
  { name: 'Canyon Showdown', path: 'tunes/bugs15.bin', loop: [5163044, 7871871] },
  { name: 'Death', path: 'tunes/dead.bin', loop: null },
  { name: 'Token', path: 'tunes/bugtoken.bin', loop: null },
  { name: 'Title', path: 'tunes/title.bin', loop: [0, 224971] },
  { name: 'Unidentified Context', path: 'tunes/bugsb.bin', loop: [2603065, 4840664] },
  { name: 'Training', path: 'tunes/bugsa.bin', loop: [0, 2722773] },
];

interface SampleBankRange {
  start: number;
  length: number;
}

// Each endpoint is the greatest wave base + encoded length declared by that
// build's bugs.ptr. French, German and Italian releases carry localized banks.
const SAMPLE_BANKS: Record<BugsLifeArchive['version']['code'], SampleBankRange> = {
  NBYE: { start: 0x8d1800, length: 0x2dc060 },
  NBYP: { start: 0x8c4540, length: 0x2dc060 },
  NBYF: { start: 0x8daa80, length: 0x2b03c0 },
  NBYD: { start: 0x8dac00, length: 0x2affaf },
  NBYI: { start: 0x8e4c40, length: 0x2a60ba },
};

interface PreparedBank {
  bytes: Uint8Array;
  waves: Wave[];
}

interface CachedMusic {
  bank?: PreparedBank;
  songs: Map<number, Uint8Array>;
}

const musicCache = new WeakMap<Uint8Array, CachedMusic>();

function cacheFor(rom: Uint8Array): CachedMusic {
  let cached = musicCache.get(rom);
  if (!cached) {
    cached = { songs: new Map() };
    musicCache.set(rom, cached);
  }
  return cached;
}

function hasAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset < 0 || offset + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  return true;
}

function prepareBank(archive: BugsLifeArchive, cached: CachedMusic): PreparedBank {
  if (cached.bank) return cached.bank;

  const pointerBank = archive.file('tunes/bugs.ptr');
  const range = SAMPLE_BANKS[archive.version.code];
  if (!hasAscii(archive.romBytes, range.start, 'N64 WaveTables '))
    throw new Error(`A Bug's Life ${archive.version.region} sample bank was not found`);
  if (range.start + range.length > archive.romBytes.length)
    throw new Error(`A Bug's Life ${archive.version.region} sample bank exceeds the ROM`);

  // parseLibmusBank uses one address space for pointer and sample data. Keep
  // that API stable and assemble the two shipped regions once per source ROM.
  const bytes = new Uint8Array(pointerBank.length + range.length);
  bytes.set(pointerBank);
  bytes.set(archive.romBytes.subarray(range.start, range.start + range.length), pointerBank.length);
  const waves = parseLibmusBank(bytes, 0, pointerBank.length);
  for (const [index, wave] of waves.entries()) {
    if (wave.base < pointerBank.length || wave.base + wave.len > bytes.length)
      throw new Error(`A Bug's Life sample ${index} exceeds the ${archive.version.region} sample bank`);
  }
  cached.bank = { bytes, waves };
  return cached.bank;
}

export function bugsLifeMusic(rom: Uint8Array): { tracks: MusicTrack[]; decode(index: number): DecodedMusic } {
  const archive = openBugsLifeArchive(rom);
  const cached = cacheFor(rom);
  const tracks = SONGS.map(({ name }, index) => ({ index, name: `${String(index).padStart(2, '0')} ${name}` }));

  return {
    tracks,
    decode(index: number) {
      const def = SONGS[index];
      if (!Number.isInteger(index) || !def) throw new Error(`No A Bug's Life music track ${index}`);
      const bank = prepareBank(archive, cached);
      let song = cached.songs.get(index);
      if (!song) {
        song = archive.file(def.path);
        cached.songs.set(index, song);
      }
      return renderLibmusSong(bank.bytes, bank.waves, song, {
        masterVolume: MASTER_VOLUME,
        reverb: true,
        loopSamples: def.loop ?? undefined,
      });
    },
  };
}
