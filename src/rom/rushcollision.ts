// Collision overlays for both Rush games: the polygons the car physics tests against, from the per-level collision
// file (Rush 2049: file 139 + level; Rush: table A[36 + track]). Both games use the same format with small
// differences (big-endian):
//
//   header        Rush 0x20 bytes: u16 sections, nodes, polygons, vertices, leaf-list bytes, ...
//                 Rush 2049 0x10 bytes: u16 sections, nodes, polygons, vertices, alternates, index-stream bytes,
//                 u32 leaf-list bytes
//   sections      132 bytes each: the track's path (position, orientation, extents); none in arenas
//   nodes         20 bytes each: quadtree over the ground plane (parent, bounds, children or leaf-list offsets)
//   polygons      Rush 26 bytes: u16 flags, u16 (low nibble: vertex count), u16, 9 x i16 basis (Q14), u16 stream
//                 Rush 2049 24 bytes: u16 flags, u16 (low nibble: vertex count), 9 x i16 basis (Q14), u16 stream
//   vertices      8 bytes each: i16 x, y, z, then u16 holding 5-bit fractions (x bits 10-14, y 5-9, z 0-4);
//                 coordinate = (i16 * 32 + fraction) / 32
//   Rush:         leaf lists, then index streams
//   Rush 2049:    alternates (32 bytes each), index streams, then leaf lists
//
// A polygon's index stream (at its stream offset) holds big-endian u16 vertex indices; a byte >= 0xC0 (Rush) or
// >= 0xE0 (Rush 2049) after an index extends it by (byte & 0x3F / 0x1F) consecutive indices. Its first vertex is the
// polygon's origin in world space, the others are in the polygon's plane frame (third component 0) and are placed
// with the basis: Rush world = origin + B * local, Rush 2049 world = origin + transpose(B) * local, where B's rows are
// the stored triples. The flags' low nibble is the surface class (game code: Rush 0x8007A490, Rush 2049 0x800AE0D8).
//
// Rush 2049 alternates are {u16 group, u16 polygon, 9 x i16 basis, u16 vertex, 8-byte vertex}: when a scripted object
// moves, the game copies its group's records over the polygons (0x800B2D20) or disables the group's polygons by
// setting their flags to 0x000F (0x800B2CB4).
import type { Batch, DebugInfo, Level, Mesh } from './types';
import { view } from './util';

export type RushVariant = 'rush1' | 'rush2049';

type Vec3 = [number, number, number];

export interface CollisionPolygon {
  record: number; // file offset of the polygon (or alternate) record
  flags: number;
  vertices: Vec3[]; // viewer world space
  normal: Vec3; // viewer space, towards the side the car drives on
}

export interface RushCollision {
  counts: DebugInfo;
  polygons: CollisionPolygon[];
  alternates: { group: number; polygon: CollisionPolygon }[];
}

// The collision frame to the viewer's: Rush stores (Z, X, -Y) of its render frame, Rush 2049 the render frame; the
// viewer negates render X (README "Handedness").
const toViewer = (variant: RushVariant, [x, y, z]: number[]): Vec3 => (variant === 'rush1' ? [-y, -z, x] : [-x, y, z]);

export function parseRushCollision(buf: Uint8Array, variant: RushVariant): RushCollision {
  const dv = view(buf);
  const rush1 = variant === 'rush1';
  const [sectionCount, nodeCount, polygonCount, vertexCount] = [0, 2, 4, 6].map((o) => dv.getUint16(o));
  const polygonSize = rush1 ? 26 : 24;
  const basisAt = rush1 ? 6 : 4;
  const streamAt = rush1 ? 24 : 22;
  const runMarker = rush1 ? 0xc0 : 0xe0;
  const polygons0 = (rush1 ? 0x20 : 0x10) + sectionCount * 132 + nodeCount * 20;
  const vertices0 = polygons0 + polygonCount * polygonSize;
  const alternateCount = rush1 ? 0 : dv.getUint16(8);
  const alternates0 = vertices0 + vertexCount * 8;
  const streams0 = alternates0 + (rush1 ? dv.getUint16(8) : alternateCount * 32);
  if (streams0 > buf.length) throw new Error(`Collision file: sections end at 0x${streams0.toString(16)}, past its end`);

  const vertexAt = (o: number): Vec3 => {
    const f = dv.getUint16(o + 6);
    return [(dv.getInt16(o) * 32 + ((f >> 10) & 31)) / 32, (dv.getInt16(o + 2) * 32 + ((f >> 5) & 31)) / 32, (dv.getInt16(o + 4) * 32 + (f & 31)) / 32];
  };
  const indices = (record: number): number[] => {
    const out: number[] = [];
    let o = streams0 + dv.getUint16(record + streamAt);
    for (let left = dv.getUint16(record + 2) & 15; left > 0;) {
      let index = dv.getUint16(o);
      o += 2;
      let run = 0;
      if (left >= 2 && buf[o] >= runMarker) run = buf[o++] & ~runMarker & 0xff;
      left -= run + 1;
      for (let k = 0; k <= run; k++) out.push(index++);
    }
    if (out.some((i) => i >= vertexCount)) throw new Error(`Collision polygon 0x${record.toString(16)}: vertex index out of range`);
    return out;
  };
  const polygon = (record: number, flags: number, basisRecord: number, origin: Vec3, list: number[]): CollisionPolygon => {
    const m = Array.from({ length: 9 }, (_, k) => dv.getInt16(basisRecord + k * 2) / 16384);
    const vertices = list.map((index, k): Vec3 => {
      if (k === 0) return toViewer(variant, origin);
      const l = vertexAt(vertices0 + index * 8);
      return toViewer(variant, [0, 1, 2].map((j) =>
        origin[j] + (rush1 ? m[j * 3] * l[0] + m[j * 3 + 1] * l[1] + m[j * 3 + 2] * l[2] : m[j] * l[0] + m[j + 3] * l[1] + m[j + 6] * l[2])));
    });
    // Rush: the basis' third column points into the surface; Rush 2049: its second row points out of it.
    const normal = toViewer(variant, rush1 ? [-m[2], -m[5], -m[8]] : [m[3], m[4], m[5]]);
    return { record, flags, vertices, normal };
  };

  const polygons: CollisionPolygon[] = [];
  const lists: number[][] = [];
  for (let i = 0; i < polygonCount; i++) {
    const r = polygons0 + i * polygonSize;
    const list = indices(r);
    lists.push(list);
    polygons.push(polygon(r, dv.getUint16(r), r + basisAt, vertexAt(vertices0 + list[0] * 8), list));
  }
  const alternates: RushCollision['alternates'] = [];
  for (let i = 0; i < alternateCount; i++) {
    const a = alternates0 + i * 32;
    const target = dv.getUint16(a + 2);
    if (target >= polygonCount) throw new Error(`Collision alternate 0x${a.toString(16)}: polygon ${target} out of range`);
    const r = polygons0 + target * polygonSize;
    alternates.push({ group: dv.getUint16(a), polygon: polygon(a, dv.getUint16(r), a + 4, vertexAt(a + 24), lists[target]) });
  }
  return {
    counts: {
      sections: sectionCount, nodes: nodeCount, filePolygons: polygonCount, vertices: vertexCount, ...(rush1 ? {} : { alternates: alternateCount }),
    },
    polygons,
    alternates,
  };
}

// Surface classes (flags & 0xF). Class 5 are walls: nearly all vertical, and the Rush ground query (0x8007ADB0) skips
// them. 15 marks polygons a scripted object has switched off (Rush 2049). The others are almost all floors.
const CLASS_COLOURS: Record<number, Vec3> = {
  0: [80, 200, 90],
  1: [220, 200, 60],
  2: [60, 190, 225],
  3: [80, 110, 240],
  5: [235, 130, 50],
  6: [215, 80, 205],
  7: [235, 70, 70],
};
const CLASS_NAMES: Record<number, string> = { 5: 'wall', 15: 'disabled' };
const ALPHA = 150;
// Polygons are lifted this far (world units) towards their drivable side and drawn as decals, so they sit over the
// track surfaces they coincide with instead of z-fighting.
const LIFT = 0.5;

const IDENTITY = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const hex = (v: number) => `0x${v.toString(16)}`;

interface Group {
  cls: number;
  positions: number[];
  colors: number[];
  records: number[];
  polygons: number;
  flags: Set<number>;
}

// One mesh per surface class, so picking a face shows its class (and the face its polygon record).
function classMeshes(polygons: CollisionPolygon[], file: string, label: string): Mesh[] {
  const groups = new Map<number, Group>();
  for (const p of polygons) {
    if (p.vertices.length < 3) continue;
    const cls = p.flags & 15;
    let g = groups.get(cls);
    if (!g) groups.set(cls, (g = { cls, positions: [], colors: [], records: [], polygons: 0, flags: new Set() }));
    g.polygons++;
    g.flags.add(p.flags);
    const [nx, ny, nz] = p.normal;
    const len = Math.hypot(nx, ny, nz) || 1;
    const lift: Vec3 = [(nx / len) * LIFT, (ny / len) * LIFT, (nz / len) * LIFT];
    // Floors full brightness, walls darker, ceilings darkest; variants of a class (other flag bits) shaded apart.
    const up = ny / len;
    const h = (Math.imul(p.flags ^ 0x9e37, 2654435761) >>> 24) / 255;
    const s = (up > 0.5 ? 1 : up < -0.5 ? 0.55 : 0.78) * (0.8 + 0.2 * h);
    const rgb = (CLASS_COLOURS[cls] ?? [160, 160, 160]).map((c) => Math.round(c * s));
    const v = p.vertices.map((q): Vec3 => [q[0] + lift[0], q[1] + lift[1], q[2] + lift[2]]);
    for (let k = 1; k + 1 < v.length; k++) {
      let [a, b, c] = [v[0], v[k], v[k + 1]];
      // Front faces counter-clockwise, seen from the drivable side.
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (cross[0] * nx + cross[1] * ny + cross[2] * nz < 0) [b, c] = [c, b];
      g.positions.push(...a, ...b, ...c);
      g.colors.push(...rgb, ALPHA, ...rgb, ALPHA, ...rgb, ALPHA);
      g.records.push(p.record);
    }
  }
  return [...groups.values()].sort((x, y) => x.cls - y.cls).map((g): Mesh => {
    const positions = new Float32Array(g.positions);
    let radius = 0;
    for (let k = 0; k < positions.length; k += 3) radius = Math.max(radius, Math.hypot(positions[k], positions[k + 1], positions[k + 2]));
    const batch: Batch = {
      texture: -1, blend: 'blend', depthTest: true, depthWrite: false, cullBack: false, decal: true,
      positions, uvs: new Float32Array((positions.length / 3) * 2), colors: new Uint8Array(g.colors), triSource: new Uint32Array(g.records),
    };
    const name = CLASS_NAMES[g.cls];
    return {
      name: `${label} class ${g.cls}${name ? ` (${name})` : ''}`,
      radius,
      batches: [batch],
      info: {
        file, class: g.cls, ...(name ? { meaning: name } : {}), polygons: g.polygons, triangles: g.records.length,
        flags: [...g.flags].sort((x, y) => x - y).map(hex).join(' '),
        triSource: `offset of the polygon record in file ${file} (decompressed)`,
        colour: 'hue by surface class (flags & 0xF); floors bright, walls darker, ceilings darkest, shaded by the flag value',
      },
    };
  });
}

// Appends the collision polygons (and Rush 2049's alternate polygon placements) to a finished level as hidden layers.
// Meshes and instances go after everything else, so the level's other indices and its bounds stay as they are.
export function appendCollisionLayers(level: Level, collision: RushCollision, file: string): void {
  const layers = (level.layers ??= []);
  const add = (layerName: string, meshes: Mesh[], info: DebugInfo) => {
    if (!meshes.length) return;
    const instances = meshes.map((mesh) => level.instances.push({
      name: mesh.name, mesh: level.meshes.push({ ...mesh, info: { ...mesh.info, ...info } }) - 1, matrix: IDENTITY(), noFog: true, info: { file, ...info },
    }) - 1);
    layers.push({ name: layerName, kind: 'collision', instances, visibleByDefault: false });
  };
  add('collision', classMeshes(collision.polygons, file, 'collision'), collision.counts);
  const groups = [...new Set(collision.alternates.map((a) => a.group))].sort((x, y) => x - y);
  add('collision: scripted alternates', classMeshes(collision.alternates.map((a) => a.polygon), file, 'alternate'), {
    alternates: collision.alternates.length,
    groups: groups.map(hex).join(' '),
    note: 'other states of scripted objects\' collision (doors, trapdoors, rotors, spiked balls), one group per object; triSource is the alternate record',
  });
}
