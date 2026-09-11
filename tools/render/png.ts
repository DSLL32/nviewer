// Minimal dependency-free PNG encoder/decoder (node:zlib for deflate).
// writePng: 8-bit RGBA. readPng: 8/16-bit greyscale, grey+alpha, RGB, RGBA and palette (1/2/4/8-bit), non-interlaced.
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

export interface Image {
  width: number;
  height: number;
  rgba: Uint8Array; // width * height * 4, row 0 = top
}

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32([head.subarray(4), data]), 0);
  return Buffer.concat([head, data, crc]);
}

/** Encode an RGBA8 image (row 0 = top) as a PNG file. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (!(width > 0 && height > 0) || rgba.length < width * height * 4) {
    throw new Error(`encodePng: bad size ${width}x${height} for ${rgba.length} bytes`);
  }
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  for (let y = 0; y < height; y++) {
    const row = rgba.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rgba.subarray((y - 1) * stride, y * stride) : null;
    // Pick the filter with the smallest sum of absolute (signed) residuals.
    let best = 0, bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = cand[f];
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 4 ? row[i - 4] : 0;
        const b = prev ? prev[i] : 0;
        const c = prev && i >= 4 ? prev[i - 4] : 0;
        let p: number;
        switch (f) {
          case 0: p = 0; break;
          case 1: p = a; break;
          case 2: p = b; break;
          case 3: p = (a + b) >> 1; break;
          default: p = paeth(a, b, c);
        }
        const v = (row[i] - p) & 0xff;
        out[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) { bestScore = score; best = f; }
    }
    const o = y * (stride + 1);
    raw[o] = best;
    cand[best].copy(raw, o + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0))]);
}

/** Write an RGBA8 image (row 0 = top) to a PNG file. */
export function writePng(path: string, width: number, height: number, rgba: Uint8Array): void {
  writeFileSync(path, encodePng(width, height, rgba));
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decode a PNG buffer to RGBA8. Throws on interlaced or otherwise unsupported files. */
export function decodePng(buf: Uint8Array): Image {
  const data = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (data.length < 8 || !data.subarray(0, 8).equals(SIGNATURE)) throw new Error('readPng: not a PNG file');
  let pos = 8;
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Buffer[] = [];
  while (pos + 8 <= data.length) {
    const len = data.readUInt32BE(pos);
    const type = data.toString('latin1', pos + 4, pos + 8);
    const body = data.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
  }
  if (!width || !height) throw new Error('readPng: missing IHDR');
  if (interlace) throw new Error('readPng: interlaced PNGs are not supported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType as 0 | 2 | 3 | 4 | 6];
  if (!channels) throw new Error(`readPng: unsupported colour type ${colorType}`);
  if (colorType === 3 ? ![1, 2, 4, 8].includes(depth) : ![8, 16].includes(depth)) {
    throw new Error(`readPng: unsupported bit depth ${depth} for colour type ${colorType}`);
  }
  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3); // filter byte distance
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < (stride + 1) * height) throw new Error('readPng: truncated image data');

  // Unfilter in place into `px`.
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const o = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= bpp ? px[o + i - bpp] : 0;
      const b = y > 0 ? px[o - stride + i] : 0;
      const c = y > 0 && i >= bpp ? px[o - stride + i - bpp] : 0;
      let v: number;
      switch (f) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw new Error(`readPng: bad filter type ${f} on row ${y}`);
      }
      px[o + i] = v & 0xff;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  const step = depth === 16 ? 2 : 1; // 16-bit: keep the high byte
  for (let y = 0; y < height; y++) {
    const o = y * stride;
    for (let x = 0; x < width; x++) {
      const d = (y * width + x) * 4;
      if (colorType === 3) {
        const bit = x * depth;
        const idx = (px[o + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
        if (!palette || idx * 3 + 2 >= palette.length) throw new Error('readPng: palette index out of range');
        rgba[d] = palette[idx * 3];
        rgba[d + 1] = palette[idx * 3 + 1];
        rgba[d + 2] = palette[idx * 3 + 2];
        rgba[d + 3] = trns && idx < trns.length ? trns[idx] : 255;
        continue;
      }
      const s = o + x * channels * step;
      switch (colorType) {
        case 0:
          rgba[d] = rgba[d + 1] = rgba[d + 2] = px[s];
          rgba[d + 3] = 255;
          break;
        case 4:
          rgba[d] = rgba[d + 1] = rgba[d + 2] = px[s];
          rgba[d + 3] = px[s + step];
          break;
        case 2:
          rgba[d] = px[s];
          rgba[d + 1] = px[s + step];
          rgba[d + 2] = px[s + 2 * step];
          rgba[d + 3] = 255;
          break;
        default:
          rgba[d] = px[s];
          rgba[d + 1] = px[s + step];
          rgba[d + 2] = px[s + 2 * step];
          rgba[d + 3] = px[s + 3 * step];
      }
    }
  }
  return { width, height, rgba };
}

/** Read a PNG file as RGBA8 (row 0 = top). */
export function readPng(path: string): Image {
  return decodePng(readFileSync(path));
}
