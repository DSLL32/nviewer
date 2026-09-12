// Coplanar surfaces in room geometry (depth fighting on a GPU).
//
// Decals: the rooms mark overlays (paths, markings) with the RDP's ZMODE_DEC, which passes a pixel whose depth is within
// the pixel's depth slope of the stored depth. Some overlays lie a fraction of a unit below the surface they decorate
// (e.g. the paths of the 1997 Hyrule Field dip 0.3-0.4 units under the grass where they cross its creases), which the
// RDP accepts but the viewer's constant decal depth offset does not: such decal triangles are lifted onto that surface.
//
// Coplanar non-decal surfaces: the game relies on draw order (the later surface wins where depths are equal); the later
// of two overlapping same-facing coplanar triangles becomes a decal. The same triangle drawn twice (identical vertex
// positions: boundary geometry that neighbouring room files both contain) gets identical depths on a GPU and is left
// alone.
import type { Batch } from '../types';

interface Tri {
  batch: number; // index into the batch list
  tri: number;
  order: number; // draw order: run index, then command address
  src: number;
  n: [number, number, number];
  d: number;
  p: Float32Array; // the batch's positions (shared)
}

const PLANE_TOL = 1; // units: vertices of the other triangle within this distance of the plane
const OVERLAP_EPS = 0.5; // units: overlap needed along every separating axis (shared edges do not count)
const LIFT_RANGE = 2; // units: decal vertices at most this far below a surface are lifted onto it
const LIFT_MIN = 0.05;

const CELL = 256; // units: spatial grid for candidate surfaces (plane offsets are too sensitive far from the origin)

// Visits the grid cells overlapping the box [min - grow, max + grow].
function cells(min: number[], max: number[], grow: number, visit: (k: string) => void) {
  const lo = min.map((v) => Math.floor((v - grow) / CELL)), hi = max.map((v) => Math.floor((v + grow) / CELL));
  for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) visit(`${x},${y},${z}`);
}

function triBox(p: Float32Array, o: number): [number[], number[]] {
  const min = [Math.min(p[o], p[o + 3], p[o + 6]), Math.min(p[o + 1], p[o + 4], p[o + 7]), Math.min(p[o + 2], p[o + 5], p[o + 8])];
  const max = [Math.max(p[o], p[o + 3], p[o + 6]), Math.max(p[o + 1], p[o + 4], p[o + 7]), Math.max(p[o + 2], p[o + 5], p[o + 8])];
  return [min, max];
}

// 2D separating-axis overlap of two coplanar triangles, projected on the plane's dominant axes.
function overlaps(a: Tri, b: Tri): boolean {
  const ax = Math.abs(a.n[0]), ay = Math.abs(a.n[1]), az = Math.abs(a.n[2]);
  const [i, j] = ax >= ay && ax >= az ? [1, 2] : ay >= az ? [0, 2] : [0, 1];
  const pts = (t: Tri) => [0, 1, 2].map((v) => [t.p[t.tri * 9 + v * 3 + i], t.p[t.tri * 9 + v * 3 + j]]);
  const P = pts(a), Q = pts(b);
  for (const poly of [P, Q]) {
    for (let k = 0; k < 3; k++) {
      const ex = poly[(k + 1) % 3][0] - poly[k][0], ey = poly[(k + 1) % 3][1] - poly[k][1];
      const len = Math.hypot(ex, ey);
      if (len < 1e-6) continue;
      const nx = -ey / len, ny = ex / len;
      const range = (S: number[][]) => {
        let lo = Infinity, hi = -Infinity;
        for (const s of S) {
          const v = s[0] * nx + s[1] * ny;
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
        return [lo, hi];
      };
      const [a0, a1] = range(P), [b0, b1] = range(Q);
      if (Math.min(a1, b1) - Math.max(a0, b0) < OVERLAP_EPS) return false;
    }
  }
  return true;
}

// Both triangles have the same three vertex positions (in any order).
function sameVertices(a: Tri, b: Tri): boolean {
  for (let v = 0; v < 3; v++) {
    const o = a.tri * 9 + v * 3;
    let found = false;
    for (let w = 0; w < 3 && !found; w++) {
      const q = b.tri * 9 + w * 3;
      found = Math.abs(a.p[o] - b.p[q]) < 0.01 && Math.abs(a.p[o + 1] - b.p[q + 1]) < 0.01 && Math.abs(a.p[o + 2] - b.p[q + 2]) < 0.01;
    }
    if (!found) return false;
  }
  return true;
}

// Splits the triangles `tris` of a batch into a new decal batch (same state).
function extract(b: Batch, tris: Set<number>): [Batch, Batch] {
  const keep: number[] = [], move: number[] = [];
  const n = b.positions.length / 9;
  for (let t = 0; t < n; t++) (tris.has(t) ? move : keep).push(t);
  const part = (list: number[], decal: boolean): Batch => {
    const pick = <T extends Float32Array | Uint8Array | Uint32Array>(a: T, per: number, make: (k: number) => T): T => {
      const out = make(list.length * per);
      list.forEach((t, k) => out.set(a.subarray(t * per, (t + 1) * per), k * per));
      return out;
    };
    return {
      ...b,
      ...(decal ? { decal: true } : {}),
      positions: pick(b.positions, 9, (k) => new Float32Array(k)),
      uvs: pick(b.uvs, 6, (k) => new Float32Array(k)),
      colors: pick(b.colors, 12, (k) => new Uint8Array(k)),
      ...(b.unlitColors ? { unlitColors: pick(b.unlitColors, 12, (k) => new Uint8Array(k)) } : {}),
      ...(b.lightingColors ? { lightingColors: b.lightingColors.map((colors) => pick(colors, 12, (k) => new Uint8Array(k))) } : {}),
      ...(b.triSource ? { triSource: pick(b.triSource, 1, (k) => new Uint32Array(k)) } : {}),
      ...(b.uvs1 ? { uvs1: pick(b.uvs1, 6, (k) => new Float32Array(k)) } : {}),
    };
  };
  return [part(keep, false), part(move, true)];
}

export interface CoplanarResult { batches: Batch[]; origin: number[]; lifted: number; newDecals: number }

// `batches` in draw order with their run index (the display list they came from, in the order the game draws them).
// Returns the batches with decal vertices lifted in place and coplanar later triangles split into decal batches, and
// for each returned batch the index of the input batch it comes from.
export function resolveCoplanar(batches: Batch[], runs: number[]): CoplanarResult {
  const tris: Tri[] = [];
  batches.forEach((b, bi) => {
    if (!b.depthTest) return;
    const p = b.positions;
    for (let t = 0; t * 9 + 9 <= p.length; t++) {
      const o = t * 9;
      const e1 = [p[o + 3] - p[o], p[o + 4] - p[o + 1], p[o + 5] - p[o + 2]], e2 = [p[o + 6] - p[o], p[o + 7] - p[o + 1], p[o + 8] - p[o + 2]];
      const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-3) continue;
      const n: [number, number, number] = [nx / l, ny / l, nz / l];
      const src = b.triSource?.[t] ?? t;
      tris.push({ batch: bi, tri: t, order: runs[bi] * 0x100000000 + src, src, n, d: n[0] * p[o] + n[1] * p[o + 1] + n[2] * p[o + 2], p });
    }
  });
  // Only non-decal surfaces are bases and coplanar partners.
  const grid = new Map<string, number[]>();
  tris.forEach((t, i) => {
    if (batches[t.batch].decal) return;
    const [min, max] = triBox(t.p, t.tri * 9);
    cells(min, max, 0, (k) => (grid.get(k) ?? grid.set(k, []).get(k)!).push(i));
  });
  const stamp = new Int32Array(tris.length).fill(-1);
  let query = 0;
  const near = (min: number[], max: number[], grow: number, visit: (i: number) => void) => {
    query++;
    cells(min, max, grow, (k) => {
      for (const i of grid.get(k) ?? []) {
        if (stamp[i] === query) continue;
        stamp[i] = query;
        visit(i);
      }
    });
  };

  // 1. Overlapping same-facing coplanar non-decal triangles: the later one in draw order becomes a decal.
  const toDecal = new Map<number, Set<number>>();
  tris.forEach((a, ia) => {
    if (batches[a.batch].decal) return;
    const [amin, amax] = triBox(a.p, a.tri * 9);
    near(amin, amax, PLANE_TOL, (ib) => {
      if (ib <= ia) return;
      const b = tris[ib];
      if (a.batch === b.batch && a.tri === b.tri) return;
      if (a.n[0] * b.n[0] + a.n[1] * b.n[1] + a.n[2] * b.n[2] < 0.999) return;
      for (let v = 0; v < 3; v++) {
        const o = b.tri * 9 + v * 3;
        if (Math.abs(a.n[0] * b.p[o] + a.n[1] * b.p[o + 1] + a.n[2] * b.p[o + 2] - a.d) > PLANE_TOL) return;
      }
      if (!overlaps(a, b) || sameVertices(a, b)) return;
      const later = a.order > b.order || (a.order === b.order && ia > ib) ? a : b;
      (toDecal.get(later.batch) ?? toDecal.set(later.batch, new Set()).get(later.batch)!).add(later.tri);
    });
  });
  // 2. Decal triangles (from the lists and from step 1) that dip below the surface they lie on (at a vertex, or inside where they cross a convex crease
  // of that surface) are lifted onto it along their normal. Each triangle's lift is its largest deficit over sample
  // points; each vertex position takes the largest lift of its decal triangles, so neighbouring decal triangles stay
  // joined.
  const deficit = (t: Tri, x: number, y: number, z: number): number => {
    let worst = 0;
    near([x, y, z], [x, y, z], LIFT_RANGE, (si) => {
      const s = tris[si];
      if (toDecal.get(s.batch)?.has(s.tri)) return;
      const cos = s.n[0] * t.n[0] + s.n[1] * t.n[1] + s.n[2] * t.n[2];
      if (cos < 0.99) return;
      const dist = s.n[0] * x + s.n[1] * y + s.n[2] * z - s.d; // height of the point above s
      if (dist >= -LIFT_MIN || dist < -LIFT_RANGE) return;
      // the point projected onto s lies inside s (1 unit tolerance)
      const so = s.tri * 9, sp = s.p;
      const px = x - s.n[0] * dist, py = y - s.n[1] * dist, pz = z - s.n[2] * dist;
      const e1 = [sp[so + 3] - sp[so], sp[so + 4] - sp[so + 1], sp[so + 5] - sp[so + 2]];
      const e2 = [sp[so + 6] - sp[so], sp[so + 7] - sp[so + 1], sp[so + 8] - sp[so + 2]];
      const w = [px - sp[so], py - sp[so + 1], pz - sp[so + 2]];
      const d00 = e1[0] * e1[0] + e1[1] * e1[1] + e1[2] * e1[2], d01 = e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2];
      const d11 = e2[0] * e2[0] + e2[1] * e2[1] + e2[2] * e2[2];
      const d20 = w[0] * e1[0] + w[1] * e1[1] + w[2] * e1[2], d21 = w[0] * e2[0] + w[1] * e2[1] + w[2] * e2[2];
      const den = d00 * d11 - d01 * d01;
      if (Math.abs(den) < 1e-9) return;
      const bv = (d11 * d20 - d01 * d21) / den, bw = (d00 * d21 - d01 * d20) / den, bu = 1 - bv - bw;
      const tol = 1 / Math.sqrt(Math.max(d00, d11));
      if (bu < -tol || bv < -tol || bw < -tol) return;
      worst = Math.max(worst, -dist / cos); // distance along the decal normal
    });
    return worst;
  };
  const SAMPLES: [number, number][] = [];
  for (let i = 0; i <= 4; i++) for (let j = 0; i + j <= 4; j++) SAMPLES.push([i / 4, j / 4]);
  const vertexKey = (p: Float32Array, o: number) => `${p[o]},${p[o + 1]},${p[o + 2]}`;
  const liftOf = new Map<string, number>();
  const decalTris = tris.filter((t) => batches[t.batch].decal || toDecal.get(t.batch)?.has(t.tri));
  for (const t of decalTris) {
    const o = t.tri * 9, p = t.p;
    let lift = 0;
    for (const [a, b] of SAMPLES) {
      const c = 1 - a - b;
      lift = Math.max(lift, deficit(t, a * p[o] + b * p[o + 3] + c * p[o + 6], a * p[o + 1] + b * p[o + 4] + c * p[o + 7], a * p[o + 2] + b * p[o + 5] + c * p[o + 8]));
    }
    if (lift <= 0) continue;
    for (let v = 0; v < 3; v++) {
      const k = vertexKey(p, o + v * 3);
      liftOf.set(k, Math.max(liftOf.get(k) ?? 0, lift));
    }
  }
  let lifted = 0;
  if (liftOf.size) {
    const moves: [Tri, number, number][] = [];
    for (const t of decalTris) {
      for (let v = 0; v < 3; v++) {
        const lift = liftOf.get(vertexKey(t.p, t.tri * 9 + v * 3));
        if (lift) moves.push([t, t.tri * 9 + v * 3, lift]);
      }
    }
    for (const [t, o, lift] of moves) {
      t.p[o] += t.n[0] * lift;
      t.p[o + 1] += t.n[1] * lift;
      t.p[o + 2] += t.n[2] * lift;
      lifted++;
    }
  }

  let newDecals = 0;
  const out: Batch[] = [], origin: number[] = [];
  batches.forEach((b, bi) => {
    const set = toDecal.get(bi);
    if (!set) {
      out.push(b);
      origin.push(bi);
      return;
    }
    newDecals += set.size;
    const [keep, decal] = extract(b, set);
    if (keep.positions.length) {
      out.push(keep);
      origin.push(bi);
    }
    out.push(decal);
    origin.push(bi);
  });
  return { batches: out, origin, lifted, newDecals };
}
