// CPU picking for bug reports: a camera ray against the triangles of the placed instances.
import type { Batch, Level, Texture } from '../rom';
import type { Vec3 } from './math';

export interface PickHit {
  instance: number; // index into Level.instances
  batch: number; // index into the mesh's batches
  tri: number; // triangle index within the batch
  t: number; // distance along the (normalised) world ray
  point: Vec3; // world-space hit point
}

export interface PickOptions {
  /** Whether an instance is currently drawn (e.g. scripted objects can be hidden). */
  include(instanceIndex: number): boolean;
  /** Skip back faces of batches the game culls (when the viewer draws them culled). */
  cullBackFaces: boolean;
  /** Ignore hits closer than this (the camera's near plane). */
  minT: number;
}

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

interface MeshBounds extends Aabb {
  batches: (Aabb | null)[];
}

type Affine = Float64Array; // 12 numbers: column-major 3x3 followed by the translation

export class LevelPicker {
  readonly level: Level;
  private readonly meshBounds = new Map<number, MeshBounds | null>();
  private readonly inverses = new Map<number, Affine | null>();

  constructor(level: Level) {
    this.level = level;
  }

  /** Local-space bounds of a mesh (and of each of its batches), or null when it has no triangles. */
  bounds(meshIndex: number): MeshBounds | null {
    let b = this.meshBounds.get(meshIndex);
    if (b !== undefined) return b;
    const mesh = this.level.meshes[meshIndex];
    b = null;
    if (mesh) {
      const batches = mesh.batches.map((batch) => positionsBounds(batch.positions));
      const valid = batches.filter((x): x is Aabb => x !== null);
      if (valid.length > 0) {
        const min: Vec3 = [Infinity, Infinity, Infinity];
        const max: Vec3 = [-Infinity, -Infinity, -Infinity];
        for (const v of valid) {
          for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], v.min[k]);
            max[k] = Math.max(max[k], v.max[k]);
          }
        }
        b = { min, max, batches };
      }
    }
    this.meshBounds.set(meshIndex, b);
    return b;
  }

  /** Nearest triangle hit by the world ray origin + t * dir (dir normalised). */
  pick(origin: Vec3, dir: Vec3, opts: PickOptions): PickHit | null {
    const level = this.level;
    let best: PickHit | null = null;
    let bestT = Infinity;
    const lo = new Float64Array(3);
    const ld = new Float64Array(3);
    for (let ii = 0; ii < level.instances.length; ii++) {
      const inst = level.instances[ii];
      if (inst.mesh < 0 || !opts.include(ii)) continue;
      const mesh = level.meshes[inst.mesh];
      const bounds = mesh ? this.bounds(inst.mesh) : null;
      if (!mesh || !bounds) continue;
      const inv = this.inverse(ii);
      if (!inv) continue;
      // Local ray; t keeps its world meaning because the transform is affine.
      for (let k = 0; k < 3; k++) {
        lo[k] = inv[k] * origin[0] + inv[3 + k] * origin[1] + inv[6 + k] * origin[2] + inv[9 + k];
        ld[k] = inv[k] * dir[0] + inv[3 + k] * dir[1] + inv[6 + k] * dir[2];
      }
      if (!rayHitsBox(lo, ld, bounds, opts.minT, bestT)) continue;
      const mirrored = det3(inst.matrix) < 0;
      for (let bi = 0; bi < mesh.batches.length; bi++) {
        const bb = bounds.batches[bi];
        if (!bb || !rayHitsBox(lo, ld, bb, opts.minT, bestT)) continue;
        const batch = mesh.batches[bi];
        const cull = opts.cullBackFaces && batch.cullBack === true;
        const hit = rayBatch(lo, ld, batch, level.textures, cull, mirrored, opts.minT, bestT);
        if (hit) {
          bestT = hit.t;
          best = { instance: ii, batch: bi, tri: hit.tri, t: hit.t, point: [origin[0] + dir[0] * hit.t, origin[1] + dir[1] * hit.t, origin[2] + dir[2] * hit.t] };
        }
      }
    }
    return best;
  }

  private inverse(instanceIndex: number): Affine | null {
    let inv = this.inverses.get(instanceIndex);
    if (inv === undefined) {
      inv = invertAffine(this.level.instances[instanceIndex].matrix);
      this.inverses.set(instanceIndex, inv);
    }
    return inv;
  }
}

function positionsBounds(p: Float32Array): Aabb | null {
  const n = Math.floor(p.length / 9) * 9;
  if (n === 0) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = p[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

/** Slab test: does the ray enter the box (slightly padded) before maxT and leave it after minT? */
function rayHitsBox(o: Float64Array, d: Float64Array, box: Aabb, minT: number, maxT: number): boolean {
  let t0 = minT;
  let t1 = maxT;
  for (let k = 0; k < 3; k++) {
    const pad = 1e-3 * Math.max(1, box.max[k] - box.min[k]);
    const lo = box.min[k] - pad;
    const hi = box.max[k] + pad;
    if (Math.abs(d[k]) < 1e-12) {
      if (o[k] < lo || o[k] > hi) return false;
      continue;
    }
    let a = (lo - o[k]) / d[k];
    let b = (hi - o[k]) / d[k];
    if (a > b) [a, b] = [b, a];
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return false;
  }
  return true;
}

/** Möller–Trumbore over a non-indexed batch; honours back-face culling and the same alpha cut as the shader. */
function rayBatch(
  o: Float64Array,
  d: Float64Array,
  batch: Batch,
  textures: Texture[],
  cull: boolean,
  mirrored: boolean,
  minT: number,
  maxT: number,
): { tri: number; t: number } | null {
  const p = batch.positions;
  const tris = Math.floor(p.length / 9);
  const tex = batch.texture >= 0 ? textures[batch.texture] : undefined;
  const alphaTested = batch.blend !== 'opaque';
  let best: { tri: number; t: number } | null = null;
  let bestT = maxT;
  for (let tri = 0; tri < tris; tri++) {
    const i = tri * 9;
    const ax = p[i], ay = p[i + 1], az = p[i + 2];
    const e1x = p[i + 3] - ax, e1y = p[i + 4] - ay, e1z = p[i + 5] - az;
    const e2x = p[i + 6] - ax, e2y = p[i + 7] - ay, e2z = p[i + 8] - az;
    const px = d[1] * e2z - d[2] * e2y;
    const py = d[2] * e2x - d[0] * e2z;
    const pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) continue;
    // det > 0: the ray sees the counter-clockwise (front) side in local space; a mirrored matrix swaps sides.
    if (cull && (mirrored ? det > 0 : det < 0)) continue;
    const inv = 1 / det;
    const tx = o[0] - ax, ty = o[1] - ay, tz = o[2] - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t < minT || t >= bestT) continue;
    if (alphaTested && coverage(batch, tex, tri, u, v) < (batch.blend === 'cutout' ? 0.5 : 0.02)) continue;
    bestT = t;
    best = { tri, t };
  }
  return best;
}

/** Fragment alpha at barycentric (u, v): vertex alpha times the nearest texel's alpha, as drawn. */
function coverage(batch: Batch, tex: Texture | undefined, tri: number, u: number, v: number): number {
  const w = 1 - u - v;
  const c = batch.colors;
  const vi = tri * 3;
  let alpha = c.length >= (vi + 3) * 4 ? (c[vi * 4 + 3] * w + c[(vi + 1) * 4 + 3] * u + c[(vi + 2) * 4 + 3] * v) / 255 : 1;
  const uv = batch.uvs;
  if (tex && uv.length >= (vi + 3) * 2 && tex.width > 0 && tex.height > 0 && tex.rgba.length >= tex.width * tex.height * 4) {
    const s = uv[vi * 2] * w + uv[(vi + 1) * 2] * u + uv[(vi + 2) * 2] * v;
    const t = uv[vi * 2 + 1] * w + uv[(vi + 1) * 2 + 1] * u + uv[(vi + 2) * 2 + 1] * v;
    const x = wrapTexel(s, tex.width, tex.wrapS);
    const y = wrapTexel(t, tex.height, tex.wrapT);
    alpha *= tex.rgba[(y * tex.width + x) * 4 + 3] / 255;
  }
  return alpha;
}

function wrapTexel(coord: number, size: number, mode: Texture['wrapS']): number {
  let f: number;
  if (mode === 'clamp') f = Math.min(1, Math.max(0, coord));
  else if (mode === 'mirror') {
    const m = coord - 2 * Math.floor(coord / 2);
    f = m > 1 ? 2 - m : m;
  } else f = coord - Math.floor(coord);
  return Math.min(size - 1, Math.max(0, Math.floor(f * size)));
}

function invertAffine(m: Float32Array): Affine | null {
  const a = m[0], b = m[4], c = m[8];
  const d = m[1], e = m[5], f = m[9];
  const g = m[2], h = m[6], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const s = 1 / det;
  // Row-major inverse r, stored column-major.
  const r00 = A * s, r01 = -(b * i - c * h) * s, r02 = (b * f - c * e) * s;
  const r10 = B * s, r11 = (a * i - c * g) * s, r12 = -(a * f - c * d) * s;
  const r20 = C * s, r21 = -(a * h - b * g) * s, r22 = (a * e - b * d) * s;
  const tx = m[12], ty = m[13], tz = m[14];
  return new Float64Array([
    r00, r10, r20,
    r01, r11, r21,
    r02, r12, r22,
    -(r00 * tx + r01 * ty + r02 * tz), -(r10 * tx + r11 * ty + r12 * tz), -(r20 * tx + r21 * ty + r22 * tz),
  ]);
}

export function det3(m: Float32Array): number {
  return m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
}

export function transformPoint(m: Float32Array, x: number, y: number, z: number): Vec3 {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}

/** World-space bounds of an instance, from all of its transformed vertices. */
export function instanceWorldBounds(level: Level, instanceIndex: number): Aabb | null {
  const inst = level.instances[instanceIndex];
  const mesh = inst && inst.mesh >= 0 ? level.meshes[inst.mesh] : undefined;
  if (!mesh) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const m = inst.matrix;
  for (const b of mesh.batches) {
    const p = b.positions;
    for (let i = 0; i + 2 < p.length; i += 3) {
      const w = transformPoint(m, p[i], p[i + 1], p[i + 2]);
      for (let k = 0; k < 3; k++) {
        if (w[k] < min[k]) min[k] = w[k];
        if (w[k] > max[k]) max[k] = w[k];
      }
    }
  }
  return Number.isFinite(min[0]) ? { min, max } : null;
}

/** The 12 edges of a local box under an instance matrix, as world-space line vertex pairs. */
export function orientedBoxLines(box: Aabb, m: Float32Array): Float32Array {
  const corners: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    corners.push(transformPoint(m, i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]));
  }
  const out = new Float32Array(24 * 3);
  let o = 0;
  for (let i = 0; i < 8; i++) {
    for (const bit of [1, 2, 4]) {
      if (i & bit) continue;
      out.set(corners[i], o);
      out.set(corners[i | bit], o + 3);
      o += 6;
    }
  }
  return out;
}

/** World-space corners of one triangle of an instance's batch. */
export function triangleWorld(level: Level, instanceIndex: number, batchIndex: number, tri: number): [Vec3, Vec3, Vec3] | null {
  const inst = level.instances[instanceIndex];
  const batch = inst && inst.mesh >= 0 ? level.meshes[inst.mesh]?.batches[batchIndex] : undefined;
  if (!batch || (tri + 1) * 9 > batch.positions.length) return null;
  const p = batch.positions;
  const i = tri * 9;
  return [
    transformPoint(inst.matrix, p[i], p[i + 1], p[i + 2]),
    transformPoint(inst.matrix, p[i + 3], p[i + 4], p[i + 5]),
    transformPoint(inst.matrix, p[i + 6], p[i + 7], p[i + 8]),
  ];
}
