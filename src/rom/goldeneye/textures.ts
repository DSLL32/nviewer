// GoldenEye textures: the global table of 2,698 entries in two codec families, decoded to level-0 RGBA
// (docs/GOLDENEYE.md §3.4). A port of the game's loader 0x7F0CBC18, verified texel-exact against RAM; only level 0 is
// decoded (mip levels are stored after it or generated from it and never change it).
//
// Entry byte 0: bit 6 = zlib path (CI formats), bit 7 = all mip levels stored, low 6 bits = level count.
//   zlib path (0x7F0C6658):     u8 format; u8 paletteCount - 1; u16 palette[]; per level u8 w, h + a 1172 stream
//   bit-packed path (0x7F0C7DFC): per level read4 format, read8 w, read8 h, read4 codec; codecs 0..9
// Internal formats: 0 RGBA32, 1 RGBA16, 2 RGB24, 3 RGB15, 4 IA16, 5 IA8, 6 IA4, 7 I8, 8 I4, 9 CI8/RGBA16, 10 CI4/RGBA16,
// 11 CI8/IA16, 12 CI4/IA16. The decoders run inside a large stack frame and some read past their arrays (odd-width
// nibble packing, 11-bit palette counts), so that frame is emulated as one flat big-endian byte array.
import type { RareTexture } from '../displaylist';
import { inflateRaw } from '../inflate';
import type { Texture, WrapMode } from '../types';
import type { GeRom, GeTextureEntry } from './rom';

// Format tables in the data segment 0x80049178.. (index = internal format).
const FMT_CHANNELS = [4, 3, 3, 3, 2, 2, 1, 1, 1, 1, 1, 1, 1];
const FMT_RAW_ALPHA = [0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
const FMT_SYMBOLS = [0x100, 0x20, 0x100, 0x20, 0x100, 0x10, 8, 0x100, 0x10, 0x100, 0x10, 0x100, 0x10];
const FMT_BPP = [32, 16, 24, 15, 16, 8, 4, 8, 4, 16, 16, 16, 16];
export const FORMAT_NAMES = ['RGBA32', 'RGBA16', 'RGB24', 'RGB15', 'IA16', 'IA8', 'IA4', 'I8', 'I4', 'CI8/RGBA16', 'CI4/RGBA16', 'CI8/IA16', 'CI4/IA16'];

// Big-endian memory: out-of-range reads give 0, writes are dropped.
const g8 = (m: Uint8Array, o: number) => m[o] ?? 0;
const g16 = (m: Uint8Array, o: number) => (g8(m, o) << 8) | g8(m, o + 1);
const g32 = (m: Uint8Array, o: number) => ((g8(m, o) << 24) | (g8(m, o + 1) << 16) | (g8(m, o + 2) << 8) | g8(m, o + 3)) >>> 0;
const s8 = (m: Uint8Array, o: number, v: number) => { if (o >= 0 && o < m.length) m[o] = v & 0xff; };
const s16 = (m: Uint8Array, o: number, v: number) => { s8(m, o, v >>> 8); s8(m, o + 1, v); };
const s32 = (m: Uint8Array, o: number, v: number) => { s16(m, o, v >>> 16); s16(m, o + 2, v); };

const pad4 = (w: number) => (w + 3) & 0xffc;
const pad8 = (w: number) => (w + 7) & 0xff8;
const pad16 = (w: number) => (w + 15) & 0xff0;

// MSB-first bit reader (0x7F0CBF2C).
class BitReader {
  private buf = 0;
  private cnt = 0;
  constructor(private readonly d: Uint8Array, public p: number) {}
  read(n: number): number {
    while (this.cnt < n) {
      this.buf = ((this.buf << 8) | g8(this.d, this.p++)) >>> 0;
      this.cnt += 8;
    }
    this.cnt -= n;
    return (this.buf >>> this.cnt) & ((1 << n) - 1);
  }
}

// The emulated stack frame of 0x7F0C7DFC (12,456 bytes) plus slack for overruns.
const FRAME_SIZE = 12456 + 0x20000;
const FRAME_PAL = 168; // palette
const FRAME_BUF = 4264; // planar symbol scratch

// 0x7F0C91D0: Huffman. nsym 8-bit frequencies, a tree built in place (leaves = index + 10000, frequency 9999 =
// consumed, two-slot minimum search with the game's tie rules), then n symbols (bytes, or u16 when nsym > 256).
function huffman(br: BitReader, m: Uint8Array, dst: number, n: number, nsym: number) {
  const F = new Uint16Array(2048); // beyond nsym: stack bytes, emulated as 0
  const node = new Int16Array(4096).fill(-1);
  for (let i = 0; i < nsym; i++) F[i] = br.read(8);
  let a2 = 9999, a3 = 0, t0 = 9999, t1 = 0;
  const scan = () => {
    for (let i = 0; i < nsym; i++) {
      const v = F[i];
      if (v < t0) {
        if (a2 < t0) { t0 = v; t1 = i; } else { a2 = v; a3 = i; }
      } else if (v < a2) {
        a2 = v; a3 = i;
      }
    }
  };
  scan();
  const leaf = (k: number) => node[k * 2] < 0 && node[k * 2 + 1] < 0;
  let root = 0;
  for (let guard = 0; ; guard++) {
    let sum = (F[a3] + F[t1]) & 0xffff;
    t0 = 9999;
    a2 = 9999;
    if (sum === 0) sum = 1;
    F[t1] = 9999;
    F[a3] = 9999;
    if (leaf(t1)) {
      node[t1 * 2] = t1 + 10000;
      root = t1;
      F[t1] = sum;
      node[t1 * 2 + 1] = leaf(a3) ? a3 + 10000 : a3;
    } else if (leaf(a3)) {
      node[a3 * 2] = a3 + 10000;
      root = a3;
      F[a3] = sum;
      node[a3 * 2 + 1] = leaf(t1) ? t1 + 10000 : t1;
    } else {
      let s = 0; // the first freed leaf slot
      while (!(leaf(s) && F[s] >= 9999)) if (++s >= 2048) throw new Error('huffman: no free node');
      root = s;
      F[s] = sum;
      node[s * 2] = t1;
      node[s * 2 + 1] = a3;
    }
    scan();
    if (t0 === 9999 || a2 === 9999) break;
    if (guard > 5000) throw new Error('huffman: build loop');
  }
  for (let i = 0; i < n; i++) {
    let s = root;
    while (s < 10000) {
      if (s < 0 || s >= 2048) throw new Error('huffman: walked off the tree');
      s = node[s * 2 + br.read(1)];
    }
    if (nsym < 257) m[dst + i] = (s - 10000) & 0xff;
    else s16(m, dst + i * 2, s - 10000);
  }
}

// 0x7F0C96BC: LZ. Header: offset bits (3), length bits (3), literal bits (4); flag 0 = literal, 1 = match followed by
// an implicit literal. u16 symbols when literal bits ≥ 9.
function lz(br: BitReader, m: Uint8Array, dst: number, n: number) {
  const ob = br.read(3), lb = br.read(3), sb = br.read(4);
  let minLen = 0;
  for (let v = ob + lb + sb + 1; v > 0; v -= sb + 1) minLen++;
  const wide = sb >= 9;
  for (let i = 0; i < n; i++) {
    if (br.read(1) === 0) {
      if (wide) s16(m, dst + i * 2, br.read(sb));
      else m[dst + i] = br.read(sb);
      continue;
    }
    const from = i - br.read(ob) - 1, len = br.read(lb) + minLen;
    if (wide) {
      for (let k = from; k < from + len; k++) s16(m, dst + 2 * i++, g16(m, dst + 2 * k));
      s16(m, dst + 2 * i, br.read(sb));
    } else {
      for (let k = from; k < from + len; k++) m[dst + i++] = g8(m, dst + k);
      m[dst + i] = br.read(sb);
    }
  }
}

// 0x7F0C9920: 11-bit count, then entries of bpp bits (u16 up to 16 bits, u32 above).
function readPalette(br: BitReader, m: Uint8Array, dst: number, bpp: number): number {
  const count = br.read(11);
  for (let i = 0; i < count; i++) {
    if (bpp < 17) s16(m, dst + i * 2, br.read(bpp));
    else if (bpp < 25) s32(m, dst + i * 4, br.read(bpp));
    else s32(m, dst + i * 4, ((br.read(24) << 8) | br.read(bpp - 24)) >>> 0);
  }
  return count;
}

// 0x7F0CB7E0: in-place prediction over a w x rows byte plane (planes continue into each other); mode 7 = none.
function filter(m: Uint8Array, base: number, w: number, rows: number, mode: number, mod: number) {
  const half = (v: number) => (v < 0 ? (v + 1) >> 1 : v >> 1); // C division by 2
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < w; x++) {
      const o = base + y * w + x;
      const a = m[o] + 2 * mod;
      const left = x > 0 ? m[o - 1] : 0, up = y > 0 ? m[o - w] : 0, ul = x > 0 && y > 0 ? m[o - w - 1] : 0;
      let v: number;
      switch (mode) {
        case 0: v = a + left; break;
        case 1: v = a + up; break;
        case 2: v = a + ul; break;
        case 3: v = left + up - ul + a; break;
        case 4: v = half(up - ul) + left + a; break;
        case 5: v = half(left - ul) + up + a; break;
        case 6: v = half(left + up) + a; break;
        default: continue;
      }
      m[o] = (v % mod) & 0xff;
    }
  }
}

// 0x7F0C9A9C: codecs 0/1, raw texels from the bit stream (never used by the ROM's textures).
function codecRaw(br: BitReader, out: Uint8Array, w: number, h: number, fmt: number) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      switch (fmt) {
        case 0: s32(out, y * pad4(w) * 4 + x * 4, ((br.read(16) << 16) | br.read(16)) >>> 0); break;
        case 2: s32(out, y * pad4(w) * 4 + x * 4, ((br.read(24) << 8) | 0xff) >>> 0); break;
        case 1: case 4: s16(out, y * pad4(w) * 2 + x * 2, br.read(16)); break;
        case 3: s16(out, y * pad4(w) * 2 + x * 2, (br.read(15) << 1) | 1); break;
        case 5: case 7: s8(out, y * pad8(w) + x, br.read(8)); break;
        case 6: case 8: if (!(x & 1)) s8(out, y * (pad16(w) >> 1) + (x >> 1), br.read(8)); break;
      }
    }
  }
}

// 0x7F0C9DA4: planar channel bytes (plane c at src + c·w·h) → N64 texels.
function pack(m: Uint8Array, src: number, w: number, h: number, out: Uint8Array, fmt: number) {
  const n = w * h;
  const P = (c: number, i: number) => g8(m, src + c * n + i);
  let t = 0, row = 0;
  switch (fmt) {
    case 0: case 2:
      for (let y = 0; y < h; y++, row += pad4(w) * 4) {
        for (let x = 0; x < w; x++, t++) s32(out, row + x * 4, ((P(0, t) << 24) | (P(1, t) << 16) | (P(2, t) << 8) | (fmt === 0 ? P(3, t) : 0xff)) >>> 0);
      }
      break;
    case 1: case 3:
      for (let y = 0; y < h; y++, row += pad4(w) * 2) {
        for (let x = 0; x < w; x++, t++) s16(out, row + x * 2, (P(0, t) << 11) | (P(1, t) << 6) | (P(2, t) << 1) | (fmt === 1 ? P(3, t) : 1));
      }
      break;
    case 4:
      for (let y = 0; y < h; y++, row += pad4(w) * 2) for (let x = 0; x < w; x++, t++) s16(out, row + x * 2, (P(0, t) << 8) | P(1, t));
      break;
    case 5:
      for (let y = 0; y < h; y++, row += pad8(w)) for (let x = 0; x < w; x++, t++) s8(out, row + x, (P(0, t) << 4) | P(1, t));
      break;
    case 6:
      // 3-bit intensity (plane 0) + 1-bit alpha (plane 3); for odd widths the last nibble takes the next pixel.
      for (let y = 0; y < h; y++, row += pad16(w) >> 1) {
        for (let x = 0; x < w; x += 2, t += 2) s8(out, row + (x >> 1), (P(0, t) << 5) | (P(3, t) << 4) | (P(0, t + 1) << 1) | P(3, t + 1));
        if (w & 1) t--;
      }
      break;
    case 7:
      for (let y = 0; y < h; y++, row += pad8(w)) for (let x = 0; x < w; x++, t++) s8(out, row + x, P(0, t));
      break;
    case 8:
      for (let y = 0; y < h; y++, row += pad16(w) >> 1) {
        for (let x = 0; x < w; x += 2, t += 2) s8(out, row + (x >> 1), (P(0, t) << 4) | P(0, t + 1));
        if (w & 1) t--;
      }
      break;
  }
}

// 0x7F0CA890: codec 5, palette indices read raw. Format 2 here is palette << 8 without the 0xFF alpha.
function codecPalRaw(br: BitReader, m: Uint8Array, count: number, w: number, h: number, out: Uint8Array, fmt: number) {
  let bits = 0;
  for (let a = count - 1; a > 0; a >>= 1) bits++;
  const idx = () => br.read(bits);
  let row = 0;
  switch (fmt) {
    case 0: case 2:
      for (let y = 0; y < h; y++, row += pad4(w) * 4) {
        for (let x = 0; x < w; x++) { const v = g32(m, FRAME_PAL + idx() * 4); s32(out, row + x * 4, fmt === 0 ? v : (v << 8) >>> 0); }
      }
      break;
    case 1: case 3: case 4:
      for (let y = 0; y < h; y++, row += pad4(w) * 2) {
        for (let x = 0; x < w; x++) { const v = g16(m, FRAME_PAL + idx() * 2); s16(out, row + x * 2, fmt === 3 ? (v << 1) | 1 : v); }
      }
      break;
    case 5: case 7:
      for (let y = 0; y < h; y++, row += pad8(w)) for (let x = 0; x < w; x++) s8(out, row + x, g16(m, FRAME_PAL + idx() * 2));
      break;
    case 6: case 8:
      for (let y = 0; y < h; y++, row += pad16(w) >> 1) {
        for (let x = 0; x < w; x += 2) {
          const o = row + (x >> 1);
          s8(out, o, g16(m, FRAME_PAL + idx() * 2) << 4);
          if (x + 1 < w) s8(out, o, g8(out, o) | g8(m, FRAME_PAL + idx() * 2 + 1));
        }
      }
      break;
  }
}

// 0x7F0CAC58: codecs 6/7, decoded palette indices (bytes when count < 257, else u16) through the palette.
function palMap(m: Uint8Array, count: number, w: number, h: number, out: Uint8Array, fmt: number) {
  const idx = (y: number, x: number) => (count < 257 ? g8(m, FRAME_BUF + y * w + x) : g16(m, FRAME_BUF + 2 * (y * w + x)));
  let row = 0;
  switch (fmt) {
    case 0: case 2:
      for (let y = 0; y < h; y++, row += pad4(w) * 4) {
        for (let x = 0; x < w; x++) { const v = g32(m, FRAME_PAL + idx(y, x) * 4); s32(out, row + x * 4, fmt === 0 ? v : ((v << 8) | 0xff) >>> 0); }
      }
      break;
    case 1: case 3: case 4:
      for (let y = 0; y < h; y++, row += pad4(w) * 2) {
        for (let x = 0; x < w; x++) { const v = g16(m, FRAME_PAL + idx(y, x) * 2); s16(out, row + x * 2, fmt === 3 ? (v << 1) | 1 : v); }
      }
      break;
    case 5: case 7:
      for (let y = 0; y < h; y++, row += pad8(w)) for (let x = 0; x < w; x++) s8(out, row + x, g16(m, FRAME_PAL + idx(y, x) * 2));
      break;
    case 6: case 8:
      // The last odd column's right neighbour is the next row's first symbol (no clamp).
      for (let y = 0; y < h; y++, row += pad16(w) >> 1) {
        for (let x = 0; x < w; x += 2) s8(out, row + (x >> 1), g16(m, FRAME_PAL + idx(y, x + 1) * 2) | (g16(m, FRAME_PAL + idx(y, x) * 2) << 4));
      }
      break;
  }
}

export interface GeImage {
  width: number;
  height: number;
  rgba: Uint8Array;
  format: string; // FORMAT_NAMES
}

const ext5 = (v: number) => (v << 3) | (v >> 2);

// Level-0 texels as the game lays them out (padded rows) → RGBA8.
function toRgba(tx: Uint8Array, w: number, h: number, fmt: number, palette: Uint8Array | null): Uint8Array {
  const rb = fmt === 0 || fmt === 2 ? pad4(w) * 4 : fmt <= 4 ? pad4(w) * 2 : fmt === 5 || fmt === 7 || fmt === 9 || fmt === 11 ? pad8(w) : pad16(w) >> 1;
  const o = new Uint8Array(w * h * 4);
  const rgba16 = (v: number, d: number) => { o[d] = ext5((v >> 11) & 31); o[d + 1] = ext5((v >> 6) & 31); o[d + 2] = ext5((v >> 1) & 31); o[d + 3] = v & 1 ? 255 : 0; };
  const ia16 = (v: number, d: number) => { o[d] = o[d + 1] = o[d + 2] = v >> 8; o[d + 3] = v & 0xff; };
  const pal = (i: number) => (palette && i * 2 + 1 < palette.length ? g16(palette, i * 2) : 0);
  for (let y = 0; y < h; y++) {
    const r = y * rb;
    for (let x = 0; x < w; x++) {
      const d = (y * w + x) * 4;
      const nib = (g8(tx, r + (x >> 1)) >> (x & 1 ? 0 : 4)) & 15;
      switch (fmt) {
        case 0: case 2: for (let c = 0; c < 4; c++) o[d + c] = g8(tx, r + x * 4 + c); break;
        case 1: case 3: rgba16(g16(tx, r + x * 2), d); break;
        case 4: ia16(g16(tx, r + x * 2), d); break;
        case 5: { const v = g8(tx, r + x); o[d] = o[d + 1] = o[d + 2] = (v >> 4) * 0x11; o[d + 3] = (v & 15) * 0x11; break; }
        case 6: o[d] = o[d + 1] = o[d + 2] = (nib >> 1) * 0x24 + (nib >> 1 ? 3 : 0); o[d + 3] = nib & 1 ? 255 : 0; break;
        case 7: o[d] = o[d + 1] = o[d + 2] = o[d + 3] = g8(tx, r + x); break;
        case 8: o[d] = o[d + 1] = o[d + 2] = o[d + 3] = nib * 0x11; break;
        case 9: rgba16(pal(g8(tx, r + x)), d); break;
        case 11: ia16(pal(g8(tx, r + x)), d); break;
        case 10: rgba16(pal(nib), d); break;
        case 12: ia16(pal(nib), d); break;
      }
    }
  }
  return o;
}

/** Decodes level 0 of a texture entry. Throws where the game would fail (oversized levels, unknown codecs). */
export function decodeGeTexture(rom: Uint8Array, entry: GeTextureEntry): GeImage {
  const zlib = (rom[entry.rom] & 0x40) !== 0;
  const br = new BitReader(rom, entry.rom + 1);
  const out = new Uint8Array(0x10000); // heap bytes the game doesn't write are emulated as 0
  if (!zlib) {
    const fmt = br.read(4), w = br.read(8), h = br.read(8), codec = br.read(4);
    const n = w * h;
    if (n > 8192) throw new Error(`texture ${entry.index}: level too large (${w}x${h})`);
    if (fmt > 8) throw new Error(`texture ${entry.index}: format ${fmt}`);
    if (codec >= 10) throw new Error(`texture ${entry.index}: codec ${codec}`);
    const m = new Uint8Array(FRAME_SIZE);
    const ch = FMT_CHANNELS[fmt], nsym = FMT_SYMBOLS[fmt];
    const alpha = () => { if (FMT_RAW_ALPHA[fmt]) for (let i = 0; i < n; i++) m[FRAME_BUF + 3 * n + i] = br.read(1); };
    switch (codec) {
      case 0: case 1: codecRaw(br, out, w, h, fmt); break;
      case 2: huffman(br, m, FRAME_BUF, ch * n, nsym); alpha(); pack(m, FRAME_BUF, w, h, out, fmt); break;
      case 3:
        for (let c = 0; c < ch; c++) huffman(br, m, FRAME_BUF + c * n, n, nsym);
        alpha();
        pack(m, FRAME_BUF, w, h, out, fmt);
        break;
      case 4: lz(br, m, FRAME_BUF, ch * n); alpha(); pack(m, FRAME_BUF, w, h, out, fmt); break;
      case 5: codecPalRaw(br, m, readPalette(br, m, FRAME_PAL, FMT_BPP[fmt]), w, h, out, fmt); break;
      case 6: { const count = readPalette(br, m, FRAME_PAL, FMT_BPP[fmt]); huffman(br, m, FRAME_BUF, n, count); palMap(m, count, w, h, out, fmt); break; }
      case 7: { const count = readPalette(br, m, FRAME_PAL, FMT_BPP[fmt]); lz(br, m, FRAME_BUF, n); palMap(m, count, w, h, out, fmt); break; }
      case 8: case 9: {
        const mode = br.read(3);
        if (codec === 8) huffman(br, m, FRAME_BUF, ch * n, nsym);
        else lz(br, m, FRAME_BUF, ch * n);
        filter(m, FRAME_BUF, w, ch * h, mode, nsym);
        alpha();
        pack(m, FRAME_BUF, w, h, out, fmt);
        break;
      }
    }
    return { width: w, height: h, rgba: toRgba(out, w, h, fmt, null), format: FORMAT_NAMES[fmt] };
  }
  const fmt = br.read(8), count = br.read(8) + 1;
  if (fmt < 9 || fmt > 12) throw new Error(`texture ${entry.index}: zlib format ${fmt}`);
  const palette = new Uint8Array(count * 2);
  for (let i = 0; i < count; i++) s16(palette, i * 2, br.read(16));
  const w = br.read(8), h = br.read(8);
  if (w * h > 4096) throw new Error(`texture ${entry.index}: level too large (${w}x${h})`);
  // 0x7F0C6BC8: ceil(w / step) index bytes per row, each row padded to 8 bytes.
  const data = inflate1172Checked(rom, br.p);
  const step = fmt === 9 || fmt === 11 ? 1 : 2;
  let v = 0, sp = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x += step) s8(out, v++, data[sp++] ?? 0);
    v = (v + 7) & ~7;
  }
  return { width: w, height: h, rgba: toRgba(out, w, h, fmt, palette), format: FORMAT_NAMES[fmt] };
}

function inflate1172Checked(rom: Uint8Array, at: number): Uint8Array {
  if (rom[at] !== 0x11 || rom[at + 1] !== 0x72) throw new Error(`no 1172 stream at 0x${at.toString(16)}`);
  return inflateRaw(rom, at + 2, 0);
}

// Decoded level-0 images per ROM, by texture number (null: missing or undecodable).
const imageCache = new WeakMap<GeRom, Map<number, GeImage | null>>();

export function geImage(r: GeRom, texture: number): GeImage | null {
  let cache = imageCache.get(r);
  if (!cache) imageCache.set(r, (cache = new Map()));
  let img = cache.get(texture);
  if (img === undefined) {
    const e = r.textureEntries()[texture];
    img = null;
    if (e && e.size > 0) {
      try {
        img = decodeGeTexture(r.rom, e);
      } catch {
        img = null;
      }
    }
    cache.set(texture, img);
  }
  return img;
}

// C0 (§3.3): w1 & 0xFFF texture number; (w0 >> 22) & 3 S wrap, (w0 >> 20) & 3 T wrap (0 repeat, 1 clamp, 2 mirror);
// (w0 >> 18) & 3 filter (2 bilinear); w0 & 7 mode (2 = one mipmapped texture, 1 = two textures, second number
// (w1 >> 12) & 0xFFF; 0/3/4 variants).
export interface C0 { texture: number; texture2: number; wrapS: WrapMode; wrapT: WrapMode; filter: number; mode: number }

export function decodeC0(w0: number, w1: number): C0 {
  const wrap = (v: number): WrapMode => (v === 1 ? 'clamp' : v === 2 ? 'mirror' : 'repeat');
  return {
    texture: w1 & 0xfff, texture2: (w0 & 7) === 1 ? (w1 >>> 12) & 0xfff : -1,
    wrapS: wrap((w0 >>> 22) & 3), wrapT: wrap((w0 >>> 20) & 3), filter: (w0 >>> 18) & 3, mode: w0 & 7,
  };
}

/** A level's texture list: GoldenEye texture numbers with wrap modes → indices into `textures`. */
export class GeTextures {
  readonly textures: Texture[] = [];
  private readonly keys = new Map<string, number>();
  constructor(private readonly r: GeRom) {}

  /**
   * Index of texture `number` with the given wraps, or -1 if it can't be decoded. Each entry gets its own copy of the
   * cached texels: levels are transferred out of the worker, which detaches their buffers.
   */
  add(number: number, wrapS: WrapMode = 'repeat', wrapT: WrapMode = 'repeat'): number {
    const key = `${number}/${wrapS}/${wrapT}`;
    let index = this.keys.get(key);
    if (index === undefined) {
      const img = geImage(this.r, number);
      index = img
        ? this.textures.push({ width: img.width, height: img.height, rgba: img.rgba.slice(), wrapS, wrapT, format: img.format,
          source: `texture ${number} (0x${number.toString(16)}) ROM 0x${this.r.textureEntries()[number].rom.toString(16)}` }) - 1
        : -1;
      this.keys.set(key, index);
    }
    return index;
  }

  /** DisplayListContext.rareTexture: C0 → texture. The game's half-texel bilinear tile offset is left out (§6.3). */
  readonly rareTexture = (w0: number, w1: number): RareTexture | null => {
    const c = decodeC0(w0, w1);
    const texture = this.add(c.texture, c.wrapS, c.wrapT);
    const img = texture >= 0 ? this.textures[texture] : null;
    return { texture, width: img?.width ?? 32, height: img?.height ?? 32, uls: 0, ult: 0 };
  };
}
