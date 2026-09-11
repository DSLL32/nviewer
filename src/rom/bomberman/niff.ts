// NIFF models of Bomberman 64: The Second Attack! (version 0x05000100 / 0x04020100).
//
// Header: 'niff', u32 version, ...; +0x38 / +0x3C pointers to tables of object and shape
// record pointers; +0x58 / +0x5A u16 counts. All pointers are file offsets.
// Object node (72 bytes): +0 u16 kind (1 group, 2 shape, 3 billboard), +4 u32 flags (draw
// layer = flags >> 8 & 15), +8 / +20 / +32 f32 translation, rotation (radians), scale, +44 s16
// shape, +56 u32 rotation order (bytes from low: axes 1 X, 2 Y, 3 Z), +60 u16 child count, +64
// pointer to s16 child offsets relative to the object's index.
// Shape (80 bytes): +0 display list (F3DEX2), +4 vertices, +10 u16 vertex segment, +12 / +28
// image / palette segment bases [4], +44 / +46 u16 first image / palette segment.
import { type DlLighting, type Mtx, mulMtx, runDisplayList } from '../displaylist';
import type { Batch, Texture } from '../types';
import { view } from '../util';

interface NiffObject {
  kind: number;
  flags: number;
  t: number[];
  r: number[];
  s: number[];
  shape: number;
  rotOrder: number;
  children: number[];
}

interface NiffShape {
  dl: number;
  vtx: number;
  vtxSeg: number;
  imgBase: number[];
  palBase: number[];
  imgSeg: number;
  palSeg: number;
}

export interface Niff {
  buf: Uint8Array;
  objects: NiffObject[];
  shapes: NiffShape[];
}

export function parseNiff(buf: Uint8Array): Niff | null {
  const dv = view(buf);
  if (buf.length < 0x68 || dv.getUint32(0) !== 0x6e696666) return null;
  const version = dv.getUint32(4);
  if (version !== 0x05000100 && version !== 0x04020100) return null;
  const ok = (o: number, n: number) => o >= 0 && o + n <= buf.length;
  const table = (at: number, count: number, size: number) => {
    const list: number[] = [];
    const t = dv.getUint32(at);
    for (let i = 0; i < count && ok(t + i * 4, 4); i++) {
      const p = dv.getUint32(t + i * 4);
      list.push(ok(p, size) ? p : -1);
    }
    return list;
  };
  const f = (o: number) => dv.getFloat32(o);
  const objects = table(0x38, dv.getUint16(0x58), 72).map((a): NiffObject => {
    if (a < 0) return { kind: 0, flags: 0, t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1], shape: -1, rotOrder: 0, children: [] };
    const n = dv.getUint16(a + 60);
    const cp = dv.getUint32(a + 64);
    return {
      kind: dv.getUint16(a), flags: dv.getUint32(a + 4),
      t: [f(a + 8), f(a + 12), f(a + 16)], r: [f(a + 20), f(a + 24), f(a + 28)], s: [f(a + 32), f(a + 36), f(a + 40)],
      shape: dv.getInt16(a + 44), rotOrder: dv.getUint32(a + 56),
      children: ok(cp, n * 2) ? Array.from({ length: n }, (_, k) => dv.getInt16(cp + k * 2)) : [],
    };
  });
  const shapes = table(0x3c, dv.getUint16(0x5a), 80).map((b): NiffShape => (b < 0
    ? { dl: -1, vtx: 0, vtxSeg: 4, imgBase: [0, 0, 0, 0], palBase: [0, 0, 0, 0], imgSeg: 5, palSeg: 9 }
    : {
      dl: dv.getUint32(b), vtx: dv.getUint32(b + 4), vtxSeg: dv.getUint16(b + 10),
      imgBase: [0, 1, 2, 3].map((k) => dv.getUint32(b + 12 + k * 4)),
      palBase: [0, 1, 2, 3].map((k) => dv.getUint32(b + 28 + k * 4)),
      imgSeg: dv.getUint16(b + 44), palSeg: dv.getUint16(b + 46),
    }));
  return { buf, objects, shapes };
}

// The game's draw buckets clear the geometry mode and set the render mode per draw layer
// (layer -> priority 0x8008ECD0, priority -> material 0x8008EE58, materials 0x8008ECF8).
const LAYER_PRIORITY = [0x14, 0x16, 0x14, 0x02, 0x14, 0x14, 0x18, 0x18, 0x1c, 0x1c, 0x03, 0x03, 0x1d, 0x1d, 0x1d, 0x1d];
const PRIORITY_MATERIAL: Record<number, number> = {
  0x1d: 0, 0x1c: 1, 0x1b: 0, 0x1a: 0, 0x19: 0, 0x18: 2, 0x16: 3, 0x14: 4, 0x13: 5, 0x12: 5, 0x10: 5, 0x0e: 5, 0x0d: 6,
  0x0b: 7, 0x04: 0, 0x03: 0, 0x02: 4,
};
const MATERIAL_RENDER_MODE = [
  0x00552078, // AA_ZB_OPA_SURF
  0x00552d58, // AA_ZB_OPA_DECAL
  0x00553078, // AA_ZB_TEX_EDGE
  0x00504e50, // ZB_XLU_DECAL
  0x005049d8, // AA_ZB_XLU_SURF
  0x00504b50, // ZB_XLU_SURF
  0x00504340, // XLU_SURF
  0x055a4340,
];

function renderMode(flags: number): number {
  return MATERIAL_RENDER_MODE[PRIORITY_MATERIAL[LAYER_PRIORITY[(flags >>> 8) & 15]] ?? 0];
}

// Environment ("scene") record, 0x234 bytes: +0x58 clear colour, +0x60 u16 fog minimum, +0x64
// fog colour, 7 light slots of 56 bytes at +0x9C {u16 flags (0x8000 on, 1 point, 2 distance
// fade, 4 spot), +12 colour, +16 f32 direction, +28 f32 position, +40 near, +44 far, +48 spot
// cutoff, +52 spot exponent}, +0x224 ambient colour, +0x230 bit 0 fog on.
interface EnvLight {
  flags: number;
  color: number[];
  dir: number[];
  pos: number[];
  near: number;
  far: number;
  cut: number;
  exp: number;
}

export interface Env {
  ambient: [number, number, number];
  lights: EnvLight[];
  clear: [number, number, number];
  fog: { min: number; color: [number, number, number] } | null;
}

export function parseEnv(buf: Uint8Array): Env | null {
  if (buf.length < 0x234) return null;
  const dv = view(buf);
  const f = (o: number) => dv.getFloat32(o);
  const lights: EnvLight[] = [];
  for (let i = 0; i < 7; i++) {
    const s = 0x9c + 56 * i;
    lights.push({
      flags: dv.getUint16(s), color: [buf[s + 12], buf[s + 13], buf[s + 14]],
      dir: [f(s + 16), f(s + 20), f(s + 24)], pos: [f(s + 28), f(s + 32), f(s + 36)],
      near: f(s + 40), far: f(s + 44), cut: f(s + 48), exp: f(s + 52),
    });
  }
  return {
    ambient: [buf[0x224], buf[0x225], buf[0x226]], lights,
    clear: [buf[0x58], buf[0x59], buf[0x5a]],
    fog: dv.getUint32(0x230) & 1 ? { min: dv.getUint16(0x60), color: [buf[0x64], buf[0x65], buf[0x66]] } : null,
  };
}

// ndSetupLightset / ndEvalLight: the lights the game sends for an object whose world origin is
// `origin`. Point lights become directional towards the object; directions are sent as bytes
// (x 127, truncated) and colours scaled by the intensity.
export function envLighting(env: Env | null, origin: number[]): DlLighting {
  if (!env) {
    const n = Math.hypot(0.3, 1, 0.5);
    return { ambient: [110, 110, 110], lights: [{ color: [160, 160, 160], dir: [0.3 / n, 1 / n, 0.5 / n] }] };
  }
  const lights: DlLighting['lights'] = [];
  for (const s of env.lights) {
    if (!(s.flags & 0x8000)) continue;
    let L: number[];
    let k = 1;
    if (s.flags & 1) {
      const v = [s.pos[0] - origin[0], s.pos[1] - origin[1], s.pos[2] - origin[2]];
      const d = Math.hypot(v[0], v[1], v[2]);
      if (d === 0) continue;
      L = v.map((x) => x / d);
      if (s.flags & 4) {
        const c = -(L[0] * s.dir[0] + L[1] * s.dir[1] + L[2] * s.dir[2]);
        if (c <= s.cut) continue;
        k = (c - 1 + s.cut) * s.exp;
      }
      if (s.flags & 2) {
        if (d < s.near || d > s.far) continue;
        k *= 1 - (d - s.near) / (s.far - s.near);
      }
    } else {
      L = s.dir.map((x) => -x);
    }
    const bytes = L.map((x) => Math.trunc(x * 127));
    const len = Math.hypot(bytes[0], bytes[1], bytes[2]) || 1;
    const intensity = Math.min(255, Math.trunc(k * 255));
    if (intensity <= 0) continue;
    lights.push({
      color: s.color.map((c) => (c * intensity) >> 8) as [number, number, number],
      dir: [bytes[0] / len, bytes[1] / len, bytes[2] / len],
    });
  }
  return { ambient: env.ambient, lights };
}

const ident = (): Mtx => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function rotation(axis: number, a: number): Mtx {
  const c = Math.cos(a), s = Math.sin(a), m = ident();
  if (axis === 1) { m[5] = c; m[6] = s; m[9] = -s; m[10] = c; }
  if (axis === 2) { m[0] = c; m[2] = -s; m[8] = s; m[10] = c; }
  if (axis === 3) { m[0] = c; m[1] = s; m[4] = -s; m[5] = c; }
  return m;
}

// World = S * R_hi * R_mid * R_lo * T * Parent (row vectors), rotations from the low byte of the
// order code up.
function localMatrix(o: NiffObject): Mtx {
  let m = ident();
  m[12] = o.t[0];
  m[13] = o.t[1];
  m[14] = o.t[2];
  if (o.r[0] || o.r[1] || o.r[2]) {
    let code = o.rotOrder & 0xffffff;
    for (let i = 0; i < 3; i++, code >>>= 8) {
      const axis = code & 0xff;
      if (axis >= 1 && axis <= 3) m = mulMtx(rotation(axis, o.r[axis - 1]), m);
    }
  }
  const s = ident();
  s[0] = o.s[0];
  s[5] = o.s[1];
  s[10] = o.s[2];
  return mulMtx(s, m);
}

export interface NiffDrawOptions {
  textures: Texture[];
  textureKeys: Map<string, number>;
  keyPrefix: string;
  env: Env | null;
  root?: Mtx;
}

// Object 0 and its descendants, as the game enters a model, in world space.
export function drawNiff(niff: Niff, opts: NiffDrawOptions): Batch[] {
  const batches: Batch[] = [];
  const { buf } = niff;
  const seen = new Set<number>();
  const visit = (index: number, parent: Mtx, depth: number) => {
    const o = niff.objects[index];
    if (!o || depth > 64 || seen.has(index)) return;
    seen.add(index);
    const world = mulMtx(localMatrix(o), parent);
    const sh = o.shape >= 0 ? niff.shapes[o.shape] : undefined;
    if (sh && sh.dl >= 0 && sh.dl < buf.length) {
      // Segments the game binds before calling the shape's list; texture bases left 0 in the
      // file are filled from texture sets at run time and stay unresolved here.
      const resolve = (addr: number) => {
        const seg = addr >>> 24;
        const off = addr & 0xffffff;
        let base = -1;
        if (seg === 0) base = 0;
        else if (seg === sh.vtxSeg) base = sh.vtx;
        else if (seg >= sh.imgSeg && seg < sh.imgSeg + 4) base = sh.imgBase[seg - sh.imgSeg] || -1;
        else if (seg >= sh.palSeg && seg < sh.palSeg + 4) base = sh.palBase[seg - sh.palSeg] || -1;
        return base < 0 || base + off >= buf.length ? -1 : base + off;
      };
      batches.push(...runDisplayList({
        buf, ucode: 'f3dex2', resolve, textures: opts.textures, textureKeys: opts.textureKeys, keyPrefix: opts.keyPrefix,
        vertexScale: 1, mirrorX: false, geometryMode: 0, renderMode: renderMode(o.flags), alphaCompare: 0,
        matrix: world, lighting: envLighting(opts.env, [world[12], world[13], world[14]]),
        combiner: true, textureGen: true, decals: true,
      }, sh.dl));
    }
    for (const c of o.children) visit(index + c, world, depth + 1);
  };
  if (niff.objects.length) visit(0, opts.root ?? ident(), 0);
  return batches;
}
