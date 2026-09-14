// Mario Kart 64 (U) revision 0: twenty courses, the award ceremony, paths, collision, objects, and music.
import type { Game, LevelInfo } from '../types';
import { mk64Music } from '../music/mk64';
import { COURSES, detectLayout, romHeader } from './fs';
import { loadCourseLevel } from './level';

export function openMarioKart64(rom: Uint8Array): Game {
  const header = romHeader(rom);
  if (header.gameCode !== 'NKTE')
    throw new Error(`Mario Kart 64 (${header.gameCode}) is not supported: only the USA release is currently supported`);
  if (header.versionByte !== 0)
    throw new Error(`Mario Kart 64 (U) revision ${header.versionByte} is not supported: expected revision 0`);
  if (rom.length !== 0xc00000)
    throw new Error(`Mario Kart 64 ROM has size 0x${rom.length.toString(16)}; expected 0xc00000`);
  if (header.title !== 'MARIOKART64')
    throw new Error(`Mario Kart 64 ROM has unexpected internal title ${JSON.stringify(header.title)}`);

  const layout = detectLayout(rom);
  if (layout.version !== 'us') throw new Error(`unsupported Mario Kart 64 layout ${layout.version}`);
  // Public order keeps each cup contiguous for the sidebar; values are internal gCurrentCourseId IDs.
  const courseIds = [8, 9, 6, 11, 10, 5, 1, 0, 14, 12, 7, 2, 18, 4, 3, 13, 19, 15, 17, 16, 20];
  const levels: LevelInfo[] = courseIds.map((courseId, index) => {
    const course = COURSES[courseId];
    return {
    index,
    name: course.name,
    kind: course.kind,
    group: course.kind === 'race' ? course.cup : course.kind === 'battle' ? 'Battle' : 'Other',
    };
  });
  const music = mk64Music(rom);
  return {
    id: 'mk64',
    title: 'Mario Kart 64',
    levels,
    loadLevel(index) {
      if (!Number.isInteger(index) || index < 0 || index >= levels.length)
        throw new Error(`invalid Mario Kart 64 level ${index}`);
      const loaded = loadCourseLevel(rom, layout, courseIds[index]);
      loaded.level.info = levels[index];
      return loaded.level;
    },
    music: music.tracks,
    decodeMusic: music.decode,
  };
}
