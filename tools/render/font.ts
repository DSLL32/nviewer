// Tiny 3x5 bitmap font (digits, A-Z, a little punctuation) for labelling debug images.
import type { Image } from './png';

const GLYPHS: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
  '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001001001001',
  '8': '111101111101111', '9': '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
  '-': '000000111000000', '.': '000000000000010', ':': '000010000010000', '_': '000000000000111',
  '/': '001001010100100', '=': '000111000111000', '+': '000010111010000', '#': '101111101111101',
  '(': '010100100100010', ')': '010001001001010', ',': '000000000010100', '%': '101001010100101',
  '*': '000101010101000', ' ': '000000000000000',
};

export const GLYPH_W = 3;
export const GLYPH_H = 5;

/** Pixel width of `text` at `scale` (1 px spacing between glyphs, unscaled). */
export function textWidth(text: string, scale = 1): number {
  return text.length === 0 ? 0 : text.length * (GLYPH_W + 1) * scale - scale;
}

/**
 * Draw `text` with its top-left at (x, y). With `outline` a 1-scaled-pixel dark border is drawn first so the text
 * stays readable on any background. Lowercase is drawn as uppercase; unknown characters as '#'.
 */
export function drawText(
  img: Image,
  x: number,
  y: number,
  text: string,
  scale = 1,
  color: [number, number, number] = [255, 255, 255],
  outline = true,
): void {
  const plot = (px: number, py: number, c: [number, number, number]) => {
    if (px < 0 || py < 0 || px >= img.width || py >= img.height) return;
    const o = (py * img.width + px) * 4;
    img.rgba[o] = c[0];
    img.rgba[o + 1] = c[1];
    img.rgba[o + 2] = c[2];
    img.rgba[o + 3] = 255;
  };
  const pass = (dx: number, dy: number, c: [number, number, number]) => {
    let cx = x;
    for (const ch of text.toUpperCase()) {
      const g = GLYPHS[ch] ?? GLYPHS['#'];
      for (let gy = 0; gy < GLYPH_H; gy++) {
        for (let gx = 0; gx < GLYPH_W; gx++) {
          if (g[gy * GLYPH_W + gx] !== '1') continue;
          for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) plot(cx + gx * scale + sx + dx, y + gy * scale + sy + dy, c);
        }
      }
      cx += (GLYPH_W + 1) * scale;
    }
  };
  if (outline) {
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) pass(dx * scale, dy * scale, [0, 0, 0]);
  }
  pass(0, 0, color);
}
