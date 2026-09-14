// Star Fox 64 (US V1.0 and V1.1) soundtrack: 43 tracks from the 44 music sequences, rendered offline with a port of the game's audio
// engine, Nintendo EAD's sequence driver between Super Mario 64 and Ocarina of Time (docs/STARFOX.md §6). Three-level scripts
// (sequence player, channel, layer), a note pool shared by priority with stealing, point-list ADSR, vibrato, and the
// "NEAD SF" RSP mixer: VADPCM, the 4-tap resampler, HILOGAIN, 8-sample linear volume ramps with 16-bit clamping on every
// add, and each audio spec's delay-line reverbs. Ported from the research renderer, whose sequence state matches game
// RAM field for field and whose output matches captured game audio (Game Over sample for sample).
//
// nas.ts (Yoshi's Story) is a later revision of the same driver family, but its channel opcode layout, release table,
// unlimited voices and float mixer without reverb differ, so this engine stands alone. From libultra.ts it reuses the
// VADPCM decode with the loop-state convention (prepareWave: the loop restarts from the stored state of the frame
// containing the loop start, true for all 56 looped samples) and the resampler table.
//
// Data (§6.2, §8.6): the sample-bank, sequence and soundfont tables are found in main by structure, gAudioSpecs and the
// note_data tables by signature, and audio_seq / audio_bank / audio_table are DMA entries 3-5. The same code serves both
// versions (their audio data is identical; only the table addresses move).
import type { DecodedMusic, MusicTrack } from '../types';
import { view } from '../util';
import { prepareWave, RESAMPLE_LUT, type Wave } from './libultra';

const RATE = 32000; // every spec asks for 32 kHz; pitches are computed for it
// The engine's own output level (clamp16(bus) / 32768): stage and boss songs sit at RMS 0.05-0.11 (median of all
// tracks 0.078, menus 0.03-0.05), within the other games in the viewer (Yoshi's Story median 0.055, Gex 3 and
// BattleTanx 0.05-0.12); Corneria peaks at 0.82 and the staff roll and all clear reach full scale in the game's own
// mix, so no boost.
const GAIN = 1;
const MAX_SECONDS = 600;
const TAIL_SECONDS = 6;
const LOOP_PASSES = 2; // intro + two passes; the loop is the second pass
const TICKS_PER_UPDATE = 3; // driver updates per video frame (NTSC)
const MAIN_RAM_TO_ROM = 0x7ffff400; // main: ROM 0x1050 is loaded at 0x80000450 in both versions
const PCM_BLOCK = 1 << 20; // frames per output block while rendering

// [sequence id, audio spec, name]. Specs from sSoundTestTracks (the Andross route song 17 plays with spec 15 in its level,
// 23 in the sound test). Every track plays with bgmParam -1 (AUDIO_PLAY_BGM). Boss B's Sector Y copy (sequence 25, spec 7)
// renders sample for sample like 19 and is left out; the resume version (65) differs.
const TRACKS: [number, number, string][] = [
  [2, 0, 'Corneria'], [3, 1, 'Meteo'], [4, 2, 'Titania / Macbeth'], [5, 3, 'Sector X'], [6, 4, 'Zoness'], [7, 5, 'Area 6'],
  [8, 6, 'Venom'], [9, 7, 'Sector Y / Solar'], [10, 8, 'Fortuna / Sector Z'], [12, 10, 'Bolse'], [13, 11, 'Katina'],
  [14, 12, 'Aquas'], [17, 23, 'Venom (Andross route)'], [18, 0, 'Boss A'], [19, 1, 'Boss B'],
  [28, 10, 'Boss C'], [33, 6, 'Andross'], [34, 23, 'Title'], [35, 22, 'Opening'], [36, 23, 'Main menu'],
  [37, 0, 'Mission start'], [38, 0, 'Course clear'], [39, 0, 'Player down'], [40, 25, 'Game over'], [42, 27, 'Staff roll'],
  [43, 6, 'Star Wolf'], [44, 1, 'Mission start (short)'], [45, 1, 'Mission start (Titania)'], [46, 16, 'Versus'],
  [47, 17, 'Versus (hurry)'], [49, 0, 'Course failure'], [50, 1, 'Mission start (Meteo)'], [51, 8, 'Mission start (Fortuna)'],
  [54, 13, 'Katt'], [55, 11, 'Bill'], [56, 23, 'Versus select'], [58, 1, 'Warp zone'], [60, 24, 'Lylat map'],
  [61, 6, 'Andross brain'], [62, 6, 'Venom escape'], [63, 28, 'Training'], [64, 6, 'All clear'], [65, 7, 'Boss B (resume)'],
];

export function sf64Music(rom: Uint8Array): { tracks: MusicTrack[]; decode(index: number): DecodedMusic } {
  let data: AudioData | undefined;
  return {
    tracks: TRACKS.map(([index, , name]) => ({ index, name })),
    decode(index: number): DecodedMusic {
      const track = TRACKS.find((t) => t[0] === index);
      if (!track) throw new Error(`No music track ${index}`);
      data ??= new AudioData(rom);
      return render(data, track[0], track[1]);
    },
  };
}

// ---- ROM data ------------------------------------------------------------------------------------------------------

interface TableEntry { offset: number; size: number; sd1: number; sd2: number }
interface EnvRef { bytes: Uint8Array; off: number } // envelope in font data (a ROM view) or in the sequence copy
interface Sample extends Wave { codec: number; medium: number }
interface TunedSample { sample: Sample | null; tuning: number }
interface Instrument { rangeLo: number; rangeHi: number; decayIndex: number; envelope: EnvRef; low: TunedSample; normal: TunedSample; high: TunedSample }
interface Drum { decayIndex: number; pan: number; tunedSample: TunedSample; envelope: EnvRef }
interface Font { instruments: (Instrument | null)[]; drums: (Drum | null)[] }
interface ReverbSettings { downsampleRate: number; windowSize: number; decayRatio: number; leakRtL: number; leakLtR: number }
interface AudioSpec { numBuffers: number; numNotes: number; reverbs: ReverbSettings[] }

class AudioData {
  readonly dv: DataView;
  readonly sampleBanks: TableEntry[];
  readonly seqs: TableEntry[];
  readonly fontTable: TableEntry[];
  readonly seqFontMap: number; // u16 offset[numSeqs], then u8 count, u8 fontId[count]
  readonly audioSeq: number;
  readonly audioBank: number;
  readonly audioTable: number;
  readonly specs: AudioSpec[];
  readonly bendOctave: Float32Array; // index 128 = 1.0, one octave either way
  readonly bendTwo: Float32Array; // two semitones either way
  readonly pitch: Float32Array; // gPitchFrequencies, note 39 = 1.0
  readonly panDefault: Float32Array;
  readonly panStereo: Float32Array;
  readonly waves: Int16Array[]; // synthetic waves, 4 harmonics x 64 samples; [2] is the vibrato sine
  readonly defaultEnvelope: EnvRef;
  private readonly fonts = new Map<number, Font>();
  private readonly samples = new Map<number, Sample>();

  constructor(readonly rom: Uint8Array) {
    const dv = (this.dv = view(rom));
    const u32 = (o: number) => dv.getUint32(o), s16 = (o: number) => dv.getInt16(o);
    const end = rom.length - 0x1000;
    const findWords = (words: number[], from: number, to: number) => {
      outer: for (let o = from; o < to; o += 4) {
        for (let k = 0; k < words.length; k++) if (u32(o + 4 * k) !== words[k]) continue outer;
        return o;
      }
      return -1;
    };
    // Sample-bank table (entries tile the bank file from 0), directly followed by the sequence and soundfont tables.
    let bankTable = -1, seqTable = -1, fontTable = -1;
    for (let off = 0x1000; off < Math.min(end, 0x200000) && bankTable < 0; off += 4) {
      const n = s16(off);
      if (n < 2 || n > 8 || dv.getUint16(off + 2) !== 0 || u32(off + 4) !== 0) continue;
      let pos = 0, ok = true;
      for (let i = 0; i < n && ok; i++) {
        const e = off + 16 + 16 * i;
        ok = u32(e) === pos && u32(e + 4) !== 0;
        pos += u32(e + 4);
      }
      if (!ok) continue;
      const seq = off + 16 + 16 * n, ns = s16(seq);
      if (ns < 16 || ns > 255 || u32(seq + 4) !== 0) continue;
      const font = seq + 16 + 16 * ns, nf = s16(font);
      if (nf < 1 || nf > 64 || u32(font + 4) !== 0) continue;
      [bankTable, seqTable, fontTable] = [off, seq, font];
    }
    if (bankTable < 0) throw new Error('Star Fox 64 audio tables not found');
    const readTable = (off: number): TableEntry[] => Array.from({ length: s16(off) }, (_, i) => {
      const e = off + 16 + 16 * i;
      return { offset: u32(e), size: u32(e + 4), sd1: dv.getUint16(e + 10), sd2: dv.getUint16(e + 12) };
    });
    this.sampleBanks = readTable(bankTable);
    this.seqs = readTable(seqTable);
    this.fontTable = readTable(fontTable);
    this.seqFontMap = fontTable + 16 + 16 * this.fontTable.length;
    // DMA table: entry 0 = {0, 0, 0x1050, 0} (makerom), entry 1 starts at 0x1050; entries 3-5 are the audio files.
    const dma = findWords([0, 0, 0x1050, 0, 0x1050, 0x1050], 0, end);
    if (dma < 0) throw new Error('Star Fox 64 file table not found');
    [this.audioSeq, this.audioBank, this.audioTable] = [3, 4, 5].map((i) => u32(dma + 16 * i + 4));
    // note_data: gWaveSamples (6 pointers, 8 bytes pad), then the one-octave bend table 0.5, 0.5, 0.502736, ...
    const f = new DataView(new ArrayBuffer(4));
    f.setFloat32(0, 0.502736);
    const noteData = findWords([0x3f000000, 0x3f000000, f.getUint32(0)], 0x1000, end) - 0x20;
    if (noteData < 0) throw new Error('Star Fox 64 note tables not found');
    const f32s = (o: number, n: number) => Float32Array.from({ length: n }, (_, i) => dv.getFloat32(o + 4 * i));
    this.bendOctave = f32s(noteData + 0x20, 256);
    this.bendTwo = f32s(noteData + 0x420, 256);
    this.pitch = f32s(noteData + 0x820, 128);
    this.defaultEnvelope = { bytes: rom, off: noteData + 0xa40 };
    this.panStereo = f32s(noteData + 0xd70, 128);
    this.panDefault = f32s(noteData + 0xf70, 128);
    this.waves = [0, 1, 2, 3].map((i) => {
      const p = u32(noteData + 4 * i) - MAIN_RAM_TO_ROM;
      return Int16Array.from({ length: 256 }, (_, k) => s16(p + 2 * k));
    });
    // gAudioSpecs: 29 x 0x30 {u32 32000; u8 numBuffers, numNotes, numReverbs, pad; u32 reverbSettings; ...}.
    let specs = -1;
    for (let off = 0x1000; off < Math.min(end, 0x200000) && specs < 0; off += 4) {
      let i = 0;
      for (; i < 29; i++) {
        const e = off + 0x30 * i;
        if (u32(e) !== 32000) break;
        const nb = rom[e + 4], nn = rom[e + 5], nr = rom[e + 6];
        if (nb < 1 || nb > 2 || nn < 8 || nn > 64 || nr > 4 || u32(e + 8) >>> 24 !== 0x80) break;
      }
      if (i === 29) specs = off;
    }
    if (specs < 0) throw new Error('Star Fox 64 audio specs not found');
    this.specs = Array.from({ length: 29 }, (_, i) => {
      const e = specs + 0x30 * i, p = u32(e + 8) - MAIN_RAM_TO_ROM;
      const reverbs = Array.from({ length: rom[e + 6] }, (_, k): ReverbSettings => {
        const q = p + 8 * k;
        return { downsampleRate: rom[q], windowSize: rom[q + 1], decayRatio: dv.getUint16(q + 2), leakRtL: dv.getUint16(q + 4), leakLtR: dv.getUint16(q + 6) };
      });
      return { numBuffers: rom[e + 4], numNotes: rom[e + 5], reverbs };
    });
  }

  // A table entry of size 0 is an alias: its offset is another sequence id.
  resolveSeq(id: number) {
    const e = this.seqs[id];
    return e.size === 0 ? e.offset : id;
  }

  // A private copy: scripts may write into their sequence.
  sequenceData(id: number): Uint8Array {
    const e = this.seqs[this.resolveSeq(id)];
    return this.rom.slice(this.audioSeq + e.offset, this.audioSeq + e.offset + e.size);
  }

  fontsForSequence(id: number): number[] {
    const o = this.seqFontMap + this.dv.getUint16(this.seqFontMap + 2 * this.resolveSeq(id));
    return Array.from(this.rom.subarray(o + 1, o + 1 + this.rom[o]));
  }

  font(id: number): Font {
    const cached = this.fonts.get(id);
    if (cached) return cached;
    const e = this.fontTable[id];
    const base = this.audioBank + e.offset, dv = this.dv, rom = this.rom;
    const u32 = (o: number) => dv.getUint32(base + o);
    const bank1 = e.sd1 >> 8, bank2 = e.sd1 & 0xff;
    const tuned = (o: number): TunedSample => ({ sample: this.sample(base, u32(o), bank1, bank2), tuning: dv.getFloat32(base + o + 4) });
    const none = (): TunedSample => ({ sample: null, tuning: 0 }); // compared by identity, like every TunedSample
    const nInst = e.sd2 >> 8, nDrum = e.sd2 & 0xff, drumList = u32(0);
    const drums = drumList && nDrum ? Array.from({ length: nDrum }, (_, i): Drum | null => {
      const d = u32(drumList + 4 * i);
      return d ? { decayIndex: rom[base + d], pan: rom[base + d + 1], tunedSample: tuned(d + 4), envelope: { bytes: rom, off: base + u32(d + 12) } } : null;
    }) : [];
    const instruments = Array.from({ length: nInst }, (_, i): Instrument | null => {
      const o = u32(4 + 4 * i);
      if (!o) return null;
      const lo = rom[base + o + 1], hi = rom[base + o + 2];
      return {
        rangeLo: lo, rangeHi: hi, decayIndex: rom[base + o + 3], envelope: { bytes: rom, off: base + u32(o + 4) },
        low: lo !== 0 ? tuned(o + 8) : none(), normal: tuned(o + 16), high: hi !== 0x7f ? tuned(o + 24) : none(),
      };
    });
    const font = { instruments, drums };
    this.fonts.set(id, font);
    return font;
  }

  // Sample header {u32 codec/medium/size bits; u32 offset in the sample bank; u32 loop; u32 book}, font-relative.
  private sample(base: number, so: number, bank1: number, bank2: number): Sample | null {
    if (!so) return null;
    const dv = this.dv, u32 = (o: number) => dv.getUint32(base + o);
    const w = u32(so), medium = (w >>> 26) & 3;
    const data = this.audioTable + this.sampleBanks[medium === 0 ? bank1 : bank2].offset + u32(so + 4);
    const cached = this.samples.get(data);
    if (cached) return cached;
    const loop = base + u32(so + 8), book = base + u32(so + 12);
    const loopCount = dv.getUint32(loop + 8), entries = 8 * dv.getInt32(book) * dv.getInt32(book + 4);
    // Every sample of the game is VADPCM (codec 0).
    const s: Sample = {
      base: data, len: w & 0xffffff, type: 0, codec: w >>> 28, medium,
      book: Int16Array.from({ length: entries }, (_, k) => dv.getInt16(book + 8 + 2 * k)),
      loopStart: dv.getUint32(loop), loopEnd: dv.getUint32(loop + 4), loopCount,
      loopState: loopCount !== 0 ? Int16Array.from({ length: 16 }, (_, k) => dv.getInt16(loop + 16 + 2 * k)) : null,
    };
    this.samples.set(data, s);
    return s;
  }
}

// ---- engine state (decomp audio structs) ----------------------------------------------------------------------------

const clamp16 = (v: number) => (v > 32767 ? 32767 : v < -32768 ? -32768 : v);
const s8 = (v: number) => (v << 24) >> 24;
const s16 = (v: number) => (v << 16) >> 16;
const u16 = (v: number) => v & 0xffff;
const fround = Math.fround;
const LUT = RESAMPLE_LUT; // a local binding: imported bindings can be getters, too slow for the per-sample loops
const envS16 = (e: EnvRef, o: number) => s16((e.bytes[e.off + o] << 8) | e.bytes[e.off + o + 1]);
const sampleFor = (i: Instrument, note: number) => (note < i.rangeLo ? i.low : note <= i.rangeHi ? i.normal : i.high);

// One linear envelope step.
function adsrStep(adsr: AdsrState) {
  adsr.delay--;
  adsr.current = fround(adsr.current + adsr.velocity);
  if (adsr.delay <= 0) adsr.state = 3;
}

// Default short-note velocity and gate tables (layer Dn / En; not used by the music).
const SHORT_VELOCITY = [12, 25, 38, 51, 57, 64, 71, 76, 83, 89, 96, 102, 109, 115, 121, 127];
const SHORT_GATE = [229, 203, 177, 151, 139, 126, 113, 100, 87, 74, 61, 48, 36, 23, 10, 0];

// AudioListItem: circular doubly linked lists whose head counts its items.
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
const newScript = (pc = 0): Script => ({ pc, stack: [0, 0, 0, 0], loops: [0, 0, 0, 0], depth: 0 });

interface AdsrSettings { decayIndex: number; sustain: number; envelope: EnvRef }
interface Portamento { mode: number; cur: number; speed: number; extent: number }

class Layer {
  item = new ListItem<Layer>();
  enabled = false;
  finished = false;
  muted = false;
  continuousNotes = false;
  ignoreDrumPan = false; // set on (re)allocation: the next propagation recomputes every note parameter
  keepPan = false; // CC: the drum's pan does not replace the layer's
  stereo = 0;
  instOrWave = 0xff;
  unk3 = 0;
  gateTime = 0x80;
  portamentoTargetNote = 0;
  pan = 0x40;
  notePan = 0;
  portamento: Portamento = { mode: 0, cur: 0, speed: 0, extent: 0 };
  adsr: AdsrSettings;
  portamentoTime = 0;
  transposition = 0;
  freqMod = 1;
  velocitySquare = 0;
  noteVelocity = 0;
  noteFreqMod = 0;
  shortNoteDefaultDelay = 0;
  lastDelay = 0;
  delay = 0;
  gateDelay = 0;
  note: Note | null = null;
  instrument: Instrument | null = null;
  tunedSample: TunedSample | null = null;
  channel: Channel | null = null;
  state = newScript();
  constructor(env: EnvRef) {
    this.item.value = this;
    this.adsr = { decayIndex: 0, sustain: 0, envelope: env };
  }
}

class Channel {
  enabled = false;
  finished = false;
  stopScript = false;
  hasInstrument = false;
  stereoHeadsetEffects = 0;
  largeNotes = false;
  changes = 0xff; // bit 0 freqMod, bit 1 volume, bit 2 pan
  noteAllocPolicy = 0;
  muteBehavior = 0;
  reverbVol = 0; // D4 send
  reverbIndex = 0; // E5, low 2 bits select the reverb
  gain = 0; // ED, HILOGAIN Q4.4
  notePriority = 3;
  fontId = 0;
  newPan = 0x40;
  panChannelWeight = 0x80;
  vibratoRateStart = 0x800;
  vibratoDepthStart = 0;
  vibratoRateTarget = 0x800;
  vibratoDepthTarget = 0;
  vibratoRateChangeDelay = 0;
  vibratoDepthChangeDelay = 0;
  vibratoDelay = 0;
  delay = 0;
  instOrWave = 0;
  transposition = 0;
  volumeMod = 1;
  volume = 1;
  pan = 0;
  appliedVolume = 0;
  freqMod = 1;
  dynTable = 0;
  instrument: Instrument | null = null;
  seqPlayer: SeqPlayer | null = null;
  layers: (Layer | null)[] = [null, null, null, null];
  state = newScript();
  adsr: AdsrSettings;
  notePool = new NotePool();
  io = new Int8Array(8).fill(-1);
  stored = 0; // CE / CF
  constructor(env: EnvRef) {
    this.adsr = { envelope: env, decayIndex: 0x20, sustain: 0 };
  }
}

class SeqPlayer {
  enabled = false;
  finished = false;
  muted = false;
  recalculateVolume = false;
  fadeState = 1;
  noteAllocPolicy = 0;
  muteBehavior = 0xe0;
  defaultFont = 0;
  io0 = -1;
  tempo = 120 * 48;
  tempoAcc = 0;
  tempoChange = 0;
  transposition = 0;
  delay = 0;
  fadeTimer = 0;
  fadeInTime = 0;
  seq: Uint8Array = new Uint8Array(0);
  seqId = 0;
  fadeVolume = 1;
  fadeVelocity = 0;
  muteVolumeMod = 0.5;
  fadeVolumeMod = 1;
  appliedFadeVolume = 1;
  channels: (Channel | null)[] = new Array(16).fill(null);
  state = newScript();
  notePool = new NotePool();
  scriptValue = 0;
}

interface AdsrState {
  action: number; state: number; envIndex: number; delay: number; sustain: number;
  velocity: number; fadeOutVel: number; current: number; target: number; envelope: EnvRef;
}

// NoteSubEu: what the synthesis reads, snapshotted after every update.
interface NoteSub {
  enabled: boolean; needsInit: boolean; finished: boolean; stereoStrongRight: boolean; stereoStrongLeft: boolean;
  stereoHeadsetEffects: number; reverbIndex: number; isSyntheticWave: boolean; hasTwoParts: boolean; gain: number;
  reverb: number; panVolLeft: number; panVolRight: number; resampleRate: number; tunedSample: TunedSample | null;
  wave: Int16Array | null; // synthetic wave: 64 samples + 4 wrap samples
}
const resetSub = (s: NoteSub) => Object.assign(s, {
  enabled: true, needsInit: true, finished: false, stereoStrongRight: false, stereoStrongLeft: false, stereoHeadsetEffects: 0,
  reverbIndex: 0, isSyntheticWave: false, hasTwoParts: false, gain: 0, reverb: 0, panVolLeft: 0, panVolRight: 0,
  resampleRate: 0, tunedSample: null, wave: null,
});
const newSub = () => resetSub({} as NoteSub);

class Note {
  item = new ListItem<Note>();
  priority = 0;
  unk04 = 0; // 0 playing, 1 decaying, 2 releasing (attributes frozen at note-off)
  portamentoFreqMod = 1;
  vibratoFreqMod = 1;
  prevParentLayer: Layer | null = null;
  parentLayer: Layer | null = null;
  wantedParentLayer: Layer | null = null;
  attributes = { reverb: 0, gain: 0, pan: 0, stereo: 0, freqMod: 0, velocity: 0 };
  adsr: AdsrState;
  portamento: Portamento = { mode: 0, cur: 0, speed: 0, extent: 0 };
  vibrato = { channel: null as Channel | null, time: 0, depth: 0, rate: 0, active: false, rateChangeTimer: 0, depthChangeTimer: 0, delay: 0 };
  sub: NoteSub = Object.assign(newSub(), { enabled: false, needsInit: false });
  snap: NoteSub = newSub();
  // synthesis state
  pos = -4;
  acc = 0;
  reverbVol = 0;
  curVolLeft = 0;
  curVolRight = 0;
  constructor(env: EnvRef) {
    this.item.value = this;
    this.adsr = { action: 0, state: 0, envIndex: 0, delay: 0, sustain: 0, velocity: 0, fadeOutVel: 0, current: 0, target: 0, envelope: env };
  }
}

class Reverb {
  ringL: Int16Array;
  ringR: Int16Array;
  next = 0;
  start = 0;
  len = 0;
  bufSize: number;
  upL = { hist: new Int16Array(4), acc: 0 }; // read-back resampler state for downsample rate 2
  upR = { hist: new Int16Array(4), acc: 0 };
  constructor(readonly ds: number, windowSize: number, readonly decayRatio: number, readonly leakRtL: number, readonly leakLtR: number) {
    this.bufSize = windowSize * 64;
    this.ringL = new Int16Array(this.bufSize);
    this.ringR = new Int16Array(this.bufSize);
  }
}

// ---- engine --------------------------------------------------------------------------------------------------------

class Engine {
  readonly spec: AudioSpec;
  readonly numNotes: number;
  readonly maxTempo: number;
  readonly updateInv = fround(1 / TICKS_PER_UPDATE); // fade-out per update of released and stolen notes
  readonly releaseScale = fround(fround(3 / 2560) / TICKS_PER_UPDATE); // decayIndex -> fade-out per update
  readonly sine: Int16Array;
  readonly synthWaves: Int16Array[][];
  readonly notes: Note[] = [];
  readonly freeLists = new NotePool();
  readonly layerFreeList = ListItem.head<Layer>(null);
  readonly player = new SeqPlayer();
  readonly reverbs: Reverb[];
  readonly snaps: (NoteSub | null)[] = [];
  readonly dl = new Int32Array(512);
  readonly dr = new Int32Array(512);
  private readonly wl = new Int32Array(512);
  private readonly wr = new Int32Array(512);
  private readonly tmp = new Int32Array(512);
  private readonly done: Uint8Array;
  onBackJump: (target: number) => void = () => {};

  constructor(readonly a: AudioData, specId: number) {
    this.spec = a.specs[specId];
    this.numNotes = this.spec.numNotes;
    // AudioHeap_Init: gMaxTempo = (u16)((ticksPerUpdate * 2880000 / 48) / (1000 * 1.00278 / 60)) = 10770
    const factor = fround((1000 * fround(1.00278)) / 60);
    this.maxTempo = Math.trunc(fround(fround((TICKS_PER_UPDATE * 2880000.0) / 48) / factor)) & 0xffff;
    this.sine = a.waves[2];
    this.synthWaves = a.waves.map((w) => [0, 1, 2, 3].map((h) => {
      const b = new Int16Array(68);
      b.set(w.subarray(64 * h, 64 * h + 64));
      b.set(w.subarray(64 * h, 64 * h + 4), 64);
      return b;
    }));
    for (let i = 0; i < this.numNotes; i++) {
      const n = new Note(a.defaultEnvelope);
      this.notes.push(n);
      pushBack(this.freeLists.disabled, n.item);
      this.snaps.push(null);
    }
    this.done = new Uint8Array(this.numNotes);
    for (let i = 0; i < 64; i++) pushBack(this.layerFreeList, new Layer(a.defaultEnvelope).item);
    this.reverbs = this.spec.reverbs.map((r) => new Reverb(r.downsampleRate, r.windowSize, r.decayRatio, r.leakRtL, r.leakLtR));
  }

  // Audio_AdsrUpdate: one update of a note's envelope; returns its gain 0..1.
  adsrUpdate(adsr: AdsrState): number {
    const action = adsr.action, state = adsr.state;
    switch (state) {
      case 0:
        return 0;
      case 1: case 2: case 3: {
        if (state === 1 && action & 0x40) { adsr.state = 5; break; }
        if (state !== 3) { adsr.envIndex = 0; adsr.state = 3; }
        for (let guard = 0; guard < 64; guard++) {
          const delay = envS16(adsr.envelope, 4 * adsr.envIndex), arg = envS16(adsr.envelope, 4 * adsr.envIndex + 2);
          adsr.delay = delay;
          if (delay === 0) { adsr.state = 0; break; } // end
          if (delay === -1) { adsr.state = 5; break; } // hang
          if (delay === -2) { adsr.envIndex = arg; continue; } // goto
          if (delay === -3) { adsr.state = 1; break; } // restart
          // Delays are in 1/4 video frames (x3/4 updates).
          const nb = this.spec.numBuffers;
          if (adsr.delay >= 4) adsr.delay = Math.trunc(Math.trunc((adsr.delay * TICKS_PER_UPDATE * nb) / nb) / 4);
          if (adsr.delay === 0) adsr.delay = 1;
          const t = fround(arg / 32767.0);
          adsr.target = fround(t * t);
          adsr.velocity = fround((adsr.target - adsr.current) / adsr.delay);
          adsr.state = 4;
          adsr.envIndex++;
          adsrStep(adsr);
          break;
        }
        break;
      }
      case 4:
        adsrStep(adsr);
        break;
      case 6: case 7:
        adsr.current = fround(adsr.current - adsr.fadeOutVel);
        if (adsr.sustain !== 0 && state === 6) {
          if (adsr.current < adsr.sustain) { adsr.current = adsr.sustain; adsr.delay = 0x80; adsr.state = 8; }
        } else if (adsr.current < 0.00001) {
          adsr.current = 0;
          adsr.state = 0;
        }
        break;
      case 8:
        if (--adsr.delay === 0) adsr.state = 7;
        break;
    }
    if (action & 0x20) { adsr.state = 6; adsr.action = action & ~0x20; }
    if (action & 0x10) { adsr.state = 7; adsr.action = action & ~0x10; }
    return adsr.current < 0 ? 0 : adsr.current > 1 ? 1 : adsr.current;
  }

  // ---- notes (audio_playback.c) ----

  noteDisable(n: Note) {
    n.sub.needsInit = false;
    n.priority = 0;
    n.sub.enabled = false;
    n.unk04 = 0;
    n.parentLayer = null;
    n.prevParentLayer = null;
    n.sub.finished = false;
    n.adsr.state = 0;
    n.adsr.current = 0;
  }

  noteInitForLayer(n: Note, L: Layer) {
    const ch = L.channel!;
    n.prevParentLayer = null;
    n.parentLayer = L;
    n.priority = ch.notePriority;
    L.ignoreDrumPan = true;
    L.unk3 = 3;
    L.note = n;
    L.noteVelocity = 0;
    n.adsr.action = 0;
    n.adsr.delay = 0;
    n.adsr.envelope = L.adsr.decayIndex === 0 ? ch.adsr.envelope : L.adsr.envelope;
    n.adsr.sustain = 0;
    n.adsr.current = 0;
    n.adsr.state = 1;
    resetSub(n.sub);
    const w = L.instOrWave === 0xff ? ch.instOrWave : L.instOrWave;
    n.sub.tunedSample = L.tunedSample;
    n.sub.isSyntheticWave = w >= 128;
    if (n.sub.isSyntheticWave) this.buildSyntheticWave(n, L, w);
    n.sub.stereoHeadsetEffects = ch.stereoHeadsetEffects;
    n.sub.reverbIndex = ch.reverbIndex & 3;
  }

  buildSyntheticWave(n: Note, L: Layer, waveId: number) {
    if (waveId < 128) waveId = 128;
    let freqMod = L.freqMod;
    if (L.portamento.mode !== 0 && L.portamento.extent > 0) freqMod *= L.portamento.extent + 1;
    let hi = 0;
    if (freqMod < 1) freqMod = 1.0465;
    else if (freqMod < 2) { hi = 1; freqMod = 0.52325; }
    else if (freqMod < 4) { hi = 2; freqMod = 0.26263; }
    else { hi = 3; freqMod = 0.13081; }
    L.freqMod = fround(L.freqMod * freqMod);
    n.sub.wave = this.synthWaves[(waveId - 128) & 3][hi];
  }

  // Audio_SeqLayerDecayRelease: note-off (6 = decay with the release rate, 7 = fast release).
  seqLayerDecayRelease(L: Layer | null, mode: 6 | 7) {
    if (L === null) return;
    L.unk3 = 0;
    const n = L.note;
    if (n === null) return;
    if (L === n.wantedParentLayer) n.wantedParentLayer = null;
    if (L !== n.parentLayer) {
      if (n.parentLayer === null && n.wantedParentLayer === null && L === n.prevParentLayer && mode !== 6) {
        n.adsr.fadeOutVel = this.updateInv;
        n.adsr.action |= 0x10;
      }
      return;
    }
    if (n.adsr.state !== 6) {
      const at = n.attributes;
      at.freqMod = L.noteFreqMod;
      at.velocity = L.noteVelocity;
      at.pan = L.notePan;
      at.stereo = L.stereo;
      if (L.channel !== null) { at.reverb = L.channel.reverbVol; at.gain = L.channel.gain; }
      n.priority = 1;
      n.prevParentLayer = n.parentLayer;
      n.parentLayer = null;
      if (mode === 7) {
        n.adsr.fadeOutVel = this.updateInv;
        n.adsr.action |= 0x10;
        n.unk04 = 2;
      } else {
        n.unk04 = 1;
        n.adsr.action |= 0x20;
        const di = L.adsr.decayIndex === 0 ? L.channel!.adsr.decayIndex : L.adsr.decayIndex;
        n.adsr.fadeOutVel = fround(di * this.releaseScale);
        n.adsr.sustain = fround((L.channel!.adsr.sustain * n.adsr.current) / 256.0);
      }
    }
    if (mode === 6) {
      listRemove(n.item);
      pushFront(n.item.pool!.decaying, n.item);
    }
  }
  noteDecay(L: Layer | null) { this.seqLayerDecayRelease(L, 6); }
  noteRelease(L: Layer | null) { this.seqLayerDecayRelease(L, 7); }

  releaseAndTakeOwnership(n: Note, L: Layer) {
    n.wantedParentLayer = L;
    n.priority = L.channel!.notePriority;
    n.adsr.fadeOutVel = this.updateInv;
    n.adsr.action |= 0x10;
  }

  allocFromDisabled(pool: NotePool, L: Layer) {
    const n = popBack(pool.disabled);
    if (n) { this.noteInitForLayer(n, L); pushFront(pool.active, n.item); }
    return n;
  }

  allocFromDecaying(pool: NotePool, L: Layer) {
    const n = popBack(pool.decaying);
    if (n) { this.releaseAndTakeOwnership(n, L); pushBack(pool.releasing, n.item); }
    return n;
  }

  lowestPriority(list: ListItem<Note>, priority: number): Note | null {
    let it = list.next!;
    if (it === list) return null;
    let best = it;
    for (; it !== list; it = it.next!) if (it.value!.priority <= best.value!.priority) best = it;
    return best.value!.priority >= priority ? null : best.value;
  }

  allocFromActive(pool: NotePool, L: Layer) {
    const p = L.channel!.notePriority;
    const r = this.lowestPriority(pool.releasing, p), a = this.lowestPriority(pool.active, p);
    if (!r && !a) return null;
    if ((a ? a.priority : 0x10) < (r ? r.priority : 0x10)) {
      listRemove(a!.item);
      this.noteRelease(a!.parentLayer);
      a!.wantedParentLayer = L;
      pushBack(pool.releasing, a!.item);
      a!.priority = p;
      return a;
    }
    r!.wantedParentLayer = L;
    r!.priority = p;
    return r;
  }

  alloc(pool: NotePool, kind: number, L: Layer) {
    return kind === 0 ? this.allocFromDisabled(pool, L) : kind === 1 ? this.allocFromDecaying(pool, L) : this.allocFromActive(pool, L);
  }

  // Audio_AllocNote: channel pool, player pool, global pool; a disabled note, then a decaying one, then a steal.
  allocNote(L: Layer): Note | null {
    const ch = L.channel!, policy = ch.noteAllocPolicy;
    if (policy & 1) {
      const n = L.note;
      if (n && L === n.prevParentLayer && n.wantedParentLayer === null) {
        this.releaseAndTakeOwnership(n, L);
        listRemove(n.item);
        pushBack(n.item.pool!.releasing, n.item);
        return n;
      }
    }
    const cp = ch.notePool, pp = ch.seqPlayer!.notePool, g = this.freeLists;
    const pools = policy & 2 ? [cp] : policy & 4 ? [cp, pp] : policy & 8 ? [g] : [cp, pp, g];
    for (let kind = 0; kind < 3; kind++) {
      for (const pool of pools) {
        const n = this.alloc(pool, kind, L);
        if (n) return n;
      }
    }
    L.unk3 = 0;
    return null;
  }

  notePoolClear(pool: NotePool) {
    const free = this.freeLists;
    for (const [list, dest] of [[pool.disabled, free.disabled], [pool.decaying, free.decaying], [pool.releasing, free.releasing], [pool.active, free.active]]) {
      for (let nx = list.next; nx !== list && nx !== null; nx = list.next) {
        listRemove(nx);
        pushBack(dest, nx);
      }
    }
  }

  vibratoInit(n: Note) {
    const v = n.vibrato, L = n.parentLayer!, ch = L.channel!;
    v.active = true;
    v.time = 0;
    n.vibratoFreqMod = 1;
    n.portamentoFreqMod = 1;
    v.channel = ch;
    v.depthChangeTimer = ch.vibratoDepthChangeDelay;
    v.depth = v.depthChangeTimer === 0 ? ch.vibratoDepthTarget : ch.vibratoDepthStart;
    v.rateChangeTimer = ch.vibratoRateChangeDelay;
    v.rate = v.rateChangeTimer === 0 ? ch.vibratoRateTarget : ch.vibratoRateStart;
    v.delay = ch.vibratoDelay;
    Object.assign(n.portamento, L.portamento);
  }

  vibratoUpdate(n: Note) {
    if (n.portamento.mode !== 0) {
      const p = n.portamento;
      p.cur = fround(p.cur + p.speed);
      const t = Math.min(127, Math.trunc(p.cur) >>> 0);
      n.portamentoFreqMod = fround(1 + (this.a.bendOctave[0x80 + t] - 1) * p.extent);
    }
    const v = n.vibrato;
    if (!v.active || n.parentLayer === null) return;
    const ch = v.channel!;
    if (v.delay !== 0) { v.delay--; n.vibratoFreqMod = 1; return; }
    if (v.depthChangeTimer) {
      if (v.depthChangeTimer === 1) v.depth = ch.vibratoDepthTarget;
      else v.depth += (ch.vibratoDepthTarget - v.depth) / v.depthChangeTimer;
      v.depthChangeTimer--;
    } else if (ch.vibratoDepthTarget !== Math.trunc(v.depth)) {
      if ((v.depthChangeTimer = ch.vibratoDepthChangeDelay) === 0) v.depth = ch.vibratoDepthTarget;
    }
    if (v.rateChangeTimer) {
      if (v.rateChangeTimer === 1) v.rate = ch.vibratoRateTarget;
      else v.rate += (ch.vibratoRateTarget - v.rate) / v.rateChangeTimer;
      v.rateChangeTimer--;
    } else if (ch.vibratoRateTarget !== Math.trunc(v.rate)) {
      if ((v.rateChangeTimer = ch.vibratoRateChangeDelay) === 0) v.rate = ch.vibratoRateTarget;
    }
    if (v.depth === 0) { n.vibratoFreqMod = 1; return; }
    v.time = (v.time + Math.trunc(v.rate)) | 0;
    const s = this.sine[(v.time >> 10) & 0x3f] >> 8;
    n.vibratoFreqMod = fround(1 + (v.depth / 4096) * (this.a.bendOctave[(0x80 + s) & 0xff] - 1));
  }

  // Audio_InitNoteSub: resampling rate, pan volumes, reverb send and gain for the synthesis.
  initNoteSub(n: Note, freqMod: number, velocity: number, pan: number, reverb: number, stereo: number, gain: number) {
    const sub = n.sub;
    let rate: number;
    if (freqMod < 2) {
      sub.hasTwoParts = false;
      rate = Math.min(freqMod, 1.99998);
    } else {
      sub.hasTwoParts = true;
      rate = freqMod > 3.99996 ? 1.99998 : freqMod * 0.5;
    }
    sub.resampleRate = Math.trunc(fround(rate * 32768)) & 0xffff;
    pan %= 128;
    let pl: number, pr: number;
    if (sub.stereoHeadsetEffects) { // stereo sound mode
      pl = this.a.panStereo[pan];
      pr = this.a.panStereo[127 - pan];
      const strongL = pan < 32, strongR = pan > 96;
      const mode = (stereo >> 2) & 3, sR = !!((stereo >> 1) & 1), sL = !!(stereo & 1);
      sub.stereoStrongRight = strongR;
      sub.stereoStrongLeft = strongL;
      if (mode === 0) { sub.stereoStrongRight = sR; sub.stereoStrongLeft = sL; }
      else if (mode === 2) { sub.stereoStrongRight = sR || strongR; sub.stereoStrongLeft = sL || strongL; }
      else if (mode === 3) { sub.stereoStrongRight = sR !== strongR; sub.stereoStrongLeft = sL !== strongL; }
    } else {
      pl = this.a.panDefault[pan];
      pr = this.a.panDefault[127 - pan];
    }
    if (velocity < 0) velocity = 0;
    if (velocity > 1) velocity = 1;
    sub.panVolLeft = Math.trunc(fround(velocity * pl * 4095.999)) & 0xffff;
    sub.panVolRight = Math.trunc(fround(velocity * pr * 4095.999)) & 0xffff;
    sub.gain = gain & 0xff;
    sub.reverb = reverb & 0xff;
  }

  // Audio_ProcessNotes: list bookkeeping, envelope, vibrato and note parameters, once per update.
  processNotes() {
    for (let i = 0; i < this.numNotes; i++) {
      const n = this.notes[i];
      if (n.parentLayer !== null) {
        const L = n.parentLayer;
        if (n !== L.note && n.unk04 === 0) {
          n.adsr.action |= 0x10;
          n.adsr.fadeOutVel = this.updateInv;
          n.priority = 1;
          n.unk04 = 2;
        } else if (L.enabled || n.unk04 !== 0 || n.priority <= 0) {
          if (L.channel!.seqPlayer === null) {
            this.channelDisable(L.channel!);
            n.priority = 1;
            n.unk04 = 1;
            continue;
          }
        } else {
          this.noteRelease(L);
          listRemove(n.item);
          pushFront(n.item.pool!.decaying, n.item);
          n.priority = 1;
          n.unk04 = 2;
        }
      } else if (n.unk04 === 0 && n.priority > 0) {
        continue;
      }
      if (n.priority === 0) continue;
      if (n.unk04 > 0 || n.sub.finished) {
        if (n.adsr.state === 0 || n.sub.finished) {
          const wanted = n.wantedParentLayer;
          this.noteDisable(n);
          listRemove(n.item);
          n.wantedParentLayer = null;
          if (wanted === null || wanted.channel === null) {
            pushBack(n.item.pool!.disabled, n.item);
            continue;
          }
          this.noteInitForLayer(n, wanted);
          this.vibratoInit(n);
          pushBack(n.item.pool!.active, n.item);
        }
      } else if (n.adsr.state === 0) {
        this.noteDisable(n);
        listRemove(n.item);
        pushBack(n.item.pool!.disabled, n.item);
        continue;
      }
      const scale = this.adsrUpdate(n.adsr);
      this.vibratoUpdate(n);
      let freqMod: number, velocity: number, pan: number, reverb: number, stereo: number, gain: number;
      if (n.unk04 === 1 || n.unk04 === 2) {
        ({ freqMod, velocity, pan, reverb, stereo, gain } = n.attributes);
      } else {
        const L = n.parentLayer!, ch = L.channel!;
        freqMod = L.noteFreqMod; velocity = L.noteVelocity; pan = L.notePan; stereo = L.stereo;
        reverb = ch.reverbVol; gain = ch.gain;
      }
      freqMod = fround(freqMod * n.vibratoFreqMod * n.portamentoFreqMod);
      velocity = fround(velocity * scale);
      this.initNoteSub(n, freqMod, velocity, pan, reverb, stereo, gain);
    }
  }

  // ---- sequence scripts (audio_seqplayer.c) ----

  u8(s: Script) { return this.player.seq[s.pc++]; }
  s16(s: Script) { const d = this.player.seq, v = (d[s.pc] << 8) | d[s.pc + 1]; s.pc += 2; return s16(v); }
  u16(s: Script) { return this.s16(s) & 0xffff; }
  var(s: Script) {
    const d = this.player.seq;
    let v = d[s.pc++];
    if (v & 0x80) v = ((v << 8) & 0x7f00) | d[s.pc++];
    return v;
  }

  instrument(fontId: number, id: number): Instrument | null {
    const f = this.a.font(fontId);
    return id < f.instruments.length ? f.instruments[id] : null;
  }

  channelInit(ch: Channel) {
    ch.enabled = ch.finished = ch.stopScript = ch.hasInstrument = ch.largeNotes = false;
    ch.stereoHeadsetEffects = ch.transposition = ch.reverbIndex = ch.reverbVol = ch.gain = ch.delay = 0;
    ch.changes = 0xff;
    ch.state.depth = 0;
    ch.newPan = 0x40;
    ch.panChannelWeight = 0x80;
    ch.notePriority = 3;
    ch.adsr = { envelope: this.a.defaultEnvelope, decayIndex: 0x20, sustain: 0 };
    ch.vibratoRateTarget = ch.vibratoRateStart = 0x800;
    ch.vibratoDepthTarget = ch.vibratoDepthStart = ch.vibratoRateChangeDelay = ch.vibratoDepthChangeDelay = ch.vibratoDelay = 0;
    ch.volume = ch.volumeMod = ch.freqMod = 1;
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
      this.noteDecay(L);
    }
    L.channel = ch;
    L.adsr.envelope = ch.adsr.envelope;
    L.adsr.sustain = ch.adsr.sustain;
    L.adsr.decayIndex = 0;
    L.enabled = true;
    L.muted = L.continuousNotes = L.finished = L.keepPan = false;
    L.stereo = 0x40;
    L.portamento.mode = 0;
    L.state.depth = 0;
    L.unk3 = 0;
    L.gateTime = 0x80;
    L.pan = 0x40;
    L.transposition = L.delay = L.gateDelay = L.velocitySquare = 0;
    L.note = null;
    L.instrument = null;
    L.instOrWave = 0xff;
    L.freqMod = 1;
    return 0;
  }

  layerDisable(L: Layer | null) {
    if (!L) return;
    this.noteDecay(L);
    L.enabled = false;
    L.finished = true;
  }

  layerFree(ch: Channel, idx: number) {
    const L = ch.layers[idx];
    if (!L) return;
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

  setInstrument(ch: Channel, id: number) {
    if (id >= 0x80) {
      ch.instOrWave = id;
      ch.instrument = null;
    } else if (id === 0x7f) {
      ch.instOrWave = 0;
      ch.instrument = null;
    } else {
      const inst = this.instrument(ch.fontId, id);
      if (!inst) {
        ch.instrument = null;
        ch.instOrWave = 0;
        ch.hasInstrument = false;
        return;
      }
      ch.adsr.envelope = inst.envelope;
      ch.adsr.decayIndex = inst.decayIndex;
      ch.instrument = inst;
      ch.instOrWave = id + 1;
    }
    ch.hasInstrument = true;
  }

  // AudioSeq_SeqLayerProcessScript: one tick of a layer.
  layerProcess(L: Layer) {
    if (!L.enabled) return;
    if (L.delay >= 2) {
      L.delay--;
      if (!L.muted && L.gateDelay >= L.delay) {
        this.noteDecay(L);
        L.muted = true;
      }
      return;
    }
    if (!L.continuousNotes) this.noteDecay(L);
    else if (L.note !== null && L === L.note.wantedParentLayer) this.noteDecay(L);
    if ((L.portamento.mode & 0x7f) === 1 || (L.portamento.mode & 0x7f) === 2) L.portamento.mode = 0;
    const ch = L.channel!, s = L.state, P = ch.seqPlayer!, d = P.seq;
    L.ignoreDrumPan = true;
    let cmd: number;
    let sameSample = true;
    for (;;) {
      cmd = d[s.pc++];
      if (cmd <= 0xc0) break;
      switch (cmd) {
        case 0xff: // end / return
          if (s.depth === 0) { this.layerDisable(L); return; }
          s.pc = s.stack[--s.depth];
          break;
        case 0xfc: { const t = this.u16(s); s.stack[s.depth++] = s.pc; s.pc = t; break; } // call
        case 0xf8: s.loops[s.depth] = d[s.pc++]; s.stack[s.depth++] = s.pc; break; // loop start
        case 0xf7: // loop end
          s.loops[s.depth - 1] = (s.loops[s.depth - 1] - 1) & 0xff;
          if (s.loops[s.depth - 1] !== 0) s.pc = s.stack[s.depth - 1];
          else s.depth--;
          break;
        case 0xfb: s.pc = this.u16(s); break;
        case 0xf4: s.pc += s8(d[s.pc++]); break;
        case 0xc1: { const v = d[s.pc++]; L.velocitySquare = fround((v * v) / 16129); break; }
        case 0xca: L.pan = d[s.pc++]; break;
        case 0xc9: L.gateTime = d[s.pc++]; break;
        case 0xc2: L.transposition = d[s.pc++]; break; // stored unsigned; note arithmetic wraps at 8 bits
        case 0xc4: case 0xc5: L.continuousNotes = cmd === 0xc4; this.noteDecay(L); break;
        case 0xc3: L.shortNoteDefaultDelay = this.var(s); break;
        case 0xc6: { // layer instrument
          const id = d[s.pc++];
          if (id >= 0x7f) {
            if (id === 0x7f) L.instOrWave = 0;
            else { L.instOrWave = id; L.instrument = null; }
            if (id === 0xff) L.adsr.decayIndex = 0;
          } else {
            const inst = this.instrument(ch.fontId, id);
            if (!inst) { L.instrument = null; L.instOrWave = 0xff; }
            else { L.adsr.envelope = inst.envelope; L.adsr.decayIndex = inst.decayIndex; L.instrument = inst; L.instOrWave = id + 1; }
          }
          break;
        }
        case 0xc7: { // portamento
          L.portamento.mode = d[s.pc++];
          let note = (d[s.pc++] + ch.transposition + L.transposition + P.transposition) & 0xff;
          if (note >= 0x80) note = 0;
          L.portamentoTargetNote = note;
          L.portamentoTime = L.portamento.mode & 0x80 ? d[s.pc++] : this.var(s);
          break;
        }
        case 0xc8: L.portamento.mode = 0; break;
        case 0xcb: L.adsr.envelope = { bytes: d, off: this.u16(s) }; L.adsr.decayIndex = d[s.pc++]; break;
        case 0xcc: L.keepPan = true; break;
        case 0xcd: L.stereo = d[s.pc++]; break;
        default:
          if ((cmd & 0xf0) === 0xd0) { const v = SHORT_VELOCITY[cmd & 15]; L.velocitySquare = fround((v * v) / 16129); }
          else if ((cmd & 0xf0) === 0xe0) L.gateTime = SHORT_GATE[cmd & 15];
          break;
      }
    }
    if (cmd === 0xc0) { // rest
      L.delay = this.var(s);
      L.muted = true;
    } else {
      L.muted = false;
      let delay: number;
      const form = cmd & 0xc0;
      if (ch.largeNotes) {
        let vel: number;
        if (form === 0x00) { delay = this.var(s); vel = d[s.pc++]; L.gateTime = d[s.pc++]; L.lastDelay = delay; }
        else if (form === 0x40) { delay = this.var(s); vel = d[s.pc++]; L.gateTime = 0; L.lastDelay = delay; }
        else { delay = L.lastDelay; vel = d[s.pc++]; L.gateTime = d[s.pc++]; }
        if (vel > 127 || vel < 0) vel = 127;
        L.velocitySquare = fround((vel * vel) / 16129);
      } else if (form === 0x00) {
        delay = this.var(s);
        L.lastDelay = delay;
      } else {
        delay = form === 0x40 ? L.shortNoteDefaultDelay : L.lastDelay;
      }
      cmd &= 0x3f;
      L.delay = delay;
      L.gateDelay = (L.gateTime * delay) >> 8;
      if (P.muted && ch.muteBehavior & 0x50) {
        L.muted = true;
      } else {
        let instOrWave = L.instOrWave;
        if (instOrWave === 0xff) {
          if (!ch.hasInstrument) return;
          instOrWave = ch.instOrWave;
        }
        if (instOrWave === 0) { // drum
          const f = this.a.font(ch.fontId), dn = (cmd + ch.transposition + L.transposition) & 0xff;
          const drum = dn < f.drums.length ? f.drums[dn] : null;
          if (drum === null) { L.muted = true; return; }
          L.adsr.envelope = drum.envelope;
          L.adsr.decayIndex = drum.decayIndex;
          if (!L.keepPan) L.pan = drum.pan;
          L.tunedSample = drum.tunedSample;
          L.freqMod = L.tunedSample.tuning;
        } else {
          const note = (cmd + P.transposition + ch.transposition + L.transposition) & 0xff;
          if (note >= 0x80) {
            L.muted = true;
          } else {
            const inst = L.instOrWave === 0xff ? ch.instrument : L.instrument;
            if (L.portamento.mode !== 0) {
              const t2 = L.portamentoTargetNote < note ? note : L.portamentoTargetNote;
              let tuning = 1;
              if (inst) {
                const smp = sampleFor(inst, t2);
                sameSample = smp === L.tunedSample;
                L.tunedSample = smp;
                tuning = smp.tuning;
              } else {
                L.tunedSample = null;
              }
              const fv = fround(this.a.pitch[note] * tuning), fa = fround(this.a.pitch[L.portamentoTargetNote] * tuning);
              const mode = L.portamento.mode & 0x7f;
              let freqMod: number, v2: number;
              if (mode === 1 || mode === 3 || mode === 5) { v2 = fv; freqMod = fa; }
              else if (mode === 2 || mode === 4) { freqMod = fv; v2 = fa; }
              else { freqMod = fv; v2 = fv; }
              L.portamento.extent = fround(v2 / freqMod - 1);
              L.portamento.speed = L.portamento.mode & 0x80
                ? fround((P.tempo * 32512.0) / (L.delay * this.maxTempo * L.portamentoTime))
                : fround(127.0 / L.portamentoTime);
              L.portamento.cur = 0;
              L.freqMod = freqMod;
              if (mode === 5) L.portamentoTargetNote = note;
            } else if (inst) {
              const smp = sampleFor(inst, note);
              sameSample = smp === L.tunedSample;
              L.tunedSample = smp;
              L.freqMod = fround(this.a.pitch[note] * smp.tuning);
            } else {
              L.tunedSample = null;
              L.freqMod = this.a.pitch[note];
            }
          }
        }
      }
    }
    const smp = L.tunedSample?.sample;
    if (!L.muted && smp && smp.codec === 2 && smp.medium !== 0) L.muted = true;
    if (L.muted) {
      if (L.note !== null || L.continuousNotes) this.noteDecay(L);
      return;
    }
    let alloc = false;
    if (!L.continuousNotes || L.note === null || L.unk3 === 0) alloc = true;
    else if (!sameSample) { this.noteDecay(L); alloc = true; }
    else if (L !== L.note.parentLayer) alloc = true;
    else if (L.tunedSample === null) this.buildSyntheticWave(L.note, L, L.instOrWave === 0xff ? ch.instOrWave : L.instOrWave);
    if (alloc) L.note = this.allocNote(L);
    if (L.note !== null && L === L.note.parentLayer) this.vibratoInit(L.note);
  }

  // AudioSeq_SequenceChannelProcessScript: one tick of a channel, then its layers.
  channelProcess(ch: Channel) {
    if (!ch.enabled) return;
    if (ch.stopScript) {
      for (const L of ch.layers) if (L) this.layerProcess(L);
      return;
    }
    const P = ch.seqPlayer!, d = P.seq;
    if (P.muted && ch.muteBehavior & 0x80) return;
    if (ch.delay !== 0) ch.delay--;
    if (ch.delay === 0) {
      const s = ch.state;
      let val = P.scriptValue; // an uninitialised s8 local in the game, sharing its stack slot
      loop: for (;;) {
        const cmd = d[s.pc++];
        if (cmd > 0xc0) {
          switch (cmd) {
            case 0xff:
              if (s.depth === 0) { this.channelDisable(ch); break loop; }
              s.pc = s.stack[--s.depth];
              break;
            case 0xfe: break loop; // yield
            case 0xfd: ch.delay = this.var(s); break loop;
            case 0xea: ch.stopScript = true; break loop;
            case 0xfc: { const t = this.u16(s); s.stack[s.depth++] = s.pc; s.pc = t; break; }
            case 0xf8: s.loops[s.depth] = d[s.pc++]; s.stack[s.depth++] = s.pc; break;
            case 0xf7:
              s.loops[s.depth - 1] = (s.loops[s.depth - 1] - 1) & 0xff;
              if (s.loops[s.depth - 1] !== 0) s.pc = s.stack[s.depth - 1];
              else s.depth--;
              break;
            case 0xf6: s.depth--; break;
            case 0xf5: case 0xf9: case 0xfa: case 0xfb: {
              const t = this.u16(s);
              if ((cmd === 0xfa && val !== 0) || (cmd === 0xf9 && val >= 0) || (cmd === 0xf5 && val < 0)) break;
              s.pc = t;
              break;
            }
            case 0xf2: case 0xf3: case 0xf4: {
              const r = s8(d[s.pc++]);
              if ((cmd === 0xf3 && val !== 0) || (cmd === 0xf2 && val >= 0)) break;
              s.pc += r;
              break;
            }
            case 0xf1: this.notePoolClear(ch.notePool); s.pc++; break; // (note reservation is not used by music)
            case 0xf0: this.notePoolClear(ch.notePool); break;
            case 0xc2: ch.dynTable = this.u16(s); break;
            case 0xc5: if (val !== -1) { const p = ch.dynTable + 2 * val; ch.dynTable = (d[p] << 8) | d[p + 1]; } break;
            case 0xeb: ch.fontId = this.fontFromIndex(P, d[s.pc++]); this.setInstrument(ch, d[s.pc++]); break;
            case 0xc1: this.setInstrument(ch, d[s.pc++]); break;
            case 0xc3: ch.largeNotes = false; break;
            case 0xc4: ch.largeNotes = true; break;
            case 0xdf: ch.volume = fround(d[s.pc++] / 127.0); ch.changes |= 2; break;
            case 0xe0: ch.volumeMod = fround(d[s.pc++] / 128.0); ch.changes |= 2; break;
            case 0xde: ch.freqMod = fround(this.s16(s) / 32768.0); ch.changes |= 1; break;
            case 0xd3: ch.freqMod = this.a.bendOctave[(d[s.pc++] + 0x80) & 0xff]; ch.changes |= 1; break;
            case 0xee: ch.freqMod = this.a.bendTwo[(d[s.pc++] + 0x80) & 0xff]; ch.changes |= 1; break;
            case 0xdd: ch.newPan = d[s.pc++]; ch.changes |= 4; break;
            case 0xdc: ch.panChannelWeight = d[s.pc++]; ch.changes |= 4; break;
            case 0xdb: ch.transposition = s8(d[s.pc++]); break;
            case 0xda: ch.adsr.envelope = { bytes: d, off: this.u16(s) }; break;
            case 0xd9: ch.adsr.decayIndex = d[s.pc++]; break;
            case 0xd8: ch.vibratoDepthTarget = d[s.pc++] * 8; ch.vibratoDepthStart = 0; ch.vibratoDepthChangeDelay = 0; break;
            case 0xd7: ch.vibratoRateStart = ch.vibratoRateTarget = d[s.pc++] * 32; ch.vibratoRateChangeDelay = 0; break;
            case 0xe2:
              ch.vibratoDepthStart = d[s.pc++] * 8; ch.vibratoDepthTarget = d[s.pc++] * 8; ch.vibratoDepthChangeDelay = d[s.pc++] * 16;
              break;
            case 0xe1:
              ch.vibratoRateStart = d[s.pc++] * 32; ch.vibratoRateTarget = d[s.pc++] * 32; ch.vibratoRateChangeDelay = d[s.pc++] * 16;
              break;
            case 0xe3: ch.vibratoDelay = d[s.pc++] * 16; break;
            case 0xd4: ch.reverbVol = d[s.pc++]; break;
            case 0xc6: ch.fontId = this.fontFromIndex(P, d[s.pc++]); break;
            case 0xc7: { const add = d[s.pc++], off = this.u16(s); d[off] = (val + add) & 0xff; break; }
            case 0xc8: val = s8(val - s8(d[s.pc++])); break;
            case 0xc9: val = s8(val & s8(d[s.pc++])); break;
            case 0xcc: val = s8(d[s.pc++]); break;
            case 0xcd: { const c = P.channels[d[s.pc++]]; if (c) this.channelDisable(c); break; }
            case 0xca: ch.muteBehavior = d[s.pc++]; break;
            case 0xcb: { const off = this.u16(s); val = s8(d[(off + val) & 0xffff]); break; }
            case 0xce: ch.stored = this.u16(s); break;
            case 0xcf: { const off = this.u16(s); d[off] = ch.stored >> 8; d[off + 1] = ch.stored & 0xff; break; }
            case 0xd0: ch.stereoHeadsetEffects = d[s.pc++]; break;
            case 0xd1: ch.noteAllocPolicy = d[s.pc++]; break;
            case 0xd2: ch.adsr.sustain = d[s.pc++]; break;
            case 0xe5: ch.reverbIndex = d[s.pc++]; break;
            case 0xe4: if (val !== -1) { const p = ch.dynTable + 2 * val; s.stack[s.depth++] = s.pc; s.pc = (d[p] << 8) | d[p + 1]; } break;
            case 0xe6: s.pc++; break; // book offset (not used by the synthesis)
            case 0xe7: case 0xe8: { // multi-parameter set, from a table or inline
              let p = cmd === 0xe7 ? this.u16(s) : s.pc;
              ch.muteBehavior = d[p++]; ch.noteAllocPolicy = d[p++]; ch.notePriority = d[p++]; ch.transposition = s8(d[p++]);
              ch.newPan = d[p++]; ch.panChannelWeight = d[p++]; ch.reverbVol = d[p++]; ch.reverbIndex = d[p++];
              if (cmd === 0xe8) s.pc = p;
              ch.changes |= 4;
              break;
            }
            case 0xec:
              ch.vibratoDepthTarget = ch.vibratoDepthStart = ch.vibratoDepthChangeDelay = 0;
              ch.vibratoRateTarget = ch.vibratoRateStart = ch.vibratoRateChangeDelay = 0;
              ch.freqMod = 1;
              break;
            case 0xe9: ch.notePriority = d[s.pc++]; break;
            case 0xed: ch.gain = d[s.pc++]; break;
            case 0xef: s.pc += 3; break; // debug print
            default: break; // D5, D6 and undefined commands: no-ops
          }
        } else {
          const lo = cmd & 15;
          switch (cmd & 0xf0) {
            case 0x00: { const L = ch.layers[lo]; val = L !== null ? (L.finished ? 1 : 0) : -1; break; }
            case 0x10: ch.io[lo] = -1; break;
            case 0x70: ch.io[lo] = val; break;
            case 0x80: val = ch.io[lo]; if (lo < 4) ch.io[lo] = -1; break;
            case 0x50: val = s8(val - ch.io[lo]); break;
            case 0x60: ch.delay = lo; break loop;
            case 0x90: { const t = this.u16(s); if (this.setLayer(ch, lo) === 0) ch.layers[lo]!.state.pc = t; break; }
            case 0xa0: this.layerFree(ch, lo); break;
            case 0xb0:
              if (val !== -1 && this.setLayer(ch, lo) !== -1) { const p = ch.dynTable + 2 * val; ch.layers[lo]!.state.pc = (d[p] << 8) | d[p + 1]; }
              break;
            case 0x20: this.channelEnable(P, lo, this.u16(s)); break;
            case 0x30: { const port = d[s.pc++], c = P.channels[lo]; if (c) c.io[port] = val; break; }
            case 0x40: { const port = d[s.pc++], c = P.channels[lo]; val = c ? c.io[port] : -1; break; }
          }
        }
      }
      P.scriptValue = val;
    }
    for (const L of ch.layers) if (L) this.layerProcess(L);
  }

  // Font by index into the sequence's font list, counted from its end.
  fontFromIndex(P: SeqPlayer, idx: number) {
    const fonts = this.a.fontsForSequence(P.seqId);
    return fonts[fonts.length - idx - 1] ?? P.defaultFont;
  }

  channelEnable(P: SeqPlayer, idx: number, pc: number) {
    const ch = P.channels[idx];
    if (!ch) return;
    ch.state.depth = 0;
    ch.state.pc = pc;
    ch.enabled = true;
    ch.finished = false;
    ch.delay = 0;
    for (let i = 0; i < 4; i++) if (ch.layers[i]) this.layerFree(ch, i);
  }

  setupChannels(P: SeqPlayer, bits: number) {
    for (let i = 0; i < 16; i++, bits >>= 1) {
      if (!(bits & 1)) continue;
      const old = P.channels[i];
      if (old && old.seqPlayer === P) {
        this.channelDisable(old);
        old.seqPlayer = null;
      }
      const ch = new Channel(this.a.defaultEnvelope);
      this.channelInit(ch);
      P.channels[i] = ch;
      ch.seqPlayer = P;
      ch.fontId = P.defaultFont;
      ch.muteBehavior = P.muteBehavior;
      ch.noteAllocPolicy = P.noteAllocPolicy;
    }
  }

  disableChannels(P: SeqPlayer, bits: number) {
    for (let i = 0; i < 16; i++, bits >>= 1) {
      const ch = P.channels[i];
      if (!(bits & 1) || !ch) continue;
      if (ch.seqPlayer === P) {
        this.channelDisable(ch);
        ch.seqPlayer = null;
      }
      P.channels[i] = null;
    }
  }

  playerDisable(P: SeqPlayer) {
    this.disableChannels(P, 0xffff);
    this.notePoolClear(P.notePool);
    P.finished = true;
    P.enabled = false;
  }

  // AudioSeq_SequencePlayerProcessSequence: tempo clock, then (on a tick) the player script and every channel.
  playerProcess(P: SeqPlayer) {
    if (!P.enabled || (P.muted && P.muteBehavior & 0x80)) return;
    P.tempoAcc = u16(P.tempoAcc + P.tempo);
    P.tempoAcc = u16(P.tempoAcc + s16(P.tempoChange));
    if (P.tempoAcc < this.maxTempo) return;
    P.tempoAcc = u16(P.tempoAcc - this.maxTempo);
    if (P.delay > 1) {
      P.delay--;
    } else {
      const s = P.state, d = P.seq;
      P.recalculateVolume = true;
      let val = 0;
      for (;;) {
        const pc = s.pc, cmd = d[s.pc++];
        if (cmd === 0xff) {
          if (s.depth === 0) { this.playerDisable(P); break; }
          s.pc = s.stack[--s.depth];
        }
        if (cmd === 0xfd) { P.delay = this.var(s); break; }
        if (cmd === 0xfe) { P.delay = 1; break; }
        if (cmd >= 0xc0) {
          switch (cmd) {
            case 0xfc: { const t = this.u16(s); s.stack[s.depth++] = s.pc; s.pc = t; break; }
            case 0xf8: s.loops[s.depth] = d[s.pc++]; s.stack[s.depth++] = s.pc; break;
            case 0xf7:
              s.loops[s.depth - 1] = (s.loops[s.depth - 1] - 1) & 0xff;
              if (s.loops[s.depth - 1] !== 0) s.pc = s.stack[s.depth - 1];
              else s.depth--;
              break;
            case 0xf5: case 0xf9: case 0xfa: case 0xfb: {
              const t = this.u16(s);
              if ((cmd !== 0xfa || val === 0) && (cmd !== 0xf9 || val < 0) && (cmd !== 0xf5 || val >= 0)) {
                s.pc = t;
                if (t <= pc) this.onBackJump(t); // song loops are backward jumps
              }
              break;
            }
            case 0xf2: case 0xf3: case 0xf4: {
              const r = s8(d[s.pc++]);
              if ((cmd !== 0xf3 || val === 0) && (cmd !== 0xf2 || val < 0)) s.pc += r;
              break;
            }
            case 0xf1: this.notePoolClear(P.notePool); s.pc++; break;
            case 0xf0: this.notePoolClear(P.notePool); break;
            case 0xdf: P.transposition = 0; P.transposition += s8(d[s.pc++]); break;
            case 0xde: P.transposition += s8(d[s.pc++]); break;
            case 0xdd:
              P.tempo = d[s.pc++] * 48;
              if (P.tempo > this.maxTempo) P.tempo = this.maxTempo;
              if (s16(P.tempo) <= 0) P.tempo = 1;
              break;
            case 0xdc: P.tempoChange = s8(d[s.pc++]) * 48; break;
            case 0xda: {
              const mode = d[s.pc++], t = this.u16(s);
              if (mode === 0 || mode === 1) {
                if (P.fadeState !== 2) { P.fadeInTime = t; P.fadeState = mode; }
              } else if (mode === 2) {
                P.fadeTimer = t;
                P.fadeState = mode;
                P.fadeVelocity = fround((0 - P.fadeVolume) / t);
              }
              break;
            }
            case 0xdb: {
              const v = d[s.pc++];
              if (P.fadeState === 2) break;
              if (P.fadeState === 1) { P.fadeState = 0; P.fadeVolume = 0; }
              P.fadeTimer = P.fadeInTime;
              if (P.fadeInTime !== 0) P.fadeVelocity = fround((v / 127 - P.fadeVolume) / P.fadeTimer);
              else P.fadeVolume = fround(v / 127);
              break;
            }
            case 0xd9: P.fadeVolumeMod = fround(s8(d[s.pc++]) / 127); break;
            case 0xd7: this.setupChannels(P, this.u16(s)); break;
            case 0xd6: this.disableChannels(P, this.u16(s)); break;
            case 0xd5: P.muteVolumeMod = fround(s8(d[s.pc++]) / 127); break;
            case 0xd4: P.muted = true; break;
            case 0xd3: P.muteBehavior = d[s.pc++]; break;
            case 0xd1: case 0xd2: s.pc += 2; break;
            case 0xd0: P.noteAllocPolicy = d[s.pc++]; break;
            case 0xcc: val = d[s.pc++]; break;
            case 0xc9: val &= d[s.pc++]; break;
            case 0xc8: val -= d[s.pc++]; break;
            case 0xc7: { const add = d[s.pc++], off = this.u16(s); d[off] = (val + add) & 0xff; break; }
          }
        } else {
          const lo = cmd & 15;
          switch (cmd & 0xf0) {
            case 0x00: { const c = P.channels[lo]; val = c ? (c.finished ? 1 : 0) : 0; break; }
            case 0x50: val -= P.io0; break;
            case 0x70: P.io0 = s8(val); break;
            case 0x80: val = P.io0; break;
            case 0x90: this.channelEnable(P, lo, this.u16(s)); break;
          }
        }
      }
    }
    for (const ch of P.channels) if (ch) this.channelProcess(ch);
  }

  // AudioSeq_SequencePlayerProcessSound: fades, then volume/pan/pitch propagation to the layers.
  playerProcessSound(P: SeqPlayer) {
    if (P.fadeTimer !== 0) {
      P.fadeVolume = fround(P.fadeVolume + P.fadeVelocity);
      P.recalculateVolume = true;
      if (P.fadeVolume > 1) P.fadeVolume = 1;
      if (P.fadeVolume < 0) P.fadeVolume = 0;
      if (--P.fadeTimer === 0 && P.fadeState === 2) { this.playerDisable(P); return; }
    }
    if (P.recalculateVolume) P.appliedFadeVolume = fround(P.fadeVolume * P.fadeVolumeMod);
    for (const ch of P.channels) {
      if (!ch || !ch.enabled) continue;
      const update = P.recalculateVolume;
      if (ch.changes & 2 || update) {
        let v = fround(ch.volume * ch.volumeMod * P.appliedFadeVolume);
        if (P.muted && ch.muteBehavior & 0x20) v = fround(P.muteVolumeMod * v);
        ch.appliedVolume = fround(v * v);
      }
      if (ch.changes & 4) ch.pan = ch.newPan * ch.panChannelWeight;
      for (const L of ch.layers) {
        if (!L || !L.enabled || L.note === null) continue;
        if (L.ignoreDrumPan) {
          L.noteFreqMod = fround(L.freqMod * ch.freqMod);
          L.noteVelocity = fround(L.velocitySquare * ch.appliedVolume);
          L.notePan = (ch.pan + L.pan * (0x80 - ch.panChannelWeight)) >> 7;
          L.ignoreDrumPan = false;
        } else {
          if (ch.changes & 1) L.noteFreqMod = fround(L.freqMod * ch.freqMod);
          if (ch.changes & 2 || update) L.noteVelocity = fround(L.velocitySquare * ch.appliedVolume);
          if (ch.changes & 4) L.notePan = (ch.pan + L.pan * (0x80 - ch.panChannelWeight)) >> 7;
        }
      }
      ch.changes = 0;
    }
    P.recalculateVolume = false;
  }

  start(seqId: number, bgmParam: number) {
    const P = this.player, fonts = this.a.fontsForSequence(seqId);
    P.seqId = this.a.resolveSeq(seqId);
    P.defaultFont = fonts.length ? fonts[fonts.length - 1] : 0xff;
    P.seq = this.a.sequenceData(seqId);
    P.enabled = true;
    P.state = newScript(0);
    P.delay = 0;
    P.finished = false;
    P.fadeState = 1;
    P.tempo = 120 * 48;
    P.tempoAcc = 0;
    P.io0 = s8(bgmParam);
  }

  // One driver update: scripts, ProcessNotes, and the snapshot the synthesis reads (AudioSynth_SyncSampleStates).
  update(): (NoteSub | null)[] {
    const P = this.player;
    if (P.enabled) {
      this.playerProcess(P);
      this.playerProcessSound(P);
    }
    this.processNotes();
    for (let i = 0; i < this.numNotes; i++) {
      const n = this.notes[i];
      if (n.sub.enabled) {
        this.snaps[i] = Object.assign(n.snap, n.sub);
        n.sub.needsInit = false;
      } else {
        this.snaps[i] = null;
      }
    }
    return this.snaps;
  }

  activeNotes() {
    let c = 0;
    for (const n of this.notes) if (n.sub.enabled) c++;
    return c;
  }

  // ---- synthesis (AudioSynth_DoOneAudioUpdate and the NEAD SF commands as rsp-hle runs them) ----

  // Mixes `len` samples into dl / dr (16-bit values).
  synthUpdate(len: number, snaps: (NoteSub | null)[]) {
    const { dl, dr, done } = this;
    dl.fill(0, 0, len + 8);
    dr.fill(0, 0, len + 8);
    done.fill(0);
    for (const r of this.reverbs) { // AudioSynth_InitNextRingBuf
      const num = Math.trunc(len / r.ds);
      r.start = r.next;
      r.len = num;
      r.next = r.next + num >= r.bufSize ? r.next + num - r.bufSize : r.next + num;
    }
    for (let ri = 0; ri < this.reverbs.length; ri++) {
      const r = this.reverbs[ri];
      this.loadReverb(r, len);
      for (let i = 0; i < this.numNotes; i++) {
        const sn = snaps[i];
        if (sn && sn.reverbIndex === ri) {
          this.processNote(this.notes[i], sn, len, true);
          done[i] = 1;
        }
      }
      this.saveReverb(r);
    }
    for (let i = 0; i < this.numNotes; i++) {
      const sn = snaps[i];
      if (sn && !done[i]) this.processNote(this.notes[i], sn, len, false);
    }
  }

  // The reverb's delayed signal: into the main bus, decayed, optionally cross-leaked; the notes' sends are added next.
  loadReverb(r: Reverb, len: number) {
    const { wl, wr, dl, dr } = this;
    wl.fill(0);
    wr.fill(0);
    if (r.ds === 1) {
      for (let j = 0; j < r.len; j++) {
        const p = (r.start + j) % r.bufSize;
        wl[j] = r.ringL[p];
        wr[j] = r.ringR[p];
      }
    } else {
      // Half-rate ring, read back through the RSP resampler at pitch 0.5.
      for (const [ring, w, st] of [[r.ringL, wl, r.upL], [r.ringR, wr, r.upR]] as const) {
        let acc = st.acc, rp = r.start;
        const hist = st.hist;
        for (let j = 0; j < len; j++) {
          const k = (acc >> 8) & 0xfc;
          w[j] = clamp16((hist[0] * LUT[k] + hist[1] * LUT[k + 1] + hist[2] * LUT[k + 2] + hist[3] * LUT[k + 3]) >> 15);
          acc += 0x8000;
          const adv = acc >> 16;
          acc &= 0xffff;
          for (let a = 0; a < adv; a++) {
            hist[0] = hist[1]; hist[1] = hist[2]; hist[2] = hist[3];
            hist[3] = ring[rp++ % r.bufSize];
          }
        }
        st.acc = acc;
      }
    }
    const g = s16(r.decayRatio + 0x8000); // wet += wet * (decay - 1): wet * decayRatio / 32768
    for (let j = 0; j < 384 && j < len + 8; j++) {
      dl[j] = clamp16(dl[j] + wl[j]);
      dr[j] = clamp16(dr[j] + wr[j]);
      wl[j] = clamp16(wl[j] + ((wl[j] * g) >> 15));
      wr[j] = clamp16(wr[j] + ((wr[j] * g) >> 15));
    }
    if (r.leakRtL || r.leakLtR) {
      const gl = s16(r.leakRtL), gr = s16(r.leakLtR);
      for (let j = 0; j < 192; j++) {
        const oldL = wl[j];
        wl[j] = clamp16(wl[j] + ((wr[j] * gl) >> 15));
        wr[j] = clamp16(wr[j] + ((oldL * gr) >> 15));
      }
    }
  }

  saveReverb(r: Reverb) {
    const { wl, wr } = this;
    for (let j = 0, k = 0; j < r.len; j++, k += r.ds) {
      const p = (r.start + j) % r.bufSize;
      r.ringL[p] = wl[k];
      r.ringR[p] = wr[k];
    }
  }

  // AudioSynth_ProcessNote: sample stream, RESAMPLE, HILOGAIN, ENVMIXER.
  processNote(n: Note, sn: NoteSub, len: number, wet: boolean) {
    const tmp = this.tmp;
    if (sn.needsInit) {
      n.pos = -4; // 4 zero history samples
      n.acc = 0;
      n.curVolLeft = 0;
      n.curVolRight = 0;
      n.sub.finished = false;
    }
    let buf: Int16Array, wrapAt: number, wrapLen: number, endPos: number;
    if (sn.isSyntheticWave && sn.wave) {
      buf = sn.wave;
      wrapAt = wrapLen = 64;
      endPos = Infinity;
    } else {
      const smp = sn.tunedSample?.sample;
      if (!smp) return;
      const p = prepareWave(this.a.rom, smp);
      buf = p.buf; wrapAt = p.wrapAt; wrapLen = p.wrapLen; endPos = p.silentAt;
    }
    // Pitch is resampleRate * 2 in 16.16; above 2x the game resamples every other input sample (approximated).
    const pitch = (sn.resampleRate << 1) * (sn.hasTwoParts ? 2 : 1);
    let pos = n.pos, acc = n.acc;
    for (let j = 0; j < len; j++) {
      let v = 0;
      if (pos < endPos) {
        const k = (acc >> 8) & 0xfc;
        if (pos >= 0) {
          v = (buf[pos] * LUT[k] + buf[pos + 1] * LUT[k + 1] + buf[pos + 2] * LUT[k + 2] + buf[pos + 3] * LUT[k + 3]) >> 15;
        } else {
          for (let t = 0; t < 4; t++) if (pos + t >= 0 && pos + t < buf.length) v += buf[pos + t] * LUT[k + t];
          v >>= 15;
        }
        v = clamp16(v);
      }
      tmp[j] = v;
      acc += pitch;
      pos += acc >>> 16;
      acc &= 0xffff;
      if (pos >= wrapAt) pos -= wrapLen;
    }
    const finished = pos + 4 >= endPos;
    n.pos = pos;
    n.acc = acc;
    if (sn.gain !== 0) { // HILOGAIN, signed Q4.4
      const g = s8(sn.gain < 0x10 ? 0x10 : sn.gain);
      for (let j = 0; j < len; j++) tmp[j] = clamp16((tmp[j] * g) >> 4);
    }
    // ENVMIXER (alist_envmix_nead): volume and send ramp linearly per 8 samples from the previous update's values.
    const steps = len >> 3;
    const tL = u16(sn.panVolLeft << 4), tR = u16(sn.panVolRight << 4);
    const cL = n.curVolLeft, cR = n.curVolRight;
    const rampL = tL !== cL ? s16(Math.trunc((tL - cL) / steps)) : 0;
    const rampR = tR !== cR ? s16(Math.trunc((tR - cR) / steps)) : 0;
    const srcRev = n.reverbVol;
    let rampRev = 0;
    if (sn.reverb !== srcRev) {
      rampRev = s16(Math.trunc((((sn.reverb & 0x7f) - (srcRev & 0x7f)) << 8) / steps));
      n.reverbVol = sn.reverb;
    }
    n.curVolLeft = u16(cL + rampL * steps);
    n.curVolRight = u16(cR + rampR * steps);
    let vL = cL, vR = cR, vW = ((srcRev & 0x7f) << 8) & 0xff00;
    const xl = sn.stereoStrongRight ? -1 : 0, xr = sn.stereoStrongLeft ? -1 : 0; // phase inversion
    const { dl, dr, wl, wr } = this;
    const count = (len + 7) & ~7;
    for (let j = 0; j < count; j += 8) {
      for (let i = j; i < j + 8; i++) {
        const x = i < len ? tmp[i] : 0;
        const l = s16((x * vL) >> 16) ^ xl, r = s16((x * vR) >> 16) ^ xr;
        dl[i] = clamp16(dl[i] + l);
        dr[i] = clamp16(dr[i] + r);
        if (wet) {
          wl[i] = clamp16(wl[i] + s16((l * vW) >> 16));
          wr[i] = clamp16(wr[i] + s16((r * vW) >> 16));
        }
      }
      vL = u16(vL + rampL);
      vR = u16(vR + rampR);
      vW = u16(vW + rampRev);
    }
    if (finished) n.sub.finished = true;
  }
}

// ---- rendering -----------------------------------------------------------------------------------------------------

// Interleaved 16-bit blocks while rendering: half the size of the final Float32 channels, built once the length is known.
class Pcm {
  private blocks: Int16Array[] = [];
  private block = new Int16Array(0);
  private fill = 0;

  push(l: Int32Array, r: Int32Array, len: number) {
    let b = this.block, k = this.fill;
    for (let j = 0; j < len; j++) {
      if (k === b.length) { b = new Int16Array(2 * PCM_BLOCK); this.blocks.push(b); k = 0; }
      b[k++] = l[j];
      b[k++] = r[j];
    }
    this.block = b;
    this.fill = k;
  }

  channels(frames: number, gain: number): Float32Array[] {
    const L = new Float32Array(frames), R = new Float32Array(frames), scale = gain / 32768;
    for (let bi = 0, i = 0; i < frames; bi++) {
      const b = this.blocks[bi];
      for (let k = 0; k < b.length && i < frames; k += 2, i++) {
        L[i] = Math.max(-1, Math.min(1, b[k] * scale));
        R[i] = Math.max(-1, Math.min(1, b[k + 1] * scale));
      }
    }
    this.blocks = [];
    return [L, R];
  }
}

// Plays a sequence from the start. A looping song ends its loop with a sequence-level backward jump: the render stops
// at its third execution, and [second, third) is the loop, carrying the previous pass's release tails and reverb at both
// ends. A song that ends renders until 2 s of silence (at most 6 s past the end); a loop without note-ons ends there.
function render(data: AudioData, seqId: number, specId: number): DecodedMusic {
  const eng = new Engine(data, specId);
  const nb = eng.spec.numBuffers, updatesPerTask = TICKS_PER_UPDATE * nb;
  const taskSamples = (RATE * nb) / 60; // one audio task per numBuffers frames, split into 3 * numBuffers updates
  const perUpdate = Math.trunc(((Math.trunc(RATE / 60) + 15) & ~15) / 3) & ~7; // 176, clamped to 168..184
  const lens = new Array<number>(updatesPerTask).fill(0);
  const pcm = new Pcm();
  const tail = TAIL_SECONDS * RATE;
  const passStarts: number[] = [];
  let loopTarget = -1, pos = 0;
  eng.onBackJump = (target) => {
    if (loopTarget < 0) loopTarget = target;
    if (target === loopTarget) passStarts.push(pos);
  };
  eng.start(seqId, -1);
  let ended: 'loop' | 'end' | 'silent' | 'max' = 'max';
  let endSample = -1, silentSince = -1, frac = 0, notesInPass = 0, inPass = false;
  outer: for (;;) {
    frac += taskSamples;
    let rem = Math.floor(frac);
    frac -= rem;
    for (let i = updatesPerTask, k = 0; i > 0; i--, k++) {
      const avg = Math.trunc(rem / i);
      lens[k] = i === 1 ? rem : avg >= perUpdate + 8 ? perUpdate + 8 : perUpdate - 8 >= avg ? perUpdate - 8 : perUpdate;
      rem -= lens[k];
    }
    for (const len of lens) {
      const passes = passStarts.length;
      const snaps = eng.update();
      if (passStarts.length !== passes) {
        if (passStarts.length >= 2 && inPass && notesInPass === 0) { ended = 'silent'; endSample = passStarts[passStarts.length - 1]; }
        notesInPass = 0;
        inPass = true;
      }
      for (const sn of snaps) if (sn && sn.needsInit) notesInPass++;
      eng.synthUpdate(len, snaps);
      pcm.push(eng.dl, eng.dr, len);
      pos += len;
      if (ended === 'silent') break outer;
      if (passStarts.length > LOOP_PASSES) { ended = 'loop'; break outer; }
      if (!eng.player.enabled && endSample < 0) endSample = pos;
      if (endSample >= 0) {
        if (eng.activeNotes() !== 0) silentSince = -1;
        else if (silentSince < 0) silentSince = pos;
        if ((silentSince >= 0 && pos - silentSince >= Math.min(tail, 2 * RATE)) || pos - endSample > tail) { ended = 'end'; break outer; }
      }
      if (pos >= MAX_SECONDS * RATE) break outer;
    }
  }
  const music: DecodedMusic = { sampleRate: RATE, channels: pcm.channels(ended === 'silent' ? endSample : pos, GAIN) };
  if (ended === 'loop') {
    music.loopStart = passStarts[passStarts.length - 2];
    music.loopEnd = passStarts[passStarts.length - 1];
  }
  return music;
}
