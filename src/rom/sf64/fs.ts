// Star Fox 64 (US V1.0 and V1.1) file system: the DMA file table, the MIO0 codec, per-version tables in main and
// the scene structs that map asset files to RSP segments (docs/STARFOX.md §2-§4, §7.5).
import { view } from '../util';

// Addresses in main (RAM) that differ per version.
export interface Layout {
  version: '1.0' | '1.1';
  dmaTable: number; // ROM offset
  scenes: number; // Scene structs (0x98 each), from sNoOvl_Logo
  levelObjectInits: number; // placement list per level id (21)
  envTable: number; // environment record per level id (21)
  objectInfo: number; // gObjectInfo[400], 0x24 each
  rcpSetupDLs: number; // gRcpSetupDLs[88], 72 bytes each
  eventActorInfo: number; // sEventActorInfo[108], 0x20 each
  ve1ScriptTable: number; // Venom 1 event scripts, segment 6
}

const LAYOUTS: Layout[] = [
  { version: '1.1', dmaTable: 0xde480, scenes: 0x800ca3b4, levelObjectInits: 0x800cfda0, envTable: 0x800d2f98, objectInfo: 0x800cc124,
    rcpSetupDLs: 0x800d31b0, eventActorInfo: 0x800d003c, ve1ScriptTable: 0x0601b1e4 },
  { version: '1.0', dmaTable: 0xd9a90, scenes: 0x800c59c4, levelObjectInits: 0x800cb3b0, envTable: 0x800ce5a8, objectInfo: 0x800c7734,
    rcpSetupDLs: 0x800ce7c0, eventActorInfo: 0x800cb64c, ve1ScriptTable: 0x0601b1d8 },
];

export const MAIN_VRAM = 0x80000450; // main is DMA file 1, loaded from ROM 0x1050

// MIO0: header {"MIO0", u32 size, u32 back-reference offset, u32 literal offset}, then control bits (u32 words, MSB
// first): 1 copies a literal byte, 0 reads u16 v and copies (v >> 12) + 3 bytes from (v & 0xFFF) + 1 back.
export function mio0(src: Uint8Array, at: number): Uint8Array {
  const dv = view(src);
  if (dv.getUint32(at) !== 0x4d494f30) throw new Error(`No MIO0 stream at 0x${at.toString(16)}`);
  const out = new Uint8Array(dv.getUint32(at + 4));
  let bits = at + 16, br = at + dv.getUint32(at + 8), lit = at + dv.getUint32(at + 12);
  let word = 0, left = 0;
  for (let pos = 0; pos < out.length;) {
    if (left === 0) { word = dv.getUint32(bits); bits += 4; left = 32; }
    const bit = word & 0x80000000;
    word = (word << 1) >>> 0;
    left--;
    if (bit) {
      out[pos++] = src[lit++];
    } else {
      const v = dv.getUint16(br);
      br += 2;
      const dist = (v & 0xfff) + 1;
      for (let n = (v >> 12) + 3; n > 0 && pos < out.length; n--, pos++) out[pos] = out[pos - dist];
    }
  }
  return out;
}

// The DMA table is found by content: entry 0 = {0, 0, 0x1050, 0} (makerom), entry 1 = {0x1050, 0x1050, T, 0} (main,
// which ends where the table starts) and entry 2 starts at T.
function findDmaTable(rom: Uint8Array): number {
  const dv = view(rom);
  for (let o = 0x1000; o < Math.min(0x200000, rom.length - 40); o += 4) {
    if (dv.getUint32(o + 8) === 0x1050 && dv.getUint32(o) === 0 && dv.getUint32(o + 4) === 0 && dv.getUint32(o + 12) === 0 &&
      dv.getUint32(o + 16) === 0x1050 && dv.getUint32(o + 20) === 0x1050 && dv.getUint32(o + 24) === o && dv.getUint32(o + 32) === o) return o;
  }
  return -1;
}

interface DmaEntry { vrom: number; romStart: number; romEnd: number; compressed: boolean }

export class Sf64Files {
  readonly layout: Layout;
  readonly main: Uint8Array;
  private readonly entries: DmaEntry[] = [];
  private readonly cache = new Map<number, Uint8Array>();
  private readonly mainView: DataView;

  constructor(readonly rom: Uint8Array) {
    const table = findDmaTable(rom);
    const layout = LAYOUTS.find((l) => l.dmaTable === table);
    if (!layout) throw new Error('Unsupported Star Fox 64 revision (only the US V1.0 and V1.1 ROMs are supported)');
    this.layout = layout;
    const dv = view(rom);
    for (let i = 0; i < 90; i++) {
      const o = table + 16 * i;
      if (dv.getUint32(o + 8) === 0) break;
      this.entries.push({ vrom: dv.getUint32(o), romStart: dv.getUint32(o + 4), romEnd: dv.getUint32(o + 8), compressed: dv.getUint32(o + 12) !== 0 });
    }
    this.main = this.file(1);
    this.mainView = view(this.main);
  }

  // Decompressed contents of DMA file `index`.
  file(index: number): Uint8Array {
    let d = this.cache.get(index);
    if (!d) {
      const e = this.entries[index];
      d = e.compressed ? mio0(this.rom, e.romStart) : this.rom.subarray(e.romStart, e.romEnd);
      this.cache.set(index, d);
    }
    return d;
  }

  fileByVrom(vrom: number): number {
    return this.entries.findIndex((e) => e.vrom === vrom);
  }

  u32(ram: number) { return this.mainView.getUint32(ram - MAIN_VRAM); }
  u8(ram: number) { return this.main[ram - MAIN_VRAM]; }
  f32(ram: number) { return this.mainView.getFloat32(ram - MAIN_VRAM); }

  // The DMA index of the file in each RSP segment 1..15 (-1 = empty) for scene struct `index`.
  scene(index: number): number[] {
    const a = this.layout.scenes + index * 0x98;
    return Array.from({ length: 16 }, (_, s) => (s === 0 ? -1 : this.u32(a + 0x20 + (s - 1) * 8) ? this.fileByVrom(this.u32(a + 0x20 + (s - 1) * 8)) : -1));
  }
}

// A flat address space for display lists: main, then the scene's segment files, then a scratch area for display
// lists the loader synthesises (addressed by raw buffer offset, below 0x01000000).
export class Space {
  readonly buf: Uint8Array;
  readonly dv: DataView;
  private readonly segBase = new Array<number>(16).fill(-1);
  private readonly segSize = new Array<number>(16).fill(0);
  private readonly scratchBase: number;
  scratch: number;

  constructor(readonly files: Sf64Files, readonly segments: number[], scratchSize = 0x100000) {
    const align = (n: number) => (n + 7) & ~7;
    let size = align(files.main.length);
    for (let s = 1; s < 16; s++) if (segments[s] >= 0) size += align(files.file(segments[s]).length);
    this.buf = new Uint8Array(size + scratchSize);
    this.buf.set(files.main, 0);
    let o = align(files.main.length);
    for (let s = 1; s < 16; s++) {
      if (segments[s] < 0) continue;
      const d = files.file(segments[s]);
      this.buf.set(d, o);
      this.segBase[s] = o;
      this.segSize[s] = d.length;
      o += align(d.length);
    }
    this.scratchBase = this.scratch = o;
    this.dv = view(this.buf);
  }

  resolve = (addr: number): number => {
    addr >>>= 0;
    const seg = addr >>> 24;
    if (seg >= 1 && seg <= 15) {
      const off = addr & 0xffffff;
      return this.segBase[seg] >= 0 && off < this.segSize[seg] ? this.segBase[seg] + off : -1;
    }
    if (addr >= MAIN_VRAM && addr < MAIN_VRAM + this.files.main.length) return addr - MAIN_VRAM;
    return seg === 0 && addr >= this.scratchBase && addr < this.buf.length ? addr : -1;
  };

  has(addr: number) { return this.resolve(addr) >= 0; }
  u32(addr: number) { const o = this.resolve(addr); return o < 0 ? 0 : this.dv.getUint32(o); }

  // Reserves scratch bytes; returns their address.
  alloc(bytes: number): number {
    const at = this.scratch;
    this.scratch += (bytes + 7) & ~7;
    if (this.scratch > this.buf.length) throw new Error('Star Fox 64: display-list scratch area exhausted');
    return at;
  }

  // Writes a display list of [w0, w1] words to the scratch area; returns its address.
  emit(words: [number, number][]): number {
    const at = this.alloc(words.length * 8);
    words.forEach(([w0, w1], i) => { this.dv.setUint32(at + 8 * i, w0 >>> 0); this.dv.setUint32(at + 8 * i + 4, w1 >>> 0); });
    return at;
  }
}
