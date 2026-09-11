// Load every level twice, moving each Level through structuredClone with all of its whole-buffer typed
// arrays transferred. The web worker does exactly this, so a loader that shares a buffer between levels
// (a texture cache, a shared identity matrix) breaks on the second load with a detached ArrayBuffer.
// usage: npx tsx tools/transfer.ts [rom name filter ...]
import { readFileSync } from 'node:fs';
import { openRom } from '../src/rom';
import { romPaths } from './roms';

/** Every distinct ArrayBuffer fully owned by a typed array in the level (the worker transfers these). */
function buffers(value: unknown, romBuffer: ArrayBufferLike, out = new Set<ArrayBuffer>(), seen = new Set<object>()): ArrayBuffer[] {
  if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    if (ArrayBuffer.isView(value)) {
      const b = value.buffer;
      if (b instanceof ArrayBuffer && b !== romBuffer && value.byteOffset === 0 && value.byteLength === b.byteLength) out.add(b);
    } else {
      for (const child of Array.isArray(value) ? value : Object.values(value)) buffers(child, romBuffer, out, seen);
    }
  }
  return [...out];
}

let failed = false;
for (const rom of romPaths(process.argv.slice(2))) {
  const bytes = new Uint8Array(readFileSync(rom));
  const game = openRom(bytes);
  let loads = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (const info of game.levels) {
      try {
        const level = game.loadLevel(info.index);
        const copy = structuredClone(level, { transfer: buffers(level, bytes.buffer) });
        if (copy.meshes.length !== level.meshes.length) throw new Error('clone lost meshes');
        loads++;
      } catch (e) {
        failed = true;
        console.log(`${game.id} pass ${pass + 1} level ${info.index} ${info.name}: ${(e as Error).message}`);
      }
    }
  }
  console.log(`${game.id.padEnd(12)} ${loads} of ${game.levels.length * 2} loads OK`);
}
process.exit(failed ? 1 : 0);
