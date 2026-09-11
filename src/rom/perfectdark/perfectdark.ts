// Perfect Dark (U) V1.0: levels from the stage table's BG, pads and setup files (PERFECTDARK.md §3, §4, §7).
//
// Space: BG units (world = room position + vertex), right-handed, +Y up, no mirroring. The stages the game draws at half
// scale (stage table +0x18 = 0.5) are shown unscaled: BG, pads and setups share one space, and only the fog's near/far
// planes need the scale (§4.7, §4.9).
import { buildLevel } from '../bomberman/common';
import type { CameraView, Game, Instance, Level, LevelInfo, LevelLayer, Mesh, Sky } from '../types';
import { buildRooms, isStubBg, parseBg, type PdBg, type RoomMesh } from './bg';
import { resolveCoplanar } from './coplanar';
import { findEnvironment, levelEnvironment } from './environment';
import { perfectDarkMusic } from './music';
import { addObjects } from './objects';
import { parsePads, readSpawnPads } from './pads';
import { PdRom, type StageRecord } from './rom';
import { PdTextures } from './texture';
import { collisionMesh, parseTiles } from './tiles';
import { PdVisibility, type PlayVisibility } from './visibility';

// A standing player's eye is 159 units above the floor; spawn pads sit 47 above it (verified in the Defection capture).
const EYE_ABOVE_SPAWN_PAD = 112;
const OPEN_VIEW_CAP = 3000; // arena start views: units of open space ahead that count
const CARRINGTON_INSTITUTE = 0x26;
const RANDOM_ARENA = 0x01;
const TEXT_CARRINGTON_INSTITUTE = 0x56a1;
const TEXT_RETAKING_THE_INSTITUTE = 0x56a9; // the cut special assignment's menu name (§10.1)

interface StageDef {
  stage: StageRecord;
  code: string; // setup code: "ame", "wax", "mp10" …
  setup: number; // setup file id (solo, or multiplayer for arenas), 0 when stubbed out
  multiplayer: boolean;
  info: LevelInfo;
}

/**
 * The menus' stages (§3.5): the 21 solo missions grouped as the mission select groups them ("Mission 1" … "Special
 * Assignments"), Carrington Institute, the Combat Simulator arenas by group, then the unused stages with real geometry.
 * Entries whose BG is a stub are left out.
 */
function stageList(r: PdRom): StageDef[] {
  const records = new Map(r.stages().map((s) => [s.id, s]));
  const defs: StageDef[] = [];
  const text = (id: number) => r.text(id)?.trim() || null;
  const add = (id: number, multiplayer: boolean, info: Omit<LevelInfo, 'index'>) => {
    const stage = records.get(id);
    if (!stage || !r.hasFile(stage.bg) || isStubBg(r.fileSize(stage.bg))) return;
    const setup = multiplayer ? stage.mpSetup : stage.setup;
    const code = /^U(?:mp_)?setup(.+)Z$/.exec(r.names[multiplayer ? stage.mpSetup : stage.setup] ?? '')?.[1]
      ?? /bg_(.+)\.seg$/.exec(r.names[stage.bg])?.[1] ?? `stage${id.toString(16)}`;
    defs.push({ stage, code, setup: r.hasFile(setup) ? setup : 0, multiplayer, info: { index: defs.length, ...info } });
  };
  const missionGroups = r.missionGroups();
  for (const m of r.soloMissions()) {
    const group = missionGroups.filter((g) => g.first <= m.index).pop();
    const name = [text(m.name), text(m.subtitle)].filter(Boolean).join(' ') || `Stage 0x${m.stage.toString(16)}`;
    add(m.stage, false, { name, kind: 'campaign', ...(group && text(group.text) ? { group: text(group.text)! } : {}) });
  }
  add(CARRINGTON_INSTITUTE, false, { name: text(TEXT_CARRINGTON_INSTITUTE) ?? 'Carrington Institute', kind: 'hub' });
  const arenaGroups = r.arenaGroups();
  for (const a of r.arenas()) {
    if (a.stage === RANDOM_ARENA) continue;
    const group = arenaGroups.filter((g) => g.first <= a.index).pop();
    add(a.stage, true, { name: text(a.name) ?? `Arena 0x${a.stage.toString(16)}`, kind: 'battle', group: `Combat Simulator – ${(group && text(group.text)) ?? '?'}` });
  }
  add(0x1b, false, { name: `${text(TEXT_RETAKING_THE_INSTITUTE) ?? 'Retaking the Institute'} (cut stage 0x1B)`, kind: 'other', group: 'Unused' });
  add(0x14, false, { name: 'Silo slot (unused stage 0x14, Skedar arena geometry)', kind: 'other', group: 'Unused' });
  return defs;
}

const translation = (v: readonly number[]) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v[0], v[1], v[2], 1]);

// Distance along a ray to the nearest solid room triangle.
function openDistance(rooms: RoomMesh[], eye: number[], d: number[]): number {
  let best = Infinity;
  for (const { mesh, center, sky } of rooms) {
    if (sky) continue;
    const o = [eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]];
    for (const b of mesh.batches) {
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

/**
 * The start view (§5.5): on a SPAWN pad of the setup's intro, the eye 112 units above the pad, looking along the pad's look
 * vector. Solo stages use the first spawn; arenas, where the game picks one at random, the spawn with the most open view.
 */
function spawnCamera(r: PdRom, def: StageDef, rooms: RoomMesh[]): CameraView | undefined {
  if (!def.setup || !r.hasFile(def.stage.pads)) return undefined;
  const pads = parsePads(r.file(def.stage.pads)).pads;
  const views = readSpawnPads(r.file(def.setup)).flatMap((n): CameraView[] => {
    const pad = pads[n];
    if (!pad) return [];
    const eye: [number, number, number] = [pad.pos[0], pad.pos[1] + EYE_ABOVE_SPAWN_PAD, pad.pos[2]];
    const len = Math.hypot(...pad.look);
    const look = len > 0 ? pad.look.map((v) => v / len) : [0, 0, 1];
    return [{ eye, target: [eye[0] + look[0] * 100, eye[1] + look[1] * 100, eye[2] + look[2] * 100], fovY: 60 }];
  });
  if (!def.multiplayer || views.length < 2) return views[0];
  // Score: the distance to the first wall ahead, capped (the first of the equally open views wins); a view that hits
  // nothing looks out of the level (Felicity, Pipes, Car Park and Area 52 have such spawns) and scores 0.
  const open = (v: CameraView) => {
    const d = openDistance(rooms, v.eye, [0, 1, 2].map((k) => (v.target[k] - v.eye[k]) / 100));
    return Number.isFinite(d) ? Math.min(d, OPEN_VIEW_CAP) : 0;
  };
  return views.map((v) => ({ v, d: open(v) })).reduce((a, b) => (b.d > a.d ? b : a)).v;
}

/**
 * Rooms visible from play: seeded by the setup's spawn pads and every pad of the stage (null: no seed stands on a floor, keep
 * every room).
 */
function playVisibility(r: PdRom, def: StageDef, bg: PdBg): PlayVisibility | null {
  const { stage } = def;
  if (!r.hasFile(stage.tiles) || !r.hasFile(stage.pads)) return null;
  const pads = parsePads(r.file(stage.pads)).pads;
  const spawns = def.setup ? readSpawnPads(r.file(def.setup)).flatMap((n) => (pads[n] ? [pads[n].pos] : [])) : [];
  return new PdVisibility(bg, r.file(stage.tiles)).fromPlay([...spawns, ...pads.map((p) => p.pos)]);
}

function loadLevel(r: PdRom, def: StageDef): Level {
  const { stage } = def;
  const textures = new PdTextures(r);
  const meshes: Mesh[] = [];
  const instances: Instance[] = [];
  const layers: LevelLayer[] = [];
  const skies: Sky[] = [];
  const env = findEnvironment(r, stage.id);

  // ---- BG rooms (sky rooms go to Level.skies) ----
  const bgName = r.names[stage.bg];
  const bg = parseBg(r.file(stage.bg));
  const rooms = buildRooms(bg, bgName, textures, { envAlpha: env.envAlpha });
  // Rooms the game's portals and visibility script can never show from where the player can be (visibility.ts) go to a
  // hidden layer: scenery such as Defection's city towers, which the viewer would otherwise draw.
  const seen = playVisibility(r, def, bg);
  // One layer per room, grouped, like Zelda's scenes; the hidden ones share a layer in the same group.
  const roomLayers: LevelLayer[] = [];
  const hiddenLayer: LevelLayer = { name: 'rooms never visible from play', kind: 'background', instances: [], visibleByDefault: false, group: 'rooms' };
  for (const g of rooms) {
    const mesh = meshes.push(g.mesh) - 1;
    if (g.sky) {
      skies.push({ name: g.mesh.name, mesh });
      continue;
    }
    const hidden = seen !== null && !seen.visible.has(g.room.index);
    const info = { room: g.room.index, bg: bgName, ...(hidden ? { visibility: 'no portal path or script shows this room from the playable area' } : {}) };
    const instance = instances.push({ name: g.mesh.name, mesh, matrix: translation(g.center), info }) - 1;
    if (hidden) hiddenLayer.instances.push(instance);
    else roomLayers.push({ name: `room ${g.room.index}`, kind: 'main', instances: [instance], group: 'rooms' });
  }
  layers.push(...roomLayers);

  // ---- objects ----
  // Setup props, doors, glass, weapons, vehicles and characters, and marker layers (§5, §7.4 step 3; objects.ts).
  const objects = def.setup && r.hasFile(stage.pads)
    ? addObjects(r, { setupFile: def.setup, padsFile: stage.pads, multiplayer: def.multiplayer, textures, meshes, instances, rooms, firstLayer: layers.length })
    : null;
  if (objects) layers.push(...objects.layers);
  if (hiddenLayer.instances.length) layers.push(hiddenLayer); // last: the object layers' marker indices stay put

  // ---- environment: fog, clear colour, cloud and water planes ----
  const environment = levelEnvironment(env, stage.worldScale, textures);

  // ---- start camera ----
  const camera = spawnCamera(r, def, rooms);

  const level = buildLevel(def.info, `${def.code}-${stage.id.toString(16)}`, textures.textures, meshes, instances, {
    layers, ...(objects?.markers.length ? { markers: objects.markers } : {}), ...(skies.length ? { skies } : {}), ...environment, ...(camera ? { camera } : {}),
  });

  // ---- coplanar room surfaces the viewer would z-fight (coplanar.ts), in the level's meshes; last, so object placement,
  // cameras and bounds use the file's geometry ----
  resolveCoplanar(rooms);

  // ---- collision overlay (hidden): the tiles file's polygons; appended last, outside the level bounds ----
  const collision = r.hasFile(stage.tiles) ? collisionMesh(parseTiles(r.file(stage.tiles)), r.names[stage.tiles]) : null;
  if (collision) {
    const mesh = level.meshes.push(collision) - 1;
    const instance = level.instances.push({ name: 'collision', mesh, matrix: translation([0, 0, 0]), info: { tilesFile: r.names[stage.tiles] } }) - 1;
    level.layers = [...(level.layers ?? []), { name: 'collision', kind: 'collision', instances: [instance], visibleByDefault: false }];
  }
  return level;
}

export function openPerfectDark(rom: Uint8Array): Game {
  const r = new PdRom(rom);
  const defs = stageList(r);
  const music = perfectDarkMusic(rom);
  return {
    id: 'perfectdark',
    title: 'Perfect Dark',
    levels: defs.map((d) => d.info),
    loadLevel: (i) => loadLevel(r, defs[i]),
    music: music.tracks,
    decodeMusic: (i) => music.decode(i),
  };
}
