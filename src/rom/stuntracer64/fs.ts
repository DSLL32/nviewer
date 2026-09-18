// Stunt Racer 64 (USA rev 0) map archive: indexed, independently inflated zlib blocks.
import { inflateRaw } from '../inflate';

export type StuntSet = 'collision' | 'mesh' | 'auxiliary' | 'path0' | 'path1' | 'path2' | 'path3' | 'otherPath';

const SET_FIELDS: Record<StuntSet, [number, number]> = {
  collision: [0x04c, 0x058], mesh: [0x060, 0x06c], auxiliary: [0x078, 0x08c],
  path0: [0x094, 0x0a4], path1: [0x0ac, 0x0bc], path2: [0x0c4, 0x0d4],
  path3: [0x0dc, 0x0ec], otherPath: [0x0f4, 0x100],
};

export function u32(data: Uint8Array, at: number): number {
  if (at < 0 || at + 4 > data.length) throw new Error(`Stunt Racer word at 0x${at.toString(16)} outside file`);
  return new DataView(data.buffer, data.byteOffset + at, 4).getUint32(0);
}

export function s16(data: Uint8Array, at: number): number {
  if (at < 0 || at + 2 > data.length) throw new Error(`Stunt Racer halfword at 0x${at.toString(16)} outside file`);
  return new DataView(data.buffer, data.byteOffset + at, 2).getInt16(0);
}

export function f32(data: Uint8Array, at: number): number {
  if (at < 0 || at + 4 > data.length) throw new Error(`Stunt Racer float at 0x${at.toString(16)} outside file`);
  return new DataView(data.buffer, data.byteOffset + at, 4).getFloat32(0);
}

function adler32(data: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) {
    a += data[i]; b += a;
    if ((i & 0xfff) === 0xfff) { a %= 65521; b %= 65521; }
  }
  return (((b % 65521) << 16) | (a % 65521)) >>> 0;
}

function inflateContainer(rom: Uint8Array, start: number, end: number): Uint8Array {
  if (start < 0 || end > rom.length || end - start < 14) throw new Error('Stunt Racer container outside ROM');
  const stored = u32(rom, start), decoded = u32(rom, start + 4);
  if (stored !== end - start || decoded > 0x2000000) throw new Error(`Stunt Racer bad container at 0x${start.toString(16)}`);
  const out = new Uint8Array(decoded);
  let ip = start + 8, op = 0;
  while (ip < end) {
    const n = u32(rom, ip); ip += 4;
    if (n < 6 || ip + n > end || (rom[ip] & 15) !== 8 || ((rom[ip] << 8 | rom[ip + 1]) % 31) !== 0)
      throw new Error(`Stunt Racer bad zlib block at 0x${ip.toString(16)}`);
    const block = rom.subarray(ip, ip + n);
    const bytes = inflateRaw(block, 2, Math.min(16000, decoded - op));
    if (bytes.length > 16000 || op + bytes.length > decoded || adler32(bytes) !== u32(block, n - 4))
      throw new Error(`Stunt Racer zlib checksum or size mismatch at 0x${ip.toString(16)}`);
    out.set(bytes, op); op += bytes.length;
    ip += n + (n & 1);
    if (op < decoded && bytes.length !== 16000) throw new Error('Stunt Racer short non-final zlib block');
  }
  if (ip !== end || op !== decoded) throw new Error(`Stunt Racer container length mismatch at 0x${start.toString(16)}`);
  return out;
}

export interface StuntEntry { start: number; end: number; metadataOffset: number }

export class StuntMap {
  readonly primary: Uint8Array;
  readonly secondaryBase: number;
  private readonly files = new Map<string, Uint8Array>();

  constructor(readonly rom: Uint8Array, readonly internalId: number, readonly bundleStart: number, readonly bundleEnd: number) {
    const primarySize = u32(rom, bundleStart);
    this.primary = inflateContainer(rom, bundleStart, bundleStart + primarySize);
    if (u32(this.primary, 0) !== this.primary.length) throw new Error('Stunt Racer primary map size mismatch');
    this.secondaryBase = bundleStart + ((primarySize + 1) & ~1);
    if (this.secondaryBase > bundleEnd) throw new Error('Stunt Racer map has invalid secondary base');
  }

  count(set: StuntSet): number { return u32(this.primary, SET_FIELDS[set][0]); }

  entry(set: StuntSet, index: number): StuntEntry {
    if (!Number.isInteger(index) || index < 0 || index >= this.count(set)) throw new Error(`Stunt Racer ${set} index ${index} out of range`);
    const at = u32(this.primary, SET_FIELDS[set][1]) + 12 * index;
    const start = this.secondaryBase + u32(this.primary, at);
    const end = this.secondaryBase + u32(this.primary, at + 4);
    const metadataOffset = u32(this.primary, at + 8);
    if (start < this.secondaryBase || end > this.bundleEnd || end <= start || u32(this.rom, start) !== end - start)
      throw new Error(`Stunt Racer ${set} file ${index} has invalid extent`);
    return { start, end, metadataOffset };
  }

  load(set: StuntSet, index: number): Uint8Array {
    const key = `${set}/${index}`;
    const cached = this.files.get(key);
    if (cached) return cached;
    const { start, end, metadataOffset } = this.entry(set, index);
    const file = inflateContainer(this.rom, start, end);
    if (metadataOffset >= file.length) throw new Error(`Stunt Racer ${set} file ${index} metadata outside decoded file`);
    this.files.set(key, file);
    return file;
  }
}

export class StuntRom {
  constructor(readonly rom: Uint8Array) {
    if (rom.length !== 0xc00000 || String.fromCharCode(...rom.subarray(0x3b, 0x3f)) !== 'NR3E' || rom[0x3f] !== 0 ||
        u32(rom, 0x10) !== 0x9510d8d7 || u32(rom, 0x14) !== 0x35100dd2)
      throw new Error('Only Stunt Racer 64 USA revision 0 is supported');
  }

  map(internalId: number): StuntMap {
    if (!Number.isInteger(internalId) || internalId < 0 || internalId >= 13) throw new Error('Invalid Stunt Racer map ID');
    const record = 0xbbda0 + internalId * 0x5c;
    return new StuntMap(this.rom, internalId, u32(this.rom, record + 0x14), u32(this.rom, record + 0x18));
  }
}
