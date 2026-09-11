// libultra compressed MIDI (ALCSeq) with tracks that loop independently, as alCSPlayer and n_alCSPlayer play it
// (GoldenEye 007, Perfect Dark). Header: u32 trackOffset[16] (0 = unused), u32 division. Per track {varlen delta,
// event}; every byte fetch expands FE FE to FE and FE hi lo len to a back-reference of len bytes starting hi:lo before
// the FE. Note-ons carry a varlen duration; FF 51 tempo, FF 2F end of track, FF 2E loop start, FF 2D count cur u32 back
// loop end (cur 0xFF = forever). Bomberman's parser (bomberman/music.ts) instead takes the loop of the first track that
// reaches one.
import type { MidiEvent, Sequence } from './libultra';

interface RawEvent { tick: number; track: number; order: number; status: number; a: number; b: number; dur: number; tempo: number }

interface TrackLoop {
  track: number;
  loopStart?: number; // tick the forever loop jumps back to
  loopEnd?: number; // tick of the forever loop's end marker
  endTick?: number; // FF 2F, tracks without a forever loop
  lastNote: number; // tick of the last note-on before the loop end or the end, -1 if none
}

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

// Plays track `track` like alCSeqNextEvent: meta events clear running status; finite loops count down with the counter
// written back into the sequence, the forever loop (count 0xFF) always jumps. Collects channel and tempo events before
// tick `horizon` into `out`; without `out`, stops at the first forever loop end.
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

// The song as the game plays it. Tracks loop independently, so a looping song repeats [start, start + period): start
// is the latest track loop start, or the last note + 1 of a track that ends; the period is the least common multiple
// of the track loop lengths when that is at most 8x the longest and 300 s, else the longest track loop (polymetric
// songs such as GoldenEye's 4, 8 and 28 or Perfect Dark's ambiences 8 and 106, whose tracks drift apart in the game).
// Without a common period, loops that all end on the same tick restart from the earliest loop start instead, so that
// no track plays its loop start twice (Perfect Dark's menu song 27 loops from ticks 1 and 5). `loop` is false for
// songs without a forever loop.
export function parseCompressedSequence(d: Uint8Array): { seq: Sequence; loop: boolean } {
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
    const common = lcm <= 8 * longest && (lcm * tempo) / division / 1e6 <= 300;
    period = common ? lcm : longest;
    const starts = looping.map((t) => t.loopStart!);
    start = !common && looping.every((t) => t.loopEnd === looping[0].loopEnd) ? Math.min(...starts) : Math.max(...starts);
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
