// Glover (USA): 60 uncompressed Software Creations libmus sequences, rendered with
// the game's older sequence-player revision and libultra BIGROOM reverb.
import type { DecodedMusic, MusicTrack } from '../types';
import { view } from '../util';
import { prepareWave, RESAMPLE_LUT, type PreparedWave, type Wave } from './libultra';

const OUTPUT_RATE = 22047; // observed synthesizer output rate
const TICK_SAMPLES = 367; // 16666 us per tick at 22050 Hz
const VSYNCS = 60; // NTSC ([0x802AB04C] = 60 unless osTvType == PAL)
const EQPOWER_ROM = 0xf55b0; // libultra eqpower table (vaddr 0x801F45B0)
const MAX_RATIO = 1.99996;
const MUSIC_BANK = 0x4d58a0; // "N64 PtrTablesV2" nosfx.wbk
const MUSIC_WAVES = 0x4e3ee0; // "N64 WaveTables"
const SONG_SWITCH = 0x95b0; // jump table 0x801085B0 of the song select switch (ids 1..60)
const LEVEL_TABLE = 0xe7910; // 48 x 56 bytes, song id at +0x35
const HANDLE_VOLUME = 80; // MusHandleSetVolume(handle, 80) after each start (0x801780E8)
const SONG_MASTER = 22518; // normal-play options value observed in RAM
// Shipped mix is quiet next to the viewer's other soundtracks; this leaves the
// loudest song below full scale while preserving the game's relative levels.
const PLAYBACK_GAIN = 2.5;

const f32 = Math.fround;
const s8 = (x: number) => ((x & 0xff) << 24) >> 24;
const clamp16 = (v: number) => (v > 32767 ? 32767 : v < -32768 ? -32768 : v);

interface Bank { waves: Wave[]; pitch: number[] }

function parseBank(rom: Uint8Array, bank: number, samples: number): Bank {
  const dv = view(rom);
  if (String.fromCharCode(...rom.subarray(bank, bank + 15)) !== 'N64 PtrTablesV2') throw new Error('bank');
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

interface Song { data: Uint8Array; chan: number[]; vol: number[]; pbend: number[]; env: number }

function parseSong(data: Uint8Array): Song {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const n = v.getUint32(0);
  const list = (o: number) => Array.from({ length: n }, (_, i) => v.getUint32(v.getUint32(o) + i * 4));
  return { data, chan: list(4), vol: list(8), pbend: list(12), env: v.getUint32(16) };
}

// ---------------------------------------------------------------- song table (switch at 0x80177A90)
interface SongDef { id: number; start: number; end: number }
function songTable(rom: Uint8Array): SongDef[] {
  const dv = view(rom);
  const out: SongDef[] = [];
  for (let id = 1; id <= 60; id++) {
    const target = dv.getUint32(SONG_SWITCH + (id - 1) * 4);
    let o = target - 0x80100000 + 0x1000;
    const reg: Record<number, number> = {};
    for (let k = 0; k < 6; k++, o += 4) {
      const w = dv.getUint32(o), op = w >>> 26, rt = (w >>> 16) & 31, rs = (w >>> 21) & 31, imm = (w << 16) >> 16;
      if (op === 0x0f) reg[rt] = (imm << 16) >>> 0;
      else if (op === 0x09) reg[rt] = ((reg[rs] ?? 0) + imm) >>> 0;
    }
    out.push({ id, start: reg[5] - 0xb0000000, end: reg[6] - 0xb0000000 });
  }
  return out;
}

// ---------------------------------------------------------------- synthesizer voice
class Voice {
  wave: PreparedWave | null = null;
  pos = 0; acc = 0; step = 0; pan = 64; vol = 0;
  gl = 0; gr = 0; tl = 0; tr = 0; rl = 1; rr = 1; rampLeft = 0;
  dry = 1; wet = 0;
  constructor(private readonly eq: Int32Array) {}
  start(w: PreparedWave) { this.wave = w; this.pos = -4; this.acc = 0; this.gl = 1; this.gr = 1; this.rampLeft = 0; }
  stop() { this.wave = null; }
  setPitch(ratio: number) { this.step = Math.trunc(Math.min(ratio, MAX_RATIO) * 32768) * 2; }
  setFxMix(mix: number) { this.dry = this.eq[mix & 0x7f] / 32767; this.wet = this.eq[127 - (mix & 0x7f)] / 32767; }
  private targets() { this.tl = (this.vol * this.eq[this.pan]) >> 15; this.tr = (this.vol * this.eq[127 - this.pan]) >> 15; }
  private ramp(n: number) {
    if (n <= 0) { this.gl = this.tl; this.gr = this.tr; this.rampLeft = 0; return; }
    this.gl = Math.max(this.gl, 1); this.gr = Math.max(this.gr, 1);
    this.rl = Math.pow(Math.max(this.tl, 1) / this.gl, 1 / n);
    this.rr = Math.pow(Math.max(this.tr, 1) / this.gr, 1 / n);
    this.rampLeft = n;
  }
  setVol(v: number, n: number) { this.vol = (v * v) >> 15; this.targets(); this.ramp(n); }
  setPan(p: number) { this.pan = p; this.targets(); this.ramp(this.rampLeft); }
  mix(dl: Float64Array, dr: Float64Array, wl: Float64Array, wr: Float64Array, n: number) {
    const w = this.wave;
    if (!w) return;
    const { buf, wrapAt, wrapLen, silentAt } = w;
    const lut = RESAMPLE_LUT;
    let { pos, acc, gl, gr, rampLeft } = this;
    const { step, rl, rr, dry, wet } = this;
    for (let j = 0; j < n; j++) {
      let s = 0;
      if (pos < silentAt) {
        const k = (acc >> 8) & 0xfc;
        if (pos >= 0) s = (buf[pos] * lut[k] + buf[pos + 1] * lut[k + 1] + buf[pos + 2] * lut[k + 2] + buf[pos + 3] * lut[k + 3]) >> 15;
        else {
          for (let t = 0; t < 4; t++) if (pos + t >= 0 && pos + t < buf.length) s += buf[pos + t] * lut[k + t];
          s >>= 15;
        }
        s = clamp16(s);
      }
      if (rampLeft > 0) {
        gl *= rl; gr *= rr;
        if (--rampLeft === 0) { gl = this.tl; gr = this.tr; }
      }
      const L = s * gl, R = s * gr;
      dl[j] += L * dry; dr[j] += R * dry;
      if (wet) { wl[j] += L * wet; wr[j] += R * wet; }
      acc += step; pos += acc >> 16; acc &= 0xffff;
      if (pos >= wrapAt) pos -= wrapLen;
    }
    this.pos = pos; this.acc = acc; this.gl = gl; this.gr = gr; this.rampLeft = rampLeft;
  }
}

// libultra BIGROOM reverb (alFxPull).
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
    input = mix(input, inL, (0xda83 << 16) >> 16);
    input = mix(input, inR, 0x5a82);
    L[this.now] = input;
    let output = 0;
    for (const d of Reverb.SECTIONS) {
      const ip = (this.now - d.input + n) % n, op = (this.now - d.output + n) % n;
      let b1 = L[ip], b2 = L[op];
      if (d.ff) b2 = mix(b2, b1, d.ff);
      if (d.fb) { b1 = mix(b1, b2, d.fb); L[ip] = b1; }
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

// ---------------------------------------------------------------- libmus channel and player
class Channel {
  pdata: number | null = null; dataBase = 0; pendingWave: Wave | null = null;
  time = 0; volTime = 0; pbTime = 0;
  vibAmount = f32(0); vibRate = f32(0); bend = f32(0); lastPitch = f32(99.9); pitch = f32(0); freqOffset = f32(0);
  pbPtr: number | null = null; volPtr: number | null = null; pbBase = 0; volBase = 0;
  nextTime = 0; noteStart = 0; portFrom = f32(0); portCur = f32(0); relTime = 0;
  attackStep = f32(1); decayStep = f32(1 / 255); releaseStep = f32(1 / 15); envMul = 1024;
  vib = f32(0); bendRange = f32(0.03125); bendVal = f32(0); distort = f32(0); swTime = 0;
  tempoScale = 128; length = 1; tempoInc = Math.trunc(24576 / VSYNCS); handleVol = HANDLE_VOLUME; lastVol = 0xffff;
  volCnt = 1; pbCnt = 1; ticksSince = 0; fixedLen = 0; wave = 0; handlePan = 128;
  cutoff = 0; endit = 0; vibDelay = 0; ignoreFixed = 0; port = 0; trans = 0; ignoreTrans = 0;
  vel = 0; vol = 127; pan = 64; lastPan = 255;
  envSpeed = 1; envInit = 0; envPeak = 127; envSustain = 127; envPhase = 0; envVol = 0; envCnt = 0; relVolume = 0;
  attackCnt = 1; decayCnt = 255; releaseCnt = 15; playing = false;
  wobOn = 0; wobOff = 0; wobCnt = 0; wobCur = 0; velOn = 0; defVel = 127; sweep = 0; vibSpeed = 0;
  envOff = 0; tie = 0; wobAmount = 0; swAcc = 0; swDir = 0; reverb = 0; lastReverb = 255; handleReverb = 0;
  depth = 0;
  loopPtr = [0, 0, 0, 0]; loopVolPtr: (number | null)[] = [null, null, null, null]; loopPbPtr: (number | null)[] = [null, null, null, null];
  loopVolCnt = [0, 0, 0, 0]; loopPbCnt = [0, 0, 0, 0]; loopCount = [0, 0, 0, 0]; loopVol = [0, 0, 0, 0]; loopBend = [0, 0, 0, 0];
  foreverFor = -1; foreverJump = -1; capped = false;
  readonly voice: Voice;
  constructor(eq: Int32Array) { this.voice = new Voice(eq); }
}

function pow2(x: number): number {
  const L = [0.693147180559945, 0.240226506959101, 0.0555041086648216, 0.00961812910762848, 0.00133335581464284, 0.000154035303933816];
  if (x === 0) return 1;
  const a = Math.abs(x);
  let p = 1, xn = 1;
  for (const c of L) { xn *= a; p += c * xn; }
  return f32(x > 0 ? p : 1 / p);
}

interface Stats { pitchCaps: number; capNotes: number; notes: number; maxWave: number; badWave: number; commands: Set<number>; tempos: Set<number>; wavesUsed: Set<number> }

class Player {
  readonly chans: Channel[] = [];
  frame = 0;
  stats: Stats = { pitchCaps: 0, capNotes: 0, notes: 0, maxWave: 0, badWave: 0, commands: new Set(), tempos: new Set(), wavesUsed: new Set() };
  constructor(private readonly rom: Uint8Array, private readonly song: Song, private readonly bank: Bank, eq: Int32Array, private readonly mixing: boolean) {
    song.chan.forEach((start, i) => {
      if (!start) return;
      const c = new Channel(eq);
      c.pdata = c.dataBase = start;
      c.volPtr = song.vol[i] || null; c.volBase = song.vol[i];
      c.pbPtr = song.pbend[i] || null; c.pbBase = song.pbend[i];
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
    c.envSpeed = speed; c.envMul = Math.trunc(1024 / speed);
    c.envInit = d[o + 1]; c.attackCnt = d[o + 2]; c.envPeak = d[o + 3];
    c.attackStep = f32((1 / d[o + 2]) * (d[o + 3] - c.envInit));
    c.decayCnt = d[o + 4]; c.envSustain = d[o + 5];
    c.decayStep = f32((1 / d[o + 4]) * (d[o + 5] - c.envPeak));
    c.releaseCnt = d[o + 6]; c.releaseStep = f32(1 / d[o + 6]);
    return o + 7;
  }
  private command(c: Channel, cmd: number, p: number): number | null {
    const d = this.song.data;
    this.stats.commands.add(cmd);
    switch (cmd) {
      case 0x80: c.volPtr = null; c.pbPtr = null; return null;
      case 0x81: { const [w, q] = this.readVar(p); c.wave = w; return q; }
      case 0x82: c.port = d[p]; if (c.port) c.portCur = c.pitch; return p + 1;
      case 0x83: c.port = 0; return p;
      case 0x84: return this.setEnvelope(c, p);
      case 0x85: {
        this.stats.tempos.add(d[p]);
        const base = Math.trunc(Math.trunc((d[p] * 24576) / 120) / VSYNCS);
        for (const o of this.chans) o.tempoInc = (base * o.tempoScale) >> 7;
        return p + 1;
      }
      case 0x86: c.cutoff = (d[p] << 8) | d[p + 1]; c.endit = 0; return p + 2;
      case 0x87: c.endit = d[p]; c.cutoff = 0; return p + 1;
      case 0x88: case 0x89:
        c.vibDelay = d[p]; c.vibSpeed = d[p + 1];
        c.vibAmount = f32((cmd === 0x88 ? d[p + 2] : -d[p + 2]) / 50);
        c.vibRate = f32(6.2831852 / c.vibSpeed);
        return p + 3;
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
      case 0x95: {
        const i = c.depth;
        if (i >= 4) return p + 1;
        c.loopCount[i] = d[p]; c.loopPtr[i] = p + 1; c.loopVolPtr[i] = c.volPtr; c.loopPbPtr[i] = c.pbPtr;
        c.loopVol[i] = c.vol; c.loopBend[i] = Math.trunc(c.bendVal) & 0xff; c.loopVolCnt[i] = c.volCnt; c.loopPbCnt[i] = c.pbCnt;
        c.depth++;
        if (d[p] === 0xff && c.foreverFor < 0) c.foreverFor = this.frame;
        return p + 1;
      }
      case 0x96: {
        let i = c.depth - 1;
        if (i < 0) return p;
        if (c.loopCount[i] !== 0xff) {
          c.loopCount[i] = (c.loopCount[i] - 1) & 0xff;
          if (c.loopCount[i] === 0) { c.depth = i; i = -1; }
        } else if (c.foreverJump < 0) c.foreverJump = this.frame;
        if (i < 0) return p;
        c.volPtr = c.loopVolPtr[i]; c.pbPtr = c.loopPbPtr[i]; c.vol = c.loopVol[i];
        c.bendVal = f32(c.loopBend[i]); // restored as an unsigned byte (libmus bug, same in Glover)
        c.volCnt = c.loopVolCnt[i]; c.pbCnt = c.loopPbCnt[i];
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
      case 0x9e: return this.readVar(p)[1];
      case 0x9f: return p;
      case 0xa0: return p + 1;
      case 0xa1:
        c.volCnt = 1; c.pbCnt = 1;
        c.volPtr = c.volBase + ((d[p + 2] << 8) | d[p + 3]);
        c.pbPtr = c.pbBase + ((d[p + 4] << 8) | d[p + 5]);
        return c.dataBase + ((d[p] << 8) | d[p + 1]);
      case 0xa2: c.reverb = d[p]; return p + 1;
      case 0xa3: case 0xa4: case 0xa5: return p + 2;
      case 0xa6: c.vol = d[p]; return p + 1;
      case 0xa7: return this.readVar(p)[1];
      case 0xa8: c.bend = f32(c.bendVal * c.bendVal); c.bendRange = f32(d[p] * 0.015625); return p + 1; // sic
      case 0xa9: c.sweep = d[p]; return p + 1;
      case 0xaa: return p + 1; // fx change, only with [0x802AB068] == 1
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
      if (this.mixing) { c.voice.setVol(0, TICK_SAMPLES); c.voice.stop(); }
    }
  }
  private note(c: Channel) {
    const d = this.song.data;
    let p: number | null = c.pdata!;
    while (d[p] >= 0x80) {
      p = this.command(c, d[p], p + 1);
      if (p === null || p >= d.length) { this.stopChannel(c); return; }
    }
    c.portFrom = c.portCur;
    const n = d[p++];
    c.vel = c.velOn ? d[p++] : c.defVel;
    let len: number;
    if (c.fixedLen) {
      if (c.ignoreFixed) { c.ignoreFixed = 0; [len, p] = this.readVar(p); } else len = c.fixedLen;
    } else [len, p] = this.readVar(p);
    c.length = len;
    c.noteStart = c.nextTime;
    c.ticksSince = 0; c.wobCur = 0; c.wobCnt = c.wobOff;
    c.nextTime = (c.nextTime + len * 256) >>> 0;
    c.pdata = p;
    if (n === 0x60) {
      if (c.envPhase < 4) { c.envPhase = 4; c.envCnt = 1; c.relTime = c.time; c.relVolume = c.envVol; }
      return;
    }
    if (!c.envOff) {
      if (c.length === 0x7fff) c.relTime = 0x7fffffff;
      else if (c.cutoff) c.relTime = (c.noteStart + c.cutoff * 256) >>> 0;
      else c.relTime = (c.nextTime - c.endit * 256) >>> 0;
      c.envPhase = 1; c.envVol = c.envInit; c.envCnt = c.envSpeed;
    }
    if (c.sweep) { c.swTime = c.noteStart; c.swAcc = 0; c.swDir = c.pan & 0x40; }
    this.stats.notes++;
    c.capped = false;
    this.stats.wavesUsed.add(c.wave);
    if (c.wave > this.stats.maxWave) this.stats.maxWave = c.wave;
    if (!this.bank.waves[c.wave]) this.stats.badWave++;
    if (!c.tie) {
      c.pendingWave = this.bank.waves[c.wave] ?? null;
      if (c.playing && c.lastVol !== 0) {
        if (this.mixing) c.voice.setVol(0, TICK_SAMPLES);
        c.lastVol = 0;
      } else this.startVoice(c);
    }
    // Glover: pitch = pitchTable[wave] + note + (s8)(transpose * (1 - ignoreTrans)), set at note fetch.
    c.pitch = f32(f32(f32(this.bank.pitch[c.wave] ?? 0) + n) + s8(c.trans * (1 - c.ignoreTrans)));
    if (c.reverb !== c.lastReverb) {
      c.lastReverb = c.reverb;
      const mix = ((((128 - c.handleReverb) * c.reverb) >> 7) + c.handleReverb) & 0xff;
      if (this.mixing) c.voice.setFxMix(mix);
    }
  }
  private envelope(c: Channel) {
    if (c.time >= c.relTime && c.envPhase < 4) { c.envPhase = 4; c.envCnt = 1; c.relVolume = c.envVol; }
    c.envCnt = (c.envCnt - 1) & 0xff;
    if (c.envCnt !== 0) return;
    c.envCnt = c.envSpeed;
    const since = (c.time - c.noteStart) >>> 8;
    if (c.envPhase === 1) {
      const t = Math.imul(since, c.envMul) >>> 10;
      if (t < c.attackCnt) c.envVol = (c.envInit + Math.trunc(f32(c.attackStep * t))) & 0xff;
      else { c.envPhase = 2; c.envVol = c.envPeak; }
    } else if (c.envPhase === 2) {
      const t = Math.imul((since - c.attackCnt) >>> 0, c.envMul) >>> 10;
      if (t < c.decayCnt) c.envVol = (c.envPeak + Math.trunc(f32(c.decayStep * t))) & 0xff;
      else { c.envPhase = 3; c.envVol = c.envSustain; }
    } else if (c.envPhase === 4) {
      const t = Math.imul((c.time - c.relTime) >>> 8, c.envMul) >>> 10;
      if (t < c.releaseCnt) c.envVol = (c.relVolume - Math.trunc(f32(f32(c.releaseStep * t) * c.relVolume))) & 0xff;
      else { c.envPhase = 5; c.envVol = 0; }
    }
  }
  private pitchUpdate(c: Channel, offset: number) {
    let f = c.pitch;
    if (c.port) {
      if (c.port < c.ticksSince) c.portCur = f;
      else { f = f32(c.portFrom + f32(f32((f - c.portFrom) / c.port) * c.ticksSince)); c.portCur = f; }
    }
    f = f32(f + f32(offset + c.bend));
    if (f === c.lastPitch) return;
    c.lastPitch = f;
    let ratio = pow2(f32(f * (1 / 12)));
    if (ratio > 2) { ratio = 2; c.vel = 0; this.stats.pitchCaps++; if (!c.capped) { c.capped = true; this.stats.capNotes++; } }
    if (this.mixing) c.voice.setPitch(ratio);
  }
  private volumeUpdate(c: Channel) {
    let v = Math.floor((c.vol * c.envVol * c.vel * c.handleVol) / 8192);
    if (v > 32767) v = 32767;
    v = Math.floor((v * SONG_MASTER) / 32768);
    if (v !== c.lastVol) { c.lastVol = v; if (this.mixing) c.voice.setVol(v, TICK_SAMPLES); }
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
        if (b < 0x80) { c.vol = b; c.volCnt = 1; } else {
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
        if (b < 0x80) c.pbCnt = 1; else {
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
      if (a < 64) c.swAcc = a; else {
        c.swAcc = a & 63;
        const step = a >> 6;
        if (!c.swDir) { c.pan = (c.pan + step) & 0xff; if (c.pan >= 128) { c.pan = 127; c.swDir = 1; } }
        else { c.pan = (c.pan - step) & 0xff; if (c.pan >= 128 || c.pan === 0) { c.pan = 0; c.swDir = 0; } }
      }
    } while (c.swTime < c.time);
  }
  private wobble(c: Channel) {
    c.wobCnt = (c.wobCnt - 1) & 0xff;
    if (c.wobCnt === 0) {
      if (c.wobCur === 0) { c.wobCur = c.wobAmount; c.wobCnt = c.wobOn; } else { c.wobCur = 0; c.wobCnt = c.wobOff; }
    }
    return s8(c.wobCur);
  }
  private vibrato(c: Channel) {
    const t = c.ticksSince - c.vibDelay;
    c.vib = t > 0 ? f32(Math.sin(f32(t * c.vibRate)) * c.vibAmount) : f32(0);
    return c.vib;
  }
  // __MusIntMain (0x801C1338)
  tick() {
    for (const c of this.chans) {
      if (c.pdata === null) continue;
      if (c.pendingWave) this.startVoice(c);
      c.time = (c.time + c.tempoInc) >>> 0;
      if (c.length !== 0x7fff) {
        while (c.nextTime < c.time) { this.note(c); if (c.pdata === null) break; }
        if (c.pdata === null) continue;
      }
      // Glover: each stream on its own timer.
      if (c.volPtr !== null && c.volTime < c.time) this.volStream(c);
      if (c.pbPtr !== null && c.pbTime < c.time) this.pbStream(c);
      if (c.playing) {
        if (c.envPhase) this.envelope(c);
        if (c.sweep && c.swTime < c.time) this.sweepStep(c);
        let off = c.freqOffset;
        if (c.vibSpeed) off = f32(off + this.vibrato(c));
        if (c.wobOn) off = f32(off + this.wobble(c));
        if (!c.pendingWave) { this.pitchUpdate(c, off); this.volumeUpdate(c); }
      }
      c.ticksSince = ((c.time - c.noteStart) >>> 8) & 0xffff;
    }
    this.frame++;
  }
  allStopped() { return this.chans.every((c) => c.pdata === null); }
}

// ---------------------------------------------------------------- rendering
const bankCache = new WeakMap<Uint8Array, Bank>();
const eqCache = new WeakMap<Uint8Array, Int32Array>();

interface Rendered { left: Float32Array; right: Float32Array; loopStart?: number; loopEnd?: number }

function renderSong(rom: Uint8Array, def: SongDef): Rendered {
  let bank = bankCache.get(rom);
  if (!bank) {
    bank = parseBank(rom, MUSIC_BANK, MUSIC_WAVES);
    bankCache.set(rom, bank);
  }
  let eq = eqCache.get(rom);
  if (!eq) {
    const dv = view(rom);
    eq = Int32Array.from({ length: 128 }, (_, i) => dv.getInt16(EQPOWER_ROM + i * 2));
    eqCache.set(rom, eq);
  }
  const song = parseSong(rom.slice(def.start, def.end));
  const maxFrames = Math.ceil((600 * OUTPUT_RATE) / TICK_SAMPLES);
  const probe = new Player(rom, song, bank, eq, false);
  let loopStart: number | undefined, loopFrames: number | undefined, endFrame = maxFrames, oneShot = false;
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
    if (probe.allStopped()) { endFrame = f + 1; oneShot = true; break; }
  }
  const tail = Math.ceil((3 * OUTPUT_RATE) / TICK_SAMPLES);
  const total = endFrame + tail;
  const L = new Float32Array(total * TICK_SAMPLES), R = new Float32Array(total * TICK_SAMPLES);
  const player = new Player(rom, song, bank, eq, true);
  const dl = new Float64Array(TICK_SAMPLES), dr = new Float64Array(TICK_SAMPLES), wl = new Float64Array(TICK_SAMPLES), wr = new Float64Array(TICK_SAMPLES);
  const rv = new Reverb();
  const K = 1 / 32768;
  for (let f = 0; f < total; f++) {
    player.tick();
    dl.fill(0); dr.fill(0); wl.fill(0); wr.fill(0);
    for (const c of player.chans) c.voice.mix(dl, dr, wl, wr, TICK_SAMPLES);
    const o = f * TICK_SAMPLES;
    for (let k = 0; k < TICK_SAMPLES; k++) {
      // voice gains are 1/32768 units: s * g / 32768 is a 16-bit sample
      const y = rv.process(clamp16(Math.trunc(wl[k] * K)), clamp16(Math.trunc(wr[k] * K)));
      L[o + k] = (dl[k] * K + ((y * 0x7fff) >> 15)) / 32768;
      R[o + k] = (dr[k] * K + ((y * 0x7fff) >> 15)) / 32768;
    }
  }
  const res: Rendered = { left: L, right: R };
  if (!oneShot && loopStart !== undefined && loopFrames !== undefined && loopFrames > 0) {
    // The loop start sounds like the continuation past the loop end (the tails of the previous pass).
    res.loopStart = loopStart * TICK_SAMPLES;
    res.loopEnd = (loopStart + loopFrames) * TICK_SAMPLES;
    const end = res.loopEnd;
    const outL = L.slice(0, end), outR = R.slice(0, end);
    for (let k = end; k < L.length && res.loopStart + (k - end) < end; k++) {
      outL[res.loopStart + (k - end)] = L[k];
      outR[res.loopStart + (k - end)] = R[k];
    }
    res.left = outL; res.right = outR;
  }
  return res;
}


const SONG_NAMES = [
  "Atlantis Level 1",
  "Atlantis Level 2",
  "Atlantis Level 3",
  "Atlantis Boss",
  "Carnival Level 1",
  "Carnival Level 2",
  "Carnival Level 3",
  "Carnival Boss",
  "Pirates Level 1",
  "Pirates Level 2",
  "Pirates Level 3",
  "Pirates Boss",
  "Prehistoric Level 1",
  "Prehistoric Level 2",
  "Prehistoric Level 3",
  "Prehistoric Boss",
  "Fortress of Fear Level 1",
  "Fortress of Fear Level 2",
  "Fortress of Fear Level 3",
  "Fortress of Fear Boss",
  "Out of This World Level 1",
  "Out of This World Level 2",
  "Out of This World Level 3",
  "Out of This World Boss",
  "Assault Course",
  "Intro",
  "Outro",
  "The Castle: Hub 1 and 2",
  "The Castle: Hub 3",
  "The Castle: Hub 4",
  "The Castle: Hub 5",
  "The Castle: Hub 6 and 7",
  "The Castle: Hub 8 and Title Fly-through",
  "Atlantis Jingle A1",
  "Atlantis Jingle A2",
  "Atlantis Jingle B1",
  "Atlantis Jingle B2",
  "Carnival Jingle A1",
  "Carnival Jingle A2",
  "Carnival Jingle B1",
  "Carnival Jingle B2",
  "Pirates Jingle A1",
  "Pirates Jingle A2",
  "Pirates Jingle B1",
  "Pirates Jingle B2",
  "Prehistoric Jingle A1",
  "Prehistoric Jingle A2",
  "Prehistoric Jingle B1",
  "Prehistoric Jingle B2",
  "Fortress of Fear Jingle A1",
  "Fortress of Fear Jingle A2",
  "Fortress of Fear Jingle B1",
  "Fortress of Fear Jingle B2",
  "Out of This World Jingle A1",
  "Out of This World Jingle A2",
  "Out of This World Jingle B1",
  "Out of This World Jingle B2",
  "Bonus Levels",
  "Presentation and End Screens",
  "Front-end Menu"
] as const;
const defsCache = new WeakMap<Uint8Array, SongDef[]>();

function songDefs(rom: Uint8Array): SongDef[] {
  let defs = defsCache.get(rom);
  if (defs) return defs;
  if (rom.length !== 0x800000 || String.fromCharCode(...rom.subarray(MUSIC_BANK, MUSIC_BANK + 15)) !== 'N64 PtrTablesV2')
    throw new Error('Glover music: expected USA revision 0 ROM');
  defs = songTable(rom);
  if (defs.length !== SONG_NAMES.length || defs[0].start !== 0x6f8720 ||
      defs[defs.length - 1].end !== 0x77bbe0 ||
      defs.some((d) => d.start < 0x6f8720 || d.end <= d.start || d.end > 0x77bbe0))
    throw new Error('Glover music: invalid song table');
  defsCache.set(rom, defs);
  return defs;
}

export function gloverMusic(rom: Uint8Array): { tracks: MusicTrack[]; decode(index: number): DecodedMusic } {
  const defs = songDefs(rom);
  const tracks = SONG_NAMES.map((name, index) => ({
    index,
    name: `${String(index + 1).padStart(2, '0')} ${name}`,
  }));
  return {
    tracks,
    decode(index) {
      const def = defs[index];
      if (!def) throw new Error(`Glover music: no track ${index}`);
      const rendered = renderSong(rom, def);
      const channels = [rendered.left, rendered.right];
      for (const pcm of channels) {
        for (let i = 0; i < pcm.length; i++) {
          const sample = pcm[i] * PLAYBACK_GAIN;
          pcm[i] = sample > 1 ? 1 : sample < -1 ? -1 : sample;
        }
      }
      const music: DecodedMusic = { sampleRate: OUTPUT_RATE, channels };
      if (rendered.loopStart !== undefined && rendered.loopEnd !== undefined) {
        music.loopStart = rendered.loopStart;
        music.loopEnd = rendered.loopEnd;
      }
      return music;
    },
  };
}
