// GoldenEye 007 models: props (P*Z), characters and heads (C*Z) as meshes in their rest pose (docs/GOLDENEYE.md §4.5-§4.7).
//
// The ModelFileHeader lives in the data segment (+0C s16 numSwitches, +0E s16 numMatrices, +16 s16 numTextures). The
// file holds numSwitches u32 slots and numTextures 12-byte texture records, then the nodes, rodata, vertices and display
// lists; pointers are 0x05000000 + file offset. The lists load the model's matrix slots as segment 3 (G_MTX 01020040
// 030000xx = slot xx / 0x40, each slot a model-space matrix) and address a DL node's vertices as segment 4.
//
// Node, 0x18 bytes: u16 type (low byte); ptr rodata; ptr parent; ptr next; ptr prev; ptr child.
import { mergeBatches } from '../bomberman/common';
import { type DlLighting, runDisplayList } from '../displaylist';
import type { Batch, DebugInfo, Mesh, Texture } from '../types';
import { reverseWinding } from './bg';
import type { Box } from './place';
import type { GeRom } from './rom';
import type { Vec3 } from './setup';
import type { GeTextures } from './textures';

const PROP_TABLE = 0x8003a228; // 340 x {ModelFileHeader* header; char* file; f32 scale}
export const PROP_COUNT = 340;
// 80 x 0x14 {header; file; f32 scale; f32 scale2 (hypothesis: eye height); u8 male; u8 own head (both hypotheses from
// the names); u16}: 0x00-0x28 bodies, 0x29 a hand, 0x2A-0x4E heads, 0x4F CspicebondZ (Natalya's jungle body).
const CHR_TABLE = 0x8003de10;
export const CHR_COUNT = 80;
const HEADS_FIRST = 0x2a;
const HEADS_END = 0x4f;
// s32 head numbers, each list ending in -1 (hypothesis: the heads the game picks from at random for guards): the 25
// generic male faces, then the four female ones.
const MALE_HEADS = 0x8002cdb8;
const FEMALE_HEADS = 0x8002ce20;

export type M4 = Float64Array; // column-major 4x4

export interface ModelRef {
  index: number; // prop or character table index
  file: string;
  header: number; // ModelFileHeader address
  scale: number;
  male: boolean; // characters
}

export function propRef(r: GeRom, index: number): ModelRef | null {
  if (!(index >= 0 && index < PROP_COUNT)) return null;
  const a = PROP_TABLE + index * 12, header = r.u32(a), name = r.u32(a + 4);
  if (!r.inData(header) || !r.inData(name)) return null;
  return { index, file: r.str(name), header, scale: r.f32(a + 8), male: true };
}

export function chrRef(r: GeRom, index: number): ModelRef | null {
  if (!(index >= 0 && index < CHR_COUNT)) return null;
  const a = CHR_TABLE + index * 0x14, header = r.u32(a), name = r.u32(a + 4);
  if (!r.inData(header) || !r.inData(name)) return null;
  return { index, file: r.str(name), header, scale: r.f32(a + 8), male: r.u8(a + 0x10) !== 0 };
}

export const isHead = (index: number) => index >= HEADS_FIRST && index < HEADS_END;

/** A stand-in for the head the game picks at random: a fixed choice by `seed` among male or female heads. */
export function randomHead(r: GeRom, male: boolean, seed: number): number {
  const list: number[] = [];
  for (let a = male ? MALE_HEADS : FEMALE_HEADS; list.length < 64 && isHead(r.s32(a)); a += 4) list.push(r.s32(a));
  return list.length ? list[seed % list.length] : -1;
}

interface ModelNode {
  offset: number;
  type: number;
  next: number; // file offsets, -1 = none
  child: number;
  pos?: Vec3; // position nodes (0x02, 0x15)
  joint?: number;
  slot?: number; // the matrix slot the position node fills
  extraSlots?: number[]; // joint-blend slots (rodata +0x10/+0x12), which equal the node's matrix in a static pose
  box?: Box; // 0x0A
  dl?: { primary: number; secondary: number; vertices: number; mode: number }; // 0x18, 0x04
  near?: number; // 0x08 LOD
  targets?: number[]; // LOD, toggle and reorder children
}

export interface ModelFile {
  ref: ModelRef;
  data: Uint8Array;
  rom: number; // ROM offset of the (compressed) file
  numMatrices: number;
  root: number;
  nodes: Map<number, ModelNode>;
  nodeCount: number;
  box?: Box; // placement box (0x7F03FFF8)
}

function parseModel(r: GeRom, ref: ModelRef): ModelFile {
  const data = r.load(ref.file);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const numSwitches = r.s16(ref.header + 0xc), numMatrices = r.s16(ref.header + 0xe), numTextures = r.s16(ref.header + 0x16);
  const root = numSwitches * 4 + numTextures * 12;
  const ptr = (o: number) => {
    const p = dv.getUint32(o);
    return p >>> 24 === 5 && (p & 0xffffff) < data.length ? p & 0xffffff : -1;
  };
  const nodes = new Map<number, ModelNode>();
  const stack = [root];
  while (stack.length) {
    const o = stack.pop()!;
    if (o < 0 || nodes.has(o) || o + 0x18 > data.length) continue;
    const n: ModelNode = { offset: o, type: data[o + 1], next: ptr(o + 12), child: ptr(o + 20) };
    const ro = ptr(o + 4);
    const f = (k: number) => dv.getFloat32(ro + k);
    if (ro >= 0) {
      switch (n.type) {
        case 0x02:
          n.pos = [f(0), f(4), f(8)];
          n.joint = dv.getInt16(ro + 0xc);
          n.slot = dv.getInt16(ro + 0xe);
          n.extraSlots = [dv.getInt16(ro + 0x10), dv.getInt16(ro + 0x12)].filter((s) => s >= 0);
          break;
        case 0x15:
          n.pos = [f(0), f(4), f(8)];
          n.slot = dv.getInt16(ro + 0xc);
          break;
        case 0x0a:
          n.box = { min: [f(4), f(0xc), f(0x14)], max: [f(8), f(0x10), f(0x18)] };
          break;
        case 0x18:
          n.dl = { primary: ptr(ro), secondary: ptr(ro + 4), vertices: Math.max(0, ptr(ro + 8)), mode: dv.getInt16(ro + 0x18) };
          break;
        case 0x04: // gun DL: vertices addressed by file offset
          n.dl = { primary: ptr(ro), secondary: ptr(ro + 4), vertices: 0, mode: data[ro + 0x12] };
          break;
        case 0x08:
          n.near = f(0);
          n.targets = [ptr(ro + 8)];
          break;
        case 0x12:
          n.targets = [ptr(ro)];
          break;
        case 0x09:
          n.targets = [ptr(ro + 0x18), ptr(ro + 0x1c)];
          break;
      }
    }
    nodes.set(o, n);
    stack.push(n.next, n.child, ...(n.targets ?? []));
  }
  // The placement box: the first 0x0A node among the root's children, else among its first child's children.
  const boxAmong = (first: number) => {
    for (let c = first, k = 0; c >= 0 && k < 1000; c = nodes.get(c)?.next ?? -1, k++) if (nodes.get(c)?.box) return nodes.get(c)!.box;
    return undefined;
  };
  const top = nodes.get(root);
  const box = top ? (boxAmong(top.child) ?? (top.child >= 0 ? boxAmong(nodes.get(top.child)?.child ?? -1) : undefined)) : undefined;
  const file = r.file(ref.file)!;
  return { ref, data, rom: file.rom, numMatrices, root, nodes, nodeCount: nodes.size, ...(box ? { box } : {}) };
}

const modelCache = new WeakMap<GeRom, Map<number, ModelFile | null>>();

/** A parsed model file (cached per ROM), or null when the file is missing or doesn't parse. */
export function loadModel(r: GeRom, ref: ModelRef | null): ModelFile | null {
  if (!ref) return null;
  let cache = modelCache.get(r);
  if (!cache) modelCache.set(r, (cache = new Map()));
  let m = cache.get(ref.header);
  if (m === undefined) {
    try {
      m = r.hasFile(ref.file) ? parseModel(r, ref) : null;
    } catch {
      m = null;
    }
    cache.set(ref.header, m);
  }
  return m;
}

export const IDENTITY: M4 = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function mul(a: M4, b: M4): M4 {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let t = 0;
      for (let k = 0; k < 4; k++) t += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = t;
    }
  }
  return o;
}

/** Joint id (position node rodata +0x0C) → local rotation. */
export type Pose = Map<number, M4>;

// A standing guard: local joint rotations sampled from a Cgreatguard2Z guard drawn in the Dam capture (the animation
// data isn't decoded; §4.7). Joint 1 (the root) is the identity. Values: the 3x3 rotation's columns.
const STANDING: Record<number, number[]> = {
  2: [0.956, 0.1339, -0.26121, -0.0985, 0.98447, 0.14535, 0.27653, -0.1136, 0.9542],
  3: [0.98841, -0.13531, -0.0687, 0.14374, 0.98045, 0.13421, 0.04996, -0.14235, 0.98859],
  4: [0.32256, -0.94447, -0.06264, 0.81687, 0.24357, 0.52298, -0.47834, -0.21974, 0.85017],
  5: [0.5077, 0.83185, -0.22419, -0.4108, 0.46315, 0.78517, 0.7571, -0.30669, 0.57704],
  6: [0.14603, 0.19721, 0.96947, 0.01337, 0.97962, -0.20016, -0.98925, 0.04127, 0.1403],
  7: [-0.26155, 0.18073, -0.94808, 0.09752, 0.98232, 0.16016, 0.96022, -0.04945, -0.27474],
  8: [0.89527, 0.43363, -0.1056, 0.24869, -0.68121, -0.68825, -0.36954, 0.58985, -0.71781],
  9: [0.97406, 0.07778, 0.21285, 0.04283, 0.86089, -0.50662, -0.22158, 0.50324, 0.83538],
  10: [0.12463, -0.96016, 0.25041, 0.91217, 0.01082, -0.40997, 0.39043, 0.27919, 0.87706],
  11: [0.029, 0.99956, 0.00464, -0.96464, 0.02698, 0.26253, 0.26185, -0.01234, 0.96495],
  12: [0.4243, 0.14091, -0.89452, -0.03971, 0.98979, 0.13659, 0.90456, -0.02243, 0.42578],
  13: [0.98042, 0.03271, 0.19418, -0.03098, 0.99943, -0.01332, -0.19509, 0.00666, 0.98076],
  14: [0.97114, -0.05249, 0.23243, 0.05632, 0.99837, -0.0106, -0.23218, 0.02324, 0.97244],
  15: [0.9879, -0.07153, -0.13834, 0.05419, 0.99056, -0.1263, 0.14505, 0.11663, 0.98238],
};
export const STANDING_POSE: Pose = new Map(
  Object.entries(STANDING).map(([joint, c]) => [Number(joint), new Float64Array([c[0], c[1], c[2], 0, c[3], c[4], c[5], 0, c[6], c[7], c[8], 0, 0, 0, 0, 1])]),
);

export interface ModelWalk {
  base: M4; // the frame the model is attached to (slots no position node fills, e.g. every slot of a head, use it)
  slots: M4[]; // matrix slot → matrix from the slot's space to the walk's base space
  dlNodes: ModelNode[]; // drawn DL nodes, in draw order
  headSpots: M4[]; // frames of head-spot nodes (0x17), where a separate head model attaches
}

/**
 * The drawn nodes and matrix slots of a model: position nodes are relative to the enclosing position node, the root
 * position node's translation is not applied (§4.7), only the nearest LOD (near = 0) is drawn, toggles and both
 * reorder children are drawn, gunfire and effect nodes are skipped. `pose` adds joint rotations.
 */
export function walkModel(m: ModelFile, base: M4 = IDENTITY, pose?: Pose): ModelWalk {
  const slots: M4[] = [], dlNodes: ModelNode[] = [], headSpots: M4[] = [];
  const seen = new Set<number>();
  const visit = (start: number, parent: M4, rootLevel: boolean) => {
    for (let cur = start; cur >= 0 && !seen.has(cur); ) {
      const n = m.nodes.get(cur);
      if (!n) return;
      seen.add(cur);
      let mat = parent, below = rootLevel;
      if (n.pos) {
        if (!rootLevel) mat = mul(mat, new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, n.pos[0], n.pos[1], n.pos[2], 1]));
        const rot = n.joint !== undefined ? pose?.get(n.joint) : undefined;
        if (rot) mat = mul(mat, rot);
        if (n.slot !== undefined && n.slot >= 0) slots[n.slot] = mat;
        for (const s of n.extraSlots ?? []) if (!slots[s]) slots[s] = mat;
        below = false;
      }
      switch (n.type) {
        case 0x04:
        case 0x18:
          dlNodes.push(n);
          visit(n.child, mat, below);
          break;
        case 0x08:
          if (n.near === 0) visit(n.targets?.[0] ?? -1, mat, below);
          break;
        case 0x12:
          visit(n.targets?.[0] ?? -1, mat, below);
          break;
        case 0x09:
          for (const t of n.targets ?? []) visit(t, mat, false);
          break;
        case 0x0c: // gunfire
        case 0x0d: // effect
        case 0x16: // star gunfire
          break;
        case 0x17:
          headSpots.push(mat);
          visit(n.child, mat, below);
          break;
        default:
          visit(n.child, mat, below);
      }
      cur = n.next;
    }
  };
  visit(m.root, base, true);
  return { base, slots, dlNodes, headSpots };
}

// Environment-mapped parts (B7 0x60000) are lit by the RSP; the game's lights for objects aren't decoded, so they get
// a neutral light.
const LIGHTING: DlLighting = { lights: [{ color: [96, 96, 96], dir: [0.408, 0.816, 0.408] }], ambient: [160, 160, 160] };
// Render modes the game sets before a node's lists (§4.6; verified in the frame lists of 15 captures): primary lists
// opaque (AA_ZB_OPA_SURF c4112078: texel alpha is ignored, so I4/I8 textures are solid), secondary lists of mode-4 nodes
// in the translucent pass (XLU_SURF c41049d8). The lists' own B9 commands (decals, translucent parts) override them. No
// capture draws an object with coverage-times-alpha or alpha compare, so models have no cutout batches.
const RM_PRIMARY = 0x0030; // Z_CMP | Z_UPD
const RM_TRANSLUCENT = 0x4810; // Z_CMP | ZMODE_XLU | FORCE_BL

/** The byte offset where modelBatches appends the matrix slots to the file (for triSource). */
export const slotsOffset = (m: ModelFile) => (m.data.length + 7) & ~7;

/** Triangles of the walked DL nodes in model units (the walk's base space), wound counter-clockwise. */
export function modelBatches(m: ModelFile, walk: ModelWalk, textures: GeTextures): Batch[] {
  const mtxAt = slotsOffset(m);
  const count = Math.max(1, m.numMatrices, walk.slots.length);
  const buf = new Uint8Array(mtxAt + count * 64);
  buf.set(m.data);
  const dv = new DataView(buf.buffer);
  // N64 fixed-point Mtx: 16 s16 integer parts, then 16 u16 fractions, in G_MTX's element order.
  for (let s = 0; s < count; s++) {
    const mat = walk.slots[s] ?? walk.base;
    for (let i = 0; i < 16; i++) {
      const v = Math.max(-0x7fffffff, Math.min(0x7fffffff, Math.round(mat[i] * 65536)));
      dv.setInt16(mtxAt + s * 64 + i * 2, v >> 16);
      dv.setUint16(mtxAt + s * 64 + 32 + i * 2, v & 0xffff);
    }
  }
  let vertices = 0;
  const resolve = (addr: number) => {
    const seg = addr >>> 24, o = addr & 0xffffff;
    const at = seg === 3 ? mtxAt + o : seg === 4 ? vertices + o : seg === 5 ? o : -1;
    return at >= 0 && at < buf.length ? at : -1;
  };
  const matrix = Array.from(walk.slots[0] ?? walk.base);
  const out: Batch[] = [];
  for (const n of walk.dlNodes) {
    const dl = n.dl!;
    vertices = dl.vertices;
    for (const [start, translucent] of [[dl.primary, false], [dl.secondary, dl.mode === 4]] as const) {
      if (start < 0) continue;
      const batches = runDisplayList({
        buf, ucode: 'f3d', resolve, textures: textures.textures, textureKeys: new Map(), keyPrefix: '', rareTexture: textures.rareTexture,
        vertexScale: 1, mirrorX: false, decals: true, matrix, lighting: LIGHTING, textureGen: true,
        renderMode: translucent ? RM_TRANSLUCENT : RM_PRIMARY,
      }, 0x05000000 | start);
      for (const b of batches) reverseWinding(b);
      out.push(...batches);
    }
  }
  return out;
}

/** A character: the body in the standing pose, with the head model attached at its head spot. */
export function characterBatches(body: ModelFile, head: ModelFile | null, textures: GeTextures): Batch[] {
  const walk = walkModel(body, IDENTITY, STANDING_POSE);
  const out = modelBatches(body, walk, textures);
  if (head && walk.headSpots.length) out.push(...modelBatches(head, walkModel(head, walk.headSpots[0]), textures));
  return out;
}

export const hasHeadSpot = (m: ModelFile) => [...m.nodes.values()].some((n) => n.type === 0x17);

export function modelMesh(name: string, batches: Batch[], info: DebugInfo): Mesh | null {
  const merged = mergeBatches(batches);
  if (!merged.length) return null;
  let radius = 0;
  for (const b of merged) for (let k = 0; k < b.positions.length; k += 3) radius = Math.max(radius, Math.hypot(b.positions[k], b.positions[k + 1], b.positions[k + 2]));
  return { name, radius, batches: merged, info };
}
