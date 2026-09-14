// The Legend of Zelda: Ocarina of Time and Majora's Mask soundtracks (docs/ZELDA64.md §8, §9.4), rendered with
// music/zelda64.ts from Audiobank / Audioseq / Audiotable (dmadata files 3-5) and the `code` file. The game comes from
// the scene table's record size (tables.ts); the four supported ROMs (OoT US 1.0, OoT Master Quest debug, MM US, MM
// debug PAL) share the sequence ids, names and settings below.
//
// Track list (§9.4.3): the music sequences, the long cutscene and credits pieces, then the fanfares, jingles and
// ocarina songs. Left out: the SFX players (OoT 0, 109; MM 0), nature ambience (1; silent without game IO), the Hyrule
// Field parts OoT 3-23 (played by the field logic, sequence 2, which is offered as a fixed-length render), OoT 46
// Ganon's Tower (nearly silent without game IO), MM 29 Clock Town (its game logic plays 21-23, offered directly), MM
// 122 (silent), and the alias ids (OoT 87; MM 35, 40, 86, 96, 97). Names: OoT's are the community names used by the
// OoT Randomizer where one exists, else the decomp enum name made readable; MM's are the enum names made readable (the
// games have no sound test).
//
// Spec (the audio spec, which selects the reverbs): the first scene header that plays the sequence, 10 for the menus
// (OoT title and MM file select), 0 for pieces no scene header plays; MM's title theme uses spec 0 as captured. IO:
// the file select skips its harp intro (port 7 = 1), Clock Town's day is port 4, the field logic's mode port 2 = 0.
import { zelda64Music, type Zelda64Track } from '../music/zelda64';
import type { DecodedMusic, MusicTrack } from '../types';
import { findZeldaBuild, ZeldaFs } from './fs';
import { findTables, type ZeldaGame, type ZeldaTables } from './tables';

type Row = [id: number, spec: number, name: string];

const OOT_MUSIC: Row[] = [
  [2, 2, 'Hyrule Field'], [24, 4, "Dodongo's Cavern"], [25, 1, 'Kakariko Village (adult)'], [26, 0, 'Battle'],
  [27, 0, 'Boss Battle'], [28, 3, 'Inside the Deku Tree'], [29, 0, 'Market'], [30, 10, 'Title Theme'], [31, 5, 'House'],
  [38, 3, 'Jabu-Jabu'], [39, 1, 'Kakariko Village (child)'], [40, 9, 'Fairy Fountain'], [41, 0, "Zelda's Theme"],
  [42, 4, 'Fire Temple'], [44, 6, 'Forest Temple'], [45, 0, 'Castle Courtyard'], [47, 2, 'Lon Lon Ranch'],
  [48, 3, 'Goron City'], [56, 0, 'Miniboss Battle'], [58, 6, 'Temple of Time'], [60, 1, 'Kokiri Forest'],
  [62, 9, 'Lost Woods'], [63, 3, 'Spirit Temple'], [64, 0, 'Horse Race'], [66, 0, "Ingo's Theme"], [74, 0, 'Fairy Flying'],
  [75, 1, 'Deku Tree'], [76, 0, 'Windmill Hut'], [77, 0, 'Hyrule (cutscene)'], [78, 3, 'Shooting Gallery'],
  [79, 6, "Sheik's Theme"], [80, 4, "Zora's Domain"], [82, 6, 'Adult Link'], [85, 5, 'Shop'], [86, 4, 'Chamber of the Sages'],
  [88, 5, 'Ice Cavern'], [91, 3, 'Shadow Temple'], [92, 4, 'Water Temple'], [94, 0, 'Seal of Sages'], [95, 1, 'Gerudo Valley'],
  [96, 5, 'Potion Shop'], [97, 0, 'Kotake and Koume'], [98, 0, 'Castle Escape'], [99, 3, 'Castle Underground'],
  [100, 0, 'Ganondorf Battle'], [101, 0, 'Ganon Battle'], [103, 2, 'Staff Roll 1'], [104, 2, 'Staff Roll 2'],
  [105, 6, 'Staff Roll 3'], [106, 0, 'Staff Roll 4'], [107, 0, 'Fire Boss'], [108, 0, 'Mini-game'],
];
const OOT_FANFARES: Row[] = [
  [32, 0, 'Game Over'], [33, 0, 'Boss Defeated'], [34, 0, 'Item Get'], [35, 0, 'Ganondorf Appears'],
  [36, 0, 'Heart Container Get'], [37, 0, 'Prelude of Light'], [43, 0, 'Treasure Chest'], [49, 0, 'Field Morning'],
  [50, 0, 'Spiritual Stone Get'], [51, 0, 'Bolero of Fire'], [52, 0, 'Minuet of Forest'], [53, 0, 'Serenade of Water'],
  [54, 0, 'Requiem of Spirit'], [55, 0, 'Nocturne of Shadow'], [57, 0, 'Heart Piece Get'], [59, 0, 'Escape from Ranch'],
  [61, 0, 'Learn Song'], [65, 0, 'Epona Race Goal'], [67, 0, 'Medallion Get'], [68, 0, "Saria's Song (ocarina)"],
  [69, 0, "Epona's Song (ocarina)"], [70, 0, "Zelda's Lullaby (ocarina)"], [71, 0, "Sun's Song (ocarina)"],
  [72, 0, 'Song of Time (ocarina)'], [73, 0, 'Song of Storms (ocarina)'], [81, 0, 'Zelda Turns Around'],
  [83, 0, 'Master Sword'], [84, 0, 'Intro Ganon'], [89, 0, 'Door of Time'], [90, 0, 'Kaepora Gaebora'],
  [93, 0, "Ganon's Rainbow Bridge"], [102, 0, 'Ocarina of Time'],
];

const MM_MUSIC: Row[] = [
  [2, 1, 'Termina Field'], [3, 0, 'Chase'], [4, 0, "Majora's Theme"], [5, 5, 'Clock Tower'], [6, 2, 'Stone Tower Temple'],
  [7, 2, 'Inverted Stone Tower Temple'], [10, 0, 'Happy Mask Salesman'], [11, 0, 'Song of Healing'], [12, 1, 'Swamp Region'],
  [13, 2, 'Alien Invasion'], [15, 0, "Sharp's Curse"], [16, 1, 'Great Bay Region'], [17, 1, 'Ikana Region'],
  [18, 1, 'Deku Palace'], [19, 1, 'Mountain Region'], [20, 2, "Pirates' Fortress"], [21, 1, 'Clock Town Day 1'],
  [22, 1, 'Clock Town Day 2'], [23, 1, 'Clock Town Day 3'], [24, 10, 'File Select'], [26, 0, 'Battle'], [27, 0, 'Boss Battle'],
  [28, 3, 'Woodfall Temple'], [30, 0, 'Opening'], [31, 5, 'Inside a House'], [37, 0, 'Timed Mini-game'], [38, 0, 'Goron Race'],
  [39, 0, 'Music Box House'], [41, 0, "Zelda's Lullaby"], [42, 0, 'Rosa Sisters'], [44, 5, 'Marine Research Lab'],
  [45, 6, "Giants' Theme"], [46, 0, 'Song of Storms'], [47, 2, 'Romani Ranch'], [48, 4, 'Goron Village'],
  [49, 0, "Mayor's Office"], [54, 3, 'Zora Hall'], [56, 2, 'Miniboss Battle'], [58, 0, 'Astral Observatory'], [59, 3, 'Cavern'],
  [60, 0, 'Milk Bar'], [62, 0, "Saria's Song"], [64, 2, 'Horse'], [66, 1, 'Ingo'], [67, 5, 'Kotake Potion Shop'], [68, 5, 'Shop'],
  [70, 0, 'Shooting Gallery'], [80, 5, 'Sword Training Hall'], [87, 0, 'Final Hours'], [101, 4, 'Snowhead Temple'],
  [102, 3, 'Great Bay Temple'], [105, 0, "Majora's Wrath"], [106, 0, "Majora's Incarnation"], [107, 0, "Majora's Mask"],
  [111, 3, 'Ikana Castle'], [112, 0, 'Gathering Giants'], [114, 0, "Cremia's Carriage"], [116, 0, 'End Credits'],
  [117, 0, 'Opening Loop'], [118, 0, 'Title Theme'], [123, 0, 'Into the Moon'], [124, 0, 'Goodbye Giant'],
  [125, 0, 'Tatl and Tael'], [126, 0, "Moon's Destruction"], [127, 1, 'End Credits (second half)'],
];
const MM_FANFARES: Row[] = [
  [8, 0, 'Failure 0'], [9, 0, 'Failure 1'], [14, 0, 'Swamp Cruise'], [25, 0, 'Clear Event'], [32, 0, 'Game Over'],
  [33, 0, 'Clear Boss'], [34, 0, 'Get Item'], [36, 0, 'Get Heart'], [43, 0, 'Open Chest'], [50, 0, "Epona's Song (ocarina)"],
  [51, 0, "Sun's Song (ocarina)"], [52, 0, 'Song of Time (ocarina)'], [53, 0, 'Song of Storms (ocarina)'], [55, 0, 'Get New Mask'],
  [57, 0, 'Get Small Item'], [61, 0, 'Zelda Appear'], [63, 0, 'Goron Goal'], [65, 0, 'Horse Goal'], [69, 0, 'Owl'],
  [71, 0, 'Song of Soaring (ocarina)'], [72, 0, 'Song of Healing (ocarina)'], [73, 0, 'Inverted Song of Time'],
  [74, 0, 'Song of Double Time'], [75, 0, 'Sonata of Awakening'], [76, 0, 'Goron Lullaby'], [77, 0, 'New Wave Bossa Nova'],
  [78, 0, 'Elegy of Emptiness'], [79, 0, 'Oath to Order'], [81, 0, 'Lullaby Intro (ocarina)'], [82, 0, 'Learned New Song'],
  [83, 0, 'Bremen March'], [84, 0, 'Ballad of the Wind Fish'], [85, 0, 'Song of Soaring'], [88, 0, 'Mikau Riff'],
  [89, 0, 'Mikau Finale'], [90, 0, 'Frog Song'], [91, 0, 'Sonata of Awakening (ocarina)'], [92, 0, 'Goron Lullaby (ocarina)'],
  [93, 0, 'New Wave Bossa Nova (ocarina)'], [94, 0, 'Elegy of Emptiness (ocarina)'], [95, 0, 'Oath to Order (ocarina)'],
  [98, 0, 'Guitar and Bass Session'], [99, 0, 'Piano Session'], [100, 0, 'Indigo-Go Session'], [103, 0, 'New Wave Saxophone'],
  [104, 0, 'New Wave Vocal'], [108, 0, 'Bass Play'], [109, 0, 'Drums Play'], [110, 0, 'Piano Play'], [113, 0, "Kamaro's Dance"],
  [115, 0, 'Keaton Quiz'], [119, 0, 'Dungeon Appear'], [120, 0, 'Woodfall Clear'], [121, 0, 'Snowhead Clear'],
];

// Player IO the game writes before starting the sequence (§8.3.4).
const OOT_IO: Record<number, Record<number, number>> = { 2: { 2: 0 } };
const MM_IO: Record<number, Record<number, number>> = { 21: { 4: 0 }, 22: { 4: 1 }, 23: { 4: 2 }, 24: { 7: 1 } };
// The field logic picks random parts forever: a fixed-length render (fixed random seed).
const OOT_SECONDS: Record<number, number> = { 2: 240 };

export function zeldaMusicTracks(game: ZeldaGame): Zelda64Track[] {
  const oot = game === 'oot';
  const io = oot ? OOT_IO : MM_IO, seconds = oot ? OOT_SECONDS : {};
  return [...(oot ? OOT_MUSIC : MM_MUSIC), ...(oot ? OOT_FANFARES : MM_FANFARES)].map(([index, spec, name]) => {
    const t: Zelda64Track = { index, name, spec };
    if (io[index]) t.io = io[index];
    if (seconds[index]) t.seconds = seconds[index];
    return t;
  });
}

// `loaded`: the filesystem and tables when the level loader has them already.
export function zeldaMusic(rom: Uint8Array, loaded?: { fs: ZeldaFs; tables: ZeldaTables }): { tracks: MusicTrack[]; decode(index: number): DecodedMusic } {
  let fs = loaded?.fs, tables = loaded?.tables;
  if (!fs || !tables) {
    const build = findZeldaBuild(rom);
    if (!build) throw new Error('Zelda 64: file table not found');
    fs = new ZeldaFs(rom, build);
    tables = findTables(fs);
  }
  const zfs = fs, t = tables;
  const file = (i: number) => {
    const f = zfs.files[i];
    if (!f || !zfs.present(f)) throw new Error(`Zelda 64: audio file ${i} missing`);
    return zfs.data(f);
  };
  return zelda64Music(() => ({ code: t.codeData, audiobank: file(3), audioseq: file(4), audiotable: file(5) }), t.game, zeldaMusicTracks(t.game));
}
