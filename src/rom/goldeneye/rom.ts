// GoldenEye 007 (U): the compressed data segment, the file table, text banks and the stage tables (docs/GOLDENEYE.md §1-§2).
//
// The game code is uncompressed but TLB-mapped; every table lives in one "1172" stream (two tag bytes + raw DEFLATE)
// that boot inflates to 0x80020D90. Accessors here take those virtual addresses.
import { inflateRaw } from '../inflate';

export const DATA_ROM = 0x21990; // 1172 stream → DATA_VADDR
export const DATA_VADDR = 0x80020d90;
const DATA_SIZE = 0x3c550;
const FILE_TABLE = 0x80046054; // 12 bytes {u32 index; char* name; u32 romOffset}; size = next offset - own
const FILE_COUNT = 727; // record 726 is ob/ob_end.seg (size 0, end marker)
const TEXT_BANKS = 0x800484d4; // 45 x {char* english; char* japanese}; text id = bank << 10 | index
const SETUP_NAMES = 0x800374e4; // char* per stage id ("Usetup<code>Z")
const STAGE_BG = 0x8004448c; // 38 x {u32 stage; char* bg; char* stan; f32 f0C, f10, f14}
const STAGE_BG_COUNT = 38;
const MISSION_FOLDERS = 0x8002abe4; // 28 bytes, label NULL ends
const MP_MAPS = 0x8002b074; // 12 x 24 bytes, in menu order
const MP_MAP_COUNT = 12;
const TEXTURE_TABLE = 0x80049300; // 8 bytes {u8 flags; u24 size; u32 0}
const TEXTURE_DATA_ROM = 0x8f7df0; // texture i starts after the sizes of textures 0..i-1
export const TEXTURE_COUNT = 2698;

/** Inflates a "11 72" + raw DEFLATE stream (no size field; outSize 0 grows as needed). */
export function inflate1172(buf: Uint8Array, offset: number, outSize = 0): Uint8Array {
  if (buf[offset] !== 0x11 || buf[offset + 1] !== 0x72) throw new Error(`no 1172 stream at 0x${offset.toString(16)}`);
  return inflateRaw(buf, offset + 2, outSize);
}

export interface GeFile {
  index: number;
  name: string;
  rom: number;
  size: number; // bytes in ROM (compressed size for 1172 files)
}

// Stage → BG and clipping file with the three scales (§3.7): world units = BG units / scale; render units = world x
// renderScale.
export interface StageBg {
  stage: number;
  bg: string; // "bg/bg_dam_all_p.seg"
  stan: string; // "Tbg_dam_all_p_stanZ"
  scale: number; // f0C
  renderScale: number; // f10
  f14: number;
}

export interface MissionFolder {
  label: string; // "1" for mission headers, "i", "ii" … for parts
  name: string; // "Arkangelsk", "Dam", "Launch Silo #4"
  shortName: string | null; // "Silo" (parts with a second name)
  stage: number; // -1 for headers
  mission: number;
  header: boolean;
  part: number; // unlock index, -1 for headers
  briefing: string | null;
}

export interface MpMap {
  name: string; // "Temple"
  stage: number; // -1 for Random
  unlockAfterPart: number;
  maxPlayers: number;
}

export interface GeTextureEntry {
  index: number;
  flags: number; // table flag byte (meaning not decoded)
  rom: number;
  size: number;
}

export class GeRom {
  readonly rom: Uint8Array;
  readonly data: Uint8Array;
  readonly files: GeFile[] = [];
  private readonly dv: DataView;
  private readonly byName = new Map<string, GeFile>();
  private readonly banks = new Map<string, (string | null)[]>();
  private textureTable: GeTextureEntry[] | null = null;

  constructor(rom: Uint8Array) {
    this.rom = rom;
    this.data = inflate1172(rom, DATA_ROM, DATA_SIZE);
    this.dv = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
    for (let i = 0; i < FILE_COUNT; i++) {
      const a = FILE_TABLE + i * 12, name = this.u32(a + 4), at = this.u32(a + 8);
      const f: GeFile = { index: this.u32(a), name: name ? this.str(name) : '', rom: at, size: i + 1 < FILE_COUNT ? this.u32(a + 20) - at : 0 };
      this.files.push(f);
      if (f.name) this.byName.set(f.name, f);
    }
  }

  // ---- data segment by virtual address ----
  inData(a: number) { return a >= DATA_VADDR && a < DATA_VADDR + this.data.length; }
  u8(a: number) { return this.data[a - DATA_VADDR]; }
  u16(a: number) { return this.dv.getUint16(a - DATA_VADDR); }
  s16(a: number) { return this.dv.getInt16(a - DATA_VADDR); }
  u32(a: number) { return this.dv.getUint32(a - DATA_VADDR); }
  s32(a: number) { return this.dv.getInt32(a - DATA_VADDR); }
  f32(a: number) { return this.dv.getFloat32(a - DATA_VADDR); }
  str(a: number) {
    let s = '';
    for (let o = a - DATA_VADDR; o < this.data.length && this.data[o]; o++) s += String.fromCharCode(this.data[o]);
    return s;
  }

  // ---- files (§1.5) ----
  file(name: string): GeFile | undefined { return this.byName.get(name); }
  hasFile(name: string) { return (this.byName.get(name)?.size ?? 0) > 0; }
  /** File contents: inflated when the file is a 1172 stream (names ending in Z, text banks), raw otherwise (BG). */
  load(name: string): Uint8Array {
    const f = this.byName.get(name);
    if (!f || f.size <= 0) throw new Error(`GoldenEye: no file ${name}`);
    return this.rom[f.rom] === 0x11 && this.rom[f.rom + 1] === 0x72 ? inflate1172(this.rom, f.rom) : this.rom.subarray(f.rom, f.rom + f.size);
  }

  // ---- text (§1.6): offset table + NUL-terminated strings, offset 0 = no string ----
  text(bankFile: string): (string | null)[] {
    let t = this.banks.get(bankFile);
    if (!t) {
      t = [];
      if (this.hasFile(bankFile)) {
        const b = this.load(bankFile), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
        const n = b.length >= 4 ? dv.getUint32(0) / 4 : 0;
        for (let i = 0; i < n && 4 * i + 4 <= b.length; i++) {
          const o = dv.getUint32(4 * i);
          let s = '';
          if (o) for (let k = o; k < b.length && b[k]; k++) s += String.fromCharCode(b[k]);
          t.push(o ? s : null);
        }
      }
      this.banks.set(bankFile, t);
    }
    return t;
  }
  /** English string of a text id, without the trailing newline. */
  textById(id: number): string | null {
    const bank = id >> 10;
    const p = bank > 0 && bank < 45 ? this.u32(TEXT_BANKS + bank * 8) : 0;
    const s = p ? this.text(this.str(p))[id & 0x3ff] : null;
    return s == null ? null : s.replace(/\n$/, '');
  }

  // ---- stages (§2.1) ----
  stageBg(stage: number): StageBg | undefined {
    for (let i = 0; i < STAGE_BG_COUNT; i++) {
      const a = STAGE_BG + i * 24;
      if (this.u32(a) !== stage) continue;
      return { stage, bg: this.str(this.u32(a + 4)), stan: this.str(this.u32(a + 8)), scale: this.f32(a + 12), renderScale: this.f32(a + 16), f14: this.f32(a + 20) };
    }
    return undefined;
  }
  /** Solo setup file named for a stage; multiplayer setups are "Ump_" + name[1:]. */
  setupName(stage: number): string | null {
    const p = stage >= 0 && stage < 0x3a ? this.u32(SETUP_NAMES + 4 * stage) : 0;
    return p ? this.str(p) : null;
  }
  missionFolders(): MissionFolder[] {
    const out: MissionFolder[] = [];
    for (let a = MISSION_FOLDERS; this.u32(a); a += 28) {
      const alt = this.u16(a + 6);
      out.push({
        label: this.str(this.u32(a)), name: this.textById(this.u16(a + 4)) ?? '?', shortName: alt ? this.textById(alt) : null,
        stage: this.s32(a + 8), mission: this.s32(a + 12), header: this.s32(a + 16) !== 0, part: this.s32(a + 20),
        briefing: this.u32(a + 24) ? this.str(this.u32(a + 24)) : null,
      });
    }
    return out;
  }
  mpMaps(): MpMap[] {
    return Array.from({ length: MP_MAP_COUNT }, (_, i) => {
      const a = MP_MAPS + i * 24;
      return { name: this.textById(this.u16(a)) ?? '?', stage: this.s32(a + 8), unlockAfterPart: this.s32(a + 12), maxPlayers: this.s32(a + 20) };
    });
  }

  // ---- textures (§3.4): the table stores each entry's size; boot turns them into running offsets ----
  textureEntries(): GeTextureEntry[] {
    if (!this.textureTable) {
      const t: GeTextureEntry[] = [];
      for (let i = 0, at = TEXTURE_DATA_ROM; i < TEXTURE_COUNT; i++) {
        const w = this.u32(TEXTURE_TABLE + i * 8), size = w & 0xffffff;
        t.push({ index: i, flags: w >>> 24, rom: at, size });
        at += size;
      }
      this.textureTable = t;
    }
    return this.textureTable;
  }
}
