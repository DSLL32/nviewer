// IndexedDB persistence of opened ROMs, one entry per game (usable from the page and the worker).

const DB_NAME = 'nviewer';
const STORE = 'rom';
// Earlier versions cached a single ROM under this key; it is migrated to a per-game key on restore.
const LEGACY_KEY = 'current';

export const cacheKeyForGame = (gameId: string) => `game:${gameId}`;
export const isLegacyCacheKey = (key: string) => key === LEGACY_KEY;

export interface CachedRom {
  key: string;
  name: string;
  bytes: ArrayBuffer;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore, done: (v: T) => void) => void): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let result: T | undefined;
      fn(tx.objectStore(STORE), (v) => (result = v));
      tx.oncomplete = () => resolve(result as T);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** All cached ROMs (per-game entries and a possible legacy single entry). */
export async function loadCachedRoms(): Promise<CachedRom[]> {
  return withStore<CachedRom[]>('readonly', (store, done) => {
    const out: CachedRom[] = [];
    done(out);
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      const v = cursor.value as { name?: unknown; bytes?: unknown } | undefined;
      if (typeof cursor.key === 'string' && v && typeof v.name === 'string' && v.bytes instanceof ArrayBuffer) {
        out.push({ key: cursor.key, name: v.name, bytes: v.bytes });
      }
      cursor.continue();
    };
  });
}

export async function saveCachedRom(gameId: string, name: string, bytes: ArrayBuffer): Promise<void> {
  await withStore<void>('readwrite', (store) => {
    store.put({ name, bytes }, cacheKeyForGame(gameId));
  });
}

export async function deleteCachedRom(key: string): Promise<void> {
  await withStore<void>('readwrite', (store) => {
    store.delete(key);
  });
}
