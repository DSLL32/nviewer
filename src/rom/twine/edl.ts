// EDL decompression for 007: The World Is Not Enough (N64, Eurocom); see docs/compression/edl.md.
// Game code: 0x80014A0C edlDecompress -> 0x800148A4 header parse -> 0x80014818 dispatch on method
// (0 stored 0x80013430, 1 Huffman 0x800134D0, 2 LZ 0x80013F74). No DOM dependencies.
//
// Header (12 bytes): "EDL", u8 (bit 7 = big-endian sizes, bits 0-6 = method), u32 compressed size (header included),
// u32 decompressed size. Bitstream from +12: big-endian u32 words, bits taken LSB first.

export interface EdlHeader {
  method: number;
  csize: number;
  dsize: number;
}

export function edlHeader(buf: Uint8Array, off: number): EdlHeader | null {
  if (off + 12 > buf.length || buf[off] !== 0x45 || buf[off + 1] !== 0x44 || buf[off + 2] !== 0x4c) return null;
  const b3 = buf[off + 3];
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const big = (b3 & 0x80) !== 0;
  return { method: b3 & 0x7f, csize: dv.getUint32(off + 4, !big), dsize: dv.getUint32(off + 8, !big) };
}

class Bits {
  private word = 0;
  private avail = 0;
  private p: number;
  constructor(private buf: Uint8Array, start: number, private end: number) {
    this.p = start;
  }
  get(n: number): number {
    let r = 0;
    let shift = 0;
    while (n > 0) {
      if (this.avail === 0) {
        if (this.p + 4 > this.end) throw new Error('EDL: read past end of input');
        const b = this.buf;
        this.word = ((b[this.p] << 24) | (b[this.p + 1] << 16) | (b[this.p + 2] << 8) | b[this.p + 3]) >>> 0;
        this.p += 4;
        this.avail = 32;
      }
      const take = n < this.avail ? n : this.avail;
      const v = take === 32 ? this.word : this.word & ((1 << take) - 1);
      this.word = take === 32 ? 0 : this.word >>> take;
      this.avail -= take;
      r |= v << shift;
      shift += take;
      n -= take;
    }
    return r >>> 0;
  }
}

// method 1 tables (main data 0x800B269F/0x800B26BF + symbol, 0x800B27E0, 0x800B281C)
const LEN_BASE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 255];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [0, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512, 768, 1024, 1536, 2048,
  3072, 4096, 6144, 8192, 12288, 16384, 24576];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

// Canonical Huffman, codes assigned in (length, symbol) order; the first bit read is the code's most significant bit.
interface Huff {
  count: Int32Array; // codes per length 0..15
  sym: Int32Array; // symbols sorted by (length, symbol)
}

function buildHuff(lens: number[]): Huff {
  const count = new Int32Array(16);
  for (const l of lens) count[l]++;
  count[0] = 0;
  const offs = new Int32Array(16);
  for (let l = 1; l < 16; l++) offs[l] = offs[l - 1] + count[l - 1];
  const sym = new Int32Array(lens.length);
  lens.forEach((l, s) => {
    if (l) sym[offs[l]++] = s;
  });
  return { count, sym };
}

function readSym(br: Bits, h: Huff): number {
  let code = 0;
  let first = 0;
  let index = 0;
  for (let len = 1; len < 16; len++) {
    code |= br.get(1);
    const c = h.count[len];
    if (code - first < c) return h.sym[index + code - first];
    index += c;
    first = (first + c) << 1;
    code <<= 1;
  }
  throw new Error('EDL: bad Huffman code');
}

class Out {
  buf: Uint8Array;
  n = 0;
  constructor(size: number) {
    this.buf = new Uint8Array(size);
  }
  push(v: number) {
    if (this.n >= this.buf.length) throw new Error('EDL: output overrun');
    this.buf[this.n++] = v;
  }
  copy(dist: number, len: number) {
    if (dist > this.n) throw new Error('EDL: distance before start');
    if (this.n + len > this.buf.length) throw new Error('EDL: output overrun');
    for (let k = 0; k < len; k++, this.n++) this.buf[this.n] = this.buf[this.n - dist];
  }
}

function method1(br: Bits, out: Out) {
  let lastLen = 0; // persists across tables and blocks
  let lit: Huff | null = null;
  let dist: Huff | null = null;
  for (;;) {
    if (br.get(1) === 0) {
      const n = br.get(15);
      for (let i = 0; i < n; i++) out.push(br.get(8));
    } else {
      for (let which = 0; which < 2; which++) {
        const n = br.get(9);
        if (n === 0) continue;
        const lens: number[] = [];
        for (let i = 0; i < n; i++) {
          if (br.get(1)) lastLen = br.get(4);
          lens.push(lastLen);
        }
        if (which === 0) lit = buildHuff(lens);
        else dist = buildHuff(lens);
      }
      if (!lit || !dist) throw new Error('EDL: missing table');
      for (;;) {
        const s = readSym(br, lit);
        if (s < 256) {
          out.push(s);
          continue;
        }
        if (s === 256) break;
        const len = LEN_BASE[s - 257] + br.get(LEN_EXTRA[s - 257]) + 3;
        const d = readSym(br, dist);
        out.copy(DIST_BASE[d] + br.get(DIST_EXTRA[d]) + 1, len);
      }
    }
    if (br.get(1)) break;
  }
}

function dist2(br: Bits): number {
  let hi: number;
  if (br.get(1) === 0) hi = 0;
  else {
    const a = br.get(1);
    const b = br.get(1);
    if (b === 0) hi = a ? 1 : 2 + br.get(1);
    else {
      const h = a * 2 + br.get(1) + 4;
      hi = br.get(1) ? h : h * 2 + br.get(1);
    }
  }
  return (hi << 8) + br.get(8) + 1;
}

function method2(br: Bits, out: Out) {
  for (;;) {
    if (br.get(1) === 0) {
      out.push(br.get(8));
      continue;
    }
    let len: number;
    let d: number;
    if (br.get(1) === 0) {
      len = br.get(1) + 4;
      if (br.get(1)) len = (len - 1) * 2 + br.get(1);
      if (len === 9) {
        const n = br.get(4) * 4 + 12;
        for (let i = 0; i < n; i++) out.push(br.get(8));
        continue;
      }
      d = dist2(br);
    } else if (br.get(1) === 0) {
      len = 2;
      d = br.get(8) + 1;
    } else {
      if (br.get(1) === 0) len = 3;
      else {
        len = br.get(8);
        if (len === 0) break;
        len += 8;
      }
      d = dist2(br);
    }
    out.copy(d, len);
  }
}

export function edlDecompress(buf: Uint8Array, off: number): Uint8Array {
  const h = edlHeader(buf, off);
  if (!h) throw new Error('EDL: no magic');
  if (h.method === 0) return buf.slice(off + 12, off + 12 + h.dsize);
  const out = new Out(h.dsize);
  const br = new Bits(buf, off + 12, Math.min(buf.length, off + h.csize));
  if (h.method === 1) method1(br, out);
  else if (h.method === 2) method2(br, out);
  else throw new Error('EDL: bad method ' + h.method);
  if (out.n !== h.dsize) throw new Error(`EDL: size ${out.n} != ${h.dsize}`);
  return out.buf;
}
