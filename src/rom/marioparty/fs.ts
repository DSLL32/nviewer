import { lzss1kDecode } from '../bomberman/codecs';

// Mario Party (Japan, revision 0). Mainfs offsets are relative to their parent.
export const MP_MAINFS_START = 0x31ba80;
export const MP_MAINFS_END = 0xfb4796;
export const MP_OVERLAY_TABLE = 0xc1fd4;
export const MP_OVERLAY_COUNT = 132;

export interface MarioPartyFileInfo {
  offset: number;
  end: number;
  decodedSize: number;
  compressionType: number;
}

export interface MarioPartyOverlayInfo {
  romStart: number;
  romEnd: number;
  ramStart: number;
  codeStart: number;
  codeEnd: number;
  rodataStart: number;
  rodataEnd: number;
  bssStart: number;
  bssEnd: number;
}

/** Rejects other regions/revisions and structurally inconsistent Japanese images. */
export function validateMarioPartyRom(rom: Uint8Array): void {
  if (rom.length !== 0x2000000) throw new Error('Mario Party (J) ROM must be 32 MiB');
  const view = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
  if (view.getUint32(0x10) !== 0xada815be || view.getUint32(0x14) !== 0x6028622f ||
      view.getUint32(0x3b) !== 0x434c424a || rom[0x3f] !== 0) {
    throw new Error('Expected Mario Party (J), revision 0');
  }
  if (view.getUint32(MP_MAINFS_START) !== 73 ||
      view.getUint32(MP_OVERLAY_TABLE + MP_OVERLAY_COUNT * 36) !== 0x44200000) {
    throw new Error('Mario Party archive tables are missing');
  }
}

export class MarioPartyFs {
  private readonly view: DataView;
  private readonly directories: MarioPartyFileInfo[][];
  private readonly overlays: MarioPartyOverlayInfo[];

  constructor(private readonly rom: Uint8Array) {
    validateMarioPartyRom(rom);
    this.view = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
    this.directories = this.readDirectories();
    this.overlays = this.readOverlays();
  }

  get directoryCount(): number { return this.directories.length; }
  get overlayCount(): number { return this.overlays.length; }

  getFileCount(dir: number): number { return this.directory(dir).length; }

  getFileInfo(dir: number, file: number): MarioPartyFileInfo {
    const info = this.directory(dir)[file];
    if (!info) throw new RangeError(`Mario Party mainfs file ${dir}/${file} is absent`);
    return info;
  }

  getFile(dir: number, file: number): Uint8Array {
    const info = this.getFileInfo(dir, file);
    const payload = this.rom.subarray(info.offset + 8, info.end);
    if (info.compressionType === 0) return payload.subarray(0, info.decodedSize);
    return lzss1kDecode(payload, 0, info.decodedSize);
  }

  getOverlayInfo(index: number): MarioPartyOverlayInfo {
    const info = this.overlays[index];
    if (!info) throw new RangeError(`Mario Party overlay ${index} is absent`);
    return info;
  }

  getOverlay(index: number): Uint8Array {
    const { romStart, romEnd } = this.getOverlayInfo(index);
    return this.rom.subarray(romStart, romEnd);
  }

  private directory(dir: number): MarioPartyFileInfo[] {
    const files = this.directories[dir];
    if (!files) throw new RangeError(`Mario Party mainfs directory ${dir} is absent`);
    return files;
  }

  private readDirectories(): MarioPartyFileInfo[][] {
    const base = MP_MAINFS_START;
    const count = this.view.getUint32(base);
    const directories: MarioPartyFileInfo[][] = [];
    let total = 0;
    for (let dir = 0; dir < count; dir++) {
      const start = base + this.view.getUint32(base + 4 + dir * 4);
      const end = dir + 1 < count
        ? base + this.view.getUint32(base + 8 + dir * 4) : MP_MAINFS_END;
      if (start < base + 4 + count * 4 || end > MP_MAINFS_END || start >= end) {
        throw new Error(`Mario Party mainfs directory ${dir} has invalid bounds`);
      }
      const fileCount = this.view.getUint32(start);
      if (start + 4 + fileCount * 4 > end) {
        throw new Error(`Mario Party mainfs directory ${dir} has invalid index`);
      }
      const files: MarioPartyFileInfo[] = [];
      for (let file = 0; file < fileCount; file++) {
        const offset = start + this.view.getUint32(start + 4 + file * 4);
        const next = file + 1 < fileCount
          ? start + this.view.getUint32(start + 8 + file * 4) : end;
        if (offset < start + 4 + fileCount * 4 || offset + 8 > next || next > end) {
          throw new Error(`Mario Party mainfs file ${dir}/${file} has invalid bounds`);
        }
        const decodedSize = this.view.getUint32(offset);
        const compressionType = this.view.getUint32(offset + 4);
        if (compressionType > 1 || (compressionType === 0 && offset + 8 + decodedSize > next)) {
          throw new Error(`Mario Party mainfs file ${dir}/${file} has invalid encoding`);
        }
        files.push({ offset, end: next, decodedSize, compressionType });
      }
      total += fileCount;
      directories.push(files);
    }
    if (total !== 3297) throw new Error(`Mario Party mainfs has ${total} files, expected 3297`);
    return directories;
  }

  private readOverlays(): MarioPartyOverlayInfo[] {
    const result: MarioPartyOverlayInfo[] = [];
    for (let i = 0; i < MP_OVERLAY_COUNT; i++) {
      const p = MP_OVERLAY_TABLE + i * 36;
      const words = Array.from({ length: 9 }, (_, j) => this.view.getUint32(p + j * 4));
      const [romStart, romEnd, ramStart, codeStart, codeEnd,
        rodataStart, rodataEnd, bssStart, bssEnd] = words;
      if (romStart < 0xccf00 || romEnd > MP_MAINFS_START || romStart > romEnd ||
          ramStart !== 0x800f5a30) {
        throw new Error(`Mario Party overlay ${i} has invalid bounds`);
      }
      result.push({ romStart, romEnd, ramStart, codeStart, codeEnd,
        rodataStart, rodataEnd, bssStart, bssEnd });
    }
    return result;
  }
}
