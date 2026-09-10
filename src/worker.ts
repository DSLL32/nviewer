// Parser worker: validates/opens the ROM, keeps it in memory and IndexedDB, and parses levels on request.
import type { WorkerRequest, WorkerResponse } from './protocol';
import { loadLevel, type Level } from './rom/level';
import { RushRom } from './rom/rom';
import { clearCachedRom, loadCachedRom, saveCachedRom } from './romCache';

let rom: RushRom | null = null;

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, { transfer });

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function openRom(bytes: ArrayBuffer): { rom: RushRom; ms: number } {
  const t0 = performance.now();
  const opened = new RushRom(new Uint8Array(bytes));
  return { rom: opened, ms: performance.now() - t0 };
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  switch (req.type) {
    case 'open': {
      let opened;
      try {
        opened = openRom(req.bytes);
      } catch (err) {
        post({ type: 'rom', id: req.id, ok: false, error: errorText(err) });
        return;
      }
      rom = opened.rom;
      let persisted = true;
      try {
        await saveCachedRom({ name: req.name, bytes: req.bytes });
      } catch (err) {
        console.warn('Could not cache ROM in IndexedDB:', err);
        persisted = false;
      }
      post({ type: 'rom', id: req.id, ok: true, rom: { name: req.name, size: req.bytes.byteLength, persisted, ms: opened.ms } });
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
        const opened = openRom(cached.bytes);
        rom = opened.rom;
        post({ type: 'rom', id: req.id, ok: true, rom: { name: cached.name, size: cached.bytes.byteLength, persisted: true, ms: opened.ms } });
      } catch (err) {
        // A cached file that no longer opens is useless; drop it.
        await clearCachedRom().catch(() => {});
        post({ type: 'rom', id: req.id, ok: false, error: `Cached ROM could not be opened: ${errorText(err)}` });
      }
      return;
    }
    case 'close':
      rom = null;
      post({ type: 'closed', id: req.id });
      return;
    case 'level': {
      if (!rom) {
        post({ type: 'level', id: req.id, ok: false, error: 'No ROM loaded' });
        return;
      }
      try {
        const t0 = performance.now();
        const level = loadLevel(rom, req.index);
        const ms = performance.now() - t0;
        post({ type: 'level', id: req.id, ok: true, level, ms }, collectTransferables(level, rom));
      } catch (err) {
        post({ type: 'level', id: req.id, ok: false, error: errorText(err) });
      }
      return;
    }
  }
};

/**
 * Find typed arrays in the level that exclusively own their buffer, so they can be moved instead of copied.
 * Views into shared buffers (e.g. ROM bytes or cached files) are left to structured cloning.
 */
function collectTransferables(level: Level, owner: RushRom): Transferable[] {
  const protectedBuffers = new Set<ArrayBufferLike>([owner.bytes.buffer, owner.main.buffer]);
  const out = new Set<ArrayBuffer>();
  const seen = new Set<object>();
  const visit = (v: unknown, depth: number) => {
    if (v === null || typeof v !== 'object' || depth > 8 || seen.has(v)) return;
    seen.add(v);
    if (ArrayBuffer.isView(v)) {
      const buf = v.buffer;
      if (buf instanceof ArrayBuffer && !protectedBuffers.has(buf) && v.byteOffset === 0 && v.byteLength === buf.byteLength) {
        out.add(buf);
      }
      return;
    }
    for (const child of Array.isArray(v) ? v : Object.values(v)) visit(child, depth + 1);
  };
  visit(level, 0);
  return [...out];
}
