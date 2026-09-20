import type { AreaRecord, AssetKind, Extent, SetupRecord } from './types';
import { AREA_TYPE_NAMES, WORLD_NAMES } from './types';

const FILE_TABLE = 0x783d4;
const OVL1_BIAS = 0x80057db0;
const AREA_RECORDS = 0x783f4;
const AREA_RECORDS_VRAM = 0x800d01a4;
const AREA_SELECTOR = 0x7a1e8;
const COUNTS: Record<AssetKind, readonly number[]> = {
  geometry: [11, 244, 129, 197, 154, 1, 295, 211],
  image: [28, 907, 265, 1034, 705, 313, 162, 1129],
  animation: [19, 1683, 1026, 475, 558, 1, 331, 151],
  misc: [5, 3, 3, 22, 3, 1, 277, 240],
};

export const u16 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset + o, 2).getUint16(0);
export const s16 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset + o, 2).getInt16(0);
export const u32 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset + o, 4).getUint32(0);
export const f32 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset + o, 4).getFloat32(0);

function readName(rom: Uint8Array, at: number): string {
  let out = '';
  for (let i = at; i < rom.length && rom[i] && out.length < 64; i++) out += String.fromCharCode(rom[i]);
  return out;
}

function levelKind(type: number): AreaRecord['info']['kind'] {
  if (type === 1 || type === 2 || type === 9 || type === 10) return 'boss';
  if (type === 3) return 'bonus';
  return 'campaign';
}

export class KirbyArchive {
  readonly work: Uint8Array;
  readonly areas: AreaRecord[];
  private readonly headers: number[];

  constructor(readonly rom: Uint8Array) {
    if (rom.length !== 0x2000000) throw new Error(`Kirby 64: expected a 32 MiB ROM, got 0x${rom.length.toString(16)} bytes`);
    const title = String.fromCharCode(...rom.subarray(0x20, 0x27));
    const code = String.fromCharCode(...rom.subarray(0x3b, 0x3f));
    if (title !== 'Kirby64' || code !== 'NK4E' || rom[0x3f] !== 0 || u32(rom, 0x10) !== 0x46039fb4 || u32(rom, 0x14) !== 0x0337822c)
      throw new Error('Kirby 64: unsupported ROM (requires USA revision 0, NK4E)');
    this.headers = Array.from({ length: 8 }, (_, bank) => {
      const at = u32(rom, FILE_TABLE + bank * 4) - OVL1_BIAS;
      if (at < 0 || at + 0x20 > rom.length) throw new Error(`Kirby 64: invalid bank ${bank} header`);
      return at;
    });
    // The final cartridge-padding region is a convenient reusable command arena.
    // Geometry decoding is synchronous; no returned Level retains this buffer.
    this.work = rom.slice();
    this.areas = this.readAreas();
    if (this.areas.length !== 181) throw new Error(`Kirby 64: expected 181 areas, found ${this.areas.length}`);
  }

  count(kind: AssetKind, bank: number): number {
    if (bank < 0 || bank >= 8) return 0;
    return COUNTS[kind][bank];
  }

  member(kind: AssetKind, id: number): Extent {
    const bank = id >>> 16, index = id & 0xffff;
    if (bank >= 8 || index >= this.count(kind, bank))
      throw new Error(`Kirby 64: invalid ${kind} ID ${bank}:${index}`);
    const h = this.headers[bank];
    let start: number, end: number;
    if (kind === 'geometry') {
      const table = u32(this.rom, h) - OVL1_BIAS;
      start = u32(this.rom, table + index * 8);
      end = u32(this.rom, table + index * 8 + 4);
    } else {
      const field = kind === 'image' ? 8 : kind === 'animation' ? 0x10 : 0x18;
      const table = u32(this.rom, h + field) - OVL1_BIAS;
      const base = u32(this.rom, h + field + 4);
      start = base + u32(this.rom, table + index * 4);
      end = base + u32(this.rom, table + (index + 1) * 4);
    }
    if (index !== 0 && !(start >= 0x4aa8f0 && start < end && end <= 0x1e8bb50))
      throw new Error(`Kirby 64: invalid ${kind} extent for ${bank}:${index}`);
    return { start, end, bank, index, id: (bank << 16) | index };
  }

  resolveImage(id: number): number {
    try {
      const e = this.member('image', id >>> 0);
      return e.start;
    } catch {
      return -1;
    }
  }

  setup(id: number): SetupRecord {
    const extent = this.member('misc', id);
    return {
      extent,
      collision: extent.start + u32(this.rom, extent.start),
      paths: extent.start + u32(this.rom, extent.start + 4),
      entities: u32(this.rom, extent.start + 8) ? extent.start + u32(this.rom, extent.start + 8) : 0,
    };
  }

  private readAreas(): AreaRecord[] {
    const out: AreaRecord[] = [];
    for (let world0 = 0; world0 < 9; world0++) {
      for (let stage0 = 0; stage0 < 12; stage0++) {
        const ptr = u32(this.rom, AREA_SELECTOR + (world0 * 12 + stage0) * 4);
        if (!ptr) continue;
        let recordIndex = (ptr - AREA_RECORDS_VRAM) / 0x24;
        if (!Number.isInteger(recordIndex) || recordIndex < 0 || recordIndex >= 213)
          throw new Error(`Kirby 64: invalid area selector ${world0 + 1}-${stage0 + 1}`);
        for (let area0 = 0; ; area0++, recordIndex++) {
          const at = AREA_RECORDS + recordIndex * 0x24;
          if (!u32(this.rom, at) && !u32(this.rom, at + 4) && !u32(this.rom, at + 0x10)) break;
          const world = world0 + 1, stage = stage0 + 1, area = area0 + 1;
          const name = readName(this.rom, u32(this.rom, at + 0x20) - OVL1_BIAS);
          const reachability: AreaRecord['reachability'] = world === 7 && stage === 3 ? 'tutorial'
            : world === 7 && (stage === 2 || stage === 4) ? 'hidden' : 'campaign';
          const areaType = u16(this.rom, at + 0x16);
          const groupPrefix = `${world}-${stage} — ${WORLD_NAMES[world - 1] ?? 'Unused'}`;
          const group = reachability === 'tutorial' ? `${groupPrefix} — Copy tutorial`
            : reachability === 'hidden' ? `${groupPrefix} — Hidden/test` : groupPrefix;
          const index = out.length;
          out.push({
            index, recordIndex, rom: at, world, stage, area, name, reachability,
            primaryGeometry: u32(this.rom, at), secondaryGeometry: u32(this.rom, at + 4),
            backdropId: u16(this.rom, at + 8), colorId: u16(this.rom, at + 0xa), musicId: u32(this.rom, at + 0xc),
            setupId: u32(this.rom, at + 0x10), deathCamera: u16(this.rom, at + 0x14), areaType,
            dustSettingsId: u32(this.rom, at + 0x18), dustImageId: u32(this.rom, at + 0x1c),
            info: { index, name, kind: reachability === 'hidden' || reachability === 'tutorial' ? 'other' : levelKind(areaType), group },
          });
        }
      }
    }
    return out;
  }
}

export function describeAreaType(type: number): string {
  return AREA_TYPE_NAMES[type] ?? `type ${type}`;
}
