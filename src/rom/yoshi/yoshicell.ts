// Yoshi's animation cells (ucellData, ROM 0x944370..0xB0E930, uncompressed).
//
// Cell table ROM 0xAE97A0: 1187 records of 0x80 bytes {ptr shape; u8 parts; u8[3]; {u8 part number; u8;
// u16 bytes; ptr CI8 texture} x 6}. A shape is an F3DEX 1.x display list (0x200 bytes) followed by 24
// vertices (pixels, y up, origin at the feet). The game copies a cell into a blob addressed as segment 3
// before drawing it: vertices at +0x200, the palette of Yoshi's colour at +0x400 (8 palettes of 256
// RGBA5551 at ROM 0x944370 + 0x200 k), and part n's texture at +0x600 + 0x200 n. Yoshi is drawn at 80%.
import { meshFromBatches } from '../bomberman/common';
import { runDisplayList } from '../displaylist';
import type { Mesh, Texture } from '../types';
import { view } from '../util';

const CELL_TABLE = 0xae97a0;
const CELL_COUNT = 1187;
const PALETTES = 0x944370;
const SEG3 = 0x528430;
const SCALE = 0.8;

export function yoshiCell(rom: Uint8Array, cell: number, palette: number, textures: Texture[]): Mesh | null {
  if (cell < 0 || cell >= CELL_COUNT || palette < 0 || palette > 7) return null;
  const dv = view(rom);
  const rec = CELL_TABLE + cell * 0x80;
  const rom3 = (p: number) => SEG3 + (p & 0xffffff);
  const shape = rom3(dv.getUint32(rec));
  const parts = new Map<number, number>();
  for (let k = 0; k < Math.min(rom[rec + 4], 6); k++) parts.set(rom[rec + 8 + 8 * k], rom3(dv.getUint32(rec + 12 + 8 * k)));
  const resolve = (addr: number) => {
    addr >>>= 0;
    if (addr >>> 24 !== 3) return -1;
    const off = addr & 0xffffff;
    if (off < 0x400) return shape + off;
    if (off < 0x600) return PALETTES + 0x200 * palette + (off - 0x400);
    return (off - 0x600) % 0x200 === 0 ? (parts.get((off - 0x600) / 0x200) ?? -1) : -1;
  };
  const batches = runDisplayList({
    buf: rom, ucode: 'f3dex', resolve, textures, textureKeys: new Map(), keyPrefix: `yoshi ${cell}/${palette}:`,
    vertexScale: 1, mirrorX: false, combiner: true,
  }, 0x03000000).map((b) => {
    for (let i = 0; i < b.positions.length; i += 3) {
      b.positions[i] *= SCALE;
      b.positions[i + 1] *= SCALE;
    }
    // Translucent textured-edge mode with 1-bit alpha: draw as a cutout so it depth-sorts with the layers.
    return { ...b, blend: 'cutout' as const, depthWrite: true };
  });
  if (!batches.length) return null;
  return { ...meshFromBatches('yoshi', batches), info: { cell, palette, record: `0x${rec.toString(16)}`, triSource: 'ROM offset (cell display list)' } };
}
