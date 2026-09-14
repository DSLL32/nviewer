import type { BlendMode, Texture, WrapMode } from '../types';
import { SpiderManFs } from './fs';

const u16 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset + o, 2).getUint16(0);
const wrap = (v: number): WrapMode => v === 1 ? 'mirror' : v === 2 ? 'clamp' : 'repeat';
const five = (v: number) => (v << 3) | (v >>> 2);

export interface SpiderManTextureInfo {
  slot: number;
  texture: Texture;
  blend: BlendMode;
  alphaThreshold: number;
}

function rowByte(data: Uint8Array, base: number, stride: number, y: number, x: number): number {
  // Files store the RDP's odd-row two-word interleave directly.
  const sx = y & 1 ? (x & ~7) + ((x + 4) & 7) : x;
  return data[base + y * stride + sx] ?? 0;
}

function decodeRecord(slot: number, data: Uint8Array): SpiderManTextureInfo {
  if (data.length < 0x40) throw new Error(`Spider-Man texture ${slot} is truncated`);
  const width = u16(data, 0x20), height = u16(data, 0x22), format = u16(data, 0x26), dataSize = u16(data, 0x2a);
  if (width === 0 || height === 0 || width > 1024 || height > 1024) throw new Error(`Spider-Man texture ${slot} has invalid dimensions`);
  const bpp = format === 0x0014 ? 16 : format & 0xff, rowBytes = Math.ceil(width * bpp / 8), stride = (rowBytes + 7) & ~7, base = 0x3f;
  if (base + Math.min(dataSize, stride * height) > data.length) throw new Error(`Spider-Man texture ${slot} pixels overrun record`);
  const rgba = new Uint8Array(width * height * 4);
  const set = (i: number, r: number, g: number, b: number, a: number) => { rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a; };
  let palette: Uint8Array | null = null;
  if (format === 0x0204) {
    const at = base + dataSize;
    if (at + 32 > data.length) throw new Error(`Spider-Man texture ${slot} palette is truncated`);
    palette = data.subarray(at, at + 32);
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dst = (y * width + x) * 4;
    if (format === 0x0204) {
      const packed = rowByte(data, base, stride, y, x >>> 1), ci = x & 1 ? packed & 15 : packed >>> 4;
      const p = (palette![ci * 2] << 8) | palette![ci * 2 + 1];
      set(dst, five(p >>> 11), five((p >>> 6) & 31), five((p >>> 1) & 31), p & 1 ? 255 : 0);
    } else if (format === 0x0404) {
      const p = rowByte(data, base, stride, y, x >>> 1), i = (x & 1 ? p & 15 : p >>> 4) * 17;
      set(dst, i, i, i, i);
    } else if (format === 0x0408) {
      const i = rowByte(data, base, stride, y, x); set(dst, i, i, i, i);
    } else if (format === 0x0308) {
      const p = rowByte(data, base, stride, y, x), i = (p >>> 4) * 17; set(dst, i, i, i, (p & 15) * 17);
    } else if (format === 0x0304) {
      const p = rowByte(data, base, stride, y, x >>> 1), q = x & 1 ? p & 15 : p >>> 4;
      const i = ((q >>> 1) * 255 / 7) | 0; set(dst, i, i, i, q & 1 ? 255 : 0);
    } else if (format === 0x0010 || format === 0x0014) {
      const at = x * 2, p = (rowByte(data, base, stride, y, at) << 8) | rowByte(data, base, stride, y, at + 1);
      set(dst, five(p >>> 11), five((p >>> 6) & 31), five((p >>> 1) & 31), p & 1 ? 255 : 0);
    } else throw new Error(`unsupported Spider-Man texture ${slot} format 0x${format.toString(16).padStart(4, '0')}`);
  }
  const flags = data.length > 0x30 ? u16(data, 0x2f) : 0, alphaThreshold = data[0x2e];
  const mode = flags & 3;
  const blend: BlendMode = alphaThreshold === 0xff ? (mode === 3 ? 'blend' : mode === 1 ? 'cutout' : 'opaque') : 'cutout';
  const nul = data.subarray(0, 32).indexOf(0), name = String.fromCharCode(...data.subarray(0, nul < 0 ? 32 : nul));
  return { slot, blend, alphaThreshold, texture: { width, height, rgba, wrapS: wrap(data[0x2c]), wrapT: wrap(data[0x2d]),
    format: format === 0x0204 ? 'CI4/RGBA16' : format === 0x0404 ? 'I4' : format === 0x0408 ? 'I8' : format === 0x0308 ? 'IA8' : format === 0x0304 ? 'IA4' : format === 0x0014 ? 'RGBA16+aux4' : 'RGBA16',
    source: `Spider-Man texture ${slot} ${name}` } };
}

/** Dictionary decoder whose private cache is safe from worker transfer detachment. */
export class SpiderManTextures {
  private readonly cache = new Map<number, SpiderManTextureInfo>();
  constructor(private readonly fs: SpiderManFs) {}
  get(slot: number): SpiderManTextureInfo {
    let value = this.cache.get(slot);
    if (!value) { value = decodeRecord(slot, this.fs.getFile(3, slot)); this.cache.set(slot, value); }
    return value;
  }
  copy(slot: number): SpiderManTextureInfo {
    const x = this.get(slot);
    return { ...x, texture: { ...x.texture, rgba: x.texture.rgba.slice() } };
  }
}
