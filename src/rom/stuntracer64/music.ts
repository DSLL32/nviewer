// Stunt Racer 64's six-channel tracker, Boss pattern stream, and three sample palettes.
import { decodeVadpcm } from '../music/libultra';
import type { DecodedMusic, MusicTrack } from '../types';

const RATE = 21998;
const SONGS = 14;
const META_TABLE = 0xbe414;
const DATA_TABLE = 0xbe44c;
const BANK_TABLE = 0xbe3f0;
const MAP_TABLE = 0xbe408;
const PERIOD_TABLE = 0xbe2e8;
const MAX_VOICES = 10;

const u16 = (b: Uint8Array, p: number) => (b[p] << 8) | b[p + 1];
const u32 = (b: Uint8Array, p: number) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
const signed = (n: number) => (n << 24) >> 24;

function checkRom(rom: Uint8Array): void {
  if (rom.length !== 0xc00000 || String.fromCharCode(...rom.subarray(0x3b, 0x3f)) !== 'NR3E' || rom[0x3f] !== 0)
    throw new Error('Stunt Racer music: expected USA revision 0 ROM');
}

function unpack(rom: Uint8Array, start: number): Uint8Array {
  const rawSize = u32(rom, start), packedSize = u32(rom, start + 4);
  const src = rom.subarray(start + 8, start + 8 + packedSize);
  if (src.length !== packedSize || !packedSize || rawSize > 0x100000) throw new Error('Stunt Racer music: invalid pattern extent');
  if (src[0] === 0x80) {
    if (packedSize - 1 !== rawSize) throw new Error('Stunt Racer music: raw pattern size mismatch');
    return src.subarray(1);
  }
  if (src[0] !== 0x40 || packedSize < 3) throw new Error('Stunt Racer music: unknown pattern packing');
  const out = new Uint8Array(rawSize);
  let p = 3, q = 0, bits = 16, control = u16(src, 1);
  while (p < src.length) {
    if (!bits) {
      if (p + 2 > src.length) throw new Error('Stunt Racer music: short control word');
      control = u16(src, p); p += 2; bits = 16;
    }
    if (control & 0x8000) {
      if (p + 2 > src.length) throw new Error('Stunt Racer music: short match');
      const a = src[p++], b = src[p++], distance = (a << 4) | (b >> 4);
      if (distance) {
        const length = (b & 15) + 3;
        if (distance > q || q + length > out.length) throw new Error('Stunt Racer music: invalid match');
        for (let k = 0; k < length; k++, q++) out[q] = out[q - distance];
      } else {
        if (p + 2 > src.length) throw new Error('Stunt Racer music: short run');
        const length = (b << 8 | src[p++]) + 16, value = src[p++];
        if (q + length > out.length) throw new Error('Stunt Racer music: invalid run');
        out.fill(value, q, q + length); q += length;
      }
    } else {
      if (q >= out.length) throw new Error('Stunt Racer music: extra literal');
      out[q++] = src[p++];
    }
    control = (control << 1) & 0xffff;
    bits--;
  }
  if (q !== out.length) throw new Error('Stunt Racer music: decoded size mismatch');
  return out;
}

interface Cell { note: number; instrument: number; volume: number; effect: number; parameter: number }
interface Song { orders: number[]; restart: number; speed: number; tempo: number; patterns: Cell[][][] }
const songCache = new WeakMap<Uint8Array, Map<number, Song>>();

function song(rom: Uint8Array, index: number): Song {
  let cache = songCache.get(rom);
  if (!cache) { cache = new Map(); songCache.set(rom, cache); }
  const known = cache.get(index);
  if (known) return known;
  const meta = u32(rom, META_TABLE + index * 4);
  const payload = u32(rom, DATA_TABLE + index * 4);
  const count = u16(rom, meta), restart = u16(rom, meta + 2);
  const channels = u16(rom, meta + 4), patternCount = u16(rom, meta + 6);
  if (meta + 0x710 > rom.length || count > 256 || !count || restart >= count || channels !== 6 || patternCount > 256)
    throw new Error(`Stunt Racer music: invalid song ${index}`);
  const orders = Array.from(rom.subarray(meta + 0xc, meta + 0xc + count));
  const blob = unpack(rom, payload);
  const patterns: Cell[][][] = [];
  for (let pattern = 0; pattern < patternCount; pattern++) {
    const rows = u16(rom, meta + 0x510 + pattern * 2);
    let p = u32(rom, meta + 0x110 + pattern * 4);
    const end = u32(rom, meta + 0x114 + pattern * 4);
    if (rows && (p >= end || end > blob.length)) throw new Error('Stunt Racer music: invalid pattern offset');
    const cells: Cell[][] = [];
    for (let row = 0; row < rows; row++) {
      const line: Cell[] = [];
      for (let channel = 0; channel < 6; channel++) {
        if (p >= end) throw new Error(`Stunt Racer music: short pattern ${index}/${pattern}/${row}/${channel}: ${p}/${end}`);
        const marker = blob[p++], fields = [0, 0, 0, 0, 0];
        if (marker & 0x80) {
          for (let col = 0; col < 5; col++) if (marker & (1 << col)) {
            if (p >= end) throw new Error('Stunt Racer music: short packed cell');
            fields[col] = blob[p++];
          }
        } else {
          if (p + 4 > end) throw new Error('Stunt Racer music: short plain cell');
          fields[0] = marker;
          for (let col = 1; col < 5; col++) fields[col] = blob[p++];
        }
        line.push({ note: fields[0], instrument: fields[1], volume: fields[2], effect: fields[3], parameter: fields[4] });
      }
      cells.push(line);
    }
    patterns.push(cells);
  }
  if (orders.some((n) => n >= patternCount)) throw new Error('Stunt Racer music: invalid order');
  const parsed = { orders, restart, speed: u16(rom, meta + 8), tempo: u16(rom, meta + 10), patterns };
  cache.set(index, parsed);
  return parsed;
}

interface Sample { pcm: Int16Array; pan: number; baseNote: number; fine: number; volume: number }
interface Palette { samples: Sample[]; maps: Uint8Array[] }
const paletteCache = new WeakMap<Uint8Array, Map<number, Palette>>();

// 0x80054174–0x80054284 interpolates the ROM period table, then 0x800537B4
// converts that period to the mixer's 16.16 source-sample advance. In
// particular, the interpolation's factor of 32 must remain *before* the
// octave shift; treating the table as a conventional equal-tempered rate
// makes these samples play several times too slowly.
function sampleStep(rom: Uint8Array, note: number, sample: Sample): number {
  const combined = (note + sample.baseNote) & 0xff;
  const octave = Math.floor(combined / 12);
  const fine = sample.fine;
  const fraction = fine < 0 ? -((-fine & 15) * 2) : (fine & 15) * 2;
  const entry = (combined % 12) * 8 + (fine >> 4);
  const first = (u16(rom, PERIOD_TABLE + entry * 2) << 16) >> 16;
  const second = (u16(rom, PERIOD_TABLE + (entry + 1) * 2) << 16) >> 16;
  const period = (first * (32 - fraction) + second * fraction) >> octave;
  if (period <= 0) throw new Error('Stunt Racer music: invalid note period');
  const clockPerPeriod = Math.trunc(0xda7790 / period);
  const fixedAdvance = Math.trunc(((clockPerPeriod << 15) >>> 0) / (RATE >> 1));
  return fixedAdvance / 65536;
}

function readBank(rom: Uint8Array, start: number, samples: (Sample | undefined)[], overlay: boolean): void {
  let p = start, index = 0;
  while (p + 4 <= rom.length && u32(rom, p) !== 0xffffffff) {
    if (index >= 256) throw new Error('Stunt Racer music: unterminated bank');
    const flags = u32(rom, p), bytes = u32(rom, p + 4);
    const header = flags & 1 ? 0x494 : 0x94;
    const encoded = ((bytes >> 5) * 9 + 1) & ~1;
    if (bytes & 31 || p + header > rom.length) throw new Error('Stunt Racer music: invalid sample header');
    if (!(overlay && (flags & 0x80))) {
      if (p + header + encoded > rom.length) throw new Error('Stunt Racer music: invalid sample data');
      const book = Int16Array.from({ length: 64 }, (_, n) => (u16(rom, p + 0x14 + n * 2) << 16) >> 16);
      const pcm = new Int16Array(bytes >> 1);
      decodeVadpcm(rom, p + header, bytes >> 5, book, new Int16Array(16), pcm, 0);
      samples[index] = { pcm, pan: u16(rom, p + 0xc), baseNote: signed(rom[p + 0x10]),
        fine: signed(rom[p + 0x11]), volume: signed(rom[p + 0x12]) };
      p += encoded;
    }
    p += header;
    index++;
  }
  if (p + 4 > rom.length) throw new Error('Stunt Racer music: missing bank sentinel');
}

function palette(rom: Uint8Array, mode: number): Palette {
  let cache = paletteCache.get(rom);
  if (!cache) { cache = new Map(); paletteCache.set(rom, cache); }
  const known = cache.get(mode);
  if (known) return known;
  const samples: (Sample | undefined)[] = [];
  readBank(rom, u32(rom, BANK_TABLE + mode * 8 + 4), samples, false);
  readBank(rom, u32(rom, BANK_TABLE + mode * 8), samples, true);
  const mapStart = u32(rom, MAP_TABLE + mode * 4), count = u32(rom, mapStart);
  if (count !== 11 || mapStart + 4 + 96 * count > rom.length || samples.some((s) => !s))
    throw new Error('Stunt Racer music: invalid instrument map');
  const parsed: Palette = {
    samples: samples as Sample[],
    maps: Array.from({ length: count }, (_, i) => rom.subarray(mapStart + 4 + i * 96, mapStart + 4 + (i + 1) * 96)),
  };
  cache.set(mode, parsed);
  return parsed;
}

const RACE_TRACKS = Array.from({ length: 18 }, (_, index) => ({ song: Math.floor(index / 3), mode: index % 3 }));
const OTHER_TRACKS = [1, 0, 0, 0, 0, 0, 0, 0].map((mode, i) => ({ song: i + 6, mode }));
const TRACKS = [...RACE_TRACKS, ...OTHER_TRACKS];
const OTHER_NAMES = [
  'Special race state 17', 'Startup / default menu', 'First-place / winner cue', 'Middle-placement cue',
  'Last-place cue', 'Menu / return cue', 'Opponents / racer-profile screen', 'Staff / credits screen',
];

export function listStuntRacerMusic(rom: Uint8Array): MusicTrack[] {
  checkRom(rom);
  return TRACKS.map(({ song: number, mode }, index) => ({
    index, name: number < 6 ? `Race Music ${number} — Palette ${mode}` : OTHER_NAMES[number - 6],
  }));
}

interface Voice {
  sample: Sample; start: number; end: number; gain: number; pan: number;
  segments: { start: number; source: number; step: number }[];
}
interface Channel { instrument: number; volume: number; pan: number; voice?: Voice; pitch: number }

export function decodeStuntRacerMusic(rom: Uint8Array, index: number): DecodedMusic {
  checkRom(rom);
  const track = TRACKS[index];
  if (!Number.isInteger(index) || !track) throw new Error(`No Stunt Racer music track ${index}`);
  const module = song(rom, track.song), bank = palette(rom, track.mode);
  const channels: Channel[] = Array.from({ length: 6 }, () => ({ instrument: 0, volume: 64, pan: 128, pitch: 0 }));
  const voices: Voice[] = [];
  let time = 0, speed = module.speed, tempo = module.tempo, globalVolume = 128;
  let loopStart = 0, loopEnd = 0;
  // Intro, first loop and second loop: the second pass gives the music player
  // material beyond its exact restart-order loop point.
  for (let pass = 0; pass < 2; pass++) {
    for (let order = pass ? module.restart : 0; order < module.orders.length; order++) {
      if (!pass && order === module.restart) loopStart = time;
      if (pass && order === module.restart) loopEnd = time;
      for (const row of module.patterns[module.orders[order]]) {
        for (let ch = 0; ch < 6; ch++) {
          const cell = row[ch], state = channels[ch];
          if (cell.instrument) state.instrument = cell.instrument;
          if (cell.effect === 0x08) state.pan = cell.parameter;
          if (cell.effect === 0x0f && cell.parameter) {
            if (cell.parameter < 0x20) speed = cell.parameter;
            else tempo = cell.parameter;
          }
          if (cell.effect === 0x10) globalVolume = cell.parameter;
          if (cell.volume >= 0x10 && cell.volume <= 0x50) state.volume = cell.volume - 0x10;
          if (cell.note === 0x85 || cell.note >= 97) {
            if (state.voice) state.voice.end = Math.min(state.voice.end, time + 256);
            state.voice = undefined;
          } else if (cell.note && state.instrument >= 1 && state.instrument <= bank.maps.length && cell.note <= 96) {
            const sampleIndex = bank.maps[state.instrument - 1][cell.note - 1];
            const sample = bank.samples[sampleIndex];
            if (!sample) throw new Error('Stunt Racer music: missing mapped sample');
            if (state.voice) state.voice.end = Math.min(state.voice.end, time + 256);
            const step = sampleStep(rom, cell.note, sample);
            const active = voices.filter((v) => v.end > time);
            if (active.length >= MAX_VOICES) active[0].end = time;
            const voice: Voice = { sample, start: time, end: time + Math.ceil(sample.pcm.length / step),
              gain: (state.volume / 64) * (sample.volume / 64) * (globalVolume / 128) * 0.38,
              pan: state.pan === 128 ? sample.pan : state.pan,
              segments: [{ start: time, source: 0, step }] };
            voices.push(voice);
            state.voice = voice;
            state.pitch = step;
          }
          // The only authored slides are on song 10. A new segment preserves
          // sample phase while changing the active voice's playback increment.
          if ((cell.effect === 1 || cell.effect === 2) && state.voice && state.voice.end > time) {
            const voice = state.voice, previous = voice.segments[voice.segments.length - 1];
            const source = previous.source + (time - previous.start) * previous.step;
            state.pitch *= Math.pow(2, (cell.effect === 1 ? 1 : -1) * cell.parameter / 768);
            voice.segments.push({ start: time, source, step: state.pitch });
            voice.end = Math.max(voice.end, time + Math.ceil((voice.sample.pcm.length - source) / state.pitch));
          }
        }
        time += Math.round(RATE * 5 * speed / (2 * tempo));
      }
    }
  }
  const left = new Float32Array(time), right = new Float32Array(time);
  for (const voice of voices) {
    const end = Math.min(time, voice.end), pcm = voice.sample.pcm;
    const pan = Math.max(0, Math.min(255, voice.pan)) / 255;
    const gainL = voice.gain * Math.cos(pan * Math.PI / 2) / 32768;
    const gainR = voice.gain * Math.sin(pan * Math.PI / 2) / 32768;
    for (let s = 0; s < voice.segments.length; s++) {
      const segment = voice.segments[s], segmentEnd = Math.min(end, voice.segments[s + 1]?.start ?? end);
      for (let p = segment.start; p < segmentEnd; p++) {
        const x = segment.source + (p - segment.start) * segment.step, i = x | 0;
        if (i + 1 >= pcm.length) break;
        const value = pcm[i] + (pcm[i + 1] - pcm[i]) * (x - i);
        const fade = Math.min(1, (end - p) / 256);
        left[p] += value * gainL * fade;
        right[p] += value * gainR * fade;
      }
    }
  }
  for (let i = 0; i < time; i++) {
    left[i] = Math.max(-1, Math.min(1, left[i]));
    right[i] = Math.max(-1, Math.min(1, right[i]));
  }
  return { sampleRate: RATE, channels: [left, right], loopStart, loopEnd };
}
