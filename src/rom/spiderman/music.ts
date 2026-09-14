// Spider-Man (USA) soundtrack: prerecorded Nintendo VADPCM fragments played by
// Nintendo Sound Tools / Software Creations through libultra's ABI1 mixer.
//
// Gameplay does not use song sequence files. The compiled scheduler replaces a
// dedicated effect voice after fixed durations, while several stages gate a
// single looping effect. The 36 entries below are the complete production set:
// title/menu, 26 fixed schedules (including both retail variants), and nine
// adaptive profiles.
import { prepareWave, RESAMPLE_LUT, type PreparedWave, type Wave } from '../music/libultra';
import type { DecodedMusic, MusicTrack } from '../types';
import type { SpiderManFs } from './fs';

const OUTPUT_RATE = 22047;
// The schedule words and their ordering are verified. Their 30-Hz conversion is
// the research spec's remaining timing hypothesis (60 Hz is the live-check
// alternative); keeping it explicit makes a future correction local.
const SCHEDULE_TICKS_PER_SECOND = 30;
const BOOT_RAM_BASE = 0x80016ae0;
const EXPECTED_BOOT_LENGTH = 0xf2ef0;
const BFX_LENGTH = 28366;
const PTR_LENGTH = 176294;
const WBK_LENGTH = 14032866;

interface FixedProfile {
  kind: 'fixed';
  title: string;
  effectTable: number;
  durationTable: number;
  effects: readonly number[];
  ticks: readonly number[];
  restartIndex: number;
}

interface EffectProfile {
  kind: 'effect';
  title: string;
  effect: number;
}

type MusicProfile = FixedProfile | EffectProfile;

const fixed = (
  title: string,
  effectTable: number,
  durationTable: number,
  effects: readonly number[],
  ticks: readonly number[],
  restartIndex = 0,
): FixedProfile => ({ kind: 'fixed', title, effectTable, durationTable, effects, ticks, restartIndex });

// Addresses and contents are the exact tables used by scheduler 0x8004C708.
const FIXED_PROFILES: readonly FixedProfile[] = [
  fixed('Race to the Bugle', 0x800ec290, 0x800ec2a4, [415, 416, 431, 432, 433], [208, 208, 208, 208, 208]),
  fixed('Spidey vs. Scorpion!', 0x800ec2b8, 0x800ec2c4, [458, 459, 457], [410, 210, 210]),
  fixed('Missile Attack', 0x800ec2d0, 0x800ec300, [436, 436, 434, 434, 437, 436, 435, 437, 436, 434, 434, 435], [115, 115, 230, 230, 115, 115, 471, 115, 115, 230, 230, 471]),
  fixed('Spidey vs. Rhino!', 0x800ec330, 0x800ec344, [396, 397, 398, 398, 400], [122, 122, 122, 242, 242]),
  fixed('Catch Venom', 0x800ec358, 0x800ec364, [393, 394, 395], [108, 108, 108]),
  fixed('Spidey vs. Venom!', 0x800ec370, 0x800ec37c, [389, 390, 391], [115, 115, 115]),
  fixed('Subway', 0x800ec388, 0x800ec398, [364, 365, 366, 367], [235, 235, 235, 235]),
  fixed('Tunnel Crawl', 0x800ec3a8, 0x800ec3b8, [410, 411, 410, 411], [208, 208, 208, 208]),
  fixed("Venom's Puzzle", 0x800ec3c8, 0x800ec3d8, [373, 374, 373, 374], [208, 208, 208, 208]),
  fixed("The Lizard's Maze", 0x800ec3e8, 0x800ec3fc, [373, 374, 373, 374, 373], [208, 208, 208, 208, 208]),
  fixed('Spidey vs. Venom Again!', 0x800ec410, 0x800ec41c, [438, 439, 440], [287, 287, 287]),
  fixed('Symbiotes Infest Bugle', 0x800ec428, 0x800ec450, [419, 419, 420, 420, 420, 421, 421, 422, 422, 422], [158, 158, 158, 158, 158, 158, 161, 161, 158, 158]),
  fixed('Elevator Descent', 0x800ec478, 0x800ec49c, [396, 396, 398, 398, 396, 396, 397, 398, 398], [119, 119, 119, 119, 119, 119, 238, 119, 119]),
  fixed("Bugle's Basement", 0x800ec4c0, 0x800ec4e8, [379, 379, 380, 380, 381, 381, 380, 380, 381, 381], [132, 132, 132, 132, 266, 266, 132, 132, 266, 266]),
  fixed('Spidey vs. Mysterio! (variant 0)', 0x800ec510, 0x800ec558, [423, 423, 424, 424, 424, 424, 428, 428, 428, 428, 428, 427, 427, 427, 424, 424, 424, 424], [117, 117, 235, 235, 235, 235, 117, 117, 235, 235, 235, 235, 117, 117, 235, 235, 235, 235]),
  fixed('Spidey vs. Mysterio! (variant 1)', 0x800ec5a0, 0x800ec5c8, [427, 427, 427, 427, 425, 424, 425, 424, 428, 428], [235, 235, 235, 235, 235, 235, 235, 235, 117, 117]),
  fixed('Underwater Trench', 0x800ec5f0, 0x800ec620, [405, 405, 405, 406, 406, 406, 408, 408, 408, 409, 409, 409], [256, 256, 256, 256, 256, 256, 256, 256, 256, 256, 256, 256]),
  fixed('Spidey vs. Doc Ock!', 0x800ec650, 0x800ec65c, [386, 386, 386], [300, 320, 245]),
  fixed('Spidey vs. Carnage!', 0x800ec668, 0x800ec678, [368, 369, 370, 371], [235, 235, 235, 235]),
  fixed('Spidey vs. Monster-Ock!', 0x800ec688, 0x800ec69c, [452, 453, 454, 455, 452], [235, 235, 235, 235, 235]),
  fixed('L9 training', 0x800ec6b0, 0x800ec6c8, [458, 458, 459, 459, 459, 459], [204, 204, 204, 204, 204, 204]),
  fixed('LB/LC training', 0x800ec6e0, 0x800ec718, [460, 460, 460, 460, 461, 461, 461, 461, 462, 462, 462, 463, 463, 463], [124, 124, 124, 124, 248, 248, 248, 248, 248, 248, 248, 248, 248, 248]),
  fixed('LD training', 0x800ec750, 0x800ec760, [468, 469, 470, 471], [112, 112, 112, 113]),
  fixed('LG training (variant A)', 0x800ec770, 0x800ec774, [403], [400]),
  fixed('LG training (variant B)', 0x800ec778, 0x800ec77c, [404], [400]),
  fixed('LH training', 0x800ec780, 0x800ec7b4, [447, 447, 448, 448, 449, 449, 449, 450, 450, 450, 449, 449, 450], [317, 317, 317, 317, 317, 317, 317, 317, 317, 317, 317, 317, 317], 3),
];

// Static previews use the active side of each gameplay-controlled gate. These
// are the exact nonzero/zero selections returned by selector 0x8004C560.
const ADAPTIVE_PROFILES: readonly EffectProfile[] = [
  { kind: 'effect', title: 'Get to the Bank! / Bank Approach', effect: 444 },
  { kind: 'effect', title: 'Hostage Situation / Stop the Bomb!', effect: 375 },
  { kind: 'effect', title: 'Police Chopper Chase / Building Top Chase / Scale the Girders / Police Evaded', effect: 435 },
  { kind: 'effect', title: 'Sewer Entrance / Sewer Cavern', effect: 441 },
  { kind: 'effect', title: 'Sewage Plant', effect: 418 },
  { kind: 'effect', title: 'Hidden Switches', effect: 414 },
  { kind: 'effect', title: 'Stop the Presses!', effect: 378 },
  { kind: 'effect', title: 'Waterfront Warehouse', effect: 404 },
  { kind: 'effect', title: 'Stopping the Fog', effect: 465 },
];

const PROFILES: readonly MusicProfile[] = [
  { kind: 'effect', title: 'Title / Menus', effect: 988 },
  ...FIXED_PROFILES,
  ...ADAPTIVE_PROFILES,
];

interface ParsedWave extends Wave {
  index: number;
  baseNote: number;
  fineTune: number;
}

interface Effect {
  wave: ParsedWave;
  volume: number;
  step: number;
}

interface AudioBank {
  wbk: Uint8Array;
  effects: Effect[];
}

function ensureRange(bytes: Uint8Array, offset: number, length: number, what: string) {
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || offset + length > bytes.length)
    throw new Error(`Spider-Man music ${what} lies outside its file`);
}

function u16(bytes: Uint8Array, offset: number, what = 'u16'): number {
  ensureRange(bytes, offset, 2, what);
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function s16(bytes: Uint8Array, offset: number, what = 's16'): number {
  return (u16(bytes, offset, what) << 16) >> 16;
}

function u32(bytes: Uint8Array, offset: number, what = 'u32'): number {
  ensureRange(bytes, offset, 4, what);
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function s32(bytes: Uint8Array, offset: number, what = 's32'): number {
  return u32(bytes, offset, what) | 0;
}

function s8(value: number): number {
  return (value << 24) >> 24;
}

function hasAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset < 0 || offset + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  return true;
}

function packed15(bytes: Uint8Array, offset: number, what: string): [number, number] {
  ensureRange(bytes, offset, 1, what);
  const first = bytes[offset];
  if (!(first & 0x80)) return [first, 1];
  ensureRange(bytes, offset, 2, what);
  return [((first & 0x7f) << 8) | bytes[offset + 1], 2];
}

// Sound Tools 3.14 __MusIntPowerOf2, including its single-precision
// intermediates and sixth-order approximation.
function soundToolsPow2(value: number): number {
  let x = Math.fround(value);
  if (x === 0) return 1;
  const negative = x < 0;
  if (negative) x = -x;
  const x2 = Math.fround(x * x);
  const x3 = Math.fround(x2 * x);
  const x4 = Math.fround(x2 * x2);
  const x5 = Math.fround(x4 * x);
  const x6 = Math.fround(x4 * x2);
  const approximation = 1 + x * 0.693147180559945
    + x2 * 0.240226506959101
    + x3 * 0.0555041086648216
    + x4 * 0.00961812910762848
    + x5 * 0.00133335581464284
    + x6 * 0.000154035303933816;
  return Math.fround(negative ? 1 / approximation : approximation);
}

function parsePtr(ptr: Uint8Array, wbk: Uint8Array): ParsedWave[] {
  if (ptr.length !== PTR_LENGTH || !hasAscii(ptr, 0, 'N64 PtrTablesV2\0'))
    throw new Error('Spider-Man Sound Tools PTR bank not found');
  if (wbk.length !== WBK_LENGTH || !hasAscii(wbk, 0, 'N64 WaveTables \0'))
    throw new Error('Spider-Man Sound Tools WBK bank not found');
  const count = u32(ptr, 0x20, 'PTR wave count');
  const noteBase = u32(ptr, 0x24, 'PTR note table');
  const fineBase = u32(ptr, 0x28, 'PTR fine-tune table');
  const pointerBase = u32(ptr, 0x2c, 'PTR descriptor table');
  if (count !== 996) throw new Error(`Spider-Man PTR has ${count} waves (expected 996)`);
  ensureRange(ptr, noteBase, count, 'PTR note table');
  ensureRange(ptr, fineBase, count * 4, 'PTR fine-tune table');
  ensureRange(ptr, pointerBase, count * 4, 'PTR descriptor table');

  return Array.from({ length: count }, (_, index): ParsedWave => {
    const descriptor = u32(ptr, pointerBase + index * 4, `PTR wave ${index} descriptor`);
    ensureRange(ptr, descriptor, 20, `PTR wave ${index} descriptor`);
    const base = u32(ptr, descriptor, `PTR wave ${index} base`);
    const len = u32(ptr, descriptor + 4, `PTR wave ${index} length`);
    const loopOffset = u32(ptr, descriptor + 12, `PTR wave ${index} loop`);
    const bookOffset = u32(ptr, descriptor + 16, `PTR wave ${index} book`);
    ensureRange(wbk, base, len, `PTR wave ${index} samples`);
    if (len % 9 !== 0) throw new Error(`Spider-Man PTR wave ${index} is not VADPCM-frame aligned`);
    ensureRange(ptr, bookOffset, 8, `PTR wave ${index} codebook`);
    const order = s32(ptr, bookOffset, `PTR wave ${index} codebook order`);
    const predictors = s32(ptr, bookOffset + 4, `PTR wave ${index} predictor count`);
    if (order !== 2 || predictors !== 4)
      throw new Error(`Spider-Man PTR wave ${index} has unsupported ADPCM order/predictors ${order}/${predictors}`);
    const bookEntries = order * predictors * 8;
    ensureRange(ptr, bookOffset + 8, bookEntries * 2, `PTR wave ${index} codebook coefficients`);
    const book = Int16Array.from({ length: bookEntries }, (_, i) => s16(ptr, bookOffset + 8 + i * 2));

    let loopStart = 0;
    let loopEnd = 0;
    let loopCount = 0;
    let loopState: Int16Array | null = null;
    if (loopOffset !== 0) {
      ensureRange(ptr, loopOffset, 44, `PTR wave ${index} loop`);
      loopStart = u32(ptr, loopOffset);
      loopEnd = u32(ptr, loopOffset + 4);
      loopCount = u32(ptr, loopOffset + 8);
      loopState = Int16Array.from({ length: 16 }, (_, i) => s16(ptr, loopOffset + 12 + i * 2));
      const sampleCapacity = (len / 9) * 16;
      if (!(loopStart < loopEnd && loopEnd <= sampleCapacity))
        throw new Error(`Spider-Man PTR wave ${index} has invalid loop ${loopStart}..${loopEnd}`);
    }
    return {
      index,
      base,
      len,
      type: 0,
      book,
      loopStart,
      loopEnd,
      loopCount,
      loopState,
      baseNote: ptr[noteBase + index],
      fineTune: s8(ptr[fineBase + index * 4]),
    };
  });
}

function parseBfx(bfx: Uint8Array, waves: ParsedWave[]): Effect[] {
  if (bfx.length !== BFX_LENGTH) throw new Error(`Spider-Man BFX has unexpected size ${bfx.length}`);
  const componentCount = s32(bfx, 0, 'BFX component count');
  const effectCount = s32(bfx, 4, 'BFX effect count');
  const localWaveCount = s32(bfx, 8, 'BFX local wave count');
  const waveTable = u32(bfx, 0x14, 'BFX local wave table');
  if (componentCount !== 994 || effectCount !== 994 || localWaveCount !== 992 || waveTable !== 0x670e)
    throw new Error('Spider-Man Sound Tools BFX bank header is not supported');
  ensureRange(bfx, 0x18, componentCount * 8, 'BFX component table');
  ensureRange(bfx, waveTable, localWaveCount * 2, 'BFX local wave table');
  const localWaves = Array.from({ length: localWaveCount }, (_, i) => u16(bfx, waveTable + i * 2));
  if (localWaves.some((wave) => wave >= waves.length)) throw new Error('Spider-Man BFX references an invalid PTR wave');

  return Array.from({ length: effectCount }, (_, index): Effect => {
    const entry = 0x18 + index * 8;
    const priority = s32(bfx, entry + 4, `BFX effect ${index} priority`);
    const start = u32(bfx, entry, `BFX effect ${index} component`);
    const end = index + 1 < effectCount ? u32(bfx, entry + 8, `BFX effect ${index + 1} component`) : waveTable;
    if (start >= end || end > waveTable) throw new Error(`Spider-Man BFX effect ${index} has invalid component bounds`);
    let pos = start;
    // A few non-music effects use a 95 repeat prefix. Parse it so validating
    // the complete effect bank does not special-case production track IDs.
    if (bfx[pos] === 0x95) {
      ensureRange(bfx, pos, 3, `BFX effect ${index} repeat prefix`);
      if (bfx[pos + 2] !== 0x81) throw new Error(`Spider-Man BFX effect ${index} has unsupported binding prefix`);
      pos += 3;
    } else if (bfx[pos++] !== 0x81) {
      throw new Error(`Spider-Man BFX effect ${index} has unsupported binding`);
    }
    const [localWave, waveBytes] = packed15(bfx, pos, `BFX effect ${index} wave`);
    pos += waveBytes;
    if (localWave >= localWaves.length) throw new Error(`Spider-Man BFX effect ${index} has invalid local wave ${localWave}`);
    ensureRange(bfx, pos, 13, `BFX effect ${index} component body`);
    if (bfx[pos] !== 0x84 || bfx[pos + 8] !== 0x9c || bfx[pos + 10] !== 0xa6)
      throw new Error(`Spider-Man BFX effect ${index} has unsupported component bytecode`);
    const pan = bfx[pos + 9];
    const volume = bfx[pos + 11];
    const note = bfx[pos + 12];
    const [eventLength, lengthBytes] = packed15(bfx, pos + 13, `BFX effect ${index} length`);
    pos += 13 + lengthBytes;
    if (pos > end) throw new Error(`Spider-Man BFX effect ${index} component is truncated`);

    const wave = waves[localWaves[localWave]];
    const basePitch = s8((wave.baseNote - 48) & 0xff);
    const fine = Math.fround(Math.fround(wave.fineTune) / 100);
    const detune = Math.fround(fine + Math.fround(basePitch));
    const semitones = Math.fround(Math.fround(note) + detune);
    const ratio = Math.min(soundToolsPow2(semitones * (1 / 12)), 1.99996);
    const step = Math.trunc(Math.fround(ratio) * 32768) * 2;
    if (volume > 127 || step <= 0) throw new Error(`Spider-Man BFX effect ${index} has invalid playback parameters`);

    // The complete homogeneous music-stem block and title effect have the same
    // direct, indefinite, center-panned component shape. Guarding it here also
    // proves that the viewer did not accidentally bind a neighboring SFX.
    if ((index >= 364 && index <= 471) || index === 988) {
      const expectedEnvelope = [1, 127, 1, 127, 1, 127, 16];
      for (let i = 0; i < expectedEnvelope.length; i++) {
        if (bfx[start + 1 + waveBytes + i + 1] !== expectedEnvelope[i])
          throw new Error(`Spider-Man music effect ${index} has an unexpected envelope`);
      }
      if (priority !== 100 || pan !== 127 || note !== 48 || eventLength !== 0x7fff
        || semitones !== -11 || pos + 1 !== end || bfx[pos] !== 0x80
        || wave.loopCount !== 0xffffffff)
        throw new Error(`Spider-Man music effect ${index} does not match the Sound Tools music profile`);
    }
    return { wave, volume, step };
  });
}

function validateSchedules(boot: Uint8Array) {
  if (boot.length !== EXPECTED_BOOT_LENGTH) throw new Error(`Spider-Man main image has unexpected size ${boot.length}`);
  for (const profile of FIXED_PROFILES) {
    if (profile.effects.length !== profile.ticks.length || profile.restartIndex < 0 || profile.restartIndex >= profile.effects.length)
      throw new Error(`Spider-Man music profile ${profile.title} is invalid`);
    const effectOffset = profile.effectTable - BOOT_RAM_BASE;
    const durationOffset = profile.durationTable - BOOT_RAM_BASE;
    for (let i = 0; i < profile.effects.length; i++) {
      const packedEffect = u32(boot, effectOffset + i * 4, `${profile.title} effect table`);
      const ticks = u32(boot, durationOffset + i * 4, `${profile.title} duration table`);
      if (packedEffect !== (0x10000 | profile.effects[i]) || ticks !== profile.ticks[i])
        throw new Error(`Spider-Man music schedule ${profile.title} does not match this ROM`);
    }
  }
}

function parseAudioBank(fs: SpiderManFs): AudioBank {
  const wbk = fs.getFile(5, 0);
  const bfx = fs.getFile(6, 0);
  const ptr = fs.getFile(6, 1);
  const waves = parsePtr(ptr, wbk);
  return { wbk, effects: parseBfx(bfx, waves) };
}

function sourceFrameCount(sourcePosition: number, step: number): number {
  // A fresh ABI1 resampler starts four source samples before the wave.
  return Math.ceil(((sourcePosition + 4) * 0x10000) / step);
}

function renderFrames(effect: Effect, prepared: PreparedWave, frames: number, target: Float32Array, targetOffset: number) {
  const { buf, wrapAt, wrapLen, silentAt } = prepared;
  const gain = effect.volume / 127;
  let pos = -4;
  let accumulator = 0;
  for (let j = 0; j < frames; j++) {
    let sample = 0;
    if (pos < silentAt) {
      const phase = (accumulator >> 8) & 0xfc;
      if (pos >= 0) {
        sample = (buf[pos] * RESAMPLE_LUT[phase]
          + buf[pos + 1] * RESAMPLE_LUT[phase + 1]
          + buf[pos + 2] * RESAMPLE_LUT[phase + 2]
          + buf[pos + 3] * RESAMPLE_LUT[phase + 3]) >> 15;
      } else {
        for (let tap = 0; tap < 4; tap++) if (pos + tap >= 0) sample += buf[pos + tap] * RESAMPLE_LUT[phase + tap];
        sample >>= 15;
      }
      sample = Math.max(-32768, Math.min(32767, sample));
    }
    target[targetOffset + j] = (sample / 32768) * gain;
    accumulator += effect.step;
    pos += accumulator >> 16;
    accumulator &= 0xffff;
    if (pos >= wrapAt) pos -= wrapLen;
  }
}

function stereo(left: Float32Array, loopStart: number, loopEnd: number): DecodedMusic {
  // Never return cached/shared channel buffers: decoded music is transferred out
  // of the worker, which detaches each ArrayBuffer.
  return { sampleRate: OUTPUT_RATE, channels: [left, left.slice()], loopStart, loopEnd };
}

function renderEffect(bank: AudioBank, effectIndex: number): DecodedMusic {
  const effect = bank.effects[effectIndex];
  if (!effect) throw new Error(`Spider-Man music effect ${effectIndex} is missing`);
  const wave = effect.wave;
  if (wave.loopCount === 0 || wave.loopEnd <= wave.loopStart)
    throw new Error(`Spider-Man music effect ${effectIndex} does not have a stored loop`);
  const prepared = prepareWave(bank.wbk, wave);
  // Render the game's one-time [0, loopEnd) pass and scale the authored PTR
  // loop points into mixer samples. prepareWave provides loop-state lookahead
  // at loopEnd so the four-tap filter does not read post-loop stored bytes.
  const loopStart = sourceFrameCount(wave.loopStart, effect.step);
  const loopEnd = sourceFrameCount(wave.loopEnd, effect.step);
  const left = new Float32Array(loopEnd);
  renderFrames(effect, prepared, left.length, left, 0);
  return stereo(left, loopStart, loopEnd);
}

function renderFixed(bank: AudioBank, profile: FixedProfile): DecodedMusic {
  const lengths = profile.ticks.map((ticks) => Math.round((ticks * OUTPUT_RATE) / SCHEDULE_TICKS_PER_SECOND));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const loopStart = lengths.slice(0, profile.restartIndex).reduce((sum, length) => sum + length, 0);
  const left = new Float32Array(total);
  let offset = 0;
  for (let i = 0; i < profile.effects.length; i++) {
    const effectIndex = profile.effects[i];
    const effect = bank.effects[effectIndex];
    if (!effect) throw new Error(`Spider-Man music effect ${effectIndex} is missing`);
    if (effect.wave.loopCount === 0 || effect.wave.loopEnd <= effect.wave.loopStart)
      throw new Error(`Spider-Man music effect ${effectIndex} does not have a stored loop`);
    renderFrames(effect, prepareWave(bank.wbk, effect.wave), lengths[i], left, offset);
    offset += lengths[i];
  }
  return stereo(left, loopStart, total);
}

export function spiderManMusic(fs: SpiderManFs): { tracks: MusicTrack[]; decode(index: number): DecodedMusic } {
  if (PROFILES.length !== 36) throw new Error(`Spider-Man has ${PROFILES.length} music profiles (expected 36)`);
  validateSchedules(fs.bootImage());
  let bank: AudioBank | undefined;
  const tracks = PROFILES.map(({ title }, index) => ({ index, name: `${String(index).padStart(2, '0')} ${title}` }));
  return {
    tracks,
    decode(index: number): DecodedMusic {
      const profile = PROFILES[index];
      if (!Number.isInteger(index) || !profile) throw new Error(`No Spider-Man music track ${index}`);
      bank ??= parseAudioBank(fs);
      return profile.kind === 'fixed' ? renderFixed(bank, profile) : renderEffect(bank, profile.effect);
    },
  };
}
