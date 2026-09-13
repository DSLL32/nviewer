// Pilotwings 64 filesystem reader. No dependencies.
//
// ROM layout (verified, notes/fs.md): a FORM UVRM file holds a GZIP(MIO0)-compressed TABL of {char[4] type, u32 size};
// files follow from the FS base (link-time constant, first FORM after UVRM): offset(i) = base + sum(size[0..i-1]).
// Every file is IFF-like: 'FORM' u32 size type { tag u32 size data }*. A 'GZIP' chunk wraps
// { inner tag, u32 decompressed size, MIO0 stream }. Files are padded to 4 bytes (TABL sizes include the padding).
//
// Game addressing (kernel uvMemInitBlockHdr 0x802246A0 US):
//  - UV* types: per-type index (UVMD[i], UVTX[i], ...). Single-file types (UVEN, UVLV, UVTR, UVSQ, UVTP, UVLT) are
//    addressed by COMM-chunk ordinal inside their one file (uvFile_80224170 skips to the n-th COMM).
//  - any other tag (UPWL, UPWT, ADAT, SPTH, 3VUE, PDAT, ...) goes into one shared "user file" index.

export interface PwChunk {
  tag: string;
  offset: number; // ROM offset of the chunk header
  size: number; // decompressed size
  storedSize: number; // bytes in ROM (chunk payload)
  compressed: boolean;
  ordinal: number; // n-th chunk with this tag in the file
}

export interface PwFile {
  index: number; // TABL index
  type: string;
  typeIndex: number; // n-th file of this type
  userIndex: number; // user-file index (-1 for UV* engine types)
  offset: number; // ROM offset of 'FORM'
  tablSize: number; // size in TABL (FORM size + 8, padded to 4)
  formSize: number;
}

export interface PwFs {
  rom: Uint8Array;
  gameCode: string;
  uvrmOffset: number;
  base: number;
  end: number;
  files: PwFile[];
  byType: Map<string, PwFile[]>;
  userFiles: PwFile[];
}

export const UV_TYPES = new Set(['UVSY', 'UVMD', 'UVCT', 'UVTX', 'UVEN', 'UVLT', 'UVTR', 'UVSQ', 'UVLV', 'UVAN', 'UVFT', 'UVBT', 'UVSX', 'UVTP']);

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const tag4 = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/** Byte-order normalisation for .z64/.v64/.n64 dumps. */
export function normalizeRom(src: Uint8Array): Uint8Array {
  const m = u32(src, 0);
  if (m === 0x80371240) return src;
  const out = new Uint8Array(src.length);
  if (m === 0x37804012) {
    for (let i = 0; i + 1 < src.length; i += 2) { out[i] = src[i + 1]; out[i + 1] = src[i]; }
    return out;
  }
  if (m === 0x40123780) {
    for (let i = 0; i + 3 < src.length; i += 4) { out[i] = src[i + 3]; out[i + 1] = src[i + 2]; out[i + 2] = src[i + 1]; out[i + 3] = src[i]; }
    return out;
  }
  throw new Error('not an N64 ROM');
}

/** Plain Nintendo MIO0 (the game's mio0_decompress, US 0x80231A20). `o` points at "MIO0". */
export function mio0(b: Uint8Array, o: number): Uint8Array {
  if (tag4(b, o) !== 'MIO0') throw new Error(`no MIO0 at 0x${o.toString(16)}`);
  const size = u32(b, o + 4);
  let bp = o + u32(b, o + 8);
  let lp = o + u32(b, o + 12);
  let cp = o + 16;
  const out = new Uint8Array(size);
  let pos = 0;
  let bits = 0;
  let word = 0;
  while (pos < size) {
    if (bits === 0) { word = u32(b, cp); cp += 4; bits = 32; }
    if (word & 0x80000000) {
      out[pos++] = b[lp++];
    } else {
      const v = (b[bp] << 8) | b[bp + 1];
      bp += 2;
      let n = (v >> 12) + 3;
      let s = pos - ((v & 0xfff) + 1);
      if (s < 0) throw new Error('MIO0 back-reference before start');
      while (n-- > 0 && pos < size) out[pos++] = out[s++];
    }
    word = (word << 1) >>> 0;
    bits--;
  }
  return out;
}

/** Chunk list of the FORM at `offset` (no decompression). */
export function listChunks(rom: Uint8Array, offset: number): { type: string; formSize: number; chunks: PwChunk[] } {
  if (tag4(rom, offset) !== 'FORM') throw new Error(`no FORM at 0x${offset.toString(16)}`);
  const formSize = u32(rom, offset + 4);
  const type = tag4(rom, offset + 8);
  const end = offset + 8 + formSize;
  const chunks: PwChunk[] = [];
  const ord = new Map<string, number>();
  let p = offset + 12;
  while (p < end) {
    let tag = tag4(rom, p);
    const stored = u32(rom, p + 4);
    if (p + 8 + stored > end) throw new Error(`chunk overruns FORM at 0x${p.toString(16)}`);
    let size = stored;
    const compressed = tag === 'GZIP';
    if (compressed) { tag = tag4(rom, p + 8); size = u32(rom, p + 12); }
    const n = ord.get(tag) ?? 0;
    ord.set(tag, n + 1);
    chunks.push({ tag, offset: p, size, storedSize: stored, compressed, ordinal: n });
    p += 8 + stored;
  }
  if (p !== end) throw new Error(`chunk walk mismatch in FORM at 0x${offset.toString(16)}`);
  return { type, formSize, chunks };
}

/** Chunk payload, decompressed if needed. */
export function chunkData(rom: Uint8Array, c: PwChunk): Uint8Array {
  if (!c.compressed) return rom.subarray(c.offset + 8, c.offset + 8 + c.size);
  const d = mio0(rom, c.offset + 16);
  if (d.length !== c.size) throw new Error('GZIP size mismatch');
  return d;
}

export function openFs(romIn: Uint8Array): PwFs {
  const rom = normalizeRom(romIn);
  const gameCode = tag4(rom, 0x3b);
  let uvrm = -1;
  for (let o = 0x1000; o + 12 <= rom.length; o += 4) {
    if (rom[o] === 0x46 && tag4(rom, o) === 'FORM' && tag4(rom, o + 8) === 'UVRM') { uvrm = o; break; }
  }
  if (uvrm < 0) throw new Error('UVRM not found');
  const u = listChunks(rom, uvrm);
  const tc = u.chunks.find((c) => c.tag === 'TABL');
  if (!tc) throw new Error('TABL not found');
  const tabl = chunkData(rom, tc);
  const entries: [string, number][] = [];
  for (let i = 0; i + 8 <= tabl.length; i += 8) entries.push([tag4(tabl, i), u32(tabl, i + 4)]);
  const first = entries.find((e) => e[0] !== '\0\0\0\0');
  if (!first) throw new Error('empty TABL');
  const uvrmEnd = uvrm + 8 + u.formSize;
  let base = -1;
  for (let o = (uvrmEnd + 3) & ~3; o < uvrmEnd + 0x1000; o += 4) {
    if (tag4(rom, o) === 'FORM' && tag4(rom, o + 8) === first[0]) { base = o; break; }
  }
  if (base < 0) throw new Error('FS base not found');
  const files: PwFile[] = [];
  const byType = new Map<string, PwFile[]>();
  const userFiles: PwFile[] = [];
  let off = base;
  entries.forEach(([type, size], index) => {
    if (type !== '\0\0\0\0') {
      const list = byType.get(type) ?? [];
      const f: PwFile = {
        index, type, typeIndex: list.length, userIndex: UV_TYPES.has(type) ? -1 : userFiles.length, offset: off, tablSize: size,
        formSize: u32(rom, off + 4),
      };
      if (tag4(rom, off) !== 'FORM' || tag4(rom, off + 8) !== type) throw new Error(`file ${index} (${type}) not at 0x${off.toString(16)}`);
      list.push(f);
      byType.set(type, list);
      if (f.userIndex >= 0) userFiles.push(f);
      files.push(f);
    }
    off += size;
  });
  return { rom, gameCode, uvrmOffset: uvrm, base, end: off, files, byType, userFiles };
}

/** n-th file of an engine type, e.g. file(fs, 'UVMD', 12). */
export function file(fs: PwFs, type: string, index: number): PwFile | undefined {
  return fs.byType.get(type)?.[index];
}

/** User file by game user-file index (uvUserFileRead). */
export function userFile(fs: PwFs, index: number): PwFile | undefined {
  return fs.userFiles[index];
}

/** Record of a single-file type by id (COMM ordinal), e.g. comm(fs, 'UVLV', 5) = Little States level list. */
export function comm(fs: PwFs, type: string, id: number): Uint8Array | undefined {
  const f = fs.byType.get(type)?.[0];
  if (!f) return undefined;
  const c = listChunks(fs.rom, f.offset).chunks.find((x) => x.tag === 'COMM' && x.ordinal === id);
  return c ? chunkData(fs.rom, c) : undefined;
}

/** All chunks of a file with data. */
export function readFile(fs: PwFs, f: PwFile): { tag: string; data: Uint8Array; chunk: PwChunk }[] {
  return listChunks(fs.rom, f.offset).chunks.map((c) => ({ tag: c.tag, data: chunkData(fs.rom, c), chunk: c }));
}

/** Object-oriented facade used by the higher-level format parsers. */
export class PwRom {
  readonly fs: PwFs;
  readonly rom: Uint8Array;
  readonly gameCode: string;
  readonly files: PwFile[];
  readonly byType: Map<string, PwFile[]>;
  private readonly chunkCache = new Map<number, { tag: string; data: Uint8Array; compressed: boolean }[]>();

  constructor(bytes: Uint8Array) {
    this.fs = openFs(bytes);
    this.rom = this.fs.rom;
    this.gameCode = this.fs.gameCode;
    this.files = this.fs.files;
    this.byType = this.fs.byType;
  }

  chunks(offset: number): { tag: string; data: Uint8Array; compressed: boolean }[] {
    let result = this.chunkCache.get(offset);
    if (result) return result;
    result = listChunks(this.rom, offset).chunks.map((chunk) => ({
      tag: chunk.tag,
      data: chunkData(this.rom, chunk),
      compressed: chunk.compressed,
    }));
    this.chunkCache.set(offset, result);
    return result;
  }

  /** All COMM records in the n-th file of an engine type. */
  comm(type: string, index: number): Uint8Array[] {
    const f = this.byType.get(type)?.[index];
    if (!f) throw new Error(`${type} ${index} missing`);
    return this.chunks(f.offset).filter((chunk) => chunk.tag === 'COMM').map((chunk) => chunk.data);
  }

  count(type: string): number { return this.byType.get(type)?.length ?? 0; }
}
