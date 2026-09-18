// Mario Party (Japan): two S2 tables of libultra compressed MIDI sequences.
// Table A covers board and mini-game music; table B covers title and ending scenes.
import { parseCompressedMidi } from '../bomberman/music';
import { parseCompressedSequence } from '../music/cseq';
import { parseBank, renderSequence, type Bank } from '../music/libultra';
import type { DecodedMusic, MusicTrack } from '../types';

const S2_A = 0x151dbd0;
const S2_B = 0x175d0f0;
const EQPOWER = 0xc7be0;
const RATE = 32000;
const A_COUNT = 81;
const B_COUNT = 7;

// English names are the game's US jukebox strings where available. Other
// labels describe verified play sites; all 88 ROM slots remain selectable.
const A_NAMES: Record<number, string> = {
  2: 'Peaceful Mushroom Village', 3: 'Traveling the Warp Pipe',
  4: 'Mushroom Bank Theme', 5: 'Option House Theme',
  6: 'Mushroom Shop Theme', 7: 'Mini-Game House Theme',
  8: 'Jungle Adventure', 9: 'Birthday Cake', 10: 'Tropical Island',
  11: 'Battle Canyon', 12: 'Engine Room', 13: 'Rainbow Castle',
  14: 'Magma Mountain', 15: 'Eternal Star',
  16: 'Outcome of Adventure', 17: 'Adventure Begins',
  18: "Bowser's Theme", 19: 'Koopa Troopa Theme',
  21: 'Play a Mini-Game!', 22: 'Mini-game Results',
  23: 'Mario Bandstand Piece 1', 24: 'Move to the Mambo!',
  25: 'The Wide, Wide Ocean', 26: 'In the Mushroom Forest',
  27: 'Ducking and Dodging', 28: 'Full of Danger',
  29: 'Coins of the World', 30: 'Taking Coins',
  31: 'The Room Underground', 32: 'Slowly, Slowly',
  33: 'Dodging Danger', 34: "Let's Limbo!", 35: "Let's Go Lightly",
  36: 'Hit or Miss Chance Game', 37: 'Can It Be Done?',
  38: 'Faster Than All', 39: 'Saving Courage',
  42: 'Playing the Game', 43: 'Where Have the Stars Gone',
  45: 'Mario Bandstand Piece 2', 46: 'Mario Bandstand Piece 3',
  47: 'The Stolen Star', 48: "Where's the Star?",
  49: 'Mini-Game Stadium Theme',
  50: 'Mini-Game End Jingle A', 51: 'Mini-Game End Jingle B',
  52: 'Mini-Game End Jingle C', 53: 'Mini-Game End Jingle D',
  54: 'Mini-Game End Jingle E', 55: 'Mini-Game End Jingle F',
  56: 'Mushroom Bank Jingle', 57: 'Board Intro Jingle',
  58: 'Board Intro Loop', 59: 'Slot Machine Jingle',
  60: 'Mini-Game End Jingle G', 61: 'Slot Car Derby Jingle',
  63: 'Victory Fanfare', 64: 'Winner Loop',
  65: 'Mini-Game Island Theme',
  66: 'Mini-Game Island Map A', 67: 'Mini-Game Island Map B',
  68: 'Mini-Game Island Map C', 69: 'Mini-Game Island Submap 1',
  70: 'Mini-Game Island Submaps 2–3', 71: 'Mini-Game Island Submap 4',
  72: 'Mini-Game Island Map D',
};
const B_NAMES: Record<number, string> = {
  1: 'Mario Party Theme', 2: 'The Power of Stars', 3: 'Ending',
  4: 'Staff Roll Prelude', 5: "Everyone's a Super Star!", 6: 'Opening',
};

interface Song {
  sequence: number;
  bank: number;
  volume: number;
  control: number;
  samples: number;
}

const u16 = (rom: Uint8Array, at: number) => (rom[at] << 8) | rom[at + 1];
const u32 = (rom: Uint8Array, at: number) =>
  ((rom[at] << 24) | (rom[at + 1] << 16) | (rom[at + 2] << 8) | rom[at + 3]) >>> 0;

function readTable(rom: Uint8Array, base: number, end: number, expected: number): Song[] {
  if (u16(rom, base) !== 0x5332 || u16(rom, base + 2) !== expected)
    throw new Error(`Mario Party music: invalid S2 table at 0x${base.toString(16)}`);
  const songs: Song[] = [];
  for (let i = 0; i < expected; i++) {
    const sequence = base + u32(rom, base + 4 + i * 8);
    const length = u32(rom, base + 8 + i * 8);
    const row = base + 4 + expected * 8 + i * 16;
    const control = base + u32(rom, row + 4);
    const samples = base + u32(rom, row + 12);
    if (sequence < base || sequence + length > end || length < 68 ||
        control < base || control >= end || samples < base || samples >= end)
      throw new Error(`Mario Party music: invalid S2 song ${i}`);
    songs.push({ sequence, bank: rom[row], volume: rom[row + 1], control, samples });
  }
  return songs;
}

interface MusicData { songs: Song[]; banks: Map<string, Bank> }
const cache = new WeakMap<Uint8Array, MusicData>();
function data(rom: Uint8Array): MusicData {
  let result = cache.get(rom);
  if (!result) {
    if (rom.length !== 0x2000000 || String.fromCharCode(...rom.subarray(0x3b, 0x3f)) !== 'CLBJ')
      throw new Error('Mario Party music: expected Japanese retail ROM');
    result = {
      songs: [...readTable(rom, S2_A, S2_B, A_COUNT), ...readTable(rom, S2_B, 0x1817010, B_COUNT)],
      banks: new Map(),
    };
    cache.set(rom, result);
  }
  return result;
}

export function listMarioPartyMusic(rom: Uint8Array): MusicTrack[] {
  data(rom);
  return Array.from({ length: A_COUNT + B_COUNT }, (_, index) => {
    const table = index < A_COUNT ? 'A' : 'B';
    const song = index < A_COUNT ? index : index - A_COUNT;
    const names = table === 'A' ? A_NAMES : B_NAMES;
    return { index, name: `${table}${song.toString().padStart(2, '0')} ${names[song] ?? 'Two-beep placeholder'}` };
  });
}

export function decodeMarioPartyMusic(rom: Uint8Array, index: number): DecodedMusic {
  const { songs, banks } = data(rom);
  if (!Number.isInteger(index) || index < 0 || index >= songs.length)
    throw new Error(`No Mario Party music track ${index}`);
  const song = songs[index];
  const key = `${song.control}/${song.bank}`;
  let bank = banks.get(key);
  if (!bank) {
    bank = parseBank(rom, song.control, song.samples, song.bank, EQPOWER);
    banks.set(key, bank);
  }
  // A9 contains a track that plays once, while its other tracks loop. The
  // independent-track parser keeps that part out of subsequent repetitions.
  const sequence = index === 9
    ? parseCompressedSequence(rom.subarray(song.sequence)).seq
    : parseCompressedMidi(rom, song.sequence);
  return renderSequence(rom, bank, sequence, {
    rate: RATE, maxVoices: 24, seqVol: Math.round(song.volume * 0x7fff / 127),
    loop: sequence.loopStartTick !== undefined,
  }).music;
}
