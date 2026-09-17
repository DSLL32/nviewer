// Hash every level of every game, so a change to one loader can be shown not to touch the others.
// usage: npx tsx tools/hashall.ts [rom name filter ...] [--src <root>] [--jobs N]
// --src loads the loaders from another checkout (e.g. a worktree of HEAD) instead of this one:
//   npx tsx tools/hashall.ts --src /path/to/worktree > base.txt
//   npx tsx tools/hashall.ts > new.txt && diff base.txt new.txt
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Game } from '../src/rom/types';
import { prepareGame } from './assets';
import { parseJobArguments, runRomJobs } from './jobs';
import { romPaths } from './roms';

const jobArgs = parseJobArguments(process.argv.slice(2));
const args = jobArgs.args;
const srcAt = args.indexOf('--src');
const src = srcAt >= 0 ? args[srcAt + 1] : null;
if (srcAt >= 0 && !src) throw new Error('--src requires a checkout path');
const filters = args.filter((a, i) => !a.startsWith('--') && !(srcAt >= 0 && i === srcAt + 1));

const openRom: (b: Uint8Array) => Game = src
  ? (await import(`${resolve(src)}/src/rom/index.ts`)).openRom
  : (await import('../src/rom')).openRom;

const roms = jobArgs.workerRom ? [jobArgs.workerRom] : romPaths(filters);
if (!jobArgs.workerRom && jobArgs.jobs > 1 && roms.length > 1) {
  const ok = await runRomJobs(roms, jobArgs.jobs, src ? ['--src', src] : []);
  process.exit(ok ? 0 : 1);
}

for (const rom of roms) {
  let game: Game;
  try {
    game = openRom(new Uint8Array(readFileSync(rom)));
  } catch (error) {
    // A baseline checkout predating a newly added game cannot identify its ROM.
    // Skip only that expected case; failures for games it recognizes still fail the audit.
    if (src && error instanceof Error && error.message.startsWith('Unsupported ROM (game code ')) {
      console.warn(`baseline does not support ${rom}; skipped`);
      continue;
    }
    throw error;
  }
  await prepareGame(game, src ?? undefined);
  const h = createHash('sha1');
  for (const info of game.levels) {
    const level = game.loadLevel(info.index);
    for (const t of level.textures) {
      h.update(t.rgba);
      h.update(`${t.width}x${t.height}${t.wrapS}${t.wrapT}${t.format}`);
    }
    for (const m of level.meshes) {
      for (const b of m.batches) {
        h.update(JSON.stringify([b.texture, b.blend, b.depthTest, b.depthWrite, b.cullBack, b.decal]));
        // Keep existing-game hashes stable while making the opt-in semantic flag part of the level hash.
        if (b.forceCullBack === true) h.update('forceCullBack');
        h.update(new Uint8Array(b.positions.buffer));
        h.update(new Uint8Array(b.uvs.buffer));
        h.update(b.colors);
      }
    }
    for (const i of level.instances) {
      h.update(i.name + i.mesh);
      h.update(new Uint8Array(i.matrix.buffer));
    }
    h.update(JSON.stringify([level.fog, level.clearColor, level.camera, level.backdrop]));
    // Panorama metadata is opt-in so existing mesh-sky and no-sky hashes remain byte-for-byte stable. Its referenced
    // texture bytes and dimensions were already included by the texture loop above.
    const panoramas = (level.skies ?? []).filter((sky) => sky.kind === 'panorama');
    if (panoramas.length > 0) h.update(JSON.stringify(panoramas));
    h.update(JSON.stringify((level.layers ?? []).map((l) => [l.name, l.kind, l.group, l.visibleByDefault, l.instances.length])));
  }
  console.log(`${game.id} ${game.levels.length} ${h.digest('hex')}`); // one plain line per game, for diffing
}
