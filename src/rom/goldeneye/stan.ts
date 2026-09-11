// GoldenEye clipping ("stan") files Tbg_<code>_all_p_stanZ: the walkable floor as convex polygon tiles, for floor
// heights under objects and the start camera (GOLDENEYE.md §4.10). Coordinates are s16 BG units.
//
//   +00 u32 0; +04 u32 sectionOffset[] … 0      tiles run contiguously from the first section to the file end
//   tile (8 + 8n bytes): u32 id << 8 | room; u16 flags; u16 n << 12 | i0 << 8 | i1 << 4 | i2
//                        n x {s16 x, y, z; u16 link}   (link = neighbour tile offset / 8, < 16 = none)
//   an all-zero 8-byte record ends the list
// The Citadel's file is an older format this layout reads as no tiles.
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
