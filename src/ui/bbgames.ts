import { selectZeldaSourceTree, ZELDA_SOURCE_ALTERNATIVES, ZELDA_SOURCE_PATHS } from '../rom/zelda/sourceManifest';
import type { ZeldaSourceFile } from '../rom/zelda/source';

interface DirectoryHandle {
  name: string;
  getDirectoryHandle(name: string): Promise<DirectoryHandle>;
  getFileHandle(name: string): Promise<{ getFile(): Promise<File> }>;
}

export interface BbgamesSelection {
  name: string;
  sourceTree: 'z_ocarina' | 'z_ocarina2';
  files: ZeldaSourceFile[];
}

async function childDirectory(root: DirectoryHandle, name: string): Promise<DirectoryHandle | null> {
  try { return await root.getDirectoryHandle(name); } catch { return null; }
}

async function fileAt(root: DirectoryHandle, path: string, directories: Map<string, DirectoryHandle>): Promise<File> {
  const parts = path.split('/');
  let dir = root;
  let relative = '';
  for (const part of parts.slice(0, -1)) {
    relative = relative ? `${relative}/${part}` : part;
    const cached = directories.get(relative);
    if (cached) { dir = cached; continue; }
    try {
      dir = await dir.getDirectoryHandle(part);
      directories.set(relative, dir);
    } catch {
      throw new Error(`${path}: folder component "${part}" is missing`);
    }
  }
  try { return await (await dir.getFileHandle(parts.at(-1)!)).getFile(); } catch { throw new Error(`${path}: required source object is missing`); }
}

/** Read only the allowlisted objects from a File System Access API directory handle. */
export async function readBbgamesHandle(root: DirectoryHandle): Promise<BbgamesSelection> {
  const z2 = await childDirectory(root, 'z_ocarina2');
  const z1 = z2 ? null : await childDirectory(root, 'z_ocarina');
  const tree = z2 ?? z1;
  const sourceTree = selectZeldaSourceTree([...(z2 ? ['z_ocarina2'] : []), ...(z1 ? ['z_ocarina'] : [])]);
  if (!tree) throw new Error('unreachable');
  const directories = new Map<string, DirectoryHandle>([['', tree]]);
  const files: ZeldaSourceFile[] = [];
  for (const path of ZELDA_SOURCE_PATHS) {
    let file: File | null = null;
    let lastError: unknown;
    for (const candidate of [path, ...(ZELDA_SOURCE_ALTERNATIVES[path] ?? [])]) {
      try { file = await fileAt(tree, candidate, directories); break; } catch (e) { lastError = e; }
    }
    if (!file) throw lastError;
    files.push({ path, bytes: await file.arrayBuffer() });
  }
  return { name: root.name, sourceTree, files };
}

export async function pickBbgamesDirectory(): Promise<BbgamesSelection | null> {
  const pickerWindow = window as unknown as { showDirectoryPicker?: () => Promise<DirectoryHandle> };
  const picker = pickerWindow.showDirectoryPicker;
  if (!picker) throw new Error('bbgames source-folder mode requires directory-handle support. Open nviewer in Chromium or another browser that supports showDirectoryPicker().');
  try { return await readBbgamesHandle(await picker.call(window)); } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
}
