// Perfect Dark (U V1.0) soundtrack: 117 of the 119 music sequences (0 is 400 s of silence, 95 a single test note),
// rendered with libultra.ts. The game uses libultra's n_audio (PERFECTDARK.md §6.1): one ALBankFile instrument bank and
// the compressed-MIDI player n_alCSPlayer, whose envelope mixer takes the voice volume linearly rather than squared.
// Ported from the research prototype, whose renders match captured game audio in tempo, pitch and level (§6.5). Tracks
// loop independently (music/cseq.ts); the prototype took the first track's loop, which cut the ambiences 5, 109 and 110
// down to one layer and silenced layers of 8, 102 and 106 for part of each loop.
//
// Data (§6.2): music .ctl 0xCFBF30 / .tbl 0xD05F90; sequence table 0xE82000 {u16 count = 119, u16 0, count x {u32
// offset from the table, u16 size, u16 compressed size}}, each sequence a 1173 stream (11 73, u24 size, raw DEFLATE);
// the s16 sequence volume table at 0x8005ECF8 in the data segment (ROM 0x39850, also 1173, linked at 0x80059FE0).
import { inflateRaw } from '../inflate';
import { parseCompressedSequence } from '../music/cseq';
import { type Bank, parseBank, renderSequence } from '../music/libultra';
import type { DecodedMusic, MusicTrack } from '../types';

const MUSIC_CTL = 0xcfbf30;
const MUSIC_TBL = 0xd05f90;
const SEQ_TABLE = 0xe82000;
const SEQ_COUNT = 119;
const DATA_SEGMENT = 0x39850; // ROM
const DATA_BASE = 0x80059fe0;
const DATA_SIZE = 0x30e40;
const SEQ_VOLUME = 0x8005ecf8;
const MUSIC_VOLUME = 0x5000; // the music option's default and maximum
const RATE = 22018; // AI dacrate 2210
const MAX_VOICES = 44;
// No gain: captures of five pieces sit 0.9 dB below the renders on average (±3 dB, §6.5). A few loud songs touch full
// scale for up to 220 samples, as the game's 16-bit mixer does.

// Combat Simulator Soundtrack names where they exist; otherwise where the game plays the song (§6.3, §6.4; the cutscene
// names follow the decompilation's). "X" is the stage's alternate track.
const SONGS: [number, string][] = [
  [1, 'Title sting'], [2, 'dD Extraction'], [3, 'Menu'], [4, 'Institute Defense'], [5, 'dD Research ambience'],
  [6, 'A51 Escape'], [7, 'Deep Sea'], [8, 'dD Central ambience'], [9, 'dD Central'], [10, 'End sting'],
  [11, 'dD Central intro ambience'], [12, 'Carrington Villa'], [13, 'Carrington Institute'], [14, 'Chicago'],
  [15, 'G5 Building'], [16, 'dD Central X'], [17, 'dD Extraction X'], [18, 'dD Research'], [19, 'dD Research X'],
  [20, 'A51 Infiltration'], [21, 'Unused death sting'], [22, 'A51 Rescue'], [23, 'Air Base'], [24, 'Air Force One'],
  [25, 'Death sting'], [26, 'dD Extraction outro effects'], [27, 'Menu'], [28, 'Pelagic II'], [29, 'Crash Site'],
  [30, 'Crash Site X'], [31, 'Attack Ship'], [32, 'Attack Ship X'], [33, 'Skedar Ruins'], [34, 'dD Central intro'],
  [35, 'dD Central outro'], [36, 'Institute Defense X'], [37, 'dD Research intro'], [38, 'dD Research outro'],
  [39, 'Carrington Villa X'], [40, 'Chicago X'], [41, 'G5 Building X'], [42, 'A51 Infiltration X'],
  [43, 'Chicago outro'], [44, 'dD Extraction outro'], [45, 'dD Extraction intro'], [46, 'G5 Building intro'],
  [47, 'Chicago intro'], [48, 'Unused Carrington Villa intro'], [49, 'A51 Infiltration intro'], [50, 'A51 Rescue X'],
  [51, 'A51 Escape X'], [52, 'Air Base X'], [53, 'Air Force One X'], [54, 'Pelagic II X'], [55, 'Deep Sea X'],
  [56, 'Skedar Ruins X'], [57, 'Air Base outro (long)'], [58, 'Dark Combat'], [59, 'Skedar Mystery'],
  [60, 'Unused theme'], [61, 'CI Operative'], [62, 'dataDyne Action'], [63, 'Maian Tears'], [64, 'Alien Conflict'],
  [65, 'A51 Escape intro'], [66, 'A51 Rescue outro'], [67, 'Carrington Villa intro 1'],
  [68, 'Carrington Villa intro 2'], [69, 'G5 Building outro'], [70, 'G5 Building cutscene'], [71, 'Menu'],
  [72, 'Combat Simulator menu'], [73, 'Menu'], [74, 'Crash Site intro'], [75, 'Air Base intro'],
  [76, 'Attack Ship intro'], [77, 'Deep Sea cutscene'], [78, 'Air Force One intro'], [79, 'Attack Ship outro'],
  [80, 'A51 Escape cutscene'], [81, 'A51 Rescue intro'], [82, 'Deep Sea intro'], [83, 'A51 Infiltration outro'],
  [84, 'Pelagic II intro'], [85, 'A51 Escape outro'], [86, 'Institute Defense intro'], [87, 'Crash Site outro'],
  [88, 'End Credits'], [89, 'Carrington Institute menu'], [90, 'Deep Sea outro'], [91, 'Air Force One cutscene'],
  [92, 'Pelagic II outro'], [93, 'Air Force One outro'], [94, 'Skedar Ruins intro'], [96, 'Air Base outro'],
  [97, 'Institute Defense outro'], [98, 'Skedar Ruins outro'], [99, 'Carrington Villa outro'],
  [100, 'Skedar Ruins King'], [101, 'Carrington Institute training'], [102, 'Crash Site ambience'], [103, 'Menu'],
  [104, 'Carrington Villa / Pelagic II ambience'], [105, 'Air Base ambience'], [106, 'Chicago / G5 Building ambience'],
  [107, 'Nintendo / Rare logos'], [108, 'File select'], [109, 'A51 Infiltration ambience'], [110, 'Deep Sea ambience'],
  [111, 'Air Force One ambience'], [112, 'Attack Ship ambience'], [113, 'Skedar Ruins / WAR! ambience'],
  [114, 'Unused A51 Escape outro effects'], [115, 'A51 Rescue ambience'], [116, 'A51 Escape / Maian SOS ambience'],
  [117, 'Unused jingle'], [118, 'Unused A51 Escape outro (short)'],
];

const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

export function perfectDarkMusic(rom: Uint8Array): { tracks: MusicTrack[]; decode(index: number): DecodedMusic } {
  let bank: Bank | undefined;
  let volumes: Int16Array | undefined;
  const stream = (at: number) => {
    if (rom[at] !== 0x11 || rom[at + 1] !== 0x73) throw new Error(`No 1173 stream at 0x${at.toString(16)}`);
    const size = (rom[at + 2] << 16) | (rom[at + 3] << 8) | rom[at + 4];
    const d = inflateRaw(rom, at + 5, size);
    if (d.length !== size) throw new Error(`1173 stream at 0x${at.toString(16)}: ${d.length} bytes, expected ${size}`);
    return d;
  };
  return {
    tracks: SONGS.map(([index, name]) => ({ index, name: `${String(index).padStart(3, '0')} ${name}` })),
    decode(index: number): DecodedMusic {
      if (!SONGS.some((s) => s[0] === index)) throw new Error(`No music track ${index}`);
      if (u16(rom, SEQ_TABLE) !== SEQ_COUNT) throw new Error('Perfect Dark music sequence table not found');
      const e = SEQ_TABLE + 4 + index * 8;
      const d = stream(SEQ_TABLE + u32(rom, e));
      if (d.length !== u16(rom, e + 4)) throw new Error(`Music sequence ${index}: ${d.length} bytes, expected ${u16(rom, e + 4)}`);
      const { seq, loop } = parseCompressedSequence(d);
      bank ??= parseBank(rom, MUSIC_CTL, MUSIC_TBL, 0, null);
      if (!volumes) {
        const seg = stream(DATA_SEGMENT), o = SEQ_VOLUME - DATA_BASE;
        if (seg.length !== DATA_SIZE) throw new Error('Perfect Dark data segment not found');
        volumes = Int16Array.from({ length: SEQ_COUNT }, (_, i) => u16(seg, o + 2 * i));
      }
      // lib 0x7000FD9C: n_alCSPSetVol(player, (musicVolume * seqVolume[seq]) >> 15).
      const seqVol = (MUSIC_VOLUME * volumes[index]) >> 15;
      return renderSequence(rom, bank, seq, { rate: RATE, maxVoices: MAX_VOICES, seqVol, loop, squareVolume: false }).music;
    },
  };
}
