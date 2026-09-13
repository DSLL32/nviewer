// Pilotwings 64 geometry formats. Every field order below follows the game's parsers (US ROM, RAM addresses):
//   UVTX 0x802265B8 (+ UVTI 0x80226A54), UVMD 0x802256B8, UVCT 0x80225FBC, UVTR 0x802270BC.
// The files are packed byte streams read field by field (0x80225394 = read n bytes, big-endian), not aligned structs.
// See ../notes/geometry.md.

export class Reader {
  dv: DataView;
  constructor(public d: Uint8Array, public p = 0) { this.dv = new DataView(d.buffer, d.byteOffset, d.byteLength); }
  u8() { return this.d[this.p++]; }
  u16() { const v = this.dv.getUint16(this.p); this.p += 2; return v; }
  s16() { const v = this.dv.getInt16(this.p); this.p += 2; return v; }
  u32() { const v = this.dv.getUint32(this.p); this.p += 4; return v; }
  f32() { const v = this.dv.getFloat32(this.p); this.p += 4; return v; }
  raw(n: number) { const v = this.d.subarray(this.p, this.p + n); this.p += n; return v; }
  floats(n: number) { return Array.from({ length: n }, () => this.f32()); }
}

// ---------------------------------------------------------------- packed display lists (UVMD materials, UVCT batches)
// u16 count, then per command: u16 w; if w & 0x4000 a triangle of 4-bit vertex slots (w>>8, w>>4, w) & 15,
// else u8 b: load (b >> 4) + 1 vertices starting at vertex (w & 0x3FFF) into slots from (b & 15).
// The game expands them to Fast3D G_TRI1 (BF, indices x10) and G_VTX (04 | (n-1)<<20 | slot<<16 | n*16), then G_ENDDL.
export type PackedCmd = { tri: [number, number, number] } | { vtx: { first: number; count: number; slot: number } };

export function readPackedDl(r: Reader): PackedCmd[] {
  const n = r.u16();
  const out: PackedCmd[] = [];
  for (let i = 0; i < n; i++) {
    const w = r.u16();
    if (w & 0x4000) out.push({ tri: [(w >> 8) & 15, (w >> 4) & 15, w & 15] });
    else {
      const b = r.u8();
      out.push({ vtx: { first: w & 0x3fff, count: (b >> 4) + 1, slot: b & 15 } });
    }
  }
  return out;
}

// Fast3D words as the game emits them; vertex w1 = byte offset into the vertex array + vtxBase.
export function expandFast3d(cmds: PackedCmd[], vtxBase: number): number[] {
  const w: number[] = [];
  for (const c of cmds) {
    if ('tri' in c) w.push(0xbf000000, ((c.tri[0] * 10) << 16) | ((c.tri[1] * 10) << 8) | (c.tri[2] * 10));
    else w.push((0x04000000 | ((c.vtx.count - 1) << 20) | (c.vtx.slot << 16) | (c.vtx.count * 16)) >>> 0, vtxBase + c.vtx.first * 16);
  }
  w.push(0xb8000000, 0);
  return w;
}

// ---------------------------------------------------------------- UVTX
export interface Uvtx {
  dataSize: number;
  scroll0: [number, number]; // texture scroll (u, v per ... ) for render tile 1, 0 = none (0x8023031C)
  scroll1: [number, number]; // for the second texture's tile
  texels: Uint8Array; // RDP texture-memory image (odd rows word-half swapped, LOADBLOCK dxt 0)
  dl: [number, number][]; // Fast3D: BB FC BA E6 E8 FD F5 F3 F2 FA FB B8
  width: number; height: number;
  bpp: number; // +14
  b15: number; b16: number;
  flags18: number; // high nibble: flags (0x8000 tested by the render-mode switch), low 12 bits: own id
  secondId: number; // +20: texture whose image the second FD SETTIMG points at, 0xFFF none
  u32: number; b34: number; b35: number; b36: number; b37: number; b38: number; f40: number;
}

export function parseUvtx(d: Uint8Array): Uvtx {
  const r = new Reader(d);
  const ds = r.u16();
  const nc = r.u16();
  const scroll0: [number, number] = [r.f32(), r.f32()];
  const scroll1: [number, number] = [r.f32(), r.f32()];
  const texels = r.raw(Math.min(ds, 4096));
  r.p = 0x14 + ds;
  const dl: [number, number][] = [];
  for (let i = 0; i < nc; i++) dl.push([r.u32(), r.u32()]);
  const width = r.u16(), height = r.u16(), bpp = r.u8(), b15 = r.u8(), b16 = r.u8(), flags18 = r.u16(), secondId = r.u16();
  const u32 = r.u16(), b34 = r.u8(), b35 = r.u8(), b36 = r.u8(), b37 = r.u8(), b38 = r.u8(), f40 = r.f32();
  return { dataSize: ds, scroll0, scroll1, texels, dl, width, height, bpp, b15, b16, flags18, secondId, u32, b34, b35, b36, b37, b38, f40 };
}

// ---------------------------------------------------------------- UVMD
export interface Material { state: number; nv: number; nt: number; dl: PackedCmd[] }
export interface Part { materials: Material[]; b5: number; b6: number }
export interface Lod { parts: Part[]; b5: number; distance: number }
export interface Uvmd {
  nverts: number; verts: Uint8Array; // 16-byte N64 Vtx
  lods: Lod[];
  matrices: number[][]; // one 4x4 float (row-major, row-vector v' = v M) per part
  recs36: Uint8Array[]; // per-part volumes (u8 part, f32 x6, u16 count @+28, ptr @+32 into recs6): collision? layout only
  radius: number; scaleDiv: number; f3c: number; // f32 x3: bounding radius (world units), vertex units per world unit (10), ?
  recs6: [number, number, number][];
  b119: number; // header flag (model +17 bit 0)
}

export function parseUvmd(d: Uint8Array): Uvmd {
  const r = new Reader(d);
  const nverts = r.u16(), nl = r.u8(), nm = r.u8(), nj = r.u8(), b119 = r.u8(), n6 = r.u16();
  const verts = r.raw(nverts * 16);
  const lods: Lod[] = [];
  for (let i = 0; i < nl; i++) {
    const np = r.u8(), b5 = r.u8();
    const parts: Part[] = [];
    for (let j = 0; j < np; j++) {
      const nmat = r.u8(), p5 = r.u8(), p6 = r.u8();
      const materials: Material[] = [];
      for (let k = 0; k < nmat; k++) {
        const state = r.u32(), nv = r.u16(), nt = r.u16();
        materials.push({ state, nv, nt, dl: readPackedDl(r) });
      }
      parts.push({ materials, b5: p5, b6: p6 });
    }
    lods.push({ parts, b5, distance: r.f32() });
  }
  const matrices = Array.from({ length: nm }, () => r.floats(16));
  const recs36 = Array.from({ length: nj }, () => r.raw(36));
  const radius = r.f32(), scaleDiv = r.f32(), f3c = r.f32();
  const recs6 = Array.from({ length: n6 }, () => [r.u16(), r.u16(), r.u16()] as [number, number, number]);
  return { nverts, verts, lods, matrices, recs36, radius, scaleDiv, f3c, recs6, b119 };
}

// ---------------------------------------------------------------- UVCT
export interface CtObject {
  mtx: number[][]; // one N64 16.16 Mtx per model part (row-major, row-vector), scale 1/scaleDiv, translation = pos
  model: number; // UVMD index
  pos: [number, number, number];
  mask: number; // 16-bit sub-cell mask (hypothesis)
  b: number;
}
export interface CtBatch {
  state: number; nv: number; nt: number; dl: PackedCmd[];
  firstTri: number; triCount: number; mask: number; b20: number; sphere: [number, number, number, number];
}
export interface Uvct {
  nverts: number; verts: Uint8Array;
  tris: [number, number, number, number][]; // a, b, c (vertex indices), 16-bit sub-cell mask
  objects: CtObject[];
  batches: CtBatch[];
  tail: number[]; // f32 x5 (bounding sphere x, y, z, r, ?)
}

export function fixedMtx(b: Uint8Array): number[] {
  const dv = new DataView(b.buffer, b.byteOffset, 64);
  return Array.from({ length: 16 }, (_, i) => (dv.getInt16(i * 2) * 65536 + dv.getUint16(32 + i * 2)) / 65536);
}

export function parseUvct(d: Uint8Array): Uvct {
  const r = new Reader(d);
  const nverts = r.u16(), nt = r.u16(), na = r.u16(), nb = r.u16();
  const verts = r.raw(nverts * 16);
  const tris = Array.from({ length: nt }, () => [r.u16(), r.u16(), r.u16(), r.u16()] as [number, number, number, number]);
  const objects: CtObject[] = [];
  for (let i = 0; i < na; i++) {
    const n = r.u8();
    const mtx = Array.from({ length: n }, () => fixedMtx(r.raw(64)));
    const model = r.u16();
    const pos: [number, number, number] = [r.f32(), r.f32(), r.f32()];
    objects.push({ mtx, model, pos, mask: r.u16(), b: r.u16() });
  }
  const batches: CtBatch[] = [];
  for (let i = 0; i < nb; i++) {
    const state = r.u32(), nv = r.u16(), ntr = r.u16();
    const dl = readPackedDl(r);
    const firstTri = r.u16(), triCount = r.u16(), mask = r.u16(), b20 = r.u16();
    const sphere = r.floats(4) as [number, number, number, number];
    batches.push({ state, nv, nt: ntr, dl, firstTri, triCount, mask, b20, sphere });
  }
  return { nverts, verts, tris, objects, batches, tail: r.floats(5) };
}

// ---------------------------------------------------------------- UVTR
export interface TrCell { col: number; row: number; mtx: number[]; b68: number; uvct: number }
export interface Uvtr {
  bounds: number[]; // min x, y, z, max x, y, z
  cols: number; rows: number;
  cellW: number; cellH: number; f36: number; // f36: cell bounding radius (hypothesis: ~ sqrt(w²+h²+dz²)/2)
  cells: (TrCell | null)[]; // row-major: index = row * cols + col
}

export function parseUvtr(d: Uint8Array): Uvtr {
  const r = new Reader(d);
  const bounds = r.floats(6);
  const cols = r.u8(), rows = r.u8();
  const cellW = r.f32(), cellH = r.f32(), f36 = r.f32();
  const cells: (TrCell | null)[] = [];
  for (let k = 0; k < cols * rows; k++) {
    if (!r.u8()) { cells.push(null); continue; }
    const mtx = r.floats(16);
    const b68 = r.u8();
    cells.push({ col: k % cols, row: Math.floor(k / cols), mtx, b68, uvct: r.u16() });
  }
  return { bounds, cols, rows, cellW, cellH, f36, cells };
}
// ---------------------------------------------------------------- state word (verified: 0x802213A4)
const G_SHADE = 0x4, G_ZBUFFER = 0x1, G_CULL_BACK = 0x2000, G_CULL_FRONT = 0x1000, G_SHADING_SMOOTH = 0x200, G_FOG = 0x10000;
const G_LIGHTING_TEXGEN = 0x60000;

export function geometryModeOf(state: number): number {
  let m = G_SHADE; // set by the untextured default list 0x802491B0; assumed on for textured ones (hypothesis)
  if (state & 0x08000000) m |= G_LIGHTING_TEXGEN;
  if (state & 0x00100000) m |= G_CULL_BACK;
  if (state & 0x00080000) m |= G_CULL_FRONT;
  if (state & 0x00020000) m |= G_SHADING_SMOOTH;
  if (state & 0x00200000) m |= G_ZBUFFER;
  if (state & 0x80000000) m |= G_FOG;
  return m >>> 0;
}

export function renderModeOf(state: number, tex: TexInfo | null): number {
  const untextured = tex === null;
  let a0: number;
  switch ((state & 0x01e00000) >>> 0) {
    case 0x000000: a0 = 0x03024000; break; // G_RM_OPA_SURF2
    case 0x200000: a0 = 0x00112230; break; // G_RM_ZB_OPA_SURF2
    case 0x400000: a0 = 0x00102048; break; // AA_EN|Z_CMP|IM_RD|ALPHA_CVG_SEL (no Z_UPD)
    case 0x600000: a0 = 0x00102078; break; // G_RM_AA_ZB_OPA_SURF2
    case 0x800000: a0 = 0x00104240; break; // G_RM_XLU_SURF2
    case 0xa00000: a0 = 0x00104a50; break; // G_RM_ZB_XLU_SURF2
    case 0xc00000: a0 = untextured || tex!.flags18 & 0x8000 ? 0x001041c8 : 0x00103048; break; // AA_XLU_SURF2 / AA_TEX_EDGE-like
    case 0xe00000:
      a0 = untextured ? 0x001045d8 // AA_ZB_XLU_INTER2
        : tex!.flags18 & 0x8000 || tex!.b34 === 1 || state & 0x04000000 ? 0x001049d8 // G_RM_AA_ZB_XLU_SURF2
          : 0x00103078; // G_RM_AA_ZB_TEX_EDGE2
      break;
    case 0x1000000: case 0x1200000: a0 = 0x00112e10; break; // G_RM_ZB_OPA_DECAL2
    case 0x1400000: case 0x1600000: a0 = 0x00112d58; break; // G_RM_AA_ZB_OPA_DECAL2
    case 0x1800000: case 0x1a00000: a0 = 0x00104e50; break; // G_RM_ZB_XLU_DECAL2
    default: a0 = 0x00104dd8; break; // G_RM_AA_ZB_XLU_DECAL2
  }
  if (state & 0x10000000) a0 = 0x111103f0; // depth-only
  const a1 = state & 0x80000000 ? 0xc8000000 : 0x0c080000; // G_RM_FOG_SHADE_A : G_RM_PASS
  return (a1 | a0) >>> 0;
}

// ---------------------------------------------------------------- axes
// Game: right-handed?, Z up (UVTR bounds z 0..height, vertex z = altitude). Viewer: Y up, right-handed.
// Mesh building for task levels, including:
//  - part hiding (uvDobjProps 5 = hide part, rings) and part 0 taken as identity (dobjs and sobjs replace the model's
//    root matrix with the object matrix; only UVMD 207 has a non-identity root),
//  - UVTP texture substitution (uvLevelAppend: texture id `from` loads the data of `to`),
//  - the environment recolour of vertices and texels (env_802E1C1C -> func_8020F298 / func_8020F630, kernel code_8170.c),
//    applied to the models, contours and textures that are loaded before it (island + shared + sky UVLV lists).
import { runDisplayList, mulMtx, type DisplayListContext, type Mtx } from '../displaylist';
import type { Mesh, Texture } from '../types';
import { PwRom } from './fs';
import { decodeUvtx, type TexInfo } from './texture';
import type { TintOp, V3 } from './objects';

export interface Tint { colors: [V3 | null, V3 | null]; ops: TintOp[]; models: Set<number>; contours: Set<number>; textures: Set<number> }

// ---------------------------------------------------------------- colour helpers (func_80207630 / func_80207410)
function rgb2hsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx === mn) return [-1, 0, mx];
  const d = mx - mn; let h: number;
  if (r === mx) h = (mx - b) / d - (mx - g) / d;
  else if (g === mx) h = (mx - r) / d - (mx - b) / d + 2;
  else h = (mx - g) / d - (mx - r) / d + 4;
  h *= 60; if (h < 0) h += 360;
  return [h / 360, d / mx, mx];
}
function hsv2rgb(h: number, s: number, v: number): [number, number, number] {
  if (s <= 0.0001) return [v, v, v];
  if (h < 0) h += 1; if (h === 1) h = 0;
  h *= 6; const i = Math.trunc(h), f = h - i;
  switch (i) {
    case 0: return [v, (1 - s * (1 - f)) * v, (1 - s) * v];
    case 1: return [(1 - s * f) * v, v, (1 - s) * v];
    case 2: return [(1 - s) * v, v, (1 - s * (1 - f)) * v];
    case 3: return [(1 - s) * v, (1 - s * f) * v, v];
    case 4: return [(1 - s * (1 - f)) * v, (1 - s) * v, v];
    default: return [v, (1 - s) * v, (1 - s * f) * v];
  }
}
const u8 = (x: number) => Math.max(0, Math.min(255, Math.trunc(x)));

// Vertex recolour for one op with object weight w (uvct unk28 / uvmd unk24). Vtx flag != 0 (terrain): linear,
// flag == 0 (models): cubed factors.
export function tintVerts(verts: Uint8Array, count: number, t: Tint, w: number) {
  if (w === 0) return;
  for (const op of t.ops) {
    const col = t.colors[op.light]!;
    for (let i = 0; i < count; i++) {
      const o = i * 16, flag = (verts[o + 6] << 8) | verts[o + 7];
      const c = [verts[o + 12], verts[o + 13], verts[o + 14]];
      if (op.kind === 'multiply') { // func_8020E760
        const k = col.map((cc) => 1 - (1 - cc) * w);
        for (let a = 0; a < 3; a++) verts[o + 12 + a] = u8(flag ? k[a] * c[a] : k[a] ** 3 * c[a]);
      } else if (op.light === 0) { // func_8020ABAC
        const k = op.factors!.map((f) => 1 - w * f);
        for (let a = 0; a < 3; a++) verts[o + 12 + a] = u8(flag ? k[a] * c[a] + col[a] * (1 - k[a]) * 255 : k[a] ** 3 * c[a] + (1 - k[a] ** 3) * 255 * col[a]);
      } else { // func_8020B4AC (HSV)
        const k = op.factors!.map((f) => 1 - w * f);
        const [h, s, v] = rgb2hsv(c[0] / 255, c[1] / 255, c[2] / 255);
        const h2 = k[0] * h + (1 - k[0]) * col[0], s2 = k[1] * s + (1 - k[1]) * col[1];
        const v2 = flag ? k[2] * v + (1 - k[2]) * col[2] : k[2] ** 3 * v + (1 - k[2] ** 3) * col[2];
        const rgb = hsv2rgb(h2, s2, v2);
        for (let a = 0; a < 3; a++) verts[o + 12 + a] = u8(rgb[a] * 255);
      }
    }
  }
}

// Texel recolour (func_802077BC / func_8020921C / func_8020B894). fmtClass = UVTX b34 (4 RGBA16, 2 IA, 1 I), bpp = b14.
export function tintTexels(tx: Uint8Array, size: number, fmtClass: number, bpp: number, t: Tint, w: number) {
  if (w === 0) return;
  const dv = new DataView(tx.buffer, tx.byteOffset, tx.byteLength);
  const n = Math.min(size, tx.length);
  for (const op of t.ops) {
    const col = t.colors[op.light]!;
    const k: number[] = op.kind === 'multiply' ? col.map((cc) => 1 - (1 - cc) * w) : op.factors!.map((f) => 1 - w * f);
    // scalar channel for I/IA: the component with the largest light colour (blend) or largest factor (multiply)
    let ci = 0; if (op.kind === 'multiply') { ci = k[1] > k[0] ? 1 : 0; if (k[2] > k[ci]) ci = 2; } else { ci = col[1] >= col[0] ? 1 : 0; if (col[2] >= col[ci]) ci = 2; }
    const mapI = (x: number, max: number) => {
      if (op.kind === 'multiply') return Math.trunc(k[ci] * x);
      if (op.light === 0) return Math.trunc(k[ci] * x + col[ci] * (1 - k[ci]) * max);
      return Math.trunc(k[2] * x + (1 - k[2]) * col[2] * max); // HSV: value channel
    };
    if (fmtClass === 4) {
      for (let i = 0; i + 1 < n; i += 2) {
        const wd = dv.getUint16(i);
        let r = (wd & 0xf800) >> 11, g = (wd & 0x7c0) >> 6, b = (wd & 0x3e) >> 1;
        if (op.kind === 'multiply') { r = Math.trunc(r * k[0]); g = Math.trunc(g * k[1]); b = Math.trunc(b * k[2]); }
        else if (op.light === 0) { r = Math.trunc(k[0] * r + (1 - k[0]) * col[0] * 31); g = Math.trunc(k[1] * g + (1 - k[1]) * col[1] * 31); b = Math.trunc(k[2] * b + (1 - k[2]) * col[2] * 31); }
        else { const [h, s, v] = rgb2hsv(r / 31, g / 31, b / 31); const o = hsv2rgb(k[0] * h + (1 - k[0]) * col[0], k[1] * s + (1 - k[1]) * col[1], k[2] * v + (1 - k[2]) * col[2]); r = Math.trunc(o[0] * 31); g = Math.trunc(o[1] * 31); b = Math.trunc(o[2] * 31); }
        dv.setUint16(i, ((Math.min(r, 31) << 11) | (Math.min(g, 31) << 6) | (Math.min(b, 31) << 1) | (wd & 1)) & 0xffff);
      }
    } else if (fmtClass === 2) {
      for (let i = 0; i < n; i++) {
        const x = tx[i];
        if (bpp === 4) { const lo = Math.min(7, mapI((x & 0xe) >> 1, 7)), hi = Math.min(7, mapI((x & 0xe0) >> 5, 7)); tx[i] = (hi << 5) | (x & 0x10) | (lo << 1) | (x & 1); }
        else if (bpp === 8) tx[i] = (Math.min(15, mapI(x >> 4, 15)) << 4) | (x & 15);
        else if (bpp === 16 && i % 2 === 0) tx[i] = Math.min(255, mapI(x, 255));
      }
    } else if (fmtClass === 1) {
      for (let i = 0; i < n; i++) {
        const x = tx[i];
        if (bpp === 4) tx[i] = (Math.min(15, mapI(x >> 4, 15)) << 4) | Math.min(15, mapI(x & 15, 15));
        else if (bpp === 8) tx[i] = Math.min(255, mapI(x, 255));
        else if (bpp === 16 && i % 2 === 0) { const v = Math.min(65535, mapI(dv.getUint16(i), 65535)); dv.setUint16(i, v); }
      }
    }
  }
}

// ---------------------------------------------------------------- geometry source with environment applied
export class EnvGeo {
  rom: PwRom;
  terrains: Uvtr[];
  uvtx = new Map<number, Uvtx>(); uvmd = new Map<number, Uvmd>(); uvct = new Map<number, Uvct>();
  constructor(rom: PwRom, public palette: Map<number, number> | null, public tint: Tint | null) {
    this.rom = rom;
    this.terrains = rom.comm('UVTR', 0).map(parseUvtr);
  }
  tx(id: number): Uvtx {
    let t = this.uvtx.get(id);
    if (!t) {
      const src = this.palette?.get(id) ?? id;
      t = parseUvtx(this.rom.comm('UVTX', src)[0]);
      t.texels = t.texels.slice();
      if (this.tint && this.tint.textures.has(id)) tintTexels(t.texels, t.dataSize, t.b34, t.bpp, this.tint, t.f40);
      this.uvtx.set(id, t);
    }
    return t;
  }
  md(id: number): Uvmd {
    let t = this.uvmd.get(id);
    if (!t) {
      t = parseUvmd(this.rom.comm('UVMD', id)[0]); t.verts = t.verts.slice();
      if (this.tint && this.tint.models.has(id)) tintVerts(t.verts, t.nverts, this.tint, t.f3c);
      this.uvmd.set(id, t);
    }
    return t;
  }
  ct(id: number): Uvct {
    let t = this.uvct.get(id);
    if (!t) {
      t = parseUvct(this.rom.comm('UVCT', id)[0]); t.verts = t.verts.slice();
      if (this.tint && this.tint.contours.has(id)) tintVerts(t.verts, t.nverts, this.tint, t.tail[4]);
      this.uvct.set(id, t);
    }
    return t;
  }
}

interface SecondaryBinding { texture: number; info: TexInfo; }
export interface Ctx { textures: Texture[]; keys: Map<string, number>; texInfo: Map<number, { index: number; secondaryIndex?: number; info: TexInfo } | null>; secondaryByTexture: Map<number, SecondaryBinding> }
export const newCtx = (): Ctx => ({ textures: [], keys: new Map(), texInfo: new Map(), secondaryByTexture: new Map() });

function texFor(geo: EnvGeo, ctx: Ctx, id: number) {
  if (id >= 0xffe) return null;
  let e = ctx.texInfo.get(id);
  if (e === undefined) {
    if (id >= geo.rom.count('UVTX')) e = null;
    else {
      const info = decodeUvtx(id, (k) => geo.tx(k));
      const index = ctx.textures.length; ctx.textures.push(info.texture);
      const secondaryIndex = info.secondary ? ctx.textures.length : undefined;
      if (info.secondary) ctx.textures.push(info.secondary.texture);
      e = { index, secondaryIndex, info };
      if (secondaryIndex !== undefined) ctx.secondaryByTexture.set(index, { texture: secondaryIndex, info });
    }
    ctx.texInfo.set(id, e);
  }
  return e;
}

export function buildMesh(geo: EnvGeo, ctx: Ctx, name: string, verts: Uint8Array, groups: { mtx: Mtx | null; materials: { state: number; dl: PackedCmd[] }[] }[], info: Record<string, string | number>, stateMask?: (s: number) => number): Mesh {
  const words: number[] = []; const mtxData: number[][] = [];
  for (const g of groups) {
    if (!g.materials.length) continue;
    if (g.mtx) { words.push(0x01020000, -1 - mtxData.length); mtxData.push(g.mtx); }
    for (const m0 of g.materials) {
      const state = stateMask ? stateMask(m0.state) >>> 0 : m0.state;
      const id = state & 0xfff; const t = texFor(geo, ctx, id);
      words.push(0xe7000000, 0, 0xb6000000, 0xffffffff, 0xb7000000, geometryModeOf(state), 0xb900031d, renderModeOf(state, t ? t.info : null));
      if (t) { for (const [w0, w1] of geo.tx(id).dl) if (w0 >>> 24 !== 0xb8) words.push(w0, w1); words.push(0xc0000000, id); }
      else words.push(0xbb000000, 0, 0xfcffffff, 0xfffe7838, 0xc0000000, 0xffff);
      words.push(...expandFast3d(m0.dl, 0).slice(0, -2));
    }
  }
  words.push(0xb8000000, 0);
  const mtxBase = verts.length, listBase = mtxBase + mtxData.length * 64;
  const buf = new Uint8Array(listBase + words.length * 4); buf.set(verts, 0);
  const dv = new DataView(buf.buffer);
  mtxData.forEach((m, k) => { for (let i = 0; i < 16; i++) { const fx = Math.round(m[i] * 65536); dv.setInt16(mtxBase + k * 64 + i * 2, Math.floor(fx / 65536)); dv.setUint16(mtxBase + k * 64 + 32 + i * 2, fx & 0xffff); } });
  for (let i = 0; i < words.length; i++) { let w = words[i]; if (i % 2 === 1 && words[i - 1] === 0x01020000) w = mtxBase + (-1 - w) * 64; dv.setUint32(listBase + i * 4, w >>> 0); }
  const dctx: DisplayListContext = {
    buf, ucode: 'f3d', resolve: (a) => (a >= 0 && a < buf.length ? a : -1),
    textures: ctx.textures, textureKeys: ctx.keys, keyPrefix: 'pw', vertexScale: 1, mirrorX: false, combiner: true, decals: true,
    geometryMode: 0, renderMode: 0, matrix: mtxData.length ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] : undefined,
    rareTexture: (_w0, w1) => {
      const t = texFor(geo, ctx, w1 & 0xffff); if (!t) return null;
      const f = (s: number) => (s > 10 ? 1 << (16 - s) : 1 / (1 << s));
      return { texture: t.index, width: t.info.width / f(t.info.shiftS), height: t.info.height / f(t.info.shiftT), uls: 0, ult: 0 };
    },
  };
  const batches = runDisplayList(dctx, listBase);
  const shift = (s: number) => (s > 10 ? 1 << (16 - s) : 1 / (1 << s));
  for (const batch of batches) {
    const entry = ctx.secondaryByTexture.get(batch.texture);
    const second = entry?.info.secondary;
    if (!entry || !second) continue;
    const ratioS = (entry.info.width * shift(second.shiftS)) / (second.width * shift(entry.info.shiftS));
    const ratioT = (entry.info.height * shift(second.shiftT)) / (second.height * shift(entry.info.shiftT));
    batch.texture1 = entry.texture;
    batch.uvs1 = Float32Array.from(batch.uvs, (value, i) => value * (i & 1 ? ratioT : ratioS));
    batch.texBlend = second.blend;
    if (second.mix !== undefined) batch.texMix = second.mix;
  }
  let r = 0;
  for (const b of batches) for (let i = 0; i < b.positions.length; i += 3) r = Math.max(r, Math.hypot(b.positions[i], b.positions[i + 1], b.positions[i + 2]));
  return { name, radius: r, batches, info };
}

// Part world matrices (hierarchy by part depth), with part 0 = identity (the object matrix replaces it).
export function partMatrices(md: Uvmd): Mtx[] {
  const parts = md.lods[0].parts; const out: Mtx[] = []; const stack: { depth: number; m: Mtx }[] = [];
  parts.forEach((p, j) => {
    const local = j === 0 ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] : md.matrices[j] ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    while (stack.length && stack[stack.length - 1].depth >= p.b6) stack.pop();
    const m = stack.length ? mulMtx(local, stack[stack.length - 1].m) : local;
    stack.push({ depth: p.b6, m }); out.push(m);
  });
  return out;
}

export function modelMesh(geo: EnvGeo, ctx: Ctx, id: number, opts: { hideParts?: number[]; stateMask?: (s: number) => number; name?: string } = {}): Mesh {
  const md = geo.md(id); const L = md.lods[0]; const mats = partMatrices(md);
  const groups = L.parts.map((p, j) => ({ mtx: mats[j] ?? null, materials: opts.hideParts?.includes(j) ? [] : p.materials }));
  return buildMesh(geo, ctx, opts.name ?? `UVMD ${id}`, md.verts, groups, { uvmd: id, lods: md.lods.map((l) => l.distance).join('/'), radius: md.radius, scaleDiv: md.scaleDiv, hidden: opts.hideParts?.join('/') ?? '' }, opts.stateMask);
}

export function contourMesh(geo: EnvGeo, ctx: Ctx, id: number): Mesh {
  const ct = geo.ct(id);
  return buildMesh(geo, ctx, `UVCT ${id}`, ct.verts, [{ mtx: null, materials: ct.batches }], { uvct: id, batches: ct.batches.length, objects: ct.objects.length });
}
