// The game stores each track's art as packed CI4 rows. Its display-list
// builder describes the source as a 128-wide CI8 image while loading it into
// TMEM, then describes the render tile as CI4. In other words, each 128-byte
// source row contains 256 logical texels. A palette lookup selects the first
// entry of the 16-colour RGBA16 window used by a face.
import type { Texture } from '../types';
import type { OffroadImage } from './fs';

export interface TextureWindow {
  key: string;
  selector: number;
  paletteOffset: number; // RGBA16 entries, not bytes
  row: number;
  minS: number;
  maxS: number;
  minT: number;
  maxT: number;
}

export interface MaterialTexture {
  texture: number;
  width: number;
  height: number;
  firstRow: number;
}

const expand5 = (v: number) => (v << 3) | (v >> 2);

export function buildMaterialTextures(
  image: OffroadImage,
  windows: TextureWindow[],
  paletteBase: number,
  atlasBase: number,
  atlasHeight: number,
  source: string,
): { textures: Texture[]; materials: Map<string, MaterialTexture> } {
  const width = 256;
  if (!image.contains(atlasBase, atlasHeight * 128)) throw new Error(`Off Road Challenge ${source}: CI4 atlas is out of bounds`);

  // Decode one complete atlas per referenced 16-entry palette window. This
  // keeps texture count bounded by palette use, leaves no transparent padding
  // for generated mip levels to bleed from, and preserves face palette choice.
  const textures: Texture[] = [], materials = new Map<string, MaterialTexture>();
  const textureByPalette = new Map<number, number>();
  const rangeByPalette = new Map<number, { first: number; last: number }>();
  for (const win of windows) {
    const first = win.row + win.minT, last = win.row + win.maxT;
    if (first < 0 || last >= atlasHeight) throw new Error(`Off Road Challenge ${source}: texture rows are out of bounds`);
    const old = rangeByPalette.get(win.paletteOffset);
    if (old) { old.first = Math.min(old.first, first); old.last = Math.max(old.last, last); }
    else rangeByPalette.set(win.paletteOffset, { first, last });
  }
  for (const win of [...windows].sort((a, b) => a.key.localeCompare(b.key))) {
    let texture = textureByPalette.get(win.paletteOffset);
    const range = rangeByPalette.get(win.paletteOffset)!;
    const height = range.last - range.first + 1;
    if (texture === undefined) {
      const palette = paletteBase + win.paletteOffset * 2;
      if (!image.contains(palette, 0x20)) throw new Error(`Off Road Challenge ${source}: palette for selector ${win.selector} is out of bounds`);
      const rgba = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const packed = image.u8(atlasBase + (range.first + y) * 128 + (x >> 1));
        const index = x & 1 ? packed & 0x0f : packed >>> 4;
        const color = image.u16(palette + index * 2), d = (y * width + x) * 4;
        rgba[d] = expand5((color >>> 11) & 31);
        rgba[d + 1] = expand5((color >>> 6) & 31);
        rgba[d + 2] = expand5((color >>> 1) & 31);
        rgba[d + 3] = color & 1 ? 255 : 0;
      }
      texture = textures.push({
        width, height, rgba, wrapS: 'clamp', wrapT: 'clamp', format: 'CI4/RGBA16 atlas',
        source: `${source}; palette entry ${win.paletteOffset}; logical rows ${range.first}-${range.last}`,
      }) - 1;
      textureByPalette.set(win.paletteOffset, texture);
    }
    materials.set(win.key, { texture, width, height, firstRow: range.first });
  }
  return { textures, materials };
}
