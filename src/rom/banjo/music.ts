// Banjo-Kazooie (USA V1.0) music: 173 compressed MIDI assets and soundfont 2.
import { inflateRaw } from '../inflate';
import { parseCompressedSequence } from '../music/cseq';
import { parseBank, renderSequence, type Bank } from '../music/libultra';
import type { DecodedMusic, MusicTrack } from '../types';

const ASSET_TABLE = 0x5e90;
const SEQUENCE_BASE = 0x1516;
const SEQUENCE_COUNT = 0xad;
const MUSIC_CONTROL = 0xea3eb0;
const MUSIC_SAMPLES = 0xeade60;
const CORE1_DATA = 0xf362eb;
const CORE1_DATA_ADDRESS = 0x80275610;
const TRACK_INFO_ADDRESS = 0x80275d40;
const OUTPUT_RATE = 21998;

// Surface/default masks from the game's music-channel selector. Contextual
// changes (underwater, buildings, player position) are not static tracks.
const DEFAULT_MASKS: Record<number, number> = {
  0x02: 0x103f, 0x03: 0x43ff, 0x05: 0x60ff, 0x06: 0x6f4f,
  0x0f: 0xcfff, 0x10: 0x6fff, 0x1c: 0x407f, 0x1e: 0x41ff,
  0x1f: 0x61ff, 0x20: 0x67fe, 0x24: 0x4ffe, 0x28: 0x003c,
  0x2e: 0x7bef, 0x2f: 0x0007, 0x33: 0x71bf, 0x35: 0x43fe,
  0x44: 0x41fe, 0x46: 0x0107, 0x4a: 0x00fe, 0x50: 0x81ff,
  0x51: 0x81bf, 0x52: 0x8e41, 0x53: 0x81bf, 0x54: 0x81ff,
  0x59: 0x81bf, 0x5d: 0x81ff, 0x5e: 0x81bf, 0x5f: 0x7bbf,
  0x63: 0x9e00, 0x6b: 0x001f, 0x6e: 0x01ff,
};

const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32 = (b: Uint8Array, o: number) =>
  ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

function wrapped(rom: Uint8Array, start: number, end: number): Uint8Array {
  if (start + 6 > end || rom[start] !== 0x11 || rom[start + 1] !== 0x72)
    throw new Error(`Banjo music: invalid 1172 stream at 0x${start.toString(16)}`);
  const size = u32(rom, start + 2);
  const data = inflateRaw(rom.subarray(0, end), start + 6, size);
  if (data.length !== size) throw new Error('Banjo music: decoded asset size mismatch');
  return data;
}

function sequence(rom: Uint8Array, index: number): Uint8Array {
  const id = SEQUENCE_BASE + index;
  const count = u32(rom, ASSET_TABLE);
  if (count !== 0x15c7) throw new Error('Banjo music: unsupported asset table');
  const base = ASSET_TABLE + 8 + count * 8;
  const entry = ASSET_TABLE + 8 + id * 8;
  const start = base + u32(rom, entry);
  const end = base + u32(rom, entry + 8);
  if (!(start < end && end <= rom.length) || !(u16(rom, entry + 4) & 1))
    throw new Error(`Banjo music: invalid sequence asset ${index}`);
  return wrapped(rom, start, end);
}

interface TrackInfo { name: string; volume: number }
const infos = new WeakMap<Uint8Array, TrackInfo[]>();
function trackInfo(rom: Uint8Array): TrackInfo[] {
  const cached = infos.get(rom);
  if (cached) return cached;
  if (rom.length !== 0x1000000 || String.fromCharCode(...rom.subarray(0x3b, 0x3f)) !== 'NBKE' || rom[0x3f] !== 0)
    throw new Error('Banjo music: expected USA V1.0 ROM');
  const data = wrapped(rom, CORE1_DATA, rom.length);
  const out: TrackInfo[] = [];
  for (let i = 0; i < SEQUENCE_COUNT; i++) {
    const row = TRACK_INFO_ADDRESS - CORE1_DATA_ADDRESS + i * 8;
    const address = u32(data, row) - CORE1_DATA_ADDRESS;
    if (address >= data.length) throw new Error(`Banjo music: invalid song name ${i}`);
    let end = address;
    while (end < data.length && data[end]) end++;
    if (end === data.length) throw new Error(`Banjo music: unterminated song name ${i}`);
    out.push({ name: String.fromCharCode(...data.subarray(address, end)), volume: u16(data, row + 4) });
  }
  infos.set(rom, out);
  return out;
}

const banks = new WeakMap<Uint8Array, Bank>();
function musicBank(rom: Uint8Array): Bank {
  let bank = banks.get(rom);
  if (!bank) {
    bank = parseBank(rom, MUSIC_CONTROL, MUSIC_SAMPLES, 0, null);
    banks.set(rom, bank);
  }
  return bank;
}

export function listBanjoMusic(rom: Uint8Array): MusicTrack[] {
  return trackInfo(rom).map(({ name }, index) => ({
    index, name: `${index.toString(16).toUpperCase().padStart(2, '0')} ${name}`,
  }));
}

export function decodeBanjoMusic(rom: Uint8Array, index: number): DecodedMusic {
  if (!Number.isInteger(index) || index < 0 || index >= SEQUENCE_COUNT)
    throw new Error(`No Banjo-Kazooie music track ${index}`);
  const { seq, loop } = parseCompressedSequence(sequence(rom, index));
  const mask = DEFAULT_MASKS[index] ?? 0xffff;
  if (mask !== 0xffff) seq.events = seq.events.filter((event) =>
    (event.status & 0xf0) !== 0x90 || ((mask >>> (event.status & 15)) & 1) !== 0);
  return renderSequence(rom, musicBank(rom), seq, {
    rate: OUTPUT_RATE, maxVoices: 24, seqVol: trackInfo(rom)[index].volume,
    loop, squareVolume: false, linearRamps: true,
  }).music;
}
