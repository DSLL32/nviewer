// The Legend of Zelda: Ocarina of Time and Majora's Mask: the Zelda revision of Nintendo EAD's sequence driver
// (ZELDA64.md §8), rendered offline. Same family as Star Fox 64 (sf64.ts) and Yoshi's Story (nas.ts): three-level
// scripts, soundfonts, a note pool with stealing, point-list ADSR, 3 driver updates per video frame and maxTempo 10770,
// but with the OoT opcode layout (channel arguments from sSeqInstructionArgsTable, 8 IO ports, dynamic tables, LDSEQ,
// RUNSEQ), sound-effect instruments, random variances, the OoT decay table and vibrato, and the "NEAD OoT/MM" RSP mixer
// as rsp-hle runs it: VADPCM and 2-bit SMALL_ADPCM, exact two-part resampling, HILOGAIN, the channel FIR filter with
// rsp-hle's in-place coefficient averaging, the comb filter, ENVMIXER with a doubled reverb send, and each audio spec's
// reverbs (downsample 2, leak, low-pass FIR). A `game` flag selects the Majora's Mask variants (§8.2).
//
// Ported from the research renderer (render/zdata.ts, zengine.ts, zsynth.ts), whose renders match audio captured from
// the game in 11 scenes of both games in pitch, tempo and level (§8.5). The port keeps its arithmetic sample for sample
// and only removes allocations from the per-update paths; loop points are taken at update rather than task resolution.
//
// Data (§8.1): Audiobank / Audioseq / Audiotable (dmadata files 3-5) and the decompressed `code` file, in which the four
// AudioTables are found by structure and every other table (pitch and bend tables, pan tables, default envelope, short
// note tables, filter data, gWaveSamples, gAudioSpecs) by signature. The same code serves the four ROMs; the debug PAL
// build of Majora's Mask plays with the NTSC constants like the others (its music data is the US data).
import type { DecodedMusic, MusicTrack } from '../types';
import { RESAMPLE_LUT } from './libultra';

export interface Zelda64Files { code: Uint8Array; audiobank: Uint8Array; audioseq: Uint8Array; audiotable: Uint8Array }

// One track of the list: `spec` = the audio spec the game plays it with (the first scene header that plays it, 10 for
// menus, else 0), `io` = sequence player IO ports the game sets before the start, `seconds` = a fixed length (with a
// fade-out) for sequences without a sequence-level loop that never end (the field logic).
export interface Zelda64Track { index: number; name: string; spec: number; io?: Record<number, number>; seconds?: number }

const RATE = 32000;
// The engine's own output level, clamp16(dry) / 32768: songs sit at -18 to -34 dBFS RMS (about 0.02-0.11), within the
// other games in the viewer (Star Fox 64 median 0.078, GoldenEye 0.095), so no boost.
const GAIN = 1;
const MAX_SECONDS = 600; // the Water Temple loops at 440 s
const LOOP_PASSES = 2; // intro + two passes; the loop is the second pass
const FADE_SECONDS = 4; // fixed-length renders fade out over their last seconds
const PCM_BLOCK = 1 << 20; // frames per output block while rendering

export function zelda64Music(files: () => Zelda64Files, game: 'oot' | 'mm', tracks: Zelda64Track[]): { tracks: MusicTrack[]; decode(index: number): DecodedMusic } {
  let data: AudioData | undefined;
  return {
    tracks: tracks.map(({ index, name }) => ({ index, name })),
    decode(index: number): DecodedMusic {
      const track = tracks.find((t) => t.index === index);
      if (!track) throw new Error(`No music track ${index}`);
      data ??= new AudioData(files(), game);
      return render(data, track);
    },
  };
}

// ---- ROM data ------------------------------------------------------------------------------------------------------

interface TableEntry { offset: number; size: number; sd1: number; sd2: number; sd3: number }
interface EnvRef { bytes: Uint8Array; off: number } // envelope in font data, code, or the sequence copy
interface Sample {
  codec: number; medium: number; size: number; data: number; // data: offset in Audiotable
  loopStart: number; loopEnd: number; loopCount: number; loopState: Int16Array | null; book: Int16Array;
  pcm?: SamplePcm;
}
// Decoded samples with the loop body appended: playback wraps at wrapAt by wrapLen, or ends at silentAt.
interface SamplePcm { buf: Int16Array; wrapAt: number; wrapLen: number; silentAt: number }
interface TunedSample { sample: Sample | null; tuning: number }
interface Instrument { rangeLo: number; rangeHi: number; decayIndex: number; envelope: EnvRef; low: TunedSample; normal: TunedSample; high: TunedSample }
interface Drum { decayIndex: number; pan: number; tunedSample: TunedSample; envelope: EnvRef }
interface Font { instruments: (Instrument | null)[]; drums: (Drum | null)[]; sfx: TunedSample[] }
interface ReverbSettings { downsampleRate: number; windowSize: number; decayRatio: number; volume: number; leakRtL: number; leakLtR: number; lpLeft: number; lpRight: number }
interface AudioSpec { numNotes: number; reverbs: ReverbSettings[] }

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const rd16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const rs16 = (b: Uint8Array, o: number) => (rd16(b, o) << 16) >> 16;
const f32 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset + o, 4).getFloat32(0);

class AudioData {
  readonly mm: boolean;
  readonly code: Uint8Array;
  readonly bank: Uint8Array;
  readonly seq: Uint8Array;
  readonly table: Uint8Array;
  readonly seqTable: TableEntry[];
  readonly fontTable: TableEntry[];
  readonly bankTable: TableEntry[];
  readonly seqFontMap: number; // u16 offset[numSeqs] (by requested id), then u8 count, u8 fontId[count]
  readonly pitch: Float32Array; // gPitchFrequencies, note 39 = 1.0
  readonly bendOctave: Float32Array; // index 128 = 1.0
  readonly bendTwo: Float32Array;
  readonly panDefault: Float32Array;
  readonly panStereo: Float32Array;
  readonly panHeadset: Float32Array;
  readonly defaultEnvelope: EnvRef;
  readonly shortVelocity: Uint8Array;
  readonly shortGate: Uint8Array;
  readonly waves: Int16Array[]; // gWaveSamples[0..8], 4 harmonics x 64 samples; [2] is the vibrato sine
  readonly lowPass: Int16Array; // 16 x 8
  readonly highPass: Int16Array; // 15 x 8
  readonly specs: AudioSpec[];
  private readonly fonts = new Map<number, Font>();
  private readonly samples = new Map<string, Sample>();

  constructor(files: Zelda64Files, game: 'oot' | 'mm') {
    this.mm = game === 'mm';
    const c = (this.code = files.code);
    this.bank = files.audiobank;
    this.seq = files.audioseq;
    this.table = files.audiotable;
    // The AudioTables {s16 count; s16; u32 0; 8 bytes 0; count x 16-byte entries} whose entries tile a file exactly:
    // more than 64 tiling Audioseq = sequences, tiling Audiobank = soundfonts, fewer than 16 tiling Audiotable = sample banks.
    const tiles = (o: number, n: number, size: number) => {
      let pos = 0, real = 0;
      for (let i = 0; i < n; i++) {
        const e = o + 16 + 16 * i, off = u32(c, e), sz = u32(c, e + 4);
        if (sz === 0) continue; // alias
        if (off < pos || off - pos > 0x100) return false;
        pos = off + sz;
        real++;
      }
      return real > 0 && size - pos >= 0 && size - pos <= 0x100;
    };
    let seqT = -1, fontT = -1, bankT = -1;
    for (let o = 0; o + 32 <= c.length; o += 4) {
      if (u32(c, o + 4) !== 0 || u32(c, o + 8) !== 0 || u32(c, o + 12) !== 0) continue;
      const n = rs16(c, o);
      if (n < 1 || n > 400 || o + 16 + 16 * n > c.length) continue;
      if (seqT < 0 && n > 64 && tiles(o, n, this.seq.length)) seqT = o;
      else if (fontT < 0 && tiles(o, n, this.bank.length)) fontT = o;
      else if (bankT < 0 && n < 16 && tiles(o, n, this.table.length)) bankT = o;
    }
    if (seqT < 0 || fontT < 0 || bankT < 0) throw new Error('Zelda audio tables not found');
    const readTable = (o: number): TableEntry[] => Array.from({ length: rs16(c, o) }, (_, i) => {
      const e = o + 16 + 16 * i;
      return { offset: u32(c, e), size: u32(c, e + 4), sd1: rd16(c, e + 10), sd2: rd16(c, e + 12), sd3: rd16(c, e + 14) };
    });
    this.seqTable = readTable(seqT);
    this.fontTable = readTable(fontT);
    this.bankTable = readTable(bankT);
    this.seqFontMap = fontT + 16 + 16 * this.fontTable.length;
    const fw = (v: number) => {
      const d = new DataView(new ArrayBuffer(4));
      d.setFloat32(0, v);
      return d.getUint32(0);
    };
    const findWords = (words: number[], name: string, align = 4) => {
      outer: for (let o = 0; o + 4 * words.length <= c.length; o += align) {
        for (let k = 0; k < words.length; k++) if (u32(c, o + 4 * k) !== words[k]) continue outer;
        return o;
      }
      throw new Error(`Zelda audio: ${name} not found`);
    };
    const f32s = (o: number, n: number) => Float32Array.from({ length: n }, (_, i) => f32(c, o + 4 * i));
    this.pitch = f32s(findWords([fw(0.105112), fw(0.111362), fw(0.117984)], 'gPitchFrequencies'), 128);
    const oct = findWords([fw(0.5), fw(0.5), fw(0.502736)], 'gBendPitchOneOctaveFrequencies');
    this.bendOctave = f32s(oct, 256);
    this.bendTwo = f32s(oct + 0x400, 256);
    if (Math.abs(this.bendOctave[128] - 1) > 1e-6 || Math.abs(this.bendTwo[128] - 1) > 1e-6) throw new Error('Zelda audio: bend tables');
    this.panHeadset = f32s(findWords([fw(1.0), fw(0.995386), fw(0.990772)], 'gHeadsetPanVolume'), 128);
    this.panStereo = f32s(findWords([fw(0.707), fw(0.716228), fw(0.725457)], 'gStereoPanVolume'), 128);
    this.panDefault = f32s(findWords([fw(1.0), fw(0.999924), fw(0.999694)], 'gDefaultPanVolume'), 128);
    this.defaultEnvelope = { bytes: c, off: findWords([0x00017d00, 0x03e87d00, 0xffff0000], 'gDefaultEnvelope') };
    const sv = findWords([0x0c192633, 0x3940474c], 'gDefaultShortNoteVelocityTable', 1);
    this.shortVelocity = c.slice(sv, sv + 16);
    this.shortGate = c.slice(sv + 16, sv + 32);
    if (this.shortGate[0] !== 229) throw new Error('Zelda audio: gate table');
    const lp = findWords([0, 0x00007fff, 0, 0, 0x0f0e105c], 'gLowPassFilterData');
    this.lowPass = Int16Array.from({ length: 128 }, (_, i) => rs16(c, lp + 2 * i));
    this.highPass = Int16Array.from({ length: 120 }, (_, i) => rs16(c, lp + 256 + 2 * i));
    // gWaveSamples: 9 pointers into code, the last two equal; [0] = the sawtooth {0, 1023, 2047, 3071, ...}.
    const saw = findWords([0x000003ff, 0x07ff0bff], 'gSawtoothWaveSample');
    let base = -1, wp = -1;
    for (let o = 0; o + 36 <= c.length && base < 0; o += 4) {
      const w0 = u32(c, o);
      if (w0 >>> 24 !== 0x80 || u32(c, o + 28) !== u32(c, o + 32)) continue;
      const b0 = w0 - saw;
      let ok = true;
      for (let k = 1; k < 9 && ok; k++) {
        const p = u32(c, o + 4 * k) - b0;
        ok = p > saw && p < c.length;
      }
      if (ok) [base, wp] = [b0, o];
    }
    if (base < 0) throw new Error('Zelda audio: gWaveSamples not found');
    this.waves = Array.from({ length: 9 }, (_, k) => {
      const p = u32(c, wp + 4 * k) - base;
      return Int16Array.from({ length: 256 }, (_, i) => rs16(c, p + 2 * i));
    });
    // gAudioSpecs: >= 16 records of 0x38 {u32 32000|22050; u8 1, numNotes, numSeqPlayers, 0, 0, numReverbs; ptr reverbs}.
    const isSpec = (o: number) => {
      const r = u32(c, o), p = u32(c, o + 12) - base;
      return (r === 32000 || r === 22050) && c[o + 4] === 1 && c[o + 5] >= 8 && c[o + 5] <= 32 && c[o + 6] >= 2 && c[o + 6] <= 5
        && c[o + 9] >= 1 && c[o + 9] <= 3 && p > 0 && p < c.length;
    };
    let specs = -1, count = 0;
    for (let o = 0; o + 0x38 * 16 <= c.length && specs < 0; o += 4) {
      let n = 0;
      while (o + 0x38 * (n + 1) <= c.length && isSpec(o + 0x38 * n)) n++;
      if (n >= 16) [specs, count] = [o, n];
    }
    if (specs < 0) throw new Error('Zelda audio: gAudioSpecs not found');
    // ReverbSettings (0x18): u8 downsampleRate; u16 windowSize, decayRatio, subDelay, subVolume, volume, leakRtl, leakLtr;
    // s8 mixReverbIndex; u16 mixReverbStrength; s16 lowPassCutoffLeft, lowPassCutoffRight.
    this.specs = Array.from({ length: count }, (_, i) => {
      const o = specs + 0x38 * i, rp = u32(c, o + 12) - base;
      const reverbs = Array.from({ length: c[o + 9] }, (_, k): ReverbSettings => {
        const q = rp + 0x18 * k;
        return {
          downsampleRate: c[q], windowSize: rd16(c, q + 2), decayRatio: rd16(c, q + 4), volume: rd16(c, q + 10),
          leakRtL: rd16(c, q + 12), leakLtR: rd16(c, q + 14), lpLeft: rs16(c, q + 20), lpRight: rs16(c, q + 22),
        };
      });
      return { numNotes: c[o + 5], reverbs };
    });
  }

  // AudioLoad_GetRealTableIndex: an entry of size 0 is an alias whose offset is the real index.
  realIndex(t: TableEntry[], i: number) {
    return t[i].size === 0 ? t[i].offset : i;
  }

  // A private copy: scripts write into their sequence.
  sequenceData(id: number): Uint8Array {
    const e = this.seqTable[this.realIndex(this.seqTable, id)];
    return this.seq.slice(e.offset, e.offset + e.size);
  }

  // Fonts of a sequence, by the id as requested (aliases have their own row); the default font is the last.
  fontsForSequence(id: number): number[] {
    const c = this.code, o = this.seqFontMap + rd16(c, this.seqFontMap + 2 * id);
    return Array.from(c.subarray(o + 1, o + 1 + c[o]));
  }

  // Font: u32 drumList; u32 sfxList; u32 instrument[numInstruments]. shortData1 = sample banks, 2 = counts, 3 = sfx.
  font(id: number): Font {
    const cached = this.fonts.get(id);
    if (cached) return cached;
    const e = this.fontTable[id], b = this.bank, base = e.offset;
    const bank1 = e.sd1 >> 8, bank2 = e.sd1 & 0xff, nInst = e.sd2 >> 8, nDrum = e.sd2 & 0xff, nSfx = e.sd3;
    const tuned = (o: number): TunedSample => ({ sample: this.sample(base, u32(b, base + o), bank1, bank2), tuning: f32(b, base + o + 4) });
    const none = (): TunedSample => ({ sample: null, tuning: 0 }); // compared by identity, like every TunedSample
    const drumList = u32(b, base), sfxList = u32(b, base + 4);
    const drums = drumList && nDrum ? Array.from({ length: nDrum }, (_, i): Drum | null => {
      const d = u32(b, base + drumList + 4 * i);
      return d ? { decayIndex: b[base + d], pan: b[base + d + 1], tunedSample: tuned(d + 4), envelope: { bytes: b, off: base + u32(b, base + d + 12) } } : null;
    }) : [];
    const sfx = sfxList && nSfx ? Array.from({ length: nSfx }, (_, i) => (u32(b, base + sfxList + 8 * i) ? tuned(sfxList + 8 * i) : none())) : [];
    const instruments = Array.from({ length: Math.min(nInst, 126) }, (_, i): Instrument | null => {
      const o = u32(b, base + 8 + 4 * i);
      if (!o) return null;
      const lo = b[base + o + 1], hi = b[base + o + 2];
      return {
        rangeLo: lo, rangeHi: hi, decayIndex: b[base + o + 3], envelope: { bytes: b, off: base + u32(b, base + o + 4) },
        low: lo !== 0 ? tuned(o + 8) : none(), normal: tuned(o + 16), high: hi !== 0x7f ? tuned(o + 24) : none(),
      };
    });
    const font = { instruments, drums, sfx };
    this.fonts.set(id, font);
    return font;
  }

  // Sample header (font-relative): u32 bits {codec 30..28, medium 27..26, size 23..0}; u32 offset in its sample bank
  // (medium 0 = the font's first bank, 1 = its second); u32 loop; u32 book.
  private sample(base: number, so: number, bank1: number, bank2: number): Sample | null {
    if (!so) return null;
    const b = this.bank, h = base + so, w = u32(b, h);
    const medium = (w >>> 26) & 3, codec = (w >>> 28) & 7;
    const data = this.bankTable[this.realIndex(this.bankTable, medium === 0 ? bank1 : bank2)].offset + u32(b, h + 4);
    const key = `${data}:${codec}`;
    const cached = this.samples.get(key);
    if (cached) return cached;
    const loop = base + u32(b, h + 8), book = base + u32(b, h + 12);
    const loopCount = u32(b, loop + 8) | 0;
    const s: Sample = {
      codec, medium, size: w & 0xffffff, data, loopStart: u32(b, loop), loopEnd: u32(b, loop + 4), loopCount,
      loopState: loopCount !== 0 ? Int16Array.from({ length: 16 }, (_, k) => rs16(b, loop + 16 + 2 * k)) : null,
      book: Int16Array.from({ length: 8 * u32(b, book) * u32(b, book + 4) }, (_, k) => rs16(b, book + 8 + 2 * k)),
    };
    this.samples.set(key, s);
    return s;
  }

  // Decoded PCM with the loop body appended; the loop restarts from the stored predictor state of the frame holding
  // loopStart, as the RSP does after A_LOOP. Codec 0 = VADPCM (9-byte frames), 3 = SMALL_ADPCM (5-byte, 2-bit).
  prepare(s: Sample): SamplePcm {
    if (s.pcm) return s.pcm;
    const two = s.codec === 3, fsz = two ? 5 : 9;
    const frames = Math.floor(s.size / fsz);
    const t = this.table, book = s.book, res = new Int32Array(16);
    const decode = (f: number, hist: Int16Array, out: Int16Array, at: number) => {
      const pos = s.data + f * fsz;
      const code = t[pos], scale = code >> 4, cb = (code & 15) * 16;
      if (two) {
        const rs = scale < 14 ? 14 - scale : 0;
        for (let i = 0; i < 4; i++) {
          const v = t[pos + 1 + i];
          res[4 * i] = ((((v & 0xc0) << 8) << 16) >> 16) >> rs;
          res[4 * i + 1] = ((((v & 0x30) << 10) << 16) >> 16) >> rs;
          res[4 * i + 2] = ((((v & 0x0c) << 12) << 16) >> 16) >> rs;
          res[4 * i + 3] = ((((v & 0x03) << 14) << 16) >> 16) >> rs;
        }
      } else {
        const rs = scale < 12 ? 12 - scale : 0;
        for (let i = 0; i < 8; i++) {
          const v = t[pos + 1 + i];
          res[2 * i] = ((((v & 0xf0) << 8) << 16) >> 16) >> rs;
          res[2 * i + 1] = ((((v & 0x0f) << 12) << 16) >> 16) >> rs;
        }
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
      out.set(hist, at);
    };
    const pcm = new Int16Array(frames * 16);
    const hist = new Int16Array(16);
    for (let f = 0; f < frames; f++) decode(f, hist, pcm, f * 16);
    const loopLen = s.loopEnd - s.loopStart;
    if (s.loopCount !== 0 && loopLen > 0 && s.loopState) {
      const body = new Int16Array(loopLen);
      const h2 = s.loopState.slice();
      let n = 0;
      for (let i = s.loopStart & 15; i < 16 && n < loopLen; i++) body[n++] = h2[i];
      const fr = new Int16Array(16);
      for (let f = (s.loopStart >> 4) + 1; n < loopLen; f++) {
        if (f < frames) decode(f, h2, fr, 0);
        else fr.fill(0);
        for (let i = 0; i < 16 && n < loopLen; i++) body[n++] = fr[i];
      }
      const buf = new Int16Array(s.loopEnd + loopLen + 4);
      buf.set(pcm.subarray(0, Math.min(pcm.length, s.loopEnd)));
      buf.set(body, s.loopEnd);
      for (let i = 0; i < 4; i++) buf[s.loopEnd + loopLen + i] = body[i % loopLen];
      s.pcm = { buf, wrapAt: s.loopEnd + loopLen, wrapLen: loopLen, silentAt: Infinity };
    } else {
      const end = Math.min(pcm.length, s.loopEnd || pcm.length);
      const buf = new Int16Array(end + 4);
      buf.set(pcm.subarray(0, end));
      s.pcm = { buf, wrapAt: Infinity, wrapLen: 0, silentAt: end };
    }
    return s.pcm;
  }
}

// ---- engine state (decomp audio structs) ----------------------------------------------------------------------------

const clamp16 = (v: number) => (v > 32767 ? 32767 : v < -32768 ? -32768 : v);
const s8 = (v: number) => (v << 24) >> 24;
const s16 = (v: number) => (v << 16) >> 16;
const u8 = (v: number) => v & 0xff;
const u16 = (v: number) => v & 0xffff;
const fround = Math.fround;
const LUT = RESAMPLE_LUT; // a local binding: imported bindings can be getters, too slow for the per-sample loops
const envS16 = (e: EnvRef, o: number) => s16((e.bytes[e.off + o] << 8) | e.bytes[e.off + o + 1]);
const sampleFor = (i: Instrument, note: number) => (note < i.rangeLo ? i.low : note <= i.rangeHi ? i.normal : i.high);

const UPDATES = 3; // driver updates per audio task (one video frame at 60 Hz)
const AI_FREQ = 32006; // osAiSetFrequency(32000) on NTSC
const MAX_TEMPO = Math.trunc(fround(fround(UPDATES * fround(2880000)) / 48 / fround(fround(1000 * fround(1.00278)) / 60))); // 10770
const TEMPO_TO_TICKS = fround(fround(fround(fround(60) * UPDATES) / AI_FREQ) / MAX_TEMPO); // zero-length notes
const INV_UPDATES = fround(1 / UPDATES);
const DELAY_SCALE = UPDATES / 4; // envelope delays x 0.75
// Release rates by decay index (AudioHeap_InitAdsrDecayTable).
const DECAY_TABLE = (() => {
  const t = new Float32Array(256), f = (x: number) => fround(fround(256 * fround(fround(1 / 256) / UPDATES)) / fround(x));
  t[255] = f(0.25); t[254] = f(0.33); t[253] = f(0.5); t[252] = f(0.66); t[251] = f(0.75);
  for (let i = 128; i < 251; i++) t[i] = f(251 - i);
  for (let i = 16; i < 128; i++) t[i] = f(4 * (143 - i));
  for (let i = 1; i < 16; i++) t[i] = f(60 * (23 - i));
  return t;
})();

// Intrusive doubly linked lists (AudioListItem); a list head's `pool` names the note pool that owns it.
class Item<T> {
  prev: Item<T> | null = null;
  next: Item<T> | null = null;
  value: T | null = null;
  pool: Pool | null = null;
}
const listHead = <T>(pool: Pool | null) => {
  const h = new Item<T>();
  h.prev = h.next = h;
  h.pool = pool;
  return h;
};
function pushBack<T>(l: Item<T>, it: Item<T>) {
  if (it.prev !== null) return;
  l.prev!.next = it; it.prev = l.prev; it.next = l; l.prev = it; it.pool = l.pool;
}
function pushFront<T>(l: Item<T>, it: Item<T>) {
  if (it.prev !== null) return;
  it.prev = l; it.next = l.next; l.next!.prev = it; l.next = it; it.pool = l.pool;
}
function popBack<T>(l: Item<T>): T | null {
  const it = l.prev!;
  if (it === l) return null;
  it.prev!.next = l; l.prev = it.prev; it.prev = null;
  return it.value;
}
function removeItem<T>(it: Item<T>) {
  if (it.prev === null) return;
  it.prev.next = it.next; it.next!.prev = it.prev; it.prev = null;
}
class Pool {
  disabled = listHead<Note>(this);
  decaying = listHead<Note>(this);
  releasing = listHead<Note>(this);
  active = listHead<Note>(this);
}

interface Script { pc: number; stack: number[]; rem: number[]; depth: number; value: number }
const newScript = (): Script => ({ pc: 0, stack: [0, 0, 0, 0], rem: [0, 0, 0, 0], depth: 0, value: 0 });
interface Adsr { envelope: EnvRef; decayIndex: number; sustain: number }
interface Vibrato { rateTarget: number; rateStart: number; depthTarget: number; depthStart: number; rateChangeDelay: number; depthChangeDelay: number; delay: number }
const newVibrato = (): Vibrato => ({ rateTarget: 0x800, rateStart: 0x800, depthTarget: 0, depthStart: 0, rateChangeDelay: 0, depthChangeDelay: 0, delay: 0 });
interface Portamento { mode: number; cur: number; speed: number; extent: number }

class Layer {
  item = new Item<Layer>();
  enabled = false; finished = false; muted = false; continuousNotes = false; bit3 = false; ignoreDrumPan = false; bit1 = false;
  notePropertiesNeedInit = false; stereo = 0; instOrWave = 0xff; gateTime = 0x80; semitone = 0; portamentoTargetNote = 0;
  pan = 0x40; notePan = 0; delay = 0; gateDelay = 0; delay2 = 0; portamentoTime = 0; transposition = 0;
  shortNoteDefaultDelay = 0; lastDelay = 0; adsr: Adsr; portamento: Portamento = { mode: 0, cur: 0, speed: 0, extent: 0 };
  note: Note | null = null; freqScale = 1; bend = 1; velocitySquare = 0; velocitySquare2 = 0; noteFreqScale = 0; noteVelocity = 0;
  instrument: Instrument | null = null; tunedSample: TunedSample | null = null; channel: Channel | null = null; script = newScript();
  targetReverbVol = 0; surroundEffectIndex = 0x80; unk0A = 0xffff; vibrato = newVibrato(); // MM
  constructor(env: EnvRef) {
    this.item.value = this;
    this.adsr = { envelope: env, decayIndex: 0, sustain: 0 };
  }
}

class Channel {
  enabled = false; finished = false; stopScript = false; muted = false; hasInstrument = false; stereoHeadsetEffects = false;
  largeNotes = false; bookOffset = 0; stereo = 0; changeVolume = true; changeFreq = true; changePan = true; newPan = 0x40;
  panChannelWeight = 0x80; velocityRandomVariance = 0; gateTimeRandomVariance = 0; reverbIndex = 0; targetReverbVol = 0;
  gain = 0; notePriority = 3; releasedPriority = 1; delay = 0; adsr: Adsr; vibrato = newVibrato(); filter: Int16Array | null = null;
  filterSeqOff = 0; combFilterGain = 0; combFilterSize = 0; volume = 1; volumeScale = 1; freqScale = 1; appliedVolume = 0;
  pan = 0; transposition = 0; io = new Int8Array(8).fill(-1); notePool = new Pool(); fontId = 0; muteBehavior = 0;
  noteAllocPolicy = 0; instOrWave = 0; instrument: Instrument | null = null; dynTable = 0; unk22 = 0;
  layers: (Layer | null)[] = [null, null, null, null]; script = newScript();
  surroundEffectIndex = 0xff; startSamplePos = 0; // MM
  constructor(readonly player: Player, readonly index: number, env: EnvRef) {
    this.adsr = { envelope: env, decayIndex: 0xf0, sustain: 0 };
  }
}

class Player {
  enabled = false; finished = false; muted = false; stopScript = false; recalculateVolume = false;
  seq: Uint8Array = new Uint8Array(0); defaultFont = 0xff; state = 1; fadeTimer = 0; storedFadeTimer = 0;
  tempo = 120 * 48; tempoAcc = 0; tempoChange = 0; transposition = 0; delay = 0; fadeVolume = 1; fadeVelocity = 0;
  muteVolumeScale = 0.5; fadeVolumeScale = 1; appliedFadeVolume = 1; noteAllocPolicy = 0; muteBehavior = 0x20 | 0x40;
  shortVelocity: [Uint8Array, number]; shortGate: [Uint8Array, number]; scriptCounter = 0;
  io = new Int8Array(8).fill(-1); channels: Channel[] = []; script = newScript(); notePool = new Pool(); fonts: number[] = [];
  constructor(a: AudioData) {
    this.shortVelocity = [a.shortVelocity, 0];
    this.shortGate = [a.shortGate, 0];
  }
}

interface AdsrState { action: number; state: number; envIndex: number; delay: number; sustain: number; velocity: number; fadeOutVel: number; current: number; target: number; envelope: EnvRef }

// NoteSampleState: what the synthesis reads for one update (snapshotted per update).
interface SampleState {
  enabled: boolean; needsInit: boolean; finished: boolean; strongRight: boolean; strongLeft: boolean; headsetFx: boolean;
  headsetPanFx: boolean; isSyntheticWave: boolean; hasTwoParts: boolean; useHaas: boolean; reverbIndex: number; bookOffset: number;
  gain: number; reverbVol: number; filter: Int16Array | null; combFilterSize: number; combFilterGain: number;
  targetVolLeft: number; targetVolRight: number; resampleRate: number; tuned: TunedSample | null; wave: Int16Array | null; waveOff: number;
  harmonicCurPrev: number;
}
const newSampleState = (): SampleState => ({
  enabled: false, needsInit: false, finished: false, strongRight: false, strongLeft: false, headsetFx: false, headsetPanFx: false,
  isSyntheticWave: false, hasTwoParts: false, useHaas: false, reverbIndex: 0, bookOffset: 0, gain: 0, reverbVol: 0, filter: null,
  combFilterSize: 0, combFilterGain: 0, targetVolLeft: 0, targetVolRight: 0, resampleRate: 0, tuned: null, wave: null,
  waveOff: 0, harmonicCurPrev: 0,
});
function copySampleState(out: SampleState, s: SampleState) {
  out.enabled = s.enabled; out.needsInit = s.needsInit; out.finished = s.finished; out.strongRight = s.strongRight;
  out.strongLeft = s.strongLeft; out.headsetFx = s.headsetFx; out.headsetPanFx = s.headsetPanFx; out.isSyntheticWave = s.isSyntheticWave;
  out.hasTwoParts = s.hasTwoParts; out.useHaas = s.useHaas; out.reverbIndex = s.reverbIndex; out.bookOffset = s.bookOffset;
  out.gain = s.gain; out.reverbVol = s.reverbVol; out.filter = s.filter; out.combFilterSize = s.combFilterSize;
  out.combFilterGain = s.combFilterGain; out.targetVolLeft = s.targetVolLeft; out.targetVolRight = s.targetVolRight;
  out.resampleRate = s.resampleRate; out.tuned = s.tuned; out.wave = s.wave; out.waveOff = s.waveOff; out.harmonicCurPrev = s.harmonicCurPrev;
}

// Note attributes as processNotes hands them to the sample state.
interface NoteAttributes { freqScale: number; velocity: number; pan: number; reverb: number; stereo: number; gain: number; filter: Int16Array | null; combFilterSize: number; combFilterGain: number }

class Note {
  item = new Item<Note>();
  priority = 0; playbackState = 0; parentLayer: Layer | null = null; prevParentLayer: Layer | null = null; wantedParentLayer: Layer | null = null;
  adsr: AdsrState; portamento: Portamento = { mode: 0, cur: 0, speed: 0, extent: 0 }; portamentoFreqScale = 1; vibratoFreqScale = 1;
  vib = { active: false, time: 0, depth: 0, rate: 0, depthChangeTimer: 0, rateChangeTimer: 0, delay: 0, sub: null as Vibrato | null };
  attrs: NoteAttributes = { freqScale: 0, velocity: 0, pan: 0, reverb: 0, stereo: 0, gain: 0, filter: null, combFilterSize: 0, combFilterGain: 0 };
  harmonicIndex = 0; startSamplePos = 0; stereoHeadsetEffects = false;
  sample = newSampleState();
  // synthesis state (NoteSynthesisState)
  pos = 0; frac = 0; curVolLeft = 0; curVolRight = 0; reverbVol = 0;
  resHist = new Int16Array(4); resAcc = 0; firPrev = new Int16Array(8); firCoef = new Int16Array(8); comb = new Int16Array(256); combNeedsInit = true;
  constructor(env: EnvRef) {
    this.item.value = this;
    this.adsr = { action: 0, state: 0, envIndex: 0, delay: 0, sustain: 0, velocity: 0, fadeOutVel: 0, current: 0, target: 0, envelope: env };
  }
}

// ---- driver: notes, envelopes, vibrato (playback.c, effects.c) -----------------------------------------------------

class Engine {
  readonly mm: boolean;
  readonly notes: Note[] = [];
  readonly numNotes: number;
  readonly free = new Pool();
  readonly layerFreeList = listHead<Layer>(null);
  readonly player: Player;
  readonly snaps: SampleState[][]; // [update][note]
  rand = 0x12345678; // a fixed LCG: random choices are reproducible, not the game's
  onSeqBackJump: (target: number) => void = () => {};
  private readonly at: NoteAttributes = { freqScale: 0, velocity: 0, pan: 0, reverb: 0, stereo: 0, gain: 0, filter: null, combFilterSize: 0, combFilterGain: 0 };

  constructor(readonly a: AudioData, numNotes: number) {
    this.mm = a.mm;
    this.numNotes = numNotes;
    for (let i = 0; i < numNotes; i++) {
      const n = new Note(a.defaultEnvelope);
      this.notes.push(n);
      pushBack(this.free.disabled, n.item);
    }
    for (let i = 0; i < 64; i++) pushBack(this.layerFreeList, new Layer(a.defaultEnvelope).item);
    this.player = new Player(a);
    for (let i = 0; i < 16; i++) this.player.channels.push(new Channel(this.player, i, a.defaultEnvelope));
    this.snaps = Array.from({ length: UPDATES }, () => Array.from({ length: numNotes }, newSampleState));
  }

  adsrUpdate(ad: AdsrState): number {
    const st = ad.state;
    sw: switch (st) {
      case 0: return 0;
      case 1: if (ad.action & 0x40) { ad.state = 5; break; } // hang
      // falls through
      case 2: ad.envIndex = 0; ad.state = 3;
      // falls through
      case 3: {
        for (let guard = 0; ; guard++) {
          if (guard > 64) { ad.state = 5; break sw; }
          ad.delay = envS16(ad.envelope, 4 * ad.envIndex);
          if (ad.delay === 0) { ad.state = 0; break; }
          if (ad.delay === -1) { ad.state = 5; break; }
          if (ad.delay === -2) { ad.envIndex = envS16(ad.envelope, 4 * ad.envIndex + 2); continue; }
          if (ad.delay === -3) { ad.state = 1; break; }
          ad.delay = s16(Math.trunc(fround(ad.delay * DELAY_SCALE)));
          if (ad.delay === 0) ad.delay = 1;
          const t = fround(envS16(ad.envelope, 4 * ad.envIndex + 2) / 32767);
          ad.target = fround(t * t);
          ad.velocity = fround((ad.target - ad.current) / ad.delay);
          ad.state = 4;
          ad.envIndex++;
          break;
        }
        if (ad.state !== 4) break;
      }
      // falls through
      case 4:
        ad.current = fround(ad.current + ad.velocity);
        ad.delay = s16(ad.delay - 1);
        if (ad.delay <= 0) ad.state = 3;
        break;
      case 5: break;
      case 6: case 7:
        ad.current = fround(ad.current - ad.fadeOutVel);
        if (ad.sustain !== 0 && st === 6) {
          if (ad.current < ad.sustain) { ad.current = ad.sustain; ad.delay = 128; ad.state = 8; }
          break;
        }
        if (ad.current < 0.00001) { ad.current = 0; ad.state = 0; }
        break;
      case 8: ad.delay = s16(ad.delay - 1); if (ad.delay === 0) ad.state = 7; break;
    }
    if (ad.action & 0x20) { ad.state = 6; ad.action &= ~0x20; }
    if (ad.action & 0x10) { ad.state = 7; ad.action &= ~0x10; }
    return ad.current < 0 ? 0 : ad.current > 1 ? 1 : ad.current;
  }

  vibratoInit(n: Note) {
    const L = n.parentLayer!, v = n.vib;
    n.vibratoFreqScale = 1;
    v.active = true;
    v.time = 0;
    const s = (v.sub = this.mm && !(L.unk0A & 0x1000) ? L.vibrato : L.channel!.vibrato);
    if ((v.depthChangeTimer = s.depthChangeDelay) === 0) v.depth = s.depthTarget; else v.depth = s.depthStart;
    if ((v.rateChangeTimer = s.rateChangeDelay) === 0) v.rate = s.rateTarget; else v.rate = s.rateStart;
    v.delay = s.delay;
  }

  // Portamento (u16 accumulator into the one-octave bend table) and vibrato: 1 / ((d - 1/d) * pitch / 65536 + 1/d).
  vibratoUpdate(n: Note) {
    if (n.portamento.mode !== 0) {
      const p = n.portamento;
      p.cur = u16(p.cur + p.speed);
      let idx = (p.cur >> 8) & 0xff;
      if (idx >= 127) { idx = 127; p.mode = 0; }
      n.portamentoFreqScale = fround(1 + p.extent * (this.a.bendOctave[idx + 128] - 1));
    }
    const v = n.vib;
    if (!v.active) return;
    if (v.delay !== 0) { v.delay--; n.vibratoFreqScale = 1; return; }
    const s = v.sub!;
    if (v.depthChangeTimer) {
      if (v.depthChangeTimer === 1) v.depth = s.depthTarget;
      else v.depth = fround(v.depth + Math.trunc((s.depthTarget - v.depth) / v.depthChangeTimer));
      v.depthChangeTimer--;
    } else if (s.depthTarget !== Math.trunc(v.depth)) {
      if ((v.depthChangeTimer = s.depthChangeDelay) === 0) v.depth = s.depthTarget;
    }
    if (v.rateChangeTimer) {
      if (v.rateChangeTimer === 1) v.rate = s.rateTarget;
      else v.rate = fround(v.rate + Math.trunc((s.rateTarget - v.rate) / v.rateChangeTimer));
      v.rateChangeTimer--;
    } else if (s.rateTarget !== Math.trunc(v.rate)) {
      if ((v.rateChangeTimer = s.rateChangeDelay) === 0) v.rate = s.rateTarget;
    }
    if (v.depth === 0) { n.vibratoFreqScale = 1; return; }
    v.time = (v.time + Math.trunc(v.rate)) | 0;
    const pc = fround(this.a.waves[2][(v.time >> 10) & 0x3f] + 32768);
    const depth = fround(fround(v.depth / 4096) + 1), inv = fround(1 / depth);
    n.vibratoFreqScale = fround(1 / fround(fround(fround((depth - inv) * pc) / 65536) + inv));
  }

  noteDisable(n: Note) {
    n.sample.needsInit = false; n.priority = 0; n.sample.enabled = false; n.playbackState = 0; n.sample.finished = false;
    n.parentLayer = null; n.prevParentLayer = null; n.adsr.state = 0; n.adsr.current = 0;
  }

  noteInit(n: Note) {
    const L = n.parentLayer!, ad = n.adsr;
    ad.action = 0; ad.delay = 0; ad.sustain = 0; ad.current = 0; ad.velocity = 0;
    ad.envelope = L.adsr.decayIndex === 0 ? L.channel!.adsr.envelope : L.adsr.envelope;
    n.playbackState = 0;
    ad.state = 1;
    copySampleState(n.sample, newSampleState());
    n.sample.enabled = true;
    n.sample.needsInit = true;
  }

  initForLayer(n: Note, L: Layer) {
    const ch = L.channel!;
    n.prevParentLayer = null; n.parentLayer = L; n.priority = ch.notePriority;
    L.notePropertiesNeedInit = true; L.bit3 = true; L.note = n; L.noteVelocity = 0;
    this.noteInit(n);
    let id = L.instOrWave;
    if (id === 0xff) id = ch.instOrWave;
    n.sample.tuned = L.tunedSample;
    n.sample.isSyntheticWave = id >= 0x80 && id < 0xc0;
    if (n.sample.isSyntheticWave) this.buildSyntheticWave(n, L, id);
    else if (this.mm && n.sample.tuned?.sample) {
      const s = n.sample.tuned.sample;
      n.startSamplePos = ch.startSamplePos === 1 ? s.loopStart : ch.startSamplePos >= s.loopEnd ? 0 : ch.startSamplePos;
    }
    n.sample.reverbIndex = ch.reverbIndex & 3;
    n.stereoHeadsetEffects = ch.stereoHeadsetEffects;
  }

  buildSyntheticWave(n: Note, L: Layer, waveId: number) {
    if (waveId < 128) waveId = 128;
    let fs = L.freqScale;
    if (L.portamento.mode !== 0 && L.portamento.extent > 0) fs = fround(fs * (L.portamento.extent + 1));
    let h: number, r: number;
    if (fs < 0.99999) { h = 0; r = 1.0465; }
    else if (fs < 1.99999) { h = 1; r = fround(1.0465 / 2); }
    else if (fs < 3.99999) { h = 2; r = fround(fround(1.0465 / 4) + 1.005e-3); }
    else { h = 3; r = fround(fround(1.0465 / 8) - 2.5e-6); }
    L.freqScale = fround(L.freqScale * fround(r));
    n.harmonicIndex = h;
    n.sample.wave = this.a.waves[(waveId - 128) % 9];
    n.sample.waveOff = h * 64;
    return h;
  }

  initSyntheticWave(n: Note, L: Layer) {
    let w = L.instOrWave;
    if (w === 0xff) w = L.channel!.instOrWave;
    const prev = n.harmonicIndex, cur = this.buildSyntheticWave(n, L, w);
    if (cur !== prev) n.sample.harmonicCurPrev = (cur << 2) + prev;
  }

  // Seq_NoteDecay (target 6) / Seq_NoteRelease (target 7): the note keeps the layer's attributes and fades.
  decayRelease(L: Layer | null, target: 6 | 7) {
    if (!L) return;
    L.bit3 = false;
    const n = L.note;
    if (!n) return;
    if (n.wantedParentLayer === L) n.wantedParentLayer = null;
    if (n.parentLayer !== L) {
      if (n.parentLayer === null && n.wantedParentLayer === null && n.prevParentLayer === L && target !== 6) {
        n.adsr.fadeOutVel = INV_UPDATES;
        n.adsr.action |= 0x10;
      }
      return;
    }
    if (n.adsr.state !== 6) {
      const at = n.attrs, ch = L.channel;
      at.freqScale = L.noteFreqScale; at.velocity = L.noteVelocity; at.pan = L.notePan;
      if (ch) {
        at.reverb = this.mm && !(L.unk0A & 0x2000) ? L.targetReverbVol : ch.targetReverbVol;
        at.gain = this.mm && !(L.unk0A & 0x0040) ? 0 : ch.gain;
        at.filter = ch.filter ? ch.filter.slice(0, 8) : null;
        at.combFilterGain = ch.combFilterGain; at.combFilterSize = ch.combFilterSize;
        at.stereo = L.stereo === 0 ? ch.stereo : L.stereo;
        n.priority = ch.releasedPriority;
      } else {
        at.stereo = L.stereo;
        n.priority = 1;
      }
      n.prevParentLayer = n.parentLayer;
      n.parentLayer = null;
      if (target === 7) {
        n.adsr.fadeOutVel = INV_UPDATES;
        n.adsr.action |= 0x10;
        n.playbackState = 2;
      } else {
        n.playbackState = 1;
        n.adsr.action |= 0x20;
        n.adsr.fadeOutVel = DECAY_TABLE[L.adsr.decayIndex === 0 ? L.channel!.adsr.decayIndex : L.adsr.decayIndex];
        n.adsr.sustain = fround((L.channel!.adsr.sustain * n.adsr.current) / 256);
      }
    }
    if (target === 6) {
      removeItem(n.item);
      pushFront(n.item.pool!.decaying, n.item);
    }
  }
  noteDecay(L: Layer | null) { this.decayRelease(L, 6); }
  noteRelease(L: Layer | null) { this.decayRelease(L, 7); }

  lowestPriority(list: Item<Note>, limit: number): Note | null {
    let cur = list.next!;
    if (cur === list) return null;
    let best = cur;
    for (; cur !== list; cur = cur.next!) if (best.value!.priority >= cur.value!.priority) best = cur;
    return limit <= best.value!.priority ? null : best.value;
  }
  fromDisabled(p: Pool, L: Layer) {
    const n = popBack(p.disabled);
    if (n) { this.initForLayer(n, L); pushFront(p.active, n.item); }
    return n;
  }
  releaseAndTake(n: Note, L: Layer) {
    n.wantedParentLayer = L; n.priority = L.channel!.notePriority; n.adsr.fadeOutVel = INV_UPDATES; n.adsr.action |= 0x10;
  }
  fromDecaying(p: Pool, L: Layer) {
    const n = popBack(p.decaying);
    if (n) { this.releaseAndTake(n, L); pushBack(p.releasing, n.item); }
    return n;
  }
  fromActive(p: Pool, L: Layer) {
    const pr = L.channel!.notePriority;
    const r = this.lowestPriority(p.releasing, pr), a = this.lowestPriority(p.active, pr);
    if (!r && !a) return null;
    if ((a ? a.priority : 0x10) < (r ? r.priority : 0x10)) {
      removeItem(a!.item); this.noteRelease(a!.parentLayer); a!.wantedParentLayer = L; pushBack(p.releasing, a!.item); a!.priority = pr;
      return a;
    }
    r!.wantedParentLayer = L;
    r!.priority = pr;
    return r;
  }
  allocNote(L: Layer): Note | null {
    const ch = L.channel!, policy = ch.noteAllocPolicy;
    if (policy & 1) {
      const n = L.note;
      if (n && n.prevParentLayer === L && n.wantedParentLayer === null) {
        this.releaseAndTake(n, L); removeItem(n.item); pushBack(n.item.pool!.releasing, n.item);
        return n;
      }
    }
    const c = ch.notePool, s = ch.player.notePool, g = this.free;
    const order: [number, Pool][] = policy & 2 ? [[0, c], [1, c], [2, c]] : policy & 4 ? [[0, c], [0, s], [1, c], [1, s], [2, c], [2, s]]
      : policy & 8 ? [[0, g], [1, g], [2, g]] : [[0, c], [0, s], [0, g], [1, c], [1, s], [1, g], [2, c], [2, s], [2, g]];
    for (const [k, p] of order) {
      const n = k === 0 ? this.fromDisabled(p, L) : k === 1 ? this.fromDecaying(p, L) : this.fromActive(p, L);
      if (n) return n;
    }
    L.bit3 = true;
    return null;
  }
  poolClear(p: Pool) {
    const g = this.free;
    for (const [src, dst] of [[p.disabled, g.disabled], [p.decaying, g.decaying], [p.releasing, g.releasing], [p.active, g.active]] as const) {
      for (let cur = src.next; cur !== src && cur !== null; cur = src.next) { removeItem(cur); pushBack(dst, cur); }
    }
  }
  poolFill(p: Pool, count: number) {
    this.poolClear(p);
    const g = this.free;
    let j = 0;
    for (const [src, dst] of [[g.disabled, p.disabled], [g.decaying, p.decaying], [g.releasing, p.releasing], [g.active, p.active]] as const) {
      while (j < count) {
        const n = popBack(src);
        if (!n) break;
        pushBack(dst, n.item);
        j++;
      }
    }
  }

  // Note_InitSampleState: resampling rate (two parts above 2x), pan (stereo headset effects and strong L/R), volume.
  initSampleState(n: Note, out: SampleState, at: NoteAttributes) {
    copySampleState(out, n.sample);
    let rate: number;
    if (at.freqScale < 2) { out.hasTwoParts = false; rate = Math.min(at.freqScale, 1.99998); }
    else { out.hasTwoParts = true; rate = at.freqScale > 3.99996 ? 1.99998 : fround(at.freqScale * 0.5); }
    out.resampleRate = Math.trunc(fround(rate * 32768)) & 0xffff;
    const pan = at.pan & 0x7f, sd = at.stereo;
    const sdType = (sd >> 4) & 3, sdR = !!(sd & 8), sdL = !!(sd & 4);
    out.strongRight = false; out.strongLeft = false; out.headsetFx = !!(sd & 2); out.headsetPanFx = !!(sd & 1);
    let vl: number, vr: number;
    if (n.stereoHeadsetEffects) { // stereo sound mode
      out.useHaas = false;
      vl = this.a.panStereo[pan];
      vr = this.a.panStereo[127 - pan];
      const sl = pan < 0x20, sr = pan > 0x60;
      out.strongRight = sr; out.strongLeft = sl;
      if (sdType === 1) { out.strongRight = sdR; out.strongLeft = sdL; }
      else if (sdType === 2) { out.strongRight = sdR || sr; out.strongLeft = sdL || sl; }
      else if (sdType === 3) { out.strongRight = sdR !== sr; out.strongLeft = sdL !== sl; }
    } else {
      out.strongRight = sdR; out.strongLeft = sdL;
      vl = this.a.panDefault[pan];
      vr = this.a.panDefault[127 - pan];
    }
    const vel = at.velocity < 0 ? 0 : at.velocity > 1 ? 1 : at.velocity;
    out.targetVolLeft = Math.trunc(fround(fround(vel * vl) * fround(0x1000 - 0.001))) & 0xffff;
    out.targetVolRight = Math.trunc(fround(fround(vel * vr) * fround(0x1000 - 0.001))) & 0xffff;
    out.gain = at.gain; out.filter = at.filter; out.combFilterSize = at.combFilterSize;
    out.combFilterGain = at.combFilterGain; out.reverbVol = at.reverb;
  }

  // AudioPlayback_ProcessNotes for one update: priorities and releases, envelope, vibrato, then the sample state.
  processNotes(update: number) {
    const snaps = this.snaps[update];
    for (let i = 0; i < this.numNotes; i++) {
      const n = this.notes[i];
      if (n.parentLayer !== null) {
        const L = n.parentLayer;
        let doRelease = false;
        if (n !== L.note && n.playbackState === 0) {
          n.adsr.action |= 0x10; n.adsr.fadeOutVel = INV_UPDATES; n.priority = 1; n.playbackState = 2;
        } else if (!L.enabled && n.playbackState === 0 && n.priority >= 1) {
          doRelease = true;
        } else if (L.channel!.player.muted && L.channel!.muteBehavior & 0x40) {
          doRelease = true;
        }
        if (doRelease) {
          this.noteRelease(L); removeItem(n.item); pushFront(n.item.pool!.decaying, n.item); n.priority = 1; n.playbackState = 2;
        }
      } else if (n.playbackState === 0 && n.priority >= 1) {
        continue;
      }
      if (n.priority === 0) continue;
      if (n.playbackState >= 1 || n.sample.finished) {
        if (n.adsr.state === 0 || n.sample.finished) {
          if (n.wantedParentLayer !== null) {
            this.noteDisable(n);
            const w = n.wantedParentLayer;
            if (w.channel !== null) {
              this.initForLayer(n, w);
              this.vibratoInit(n);
              n.portamentoFreqScale = 1;
              Object.assign(n.portamento, w.portamento);
              removeItem(n.item); pushBack(n.item.pool!.active, n.item); n.wantedParentLayer = null;
            } else {
              this.noteDisable(n); removeItem(n.item); pushBack(n.item.pool!.disabled, n.item); n.wantedParentLayer = null;
              continue;
            }
          } else {
            if (n.parentLayer !== null) n.parentLayer.bit1 = true;
            this.noteDisable(n); removeItem(n.item); pushBack(n.item.pool!.disabled, n.item);
            continue;
          }
        }
      } else if (n.adsr.state === 0) {
        if (n.parentLayer !== null) n.parentLayer.bit1 = true;
        this.noteDisable(n); removeItem(n.item); pushBack(n.item.pool!.disabled, n.item);
        continue;
      }
      const scale = this.adsrUpdate(n.adsr);
      this.vibratoUpdate(n);
      const at = this.at;
      if (n.playbackState === 1 || n.playbackState === 2) {
        const t = n.attrs;
        at.freqScale = t.freqScale; at.velocity = t.velocity; at.pan = t.pan; at.reverb = t.reverb; at.stereo = t.stereo;
        at.gain = t.gain; at.filter = t.filter; at.combFilterSize = t.combFilterSize; at.combFilterGain = t.combFilterGain;
      } else {
        const L = n.parentLayer!, ch = L.channel!;
        at.freqScale = L.noteFreqScale; at.velocity = L.noteVelocity; at.pan = L.notePan;
        at.stereo = L.stereo === 0 ? ch.stereo : L.stereo;
        at.reverb = this.mm && !(L.unk0A & 0x2000) ? L.targetReverbVol : ch.targetReverbVol;
        at.gain = this.mm && !(L.unk0A & 0x0040) ? 0 : ch.gain;
        at.filter = ch.filter; at.combFilterSize = ch.combFilterSize; at.combFilterGain = ch.combFilterGain;
        n.sample.bookOffset = ch.bookOffset & 7;
        if (ch.player.muted && ch.muteBehavior & 0x08) { at.freqScale = 0; at.velocity = 0; }
      }
      at.freqScale = fround(fround(at.freqScale * fround(n.vibratoFreqScale * n.portamentoFreqScale)));
      at.velocity = fround(at.velocity * scale);
      this.initSampleState(n, snaps[i], at);
    }
  }

  // AudioSynth_Update part 1 for one update: scripts, notes, then the snapshot bookkeeping.
  runUpdate(update: number) {
    const P = this.player;
    if (P.enabled) {
      this.playerProcess(P);
      this.playerProcessSound(P);
    }
    this.processNotes(update);
    for (let i = 0; i < this.numNotes; i++) {
      const n = this.notes[i];
      if (n.sample.enabled) n.sample.needsInit = false;
      else this.snaps[update][i].enabled = false;
      n.sample.harmonicCurPrev = 0;
    }
  }

  activeNotes() {
    let k = 0;
    for (const n of this.notes) if (n.sample.enabled) k++;
    return k;
  }

  // ---- scripts (seqplayer.c) ----------------------------------------------------------------------------------------

  rvar(s: Script) {
    const d = this.player.seq;
    let v = d[s.pc++];
    if (v & 0x80) v = ((v << 8) & 0x7f00) | d[s.pc++];
    return v;
  }
  read16(s: Script) {
    const d = this.player.seq, v = s16((d[s.pc] << 8) | d[s.pc + 1]);
    s.pc += 2;
    return v;
  }
  flowArg(s: Script, op: number) {
    if (op <= 0xf4 || op === 0xf8) return this.player.seq[s.pc++];
    if (op === 0xf5 || (op >= 0xf9 && op <= 0xfc)) return this.read16(s);
    return 0;
  }

  // AudioSeq_HandleScriptFlowControl: 0 = continue, > 0 = delay, -1 = end. A backward jump of the sequence script marks
  // a pass of the song.
  flow(s: Script, op: number, arg: number, isSeq = false): number {
    const at = s.pc;
    switch (op) {
      case 0xff: if (s.depth === 0) return -1; s.pc = s.stack[--s.depth]; break;
      case 0xfd: return this.rvar(s);
      case 0xfe: return 1;
      case 0xfc: s.stack[s.depth++] = s.pc; s.pc = u16(arg); break;
      case 0xf8: s.rem[s.depth] = arg; s.stack[s.depth++] = s.pc; break;
      case 0xf7:
        s.rem[s.depth - 1] = u8(s.rem[s.depth - 1] - 1);
        if (s.rem[s.depth - 1] !== 0) s.pc = s.stack[s.depth - 1]; else s.depth--;
        break;
      case 0xf6: s.depth--; break;
      case 0xf5: case 0xf9: case 0xfa: case 0xfb:
        if (op === 0xfa && s.value !== 0) break;
        if (op === 0xf9 && s.value >= 0) break;
        if (op === 0xf5 && s.value < 0) break;
        if (isSeq && u16(arg) < at) this.onSeqBackJump(u16(arg));
        s.pc = u16(arg);
        break;
      case 0xf2: case 0xf3: case 0xf4:
        if (op === 0xf3 && s.value !== 0) break;
        if (op === 0xf2 && s.value >= 0) break;
        s.pc += s8(arg);
        break;
    }
    return 0;
  }

  channelInit(ch: Channel) {
    ch.enabled = false; ch.finished = false; ch.stopScript = false; ch.muted = false; ch.hasInstrument = false;
    ch.stereoHeadsetEffects = false; ch.transposition = 0; ch.largeNotes = false; ch.bookOffset = 0; ch.stereo = 0;
    ch.changeVolume = true; ch.changeFreq = true; ch.changePan = true; ch.newPan = 0x40; ch.panChannelWeight = 0x80;
    ch.velocityRandomVariance = 0; ch.gateTimeRandomVariance = 0; ch.reverbIndex = 0; ch.targetReverbVol = 0; ch.gain = 0;
    ch.notePriority = 3; ch.releasedPriority = 1; ch.delay = 0; ch.filter = null; ch.combFilterGain = 0; ch.combFilterSize = 0;
    ch.volume = 1; ch.volumeScale = 1; ch.freqScale = 1; ch.surroundEffectIndex = 0xff; ch.startSamplePos = 0;
    ch.script.depth = 0;
    ch.adsr = { envelope: this.a.defaultEnvelope, decayIndex: 0xf0, sustain: 0 };
    ch.vibrato = newVibrato();
    ch.io.fill(-1);
    ch.notePool = new Pool();
  }

  setLayer(ch: Channel, i: number): number {
    let L = ch.layers[i];
    if (L === null) {
      L = popBack(this.layerFreeList);
      ch.layers[i] = L;
      if (L === null) return -1;
    } else {
      this.noteDecay(L);
    }
    L.channel = ch; L.enabled = true; L.finished = false; L.muted = false; L.continuousNotes = false; L.bit3 = false;
    L.ignoreDrumPan = false; L.bit1 = false; L.notePropertiesNeedInit = false; L.stereo = 0; L.gateTime = 0x80;
    L.transposition = 0; L.delay = 0; L.gateDelay = 0; L.delay2 = 0; L.note = null; L.instrument = null; L.freqScale = 1;
    L.bend = 1; L.velocitySquare2 = 0; L.instOrWave = 0xff; L.targetReverbVol = ch.targetReverbVol;
    L.surroundEffectIndex = 0x80; L.unk0A = 0xffff; L.pan = 0x40;
    L.adsr = { envelope: ch.adsr.envelope, sustain: ch.adsr.sustain, decayIndex: 0 };
    L.portamento.mode = 0;
    L.script.depth = 0;
    L.vibrato = newVibrato();
    return 0;
  }
  layerDisable(L: Layer | null) {
    if (!L) return;
    if (L.channel !== null && L.channel.player.finished) this.noteRelease(L); else this.noteDecay(L);
    L.enabled = false;
    L.finished = true;
  }
  layerFree(ch: Channel, i: number) {
    const L = ch.layers[i];
    if (L) {
      pushBack(this.layerFreeList, L.item);
      this.layerDisable(L);
      ch.layers[i] = null;
    }
  }
  channelDisable(ch: Channel) {
    if (this.mm) ch.finished = true;
    for (let i = 0; i < 4; i++) this.layerFree(ch, i);
    this.poolClear(ch.notePool);
    ch.enabled = false;
    ch.finished = true;
  }
  channelEnable(P: Player, i: number, pc: number) {
    const ch = P.channels[i];
    ch.enabled = true; ch.finished = false; ch.script.depth = 0; ch.script.pc = pc; ch.delay = 0;
    for (let k = 0; k < 4; k++) if (ch.layers[k]) this.layerFree(ch, k);
  }
  playerDisable(P: Player) {
    for (const ch of P.channels) this.channelDisable(ch);
    this.poolClear(P.notePool);
    P.enabled = false;
    P.finished = true;
  }

  getInstrument(ch: Channel, id: number, adsr: Adsr): [number, Instrument | null] {
    if (ch.fontId === 0xff) return [0, null];
    const f = this.a.font(ch.fontId);
    const inst = id < f.instruments.length ? f.instruments[id] : null;
    if (!inst) return [0, null];
    adsr.envelope = inst.envelope;
    adsr.decayIndex = inst.decayIndex;
    return [id + 2, inst];
  }
  // Instrument ids: 0-125 font instruments, 0x7E the font's sound effects, 0x7F drums, >= 0x80 synthetic waves.
  setInstrument(ch: Channel, id: number) {
    if (id >= 0x80) { ch.instOrWave = id; ch.instrument = null; }
    else if (id === 0x7f) { ch.instOrWave = 0; ch.instrument = null; }
    else if (id === 0x7e) { ch.instOrWave = 1; ch.instrument = null; }
    else {
      const [w, inst] = this.getInstrument(ch, id, ch.adsr);
      ch.instOrWave = w;
      ch.instrument = inst;
      if (w === 0) { ch.hasInstrument = false; return; }
    }
    ch.hasInstrument = true;
  }
  fontFromIndex(P: Player, idx: number, fallback: number) {
    if (P.defaultFont === 0xff) return idx;
    const id = P.fonts[P.fonts.length - idx - 1];
    return id === undefined ? fallback : id;
  }
  loadFilter(dst: Int16Array, lp: number, hp: number) {
    const L = this.a.lowPass, H = this.a.highPass;
    for (let i = 0; i < 8; i++) {
      if (lp === 0 && hp === 0) dst[i] = L[i];
      else if (hp === 0) dst[i] = L[8 * lp + i];
      else if (lp === 0) dst[i] = H[8 * (hp - 1) + i];
      else dst[i] = Math.trunc((L[8 * lp + i] + H[8 * (hp - 1) + i]) / 2);
    }
  }
  nextRandom() {
    this.rand = (Math.imul(this.rand, 1103515245) + 12345) >>> 0;
    return this.rand;
  }

  layerProcess(L: Layer) {
    if (!L.enabled) return;
    if (L.delay > 1) {
      L.delay--;
      if (!L.muted && L.delay <= L.gateDelay) { this.noteDecay(L); L.muted = true; }
      return;
    }
    if (!L.continuousNotes) this.noteDecay(L);
    else if (L.note !== null && L.note.wantedParentLayer === L) this.noteDecay(L);
    if ((L.portamento.mode & 0x7f) === 1 || (L.portamento.mode & 0x7f) === 2) L.portamento.mode = 0;
    L.notePropertiesNeedInit = true;
    let cmd: number;
    do {
      cmd = this.layerStep2(L);
      if (cmd === -1) return;
      cmd = this.layerStep3(L, cmd);
    } while (this.mm && cmd === -1 && L.delay === 0); // MM reads on after a zero-length rest
    if (cmd !== -1) cmd = this.layerStep4(L, cmd);
    if (cmd !== -1) this.layerStep5(L, cmd === 1);
    if (L.muted && (L.note !== null || L.continuousNotes)) this.noteDecay(L);
  }

  // Layer commands up to the next note or rest.
  layerStep2(L: Layer): number {
    const ch = L.channel!, s = L.script, P = ch.player, d = P.seq;
    for (;;) {
      const cmd = d[s.pc++];
      if (cmd <= 0xc0) return cmd;
      if (cmd >= 0xf2) {
        const arg = this.flowArg(s, cmd);
        if (this.flow(s, cmd, arg) === 0) continue;
        this.layerDisable(L);
        return -1;
      }
      switch (cmd) {
        case 0xc1: { const v = d[s.pc++]; L.velocitySquare = fround((v * v) / fround(127 * 127)); break; }
        case 0xca: L.pan = d[s.pc++]; break;
        case 0xc9: L.gateTime = d[s.pc++]; break;
        case 0xc2: L.transposition = d[s.pc++]; break;
        case 0xc4: case 0xc5: L.continuousNotes = cmd === 0xc4; L.bit1 = false; this.noteDecay(L); break;
        case 0xc3: L.shortNoteDefaultDelay = this.rvar(s); break;
        case 0xc6: {
          const v = d[s.pc++];
          if (v >= 0x7e) {
            if (v === 0x7e) L.instOrWave = 1;
            else if (v === 0x7f) L.instOrWave = 0;
            else { L.instOrWave = v; L.instrument = null; }
            if (v === 0xff) L.adsr.decayIndex = 0;
          } else {
            const [w, inst] = this.getInstrument(ch, v, L.adsr);
            L.instOrWave = w;
            L.instrument = inst;
            if (w === 0) L.instOrWave = 0xff;
          }
          break;
        }
        case 0xc7: {
          L.portamento.mode = d[s.pc++];
          let note = u8(d[s.pc++] + ch.transposition + L.transposition + P.transposition);
          if (note >= 0x80) note = 0;
          L.portamentoTargetNote = note;
          L.portamentoTime = L.portamento.mode & 0x80 ? d[s.pc++] : this.rvar(s);
          break;
        }
        case 0xc8: L.portamento.mode = 0; break;
        case 0xcb: L.adsr.envelope = { bytes: d, off: u16(this.read16(s)) }; L.adsr.decayIndex = d[s.pc++]; break;
        case 0xcf: L.adsr.decayIndex = d[s.pc++]; break;
        case 0xcc: L.ignoreDrumPan = true; break;
        case 0xcd: L.stereo = d[s.pc++]; break;
        case 0xce: L.bend = this.a.bendTwo[u8(d[s.pc++] + 0x80)]; break;
        default:
          if (this.mm && cmd === 0xf0) { L.unk0A &= u16(this.read16(s)) ^ 0xffff; break; }
          if (this.mm && cmd === 0xf1) { L.surroundEffectIndex = d[s.pc++]; break; }
          if ((cmd & 0xf0) === 0xd0) {
            const v = P.shortVelocity[0][P.shortVelocity[1] + (cmd & 15)];
            L.velocitySquare = fround((v * v) / fround(127 * 127));
          } else if ((cmd & 0xf0) === 0xe0) {
            L.gateTime = P.shortGate[0][P.shortGate[1] + (cmd & 15)];
          }
      }
    }
  }

  // Note or rest: length, velocity and gate (with the channel's random variances).
  layerStep3(L: Layer, cmd: number): number {
    const s = L.script, ch = L.channel!, P = ch.player, d = P.seq;
    if (cmd === 0xc0) {
      L.delay = this.rvar(s);
      L.muted = true;
      L.bit1 = false;
      return -1;
    }
    L.muted = false;
    let delay = 0;
    const form = cmd & 0xc0;
    if (ch.largeNotes) {
      let vel = 0;
      if (form === 0x00) { delay = this.rvar(s); vel = d[s.pc++]; L.gateTime = d[s.pc++]; L.lastDelay = delay; }
      else if (form === 0x40) { delay = this.rvar(s); vel = d[s.pc++]; L.gateTime = 0; L.lastDelay = delay; }
      else { delay = L.lastDelay; vel = d[s.pc++]; L.gateTime = d[s.pc++]; }
      if (vel > 0x7f || vel < 0) vel = 0x7f;
      L.velocitySquare = fround(fround(vel * vel) / fround(127 * 127));
    } else if (form === 0x00) {
      delay = this.rvar(s);
      L.lastDelay = delay;
    } else {
      delay = form === 0x40 ? L.shortNoteDefaultDelay : L.lastDelay;
    }
    cmd -= form;
    if (ch.velocityRandomVariance !== 0) {
      const r = this.rand & 0xffff;
      let fd = fround((L.velocitySquare * (r % ch.velocityRandomVariance)) / 100);
      if (r & 0x8000) fd = -fd;
      L.velocitySquare2 = Math.min(1, Math.max(0, fround(L.velocitySquare + fd)));
    } else {
      L.velocitySquare2 = L.velocitySquare;
    }
    L.delay = delay;
    L.gateDelay = (L.gateTime * delay) >> 8;
    if (ch.gateTimeRandomVariance !== 0) {
      const r = this.rand & 0xffff;
      let id = Math.trunc((L.gateDelay * (r % (ch.velocityRandomVariance || 1))) / 100); // the decomp uses the velocity variance
      if (r & 0x4000) id = -id;
      L.gateDelay = Math.min(L.delay, Math.max(0, L.gateDelay + id));
    }
    if ((P.muted && ch.muteBehavior & (0x40 | 0x10)) || ch.muted) {
      L.muted = true;
      return -1;
    }
    return cmd;
  }

  // Sample and frequency of the note (drum, sound effect, instrument with portamento); zero-length notes play the
  // sample once. Returns 1 when the tuned sample is unchanged, 0 otherwise, -1 to end.
  layerStep4(L: Layer, cmd: number): number {
    let same = 1;
    const ch = L.channel!, P = ch.player;
    let w = L.instOrWave, semitone = cmd;
    if (w === 0xff) {
      if (!ch.hasInstrument) return -1;
      w = ch.instOrWave;
    }
    if (w === 0) {
      semitone = u8(semitone + ch.transposition + L.transposition);
      L.semitone = semitone;
      const f = ch.fontId === 0xff ? null : this.a.font(ch.fontId);
      const drum = f && semitone < f.drums.length ? f.drums[semitone] : null;
      if (!drum) { L.muted = true; L.delay2 = L.delay; return -1; }
      L.adsr.envelope = drum.envelope;
      L.adsr.decayIndex = drum.decayIndex;
      if (!L.ignoreDrumPan) L.pan = drum.pan;
      L.tunedSample = drum.tunedSample;
      L.freqScale = drum.tunedSample.tuning;
    } else if (w === 1) {
      L.semitone = semitone;
      const id = (L.transposition << 6) + semitone;
      const f = ch.fontId === 0xff ? null : this.a.font(ch.fontId);
      const sfx = f && id < f.sfx.length ? f.sfx[id] : null;
      if (!sfx || !sfx.sample) { L.muted = true; L.delay2 = L.delay + 1; return -1; }
      L.tunedSample = sfx;
      L.freqScale = sfx.tuning;
    } else {
      semitone = u8(semitone + P.transposition + ch.transposition + L.transposition);
      L.semitone = semitone;
      if (semitone >= 0x80) { L.muted = true; return -1; }
      const inst = L.instOrWave === 0xff ? ch.instrument : L.instrument;
      if (L.portamento.mode !== 0) {
        const p = L.portamento, vn = semitone > L.portamentoTargetNote ? semitone : L.portamentoTargetNote;
        let tuning = 1;
        if (inst) {
          const t = sampleFor(inst, vn);
          same = t === L.tunedSample ? 1 : 0;
          L.tunedSample = t;
          tuning = t.tuning;
        } else {
          L.tunedSample = null;
        }
        const f2 = fround(this.a.pitch[semitone] * tuning), f14 = fround(this.a.pitch[L.portamentoTargetNote] * tuning);
        const mode = p.mode & 0x7f;
        let fs: number, fs2: number;
        if (mode === 1 || mode === 3 || mode === 5) { fs2 = f2; fs = f14; }
        else if (mode === 2 || mode === 4) { fs = f2; fs2 = f14; }
        else { fs = f2; fs2 = f2; }
        p.extent = fround(fs2 / fs - 1);
        let speed: number;
        if (p.mode & 0x80) {
          speed = Math.trunc((P.tempo * 0x8000) / MAX_TEMPO);
          if (L.delay !== 0) speed = Math.trunc((speed * 0x100) / (L.delay * L.portamentoTime));
        } else {
          speed = Math.trunc(0x20000 / (L.portamentoTime * UPDATES));
        }
        p.speed = speed >= 0x7fff ? 0x7fff : speed < 1 ? 1 : speed;
        p.cur = 0;
        L.freqScale = fs;
        if (mode === 5) L.portamentoTargetNote = semitone;
      } else if (inst) {
        const t = sampleFor(inst, semitone);
        same = t === L.tunedSample ? 1 : 0;
        L.tunedSample = t;
        L.freqScale = fround(this.a.pitch[semitone] * t.tuning);
      } else {
        L.tunedSample = null;
        L.freqScale = this.a.pitch[semitone];
      }
    }
    L.delay2 = L.delay;
    L.freqScale = fround(L.freqScale * L.bend);
    if (L.delay === 0) {
      let t = L.tunedSample?.sample ? L.tunedSample.sample.loopEnd : 0;
      t = fround(fround(fround(t * P.tempo) * TEMPO_TO_TICKS) / L.freqScale);
      if (t > 0x7ffe) t = 0x7ffe;
      L.gateDelay = 0;
      L.delay = u16(Math.trunc(t)) + 1;
      if (L.portamento.mode !== 0 && L.portamento.mode & 0x80) {
        let sp = Math.trunc((P.tempo * 0x8000) / MAX_TEMPO);
        sp = Math.trunc((sp * 0x100) / (L.delay * L.portamentoTime));
        L.portamento.speed = sp >= 0x7fff ? 0x7fff : sp < 1 ? 1 : sp;
      }
    }
    return same;
  }

  layerStep5(L: Layer, same: boolean) {
    const smp = L.tunedSample?.sample;
    if (!this.mm && !L.muted && smp && smp.codec === 2 && smp.medium !== 0) { L.muted = true; return; }
    if (L.continuousNotes && L.bit1) return;
    if (L.continuousNotes && L.note !== null && L.bit3 && same && L.note.parentLayer === L) {
      if (L.tunedSample === null) this.initSyntheticWave(L.note, L);
    } else {
      if (!same) this.noteDecay(L);
      L.note = this.allocNote(L);
      if (L.note !== null && L.note.parentLayer === L) this.vibratoInit(L.note);
    }
    if (L.note !== null && L.note.parentLayer === L) {
      L.note.portamentoFreqScale = 1;
      Object.assign(L.note.portamento, L.portamento);
    }
  }

  channelProcess(ch: Channel) {
    const P = ch.player, d = P.seq, s = ch.script;
    run: if (!ch.stopScript) {
      if (P.muted && ch.muteBehavior & 0x80) return;
      if (ch.delay >= 2) { ch.delay--; break run; }
      const base = this.mm ? 0xa0 : 0xb0, argTable = this.mm ? CHANNEL_ARGS_MM : CHANNEL_ARGS_OOT;
      const args = [0, 0, 0];
      for (;;) {
        const cmd = d[s.pc++];
        if (cmd >= base) {
          const spec = argTable[cmd - 0xa0];
          for (let k = 0; k < spec.length; k++) args[k] = spec.charCodeAt(k) === 98 /* b */ ? d[s.pc++] : this.read16(s);
          if (cmd >= 0xf2) {
            const r = this.flow(s, cmd, spec.length ? args[0] : 0);
            if (r !== 0) {
              if (r === -1) this.channelDisable(ch); else ch.delay = r;
              break;
            }
            continue;
          }
          const a0 = spec.length ? args[0] : 0, a1 = args[1], a2 = args[2];
          switch (cmd) {
            case 0xea: ch.stopScript = true; break run;
            case 0xf1: this.poolFill(ch.notePool, u8(a0)); break;
            case 0xf0: this.poolClear(ch.notePool); break;
            case 0xc2: ch.dynTable = u16(a0); break;
            case 0xc5:
              if (s.value !== -1) {
                const p = ch.dynTable + 2 * s.value, t = (d[p] << 8) + d[p + 1];
                if (this.mm) s.pc = t; else ch.dynTable = t;
              }
              break;
            case 0xeb: {
              let f = u8(a0);
              if (P.defaultFont !== 0xff) f = this.fontFromIndex(P, f, ch.fontId);
              if (P.fonts.includes(f)) ch.fontId = f;
              this.setInstrument(ch, u8(a1));
              break;
            }
            case 0xc1: this.setInstrument(ch, u8(a0)); break;
            case 0xc3: ch.largeNotes = false; break;
            case 0xc4: ch.largeNotes = true; break;
            case 0xdf: ch.volume = fround(u8(a0) / 127); ch.changeVolume = true; break;
            case 0xe0: ch.volumeScale = fround(u8(a0) / 128); ch.changeVolume = true; break;
            case 0xde: ch.freqScale = fround(u16(a0) / 32768); ch.changeFreq = true; break;
            case 0xd3: ch.freqScale = this.a.bendOctave[u8(a0 + 0x80)]; ch.changeFreq = true; break;
            case 0xee: ch.freqScale = this.a.bendTwo[u8(a0 + 0x80)]; ch.changeFreq = true; break;
            case 0xdd: ch.newPan = u8(a0); ch.changePan = true; break;
            case 0xdc: ch.panChannelWeight = u8(a0); ch.changePan = true; break;
            case 0xdb: ch.transposition = s8(a0); break;
            case 0xda: ch.adsr.envelope = { bytes: d, off: u16(a0) }; break;
            case 0xd9: ch.adsr.decayIndex = u8(a0); break;
            case 0xd8: ch.vibrato.depthTarget = u8(a0) * 8; ch.vibrato.depthStart = 0; ch.vibrato.depthChangeDelay = 0; break;
            case 0xd7: ch.vibrato.rateChangeDelay = 0; ch.vibrato.rateTarget = u8(a0) * 32; ch.vibrato.rateStart = u8(a0) * 32; break;
            case 0xe2: ch.vibrato.depthStart = u8(a0) * 8; ch.vibrato.depthTarget = u8(a1) * 8; ch.vibrato.depthChangeDelay = u8(a2) * 16; break;
            case 0xe1: ch.vibrato.rateStart = u8(a0) * 32; ch.vibrato.rateTarget = u8(a1) * 32; ch.vibrato.rateChangeDelay = u8(a2) * 16; break;
            case 0xe3: ch.vibrato.delay = u8(a0) * 16; break;
            case 0xd4: ch.targetReverbVol = u8(a0); break;
            case 0xc6: {
              let f = u8(a0);
              if (P.defaultFont !== 0xff) f = this.fontFromIndex(P, f, ch.fontId);
              if (P.fonts.includes(f)) ch.fontId = f;
              break;
            }
            case 0xc7: d[u16(a1)] = u8(s.value + u8(a0)); break;
            case 0xc8: s.value = s8(s.value - s8(a0)); break;
            case 0xcc: s.value = s8(a0); break;
            case 0xc9: s.value = s8(s.value & s8(a0)); break;
            case 0xcd: this.channelDisable(P.channels[u8(a0) & 15]); break;
            case 0xca: ch.muteBehavior = u8(a0); ch.changeVolume = true; break;
            case 0xcb: s.value = s8(d[u16(a0) + s.value]); break;
            case 0xce: ch.unk22 = u16(a0); break;
            case 0xcf: { const p = u16(a0); d[p] = ch.unk22 >> 8; d[p + 1] = ch.unk22 & 0xff; break; }
            case 0xd0: ch.stereoHeadsetEffects = !!(u8(a0) & 0x80); ch.stereo = u8(a0) & 0x7f; break;
            case 0xd1: ch.noteAllocPolicy = u8(a0); break;
            case 0xd2: ch.adsr.sustain = u8(a0); break;
            case 0xe5: ch.reverbIndex = u8(a0); break;
            case 0xe4:
              if (s.value !== -1) {
                const p = ch.dynTable + 2 * s.value;
                s.stack[s.depth++] = s.pc;
                s.pc = (d[p] << 8) + d[p + 1];
              }
              break;
            case 0xe6: ch.bookOffset = u8(a0); break;
            case 0xe7: case 0xe8: { // mute behaviour, note policy, priorities, transposition, pan, weight, reverb, reverb index
              let p = cmd === 0xe7 ? u16(a0) : -1;
              const next = () => (p >= 0 ? d[p++] : d[s.pc++]);
              if (cmd === 0xe7) { ch.muteBehavior = next(); ch.noteAllocPolicy = next(); this.setPriorities(ch, next()); }
              else { ch.muteBehavior = u8(a0); ch.noteAllocPolicy = u8(a1); this.setPriorities(ch, u8(a2)); }
              ch.transposition = s8(next()); ch.newPan = next(); ch.panChannelWeight = next(); ch.targetReverbVol = next(); ch.reverbIndex = next();
              ch.changePan = true;
              break;
            }
            case 0xec: {
              const v = ch.vibrato;
              v.depthTarget = 0; v.depthStart = 0; v.depthChangeDelay = 0; v.rateTarget = 0; v.rateStart = 0; v.rateChangeDelay = 0;
              ch.filter = null; ch.gain = 0; ch.velocityRandomVariance = 0; ch.gateTimeRandomVariance = 0; ch.combFilterSize = 0;
              ch.combFilterGain = 0; ch.bookOffset = 0; ch.freqScale = 1; ch.adsr.sustain = 0;
              if (this.mm) ch.startSamplePos = 0;
              break;
            }
            case 0xe9: this.setPriorities(ch, u8(a0)); break;
            case 0xed: ch.gain = u8(a0); break;
            case 0xb0: { // filter: 8 s16 coefficients in the sequence
              const p = u16(a0);
              ch.filter = Int16Array.from({ length: 8 }, (_, i) => s16((d[p + 2 * i] << 8) | d[p + 2 * i + 1]));
              ch.filterSeqOff = p;
              break;
            }
            case 0xb1: ch.filter = null; break;
            case 0xb3:
              if (ch.filter) { // the game writes the coefficients into the sequence data the filter points at
                this.loadFilter(ch.filter, (u8(a0) >> 4) & 15, u8(a0) & 15);
                for (let i = 0; i < 8; i++) { d[ch.filterSeqOff + 2 * i] = ch.filter[i] >> 8; d[ch.filterSeqOff + 2 * i + 1] = ch.filter[i] & 0xff; }
              }
              break;
            case 0xb2: { const p = u16(a0) + 2 * s.value; ch.unk22 = (d[p] << 8) | d[p + 1]; break; }
            case 0xb4: ch.dynTable = ch.unk22; break;
            case 0xb5: { const p = ch.dynTable + 2 * s.value; ch.unk22 = (d[p] << 8) | d[p + 1]; break; }
            case 0xb6: s.value = s8(d[ch.dynTable + 2 * s.value]); break;
            case 0xb7: ch.unk22 = a0 === 0 ? this.rand & 0xffff : this.rand % u16(a0); break;
            case 0xb8: s.value = s8(a0 === 0 ? this.rand & 0xffff : this.rand % u8(a0)); break;
            case 0xb9: ch.velocityRandomVariance = u8(a0); break;
            case 0xba: ch.gateTimeRandomVariance = u8(a0); break;
            case 0xbb: ch.combFilterSize = u8(a0); ch.combFilterGain = u16(a1); break;
            case 0xbc: ch.unk22 = u16(ch.unk22 + a0); break;
            case 0xbd:
              if (this.mm) ch.startSamplePos = a0;
              else {
                const r = this.nextRandom();
                let v = u16(a0) === 0 ? r & 0xffff : r % u16(a0);
                v = u16(v + a1);
                ch.unk22 = u16((((v >> 8) + 0x80) << 8) | (v & 0xff));
              }
              break;
            case 0xbe: break; // MM custom sequence function (game code): none registered
            case 0xa0: case 0xa1: case 0xa2: case 0xa3: break; // MM SFX channel state (SFX player only)
            case 0xa4: ch.surroundEffectIndex = u8(a0); break;
            case 0xa5: s.value = s8(s.value + ch.index); break;
            case 0xa6: d[u16(a1) + ch.index] = u8(s.value + u8(a0)); break;
            case 0xa7: {
              const a = u8(a0), neg = s.value & 0x80;
              let v = a & 0x80 ? (s.value & 0xff) >> (a & 15) : (s.value << (a & 15)) & 0xff;
              if (a & 0x40) v = (v & 0x7f) | neg;
              s.value = s8(v);
              break;
            }
            case 0xa8: {
              const r = this.nextRandom();
              let v = u16(a0) === 0 ? r & 0xffff : r % u16(a0);
              v = u16(v + a1);
              ch.unk22 = u16((((v >> 8) + 0x80) << 8) | (v & 0xff));
              break;
            }
            default: break;
          }
          continue;
        }
        if (cmd >= 0x70) {
          let lo = cmd & 7;
          const k = cmd & 0xf8;
          if (k !== 0x70 && lo >= 4) lo = 0;
          switch (k) {
            case 0x80: { const L = ch.layers[lo]; s.value = L ? (L.finished ? 1 : 0) : -1; break; }
            case 0x88: { const t = u16(this.read16(s)); if (this.setLayer(ch, lo) === 0) ch.layers[lo]!.script.pc = t; break; }
            case 0x90: this.layerFree(ch, lo); break;
            case 0x98:
              if (s.value !== -1 && this.setLayer(ch, lo) !== -1) {
                const p = ch.dynTable + 2 * s.value;
                ch.layers[lo]!.script.pc = (d[p] << 8) + d[p + 1];
              }
              break;
            case 0x70: ch.io[lo] = s.value; break;
            case 0x78: { const r = this.read16(s); if (this.setLayer(ch, lo) === 0) ch.layers[lo]!.script.pc = s.pc + r; break; }
          }
          continue;
        }
        const lo = cmd & 15;
        switch (cmd & 0xf0) {
          case 0x00:
            if (this.mm && lo === 0) continue;
            ch.delay = lo;
            break run;
          case 0x10: if (lo < 8) ch.io[lo] = 1; else ch.io[lo - 8] = 1; break; // sample load: completes at once
          case 0x60: s.value = ch.io[lo]; if (lo < 2) ch.io[lo] = -1; break;
          case 0x50: s.value = s8(s.value - ch.io[lo]); break;
          case 0x20: { const t = u16(this.read16(s)); this.channelEnable(P, lo, t); break; }
          case 0x30: { const port = d[s.pc++]; P.channels[lo].io[port & 7] = s.value; break; }
          case 0x40: { const port = d[s.pc++]; s.value = P.channels[lo].io[port & 7]; break; }
        }
      }
    }
    for (const L of ch.layers) if (L) this.layerProcess(L);
  }

  setPriorities(ch: Channel, p: number) {
    if (p & 15) ch.notePriority = p & 15;
    if (p >> 4) ch.releasedPriority = p >> 4;
  }

  playerProcess(P: Player) {
    if (!P.enabled) return;
    if (P.muted && P.muteBehavior & 0x80) return;
    P.scriptCounter++;
    let t = P.tempo + s16(P.tempoChange);
    if (this.mm && t > MAX_TEMPO) t = MAX_TEMPO;
    P.tempoAcc = u16(P.tempoAcc + (this.mm ? t : P.tempo));
    if (!this.mm) P.tempoAcc = u16(P.tempoAcc + s16(P.tempoChange));
    if (P.tempoAcc < MAX_TEMPO) return;
    P.tempoAcc = u16(P.tempoAcc - MAX_TEMPO);
    if (P.stopScript) return;
    if (P.delay > 1) {
      P.delay--;
    } else {
      const s = P.script, d = P.seq;
      P.recalculateVolume = true;
      for (;;) {
        const cmd = d[s.pc++];
        if (cmd >= 0xf2) {
          const r = this.flow(s, cmd, this.flowArg(s, cmd), true);
          if (r !== 0) {
            if (r === -1) this.playerDisable(P); else P.delay = r;
            break;
          }
          continue;
        }
        if (cmd >= 0xc0) {
          switch (cmd) {
            case 0xf1: this.poolFill(P.notePool, d[s.pc++]); break;
            case 0xf0: this.poolClear(P.notePool); break;
            case 0xdf: P.transposition = s8(d[s.pc++]); break;
            case 0xde: P.transposition += s8(d[s.pc++]); break;
            case 0xdd:
              P.tempo = d[s.pc++] * 48;
              if (P.tempo > MAX_TEMPO) P.tempo = MAX_TEMPO;
              if (s16(P.tempo) <= 0) P.tempo = 1;
              break;
            case 0xdc: P.tempoChange = s8(d[s.pc++]) * 48; break;
            case 0xda: {
              const m = d[s.pc++], v = u16(this.read16(s));
              if (m === 0 || m === 1) {
                if (P.state !== 2) { P.storedFadeTimer = v; P.state = m; }
              } else if (m === 2) {
                P.fadeTimer = v; P.state = m; P.fadeVelocity = fround((0 - P.fadeVolume) / v);
              }
              break;
            }
            case 0xdb: {
              const v = d[s.pc++];
              if (P.state === 1) { P.state = 0; P.fadeVolume = 0; }
              if (P.state === 0) {
                P.fadeTimer = P.storedFadeTimer;
                if (P.storedFadeTimer !== 0) P.fadeVelocity = fround((fround(v / 127) - P.fadeVolume) / P.fadeTimer);
                else P.fadeVolume = fround(v / 127);
              }
              break;
            }
            case 0xd9: P.fadeVolumeScale = fround(s8(d[s.pc++]) / 127); break;
            case 0xd7: { // channels are pre-allocated: only font, mute behaviour and note policy
              let bits = u16(this.read16(s));
              for (let i = 0; i < 16; i++, bits >>= 1) {
                if (!(bits & 1)) continue;
                const ch = P.channels[i];
                ch.fontId = P.defaultFont; ch.muteBehavior = P.muteBehavior; ch.noteAllocPolicy = P.noteAllocPolicy;
              }
              break;
            }
            case 0xd6: this.read16(s); break;
            case 0xd5: P.muteVolumeScale = fround(s8(d[s.pc++]) / 127); break;
            case 0xd4: P.muted = true; break;
            case 0xd3: P.muteBehavior = d[s.pc++]; break;
            case 0xd1: case 0xd2: {
              const t2 = u16(this.read16(s));
              if (cmd === 0xd2) P.shortVelocity = [d, t2]; else P.shortGate = [d, t2];
              break;
            }
            case 0xd0: P.noteAllocPolicy = d[s.pc++]; break;
            case 0xce: { const m = d[s.pc++]; s.value = s8(m === 0 ? (this.rand >>> 2) & 0xff : (this.rand >>> 2) % m); break; }
            case 0xcd: {
              const t2 = u16(this.read16(s));
              if (s.value !== -1 && s.depth !== 3) {
                const p = t2 + (s.value << 1);
                s.stack[s.depth++] = s.pc;
                s.pc = (d[p] << 8) + d[p + 1];
              }
              break;
            }
            case 0xcc: s.value = s8(d[s.pc++]); break;
            case 0xc9: s.value = s8(s.value & d[s.pc++]); break;
            case 0xc8: s.value = s8(s.value - d[s.pc++]); break;
            case 0xc7: { const a = d[s.pc++], t2 = u16(this.read16(s)); d[t2] = u8(s.value + a); break; }
            case 0xc6: P.stopScript = true; return;
            case 0xc5: P.scriptCounter = u16(this.read16(s)); break;
            case 0xef: this.read16(s); s.pc++; break;
            case 0xc4: { // RUNSEQ: on this player, the sequence replaces itself and the IO ports persist
              const a = d[s.pc++], b = d[s.pc++];
              if (a === 0xff || a === 0) {
                const io = Array.from(P.io);
                this.start(b);
                P.io.set(io);
                return;
              }
              break; // another player: not modelled
            }
            case 0xc2:
              if (this.mm) {
                const t2 = u16(this.read16(s));
                if (s.value !== -1) { const p = t2 + (s.value << 1); s.pc = (d[p] << 8) + d[p + 1]; }
              }
              break;
            case 0xc3:
              if (this.mm) {
                const t2 = u16(this.read16(s));
                if (s.value !== -1) {
                  const p = t2 + s.value * 2;
                  let m = (d[p] << 8) | d[p + 1];
                  for (const ch of P.channels) { ch.muted = !!(m & 1); m >>= 1; }
                }
              }
              break;
          }
          continue;
        }
        const lo = cmd & 15;
        switch (cmd & 0xf0) {
          case 0x00: s.value = P.channels[lo].enabled ? 0 : 1; break;
          case 0x50: s.value = s8(s.value - P.io[lo]); break;
          case 0x70: P.io[lo] = s.value; break;
          case 0x80: s.value = P.io[lo]; if (lo < 2) P.io[lo] = -1; break;
          case 0x40: this.channelDisable(P.channels[lo]); break;
          case 0x90: { const t2 = u16(this.read16(s)); this.channelEnable(P, lo, t2); break; }
          case 0xa0: { const r = this.read16(s); this.channelEnable(P, lo, s.pc + r); break; }
          case 0xb0: { // LDSEQ: load a sequence into this one's data (the field logic's parts); completes at once
            const id = d[s.pc++], t2 = u16(this.read16(s));
            const src = this.a.sequenceData(id);
            d.set(src.subarray(0, Math.min(src.length, d.length - t2)), t2);
            P.io[lo] = 1;
            break;
          }
          case 0x60: s.pc += 2; P.io[lo] = 1; break; // font / sample bank load
        }
      }
    }
    for (const ch of P.channels) if (ch.enabled) this.channelProcess(ch);
  }

  playerProcessSound(P: Player) {
    if (P.fadeTimer !== 0) {
      P.fadeVolume = fround(P.fadeVolume + P.fadeVelocity);
      P.recalculateVolume = true;
      if (P.fadeVolume > 1) P.fadeVolume = 1;
      if (P.fadeVolume < 0) P.fadeVolume = 0;
      if (--P.fadeTimer === 0 && P.state === 2) {
        this.playerDisable(P);
        return;
      }
    }
    if (P.recalculateVolume) P.appliedFadeVolume = fround(P.fadeVolume * P.fadeVolumeScale);
    for (const ch of P.channels) {
      if (!ch.enabled) continue;
      const recalc = P.recalculateVolume;
      if (ch.changeVolume || recalc) {
        let v = fround(fround(ch.volume * ch.volumeScale) * P.appliedFadeVolume);
        if (P.muted && ch.muteBehavior & 0x20) v = fround(P.muteVolumeScale * v);
        ch.appliedVolume = fround(v * v);
      }
      if (ch.changePan) ch.pan = ch.newPan * ch.panChannelWeight;
      const fs = ch.freqScale;
      for (const L of ch.layers) {
        if (!L || !L.enabled || L.note === null) continue;
        if (L.notePropertiesNeedInit) {
          L.noteFreqScale = fround(L.freqScale * fs);
          L.noteVelocity = fround(L.velocitySquare2 * ch.appliedVolume);
          L.notePan = (ch.pan + L.pan * (0x80 - ch.panChannelWeight)) >> 7;
          L.notePropertiesNeedInit = false;
        } else {
          if (ch.changeFreq) L.noteFreqScale = fround(L.freqScale * fs);
          if (ch.changeVolume || recalc) L.noteVelocity = fround(L.velocitySquare2 * ch.appliedVolume);
          if (ch.changePan) L.notePan = (ch.pan + L.pan * (0x80 - ch.panChannelWeight)) >> 7;
        }
      }
      ch.changeVolume = ch.changeFreq = ch.changePan = false;
    }
    P.recalculateVolume = false;
  }

  // AudioLoad_SyncInitSeqPlayerInternal + AudioSeq_ResetSequencePlayer; the game writes player IO before the start.
  start(seqId: number, io: Record<number, number> = {}) {
    const P = this.player;
    this.playerDisable(P);
    P.fonts = this.a.fontsForSequence(seqId);
    P.stopScript = false; P.delay = 0; P.state = 1; P.fadeTimer = 0; P.storedFadeTimer = 0; P.tempoAcc = 0; P.tempo = 120 * 48;
    P.tempoChange = 0; P.transposition = 0; P.noteAllocPolicy = 0; P.shortVelocity = [this.a.shortVelocity, 0];
    P.shortGate = [this.a.shortGate, 0]; P.scriptCounter = 0; P.fadeVolume = 1; P.fadeVelocity = 0; P.muteVolumeScale = 0.5;
    for (const ch of P.channels) this.channelInit(ch);
    P.defaultFont = P.fonts.length ? P.fonts[P.fonts.length - 1] : 0xff;
    P.seq = this.a.sequenceData(seqId);
    P.enabled = true;
    P.finished = false;
    P.script = newScript();
    for (const [k, v] of Object.entries(io)) P.io[+k] = s8(v);
  }
}

// sSeqInstructionArgsTable from 0xA0 (channel commands >= 0xB0, MM >= 0xA0): b = u8, s = s16.
const argTable = (m: Record<number, string>) => Array.from({ length: 0x60 }, (_, i) => m[0xa0 + i] ?? '');
const CHANNEL_ARGS: Record<number, string> = {
  0xb0: 's', 0xb2: 's', 0xb3: 'b', 0xb7: 's', 0xb8: 'b', 0xb9: 'b', 0xba: 'b', 0xbb: 'bs', 0xbc: 's', 0xbd: 'ss', 0xc1: 'b', 0xc2: 's',
  0xc6: 'b', 0xc7: 'bs', 0xc8: 'b', 0xc9: 'b', 0xca: 'b', 0xcb: 's', 0xcc: 'b', 0xcd: 'b', 0xce: 's', 0xcf: 's', 0xd0: 'b', 0xd1: 'b',
  0xd2: 'b', 0xd3: 'b', 0xd4: 'b', 0xd5: 'b', 0xd6: 'b', 0xd7: 'b', 0xd8: 'b', 0xd9: 'b', 0xda: 's', 0xdb: 'b', 0xdc: 'b', 0xdd: 'b',
  0xde: 's', 0xdf: 'b', 0xe0: 'b', 0xe1: 'bbb', 0xe2: 'bbb', 0xe3: 'b', 0xe5: 'b', 0xe6: 'b', 0xe7: 's', 0xe8: 'bbb', 0xe9: 'b',
  0xeb: 'bb', 0xed: 'b', 0xee: 'b', 0xef: 'sb', 0xf1: 'b', 0xf2: 'b', 0xf3: 'b', 0xf4: 'b', 0xf5: 's', 0xf8: 'b', 0xf9: 's', 0xfa: 's',
  0xfb: 's', 0xfc: 's',
};
const CHANNEL_ARGS_OOT = argTable(CHANNEL_ARGS);
const CHANNEL_ARGS_MM = argTable({ ...CHANNEL_ARGS, 0xa0: 's', 0xa2: 's', 0xa4: 'b', 0xa6: 'bs', 0xa7: 'b', 0xa8: 'ss', 0xbd: 's', 0xbe: 'b' });

// ---- synthesis (synthesis.c with the NEAD OoT/MM commands as rsp-hle runs them) ------------------------------------

const DMEM_CH = 208; // samples per mixing buffer (DMEM_1CH_SIZE / 2)

interface Resampler { hist: Int16Array; acc: number }

// RSP RESAMPLE: 4-tap interpolation over inp[off..off+n) (zeros past the end) with 4 history samples.
function resample(inp: Int16Array, off: number, n: number, len: number, pitchQ15: number, rs: Resampler, init: boolean, out: Int16Array | Int32Array) {
  const pitch = (pitchQ15 << 1) >>> 0, h = rs.hist, lut = LUT;
  if (init) { h.fill(0); rs.acc = 0; }
  let ipos = -4, acc = rs.acc;
  for (let j = 0; j < len; j++) {
    const q = (acc & 0xfc00) >> 8;
    let v = 0;
    for (let k = 0; k < 4; k++) {
      const i = ipos + k;
      v += (i < 0 ? h[4 + i] : i < n ? inp[off + i] : 0) * lut[q + k];
    }
    out[j] = clamp16(v >> 15);
    acc += pitch;
    ipos += acc >>> 16;
    acc &= 0xffff;
  }
  for (let k = 0; k < 4; k++) {
    const i = ipos + k;
    h[k] = i < 0 ? h[4 + i] : i < n ? inp[off + i] : 0;
  }
  rs.acc = acc;
}

// RSP FILTER: 8-tap FIR, y = sum(c[j] x[n - j]) >> 15 rounded, over whole blocks of 8; rsp-hle first averages the
// coefficient table in place with the previous set, so a static table converges to half gain.
const firIn = new Int32Array(DMEM_CH + 16);
function fir(buf: Int16Array | Int32Array, len: number, table: Int16Array, prev: Int16Array, coef: Int16Array) {
  for (let x = 0; x < 8; x++) {
    const v = (coef[x] + table[x]) >> 1;
    coef[x] = v;
    table[x] = v;
  }
  const count = 8 * Math.ceil(len / 8), inp = firIn;
  inp.set(prev, 0);
  for (let i = 0; i < count; i++) inp[8 + i] = buf[i];
  for (let n = 0; n < count; n++) {
    let v = 0;
    for (let j = 0; j < 8; j++) v += coef[j] * inp[8 + n - j];
    buf[n] = s16((v + 0x4000) >> 15);
  }
  for (let i = 0; i < 8; i++) prev[i] = inp[count + i];
}

interface RingItem { startPos: number; lengthA: number; lengthB: number; toDownL: Int16Array; toDownR: Int16Array }

class Reverb {
  readonly ds: number;
  readonly bufSize: number;
  readonly ringL: Int16Array;
  readonly ringR: Int16Array;
  next = 0; curFrame = 0; framesToIgnore = 2; resampleFlags = 1;
  readonly items: RingItem[][];
  readonly loadL: Resampler = { hist: new Int16Array(4), acc: 0 };
  readonly loadR: Resampler = { hist: new Int16Array(4), acc: 0 };
  readonly filterL: Int16Array | null = null;
  readonly filterR: Int16Array | null = null;
  readonly firL = { prev: new Int16Array(8), coef: new Int16Array(8) };
  readonly firR = { prev: new Int16Array(8), coef: new Int16Array(8) };

  constructor(readonly s: ReverbSettings, mm: boolean, lowPass: Int16Array) {
    this.ds = s.downsampleRate;
    let win = s.windowSize * 64;
    if (mm && (s.windowSize < 4 || win < 256)) win = 256;
    this.bufSize = Math.trunc(win / this.ds);
    this.ringL = new Int16Array(this.bufSize);
    this.ringR = new Int16Array(this.bufSize);
    this.items = [0, 1].map(() => Array.from({ length: UPDATES }, () => ({ startPos: 0, lengthA: 0, lengthB: 0, toDownL: new Int16Array(DMEM_CH), toDownR: new Int16Array(DMEM_CH) })));
    if (s.lpLeft) this.filterL = lowPass.slice(8 * s.lpLeft, 8 * s.lpLeft + 8);
    if (s.lpRight) this.filterR = lowPass.slice(8 * s.lpRight, 8 * s.lpRight + 8);
  }
}

class Mixer {
  readonly reverbs: Reverb[];
  readonly dryL = new Int16Array(DMEM_CH + 16);
  readonly dryR = new Int16Array(DMEM_CH + 16);
  private readonly wetL = new Int16Array(DMEM_CH + 16);
  private readonly wetR = new Int16Array(DMEM_CH + 16);
  private readonly leak = new Int16Array(DMEM_CH + 16);
  private readonly tmp = new Int32Array(1024);
  private readonly inp = new Int16Array(1024);
  private readonly seg = new Int16Array(1024);
  private readonly dsIn = new Int16Array(DMEM_CH + 8);
  private readonly combX = new Int32Array(1024);
  private readonly order = new Int32Array(64);
  private readonly res: Resampler[];

  constructor(readonly eng: Engine, spec: AudioSpec) {
    this.reverbs = spec.reverbs.map((r) => new Reverb(r, eng.mm, eng.a.lowPass));
    this.res = eng.notes.map((n) => ({ hist: n.resHist, acc: 0 }));
  }

  // AudioSynth_InitNextRingBuf: downsampled reverbs write every ds-th wet sample into the ring two tasks later.
  initNextRingBuf(len: number, u: number, r: Reverb) {
    if (r.ds >= 2 && r.framesToIgnore === 0) {
      const it = r.items[r.curFrame][u];
      let j = 0;
      for (let i = 0; i < it.lengthA; i++, j += r.ds) { r.ringL[it.startPos + i] = it.toDownL[j]; r.ringR[it.startPos + i] = it.toDownR[j]; }
      for (let i = 0; i < it.lengthB; i++, j += r.ds) { r.ringL[i] = it.toDownL[j]; r.ringR[i] = it.toDownR[j]; }
    }
    const it = r.items[r.curFrame][u], n = Math.trunc(len / r.ds), extra = n + r.next - r.bufSize;
    it.startPos = r.next;
    if (extra < 0) {
      it.lengthA = n; it.lengthB = 0; r.next += n;
    } else {
      it.lengthA = n - extra; it.lengthB = extra; r.next = extra;
    }
  }

  // One audio task: its script updates run first, then its synthesis updates, each appended to pcm.
  task(lens: number[], pcm: Pcm, onUpdate: (u: number) => void) {
    const e = this.eng;
    for (let u = 0; u < UPDATES; u++) {
      onUpdate(u);
      e.runUpdate(u);
    }
    for (let u = 0; u < UPDATES; u++) {
      const len = lens[u];
      for (const r of this.reverbs) this.initNextRingBuf(len, u, r);
      this.update(len, u);
      pcm.push(this.dryL, this.dryR, len);
    }
    for (const r of this.reverbs) {
      if (r.framesToIgnore) r.framesToIgnore--;
      r.curFrame ^= 1;
    }
  }

  mix(dst: Int16Array, src: Int16Array, gain: number) {
    const g = s16(gain);
    for (let i = 0; i < DMEM_CH; i++) dst[i] = clamp16(dst[i] + ((src[i] * g) >> 15));
  }

  // Per reverb in index order: load the delay line, return it to the dry mix, decay and leak, mix the notes that send
  // to it, low-pass, save. Notes without a reverb follow.
  update(len: number, u: number) {
    const e = this.eng, snaps = e.snaps[u], nr = this.reverbs.length, order = this.order;
    let count = 0;
    for (let r = 0; r < nr; r++) for (let i = 0; i < e.numNotes; i++) if (snaps[i].enabled && snaps[i].reverbIndex === r) order[count++] = i;
    for (let i = 0; i < e.numNotes; i++) if (snaps[i].enabled && snaps[i].reverbIndex >= nr) order[count++] = i;
    const { dryL, dryR, wetL, wetR } = this;
    dryL.fill(0);
    dryR.fill(0);
    let k = 0;
    for (let ri = 0; ri < nr; ri++) {
      const r = this.reverbs[ri], it = r.items[r.curFrame][u];
      wetL.fill(0);
      wetR.fill(0);
      if (r.ds === 1) {
        for (let i = 0; i < it.lengthA; i++) { wetL[i] = r.ringL[it.startPos + i]; wetR[i] = r.ringR[it.startPos + i]; }
        for (let i = 0; i < it.lengthB; i++) { wetL[it.lengthA + i] = r.ringL[i]; wetR[it.lengthA + i] = r.ringR[i]; }
      } else {
        // read from the ring at startPos & ~7 and resample at 1/ds
        const startA = it.startPos - (it.startPos & 7), skip = it.startPos & 7, inp = this.dsIn;
        for (let i = 0; i < DMEM_CH; i++) inp[i] = r.ringL[(startA + i) % r.bufSize];
        resample(inp, skip, DMEM_CH + 8 - skip, len, 0x8000 / r.ds, r.loadL, r.resampleFlags === 1, wetL);
        for (let i = 0; i < DMEM_CH; i++) inp[i] = r.ringR[(startA + i) % r.bufSize];
        resample(inp, skip, DMEM_CH + 8 - skip, len, 0x8000 / r.ds, r.loadR, r.resampleFlags === 1, wetR);
      }
      this.mix(dryL, wetL, r.s.volume);
      this.mix(dryR, wetR, r.s.volume);
      this.mix(wetL, wetL, r.s.decayRatio + 0x8000);
      this.mix(wetR, wetR, r.s.decayRatio + 0x8000);
      if (r.s.leakRtL || r.s.leakLtR) {
        this.leak.set(wetL);
        this.mix(wetL, wetR, r.s.leakRtL);
        this.mix(wetR, this.leak, r.s.leakLtR);
      }
      for (; k < count && snaps[order[k]].reverbIndex === ri; k++) this.processNote(e.notes[order[k]], snaps[order[k]], len, u, order[k]);
      if (r.filterL) fir(wetL, len, r.filterL, r.firL.prev, r.firL.coef);
      if (r.filterR) fir(wetR, len, r.filterR, r.firR.prev, r.firR.coef);
      if (r.ds === 1) {
        for (let i = 0; i < it.lengthA; i++) { r.ringL[it.startPos + i] = wetL[i]; r.ringR[it.startPos + i] = wetR[i]; }
        for (let i = 0; i < it.lengthB; i++) { r.ringL[i] = wetL[it.lengthA + i]; r.ringR[i] = wetR[it.lengthA + i]; }
      } else {
        it.toDownL.set(wetL.subarray(0, DMEM_CH));
        it.toDownR.set(wetR.subarray(0, DMEM_CH));
      }
      r.resampleFlags = 0;
    }
    for (; k < count; k++) this.processNote(e.notes[order[k]], snaps[order[k]], len, u, order[k]);
  }

  // AudioSynth_ProcessNote: load samples (one part, or two parts of every other sample above 2x), resample, gain,
  // filter, comb filter, envelope mix.
  processNote(n: Note, ss: SampleState, len: number, u: number, noteIndex: number) {
    const e = this.eng, rs = this.res[noteIndex];
    let finished = ss.finished;
    if (ss.needsInit) {
      n.pos = n.startSamplePos; n.frac = 0; n.curVolLeft = 0; n.curVolRight = 0; n.reverbVol = ss.reverbVol; n.combNeedsInit = true;
      rs.hist.fill(0); rs.acc = 0; n.firPrev.fill(0); n.firCoef.fill(0);
      n.sample.finished = false;
      finished = false;
    }
    const rate = ss.resampleRate, nParts = ss.hasTwoParts ? 2 : 1;
    const fixed = rate * len * 2 + n.frac, toLoad = Math.floor(fixed / 65536);
    n.frac = fixed % 65536;
    const inp = this.inp;
    let inLen = 0;
    if (ss.isSyntheticWave && ss.wave) {
      let p = n.pos;
      if (ss.harmonicCurPrev !== 0) p = Math.trunc((p * (64 >> (ss.harmonicCurPrev >> 2))) / (64 >> (ss.harmonicCurPrev & 3)));
      p = (p >>> 0) % 64;
      for (let i = 0; i < toLoad; i++) inp[i] = ss.bookOffset ? 0 : ss.wave[ss.waveOff + ((p + i) % 64)];
      inLen = toLoad;
      n.pos = p + toLoad;
    } else {
      const smp = ss.tuned?.sample;
      if (!smp) return;
      const pcm = e.a.prepare(smp), buf = pcm.buf, silentAt = pcm.silentAt, wrapAt = pcm.wrapAt, wrapLen = pcm.wrapLen;
      for (let part = 0; part < nParts && !finished; part++) {
        const adj = nParts === 1 ? toLoad : toLoad & 1 ? (toLoad & ~1) + part * 2 : toLoad;
        const seg = nParts === 1 ? inp : this.seg;
        let got = 0, pos = n.pos;
        while (got < adj) {
          if (pos >= silentAt) { finished = true; break; }
          seg[got++] = buf[pos++];
          if (pos >= wrapAt) pos -= wrapLen;
        }
        n.pos = pos;
        seg.fill(0, got, adj + 1);
        if (finished) {
          n.sample.finished = true;
          for (let v = u + 1; v < UPDATES; v++) {
            const s2 = e.snaps[v][noteIndex];
            if (!s2.needsInit) s2.enabled = false;
            else break;
          }
        }
        if (nParts === 1) {
          inLen = adj;
        } else {
          const half = Math.ceil(adj / 2);
          for (let i = 0; i < half; i++) inp[inLen + i] = seg[2 * i];
          inLen += half;
        }
      }
    }
    const out = this.tmp;
    out.fill(0, 0, len + 16);
    if (rate !== 0) resample(inp, 0, inLen, len, rate, rs, false, out);
    if (ss.gain !== 0) { // HILOGAIN, Q4.4
      const g = s8(ss.gain < 0x10 ? 0x10 : ss.gain);
      for (let i = 0; i < len + 16; i++) out[i] = clamp16((out[i] * g) >> 4);
    }
    if (ss.filter) fir(out, len, ss.filter, n.firPrev, n.firCoef);
    if (ss.combFilterSize !== 0 && ss.combFilterGain !== 0) { // y[n] = x[n - d] + x[n] * gain
      const d = ss.combFilterSize >> 1, g = s16(ss.combFilterGain), x = this.combX;
      if (n.combNeedsInit) { n.comb.fill(0); n.combNeedsInit = false; }
      for (let i = 0; i < len; i++) x[i] = out[i];
      for (let i = 0; i < len; i++) out[i] = clamp16((i < d ? n.comb[i] : x[i - d]) + ((x[i] * g) >> 15));
      for (let i = 0; i < d; i++) n.comb[i] = x[len - d + i];
    } else {
      n.combNeedsInit = true;
    }
    this.envMix(n, ss, out, len);
  }

  // ENVMIXER: dry (x * vol) >> 16 per side and wet (dry * send) >> 16 with 8-sample ramps; the send is twice SF64's and
  // bit 7 of the reverb byte swaps the wet sides.
  envMix(n: Note, ss: SampleState, buf: Int32Array, len: number) {
    const steps = len >> 3;
    const tL = u16(ss.targetVolLeft << 4), tR = u16(ss.targetVolRight << 4), cL = n.curVolLeft, cR = n.curVolRight;
    const rampL = tL !== cL ? s16(Math.trunc((tL - cL) / steps)) : 0;
    const rampR = tR !== cR ? s16(Math.trunc((tR - cR) / steps)) : 0;
    const src = n.reverbVol, phi = src & 0x7f;
    let rampRev = 0;
    if (src !== ss.reverbVol) {
      rampRev = s16(Math.trunc((((ss.reverbVol & 0x7f) - phi) << 9) / steps));
      n.reverbVol = ss.reverbVol;
    }
    n.curVolLeft = u16(cL + rampL * steps);
    n.curVolRight = u16(cR + rampR * steps);
    let vL = cL, vR = cR, vW = ((phi * 2) & 0xff) << 8;
    const x0 = ss.strongRight ? -1 : 0, x1 = ss.strongLeft ? -1 : 0, x2 = ss.headsetFx ? -4 : 0, x3 = ss.headsetPanFx ? -2 : 0;
    const swap = (src & 0x80) !== 0, dl = this.dryL, dr = this.dryR;
    const wl = swap ? this.wetR : this.wetL, wr = swap ? this.wetL : this.wetR;
    const count = (len + 7) & ~7;
    for (let j = 0; j < count; j += 8) {
      for (let i = j; i < j + 8; i++) {
        const x = buf[i];
        const l = s16((x * vL) >> 16) ^ x0, r = s16((x * vR) >> 16) ^ x1;
        dl[i] = clamp16(dl[i] + l);
        dr[i] = clamp16(dr[i] + r);
        wl[i] = clamp16(wl[i] + (s16((l * vW) >> 16) ^ x2));
        wr[i] = clamp16(wr[i] + (s16((r * vW) >> 16) ^ x3));
      }
      vL = u16(vL + rampL);
      vR = u16(vR + rampR);
      vW = u16(vW + rampRev);
    }
  }
}

// ---- rendering -----------------------------------------------------------------------------------------------------

// Interleaved 16-bit blocks while rendering: half the size of the final Float32 channels, built once the length is known.
class Pcm {
  private blocks: Int16Array[] = [];
  private block = new Int16Array(0);
  private fill = 0;
  length = 0;

  push(l: Int16Array, r: Int16Array, len: number) {
    let b = this.block, k = this.fill;
    for (let j = 0; j < len; j++) {
      if (k === b.length) { b = new Int16Array(2 * PCM_BLOCK); this.blocks.push(b); k = 0; }
      b[k++] = l[j];
      b[k++] = r[j];
    }
    this.block = b;
    this.fill = k;
    this.length += len;
  }

  channels(frames: number, gain: number, fadeFrames: number): Float32Array[] {
    const L = new Float32Array(frames), R = new Float32Array(frames), scale = gain / 32768, fadeFrom = frames - fadeFrames;
    for (let bi = 0, i = 0; i < frames; bi++) {
      const b = this.blocks[bi];
      for (let k = 0; k < b.length && i < frames; k += 2, i++) {
        const f = i < fadeFrom ? scale : (scale * (frames - i)) / fadeFrames;
        L[i] = Math.max(-1, Math.min(1, b[k] * f));
        R[i] = Math.max(-1, Math.min(1, b[k + 1] * f));
      }
    }
    this.blocks = [];
    return [L, R];
  }
}

// Plays a sequence from the start with the track's spec and IO. A looping song ends its loop with a sequence-level
// backward jump: the render stops at its third execution, and [second, third) is the loop. A song that ends renders
// until 1 s of silence (at most 8 s past the end); a fixed-length track renders its length and fades out.
function render(data: AudioData, track: Zelda64Track): DecodedMusic {
  const spec = data.specs[track.spec];
  if (!spec) throw new Error(`Zelda audio: no spec ${track.spec}`);
  const eng = new Engine(data, spec.numNotes);
  const mixer = new Mixer(eng, spec);
  const perUpdate = Math.trunc(Math.trunc((RATE / 60 + 15) & ~15) / UPDATES) & ~7; // 176, clamped to 168..184
  const lens = [0, 0, 0];
  const pcm = new Pcm();
  const maxFrames = (track.seconds ?? MAX_SECONDS) * RATE;
  const passStarts: number[] = [];
  let loopTarget = -1, pos = 0, updatePos = 0, loopUpdateEnd = -1, u = 0;
  eng.onSeqBackJump = (target) => {
    if (loopTarget < 0) loopTarget = target;
    if (target !== loopTarget) return;
    passStarts.push(updatePos);
    if (passStarts.length > LOOP_PASSES && loopUpdateEnd < 0) loopUpdateEnd = updatePos + lens[u];
  };
  const onUpdate = (k: number) => {
    u = k;
    updatePos = pos;
    for (let i = 0; i < k; i++) updatePos += lens[i];
  };
  eng.start(seqIdOf(track), track.io ?? {});
  let ended: 'loop' | 'end' | 'max' = 'max', endAt = -1, silentSince = -1, frac = 0;
  while (pos < maxFrames) {
    frac += RATE / 60;
    let rem = Math.floor(frac);
    frac -= rem;
    for (let i = UPDATES, k = 0; i > 0; i--, k++) {
      const avg = Math.trunc(rem / i);
      lens[k] = i === 1 ? rem : avg >= perUpdate + 8 ? perUpdate + 8 : perUpdate - 8 >= avg ? perUpdate - 8 : perUpdate;
      rem -= lens[k];
    }
    mixer.task(lens, pcm, onUpdate);
    pos = pcm.length;
    if (passStarts.length > LOOP_PASSES) { ended = 'loop'; break; }
    if (!eng.player.enabled && endAt < 0) endAt = pos;
    if (endAt >= 0) {
      if (eng.activeNotes() !== 0) silentSince = -1;
      else if (silentSince < 0) silentSince = pos;
      if ((silentSince >= 0 && pos - silentSince > RATE) || pos - endAt > 8 * RATE) { ended = 'end'; break; }
    }
  }
  const frames = ended === 'loop' ? loopUpdateEnd : ended === 'max' ? Math.min(pos, maxFrames) : pos;
  const fade = ended === 'max' && track.seconds ? FADE_SECONDS * RATE : 0;
  const music: DecodedMusic = { sampleRate: RATE, channels: pcm.channels(frames, GAIN, fade) };
  if (ended === 'loop') {
    music.loopStart = passStarts[passStarts.length - 2];
    music.loopEnd = passStarts[passStarts.length - 1];
  }
  return music;
}

const seqIdOf = (track: Zelda64Track) => track.index;
