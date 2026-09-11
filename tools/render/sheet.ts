// Texture contact sheet: all textures in index order on a checkerboard, labelled with their index,
// plus a companion .txt listing index / size / format / wrap / position in the sheet.
import { writeFileSync } from 'node:fs';
import type { Texture } from '../../src/rom/types';
import { drawText, GLYPH_H, textWidth } from './font';
import { writePng, type Image } from './png';

export interface SheetOptions {
  /** Integer pixel scale; default 2 when every texture is <= 64 px, else 1. */
  scale?: number;
  /** Target sheet width in pixels (rows wrap); default 1024 (grown if a single tile is wider). */
  maxWidth?: number;
  /** Gap between tiles, default 6. */
  padding?: number;
  /** Checkerboard cell size in output pixels, default 8. */
  checker?: number;
  /** Sheet background 0..255, default [40, 40, 48]. */
  background?: [number, number, number];
  /** Draw index labels (default true). */
  labels?: boolean;
  /** Write `<path without .png>.txt` (default true). */
  txt?: boolean;
}

export interface SheetPlacement {
  index: number;
  x: number; // tile top-left in the sheet (texture pixels start here)
  y: number;
  width: number; // scaled size
  height: number;
}

export interface Sheet {
  image: Image;
  placements: SheetPlacement[];
  scale: number;
}

/** Lay out textures (no file I/O). */
export function buildTextureSheet(textures: Texture[], opts: SheetOptions = {}): Sheet {
  const scale = Math.max(1, Math.floor(opts.scale ?? (textures.every((t) => t.width <= 64 && t.height <= 64) ? 2 : 1)));
  const pad = opts.padding ?? 6;
  const labels = opts.labels !== false;
  const labelH = labels ? GLYPH_H + 3 : 0;
  const cellW = (t: Texture, i: number) => Math.max(Math.max(1, t.width) * scale, labels ? textWidth(String(i)) + 2 : 0);
  const maxWidth = Math.max(opts.maxWidth ?? 1024, ...textures.map((t, i) => cellW(t, i) + 2 * pad));

  const placements: SheetPlacement[] = [];
  let x = pad, y = pad, rowH = 0, width = 0;
  textures.forEach((t, i) => {
    const w = cellW(t, i);
    const h = Math.max(1, t.height) * scale + labelH;
    if (x + w + pad > maxWidth && x > pad) {
      x = pad;
      y += rowH + pad;
      rowH = 0;
    }
    placements.push({ index: i, x, y: y + labelH, width: Math.max(1, t.width) * scale, height: Math.max(1, t.height) * scale });
    x += w + pad;
    rowH = Math.max(rowH, h);
    width = Math.max(width, x);
  });
  const height = Math.max(1, y + rowH + pad);
  width = Math.max(1, width);

  const bg = opts.background ?? [40, 40, 48];
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = bg[0]; rgba[i * 4 + 1] = bg[1]; rgba[i * 4 + 2] = bg[2]; rgba[i * 4 + 3] = 255;
  }
  const image: Image = { width, height, rgba };
  const cell = Math.max(1, opts.checker ?? 8);
  for (const p of placements) {
    const t = textures[p.index];
    const tw = Math.max(1, t.width);
    for (let yy = 0; yy < p.height; yy++) {
      for (let xx = 0; xx < p.width; xx++) {
        const s = (Math.floor(yy / scale) * tw + Math.floor(xx / scale)) * 4;
        const a = s + 3 < t.rgba.length ? t.rgba[s + 3] / 255 : 0;
        const check = ((Math.floor(xx / cell) + Math.floor(yy / cell)) & 1) === 0 ? 153 : 102;
        const d = ((p.y + yy) * width + p.x + xx) * 4;
        for (let c = 0; c < 3; c++) {
          const tc = s + c < t.rgba.length ? t.rgba[s + c] : 0;
          rgba[d + c] = Math.round(tc * a + check * (1 - a));
        }
        rgba[d + 3] = 255;
      }
    }
    if (labels) drawText(image, p.x + 1, p.y - labelH + 1, String(p.index), 1, [255, 255, 160], true);
  }
  return { image, placements, scale };
}

/** Write the sheet PNG (and a .txt listing unless opts.txt === false). */
export function writeTextureSheet(textures: Texture[], path: string, opts: SheetOptions = {}): Sheet {
  const sheet = buildTextureSheet(textures, opts);
  writePng(path, sheet.image.width, sheet.image.height, sheet.image.rgba);
  if (opts.txt !== false) {
    const lines = [`# ${textures.length} textures, scale ${sheet.scale}; x,y = top-left of the texture pixels in ${path}`];
    lines.push('index\twidth\theight\tformat\twrapS\twrapT\tx\ty');
    for (const p of sheet.placements) {
      const t = textures[p.index];
      lines.push([p.index, t.width, t.height, t.format, t.wrapS, t.wrapT, p.x, p.y].join('\t'));
    }
    writeFileSync(path.replace(/\.png$/i, '') + '.txt', lines.join('\n') + '\n');
  }
  return sheet;
}
