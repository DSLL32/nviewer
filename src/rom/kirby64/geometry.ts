import { runDisplayList, type DlLighting } from '../displaylist';
import type { Level, Mesh } from '../types';
import { f32, KirbyArchive, u16, u32 } from './fs';
import type { Extent, LayoutNode } from './types';

type Mtx = number[];

export interface ModelPart {
  mesh: number;
  matrix: Mtx;
  node: number;
  flags: number;
}

export interface DecodedModel {
  id: number;
  name: string;
  mode: number;
  parts: ModelPart[];
  layoutCount: number;
  fogColor: [number, number, number] | null;
}

const IDENTITY: Mtx = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const MATERIAL_TABLE = 0x1f00000;
const MATERIAL_LISTS = 0x1f10000;
const LIGHTING: DlLighting = {
  lights: [{ color: [150, 150, 150], dir: [0.42, 0.76, 0.49] }],
  ambient: [105, 105, 105],
};
const TEXTURE_KEYS = new WeakMap<Level, Map<string, number>>();

function write32(buf: Uint8Array, at: number, value: number): void {
  new DataView(buf.buffer, buf.byteOffset + at, 4).setUint32(0, value >>> 0);
}

function command(buf: Uint8Array, cursor: { at: number }, w0: number, w1: number): void {
  write32(buf, cursor.at, w0);
  write32(buf, cursor.at + 4, w1);
  cursor.at += 8;
}

function segOffset(pointer: number): number {
  return pointer & 0x00ffffff;
}

function blockAddress(extent: Extent, pointer: number): number {
  if (!pointer || pointer >>> 24 !== 4 || segOffset(pointer) >= extent.end - extent.start) return -1;
  return extent.start + segOffset(pointer);
}

function list999(rom: Uint8Array, extent: Extent, pointer: number): number[] {
  const at = blockAddress(extent, pointer);
  if (at < 0) return [];
  const out: number[] = [];
  for (let p = at, count = 0; p + 4 <= extent.end && count < 0x10000; p += 4, count++) {
    const value = u32(rom, p);
    if (value === 0x99999999) return out;
    out.push(value);
  }
  throw new Error(`Kirby 64: unterminated material list in geometry ${extent.bank}:${extent.index}`);
}

function materialPointers(rom: Uint8Array, extent: Extent, textureGraph: number, node: number): number[] {
  const main = list999(rom, extent, textureGraph);
  if (node >= main.length || !main[node] || main[node] === 0x99999999) return [];
  return list999(rom, extent, main[node]).filter((p) => p !== 0 && p !== 0x99999999);
}

function materialImages(rom: Uint8Array, extent: Extent, pointer: number): number[] {
  return list999(rom, extent, pointer).filter((id) => id !== 0 && id !== 0x99999999);
}

function f(rom: Uint8Array, at: number): number {
  const value = f32(rom, at);
  return Number.isFinite(value) ? value : 0;
}

function synthesizeMaterials(archive: KirbyArchive, extent: Extent, pointers: number[]): void {
  const { work: rom } = archive;
  let payload = MATERIAL_LISTS;
  pointers.forEach((pointer, index) => {
    const m = blockAddress(extent, pointer);
    if (m < 0 || m + 0x78 > extent.end) return;
    write32(rom, MATERIAL_TABLE + index * 8, 0xde010000);
    write32(rom, MATERIAL_TABLE + index * 8 + 4, 0x0f000000 | (payload - MATERIAL_LISTS));
    const cursor = { at: payload };
    let flags = u16(rom, m + 0x30);
    if (!flags) flags = 0x00a1;
    const images = materialImages(rom, extent, u32(rom, m + 4));
    const palettes = materialImages(rom, extent, u32(rom, m + 0x2c));
    const fmt0 = rom[m + 2], siz0 = rom[m + 3], fmt1 = rom[m + 0x32], siz1 = rom[m + 0x33];
    const tex0 = images[0] ?? 0, tex1 = images[0] ?? 0, palette = palettes[0] ?? 0;

    if ((flags & 4) && palette) {
      command(rom, cursor, 0xfd100000, palette);
      command(rom, cursor, 0xe8000000, 0);
      command(rom, cursor, 0xf5000100, 0x05000000);
      command(rom, cursor, 0xe6000000, 0);
      command(rom, cursor, 0xf0000000, 0x05000000 | ((siz0 === 1 ? 0xff : 0x0f) << 14));
      command(rom, cursor, 0xe7000000, 0);
    }
    if (flags & 0x1000) {
      command(rom, cursor, 0xdb0a0000, u32(rom, m + 0x60));
      command(rom, cursor, 0xdb0a0004, u32(rom, m + 0x60));
    }
    if (flags & 0x2000) {
      command(rom, cursor, 0xdb0a0018, u32(rom, m + 0x64));
      command(rom, cursor, 0xdb0a001c, u32(rom, m + 0x64));
    }
    if (flags & 0x218) command(rom, cursor, 0xfa000000 | (rom[m + 0x55] << 8) | rom[m + 0x4c], u32(rom, m + 0x50));
    if (flags & 0x400) command(rom, cursor, 0xfb000000, u32(rom, m + 0x58));
    if (flags & 0x800) command(rom, cursor, 0xf9000000, u32(rom, m + 0x5c));

    if ((flags & 0x12) && tex1) {
      const actualSiz = siz1 === 3 ? 3 : 2;
      command(rom, cursor, 0xfd000000 | ((fmt1 & 7) << 21) | ((actualSiz & 3) << 19), tex1);
      if (flags & 0x11) {
        command(rom, cursor, 0xe6000000, 0);
        const width = u16(rom, m + 0x34), height = u16(rom, m + 0x36);
        const bits = [4, 8, 16, 32][siz1] ?? 16;
        const texels = Math.max(1, width * height);
        const lrs = Math.min(0x7ff, Math.ceil(texels * bits / 8 / 8) - 1);
        const wordsPerLine = Math.max(1, Math.ceil(width * bits / 64));
        const dxt = Math.ceil(0x800 / wordsPerLine) & 0xfff;
        command(rom, cursor, 0xf3000000, 0x06000000 | ((lrs & 0xfff) << 12) | dxt);
        command(rom, cursor, 0xe6000000, 0);
      }
    }
    if ((flags & 0x11) && tex0) command(rom, cursor, 0xfd000000 | ((fmt0 & 7) << 21) | ((siz0 & 3) << 19), tex0);

    let xScale = f(rom, m + 0x1c), yScale = f(rom, m + 0x20);
    let x0 = f(rom, m + 0x14), y0 = f(rom, m + 0x18), x1 = f(rom, m + 0x3c), y1 = f(rom, m + 0x40);
    if (u32(rom, m + 0x10)) {
      xScale *= 0.5;
      const adjust = f(rom, m + 0x28) * 0.5;
      x0 = ((x0 - f(rom, m + 0x24) + 1) - adjust) * 0.5;
      x1 = ((x1 - f(rom, m + 0x44) + 1) - adjust) * 0.5;
    }
    const shared = u16(rom, m + 0x0a);
    const tileSize = (tile: number, widthAt: number, heightAt: number, px: number, py: number) => {
      const width = u16(rom, m + widthAt), height = u16(rom, m + heightAt);
      const ulS = Math.trunc(xScale ? ((width * px + shared) / xScale) * 4 : 0) & 0xfff;
      const ulT = Math.trunc(yScale ? ((((1 - yScale) - py) * height + shared) / yScale) * 4 : 0) & 0xfff;
      const lrS = (ulS + Math.max(0, width - 1) * 4) & 0xfff;
      const lrT = (ulT + Math.max(0, height - 1) * 4) & 0xfff;
      command(rom, cursor, 0xf2000000 | (ulS << 12) | ulT, (tile << 24) | (lrS << 12) | lrT);
    };
    if (flags & 0x20) tileSize(0, 0x0c, 0x0e, x0, y0);
    if (flags & 0x40) tileSize(1, 0x38, 0x3a, x1, y1);
    if (flags & 0x80) {
      const stretch = u16(rom, m + 8) || 1;
      const ss = Math.min(0xffff, Math.max(0, Math.trunc(2097152 / stretch / (xScale || 1))));
      const st = Math.min(0xffff, Math.max(0, Math.trunc(2097152 / stretch / (yScale || 1))));
      command(rom, cursor, 0xd7000002, (ss << 16) | st);
    }
    command(rom, cursor, 0xdf000000, 0);
    payload = cursor.at;
    if (payload >= 0x1ff0000) throw new Error('Kirby 64: material command arena overflow');
  });
}

export function rpyMatrix(pos: [number, number, number], rot: [number, number, number], scale: [number, number, number]): Mtx {
  const [r, p, h] = rot, sr = Math.sin(r), cr = Math.cos(r), sp = Math.sin(p), cp = Math.cos(p), sh = Math.sin(h), ch = Math.cos(h);
  return [
    cp * ch * scale[0], cp * sh * scale[0], -sp * scale[0], 0,
    (sr * sp * ch - cr * sh) * scale[1], (sr * sp * sh + cr * ch) * scale[1], sr * cp * scale[1], 0,
    (cr * sp * ch + sr * sh) * scale[2], (cr * sp * sh - sr * ch) * scale[2], cr * cp * scale[2], 0,
    pos[0], pos[1], pos[2], 1,
  ];
}

export function multiplyMatrix(a: Mtx, b: Mtx): Mtx {
  const out = new Array<number>(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) out[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
  return out;
}

export function instanceMatrix(matrix: Mtx): Float32Array {
  const out = matrix.slice();
  for (const i of [1, 2, 4, 8, 12]) out[i] = -out[i];
  return new Float32Array(out);
}

function payloadRoots(rom: Uint8Array, extent: Extent, mode: number, entry: number): number[] {
  const at = blockAddress(extent, entry);
  if (at < 0) return [];
  if (mode === 0x17 || mode === 0x13) return [entry];
  if (mode === 0x1b) return [u32(rom, at), u32(rom, at + 4)].filter(Boolean);
  const roots: number[] = [], stride = mode === 0x1c ? 12 : 8;
  for (let p = at, count = 0; p + stride <= extent.end && count < 0x10000; p += stride, count++) {
    if (u32(rom, p) === 4) return roots;
    if (mode === 0x1c) {
      for (const value of [u32(rom, p + 4), u32(rom, p + 8)]) if (value) roots.push(value);
    } else {
      const value = u32(rom, p + 4);
      if (value) roots.push(value);
    }
  }
  return roots;
}

// Kirby frequently authors a very large tile window and relies on the RDP's
// mask fields for the effective sampled image. The shared decoder represents
// one GPU texture per window, so reduce an oversized window to its exact mask
// period. UV normalization changes by the same factor and preserves sampling.
function normalizeTileWindows(rom: Uint8Array, extent: Extent, roots: number[]): void {
  const pending = [...roots], visited = new Set<number>();
  while (pending.length) {
    const pointer = pending.pop()!, start = blockAddress(extent, pointer);
    if (start < 0 || visited.has(start)) continue;
    visited.add(start);
    const masks = Array.from({ length: 8 }, () => ({ s: 0, t: 0 }));
    const sizes = new Array<number>(8).fill(-1);
    const applyMask = (pc: number, mask: { s: number; t: number }) => {
      if (pc < 0) return;
      const w0 = u32(rom, pc), w1 = u32(rom, pc + 4);
      const uls = (w0 >>> 12) & 0xfff, ult = w0 & 0xfff;
      let lrs = (w1 >>> 12) & 0xfff, lrt = w1 & 0xfff;
      if (mask.s) lrs = Math.min(lrs, uls + (1 << mask.s) * 4 - 4);
      if (mask.t) lrt = Math.min(lrt, ult + (1 << mask.t) * 4 - 4);
      write32(rom, pc + 4, (w1 & 0xff000000) | ((lrs & 0xfff) << 12) | (lrt & 0xfff));
    };
    for (let pc = start, steps = 0; pc + 8 <= extent.end && steps < 0x10000; pc += 8, steps++) {
      const w0 = u32(rom, pc), w1 = u32(rom, pc + 4), op = w0 >>> 24;
      if (op === 0xf5) {
        const tile = (w1 >>> 24) & 7;
        masks[tile] = { s: (w1 >>> 4) & 0xf, t: (w1 >>> 14) & 0xf };
        // Once a nonzero mask is active, RDP coordinate masking supplies the
        // repeated period seen at runtime. Express that effective sampling to
        // the viewer, whose generic texture path has no mask fields of its own.
        let effective = w1;
        if (masks[tile].s) effective &= ~(2 << 8);
        if (masks[tile].t) effective &= ~(2 << 18);
        if (effective !== w1) write32(rom, pc + 4, effective);
        // The generated material setup normally emits G_SETTILESIZE before
        // the render-tile G_SETTILE. Its following mask is the effective
        // sampling period, not whichever mask the previous material left.
        applyMask(sizes[tile], masks[tile]);
        sizes[tile] = -1;
      } else if (op === 0xf2) {
        const tile = (w1 >>> 24) & 7, mask = masks[tile];
        applyMask(sizes[tile], mask);
        sizes[tile] = pc;
      } else if (op === 0xde) {
        if (w1 >>> 24 === 4) pending.push(w1);
        if (w0 & 0x00010000) break;
      } else if (op === 0xe1 && w1 >>> 24 === 4) pending.push(w1);
      else if (op === 0xdf) break;
    }
    sizes.forEach((pc, tile) => applyMask(pc, masks[tile]));
  }
}

function reachableFogColor(rom: Uint8Array, extent: Extent, roots: number[]): [number, number, number] | null {
  const pending = [...roots], visited = new Set<number>();
  while (pending.length) {
    const start = blockAddress(extent, pending.pop()!);
    if (start < 0 || visited.has(start)) continue;
    visited.add(start);
    for (let pc = start, steps = 0; pc + 8 <= extent.end && steps < 0x10000; pc += 8, steps++) {
      const w0 = u32(rom, pc), w1 = u32(rom, pc + 4), op = w0 >>> 24;
      if (op === 0xf8) return [w1 >>> 24, (w1 >>> 16) & 0xff, (w1 >>> 8) & 0xff];
      if (op === 0xde) {
        if (w1 >>> 24 === 4) pending.push(w1);
        if (w0 & 0x00010000) break;
      } else if (op === 0xdf) break;
    }
  }
  return null;
}

function readLayouts(rom: Uint8Array, extent: Extent, pointer: number, count: number): LayoutNode[] {
  const start = blockAddress(extent, pointer), out: LayoutNode[] = [], lastAtDepth: number[] = [];
  if (start < 0) return out;
  for (let index = 0; index < count; index++) {
    const at = start + index * 0x2c, command = u16(rom, at + 2), depth = command & 0x0fff;
    if (at + 0x2c > extent.end || depth === 0x12) break;
    const node: LayoutNode = {
      index, depth, flags: command & 0xf000, parent: depth ? (lastAtDepth[depth - 1] ?? -1) : -1,
      entry: u32(rom, at + 4),
      translation: [f32(rom, at + 8), f32(rom, at + 0xc), f32(rom, at + 0x10)],
      rotation: [f32(rom, at + 0x14), f32(rom, at + 0x18), f32(rom, at + 0x1c)],
      scale: [f32(rom, at + 0x20), f32(rom, at + 0x24), f32(rom, at + 0x28)],
    };
    out.push(node);
    lastAtDepth[depth] = index;
  }
  return out;
}

export function decodeGeometry(archive: KirbyArchive, level: Level, id: number, name: string): DecodedModel {
  const extent = archive.member('geometry', id), rom = archive.work;
  const layout = u32(rom, extent.start), textureGraph = u32(rom, extent.start + 4), mode = u32(rom, extent.start + 8);
  const count = u32(rom, extent.start + 0x1c);
  const layouts = mode === 0x13 || mode === 0x14 ? [{
    index: 0, depth: 0, flags: 0, parent: -1, entry: layout,
    translation: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number],
  }] : readLayouts(rom, extent, layout, count);
  const worlds: Mtx[] = [];
  layouts.forEach((node, i) => {
    const local = rpyMatrix(node.translation, node.rotation, node.scale);
    worlds[i] = node.parent >= 0 ? multiplyMatrix(local, worlds[node.parent]) : local;
  });
  const parts: ModelPart[] = [];
  let fogColor: [number, number, number] | null = null;
  for (const node of layouts) {
    const roots = payloadRoots(rom, extent, mode, node.entry);
    if (!roots.length) continue;
    fogColor ??= reachableFogColor(rom, extent, roots);
    normalizeTileWindows(rom, extent, roots);
    const materials = materialPointers(rom, extent, textureGraph, node.index);
    synthesizeMaterials(archive, extent, materials);
    const resolve = (address: number) => {
      const segment = address >>> 24, offset = address & 0x00ffffff;
      if (segment === 4 && offset < extent.end - extent.start) return extent.start + offset;
      if (segment === 0x0e && offset < materials.length * 8) return MATERIAL_TABLE + offset;
      if (segment === 0x0f && MATERIAL_LISTS + offset < archive.work.length) return MATERIAL_LISTS + offset;
      return -1;
    };
    const batches = roots.flatMap((root) => runDisplayList({
      buf: rom, ucode: 'f3dex2', resolve, resolveImage: (asset) => archive.resolveImage(asset),
      textures: level.textures, textureKeys: TEXTURE_KEYS.get(level) ?? (() => { const keys = new Map<string, number>(); TEXTURE_KEYS.set(level, keys); return keys; })(),
      keyPrefix: `k64/${extent.bank}:${extent.index}/${node.index}/`, vertexScale: 1, mirrorX: true,
      lighting: LIGHTING, combiner: true, textureGen: true, decals: true, branchZ: 'near',
    }, root));
    if (!batches.some((batch) => batch.positions.length)) continue;
    let radius = 0;
    for (const batch of batches) for (let i = 0; i < batch.positions.length; i += 3)
      radius = Math.max(radius, Math.hypot(batch.positions[i], batch.positions[i + 1], batch.positions[i + 2]));
    const mesh: Mesh = {
      name: `${name} node ${node.index + 1}`, radius, batches,
      info: { geometryBank: extent.bank, geometryIndex: extent.index, geometryROM: `0x${extent.start.toString(16)}`, mode, node: node.index, hierarchyFlags: node.flags },
    };
    parts.push({ mesh: level.meshes.push(mesh) - 1, matrix: worlds[node.index] ?? IDENTITY, node: node.index, flags: node.flags });
  }
  return { id, name, mode, parts, layoutCount: layouts.length, fogColor };
}

export function placeModel(level: Level, model: DecodedModel, placement: Mtx, layer: number[], name = model.name,
                           info: Record<string, string | number> = {}): void {
  for (const part of model.parts) {
    const matrix = instanceMatrix(multiplyMatrix(part.matrix, placement));
    layer.push(level.instances.push({
      name: model.parts.length > 1 ? `${name} / part ${part.node + 1}` : name,
      mesh: part.mesh, matrix,
      info: { ...info, geometryId: `${model.id >>> 16}:${model.id & 0xffff}`, mode: model.mode, node: part.node, hierarchyFlags: part.flags },
    }) - 1);
  }
}

export const identityMatrix = (): Mtx => IDENTITY.slice();
