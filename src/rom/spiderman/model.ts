import type { Batch, Instance, Level, Mesh } from '../types';
import { spiderManTable, SpiderManFs } from './fs';
import { SpiderManTextures } from './texture';

const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const u16 = (b: Uint8Array, o: number) => dv(b).getUint16(o);
const s16 = (b: Uint8Array, o: number) => dv(b).getInt16(o);
const u32 = (b: Uint8Array, o: number) => dv(b).getUint32(o);
const s32 = (b: Uint8Array, o: number) => dv(b).getInt32(o);
const f32 = (b: Uint8Array, o: number) => dv(b).getFloat32(o);

export interface ShellObject {
  index: number;
  flags: number;
  raw: [number, number, number];
  mesh: number;
  checksum: number;
}

export interface SpiderManBundle {
  slot: number;
  renderBank: number;
  objects: ShellObject[];
  meshHashes: number[];
  bank: RenderNode[];
}

interface Vertex { x: number; y: number; z: number; s: number; t: number; r: number; g: number; b: number; a: number }
interface Corner { vertex: number; s: number; t: number; matrix: number }
interface Triangle { corners: [Corner, Corner, Corner]; flags: number; texture: number | null; kind: number; source: number }
interface RenderNode { vertices: Vertex[]; visible: Triangle[]; collision: Triangle[] }

function parseShell(data: Uint8Array): { objects: ShellObject[]; meshHashes: number[] } {
  const version = u32(data, 0);
  if (version !== 0x00020003 && version !== 0x00020004 && version !== 0x00020006) throw new Error(`invalid Spider-Man model shell 0x${version.toString(16)}`);
  const count = u32(data, 8), objects: ShellObject[] = [];
  if (12 + count * 36 + 4 > data.length) throw new Error('truncated Spider-Man model shell');
  for (let i = 0; i < count; i++) {
    const o = 12 + i * 36;
    objects.push({ index: i, flags: u32(data, o), raw: [s32(data, o + 4), s32(data, o + 8), s32(data, o + 12)], mesh: u16(data, o + 22), checksum: u32(data, o + 28) });
  }
  const meshCount = u32(data, 12 + count * 36);
  let p = u32(data, 4);
  while (p + 4 <= data.length && u32(data, p) !== 0xffffffff) {
    if (p + 8 > data.length) break;
    p += 8 + u32(data, p + 4);
  }
  p += 4;
  const meshHashes = p + meshCount * 4 <= data.length ? Array.from({ length: meshCount }, (_, i) => u32(data, p + i * 4)) : [];
  return { objects, meshHashes };
}

function parseVertices(data: Uint8Array, start: number, end: number, bounds: number[]): Vertex[] {
  if (end - start < 8 || u32(data, start + 4) !== 0) return [];
  const n = u32(data, start), body = start + 8;
  if (n === 0 || body + n * 16 > end) return [];
  const read = (transposed: boolean): Vertex[] => Array.from({ length: n }, (_, i) => {
    const q = new Uint8Array(16);
    for (let k = 0; k < 16; k++) q[k] = data[body + (transposed ? k * n + i : i * 16 + k)];
    return { x: s16(q, 0), y: s16(q, 2), z: s16(q, 4), s: s16(q, 8), t: s16(q, 10), r: q[12], g: q[13], b: q[14], a: q[15] };
  });
  const plain = read(false), transposed = read(true);
  if (bounds.length < 6) return transposed;
  const error = (vs: Vertex[]) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const v of vs) { const a = [v.x, v.y, v.z]; for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a[k]); hi[k] = Math.max(hi[k], a[k]); } }
    return lo.reduce((sum, x, k) => sum + (x - bounds[k]) ** 2 + (hi[k] - bounds[k + 3]) ** 2, 0);
  };
  return error(transposed) <= error(plain) ? transposed : plain;
}

function parseTokens(data: Uint8Array, start: number, end: number, flags: number[], texture: number | null, kind: number,
  vertices: Vertex[], cache: number[], ss: number[], tt: number[], mm: number[], cursor: { value: number }): Triangle[] {
  const result: Triangle[] = []; let p = start, face = 0, matrix = 0;
  while (p < end) {
    const at = p, op = data[p];
    if (op === 0) break;
    if (op & 0x80) {
      if (p + 1 >= end) break;
      const w = (op << 8) | data[p + 1], slots = [(w >>> 10) & 31, (w >>> 5) & 31, w & 31];
      const corners = [2, 1, 0].map((j) => ({ vertex: cache[slots[j]], s: ss[slots[j]], t: tt[slots[j]], matrix: mm[slots[j]] })) as [Corner, Corner, Corner];
      if (corners.every((c) => c.vertex >= 0 && c.vertex < vertices.length)) result.push({ corners, flags: flags[face] ?? 0, texture, kind, source: at });
      face++; p += 2;
    } else if ((op & 0xe0) === 0x20) {
      if (p + 1 >= end) break;
      const w = (op << 8) | data[p + 1], n = (w & 31) || 32, v0 = (w >>> 5) & 31;
      for (let k = 0; k < n; k++) {
        if (v0 + k < 32) { cache[v0 + k] = cursor.value; mm[v0 + k] = matrix; if (cursor.value < vertices.length) { ss[v0 + k] = vertices[cursor.value].s; tt[v0 + k] = vertices[cursor.value].t; } }
        cursor.value++;
      }
      p += 2;
    } else if ((op & 0xe0) === 0x40) {
      if (p + 1 >= end) break; matrix = data[p + 1]; p += 2;
    } else if ((op & 0xe0) === 0x60) {
      if (p + 4 >= end) break; const slot = op & 31; ss[slot] = s16(data, p + 1); tt[slot] = s16(data, p + 3); p += 5;
    } else break;
  }
  return result;
}

function parseBank(data: Uint8Array): RenderNode[] {
  const safeTable = (at: number) => { try { return spiderManTable(data, at, 4); } catch { return [] as [number, number][]; } };
  return spiderManTable(data, 0, 4).map(([nodeStart, nodeEnd]) => {
    const child = safeTable(nodeStart);
    if (child.length !== 3 || child.some(([, end]) => end > nodeEnd)) return { vertices: [], visible: [], collision: [] };
    const bounds: number[] = [];
    for (let p = child[0][0]; p + 4 <= child[0][1]; p += 4) bounds.push(f32(data, p));
    const vertices = parseVertices(data, child[2][0], child[2][1], bounds);
    const groups = safeTable(child[1][0]);
    const cache = new Array(32).fill(-1), ss = new Array(32).fill(0), tt = new Array(32).fill(0), mm = new Array(32).fill(0), cursor = { value: 0 };
    const visible: Triangle[] = [], collision: Triangle[] = [];
    for (const [groupStart] of groups) {
      const parts = safeTable(groupStart);
      if (parts.length !== 3 || parts[0][1] - parts[0][0] !== 12) continue;
      const descriptor = parts[0][0], kind = u16(data, descriptor + 6), texture = kind & 1 ? u32(data, descriptor) : null;
      if (kind & 0x8000) continue;
      const fstart = parts[2][0], fend = parts[2][1], nf = fend - fstart >= 4 ? u32(data, fstart) : 0;
      const flags = Array.from({ length: Math.min(nf, Math.floor((fend - fstart - 4) / 4)) }, (_, i) => u32(data, fstart + 4 + i * 4));
      if (kind & 0x0800) {
        const lc = cache.slice(), ls = ss.slice(), lt = tt.slice(), lm = mm.slice(), lcur = { value: cursor.value };
        collision.push(...parseTokens(data, parts[1][0], parts[1][1], flags, texture, kind, vertices, lc, ls, lt, lm, lcur));
      } else visible.push(...parseTokens(data, parts[1][0], parts[1][1], flags, texture, kind, vertices, cache, ss, tt, mm, cursor));
    }
    return { vertices, visible, collision };
  });
}

export function parseBundle(fs: SpiderManFs, slot: number): SpiderManBundle {
  const file = fs.getFile(0, slot), parts = spiderManTable(file, 0, 4);
  if (parts.length !== 4) throw new Error(`Spider-Man model bundle ${slot} has ${parts.length} children`);
  const shell = parseShell(file.subarray(parts[2][0], parts[2][1]));
  // The shell copy zeros the runtime lookup checksum; the authoritative parallel
  // object array retains it at the same record offset.
  const objectStart = parts[0][0], objectCount = parts[0][1] - objectStart >= 4 ? u32(file, objectStart) : 0;
  if (objectCount === shell.objects.length && objectStart + 4 + objectCount * 36 <= parts[0][1]) {
    shell.objects.forEach((object, i) => { object.checksum = u32(file, objectStart + 4 + i * 36 + 28); });
  }
  const renderBank = u32(file, parts[3][0]);
  return { slot, renderBank, ...shell, bank: parseBank(fs.getFile(2, renderBank)) };
}

export const SPIDER_IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function placementMatrix(raw: [number, number, number], scale = 4096 * 2.25): Float32Array {
  const m = SPIDER_IDENTITY.slice(); m[12] = raw[0] / scale; m[13] = -raw[1] / scale; m[14] = -raw[2] / scale; return m;
}

interface Acc { textureSlot: number | null; lit: boolean; blendFace: boolean; cullBack: boolean; positions: number[]; uvs: number[]; colors: number[]; sources: number[] }

function objectMesh(bundle: SpiderManBundle, objectIndex: number, tris: Triangle[], textures: SpiderManTextures,
  levelTextures: Level['textures'], textureSlots: Map<number, number>, name: string, keepEngineHidden = false): Mesh | null {
  const object = bundle.objects[objectIndex], node = bundle.bank[object.mesh];
  if (!node || tris.length === 0) return null;
  const accs = new Map<string, Acc>(); let radius = 0;
  for (const tri of tris) {
    const disc = tri.flags & 0xffff, runtime = disc & 0x40 ? disc : disc ^ 0x80;
    if (!keepEngineHidden && (runtime & 0xc0) === 0) continue;
    const lit = !(tri.kind & 0x0400), blendFace = !!(tri.flags & 0x0040), cullBack = !(tri.flags & 0x0200);
    const key = `${tri.texture ?? -1}:${lit ? 1 : 0}:${blendFace ? 1 : 0}:${cullBack ? 1 : 0}`;
    let acc = accs.get(key);
    if (!acc) { acc = { textureSlot: tri.texture, lit, blendFace, cullBack, positions: [], uvs: [], colors: [], sources: [] }; accs.set(key, acc); }
    for (const corner of tri.corners) {
      const v = node.vertices[corner.vertex], matrixObject = bundle.objects[objectIndex + corner.matrix] ?? object;
      const x = v.x / 2.25 + (matrixObject.raw[0] - object.raw[0]) / (4096 * 2.25);
      const y = -v.y / 2.25 - (matrixObject.raw[1] - object.raw[1]) / (4096 * 2.25);
      const z = -v.z / 2.25 - (matrixObject.raw[2] - object.raw[2]) / (4096 * 2.25);
      acc.positions.push(x, y, z); radius = Math.max(radius, Math.hypot(x, y, z));
      let tw = 32, th = 32;
      if (tri.texture !== null) { const t = textures.get(tri.texture).texture; tw = t.width; th = t.height; }
      acc.uvs.push(corner.s / (32 * tw), corner.t / (32 * th));
      if (lit) {
        const ny = v.g >= 128 ? v.g - 256 : v.g, light = Math.max(0, Math.min(1, -ny / 127)), c = Math.round(70 + 105 * light);
        acc.colors.push(c, c, c, 255);
      } else acc.colors.push(v.r, v.g, v.b, v.a);
    }
    acc.sources.push(tri.source);
  }
  const batches: Batch[] = [];
  for (const acc of accs.values()) {
    let texture = -1, textureBlend: 'opaque' | 'cutout' | 'blend' = 'opaque';
    if (acc.textureSlot !== null) {
      let mapped = textureSlots.get(acc.textureSlot);
      if (mapped === undefined) { const decoded = textures.copy(acc.textureSlot); mapped = levelTextures.push(decoded.texture) - 1; textureSlots.set(acc.textureSlot, mapped); }
      texture = mapped; textureBlend = textures.get(acc.textureSlot).blend;
    }
    const blend = acc.blendFace ? 'blend' : textureBlend;
    batches.push({ texture, blend, depthTest: true, depthWrite: blend !== 'blend', cullBack: acc.cullBack,
      positions: new Float32Array(acc.positions), uvs: new Float32Array(acc.uvs), colors: new Uint8Array(acc.colors), triSource: new Uint32Array(acc.sources) });
  }
  return batches.length ? { name, radius, batches, info: { modelSlot: bundle.slot, renderBank: bundle.renderBank, shellObject: object.index, meshIndex: object.mesh, checksum: `0x${object.checksum.toString(16).padStart(8, '0')}` } } : null;
}

export interface AppendedBundle {
  visibleInstances: number[];
  collisionInstances: number[];
  byChecksum: Map<number, number[]>;
}

/** Add one shell object at a time, preserving checksum/object provenance and collision separation. */
export function appendBundle(level: Pick<Level, 'textures' | 'meshes' | 'instances'>, textures: SpiderManTextures, bundle: SpiderManBundle,
  label: string, options: { objects?: number[]; background?: boolean; visible?: boolean; collision?: boolean } = {}): AppendedBundle {
  const objectIndices = options.objects ?? bundle.objects.map((_, i) => i), textureSlots = new Map<number, number>();
  // Reuse textures already emitted by earlier bundles through their source slot.
  for (let i = 0; i < level.textures.length; i++) { const m = /^Spider-Man texture (\d+)/.exec(level.textures[i].source ?? ''); if (m) textureSlots.set(+m[1], i); }
  const visibleInstances: number[] = [], collisionInstances: number[] = [], byChecksum = new Map<number, number[]>();
  for (const oi of objectIndices) {
    const object = bundle.objects[oi], node = object && bundle.bank[object.mesh]; if (!object || !node) continue;
    if (options.visible !== false) {
      const classes: { suffix: string; tris: Triangle[]; noFog: boolean }[] = options.background
        ? [{ suffix: '', tris: node.visible, noFog: true }]
        : [{ suffix: ' textured', tris: node.visible.filter((t) => t.texture !== null), noFog: false },
          { suffix: ' untextured', tris: node.visible.filter((t) => t.texture === null), noFog: true }];
      for (const cls of classes) {
        const mesh = objectMesh(bundle, oi, cls.tris, textures, level.textures, textureSlots, `${label} object ${oi}${cls.suffix}`);
        if (!mesh) continue;
        const mi = level.meshes.push(mesh) - 1;
        const ii = level.instances.push({ name: mesh.name, mesh: mi, matrix: placementMatrix(object.raw, options.background ? 4096 * 16 : 4096 * 2.25),
          ...(cls.noFog ? { noFog: true } : {}), info: { ...mesh.info, role: options.background ? 'background' : label } }) - 1;
        visibleInstances.push(ii);
        for (const checksum of new Set([object.checksum, bundle.meshHashes[object.mesh]].filter((x): x is number => x !== undefined && x !== 0))) {
          const list = byChecksum.get(checksum) ?? []; list.push(ii); byChecksum.set(checksum, list);
        }
      }
    }
    if (options.collision !== false) {
      const mesh = objectMesh(bundle, oi, node.collision, textures, level.textures, textureSlots, `${label} object ${oi} kind-0x0800`, true);
      if (mesh) {
        const mi = level.meshes.push(mesh) - 1;
        collisionInstances.push(level.instances.push({ name: mesh.name, mesh: mi, matrix: placementMatrix(object.raw), noFog: true,
          info: { ...mesh.info, role: 'collision candidate', descriptorKind: '0x0800' } }) - 1);
      }
    }
  }
  return { visibleInstances, collisionInstances, byChecksum };
}
