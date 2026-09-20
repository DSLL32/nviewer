import type { Batch, Level, Mesh } from '../types';
import { view } from './fs';
import type { JfgArchive } from './fs';
import type { JfgTextures } from './texture';

export const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function extent(data: Uint8Array, at: number, count: number, stride: number, what: string): void {
  if (at < 0 || count < 0 || at > data.length || count > Math.floor((data.length - at) / stride))
    throw new Error(`Jet Force Gemini ${what} is out of bounds at 0x${at.toString(16)}`);
}

interface MeshLayout {
  name: string;
  vertexAt: number;
  triangleAt: number;
  batchAt: number;
  vertexCount: number;
  triangleCount: number;
  batchCount: number;
  textureIds: number[];
  source: string;
}

interface Arrays {
  positions: number[];
  uvs: number[];
  colors: number[];
  sources: number[];
}

const arrays = (): Arrays => ({ positions: [], uvs: [], colors: [], sources: [] });

function meshFromLayout(data: Uint8Array, layout: MeshLayout, textures: JfgTextures): Mesh {
  const dv = view(data);
  extent(data, layout.vertexAt, layout.vertexCount, 10, `${layout.name} vertices`);
  extent(data, layout.triangleAt, layout.triangleCount, 16, `${layout.name} triangles`);
  extent(data, layout.batchAt, layout.batchCount + 1, 16, `${layout.name} batches`);
  const batches: Batch[] = [];
  let radius = 0;
  for (let batchIndex = 0; batchIndex < layout.batchCount; batchIndex++) {
    const at = layout.batchAt + batchIndex * 16, next = at + 16;
    const textureSlot = data[at], firstVertex = dv.getUint16(at + 6), firstTriangle = dv.getUint16(at + 8);
    const endVertex = dv.getUint16(next + 6), endTriangle = dv.getUint16(next + 8);
    if (firstVertex > endVertex || endVertex > layout.vertexCount || firstTriangle > endTriangle || endTriangle > layout.triangleCount)
      throw new Error(`Jet Force Gemini ${layout.name} batch ${batchIndex} has invalid ranges`);
    let texture = -1, texWidth = 1, texHeight = 1, textureBlend: Batch['blend'] = 'opaque';
    if (textureSlot !== 0xff) {
      if (textureSlot >= layout.textureIds.length) throw new Error(`Jet Force Gemini ${layout.name} batch ${batchIndex} uses texture slot ${textureSlot}`);
      const loaded = textures.get(layout.textureIds[textureSlot]);
      texture = loaded.index; texWidth = loaded.texture.width; texHeight = loaded.texture.height; textureBlend = loaded.texture.blend;
    }
    const groups = new Map<boolean, Arrays>();
    for (let triangle = firstTriangle; triangle < endTriangle; triangle++) {
      const tri = layout.triangleAt + triangle * 16, triFlags = data[tri];
      const cullBack = (triFlags & 0x40) === 0;
      let out = groups.get(cullBack);
      if (!out) { out = arrays(); groups.set(cullBack, out); }
      const ids = [data[tri + 1], data[tri + 2], data[tri + 3]];
      for (let corner = 0; corner < 3; corner++) {
        const vertex = firstVertex + ids[corner];
        if (vertex >= endVertex) throw new Error(`Jet Force Gemini ${layout.name} triangle ${triangle} has invalid vertex ${vertex}`);
        const v = layout.vertexAt + vertex * 10;
        const x = dv.getInt16(v), y = dv.getInt16(v + 2), z = dv.getInt16(v + 4);
        out.positions.push(x, y, z);
        out.colors.push(data[v + 6], data[v + 7], data[v + 8], data[v + 9]);
        out.uvs.push(dv.getInt16(tri + 4 + corner * 4) / (texWidth * 32), dv.getInt16(tri + 6 + corner * 4) / (texHeight * 32));
        radius = Math.max(radius, Math.hypot(x, y, z));
      }
      out.sources.push(tri);
    }
    for (const [cullBack, out] of groups) {
      let blend = textureBlend;
      for (let i = 3; i < out.colors.length; i += 4) {
        // Vertex alpha is interpolated across the triangle, so even an authored
        // zero at one corner requires the blended pass rather than alpha test.
        if (out.colors[i] !== 255) { blend = 'blend'; break; }
      }
      batches.push({
        texture, blend, depthTest: true, depthWrite: blend !== 'blend', cullBack,
        positions: new Float32Array(out.positions), uvs: new Float32Array(out.uvs), colors: new Uint8Array(out.colors),
        triSource: new Uint32Array(out.sources),
      });
    }
  }
  return { name: layout.name, radius, batches, info: { source: layout.source } };
}

export interface LevelGeometry {
  meshes: number[];
  collision: Mesh | null;
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

export function appendLevelGeometry(archive: JfgArchive, modelId: number, level: Level, textures: JfgTextures): LevelGeometry {
  const data = archive.levelModel(modelId), dv = view(data);
  if (data.length < 0x30 || dv.getUint32(0x2c) > data.length) throw new Error(`Jet Force Gemini level model ${modelId} is truncated`);
  const textureAt = dv.getUint32(0), segmentAt = dv.getUint32(4), boundsAt = dv.getUint32(8);
  const textureCount = dv.getUint16(0x18), segmentCount = dv.getUint16(0x1a);
  extent(data, textureAt, textureCount, 8, `level model ${modelId} texture infos`);
  extent(data, segmentAt, segmentCount, 0x48, `level model ${modelId} segments`);
  extent(data, boundsAt, segmentCount, 0x0c, `level model ${modelId} bounds`);
  const textureIds = Array.from({ length: textureCount }, (_, i) => (dv.getUint32(textureAt + i * 8) | 0x8000) & 0xffff);
  const meshes: number[] = [], collisionPositions: number[] = [], collisionColors: number[] = [], collisionSources: number[] = [];
  for (let segment = 0; segment < segmentCount; segment++) {
    const s = segmentAt + segment * 0x48;
    const vertexAt = dv.getUint32(s), triangleAt = dv.getUint32(s + 4), batchAt = dv.getUint32(s + 0xc);
    const vertexCount = dv.getUint16(s + 0x24), triangleCount = dv.getUint16(s + 0x26), batchCount = dv.getUint16(s + 0x28);
    const layout: MeshLayout = { name: `Segment ${segment}`, vertexAt, triangleAt, batchAt, vertexCount, triangleCount, batchCount,
      textureIds, source: `level model ${modelId}, segment ${segment}` };
    const mesh = meshFromLayout(data, layout, textures);
    mesh.info = { ...mesh.info, modelId, segment, boundsRecord: `0x${(boundsAt + segment * 12).toString(16)}` };
    meshes.push(level.meshes.push(mesh) - 1);

    for (let batch = 0; batch < batchCount; batch++) {
      const at = batchAt + batch * 16, next = at + 16, flags = dv.getUint32(at + 0xc);
      if (flags & 0x880) continue;
      const firstVertex = dv.getUint16(at + 6), firstTriangle = dv.getUint16(at + 8), endTriangle = dv.getUint16(next + 8);
      for (let triangle = firstTriangle; triangle < endTriangle; triangle++) {
        const tri = triangleAt + triangle * 16;
        if (data[tri] & 0x80) continue;
        const points: number[][] = [];
        for (let corner = 0; corner < 3; corner++) {
          const vertex = firstVertex + data[tri + 1 + corner], v = vertexAt + vertex * 10;
          points.push([dv.getInt16(v), dv.getInt16(v + 2), dv.getInt16(v + 4)]);
        }
        const [a, b, c] = points;
        const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
        const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
        const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        const up = ny / (Math.hypot(nx, ny, nz) || 1), color = up > 0.65 ? [65, 210, 80, 150] : up < -0.65 ? [210, 65, 205, 150] : [235, 155, 40, 150];
        collisionPositions.push(...a, ...b, ...c);
        for (let corner = 0; corner < 3; corner++) collisionColors.push(...color);
        collisionSources.push(tri);
      }
    }
  }
  const collision: Mesh | null = collisionPositions.length ? {
    name: 'Collision', radius: 1e6, info: { source: `derived from level model ${modelId}` },
    batches: [{ texture: -1, blend: 'blend', depthTest: true, depthWrite: false, cullBack: false,
      positions: new Float32Array(collisionPositions), uvs: new Float32Array(collisionPositions.length / 3 * 2),
      colors: new Uint8Array(collisionColors), triSource: new Uint32Array(collisionSources) }],
  } : null;
  const bounds = {
    min: [dv.getInt16(0x20), dv.getInt16(0x24), dv.getInt16(0x28)] as [number, number, number],
    max: [dv.getInt16(0x22), dv.getInt16(0x26), dv.getInt16(0x2a)] as [number, number, number],
  };
  return { meshes, collision, bounds };
}

export function appendObjectModel(archive: JfgArchive, modelId: number, level: Level, textures: JfgTextures): number {
  const data = archive.objectModel(modelId), dv = view(data);
  if (data.length < 0x88) throw new Error(`Jet Force Gemini object model ${modelId} is truncated`);
  const textureCount = data[0x10], vertexCount = dv.getUint16(0x12), triangleCount = dv.getUint16(0x14), batchCount = dv.getUint16(0x16);
  const textureAt = dv.getUint32(0x18), vertexAt = dv.getUint32(0x1c), triangleAt = dv.getUint32(0x20), batchAt = dv.getUint32(0x24);
  extent(data, textureAt, textureCount, 8, `object model ${modelId} texture infos`);
  const textureIds = Array.from({ length: textureCount }, (_, i) => dv.getUint16(textureAt + i * 8 + 6));
  let name = '';
  for (let i = 0; i < 16 && data[i]; i++) name += String.fromCharCode(data[i]);
  const mesh = meshFromLayout(data, { name: name || `Object model ${modelId}`, vertexAt, triangleAt, batchAt, vertexCount, triangleCount, batchCount,
    textureIds, source: `object model ${modelId}` }, textures);
  mesh.info = { ...mesh.info, modelId, deformationMode: data[0x11] };
  return level.meshes.push(mesh) - 1;
}
