import { inflateRaw } from '../inflate';
import type { LevelInfo } from '../types';

const LUT = 0x0b1750;
const ASSET_BASE = 0x0b1880;

export const view = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength);

export function cstr(data: Uint8Array, at: number, length: number): string {
  let value = '';
  for (let i = 0; i < length && data[at + i]; i++) value += String.fromCharCode(data[at + i]);
  return value;
}

function title(rom: Uint8Array): string {
  return cstr(rom, 0x20, 20).trim();
}

function levelKind(name: string): LevelInfo['kind'] {
  const lower = name.toLowerCase();
  if (lower.includes('boss')) return 'boss';
  if (lower.includes('multi') || lower.includes('mp ')) return 'battle';
  if (lower.includes('front end') || lower.includes('title') || lower.includes('game over') ||
      lower.includes('cutscene') || lower.includes('credits')) return 'other';
  return 'adventure';
}

export class JfgArchive {
  readonly data: DataView;
  readonly levels: LevelInfo[];
  private readonly levelsByIndex: LevelInfo[];
  private readonly sections: number[];
  private readonly tables = new Map<number, number[]>();
  private readonly decoded = new Map<string, Uint8Array>();

  constructor(readonly rom: Uint8Array) {
    this.data = view(rom);
    if (rom.length !== 0x02000000 || this.data.getUint32(0) !== 0x80371240 || title(rom) !== 'JET FORCE GEMINI')
      throw new Error('unsupported Jet Force Gemini ROM (expected normalized 32 MiB USA image)');
    if (this.data.getUint32(0x10) !== 0x8a6009b6 || this.data.getUint32(0x14) !== 0x94ace150)
      throw new Error('unsupported Jet Force Gemini revision');
    const count = this.data.getUint32(LUT);
    if (count !== 0x47) throw new Error(`Jet Force Gemini asset table has ${count} sections`);
    this.sections = Array.from({ length: count + 1 }, (_, i) => this.data.getUint32(LUT + 4 + i * 4));
    for (let i = 0; i < count; i++) {
      if (this.sections[i] > this.sections[i + 1] || ASSET_BASE + this.sections[i + 1] > rom.length)
        throw new Error(`Jet Force Gemini asset section ${i} is out of bounds`);
    }
    const records = this.table(0x1e);
    if (records.length !== 413) throw new Error(`Jet Force Gemini has ${records.length - 1} level records`);
    this.levelsByIndex = Array.from({ length: 412 }, (_, index) => {
      const record = this.member(0x1e, 0x1f, index);
      const name = cstr(record, 0, 0x20) || `Level ${index}`;
      const category = record[0x20];
      let group = 'Uncategorized';
      if (category !== 0xff && category < this.table(0x22).length - 1)
        group = cstr(this.member(0x22, 0x23, category), 0, 0x100) || group;
      return { index, name, group, kind: levelKind(name) };
    });
    // The ROM interleaves rooms from different worlds. Keeping that raw order
    // would create scores of repeated one-room sidebar headings; retain the
    // first frontend record as the default, then keep each world contiguous.
    this.levels = [this.levelsByIndex[0], ...this.levelsByIndex.slice(1).sort((a, b) =>
      (a.group ?? '').localeCompare(b.group ?? '') || a.index - b.index)];
  }

  section(index: number): Uint8Array {
    if (index < 0 || index + 1 >= this.sections.length) throw new RangeError(`Jet Force Gemini section ${index} is absent`);
    return this.rom.subarray(ASSET_BASE + this.sections[index], ASSET_BASE + this.sections[index + 1]);
  }

  table(index: number): number[] {
    const cached = this.tables.get(index);
    if (cached) return cached;
    const data = this.section(index), dv = view(data), result: number[] = [];
    for (let at = 0; at + 4 <= data.length; at += 4) {
      const offset = dv.getUint32(at);
      if (offset === 0xffffffff) break;
      result.push(offset);
    }
    if (result.length < 2) throw new Error(`Jet Force Gemini section ${index} has no member table`);
    this.tables.set(index, result);
    return result;
  }

  member(tableSection: number, dataSection: number, index: number): Uint8Array {
    const offsets = this.table(tableSection), data = this.section(dataSection);
    if (index < 0 || index + 1 >= offsets.length) throw new RangeError(`Jet Force Gemini member ${tableSection}:${index} is absent`);
    const start = offsets[index], end = offsets[index + 1];
    if (start > end || end > data.length) throw new Error(`Jet Force Gemini member ${tableSection}:${index} is out of bounds`);
    return data.subarray(start, end);
  }

  inflate(tableSection: number, dataSection: number, index: number, wrapperOffset = 0): Uint8Array {
    const key = `${tableSection}:${dataSection}:${index}:${wrapperOffset}`;
    const cached = this.decoded.get(key);
    if (cached) return cached;
    const member = this.member(tableSection, dataSection, index);
    if (wrapperOffset + 5 > member.length) throw new Error(`Jet Force Gemini compressed member ${key} is truncated`);
    const size = member[wrapperOffset] | (member[wrapperOffset + 1] << 8) |
      (member[wrapperOffset + 2] << 16) | (member[wrapperOffset + 3] << 24);
    if (size <= 0 || size > 0x2000000 || member[wrapperOffset + 4] !== 9)
      throw new Error(`Jet Force Gemini compressed member ${key} has an invalid wrapper`);
    const result = inflateRaw(member, wrapperOffset + 5, size);
    if (result.length !== size) throw new Error(`Jet Force Gemini compressed member ${key} decoded to ${result.length}, expected ${size}`);
    this.decoded.set(key, result);
    return result;
  }

  levelRecord(index: number): Uint8Array {
    const result = this.member(0x1e, 0x1f, index);
    if (result.length !== 0x118) throw new Error(`Jet Force Gemini level ${index} has a ${result.length}-byte record`);
    return result;
  }

  levelInfo(index: number): LevelInfo {
    const result = this.levelsByIndex[index];
    if (!result) throw new RangeError(`Jet Force Gemini level ${index} is absent`);
    return result;
  }

  levelModel(index: number): Uint8Array { return this.inflate(0x24, 0x25, index); }
  objectModel(index: number): Uint8Array { return this.inflate(0x26, 0x27, index); }
  romList(index: number): Uint8Array { return this.member(0x1c, 0x1d, index); }
}
