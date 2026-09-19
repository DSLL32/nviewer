// Vigilante 8: 2nd Offense (USA) resident filename directory.
import { decodeVigilanteLzss } from '../vigilante8/fs';

export interface Vigilante8SecondOffenseFile {
  group: string;
  name: string;
  start: number;
  storedSize: number;
}

const DIRECTORY = 0x70840;
const GROUP_COUNT = 6;

function be32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
}

function ascii(bytes: Uint8Array, offset: number, size: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + size)).trim();
}

export class Vigilante8SecondOffenseFs {
  readonly files: readonly Vigilante8SecondOffenseFile[];

  constructor(private readonly rom: Uint8Array) {
    const files: Vigilante8SecondOffenseFile[] = [];
    let offset = DIRECTORY;
    for (let groupIndex = 0; groupIndex < GROUP_COUNT; groupIndex++) {
      if (offset + 20 > rom.length) throw new Error('Truncated Vigilante 8: 2nd Offense directory');
      const group = ascii(rom, offset, 8) || 'ROOT';
      const count = be32(rom, offset + 16);
      offset += 20;
      for (let i = 0; i < count; i++, offset += 20) {
        if (offset + 20 > rom.length) throw new Error('Truncated Vigilante 8: 2nd Offense file record');
        const start = be32(rom, offset + 12) & 0x0fffffff;
        const storedSize = be32(rom, offset + 16);
        if (start + storedSize > rom.length)
          throw new Error(`Vigilante 8: 2nd Offense file outside ROM at 0x${start.toString(16)}`);
        files.push({ group, name: ascii(rom, offset, 12), start, storedSize });
      }
    }
    this.files = files;
  }

  entries(group?: string): readonly Vigilante8SecondOffenseFile[] {
    return group === undefined ? this.files : this.files.filter((file) => file.group === group.toUpperCase());
  }

  file(group: string, name: string): Uint8Array {
    const entry = this.files.find((file) => file.group === group.toUpperCase() && file.name === name.toUpperCase());
    if (!entry) throw new Error(`Vigilante 8: 2nd Offense file not found: ${group}/${name}`);
    const stored = this.rom.subarray(entry.start, entry.start + entry.storedSize);
    return stored.length >= 4 && ascii(stored, 0, 4) === 'LZSS' ? decodeVigilanteLzss(stored) : stored.slice();
  }
}
