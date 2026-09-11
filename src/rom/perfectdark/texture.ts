// Perfect Dark global textures: 3,503 entries by number in two codec families, decoded to level-0 RGBA as the RDP samples
// them (PERFECTDARK.md §4.6).
//
// A port of the game's loader (tex_load 0x7F172DD0: zlib path 0x7F16E5D8, bit-stream path 0x7F16FBA4) that reproduces the
// bytes the game writes into its texture pool, game bugs included (texels verified against RDRAM), cut down to level 0:
// mip levels are stored after it or generated from it and never change it, except that the pool's odd rows are
// "swizzled" (64-bit word halves swapped, undone by the RDP's odd-row fetch) only when the game does so.
//
// List (ROM 0x1FF7CA0): 8-byte records {u32 w0; u32 w1}, w0 & 0xFFFFFF = data offset from ROM 0x1D65F40; a texture's
// data ends at the next record's offset. Data byte 0: bit 7 = all levels stored, bit 6 = zlib path, low 6 bits = levels.
//   zlib path:       u8 format (9..12); u8 colours - 1; u16 palette[]; per level u8 w, h + a 1173 stream of indices
//   bit-stream path: per level read4 format, read8 w, read8 h, read4 codec (0/1 raw, 2/3 Huffman, 4 RLE, 5-7 lookup,
//                    8/9 Huffman/RLE + prediction)
// Formats: 0 RGBA32, 1 RGBA16, 2 RGB24, 3 RGB15, 4 IA16, 5 IA8, 6 IA4, 7 I8, 8 I4, 9 CI8/RGBA16, 10 CI4/RGBA16,
// 11 CI8/IA16, 12 CI4/IA16.
import { inflateRaw } from '../inflate';
import type { Texture, WrapMode } from '../types';
import type { PdRom } from './rom';

const LIST_ROM = 0x1ff7ca0;
const DATA_ROM = 0x1d65f40;
export const TEXTURE_COUNT = 3503;
export const FORMAT_NAMES = ['RGBA32', 'RGBA16', 'RGB24', 'RGB15', 'IA16', 'IA8', 'IA4', 'I8', 'I4', 'CI8/RGBA16', 'CI4/RGBA16', 'CI8/IA16', 'CI4/IA16'];

const enum F { RGBA32 = 0, RGBA16 = 1, RGB24 = 2, RGB15 = 3, IA16 = 4, IA8 = 5, IA4 = 6, I8 = 7, I4 = 8, CI8_RGBA16 = 9, CI4_RGBA16 = 10, CI8_IA16 = 11, CI4_IA16 = 12 }
const NUM_CHANNELS = [4, 3, 3, 3, 2, 2, 1, 1, 1, 1, 1, 1, 1];
const HAS_1BIT_ALPHA = [0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
const CHANNEL_SIZES = [256, 32, 256, 32, 256, 16, 8, 256, 16, 256, 16, 256, 16];
const BITS_PER_PIXEL = [32, 16, 24, 15, 16, 8, 4, 8, 4, 16, 16, 16, 16];
// RDP image format and size per format, and the TLUT type (2 RGBA16, 3 IA16).
const GBI_FMT = [0, 0, 0, 0, 3, 3, 3, 4, 4, 2, 2, 2, 2];
const GBI_SIZ = [3, 2, 3, 2, 2, 1, 0, 1, 0, 1, 0, 1, 0];
const GBI_TLUT = [0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 3, 3];

export interface PdImage {
  num: number;
  width: number;
  height: number;
  rgba: Uint8Array; // level 0; share it only through copies (PdTextures)
  format: string; // FORMAT_NAMES
  rom: number; // ROM offset of the data
  hasLodData: boolean;
}

// MSB-first bit reader (0x7F1732E0).
class Bits {
  accum = 0;
  n = 0;
  constructor(readonly src: Uint8Array, public ptr: number) {}
  read(k: number): number {
    while (this.n < k) {
      this.accum = ((this.accum << 8) | (this.ptr < this.src.length ? this.src[this.ptr] : 0)) >>> 0;
      this.ptr++;
      this.n += 8;
    }
    this.n -= k;
    return (this.accum >>> this.n) & ((1 << k) - 1);
  }
}

// Big-endian byte buffer addressed like the game's pointers.
class Mem {
  readonly b: Uint8Array;
  readonly dv: DataView;
  constructor(size: number) {
    this.b = new Uint8Array(size);
    this.dv = new DataView(this.b.buffer);
  }
  u16(o: number) { return o >= 0 && o + 2 <= this.b.length ? this.dv.getUint16(o) : 0; }
  u32(o: number) { return o >= 0 && o + 4 <= this.b.length ? this.dv.getUint32(o) : 0; }
  w16(o: number, v: number) { if (o >= 0 && o + 2 <= this.b.length) this.dv.setUint16(o, v & 0xffff); }
  w32(o: number, v: number) { if (o >= 0 && o + 4 <= this.b.length) this.dv.setUint32(o, v >>> 0); }
}

// The pool writes the texture at an address = 8 (mod 16); 32-bit output aligns to 16 bytes, which shifts RGBA32/RGB24
// images by 8 bytes (a game bug the RDP then shows).
const DATA_ADDR_MOD16 = 8;
const alignedAddr = (off: number, a: number) => ((DATA_ADDR_MOD16 + off + a - 1) & ~(a - 1)) - DATA_ADDR_MOD16;

function swizzle(m: Mem, dst: number, width: number, height: number, format: number) {
  let wordsPerRow: number;
  switch (format) {
    case F.RGBA32: case F.RGB24: wordsPerRow = (width + 3) & 0xffc; break;
    case F.RGBA16: case F.RGB15: case F.IA16: wordsPerRow = ((width + 3) & 0xffc) >> 1; break;
    case F.IA8: case F.I8: case F.CI8_RGBA16: case F.CI8_IA16: wordsPerRow = ((width + 7) & 0xff8) >> 2; break;
    default: wordsPerRow = ((width + 15) & 0xff0) >> 3; break;
  }
  const swap = (a: number, b: number) => {
    const t = m.u32(a);
    m.w32(a, m.u32(b));
    m.w32(b, t);
  };
  let row = dst + wordsPerRow * 4;
  for (let y = 1; y < height; y += 2) {
    if (format === F.RGBA32 || format === F.RGB24) {
      for (let x = 0; x < wordsPerRow; x += 4) {
        swap(row + x * 4, row + (x + 2) * 4);
        swap(row + (x + 1) * 4, row + (x + 3) * 4);
      }
    } else {
      for (let x = 0; x < wordsPerRow; x += 2) swap(row + x * 4, row + (x + 1) * 4);
    }
    row += wordsPerRow * 8;
  }
}

// ---- bit-stream codecs ----

// Huffman (0x7F1706D4): chanSize 8-bit frequencies, a tree built with the game's tie rules, then numIter symbols.
function inflateHuffman(bits: Bits, m: Mem, dst: number, numIter: number, chanSize: number) {
  const freq = new Uint16Array(2048).fill(9999); // entries >= chanSize are uninitialised stack in the game
  const nodes = new Int16Array(4096).fill(-1);
  for (let i = 0; i < chanSize; i++) freq[i] = bits.read(8);
  let min1 = 9999, min2 = 9999, i1 = 0, i2 = 0, root = 0;
  for (let i = 0; i < chanSize; i++) {
    if (freq[i] < min1) {
      if (min2 < min1) { min1 = freq[i]; i1 = i; } else { min2 = freq[i]; i2 = i; }
    } else if (freq[i] < min2) { min2 = freq[i]; i2 = i; }
  }
  const leaf = (k: number) => nodes[k * 2] < 0 && nodes[k * 2 + 1] < 0;
  for (let guard = 0; guard < 10000; guard++) {
    let sum = freq[i1] + freq[i2];
    if (sum === 0) sum = 1;
    freq[i1] = 9999;
    freq[i2] = 9999;
    if (leaf(i1)) {
      nodes[i1 * 2] = i1 + 10000;
      root = i1;
      freq[i1] = sum;
      nodes[i1 * 2 + 1] = leaf(i2) ? i2 + 10000 : i2;
    } else if (leaf(i2)) {
      nodes[i2 * 2] = i2 + 10000;
      root = i2;
      freq[i2] = sum;
      nodes[i2 * 2 + 1] = leaf(i1) ? i1 + 10000 : i1;
    } else {
      for (root = 0; root < 2048 && (nodes[root * 2] >= 0 || nodes[root * 2 + 1] >= 0 || freq[root] < 9999); root++);
      freq[root] = sum;
      nodes[root * 2] = i1;
      nodes[root * 2 + 1] = i2;
    }
    min1 = 9999;
    min2 = 9999;
    for (let i = 0; i < chanSize; i++) {
      if (freq[i] < min1) {
        if (min1 > min2) { min1 = freq[i]; i1 = i; } else { min2 = freq[i]; i2 = i; }
      } else if (freq[i] < min2) { min2 = freq[i]; i2 = i; }
    }
    if (min1 === 9999 || min2 === 9999) break;
  }
  for (let i = 0; i < numIter; i++) {
    let v = root;
    for (let guard = 0; v < 10000 && guard < 4096; guard++) v = nodes[v * 2 + bits.read(1)];
    if (chanSize <= 256) m.b[dst + i] = (v - 10000) & 0xff;
    else m.w16(dst + i * 2, v - 10000);
  }
}

// RLE (0x7F170B54): back-reference bits, run bits, symbol bits; a match is followed by a literal.
function inflateRle(bits: Bits, m: Mem, dst: number, total: number) {
  const bt = bits.read(3), rl = bits.read(3), bs = bits.read(4);
  let cost = bt + rl + bs + 1, fudge = 0;
  while (cost > 0) { cost = cost - bs - 1; fudge++; }
  const get = (i: number) => (bs <= 8 ? m.b[dst + i] : m.u16(dst + i * 2));
  const put = (i: number, v: number) => { if (bs <= 8) m.b[dst + i] = v & 0xff; else m.w16(dst + i * 2, v); };
  let done = 0;
  while (done < total) {
    if (bits.read(1) === 0) {
      put(done++, bits.read(bs));
    } else {
      const start = done - bits.read(bt) - 1;
      const run = bits.read(rl) + fudge;
      for (let i = start; i < start + run; i++) put(done++, get(i));
      put(done++, bits.read(bs));
    }
  }
}

function readAlphaBits(bits: Bits, m: Mem, dst: number, count: number) {
  for (let i = 0; i < count; i++) m.b[dst + i] = bits.read(1);
}

// Prediction (0x7F170F8C): modular differences against neighbours, method 0..6.
function blur(m: Mem, px: number, width: number, height: number, method: number, chanSize: number) {
  const b = m.b;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cur = b[px + y * width + x] + chanSize * 2;
      const left = x > 0 ? b[px + y * width + x - 1] : 0;
      const above = y > 0 ? b[px + (y - 1) * width + x] : 0;
      const al = x > 0 && y > 0 ? b[px + (y - 1) * width + x - 1] : 0;
      let v: number;
      switch (method) {
        case 0: v = (cur + left) % chanSize; break;
        case 1: v = (cur + above) % chanSize; break;
        case 2: v = (cur + al) % chanSize; break;
        case 3: v = (cur + (left + above - al)) % chanSize; break;
        case 4: v = (cur + (Math.trunc((above - al) / 2) + left)) % chanSize; break;
        case 5: v = (cur + (Math.trunc((left - al) / 2) + above)) % chanSize; break;
        case 6: v = (cur + Math.trunc((left + above) / 2)) % chanSize; break;
        default: continue;
      }
      b[px + y * width + x] = v & 0xff;
    }
  }
}

function readUncompressed(bits: Bits, m: Mem, dst: number, w: number, h: number, format: number) {
  const d32 = alignedAddr(dst, 16), d16 = alignedAddr(dst, 8);
  switch (format) {
    case F.RGBA32: case F.RGB24: {
      const stride = (w + 3) & 0xffc;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const v = format === F.RGBA32 ? ((bits.read(16) << 16) | bits.read(16)) : ((bits.read(24) << 8) | 0xff);
          m.w32(d32 + (y * stride + x) * 4, v);
        }
      }
      break;
    }
    case F.RGBA16: case F.IA16: case F.RGB15: {
      const stride = (w + 3) & 0xffc;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m.w16(d16 + (y * stride + x) * 2, format === F.RGB15 ? (bits.read(15) << 1) | 1 : bits.read(16));
      break;
    }
    case F.IA8: case F.I8: {
      const stride = (w + 7) & 0xff8;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m.b[d16 + y * stride + x] = bits.read(8);
      break;
    }
    case F.IA4: case F.I4: {
      const stride = ((w + 15) & 0xff0) >> 1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x += 2) m.b[d16 + y * stride + (x >> 1)] = bits.read(8);
      break;
    }
  }
}

// Planar channel bytes → pool texels (0x7F1714AC).
function channelsToPixels(sm: Mem, w: number, h: number, m: Mem, dst: number, format: number) {
  const b = sm.b, ob = m.b, mult = w * h;
  let pos = 0;
  switch (format) {
    case F.RGBA32: case F.RGB24: {
      const stride = (w + 3) & 0xffc;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++, pos++) {
          const a = format === F.RGBA32 ? b[pos + mult * 3] : 0xff;
          m.w32(dst + (y * stride + x) * 4, (b[pos] << 24) | (b[pos + mult] << 16) | (b[pos + mult * 2] << 8) | a);
        }
      }
      break;
    }
    case F.RGBA16: case F.RGB15: case F.IA16: {
      const stride = (w + 3) & 0xffc;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++, pos++) {
          let v: number;
          if (format === F.RGBA16) v = (b[pos] << 11) | (b[pos + mult] << 6) | (b[pos + mult * 2] << 1) | b[pos + mult * 3];
          else if (format === F.RGB15) v = (b[pos] << 11) | (b[pos + mult] << 6) | (b[pos + mult * 2] << 1) | 1;
          else v = (b[pos] << 8) | b[pos + mult];
          m.w16(dst + (y * stride + x) * 2, v);
        }
      }
      break;
    }
    case F.IA8: case F.I8: {
      const stride = (w + 7) & 0xff8;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++, pos++) ob[dst + y * stride + x] = format === F.IA8 ? ((b[pos] << 4) | b[pos + mult]) & 0xff : b[pos];
      }
      break;
    }
    case F.IA4: {
      // Game bug: the row pointer advances by the full aligned width, twice the row size.
      let row = dst;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x += 2) {
          ob[row + (x >> 1)] = ((b[pos] << 5) | (b[pos + mult * 3] << 4) | (b[pos + 1] << 1) | b[pos + mult * 3 + 1]) & 0xff;
          pos += 2;
        }
        if (w & 1) pos--;
        row += (w + 15) & 0xff0;
      }
      break;
    }
    case F.I4: {
      let row = dst;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x += 2) {
          ob[row + (x >> 1)] = ((b[pos] << 4) | b[pos + 1]) & 0xff;
          pos += 2;
        }
        if (w & 1) pos--;
        row += ((w + 15) & 0xff0) >> 1;
      }
      break;
    }
  }
}

// Lookup table: 11-bit count, then entries of bpp bits.
function buildLookup(bits: Bits, lm: Mem, bpp: number): number {
  const n = bits.read(11);
  for (let i = 0; i < n; i++) {
    if (bpp <= 16) lm.w16(i * 2, bits.read(bpp));
    else if (bpp <= 24) lm.w32(i * 4, bits.read(bpp));
    else lm.w32(i * 4, (bits.read(24) << 8) | bits.read(bpp - 24));
  }
  return n;
}

const bitSize = (d: number) => {
  let c = 0;
  for (d--; d > 0; d >>= 1) c++;
  return c;
};

// Indices (read from the stream, or decoded into a buffer) through the lookup table.
function inflateLookup(bits: Bits | null, lm: Mem, idx: ((x: number, y: number) => number) | null, w: number, h: number, m: Mem, dst: number, n: number, format: number) {
  const fromBuffer = idx !== null;
  const bpc = bitSize(n);
  const next = (x: number, y: number) => (fromBuffer ? idx!(x, y) : bits!.read(bpc));
  switch (format) {
    case F.RGBA32: case F.RGB24: {
      const stride = (w + 3) & 0xffc;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const v = lm.u32(next(x, y) * 4);
          m.w32(dst + (y * stride + x) * 4, format === F.RGBA32 ? v : fromBuffer ? (v << 8) | 0xff : v << 8);
        }
      }
      break;
    }
    case F.RGBA16: case F.IA16: case F.RGB15: {
      const stride = (w + 3) & 0xffc;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const v = lm.u16(next(x, y) * 2);
          m.w16(dst + (y * stride + x) * 2, format === F.RGB15 ? (v << 1) | 1 : v);
        }
      }
      break;
    }
    case F.IA8: case F.I8: {
      const stride = (w + 7) & 0xff8;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m.b[dst + y * stride + x] = lm.u16(next(x, y) * 2) & 0xff;
      break;
    }
    case F.IA4: case F.I4: {
      const stride = ((w + 15) & 0xff0) >> 1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x += 2) {
          if (fromBuffer) {
            m.b[dst + y * stride + (x >> 1)] = ((lm.u16(idx!(x, y) * 2) << 4) | lm.u16(idx!(x + 1, y) * 2)) & 0xff;
          } else {
            let v = (lm.u16(bits!.read(bpc) * 2) << 4) & 0xff;
            if (x + 1 < w) v |= lm.b[bits!.read(bpc) * 2 + 1];
            m.b[dst + y * stride + (x >> 1)] = v;
          }
        }
      }
      break;
    }
  }
}

// ---- level 0 as the RDP samples it ----

const ext5 = (v: number) => (v << 3) | (v >> 2);

// Pool level 0 → RGBA8; odd rows are fetched with the word halves swapped.
function poolToRgba(d: Uint8Array, w: number, h: number, format: number, palette: Uint16Array | null): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const siz = GBI_SIZ[format], fmt = GBI_FMT[format], tlut = GBI_TLUT[format];
  const bits = [4, 8, 16, 32][siz];
  const line = siz === 3 ? ((w + 3) & ~3) * 4 : siz === 2 ? ((w + 3) & ~3) * 2 : siz === 1 ? (w + 7) & ~7 : ((w + 15) & ~15) >> 1;
  const xorOdd = siz === 3 ? 8 : 4;
  const byte = (x: number, y: number, k = 0) => d[y * line + ((((x * bits) >> 3) + k) ^ (y & 1 ? xorOdd : 0))] ?? 0;
  const pal = (i: number) => (palette && i < palette.length ? palette[i] : 0);
  const put16 = (o: number, v: number) => { out[o] = ext5((v >> 11) & 31); out[o + 1] = ext5((v >> 6) & 31); out[o + 2] = ext5((v >> 1) & 31); out[o + 3] = v & 1 ? 255 : 0; };
  const putIa16 = (o: number, v: number) => { out[o] = out[o + 1] = out[o + 2] = v >> 8; out[o + 3] = v & 0xff; };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const nib = (byte(x, y) >> (x & 1 ? 0 : 4)) & 0xf;
      switch ((fmt << 4) | siz) {
        case 0x20: case 0x21: {
          const v = pal(siz === 0 ? nib : byte(x, y));
          if (tlut === 3) putIa16(o, v);
          else put16(o, v);
          break;
        }
        case 0x02: put16(o, (byte(x, y) << 8) | byte(x, y, 1)); break;
        case 0x03: for (let c = 0; c < 4; c++) out[o + c] = byte(x, y, c); break;
        case 0x32: putIa16(o, (byte(x, y) << 8) | byte(x, y, 1)); break;
        case 0x31: { const v = byte(x, y); out[o] = out[o + 1] = out[o + 2] = (v >> 4) * 0x11; out[o + 3] = (v & 15) * 0x11; break; }
        case 0x30: out[o] = out[o + 1] = out[o + 2] = (nib >> 1) * 0x24 + (nib >> 1 ? 3 : 0); out[o + 3] = nib & 1 ? 255 : 0; break;
        case 0x41: out[o] = out[o + 1] = out[o + 2] = out[o + 3] = byte(x, y); break;
        case 0x40: out[o] = out[o + 1] = out[o + 2] = out[o + 3] = nib * 0x11; break;
      }
    }
  }
  return out;
}

/** Level 0 of global texture `num`, or null when it has no data or can't be decoded. */
export function decodePdTexture(rom: Uint8Array, num: number): PdImage | null {
  if (!(num >= 0 && num < TEXTURE_COUNT)) return null;
  const offset = ((rom[LIST_ROM + num * 8 + 1] << 16) | (rom[LIST_ROM + num * 8 + 2] << 8) | rom[LIST_ROM + num * 8 + 3]) >>> 0;
  const next = ((rom[LIST_ROM + num * 8 + 9] << 16) | (rom[LIST_ROM + num * 8 + 10] << 8) | rom[LIST_ROM + num * 8 + 11]) >>> 0;
  if (next <= offset) return null;
  const start = DATA_ROM + offset;
  const header = rom[start];
  const hasLodData = (header & 0x80) !== 0;
  const bits = new Bits(rom, start + 1);
  const m = new Mem(0x10000);
  let format: number, width: number, height: number;
  let palette: Uint16Array | null = null;
  if (header & 0x40) {
    format = bits.read(8);
    const count = bits.read(8) + 1;
    if (format < F.CI8_RGBA16 || format > F.CI4_IA16) return null;
    palette = new Uint16Array(count);
    for (let i = 0; i < count; i++) palette[i] = bits.read(16);
    width = bits.read(8);
    height = bits.read(8);
    const p = bits.ptr;
    if (rom[p] !== 0x11 || rom[p + 1] !== 0x73) return null;
    const indices = inflateRaw(rom, p + 5, (rom[p + 2] << 16) | (rom[p + 3] << 8) | rom[p + 4]);
    // One index byte per texel (CI8) or per two texels (CI4), rows padded to 8 bytes.
    const step = format === F.CI8_RGBA16 || format === F.CI8_IA16 ? 1 : 2;
    let out = 0, s = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x += step) m.b[out++] = indices[s++] ?? 0;
      out = alignedAddr(out, 8);
    }
    // Stored levels are swizzled while they fit the 0x800-byte budget; generated chains always swizzle level 0.
    if (!hasLodData || out <= 0x800) swizzle(m, 0, width, height, format);
  } else {
    format = bits.read(4);
    width = bits.read(8);
    height = bits.read(8);
    const comp = bits.read(4);
    if (format > F.I4 || width * height > 0x2000 || width === 0 || height === 0) return null;
    const wh = width * height;
    const sb = new Mem(0x10000), lookup = new Mem(0x4000);
    switch (comp) {
      case 0: case 1:
        readUncompressed(bits, m, 0, width, height, format);
        break;
      case 2:
        inflateHuffman(bits, sb, 0, NUM_CHANNELS[format] * wh, CHANNEL_SIZES[format]);
        if (HAS_1BIT_ALPHA[format]) readAlphaBits(bits, sb, wh * 3, wh);
        channelsToPixels(sb, width, height, m, 0, format);
        break;
      case 3:
        for (let j = 0; j < NUM_CHANNELS[format]; j++) inflateHuffman(bits, sb, wh * j, wh, CHANNEL_SIZES[format]);
        if (HAS_1BIT_ALPHA[format]) readAlphaBits(bits, sb, wh * 3, wh);
        channelsToPixels(sb, width, height, m, 0, format);
        break;
      case 4:
        inflateRle(bits, sb, 0, NUM_CHANNELS[format] * wh);
        if (HAS_1BIT_ALPHA[format]) readAlphaBits(bits, sb, wh * 3, wh);
        channelsToPixels(sb, width, height, m, 0, format);
        break;
      case 5:
        inflateLookup(bits, lookup, null, width, height, m, 0, buildLookup(bits, lookup, BITS_PER_PIXEL[format]), format);
        break;
      case 6: case 7: {
        const n = buildLookup(bits, lookup, BITS_PER_PIXEL[format]);
        if (comp === 6) inflateHuffman(bits, sb, 0, wh, n);
        else inflateRle(bits, sb, 0, wh);
        inflateLookup(null, lookup, (x, y) => (n <= 256 ? sb.b[y * width + x] : sb.u16((y * width + x) * 2)), width, height, m, 0, n, format);
        break;
      }
      case 8: case 9: {
        const method = bits.read(3);
        if (comp === 8) inflateHuffman(bits, sb, 0, NUM_CHANNELS[format] * wh, CHANNEL_SIZES[format]);
        else inflateRle(bits, sb, 0, NUM_CHANNELS[format] * wh);
        blur(sb, 0, width, NUM_CHANNELS[format] * height, method, CHANNEL_SIZES[format]);
        if (HAS_1BIT_ALPHA[format]) readAlphaBits(bits, sb, wh * 3, wh);
        channelsToPixels(sb, width, height, m, 0, format);
        break;
      }
      default:
        return null;
    }
    swizzle(m, 0, width, height, format); // level 0 is swizzled with stored and generated chains alike
  }
  if (width === 0 || height === 0) return null;
  return { num, width, height, rgba: poolToRgba(m.b, width, height, format, palette), format: FORMAT_NAMES[format], rom: start, hasLodData };
}

// Decoded images per ROM, by texture number (null: missing or undecodable).
const imageCache = new WeakMap<PdRom, Map<number, PdImage | null>>();

export function pdImage(r: PdRom, num: number): PdImage | null {
  let cache = imageCache.get(r);
  if (!cache) imageCache.set(r, (cache = new Map()));
  let img = cache.get(num);
  if (img === undefined) {
    try {
      img = decodePdTexture(r.rom, num);
    } catch {
      img = null;
    }
    cache.set(num, img);
  }
  return img;
}

/** C0 and G_SETTILE wrap fields (0 wrap, 1 clamp, 2 mirror; anything else wraps). */
export const TXMODE_WRAP: WrapMode[] = ['repeat', 'clamp', 'mirror', 'repeat'];

/**
 * A level's texture list: global texture numbers with wrap modes (and embedded model tiles) → indices into `textures`.
 * Every entry owns a copy of the cached texels: levels are transferred out of the worker, which detaches their buffers.
 */
export class PdTextures {
  readonly textures: Texture[] = [];
  private readonly keys = new Map<string, number>();
  constructor(readonly r: PdRom) {}

  image(num: number): PdImage | null {
    return pdImage(this.r, num);
  }

  /** Index of global texture `num` with the given wraps (flipV: rows reversed), or -1 if it can't be decoded. */
  add(num: number, wrapS: WrapMode = 'repeat', wrapT: WrapMode = 'repeat', flipV = false): number {
    return this.addRaw(`G${num}/${wrapS}/${wrapT}${flipV ? '/flip' : ''}`, () => {
      const img = this.image(num);
      if (!img) return null;
      let rgba = img.rgba.slice();
      if (flipV) {
        const row = img.width * 4, flipped = new Uint8Array(rgba.length);
        for (let y = 0; y < img.height; y++) flipped.set(rgba.subarray(y * row, (y + 1) * row), (img.height - 1 - y) * row);
        rgba = flipped;
      }
      return {
        width: img.width, height: img.height, rgba, wrapS, wrapT, format: img.format,
        source: `texture ${num} (0x${num.toString(16)}) ROM 0x${img.rom.toString(16)}${flipV ? ', rows flipped' : ''}`,
      };
    });
  }

  /** Index of the texture under `key`, built once (null: -1). */
  addRaw(key: string, build: () => Texture | null): number {
    let index = this.keys.get(key);
    if (index === undefined) {
      const t = build();
      index = t ? this.textures.push(t) - 1 : -1;
      this.keys.set(key, index);
    }
    return index;
  }
}
