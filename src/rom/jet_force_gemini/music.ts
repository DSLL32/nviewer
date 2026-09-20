// Jet Force Gemini (USA revision 0) music. The game stores one standard
// ALBankFile and 90 libultra compressed-MIDI sequences in an S1 archive.
// Sequence zero is the silent no-music value; IDs 0x01..0x59 are selectable.
import { parseCompressedSequence } from '../music/cseq';
import { parseBank, renderSequence, type Bank, type Sequence } from '../music/libultra';
import type { DecodedMusic, MusicTrack } from '../types';

const MUSIC_CONTROL = 0x01747920;
const MUSIC_SAMPLES = 0x0175a280;
const SEQUENCE_ARCHIVE = 0x01d6de88;
const SEQUENCE_ARCHIVE_END = 0x01df2178;
const MUSIC_CONFIG = SEQUENCE_ARCHIVE_END;
const SEQUENCE_COUNT = 0x5a;
const FIRST_SELECTABLE = 0x01;
const LAST_SELECTABLE = 0x59;

// The game requests 22,020 Hz. NTSC clock division gives 22,018 Hz.
const OUTPUT_RATE = 22018;
const MAX_VOICES = 32;

const u16 = (bytes: Uint8Array, offset: number) =>
  (bytes[offset] << 8) | bytes[offset + 1];
const u32 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] << 24) | (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;

interface Song {
  id: number;
  start: number;
  length: number;
  volume: number;
}

interface MusicData {
  songs: Song[];
  bank?: Bank;
}

function parseMusicData(rom: Uint8Array): MusicData {
  if (rom.length !== 0x02000000 ||
      String.fromCharCode(...rom.subarray(0x3b, 0x3f)) !== 'NJFE' || rom[0x3f] !== 0) {
    throw new Error('Jet Force Gemini music: expected USA revision 0 ROM');
  }
  if (u16(rom, SEQUENCE_ARCHIVE) !== 0x5331 ||
      u16(rom, SEQUENCE_ARCHIVE + 2) !== SEQUENCE_COUNT ||
      u16(rom, MUSIC_CONTROL) !== 0x4231) {
    throw new Error('Jet Force Gemini music archive or instrument bank not found');
  }

  const songs: Song[] = [];
  let previousEnd = SEQUENCE_ARCHIVE + 4 + SEQUENCE_COUNT * 8;
  for (let id = 0; id < SEQUENCE_COUNT; id++) {
    const entry = SEQUENCE_ARCHIVE + 4 + id * 8;
    const start = SEQUENCE_ARCHIVE + u32(rom, entry);
    const length = u32(rom, entry + 4);
    const end = start + length;
    if (length < 68 || start < previousEnd || end < start || end > SEQUENCE_ARCHIVE_END) {
      throw new Error(`Jet Force Gemini music: invalid sequence ${id}`);
    }
    const volume = rom[MUSIC_CONFIG + id * 3];
    const tempoAdjust = rom[MUSIC_CONFIG + id * 3 + 1];
    const reverb = rom[MUSIC_CONFIG + id * 3 + 2];
    if (tempoAdjust !== 0 || reverb !== 1) {
      throw new Error(`Jet Force Gemini music: unsupported configuration for sequence ${id}`);
    }
    songs.push({ id, start, length, volume });
    previousEnd = end;
  }
  return { songs };
}

const cache = new WeakMap<Uint8Array, MusicData>();
function data(rom: Uint8Array): MusicData {
  let result = cache.get(rom);
  if (!result) {
    result = parseMusicData(rom);
    cache.set(rom, result);
  }
  return result;
}

function silentSequence(seq: Sequence): DecodedMusic {
  const loopStart = Math.round((seq.loopStartUs ?? 0) * OUTPUT_RATE / 1e6);
  const loopEnd = Math.round(seq.endUs * OUTPUT_RATE / 1e6);
  if (seq.loopStartTick === undefined || loopEnd <= loopStart) {
    throw new Error('Jet Force Gemini music: silent sequence is missing its authored loop');
  }
  return {
    sampleRate: OUTPUT_RATE,
    channels: [new Float32Array(loopEnd), new Float32Array(loopEnd)],
    loopStart,
    loopEnd,
  };
}

function preserveAuthoredLoop(music: DecodedMusic, seq: Sequence): DecodedMusic {
  if (music.loopStart !== undefined && music.loopEnd !== undefined) return music;
  const loopStart = Math.round((seq.loopStartUs ?? 0) * OUTPUT_RATE / 1e6);
  const loopEnd = Math.round(seq.endUs * OUTPUT_RATE / 1e6);
  if (seq.loopStartTick === undefined || loopStart < 0 || loopStart >= loopEnd ||
      loopEnd > music.channels[0].length) {
    throw new Error('Jet Force Gemini music: invalid authored sequence loop');
  }
  // A few cues loop an event-free tail. The shared renderer correctly has
  // nothing to retrigger there, but the game still repeats that silent span.
  music.loopStart = loopStart;
  music.loopEnd = loopEnd;
  return music;
}

export function jetForceGeminiMusic(rom: Uint8Array): {
  tracks: MusicTrack[];
  decode(index: number): DecodedMusic;
} {
  const music = data(rom);
  return {
    tracks: music.songs.slice(FIRST_SELECTABLE, LAST_SELECTABLE + 1).map(({ id }) => ({
      index: id,
      name: `MUSIC TEST ${String(id).padStart(2, '0')}`,
    })),
    decode(index: number): DecodedMusic {
      if (!Number.isInteger(index) || index < FIRST_SELECTABLE || index > LAST_SELECTABLE) {
        throw new Error(`No Jet Force Gemini music track ${index}`);
      }
      const song = music.songs[index];
      const parsed = parseCompressedSequence(rom.subarray(song.start, song.start + song.length));

      // The ROM deliberately reuses a long, event-free looping sequence for
      // several music IDs. Preserve that loop as valid silent PCM.
      if (!parsed.seq.events.some((event) => (event.status & 0xf0) === 0x90 && event.b !== 0)) {
        return silentSequence(parsed.seq);
      }

      music.bank ??= parseBank(rom, MUSIC_CONTROL, MUSIC_SAMPLES, 0, null);
      const rendered = renderSequence(rom, music.bank, parsed.seq, {
        rate: OUTPUT_RATE,
        maxVoices: MAX_VOICES,
        seqVol: song.volume << 8,
        loop: parsed.loop,
        squareVolume: false,
        linearRamps: true,
      }).music;
      return parsed.loop ? preserveAuthoredLoop(rendered, parsed.seq) : rendered;
    },
  };
}
