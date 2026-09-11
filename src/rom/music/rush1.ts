// San Francisco Rush - Extreme Racing (U): the soundtrack, rendered offline from the game's
// MIDI sequences and instrument bank.
//
// The game plays music with the libultra audio library's MIDI sequence player (alSeqPlayer,
// 24 voices, 16 channels) on a 22050 Hz synthesizer. Audio init (0x800BC2C0) reads,
// uncompressed from ROM:
//   0x5D9350  ALBankFile "B1" (.ctl, 0x6030 bytes, offsets relative to the file): one bank,
//             22050 Hz, 52 instrument slots + a percussion instrument, 110 sounds. Its sample
//             data (.tbl, VADPCM) follows at 0x5DF380; the audio thread streams it from ROM in
//             0x800-byte DMA reads (dmaproc 0x80070BFC).
//   0x6F80A0  ALSeqFile "S1": u16 revision, u16 count (16), then {u32 offset, u32 length} per
//             sequence, relative to the file. Each sequence is compressed with the ROM's LZSS
//             (lzssRingDecode) and is a standard format-0 MIDI file.
//   0x70A1D0  a second bank (.tbl at 0x70DCC0) used by the sound-effect player, not music.
// Music start 0x8006F054(seq, loopCount): decompress, alSeqNew, alSeqpSetSeq, alSeqpSetVol,
// markers at tick 0 and at the end of track, alSeqpLoop(count), alSeqpPlay. Songs are queued
// through 0x8006CA08 as (seq << 16 | 0xFFFF) (loop forever) or 0x80000000 | seq (play once).
// Race music (0x80099E44): option 0 off, 1 random, n >= 2 the (n - 2)th of 9 sequence numbers
// in the s16 table 0x800D2910. Sequence volume (0x8006EE1C): music volume option (0..40,
// default 35) / 40 * 32760 * the f32 gain table 0x800C3EF4[seq].
//
// The synthesizer is src/rom/music/libultra.ts. Reverb is not rendered: every channel's
// effect mix stays 0, so the game's reverb bus is silent for music.
import { lzssRingDecode } from '../lzss';
import type { Rush1Rom } from '../rush1';
import type { DecodedMusic, MusicTrack } from '../types';
import { type Bank, decodeWave, type MidiEvent, parseBank, prepareWave, type RenderStats, renderSequence, type Sequence } from './libultra';

export { decodeVadpcm, RESAMPLE_LUT } from './libultra';
export type { MidiEvent, Sequence } from './libultra';

const MAIN_VADDR = 0x8005bb10;
const BANK_CTL = 0x5d9350;
const BANK_TBL = 0x5df380;
const SEQ_FILE = 0x6f80a0;
const SEQ_GAIN = 0x800c3ef4; // f32[16]
const RACE_MUSIC = 0x800d2910; // s16[9]
const RACE_MUSIC_COUNT = 9;
const EQPOWER_ROM = 0x1b9a0; // libultra eqpower[128], boot segment 0x8001ADA0

const OUTPUT_RATE = 22050;
const MAX_VOICES = 24;
const MUSIC_OPTION = 35; // default music volume, out of 40

// Names of the race music as SETUP > AUDIO > Music Track shows them, in option order
// (options 2..10; the sequences come from the table at 0x800D2910).
const RACE_MUSIC_NAMES = [
  'Blue Fog', 'Desert Walk', 'Who It Is', 'Pulp Country', 'Blind Chase', 'Rave Rush', 'Night Hunt', 'STL', 'Zethno',
];

// Other music. Seq 5 plays once at power-on, seq 4 loops from the Midway logo through the
// title and attract demo, seq 11 in the menus. 13 and 14 are started looping and 8 and 9 once
// by other code paths (0x800B56C4, 0x800B05D0 and sound requests 0x7FFF / 0x7FFE).
const OTHER_MUSIC: { seq: number; name: string; loop: boolean }[] = [
  { seq: 5, name: 'Power-on Jingle', loop: false },
  { seq: 4, name: 'Title', loop: true },
  { seq: 11, name: 'Menus', loop: true },
  { seq: 13, name: 'Track 13', loop: true },
  { seq: 14, name: 'Track 14', loop: true },
  { seq: 8, name: 'Track 8', loop: false },
  { seq: 9, name: 'Track 9', loop: false },
];

export interface Rush1MusicStats extends RenderStats {
  seq: number;
  volume: number;
}

const bankCache = new WeakMap<Uint8Array, Bank>();

function loadBank(bytes: Uint8Array): Bank {
  let bank = bankCache.get(bytes);
  if (!bank) {
    bank = parseBank(bytes, BANK_CTL, BANK_TBL, 0, EQPOWER_ROM);
    bankCache.set(bytes, bank);
  }
  return bank;
}

function sequenceData(bytes: Uint8Array, seq: number): Uint8Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint16(SEQ_FILE) !== 0x5331) throw new Error('San Francisco Rush: sequence file not found');
  const count = dv.getUint16(SEQ_FILE + 2);
  if (seq < 0 || seq >= count) throw new Error(`No sequence ${seq}`);
  return lzssRingDecode(bytes, SEQ_FILE + dv.getUint32(SEQ_FILE + 4 + seq * 8));
}

// A format-0 MIDI file as libultra's alSeq reads it, with event times as alSeqPlayer
// schedules them: microseconds per tick = (s32)(f32 tempo * (f32)(1 / division)).
export function parseSequence(data: Uint8Array): Sequence {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tag = (p: number) => String.fromCharCode(data[p], data[p + 1], data[p + 2], data[p + 3]);
  if (tag(0) !== 'MThd') throw new Error('Not a MIDI file');
  const division = dv.getUint16(12);
  if (division === 0 || division & 0x8000) throw new Error('Unsupported MIDI time division');
  let p = 8 + dv.getUint32(4);
  while (p + 8 <= data.length && tag(p) !== 'MTrk') p += 8 + dv.getUint32(p + 4);
  if (p + 8 > data.length) throw new Error('MIDI track not found');
  const end = Math.min(data.length, p + 8 + dv.getUint32(p + 4));
  p += 8;

  const qnpt = Math.fround(1 / division);
  const events: MidiEvent[] = [];
  const tempos: { tick: number; uspt: number }[] = [];
  let uspt = 488; // alSeqpNew default
  let tick = 0;
  let us = 0;
  let status = 0;
  const vlq = () => {
    let v = 0;
    let c: number;
    do {
      c = data[p++];
      v = v * 128 + (c & 0x7f);
    } while (c & 0x80 && p < end);
    return v;
  };
  while (p < end) {
    const delta = vlq();
    tick += delta;
    us += delta * uspt;
    let st = data[p];
    if (st & 0x80) p++;
    else st = status;
    if (st === 0xff) {
      const type = data[p++];
      const len = vlq();
      if (type === 0x51 && len >= 3) {
        const tempo = (data[p] << 16) | (data[p + 1] << 8) | data[p + 2];
        uspt = Math.trunc(Math.fround(Math.fround(tempo) * qnpt));
        tempos.push({ tick, uspt });
      } else if (type === 0x2f) {
        return { division, events, tempos, endTick: tick, endUs: us };
      }
      p += len;
    } else if (st === 0xf0 || st === 0xf7) {
      p += vlq();
    } else if (st & 0x80) {
      status = st;
      const kind = st & 0xf0;
      const a = data[p++];
      const b = kind === 0xc0 || kind === 0xd0 ? 0 : data[p++];
      events.push({ tick, us, status: st, a, b });
    } else {
      p++; // data byte without a running status
    }
  }
  return { division, events, tempos, endTick: tick, endUs: us };
}

interface TrackDef {
  seq: number;
  name: string;
  loop: boolean;
}

function trackDefs(rom: Rush1Rom): TrackDef[] {
  const dv = new DataView(rom.main.buffer, rom.main.byteOffset, rom.main.byteLength);
  const race: TrackDef[] = [];
  for (let i = 0; i < RACE_MUSIC_COUNT; i++) {
    race.push({ seq: dv.getInt16(RACE_MUSIC - MAIN_VADDR + i * 2), name: RACE_MUSIC_NAMES[i], loop: true });
  }
  return [...OTHER_MUSIC.slice(0, 3), ...race, ...OTHER_MUSIC.slice(3)];
}

export function listRush1Music(rom: Rush1Rom): MusicTrack[] {
  return trackDefs(rom).map((t, index) => ({ index, name: t.name }));
}

export function rush1MusicSequence(rom: Rush1Rom, seq: number): Sequence {
  return parseSequence(sequenceData(rom.bytes, seq));
}

// The bank's waves decoded as the game plays their first pass, for verification.
export function rush1MusicWaves(rom: Rush1Rom) {
  return loadBank(rom.bytes).waves.map((w) => ({
    base: w.base, len: w.len, type: w.type, book: w.book, loopState: w.loopState,
    loopStart: w.loopStart, loopEnd: w.loopEnd, loopCount: w.loopCount,
    pcm: decodeWave(rom.bytes, w), prepared: prepareWave(rom.bytes, w),
  }));
}

// Render a track. `extraSeconds` (verification only) continues past the loop end.
export function renderRush1Music(rom: Rush1Rom, index: number, extraSeconds = 0): { music: DecodedMusic; stats: Rush1MusicStats } {
  const def = trackDefs(rom)[index];
  if (!def) throw new Error(`No music track ${index}`);
  const dv = new DataView(rom.main.buffer, rom.main.byteOffset, rom.main.byteLength);
  const gain = dv.getFloat32(SEQ_GAIN - MAIN_VADDR + def.seq * 4);
  const seqVol = Math.trunc(Math.fround(Math.fround(Math.fround(MUSIC_OPTION / 40) * 32760) * gain));
  const bank = loadBank(rom.bytes);
  const seq = rush1MusicSequence(rom, def.seq);
  const extra = Math.round(extraSeconds * OUTPUT_RATE);
  const { music, stats } = renderSequence(rom.bytes, bank, seq, { rate: OUTPUT_RATE, maxVoices: MAX_VOICES, seqVol, loop: def.loop, extra });
  return { music, stats: { seq: def.seq, volume: seqVol, ...stats } };
}

export function decodeRush1Music(rom: Rush1Rom, index: number): DecodedMusic {
  return renderRush1Music(rom, index).music;
}
