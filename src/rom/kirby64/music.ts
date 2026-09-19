// Kirby 64: The Crystal Shards (USA revision 0) music. The ROM stores 63
// libultra compressed-MIDI sequences in an S1 archive, then maps the public
// music IDs 1..63 onto those stored entries. Labels are the ROM's fixed-width
// music names, not inferred soundtrack titles.
import { parseCompressedSequence } from '../music/cseq';
import { parseBank, renderSequence, type Bank } from '../music/libultra';
import type { DecodedMusic, MusicTrack } from '../types';

const SEQUENCE_ARCHIVE = 0x250320;
const SEQUENCE_ARCHIVE_END = 0x2a8cb0;
const MUSIC_CONTROL = 0x2a8cb0;
const MUSIC_SAMPLES = 0x2b1510;
const PUBLIC_ID_MAP = 0x68210;
const LABEL_HEADER = 0x68780;
const LABELS = LABEL_HEADER + 4;
const SEQUENCE_COUNT = 63;
const LABEL_SIZE = 24;

const OUTPUT_RATE = 32000;
// The BGM sequence player is configured for 24 virtual voices. The synth has
// 16 physical voices shared with sound effects; libultra's priority-based
// physical allocation is outside the shared offline renderer.
const MAX_VOICES = 24;
// Ordinary game initialization sets player 0 to this volume.
const SEQUENCE_VOLUME = 0x7800;
const SILENT_DUMMY_ID = 58;

const u16 = (bytes: Uint8Array, offset: number) =>
  (bytes[offset] << 8) | bytes[offset + 1];
const s16 = (bytes: Uint8Array, offset: number) =>
  (u16(bytes, offset) << 16) >> 16;
const u32 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] << 24) | (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;

interface Song {
  publicId: number;
  sequence: number;
  start: number;
  length: number;
  label: string;
}

interface MusicData {
  songs: Song[];
  bank?: Bank;
}

function romLabel(rom: Uint8Array, sequence: number): string {
  const start = LABELS + sequence * LABEL_SIZE;
  let end = start;
  while (end < start + LABEL_SIZE && rom[end] !== 0) end++;
  const label = String.fromCharCode(...rom.subarray(start, end)).trimEnd();
  if (!label || !/^[\x20-\x7e]+$/.test(label)) {
    throw new Error(`Kirby 64 music: invalid label for sequence ${sequence}`);
  }
  return label;
}

function parseMusicData(rom: Uint8Array): MusicData {
  if (rom.length !== 0x2000000 ||
      String.fromCharCode(...rom.subarray(0x3b, 0x3f)) !== 'NK4E' || rom[0x3f] !== 0) {
    throw new Error('Kirby 64 music: expected USA revision 0 ROM');
  }
  if (u16(rom, SEQUENCE_ARCHIVE) !== 0x5331 ||
      u16(rom, SEQUENCE_ARCHIVE + 2) !== SEQUENCE_COUNT ||
      u16(rom, LABEL_HEADER) !== SEQUENCE_COUNT || u16(rom, LABEL_HEADER + 2) !== 630) {
    throw new Error('Kirby 64 music: sequence archive or label table not found');
  }

  const bySequence: (Song | undefined)[] = Array(SEQUENCE_COUNT);
  const songs: Song[] = [];
  for (let publicId = 1; publicId <= SEQUENCE_COUNT; publicId++) {
    const sequence = s16(rom, PUBLIC_ID_MAP + publicId * 2);
    if (sequence < 0 || sequence >= SEQUENCE_COUNT || bySequence[sequence]) {
      throw new Error(`Kirby 64 music: invalid public ID map entry ${publicId}`);
    }
    const entry = SEQUENCE_ARCHIVE + 4 + sequence * 8;
    const start = SEQUENCE_ARCHIVE + u32(rom, entry);
    const length = u32(rom, entry + 4);
    const end = start + length;
    if (length < 68 || start < SEQUENCE_ARCHIVE || end < start || end > SEQUENCE_ARCHIVE_END) {
      throw new Error(`Kirby 64 music: invalid stored sequence ${sequence}`);
    }
    const label = romLabel(rom, sequence);
    const song = { publicId, sequence, start, length, label };
    bySequence[sequence] = song;
    songs.push(song);
  }
  if (s16(rom, PUBLIC_ID_MAP) !== -1 || bySequence.filter(Boolean).length !== SEQUENCE_COUNT) {
    throw new Error('Kirby 64 music: public ID map is not a complete bijection');
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

function silentDummy(sequence: ReturnType<typeof parseCompressedSequence>['seq']): DecodedMusic {
  const loopStart = Math.round((sequence.loopStartUs ?? 0) * OUTPUT_RATE / 1e6);
  const loopEnd = Math.round(sequence.endUs * OUTPUT_RATE / 1e6);
  if (sequence.loopStartTick === undefined || loopEnd <= loopStart) {
    throw new Error('Kirby 64 music: 058ZZZZ is missing its silent loop');
  }
  return {
    sampleRate: OUTPUT_RATE,
    channels: [new Float32Array(loopEnd), new Float32Array(loopEnd)],
    loopStart,
    loopEnd,
  };
}

export function kirby64Music(rom: Uint8Array): {
  tracks: MusicTrack[];
  decode(index: number): DecodedMusic;
} {
  const music = data(rom);
  return {
    tracks: music.songs.map(({ publicId, label }) => ({
      index: publicId,
      name: publicId === SILENT_DUMMY_ID ? `${label} · Silent dummy/internal` : label,
    })),
    decode(publicId: number): DecodedMusic {
      if (!Number.isInteger(publicId)) throw new Error(`No Kirby 64 music track ${publicId}`);
      const song = music.songs[publicId - 1];
      if (!song || song.publicId !== publicId) throw new Error(`No Kirby 64 music track ${publicId}`);
      const parsed = parseCompressedSequence(rom.subarray(song.start, song.start + song.length));

      // This ROM-authored internal entry contains no channel events. Preserve
      // its long loop as finite, transferable PCM instead of letting the
      // event-driven renderer discard the otherwise valid loop metadata.
      if (publicId === SILENT_DUMMY_ID) return silentDummy(parsed.seq);

      music.bank ??= parseBank(rom, MUSIC_CONTROL, MUSIC_SAMPLES, 0, null);
      return renderSequence(rom, music.bank, parsed.seq, {
        rate: OUTPUT_RATE,
        maxVoices: MAX_VOICES,
        seqVol: SEQUENCE_VOLUME,
        loop: parsed.loop,
      }).music;
    },
  };
}
