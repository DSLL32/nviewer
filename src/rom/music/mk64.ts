// Mario Kart 64 soundtrack: Nintendo EAD's SM64-lineage Nas sequence driver and NEAD MK mixer.
// Ported from the verified research renderer documented in docs/MARIOKART64.md section 9.
import type { DecodedMusic, MusicTrack } from '../types';
import { RESAMPLE_LUT, decodeVadpcm } from './libultra';

export interface Entry { offset: number; size: number }
export interface Sample {
  hdr: number; // ROM offset of the sample struct
  loaded: number;
  addr: number; // ROM offset of the VADPCM data
  size: number; // bytes
  loopStart: number; loopEnd: number; loopCount: number; loopState: Int16Array | null;
  order: number; npred: number; book: Int16Array;
}
export interface Sound { sample: Sample | null; tuning: number }
export interface Instrument { off: number; loaded: number; rangeLo: number; rangeHi: number; releaseRate: number; envelope: number; low: Sound; normal: Sound; high: Sound }
export interface Drum { off: number; releaseRate: number; pan: number; loaded: number; sound: Sound; envelope: number }
export interface Bank {
  id: number; start: number; end: number; base: number; numInstruments: number; numDrums: number; word8: number; date: number;
  drumList: number; instruments: (Instrument | null)[]; drums: (Drum | null)[];
}

const align16 = (v: number) => (v + 15) & ~15;

export class MK64Audio {
  readonly dv: DataView;
  readonly seqFile: number;
  readonly ctlFile: number;
  readonly tblFile: number;
  readonly bankSets: number;
  readonly seqs: Entry[];
  readonly ctl: Entry[];
  readonly tbl: Entry[];
  private readonly bankCache = new Map<number, Bank>();
  private readonly sampleCache = new Map<number, Sample>();

  constructor(readonly rom: Uint8Array) {
    const dv = (this.dv = new DataView(rom.buffer, rom.byteOffset, rom.byteLength));
    this.seqFile = this.findFile(3, (off, ents) => ents.every((e) => e.size === 0 || e.offset + e.size <= 0x40000));
    this.ctlFile = this.findFile(1, (off, ents) => ents.every((e) => e.size === 0 || (dv.getUint32(off + e.offset) < 256 && dv.getUint32(off + e.offset + 4) < 256)));
    this.seqs = this.entries(this.seqFile);
    this.ctl = this.entries(this.ctlFile);
    this.tblFile = this.findFile(2, (off, ents) => ents.length === this.ctl.length);
    this.tbl = this.entries(this.tblFile);
    // Bank sets follow the sequence file (aligned to 0x40 in the build); fall back to a global search.
    const n = this.seqs.length;
    const isSets = (o: number) => {
      if (o < 0 || o + 2 * n > rom.length || dv.getUint16(o) !== 2 * n) return false;
      for (let i = 0; i < n; i++) {
        const p = dv.getUint16(o + 2 * i);
        if (p < 2 * n || p > 0x400) return false;
        const c = rom[o + p];
        if (c < 1 || c > 8) return false;
        for (let k = 0; k < c; k++) if (rom[o + p + 1 + k] >= this.ctl.length) return false;
      }
      return true;
    };
    const seqEnd = this.seqFile + Math.max(...this.seqs.map((e) => e.offset + e.size));
    let sets = -1;
    for (let o = align16(seqEnd); o < seqEnd + 0x1000 && sets < 0; o += 16) if (isSets(o)) sets = o;
    for (let o = 0x1000; o < rom.length - 0x100 && sets < 0; o += 16) if (isSets(o)) sets = o;
    if (sets < 0) throw new Error('bank sets not found');
    this.bankSets = sets;
  }

  private entries(file: number): Entry[] {
    const n = this.dv.getUint16(file + 2);
    if (file < 0 || file + 4 + 8 * n > this.rom.length) throw new Error('Mario Kart 64 audio table exceeds the ROM');
    return Array.from({ length: n }, (_, i) => ({ offset: this.dv.getUint32(file + 4 + 8 * i), size: this.dv.getUint32(file + 8 + 8 * i) }));
  }

  // A header {u16 rev, u16 n, n x {offset, size}} whose first real entry starts right after it (16-aligned).
  private findFile(rev: number, extra: (off: number, ents: Entry[]) => boolean): number {
    const dv = this.dv, rom = this.rom;
    for (let off = 0x1000; off < rom.length - 0x400; off += 16) {
      if (dv.getUint16(off) !== rev) continue;
      const n = dv.getUint16(off + 2);
      if (n < 4 || n > 128) continue;
      if (off + 4 + 8 * n > rom.length) continue;
      const ents = this.entries(off);
      const real = ents.filter((e) => e.size !== 0);
      if (!real.length || real[0].offset !== align16(4 + 8 * n)) continue;
      if (!ents.every((e) => (e.size === 0 ? e.offset < n : off + e.offset + e.size <= rom.length))) continue;
      if (!extra(off, ents)) continue;
      return off;
    }
    throw new Error(`audio file rev ${rev} not found`);
  }

  resolveSeq(id: number) { const e = this.seqs[id]; return e.size === 0 ? e.offset : id; }

  sequenceData(id: number): Uint8Array {
    const e = this.seqs[this.resolveSeq(id)];
    return this.rom.slice(this.seqFile + e.offset, this.seqFile + e.offset + e.size);
  }

  bankSet(seqId: number): number[] {
    const o = this.bankSets + this.dv.getUint16(this.bankSets + 2 * this.resolveSeq(seqId));
    return Array.from(this.rom.subarray(o + 1, o + 1 + this.rom[o]));
  }

  tblBase(bankId: number): number {
    let e = this.tbl[bankId];
    if (e.size === 0) e = this.tbl[e.offset];
    return this.tblFile + e.offset;
  }

  bank(id: number): Bank {
    const cached = this.bankCache.get(id);
    if (cached) return cached;
    const dv = this.dv, rom = this.rom, e = this.ctl[id];
    const start = this.ctlFile + e.offset, base = start + 0x10;
    const u32 = (o: number) => dv.getUint32(base + o);
    const numInstruments = dv.getUint32(start), numDrums = dv.getUint32(start + 4);
    const tbl = this.tblBase(id);
    const sound = (o: number): Sound => ({ sample: this.sample(base, u32(o), tbl), tuning: dv.getFloat32(base + o + 4) });
    const drumList = u32(0);
    const drums = drumList && numDrums ? Array.from({ length: numDrums }, (_, i): Drum | null => {
      const d = u32(drumList + 4 * i);
      if (!d) return null;
      return { off: d, releaseRate: rom[base + d], pan: rom[base + d + 1], loaded: rom[base + d + 2], sound: sound(d + 4), envelope: base + u32(d + 12) };
    }) : [];
    const instruments = Array.from({ length: numInstruments }, (_, i): Instrument | null => {
      const o = u32(4 + 4 * i);
      if (!o) return null;
      return {
        off: o, loaded: rom[base + o], rangeLo: rom[base + o + 1], rangeHi: rom[base + o + 2], releaseRate: rom[base + o + 3],
        envelope: base + u32(o + 4), low: sound(o + 8), normal: sound(o + 16), high: sound(o + 24),
      };
    });
    const b: Bank = {
      id, start, end: start + e.size, base, numInstruments, numDrums, word8: dv.getUint32(start + 8), date: dv.getUint32(start + 12),
      drumList, instruments, drums,
    };
    this.bankCache.set(id, b);
    return b;
  }

  // AudioBankSample {u8 unused, u8 loaded, u16 pad, u32 sampleAddr (tbl-relative), u32 loop, u32 book, u32 sampleSize}
  private sample(base: number, so: number, tbl: number): Sample | null {
    if (!so) return null;
    const hdr = base + so;
    const cached = this.sampleCache.get(hdr);
    if (cached) return cached;
    const dv = this.dv;
    const loop = base + dv.getUint32(hdr + 8), book = base + dv.getUint32(hdr + 12);
    const order = dv.getInt32(book), npred = dv.getInt32(book + 4);
    const loopCount = dv.getUint32(loop + 8);
    const s: Sample = {
      hdr, loaded: this.rom[hdr + 1], addr: tbl + dv.getUint32(hdr + 4), size: dv.getUint32(hdr + 16),
      loopStart: dv.getUint32(loop), loopEnd: dv.getUint32(loop + 4), loopCount,
      loopState: loopCount !== 0 ? Int16Array.from({ length: 16 }, (_, k) => dv.getInt16(loop + 16 + 2 * k)) : null,
      order, npred, book: Int16Array.from({ length: 8 * order * npred }, (_, k) => dv.getInt16(book + 8 + 2 * k)),
    };
    this.sampleCache.set(hdr, s);
    return s;
  }

  allSamples(): Sample[] { return [...this.sampleCache.values()]; }
}

// Decode `frames` VADPCM frames from the start (zeroed decoder state).
export function decodeFrames(rom: Uint8Array, s: Sample, frames: number): Int16Array {
  const out = new Int16Array(frames * 16);
  decodeVadpcm(rom, s.addr, frames, s.book, new Int16Array(16), out, 0);
  return out;
}
const fround = Math.fround;
const clamp16 = (v: number) => (v > 32767 ? 32767 : v < -32768 ? -32768 : v);
const s8 = (v: number) => (v << 24) >> 24;
const s16 = (v: number) => (v << 16) >> 16;
const u16 = (v: number) => v & 0xffff;
const u8 = (v: number) => v & 0xff;
const LUT = RESAMPLE_LUT;
const MAIN_RAM_TO_ROM = 0x7ffff400; // main segment: RAM 0x80000400 = ROM 0x1000

export const SOUND_MODE_STEREO = 0, SOUND_MODE_HEADSET = 1, SOUND_MODE_MONO = 3;

// ---- code tables and audio session presets (main segment, found by signature) ----------------------------------------

export interface ReverbSettings { downsampleRate: number; windowSize: number; gain: number }
export interface Preset { frequency: number; unk1: number; maxNotes: number; numReverbs: number; reverbs: ReverbSettings[]; volume: number; mem: number[] }

export class Tables {
  readonly pitchBend: Float32Array; // gPitchBendFrequencyScale[256], index 128 = 1.0
  readonly noteFreq: Float32Array; // gNoteFrequencies[128], note 39 = 1.0
  readonly shortVel: Uint8Array;
  readonly shortDur: Uint8Array;
  readonly defaultEnv: number; // ROM offset
  readonly panHeadset: Float32Array;
  readonly panStereo: Float32Array;
  readonly panDefault: Float32Array;
  readonly waves: Int16Array[]; // gWaveSamples[6], 256 samples each (4 x 64)
  readonly presets: Preset[];
  readonly presetsRom: number;
  readonly tableRom: number;
  readonly tvFactorNtsc: number; // D_803B7178 for NTSC (16.713)
  readonly tatumsPerBeat: number;

  constructor(readonly rom: Uint8Array) {
    const dv = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
    const find = (bytes: number[], from = 0x1000, to = Math.min(rom.length, 0x200000), step = 4) => {
      outer: for (let o = from; o < to; o += step) {
        for (let k = 0; k < bytes.length; k++) if (rom[o + k] !== bytes[k]) continue outer;
        return o;
      }
      return -1;
    };
    const fbytes = (...fs: number[]) => {
      const b = new DataView(new ArrayBuffer(4 * fs.length));
      fs.forEach((f, i) => b.setFloat32(4 * i, f));
      return Array.from(new Uint8Array(b.buffer));
    };
    const p = find(fbytes(0.5, 0.5, 0.502736));
    if (p < 0) throw new Error('pitch bend table not found');
    this.tableRom = p;
    const f32s = (o: number, n: number) => Float32Array.from({ length: n }, (_, i) => dv.getFloat32(o + 4 * i));
    this.pitchBend = f32s(p, 256);
    this.noteFreq = f32s(p + 0x400, 128);
    this.shortVel = rom.slice(p + 0x600, p + 0x610);
    this.shortDur = rom.slice(p + 0x610, p + 0x620);
    this.defaultEnv = p + 0x620;
    this.panHeadset = f32s(p + 0x6f0, 128);
    this.panStereo = f32s(p + 0x8f0, 128);
    this.panDefault = f32s(p + 0xaf0, 128);
    const checks: [string, boolean][] = [
      ['noteFreq[39]=1', this.noteFreq[39] === 1], ['pitchBend[128]=1', this.pitchBend[128] === 1],
      ['shortVel', this.shortVel[0] === 12 && this.shortVel[15] === 127], ['shortDur', this.shortDur[0] === 229 && this.shortDur[15] === 0],
      ['defaultEnv', dv.getInt16(this.defaultEnv) === 4 && dv.getInt16(this.defaultEnv + 2) === 32000],
      ['panHeadset', this.panHeadset[0] === 1], ['panStereo', Math.abs(this.panStereo[0] - 0.707) < 1e-6], ['panDefault', this.panDefault[0] === 1 && this.panDefault[127] === 0],
    ];
    for (const [n, ok] of checks) if (!ok) throw new Error(`table check failed: ${n}`);
    this.waves = Array.from({ length: 6 }, (_, i) => {
      const w = dv.getUint32(p - 0x20 + 4 * i) - MAIN_RAM_TO_ROM;
      return Int16Array.from({ length: 256 }, (_, k) => dv.getInt16(w + 2 * k));
    });
    // gAudioSessionPresets: 0x28-byte entries {u32 frequency; u8 1; u8 maxNotes; u8 numReverbs; u8 0; u32 reverbSettings; u16 volume; ...}
    let ps = -1;
    for (let o = 0x1000; o < Math.min(rom.length, 0x200000) && ps < 0; o += 4) {
      const f = dv.getUint32(o);
      if (f < 8000 || f > 48000 || rom[o + 4] !== 1 || rom[o + 5] < 4 || rom[o + 5] > 64 || rom[o + 6] > 4 || rom[o + 7] !== 0) continue;
      if (dv.getUint32(o + 8) >>> 24 !== 0x80 || dv.getUint16(o + 12) !== 0x7fff) continue;
      if (dv.getUint32(o + 0x28) !== f) continue; // at least two entries
      ps = o;
    }
    if (ps < 0) throw new Error('audio session presets not found');
    this.presetsRom = ps;
    const presets: Preset[] = [];
    for (let o = ps; dv.getUint32(o) === dv.getUint32(ps) && rom[o + 4] === 1; o += 0x28) {
      const rs = dv.getUint32(o + 8) - MAIN_RAM_TO_ROM;
      presets.push({
        frequency: dv.getUint32(o), unk1: rom[o + 4], maxNotes: rom[o + 5], numReverbs: rom[o + 6], volume: dv.getUint16(o + 12),
        reverbs: Array.from({ length: rom[o + 6] }, (_, k) => ({ downsampleRate: rom[rs + 4 * k], windowSize: rom[rs + 4 * k + 1], gain: dv.getUint16(rs + 4 * k + 2) })),
        mem: [0x10, 0x14, 0x18, 0x1c, 0x20, 0x24].map((k) => dv.getUint32(o + k)),
      });
    }
    this.presets = presets;
    // D_803B7178 candidates (PAL 20.03042, MPAL 16.546, NTSC 16.713) and gTatumsPerBeat right after the presets.
    const tv = find(fbytes(20.03042, 16.546, 16.713));
    this.tvFactorNtsc = tv >= 0 ? dv.getFloat32(tv + 8) : 16.713;
    const tatums = ps + 0x28 * presets.length + 4;
    this.tatumsPerBeat = dv.getInt16(tatums);
  }
}

// ---- engine structures ------------------------------------------------------------------------------------------------

interface EnvRef { bytes: Uint8Array; off: number }
const envS16 = (e: EnvRef, o: number) => s16((e.bytes[e.off + o] << 8) | e.bytes[e.off + o + 1]);

class ListItem<T> {
  prev: ListItem<T> | null = null;
  next: ListItem<T> | null = null;
  value: T | null = null;
  pool: NotePool | null = null;
  static head<T>(pool: NotePool | null) {
    const h = new ListItem<T>();
    h.prev = h.next = h;
    h.pool = pool;
    return h;
  }
}
function pushBack<T>(list: ListItem<T>, item: ListItem<T>) {
  if (item.prev !== null) return;
  list.prev!.next = item;
  item.prev = list.prev;
  item.next = list;
  list.prev = item;
  item.pool = list.pool;
}
function pushFront<T>(list: ListItem<T>, item: ListItem<T>) {
  if (item.prev !== null) return;
  item.prev = list;
  item.next = list.next;
  list.next!.prev = item;
  list.next = item;
  item.pool = list.pool;
}
function popBack<T>(list: ListItem<T>): T | null {
  const item = list.prev!;
  if (item === list) return null;
  item.prev!.next = list;
  list.prev = item.prev;
  item.prev = null;
  return item.value;
}
function listRemove<T>(item: ListItem<T>) {
  if (item.prev === null) return;
  item.prev.next = item.next;
  item.next!.prev = item.prev;
  item.prev = null;
}

class NotePool {
  disabled = ListItem.head<Note>(this);
  decaying = ListItem.head<Note>(this);
  releasing = ListItem.head<Note>(this);
  active = ListItem.head<Note>(this);
}

interface Script { pc: number; stack: number[]; loops: number[]; depth: number }
const newScript = (): Script => ({ pc: 0, stack: [0, 0, 0, 0], loops: [0, 0, 0, 0], depth: 0 });
interface AdsrSettings { releaseRate: number; sustain: number; envelope: EnvRef }
interface Portamento { mode: number; cur: number; speed: number; extent: number }

class Layer {
  item = new ListItem<Layer>();
  enabled = false; finished = false; stopSomething = false; continuousNotes = false;
  notePropertiesNeedInit = false; ignoreDrumPan = false;
  instOrWave = 0xff; status = 0; noteDuration = 0x80; portamentoTargetNote = 0; pan = 0x40; notePan = 0;
  portamento: Portamento = { mode: 0, cur: 0, speed: 0, extent: 0 };
  adsr: AdsrSettings;
  portamentoTime = 0; transposition = 0;
  freqScale = 1; velocitySquare = 0; noteVelocity = 0; noteFreqScale = 0;
  shortNoteDefaultPlayPercentage = 0; playPercentage = 0; delay = 0; duration = 0;
  note: Note | null = null;
  instrument: Instrument | null = null;
  sound: Sound | null = null;
  seqChannel: Channel | null = null;
  state = newScript();
  constructor(env: EnvRef) { this.item.value = this; this.adsr = { releaseRate: 0, sustain: 0, envelope: env }; }
}

class Channel {
  valid = true; // false for gSequenceChannelNone
  enabled = false; finished = false; stopScript = false; stopSomething2 = false; hasInstrument = false;
  stereoHeadsetEffects = 0; largeNotes = false;
  changes = 0xff; // bit 0 freqScale, bit 1 volume, bit 2 pan
  noteAllocPolicy = 0; muteBehavior = 0; reverbVol = 0; notePriority = 3; bankId = 0; reverbIndex = 0; bookOffset = 0;
  newPan = 0x40; panChannelWeight = 0x80;
  vibratoRateStart = 0x800; vibratoExtentStart = 0; vibratoRateTarget = 0x800; vibratoExtentTarget = 0;
  vibratoRateChangeDelay = 0; vibratoExtentChangeDelay = 0; vibratoDelay = 0;
  delay = 0; instOrWave = 0; transposition = 0;
  volumeScale = 1; volume = 1; pan = 0; appliedVolume = 0; freqScale = 1;
  dynTable = 0;
  instrument: Instrument | null = null;
  seqPlayer: SeqPlayer | null = null;
  layers: (Layer | null)[] = [null, null, null, null];
  io = new Int8Array(8).fill(-1);
  state = newScript();
  adsr: AdsrSettings;
  notePool = new NotePool();
  constructor(env: EnvRef) { this.adsr = { releaseRate: 0x20, sustain: 0, envelope: env }; }
}

class SeqPlayer {
  enabled = false; finished = false; muted = false; recalculateVolume = false;
  state = 0; noteAllocPolicy = 0; muteBehavior = 0xe0; seqId = 0; defaultBank = 0;
  variation = -1; // seqVariationEu[0]
  tempo = 120 * 48; tempoAcc = 0; transposition = 0; delay = 0;
  fadeRemainingFrames = 0; fadeTimerUnkEu = 0;
  seq: Uint8Array = new Uint8Array(0);
  fadeVolume = 1; fadeVelocity = 0; volume = 0; muteVolumeScale = 0.5; fadeVolumeScale = 1; appliedFadeVolume = 1;
  channels: Channel[] = [];
  state_ = newScript();
  shortVelTable = -1; // -1: default table, else offset in the sequence
  shortDurTable = -1;
  notePool = new NotePool();
  value = 0; // uninitialised locals in the game; kept across calls
  ticks = 0;
  chanValue = 0;
}

interface AdsrState { action: number; state: number; envIndex: number; delay: number; sustain: number; velocity: number; fadeOutVel: number; current: number; target: number; envelope: EnvRef }

interface NoteSub {
  enabled: boolean; needsInit: boolean; finished: boolean; envMixerNeedsInit: boolean;
  stereoStrongRight: boolean; stereoStrongLeft: boolean; stereoHeadsetEffects: number; usesHeadsetPanEffects: boolean;
  reverbIndex: number; bookOffset: number; isSyntheticWave: boolean; hasTwoAdpcmParts: boolean; bankId: number;
  headsetPanRight: number; headsetPanLeft: number; reverbVol: number;
  targetVolLeft: number; targetVolRight: number; resamplingRateFixedPoint: number;
  sound: Sound | null; samples: Int16Array | null;
}
const zeroSub = (): NoteSub => ({
  enabled: false, needsInit: false, finished: false, envMixerNeedsInit: false, stereoStrongRight: false, stereoStrongLeft: false,
  stereoHeadsetEffects: 0, usesHeadsetPanEffects: false, reverbIndex: 0, bookOffset: 0, isSyntheticWave: false, hasTwoAdpcmParts: false,
  bankId: 0, headsetPanRight: 0, headsetPanLeft: 0, reverbVol: 0, targetVolLeft: 0, targetVolRight: 0, resamplingRateFixedPoint: 0,
  sound: null, samples: null,
});

class Note {
  item = new ListItem<Note>();
  priority = 0; waveId = 0; sampleCountIndex = 0;
  portamentoFreqScale = 1; vibratoFreqScale = 1;
  prevParentLayer: Layer | null = null; parentLayer: Layer | null = null; wantedParentLayer: Layer | null = null;
  attributes = { reverbVol: 0, pan: 0, freqScale: 0, velocity: 0 };
  adsr: AdsrState;
  portamento: Portamento = { mode: 0, cur: 0, speed: 0, extent: 0 };
  vibrato = { channel: null as Channel | null, time: 0, extent: 0, rate: 0, active: false, rateChangeTimer: 0, extentChangeTimer: 0, delay: 0 };
  sub: NoteSub = zeroSub();
  // NoteSynthesisState and the RSP resampler state
  restart = false; samplePosInt = 0; samplePosFrac = 0; curVolLeft = 0; curVolRight = 0;
  rpos = -4; racc = 0; twoParts = false;
  constructor(env: EnvRef) {
    this.item.value = this;
    this.adsr = { action: 0, state: 0, envIndex: 0, delay: 0, sustain: 0, velocity: 0, fadeOutVel: 0, current: 0, target: 0, envelope: env };
  }
}

interface Prepared { buf: Int16Array; wrapAt: number; wrapLen: number; end: number; looped: boolean }

class Reverb {
  ringL: Int16Array; ringR: Int16Array; bufSize: number; next = 0;
  startPos = 0; lengthA = 0; lengthB = 0;
  constructor(readonly ds: number, windowSize: number, readonly gain: number) {
    this.bufSize = windowSize * 64;
    this.ringL = new Int16Array(this.bufSize);
    this.ringR = new Int16Array(this.bufSize);
  }
}

export interface EngineOptions { preset: number; soundMode?: number; tvFactor?: number }

export class Engine {
  readonly preset: Preset;
  readonly numNotes: number;
  readonly frequency: number;
  readonly updatesPerFrame: number;
  readonly samplesPerFrameTarget: number;
  readonly samplesPerUpdate: number;
  readonly samplesPerUpdateMax: number;
  readonly samplesPerUpdateMin: number;
  readonly tempoInternalToExternal: number;
  readonly updatesPerFrameInv: number;
  readonly unkUpdatesPerFrameScaled: number;
  readonly soundMode: number;
  readonly defaultEnv: EnvRef;
  readonly notes: Note[] = [];
  readonly noteFreeLists = new NotePool();
  readonly layerFreeList = ListItem.head<Layer>(null);
  readonly channelPool: Channel[] = [];
  readonly channelNone: Channel;
  readonly players: SeqPlayer[] = [];
  readonly reverbs: Reverb[];
  private readonly prepared = new Map<Sample, Prepared>();
  readonly dl = new Int32Array(384);
  readonly dr = new Int32Array(384);
  private readonly wl = new Int32Array(384);
  private readonly wr = new Int32Array(384);
  private readonly tmp = new Int32Array(384);
  onSeqJump: (player: number, from: number, to: number) => void = () => {};
  stats = { allocFailures: 0, maxActive: 0, noteOns: 0, undefinedOps: new Set<string>(), usedOps: new Set<string>(), usedInst: new Set<string>(), usedSamples: new Set<number>() };
  curPlayer = 0;

  constructor(readonly a: MK64Audio, readonly t: Tables, opts: EngineOptions) {
    this.preset = t.presets[opts.preset];
    this.soundMode = opts.soundMode ?? SOUND_MODE_STEREO;
    this.defaultEnv = { bytes: t.rom, off: t.defaultEnv };
    // audio_reset_session (NTSC, gRefreshRate 60)
    this.frequency = this.preset.frequency;
    this.samplesPerFrameTarget = (Math.trunc(this.frequency / 60) + 15) & ~15;
    this.updatesPerFrame = Math.trunc((this.samplesPerFrameTarget + 16) / 192) + 1;
    this.samplesPerUpdate = Math.trunc(this.samplesPerFrameTarget / this.updatesPerFrame) & ~7;
    this.samplesPerUpdateMax = this.samplesPerUpdate + 8;
    this.samplesPerUpdateMin = this.samplesPerUpdate - 8;
    this.unkUpdatesPerFrameScaled = fround(fround(0.001171875) / this.updatesPerFrame);
    this.updatesPerFrameInv = fround(1 / this.updatesPerFrame);
    const tv = fround(opts.tvFactor ?? t.tvFactorNtsc);
    this.tempoInternalToExternal = s16(Math.trunc(fround(fround(fround(this.updatesPerFrame * 2880000.0) / t.tatumsPerBeat) / tv)) >>> 0);
    this.numNotes = this.preset.maxNotes;
    for (let i = 0; i < this.numNotes; i++) {
      const n = new Note(this.defaultEnv);
      this.notes.push(n);
      pushBack(this.noteFreeLists.disabled, n.item);
    }
    for (let i = 0; i < 64; i++) pushBack(this.layerFreeList, new Layer(this.defaultEnv).item);
    for (let i = 0; i < 48; i++) this.channelPool.push(new Channel(this.defaultEnv));
    this.channelNone = new Channel(this.defaultEnv);
    this.channelNone.valid = false;
    for (let i = 0; i < 4; i++) {
      const P = new SeqPlayer();
      P.channels = new Array(16).fill(this.channelNone);
      this.players.push(P);
      this.initSequencePlayer(P);
    }
    this.reverbs = this.preset.reverbs.map((r) => new Reverb(r.downsampleRate, r.windowSize, r.gain));
  }

  // ---- data access ----

  instrumentInner(bankId: number, instId: number): Instrument | null {
    const b = this.a.bank(bankId);
    if (instId >= b.numInstruments) return null;
    return b.instruments[instId];
  }

  getDrum(bankId: number, drumId: number) {
    const b = this.a.bank(bankId);
    if (drumId >= b.numDrums) return null;
    if (!b.drumList) return null; // drum table pointer not relocated
    return b.drums[drumId];
  }

  envRef(off: number): EnvRef { return { bytes: this.t.rom, off }; }

  prepare(s: Sample): Prepared {
    let p = this.prepared.get(s);
    if (p) return p;
    const rom = this.t.rom;
    const frames = Math.floor(s.size / 9);
    const looped = s.loopCount !== 0 && s.loopEnd > s.loopStart;
    const end = s.loopEnd;
    if (looped) {
      const loopLen = s.loopEnd - s.loopStart;
      const pcm = new Int16Array(frames * 16);
      decodeVadpcm(rom, s.addr, frames, s.book, new Int16Array(16), pcm, 0);
      const body = new Int16Array(loopLen);
      const hist = s.loopState!.slice();
      let n = 0;
      for (let i = s.loopStart & 15; i < 16 && n < loopLen; i++) body[n++] = hist[i];
      const frame = new Int16Array(16);
      for (let f = (s.loopStart >> 4) + 1; n < loopLen; f++) {
        if (f < frames) decodeVadpcm(rom, s.addr + 9 * f, 1, s.book, hist, frame, 0);
        else frame.fill(0);
        for (let i = 0; i < 16 && n < loopLen; i++) body[n++] = frame[i];
      }
      const buf = new Int16Array(s.loopEnd + loopLen + 16);
      buf.set(pcm.subarray(0, Math.min(pcm.length, s.loopEnd)));
      buf.set(body, s.loopEnd);
      for (let i = 0; i < 16; i++) buf[s.loopEnd + loopLen + i] = body[i % loopLen];
      p = { buf, wrapAt: s.loopEnd + loopLen, wrapLen: loopLen, end: Infinity, looped: true };
    } else {
      const pcm = new Int16Array(Math.max(frames, Math.ceil(end / 16)) * 16);
      decodeVadpcm(rom, s.addr, frames, s.book, new Int16Array(16), pcm, 0);
      const buf = new Int16Array(end + 16);
      buf.set(pcm.subarray(0, end));
      p = { buf, wrapAt: Infinity, wrapLen: 0, end, looped: false };
    }
    this.prepared.set(s, p);
    return p;
  }

  // ---- effects.c: envelope, vibrato, portamento, channel/player sound processing ----

  adsrInit(adsr: AdsrState, env: EnvRef) {
    adsr.action = 0; adsr.state = 0; adsr.delay = 0; adsr.envelope = env; adsr.sustain = 0; adsr.current = 0;
  }

  adsrUpdate(adsr: AdsrState): number {
    const action = adsr.action, state = adsr.state;
    sw: switch (state) {
      case 0:
        return 0;
      case 1: case 2: case 3: case 4: {
        let st = state;
        if (st === 1 && action & 0x40) { adsr.state = 5; break sw; }
        if (st === 1 || st === 2) { adsr.envIndex = 0; adsr.state = 3; st = 3; }
        if (st === 3) {
          for (;;) {
            adsr.delay = envS16(adsr.envelope, 4 * adsr.envIndex);
            const arg = envS16(adsr.envelope, 4 * adsr.envIndex + 2);
            if (adsr.delay === 0) { adsr.state = 0; break; }
            if (adsr.delay === -1) { adsr.state = 5; break; }
            if (adsr.delay === -2) { adsr.envIndex = arg; continue; }
            if (adsr.delay === -3) { adsr.state = 1; break; }
            if (adsr.delay >= 4) adsr.delay = s16(Math.trunc(Math.trunc((adsr.delay * this.updatesPerFrame) / this.preset.unk1) / 4));
            if (adsr.delay === 0) adsr.delay = 1;
            const tgt = fround(arg / 32767.0);
            adsr.target = fround(tgt * tgt);
            adsr.velocity = fround((adsr.target - adsr.current) / adsr.delay);
            adsr.state = 4;
            adsr.envIndex++;
            break;
          }
          if (adsr.state !== 4) break sw;
        }
        adsr.current = fround(adsr.current + adsr.velocity);
        adsr.delay = s16(adsr.delay - 1);
        if (adsr.delay <= 0) adsr.state = 3;
        break;
      }
      case 5:
        break;
      case 6: case 7:
        adsr.current = fround(adsr.current - adsr.fadeOutVel);
        if (adsr.sustain !== 0 && state === 6) {
          if (adsr.current < adsr.sustain) { adsr.current = adsr.sustain; adsr.delay = 128; adsr.state = 8; }
          break;
        }
        if (adsr.current < 0.00001) { adsr.current = 0; adsr.state = 0; }
        break;
      case 8:
        adsr.delay = s16(adsr.delay - 1);
        if (adsr.delay === 0) adsr.state = 7;
        break;
    }
    if (action & 0x20) { adsr.state = 6; adsr.action = action & ~0x20; }
    if (action & 0x10) { adsr.state = 7; adsr.action = action & ~0x10; }
    if (adsr.current < 0) return 0;
    if (adsr.current > 1) return 1;
    return adsr.current;
  }

  vibratoInit(n: Note) {
    n.vibratoFreqScale = 1;
    n.portamentoFreqScale = 1;
    const v = n.vibrato, ch = n.parentLayer!.seqChannel!;
    v.active = true;
    v.time = 0;
    v.channel = ch;
    if ((v.extentChangeTimer = ch.vibratoExtentChangeDelay) === 0) v.extent = ch.vibratoExtentTarget;
    else v.extent = ch.vibratoExtentStart;
    if ((v.rateChangeTimer = ch.vibratoRateChangeDelay) === 0) v.rate = ch.vibratoRateTarget;
    else v.rate = ch.vibratoRateStart;
    v.delay = ch.vibratoDelay;
    Object.assign(n.portamento, n.parentLayer!.portamento);
  }

  vibratoUpdate(n: Note) {
    if (n.portamento.mode !== 0) {
      const p = n.portamento;
      p.cur = fround(p.cur + p.speed);
      let v0 = Math.trunc(p.cur) >>> 0;
      if (v0 > 127) v0 = 127;
      n.portamentoFreqScale = fround(1 + fround(p.extent * (this.t.pitchBend[v0 + 128] - 1)));
    }
    const v = n.vibrato;
    if (!v.active || n.parentLayer === null) return;
    const ch = v.channel!;
    if (v.delay !== 0) { v.delay--; n.vibratoFreqScale = 1; return; }
    if (v.extentChangeTimer) {
      if (v.extentChangeTimer === 1) v.extent = ch.vibratoExtentTarget;
      else v.extent = fround(v.extent + fround((ch.vibratoExtentTarget - v.extent) / v.extentChangeTimer));
      v.extentChangeTimer--;
    } else if (ch.vibratoExtentTarget !== Math.trunc(v.extent)) {
      if ((v.extentChangeTimer = ch.vibratoExtentChangeDelay) === 0) v.extent = ch.vibratoExtentTarget;
    }
    if (v.rateChangeTimer) {
      if (v.rateChangeTimer === 1) v.rate = ch.vibratoRateTarget;
      else v.rate = fround(v.rate + fround((ch.vibratoRateTarget - v.rate) / v.rateChangeTimer));
      v.rateChangeTimer--;
    } else if (ch.vibratoRateTarget !== Math.trunc(v.rate)) {
      if ((v.rateChangeTimer = ch.vibratoRateChangeDelay) === 0) v.rate = ch.vibratoRateTarget;
    }
    if (v.extent === 0) { n.vibratoFreqScale = 1; return; }
    v.time = (v.time + Math.trunc(v.rate)) >>> 0;
    const pitchChange = this.t.waves[2][(v.time >> 10) & 0x3f] >> 8;
    n.vibratoFreqScale = fround(1 + fround(v.extent / 4096) * (this.t.pitchBend[pitchChange + 128] - 1));
  }

  channelProcessSound(ch: Channel, recalc: boolean) {
    const P = ch.seqPlayer!;
    if (ch.changes & 2 || recalc) {
      let v = fround(fround(ch.volume * ch.volumeScale) * P.appliedFadeVolume);
      if (P.muted && ch.muteBehavior & 0x20) v = fround(P.muteVolumeScale * v);
      ch.appliedVolume = fround(v * v);
    }
    if (ch.changes & 4) ch.pan = ch.newPan * ch.panChannelWeight;
    for (const L of ch.layers) {
      if (!L || !L.enabled || L.note === null) continue;
      if (L.notePropertiesNeedInit) {
        L.noteFreqScale = fround(L.freqScale * ch.freqScale);
        L.noteVelocity = fround(L.velocitySquare * ch.appliedVolume);
        L.notePan = (ch.pan + L.pan * (0x80 - ch.panChannelWeight)) >> 7;
        L.notePropertiesNeedInit = false;
      } else {
        if (ch.changes & 1) L.noteFreqScale = fround(L.freqScale * ch.freqScale);
        if (ch.changes & 2 || recalc) L.noteVelocity = fround(L.velocitySquare * ch.appliedVolume);
        if (ch.changes & 4) L.notePan = (ch.pan + L.pan * (0x80 - ch.panChannelWeight)) >> 7;
      }
    }
    ch.changes = 0;
  }

  playerProcessSound(P: SeqPlayer) {
    if (P.fadeRemainingFrames !== 0) {
      P.fadeVolume = fround(P.fadeVolume + P.fadeVelocity);
      P.recalculateVolume = true;
      if (P.fadeVolume > 1) P.fadeVolume = 1;
      if (P.fadeVolume < 0) P.fadeVolume = 0;
      P.fadeRemainingFrames = u16(P.fadeRemainingFrames - 1);
      if (P.fadeRemainingFrames === 0 && P.state === 2) { this.playerDisable(P); return; }
    }
    if (P.recalculateVolume) P.appliedFadeVolume = fround(P.fadeVolume * P.fadeVolumeScale);
    for (const ch of P.channels) if (ch.valid && ch.enabled) this.channelProcessSound(ch, P.recalculateVolume);
    P.recalculateVolume = false;
  }

  // ---- playback.c ----

  noteSetVelPanReverb(n: Note, velocity: number, pan: number, reverbVol: number) {
    const sub = n.sub;
    let volLeft: number, volRight: number;
    pan &= 0x7f;
    if (sub.stereoHeadsetEffects && this.soundMode === SOUND_MODE_HEADSET) {
      const QUANT = [0x40, 0x40, 0x30, 0x30, 0x20, 0x20, 0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      let idx = pan >> 3;
      if (idx >= 16) idx = 15;
      sub.headsetPanLeft = QUANT[idx];
      sub.headsetPanRight = QUANT[15 - idx];
      sub.stereoStrongRight = false;
      sub.stereoStrongLeft = false;
      sub.usesHeadsetPanEffects = true;
      volLeft = this.t.panHeadset[pan];
      volRight = this.t.panHeadset[127 - pan];
    } else if (sub.stereoHeadsetEffects && this.soundMode === SOUND_MODE_STEREO) {
      sub.headsetPanRight = 0;
      sub.headsetPanLeft = 0;
      sub.usesHeadsetPanEffects = false;
      volLeft = this.t.panStereo[pan];
      volRight = this.t.panStereo[127 - pan];
      sub.stereoStrongLeft = pan < 0x20;
      sub.stereoStrongRight = pan > 0x60;
    } else if (this.soundMode === SOUND_MODE_MONO) {
      volLeft = fround(0.707);
      volRight = fround(0.707);
    } else {
      volLeft = this.t.panDefault[pan];
      volRight = this.t.panDefault[127 - pan];
    }
    if (velocity < 0) velocity = 0;
    if (velocity > 1) velocity = 1;
    sub.targetVolLeft = Math.trunc(fround(fround(velocity * volLeft) * fround(4095.999))) & 0xffff;
    sub.targetVolRight = Math.trunc(fround(fround(velocity * volRight) * fround(4095.999))) & 0xffff;
    if (sub.reverbVol !== reverbVol) {
      sub.reverbVol = reverbVol;
      sub.envMixerNeedsInit = true;
      return;
    }
    sub.envMixerNeedsInit = sub.needsInit;
  }

  noteSetResamplingRate(n: Note, input: number) {
    let rate: number;
    const sub = n.sub;
    if (input < 0) input = 0;
    const MAX = fround(1.9999599);
    if (input < 2) {
      sub.hasTwoAdpcmParts = false;
      rate = MAX < input ? MAX : input;
    } else {
      sub.hasTwoAdpcmParts = true;
      rate = fround(2 * MAX) < input ? MAX : fround(input * 0.5);
    }
    sub.resamplingRateFixedPoint = Math.trunc(fround(rate * 32768)) & 0xffff;
  }

  noteInit(n: Note) {
    const L = n.parentLayer!;
    this.adsrInit(n.adsr, L.adsr.releaseRate === 0 ? L.seqChannel!.adsr.envelope : L.adsr.envelope);
    n.adsr.state = 1;
    Object.assign(n.sub, zeroSub(), { enabled: true, needsInit: true });
  }

  noteDisable(n: Note) {
    if (n.sub.needsInit) n.sub.needsInit = false;
    else this.noteSetVelPanReverb(n, 0, 0x40, 0);
    n.priority = 0;
    n.parentLayer = null;
    n.prevParentLayer = null;
    n.sub.enabled = false;
    n.sub.finished = false;
  }

  processNotes() {
    for (let i = 0; i < this.numNotes; i++) {
      const n = this.notes[i];
      skip: {
        if (n.parentLayer !== null) {
          const L = n.parentLayer;
          let release = false;
          if (!L.enabled && n.priority >= 2) release = true;
          else if (L.seqChannel!.seqPlayer === null) {
            this.channelDisable(L.seqChannel!);
            n.priority = 1;
            continue;
          } else if (L.seqChannel!.seqPlayer.muted && L.seqChannel!.muteBehavior & 0xc0) release = true;
          if (release) {
            this.layerNoteRelease(L);
            listRemove(n.item);
            pushFront(n.item.pool!.decaying, n.item);
            n.priority = 1;
          }
        } else if (n.priority >= 2) {
          continue;
        }
        if (n.priority === 0) continue;
        const sub = n.sub;
        if (n.priority === 1 || sub.finished) {
          if (n.adsr.state === 0 || sub.finished) {
            if (n.wantedParentLayer !== null) {
              this.noteDisable(n);
              if (n.wantedParentLayer.seqChannel !== null) {
                this.noteInitForLayer(n, n.wantedParentLayer);
                this.vibratoInit(n);
                listRemove(n.item);
                pushBack(n.item.pool!.active, n.item);
                n.wantedParentLayer = null;
              } else {
                this.noteDisable(n);
                listRemove(n.item);
                pushBack(n.item.pool!.disabled, n.item);
                n.wantedParentLayer = null;
                break skip;
              }
            } else {
              this.noteDisable(n);
              listRemove(n.item);
              pushBack(n.item.pool!.disabled, n.item);
              break skip;
            }
          }
        } else if (n.adsr.state === 0) {
          this.noteDisable(n);
          listRemove(n.item);
          pushBack(n.item.pool!.disabled, n.item);
          break skip;
        }
        const scale = this.adsrUpdate(n.adsr);
        this.vibratoUpdate(n);
        let frequency: number, velocity: number, pan: number, reverbVol: number, bookOffset: number;
        if (n.priority === 1) {
          ({ freqScale: frequency, velocity, pan, reverbVol } = n.attributes);
          bookOffset = sub.bookOffset;
        } else {
          const L = n.parentLayer!;
          frequency = L.noteFreqScale; velocity = L.noteVelocity; pan = L.notePan;
          reverbVol = L.seqChannel!.reverbVol; bookOffset = L.seqChannel!.bookOffset & 7;
        }
        frequency = fround(frequency * fround(n.vibratoFreqScale * n.portamentoFreqScale));
        velocity = fround(velocity * scale);
        this.noteSetResamplingRate(n, frequency);
        this.noteSetVelPanReverb(n, velocity, pan, reverbVol);
        sub.bookOffset = bookOffset;
      }
    }
  }

  layerDecayReleaseInternal(L: Layer | null, target: 6 | 7) {
    if (L === null || L.note === null) return;
    const n = L.note;
    if (n.wantedParentLayer === L) n.wantedParentLayer = null;
    if (n.parentLayer !== L) {
      if (n.parentLayer === null && n.wantedParentLayer === null && n.prevParentLayer === L && target !== 6) {
        n.adsr.fadeOutVel = this.updatesPerFrameInv;
        n.adsr.action |= 0x10;
      }
      return;
    }
    L.status = 0;
    if (n.adsr.state !== 6) {
      n.attributes.freqScale = L.noteFreqScale;
      n.attributes.velocity = L.noteVelocity;
      n.attributes.pan = L.notePan;
      if (L.seqChannel !== null) n.attributes.reverbVol = L.seqChannel.reverbVol;
      n.priority = 1;
      n.prevParentLayer = n.parentLayer;
      n.parentLayer = null;
      if (target === 7) {
        n.adsr.fadeOutVel = this.updatesPerFrameInv;
        n.adsr.action |= 0x10;
      } else {
        n.adsr.action |= 0x20;
        const rr = L.adsr.releaseRate === 0 ? L.seqChannel!.adsr.releaseRate : L.adsr.releaseRate;
        n.adsr.fadeOutVel = fround(rr * this.unkUpdatesPerFrameScaled);
        n.adsr.sustain = fround(fround(L.seqChannel!.adsr.sustain * n.adsr.current) / 256.0);
      }
    }
    if (target === 6) {
      listRemove(n.item);
      pushFront(n.item.pool!.decaying, n.item);
    }
  }
  layerNoteDecay(L: Layer | null) { this.layerDecayReleaseInternal(L, 6); }
  layerNoteRelease(L: Layer | null) { this.layerDecayReleaseInternal(L, 7); }

  buildSyntheticWave(n: Note, L: Layer, waveId: number) {
    if (waveId < 128) waveId = 128;
    let freqScale = L.freqScale;
    if (L.portamento.mode !== 0 && 0 < L.portamento.extent) freqScale = fround(freqScale * (L.portamento.extent + 1));
    let idx: number, ratio: number;
    if (freqScale < 1) { idx = 0; ratio = 1.0465; }
    else if (freqScale < 2) { idx = 1; ratio = 0.52325; }
    else if (freqScale < 4) { idx = 2; ratio = 0.26263; }
    else { idx = 3; ratio = 0.13081; }
    L.freqScale = fround(L.freqScale * fround(ratio));
    n.waveId = waveId;
    n.sampleCountIndex = idx;
    n.sub.samples = this.t.waves[(waveId - 128) % 6].subarray(idx * 64, idx * 64 + 64);
    return idx;
  }

  initSyntheticWave(n: Note, L: Layer) {
    const SCALE = [0x40, 0x20, 0x10, 0x08];
    let waveId = L.instOrWave;
    if (waveId === 0xff) waveId = L.seqChannel!.instOrWave;
    const old = n.sampleCountIndex;
    const idx = this.buildSyntheticWave(n, L, waveId);
    n.samplePosInt = Math.trunc((n.samplePosInt * SCALE[idx]) / SCALE[old]);
  }

  noteInitForLayer(n: Note, L: Layer) {
    const ch = L.seqChannel!;
    n.prevParentLayer = null;
    n.parentLayer = L;
    n.priority = ch.notePriority;
    L.notePropertiesNeedInit = true;
    L.status = 4;
    L.note = n;
    L.noteVelocity = 0;
    this.noteInit(n);
    let instId = L.instOrWave;
    if (instId === 0xff) instId = ch.instOrWave;
    n.sub.sound = L.sound;
    n.sub.isSyntheticWave = instId >= 0x80;
    if (n.sub.isSyntheticWave) this.buildSyntheticWave(n, L, instId);
    n.sub.bankId = ch.bankId;
    n.sub.stereoHeadsetEffects = ch.stereoHeadsetEffects;
    n.sub.reverbIndex = ch.reverbIndex & 3;
    this.stats.noteOns++;
    if (instId > 0 && instId < 0x80) this.stats.usedInst.add(`${ch.bankId}:i${instId - 1}`);
    if (L.sound?.sample) this.stats.usedSamples.add(L.sound.sample.hdr);
  }

  noteReleaseAndTakeOwnership(n: Note, L: Layer) {
    n.wantedParentLayer = L;
    n.priority = 1;
    n.adsr.fadeOutVel = this.updatesPerFrameInv;
    n.adsr.action |= 0x10;
  }

  allocFromDisabled(pool: NotePool, L: Layer) {
    const n = popBack(pool.disabled);
    if (n) { this.noteInitForLayer(n, L); pushFront(pool.active, n.item); }
    return n;
  }
  allocFromDecaying(pool: NotePool, L: Layer) {
    const n = popBack(pool.decaying);
    if (n) { this.noteReleaseAndTakeOwnership(n, L); pushBack(pool.releasing, n.item); }
    return n;
  }
  popNodeWithLowerPrio(list: ListItem<Note>, limit: number): Note | null {
    let cur = list.next!;
    if (cur === list) return null;
    let best = cur;
    for (; cur !== list; cur = cur.next!) if (best.value!.priority >= cur.value!.priority) best = cur;
    if (limit <= best.value!.priority) return null;
    listRemove(best);
    return best.value;
  }
  allocFromActive(pool: NotePool, L: Layer) {
    const n = this.popNodeWithLowerPrio(pool.active, L.seqChannel!.notePriority);
    if (n) {
      this.layerNoteRelease(n.parentLayer);
      n.wantedParentLayer = L;
      pushBack(pool.releasing, n.item);
    }
    return n;
  }

  allocNote(L: Layer): Note | null {
    const ch = L.seqChannel!, policy = ch.noteAllocPolicy;
    if (policy & 1) {
      const n = L.note;
      if (n !== null && n.prevParentLayer === L && n.wantedParentLayer === null) {
        this.noteReleaseAndTakeOwnership(n, L);
        listRemove(n.item);
        pushBack(n.item.pool!.releasing, n.item);
        return n;
      }
    }
    const cp = ch.notePool, pp = ch.seqPlayer!.notePool, g = this.noteFreeLists;
    let order: [number, NotePool][];
    if (policy & 2) order = [[0, cp], [1, cp], [2, cp]];
    else if (policy & 4) order = [[0, cp], [0, pp], [1, cp], [1, pp], [2, cp], [2, pp]];
    else if (policy & 8) order = [[0, g], [1, g], [2, g]];
    else order = [[0, cp], [0, pp], [0, g], [1, cp], [1, pp], [1, g], [2, cp], [2, pp], [2, g]];
    for (const [kind, pool] of order) {
      const n = kind === 0 ? this.allocFromDisabled(pool, L) : kind === 1 ? this.allocFromDecaying(pool, L) : this.allocFromActive(pool, L);
      if (n) return n;
    }
    L.status = 0;
    this.stats.allocFailures++;
    return null;
  }

  notePoolClear(pool: NotePool) {
    const g = this.noteFreeLists;
    for (const [src, dst] of [[pool.disabled, g.disabled], [pool.decaying, g.decaying], [pool.releasing, g.releasing], [pool.active, g.active]]) {
      for (;;) {
        const cur = src.next;
        if (cur === src || cur === null) break;
        listRemove(cur);
        pushBack(dst, cur);
      }
    }
  }

  notePoolFill(pool: NotePool, count: number) {
    this.notePoolClear(pool);
    const g = this.noteFreeLists;
    const pairs = [[g.disabled, pool.disabled], [g.decaying, pool.decaying], [g.releasing, pool.releasing], [g.active, pool.active]];
    for (let i = 0, j = 0; j < count; i++) {
      if (i === 4) return;
      const [src, dst] = pairs[i];
      while (j < count) {
        const n = popBack(src);
        if (n === null) break;
        pushBack(dst, n.item);
        j++;
      }
    }
  }

  // ---- seqplayer.c ----

  channelInit(ch: Channel) {
    ch.enabled = ch.finished = ch.stopScript = ch.stopSomething2 = ch.hasInstrument = false;
    ch.stereoHeadsetEffects = 0;
    ch.transposition = 0;
    ch.largeNotes = false;
    ch.bookOffset = 0;
    ch.changes = 0xff;
    ch.state.depth = 0;
    ch.newPan = 0x40;
    ch.panChannelWeight = 0x80;
    ch.reverbIndex = 0;
    ch.reverbVol = 0;
    ch.notePriority = 3;
    ch.delay = 0;
    ch.adsr = { envelope: this.defaultEnv, releaseRate: 0x20, sustain: 0 };
    ch.vibratoRateTarget = ch.vibratoRateStart = 0x800;
    ch.vibratoExtentTarget = ch.vibratoExtentStart = ch.vibratoRateChangeDelay = ch.vibratoExtentChangeDelay = ch.vibratoDelay = 0;
    ch.volume = 1;
    ch.volumeScale = 1;
    ch.freqScale = 1;
    ch.io.fill(-1);
    ch.notePool = new NotePool();
  }

  setLayer(ch: Channel, idx: number): number {
    let L = ch.layers[idx];
    if (L === null) {
      L = popBack(this.layerFreeList);
      ch.layers[idx] = L;
      if (L === null) return -1;
    } else {
      this.layerNoteDecay(L);
    }
    L.seqChannel = ch;
    L.adsr = { ...ch.adsr, releaseRate: 0 };
    L.enabled = true;
    L.stopSomething = false;
    L.continuousNotes = false;
    L.finished = false;
    L.ignoreDrumPan = false;
    L.portamento.mode = 0;
    L.state.depth = 0;
    L.status = 0;
    L.noteDuration = 0x80;
    L.pan = 0x40;
    L.transposition = 0;
    L.delay = 0;
    L.duration = 0;
    L.note = null;
    L.instrument = null;
    L.freqScale = 1;
    L.velocitySquare = 0;
    L.instOrWave = 0xff;
    return 0;
  }

  layerDisable(L: Layer | null) {
    if (L === null) return;
    this.layerNoteDecay(L);
    L.enabled = false;
    L.finished = true;
  }

  layerFree(ch: Channel, idx: number) {
    const L = ch.layers[idx];
    if (L === null) return;
    pushBack(this.layerFreeList, L.item);
    this.layerDisable(L);
    ch.layers[idx] = null;
  }

  channelDisable(ch: Channel) {
    for (let i = 0; i < 4; i++) this.layerFree(ch, i);
    this.notePoolClear(ch.notePool);
    ch.enabled = false;
    ch.finished = true;
  }

  allocateChannel(): Channel {
    for (const ch of this.channelPool) if (ch.seqPlayer === null) return ch;
    return this.channelNone;
  }

  playerInitChannels(P: SeqPlayer, bits: number) {
    for (let i = 0; i < 16; i++, bits >>= 1) {
      if (!(bits & 1)) continue;
      let ch = P.channels[i];
      if (ch.valid && ch.seqPlayer === P) {
        this.channelDisable(ch);
        ch.seqPlayer = null;
      }
      ch = this.allocateChannel();
      P.channels[i] = ch;
      if (!ch.valid) continue;
      this.channelInit(ch);
      ch.seqPlayer = P;
      ch.bankId = P.defaultBank;
      ch.muteBehavior = P.muteBehavior;
      ch.noteAllocPolicy = P.noteAllocPolicy;
    }
  }

  playerDisableChannels(P: SeqPlayer, bits: number) {
    for (let i = 0; i < 16; i++, bits >>= 1) {
      if (!(bits & 1)) continue;
      const ch = P.channels[i];
      if (!ch.valid) continue;
      if (ch.seqPlayer === P) {
        this.channelDisable(ch);
        ch.seqPlayer = null;
      }
      P.channels[i] = this.channelNone;
    }
  }

  channelEnable(P: SeqPlayer, idx: number, pc: number) {
    const ch = P.channels[idx];
    if (!ch.valid) return;
    ch.enabled = true;
    ch.finished = false;
    ch.state.depth = 0;
    ch.state.pc = pc;
    ch.delay = 0;
    for (let i = 0; i < 4; i++) if (ch.layers[i] !== null) this.layerFree(ch, i);
  }

  playerDisable(P: SeqPlayer) {
    this.playerDisableChannels(P, 0xffff);
    this.notePoolClear(P.notePool);
    P.finished = true;
    P.enabled = false;
  }

  initSequencePlayer(P: SeqPlayer) {
    this.playerDisable(P);
    P.delay = 0;
    P.state = 1;
    P.fadeRemainingFrames = 0;
    P.fadeTimerUnkEu = 0;
    P.tempoAcc = 0;
    P.tempo = 120 * 48;
    P.transposition = 0;
    P.noteAllocPolicy = 0;
    P.shortVelTable = -1;
    P.shortDurTable = -1;
    P.fadeVolume = 1;
    P.fadeVolumeScale = 1;
    P.fadeVelocity = 0;
    P.volume = 0;
    P.muteVolumeScale = 0.5;
  }

  getInstrument(ch: Channel, instId: number, adsr: AdsrSettings): { id: number; inst: Instrument | null } {
    const inst = this.instrumentInner(ch.bankId, instId);
    if (inst === null) return { id: 0, inst: null };
    adsr.envelope = this.envRef(inst.envelope);
    adsr.releaseRate = inst.releaseRate;
    return { id: u8(instId + 1), inst };
  }

  setInstrument(ch: Channel, instId: number) {
    if (instId >= 0x80) {
      ch.instOrWave = instId;
      ch.instrument = null;
    } else if (instId === 0x7f) {
      ch.instOrWave = 0;
      ch.instrument = null; // (struct Instrument*) 1 in the game; only read for instOrWave != 0
    } else {
      const r = this.getInstrument(ch, instId, ch.adsr);
      ch.instOrWave = r.id;
      ch.instrument = r.inst;
      if (r.id === 0) { ch.hasInstrument = false; return; }
    }
    ch.hasInstrument = true;
  }

  rd(s: Script, d: Uint8Array) { return d[s.pc++]; }
  rdS16(s: Script, d: Uint8Array) { const v = (d[s.pc] << 8) | d[s.pc + 1]; s.pc += 2; return s16(v); }
  rdVar(s: Script, d: Uint8Array) {
    let v = d[s.pc++];
    if (v & 0x80) v = ((v << 8) & 0x7f00) | d[s.pc++];
    return v;
  }

  bankFromSet(P: SeqPlayer, idx: number) {
    const set = this.a.bankSet(P.seqId);
    // gAlBankSets[(offset + count) - idx]: counted from the end; idx = count reads the count byte itself
    const k = set.length - idx - 1;
    return k >= 0 ? set[k] : set.length;
  }

  layerProcess(L: Layer) {
    let sameSound = true;
    if (!L.enabled) return;
    if (L.delay > 1) {
      L.delay = s16(L.delay - 1);
      if (!L.stopSomething && L.delay <= L.duration) {
        this.layerNoteDecay(L);
        L.stopSomething = true;
      }
      return;
    }
    if (!L.continuousNotes) this.layerNoteDecay(L);
    if ((L.portamento.mode & 0x7f) === 1 || (L.portamento.mode & 0x7f) === 2) L.portamento.mode = 0;
    const ch = L.seqChannel!, P = ch.seqPlayer!, d = P.seq, s = L.state;
    L.notePropertiesNeedInit = true;
    let cmd: number;
    for (;;) {
      cmd = d[s.pc++];
      if (cmd <= 0xc0) break;
      this.stats.usedOps.add(`layer.${cmd.toString(16)}`);
      switch (cmd) {
        case 0xff:
          if (s.depth === 0) { this.layerDisable(L); return; }
          s.pc = s.stack[--s.depth];
          break;
        case 0xfc: { const t = u16(this.rdS16(s, d)); s.stack[s.depth++] = s.pc; s.pc = t; break; }
        case 0xf8: s.loops[s.depth] = d[s.pc++]; s.stack[s.depth++] = s.pc; break;
        case 0xf7:
          s.loops[s.depth - 1] = u8(s.loops[s.depth - 1] - 1);
          if (s.loops[s.depth - 1] !== 0) s.pc = s.stack[s.depth - 1];
          else s.depth--;
          break;
        case 0xfb: s.pc = u16(this.rdS16(s, d)); break;
        case 0xf4: { const r = s8(d[s.pc++]); s.pc += r; break; }
        case 0xc1: { const v = d[s.pc++]; L.velocitySquare = fround((v * v) / 16129); break; }
        case 0xca: L.pan = d[s.pc++]; break;
        case 0xc2: L.transposition = d[s.pc++]; break;
        case 0xc9: L.noteDuration = d[s.pc++]; break;
        case 0xc4: case 0xc5: L.continuousNotes = cmd === 0xc4; this.layerNoteDecay(L); break;
        case 0xc3: L.shortNoteDefaultPlayPercentage = s16(this.rdVar(s, d)); break;
        case 0xc6: {
          const id = d[s.pc++];
          if (id >= 0x7f) {
            if (id === 0x7f) L.instOrWave = 0;
            else { L.instOrWave = id; L.instrument = null; }
            if (id === 0xff) L.adsr.releaseRate = 0;
            break;
          }
          const r = this.getInstrument(ch, id, L.adsr);
          L.instrument = r.inst;
          L.instOrWave = r.id === 0 ? 0xff : r.id;
          break;
        }
        case 0xc7: {
          L.portamento.mode = d[s.pc++];
          let note = u8(d[s.pc++] + ch.transposition + L.transposition + P.transposition);
          if (note >= 0x80) note = 0;
          L.portamentoTargetNote = note;
          if (L.portamento.mode & 0x80) { L.portamentoTime = d[s.pc++]; break; }
          L.portamentoTime = this.rdVar(s, d);
          break;
        }
        case 0xc8: L.portamento.mode = 0; break;
        case 0xcb: {
          const off = u16(this.rdS16(s, d));
          L.adsr.envelope = { bytes: d, off };
          L.adsr.releaseRate = d[s.pc++];
          break;
        }
        case 0xcc: L.ignoreDrumPan = true; break;
        default:
          if ((cmd & 0xf0) === 0xd0) {
            const v = P.shortVelTable < 0 ? this.t.shortVel[cmd & 15] : d[P.shortVelTable + (cmd & 15)];
            L.velocitySquare = fround((v * v) / 16129);
          } else if ((cmd & 0xf0) === 0xe0) {
            L.noteDuration = P.shortDurTable < 0 ? this.t.shortDur[cmd & 15] : d[P.shortDurTable + (cmd & 15)];
          } else {
            this.stats.undefinedOps.add(`layer ${cmd.toString(16)}`);
          }
      }
    }
    if (cmd === 0xc0) {
      L.delay = s16(this.rdVar(s, d));
      L.stopSomething = true;
    } else {
      L.stopSomething = false;
      let sp3A = 0;
      if (ch.largeNotes) {
        let vel = 0;
        switch (cmd & 0xc0) {
          case 0x00: sp3A = this.rdVar(s, d); vel = d[s.pc++]; L.noteDuration = d[s.pc++]; L.playPercentage = s16(sp3A); break;
          case 0x40: sp3A = this.rdVar(s, d); vel = d[s.pc++]; L.noteDuration = 0; L.playPercentage = s16(sp3A); break;
          case 0x80: sp3A = u16(L.playPercentage); vel = d[s.pc++]; L.noteDuration = d[s.pc++]; break;
        }
        if (vel >= 0x80 || vel < 0) vel = 0x7f;
        cmd -= cmd & 0xc0;
        L.velocitySquare = fround(fround(vel * vel) / 16129);
      } else {
        switch (cmd & 0xc0) {
          case 0x00: sp3A = this.rdVar(s, d); L.playPercentage = s16(sp3A); break;
          case 0x40: sp3A = u16(L.shortNoteDefaultPlayPercentage); break;
          case 0x80: sp3A = u16(L.playPercentage); break;
        }
        cmd -= cmd & 0xc0;
      }
      L.delay = s16(sp3A);
      L.duration = s16((L.noteDuration * sp3A) >> 8);
      if ((P.muted && ch.muteBehavior & 0x40) || ch.stopSomething2) {
        L.stopSomething = true;
      } else {
        let temp = L.instOrWave;
        if (temp === 0xff) {
          if (!ch.hasInstrument) return;
          temp = ch.instOrWave;
        }
        if (temp === 0) { // drum
          cmd = u8(cmd + ch.transposition + L.transposition);
          const drum = this.getDrum(ch.bankId, cmd);
          if (drum === null) { L.stopSomething = true; return; }
          this.stats.usedInst.add(`${ch.bankId}:d${cmd}`);
          L.adsr.envelope = this.envRef(drum.envelope);
          L.adsr.releaseRate = drum.releaseRate;
          if (!L.ignoreDrumPan) L.pan = drum.pan;
          L.sound = drum.sound;
          L.freqScale = drum.sound.tuning;
        } else {
          cmd = u8(cmd + P.transposition + ch.transposition + L.transposition);
          if (cmd >= 0x80) {
            L.stopSomething = true;
          } else {
            const inst = L.instOrWave === 0xff ? ch.instrument : L.instrument;
            if (L.portamento.mode !== 0) {
              const v = L.portamentoTargetNote < cmd ? cmd : L.portamentoTargetNote;
              let tuning: number;
              if (inst !== null) {
                const snd = soundFor(inst, v);
                sameSound = snd === L.sound;
                L.sound = snd;
                tuning = snd.tuning;
              } else {
                L.sound = null;
                tuning = 1;
              }
              const f2 = fround(this.t.noteFreq[cmd] * tuning), f12 = fround(this.t.noteFreq[L.portamentoTargetNote] * tuning);
              const mode = L.portamento.mode & 0x7f;
              const freqScale = mode === 1 || mode === 3 || mode === 5 ? f12 : f2;
              L.portamento.extent = fround(f2 / freqScale - 1);
              if (L.portamento.mode & 0x80) {
                L.portamento.speed = fround(fround(32512.0 * P.tempo) / fround(fround(L.delay * this.tempoInternalToExternal) * L.portamentoTime));
              } else {
                L.portamento.speed = fround(127.0 / L.portamentoTime);
              }
              L.portamento.cur = 0;
              L.freqScale = freqScale;
              if (mode === 5) L.portamentoTargetNote = cmd;
            } else if (inst !== null) {
              const snd = soundFor(inst, cmd);
              sameSound = snd === L.sound;
              L.sound = snd;
              L.freqScale = fround(this.t.noteFreq[cmd] * snd.tuning);
            } else {
              L.sound = null;
              L.freqScale = this.t.noteFreq[cmd];
            }
          }
        }
      }
    }
    if (L.stopSomething) {
      if (L.note !== null || L.continuousNotes) this.layerNoteDecay(L);
      return;
    }
    let alloc = false;
    if (!L.continuousNotes) alloc = true;
    else if (L.note === null || L.status === 0) alloc = true;
    else if (!sameSound) { this.layerNoteDecay(L); alloc = true; }
    else if (L !== L.note.parentLayer) alloc = true;
    else if (L.sound === null) this.initSyntheticWave(L.note, L);
    if (alloc) L.note = this.allocNote(L);
    if (L.note !== null && L.note.parentLayer === L) this.vibratoInit(L.note);
  }

  channelProcess(ch: Channel) {
    if (!ch.enabled) return;
    if (ch.stopScript) {
      for (const L of ch.layers) if (L !== null) this.layerProcess(L);
      return;
    }
    const P = ch.seqPlayer!, d = P.seq;
    if (P.muted && ch.muteBehavior & 0x80) return;
    if (ch.delay !== 0) ch.delay--;
    const s = ch.state;
    if (ch.delay === 0) {
      let value = P.chanValue;
      loop: for (;;) {
        const cmd = d[s.pc++];
        if (cmd > 0xc0) {
          this.stats.usedOps.add(`chan.${cmd.toString(16)}`);
          switch (cmd) {
            case 0xff:
              if (s.depth === 0) { this.channelDisable(ch); break loop; }
              s.pc = s.stack[--s.depth];
              break;
            case 0xfe: break loop;
            case 0xfd: ch.delay = this.rdVar(s, d); break loop;
            case 0xea: ch.stopScript = true; break loop;
            case 0xfc: { const t = u16(this.rdS16(s, d)); s.stack[s.depth++] = s.pc; s.pc = t; break; }
            case 0xf8: s.loops[s.depth] = d[s.pc++]; s.stack[s.depth] = s.pc; s.depth++; break;
            case 0xf7:
              s.loops[s.depth - 1] = u8(s.loops[s.depth - 1] - 1);
              if (s.loops[s.depth - 1] !== 0) s.pc = s.stack[s.depth - 1];
              else s.depth--;
              break;
            case 0xf6: s.depth--; break;
            case 0xf5: case 0xf9: case 0xfa: case 0xfb: {
              const t = u16(this.rdS16(s, d));
              if (cmd === 0xfa && value !== 0) break;
              if (cmd === 0xf9 && value >= 0) break;
              if (cmd === 0xf5 && value < 0) break;
              s.pc = t;
              break;
            }
            case 0xf2: case 0xf3: case 0xf4: {
              const r = s8(d[s.pc++]);
              if (cmd === 0xf3 && value !== 0) break;
              if (cmd === 0xf2 && value >= 0) break;
              s.pc += r;
              break;
            }
            case 0xf1: this.notePoolClear(ch.notePool); this.notePoolFill(ch.notePool, d[s.pc++]); break;
            case 0xf0: this.notePoolClear(ch.notePool); break;
            case 0xc2: ch.dynTable = u16(this.rdS16(s, d)); break;
            case 0xc5:
              if (value !== -1) { const p = ch.dynTable + 2 * value; ch.dynTable = u16((d[p] << 8) + d[p + 1]); }
              break;
            case 0xeb: {
              const b = this.bankFromSet(P, d[s.pc++]);
              ch.bankId = b;
              this.setInstrument(ch, d[s.pc++]);
              break;
            }
            case 0xc1: this.setInstrument(ch, d[s.pc++]); break;
            case 0xc3: ch.largeNotes = false; break;
            case 0xc4: ch.largeNotes = true; break;
            case 0xdf: ch.volume = fround(d[s.pc++] / 127.0); ch.changes |= 2; break;
            case 0xe0: ch.volumeScale = fround(d[s.pc++] / 128.0); ch.changes |= 2; break;
            case 0xde: ch.freqScale = fround(u16(this.rdS16(s, d)) / 32768.0); ch.changes |= 1; break;
            case 0xd3: ch.freqScale = this.t.pitchBend[u8(d[s.pc++] + 127)]; ch.changes |= 1; break;
            case 0xdd: ch.newPan = d[s.pc++]; ch.changes |= 4; break;
            case 0xdc: ch.panChannelWeight = d[s.pc++]; ch.changes |= 4; break;
            case 0xdb: ch.transposition = s8(d[s.pc++]); break;
            case 0xda: ch.adsr.envelope = { bytes: d, off: u16(this.rdS16(s, d)) }; break;
            case 0xd9: ch.adsr.releaseRate = d[s.pc++]; break;
            case 0xd8: ch.vibratoExtentTarget = d[s.pc++] * 8; ch.vibratoExtentStart = 0; ch.vibratoExtentChangeDelay = 0; break;
            case 0xd7: ch.vibratoRateStart = ch.vibratoRateTarget = d[s.pc++] * 32; ch.vibratoRateChangeDelay = 0; break;
            case 0xe2: ch.vibratoExtentStart = d[s.pc++] * 8; ch.vibratoExtentTarget = d[s.pc++] * 8; ch.vibratoExtentChangeDelay = d[s.pc++] * 16; break;
            case 0xe1: ch.vibratoRateStart = u16(d[s.pc++] << 5); ch.vibratoRateTarget = u16(d[s.pc++] << 5); ch.vibratoRateChangeDelay = d[s.pc++] * 16; break;
            case 0xe3: ch.vibratoDelay = d[s.pc++] * 16; break;
            case 0xd4: ch.reverbVol = d[s.pc++]; break;
            case 0xc6: ch.bankId = this.bankFromSet(P, d[s.pc++]); break;
            case 0xc7: { const c = d[s.pc++], off = u16(this.rdS16(s, d)); d[off] = u8(value + c); break; }
            case 0xc8: case 0xc9: case 0xcc: {
              const t = s8(d[s.pc++]);
              if (cmd === 0xc8) value = s8(value - t);
              else if (cmd === 0xcc) value = t;
              else value = s8(value & t);
              break;
            }
            case 0xca: ch.muteBehavior = d[s.pc++]; break;
            case 0xcb: { const p = u16(this.rdS16(s, d)) + value; value = s8(d[p]); break; }
            case 0xd0: ch.stereoHeadsetEffects = d[s.pc++] & 1; break;
            case 0xd1: ch.noteAllocPolicy = d[s.pc++]; break;
            case 0xd2: ch.adsr.sustain = d[s.pc++]; break;
            case 0xe5: ch.reverbIndex = d[s.pc++]; break;
            case 0xe4:
              if (value !== -1) {
                const p = ch.dynTable + 2 * value;
                s.stack[s.depth++] = s.pc;
                s.pc = u16((d[p] << 8) + d[p + 1]);
              }
              break;
            case 0xe6: ch.bookOffset = d[s.pc++]; break;
            case 0xe7: case 0xe8: {
              let p = cmd === 0xe7 ? u16(this.rdS16(s, d)) : s.pc;
              ch.muteBehavior = d[p++]; ch.noteAllocPolicy = d[p++]; ch.notePriority = d[p++]; ch.transposition = s8(d[p++]);
              ch.newPan = d[p++]; ch.panChannelWeight = d[p++]; ch.reverbVol = d[p++]; ch.reverbIndex = d[p++];
              if (cmd === 0xe8) s.pc = p;
              ch.changes |= 4;
              break;
            }
            case 0xec:
              ch.vibratoExtentTarget = ch.vibratoExtentStart = ch.vibratoExtentChangeDelay = 0;
              ch.vibratoRateTarget = ch.vibratoRateStart = ch.vibratoRateChangeDelay = 0;
              ch.freqScale = 1;
              break;
            case 0xe9: ch.notePriority = d[s.pc++]; break;
            case 0xef: s.pc += 3; break;
            default: this.stats.undefinedOps.add(`chan ${cmd.toString(16)}`); break;
          }
        } else {
          const lo = cmd & 15;
          this.stats.usedOps.add(`chan.${(cmd & 0xf0).toString(16)}n`);
          switch (cmd & 0xf0) {
            case 0x00: { const L = ch.layers[lo]; value = L !== null ? (L.finished ? 1 : 0) : -1; break; }
            case 0x70: ch.io[lo] = value; break;
            case 0x80: value = ch.io[lo]; if (lo < 4) ch.io[lo] = -1; break;
            case 0x50: value = s8(value - ch.io[lo]); break;
            case 0x60: ch.delay = lo; break loop;
            case 0x90: { const t = u16(this.rdS16(s, d)); if (this.setLayer(ch, lo) === 0) ch.layers[lo]!.state.pc = t; break; }
            case 0xa0: this.layerFree(ch, lo); break;
            case 0xb0:
              if (value !== -1 && this.setLayer(ch, lo) !== -1) {
                const p = ch.dynTable + 2 * value;
                ch.layers[lo]!.state.pc = u16((d[p] << 8) + d[p + 1]);
              }
              break;
            case 0x10: { const t = u16(this.rdS16(s, d)); this.channelEnable(P, lo, t); break; }
            case 0x20: this.channelDisable(P.channels[lo]); break;
            case 0x30: { const port = d[s.pc++]; P.channels[lo].io[port] = value; break; }
            case 0x40: { const port = d[s.pc++]; value = P.channels[lo].io[port]; break; }
            default: this.stats.undefinedOps.add(`chan ${cmd.toString(16)}`); break;
          }
        }
      }
      P.chanValue = value;
    }
    for (const L of ch.layers) if (L !== null) this.layerProcess(L);
  }

  playerProcess(P: SeqPlayer, index: number) {
    if (!P.enabled) return;
    if (P.muted && P.muteBehavior & 0x80) return;
    P.tempoAcc = u16(P.tempoAcc + P.tempo);
    if (P.tempoAcc < this.tempoInternalToExternal) return;
    P.tempoAcc = u16(P.tempoAcc - u16(this.tempoInternalToExternal));
    P.ticks++;
    const s = P.state_, d = P.seq;
    if (P.delay > 1) {
      P.delay--;
    } else {
      P.recalculateVolume = true;
      let value = P.value;
      for (;;) {
        const pc = s.pc;
        const cmd = d[s.pc++];
        if (cmd === 0xff) {
          if (s.depth === 0) { this.playerDisable(P); break; }
          s.pc = s.stack[--s.depth];
        }
        if (cmd === 0xfd) { P.delay = this.rdVar(s, d); break; }
        if (cmd === 0xfe) { P.delay = 1; break; }
        if (cmd >= 0xc0) {
          this.stats.usedOps.add(`seq.${cmd.toString(16)}`);
          switch (cmd) {
            case 0xff: break;
            case 0xfc: { const t = u16(this.rdS16(s, d)); s.stack[s.depth++] = s.pc; s.pc = t; break; }
            case 0xf8: s.loops[s.depth] = d[s.pc++]; s.stack[s.depth++] = s.pc; break;
            case 0xf7:
              s.loops[s.depth - 1] = u8(s.loops[s.depth - 1] - 1);
              if (s.loops[s.depth - 1] !== 0) { s.pc = s.stack[s.depth - 1]; this.onSeqJump(index, pc, s.pc); }
              else s.depth--;
              break;
            case 0xfb: case 0xfa: case 0xf9: case 0xf5: {
              const t = u16(this.rdS16(s, d));
              if (cmd === 0xfa && value !== 0) break;
              if (cmd === 0xf9 && value >= 0) break;
              if (cmd === 0xf5 && value < 0) break;
              s.pc = t;
              this.onSeqJump(index, pc, t);
              break;
            }
            case 0xf4: case 0xf3: case 0xf2: {
              const r = s8(d[s.pc++]);
              if (cmd === 0xf3 && value !== 0) break;
              if (cmd === 0xf2 && value >= 0) break;
              s.pc += r;
              this.onSeqJump(index, pc, s.pc);
              break;
            }
            case 0xf1: this.notePoolClear(P.notePool); this.notePoolFill(P.notePool, d[s.pc++]); break;
            case 0xf0: this.notePoolClear(P.notePool); break;
            case 0xdf: P.transposition = 0; // fallthrough
            // eslint-disable-next-line no-fallthrough
            case 0xde: P.transposition = s16(P.transposition + s8(d[s.pc++])); break;
            case 0xdc: case 0xdd: {
              const t = d[s.pc++];
              if (cmd === 0xdd) P.tempo = u16(t * 48);
              else P.tempo = u16(P.tempo + s8(t) * 48);
              if (P.tempo > this.tempoInternalToExternal) P.tempo = u16(this.tempoInternalToExternal);
              if (s16(P.tempo) <= 0) P.tempo = 1;
              break;
            }
            case 0xda: {
              const mode = d[s.pc++], t = u16(this.rdS16(s, d));
              if (mode === 0 || mode === 1) {
                if (P.state !== 2) { P.fadeTimerUnkEu = t; P.state = mode; }
              } else if (mode === 2) {
                P.fadeRemainingFrames = t;
                P.state = mode;
                P.fadeVelocity = fround((0 - P.fadeVolume) / t);
              }
              break;
            }
            case 0xdb: {
              const v = d[s.pc++];
              if (P.state === 2) break;
              if (P.state === 1) { P.state = 0; P.fadeVolume = 0; }
              if (P.state === 0) {
                P.fadeRemainingFrames = P.fadeTimerUnkEu;
                if (P.fadeTimerUnkEu !== 0) P.fadeVelocity = fround(fround(v / 127.0 - P.fadeVolume) / P.fadeRemainingFrames);
                else P.fadeVolume = fround(v / 127.0);
              }
              break;
            }
            case 0xd9: P.fadeVolumeScale = fround(s8(d[s.pc++]) / 127.0); break;
            case 0xd7: this.playerInitChannels(P, u16(this.rdS16(s, d))); break;
            case 0xd6: this.playerDisableChannels(P, u16(this.rdS16(s, d))); break;
            case 0xd5: P.muteVolumeScale = fround(s8(d[s.pc++]) / 127.0); break;
            case 0xd4: P.muted = true; break;
            case 0xd3: P.muteBehavior = d[s.pc++]; break;
            case 0xd2: P.shortVelTable = u16(this.rdS16(s, d)); break;
            case 0xd1: P.shortDurTable = u16(this.rdS16(s, d)); break;
            case 0xd0: P.noteAllocPolicy = d[s.pc++]; break;
            case 0xcc: value = d[s.pc++]; break;
            case 0xc9: value &= d[s.pc++]; break;
            case 0xc8: value = value - d[s.pc++]; break;
            default: this.stats.undefinedOps.add(`seq ${cmd.toString(16)}`); break;
          }
        } else {
          const lo = cmd & 15;
          this.stats.usedOps.add(`seq.${(cmd & 0xf0).toString(16)}n`);
          switch (cmd & 0xf0) {
            case 0x00: value = P.channels[lo].finished ? 1 : 0; break;
            case 0x50: value -= P.variation; break;
            case 0x70: P.variation = s8(value); break;
            case 0x80: value = P.variation; break;
            case 0x90: { const t = u16(this.rdS16(s, d)); this.channelEnable(P, lo, t); break; }
            default: break;
          }
        }
      }
      P.value = value;
    }
    for (const ch of P.channels) if (ch.valid) this.channelProcess(ch);
  }

  // load_sequence_internal + init_sequence_player, then port_eu 0x82's fade-in (func_800CBA64).
  loadSequence(player: number, seqId: number, fadeInUpdates: number) {
    const P = this.players[player];
    const id = this.a.resolveSeq(seqId);
    this.playerDisable(P);
    const set = this.a.bankSet(id);
    P.defaultBank = set[set.length - 1];
    P.seqId = id;
    this.initSequencePlayer(P);
    P.state_.depth = 0;
    P.delay = 0;
    P.enabled = true;
    P.seq = this.a.sequenceData(id);
    P.state_.pc = 0;
    if (fadeInUpdates !== 0) {
      P.state = 1;
      P.fadeTimerUnkEu = fadeInUpdates;
      P.fadeRemainingFrames = fadeInUpdates;
      P.fadeVolume = 0;
      P.fadeVelocity = 0;
    }
  }

  // process_sequences: players, then the notes.
  processSequences() {
    for (let i = 0; i < 4; i++) {
      const P = this.players[i];
      if (P.enabled) {
        this.curPlayer = i;
        this.playerProcess(P, i);
        this.playerProcessSound(P);
      }
    }
    this.processNotes();
  }

  // synthesis_load_note_subs_eu
  snapshot(): (NoteSub | null)[] {
    const out: (NoteSub | null)[] = [];
    let active = 0;
    for (const n of this.notes) {
      if (n.sub.enabled) {
        out.push({ ...n.sub });
        n.sub.needsInit = false;
        active++;
      } else out.push(null);
    }
    if (active > this.stats.maxActive) this.stats.maxActive = active;
    return out;
  }

  // ---- synthesis.c + rsp-hle NEAD MK ----

  // One audio frame: all updates' sequence processing first, then the RSP command list for each update's chunk.
  frame(bufLen: number, out: (l: Int32Array, r: Int32Array, len: number, update: number) => void) {
    const U = this.updatesPerFrame;
    const snaps: (NoteSub | null)[][] = [];
    for (let i = U; i > 0; i--) { this.processSequences(); snaps.push(this.snapshot()); }
    for (let i = U; i > 0; i--) {
      let chunk: number;
      if (i === 1) chunk = bufLen;
      else if (Math.trunc(bufLen / i) >= this.samplesPerUpdateMax) chunk = this.samplesPerUpdateMax;
      else if (Math.trunc(bufLen / i) <= this.samplesPerUpdateMin) chunk = this.samplesPerUpdateMin;
      else chunk = this.samplesPerUpdate;
      const u = U - i;
      for (const r of this.reverbs) this.prepareReverb(r, chunk);
      this.doOneUpdate(chunk, snaps, u);
      out(this.dl, this.dr, chunk, u);
      bufLen -= chunk;
    }
  }

  // Chunk lengths the game would use for a frame of bufLen samples.
  chunkLengths(bufLen: number): number[] {
    const out: number[] = [];
    for (let i = this.updatesPerFrame; i > 0; i--) {
      let chunk: number;
      if (i === 1) chunk = bufLen;
      else if (Math.trunc(bufLen / i) >= this.samplesPerUpdateMax) chunk = this.samplesPerUpdateMax;
      else if (Math.trunc(bufLen / i) <= this.samplesPerUpdateMin) chunk = this.samplesPerUpdateMin;
      else chunk = this.samplesPerUpdate;
      out.push(chunk);
      bufLen -= chunk;
    }
    return out;
  }

  prepareReverb(r: Reverb, chunk: number) {
    const n = Math.trunc(chunk / r.ds);
    const excess = n + r.next - r.bufSize;
    r.startPos = r.next;
    if (excess < 0) { r.lengthA = n; r.lengthB = 0; r.next += n; }
    else { r.lengthA = n - excess; r.lengthB = excess; r.next = excess; }
  }

  doOneUpdate(len: number, snaps: (NoteSub | null)[][], u: number) {
    const { dl, dr, wl, wr } = this;
    const snap = snaps[u];
    const nr = this.reverbs.length;
    const order: number[] = [];
    if (nr === 0) {
      for (let i = 0; i < this.numNotes; i++) if (snap[i]) order.push(i);
    } else {
      for (let j = 0; j < nr; j++) for (let i = 0; i < this.numNotes; i++) if (snap[i] && snap[i]!.reverbIndex === j) order.push(i);
      for (let i = 0; i < this.numNotes; i++) if (snap[i] && snap[i]!.reverbIndex >= nr) order.push(i);
    }
    dl.fill(0, 0, 192); dr.fill(0, 0, 192);
    let k = 0;
    for (let j = 0; j < nr; j++) {
      const r = this.reverbs[j];
      // synthesis_resample_and_mix_reverb (downsample rate 1 only in MK64's presets)
      wl.fill(0, 0, 192); wr.fill(0, 0, 192);
      for (let x = 0; x < r.lengthA; x++) { wl[x] = r.ringL[r.startPos + x]; wr[x] = r.ringR[r.startPos + x]; }
      for (let x = 0; x < r.lengthB; x++) { wl[r.lengthA + x] = r.ringL[x]; wr[r.lengthA + x] = r.ringR[x]; }
      // aMix(0x7fff, wet -> dry, 0x300 bytes) and aMix(0x8000 + gain, wet -> wet)
      const g = s16(0x8000 + r.gain);
      for (let x = 0; x < 192; x++) {
        dl[x] = clamp16(dl[x] + ((wl[x] * 0x7fff) >> 15));
        dr[x] = clamp16(dr[x] + ((wr[x] * 0x7fff) >> 15));
      }
      for (let x = 0; x < 192; x++) {
        wl[x] = clamp16(wl[x] + ((wl[x] * g) >> 15));
        wr[x] = clamp16(wr[x] + ((wr[x] * g) >> 15));
      }
      for (; k < order.length; k++) {
        const i = order[k];
        if (snap[i]!.reverbIndex !== j) break;
        this.processNote(i, snap[i]!, len, u, snaps);
      }
      for (let x = 0; x < r.lengthA; x++) { r.ringL[r.startPos + x] = wl[x]; r.ringR[r.startPos + x] = wr[x]; }
      for (let x = 0; x < r.lengthB; x++) { r.ringL[x] = wl[r.lengthA + x]; r.ringR[x] = wr[r.lengthA + x]; }
    }
    for (; k < order.length; k++) this.processNote(order[k], snap[order[k]]!, len, u, snaps);
  }

  processNote(index: number, sn: NoteSub, len: number, u: number, snaps: (NoteSub | null)[][]) {
    const n = this.notes[index];
    const tmp = this.tmp;
    if (sn.needsInit) {
      n.restart = false;
      n.samplePosInt = 0;
      n.samplePosFrac = 0;
      n.curVolLeft = 0;
      n.curVolRight = 0;
      n.rpos = -4;
      n.racc = 0;
      n.twoParts = sn.hasTwoAdpcmParts;
    }
    const rate = sn.resamplingRateFixedPoint;
    const pitch = rate << 1; // RSP RESAMPLE: pitch << 1, 16.16
    const total = rate * len * 2 + n.samplePosFrac;
    const nLoad = Math.floor(total / 65536);
    n.samplePosFrac = total % 65536;
    let finished = false;
    if (sn.isSyntheticWave && sn.samples) {
      const w = sn.samples;
      let pos = n.rpos, acc = n.racc;
      for (let j = 0; j < len; j++) {
        const kk = (acc >> 8) & 0xfc;
        let v = 0;
        for (let t = 0; t < 4; t++) {
          const p = pos + t;
          const x = p < 0 && sn.needsInit ? 0 : w[((p % 64) + 64) % 64];
          v += x * LUT[kk + t];
        }
        tmp[j] = clamp16(v >> 15);
        acc += pitch;
        pos += acc >>> 16;
        acc &= 0xffff;
      }
      n.rpos = pos % 64;
      n.racc = acc;
      n.samplePosInt = (n.samplePosInt + nLoad) & 0x3f;
    } else {
      const smp = sn.sound?.sample;
      if (!smp) return;
      const p = this.prepare(smp);
      const two = sn.hasTwoAdpcmParts;
      // Two ADPCM parts (freq >= 2): the game decodes 2x samples and keeps every other one (aDownsampleHalf), then
      // resamples at freq/2. rpos is the original-sample index of the first resampler tap.
      if (sn.needsInit) n.rpos = two ? -8 : -4;
      const step = two ? 2 : 1;
      const need = nLoad * step;
      if (!p.looped) {
        if (need >= p.end - n.samplePosInt) finished = true;
        else n.samplePosInt += need;
      }
      const buf = p.buf, wrapAt = p.wrapAt, wrapLen = p.wrapLen, end = p.end;
      let pos = n.rpos, acc = n.racc;
      for (let j = 0; j < len; j++) {
        const kk = (acc >> 8) & 0xfc;
        let v: number;
        if (pos >= 0 && pos + 3 * step < wrapAt + 16 && pos + 3 * step < end) {
          v = buf[pos] * LUT[kk] + buf[pos + step] * LUT[kk + 1] + buf[pos + 2 * step] * LUT[kk + 2] + buf[pos + 3 * step] * LUT[kk + 3];
        } else {
          v = 0;
          for (let t = 0; t < 4; t++) {
            let q = pos + t * step;
            if (q < 0) continue;
            if (q >= wrapAt) q = wrapAt - wrapLen + ((q - wrapAt) % wrapLen);
            if (q < end && q < buf.length) v += buf[q] * LUT[kk + t];
          }
        }
        tmp[j] = clamp16(v >> 15);
        acc += pitch;
        pos += step * (acc >>> 16);
        acc &= 0xffff;
        if (pos >= wrapAt) pos -= wrapLen;
      }
      n.twoParts = two;
      n.rpos = pos;
      n.racc = acc;
    }
    // func_800B86A0: 8-sample linear ramps from the previous chunk's volume; ENVSETUP1_MK wet = reverbVol << 8 (no ramp)
    const steps = len >> 3;
    const tL = u16(sn.targetVolLeft << 4), tR = u16(sn.targetVolRight << 4);
    const sL = n.curVolLeft, sR = n.curVolRight;
    const rampL = s16(Math.trunc((tL - sL) / steps)), rampR = s16(Math.trunc((tR - sR) / steps));
    n.curVolLeft = u16(sL + rampL * steps);
    n.curVolRight = u16(sR + rampR * steps);
    const wet = (sn.reverbVol << 8) & 0xff00;
    const xl = sn.stereoStrongRight ? -1 : 0, xr = sn.stereoStrongLeft ? -1 : 0;
    const { dl, dr, wl, wr } = this;
    const count = (len + 7) & ~7;
    let vL = sL, vR = sR;
    for (let j = 0; j < count; j += 8) {
      for (let i = j; i < j + 8; i++) {
        const x = i < len ? tmp[i] : 0;
        const l = s16((x * vL) >> 16) ^ xl, r = s16((x * vR) >> 16) ^ xr;
        dl[i] = clamp16(dl[i] + l);
        dr[i] = clamp16(dr[i] + r);
        wl[i] = clamp16(wl[i] + s16((l * wet) >> 16));
        wr[i] = clamp16(wr[i] + s16((r * wet) >> 16));
      }
      vL = u16(vL + rampL);
      vR = u16(vR + rampR);
    }
    if (finished) {
      n.sub.finished = true;
      n.sub.enabled = false;
      sn.finished = true;
      for (let k = u + 1; k < this.updatesPerFrame; k++) { // func_800B6FB4
        const later = snaps[k][index];
        if (later && !later.needsInit) snaps[k][index] = null;
        else break;
      }
    }
  }

  enabledNotes() { let c = 0; for (const n of this.notes) if (n.sub.enabled) c++; return c; }
}

function soundFor(inst: Instrument, semitone: number): Sound {
  if (semitone < inst.rangeLo) return inst.low;
  if (semitone <= inst.rangeHi) return inst.normal;
  return inst.high;
}
export interface Song { id: number; decomp: string; leak: string; preset: number; player: number; name: string; use: string }

// preset: audio session preset the game has active when the song plays (func_800CA008 callers):
//   0 menus (24 voices), 4 race (16 voices, reverb 0), 5 Mario Raceway / Luigi Raceway (16 voices, reverb 1),
//   3 award ceremony (28 voices), 2 staff credits (28 voices). player: 0 = play_sequence, 1 = play_sequence2.
export const SONGS: Song[] = [
  { id: 0, decomp: 'SEQ_SOUND_PLAYER', leak: 'NA_SEQ_SE', preset: 4, player: 2, name: 'Sound effects player', use: 'sound effect sequence (not music)' },
  { id: 1, decomp: 'SEQ_MENU_TITLE_SCREEN', leak: 'TITLE_BGM', preset: 0, player: 0, name: 'Title', use: 'title screen' },
  { id: 2, decomp: 'SEQ_MENU_MAIN_MENU', leak: 'SELECT_BGM', preset: 0, player: 0, name: 'Menu', use: 'game select, player/character/course select, options, data' },
  { id: 3, decomp: 'SEQ_TRACK_RACEWAY', leak: 'CIRCUIT_BGM', preset: 5, player: 0, name: 'Raceway', use: 'Mario Raceway, Luigi Raceway (preset 5), Royal Raceway, Wario Stadium (preset 4)' },
  { id: 4, decomp: 'SEQ_TRACK_FARM', leak: 'COUNTRY_BGM', preset: 4, player: 0, name: 'Moo Moo Farm / Yoshi Valley', use: 'Moo Moo Farm, Yoshi Valley' },
  { id: 5, decomp: 'SEQ_TRACK_MOUNTAIN', leak: 'MOUNTAIN_BGM', preset: 4, player: 0, name: 'Choco Mountain', use: 'Choco Mountain; battle: Block Fort, Double Deck' },
  { id: 6, decomp: 'SEQ_TRACK_BEACH', leak: 'BEACH_BGM', preset: 4, player: 0, name: 'Koopa Troopa Beach', use: 'Koopa Troopa Beach' },
  { id: 7, decomp: 'SEQ_TRACK_SCARY', leak: 'OBAKE_BGM', preset: 4, player: 0, name: 'Banshee Boardwalk', use: 'Banshee Boardwalk' },
  { id: 8, decomp: 'SEQ_TRACK_SNOW', leak: 'SNOW_BGM', preset: 4, player: 0, name: 'Frappe Snowland / Sherbet Land', use: 'Frappe Snowland, Sherbet Land' },
  { id: 9, decomp: 'SEQ_TRACK_CASTLE', leak: 'CASTLE_BGM', preset: 4, player: 0, name: "Bowser's Castle", use: "Bowser's Castle" },
  { id: 10, decomp: 'SEQ_TRACK_DESERT', leak: 'DIRT_BGM', preset: 4, player: 0, name: 'Kalimari Desert', use: 'Kalimari Desert' },
  { id: 11, decomp: 'SEQ_EVENT_RACE_STARTING', leak: 'GRID_BGM', preset: 4, player: 1, name: 'Starting grid (Grand Prix)', use: 'race start fanfare, Grand Prix' },
  { id: 12, decomp: 'SEQ_EVENT_RACE_FINAL_LAP', leak: 'FINALLAP_FAN', preset: 4, player: 1, name: 'Final lap', use: 'final lap fanfare' },
  { id: 13, decomp: 'SEQ_EVENT_RACE_FINISH_FIRST', leak: 'GOALIN_A_BGM', preset: 4, player: 1, name: 'Goal (1st place)', use: 'finish, 1st place' },
  { id: 14, decomp: 'SEQ_EVENT_RACE_FINISH_OTHER', leak: 'GOALIN_B_BGM', preset: 4, player: 1, name: 'Goal (2nd-4th place)', use: 'finish, 2nd-4th place' },
  { id: 15, decomp: 'SEQ_EVENT_RACE_FINISH_LOSE', leak: 'GOALIN_C_BGM', preset: 4, player: 1, name: 'Goal (5th-8th place)', use: 'finish, 5th-8th place' },
  { id: 16, decomp: 'SEQ_MENU_RESULTS_SCREEN_WIN', leak: 'RESULT_BGM', preset: 4, player: 1, name: 'Results', use: 'race results after finishing 1st-4th (GP), time trial' },
  { id: 17, decomp: 'SEQ_EVENT_RACE_POWERUP_STAR', leak: 'STAR_BGM', preset: 4, player: 1, name: 'Star', use: 'Star power-up (1-2 players)' },
  { id: 18, decomp: 'SEQ_TRACK_RAINBOW', leak: 'RAINBOW_BGM', preset: 4, player: 0, name: 'Rainbow Road', use: 'Rainbow Road' },
  { id: 19, decomp: 'SEQ_TRACK_JUNGLE', leak: 'JUNGLE_BGM', preset: 4, player: 0, name: "D.K.'s Jungle Parkway", use: "D.K.'s Jungle Parkway" },
  { id: 20, decomp: 'SEQ_EVENT_CEREMONY_TROPHY_LOSE', leak: 'GAMEOVER_BGM', preset: 3, player: 0, name: 'No trophy', use: 'end of the losing award ceremony' },
  { id: 21, decomp: 'SEQ_TRACK_TURNPIKE', leak: 'HIGHWAY_BGM', preset: 4, player: 0, name: "Toad's Turnpike", use: "Toad's Turnpike" },
  { id: 22, decomp: 'SEQ_EVENT_RACE_STARTING_VS', leak: 'TIMEGRID_BGM', preset: 4, player: 1, name: 'Starting grid (Time Trials / VS / Battle)', use: 'race start fanfare outside Grand Prix' },
  { id: 23, decomp: 'SEQ_MENU_RESULTS_SCREEN_WIN_VS', leak: 'VSRESULT_BGM', preset: 4, player: 1, name: 'Results (VS / Battle)', use: 'VS and battle results' },
  { id: 24, decomp: 'SEQ_MENU_RESULTS_SCREEN_LOSE', leak: 'LOSTRESULT_BGM', preset: 4, player: 1, name: 'Results (lost)', use: 'race results after finishing 5th-8th (GP)' },
  { id: 25, decomp: 'SEQ_TRACK_BATTLE', leak: 'BATTLE_BGM', preset: 4, player: 0, name: 'Battle', use: 'battle: Skyscraper, Big Donut' },
  { id: 26, decomp: 'SEQ_EVENT_CEREMONY_PRESENTATION_PART1', leak: 'PRIZE_A_BGM', preset: 3, player: 1, name: 'Award ceremony (opening)', use: 'award ceremony, first part' },
  { id: 27, decomp: 'SEQ_EVENT_CEREMONY_PRESENTATION_PART2_WIN', leak: 'PRIZE_B_BGM', preset: 3, player: 1, name: 'Award ceremony', use: 'award ceremony, trophy presentation' },
  { id: 28, decomp: 'SEQ_EVENT_CEREMONY_TROPHY_CREDITS', leak: 'ENDING_BGM', preset: 2, player: 1, name: 'Staff credits', use: 'ending / staff credits' },
  { id: 29, decomp: 'SEQ_EVENT_CEREMONY_PRESENTATION_PART2_LOSE', leak: 'PRIZE_C_BGM', preset: 3, player: 1, name: 'Award ceremony (lost)', use: 'losing award ceremony (detuned variant of 27)' },
];

export interface Rendered {
  rate: number; left: Int16Array; right: Int16Array; loopStart?: number; loopEnd?: number; loopTicks?: number;
  ended: string; jumps: string[]; passStarts: number[]; stats: Engine['stats']; ticks: number;
}

export function renderSong(a: MK64Audio, t: Tables, id: number, opts: { preset: number; passes?: number; maxSeconds?: number; fadeIn?: number; soundMode?: number; onFrame?: (eng: Engine, pos: number, frame: number) => void }): Rendered {
  const eng = new Engine(a, t, { preset: opts.preset, soundMode: opts.soundMode });
  const rate = eng.frequency;
  const passes = opts.passes ?? 1;
  const maxSamples = (opts.maxSeconds ?? 600) * rate;
  const blocksL: Int16Array[] = [], blocksR: Int16Array[] = [];
  let bl = new Int16Array(1 << 20), br = new Int16Array(1 << 20), fill = 0, pos = 0;
  const push = (l: Int32Array, r: Int32Array, len: number) => {
    for (let j = 0; j < len; j++) {
      if (fill === bl.length) { blocksL.push(bl); blocksR.push(br); bl = new Int16Array(1 << 20); br = new Int16Array(1 << 20); fill = 0; }
      bl[fill] = l[j]; br[fill] = r[j]; fill++;
    }
    pos += len;
  };
  const passStarts: number[] = [], passTicks: number[] = [];
  const jumps: string[] = [];
  let loopTarget = -1, updatePos = 0, notesInPass = 0, silentLoop = false;
  eng.onSeqJump = (player, from, to) => {
    if (player !== 0 || to > from) return;
    if (jumps.length < 8) jumps.push(`${from.toString(16)}->${to.toString(16)}@${updatePos}`);
    if (loopTarget < 0) loopTarget = to;
    if (to !== loopTarget) return;
    if (passStarts.length >= 1 && notesInPass === 0) silentLoop = true;
    passStarts.push(updatePos);
    passTicks.push(eng.players[0].ticks);
    notesInPass = 0;
  };
  eng.loadSequence(0, id, opts.fadeIn ?? 8);
  const perFrame = rate / 60;
  let aiErr = 0, ended = 'max', endSample = -1, silentSince = -1, frameNo = 0;
  outer: for (;;) {
    const want = aiErr + perFrame;
    let bufLen = Math.floor((want + 8) / 16) * 16;
    bufLen = Math.max(eng.samplesPerFrameTarget - 16, Math.min(eng.samplesPerFrameTarget + 16, bufLen));
    aiErr = want - bufLen;
    const chunks = eng.chunkLengths(bufLen);
    const snaps = [];
    let off = pos;
    for (let u = 0; u < eng.updatesPerFrame; u++) {
      updatePos = off;
      eng.processSequences();
      const sn = eng.snapshot();
      for (const s of sn) if (s && s.needsInit) notesInPass++;
      snaps.push(sn);
      off += chunks[u];
    }
    for (let u = 0; u < eng.updatesPerFrame; u++) {
      for (const r of eng.reverbs) eng.prepareReverb(r, chunks[u]);
      eng.doOneUpdate(chunks[u], snaps, u);
      push(eng.dl, eng.dr, chunks[u]);
    }
    opts.onFrame?.(eng, pos, frameNo++);
    if (silentLoop) { ended = 'silent-loop'; endSample = passStarts[passStarts.length - 1]; break; }
    if (passStarts.length > passes) { ended = 'loop'; break; }
    if (!eng.players[0].enabled && endSample < 0) endSample = pos;
    if (endSample >= 0) {
      if (eng.enabledNotes() !== 0) silentSince = -1;
      else if (silentSince < 0) silentSince = pos;
      if ((silentSince >= 0 && pos - silentSince >= rate / 4) || pos - endSample > 8 * rate) { ended = 'end'; break outer; }
    }
    if (pos >= maxSamples) break;
  }
  blocksL.push(bl.subarray(0, fill)); blocksR.push(br.subarray(0, fill));
  const total = ended === 'silent-loop' ? endSample : pos;
  const left = new Int16Array(total), right = new Int16Array(total);
  for (let i = 0, k = 0; i < blocksL.length && k < total; i++) {
    const n = Math.min(blocksL[i].length, total - k);
    left.set(blocksL[i].subarray(0, n), k); right.set(blocksR[i].subarray(0, n), k); k += n;
  }
  const out: Rendered = { rate, left, right, ended, jumps, passStarts, stats: eng.stats, ticks: eng.players[0].ticks };
  if (ended === 'loop') {
    out.loopStart = passStarts[passStarts.length - 2];
    out.loopEnd = passStarts[passStarts.length - 1];
    out.loopTicks = passTicks[passTicks.length - 1] - passTicks[passTicks.length - 2];
  }
  return out;
}

const RATE = 26800;
const MAX_RENDER_SECONDS = 300;

// Exact sequence-level loop edges produced by the US driver model. A mismatch means that
// either structural discovery found the wrong audio data or the renderer regressed.
const EXPECTED_LOOPS = new Map<number, readonly [number, number]>([
  [2, [779736, 1557232]], [3, [1926328, 3850568]], [4, [1628840, 3162696]],
  [5, [2428976, 4856008]], [6, [1796192, 3318288]], [7, [1236216, 2469760]],
  [8, [1864528, 3519728]], [9, [2781840, 4492272]], [10, [1806320, 3610256]],
  [16, [1325264, 2648136]], [17, [161248, 320552]], [18, [3534328, 7066568]],
  [19, [406312, 810400]], [21, [2077296, 4152504]], [23, [999648, 1834016]],
  [24, [469152, 935616]], [25, [2278296, 4554352]], [27, [704992, 1407888]],
  [29, [704992, 1407888]],
]);

function checkUsRom(rom: Uint8Array) {
  if (rom.length < 0x40) throw new Error('Mario Kart 64 ROM header is truncated');
  const code = String.fromCharCode(...rom.subarray(0x3b, 0x3f));
  if (code === 'NKTP') throw new Error('Mario Kart 64 PAL music is not yet supported (50 Hz driver timing differs)');
  if (code !== 'NKTE' || rom[0x3f] !== 0) throw new Error(`Unsupported Mario Kart 64 music ROM ${code || '(unknown)'} revision ${rom[0x3f]}`);
}

function decodedCopy(rendered: Rendered): DecodedMusic {
  const left = new Float32Array(rendered.left.length);
  const right = new Float32Array(rendered.right.length);
  for (let i = 0; i < left.length; i++) {
    left[i] = rendered.left[i] / 32768;
    right[i] = rendered.right[i] / 32768;
  }
  return {
    sampleRate: rendered.rate,
    channels: [left, right],
    loopStart: rendered.loopStart,
    loopEnd: rendered.loopEnd,
  };
}

/** Lazily discovers and renders Mario Kart 64's 29 music sequences. */
export function mk64Music(rom: Uint8Array): { tracks: MusicTrack[]; decode(index: number): DecodedMusic } {
  checkUsRom(rom);
  const tracks = SONGS.slice(1).map(({ id: index, name }) => ({ index, name }));
  let audio: MK64Audio | undefined;
  let tables: Tables | undefined;
  let cachedIndex = -1;
  let cachedRender: Rendered | undefined;

  return {
    tracks,
    decode(index: number): DecodedMusic {
      const song = Number.isInteger(index) ? SONGS.find((candidate) => candidate.id === index && candidate.id !== 0) : undefined;
      if (!song) throw new Error(`No Mario Kart 64 music track ${index}`);
      if (cachedIndex !== index || !cachedRender) {
        audio ??= new MK64Audio(rom);
        tables ??= new Tables(rom);
        const rendered = renderSong(audio, tables, index, { preset: song.preset, maxSeconds: MAX_RENDER_SECONDS });
        if (rendered.rate !== RATE) throw new Error(`Unexpected Mario Kart 64 music rate ${rendered.rate}`);
        if (rendered.ended === 'max') throw new Error(`Mario Kart 64 music track ${index} exceeded ${MAX_RENDER_SECONDS} seconds`);
        if (rendered.left.length !== rendered.right.length || rendered.left.length > RATE * MAX_RENDER_SECONDS)
          throw new Error(`Mario Kart 64 music track ${index} produced an invalid channel length`);
        if (rendered.stats.undefinedOps.size !== 0 || rendered.stats.allocFailures !== 0)
          throw new Error(`Mario Kart 64 music track ${index} failed to render cleanly`);
        const expected = EXPECTED_LOOPS.get(index);
        if (expected) {
          if (rendered.loopStart !== expected[0] || rendered.loopEnd !== expected[1])
            throw new Error(`Mario Kart 64 music track ${index} produced unexpected loop points`);
        } else if (rendered.loopStart !== undefined || rendered.loopEnd !== undefined) {
          throw new Error(`Mario Kart 64 music track ${index} unexpectedly looped`);
        }
        cachedIndex = index;
        cachedRender = rendered;
      }
      // The worker transfers returned channel buffers. Keep the cached Int16 render private and
      // return fresh exact-size Float32Arrays so a second decode cannot observe detached buffers.
      return decodedCopy(cachedRender);
    },
  };
}
