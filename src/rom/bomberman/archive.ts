// Indexed file archives of Bomberman 64 and The Second Attack, and Bomberman Hero's files
// addressed by ROM offset.
import { view } from '../util';
import { lzss1kDecode, lzss4kDecode, yay0Decode } from './codecs';

// An archive at a ROM offset: u32 dataOffset, u32 capacity, then capacity x {u32 offset,
// u32 size} (offsets relative to archive + dataOffset; unused slots are 0xFFFFFFFF).
export class Archive {
  private readonly dv: DataView;
  readonly dataOffset: number;
  readonly capacity: number;
  private readonly cache = new Map<number, Uint8Array>();

  constructor(readonly rom: Uint8Array, readonly base: number, private readonly decode: (raw: Uint8Array, index: number) => Uint8Array) {
    this.dv = view(rom);
    this.dataOffset = this.dv.getUint32(base);
    this.capacity = this.dv.getUint32(base + 4);
  }

  // The stored bytes of file `index`, or null for an unused or out-of-range slot.
  raw(index: number): Uint8Array | null {
    if (index < 0 || index >= this.capacity) return null;
    const offset = this.dv.getUint32(this.base + 8 + index * 8);
    const size = this.dv.getUint32(this.base + 12 + index * 8);
    if (offset === 0xffffffff) return null;
    const start = this.base + this.dataOffset + offset;
    if (start + size > this.rom.length) return null;
    return this.rom.subarray(start, start + size);
  }

  romOffset(index: number): number {
    return this.base + this.dataOffset + this.dv.getUint32(this.base + 8 + index * 8);
  }

  file(index: number): Uint8Array {
    let f = this.cache.get(index);
    if (!f) {
      const raw = this.raw(index);
      if (!raw) throw new Error(`Archive 0x${this.base.toString(16)}: no file ${index}`);
      f = this.decode(raw, index);
      this.cache.set(index, f);
    }
    return f;
  }
}

// Bomberman 64 asset archive (ROM 0x300000): u32 BE decompressed size + LZSS, except a
// few files stored raw (music and sound-effect blobs and four others).
const BM64_RAW = new Set([32, 33, 71, 72, 220, 221, 267]);
export function bm64Assets(rom: Uint8Array): Archive {
  return new Archive(rom, 0x300000, (raw, index) => {
    if (BM64_RAW.has(index)) return raw;
    return lzss1kDecode(raw, 4, view(raw).getUint32(0));
  });
}

// The Second Attack resource block (ROM 0x2A0000): u32 BE decompressed size, then a Yay0
// image if 'Yay0' follows, else LZSS. Resources 0-2 (music, sound effects, zeros) are raw.
export function bm64saResources(rom: Uint8Array): Archive {
  return new Archive(rom, 0x2a0000, (raw, index) => {
    if (index <= 2) return raw;
    const dv = view(raw);
    if (raw.length >= 8 && dv.getUint32(4) === 0x59617930) return yay0Decode(raw, 4);
    return lzss1kDecode(raw, 4, dv.getUint32(0));
  });
}

// Bomberman Hero: a file at ROM offset `start` is u32 LE n + n bytes of LZSS.
export class HeroFiles {
  private readonly cache = new Map<number, Uint8Array>();
  constructor(readonly rom: Uint8Array) {}
  lzss(start: number): Uint8Array {
    let f = this.cache.get(start);
    if (!f) {
      f = lzss4kDecode(this.rom, start);
      this.cache.set(start, f);
    }
    return f;
  }
}
