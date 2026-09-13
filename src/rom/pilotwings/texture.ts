// UVTX -> viewer Texture. Simulates the texture's own display list (the game calls it through G_DL, 0x8023031C) on
// a 4 KB RDP texture memory with the viewer's texture.ts: FD SETTIMG selects the image (first FD: the file's own
// texels, later FDs: the texels of texture `secondId`, as the UVTX parser 0x802265B8 relocates them), F5 SETTILE
// describes tiles, F3 LOADBLOCK copies into memory (dxt 0: odd rows stay as stored, and texture.ts fetches odd rows
// word-half swapped, which is how the files store them), F2 SETTILESIZE gives the tile window.
// The render tile is the G_TEXTURE (BB) tile field: tile 1 for most textures, tile 0 for a few.
import { decodeTexture, loadBlock, TMEM_SIZE, type ImFmt, type ImSiz, type Tlut } from '../texture';
import type { Texture, WrapMode } from '../types';
import type { Uvtx } from './model';

interface TileState { fmt: number; siz: number; line: number; tmem: number; cms: number; cmt: number; shiftS: number; shiftT: number; w: number; h: number; uls: number; ult: number; image: number }

export interface TexInfo {
  texture: Texture;
  renderTile: number;
  levels: number; // G_TEXTURE levels field (mip levels - 1)
  width: number; height: number; // render tile size in texels
  shiftS: number; shiftT: number;
  scaleS: number; scaleT: number; // G_TEXTURE
  twoImages: boolean;
  secondary?: { texture: Texture; width: number; height: number; shiftS: number; shiftT: number; blend: 'lerp' | 'multiply'; mix?: number };
  flags18: number; b34: number; // used by the render-mode switch (0x802213A4)
}

const wrap = (cm: number): WrapMode => (cm & 2 ? 'clamp' : cm & 1 ? 'mirror' : 'repeat');
const FMT = ['RGBA', 'YUV', 'CI', 'IA', 'I'];

export function decodeUvtx(id: number, get: (id: number) => Uvtx): TexInfo {
  const t = get(id);
  const mem = new Uint8Array(TMEM_SIZE);
  const tiles: TileState[] = Array.from({ length: 8 }, () => ({ fmt: 0, siz: 0, line: 0, tmem: 0, cms: 0, cmt: 0, shiftS: 0, shiftT: 0, w: 0, h: 0, uls: 0, ult: 0, image: -1 }));
  let fdCount = 0, timgSiz = 0, image = -1, lastLoad = -1;
  let renderTile = 1, levels = 0, scaleS = 1, scaleT = 1;
  const srcOf = (img: number) => (img === 0 ? t.texels : get(t.secondId & 0xfff).texels);
  for (const [w0, w1] of t.dl) {
    switch (w0 >>> 24) {
      case 0xbb: renderTile = (w0 >>> 8) & 7; levels = (w0 >>> 11) & 7; scaleS = (w1 >>> 16) / 65536; scaleT = (w1 & 0xffff) / 65536; break;
      case 0xfd: image = fdCount++ === 0 ? 0 : 1; timgSiz = (w0 >>> 19) & 3; break;
      case 0xf5: {
        const k = (w1 >>> 24) & 7, s = tiles[k];
        s.fmt = (w0 >>> 21) & 7; s.siz = (w0 >>> 19) & 3; s.line = ((w0 >>> 9) & 0x1ff) * 8; s.tmem = (w0 & 0x1ff) * 8;
        s.cmt = (w1 >>> 18) & 3; s.shiftT = (w1 >>> 10) & 15; s.cms = (w1 >>> 8) & 3; s.shiftS = w1 & 15;
        if (k !== 7) s.image = lastLoad;
        break;
      }
      case 0xf3: {
        const t7 = tiles[(w1 >>> 24) & 7];
        const bytes = ((((w1 >>> 12) & 0xfff) - ((w0 >>> 12) & 0xfff) + 1) << timgSiz) >> 1;
        const src = srcOf(image);
        loadBlock(mem, src, 0, Math.min(bytes, TMEM_SIZE), t7.tmem, w1 & 0xfff, t7.siz as ImSiz);
        lastLoad = image;
        break;
      }
      case 0xf2: {
        const s = tiles[(w1 >>> 24) & 7];
        s.uls = ((w0 >>> 12) & 0xfff) / 4; s.ult = (w0 & 0xfff) / 4;
        s.w = (((w1 >>> 12) & 0xfff) >> 2) - (((w0 >>> 12) & 0xfff) >> 2) + 1;
        s.h = ((w1 & 0xfff) >> 2) - ((w0 & 0xfff) >> 2) + 1;
        break;
      }
      default: break;
    }
  }
  const decodeTile = (tile: number) => {
    const s = tiles[tile];
    // Scrolling two-image textures have no SETTILESIZE for render tile 0 in their list: the scroll code emits it
    // every frame with the size of secondId. Otherwise fall back to the selected image's header size.
    const sizeOf = s.image === 1 ? get(t.secondId & 0xfff) : t;
    const width = s.w || sizeOf.width, height = s.h || sizeOf.height;
    const rgba = decodeTexture({ fmt: s.fmt as ImFmt, siz: s.siz as ImSiz, width, height, mem, tmem: s.tmem, line: s.line, palette: null, tlut: 0 as Tlut });
    const texture: Texture = {
      width, height, rgba, wrapS: wrap(s.cms), wrapT: wrap(s.cmt),
      format: FMT[s.fmt] + [4, 8, 16, 32][s.siz],
      source: `UVTX ${id} tile ${tile} tmem 0x${s.tmem.toString(16)} image ${s.image === 1 ? `of UVTX ${t.secondId & 0xfff}` : 'own'}`,
    };
    return { texture, width, height, shiftS: s.shiftS, shiftT: s.shiftT };
  };
  const primary = decodeTile(renderTile);
  let secondary: TexInfo['secondary'];
  if (fdCount > 1) {
    const other = decodeTile(renderTile === 0 ? 1 : 0);
    const combine = t.dl.find(([w0]) => w0 >>> 24 === 0xfc);
    const a = combine ? (combine[0] >>> 20) & 15 : -1;
    const b = combine ? (combine[1] >>> 28) & 15 : -1;
    const c = combine ? (combine[0] >>> 15) & 31 : -1;
    const d = combine ? (combine[1] >>> 15) & 7 : -1;
    const multiply = ((a === 2 && c === 1) || (a === 1 && c === 2)) && b >= 8 && d === 7;
    // Three materials use a per-pixel/LOD blend factor that Batch cannot express; a half mix is the stable frame-0 approximation.
    secondary = { ...other, blend: multiply ? 'multiply' : 'lerp', ...(multiply ? {} : { mix: 0.5 }) };
  }
  return { texture: primary.texture, renderTile, levels, width: primary.width, height: primary.height, shiftS: primary.shiftS, shiftT: primary.shiftT, scaleS, scaleT, twoImages: fdCount > 1, secondary, flags18: t.flags18, b34: t.b34 };
}
