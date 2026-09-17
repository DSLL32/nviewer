/** Banjo-Kazooie sprite assets: frame offset table, optional palette, tiled chunks. */
import type { Batch, Level, Texture } from '../types';
import { decodeRows, ImFmt, ImSiz, Tlut } from '../texture';

interface SpriteFormat { fmt: ImFmt; siz: ImSiz; bits: number; paletteEntries: number }
interface SpriteChunk { x: number; y: number; w: number; h: number; rgba: Uint8Array }
interface SpriteFrame { x: number; y: number; w: number; h: number; chunks: SpriteChunk[] }
export interface BanjoSpriteMesh { mesh: number; sx: number; sy: number }
export interface BanjoSpriteOptions {
  /** A setup prop's requested frame; absent selects the largest visible frame for static display. */
  frame?: number;
  mirror?: boolean;
  /** Per-channel reduction in sixteenths, as stored in setup props. */
  rgbReduction?: [number, number, number];
}

const align8 = (n: number) => (n + 7) & ~7;
const hex = (n: number) => `0x${n.toString(16)}`;

function spriteFormat(type: number): SpriteFormat {
  if (type & 0x001) return { fmt: ImFmt.CI, siz: ImSiz.B4, bits: 4, paletteEntries: 16 };
  if (type & 0x004) return { fmt: ImFmt.CI, siz: ImSiz.B8, bits: 8, paletteEntries: 256 };
  if (type & 0x020) return { fmt: ImFmt.I, siz: ImSiz.B4, bits: 4, paletteEntries: 0 };
  if (type & 0x040) return { fmt: ImFmt.I, siz: ImSiz.B8, bits: 8, paletteEntries: 0 };
  if (type & 0x080) return { fmt: ImFmt.IA, siz: ImSiz.B4, bits: 4, paletteEntries: 0 };
  if (type & 0x100) return { fmt: ImFmt.IA, siz: ImSiz.B8, bits: 8, paletteEntries: 0 };
  if (type & 0x400) return { fmt: ImFmt.RGBA, siz: ImSiz.B16, bits: 16, paletteEntries: 0 };
  if (type & 0x800) return { fmt: ImFmt.RGBA, siz: ImSiz.B32, bits: 32, paletteEntries: 0 };
  throw new Error(`Banjo sprite unknown type ${hex(type)}`);
}

function parseSprite(data: Uint8Array, assetId: number): { type: number; sx: number; sy: number; frames: SpriteFrame[] } {
  const fail = (reason: string): never => { throw new Error(`Banjo sprite ${hex(assetId)}: ${reason}`); };
  const within = (at: number, size: number) => Number.isSafeInteger(at) && at >= 0 && size >= 0 && at + size <= data.length;
  if (!within(0, 0x10)) fail('truncated header');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getInt16(0);
  const type = view.getInt16(2);
  const fmt = spriteFormat(type);
  const sx = view.getInt16(8), sy = view.getInt16(10);
  if (count < 1 || count > 1024 || !within(0x10, count * 4)) fail(`invalid frame count ${count}`);
  const frameBase = 0x10 + count * 4;
  const frames: SpriteFrame[] = [];
  for (let i = 0; i < count; i++) {
    const at = frameBase + view.getInt32(0x10 + i * 4);
    if (!within(at, 0x14)) fail(`frame ${i} outside asset`);
    const frame: SpriteFrame = {
      x: view.getInt16(at), y: view.getInt16(at + 2),
      w: view.getInt16(at + 4), h: view.getInt16(at + 6), chunks: [],
    };
    const chunkCount = view.getInt16(at + 8);
    if (frame.w <= 0 || frame.h <= 0 || chunkCount < 0 || chunkCount > 4096) fail(`frame ${i} invalid dimensions/count`);
    let p = at + 0x14;
    let palette: Uint8Array | null = null;
    if (fmt.paletteEntries) {
      p = align8(p);
      const bytes = fmt.paletteEntries * 2;
      if (!within(p, bytes)) fail(`frame ${i} palette outside asset`);
      palette = data.subarray(p, p + bytes);
      p += bytes;
    }
    for (let j = 0; j < chunkCount; j++) {
      if (!within(p, 8)) fail(`frame ${i} chunk ${j} header outside asset`);
      const x = view.getInt16(p), y = view.getInt16(p + 2);
      const w = view.getInt16(p + 4), h = view.getInt16(p + 6);
      const texel = align8(p + 8);
      if (w <= 0 || h <= 0 || w * h > 4_194_304) fail(`frame ${i} chunk ${j} invalid dimensions`);
      const bytes = Math.ceil(w * fmt.bits / 8) * h;
      if (!within(texel, bytes)) fail(`frame ${i} chunk ${j} texels outside asset`);
      frame.chunks.push({ x, y, w, h, rgba: decodeRows(data, texel, fmt.fmt, fmt.siz, w, h, palette, Tlut.Rgba16) });
      p = texel + bytes;
    }
    frames.push(frame);
  }
  return { type, sx, sy, frames };
}

function opaquePixels(frame: SpriteFrame): number {
  let n = 0;
  for (const chunk of frame.chunks) for (let i = 3; i < chunk.rgba.length; i += 4) if (chunk.rgba[i] > 127) n++;
  return n;
}

/** Adds a camera-facing quad mesh. The caller applies sx/sy to its billboard matrix. */
export function addBanjoSprite(
  level: Level, assetId: number, data: Uint8Array, cache: Map<string, BanjoSpriteMesh>, options: BanjoSpriteOptions = {},
): BanjoSpriteMesh {
  const tint = options.rgbReduction ?? [0, 0, 0];
  const key = `${assetId}:${options.frame ?? 'best'}:${options.mirror ? 1 : 0}:${tint.join(',')}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const sprite = parseSprite(data, assetId);
  const frameIndex = options.frame === undefined
    ? sprite.frames.reduce((best, frame, i) => opaquePixels(frame) > opaquePixels(sprite.frames[best]) ? i : best, 0)
    : options.frame;
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= sprite.frames.length)
    throw new Error(`Banjo sprite ${hex(assetId)} frame ${frameIndex} outside 0..${sprite.frames.length - 1}`);
  const frame = sprite.frames[frameIndex];
  let minX = 0, minY = 0, maxX = frame.w, maxY = frame.h;
  for (const chunk of frame.chunks) {
    minX = Math.min(minX, chunk.x); minY = Math.min(minY, chunk.y);
    maxX = Math.max(maxX, chunk.x + chunk.w); maxY = Math.max(maxY, chunk.y + chunk.h);
  }
  const w = maxX - minX, h = maxY - minY;
  if (w * h > 16_777_216) throw new Error(`Banjo sprite ${hex(assetId)} composite too large`);
  const rgba = new Uint8Array(w * h * 4);
  for (const chunk of frame.chunks) {
    for (let y = 0; y < chunk.h; y++) {
      const to = ((chunk.y - minY + y) * w + chunk.x - minX) * 4;
      rgba.set(chunk.rgba.subarray(y * chunk.w * 4, (y + 1) * chunk.w * 4), to);
    }
  }
  const texture: Texture = {
    width: w, height: h, rgba, wrapS: 'clamp', wrapT: 'clamp',
    format: `sprite type ${hex(sprite.type)}`, source: `asset ${hex(assetId)} frame ${frameIndex}`,
  };
  const textureIndex = level.textures.push(texture) - 1;
  const originX = frame.x - minX, originY = frame.y - minY;
  const x0 = -originX, x1 = w - originX, y0 = originY - h, y1 = originY;
  const coords = [[x0, y0], [x1, y0], [x1, y1], [x0, y0], [x1, y1], [x0, y1]];
  const uv = options.mirror
    ? [[1, 1], [0, 1], [0, 0], [1, 1], [0, 0], [1, 0]]
    : [[0, 1], [1, 1], [1, 0], [0, 1], [1, 0], [0, 0]];
  const color = tint.map((v) => Math.max(0, Math.min(255, 255 - v * 16)));
  const batch: Batch = {
    texture: textureIndex, blend: 'cutout', depthTest: true, depthWrite: true, cullBack: false,
    positions: new Float32Array(coords.flatMap(([x, y]) => [x, y, 0])),
    uvs: new Float32Array(uv.flat()),
    colors: new Uint8Array(coords.flatMap(() => [...color, 255])),
  };
  const result = {
    mesh: level.meshes.push({ name: `sprite ${hex(assetId)}`, radius: Math.max(Math.abs(x0), Math.abs(x1), Math.abs(y0), Math.abs(y1)) * Math.max(Math.abs(sprite.sx / frame.w), Math.abs(sprite.sy / frame.h)), batches: [batch], info: { asset: hex(assetId), frame: frameIndex } }) - 1,
    sx: sprite.sx / frame.w, sy: sprite.sy / frame.h,
  };
  cache.set(key, result);
  return result;
}
