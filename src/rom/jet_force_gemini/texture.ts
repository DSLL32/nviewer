import { decodeRows, ImFmt, ImSiz, Tlut } from '../texture';
import type { BlendMode, Texture, WrapMode } from '../types';
import { JfgArchive, view } from './fs';

const FORMATS: { fmt: ImFmt; siz: ImSiz; bits: number; name: string }[] = [
  { fmt: ImFmt.RGBA, siz: ImSiz.B32, bits: 32, name: 'RGBA32' },
  { fmt: ImFmt.RGBA, siz: ImSiz.B16, bits: 16, name: 'RGBA16' },
  { fmt: ImFmt.I, siz: ImSiz.B8, bits: 8, name: 'I8' },
  { fmt: ImFmt.I, siz: ImSiz.B4, bits: 4, name: 'I4' },
  { fmt: ImFmt.IA, siz: ImSiz.B16, bits: 16, name: 'IA16' },
  { fmt: ImFmt.IA, siz: ImSiz.B8, bits: 8, name: 'IA8' },
  { fmt: ImFmt.IA, siz: ImSiz.B4, bits: 4, name: 'IA4' },
];

function wrap(mode: number, forceClamp: boolean): WrapMode {
  if (forceClamp || (mode & 2)) return 'clamp';
  return mode & 1 ? 'mirror' : 'repeat';
}

// JFG loads every texture with dxt=0: the ROM pixels already have the N64
// TMEM odd-line word swap applied. Restore ordinary image rows for the viewer.
// RGBA32 swaps 8-byte halves of each 16-byte group; the other sizes swap
// 4-byte halves of each 8-byte group. A short trailing group is untouched.
function decodeBaseImage(data: Uint8Array, width: number, height: number, bits: number): Uint8Array {
  const line = Math.ceil(width * bits / 8), bytes = line * height;
  if (0x20 + bytes > data.length) throw new Error('Jet Force Gemini texture pixel data is truncated');
  const source = data.subarray(0x20, 0x20 + bytes), result = source.slice();
  const half = bits === 32 ? 8 : 4, stride = half * 2;
  for (let y = 1; y < height; y += 2) {
    const row = y * line;
    for (let x = 0; x + stride <= line; x += stride) {
      result.set(source.subarray(row + x + half, row + x + stride), row + x);
      result.set(source.subarray(row + x, row + x + half), row + x + half);
    }
  }
  return result;
}

export interface JfgTexture extends Texture {
  blend: BlendMode;
  id: number;
}

export function decodeJfgTexture(archive: JfgArchive, id: number): JfgTexture {
  const pool3d = (id & 0x8000) !== 0, index = id & 0x7fff;
  const stored = archive.member(pool3d ? 1 : 3, pool3d ? 0 : 2, index);
  if (stored.length < 0x20) throw new Error(`Jet Force Gemini texture 0x${id.toString(16)} is truncated`);
  const data = stored[0x19] ? archive.inflate(pool3d ? 1 : 3, pool3d ? 0 : 2, index, 0x20) : stored;
  if (data.length < 0x20) throw new Error(`Jet Force Gemini texture 0x${id.toString(16)} has no decoded header`);
  const dv = view(data), width = data[0], height = data[1], format = FORMATS[data[2] & 15];
  if (!format || !width || !height) throw new Error(`Jet Force Gemini texture 0x${id.toString(16)} has invalid format or dimensions`);
  const texels = decodeBaseImage(data, width, height, format.bits);
  const rgba = decodeRows(texels, 0, format.fmt, format.siz, width, height, null, Tlut.None);
  let zero = false, partial = false;
  for (let i = 3; i < rgba.length; i += 4) {
    zero ||= rgba[i] === 0;
    partial ||= rgba[i] !== 0 && rgba[i] !== 255;
  }
  const flags = dv.getUint16(6), frames = Math.max(1, dv.getUint16(0x12) >>> 8), mips = Math.max(1, data[0x1b]);
  return {
    id, width, height, rgba,
    wrapS: wrap(data[0x1c], (flags & 0x40) !== 0),
    wrapT: wrap(data[0x1e], (flags & 0x80) !== 0),
    format: `${format.name}${frames > 1 ? ` ${frames} frames` : ''}${mips > 1 ? ` ${mips} mips` : ''}`,
    source: `texture ${pool3d ? '3D' : '2D'}:0x${index.toString(16)}`,
    blend: partial ? 'blend' : zero ? 'cutout' : 'opaque',
  };
}

export class JfgTextures {
  private readonly indices = new Map<number, number>();
  constructor(readonly archive: JfgArchive, readonly textures: Texture[]) {}

  get(id: number): { index: number; texture: JfgTexture } {
    const key = id & 0xffff;
    const cached = this.indices.get(key);
    if (cached !== undefined) return { index: cached, texture: this.textures[cached] as JfgTexture };
    const texture = decodeJfgTexture(this.archive, key);
    const index = this.textures.push(texture) - 1;
    this.indices.set(key, index);
    return { index, texture };
  }
}
