import type { LevelInfo } from '../types';

export const SUPPORTED_CODES = new Set(['NPWE', 'NPWP', 'NPWJ']);

/** ROM offsets of sTaskMapLookup; the 61-byte task/user table immediately follows it. */
export const TASK_TABLE_OFFSET: Record<string, number> = {
  NPWE: 0x0d7cd8,
  NPWP: 0x0d97f8,
  NPWJ: 0x0d8228,
};

export const VEHICLE_NAMES = [
  'Hang Glider', 'Rocket Belt', 'Gyrocopter', 'Cannonball',
  'Sky Diving', 'Jumble Hopper', 'Birdman',
] as const;

export const ISLAND_NAMES = [
  'Holiday Island', 'Crescent Island', 'Little States', 'Ever-Frost Island',
] as const;

export const TASK_NAMES = [
  "Novice Rings",
  "Sky Maneuvers",
  "Bull's Eye",
  "River Run",
  "Metal Horizon",
  "Hawk Attack",
  "Ice Hornet",
  "Balloon Rush",
  "Meca Hawk Again",
  "Balloon Crash",
  "Metropolis Dance",
  "Touch & Go",
  "Balloon Bonanza",
  "More Rings",
  "Iron Head",
  "Dark Cavern",
  "Diamond Head",
  "Touch & Go 2",
  "Albatross Nest",
  "Shutter Bug",
  "Chicken Dive",
  "Velocity Square",
  "Shutter Bug 2",
  "Seagull Wing",
  "Thermal Flyer",
  "Rising Creek",
  "Shutter Bug 3",
  "Sky Dive 1",
  "Sky Dive 2",
  "Sky Dive 3",
  "Super Cannon",
  "Super Cannon",
  "Super Cannon",
  "Super Cannon",
  "Ultra Cannon",
  "Ultra Cannon",
  "Ultra Cannon",
  "Ultra Cannon",
  "Miracle Cannon",
  "Miracle Cannon",
  "Miracle Cannon",
  "Miracle Cannon",
  "Triple Jump",
  "Moonlight Hop",
  "Go East",
  "Skywalk 1",
  "Skywalk 2",
  "Skywalk 3",
  "Skywalk 4",
  "Skywalk 5",
  "Skywalk 6",
  "Skywalk 7",
  "Skywalk 8",
  "Skywalk 9",
  "Skywalk 10",
  "Skywalk 11",
  "Skywalk 12",
  "Skywalk 13",
  "Skywalk 14",
  "Skywalk 15",
  "Skywalk 16",
] as const;

export function taskLevelInfo(index: number, name: string, vehicle: number, cls: number, test: number): LevelInfo {
  const group = VEHICLE_NAMES[vehicle] ?? `Vehicle ${vehicle}`;
  let suffix = '';
  if (vehicle === 3) suffix = ` — Target ${test + 1}`;
  else if (vehicle === 6) suffix = ` — Variant ${test + 1}`;
  const className = vehicle >= 3 && vehicle <= 5 ? `Level ${cls + 1}` : ['Beginner', 'Class A', 'Class B', 'Pilot Class'][cls] ?? `Class ${cls}`;
  return {
    index,
    name: `${name}${suffix}`,
    kind: vehicle >= 3 && vehicle <= 5 ? 'bonus' : vehicle === 6 ? 'other' : 'stunt',
    group: `${group} — ${className}`,
  };
}
