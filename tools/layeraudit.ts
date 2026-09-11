// Layer audit (AGENTS.md): every drawn instance must be in a layer, so the user can toggle it,
// and every game except Star Fox 64 must have a collision layer.
// usage: npx tsx tools/layeraudit.ts [rom name filter ...] [--sample]
// Exits 1 if any level has drawable instances outside every layer, or a game has no collision layer.
import { readFileSync } from 'node:fs';
import { openRom } from '../src/rom';
import { romPaths } from './roms';

const GAMES_WITHOUT_COLLISION = new Set(['sf64']); // excluded by the user: a rail shooter, collision tells us little

const args = process.argv.slice(2);
const sample = args.includes('--sample'); // every eighth level, for a quick pass
const roms = romPaths(args.filter((a) => !a.startsWith('--')));
let failed = false;

for (const rom of roms) {
  const game = openRom(new Uint8Array(readFileSync(rom)));
  const step = sample ? Math.max(1, Math.floor(game.levels.length / 8)) : 1;
  let checked = 0, withCollision = 0;
  const loose: string[] = [];
  for (let i = 0; i < game.levels.length; i += step) {
    const level = game.loadLevel(i);
    checked++;
    const layers = level.layers ?? [];
    if (layers.some((l) => l.kind === 'collision')) withCollision++;
    const inLayer = new Set(layers.flatMap((l) => l.instances));
    // Same rule as the viewer's "other geometry" entry: drawable instances (mesh >= 0) in no layer.
    const count = level.instances.filter((inst, k) => inst.mesh >= 0 && !inLayer.has(k)).length;
    if (count) loose.push(`${i} ${game.levels[i].name}: ${count}`);
  }
  const collisionOk = GAMES_WITHOUT_COLLISION.has(game.id) || withCollision > 0;
  console.log(
    `${game.id.padEnd(12)} ${checked} levels | collision in ${withCollision}${collisionOk ? '' : '  <-- NO COLLISION LAYER'} | levels with unlayered instances: ${loose.length}`,
  );
  for (const s of loose.slice(0, 10)) console.log(`    ${s}`);
  if (loose.length > 10) console.log(`    … ${loose.length - 10} more`);
  if (loose.length || !collisionOk) failed = true;
}
process.exit(failed ? 1 : 0);
