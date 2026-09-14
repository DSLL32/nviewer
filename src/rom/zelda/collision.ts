// Collision and waterbox overlays (docs/ZELDA64.md §5.5) and the floor below a point, for the start camera.
import type { Batch } from '../types';
import type { Collision } from './scene';

// Surface kinds by the polygon normal: floor, wall, ceiling.
const COLORS: [number, number, number][] = [[90, 200, 90], [200, 150, 80], [200, 90, 200]];

// One translucent mesh of all static collision triangles, coloured by floor/wall/ceiling and shaded a little by the
// surface type so neighbouring surfaces stay distinguishable. World space, depth-tested without depth writes.
export function collisionBatch(c: Collision): Batch | null {
  const pos: number[] = [], col: number[] = [];
  for (const p of c.polys) {
    const v = p.v.map((i) => c.vertices[i]);
    if (v.some((x) => !x)) continue;
    const kind = p.normal[1] > 0.5 ? 0 : p.normal[1] < -0.5 ? 2 : 1;
    const st = c.surfaceTypes[p.type] ?? [0, 0];
    const h = (Math.imul(st[0] ^ Math.imul(st[1], 40503), 2654435761) >>> 24) / 255;
    const shade = 0.7 + 0.3 * h;
    const rgb = COLORS[kind].map((x) => Math.round(x * shade));
    for (const x of v) {
      pos.push(x[0], x[1], x[2]);
      col.push(rgb[0], rgb[1], rgb[2], 150);
    }
  }
  if (!pos.length) return null;
  return {
    texture: -1, blend: 'blend', depthTest: true, depthWrite: false, cullBack: false,
    positions: new Float32Array(pos), uvs: new Float32Array((pos.length / 3) * 2), colors: new Uint8Array(col),
  };
}

// Waterboxes as translucent quads at the surface height, both sides visible.
export function waterBoxBatch(c: Collision): Batch | null {
  const pos: number[] = [], col: number[] = [];
  for (const w of c.waterBoxes) {
    const x0 = w.xMin, x1 = w.xMin + w.xLength, z0 = w.zMin, z1 = w.zMin + w.zLength, y = w.ySurface;
    for (const [x, z] of [[x0, z0], [x0, z1], [x1, z1], [x0, z0], [x1, z1], [x1, z0]]) {
      pos.push(x, y, z);
      col.push(40, 110, 255, 120);
    }
  }
  if (!pos.length) return null;
  return {
    texture: -1, blend: 'blend', depthTest: true, depthWrite: false, cullBack: false,
    positions: new Float32Array(pos), uvs: new Float32Array((pos.length / 3) * 2), colors: new Uint8Array(col),
  };
}

// The fraction (0..1) of the segment from `a` to `b` before it first hits a collision polygon, 1 if it hits none.
export function segmentHit(c: Collision, a: number[], b: number[]): number {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  let best = 1;
  for (const p of c.polys) {
    const [v0, v1, v2] = p.v.map((i) => c.vertices[i]);
    if (!v0 || !v1 || !v2) continue;
    // Moller-Trumbore
    const e1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]], e2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
    const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
    if (Math.abs(det) < 1e-9) continue;
    const inv = 1 / det, s = [a[0] - v0[0], a[1] - v0[1], a[2] - v0[2]];
    const u = inv * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]);
    if (u < 0 || u > 1) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = inv * (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]);
    if (v < 0 || u + v > 1) continue;
    const t = inv * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]);
    if (t > 1e-4 && t < best) best = t;
  }
  return best;
}

// The highest floor polygon at or below (x, y + 50, z): its surface type's bg camera index, or -1.
export function floorBgCam(c: Collision, x: number, y: number, z: number): number {
  let best = -Infinity, cam = -1;
  for (const p of c.polys) {
    if (p.normal[1] <= 0.5) continue;
    const [a, b, d] = p.v.map((i) => c.vertices[i]);
    if (!a || !b || !d) continue;
    // Barycentric test in the XZ plane.
    const den = (b[2] - d[2]) * (a[0] - d[0]) + (d[0] - b[0]) * (a[2] - d[2]);
    if (!den) continue;
    const l1 = ((b[2] - d[2]) * (x - d[0]) + (d[0] - b[0]) * (z - d[2])) / den;
    const l2 = ((d[2] - a[2]) * (x - d[0]) + (a[0] - d[0]) * (z - d[2])) / den;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
    const h = l1 * a[1] + l2 * b[1] + l3 * d[1];
    if (h > y + 50 || h <= best) continue;
    best = h;
    cam = (c.surfaceTypes[p.type]?.[0] ?? 0) & 0xff;
  }
  return cam;
}
