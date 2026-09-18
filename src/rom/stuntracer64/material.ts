import type { BlendMode, Texture } from '../types';

export interface Material {
  texture: number;
  blend: BlendMode;
  depthTest: boolean;
  depthWrite: boolean;
  cullBack: boolean;
  uvScaleS: number;
  uvScaleT: number;
  uvOffsetS: number;
  uvOffsetT: number;
  uv(s: number, t: number): [number, number];
}

interface Tile {
  format: number;
  size: number;
  line: number;
  tmem: number;
  palette: number;
  cmS: number;
  cmT: number;
  maskS: number;
  maskT: number;
  shiftS: number;
  shiftT: number;
  uls: number;
  ult: number;
  lrs: number;
  lrt: number;
}

function u32(data: Uint8Array, off: number): number {
  if (off < 0 || off + 4 > data.length) throw new Error(`Stunt Racer material pointer out of bounds: ${off.toString(16)}`);
  return ((data[off] << 24) | (data[off + 1] << 16) | (data[off + 2] << 8) | data[off + 3]) >>> 0;
}

function commands(data: Uint8Array, off: number): [number, number][] {
  const result: [number, number][] = [];
  for (let at = off, n = 0; n < 128; n++, at += 8) {
    const w0 = u32(data, at), w1 = u32(data, at + 4);
    result.push([w0, w1]);
    if (w0 >>> 24 === 0xdf) return result;
  }
  throw new Error(`Stunt Racer unterminated material list at ${off.toString(16)}`);
}

function tileFrom(setup: [number, number][]): Tile {
  const tile: Tile = {
    format: 0, size: 0, line: 0, tmem: 0, palette: 0,
    cmS: 0, cmT: 0, maskS: 0, maskT: 0, shiftS: 0, shiftT: 0,
    uls: 0, ult: 0, lrs: 0, lrt: 0,
  };
  let foundTile = false, foundSize = false;
  for (const [w0, w1] of setup) {
    const op = w0 >>> 24;
    if (op === 0xf5 && ((w1 >>> 24) & 7) === 0) {
      tile.format = (w0 >>> 21) & 7;
      tile.size = (w0 >>> 19) & 3;
      tile.line = (w0 >>> 9) & 0x1ff;
      tile.tmem = w0 & 0x1ff;
      tile.palette = (w1 >>> 20) & 15;
      tile.cmT = (w1 >>> 18) & 3;
      tile.maskT = (w1 >>> 14) & 15;
      tile.shiftT = (w1 >>> 10) & 15;
      tile.cmS = (w1 >>> 8) & 3;
      tile.maskS = (w1 >>> 4) & 15;
      tile.shiftS = w1 & 15;
      foundTile = true;
    } else if (op === 0xf2 && ((w1 >>> 24) & 7) === 0) {
      tile.uls = (w0 >>> 12) & 0xfff;
      tile.ult = w0 & 0xfff;
      tile.lrs = (w1 >>> 12) & 0xfff;
      tile.lrt = w1 & 0xfff;
      foundSize = true;
    }
  }
  if (!foundTile || !foundSize) throw new Error('Stunt Racer material is missing tile 0');
  return tile;
}

function imageLoad(list: [number, number][]): { off: number; bytes: number } {
  let off = -1, bytes = -1;
  for (const [w0, w1] of list) {
    if (w0 >>> 24 === 0xfd) off = w1;
    if (w0 >>> 24 === 0xf3) {
      if ((w1 & 0xfff) !== 0) throw new Error('Stunt Racer requires an unsupported nonzero G_LOADBLOCK DXT');
      bytes = 2 * (((w1 >>> 12) & 0xfff) + 1);
    }
  }
  if (off < 0 || bytes < 0) throw new Error('Stunt Racer material is missing image load');
  return { off, bytes };
}

function paletteLoad(list: [number, number][]): { off: number; count: number } | undefined {
  let off = -1, count = 0;
  for (const [w0, w1] of list) {
    if (w0 >>> 24 === 0xfd) off = w1;
    if (w0 >>> 24 === 0xf0) count = ((w1 >>> 14) & 0x3ff) + 1;
  }
  return off >= 0 && count ? { off, count } : undefined;
}

function rgba16(data: Uint8Array, off: number, rgba: Uint8Array, dst: number): void {
  const v = (data[off] << 8) | data[off + 1];
  rgba[dst] = Math.round(((v >>> 11) & 31) * 255 / 31);
  rgba[dst + 1] = Math.round(((v >>> 6) & 31) * 255 / 31);
  rgba[dst + 2] = Math.round(((v >>> 1) & 31) * 255 / 31);
  rgba[dst + 3] = (v & 1) ? 255 : 0;
}

function shiftFactor(shift: number): number {
  return shift <= 10 ? 1 / (1 << shift) : 1 << (16 - shift);
}

/** Decode one map's parallel setup/image/TLUT material lists. Pointers are primary-file-relative. */
export function decodeMaterials(primary: Uint8Array, bundleOffset: number, textures: Texture[]): Material[] {
  const setupTable = u32(primary, bundleOffset);
  const imageTable = u32(primary, bundleOffset + 4);
  const paletteTable = u32(primary, bundleOffset + 8);
  const count = u32(primary, bundleOffset + 12);
  if (count > 4096) throw new Error(`Stunt Racer implausible material count ${count}`);
  const cache = new Map<string, number>();
  const result: Material[] = [];
  for (let i = 0; i < count; i++) {
    const setup = commands(primary, u32(primary, setupTable + i * 4));
    const image = imageLoad(commands(primary, u32(primary, imageTable + i * 4)));
    const palette = paletteLoad(commands(primary, u32(primary, paletteTable + i * 4)));
    const tile = tileFrom(setup);
    const renderMode = setup.find(([w0]) => w0 >>> 24 === 0xef)?.[1];
    const bpp = 4 << tile.size;
    const sampleWidth = Math.max(1, Math.floor((tile.lrs - tile.uls) / 4) + 1);
    const sampleHeight = Math.max(1, Math.floor((tile.lrt - tile.ult) / 4) + 1);
    const rowBytes = tile.line * 8;
    // G_SETTILESIZE is the sampling rectangle, not always the period of the
    // image. On a repeating axis the tile mask defines that period; only a
    // clamped axis is bounded by the rectangle. The six-tile mip materials
    // often declare a rectangle two texels shorter than the full base level.
    const width = tile.maskS
      ? (tile.cmS & 2) ? Math.min(sampleWidth, 1 << tile.maskS) : 1 << tile.maskS
      : sampleWidth;
    const height = tile.maskT
      ? (tile.cmT & 2) ? Math.min(sampleHeight, 1 << tile.maskT) : 1 << tile.maskT
      : sampleHeight;
    if (!rowBytes || !width || !height || width > 256 || height > 256 ||
        image.off < 0 || image.off + image.bytes > primary.length || image.bytes > 4096) {
      throw new Error(`Stunt Racer material ${i} has invalid TMEM tile extent`);
    }
    if (palette && palette.off + palette.count * 2 > primary.length) {
      throw new Error(`Stunt Racer material ${i} has invalid palette extent`);
    }
    const key = `${image.off}:${image.bytes}:${tile.tmem}:${rowBytes}:${width}:${height}:${tile.format}:${bpp}:${tile.palette}:${palette?.off ?? -1}:${palette?.count ?? 0}`;
    let texture = cache.get(key);
    if (texture === undefined) {
      const rgba = new Uint8Array(width * height * 4);
      // The load tile writes a raw block to TMEM address zero. Its DXT is zero
      // in every retail list, so the odd-row word swap is applied by the RDP
      // *sampler*, not while loading. Tile addresses wrap in TMEM; CI textures
      // use the lower 2 KiB while their TLUT occupies the upper half.
      const tmem = new Uint8Array(4096);
      tmem.set(primary.subarray(image.off, image.off + image.bytes));
      const addressMask = palette ? 0x7ff : 0xfff;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const byteInRow = Math.floor(x * bpp / 8);
        const p = (tile.tmem * 8 + y * rowBytes + (byteInRow ^ ((y & 1) ? 4 : 0))) & addressMask;
        const dst = (y * width + x) * 4;
        if (tile.format === 0 && bpp === 16) {
          rgba16(tmem, p, rgba, dst);
        } else if (tile.format === 2 && (bpp === 4 || bpp === 8)) {
          if (!palette) throw new Error(`Stunt Racer CI material ${i} has no TLUT`);
          const index = bpp === 4 ? ((x & 1) ? tmem[p] & 15 : tmem[p] >>> 4) + tile.palette * 16 : tmem[p];
          if (index >= palette.count) throw new Error(`Stunt Racer CI material ${i} exceeds TLUT`);
          rgba16(primary, palette.off + index * 2, rgba, dst);
        } else if (tile.format === 3 && bpp === 8) {
          rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = (tmem[p] >>> 4) * 17;
          rgba[dst + 3] = (tmem[p] & 15) * 17;
        } else if (tile.format === 4 && bpp === 4) {
          rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = ((x & 1) ? tmem[p] & 15 : tmem[p] >>> 4) * 17;
          rgba[dst + 3] = 255;
        } else {
          throw new Error(`Stunt Racer material ${i} unsupported texture format ${tile.format}/${bpp}`);
        }
      }
      const wrapS = (tile.cmS & 2) ? 'clamp' : (tile.cmS & 1) ? 'mirror' : 'repeat';
      const wrapT = (tile.cmT & 2) ? 'clamp' : (tile.cmT & 1) ? 'mirror' : 'repeat';
      texture = textures.push({ width, height, rgba, wrapS, wrapT,
        format: `${['RGBA', 'YUV', 'CI', 'IA', 'I'][tile.format] ?? tile.format}${bpp}`,
        source: `primary +0x${image.off.toString(16)}, TMEM +0x${(tile.tmem * 8).toString(16)}${palette ? `, TLUT +0x${palette.off.toString(16)}` : ''}` }) - 1;
      cache.set(key, texture);
    }
    const rgba = textures[texture].rgba;
    let hasZero = false, hasPartial = false;
    for (let j = 3; j < rgba.length; j += 4) {
      hasZero ||= rgba[j] === 0;
      hasPartial ||= rgba[j] !== 0 && rgba[j] !== 255;
    }
    const uvScaleS = shiftFactor(tile.shiftS) / width;
    const uvScaleT = shiftFactor(tile.shiftT) / height;
    const uvOffsetS = -tile.uls / (4 * width);
    const uvOffsetT = -tile.ult / (4 * height);
    result.push({
      texture,
      blend: renderMode !== undefined && (renderMode & 0x4000) ? 'blend'
        : renderMode !== undefined && (renderMode & 0x1000) ? 'cutout'
          : hasPartial ? 'blend' : hasZero ? 'cutout' : 'opaque',
      depthTest: true,
      depthWrite: renderMode === undefined || !(renderMode & 0x4000),
      // The per-material lists contain no geometry-mode commands. Their initial
      // DE call targets runtime state outside the inflated map, so back-face
      // culling cannot be established from these lists.
      cullBack: false,
      uvScaleS, uvScaleT, uvOffsetS, uvOffsetT,
      uv: (s, t) => [s * uvScaleS + uvOffsetS, t * uvScaleT + uvOffsetT],
    });
  }
  return result;
}
