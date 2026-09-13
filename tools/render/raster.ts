// Offline software rasterizer for the viewer's render-ready Level model (src/rom/types.ts).
// Mirrors src/render/renderer.ts: sky first (no depth, no fog), then opaque+cutout batches in instance/display-list
// order, then blended batches back to front by instance origin (depth test per batch, no depth write).
// OpenGL conventions: clip z in [-1, 1], depth func LEQUAL, CCW front faces, texture row 0 = uv v 0.
import type { Batch, Fog, Instance, Level, Mesh, PanoramaSky, Texture } from '../../src/rom/types';
import { panoramaQuads, panoramaTop } from '../../src/render/renderer';

export type Vec3 = [number, number, number];
export type RGB = [number, number, number];
export type LevelLike = Partial<Level> & Pick<Level, 'textures' | 'meshes' | 'instances'>;

export interface CameraOptions {
  eye: Vec3;
  target: Vec3;
  /** Default [0, 1, 0]; if parallel to the view direction a perpendicular one is chosen. */
  up?: Vec3;
  /** Vertical field of view in degrees (default 45; the browser viewer uses 60). */
  fovY?: number;
  /** Orthographic projection instead of perspective; halfHeight in world units. */
  ortho?: { halfHeight: number };
  /** Default 1 (perspective, must be > 0) or 0 (orthographic). */
  near?: number;
  /** Default 50000 (the viewer's far plane). */
  far?: number;
}

export interface RenderStats {
  triangles: number; // submitted
  culled: number; // back faces removed (cull: true)
  clipped: number; // triangles that needed polygon clipping
  rejected: number; // entirely outside a clip plane
  pixels: number; // fragments that passed depth test (before cutout discard)
  ms: number;
}

export interface RenderOptions extends CameraOptions {
  width: number;
  height: number;
  /** Honour Batch.cullBack (default false, like the viewer's default). Batch.forceCullBack is always honoured. */
  cull?: boolean;
  /** Clear colour 0..255. Default: fog colour when fog is on, else the legacy sky horizon colour, else [117,163,219]. */
  background?: RGB;
  /** Apply level.fog (if present) to everything but the sky. Default false. */
  fog?: boolean;
  /** Texture filter (default 'bilinear'). */
  filter?: 'nearest' | 'bilinear';
  /** Trilinear mip-mapping like the viewer (LINEAR/NEAREST_MIPMAP_LINEAR). Default true. */
  mipmaps?: boolean;
  /** Draw Level.skies (or legacy unplaced *SKY domes). Default true. */
  drawSkies?: boolean;
  /** Which Level.skies entry to draw by name (default: first; unknown names fall back to first). */
  sky?: string;
  /** Legacy *SKY dome vertical offset (the viewer uses the median static vertex height; that is the default). */
  skyGroundY?: number;
  /** Draw instances flagged animated (default true). */
  showAnimated?: boolean;
  /** Only draw instances for which this returns true. */
  instanceFilter?: (inst: Instance, index: number) => boolean;
  /** 'instance' (default, = viewer): blended batches ordered back to front by instance origin, triangles in
   *  submission order. 'triangle': every blended triangle sorted back to front by centroid view depth. */
  blendSort?: 'instance' | 'triangle';
  /** Render at N x N resolution and box-downsample (anti-aliasing). Default 1. */
  supersample?: number;
  /** Filled in with counters and timing if given. */
  stats?: RenderStats;
}

export interface NamedCamera extends CameraOptions {
  name: string;
}

const DEFAULT_CLEAR: RGB = [0.46, 0.64, 0.86];
const STRIDE = 11; // clip vertex: x y z w u v r g b a viewDepth
const GUARD = 4; // guard-band clip planes at |x|,|y| <= GUARD * w (keeps snapped coordinates exact)
const SUB = 256; // sub-pixel precision
const HALF = SUB / 2;

const enum Mode { Opaque = 0, Cutout = 1, Blend = 2 }
const enum Wrap { Repeat = 0, Mirror = 1, Clamp = 2 }

// ---------------------------------------------------------------------------------------------------------------
// Matrices (column-major Float64Array(16), same layout as Instance.matrix)

export type Mat4 = Float64Array | Float32Array;

export const mat4 = {
  identity(): Float64Array {
    const m = new Float64Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },
  /** a * b */
  multiply(a: Mat4, b: Mat4): Float64Array {
    const r = new Float64Array(16);
    for (let c = 0; c < 4; c++) {
      for (let row = 0; row < 4; row++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[c * 4 + k];
        r[c * 4 + row] = s;
      }
    }
    return r;
  },
  translation(x: number, y: number, z: number): Float64Array {
    const m = mat4.identity();
    m[12] = x; m[13] = y; m[14] = z;
    return m;
  },
  scaling(x: number, y: number, z: number): Float64Array {
    const m = mat4.identity();
    m[0] = x; m[5] = y; m[10] = z;
    return m;
  },
  /** Right-handed rotation about an axis, angle in degrees. */
  rotation(axis: 'x' | 'y' | 'z', degrees: number): Float64Array {
    const a = (degrees * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const m = mat4.identity();
    if (axis === 'x') { m[5] = c; m[6] = s; m[9] = -s; m[10] = c; }
    else if (axis === 'y') { m[0] = c; m[2] = -s; m[8] = s; m[10] = c; }
    else { m[0] = c; m[1] = s; m[4] = -s; m[5] = c; }
    return m;
  },
  /** Product of the given matrices, left to right (compose(T, R, S) = T*R*S). */
  compose(...ms: Mat4[]): Float64Array {
    return ms.reduce<Float64Array>((acc, m) => mat4.multiply(acc, m), mat4.identity());
  },
  toFloat32(m: Mat4): Float32Array {
    return Float32Array.from(m);
  },
};

function det3(m: Mat4): number {
  return m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
}

interface Camera {
  view: Float64Array;
  proj: Float64Array;
  eye: Vec3;
  forward: Vec3;
}

function buildCamera(o: CameraOptions, aspect: number): Camera {
  const eye = o.eye, target = o.target;
  let f: Vec3 = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
  const fl = Math.hypot(f[0], f[1], f[2]);
  if (!(fl > 0)) throw new Error('renderLevel: eye and target must differ');
  f = [f[0] / fl, f[1] / fl, f[2] / fl];
  let up = o.up ?? [0, 1, 0];
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  let s = cross(f, up);
  let sl = Math.hypot(s[0], s[1], s[2]);
  if (sl < 1e-9 * Math.max(1, Math.hypot(up[0], up[1], up[2]))) {
    up = Math.abs(f[1]) > 0.9 ? [0, 0, -1] : [0, 1, 0];
    s = cross(f, up);
    sl = Math.hypot(s[0], s[1], s[2]);
  }
  s = [s[0] / sl, s[1] / sl, s[2] / sl];
  const u = cross(s, f);
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const view = new Float64Array([
    s[0], u[0], -f[0], 0,
    s[1], u[1], -f[1], 0,
    s[2], u[2], -f[2], 0,
    -dot(s, eye), -dot(u, eye), dot(f, eye), 1,
  ]);
  const proj = new Float64Array(16);
  const far = o.far ?? 50000;
  if (o.ortho) {
    const near = o.near ?? 0;
    const hh = o.ortho.halfHeight;
    if (!(hh > 0) || !(far > near)) throw new Error('renderLevel: bad orthographic parameters');
    proj[0] = 1 / (hh * aspect);
    proj[5] = 1 / hh;
    proj[10] = -2 / (far - near);
    proj[14] = -(far + near) / (far - near);
    proj[15] = 1;
  } else {
    const near = o.near ?? 1;
    if (!(near > 0) || !(far > near)) throw new Error('renderLevel: perspective needs 0 < near < far');
    const fy = 1 / Math.tan((((o.fovY ?? 45) * Math.PI) / 180) / 2);
    proj[0] = fy / aspect;
    proj[5] = fy;
    proj[10] = (far + near) / (near - far);
    proj[11] = -1;
    proj[14] = (2 * far * near) / (near - far);
  }
  return { view, proj, eye: [eye[0], eye[1], eye[2]], forward: f };
}

// ---------------------------------------------------------------------------------------------------------------
// Textures

interface MipLevel {
  w: number;
  h: number;
  data: Float32Array; // rgba 0..1
}

interface MipTex {
  levels: MipLevel[];
  wrapS: Wrap;
  wrapT: Wrap;
}

const mipCache = new WeakMap<Texture, MipTex>();

function wrapOf(m: string): Wrap {
  return m === 'mirror' ? Wrap.Mirror : m === 'clamp' ? Wrap.Clamp : Wrap.Repeat;
}

function getMipTex(t: Texture): MipTex {
  let mt = mipCache.get(t);
  if (mt) return mt;
  const w = Math.max(1, t.width | 0), h = Math.max(1, t.height | 0);
  const base = new Float32Array(w * h * 4);
  const n = Math.min(base.length, t.rgba.length);
  for (let i = 0; i < n; i++) base[i] = t.rgba[i] / 255;
  const levels: MipLevel[] = [{ w, h, data: base }];
  // Box-filtered chain like glGenerateMipmap: each level floor(size / 2), min 1.
  while (levels[levels.length - 1].w > 1 || levels[levels.length - 1].h > 1) {
    const src = levels[levels.length - 1];
    const nw = Math.max(1, src.w >> 1), nh = Math.max(1, src.h >> 1);
    const d = new Float32Array(nw * nh * 4);
    const sx = src.w > 1 ? 2 : 1, sy = src.h > 1 ? 2 : 1;
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        const o = (y * nw + x) * 4;
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) sum += src.data[((y * sy + j) * src.w + x * sx + i) * 4 + c];
          d[o + c] = sum / (sx * sy);
        }
      }
    }
    levels.push({ w: nw, h: nh, data: d });
  }
  mt = { levels, wrapS: wrapOf(t.wrapS), wrapT: wrapOf(t.wrapT) };
  mipCache.set(t, mt);
  return mt;
}

function wrapIndex(i: number, n: number, mode: Wrap): number {
  if (mode === Wrap.Repeat) {
    i %= n;
    return i < 0 ? i + n : i;
  }
  if (mode === Wrap.Mirror) {
    const n2 = n * 2;
    i %= n2;
    if (i < 0) i += n2;
    return i >= n ? n2 - 1 - i : i;
  }
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}

const S0 = new Float64Array(4);
const S1 = new Float64Array(4);

function sampleLevel(lv: MipLevel, ws: Wrap, wt: Wrap, u: number, v: number, nearest: boolean, out: Float64Array) {
  const { w, h, data } = lv;
  if (nearest) {
    const o = (wrapIndex(Math.floor(v * h), h, wt) * w + wrapIndex(Math.floor(u * w), w, ws)) * 4;
    out[0] = data[o]; out[1] = data[o + 1]; out[2] = data[o + 2]; out[3] = data[o + 3];
    return;
  }
  const x = u * w - 0.5, y = v * h - 0.5;
  const fx0 = Math.floor(x), fy0 = Math.floor(y);
  const fx = x - fx0, fy = y - fy0;
  const x0 = wrapIndex(fx0, w, ws), x1 = wrapIndex(fx0 + 1, w, ws);
  const y0 = wrapIndex(fy0, h, wt) * w, y1 = wrapIndex(fy0 + 1, h, wt) * w;
  const a = (y0 + x0) * 4, b = (y0 + x1) * 4, c = (y1 + x0) * 4, d = (y1 + x1) * 4;
  const wa = (1 - fx) * (1 - fy), wb = fx * (1 - fy), wc = (1 - fx) * fy, wd = fx * fy;
  for (let k = 0; k < 4; k++) out[k] = data[a + k] * wa + data[b + k] * wb + data[c + k] * wc + data[d + k] * wd;
}

/** GL-style sample: lambda = log2 of the texel footprint (<= 0 magnification). */
function sampleTex(t: MipTex, u: number, v: number, lambda: number, nearest: boolean, mip: boolean, out: Float64Array) {
  const L = t.levels;
  if (!mip || !(lambda > 0) || L.length === 1) {
    sampleLevel(L[0], t.wrapS, t.wrapT, u, v, nearest, out);
    return;
  }
  const maxLevel = L.length - 1;
  if (lambda >= maxLevel) {
    sampleLevel(L[maxLevel], t.wrapS, t.wrapT, u, v, nearest, out);
    return;
  }
  const d1 = Math.floor(lambda), f = lambda - d1;
  sampleLevel(L[d1], t.wrapS, t.wrapT, u, v, nearest, S0);
  sampleLevel(L[d1 + 1], t.wrapS, t.wrapT, u, v, nearest, S1);
  for (let k = 0; k < 4; k++) out[k] = S0[k] + (S1[k] - S0[k]) * f;
}

// ---------------------------------------------------------------------------------------------------------------
// Rasterizer

interface FogParams {
  r: number; g: number; b: number;
  a: number; // (far + near) / range
  b2: number; // 2 * far * near / range
  mul: number;
  offset: number;
}

class Raster {
  readonly color: Float32Array;
  readonly depth: Float64Array;
  // Current draw state.
  tex: MipTex | null = null;
  mode: Mode = Mode.Opaque;
  depthTest = true;
  depthWrite = true;
  cull = false;
  mirrored = false;
  fog: FogParams | null = null;
  // Scratch.
  private vbuf: Float64Array = new Float64Array(STRIDE * 3 * 1024);
  private polyA = new Float64Array(STRIDE * 16);
  private polyB = new Float64Array(STRIDE * 16);
  private proj = new Float64Array(STRIDE * 16);
  private readonly tmp = new Float64Array(4);

  constructor(
    readonly W: number,
    readonly H: number,
    readonly cam: Camera,
    readonly nearest: boolean,
    readonly mip: boolean,
    readonly stats: RenderStats,
  ) {
    this.color = new Float32Array(W * H * 3);
    this.depth = new Float64Array(W * H).fill(1);
  }

  clear(c: RGB) {
    for (let i = 0; i < this.W * this.H; i++) {
      this.color[i * 3] = c[0];
      this.color[i * 3 + 1] = c[1];
      this.color[i * 3 + 2] = c[2];
    }
  }

  /** Transform a batch's vertices to clip space (+ attributes) into a buffer; returns vertex count used. */
  transform(b: Batch, model: Mat4, out?: Float64Array): { buf: Float64Array; tris: number } {
    const count = Math.floor(b.positions.length / 3);
    const tris = count >= 3 ? Math.floor(count / 3) : 0;
    const need = tris * 3 * STRIDE;
    let buf: Float64Array = out ?? this.vbuf;
    if (buf.length < need) {
      buf = new Float64Array(need);
      if (!out) this.vbuf = buf;
    }
    if (tris === 0) return { buf, tris };
    const mv = mat4.multiply(this.cam.view, model);
    const P = this.cam.proj;
    const textured = this.tex !== null && b.uvs.length >= count * 2;
    const colored = b.colors.length >= count * 4;
    const pos = b.positions, uv = b.uvs, col = b.colors;
    for (let i = 0, n = tris * 3; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const vx = mv[0] * x + mv[4] * y + mv[8] * z + mv[12];
      const vy = mv[1] * x + mv[5] * y + mv[9] * z + mv[13];
      const vz = mv[2] * x + mv[6] * y + mv[10] * z + mv[14];
      const vw = mv[3] * x + mv[7] * y + mv[11] * z + mv[15];
      const o = i * STRIDE;
      buf[o] = P[0] * vx + P[4] * vy + P[8] * vz + P[12] * vw;
      buf[o + 1] = P[1] * vx + P[5] * vy + P[9] * vz + P[13] * vw;
      buf[o + 2] = P[2] * vx + P[6] * vy + P[10] * vz + P[14] * vw;
      buf[o + 3] = P[3] * vx + P[7] * vy + P[11] * vz + P[15] * vw;
      if (textured) { buf[o + 4] = uv[i * 2]; buf[o + 5] = uv[i * 2 + 1]; }
      else { buf[o + 4] = 0; buf[o + 5] = 0; }
      if (colored) {
        buf[o + 6] = col[i * 4] / 255; buf[o + 7] = col[i * 4 + 1] / 255;
        buf[o + 8] = col[i * 4 + 2] / 255; buf[o + 9] = col[i * 4 + 3] / 255;
      } else {
        buf[o + 6] = buf[o + 7] = buf[o + 8] = buf[o + 9] = 1;
      }
      buf[o + 10] = -vz / (vw || 1); // positive view depth, for fog
    }
    return { buf, tris };
  }

  /** Clip and rasterize triangle `t` of a transformed buffer. */
  triangle(buf: Float64Array, t: number) {
    const st = this.stats;
    st.triangles++;
    const o = t * 3 * STRIDE;
    // Outcodes against near, far and guard-band planes.
    let allIn = true;
    let rejectMask = 0x3f;
    for (let k = 0; k < 3; k++) {
      const p = o + k * STRIDE;
      const x = buf[p], y = buf[p + 1], z = buf[p + 2], w = buf[p + 3];
      let code = 0;
      if (z + w < 0) code |= 1;
      if (w - z < 0) code |= 2;
      if (GUARD * w - x < 0) code |= 4;
      if (GUARD * w + x < 0) code |= 8;
      if (GUARD * w - y < 0) code |= 16;
      if (GUARD * w + y < 0) code |= 32;
      if (code) allIn = false;
      rejectMask &= code;
    }
    if (rejectMask) { st.rejected++; return; }
    let poly = this.polyA;
    let n = 3;
    for (let i = 0; i < 3 * STRIDE; i++) poly[i] = buf[o + i];
    if (!allIn) {
      st.clipped++;
      let other = this.polyB;
      for (let plane = 0; plane < 6 && n > 0; plane++) {
        let m = 0;
        for (let i = 0; i < n; i++) {
          const a = i * STRIDE, b = ((i + 1) % n) * STRIDE;
          const da = planeDist(poly, a, plane), db = planeDist(poly, b, plane);
          if (da >= 0) {
            for (let k = 0; k < STRIDE; k++) other[m * STRIDE + k] = poly[a + k];
            m++;
          }
          if ((da >= 0) !== (db >= 0)) {
            const s = da / (da - db);
            for (let k = 0; k < STRIDE; k++) other[m * STRIDE + k] = poly[a + k] + (poly[b + k] - poly[a + k]) * s;
            m++;
          }
        }
        const sw = poly; poly = other; other = sw;
        n = m;
      }
      if (n < 3) return;
    }
    // Project to snapped screen coordinates; attributes divided by w.
    const pr = this.proj, W = this.W, H = this.H;
    let area2 = 0;
    for (let i = 0; i < n; i++) {
      const a = i * STRIDE;
      const iw = 1 / poly[a + 3];
      pr[a] = Math.round((poly[a] * iw * 0.5 + 0.5) * W * SUB);
      pr[a + 1] = Math.round((0.5 - poly[a + 1] * iw * 0.5) * H * SUB);
      pr[a + 2] = poly[a + 2] * iw * 0.5 + 0.5;
      pr[a + 3] = iw;
      for (let k = 4; k < STRIDE; k++) pr[a + k] = poly[a + k] * iw;
    }
    for (let i = 0; i < n; i++) {
      const a = i * STRIDE, b = ((i + 1) % n) * STRIDE;
      area2 += pr[a] * pr[b + 1] - pr[b] * pr[a + 1];
    }
    if (area2 === 0) return;
    // Screen y points down: negative area is counter-clockwise in GL window space = front face.
    const front = (area2 < 0) !== this.mirrored;
    if (this.cull && !front) { st.culled++; return; }
    for (let i = 1; i + 1 < n; i++) {
      if (area2 > 0) this.raster(0, i, i + 1);
      else this.raster(0, i + 1, i);
    }
  }

  private raster(i0: number, i1: number, i2: number) {
    const P = this.proj;
    const o0 = i0 * STRIDE, o1 = i1 * STRIDE, o2 = i2 * STRIDE;
    const X0 = P[o0], Y0 = P[o0 + 1], X1 = P[o1], Y1 = P[o1 + 1], X2 = P[o2], Y2 = P[o2 + 1];
    const area = (X1 - X0) * (Y2 - Y0) - (X2 - X0) * (Y1 - Y0);
    if (area <= 0) return; // degenerate (or a snapping sliver of the wrong orientation)
    const W = this.W, H = this.H;
    const minX = Math.max(0, Math.ceil((Math.min(X0, X1, X2) - HALF) / SUB));
    const maxX = Math.min(W - 1, Math.floor((Math.max(X0, X1, X2) - HALF) / SUB));
    const minY = Math.max(0, Math.ceil((Math.min(Y0, Y1, Y2) - HALF) / SUB));
    const maxY = Math.min(H - 1, Math.floor((Math.max(Y0, Y1, Y2) - HALF) / SUB));
    if (minX > maxX || minY > maxY) return;

    // Edge functions (positive inside), exact integers in 1/SUB^2 pixel units.
    const A0 = Y1 - Y2, B0 = X2 - X1; // edge v1 -> v2 (weight of v0)
    const A1 = Y2 - Y0, B1 = X0 - X2; // edge v2 -> v0 (weight of v1)
    const A2 = Y0 - Y1, B2 = X1 - X0; // edge v0 -> v1 (weight of v2)
    // Top-left fill rule: pixels exactly on an edge belong to top or left edges only.
    const bias0 = (A0 === 0 && B0 > 0) || A0 > 0 ? 0 : -1;
    const bias1 = (A1 === 0 && B1 > 0) || A1 > 0 ? 0 : -1;
    const bias2 = (A2 === 0 && B2 > 0) || A2 > 0 ? 0 : -1;
    const px0 = minX * SUB + HALF, py0 = minY * SUB + HALF;
    let r0 = A0 * (px0 - X1) + B0 * (py0 - Y1);
    let r1 = A1 * (px0 - X2) + B1 * (py0 - Y2);
    let r2 = A2 * (px0 - X0) + B2 * (py0 - Y0);
    const sx0 = A0 * SUB, sx1 = A1 * SUB, sx2 = A2 * SUB;
    const sy0 = B0 * SUB, sy1 = B1 * SUB, sy2 = B2 * SUB;

    const Z0 = P[o0 + 2], Z1 = P[o1 + 2], Z2 = P[o2 + 2];
    const IW0 = P[o0 + 3], IW1 = P[o1 + 3], IW2 = P[o2 + 3];
    const U0 = P[o0 + 4], U1 = P[o1 + 4], U2 = P[o2 + 4];
    const V0 = P[o0 + 5], V1 = P[o1 + 5], V2 = P[o2 + 5];
    const R0 = P[o0 + 6], R1 = P[o1 + 6], R2 = P[o2 + 6];
    const G0 = P[o0 + 7], G1 = P[o1 + 7], G2 = P[o2 + 7];
    const Bc0 = P[o0 + 8], Bc1 = P[o1 + 8], Bc2 = P[o2 + 8];
    const Al0 = P[o0 + 9], Al1 = P[o1 + 9], Al2 = P[o2 + 9];
    const D0 = P[o0 + 10], D1 = P[o1 + 10], D2 = P[o2 + 10];

    const tex = this.tex, mode = this.mode, fog = this.fog, nearest = this.nearest;
    const depthTest = this.depthTest, depthWrite = this.depthTest && this.depthWrite; // GL: no depth writes without the test
    const color = this.color, depth = this.depth, smp = this.tmp;
    const useLod = tex !== null && this.mip && tex.levels.length > 1;
    // Screen-space derivatives of the barycentrics (per pixel) for the mip LOD.
    const inv = 1 / area;
    const dl0x = sx0 * inv, dl1x = sx1 * inv, dl2x = sx2 * inv;
    const dl0y = sy0 * inv, dl1y = sy1 * inv, dl2y = sy2 * inv;
    const Uwx = dl0x * U0 + dl1x * U1 + dl2x * U2, Uwy = dl0y * U0 + dl1y * U1 + dl2y * U2;
    const Vwx = dl0x * V0 + dl1x * V1 + dl2x * V2, Vwy = dl0y * V0 + dl1y * V1 + dl2y * V2;
    const Wx = dl0x * IW0 + dl1x * IW1 + dl2x * IW2, Wy = dl0y * IW0 + dl1y * IW1 + dl2y * IW2;
    const tw = tex ? tex.levels[0].w : 1, th = tex ? tex.levels[0].h : 1;
    let pixels = 0;

    for (let y = minY; y <= maxY; y++, r0 += sy0, r1 += sy1, r2 += sy2) {
      // Conservative span where each edge value r + s * (x - minX) can be >= 0 (widened by a pixel), then exact
      // integer tests per pixel.
      let xl = minX, xr = maxX, t: number;
      if (sx0 > 0) { t = minX + Math.floor(-r0 / sx0) - 1; if (t > xl) xl = t; }
      else if (sx0 < 0) { t = minX + Math.ceil(r0 / -sx0) + 1; if (t < xr) xr = t; }
      else if (r0 < -1) continue;
      if (sx1 > 0) { t = minX + Math.floor(-r1 / sx1) - 1; if (t > xl) xl = t; }
      else if (sx1 < 0) { t = minX + Math.ceil(r1 / -sx1) + 1; if (t < xr) xr = t; }
      else if (r1 < -1) continue;
      if (sx2 > 0) { t = minX + Math.floor(-r2 / sx2) - 1; if (t > xl) xl = t; }
      else if (sx2 < 0) { t = minX + Math.ceil(r2 / -sx2) + 1; if (t < xr) xr = t; }
      else if (r2 < -1) continue;
      if (xl > xr) continue;
      const rowBase = y * W;
      let e0 = r0 + sx0 * (xl - minX), e1 = r1 + sx1 * (xl - minX), e2 = r2 + sx2 * (xl - minX);
      for (let x = xl; x <= xr; x++, e0 += sx0, e1 += sx1, e2 += sx2) {
        if (e0 + bias0 < 0 || e1 + bias1 < 0 || e2 + bias2 < 0) continue;
        const idx = rowBase + x;
        const l0 = e0 * inv, l1 = e1 * inv, l2 = 1 - l0 - l1;
        let z = l0 * Z0 + l1 * Z1 + l2 * Z2;
        if (z < 0) z = 0; else if (z > 1) z = 1;
        if (depthTest && z > depth[idx]) continue;
        pixels++;
        const iw = l0 * IW0 + l1 * IW1 + l2 * IW2;
        const w = 1 / iw;
        let cr = (l0 * R0 + l1 * R1 + l2 * R2) * w;
        let cg = (l0 * G0 + l1 * G1 + l2 * G2) * w;
        let cb = (l0 * Bc0 + l1 * Bc1 + l2 * Bc2) * w;
        let ca = (l0 * Al0 + l1 * Al1 + l2 * Al2) * w;
        if (tex) {
          const u = (l0 * U0 + l1 * U1 + l2 * U2) * w;
          const v = (l0 * V0 + l1 * V1 + l2 * V2) * w;
          let lambda = 0;
          if (useLod) {
            const dudx = (Uwx - u * Wx) * w * tw, dvdx = (Vwx - v * Wx) * w * th;
            const dudy = (Uwy - u * Wy) * w * tw, dvdy = (Vwy - v * Wy) * w * th;
            const rho2 = Math.max(dudx * dudx + dvdx * dvdx, dudy * dudy + dvdy * dvdy);
            lambda = 0.5 * Math.log2(rho2);
          }
          sampleTex(tex, u, v, lambda, nearest, useLod, smp);
          cr *= smp[0]; cg *= smp[1]; cb *= smp[2]; ca *= smp[3];
        }
        if (mode === Mode.Cutout && ca < 0.5) continue;
        if (mode === Mode.Opaque) ca = 1;
        if (fog) {
          let d = (l0 * D0 + l1 * D1 + l2 * D2) * w;
          if (d < 1e-3) d = 1e-3;
          const zndc = fog.a - fog.b2 / d;
          let f = (zndc * fog.mul + fog.offset) / 255;
          if (f < 0) f = 0; else if (f > 1) f = 1;
          cr += (fog.r - cr) * f; cg += (fog.g - cg) * f; cb += (fog.b - cb) * f;
        }
        if (depthWrite) depth[idx] = z;
        const c = idx * 3;
        if (mode === Mode.Blend) {
          const ia = 1 - ca;
          color[c] = cr * ca + color[c] * ia;
          color[c + 1] = cg * ca + color[c + 1] * ia;
          color[c + 2] = cb * ca + color[c + 2] * ia;
        } else {
          color[c] = cr; color[c + 1] = cg; color[c + 2] = cb;
        }
      }
    }
    this.stats.pixels += pixels;
  }

  toRgba(outW: number, outH: number, ss: number): Uint8Array {
    const out = new Uint8Array(outW * outH * 4);
    const norm = 255 / (ss * ss);
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        let r = 0, g = 0, b = 0;
        for (let j = 0; j < ss; j++) {
          for (let i = 0; i < ss; i++) {
            const c = ((y * ss + j) * this.W + x * ss + i) * 3;
            r += clamp01(this.color[c]); g += clamp01(this.color[c + 1]); b += clamp01(this.color[c + 2]);
          }
        }
        const o = (y * outW + x) * 4;
        out[o] = Math.round(r * norm);
        out[o + 1] = Math.round(g * norm);
        out[o + 2] = Math.round(b * norm);
        out[o + 3] = 255;
      }
    }
    return out;
  }
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function planeDist(p: Float64Array, a: number, plane: number): number {
  const x = p[a], y = p[a + 1], z = p[a + 2], w = p[a + 3];
  switch (plane) {
    case 0: return z + w;
    case 1: return w - z;
    case 2: return GUARD * w - x;
    case 3: return GUARD * w + x;
    case 4: return GUARD * w - y;
    default: return GUARD * w + y;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Level drawing

function modeOf(b: Batch): Mode {
  return b.blend === 'blend' ? Mode.Blend : b.blend === 'cutout' ? Mode.Cutout : Mode.Opaque;
}

function batchTexture(b: Batch, textures: Texture[]): MipTex | null {
  const count = Math.floor(b.positions.length / 3);
  if (b.texture < 0 || b.texture >= textures.length || b.uvs.length < count * 2) return null;
  return getMipTex(textures[b.texture]);
}

function validPanorama(sky: PanoramaSky, textures: Texture[]): boolean {
  const upper = textures[sky.upperTexture], lower = textures[sky.lowerTexture];
  if (!upper || !lower || panoramaQuads(sky, 0, 0).length === 0) return false;
  const panelCount = Math.round(sky.period / sky.panelScreen[0]);
  return panelCount * sky.upperSource[0] <= upper.width && sky.upperSource[1] <= upper.height
    && sky.lowerSource[0] <= lower.width && sky.lowerSource[1] <= lower.height;
}

/** Draw the same logical screen rectangles and texel-centre windows as LevelRenderer.drawPanorama. */
function drawPanorama(r: Raster, sky: PanoramaSky, textures: Texture[], yaw: number, pitch: number) {
  const upperSrc = textures[sky.upperTexture], lowerSrc = textures[sky.lowerTexture];
  if (!upperSrc || !lowerSrc) return;
  const upper = getMipTex(upperSrc), lower = getMipTex(lowerSrc);
  const [logicalW, logicalH] = sky.logicalViewport;
  const tint = [sky.tint[0] / 255, sky.tint[1] / 255, sky.tint[2] / 255];
  const sample = new Float64Array(4);
  const fill = sky.fillAbove;
  const fillBottom = fill ? Math.min(logicalH, Math.max(0, panoramaTop(sky, pitch) + fill.overlap)) : 0;
  if (fill && fillBottom > 0) {
    r.stats.triangles += 2;
    const bottom = fillBottom * r.H / logicalH;
    const maxY = Math.min(r.H - 1, Math.ceil(bottom - 0.5) - 1);
    let pixels = 0;
    for (let y = 0; y <= maxY; y++) for (let x = 0; x < r.W; x++) {
      const out = (y * r.W + x) * 3;
      r.color[out] = fill.color[0] / 255;
      r.color[out + 1] = fill.color[1] / 255;
      r.color[out + 2] = fill.color[2] / 255;
      pixels++;
    }
    r.stats.pixels += pixels;
  }
  for (const quad of panoramaQuads(sky, yaw, pitch)) {
    r.stats.triangles += 2;
    const texture = quad.texture === 'upper' ? upper : lower;
    const textureSrc = quad.texture === 'upper' ? upperSrc : lowerSrc;
    const [logicalLeft, logicalTop, logicalRight, logicalBottom] = quad.rect;
    const left = logicalLeft * r.W / logicalW, right = logicalRight * r.W / logicalW;
    const top = logicalTop * r.H / logicalH, bottom = logicalBottom * r.H / logicalH;
    const minX = Math.max(0, Math.ceil(left - 0.5)), maxX = Math.min(r.W - 1, Math.ceil(right - 0.5) - 1);
    const minY = Math.max(0, Math.ceil(top - 0.5)), maxY = Math.min(r.H - 1, Math.ceil(bottom - 0.5) - 1);
    if (minX > maxX || minY > maxY) {
      r.stats.rejected += 2;
      continue;
    }
    if (left < 0 || right > r.W || top < 0 || bottom > r.H) r.stats.clipped += 2;
    const [sourceLeft, sourceTop, sourceRight, sourceBottom] = quad.source;
    const u0 = (sourceLeft + 0.5) / textureSrc.width, u1 = (sourceRight + 0.5) / textureSrc.width;
    const v0 = (sourceTop + 0.5) / textureSrc.height, v1 = (sourceBottom + 0.5) / textureSrc.height;
    const lambda = Math.log2(Math.max(Math.abs((u1 - u0) * textureSrc.width / (right - left)), Math.abs((v1 - v0) * textureSrc.height / (bottom - top))));
    let pixels = 0;
    for (let y = minY; y <= maxY; y++) {
      const v = v0 + (v1 - v0) * ((y + 0.5 - top) / (bottom - top));
      for (let x = minX; x <= maxX; x++) {
        const u = u0 + (u1 - u0) * ((x + 0.5 - left) / (right - left));
        sampleTex(texture, u, v, lambda, r.nearest, r.mip, sample);
        const out = (y * r.W + x) * 3;
        r.color[out] = sample[0] * tint[0];
        r.color[out + 1] = sample[1] * tint[1];
        r.color[out + 2] = sample[2] * tint[2];
        pixels++;
      }
    }
    r.stats.pixels += pixels;
  }
}

/** Render a level to RGBA8 (width x height, row 0 = top, alpha 255). */
export function renderLevel(level: LevelLike, opts: RenderOptions): Uint8Array {
  const t0 = performance.now();
  const outW = opts.width | 0, outH = opts.height | 0;
  if (!(outW > 0 && outH > 0)) throw new Error('renderLevel: width and height must be positive integers');
  const ss = Math.max(1, Math.floor(opts.supersample ?? 1));
  const cam = buildCamera(opts, outW / outH);
  const stats: RenderStats = opts.stats ?? { triangles: 0, culled: 0, clipped: 0, rejected: 0, pixels: 0, ms: 0 };
  Object.assign(stats, { triangles: 0, culled: 0, clipped: 0, rejected: 0, pixels: 0, ms: 0 });
  const r = new Raster(outW * ss, outH * ss, cam, opts.filter === 'nearest', opts.mipmaps !== false, stats);
  const { textures, meshes } = level;
  const cullOn = opts.cull === true;

  const fogSrc: Fog | null = opts.fog === true && level.fog ? level.fog : null;
  const fog: FogParams | null = fogSrc
    ? {
        r: fogSrc.color[0] / 255, g: fogSrc.color[1] / 255, b: fogSrc.color[2] / 255,
        a: (fogSrc.far + fogSrc.near) / (fogSrc.far - fogSrc.near),
        b2: (2 * fogSrc.far * fogSrc.near) / (fogSrc.far - fogSrc.near),
        mul: fogSrc.multiplier, offset: fogSrc.offset,
      }
    : null;

  // Sky selection and clear colour, as LevelRenderer.setLevel/render.
  const [ex, ey, ez] = cam.eye;
  let clear: RGB = DEFAULT_CLEAR;
  const skyDraws: { mesh: Mesh; model: Float64Array; forceBlend: boolean }[] = [];
  let panorama: PanoramaSky | null = null;
  if (level.skies && level.skies.length > 0) {
    const valid = level.skies.filter((s) => s.kind === 'panorama' ? validPanorama(s, textures) : meshes[s.mesh]);
    const active = valid.find((s) => s.name === opts.sky) ?? valid[0];
    if (active?.kind === 'panorama') panorama = active;
    else if (active) skyDraws.push({ mesh: meshes[active.mesh], model: mat4.translation(ex, ey, ez), forceBlend: true });
  } else {
    let groundY: number | null = null;
    for (const index of level.unplaced ?? []) {
      const src = meshes[index];
      if (!src || !src.name.endsWith('SKY')) continue;
      groundY ??= opts.skyGroundY ?? medianGroundY(level);
      skyDraws.push({ mesh: src, model: mat4.translation(ex, ey - groundY, ez), forceBlend: false });
      clear = horizonColor(src, textures) ?? clear;
    }
  }
  if (fog) clear = [fog.r, fog.g, fog.b];
  if (opts.background) clear = [opts.background[0] / 255, opts.background[1] / 255, opts.background[2] / 255];
  r.clear(clear);

  const setState = (b: Batch, mode: Mode, depthTest: boolean, depthWrite: boolean, mirrored: boolean, allowCull: boolean) => {
    r.tex = batchTexture(b, textures);
    r.mode = mode;
    r.depthTest = depthTest;
    r.depthWrite = depthWrite;
    r.cull = b.forceCullBack === true || (allowCull && cullOn && b.cullBack === true);
    r.mirrored = mirrored;
  };
  const drawBatch = (b: Batch, model: Mat4) => {
    const { buf, tris } = r.transform(b, model);
    for (let t = 0; t < tris; t++) r.triangle(buf, t);
  };

  // Sky: no depth, no fog, no culling.
  if (opts.drawSkies !== false) {
    r.fog = null;
    if (panorama) drawPanorama(r, panorama, textures, Math.atan2(cam.forward[0], -cam.forward[2]), Math.asin(Math.max(-1, Math.min(1, cam.forward[1]))));
    for (const s of skyDraws) {
      const solid = s.forceBlend ? [] : s.mesh.batches.filter((b) => modeOf(b) !== Mode.Blend);
      const blended = s.forceBlend ? s.mesh.batches : s.mesh.batches.filter((b) => modeOf(b) === Mode.Blend);
      for (const b of solid) { setState(b, modeOf(b), false, false, false, false); drawBatch(b, s.model); }
      for (const b of blended) { setState(b, Mode.Blend, false, false, false, false); drawBatch(b, s.model); }
    }
  }
  r.fog = fog;

  // Instances.
  const items: { inst: Instance; mesh: Mesh; model: Mat4; mirrored: boolean; dist: number }[] = [];
  level.instances.forEach((inst, index) => {
    if (inst.mesh < 0 || !meshes[inst.mesh]) return;
    if (inst.animated && opts.showAnimated === false) return;
    if (opts.instanceFilter && !opts.instanceFilter(inst, index)) return;
    const m = inst.matrix;
    const dx = m[12] - ex, dy = m[13] - ey, dz = m[14] - ez;
    items.push({ inst, mesh: meshes[inst.mesh], model: m, mirrored: det3(m) < 0, dist: dx * dx + dy * dy + dz * dz });
  });

  for (const it of items) {
    for (const b of it.mesh.batches) {
      const mode = modeOf(b);
      if (mode === Mode.Blend) continue;
      setState(b, mode, b.depthTest, b.depthWrite, it.mirrored, true);
      drawBatch(b, it.model);
    }
  }

  const blendItems = items.filter((it) => it.mesh.batches.some((b) => b.blend === 'blend'));
  if (opts.blendSort === 'triangle') {
    const parts: { b: Batch; it: (typeof items)[number]; buf: Float64Array }[] = [];
    const order: { part: number; tri: number; key: number }[] = [];
    for (const it of blendItems) {
      for (const b of it.mesh.batches) {
        if (modeOf(b) !== Mode.Blend) continue;
        setState(b, Mode.Blend, b.depthTest, false, it.mirrored, true);
        const count = Math.floor(b.positions.length / 3);
        const { buf, tris } = r.transform(b, it.model, new Float64Array(Math.floor(count / 3) * 3 * STRIDE));
        for (let t = 0; t < tris; t++) {
          const o = t * 3 * STRIDE;
          order.push({ part: parts.length, tri: t, key: buf[o + 10] + buf[o + STRIDE + 10] + buf[o + 2 * STRIDE + 10] });
        }
        parts.push({ b, it, buf });
      }
    }
    order.sort((a, b) => b.key - a.key);
    for (const e of order) {
      const p = parts[e.part];
      setState(p.b, Mode.Blend, p.b.depthTest, false, p.it.mirrored, true);
      r.triangle(p.buf, e.tri);
    }
  } else {
    blendItems.sort((a, b) => b.dist - a.dist);
    for (const it of blendItems) {
      for (const b of it.mesh.batches) {
        if (modeOf(b) !== Mode.Blend) continue;
        setState(b, Mode.Blend, b.depthTest, false, it.mirrored, true);
        drawBatch(b, it.model);
      }
    }
  }

  const out = r.toRgba(outW, outH, ss);
  stats.ms = performance.now() - t0;
  return out;
}

/** Render meshes all placed at the identity transform (no skies, no fog). */
export function renderMeshes(meshes: Mesh[], textures: Texture[], opts: RenderOptions): Uint8Array {
  const identity = mat4.toFloat32(mat4.identity());
  return renderLevel({ textures, meshes, instances: meshes.map((m, i) => ({ name: m.name, mesh: i, matrix: identity })) }, opts);
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers

/** Median world height of static (non-animated) placed geometry, sampled like the viewer's computeStartView. */
export function medianGroundY(level: LevelLike): number {
  const placed = level.instances.filter((i) => i.mesh >= 0 && i.mesh < level.meshes.length && !i.animated);
  let vertices = 0;
  for (const inst of placed) for (const b of level.meshes[inst.mesh].batches) vertices += Math.floor(b.positions.length / 9) * 3;
  if (vertices === 0) return 0;
  const step = Math.max(1, Math.floor(vertices / 20000));
  const ys: number[] = [];
  let v = 0;
  for (const inst of placed) {
    const m = inst.matrix;
    for (const b of level.meshes[inst.mesh].batches) {
      const n = Math.floor(b.positions.length / 9) * 3;
      // Global vertex indices v..v+n-1; take those that are multiples of step.
      let k = (step - (v % step)) % step;
      for (; k < n; k += step) {
        const p = b.positions;
        ys.push(m[1] * p[k * 3] + m[5] * p[k * 3 + 1] + m[9] * p[k * 3 + 2] + m[13]);
      }
      v += n;
    }
  }
  ys.sort((a, b) => a - b);
  return ys[ys.length >> 1];
}

function horizonColor(mesh: Mesh, textures: Texture[]): RGB | null {
  let minY = Infinity, maxY = -Infinity;
  for (const b of mesh.batches) {
    for (let i = 1; i < b.positions.length; i += 3) {
      minY = Math.min(minY, b.positions[i]);
      maxY = Math.max(maxY, b.positions[i]);
    }
  }
  if (!Number.isFinite(minY)) return null;
  const limit = minY + (maxY - minY) * 0.02;
  let r = 0, g = 0, bl = 0, n = 0;
  for (const b of mesh.batches) {
    const tex = textures[b.texture];
    let tint: RGB = [1, 1, 1];
    if (tex && tex.rgba.length >= 4) {
      let tr = 0, tg = 0, tb = 0;
      const count = Math.floor(tex.rgba.length / 4);
      for (let i = 0; i < count * 4; i += 4) { tr += tex.rgba[i]; tg += tex.rgba[i + 1]; tb += tex.rgba[i + 2]; }
      tint = [tr / count / 255, tg / count / 255, tb / count / 255];
    }
    for (let v = 0; v * 3 < b.positions.length; v++) {
      if (b.positions[v * 3 + 1] > limit || b.colors.length < (v + 1) * 4) continue;
      r += b.colors[v * 4] * tint[0];
      g += b.colors[v * 4 + 1] * tint[1];
      bl += b.colors[v * 4 + 2] * tint[2];
      n++;
    }
  }
  return n > 0 ? [r / n / 255, g / n / 255, bl / n / 255] : null;
}

/** World-space bounds of all placed instances' vertices (falls back to level.bounds, then a unit box). */
export function levelBounds(level: LevelLike): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const inst of level.instances) {
    const mesh = level.meshes[inst.mesh];
    if (!mesh) continue;
    const m = inst.matrix;
    for (const b of mesh.batches) {
      const p = b.positions;
      for (let i = 0; i + 2 < p.length; i += 3) {
        for (let r = 0; r < 3; r++) {
          const w = m[r] * p[i] + m[4 + r] * p[i + 1] + m[8 + r] * p[i + 2] + m[12 + r];
          if (w < min[r]) min[r] = w;
          if (w > max[r]) max[r] = w;
        }
      }
    }
  }
  if (min.every(Number.isFinite)) return { min, max };
  if (level.bounds) return { min: [...level.bounds.min], max: [...level.bounds.max] };
  return { min: [-1, -1, -1], max: [1, 1, 1] };
}

/**
 * Useful default views of a bounding box: 'top' (orthographic, looking down -Y, screen up = -Z, right = +X) and
 * four 3/4 perspective views from above each corner ('corner_px_pz', 'corner_nx_pz', 'corner_nx_nz',
 * 'corner_px_nz'), each fitting the bounding sphere. Spread with {width, height} into renderLevel options; pass the
 * same aspect (width / height) and fovY you render with.
 */
export function autoCameras(bounds: { min: Vec3 | number[]; max: Vec3 | number[] }, aspect = 4 / 3, fovY = 45): NamedCamera[] {
  const mn = bounds.min, mx = bounds.max;
  const c: Vec3 = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
  const sx = Math.max(mx[0] - mn[0], 1e-6), sy = Math.max(mx[1] - mn[1], 0), sz = Math.max(mx[2] - mn[2], 1e-6);
  const radius = Math.max(0.5 * Math.hypot(sx, sy, sz), 1e-3);
  const margin = Math.max(radius * 0.02, 1e-3);
  const cams: NamedCamera[] = [
    {
      name: 'top',
      eye: [c[0], mx[1] + margin, c[2]],
      target: [c[0], mn[1], c[2]],
      up: [0, 0, -1],
      ortho: { halfHeight: Math.max(sz / 2, sx / 2 / aspect) * 1.03 },
      near: 0,
      far: sy + 2 * margin,
    },
  ];
  const halfFov = (Math.min(fovY, 2 * (180 / Math.PI) * Math.atan(Math.tan((fovY * Math.PI) / 360) * aspect)) * Math.PI) / 360;
  const dist = (radius / Math.sin(halfFov)) * 1.02;
  const elev = (35 * Math.PI) / 180;
  for (const [nx, nz, name] of [[1, 1, 'corner_px_pz'], [-1, 1, 'corner_nx_pz'], [-1, -1, 'corner_nx_nz'], [1, -1, 'corner_px_nz']] as const) {
    const hx = nx * sx, hz = nz * sz, hl = Math.hypot(hx, hz);
    const dir: Vec3 = [(Math.cos(elev) * hx) / hl, Math.sin(elev), (Math.cos(elev) * hz) / hl];
    cams.push({
      name,
      eye: [c[0] + dir[0] * dist, c[1] + dir[1] * dist, c[2] + dir[2] * dist],
      target: c,
      fovY,
      near: Math.max((dist - radius) * 0.5, dist * 1e-4),
      far: (dist + radius) * 1.5,
    });
  }
  return cams;
}
