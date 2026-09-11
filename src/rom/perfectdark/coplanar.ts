// Coplanar overlapping room triangles (PERFECTDARK.md §4.11): surfaces the game shows only one of, by back-face culling or by
// draw order, but that z-fight in the viewer, which draws BG double-sided by default and depth-tests differently.
// Resolved as for GoldenEye's BG (goldeneye/bg.ts), following what the game does:
// - Opposite-facing coplanar overlaps (a wall or floor modelled from both sides, e.g. between two rooms): the lists draw them
//   with G_CULL_BACK, so from either side only the front face shows. Each such triangle moves NUDGE towards its own front, so
//   the front face also wins with culling off.
// - Same-side overlaps: the RDP's depth test passes coplanar pixels, so the later draw shows.
//   - Translucent triangles (the translucent pass follows every opaque list) lying on solid ones become decals.
//   - Within a room (opaque leaves, then translucent leaves; commands in list order), a solid triangle entirely covered by
//     later opaque coplanar ones is dropped (never visible), one lying entirely on earlier ones becomes a decal, and one
//     partly over earlier ones moves NUDGE towards its front.
//   - Between different rooms the order and clipping follow the portal walk: given a DrawOrder (visibility.ts), the room
//     that shows the surface from where the player sees it keeps it and the other room's copy moves NUDGE behind (so the
//     winner's decals stay on it); overlaps with no clear answer are left.
import { mergeBatches } from '../bomberman/common';
import type { Batch } from '../types';
import type { RoomMesh } from './bg';
import type { DrawOrder } from './visibility';

const PLANE_TOLERANCE = 0.5; // BG vertices are whole units
const EXACT_TOLERANCE = 0.05;
const NUDGE = 1; // units; the renderer's depth separates this far beyond the size of any room

export interface Tri {
  room: number; // index into the rooms array
  b: Batch;
  t: number;
  n: [number, number, number];
  d: number;
  p: Float64Array; // world positions
  nk: string; // normal with a canonical sign, quantised: both sides of a plane share it
  dk: number; // rounded signed distance for that normal
  solid: boolean;
  order: number; // draw order within the room
  lo: [number, number, number];
  hi: [number, number, number];
}

interface Bucket {
  tris: Tri[]; // sorted by lo[0]
  width: number; // widest x extent
}

export interface CoplanarCounts {
  triangles: number; // triangles with a coplanar overlapping neighbour they can z-fight with (culling off)
  opposite: number; // ... facing the other way
  sameRoom: number; // ... on the same side, same room, both solid
  otherRoom: number; // ... on the same side, another room, both solid
  otherRoomSameTexture: number; // ... of which every such neighbour has the same texture
  translucentOnSolid: number;
}

export const dot = (a: Tri, b: Tri) => a.n[0] * b.n[0] + a.n[1] * b.n[1] + a.n[2] * b.n[2];

/** Largest distance of b's vertices from a's plane. */
export function distance(a: Tri, b: Tri): number {
  let m = 0;
  for (let k = 0; k < 9; k += 3) m = Math.max(m, Math.abs(a.n[0] * b.p[k] + a.n[1] * b.p[k + 1] + a.n[2] * b.p[k + 2] - a.d));
  return m;
}

/** Share of 21 interior sample points of a inside any of the triangles, in the plane's dominant projection. */
export function coverage(a: Tri, parts: Tri[]): number {
  if (!parts.length) return 0;
  const ax = Math.abs(a.n[0]) > Math.abs(a.n[1]) ? (Math.abs(a.n[0]) > Math.abs(a.n[2]) ? 0 : 2) : Math.abs(a.n[1]) > Math.abs(a.n[2]) ? 1 : 2;
  const u = ax === 0 ? 1 : 0, v = ax === 2 ? 1 : 2;
  let covered = 0;
  for (let i = 1; i < 8; i++) {
    for (let j = 1; i + j < 8; j++) {
      const wi = i / 8, wj = j / 8, w0 = 1 - wi - wj;
      const x = a.p[u] * w0 + a.p[3 + u] * wi + a.p[6 + u] * wj, y = a.p[v] * w0 + a.p[3 + v] * wi + a.p[6 + v] * wj;
      for (const b of parts) {
        const P = b.p;
        const s1 = (P[3 + u] - P[u]) * (y - P[v]) - (P[3 + v] - P[v]) * (x - P[u]);
        const s2 = (P[6 + u] - P[3 + u]) * (y - P[3 + v]) - (P[6 + v] - P[3 + v]) * (x - P[3 + u]);
        const s3 = (P[u] - P[6 + u]) * (y - P[6 + v]) - (P[v] - P[6 + v]) * (x - P[6 + u]);
        if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) {
          covered++;
          break;
        }
      }
    }
  }
  return covered / 21;
}

export class Coplanar {
  readonly tris: Tri[] = [];
  private readonly buckets = new Map<string, Bucket>();

  constructor(rooms: RoomMesh[]) {
    rooms.forEach((r, room) => {
      if (r.sky) return;
      const starts = r.leafOffsets.map((o, i) => [o, i]).sort((a, b) => a[0] - b[0]);
      const leafOf = (cmd: number) => {
        let leaf = 0;
        for (const [o, i] of starts) if (o <= cmd) leaf = i;
        return leaf;
      };
      for (const b of r.mesh.batches) {
        if (b.decal) continue;
        const nt = b.positions.length / 9;
        for (let t = 0; t < nt; t++) {
          const p = new Float64Array(9);
          for (let k = 0; k < 9; k++) p[k] = b.positions[t * 9 + k] + r.center[k % 3];
          const e1x = p[3] - p[0], e1y = p[4] - p[1], e1z = p[5] - p[2], e2x = p[6] - p[0], e2y = p[7] - p[1], e2z = p[8] - p[2];
          const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
          const len = Math.hypot(cx, cy, cz);
          if (len < 1e-3) continue;
          const n: [number, number, number] = [cx / len, cy / len, cz / len];
          const d = n[0] * p[0] + n[1] * p[1] + n[2] * p[2];
          const s = n[0] < -1e-6 || (Math.abs(n[0]) <= 1e-6 && (n[1] < -1e-6 || (Math.abs(n[1]) <= 1e-6 && n[2] < 0))) ? -1 : 1;
          const cmd = b.triSource?.[t] ?? 0;
          const tri: Tri = {
            room, b, t, n, d, p, nk: `${Math.round(n[0] * s * 50)},${Math.round(n[1] * s * 50)},${Math.round(n[2] * s * 50)}`, dk: Math.round(d * s),
            solid: b.blend !== 'blend', order: leafOf(cmd) * 0x1000000 + cmd + t / nt,
            lo: [Math.min(p[0], p[3], p[6]) - PLANE_TOLERANCE, Math.min(p[1], p[4], p[7]) - PLANE_TOLERANCE, Math.min(p[2], p[5], p[8]) - PLANE_TOLERANCE],
            hi: [Math.max(p[0], p[3], p[6]) + PLANE_TOLERANCE, Math.max(p[1], p[4], p[7]) + PLANE_TOLERANCE, Math.max(p[2], p[5], p[8]) + PLANE_TOLERANCE],
          };
          this.tris.push(tri);
          const key = `${tri.nk}/${tri.dk}`;
          const bucket = this.buckets.get(key);
          if (bucket) bucket.tris.push(tri);
          else this.buckets.set(key, { tris: [tri], width: 0 });
        }
      }
    });
    for (const bucket of this.buckets.values()) {
      bucket.tris.sort((a, b) => a.lo[0] - b.lo[0]);
      for (const t of bucket.tris) bucket.width = Math.max(bucket.width, t.hi[0] - t.lo[0]);
    }
  }

  /** Coplanar triangles whose boxes overlap a's. */
  near(a: Tri): Tri[] {
    const out: Tri[] = [];
    for (let o = -1; o <= 1; o++) {
      const bucket = this.buckets.get(`${a.nk}/${a.dk + o}`);
      if (!bucket) continue;
      const list = bucket.tris, from = a.lo[0] - bucket.width;
      let lo = 0, hi = list.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid].lo[0] < from) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo; i < list.length && list[i].lo[0] <= a.hi[0]; i++) {
        const b = list[i];
        if (b === a || b.hi[0] < a.lo[0] || b.lo[1] > a.hi[1] || b.hi[1] < a.lo[1] || b.lo[2] > a.hi[2] || b.hi[2] < a.lo[2]) continue;
        if (Math.abs(Math.abs(dot(a, b)) - 1) > 0.001 || distance(a, b) > PLANE_TOLERANCE) continue;
        out.push(b);
      }
    }
    return out;
  }
}

/** Triangles that can z-fight in the viewer (culling off): coplanar overlapping pairs, neither a decal, not both translucent. */
export function countCoplanar(rooms: RoomMesh[]): CoplanarCounts {
  const c = new Coplanar(rooms);
  const out: CoplanarCounts = { triangles: 0, opposite: 0, sameRoom: 0, otherRoom: 0, otherRoomSameTexture: 0, translucentOnSolid: 0 };
  for (const a of c.tris) {
    const fights = c.near(a).filter((b) => (a.solid || b.solid) && coverage(a, [b]) > 0);
    if (!fights.length) continue;
    out.triangles++;
    if (fights.some((b) => dot(a, b) < 0)) out.opposite++;
    const same = fights.filter((b) => dot(a, b) > 0);
    if (same.some((b) => a.solid && b.solid && b.room === a.room)) out.sameRoom++;
    const other = same.filter((b) => a.solid && b.solid && b.room !== a.room);
    if (other.length) {
      out.otherRoom++;
      if (other.every((b) => b.b.texture === a.b.texture)) out.otherRoomSameTexture++;
    }
    if (same.some((b) => a.solid !== b.solid)) out.translucentOnSolid++;
  }
  return out;
}

const DROP = 1, DECAL = 2, OFFSET = 4, BEHIND = 8;

/** Resolves coplanar overlaps in place (see the header); returns the number of triangles moved, made decals and dropped. */
export function resolveCoplanar(rooms: RoomMesh[], drawOrder?: DrawOrder): { moved: number; decals: number; dropped: number; behind: number } {
  const c = new Coplanar(rooms);
  const flags = new Map<Tri, number>();
  const set = (t: Tri, f: number) => flags.set(t, (flags.get(t) ?? 0) | f);
  for (const a of c.tris) {
    const near = c.near(a);
    if (!near.length) continue;
    if (drawOrder && a.solid) {
      const roomA = rooms[a.room].room.index;
      for (const b of near) {
        if (!b.solid || b.room === a.room || dot(a, b) <= 0 || coverage(a, [b]) === 0) continue;
        const roomB = rooms[b.room].room.index;
        // decided at the triangle's centre: which copy shows depends on where the rooms' clip boxes fall
        const centre = [0, 1, 2].map((k) => (a.p[k] + a.p[3 + k] + a.p[6 + k]) / 3);
        const winner = drawOrder(roomA, roomB, centre, a.n);
        if (winner === roomB) {
          set(a, BEHIND);
          break;
        }
      }
    }
    const opposite = near.filter((b) => b.solid && dot(a, b) < 0);
    if (opposite.length && coverage(a, opposite) > 0) set(a, OFFSET);
    if (!a.solid) {
      const under = near.filter((b) => b.solid && dot(a, b) > 0);
      if (under.length && coverage(a, under) > 0) set(a, DECAL);
      continue;
    }
    const same = near.filter((b) => b.solid && b.room === a.room && dot(a, b) > 0 && distance(a, b) <= EXACT_TOLERANCE);
    if (!same.length) continue;
    const later = same.filter((b) => b.order > a.order), earlier = same.filter((b) => b.order < a.order);
    const underEarlier = coverage(a, earlier);
    if (later.length && later.every((b) => b.b.blend === 'opaque') && coverage(a, later) >= 0.99) set(a, DROP);
    else if (underEarlier >= 0.99) set(a, DECAL);
    else if (underEarlier > 0) set(a, OFFSET);
  }
  const masks = new Map<Batch, Uint8Array>();
  const perRoom = rooms.map(() => ({ moved: 0, decals: 0, dropped: 0, behind: 0 }));
  for (const [a, f] of flags) {
    const counts = perRoom[a.room];
    if (f & DROP) counts.dropped++;
    else {
      if (f & OFFSET) {
        counts.moved++;
        for (let k = 0; k < 9; k++) a.b.positions[a.t * 9 + k] += a.n[k % 3] * NUDGE;
      }
      if (f & BEHIND) {
        counts.behind++;
        for (let k = 0; k < 9; k++) a.b.positions[a.t * 9 + k] -= a.n[k % 3] * NUDGE;
      }
      if (f & DECAL) counts.decals++;
    }
    const split = f & DROP ? DROP : f & DECAL;
    if (!split) continue;
    let mask = masks.get(a.b);
    if (!mask) masks.set(a.b, (mask = new Uint8Array(a.b.positions.length / 9)));
    mask[a.t] = split;
  }
  const total = { moved: 0, decals: 0, dropped: 0, behind: 0 };
  rooms.forEach((r, i) => {
    const counts = perRoom[i];
    if (!counts.moved && !counts.decals && !counts.dropped && !counts.behind) return;
    total.moved += counts.moved;
    total.decals += counts.decals;
    total.dropped += counts.dropped;
    total.behind += counts.behind;
    let split = false;
    const batches = r.mesh.batches.flatMap((b) => {
      const mask = masks.get(b);
      if (!mask) return [b];
      split = true;
      return [0, DECAL].map((want) => ({ ...subset(b, mask, want), ...(want === DECAL ? { decal: true } : {}) })).filter((x) => x.positions.length);
    });
    let radius = 0;
    for (const b of batches) for (let k = 0; k < b.positions.length; k += 3) radius = Math.max(radius, Math.hypot(b.positions[k], b.positions[k + 1], b.positions[k + 2]));
    r.mesh.batches = split ? mergeBatches(batches) : batches;
    r.mesh.radius = radius;
    r.mesh.info = {
      ...r.mesh.info,
      coplanar: `triangles over coplanar ones: ${counts.moved} moved ${NUDGE} towards their front, ${counts.decals} decals, ${counts.dropped} hidden ones dropped${counts.behind ? `, ${counts.behind} moved ${NUDGE} behind a surface another room draws later` : ''}`,
    };
  });
  return total;
}

// The triangles of b whose mask value equals `want`.
function subset(b: Batch, mask: Uint8Array, want: number): Batch {
  const n = mask.reduce((s, f) => s + (f === want ? 1 : 0), 0);
  const positions = new Float32Array(n * 9), uvs = new Float32Array(n * 6), colors = new Uint8Array(n * 12);
  const triSource = b.triSource ? new Uint32Array(n) : undefined;
  let k = 0;
  for (let t = 0; t < mask.length; t++) {
    if (mask[t] !== want) continue;
    positions.set(b.positions.subarray(t * 9, t * 9 + 9), k * 9);
    uvs.set(b.uvs.subarray(t * 6, t * 6 + 6), k * 6);
    colors.set(b.colors.subarray(t * 12, t * 12 + 12), k * 12);
    if (triSource) triSource[k] = b.triSource![t];
    k++;
  }
  return { ...b, positions, uvs, colors, ...(triSource ? { triSource } : {}) };
}
