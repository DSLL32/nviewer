import { buildLevel } from '../bomberman/common';
import type { Level, LevelInfo } from '../types';
import { AirBoarderRom } from './archive';
import { buildAirBoarderCourse, COURSE_NAMES, environmentForCourse } from './course';
import { COURSE_PRESETS, FREE_PRESET, type PlacementPreset } from './objects';

interface LevelDefinition { course: number; preset: PlacementPreset }

const levels: LevelInfo[] = [];
const definitions: LevelDefinition[] = [];
const baseIndices: number[] = [];

// Keep all six sidebar rows first. Normal courses initially show Free Run.
COURSE_NAMES.forEach((name, course) => {
  baseIndices[course] = levels.length;
  levels.push({ index: levels.length, name, kind: 'stunt', group: 'Courses' });
  definitions.push({ course, preset: FREE_PRESET });
});

// Alternate object presets are selected within the level's View panel and do
// not create duplicate sidebar rows. Two-player sets alias these same bytes.
for (let course = 1; course < COURSE_NAMES.length; course++) for (const preset of COURSE_PRESETS.slice(1)) {
  levels.push({
    index: levels.length,
    name: `${COURSE_NAMES[course]} (${preset.name})`,
    kind: 'stunt', group: 'Courses', setupParent: baseIndices[course],
  });
  definitions.push({ course, preset });
}

export const AIRBOARDER_LEVELS: LevelInfo[] = levels;

const roms = new WeakMap<Uint8Array, AirBoarderRom>();
function open(rom: Uint8Array): AirBoarderRom {
  let parsed = roms.get(rom);
  if (!parsed) { parsed = new AirBoarderRom(rom); roms.set(rom, parsed); }
  return parsed;
}

export function loadAirBoarderLevel(rom: Uint8Array, index: number): Level {
  if (!Number.isInteger(index) || index < 0 || index >= definitions.length) throw new Error(`invalid Air Boarder 64 level ${index}`);
  const def = definitions[index], info = AIRBOARDER_LEVELS[index], parsed = open(rom);
  const built = buildAirBoarderCourse(parsed, def.course, def.preset);
  const collision = new Set(built.layers.filter((layer) => layer.kind === 'collision').flatMap((layer) => layer.instances));
  const level = buildLevel(info, `airboarder64-${parsed.version.code.toLowerCase()}-${def.course}-${def.preset.kind}-${def.preset.setup}`,
    built.textures, built.meshes, built.instances, { layers: built.layers, ...environmentForCourse(def.course, built) }, collision);
  if (def.course > 0) {
    const options = AIRBOARDER_LEVELS.flatMap((candidate, candidateIndex) => {
      const d = definitions[candidateIndex];
      return d.course === def.course ? [{ name: d.preset.name, level: candidate.index }] : [];
    });
    level.setups = { options, current: index };
  }
  return level;
}
