// GoldenEye 007 (U): levels from the BG, environment, setup and clipping files (GOLDENEYE.md §2, §3, §6).
//
// Space: world units = BG units / the stage scale f0C (every stage at the same scale, about 1 unit per cm); right-handed,
// +Y up, no mirroring. Each BG room is one mesh centred on the room, placed by a translation (bg.ts RoomGeometry.center).
import { buildLevel } from '../bomberman/common';
import type { CameraView, DebugInfo, Game, Instance, Level, LevelInfo, LevelLayer, Marker, Mesh } from '../types';
import { view } from '../util';
import { type BgFile, buildRooms, parseBg, roomsVisibleFrom } from './bg';
import { findEnvironment, levelEnvironment } from './environment';
import {
  characterBatches, chrRef, hasHeadSpot, isHead, loadModel, type ModelFile, modelBatches, modelMesh, propRef, randomHead, slotsOffset, walkModel,
} from './models';
import { goldeneyeMusic } from './music';
import { padCentre, placeDoor, placeGuard, placeObject } from './place';
import { GeRom } from './rom';
import { type Guard, OBJECT_TYPE_NAME, padFor, parseSetup, type Setup, spawns, type Vec3 } from './setup';
import { collisionBatch, floorAt, parseStan, type Stan } from './stan';
import { GeTextures } from './textures';

// The player's eye above the floor, world units (§4.11).
const EYE_HEIGHT = 167.28;
const CUBA = 0x36;
const CITADEL = 0x28;

interface StageDef {
  stage: number;
  code: string; // setup code: "dam", "ark", "sevxb", "control" …
  setup: string | null; // setup file
  players: number; // environment selection: 1 for solo stages, 2 for multiplayer maps (their fewest players)
  info: LevelInfo;
}

// Missions in folder order grouped by mission, the multiplayer menu's maps (their Ump_setup files), then Cuba (the
// credits stage) and the unused Citadel. Stages whose BG file is empty are left out.
function stageList(r: GeRom): StageDef[] {
  const defs: Omit<StageDef, 'info'>[] = [];
  const infos: Omit<LevelInfo, 'index'>[] = [];
  const hasBg = (stage: number) => {
    const s = r.stageBg(stage);
    return !!s && r.hasFile(s.bg);
  };
  const codeOf = (stage: number) => r.setupName(stage)?.replace(/^Usetup(.*)Z$/, '$1') ?? `stage${stage.toString(16)}`;
  const add = (stage: number, setup: string | null, players: number, code: string, info: Omit<LevelInfo, 'index'>) => {
    if (!hasBg(stage)) return;
    defs.push({ stage, code, setup: setup && r.hasFile(setup) ? setup : null, players });
    infos.push(info);
  };
  let group = '';
  for (const f of r.missionFolders()) {
    if (f.header) group = `Mission ${f.label}: ${f.name}`;
    else add(f.stage, r.setupName(f.stage), 1, codeOf(f.stage), { name: f.name, kind: 'campaign', group });
  }
  for (const m of r.mpMaps()) {
    if (m.stage < 0) continue; // Random
    const solo = r.setupName(m.stage);
    add(m.stage, solo ? `Ump_${solo.slice(1)}` : null, 2, `mp_${codeOf(m.stage)}`, { name: m.name, kind: 'battle' });
  }
  add(CUBA, r.setupName(CUBA), 1, codeOf(CUBA), { name: `${r.textById(0x9c8c) ?? 'Cuba'} (credits)`, kind: 'other' });
  add(CITADEL, null, 1, codeOf(CITADEL), { name: `${r.textById(0x9cae) ?? 'Citadel'} (unused)`, kind: 'other' });
  return defs.map((d, index) => ({ ...d, info: { index, ...infos[index] } }));
}

// Distance along a ray to the nearest opaque triangle of the meshes (world units, instances at identity).
function clearance(rooms: { mesh: Mesh; at: number[] }[], eye: number[], d: number[]): number {
  let best = Infinity;
  for (const { mesh: m, at } of rooms) {
    const o = [eye[0] - at[0], eye[1] - at[1], eye[2] - at[2]];
    for (const b of m.batches) {
      if (b.blend === 'blend') continue;
      const t = b.positions;
      for (let i = 0; i + 9 <= t.length; i += 9) {
        const e1x = t[i + 3] - t[i], e1y = t[i + 4] - t[i + 1], e1z = t[i + 5] - t[i + 2];
        const e2x = t[i + 6] - t[i], e2y = t[i + 7] - t[i + 1], e2z = t[i + 8] - t[i + 2];
        const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-9) continue;
        const sx = o[0] - t[i], sy = o[1] - t[i + 1], sz = o[2] - t[i + 2];
        const u = (sx * px + sy * py + sz * pz) / det;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = (d[0] * qx + d[1] * qy + d[2] * qz) / det;
        if (v < 0 || u + v > 1) continue;
        const dist = (e2x * qx + e2y * qy + e2z * qz) / det;
        if (dist > 1e-3 && dist < best) best = dist;
      }
    }
  }
  return best;
}

// The start view (§3.7, §4.11): on a set-0 spawn pad, eye 167.28 units above the clipping floor under it, looking along
// the pad's look vector. Solo stages use the first spawn (the one the game used on the captured stages); multiplayer
// maps, where the game picks one at random, the spawn with the most open view ahead.
function spawnCamera(setup: Setup, stan: Stan | null, scale: number, meshes: { mesh: Mesh; at: number[] }[], multiplayer: boolean): CameraView | undefined {
  const all = spawns(setup);
  const set0 = all.filter((s) => s.set === 0);
  const views = (set0.length ? set0 : all.slice(0, 1)).map((spawn): CameraView => {
    const { pos, look } = spawn.pad;
    const floor = stan ? floorAt(stan, pos[0], pos[2], pos[1]) : null;
    const eye: [number, number, number] = [pos[0] / scale, (floor ? floor.y : pos[1]) / scale + EYE_HEIGHT, pos[2] / scale];
    const len = Math.hypot(look[0], look[1], look[2]) || 1;
    return { eye, target: [eye[0] + (look[0] / len) * 100, eye[1] + (look[1] / len) * 100, eye[2] + (look[2] / len) * 100], fovY: 60 };
  });
  if (!multiplayer || views.length < 2) return views[0];
  const open = (v: CameraView) => clearance(meshes, v.eye, [0, 1, 2].map((k) => (v.target[k] - v.eye[k]) / 100));
  return views.map((v) => ({ v, d: open(v) })).reduce((a, b) => (b.d > a.d ? b : a)).v;
}

// ---- objects (§4.8, §4.9) ----

/** Layer of each record type drawn with its prop model. */
export const OBJECT_LAYER: Record<number, string> = {
  0x01: 'doors', 0x03: 'objects', 0x04: 'pickups', 0x05: 'objects', 0x06: 'objects', 0x07: 'pickups', 0x08: 'pickups',
  0x0a: 'objects', 0x0b: 'objects', 0x0c: 'objects', 0x0d: 'objects', 0x11: 'objects', 0x14: 'pickups', 0x15: 'pickups',
  0x24: 'objects', 0x27: 'objects', 0x28: 'objects', 0x2a: 'glass', 0x2b: 'objects', 0x2d: 'objects', 0x2f: 'glass',
};
/** Records with nothing to place: door scale (applied to the doors after it), links, guard attributes, tags,
 * objectives, renames, door locks, safe items, cutscenes and the end record. Guards (0x09) are handled on their own. */
export const LOGIC_TYPES = new Set([0x02, 0x0e, 0x12, 0x13, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x20, 0x21, 0x22, 0x23, 0x25, 0x26, 0x2c, 0x2e, 0x30]);
const OBJECT_LAYERS = ['doors', 'objects', 'glass', 'pickups', 'guards'];
const MARKER_LAYERS = ['spawns', 'gas release points', 'multiplayer flags', 'objects not shown'];
// Multiplayer weapon records carry a placeholder model (Palarm1Z) and, at +0x80, a weapon-set slot 0xF0-0xF7 that the
// game replaces with the chosen set's weapon, drawn at prop scale × the set's pickup scale (verified in the Temple
// capture). Item 0x58 is the Flag Tag flag, which a normal match doesn't create.
const WEAPON_SETS = 0x80048670; // 14 sets × 8 slots × {s32 item; s32 prop model; f32 pickup scale; s32 ammo type; s32 ammo; s32}
const SHOWN_WEAPON_SET = 11; // the set active in the Temple capture (TT33, Klobb, KF7 Soviet, rocket launcher)
const FLAG_ITEM = 0x58;
// Weapon records with flag 0x100000 (all 44 are grenades, flags 0x3520008, with hatch-bolt, grenade or circuit-board
// models on Aztec, Egyptian, Statue, Train, Surface 2, Streets, Silo): the game instantiates them but doesn't draw them
// (the Egyptian capture has one in open view that the frame never draws). Hypothesis: script or guard grenade sources.
const HIDDEN_WEAPON = 0x100000;
// Not placed: 0x4000 = held or worn by a character (the pad field is its id); 0x8000 = not placed from a pad (pads -1,
// -2 …; in the captures these props sit unplaced at the origin: hypothesis, inventory or given by scripts).
const NOT_PLACED = 0x4000 | 0x8000;
const GUARD_MODEL_SCALE = 0.1; // × the character table scale (verified in RAM)

/**
 * Setup records as instances: one mesh per prop model number (guards: per body and head), one instance per record
 * placed as §4.8, in the layers doors, objects, glass, pickups and guards; spawns, gas-release volumes and records that
 * can't be drawn as markers in hidden layers (layer indices start at `firstLayer`).
 */
function addObjects(r: GeRom, setupName: string, setup: Setup, stan: Stan | null, scale: number, textures: GeTextures,
  meshes: Mesh[], instances: Instance[], firstLayer: number): { layers: LevelLayer[]; markers: Marker[] } {
  const hex = (v: number) => `0x${(v >>> 0).toString(16)}`;
  // Floor height in world units under world (x, z) for something at BG height yRef (§4.10).
  const floorY = (x: number, z: number, yRef: number) => {
    const f = stan ? floorAt(stan, x * scale, z * scale, yRef) : null;
    return (f ? f.y : yRef) / scale;
  };
  const world = (p: Vec3): Vec3 => [p[0] / scale, p[1] / scale, p[2] / scale];
  const layerInstances = new Map(OBJECT_LAYERS.map((name) => [name, [] as number[]]));
  const layerMarkers = new Map(MARKER_LAYERS.map((name) => [name, [] as Marker[]]));
  const marker = (layer: string, label: string, position: Vec3, info: DebugInfo) => layerMarkers.get(layer)!.push({ label, position, info });
  const place = (layer: string, name: string, mesh: number, matrix: Float32Array, info: DebugInfo) =>
    layerInstances.get(layer)!.push(instances.push({ name, mesh, matrix, info }) - 1);
  const meshKeys = new Map<string, number>();
  const meshFor = (key: string, build: () => Mesh | null) => {
    let index = meshKeys.get(key);
    if (index === undefined) {
      const mesh = build();
      index = mesh ? meshes.push(mesh) - 1 : -1;
      meshKeys.set(key, index);
    }
    return index;
  };
  const modelInfo = (m: ModelFile, table: string): DebugInfo => ({
    [table]: m.ref.index, file: m.ref.file, rom: hex(m.rom), header: hex(m.ref.header), nodes: m.nodeCount, matrices: m.numMatrices,
    triSource: `offset in the inflated model file (matrix slots appended at ${hex(slotsOffset(m))})`,
  });

  const addGuard = (g: Guard, info: DebugInfo) => {
    Object.assign(info, { chrId: g.chrId, pad: g.pad, body: g.body, head: g.head, aiList: hex(g.aiList), path: g.path, flags: hex(g.flags) });
    const pad = padFor(setup, g.pad);
    if (!pad) return;
    const x = pad.pos[0] / scale, z = pad.pos[2] / scale, floor = floorY(x, z, pad.pos[1]);
    const body = isHead(g.body) ? null : chrRef(r, g.body), bodyModel = loadModel(r, body);
    if (!body || !bodyModel) {
      marker('objects not shown', `guard with body ${g.body}`, [x, floor, z], info);
      return;
    }
    // Bodies with a head spot wear a separate head: the record's, else a fixed stand-in for the game's random pick.
    const headIndex = !hasHeadSpot(bodyModel) ? -1 : isHead(g.head) ? g.head : randomHead(r, body.male, Number(info.record));
    const head = headIndex >= 0 ? loadModel(r, chrRef(r, headIndex)) : null;
    const name = head ? `${body.file} + ${head.ref.file}` : body.file;
    const mesh = meshFor(`chr ${body.index}/${headIndex}`, () => modelMesh(name, characterBatches(bodyModel, head, textures), {
      ...modelInfo(bodyModel, 'body'), ...(head ? { head: headIndex, headFile: head.ref.file, headRom: hex(head.rom) } : {}), pose: 'standing (sampled from the Dam capture)',
    }));
    if (mesh < 0) {
      marker('objects not shown', `guard ${name}`, [x, floor, z], info);
      return;
    }
    const placed = placeGuard(pad, floor, GUARD_MODEL_SCALE * body.scale, scale);
    place('guards', name, mesh, placed.matrix, { ...info, padName: pad.name, ...(head && !isHead(g.head) ? { headShown: `${head.ref.file} (the game picks one at random)` } : {}) });
  };

  let doorScale = 1, guard = 0;
  for (const obj of setup.objects) {
    const type = obj.type, typeName = OBJECT_TYPE_NAME[type] ?? '?';
    const info: DebugInfo = { record: obj.index, type: `${hex(type)} ${typeName}`, setup: setupName, offset: hex(obj.offset) };
    if (type === 0x02) {
      doorScale = view(obj.raw).getInt32(4) / 65536;
      continue;
    }
    if (type === 0x09) {
      const g = setup.guards[guard++];
      if (g) addGuard(g, info);
      continue;
    }
    const layer = OBJECT_LAYER[type];
    if (!layer) continue;
    const flags = obj.flags ?? 0, padNumber = obj.pad ?? -1;
    Object.assign(info, { model: obj.model ?? -1, pad: padNumber, flags: hex(flags), flags2: hex(obj.flags2 ?? 0), extraScale: hex(obj.extraScale ?? 0x100) });
    if (type !== 0x01 && flags & NOT_PLACED) continue;
    // Doors store the bound-pad index itself (§4.2).
    const pad = type === 0x01 ? setup.boundPads[padNumber >= 10000 ? padNumber - 10000 : padNumber] : padFor(setup, padNumber);
    if (!pad) continue;
    info.padName = pad.name;
    let modelNumber = obj.model ?? -1, pickupScale = 1;
    if (type === 0x08) {
      const item = obj.raw[0x80];
      if (item === FLAG_ITEM) {
        marker('multiplayer flags', 'flag (Flag Tag)', world(padCentre(pad)), info);
        continue;
      }
      if (flags & HIDDEN_WEAPON) {
        marker('objects not shown', `hidden weapon ${propRef(r, modelNumber)?.file ?? modelNumber} (item 0x${item.toString(16)})`, world(padCentre(pad)), info);
        continue;
      }
      if (item >= 0xf0 && item < 0xf8) {
        const slot = WEAPON_SETS + (SHOWN_WEAPON_SET * 8 + item - 0xf0) * 24;
        modelNumber = r.s32(slot + 4);
        pickupScale = r.f32(slot + 8);
        Object.assign(info, { weaponSetSlot: item - 0xf0, shownWeapon: `set ${SHOWN_WEAPON_SET} item 0x${r.s32(slot).toString(16)} (the game uses the chosen weapon set)` });
      }
    }
    const ref = propRef(r, modelNumber), model = loadModel(r, ref);
    const label = `${typeName} ${ref?.file ?? `(model ${modelNumber})`}`;
    // Gas release records (Facility's gas tanks and barrels) are visible props placed like standard objects (RAM obj+0x58
    // equals this placement on all 19). The game moves the prop of those on bound pads to the raw pad position
    // (hypothesis: where the gas comes out), marked here.
    if (type === 0x24) marker('gas release points', label, world(pad.pos), info);
    const placed = !ref || !model ? null : type === 0x01
      ? placeDoor(pad, { scale, propScale: ref.scale, box: model.box, doorScale })
      : placeObject(obj, pad, { scale, propScale: ref.scale * pickupScale, box: model.box, floorY: (px, pz, p) => floorY(px, pz, p.pos[1]) });
    const mesh = placed && ref && model ? meshFor(`prop ${ref.index}`, () => modelMesh(ref.file, modelBatches(model, walkModel(model), textures), modelInfo(model, 'model'))) : -1;
    if (!placed || mesh < 0) {
      marker('objects not shown', label, world(padCentre(pad)), info);
      continue;
    }
    place(layer, ref!.file, mesh, placed.matrix, { ...info, modelFile: ref!.file, modelScale: +placed.modelScale.toFixed(5) });
  }

  for (const s of spawns(setup)) {
    const [x, y, z] = s.pad.pos;
    marker('spawns', `spawn (set ${s.set})`, [x / scale, floorY(x / scale, z / scale, y), z / scale],
      { intro: hex(s.record.offset), setup: setupName, pad: s.record.words[0], padName: s.pad.name, set: s.set });
  }

  const layers: LevelLayer[] = [];
  for (const [name, list] of layerInstances) if (list.length) layers.push({ name, kind: 'objects', instances: list });
  const markers: Marker[] = [];
  for (const [name, list] of layerMarkers) {
    if (!list.length) continue;
    const layer = firstLayer + layers.push({ name, kind: 'markers', instances: [], visibleByDefault: false }) - 1;
    for (const m of list) markers.push({ ...m, layer });
  }
  return { layers, markers };
}

function loadLevel(r: GeRom, def: StageDef): Level {
  const stageBg = r.stageBg(def.stage)!;
  const scale = stageBg.scale;
  const textures = new GeTextures(r);
  const meshes: Mesh[] = [];
  const instances: Instance[] = [];
  const layers: LevelLayer[] = [];

  // ---- BG rooms ----
  // Pieces the game draws without a depth test (Dam's surrounding mountains and reservoir water, Cuba's jungle wall)
  // are depth-tested like the rest (bg.ts RoomGeometry.backdrop) and get their own layer: the game only shows them when
  // its portals or visibility commands select their room, so free views can still show pieces the player never sees
  // together with the rest (a few Dam mountain tops above the cliffs at the spawn, visible to the player from the dam).
  const bg: BgFile = parseBg(r.load(stageBg.bg));
  const rooms = buildRooms(bg, textures, scale);
  const backdropLayer: LevelLayer = { name: 'backdrops', kind: 'background', instances: [], group: 'backdrops' };
  // Each room mesh is centred on its room, so the renderer's back-to-front sort of translucent batches orders rooms.
  const place = (layer: LevelLayer, mesh: Mesh | null, g: (typeof rooms)[number]) => {
    if (!mesh) return;
    const [x, y, z] = g.center;
    const index = instances.push({ name: mesh.name, mesh: meshes.push(mesh) - 1, matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]), info: { room: g.room } }) - 1;
    layer.instances.push(index);
  };
  // Backdrop rooms the game can't show while the player is anywhere on the clipping floor (drawn by no visibility command
  // for those rooms and reached by no portal, e.g. Dam rooms 3, 5 and 24) go to a hidden layer (bg.ts roomsVisibleFrom).
  const stan = r.hasFile(stageBg.stan) ? parseStan(r.load(stageBg.stan)) : null;
  const playable = new Set(stan?.tiles.map((t) => t.room) ?? []);
  const shown = playable.size ? roomsVisibleFrom(bg, playable) : null;
  const unseenLayer: LevelLayer = { name: 'backdrops (never visible from play)', kind: 'background', instances: [], visibleByDefault: false, group: 'backdrops' };
  for (const g of rooms) place(!shown || shown.has(g.room) ? backdropLayer : unseenLayer, g.backdrop, g);
  // One toggle per room.
  const roomLayers: LevelLayer[] = [];
  for (const g of rooms) {
    if (!g.mesh) continue;
    const layer: LevelLayer = { name: `room ${g.room}`, kind: 'main', instances: [], group: 'rooms' };
    place(layer, g.mesh, g);
    roomLayers.push(layer);
  }
  if (backdropLayer.instances.length) layers.push(backdropLayer);
  if (unseenLayer.instances.length) layers.push(unseenLayer);
  layers.push(...roomLayers);
  const roomMeshes = rooms.flatMap((g) => [g.mesh, g.backdrop].flatMap((mesh) => (mesh ? [{ mesh, at: g.center }] : [])));

  // ---- setup and clipping (spawn camera; objects use the same files) ----
  const setup = def.setup ? parseSetup(r.load(def.setup)) : null;

  // ---- objects: setup records (props, doors, pickups, guards, markers) ----
  const objects = setup ? addObjects(r, def.setup!, setup, stan, scale, textures, meshes, instances, layers.length) : null;
  if (objects) layers.push(...objects.layers);

  // ---- environment ----
  const env = levelEnvironment(findEnvironment(r, def.stage, def.players), stageBg.renderScale, textures);
  const camera = setup ? spawnCamera(setup, stan, scale, roomMeshes, def.players > 1) : undefined;

  const level = buildLevel(def.info, def.code, textures.textures, meshes, instances, {
    layers, ...(objects?.markers.length ? { markers: objects.markers } : {}), ...env, ...(camera ? { camera } : {}),
  });

  // ---- collision: the clipping tiles as a hidden overlay (stan.ts collisionBatch), appended after assembly so the
  // level's bounds and every other index stay as they are ----
  const collision = stan ? collisionBatch(stan, scale) : null;
  if (collision) {
    let radius = 0;
    for (let k = 0; k < collision.positions.length; k += 3) radius = Math.max(radius, Math.hypot(collision.positions[k], collision.positions[k + 1], collision.positions[k + 2]));
    const mesh = level.meshes.push({
      name: 'collision', radius, batches: [collision],
      info: { stan: stageBg.stan, tiles: stan!.tiles.length, triSource: 'offset of the clipping tile in the inflated stan file',
        colour: 'green floor, orange slope, magenta steep, cyan flag bits 0xF000; shaded by room' },
    }) - 1;
    const instance = level.instances.push({ name: 'collision', mesh, matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), info: { stan: stageBg.stan } }) - 1;
    level.layers!.push({ name: 'collision', kind: 'collision', instances: [instance], visibleByDefault: false });
  }
  return level;
}

export function openGoldenEye(rom: Uint8Array): Game {
  const r = new GeRom(rom);
  const defs = stageList(r);
  const music = goldeneyeMusic(rom);
  return {
    id: 'goldeneye',
    title: 'GoldenEye 007',
    levels: defs.map((d) => d.info),
    loadLevel: (i) => loadLevel(r, defs[i]),
    music: music.tracks,
    decodeMusic: (i) => music.decode(i),
  };
}
