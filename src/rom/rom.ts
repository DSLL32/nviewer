// Rush 2049 (U) ROM access: header check, main code image, asset file table.
import { inflateRaw } from './inflate';
import { lzssDecode } from './lzss';

// The boot segment (ROM 0x1000) is loaded at 0x80000400. At power-on it inflates
// the main code image from ROM into 0x80086A50.
const BOOT_ROM = 0x1000;
const BOOT_VADDR = 0x80000400;
const MAIN_ROM = 0xb0cb10;
const MAIN_VADDR = 0x80086a50;
const MAIN_SIZE = 0x9dfa0;

// File table: offsets (count + 1 entries, the last is the end) and types live in
// the main image, decompressed sizes in the boot segment.
const FILE_COUNT = 182;
const TABLE_OFFSETS = 0x8011b5bc;
const TABLE_TYPES = 0x80123564;
const TABLE_SIZES = 0x8002e580;

export const enum FileType {
  Raw = 0,
  Lzss = 1,
  Deflate = 2,
}

export interface RomFile {
  index: number;
  offset: number;
  end: number;
  type: FileType;
  size: number;
}

export class RushRom {
  readonly bytes: Uint8Array;
  readonly main: Uint8Array;
  readonly files: RomFile[];
  private cache = new Map<number, Uint8Array>();

  constructor(bytes: Uint8Array) {
    this.bytes = normalizeByteOrder(bytes);
    const id = String.fromCharCode(...this.bytes.subarray(0x3b, 0x3f));
    if (id !== 'NRUE') throw new Error(`Not San Francisco Rush 2049 (U): game code "${id}"`);
    this.main = inflateRaw(this.bytes, MAIN_ROM, MAIN_SIZE);
    if (this.main.length !== MAIN_SIZE) throw new Error('Main code image has unexpected size');

    const dv = new DataView(this.main.buffer, this.main.byteOffset, this.main.byteLength);
    const boot = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.files = [];
    for (let i = 0; i < FILE_COUNT; i++) {
      this.files.push({
        index: i,
        offset: dv.getUint32(TABLE_OFFSETS - MAIN_VADDR + i * 4),
        end: dv.getUint32(TABLE_OFFSETS - MAIN_VADDR + (i + 1) * 4),
        type: dv.getUint32(TABLE_TYPES - MAIN_VADDR + i * 4) as FileType,
        size: boot.getUint32(TABLE_SIZES - BOOT_VADDR + BOOT_ROM + i * 4),
      });
    }
  }

  file(index: number): Uint8Array {
    let data = this.cache.get(index);
    if (data) return data;
    const f = this.files[index];
    switch (f.type) {
      case FileType.Raw: data = this.bytes.subarray(f.offset, f.offset + f.size); break;
      case FileType.Lzss: data = lzssDecode(this.bytes, f.offset, f.size); break;
      case FileType.Deflate: data = inflateRaw(this.bytes, f.offset, f.size); break;
      default: throw new Error(`File ${index}: unknown type ${f.type}`);
    }
    this.cache.set(index, data);
    return data;
  }
}

// Accept .z64 (big-endian), .v64 (byte-swapped) and .n64 (little-endian) dumps.
export function normalizeByteOrder(src: Uint8Array): Uint8Array {
  const magic = (src[0] << 24 | src[1] << 16 | src[2] << 8 | src[3]) >>> 0;
  if (magic === 0x80371240) return src;
  const out = new Uint8Array(src.length);
  if (magic === 0x37804012) {
    for (let i = 0; i + 1 < src.length; i += 2) { out[i] = src[i + 1]; out[i + 1] = src[i]; }
  } else if (magic === 0x40123780) {
    for (let i = 0; i + 3 < src.length; i += 4) {
      out[i] = src[i + 3]; out[i + 1] = src[i + 2]; out[i + 2] = src[i + 1]; out[i + 3] = src[i];
    }
  } else {
    throw new Error('Not an N64 ROM');
  }
  return out;
}
