// Baseline JPEG decoding (Huffman, 8-bit, any sampling factors, restart markers) for Ocarina of Time's prerendered
// room backgrounds (docs/ZELDA64.md §5.2.1: 320x240 JFIF, 4:2:0 or 4:2:2). Output RGBA8, alpha 255.

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

interface Huffman { lookup: Map<number, number> } // (length << 16 | code) -> symbol
interface Component { id: number; h: number; v: number; q: number; td: number; ta: number; pred: number; data: Uint8Array; bw: number; bh: number }

function buildHuffman(counts: Uint8Array, symbols: Uint8Array): Huffman {
  const lookup = new Map<number, number>();
  let code = 0, k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < counts[len - 1]; i++) lookup.set((len << 16) | code++, symbols[k++]);
    code <<= 1;
  }
  return { lookup };
}

// Separable float IDCT of one 8x8 block (dequantised, natural order) into 0..255 samples.
const COS = Array.from({ length: 8 }, (_, x) => Array.from({ length: 8 }, (_, u) => (u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16)));
function idct(block: Float64Array, out: Uint8Array, stride: number, at: number) {
  const tmp = new Float64Array(64);
  for (let y = 0; y < 8; y++) {
    for (let u = 0; u < 8; u++) {
      let s = 0;
      for (let v = 0; v < 8; v++) s += COS[y][v] * block[v * 8 + u];
      tmp[y * 8 + u] = s;
    }
  }
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let s = 0;
      for (let u = 0; u < 8; u++) s += COS[x][u] * tmp[y * 8 + u];
      out[at + y * stride + x] = Math.max(0, Math.min(255, Math.round(s / 4 + 128)));
    }
  }
}

export function decodeJpeg(data: Uint8Array, offset = 0): { width: number; height: number; rgba: Uint8Array } {
  if (data[offset] !== 0xff || data[offset + 1] !== 0xd8) throw new Error('not a JPEG');
  const qt: Uint16Array[] = [];
  const dc: Huffman[] = [], ac: Huffman[] = [];
  let comps: Component[] = [];
  let width = 0, height = 0, restart = 0, hmax = 1, vmax = 1;
  let p = offset + 2;
  const u16 = (o: number) => (data[o] << 8) | data[o + 1];
  for (;;) {
    if (p + 4 > data.length) throw new Error('JPEG: truncated');
    while (data[p] === 0xff && data[p + 1] === 0xff) p++;
    if (data[p] !== 0xff) throw new Error('JPEG: marker expected');
    const marker = data[p + 1];
    const len = u16(p + 2);
    const seg = p + 4, end = p + 2 + len;
    if (marker === 0xdb) {
      for (let q = seg; q < end;) {
        const wide = data[q] >> 4, id = data[q] & 15;
        const t = new Uint16Array(64);
        for (let k = 0; k < 64; k++) t[ZIGZAG[k]] = wide ? u16(q + 1 + k * 2) : data[q + 1 + k];
        qt[id] = t;
        q += 1 + (wide ? 128 : 64);
      }
    } else if (marker === 0xc4) {
      for (let q = seg; q < end;) {
        const cls = data[q] >> 4, id = data[q] & 15;
        const counts = data.subarray(q + 1, q + 17);
        const total = counts.reduce((s, c) => s + c, 0);
        (cls ? ac : dc)[id] = buildHuffman(counts, data.subarray(q + 17, q + 17 + total));
        q += 17 + total;
      }
    } else if (marker === 0xc0 || marker === 0xc1) {
      height = u16(seg + 1);
      width = u16(seg + 3);
      comps = [];
      for (let k = 0; k < data[seg + 5]; k++) {
        const o = seg + 6 + k * 3;
        comps.push({ id: data[o], h: data[o + 1] >> 4, v: data[o + 1] & 15, q: data[o + 2], td: 0, ta: 0, pred: 0, data: new Uint8Array(0), bw: 0, bh: 0 });
      }
    } else if (marker === 0xdd) {
      restart = u16(seg);
    } else if (marker === 0xda) {
      for (let k = 0; k < data[seg]; k++) {
        const c = comps.find((x) => x.id === data[seg + 1 + k * 2]);
        if (c) { c.td = data[seg + 2 + k * 2] >> 4; c.ta = data[seg + 2 + k * 2] & 15; }
      }
      p = end;
      break;
    } else if (marker >= 0xc2 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      throw new Error('JPEG: only baseline images are supported');
    }
    p = end;
  }
  if (!width || !height || !comps.length) throw new Error('JPEG: no frame');
  hmax = Math.max(...comps.map((c) => c.h));
  vmax = Math.max(...comps.map((c) => c.v));
  const mcux = Math.ceil(width / (8 * hmax)), mcuy = Math.ceil(height / (8 * vmax));
  for (const c of comps) {
    c.bw = mcux * c.h;
    c.bh = mcuy * c.v;
    c.data = new Uint8Array(c.bw * 8 * c.bh * 8);
  }

  // Entropy-coded data: bytes with 0xFF 0x00 stuffing; restart markers reset the bit reader and DC predictors.
  let bitBuf = 0, bitCount = 0;
  const readBit = () => {
    if (bitCount === 0) {
      let b = data[p++] ?? 0;
      if (b === 0xff) {
        const n = data[p];
        if (n === 0) p++;
        else if (n >= 0xd0 && n <= 0xd7) b = 0; // a marker reached early: pad
      }
      bitBuf = b;
      bitCount = 8;
    }
    bitCount--;
    return (bitBuf >> bitCount) & 1;
  };
  const receive = (n: number) => {
    let v = 0;
    for (let k = 0; k < n; k++) v = (v << 1) | readBit();
    return v;
  };
  const extend = (v: number, n: number) => (n && v < 1 << (n - 1) ? v - (1 << n) + 1 : v);
  const decodeSym = (h: Huffman) => {
    let code = 0;
    for (let len = 1; len <= 16; len++) {
      code = (code << 1) | readBit();
      const s = h.lookup.get((len << 16) | code);
      if (s !== undefined) return s;
    }
    throw new Error('JPEG: bad Huffman code');
  };
  const block = new Float64Array(64);
  const total = mcux * mcuy;
  for (let m = 0; m < total; m++) {
    if (restart && m && m % restart === 0) {
      bitCount = 0;
      while (p < data.length && !(data[p] === 0xff && data[p + 1] >= 0xd0 && data[p + 1] <= 0xd7)) p++;
      p += 2;
      for (const c of comps) c.pred = 0;
    }
    const mx = m % mcux, my = Math.floor(m / mcux);
    for (const c of comps) {
      const q = qt[c.q];
      for (let by = 0; by < c.v; by++) {
        for (let bx = 0; bx < c.h; bx++) {
          block.fill(0);
          const t = decodeSym(dc[c.td]);
          c.pred += extend(receive(t), t);
          block[0] = c.pred * q[0];
          for (let k = 1; k < 64;) {
            const rs = decodeSym(ac[c.ta]);
            const r = rs >> 4, s = rs & 15;
            if (!s) {
              if (r !== 15) break;
              k += 16;
              continue;
            }
            k += r;
            if (k > 63) break;
            block[ZIGZAG[k]] = extend(receive(s), s) * q[ZIGZAG[k]];
            k++;
          }
          const stride = c.bw * 8;
          idct(block, c.data, stride, ((my * c.v + by) * 8) * stride + (mx * c.h + bx) * 8);
        }
      }
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  const sample = (c: Component, x: number, y: number) => {
    const sx = Math.min(c.bw * 8 - 1, Math.floor((x * c.h) / hmax)), sy = Math.min(c.bh * 8 - 1, Math.floor((y * c.v) / vmax));
    return c.data[sy * c.bw * 8 + sx];
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = (y * width + x) * 4;
      const Y = sample(comps[0], x, y);
      if (comps.length >= 3) {
        const cb = sample(comps[1], x, y) - 128, cr = sample(comps[2], x, y) - 128;
        rgba[d] = Math.max(0, Math.min(255, Math.round(Y + 1.402 * cr)));
        rgba[d + 1] = Math.max(0, Math.min(255, Math.round(Y - 0.344136 * cb - 0.714136 * cr)));
        rgba[d + 2] = Math.max(0, Math.min(255, Math.round(Y + 1.772 * cb)));
      } else {
        rgba[d] = rgba[d + 1] = rgba[d + 2] = Y;
      }
      rgba[d + 3] = 255;
    }
  }
  return { width, height, rgba };
}
