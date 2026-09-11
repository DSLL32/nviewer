// Yoshi's Story (J) soundtrack: 61 music sequences for the EAD "Nas" driver (sequence 0 is sound effects).
// Tables in the code image: Audiobank 0xB9E80, sequence -> bank map 0xBA270, Audioseq 0xBA370, sample banks
// 0xBA760; 32 kHz, 3 driver updates per video frame. Names are the source leak's NA_SCENE_* scene names; the
// uses come from world records, event constants in code and RAM at run time (YOSHISTORY.md §7.4).
import { type NasConfig, nasRenderer } from '../music/nas';
import type { DecodedMusic, MusicTrack } from '../types';

const CONFIG: NasConfig = {
  bankTable: 0xb9e80, mapTable: 0xba270, seqTable: 0xba370, waveTable: 0xba760,
  bankSegment: 0xba790, waveSegment: 0xe6870, seqSegment: 0x4f50b0,
  pitchTable: 0x9bcb4, pcentTable: 0x9b4b4, pcent2Table: 0x9b8b4, stereoLeft: 0x9c428,
  defaultVelocityTable: 0x9beb4, defaultGateTable: 0x9bec4, defaultEnvelope: 0x9bed4, scomTable: 0x9e0a0,
  sineTable: 0x9b498,
  ramToRom: (a) => a - 0x80000400 + 0x1000,
  outputRate: 32000,
  updatesPerFrame: 3,
  gain: 0.5, // master level is not modelled; this puts songs at about RMS 0.09 with peaks below 0.95
};

const SONGS: [string, string][] = [
  ['MAIN', 'Treasure Hunt, Surprise!!'],
  ['FANTASY', 'Tower Climb, Lots O\' Jelly Fish, Lots O\' Fish'],
  ['LATIN', 'Rail Lift, Cloud Cruising, Shy Guy Limbo, Shy Guy\'s Ship'],
  ['EXOTIC', 'Bone Dragon Pit, Blargg\'s Boiler'],
  ['CELLO', 'The Tall Tower'],
  ['DOJIN', 'Jungle Puddle, Neuron Jungle'],
  ['REGGAE', 'Jungle Hut'],
  ['HIPHOP', 'Jelly Pipe, Torrential Maze, Piranha Grove'],
  ['DMG', 'Rail Lift and Shy Guy Limbo rooms'],
  ['CASTLE', 'castle courses'],
  ['MAP01', 'intro and title'],
  ['SELECT', 'Yoshi select'],
  ['SCORE', 'score tally'],
  ['MID_BOSS', 'mid-boss battle'],
  ['DOWN', 'unused jingle'],
  ['OPEN_SOGEN', 'page 1 opens'],
  ['SNOW', 'Poochy & Nippy, Frustration'],
  ['OPEN_MAGMA', 'page 2 opens'],
  ['OPEN_CASTLE', 'page 6 opens'],
  ['SUBGAME', 'bonus sub-game'],
  ['OPTION', 'options'],
  ['OPEN_MOUNTAIN', 'page 3 opens'],
  ['OPEN_WATER', 'page 5 opens'],
  ['NAGOMI', 'unused'],
  ['OPEN_JUNGLE', 'page 4 opens'],
  ['DOWN_NORMAL', 'Yoshi down'],
  ['DOWN_OCHIRU', 'fell, burned, eaten'],
  ['DOWN_PAKKUN', 'unused'],
  ['DOWN_YOGAN', 'unused'],
  ['MAP_DEMO', 'storybook demo'],
  ['FANFARE_NORMAL', 'sub-game end'],
  ['FANFARE_BEST', 'sub-game best'],
  ['PAGE_NORMAL', 'page fanfare'],
  ['PAGE_SOGEN', 'first page fanfare'],
  ['SMALL_BOSS', 'boss rooms'],
  ['MINOBON_ROOM', 'Jungle Hut room'],
  ['KUPPA01', 'Baby Bowser battle 1'],
  ['COURSE_CLEAR', 'unused'],
  ['COURSE_CLEAR_BOSS', 'unused'],
  ['OHANASHI', 'story and ending'],
  ['STAFFROLL', 'staff roll'],
  ['RESCUE_YOSHI', 'escape'],
  ['MID_BOSS_DEMO', 'mid-boss intro'],
  ['KUPPA_DEMO01', 'Bowser intro'],
  ['TOWER_ROOM', 'Tower Climb rooms'],
  ['TRIAL', 'trial'],
  ['NAME_ENTRY', 'name entry'],
  ['GURUGURU01', '30 fruits collected'],
  ['GURUGURU02', 'course clear'],
  ['CASTLE_OUTER', 'Ghost and Lift Castle rooms'],
  ['WIN_MID', 'unused'],
  ['KUPPA_DEMO02', 'unused'],
  ['KUPPA02', 'Baby Bowser battle 2'],
  ['WIN_KUPPA01', 'Bowser defeated'],
  ['WIN_KUPPA02', 'Bowser carried away'],
  ['SCORE_BOSS', 'boss score tally'],
  ['DOWN02', 'unused'],
  ['GURUGURU_BOSS01', '30 fruits (boss)'],
  ['GURUGURU_BOSS02', 'boss course clear'],
  ['WIN_MID01', 'mid-boss defeated'],
  ['WIN_MID02', 'mid-boss defeated 2'],
];

export function listYoshiMusic(): MusicTrack[] {
  return SONGS.map(([name, use], index) => ({ index, name: `${String(index + 1).padStart(2, '0')} ${name} · ${use}` }));
}

const renderers = new WeakMap<Uint8Array, ReturnType<typeof nasRenderer>>();

export function decodeYoshiMusic(rom: Uint8Array, index: number): DecodedMusic {
  if (index < 0 || index >= SONGS.length) throw new Error(`No music track ${index}`);
  let render = renderers.get(rom);
  if (!render) renderers.set(rom, (render = nasRenderer(rom, CONFIG)));
  return render(index + 1, { maxSeconds: 600, tailSeconds: 3 });
}
