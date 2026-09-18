// Hudson FORM model container (Mario Party 1, J ROM) -> render-ready scene parts.
// Layouts and render state follow the game's own loader/renderer (J main: parser 0x8001AB30, faces 0x8001C68C,
// materials 0x8001B830, attributes 0x8001BC90.., bitmaps 0x80038184, palettes 0x800387B8, render mode 0x80030F84).
import type { Mesh, Batch, Texture, Instance, WrapMode, BlendMode, CameraView } from '../types';

export class Bytes {
  v: DataView;
  constructor(public b: Uint8Array) { this.v = new DataView(b.buffer, b.byteOffset, b.byteLength); }
  u8(o: number) { return this.b[o]; }
  s8(o: number) { return this.v.getInt8(o); }
  u16(o: number) { return this.v.getUint16(o); }
  s16(o: number) { return this.v.getInt16(o); }
  u32(o: number) { return this.v.getUint32(o); }
  f32(o: number) { return this.v.getFloat32(o); }
  tag(o: number) { return String.fromCharCode(...this.b.subarray(o, o + 4)); }
}

export interface Chunk { tag: string; off: number; len: number }
export type Vec3 = [number, number, number];
export interface Xform { pos: Vec3; rot: Vec3; scl: Vec3 }

export interface FormObject {
  index: number; type: number; size: number; name: number; nameStr: string;
  group?: { children: number[]; xf: Xform };
  mesh?: { b0: number; faceStart: number; faceCount: number; xf: Xform; flags: number; extra: Uint8Array };
  skl?: { skl: number; xf: Xform };
  point?: { xf: Xform };
}
export interface Material { ambient: Vec3; ambientA: number; diffuse: Vec3; diffuseA: number; specular: Vec3;
  translucent: boolean; primA: number; f6: number; u10: number; idx: [number, number, number] }
export interface Attr { type: number; col: number; wrapS: number; wrapT: number; b7: number; b8: number; b9: number; bmpName: number;
  color?: [number, number, number, number] }
export interface Face { n: number; type: number; vtx: number[]; pvMat: number[]; u: number[]; v: number[]; mat: number; atr: number; tail: number; unlit: boolean }
export interface Bitmap { name: number; nameStr: string; kind: number; fmtCode: number; bpp: number; width: number; height: number;
  pal: number; dataOff: number; nbytes: number; fmt: number; siz: number; extraImage?: { fmt: number; bpp: number; w: number; h: number; nbytes: number } }
export interface Palette { name: number; nameStr: string; colors: number[] }
export interface SklNode { names: number[]; xf: Xform; extra: [number, number, number]; sibling: number; child: number; last: number }
export interface Skeleton { name: number; nodes: SklNode[] }

export interface Form {
  bytes: Bytes; chunks: Chunk[]; mode: Uint8Array;
  objects: FormObject[]; colors: number[]; materials: Material[]; attrs: Attr[];
  scale: number; verts: { x: number; y: number; z: number; nx: number; ny: number; nz: number }[];
  faces: Face[]; bitmaps: Bitmap[]; palettes: Palette[]; skeletons: Skeleton[]; strings: string[];
  map1: Chunk[]; mtn1: Chunk[]; problems: string[];
}

const xform = (r: Bytes, o: number): Xform => ({
  pos: [r.f32(o), r.f32(o + 4), r.f32(o + 8)], rot: [r.f32(o + 12), r.f32(o + 16), r.f32(o + 20)], scl: [r.f32(o + 24), r.f32(o + 28), r.f32(o + 32)],
});
const rgb = (c: number): Vec3 => [c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255];

export function parseForm(buf: Uint8Array): Form {
  const r = new Bytes(buf);
  const problems: string[] = [];
  if (r.tag(0) !== 'FORM') throw new Error('not a FORM');
  if (r.u32(4) !== buf.length - 8) problems.push(`FORM size ${r.u32(4)} != ${buf.length - 8}`);
  const chunks: Chunk[] = [];
  let o = 8;
  while (o < buf.length) {
    let tag = r.tag(o);
    if (tag === 'HBIN') { tag = 'HBINMODE'; o += 4; }
    const len = r.u32(o + 4);
    chunks.push({ tag, off: o + 8, len });
    o += 8 + len + (len & 1);
  }
  if (o !== buf.length) problems.push(`chunk walk ends at ${o} of ${buf.length}`);
  const f: Form = { bytes: r, chunks, mode: new Uint8Array(), objects: [], colors: [], materials: [], attrs: [], scale: 1, verts: [], faces: [],
    bitmaps: [], palettes: [], skeletons: [], strings: [], map1: [], mtn1: [], problems };
  const one = (t: string) => chunks.filter((c) => c.tag === t);
  const end = (c: Chunk, at: number, what: string) => { if (at !== c.len) problems.push(`${what}: consumed ${at} of ${c.len}`); };
  // STRG: u16 n, u8 len[n], chars
  for (const c of one('STRG')) {
    const n = r.u16(c.off); let q = 2 + n;
    for (let i = 0; i < n; i++) { const L = r.u8(c.off + 2 + i); f.strings.push(String.fromCharCode(...buf.subarray(c.off + q, c.off + q + L))); q += L; }
    end(c, q, 'STRG');
  }
  const nm = (i: number) => f.strings[i] ?? `#${i}`;
  for (const c of one('HBINMODE')) f.mode = buf.subarray(c.off, c.off + c.len);
  // OBJ1: u16 count, u16 (1), objects {u16 size, u8 type, u16 name, payload[size-3]}
  for (const c of one('OBJ1')) {
    const n = r.u16(c.off); let q = 4;
    if (r.u16(c.off + 2) !== 1) problems.push(`OBJ1 word2 ${r.u16(c.off + 2)}`);
    for (let i = 0; i < n; i++) {
      const size = r.u16(c.off + q), type = r.u8(c.off + q + 2), name = r.u16(c.off + q + 3), p = c.off + q + 5;
      const ob: FormObject = { index: i, type, size, name, nameStr: nm(name) };
      if (type === 0x3d) {
        const k = r.u16(p); const ch: number[] = [];
        for (let j = 0; j < k; j++) ch.push(r.u16(p + 2 + 2 * j));
        ob.group = { children: ch, xf: xform(r, p + 2 + 2 * k) };
        if (size !== 54 + 2 * k) problems.push(`OBJ1 0x3D size ${size} k ${k}`);
      } else if (type === 0x3a) {
        const extra = buf.subarray(p + 41, p + size - 3);
        let flags = 0x2b00; // game default (J 0x8001AB30 path, US func_8001AC00)
        if (size >= 58 && buf[p + 53] !== 0 && buf[p + 54] === 0) flags = size === 62 ? (buf[p + 55] << 24) | (buf[p + 57] << 8) | buf[p + 58] : buf[p + 55] << 24;
        ob.mesh = { b0: r.u8(p), faceStart: r.u16(p + 1), faceCount: r.u16(p + 3), xf: xform(r, p + 5), flags: flags >>> 0, extra };
        if (size !== 57 && size !== 62) problems.push(`OBJ1 0x3A size ${size}`);
      } else if (type === 0x10) {
        ob.skl = { skl: r.u16(p), xf: xform(r, p + 2) };
        if (size !== 53) problems.push(`OBJ1 0x10 size ${size}`);
      } else if (type === 0x61) {
        ob.point = { xf: xform(r, p) };
        if (size !== 51) problems.push(`OBJ1 0x61 size ${size}`);
      } else if (type === 0x3e) {
        if (size !== 3) problems.push(`OBJ1 0x3E size ${size}`);
      } else problems.push(`OBJ1 type 0x${type.toString(16)}`);
      f.objects.push(ob);
      q += 2 + size;
    }
    end(c, q, 'OBJ1');
  }
  for (const c of one('COL1')) { const n = r.u16(c.off); for (let i = 0; i < n; i++) f.colors.push(r.u32(c.off + 2 + 4 * i)); end(c, 2 + 4 * n, 'COL1'); }
  const col = (i: number) => f.colors[i] ?? 0;
  // MAT1: u16 n, {u16 ambientCol, u16 diffuseCol, u16 specularCol, f32, u16}
  for (const c of one('MAT1')) {
    const n = r.u16(c.off);
    for (let i = 0; i < n; i++) {
      const p = c.off + 2 + 12 * i; const i0 = r.u16(p), i1 = r.u16(p + 2), i2 = r.u16(p + 4);
      const dA = col(i1) & 255;
      f.materials.push({ ambient: rgb(col(i0)), ambientA: col(i0) & 255, diffuse: rgb(col(i1)), diffuseA: dA, specular: rgb(col(i2)),
        translucent: dA !== 255, primA: dA !== 255 ? 255 - dA : 255, f6: r.f32(p + 6), u10: r.u16(p + 10), idx: [i0, i1, i2] });
      if (Math.max(i0, i1, i2) >= f.colors.length) problems.push(`MAT1 colour index out of range`);
    }
    end(c, 2 + 12 * n, 'MAT1');
  }
  // ATR1: u16 n, {u16 size(11), u8 type, u16 colour, u8 wrapS, u8 wrapT, u8 b7, u8 b8, u8 b9, u16 bitmapName}
  for (const c of one('ATR1')) {
    const n = r.u16(c.off); let q = 2;
    for (let i = 0; i < n; i++) {
      const p = c.off + q; const size = r.u16(p);
      const wrap = (b: number) => (b === 45 ? 0 : b === 46 ? 2 : 1); // G_TX_WRAP / G_TX_CLAMP / G_TX_MIRROR (J 0x8001BC90)
      const a: Attr = { type: r.u8(p + 2), col: r.u16(p + 3), wrapS: wrap(r.u8(p + 5)), wrapT: wrap(r.u8(p + 6)), b7: r.u8(p + 7), b8: r.u8(p + 8), b9: r.u8(p + 9), bmpName: r.u16(p + 10) };
      if (a.type === 43) { const cc = col(a.col); a.color = [cc >>> 24, (cc >>> 16) & 255, (cc >>> 8) & 255, cc & 255]; }
      if (size !== 11) problems.push(`ATR1 size ${size}`);
      f.attrs.push(a); q += size + 2;
    }
    end(c, q, 'ATR1');
  }
  // VTX1: u16 n, u16 (1), f32 scale, {s16 x,y,z, s8 nx,ny,nz}
  for (const c of one('VTX1')) {
    const n = r.u16(c.off); f.scale = r.f32(c.off + 4);
    for (let i = 0; i < n; i++) { const p = c.off + 8 + 9 * i; f.verts.push({ x: r.s16(p), y: r.s16(p + 2), z: r.s16(p + 4), nx: r.s8(p + 6), ny: r.s8(p + 7), nz: r.s8(p + 8) }); }
    end(c, 8 + 9 * n, 'VTX1');
  }
  // FAC1: u16 n, u16 (3), u32 (0), records
  for (const c of one('FAC1')) {
    const n = r.u16(c.off); let q = 8;
    for (let i = 0; i < n; i++) {
      const p = c.off + q; const type = r.u8(p);
      const nv = type === 0x16 ? 3 : type === 0x35 ? 4 : 2; const vs = type === 0x30 ? 4 : 12;
      if (type !== 0x16 && type !== 0x35 && type !== 0x30) { problems.push(`FAC1 type 0x${type.toString(16)}`); break; }
      const fc: Face = { n: nv, type, vtx: [], pvMat: [], u: [], v: [], mat: 0, atr: -1, tail: 0, unlit: false };
      for (let k = 0; k < nv; k++) {
        const e = p + 1 + vs * k; fc.vtx.push(r.u16(e)); fc.pvMat.push(r.s16(e + 2));
        fc.u.push(vs === 12 ? r.f32(e + 4) : 0); fc.v.push(vs === 12 ? r.f32(e + 8) : 0);
        if ((r.u8(e + 3)) !== 255) fc.unlit = true; // J 0x8001C734: any per-vertex material -> unlit, vertex colours
      }
      const t = p + 1 + vs * nv; fc.mat = r.s16(t);
      if (type === 0x30) { fc.tail = r.u8(t + 2); q += 1 + vs * nv + 3; } else { fc.atr = r.s16(t + 2); fc.tail = r.u8(t + 4); q += 1 + vs * nv + 5; }
      f.faces.push(fc);
    }
    end(c, q, 'FAC1');
  }
  // PAL1: u16 name, u16 n, RGBA8888[n]
  for (const c of one('PAL1')) {
    const n = r.u16(c.off + 2); const colors: number[] = [];
    for (let i = 0; i < n; i++) colors.push(r.u32(c.off + 4 + 4 * i));
    f.palettes.push({ name: r.u16(c.off), nameStr: nm(r.u16(c.off)), colors }); end(c, 4 + 4 * n, 'PAL1');
  }
  // BMP1: u16 name, u8 kind, u8 fmt(0x24..0x28), u8 bpp|colours, u16 w, u16 h, CI: u16 pal, u16 0, u16 0, u16 n, texels | other: u16 0, u16 n, texels
  for (const c of one('BMP1')) {
    const p = c.off; const fmtCode = r.u8(p + 3), bpp = r.u8(p + 4);
    const bm: Bitmap = { name: r.u16(p), nameStr: nm(r.u16(p)), kind: r.u8(p + 2), fmtCode, bpp, width: r.u16(p + 5), height: r.u16(p + 7),
      pal: -1, dataOff: 0, nbytes: 0, fmt: 0, siz: 0 };
    let used: number;
    if (fmtCode === 0x28) {
      bm.pal = r.u16(p + 9); bm.nbytes = r.u16(p + 15); bm.dataOff = p + 17; used = 17 + bm.nbytes; bm.fmt = 2;
      if (r.u16(p + 11) || r.u16(p + 13)) problems.push('BMP1 CI reserved words non-zero');
    } else {
      bm.nbytes = r.u16(p + 11); bm.dataOff = p + 13; used = 13 + bm.nbytes;
      if (r.u16(p + 9)) problems.push('BMP1 reserved word non-zero');
      // J 0x800382AC: 0x26/0x27 -> RGBA, 0x25 -> IA, anything else -> I
      bm.fmt = fmtCode === 0x26 || fmtCode === 0x27 ? 0 : fmtCode === 0x25 ? 3 : 4;
      bm.siz = bpp === 4 ? 0 : bpp === 8 ? 1 : bpp === 16 ? 2 : bpp === 32 ? 3 : 2; // 24 bpp is converted to 16
    }
    if (bm.kind === 2 && used + 13 <= c.len) {
      const e = p + used; const n = r.u16(p + used + 8);
      bm.extraImage = { fmt: r.u8(e), bpp: r.u8(e + 1), w: r.u16(e + 2), h: r.u16(e + 4), nbytes: n };
      used += 10 + n;
    }
    f.bitmaps.push(bm); end(c, used, `BMP1 ${bm.nameStr}`);
  }
  // SKL1: u16 name, u8 n, nodes {u8 k, u16 name[k], 9 f32, 3 f32, s16 sibling, s16 child, u8}
  for (const c of one('SKL1')) {
    const n = r.u8(c.off + 2); let q = 3; const nodes: SklNode[] = [];
    for (let i = 0; i < n; i++) {
      const p = c.off + q; const k = r.u8(p); const names: number[] = [];
      for (let j = 0; j < k; j++) names.push(r.u16(p + 1 + 2 * j));
      const b = p + 1 + 2 * k;
      nodes.push({ names, xf: xform(r, b), extra: [r.f32(b + 36), r.f32(b + 40), r.f32(b + 44)], sibling: r.s16(b + 48), child: r.s16(b + 50), last: r.u8(b + 52) });
      q += 1 + 2 * k + 53;
    }
    f.skeletons.push({ name: r.u16(c.off), nodes }); end(c, q, 'SKL1');
  }
  f.map1 = one('MAP1'); f.mtn1 = one('MTN1');
  return f;
}

// ---------------------------------------------------------------- textures
const ext5 = (v: number) => (v << 3) | (v >> 2);
export interface DecodedTexture { width: number; height: number; rgba: Uint8Array; fmtName: string; note?: string; fmt: number; siz: number }

export function decodeBitmap(f: Form, bm: Bitmap): DecodedTexture {
  const b = f.bytes.b; let w = bm.width, h = bm.height; let note: string | undefined;
  let fmt = bm.fmt, siz = bm.siz;
  let pal: number[] | null = null;
  if (fmt === 2) {
    const p = f.palettes.find((x) => x.name === bm.pal || x.nameStr === f.strings[bm.pal]);
    // TLUT: RGBA8888 -> RGBA5551, alpha bit = A >= 128 (J 0x80038838)
    pal = (p?.colors ?? []).map((c) => (((c >>> 24) & 0xf8) << 8) | (((c >>> 16) & 0xf8) << 3) | (((c >>> 8) & 0xf8) >> 2) | ((c & 255) >= 128 ? 1 : 0));
    siz = (p?.colors.length ?? 0) < 17 ? 0 : 1;
    if (!p) note = 'palette missing';
  }
  // Oversize fallback (J 0x80038318): CI > 2048 bytes or any > 4096 bytes -> the game draws it as 16x16
  const bytes = bm.fmtCode === 0x26 && bm.bpp === 24 ? (Math.floor((bm.nbytes * 2) / 3) & 0xfffe) : bm.nbytes;
  if ((fmt === 2 && bytes > 2048) || bytes > 4096) { w = 16; h = 16; note = `oversize ${bytes} bytes: game uses 16x16`; }
  const out = new Uint8Array(w * h * 4);
  const d = bm.dataOff;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    const iw = y * w + x;
    let R = 0, G = 0, B = 0, A = 255;
    if (fmt === 2) {
      const idx = siz === 0 ? (b[d + (iw >> 1)] >> ((iw & 1) ? 0 : 4)) & 15 : b[d + iw];
      const c = pal![idx] ?? 0; R = ext5(c >> 11); G = ext5((c >> 6) & 31); B = ext5((c >> 1) & 31); A = c & 1 ? 255 : 0;
    } else if (bm.fmtCode === 0x26 && bm.bpp === 24) {
      // J 0x800383C4: each RGB triple becomes RGBA5551 built from the red byte only (grey)
      const r5 = b[d + 3 * iw] >> 3; R = G = B = ext5(r5); A = 255;
    } else if (fmt === 0) {
      if (siz === 3) { const q = d + 4 * iw; R = b[q]; G = b[q + 1]; B = b[q + 2]; A = b[q + 3]; }
      else { const c = (b[d + 2 * iw] << 8) | b[d + 2 * iw + 1]; R = ext5(c >> 11); G = ext5((c >> 6) & 31); B = ext5((c >> 1) & 31); A = c & 1 ? 255 : 0; }
    } else if (fmt === 3) {
      if (siz === 1) { const c = b[d + iw]; R = G = B = ((c >> 4) * 17); A = (c & 15) * 17; }
      else if (siz === 2) { R = G = B = b[d + 2 * iw]; A = b[d + 2 * iw + 1]; }
      else { const c = (b[d + (iw >> 1)] >> ((iw & 1) ? 0 : 4)) & 15; R = G = B = ((c >> 1) * 255 / 7) | 0; A = c & 1 ? 255 : 0; }
    } else {
      const c = siz === 0 ? ((b[d + (iw >> 1)] >> ((iw & 1) ? 0 : 4)) & 15) * 17 : b[d + iw];
      R = G = B = c; A = c;
    }
    out[o] = R; out[o + 1] = G; out[o + 2] = B; out[o + 3] = A;
  }
  const fmtName = fmt === 2 ? `CI${siz === 0 ? 4 : 8}` : fmt === 0 ? (bm.bpp === 24 ? 'RGB24->RGBA16grey' : siz === 3 ? 'RGBA32' : 'RGBA16') : fmt === 3 ? `IA${[4, 8, 16, 16][siz]}` : `I${[4, 8, 8, 8][siz]}`;
  return { width: w, height: h, rgba: out, fmtName, note, fmt, siz };
}

// ---------------------------------------------------------------- matrices (row-vector, game order v' = v * S * R * T * parent)
export type M4 = ArrayLike<number>;
export const ident = (): number[] => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function mul(a: M4, b: M4): number[] { // a then b (row vectors): c = a * b
  const c = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[i * 4 + k] * b[k * 4 + j]; c[i * 4 + j] = s; }
  return c;
}
export function localMatrix(xf: Xform): number[] {
  const d = Math.PI / 180; const [ax, ay, az] = xf.rot.map((x) => x * d);
  const sx = Math.sin(ax), cx = Math.cos(ax), sy = Math.sin(ay), cy = Math.cos(ay), sz = Math.sin(az), cz = Math.cos(az);
  // MtxRotate (engine/math.c): rows
  const R = [cy * cz, cy * sz, -sy, 0, sx * sy * cz - cx * sz, sx * sy * sz + cx * cz, sx * cy, 0, cx * sy * cz + sx * sz, cx * sy * sz - sx * cz, cx * cy, 0, 0, 0, 0, 1];
  const S = [xf.scl[0], 0, 0, 0, 0, xf.scl[1], 0, 0, 0, 0, xf.scl[2], 0, 0, 0, 0, 1];
  const T = ident(); T[12] = xf.pos[0]; T[13] = xf.pos[1]; T[14] = xf.pos[2];
  return mul(mul(S, R), T);
}
export const formIdentity = ident;
export const formMul = mul;
export const formLocalMatrix = localMatrix;

// Which mesh objects the game draws, with which matrix (J group walk = US func_80033CBC, skeleton = US func_800339E0)
export interface Placement { mesh: number; objIndex: number; matrix: M4; via: string }
export function placements(f: Form): { list: Placement[]; unreached: number[] } {
  const meshes = f.objects.filter((o) => o.type === 0x3a); const groups = f.objects.filter((o) => o.type === 0x3d);
  const find = (name: number): ['m' | 'g', number] | null => {
    let mi = 0, gi = 0;
    for (const o of f.objects) {
      if (o.type === 0x3a) { if (o.name === name) return ['m', mi]; mi++; } else if (o.type === 0x3d) { if (o.name === name) return ['g', gi]; gi++; }
    }
    return null;
  };
  const list: Placement[] = [];
  if (groups.length) {
    const walk = (g: number, parent: M4, depth: number) => {
      const grp = groups[g].group!; const m = mul(localMatrix(grp.xf), parent);
      for (const ch of grp.children) {
        const hit = find(ch);
        if (!hit) continue;
        if (hit[0] === 'm') list.push({ mesh: hit[1], objIndex: meshes[hit[1]].index, matrix: m, via: groups[g].nameStr });
        else if (depth < 64) walk(hit[1], m, depth + 1);
      }
    };
    walk(0, ident(), 0);
  } else {
    const skRef = f.objects.filter((o) => o.type === 0x10).pop();
    const sk = skRef ? f.skeletons.find((s) => s.name === skRef.skl!.skl || f.strings[s.name] === f.strings[skRef.skl!.skl]) : undefined;
    if (sk) {
      const walk = (i: number, parent: M4, depth: number) => {
        const n = sk.nodes[i]; if (!n || depth > 256) return;
        const m = mul(localMatrix(n.xf), parent);
        const hit = find(n.names[0]);
        if (hit && hit[0] === 'm') list.push({ mesh: hit[1], objIndex: meshes[hit[1]].index, matrix: m, via: f.strings[sk.name] });
        if (n.child) walk(i + n.child, m, depth + 1);
        if (n.sibling) walk(i + n.sibling, parent, depth + 1);
      };
      walk(0, ident(), 0);
    }
  }
  const seen = new Set(list.map((p) => p.mesh));
  const unreached = meshes.map((_, i) => i).filter((i) => !seen.has(i));
  return { list, unreached };
}

// ---------------------------------------------------------------- level building
export interface BuildOptions {
  loadFlags?: number;          // LoadFormFile second argument (0x200: material ambient, 0x180 == 0x100: no Z)
  lights?: { ambient: Vec3; dirs: { dir: Vec3; color: Vec3 | null }[] };
  includeUnreached?: boolean;  // draw mesh objects the model's tree does not reach, at identity (default true)
}
export interface Part { form: Form; name: string; matrix?: M4; loadFlags?: number; role?: 'main' | 'objects' | 'hidden'; opts?: BuildOptions }

export interface FormBuild {
  textures: Texture[];
  meshes: Mesh[];
  instances: Instance[];
  roles: ('main' | 'objects' | 'hidden' | 'collision')[];
  collisionInstances: number[];
  bounds: { min: Vec3; max: Vec3 };
  camera?: CameraView;
}

const WRAP: WrapMode[] = ['repeat', 'mirror', 'clamp'];
const s16 = (x: number) => (Math.trunc(x) << 16) >> 16;

export function buildFormParts(parts: Part[], common: BuildOptions = {}): FormBuild {
  const textures: Texture[] = []; const texKey = new Map<string, number>();
  const bmpCache = new Map<string, { t: DecodedTexture; f: Form; bm: Bitmap }>(); // game: global texture cache keyed by name
  const meshes: Mesh[] = []; const instances: Instance[] = [];
  const roles: FormBuild['roles'] = []; const collisionInstances: number[] = [];
  let camera: CameraView | undefined;
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const f = part.form; const opt = { ...common, ...part.opts };
    const loadFlags = part.loadFlags ?? opt.loadFlags ?? 0x299;
    const zOn = (loadFlags & 0x180) !== 0x100;
    const lighting = opt.lights ?? { ambient: [64, 64, 64] as Vec3, dirs: [{ dir: [0, 0, 100] as Vec3, color: null }] };
    const directions = lighting.dirs.map((light) => ({ dir: norm(light.dir), color: light.color }));
    const matAmbient = (loadFlags & 0x200) !== 0;
    // textures by attribute
    const atrTex = f.attrs.map((a) => {
      const nameStr = f.strings[a.bmpName];
      let e = bmpCache.get(nameStr);
      if (!e) {
        const bm = f.bitmaps.find((b) => b.name === a.bmpName) ?? f.bitmaps.find((b) => b.nameStr === nameStr);
        if (!bm) return null;
        e = { t: decodeBitmap(f, bm), f, bm }; bmpCache.set(nameStr, e);
      }
      const key = `${nameStr}|${a.wrapS}|${a.wrapT}`;
      let ti = texKey.get(key);
      if (ti === undefined) {
        ti = textures.length; texKey.set(key, ti);
        const tex: Texture = { width: e.t.width, height: e.t.height, rgba: e.t.rgba, wrapS: WRAP[a.wrapS], wrapT: WRAP[a.wrapT],
          format: e.t.fmtName, source: `${part.name} BMP1 ${nameStr}${e.t.note ? ' ' + e.t.note : ''}` };
        // I textures: the combiner outputs PRIMITIVE colour with TEXEL0 alpha -> white texels, alpha = intensity
        if (e.t.fmt === 4) { const c = new Uint8Array(tex.rgba); for (let k = 0; k < c.length; k += 4) { c[k + 3] = c[k]; c[k] = c[k + 1] = c[k + 2] = 255; } tex.rgba = c; }
        textures.push(tex);
      }
      return { ti, t: e.t };
    });
    const { list, unreached } = placements(f);
    const meshObjs = f.objects.filter((o) => o.type === 0x3a);
    const pl = [...list];
    if (opt.includeUnreached ?? true) for (const u of unreached) pl.push({ mesh: u, objIndex: meshObjs[u].index, matrix: ident(), via: 'unreached' });
    for (const p of pl) {
      const ob = meshObjs[p.mesh]; const mo = ob.mesh!;
      const world = part.matrix ? mul(p.matrix, part.matrix) : p.matrix;
      const flags = mo.flags;
      const batches = new Map<string, { b: Batch; pos: number[]; uv: number[]; col: number[] }>();
      for (let fi = mo.faceStart; fi < mo.faceStart + mo.faceCount; fi++) {
        const fc = f.faces[fi]; if (!fc || fc.n < 3) continue; // lines are not drawn (US func_8002DC84)
        const mat = f.materials[fc.mat] ?? f.materials[0];
        const at = fc.atr >= 0 ? atrTex[fc.atr] : null;
        const tex = at?.t;
        // translucency / combiner class (J 0x80030F84)
        let translucent = mat ? mat.translucent : false; let cls = 'shade';
        if (tex) {
          if (tex.fmt === 3) { cls = 'IA'; translucent = true; } else if (tex.fmt === 4) { cls = 'I'; translucent = true; }
          else if (tex.siz === 3 && tex.fmt === 0) { cls = 'RGBA32'; translucent = true; } else cls = translucent ? 'texXlu' : 'tex';
        } else cls = translucent ? 'shadeXlu' : 'shade';
        const blend: BlendMode = translucent ? 'blend' : tex ? 'cutout' : 'opaque';
        const decal = (flags & 0x80000000) !== 0;
        const key = `${at ? at.ti : -1}|${blend}|${decal}`;
        let e = batches.get(key);
        if (!e) {
          e = { b: { texture: at ? at.ti : -1, blend, depthTest: zOn, depthWrite: zOn && !translucent, cullBack: (flags & 0x2000) !== 0, positions: new Float32Array(), uvs: new Float32Array(), colors: new Uint8Array() }, pos: [], uv: [], col: [] };
          if (decal) e.b.decal = true;
          batches.set(key, e);
        }
        const tw = tex ? tex.width << 5 : 0, th = tex ? tex.height << 5 : 0;
        const corner = (k: number) => {
          const vi = fc.vtx[k]; const vx = f.verts[vi];
          const x = s16(vx.x * f.scale), y = s16(vx.y * f.scale), z = s16(vx.z * f.scale);
          e!.pos.push(x, y, z);
          const u = tex ? s16(fc.u[k] * tw) / tw : 0, v = tex ? s16(fc.v[k] * th) / th : 0;
          e!.uv.push(u, v);
          let c: Vec3; let a = 255;
          if (fc.unlit) {
            const pm = f.materials[fc.pvMat[k] & 255] ?? mat; c = pm ? [...pm.diffuse] as Vec3 : [255, 255, 255];
          } else {
            const n = transformNormal(world, [vx.nx / 127, vx.ny / 127, vx.nz / 127]);
            const base = matAmbient && mat ? mat.ambient : lighting.ambient;
            c = [...base] as Vec3;
            directions.forEach((light, li) => {
              const amount = Math.max(0, n[0] * light.dir[0] + n[1] * light.dir[1] + n[2] * light.dir[2]);
              const diffuse = li === 0 || !light.color ? (mat?.diffuse ?? [255, 255, 255]) : light.color;
              for (let axis = 0; axis < 3; axis++) c[axis] = Math.min(255, c[axis] + diffuse[axis] * amount);
            });
          }
          if (cls === 'IA' || cls === 'I') { c = mat ? [...mat.diffuse] as Vec3 : [255, 255, 255]; a = mat ? mat.primA : 255; }
          else if (cls === 'RGBA32') a = mat ? mat.primA : 255;
          else if (cls === 'texXlu') a = mat ? mat.diffuseA : 255;
          else if (cls === 'shadeXlu') a = mat ? mat.primA : 255;
          e!.col.push(c[0] | 0, c[1] | 0, c[2] | 0, a);
          const wx = x * world[0] + y * world[4] + z * world[8] + world[12], wy = x * world[1] + y * world[5] + z * world[9] + world[13], wz = x * world[2] + y * world[6] + z * world[10] + world[14];
          if (part.role !== 'hidden') {
            min[0] = Math.min(min[0], wx); min[1] = Math.min(min[1], wy); min[2] = Math.min(min[2], wz);
            max[0] = Math.max(max[0], wx); max[1] = Math.max(max[1], wy); max[2] = Math.max(max[2], wz);
          }
        };
        const tris = fc.n === 4 ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 2]]; // gSP1Quadrangle(v0,v1,v2,v3)
        for (const t of tris) for (const k of t) corner(k);
      }
      if (!batches.size) continue;
      let radius = 0;
      const bl: Batch[] = [];
      for (const e of batches.values()) {
        e.b.positions = new Float32Array(e.pos); e.b.uvs = new Float32Array(e.uv); e.b.colors = new Uint8Array(e.col);
        for (let k = 0; k < e.pos.length; k += 3) radius = Math.max(radius, Math.hypot(e.pos[k], e.pos[k + 1], e.pos[k + 2]));
        bl.push(e.b);
      }
      // opaque, then cutout, then blended, as the viewer expects nothing special about order within a mesh
      const mi = meshes.length;
      meshes.push({ name: `${part.name}:${ob.nameStr}#${ob.index}`, radius, batches: bl, info: { file: part.name, object: ob.index, flags: `0x${flags.toString(16)}`, via: p.via } });
      instances.push({ name: ob.nameStr, mesh: mi, matrix: new Float32Array(world), info: { file: part.name, object: ob.index, via: p.via, flags: `0x${flags.toString(16)}` } });
      roles.push(part.role ?? 'main');
    }
    for (const chunk of f.map1) {
      const data = new Bytes(f.bytes.b.subarray(chunk.off, chunk.off + chunk.len));
      const columns = data.u16(0), rows = data.u16(2);
      const listStart = 16 + 12 * columns * rows;
      if (listStart > chunk.len) throw new Error(`MAP1 ${part.name}: invalid cell grid`);
      const listWords = (chunk.len - listStart) >>> 1;
      const byAttribute = new Map<number, { positions: number[]; colors: number[] }>();
      let word = 0;
      while (word < listWords) {
        const header = data.u16(listStart + 2 * word);
        const count = header & 0x8000 ? 4 : header & 0x4000 ? 3 : 0;
        if (!count) break;
        if (word + count >= listWords) throw new Error(`MAP1 ${part.name}: truncated polygon`);
        const attribute = (header >>> 8) & 0x3f;
        const vertices: Vec3[] = [];
        for (let corner = 1; corner <= count; corner++) {
          const vertex = f.verts[data.u16(listStart + 2 * (word + corner))];
          if (!vertex) throw new Error(`MAP1 ${part.name}: vertex out of range`);
          vertices.push([s16(vertex.x * f.scale), s16(vertex.y * f.scale), s16(vertex.z * f.scale)]);
        }
        let group = byAttribute.get(attribute);
        if (!group) { group = { positions: [], colors: [] }; byAttribute.set(attribute, group); }
        const edge1: Vec3 = [vertices[1][0] - vertices[0][0], vertices[1][1] - vertices[0][1], vertices[1][2] - vertices[0][2]];
        const edge2: Vec3 = [vertices[2][0] - vertices[0][0], vertices[2][1] - vertices[0][1], vertices[2][2] - vertices[0][2]];
        const normal = norm([edge1[1] * edge2[2] - edge1[2] * edge2[1], edge1[2] * edge2[0] - edge1[0] * edge2[2], edge1[0] * edge2[1] - edge1[1] * edge2[0]]);
        const base = COLLISION_COLORS[attribute] ?? [attribute * 97 & 255, attribute * 57 & 255, attribute * 31 & 255];
        const shade = 0.55 + 0.45 * Math.abs(normal[1]);
        for (const tri of count === 4 ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 2]]) for (const corner of tri) {
          group.positions.push(...vertices[corner]);
          group.colors.push(base[0] * shade | 0, base[1] * shade | 0, base[2] * shade | 0, 255);
        }
        word += count + 1;
      }
      const batches: Batch[] = [];
      let radius = 0;
      for (const [, group] of [...byAttribute.entries()].sort((a, b) => a[0] - b[0])) {
        batches.push({ texture: -1, blend: 'opaque', depthTest: true, depthWrite: true, cullBack: false,
          positions: new Float32Array(group.positions), uvs: new Float32Array(group.positions.length / 3 * 2), colors: new Uint8Array(group.colors) });
        for (let i = 0; i < group.positions.length; i += 3) radius = Math.max(radius, Math.hypot(group.positions[i], group.positions[i + 1], group.positions[i + 2]));
      }
      if (batches.length) {
        const mesh = meshes.length;
        meshes.push({ name: `${part.name}:MAP1`, radius, batches, info: { file: part.name, grid: `${columns}x${rows}` } });
        collisionInstances.push(instances.length);
        instances.push({ name: `${part.name} MAP1`, mesh, matrix: new Float32Array(part.matrix ?? ident()), info: { file: part.name, role: 'collision' } });
        roles.push('collision');
      }
    }
    if (!camera) {
      const pt = (s: string) => f.objects.find((o) => o.type === 0x61 && o.nameStr.endsWith(s));
      const eye = pt('cam_int1_eye'), tgt = pt('cam_int1_interest');
      if (eye && tgt) camera = { eye: [...eye.point!.xf.pos] as Vec3, target: [...tgt.point!.xf.pos] as Vec3 };
    }
  }
  if (!isFinite(min[0])) { min.fill(0); max.fill(0); }
  return { textures, meshes, instances, roles, collisionInstances, bounds: { min, max }, camera };
}

function norm(v: Vec3): Vec3 { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
const COLLISION_COLORS: Record<number, Vec3> = { 0x00: [170, 170, 170], 0x02: [90, 200, 90], 0x05: [235, 150, 40], 0x12: [70, 130, 235], 0x1a: [205, 80, 205] };
function transformNormal(m: M4, n: Vec3): Vec3 {
  return norm([n[0] * m[0] + n[1] * m[4] + n[2] * m[8], n[0] * m[1] + n[1] * m[5] + n[2] * m[9], n[0] * m[2] + n[1] * m[6] + n[2] * m[10]]);
}
