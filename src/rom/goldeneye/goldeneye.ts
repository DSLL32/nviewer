// GoldenEye 007 (U): levels from the BG, environment, setup and clipping files (GOLDENEYE.md §2, §3, §6).
//
// Space: world units = BG units / the stage scale f0C (every stage at the same scale, about 1 unit per cm); right-handed,
// +Y up, no mirroring. Each BG room is one mesh with its position baked in (instance matrix = identity).
import { buildLevel } from '../bomberman/common';
import type { CameraView, Game, Instance, Level, LevelInfo, LevelLayer, Mesh } from '../types';
import { type BgFile, buildRoom, parseBg } from './bg';
import { findEnvironment, levelEnvironment } from './environment';
import { goldeneyeMusic } from './music';
import { GeRom } from './rom';
import { parseSetup, type Setup, spawns } from './setup';
import { floorAt, parseStan, type Stan } from './stan';
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
function clearance(meshes: Mesh[], o: number[], d: number[]): number {
  let best = Infinity;
  for (const m of meshes) {
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
function spawnCamera(setup: Setup, stan: Stan | null, scale: number, meshes: Mesh[], multiplayer: boolean): CameraView | undefined {
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

function loadLevel(r: GeRom, def: StageDef): Level {
  const stageBg = r.stageBg(def.stage)!;
  const scale = stageBg.scale;
  const textures = new GeTextures(r);
  const meshes: Mesh[] = [];
  const instances: Instance[] = [];
  const layers: LevelLayer[] = [];

  // ---- BG rooms ----
  // Backdrop pieces (no depth test; e.g. Dam's horizon strips in rooms 3-35) come first so nearer rooms draw over them.
  // The game only draws them when their room is visible through the portals, so free views of a BG with portals show
  // them floating above the scenery: their layer starts hidden there (BGs without portals draw every room).
  const bg: BgFile = parseBg(r.load(stageBg.bg));
  const rooms = bg.rooms.slice(1).map((room) => ({ room: room.index, ...buildRoom(bg, room.index, textures, scale) }));
  const roomLayer: LevelLayer = { name: 'rooms', kind: 'main', instances: [] };
  const backdropLayer: LevelLayer = { name: 'backdrops (no depth)', kind: 'background', instances: [], ...(bg.portals.length ? { visibleByDefault: false } : {}) };
  const place = (layer: LevelLayer, mesh: Mesh | null, room: number) => {
    if (!mesh) return;
    const index = instances.push({ name: mesh.name, mesh: meshes.push(mesh) - 1, matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), info: { room } }) - 1;
    layer.instances.push(index);
  };
  for (const g of rooms) place(backdropLayer, g.backdrop, g.room);
  for (const g of rooms) place(roomLayer, g.mesh, g.room);
  if (backdropLayer.instances.length) layers.push(backdropLayer);
  layers.push(roomLayer);

  // ---- setup and clipping (spawn camera; objects use the same files) ----
  const setup = def.setup ? parseSetup(r.load(def.setup)) : null;
  const stan = r.hasFile(stageBg.stan) ? parseStan(r.load(stageBg.stan)) : null;

  // ---- objects: setup records (props, doors, pickups, guards, markers) go here ----

  // ---- environment ----
  const env = levelEnvironment(findEnvironment(r, def.stage, def.players), stageBg.renderScale, textures);
  const camera = setup ? spawnCamera(setup, stan, scale, meshes, def.players > 1) : undefined;

  return buildLevel(def.info, def.code, textures.textures, meshes, instances, {
    layers, ...env, ...(camera ? { camera } : {}),
  });
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
