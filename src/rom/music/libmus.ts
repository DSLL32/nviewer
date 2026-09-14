// BattleTanx: Global Assault (USA): the soundtrack, rendered offline by emulating the game's
// music player, Software Creations' libmus, on libultra's synthesizer.
//
// Sound file table ROM 0xA4710: 26 x {u32 cart address, u32 length}. File 3 is the music
// pointer bank ("N64 PtrTablesV2": wave records, VADPCM books and loops), file 4 its sample data
// ("N64 WaveTables", samples from +0x10), files 5..25 are songs 0..20 (version 0x215): per
// channel a bytecode stream plus optional volume and pitch-bend streams, envelope and drum
// tables, a song wave -> bank wave map and a master track for the tempo.
// The player ticks every 16666 us (367 output samples at 22047 Hz). It is ported from the
// disassembly (tick 0x800FC02C, note fetch 0x800FC31C, commands via table 0x80126590), and the
// voices are mixed like the RSP: VADPCM, 4-tap resampling, squared volume with linear 367-sample
// ramps, equal-power pan and libultra's BIGROOM reverb, which the game always uses.
import type { DecodedMusic, MusicTrack } from '../types';
import { view } from '../util';
import { decodeVadpcm, RESAMPLE_LUT } from './libultra';

const OUTPUT_RATE = 22047;
const FPS = 60;
const TICK_SAMPLES = 367;
const SONG_MASTER_VOLUME = 12603;
const FILE_TABLE = 0xa4710;
const BANK_FILE = 3;
const SAMPLE_FILE = 4;
const FIRST_SONG_FILE = 5;
const LN2 = 0.693147180559945;
const TAIL_TICKS = FPS * 4;

// Songs by where the game plays them (there is no sound test).
const SONG_NAMES = [
  'Title and Menus', 'Cutscenes A', 'Battle', 'Bistro', 'Mission Complete', 'SF Breakout', 'Drive In',
  'Texas Slave Fortress', 'Escape from Berlin', 'Champs Elysee', 'Truck Stop', 'Tower Bridge', 'DC Mall',
  'Houses of Parliament', 'Brandenburg Gate', 'SF Airport', 'White House', 'Time Expired', 'Tower of London',
  'Unused', 'Berlin War Zone',
];

const EQPOWER = new Int32Array(128).map((_, i) => Math.round(32767 * Math.cos((i / 127) * (Math.PI / 2))));
// libultra's table (0x80126A20); identical to the rounded cosine except for a few entries.
const EQPOWER_TABLE = Int32Array.from([
  32767, 32764, 32757, 32744, 32727, 32704, 32677, 32644, 32607, 32564, 32517, 32464, 32407, 32344, 32277, 32205,
  32127, 32045, 31958, 31866, 31770, 31668, 31561, 31450, 31334, 31213, 31087, 30957, 30822, 30682, 30537, 30388,
  30234, 30075, 29912, 29744, 29572, 29395, 29214, 29028, 28838, 28643, 28444, 28241, 28033, 27821, 27605, 27385,
  27160, 26931, 26698, 26461, 26220, 25975, 25726, 25473, 25216, 24956, 24691, 24423, 24151, 23875, 23596, 23313,
  23026, 22736, 22442, 22145, 21845, 21541, 21234, 20924, 20610, 20294, 19974, 19651, 19325, 18997, 18665, 18331,
  17993, 17653, 17310, 16965, 16617, 16266, 15913, 15558, 15200, 14840, 14477, 14113, 13746, 13377, 13006, 12633,
  12258, 11881, 11503, 11122, 10740, 10357, 9971, 9584, 9196, 8806, 8415, 8023, 7630, 7235, 6839, 6442,
  6044, 5646, 5246, 4845, 4444, 4042, 3640, 3237, 2833, 2429, 2025, 1620, 1216, 810, 405, 0,
]);
void EQPOWER;

const f32 = Math.fround;
const u8 = (v: number) => v & 0xff;
const s8 = (v: number) => ((v & 0xff) << 24) >> 24;
const u16 = (v: number) => v & 0xffff;
const s16 = (v: number) => (v << 16) >> 16;
const clamp16 = (v: number) => (v > 32767 ? 32767 : v < -32768 ? -32768 : v);

// 2^x as libmus computes it (0x800FD10C): a 6th-order series of e^(x ln 2), inverted for x < 0.
function musPow2(x: number): number {
  x = f32(x);
  if (x === 0) return 1;
  const neg = x < 0;
  if (neg) x = -x;
  const x2 = f32(x * x), x3 = f32(x2 * x), x4 = f32(x2 * x2), x5 = f32(x4 * x), x6 = f32(x4 * x2);
  const s = 1 + x * LN2 + x2 * 0.240226506959101 + x3 * 0.0555041086648216 + x4 * 0.00961812910762848 +
    x5 * 0.00133335581464284 + x6 * 0.000154035303933816;
  return f32(neg ? 1 / s : s);
}

export interface Wave {
  base: number; // ROM offset of the samples
  len: number;
  type: number;
  book: Int16Array | null;
  loopStart: number;
  loopEnd: number;
  loopCount: number;
  detune: number; // semitones
  input?: WaveInput;
}

// Samples as the resampler reads them: 4 leading zeros, the decoded wave, and 4 samples past the
// loop end (or zeros), so a read never needs bounds checks.
interface WaveInput {
  buf: Int16Array;
  loopEnd: number; // input index where the loop wraps (Infinity: no loop)
  loopLen: number;
  end: number; // input index past the last sample
}

// Pointer bank at `bank` for the sample file ("N64 WaveTables") at `samples`. Wave offsets count
// from the start of the sample file (its 16-byte header included).
export function parseLibmusBank(rom: Uint8Array, bank: number, samples: number): Wave[] {
  const dv = view(rom);
  if (String.fromCharCode(...rom.subarray(bank, bank + 15)) !== 'N64 PtrTablesV2') throw new Error('Music bank not found');
  const count = dv.getUint32(bank + 0x20);
  const basenote = bank + dv.getUint32(bank + 0x24);
  const detune = bank + dv.getUint32(bank + 0x28);
  const list = bank + dv.getUint32(bank + 0x2c);
  const waves: Wave[] = [];
  for (let i = 0; i < count; i++) {
    const w = bank + dv.getUint32(list + i * 4);
    const loop = dv.getUint32(w + 12), book = dv.getUint32(w + 16), type = rom[w + 8];
    const wave: Wave = {
      base: samples + dv.getUint32(w), len: dv.getUint32(w + 4), type, book: null, loopStart: 0, loopEnd: 0, loopCount: 0,
      // (MusPtrBankInitialize leaves bases whose top byte is 0xFF unrelocated; no music bank has one.)
      // MusPtrBankInitialize: (s8)(basenote - 48) semitones + (s8)detune / 100.
      detune: s8(rom[detune + i * 4]) / 100 + s8(rom[basenote + i] - 48),
    };
    if (type === 0 && book) {
      const k = bank + book;
      const n = dv.getInt32(k) * dv.getInt32(k + 4) * 8;
      wave.book = Int16Array.from({ length: n }, (_, j) => dv.getInt16(k + 8 + j * 2));
    }
    if (loop) {
      wave.loopStart = dv.getUint32(bank + loop);
      wave.loopEnd = dv.getUint32(bank + loop + 4);
      wave.loopCount = dv.getUint32(bank + loop + 8);
    }
    waves.push(wave);
  }
  return waves;
}

function waveInput(rom: Uint8Array, w: Wave): WaveInput {
  if (w.input) return w.input;
  let pcm: Int16Array;
  if (w.type === 1) {
    pcm = new Int16Array(w.len >> 1);
    const dv = view(rom);
    for (let i = 0; i < pcm.length; i++) pcm[i] = dv.getInt16(w.base + i * 2);
  } else {
    const frames = Math.floor(w.len / 9);
    pcm = new Int16Array(frames * 16);
    if (w.book) decodeVadpcm(rom, w.base, frames, w.book, new Int16Array(16), pcm, 0);
  }
  // The voice decodes linearly and wraps [loopStart, loopEnd).
  const looped = w.loopCount !== 0 && w.loopEnd > w.loopStart;
  const loopEnd = looped ? Math.min(w.loopEnd, pcm.length) : pcm.length;
  const buf = new Int16Array(4 + loopEnd + 8);
  buf.set(pcm.subarray(0, loopEnd), 4);
  if (looped && loopEnd > w.loopStart) {
    for (let k = 0; k < 8; k++) buf[4 + loopEnd + k] = pcm[w.loopStart + (k % (loopEnd - w.loopStart))];
  }
  w.input = looped && loopEnd > w.loopStart
    ? { buf, loopEnd: 4 + loopEnd, loopLen: loopEnd - w.loopStart, end: Infinity }
    : { buf, loopEnd: Infinity, loopLen: 0, end: 4 + loopEnd };
  return w.input;
}

interface Song {
  data: Uint8Array;
  numChannels: number;
  channelData: number[];
  volumeData: number[];
  bendData: number[];
  envelopeTable: number;
  drumTable: number;
  waveMap: number[];
  masterTrack: number;
}

function parseSong(data: Uint8Array): Song {
  const dv = view(data);
  const n = dv.getInt32(4);
  const waves = dv.getInt32(8);
  const table = (at: number) => {
    const t = dv.getUint32(at);
    return Array.from({ length: n }, (_, i) => (t ? dv.getUint32(t + i * 4) : 0));
  };
  const waveTable = dv.getUint32(0x20);
  return {
    data, numChannels: n, channelData: table(0x0c), volumeData: table(0x10), bendData: table(0x14),
    envelopeTable: dv.getUint32(0x18), drumTable: dv.getUint32(0x1c),
    waveMap: Array.from({ length: waves }, (_, i) => dv.getUint16(waveTable + i * 2)), masterTrack: dv.getUint32(0x24),
  };
}

// ------------------------------------------------------------------ synthesizer voice

class Voice {
  input: WaveInput | null = null;
  pos = 0;
  accu = 0;
  pitch = 0x8000; // Q1.15
  playing = false;
  volume = 0;
  pan = 0;
  dry = 32767;
  wet = 0;
  // Linear envmixer ramps per side (libultra _getRate), in 1/65536 units.
  lValue = 65536; lTarget = 65536; lStep = 0;
  rValue = 65536; rTarget = 65536; rStep = 0;

  start(input: WaveInput) {
    this.input = input;
    this.pos = 0;
    this.accu = 0;
    this.playing = true;
  }

  setPitch(ratio: number) {
    if (ratio > 1.99996) ratio = 1.99996;
    this.pitch = Math.trunc(ratio * 0x8000) & 0xffff;
  }

  retarget(count: number) {
    const tl = (this.volume * EQPOWER_TABLE[this.pan]) >> 15;
    const tr = (this.volume * EQPOWER_TABLE[127 - this.pan]) >> 15;
    [this.lTarget, this.lStep, this.lValue] = ramp(this.lValue, tl, count);
    [this.rTarget, this.rStep, this.rValue] = ramp(this.rValue, tr, count);
  }

  render(n: number, dl: Float64Array, dr: Float64Array, wl: Float64Array, wr: Float64Array) {
    if (!this.playing || !this.input) {
      // Ramps still advance while the voice is silent.
      this.lValue = advance(this.lValue, this.lTarget, this.lStep, n);
      if (this.lValue === this.lTarget) this.lStep = 0;
      this.rValue = advance(this.rValue, this.rTarget, this.rStep, n);
      if (this.rValue === this.rTarget) this.rStep = 0;
      return;
    }
    const { buf, loopEnd, loopLen, end } = this.input;
    const lut = RESAMPLE_LUT;
    const step = this.pitch << 1;
    const dry = this.dry, wet = this.wet;
    let pos = this.pos, accu = this.accu;
    let lv = this.lValue, ls = this.lStep;
    let rv = this.rValue, rs = this.rStep;
    const lt = this.lTarget, rt = this.rTarget;
    for (let k = 0; k < n; k++) {
      if (ls !== 0) {
        lv += ls;
        if (ls < 0 ? lv <= lt : lv >= lt) {
          lv = lt;
          ls = 0;
        }
      }
      if (rs !== 0) {
        rv += rs;
        if (rs < 0 ? rv <= rt : rv >= rt) {
          rv = rt;
          rs = 0;
        }
      }
      let s = 0;
      if (pos < end) {
        const li = (accu & 0xfc00) >> 8;
        s = (buf[pos] * lut[li] + buf[pos + 1] * lut[li + 1] + buf[pos + 2] * lut[li + 2] + buf[pos + 3] * lut[li + 3]) >> 15;
        if (s > 32767) s = 32767;
        else if (s < -32768) s = -32768;
      }
      accu += step;
      pos += accu >> 16;
      accu &= 0xffff;
      if (pos >= loopEnd) pos -= loopLen;
      if (s === 0) continue;
      const l = Math.trunc(lv / 65536), r = Math.trunc(rv / 65536);
      dl[k] = clamp16(dl[k] + ((s * clamp16((l * dry + 0x4000) >> 15)) >> 15));
      dr[k] = clamp16(dr[k] + ((s * clamp16((r * dry + 0x4000) >> 15)) >> 15));
      if (wet) {
        wl[k] = clamp16(wl[k] + ((s * clamp16((l * wet + 0x4000) >> 15)) >> 15));
        wr[k] = clamp16(wr[k] + ((s * clamp16((r * wet + 0x4000) >> 15)) >> 15));
      }
    }
    this.pos = pos;
    this.accu = accu;
    this.lValue = lv;
    this.lStep = ls;
    this.rValue = rv;
    this.rStep = rs;
  }
}

function ramp(value: number, target: number, count: number): [number, number, number] {
  let cur = value / 65536;
  if (cur <= 0) cur = 1;
  const t = target < 1 ? 1 : target;
  const tgt = t * 65536;
  if (count <= 0) return [tgt, 0, tgt];
  const step = ((t - cur) / count) * 65536;
  return step === 0 ? [tgt, 0, tgt] : [tgt, step, value];
}

function advance(value: number, target: number, step: number, n: number): number {
  if (step === 0) return value;
  const v = value + step * n;
  return (step < 0 ? v <= target : v >= target) ? target : v;
}

// libultra BIGROOM reverb (alFxPull), per sample.
class Reverb {
  private readonly line = new Int32Array(4000);
  private now = 0;
  private lp = 0;
  private static readonly SECTIONS = [
    { input: 0, output: 2640, fb: 9830, ff: -9830, gain: 0, lp: 0 },
    { input: 880, output: 2160, fb: 3276, ff: -3276, gain: 16383, lp: 0 },
    { input: 2640, output: 3640, fb: 3276, ff: -3276, gain: 16383, lp: 0 },
    { input: 0, output: 3760, fb: 8000, ff: 0, gain: 0, lp: 0x5000 },
  ];

  process(inL: number, inR: number): number {
    const L = this.line, n = 4000;
    const mix = (d: number, s: number, g: number) => clamp16(d + ((s * g) >> 15));
    let input = inL;
    input = mix(input, inL, s16(0xda83));
    input = mix(input, inR, 0x5a82);
    L[this.now] = input;
    let output = 0;
    for (const d of Reverb.SECTIONS) {
      const ip = (this.now - d.input + n) % n, op = (this.now - d.output + n) % n;
      let b1 = L[ip], b2 = L[op];
      if (d.ff) b2 = mix(b2, b1, d.ff);
      if (d.fb) {
        b1 = mix(b1, b2, d.fb);
        L[ip] = b1;
      }
      if (d.lp) {
        const fc = (d.lp * 16384) >> 15, g = 16384 - fc;
        this.lp = clamp16((b2 * g + this.lp * fc) >> 14);
        b2 = this.lp;
      }
      L[op] = b2;
      if (d.gain) output = mix(output, b2, d.gain);
    }
    this.now = (this.now + 1) % n;
    return output;
  }
}

// ------------------------------------------------------------------ libmus player

interface LoopFrame { count: number; ptr: number; volPtr: number; bendPtr: number; volume: number; bendRaw: number; volCount: number; bendCount: number }

class Channel {
  pdata = 0; pending: Wave | null = null; time = 0; volTime = 0; bendTime = 0;
  vibDepth = 0; bend = 0; lastPitch = f32(99.9); noteBase = 0; distort = 0; bendPtr = 0; volPtr = 0;
  nextNote = 0; noteStart = 0; portFrom = 0; portCur = 0; releaseTime = 0;
  attackStep = 1; decayStep = f32(1 / 255); releaseStep = f32(1 / 15); envRecip = 1024;
  bendScale = 0.03125; bendRaw = 0;
  drums = 0; chanStart = 0; bendStart = 0; volStart = 0;
  distortRaw = 0; sweepTime = 0; tempoScale = 128; noteLen = 1; tempoInc = 0; chanVol = 128; lastVol = 0xffff;
  volCount = 1; bendCount = 1; noteTicks = 0; fixedLen = 0; waveNum = 0; panScale = 128;
  releaseFixed = 0; cutoff = 0; vibDelay = 0; ignoreLen = 0; portTime = 0; transpose = 0; ignoreTrans = 0;
  velocity = 0; volume = 127; pan = 64; lastPan = 255; envSpeed = 1; envInit = 0; envPeak = 127; envSustain = 127;
  envStage = 0; envVol = 0; envCount = 0; attackT = 1; decayT = 255; releaseT = 15; voiceOn = false; reverb = 0;
  lastReverb = 255; releaseVol = 0; wobOn = 0; wobOff = 0; wobCount = 0; wobCur = 0; velOn = true;
  defVel = 127; sweepSpeed = 0; vibSpeed = 0; vibRate = 0; envOff = false; tie = false; wobAmt = 0; sweepAcc = 0; sweepDir = 0;
  sp = 0;
  stack: LoopFrame[] = Array.from({ length: 4 }, () => ({ count: 0, ptr: 0, volPtr: 0, bendPtr: 0, volume: 0, bendRaw: 0, volCount: 0, bendCount: 0 }));
  loopStart = -1; // time of the first `for 255`
  loopLen = -1; // time from there to the matching `next`
  gotos = 0;
  readonly voice = new Voice();
}

class Player {
  readonly channels: Channel[] = [];
  private rng = 0x12345678;

  constructor(private readonly rom: Uint8Array, private readonly waves: Wave[], private readonly song: Song, private readonly masterVolume: number) {
    const make = (pdata: number, vol: number, bend: number) => {
      const c = new Channel();
      c.tempoInc = Math.trunc(24576 / FPS);
      c.chanStart = c.pdata = pdata;
      c.volStart = c.volPtr = vol;
      c.bendStart = c.bendPtr = bend;
      this.channels.push(c);
    };
    make(song.masterTrack, 0, 0);
    for (let i = 0; i < song.numChannels; i++) {
      if (song.channelData[i]) make(song.channelData[i], song.volumeData[i], song.bendData[i]);
    }
  }

  private get d() { return this.song.data; }

  private synVol(c: Channel, vol: number) {
    const s = s16(vol);
    c.voice.volume = (s * s) >> 15;
    c.voice.retarget(TICK_SAMPLES);
  }

  private synPan(c: Channel, pan: number) {
    c.voice.pan = pan & 0x7f;
    c.voice.retarget(TICK_SAMPLES);
  }

  private rand(n: number): number {
    for (let i = 0; i < 8; i++) {
      const v = this.rng >>> 0;
      let nv = (v << 1) >>> 0;
      if ((v & 0x48000000) === 0x48000000 || (v & 0x48000000) === 0x08000000) nv = (nv | 1) >>> 0;
      this.rng = nv;
    }
    return Math.trunc(f32(n) * f32(f32(this.rng | 0) / 65536 / 65536));
  }

  tick() {
    for (const c of this.channels) {
      if (!c.pdata) continue;
      if (c.pending) this.startVoice(c);
      c.time = (c.time + c.tempoInc) | 0;
      if (c.noteLen !== 32767 && c.nextNote - c.time < 0) {
        while (c.nextNote - c.time < 0 && c.pdata) this.fetch(c);
        if (!c.pdata) continue;
      }
      if (c.volPtr && c.volTime - c.time < 0) this.volumeStream(c);
      if (c.bendPtr && c.bendTime - c.time < 0) this.bendStream(c);
      if (c.voiceOn) {
        if (c.envStage) this.envelope(c);
        if (c.sweepSpeed && c.sweepTime - c.time < 0) this.sweep(c);
        let off = c.distort;
        if (c.vibSpeed) off = f32(off + this.vibrato(c));
        if (c.wobOn) off = f32(off + this.wobble(c));
        if (!c.pending) {
          this.pitch(c, off);
          this.volumePan(c);
        }
      }
      c.noteTicks = u16((c.time - c.noteStart) >>> 8);
    }
  }

  private startVoice(c: Channel) {
    c.voiceOn = true;
    c.voice.start(waveInput(this.rom, c.pending!));
    c.pending = null;
  }

  private readLen(c: Channel): number {
    const b = this.d[c.pdata++];
    return b < 0x80 ? b : ((b & 0x7f) << 8) + this.d[c.pdata++];
  }

  private fetch(c: Channel) {
    const d = this.d;
    for (;;) {
      if (!c.pdata) return this.endOfData(c);
      const cmd = d[c.pdata];
      if (cmd < 0x80) break;
      c.pdata = this.command(c, cmd, c.pdata + 1);
      if (!c.pdata) return this.endOfData(c);
    }
    c.portFrom = c.portCur;
    let note = d[c.pdata++];
    if (c.velOn) {
      const v = d[c.pdata++];
      c.velocity = v;
      if (v >= 0x80) {
        c.velocity = v & 0x7f;
        c.velOn = false;
        c.defVel = c.velocity;
      }
    } else {
      c.velocity = c.defVel;
    }
    if (c.fixedLen) {
      if (c.ignoreLen) {
        c.ignoreLen = 0;
        c.noteLen = this.readLen(c);
      } else {
        c.noteLen = c.fixedLen;
      }
    } else {
      c.noteLen = this.readLen(c);
    }
    c.noteStart = c.nextNote;
    c.noteTicks = 0;
    c.wobCur = 0;
    c.wobCount = c.wobOff;
    c.nextNote = (c.nextNote + (c.noteLen << 8)) | 0;
    if (!c.drums && this.song.waveMap[c.waveNum] === 0xffff) note = 96;
    if (note === 96) {
      if (c.envStage < 4) {
        c.envStage = 4;
        c.envCount = 1;
        c.releaseTime = c.time;
        c.releaseVol = c.envVol;
      }
      return;
    }
    if (c.drums) {
      const p = c.drums + note * 6;
      c.waveNum = (d[p] << 8) | d[p + 1];
      c.pan = d[p + 4] >> 1;
      this.loadEnvelope(c, this.song.envelopeTable + ((d[p + 2] << 8) | d[p + 3]) * 7);
      note = d[p + 5];
    }
    if (!c.envOff) this.envelopeStart(c);
    if (c.sweepSpeed) {
      c.sweepTime = c.noteStart;
      c.sweepAcc = 0;
      c.sweepDir = c.pan & 0x40;
    }
    const w = this.waves[this.song.waveMap[c.waveNum]];
    if (!w) return;
    if (!c.tie) {
      c.pending = w;
      if (c.voiceOn && c.lastVol !== 0) {
        c.lastVol = 0;
        this.synVol(c, 0);
      } else {
        this.startVoice(c);
      }
    }
    c.noteBase = f32(f32(note + w.detune) + s8(c.transpose * (1 - c.ignoreTrans)));
    if (c.reverb !== c.lastReverb) {
      c.lastReverb = c.reverb;
      const mix = u8((128 * c.reverb) >> 7) & 0x7f;
      c.voice.dry = EQPOWER_TABLE[mix];
      c.voice.wet = EQPOWER_TABLE[127 - mix];
    }
  }

  private endOfData(c: Channel) {
    c.pdata = 0;
    if (c.voiceOn) {
      c.voiceOn = false;
      this.synVol(c, 0);
      c.voice.playing = false;
    }
  }

  private loadEnvelope(c: Channel, p: number) {
    const d = this.d;
    const speed = d[p] || 1;
    c.envSpeed = speed;
    c.envRecip = Math.trunc(1024 / speed);
    c.envInit = d[p + 1];
    c.attackT = d[p + 2];
    c.envPeak = d[p + 3];
    c.attackStep = f32((1 / c.attackT) * (c.envPeak - c.envInit));
    c.decayT = d[p + 4];
    c.envSustain = d[p + 5];
    c.decayStep = f32((1 / c.decayT) * (c.envSustain - c.envPeak));
    c.releaseT = d[p + 6];
    c.releaseStep = f32(1 / c.releaseT);
  }

  private envelopeStart(c: Channel) {
    if (c.noteLen !== 32767) {
      c.releaseTime = c.releaseFixed ? (c.noteStart + (c.releaseFixed << 8)) | 0 : (c.nextNote - (c.cutoff << 8)) | 0;
    } else {
      c.releaseTime = (c.noteStart + 0x7fffffff) | 0;
    }
    c.envStage = 1;
    c.envVol = c.envInit;
    c.envCount = c.envSpeed;
  }

  private envelope(c: Channel) {
    if (c.releaseTime - c.time < 0 && c.envStage < 4) {
      c.envStage = 4;
      c.envCount = 1;
      c.releaseVol = c.envVol;
    }
    c.envCount = u8(c.envCount - 1);
    if (c.envCount) return;
    c.envCount = c.envSpeed;
    const scaled = (ticks: number) => Number((BigInt(ticks >>> 0) * BigInt(c.envRecip >>> 0)) & 0xffffffffn) >>> 10;
    if (c.envStage === 1) {
      const t = scaled((c.time - c.noteStart) >>> 8);
      if ((t | 0) < c.attackT) c.envVol = u8(c.envInit + Math.trunc(f32(c.attackStep * t)));
      else {
        c.envStage = 2;
        c.envVol = c.envPeak;
      }
    } else if (c.envStage === 2) {
      const t = scaled((((c.time - c.noteStart) >>> 8) - c.attackT) >>> 0);
      if ((t | 0) < c.decayT) c.envVol = u8(c.envPeak + Math.trunc(f32(c.decayStep * t)));
      else {
        c.envStage = 3;
        c.envVol = c.envSustain;
      }
    } else if (c.envStage === 4) {
      const t = scaled((c.time - c.releaseTime) >>> 8);
      if ((t | 0) < c.releaseT) c.envVol = u8(c.releaseVol - Math.trunc(f32(f32(c.releaseStep * t) * c.releaseVol)));
      else {
        c.envStage = 5;
        c.envVol = 0;
      }
    }
  }

  private sweep(c: Channel) {
    do {
      c.sweepTime = (c.sweepTime + 256) | 0;
      const a = c.sweepAcc + c.sweepSpeed;
      if (a < 64) {
        c.sweepAcc = a;
      } else {
        c.sweepAcc = a & 0x3f;
        const st = a >> 6;
        if (!c.sweepDir) {
          c.pan = u8(c.pan + st);
          if (c.pan >= 128) {
            c.pan = 127;
            c.sweepDir = 1;
          }
        } else {
          c.pan = u8(c.pan - st);
          if (c.pan >= 128 || c.pan === 0) {
            c.pan = 0;
            c.sweepDir = 0;
          }
        }
      }
    } while (c.sweepTime - c.time < 0);
  }

  private vibrato(c: Channel): number {
    const dt = c.noteTicks - c.vibDelay;
    if (dt <= 0) return 0;
    return f32(f32(Math.sin(f32(dt * c.vibRate))) * c.vibDepth);
  }

  private wobble(c: Channel): number {
    c.wobCount = u8(c.wobCount - 1);
    if (!c.wobCount) {
      if (!c.wobCur) {
        c.wobCur = c.wobAmt;
        c.wobCount = c.wobOn;
      } else {
        c.wobCur = 0;
        c.wobCount = c.wobOff;
      }
    }
    return s8(c.wobCur);
  }

  private pitch(c: Channel, off: number) {
    let p = c.noteBase;
    if (c.portTime) {
      if (c.portTime < c.noteTicks) {
        c.portCur = p;
      } else {
        p = f32(c.portFrom + f32(f32((p - c.portFrom) / c.portTime) * c.noteTicks));
        c.portCur = p;
      }
    }
    p = f32(p + f32(off + c.bend));
    if (p === c.lastPitch) return;
    c.lastPitch = p;
    let ratio = musPow2(f32(p * 0.08333333333333333));
    if (ratio > 2) {
      ratio = 2;
      c.velocity = 0;
    }
    c.voice.setPitch(ratio);
  }

  private volumePan(c: Channel) {
    let v = Number((BigInt(c.volume * c.envVol * c.velocity) * BigInt(s16(c.chanVol))) & 0xffffffffn) >>> 13;
    if (v > 32767) v = 32767;
    v = (v * this.masterVolume) >>> 15;
    if (v !== c.lastVol) {
      c.lastVol = v;
      this.synVol(c, v);
    }
    const p = ((c.pan * s16(c.panScale)) >> 7) & 0x7f;
    if (p !== c.lastPan) {
      c.lastPan = p;
      this.synPan(c, p);
    }
  }

  private volumeStream(c: Channel) {
    const d = this.d;
    do {
      c.volCount = u16(c.volCount - 1);
      c.volTime = (c.volTime + 256) | 0;
      if (!c.volCount) {
        const b = d[c.volPtr++];
        if (b < 0x80) {
          c.volume = b;
          c.volCount = 1;
        } else {
          c.volume = b & 0x7f;
          const b2 = d[c.volPtr++];
          c.volCount = u16(b2 < 0x80 ? b2 + 2 : ((b2 & 0x7f) << 8) + d[c.volPtr++] + 2);
        }
      }
    } while (c.volTime - c.time < 0);
  }

  private bendStream(c: Channel) {
    const d = this.d;
    do {
      c.bendCount = u16(c.bendCount - 1);
      c.bendTime = (c.bendTime + 256) | 0;
      if (!c.bendCount) {
        const b = d[c.bendPtr++];
        if (b >= 0x80) {
          c.bendRaw = (b & 0x7f) - 64;
          const b2 = d[c.bendPtr++];
          c.bendCount = u16(b2 < 0x80 ? b2 + 2 : ((b2 & 0x7f) << 8) + d[c.bendPtr++] + 2);
        } else {
          c.bendRaw = b - 64;
          c.bendCount = 1;
        }
        c.bend = f32(c.bendRaw * c.bendScale);
      }
    } while (c.bendTime - c.time < 0);
  }

  private command(c: Channel, cmd: number, p: number): number {
    const d = this.d;
    const vread = () => {
      let v = d[p++];
      if (v & 0x80) v = ((v & 0x7f) << 8) | d[p++];
      return v;
    };
    switch (cmd) {
      case 0x80: // stop
        c.volPtr = 0;
        c.bendPtr = 0;
        c.pending = null;
        return 0;
      case 0x81: c.waveNum = vread(); return p;
      case 0x82: {
        const t = d[p++];
        c.portTime = t;
        if (t) c.portCur = c.noteBase;
        return p;
      }
      case 0x83: c.portTime = 0; return p;
      case 0x84: this.loadEnvelope(c, p); return p + 7;
      case 0x85: { // tempo, for every channel of the song
        const inc = Math.trunc(Math.trunc(((d[p++] * 3) << 13) / 120) / FPS);
        for (const o of this.channels) o.tempoInc = u16((inc * s16(c.tempoScale)) >> 7);
        return p;
      }
      case 0x86: c.releaseFixed = (d[p] << 8) | d[p + 1]; c.cutoff = 0; return p + 2;
      case 0x87: c.cutoff = d[p]; c.releaseFixed = 0; return p + 1;
      case 0x88:
      case 0x89:
        c.vibDelay = d[p];
        c.vibSpeed = d[p + 1];
        c.vibDepth = f32(((cmd === 0x89 ? -1 : 1) * d[p + 2]) / 50);
        c.vibRate = f32(6.2831852 / c.vibSpeed);
        return p + 3;
      case 0x8a: c.vibSpeed = 0; return p;
      case 0x8b: c.fixedLen = vread(); return p;
      case 0x8c: c.ignoreLen = 1; return p;
      case 0x8d: c.transpose = d[p]; return p + 1;
      case 0x8e: c.ignoreTrans = 1; return p;
      case 0x8f: {
        const v = f32(s8(d[p]) / 100);
        c.distort = f32(f32(c.distort - c.distortRaw) + v);
        c.distortRaw = v;
        return p + 1;
      }
      case 0x90: this.loadEnvelope(c, this.song.envelopeTable + vread() * 7); return p;
      case 0x91: c.envOff = true; return p;
      case 0x92: c.envOff = false; return p;
      case 0x93: c.tie = true; return p;
      case 0x94: c.tie = false; return p;
      case 0x95: { // for
        const e = c.stack[c.sp];
        e.count = d[p++];
        e.ptr = p;
        e.volPtr = c.volPtr;
        e.bendPtr = c.bendPtr;
        e.volume = c.volume;
        e.bendRaw = c.bendRaw;
        e.volCount = c.volCount;
        e.bendCount = c.bendCount;
        c.sp++;
        if (e.count === 255 && c.loopStart < 0) c.loopStart = c.nextNote;
        return p;
      }
      case 0x96: { // next
        const e = c.stack[c.sp - 1];
        if (e.count !== 255) {
          e.count = u8(e.count - 1);
          if (!e.count) {
            c.sp--;
            return p;
          }
        } else if (c.loopLen < 0) {
          c.loopLen = c.nextNote - c.loopStart;
        }
        c.volPtr = e.volPtr;
        c.bendPtr = e.bendPtr;
        c.volume = e.volume;
        c.bendRaw = e.bendRaw;
        c.bend = f32(e.bendRaw * c.bendScale);
        c.volCount = e.volCount;
        c.bendCount = e.bendCount;
        return e.ptr;
      }
      case 0x97: c.wobAmt = d[p]; c.wobOn = d[p + 1]; c.wobOff = d[p + 2]; return p + 3;
      case 0x98: c.wobOn = 0; return p;
      case 0x99: c.velOn = true; return p;
      case 0x9a: c.velOn = false; return p;
      case 0x9b: c.velOn = false; c.defVel = d[p]; return p + 1;
      case 0x9c: c.pan = d[p] >> 1; return p + 1;
      case 0x9d: return p + 2;
      case 0x9e: c.drums = this.song.drumTable + vread() * 6; return p;
      case 0x9f: c.drums = 0; return p;
      case 0xa0: return p + 1;
      case 0xa1: { // goto
        c.gotos++;
        const ch = (d[p] << 8) | d[p + 1], vo = (d[p + 2] << 8) | d[p + 3], bo = (d[p + 4] << 8) | d[p + 5];
        c.volPtr = c.volStart + vo;
        c.volCount = 1;
        c.bendPtr = c.bendStart + bo;
        c.bendCount = 1;
        return c.chanStart + ch;
      }
      case 0xa2: c.reverb = d[p]; return p + 1;
      case 0xa3: c.transpose = u8(this.rand(d[p]) + d[p + 1]); return p + 2;
      case 0xa4: c.volume = u8(this.rand(d[p]) + d[p + 1]); return p + 2;
      case 0xa5: c.pan = u8(this.rand(d[p]) + d[p + 1]); return p + 2;
      case 0xa6: c.volume = d[p]; return p + 1;
      case 0xa7: vread(); return p; // sound effects are not rendered
      case 0xa8: c.bendScale = f32(d[p] * 0.015625); c.bend = f32(c.bendRaw * c.bendScale); return p + 1;
      case 0xa9: c.sweepSpeed = d[p]; return p + 1;
      case 0xaa: return p + 1;
      case 0xab: {
        p++;
        const b = d[p++];
        if (b & 0x80) p++;
        return p;
      }
      case 0xac: c.fixedLen = 0; return p;
      default:
        return 0;
    }
  }
}

function fileRange(rom: Uint8Array, index: number): [number, number] {
  const dv = view(rom);
  return [dv.getUint32(FILE_TABLE + index * 8) - 0xb0000000, dv.getUint32(FILE_TABLE + index * 8 + 4)];
}

const bankCache = new WeakMap<Uint8Array, Wave[]>();

export function listGaMusic(): MusicTrack[] {
  return SONG_NAMES.map((name, index) => ({ index, name: `${String(index).padStart(2, '0')} ${name}` }));
}

export function decodeGaMusic(rom: Uint8Array, index: number): DecodedMusic {
  if (index < 0 || index >= SONG_NAMES.length) throw new Error(`No music track ${index}`);
  let waves = bankCache.get(rom);
  if (!waves) {
    waves = parseLibmusBank(rom, fileRange(rom, BANK_FILE)[0], fileRange(rom, SAMPLE_FILE)[0]);
    bankCache.set(rom, waves);
  }
  const [start, len] = fileRange(rom, FIRST_SONG_FILE + index);
  // Global Assault: song master volume 12603 (MusSetMasterVolume at boot), BIGROOM reverb.
  return renderLibmusSong(rom, waves, rom.slice(start, start + len), { masterVolume: SONG_MASTER_VOLUME, reverb: true });
}

export interface LibmusOptions {
  masterVolume: number; // song master volume, 0..0x7FFF
  reverb: boolean; // mix the effect sends through libultra's BIGROOM reverb
  // Exact loop bounds in output samples. Omit to derive them from the song's
  // bytecode; callers with independently verified bounds can bypass that
  // bounded probe for unusually long control-flow streams.
  loopSamples?: readonly [start: number, end: number];
}

// Renders a libmus song (version 0x215) to PCM at 22047 Hz, with its loop region.
export function renderLibmusSong(rom: Uint8Array, waves: Wave[], songData: Uint8Array, opts: LibmusOptions): DecodedMusic {
  const song = parseSong(songData);

  let loopStart: number | undefined;
  let loopEnd: number | undefined;
  let total: number;
  if (opts.loopSamples) {
    [loopStart, loopEnd] = opts.loopSamples;
    if (!Number.isSafeInteger(loopStart) || !Number.isSafeInteger(loopEnd) || loopStart < 0 || loopEnd <= loopStart)
      throw new Error(`Invalid libmus output-sample loop ${loopStart}..${loopEnd}`);
    total = Math.ceil(loopEnd / TICK_SAMPLES) + TAIL_TICKS;
  } else {
    // Dry run without mixing: every looping channel wraps its bytecode in `for 255 ... next`, all with
    // the same length; the loop region is known once each has reached its `next`.
    const probe = new Player(rom, waves, song, opts.masterVolume);
    let ticks = 0;
    for (; ticks < FPS * 60 * 15; ticks++) {
      probe.tick();
      const live = probe.channels.filter((c) => c.pdata);
      if (!live.length || live.every((c) => c.loopLen >= 0 || c.gotos > 0)) break;
    }
    const live = probe.channels.filter((c) => c.pdata);
    const inc = probe.channels[0].tempoInc;
    total = ticks + TAIL_TICKS;
    if (live.length && live.every((c) => c.loopLen >= 0) && inc > 0) {
      const startTicks = Math.max(...live.map((c) => c.loopStart)) / inc;
      // Notes start on whole ticks, so the output repeats after a whole number of ticks (Gex 3's title
      // song loops every 1130 ticks in game audio; the exact 1129.93 drifts 25 samples per pass).
      const lenTicks = Math.round(Math.max(...live.map((c) => c.loopLen)) / inc);
      loopStart = Math.round(startTicks * TICK_SAMPLES);
      loopEnd = Math.round((startTicks + lenTicks) * TICK_SAMPLES);
      total = Math.ceil(startTicks + lenTicks) + TAIL_TICKS;
    }
  }

  const player = new Player(rom, waves, song, opts.masterVolume);
  const n = total * TICK_SAMPLES;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const dl = new Float64Array(TICK_SAMPLES), dr = new Float64Array(TICK_SAMPLES);
  const wl = new Float64Array(TICK_SAMPLES), wr = new Float64Array(TICK_SAMPLES);
  const reverb = new Reverb();
  for (let t = 0; t < total; t++) {
    player.tick();
    dl.fill(0);
    dr.fill(0);
    wl.fill(0);
    wr.fill(0);
    for (const c of player.channels) c.voice.render(TICK_SAMPLES, dl, dr, wl, wr);
    const o = t * TICK_SAMPLES;
    for (let k = 0; k < TICK_SAMPLES; k++) {
      const y = opts.reverb ? reverb.process(wl[k], wr[k]) : 0;
      left[o + k] = clamp16(dl[k] + ((y * 0x7fff) >> 15)) / 32768;
      right[o + k] = clamp16(dr[k] + ((y * 0x7fff) >> 15)) / 32768;
    }
  }
  if (loopStart === undefined || loopEnd === undefined) {
    return { sampleRate: OUTPUT_RATE, channels: [left, right] };
  }
  // On repeats, the start of the loop sounds like the render past the loop end (the next pass plus what
  // still rings from the previous one), so that continuation replaces the start of the region.
  const end = Math.min(n, loopEnd);
  const outL = left.slice(0, end), outR = right.slice(0, end);
  for (let k = end; k < n && loopStart + (k - end) < end; k++) {
    outL[loopStart + (k - end)] = left[k];
    outR[loopStart + (k - end)] = right[k];
  }
  return { sampleRate: OUTPUT_RATE, channels: [outL, outR], loopStart, loopEnd };
}
