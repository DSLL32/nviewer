// Vigilante 8 (USA) resident filename directory and 2 KiB-ring LZSS.

export interface V8File {
  group: string;
  name: string;
  start: number;
  storedSize: number;
}

const DIRECTORY = 0x62830;

function be32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
}

function ascii(bytes: Uint8Array, offset: number, size: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + size)).trim();
}

export function decodeVigilanteLzss(src: Uint8Array): Uint8Array {
  if (ascii(src, 0, 4) !== 'LZSS' || src.length < 8) throw new Error('Vigilante 8 file is not LZSS');
  // This size word is the sole little-endian exception in the file container.
  const size = new DataView(src.buffer, src.byteOffset + 4, 4).getUint32(0, true);
  const dst = new Uint8Array(size), ring = new Uint8Array(2048);
  let ip = 8, op = 0, wp = 0;
  while (op < size) {
    if (ip >= src.length) throw new Error('Truncated Vigilante 8 LZSS flags');
    const flags = src[ip++];
    for (let bit = 7; bit >= 0 && op < size; bit--) {
      if (flags & (1 << bit)) {
        if (ip >= src.length) throw new Error('Truncated Vigilante 8 LZSS literal');
        dst[op++] = ring[wp] = src[ip++];
        wp = (wp + 1) & 0x7ff;
      } else {
        if (ip + 1 >= src.length) throw new Error('Truncated Vigilante 8 LZSS match');
        const token = src[ip] | (src[ip + 1] << 8);
        ip += 2;
        let rp = token >>> 5;
        for (let n = (token & 31) + 2; n-- && op < size;) {
          dst[op++] = ring[wp] = ring[rp];
          wp = (wp + 1) & 0x7ff;
          rp = (rp + 1) & 0x7ff;
        }
      }
    }
  }
  return dst;
}

export class Vigilante8Fs {
  readonly files: readonly V8File[];

  constructor(private readonly rom: Uint8Array) {
    const files: V8File[] = [];
    let offset = DIRECTORY;
    // The directory contains seven consecutive group records, each followed by
    // childCount consecutive file records.
    for (let g = 0; g < 7; g++) {
      if (offset + 20 > rom.length) throw new Error('Truncated Vigilante 8 directory');
      const group = ascii(rom, offset, 8) || 'ROOT';
      const count = be32(rom, offset + 16);
      offset += 20;
      for (let i = 0; i < count; i++, offset += 20) {
        const start = be32(rom, offset + 12) & 0xffffff;
        const storedSize = be32(rom, offset + 16);
        if (start + storedSize > rom.length) throw new Error(`Vigilante 8 file outside ROM at 0x${start.toString(16)}`);
        files.push({ group, name: ascii(rom, offset, 12), start, storedSize });
      }
    }
    this.files = files;
  }

  entries(group?: string): readonly V8File[] {
    return group === undefined ? this.files : this.files.filter((file) => file.group === group.toUpperCase());
  }

  file(group: string, name: string): Uint8Array {
    const entry = this.files.find((file) => file.group === group.toUpperCase() && file.name === name.toUpperCase());
    if (!entry) throw new Error(`Vigilante 8 file not found: ${group}/${name}`);
    const stored = this.rom.subarray(entry.start, entry.start + entry.storedSize);
    return stored.length >= 4 && ascii(stored, 0, 4) === 'LZSS' ? decodeVigilanteLzss(stored) : stored.slice();
  }
}
