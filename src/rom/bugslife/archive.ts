// A Bug's Life's path archive and RNC ProPack decoder. The decoder follows
// the shipped method-1/method-2 stream contract, including method 1's
// interleaved little-endian bit words and literal bytes.

export interface BugsLifeArchiveEntry {
  path: string;
  offset: number;
  storedSize: number;
  decodedSize: number;
  method: 0 | 1 | 2;
}

export interface BugsLifeVersion {
  code: 'NBYE' | 'NBYP' | 'NBYF' | 'NBYD' | 'NBYI';
  region: 'U' | 'E' | 'F' | 'G' | 'I';
  manifestOffset: number;
}

const VERSIONS: Record<string, Omit<BugsLifeVersion, 'manifestOffset'> & { crc1: number; crc2: number }> = {
  NBYE: { code: 'NBYE', region: 'U', crc1: 0x82dc04fd, crc2: 0xcf2d82f4 },
  NBYP: { code: 'NBYP', region: 'E', crc1: 0x8f12c096, crc2: 0x45dc17e1 },
  NBYF: { code: 'NBYF', region: 'F', crc1: 0x2b38aec0, crc2: 0x6350b810 },
  NBYD: { code: 'NBYD', region: 'G', crc1: 0xdff227d9, crc2: 0x0d4d8169 },
  NBYI: { code: 'NBYI', region: 'I', crc1: 0xf63b89ce, crc2: 0x4582d57d },
};

const FIRST_PATH = new TextEncoder().encode('creat\\creat01.bin\0');
const HEADER_SIZE = 0x12;
const MAX_DECODED_FILE = 0x2000000;

const u16 = (b: Uint8Array, p: number) => (b[p] << 8) | b[p + 1];
const u32 = (b: Uint8Array, p: number) => ((b[p] * 0x1000000) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3]) >>> 0;

function crc16(bytes: Uint8Array, start = 0, length = bytes.length - start): number {
  let crc = 0;
  for (let i = 0; i < length; i++) {
    crc ^= bytes[start + i];
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc & 0xffff;
}

function inverseBits(value: number, count: number): number {
  let result = 0;
  while (count-- > 0) { result = (result << 1) | (value & 1); value >>>= 1; }
  return result >>> 0;
}

interface HuffmanEntry { depth: number; code: number }

class RncDecoder {
  private cursor = HEADER_SIZE;
  private bitCount = 0;
  private bitBuffer = 0;
  private written = 0;
  private readonly output: Uint8Array;

  constructor(private readonly source: Uint8Array, private readonly method: 1 | 2, decodedSize: number) {
    this.output = new Uint8Array(decodedSize);
  }

  private byte(): number {
    // The reference decoder has a two-byte zeroed lookahead at the end of its
    // refill buffer. Some valid streams consume those pad bits after the final
    // literal while completing the last Huffman symbol.
    if (this.cursor >= this.source.length) {
      if (this.cursor < this.source.length + 2) { this.cursor++; return 0; }
      throw new Error(`truncated RNC stream at input ${this.cursor}, output ${this.written}/${this.output.length}`);
    }
    return this.source[this.cursor++];
  }

  private bitsM1(count: number): number {
    let result = 0, mask = 1;
    while (count-- > 0) {
      if (!this.bitCount) {
        const a = this.byte(), b = this.byte();
        const c = this.source[this.cursor] ?? 0, d = this.source[this.cursor + 1] ?? 0;
        this.bitBuffer = ((d << 24) | (c << 16) | (b << 8) | a) >>> 0;
        this.bitCount = 16;
      }
      if (this.bitBuffer & 1) result += mask;
      this.bitBuffer >>>= 1;
      mask *= 2;
      this.bitCount--;
    }
    return result >>> 0;
  }

  private bitsM2(count: number): number {
    let result = 0;
    while (count-- > 0) {
      if (!this.bitCount) { this.bitBuffer = this.byte(); this.bitCount = 8; }
      result = (result << 1) | ((this.bitBuffer >>> 7) & 1);
      this.bitBuffer = (this.bitBuffer << 1) & 0xff;
      this.bitCount--;
    }
    return result >>> 0;
  }

  private write(value: number) {
    if (this.written >= this.output.length) throw new Error('RNC stream exceeds declared decoded size');
    this.output[this.written++] = value;
  }

  private copy(offset: number, length: number) {
    if (offset <= 0 || offset > this.written) throw new Error(`invalid RNC back-reference ${offset} at ${this.written}`);
    while (length-- > 0) this.write(this.output[this.written - offset]);
  }

  private table(): HuffmanEntry[] {
    const table = Array.from({ length: 16 }, () => ({ depth: 0, code: 0 }));
    const count = Math.min(this.bitsM1(5), 16);
    for (let i = 0; i < count; i++) table[i].depth = this.bitsM1(4);
    let value = 0, divisor = 0x80000000;
    for (let depth = 1; depth <= 16; depth++, divisor >>>= 1) for (let i = 0; i < count; i++) {
      if (table[i].depth === depth) {
        table[i].code = inverseBits(Math.floor(value / divisor), depth);
        value += divisor;
      }
    }
    return table;
  }

  private symbol(table: HuffmanEntry[]): number {
    for (let i = 0; i < table.length; i++) {
      const entry = table[i];
      if (entry.depth && entry.code === (this.bitBuffer & (2 ** entry.depth - 1))) {
        this.bitsM1(entry.depth);
        return i < 2 ? i : this.bitsM1(i - 1) + 2 ** (i - 1);
      }
    }
    throw new Error('invalid RNC Huffman symbol');
  }

  private method1() {
    while (this.written < this.output.length) {
      const raw = this.table(), distance = this.table(), length = this.table();
      let chunks = this.bitsM1(16);
      if (!chunks) throw new Error('empty RNC1 chunk');
      while (chunks-- > 0) {
        const literalCount = this.symbol(raw);
        for (let i = 0; i < literalCount; i++) this.write(this.byte());
        if (literalCount) {
          const lowMask = this.bitCount ? 2 ** this.bitCount - 1 : 0;
          const next = ((this.source[this.cursor + 2] ?? 0) << 16) | ((this.source[this.cursor + 1] ?? 0) << 8) | (this.source[this.cursor] ?? 0);
          this.bitBuffer = ((next * 2 ** this.bitCount) | (this.bitBuffer & lowMask)) >>> 0;
        }
        if (this.written === this.output.length) return;
        if (chunks) this.copy(this.symbol(distance) + 1, this.symbol(length) + 2);
        if (this.written === this.output.length) return;
      }
    }
  }

  private matchOffsetM2(): number {
    let high = 0;
    if (this.bitsM2(1)) {
      high = this.bitsM2(1);
      if (this.bitsM2(1)) {
        high = ((high << 1) | this.bitsM2(1)) | 4;
        if (!this.bitsM2(1)) high = (high << 1) | this.bitsM2(1);
      } else if (!high) high = this.bitsM2(1) + 2;
    }
    return ((high << 8) | this.byte()) + 1;
  }

  private method2() {
    while (this.written < this.output.length) {
      for (;;) {
        if (!this.bitsM2(1)) { this.write(this.byte()); continue; }
        if (this.bitsM2(1)) {
          let length: number, offset: number;
          if (this.bitsM2(1)) {
            if (this.bitsM2(1)) {
              length = this.byte() + 8;
              if (length === 8) { this.bitsM2(1); break; }
            } else length = 3;
            offset = this.matchOffsetM2();
          } else { length = 2; offset = this.byte() + 1; }
          this.copy(offset, length);
        } else {
          let length = this.bitsM2(1) + 4;
          if (this.bitsM2(1)) length = ((length - 1) << 1) + this.bitsM2(1);
          if (length !== 9) this.copy(this.matchOffsetM2(), length);
          else {
            let literals = (this.bitsM2(4) << 2) + 12;
            while (literals-- > 0) this.write(this.byte());
          }
        }
      }
    }
  }

  decode(): Uint8Array {
    // RNC stream flags: locked and encrypted. Retail files set both to zero.
    const locked = this.method === 1 ? this.bitsM1(1) : this.bitsM2(1);
    const encrypted = this.method === 1 ? this.bitsM1(1) : this.bitsM2(1);
    if (locked || encrypted) throw new Error('encrypted RNC streams are unsupported');
    if (this.method === 1) this.method1(); else this.method2();
    if (this.written !== this.output.length) throw new Error(`RNC size mismatch: wrote ${this.written}, expected ${this.output.length}`);
    return this.output;
  }
}

export function decodeRnc(source: Uint8Array): Uint8Array {
  if (source.length < HEADER_SIZE || source[0] !== 0x52 || source[1] !== 0x4e || source[2] !== 0x43)
    throw new Error('invalid RNC header');
  const method = source[3];
  if (method !== 1 && method !== 2) throw new Error(`unsupported RNC method ${method}`);
  const decodedSize = u32(source, 4), packedSize = u32(source, 8);
  if (decodedSize > MAX_DECODED_FILE) throw new Error(`implausible RNC decoded size ${decodedSize}`);
  if (packedSize + HEADER_SIZE !== source.length) throw new Error('RNC packed size does not match archive entry');
  if (crc16(source, HEADER_SIZE, packedSize) !== u16(source, 14)) throw new Error('RNC packed CRC mismatch');
  const result = new RncDecoder(source, method, decodedSize).decode();
  if (crc16(result) !== u16(source, 12)) throw new Error('RNC decoded CRC mismatch');
  return result;
}

function normalized(path: string): string { return path.replaceAll('/', '\\').toLowerCase(); }

function findBytes(haystack: Uint8Array, needle: Uint8Array): number[] {
  const found: number[] = [];
  outer: for (let p = 0; p <= haystack.length - needle.length; p++) {
    for (let i = 0; i < needle.length; i++) if (haystack[p + i] !== needle[i]) continue outer;
    found.push(p);
  }
  return found;
}

function readAscii(bytes: Uint8Array, start: number, end: number): string {
  let text = '';
  for (let p = start; p < end; p++) {
    if (bytes[p] < 0x20 || bytes[p] > 0x7e) throw new Error('non-ASCII manifest path');
    text += String.fromCharCode(bytes[p]);
  }
  return text;
}

function parseManifest(rom: Uint8Array, start: number): BugsLifeArchiveEntry[] {
  const rows: { path: string; storedSize: number }[] = [];
  let p = start;
  while (p < rom.length && rom[p] !== 0 && rows.length <= 488) {
    let end = p;
    while (end < rom.length && rom[end] !== 0 && end - p <= 255) end++;
    if (end >= rom.length || end - p > 255) throw new Error('unterminated manifest path');
    const path = readAscii(rom, p, end);
    const words = (end + 4) & ~3;
    if (words + 8 > rom.length || !path.includes('\\')) throw new Error('invalid manifest record');
    const storedSize = u32(rom, words), auxiliary = u32(rom, words + 4);
    if (!storedSize || auxiliary) throw new Error('invalid manifest sizes');
    rows.push({ path, storedSize });
    p = words + 8;
  }
  if (rows.length !== 488 || p + 4 > rom.length || rom[p] || rom[p + 1] || rom[p + 2] || rom[p + 3])
    throw new Error(`invalid A Bug's Life manifest (${rows.length} entries)`);
  let payload = p + 4;
  return rows.map(({ path, storedSize }) => {
    if (payload + storedSize > rom.length) throw new Error('archive payload outside ROM');
    const method = rom[payload] === 0x52 && rom[payload + 1] === 0x4e && rom[payload + 2] === 0x43 ? rom[payload + 3] : 0;
    if (method !== 0 && method !== 1 && method !== 2) throw new Error(`unsupported compression at ${path}`);
    const decodedSize = method ? u32(rom, payload + 4) : storedSize;
    const entry = { path, offset: payload, storedSize, decodedSize, method } as BugsLifeArchiveEntry;
    payload = (payload + storedSize + 7) & ~7;
    return entry;
  });
}

export class BugsLifeArchive {
  readonly version: BugsLifeVersion;
  readonly entries: readonly BugsLifeArchiveEntry[];
  readonly romBytes: Uint8Array;
  private readonly byPath = new Map<string, BugsLifeArchiveEntry>();
  private readonly cache = new Map<string, Uint8Array>();

  constructor(rom: Uint8Array) {
    if (rom.length !== 0xc00000) throw new Error(`A Bug's Life ROM must be 12 MiB (got ${rom.length} bytes)`);
    const code = readAscii(rom, 0x3b, 0x3f), profile = VERSIONS[code];
    if (!profile || rom[0x3f] !== 0 || u32(rom, 0x10) !== profile.crc1 || u32(rom, 0x14) !== profile.crc2)
      throw new Error(`unsupported A Bug's Life ROM revision ${code || '(unknown)'}`);
    const candidates = findBytes(rom, FIRST_PATH);
    let entries: BugsLifeArchiveEntry[] | undefined, manifestOffset = -1;
    for (const candidate of candidates) try {
      const parsed = parseManifest(rom, candidate);
      entries = parsed; manifestOffset = candidate; break;
    } catch { /* executable strings can contain the first filename */ }
    if (!entries) throw new Error("A Bug's Life archive manifest was not found");
    this.version = { code: profile.code, region: profile.region, manifestOffset };
    this.entries = entries;
    this.romBytes = rom;
    for (const entry of entries) this.byPath.set(normalized(entry.path), entry);
  }

  entry(path: string): BugsLifeArchiveEntry | undefined { return this.byPath.get(normalized(path)); }

  file(path: string): Uint8Array {
    const key = normalized(path), cached = this.cache.get(key);
    if (cached) return cached;
    const entry = this.byPath.get(key);
    if (!entry) throw new Error(`A Bug's Life archive file not found: ${path}`);
    const packed = this.romBytes.subarray(entry.offset, entry.offset + entry.storedSize);
    const decoded = entry.method ? decodeRnc(packed) : packed.slice();
    if (decoded.length !== entry.decodedSize) throw new Error(`decoded size mismatch for ${entry.path}`);
    this.cache.set(key, decoded);
    return decoded;
  }
}

const archives = new WeakMap<Uint8Array, BugsLifeArchive>();
export function openBugsLifeArchive(rom: Uint8Array): BugsLifeArchive {
  let archive = archives.get(rom);
  if (!archive) { archive = new BugsLifeArchive(rom); archives.set(rom, archive); }
  return archive;
}
