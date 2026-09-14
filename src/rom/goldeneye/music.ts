// GoldenEye 007 (U) soundtrack: 59 of the 63 music sequences (0, 20, 30 and 39 are silent stubs), rendered with
// libultra.ts. The game uses stock libultra audio (docs/GOLDENEYE.md §5): one ALBankFile instrument bank and the
// compressed-MIDI sequence player alCSPlayer (tracks loop independently, music/cseq.ts), so only the sequence
// container and the song list are its own. Ported from the research prototype, whose renders match captured game audio
// in tempo, pitch and level (§5.6).
//
// Data (§5.2): music .ctl 0x3B4450 / .tbl 0x3B87F0; sequence table 0x419790 {u16 count = 63, u16 0, count x {u32
// offset from the table, u16 size, u16 compressed size}}, each sequence a 1172 stream (11 72 + raw DEFLATE); the s16
// song volume table at 0x80024358 in the data segment (ROM 0x21990, also a 1172 stream, linked at 0x80020D90).
import { inflateRaw } from '../inflate';
import { parseCompressedSequence } from '../music/cseq';
import { type Bank, parseBank, renderSequence } from '../music/libultra';
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
      const { seq, loop } = parseCompressedSequence(stream(SEQ_TABLE + u32(rom, e), u16(rom, e + 4)));
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
