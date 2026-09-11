// GoldenEye 007 (U) soundtrack: 59 of the 63 music sequences (0, 20, 30 and 39 are silent stubs), rendered with
// libultra.ts. The game uses stock libultra audio (GOLDENEYE.md §5): one ALBankFile instrument bank and the
// compressed-MIDI sequence player alCSPlayer, so only the sequence container and the per-track loops are its own.
// Ported from the research prototype, whose renders match captured game audio in tempo, pitch and level (§5.6).
//
// Data (§5.2): music .ctl 0x3B4450 / .tbl 0x3B87F0; sequence table 0x419790 {u16 count = 63, u16 0, count x {u32
// offset from the table, u16 size, u16 compressed size}}, each sequence a 1172 stream (11 72 + raw DEFLATE); the s16
// song volume table at 0x80024358 in the data segment (ROM 0x21990, also a 1172 stream, linked at 0x80020D90).
import { inflateRaw } from '../inflate';
import { type Bank, type MidiEvent, parseBank, renderSequence, type Sequence } from '../music/libultra';
import type { DecodedMusic, MusicTrack } from '../types';

const MUSIC_CTL = 0x3b4450;
const MUSIC_TBL = 0x3b87f0;
const SEQ_TABLE = 0x419790;
const SEQ_COUNT = 63;
const DATA_SEGMENT = 0x21990; // ROM
const DATA_BASE = 0x80020d90;
const DATA_SIZE = 0x3c550;
const SONG_VOLUME = 0x80024358;
const RATE = 22047; // osAiSetFrequency(22050): AI_DACRATE 2207 on NTSC
const MAX_VOICES = 16; // each of the game's three alCSPlayers
// Captures of five pieces average x0.876 of the render's amplitude; the mixer squares volume, so the sequence volume
// takes the root. Songs then sit at RMS 0.03-0.20 over their first minute (median 0.095; Star Fox 64 0.078, Yoshi's
// Story 0.055, Bomberman 64 up to 0.23), so no boost; the loud songs 2, 44 and 47 reach full scale, as in the game.
const GAIN = 0.936;

// Names from where each song plays (§5.3); "X" is the stage's alternate track.
const SONGS: [number, string][] = [
  [1, 'Unused sting'], [2, 'Intro (gun barrel)'], [3, 'Train'], [4, 'Depot'], [5, 'Multiplayer 5'], [6, 'Citadel'],
  [7, 'Facility'], [8, 'Control'], [9, 'Dam'], [10, 'Frigate'], [11, 'Archives'], [12, 'Silo'], [13, 'Multiplayer 13'],
  [14, 'Streets'], [15, 'Bunker 1'], [16, 'Bunker 2'], [17, 'Statue'], [18, 'Control (X)'], [19, 'Cradle'],
  [21, 'Caverns (X)'], [22, 'Egyptian'], [23, 'Menus'], [24, 'Watch menu'], [25, 'Aztec'], [26, 'Caverns'],
  [27, 'Death (solo)'], [28, 'Surface 2'], [29, 'Train (X)'], [31, 'Facility (X)'], [32, 'Depot (X)'],
  [33, 'Multiplayer 33'], [34, 'Multiplayer 34'], [35, 'Multiplayer 35'], [36, 'Multiplayer 36'], [37, 'Archives (X)'],
  [38, 'Silo (X)'], [40, 'Streets (X)'], [41, 'Bunker 1 (X)'], [42, 'Bunker 2 (X)'], [43, 'Jungle (X)'],
  [44, 'Nintendo / Rare logos'], [45, 'Multiplayer 45'], [46, 'Aztec (X)'], [47, 'Egyptian (X)'], [48, 'Cradle (X)'],
  [49, 'Cuba (end credits)'], [50, 'Runway'], [51, 'Runway (X)'], [52, 'Multiplayer 52'],
  [53, 'Dam / Surface 1 (X), Surface 2 ambience'], [54, 'Unused 54'], [55, 'Jungle'], [56, 'Multiplayer 56'],
  [57, 'Surface 1'], [58, 'Death (multiplayer)'], [59, 'Unused 59 (copy of 52)'], [60, 'Surface 2 (X)'],
  [61, 'Statue (X)'], [62, 'Frigate (X)'],
];

// Songs that play once. 38 and 60-62 end every track; 1 and 51 loop forever over rests after their last note, so they
// end at the loop start instead (trimming 8 and 3 s of silence).
const ONCE = new Set([1, 38, 51, 60, 61, 62]);

const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

export function goldeneyeMusic(rom: Uint8Array): { tracks: MusicTrack[]; decode(index: number): DecodedMusic } {
  let bank: Bank | undefined;
  let volumes: Int16Array | undefined;
  const stream = (at: number, size: number) => {
    if (rom[at] !== 0x11 || rom[at + 1] !== 0x72) throw new Error(`No 1172 stream at 0x${at.toString(16)}`);
    const d = inflateRaw(rom, at + 2, size);
    if (d.length !== size) throw new Error(`1172 stream at 0x${at.toString(16)}: ${d.length} bytes, expected ${size}`);
    return d;
  };
  return {
    tracks: SONGS.map(([index, name]) => ({ index, name: `${String(index).padStart(2, '0')} ${name}` })),
    decode(index: number): DecodedMusic {
      if (!SONGS.some((s) => s[0] === index)) throw new Error(`No music track ${index}`);
      if (u16(rom, SEQ_TABLE) !== SEQ_COUNT) throw new Error('GoldenEye music sequence table not found');
      const e = SEQ_TABLE + 4 + index * 8;
      const { seq, loop } = parseSequence(stream(SEQ_TABLE + u32(rom, e), u16(rom, e + 4)));
      bank ??= parseBank(rom, MUSIC_CTL, MUSIC_TBL, 0, null);
      if (!volumes) {
        const seg = stream(DATA_SEGMENT, DATA_SIZE), o = SONG_VOLUME - DATA_BASE;
        volumes = Int16Array.from({ length: SEQ_COUNT }, (_, i) => u16(seg, o + 2 * i));
      }
      // 0x7000703C: alCSPSetVol(player, (musicVolume * songVolume[song]) >> 15), the music option at its 0x7FFF default.
      const seqVol = Math.round(((0x7fff * volumes[index]) >> 15) * GAIN);
      const once = ONCE.has(index);
      if (once && loop) {
        seq.endTick = seq.loopStartTick!;
        seq.endUs = seq.loopStartUs!;
        seq.events = seq.events.filter((ev) => ev.tick < seq.endTick);
      }
      return renderSequence(rom, bank, seq, { rate: RATE, maxVoices: MAX_VOICES, seqVol, loop: loop && !once, pitchScale: 1 }).music;
    },
  };
}

interface RawEvent { tick: number; track: number; order: number; status: number; a: number; b: number; dur: number; tempo: number }

interface TrackLoop {
  track: number;
  loopStart?: number; // tick the forever loop jumps back to
  loopEnd?: number; // tick of the forever loop's end marker
  endTick?: number; // FF 2F, tracks without a forever loop
  lastNote: number; // tick of the last note-on before the loop end or the end, -1 if none
}

// Plays track `track` like alCSeqNextEvent: FE FE is a literal FE and FE hi lo len a back-reference to len bytes
// starting hi:lo before the FE; meta events clear running status; note-ons carry a varlen duration; finite loops (FF 2D
// count current offset32) count down with the counter written back into the sequence, the forever loop (count 0xFF)
// always jumps. Collects channel and tempo events before tick `horizon` into `out`; without `out`, stops at the first
// forever loop end.
function runTrack(d: Uint8Array, track: number, horizon: number, out: RawEvent[] | null): TrackLoop {
  let pos = u32(d, track * 4), refPos = 0, refLen = 0;
  const byte = (): number => {
    if (refLen > 0) {
      refLen--;
      return d[refPos++];
    }
    const b = d[pos++];
    if (b !== 0xfe) return b;
    const hi = d[pos++];
    if (hi === 0xfe) return 0xfe;
    const lo = d[pos++], len = d[pos++];
    refPos = pos - 4 - ((hi << 8) | lo);
    refLen = len - 1;
    return d[refPos++];
  };
  const varlen = () => {
    let v = byte();
    if (v & 0x80) {
      v &= 0x7f;
      let c: number;
      do {
        c = byte();
        v = v * 128 + (c & 0x7f);
      } while (c & 0x80);
    }
    return v;
  };
  const info: TrackLoop = { track, lastNote: -1 };
  const visited = new Map<number, number>(); // stream position -> tick it was first reached
  const counters = new Map<number, number>();
  let tick = 0, status = 0, order = 0, lastLoopStart = 0;
  for (let guard = 0; guard < 20_000_000 && pos < d.length; guard++) {
    if (refLen === 0 && !visited.has(pos)) visited.set(pos, tick);
    const delta = varlen();
    if (out && tick + delta >= horizon) break;
    tick += delta;
    const st = byte();
    if (st === 0xff) {
      const type = byte();
      status = 0;
      if (type === 0x51) {
        const tempo = (byte() << 16) | (byte() << 8) | byte();
        out?.push({ tick, track, order: order++, status: 0xff, a: 0, b: 0, dur: 0, tempo });
      } else if (type === 0x2f) {
        info.endTick ??= tick;
        break;
      } else if (type === 0x2e) {
        byte();
        byte();
        lastLoopStart = tick;
      } else if (type === 0x2d) {
        const p = pos, cur = counters.get(p) ?? d[p + 1], target = p + 6 - u32(d, p + 2);
        if (cur === 0) {
          counters.set(p, d[p]);
          pos = p + 6;
        } else {
          if (cur !== 0xff) {
            counters.set(p, cur - 1);
          } else if (info.loopEnd === undefined) {
            info.loopEnd = tick;
            info.loopStart = visited.get(target) ?? lastLoopStart;
            if (!out) break;
          }
          pos = target;
          if (cur === 0xff && tick === info.loopStart) break; // zero-length forever loop
        }
      } else {
        throw new Error(`Track ${track}: unknown meta event FF ${type.toString(16)} at tick ${tick}`);
      }
      continue;
    }
    let a: number;
    if (st & 0x80) {
      status = st;
      a = byte();
    } else {
      a = st;
    }
    const kind = status & 0xf0;
    if (!kind) throw new Error(`Track ${track}: data byte without status at tick ${tick}`);
    const b = kind === 0xc0 || kind === 0xd0 ? 0 : byte();
    const dur = kind === 0x90 ? varlen() : 0;
    if (kind === 0x90 && info.loopEnd === undefined) info.lastNote = tick;
    out?.push({ tick, track, order: order++, status, a, b, dur, tempo: 0 });
  }
  return info;
}

// The song as the game plays it (§5.4). Tracks loop independently, so a looping song repeats [start, start + period):
// start is the latest track loop start, or the last note + 1 of a track that ends; the period is the least common
// multiple of the track loop lengths when that is at most 8x the longest and 300 s, else the longest track loop (the
// polymetric songs 4, 8, 28, 44, 50, 53 and 55, whose tracks drift apart in the game). Bomberman's parser takes the
// loop from the first track that reaches its end, which cuts songs like 41 short.
function parseSequence(d: Uint8Array): { seq: Sequence; loop: boolean } {
  const division = u32(d, 64) || 384;
  const tracks: TrackLoop[] = [];
  for (let t = 0; t < 16; t++) if (u32(d, t * 4)) tracks.push(runTrack(d, t, Infinity, null));
  const looping = tracks.filter((t) => t.loopEnd !== undefined && t.loopEnd > t.loopStart!);
  let loop = looping.length > 0, start = 0, period = 0, endTick: number;
  if (loop) {
    const lens = looping.map((t) => t.loopEnd! - t.loopStart!), longest = Math.max(...lens);
    const lcm = lens.reduce((l, x) => (l / gcd(l, x)) * x, 1);
    const probe: RawEvent[] = [];
    runTrack(d, tracks[0].track, 1, probe);
    const tempo = probe.find((r) => r.status === 0xff)?.tempo ?? 488 * division; // µs per quarter note at tick 0
    period = lcm <= 8 * longest && (lcm * tempo) / division / 1e6 <= 300 ? lcm : longest;
    start = Math.max(...looping.map((t) => t.loopStart!));
    for (const t of tracks) if (t.loopEnd === undefined && t.lastNote >= 0) start = Math.max(start, t.lastNote + 1);
    endTick = start + period;
  } else {
    endTick = Math.max(0, ...tracks.map((t) => t.endTick ?? 0));
  }
  const raw: RawEvent[] = [];
  for (const t of tracks) runTrack(d, t.track, loop ? endTick : Infinity, raw);
  raw.sort((x, y) => x.tick - y.tick || x.track - y.track || x.order - y.order);

  // µs per tick as alCSPlayer computes it, (s32)((f32)tempo * (f32)(1 / division)); alCSPNew's 488 until the first tempo.
  const qnpt = Math.fround(1 / division);
  const events: MidiEvent[] = [], tempos: { tick: number; uspt: number }[] = [];
  let uspt = 488, tick = 0, us = 0, loopStartUs = 0;
  const advance = (to: number) => {
    if (loop && tick <= start && to >= start) loopStartUs = us + (start - tick) * uspt;
    us += (to - tick) * uspt;
    tick = to;
  };
  for (const r of raw) {
    advance(r.tick);
    if (r.status === 0xff) {
      uspt = Math.trunc(Math.fround(Math.fround(r.tempo) * qnpt));
      tempos.push({ tick: r.tick, uspt });
    } else {
      const e: MidiEvent = { tick: r.tick, us, status: r.status, a: r.a, b: r.b };
      if ((r.status & 0xf0) === 0x90) e.durUs = r.dur * uspt;
      events.push(e);
    }
  }
  advance(Math.max(tick, endTick));
  const seq: Sequence = { division, events, tempos, endTick, endUs: us - (tick - endTick) * uspt };
  if (loop && period <= 0) loop = false;
  if (loop) {
    seq.loopStartTick = start;
    seq.loopStartUs = start === 0 ? 0 : loopStartUs;
  }
  return { seq, loop };
}
