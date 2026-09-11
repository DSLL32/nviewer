// Music of the three Bomberman games: libultra's compressed-MIDI sequence player (alCSPlayer)
// with ALBankFile instrument banks, stored uncompressed in one blob per game:
//   "S2" table: u16 'S2', u16 count, count x {u32 seqOffset, u32 seqLength} (0xFFFFFFFF =
//   empty), then count x 16-byte records {u8 bank, u8 volume, u16, u32 ctlOffset, u32 ctlSize,
//   u32 tblOffset}; offsets are relative to the table.
// Sequences: 16 u32 track offsets and u32 division, then per track {varlen delta, event}.
// Every byte fetch expands FE FE to FE and FE hi lo len to a back-reference of len bytes at
// (position of FE) - (hi << 8 | lo). Note-ons carry their duration (varlen ticks); FF 51 tempo,
// FF 2F end of track, FF 2E loop start, FF 2D cnt cur offset loop end (cur 0xFF = forever).
import { type Bank, type MidiEvent, parseBank, renderSequence, type Sequence } from '../music/libultra';
import type { DecodedMusic, MusicTrack } from '../types';
import { view } from '../util';

export type BombermanGame = 'bm64' | 'bm64sa' | 'bmhero';

const OUTPUT_RATE = 32000;

// gain: sequence volume = song volume byte / 127 * 0x7FFF * gain, measured against captured game
// audio. The mixer squares the volume, so loudness scales with gain^2. Render/capture loudness at
// gain 1: BM64 songs 1, 26, 29 at 0.995-1.015, Hero song 24 at 0.97, SA songs 1 and 3 at 1.72-1.80.
const GAMES: Record<BombermanGame, { s2: number; eqpower: number; voices: number; gain: number; names: Record<number, string>; skip: Set<number> }> = {
  bm64: {
    s2: 0x30a898, eqpower: 0x1bfe0, voices: 16, gain: 1,
    // No sound test: names describe where the game plays each song.
    names: {
      1: 'Adventure Intro', 2: 'World Select', 3: 'Green Garden', 4: 'Blue Resort', 5: 'Red Mountain', 6: 'White Glacier',
      7: 'Black Fortress', 8: 'Rainbow Palace', 10: 'Rival Battle', 11: 'Boss (Blue Resort to White Glacier)',
      12: 'Boss (Black Fortress) A', 13: 'Boss (Black Fortress) B', 14: 'Boss (Green Garden)', 15: 'Boss (Rainbow Palace) A',
      16: 'Boss (Rainbow Palace) B', 17: 'Unused Song A', 18: 'Rival Battle Cue', 19: 'Boss Arena Cue', 22: 'Story Cutscene',
      26: 'Attract Intro', 27: 'Battle', 29: 'Battle Menu', 31: 'Battle Menu Cue A', 32: 'Battle Menu Cue B', 35: 'Final Battles',
      39: 'Unused Song B', 40: 'Unused Song C', 42: 'Boss Arena', 44: 'VS Altair',
    },
    // Identical one-track cues with no reference in the code.
    skip: new Set([0, 9, 23, 25, 34, 36, 37, 41, 43]),
  },
  bmhero: {
    s2: 0x38a1f0, eqpower: 0x4c3b0, voices: 16, gain: 1,
    // Sound Test names (song = BGM number + 1).
    names: Object.fromEntries([
      'BGM Stop', 'Action Scene A', 'Action Scene B', 'Action Scene C', 'Dark Cave', 'Bomber Jet', 'Bomber Marine',
      'Bomber Copter', 'Mad Garden', 'Non-Gravity', 'Pyramid Eye', 'Bomber Slider', 'Louie', 'Vs. Nitros',
      'Vs. The Big Four', 'Vs. Bagular', 'Forever', 'Dark Trap', 'United Scene-Short', 'Silent Pressure', 'I am Nitros',
      "Garaden's Defeat", 'Rescue', 'Bomberman Hero', 'Game Over', 'Cosmo Space', 'Good Job!', 'Bomber Techno', 'Ending',
      'Map Clear', 'Stage Clear', 'United Scene-Long',
    ].map((name, i) => [i + 1, name])),
    skip: new Set([0, 1]),
  },
  bm64sa: {
    s2: 0x2a8008, eqpower: 0x953d0, voices: 22, gain: 0.75,
    names: {
      1: 'Main Menu', 2: 'Menu B', 3: 'Intro', 4: 'World Select', 5: 'Character Select', 7: 'Menu C',
      8: 'Lost Planet Alcatraz', 9: 'Lost Planet Alcatraz (event)', 10: 'Ocean Planet Aquanet', 11: 'Ocean Planet Aquanet (event)',
      12: 'Sky Planet Horizon', 13: 'Sky Planet Horizon (event)', 14: 'Game Planet Starlight (event)', 15: 'Game Planet Starlight',
      16: 'Nature Planet Neverland (event)', 17: 'Nature Planet Neverland', 18: 'Amusement Planet Epikyur', 19: 'Epikyur Special Area',
      20: 'Prison Planet Thantos (event)', 21: 'Prison Planet Thantos', 22: 'Warship Noah', 24: 'Story Cue A', 25: 'Story Cue B',
      38: 'Merchant Ship Frontier', 42: 'Survival Battle', 43: 'Survival Battle (hurry)', 44: 'KO Battle', 45: 'KO Battle (hurry)',
      46: 'King & Knights', 47: 'King & Knights (hurry)', 48: 'Treasure Hunt', 49: 'Treasure Hunt (hurry)', 50: 'Score Attack',
      51: 'Score Attack (hurry)', 52: 'Menu D', 53: 'Menu E', 54: 'Alcatraz Cell', 60: 'Menu F', 63: 'Game Over', 66: 'Menu G',
      67: 'Menu H', 69: 'Draw Game',
    },
    // One-track silent stubs.
    skip: new Set([0, 6, 23, 28, 29, 30, 31, 32, 33, 57, 59, 70, 74, 75]),
  },
};

interface Song {
  seq: number;
  length: number;
  bank: number;
  volume: number;
  ctl: number;
  tbl: number;
}

function songTable(rom: Uint8Array, base: number): (Song | null)[] {
  const dv = view(rom);
  if (dv.getUint16(base) !== 0x5332) throw new Error('Music table not found');
  const count = dv.getUint16(base + 2);
  const songs: (Song | null)[] = [];
  for (let i = 0; i < count; i++) {
    const seq = dv.getUint32(base + 4 + i * 8);
    const r = base + 4 + count * 8 + i * 16;
    songs.push(seq === 0xffffffff ? null : {
      seq: base + seq, length: dv.getUint32(base + 8 + i * 8), bank: rom[r], volume: rom[r + 1],
      ctl: base + dv.getUint32(r + 4), tbl: base + dv.getUint32(r + 12),
    });
  }
  return songs;
}

// A compressed MIDI sequence as alCSPlayer plays it. Finite loops are unrolled; a loop that
// repeats forever becomes the sequence's loop region.
export function parseCompressedMidi(d: Uint8Array, start: number): Sequence {
  const dv = view(d);
  const division = dv.getUint32(start + 64) || 480;
  const qnpt = Math.fround(1 / division);
  interface Raw { tick: number; order: number; status: number; a: number; b: number; dur: number; tempo: number }
  const raw: Raw[] = [];
  let order = 0;
  let loopStartTick: number | undefined;
  let loopEndTick: number | undefined;
  let lastTick = 0;

  for (let t = 0; t < 16; t++) {
    const off = dv.getUint32(start + t * 4);
    if (!off) continue;
    let pos = start + off;
    let refPos = 0;
    let refLen = 0;
    const byte = (): number => {
      if (refLen > 0) {
        refLen--;
        return d[refPos++] ?? 0;
      }
      const b = d[pos++] ?? 0;
      if (b !== 0xfe) return b;
      const hi = d[pos++];
      if (hi === 0xfe) return 0xfe;
      const lo = d[pos++];
      refLen = d[pos++];
      refPos = pos - 4 - ((hi << 8) | lo);
      if (refLen === 0) return 0;
      refLen--;
      return d[refPos++] ?? 0;
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
    const visited = new Map<number, number>(); // stream position -> tick of the first visit
    const loopCur = new Map<number, number>();
    let tick = 0;
    let status = 0;
    let lastLoopStart = 0;
    for (let guard = 0; guard < 1_000_000 && pos < d.length; guard++) {
      if (refLen === 0 && !visited.has(pos)) visited.set(pos, tick);
      tick += varlen();
      const st = byte();
      if (st === 0xff) {
        const type = byte();
        status = 0;
        if (type === 0x51) {
          const tempo = (byte() << 16) | (byte() << 8) | byte();
          raw.push({ tick, order: order++, status: 0xff, a: 0, b: 0, dur: 0, tempo });
        } else if (type === 0x2f) {
          break;
        } else if (type === 0x2e) {
          byte();
          byte();
          lastLoopStart = tick;
        } else if (type === 0x2d) {
          // The loop counters are read from (and written to) the stream itself.
          const p = pos;
          const cnt = d[p];
          const cur = loopCur.get(p) ?? d[p + 1];
          const back = dv.getUint32(p + 2);
          if (cur === 0) {
            loopCur.set(p, cnt);
            pos = p + 6;
          } else if (cur === 0xff) {
            loopEndTick ??= tick;
            loopStartTick ??= visited.get(p + 6 - back) ?? lastLoopStart;
            break;
          } else {
            loopCur.set(p, cur - 1);
            pos = p + 6 - back;
          }
        } else {
          break;
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
      if (!kind) break;
      const b = kind === 0xc0 || kind === 0xd0 ? 0 : byte();
      const dur = kind === 0x90 ? varlen() : 0;
      raw.push({ tick, order: order++, status, a, b, dur, tempo: 0 });
    }
    lastTick = Math.max(lastTick, tick);
  }

  raw.sort((x, y) => x.tick - y.tick || x.order - y.order);
  const tempos: { tick: number; uspt: number }[] = [];
  const events: MidiEvent[] = [];
  let uspt = 488; // alCSPNew default
  let tick = 0;
  let us = 0;
  const endTick = loopEndTick ?? lastTick;
  let loopStartUs: number | undefined;
  const advance = (to: number) => {
    if (loopStartTick !== undefined && loopStartUs === undefined && to >= loopStartTick) {
      loopStartUs = us + (loopStartTick - tick) * uspt;
    }
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
  const endUs = us - (tick - endTick) * uspt;
  const seq: Sequence = { division, events, tempos, endTick, endUs };
  if (loopEndTick !== undefined) {
    seq.loopStartTick = loopStartTick ?? 0;
    seq.loopStartUs = loopStartUs ?? 0;
  }
  return seq;
}

export function bombermanMusic(rom: Uint8Array, game: BombermanGame): { tracks: MusicTrack[]; decode(i: number): DecodedMusic } {
  const def = GAMES[game];
  let songs: (Song | null)[];
  try {
    songs = songTable(rom, def.s2);
  } catch {
    return { tracks: [], decode: () => { throw new Error('No music'); } };
  }
  const list = songs.map((s, i) => (s && !def.skip.has(i) ? i : -1)).filter((i) => i >= 0);
  const banks = new Map<string, Bank>();
  return {
    tracks: list.map((song, index) => ({ index, name: `${String(song).padStart(2, '0')} ${def.names[song] ?? `Song ${song}`}` })),
    decode(index: number) {
      const song = songs[list[index]];
      if (!song) throw new Error(`No music track ${index}`);
      const key = `${song.ctl}/${song.bank}`;
      let bank = banks.get(key);
      if (!bank) {
        bank = parseBank(rom, song.ctl, song.tbl, song.bank, def.eqpower);
        banks.set(key, bank);
      }
      const seq = parseCompressedMidi(rom, song.seq);
      const seqVol = Math.round((song.volume * 0x7fff * def.gain) / 127);
      return renderSequence(rom, bank, seq, {
        rate: OUTPUT_RATE, maxVoices: def.voices, seqVol, loop: seq.loopStartTick !== undefined,
      }).music;
    },
  };
}
