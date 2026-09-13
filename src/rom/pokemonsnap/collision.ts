// Height/ceiling map BSP decoding and debug geometry helpers.
import type { SnapMemory } from './fs';

export interface Patch { index: number; a: number; b: number; c: number; d: number; surface: number }
export interface Cell { poly: [number, number][]; patch: Patch }
export interface HeightMap {
  structRom: number; patchesVram: number; treeVram: number;
  nodeCount: number; patchCount: number; cells: Cell[]; surfaces: Record<string, number>;
}

function clip(poly: [number, number][], a: number, b: number, c: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const gp = a * p[0] + b * p[1] + c, gq = a * q[0] + b * q[1] + c;
    if (gp <= 0) out.push(p);
    if ((gp <= 0) !== (gq <= 0)) {
      const t = gp / (gp - gq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

export function clipToHeight(poly: [number, number][], p: Patch, min: number, max: number): [number, number][] {
  if (!p.c) return poly;
  const a = -p.a / p.c, b = -p.b / p.c, d = -p.d / p.c;
  return clip(clip(poly, a, b, d - max), -a, -b, min - d);
}

export function readHeightMap(m: SnapMemory, structRom: number, bounds: [number, number, number, number]): HeightMap {
  const struct = m.vramOfRom(structRom);
  if (struct < 0) throw new Error(`unmapped Pokémon Snap height map 0x${structRom.toString(16)}`);
  const patchesVram = m.u32(struct), treeVram = m.u32(struct + 4);
  const patches = new Map<number, Patch>();
  const getPatch = (index: number) => {
    let p = patches.get(index);
    if (!p) {
      const a = patchesVram + index * 20;
      p = { index, a: m.f32(a), b: m.f32(a + 4), c: m.f32(a + 8), d: m.f32(a + 12), surface: m.u32(a + 16) >>> 8 };
      patches.set(index, p);
    }
    return p;
  };
  const [x0, z0, x1, z1] = bounds;
  const stack: [number, [number, number][]][] = [[0, [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]]];
  const seen = new Set<number>(), cells: Cell[] = [];
  while (stack.length) {
    const [index, poly] = stack.pop()!;
    if (seen.has(index)) throw new Error(`Pokémon Snap height-map node ${index} reached twice`);
    seen.add(index);
    const a = treeVram + index * 28;
    const A = m.f32(a), B = m.f32(a + 4), C = m.f32(a + 8);
    const leftChild = m.s32(a + 12), rightChild = m.s32(a + 16), leftPatch = m.s32(a + 20), rightPatch = m.s32(a + 24);
    const right = clip(poly, A, B, C), left = clip(poly, -A, -B, -C);
    for (const [pi, child, sub] of [[rightPatch, rightChild, right], [leftPatch, leftChild, left]] as [number, number, [number, number][]][]) {
      if (pi !== -1) { if (sub.length >= 3) cells.push({ poly: sub, patch: getPatch(pi) }); }
      else if (child !== -1) stack.push([child, sub]);
    }
  }
  const surfaces: Record<string, number> = {};
  for (const p of patches.values()) {
    const key = p.surface.toString(16).padStart(6, '0');
    surfaces[key] = (surfaces[key] ?? 0) + 1;
  }
  return { structRom, patchesVram, treeVram, nodeCount: seen.size, patchCount: patches.size, cells, surfaces };
}

export function patchHeight(p: Patch, x: number, z: number): number {
  return p.c === 0 ? 0 : -(p.a * x + p.b * z + p.d) / p.c;
}

export function groundHeight(m: SnapMemory, x: number, z: number): number | null {
  const structRom = m.course.height;
  if (structRom === undefined) return null;
  const struct = m.vramOfRom(structRom), patches = m.u32(struct), tree = m.u32(struct + 4);
  let node = 0;
  for (let guard = 0; guard < 10000; guard++) {
    const a = tree + node * 28;
    const right = m.f32(a) * x + m.f32(a + 4) * z + m.f32(a + 8) <= 0;
    const patch = m.s32(a + (right ? 24 : 20)), child = m.s32(a + (right ? 16 : 12));
    if (patch !== -1) {
      const p = patches + patch * 20, c = m.f32(p + 8);
      return c === 0 ? 0 : -(m.f32(p) * x + m.f32(p + 4) * z + m.f32(p + 12)) / c;
    }
    if (child === -1) return null;
    node = child;
  }
  return null;
}
