// Parser worker: opens ROMs (several games at once, keyed by game id), keeps them in memory and IndexedDB,
// and parses levels on request.
import type { RomSummary, WorkerRequest, WorkerResponse } from './protocol';
import { openRom, type DecodedMusic, type Game, type Level } from './rom';
import { cacheKeyForGame, deleteCachedRom, isLegacyCacheKey, loadCachedRoms, saveCachedRom } from './romCache';

interface OpenGame {
  game: Game;
  bytes: ArrayBuffer; // the file as received; the game may keep views into it
  name: string;
}

const games = new Map<string, OpenGame>();

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, { transfer });

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function open(bytes: ArrayBuffer): { game: Game; ms: number } {
  const t0 = performance.now();
  const game = openRom(new Uint8Array(bytes));
  return { game, ms: performance.now() - t0 };
}

function summary(g: OpenGame, persisted: boolean, ms: number): RomSummary {
  const { game } = g;
  return {
    gameId: game.id,
    title: game.title,
    levels: game.levels.map((l) => ({ ...l })),
    music: game.decodeMusic && game.music ? game.music.map((t) => ({ ...t })) : undefined,
    name: g.name,
    size: g.bytes.byteLength,
    persisted,
    ms,
  };
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  switch (req.type) {
    case 'open': {
      let result;
      try {
        result = open(req.bytes);
      } catch (err) {
        // Games opened before stay available.
        post({ type: 'rom', id: req.id, ok: false, error: errorText(err) });
        return;
      }
      // A ROM of a game that is already open replaces it.
      const entry: OpenGame = { game: result.game, bytes: req.bytes, name: req.name };
      games.set(result.game.id, entry);
      let persisted = true;
      try {
        await saveCachedRom(result.game.id, req.name, req.bytes);
      } catch (err) {
        console.warn('Could not cache ROM in IndexedDB:', err);
        persisted = false;
      }
      post({ type: 'rom', id: req.id, ok: true, rom: summary(entry, persisted, result.ms) });
      return;
    }
    case 'restore': {
      let cached: Awaited<ReturnType<typeof loadCachedRoms>> = [];
      try {
        cached = await loadCachedRoms();
      } catch (err) {
        console.warn('Could not read ROM cache:', err);
      }
      // Per-game entries first, so a legacy single-ROM entry never overrides them.
      cached.sort((a, b) => Number(isLegacyCacheKey(a.key)) - Number(isLegacyCacheKey(b.key)));
      const roms: RomSummary[] = [];
      const errors: string[] = [];
      for (const c of cached) {
        let result;
        try {
          result = open(c.bytes);
        } catch (err) {
          // A cached file that no longer opens is useless; drop it.
          await deleteCachedRom(c.key).catch(() => {});
          errors.push(`Cached ROM "${c.name}" could not be opened: ${errorText(err)}`);
          continue;
        }
        const id = result.game.id;
        if (isLegacyCacheKey(c.key) || c.key !== cacheKeyForGame(id)) {
          // Migrate to the per-game key unless that game was already restored from its own entry.
          if (!games.has(id)) await saveCachedRom(id, c.name, c.bytes).catch(() => {});
          await deleteCachedRom(c.key).catch(() => {});
        }
        if (games.has(id)) continue;
        const entry: OpenGame = { game: result.game, bytes: c.bytes, name: c.name };
        games.set(id, entry);
        roms.push(summary(entry, true, result.ms));
      }
      post({ type: 'restored', id: req.id, roms, errors });
      return;
    }
    case 'remove':
      games.delete(req.gameId);
      await deleteCachedRom(cacheKeyForGame(req.gameId)).catch(() => {});
      post({ type: 'removed', id: req.id });
      return;
    case 'level': {
      const entry = games.get(req.gameId);
      if (!entry) {
        post({ type: 'level', id: req.id, ok: false, error: 'This ROM is not loaded' });
        return;
      }
      const { game, bytes } = entry;
      if (!game.levels.some((l) => l.index === req.index)) {
        post({ type: 'level', id: req.id, ok: false, error: `${game.title} has no level ${req.index}` });
        return;
      }
      try {
        const t0 = performance.now();
        const level = game.loadLevel(req.index);
        const ms = performance.now() - t0;
        post({ type: 'level', id: req.id, ok: true, level, ms }, collectTransferables(level, bytes));
      } catch (err) {
        post({ type: 'level', id: req.id, ok: false, error: errorText(err) });
      }
      return;
    }
    case 'music': {
      const entry = games.get(req.gameId);
      const game = entry?.game;
      if (!entry || !game) {
        post({ type: 'music', id: req.id, ok: false, error: 'This ROM is not loaded' });
        return;
      }
      if (!game.decodeMusic || !game.music?.some((t) => t.index === req.index)) {
        post({ type: 'music', id: req.id, ok: false, error: `${game.title} has no track ${req.index}` });
        return;
      }
      try {
        const t0 = performance.now();
        const decoded = game.decodeMusic(req.index);
        const ms = performance.now() - t0;
        // Give each channel its own exact-size buffer (decoders may return views into larger render buffers),
        // then transfer those buffers instead of structured-cloning tens of megabytes.
        const channels = decoded.channels.map((c) =>
          c.byteOffset === 0 && c.byteLength === c.buffer.byteLength && c.buffer !== entry.bytes ? c : c.slice(),
        );
        const music: DecodedMusic = { ...decoded, channels };
        post({ type: 'music', id: req.id, ok: true, music, ms }, collectTransferables(music, entry.bytes));
      } catch (err) {
        post({ type: 'music', id: req.id, ok: false, error: errorText(err) });
      }
      return;
    }
  }
};

/**
 * Find typed arrays in the level that exclusively own their buffer, so they can be moved instead of copied.
 * Views into larger buffers (ROM bytes, decompressed files the game caches) are left to structured cloning,
 * and the received file buffer is never transferred. Games build level arrays freshly per load (checked for
 * both supported games), so whole-buffer views are not shared with parser state.
 */
function collectTransferables(level: Level | DecodedMusic, romBytes: ArrayBuffer): Transferable[] {
  const out = new Set<ArrayBuffer>();
  const seen = new Set<object>();
  const visit = (v: unknown, depth: number) => {
    if (v === null || typeof v !== 'object' || depth > 8 || seen.has(v)) return;
    seen.add(v);
    if (ArrayBuffer.isView(v)) {
      const buf = v.buffer;
      if (buf instanceof ArrayBuffer && buf !== romBytes && v.byteOffset === 0 && v.byteLength === buf.byteLength) {
        out.add(buf);
      }
      return;
    }
    for (const child of Array.isArray(v) ? v : Object.values(v)) visit(child, depth + 1);
  };
  visit(level, 0);
  return [...out];
}
