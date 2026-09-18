// Vigilante 8 (USA) music: fifteen compressed libmus 0x215 sequences and the
// first of the ROM's two Nintendo Sound Tools pointer/sample-bank pairs.
import type { DecodedMusic, MusicTrack } from '../types';
import { parseLibmusBank, renderLibmusSong, type Wave } from '../music/libmus';
import { Vigilante8Fs } from './fs';

const MUSIC_CONTROL_BANK = 0x50a30;
const MUSIC_SAMPLE_BANK = 0x65360;

// The sequence names are the archive's names. Mixer volume and reverb have not
// been measured in-game, so the adapter uses a neutral, dry preview rather than
// guessing game-specific settings.
const MASTER_VOLUME = 0x7fff;

const SONGS = [
  'VIGWIN.BIN',
  'VIGLOSE.BIN',
  'COYWIN.BIN',
  'COYLOSE.BIN',
  'ENDVIG.BIN',
  'ENDCOY.BIN',
  'LOGO.BIN',
  'TITLE2.BIN',
  'V8BAND.BIN',
  'V8FUNK.BIN',
  'V8SONG1A.BIN',
  'V8SONG2.BIN',
  'V8THEME.BIN',
  'V8TOP.BIN',
  'HAPPY.BIN',
] as const;

const DISPLAY_NAMES = [
  'Vigilantes Win',
  'Vigilantes Lose',
  'Coyotes Win',
  'Coyotes Lose',
  'Vigilantes Ending',
  'Coyotes Ending',
  'Logo',
  'Title',
  'V8 Band',
  'V8 Funk',
  'V8 Song 1A',
  'V8 Song 2',
  'V8 Theme',
  'V8 Top',
  'Happy',
] as const;

interface MusicCache {
  fs: Vigilante8Fs;
  waves: Wave[];
  songs: Map<number, Uint8Array>;
}

const cache = new WeakMap<Uint8Array, MusicCache>();

function music(rom: Uint8Array): MusicCache {
  let value = cache.get(rom);
  if (!value) {
    value = {
      fs: new Vigilante8Fs(rom),
      waves: parseLibmusBank(rom, MUSIC_CONTROL_BANK, MUSIC_SAMPLE_BANK),
      songs: new Map(),
    };
    cache.set(rom, value);
  }
  return value;
}

export function listVigilante8Music(rom: Uint8Array): MusicTrack[] {
  // Constructing the filesystem also validates that this is the supported ROM
  // and that its complete embedded directory is structurally sound.
  music(rom);
  return DISPLAY_NAMES.map((name, index) => ({
    index,
    name: `${String(index).padStart(2, '0')} ${name}`,
  }));
}

export function decodeVigilante8Music(rom: Uint8Array, index: number): DecodedMusic {
  if (!Number.isInteger(index) || index < 0 || index >= SONGS.length)
    throw new Error(`No Vigilante 8 music track ${index}`);

  const data = music(rom);
  let song = data.songs.get(index);
  if (!song) {
    song = data.fs.file('SOUNDS', SONGS[index]);
    data.songs.set(index, song);
  }
  return renderLibmusSong(rom, data.waves, song, {
    masterVolume: MASTER_VOLUME,
    reverb: false,
  });
}
