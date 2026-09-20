import { decodeRows, ImFmt, ImSiz, Tlut } from '../texture';
import type { BlendMode, Texture, WrapMode } from '../types';
import { JfgArchive, view } from './fs';

const FORMATS: { fmt: ImFmt; siz: ImSiz; name: string }[] = [
  { fmt: ImFmt.RGBA, siz: ImSiz.B32, name: 'RGBA32' },
  { fmt: ImFmt.RGBA, siz: ImSiz.B16, name: 'RGBA16' },
  { fmt: ImFmt.I, siz: ImSiz.B8, name: 'I8' },
  { fmt: ImFmt.I, siz: ImSiz.B4, name: 'I4' },
  { fmt: ImFmt.IA, siz: ImSiz.B16, name: 'IA16' },
  { fmt: ImFmt.IA, siz: ImSiz.B8, name: 'IA8' },
  { fmt: ImFmt.IA, siz: ImSiz.B4, name: 'IA4' },
];

function wrap(mode: number, forceClamp: boolean): WrapMode {
  if (forceClamp || (mode & 2)) return 'clamp';
  return mode & 1 ? 'mirror' : 'repeat';
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
  const rgba = decodeRows(data, 0x20, format.fmt, format.siz, width, height, null, Tlut.None);
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
