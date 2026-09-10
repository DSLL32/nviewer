// Parser worker: detects/opens the ROM, keeps it in memory and IndexedDB, and parses levels on request.
import type { RomSummary, WorkerRequest, WorkerResponse } from './protocol';
import { openRom, type Game, type Level } from './rom';
import { clearCachedRom, loadCachedRom, saveCachedRom } from './romCache';

interface OpenGame {
  game: Game;
  bytes: ArrayBuffer; // the file as received; the game may keep views into it
}

let current: OpenGame | null = null;

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, { transfer });

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function open(bytes: ArrayBuffer): { opened: OpenGame; ms: number } {
  const t0 = performance.now();
  const game = openRom(new Uint8Array(bytes));
  return { opened: { game, bytes }, ms: performance.now() - t0 };
}

function summary(g: Game, name: string, size: number, persisted: boolean, ms: number): RomSummary {
  return { gameId: g.id, title: g.title, levels: g.levels.map((l) => ({ ...l })), name, size, persisted, ms };
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  switch (req.type) {
    case 'open': {
      let result;
      try {
        result = open(req.bytes);
      } catch (err) {
        // Keep whatever game was open before.
        post({ type: 'rom', id: req.id, ok: false, error: errorText(err) });
        return;
      }
      current = result.opened;
      let persisted = true;
      try {
        await saveCachedRom({ name: req.name, bytes: req.bytes });
      } catch (err) {
        console.warn('Could not cache ROM in IndexedDB:', err);
        persisted = false;
      }
      post({ type: 'rom', id: req.id, ok: true, rom: summary(result.opened.game, req.name, req.bytes.byteLength, persisted, result.ms) });
      return;
    }
    case 'restore': {
      let cached;
      try {
        cached = await loadCachedRom();
      } catch (err) {
        console.warn('Could not read ROM cache:', err);
        cached = null;
      }
      if (!cached) {
        post({ type: 'rom', id: req.id, ok: false, error: null });
        return;
      }
      try {
        const result = open(cached.bytes);
        current = result.opened;
        post({ type: 'rom', id: req.id, ok: true, rom: summary(result.opened.game, cached.name, cached.bytes.byteLength, true, result.ms) });
      } catch (err) {
        // A cached file that no longer opens is useless; drop it.
        await clearCachedRom().catch(() => {});
        post({ type: 'rom', id: req.id, ok: false, error: `Cached ROM could not be opened: ${errorText(err)}` });
      }
      return;
    }
    case 'close':
      current = null;
      post({ type: 'closed', id: req.id });
      return;
    case 'level': {
      if (!current) {
        post({ type: 'level', id: req.id, ok: false, error: 'No ROM loaded' });
        return;
      }
      const { game, bytes } = current;
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
  }
};

/**
 * Find typed arrays in the level that exclusively own their buffer, so they can be moved instead of copied.
 * Views into larger buffers (ROM bytes, decompressed files the game caches) are left to structured cloning,
 * and the received file buffer is never transferred. Games build level arrays freshly per load (checked for
 * both supported games), so whole-buffer views are not shared with parser state.
 */
function collectTransferables(level: Level, romBytes: ArrayBuffer): Transferable[] {
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
