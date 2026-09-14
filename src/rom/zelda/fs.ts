// Zelda 64 filesystem (docs/ZELDA64.md §1-§3): the `zelda@` build string, the dmadata file table after it, Yaz0 and the
// Master Quest debug ROM's file name table. Game data addresses files by VROM ({vromStart, vromEnd} pairs).

export interface ZeldaBuild {
  offset: number; // ROM offset of "zelda@"
  builder: string; // e.g. "zelda@srd44"
  date: string; // e.g. "98-10-21 04:56:31"
  dmadata: number; // ROM offset of the file table
}

export interface ZeldaFile {
  index: number;
  vromStart: number;
  vromEnd: number;
  romStart: number; // 0xFFFFFFFF: absent from this ROM
  romEnd: number; // 0: stored uncompressed
}

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

// The build string "zelda@<builder>\0<date>" followed within 0x100 bytes by the file table, whose first record is
// makerom's {0, 0x1060, 0, 0}.
export function findZeldaBuild(rom: Uint8Array): ZeldaBuild | null {
  const limit = Math.min(rom.length - 0x140, 0x400000);
  for (let i = 0x1000; i < limit; i++) {
    if (rom[i] !== 0x7a || rom[i + 1] !== 0x65 || rom[i + 2] !== 0x6c || rom[i + 3] !== 0x64 || rom[i + 4] !== 0x61 || rom[i + 5] !== 0x40) continue;
    const text = (from: number) => {
      let s = '';
      for (let k = from; k < from + 32 && rom[k] >= 0x20 && rom[k] < 0x7f; k++) s += String.fromCharCode(rom[k]);
      return s;
    };
    const builder = text(i);
    let d = i + builder.length;
    while (d < i + 0x30 && rom[d] === 0) d++;
    const date = text(d);
    for (let t = (i + 3) & ~3; t < i + 0x100; t += 4) {
      if (u32(rom, t) === 0 && u32(rom, t + 4) === 0x1060 && u32(rom, t + 8) === 0 && u32(rom, t + 12) === 0) {
        return { offset: i, builder, date, dmadata: t };
      }
    }
  }
  return null;
}

// Yaz0: "Yaz0", u32 decompressed size, 8 reserved bytes, then groups of a code byte (MSB first: 1 = literal byte,
// 0 = back-reference b1 b2 [b3]: distance ((b1 & 0xF) << 8 | b2) + 1, length (b1 >> 4) + 2 or b3 + 0x12).
export function yaz0(src: Uint8Array, offset: number, end = src.length): Uint8Array {
  const size = u32(src, offset + 4);
  const out = new Uint8Array(size);
  let s = offset + 16, d = 0, code = 0, bits = 0;
  while (d < size && s < end) {
    if (bits === 0) {
      code = src[s++];
      bits = 8;
    }
    if (code & 0x80) {
      out[d++] = src[s++];
    } else {
      const b1 = src[s++], b2 = src[s++];
      const dist = (((b1 & 0x0f) << 8) | b2) + 1;
      const len = b1 >> 4 ? (b1 >> 4) + 2 : src[s++] + 0x12;
      for (let k = 0; k < len && d < size; k++, d++) out[d] = d >= dist ? out[d - dist] : 0;
    }
    code = (code << 1) & 0xff;
    bits--;
  }
  return out;
}

const CACHE_BUDGET = 48 << 20;

export class ZeldaFs {
  readonly files: ZeldaFile[] = [];
  private readonly byVrom = new Map<number, ZeldaFile>();
  private readonly cache = new Map<number, Uint8Array>();
  private cached = 0;
  private names: string[] | null = null;

  constructor(readonly rom: Uint8Array, readonly build: ZeldaBuild) {
    for (let i = 0; build.dmadata + (i + 1) * 16 <= rom.length && i < 4096; i++) {
      const o = build.dmadata + i * 16;
      const f: ZeldaFile = { index: i, vromStart: u32(rom, o), vromEnd: u32(rom, o + 4), romStart: u32(rom, o + 8), romEnd: u32(rom, o + 12) };
      if (i > 0 && f.vromStart === 0 && f.vromEnd === 0) break;
      this.files.push(f);
      if (i > 0 && !this.byVrom.has(f.vromStart)) this.byVrom.set(f.vromStart, f);
    }
  }

  present(f: ZeldaFile) {
    return f.romStart !== 0xffffffff && f.vromEnd > f.vromStart;
  }

  // The file with exactly this VROM range (and present in the ROM), else null.
  fileAt(vromStart: number, vromEnd: number): ZeldaFile | null {
    const f = this.byVrom.get(vromStart);
    return f && f.vromEnd === vromEnd && this.present(f) ? f : null;
  }

  fileByVrom(vromStart: number): ZeldaFile | null {
    const f = this.byVrom.get(vromStart);
    return f && this.present(f) ? f : null;
  }

  size(f: ZeldaFile) {
    return f.vromEnd - f.vromStart;
  }

  // Decompressed file contents (a view into the ROM for uncompressed files). Do not modify.
  data(f: ZeldaFile): Uint8Array {
    const hit = this.cache.get(f.index);
    if (hit) return hit;
    if (!this.present(f)) throw new Error(`file ${f.index} is not in this ROM`);
    const size = this.size(f);
    let out: Uint8Array;
    if (f.romEnd === 0) {
      out = this.rom.subarray(f.romStart, Math.min(this.rom.length, f.romStart + size));
    } else {
      if (f.romEnd > this.rom.length || u32(this.rom, f.romStart) !== 0x59617a30) throw new Error(`file ${f.index}: bad Yaz0 data`);
      out = yaz0(this.rom, f.romStart, f.romEnd);
      if (this.cached + out.length > CACHE_BUDGET) {
        this.cache.clear();
        this.cached = 0;
      }
      this.cached += out.length;
    }
    this.cache.set(f.index, out);
    return out;
  }

  // File names: only the OoT Master Quest debug ROM has them, as a table of string pointers in boot (the pointer to
  // "makerom", then one per file). boot is loaded at entry point + 0x60.
  name(index: number): string | undefined {
    if (this.names === null) {
      this.names = [];
      const boot = this.files[1] && this.present(this.files[1]) ? this.data(this.files[1]) : null;
      const at = boot ? findString(boot, 'makerom') : -1;
      if (boot && at >= 0) {
        const load = (u32(this.rom, 8) + 0x60) >>> 0;
        const ptr = (load + at) >>> 0;
        for (let t = 0; t + 4 <= boot.length; t += 4) {
          if (u32(boot, t) !== ptr) continue;
          for (let k = 0; k < this.files.length && t + (k + 1) * 4 <= boot.length; k++) {
            const o = u32(boot, t + k * 4) - load;
            if (o < 0 || o >= boot.length) break;
            let s = '';
            for (let q = o; q < boot.length && boot[q] >= 0x20 && boot[q] < 0x7f && s.length < 64; q++) s += String.fromCharCode(boot[q]);
            this.names.push(s);
          }
          break;
        }
      }
    }
    return this.names[index];
  }
}

function findString(b: Uint8Array, s: string): number {
  outer: for (let i = 0; i + s.length < b.length; i++) {
    for (let k = 0; k < s.length; k++) if (b[i + k] !== s.charCodeAt(k)) continue outer;
    if (b[i + s.length] === 0) return i;
  }
  return -1;
}
