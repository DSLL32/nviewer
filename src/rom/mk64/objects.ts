// Course paths and static object positions from Mario Kart 64's segment-6 data.
import type { Batch, DebugInfo, Instance, LevelLayer, Marker, Mesh } from '../types';
import type { CollisionTriangle } from './collision';
import { mio0, type SegmentSpace } from './fs';

type Point = [number, number, number, number];

interface PathDef {
  kind: 'secondary' | 'main' | 'train' | 'ferry' | 'ceremony';
  index: number;
  address: number;
}

const SECONDARY_PATHS = [
  [0x06005568], [0x06004480], [0x06004f90], [0x06004578],
  [0x0600d780, 0x0600d9c8, 0x0600dc18, 0x0600dea8], [0x060034a0],
  [0x0600ade0], [0x0600b5b8], [0x0600a540], [0x0600ec80], [0x06003b80],
  [0x06006ac8], [0x06004bf8], [0x060019d0], [0x060056a0], [], [], [],
  [0x060071f0], [],
] as const;

const MAIN_PATHS = [
  [0x060057b0], [0x060047f0], [0x060051d0], [0x060047f0],
  [0x0600e150, 0x0600f680, 0x06010b58, 0x06012090], [0x060036e8],
  [0x0600b1a8, 0x0600c4b0], [0x0600b828], [0x0600a6d0], [0x0600ede8],
  [0x06003d30], [0x06006ec0], [0x06004de8], [0x06001cf8], [0x06005908],
  [], [], [], [0x06007620], [],
] as const;

const HAZARD_PATHS: Partial<Record<number, { kind: 'train' | 'ferry'; address: number }[]>> = {
  11: [{ kind: 'train', address: 0x06006c60 }],
  18: [{ kind: 'ferry', address: 0x06007520 }],
};

const PATH_WIDTH = [50, 35, 35, 40, 35, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, -1, -1, -1, 40, -1];

const SPAWN_LISTS: Partial<Record<number, { name: string; address: number; stride?: number }[]>> = {
  0: [{ name: 'item box', address: 0x06009498 }, { name: 'Piranha Plant', address: 0x06009518 }, { name: 'tree', address: 0x06009570 }],
  1: [{ name: 'falling rock', address: 0x06007230 }, { name: 'item box', address: 0x06007250 }],
  2: [{ name: 'bush', address: 0x06009290 }, { name: 'item box', address: 0x06009370 }],
  3: [{ name: 'item box', address: 0x0600b3d0 }],
  4: [{ name: 'tree', address: 0x060180a0 }, { name: 'item box', address: 0x06018110 }],
  5: [{ name: 'tree', address: 0x06007718 }, { name: 'item box', address: 0x06007810 }],
  6: [{ name: 'item box', address: 0x06018e78 }, { name: 'palm tree', address: 0x06018f70 }],
  7: [{ name: 'Piranha Plant', address: 0x0600d9f0 }, { name: 'tree', address: 0x0600da78 }, { name: 'item box', address: 0x0600db80 }],
  8: [{ name: 'item box', address: 0x0600fde8 }, { name: 'tree', address: 0x0600fe80 }],
  9: [{ name: 'cow', address: 0x06014200 }, { name: 'tree', address: 0x06014330 }, { name: 'item box', address: 0x060143e0 }],
  10: [{ name: 'item box', address: 0x06023ae0 }],
  11: [{ name: 'item box', address: 0x06022e88 }, { name: 'cactus', address: 0x06022f08 }],
  12: [{ name: 'item box', address: 0x06009b80 }],
  13: [{ name: 'item box', address: 0x06016338 }],
  14: [{ name: 'item box', address: 0x0600cb40 }],
  15: [{ name: 'item box', address: 0x06000038 }],
  16: [{ name: 'item box', address: 0x06000080 }],
  17: [{ name: 'item box', address: 0x06000028 }],
  18: [{ name: 'item box', address: 0x06013ec0 }, { name: 'tree', address: 0x06013f78, stride: 10 }],
  19: [{ name: 'item box', address: 0x06000058 }],
};

// init_actors_and_load_textures lays these independent MIO0 images out consecutively in segment 3.  Only courses
// with visible foliage need their course-specific part here; the common 0x8000/0x8800 images are retained because
// this is the exact in-game segment layout rather than a synthetic texture atlas.
const SEG3_TEXTURES: Partial<Record<number, number[]>> = {
  0: [0x6913cc], 2: [0x692f3c], 4: [0x691714], 5: [0x69333c, 0x693790],
  7: [0x691aac, 0x692cc0], 8: [0x6923d8, 0x6925e8], 9: [0x691d98, 0x692088],
  11: [0x695ba4, 0x695ee4, 0x6961e0, 0x696488, 0x6967fc],
};

export function buildObjectTextureSegment(rom: Uint8Array, courseId: number): Uint8Array {
  const streams = [0x671a88, 0x6774d8, ...(SEG3_TEXTURES[courseId] ?? [])];
  const out = new Uint8Array(streams.length * 0x800);
  streams.forEach((at, i) => out.set(mio0(rom, at).subarray(0, 0x800), i * 0x800));
  // Segment offsets begin at 0x8000 in the retail allocator.
  const padded = new Uint8Array(0x8000 + out.length);
  padded.set(out, 0x8000);
  return padded;
}

export interface CourseObjectPlacement {
  name: string;
  entry: number;
  id: number;
  source: number;
  position: [number, number, number];
  authoredY: number;
}

export interface ObjectModelRecipe {
  roots: number[];
  scale: number;
  billboard: boolean;
  lighting?: 'koopa palm';
  name: string;
}

// Static actor display lists called by the retail renderers. Dynamic Piranha Plants, cows, rocks and racers remain
// labelled markers; foliage and every item box get visible geometry.
export function objectModel(courseId: number, object: CourseObjectPlacement): ObjectModelRecipe | null {
  if (object.name === 'item box') return { roots: [0x0d003008, 0x0d003090], scale: 1, billboard: false, name: 'item box' };
  if (!/tree|bush|cactus/.test(object.name)) return null;
  switch (courseId) {
    case 0: return { roots: [0x06006a68], scale: 1, billboard: true, name: 'Mario Raceway tree' };
    case 2: return { roots: [0x060090c8], scale: 1, billboard: true, name: "Bowser's Castle bush" };
    case 4: return { roots: [0x06015b48], scale: 1, billboard: true, name: 'Yoshi Valley tree' };
    case 5: return { roots: [0x060075a0], scale: 1, billboard: true, name: 'Frappe Snowland tree' };
    case 6: {
      const v = Math.max(0, Math.min(2, object.id));
      return { roots: [[0x060185f8, 0x060186b8], [0x06018948, 0x06018a08], [0x06018c98, 0x06018d58]][v], scale: 1, billboard: false, lighting: 'koopa palm', name: `Koopa Beach palm ${v + 1}` };
    }
    case 7: return { roots: [object.id === 6 ? 0x0600d578 : 0x0600d4a0], scale: 1, billboard: true, name: object.id === 6 ? 'Royal Raceway castle tree' : 'Royal Raceway tree' };
    case 8: return { roots: [0x0600fc70], scale: 1, billboard: true, name: 'Luigi Raceway tree' };
    case 9: return { roots: [0x06013f20], scale: 1, billboard: true, name: 'Moo Moo Farm tree' };
    case 11: {
      const v = object.id === 5 ? 0 : object.id === 6 ? 1 : 2;
      return { roots: [0x06008528 + v * 0x100], scale: 1, billboard: true, name: `Kalimari cactus ${v + 1}` };
    }
    case 18: {
      const roots: Record<number, number> = { 0: 0x06010cc0, 4: 0x06011dc8, 5: 0x06012ef0, 6: 0x060138d0 };
      return { roots: [roots[object.id] ?? roots[0]], scale: 1, billboard: object.id !== 6, name: object.id === 6 ? 'D.K. Jungle palm' : `D.K. Jungle tree ${object.id}` };
    }
    default: return null;
  }
}

const PATH_COLORS: Record<PathDef['kind'] | 'left boundary' | 'right boundary', [number, number, number, number]> = {
  main: [40, 210, 255, 230],
  secondary: [210, 80, 255, 230],
  train: [255, 70, 50, 240],
  ferry: [255, 145, 40, 240],
  ceremony: [255, 230, 70, 240],
  'left boundary': [90, 255, 100, 210],
  'right boundary': [255, 215, 60, 210],
};

const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const hex = (n: number) => `0x${(n >>> 0).toString(16)}`;

function insideXZ(t: CollisionTriangle, x: number, z: number): boolean {
  const [[x1, , z1], [x2, , z2], [x3, , z3]] = t.v;
  const a = (z1 - z) * (x2 - x) - (x1 - x) * (z2 - z);
  const b = (z2 - z) * (x3 - x) - (x2 - x) * (z3 - z);
  const c = (z3 - z) * (x1 - x) - (x3 - x) * (z1 - z);
  if (!a) return !(b * c < 0);
  if (!b) return !(a * c < 0);
  if (a * b < 0) return false;
  return !(c !== 0 && b * c < 0);
}

function snappedFoliageY(triangles: CollisionTriangle[], x: number, y: number, z: number): number {
  let distance = 1000;
  let chosen: CollisionTriangle | undefined;
  for (const t of triangles) {
    if (!(t.flags & 0x4000) || t.normal[1] < -0.9) continue;
    const xs = t.v.map((p) => p[0]), ys = t.v.map((p) => p[1]), zs = t.v.map((p) => p[2]);
    if (Math.min(...xs) > x || Math.max(...xs) < x || Math.min(...zs) > z || Math.max(...zs) < z || Math.min(...ys) - 15 > y || !insideXZ(t, x, z)) continue;
    const d = t.normal[0] * x + t.normal[1] * y + t.normal[2] * z + t.distance - 5;
    if (d > 0) {
      if (distance > d) { distance = d; chosen = t; }
    } else if (d > -16) {
      distance = d;
      chosen = t;
      break;
    }
  }
  if (!chosen || distance >= 0 || chosen.normal[1] === 0) return y;
  return (chosen.normal[0] * x + chosen.normal[2] * z + chosen.distance) / -chosen.normal[1];
}

function parsePath(space: SegmentSpace, def: PathDef): Point[] {
  const out: Point[] = [];
  let at = space.resolve(def.address);
  if (at < 0) return out;
  for (let i = 0; i < 2000 && at + 8 <= space.buf.length; i++, at += 8) {
    const x = space.dv.getInt16(at), y = space.dv.getInt16(at + 2), z = space.dv.getInt16(at + 4);
    if (def.kind === 'main' ? x === -32768 && y === -32768 && z === -32768 : x === -32768) break;
    out.push([x, y, z, space.dv.getUint16(at + 6)]);
  }
  return out;
}

function derivedBoundary(points: Point[], width: number, side: -1 | 1): Point[] {
  return points.map((p, i) => {
    const q = points[(i + 1) % points.length];
    const dx = q[0] - p[0], dz = q[2] - p[2], length = Math.hypot(dx, dz) || 1;
    return [p[0] + side * width * dz / length, Math.trunc((p[1] + q[1]) / 2), p[2] - side * width * dx / length, p[3]];
  });
}

function ribbon(name: string, points: Point[], color: [number, number, number, number], width: number, source: number, info: DebugInfo): Mesh {
  const positions: number[] = [], colors: number[] = [], triSource: number[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b[0] - a[0], dz = b[2] - a[2], length = Math.hypot(dx, dz);
    if (length < 1e-5) continue;
    const sx = width * dz / length, sz = -width * dx / length;
    const y0 = a[1] + 3, y1 = b[1] + 3;
    const v = [
      [a[0] - sx, y0, a[2] - sz], [a[0] + sx, y0, a[2] + sz], [b[0] + sx, y1, b[2] + sz],
      [a[0] - sx, y0, a[2] - sz], [b[0] + sx, y1, b[2] + sz], [b[0] - sx, y1, b[2] - sz],
    ];
    for (const p of v) { positions.push(...p); colors.push(...color); }
    const address = (source + i * 8) >>> 0;
    triSource.push(address, address);
  }
  const batch: Batch = {
    texture: -1, blend: color[3] < 255 ? 'blend' : 'opaque', depthTest: true, depthWrite: false,
    cullBack: false, decal: true, positions: new Float32Array(positions),
    uvs: new Float32Array(positions.length / 3 * 2), colors: new Uint8Array(colors), triSource: new Uint32Array(triSource),
  };
  return { name, radius: 0, batches: positions.length ? [batch] : [], info };
}

function addPathMesh(meshes: Mesh[], instances: Instance[], layer: LevelLayer, mesh: Mesh) {
  if (!mesh.batches.length) return;
  const meshIndex = meshes.push(mesh) - 1;
  const instance = instances.push({ name: mesh.name, mesh: meshIndex, matrix: identity(), info: mesh.info }) - 1;
  layer.instances.push(instance);
}

export interface AddedPaths {
  main: Point[] | null;
  markers: Marker[];
}

export function addCoursePaths(space: SegmentSpace, courseId: number, meshes: Mesh[], instances: Instance[], layers: LevelLayer[]): AddedPaths {
  const layerIndex = layers.push({ name: 'paths', kind: 'markers', instances: [], visibleByDefault: false }) - 1;
  const layer = layers[layerIndex];
  const markers: Marker[] = [];
  const defs: PathDef[] = [];
  if (courseId === 20) {
    [0x0b008aa8, 0x0b008b68, 0x0b008c20, 0x0b008ce0].forEach((address, index) => defs.push({ kind: 'ceremony', index, address }));
  } else {
    SECONDARY_PATHS[courseId]?.forEach((address, index) => defs.push({ kind: 'secondary', index, address }));
    MAIN_PATHS[courseId]?.forEach((address, index) => defs.push({ kind: 'main', index, address }));
    HAZARD_PATHS[courseId]?.forEach((p, index) => defs.push({ ...p, index }));
  }
  let main: Point[] | null = null;
  for (const def of defs) {
    const points = parsePath(space, def);
    if (points.length < 2) continue;
    const label = `${def.kind} path ${def.index + 1}`;
    const info = { kind: def.kind, path: def.index, source: hex(def.address), points: points.length };
    addPathMesh(meshes, instances, layer, ribbon(label, points, PATH_COLORS[def.kind], def.kind === 'main' ? 3 : 2.25, def.address, info));
    markers.push({ label: `${label} start`, position: [points[0][0], points[0][1] + 8, points[0][2]], layer: layerIndex, info: { ...info, point: 0, section: points[0][3] } });
    if (def.kind === 'main') {
      main ??= points;
      const width = PATH_WIDTH[courseId];
      if (width > 0) for (const [boundary, side] of [['left boundary', -1], ['right boundary', 1]] as const) {
        const derived = derivedBoundary(points, width, side);
        addPathMesh(meshes, instances, layer, ribbon(`${boundary} ${def.index + 1}`, derived, PATH_COLORS[boundary], 1.5, def.address,
          { kind: boundary, path: def.index, source: hex(def.address), points: derived.length, separation: width, derived: 'perpendicular offset from main path' }));
      }
    }
  }
  return { main, markers };
}

export function addObjectMarkers(space: SegmentSpace, courseId: number, triangles: CollisionTriangle[], layers: LevelLayer[], markers: Marker[]): { layer: number; placements: CourseObjectPlacement[] } {
  const layerIndex = layers.push({ name: 'objects', kind: 'objects', instances: [] }) - 1;
  const placements: CourseObjectPlacement[] = [];
  for (const def of SPAWN_LISTS[courseId] ?? []) {
    const stride = def.stride ?? 8;
    let at = space.resolve(def.address);
    if (at < 0) continue;
    for (let i = 0; i < 512 && at + stride <= space.buf.length; i++, at += stride) {
      const x = space.dv.getInt16(at), y = space.dv.getInt16(at + 2), z = space.dv.getInt16(at + 4);
      if (x === -32768) break;
      const id = space.dv.getUint16(at + 6);
      const groundSnapped = courseId !== 18 && /tree|cactus/.test(def.name);
      const placedY = def.name === 'item box' ? y + 8.66 : groundSnapped ? snappedFoliageY(triangles, x, y, z) : y;
      placements.push({ name: def.name, entry: i, id, source: def.address + i * stride, position: [x, placedY, z], authoredY: y });
      markers.push({
        label: `${def.name} ${i + 1}`,
        position: [x, placedY, z],
        layer: layerIndex,
        info: { object: def.name, entry: i, id: hex(id), source: hex(def.address + i * stride), authoredY: y, ...(groundSnapped ? { groundedY: +placedY.toFixed(3) } : {}) },
      });
    }
  }
  // Important code-created objects whose starts are not part of the generic spawn lists.
  if (courseId === 12) {
    const penguins: [number, number, number][] = [[-383, 2, -690], [-2960, -80, 1521], [-2490, -80, 1612], [-2098, -80, 1624], [-2080, -80, 1171], [146, 0, -380], [380, 0, -766], [-2300, 0, -210], [-2500, 0, -250], [-535, 0, 875], [-250, 0, 953]];
    penguins.forEach((position, i) => markers.push({ label: `animated penguin ${i + 1}`, position, layer: layerIndex, info: { object: 'penguin', source: 'main-code placement table' } }));
  } else if (courseId === 13) {
    const signs: [string, [number, number, number]][] = [
      ['mushroom', [-1431, 827, -2957]], ['Mario', [799, 1193, -5891]], ['Boo', [-2013, 555, 0]], ['Peach', [1443, 1044, -5478]],
      ['Luigi', [1678, 1012, -4840]], ['Donkey Kong', [-3924, 921, 2566]], ['Yoshi', [-3311, 790, 3524]], ['Bowser', [-1284, 1341, 4527]],
      ['Wario', [2268, 1041, 4456]], ['Toad', [2820, 1109, 1985]],
    ];
    signs.forEach(([name, position]) => markers.push({ label: `${name} neon sign`, position, layer: layerIndex, info: { object: 'neon sign', source: 'ROM placement table' } }));
    [[-1035, 769, -2570], [-1703, 672, 325], [-790, 692, 1928]].forEach((position, i) => markers.push({ label: `animated Chain Chomp ${i + 1}`, position: position as [number, number, number], layer: layerIndex, info: { object: 'Chain Chomp', source: 'track path index 500/800/1100' } }));
  }
  return { layer: layerIndex, placements };
}

export function startCamera(path: Point[] | null): { eye: [number, number, number]; target: [number, number, number]; fovY: number } | undefined {
  if (!path || path.length < 2) return undefined;
  const p = path[0], q = path[1];
  const dx = q[0] - p[0], dz = q[2] - p[2], length = Math.hypot(dx, dz) || 1;
  const fx = dx / length, fz = dz / length;
  return {
    eye: [p[0] - fx * 50, p[1] + 9.5, p[2] - fz * 50],
    target: [p[0] + fx * 70, p[1], p[2] + fz * 70],
    fovY: 40,
  };
}

export function staticCourseCamera(courseId: number): { eye: [number, number, number]; target: [number, number, number]; fovY: number } | undefined {
  // Battle courses have no race path from which to derive a start view. These authored overview views keep the
  // camera above the arena; in particular Block Fort no longer opens inside its lower platforms.
  const cameras: Partial<Record<number, { eye: [number, number, number]; target: [number, number, number]; fovY: number }>> = {
    15: { eye: [1250, 900, 1250], target: [0, 80, 0], fovY: 45 },
    16: { eye: [1600, 1250, 1600], target: [0, 60, 0], fovY: 45 },
    17: { eye: [1000, 700, 1000], target: [0, 0, 0], fovY: 45 },
    19: { eye: [1800, 1100, 1800], target: [0, 100, 0], fovY: 45 },
    20: { eye: [-2750, 430, 560], target: [-3200, 80, -480], fovY: 40 },
  };
  return cameras[courseId];
}
