// Pokémon Snap (U) soundtrack: all 37 sequences in the game's ALSeqFile, rendered with the
// stock libultra compressed-MIDI path. Snap replaces each sound's sample volume with a
// player-wide extra volume controlled by MIDI CC 21; cloning the bank with that value preserves
// the game's calculation without changing the shared renderer (POKEMONSNAP.md §9).
import { parseCompressedSequence } from '../music/cseq';
import { type Bank, parseBank, renderSequence } from '../music/libultra';
import type { DecodedMusic, MusicTrack } from '../types';

const SEQUENCE_FILE = 0xaefc10;
const SEQUENCE_COUNT = 37;
const MUSIC_CONTROL = 0xafeee0;
const MUSIC_TABLE = 0xb04430;
const OUTPUT_RATE = 32006; // osAiSetFrequency(32000): AI_DACRATE 1520 on NTSC
const MAX_VOICES = 16;
const SEQUENCE_VOLUME = 0x7f00;
const DEFAULT_EXTRA_VOLUME = 120;

const SONG_NAMES = [
  'Beach',
  'Poké Flute: Tune 1',
  'Poké Flute: Tune 3',
  'Poké Flute: Tune 2',
  'Tunnel',
  'River',
  'Volcano',
  'Valley',
  "Professor Oak's Lab",
  'Camera Check',
  'PKMN Album',
  'Staff Roll',
  'Name Entry',
  'Cave',
  'Rainbow Cloud',
  'Cave: Ambience',
  "Professor Oak's Check",
  'Out of Film',
  'PKMN Report: Photo',
  'Valley: Event',
  'Ambience: Opening, River, Valley',
  'Ambience: Tunnel and River Start',
  'Cave: Silence',
  'Title',
  'Cave: Pokémon Trio',
  'Opening',
  'Course Select',
  'Options',
  'Rainbow Cloud: Mew',
  'PKMN Report',
  'PKMN Report: PKMN Signs',
  'Jingle: Wonderful Photo',
  'Jingle: New Item',
  'Jingle: New High Score',
  'Gallery',
  'Jingle: Menu Select',
  'Staff Roll (Alternate)',
] as const;

const u16 = (bytes: Uint8Array, offset: number) => (bytes[offset] << 8) | bytes[offset + 1];
const u32 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;

function withExtraVolume(bank: Bank, volume: number): Bank {
  const instrument = (value: Bank['percussion']) =>
    value && { ...value, sounds: value.sounds.map((sound) => ({ ...sound, volume })) };
  return {
    ...bank,
    instruments: bank.instruments.map(instrument),
    percussion: instrument(bank.percussion),
  };
}

function sequenceBytes(rom: Uint8Array, index: number): Uint8Array {
  if (u16(rom, SEQUENCE_FILE) !== 0x5331 || u16(rom, SEQUENCE_FILE + 2) !== SEQUENCE_COUNT) {
    throw new Error('Pokémon Snap music sequence file not found');
  }
  const entry = SEQUENCE_FILE + 4 + index * 8;
  const start = SEQUENCE_FILE + u32(rom, entry);
  const length = u32(rom, entry + 4);
  const end = start + length;
  if (start < SEQUENCE_FILE || end < start || end > rom.length) {
    throw new Error(`Pokémon Snap music track ${index} lies outside the ROM`);
  }
  return rom.subarray(start, end);
}

export function pokemonSnapMusic(rom: Uint8Array): { tracks: MusicTrack[]; decode(index: number): DecodedMusic } {
  let bank: Bank | undefined;
  const volumeBanks = new Map<number, Bank>();
  return {
    tracks: SONG_NAMES.map((name, index) => ({
      index,
      name: `${String(index).padStart(2, '0')} ${name}`,
    })),
    decode(index: number): DecodedMusic {
      if (!Number.isInteger(index) || index < 0 || index >= SEQUENCE_COUNT) {
        throw new Error(`No Pokémon Snap music track ${index}`);
      }
      const { seq, loop } = parseCompressedSequence(sequenceBytes(rom, index));
      const firstNoteTick = seq.events.find((event) => (event.status & 0xf0) === 0x90 && event.b !== 0)?.tick ?? Infinity;
      const volumeEvent = seq.events.find(
        (event) => (event.status & 0xf0) === 0xb0 && event.a === 21 && event.tick <= firstNoteTick,
      );
      const extraVolume = volumeEvent?.b ?? DEFAULT_EXTRA_VOLUME;
      bank ??= parseBank(rom, MUSIC_CONTROL, MUSIC_TABLE, 0, null);
      let volumeBank = volumeBanks.get(extraVolume);
      if (!volumeBank) {
        volumeBank = withExtraVolume(bank, extraVolume);
        volumeBanks.set(extraVolume, volumeBank);
      }
      return renderSequence(rom, volumeBank, seq, {
        rate: OUTPUT_RATE,
        maxVoices: MAX_VOICES,
        seqVol: SEQUENCE_VOLUME,
        loop,
      }).music;
    },
  };
}
