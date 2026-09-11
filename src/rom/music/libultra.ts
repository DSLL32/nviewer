// Offline renderer for music played with Nintendo's libultra audio library: ALBankFile
// instrument banks with VADPCM samples, driven by the MIDI sequence players (alSeqPlayer,
// alCSPlayer) and mixed like the RSP audio microcode (ABI1).
//
// What the renderer models:
// - VADPCM: the RSP ADPCM decoder (as in mupen64plus-rsp-hle), with libultra's loop handling:
//   after the loop end, playback resumes at the loop start with the decoder state stored in the
//   wave's loop record.
// - Resampling: the RSP 4-tap resampler table, pitch in 1/32768 steps, capped below 2.0.
// - Envelope mixer: volume squared, libultra's equal-power pan table, exponential volume ramps.
// - The sequence player: keymap lookup, percussion instrument on channel 9, attack/decay/release
//   envelopes, velocity, sample/channel/sequence volume, pan, pitch bend, sustain pedal, a voice
//   limit, note durations (compressed MIDI), and looping a region of the song.
// Not modelled: reverb, vibrato/tremolo, voice stealing by priority.
import type { DecodedMusic } from '../types';

const MAX_RATIO = 1.99996;
const GAIN_CHANGE_TIME = 1000; // microseconds
const MAX_TAIL = 10; // seconds of release tails rendered past the end of a song

const ADPCM_WAVE = 0;

// RSP resampler interpolation table (64 phases x 4 taps); phases 32..63 mirror 31..0.
const RESAMPLE_HALF = [
  0x0c39, 0x66ad, 0x0d46, 0xffdf, 0x0b39, 0x6696, 0x0e5f, 0xffd8, 0x0a44, 0x6669, 0x0f83, 0xffd0,
  0x095a, 0x6626, 0x10b4, 0xffc8, 0x087d, 0x65cd, 0x11f0, 0xffbf, 0x07ab, 0x655e, 0x1338, 0xffb6,
  0x06e4, 0x64d9, 0x148c, 0xffac, 0x0628, 0x643f, 0x15eb, 0xffa1, 0x0577, 0x638f, 0x1756, 0xff96,
  0x04d1, 0x62cb, 0x18cb, 0xff8a, 0x0435, 0x61f3, 0x1a4c, 0xff7e, 0x03a4, 0x6106, 0x1bd7, 0xff71,
  0x031c, 0x6007, 0x1d6c, 0xff64, 0x029f, 0x5ef5, 0x1f0b, 0xff56, 0x022a, 0x5dd0, 0x20b3, 0xff48,
  0x01be, 0x5c9a, 0x2264, 0xff3a, 0x015b, 0x5b53, 0x241e, 0xff2c, 0x0101, 0x59fc, 0x25e0, 0xff1e,
  0x00ae, 0x5896, 0x27a9, 0xff10, 0x0063, 0x5720, 0x297a, 0xff02, 0x001f, 0x559d, 0x2b50, 0xfef4,
  0xffe2, 0x540d, 0x2d2c, 0xfee8, 0xffac, 0x5270, 0x2f0d, 0xfedb, 0xff7c, 0x50c7, 0x30f3, 0xfed0,
  0xff53, 0x4f14, 0x32dc, 0xfec6, 0xff2e, 0x4d57, 0x34c8, 0xfebd, 0xff0f, 0x4b91, 0x36b6, 0xfeb6,
  0xfef5, 0x49c2, 0x38a5, 0xfeb0, 0xfedf, 0x47ed, 0x3a95, 0xfeac, 0xfece, 0x4611, 0x3c85, 0xfeab,
  0xfec0, 0x4430, 0x3e74, 0xfeac, 0xfeb6, 0x424a, 0x4060, 0xfeaf,
];
export const RESAMPLE_LUT = (() => {
  const lut = new Int32Array(256);
  for (let i = 0; i < 128; i++) {
    const v = (RESAMPLE_HALF[i] << 16) >> 16;
    lut[i] = v;
    lut[255 - i] = v;
  }
  return lut;
})();

interface Envelope {
  attack: number; // microseconds
  decay: number;
  release: number;
  attackVolume: number;
  decayVolume: number;
}

export interface Wave {
  base: number; // ROM offset
  len: number;
  type: number;
  book: Int16Array | null;
  loopStart: number;
  loopEnd: number;
  loopCount: number;
  loopState: Int16Array | null;
  prepared?: PreparedWave;
}

export interface PreparedWave {
  buf: Int16Array; // samples, then the loop body, then 4 wrap-around samples
  wrapAt: number;
  wrapLen: number;
  silentAt: number;
}

interface Sound {
  env: Envelope;
  velMin: number;
  velMax: number;
  keyMin: number;
  keyMax: number;
  keyBase: number;
  detune: number;
  pan: number;
  volume: number;
  wave: Wave;
}

interface Instrument {
  volume: number;
  pan: number;
  priority: number;
  bendRange: number;
  sounds: Sound[];
}

export interface Bank {
  sampleRate: number;
  instruments: (Instrument | null)[];
  percussion: Instrument | null;
  waves: Wave[];
  eqpower: Int32Array;
}

export interface MidiEvent {
  tick: number;
  us: number; // microseconds from the start of the song
  status: number;
  a: number;
  b: number;
  durUs?: number; // note-on with a duration (compressed MIDI): released after this long
}

export interface Sequence {
  division: number;
  events: MidiEvent[];
  tempos: { tick: number; uspt: number }[];
  endTick: number;
  endUs: number;
  // Where a looping song jumps back to (default: the start).
  loopStartTick?: number;
  loopStartUs?: number;
}

export interface RenderStats {
  notes: number;
  dropped: number; // note-ons ignored because all voices were busy
  maxVoices: number;
  songSeconds: number;
  tailSeconds: number;
}

// libultra's equal-power pan table.
const EQPOWER = Int32Array.from([
  32767, 32764, 32757, 32744, 32727, 32704, 32677, 32644, 32607, 32564, 32517, 32464, 32407, 32344, 32277, 32205,
  32127, 32045, 31958, 31866, 31770, 31668, 31561, 31450, 31334, 31213, 31087, 30957, 30822, 30682, 30537, 30388,
  30234, 30075, 29912, 29744, 29572, 29395, 29214, 29028, 28838, 28643, 28444, 28241, 28033, 27821, 27605, 27385,
  27160, 26931, 26698, 26461, 26220, 25975, 25726, 25473, 25216, 24956, 24691, 24423, 24151, 23875, 23596, 23313,
  23026, 22736, 22442, 22145, 21845, 21541, 21234, 20924, 20610, 20294, 19974, 19651, 19325, 18997, 18665, 18331,
  17993, 17653, 17310, 16965, 16617, 16266, 15913, 15558, 15200, 14840, 14477, 14113, 13746, 13377, 13006, 12633,
  12258, 11881, 11503, 11122, 10740, 10357, 9971, 9584, 9196, 8806, 8415, 8023, 7630, 7235, 6839, 6442,
  6044, 5646, 5246, 4845, 4444, 4042, 3640, 3237, 2833, 2429, 2025, 1620, 1216, 810, 405, 0,
]);

// ALBankFile at `ctl` (offsets relative to it), sample data at `tbl`; bank `index`. The
// equal-power pan table (128 s16) is read from the ROM at `eqpowerRom`, or is libultra's own
// when null.
export function parseBank(bytes: Uint8Array, ctl: number, tbl: number, index: number, eqpowerRom: number | null): Bank {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint16(ctl) !== 0x4231) throw new Error('Music instrument bank not found');
  const u8 = (o: number) => bytes[ctl + o];
  const s16 = (o: number) => dv.getInt16(ctl + o);
  const u32 = (o: number) => dv.getUint32(ctl + o);
  const s32 = (o: number) => dv.getInt32(ctl + o);
  if (index < 0 || index >= s16(2)) throw new Error(`No instrument bank ${index}`);

  const waves = new Map<number, Wave>();
  const wave = (o: number): Wave => {
    const known = waves.get(o);
    if (known) return known;
    const w: Wave = {
      base: tbl + u32(o), len: s32(o + 4), type: u8(o + 8), book: null,
      loopStart: 0, loopEnd: 0, loopCount: 0, loopState: null,
    };
    const loop = u32(o + 12);
    if (w.type === ADPCM_WAVE) {
      const book = u32(o + 16);
      const entries = s32(book) * s32(book + 4) * 8;
      w.book = Int16Array.from({ length: entries }, (_, k) => s16(book + 8 + k * 2));
      if (loop) w.loopState = Int16Array.from({ length: 16 }, (_, k) => s16(loop + 12 + k * 2));
    }
    if (loop) {
      w.loopStart = u32(loop);
      w.loopEnd = u32(loop + 4);
      w.loopCount = s32(loop + 8);
    }
    waves.set(o, w);
    return w;
  };

  const instrument = (o: number): Instrument => {
    const sounds: Sound[] = [];
    for (let k = 0; k < s16(o + 14); k++) {
      const so = u32(o + 16 + k * 4);
      const env = u32(so);
      const km = u32(so + 4);
      sounds.push({
        env: { attack: s32(env), decay: s32(env + 4), release: s32(env + 8), attackVolume: u8(env + 12), decayVolume: u8(env + 13) },
        velMin: u8(km), velMax: u8(km + 1), keyMin: u8(km + 2), keyMax: u8(km + 3), keyBase: u8(km + 4),
        detune: dv.getInt8(ctl + km + 5),
        pan: u8(so + 12), volume: u8(so + 13), wave: wave(u32(so + 8)),
      });
    }
    return { volume: u8(o), pan: u8(o + 1), priority: u8(o + 2), bendRange: s16(o + 12), sounds };
  };

  const b = u32(4 + index * 4);
  const instruments: (Instrument | null)[] = [];
  for (let k = 0; k < s16(b); k++) {
    const o = u32(b + 12 + k * 4);
    instruments.push(o ? instrument(o) : null);
  }
  const perc = u32(b + 8);
  const eqpower = eqpowerRom === null ? EQPOWER : Int32Array.from({ length: 128 }, (_, i) => dv.getInt16(eqpowerRom + i * 2));
  return {
    sampleRate: s32(b + 4), instruments, percussion: perc ? instrument(perc) : null, waves: [...waves.values()], eqpower,
  };
}

// 9-byte VADPCM frames to 16 samples each. `hist` holds the previous frame's output (the RSP
// decoder state) and is updated. Port of the RSP ADPCM command (mupen64plus-rsp-hle
// alist_adpcm / adpcm_compute_residuals), 4-bit frames.
export function decodeVadpcm(
  src: Uint8Array, pos: number, frames: number, book: Int16Array, hist: Int16Array, out: Int16Array, outPos: number,
) {
  const res = new Int32Array(16);
  for (let f = 0; f < frames; f++, pos += 9, outPos += 16) {
    const code = src[pos];
    const scale = code >> 4;
    const cb = (code & 15) << 4;
    const rshift = scale < 12 ? 12 - scale : 0;
    for (let i = 0; i < 8; i++) {
      const byte = src[pos + 1 + i];
      res[i * 2] = (((byte & 0xf0) << 24) >> 16) >> rshift;
      res[i * 2 + 1] = (((byte & 0x0f) << 28) >> 16) >> rshift;
    }
    for (let h = 0; h < 16; h += 8) {
      const l1 = h === 0 ? hist[14] : hist[6];
      const l2 = h === 0 ? hist[15] : hist[7];
      for (let i = 0; i < 8; i++) {
        let accu = (res[h + i] << 11) + (book[cb + i] | 0) * l1 + (book[cb + 8 + i] | 0) * l2;
        for (let k = 0; k < i; k++) accu += (book[cb + 8 + k] | 0) * res[h + i - 1 - k];
        const v = accu >> 11;
        hist[h + i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
      }
    }
    out.set(hist, outPos);
  }
}

// The wave's first pass as the game decodes it (from the start with a zeroed decoder).
export function decodeWave(bytes: Uint8Array, w: Wave): Int16Array {
  if (w.type === ADPCM_WAVE && w.book) {
    const frames = Math.max(0, Math.floor(w.len / 9));
    const pcm = new Int16Array(frames * 16);
    decodeVadpcm(bytes, w.base, frames, w.book, new Int16Array(16), pcm, 0);
    return pcm;
  }
  // AL_RAW16_WAVE: big-endian 16-bit PCM
  const pcm = new Int16Array(Math.max(0, w.len >> 1));
  for (let i = 0; i < pcm.length; i++) pcm[i] = ((bytes[w.base + i * 2] << 24) >> 16) | bytes[w.base + i * 2 + 1];
  return pcm;
}

export function prepareWave(bytes: Uint8Array, w: Wave): PreparedWave {
  if (w.prepared) return w.prepared;
  const pcm = decodeWave(bytes, w);
  const loopLen = w.loopEnd - w.loopStart;
  if (w.loopCount !== 0 && loopLen > 0) {
    // Finite loop counts are treated as infinite (music banks only loop forever).
    const body = new Int16Array(loopLen);
    if (w.type === ADPCM_WAVE && w.book) {
      // libultra alAdpcmPull: continue with the frame containing the loop start, taken from
      // the loop's decoder state, then decode the following frames from that state.
      const hist = w.loopState ? w.loopState.slice() : new Int16Array(16);
      let n = 0;
      for (let i = w.loopStart & 15; i < 16 && n < loopLen; i++) body[n++] = hist[i];
      const frame = new Int16Array(16);
      for (let f = (w.loopStart >> 4) + 1; n < loopLen; f++) {
        if ((f + 1) * 9 <= w.len) decodeVadpcm(bytes, w.base + f * 9, 1, w.book, hist, frame, 0);
        else frame.fill(0);
        for (let i = 0; i < 16 && n < loopLen; i++) body[n++] = frame[i];
      }
    } else {
      body.set(pcm.subarray(w.loopStart, w.loopEnd));
    }
    const buf = new Int16Array(w.loopEnd + loopLen + 4);
    buf.set(pcm.subarray(0, Math.min(pcm.length, w.loopEnd)));
    buf.set(body, w.loopEnd);
    for (let i = 0; i < 4; i++) buf[w.loopEnd + loopLen + i] = body[i % loopLen];
    w.prepared = { buf, wrapAt: w.loopEnd + loopLen, wrapLen: loopLen, silentAt: Infinity };
  } else {
    const buf = new Int16Array(pcm.length + 4);
    buf.set(pcm);
    w.prepared = { buf, wrapAt: Infinity, wrapLen: 0, silentAt: pcm.length };
  }
  return w.prepared;
}

interface Channel {
  inst: Instrument | null;
  vol: number;
  pan: number;
  bendRange: number;
  bend: number;
  sustain: number;
}

const PHASE_NOTEON = 0;
const PHASE_SUSTAIN = 1;
const PHASE_SUSTREL = 2;
const PHASE_RELEASE = 3;

interface Voice {
  sound: Sound;
  wave: PreparedWave;
  ch: number;
  key: number;
  vel: number;
  pass: number;
  preLoop: boolean; // started by an event before the loop start, in the first pass
  phase: number;
  releasing: boolean;
  envGain: number;
  envEnd: number; // end of the current envelope segment (samples)
  envAt: number; // pending decay event (samples)
  envVol: number;
  envDelta: number;
  offAt: number; // end of the note's duration (samples)
  endAt: number; // voice stops (samples)
  basePitch: number;
  step: number; // Q16.16
  pos: number;
  acc: number;
  pan: number;
  vol: number; // mixer volume
  gl: number;
  gr: number;
  tl: number;
  tr: number;
  rl: number;
  rr: number;
  rampLeft: number;
}

function mixVoice(v: Voice, left: Float32Array, right: Float32Array, from: number, to: number) {
  const { buf, wrapAt, wrapLen, silentAt } = v.wave;
  const lut = RESAMPLE_LUT;
  const step = v.step;
  let pos = v.pos;
  let acc = v.acc;
  let gl = v.gl;
  let gr = v.gr;
  let rampLeft = v.rampLeft;
  const rl = v.rl;
  const rr = v.rr;
  for (let j = from; j < to; j++) {
    let s = 0;
    if (pos < silentAt) {
      const k = (acc >> 8) & 0xfc;
      if (pos >= 0) {
        s = (buf[pos] * lut[k] + buf[pos + 1] * lut[k + 1] + buf[pos + 2] * lut[k + 2] + buf[pos + 3] * lut[k + 3]) >> 15;
      } else {
        for (let t = 0; t < 4; t++) if (pos + t >= 0) s += buf[pos + t] * lut[k + t];
        s >>= 15;
      }
      if (s > 32767) s = 32767;
      else if (s < -32768) s = -32768;
    }
    if (rampLeft > 0) {
      gl *= rl;
      gr *= rr;
      if (--rampLeft === 0) {
        gl = v.tl;
        gr = v.tr;
      }
    }
    left[j] += s * gl;
    right[j] += s * gr;
    acc += step;
    pos += acc >> 16;
    acc &= 0xffff;
    if (pos >= wrapAt) pos -= wrapLen;
  }
  v.pos = pos;
  v.acc = acc;
  v.gl = gl;
  v.gr = gr;
  v.rampLeft = rampLeft;
}

export interface RenderOptions {
  rate: number; // output sample rate
  maxVoices: number;
  seqVol: number; // sequence volume, 0..0x7FFF
  loop: boolean; // repeat [loopStart, end) of the song forever
  extra?: number; // samples rendered past the loop end (for verifying the loop seam)
  // Factor applied to every voice's pitch ratio; default bank sample rate / output rate.
  pitchScale?: number;
}

export function renderSequence(bytes: Uint8Array, bank: Bank, seq: Sequence, opts: RenderOptions) {
  const rate = opts.rate;
  const seqVol = opts.seqVol;
  const extra = opts.extra ?? 0;
  const toSamples = (us: number) => Math.round((us * rate) / 1e6);
  const songLen = toSamples(seq.endUs);
  // With the loop end marker at the end of the track, the jump happens before any event on
  // the final tick is played.
  const events = opts.loop ? seq.events.filter((e) => e.tick < seq.endTick) : seq.events;
  const loopStartTick = opts.loop ? (seq.loopStartTick ?? 0) : 0;
  let loopIdx = events.findIndex((e) => e.tick >= loopStartTick);
  if (loopIdx < 0) loopIdx = events.length;
  const loopStart = opts.loop ? toSamples(seq.loopStartUs ?? 0) : 0;
  const loopLen = songLen - loopStart;
  const loop = opts.loop && loopLen > 0 && loopIdx < events.length;
  const limit = songLen + MAX_TAIL * rate;
  const left = new Float32Array(limit + extra);
  const right = new Float32Array(limit + extra);
  const eqpower = bank.eqpower;
  const pitchScale = opts.pitchScale ?? bank.sampleRate / rate;

  // __initFromBank: every channel gets the first instrument, channel 9 the percussion
  // instrument.
  const setInst = (c: Channel, inst: Instrument | null) => {
    c.inst = inst;
    if (inst) {
      c.vol = inst.volume;
      c.pan = inst.pan;
      c.bendRange = inst.bendRange;
    }
  };
  const first = bank.instruments.find((i) => i) ?? null;
  const chans: Channel[] = [];
  for (let ch = 0; ch < 16; ch++) {
    const c: Channel = { inst: null, vol: 127, pan: 64, bendRange: 200, bend: 1, sustain: 0 };
    setInst(c, ch === 9 && bank.percussion ? bank.percussion : first);
    chans.push(c);
  }

  const voices: Voice[] = [];
  const stats = { notes: 0, dropped: 0, maxVoices: 0 };

  const vsVol = (v: Voice) => {
    const t1 = Math.floor((127 * v.vel * v.envGain) / 64);
    const t2 = Math.floor((v.sound.volume * seqVol * chans[v.ch].vol) / 16384);
    return Math.floor((t1 * t2) / 32768);
  };
  const vsPan = (v: Voice) => Math.max(0, Math.min(127, chans[v.ch].pan - 64 + v.sound.pan));
  const setPitch = (v: Voice) => {
    const ratio = Math.min(Math.fround(v.basePitch * chans[v.ch].bend), MAX_RATIO);
    v.step = Math.trunc(ratio * 32768) * 2;
  };
  const beginRamp = (v: Voice, n: number) => {
    if (n <= 0) {
      v.gl = v.tl;
      v.gr = v.tr;
      v.rampLeft = 0;
    } else {
      v.gl = Math.max(v.gl, 1);
      v.gr = Math.max(v.gr, 1);
      v.rl = Math.pow(Math.max(v.tl, 1) / v.gl, 1 / n);
      v.rr = Math.pow(Math.max(v.tr, 1) / v.gr, 1 / n);
      v.rampLeft = n;
    }
  };
  const setTargets = (v: Voice) => {
    v.tl = (v.vol * eqpower[v.pan]) >> 15;
    v.tr = (v.vol * eqpower[127 - v.pan]) >> 15;
  };
  const setVolume = (v: Voice, vol: number, n: number) => {
    v.vol = (vol * vol) >> 15;
    setTargets(v);
    beginRamp(v, n);
  };
  const release = (v: Voice, now: number) => {
    const n = toSamples(v.sound.env.release);
    v.releasing = true;
    v.phase = PHASE_RELEASE;
    v.envAt = Infinity;
    v.offAt = Infinity;
    setVolume(v, 0, n);
    v.endAt = now + n;
  };
  const keyUp = (v: Voice, now: number) => {
    if (v.phase === PHASE_SUSTAIN) v.phase = PHASE_SUSTREL;
    else release(v, now);
  };

  let pass = 0;
  let preLoopEnd = -Infinity; // when the last voice started before the loop start stopped
  const noteOn = (e: MidiEvent, ch: number, key: number, vel: number, now: number) => {
    const inst = chans[ch].inst;
    if (!inst) return;
    let sound: Sound | null = null;
    for (let l = 1, r = inst.sounds.length; r >= l; ) {
      const i = (l + r) >> 1;
      const s = inst.sounds[i - 1];
      if (key >= s.keyMin && key <= s.keyMax && vel >= s.velMin && vel <= s.velMax) {
        sound = s;
        break;
      }
      if (key < s.keyMin) r = i - 1;
      else l = i + 1;
    }
    if (!sound) return;
    stats.notes++;
    if (voices.length >= opts.maxVoices) {
      stats.dropped++;
      return;
    }
    const env = sound.env;
    const attack = toSamples(env.attack);
    let basePitch = Math.pow(2, ((key - sound.keyBase) * 100 + sound.detune) / 1200);
    if (pitchScale !== 1) basePitch *= pitchScale;
    const v: Voice = {
      sound, wave: prepareWave(bytes, sound.wave), ch, key, vel, pass, preLoop: pass === 0 && e.tick < loopStartTick,
      phase: chans[ch].sustain > 63 ? PHASE_SUSTAIN : PHASE_NOTEON, releasing: false,
      envGain: env.attackVolume, envEnd: now + attack, envAt: now + attack, envVol: env.decayVolume, envDelta: env.decay,
      offAt: e.durUs === undefined ? Infinity : now + Math.max(0, toSamples(e.durUs)),
      endAt: Infinity,
      basePitch, step: 0,
      pos: -4, acc: 0, pan: 64, vol: 0, gl: 0, gr: 0, tl: 0, tr: 0, rl: 1, rr: 1, rampLeft: 0,
    };
    setPitch(v);
    v.pan = vsPan(v);
    if (attack > 0) {
      v.gl = 1;
      v.gr = 1;
    }
    setVolume(v, vsVol(v), attack);
    voices.push(v);
    stats.maxVoices = Math.max(stats.maxVoices, voices.length);
  };
  const noteOff = (ch: number, key: number, now: number) => {
    const v = voices.find((x) => x.ch === ch && x.key === key && x.phase !== PHASE_RELEASE && x.phase !== PHASE_SUSTREL);
    if (v) keyUp(v, now);
  };
  const handle = (e: MidiEvent, now: number) => {
    const ch = e.status & 15;
    const c = chans[ch];
    const kind = e.status & 0xf0;
    if (kind === 0x90 && e.b !== 0) {
      noteOn(e, ch, e.a, e.b, now);
    } else if (kind === 0x80 || kind === 0x90) {
      noteOff(ch, e.a, now);
    } else if (kind === 0xb0) {
      if (e.a === 7) {
        c.vol = e.b;
        for (const v of voices) {
          if (v.ch !== ch || v.releasing) continue;
          const left = v.envEnd - now;
          setVolume(v, vsVol(v), left >= 0 ? left : toSamples(GAIN_CHANGE_TIME));
        }
      } else if (e.a === 10) {
        c.pan = e.b;
        for (const v of voices) {
          if (v.ch !== ch) continue;
          v.pan = vsPan(v);
          setTargets(v);
          beginRamp(v, v.rampLeft);
        }
      } else if (e.a === 64) {
        c.sustain = e.b;
        for (const v of voices) {
          if (v.ch !== ch || v.phase === PHASE_RELEASE) continue;
          if (e.b > 63) {
            if (v.phase === PHASE_NOTEON) v.phase = PHASE_SUSTAIN;
          } else if (v.phase === PHASE_SUSTAIN) {
            v.phase = PHASE_NOTEON;
          } else if (v.phase === PHASE_SUSTREL) {
            release(v, now);
          }
        }
      }
    } else if (kind === 0xc0) {
      const inst = bank.instruments[e.a];
      if (inst) setInst(c, inst);
    } else if (kind === 0xe0) {
      const cents = Math.trunc((c.bendRange * (((e.b << 7) | e.a) - 8192)) / 8192);
      c.bend = Math.pow(2, cents / 1200);
      for (const v of voices) if (v.ch === ch) setPitch(v);
    }
  };
  const envEvent = (v: Voice, now: number) => {
    v.envAt = Infinity;
    if (v.releasing) return;
    const n = Math.max(0, toSamples(v.envDelta));
    v.envGain = v.envVol;
    v.envEnd = now + n;
    setVolume(v, vsVol(v), n);
  };

  let idx = 0;
  let now = 0;
  let end = limit + extra;
  let finish = -1; // end of the song including release tails
  let stopped = false;
  // The first pass plays the whole song; later passes play [loopStart, songLen), each lasting
  // exactly loopLen samples, so the loop repeats sample for sample.
  const eventTime = () => {
    const t = toSamples(events[idx].us);
    return pass === 0 ? t : t - loopStart + songLen + (pass - 1) * loopLen;
  };
  while (now < end) {
    for (;;) {
      let busy = false;
      for (let i = voices.length - 1; i >= 0; i--) {
        if (voices[i].endAt <= now) {
          if (voices[i].preLoop) preLoopEnd = Math.max(preLoopEnd, voices[i].endAt);
          voices.splice(i, 1);
          busy = true;
        }
      }
      while (idx < events.length && eventTime() <= now) {
        handle(events[idx++], now);
        if (loop && idx === events.length) {
          idx = loopIdx;
          pass++;
        }
        busy = true;
      }
      for (const v of voices) {
        if (v.offAt <= now) {
          v.offAt = Infinity;
          if (v.phase !== PHASE_RELEASE && v.phase !== PHASE_SUSTREL) keyUp(v, now);
          busy = true;
        }
        if (v.envAt <= now) {
          envEvent(v, now);
          busy = true;
        }
      }
      if (!loop && !stopped && idx >= events.length && now >= songLen) {
        stopped = true;
        for (const v of voices) if (!v.releasing) release(v, now);
        busy = true;
      }
      if (!busy) break;
    }
    if (finish < 0) {
      // The loop region [finish - loopLen, finish) must hold nothing from the first pass that
      // later passes lack: no first-pass voices at its end, no pre-loop voices inside it.
      const done = loop
        ? now >= songLen && !voices.some((v) => v.pass === 0) && preLoopEnd <= now - loopLen
        : stopped && voices.length === 0;
      if (done || now >= limit) {
        finish = now;
        end = now + extra;
        if (now >= end) break;
      }
    }
    let next = end;
    if (idx < events.length) next = Math.min(next, eventTime());
    if (now < songLen) next = Math.min(next, songLen);
    if (finish < 0) {
      next = Math.min(next, limit);
      if (loop && preLoopEnd + loopLen > now) next = Math.min(next, preLoopEnd + loopLen);
    }
    for (const v of voices) next = Math.min(next, v.envAt, v.endAt, v.offAt);
    if (next <= now) next = now + 1;
    for (const v of voices) mixVoice(v, left, right, now, next);
    now = next;
  }
  if (finish < 0) finish = now;

  const scale = 1 / (32768 * 32768);
  const channels = [left, right].map((buf) => {
    const out = buf.slice(0, end);
    for (let i = 0; i < out.length; i++) {
      const x = out[i] * scale;
      out[i] = x > 1 ? 1 : x < -1 ? -1 : x;
    }
    return out;
  });
  const music: DecodedMusic = { sampleRate: rate, channels };
  if (loop) {
    // [finish - loopLen, finish) repeats seamlessly, with the previous pass's release tails
    // mixed into its start.
    music.loopStart = finish - loopLen;
    music.loopEnd = finish;
  }
  const result: { music: DecodedMusic; stats: RenderStats } = {
    music, stats: { ...stats, songSeconds: songLen / rate, tailSeconds: (finish - songLen) / rate },
  };
  return result;
}
