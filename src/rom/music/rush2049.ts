// San Francisco Rush 2049 (N64) soundtrack.
//
// The game uses Factor 5's MusyX sound system; the music is sequenced, not streamed:
//   file 6   MusyX project: groups 0-11 are the song groups (program pages + MIDI setups), 12-15 SFX
//   file 7   MusyX pool: SoundMacros and ADSR tables
//   file 8   MusyX sample directory (195 samples)
//   file 9   MusyX sample data (N64 MusyX ADPCM), streamed from ROM by the game
//   file 10+n  song n (SNG), played with song group n / MIDI setup n
// The AUDIO > MUSIC TRACK names live in a pointer table in the main code image.
import type { RushRom } from '../rom';
import type { DecodedMusic, MusicTrack } from '../types';
import { MusyxBank, renderSong } from './musyx';

const MAIN_VADDR = 0x80086a50;
const SONG_NAME_TABLE = 0x80110030;
const SONG_COUNT = 12;
const FIRST_SONG_FILE = 10;
const FILE_PROJECT = 6;
const FILE_POOL = 7;
const FILE_SDIR = 8;
const FILE_SAMPLES = 9;

const banks = new WeakMap<RushRom, MusyxBank>();

function bank(rom: RushRom): MusyxBank {
  let b = banks.get(rom);
  if (!b) {
    b = new MusyxBank(rom.file(FILE_PROJECT), rom.file(FILE_POOL), rom.file(FILE_SDIR), rom.file(FILE_SAMPLES));
    banks.set(rom, b);
  }
  return b;
}

function songName(rom: RushRom, index: number): string {
  const m = rom.main;
  const at = SONG_NAME_TABLE - MAIN_VADDR + index * 4;
  const ptr = ((m[at] << 24) | (m[at + 1] << 16) | (m[at + 2] << 8) | m[at + 3]) >>> 0;
  let o = ptr - MAIN_VADDR;
  let s = '';
  if (o < 0 || o >= m.length) return '';
  for (; o < m.length && m[o] && s.length < 32; o++) {
    if (m[o] < 0x20 || m[o] > 0x7e) return '';
    s += String.fromCharCode(m[o]);
  }
  return s;
}

export function listRush2049Music(rom: RushRom): MusicTrack[] {
  const tracks: MusicTrack[] = [];
  for (let i = 0; i < SONG_COUNT; i++) tracks.push({ index: i, name: songName(rom, i) || `Track ${i + 1}` });
  return tracks;
}

export function decodeRush2049Music(rom: RushRom, index: number): DecodedMusic {
  if (!(index >= 0 && index < SONG_COUNT)) throw new Error(`Rush 2049 music: no track ${index}`);
  const r = renderSong(bank(rom), index, index, rom.file(FIRST_SONG_FILE + index));
  return {
    sampleRate: r.sampleRate,
    channels: [r.left, r.right],
    loopStart: r.loopStart,
    loopEnd: r.loopEnd,
  };
}
