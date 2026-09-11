// Perfect Dark setup objects and characters as level instances (PERFECTDARK.md §5, §7.4 step 3): one mesh per model file
// (characters: per body, head and stand pose), one instance per placed record, in the layers props, doors, glass, weapons,
// vehicles and characters; spawn and multiplayer pads, pad effects, cutscene cameras and records that can't be drawn as
// markers in hidden layers. Difficulty Agent.
import { mergeBatches } from '../bomberman/common';
import type { DebugInfo, Instance, LevelLayer, Marker, Mesh } from '../types';
import { poseModel, standAnimation } from './anim';
import type { RoomMesh } from './bg';
import {
  bodyEntry, bodyHasHead, type Box, headSpot, loadModel, meshOf, modelBatches, modelState, type PdModel, randomHead, restSlots,
} from './models';
import { parsePads, type Pad } from './pads';
import { type Floor, placeChr, placeDoor, placeEscalatorStep, placeObject, placementCentre, standsOnFloor } from './place';
import type { PdRom } from './rom';
import { OBJECT_TYPE_NAME, parseSetup, type SetupObject } from './setup';
import type { PdTextures } from './texture';

type Vec3 = [number, number, number];

const OBJECT_LAYER: Record<number, string> = {
  0x01: 'doors',
  0x2a: 'glass', 0x2f: 'glass',
  0x04: 'weapons', 0x07: 'weapons', 0x08: 'weapons', 0x14: 'weapons', 0x15: 'weapons', 0x3a: 'weapons',
  0x27: 'vehicles', 0x28: 'vehicles', 0x2d: 'vehicles', 0x33: 'vehicles', 0x37: 'vehicles', 0x39: 'vehicles',
  0x03: 'props', 0x05: 'props', 0x06: 'props', 0x0a: 'props', 0x0b: 'props', 0x0c: 'props', 0x0d: 'props', 0x0f: 'props',
  0x11: 'props', 0x24: 'props', 0x2b: 'props', 0x30: 'props', 0x35: 'props', 0x36: 'props', 0x3b: 'props',
};
/** Records without anything to draw: links, tags, objectives, briefings, renames, door locks, safe items, blocked paths. */
const LOGIC_TYPES = new Set([0x0e, 0x10, 0x12, 0x13, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x25, 0x26, 0x29, 0x2c, 0x31, 0x32]);
const OBJECT_LAYERS = ['props', 'doors', 'glass', 'weapons', 'vehicles', 'characters'];
const MARKER_LAYERS = ['spawn pads', 'multiplayer pads', 'pad effects', 'cutscene cameras', 'objects not shown'];

const T_DOORSCALE = 0x02, T_WEAPON = 0x08, T_CHR = 0x09, T_MULTIAMMOCRATE = 0x14, T_SHIELD = 0x15, T_CAMERAPOS = 0x2e;
const T_PADEFFECT = 0x38, T_MINE = 0x3a;
/** Objects that move at run time, shown where the setup puts them: lifts (at their first stop), hovercars and choppers (AI paths). */
const T_LIFT = 0x30;
const T_ESCASTEP = 0x3b;
const MOVING = new Set([T_LIFT, 0x37, 0x39, T_ESCASTEP]);
// Escalator steps: every step record of an escalator names the same pad; the setup handler (0x7F00FBBC) gives the steps
// frames 0, 40, 80 … in record order (one counter per path) and the tick (0x7F078094) advances the frame and puts the step
// at that frame of its path. Paths: {s32 frame; f32 x, y, z} until frame -1, the last frame is the loop length. Shown: the
// steps at their start frames (verified: path positions = 80/80 live steps in the Air Base captures).
const ESCALATOR_PATHS = [0x80069bd8, 0x80069c48]; // steps without / with flag 0x10000000
const ESCASTEP_TURNED = 0x10000000;
const ESCASTEP_SPACING = 40;

/** The point of escalator path `path` at `frame`, or null. */
function escalatorPoint(r: PdRom, path: number, frame: number): number[] | null {
  const points: { frame: number; p: number[] }[] = [];
  for (let a = ESCALATOR_PATHS[path]; points.length < 64 && r.s32(a) >= 0; a += 16) points.push({ frame: r.s32(a), p: [r.f32(a + 4), r.f32(a + 8), r.f32(a + 12)] });
  const cycle = points.length >= 2 ? points[points.length - 1].frame : 0;
  if (cycle <= 0) return null;
  const f = frame % cycle;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i], b = points[i + 1];
    if (f < b.frame) return a.p.map((v, k) => v + ((b.p[k] - v) * (f - a.frame)) / (b.frame - a.frame));
  }
  return null;
}
const EXCLUDED_ON_AGENT = 0x10; // flags2: the setup loop skips the record on Agent
const FLAG_HELD = 0x4000; // held by the character whose number is in the pad field
const FLAG_NOT_PLACED = 0x8000;
// Characters: spawn flags 0xE0 limit the difficulties (0x20 Agent, 0x40 Special Agent, 0x80 Perfect Agent; 0x7F02D594).
const CHR_DIFFICULTY_BITS = 0xe0, CHR_ON_AGENT = 0x20;
const CHR_MODEL_SCALE = 0.1; // × the body table scale (0x7F02CE8C)
// Multiplayer weapon records name a slot (0xF0 + n) that the game fills from the chosen weapon set (0x7F188BE4): the n-th
// usable entry, cyclically, of the set's six g_MpWeapons indices (0x800ACB88 + 0x18). The weapon set isn't in the ROM;
// shown: the set of the Skedar arena capture (Falcon 2, MagSec 4, Falcon 2, DY357 Magnum, shield, nothing), whose
// weapons and shields match the RAM records.
const MP_WEAPONS = 0x80087268; // 10-byte entries {u8 weapon; u8 ammo type; …; s16 model +6; s16 extra scale +8}
const SHOWN_WEAPON_SET = [1, 4, 1, 7, 37, 38];
const MP_WEAPON_NONE = 92, MP_WEAPON_SHIELD = 91, MP_SHIELD_MODEL = 244;
// Floors. Pads sit above the floor by varying amounts (a Defection guard's 20 units, the Skedar arena's weapons 71..198, a
// Crash Site hoverbike 1414): characters stand on the highest room floor within CHR_FLOOR of their pad; objects that stand
// on the floor land on the highest room surface or top of an earlier placed prop within OBJECT_FLOOR (objInit raycasts
// the collision and objects: RAM positions of Defection, Villa, Crash Site and the Skedar arena).
const CHR_FLOOR = { above: 30, below: 400 };
const OBJECT_FLOOR = { above: 5, below: 2000 };
const HUMAN_SKELETON = 9; // 0x7F02CE8C attaches a head only to bodies with this skeleton (0x8007CE40)

const hex = (v: number) => `0x${(v >>> 0).toString(16)}`;

interface MpWeapon { entry: number; weapon: number; ammo: number; model: number; extraScale: number }

function mpWeapon(r: PdRom, entry: number): MpWeapon {
  const a = MP_WEAPONS + entry * 10;
  return { entry, weapon: r.u8(a), ammo: r.u8(a + 1), model: r.s16(a + 6), extraScale: r.s16(a + 8) };
}

function mpSlot(r: PdRom, slot: number): MpWeapon {
  let wanted = slot + 1, left = wanted, k = 0, entry = SHOWN_WEAPON_SET[0];
  while (left > 0) {
    entry = SHOWN_WEAPON_SET[k];
    if (mpWeapon(r, entry).weapon !== MP_WEAPON_NONE) left--;
    if (left <= 0) break;
    if (++k >= SHOWN_WEAPON_SET.length) {
      k = 0;
      if (left === wanted) return mpWeapon(r, 0);
      wanted = left;
    }
  }
  return mpWeapon(r, entry);
}

/** The highest upward-facing room surface under (x, z) between y + above and y - below, or null. */
function floorBelow(rooms: RoomMesh[], p: readonly number[], w: { above: number; below: number }): number | null {
  const [x, y, z] = p;
  let best: number | null = null;
  for (const { room, mesh, center, sky } of rooms) {
    if (sky || x < room.bboxMin[0] - 1 || x > room.bboxMax[0] + 1 || z < room.bboxMin[2] - 1 || z > room.bboxMax[2] + 1) continue;
    if (y + w.above < room.bboxMin[1] - 1 || y - w.below > room.bboxMax[1] + 1) continue;
    const lx = x - center[0], lz = z - center[2];
    for (const b of mesh.batches) {
      if (b.blend === 'blend') continue;
      const t = b.positions;
      for (let i = 0; i + 9 <= t.length; i += 9) {
        const ax = t[i], az = t[i + 2], bx = t[i + 3], bz = t[i + 5], cx = t[i + 6], cz = t[i + 8];
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(d) < 1e-9) continue;
        const u = ((bz - cz) * (lx - cx) + (cx - bx) * (lz - cz)) / d;
        const v = ((cz - az) * (lx - cx) + (ax - cx) * (lz - cz)) / d;
        if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
        // Upward-facing: counter-clockwise seen from above.
        const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
        if (ny <= 0) continue;
        const hy = u * t[i + 1] + v * t[i + 4] + (1 - u - v) * t[i + 7] + center[1];
        if (hy <= y + w.above && hy >= y - w.below && (best === null || hy > best)) best = hy;
      }
    }
  }
  return best;
}

/** The inverse of an affine column-major matrix as a point transform, or null when singular. */
function inverseAffine(m: ArrayLike<number>): ((p: readonly number[]) => number[]) | null {
  const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
  return (p) => {
    const x = p[0] - m[12], y = p[1] - m[13], z = p[2] - m[14];
    return [inv[0] * x + inv[1] * y + inv[2] * z, inv[3] * x + inv[4] * y + inv[5] * z, inv[6] * x + inv[7] * y + inv[8] * z];
  };
}

export interface ObjectStats {
  placed: number;
  excluded: number; // by difficulty
  held: number; // by characters
  notPlaced: number; // flag 0x8000 or no pad: created by scripts, or cutscene props moved by AI lists
  notShown: number; // markers in "objects not shown"
  unhandled: Map<number, number>; // record type → count
}

export interface Objects {
  layers: LevelLayer[];
  markers: Marker[];
  stats: ObjectStats;
}

export interface ObjectsInput {
  setupFile: number;
  padsFile: number;
  multiplayer: boolean;
  textures: PdTextures;
  meshes: Mesh[];
  instances: Instance[];
  rooms: RoomMesh[];
  firstLayer: number; // index the first returned layer will have in Level.layers
}

export function addObjects(r: PdRom, input: ObjectsInput): Objects {
  const { textures, meshes, instances, rooms } = input;
  const setupName = r.names[input.setupFile];
  const setup = parseSetup(r.file(input.setupFile));
  const pads = parsePads(r.file(input.padsFile)).pads;
  const stats: ObjectStats = { placed: 0, excluded: 0, held: 0, notPlaced: 0, notShown: 0, unhandled: new Map() };
  const layerInstances = new Map(OBJECT_LAYERS.map((name) => [name, [] as number[]]));
  const layerMarkers = new Map(MARKER_LAYERS.map((name) => [name, [] as Marker[]]));
  const marker = (layer: string, label: string, position: Vec3, info: DebugInfo) => {
    layerMarkers.get(layer)!.push({ label, position, info });
    if (layer === 'objects not shown') stats.notShown++;
  };
  const meshKeys = new Map<string, number>();
  const meshFor = (key: string, build: () => Mesh | null) => {
    let index = meshKeys.get(key);
    if (index === undefined) {
      const mesh = build();
      meshKeys.set(key, (index = mesh ? meshes.push(mesh) - 1 : -1));
    }
    return index;
  };
  const modelInfo = (m: PdModel): DebugInfo => ({
    file: m.name, fileId: m.file, rom: hex(r.fileRom(m.file)), nodes: m.nodes.length, matrices: m.numMatrices,
    ...(m.box ? { box: m.box.map((v) => +v.toFixed(1)).join(', ') } : {}),
  });
  const propMesh = (m: PdModel) => meshFor(`prop ${m.file}`, () => {
    const built = modelBatches(m, restSlots(m, true), textures);
    return meshOf(m.name, built.batches, {
      ...modelInfo(m), dlNodes: built.dlNodes, triangles: built.triangles,
      ...(built.stats.missingTextures.size ? { missingTextures: [...built.stats.missingTextures].map(hex).join(' ') } : {}),
      triSource: 'offset in the inflated model file', pose: 'rest pose, root joint at the object position',
    });
  });
  const padInfo = (pad: Pad): DebugInfo => ({ padPosition: pad.pos.map((v) => +v.toFixed(1)).join(', ') });

  // Held objects, by character number (the stand animation depends on the guns in hand).
  const held = new Map<number, SetupObject[]>();
  for (const o of setup.objects) {
    if (o.flags & FLAG_HELD && !(o.flags2 & EXCLUDED_ON_AGENT) && (o.type === T_WEAPON || o.type === T_MINE)) held.set(o.pad, [...(held.get(o.pad) ?? []), o]);
  }

  // Tops of the props placed so far (upright ones: their box's x/z extent is their footprint).
  const tops: { record: number; toLocal: (p: readonly number[]) => number[]; box: Box; top: number }[] = [];
  const addTop = (record: number, m: Float32Array, box: Box) => {
    const up = Math.hypot(m[4], m[5], m[6]);
    const toLocal = inverseAffine(m);
    if (!(up > 0) || Math.abs(m[5]) < 0.95 * up || !toLocal) return;
    let top = -Infinity;
    for (const x of [box[0], box[1]]) for (const y of [box[2], box[3]]) for (const z of [box[4], box[5]]) top = Math.max(top, m[1] * x + m[5] * y + m[9] * z + m[13]);
    tops.push({ record, toLocal, box, top });
  };
  const objectFloor = (c: readonly number[]): { floor?: Floor; source: string } => {
    const room = floorBelow(rooms, c, OBJECT_FLOOR);
    let floor: Floor | undefined = room === null ? undefined : { y: room, onObject: false };
    let source = room === null ? 'none found: pad height' : 'room';
    for (const t of tops) {
      if (t.top > c[1] + OBJECT_FLOOR.above || t.top < c[1] - OBJECT_FLOOR.below || (floor && t.top <= floor.y)) continue;
      const [lx, , lz] = t.toLocal(c);
      if (lx < t.box[0] || lx > t.box[1] || lz < t.box[4] || lz > t.box[5]) continue;
      floor = { y: t.top, onObject: true };
      source = `top of record ${t.record}`;
    }
    return { floor, source };
  };

  const objects = new Map(setup.objects.map((o) => [o.index, o]));
  const lifts: { record: number; instance: number }[] = [];
  const riders: { instance: number; centre: readonly number[] }[] = [];
  const escalatorSteps = [0, 0]; // steps placed so far per escalator path
  let doorScale = 1;
  let lastSlot: MpWeapon | null = null;
  for (const rec of setup.records) {
    const dv = new DataView(rec.raw.buffer, rec.raw.byteOffset, rec.raw.byteLength);
    const typeName = OBJECT_TYPE_NAME[rec.type] ?? '?';
    const info: DebugInfo = { record: rec.index, type: `${hex(rec.type)} ${typeName}`, setup: setupName, offset: hex(rec.offset) };
    if (rec.type === T_DOORSCALE && rec.raw.length >= 8) {
      doorScale = dv.getInt32(4) / 65536;
      continue;
    }
    if (rec.type === T_CAMERAPOS && rec.raw.length >= 28) {
      const pos: Vec3 = [dv.getInt32(4) / 100, dv.getInt32(8) / 100, dv.getInt32(12) / 100];
      marker('cutscene cameras', `camera (record ${rec.index})`, pos, { ...info, theta: +(dv.getInt32(16) / 65536).toFixed(3), verta: +(dv.getInt32(20) / 65536).toFixed(3), pad: dv.getInt32(24) });
      continue;
    }
    if (rec.type === T_PADEFFECT && rec.raw.length >= 12) {
      const pad = pads[dv.getInt32(8)];
      if (pad) marker('pad effects', `pad effect ${dv.getInt32(4)}`, pad.pos, { ...info, effect: dv.getInt32(4), pad: pad.index });
      continue;
    }
    if (rec.type === T_CHR || LOGIC_TYPES.has(rec.type)) continue;
    const obj = objects.get(rec.index);
    const layer = OBJECT_LAYER[rec.type];
    if (!obj || !layer) {
      stats.unhandled.set(rec.type, (stats.unhandled.get(rec.type) ?? 0) + 1);
      continue;
    }
    let { model, flags } = obj;
    let type = rec.type === T_MINE ? T_WEAPON : rec.type; // the handler rewrites mines to weapons
    let extraScale = obj.extraScale;
    Object.assign(info, { model, pad: obj.pad, flags: hex(flags), flags2: hex(obj.flags2), extraScale: hex(extraScale) });
    if (obj.flags2 & EXCLUDED_ON_AGENT) {
      stats.excluded++;
      continue;
    }
    if (flags & FLAG_HELD) {
      stats.held++;
      continue;
    }
    const pad = pads[obj.pad];
    if (flags & FLAG_NOT_PLACED || !pad) {
      stats.notPlaced++;
      continue;
    }
    Object.assign(info, padInfo(pad));
    const slot = type === T_WEAPON ? rec.raw[0x5c] : 0;
    if (type === T_WEAPON && slot >= 0xf0) {
      const w = (lastSlot = mpSlot(r, slot - 0xf0));
      Object.assign(info, { weaponSetSlot: slot - 0xf0, shownWeapon: `g_MpWeapons ${w.entry}: weapon ${w.weapon} (the Skedar arena capture's weapon set; the game uses the chosen set)` });
      // The handler writes the entry's model and extra scale; a shield entry becomes a SHIELD record with its own model.
      extraScale = w.extraScale;
      model = w.weapon === MP_WEAPON_SHIELD ? MP_SHIELD_MODEL : w.model;
      if (w.weapon === MP_WEAPON_SHIELD) type = T_SHIELD;
    } else if (type === T_WEAPON) {
      info.weapon = slot;
    }
    const state = modelState(r, model);
    const m = state ? loadModel(r, state.file) : null;
    const label = `${typeName} ${m?.name ?? `(model ${model})`}`;
    // Multiplayer ammo crates after a slot whose weapon has no ammo (the shield) aren't created (6 of 30 in the capture).
    if (input.multiplayer && type === T_MULTIAMMOCRATE && lastSlot && !lastSlot.ammo) {
      marker('objects not shown', `${label} (not created: its weapon slot has no ammo)`, pad.pos, info);
      continue;
    }
    if (!state || !m) {
      marker('objects not shown', label, pad.pos, info);
      continue;
    }
    let placed;
    if (type === 0x01) {
      placed = placeDoor(pad, m.box, doorScale);
    } else {
      const snap = standsOnFloor(obj, m.box) ? objectFloor(placementCentre(pad)) : null;
      if (snap) info.floor = snap.source;
      placed = placeObject(obj, type, pad, state.scale, extraScale / 256, m.box, snap?.floor);
    }
    if (type === T_ESCASTEP) {
      const path = flags & ESCASTEP_TURNED ? 1 : 0;
      const frame = ESCASTEP_SPACING * escalatorSteps[path]++;
      const at = escalatorPoint(r, path, frame);
      if (at) {
        placed = placeEscalatorStep(placed, path === 1, at);
        delete info.floor;
        Object.assign(info, { escalatorPath: hex(ESCALATOR_PATHS[path]), escalatorFrame: frame });
      }
    }
    const mesh = propMesh(m);
    if (mesh < 0) {
      marker('objects not shown', `${label} (nothing drawn)`, placed.position, info);
      continue;
    }
    Object.assign(info, { modelFile: m.name, modelScale: +placed.modelScale.toFixed(5), ...(type === 0x01 && doorScale !== 1 ? { doorScale } : {}) });
    const layerName = type === T_SHIELD ? 'weapons' : layer;
    const instance = instances.push({ name: m.name, mesh, matrix: placed.matrix, ...(MOVING.has(type) ? { animated: true } : {}), info }) - 1;
    layerInstances.get(layerName)!.push(instance);
    if (layerName === 'props' && m.box && type !== T_ESCASTEP) addTop(rec.index, placed.matrix, m.box);
    if (type === T_LIFT) lifts.push({ record: rec.index, instance });
    else if (type !== 0x01) riders.push({ instance, centre: placementCentre(pad) });
    stats.placed++;
  }

  // Objects inside a lift's box ride it: Defection's tinted lift windows move with their lifts in RAM. Doors aren't riders:
  // lift doors are landing doors (LINKLIFTDOOR, one per stop) and Air Force One's grate in a lift shaft opens in place.
  for (const lift of lifts) {
    const { matrix: m, mesh } = instances[lift.instance];
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const b of meshes[mesh].batches) {
      const p = b.positions;
      for (let k = 0; k < p.length; k += 3) {
        for (let c = 0; c < 3; c++) {
          const v = m[c] * p[k] + m[4 + c] * p[k + 1] + m[8 + c] * p[k + 2] + m[12 + c];
          min[c] = Math.min(min[c], v);
          max[c] = Math.max(max[c], v);
        }
      }
    }
    for (const rider of riders) {
      if (![0, 1, 2].every((c) => rider.centre[c] >= min[c] && rider.centre[c] <= max[c])) continue;
      const inst = instances[rider.instance];
      instances[rider.instance] = { ...inst, animated: true, info: { ...inst.info, ridesLift: `record ${lift.record}` } };
    }
  }

  // ---- characters ----
  for (const c of setup.chrs) {
    const info: DebugInfo = {
      record: c.index, type: `${hex(T_CHR)} CHR`, setup: setupName, offset: hex(c.offset), chrNum: c.chrNum, pad: c.pad, body: c.body, head: c.head,
      spawnFlags: hex(c.spawnFlags), aiList: hex(c.aiList),
    };
    if (c.spawnFlags & CHR_DIFFICULTY_BITS && !(c.spawnFlags & CHR_ON_AGENT)) {
      stats.excluded++;
      continue;
    }
    const pad = pads[c.pad];
    if (!pad) {
      stats.notPlaced++;
      continue;
    }
    Object.assign(info, padInfo(pad));
    const floor = floorBelow(rooms, pad.pos, CHR_FLOOR);
    const floorY = floor ?? pad.pos[1];
    info.floor = floor === null ? 'none found: pad height' : +(floor - pad.pos[1]).toFixed(1);
    const body = bodyEntry(r, c.body), bodyModel = body ? loadModel(r, body.file) : null;
    if (!body || !bodyModel) {
      marker('objects not shown', `character with body ${c.body}`, [pad.pos[0], floorY, pad.pos[2]], info);
      continue;
    }
    const takesHead = bodyHasHead(body) && bodyModel.skeleton === HUMAN_SKELETON && !!headSpot(bodyModel);
    const headIndex = !takesHead ? -1 : c.head >= 0 ? c.head : randomHead(r, body, c.index);
    const head = headIndex >= 0 ? bodyEntry(r, headIndex) : null;
    const headModel = head ? loadModel(r, head.file) : null;
    const guns = held.get(c.chrNum) ?? [];
    const stand = standAnimation(r, c.body, guns.map((g) => ({ weapon: g.raw[0x5c], flags: g.flags })));
    const name = headModel ? `${bodyModel.name} + ${headModel.name}` : bodyModel.name;
    const mesh = meshFor(`chr ${c.body}/${headIndex}/${stand.anim}/${stand.flip}`, () => {
      const pose = poseModel(r, bodyModel, stand.anim, 0, { flip: stand.flip, animScale: body.animScale, stand: true });
      if (!pose) return null;
      const built = modelBatches(bodyModel, pose.slots, textures);
      const spot = headSpot(bodyModel);
      const headBuilt = headModel && spot && pose.nodes.get(spot) ? modelBatches(headModel, restSlots(headModel, false), textures, pose.nodes.get(spot)) : null;
      // Body and head batches with the same texture and render state are drawn as one.
      return meshOf(name, mergeBatches([...built.batches, ...(headBuilt?.batches ?? [])]), {
        ...modelInfo(bodyModel), body: c.body, bodyScale: +body.scale.toFixed(4), animScale: +body.animScale.toFixed(4),
        pose: `stand animation ${stand.anim} frame 0${stand.flip ? ' flipped' : ''} (${stand.rule})`,
        rootHeight: +((pose.rootMotion?.pos[1] ?? 0) * body.animScale).toFixed(1),
        ...(headBuilt ? { head: headIndex, headFile: headModel!.name, headRom: hex(r.fileRom(headModel!.file)), headTriangles: headBuilt.triangles } : {}),
        triSource: headBuilt ? 'offset in the inflated body file; within a batch the head file\'s triangles follow the body\'s' : 'offset in the inflated model file',
      });
    });
    if (mesh < 0) {
      marker('objects not shown', `character ${name}`, [pad.pos[0], floorY, pad.pos[2]], info);
      continue;
    }
    const placed = placeChr(pad, floorY, CHR_MODEL_SCALE * body.scale);
    Object.assign(info, {
      bodyFile: bodyModel.name, ...(headModel ? { headFile: headModel.name } : {}), ...(c.head < 0 && headModel ? { headShown: 'stand-in for the head the game picks at random' } : {}),
      ...(guns.length ? { held: guns.map((g) => `record ${g.index} weapon ${g.raw[0x5c]}`).join(', ') } : {}), modelScale: +placed.modelScale.toFixed(5),
    });
    layerInstances.get('characters')!.push(instances.push({ name, mesh, matrix: placed.matrix, info }) - 1);
    stats.placed++;
  }

  // ---- intro pads ----
  setup.intro.forEach((cmd, n) => {
    const kind = cmd.cmd === 0 ? 'spawn pads' : cmd.cmd >= 9 && cmd.cmd <= 11 ? 'multiplayer pads' : null;
    if (!kind) return;
    const padNumber = cmd.cmd === 11 ? cmd.args[0] : cmd.cmd === 0 ? cmd.args[0] : cmd.args[1];
    const pad = pads[padNumber];
    if (!pad) return;
    const label = cmd.cmd === 0 ? `spawn ${n}` : `${['case', 'case respawn', 'hill'][cmd.cmd - 9]} pad${cmd.cmd === 11 ? '' : ` (${cmd.args[0]})`}`;
    marker(kind, label, pad.pos, { intro: hex(cmd.offset), setup: setupName, command: cmd.cmd, pad: padNumber, args: cmd.args.join(', ') });
  });

  const layers: LevelLayer[] = [];
  for (const [name, list] of layerInstances) if (list.length) layers.push({ name, kind: 'objects', instances: list });
  const markers: Marker[] = [];
  for (const [name, list] of layerMarkers) {
    if (!list.length) continue;
    const layer = input.firstLayer + layers.push({ name, kind: 'markers', instances: [], visibleByDefault: false }) - 1;
    for (const m of list) markers.push({ ...m, layer });
  }
  return { layers, markers, stats };
}
