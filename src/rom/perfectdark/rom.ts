// Perfect Dark (U) V1.0: the data segment, the file table and names, the stage table, the menu tables and the text banks
// (docs/PERFECTDARK.md §1-§3).
//
// Compression is "rarezip 1173": 11 73, a 24-bit big-endian inflated size, then raw DEFLATE (§2.1). The data segment is
// one such stream that boot inflates to 0x80059FE0; accessors here take those virtual addresses.
import { inflateRaw } from '../inflate';

const DATA_ROM = 0x39850; // 1173 stream → DATA_VADDR
export const DATA_VADDR = 0x80059fe0;
const FILE_TABLE = 0x80082060; // u32 romOffset[2015]: entry 0 = 0, files 1..2013, entry 2014 = end
const FILE_COUNT = 2014;
const NAME_TABLE_ROM = 0x1d5ca00; // u32 nameOffset[2014] relative to the table, NUL-terminated names
const STAGE_TABLE = 0x8007fcc0; // 61 × 0x38
const STAGE_COUNT = 61;
const SOLO_MISSIONS = 0x80071e6c; // 21 × {u32 stage; u8; u8; u16 name; u16 subtitle; u16 short name}
const SOLO_COUNT = 21;
const MISSION_GROUPS = 0x80071f68; // 10 × {u32 first solo index; u16 text; u16}
const MISSION_GROUP_COUNT = 10;
const ARENAS = 0x80084b98; // 17 × {u16 stage; u8 unlock; u8; u16 name}
const ARENA_COUNT = 17;
const ARENA_GROUPS = 0x80084c00; // 3 × {u32 first arena index; u16 text; u16}
const ARENA_GROUP_COUNT = 3;
const TEXT_BANK_FILES = 0x80084124; // u16 file id per bank; text id = bank << 9 | index
const TEXT_BANK_COUNT = 69;

/** Inflates a rarezip "1173" stream at `offset`. */
export function inflate1173(buf: Uint8Array, offset: number): Uint8Array {
  if (buf[offset] !== 0x11 || buf[offset + 1] !== 0x73) throw new Error(`Perfect Dark: no 1173 stream at 0x${offset.toString(16)}`);
  const size = (buf[offset + 2] << 16) | (buf[offset + 3] << 8) | buf[offset + 4];
  const out = inflateRaw(buf, offset + 5, size);
  if (out.length !== size) throw new Error(`Perfect Dark: 1173 stream at 0x${offset.toString(16)} inflates to ${out.length} bytes, not ${size}`);
  return out;
}

/** One stage-table record (§3.1). File fields are file ids (0: none). */
export interface StageRecord {
  index: number; // table index
  address: number;
  id: number; // stage id
  bg: number; // bgdata/bg_<code>.seg
  tiles: number; // bgdata/bg_<code>_tilesZ (collision)
  pads: number; // bgdata/bg_<code>_padsZ
  setup: number; // Usetup<code>Z (solo)
  mpSetup: number; // Ump_setup<code>Z (multiplayer)
  worldScale: number; // +0x18: 0.5 on Crash Site, Air Base, Villa and stage 0x4C (the game draws the whole world scaled)
}

export interface SoloMission {
  index: number;
  stage: number;
  name: number; // text ids
  subtitle: number;
  shortName: number;
}

export interface MenuGroup {
  first: number; // index of the first entry of the group
  text: number;
}

export interface Arena {
  index: number;
  stage: number; // 1 = Random
  unlock: number;
  name: number;
}

export class PdRom {
  readonly rom: Uint8Array;
  readonly data: Uint8Array;
  readonly offsets: number[] = []; // file id → ROM offset (FILE_COUNT + 1 entries)
  readonly names: string[] = []; // file id → name ('' for id 0)
  private readonly dv: DataView;
  private readonly byName = new Map<string, number>();
  private readonly files = new Map<number, Uint8Array>();
  private readonly banks = new Map<number, (string | null)[]>();

  constructor(rom: Uint8Array) {
    this.rom = rom;
    this.data = inflate1173(rom, DATA_ROM);
    this.dv = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
    for (let i = 0; i <= FILE_COUNT; i++) this.offsets.push(this.u32(FILE_TABLE + i * 4));
    const rv = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
    for (let i = 0; i < FILE_COUNT; i++) {
      let name = '';
      if (i > 0) for (let p = NAME_TABLE_ROM + rv.getUint32(NAME_TABLE_ROM + i * 4); p < rom.length && rom[p]; p++) name += String.fromCharCode(rom[p]);
      this.names.push(name);
      if (name) this.byName.set(name, i);
    }
  }

  // ---- data segment by virtual address ----
  u8(a: number) { return this.data[a - DATA_VADDR]; }
  u16(a: number) { return this.dv.getUint16(a - DATA_VADDR); }
  s16(a: number) { return this.dv.getInt16(a - DATA_VADDR); }
  u32(a: number) { return this.dv.getUint32(a - DATA_VADDR); }
  s32(a: number) { return this.dv.getInt32(a - DATA_VADDR); }
  f32(a: number) { return this.dv.getFloat32(a - DATA_VADDR); }

  // ---- files (§2.2) ----
  fileId(name: string): number { return this.byName.get(name) ?? 0; }
  fileRom(id: number): number { return this.offsets[id] ?? 0; }
  fileSize(id: number): number { return id > 0 && id < FILE_COUNT ? this.offsets[id + 1] - this.offsets[id] : 0; }
  hasFile(id: number): boolean { return this.fileSize(id) > 0; }
  /**
   * File contents: inflated when the file is one 1173 stream (setups, pads, tiles, models, text), else the raw ROM bytes
   * (BG .seg files hold their own streams). Inflated files are cached: callers must copy what they keep in a Level.
   */
  file(id: number): Uint8Array {
    const size = this.fileSize(id);
    if (size <= 0) throw new Error(`Perfect Dark: file ${id} (${this.names[id] ?? '?'}) is empty`);
    const at = this.offsets[id];
    if (this.rom[at] !== 0x11 || this.rom[at + 1] !== 0x73) return this.rom.subarray(at, at + size);
    let f = this.files.get(id);
    if (!f) this.files.set(id, (f = inflate1173(this.rom, at)));
    return f;
  }

  // ---- text (§3.4) ----
  /** The English string of a text id, without trailing newlines; null when absent. */
  text(id: number): string | null {
    const bank = id >> 9;
    if (bank <= 0 || bank >= TEXT_BANK_COUNT) return null;
    const s = this.bank(this.u16(TEXT_BANK_FILES + bank * 2))[id & 0x1ff];
    return s == null ? null : s.replace(/\n+$/, '');
  }

  /** A text bank: u32 offsets (0 = no string; the count is the smallest non-zero offset / 4), NUL-terminated strings. */
  private bank(fileId: number): (string | null)[] {
    let t = this.banks.get(fileId);
    if (t) return t;
    t = [];
    if (this.hasFile(fileId)) {
      const b = this.file(fileId), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      let min = b.length;
      for (let i = 0; 4 * i + 4 <= Math.min(min, b.length); i++) {
        const o = dv.getUint32(4 * i);
        if (o && o < min) min = o;
      }
      for (let i = 0; 4 * i < min; i++) {
        const o = dv.getUint32(4 * i);
        let s = '';
        if (o) for (let k = o; k < b.length && b[k]; k++) s += String.fromCharCode(b[k]);
        t.push(o ? s : null);
      }
    }
    this.banks.set(fileId, t);
    return t;
  }

  // ---- stages and menus (§3.1) ----
  stages(): StageRecord[] {
    return Array.from({ length: STAGE_COUNT }, (_, index) => {
      const a = STAGE_TABLE + index * 0x38;
      return {
        index, address: a, id: this.s16(a), bg: this.u16(a + 8), tiles: this.u16(a + 0x0a), pads: this.u16(a + 0x0c),
        setup: this.u16(a + 0x0e), mpSetup: this.u16(a + 0x10), worldScale: this.f32(a + 0x18),
      };
    });
  }

  stage(id: number): StageRecord | undefined {
    return this.stages().find((s) => s.id === id);
  }

  soloMissions(): SoloMission[] {
    return Array.from({ length: SOLO_COUNT }, (_, index) => {
      const a = SOLO_MISSIONS + index * 12;
      return { index, stage: this.u32(a), name: this.u16(a + 6), subtitle: this.u16(a + 8), shortName: this.u16(a + 10) };
    });
  }

  missionGroups(): MenuGroup[] {
    return Array.from({ length: MISSION_GROUP_COUNT }, (_, i) => ({ first: this.u32(MISSION_GROUPS + i * 8), text: this.u16(MISSION_GROUPS + i * 8 + 4) }));
  }

  arenas(): Arena[] {
    return Array.from({ length: ARENA_COUNT }, (_, index) => {
      const a = ARENAS + index * 6;
      return { index, stage: this.u16(a), unlock: this.u8(a + 2), name: this.u16(a + 4) };
    });
  }

  arenaGroups(): MenuGroup[] {
    return Array.from({ length: ARENA_GROUP_COUNT }, (_, i) => ({ first: this.u32(ARENA_GROUPS + i * 8), text: this.u16(ARENA_GROUPS + i * 8 + 4) }));
  }
}
