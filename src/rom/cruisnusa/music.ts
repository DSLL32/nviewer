// Cruis'n USA's fourteen WESS music-class sequences (USA revision 0).
import { type Bank, type MidiEvent, type Sequence, type Wave, renderSequence } from '../music/libultra';
import type { DecodedMusic, MusicTrack } from '../types';

const ARCHIVE = 0x5c4200;
const SSEQ = 0x72ae80;
const SSEQ_PAYLOAD = 0x72b970;
const WDD = 0x5d2d00;
const WAVE_END = 0x72ae7a;
const OUTPUT_RATE = 22050;
const MAX_VOICES = 24; // WESS's default driver voice count
const SEQUENCE_VOLUME = 0x7fff;
const MUSIC_SEQUENCES = 14;
const FIRST_MUSIC_SEQUENCE = 159;

const SONG_NAMES = [
  'Unlabelled music/cue 159',
  'Unlabelled one-shot 160',
  'BLUEGRASS BOOGIE',
  'Unlabelled music/cue 162',
  'HOUSE SPECIAL',
  'Unlabelled one-shot 164',
  'Unlabelled music/cue 165',
  'Short one-wave cue 166',
  'SURFARI MONSTER',
  'ROADKILL JAM',
  'REDLINE SHUFFLE',
  'TUBULAR SURF',
  'DEADWOOD RIDE',
  'Unlabelled one-shot 172',
] as const;

// Authored control-flow endpoints, in sequence ticks. Sequence tempo varies.
const LOOP_TICKS: ReadonlyArray<readonly [number, number] | null> = [
  [6144, 12276], null, [0, 30712], [768, 6912],
  [0, 45304], null, [3072, 6136], null,
  [13056, 25343], [11520, 22271], [768, 19192],
  [12288, 23800], [3840, 39160], null,
];

// WESS command sizes include the opcode byte, but not the preceding VLQ.
// Zero marks an engine-only command which is invalid in a stored track.
const COMMAND_LENGTHS = [
  0, 0, 0, 0, 0, 0, 0, 3, 2, 3, 2, 2, 2, 2, 2, 2, 2, 3,
  2, 4, 5, 5, 2, 2, 3, 3, 3, 3, 1, 1, 3, 3, 3, 1, 1, 1,
] as const;

interface Layout {
  archive: number;
  sseq: number;
  payload: number;
  wdd: number;
}

interface SequenceRecord {
  tracks: number;
  start: number;
  end: number;
}

interface TrackHeader {
  start: number;
  end: number;
  patch: number;
  pitch: number;
  volume: number;
  pan: number;
  labels: number[];
  ppq: number;
  qpm: number;
}

interface LocalSound {
  env: { attack: number; decay: number; release: number; attackVolume: number; decayVolume: number };
  velMin: number;
  velMax: number;
  keyMin: number;
  keyMax: number;
  keyBase: number;
  detune: number;
  pan: number;
  volume: number;
  wave: Wave;
}

interface LocalInstrument {
  volume: number;
  pan: number;
  priority: number;
  bendRange: number;
  sounds: LocalSound[];
}

class Reader {
  readonly view: DataView;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  need(offset: number, length: number, what: string) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > this.bytes.length) {
      throw new Error(`Cruis'n USA ${what} lies outside the ROM`);
    }
  }

  u8(offset: number) {
    this.need(offset, 1, 'audio byte');
    return this.bytes[offset];
  }

  u16(offset: number) {
    this.need(offset, 2, 'audio word');
    return this.view.getUint16(offset);
  }

  s16(offset: number) {
    this.need(offset, 2, 'audio word');
    return this.view.getInt16(offset);
  }

  u32(offset: number) {
    this.need(offset, 4, 'audio word');
    return this.view.getUint32(offset);
  }

  s32(offset: number) {
    this.need(offset, 4, 'audio word');
    return this.view.getInt32(offset);
  }

  ascii(offset: number, length: number) {
    this.need(offset, length, 'audio signature');
    return String.fromCharCode(...this.bytes.subarray(offset, offset + length));
  }
}

function align8(value: number) {
  return (value + 7) & ~7;
}

function archiveLayout(r: Reader): Layout {
  r.need(0, 0x40, 'ROM header');
  if (r.ascii(0x3b, 3) !== 'NCU' || r.u8(0x3e) !== 0x45 || r.u8(0x3f) !== 0) {
    throw new Error("Cruis'n USA revision 0 music data not found");
  }
  const layout = { archive: ARCHIVE, sseq: SSEQ, payload: SSEQ_PAYLOAD, wdd: WDD };
  r.need(ARCHIVE, WAVE_END - ARCHIVE, 'audio archive');
  if (r.ascii(ARCHIVE, 4) !== 'SN64' || r.ascii(SSEQ, 4) !== 'SSEQ') {
    throw new Error("Cruis'n USA WESS archive not found");
  }
  return layout;
}

function equalPowerTable() {
  return Int32Array.from({ length: 128 }, (_, i) => Math.round(Math.cos((i * Math.PI) / 254) * 32767));
}

function parseBank(r: Reader, layout: Layout): Bank {
  const base = layout.archive;
  if (r.u32(base + 4) !== 2) throw new Error("Unsupported Cruis'n USA SN64 version");
  const dataSize = r.u32(base + 24);
  const group = base + 32;
  if (r.u32(group) !== 0x1f) throw new Error("Unsupported Cruis'n USA SN64 load flags");
  const patchCount = r.u16(group + 4);
  const patchSize = r.u16(group + 6);
  const mapCount = r.u16(group + 8);
  const mapSize = r.u16(group + 10);
  const waveCount = r.u16(group + 12);
  const waveSize = r.u16(group + 14);
  const drumCount = r.u16(group + 16);
  const drumSize = r.u16(group + 18);
  const extraSize = r.u32(group + 20);
  if (patchCount !== 190 || patchSize !== 4 || mapCount !== 190 || mapSize !== 20 || waveCount !== 190 || waveSize !== 24 || drumCount !== 0 || drumSize !== 0) {
    throw new Error("Unsupported Cruis'n USA SN64 table layout");
  }

  const patchesAt = group + 24;
  const mapsAt = align8(patchesAt + patchCount * patchSize);
  const wavesAt = align8(mapsAt + mapCount * mapSize);
  const extraAt = align8(wavesAt + waveCount * waveSize);
  if (dataSize !== extraAt + extraSize - (group + 24)) throw new Error("Invalid Cruis'n USA SN64 data size");

  const infoWaves = r.u16(extraAt);
  const rawLoops = r.u16(extraAt + 2);
  const adpcmLoops = r.u16(extraAt + 4);
  const infoWaves2 = r.u16(extraAt + 6);
  if (infoWaves !== waveCount || infoWaves2 !== waveCount || rawLoops !== 0 || adpcmLoops !== 17) {
    throw new Error("Unsupported Cruis'n USA SN64 loop layout");
  }
  const loopsAt = extraAt + 8;
  const booksAt = loopsAt + adpcmLoops * 48;
  if (booksAt + waveCount * 264 !== layout.wdd) throw new Error("Invalid Cruis'n USA SN64 table bounds");

  const waves: Wave[] = [];
  const wavePitches: number[] = [];
  let declaredEnd = 0;
  for (let i = 0; i < waveCount; i++) {
    const at = wavesAt + i * waveSize;
    const relativeBase = r.u32(at);
    const len = r.u32(at + 4);
    const type = r.u8(at + 8);
    const pitch = r.s32(at + 12);
    const loopIndex = r.s32(at + 16);
    if (type !== 0 || r.u32(at + 20) !== 0) throw new Error(`Unsupported Cruis'n USA wave ${i}`);
    if (loopIndex < -1 || loopIndex >= adpcmLoops) throw new Error(`Invalid Cruis'n USA wave ${i} loop`);
    const completeBytes = Math.floor(len / 9) * 9;
    r.need(layout.wdd + relativeBase, completeBytes, `wave ${i}`);
    declaredEnd = Math.max(declaredEnd, relativeBase + len);

    const bookAt = booksAt + i * 264;
    const order = r.s32(bookAt);
    const predictors = r.s32(bookAt + 4);
    if (order !== 2 || (predictors !== 4 && predictors !== 8)) {
      throw new Error(`Unsupported Cruis'n USA wave ${i} predictor book`);
    }
    const book = Int16Array.from({ length: order * predictors * 8 }, (_, k) => r.s16(bookAt + 8 + k * 2));
    let loopStart = 0;
    let loopEnd = 0;
    let loopCount = 0;
    let loopState: Int16Array | null = null;
    if (loopIndex >= 0) {
      const loopAt = loopsAt + loopIndex * 48;
      loopStart = r.u32(loopAt);
      loopEnd = r.u32(loopAt + 4);
      loopCount = r.s32(loopAt + 8);
      loopState = Int16Array.from({ length: 16 }, (_, k) => r.s16(loopAt + 12 + k * 2));
      if (loopStart >= loopEnd || loopEnd > Math.floor(len / 9) * 16 || loopCount === 0) {
        throw new Error(`Invalid Cruis'n USA wave ${i} loop range`);
      }
    }
    waves.push({ base: layout.wdd + relativeBase, len, type, book, loopStart, loopEnd, loopCount, loopState });
    wavePitches.push(pitch);
  }
  if (declaredEnd !== WAVE_END - WDD) throw new Error("Invalid Cruis'n USA WDD extent");

  const instruments: LocalInstrument[] = [];
  for (let i = 0; i < patchCount; i++) {
    const patchAt = patchesAt + i * patchSize;
    const count = r.u8(patchAt);
    const first = r.u16(patchAt + 2);
    if (count === 0 || first + count > mapCount) throw new Error(`Invalid Cruis'n USA patch ${i}`);
    const sounds: LocalSound[] = [];
    let priority = 0;
    for (let j = 0; j < count; j++) {
      const mapAt = mapsAt + (first + j) * mapSize;
      const waveIndex = r.u16(mapAt + 10);
      if (waveIndex >= waves.length) throw new Error(`Invalid Cruis'n USA patch ${i} wave`);
      priority = Math.max(priority, r.u8(mapAt));
      sounds.push({
        env: {
          attack: r.u16(mapAt + 12) * 1000,
          decay: r.u16(mapAt + 14) * 1000,
          release: r.u16(mapAt + 16) * 1000,
          attackVolume: r.u8(mapAt + 18),
          decayVolume: r.u8(mapAt + 19),
        },
        velMin: 0,
        velMax: 127,
        keyMin: r.u8(mapAt + 6),
        keyMax: r.u8(mapAt + 7),
        keyBase: r.u8(mapAt + 4),
        detune: wavePitches[waveIndex] - r.u8(mapAt + 5),
        pan: r.u8(mapAt + 2),
        volume: r.u8(mapAt + 1),
        wave: waves[waveIndex],
      });
    }
    sounds.sort((a, b) => a.keyMin - b.keyMin || a.velMin - b.velMin);
    // WESS pitchstep is per patch map; the ROM's patches have one map each.
    const pitchStep = r.u8(mapsAt + first * mapSize + 8);
    instruments.push({ volume: 127, pan: 64, priority, bendRange: pitchStep * 400, sounds });
  }

  // Bank's private instrument shape is deliberately satisfied structurally;
  // WESS patches are translated here rather than fed to the ALBank parser.
  return {
    sampleRate: OUTPUT_RATE,
    instruments,
    percussion: null,
    waves,
    eqpower: equalPowerTable(),
  } as unknown as Bank;
}

function sequenceRecords(r: Reader, layout: Layout): SequenceRecord[] {
  const sseq = layout.sseq;
  if (r.u32(sseq + 4) !== 2 || r.u8(sseq + 16) !== 0) throw new Error("Unsupported Cruis'n USA SSEQ version");
  const count = r.u16(sseq + 14);
  const tableSize = r.u32(sseq + 24);
  if (count !== 173 || tableSize !== count * 16 || layout.payload !== sseq + 32 + tableSize) {
    throw new Error("Invalid Cruis'n USA SSEQ table");
  }
  const records: SequenceRecord[] = [];
  let furthest = 0;
  for (let i = 0; i < count; i++) {
    const at = sseq + 32 + i * 16;
    const tracks = r.u16(at);
    const compression = r.u16(at + 2);
    const size = r.u32(at + 4);
    const relative = r.u32(at + 8);
    if (tracks === 0 || tracks > 32 || compression !== 0 || r.u32(at + 12) !== 0) {
      throw new Error(`Invalid Cruis'n USA sequence ${i} header`);
    }
    const start = layout.payload + relative;
    r.need(start, size, `sequence ${i}`);
    const end = start + size;
    furthest = Math.max(furthest, end);
    records.push({ tracks, start, end });
  }
  if (furthest !== 0x74e378) throw new Error("Invalid Cruis'n USA SSEQ extent");
  return records;
}

function readTrack(r: Reader, at: number, sequenceEnd: number, sequence: number): TrackHeader {
  r.need(at, 20, `sequence ${sequence} track header`);
  if (r.u8(at) !== 1 || r.u16(at + 10) !== 192 || r.u16(at + 12) === 0) {
    throw new Error(`Unsupported Cruis'n USA music track in sequence ${sequence}`);
  }
  const labelCount = r.u16(at + 14);
  const eventBytes = r.u32(at + 16);
  if (labelCount > 32) throw new Error(`Invalid Cruis'n USA sequence ${sequence} labels`);
  const labelsAt = at + 20;
  const start = labelsAt + labelCount * 4;
  const end = start + eventBytes;
  if (end > sequenceEnd || end < start) throw new Error(`Invalid Cruis'n USA sequence ${sequence} track bounds`);
  const labels = Array.from({ length: labelCount }, (_, i) => r.u32(labelsAt + i * 4));
  for (const label of labels) if (label > eventBytes) throw new Error(`Invalid Cruis'n USA sequence ${sequence} label`);
  return {
    start,
    end,
    patch: r.u16(at + 2),
    pitch: r.s16(at + 4),
    volume: r.u8(at + 6),
    pan: r.u8(at + 7),
    labels,
    ppq: r.u16(at + 10),
    qpm: r.u16(at + 12),
  };
}

function readVlq(r: Reader, position: number, end: number, sequence: number): [number, number] {
  let value = 0;
  for (let count = 0; count < 4; count++) {
    if (position >= end) throw new Error(`Truncated Cruis'n USA sequence ${sequence} VLQ`);
    const byte = r.u8(position++);
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return [value, position];
  }
  throw new Error(`Oversized Cruis'n USA sequence ${sequence} VLQ`);
}

function ticksToUs(ticks: number, ppq: number, qpm: number) {
  return (ticks * 60_000_000) / (ppq * qpm);
}

function parseMusicSequence(r: Reader, record: SequenceRecord, sequence: number, instruments: LocalInstrument[]): Sequence {
  const loop = LOOP_TICKS[sequence - FIRST_MUSIC_SEQUENCE];
  const events: MidiEvent[] = [];
  let trackAt = record.start;
  let observedEnd = 0;
  let ppq = 0;
  let qpm = 0;
  for (let track = 0; track < record.tracks; track++) {
    const header = readTrack(r, trackAt, record.end, sequence);
    if (ppq && (header.ppq !== ppq || header.qpm !== qpm)) throw new Error(`Cruis'n USA sequence ${sequence} has discordant track tempos`);
    ppq = header.ppq;
    qpm = header.qpm;
    if (header.patch >= instruments.length) throw new Error(`Invalid Cruis'n USA sequence ${sequence} initial patch`);
    const channel = track & 15;
    const initial: MidiEvent[] = [
      { tick: 0, us: 0, status: 0xc0 | channel, a: header.patch, b: 0 },
      { tick: 0, us: 0, status: 0xb0 | channel, a: 7, b: header.volume },
      { tick: 0, us: 0, status: 0xb0 | channel, a: 10, b: header.pan },
    ];
    events.push(...initial);
    if (header.pitch !== 0) throw new Error(`Unsupported Cruis'n USA sequence ${sequence} initial pitch`);

    let position = header.start;
    let tick = 0;
    let patch = header.patch;
    let volume = header.volume;
    let pan = header.pan;
    const heldNotes = new Map<number, MidiEvent[]>();
    const firstLoopNoteOff = new Map<number, number>();
    let terminated = false;
    const commandTicks = new Map<number, number>();
    while (position < header.end) {
      const eventStart = position - header.start;
      let delta: number;
      [delta, position] = readVlq(r, position, header.end, sequence);
      tick += delta;
      if (position >= header.end) throw new Error(`Truncated Cruis'n USA sequence ${sequence} event`);
      const command = r.u8(position);
      commandTicks.set(position - header.start, tick);
      const size = COMMAND_LENGTHS[command] ?? 0;
      if (size === 0 || position + size > header.end) throw new Error(`Unsupported Cruis'n USA sequence ${sequence} command ${command}`);
      const us = ticksToUs(tick, ppq, qpm);
      if (command === 7) {
        patch = r.u8(position + 1) | (r.u8(position + 2) << 8);
        if (patch >= instruments.length) throw new Error(`Invalid Cruis'n USA sequence ${sequence} patch`);
        events.push({ tick, us, status: 0xc0 | channel, a: patch, b: 0 });
        // WESS keeps track volume and pan across patch changes, whereas the
        // libultra sequence renderer initializes those controls per instrument.
        events.push({ tick, us, status: 0xb0 | channel, a: 7, b: volume });
        events.push({ tick, us, status: 0xb0 | channel, a: 10, b: pan });
      } else if (command === 9) {
        const signed = r.u8(position + 1) | (r.u8(position + 2) << 8);
        const bend = Math.max(0, Math.min(16383, 8192 + ((signed << 16 >> 16) / 4)));
        events.push({ tick, us, status: 0xe0 | channel, a: bend & 127, b: bend >> 7 });
      } else if (command === 11) {
        // Modulation depth; WESS N64 modulation synthesis is not modelled by
        // the shared PCM renderer. Consume it without changing track timing.
      } else if (command === 12) {
        volume = r.u8(position + 1);
        events.push({ tick, us, status: 0xb0 | channel, a: 7, b: volume });
      } else if (command === 13) {
        pan = r.u8(position + 1);
        events.push({ tick, us, status: 0xb0 | channel, a: 10, b: pan });
      } else if (command === 14) {
        events.push({ tick, us, status: 0xb0 | channel, a: 64, b: r.u8(position + 1) });
      } else if (command === 17) {
        const key = r.u8(position + 1);
        const velocity = r.u8(position + 2);
        const sound = instruments[patch]?.sounds.find((s) => key >= s.keyMin && key <= s.keyMax && velocity >= s.velMin && velocity <= s.velMax);
        if (!sound) throw new Error(`Cruis'n USA sequence ${sequence} note has no patch map`);
        const event: MidiEvent = { tick, us, status: 0x90 | channel, a: key, b: velocity };
        events.push(event);
        const held = heldNotes.get(key) ?? [];
        held.push(event);
        heldNotes.set(key, held);
      } else if (command === 18) {
        // The N64 driver scans all active voices of this key and track,
        // releasing each. The shared mixer releases a note at durUs.
        const key = r.u8(position + 1);
        if (loop && tick >= loop[0] && !firstLoopNoteOff.has(key)) firstLoopNoteOff.set(key, tick);
        for (const held of heldNotes.get(key) ?? []) held.durUs = Math.max(0, us - held.us);
        heldNotes.delete(key);
      } else if (command === 32) {
        const label = r.u8(position + 1) | (r.u8(position + 2) << 8);
        // Sequence 167, track 2 has TrkJump 0 and no declared label. The
        // retail track bytes do not identify a valid target; stop that track.
        if (sequence === 167 && track === 2 && label === 0 && header.labels.length === 0) {
          terminated = true;
          observedEnd = Math.max(observedEnd, tick);
          position += size;
          break;
        }
        if (!loop || label >= header.labels.length) throw new Error(`Invalid Cruis'n USA sequence ${sequence} track jump`);
        const target = header.labels[label];
        if (target > eventStart || commandTicks.get(target) !== loop[0]) {
          throw new Error(`Invalid Cruis'n USA sequence ${sequence} track jump target`);
        }
        terminated = true;
        observedEnd = Math.max(observedEnd, tick);
        position += size;
        break;
      } else if (command === 34) {
        terminated = true;
        observedEnd = Math.max(observedEnd, tick);
        position += size;
        break;
      } else if (command !== 35) {
        throw new Error(`Unsupported Cruis'n USA music command ${command} in sequence ${sequence}`);
      }
      position += size;
    }
    if (!terminated) throw new Error(`Unterminated Cruis'n USA sequence ${sequence} track`);
    for (const [key, held] of heldNotes) {
      const wrappedOff = loop ? firstLoopNoteOff.get(key) : undefined;
      const offTick = wrappedOff === undefined ? tick : tick + wrappedOff - loop![0];
      const offUs = ticksToUs(offTick, ppq, qpm);
      for (const note of held) note.durUs = Math.max(0, offUs - note.us);
    }
    trackAt = header.end;
  }
  if (trackAt > record.end || record.end - trackAt > 7) throw new Error(`Invalid Cruis'n USA sequence ${sequence} payload accounting`);
  const endTick = loop ? loop[1] : observedEnd;
  if (observedEnd < endTick || observedEnd - endTick > 5) throw new Error(`Unexpected Cruis'n USA sequence ${sequence} endpoint`);
  events.sort((a, b) => a.tick - b.tick);
  return {
    division: ppq,
    events,
    tempos: [{ tick: 0, uspt: 60_000_000 / (ppq * qpm) }],
    endTick,
    endUs: ticksToUs(endTick, ppq, qpm),
    loopStartTick: loop?.[0],
    loopStartUs: loop ? ticksToUs(loop[0], ppq, qpm) : undefined,
  };
}

function cruisnMusic(rom: Uint8Array): { tracks: MusicTrack[]; decode(index: number): DecodedMusic } {
  const reader = new Reader(rom);
  const layout = archiveLayout(reader);
  const records = sequenceRecords(reader, layout);
  let bank: Bank | undefined;
  return {
    tracks: SONG_NAMES.map((name, index) => ({ index, name: `${FIRST_MUSIC_SEQUENCE + index} ${name}` })),
    decode(index: number): DecodedMusic {
      if (!Number.isInteger(index) || index < 0 || index >= MUSIC_SEQUENCES) throw new Error(`No Cruis'n USA music track ${index}`);
      bank ??= parseBank(reader, layout);
      const instruments = bank.instruments as unknown as LocalInstrument[];
      const sequenceId = FIRST_MUSIC_SEQUENCE + index;
      const sequence = parseMusicSequence(reader, records[sequenceId], sequenceId, instruments);
      const rendered = renderSequence(rom, bank, sequence, {
        rate: OUTPUT_RATE,
        maxVoices: MAX_VOICES,
        seqVol: SEQUENCE_VOLUME,
        loop: LOOP_TICKS[index] !== null,
        pitchScale: 1,
      }).music;
      const authored = LOOP_TICKS[index];
      if (authored) {
        // The renderer may retain a few naturally ending voices past the
        // branch while finding a steady-state cycle. Playback still follows
        // the authored WESS jump positions, which are the viewer's loop API.
        rendered.loopStart = Math.round((sequence.loopStartUs! * OUTPUT_RATE) / 1_000_000);
        rendered.loopEnd = Math.round((sequence.endUs * OUTPUT_RATE) / 1_000_000);
        if (rendered.channels.some((channel) => channel.length < rendered.loopEnd!)) throw new Error(`Cruis'n USA music track ${index} is truncated`);
      }
      return rendered;
    },
  };
}

const musicByRom = new WeakMap<Uint8Array, ReturnType<typeof cruisnMusic>>();

function player(rom: Uint8Array) {
  let music = musicByRom.get(rom);
  if (!music) {
    music = cruisnMusic(rom);
    musicByRom.set(rom, music);
  }
  return music;
}

export function listCruisnUsaMusic(rom: Uint8Array): MusicTrack[] {
  return player(rom).tracks;
}

export function decodeCruisnUsaMusic(rom: Uint8Array, index: number): DecodedMusic {
  return player(rom).decode(index);
}
