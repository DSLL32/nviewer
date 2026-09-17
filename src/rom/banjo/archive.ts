// Banjo-Kazooie USA V1.0 asset index and core2 initialized data.
import { inflateRaw } from '../inflate';

const TABLE = 0x5e90;
const CORE2_DATA = 0xf9cae0;
const ENTRY_COUNT = 0x15c7;

export class BanjoRom {
  readonly view: DataView;
  readonly assetBase: number;
  readonly core2: Uint8Array;
  private readonly cache = new Map<number, Uint8Array>();

  constructor(readonly rom: Uint8Array) {
    if (rom.length !== 0x1000000) throw new Error(`Banjo-Kazooie USA V1.0 requires a 16 MiB ROM (got ${rom.length})`);
    const code = String.fromCharCode(...rom.subarray(0x3b, 0x3f));
    if (code !== 'NBKE' || rom[0x3f] !== 0) throw new Error(`Unsupported Banjo-Kazooie release ${code} revision ${rom[0x3f]}; only USA V1.0 is supported`);
    this.view = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
    if (this.view.getUint32(TABLE) !== ENTRY_COUNT || this.view.getUint32(TABLE + 4) !== 0xffffffff)
      throw new Error('Banjo-Kazooie USA V1.0 asset index does not match');
    this.assetBase = TABLE + 8 + ENTRY_COUNT * 8;
    if (this.view.getUint16(CORE2_DATA) !== 0x1172 || this.view.getUint32(CORE2_DATA + 2) !== 0x16600)
      throw new Error('Banjo-Kazooie core2 data header does not match');
    this.core2 = inflateRaw(rom, CORE2_DATA + 6, 0x16600);
  }

  asset(id: number): Uint8Array {
    if (id < 0 || id >= ENTRY_COUNT - 1) throw new Error(`Banjo asset ${id} out of range`);
    const cached = this.cache.get(id);
    if (cached) return cached;
    const a = TABLE + 8 + id * 8;
    const start = this.assetBase + this.view.getUint32(a);
    const end = this.assetBase + this.view.getUint32(a + 8);
    if (end < start || end > 0xd846b8) throw new Error(`Banjo asset ${id} has invalid extent`);
    if (end === start) return new Uint8Array();
    const flags = this.view.getUint16(a + 4);
    let result: Uint8Array;
    if (flags & 1) {
      if (this.view.getUint16(start) !== 0x1172) throw new Error(`Banjo asset ${id} has invalid compressed header`);
      const size = this.view.getUint32(start + 2);
      result = inflateRaw(this.rom.subarray(start, end), 6, size);
      if (result.length !== size) throw new Error(`Banjo asset ${id} decoded size mismatch`);
    } else result = this.rom.subarray(start, end);
    this.cache.set(id, result);
    return result;
  }

  assetType(id: number): number {
    if (id < 0 || id >= ENTRY_COUNT - 1) throw new Error(`Banjo asset ${id} out of range`);
    return this.view.getUint16(TABLE + 8 + id * 8 + 6);
  }
}
