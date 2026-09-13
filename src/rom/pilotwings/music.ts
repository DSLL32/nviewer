// Pilotwings 64 soundtrack: all 31 entries in the in-game Sound Track menu, rendered with the stock libultra
// compressed-MIDI player. The sequence (S1), control-bank (B1), and sample-table addresses are loaded from the
// kernel's address literals, which are at the same ROM offsets in the US, European, and Japanese releases.
//
// The game configures 16 sequence voices and requests 22,050 Hz; NTSC hardware produces 22,047 Hz. Custom reverb
// and Cannonball's code-driven tempo changes are not reproduced, so Cannonball uses its sequence-native 75 BPM.
import { parseCompressedSequence } from '../music/cseq';
import { type Bank, parseBank, renderSequence } from '../music/libultra';
import type { DecodedMusic, MusicTrack } from '../types';

const OUTPUT_RATE = 22047;
const MAX_VOICES = 16;
const SEQUENCE_VOLUME = 0x7fff;
const SEQUENCE_COUNT = 31;

// Kernel instructions that form the audio-data addresses with LUI/ADDIU pairs. These instruction locations are
// shared by all three supported releases even though the resulting data addresses differ.
const SEQUENCE_LUI = 0x49b4;
const SEQUENCE_ADDIU = 0x49b8;
const CONTROL_LUI = 0x5508;
const CONTROL_ADDIU = 0x5510;
const TABLE_LUI = 0x550c;
const TABLE_ADDIU = 0x5518;

const SONG_NAMES = [
  'Opening',
  'Title ("Title Demo")',
  'Game Menu',
  'Mission Menu',
  'Hang Glider',
  'Hang Glider: Good Landing',
  'Hang Glider: Landing',
  'Hang Glider: Crash',
  'Rocket Belt',
  'Rocket Belt: Good Landing',
  'Rocket Belt: Landing',
  'Rocket Belt: Crash',
  'Gyrocopter',
  'Gyrocopter: Good Landing',
  'Gyrocopter: Landing',
  'Gyrocopter: Crash',
  'Cannonball',
  'Cannonball: Hit',
  'Cannonball: Miss',
  'Sky Diving',
  'Sky Diving: Good Landing',
  'Sky Diving: Landing',
  'Sky Diving: Crash',
  'Jumble Hopper',
  'Jumble Hopper: Goal',
  'Birdman',
  'Birdman: Landing',
  'Birdman: Crash',
  'Results ("Replay")',
  'Congratulations',
  'Ending ("Bravissimo!")',
] as const;

const u16 = (bytes: Uint8Array, offset: number) => (bytes[offset] << 8) | bytes[offset + 1];
const u32 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;

function addressLiteral(rom: Uint8Array, lui: number, addiu: number): number {
  const upper = u16(rom, lui + 2) << 16;
  const lower = (u16(rom, addiu + 2) << 16) >> 16;
  return (upper + lower) >>> 0;
}

function audioLayout(rom: Uint8Array): { sequences: number; control: number; table: number } {
  const sequences = addressLiteral(rom, SEQUENCE_LUI, SEQUENCE_ADDIU);
  const control = addressLiteral(rom, CONTROL_LUI, CONTROL_ADDIU);
  const table = addressLiteral(rom, TABLE_LUI, TABLE_ADDIU);
  if (u16(rom, sequences) !== 0x5331 || u16(rom, sequences + 2) !== SEQUENCE_COUNT || u16(rom, control) !== 0x4231) {
    throw new Error('Pilotwings 64 music data not found');
  }
  if (sequences >= rom.length || control >= rom.length || table >= rom.length) {
    throw new Error('Pilotwings 64 music data lies outside the ROM');
  }
  return { sequences, control, table };
}

export function pilotwingsMusic(rom: Uint8Array): { tracks: MusicTrack[]; decode(index: number): DecodedMusic } {
  const layout = audioLayout(rom);
  let bank: Bank | undefined;
  return {
    tracks: SONG_NAMES.map((name, index) => ({
      index,
      name: `${String(index + 1).padStart(2, '0')} ${name}`,
    })),
    decode(index: number): DecodedMusic {
      if (!Number.isInteger(index) || index < 0 || index >= SEQUENCE_COUNT) {
        throw new Error(`No Pilotwings 64 music track ${index}`);
      }
      const entry = layout.sequences + 4 + index * 8;
      const offset = u32(rom, entry);
      const length = u32(rom, entry + 4);
      const start = layout.sequences + offset;
      const end = start + length;
      if (start < layout.sequences || end > rom.length || end < start) {
        throw new Error(`Pilotwings 64 music track ${index} lies outside the ROM`);
      }
      const { seq, loop } = parseCompressedSequence(rom.subarray(start, end));
      bank ??= parseBank(rom, layout.control, layout.table, 0, null);
      return renderSequence(rom, bank, seq, {
        rate: OUTPUT_RATE,
        maxVoices: MAX_VOICES,
        seqVol: SEQUENCE_VOLUME,
        loop,
        pitchScale: 1,
      }).music;
    },
  };
}
