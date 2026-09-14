// Perfect Dark model files P*Z (props), C*Z (bodies and heads) (docs/PERFECTDARK.md §5.4), their tables, and meshes built from
// their display lists with gbi.ts.
//
// Pointers are 0x05000000 + file offset. Header: +0 ptr root node; +4 u32 skeleton; +0x0E s16 matrix slots. Node (0x18):
// u16 type (low byte; high byte flags, 0x01 on elbow/knee POSITION nodes); ptr rodata; ptr parent; ptr next; ptr prev;
// ptr child. The lists load the model's matrix slots (G_MTX 01020040 03xxxxxx, slot = xxxxxx / 0x40), address a DL
// node's vertices as segment 4 and its colour table (after the vertices) as segment 6, and the file as segment 5.
import type { DlLighting } from '../displaylist';
import type { Batch, DebugInfo, Mesh } from '../types';
import { DEFAULT_GEOMETRY_MODE, G_CULL_BACK, newDlStats, PdBatches, type PdDlStats, runPdDisplayList } from './gbi';
import type { PdRom } from './rom';
import type { PdTextures } from './texture';

export type M4 = Float64Array; // column-major 4×4
export type Box = [number, number, number, number, number, number]; // xmin, xmax, ymin, ymax, zmin, zmax

const SEG = 0x05000000;

export const NODE = {
  CHRINFO: 0x01, POSITION: 0x02, GUNDL: 0x04, DISTANCE: 0x08, REORDER: 0x09, BBOX: 0x0a, TYPE0B: 0x0b, CHRGUNFIRE: 0x0c,
  TYPE0D: 0x0d, TOGGLE: 0x12, POSITIONHELD: 0x15, STARGUNFIRE: 0x16, HEADSPOT: 0x17, DL: 0x18, TYPE19: 0x19,
} as const;

// ---- tables (data segment) ----
const MODEL_STATES = 0x8007b06c; // 441 × {ptr; u16 file; u16 scale × 4096}
const MODEL_STATE_COUNT = 441;
const BODIES = 0x8007cf04; // 151 × 20 {u16 flags; u16 file; f32 scale; f32 anim scale; ptr; u16 hand file; u16}
const BODY_COUNT = 151;
const BODYFLAG_MALE = 0x8000;
const BODYFLAG_NO_HEAD = 0x4000; // head entries, Skedar …: the spawn code gives them no head (0x7F02D4FC)
// Random heads (0x7F02D414): at stage load the game fills 8-entry lists from these (the captures' lists hold only their
// entries) and hands them out in turn; body 104 picks one of three.
const MALE_HEADS = 0x80062b68; // s32 until -1
const FEMALE_HEADS = 0x80062c58;
const BODY_104_HEADS = 0x80062c8c; // 3 × s32
const BODY_WITH_OWN_HEADS = 104;

export interface ModelState {
  index: number;
  file: number;
  scale: number;
}

export function modelState(r: PdRom, index: number): ModelState | null {
  if (!(index >= 0 && index < MODEL_STATE_COUNT)) return null;
  const file = r.u16(MODEL_STATES + index * 8 + 4);
  return r.hasFile(file) ? { index, file, scale: r.u16(MODEL_STATES + index * 8 + 6) / 4096 } : null;
}

export interface BodyEntry {
  index: number;
  flags: number;
  file: number;
  scale: number;
  animScale: number;
}

export function bodyEntry(r: PdRom, index: number): BodyEntry | null {
  if (!(index >= 0 && index < BODY_COUNT)) return null;
  const a = BODIES + index * 20, file = r.u16(a + 2);
  return r.hasFile(file) ? { index, flags: r.u16(a), file, scale: r.f32(a + 4), animScale: r.f32(a + 8) } : null;
}

export const bodyHasHead = (b: BodyEntry) => !(b.flags & BODYFLAG_NO_HEAD);

/** A stand-in for the head the game picks at random for `body`: entry `seed` of the list it draws from. */
export function randomHead(r: PdRom, body: BodyEntry, seed: number): number {
  if (body.index === BODY_WITH_OWN_HEADS) return r.s32(BODY_104_HEADS + (seed % 3) * 4);
  const list: number[] = [];
  for (let a = body.flags & BODYFLAG_MALE ? MALE_HEADS : FEMALE_HEADS; list.length < 64 && r.s32(a) >= 0; a += 4) list.push(r.s32(a));
  return list.length ? list[seed % list.length] : -1;
}

// ---- model files ----
export interface PdNode {
  offset: number;
  type: number;
  flags: number; // high byte of the type word
  rodata: number; // file offset, -1 = none
  parent: PdNode | null;
  children: PdNode[];
}

export interface PdModel {
  file: number;
  name: string;
  data: Uint8Array; // the cached inflated file (not kept in a Level)
  roots: PdNode[]; // the root node and its siblings
  nodes: PdNode[];
  skeleton: number;
  numMatrices: number;
  box: Box | null; // the first BBOX node: what placement fits
}

export function parseModel(data: Uint8Array, file: number, name: string): PdModel {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const ptr = (at: number, size: number) => {
    if (at < 0 || at + 4 > data.length) return -1;
    const p = dv.getUint32(at);
    return p >>> 24 === 5 && (p & 0xffffff) + size <= data.length ? p & 0xffffff : -1;
  };
  const nodes: PdNode[] = [];
  const seen = new Set<number>();
  const chain = (first: number, parent: PdNode | null, out: PdNode[]) => {
    for (let o = first; o >= 0 && !seen.has(o) && nodes.length < 20000; o = ptr(o + 0x0c, 0x18)) {
      seen.add(o);
      const t = dv.getUint16(o);
      const n: PdNode = { offset: o, type: t & 0xff, flags: t >> 8, rodata: ptr(o + 4, 4), parent, children: [] };
      nodes.push(n);
      out.push(n);
      chain(ptr(o + 0x14, 0x18), n, n.children);
    }
  };
  const roots: PdNode[] = [];
  if (data.length >= 0x1c) chain(ptr(0, 0x18), null, roots);
  let box: Box | null = null;
  const findBox = (n: PdNode): boolean => {
    if (n.type === NODE.BBOX && n.rodata >= 0 && n.rodata + 0x1c <= data.length) {
      box = [4, 8, 12, 16, 20, 24].map((k) => dv.getFloat32(n.rodata + k)) as Box;
      return true;
    }
    return n.children.some(findBox);
  };
  roots.some(findBox);
  return { file, name, data, roots, nodes, skeleton: data.length >= 8 ? dv.getUint32(4) : 0, numMatrices: data.length >= 0x10 ? dv.getInt16(0x0e) : 0, box };
}

const modelCache = new WeakMap<PdRom, Map<number, PdModel | null>>();

/** A parsed model file (cached per ROM), or null when it is missing or isn't a model. */
export function loadModel(r: PdRom, file: number): PdModel | null {
  let cache = modelCache.get(r);
  if (!cache) modelCache.set(r, (cache = new Map()));
  let m = cache.get(file);
  if (m === undefined) {
    try {
      const data = r.hasFile(file) ? r.file(file) : null;
      m = data && data.length >= 0x1c && data[0] === 5 ? parseModel(data, file, r.names[file]) : null;
      if (m && !m.roots.length) m = null;
    } catch {
      m = null;
    }
    cache.set(file, m);
  }
  return m;
}

/**
 * Rest pose slots: each slot is the sum of the POSITION offsets from the root to its node (no rotations). Placed objects
 * are drawn with their root joint at the object position (`ignoreRoot`, §5.5 step 6).
 */
export function restSlots(m: PdModel, ignoreRoot: boolean): (M4 | undefined)[] {
  const dv = new DataView(m.data.buffer, m.data.byteOffset, m.data.byteLength);
  const slots: (M4 | undefined)[] = [];
  const at = (t: number[]) => new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1]);
  const visit = (n: PdNode, t: number[], depth: number) => {
    let here = t;
    const ro = n.rodata;
    if (ro >= 0 && (n.type === NODE.POSITION || n.type === NODE.POSITIONHELD)) {
      if (!(ignoreRoot && !n.parent)) here = [t[0] + dv.getFloat32(ro), t[1] + dv.getFloat32(ro + 4), t[2] + dv.getFloat32(ro + 8)];
      for (let k = 0; k < (n.type === NODE.POSITION ? 3 : 1); k++) {
        const s = dv.getInt16(ro + 14 + 2 * k);
        if (s >= 0 && !slots[s]) slots[s] = at(here);
      }
    } else if (ro >= 0 && n.type === NODE.CHRINFO) {
      const s = dv.getInt16(ro + 2);
      if (s >= 0) slots[s] = at(here);
    }
    if (depth < 64) for (const c of n.children) visit(c, here, depth + 1);
  };
  for (const r of m.roots) visit(r, [0, 0, 0], 0);
  return slots;
}

// Gunfire flashes and the unnamed effect/collision nodes are skipped; LOD nodes draw their nearest band; both reorder
// subtrees (which are also children) are drawn. TOGGLE visibility is set by code (head variants, destructible columns): of
// sibling TOGGLE nodes only the first is drawn, a lone TOGGLE is (hypothesis from the captured frames: heads Duncan, Steve
// K and Beau and Skedar Ruins' temple columns 2 and 3 match; Elvis's goggles and a damaged column differ).
const SKIPPED = new Set<number>([NODE.CHRGUNFIRE, NODE.STARGUNFIRE, NODE.TYPE0B, NODE.TYPE0D, NODE.TYPE19]);

export function drawnNodes(m: PdModel): PdNode[] {
  const dv = new DataView(m.data.buffer, m.data.byteOffset, m.data.byteLength);
  const out: PdNode[] = [];
  const visitAll = (nodes: PdNode[], depth: number) => {
    let toggle = false;
    for (const n of nodes) {
      if (n.type === NODE.TOGGLE) {
        if (toggle) continue;
        toggle = true;
      }
      visit(n, depth);
    }
  };
  const visit = (n: PdNode, depth: number) => {
    if (SKIPPED.has(n.type) || depth > 64) return;
    if (n.type === NODE.DISTANCE && n.rodata >= 0) {
      const near = dv.getFloat32(n.rodata), far = dv.getFloat32(n.rodata + 4);
      if (!(near <= 0 && far > 0)) return;
    }
    if ((n.type === NODE.DL || n.type === NODE.GUNDL) && n.rodata >= 0 && n.rodata + 0x14 <= m.data.length) out.push(n);
    visitAll(n.children, depth + 1);
  };
  visitAll(m.roots, 0);
  return out;
}

// What the game sets before a model's lists (every model draw in the 13 captured frames): geometry
// ZBUFFER|SHADE|SMOOTH|CULL_BACK, render mode G_RM_FOG_PRIM_A + AA_ZB_OPA_SURF2 for the primary list and + AA_ZB_XLU_SURF2
// for the translucent one; the lists' own B9 commands override them. Texel alpha doesn't cut out opaque lists.
const RM_OPAQUE = 0xc4112078;
const RM_TRANSLUCENT = 0xc41049d8;
// The frames' object lights: one white light (direction bytes 0x4D, 0x4D, 0x2E) and ambient 0x96 (RAM 0x80061460), used
// only by the environment-mapped parts (G_LIGHTING).
const LIGHTING: DlLighting = {
  lights: [{ color: [255, 255, 255], dir: [77 / 120.1, 77 / 120.1, 46 / 120.1] }],
  ambient: [150, 150, 150],
};

export interface ModelBatches {
  batches: Batch[];
  triangles: number;
  dlNodes: number;
  stats: PdDlStats;
}

/**
 * The drawn DL nodes of `m` as batches in model units: G_MTX loads `slots` (missing slots: identity); `transform` is
 * applied to the result (a head at its body's head spot).
 */
export function modelBatches(m: PdModel, slots: (M4 | undefined)[], textures: PdTextures, transform?: M4): ModelBatches {
  const dv = new DataView(m.data.buffer, m.data.byteOffset, m.data.byteLength);
  const out = new PdBatches();
  const stats = newDlStats();
  const dl = drawnNodes(m);
  for (const n of dl) {
    const ro = n.rodata;
    const vertices = (dv.getUint32(ro + 0x0c) >>> 24 === 5 ? dv.getUint32(ro + 0x0c) & 0xffffff : -1);
    // The colour table follows the vertices, 8-byte aligned: it then ends exactly at the node's rodata in all 2,867 DL
    // nodes, and the Attack Ship frame's segment 6 for Psk_ship_door2Z (131 vertices) is vertices + 0x628.
    const colours = n.type === NODE.DL && vertices >= 0 ? vertices + ((dv.getInt16(ro + 0x10) * 12 + 7) & ~7) : -1;
    const resolve = (addr: number) => {
      const seg = addr >>> 24, o = addr & 0xffffff;
      const at = seg === 5 ? o : seg === 4 && vertices >= 0 ? vertices + o : seg === 6 && colours >= 0 ? colours + o : -1;
      return at >= 0 && at < m.data.length ? at : -1;
    };
    for (const [list, translucent] of [[dv.getUint32(ro), false], [dv.getUint32(ro + 4), true]] as const) {
      if (list >>> 24 !== 5) continue;
      runPdDisplayList({
        buf: m.data, resolve, textures, keyPrefix: `${m.name} `, geometryMode: DEFAULT_GEOMETRY_MODE | G_CULL_BACK,
        renderMode: translucent ? RM_TRANSLUCENT : RM_OPAQUE, matrix: (slot) => slots[slot] ?? null, lighting: LIGHTING, stats,
      }, list, out);
    }
  }
  const batches = out.batches();
  if (transform) {
    const t = transform;
    for (const b of batches) {
      const p = b.positions;
      for (let k = 0; k < p.length; k += 3) {
        const x = p[k], y = p[k + 1], z = p[k + 2];
        p[k] = t[0] * x + t[4] * y + t[8] * z + t[12];
        p[k + 1] = t[1] * x + t[5] * y + t[9] * z + t[13];
        p[k + 2] = t[2] * x + t[6] * y + t[10] * z + t[14];
      }
    }
  }
  return { batches, triangles: stats.triangles, dlNodes: dl.length, stats };
}

export function meshOf(name: string, batches: Batch[], info: DebugInfo): Mesh | null {
  if (!batches.some((b) => b.positions.length)) return null;
  let radius = 0;
  for (const b of batches) for (let k = 0; k < b.positions.length; k += 3) radius = Math.max(radius, Math.hypot(b.positions[k], b.positions[k + 1], b.positions[k + 2]));
  return { name, radius, batches, info };
}

/** Where a head model attaches: the first HEADSPOT node. */
export const headSpot = (m: PdModel) => m.nodes.find((n) => n.type === NODE.HEADSPOT) ?? null;
