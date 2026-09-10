// Raw DEFLATE (RFC 1951) decoder. The game carries a port of gzip's inflate.c;
// streams have no zlib/gzip header. Synchronous so it can run anywhere.

class Huffman {
  counts = new Uint16Array(16);
  symbols: Uint16Array;
  constructor(lengths: Uint8Array, n: number) {
    this.symbols = new Uint16Array(n);
    for (let i = 0; i < n; i++) this.counts[lengths[i]]++;
    this.counts[0] = 0;
    const offs = new Uint16Array(16);
    for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + this.counts[i - 1];
    for (let i = 0; i < n; i++) if (lengths[i]) this.symbols[offs[lengths[i]]++] = i;
  }
}

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

let fixedLit: Huffman | undefined;
let fixedDist: Huffman | undefined;

export function inflateRaw(src: Uint8Array, offset: number, outSize: number): Uint8Array {
  let out = new Uint8Array(outSize > 0 ? outSize : 0x10000);
  let op = 0;
  let ip = offset;
  let bitBuf = 0;
  let bitCnt = 0;

  const bits = (n: number): number => {
    while (bitCnt < n) {
      if (ip >= src.length) throw new Error('inflate: input overrun');
      bitBuf |= src[ip++] << bitCnt;
      bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return v;
  };
  const decode = (h: Huffman): number => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const count = h.counts[len];
      if (code - count < first) return h.symbols[index + (code - first)];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('inflate: bad code');
  };
  const ensure = (n: number) => {
    if (op + n <= out.length) return;
    const bigger = new Uint8Array(Math.max(out.length * 2, op + n));
    bigger.set(out);
    out = bigger;
  };

  let last = 0;
  do {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0;
      bitCnt = 0;
      const len = src[ip] | (src[ip + 1] << 8);
      ip += 4;
      ensure(len);
      out.set(src.subarray(ip, ip + len), op);
      ip += len;
      op += len;
      continue;
    }
    let lit: Huffman, dist: Huffman;
    if (type === 1) {
      if (!fixedLit || !fixedDist) {
        const l = new Uint8Array(288);
        l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
        fixedLit = new Huffman(l, 288);
        fixedDist = new Huffman(new Uint8Array(30).fill(5), 30);
      }
      lit = fixedLit;
      dist = fixedDist;
    } else if (type === 2) {
      const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
      const cl = new Uint8Array(19);
      for (let i = 0; i < hclen; i++) cl[CL_ORDER[i]] = bits(3);
      const clh = new Huffman(cl, 19);
      const lens = new Uint8Array(hlit + hdist);
      for (let i = 0; i < hlit + hdist;) {
        const sym = decode(clh);
        if (sym < 16) lens[i++] = sym;
        else {
          let rep = 0, val = 0;
          if (sym === 16) { val = lens[i - 1]; rep = 3 + bits(2); }
          else if (sym === 17) rep = 3 + bits(3);
          else rep = 11 + bits(7);
          while (rep-- > 0) lens[i++] = val;
        }
      }
      lit = new Huffman(lens.subarray(0, hlit), hlit);
      dist = new Huffman(lens.subarray(hlit), hdist);
    } else {
      throw new Error('inflate: bad block type');
    }
    for (;;) {
      const sym = decode(lit);
      if (sym < 256) {
        ensure(1);
        out[op++] = sym;
      } else if (sym === 256) {
        break;
      } else {
        const s = sym - 257;
        const len = LEN_BASE[s] + bits(LEN_EXTRA[s]);
        const ds = decode(dist);
        const d = DIST_BASE[ds] + bits(DIST_EXTRA[ds]);
        ensure(len);
        for (let i = 0; i < len; i++, op++) out[op] = out[op - d];
      }
    }
  } while (!last);
  return out.subarray(0, op);
}
