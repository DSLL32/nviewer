// Perfect Dark collision tiles bgdata/bg_<code>_tilesZ (PERFECTDARK.md §4.8): parser and the collision overlay.
//
// File (inflated): u32 room count (BG rooms + 1); u32 offset[count + 1] (file-relative); room r's records span
// offset[r]..offset[r + 1]. Record {u8 type; u8 vertex count n; u16 flags}:
//   type 0: +4 u16 floor type; +6 u8 indices of the vertices with min x, min y, min z, max x, max y, max z; +12 u16 floor
//           colour; +14 n × s16 x, y, z (world units). The only type in the retail files.
//   type 1: +4 u16 floor type; +6 u8 × 6 as type 0; +12 u16 floor colour; +16 n × f32 x, y, z
//   type 2: +4 f32 ymax; +8 f32 ymin; +12 n × f32 x, z (block)   type 3: +4 f32 ymax; +8 f32 ymin; +12 f32 x, z, radius (cylinder)
// Flags (GEOFLAG_* names from the decompilation, hypothesis beyond floor/wall): 0x1/0x2 floor, 0x4 wall, 0x8 blocks sight,
// 0x10 blocks shots, 0x20 lift floor, 0x40 ladder, 0x80 (only with slope walls), 0x100 slope, 0x200 underwater,
// 0x800/0x1000 AI crouch/duck, 0x2000 step, 0x4000 death, 0x8000 player-only ladder.
import type { Batch, DebugInfo, Mesh } from '../types';

type Vec3 = [number, number, number];

export const GEOFLAG = {
  FLOOR1: 0x1, FLOOR2: 0x2, WALL: 0x4, BLOCK_SIGHT: 0x8, BLOCK_SHOOT: 0x10, LIFTFLOOR: 0x20, LADDER: 0x40, SLOPE: 0x100,
  UNDERWATER: 0x200, STEP: 0x2000, DIE: 0x4000, LADDER_PLAYERONLY: 0x8000,
} as const;

export interface Tile {
  offset: number; // of the record in the inflated file
  room: number; // BG room (every retail tile lies inside its room's box)
  type: number; // 0 or 1
  flags: number;
  floorType: number; // 0..8 in retail (hypothesis: surface material)
  floorColour: number; // 12-bit 0x0RGB
  vertices: Vec3[]; // a convex polygon
}

/** The polygon tiles (types 0 and 1) of an inflated tiles file, in room and record order. */
export function parseTiles(buf: Uint8Array): Tile[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: Tile[] = [];
  if (buf.length < 8) return out;
  const numRooms = dv.getUint32(0);
  for (let room = 0; room < numRooms && 8 + room * 4 <= buf.length; room++) {
    const end = Math.min(buf.length, dv.getUint32(8 + room * 4));
    for (let o = dv.getUint32(4 + room * 4); o + 4 <= end;) {
      const type = buf[o], n = buf[o + 1];
      const size = type === 0 ? 14 + 6 * n : type === 1 ? 16 + 12 * n : type === 2 ? 12 + 8 * n : type === 3 ? 24 : 0;
      if (!size || o + size > end) break;
      if (type <= 1) {
        const vertices: Vec3[] = [];
        for (let i = 0; i < n; i++) {
          vertices.push(type === 0
            ? [dv.getInt16(o + 14 + i * 6), dv.getInt16(o + 16 + i * 6), dv.getInt16(o + 18 + i * 6)]
            : [dv.getFloat32(o + 16 + i * 12), dv.getFloat32(o + 20 + i * 12), dv.getFloat32(o + 24 + i * 12)]);
        }
        out.push({ offset: o, room, type, flags: dv.getUint16(o + 2), floorType: dv.getUint16(o + 4), floorColour: dv.getUint16(o + 12), vertices });
      }
      o += size;
    }
  }
  return out;
}

// Overlay colours by what the tile does; floor types shade them (brightness 0.6..1).
const KINDS = {
  floor: { rgb: [90, 200, 90], label: 'floor green' },
  step: { rgb: [170, 235, 90], label: 'step floor yellow-green' },
  wall: { rgb: [205, 150, 80], label: 'wall orange' },
  ceiling: { rgb: [200, 90, 200], label: 'downward wall (ceiling) purple' },
  top: { rgb: [215, 200, 70], label: 'upward non-floor (unwalkable top) yellow' },
  blocker: { rgb: [160, 170, 215], label: 'sight/shot blocker only grey-blue' },
  ladder: { rgb: [60, 200, 235], label: 'ladder cyan' },
  underwater: { rgb: [50, 100, 255], label: 'underwater blue' },
  lift: { rgb: [230, 90, 230], label: 'lift floor magenta' },
  death: { rgb: [235, 45, 45], label: 'death red' },
} as const;
type Kind = keyof typeof KINDS;
const FLOOR_TYPE_SHADE = [1, 0.85, 0.7, 0.93, 0.78, 0.63, 0.9, 0.74, 0.6];

function kindOf(t: Tile, normalY: number): Kind {
  const f = t.flags;
  if (f & GEOFLAG.DIE) return 'death';
  if (f & (GEOFLAG.LADDER | GEOFLAG.LADDER_PLAYERONLY)) return 'ladder';
  if (f & GEOFLAG.UNDERWATER) return 'underwater';
  if (f & GEOFLAG.LIFTFLOOR) return 'lift';
  if (f & (GEOFLAG.FLOOR1 | GEOFLAG.FLOOR2)) return f & GEOFLAG.STEP ? 'step' : 'floor';
  if (f & GEOFLAG.WALL) return normalY > 0.5 ? 'top' : normalY < -0.5 ? 'ceiling' : 'wall';
  return 'blocker';
}

/**
 * The collision overlay: every tile as a translucent polygon in world space (identity placement), coloured by what it does and
 * shaded by floor type, drawn as a decal (after solid geometry, biased towards the camera) so it wins over the coplanar room
 * surfaces. triSource = the tile record's offset in the inflated tiles file.
 */
export function collisionMesh(tiles: Tile[], fileName: string): Mesh | null {
  const pos: number[] = [], col: number[] = [], src: number[] = [];
  const counts = new Map<Kind, number>(), floorTypes = new Map<number, number>();
  let radius = 0;
  for (const t of tiles) {
    const v = t.vertices, n = v.length;
    if (n < 3) continue;
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < n; i++) {
      const p = v[i], q = v[(i + 1) % n];
      nx += (p[1] - q[1]) * (p[2] + q[2]);
      ny += (p[2] - q[2]) * (p[0] + q[0]);
      nz += (p[0] - q[0]) * (p[1] + q[1]);
    }
    const kind = kindOf(t, ny / (Math.hypot(nx, ny, nz) || 1));
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    floorTypes.set(t.floorType, (floorTypes.get(t.floorType) ?? 0) + 1);
    const shade = FLOOR_TYPE_SHADE[t.floorType % FLOOR_TYPE_SHADE.length];
    const rgb = KINDS[kind].rgb.map((c) => Math.round(c * shade));
    for (let i = 1; i + 1 < n; i++) {
      for (const p of [v[0], v[i], v[i + 1]]) {
        pos.push(p[0], p[1], p[2]);
        col.push(rgb[0], rgb[1], rgb[2], 150);
        radius = Math.max(radius, Math.hypot(p[0], p[1], p[2]));
      }
      src.push(t.offset);
    }
  }
  if (!pos.length) return null;
  const batch: Batch = {
    texture: -1, blend: 'blend', depthTest: true, depthWrite: false, cullBack: false, decal: true,
    positions: new Float32Array(pos), uvs: new Float32Array((pos.length / 3) * 2), colors: new Uint8Array(col), triSource: new Uint32Array(src),
  };
  const info: DebugInfo = {
    tilesFile: fileName, tiles: tiles.length, triangles: src.length,
    ...Object.fromEntries((Object.keys(KINDS) as Kind[]).filter((k) => counts.get(k)).map((k) => [`${k} tiles`, counts.get(k)!])),
    floorTypes: [...floorTypes].sort((a, b) => a[0] - b[0]).map(([k, c]) => `${k}: ${c}`).join(', '),
    colours: `${(Object.keys(KINDS) as Kind[]).map((k) => KINDS[k].label).join(', ')}; darker for higher floor types`,
    triSource: 'offset of the tile record in the inflated tiles file',
  };
  return { name: 'collision', radius, batches: [batch], info };
}
