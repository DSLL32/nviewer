// Collision overlays for the three Bomberman games (docs/BOMBERMAN.md 5.2.7 Hero, 5.3.11 The Second Attack, 5.4.7
// Bomberman 64): translucent world-space triangles in a hidden "collision" layer, one mesh per surface type so
// picking one shows its attribute in the debug info.
import type { Batch, DebugInfo, Instance, LevelLayer, Mesh } from '../types';
import { view } from '../util';
import { IDENTITY } from './common';

export interface CollisionGroup {
  name: string;
  rgb: [number, number, number];
  positions: number[]; // world-space triangles, 9 numbers each, front faces counter-clockwise
  info: DebugInfo;
}

// Triangles are lifted this far along their normal and drawn as decals, so they sit over the map surfaces they
// coincide with instead of z-fighting.
const LIFT = 1;
const ALPHA = 150;

function overlayBatch(src: number[], rgb: [number, number, number]): Batch {
  const n = Math.floor(src.length / 9) * 9;
  const positions = new Float32Array(n);
  for (let k = 0; k < n; k += 9) {
    const ax = src[k + 3] - src[k], ay = src[k + 4] - src[k + 1], az = src[k + 5] - src[k + 2];
    const bx = src[k + 6] - src[k], by = src[k + 7] - src[k + 1], bz = src[k + 8] - src[k + 2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      nx *= LIFT / len;
      ny *= LIFT / len;
      nz *= LIFT / len;
    }
    for (let v = 0; v < 9; v += 3) {
      positions[k + v] = src[k + v] + nx;
      positions[k + v + 1] = src[k + v + 1] + ny;
      positions[k + v + 2] = src[k + v + 2] + nz;
    }
  }
  const colors = new Uint8Array((n / 3) * 4);
  for (let k = 0; k < colors.length; k += 4) colors.set([rgb[0], rgb[1], rgb[2], ALPHA], k);
  return {
    texture: -1, blend: 'blend', depthTest: true, depthWrite: false, cullBack: false, decal: true,
    positions, uvs: new Float32Array((n / 3) * 2), colors,
  };
}

// Appends one mesh and instance per non-empty group, and a layer holding them (hidden by default).
export function addCollisionLayer(meshes: Mesh[], instances: Instance[], layers: LevelLayer[], groups: CollisionGroup[], name = 'collision'): void {
  const layer: LevelLayer = { name, kind: 'collision', instances: [], visibleByDefault: false };
  for (const g of groups) {
    if (g.positions.length < 9) continue;
    const batch = overlayBatch(g.positions, g.rgb);
    let radius = 0;
    for (let k = 0; k < batch.positions.length; k += 3) radius = Math.max(radius, Math.hypot(batch.positions[k], batch.positions[k + 1], batch.positions[k + 2]));
    const mesh = meshes.push({ name: g.name, radius, batches: [batch], info: { ...g.info, triangles: batch.positions.length / 9 } }) - 1;
    layer.instances.push(instances.push({ name: g.name, mesh, matrix: IDENTITY.slice(), noFog: true, info: g.info }) - 1);
  }
  if (layer.instances.length) layers.push(layer);
}

// Instances of the collision layers, which stay out of the level bounds.
export function collisionInstances(layers: LevelLayer[]): Set<number> {
  return new Set(layers.flatMap((l) => (l.kind === 'collision' ? l.instances : [])));
}

// Shades a base colour by a hash of the type, so neighbouring types of one class stay distinguishable.
export function shade(rgb: [number, number, number], type: number): [number, number, number] {
  const h = (Math.imul(type ^ 0x9e37, 2654435761) >>> 24) / 255;
  const s = 0.65 + 0.35 * h;
  return [Math.round(rgb[0] * s), Math.round(rgb[1] * s), Math.round(rgb[2] * s)];
}

export const hex = (v: number) => `0x${v.toString(16)}`;

// ---- The Second Attack: collision file (scene descriptor +0x04), docs/BOMBERMAN.md 5.3.11 ----

export interface SaPolygon {
  offset: number; // in the file
  normal: [number, number, number];
  v: number[]; // 3 vertices, xyz
  attr: number;
}

export interface SaCollision {
  bounds: { max: [number, number, number]; min: [number, number, number] };
  grids: { nx: number; ny: number; nz: number; origin: [number, number, number]; cells: number; polys: number; count: number }[];
  polygons: SaPolygon[]; // every distinct polygon of all grids
}

export function parseSaCollision(buf: Uint8Array): SaCollision {
  const dv = view(buf);
  const f = (o: number) => dv.getFloat32(o);
  const nGrids = dv.getUint32(0);
  const out: SaCollision = { bounds: { max: [f(4), f(8), f(12)], min: [f(16), f(20), f(24)] }, grids: [], polygons: [] };
  const seen = new Set<number>();
  for (let g = 0; g < nGrids && 28 + (g + 1) * 36 <= buf.length; g++) {
    const o = 28 + g * 36;
    const grid = {
      nx: dv.getUint32(o), ny: dv.getUint32(o + 4), nz: dv.getUint32(o + 8), origin: [f(o + 12), f(o + 16), f(o + 20)] as [number, number, number],
      cells: dv.getUint32(o + 24), count: dv.getUint32(o + 28), polys: dv.getUint32(o + 32),
    };
    out.grids.push(grid);
    for (let k = 0; k < grid.count; k++) {
      const p = grid.polys + k * 52;
      if (p + 52 > buf.length || seen.has(p)) continue;
      seen.add(p);
      out.polygons.push({
        offset: p, normal: [f(p), f(p + 4), f(p + 8)],
        v: Array.from({ length: 9 }, (_, i) => f(p + 12 + i * 4)), attr: dv.getUint32(p + 48),
      });
    }
  }
  return out;
}

const SA_FLOOR = 0x2; // rpRM_CHK_FLOOR 0x80057800 treats this bit as floor
const SA_COLORS = { floor: [90, 200, 90], wall: [210, 150, 70], other: [200, 90, 200], filtered: [70, 150, 230] } satisfies Record<string, [number, number, number]>;

export function saCollisionGroups(c: SaCollision, file: DebugInfo): CollisionGroup[] {
  const byAttr = new Map<number, SaPolygon[]>();
  for (const p of c.polygons) {
    const list = byAttr.get(p.attr);
    if (list) list.push(p);
    else byAttr.set(p.attr, [p]);
  }
  const grid = c.grids.map((g) => `${g.nx}x${g.nz} cells of 256 from (${g.origin.map((x) => +x.toFixed(1)).join(', ')}), ${g.count} polygons at ${hex(g.polys)}`).join('; ');
  return [...byAttr.entries()].sort((a, b) => a[0] - b[0]).map(([attr, polys]) => {
    // hitchkIgnore 0x8004C1C4: bits 0xC00 restrict the polygon to some object classes.
    const filter = attr & 0xc00;
    const cls = filter ? 'filtered' : attr & SA_FLOOR ? 'floor' : attr & 0x1c ? 'wall' : 'other';
    return {
      name: `collision ${hex(attr)}`,
      rgb: shade(SA_COLORS[cls], attr),
      positions: polys.flatMap((p) => p.v),
      info: {
        ...file, attribute: hex(attr), class: cls, polygons: polys.length, firstPolygon: hex(polys[0].offset),
        grid, bounds: `x ${c.bounds.min[0]}..${c.bounds.max[0]}, z ${c.bounds.min[2]}..${c.bounds.max[2]}`,
      },
    };
  });
}

// ---- Bomberman Hero: collision planes in the stage blob, docs/BOMBERMAN.md 5.2.7 ----

const HERO_BLOB = 0x802d0000; // load (and link) address of stage blob A
const HERO_CELL = 960; // 16 x 16 tiles of 60 units
const HERO_TILE = 60;

export interface HeroPlane {
  a: number; b: number; c: number; d: number; // a·x + b·y + c·z = d; b > 0 faces up, b < 0 is an underside
  attr: number;
  param: number;
  offset: number; // record offset in the blob
}

export interface HeroCollision {
  header: number;
  min: [number, number, number];
  max: [number, number, number];
  nx: number; ny: number; nz: number;
  planes: HeroPlane[];
  positions: number[]; // tile halves (joined into rectangles where a plane covers whole tiles), 9 per triangle
  plane: number[]; // per triangle, index into planes
}

// Query 0x80067748: each 960-unit cell has 256 tiles {u8 diagonal, u8 list0, u8 list1}; the lists name the planes
// under each half of the tile. A plane's surface is the union of the tile halves that list it.
export function parseHeroCollision(blob: Uint8Array): HeroCollision | null {
  if (blob.length < 4) return null;
  const dv = view(blob);
  const header = dv.getUint32(0) - HERO_BLOB;
  if (header < 0 || header + 0x40 > blob.length) return null;
  const h = (k: number) => dv.getInt16(header + 2 * k);
  const out: HeroCollision = {
    header, min: [h(0), h(1), h(2)], max: [h(3), h(4), h(5)], nx: h(12), ny: h(13), nz: h(14), planes: [], positions: [], plane: [],
  };
  const table = dv.getUint32(header + 0x3c) - HERO_BLOB;
  const ptr = (o: number) => dv.getUint32(o) - HERO_BLOB;
  for (let iz = 0; iz < out.nz; iz++) {
    for (let ix = 0; ix < out.nx; ix++) {
      const cp = dv.getUint32(table + 4 * (iz * out.nx + ix));
      if (!cp) continue;
      const block = cp - HERO_BLOB, tiles = ptr(block), recs = ptr(block + 4), lists = ptr(block + 8);
      const first = out.planes.length, count = Math.floor((lists - recs) / 28);
      for (let i = 0; i < count; i++) {
        const o = recs + i * 28;
        out.planes.push({ a: dv.getInt32(o), b: dv.getInt32(o + 4), c: dv.getInt32(o + 8), d: dv.getInt32(o + 12), attr: dv.getInt32(o + 20), param: dv.getInt32(o + 24), offset: o });
      }
      // cover[plane][tile]: bit 0 = listed by half 0, bit 1 = by half 1.
      const cover = Array.from({ length: count }, () => new Uint8Array(256));
      for (let t = 0; t < 256; t++) {
        for (let half = 0; half < 2; half++) {
          for (let k = lists + blob[tiles + t * 3 + 1 + half]; k < blob.length && blob[k] !== 0xff; k++) {
            if (blob[k] < count) cover[blob[k]][t] |= 1 << half;
          }
        }
      }
      const ox = out.min[0] + ix * HERO_CELL, oz = out.min[2] + iz * HERO_CELL;
      for (let i = 0; i < count; i++) {
        const p = out.planes[first + i], cov = cover[i], used = new Uint8Array(256);
        const emit = (pts: [number, number][]) => {
          // The (x, z) corners below wind clockwise seen from above; flip them for up-facing planes.
          const [v0, v1, v2] = p.b > 0 ? [pts[0], pts[2], pts[1]] : pts;
          for (const [x, z] of [v0, v1, v2]) out.positions.push(x, (p.d - p.a * x - p.c * z) / p.b, z);
          out.plane.push(first + i);
        };
        for (let tz = 0; tz < 16; tz++) {
          for (let tx = 0; tx < 16; tx++) {
            const t = tz * 16 + tx;
            if (!cov[t] || used[t]) continue;
            const x0 = ox + tx * HERO_TILE, z0 = oz + tz * HERO_TILE;
            if (cov[t] === 3) {
              // Whole tiles of one plane: join them into a rectangle (exact, the surface is planar).
              let w = 1, hgt = 1;
              while (tx + w < 16 && cov[t + w] === 3 && !used[t + w]) w++;
              for (; tz + hgt < 16; hgt++) {
                let ok = true;
                for (let k = 0; k < w && ok; k++) ok = cov[t + hgt * 16 + k] === 3 && !used[t + hgt * 16 + k];
                if (!ok) break;
              }
              for (let r = 0; r < hgt; r++) for (let k = 0; k < w; k++) used[t + r * 16 + k] = 1;
              const x1 = x0 + w * HERO_TILE, z1 = z0 + hgt * HERO_TILE;
              emit([[x0, z0], [x1, z0], [x0, z1]]);
              emit([[x1, z0], [x1, z1], [x0, z1]]);
              continue;
            }
            used[t] = 1;
            const x1 = x0 + HERO_TILE, z1 = z0 + HERO_TILE;
            // Diagonal 0: half 0 is lx + lz < 60; diagonal 1: half 0 is lz < lx.
            const halves: [number, number][][] = blob[tiles + t * 3] === 0
              ? [[[x0, z0], [x1, z0], [x0, z1]], [[x1, z0], [x1, z1], [x0, z1]]]
              : [[[x0, z0], [x1, z0], [x1, z1]], [[x0, z0], [x1, z1], [x0, z1]]];
            if (cov[t] & 1) emit(halves[0]);
            if (cov[t] & 2) emit(halves[1]);
          }
        }
      }
    }
  }
  return out;
}

// Surface classes from the player's floor handler 0x80085D54 (jump table 0x8010CCA8, attr 215..255), the hazard
// classifier 0x80086AD0 and the exit code 0x80069AD8; plain surfaces (255) by slope.
function heroClass(p: HeroPlane): { key: string; name: string; rgb: [number, number, number] } {
  const exit = (p.param << 24) >> 24;
  switch (p.attr) {
    case 255: break;
    case 245: case 217:
      return p.param === 0
        ? { key: 'kill', name: `kill floor (${p.attr})`, rgb: [255, 0, 0] }
        : { key: 'hazard', name: `hazard floor, param ${p.param} (${p.attr})`, rgb: [255, 110, 0] };
    case 247: case 248: return { key: 'hazard', name: `hazard floor kind ${p.attr - 246} (${p.attr})`, rgb: [255, 170, 60] };
    case 240: return { key: 'knockback', name: 'knock-back floor (240)', rgb: [255, 60, 160] };
    case 233: return { key: 'hole', name: 'fall-in hole (233)', rgb: [40, 40, 40] };
    case 238: case 241: return { key: 'door', name: `door, exit ${exit} (${p.attr})`, rgb: [200, 0, 255] };
    case 230: case 231: case 246: case 254: case 218: return { key: 'exit', name: `room exit ${exit} (${p.attr})`, rgb: [255, 230, 0] };
    case 239: return { key: 'launch', name: `launch pad, heading ${90 * p.param} (239)`, rgb: [0, 255, 140] };
    case 227: return { key: 'boost', name: 'boost pad (227)', rgb: [0, 220, 220] };
    case 252: return { key: 'push', name: `push zone ${p.param + 1} (252)`, rgb: [150, 120, 255] };
    case 237: case 236: case 232: case 215:
      return { key: 'current', name: `current ${({ 237: 1, 236: 2, 232: 3, 215: 4 } as Record<number, number>)[p.attr]} (${p.attr})`, rgb: [80, 160, 255] };
    default: return { key: 'other', name: `attribute ${p.attr}`, rgb: shade([190, 190, 190], p.attr) };
  }
  const ny = p.b / Math.hypot(p.a, p.b, p.c);
  if (ny < 0) return { key: 'underside', name: 'underside', rgb: [110, 70, 150] };
  if (ny < 0.5) return { key: 'steep', name: 'steep (over 60°)', rgb: [200, 150, 90] };
  return { key: 'floor', name: 'floor', rgb: [70, 190, 70] };
}

// Groups by surface class; `under` holds the down-facing planes (ceilings and the undersides of platforms).
export function heroCollisionGroups(c: HeroCollision, file: DebugInfo): { top: CollisionGroup[]; under: CollisionGroup[] } {
  const groups = new Map<string, CollisionGroup & { planes: Set<number>; params: Set<number>; attrs: Set<number> }>();
  const grid = `${c.nx}x${c.nz} cells of 960 (16x16 tiles of 60) from (${c.min[0]}, ${c.min[2]}), header ${hex(c.header)}`;
  for (let t = 0; t < c.plane.length; t++) {
    const p = c.planes[c.plane[t]];
    const cls = heroClass(p), under = p.b < 0;
    const key = `${under ? 'u' : 't'}/${cls.name}`;
    let g = groups.get(key);
    if (!g) {
      g = { name: `collision ${cls.name}${under && cls.key !== 'underside' ? ' (underside)' : ''}`, rgb: cls.rgb, positions: [], info: {}, planes: new Set(), params: new Set(), attrs: new Set() };
      groups.set(key, g);
    }
    for (let k = 0; k < 9; k++) g.positions.push(c.positions[t * 9 + k]);
    g.planes.add(c.plane[t]);
    g.params.add(p.param);
    g.attrs.add(p.attr);
  }
  const top: CollisionGroup[] = [], under: CollisionGroup[] = [];
  for (const [key, g] of groups) {
    const planes = [...g.planes];
    g.info = {
      ...file, class: key.slice(2), attribute: [...g.attrs].join(' '), params: [...g.params].slice(0, 12).map(hex).join(' '),
      planes: planes.length, firstPlane: hex(c.planes[planes[0]].offset), grid,
    };
    (key[0] === 'u' ? under : top).push({ name: g.name, rgb: g.rgb, positions: g.positions, info: g.info });
  }
  return { top, under };
}

// ---- Bomberman 64: attribute grid, docs/BOMBERMAN.md 5.4.7 ----

const CELL = 100; // cell size along x and z, and one layer unit along y
const FILL = 0x2010; // parser fill and out-of-grid value

export interface Bm64Attributes {
  layerCount: number;
  originX: number; originLayer: number; originZ: number;
  floorByte: number; // bit 7 bottomless; low bits: fall-out height -100·b
  units: number[]; // per layer, in hundreds (0xFF on the open-ended top layer)
  bases: number[]; // world y of each layer's bottom
  width: number; depth: number; // cells along x and z
  codes: Uint16Array; // (layer · depth + z) · width + x
}

// Parser 0x8026FC08: layers of blocksX × blocksZ blocks of 8 × 8 cells, filled with 0x2010 first.
export function parseBm64Attributes(buf: Uint8Array): Bm64Attributes {
  const layerCount = buf[0], originX = buf[1], originLayer = buf[2], originZ = buf[3], floorByte = buf[4];
  const hdr: { bx: number; bz: number; unit: number; offset: number }[] = [];
  let o = 5, blocksX = 0, blocksZ = 0;
  for (let k = 0; k < layerCount; k++) {
    if (o + 3 > buf.length) throw new Error(`attribute file truncated in layer ${k}`);
    const bx = buf[o], bz = buf[o + 1];
    hdr.push({ bx, bz, unit: buf[o + 2], offset: o + 3 });
    blocksX = Math.max(blocksX, bx + ((originX + 7) >> 3));
    blocksZ = Math.max(blocksZ, bz + ((originZ + 7) >> 3));
    o += 3 + 130 * bx * bz;
  }
  if (o > buf.length) throw new Error('attribute file truncated');
  const width = originX + blocksX * 8, depth = originZ + blocksZ * 8;
  const codes = new Uint16Array((layerCount + originLayer) * depth * width);
  const units: number[] = [], bases: number[] = [];
  let sum = 0;
  for (let k = 0; k < layerCount; k++) {
    const L = k + originLayer, { bx, bz, unit, offset } = hdr[k];
    codes.fill(FILL, L * depth * width, (L + 1) * depth * width);
    for (let b = 0; b < bx * bz; b++) {
      const p = offset + b * 130, col = buf[p], row = buf[p + 1];
      for (let i = 0; i < 64; i++) {
        const x = col * 8 + originX + (i % 8), z = row * 8 + originZ + (i >> 3);
        if (x < width && z < depth) codes[(L * depth + z) * width + x] = (buf[p + 2 + 2 * i] << 8) | buf[p + 3 + 2 * i];
      }
    }
    units.push(unit);
    bases.push(sum * CELL);
    sum += unit;
  }
  return { layerCount, originX, originLayer, originZ, floorByte, units, bases, width, depth, codes };
}

const BM64_COLORS: Record<string, [number, number, number]> = {
  solid: [150, 150, 165], floor: [70, 200, 90], 'floor 2': [40, 190, 190], 'floor 9': [90, 120, 255], 'floor 10': [255, 90, 200],
  'floor 11': [200, 90, 255], 'floor 14': [255, 255, 255], slope: [235, 200, 40], corner: [180, 150, 210],
  object1: [255, 150, 30], object2: [220, 90, 40], object3: [160, 100, 50],
  trigger1: [30, 140, 255], trigger2: [0, 220, 220], trigger3: [120, 255, 120], trigger4: [255, 255, 0], trigger5: [255, 60, 60],
  trigger6: [255, 120, 255], trigger7: [255, 190, 120], fallout: [40, 60, 150],
};

type V3 = [number, number, number];
// A triangle wound counter-clockwise seen from the side `n` points to.
function tri(out: number[], a: V3, b: V3, c: V3, n: V3) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const d = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
  if (d < 0) out.push(...a, ...c, ...b);
  else out.push(...a, ...b, ...c);
}
const quad = (out: number[], a: V3, b: V3, c: V3, d: V3, n: V3) => { tri(out, a, b, c, n); tri(out, a, c, d, n); };
// Box faces, except those for which `joined(dx, dy, dz)` says a neighbour continues the volume.
function box(out: number[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, joined: (dx: number, dy: number, dz: number) => boolean) {
  if (!joined(0, 1, 0)) quad(out, [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0]);
  if (!joined(0, -1, 0)) quad(out, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
  if (!joined(1, 0, 0)) quad(out, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]);
  if (!joined(-1, 0, 0)) quad(out, [x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [-1, 0, 0]);
  if (!joined(0, 0, 1)) quad(out, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
  if (!joined(0, 0, -1)) quad(out, [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1]);
}

// The solid half of a corner cell faces the neighbours it blocks moves towards (0x80290498): (sign x, sign z).
const CORNER_SOLID: Record<number, [number, number]> = { 7: [-1, -1], 8: [-1, 1], 12: [1, -1], 13: [1, 1] };
const TOP_HEIGHT = 300; // drawn height of the open-ended (unit 0xFF) top layer

export interface Bm64Marker { id: number; x: number; y: number; z: number; code: number; cell: [number, number, number] }

// Terrain (cell shapes: solid, floors, slopes, corners, the fall-out plane), grid attribute volumes (object kinds and
// trigger ids of empty cells) and spawn markers. Cells are centred on multiples of 100; layer L spans bases[L] up by
// 100·units[L].
export function bm64CollisionGroups(g: Bm64Attributes, file: DebugInfo): { terrain: CollisionGroup[]; cells: CollisionGroup[]; markers: Bm64Marker[] } {
  const groups = new Map<string, { cells: boolean; color: string; positions: number[]; codes: Map<number, number> }>();
  const group = (key: string, color: string, code: number, cells = false) => {
    let gr = groups.get(key);
    if (!gr) groups.set(key, (gr = { cells, color, positions: [], codes: new Map() }));
    gr.codes.set(code, (gr.codes.get(code) ?? 0) + 1);
    return gr.positions;
  };
  const markers: Bm64Marker[] = [];
  const cellAt = (x: number, L: number, z: number) =>
    L < 0 || L >= g.layerCount ? -1 : x < 0 || z < 0 || x >= g.width || z >= g.depth ? FILL : g.codes[(L * g.depth + z) * g.width + x];
  const height = (L: number) => (g.units[L] === 0xff ? TOP_HEIGHT : g.units[L] * CELL);
  for (let L = 0; L < g.layerCount; L++) {
    const base = g.bases[L], top = base + height(L);
    for (let z = 0; z < g.depth; z++) {
      for (let x = 0; x < g.width; x++) {
        const code = cellAt(x, L, z), nib = code & 0xf, object = (code >> 5) & 3, marker = (code >> 7) & 7, trigger = (code >> 10) & 7;
        const x0 = x * CELL - 50, x1 = x0 + CELL, z0 = z * CELL - 50, z1 = z0 + CELL;
        if (marker) markers.push({ id: marker, x: x * CELL, y: base, z: z * CELL, code, cell: [x, L, z] });
        if (object) box(group(`object kind ${object}`, `object${object}`, code, true), x0 + 5, base, z0 + 5, x1 - 5, top, z1 - 5, () => false);
        const flags = [trigger ? ` trigger ${trigger}` : '', ...[0x2000, 0x4000, 0x8000].map((f) => (code & f ? ` ${hex(f)}` : ''))].join('');
        const surface = (shape: string) => group(`${shape}${flags}`, trigger ? `trigger${trigger}` : shape, code);
        if (nib === 0xf) {
          box(surface('solid'), x0, base, z0, x1, top, z1, (dx, dy, dz) => {
            const n = cellAt(x + dx, L + dy, z + dz);
            if (dy > 0) return n >= 0 && (n & 0xf) !== 0; // a floor or solid above covers the top
            if (dy < 0) return L === 0 || (n & 0xf) === 0xf;
            return (n & 0xf) === 0xf;
          });
        } else if (nib === 0) {
          if (trigger) {
            box(group(`trigger ${trigger} volume`, `trigger${trigger}`, code, true), x0, base, z0, x1, top, z1, (dx, dy, dz) => {
              const n = cellAt(x + dx, L + dy, z + dz);
              return ((n >> 10) & 7) === trigger && (n & 0xf) === 0;
            });
          }
        } else if (nib >= 3 && nib <= 6) {
          // Slopes climb the layer's height over the run of same-shape cells (0x8026DFB8, 0x8026E3AC): 3 rises
          // towards +z, 4 towards -z, 5 towards +x, 6 towards -x.
          const alongZ = nib <= 4, dx = alongZ ? 0 : 1, dz = alongZ ? 1 : 0;
          let fwd = 0, back = 0;
          while ((cellAt(x + dx * (fwd + 1), L, z + dz * (fwd + 1)) & 0xf) === nib) fwd++;
          while ((cellAt(x - dx * (back + 1), L, z - dz * (back + 1)) & 0xf) === nib) back++;
          const len = fwd + back + 1, h = g.units[L] * CELL, rising = nib === 3 || nib === 5;
          const lo = base + (h * (rising ? back : fwd + 1)) / len, hi = base + (h * (rising ? back + 1 : fwd)) / len;
          const out = surface('slope');
          if (alongZ) quad(out, [x0, lo, z0], [x1, lo, z0], [x1, hi, z1], [x0, hi, z1], [0, 1, 0]);
          else quad(out, [x0, lo, z0], [x0, lo, z1], [x1, hi, z1], [x1, hi, z0], [0, 1, 0]);
        } else if (CORNER_SOLID[nib]) {
          const [sx, sz] = CORNER_SOLID[nib];
          const cx = sx < 0 ? x0 : x1, cz = sz < 0 ? z0 : z1, ox = sx < 0 ? x1 : x0, oz = sz < 0 ? z1 : z0;
          const out = surface('corner');
          tri(out, [cx, top, cz], [ox, top, cz], [cx, top, oz], [0, 1, 0]);
          quad(out, [ox, base, cz], [ox, top, cz], [cx, top, oz], [cx, base, oz], [-sx, 0, -sz]);
          tri(surface('floor'), [ox, base, oz], [ox, base, cz], [cx, base, oz], [0, 1, 0]);
        } else {
          // 1 floor; 2, 9, 10, 11, 14 walkable floors of unknown kind.
          quad(surface(nib === 1 ? 'floor' : `floor ${nib}`), [x0, base, z0], [x1, base, z0], [x1, base, z1], [x0, base, z1], [0, 1, 0]);
        }
      }
    }
  }
  // Fall-out height (0x8026E8B8): objects at or below it have fallen; without bit 7 it is also the ground of columns
  // that are empty in every layer.
  const floorY = -(g.floorByte & 0x7f) * CELL, bottomless = (g.floorByte & 0x80) !== 0;
  for (let z = 0; z < g.depth; z++) {
    for (let x = 0; x < g.width; x++) {
      let empty = true;
      for (let L = 0; L < g.layerCount && empty; L++) if (cellAt(x, L, z) & 0x6f) empty = false;
      if (empty) {
        // On bottomless stages it is only a height, not a surface: it goes with the attribute volumes.
        const out = group(bottomless ? 'fall-out height (bottomless)' : 'fall-out plane', 'fallout', cellAt(x, 0, z), bottomless);
        quad(out, [x * CELL - 50, floorY, z * CELL - 50], [x * CELL + 50, floorY, z * CELL - 50], [x * CELL + 50, floorY, z * CELL + 50], [x * CELL - 50, floorY, z * CELL + 50], [0, 1, 0]);
      }
    }
  }
  const terrain: CollisionGroup[] = [], cells: CollisionGroup[] = [];
  const layers = g.units.map((u, k) => `${g.bases[k]}+${u === 0xff ? 'open' : u * CELL}`).join(' ');
  for (const [key, gr] of groups) {
    const codes = [...gr.codes.entries()].sort((a, b) => b[1] - a[1]);
    (gr.cells ? cells : terrain).push({
      name: `collision ${key}`, rgb: BM64_COLORS[gr.color] ?? [200, 200, 200], positions: gr.positions,
      info: {
        ...file, class: key, cells: codes.reduce((n, c) => n + c[1], 0), codes: codes.slice(0, 12).map(([c, n]) => `${hex(c)}×${n}`).join(' '),
        grid: `${g.width}x${g.depth} cells of 100, ${g.layerCount} layers (y ${layers})`, floorByte: hex(g.floorByte),
      },
    });
  }
  return { terrain, cells, markers };
}
