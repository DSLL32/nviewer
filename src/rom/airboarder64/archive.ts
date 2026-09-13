// Air Boarder 64's region-specific top-level archive and headerless LH5 decoder.

export interface AirBoarderVersion {
  code: 'NABJ' | 'NABP';
  region: 'Japan' | 'Europe';
  table: number;
  count: number;
  payload: number;
  courseIds: readonly number[];
  courseHeaders: readonly (readonly number[])[];
  overlayDelta: number;
}

const VERSIONS: Record<string, AirBoarderVersion | undefined> = {
  NABJ: {
    code: 'NABJ', region: 'Japan', table: 0x454bf0, count: 76, payload: 0x454e50,
    courseIds: [74, 69, 70, 71, 72, 73],
    courseHeaders: [[0x35898], [0x08940], [0x00440], [0x1a850], [0x0eec8], [0x02790, 0x5d348, 0xb15b0]],
    overlayDelta: 0,
  },
  NABP: {
    code: 'NABP', region: 'Europe', table: 0x455530, count: 77, payload: 0x455798,
    courseIds: [75, 70, 71, 72, 73, 74],
    courseHeaders: [[0x1dd78], [0x08940], [0x00440], [0x1a850], [0x0eec8], [0x02790, 0x5d348, 0xb15b0]],
    overlayDelta: 0x940,
  },
};

const hex = (n: number) => `0x${n.toString(16)}`;

class Bits {
  private bit = 0;
  constructor(private readonly data: Uint8Array) {}
  get(count: number): number {
    if (count < 0 || this.bit + count > this.data.length * 8) throw new Error('Air Boarder LH5 bitstream ended early');
    let value = 0;
    for (let i = 0; i < count; i++, this.bit++) value = value * 2 + ((this.data[this.bit >>> 3] >>> (7 - (this.bit & 7))) & 1);
    return value;
  }
}

class Huffman {
  private readonly codes = new Map<string, number>();
  private readonly maxLength: number;
  constructor(lengths: number[], private readonly constant: number | null = null) {
    this.maxLength = lengths.reduce((a, b) => Math.max(a, b), 0);
    if (constant !== null) return;
    const counts = new Map<number, number>();
    for (const length of lengths) if (length) counts.set(length, (counts.get(length) ?? 0) + 1);
    let code = 0;
    const next = new Map<number, number>();
    for (let length = 1; length <= this.maxLength; length++) {
      code = (code + (counts.get(length - 1) ?? 0)) * 2;
      next.set(length, code);
    }
    lengths.forEach((length, symbol) => {
      if (!length) return;
      const value = next.get(length)!;
      this.codes.set(`${length}/${value}`, symbol);
      next.set(length, value + 1);
    });
  }
  read(bits: Bits): number {
    if (this.constant !== null) return this.constant;
    let code = 0;
    for (let length = 1; length <= this.maxLength; length++) {
      code = code * 2 + bits.get(1);
      const symbol = this.codes.get(`${length}/${code}`);
      if (symbol !== undefined) return symbol;
    }
    throw new Error('invalid Air Boarder LH5 Huffman code');
  }
}

function ptTree(bits: Bits, count: number, countBits: number, special: number): Huffman {
  const used = bits.get(countBits);
  if (!used) return new Huffman([], bits.get(countBits));
  const lengths: number[] = [];
  while (lengths.length < used) {
    let length = bits.get(3);
    if (length === 7) while (bits.get(1)) length++;
    lengths.push(length);
    if (lengths.length === special) for (let i = bits.get(2); i; i--) lengths.push(0);
  }
  if (lengths.length > count) throw new Error('overfull Air Boarder LH5 position tree');
  while (lengths.length < count) lengths.push(0);
  return new Huffman(lengths);
}

function characterTree(bits: Bits, pt: Huffman): Huffman {
  const used = bits.get(9);
  if (!used) return new Huffman([], bits.get(9));
  const lengths: number[] = [];
  while (lengths.length < used) {
    const value = pt.read(bits);
    if (value >= 3) lengths.push(value - 2);
    else {
      const zeroes = value === 0 ? 1 : value === 1 ? bits.get(4) + 3 : bits.get(9) + 20;
      for (let i = 0; i < zeroes; i++) lengths.push(0);
    }
  }
  if (lengths.length > 509) throw new Error('overfull Air Boarder LH5 character tree');
  while (lengths.length < 509) lengths.push(0);
  return new Huffman(lengths);
}

export function decodeAirBoarderLh5(blob: Uint8Array): Uint8Array {
  if (blob.length < 4) throw new Error('Air Boarder compressed entry has no size header');
  const size = new DataView(blob.buffer, blob.byteOffset, blob.byteLength).getUint32(0);
  if (!size || size > 0x1000000) throw new Error(`invalid Air Boarder decoded size ${hex(size)}`);
  const bits = new Bits(blob.subarray(4));
  const ring = new Uint8Array(8192); ring.fill(0x20);
  const out = new Uint8Array(size);
  let outAt = 0, ringAt = 0, block = 0;
  let chars: Huffman | null = null, positions: Huffman | null = null;
  while (outAt < size) {
    if (!block) {
      block = bits.get(16);
      if (!block) throw new Error('zero-length Air Boarder LH5 block');
      chars = characterTree(bits, ptTree(bits, 19, 5, 3));
      positions = ptTree(bits, 14, 4, -1);
    }
    block--;
    const symbol = chars!.read(bits);
    if (symbol < 256) {
      out[outAt++] = symbol; ring[ringAt] = symbol; ringAt = (ringAt + 1) & 0x1fff;
      continue;
    }
    const length = symbol - 253, slot = positions!.read(bits);
    const distance = slot ? (1 << (slot - 1)) + bits.get(slot - 1) : 0;
    let source = (ringAt - distance - 1) & 0x1fff;
    for (let i = 0; i < length && outAt < size; i++) {
      const value = ring[source]; source = (source + 1) & 0x1fff;
      out[outAt++] = value; ring[ringAt] = value; ringAt = (ringAt + 1) & 0x1fff;
    }
  }
  return out;
}

export class AirBoarderRom {
  readonly version: AirBoarderVersion;
  private readonly entries: { start: number; size: number }[] = [];
  private readonly decoded = new Map<number, Uint8Array>();
  constructor(readonly rom: Uint8Array) {
    if (rom.length !== 0x800000) throw new Error(`unsupported Air Boarder 64 ROM size ${hex(rom.length)} (expected 8 MiB)`);
    const dv = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
    if (dv.getUint32(0) !== 0x80371240) throw new Error('Air Boarder 64 ROM must be normalized to big-endian byte order');
    const code = String.fromCharCode(...rom.subarray(0x3b, 0x3f));
    const version = VERSIONS[code];
    if (!version) throw new Error(`unsupported Air Boarder 64 ROM code ${code}`);
    if (rom[0x3f] !== 0) throw new Error(`unsupported Air Boarder 64 revision ${rom[0x3f]} (expected revision 0)`);
    if (version.payload !== version.table + version.count * 8) throw new Error('internal Air Boarder archive profile mismatch');
    let expected = 0;
    for (let i = 0; i < version.count; i++) {
      const at = version.table + i * 8, size = dv.getUint32(at), relative = dv.getUint32(at + 4);
      if (relative !== expected) throw new Error(`invalid Air Boarder archive record ${i}: relative offset ${hex(relative)}, expected ${hex(expected)}`);
      const start = version.payload + relative;
      if (start + size > rom.length) throw new Error(`Air Boarder archive record ${i} exceeds the ROM`);
      this.entries.push({ start, size });
      expected = (relative + size + 1) & ~1;
    }
    this.version = version;
  }
  raw(index: number): Uint8Array {
    const e = this.entries[index];
    if (!e) throw new Error(`invalid Air Boarder archive ID ${index}`);
    return this.rom.subarray(e.start, e.start + e.size);
  }
  file(index: number): Uint8Array {
    let file = this.decoded.get(index);
    if (!file) { file = decodeAirBoarderLh5(this.raw(index)); this.decoded.set(index, file); }
    return file;
  }
}
