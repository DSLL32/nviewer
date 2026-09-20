import type { Batch, Level, Mesh } from '../types';
import { f32, KirbyArchive, u16, u32 } from './fs';
import type { SetupRecord } from './types';

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const TYPE_NAMES: Record<number, string> = {
  0x00: 'solid', 0x01: 'ladder', 0x02: 'rope', 0x03: 'death floor', 0x04: 'semisolid',
  0x05: 'ceiling variant', 0x06: 'special response', 0x08: 'warp', 0x09: 'breakable',
  0x0a: 'conditional solid', 0x0d: 'breakable ceiling', 0x0e: 'non-solid special',
  0x10: 'Dedede breakable', 0x12: 'backward conveyor', 0x13: 'forward conveyor', 0x14: 'moving platform',
};

const COLORS: Record<number, [number, number, number, number]> = {
  0x00: [90, 205, 120, 145], 0x01: [240, 220, 70, 170], 0x02: [205, 150, 65, 170],
  0x03: [255, 45, 45, 185], 0x04: [90, 205, 235, 145], 0x05: [115, 170, 245, 145],
  0x06: [220, 80, 220, 170], 0x08: [155, 85, 235, 175], 0x09: [255, 145, 45, 175],
  0x0a: [155, 190, 90, 150], 0x0d: [245, 105, 50, 180], 0x0e: [195, 85, 200, 170],
  0x10: [245, 180, 35, 180], 0x12: [55, 195, 220, 165], 0x13: [35, 155, 235, 165], 0x14: [245, 220, 100, 165],
};

interface Parts { positions: number[]; colors: number[]; sources: number[]; count: number; type: number; flags: number }

function batch(parts: Parts): Batch {
  return {
    texture: -1, blend: 'blend', depthTest: true, depthWrite: false, cullBack: false,
    positions: new Float32Array(parts.positions), uvs: new Float32Array(parts.count * 6),
    colors: new Uint8Array(parts.colors), triSource: new Uint32Array(parts.sources),
  };
}

type V3 = [number, number, number];
type Plane = [number, number, number, number];

function intersect(a: Plane, b: Plane, c: Plane): V3 | null {
  const [a0, a1, a2, ad] = a, [b0, b1, b2, bd] = b, [c0, c1, c2, cd] = c;
  const det = a0 * (b1 * c2 - b2 * c1) - a1 * (b0 * c2 - b2 * c0) + a2 * (b0 * c1 - b1 * c0);
  if (Math.abs(det) < 1e-7) return null;
  const dx = -ad, dy = -bd, dz = -cd;
  return [
    (dx * (b1 * c2 - b2 * c1) - a1 * (dy * c2 - b2 * dz) + a2 * (dy * c1 - b1 * dz)) / det,
    (a0 * (dy * c2 - b2 * dz) - dx * (b0 * c2 - b2 * c0) + a2 * (b0 * dz - dy * c0)) / det,
    (a0 * (b1 * dz - dy * c1) - a1 * (b0 * dz - dy * c0) + dx * (b0 * c1 - b1 * c0)) / det,
  ];
}

function waterMesh(planes: Plane[], name: string, info: Mesh['info']): Mesh | null {
  const vertices: V3[] = [];
  for (let i = 0; i < planes.length; i++) for (let j = i + 1; j < planes.length; j++) for (let k = j + 1; k < planes.length; k++) {
    const p = intersect(planes[i], planes[j], planes[k]);
    if (!p || !p.every(Number.isFinite) || planes.some((q) => q[0] * p[0] + q[1] * p[1] + q[2] * p[2] + q[3] > 0.02)) continue;
    if (!vertices.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < 0.02)) vertices.push(p);
  }
  if (vertices.length < 4) return null;
  const positions: number[] = [], colors: number[] = [], sources: number[] = [];
  planes.forEach((plane, planeIndex) => {
    const face = vertices.filter((p) => Math.abs(plane[0] * p[0] + plane[1] * p[1] + plane[2] * p[2] + plane[3]) < 0.04);
    if (face.length < 3) return;
    const center: V3 = [face.reduce((s, p) => s + p[0], 0) / face.length, face.reduce((s, p) => s + p[1], 0) / face.length, face.reduce((s, p) => s + p[2], 0) / face.length];
    const n: V3 = [plane[0], plane[1], plane[2]], nl = Math.hypot(...n) || 1;
    n[0] /= nl; n[1] /= nl; n[2] /= nl;
    const seed: V3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u: V3 = [n[1] * seed[2] - n[2] * seed[1], n[2] * seed[0] - n[0] * seed[2], n[0] * seed[1] - n[1] * seed[0]];
    const ul = Math.hypot(...u) || 1; u[0] /= ul; u[1] /= ul; u[2] /= ul;
    const v: V3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    face.sort((p, q) => Math.atan2((p[0] - center[0]) * v[0] + (p[1] - center[1]) * v[1] + (p[2] - center[2]) * v[2], (p[0] - center[0]) * u[0] + (p[1] - center[1]) * u[1] + (p[2] - center[2]) * u[2])
      - Math.atan2((q[0] - center[0]) * v[0] + (q[1] - center[1]) * v[1] + (q[2] - center[2]) * v[2], (q[0] - center[0]) * u[0] + (q[1] - center[1]) * u[1] + (q[2] - center[2]) * u[2]));
    for (let i = 1; i + 1 < face.length; i++) {
      for (const p of [face[0], face[i], face[i + 1]]) positions.push(-p[0], p[1], p[2]);
      colors.push(40, 145, 235, 92, 40, 145, 235, 92, 40, 145, 235, 92);
      sources.push(planeIndex);
    }
  });
  if (!positions.length) return null;
  return {
    name, radius: Math.max(...vertices.map((p) => Math.hypot(...p))), info,
    batches: [{ texture: -1, blend: 'blend', depthTest: true, depthWrite: false, cullBack: false,
      positions: new Float32Array(positions), uvs: new Float32Array(positions.length / 3 * 2),
      colors: new Uint8Array(colors), triSource: new Uint32Array(sources) }],
  };
}

export function appendCollision(archive: KirbyArchive, level: Level, setup: SetupRecord,
                                collisionInstances: number[], waterInstances: number[]): void {
  const rom = archive.rom, h = setup.collision;
  const triangleOffset = setup.extent.start + u32(rom, h), triangleCount = u32(rom, h + 4);
  const vertexOffset = setup.extent.start + u32(rom, h + 8), vertexCount = u32(rom, h + 0xc);
  let collisionMinZ = Infinity, collisionMaxZ = -Infinity;
  for (let i = 1; i < vertexCount; i++) {
    const z = new DataView(rom.buffer, rom.byteOffset + vertexOffset + i * 6 + 4, 2).getInt16(0);
    collisionMinZ = Math.min(collisionMinZ, z); collisionMaxZ = Math.max(collisionMaxZ, z);
  }
  const groups = new Map<string, Parts>();
  for (let i = 1; i < triangleCount; i++) {
    const at = triangleOffset + i * 0x14, indices = [u16(rom, at), u16(rom, at + 2), u16(rom, at + 4)];
    if (indices.some((index) => index === 0 || index >= vertexCount)) continue;
    const flags = u16(rom, at + 8), type = u16(rom, at + 0x12), key = `${type}/${flags}`;
    let part = groups.get(key);
    if (!part) { part = { positions: [], colors: [], sources: [], count: 0, type, flags }; groups.set(key, part); }
    const color = COLORS[type] ?? [235, 80, 200, 165];
    for (const index of indices) {
      const v = vertexOffset + index * 6;
      part.positions.push(-new DataView(rom.buffer, rom.byteOffset + v, 2).getInt16(0), new DataView(rom.buffer, rom.byteOffset + v + 2, 2).getInt16(0), new DataView(rom.buffer, rom.byteOffset + v + 4, 2).getInt16(0));
      part.colors.push(...color);
    }
    part.sources.push(at); part.count++;
  }
  for (const part of groups.values()) {
    const name = `Collision ${TYPE_NAMES[part.type] ?? `type 0x${part.type.toString(16)}`} / flags 0x${part.flags.toString(16)}`;
    const mesh: Mesh = { name, radius: 0, batches: [batch(part)], info: { type: part.type, flags: part.flags, triangles: part.count, setupIndex: setup.extent.index } };
    const meshIndex = level.meshes.push(mesh) - 1;
    collisionInstances.push(level.instances.push({ name, mesh: meshIndex, matrix: IDENTITY.slice(), info: mesh.info }) - 1);
  }

  const volumeOffsetRaw = u32(rom, h + 0x34), volumeCount = u32(rom, h + 0x38);
  const planeOffsetRaw = u32(rom, h + 0x3c), planeCount = u32(rom, h + 0x40);
  if (!volumeOffsetRaw || !planeOffsetRaw || !volumeCount || planeCount <= 1) return;
  const volumeOffset = setup.extent.start + volumeOffsetRaw, planeOffset = setup.extent.start + planeOffsetRaw;
  for (let i = 0; i < volumeCount; i++) {
    const at = volumeOffset + i * 0x18, count = u16(rom, at), first = u16(rom, at + 2);
    const minX = f32(rom, at + 8), maxX = f32(rom, at + 0xc), minY = f32(rom, at + 0x10), maxY = f32(rom, at + 0x14);
    const planes: Plane[] = [
      [-1, 0, 0, minX], [1, 0, 0, -maxX], [0, -1, 0, minY], [0, 1, 0, -maxY],
      // Authored water planes are frequently two-dimensional X/Y prisms. The
      // rail supplies gameplay depth; bound their diagnostic mesh to the
      // verified collision extent without claiming an authored Z boundary.
      [0, 0, -1, collisionMinZ], [0, 0, 1, -collisionMaxZ],
    ];
    for (let p = 0; p < count && first + p < planeCount; p++) {
      const q = planeOffset + (first + p) * 0x10;
      planes.push([f32(rom, q), f32(rom, q + 4), f32(rom, q + 8), f32(rom, q + 0xc)]);
    }
    const info = { setupIndex: setup.extent.index, waterVolume: i, enabled: rom[at + 4], mode: rom[at + 5], flowDirection: rom[at + 6], flowSpeed: rom[at + 7], planeCount: count,
      zExtent: 'diagnostic collision-bound extrusion' };
    const mesh = waterMesh(planes, `Water volume ${i + 1}`, info);
    if (!mesh) continue;
    const meshIndex = level.meshes.push(mesh) - 1;
    waterInstances.push(level.instances.push({ name: mesh.name, mesh: meshIndex, matrix: IDENTITY.slice(), info }) - 1);
  }
}
