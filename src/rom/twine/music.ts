// TWINE's 18 MusyX song-table rows. The table order is not song-id order.
import { MusyxBank, renderSong } from '../music/musyx';
import type { DecodedMusic, MusicTrack } from '../types';

const US = { table: 0xb3080, project: 0x14cd630, pool: 0x14d0ed0, directory: 0x14ddc00, samples: 0x14e2500, songsEnd: 0x1d69630 };
const EU = { table: 0xb3620, project: 0x14c8ff0, pool: 0x14cc890, directory: 0x14d95c0, samples: 0x14ddec0, songsEnd: 0x1d64ff0 };
const NAMES = [
  "King's Ransom", 'Thames Chase / Cold Reception', 'Midnight Departure', 'Masquerade event',
  'A Sinking Feeling event', 'Masquerade scene', 'Courier scene', 'Underground Uprising',
  'Title / menus', 'Meltdown', 'Night Watch', 'A Sinking Feeling', 'Submarine scene',
  "King's Ransom scene", 'Unused song', 'Courier intro sting', 'City of Walkways I intro',
  'Front-end intro',
] as const;

const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

function layout(rom: Uint8Array) {
  const release = String.fromCharCode(rom[0x3b], rom[0x3c], rom[0x3d], rom[0x3e]);
  const a = release === 'NO7E' ? US : release === 'NO7P' ? EU : null;
  if (!a || rom.length !== 0x2000000 || a.songsEnd > rom.length) throw new Error('TWINE music: unsupported ROM');
  return a;
}

interface SongRow { start: number; end: number; group: number; song: number }

function rows(rom: Uint8Array): SongRow[] {
  const a = layout(rom);
  const out: SongRow[] = [];
  for (let i = 0; i < NAMES.length; i++) {
    const o = a.table + i * 12;
    const start = u32(rom, o), end = u32(rom, o + 4);
    const group = u16(rom, o + 8), song = u16(rom, o + 10);
    if (start < a.samples || start >= end || end > a.songsEnd || group < 1 || group > 8 || song > 17)
      throw new Error(`TWINE music: invalid song-table row ${i}`);
    out.push({ start, end, group, song });
  }
  if (u32(rom, a.table + NAMES.length * 12) !== 0) throw new Error('TWINE music: missing song-table terminator');
  return out;
}

export function listTwineMusic(rom: Uint8Array): MusicTrack[] {
  rows(rom);
  return NAMES.map((name, index) => ({ index, name: `${String(index).padStart(2, '0')} ${name}` }));
}

const banks = new WeakMap<Uint8Array, MusyxBank>();
function bank(rom: Uint8Array): MusyxBank {
  let b = banks.get(rom);
  if (!b) {
    const a = layout(rom);
    b = new MusyxBank(rom.subarray(a.project, a.pool), rom.subarray(a.pool, a.directory),
      rom.subarray(a.directory, a.samples), rom.subarray(a.samples, a.songsEnd));
    banks.set(rom, b);
  }
  return b;
}

export function decodeTwineMusic(rom: Uint8Array, index: number): DecodedMusic {
  if (!Number.isInteger(index) || index < 0 || index >= NAMES.length)
    throw new Error(`No TWINE music track ${index}`);
  const row = rows(rom)[index];
  const r = renderSong(bank(rom), row.group, row.song, rom.subarray(row.start, row.end),
    { maxVoices: 10, accurateVolumeSelect: true });
  return {
    sampleRate: r.sampleRate,
    channels: [r.left, r.right],
    ...(r.loops ? { loopStart: r.loopStart, loopEnd: r.loopEnd } : {}),
  };
}
