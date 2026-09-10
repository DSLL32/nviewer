// Initial camera placement for a level: an elevated overview for open levels, or a spot inside
// enclosed arenas (detected by casting vertical rays through the static geometry, then choosing the
// position/heading with the longest clear horizontal line of sight).
import type { Level } from '../rom';
import type { Bounds } from './camera';
import type { Vec3 } from './math';

export interface StartView {
  position: Vec3;
  yaw: number;
  pitch: number;
  speed: number;
  /** Rough ground height (median static vertex height), used to anchor the sky dome. */
  groundY: number;
}

const GRID = 12;
const HEADINGS = 8;

interface StaticGeometry {
  tris: Float32Array; // world-space xyz * 3 per triangle
  count: number;
  bounds: Bounds;
}

function gatherGeometry(level: Level): StaticGeometry {
  let total = 0;
  const placed = level.instances.filter((i) => i.mesh >= 0 && i.mesh < level.meshes.length && !i.animated);
  for (const inst of placed) {
    for (const b of level.meshes[inst.mesh].batches) total += Math.floor(b.positions.length / 9);
  }
  const tris = new Float32Array(total * 9);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let o = 0;
  for (const inst of placed) {
    const m = inst.matrix;
    for (const b of level.meshes[inst.mesh].batches) {
      const p = b.positions;
      const n = Math.floor(p.length / 9) * 9;
      for (let i = 0; i < n; i += 3) {
        const x = p[i], y = p[i + 1], z = p[i + 2];
        for (let r = 0; r < 3; r++) {
          const w = m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r];
          tris[o++] = w;
          if (w < min[r]) min[r] = w;
          if (w > max[r]) max[r] = w;
        }
      }
    }
  }
  return { tris, count: total, bounds: { min, max } };
}

function medianHeight(g: StaticGeometry): number {
  const vertices = g.count * 3;
  if (vertices === 0) return 0;
  const step = Math.max(1, Math.floor(vertices / 20000));
  const ys: number[] = [];
  for (let v = 0; v < vertices; v += step) ys.push(g.tris[v * 3 + 1]);
  ys.sort((a, b) => a - b);
  return ys[ys.length >> 1];
}

/** Heights at which a vertical line through (x, z) crosses the geometry, ascending. */
function columnHits(g: StaticGeometry, cell: number[], x: number, z: number): number[] {
  const t = g.tris;
  const hits: number[] = [];
  for (const k of cell) {
    const o = k * 9;
    const ax = t[o], ay = t[o + 1], az = t[o + 2];
    const bx = t[o + 3], by = t[o + 4], bz = t[o + 5];
    const cx = t[o + 6], cy = t[o + 7], cz = t[o + 8];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-6) continue; // vertical wall
    const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
    const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
    if (u < 0 || v < 0 || u + v > 1) continue;
    hits.push(u * ay + v * by + (1 - u - v) * cy);
  }
  return hits.sort((a, b) => a - b);
}

/** Distance along a ray to the nearest triangle (Möller–Trumbore), capped at maxDist. */
function rayDistance(g: StaticGeometry, o: Vec3, d: Vec3, maxDist: number): number {
  const t = g.tris;
  let best = maxDist;
  for (let k = 0; k < g.count; k++) {
    const i = k * 9;
    const e1x = t[i + 3] - t[i], e1y = t[i + 4] - t[i + 1], e1z = t[i + 5] - t[i + 2];
    const e2x = t[i + 6] - t[i], e2y = t[i + 7] - t[i + 1], e2z = t[i + 8] - t[i + 2];
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-9) continue;
    const inv = 1 / det;
    const sx = o[0] - t[i], sy = o[1] - t[i + 1], sz = o[2] - t[i + 2];
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (dist > 1e-3 && dist < best) best = dist;
  }
  return best;
}

export function computeStartView(level: Level, aspect: number, fovY: number): StartView {
  const g = gatherGeometry(level);
  let { min, max } = g.bounds;
  if (!min.every(Number.isFinite) || !max.every(Number.isFinite)) ({ min, max } = level.bounds);
  if (!min.every(Number.isFinite) || !max.every(Number.isFinite)) {
    min = [-1000, -200, -1000];
    max = [1000, 800, 1000];
  }
  const ex = max[0] - min[0];
  const ez = max[2] - min[2];
  const long = Math.max(ex, ez);
  const speed = Math.min(5000, Math.max(50, Math.round(long / 8)));
  const groundY = medianHeight(g);

  if (level.info.kind === 'battle' || level.info.kind === 'stunt') {
    const interior = findInterior(g, min, max);
    if (interior) return { ...interior, speed, groundY };
  }
  return { ...overview(min, max, aspect, fovY), speed, groundY };
}

function overview(min: Vec3, max: Vec3, aspect: number, fovY: number): Pick<StartView, 'position' | 'yaw' | 'pitch'> {
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const ex = max[0] - min[0];
  const ez = max[2] - min[2];
  const long = Math.max(ex, ez);
  const short = Math.min(ex, ez);
  // Look across the short axis so the long axis spans the (usually wide) screen.
  const back: Vec3 = ex >= ez ? [0, 0, 1] : [1, 0, 0];
  const tanV = Math.tan(fovY / 2);
  const tanH = tanV * Math.max(aspect, 0.5);
  const dist = Math.max((0.5 * long) / tanH, (0.5 * short) / tanV) * 0.8 + short * 0.25;
  const elev = (40 * Math.PI) / 180;
  const position: Vec3 = [
    center[0] + back[0] * dist * Math.cos(elev),
    center[1] + dist * Math.sin(elev),
    center[2] + back[2] * dist * Math.cos(elev),
  ];
  const d: Vec3 = [center[0] - position[0], center[1] - position[1], center[2] - position[2]];
  return { position, yaw: Math.atan2(d[0], -d[2]), pitch: Math.atan2(d[1], Math.hypot(d[0], d[2])) };
}

/** If the middle of the level has a roof, return a view from inside with the most open line of sight. */
function findInterior(g: StaticGeometry, min: Vec3, max: Vec3): Pick<StartView, 'position' | 'yaw' | 'pitch'> | null {
  if (g.count === 0) return null;
  const ex = max[0] - min[0];
  const ez = max[2] - min[2];
  const cellX = ex / GRID;
  const cellZ = ez / GRID;
  if (!(cellX > 0 && cellZ > 0)) return null;

  // Bin triangles by their xz bounding box.
  const cells: number[][] = Array.from({ length: GRID * GRID }, () => []);
  const t = g.tris;
  for (let k = 0; k < g.count; k++) {
    const o = k * 9;
    const x0 = Math.min(t[o], t[o + 3], t[o + 6]), x1 = Math.max(t[o], t[o + 3], t[o + 6]);
    const z0 = Math.min(t[o + 2], t[o + 5], t[o + 8]), z1 = Math.max(t[o + 2], t[o + 5], t[o + 8]);
    const i0 = Math.max(0, Math.floor((x0 - min[0]) / cellX)), i1 = Math.min(GRID - 1, Math.floor((x1 - min[0]) / cellX));
    const j0 = Math.max(0, Math.floor((z0 - min[2]) / cellZ)), j1 = Math.min(GRID - 1, Math.floor((z1 - min[2]) / cellZ));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cells[j * GRID + i].push(k);
  }

  // Enclosure is judged on the central part of the grid; arena roofs rarely reach the corners of the bounds.
  const inner = (k: number) => k >= GRID * 0.2 && k < GRID * 0.8;
  const minGap = Math.max(60, (max[1] - min[1]) * 0.08);
  type Column = { x: number; z: number; floor: number; gap: number };
  const covered: Column[] = [];
  let innerHits = 0;
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      if (!inner(i) || !inner(j)) continue;
      const x = min[0] + (i + 0.5) * cellX;
      const z = min[2] + (j + 0.5) * cellZ;
      const hits = columnHits(g, cells[j * GRID + i], x, z);
      if (hits.length === 0) continue;
      innerHits++;
      // Largest vertical opening in this column.
      let best = { floor: 0, gap: 0 };
      for (let h = 0; h + 1 < hits.length; h++) {
        const gap = hits[h + 1] - hits[h];
        if (gap > best.gap) best = { floor: hits[h], gap };
      }
      if (best.gap >= minGap) covered.push({ x, z, ...best });
    }
  }
  if (innerHits === 0 || covered.length / innerHits < 0.5) return null;

  // Pick the eye position and heading with the longest clear view.
  const range = Math.max(ex, ez);
  const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2;
  let best = { score: -Infinity, position: [0, 0, 0] as Vec3, yaw: 0 };
  for (const c of covered) {
    const eye: Vec3 = [c.x, c.floor + Math.max(30, Math.min(c.gap * 0.35, 160)), c.z];
    const centrality = 1 - Math.hypot(c.x - cx, c.z - cz) / range;
    for (let h = 0; h < HEADINGS; h++) {
      const yaw = (h / HEADINGS) * Math.PI * 2;
      const dist = rayDistance(g, eye, [Math.sin(yaw), 0, -Math.cos(yaw)], range);
      const score = dist / range + 0.15 * centrality;
      if (score > best.score) best = { score, position: eye, yaw };
    }
  }
  return { position: best.position, yaw: best.yaw, pitch: (-8 * Math.PI) / 180 };
}
