// N64 display-list interpretation (F3DEX 1.x, F3DEX2 and Fast3D microcode) into
// render-ready triangle batches.
import { decodeRows, decodeTexture, ImFmt, ImSiz, loadBlock, Tlut, TMEM_SIZE, type TextureDesc } from './texture';
import type { Batch, BlendMode, Texture, WrapMode } from './types';
import { view } from './util';

// 'f3d': Fast3D (RSP 2.0G) as GoldenEye stores its lists, with Rare's B1 (four triangles) and C0 (texture number)
// commands, which the game expands before drawing (GOLDENEYE.md §3.3).
export type Ucode = 'f3dex' | 'f3dex2' | 'f3d';

// What a C0 command resolves to: a texture already in DisplayListContext.textures and its level-0 size.
export interface RareTexture {
  texture: number; // index into ctx.textures, -1 for none
  width: number; // level-0 texels
  height: number;
  uls: number; // texels subtracted from s and t (the game's bilinear half-texel tile offset; 0 for GPU filtering)
  ult: number;
}

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
  textureScale?: [number, number]; // initial G_TEXTURE S/T scales, default 1/1
  // When true, capture G_TEXTURE scale at G_VTX and treat G_MODIFYVTX ST as final. The default applies the
  // current texture scale at triangle emission, preserving established loader output.
  textureScaleAtVertex?: boolean;
  // Initial modelview. When given, G_MTX / G_POPMTX in the lists are applied too.
  matrix?: Mtx;
  // RSP lighting: with G_LIGHTING set, vertex colour bytes are a signed normal and the
  // vertex colour is computed from these lights (a copy; G_MOVEWORD light colours in the
  // lists change it: F3DEX uses 0x20-byte slots, F3DEX2 uses 0x18-byte slots).
  lighting?: DlLighting;
  // Additional scene lighting choices to bake for an interactive viewer control.
  lightingPresets?: DlLighting[];
  // Fold the colour combiner (with PRIM and ENV colours) into the vertex colours, taking
  // TEXEL0 as 1, so that texture x vertex colour gives the combiner's output.
  combiner?: boolean;
  // Approximate G_TEXTURE_GEN (environment mapping) texture coordinates from normals.
  textureGen?: boolean;
  // Mark batches drawn with ZMODE_DEC.
  decals?: boolean;
  // How G_LOADTLUT palettes are addressed. Default: the last loaded palette. 'slots': each
  // load goes to slot (tmem / 8 - 0x100) / 16 of the load tile, and G_SETTILE's palette field
  // (w1 bits 20-23) selects the slot (BattleTanx). 'merged': 16-entry loads at tmem 0x800 +
  // 0x80 * k form one 256-entry table indexed by texel value (Global Assault).
  tlutMode?: 'slots' | 'merged';
  // Ucode 'f3d': resolves C0 texture commands (w0, w1 as stored); without it C0 leaves the geometry untextured.
  rareTexture?: (w0: number, w1: number) => RareTexture | null;
  // Added to every vertex position before scaling (GoldenEye's room position).
  vertexOffset?: [number, number, number];

  // Zelda 64 (ZELDA64.md §5.3.3): textures are the whole images G_SETTIMG points at instead of the 4 KB RDP texture
  // memory. The G_SETTILE of render tile 0 or 1 after a G_LOADBLOCK shows that load's image with its format, wrap and
  // shifts; the first G_SETTILESIZE after it gives the image size, later ones only move the window (texture scroll).
  // Texture coordinates are normalised by the image size. G_LOADTLUT writes its entries into a 256-entry TLUT memory
  // at index (tmem field - 0x100), and CI texels index TLUT[pal * 16 + texel] (pal = G_SETTILE w1 bits 20-23).
  // TEXEL0 in the alpha inputs and TEXEL0_ALPHA as a colour multiplier also count as texture use (alpha decals).
  directImages?: boolean;
  // Render state the game leaves before calling the lists: combiner words (G_SETCOMBINE w0, w1), othermode H,
  // primitive and environment colour (RGBA). Defaults: a modulate combiner, othermode H 0, white.
  combineMode?: [number, number];
  otherModeH?: number;
  primColor?: number;
  envColor?: number;
  // F3DEX2 G_RDPHALF_1 (0xE1) + G_BRANCH_Z (0x04), a depth-based detail switch: 'near' always branches to the
  // detailed list. Without it the lists continue with their far version (usually nothing).
  branchZ?: 'near';
  // Resolves G_MTX matrix addresses (default: resolve). Lets a loader map matrices in segments that hold display lists
  // otherwise, or RAM addresses, to matrix data.
  resolveMatrix?: (addr: number) => number;
  // With directImages: for combiners that blend TEXEL0 and TEXEL1 by a constant (PRIM or ENV alpha, PRIM_LOD_FRAC)
  // in the first colour cycle, emit Batch.texture1, uvs1 and texMix. The folded vertex colour takes both texels as 1.
  secondTexture?: boolean;
}

// Vertex coordinates are 1/16 of a world unit in both Rush games.
const VERTEX_SCALE = 1 / 16;

// RSP commands whose opcodes differ between the microcodes.
const F3DEX2 = {
  VTX: 0x01, MODIFYVTX: 0x02, TRI1: 0x05, TRI2: 0x06, QUAD: 0x07, POPMTX: 0xd8, MTX: 0xda,
  MOVEWORD: 0xdb, TEXTURE: 0xd7, GEOMETRYMODE: 0xd9,
  DL: 0xde, ENDDL: 0xdf, SETOTHERMODE_L: 0xe2, SETOTHERMODE_H: 0xe3, BRANCH_Z: 0x04, RDPHALF_1: 0xe1,
};
const F3DEX = {
  MTX: 0x01, VTX: 0x04, DL: 0x06, BRANCH_Z: 0xb0, TRI2: 0xb1, MODIFYVTX: 0xb2, QUAD: 0xb5, RDPHALF_1: 0xb4,
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
const G_CULL_BACK = { f3dex: 0x2000, f3dex2: 0x400, f3d: 0x2000 };
const G_MW_LIGHTCOL = 0x0a;
const RM_Z_CMP = 0x10, RM_Z_UPD = 0x20, RM_CVG_X_ALPHA = 0x1000, RM_FORCE_BL = 0x4000;
const RM_ZMODE_MASK = 0xc00, RM_ZMODE_XLU = 0x800, RM_ZMODE_DEC = 0xc00;

interface Tile {
  fmt: number; siz: number; width: number; height: number; cms: number; cmt: number; shiftS: number; shiftT: number;
  uls: number; ult: number; // upper-left texel of the tile, subtracted from texture coordinates
  line: number; tmem: number; // bytes per texel row, offset into texture memory
  pal: number; // palette field of G_SETTILE
  // directImages: the image shown by this render tile (buffer offset, -1 none) and its size (0 until the
  // G_SETTILESIZE after the binding G_SETTILE).
  image: number; texW: number; texH: number; sizePending: boolean;
}

interface Vertex {
  x: number; y: number; z: number; s: number; t: number;
  c: number; // RGBA (shaded when lit)
  unlit: number; // RGBA with lit normals replaced by white, for the viewer's lighting control
  lighting: number[]; // RGBA for each additional lighting preset
  lit: boolean;
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
  palettes: Map<number, number>; // tlutMode 'slots': slot -> palette offset in buf
  tlut: Uint8Array; // tlutMode 'merged': 256 RGBA16 entries
  tlutKey: string;
  mem: Uint8Array; // RDP texture memory
  loadKey: string; // identifies the last load into texture memory
  tiles: Tile[];
  rare: RareTexture | null; // 'f3d': the last C0 texture
  rdpHalf1: number;
  mtx: Mtx | null;
  mtxStack: Mtx[];
  lighting: DlLighting | null;
  // directImages
  combineUsesTexel1: boolean; // the colour or alpha cycles read TEXEL1
  otherModeH: number;
  primLod: number; // PRIM_LOD_FRAC: low byte of G_SETPRIMCOLOR w0
  zTlut: Uint8Array; // 256 RGBA16/IA16 entries
  zTlutLoads: Map<number, string>; // first entry -> palette address and count, for texture keys
  lastLoad: number; // image of the last G_LOADBLOCK
}

interface BatchBuilder {
  batch: Omit<Batch, 'positions' | 'uvs' | 'colors' | 'triSource' | 'uvs1'>;
  pos: number[]; uv: number[]; uv1: number[]; col: number[]; unlit: number[]; lighting: number[][]; src: number[];
  hasLitVertices: boolean;
}

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
  const [scaleS, scaleT] = ctx.textureScale ?? [1, 1];
  const textureScaleAtVertex = ctx.textureScaleAtVertex === true;
  const st: State = {
    vtx: [],
    geometryMode: ctx.geometryMode ?? (G_ZBUFFER | (ctx.cullBackByDefault ? G_CULL_BACK[ctx.ucode] : 0)),
    renderMode: ctx.renderMode ?? (RM_Z_CMP | RM_Z_UPD), alphaCompare: ctx.alphaCompare ?? 0, textLut: 0,
    // Many objects set up a texture without a G_TEXTURE command of their own: the
    // game leaves texturing enabled between objects.
    combineUsesTexel: true, combine: decodeCombine(0xfc127e24, 0xfffff3f9), prim: 0xffffffff, env: 0xffffffff,
    textureOn: true, scaleS, scaleT, timg: -1, timgSiz: 0, timgWidth: 0, image: -1, palette: -1,
    palettes: new Map(), tlut: new Uint8Array(512), tlutKey: '',
    mem: new Uint8Array(TMEM_SIZE), loadKey: '',
    tiles: Array.from({ length: 8 }, () => ({
      fmt: 0, siz: 0, width: 0, height: 0, cms: 0, cmt: 0, shiftS: 0, shiftT: 0, uls: 0, ult: 0, line: 0, tmem: 0, pal: 0,
      image: -1, texW: 0, texH: 0, sizePending: false,
    })),
    rare: null,
    rdpHalf1: 0,
    mtx: ctx.matrix ? ctx.matrix.slice() : null,
    mtxStack: [],
    lighting: ctx.lighting
      ? { lights: ctx.lighting.lights.map((l) => ({ color: [...l.color], dir: [...l.dir] }) as DlLight), ambient: [...ctx.lighting.ambient] }
      : null,
    combineUsesTexel1: false, otherModeH: 0, primLod: 0, zTlut: new Uint8Array(512), zTlutLoads: new Map(), lastLoad: -1,
  };
  const direct = ctx.directImages === true;
  const setCombine = (w0: number, w1: number) => {
    const c = decodeCombine(w0, w1);
    const colorInputs = [c[0], c[1], c[2], c[3], c[8], c[9], c[10], c[11]];
    st.combine = c;
    st.combineUsesTexel = colorInputs.some((v) => v === 1 || v === 2);
    if (direct) {
      const alphaInputs = [c[4], c[5], c[6], c[7], c[12], c[13], c[14], c[15]];
      st.combineUsesTexel ||= alphaInputs.some((v) => v === 1) || c[2] === 8 || c[10] === 8;
      st.combineUsesTexel1 = colorInputs.some((v) => v === 2) || c[2] === 9 || c[10] === 9 || alphaInputs.some((v) => v === 2);
    }
  };
  if (ctx.combineMode) setCombine(ctx.combineMode[0], ctx.combineMode[1]);
  if (ctx.otherModeH !== undefined) {
    st.otherModeH = ctx.otherModeH >>> 0;
    st.textLut = (ctx.otherModeH >>> 14) & 3;
  }
  if (ctx.primColor !== undefined) st.prim = ctx.primColor >>> 0;
  if (ctx.envColor !== undefined) st.env = ctx.envColor >>> 0;
  const builders = new Map<string, BatchBuilder>();
  let cmdAddr = 0; // buffer offset of the command being interpreted (Batch.triSource)
  const wrapMode = (cm: number): WrapMode => (cm & 2 ? 'clamp' : cm & 1 ? 'mirror' : 'repeat');

  // directImages: the texture render tile k shows, decoded from its whole image. opaqueAlpha: alpha forced to 255, for
  // translucent or alpha-tested batches whose combiner alpha does not read the texels (intensity textures would
  // otherwise cut holes by their intensity).
  const directTexture = (k: number, opaqueAlpha = false): number => {
    const t = st.tiles[k];
    if (t.image < 0 || t.texW <= 0 || t.texH <= 0) return -1;
    const ci = t.fmt === ImFmt.CI;
    const pal = t.pal * 16;
    const tlutKey = ci ? [...st.zTlutLoads.entries()].map(([i, s]) => `${i}:${s}`).join(',') : '';
    const key = `${ctx.keyPrefix}D${t.image}/${t.fmt}/${t.siz}/${t.texW}x${t.texH}/${ci ? `${pal}/${tlutKey}/${st.textLut}` : ''}/${t.cms}/${t.cmt}${opaqueAlpha ? '/A1' : ''}`;
    let idx = ctx.textureKeys.get(key);
    if (idx === undefined) {
      idx = ctx.textures.length;
      const fmtName = ['RGBA', 'YUV', 'CI', 'IA', 'I'][t.fmt] + [4, 8, 16, 32][t.siz];
      const rgba = decodeRows(buf, t.image, t.fmt as ImFmt, t.siz as ImSiz, t.texW, t.texH, ci ? st.zTlut.subarray(pal * 2) : null, st.textLut as Tlut);
      if (opaqueAlpha) for (let q = 3; q < rgba.length; q += 4) rgba[q] = 255;
      ctx.textures.push({
        width: t.texW, height: t.texH,
        rgba,
        wrapS: wrapMode(t.cms), wrapT: wrapMode(t.cmt),
        format: ci ? `${fmtName}/${st.textLut === Tlut.Ia16 ? 'IA16' : 'RGBA16'}` : fmtName,
        source: `image 0x${t.image.toString(16)}${ci ? ` tlut ${pal ? `${pal} ` : ''}${tlutKey}` : ''}${opaqueAlpha ? ' (alpha 1: the combiner alpha does not use it)' : ''}`,
      });
      ctx.textureKeys.set(key, idx);
    }
    return idx;
  };

  // secondTexture: how the first colour cycle combines TEXEL0 and TEXEL1, null for other combiners:
  // (T1 - T0) x k + T0 with a constant k (PRIM or ENV alpha, PRIM_LOD_FRAC), or T0 x T1.
  const texelBlend = (): { blend: 'lerp' | 'multiply'; mix: number } | null => {
    const [a, b, c, d] = st.combine;
    const factor = (code: number) =>
      code === 10 ? (st.prim & 0xff) / 255 : code === 12 ? (st.env & 0xff) / 255 : code === 14 ? st.primLod / 255 : null;
    if (a === 2 && b === 1 && d === 1) {
      const k = factor(c);
      return k === null ? null : { blend: 'lerp', mix: k };
    }
    if (a === 1 && b === 2 && d === 2) {
      const k = factor(c);
      return k === null ? null : { blend: 'lerp', mix: 1 - k };
    }
    // b >= 8 and d = 7 read as 0.
    if (((a === 2 && c === 1) || (a === 1 && c === 2)) && b >= 8 && d === 7) return { blend: 'multiply', mix: 1 };
    return null;
  };

  const combineAlphaUsesTexel = () => [4, 5, 6, 7, 12, 13, 14, 15].some((i) => st.combine[i] === 1 || st.combine[i] === 2);

  const currentTexture = (opaqueAlpha = false): number => {
    if (ctx.ucode === 'f3d') return st.textureOn && st.combineUsesTexel && st.rare ? st.rare.texture : -1;
    if (direct) return st.textureOn && st.combineUsesTexel ? directTexture(0, opaqueAlpha) : -1;
    if (!st.textureOn || !st.combineUsesTexel || st.image < 0) return -1;
    const t = st.tiles[0];
    if (t.width <= 0 || t.height <= 0) return -1;
    const wrap = (cm: number): WrapMode => (cm & 2 ? 'clamp' : cm & 1 ? 'mirror' : 'repeat');
    const merged = ctx.tlutMode === 'merged';
    const paletteAt = ctx.tlutMode === 'slots' ? (st.palettes.get(t.pal) ?? st.palette) : st.palette;
    const ci = t.fmt === ImFmt.CI && (merged ? st.tlutKey !== '' : paletteAt >= 0);
    const desc: TextureDesc = {
      fmt: t.fmt as ImFmt, siz: t.siz as ImSiz, width: t.width, height: t.height,
      mem: st.mem, tmem: t.tmem, line: t.siz === ImSiz.B32 ? t.line * 2 : t.line,
      palette: ci ? (merged ? st.tlut : buf.subarray(paletteAt, paletteAt + 512)) : null, tlut: st.textLut as Tlut,
    };
    const paletteKey = ci ? (merged ? st.tlutKey : paletteAt) : -1;
    const key = `${ctx.keyPrefix}${st.loadKey}/${t.tmem}/${desc.line}/${paletteKey}/${desc.fmt}/${desc.siz}/${desc.width}x${desc.height}/${desc.tlut}/${t.cms}/${t.cmt}`;
    let idx = ctx.textureKeys.get(key);
    if (idx === undefined) {
      idx = ctx.textures.length;
      const fmtName = ['RGBA', 'YUV', 'CI', 'IA', 'I'][desc.fmt] + [4, 8, 16, 32][desc.siz];
      ctx.textures.push({
        width: t.width, height: t.height, rgba: decodeTexture(desc), wrapS: wrap(t.cms), wrapT: wrap(t.cmt),
        format: desc.fmt === ImFmt.CI ? `${fmtName}/${desc.tlut === Tlut.Ia16 ? 'IA16' : 'RGBA16'}` : fmtName,
        source: `image 0x${st.image.toString(16)}${ci ? (merged ? ` tlut ${st.tlutKey}` : ` palette 0x${paletteAt.toString(16)}`) : ''} tmem 0x${t.tmem.toString(16)}`,
      });
      ctx.textureKeys.set(key, idx);
    }
    return idx;
  };

  const triangle = (a: number, b: number, c: number) => {
    if (!st.vtx[a] || !st.vtx[b] || !st.vtx[c]) return;
    const rm = st.renderMode;
    const blend: BlendMode = rm & RM_FORCE_BL && ((rm & RM_ZMODE_MASK) === RM_ZMODE_XLU || !(rm & RM_Z_UPD))
      ? 'blend'
      : rm & RM_CVG_X_ALPHA || st.alphaCompare ? 'cutout' : 'opaque';
    // directImages: texel alpha only counts when the combiner's alpha reads a texel.
    const opaqueAlpha = direct && blend !== 'opaque' && !combineAlphaUsesTexel();
    const texture = currentTexture(opaqueAlpha);
    const zbuf = (st.geometryMode & G_ZBUFFER) !== 0;
    const depthTest = zbuf && (rm & RM_Z_CMP) !== 0;
    const depthWrite = zbuf && (rm & RM_Z_UPD) !== 0 && blend !== 'blend';
    const cullBack = (st.geometryMode & G_CULL_BACK[ctx.ucode]) !== 0;
    const decal = ctx.decals === true && depthTest && (rm & RM_ZMODE_MASK) === RM_ZMODE_DEC;
    // secondTexture: TEXEL1 of a constant TEXEL0 -> TEXEL1 blend.
    const tb = direct && ctx.secondTexture && texture >= 0 && st.combineUsesTexel1 ? texelBlend() : null;
    const texture1 = tb !== null ? directTexture(1, opaqueAlpha) : -1;
    const key = `${texture}/${blend}/${depthTest}/${depthWrite}/${cullBack}${decal ? '/decal' : ''}${texture1 >= 0 ? `/${texture1}/${tb!.blend}/${tb!.mix}` : ''}`;
    let bb = builders.get(key);
    if (!bb) {
      bb = {
        batch: {
          texture, blend, depthTest, depthWrite, cullBack, ...(decal ? { decal } : {}),
          ...(texture1 >= 0 ? { texture1, texBlend: tb!.blend, ...(tb!.blend === 'lerp' ? { texMix: tb!.mix } : {}) } : {}),
        },
        pos: [], uv: [], uv1: [], col: [], unlit: [], lighting: (ctx.lightingPresets ?? []).map(() => []), src: [], hasLitVertices: false,
      };
      builders.set(key, bb);
    }
    bb.src.push(cmdAddr);
    const rt = ctx.ucode === 'f3d' ? st.rare : null;
    const tile = rt ? { width: rt.width, height: rt.height, uls: rt.uls, ult: rt.ult, shiftS: 0, shiftT: 0 }
      : direct ? { ...st.tiles[0], width: st.tiles[0].texW, height: st.tiles[0].texH } : st.tiles[0];
    const shift = (s: number) => (s > 10 ? 1 << (16 - s) : 1 / (1 << s));
    const su = texture < 0 ? 0 : textureScaleAtVertex
      ? shift(tile.shiftS) / (32 * tile.width)
      : (st.scaleS * shift(tile.shiftS)) / (32 * tile.width);
    const sv = texture < 0 ? 0 : textureScaleAtVertex
      ? shift(tile.shiftT) / (32 * tile.height)
      : (st.scaleT * shift(tile.shiftT)) / (32 * tile.height);
    const tile1 = st.tiles[1];
    const su1 = texture1 < 0 ? 0 : textureScaleAtVertex
      ? shift(tile1.shiftS) / (32 * tile1.texW)
      : (st.scaleS * shift(tile1.shiftS)) / (32 * tile1.texW);
    const sv1 = texture1 < 0 ? 0 : textureScaleAtVertex
      ? shift(tile1.shiftT) / (32 * tile1.texH)
      : (st.scaleT * shift(tile1.shiftT)) / (32 * tile1.texH);
    const fold = ctx.combiner ? { prim: rgbaUnit(st.prim), env: rgbaUnit(st.env) } : null;
    // The Rush worlds are mirrored relative to a right-handed, Y-up frame: negate X
    // (see mirrorPlacementX). The winding then follows OpenGL (counter-clockwise front).
    const mx = mirrorX ? -scale : scale;
    const [ox, oy, oz] = ctx.vertexOffset ?? [0, 0, 0];
    for (const i of [a, b, c]) {
      const v = st.vtx[i];
      bb.pos.push((v.x + ox) * mx, (v.y + oy) * scale, (v.z + oz) * scale);
      if (texture < 0) bb.uv.push(0, 0);
      else if (v.gen) bb.uv.push(v.gen[0], v.gen[1]);
      // The RDP samples texel (s - uls, t - ult) of the tile.
      else bb.uv.push(v.s * su - tile.uls / tile.width, v.t * sv - tile.ult / tile.height);
      if (texture1 >= 0) {
        if (v.gen) bb.uv1.push(v.gen[0], v.gen[1]);
        else bb.uv1.push(v.s * su1 - tile1.uls / tile1.texW, v.t * sv1 - tile1.ult / tile1.texH);
      }
      if (fold) {
        const out = evalCombine(st.combine, rgbaUnit(v.c), fold.prim, fold.env);
        bb.col.push(...out.map((q) => Math.round(q * 255)));
        const unlit = evalCombine(st.combine, rgbaUnit(v.unlit), fold.prim, fold.env);
        bb.unlit.push(...unlit.map((q) => Math.round(q * 255)));
        bb.lighting.forEach((colors, k) => {
          // A render-state batch can contain both lit and unlit vertices. Presets only
          // alter lit vertices; unlit ones retain their ordinary post-combiner colour.
          // Append either way so every preset buffer stays vertex-aligned.
          const preset = v.lighting[k] === undefined
            ? out
            : evalCombine(st.combine, rgbaUnit(v.lighting[k]), fold.prim, fold.env);
          colors.push(...preset.map((q) => Math.round(q * 255)));
        });
      } else {
        // GoldenEye: the C0 expander patches the combiners' second alpha cycle from SHADE to ENV alpha (shade alpha
        // carries fog), so the list's FB alpha is the surface alpha (verified: RAM 1F1093FF -> 1F1493FF, Egyptian pool).
        const alpha = ctx.ucode === 'f3d' ? Math.round(((v.c & 0xff) * (st.env & 0xff)) / 255) : v.c & 0xff;
        bb.col.push(v.c >>> 24, (v.c >>> 16) & 0xff, (v.c >>> 8) & 0xff, alpha);
        bb.unlit.push(v.unlit >>> 24, (v.unlit >>> 16) & 0xff, (v.unlit >>> 8) & 0xff, alpha);
        bb.lighting.forEach((colors, k) => {
          const color = v.lighting[k] ?? v.c;
          colors.push(color >>> 24, (color >>> 16) & 0xff, (color >>> 8) & 0xff, alpha);
        });
      }
      bb.hasLitVertices ||= v.lit;
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
      const color = dv.getUint32(o + 12);
      let s = dv.getInt16(o + 8), t = dv.getInt16(o + 10);
      if (textureScaleAtVertex) {
        s *= st.scaleS;
        t *= st.scaleT;
      }
      const v: Vertex = {
        x, y, z, s, t, c: color,
        unlit: lit ? ((0xffffff00 | (color & 0xff)) >>> 0) : color, lighting: [], lit, gen: null,
      };
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
          const shade = (L: DlLighting) => {
            let r = L.ambient[0], g = L.ambient[1], bl = L.ambient[2];
            for (const l of L.lights) {
              const d = Math.max(0, nx * l.dir[0] + ny * l.dir[1] + nz * l.dir[2]);
              r += l.color[0] * d;
              g += l.color[1] * d;
              bl += l.color[2] * d;
            }
            const q = (c: number) => Math.min(255, Math.round(c));
            return ((q(r) << 24) | (q(g) << 16) | (q(bl) << 8) | buf[o + 15]) >>> 0;
          };
          v.c = shade(st.lighting!);
          v.lighting = (ctx.lightingPresets ?? []).map(shade);
        }
        if (gen) v.gen = [nx * 0.5 + 0.5, -ny * 0.5 + 0.5];
      }
      st.vtx[v0 + k] = v;
    }
  };

  // G_MODIFYVTX changes an already transformed cache entry. Pokémon Snap uses
  // RGBA and ST patches to join vertices loaded under parent and child matrices.
  const modifyVertex = (where: number, index: number, value: number) => {
    const v = st.vtx[index];
    if (!v) return;
    if (where === 0x10) {
      v.c = value >>> 0;
      v.unlit = v.lit ? ((0xffffff00 | (value & 0xff)) >>> 0) : value >>> 0;
    } else if (where === 0x14) {
      v.s = value >> 16;
      v.t = (value << 16) >> 16;
      if (textureScaleAtVertex) v.gen = null;
    }
  };

  const moveWord = (offset: number, index: number, value: number, stride: number) => {
    if (!st.lighting || index !== G_MW_LIGHTCOL || offset % stride !== 0) return;
    const k = offset / stride;
    const color: [number, number, number] = [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff];
    if (k < st.lighting.lights.length) st.lighting.lights[k].color = color;
    else if (k === st.lighting.lights.length) st.lighting.ambient = color;
  };

  const loadMatrix = (addr: number, projection: boolean, load: boolean, push: boolean) => {
    if (!st.mtx || projection) return;
    const o = (ctx.resolveMatrix ?? resolve)(addr);
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
    } else {
      st.otherModeH = ((st.otherModeH & ~mask) | (w1 & mask)) >>> 0;
      if (shift <= 14 && shift + len >= 16) st.textLut = (w1 >>> 14) & 3;
    }
  };

  const rdp = (w0: number, w1: number) => {
    switch (w0 >>> 24) {
      case Rdp.SETCOMBINE:
        setCombine(w0, w1);
        break;
      case Rdp.SETPRIMCOLOR:
        st.prim = w1 >>> 0;
        st.primLod = w0 & 0xff;
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
        if (direct) {
          st.lastLoad = st.timg;
          break;
        }
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
      case Rdp.LOADTLUT: {
        const tile = st.tiles[(w1 >>> 24) & 7];
        if (direct) {
          if (st.timg < 0) break;
          const first = (tile.tmem >> 3) - 0x100;
          const count = ((w1 >>> 14) & 0x3ff) + 1;
          for (let i = 0; i < count && first + i >= 0 && first + i < 256; i++) {
            st.zTlut[(first + i) * 2] = buf[st.timg + i * 2] ?? 0;
            st.zTlut[(first + i) * 2 + 1] = buf[st.timg + i * 2 + 1] ?? 0;
          }
          for (const k of [...st.zTlutLoads.keys()]) if (k >= first && k < first + count) st.zTlutLoads.delete(k);
          st.zTlutLoads.set(first, `${st.timg.toString(16)}+${count}`);
          break;
        }
        if (ctx.tlutMode === 'merged') {
          if (st.timg < 0) break;
          const first = (tile.tmem - 0x800) >> 3;
          const count = ((w1 >>> 14) & 0x3ff) + 1;
          for (let i = 0; i < count && first + i >= 0 && first + i < 256; i++) {
            st.tlut[(first + i) * 2] = buf[st.timg + i * 2] ?? 0;
            st.tlut[(first + i) * 2 + 1] = buf[st.timg + i * 2 + 1] ?? 0;
          }
          st.tlutKey += `${st.timg}@${first},`;
        } else if (ctx.tlutMode === 'slots') {
          st.palettes.set(((tile.tmem >> 3) - 0x100) >> 4, st.timg);
        }
        st.palette = st.timg;
        break;
      }
      case 0xe8: // G_RDPTILESYNC starts each palette group in Global Assault's texture chunks
        if (ctx.tlutMode === 'merged') st.tlutKey = '';
        break;
      case Rdp.SETTILE: {
        const k = (w1 >>> 24) & 7;
        const t = st.tiles[k];
        t.fmt = (w0 >>> 21) & 7;
        t.siz = (w0 >>> 19) & 3;
        t.line = ((w0 >>> 9) & 0x1ff) * 8;
        t.tmem = (w0 & 0x1ff) * 8;
        t.pal = (w1 >>> 20) & 0xf;
        t.cmt = (w1 >>> 18) & 3;
        t.shiftT = (w1 >>> 10) & 0xf;
        t.cms = (w1 >>> 8) & 3;
        t.shiftS = w1 & 0xf;
        // directImages: a render tile shows the image of the preceding load (tile 7 is the load tile).
        if (direct && k !== 7) {
          t.image = st.lastLoad;
          t.texW = t.texH = 0;
          t.sizePending = true;
        }
        break;
      }
      case Rdp.SETTILESIZE: {
        const t = st.tiles[(w1 >>> 24) & 7];
        t.uls = ((w0 >>> 12) & 0xfff) / 4;
        t.ult = (w0 & 0xfff) / 4;
        t.width = (((w1 >>> 12) & 0xfff) >> 2) - (((w0 >>> 12) & 0xfff) >> 2) + 1;
        t.height = ((w1 & 0xfff) >> 2) - ((w0 & 0xfff) >> 2) + 1;
        if (direct && t.sizePending) {
          // gsDPLoadTextureBlock sets the true image size here; later commands move the window only.
          t.sizePending = false;
          t.texW = t.width;
          t.texH = t.height;
        }
        break;
      }
      default:
        break; // sync, culling, no-op and other commands carry nothing we render
    }
  };

  const tri = (w: number) => triangle(((w >>> 16) & 0xff) >> 1, ((w >>> 8) & 0xff) >> 1, (w & 0xff) >> 1);
  const f3dex2 = ctx.ucode === 'f3dex2';
  const f3d = ctx.ucode === 'f3d';
  const stack: number[] = [];
  let pc = resolve(start);
  for (let steps = 0; steps < 1_000_000; steps++) {
    if (pc < 0 || pc + 8 > buf.length) break;
    const w0 = dv.getUint32(pc);
    const w1 = dv.getUint32(pc + 4);
    cmdAddr = pc;
    pc += 8;
    const op = w0 >>> 24;
    let call = -1; // display list to call or branch to
    let push = false;
    let end = false;
    if (f3d) {
      switch (op) {
        // Fast3D G_VTX: w0 = 04 | (n - 1) << 20 | v0 << 16 | n * 16 (4-bit count and start).
        case 0x04: vertices(w1, ((w0 >>> 20) & 0xf) + 1, (w0 >>> 16) & 0xf); break;
        // Fast3D G_TRI1: vertex indices stored multiplied by 10.
        case F3DEX.TRI1: triangle(((w1 >>> 16) & 0xff) / 10, ((w1 >>> 8) & 0xff) / 10, (w1 & 0xff) / 10); break;
        // Rare B1: four triangles of 4-bit indices, triangle k = (w1 >> 8k+4, w1 >> 8k, w0 >> 4k); (0, 0, 0) = unused.
        case 0xb1:
          for (let k = 0; k < 4; k++) {
            const i0 = (w1 >>> (8 * k + 4)) & 15, i1 = (w1 >>> (8 * k)) & 15, i2 = (w0 >>> (4 * k)) & 15;
            if (i0 | i1 | i2) triangle(i0, i1, i2);
          }
          break;
        case 0xc0: st.rare = ctx.rareTexture ? ctx.rareTexture(w0, w1) : null; break;
        // G_MTX, as in F3DEX (GoldenEye's models load their matrix slots); applied only when ctx.matrix is given.
        case F3DEX.MTX: {
          const p = (w0 >>> 16) & 0xff;
          loadMatrix(w1, (p & 1) !== 0, (p & 2) !== 0, (p & 4) !== 0);
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
        case F3DEX.DL: call = w1; push = ((w0 >>> 16) & 0xff) === 0; break;
        case F3DEX.ENDDL: end = true; break;
        default: rdp(w0, w1);
      }
    } else if (f3dex2) {
      switch (op) {
        case F3DEX2.VTX: {
          const n = (w0 >>> 12) & 0xff;
          vertices(w1, n, ((w0 & 0xff) >> 1) - n);
          break;
        }
        case F3DEX2.MODIFYVTX:
          modifyVertex((w0 >>> 16) & 0xff, (w0 & 0xffff) >>> 1, w1);
          break;
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
        case F3DEX2.MOVEWORD:
          moveWord(w0 & 0xffff, (w0 >>> 16) & 0xff, w1, 0x18);
          break;
        case F3DEX2.DL: call = w1; push = ((w0 >>> 16) & 0xff) === 0; break;
        case F3DEX2.ENDDL: end = true; break;
        case F3DEX2.RDPHALF_1: st.rdpHalf1 = w1; break;
        case F3DEX2.BRANCH_Z: if (ctx.branchZ === 'near') call = st.rdpHalf1; break;
        default: rdp(w0, w1);
      }
    } else {
      switch (op) {
        // The start index is stored doubled, like triangle vertex indices.
        case F3DEX.VTX: vertices(w1, (w0 >>> 10) & 0x3f, ((w0 >>> 16) & 0xff) >> 1); break;
        // F3DEX/F3DLX uses opcode B2 (F3DEX2 uses 02).
        case F3DEX.MODIFYVTX: modifyVertex((w0 >>> 16) & 0xff, (w0 & 0xffff) >>> 1, w1); break;
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
          moveWord(offset, w0 & 0xff, w1, 0x20);
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
    ...(b.hasLitVertices ? { unlitColors: new Uint8Array(b.unlit) } : {}),
    ...(b.hasLitVertices && b.lighting.length ? { lightingColors: b.lighting.map((colors) => new Uint8Array(colors)) } : {}),
    triSource: new Uint32Array(b.src),
    ...(b.batch.texture1 !== undefined ? { uvs1: new Float32Array(b.uv1) } : {}),
  }));
}
