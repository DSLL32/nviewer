// Course worlds, environment, rails, and collision overlays.
import { fogPosition, meshFromBatches } from '../bomberman/common';
import type { Batch, CameraView, Instance, Level, LevelLayer, Marker, Mesh, Texture } from '../types';
import { AnimNode } from './anim';
import { clipToHeight, patchHeight, readHeightMap, type HeightMap } from './collision';
import { SnapMemory, type CourseDefinition, type V3 } from './fs';
import { G, GfxBuilder, readMObjs, RM_AA_OPA_SURF_NOZ, RM_FOG_OPA, type ListOptions } from './gfx';
import { objectName, rpyMatrix } from './models';

const FUNCS: Record<number, string> = {
  0x80014d60: 'renRenderModelTypeA', 0x80014f98: 'renRenderModelTypeB', 0x800153ec: 'renRenderModelTypeC', 0x80015890: 'renRenderModelTypeD',
  0x800a1530: 'renderModelTypeAFogged', 0x800a15d8: 'renderModelTypeBFogged', 0x800a1590: 'renderModelTypeCFogged', 0x800a1608: 'renderModelTypeDFogged',
  0x800e1ca4: 'drawSkyBox1Cycle', 0x800e1d80: 'drawSkyBox2Cycle', 0x800e30b0: 'attachGfx', 0x800e3258: 'attachTree',
};
const hex = (v: number) => `0x${(v >>> 0).toString(16)}`;
const IDENTITY = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const FOGGED: ListOptions = { geometryMode: G.ZBUFFER | G.SHADE | G.CULL_BACK | G.SMOOTH | G.FOG, renderMode: RM_FOG_OPA };
const SKY: ListOptions = { geometryMode: G.SHADE | G.CULL_BACK | G.SMOOTH, renderMode: RM_AA_OPA_SURF_NOZ };

interface RoadNode { id: number; pos: V3; rot: V3; scale: V3 }
export interface Block {
  index: number; list: number; descriptor: number; worldPos: V3; yaw: number; reversed: number;
  staticModels: number; spawn: number; staticObjects: number; gfxData: number; textures: number;
  materialAnimation: number; renderFunc: string; road: number; numControlLines: number;
  movementAnimation: number; movementDuration: number; cpTimeStamps: number[]; roadNodes: RoadNode[];
}
export interface PathSample { block: number; moveTime: number; eye: V3; target: V3; speed: number }

interface RawObject { id: number; behavior?: number; pos: V3; rot: V3; scale: V3; path?: number; addr: number }
export function readObjectList(m: SnapMemory, addr: number, spawn: boolean): RawObject[] {
  const out: RawObject[] = [];
  for (let p = addr, guard = 0; p && m.s32(p) !== -1 && guard < 1000; p += spawn ? 0x30 : 0x28, guard++) {
    out.push(spawn
      ? { id: m.s32(p), behavior: m.s32(p + 4), pos: m.vec3(p + 8), rot: m.vec3(p + 20), scale: m.vec3(p + 32), path: m.u32(p + 44), addr: p }
      : { id: m.s32(p), pos: m.vec3(p + 4), rot: m.vec3(p + 16), scale: m.vec3(p + 28), addr: p });
  }
  return out;
}

export function sampleRail(m: SnapMemory, block: Block, moveTime: number, cpTime = 0.5): PathSample | null {
  if (!block.road || !block.movementAnimation || block.numControlLines < 2) return null;
  const numSegments = block.numControlLines - 1;
  let t = Math.max(0, Math.min(1, moveTime)), cp = Math.max(0, Math.min(1, cpTime));
  if (block.reversed) { t = 1 - t; cp = 1 - cp; }
  const time = block.movementDuration * t;
  const nodes = block.roadNodes.map((road, i) => {
    const anim = new AnimNode(m, false), list = m.u32(block.movementAnimation + i * 4);
    if (list) { anim.set(list, 0); anim.speed = 0; anim.tick(); anim.speed = time; anim.tick(); }
    const value = (p: number, fallback: number) => anim.values.get(p) ?? fallback;
    return {
      pos: anim.position ?? [value(5, road.pos[0]), value(6, road.pos[1]), value(7, road.pos[2])] as V3,
      rot: [value(1, road.rot[0]), value(2, road.rot[1]), value(3, road.rot[2])] as V3,
      speed: value(8, road.scale[0]),
    };
  });
  let pos: V3, rot: V3, speed: number;
  if (numSegments === 1) ({ pos, rot, speed } = nodes[1]);
  else {
    let a = 1, i: number;
    for (i = 2; i < numSegments; i++) { a = i; if (cp <= block.cpTimeStamps[i - 2]) { a = i - 1; break; } }
    i = a + 1;
    const start = a < 2 || numSegments < 3 ? 0 : block.cpTimeStamps[a - 2];
    const end = i >= numSegments ? 1 : block.cpTimeStamps[i - 2];
    const f = (cp - start) / (end - start), lerp = (x: number, y: number) => x + (y - x) * f;
    pos = [0, 1, 2].map((k) => lerp(nodes[a].pos[k], nodes[i].pos[k])) as V3;
    rot = [0, 1, 2].map((k) => lerp(nodes[a].rot[k], nodes[i].rot[k])) as V3;
    speed = lerp(nodes[a].speed, nodes[i].speed);
  }
  const cy = Math.cos(block.yaw), sy = Math.sin(block.yaw);
  const world: V3 = [block.worldPos[0] * 100 + cy * pos[0] + sy * pos[2], block.worldPos[1] * 100 + pos[1], block.worldPos[2] * 100 - sy * pos[0] + cy * pos[2]];
  const yaw = rot[1] + block.yaw + (block.reversed ? Math.PI : 0);
  let view: V3 = [0, 0, 20];
  const rx = (v: V3, a: number): V3 => [v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)];
  const ry = (v: V3, a: number): V3 => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], v[2] * Math.cos(a) - v[0] * Math.sin(a)];
  const rz = (v: V3, a: number): V3 => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]];
  view = rz(ry(rx(view, rot[0]), yaw), rot[2]);
  const eye: V3 = [world[0], world[1] + 100, world[2]];
  return { block: block.index, moveTime, eye, target: [eye[0] + view[0], eye[1] + view[1], eye[2] + view[2]], speed };
}

function solidBatch(tris: { points: V3[]; color: [number, number, number, number] }[], blend: 'opaque' | 'blend'): Batch {
  const positions: number[] = [], colors: number[] = [];
  for (const tri of tris) for (const p of tri.points) { positions.push(...p); colors.push(...tri.color); }
  return { texture: -1, blend, depthTest: true, depthWrite: blend === 'opaque', cullBack: false,
    positions: new Float32Array(positions), uvs: new Float32Array(positions.length / 3 * 2), colors: new Uint8Array(colors) };
}

function applyCollider(p: V3, scale: V3, rot: V3, pos: V3): V3 {
  let [x, y, z] = [p[0] * scale[0], p[1] * scale[1], p[2] * scale[2]];
  let c = Math.cos(rot[0]), s = Math.sin(rot[0]); [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(rot[1]); s = Math.sin(rot[1]); [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(rot[2]); s = Math.sin(rot[2]); [x, y] = [x * c - y * s, x * s + y * c];
  return [x + pos[0], y + pos[1], z + pos[2]];
}

export interface WorldBuild {
  mem: SnapMemory; textures: Texture[]; meshes: Mesh[]; instances: Instance[]; layers: LevelLayer[];
  markers: Marker[]; extra: Pick<Level, 'fog' | 'clearColor' | 'camera' | 'skies'>;
  notInBounds: Set<number>; blocks: Block[]; height: HeightMap | null;
}

export function buildWorld(bytes: Uint8Array, course: CourseDefinition): WorldBuild {
  const m = new SnapMemory(bytes, course), ws = course.setup;
  const blocksSetup = m.u32(ws), staticTable = m.u32(ws + 4), collisionModels = m.u32(ws + 12);
  const fogMin = m.u16(ws + 20), fogMax = m.u16(ws + 22);
  const fogRgb: [number, number, number] = [m.u8(ws + 24), m.u8(ws + 25), m.u8(ws + 26)];
  const bgRgb: [number, number, number] = [m.u8(ws + 27), m.u8(ws + 28), m.u8(ws + 29)];
  const skyPtr = m.u32(blocksSetup + 8), blocks: Block[] = [];
  for (const [list, head] of [m.u32(blocksSetup), m.u32(blocksSetup + 4)].entries()) {
    for (let slot = 0; head && m.u32(head + slot * 4); slot++) {
      const descriptor = m.u32(head + slot * 4);
      if (slot && descriptor === m.u32(head)) break;
      const gfx = m.u32(descriptor), road = m.u32(gfx + 16), numControlLines = m.s32(gfx + 20), roadNodes: RoadNode[] = [];
      for (let a = road; road && m.s32(a) !== 18; a += 0x2c) roadNodes.push({ id: m.s32(a), pos: m.vec3(a + 8), rot: m.vec3(a + 20), scale: m.vec3(a + 32) });
      const fn = m.u32(gfx + 12);
      blocks.push({ index: blocks.length, list, descriptor, worldPos: m.vec3(descriptor + 4), yaw: m.f32(descriptor + 16), reversed: m.u32(descriptor + 20),
        staticModels: m.u32(descriptor + 24), spawn: m.u32(descriptor + 28), staticObjects: m.u32(descriptor + 32), gfxData: m.u32(gfx),
        textures: m.u32(gfx + 4), materialAnimation: m.u32(gfx + 8), renderFunc: FUNCS[fn] ?? hex(fn), road, numControlLines,
        movementAnimation: m.u32(gfx + 24), movementDuration: m.s32(gfx + 28),
        cpTimeStamps: Array.from({ length: Math.max(0, numControlLines - 2) }, (_, i) => m.f32(gfx + 32 + i * 4)), roadNodes });
    }
  }

  const gfx = new GfxBuilder(m, `snap/${course.id}/world/`);
  let sky: { gfx: number; fn: string } | null = null;
  if (skyPtr) {
    const dl = m.u32(skyPtr), fn = FUNCS[m.u32(skyPtr + 4)] ?? hex(m.u32(skyPtr + 4));
    sky = { gfx: dl, fn };
    const w = gfx.begin('sky', SKY); w.walk(dl, readMObjs(m, m.u32(skyPtr + 8), m.u32(skyPtr + 12))); gfx.end(w);
  }
  for (const block of blocks) {
    const options = block.renderFunc.includes('Fogged') ? FOGGED : SKY;
    const w = gfx.begin(`block-${block.index}`, options);
    w.walk(block.gfxData, readMObjs(m, block.textures, block.materialAnimation)); gfx.end(w);
  }
  const table = new Map<number, { handler: number; payload: number }>();
  for (let p = staticTable; p && m.s32(p) !== -1; p += 12) table.set(m.s32(p), { handler: m.u32(p + 4), payload: m.u32(p + 8) });
  const props: { block: Block; object: RawObject; list: string }[] = [];
  for (const block of blocks) for (const object of readObjectList(m, block.staticModels, false)) {
    const entry = table.get(object.id);
    if (!entry || entry.handler !== 0x800e30b0) continue;
    const name = `static-${object.id}`;
    if (!gfx.lists.some((l) => l.name === name)) { const w = gfx.begin(name, FOGGED); w.walk(entry.payload, []); gfx.end(w); }
    props.push({ block, object, list: name });
  }
  const output = gfx.run(), meshes: Mesh[] = [], instances: Instance[] = [];
  for (const list of gfx.lists) if (Object.keys(list.stats.unknownOps).length)
    throw new Error(`Pokémon Snap ${course.id} ${list.name}: unknown display-list commands ${JSON.stringify(list.stats.unknownOps)}`);
  const meshByName = new Map<string, number>();
  const addMesh = (name: string, batches: Batch[], info?: Record<string, string | number>) => {
    const index = meshes.length; meshByName.set(name, index); meshes.push({ ...meshFromBatches(name, batches), ...(info ? { info } : {}) }); return index;
  };
  const main: number[] = [], scenery: number[] = [], objects: number[] = [], heightInstances: number[] = [], ceilingInstances: number[] = [], hitboxInstances: number[] = [], railInstances: number[] = [];
  for (const block of blocks) {
    const mesh = addMesh(`block ${block.index}`, output.get(`block-${block.index}`) ?? [], { descriptor: hex(block.descriptor), gfx: hex(block.gfxData) });
    (block.list ? scenery : main).push(instances.length);
    instances.push({ name: `block ${block.index}${block.list ? ' (scenery)' : ''}`, mesh,
      matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, block.worldPos[0] * 100, block.worldPos[1] * 100, block.worldPos[2] * 100, 1]),
      ...(block.renderFunc.startsWith('drawSkyBox') ? { noFog: true } : {}), info: { descriptor: hex(block.descriptor) } });
  }
  for (const prop of props) {
    let mesh = meshByName.get(prop.list);
    if (mesh === undefined) mesh = addMesh(prop.list, output.get(prop.list) ?? []);
    const p: V3 = [0, 1, 2].map((i) => (prop.block.worldPos[i] + prop.object.pos[i]) * 100) as V3;
    objects.push(instances.length);
    instances.push({ name: `${prop.object.id} ${objectName(prop.object.id)}`, mesh,
      matrix: new Float32Array(rpyMatrix(p, prop.object.rot, prop.object.scale)), info: { block: prop.block.index } });
  }
  let skies: Level['skies'];
  if (sky && output.get('sky')) skies = [{ name: 'sky', mesh: addMesh('sky', output.get('sky')!, { gfx: hex(sky.gfx), render: sky.fn }), opaque: true }];

  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const inst of instances) for (const batch of meshes[inst.mesh].batches) for (let i = 0; i < batch.positions.length; i += 3) {
    for (let a = 0; a < 3; a++) { const v = batch.positions[i + a] + inst.matrix[12 + a]; min[a] = Math.min(min[a], v); max[a] = Math.max(max[a], v); }
  }
  const bounds: [number, number, number, number] = [min[0] / 100 - 2, min[2] / 100 - 2, max[0] / 100 + 2, max[2] / 100 + 2];
  const collisionMesh = (map: HeightMap, name: string, alpha: number) => {
    const tris: { points: V3[]; color: [number, number, number, number] }[] = [];
    for (const cell of map.cells) {
      const p = cell.patch, norm = Math.hypot(p.a, p.b, p.c) || 1, shade = 0.55 + 0.45 * Math.abs(p.c / norm);
      const color = [((p.surface >> 16) & 255) * shade, ((p.surface >> 8) & 255) * shade, (p.surface & 255) * shade, alpha].map(Math.round) as [number, number, number, number];
      const poly = clipToHeight(cell.poly, p, min[1] / 100 - 5, max[1] / 100 + 5);
      const points = poly.map(([x, z]) => [x * 100, patchHeight(p, x, z) * 100, z * 100] as V3);
      for (let i = 1; i + 1 < points.length; i++) tris.push({ points: [points[0], points[i], points[i + 1]], color });
    }
    return addMesh(name, [solidBatch(tris, 'blend')], { cells: map.cells.length, nodes: map.nodeCount, patches: map.patchCount });
  };
  let height: HeightMap | null = null;
  if (course.height) {
    height = readHeightMap(m, course.height, bounds); heightInstances.push(instances.length);
    instances.push({ name: 'height map', mesh: collisionMesh(height, 'collision: height map', 170), matrix: IDENTITY(), noFog: true });
  }
  if (course.ceiling) {
    const ceiling = readHeightMap(m, course.ceiling, bounds); ceilingInstances.push(instances.length);
    instances.push({ name: 'ceiling map', mesh: collisionMesh(ceiling, 'collision: ceiling map', 110), matrix: IDENTITY(), noFog: true });
  }

  interface Collider { depth: number; type: number; params: number[]; pos: V3; rot: V3; scale: V3 }
  const collision = new Map<number, { scale: number; colliders: Collider[] }>();
  for (let p = collisionModels; p && m.s32(p) !== -1; p += 12) {
    const colliders: Collider[] = [];
    for (let a = m.u32(p + 4); m.s32(a) !== 18; a += 0x2c) {
      const hit = m.u32(a + 4); if (!hit) continue;
      const type = m.u8(hit), count = type === 1 ? 1 : type === 2 || type === 3 ? 2 : type === 4 ? 3 : 0;
      colliders.push({ depth: m.s32(a), type, params: Array.from({ length: count }, (_, i) => m.f32(hit + 0x84 + i * 4)), pos: m.vec3(a + 8), rot: m.vec3(a + 20), scale: m.vec3(a + 32) });
    }
    collision.set(m.s32(p), { scale: m.f32(p + 8), colliders });
  }
  const hitTris: { points: V3[]; color: [number, number, number, number] }[] = [];
  for (const block of blocks) for (const object of readObjectList(m, block.staticObjects, false)) {
    const model = collision.get(object.id); if (!model) continue;
    const objectScale: V3 = model.scale > 0 ? [model.scale, model.scale, model.scale] : object.scale;
    const objectPos: V3 = [block.worldPos[0] + object.pos[0], block.worldPos[1] + object.pos[1], block.worldPos[2] + object.pos[2]];
    const root = model.colliders.filter((c) => c.type === 1).sort((a, b) => a.depth - b.depth)[0];
    for (const part of model.colliders) {
      if (part === root || !part.params.length) continue;
      const local: V3[][] = [];
      if (part.type === 4) {
        const [x, y, z] = part.params, corner = (i: number): V3 => [i & 1 ? x : -x, i & 2 ? y : -y, i & 4 ? z : -z];
        for (const f of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]])
          local.push([corner(f[0]), corner(f[1]), corner(f[2])], [corner(f[0]), corner(f[2]), corner(f[3])]);
      } else {
        const radius = part.params[0], halfHeight = part.type === 1 ? radius : (part.params[1] ?? 1) / 2, sides = 12;
        for (let i = 0; i < sides; i++) {
          const a = i / sides * Math.PI * 2, b = (i + 1) / sides * Math.PI * 2;
          const p0: V3 = [radius * Math.cos(a), -halfHeight, radius * Math.sin(a)], p1: V3 = [radius * Math.cos(b), -halfHeight, radius * Math.sin(b)];
          local.push([p0, p1, [p1[0], halfHeight, p1[2]]], [p0, [p1[0], halfHeight, p1[2]], [p0[0], halfHeight, p0[2]]]);
        }
      }
      const color: [number, number, number, number] = part.type === 4 ? [255, 80, 80, 140] : [80, 160, 255, 140];
      for (const tri of local) hitTris.push({ points: tri.map((v) => applyCollider(applyCollider(v, part.scale, part.rot, part.pos), objectScale, object.rot, objectPos).map((q) => q * 100) as V3), color });
    }
  }
  if (hitTris.length) {
    hitboxInstances.push(instances.length);
    instances.push({ name: 'static-object hitboxes', mesh: addMesh('collision: hitboxes', [solidBatch(hitTris, 'blend')]), matrix: IDENTITY(), noFog: true });
  }

  const rail: PathSample[] = [];
  for (const block of blocks) if (!block.list) for (let i = 0; i <= 40; i++) { const s = sampleRail(m, block, i / 40); if (s) rail.push(s); }
  let camera: CameraView = { eye: [0, 100, 0], target: [0, 100, 20], fovY: course.id === 'rainbow' ? 60 : 55 };
  if (rail.length) camera = { eye: rail[0].eye, target: rail[0].target, fovY: 55 };
  if (rail.length > 1) {
    const tris: { points: V3[]; color: [number, number, number, number] }[] = [], palette: [number, number, number][] = [[255, 60, 60], [255, 200, 40], [60, 220, 60], [40, 200, 255], [160, 90, 255], [255, 120, 220]];
    for (let i = 1; i < rail.length; i++) {
      const a = rail[i - 1], b = rail[i]; if (Math.hypot(a.eye[0] - b.eye[0], a.eye[1] - b.eye[1], a.eye[2] - b.eye[2]) > 3000) continue;
      const color = [...palette[b.block % palette.length], 255] as [number, number, number, number];
      const lo = (p: V3): V3 => [p[0], p[1] - 40, p[2]], hi = (p: V3): V3 => [p[0], p[1] + 40, p[2]];
      tris.push({ points: [lo(a.eye), lo(b.eye), hi(b.eye)], color }, { points: [lo(a.eye), hi(b.eye), hi(a.eye)], color });
    }
    railInstances.push(instances.length);
    instances.push({ name: 'rail path', mesh: addMesh('rail path', [solidBatch(tris, 'opaque')]), matrix: IDENTITY(), noFog: true });
  }

  const layers: LevelLayer[] = [{ name: 'course', kind: 'main', instances: main }];
  if (scenery.length) layers.push({ name: 'scenery', kind: 'background', instances: scenery });
  if (objects.length) layers.push({ name: 'static models', kind: 'objects', instances: objects });
  if (heightInstances.length) layers.push({ name: 'height map', kind: 'collision', instances: heightInstances, visibleByDefault: false, group: 'collision' });
  if (ceilingInstances.length) layers.push({ name: 'ceiling map', kind: 'collision', instances: ceilingInstances, visibleByDefault: false, group: 'collision' });
  if (hitboxInstances.length) layers.push({ name: 'hitboxes', kind: 'collision', instances: hitboxInstances, visibleByDefault: false, group: 'collision' });
  layers.push({ name: 'rail path', kind: 'markers', instances: railInstances, visibleByDefault: false });
  const notInBounds = new Set([...heightInstances, ...ceilingInstances, ...hitboxInstances, ...railInstances]);
  return { mem: m, textures: gfx.textures, meshes, instances, layers, markers: [], notInBounds, blocks, height,
    extra: { fog: fogPosition(fogMin, fogMax, fogRgb, 10, 25600), clearColor: bgRgb, camera, skies } };
}
