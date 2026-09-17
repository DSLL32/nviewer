import type { Batch, Instance, Level, LevelInfo, LevelLayer, Mesh, Texture } from '../types';
import { BanjoRom } from './archive';
import { parseModel, be, type Model, type GeoNode } from './model';
import { bkRunner, newStats, type DepthMode } from './displaylist';
import { addBanjoSky } from './sky';
import { parseBanjoSetup, resolveActorModel, type BanjoNode } from './objects';
import { addBanjoSprite } from './sprites';

const CORE2_RAM = 0x80363590;
const MODEL_TABLE = 0x8036abe0 - CORE2_RAM;
const SECTION_TABLE = 0x8036b810 - CORE2_RAM;

interface MapEntry { map: number; opaque: number; translucent: number; scale: number }
const idMatrix = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`;
const COLLECTIBLE_ACTORS = new Set([0x46, 0x47, 0x50, 0x49, 0x2d, 0x5e, 0x5f, 0x60, 0x61, 0x62, 0x51, 0x52, 0x129, 0x370]);
const COLLECTIBLE_SPRITES = new Set([0x6d6, 0x6d7, 0x580, 0x6d1]);
const EXIT_ACTORS = new Set([1, 2, 0x15, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x7b, 0x7c, 0x7d, 0x7e, 0x7f,
  0x75, 0x74, 0x73, 0x72, 0x103, 0x104, 0x105, 0x106, 0x107, 0x158, 0x15a, 0x15c,
  0x1cd, 0x1ce, 0x1cf, 0x1d0, 0x1d1, 0x1d2, 0x1d3, 0x1d4, 0x379]);

function transform(position: readonly number[], yaw: number, roll: number, scale: number, yScale = scale): Float32Array {
  const y = yaw * Math.PI / 180, r = roll * Math.PI / 180;
  const cy = Math.cos(y), sy = Math.sin(y), cr = Math.cos(r), sr = Math.sin(r);
  return new Float32Array([
    cy * cr * scale, sr * scale, -sy * cr * scale, 0,
    -cy * sr * yScale, cr * yScale, sy * sr * yScale, 0,
    sy * scale, 0, cy * scale, 0,
    position[0], position[1], position[2], 1,
  ]);
}

function cstr(buf: Uint8Array, ptr: number): string {
  const start = ptr - CORE2_RAM;
  if (start < 0 || start >= buf.length) return '';
  let end = start;
  while (end < buf.length && buf[end]) end++;
  return new TextDecoder('latin1').decode(buf.subarray(start, end));
}

export function mapEntries(core2: Uint8Array): MapEntry[] {
  const d = be(core2);
  const out: MapEntry[] = [];
  for (let i = 0; i < 128; i++) {
    const o = MODEL_TABLE + i * 0x18;
    const map = d.getInt16(o);
    if (!map) break;
    out.push({ map, opaque: d.getInt16(o + 2), translucent: d.getInt16(o + 4), scale: d.getFloat32(o + 0x14) });
  }
  if (out.length !== 128) throw new Error(`Banjo model table has ${out.length} maps, expected 128`);
  return out;
}

const WORLD_NAMES: Record<number, string> = {
  1: "Mumbo's Mountain", 2: 'Treasure Trove Cove', 3: "Clanker's Cavern", 4: 'Bubblegloop Swamp',
  5: 'Freezeezy Peak', 6: "Gruntilda's Lair", 7: "Gobi's Valley", 8: 'Click Clock Wood',
  9: 'Rusty Bucket Bay', 10: 'Mad Monster Mansion', 11: 'Spiral Mountain',
};

export function mapLevels(core2: Uint8Array, entries = mapEntries(core2)): LevelInfo[] {
  const d = be(core2);
  const names = new Map<number, { level: number; name: string }>();
  for (let i = 0; i < 155; i++) {
    const o = SECTION_TABLE + i * 8;
    const map = d.getInt16(o);
    if (i && !map) break;
    if (map) names.set(map, { level: d.getInt16(o + 2), name: cstr(core2, d.getUint32(o + 4)) });
  }
  const title = (raw: string, map: number) => {
    if (map === 0x8c) return "Banjo's House";
    if (map === 0x91) return 'File Select';
    let name = raw.replace(/^.*? - /, '').trim();
    if (!name) name = `Map ${hex(map)}`;
    return name.replace(/\s+/g, ' ');
  };
  return entries.map((entry, index) => {
    const row = names.get(entry.map);
    const lv = row?.level ?? 0;
    const cutscene = entry.map === 0x91 || lv >= 0x0c || /(?:Intro|End|Cutscene|File Select|Credits)/i.test(row?.name ?? '');
    return {
      index, name: title(row?.name ?? '', entry.map), kind: cutscene ? 'other' : 'adventure',
      group: cutscene ? 'Cutscenes and front end' : WORLD_NAMES[lv] ?? `World ${lv}`,
    };
  });
}

// At map load, modelRender_reset sets selector 1 to 1 and selector 2 to 0. Selected maps override these for
// world appendages (e.g. Spiral Mountain's intro and seasonal Mumbo skull variants).
export function selectorValues(map: number): number[] {
  const v = new Array<number>(0x2a).fill(0);
  v[1] = 1;
  const set = (i: number, x: number) => { v[i] = x; };
  switch (map) {
    case 0x01: set(1, 0); set(2, 1); break;
    case 0x12: set(1, 0); set(2, 1); set(5, 0); break;
    case 0x14: set(5, 0); break;
    case 0x0e: set(1, 1); set(5, 1); break;
    case 0x47: set(1, 2); set(5, 2); break;
    case 0x48: set(1, 3); set(5, 3); break;
    case 0x30: set(1, 4); set(5, 4); break;
    case 0x4a: set(1, 5); set(5, 5); break;
    case 0x4b: set(1, 6); set(5, 6); break;
    case 0x4c: set(1, 7); set(5, 7); break;
    case 0x4d: set(1, 8); set(5, 8); break;
    case 0x5e: case 0x5f: case 0x60: set(1, 1); set(2, 0); break;
    case 0x61: set(1, 0); set(2, 1); break;
    case 0x1d: set(1, 1); break;
    case 0x7c: case 0x89: case 0x8a: case 0x8c: case 0x91: set(5, 1); break;
    case 0x7b: case 0x81: set(4, 0); set(5, 0); set(6, 0); break;
    case 0x82: case 0x83: case 0x84: set(4, 1); set(5, 1); set(6, 1); break;
    case 0x93: set(4, 1); set(5, 1); set(6, 0); break;
  }
  return v;
}

export interface ModelPolicy { selector: number[]; camera: 'all' | 'inside' | 'outside'; lod: 'nearest' | 'all' }

export function buildModelBatches(model: Model, depth: DepthMode, textures: Texture[], keys: Map<string, number>, prefix: string,
  policy: ModelPolicy, scale = 1, ordered = false): Batch[] {
  const ctx = { textures, textureKeys: keys, keyPrefix: prefix, depth, scale, stats: newStats(), texWrap: 0, ordered };
  const runner = bkRunner(model, ctx);
  const exec = (nodes: GeoNode[]) => {
    for (const node of nodes) {
      const f = node.fields;
      switch (node.cmd) {
        case 3: case 7: runner.run(f.gfx as number); break;
        case 5: for (const gfx of f.gfx as number[]) runner.run(gfx); break;
        case 16: ctx.texWrap = f.mode as number; break;
        case 12: {
          const sel = policy.selector[f.index as number] ?? 0;
          if ((f.index as number) === 0 || sel === 0) break;
          const starts = f.offsets as number[];
          const children = new Map(starts.map((off) => [node.at + off, [] as GeoNode[]]));
          let current: GeoNode[] | undefined;
          for (const child of node.children) {
            if (children.has(child.at)) current = children.get(child.at);
            current?.push(child);
          }
          if (sel > 0) {
            if (sel <= starts.length) exec(children.get(node.at + starts[sel - 1]) ?? []);
          } else starts.forEach((off, i) => { if ((-sel >>> i) & 1) exec(children.get(node.at + off) ?? []); });
          break;
        }
        case 15: {
          const flags = f.flags as number;
          if (policy.camera === 'outside' && !(flags & 1)) break;
          if (policy.camera === 'inside' && !(flags & 2)) break;
          exec(node.children);
          break;
        }
        case 8: if (policy.lod === 'nearest' && (f.min as number) > 0) break; exec(node.children); break;
        default: exec(node.children);
      }
    }
  };
  exec(model.geo);
  return runner.batches();
}

function collisionBatch(model: Model, scale: number): Batch | null {
  if (!model.coll) return null;
  const d = be(model.buf);
  const seen = new Set<string>();
  const positions: number[] = [], colors: number[] = [];
  for (const tri of model.coll.tris) {
    const key = `${tri.a}/${tri.b}/${tri.c}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const color = tri.flags & 0x01000000 ? [255, 60, 200] : tri.flags & 0x4000 ? [255, 40, 0] : [150, 180, 180];
    for (const index of [tri.a, tri.b, tri.c]) {
      const o = model.vtx.start + index * 16;
      if (o < 0 || o + 6 > model.buf.length) continue;
      positions.push(d.getInt16(o) * scale, d.getInt16(o + 2) * scale, d.getInt16(o + 4) * scale);
      colors.push(...color, 255);
    }
  }
  return { texture: -1, blend: 'opaque', depthTest: true, depthWrite: true, cullBack: false,
    positions: new Float32Array(positions), uvs: new Float32Array(positions.length / 3 * 2), colors: new Uint8Array(colors) };
}

export function loadBanjoLevel(archive: BanjoRom, entry: MapEntry, info: LevelInfo): Level {
  const textures: Texture[] = [], meshes: Mesh[] = [], instances: Instance[] = [], layers: LevelLayer[] = [], unplaced: number[] = [];
  const keys = new Map<string, number>();
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const policy: ModelPolicy = { selector: selectorValues(entry.map), camera: 'all', lod: 'nearest' };
  const loadModel = (id: number) => parseModel(archive.asset(id));
  const add = (id: number, name: string, depth: DepthMode, scale: number, layerKind: LevelLayer['kind']) => {
    const model = loadModel(id);
    if (model.errors.length) throw new Error(`Banjo model ${hex(id)}: ${model.errors.slice(0, 4).join('; ')}`);
    const batches = buildModelBatches(model, depth, textures, keys, `${id}:`, policy, scale);
    let radius = 0;
    for (const batch of batches) for (let i = 0; i < batch.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], batch.positions[i + k]); max[k] = Math.max(max[k], batch.positions[i + k]); }
      radius = Math.max(radius, Math.hypot(batch.positions[i], batch.positions[i + 1], batch.positions[i + 2]));
    }
    const mesh = meshes.push({ name: `${name} ${hex(id)}`, radius, batches, info: { asset: hex(id) } }) - 1;
    const instance = instances.push({ name, mesh, matrix: idMatrix(), info: { asset: hex(id) } }) - 1;
    layers.push({ name, kind: layerKind, instances: [instance] });
    const collision = collisionBatch(model, scale);
    if (collision && collision.positions.length) {
      const collMesh = meshes.push({ name: `${name} collision`, radius, batches: [collision], info: { asset: hex(id) } }) - 1;
      const collInst = instances.push({ name: `${name} collision`, mesh: collMesh, matrix: idMatrix() }) - 1;
      layers.push({ name: `${name} collision`, kind: 'collision', instances: [collInst], visibleByDefault: false });
    }
  };
  add(entry.opaque, 'opaque map', 'full', entry.scale, 'main');
  if (entry.translucent) add(entry.translucent, 'translucent map', 'compare', entry.scale, 'main');
  const level: Level = { info, id: `bk-${entry.map.toString(16)}`, textures, meshes, instances, layers, unplaced,
    bounds: { min: min.map((v) => Number.isFinite(v) ? v : -500) as typeof min,
      max: max.map((v) => Number.isFinite(v) ? v : 500) as typeof max }, clearColor: [0, 0, 0] };
  addBanjoSky(level, entry.map, archive.core2, loadModel,
    (model, scale, skyTextures, skyKeys, prefix) => buildModelBatches(model, 'none', skyTextures, skyKeys, prefix,
      { selector: selectorValues(0), camera: 'all', lod: 'nearest' }, scale, true));
  addObjects(level, archive, entry.map);
  return level;
}

function addObjects(level: Level, archive: BanjoRom, map: number): void {
  const data = archive.asset(0x71c + map);
  if (!data.length) return;
  const setup = parseBanjoSetup(data);
  const layers = level.layers!;
  const meshCache = new Map<number, number>();
  const spriteCache = new Map<string, { mesh: number; sx: number; sy: number }>();
  const textureKeys = new Map<string, number>();
  const selected = new Array<number>(0x2a).fill(0); selected[1] = 1;
  const objectPolicy: ModelPolicy = { selector: selected, camera: 'all', lod: 'nearest' };
  const layerCache = new Map<string, number>();
  const layer = (name: string, kind: LevelLayer['kind'], visible = true): number => {
    let index = layerCache.get(name);
    if (index === undefined) {
      index = layers.push({ name, kind, visibleByDefault: visible, instances: [] }) - 1;
      layerCache.set(name, index);
    }
    return index;
  };
  const addMarker = (name: string, position: [number, number, number], node: BanjoNode, visible = false) => {
    const li = layer(name, 'markers', visible);
    (level.markers ??= []).push({ label: `${name} ${hex(node.actorId)}`, position, layer: li,
      info: { actorId: hex(node.actorId), markerId: hex(node.markerId), category: node.category,
        selector: node.selector, yaw: node.yaw, scale: node.scale, linkId: node.linkId } });
  };
  const modelMesh = (id: number): number => {
    const cached = meshCache.get(id);
    if (cached !== undefined) return cached;
    const model = parseModel(archive.asset(id));
    if (model.errors.length) throw new Error(`Banjo object model ${hex(id)}: ${model.errors.slice(0, 4).join('; ')}`);
    const batches = buildModelBatches(model, 'full', level.textures, textureKeys, `obj${id}:`, objectPolicy);
    const radius = Math.max(1, ...model.vtx.min.map(Math.abs), ...model.vtx.max.map(Math.abs));
    const index = level.meshes.push({ name: `object ${hex(id)}`, radius, batches, info: { asset: hex(id) } }) - 1;
    meshCache.set(id, index);
    return index;
  };
  const object = (id: number, position: [number, number, number], yaw: number, roll: number, scale: number,
    name: string, layerName: string, spriteOptions?: { frame?: number; mirror?: boolean; rgbReduction?: [number, number, number] }) => {
    const kind = archive.assetType(id);
    let mesh: number, sx = scale, sy = scale;
    if (kind === 0) mesh = modelMesh(id);
    else if (kind === 1) {
      const sprite = addBanjoSprite(level, id, archive.asset(id), spriteCache, spriteOptions);
      mesh = sprite.mesh; sx *= sprite.sx; sy *= sprite.sy;
    } else return;
    const index = level.instances.push({ name, mesh, matrix: transform(position, yaw, roll, sx, sy),
      ...(kind === 1 ? { billboard: 'y' as const } : {}),
      info: { asset: hex(id) } }) - 1;
    layers[layer(layerName, 'objects')].instances.push(index);
  };
  for (const node of setup.nodes) {
    if (node.kind) continue; // linked control points are not placed actors
    if (node.category !== 6) { addMarker(`category ${node.category}`, node.position, node); continue; }
    if (EXIT_ACTORS.has(node.actorId)) { addMarker('entrances', node.position, node, true); continue; }
    const asset = resolveActorModel(map, node.actorId);
    if (asset === undefined) { addMarker('unresolved actors', node.position, node); continue; }
    if (!asset) { addMarker('invisible controllers', node.position, node); continue; }
    object(asset, node.position, node.yaw, 0, node.scale, `actor ${hex(node.actorId)}`,
      COLLECTIBLE_ACTORS.has(node.actorId) ? 'collectibles' : 'actors');
  }
  for (const prop of setup.props) {
    object(prop.assetId, prop.position, prop.yaw, prop.roll, prop.scale,
      `${prop.kind} prop ${hex(prop.assetId)}`,
      prop.kind === 'sprite' ? (COLLECTIBLE_SPRITES.has(prop.assetId) ? 'collectibles' : 'sprites') : 'model props',
      prop.kind === 'sprite' ? { frame: prop.frame, mirror: prop.mirror, rgbReduction: prop.rgbReduction } : undefined);
  }
}
