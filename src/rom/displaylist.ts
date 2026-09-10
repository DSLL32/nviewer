// N64 display-list interpretation (F3DEX 1.x and F3DEX2 microcode) into
// render-ready triangle batches.
import { decodeTexture, ImFmt, ImSiz, loadBlock, Tlut, TMEM_SIZE, type TextureDesc } from './texture';
import type { Batch, BlendMode, Texture, WrapMode } from './types';
import { view } from './util';

export type Ucode = 'f3dex' | 'f3dex2';

export interface DisplayListContext {
  buf: Uint8Array;
  ucode: Ucode;
  // Map display-list/vertex and texture image addresses to offsets in buf (-1: not in buf).
  resolve: (addr: number) => number;
  resolveImage?: (addr: number) => number; // defaults to resolve
  // Whether the game has back-face culling enabled when it draws these display lists
  // (set by game code, not by the lists themselves).
  cullBackByDefault?: boolean;
  // Texture cache shared across the display lists of a level.
  textures: Texture[];
  textureKeys: Map<string, number>;
  keyPrefix: string;
}

// Vertex coordinates are 1/16 of a world unit in both games.
const VERTEX_SCALE = 1 / 16;

// RSP commands whose opcodes differ between the microcodes.
const F3DEX2 = {
  VTX: 0x01, TRI1: 0x05, TRI2: 0x06, QUAD: 0x07, TEXTURE: 0xd7, GEOMETRYMODE: 0xd9,
  DL: 0xde, ENDDL: 0xdf, SETOTHERMODE_L: 0xe2, SETOTHERMODE_H: 0xe3,
};
const F3DEX = {
  VTX: 0x04, DL: 0x06, BRANCH_Z: 0xb0, TRI2: 0xb1, QUAD: 0xb5, RDPHALF_1: 0xb4,
  CLEARGEOMETRYMODE: 0xb6, SETGEOMETRYMODE: 0xb7, ENDDL: 0xb8, SETOTHERMODE_L: 0xb9,
  SETOTHERMODE_H: 0xba, TEXTURE: 0xbb, TRI1: 0xbf,
};
// RDP commands, identical in both.
const enum Rdp {
  LOADTLUT = 0xf0, SETTILESIZE = 0xf2, LOADBLOCK = 0xf3, SETTILE = 0xf5, SETCOMBINE = 0xfc, SETTIMG = 0xfd,
}

const G_ZBUFFER = 0x1;
const G_CULL_BACK = { f3dex: 0x2000, f3dex2: 0x400 };
const RM_Z_CMP = 0x10, RM_Z_UPD = 0x20, RM_CVG_X_ALPHA = 0x1000, RM_FORCE_BL = 0x4000;
const RM_ZMODE_MASK = 0xc00, RM_ZMODE_XLU = 0x800;

interface Tile {
  fmt: number; siz: number; width: number; height: number; cms: number; cmt: number; shiftS: number; shiftT: number;
  uls: number; ult: number; // upper-left texel of the tile, subtracted from texture coordinates
  line: number; tmem: number; // bytes per texel row, offset into texture memory
}

interface State {
  vtx: { x: number; y: number; z: number; s: number; t: number; c: number }[];
  geometryMode: number;
  renderMode: number;
  alphaCompare: number;
  textLut: number;
  combineUsesTexel: boolean;
  textureOn: boolean;
  scaleS: number;
  scaleT: number;
  timg: number;
  timgSiz: number;
  image: number;
  palette: number;
  mem: Uint8Array; // RDP texture memory
  loadKey: string; // identifies the last block load into texture memory
  tiles: Tile[];
  rdpHalf1: number;
}

interface BatchBuilder { batch: Omit<Batch, 'positions' | 'uvs' | 'colors'>; pos: number[]; uv: number[]; col: number[] }

export function runDisplayList(ctx: DisplayListContext, start: number): Batch[] {
  const { buf, resolve } = ctx;
  const dv = view(buf);
  const st: State = {
    vtx: [], geometryMode: G_ZBUFFER | (ctx.cullBackByDefault ? G_CULL_BACK[ctx.ucode] : 0), renderMode: RM_Z_CMP | RM_Z_UPD, alphaCompare: 0, textLut: 0,
    // Many objects set up a texture without a G_TEXTURE command of their own: the
    // game leaves texturing enabled between objects.
    combineUsesTexel: true, textureOn: true, scaleS: 1, scaleT: 1, timg: -1, timgSiz: 0, image: -1, palette: -1,
    mem: new Uint8Array(TMEM_SIZE), loadKey: '',
    tiles: Array.from({ length: 8 }, () => ({ fmt: 0, siz: 0, width: 0, height: 0, cms: 0, cmt: 0, shiftS: 0, shiftT: 0, uls: 0, ult: 0, line: 0, tmem: 0 })),
    rdpHalf1: 0,
  };
  const builders = new Map<string, BatchBuilder>();

  const currentTexture = (): number => {
    if (!st.textureOn || !st.combineUsesTexel || st.image < 0) return -1;
    const t = st.tiles[0];
    if (t.width <= 0 || t.height <= 0) return -1;
    const wrap = (cm: number): WrapMode => (cm & 2 ? 'clamp' : cm & 1 ? 'mirror' : 'repeat');
    const ci = t.fmt === ImFmt.CI && st.palette >= 0;
    const desc: TextureDesc = {
      fmt: t.fmt as ImFmt, siz: t.siz as ImSiz, width: t.width, height: t.height,
      mem: st.mem, tmem: t.tmem, line: t.siz === ImSiz.B32 ? t.line * 2 : t.line,
      palette: ci ? buf.subarray(st.palette, st.palette + 512) : null, tlut: st.textLut as Tlut,
    };
    const key = `${ctx.keyPrefix}${st.loadKey}/${t.tmem}/${desc.line}/${ci ? st.palette : -1}/${desc.fmt}/${desc.siz}/${desc.width}x${desc.height}/${desc.tlut}/${t.cms}/${t.cmt}`;
    let idx = ctx.textureKeys.get(key);
    if (idx === undefined) {
      idx = ctx.textures.length;
      const fmtName = ['RGBA', 'YUV', 'CI', 'IA', 'I'][desc.fmt] + [4, 8, 16, 32][desc.siz];
      ctx.textures.push({
        width: t.width, height: t.height, rgba: decodeTexture(desc), wrapS: wrap(t.cms), wrapT: wrap(t.cmt),
        format: desc.fmt === ImFmt.CI ? `${fmtName}/${desc.tlut === Tlut.Ia16 ? 'IA16' : 'RGBA16'}` : fmtName,
      });
      ctx.textureKeys.set(key, idx);
    }
    return idx;
  };

  const triangle = (a: number, b: number, c: number) => {
    if (!st.vtx[a] || !st.vtx[b] || !st.vtx[c]) return;
    const texture = currentTexture();
    const rm = st.renderMode;
    const blend: BlendMode = rm & RM_FORCE_BL && ((rm & RM_ZMODE_MASK) === RM_ZMODE_XLU || !(rm & RM_Z_UPD))
      ? 'blend'
      : rm & RM_CVG_X_ALPHA || st.alphaCompare ? 'cutout' : 'opaque';
    const zbuf = (st.geometryMode & G_ZBUFFER) !== 0;
    const depthTest = zbuf && (rm & RM_Z_CMP) !== 0;
    const depthWrite = zbuf && (rm & RM_Z_UPD) !== 0 && blend !== 'blend';
    const cullBack = (st.geometryMode & G_CULL_BACK[ctx.ucode]) !== 0;
    const key = `${texture}/${blend}/${depthTest}/${depthWrite}/${cullBack}`;
    let bb = builders.get(key);
    if (!bb) {
      bb = { batch: { texture, blend, depthTest, depthWrite, cullBack }, pos: [], uv: [], col: [] };
      builders.set(key, bb);
    }
    const tile = st.tiles[0];
    const shift = (s: number) => (s > 10 ? 1 << (16 - s) : 1 / (1 << s));
    const su = texture >= 0 ? (st.scaleS * shift(tile.shiftS)) / (32 * tile.width) : 0;
    const sv = texture >= 0 ? (st.scaleT * shift(tile.shiftT)) / (32 * tile.height) : 0;
    // The games' worlds are mirrored relative to a right-handed, Y-up frame: negate X
    // (see mirrorPlacementX). The winding then follows OpenGL (counter-clockwise front).
    for (const i of [a, b, c]) {
      const v = st.vtx[i];
      bb.pos.push(-v.x * VERTEX_SCALE, v.y * VERTEX_SCALE, v.z * VERTEX_SCALE);
      // The RDP samples texel (s - uls, t - ult) of the tile.
      bb.uv.push(texture >= 0 ? v.s * su - tile.uls / tile.width : 0, texture >= 0 ? v.t * sv - tile.ult / tile.height : 0);
      bb.col.push(v.c >>> 24, (v.c >>> 16) & 0xff, (v.c >>> 8) & 0xff, v.c & 0xff);
    }
  };

  const vertices = (addr: number, n: number, v0: number) => {
    const base = resolve(addr);
    if (base < 0) return;
    for (let k = 0; k < n; k++) {
      const o = base + k * 16;
      if (o + 16 > buf.length) break;
      st.vtx[v0 + k] = {
        x: dv.getInt16(o), y: dv.getInt16(o + 2), z: dv.getInt16(o + 4),
        s: dv.getInt16(o + 8), t: dv.getInt16(o + 10), c: dv.getUint32(o + 12),
      };
    }
  };

  const otherMode = (low: boolean, shift: number, len: number, w1: number) => {
    const mask = (((1 << len) - 1) << shift) >>> 0;
    if (low) {
      if (shift === 0) st.alphaCompare = w1 & 3;
      if (shift <= 3 && shift + len > 3) st.renderMode = ((st.renderMode & ~mask) | (w1 & mask)) >>> 0;
    } else if (shift <= 14 && shift + len >= 16) {
      st.textLut = (w1 >>> 14) & 3;
    }
  };

  const rdp = (w0: number, w1: number) => {
    switch (w0 >>> 24) {
      case Rdp.SETCOMBINE: {
        const colorInputs = [
          (w0 >>> 20) & 0xf, (w1 >>> 28) & 0xf, (w0 >>> 15) & 0x1f, (w1 >>> 15) & 0x7,
          (w0 >>> 5) & 0xf, (w1 >>> 24) & 0xf, w0 & 0x1f, (w1 >>> 6) & 0x7,
        ];
        st.combineUsesTexel = colorInputs.some((v) => v === 1 || v === 2);
        break;
      }
      case Rdp.SETTIMG:
        st.timg = (ctx.resolveImage ?? resolve)(w1);
        st.timgSiz = (w0 >>> 19) & 3;
        break;
      case Rdp.LOADBLOCK: {
        if (st.timg < 0) break;
        const tile = st.tiles[(w1 >>> 24) & 7];
        const bytes = ((((w1 >>> 12) & 0xfff) - ((w0 >>> 12) & 0xfff) + 1) << st.timgSiz) >> 1;
        const dxt = w1 & 0xfff;
        loadBlock(st.mem, buf, st.timg, bytes, tile.tmem, dxt, tile.siz as ImSiz);
        st.image = st.timg;
        st.loadKey = `${st.timg}/${bytes}/${tile.tmem}/${dxt}/${tile.siz}`;
        break;
      }
      case Rdp.LOADTLUT:
        st.palette = st.timg;
        break;
      case Rdp.SETTILE: {
        const t = st.tiles[(w1 >>> 24) & 7];
        t.fmt = (w0 >>> 21) & 7;
        t.siz = (w0 >>> 19) & 3;
        t.line = ((w0 >>> 9) & 0x1ff) * 8;
        t.tmem = (w0 & 0x1ff) * 8;
        t.cmt = (w1 >>> 18) & 3;
        t.shiftT = (w1 >>> 10) & 0xf;
        t.cms = (w1 >>> 8) & 3;
        t.shiftS = w1 & 0xf;
        break;
      }
      case Rdp.SETTILESIZE: {
        const t = st.tiles[(w1 >>> 24) & 7];
        t.uls = ((w0 >>> 12) & 0xfff) / 4;
        t.ult = (w0 & 0xfff) / 4;
        t.width = (((w1 >>> 12) & 0xfff) >> 2) - (((w0 >>> 12) & 0xfff) >> 2) + 1;
        t.height = ((w1 & 0xfff) >> 2) - ((w0 & 0xfff) >> 2) + 1;
        break;
      }
      default:
        break; // sync, no-op and colour commands carry nothing we render
    }
  };

  const tri = (w: number) => triangle(((w >>> 16) & 0xff) >> 1, ((w >>> 8) & 0xff) >> 1, (w & 0xff) >> 1);
  const f3dex2 = ctx.ucode === 'f3dex2';
  const stack: number[] = [];
  let pc = resolve(start);
  for (let steps = 0; steps < 1_000_000; steps++) {
    if (pc < 0 || pc + 8 > buf.length) break;
    const w0 = dv.getUint32(pc);
    const w1 = dv.getUint32(pc + 4);
    pc += 8;
    const op = w0 >>> 24;
    let call = -1; // display list to call or branch to
    let push = false;
    let end = false;
    if (f3dex2) {
      switch (op) {
        case F3DEX2.VTX: {
          const n = (w0 >>> 12) & 0xff;
          vertices(w1, n, ((w0 & 0xff) >> 1) - n);
          break;
        }
        case F3DEX2.TRI1: tri(w0); break;
        case F3DEX2.TRI2: case F3DEX2.QUAD: tri(w0); tri(w1); break;
        case F3DEX2.TEXTURE:
          st.textureOn = (w0 & 2) !== 0;
          st.scaleS = (w1 >>> 16) / 65536;
          st.scaleT = (w1 & 0xffff) / 65536;
          break;
        case F3DEX2.GEOMETRYMODE: st.geometryMode = ((st.geometryMode & (w0 & 0xffffff)) | w1) >>> 0; break;
        case F3DEX2.SETOTHERMODE_L:
        case F3DEX2.SETOTHERMODE_H: {
          const len = (w0 & 0xff) + 1;
          otherMode(op === F3DEX2.SETOTHERMODE_L, 32 - ((w0 >>> 8) & 0xff) - len, len, w1);
          break;
        }
        case F3DEX2.DL: call = w1; push = ((w0 >>> 16) & 0xff) === 0; break;
        case F3DEX2.ENDDL: end = true; break;
        default: rdp(w0, w1);
      }
    } else {
      switch (op) {
        // The start index is stored doubled, like triangle vertex indices.
        case F3DEX.VTX: vertices(w1, (w0 >>> 10) & 0x3f, ((w0 >>> 16) & 0xff) >> 1); break;
        case F3DEX.TRI1: tri(w1); break;
        case F3DEX.TRI2: tri(w0); tri(w1); break;
        case F3DEX.QUAD: {
          const [a, b, c, d] = [w1 >>> 25, (w1 >>> 17) & 0x7f, (w1 >>> 9) & 0x7f, (w1 >>> 1) & 0x7f];
          triangle(a, b, c);
          triangle(a, c, d);
          break;
        }
        case F3DEX.TEXTURE:
          st.textureOn = (w0 & 1) !== 0;
          st.scaleS = (w1 >>> 16) / 65536;
          st.scaleT = (w1 & 0xffff) / 65536;
          break;
        case F3DEX.SETGEOMETRYMODE: st.geometryMode = (st.geometryMode | w1) >>> 0; break;
        case F3DEX.CLEARGEOMETRYMODE: st.geometryMode = (st.geometryMode & ~w1) >>> 0; break;
        case F3DEX.SETOTHERMODE_L:
        case F3DEX.SETOTHERMODE_H:
          otherMode(op === F3DEX.SETOTHERMODE_L, (w0 >>> 8) & 0xff, w0 & 0xff, w1);
          break;
        case F3DEX.RDPHALF_1: st.rdpHalf1 = w1; break;
        // Depth-based LOD switch: branches to the near (detailed) version when close.
        case F3DEX.BRANCH_Z: call = st.rdpHalf1; break;
        case F3DEX.DL: call = w1; push = ((w0 >>> 16) & 0xff) === 0; break;
        case F3DEX.ENDDL: end = true; break;
        default: rdp(w0, w1);
      }
    }
    if (call >= 0) {
      if (push) stack.push(pc);
      pc = resolve(call);
    } else if (end) {
      if (stack.length === 0) break;
      pc = stack.pop()!;
    }
  }

  return [...builders.values()].map((b) => ({
    ...b.batch,
    positions: new Float32Array(b.pos),
    uvs: new Float32Array(b.uv),
    colors: new Uint8Array(b.col),
  }));
}
