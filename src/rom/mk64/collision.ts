// Collision mesh as Mario Kart 64 builds it at course load (decomp src/racing/collision.c generate_collision_mesh,
// add_collision_triangle; src/racing/render_courses.c course_generate_collision_mesh, parse_course_displaylists).
// The game walks unpacked display lists: G_DL recurses, G_VTX points a 64-entry vertex buffer at segment-4 Vtx,
// G_TRI1 / G_TRI2 / G_QUAD add triangles (at most 0x1FFF commands per list, G_ENDDL stops).
import type { SegmentSpace } from './fs';
import type { CourseDef } from './courses';

export interface CollisionTriangle {
  v: [number, number, number][]; // world positions (vtx1, vtx2, vtx3 after the game's reordering)
  vtxAddr: [number, number, number]; // segment-4 addresses
  surface: number; // u16: TrackSections surfaceType as s8 -> u16 (0xFF / SURFACE_DEFAULT -> 0xFFFF)
  sectionId: number; // low byte of flags
  flags: number; // sectionId | 0x200 (section flag 0x4000) | 0x400/0x800/0x1000 (all three vertex flags 1/2/3) | facing axis
  normal: [number, number, number];
  distance: number;
  source: number; // segmented address of the triangle command
  list: number; // the list the section table / recipe names
}

export const FACING_Y_AXIS = 0x4000, FACING_X_AXIS = 0x8000, FACING_Z_AXIS = 0x2000;

export const SURFACE_NAMES: Record<number, string> = {
  0: 'airborne', 1: 'asphalt', 2: 'dirt', 3: 'sand', 4: 'stone', 5: 'snow', 6: 'bridge', 7: 'sand off-road', 8: 'grass', 9: 'ice',
  10: 'wet sand', 11: 'snow off-road', 12: 'cliff', 13: 'dirt off-road', 14: 'train track', 15: 'cave', 16: 'rope bridge', 17: 'wood bridge',
  0xfffc: 'boost ramp (wood) 0xFC', 0xfffd: 'out of bounds 0xFD', 0xfffe: 'boost ramp (asphalt) 0xFE', 0xffff: 'ramp / wall 0xFF (also SURFACE_DEFAULT -1)',
};

export interface CollisionResult {
  triangles: CollisionTriangle[];
  skipped: { flag4: number; degenerate: number; floorFilter: number; wallFilter: number };
  commands: number; // triangle commands seen (D_8015F58C)
  min: [number, number, number];
  max: [number, number, number];
}

export function buildCollision(sp: SegmentSpace, def: CourseDef): CollisionResult {
  const tris: CollisionTriangle[] = [];
  const skipped = { flag4: 0, degenerate: 0, floorFilter: 0, wallFilter: 0 };
  let commands = 0;
  const min: [number, number, number] = [0, 0, 0], max: [number, number, number] = [0, 0, 0]; // the game starts both at 0
  const vtxBuffer: number[] = new Array(64).fill(-1); // buffer offsets
  let sectFlags = { noFloors: false, noWalls: false, flag200: false };

  const vtxAt = (o: number): { x: number; y: number; z: number; flag: number } => ({
    x: sp.dv.getInt16(o), y: sp.dv.getInt16(o + 2), z: sp.dv.getInt16(o + 4), flag: sp.dv.getUint16(o + 6),
  });

  const add = (i1: number, i2: number, i3: number, surface: number, sectionId: number, source: number, list: number) => {
    let o1 = vtxBuffer[i1], o2 = vtxBuffer[i2], o3 = vtxBuffer[i3];
    if (o1 < 0 || o2 < 0 || o3 < 0) return;
    let a = vtxAt(o1), b = vtxAt(o2), c = vtxAt(o3);
    if (a.flag === 4 && b.flag === 4 && c.flag === 4) { skipped.flag4++; return; }
    if (a.x === b.x && a.z === b.z) { [b, c] = [c, b]; [o2, o3] = [o3, o2]; } // vtx2 and vtx3 swapped
    const [x1, y1, z1, x2, y2, z2, x3, y3, z3] = [a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z];
    const cx = (y2 - y1) * (z3 - z2) - (z2 - z1) * (y3 - y2);
    const cy = (z2 - z1) * (x3 - x2) - (x2 - x1) * (z3 - z2);
    const cz = (x2 - x1) * (y3 - y2) - (y2 - y1) * (x3 - x2);
    const mag = Math.fround(Math.sqrt(Math.fround(cx * cx + cy * cy + cz * cz)));
    if (!mag) { skipped.degenerate++; return; }
    const nx = Math.fround(cx / mag), ny = Math.fround(cy / mag), nz = Math.fround(cz / mag);
    const distance = -(nx * x1 + ny * y1 + nz * z1);
    if (sectFlags.noFloors && (ny < -0.9 || ny > 0.9)) { skipped.floorFilter++; return; }
    if (sectFlags.noWalls && ny < 0.1 && ny > -0.1) { skipped.wallFilter++; return; }
    for (const [k, v] of [[0, [x1, x2, x3]], [1, [y1, y2, y3]], [2, [z1, z2, z3]]] as [number, number[]][]) {
      min[k] = Math.min(min[k], ...v);
      max[k] = Math.max(max[k], ...v);
    }
    let flags = sectionId & 0xffff;
    if (a.flag === 1 && b.flag === 1 && c.flag === 1) flags |= 0x400;
    else if (a.flag === 2 && b.flag === 2 && c.flag === 2) flags |= 0x800;
    else if (a.flag === 3 && b.flag === 3 && c.flag === 3) flags |= 0x1000;
    else if (sectFlags.flag200) flags |= 0x200;
    const sx = cx * cx, sy = cy * cy, sz = cz * cz;
    if (sx <= sy && sy >= sz) flags |= FACING_Y_AXIS;
    else if (sx > sy && sx >= sz) flags |= FACING_X_AXIS;
    else flags |= FACING_Z_AXIS;
    const addrOf = (o: number) => 0x04000000 + (o - sp.base[4]);
    tris.push({
      v: [[x1, y1, z1], [x2, y2, z2], [x3, y3, z3]], vtxAddr: [addrOf(o1), addrOf(o2), addrOf(o3)],
      surface: (surface << 24 >> 24) & 0xffff, sectionId, flags, normal: [nx, ny, nz], distance, source, list,
    });
  };

  const walk = (addr: number, surface: number, sectionId: number, list: number, depth = 0) => {
    let o = sp.resolve(addr);
    if (o < 0 || depth > 16) return;
    for (let i = 0; i < 0x1fff; i++, o += 8) {
      const w0 = sp.dv.getUint32(o), w1 = sp.dv.getUint32(o + 4), op = w0 >>> 24;
      const src = (addr + i * 8) >>> 0;
      if (op === 0x06) walk(w1, surface, sectionId, list, depth + 1);
      else if (op === 0x04) {
        const n = (w0 >>> 10) & 0x3f, v0 = ((w0 >>> 16) & 0xff) >> 1, base = sp.resolve(w1);
        for (let k = 0; k < n && v0 + k < 64; k++) vtxBuffer[v0 + k] = base < 0 ? -1 : base + 16 * k;
      } else if (op === 0xbf) { commands += 1; add(((w1 >>> 16) & 0xff) >> 1, ((w1 >>> 8) & 0xff) >> 1, (w1 & 0xff) >> 1, surface, sectionId, src, list); }
      else if (op === 0xb1) {
        commands += 2;
        add(((w0 >>> 16) & 0xff) >> 1, ((w0 >>> 8) & 0xff) >> 1, (w0 & 0xff) >> 1, surface, sectionId, src, list);
        add(((w1 >>> 16) & 0xff) >> 1, ((w1 >>> 8) & 0xff) >> 1, (w1 & 0xff) >> 1, surface, sectionId, src, list);
      } else if (op === 0xb5) {
        commands += 2;
        const v1 = ((w1 >>> 16) & 0xff) >> 1, v2 = ((w1 >>> 8) & 0xff) >> 1, v3 = (w1 & 0xff) >> 1, v4 = (w1 >>> 24) >> 1;
        add(v1, v2, v3, surface, sectionId, src, list);
        add(v1, v3, v4, surface, sectionId, src, list);
      } else if (op === 0xb8) break;
    }
  };

  // course_generate_collision_mesh: the per-course extra lists come first (Mario Raceway) or instead (battle courses).
  const defaults = (def.collisionLists ?? []).filter((c) => c.surface === -1);
  const battle = (def.collisionLists ?? []).filter((c) => c.surface !== -1);
  sectFlags = { noFloors: false, noWalls: false, flag200: false };
  for (const c of defaults) walk(c.dl, -1, 0xff, c.dl);
  if (def.trackSections) {
    for (let k = 0; k < def.trackSections.count; k++) {
      const at = sp.resolve(def.trackSections.addr + 8 * k);
      const dl = sp.dv.getUint32(at);
      if (!dl) break;
      const flags = sp.dv.getUint16(at + 6);
      // parse_course_displaylists: 0x8000 ignores floors and ceilings (|ny| > 0.9), 0x2000 ignores walls (|ny| < 0.1),
      // 0x4000 adds flag 0x200
      sectFlags = { noFloors: (flags & 0x8000) !== 0, noWalls: (flags & 0x2000) !== 0, flag200: (flags & 0x4000) !== 0 };
      walk(dl, sp.buf[at + 4], sp.buf[at + 5], dl);
    }
  }
  sectFlags = { noFloors: false, noWalls: false, flag200: false };
  for (const c of battle) walk(c.dl, c.surface, 0xff, c.dl);
  return { triangles: tris, skipped, commands, min, max };
}
