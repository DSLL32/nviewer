// Nintendo EAD "Nas" sound driver (VerH, the Super Mario 64 / Ocarina of Time family), rendered offline:
// three-level sequence scripts (sequence -> channel -> layer), instrument banks with drum kits, VADPCM
// samples, point-list envelopes, vibrato, squared volume and equal-power pan, mixed with the RSP 4-tap
// resampler. Ported from the Yoshi's Story research renderer (YOSHISTORY.md §7), whose semantics follow
// the driver code; tempo and loop points match captured game audio.
import type { DecodedMusic } from '../types';
import { view } from '../util';
import { RESAMPLE_LUT } from './libultra';

export interface NasConfig {
  bankTable: number; mapTable: number; seqTable: number; waveTable: number; // ROM offsets of the file tables
  bankSegment: number; waveSegment: number; seqSegment: number;
  pitchTable: number; pcentTable: number; pcent2Table: number; stereoLeft: number; // f32 tables
  defaultVelocityTable: number; defaultGateTable: number; defaultEnvelope: number; scomTable: number;
  sineTable: number; // RAM pointer to the vibrato sine table, stored at this ROM offset
  ramToRom: (a: number) => number;
  outputRate: number; // Hz
  updatesPerFrame: number;
  gain: number; // output scale applied to the mixed 16-bit samples
}

export interface NasRenderOptions { maxSeconds: number; tailSeconds: number }

export function nasRenderer(rom: Uint8Array, cfg: NasConfig) {
  const dv = view(rom);
  const u16 = (o: number) => dv.getUint16(o);
  const s16 = (o: number) => dv.getInt16(o);
  const u32 = (o: number) => dv.getUint32(o);
  const s32 = (o: number) => dv.getInt32(o);
  const f32 = (o: number) => dv.getFloat32(o);
  const PITCHTABLE = Float32Array.from({ length: 128 }, (_, i) => f32(cfg.pitchTable + 4 * i));
  const PCENT = Float32Array.from({ length: 256 }, (_, i) => f32(cfg.pcentTable + 4 * i)); // 2^((i - 128) / 127)
  const PCENT2 = Float32Array.from({ length: 256 }, (_, i) => f32(cfg.pcent2Table + 4 * i)); // 2^((i - 128) / 762)
  const STEREO_LEFT = Float32Array.from({ length: 128 }, (_, i) => f32(cfg.stereoLeft + 4 * i));
  const SINE = (() => { const p = cfg.ramToRom(u32(cfg.sineTable)); return Int16Array.from({ length: 64 }, (_, i) => s16(p + 2 * i)); })();
  const UPDATES = cfg.updatesPerFrame;
  const TEMPO_INTERNAL = Math.trunc((UPDATES * 2880000) / 48 / 16.713);
  const ENV_DELAY_SCALE = UPDATES * 0.25;
  const RELEASE_TABLE = new Float32Array(256);
  {
    const x = 1 / UPDATES;
    RELEASE_TABLE[255] = x / 0.25; RELEASE_TABLE[254] = x / 0.33; RELEASE_TABLE[253] = x / 0.5;
    RELEASE_TABLE[252] = x / 0.66; RELEASE_TABLE[251] = x / 0.75;
    for (let i = 128; i < 251; i++) RELEASE_TABLE[i] = x / (251 - i);
    for (let i = 16; i < 128; i++) RELEASE_TABLE[i] = x / (60 + 4 * (128 - i));
    for (let i = 1; i < 16; i++) RELEASE_TABLE[i] = x / (480 + 60 * (15 - i));
  }

  interface Entry { offset: number; size: number; sd1: number; sd2: number }
  const readTable = (pos: number): Entry[] => Array.from({ length: s16(pos) }, (_, i) => {
    const p = pos + 16 + 16 * i;
    return { offset: u32(p), size: u32(p + 4), sd1: u16(p + 10), sd2: u16(p + 12) };
  });
  const seqTable = readTable(cfg.seqTable), bankTable = readTable(cfg.bankTable), waveTable = readTable(cfg.waveTable);
  const seqBanks = (i: number) => {
    const o = u16(cfg.mapTable + 2 * i), c = rom[cfg.mapTable + o];
    return Array.from(rom.subarray(cfg.mapTable + o + 1, cfg.mapTable + o + 1 + c));
  };

  interface Sample {
    base: number; frames: number; book: Int16Array; loopStart: number; loopEnd: number; loopCount: number;
    loopState: Int16Array | null; buf?: Int16Array; wrapAt?: number; wrapLen?: number; silentAt?: number;
  }
  interface Tuned { sample: Sample; tuning: number }
  interface Instrument { lo: number; hi: number; release: number; env: number; low: Tuned | null; mid: Tuned | null; high: Tuned | null }
  interface Drum { release: number; pan: number; sound: Tuned; env: number }
  interface Bank { base: number; instruments: (Instrument | null)[]; drums: (Drum | null)[] }
  const bankCache = new Map<number, Bank>();
  const loadBank = (id: number): Bank => {
    const cached = bankCache.get(id);
    if (cached) return cached;
    const e = bankTable[id];
    const base = cfg.bankSegment + e.offset;
    const wbase = cfg.waveSegment + waveTable[e.sd1 >> 8].offset;
    const samples = new Map<number, Sample>();
    const sample = (off: number): Sample => {
      let s = samples.get(off);
      if (s) return s;
      const w0 = u32(base + off), loop = base + u32(base + off + 8), book = base + u32(base + off + 12);
      const npred = s32(book + 4);
      const loopCount = s32(loop + 8);
      s = {
        base: wbase + u32(base + off + 4), frames: Math.floor((w0 & 0xffffff) / 9),
        book: Int16Array.from({ length: 16 * npred }, (_, i) => s16(book + 8 + 2 * i)),
        loopStart: u32(loop), loopEnd: u32(loop + 4), loopCount,
        loopState: loopCount !== 0 ? Int16Array.from({ length: 16 }, (_, i) => s16(loop + 16 + 2 * i)) : null,
      };
      samples.set(off, s);
      return s;
    };
    const tuned = (p: number): Tuned | null => (u32(p) ? { sample: sample(u32(p)), tuning: f32(p + 4) } : null);
    const instruments = Array.from({ length: e.sd2 >> 8 }, (_, k): Instrument | null => {
      const o = u32(base + 4 + 4 * k);
      if (!o) return null;
      const p = base + o;
      return { lo: rom[p + 1], hi: rom[p + 2], release: rom[p + 3], env: base + u32(p + 4), low: tuned(p + 8), mid: tuned(p + 16), high: tuned(p + 24) };
    });
    const dl = u32(base);
    const drums = Array.from({ length: e.sd2 & 0xff }, (_, k): Drum | null => {
      const o = dl ? u32(base + dl + 4 * k) : 0;
      if (!o) return null;
      const p = base + o;
      return { release: rom[p], pan: rom[p + 1], sound: tuned(p + 4)!, env: base + u32(p + 12) };
    });
    const b = { base, instruments, drums };
    bankCache.set(id, b);
    return b;
  };

  // VADPCM, 9-byte frames of 16 samples (order 2).
  const decodeVadpcm = (pos: number, frames: number, book: Int16Array, hist: Int16Array, out: Int16Array, outPos: number) => {
    const res = new Int32Array(16);
    for (let f = 0; f < frames; f++, pos += 9, outPos += 16) {
      const code = rom[pos], scale = code >> 4, cb = (code & 15) << 4;
      const rshift = scale < 12 ? 12 - scale : 0;
      for (let i = 0; i < 8; i++) {
        const byte = rom[pos + 1 + i];
        res[i * 2] = (((byte & 0xf0) << 24) >> 16) >> rshift;
        res[i * 2 + 1] = (((byte & 0x0f) << 28) >> 16) >> rshift;
      }
      for (let h = 0; h < 16; h += 8) {
        const l1 = h === 0 ? hist[14] : hist[6], l2 = h === 0 ? hist[15] : hist[7];
        for (let i = 0; i < 8; i++) {
          let accu = (res[h + i] << 11) + (book[cb + i] | 0) * l1 + (book[cb + 8 + i] | 0) * l2;
          for (let k = 0; k < i; k++) accu += (book[cb + 8 + k] | 0) * res[h + i - 1 - k];
          const v = accu >> 11;
          hist[h + i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
        }
      }
      out.set(hist, outPos);
    }
  };
  const prepare = (s: Sample) => {
    if (s.buf) return;
    const pcm = new Int16Array(s.frames * 16);
    decodeVadpcm(s.base, s.frames, s.book, new Int16Array(16), pcm, 0);
    const loopLen = s.loopEnd - s.loopStart;
    if (s.loopCount !== 0 && loopLen > 0) {
      // The loop restarts from the frame containing loopStart, with the stored loop state as history.
      const body = new Int16Array(loopLen);
      const hist = s.loopState!.slice();
      let n = 0;
      for (let i = s.loopStart & 15; i < 16 && n < loopLen; i++) body[n++] = hist[i];
      const frame = new Int16Array(16);
      for (let f = (s.loopStart >> 4) + 1; n < loopLen; f++) {
        if (f < s.frames) decodeVadpcm(s.base + f * 9, 1, s.book, hist, frame, 0);
        else frame.fill(0);
        for (let i = 0; i < 16 && n < loopLen; i++) body[n++] = frame[i];
      }
      const buf = new Int16Array(s.loopEnd + loopLen + 4);
      buf.set(pcm.subarray(0, Math.min(pcm.length, s.loopEnd)));
      buf.set(body, s.loopEnd);
      for (let i = 0; i < 4; i++) buf[s.loopEnd + loopLen + i] = body[i % loopLen];
      s.buf = buf; s.wrapAt = s.loopEnd + loopLen; s.wrapLen = loopLen; s.silentAt = Infinity;
    } else {
      const buf = new Int16Array(pcm.length + 4);
      buf.set(pcm);
      s.buf = buf; s.wrapAt = Infinity; s.wrapLen = 0; s.silentAt = pcm.length;
    }
  };

  class Script {
    pc = 0; stack = [0, 0, 0, 0]; loopCnt = [0, 0, 0, 0]; depth = 0; value = 0;
    constructor(public data: Uint8Array) {}
    rb() { return this.data[this.pc++]; }
    rs8() { return (this.data[this.pc++] << 24) >> 24; }
    rw() { const v = (this.data[this.pc] << 8) | this.data[this.pc + 1]; this.pc += 2; return v; }
    rs16() { return (this.rw() << 16) >> 16; }
    rvar() { let v = this.data[this.pc++]; if (v & 0x80) v = ((v & 0x7f) << 8) | this.data[this.pc++]; return v; }
    key() { return `${this.pc},${this.depth},${this.stack.slice(0, this.depth)},${this.loopCnt.slice(0, this.depth)},${this.value}`; }
    // Common commands 0xF2..0xFF: 0 = continue, > 0 = delay, -1 = end.
    common(op: number): number {
      switch (op) {
        case 0xff:
          if (this.depth === 0) return -1;
          this.pc = this.stack[--this.depth];
          return 0;
        case 0xfe: return 1;
        case 0xfd: return this.rvar();
        case 0xfc: { const t = this.rw(); this.stack[this.depth++] = this.pc; this.pc = t; return 0; }
        case 0xfb: this.pc = this.rw(); return 0;
        case 0xfa: { const t = this.rw(); if (this.value === 0) this.pc = t; return 0; }
        case 0xf9: { const t = this.rw(); if (this.value < 0) this.pc = t; return 0; }
        case 0xf5: { const t = this.rw(); if (this.value >= 0) this.pc = t; return 0; }
        case 0xf8: this.loopCnt[this.depth] = this.rb(); this.stack[this.depth++] = this.pc; return 0;
        case 0xf7: {
          const c = (this.loopCnt[this.depth - 1] - 1) & 0xff;
          this.loopCnt[this.depth - 1] = c;
          if (c !== 0) this.pc = this.stack[this.depth - 1];
          else this.depth--;
          return 0;
        }
        case 0xf6: this.depth--; return 0;
        case 0xf4: { const r = this.rs8(); this.pc += r; return 0; }
        case 0xf3: { const r = this.rs8(); if (this.value === 0) this.pc += r; return 0; }
        case 0xf2: { const r = this.rs8(); if (this.value < 0) this.pc += r; return 0; }
      }
      return 0;
    }
  }

  interface EnvState { state: number; idx: number; delay: number; vel: number; fadeOut: number; sustain: number; current: number; target: number; env: number; decayReq: boolean; releaseReq: boolean }
  const envProcess = (e: EnvState): number => {
    switch (e.state) {
      case 0: return 0;
      case 1: case 2: e.state = 3; e.idx = 0; // falls through
      case 3: {
        for (let guard = 0; guard < 64; guard++) {
          const p = e.env + 4 * e.idx;
          const delay = s16(p);
          if (delay === -3) { e.state = 1; break; } // restart
          if (delay === -2) { e.idx = s16(p + 2); continue; } // goto
          if (delay === -1) { e.state = 5; break; } // hang
          if (delay === 0) { e.state = 0; break; } // disable
          e.delay = Math.trunc(delay * ENV_DELAY_SCALE) || 1;
          const t = s16(p + 2) / 32767;
          e.target = t * t;
          e.vel = (e.target - e.current) / e.delay;
          e.state = 4;
          e.idx++;
          break;
        }
        if (e.state !== 4) break;
      } // falls through
      case 4:
        if (e.state === 4) {
          e.delay--;
          e.current += e.vel;
          if (e.delay <= 0) e.state = 3;
        }
        break;
      case 5: break;
      case 6: case 7:
        e.current -= e.fadeOut;
        if (e.sustain !== 0 && e.state === 6) {
          if (e.current < e.sustain) { e.current = e.sustain; e.delay = 128; e.state = 8; }
        } else if (e.current < 1e-5) {
          e.current = 0;
          e.state = 0;
        }
        break;
      case 8:
        if (--e.delay === 0) e.state = 7;
        break;
    }
    if (e.decayReq) { e.state = 6; e.decayReq = false; }
    if (e.releaseReq) { e.state = 7; e.releaseReq = false; }
    return e.current < 0 ? 0 : e.current > 1 ? 1 : e.current;
  };

  class Voice {
    env: EnvState; pos = 0; acc = 0; gl = 0; gr = 0; tl = 0; tr = 0; step = 0; released = false;
    frozen: { freq: number; vel: number; pan: number } | null = null;
    vibTime = 0; vibExtent = 0; vibRate = 0; vibExtTimer = 0; vibRateTimer = 0; vibDelay = 0;
    constructor(public layer: Layer, public sample: Sample, envPtr: number) {
      this.env = { state: 1, idx: 0, delay: 0, vel: 0, fadeOut: 0, sustain: 0, current: 0, target: 0, env: envPtr, decayReq: false, releaseReq: false };
      prepare(sample);
      const ch = layer.chan;
      this.vibExtTimer = ch.vibExtentDelay;
      this.vibExtent = ch.vibExtentDelay === 0 ? ch.vibExtentTarget : ch.vibExtentStart;
      this.vibRateTimer = ch.vibRateDelay;
      this.vibRate = ch.vibRateDelay === 0 ? ch.vibRateTarget : ch.vibRateStart;
      this.vibDelay = ch.vibDelay;
    }
    vibrato(): number {
      if (this.vibDelay !== 0) { this.vibDelay--; return 1; }
      const ch = this.layer.chan;
      if (this.vibExtTimer) {
        if (this.vibExtTimer === 1) this.vibExtent = ch.vibExtentTarget;
        else this.vibExtent += (ch.vibExtentTarget - this.vibExtent) / this.vibExtTimer;
        this.vibExtTimer--;
      } else if (Math.trunc(this.vibExtent) !== ch.vibExtentTarget) {
        this.vibExtTimer = ch.vibExtentDelay;
        if (this.vibExtTimer === 0) this.vibExtent = ch.vibExtentTarget;
      }
      if (this.vibRateTimer) {
        if (this.vibRateTimer === 1) this.vibRate = ch.vibRateTarget;
        else this.vibRate += (ch.vibRateTarget - this.vibRate) / this.vibRateTimer;
        this.vibRateTimer--;
      } else if (Math.trunc(this.vibRate) !== ch.vibRateTarget) {
        this.vibRateTimer = ch.vibRateDelay;
        if (this.vibRateTimer === 0) this.vibRate = ch.vibRateTarget;
      }
      if (this.vibExtent === 0) return 1;
      this.vibTime = (this.vibTime + Math.trunc(this.vibRate)) >>> 0;
      const v = SINE[(this.vibTime >>> 10) & 0x3f] >> 8;
      return 1 + (PCENT[(v + 128) & 255] - 1) * (this.vibExtent / 4096);
    }
  }

  class Layer {
    enabled = true; script: Script; delay = 0; duration = 0; legato = false; stopSomething = false;
    needInit = true; inst = 0xff; instPtr: Instrument | null = null; adsrRelease = 0; adsrEnv = 0;
    transpose = 0; shortDelay = 0; lastDelay = 0; gate = 0x80; pan = 64; velSq = 0; freqScale = 1; bend = 1;
    noteFreqScale = 1; noteVelocity = 0; notePan = 64; ignoreDrumPan = false; voice: Voice | null = null;
    constructor(public chan: Channel, pc: number) {
      this.script = new Script(chan.group.data);
      this.script.pc = pc;
      this.adsrRelease = chan.release;
      this.adsrEnv = chan.env;
    }
    release(force = false) {
      const v = this.voice;
      if (!v || v.released) return;
      const ch = this.chan;
      v.frozen = { freq: this.noteFreqScale, vel: this.noteVelocity, pan: this.notePan };
      v.released = true;
      if (force) {
        v.env.releaseReq = true;
        v.env.fadeOut = 1 / UPDATES;
      } else {
        v.env.decayReq = true;
        v.env.fadeOut = RELEASE_TABLE[this.adsrRelease !== 0 ? this.adsrRelease : ch.release];
        v.env.sustain = (ch.sustain * v.env.current) / 256;
      }
    }
    tick(p: Player) {
      if (!this.enabled) return;
      if (this.delay >= 2) {
        this.delay--;
        if (!this.stopSomething && this.delay <= this.duration) { this.release(); this.stopSomething = true; }
        return;
      }
      if (!this.legato) this.release();
      this.needInit = true;
      const cmd = this.commands();
      if (cmd < 0) { this.release(); this.enabled = false; return; }
      const note = this.setNote(cmd);
      let ok = note >= 0;
      if (ok) ok = this.startVoice(note, p);
      if ((!ok || this.stopSomething) && this.voice) this.release();
    }
    commands(): number {
      const s = this.script, g = this.chan.group;
      for (let guard = 0; guard < 10000; guard++) {
        const op = s.rb();
        if (op <= 0xc0) return op;
        if (op >= 0xf2) {
          if (s.common(op) === 0) continue;
          return -1; // any delay or end ends the layer's command run
        }
        switch (op) {
          case 0xc1: { const v = s.rb(); this.velSq = (v * v) / 16129; continue; }
          case 0xca: this.pan = s.rb(); continue;
          case 0xc2: this.transpose = s.rb(); continue;
          case 0xc9: this.gate = s.rb(); continue;
          case 0xc3: this.shortDelay = s.rvar(); continue;
          case 0xc4: case 0xc5: this.legato = op === 0xc4; this.release(); continue;
          case 0xc6: {
            const v = s.rb();
            if (v >= 127) {
              this.inst = v === 127 ? 0 : v;
              this.instPtr = null;
              if (v === 0xff) this.adsrRelease = 0;
            } else {
              const ins = g.bank.instruments[v] ?? null;
              if (ins) { this.inst = v + 1; this.instPtr = ins; this.adsrEnv = ins.env; this.adsrRelease = ins.release; }
              else this.inst = 0xff;
            }
            continue;
          }
          case 0xc7: { const mode = s.rb(); s.rb(); if (mode & 0x80) s.rb(); else s.rvar(); continue; } // portamento (unused by music)
          case 0xc8: continue;
          case 0xcb: { const e = s.rw(); this.adsrEnv = g.base + e; this.adsrRelease = s.rb(); continue; }
          case 0xcc: this.ignoreDrumPan = true; continue;
          case 0xcd: s.rb(); continue;
          case 0xce: { const v = s.rb(); this.bend = PCENT2[(v + 128) & 255]; continue; }
          case 0xcf: this.adsrRelease = s.rb(); continue;
        }
        if ((op & 0xf0) === 0xd0) { const v = g.data[g.velTable + (op & 15)]; this.velSq = (v * v) / 16129; continue; }
        if ((op & 0xf0) === 0xe0) { this.gate = g.data[g.gateTable + (op & 15)]; continue; }
      }
      return -1;
    }
    setNote(cmd: number): number {
      const s = this.script;
      if (cmd === 0xc0) { this.delay = s.rvar(); this.stopSomething = true; return -1; }
      this.stopSomething = false;
      const typ = cmd & 0xc0, note = cmd & 0x3f;
      let delay: number;
      if (this.chan.largeNotes) {
        if (typ === 0x00) { delay = s.rvar(); const v = s.rb(); this.gate = s.rb(); this.lastDelay = delay; this.velSq = Math.min(v, 127) ** 2 / 16129; }
        else if (typ === 0x40) { delay = s.rvar(); const v = s.rb(); this.gate = 0; this.lastDelay = delay; this.velSq = Math.min(v, 127) ** 2 / 16129; }
        else { delay = this.lastDelay; const v = s.rb(); this.gate = s.rb(); this.velSq = Math.min(v, 127) ** 2 / 16129; }
      } else if (typ === 0x00) {
        delay = s.rvar();
        this.lastDelay = delay;
      } else {
        delay = typ === 0x40 ? this.shortDelay : this.lastDelay;
      }
      this.delay = delay;
      this.duration = (this.gate * delay) >> 8;
      return note;
    }
    startVoice(note: number, p: Player): boolean {
      const ch = this.chan, g = ch.group;
      let inst = this.inst, instPtr = this.instPtr;
      if (inst === 0xff) {
        if (!ch.hasInst) { this.stopSomething = true; return false; }
        inst = ch.instOrWave;
        instPtr = ch.instPtr;
      }
      let sound: Tuned | null;
      if (inst === 0) {
        const dr = g.bank.drums[(note + ch.transpose + this.transpose) & 0xff] ?? null;
        if (!dr) { this.stopSomething = true; return false; }
        sound = dr.sound;
        if (!this.ignoreDrumPan) this.pan = dr.pan;
        this.adsrEnv = dr.env;
        this.adsrRelease = dr.release;
        this.freqScale = sound.tuning;
      } else {
        const n = (note + g.transpose + ch.transpose + this.transpose) & 0xff;
        if (n >= 128 || !instPtr) { this.stopSomething = true; return false; }
        sound = n < instPtr.lo ? instPtr.low : n <= instPtr.hi ? instPtr.mid : instPtr.high;
        if (!sound) { this.stopSomething = true; return false; }
        this.freqScale = PITCHTABLE[n] * sound.tuning;
      }
      this.freqScale *= this.bend;
      if (this.legato && this.voice && !this.voice.released && this.voice.sample === sound.sample) {
        this.needInit = true; // continue the sounding voice
        return true;
      }
      const v = new Voice(this, sound.sample, this.adsrRelease !== 0 ? this.adsrEnv : ch.env);
      this.voice = v;
      p.voices.push(v);
      this.needInit = true;
      return true;
    }
  }

  class Channel {
    enabled = false; script: Script; delay = 0; halted = false; largeNotes = false;
    layers: (Layer | null)[] = [null, null, null, null];
    volume = 1; volumeScale = 1; appliedVolume = 1; freqScale = 1; newPan = 64; panWeight = 128;
    transpose = 0; reverb = 0; release = 240; sustain = 0; env = cfg.defaultEnvelope; instOrWave = 0; instPtr: Instrument | null = null; hasInst = false;
    vibRateStart = 2048; vibRateTarget = 2048; vibRateDelay = 0; vibExtentStart = 0; vibExtentTarget = 0; vibExtentDelay = 0; vibDelay = 0;
    changesVol = true; changesPan = true; changesFreq = true;
    io = new Int8Array(8).fill(-1); dynTable = 0;
    constructor(public group: Group) { this.script = new Script(group.data); }
    open(pc: number) {
      this.enabled = true;
      this.halted = false;
      this.delay = 0;
      this.script = new Script(this.group.data);
      this.script.pc = pc;
      for (let i = 0; i < 4; i++) {
        const l = this.layers[i];
        if (l) { l.release(); l.enabled = false; this.layers[i] = null; }
      }
    }
    stop() {
      for (const l of this.layers) if (l) { l.release(); l.enabled = false; }
      this.enabled = false;
    }
    setInstrument(v: number) {
      if (v >= 128) { this.instOrWave = v; this.instPtr = null; this.hasInst = true; }
      else if (v === 127) { this.instOrWave = 0; this.instPtr = null; this.hasInst = true; }
      else {
        const ins = this.group.bank.instruments[v] ?? null;
        if (ins) { this.instOrWave = v + 1; this.instPtr = ins; this.env = ins.env; this.release = ins.release; this.hasInst = true; }
        else { this.instOrWave = 0; this.instPtr = null; this.hasInst = false; }
      }
    }
    tick(p: Player) {
      if (!this.enabled) return;
      if (!this.halted) {
        if (this.delay >= 2) this.delay--;
        else this.run();
      }
      for (const l of this.layers) if (l) l.tick(p);
    }
    run() {
      const s = this.script, g = this.group, d = g.data;
      const table = (i: number) => (d[this.dynTable + 2 * i] << 8) | d[this.dynTable + 2 * i + 1];
      for (let guard = 0; guard < 10000; guard++) {
        const op = s.rb();
        if (op >= 0xb0) {
          if (op >= 0xf2) {
            const r = s.common(op);
            if (r === 0) continue;
            if (r < 0) { this.stop(); return; }
            this.delay = r;
            return;
          }
          const f = rom[cfg.scomTable + op - 0xb0], n = f & 3, a: number[] = [];
          for (let k = 0; k < n; k++) a.push(f & (0x80 >> k) ? s.rw() : s.rb());
          const a0 = a[0] ?? 0, a0s = (a0 << 24) >> 24;
          switch (op) {
            case 0xc1: this.setInstrument(a0); break;
            case 0xc2: this.dynTable = a0; break;
            case 0xc3: this.largeNotes = false; break;
            case 0xc4: this.largeNotes = true; break;
            case 0xc5: if (s.value !== -1) this.dynTable = table(s.value); break;
            case 0xc7: d[a[1]] = (s.value + a0) & 0xff; break;
            case 0xc8: s.value = ((s.value - a0s) << 24) >> 24; break;
            case 0xc9: s.value &= a0s; break;
            case 0xcc: s.value = a0s; break;
            case 0xcb: s.value = (d[a0 + s.value] << 24) >> 24; break;
            case 0xcd: g.channels[a0]?.stop(); break;
            case 0xd2: this.sustain = a0; break;
            case 0xd3: this.freqScale = PCENT[(a0 + 128) & 255]; this.changesFreq = true; break;
            case 0xee: this.freqScale = PCENT2[(a0 + 128) & 255]; this.changesFreq = true; break;
            case 0xde: this.freqScale = a0 / 32768; this.changesFreq = true; break;
            case 0xd4: this.reverb = a0; break;
            case 0xd7: this.vibRateDelay = 0; this.vibRateStart = this.vibRateTarget = a0 << 5; break;
            case 0xd8: this.vibExtentStart = 0; this.vibExtentDelay = 0; this.vibExtentTarget = a0 << 3; break;
            case 0xe1: this.vibRateStart = a[0] << 5; this.vibRateTarget = a[1] << 5; this.vibRateDelay = a[2] << 4; break;
            case 0xe2: this.vibExtentStart = a[0] << 3; this.vibExtentTarget = a[1] << 3; this.vibExtentDelay = a[2] << 4; break;
            case 0xe3: this.vibDelay = a0 << 4; break;
            case 0xd9: this.release = a0; break;
            case 0xda: this.env = g.base + a0; break;
            case 0xdb: this.transpose = a0s; break;
            case 0xdc: this.panWeight = a0; this.changesPan = true; break;
            case 0xdd: this.newPan = a0; this.changesPan = true; break;
            case 0xdf: this.volume = a0 / 127; this.changesVol = true; break;
            case 0xe0: this.volumeScale = a0 / 128; this.changesVol = true; break;
            case 0xe4:
              if (s.value !== -1) { const t = table(s.value); s.stack[s.depth++] = s.pc; s.pc = t; }
              break;
            case 0xe8: // 3 arguments read above, 5 more bytes
              this.transpose = s.rs8(); this.newPan = s.rb(); this.panWeight = s.rb(); this.reverb = s.rb(); s.rb();
              this.changesPan = true;
              break;
            case 0xe7: this.transpose = (d[a0 + 3] << 24) >> 24; this.newPan = d[a0 + 4]; this.panWeight = d[a0 + 5]; this.reverb = d[a0 + 6]; this.changesPan = true; break;
            case 0xea: this.halted = true; return;
            case 0xeb: this.setInstrument(a[1]); break;
            case 0xec:
              this.vibRateStart = this.vibRateTarget = this.vibRateDelay = 0;
              this.vibExtentStart = this.vibExtentTarget = this.vibExtentDelay = 0;
              this.vibDelay = 0; this.freqScale = 1; this.changesFreq = true;
              break;
            default: break; // filters, priorities, gain, stereo effects and counters don't affect a plain render
          }
          continue;
        }
        if (op >= 0x70) {
          const k = op & 0xf8, lo = op & 7;
          if (k === 0x70) this.io[lo] = s.value;
          else if (k === 0x78) { const r = s.rs16(); this.openLayer(lo, s.pc + r); }
          else if (k === 0x80) { const l = this.layers[lo]; s.value = l ? (l.enabled ? 0 : 1) : -1; }
          else if (k === 0x88) this.openLayer(lo, s.rw());
          else if (k === 0x90) { const l = this.layers[lo]; if (l) { l.release(); l.enabled = false; this.layers[lo] = null; } }
          else if (k === 0x98 && s.value !== -1) this.openLayer(lo, table(s.value));
          continue;
        }
        const hi = op & 0xf0, lo = op & 15;
        if (hi === 0x00) { this.delay = lo; return; }
        if (hi === 0x20) g.channels[lo].open(s.rw());
        else if (hi === 0x30) { const i = s.rb(); g.channels[lo].io[i & 7] = s.value; }
        else if (hi === 0x40) { const i = s.rb(); s.value = g.channels[lo].io[i & 7]; }
        else if (hi === 0x50) s.value = ((s.value - this.io[lo]) << 24) >> 24;
        else if (hi === 0x60) { s.value = this.io[lo]; if (lo < 2) this.io[lo] = -1; }
      }
    }
    openLayer(i: number, pc: number) {
      this.layers[i]?.release();
      this.layers[i] = new Layer(this, pc);
    }
  }

  class Group {
    data: Uint8Array; base = 0; bank: Bank; channels: Channel[] = [];
    enabled = true; halted = false; script: Script; delay = 0;
    tempo = 5760; tempoChange = 0; tempoAcc = 0; transpose = 0;
    fadeVolume = 1; fadeScale = 1; appliedVolume = 1; volState = 1; fadeTimer = 0; fadeInTime = 0; fadeVel = 0; recalc = true;
    velTable = 0; gateTable = 0; io = new Int8Array(8).fill(-1);
    constructor(seq: number) {
      const e = seqTable[seq];
      // Scripts address the sequence relative to its start; a copy keeps their writes local. The default
      // short-note tables are appended after the data.
      this.data = new Uint8Array(e.size + 0x60 + 32);
      this.data.set(rom.subarray(cfg.seqSegment + e.offset, cfg.seqSegment + e.offset + e.size), 0);
      this.velTable = e.size + 16;
      this.gateTable = e.size + 32;
      this.data.set(rom.subarray(cfg.defaultVelocityTable, cfg.defaultVelocityTable + 16), this.velTable);
      this.data.set(rom.subarray(cfg.defaultGateTable, cfg.defaultGateTable + 16), this.gateTable);
      const banks = seqBanks(seq);
      this.bank = loadBank(banks[banks.length - 1]);
      this.script = new Script(this.data);
      for (let i = 0; i < 16; i++) this.channels.push(new Channel(this));
    }
    update(p: Player) {
      if (!this.enabled) return false;
      this.tempoAcc += this.tempo + this.tempoChange;
      if (this.tempoAcc < TEMPO_INTERNAL) return false;
      this.tempoAcc -= TEMPO_INTERNAL;
      if (this.halted) return false;
      if (this.delay >= 2) this.delay--;
      else this.run();
      if (!this.enabled) return true;
      for (const c of this.channels) c.tick(p);
      return true;
    }
    run() {
      const s = this.script, d = this.data;
      this.recalc = true;
      for (let guard = 0; guard < 10000; guard++) {
        const op = s.rb();
        if (op >= 0xf2) {
          const r = s.common(op);
          if (r === 0) continue;
          if (r < 0) { this.stop(); return; }
          this.delay = r;
          return;
        }
        if (op >= 0xc0) {
          switch (op) {
            case 0xc5: s.rw(); break;
            case 0xc6: this.halted = true; return;
            case 0xc7: { const a = s.rb(); const o = s.rw(); d[o] = (s.value + a) & 0xff; break; }
            case 0xc8: s.value = ((s.value - s.rs8()) << 24) >> 24; break;
            case 0xc9: s.value &= s.rs8(); break;
            case 0xcc: s.value = s.rs8(); break;
            case 0xcd: s.rw(); break;
            case 0xce: s.rb(); break;
            case 0xd0: case 0xd3: case 0xd5: case 0xf1: s.rb(); break;
            case 0xd1: this.gateTable = s.rw(); break;
            case 0xd2: this.velTable = s.rw(); break;
            case 0xd6: case 0xd7: s.rw(); break;
            case 0xd9: this.fadeScale = s.rs8() / 127; break;
            case 0xda: {
              const mode = s.rb(), t = s.rw();
              if (mode === 0 || mode === 1) {
                if (this.volState !== 2) { this.fadeInTime = t; this.volState = mode; }
              } else if (mode === 2) {
                this.fadeTimer = t; this.volState = 2; this.fadeVel = (0 - this.fadeVolume) / t;
              }
              break;
            }
            case 0xdb: {
              const v = s.rb();
              if (this.volState === 2) break;
              if (this.volState === 1) { this.volState = 0; this.fadeVolume = 0; }
              if (this.fadeInTime) { this.fadeTimer = this.fadeInTime; this.fadeVel = (v / 127 - this.fadeVolume) / this.fadeInTime; }
              else this.fadeVolume = v / 127;
              break;
            }
            case 0xdc: this.tempoChange = s.rs8() * 48; break;
            case 0xdd: { let t = s.rb() * 48; if (t > TEMPO_INTERNAL) t = TEMPO_INTERNAL; if (t <= 0) t = 1; this.tempo = t; break; }
            case 0xde: this.transpose += s.rs8(); break;
            case 0xdf: this.transpose = s.rs8(); break;
            default: break;
          }
          continue;
        }
        const hi = op & 0xf0, lo = op & 15;
        switch (hi) {
          case 0x00: s.value = this.channels[lo].enabled ? 0 : 1; break;
          case 0x40: this.channels[lo].stop(); break;
          case 0x50: s.value = ((s.value - this.io[lo]) << 24) >> 24; break;
          case 0x70: this.io[lo] = s.value; break;
          case 0x80: s.value = this.io[lo]; if (lo < 2) this.io[lo] = -1; break;
          case 0x90: this.channels[lo].open(s.rw()); break;
          case 0xa0: { const r = s.rs16(); this.channels[lo].open(s.pc + r); break; }
          case 0xb0: s.rb(); s.rw(); break;
          default: break;
        }
      }
    }
    stop() {
      this.enabled = false;
      for (const c of this.channels) c.stop();
    }
    mainCtrl() {
      if (this.fadeTimer) {
        this.fadeVolume = Math.min(1, Math.max(0, this.fadeVolume + this.fadeVel));
        this.recalc = true;
        if (--this.fadeTimer === 0 && this.volState === 2) this.stop();
      }
      if (this.recalc) this.appliedVolume = this.fadeVolume * this.fadeScale;
      for (const c of this.channels) {
        if (!c.enabled && !c.layers.some((l) => l && l.voice)) continue;
        if (c.changesVol || this.recalc) { const v = c.volume * c.volumeScale * this.appliedVolume; c.appliedVolume = v * v; }
        const chPan = c.newPan * c.panWeight;
        for (const l of c.layers) {
          if (!l || !l.voice) continue;
          if (l.needInit) {
            l.noteFreqScale = l.freqScale * c.freqScale;
            l.noteVelocity = l.velSq * c.appliedVolume;
            l.notePan = (chPan + l.pan * (128 - c.panWeight)) >> 7;
            l.needInit = false;
          } else {
            if (c.changesFreq) l.noteFreqScale = l.freqScale * c.freqScale;
            if (c.changesVol || this.recalc) l.noteVelocity = l.velSq * c.appliedVolume;
            if (c.changesPan) l.notePan = (chPan + l.pan * (128 - c.panWeight)) >> 7;
          }
        }
        c.changesVol = c.changesPan = c.changesFreq = false;
      }
      this.recalc = false;
    }
    // Fingerprint of the whole script state, for loop detection.
    key(): string {
      const parts: unknown[] = [this.enabled, this.halted, this.script.key(), this.delay, this.tempo, this.tempoChange, this.transpose, this.fadeVolume.toFixed(4)];
      for (const c of this.channels) {
        if (!c.enabled) { parts.push('-'); continue; }
        parts.push(`${c.script.key()}|${c.delay}|${c.halted}|${c.largeNotes}`);
        for (const l of c.layers) parts.push(l && l.enabled ? `${l.script.key()}|${l.delay}` : '.');
      }
      return parts.join(';');
    }
  }

  class Player {
    voices: Voice[] = [];
    group: Group;
    constructor(seq: number) { this.group = new Group(seq); }
    updateVoices() {
      this.voices = this.voices.filter((v) => {
        const e = envProcess(v.env);
        if (v.released && v.env.state === 0) return false;
        const vib = v.vibrato();
        const l = v.layer;
        const src = v.frozen ?? { freq: l.noteFreqScale, vel: l.noteVelocity, pan: l.notePan };
        const vel = Math.min(1, Math.max(0, src.vel * e));
        const pan = src.pan & 0x7f;
        v.tl = Math.trunc(vel * STEREO_LEFT[pan] * 4095.999) / 4096;
        v.tr = Math.trunc(vel * STEREO_LEFT[127 - pan] * 4095.999) / 4096;
        v.step = Math.round(src.freq * vib * 65536);
        return true;
      });
    }
    mix(L: Float32Array, R: Float32Array, from: number, to: number) {
      const n = to - from;
      if (n <= 0) return;
      for (const v of this.voices) {
        const s = v.sample, buf = s.buf!, wrapAt = s.wrapAt!, wrapLen = s.wrapLen!, silentAt = s.silentAt!;
        const dl = (v.tl - v.gl) / n, dr = (v.tr - v.gr) / n;
        let gl = v.gl, gr = v.gr, pos = v.pos, acc = v.acc;
        const step = v.step;
        for (let j = from; j < to; j++) {
          let smp = 0;
          if (pos < silentAt) {
            const k = (acc >> 8) & 0xfc;
            smp = (buf[pos] * RESAMPLE_LUT[k] + buf[pos + 1] * RESAMPLE_LUT[k + 1] + buf[pos + 2] * RESAMPLE_LUT[k + 2] + buf[pos + 3] * RESAMPLE_LUT[k + 3]) >> 15;
          }
          gl += dl;
          gr += dr;
          L[j] += smp * gl;
          R[j] += smp * gr;
          acc += step;
          pos += acc >>> 16;
          acc &= 0xffff;
          if (pos >= wrapAt) pos -= wrapLen;
        }
        v.gl = v.tl; v.gr = v.tr; v.pos = pos; v.acc = acc;
      }
    }
  }

  // Renders a sequence. A loop is closed at the first tick whose script state repeats an earlier tick's;
  // the output is the intro, one pass and a second pass (which carries the first pass's release tails),
  // and the loop region is that second pass. A sequence that ends renders to its end plus a tail.
  return (seq: number, opts: NasRenderOptions): DecodedMusic => {
    if (seq < 0 || seq >= seqTable.length) throw new Error(`No sequence ${seq}`);
    const rate = cfg.outputRate;
    const p = new Player(seq);
    const spu = rate / (60 * UPDATES);
    const maxSamples = Math.ceil(opts.maxSeconds * rate);
    const L = new Float32Array(maxSamples), R = new Float32Array(maxSamples);
    const seen = new Map<string, number>();
    let update = 0, samplePos = 0, stopAt = maxSamples;
    let loop: [number, number] | null = null;
    while (samplePos < stopAt) {
      if (p.group.update(p) && loop === null && p.group.enabled) {
        const k = p.group.key();
        const prev = seen.get(k);
        const now = Math.round(update * spu);
        if (prev !== undefined) {
          loop = [now, now + (now - prev)];
          stopAt = Math.min(maxSamples, loop[1]);
        } else {
          seen.set(k, now);
        }
      }
      p.group.mainCtrl();
      p.updateVoices();
      const next = Math.min(Math.round((update + 1) * spu), stopAt);
      p.mix(L, R, samplePos, next);
      samplePos = next;
      update++;
      if (!p.group.enabled && loop === null) {
        stopAt = Math.min(stopAt, samplePos + Math.round(opts.tailSeconds * rate));
        if (p.voices.length === 0) stopAt = Math.min(stopAt, samplePos);
      }
    }
    const n = Math.min(samplePos, maxSamples);
    const scale = cfg.gain / 32768;
    const out = [L, R].map((c) => {
      const o = c.slice(0, n);
      for (let i = 0; i < n; i++) o[i] = Math.max(-1, Math.min(1, o[i] * scale));
      return o;
    });
    const music: DecodedMusic = { sampleRate: rate, channels: out };
    if (loop && loop[1] <= n) {
      music.loopStart = loop[0];
      music.loopEnd = loop[1];
    }
    return music;
  };
}
