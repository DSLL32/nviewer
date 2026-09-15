// Static assets used by optional Game.prepare hooks. Browser workers fetch the matching deployed public/ path;
// checks read the bytes from the source checkout whose loaders they imported.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Game } from '../src/rom/types';

const defaultRoot = fileURLToPath(new URL('..', import.meta.url));

function publicAsset(root: string, name: string): string {
  if (!name || path.isAbsolute(name) || path.win32.isAbsolute(name) || name.includes('\\')) {
    throw new Error(`Invalid static asset path ${JSON.stringify(name)}`);
  }
  const parts = name.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`Invalid static asset path ${JSON.stringify(name)}`);
  }
  return path.join(root, 'public', ...parts);
}

/** Prepare a game exactly as the browser worker does, but from committed files in a source checkout. */
export async function prepareGame(game: Game, sourceRoot = defaultRoot): Promise<void> {
  await game.prepare?.(async (name) => new Uint8Array(await readFile(publicAsset(sourceRoot, name))));
}
