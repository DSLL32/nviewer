// Shadows of the Empire selects ALSound slots directly, not MIDI sequences.
// The catalog has no verified song names or level assignments; each entry is
// therefore identified by its ROM sound-slot number.
import { parseBank, prepareWave, type Bank } from '../music/libultra';
import type { DecodedMusic, MusicTrack } from '../types';

const OUTPUT_RATE = 22047;
const SOUND_COUNT = 131;
const ROOT_US = 0x1f30;
const ROOT_EU = 0x1e70;

const u32 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;

function bankOffsets(rom: Uint8Array): { control: number; samples: number } {
  const root = rom[0x3e] === 0x50 ? ROOT_EU : ROOT_US;
  if (root + 0x20 > rom.length || String.fromCharCode(...rom.subarray(root, root + 4)) !== 'Ogre') {
    throw new Error('Shadows of the Empire Ogre directory not found');
  }
  const control = u32(rom, root + 0x10);
  const controlEnd = u32(rom, root + 0x14);
  const samples = u32(rom, root + 0x18);
  const samplesEnd = u32(rom, root + 0x1c);
  if (control >= controlEnd || controlEnd !== samples || samples >= samplesEnd || samplesEnd > rom.length ||
      rom[control] !== 0x42 || rom[control + 1] !== 0x31) {
    throw new Error('Shadows of the Empire sound bank is invalid');
  }
  return { control, samples };
}

export function shadowsMusic(rom: Uint8Array): { tracks: MusicTrack[]; decode(index: number): DecodedMusic } {
  const { control, samples } = bankOffsets(rom);
  let bank: Bank | undefined;
  const tracks = Array.from({ length: SOUND_COUNT }, (_, index) => ({
    index,
    name: `Cue ${String(index).padStart(3, '0')}`,
  }));

  return {
    tracks,
    decode(index: number): DecodedMusic {
      if (!Number.isInteger(index) || index < 0 || index >= SOUND_COUNT) {
        throw new Error(`No Shadows of the Empire cue ${index}`);
      }
      bank ??= parseBank(rom, control, samples, 0, null);
      const sound = bank.instruments[0]?.sounds[index];
      if (!sound) throw new Error(`Shadows of the Empire cue ${index} is missing from the bank`);
      const wave = sound.wave;
      if (wave.base < samples || wave.len < 0 || wave.base + wave.len > rom.length || wave.type !== 0 || !wave.book) {
        throw new Error(`Shadows of the Empire cue ${index} has an invalid VADPCM wave`);
      }

      // prepareWave preserves libultra's loop decoder state. It appends one
      // state-correct loop pass after the first pass, so the browser can loop
      // that appended region without accumulating an ADPCM seam.
      const prepared = prepareWave(rom, wave);
      const sourceEnd = Number.isFinite(prepared.wrapAt) ? prepared.wrapAt : prepared.silentAt;
      const count = Math.ceil(sourceEnd * OUTPUT_RATE / bank.sampleRate);
      const pcm = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const source = i * bank.sampleRate / OUTPUT_RATE;
        const lo = Math.floor(source);
        const t = source - lo;
        pcm[i] = (prepared.buf[lo] * (1 - t) + prepared.buf[lo + 1] * t) / 32768;
      }
      // The prepared buffer is at most transient; retain only the decoded
      // Float32Array returned to the player, not an extra Int16 copy per cue.
      wave.prepared = undefined;

      const result: DecodedMusic = { sampleRate: OUTPUT_RATE, channels: [pcm] };
      if (Number.isFinite(prepared.wrapAt)) {
        result.loopStart = Math.ceil(wave.loopEnd * OUTPUT_RATE / bank.sampleRate);
        result.loopEnd = count;
      }
      return result;
    },
  };
}
