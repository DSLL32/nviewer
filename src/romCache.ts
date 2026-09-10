// IndexedDB persistence of the last successfully opened ROM (usable from the page and the worker).

const DB_NAME = 'nviewer';
const STORE = 'rom';
const KEY = 'current';

export interface CachedRom {
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

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadCachedRom(): Promise<CachedRom | null> {
  const value = await withStore<unknown>('readonly', (s) => s.get(KEY));
  const v = value as Partial<CachedRom> | undefined;
  return v && typeof v.name === 'string' && v.bytes instanceof ArrayBuffer ? { name: v.name, bytes: v.bytes } : null;
}

export async function saveCachedRom(rom: CachedRom): Promise<void> {
  await withStore('readwrite', (s) => s.put(rom, KEY));
}

export async function clearCachedRom(): Promise<void> {
  await withStore('readwrite', (s) => s.delete(KEY));
}
