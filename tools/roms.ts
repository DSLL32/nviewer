// ROM files the checking scripts run over. The directory holding them is not part of the repo:
// set NVIEWER_ROMS to point at it (default /data/software/ai-scratch).
// Each entry is a file name under that directory; missing files are skipped with a warning.
import { existsSync } from 'node:fs';

export const ROM_DIR = process.env.NVIEWER_ROMS ?? '/data/software/ai-scratch';

export const ROM_FILES = [
  'San Francisco Rush 2049 (U) [!].z64',
  'San Francisco Rush - Extreme Racing (U) (M3) [!].z64',
  'Bomberman 64 (U) [!].z64',
  'Bomberman 64 - The Second Attack! (U) [!].z64',
  'Bomberman Hero (U) [!].z64',
  'BattleTanx (U) [!].z64',
  'BattleTanx - Global Assault (U) [!].z64',
  'Gex 64 - Enter the Gecko (U) [!].z64',
  'Gex 3 - Deep Cover Gecko (U) [!].z64',
  'Yoshi Story (J) [!].z64',
  'Star Fox 64 (U) (V1.1) [!].z64',
  'GoldenEye 007 (U) [!].z64',
  "Bug's Life, A (U) [!].z64",
  'Off Road Challenge (U) [!].z64',
  'Off Road Challenge (E) [!].z64',
  'Pokemon Snap (U) [!].z64',
  'Pilotwings 64 (U) [!].z64',
  'Pilotwings 64 (E) (M3) [!].z64',
  'Pilotwings 64 (J) [!].z64',
  'Mario Kart 64 (U) [!].z64',
  'Airboarder 64 (J) [!].z64',
  'Airboarder 64 (E) [!].z64',
  'Perfect Dark (U) (V1.0) [!].z64',
  'Spider-Man (U) [!].z64',
  'Star Wars - Shadows of the Empire (U) (V1.0) [!].z64',
  'Star Wars - Shadows of the Empire (U) (V1.1) [!].z64',
  'Star Wars - Shadows of the Empire (U) (V1.2) [!].z64',
  'Star Wars - Shadows of the Empire (E) [!].z64',
  '007 - The World is Not Enough (U) [!].z64',
  '007 - The World is Not Enough (E) (M3) [!].z64',
  'Legend of Zelda, The - Ocarina of Time (U) (V1.0) [!].z64',
  "Legend of Zelda, The - Majora's Mask (U) [!].z64",
  '_folders/F-ZERO X [CFZE].z64', // the development ROM holding the 1997 Ocarina of Time prototype
];

/** Paths of the ROMs to check: all of them, or those whose file name contains one of the filters. */
export function romPaths(filters: string[] = []): string[] {
  const wanted = ROM_FILES.filter((f) => !filters.length || filters.some((q) => f.toLowerCase().includes(q.toLowerCase())));
  const out: string[] = [];
  for (const f of wanted) {
    const path = `${ROM_DIR}/${f}`;
    if (existsSync(path)) out.push(path);
    else console.warn(`missing, skipped: ${path}`);
  }
  if (!out.length) throw new Error(`no ROMs found in ${ROM_DIR}${filters.length ? ` matching ${filters.join(', ')}` : ''}`);
  return out;
}
