// N64 display-list interpretation (F3DEX 1.x and F3DEX2 microcode) into
// render-ready triangle batches.
import { decodeTexture, ImFmt, ImSiz, loadBlock, Tlut, TMEM_SIZE, type TextureDesc } from './texture';
import type { Batch, BlendMode, Texture, WrapMode } from './types';
import { view } from './util';

export type Ucode = 'f3dex' | 'f3dex2';

// A directional light as the RSP uses it: colour 0..255, unit direction in the space the
// vertex normals are transformed into (world space for the supported games).
export interface DlLight {
  color: [number, number, number];
  dir: [number, number, number];
}

export interface DlLighting {
  lights: DlLight[];
  ambient: [number, number, number];
}

// Row-major 4x4 in the N64's row-vector convention (v' = v M), as G_MTX loads it.
export type Mtx = number[];

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

  // The options below default to what the Rush games need.
  vertexScale?: number; // world units per vertex unit, default 1/16
  mirrorX?: boolean; // negate X (default true)
  // State the game sets up before calling the lists: geometry mode (default G_ZBUFFER,
  // plus G_CULL_BACK with cullBackByDefault), render mode bits of G_SETOTHERMODE_L
  // (default Z_CMP | Z_UPD) and alpha compare.
  geometryMode?: number;
  renderMode?: number;
  alphaCompare?: number;
  // Initial modelview. When given, G_MTX / G_POPMTX in the lists are applied too.
  matrix?: Mtx;
  // RSP lighting: with G_LIGHTING set, vertex colour bytes are a signed normal and the
  // vertex colour is computed from these lights (a copy; G_MOVEWORD light colours in the
  // lists change it: offset 0x20 * k = light k, 0x20 * lights.length = ambient).
  lighting?: DlLighting;
  // Fold the colour combiner (with PRIM and ENV colours) into the vertex colours, taking
  // TEXEL0 as 1, so that texture x vertex colour gives the combiner's output.
  combiner?: boolean;
  // Approximate G_TEXTURE_GEN (environment mapping) texture coordinates from normals.
  textureGen?: boolean;
  // Mark batches drawn with ZMODE_DEC.
  decals?: boolean;
}

// Vertex coordinates are 1/16 of a world unit in both Rush games.
const VERTEX_SCALE = 1 / 16;

// RSP commands whose opcodes differ between the microcodes.
const F3DEX2 = {
  VTX: 0x01, TRI1: 0x05, TRI2: 0x06, QUAD: 0x07, POPMTX: 0xd8, MTX: 0xda, TEXTURE: 0xd7, GEOMETRYMODE: 0xd9,
  DL: 0xde, ENDDL: 0xdf, SETOTHERMODE_L: 0xe2, SETOTHERMODE_H: 0xe3,
};
const F3DEX = {
  MTX: 0x01, VTX: 0x04, DL: 0x06, BRANCH_Z: 0xb0, TRI2: 0xb1, QUAD: 0xb5, RDPHALF_1: 0xb4,
  CLEARGEOMETRYMODE: 0xb6, SETGEOMETRYMODE: 0xb7, ENDDL: 0xb8, SETOTHERMODE_L: 0xb9,
  SETOTHERMODE_H: 0xba, TEXTURE: 0xbb, MOVEWORD: 0xbc, POPMTX: 0xbd, TRI1: 0xbf,
};
// RDP commands, identical in both.
const enum Rdp {
  LOADTLUT = 0xf0, SETTILESIZE = 0xf2, LOADBLOCK = 0xf3, LOADTILE = 0xf4, SETTILE = 0xf5,
  SETPRIMCOLOR = 0xfa, SETENVCOLOR = 0xfb, SETCOMBINE = 0xfc, SETTIMG = 0xfd,
}

const G_ZBUFFER = 0x1;
const G_LIGHTING = 0x20000;
const G_TEXTURE_GEN = 0x40000;
const G_CULL_BACK = { f3dex: 0x2000, f3dex2: 0x400 };
const G_MW_LIGHTCOL = 0x0a;
const RM_Z_CMP = 0x10, RM_Z_UPD = 0x20, RM_CVG_X_ALPHA = 0x1000, RM_FORCE_BL = 0x4000;
const RM_ZMODE_MASK = 0xc00, RM_ZMODE_XLU = 0x800, RM_ZMODE_DEC = 0xc00;

interface Tile {
  fmt: number; siz: number; width: number; height: number; cms: number; cmt: number; shiftS: number; shiftT: number;
  uls: number; ult: number; // upper-left texel of the tile, subtracted from texture coordinates
  line: number; tmem: number; // bytes per texel row, offset into texture memory
}

interface Vertex {
  x: number; y: number; z: number; s: number; t: number;
  c: number; // RGBA (shaded when lit)
  gen: [number, number] | null; // generated texture coordinates (0..1)
}

interface State {
  vtx: Vertex[];
  geometryMode: number;
  renderMode: number;
  alphaCompare: number;
  textLut: number;
  combineUsesTexel: boolean;
  combine: number[];
  prim: number;
  env: number;
  textureOn: boolean;
  scaleS: number;
  scaleT: number;
  timg: number;
  timgSiz: number;
  timgWidth: number;
  image: number;
  palette: number;
  mem: Uint8Array; // RDP texture memory
  loadKey: string; // identifies the last load into texture memory
  tiles: Tile[];
  rdpHalf1: number;
  mtx: Mtx | null;
  mtxStack: Mtx[];
  lighting: DlLighting | null;
}

interface BatchBuilder { batch: Omit<Batch, 'positions' | 'uvs' | 'colors'>; pos: number[]; uv: number[]; col: number[] }

// G_SETCOMBINE fields per cycle: color a, b, c, d then alpha a, b, c, d
// (output = (a - b) * c + d).
function decodeCombine(w0: number, w1: number): number[] {
  return [
    (w0 >>> 20) & 15, (w1 >>> 28) & 15, (w0 >>> 15) & 31, (w1 >>> 15) & 7,
    (w0 >>> 12) & 7, (w1 >>> 12) & 7, (w0 >>> 9) & 7, (w1 >>> 9) & 7,
    (w0 >>> 5) & 15, (w1 >>> 24) & 15, w0 & 31, (w1 >>> 6) & 7,
    (w1 >>> 21) & 7, (w1 >>> 3) & 7, (w1 >>> 18) & 7, w1 & 7,
  ];
}

// Both combiner cycles for one vertex with TEXEL0 = TEXEL1 = 1: the colour the texture must
// be multiplied by. Exact for (TEX - 0) * X + 0, (X - 0) * TEX + 0 and untextured forms;
// lerps between texel and another input are approximated. NOISE, K4, K5, LOD and the
// like count as 0.
function evalCombine(c: number[], shade: number[], prim: number[], env: number[]): number[] {
  let comb = [0, 0, 0, 0];
  for (let cycle = 0; cycle < 2; cycle++) {
    const [a, b, cc, d, aa, ab, ac, ad] = c.slice(cycle * 8, cycle * 8 + 8);
    const rgb = (code: number, k: number, slot: 'a' | 'b' | 'c' | 'd') => {
      switch (code) {
        case 0: return comb[k];
        case 1: case 2: return 1;
        case 3: return prim[k];
        case 4: return shade[k];
        case 5: return env[k];
        case 6: return slot === 'a' || slot === 'd' ? 1 : 0; // ONE / CENTER, SCALE
        case 7: return slot === 'c' ? comb[3] : 0; // COMBINED_ALPHA / NOISE, K4, 0
        case 8: case 9: return slot === 'c' ? 1 : 0; // TEXEL0/1_ALPHA (c only)
        case 10: return slot === 'c' ? prim[3] : 0;
        case 11: return slot === 'c' ? shade[3] : 0;
        case 12: return slot === 'c' ? env[3] : 0;
        default: return 0;
      }
    };
    const alpha = (code: number, slot: 'a' | 'b' | 'c' | 'd') => {
      switch (code) {
        case 0: return slot === 'c' ? 0 : comb[3]; // COMBINED / LOD_FRACTION
        case 1: case 2: return 1;
        case 3: return prim[3];
        case 4: return shade[3];
        case 5: return env[3];
        case 6: return slot === 'c' ? 0 : 1; // ONE / PRIM_LOD_FRAC
        default: return 0;
      }
    };
    const out = [0, 1, 2].map((k) => (rgb(a, k, 'a') - rgb(b, k, 'b')) * rgb(cc, k, 'c') + rgb(d, k, 'd'));
    out.push((alpha(aa, 'a') - alpha(ab, 'b')) * alpha(ac, 'c') + alpha(ad, 'd'));
    comb = out.map((v) => Math.min(1, Math.max(0, v)));
  }
  return comb;
}

const rgbaUnit = (v: number) => [v >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff].map((q) => q / 255);

export function mulMtx(a: Mtx, b: Mtx): Mtx {
  const r = new Array<number>(16).fill(0);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[i * 4 + k] * b[k * 4 + j];
      r[i * 4 + j] = s;
    }
  }
  return r;
}

export function runDisplayList(ctx: DisplayListContext, start: number): Batch[] {
  const { buf, resolve } = ctx;
  const dv = view(buf);
  const scale = ctx.vertexScale ?? VERTEX_SCALE;
  const mirrorX = ctx.mirrorX ?? true;
  const st: State = {
    vtx: [],
    geometryMode: ctx.geometryMode ?? (G_ZBUFFER | (ctx.cullBackByDefault ? G_CULL_BACK[ctx.ucode] : 0)),
    renderMode: ctx.renderMode ?? (RM_Z_CMP | RM_Z_UPD), alphaCompare: ctx.alphaCompare ?? 0, textLut: 0,
    // Many objects set up a texture without a G_TEXTURE command of their own: the
    // game leaves texturing enabled between objects.
    combineUsesTexel: true, combine: decodeCombine(0xfc127e24, 0xfffff3f9), prim: 0xffffffff, env: 0xffffffff,
    textureOn: true, scaleS: 1, scaleT: 1, timg: -1, timgSiz: 0, timgWidth: 0, image: -1, palette: -1,
    mem: new Uint8Array(TMEM_SIZE), loadKey: '',
    tiles: Array.from({ length: 8 }, () => ({ fmt: 0, siz: 0, width: 0, height: 0, cms: 0, cmt: 0, shiftS: 0, shiftT: 0, uls: 0, ult: 0, line: 0, tmem: 0 })),
    rdpHalf1: 0,
    mtx: ctx.matrix ? ctx.matrix.slice() : null,
    mtxStack: [],
    lighting: ctx.lighting
      ? { lights: ctx.lighting.lights.map((l) => ({ color: [...l.color], dir: [...l.dir] }) as DlLight), ambient: [...ctx.lighting.ambient] }
      : null,
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
    const decal = ctx.decals === true && depthTest && (rm & RM_ZMODE_MASK) === RM_ZMODE_DEC;
    const key = `${texture}/${blend}/${depthTest}/${depthWrite}/${cullBack}${decal ? '/decal' : ''}`;
    let bb = builders.get(key);
    if (!bb) {
      bb = { batch: { texture, blend, depthTest, depthWrite, cullBack, ...(decal ? { decal } : {}) }, pos: [], uv: [], col: [] };
      builders.set(key, bb);
    }
    const tile = st.tiles[0];
    const shift = (s: number) => (s > 10 ? 1 << (16 - s) : 1 / (1 << s));
    const su = texture >= 0 ? (st.scaleS * shift(tile.shiftS)) / (32 * tile.width) : 0;
    const sv = texture >= 0 ? (st.scaleT * shift(tile.shiftT)) / (32 * tile.height) : 0;
    const fold = ctx.combiner ? { prim: rgbaUnit(st.prim), env: rgbaUnit(st.env) } : null;
    // The Rush worlds are mirrored relative to a right-handed, Y-up frame: negate X
    // (see mirrorPlacementX). The winding then follows OpenGL (counter-clockwise front).
    const mx = mirrorX ? -scale : scale;
    for (const i of [a, b, c]) {
      const v = st.vtx[i];
      bb.pos.push(v.x * mx, v.y * scale, v.z * scale);
      if (texture < 0) bb.uv.push(0, 0);
      else if (v.gen) bb.uv.push(v.gen[0], v.gen[1]);
      // The RDP samples texel (s - uls, t - ult) of the tile.
      else bb.uv.push(v.s * su - tile.uls / tile.width, v.t * sv - tile.ult / tile.height);
      if (fold) {
        const out = evalCombine(st.combine, rgbaUnit(v.c), fold.prim, fold.env);
        bb.col.push(...out.map((q) => Math.round(q * 255)));
      } else {
        bb.col.push(v.c >>> 24, (v.c >>> 16) & 0xff, (v.c >>> 8) & 0xff, v.c & 0xff);
      }
    }
  };

  // The RSP transforms and shades vertices when they are loaded.
  const vertices = (addr: number, n: number, v0: number) => {
    const base = resolve(addr);
    if (base < 0) return;
    const m = st.mtx;
    const lit = st.lighting !== null && (st.geometryMode & G_LIGHTING) !== 0;
    const gen = ctx.textureGen === true && (st.geometryMode & G_TEXTURE_GEN) !== 0;
    for (let k = 0; k < n; k++) {
      const o = base + k * 16;
      if (o + 16 > buf.length) break;
      let x = dv.getInt16(o), y = dv.getInt16(o + 2), z = dv.getInt16(o + 4);
      if (m) {
        const tx = x * m[0] + y * m[4] + z * m[8] + m[12];
        const ty = x * m[1] + y * m[5] + z * m[9] + m[13];
        z = x * m[2] + y * m[6] + z * m[10] + m[14];
        x = tx;
        y = ty;
      }
      const v: Vertex = { x, y, z, s: dv.getInt16(o + 8), t: dv.getInt16(o + 10), c: dv.getUint32(o + 12), gen: null };
      if (lit || gen) {
        let nx = dv.getInt8(o + 12), ny = dv.getInt8(o + 13), nz = dv.getInt8(o + 14);
        if (m) {
          const tx = nx * m[0] + ny * m[4] + nz * m[8];
          const ty = nx * m[1] + ny * m[5] + nz * m[9];
          nz = nx * m[2] + ny * m[6] + nz * m[10];
          nx = tx;
          ny = ty;
        }
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        if (lit) {
          const L = st.lighting!;
          let r = L.ambient[0], g = L.ambient[1], bl = L.ambient[2];
          for (const l of L.lights) {
            const d = Math.max(0, nx * l.dir[0] + ny * l.dir[1] + nz * l.dir[2]);
            r += l.color[0] * d;
            g += l.color[1] * d;
            bl += l.color[2] * d;
          }
          const q = (c: number) => Math.min(255, Math.round(c));
          v.c = ((q(r) << 24) | (q(g) << 16) | (q(bl) << 8) | buf[o + 15]) >>> 0;
        }
        if (gen) v.gen = [nx * 0.5 + 0.5, -ny * 0.5 + 0.5];
      }
      st.vtx[v0 + k] = v;
    }
  };

  const loadMatrix = (addr: number, projection: boolean, load: boolean, push: boolean) => {
    if (!st.mtx || projection) return;
    const o = resolve(addr);
    if (o < 0 || o + 64 > buf.length) return;
    const m: Mtx = [];
    for (let i = 0; i < 16; i++) m.push((dv.getInt16(o + i * 2) * 65536 + dv.getUint16(o + 32 + i * 2)) / 65536);
    if (push) st.mtxStack.push(st.mtx);
    st.mtx = load ? m : mulMtx(m, st.mtx);
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
        st.combine = decodeCombine(w0, w1);
        break;
      }
      case Rdp.SETPRIMCOLOR:
        st.prim = w1 >>> 0;
        break;
      case Rdp.SETENVCOLOR:
        st.env = w1 >>> 0;
        break;
      case Rdp.SETTIMG:
        st.timg = (ctx.resolveImage ?? resolve)(w1);
        st.timgSiz = (w0 >>> 19) & 3;
        st.timgWidth = (w0 & 0x3ff) + 1;
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
      case Rdp.LOADTILE: {
        // Copies the texel rectangle [sl..sh] x [tl..th] of the image (row stride from
        // G_SETTIMG) into texture memory at the tile's tmem, `line` bytes per row, odd
        // rows stored with their word halves swapped. The tile takes the image's texel size.
        if (st.timg < 0) break;
        const tile = st.tiles[(w1 >>> 24) & 7];
        const sl = ((w0 >>> 12) & 0xfff) >> 2, tl = (w0 & 0xfff) >> 2;
        const sh = ((w1 >>> 12) & 0xfff) >> 2, th = (w1 & 0xfff) >> 2;
        const bpt = [0, 1, 2, 4][st.timgSiz];
        if (!bpt) break;
        const swap = st.timgSiz === ImSiz.B32 ? 8 : 4;
        const line = st.timgSiz === ImSiz.B32 ? tile.line * 2 : tile.line;
        for (let j = 0; j <= th - tl; j++) {
          for (let i = 0; i <= sh - sl; i++) {
            const s = st.timg + ((tl + j) * st.timgWidth + sl + i) * bpt;
            const d = tile.tmem + line * j + i * bpt;
            for (let k = 0; k < bpt; k++) {
              st.mem[((d + k) ^ (j & 1 ? swap : 0)) & (TMEM_SIZE - 1)] = s + k < buf.length ? buf[s + k] : 0;
            }
          }
        }
        tile.siz = st.timgSiz;
        st.image = st.timg;
        st.loadKey = `T${st.timg}/${st.timgWidth}/${sl},${tl},${sh},${th}/${tile.tmem}/${tile.line}`;
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
        break; // sync, culling, no-op and other commands carry nothing we render
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
        case F3DEX2.MTX: {
          const p = (w0 & 0xff) ^ 1; // push is stored inverted
          loadMatrix(w1, (p & 4) !== 0, (p & 2) !== 0, (p & 1) !== 0);
          break;
        }
        case F3DEX2.POPMTX:
          if (st.mtx) for (let k = w1 >>> 6; k > 0 && st.mtxStack.length; k--) st.mtx = st.mtxStack.pop()!;
          break;
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
        case F3DEX.MTX: {
          const p = (w0 >>> 16) & 0xff;
          loadMatrix(w1, (p & 1) !== 0, (p & 2) !== 0, (p & 4) !== 0);
          break;
        }
        case F3DEX.POPMTX:
          if (st.mtx && st.mtxStack.length) st.mtx = st.mtxStack.pop()!;
          break;
        case F3DEX.MOVEWORD: {
          const offset = (w0 >>> 8) & 0xffff;
          if (st.lighting && (w0 & 0xff) === G_MW_LIGHTCOL && (offset & 0x1f) === 0) {
            const k = offset >> 5;
            const color: [number, number, number] = [w1 >>> 24, (w1 >>> 16) & 0xff, (w1 >>> 8) & 0xff];
            if (k < st.lighting.lights.length) st.lighting.lights[k].color = color;
            else if (k === st.lighting.lights.length) st.lighting.ambient = color;
          }
          break;
        }
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
