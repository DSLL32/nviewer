// Vigilante 8: 2nd Offense (USA) music: 36 compressed libmus 0x215
// sequences and the 86-entry Nintendo Sound Tools music bank.
import type { DecodedMusic, MusicTrack } from '../types';
import { parseLibmusBank, renderLibmusSong, type Wave } from '../music/libmus';
import { Vigilante8SecondOffenseFs } from './fs';

const MUSIC_CONTROL_BANK = 0x592c0;
const MUSIC_SAMPLE_BANK = 0x737c0;
const MASTER_VOLUME = 0x7fff;

const STEMS = [
  ['THEME', 'V8 Theme'],
  ['BOOGIE', 'Boogie Fever'],
  ['NINA', 'OK to be Loco'],
  ['SHEILA', 'Rollerqueen'],
  ['CONVOY', 'Convoy Country'],
  ['TORQUE', "Gimme Mo' Torque"],
  ['CHASSY', "Chassey's Chase"],
  ['FAST', 'Go Team FAST'],
  ['CLYDE', 'Obsession in D-'],
  ['ASTRO', 'Stargazers'],
  ['CYBORG', 'Future Two'],
] as const;

const SONGS = [
  ...STEMS.map(([stem, title]) => ({ file: `${stem}.BIN`, title })),
  ...STEMS.map(([stem, title]) => ({ file: `D_${stem}.BIN`, title: `D result — ${title}` })),
  ...STEMS.map(([stem, title]) => ({ file: `V_${stem}.BIN`, title: `V result — ${title}` })),
  { file: 'E_VIG.BIN', title: 'Vigilantes ending' },
  { file: 'E_COY.BIN', title: 'Coyotes ending' },
  { file: 'E_DRF.BIN', title: 'Drifters ending' },
] as const;

interface MusicCache {
  fs: Vigilante8SecondOffenseFs;
  waves: Wave[];
  songs: Map<number, Uint8Array>;
}

const cache = new WeakMap<Uint8Array, MusicCache>();

function music(rom: Uint8Array): MusicCache {
  let value = cache.get(rom);
  if (!value) {
    value = {
      fs: new Vigilante8SecondOffenseFs(rom),
      waves: parseLibmusBank(rom, MUSIC_CONTROL_BANK, MUSIC_SAMPLE_BANK),
      songs: new Map(),
    };
    cache.set(rom, value);
  }
  return value;
}

export function listVigilante8SecondOffenseMusic(rom: Uint8Array): MusicTrack[] {
  music(rom);
  return SONGS.map((song, index) => ({
    index,
    name: `${String(index).padStart(2, '0')} ${song.title}`,
  }));
}

export function decodeVigilante8SecondOffenseMusic(rom: Uint8Array, index: number): DecodedMusic {
  if (!Number.isInteger(index) || index < 0 || index >= SONGS.length)
    throw new Error(`No Vigilante 8: 2nd Offense music track ${index}`);

  const data = music(rom);
  let song = data.songs.get(index);
  if (!song) {
    song = data.fs.file('MUSIC', SONGS[index].file);
    data.songs.set(index, song);
  }
  return renderLibmusSong(rom, data.waves, song, {
    masterVolume: MASTER_VOLUME,
    reverb: false,
  });
}
