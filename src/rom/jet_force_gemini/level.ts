import type { Batch, Level, Mesh } from '../types';
import { appendLevelGeometry, identity } from './geometry';
import { JfgArchive, view } from './fs';
import { appendPlacements, JfgObjectModels } from './objects';
import { JfgTextures } from './texture';

function gradient(level: Level, bottom: readonly number[], top: readonly number[]): void {
  const width = 2, height = 256, rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const t = y / (height - 1);
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) rgba[at + c] = Math.round(top[c] * (1 - t) + bottom[c] * t);
      rgba[at + 3] = 255;
    }
  }
  const texture = level.textures.push({ width, height, rgba, wrapS: 'clamp', wrapT: 'clamp', format: 'RGBA32 generated gradient', source: 'level record +0xCE..+0xD3' }) - 1;
  level.backdrop = { texture, u0: 0, v0: 0, u1: 1, v1: 1 };
}

function scrollingSky(level: Level, texture: number, scaleU: number, scaleV: number): number {
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [];
  const coords = [-640, 0, 640], repeatU = Math.max(1, scaleU) / 8, repeatV = Math.max(1, scaleV) / 8;
  const add = (x: number, z: number) => {
    positions.push(coords[x], 192, coords[z]);
    uvs.push(x * repeatU, z * repeatV);
    const alpha = x === 1 && z === 1 ? 255 : 0;
    colors.push(255, 255, 255, alpha);
  };
  for (let z = 0; z < 2; z++) for (let x = 0; x < 2; x++) {
    add(x, z); add(x + 1, z); add(x + 1, z + 1);
    add(x, z); add(x + 1, z + 1); add(x, z + 1);
  }
  const batch: Batch = { texture, blend: 'blend', depthTest: false, depthWrite: false, cullBack: false,
    positions: new Float32Array(positions), uvs: new Float32Array(uvs), colors: new Uint8Array(colors) };
  const mesh: Mesh = { name: 'Scrolling sky plane', radius: 1000, batches: [batch], info: { source: 'level-record scrolling-plane sky' } };
  return level.meshes.push(mesh) - 1;
}

function expandBounds(level: Level, instanceIndices: number[]): void {
  for (const index of instanceIndices) {
    const instance = level.instances[index];
    if (instance.mesh < 0) continue;
    const matrix = instance.matrix, mesh = level.meshes[instance.mesh];
    for (const batch of mesh.batches) for (let i = 0; i < batch.positions.length; i += 3) {
      const x = batch.positions[i], y = batch.positions[i + 1], z = batch.positions[i + 2];
      const point = [matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
        matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
        matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]];
      for (let axis = 0; axis < 3; axis++) {
        level.bounds.min[axis] = Math.min(level.bounds.min[axis], point[axis]);
        level.bounds.max[axis] = Math.max(level.bounds.max[axis], point[axis]);
      }
    }
  }
}

export function loadJfgLevel(archive: JfgArchive, index: number): Level {
  const info = archive.levelInfo(index);
  const record = archive.levelRecord(index), dv = view(record);
  const level: Level = { info, id: `jfg-${index}`, textures: [], meshes: [], instances: [], layers: [], markers: [], unplaced: [],
    bounds: { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] },
    clearColor: [record[0xad], record[0xae], record[0xaf]] };
  const textures = new JfgTextures(archive, level.textures);
  const layers = level.layers!;
  const mainLayer = layers.push({ name: 'main', kind: 'main', instances: [] }) - 1;
  const objectLayer = layers.push({ name: 'objects', kind: 'objects', instances: [] }) - 1;
  const markerLayer = layers.push({ name: 'unresolved objects', kind: 'markers', instances: [], visibleByDefault: false }) - 1;
  const pathLayer = layers.push({ name: 'patrol paths', kind: 'markers', instances: [], visibleByDefault: false }) - 1;
  const collisionLayer = layers.push({ name: 'collision', kind: 'collision', instances: [], visibleByDefault: false }) - 1;

  const modelId = dv.getInt16(0x54);
  if (modelId >= 0) {
    const geometry = appendLevelGeometry(archive, modelId, level, textures);
    level.bounds = geometry.bounds;
    for (const mesh of geometry.meshes)
      layers[mainLayer].instances.push(level.instances.push({ name: level.meshes[mesh].name, mesh, matrix: identity(), info: { modelId } }) - 1);
    if (geometry.collision) {
      const mesh = level.meshes.push(geometry.collision) - 1;
      layers[collisionLayer].instances.push(level.instances.push({ name: 'Collision', mesh, matrix: identity(), info: { modelId, source: 'render triangles with collision flags applied' } }) - 1);
    }
  }

  const objectModels = new JfgObjectModels(archive, level, textures);
  const objects = appendPlacements(archive, level, record, objectModels, markerLayer, pathLayer);
  layers[objectLayer].instances.push(...objects.objects);
  layers[pathLayer].instances.push(...objects.pathInstances);
  level.markers = objects.markers;
  expandBounds(level, objects.objects);

  const bottom = [record[0xce], record[0xcf], record[0xd0]], top = [record[0xd1], record[0xd2], record[0xd3]];
  gradient(level, bottom, top);
  const skyMode = new DataView(record.buffer, record.byteOffset, record.byteLength).getInt8(0x69);
  if (skyMode === -1) {
    const textureId = dv.getUint32(0xb4) & 0xffff;
    try {
      const texture = textures.get(textureId).index, mesh = scrollingSky(level, texture, record[0xb0], record[0xb1]);
      level.skies = [{ name: 'Scrolling sky', mesh }];
      level.unplaced.push(mesh);
    } catch {
      // Some non-gameplay records retain invalid sky IDs; their gradient remains visible.
    }
  } else {
    const skyObject = dv.getInt16(0x58), resolved = objectModels.object(skyObject);
    if (resolved) {
      level.skies = [{ name: `Sky object ${skyObject}`, mesh: resolved.mesh }];
      level.unplaced.push(resolved.mesh);
    }
  }

  const fogNear = dv.getInt16(0x5a), fogFar = dv.getInt16(0x5c), fogColor: [number, number, number] = [record[0x60], record[0x61], record[0x62]];
  if ((fogNear || fogFar || fogColor.some(Boolean)) && fogFar > fogNear) {
    level.fog = { color: fogColor, multiplier: 128000 / (fogFar - fogNear), offset: (500 - fogNear) * 256 / (fogFar - fogNear),
      near: Math.max(1, fogNear), far: fogFar };
  }
  if (!Number.isFinite(level.bounds.min[0])) level.bounds = { min: [-100, -100, -100], max: [100, 100, 100] };
  // The record supplies only a lens FOV, not an authored eye/target. Let the
  // viewer's enclosed-space/overview heuristic choose a truthful start point
  // instead of presenting a synthetic game camera.
  const instanced = new Set(level.instances.map((instance) => instance.mesh));
  for (let mesh = 0; mesh < level.meshes.length; mesh++) if (!instanced.has(mesh) && !level.unplaced.includes(mesh)) level.unplaced.push(mesh);
  return level;
}
