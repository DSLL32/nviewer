// Block spawn lists, Pokémon/prop instances, and their hidden route overlays.
import { buildLevel } from '../bomberman/common';
import type { Batch, Level, LevelInfo, LevelLayer, Marker, Mesh } from '../types';
import { interpolatedPosition } from './anim';
import { buildWorld, readObjectList, type WorldBuild } from './course';
import type { CourseDefinition, SnapMemory, V3 } from './fs';
import { buildModels, objectName, rpyMatrix, type ModelRecord } from './models';

const IDENTITY = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function groundHeight(m: SnapMemory, x: number, z: number): number | null {
  if (!m.course.height) return null;
  const struct = m.vramOfRom(m.course.height);
  const patches = m.u32(struct), tree = m.u32(struct + 4);
  let node = 0;
  for (let guard = 0; guard < 10000; guard++) {
    const a = tree + node * 28, A = m.f32(a), B = m.f32(a + 4), C = m.f32(a + 8);
    const right = A * x + B * z + C <= 0;
    const child = m.s32(a + (right ? 16 : 12)), patch = m.s32(a + (right ? 24 : 20));
    if (patch !== -1) {
      const p = patches + patch * 20, aa = m.f32(p), bb = m.f32(p + 4), cc = m.f32(p + 8), dd = m.f32(p + 12);
      return cc ? -(aa * x + bb * z + dd) / cc : 0;
    }
    if (child === -1) return null;
    node = child;
  }
  return null;
}

function pathBatch(points: V3[], color: [number, number, number, number]): Batch {
  const positions: number[] = [], colors: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const lo = (p: V3): V3 => [p[0], p[1] - 12, p[2]], hi = (p: V3): V3 => [p[0], p[1] + 12, p[2]];
    for (const p of [lo(a), lo(b), hi(b), lo(a), hi(b), hi(a)]) { positions.push(...p); colors.push(...color); }
  }
  return { texture: -1, blend: 'opaque', depthTest: true, depthWrite: true, cullBack: false,
    positions: new Float32Array(positions), uvs: new Float32Array(positions.length / 3 * 2), colors: new Uint8Array(colors) };
}

function onGround(course: CourseDefinition, id: number, behavior: number, model: ModelRecord): boolean {
  // These are the only initializers with both ground and unsnapped branches.
  if (course.id === 'beach' && id === 52) return behavior !== 1;
  if (course.id === 'valley' && id === 129) return behavior !== 3;
  return model.spawnFunctions.some((name) => name.includes('OnGround'));
}

const CODE_OBJECTS: Partial<Record<CourseDefinition['id'], { id: number; position: V3; label: string }[]>> = {
  rainbow: [
    { id: 151, position: [0, 100, 500], label: '151 Mew (course code)' },
    { id: 1037, position: [0, 100, 500], label: '1037 Mew Bubble Rings (course code)' },
    { id: 1038, position: [0, 0, 0], label: '1038 Rainbow Cloud (course code)' },
  ],
};

export function buildCourseLevel(bytes: Uint8Array, course: CourseDefinition, info: LevelInfo): Level {
  const world: WorldBuild = buildWorld(bytes, course), m = world.mem, models = buildModels(m);
  const textureOffset = world.textures.length, meshOffset = world.meshes.length;
  world.textures.push(...models.textures);
  for (const mesh of models.meshes) {
    world.meshes.push({ ...mesh, batches: mesh.batches.map((batch) => ({
      ...batch,
      texture: batch.texture >= 0 ? batch.texture + textureOffset : -1,
      ...(batch.texture1 !== undefined && batch.texture1 >= 0 ? { texture1: batch.texture1 + textureOffset } : {}),
    })) });
  }
  const layers = world.layers;
  const addLayer = (layer: LevelLayer) => { layers.push(layer); return layers.length - 1; };
  const pokemonLayer = addLayer({ name: 'Pokémon', kind: 'objects', instances: [] });
  const propLayer = addLayer({ name: 'object props and effects', kind: 'objects', instances: [] });
  const pathLayer = addLayer({ name: 'spawn paths', kind: 'markers', instances: [], visibleByDefault: false });
  const spawnLayer = addLayer({ name: 'spawn positions', kind: 'markers', instances: [], visibleByDefault: false });
  const markers: Marker[] = world.markers;
  const palette: [number, number, number, number][] = [[255, 70, 70, 255], [255, 210, 40, 255], [60, 220, 90, 255], [60, 180, 255, 255], [190, 100, 255, 255], [255, 130, 210, 255]];

  for (const block of world.blocks) for (const spawn of readObjectList(m, block.spawn, true)) {
    const model = models.records.find((r) => r.id === spawn.id);
    const x = block.worldPos[0] + spawn.pos[0], z = block.worldPos[2] + spawn.pos[2];
    const ground = model && onGround(course, spawn.id, spawn.behavior ?? 0, model);
    const y = ground ? (groundHeight(m, x, z) ?? block.worldPos[1] + spawn.pos[1]) : block.worldPos[1] + spawn.pos[1];
    const position: V3 = [x * 100, y * 100, z * 100];
    const label = `${spawn.id} ${objectName(spawn.id)}`;
    markers.push({ label, position, layer: spawnLayer,
      info: { block: block.index, behavior: spawn.behavior ?? 0, spawn: `0x${spawn.addr.toString(16)}`, path: spawn.path ? `0x${spawn.path.toString(16)}` : 0 } });
    if (model && model.triangles) {
      const scale = model.scale.map((v) => v * 0.1) as V3, index = world.instances.length;
      world.instances.push({ name: label, mesh: meshOffset + model.mesh, matrix: new Float32Array(rpyMatrix(position, spawn.rot, scale)),
        ...(spawn.path ? { animated: true } : {}), info: { block: block.index, behavior: spawn.behavior ?? 0, initData: `0x${model.initData.toString(16)}` } });
      layers[spawn.id >= 500 ? propLayer : pokemonLayer].instances.push(index);
    }
    if (spawn.path) {
      const points = Array.from({ length: 49 }, (_, i) => interpolatedPosition(m, spawn.path!, i / 48).map((v) => v * 100) as V3);
      const mesh = world.meshes.length;
      world.meshes.push({ name: `path: ${label} block ${block.index}`, radius: 1, batches: [pathBatch(points, palette[block.index % palette.length])],
        info: { path: `0x${spawn.path.toString(16)}` } });
      const instance = world.instances.length;
      world.instances.push({ name: `path of ${label}`, mesh, matrix: IDENTITY(), noFog: true });
      layers[pathLayer].instances.push(instance); world.notInBounds.add(instance);
    }
  }

  for (const object of CODE_OBJECTS[course.id] ?? []) {
    const model = models.records.find((r) => r.id === object.id && r.triangles);
    if (model) {
      const scale = model.scale.map((v) => v * 0.1) as V3, index = world.instances.length;
      world.instances.push({ name: object.label, mesh: meshOffset + model.mesh,
        matrix: new Float32Array(rpyMatrix(object.position, [0, 0, 0], scale)), animated: true, info: { source: 'course code' } });
      layers[object.id >= 500 ? propLayer : pokemonLayer].instances.push(index);
    }
    markers.push({ label: object.label, position: object.position, layer: spawnLayer, info: { source: 'course code' } });
  }

  return buildLevel(info, `pokemonsnap-${course.id}`, world.textures, world.meshes, world.instances,
    { ...world.extra, layers, markers }, world.notInBounds);
}
