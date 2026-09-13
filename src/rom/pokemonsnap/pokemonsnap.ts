// Pokémon Snap (U): seven course worlds, objects, collision, rails, and music.
import type { Game, LevelInfo } from '../types';
import { COURSES, validatePokemonSnapUs } from './fs';
import { pokemonSnapMusic } from './music';
import { buildCourseLevel } from './objects';

export function openPokemonSnap(rom: Uint8Array): Game {
  validatePokemonSnapUs(rom);
  const levels: LevelInfo[] = COURSES.map((course, index) => ({
    index,
    name: course.name,
    kind: course.kind,
    group: 'Courses',
  }));
  const music = pokemonSnapMusic(rom);
  return {
    id: 'pokemonsnap',
    title: 'Pokémon Snap',
    levels,
    loadLevel(index) {
      if (!Number.isInteger(index) || index < 0 || index >= COURSES.length)
        throw new Error(`invalid Pokémon Snap level ${index}`);
      return buildCourseLevel(rom, COURSES[index], levels[index]);
    },
    music: music.tracks,
    decodeMusic: music.decode,
  };
}
