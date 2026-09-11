// GoldenEye clipping ("stan") files Tbg_<code>_all_p_stanZ: the walkable floor as convex polygon tiles, for floor
// heights under objects and the start camera (GOLDENEYE.md §4.10). Coordinates are s16 BG units.
//
//   +00 u32 0; +04 u32 sectionOffset[] … 0      tiles run contiguously from the first section to the file end
//   tile (8 + 8n bytes): u32 id << 8 | room; u16 flags; u16 n << 12 | i0 << 8 | i1 << 4 | i2
//                        n x {s16 x, y, z; u16 link}   (link = neighbour tile offset / 8, < 16 = none)
//   an all-zero 8-byte record ends the list
// The Citadel's file is an older format this layout reads as no tiles.
import type { Batch } from '../types';

const CELL = 256; // lookup grid, BG units

export interface StanPoint { x: number; y: number; z: number; link: number }

export interface StanTile {
  offset: number; // file offset
  id: number;
  room: number; // BG room number
  flags: number;
  plane: [number, number, number]; // the points that define the floor plane
  points: StanPoint[];
  minX: number; maxX: number; minZ: number; maxZ: number;
}

export interface Stan {
  tiles: StanTile[];
  grid: Map<number, StanTile[]>;
}

const cellKey = (gx: number, gz: number) => (gx + 0x8000) * 0x10000 + (gz + 0x8000);

export function parseStan(b: Uint8Array): Stan {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tiles: StanTile[] = [];
  const first = b.length >= 8 ? dv.getUint32(4) : 0;
  for (let o = first; first && o + 8 <= b.length; ) {
    const h = dv.getUint32(o), flags = dv.getUint16(o + 4), w = dv.getUint16(o + 6), n = w >> 12;
    if ((h | flags | w) === 0 || n < 3 || o + 8 + 8 * n > b.length) break;
    const points: StanPoint[] = [];
    for (let k = 0; k < n; k++) {
      const p = o + 8 + 8 * k;
      points.push({ x: dv.getInt16(p), y: dv.getInt16(p + 2), z: dv.getInt16(p + 4), link: dv.getUint16(p + 6) });
    }
    const xs = points.map((p) => p.x), zs = points.map((p) => p.z);
    tiles.push({
      offset: o, id: h >>> 8, room: h & 0xff, flags, plane: [(w >> 8) & 15, (w >> 4) & 15, w & 15], points,
      minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs),
    });
    o += 8 + 8 * n;
  }
  // Older format, only in the Citadel's Tbg_cat (GOLDENEYE.md §4.10): u32 0; u32 0xC; u32 0; then tiles
  //   {u32 name (file offset of an 8-byte string, "p502a2" …); u16 flags; u16 room; u8 n; u8 i0, i1, i2;
  //    n × {f32 x, y, z (BG units); u32 link (file offset of the neighbour tile across edge k → k+1, 0 = none)}}
  // up to an all-zero record, followed by the table of names. The retail layout reads no tiles from it.
  if (!tiles.length && first === 0xc) {
    for (let o = first; o + 12 <= b.length; ) {
      const n = b[o + 8];
      if (dv.getUint32(o) === 0 || n < 3 || n > 16 || o + 12 + 16 * n > b.length) break;
      const points: StanPoint[] = [];
      for (let k = 0; k < n; k++) {
        const p = o + 12 + 16 * k;
        points.push({ x: dv.getFloat32(p), y: dv.getFloat32(p + 4), z: dv.getFloat32(p + 8), link: dv.getUint32(p + 12) });
      }
      const xs = points.map((p) => p.x), zs = points.map((p) => p.z);
      tiles.push({
        offset: o, id: tiles.length, room: dv.getUint16(o + 6), flags: dv.getUint16(o + 4), plane: [b[o + 9], b[o + 10], b[o + 11]], points,
        minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs),
      });
      o += 12 + 16 * n;
    }
  }
  const grid = new Map<number, StanTile[]>();
  for (const t of tiles) {
    for (let gx = Math.floor(t.minX / CELL); gx <= Math.floor(t.maxX / CELL); gx++) {
      for (let gz = Math.floor(t.minZ / CELL); gz <= Math.floor(t.maxZ / CELL); gz++) {
        const k = cellKey(gx, gz), l = grid.get(k);
        if (l) l.push(t);
        else grid.set(k, [t]);
      }
    }
  }
  return { tiles, grid };
}

/** Height of the tile's plane at (x, z), as 0x7F0B2970 computes it (BG units). */
export function tileHeight(t: StanTile, x: number, z: number): number {
  const a = t.points[t.plane[0]], b = t.points[t.plane[1]], c = t.points[t.plane[2]];
  if (!a || !b || !c) return t.points[0].y;
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  return ny === 0 ? a.y : a.y - (nx * (x - a.x) + nz * (z - a.z)) / ny;
}

/** Whether (x, z) lies inside the tile's polygon seen from above (either winding, edges inclusive). */
export function tileContains(t: StanTile, x: number, z: number): boolean {
  const p = t.points;
  let sign = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const cr = (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);
    if (cr === 0) continue;
    const s = cr > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

export function tilesAt(s: Stan, x: number, z: number): StanTile[] {
  const l = s.grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) ?? [];
  return l.filter((t) => x >= t.minX && x <= t.maxX && z >= t.minZ && z <= t.maxZ && tileContains(t, x, z));
}

/**
 * The floor under (x, z) for a point at height yRef (BG units): the highest tile plane at or below yRef + above, else
 * the lowest one above; null where no tile covers the point. Verified against the player's floor and the game's pad
 * tiles (§4.10); the game itself walks tile links from the object's current tile instead.
 */
export function floorAt(s: Stan, x: number, z: number, yRef: number, above = 10): { y: number; tile: StanTile } | null {
  let best: { y: number; tile: StanTile } | null = null, fallback: { y: number; tile: StanTile } | null = null;
  for (const tile of tilesAt(s, x, z)) {
    const y = tileHeight(tile, x, z);
    if (y <= yRef + above) {
      if (!best || y > best.y) best = { y, tile };
    } else if (!fallback || y < fallback.y) {
      fallback = { y, tile };
    }
  }
  return best ?? fallback;
}

// ---- collision overlay ----
// Tile kinds by the steepness of their floor plane: floor (|normal y| ≥ 0.7), slope (≥ 0.3), steep; tiles with any of
// the flag word's top four bits set (170 over all files, meaning unknown) are drawn cyan. Shaded per room so the tiles
// of neighbouring rooms stay distinguishable.
const KIND_COLORS: [number, number, number][] = [[90, 200, 90], [200, 150, 80], [200, 90, 200]];
const FLAGGED_COLOR: [number, number, number] = [80, 190, 255];

/**
 * Every tile as one translucent batch in world units (BG units / scale), lifted `lift` world units and marked decal so
 * it lies over the room floors it matches; triSource is the tile's offset in the inflated file.
 */
export function collisionBatch(s: Stan, scale: number, lift = 2): Batch | null {
  const pos: number[] = [], col: number[] = [], src: number[] = [];
  for (const t of s.tiles) {
    const p = t.points, a = p[t.plane[0]], b = p[t.plane[1]], c = p[t.plane[2]];
    let kind = 0;
    if (a && b && c) {
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const up = Math.abs(ny) / (Math.hypot(nx, ny, nz) || 1);
      kind = up >= 0.7 ? 0 : up >= 0.3 ? 1 : 2;
    }
    const shade = 0.7 + (0.3 * (Math.imul(t.room + 1, 2654435761) >>> 24)) / 255;
    const rgb = (t.flags & 0xf000 ? FLAGGED_COLOR : KIND_COLORS[kind]).map((x) => Math.round(x * shade));
    for (let i = 1; i + 1 < p.length; i++) {
      for (const q of [p[0], p[i], p[i + 1]]) {
        pos.push(q.x / scale, q.y / scale + lift, q.z / scale);
        col.push(rgb[0], rgb[1], rgb[2], 150);
      }
      src.push(t.offset);
    }
  }
  if (!pos.length) return null;
  return {
    texture: -1, blend: 'blend', depthTest: true, depthWrite: false, cullBack: false, decal: true,
    positions: new Float32Array(pos), uvs: new Float32Array((pos.length / 3) * 2), colors: new Uint8Array(col), triSource: new Uint32Array(src),
  };
}
