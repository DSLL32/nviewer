// Factor 5 MusyX (N64, "version 1" data) sound engine: data parsing and an offline renderer.
//
// A MusyX audio group is four blobs:
//   proj  groups: per song, program -> SoundMacro pages and 16 MIDI channel setups
//   pool  SoundMacros (8-byte commands), ADSR tables
//   sdir  sample directory (28-byte entries)
//   samp  sample data: per sample a 256-byte ADPCM codebook, then 40-byte blocks of 64 samples
// and songs are SNG files (tracks -> regions -> delta-time event streams, 384 ticks per beat).
//
// Faithful parts: sample codec (the RSP MusyX ADPCM decoder), song event decoding, loop points,
// program/page lookup, SoundMacro control flow, the RSP resampler (4-tap LUT, Q4.12 pitch) and the
// RSP mixing structure (192-sample frames with linear gain ramps, click-suppression DC tails).
// Approximations (from amuse, a MusyX reimplementation, not from the N64 runtime): volume curve,
// pan law, envelope/ADSR shapes, voice stealing, CC handling details.

export const OUTPUT_RATE = 22050;
const MASTER_GAIN = 0.74;
const FRAME = 192; // RSP MusyX subframe, also the game's AI buffer (768 bytes = 192 stereo frames)

const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const s16 = (b: Uint8Array, o: number) => (((b[o] << 8) | b[o + 1]) << 16) >> 16;
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------------------------------------
// Data

export interface PageEntry {
  objId: number;
  priority: number;
  maxVoices: number;
}

export interface MidiSetup {
  program: number;
  volume: number;
  pan: number;
  reverb: number;
  chorus: number;
}

export interface SongGroup {
  id: number;
  pages: Map<number, PageEntry>;
  drums: Map<number, PageEntry>;
  setups: Map<number, MidiSetup[]>;
}

export interface Adsr {
  attack: number; // seconds
  decay: number;
  sustain: number; // 0..1
  release: number;
}

export interface SampleInfo {
  id: number;
  offset: number;
  pitch: number; // MIDI key the sample plays at its own rate
  rate: number;
  format: number;
  count: number;
  loopStart: number;
  loopLength: number;
}

export interface DecodedSample {
  info: SampleInfo;
  data: Float32Array; // int16 scale, plus guard samples for the resampler
  looped: boolean;
  end: number; // loop end (looped) or sample count
  loopLength: number;
}

const GUARD = 4;

export class MusyxBank {
  readonly groups = new Map<number, SongGroup>();
  readonly macros = new Map<number, Uint8Array>(); // commands, 8 bytes each, little-endian field order
  readonly adsr = new Map<number, Adsr>();
  readonly samples = new Map<number, SampleInfo>();
  private decoded = new Map<number, DecodedSample | null>();

  constructor(proj: Uint8Array, pool: Uint8Array, sdir: Uint8Array, private samp: Uint8Array) {
    this.parseProject(proj);
    this.parsePool(pool);
    this.parseSdir(sdir);
  }

  private parseProject(d: Uint8Array) {
    let o = 0;
    while (o + 40 <= d.length && u32(d, o) !== 0xffffffff) {
      const end = u32(d, o);
      if (end < 40) throw new Error('MusyX project: bad group size');
      const id = u16(d, o + 4);
      const type = u16(d, o + 6);
      const sub = o + 8;
      if (type === 0) {
        const readPages = (p: number) => {
          const pages = new Map<number, PageEntry>();
          for (; p + 8 <= d.length && u16(d, p) !== 0xffff; p += 8)
            pages.set(d[p + 5], { objId: u16(d, p), priority: d[p + 2], maxVoices: d[p + 3] });
          return pages;
        };
        const group: SongGroup = {
          id,
          pages: readPages(sub + u32(d, o + 28)),
          drums: readPages(sub + u32(d, o + 32)),
          setups: new Map(),
        };
        for (let p = sub + u32(d, o + 36); p + 4 < o + end && p + 132 <= d.length; ) {
          const songId = u16(d, p);
          p += 4;
          const chans: MidiSetup[] = [];
          for (let i = 0; i < 16; i++, p += 8)
            chans.push({ program: d[p], volume: d[p + 1], pan: d[p + 2], reverb: d[p + 3], chorus: d[p + 4] });
          group.setups.set(songId, chans);
        }
        this.groups.set(id, group);
      }
      o += end;
    }
  }

  private parsePool(d: Uint8Array) {
    const objects = (start: number, fn: (o: number, size: number, id: number) => void) => {
      if (!start) return;
      for (let o = start; o + 8 <= d.length && u32(d, o) !== 0xffffffff; ) {
        const size = u32(d, o);
        if (size < 8 || o + size > d.length) break;
        fn(o, size, u16(d, o + 4));
        o += size;
      }
    };
    objects(u32(d, 0), (o, size, id) => {
      const n = (size - 8) >> 3;
      const cmds = new Uint8Array(n * 8);
      for (let i = 0; i < n; i++) {
        const s = o + 8 + i * 8;
        // Commands are stored as two big-endian u32 whose native (little-endian) bytes hold
        // the opcode followed by little-endian fields.
        for (let k = 0; k < 4; k++) {
          cmds[i * 8 + k] = d[s + 3 - k];
          cmds[i * 8 + 4 + k] = d[s + 7 - k];
        }
      }
      this.macros.set(id, cmds);
    });
    objects(u32(d, 4), (o, size, id) => {
      const le16 = (p: number) => d[p] | (d[p + 1] << 8);
      if (size === 0x10) {
        const decay = le16(o + 10);
        this.adsr.set(id, {
          attack: le16(o + 8) / 1000,
          decay: decay === 0x8000 ? 0 : decay / 1000,
          sustain: le16(o + 12) / 0x1000,
          release: le16(o + 14) / 1000,
        });
      } else if (size === 0x1c) {
        const le32 = (p: number) => (d[p] | (d[p + 1] << 8) | (d[p + 2] << 16) | (d[p + 3] << 24)) >>> 0;
        const tc = (v: number) => (v === 0x80000000 ? 0 : Math.pow(2, (v | 0) / (1200 * 65536)));
        this.adsr.set(id, {
          attack: tc(le32(o + 8)),
          decay: tc(le32(o + 12)),
          sustain: le16(o + 16) / 0x1000,
          release: le16(o + 18) / 1000,
        });
      }
    });
  }

  private parseSdir(d: Uint8Array) {
    for (let o = 0; o + 28 <= d.length && u32(d, o) !== 0xffffffff; o += 28) {
      const pr = u32(d, o + 12);
      const ns = u32(d, o + 16);
      this.samples.set(u16(d, o), {
        id: u16(d, o),
        offset: u32(d, o + 4),
        pitch: pr >>> 24 || 60,
        rate: pr & 0xffff,
        format: ns >>> 24,
        count: ns & 0xffffff,
        loopStart: u32(d, o + 20),
        loopLength: u32(d, o + 24),
      });
    }
  }

  sample(id: number): DecodedSample | null {
    let s = this.decoded.get(id);
    if (s !== undefined) return s;
    const info = this.samples.get(id);
    s = null;
    if (info && info.count > 0 && info.offset + 256 + Math.ceil(info.count / 64) * 40 <= this.samp.length) {
      const looped = info.loopLength !== 0 && info.loopStart !== 0xffffffff && info.loopStart < info.count;
      const end = looped ? Math.min(info.count, info.loopStart + info.loopLength) : info.count;
      const pcm = decodeAdpcm(this.samp, info.offset, info.count);
      const data = new Float32Array(end + GUARD);
      data.set(pcm.subarray(0, end));
      if (looped) for (let k = 0; k < GUARD; k++) data[end + k] = pcm[info.loopStart + (k % (end - info.loopStart))];
      s = { info, data, looped, end, loopLength: end - (looped ? info.loopStart : 0) };
    }
    this.decoded.set(id, s);
    return s;
  }
}

// MusyX N64 ADPCM, as decoded by the MusyX RSP microcode (mupen64plus-rsp-hle musyx.c).
// Block of 40 bytes = 64 samples: two 32-sample subframes, each with 2 raw int16 seed samples
// (bytes 0-3 and 4-7) and 16 bytes at 8 / 24: a header (high nibble: predictor, low nibble:
// right shift) and 30 residual nibbles. Predictor p uses codebook[p*16 .. p*16+15], order 2
// with an 8-tap correction over the residuals.
export function decodeAdpcm(samp: Uint8Array, offset: number, count: number): Int16Array {
  const book = new Int16Array(128);
  for (let i = 0; i < 128; i++) book[i] = s16(samp, offset + i * 2);
  const out = new Int16Array(Math.ceil(count / 64) * 64);
  const f = new Int32Array(32);
  let w = 0;
  for (let p = offset + 256; w < count; p += 40) {
    for (let sf = 0; sf < 2; sf++) {
      const nib = p + 8 + sf * 16;
      const c2 = samp[nib] & 0x7f;
      const b = (c2 >> 4) * 16;
      const rshift = c2 & 15;
      f[0] = s16(samp, p + sf * 4);
      f[1] = s16(samp, p + sf * 4 + 2);
      for (let i = 1; i < 16; i++) {
        const byte = samp[nib + i];
        f[i * 2] = (((byte & 0xf0) << 24) >> 16) >> rshift;
        f[i * 2 + 1] = (((byte & 0x0f) << 28) >> 16) >> rshift;
      }
      out[w] = f[0];
      out[w + 1] = f[1];
      for (let seg = 0; seg < 4; seg++) {
        const start = seg === 0 ? 2 : seg * 8;
        const n = seg === 0 ? 6 : 8;
        const l1 = out[w + start - 2];
        const l2 = out[w + start - 1];
        for (let i = 0; i < n; i++) {
          let acc = f[start + i] * 2048 + book[b + i] * l1 + book[b + 8 + i] * l2;
          for (let j = 0; j < i; j++) acc += book[b + 8 + j] * f[start + i - 1 - j];
          const v = (acc | 0) >> 11;
          out[w + start + i] = v < -32768 ? -32768 : v > 32767 ? 32767 : v;
        }
      }
      w += 32;
    }
  }
  return out.subarray(0, count);
}

// ---------------------------------------------------------------------------------------------
// Songs

interface SongEvent {
  sample: number; // exact output sample time
  order: number; // tie-break: length-based note-offs first, then data order
  chan: number;
  kind: number; // EV_*
  a: number;
  b: number;
}

const EV_NOTE_ON = 0;
const EV_NOTE_OFF = 1;
const EV_CC = 2;
const EV_PROGRAM = 3;
const EV_PITCH = 4;

export interface SongTiming {
  events: SongEvent[];
  loopStartSample: number; // in the rendered output
  loopEndSample: number;
  totalSamples: number;
  loops: boolean;
}

interface Region {
  tick: number;
  index: number;
  loopTo: number;
}

const LOOP_TAIL_SECONDS = 4;

// Expands a song into timed MIDI-like events: one pass from the start to the loop end, then the
// loop section repeated (shifted by the loop length, rounded to whole frames) so that note tails
// carry across the loop point. The output ends a few seconds into a repeat and the loop region is
// the preceding loop-length stretch, whose two ends are identical music. Songs whose first pass
// through the loop section differs from the repeats (intros) get one extra repeat. Songs without
// a loop entry are assumed to restart from the beginning.
export function expandSong(song: Uint8Array): SongTiming {
  const trackIdxOff = u32(song, 0);
  const regionIdxOff = u32(song, 4);
  const chanMapOff = u32(song, 8);
  const tempoTableOff = u32(song, 12);
  const tempoWord = u32(song, 16);
  const perChannelLoops = (tempoWord & 0x80000000) !== 0;
  const initialTempo = tempoWord & 0x7fffffff || 120;

  // Tempo map (ticks at 384 per beat).
  const tempos: { tick: number; tempo: number }[] = [{ tick: 0, tempo: initialTempo }];
  if (tempoTableOff) {
    for (let p = tempoTableOff; p + 8 <= song.length && u32(song, p) !== 0xffffffff; p += 8)
      tempos.push({ tick: u32(song, p), tempo: u32(song, p + 4) & 0x7fffffff || initialTempo });
  }
  const segStart: number[] = [0];
  for (let i = 1; i < tempos.length; i++) {
    const prev = tempos[i - 1];
    segStart.push(segStart[i - 1] + ((tempos[i].tick - prev.tick) * OUTPUT_RATE * 60) / (prev.tempo * 384));
  }
  const tickToSample = (t: number) => {
    let i = tempos.length - 1;
    while (i > 0 && tempos[i].tick > t) i--;
    return segStart[i] + ((t - tempos[i].tick) * OUTPUT_RATE * 60) / (tempos[i].tempo * 384);
  };

  interface Track {
    index: number;
    chan: number;
    regions: Region[];
  }
  const tracks: Track[] = [];
  for (let i = 0; i < 64; i++) {
    const off = u32(song, trackIdxOff + i * 4);
    if (!off) continue;
    const regions: Region[] = [];
    for (let p = off; p + 12 <= song.length; p += 12) {
      const r = { tick: u32(song, p), index: s16(song, p + 8), loopTo: s16(song, p + 10) };
      regions.push(r);
      if (r.index < 0) break;
    }
    tracks.push({ index: i, chan: song[chanMapOff + i] & 15, regions });
  }

  // Walks one region's event stream from `base`, calling `emit` for events before `stop` ticks.
  // Returns the tick after the last delta.
  const walkRegion = (
    index: number,
    base: number,
    stop: number,
    emit: (tick: number, kind: number, a: number, b: number, len: number) => void,
  ) => {
    const ro = u32(song, regionIdxOff + index * 4);
    const pitchOff = u32(song, ro + 4);
    const modOff = u32(song, ro + 8);
    let p = ro + 12;
    const time = () => {
      let t = 0;
      for (;;) {
        const part = u16(song, p);
        if (u16(song, p + 2) === 0) {
          t += part;
          p += 4;
          continue;
        }
        p += 2;
        return t + part;
      }
    };
    let tick = base + time();
    while (p + 2 <= song.length && u16(song, p) !== 0xffff) {
      const key = song[p];
      const vel = song[p + 1];
      if (key & 0x80) {
        if (tick < stop) {
          if (vel === 0) emit(tick, EV_PROGRAM, key & 0x7f, 0, 0);
          else if (vel & 0x80) emit(tick, EV_CC, vel & 0x7f, key & 0x7f, 0);
        }
        p += 2;
      } else {
        if (tick < stop) emit(tick, EV_NOTE_ON, key, vel & 0x7f, u16(song, p + 2));
        p += 4;
      }
      tick += time();
    }
    // Continuous pitch-wheel / mod-wheel data: (delta ticks, delta value) pairs.
    const continuous = (off: number, fn: (tick: number, value: number) => void) => {
      if (!off) return;
      let q = off;
      const uval = () => {
        if (song[q] & 0x80) {
          const v = ((song[q] & 0x7f) << 8) | song[q + 1];
          q += 2;
          return v;
        }
        return song[q++];
      };
      const sval = () => {
        if (song[q] & 0x80) {
          let v = ((song[q] & 0x7f) << 8) | song[q + 1];
          if (v & 0x4000) v -= 0x8000;
          q += 2;
          return v;
        }
        const v = song[q++] & 0x7f;
        return v & 0x40 ? v - 0x80 : v;
      };
      let t = base;
      let value = 0;
      while (q + 2 <= song.length && !(song[q] === 0x80 && song[q + 1] === 0)) {
        let dt = 0;
        let dv = 0;
        do {
          if (song[q] === 0x80 && song[q + 1] === 0) break;
          dt += uval();
          dv = sval();
        } while (dv === 0);
        t += dt;
        if (dv === 0) break;
        value += dv;
        if (t < stop) fn(t, value);
      }
    };
    continuous(pitchOff, (t, v) => emit(t, EV_PITCH, Math.round(clamp(v / 8191, -1, 1) * 8192), 0, 0));
    continuous(modOff, (t, v) => emit(t, EV_CC, 1, clamp(Math.trunc(v / 127), 0, 127), 0));
    return tick;
  };

  // Loop layout: the first "-2" region entry gives the loop end tick; songs ending with "-1"
  // are treated as restarting from the beginning.
  let loopEndTick = -1;
  let loops = false;
  for (const t of tracks) {
    const last = t.regions[t.regions.length - 1];
    if (last && last.index === -2) {
      loops = true;
      loopEndTick = Math.max(loopEndTick, last.tick);
    }
  }
  const loopStartTickFor = (chan: number) => (perChannelLoops ? u32(song, 20 + chan * 4) : u32(song, 20));
  if (!loops) {
    // End of song: the latest region end across tracks.
    for (const t of tracks) {
      for (let k = 0; k < t.regions.length; k++) {
        const r = t.regions[k];
        if (r.index < 0) break;
        const next = t.regions[k + 1];
        const stop = next && next.index !== -1 ? next.tick : Infinity;
        loopEndTick = Math.max(loopEndTick, Math.min(stop, walkRegion(r.index, r.tick, stop, () => {})));
      }
    }
  }
  if (loopEndTick <= 0) loopEndTick = 384;
  const loopStartTick = loopStartTickFor(0) < loopEndTick ? loopStartTickFor(0) : 0;
  const startSample = tickToSample(loopStartTick);
  const loopLen = Math.max(FRAME, Math.round((tickToSample(loopEndTick) - startSample) / FRAME) * FRAME);
  const tail = Math.round((LOOP_TAIL_SECONDS * OUTPUT_RATE) / FRAME) * FRAME;
  // With an intro (loop start > 0, or tracks looping back to a later region), the first pass
  // through the loop section can differ from the repeats, so the loop region is taken from a
  // second full pass.
  const intro =
    loops && (loopStartTick > 0 || tracks.some((t) => t.regions[t.regions.length - 1].loopTo > 0));
  const passes = intro ? 3 : 2;
  const loopStartOut = Math.ceil(startSample) + (passes - 2) * loopLen + tail;
  const total = loopStartOut + loopLen;

  const events: SongEvent[] = [];
  let order = 0;
  for (const t of tracks) {
    const pending = new Map<number, SongEvent>(); // note -> scheduled note-off
    const playList = (from: number, fromTick: number, shift: number, endTick: number) => {
      const regions = t.regions;
      for (let k = from; k < regions.length; k++) {
        const r = regions[k];
        if (r.index < 0) break;
        const next = regions[k + 1];
        // A "-1" entry only terminates the list; a region or "-2" loop entry bounds the region.
        const stop = Math.min(endTick, next && next.index !== -1 ? next.tick : Infinity);
        const base = Math.max(r.tick, fromTick);
        if (base >= stop) continue;
        walkRegion(r.index, base, stop, (tick, kind, a, b, len) => {
          const sample = tickToSample(tick) + shift;
          if (sample >= total) return;
          if (kind === EV_NOTE_ON) {
            const prev = pending.get(a);
            if (prev && prev.sample > sample) prev.kind = -1; // re-struck: the new length wins
            events.push({ sample, order: order++ * 2 + 1, chan: t.chan, kind, a, b });
            const off: SongEvent = {
              sample: tickToSample(tick + len) + shift,
              order: order++ * 2,
              chan: t.chan,
              kind: EV_NOTE_OFF,
              a,
              b: 0,
            };
            pending.set(a, off);
            events.push(off);
          } else {
            events.push({ sample, order: order++ * 2 + 1, chan: t.chan, kind, a, b });
          }
        });
      }
    };
    playList(0, 0, 0, loopEndTick);
    // Repeats of the loop section.
    const last = t.regions[t.regions.length - 1];
    const loopTo = loops && last.index === -2 ? clamp(last.loopTo, 0, t.regions.length - 1) : 0;
    const trackLoopStart = loops ? loopStartTickFor(t.chan) : 0;
    for (let pass = 1; pass < passes; pass++) playList(loopTo, trackLoopStart, pass * loopLen, loopEndTick);
  }
  const live = events.filter((e) => e.kind >= 0 && e.sample < total);
  live.sort((x, y) => x.sample - y.sample || (x.order & 1) - (y.order & 1) || x.order - y.order);
  return {
    events: live,
    loopStartSample: loopStartOut,
    loopEndSample: loopStartOut + loopLen,
    totalSamples: total,
    loops,
  };
}

// ---------------------------------------------------------------------------------------------
// Synthesis

// amuse's MusyX volume table (velocity/volume -> gain).
const VOLUME_TABLE = new Float32Array([
  0.0, 0.000031, 0.000153, 0.000397, 0.000702, 0.001129, 0.001648, 0.002228, 0.00293, 0.003723, 0.004608, 0.005585,
  0.006653, 0.007843, 0.009125, 0.010498, 0.011963, 0.01355, 0.015198, 0.016999, 0.01886, 0.020844, 0.022919,
  0.025117, 0.027406, 0.029817, 0.032319, 0.034944, 0.03766, 0.040468, 0.043428, 0.04648, 0.049623, 0.052889,
  0.056276, 0.059786, 0.063387, 0.06711, 0.070956, 0.074923, 0.078982, 0.083163, 0.087466, 0.091922, 0.096469,
  0.101138, 0.10593, 0.110843, 0.115879, 0.121036, 0.126347, 0.131748, 0.137303, 0.142979, 0.148778, 0.154729,
  0.160772, 0.166997, 0.173315, 0.179785, 0.186407, 0.193121, 0.200018, 0.207007, 0.214179, 0.221473, 0.228919,
  0.236488, 0.244209, 0.252083, 0.260079, 0.268258, 0.276559, 0.285012, 0.293649, 0.302408, 0.311319, 0.320383,
  0.3296, 0.339, 0.348521, 0.358226, 0.368084, 0.378094, 0.388287, 0.398633, 0.409131, 0.419813, 0.430647, 0.441664,
  0.452864, 0.464217, 0.475753, 0.487442, 0.499313, 0.511399, 0.523606, 0.536027, 0.548631, 0.561419, 0.574389,
  0.587542, 0.600879, 0.614399, 0.628132, 0.642018, 0.656148, 0.670431, 0.684927, 0.699637, 0.71453, 0.729637,
  0.744926, 0.76043, 0.776147, 0.792077, 0.808191, 0.824549, 0.84109, 0.857845, 0.874844, 0.892056, 0.909452,
  0.927122, 0.945006, 0.963073, 0.981414, 1.0, 1.0,
]);

function panLaw(p: number) {
  return p <= 64 ? (p / 64) * 0.7079 : 0.7079 + ((p - 64) / 64) * (1 - 0.7079);
}

// The same table is in the N64 runtime (boot code 0x8002ca40), indexed by 16.16 volume 0..127.
function lookupVolume(v: number) {
  const x = clamp(v * 127, 0, 127);
  const i = Math.floor(x);
  const t = x - i;
  return VOLUME_TABLE[i] * (1 - t) + VOLUME_TABLE[i + 1] * t;
}

// RSP MusyX resampler: 64 phases x 4 taps, Q15.
const RESAMPLE_LUT = new Float32Array(
  [
    0x0c39, 0x66ad, 0x0d46, 0xffdf, 0x0b39, 0x6696, 0x0e5f, 0xffd8, 0x0a44, 0x6669, 0x0f83, 0xffd0, 0x095a, 0x6626,
    0x10b4, 0xffc8, 0x087d, 0x65cd, 0x11f0, 0xffbf, 0x07ab, 0x655e, 0x1338, 0xffb6, 0x06e4, 0x64d9, 0x148c, 0xffac,
    0x0628, 0x643f, 0x15eb, 0xffa1, 0x0577, 0x638f, 0x1756, 0xff96, 0x04d1, 0x62cb, 0x18cb, 0xff8a, 0x0435, 0x61f3,
    0x1a4c, 0xff7e, 0x03a4, 0x6106, 0x1bd7, 0xff71, 0x031c, 0x6007, 0x1d6c, 0xff64, 0x029f, 0x5ef5, 0x1f0b, 0xff56,
    0x022a, 0x5dd0, 0x20b3, 0xff48, 0x01be, 0x5c9a, 0x2264, 0xff3a, 0x015b, 0x5b53, 0x241e, 0xff2c, 0x0101, 0x59fc,
    0x25e0, 0xff1e, 0x00ae, 0x5896, 0x27a9, 0xff10, 0x0063, 0x5720, 0x297a, 0xff02, 0x001f, 0x559d, 0x2b50, 0xfef4,
    0xffe2, 0x540d, 0x2d2c, 0xfee8, 0xffac, 0x5270, 0x2f0d, 0xfedb, 0xff7c, 0x50c7, 0x30f3, 0xfed0, 0xff53, 0x4f14,
    0x32dc, 0xfec6, 0xff2e, 0x4d57, 0x34c8, 0xfebd, 0xff0f, 0x4b91, 0x36b6, 0xfeb6, 0xfef5, 0x49c2, 0x38a5, 0xfeb0,
    0xfedf, 0x47ed, 0x3a95, 0xfeac, 0xfece, 0x4611, 0x3c85, 0xfeab, 0xfec0, 0x4430, 0x3e74, 0xfeac, 0xfeb6, 0x424a,
    0x4060, 0xfeaf, 0xfeaf, 0x4060, 0x424a, 0xfeb6, 0xfeac, 0x3e74, 0x4430, 0xfec0, 0xfeab, 0x3c85, 0x4611, 0xfece,
    0xfeac, 0x3a95, 0x47ed, 0xfedf, 0xfeb0, 0x38a5, 0x49c2, 0xfef5, 0xfeb6, 0x36b6, 0x4b91, 0xff0f, 0xfebd, 0x34c8,
    0x4d57, 0xff2e, 0xfec6, 0x32dc, 0x4f14, 0xff53, 0xfed0, 0x30f3, 0x50c7, 0xff7c, 0xfedb, 0x2f0d, 0x5270, 0xffac,
    0xfee8, 0x2d2c, 0x540d, 0xffe2, 0xfef4, 0x2b50, 0x559d, 0x001f, 0xff02, 0x297a, 0x5720, 0x0063, 0xff10, 0x27a9,
    0x5896, 0x00ae, 0xff1e, 0x25e0, 0x59fc, 0x0101, 0xff2c, 0x241e, 0x5b53, 0x015b, 0xff3a, 0x2264, 0x5c9a, 0x01be,
    0xff48, 0x20b3, 0x5dd0, 0x022a, 0xff56, 0x1f0b, 0x5ef5, 0x029f, 0xff64, 0x1d6c, 0x6007, 0x031c, 0xff71, 0x1bd7,
    0x6106, 0x03a4, 0xff7e, 0x1a4c, 0x61f3, 0x0435, 0xff8a, 0x18cb, 0x62cb, 0x04d1, 0xff96, 0x1756, 0x638f, 0x0577,
    0xffa1, 0x15eb, 0x643f, 0x0628, 0xffac, 0x148c, 0x64d9, 0x06e4, 0xffb6, 0x1338, 0x655e, 0x07ab, 0xffbf, 0x11f0,
    0x65cd, 0x087d, 0xffc8, 0x10b4, 0x6626, 0x095a, 0xffd0, 0x0f83, 0x6669, 0x0a44, 0xffd8, 0x0e5f, 0x6696, 0x0b39,
    0xffdf, 0x0d46, 0x66ad, 0x0c39,
  ].map((v) => ((v << 16) >> 16) / 32768),
);

const enum VoiceState {
  Playing,
  KeyOff,
  Dead,
}

class AdsrState {
  phase = 0; // 0 attack, 1 decay, 2 sustain, 3 release, 4 complete
  time = 0;
  releaseStart = 0;
  constructor(readonly a: Adsr) {}
  keyOff() {
    this.phase = this.a.release !== 0 ? 3 : 4;
    this.time = 0;
  }
  // amuse Envelope::advance
  advance(dt: number): number {
    const t = this.time;
    this.time += dt;
    switch (this.phase) {
      case 0:
        if (this.a.attack === 0 || t / this.a.attack >= 1) {
          this.phase = 1;
          this.time = 0;
          return (this.releaseStart = 1);
        }
        return (this.releaseStart = t / this.a.attack);
      case 1:
        if (this.a.decay === 0 || t / this.a.decay >= 1) {
          this.phase = 2;
          this.time = 0;
          return (this.releaseStart = this.a.sustain);
        }
        return (this.releaseStart = 1 - t / this.a.decay + (t / this.a.decay) * this.a.sustain);
      case 2:
        return this.a.sustain;
      case 3:
        if (this.a.release === 0 || t / this.a.release >= 1) {
          this.phase = 4;
          return 0;
        }
        return Math.min(this.releaseStart, 1 - t / this.a.release);
      default:
        return 0;
    }
  }
}

interface Frame {
  cmds: Uint8Array;
  id: number;
  pc: number;
}

class Channel {
  program = 0;
  page: PageEntry | undefined;
  volume = 1;
  pan = 0;
  ctrl = new Uint8Array(128);
  pitchWheel = 0;
  wheelRange = -1;
  rpn = 0;
  notes = new Map<number, Voice>();
  constructor(
    readonly synth: Synth,
    readonly id: number,
    setup: MidiSetup | undefined,
  ) {
    this.ctrl[7] = 127;
    this.ctrl[10] = 64;
    if (setup) {
      this.setProgram(setup.program);
      this.volume = setup.volume / 127;
      this.pan = setup.pan / 64 - 1;
      this.ctrl[91] = setup.reverb;
      this.ctrl[93] = setup.chorus;
    } else {
      this.setProgram(0);
    }
  }
  setProgram(p: number) {
    const g = this.synth.group;
    // Channel 10 would use drum pages, but this data has none, so fall back to normal pages.
    const page = (this.id === 9 ? g.drums.get(p) : undefined) ?? g.pages.get(p);
    if (page) {
      this.page = page;
      this.program = p;
    }
  }
}

class Voice {
  state = VoiceState.Playing;
  stack: Frame[] = [];
  macroDone = false;
  initKey: number;
  initVel: number;
  initMod: number;
  curVel: number;
  curMod: number;
  curPitch: number; // cents
  keyoff = false;
  sampleEnd = false;
  inWait = false;
  indefiniteWait = false;
  keyoffWait = false;
  sampleEndWait = false;
  waitCountdown = 0;
  execTime = 0;
  loopCountdown = -1;
  vars = new Int32Array(32);
  keyoffTrap: [number, number] | null = null;
  sampleEndTrap: [number, number] | null = null;
  volumeSelect: { ctrl: number; scale: number; combine: number; isVar: boolean }[] = [];
  adsr: AdsrState | null = null;
  velocity: number; // current (enveloped) velocity driving the volume
  velRamp: { time: number; dur: number; from: number; to: number } | null = null;
  vibrato = { time: -1, level: 0, modwheel: false, period: 0 };
  wheelUp = 200;
  wheelDown = 200;
  sustained = false;
  sustainKeyOff = false;

  smp: DecodedSample | null = null;
  pos = 0;
  frac = 0;
  step = 0;
  gainL = 0;
  gainR = 0;
  fresh = true;
  lastOut = 0;

  constructor(
    readonly synth: Synth,
    readonly chan: Channel,
    readonly note: number,
    vel: number,
    readonly pageObj: number,
    readonly serial: number,
  ) {
    this.initKey = note;
    this.initVel = vel;
    this.curVel = vel;
    this.velocity = vel;
    this.initMod = chan.ctrl[1];
    this.curMod = this.initMod;
    this.curPitch = note * 100;
    const cmds = synth.bank.macros.get(pageObj);
    if (cmds) this.stack.push({ cmds, id: pageObj, pc: 0 });
    else this.macroDone = true;
  }

  private jump(id: number, step: number) {
    const top = this.stack[this.stack.length - 1];
    if (id === top.id) top.pc = step;
    else {
      const cmds = this.synth.bank.macros.get(id);
      if (!cmds) return;
      this.stack.length = 0;
      this.stack.push({ cmds, id, pc: step });
    }
  }

  keyOff() {
    if (this.keyoffTrap) {
      this.jump(this.keyoffTrap[0], this.keyoffTrap[1]);
      this.inWait = false;
    } else this.macroKeyOff();
  }

  macroKeyOff() {
    if (this.state !== VoiceState.Playing) return;
    if (this.sustained) {
      this.sustainKeyOff = true;
      return;
    }
    this.state = VoiceState.KeyOff;
    this.adsr?.keyOff();
    this.keyoff = true;
  }

  setPedal(on: boolean) {
    if (this.sustained && !on && this.sustainKeyOff) {
      this.sustainKeyOff = false;
      this.sustained = false;
      this.macroKeyOff();
    }
    this.sustained = on;
  }

  private notifySampleEnd() {
    if (this.sampleEndTrap) {
      this.jump(this.sampleEndTrap[0], this.sampleEndTrap[1]);
      this.inWait = false;
    } else this.sampleEnd = true;
  }

  stopSample() {
    if (this.smp) this.synth.clickTail(this.lastOut * this.gainL, this.lastOut * this.gainR);
    this.smp = null;
  }

  // One SoundMacro command; returns true when the macro ends.
  private exec(c: Uint8Array, o: number): boolean {
    const i8 = (k: number) => (c[o + k] << 24) >> 24;
    const le16 = (k: number) => c[o + k] | (c[o + k + 1] << 8);
    const wait = (secs: number) => {
      this.waitCountdown = secs;
      this.indefiniteWait = false;
      this.keyoffWait = false;
      this.sampleEndWait = false;
      this.inWait = true;
    };
    const ticksPerSec = this.synth.ticksPerSec;
    switch (c[o]) {
      case 0x00: // End
      case 0x01: // Stop
        this.macroDone = true;
        return true;
      case 0x02: // SplitKey
        if (this.initKey >= i8(1)) this.jump(le16(2), le16(4));
        break;
      case 0x03: // SplitVel
        if (this.curVel >= i8(1)) this.jump(le16(2), le16(4));
        break;
      case 0x04: // WaitTicks
      case 0x07: {
        // WaitMs
        const ms = c[o] === 0x07 ? true : c[o + 5] !== 0;
        const amount = le16(6);
        if (amount !== 0xffff) {
          let secs = amount / (ms ? 1000 : ticksPerSec);
          if (c[o + 2]) secs = (this.synth.random() / (ms ? 1000 : ticksPerSec)) % secs;
          if (c[o + 4]) {
            if (secs <= this.execTime) break;
            secs -= this.execTime;
          }
          this.waitCountdown = secs;
          this.indefiniteWait = false;
        } else this.indefiniteWait = true;
        this.inWait = true;
        this.keyoffWait = c[o + 1] !== 0;
        this.sampleEndWait = c[o + 3] !== 0;
        break;
      }
      case 0x05: {
        // Loop
        if ((c[o + 1] && this.keyoff) || (c[o + 3] && this.sampleEnd)) {
          this.loopCountdown = -1;
          break;
        }
        let times = le16(6);
        if (c[o + 2] && times) times = this.synth.random() % times;
        if (this.loopCountdown === -1 && times !== 0xffff) this.loopCountdown = times;
        if (this.loopCountdown > 0 || times === 0xffff) {
          if (this.loopCountdown > 0) this.loopCountdown--;
          this.stack[this.stack.length - 1].pc = le16(4);
        } else this.loopCountdown = -1;
        break;
      }
      case 0x06: // Goto
        this.jump(le16(2), le16(4));
        break;
      case 0x0c: {
        // SetAdsr
        const a = this.synth.bank.adsr.get(le16(1));
        if (a) {
          this.adsr = new AdsrState(a);
          if (this.state === VoiceState.KeyOff) this.adsr.keyOff();
        }
        break;
      }
      case 0x0d: // ScaleVolume: volume from (original or current) velocity * scale / 127 + add
        this.velocity = clamp(Math.trunc(((c[o + 5] ? this.initVel : this.curVel) * i8(1)) / 127) + i8(2), 0, 127);
        this.velRamp = null;
        break;
      case 0x0f: // Envelope
      case 0x14: {
        // FadeIn
        const secs = le16(6) / (c[o + 5] ? 1000 : ticksPerSec);
        const target = clamp((((this.curVel * i8(1)) / 127) | 0) + i8(2), 0, 127);
        const from = c[o] === 0x14 ? 0 : this.velocity;
        if (secs <= 0) {
          this.velocity = target;
          this.velRamp = null;
        } else {
          this.velocity = from;
          this.velRamp = { time: 0, dur: secs, from, to: target };
        }
        break;
      }
      case 0x10: {
        // StartSample
        const s = this.synth.bank.sample(le16(1));
        this.stopSample();
        if (s) {
          let offset = (c[o + 4] | (c[o + 5] << 8) | (c[o + 6] << 16) | (c[o + 7] << 24)) >>> 0;
          const mode = c[o + 3];
          if (mode === 1) offset = Math.floor((offset * (127 - this.curVel)) / 127);
          else if (mode === 2) offset = Math.floor((offset * this.curVel) / 127);
          if (s.looped && offset > s.info.loopStart)
            offset = ((offset - s.info.loopStart) % s.loopLength) + s.info.loopStart;
          this.smp = s;
          this.pos = Math.min(offset, s.end);
          this.frac = 0;
          this.sampleEnd = false;
        }
        break;
      }
      case 0x11: // StopSample
        this.stopSample();
        break;
      case 0x12: // KeyOff
        this.macroKeyOff();
        break;
      case 0x13: // SplitRnd
        if (c[o + 1] <= this.synth.random() % 256) this.jump(le16(2), le16(4));
        break;
      case 0x17: {
        // RndNote
        let lo = i8(1);
        let hi = i8(3);
        if (c[o + 5]) {
          const cur = Math.floor(this.curPitch / 100);
          lo = cur - lo;
          hi = cur + hi;
        }
        lo *= 100;
        hi *= 100;
        this.curPitch = hi === lo ? hi : (this.synth.random() % (hi - lo)) + lo;
        if (!c[o + 4]) this.curPitch = Math.floor(this.curPitch / 100) * 100 + i8(2);
        break;
      }
      case 0x18: // AddNote
        this.curPitch = ((c[o + 3] ? this.initKey : Math.floor(this.curPitch / 100)) + i8(1)) * 100 + i8(2);
        if (le16(6)) wait(le16(6) / (c[o + 5] ? 1000 : ticksPerSec));
        break;
      case 0x19: // SetNote
        this.curPitch = i8(1) * 100 + i8(2);
        if (le16(6)) wait(le16(6) / (c[o + 5] ? 1000 : ticksPerSec));
        break;
      case 0x1a: // LastNote
        this.curPitch = (i8(1) + this.note) * 100 + i8(2);
        if (le16(6)) wait(le16(6) / (c[o + 5] ? 1000 : ticksPerSec));
        break;
      case 0x1c: {
        // Vibrato
        const period = le16(6) / (c[o + 5] ? 1000 : ticksPerSec);
        this.vibrato = { time: period ? 0 : -1, level: i8(1) * 100 + i8(2), modwheel: c[o + 3] !== 0, period };
        break;
      }
      case 0x24: // Return
        if (this.stack.length > 1) this.stack.pop();
        break;
      case 0x25: {
        // GoSub
        const top = this.stack[this.stack.length - 1];
        const cmds = this.synth.bank.macros.get(le16(2));
        if (cmds) this.stack.push({ cmds, id: le16(2), pc: le16(4) });
        else if (le16(2) === top.id) this.stack.push({ cmds: top.cmds, id: top.id, pc: le16(4) });
        break;
      }
      case 0x28: // TrapEvent
      case 0x29: {
        // UntrapEvent
        const trap: [number, number] | null = c[o] === 0x28 ? [le16(2), le16(4)] : null;
        if (c[o + 1] === 0) this.keyoffTrap = trap;
        else if (c[o + 1] === 1) this.sampleEndTrap = trap;
        break;
      }
      case 0x33: // PitchWheelR
        this.wheelUp = i8(1) * 100;
        this.wheelDown = i8(2) * 100;
        break;
      case 0x40: // VolSelect
        this.volumeSelect.push({
          ctrl: c[o + 1],
          scale: ((le16(2) << 16) >> 16) / 100 + i8(6) / 10000,
          combine: c[o + 4],
          isVar: c[o + 5] !== 0,
        });
        break;
      case 0x65: // SetVar
        if (!c[o + 1]) this.vars[c[o + 2] & 31] = (le16(4) << 16) >> 16;
        break;
      default:
        // Age counters, priorities and unsupported effects: no audible effect here.
        break;
    }
    return false;
  }

  // SoundMacro execution for `dt` seconds (amuse SoundMacroState::advance).
  runMacro(dt: number) {
    if (this.macroDone) return;
    for (let guard = 0; guard < 1024; guard++) {
      if (this.inWait) {
        if (this.keyoffWait && this.keyoff) this.inWait = false;
        else if (this.sampleEndWait && this.sampleEnd) this.inWait = false;
        else if (!this.indefiniteWait) {
          this.waitCountdown -= dt;
          if (this.waitCountdown < 0) this.inWait = false;
        }
        if (this.inWait) {
          this.execTime += dt;
          return;
        }
      }
      const top = this.stack[this.stack.length - 1];
      if (!top || top.pc < 0 || top.pc * 8 >= top.cmds.length) {
        this.macroDone = true;
        return;
      }
      const o = top.pc * 8;
      top.pc++;
      if (this.exec(top.cmds, o)) return;
    }
    this.execTime += dt;
  }

  // Control update for one frame: returns false when the voice is finished.
  control(dt: number): boolean {
    this.runMacro(dt);
    if (this.velRamp) {
      const r = this.velRamp;
      r.time += dt;
      const t = clamp(r.time / r.dur, 0, 1);
      this.velocity = r.from + (r.to - r.from) * t;
      if (r.time >= r.dur) this.velRamp = null;
    }
    const adsr = this.adsr ? this.adsr.advance(dt) : 1;
    if (this.adsr && this.adsr.phase === 4 && this.smp) {
      this.stopSample();
      this.notifySampleEnd();
    }
    if (this.vibrato.time >= 0) this.vibrato.time += dt;

    if (
      this.macroDone &&
      (!this.smp || this.state === VoiceState.KeyOff) &&
      !this.sampleEndTrap &&
      (!this.smp || (this.adsr !== null && this.adsr.phase === 4))
    )
      return false;
    if (this.macroDone && !this.smp) return false;

    let user = this.chan.volume;
    if (this.volumeSelect.length) {
      let v = 0;
      for (let i = 0; i < this.volumeSelect.length; i++) {
        const s = this.volumeSelect[i];
        const x = (s.isVar ? this.vars[s.ctrl & 31] : this.chan.ctrl[s.ctrl]) * s.scale;
        v = i === 0 || s.combine === 0 ? x : s.combine === 1 ? v + x : v * x;
      }
      user = clamp(v / 127, 0, 1);
    }
    const level = clamp(user * (this.velocity / 127) * adsr, 0, 1);
    const gain = this.smp ? lookupVolume(level) : 0;
    // Pan law of the N64 MusyX runtime (boot code 0x8001e0e8): piecewise linear through
    // 0, 0.7079 and 1 at pan 0, 64 and 128.
    const p = clamp((this.chan.pan + 1) * 64, 0, 128);
    const targetL = gain * panLaw(128 - p);
    const targetR = gain * panLaw(p);
    if (this.macroDone && gain < 1e-6 && this.gainL < 1e-6 && this.gainR < 1e-6) return false;
    this.targetL = targetL;
    this.targetR = targetR;

    if (this.smp) {
      let cents = this.curPitch;
      const vib = this.vibrato;
      if (vib.time >= 0 && vib.period > 0) {
        const tw = (vib.time / vib.period) % 1;
        const tri = tw < 0.25 ? tw / 0.25 : tw >= 0.75 ? (tw - 0.75) / 0.25 - 1 : ((tw - 0.25) / 0.5) * -2 + 1;
        cents += vib.modwheel ? vib.level * tri * (this.curMod / 127) : vib.level * tri;
      }
      const w = this.chan.pitchWheel;
      cents += w > 0 ? this.wheelUp * w : this.wheelDown * w;
      const ratio = Math.pow(2, (clamp(cents, 0, 12700) - this.smp.info.pitch * 100) / 1200);
      // RSP pitch is Q4.12.
      this.step = Math.min(0xffff, Math.round(((this.smp.info.rate * ratio) / OUTPUT_RATE) * 4096)) << 4;
    }
    return true;
  }

  targetL = 0;
  targetR = 0;

  render(outL: Float32Array, outR: Float32Array) {
    const s = this.smp;
    if (this.fresh) {
      this.gainL = this.targetL;
      this.gainR = this.targetR;
      this.fresh = false;
    }
    const n = FRAME;
    let gL = this.gainL;
    let gR = this.gainR;
    const dL = (this.targetL - gL) / n;
    const dR = (this.targetR - gR) / n;
    this.gainL = this.targetL;
    this.gainR = this.targetR;
    if (!s) return;
    const data = s.data;
    const end = s.end;
    const lut = RESAMPLE_LUT;
    let pos = this.pos;
    let frac = this.frac;
    const step = this.step;
    let v = 0;
    for (let i = 0; i < n; i++) {
      const k = (frac >>> 10) << 2;
      v = data[pos] * lut[k] + data[pos + 1] * lut[k + 1] + data[pos + 2] * lut[k + 2] + data[pos + 3] * lut[k + 3];
      gL += dL;
      gR += dR;
      outL[i] += v * gL;
      outR[i] += v * gR;
      const acc = frac + step;
      pos += acc >>> 16;
      frac = acc & 0xffff;
      if (pos >= end) {
        if (s.looped) {
          pos -= s.loopLength * Math.ceil((pos - end + 1) / s.loopLength);
        } else {
          this.lastOut = v;
          this.gainL = gL;
          this.gainR = gR;
          this.stopSample();
          this.notifySampleEnd();
          return;
        }
      }
    }
    this.pos = pos;
    this.frac = frac;
    this.lastOut = v;
  }
}

export class Synth {
  voices: Voice[] = [];
  channels: Channel[] = [];
  ticksPerSec: number;
  private serial = 0;
  private seed = 0x1234567;
  private dcL = 0;
  private dcR = 0;
  private pendL = 0;
  private pendR = 0;
  static readonly MAX_VOICES = 64;

  constructor(
    readonly bank: MusyxBank,
    readonly group: SongGroup,
    songId: number,
    tempo: number,
  ) {
    this.ticksPerSec = (tempo * 384) / 60;
    const setups = group.setups.get(songId);
    for (let i = 0; i < 16; i++) this.channels.push(new Channel(this, i, setups?.[i]));
  }

  random() {
    this.seed = (Math.imul(this.seed, 1103515245) + 12345) >>> 0;
    return this.seed >>> 8;
  }

  clickTail(l: number, r: number) {
    this.pendL += l;
    this.pendR += r;
  }

  private kill(v: Voice) {
    v.stopSample();
    v.state = VoiceState.Dead;
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    if (v.chan.notes.get(v.note) === v) v.chan.notes.delete(v.note);
  }

  event(e: SongEvent) {
    const ch = this.channels[e.chan];
    switch (e.kind) {
      case EV_NOTE_ON: {
        const old = ch.notes.get(e.a);
        if (old) {
          old.keyOff();
          ch.notes.delete(e.a);
        }
        const page = ch.page;
        if (!page) return;
        // Per-page polyphony limit, then a global cap: steal the oldest voice.
        const same = this.voices.filter((v) => v.pageObj === page.objId && v.chan === ch);
        if (page.maxVoices > 0 && same.length >= page.maxVoices) this.kill(same[0]);
        if (this.voices.length >= Synth.MAX_VOICES) this.kill(this.voices[0]);
        const v = new Voice(this, ch, e.a, e.b, page.objId, this.serial++);
        this.voices.push(v);
        ch.notes.set(e.a, v);
        break;
      }
      case EV_NOTE_OFF: {
        const v = ch.notes.get(e.a);
        if (v) {
          v.keyOff();
          ch.notes.delete(e.a);
        }
        break;
      }
      case EV_PROGRAM:
        ch.setProgram(e.a);
        break;
      case EV_PITCH:
        ch.pitchWheel = e.a / 8192;
        break;
      case EV_CC: {
        const val = e.b;
        ch.ctrl[e.a] = val;
        switch (e.a) {
          case 1:
            for (const v of this.voices) if (v.chan === ch) v.curMod = val;
            break;
          case 7:
            ch.volume = val / 127;
            break;
          case 10:
            ch.pan = val / 64 - 1;
            break;
          case 64:
            for (const v of this.voices) if (v.chan === ch) v.setPedal(val >= 64);
            break;
          case 100:
            ch.rpn = (ch.rpn & ~0x7f) | val;
            break;
          case 101:
            ch.rpn = (ch.rpn & ~0x3f80) | (val << 7);
            break;
          case 6:
            if (ch.rpn === 0) {
              ch.wheelRange = val;
              for (const v of this.voices) if (v.chan === ch) v.wheelUp = v.wheelDown = val * 100;
            }
            break;
        }
        break;
      }
    }
  }

  // Renders one 192-sample frame into outL/outR (which must be zeroed).
  frame(outL: Float32Array, outR: Float32Array) {
    const dt = FRAME / OUTPUT_RATE;
    for (let i = 0; i < this.voices.length; ) {
      const v = this.voices[i];
      if (v.fresh && v.chan.wheelRange >= 0) v.wheelUp = v.wheelDown = v.chan.wheelRange * 100;
      if (!v.control(dt)) {
        this.kill(v);
        continue;
      }
      v.render(outL, outR);
      i++;
    }
    // RSP click suppression: stopped voices leave their last output as a decaying offset.
    this.dcL = (this.dcL + this.pendL) * (0xf850 / 0x10000);
    this.dcR = (this.dcR + this.pendR) * (0xf850 / 0x10000);
    this.pendL = this.pendR = 0;
    if (Math.abs(this.dcL) > 0.5 || Math.abs(this.dcR) > 0.5) {
      for (let i = 0; i < FRAME; i++) {
        outL[i] += this.dcL;
        outR[i] += this.dcR;
      }
    }
  }
}

export interface RenderedSong {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
  loopStart: number;
  loopEnd: number;
  loops: boolean;
  noteCount: number;
}

// Renders a whole song (plus a loop tail) at 22050 Hz. `songId` selects the MIDI setup.
export function renderSong(bank: MusyxBank, groupId: number, songId: number, song: Uint8Array): RenderedSong {
  const group = bank.groups.get(groupId);
  if (!group) throw new Error(`MusyX: no song group ${groupId}`);
  const timing = expandSong(song);
  const synth = new Synth(bank, group, songId, u32(song, 16) & 0x7fffffff || 120);
  const frames = Math.ceil(timing.totalSamples / FRAME);
  const left = new Float32Array(frames * FRAME);
  const right = new Float32Array(frames * FRAME);
  const bufL = new Float32Array(FRAME);
  const bufR = new Float32Array(FRAME);
  const events = timing.events;
  let e = 0;
  let notes = 0;
  // Master gain calibrated against the game's own output (title screen, default MUSIC VOLUME):
  // stands in for the runtime's studio/music master volumes, which are set at run time.
  const scale = MASTER_GAIN / 32768;
  for (let f = 0; f < frames; f++) {
    const frameEnd = (f + 1) * FRAME;
    for (; e < events.length && events[e].sample < frameEnd; e++) {
      if (events[e].kind === EV_NOTE_ON) notes++;
      synth.event(events[e]);
    }
    bufL.fill(0);
    bufR.fill(0);
    synth.frame(bufL, bufR);
    const o = f * FRAME;
    for (let i = 0; i < FRAME; i++) {
      left[o + i] = clamp(bufL[i] * scale, -1, 1);
      right[o + i] = clamp(bufR[i] * scale, -1, 1);
    }
  }
  return {
    sampleRate: OUTPUT_RATE,
    left: left.subarray(0, timing.totalSamples),
    right: right.subarray(0, timing.totalSamples),
    loopStart: timing.loopStartSample,
    loopEnd: timing.loopEndSample,
    loops: timing.loops,
    noteCount: notes,
  };
}
