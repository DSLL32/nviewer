// Which BG rooms the game can show from where the player can be (docs/PERFECTDARK.md §4.3, §4.8; notes/bg.md §2.6).
//
// The game draws the camera's room, the rooms its portal walk reaches (bg_tick_portals: a portal is followed when its screen
// box intersects the current clip box, which then shrinks to the intersection), the sky rooms, and rooms the BG command
// script shows. Rooms nothing can reach are scenery the player never sees (Defection's city towers beyond the helipad).
//
// Conservative model:
// - Where the player can be: the floor tiles of the collision file (bg_<code>_tilesZ; flags 0x1/0x2) reached by walking from
//   the tiles under the setup's spawn pads and under every pad: across tile edges onto a neighbouring floor that is at most
//   a step higher, or any height lower (drops).
// - Eyes: on each reached tile (centre and vertices pulled towards it) at standing height, one per grid cell of a room.
// - From every eye, in six 90° cube-face views, the game's rectangle walk through portals (a room's clip box grows to the union
//   of the boxes it is reached with, so the result only over-includes), starting in the tile's room and in portal neighbours
//   whose box holds the eye.
// - Scripts: for every IF block conditioned on the camera being in a room range, the rooms it shows (SHOWROOM) are kept when an
//   eye room lies in the range; portal-in-view conditions and DISABLEROOM commands are ignored (keeping more).
// Command types, from the data's structure (names from the decompilation): 20 camera in room range (two room arguments),
// 90 IF, 92 ENDIF, 30 result true, 31 result if portal in view (portal argument), 32 show room if result (room argument),
// 36/37 disable room / room range; arguments follow as entries of type 100 (portal) and 101 (room).
import type { PdBg } from './bg';
import { parseTiles } from './tiles';

type Vec3 = [number, number, number];

const EYE_HEIGHTS = [159]; // standing eye above the floor (verified)
const STEP = 60; // highest step onto a neighbouring floor tile
const DROP = 2000; // lowest drop onto a floor below a tile's edge
const PROBE = 12; // distance past a tile edge where the neighbouring floor is looked for
// Eye grid (x, z) per room. On all 40 levels a 60-unit grid with eyes at 159, 120, 80 and 40 hides exactly the same rooms.
const EYE_CELL = 300;
const GRID = 512; // floor tile lookup grid
const NEAR = 1;

interface FloorTile {
  index: number;
  room: number;
  v: Vec3[];
  // plane y = a·x + b·z + c
  a: number;
  b: number;
  c: number;
  min: [number, number];
  max: [number, number];
}

/** The floor tiles of a collision file (§4.8; tiles.ts), with their planes. */
export function floorTiles(buf: Uint8Array): FloorTile[] {
  const out: FloorTile[] = [];
  for (const tile of parseTiles(buf)) {
    const v = tile.vertices, n = v.length;
    if (!(tile.flags & 3) || n < 3) continue;
    // plane through the polygon (Newell normal)
    let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      const p = v[i], q = v[(i + 1) % n];
      nx += (p[1] - q[1]) * (p[2] + q[2]);
      ny += (p[2] - q[2]) * (p[0] + q[0]);
      nz += (p[0] - q[0]) * (p[1] + q[1]);
      cx += p[0]; cy += p[1]; cz += p[2];
    }
    cx /= n; cy /= n; cz /= n;
    if (Math.abs(ny) > 1e-6 * Math.hypot(nx, ny, nz)) {
      const a = -nx / ny, b = -nz / ny;
      out.push({
        index: out.length, room: tile.room, v, a, b, c: cy - a * cx - b * cz,
        min: [Math.min(...v.map((p) => p[0])), Math.min(...v.map((p) => p[2]))], max: [Math.max(...v.map((p) => p[0])), Math.max(...v.map((p) => p[2]))],
      });
    }
  }
  return out;
}

function insideXZ(t: FloorTile, x: number, z: number): boolean {
  if (x < t.min[0] || x > t.max[0] || z < t.min[1] || z > t.max[1]) return false;
  let inside = false;
  for (let i = 0, j = t.v.length - 1; i < t.v.length; j = i++) {
    const [xi, , zi] = t.v[i], [xj, , zj] = t.v[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  if (inside) return true;
  // on an edge counts as inside (tiles share edges)
  for (let i = 0, j = t.v.length - 1; i < t.v.length; j = i++) {
    const [xi, , zi] = t.v[i], [xj, , zj] = t.v[j];
    const ex = xj - xi, ez = zj - zi, len2 = ex * ex + ez * ez;
    const u = len2 > 0 ? Math.max(0, Math.min(1, ((x - xi) * ex + (z - zi) * ez) / len2)) : 0;
    if (Math.hypot(xi + u * ex - x, zi + u * ez - z) < 0.5) return true;
  }
  return false;
}

/** A view for the walk: forward, right and up unit vectors and the tangents of the half field of view. */
export interface View { f: readonly number[]; s: readonly number[]; u: readonly number[]; tx: number; ty: number }
export const CUBE: View[] = [
  { f: [1, 0, 0], s: [0, 0, 1], u: [0, 1, 0] }, { f: [-1, 0, 0], s: [0, 0, 1], u: [0, 1, 0] },
  { f: [0, 0, 1], s: [1, 0, 0], u: [0, 1, 0] }, { f: [0, 0, -1], s: [1, 0, 0], u: [0, 1, 0] },
  { f: [0, 1, 0], s: [1, 0, 0], u: [0, 0, 1] }, { f: [0, -1, 0], s: [1, 0, 0], u: [0, 0, 1] },
].map((v) => ({ ...v, tx: 1, ty: 1 }));

export type Rect = [number, number, number, number]; // x0, y0, x1, y1 in the face's NDC

/** Given two rooms showing a coplanar surface at point with normal: the room the game draws later, or null if unclear. */
export type DrawOrder = (roomA: number, roomB: number, point: readonly number[], normal: readonly number[]) => number | null;

export interface VisibilityOptions {
  step?: number;
  drop?: number;
  eyeCell?: number;
  eyeHeights?: number[];
}

export interface PlayVisibility {
  visible: Set<number>; // rooms the game can show from play (sky rooms not included)
  playable: Set<number>; // rooms holding an eye
  eyes: number;
  reachedTiles: number;
  floorTiles: number;
  scriptRooms: number[]; // rooms kept because a script shows them
}

export class PdVisibility {
  readonly tiles: FloorTile[];
  private readonly grid = new Map<number, number[]>();
  private readonly byRoom: { portal: number; other: number }[][];
  private readonly portalPts: Float64Array[];

  constructor(readonly bg: PdBg, tilesFile: Uint8Array | null) {
    this.tiles = tilesFile ? floorTiles(tilesFile) : [];
    for (const t of this.tiles) {
      for (let gx = Math.floor(t.min[0] / GRID); gx <= Math.floor(t.max[0] / GRID); gx++) {
        for (let gz = Math.floor(t.min[1] / GRID); gz <= Math.floor(t.max[1] / GRID); gz++) {
          const key = gx * 65536 + gz;
          const list = this.grid.get(key);
          if (list) list.push(t.index);
          else this.grid.set(key, [t.index]);
        }
      }
    }
    this.byRoom = bg.rooms.map(() => []);
    this.portalPts = bg.portals.map((p) => Float64Array.from(p.points.flat()));
    for (const p of bg.portals) {
      const [a, b] = p.rooms;
      if (p.points.length < 3) continue;
      if (this.byRoom[a]) this.byRoom[a].push({ portal: p.index, other: b });
      if (this.byRoom[b]) this.byRoom[b].push({ portal: p.index, other: a });
    }
  }

  /** The highest floor tile under (x, z) no higher than y + above and no lower than y - below. */
  floorAt(x: number, y: number, z: number, above: number, below: number): FloorTile | null {
    let best: FloorTile | null = null, bestY = -Infinity;
    for (const i of this.grid.get(Math.floor(x / GRID) * 65536 + Math.floor(z / GRID)) ?? []) {
      const t = this.tiles[i];
      const ty = t.a * x + t.b * z + t.c;
      if (ty > y + above || ty < y - below || ty <= bestY || !insideXZ(t, x, z)) continue;
      best = t;
      bestY = ty;
    }
    return best;
  }

  /** Floor tiles reachable on foot from the tiles under the seed points. */
  reachable(seeds: readonly (readonly number[])[], opts: VisibilityOptions = {}): Set<FloorTile> {
    const step = opts.step ?? STEP, drop = opts.drop ?? DROP;
    const reached = new Set<FloorTile>();
    const queue: FloorTile[] = [];
    for (const s of seeds) {
      const t = this.floorAt(s[0], s[1], s[2], 20, 300);
      if (t && !reached.has(t)) { reached.add(t); queue.push(t); }
    }
    while (queue.length) {
      const t = queue.pop()!;
      const n = t.v.length;
      const cx = t.v.reduce((s, p) => s + p[0], 0) / n, cz = t.v.reduce((s, p) => s + p[2], 0) / n;
      for (let i = 0; i < n; i++) {
        const p = t.v[i], q = t.v[(i + 1) % n];
        for (const w of [0.1, 0.5, 0.9]) {
          const mx = p[0] + (q[0] - p[0]) * w, mz = p[2] + (q[2] - p[2]) * w;
          // outward: away from the tile's centre, perpendicular to the edge
          let ox = q[2] - p[2], oz = -(q[0] - p[0]);
          const len = Math.hypot(ox, oz) || 1;
          ox /= len; oz /= len;
          if ((mx - cx) * ox + (mz - cz) * oz < 0) { ox = -ox; oz = -oz; }
          const x = mx + ox * PROBE, z = mz + oz * PROBE;
          const y = t.a * mx + t.b * mz + t.c;
          const next = this.floorAt(x, y, z, step, drop);
          if (next && !reached.has(next)) { reached.add(next); queue.push(next); }
        }
      }
    }
    return reached;
  }

  /**
   * Rooms the portal walk reaches from an eye in the given start rooms, over the given views (default: the six cube faces),
   * added to `out`. A room reached again is walked on only with a clip box not already covered by one it was walked with.
   */
  walk(eye: readonly number[], startRooms: readonly number[], out: Set<number>, views: readonly View[] = CUBE, clips?: Map<number, Rect[]>[]): void {
    const pts = this.portalPts;
    for (const [vi, view] of views.entries()) {
      const cache = new Map<number, Rect | null>();
      const project = (portal: number): Rect | null => {
        let r = cache.get(portal);
        if (r !== undefined) return r;
        const P = pts[portal], n = P.length / 3;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false;
        let pxp = 0, pyp = 0, pzp = 0;
        const add = (x: number, y: number, z: number) => {
          const px = x / (z * view.tx), py = y / (z * view.ty);
          if (px < x0) x0 = px;
          if (px > x1) x1 = px;
          if (py < y0) y0 = py;
          if (py > y1) y1 = py;
          any = true;
        };
        // camera-space vertices, clipped against the near plane; the bounding box of their projection
        for (let k = 0; k <= n; k++) {
          const q = (k % n) * 3;
          const dx = P[q] - eye[0], dy = P[q + 1] - eye[1], dz = P[q + 2] - eye[2];
          const cx = dx * view.s[0] + dy * view.s[1] + dz * view.s[2];
          const cy = dx * view.u[0] + dy * view.u[1] + dz * view.u[2];
          const cz = dx * view.f[0] + dy * view.f[1] + dz * view.f[2];
          if (k > 0) {
            if ((pzp >= NEAR) !== (cz >= NEAR)) {
              const t = (NEAR - pzp) / (cz - pzp);
              add(pxp + (cx - pxp) * t, pyp + (cy - pyp) * t, NEAR);
            }
          }
          if (k < n && cz >= NEAR) add(cx, cy, cz);
          pxp = cx; pyp = cy; pzp = cz;
        }
        r = any && x1 >= -1 && x0 <= 1 && y1 >= -1 && y0 <= 1 ? [Math.max(-1, x0), Math.max(-1, y0), Math.min(1, x1), Math.min(1, y1)] : null;
        cache.set(portal, r);
        return r;
      };
      const seen = new Map<number, Rect[]>();
      if (clips) clips[vi] = seen; // each room's clip boxes in this view (the game scissors a room to them)
      const stack: [number, Rect][] = startRooms.map((room) => [room, [-1, -1, 1, 1]]);
      while (stack.length) {
        const [room, rect] = stack.pop()!;
        let list = seen.get(room);
        if (list?.some((p) => p[0] <= rect[0] && p[1] <= rect[1] && p[2] >= rect[2] && p[3] >= rect[3])) continue;
        if (!list) seen.set(room, (list = []));
        list.push(rect);
        out.add(room);
        for (const { portal, other } of this.byRoom[room] ?? []) {
          const pr = project(portal);
          if (!pr) continue;
          const i: Rect = [Math.max(pr[0], rect[0]), Math.max(pr[1], rect[1]), Math.min(pr[2], rect[2]), Math.min(pr[3], rect[3])];
          if (i[0] <= i[2] && i[1] <= i[3]) stack.push([other, i]);
        }
      }
    }
  }

  /** Start rooms for an eye standing on a tile of `room`: the room, and its portal neighbours whose box holds the eye. */
  startRooms(eye: readonly number[], room: number): number[] {
    const out = [room];
    for (const { other } of this.byRoom[room] ?? []) {
      const r = this.bg.rooms[other];
      if (r && !out.includes(other) && [0, 1, 2].every((k) => eye[k] >= r.bboxMin[k] - 30 && eye[k] <= r.bboxMax[k] + 30)) out.push(other);
    }
    return out;
  }

  /** Rooms the command script shows while the camera is in one of `cameraRooms`. */
  scriptRooms(cameraRooms: Set<number>): number[] {
    const cmds = this.bg.commands;
    const shown = new Set<number>();
    const stack: ([number, number][] | null)[] = [];
    let pending: [number, number][] = [];
    const args = (i: number) => {
      const out: number[] = [];
      for (let k = i + 1; k < cmds.length && cmds[k].type >= 100; k++) out.push(cmds[k].param);
      return out;
    };
    const holds = (ranges: [number, number][] | null) => !ranges || ranges.some(([a, b]) => [...cameraRooms].some((r) => r >= Math.min(a, b) && r <= Math.max(a, b)));
    for (let i = 0; i < cmds.length; i++) {
      const t = cmds[i].type;
      if (t === 0) break;
      if (t >= 100) continue;
      if (t === 20) {
        const [a, b] = args(i);
        if (a !== undefined) pending.push([a, b ?? a]);
      } else if (t === 90) {
        stack.push(pending.length ? pending : (stack[stack.length - 1] ?? null));
        pending = [];
      } else if (t === 92) {
        stack.pop();
        pending = [];
      } else if (t === 32) {
        const [room] = args(i);
        if (room !== undefined && holds(pending.length ? pending : (stack[stack.length - 1] ?? null))) shown.add(room);
      }
    }
    return [...shown].sort((a, b) => a - b);
  }

  /** Eye points on reached floor tiles at standing height, one per grid cell of a room, with their start rooms. */
  private eyeList(reached: Set<FloorTile>, opts: VisibilityOptions = {}): { eye: number[]; start: number[] }[] {
    const cell = opts.eyeCell ?? EYE_CELL, heights = opts.eyeHeights ?? EYE_HEIGHTS;
    const eyes = new Map<string, { eye: number[]; start: number[] }>();
    for (const t of reached) {
      const n = t.v.length;
      const cx = t.v.reduce((s, p) => s + p[0], 0) / n, cz = t.v.reduce((s, p) => s + p[2], 0) / n;
      for (const [x, z] of [[cx, cz], ...t.v.map((p) => [cx + (p[0] - cx) * 0.75, cz + (p[2] - cz) * 0.75])]) {
        const y = t.a * x + t.b * z + t.c;
        for (const h of heights) {
          const key = `${t.room}/${Math.round(x / cell)}/${Math.round(z / cell)}/${Math.round((y + h) / 50)}`;
          if (eyes.has(key)) continue;
          const eye = [x, y + h, z];
          eyes.set(key, { eye, start: this.startRooms(eye, t.room) });
        }
      }
    }
    return [...eyes.values()];
  }

  /** Rooms visible from everywhere the player can reach from the seeds; null when no seed stands on a floor. */
  fromPlay(seeds: readonly (readonly number[])[], opts: VisibilityOptions = {}): PlayVisibility | null {
    const reached = this.reachable(seeds, opts);
    if (!reached.size) return null;
    const eyes = this.eyeList(reached, opts), playable = new Set<number>();
    for (const e of eyes) for (const room of e.start) playable.add(room);
    const scriptRooms = this.scriptRooms(playable);
    // Everything the walk can ever add: the portal graph's reach from the eye rooms. Once all of it is visible, stop.
    const reachable = this.portalDepths([...playable]);
    const visible = new Set<number>();
    // one eye per room first, so the visible set fills up early
    const order = [...eyes].sort((a, b) => a.start[0] - b.start[0]);
    const firsts = order.filter((e, i) => i === 0 || e.start[0] !== order[i - 1].start[0]);
    const firstSet = new Set(firsts);
    for (const e of [...firsts, ...order.filter((e) => !firstSet.has(e))]) {
      if (visible.size >= reachable.size) break;
      this.walk(e.eye, e.start, visible);
    }
    const added = scriptRooms.filter((room) => !visible.has(room));
    for (const room of added) visible.add(room);
    return { visible, playable, eyes: eyes.length, reachedTiles: reached.size, floorTiles: this.tiles.length, scriptRooms: added };
  }

  /** Portal-hop distance from the start rooms of every room the portal graph reaches. */
  portalDepths(start: readonly number[]): Map<number, number> {
    const depth = new Map<number, number>(start.map((room) => [room, 0]));
    const queue = [...start];
    for (let i = 0; i < queue.length; i++) {
      for (const { other } of this.byRoom[queue[i]] ?? []) {
        if (depth.has(other)) continue;
        depth.set(other, depth.get(queue[i])! + 1);
        queue.push(other);
      }
    }
    return depth;
  }

  /**
   * Which of two rooms shows a coplanar surface at `point` (normal) where both have a copy. The game draws rooms in portal
   * order from the camera's room (the first BG calls of 10 of the 12 captured gameplay frames have non-decreasing portal-hop
   * depth from the camera room; script-shown rooms come first), scissors each room to the clip boxes of the portals it is
   * reached through, and a later coplanar draw passes the depth test. Votes of the playable eyes nearest in front of the
   * surface (up to 48 within 2500 units): a room counts where the point lies in one of its clip boxes; if both do, the
   * deeper room (drawn later) gets the vote, if one does, that room; eyes where neither does or at equal depth abstain. The
   * winner needs three quarters of the votes, else null. (Chicago rooms 73/77: from the stairs landing room 73's dark copy
   * is drawn later but clipped away, so room 77's lit grate shows.)
   */
  drawOrder(seeds: readonly (readonly number[])[]): DrawOrder {
    let eyes: { eye: number[]; start: number[] }[] | null = null;
    const walks = new Map<number, { seen: Set<number>; clips: Map<number, Rect[]>[]; depth: Map<number, number> }>();
    return (a, b, point, normal) => {
      eyes ??= this.eyeList(this.reachable(seeds));
      const candidates: [number, number][] = [];
      eyes.forEach((e, i) => {
        const rel = [e.eye[0] - point[0], e.eye[1] - point[1], e.eye[2] - point[2]];
        const dist = Math.hypot(rel[0], rel[1], rel[2]);
        if (dist <= 2500 && rel[0] * normal[0] + rel[1] * normal[1] + rel[2] * normal[2] > 20) candidates.push([dist, i]);
      });
      candidates.sort((p, q) => p[0] - q[0]);
      let votesA = 0, votesB = 0;
      for (const [, i] of candidates.slice(0, 48)) {
        let w = walks.get(i);
        if (!w) {
          const seen = new Set<number>(), clips: Map<number, Rect[]>[] = [];
          this.walk(eyes[i].eye, eyes[i].start, seen, CUBE, clips);
          walks.set(i, (w = { seen, clips, depth: this.portalDepths(eyes[i].start) }));
        }
        if (!w.seen.has(a) || !w.seen.has(b)) continue;
        const eye = eyes[i].eye, d = [point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]];
        const clipped = (room: number) => CUBE.some((v, vi) => {
          const z = d[0] * v.f[0] + d[1] * v.f[1] + d[2] * v.f[2];
          if (z < NEAR) return false;
          const x = (d[0] * v.s[0] + d[1] * v.s[1] + d[2] * v.s[2]) / z, y = (d[0] * v.u[0] + d[1] * v.u[1] + d[2] * v.u[2]) / z;
          return Math.abs(x) <= 1 && Math.abs(y) <= 1 && (w!.clips[vi].get(room) ?? []).some((q) => x >= q[0] && x <= q[2] && y >= q[1] && y <= q[3]);
        });
        const inA = clipped(a), inB = clipped(b);
        if (inA && inB) {
          const da = w.depth.get(a) ?? 0, db = w.depth.get(b) ?? 0;
          if (da > db) votesA++;
          else if (db > da) votesB++;
        } else if (inA) votesA++;
        else if (inB) votesB++;
      }
      const total = votesA + votesB;
      return total && votesA >= 0.75 * total ? a : total && votesB >= 0.75 * total ? b : null;
    };
  }
}
