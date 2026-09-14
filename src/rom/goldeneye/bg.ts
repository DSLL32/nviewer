// GoldenEye BG files bg/bg_<code>_all_p.seg: the world geometry as rooms (docs/GOLDENEYE.md §3.1-§3.5).
//
// Stored raw; pointers are segment 0x0F, file-relative. Header: +0 0; +4 rooms; +8 portals; +C visibility commands.
// Room entries (0x18 bytes, from +0x14): {vertices; primary DL; secondary DL or 0; f32 x, y, z}, each a 1172 stream;
// entry 0 is empty, the last entry is a sentinel holding the region ends, and an all-zero entry follows it. Slots can be
// empty (Streets: rooms 20-54 have no vertices, room 55 is real). Vertices (N64 Vtx) are relative to the room position,
// and the lists address them as segment 0x0E. Primary lists draw in the opaque pass, secondary lists after every primary.
import { mergeBatches } from '../bomberman/common';
import { runDisplayList } from '../displaylist';
import type { Batch, DebugInfo, Mesh } from '../types';
import { inflate1172 } from './rom';
import type { GeTextures } from './textures';

type Vec3 = [number, number, number];
const SEG = 0x0f000000;

export interface BgRoom {
  index: number; // room number
  pos: Vec3; // BG units
  vertices: number; // file offsets of the compressed streams; vertices 0 = empty slot
  primary: number;
  secondary: number; // 0: none
}

export interface BgPortal {
  index: number;
  roomA: number;
  roomB: number;
  flags: number;
  points: Vec3[]; // BG units, absolute
}

export interface BgFile {
  data: Uint8Array;
  rooms: BgRoom[]; // rooms[0] is the empty entry 0, so indices are room numbers
  portals: BgPortal[];
  visibility: number; // file offset of the visibility commands (not decoded)
}

export function parseBg(data: Uint8Array): BgFile {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const ptr = (o: number) => {
    const p = dv.getUint32(o);
    if (p !== 0 && (p & 0xff000000) !== SEG) throw new Error(`BG pointer 0x${p.toString(16)} at 0x${o.toString(16)} is not in segment 0x0F`);
    return p ? p - SEG : 0;
  };
  const roomTable = ptr(4), portalTable = ptr(8);
  // Entries up to the first all-zero one; the last of them is the sentinel (checked against the rooms the portals and
  // clipping tiles name in every BG).
  let end = 1;
  while (roomTable + 0x18 * (end + 1) <= data.length && (dv.getUint32(roomTable + 0x18 * end) | dv.getUint32(roomTable + 0x18 * end + 4) | dv.getUint32(roomTable + 0x18 * end + 8)) !== 0) end++;
  const rooms: BgRoom[] = [];
  for (let i = 0; i < end - 1; i++) {
    const e = roomTable + 0x18 * i;
    const vertices = ptr(e);
    rooms.push({ index: i, pos: [dv.getFloat32(e + 12), dv.getFloat32(e + 16), dv.getFloat32(e + 20)], vertices, primary: vertices ? ptr(e + 4) : 0, secondary: vertices ? ptr(e + 8) : 0 });
  }
  // Portals: {polygon; u8 roomA; u8 roomB; u16 flags} until a zero pointer; polygon {u8 n; 3 pad; n × f32 x, y, z}.
  const portals: BgPortal[] = [];
  for (let o = portalTable; portalTable && o + 8 <= data.length && dv.getUint32(o) !== 0; o += 8) {
    const poly = ptr(o), points: Vec3[] = [];
    for (let k = 0; k < data[poly]; k++) points.push([dv.getFloat32(poly + 4 + 12 * k), dv.getFloat32(poly + 8 + 12 * k), dv.getFloat32(poly + 12 + 12 * k)]);
    portals.push({ index: portals.length, roomA: data[o + 4], roomB: data[o + 5], flags: dv.getUint16(o + 6), points });
  }
  return { data, rooms, portals, visibility: ptr(12) };
}

// Swaps the last two vertices of every triangle: the game's front faces wind clockwise on screen (§3.7).
export function reverseWinding(b: Batch) {
  const swap = (a: Float32Array | Uint8Array, k: number) => {
    for (let t = 0; t + 3 * k <= a.length; t += 3 * k) {
      for (let j = 0; j < k; j++) {
        const x = a[t + k + j];
        a[t + k + j] = a[t + 2 * k + j];
        a[t + 2 * k + j] = x;
      }
    }
  };
  swap(b.positions, 3);
  swap(b.uvs, 2);
  swap(b.colors, 4);
  if (b.unlitColors) swap(b.unlitColors, 4);
}

export interface RoomGeometry {
  room: number;
  // World position of the room's meshes (the centre of its bounding box): place them with this translation, so the
  // renderer's back-to-front sort of translucent geometry orders rooms like the game's secondary-list pass.
  center: Vec3;
  // Geometry the game draws with a depth test: primary batches, then secondary ones.
  mesh: Mesh | null;
  // Solid batches the lists draw without a depth test (render mode 0C182048): Dam's surrounding mountains and reservoir
  // water (rooms 3-35), Cuba's jungle wall. The game draws them only where the portals show their room, clipped to the
  // portal's screen rectangle and in list order; the viewer, which draws every room, depth-tests them instead (drawn
  // without depth, farther pieces and the water paint over nearer ones). Free views can still show pieces the game
  // never lets the player see together with the rest, e.g. mountain tops above the Dam's cliffs at the spawn.
  backdrop: Mesh | null;
  triangles: number;
  vertices: number;
}

interface RoomBatches {
  room: number;
  batches: Batch[];
  backdrop: Set<Batch>;
  info: DebugInfo;
  vertices: number;
}

// A room's lists as world-unit batches (BG units / scale, room position baked in), winding reversed, double-sided.
function roomBatches(bg: BgFile, index: number, textures: GeTextures, scale: number): RoomBatches {
  const room = bg.rooms[index];
  const primary = inflate1172(bg.data, room.primary);
  const secondary = room.secondary ? inflate1172(bg.data, room.secondary) : null;
  const verts = inflate1172(bg.data, room.vertices);
  const align = (n: number) => (n + 7) & ~7;
  const secondaryAt = align(primary.length), vertexAt = align(secondaryAt + (secondary?.length ?? 0));
  const buf = new Uint8Array(vertexAt + verts.length);
  buf.set(primary);
  if (secondary) buf.set(secondary, secondaryAt);
  buf.set(verts, vertexAt);
  const resolve = (addr: number) => {
    const seg = addr >>> 24, o = addr & 0xffffff;
    if (seg === 0x0e) return vertexAt + o < buf.length ? vertexAt + o : -1;
    return seg === 0 && o < vertexAt ? o : -1;
  };
  const run = (start: number) => runDisplayList({
    buf, ucode: 'f3d', resolve, textures: textures.textures, textureKeys: new Map(), keyPrefix: '', rareTexture: textures.rareTexture,
    vertexScale: 1 / scale, vertexOffset: room.pos, mirrorX: false, decals: true,
  }, start);
  const batches = [...run(0), ...(secondary ? run(secondaryAt) : [])];
  const backdrop = new Set<Batch>();
  for (const b of batches) {
    reverseWinding(b);
    b.cullBack = false;
    if (!b.depthTest) {
      if (b.blend !== 'blend') backdrop.add(b);
      b.depthTest = true;
      b.depthWrite = b.blend !== 'blend';
    }
  }
  const hex = (v: number) => `0x${v.toString(16)}`;
  const info: DebugInfo = {
    room: index, position: room.pos.map((v) => +v.toFixed(2)).join(', '), vertices: hex(room.vertices), primaryDL: hex(room.primary),
    ...(room.secondary ? { secondaryDL: hex(room.secondary) } : {}),
    triSource: `offset in the inflated room: primary DL at 0${secondary ? `, secondary DL at ${hex(secondaryAt)}` : ''}, vertices at ${hex(vertexAt)}`,
  };
  return { room: index, batches, backdrop, info, vertices: verts.length / 16 };
}

// Batch holding the triangles of b whose flags equal `want`.
function subset(b: Batch, flags: Uint8Array, want: number): Batch {
  let n = 0;
  for (let t = 0; t < flags.length; t++) if (flags[t] === want) n++;
  const positions = new Float32Array(n * 9), uvs = new Float32Array(n * 6), colors = new Uint8Array(n * 12);
  const unlitColors = b.unlitColors ? new Uint8Array(n * 12) : undefined;
  const triSource = b.triSource ? new Uint32Array(n) : undefined;
  let k = 0;
  for (let t = 0; t < flags.length; t++) {
    if (flags[t] !== want) continue;
    positions.set(b.positions.subarray(t * 9, t * 9 + 9), k * 9);
    uvs.set(b.uvs.subarray(t * 6, t * 6 + 6), k * 6);
    colors.set(b.colors.subarray(t * 12, t * 12 + 12), k * 12);
    unlitColors?.set(b.unlitColors!.subarray(t * 12, t * 12 + 12), k * 12);
    if (triSource) triSource[k] = b.triSource![t];
    k++;
  }
  return { ...b, positions, uvs, colors, ...(unlitColors ? { unlitColors } : {}), ...(triSource ? { triSource } : {}) };
}

const CULL = 1, DECAL = 2, DROP = 4, OFFSET = 8;
// World units a triangle is moved towards its front side to win over a coplanar one (1 cm; the renderer's depth
// resolves the resulting 1-2 unit separation to a few thousand units away).
const NUDGE = 0.5;
const PLANE_TOLERANCE = 0.5; // opposite-facing faces of one surface (vertices are whole BG units, scaled)
const EXACT_TOLERANCE = 0.05; // same-side overlaps: exactly coplanar only (a nearer overlay must keep winning)
const CELL = 512; // spatial grid within a plane, world units

/**
 * Coplanar overlapping triangles, which z-fight in the viewer where the game shows one of them (checked over every BG):
 * - Surfaces modelled from both sides (a floor's top and underside, the two faces of a wall between rooms: Archives,
 *   Cradle, Depot …): coplanar, opposite-facing, triangulated differently. The game culls the side facing away (the
 *   lists set G_CULL_BACK) and portals show one room at a time; the viewer draws BG double-sided (§3.5) and its culling is
 *   a user option. Each such triangle is moved NUDGE towards its front, so each side shows its own face either way, and
 *   triangles at least half covered by opposite faces also get cullBack.
 * - The RDP's depth test passes coplanar pixels (nearer = z - dz <= stored z), so a later draw shows over an earlier
 *   one at the same depth: translucent secondary-list triangles lying on solid surfaces become decals; within a room, a
 *   solid triangle entirely covered by later opaque, exactly coplanar ones on the same side is dropped (never visible),
 *   one lying entirely on earlier ones becomes a decal, and one partly overlapping earlier ones is moved NUDGE forward.
 * Same-side overlaps between different rooms are left (their order depends on the portals).
 */
function resolveCoplanar(rooms: RoomBatches[]): void {
  let total = 0;
  for (const r of rooms) for (const b of r.batches) if (!b.decal) total += b.positions.length / 9;
  // Triangle table: positions, unit normal, plane distance, padded bounding box, plane key.
  const P = new Float64Array(total * 9), N = new Float64Array(total * 3), D = new Float64Array(total);
  const LO = new Float64Array(total * 3), HI = new Float64Array(total * 3);
  const roomOf = new Int32Array(total), src = new Float64Array(total), triOf = new Int32Array(total), stamp = new Int32Array(total).fill(-1);
  const solid = new Uint8Array(total), opaque = new Uint8Array(total), flags = new Uint8Array(total);
  const batchOf: Batch[] = [], planeKey: string[] = [];
  const grid = new Map<string, number[]>();
  // Grid cells of a triangle's box in its plane's bucket (normal with canonical sign, rounded distance + dOffset).
  const bucketOf = new Int32Array(total), axisOf = new Uint8Array(total);
  const cells = (i: number, dOffset: number, visit: (key: string) => void) => {
    const base = `${planeKey[i]}|${bucketOf[i] + dOffset}|`;
    // Cells over the two axes the plane extends along.
    const axis = axisOf[i];
    const u = axis === 0 ? 1 : 0, v = axis === 2 ? 1 : 2;
    const u0 = Math.floor(LO[i * 3 + u] / CELL), u1 = Math.floor(HI[i * 3 + u] / CELL);
    const v0 = Math.floor(LO[i * 3 + v] / CELL), v1 = Math.floor(HI[i * 3 + v] / CELL);
    if ((u1 - u0 + 1) * (v1 - v0 + 1) > 1024) {
      visit(`${base}big`);
      return;
    }
    for (let x = u0; x <= u1; x++) for (let y = v0; y <= v1; y++) visit(`${base}${x},${y}`);
  };
  let n = 0;
  rooms.forEach((r, ri) => {
    for (const b of r.batches) {
      if (b.decal) continue;
      const pos = b.positions;
      for (let t = 0; t < pos.length / 9; t++) {
        const i = n, o = i * 9;
        for (let k = 0; k < 9; k++) P[o + k] = pos[t * 9 + k];
        const ax = P[o + 3] - P[o], ay = P[o + 4] - P[o + 1], az = P[o + 5] - P[o + 2];
        const bx = P[o + 6] - P[o], by = P[o + 7] - P[o + 1], bz = P[o + 8] - P[o + 2];
        const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
        const len = Math.hypot(cx, cy, cz);
        if (len < 1e-3) continue;
        const nx = cx / len, ny = cy / len, nz = cz / len;
        N[i * 3] = nx;
        N[i * 3 + 1] = ny;
        N[i * 3 + 2] = nz;
        D[i] = nx * P[o] + ny * P[o + 1] + nz * P[o + 2];
        // Both sides of a plane share a bucket: the normal with its sign made canonical, and the rounded distance.
        const s = nx < -1e-6 || (Math.abs(nx) <= 1e-6 && (ny < -1e-6 || (Math.abs(ny) <= 1e-6 && nz < 0))) ? -1 : 1;
        const kx = Math.round(nx * s * 50), ky = Math.round(ny * s * 50), kz = Math.round(nz * s * 50);
        planeKey[i] = `${kx},${ky},${kz}`;
        // Grid axes from the rounded key, so both faces of a plane agree.
        axisOf[i] = Math.abs(kx) >= Math.abs(ky) ? (Math.abs(kx) >= Math.abs(kz) ? 0 : 2) : Math.abs(ky) >= Math.abs(kz) ? 1 : 2;
        bucketOf[i] = Math.round(D[i] * s);
        for (let k = 0; k < 3; k++) {
          LO[i * 3 + k] = Math.min(P[o + k], P[o + 3 + k], P[o + 6 + k]) - PLANE_TOLERANCE;
          HI[i * 3 + k] = Math.max(P[o + k], P[o + 3 + k], P[o + 6 + k]) + PLANE_TOLERANCE;
        }
        roomOf[i] = ri;
        src[i] = b.triSource ? b.triSource[t] : 0;
        triOf[i] = t;
        batchOf[i] = b;
        solid[i] = b.blend !== 'blend' ? 1 : 0;
        opaque[i] = b.blend === 'opaque' ? 1 : 0;
        cells(i, 0, (key) => {
          const list = grid.get(key);
          if (list) list.push(i);
          else grid.set(key, [i]);
        });
        n++;
      }
    }
  });
  const dot = (a: number, b: number) => N[a * 3] * N[b * 3] + N[a * 3 + 1] * N[b * 3 + 1] + N[a * 3 + 2] * N[b * 3 + 2];
  const distance = (a: number, b: number) => {
    let m = 0;
    for (let k = b * 9; k < b * 9 + 9; k += 3) m = Math.max(m, Math.abs(N[a * 3] * P[k] + N[a * 3 + 1] * P[k + 1] + N[a * 3 + 2] * P[k + 2] - D[a]));
    return m;
  };
  const near: number[] = [];
  const collect = (list: number[] | undefined, a: number) => {
    if (!list) return;
    for (const b of list) {
      if (stamp[b] === a || b === a) continue;
      stamp[b] = a;
      if (LO[b * 3] > HI[a * 3] || HI[b * 3] < LO[a * 3] || LO[b * 3 + 1] > HI[a * 3 + 1] || HI[b * 3 + 1] < LO[a * 3 + 1] || LO[b * 3 + 2] > HI[a * 3 + 2] || HI[b * 3 + 2] < LO[a * 3 + 2]) continue;
      if (Math.abs(Math.abs(dot(a, b)) - 1) > 0.001 || distance(a, b) > PLANE_TOLERANCE) continue;
      near.push(b);
    }
  };
  // Share of 21 interior sample points of a inside any of the triangles, in the plane's dominant projection.
  const coverage = (a: number, parts: number[]): number => {
    if (!parts.length) return 0;
    const fx = Math.abs(N[a * 3]), fy = Math.abs(N[a * 3 + 1]), fz = Math.abs(N[a * 3 + 2]);
    const axis = fx > fy ? (fx > fz ? 0 : 2) : fy > fz ? 1 : 2;
    const u = axis === 0 ? 1 : 0, v = axis === 2 ? 1 : 2;
    const A = a * 9;
    let covered = 0;
    for (let i = 1; i < 8; i++) {
      for (let j = 1; i + j < 8; j++) {
        const wi = i / 8, wj = j / 8, w0 = 1 - wi - wj;
        const x = P[A + u] * w0 + P[A + 3 + u] * wi + P[A + 6 + u] * wj, y = P[A + v] * w0 + P[A + 3 + v] * wi + P[A + 6 + v] * wj;
        for (const b of parts) {
          const B = b * 9;
          const u0 = P[B + u], v0 = P[B + v], u1 = P[B + 3 + u], v1 = P[B + 3 + v], u2 = P[B + 6 + u], v2 = P[B + 6 + v];
          const s1 = (u1 - u0) * (y - v0) - (v1 - v0) * (x - u0);
          const s2 = (u2 - u1) * (y - v1) - (v2 - v1) * (x - u1);
          const s3 = (u0 - u2) * (y - v2) - (v0 - v2) * (x - u2);
          if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) {
            covered++;
            break;
          }
        }
      }
    }
    return covered / 21;
  };
  for (let a = 0; a < n; a++) {
    near.length = 0;
    for (let o = -1; o <= 1; o++) {
      cells(a, o, (key) => collect(grid.get(key), a));
      collect(grid.get(`${planeKey[a]}|${bucketOf[a] + o}|big`), a);
    }
    if (!near.length) continue;
    if (!solid[a]) {
      if (coverage(a, near.filter((b) => solid[b])) > 0) flags[a] |= DECAL;
      continue;
    }
    const opposite = coverage(a, near.filter((b) => solid[b] && dot(a, b) < 0));
    if (opposite > 0) flags[a] |= OFFSET;
    if (opposite >= 0.5) flags[a] |= CULL;
    const same = near.filter((b) => solid[b] && roomOf[b] === roomOf[a] && dot(a, b) > 0 && distance(a, b) <= EXACT_TOLERANCE);
    if (!same.length) continue;
    const later = same.filter((b) => src[b] > src[a]), earlier = same.filter((b) => src[b] < src[a]);
    const underEarlier = coverage(a, earlier);
    if (later.length && later.every((b) => opaque[b]) && coverage(a, later) >= 0.99) flags[a] |= DROP;
    else if (underEarlier >= 0.99) flags[a] |= DECAL;
    else if (underEarlier > 0) flags[a] |= OFFSET;
  }
  const masks = new Map<Batch, Uint8Array>();
  const counts = rooms.map(() => ({ culled: 0, offset: 0, decal: 0, dropped: 0 }));
  for (let a = 0; a < n; a++) {
    const f = flags[a];
    if (!f) continue;
    const c = counts[roomOf[a]], b = batchOf[a];
    if (f & DROP) c.dropped++;
    if (f & CULL) c.culled++;
    if (f & DECAL) c.decal++;
    if (f & OFFSET && !(f & DROP)) {
      c.offset++;
      for (let k = 0; k < 9; k++) b.positions[triOf[a] * 9 + k] += N[a * 3 + (k % 3)] * NUDGE;
    }
    const split = f & DROP ? DROP : f & (CULL | DECAL);
    if (!split) continue;
    let mask = masks.get(b);
    if (!mask) masks.set(b, (mask = new Uint8Array(b.positions.length / 9)));
    mask[triOf[a]] = split;
  }
  rooms.forEach((r, i) => {
    const c = counts[i];
    if (c.culled || c.offset || c.decal || c.dropped) {
      r.info.coplanar = `triangles over coplanar ones: ${c.offset} moved ${NUDGE} towards their front, ${c.culled} back-face culled, ${c.decal} decals, ${c.dropped} hidden ones dropped`;
    }
    r.batches = r.batches.flatMap((b) => {
      const mask = masks.get(b);
      if (!mask) return [b];
      const parts = [0, CULL, DECAL, CULL | DECAL]
        .map((f) => ({ ...subset(b, mask, f), ...(f & CULL ? { cullBack: true } : {}), ...(f & DECAL ? { decal: true } : {}) }))
        .filter((x) => x.positions.length);
      if (r.backdrop.has(b)) for (const x of parts) r.backdrop.add(x);
      return parts;
    });
  });
}

function toGeometry(r: RoomBatches): RoomGeometry {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const b of r.batches) {
    const p = b.positions;
    for (let k = 0; k < p.length; k++) {
      const c = k % 3;
      if (p[k] < lo[c]) lo[c] = p[k];
      if (p[k] > hi[c]) hi[c] = p[k];
    }
  }
  const center: Vec3 = lo[0] <= hi[0] ? [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2] : [0, 0, 0];
  for (const b of r.batches) for (let k = 0; k < b.positions.length; k++) b.positions[k] -= center[k % 3];
  const info: DebugInfo = { ...r.info, center: center.map((v) => +v.toFixed(1)).join(', ') };
  const mesh = (name: string, list: Batch[]): Mesh | null => {
    const merged = mergeBatches(list);
    if (!merged.length) return null;
    let radius = 0;
    for (const b of merged) for (let k = 0; k < b.positions.length; k += 3) radius = Math.max(radius, Math.hypot(b.positions[k], b.positions[k + 1], b.positions[k + 2]));
    return { name, radius, batches: merged, info };
  };
  return {
    room: r.room, center,
    mesh: mesh(`room ${r.room}`, r.batches.filter((b) => !r.backdrop.has(b))),
    backdrop: mesh(`room ${r.room} backdrop`, r.batches.filter((b) => r.backdrop.has(b))),
    triangles: r.batches.reduce((s, b) => s + b.positions.length / 9, 0),
    vertices: r.vertices,
  };
}

/**
 * Every non-empty room of a BG as world-unit meshes centred on the room (RoomGeometry.center). BG is drawn double-sided
 * (§3.5: some visible triangles wind the other way); coplanar overlaps are resolved across rooms (resolveCoplanar).
 * triSource is an offset into the room buffer described by Mesh.info.
 */
export function buildRooms(bg: BgFile, textures: GeTextures, scale: number): RoomGeometry[] {
  const rooms = bg.rooms.filter((room) => room.index > 0 && room.vertices).map((room) => roomBatches(bg, room.index, textures, scale));
  resolveCoplanar(rooms);
  return rooms.map(toGeometry);
}

// ---- room visibility (§3.2) ----
// Visibility commands: 8-byte records {u8 op; u8 words; u16; u32 param} walked to op 0; a command's arguments are the
// `words - 1` records after it (65 = a value, a room number; 64 = a portal, by polygon pointer). Only Dam has any. The
// grammar is inferred from Dam's 388 commands and its captured frame, not from the game's interpreter:
//   14 a b      camera in rooms a..b          04          or (joins the conditions before it)
//   5A … 5C     a block holding a gate         1E / 1F p   always / when portal p is on screen
//   20 r        draw room r                   21          starts a group: its blocks share the room list after them
//   24 r, 26 r, 25 a b, 27 a b                name rooms and ranges for cameras in rooms 121-123 (meaning unknown;
//                                              treated as drawing them)

export interface VisibilityRule {
  cameraRooms: [number, number][]; // inclusive ranges; any of them enables the rule
  rooms: number[]; // rooms the rule draws
}

export function parseVisibility(bg: BgFile): VisibilityRule[] {
  const { data } = bg;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const rules: VisibilityRule[] = [];
  let cameraRooms: [number, number][] = [], rooms: number[] = [], drew = false;
  const flush = () => {
    if (rooms.length) rules.push({ cameraRooms, rooms });
    cameraRooms = [];
    rooms = [];
    drew = false;
  };
  for (let o = bg.visibility; bg.visibility && o + 8 <= data.length; ) {
    const op = data[o], words = Math.max(1, data[o + 1]);
    if (op === 0) break;
    const arg = (k: number) => (o + 8 * k + 8 <= data.length ? dv.getUint32(o + 8 * k + 4) : 0);
    switch (op) {
      case 0x21: flush(); break;
      case 0x14:
        if (drew) flush();
        cameraRooms.push([arg(1), arg(2)]);
        break;
      case 0x20: case 0x24: case 0x26: rooms.push(arg(1)); drew = true; break;
      case 0x25: case 0x27:
        for (let r = arg(1); r <= arg(2) && r < 256; r++) rooms.push(r);
        drew = true;
        break;
    }
    o += 8 * words;
  }
  flush();
  return rules;
}

/**
 * Rooms the game can draw while the camera is in one of `from`: rooms reached through the portals, rooms the visibility
 * commands draw for those camera rooms (portal gates taken as open), and, in BGs without commands, every room without
 * portals, or every room when the camera is in one (captured frames: Aztec draws its portal-less rooms 3-4 from room 2;
 * Frigate draws portal rooms from its portal-less deck room 57; Dam, which has commands, draws none of its portal-less
 * backdrop rooms from room 135 though room 5 is on screen).
 */
export function roomsVisibleFrom(bg: BgFile, from: Set<number>): Set<number> {
  const adj = new Map<number, number[]>();
  for (const p of bg.portals) {
    for (const [a, b] of [[p.roomA, p.roomB], [p.roomB, p.roomA]]) {
      const list = adj.get(a);
      if (list) list.push(b);
      else adj.set(a, [b]);
    }
  }
  const out = new Set(from);
  const queue = [...from];
  while (queue.length) for (const next of adj.get(queue.shift()!) ?? []) if (!out.has(next)) out.add(next), queue.push(next);
  const rules = parseVisibility(bg);
  for (const rule of rules) {
    if (rule.cameraRooms.some(([a, b]) => [...from].some((r) => r >= a && r <= b))) for (const r of rule.rooms) out.add(r);
  }
  if (!rules.length) {
    const portalLess = bg.rooms.filter((room) => room.index > 0 && room.vertices && !adj.has(room.index)).map((room) => room.index);
    const everything = portalLess.some((r) => from.has(r));
    for (const room of bg.rooms) if (room.index > 0 && room.vertices && (everything || portalLess.includes(room.index))) out.add(room.index);
  }
  return out;
}

/** One room on its own (coplanar overlaps resolved within the room only; buildRooms resolves them across rooms). */
export function buildRoom(bg: BgFile, index: number, textures: GeTextures, scale: number): RoomGeometry {
  const room = roomBatches(bg, index, textures, scale);
  resolveCoplanar([room]);
  return toGeometry(room);
}
