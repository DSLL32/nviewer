// Off Road Challenge's twelve WESS music sequences. The SN64 v2 bank, SSEQ v2
// tracks and WDD sample archive are byte-identical between the US and European
// releases (the European archive is shifted by 0x70 bytes).
import { type Bank, type MidiEvent, type Sequence, type Wave, renderSequence } from '../music/libultra';
import type { DecodedMusic, MusicTrack } from '../types';

const US_ARCHIVE = 0xc75030;
const EU_ARCHIVE = 0xc750a0;
const SSEQ_REL = 0xf310;
const SSEQ_PAYLOAD_REL = 0xfd80;
const WDD_REL = 0x12190;
const WAVE_END_REL = 0x290624;
const OUTPUT_RATE = 22050;
const MAX_VOICES = 24; // WESS's default driver voice count
const SEQUENCE_VOLUME = 0x7fff;
const MUSIC_SEQUENCES = 12;

const SONG_NAMES = [
  'Cue 0',
  'Transition Cue 1',
  'Music Cue 2',
  'Unreferenced Music 3',
  'Music Cue 4',
  'Startup/Menu Cue 5',
  'BAJA BLAST',
  "KEEP ON TRUCKIN'",
  'COUNTRY JAMBOREE',
  "ROVIN' BAND",
  'PIKES PICK',
  'MOJAVE SWING',
] as const;

// Authored control-flow endpoints, in sequence ticks. The game runs these
// PPQ/QPM 120 tracks at 240 ticks per second.
const LOOP_TICKS: ReadonlyArray<readonly [number, number] | null> = [
  null,
  null,
  [0, 9503],
  [995, 3371],
  [0, 7080],
  [0, 6760],
  [0, 19178],
  [0, 11892],
  [0, 38813],
  [0, 18348],
  [0, 29916],
  [0, 14028],
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
      throw new Error(`Off Road Challenge ${what} lies outside the ROM`);
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
  if (r.ascii(0x20, 7) !== 'OFFROAD' || r.ascii(0x3c, 2) !== 'OF' || r.u8(0x3f) !== 0) {
    throw new Error('Off Road Challenge music data not found');
  }
  const country = r.u8(0x3e);
  const archive = country === 0x45 ? US_ARCHIVE : country === 0x50 ? EU_ARCHIVE : -1;
  if (archive < 0) throw new Error(`Unsupported Off Road Challenge country code 0x${country.toString(16)}`);
  const layout = { archive, sseq: archive + SSEQ_REL, payload: archive + SSEQ_PAYLOAD_REL, wdd: archive + WDD_REL };
  r.need(archive, WAVE_END_REL, 'audio archive');
  if (r.ascii(archive, 4) !== 'SN64' || r.ascii(layout.sseq, 4) !== 'SSEQ') {
    throw new Error('Off Road Challenge WESS archive not found');
  }
  return layout;
}

function equalPowerTable() {
  return Int32Array.from({ length: 128 }, (_, i) => Math.round(Math.cos((i * Math.PI) / 254) * 32767));
}

function parseBank(r: Reader, layout: Layout): Bank {
  const base = layout.archive;
  if (r.u32(base + 4) !== 2) throw new Error('Unsupported Off Road Challenge SN64 version');
  const dataSize = r.u32(base + 24);
  const group = base + 32;
  if (r.u32(group) !== 0x1f) throw new Error('Unsupported Off Road Challenge SN64 load flags');
  const patchCount = r.u16(group + 4);
  const patchSize = r.u16(group + 6);
  const mapCount = r.u16(group + 8);
  const mapSize = r.u16(group + 10);
  const waveCount = r.u16(group + 12);
  const waveSize = r.u16(group + 14);
  const drumCount = r.u16(group + 16);
  const drumSize = r.u16(group + 18);
  const extraSize = r.u32(group + 20);
  if (patchCount !== 196 || patchSize !== 4 || mapCount !== 196 || mapSize !== 20 || waveCount !== 196 || waveSize !== 24 || drumCount !== 0 || drumSize !== 0) {
    throw new Error('Unsupported Off Road Challenge SN64 table layout');
  }

  const patchesAt = group + 24;
  const mapsAt = align8(patchesAt + patchCount * patchSize);
  const wavesAt = align8(mapsAt + mapCount * mapSize);
  const extraAt = align8(wavesAt + waveCount * waveSize);
  if (dataSize !== extraAt + extraSize - (group + 24)) throw new Error('Invalid Off Road Challenge SN64 data size');

  const infoWaves = r.u16(extraAt);
  const rawLoops = r.u16(extraAt + 2);
  const adpcmLoops = r.u16(extraAt + 4);
  const infoWaves2 = r.u16(extraAt + 6);
  if (infoWaves !== waveCount || infoWaves2 !== waveCount || rawLoops !== 0 || adpcmLoops !== 21) {
    throw new Error('Unsupported Off Road Challenge SN64 loop layout');
  }
  const loopsAt = extraAt + 8;
  const booksAt = loopsAt + adpcmLoops * 48;
  if (booksAt + waveCount * 264 !== layout.sseq) throw new Error('Invalid Off Road Challenge SN64 table bounds');

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
    if (type !== 0 || r.u32(at + 20) !== 0) throw new Error(`Unsupported Off Road Challenge wave ${i}`);
    if (loopIndex < -1 || loopIndex >= adpcmLoops) throw new Error(`Invalid Off Road Challenge wave ${i} loop`);
    const completeBytes = Math.floor(len / 9) * 9;
    r.need(layout.wdd + relativeBase, completeBytes, `wave ${i}`);
    declaredEnd = Math.max(declaredEnd, relativeBase + len);

    const bookAt = booksAt + i * 264;
    const order = r.s32(bookAt);
    const predictors = r.s32(bookAt + 4);
    if (order !== 2 || (predictors !== 4 && predictors !== 8)) {
      throw new Error(`Unsupported Off Road Challenge wave ${i} predictor book`);
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
        throw new Error(`Invalid Off Road Challenge wave ${i} loop range`);
      }
    }
    waves.push({ base: layout.wdd + relativeBase, len, type, book, loopStart, loopEnd, loopCount, loopState });
    wavePitches.push(pitch);
  }
  if (declaredEnd !== WAVE_END_REL - WDD_REL) throw new Error('Invalid Off Road Challenge WDD extent');

  const instruments: LocalInstrument[] = [];
  for (let i = 0; i < patchCount; i++) {
    const patchAt = patchesAt + i * patchSize;
    const count = r.u8(patchAt);
    const first = r.u16(patchAt + 2);
    if (count === 0 || first + count > mapCount) throw new Error(`Invalid Off Road Challenge patch ${i}`);
    const sounds: LocalSound[] = [];
    let priority = 0;
    for (let j = 0; j < count; j++) {
      const mapAt = mapsAt + (first + j) * mapSize;
      const waveIndex = r.u16(mapAt + 10);
      if (waveIndex >= waves.length) throw new Error(`Invalid Off Road Challenge patch ${i} wave`);
      priority = Math.max(priority, r.u8(mapAt));
      sounds.push({
        env: {
          attack: r.u16(mapAt + 12) * 1000,
          decay: r.u16(mapAt + 14) * 1000,
          // Music NoteOff detaches the voice instead of releasing it. A
          // synthetic duration stops the renderer when the sample itself ends,
          // so no additional release ramp belongs here.
          release: 0,
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
    instruments.push({ volume: 127, pan: 64, priority, bendRange: 0, sounds });
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
  if (r.u32(sseq + 4) !== 2 || r.u8(sseq + 16) !== 0) throw new Error('Unsupported Off Road Challenge SSEQ version');
  const count = r.u16(sseq + 14);
  const tableSize = r.u32(sseq + 24);
  if (count !== 165 || tableSize !== count * 16 || layout.payload !== sseq + 32 + tableSize) {
    throw new Error('Invalid Off Road Challenge SSEQ table');
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
      throw new Error(`Invalid Off Road Challenge sequence ${i} header`);
    }
    const start = layout.payload + relative;
    r.need(start, size, `sequence ${i}`);
    const end = start + size;
    furthest = Math.max(furthest, end);
    records.push({ tracks, start, end });
  }
  if (furthest !== layout.archive + WDD_REL - 8) throw new Error('Invalid Off Road Challenge SSEQ extent');
  return records;
}

function readTrack(r: Reader, at: number, sequenceEnd: number, sequence: number): TrackHeader {
  r.need(at, 20, `sequence ${sequence} track header`);
  if (r.u8(at) !== 1 || r.u16(at + 10) !== 120 || r.u16(at + 12) !== 120) {
    throw new Error(`Unsupported Off Road Challenge music track in sequence ${sequence}`);
  }
  const labelCount = r.u16(at + 14);
  const eventBytes = r.u32(at + 16);
  if (labelCount > 32) throw new Error(`Invalid Off Road Challenge sequence ${sequence} labels`);
  const labelsAt = at + 20;
  const start = labelsAt + labelCount * 4;
  const end = start + eventBytes;
  if (end > sequenceEnd || end < start) throw new Error(`Invalid Off Road Challenge sequence ${sequence} track bounds`);
  const labels = Array.from({ length: labelCount }, (_, i) => r.u32(labelsAt + i * 4));
  for (const label of labels) if (label > eventBytes) throw new Error(`Invalid Off Road Challenge sequence ${sequence} label`);
  return {
    start,
    end,
    patch: r.u16(at + 2),
    pitch: r.s16(at + 4),
    volume: r.u8(at + 6),
    pan: r.u8(at + 7),
    labels,
  };
}

function readVlq(r: Reader, position: number, end: number, sequence: number): [number, number] {
  let value = 0;
  for (let count = 0; count < 4; count++) {
    if (position >= end) throw new Error(`Truncated Off Road Challenge sequence ${sequence} VLQ`);
    const byte = r.u8(position++);
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return [value, position];
  }
  throw new Error(`Oversized Off Road Challenge sequence ${sequence} VLQ`);
}

function ticksToUs(ticks: number) {
  return (ticks * 1_000_000) / 240;
}

function parseMusicSequence(r: Reader, record: SequenceRecord, sequence: number, instruments: LocalInstrument[]): Sequence {
  const loop = LOOP_TICKS[sequence];
  const events: MidiEvent[] = [];
  let trackAt = record.start;
  let observedEnd = 0;
  for (let track = 0; track < record.tracks; track++) {
    const header = readTrack(r, trackAt, record.end, sequence);
    if (header.patch >= instruments.length) throw new Error(`Invalid Off Road Challenge sequence ${sequence} initial patch`);
    const channel = track & 15;
    const initial: MidiEvent[] = [
      { tick: 0, us: 0, status: 0xc0 | channel, a: header.patch, b: 0 },
      { tick: 0, us: 0, status: 0xb0 | channel, a: 7, b: header.volume },
      { tick: 0, us: 0, status: 0xb0 | channel, a: 10, b: header.pan },
    ];
    events.push(...initial);
    if (header.pitch !== 0) throw new Error(`Unsupported Off Road Challenge sequence ${sequence} initial pitch`);

    let position = header.start;
    let tick = 0;
    let patch = header.patch;
    let terminated = false;
    const commandTicks = new Map<number, number>();
    while (position < header.end) {
      const eventStart = position - header.start;
      let delta: number;
      [delta, position] = readVlq(r, position, header.end, sequence);
      tick += delta;
      if (position >= header.end) throw new Error(`Truncated Off Road Challenge sequence ${sequence} event`);
      const command = r.u8(position);
      commandTicks.set(position - header.start, tick);
      const size = COMMAND_LENGTHS[command] ?? 0;
      if (size === 0 || position + size > header.end) throw new Error(`Unsupported Off Road Challenge sequence ${sequence} command ${command}`);
      const us = ticksToUs(tick);
      if (command === 7) {
        patch = r.u8(position + 1) | (r.u8(position + 2) << 8);
        if (patch >= instruments.length) throw new Error(`Invalid Off Road Challenge sequence ${sequence} patch`);
        events.push({ tick, us, status: 0xc0 | channel, a: patch, b: 0 });
        // WESS keeps track volume and pan across patch changes, whereas the
        // libultra sequence renderer initializes those controls per instrument.
        events.push({ tick, us, status: 0xb0 | channel, a: 7, b: header.volume });
        events.push({ tick, us, status: 0xb0 | channel, a: 10, b: header.pan });
      } else if (command === 17) {
        const key = r.u8(position + 1);
        const velocity = r.u8(position + 2);
        const sound = instruments[patch]?.sounds.find((s) => key >= s.keyMin && key <= s.keyMax && velocity >= s.velMin && velocity <= s.velMax);
        if (!sound) throw new Error(`Off Road Challenge sequence ${sequence} note has no patch map`);
        const sourceSamples = Math.floor(sound.wave.len / 9) * 16;
        const ratio = Math.pow(2, ((key - sound.keyBase) * 100 + sound.detune) / 1200);
        events.push({ tick, us, status: 0x90 | channel, a: key, b: velocity, durUs: (sourceSamples * 1_000_000) / (OUTPUT_RATE * ratio) });
      } else if (command === 18) {
        // Music NoteOff transfers a WESS voice out of track ownership; its
        // pre-rendered sample continues naturally, so duration is set above.
      } else if (command === 32) {
        const label = r.u8(position + 1) | (r.u8(position + 2) << 8);
        if (!loop || label >= header.labels.length) throw new Error(`Invalid Off Road Challenge sequence ${sequence} track jump`);
        const target = header.labels[label];
        if (target > eventStart || commandTicks.get(target) !== loop[0]) {
          throw new Error(`Invalid Off Road Challenge sequence ${sequence} track jump target`);
        }
        terminated = true;
        observedEnd = Math.max(observedEnd, tick);
        position += size;
        break;
      } else if (command === 34) {
        if (loop) throw new Error(`Looping Off Road Challenge sequence ${sequence} ends without a jump`);
        terminated = true;
        observedEnd = Math.max(observedEnd, tick);
        position += size;
        break;
      } else if (command !== 35) {
        throw new Error(`Unsupported Off Road Challenge music command ${command} in sequence ${sequence}`);
      }
      position += size;
    }
    if (!terminated) throw new Error(`Unterminated Off Road Challenge sequence ${sequence} track`);
    trackAt = header.end;
  }
  if (trackAt > record.end || record.end - trackAt > 7) throw new Error(`Invalid Off Road Challenge sequence ${sequence} payload accounting`);
  const endTick = loop ? loop[1] : observedEnd;
  if (observedEnd < endTick || observedEnd - endTick > 5) throw new Error(`Unexpected Off Road Challenge sequence ${sequence} endpoint`);
  events.sort((a, b) => a.tick - b.tick);
  return {
    division: 120,
    events,
    tempos: [{ tick: 0, uspt: 1_000_000 / 240 }],
    endTick,
    endUs: ticksToUs(endTick),
    loopStartTick: loop?.[0],
    loopStartUs: loop ? ticksToUs(loop[0]) : undefined,
  };
}

export function offRoadMusic(rom: Uint8Array): { tracks: MusicTrack[]; decode(index: number): DecodedMusic } {
  const reader = new Reader(rom);
  const layout = archiveLayout(reader);
  const records = sequenceRecords(reader, layout);
  let bank: Bank | undefined;
  return {
    tracks: SONG_NAMES.map((name, index) => ({ index, name: `${String(index).padStart(2, '0')} ${name}` })),
    decode(index: number): DecodedMusic {
      if (!Number.isInteger(index) || index < 0 || index >= MUSIC_SEQUENCES) throw new Error(`No Off Road Challenge music track ${index}`);
      bank ??= parseBank(reader, layout);
      const instruments = bank.instruments as unknown as LocalInstrument[];
      const sequence = parseMusicSequence(reader, records[index], index, instruments);
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
        rendered.loopStart = Math.round((authored[0] * OUTPUT_RATE) / 240);
        rendered.loopEnd = Math.round((authored[1] * OUTPUT_RATE) / 240);
        if (rendered.channels.some((channel) => channel.length < rendered.loopEnd!)) throw new Error(`Off Road Challenge music track ${index} is truncated`);
      }
      return rendered;
    },
  };
}
