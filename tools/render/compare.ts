// Side-by-side comparison of two images (e.g. emulator screenshot vs. software render), with an optional
// absolute-difference panel when both images end up the same size.
import { basename } from 'node:path';
import { drawText, GLYPH_H } from './font';
import { readPng, writePng, type Image } from './png';

export interface CompareOptions {
  /** Panel labels (default: file base names). Pass ['', ''] for none. */
  labels?: [string, string];
  /** Common panel height; both images are nearest-neighbour scaled to it. Default: the larger height. */
  height?: number;
  /** Add |A - B| panel when the scaled sizes match (default true). */
  diff?: boolean;
  /** Multiplier applied to the difference panel for visibility (default 3). */
  diffGain?: number;
  /** Gap between panels in pixels (default 4). */
  gap?: number;
}

export interface CompareResult {
  width: number;
  height: number;
  /** Mean absolute RGB difference 0..255 over the scaled images (only when sizes match). */
  meanAbsDiff?: number;
}

/** Nearest-neighbour resize. */
export function resizeNearest(img: Image, width: number, height: number): Image {
  if (img.width === width && img.height === height) return img;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(img.height - 1, Math.floor(((y + 0.5) * img.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(img.width - 1, Math.floor(((x + 0.5) * img.width) / width));
      const s = (sy * img.width + sx) * 4, d = (y * width + x) * 4;
      rgba[d] = img.rgba[s]; rgba[d + 1] = img.rgba[s + 1]; rgba[d + 2] = img.rgba[s + 2]; rgba[d + 3] = img.rgba[s + 3];
    }
  }
  return { width, height, rgba };
}

/** Compose two in-memory images side by side (A left, B right, optional diff on the far right). */
export function compareImages(a: Image, b: Image, opts: CompareOptions & { labels?: [string, string] } = {}): { image: Image } & CompareResult {
  const H = Math.max(1, Math.round(opts.height ?? Math.max(a.height, b.height)));
  const sa = resizeNearest(a, Math.max(1, Math.round((a.width * H) / a.height)), H);
  const sb = resizeNearest(b, Math.max(1, Math.round((b.width * H) / b.height)), H);
  const gap = opts.gap ?? 4;
  const labels = opts.labels ?? ['A', 'B'];
  const hasLabels = labels.some((l) => l.length > 0);
  const top = hasLabels ? GLYPH_H * 2 + 6 : 0;
  const same = sa.width === sb.width;
  const withDiff = same && opts.diff !== false;
  const panels: Image[] = [sa, sb];
  let meanAbsDiff: number | undefined;
  if (same) {
    const gain = opts.diffGain ?? 3;
    const d = new Uint8Array(sa.width * H * 4);
    let sum = 0;
    for (let i = 0; i < sa.width * H; i++) {
      for (let c = 0; c < 3; c++) {
        const v = Math.abs(sa.rgba[i * 4 + c] - sb.rgba[i * 4 + c]);
        sum += v;
        d[i * 4 + c] = Math.min(255, v * gain);
      }
      d[i * 4 + 3] = 255;
    }
    meanAbsDiff = sum / (sa.width * H * 3);
    if (withDiff) panels.push({ width: sa.width, height: H, rgba: d });
  }
  const width = panels.reduce((s, p) => s + p.width, 0) + gap * (panels.length - 1);
  const height = H + top;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) { rgba[i * 4] = 24; rgba[i * 4 + 1] = 24; rgba[i * 4 + 2] = 28; rgba[i * 4 + 3] = 255; }
  const image: Image = { width, height, rgba };
  let x0 = 0;
  const names = [labels[0], labels[1], withDiff ? `DIFF X${opts.diffGain ?? 3} MEAN ${meanAbsDiff!.toFixed(1)}` : ''];
  panels.forEach((p, n) => {
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        const s = (y * p.width + x) * 4, d = ((y + top) * width + x0 + x) * 4;
        const al = p.rgba[s + 3] / 255; // composite onto the dark background
        for (let c = 0; c < 3; c++) rgba[d + c] = Math.round(p.rgba[s + c] * al + rgba[d + c] * (1 - al));
      }
    }
    if (hasLabels && names[n]) drawText(image, x0 + 2, 2, names[n], 2, [255, 255, 255], false);
    x0 += p.width + gap;
  });
  return { image, width, height, meanAbsDiff };
}

/** Read two PNGs, write them side by side (plus a diff panel if their scaled sizes match) to `out`. */
export function sideBySide(pathA: string, pathB: string, out: string, opts: CompareOptions = {}): CompareResult {
  const labels = opts.labels ?? [basename(pathA, '.png'), basename(pathB, '.png')];
  const { image, width, height, meanAbsDiff } = compareImages(readPng(pathA), readPng(pathB), { ...opts, labels });
  writePng(out, image.width, image.height, image.rgba);
  return { width, height, meanAbsDiff };
}
