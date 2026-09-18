// Mario Party's HVQ 2.0 board pictures: 64x48 still-image tiles, stored bottom row first.
// The bitstream is described in docs/compression/hvq2.md.

const be16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const be32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const s16 = (n: number) => (n << 16) >> 16;

class Bits {
  bit = 0;
  constructor(readonly data: Uint8Array) {}
  get(): number {
    if (this.bit >= this.data.length * 8) throw new Error('truncated HVQ bitstream');
    const result = (this.data[this.bit >> 3] >> (7 - (this.bit & 7))) & 1;
    this.bit++;
    return result;
  }
  byte(): number {
    let result = 0;
    for (let i = 0; i < 8; i++) result = (result << 1) | this.get();
    return result;
  }
}

class Huffman {
  root = -1;
  private left: number[] = [];
  private right: number[] = [];
  parse(bits: Bits): void {
    const node = (): number => {
      if (!bits.get()) return bits.byte();
      const index = 256 + this.left.length;
      this.left.push(-1);
      this.right.push(-1);
      this.left[index - 256] = node();
      this.right[index - 256] = node();
      return index;
    };
    this.root = node();
  }
  read(bits: Bits): number {
    if (this.root < 0) throw new Error('missing HVQ Huffman tree');
    let node = this.root;
    while (node >= 256) node = bits.get() ? this.right[node - 256] : this.left[node - 256];
    return node;
  }
}

function section(src: Uint8Array, offset: number, tree?: Huffman): Bits {
  if (offset > src.length - 4) throw new Error('HVQ section offset outside image');
  const length = be32(src, offset);
  if (length > src.length - offset - 4) throw new Error('truncated HVQ section');
  const bits = new Bits(src.subarray(offset + 4, offset + 4 + length));
  if (length && tree) tree.parse(bits);
  return bits;
}

/** Decode the game's RGBA5551 pixels, which have zero alpha bits. */
export function decodeHvq2(src: Uint8Array): { width: number; height: number; rgba5551: Uint16Array } {
  if (src.length < 0x60 || String.fromCharCode(...src.subarray(0, 7)) !== 'HVQ 2.0')
    throw new Error('not an HVQ 2.0 image');
  const width = be16(src, 0x10), height = be16(src, 0x12), q = src[0x1d];
  if (!width || !height || (width & 7) || (height & 7) || q > 7 || src[0x1c] !== 8 || src[0x1e] !== 2 || src[0x1f] !== 2)
    throw new Error('unsupported HVQ dimensions or sampling');
  const bw = width >> 2, bh = height >> 2, cw = bw >> 1, ch = bh >> 1;
  const countTree = new Huffman(), runTree = new Huffman(), dcTree = new Huffman(), scaleTree = new Huffman();
  const streams = Array.from({ length: 16 }, (_, i) =>
    section(src, be32(src, 0x20 + 4 * i), i === 0 ? countTree : i === 2 ? runTree : i === 4 ? dcTree : i === 10 ? scaleTree : undefined));
  const sizes = [bw * bh, cw * ch, cw * ch];
  const modes = sizes.map(n => new Uint8Array(n));
  const dc = sizes.map(n => new Uint8Array(n));
  const planes = [new Uint16Array(width * height), new Uint16Array(width * height >> 2), new Uint16Array(width * height >> 2)];

  // Y counts and paired U/V counts. Zero means a run in the shared run stream.
  for (let group = 0; group < 2; group++) {
    let i = 0;
    const total = group ? sizes[1] : sizes[0];
    while (i < total) {
      const value = countTree.read(streams[group]);
      if (value) {
        if (group) { modes[1][i] = value & 15; modes[2][i] = value >> 4; }
        else modes[0][i] = value;
        i++;
      } else {
        const run = runTree.read(streams[group + 2]) + 1;
        if (run > total - i) throw new Error('HVQ block-count run overflow');
        i += run;
      }
    }
  }

  const remaining = [0, 0, 0];
  const delta = (plane: number): number => {
    if (remaining[plane]) { remaining[plane]--; return 0; }
    const next = () => s16((dcTree.read(streams[plane + 4]) << 24) >> 24) * (1 << q);
    let value = next();
    if (!value) { remaining[plane] = runTree.read(streams[plane + 7]); return 0; }
    let total = value;
    const lo = -(128 << q), hi = 127 << q;
    if (value === lo || value === hi) {
      do { value = next(); total += value; } while (value <= lo || value >= hi);
    }
    return total;
  };
  const readDc = (p: number, x: number, y: number): void => {
    const w = p ? cw : bw, i = y * w + x;
    const pred = !y ? (!x ? 0 : dc[p][i - 1]) : !x ? dc[p][i - w] : (dc[p][i - 1] + dc[p][i - w]) >> 1;
    dc[p][i] = pred + delta(p);
  };
  for (let my = 0; my < ch; my++) {
    for (let mx = 0; mx < cw; mx++) {
      readDc(0, mx * 2, my * 2); readDc(0, mx * 2 + 1, my * 2);
      readDc(1, mx, my); readDc(2, mx, my);
    }
    for (let x = 0; x < bw; x++) readDc(0, x, my * 2 + 1);
  }

  // The vector dictionary is a once-mirrored sample of the Y DC plane.
  const nest = new Uint8Array(70 * 38);
  const sx = be16(src, 0x14), sy = be16(src, 0x16);
  for (let y = 0; y < 38; y++) for (let x = 0; x < 70; x++) {
    const yy = y < bh ? y : y < 2 * bh ? 2 * bh - 1 - y : -1;
    const xx = x < bw ? x : x < 2 * bw ? 2 * bw - 1 - x : -1;
    if (xx >= 0 && yy >= 0 && xx + sx < bw && yy + sy < bh)
      nest[y * 70 + x] = dc[0][(yy + sy) * bw + xx + sx];
  }

  // Fix payloads are in MCU order, unlike the raster order of the block maps.
  const fix = [0, 1, 2].map(p => be32(src, 0x54 + 4 * p) + 4);
  const raw = sizes.map(n => new Uint8Array(n * 16));
  const vectors: { scale: number; code: number }[][][] = sizes.map(n => Array.from({ length: n }, () => []));
  const readPayload = (p: number, bx: number, by: number): void => {
    const i = by * (p ? cw : bw) + bx, mode = modes[p][i];
    if (mode === 8) {
      if (fix[p] > src.length - 16) throw new Error('truncated HVQ raw block');
      raw[p].set(src.subarray(fix[p], fix[p] + 16), i * 16);
      fix[p] += 16;
    } else if (mode < 8) {
      for (let k = 0; k < mode; k++) {
        if (fix[p] > src.length - 2) throw new Error('truncated HVQ vector');
        vectors[p][i].push({ scale: scaleTree.read(streams[10 + p]), code: be16(src, fix[p]) });
        fix[p] += 2;
      }
    } else throw new Error('invalid HVQ block mode');
  };
  for (let my = 0; my < ch; my++) for (let mx = 0; mx < cw; mx++) {
    readPayload(0, mx * 2, my * 2); readPayload(0, mx * 2 + 1, my * 2);
    readPayload(0, mx * 2, my * 2 + 1); readPayload(0, mx * 2 + 1, my * 2 + 1);
    readPayload(1, mx, my); readPayload(2, mx, my);
  }

  const div = new Int32Array(512);
  for (let i = 1; i < 512; i++) div[i] = (4096 / i) | 0;
  for (let p = 0; p < 3; p++) {
    const w = p ? cw : bw, h = p ? ch : bh, stride = w * 4;
    const pixels = new Uint16Array(16), samples = new Int16Array(16);
    for (let by = 0; by < h; by++) {
      let left = dc[p][by * w];
      for (let bx = 0; bx < w; bx++) {
        const i = by * w + bx, c = dc[p][i], mode = modes[p][i];
        if (!mode) {
          const right = bx + 1 < w && !modes[p][i + 1] ? dc[p][i + 1] : c;
          const top = by && !modes[p][i - w] ? dc[p][i - w] : c;
          const bottom = by + 1 < h && !modes[p][i + w] ? dc[p][i + w] : c;
          const c2 = 2 * c, c8 = 8 * c + 4;
          const tb = top - bottom, lr = left - right, vp = tb + lr, vm = tb - lr;
          const tl = top + left - c2, tr = top + right - c2, br = bottom + right - c2, bl = bottom + left - c2;
          const tml = top - left, tmr = top - right, bmr = bottom - right, bml = bottom - left;
          const qv = [c8 + vp + tl, c8 + vp + tml, c8 + vm + tmr, c8 + vm + tr,
            c8 + vp - tml, c8 - br, c8 - bl, c8 + vm - tmr,
            c8 - vm - bml, c8 - tr, c8 - tl, c8 - vp - bmr,
            c8 - vm + bl, c8 - vm + bml, c8 - vp + bmr, c8 - vp + br];
          for (let j = 0; j < 16; j++) pixels[j] = qv[j] >> 3;
          left = c;
        } else {
          if (mode === 8) for (let j = 0; j < 16; j++) pixels[j] = raw[p][i * 16 + j];
          else {
            pixels.fill(c);
            for (const v of vectors[p][i]) {
              const xs = (v.code & 1) + 1, ys = ((v.code >> 1) & 1) + 1;
              const nx = (v.code >> 2) & 63, ny = (v.code >> 8) & 31;
              let sum = 0;
              for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
                const val = nest[(ny + y * ys) * 70 + nx + x * xs];
                samples[y * 4 + x] = val;
                sum += val;
              }
              const mean = (sum + 8) >> 4;
              let max = 0;
              for (let j = 0; j < 16; j++) {
                samples[j] -= mean;
                max = Math.max(max, Math.abs(samples[j]));
              }
              const coefficient = s16((v.scale << 24) >> 24) * 8 + (v.code >> 13);
              const factor = div[max] * coefficient;
              for (let j = 0; j < 16; j++) pixels[j] += (samples[j] * factor + 512) >> 10;
            }
          }
          left = bx + 1 < w ? dc[p][i + 1] : c;
        }
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++)
          planes[p][(by * 4 + y) * stride + bx * 4 + x] = pixels[y * 4 + x];
      }
    }
  }

  const rgba5551 = new Uint16Array(width * height);
  const clip = (x: number) => { x -= 256; return x < 0 ? 0 : x >= 256 ? 248 : x & ~7; };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, ci = (y >> 1) * (width >> 1) + (x >> 1);
    const yy = planes[0][i], u = s16(planes[1][ci] - 128), v = s16(planes[2][ci] - 128);
    const y6 = s16((yy & 0x3ff) << 6);
    const r = clip((y6 + s16(90 * v + 0x4020)) >> 6);
    const g = clip((y6 + s16(-22 * u - 46 * v + 0x4020)) >> 6);
    const b = clip((y6 + s16(113 * u + 0x4020)) >> 6);
    rgba5551[i] = (r << 8) | (g << 3) | (b >> 2);
  }
  return { width, height, rgba5551 };
}

export interface BackgroundCamera {
  fov: number;
  scale: number;
  eye: [number, number, number];
  lookAt: [number, number, number];
  up: [number, number, number];
}

export interface Background {
  width: number;
  height: number;
  rgba: Uint8Array;
  tilesX: number;
  tilesY: number;
  camera: BackgroundCamera;
}

/** Japan's HVQ filesystem; the game-specific loader may supply another region's offset. */
export function decodeBackground(rom: Uint8Array, index: number, fsOffset = 0xfc4930): Background {
  if (fsOffset > rom.length - 4) throw new Error('HVQ filesystem outside ROM');
  const count = be32(rom, fsOffset) - 1;
  if (index < 0 || index >= count) throw new Error(`HVQ background ${index} outside 0..${count - 1}`);
  const bg = fsOffset + be32(rom, fsOffset + 4 + 4 * index);
  if (bg > rom.length - 4) throw new Error('HVQ background outside ROM');
  const fileCount = be32(rom, bg) - 1;
  if (fileCount < 2 || bg + 4 + 4 * fileCount > rom.length) throw new Error('invalid HVQ background file table');
  const fileOffset = (i: number) => bg + be32(rom, bg + 4 + 4 * i);
  const meta = fileOffset(0);
  if (meta > rom.length - 0x3c) throw new Error('truncated HVQ background metadata');
  const tileW = be32(rom, meta), tileH = be32(rom, meta + 4);
  const tilesX = be32(rom, meta + 8), tilesY = be32(rom, meta + 12);
  const width = tileW * tilesX, height = tileH * tilesY;
  if (tileW !== 64 || tileH !== 48 || !tilesX || !tilesY || (fileCount - 1) !== tilesX * tilesY)
    throw new Error(`invalid HVQ background ${index} tile dimensions`);
  const dv = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
  const f = (i: number) => dv.getFloat32(meta + 16 + i * 4, false);
  const camera: BackgroundCamera = {
    fov: f(0), scale: f(1), eye: [f(2), f(3), f(4)],
    lookAt: [f(5), f(6), f(7)], up: [f(8), f(9), f(10)],
  };
  const rgba = new Uint8Array(width * height * 4);
  for (let k = 0; k < tilesX * tilesY; k++) {
    const start = fileOffset(k + 1), end = fileOffset(k + 2);
    if (end < start || end > rom.length) throw new Error(`invalid HVQ background ${index} tile ${k} range`);
    const tile = decodeHvq2(rom.subarray(start, end));
    if (tile.width !== tileW || tile.height !== tileH) throw new Error(`invalid HVQ background ${index} tile ${k} image`);
    const col = k % tilesX, row = tilesY - 1 - Math.floor(k / tilesX);
    for (let y = 0; y < tileH; y++) for (let x = 0; x < tileW; x++) {
      const pixel = tile.rgba5551[y * tileW + x];
      const dst = ((row * tileH + y) * width + col * tileW + x) * 4;
      const r = (pixel >> 11) & 31, g = (pixel >> 6) & 31, b = (pixel >> 1) & 31;
      rgba[dst] = (r << 3) | (r >> 2);
      rgba[dst + 1] = (g << 3) | (g >> 2);
      rgba[dst + 2] = (b << 3) | (b >> 2);
      rgba[dst + 3] = 255;
    }
  }
  return { width, height, rgba, tilesX, tilesY, camera };
}
