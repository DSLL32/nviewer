// Banjo-Kazooie model display lists (F3DEX 1.21) -> viewer Batches.
// An entry with Z_UPD drawn with alpha compare (FULL k4/k5: XLU_SURF2 | Z_CMP | Z_UPD
// plus B9000002 1) is cutout with depth write, because passing texels write depth.
//
// Differences from the viewer's generic runDisplayList:
//  - textures are addressed by G_SETTIMG into segment 2 (texture data after the texture-info table); the image is
//    identified by the texture info whose offset (RGBA/IA) or offset + palette size (CI) equals the address, so size
//    and format come from the info, not from RDP tile memory (mipmapped RGBA16 textures have no tile-0 SETTILE, and
//    IA8 64x192 exceeds the 4 KB tile memory);
//  - G_DL 03000000 + 16k calls entry k of the game's render-mode table (modelRender.c), chosen by depth mode;
//  - segments 0x0C..0x0F are the animated-texture frames (frame 0 = the stored address), segment 4 a runtime image.
import { decodeRows, ImFmt, ImSiz, Tlut } from '../texture';
import type { Batch, BlendMode, Texture, WrapMode } from '../types';
import { be, type Model, type TexInfo, texPalBytes } from './model';

export type DepthMode = 'none' | 'full' | 'compare';

// modelRender.c render-mode tables: entry k -> [translucent?, z compare, z update]
// opaque tables (alpha 255): k 0,1,6,7 OPA; 2..5, 8..12 XLU. Full depth: Z_CMP | Z_UPD for k 0..5, Z_CMP for 6..12.
export function renderModeEntry(k: number, depth: DepthMode, xluTable = false) {
  const xlu = xluTable || !(k === 0 || k === 1 || k === 6 || k === 7);
  const zcmp = depth !== 'none';
  const zupd = depth === 'full' && k <= 5;
  return { xlu, zcmp, zupd, aa: k % 2 === 1 || k === 12 };
}

// G_SETCOMBINE fields (same order as the viewer's decodeCombine).
function decodeCombine(w0: number, w1: number): number[] {
  return [
    (w0 >>> 20) & 15, (w1 >>> 28) & 15, (w0 >>> 15) & 31, (w1 >>> 15) & 7,
    (w0 >>> 12) & 7, (w1 >>> 12) & 7, (w0 >>> 9) & 7, (w1 >>> 9) & 7,
    (w0 >>> 5) & 15, (w1 >>> 24) & 15, w0 & 31, (w1 >>> 6) & 7,
    (w1 >>> 21) & 7, (w1 >>> 3) & 7, (w1 >>> 18) & 7, w1 & 7,
  ];
}

// Both cycles with TEXEL0 = TEXEL1 = 1 and LOD_FRACTION = 0 (level 0): the factor the texture is multiplied by.
function evalCombine(c: number[], shade: number[], prim: number[], env: number[]): number[] {
  let comb = [0, 0, 0, 0];
  for (let cycle = 0; cycle < 2; cycle++) {
    const [a, b, cc, d, aa, ab, ac, ad] = c.slice(cycle * 8, cycle * 8 + 8);
    const rgb = (code: number, k: number, slot: string) => {
      switch (code) {
        case 0: return comb[k];
        case 1: case 2: return 1;
        case 3: return prim[k];
        case 4: return shade[k];
        case 5: return env[k];
        case 6: return slot === 'a' || slot === 'd' ? 1 : 0;
        case 7: return slot === 'c' ? comb[3] : 0;
        case 8: case 9: return slot === 'c' ? 1 : 0;
        case 10: return slot === 'c' ? prim[3] : 0;
        case 11: return slot === 'c' ? shade[3] : 0;
        case 12: return slot === 'c' ? env[3] : 0;
        default: return 0; // 13 LOD_FRACTION, 14 PRIM_LOD_FRAC, 15.. = 0
      }
    };
    const alpha = (code: number, slot: string) => {
      switch (code) {
        case 0: return slot === 'c' ? 0 : comb[3];
        case 1: case 2: return 1;
        case 3: return prim[3];
        case 4: return shade[3];
        case 5: return env[3];
        case 6: return slot === 'c' ? 0 : 1;
        default: return 0;
      }
    };
    const out = [0, 1, 2].map((k) => (rgb(a, k, 'a') - rgb(b, k, 'b')) * rgb(cc, k, 'c') + rgb(d, k, 'd'));
    out.push((alpha(aa, 'a') - alpha(ab, 'b')) * alpha(ac, 'c') + alpha(ad, 'd'));
    comb = out.map((v) => Math.min(1, Math.max(0, v)));
  }
  return comb;
}

export interface BkDlContext {
  textures: Texture[];
  textureKeys: Map<string, number>;
  keyPrefix: string;
  depth: DepthMode;
  xluTable?: boolean; // the model is drawn with alpha < 255 (render-mode table XLU)
  env?: [number, number, number, number]; // 0..255; map models: mapModel env colour (default white), alpha 255
  prim?: [number, number, number, number]; // COLOR_MODE_DYNAMIC_ENV: black
  texWrap?: number; // TEXWRAP geo command in effect (1 clamp mip tiles, 2 wrap)
  scale?: number; // model scale (map description scale)
  stats?: DlStats;
  ordered?: boolean; // Preserve consecutive draw runs instead of merging matching materials across the display list.
  rule?: string; // 'geo' | 'geo2' (default) | 'geo2+glide' (also mimic Glide64mk2's fallback for FC269804 1F14FFFF: rgb = TEXEL0, no shade)
}

export interface DlStats {
  tris: number; cmds: number; unknown: Map<string, number>; textureMisses: number; staleTile: number; staleIncompatible: number;
  runtimeSeg: number; lit: number; untextured: number;
}
export const newStats = (): DlStats => ({ tris: 0, cmds: 0, unknown: new Map(), textureMisses: 0, staleTile: 0, staleIncompatible: 0, runtimeSeg: 0, lit: 0, untextured: 0 });

const IMFMT: Record<number, [ImFmt, ImSiz, string]> = {
  1: [ImFmt.CI, ImSiz.B4, 'CI4'], 2: [ImFmt.CI, ImSiz.B8, 'CI8'], 4: [ImFmt.RGBA, ImSiz.B16, 'RGBA16'],
  8: [ImFmt.RGBA, ImSiz.B32, 'RGBA32'], 16: [ImFmt.IA, ImSiz.B8, 'IA8'],
};

export function decodeTexInfo(m: Model, t: TexInfo): Uint8Array {
  const [fmt, siz] = IMFMT[t.type] ?? [ImFmt.RGBA, ImSiz.B16];
  const base = m.tex.dataStart + t.offset;
  const pal = texPalBytes(t.type);
  const palette = pal ? m.buf.subarray(base, base + pal) : null;
  return decodeRows(m.buf, base + pal, fmt, siz, t.w, t.h, palette, Tlut.Rgba16);
}

// One runner per model: RSP/RDP state persists across the model's LOADDL calls, as in the game's single task.
export function bkRunner(m: Model, ctx: BkDlContext) {
  const d = be(m.buf);
  const buf = m.buf;
  const st = ctx.stats ?? newStats();
  const env = (ctx.env ?? [255, 255, 255, 255]).map((v) => v / 255);
  const prim = (ctx.prim ?? [0, 0, 0, 0]).map((v) => v / 255);
  const byAddr = new Map<number, TexInfo>();
  for (const t of m.tex.infos) byAddr.set(t.offset + texPalBytes(t.type), t);
  const palAddr = new Set(m.tex.infos.filter((t) => texPalBytes(t.type)).map((t) => t.offset));
  const scale = ctx.scale ?? 1;

  interface V { x: number; y: number; z: number; s: number; t: number; c: number[] }
  const vtx: (V | undefined)[] = new Array(32);
  let geom = 0;
  let rmIndex = 0; // before any G_DL to segment 3 (not seen in stored lists)
  let alphaCompare = 0;
  let combine = decodeCombine(0xfc129804, 0x3f15ffff);
  let texOn = false, texTile = 0, scaleS = 1, scaleT = 1;
  let timg: TexInfo | null = null, timgRuntime = false;
  let loaded: TexInfo | null = null; // image of the last G_LOADBLOCK / G_LOADTILE
  const tile0 = { set: false, info: null as TexInfo | null, cms: 0, cmt: 0, shiftS: 0, shiftT: 0, w: 0, h: 0, fmt: 0, siz: 0 };
  type Builder = { batch: Omit<Batch, 'positions' | 'uvs' | 'colors'>; pos: number[]; uv: number[]; col: number[]; src: number[] };
  const builders = new Map<string, Builder>();
  const orderedBuilders: Builder[] = [];
  let previousKey = '';

  const wrap = (cm: number): WrapMode => (cm & 2 ? 'clamp' : cm & 1 ? 'mirror' : 'repeat');
  const G_CULL_BACK = 0x2000, G_LIGHTING = 0x20000, G_TEXTURE_GEN = 0x40000;

  const texture = (): { index: number; w: number; h: number; shiftS: number; shiftT: number } | null => {
    const usesTexel = [0, 1, 2, 3, 8, 9, 10, 11].some((i) => combine[i] === 1 || combine[i] === 2) || [4, 5, 6, 7].some((i) => combine[i] === 1);
    if (!texOn || !usesTexel) { st.untextured++; return null; }
    let info: TexInfo | null; let cms: number, cmt: number, shiftS = 0, shiftT = 0;
    if (texTile === 0) {
      // The RDP samples render tile 0 with whatever SETTILE/SETTILESIZE it last received (possibly for an earlier
      // image); the texels are the last load.
      info = loaded;
      if (!info) { st.textureMisses++; return null; }
      const [fmt, siz] = IMFMT[info.type] ?? [0, 0];
      if (tile0.info !== info) {
        st.staleTile++;
        if (!(tile0.set && tile0.fmt === fmt && tile0.siz === siz && tile0.w === info.w && tile0.h === info.h)) {
          st.staleIncompatible++;
          (st as DlStats & { staleWhere?: unknown[] }).staleWhere?.push({ tex: info.index, type: info.type, w: info.w, h: info.h, tile0: { set: tile0.set, fmt: tile0.fmt, siz: tile0.siz, w: tile0.w, h: tile0.h, tex: tile0.info?.index } });
        }
      }
      cms = tile0.cms; cmt = tile0.cmt; shiftS = tile0.shiftS; shiftT = tile0.shiftT;
    } else {
      // mip tiles 2..6 from mipMapWrapDL / mipMapClampDL (32x32 RGBA16 levels; the image is the last load)
      info = loaded;
      if (!info) { st.textureMisses++; return null; }
      cms = cmt = ctx.texWrap === 1 ? 2 : 0;
    }
    const key = `${ctx.keyPrefix}${info.index}/${cms}/${cmt}`;
    let index = ctx.textureKeys.get(key);
    if (index === undefined) {
      index = ctx.textures.length;
      ctx.textures.push({
        width: info.w, height: info.h, rgba: decodeTexInfo(m, info), wrapS: wrap(cms), wrapT: wrap(cmt),
        format: IMFMT[info.type]?.[2] ?? `type${info.type}`,
        source: `${ctx.keyPrefix}tex#${info.index} data+0x${info.offset.toString(16)}`,
      });
      ctx.textureKeys.set(key, index);
    }
    return { index, w: info.w, h: info.h, shiftS, shiftT };
  };

  const tri = (ia: number, ib: number, ic: number, cmdAt: number) => {
    const vs = [vtx[ia], vtx[ib], vtx[ic]];
    if (vs.some((v) => !v)) return;
    st.tris++;
    const rm = renderModeEntry(rmIndex, ctx.depth, ctx.xluTable);
    const blend: BlendMode = (ctx.rule ?? 'geo2') !== 'geo' && alphaCompare && rm.zupd ? 'cutout' : rm.xlu ? 'blend' : alphaCompare ? 'cutout' : 'opaque';
    const inc0 = st.staleIncompatible;
    const tex = texture();
    if (st.staleIncompatible > inc0) { const sw = (st as DlStats & { staleWhere?: { pos?: number[][]; at?: number }[] }).staleWhere; if (sw?.length) { sw[sw.length - 1].pos = vs.map((v) => [v!.x, v!.y, v!.z]); sw[sw.length - 1].at = cmdAt; } }
    const cullBack = (geom & G_CULL_BACK) !== 0;
    const depthTest = rm.zcmp, depthWrite = rm.zupd && blend !== 'blend';
    const key = `${tex?.index ?? -1}/${blend}/${depthTest}/${depthWrite}/${cullBack}`;
    let bb = ctx.ordered ? (key === previousKey ? orderedBuilders[orderedBuilders.length - 1] : undefined) : builders.get(key);
    if (!bb) {
      bb = { batch: { texture: tex?.index ?? -1, blend, depthTest, depthWrite, cullBack }, pos: [], uv: [], col: [], src: [] };
      if (ctx.ordered) orderedBuilders.push(bb);
      else builders.set(key, bb);
    }
    previousKey = key;
    bb.src.push(cmdAt);
    const sh = (s: number) => (s > 10 ? 1 << (16 - s) : 1 / (1 << s));
    const lit = (geom & G_LIGHTING) !== 0;
    for (const v of vs as V[]) {
      bb.pos.push(v.x * scale, v.y * scale, v.z * scale);
      if (!tex) bb.uv.push(0, 0);
      else if (lit && geom & G_TEXTURE_GEN) {
        // environment map: the RSP derives s,t from the transformed normal; approximate from the model normal
        const n = [v.c[0], v.c[1], v.c[2]].map((q) => (q > 127 ? q - 256 : q));
        const l = Math.hypot(n[0], n[1], n[2]) || 1;
        bb.uv.push(n[0] / l * 0.5 + 0.5, -n[1] / l * 0.5 + 0.5);
      } else bb.uv.push((v.s * scaleS * sh(tex.shiftS)) / (32 * tex.w), (v.t * scaleT * sh(tex.shiftT)) / (32 * tex.h));
      const shade = lit ? [1, 1, 1, v.c[3] / 255] : v.c.map((q) => q / 255);
      const glideT0 = ctx.rule === 'geo2+glide' && combine[0] === 2 && combine[2] === 13 && combine[10] === 4;
      const out = evalCombine(combine, glideT0 ? [1, 1, 1, shade[3]] : shade, prim, env);
      bb.col.push(...out.map((q) => Math.round(q * 255)));
    }
  };

  const gstart = m.gfxAt + 8;
  const run = (gfxIndex: number) => {
  const stack: number[] = [];
  let pc = gfxIndex;
  for (let steps = 0; steps < 1_000_000; steps++) {
    if (pc < 0 || pc >= m.gfxCount) break;
    const o = gstart + pc * 8;
    const w0 = d.getUint32(o), w1 = d.getUint32(o + 4);
    const op = w0 >>> 24;
    st.cmds++;
    pc++;
    switch (op) {
      case 0x04: { // G_VTX: v0 = byte 1 / 2, n = bits 10..15, segment 1 = Vtx[]
        const v0 = ((w0 >>> 16) & 0xff) >> 1, n = (w0 >>> 10) & 0x3f;
        const base = m.vtx.start + (w1 & 0xffffff);
        for (let k = 0; k < n; k++) {
          const q = base + k * 16;
          vtx[v0 + k] = { x: d.getInt16(q), y: d.getInt16(q + 2), z: d.getInt16(q + 4), s: d.getInt16(q + 8), t: d.getInt16(q + 10), c: [buf[q + 12], buf[q + 13], buf[q + 14], buf[q + 15]] };
        }
        if ((geom & G_LIGHTING) !== 0) st.lit += n;
        break;
      }
      case 0xbf: tri(((w1 >>> 16) & 0xff) >> 1, ((w1 >>> 8) & 0xff) >> 1, (w1 & 0xff) >> 1, o); break;
      case 0xb1:
        tri(((w0 >>> 16) & 0xff) >> 1, ((w0 >>> 8) & 0xff) >> 1, (w0 & 0xff) >> 1, o);
        tri(((w1 >>> 16) & 0xff) >> 1, ((w1 >>> 8) & 0xff) >> 1, (w1 & 0xff) >> 1, o);
        break;
      case 0xb6: geom = (geom & ~w1) >>> 0; break;
      case 0xb7: geom = (geom | w1) >>> 0; break;
      case 0xbb: // G_TEXTURE (F3DEX 1.x): on bit 0, tile bits 8-10, level bits 11-13, scale S/T
        texOn = (w0 & 1) !== 0; texTile = (w0 >>> 8) & 7; scaleS = (w1 >>> 16) / 65536; scaleT = (w1 & 0xffff) / 65536;
        break;
      case 0xb9: // SETOTHERMODE_L: only alpha compare (shift 0, len 2) occurs
        if (((w0 >>> 8) & 0xff) === 0 && (w0 & 0xff) === 2) alphaCompare = w1 & 3;
        break;
      case 0xba: break; // TEXTLUT (RGBA16 for CI) / cycle state: implied by the texture info type
      case 0x06: {
        const seg = w1 >>> 24;
        if (seg === 3) rmIndex = (w1 & 0xffffff) / 16; // render-mode table entry (SetRenderMode + EndDL)
        else if (seg === 0) { if (((w0 >>> 16) & 0xff) === 0) stack.push(pc); pc = (w1 - 0) / 8; } // not in stored lists
        break;
      }
      case 0xb8: if (stack.length) pc = stack.pop()!; else pc = -1; break;
      case 0xbd: break; // G_POPMTX (skinned objects)
      case 0xfc: combine = decodeCombine(w0, w1); break;
      case 0xfd: {
        const seg = w1 >>> 24;
        timgRuntime = seg !== 2;
        if (seg === 2 || (seg >= 0x0c && seg <= 0x0f)) timg = byAddr.get(w1 & 0xffffff) ?? null;
        else timg = null;
        if (timgRuntime) st.runtimeSeg++;
        if (!timg && seg === 2 && !palAddr.has(w1 & 0xffffff)) st.textureMisses++;
        break;
      }
      case 0xf0: break; // LOADTLUT: palette implied by the texture info
      case 0xf3: case 0xf4: loaded = timg; break;
      case 0xf5: {
        const k = (w1 >>> 24) & 7;
        if (k === 0) {
          tile0.set = true; tile0.info = loaded; tile0.fmt = (w0 >>> 21) & 7; tile0.siz = (w0 >>> 19) & 3;
          tile0.cmt = (w1 >>> 18) & 3; tile0.shiftT = (w1 >>> 10) & 0xf; tile0.cms = (w1 >>> 8) & 3; tile0.shiftS = w1 & 0xf;
        }
        break;
      }
      case 0xf2:
        if (((w1 >>> 24) & 7) === 0) { tile0.w = (((w1 >>> 12) & 0xfff) >> 2) - (((w0 >>> 12) & 0xfff) >> 2) + 1; tile0.h = ((w1 & 0xfff) >> 2) - ((w0 & 0xfff) >> 2) + 1; }
        break;
      case 0xe6: case 0xe7: case 0xfa: case 0xfb: case 0xf9: case 0xf8: break;
      default: st.unknown.set(op.toString(16), (st.unknown.get(op.toString(16)) ?? 0) + 1);
    }
    if (pc < 0) break;
  }
  };
  const batches = (): Batch[] => (ctx.ordered ? orderedBuilders : [...builders.values()]).map((b) => ({
    ...b.batch, positions: new Float32Array(b.pos), uvs: new Float32Array(b.uv), colors: new Uint8Array(b.col), triSource: new Uint32Array(b.src),
  }));
  return { run, batches, stats: st };
}
