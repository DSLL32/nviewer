// Gex 64: Enter the Gecko (USA): the soundtrack, rendered offline by emulating the game's music
// player, an older revision of Software Creations' libmus (0x120-byte channel struct, commands
// 0x80..0xA9, jump table 0x80079470), on libultra's synthesizer at 22050 Hz with 24 voices.
// The player runs once per video frame (367 output samples).
//
// Each level has a pointer bank ("N64 PtrTablesV2") + wave bank ("N64 WaveTables") pair and one or
// more DEFLATE songs, listed in the level audio table 0x8006F5A8 (31 x 36 bytes: +0x00 volume, +0x0C
// wave bank, +0x10 pointer bank, +0x18/+0x1C song ROM range, or pointers to lists {u32 start, u32
// volume} / u32 end[] when bit 31 is set). Four jingles are stored uncompressed (table 0x8006FA0C).
// Song: u32 channel count, then offsets of the channel, volume and pitch-bend stream lists, the
// envelope table and the drum list. Every looping channel wraps its stream in `95 FF ... 96`.
import { inflateRaw } from '../inflate';
import type { DecodedMusic, MusicTrack } from '../types';
import { view } from '../util';
import { type PreparedWave, prepareWave, RESAMPLE_LUT, type Wave } from './libultra';

const MAX_RATIO = 1.99996;
const LEVEL_AUDIO = 0x701a8;
const JINGLES = 0x7060c;
const EXTRAS_BANK = 0x4973a0;
const EXTRAS_SAMPLES = 0x4958f0;
const LEVEL_COUNT = 31;
// The game plays music at about -33 dBFS (renders match captured game audio within 1 dB). Tracks are
// boosted for playback next to the other games; the loudest track still peaks below full scale.
const GEX_PROFILE: Libmus64Profile = {
  outputRate: 22050,
  tickSamples: 367,
  vsyncs: 60,
  eqpowerRom: 0x7a400,
  maxVoices: 24,
  masterSongVolume: 0x3fff,
  playbackGain: 2.25,
};

// Declarative differences between games using Software Creations' older libmus player.
// `tickSamples` preserves an observed fixed audio update size (as in Gex). When omitted,
// updates divide outputRate evenly across vsyncs without cumulative rounding drift.
export interface Libmus64Profile {
  outputRate: number;
  tickSamples?: number;
  vsyncs: number;
  eqpowerRom: number;
  maxVoices: number;
  masterSongVolume: number;
  playbackGain: number;
}

export interface Libmus64SongDef {
  start: number;
  end: number;
  compressed: boolean;
  bank: number;
  samples: number;
  volume: number;
}

const f32 = Math.fround;
const s8 = (x: number) => (x << 24) >> 24;
const toRom = (vaddr: number) => vaddr - 0x7ffff400;

interface Bank {
  waves: Wave[];
  pitch: number[]; // semitones added to the note: (s8)(basenote - 48) + (s8)detune / 100
}

function parseBank(rom: Uint8Array, bank: number, samples: number): Bank {
  const dv = view(rom);
  if (String.fromCharCode(...rom.subarray(bank, bank + 15)) !== 'N64 PtrTablesV2') throw new Error('Music bank not found');
  const count = dv.getUint32(bank + 0x20);
  const basenote = bank + dv.getUint32(bank + 0x24);
  const detune = bank + dv.getUint32(bank + 0x28);
  const list = bank + dv.getUint32(bank + 0x2c);
  const waves: Wave[] = [];
  const pitch: number[] = [];
  for (let i = 0; i < count; i++) {
    const w = bank + dv.getUint32(list + i * 4);
    let base = dv.getUint32(w);
    if ((base & 0xff000000) >>> 0 !== 0xff000000) base += samples;
    const loop = dv.getUint32(w + 12), book = dv.getUint32(w + 16);
    const wave: Wave = { base, len: dv.getInt32(w + 4), type: rom[w + 8], book: null, loopStart: 0, loopEnd: 0, loopCount: 0, loopState: null };
    if (wave.type === 0 && book) {
      const n = dv.getInt32(bank + book) * dv.getInt32(bank + book + 4) * 8;
      wave.book = Int16Array.from({ length: n }, (_, k) => dv.getInt16(bank + book + 8 + k * 2));
    }
    if (loop) {
      wave.loopStart = dv.getUint32(bank + loop);
      wave.loopEnd = dv.getUint32(bank + loop + 4);
      wave.loopCount = dv.getInt32(bank + loop + 8);
      wave.loopState = Int16Array.from({ length: 16 }, (_, k) => dv.getInt16(bank + loop + 12 + k * 2));
    }
    waves.push(wave);
    pitch.push(f32(f32(s8(rom[detune + i * 4]) / 100) + s8((rom[basenote + i] - 48) & 0xff)));
  }
  return { waves, pitch };
}

interface Song {
  data: Uint8Array;
  chan: number[];
  vol: number[];
  pbend: number[];
  env: number;
}

function parseSong(data: Uint8Array): Song {
  const dv = view(data);
  const n = dv.getUint32(0);
  const list = (o: number) => Array.from({ length: n }, (_, i) => dv.getUint32(dv.getUint32(o) + i * 4));
  return { data, chan: list(4), vol: list(8), pbend: list(12), env: dv.getUint32(16) };
}

// A synthesizer voice: squared volume with exponential ramps, equal-power pan, 4-tap resampling.
class Voice {
  wave: PreparedWave | null = null;
  pos = 0;
  acc = 0;
  step = 0;
  pan = 64;
  vol = 0;
  gl = 0; gr = 0; tl = 0; tr = 0; rl = 1; rr = 1; rampLeft = 0;
  constructor(private readonly eq: Int32Array) {}
  start(w: PreparedWave) {
    this.wave = w;
    this.pos = -4;
    this.acc = 0;
    this.gl = 1;
    this.gr = 1;
    this.rampLeft = 0;
  }
  stop() { this.wave = null; }
  setPitch(ratio: number) { this.step = Math.trunc(Math.min(ratio, MAX_RATIO) * 32768) * 2; }
  private targets() {
    this.tl = (this.vol * this.eq[this.pan]) >> 15;
    this.tr = (this.vol * this.eq[127 - this.pan]) >> 15;
  }
  private ramp(n: number) {
    if (n <= 0) {
      this.gl = this.tl;
      this.gr = this.tr;
      this.rampLeft = 0;
      return;
    }
    this.gl = Math.max(this.gl, 1);
    this.gr = Math.max(this.gr, 1);
    this.rl = Math.pow(Math.max(this.tl, 1) / this.gl, 1 / n);
    this.rr = Math.pow(Math.max(this.tr, 1) / this.gr, 1 / n);
    this.rampLeft = n;
  }
  setVol(v: number, n: number) { this.vol = (v * v) >> 15; this.targets(); this.ramp(n); }
  setPan(p: number) { this.pan = p; this.targets(); this.ramp(this.rampLeft); }
  mix(left: Float32Array, right: Float32Array, from: number, to: number) {
    const w = this.wave;
    if (!w) return;
    const { buf, wrapAt, wrapLen, silentAt } = w;
    const lut = RESAMPLE_LUT;
    let { pos, acc, gl, gr, rampLeft } = this;
    const { step, rl, rr } = this;
    for (let j = from; j < to; j++) {
      let s = 0;
      if (pos < silentAt) {
        const k = (acc >> 8) & 0xfc;
        if (pos >= 0) {
          s = (buf[pos] * lut[k] + buf[pos + 1] * lut[k + 1] + buf[pos + 2] * lut[k + 2] + buf[pos + 3] * lut[k + 3]) >> 15;
        } else {
          for (let t = 0; t < 4; t++) if (pos + t >= 0 && pos + t < buf.length) s += buf[pos + t] * lut[k + t];
          s >>= 15;
        }
        if (s > 32767) s = 32767;
        else if (s < -32768) s = -32768;
      }
      if (rampLeft > 0) {
        gl *= rl;
        gr *= rr;
        if (--rampLeft === 0) {
          gl = this.tl;
          gr = this.tr;
        }
      }
      left[j] += s * gl;
      right[j] += s * gr;
      acc += step;
      pos += acc >> 16;
      acc &= 0xffff;
      if (pos >= wrapAt) pos -= wrapLen;
    }
    this.pos = pos;
    this.acc = acc;
    this.gl = gl;
    this.gr = gr;
    this.rampLeft = rampLeft;
  }
}

class Channel {
  pdata: number | null = null;
  dataBase = 0;
  pendingWave: Wave | null = null;
  time = 0;
  volTime = 0;
  pbTime = 0;
  vibAmount = 0;
  bend = f32(0);
  lastPitch = f32(99.9);
  pitch = f32(0);
  freqOffset = f32(0);
  pbPtr: number | null = null;
  volPtr: number | null = null;
  pbBase = 0;
  volBase = 0;
  nextTime = 0;
  noteStart = 0;
  portFrom = f32(0);
  portCur = f32(0);
  relTime = 0;
  attackStep = f32(1);
  decayStep = f32(1 / 255);
  releaseStep = f32(1 / 15);
  envMul = 0;
  vib = f32(0);
  bendRange = f32(0.03125);
  bendVal = f32(0);
  distort = f32(0);
  swTime = 0;
  tempoScale = 128;
  length = 1;
  tempoInc = 0; // initialized from the game's VI rate by Player
  handleVol = 128;
  lastVol = 0xffff;
  volCnt = 1;
  pbCnt = 1;
  ticksSince = 0;
  fixedLen = 0;
  wave = 0;
  handlePan = 128;
  cutoff = 0;
  endit = 0;
  vibDelay = 0;
  ignoreFixed = 0;
  port = 0;
  trans = 0;
  ignoreTrans = 0;
  vel = 0;
  vol = 127;
  pan = 64;
  lastPan = 255;
  envSpeed = 1;
  envInit = 0;
  envPeak = 127;
  envSustain = 127;
  envPhase = 0;
  envVol = 0;
  envCnt = 0;
  relVolume = 0;
  attackCnt = 1;
  decayCnt = 255;
  releaseCnt = 15;
  playing = false;
  wobOn = 0;
  wobOff = 0;
  wobCnt = 0;
  wobCur = 0;
  velOn = 0;
  defVel = 127;
  sweep = 0;
  vibSpeed = 0;
  envOff = 0;
  tie = 0;
  wobAmount = 0;
  swAcc = 0;
  swDir = 0;
  depth = 0;
  loopPtr = [0, 0, 0, 0];
  loopVolPtr: (number | null)[] = [null, null, null, null];
  loopPbPtr: (number | null)[] = [null, null, null, null];
  loopVolCnt = [0, 0, 0, 0];
  loopPbCnt = [0, 0, 0, 0];
  loopCount = [0, 0, 0, 0];
  loopVol = [0, 0, 0, 0];
  loopBend = [0, 0, 0, 0];
  foreverFor = -1; // frame of the first `for 255`
  foreverJump = -1; // frame of its first jump back
  readonly voice: Voice;
  constructor(eq: Int32Array) { this.voice = new Voice(eq); }
}

// libmus 0x80055414: 2^x by a 6th-order series of e^(x ln 2), inverted for x < 0.
function pow2(x: number): number {
  const L = [0.693147180559945, 0.240226506959101, 0.0555041086648216, 0.00961812910762848, 0.00133335581464284, 0.000154035303933816];
  if (x === 0) return 1;
  const a = Math.abs(x);
  let p = 1, xn = 1;
  for (const c of L) {
    xn *= a;
    p += c * xn;
  }
  return f32(x > 0 ? p : 1 / p);
}

class Player {
  readonly chans: Channel[] = [];
  frame = 0;

  constructor(private readonly rom: Uint8Array, private readonly song: Song, private readonly bank: Bank, handleVolume: number, eq: Int32Array, private readonly profile: Libmus64Profile, private readonly mixing: boolean) {
    song.chan.forEach((start, i) => {
      if (!start || this.chans.length >= profile.maxVoices) return;
      const c = new Channel(eq);
      c.pdata = c.dataBase = start;
      c.volPtr = song.vol[i] || null;
      c.volBase = song.vol[i];
      c.pbPtr = song.pbend[i] || null;
      c.pbBase = song.pbend[i];
      c.handleVol = handleVolume;
      c.tempoInc = Math.trunc(24576 / profile.vsyncs);
      this.chans.push(c);
    });
  }

  private readVar(p: number): [number, number] {
    const d = this.song.data;
    return d[p] & 0x80 ? [((d[p] & 0x7f) << 8) | d[p + 1], p + 2] : [d[p], p + 1];
  }

  private setEnvelope(c: Channel, o: number) {
    const d = this.song.data;
    const speed = d[o] || 1;
    c.envSpeed = speed;
    c.envMul = Math.trunc(1024 / speed);
    c.envInit = d[o + 1];
    c.attackCnt = d[o + 2];
    c.envPeak = d[o + 3];
    c.attackStep = f32((1 / d[o + 2]) * (d[o + 3] - c.envInit));
    c.decayCnt = d[o + 4];
    c.envSustain = d[o + 5];
    c.decayStep = f32((1 / d[o + 4]) * (d[o + 5] - c.envPeak));
    c.releaseCnt = d[o + 6];
    c.releaseStep = f32(1 / d[o + 6]);
    return o + 7;
  }

  // The position after the command, or null for stop.
  private command(c: Channel, cmd: number, p: number): number | null {
    const d = this.song.data;
    switch (cmd) {
      case 0x80: c.volPtr = null; c.pbPtr = null; return null;
      case 0x81: { const [w, q] = this.readVar(p); c.wave = w; return q; }
      case 0x82: c.port = d[p]; if (c.port) c.portCur = c.pitch; return p + 1;
      case 0x83: c.port = 0; return p;
      case 0x84: return this.setEnvelope(c, p);
      case 0x85: { // tempo in BPM, 48 ticks per quarter note, for every channel of the song
        const base = Math.trunc(Math.trunc((d[p] * 24576) / 120) / this.profile.vsyncs);
        for (const o of this.chans) o.tempoInc = (base * o.tempoScale) >> 7;
        return p + 1;
      }
      case 0x86: c.cutoff = (d[p] << 8) | d[p + 1]; c.endit = 0; return p + 2;
      case 0x87: c.endit = d[p]; c.cutoff = 0; return p + 1;
      case 0x88: case 0x89: c.vibDelay = d[p]; c.vibSpeed = d[p + 1]; c.vibAmount = f32((cmd === 0x88 ? d[p + 2] : -d[p + 2]) / 50); return p + 3;
      case 0x8a: c.vibSpeed = 0; c.vib = f32(0); return p;
      case 0x8b: { const [v, q] = this.readVar(p); c.fixedLen = v; return q; }
      case 0x8c: c.ignoreFixed = 1; return p;
      case 0x8d: c.trans = d[p]; return p + 1;
      case 0x8e: c.ignoreTrans = 1; return p;
      case 0x8f: { const v = f32(s8(d[p]) / 100); c.freqOffset = f32(f32(c.freqOffset - c.distort) + v); c.distort = v; return p + 1; }
      case 0x90: { const [e, q] = this.readVar(p); this.setEnvelope(c, this.song.env + e * 7); return q; }
      case 0x91: c.envOff = 1; return p;
      case 0x92: c.envOff = 0; return p;
      case 0x93: c.tie = 1; return p;
      case 0x94: c.tie = 0; return p;
      case 0x95: { // for (0xFF = forever)
        const i = c.depth;
        if (i >= 4) return p + 1;
        c.loopCount[i] = d[p];
        c.loopPtr[i] = p + 1;
        c.loopVolPtr[i] = c.volPtr;
        c.loopPbPtr[i] = c.pbPtr;
        c.loopVol[i] = c.vol;
        c.loopBend[i] = Math.trunc(c.bendVal) & 0xff;
        c.loopVolCnt[i] = c.volCnt;
        c.loopPbCnt[i] = c.pbCnt;
        c.depth++;
        if (d[p] === 0xff && c.foreverFor < 0) c.foreverFor = this.frame;
        return p + 1;
      }
      case 0x96: { // next
        let i = c.depth - 1;
        if (i < 0) return p;
        if (c.loopCount[i] !== 0xff) {
          c.loopCount[i] = (c.loopCount[i] - 1) & 0xff;
          if (c.loopCount[i] === 0) {
            c.depth = i;
            i = -1;
          }
        } else if (c.foreverJump < 0) {
          c.foreverJump = this.frame;
        }
        if (i < 0) return p;
        c.volPtr = c.loopVolPtr[i];
        c.pbPtr = c.loopPbPtr[i];
        c.vol = c.loopVol[i];
        c.bendVal = f32(c.loopBend[i]); // restored as an unsigned byte (libmus bug)
        c.volCnt = c.loopVolCnt[i];
        c.pbCnt = c.loopPbCnt[i];
        c.bend = f32(c.bendVal * c.bendRange);
        return c.loopPtr[i];
      }
      case 0x97: c.wobAmount = d[p]; c.wobOn = d[p + 1]; c.wobOff = d[p + 2]; return p + 3;
      case 0x98: c.wobOn = 0; return p;
      case 0x99: c.velOn = 1; return p;
      case 0x9a: c.velOn = 0; return p;
      case 0x9b: c.velOn = 0; c.defVel = d[p]; return p + 1;
      case 0x9c: c.pan = d[p] >> 1; return p + 1;
      case 0x9d: return p + 2;
      case 0x9e: return p + 1; // drum maps (no song uses them)
      case 0x9f: return p;
      case 0xa0: return p + 1;
      case 0xa1: // goto
        c.volCnt = 1;
        c.pbCnt = 1;
        c.volPtr = c.volBase + ((d[p + 2] << 8) | d[p + 3]);
        c.pbPtr = c.pbBase + ((d[p + 4] << 8) | d[p + 5]);
        return c.dataBase + ((d[p] << 8) | d[p + 1]);
      case 0xa2: return p + 1; // reverb send (not rendered)
      case 0xa3: case 0xa4: case 0xa5: return p + 2; // random values (no song uses them)
      case 0xa6: c.vol = d[p]; return p + 1;
      case 0xa7: return this.readVar(p)[1]; // sound effects are not rendered
      case 0xa8: c.bend = f32(c.bendVal * c.bendVal); c.bendRange = f32(d[p] * 0.015625); return p + 1; // sic
      case 0xa9: c.sweep = d[p]; return p + 1;
      default: return null;
    }
  }

  private startVoice(c: Channel) {
    if (this.mixing && c.pendingWave) c.voice.start(prepareWave(this.rom, c.pendingWave));
    c.playing = true;
    c.pendingWave = null;
  }

  private stopChannel(c: Channel) {
    c.pdata = null;
    if (c.playing) {
      c.playing = false;
      if (this.mixing) {
        c.voice.setVol(0, this.tickSampleCount());
        c.voice.stop();
      }
    }
  }

  private note(c: Channel) {
    const d = this.song.data;
    let p: number | null = c.pdata!;
    while (d[p] >= 0x80) {
      p = this.command(c, d[p], p + 1);
      if (p === null || p >= d.length) {
        this.stopChannel(c);
        return;
      }
    }
    c.portFrom = c.portCur;
    const n = d[p++];
    c.vel = c.velOn ? d[p++] : c.defVel;
    let len: number;
    if (c.fixedLen) {
      if (c.ignoreFixed) {
        c.ignoreFixed = 0;
        [len, p] = this.readVar(p);
      } else {
        len = c.fixedLen;
      }
    } else {
      [len, p] = this.readVar(p);
    }
    c.length = len;
    c.noteStart = c.nextTime;
    c.ticksSince = 0;
    c.wobCur = 0;
    c.wobCnt = c.wobOff;
    c.nextTime = (c.nextTime + len * 256) >>> 0;
    c.pdata = p;
    if (n === 0x60) { // rest: release
      if (c.envPhase < 4) {
        c.envPhase = 4;
        c.envCnt = 1;
        c.relTime = c.time;
        c.relVolume = c.envVol;
      }
      return;
    }
    if (!c.envOff) {
      if (c.length === 0x7fff) c.relTime = 0x7fffffff;
      else if (c.cutoff) c.relTime = (c.noteStart + c.cutoff * 256) >>> 0;
      else c.relTime = (c.nextTime - c.endit * 256) >>> 0;
      c.envPhase = 1;
      c.envVol = c.envInit;
      c.envCnt = c.envSpeed;
    }
    if (c.sweep) {
      c.swTime = c.noteStart;
      c.swAcc = 0;
      c.swDir = c.pan & 0x40;
    }
    if (!c.tie) {
      c.pendingWave = this.bank.waves[c.wave] ?? null;
      if (c.playing && c.lastVol !== 0) {
        if (this.mixing) c.voice.setVol(0, this.tickSampleCount());
        c.lastVol = 0;
      } else {
        this.startVoice(c);
      }
    }
    c.pitch = f32(n + (this.bank.pitch[c.wave] ?? 0));
  }

  private envelope(c: Channel) {
    if (c.time >= c.relTime && c.envPhase < 4) {
      c.envPhase = 4;
      c.envCnt = 1;
      c.relVolume = c.envVol;
    }
    c.envCnt = (c.envCnt - 1) & 0xff;
    if (c.envCnt !== 0) return;
    c.envCnt = c.envSpeed;
    const since = (c.time - c.noteStart) >>> 8;
    if (c.envPhase === 1) {
      const t = Math.imul(since, c.envMul) >>> 10;
      if (t < c.attackCnt) c.envVol = (c.envInit + Math.trunc(f32(c.attackStep * t))) & 0xff;
      else {
        c.envPhase = 2;
        c.envVol = c.envPeak;
      }
    } else if (c.envPhase === 2) {
      const t = Math.imul((since - c.attackCnt) >>> 0, c.envMul) >>> 10;
      if (t < c.decayCnt) c.envVol = (c.envPeak + Math.trunc(f32(c.decayStep * t))) & 0xff;
      else {
        c.envPhase = 3;
        c.envVol = c.envSustain;
      }
    } else if (c.envPhase === 4) {
      const t = Math.imul((c.time - c.relTime) >>> 8, c.envMul) >>> 10;
      if (t < c.releaseCnt) c.envVol = (c.relVolume - Math.trunc(f32(f32(c.releaseStep * t) * c.relVolume))) & 0xff;
      else {
        c.envPhase = 5;
        c.envVol = 0;
      }
    }
  }

  private pitchUpdate(c: Channel, offset: number) {
    let f = c.pitch;
    if (c.port) {
      if (c.port < c.ticksSince) c.portCur = f;
      else {
        f = f32(c.portFrom + f32(f32((f - c.portFrom) / c.port) * c.ticksSince));
        c.portCur = f;
      }
    }
    const tr = s8(c.trans) * (1 - c.ignoreTrans);
    f = f32(f + f32(f32(offset + c.bend) + tr));
    if (f === c.lastPitch) return;
    c.ignoreTrans = 0;
    c.lastPitch = f;
    let ratio = pow2(f32(f * (1 / 12)));
    if (ratio > 2) {
      ratio = 2;
      c.vel = 0;
    }
    if (this.mixing) c.voice.setPitch(ratio);
  }

  private volumeUpdate(c: Channel) {
    let v = Math.floor((c.vol * c.envVol * c.vel * c.handleVol) / 8192);
    if (v > 32767) v = 32767;
    v = Math.floor((v * this.profile.masterSongVolume) / 32768);
    if (v !== c.lastVol) {
      c.lastVol = v;
      if (this.mixing) c.voice.setVol(v, this.tickSampleCount());
    }
    if (c.pan !== c.lastPan) {
      const p = ((c.pan * c.handlePan) >> 7) & 0x7f;
      c.lastPan = p;
      if (this.mixing) c.voice.setPan(p);
    }
  }

  private volStream(c: Channel) {
    const d = this.song.data;
    do {
      c.volCnt = (c.volCnt - 1) & 0xffff;
      c.volTime = (c.volTime + 256) >>> 0;
      if (c.volCnt === 0) {
        const b = d[c.volPtr!++];
        if (b < 0x80) {
          c.vol = b;
          c.volCnt = 1;
        } else {
          c.vol = b & 0x7f;
          const b2 = d[c.volPtr!++];
          c.volCnt = b2 < 0x80 ? b2 + 2 : (((b2 & 0x7f) << 8) + 2 + d[c.volPtr!++]) & 0xffff;
        }
      }
    } while (c.volTime < c.time);
  }

  private pbStream(c: Channel) {
    const d = this.song.data;
    do {
      c.pbCnt = (c.pbCnt - 1) & 0xffff;
      c.pbTime = (c.pbTime + 256) >>> 0;
      if (c.pbCnt === 0) {
        const b = d[c.pbPtr!++];
        c.bendVal = f32((b & 0x7f) - 64);
        c.bend = f32(c.bendVal * c.bendRange);
        if (b < 0x80) c.pbCnt = 1;
        else {
          const b2 = d[c.pbPtr!++];
          c.pbCnt = b2 < 0x80 ? b2 + 2 : (((b2 & 0x7f) << 8) + 2 + d[c.pbPtr!++]) & 0xffff;
        }
      }
    } while (c.pbTime < c.time);
  }

  private sweepStep(c: Channel) {
    do {
      const a = c.swAcc + c.sweep;
      c.swTime = (c.swTime + 256) >>> 0;
      if (a < 64) c.swAcc = a;
      else {
        c.swAcc = a & 63;
        const step = a >> 6;
        if (!c.swDir) {
          c.pan = (c.pan + step) & 0xff;
          if (c.pan >= 128) {
            c.pan = 127;
            c.swDir = 1;
          }
        } else {
          c.pan = (c.pan - step) & 0xff;
          if (c.pan >= 128 || c.pan === 0) {
            c.pan = 0;
            c.swDir = 0;
          }
        }
      }
    } while (c.swTime < c.time);
  }

  private wobble(c: Channel) {
    c.wobCnt = (c.wobCnt - 1) & 0xff;
    if (c.wobCnt === 0) {
      if (c.wobCur === 0) {
        c.wobCur = c.wobAmount;
        c.wobCnt = c.wobOn;
      } else {
        c.wobCur = 0;
        c.wobCnt = c.wobOff;
      }
    }
    return s8(c.wobCur);
  }

  private vibrato(c: Channel) {
    const t = c.ticksSince - c.vibDelay;
    if (t > 0) c.vib = f32(Math.sin(f32(f32(t / c.vibSpeed) * 2) * 3.1415926) * c.vibAmount);
    return c.vib;
  }

  // One player tick (__MusIntMain 0x80054510).
  private tickSampleCount() {
    if (this.profile.tickSamples !== undefined) return this.profile.tickSamples;
    const { outputRate, vsyncs } = this.profile;
    return Math.floor(((this.frame + 1) * outputRate) / vsyncs) - Math.floor((this.frame * outputRate) / vsyncs);
  }

  tick() {
    for (const c of this.chans) {
      if (c.pdata === null) continue;
      if (c.pendingWave) this.startVoice(c);
      c.time = (c.time + c.tempoInc) >>> 0;
      if (c.length !== 0x7fff) {
        while (c.nextTime < c.time) {
          this.note(c);
          if (c.pdata === null) break;
        }
        if (c.pdata === null) continue;
      }
      // Both streams are serviced only when the pitch-bend timer is behind (libmus quirk).
      if (c.volPtr !== null && c.pbTime < c.time) this.volStream(c);
      if (c.pbPtr !== null && c.pbTime < c.time) this.pbStream(c);
      if (c.playing) {
        if (c.envPhase) this.envelope(c);
        if (c.sweep && c.swTime < c.time) this.sweepStep(c);
        let off = c.freqOffset;
        if (c.vibSpeed) off = f32(off + this.vibrato(c));
        if (c.wobOn) off = f32(off + this.wobble(c));
        if (!c.pendingWave) {
          this.pitchUpdate(c, off);
          this.volumeUpdate(c);
        }
      }
      c.ticksSince = ((c.time - c.noteStart) >>> 8) & 0xffff;
    }
    this.frame++;
  }

  allStopped() {
    return this.chans.every((c) => c.pdata === null);
  }
}

interface SongDef extends Libmus64SongDef {
  uses: string[];
}

const LEVEL_NAMES_FALLBACK = ['Media Dimension', 'Intro', 'Logos'];

function songDefs(rom: Uint8Array, levelNames: string[]): SongDef[] {
  const dv = view(rom);
  const songs = new Map<number, SongDef>();
  const add = (start: number, end: number, compressed: boolean, bank: number, samples: number, volume: number, use: string) => {
    const s = songs.get(start);
    if (s) {
      if (!s.uses.includes(use)) s.uses.push(use);
    } else {
      songs.set(start, { start, end, compressed, bank, samples, volume, uses: [use] });
    }
  };
  for (let lvl = 0; lvl < LEVEL_COUNT; lvl++) {
    const r = LEVEL_AUDIO + lvl * 36;
    const f = (k: number) => dv.getUint32(r + k * 4);
    const use = levelNames[lvl] || (lvl === 25 ? LEVEL_NAMES_FALLBACK[0] : lvl === 26 ? LEVEL_NAMES_FALLBACK[1] : LEVEL_NAMES_FALLBACK[2]);
    if (f(6) >= 0x80000000) {
      const starts = toRom(f(6)), ends = toRom(f(7));
      for (let j = 0; j < 16 && dv.getUint32(starts + j * 8); j++) {
        add(dv.getUint32(starts + j * 8), dv.getUint32(ends + j * 4), true, f(4), f(3), dv.getUint32(starts + j * 8 + 4), use);
      }
    } else if (f(6)) {
      add(f(6), f(7), true, f(4), f(3), f(0), use);
    }
  }
  for (let j = 0; j < 4; j++) {
    const e = JINGLES + j * 12;
    add(dv.getUint32(e), dv.getUint32(e + 4), false, EXTRAS_BANK, EXTRAS_SAMPLES, dv.getUint32(e + 8), `Jingle ${j + 1}`);
  }
  // A song no table references, stored between the Pre-History Channel song and REZOP.WBK; it plays
  // correctly with the Pre-History bank.
  add(0x47b670, 0x47ccb0, true, 0x4795f0, 0x45dc50, 0x60, 'Unused Pre-History Channel Song');
  return [...songs.values()].sort((a, b) => a.start - b.start);
}

const defsCache = new WeakMap<Uint8Array, SongDef[]>();
const bankCache = new WeakMap<Uint8Array, Map<string, Bank>>();
const eqCache = new WeakMap<Uint8Array, Map<number, Int32Array>>();

export function listGex64Music(rom: Uint8Array, levelNames: string[]): MusicTrack[] {
  const defs = songDefs(rom, levelNames);
  defsCache.set(rom, defs);
  const seen = new Map<string, number>();
  return defs.map((d, index) => {
    const base = d.uses.length > 3 ? `${d.uses.slice(0, 3).join(', ')} and ${d.uses.length - 3} more` : d.uses.join(', ');
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { index, name: `${String(index).padStart(2, '0')} ${base}${n > 1 ? ` (${n})` : ''}` };
  });
}

export function decodeGex64Music(rom: Uint8Array, index: number): DecodedMusic {
  const defs = defsCache.get(rom) ?? songDefs(rom, []);
  const def = defs[index];
  if (!def) throw new Error(`No music track ${index}`);
  return decodeLibmus64Music(rom, def, GEX_PROFILE);
}

function frameSample(profile: Libmus64Profile, frame: number) {
  return profile.tickSamples !== undefined
    ? frame * profile.tickSamples
    : Math.floor((frame * profile.outputRate) / profile.vsyncs);
}

// Decode one song with the shared old-libmus player. Parsed banks and their lazily prepared
// VADPCM waves remain attached to the ROM, so selecting another track from the same bank does
// not repeat either stage of sample decoding.
export function decodeLibmus64Music(rom: Uint8Array, def: Libmus64SongDef, profile: Libmus64Profile): DecodedMusic {
  let banks = bankCache.get(rom);
  if (!banks) bankCache.set(rom, (banks = new Map()));
  const bankKey = `${def.bank}:${def.samples}`;
  let bank = banks.get(bankKey);
  if (!bank) banks.set(bankKey, (bank = parseBank(rom, def.bank, def.samples)));
  const song = parseSong(def.compressed ? inflateRaw(rom, def.start, 0) : rom.slice(def.start, def.end));
  let eqs = eqCache.get(rom);
  if (!eqs) eqCache.set(rom, (eqs = new Map()));
  let eq = eqs.get(profile.eqpowerRom);
  if (!eq) {
    eq = Int32Array.from({ length: 128 }, (_, i) => view(rom).getInt16(profile.eqpowerRom + i * 2));
    eqs.set(profile.eqpowerRom, eq);
  }

  // Pass 1 runs the player alone to find the loop (the latest `for 255` and its first jump back) or
  // the end of a one-shot song; pass 2 mixes.
  const maxFrames = profile.tickSamples !== undefined
    ? Math.ceil((600 * profile.outputRate) / profile.tickSamples)
    : profile.vsyncs * 600;
  const probe = new Player(rom, song, bank, def.volume, eq, profile, false);
  let loopStart: number | undefined;
  let loopFrames: number | undefined;
  let endFrame = maxFrames;
  for (let f = 0; f < maxFrames; f++) {
    probe.tick();
    const looping = probe.chans.filter((c) => c.foreverFor >= 0);
    if (looping.length && looping.every((c) => c.foreverJump >= 0) && probe.chans.every((c) => c.foreverFor >= 0 || c.pdata === null)) {
      const ref = looping.reduce((a, b) => (b.foreverFor > a.foreverFor ? b : a));
      loopStart = ref.foreverFor;
      loopFrames = ref.foreverJump - ref.foreverFor;
      endFrame = loopStart + loopFrames;
      break;
    }
    if (probe.allStopped()) {
      const tailFrames = profile.tickSamples !== undefined
        ? Math.ceil((3 * profile.outputRate) / profile.tickSamples)
        : profile.vsyncs * 3;
      endFrame = f + 1 + tailFrames; // release tails
      break;
    }
  }
  const total = frameSample(profile, endFrame);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const player = new Player(rom, song, bank, def.volume, eq, profile, true);
  for (let f = 0; f < endFrame; f++) {
    player.tick();
    const from = frameSample(profile, f);
    const to = frameSample(profile, f + 1);
    for (const c of player.chans) c.voice.mix(left, right, from, to);
  }
  const scale = profile.playbackGain / (32768 * 32768);
  for (const buf of [left, right]) {
    for (let i = 0; i < total; i++) {
      const x = buf[i] * scale;
      buf[i] = x > 1 ? 1 : x < -1 ? -1 : x;
    }
  }
  const music: DecodedMusic = { sampleRate: profile.outputRate, channels: [left, right] };
  if (loopStart !== undefined && loopFrames !== undefined && loopFrames > 0) {
    music.loopStart = frameSample(profile, loopStart);
    music.loopEnd = frameSample(profile, loopStart + loopFrames);
  }
  return music;
}
