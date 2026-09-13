// The Legend of Zelda: Ocarina of Time and Majora's Mask (ZELDA64.md): one loader for the retail and debug ROMs,
// detected by structure. A level is a scene with all its rooms for one layer (OoT child/adult day/night, MM setups):
// room display lists with the scene's draw config at a static frame and its lights at noon, the sky, the
// prerendered background of OoT image rooms, static actors with fixed display lists, markers for the other actors,
// spawns and transitions, and the collision and waterboxes as hidden layers.
import { buildLevel, fogPosition } from '../bomberman/common';
import { runDisplayList, type DisplayListContext } from '../displaylist';
import { decodeRows, ImFmt, ImSiz, Tlut } from '../texture';
import type { Backdrop, Batch, CameraView, DebugInfo, Game, Instance, Level, LevelInfo, LevelLayer, Marker, Mesh, Sky, Texture } from '../types';
import {
  actorTransform, categoryLayer, mmHalfDayBit, mmRecipe, ootRecipe, placeRoomActor, placeTransitionActor, type ActorDraw, type DrawList, type PlacedActor,
} from './actors';
import { collisionBatch, floorBgCam, segmentHit, waterBoxBatch } from './collision';
import { resolveCoplanar } from './coplanar';
import { mmAnimatedMaterials, ootDrawConfig, type BufferState, type DrawConfig } from './drawconfig';
import { CLOCK, currentLights, mmSky, mmSkyConfig, ootSky, readMmSkyTables, rspLighting, sceneLightPresets, type MmSkyTables } from './env';
import { type ZeldaBuild, type ZeldaFile, ZeldaFs } from './fs';
import { decodeJpeg } from './jpeg';
import { zeldaMusic } from './music';
import { MM_SCENES, OOT_SCENES } from './names';
import {
  alternateHeaders, headerForLayer, parseCollision, parseHeader, readRoomHeader, readSceneHeader, s16, type Collision, type RoomHeader,
} from './scene';
import { lerpMix, OOT_SKY256, sky128, sky256, skyBatches, tintedMix } from './sky';
import {
  actorProfile, findDayNightTextures, findMmAreaTextures, findMmSkyFiles, findOotSkyFiles, findTables, type ZeldaGame, type ZeldaTables,
} from './tables';

export interface ZeldaLevelDef { scene: number; layer: number; file: string; time?: number; setupName?: string } // time: a time-of-day variant

// Loader options for offline comparisons with captures: the time of day (0..0xFFFF, default noon; OoT night layers
// midnight) and the MM day (default 1).
export interface ZeldaOptions { time?: number; day?: number; trace?: (message: string) => void }

export type ZeldaFileSystem = Pick<ZeldaFs, 'files' | 'present' | 'fileAt' | 'fileByVrom' | 'size' | 'data' | 'name'>;

export interface ZeldaRuntime {
  options: ZeldaOptions;
  fs: ZeldaFileSystem;
  t: ZeldaTables;
  game: ZeldaGame;
  dayNight: number[] | null;
  ootSky: ZeldaFile | null;
  mmSkyFiles: ReturnType<typeof findMmSkyFiles>;
  mmSkyTables: MmSkyTables | null;
  areaTextures: (ZeldaFile | null)[] | null;
  profiles: Map<number, { category: number; objectId: number } | null>;
  source?: boolean;
  idPrefix?: string;
}

const hex = (v: number) => `0x${(v >>> 0).toString(16)}`;
const OOT_LAYER_NAMES = ['child day', 'child night', 'adult day', 'adult night'];

// SETUPDL_25 (z_rcp.c): the state rooms and most actors draw with.
const SETUP_COMBINE: [number, number] = [0xfc127e03, 0xff0ff3ff];
const SETUP_OTHERMODE_H = 0x00102c10;
const SETUP_RENDERMODE = 0xc8112078; // G_RM_FOG_SHADE_A | G_RM_AA_ZB_OPA_SURF2
const SETUP_RENDERMODE_XLU = 0xc81049d8; // G_RM_FOG_SHADE_A | G_RM_AA_ZB_XLU_SURF2
const SETUP_GEOMETRY = 0x1 | 0x4 | 0x400 | 0x10000 | 0x20000 | 0x200000;
const CAM_SET_PREREND_FIXED = 0x19;
// Camera settings whose bg camera data position is the eye (OoT FIXED0/1, CIRCLE2/3/4/7, PREREND1; MM PREREND,
// FIXED and CIRCLE settings).
const EYE_SETTINGS: Record<ZeldaGame, Set<number>> = {
  oot: new Set([0x14, 0x15, 0x17, 0x18, 0x1a, 0x23, 0x40]),
  mm: new Set([0x06, 0x07, 0x0e, 0x0f, 0x1f, 0x20, 0x23, 0x24, 0x25, 0x27, 0x35, 0x36, 0x3b, 0x41, 0x4c]),
};

// One address space for the display lists of a level: files and synthesised lists, 8-aligned.
class Space {
  private chunks: Uint8Array[] = [];
  size = 0;
  add(bytes: Uint8Array): number {
    const at = this.size;
    this.chunks.push(bytes);
    this.size += bytes.length;
    const pad = (8 - (this.size % 8)) % 8;
    if (pad) {
      this.chunks.push(new Uint8Array(pad));
      this.size += pad;
    }
    return at;
  }
  words(ws: number[]): number {
    const b = new Uint8Array(ws.length * 4);
    const dv = new DataView(b.buffer);
    ws.forEach((w, i) => dv.setUint32(i * 4, w >>> 0));
    return this.add(b);
  }
  build(): Uint8Array {
    const out = new Uint8Array(this.size);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
}

// Batches with the same render state are concatenated (including the second texture).
function mergeBatches(batches: Batch[]): Batch[] {
  const groups = new Map<string, Batch[]>();
  for (const b of batches) {
    if (!b.positions.length) continue;
    const k = `${b.texture}/${b.blend}/${b.depthTest}/${b.depthWrite}/${b.cullBack}/${b.decal ?? false}/${b.texture1 ?? -1}/${b.texBlend ?? ''}/${b.texMix ?? 0}`;
    const g = groups.get(k);
    if (g) g.push(b);
    else groups.set(k, [b]);
  }
  return [...groups.values()].map((g) => {
    if (g.length === 1) return g[0];
    const cat = <T extends Float32Array | Uint8Array | Uint32Array>(get: (b: Batch) => T | undefined, make: (n: number) => T): T => {
      const out = make(g.reduce((n, b) => n + (get(b)?.length ?? 0), 0));
      let o = 0;
      for (const b of g) {
        out.set(get(b)!, o);
        o += get(b)!.length;
      }
      return out;
    };
    return {
      ...g[0],
      positions: cat((b) => b.positions, (n) => new Float32Array(n)),
      uvs: cat((b) => b.uvs, (n) => new Float32Array(n)),
      colors: cat((b) => b.colors, (n) => new Uint8Array(n)),
      ...(g.some((b) => b.unlitColors) ? { unlitColors: cat((b) => b.unlitColors ?? b.colors, (n) => new Uint8Array(n)) } : {}),
      ...(g.some((b) => b.lightingColors) ? {
        lightingColors: Array.from({ length: Math.max(...g.map((b) => b.lightingColors?.length ?? 0)) }, (_, i) =>
          cat((b) => b.lightingColors?.[i] ?? b.colors, (n) => new Uint8Array(n))),
      } : {}),
      triSource: cat((b) => b.triSource, (n) => new Uint32Array(n)),
      ...(g[0].uvs1 ? { uvs1: cat((b) => b.uvs1, (n) => new Float32Array(n)) } : {}),
    };
  });
}

// UI group of a scene layer: one layer per room under "rooms", the actor marker categories (transition actors
// included) under "actors", collision, waterboxes and the room lists the prerendered background covers under
// "collision and hidden". Spawns and the drawn static actors stay ungrouped.
export function layerGroup(name: string, kind: LevelLayer['kind']): string | undefined {
  if (kind === 'main' && /^room \d+$/.test(name)) return 'rooms';
  if (kind === 'markers' && name !== 'spawns') return 'actors';
  if (kind === 'collision' || name === 'opaque room lists under the background') return 'collision and hidden';
  return undefined;
}

export function meshOf(name: string, batches: Batch[], info: DebugInfo): Mesh {
  const merged = mergeBatches(batches);
  let radius = 0;
  for (const b of merged) for (let k = 0; k < b.positions.length; k += 3) radius = Math.max(radius, Math.hypot(b.positions[k], b.positions[k + 1], b.positions[k + 2]));
  return { name, radius, batches: merged, info };
}

// The RDP samples texel centres at integer texel coordinates, GL at +0.5: shift every texture coordinate by half a
// texel (ZELDA64.md §5.3.3).
export function halfTexel(batches: Batch[], textures: Texture[]) {
  for (const b of batches) {
    const shift = (uvs: Float32Array | undefined, tex: number | undefined) => {
      const t = tex !== undefined && tex >= 0 ? textures[tex] : null;
      if (!uvs || !t) return;
      for (let k = 0; k < uvs.length; k += 2) {
        uvs[k] += 0.5 / t.width;
        uvs[k + 1] += 0.5 / t.height;
      }
    };
    shift(b.uvs, b.texture);
    shift(b.uvs1, b.texture1);
  }
}

// A fresh matrix per instance: the worker transfers each instance's buffer with the level.
export const translation = (p: number[]) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p[0], p[1], p[2], 1]);

// World-space triangles of the opaque and cutout room batches (room instances are at the identity).
export function roomGeometry(meshes: Mesh[]): Float32Array[] {
  const out: Float32Array[] = [];
  const seen = new Set<Mesh>();
  for (const m of meshes) {
    if (!m.name.startsWith('room ') || seen.has(m)) continue;
    seen.add(m);
    for (const b of m.batches) if (b.blend !== 'blend') out.push(b.positions);
  }
  return out;
}

// The fraction (0..1) of the segment a -> b before it hits one of the triangles (flat xyz triples), 1 if none.
function trianglesHit(tris: Float32Array, a: number[], b: number[]): number {
  const d0 = b[0] - a[0], d1 = b[1] - a[1], d2 = b[2] - a[2];
  let best = 1;
  for (let k = 0; k + 9 <= tris.length; k += 9) {
    const e10 = tris[k + 3] - tris[k], e11 = tris[k + 4] - tris[k + 1], e12 = tris[k + 5] - tris[k + 2];
    const e20 = tris[k + 6] - tris[k], e21 = tris[k + 7] - tris[k + 1], e22 = tris[k + 8] - tris[k + 2];
    const h0 = d1 * e22 - d2 * e21, h1 = d2 * e20 - d0 * e22, h2 = d0 * e21 - d1 * e20;
    const det = e10 * h0 + e11 * h1 + e12 * h2;
    if (Math.abs(det) < 1e-9) continue;
    const inv = 1 / det, s0 = a[0] - tris[k], s1 = a[1] - tris[k + 1], s2 = a[2] - tris[k + 2];
    const u = inv * (s0 * h0 + s1 * h1 + s2 * h2);
    if (u < 0 || u > 1) continue;
    const q0 = s1 * e12 - s2 * e11, q1 = s2 * e10 - s0 * e12, q2 = s0 * e11 - s1 * e10;
    const v = inv * (d0 * q0 + d1 * q1 + d2 * q2);
    if (v < 0 || u + v > 1) continue;
    const t = inv * (e20 * q0 + e21 * q1 + e22 * q2);
    if (t > 1e-4 && t < best) best = t;
  }
  return best;
}

// The start camera for a player entry (ZELDA64.md §7.6): the game's normal camera 176 units behind the player and 31
// above its 44-unit target. Candidates: behind the player, turned by 45 and 90 degrees, and with the player walked
// forward (spawns at doors and gates walk in). A candidate needs a clear line to the player and a floor below; its
// openness is the mean free distance (up to 700 units) of 15 rays across the view (collision and room geometry). The first candidate
// within 85% of the most open one wins, so open places keep the game's own camera.
export function chooseStartCamera(
  player: { pos: [number, number, number]; rot: [number, number, number] }, collision: Collision | null, geometry: Float32Array[],
  trace?: (message: string) => void,
): CameraView {
  const [px, py, pz] = player.pos;
  const R = 1400, RAY = 700, NEAR = 250;
  const near: number[] = [];
  for (const g of geometry) {
    for (let k = 0; k + 9 <= g.length; k += 9) {
      const x0 = Math.min(g[k], g[k + 3], g[k + 6]), x1 = Math.max(g[k], g[k + 3], g[k + 6]);
      const z0 = Math.min(g[k + 2], g[k + 5], g[k + 8]), z1 = Math.max(g[k + 2], g[k + 5], g[k + 8]);
      const y0 = Math.min(g[k + 1], g[k + 4], g[k + 7]), y1 = Math.max(g[k + 1], g[k + 4], g[k + 7]);
      if (x1 < px - R || x0 > px + R || z1 < pz - R || z0 > pz + R || y1 < py - R || y0 > py + R) continue;
      for (let j = 0; j < 9; j++) near.push(g[k + j]);
    }
  }
  const tris = new Float32Array(near);
  const hit = (a: number[], b: number[]) => Math.min(collision ? segmentHit(collision, a, b) : 1, trianglesHit(tris, a, b));
  const yaw0 = (((player.rot[1] << 16) >> 16) / 0x8000) * Math.PI;
  const candidate = (forward: number, turn: number) => {
    const target: [number, number, number] = [px + forward * Math.sin(yaw0), py + 44, pz + forward * Math.cos(yaw0)];
    const yaw = yaw0 + turn;
    const eye: [number, number, number] = [target[0] - 176 * Math.sin(yaw), target[1] + 31, target[2] - 176 * Math.cos(yaw)];
    return { eye, target };
  };
  const openness = (c: { eye: number[]; target: number[] }): number => {
    const [ex, ey, ez] = c.eye;
    if (hit(c.target, c.eye) < 1 || hit([c.target[0], c.target[1] - 30, c.target[2]], c.target) < 1) return -1;
    const floor = collision ? floorBgCam(collision, ex, ey - 40, ez) >= 0 : trianglesHit(tris, c.eye, [ex, ey - 600, ez]) < 1;
    if (!floor) return -1;
    const dx = c.target[0] - ex, dy = c.target[1] - ey, dz = c.target[2] - ez;
    const yaw = Math.atan2(dx, dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
    let sum = 0, far = 0;
    for (const dyaw of [-0.45, -0.22, 0, 0.22, 0.45]) {
      for (const dp of [-0.25, 0, 0.25]) {
        const y = yaw + dyaw, p = pitch + dp;
        const h = hit(c.eye, [ex + Math.sin(y) * Math.cos(p) * RAY, ey + Math.sin(p) * RAY, ez + Math.cos(y) * Math.cos(p) * RAY]);
        sum += Math.min(1, (h * RAY) / NEAR);
        far += h;
      }
    }
    trace?.(`free within ${NEAR} units ${(sum / 15).toFixed(2)}, mean free distance ${(far / 15).toFixed(2)} of ${RAY}`);
    return far / 15;
  };
  const scored: { c: { eye: [number, number, number]; target: [number, number, number] }; score: number }[] = [];
  for (const forward of [0, 100, 200, 300, 400]) {
    for (const turn of [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2]) {
      const c = candidate(forward, turn);
      trace?.(`candidate forward ${forward} turn ${Math.round((turn * 180) / Math.PI)}`);
      scored.push({ c, score: openness(c) });
    }
  }
  const best = Math.max(...scored.map((x) => x.score));
  if (best > 0) {
    const pick = scored.find((x) => x.score >= best * 0.85)!;
    return { ...pick.c, fovY: 60 };
  }
  const c = candidate(0, 0);
  const h = hit(c.target, c.eye);
  const k = h < 1 ? Math.max(0.1, h - 15 / 179) : 1;
  return { target: c.target, eye: [0, 1, 2].map((i) => c.target[i] + (c.eye[i] - c.target[i]) * k) as [number, number, number], fovY: 60 };
}

function norm(v: number[]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// A display list that starts with known F3DEX2/RDP opcodes and ends within its owning file (object offsets taken from
// the decomp XMLs are checked this way before they are drawn).
const F3DEX2_OPS = new Set([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0xd7, 0xd8, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf, 0xe0, 0xe1, 0xe2, 0xe3,
  0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xed, 0xee, 0xef, 0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff]);
function plausibleList(buf: Uint8Array, at: number, end: number): boolean {
  end = Math.min(end, buf.length);
  if (at < 0 || at + 8 > end || (buf[at] === 0x00 && buf[at + 1] === 0x00 && buf[at + 2] === 0x00 && buf[at + 3] === 0x00)) return false;
  for (let p = at; p + 8 <= end; p += 8) {
    const op = buf[p];
    if (!F3DEX2_OPS.has(op)) return false;
    if (op === 0xdf || (op === 0xde && buf[p + 1] === 1)) return true;
  }
  return false;
}

function sceneFileName(z: ZeldaRuntime, def: ZeldaLevelDef, f: ZeldaFile) {
  return z.fs.name(f.index) || def.file;
}

export function loadZeldaLevel(z: ZeldaRuntime, def: ZeldaLevelDef, info: LevelInfo): Level {
  const { fs, t, game } = z;
  const entry = t.scenes[def.scene];
  if (!entry) throw new Error(`scene ${hex(def.scene)} is not in this ROM`);
  const sceneData = fs.data(entry.file);
  const sceneHdr = headerForLayer(sceneData, 2, def.layer, game);
  const sh = readSceneHeader(sceneData, sceneHdr.cmds, sceneHdr.used, game);
  const sceneName = sceneFileName(z, def, entry.file);
  const roomName = (k: number, f: ZeldaFile) => fs.name(f.index) || `${def.file.replace(/_scene$/, '')}_room_${game === 'mm' ? String(k).padStart(2, '0') : k}`;
  const rooms = sh.rooms.map((r, k) => {
    const f = fs.fileAt(r.vromStart, r.vromEnd);
    if (!f) return null;
    const data = fs.data(f);
    try {
      const h = headerForLayer(data, 3, def.layer, game);
      return { index: k, file: f, data, header: readRoomHeader(data, h.cmds, h.used) as RoomHeader, name: roomName(k, f) };
    } catch {
      return null; // not a room header (a debug test map's room file)
    }
  });
  const spawn = sh.spawns[0] ?? { playerEntry: 0, room: 0 };
  const player = sh.playerEntries[spawn.playerEntry] ?? sh.playerEntries[0];
  const spawnRoom = rooms[spawn.room] ?? rooms.find((r) => r) ?? null;

  // ---- time and environment ----
  const night = game === 'oot' && (def.layer === 1 || def.layer === 3);
  let time = def.time ?? (night ? 0 : 0x8000);
  const fixed = spawnRoom?.header.time;
  if (fixed && fixed[0] !== 0xff && def.time === undefined) time = CLOCK(fixed[0], fixed[1]);
  if (z.options.time !== undefined) time = z.options.time;
  const day = z.options.day ?? 1;
  const lights = currentLights(game, sh.lightMode, sh.lights, time);
  const lighting = lights ? rspLighting(lights) : { ambient: [255, 255, 255] as [number, number, number], lights: [] };
  const lightingPresets = sceneLightPresets(game, sh.lightMode, sh.lights);
  let defaultLighting = lightingPresets.findIndex((preset) => JSON.stringify(preset.lighting) === JSON.stringify(lighting));
  if (lightingPresets.length && defaultLighting < 0) {
    lightingPresets.unshift({ name: 'Current', lighting });
    defaultLighting = 0;
  }
  const zFar = lights ? (game === 'mm' ? Math.min(lights.zFar, 12800) : lights.zFar) : 12800;
  const fog = lights && lights.fogNear < 1000
    ? fogPosition(lights.fogNear, game === 'mm' ? Math.max(1000, Math.trunc((lights.zFar * 5) / 64)) : 1000, lights.fogColor as [number, number, number], 10, zFar)
    : undefined;
  // OoT skybox 0x1D draws no cube; Environment_DrawSkyboxFilters instead fills the frame with the current fog colour.
  const clearColor: [number, number, number] = game === 'oot' && sh.skyboxId === 0x1d && lights
    ? [lights.fogColor[0], lights.fogColor[1], lights.fogColor[2]]
    : [0, 0, 0];

  // ---- draw config ----
  let cfg: DrawConfig;
  if (game === 'oot') {
    cfg = ootDrawConfig(entry.drawConfig, {
      frame: 0, night: time > 0xc001 || time < 0x4555, time, layer: def.layer, adult: def.layer === 2 || def.layer === 3, sceneId: def.scene,
      masterQuest: false, dayNightTextures: z.dayNight,
    });
  } else {
    const empty = (): BufferState => ({ segments: new Map([8, 9, 10, 11, 12, 13].map((s) => [s, { kind: 'dl', words: [0xdf000000, 0] }])), prim: 0x80808080, env: 0x80808080 });
    cfg = { opa: empty(), xlu: empty(), notes: [] };
    if ([1, 6, 7].includes(entry.drawConfig)) {
      const am = mmAnimatedMaterials(sceneData, sh.animatedMaterials, 0);
      for (const [s, v] of am.segments) { cfg.opa.segments.set(s, v); cfg.xlu.segments.set(s, v); }
      cfg.notes.push(...am.notes);
    }
  }

  // ---- actors: placements, profiles and recipes (decided before the address space is built) ----
  const profile = (id: number) => {
    if (!z.profiles.has(id)) z.profiles.set(id, z.source ? null : actorProfile(fs as ZeldaFs, t, id));
    return z.profiles.get(id)!;
  };
  const dayBit = mmHalfDayBit(day, time >= 0xc000 || time < 0x4000);
  const placed: { a: PlacedActor; draw: ActorDraw | null; category: number; roomFile: ZeldaFile | null }[] = [];
  let otherTimes = 0;
  for (const r of rooms) {
    if (!r) continue;
    for (const e of r.header.actors) {
      const a = placeRoomActor(game, e, r.index);
      if (game === 'mm' && a.halfDayMask && !(a.halfDayMask & dayBit)) { otherTimes++; continue; }
      const pr = profile(a.id);
      const draw = (game === 'oot' ? ootRecipe : mmRecipe)(a, {
        profileObject: pr?.objectId ?? 0, child: def.layer < 2, time, night: time >= 0xc000 || time < 0x4000, layer: def.layer,
      });
      placed.push({ a, draw: draw && t.objects[draw.object] ? draw : null, category: pr?.category ?? 8, roomFile: r.file });
    }
  }
  const transitions = sh.transitions.map((tr) => placeTransitionActor(game, tr));

  // ---- address space ----
  const space = new Space();
  const bases = new Map<string, [number, number]>(); // name -> [base, length]
  const addFile = (key: string, data: Uint8Array) => {
    if (!bases.has(key)) bases.set(key, [space.add(data), data.length]);
    return bases.get(key)!;
  };
  const sceneBase = addFile('scene', sceneData);
  const roomBases = rooms.map((r) => (r ? addFile(`room ${r.index}`, r.data) : null));
  const areaFile = game === 'mm' && sh.areaTextures ? z.areaTextures?.[sh.areaTextures] ?? null : null;
  const areaBase = areaFile ? addFile('area textures', fs.data(areaFile)) : null;
  const objectBase = (id: number) => {
    const f = t.objects[id];
    return f ? addFile(`object ${hex(id)}`, fs.data(f)) : null;
  };
  const keepBase = objectBase(1);
  const subKeepBase = sh.keepObject ? objectBase(sh.keepObject) : null;
  for (const p of placed) if (p.draw) objectBase(p.draw.object);
  const stub = space.words([0xdf000000, 0]);
  // Matrices for room G_MTX commands (16.16 fixed point): identity, and the draw config's segment 0xD per room.
  const mtxWords = (m: number[]) => {
    const fixed = m.map((v) => Math.round(v * 65536) | 0);
    const w: number[] = [];
    for (let i = 0; i < 16; i += 2) w.push(((((fixed[i] >> 16) & 0xffff) << 16) | ((fixed[i + 1] >> 16) & 0xffff)) >>> 0);
    for (let i = 0; i < 16; i += 2) w.push((((fixed[i] & 0xffff) << 16) | (fixed[i + 1] & 0xffff)) >>> 0);
    return w;
  };
  const IDENTITY_MTX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const identityMtx = space.words(mtxWords(IDENTITY_MTX));
  const roomMatrix = rooms.map((r) => (r && cfg.roomMatrix ? space.words(mtxWords(cfg.roomMatrix(r.index))) : -1));
  const synth = { opa: new Map<number, number>(), xlu: new Map<number, number>() };
  for (const kind of ['opa', 'xlu'] as const) {
    for (const [s, v] of cfg[kind].segments) if (v.kind === 'dl') synth[kind].set(s, space.words(v.words));
  }
  const actorSynth = new Map<object, number>();
  for (const p of placed) {
    for (const l of p.draw?.lists ?? []) {
      for (const v of Object.values(l.segments ?? {})) {
        if (v.kind === 'dl' && !actorSynth.has(v)) actorSynth.set(v, space.words(v.words));
      }
    }
  }
  const chains = new Map<string, number>();
  for (const p of placed) {
    for (const l of p.draw?.lists ?? []) {
      if (!l.chain) continue;
      const key = l.chain.join(',');
      if (!chains.has(key)) chains.set(key, space.words([...l.chain.flatMap((a) => [0xde000000, a]), 0xdf000000, 0]));
      l.dl = 0x0f000000 | chains.get(key)!;
    }
  }
  const buf = space.build();

  const within = (b: [number, number] | null, off: number) => (b && off < b[1] ? b[0] + off : -1);
  const resolver = (kind: 'opa' | 'xlu', room: number, seg6: [number, number] | null, images: boolean, extra?: DrawList['segments']) => {
    const state = cfg[kind];
    const resolve = (addr: number): number => {
      const seg = addr >>> 24, off = addr & 0xffffff;
      const e = extra?.[seg];
      if (e) {
        if (e.kind === 'dl') {
          const b = actorSynth.get(e);
          return b === undefined ? -1 : b + off;
        }
        const b = resolve(e.addr);
        return b < 0 ? -1 : b + off;
      }
      switch (seg) {
        case 2: return within(sceneBase, off);
        case 3: return within(roomBases[room] ?? null, off);
        case 4: return within(keepBase, off);
        case 5: return within(subKeepBase, off);
        case 6: if (seg6) return within(seg6, off); break;
        case 0x0f: return off < buf.length ? off : -1;
      }
      const v = state.segments.get(seg);
      if (v?.kind === 'dl') return synth[kind].get(seg)! + off;
      if (v?.kind === 'addr') {
        const b = resolve(v.addr);
        return b < 0 ? -1 : b + off;
      }
      // Segments the draw config leaves unset: display-list calls draw nothing.
      return !images && seg >= 6 && seg <= 0x0d ? stub : -1;
    };
    return resolve;
  };

  // G_MTX in room lists (placement matrices in the room file, Jabu-Jabu's segment 0xD scale, MM's segment 1 billboard
  // and code's identity matrix at a RAM address); other addresses as for display lists.
  const codeIdentity = (addr: number) => {
    if (z.source) return false;
    const o = addr - t.codeVram;
    if (o < 0 || o + 64 > t.codeData.length) return false;
    const dv = new DataView(t.codeData.buffer, t.codeData.byteOffset + o, 64);
    return IDENTITY_MTX.every((v, i) => dv.getInt16(i * 2) + dv.getUint16(32 + i * 2) / 65536 === v);
  };
  const matrixResolver = (kind: 'opa' | 'xlu', room: number, seg6: [number, number] | null) => {
    const base = resolver(kind, room, seg6, false);
    return (addr: number): number => {
      const seg = addr >>> 24;
      if (seg === 0x0d) return kind === 'opa' && roomMatrix[room] >= 0 ? roomMatrix[room] : identityMtx; // no draw-config matrix: identity
      if (seg === 0x01) return identityMtx; // MM's billboard matrix (camera facing): identity in a free-camera view
      if (seg >= 0x80) return codeIdentity(addr) ? identityMtx : -1;
      return base(addr);
    };
  };
  const textures: Texture[] = [];
  const textureKeys = new Map<string, number>();
  let listErrors = 0;
  const run = (dl: number, kind: 'opa' | 'xlu', room: number, seg6: [number, number] | null, extra: Partial<DisplayListContext> = {}, segments?: DrawList['segments']): Batch[] => {
    const ctx: DisplayListContext = {
      buf, ucode: 'f3dex2', resolve: resolver(kind, room, seg6, false, segments), resolveImage: resolver(kind, room, seg6, true, segments),
      textures, textureKeys, keyPrefix: '', vertexScale: 1, mirrorX: false,
      geometryMode: SETUP_GEOMETRY, renderMode: (kind === 'xlu' ? SETUP_RENDERMODE_XLU : SETUP_RENDERMODE) & ~7, alphaCompare: 0,
      combineMode: SETUP_COMBINE, otherModeH: SETUP_OTHERMODE_H, primColor: cfg[kind].prim ?? 0xffffffff, envColor: cfg[kind].env ?? 0x80808080,
      lighting, lightingPresets: lightingPresets.map((preset) => preset.lighting), directImages: true, secondTexture: true, decals: true, combiner: true, textureGen: true, branchZ: 'near',
      matrix: IDENTITY_MTX, resolveMatrix: matrixResolver(kind, room, seg6),
      ...extra,
    };
    try {
      const out = runDisplayList(ctx, dl);
      halfTexel(out, textures);
      return out;
    } catch {
      listErrors++;
      return [];
    }
  };

  const meshes: Mesh[] = [];
  const instances: Instance[] = [];
  const layers: LevelLayer[] = [];
  const markers: Marker[] = [];
  const layerIndex = new Map<string, number>();
  const layer = (name: string, kind: LevelLayer['kind'], visible = true) => {
    let i = layerIndex.get(name);
    if (i === undefined) {
      const group = layerGroup(name, kind);
      i = layers.push({ name, kind, instances: [], ...(visible ? {} : { visibleByDefault: false }), ...(group ? { group } : {}) }) - 1;
      layerIndex.set(name, i);
    }
    return i;
  };
  const place = (layerName: string, kind: LevelLayer['kind'], mesh: Mesh, matrix: Float32Array, name: string, instInfo: DebugInfo, visible = true) => {
    const m = meshes.push(mesh) - 1;
    const i = instances.push({ name, mesh: m, matrix, info: instInfo }) - 1;
    layers[layer(layerName, kind, visible)].instances.push(i);
  };
  const layout = [...bases.entries()].map(([k, [b]]) => `${k} ${hex(b)}`).join(', ');

  // ---- sky ----
  const skies: Sky[] = [];
  const skyTextures: Texture[] = [];
  let sky256Shown = false;
  if (spawnRoom && !spawnRoom.header.skyboxDisabled) {
    let faces: ReturnType<typeof sky128> = [];
    let skyNote = '';
    if (game === 'oot' && z.ootSky) {
      const pair = (k: number) => [fs.files[z.ootSky!.index + 2 * k], fs.files[z.ootSky!.index + 2 * k + 1]];
      const id = sh.skyboxId;
      if (id === 1 || id === 3 || id === 5) {
        const sk = id === 1 ? ootSky(sh.skyboxConfig, time) : id === 3 ? { i1: 6, i2: 6, blend: 0 } : { i1: 8, i2: 9, blend: 0 };
        const [t1, p1] = pair(sk.i1), [t2, p2] = pair(sk.i2);
        const tlut = new Uint8Array(512);
        const first = (sk.i1 & 1) ^ ((sk.i1 & 4) >> 2) ? [p1, p2] : [p2, p1];
        tlut.set(fs.data(first[0]).subarray(0, 256), 0);
        tlut.set(fs.data(first[1]).subarray(0, 256), 256);
        faces = sky128(fs.data(t1), fs.data(t2), tlut, id === 5 ? 6 : 5, lerpMix(sk.blend));
        skyNote = `vr ${sk.i1}/${sk.i2} blend ${sk.blend}`;
      } else if (OOT_SKY256[id]) {
        const [k, n] = OOT_SKY256[id];
        const [tf, pf] = pair(k);
        faces = sky256(fs.data(tf), fs.data(pf), Math.min(n, fs.size(tf) >> 16));
        sky256Shown = true;
        skyNote = `256 sky file ${tf.index}`;
      }
    } else if (game === 'mm' && sh.skyboxId === 1 && z.mmSkyFiles && z.mmSkyTables) {
      const cfgNo = mmSkyConfig(sh.skyboxConfig, day);
      const sk = mmSky(z.mmSkyTables, cfgNo, time);
      const files = [z.mmSkyFiles.fine, z.mmSkyFiles.cloud];
      faces = sky128(fs.data(files[sk.i1]), fs.data(files[sk.i2]), fs.data(z.mmSkyFiles.palette).subarray(0, 512), 5, tintedMix(sk.blend, sk.prim, sk.env));
      skyNote = `config ${sh.skyboxConfig} -> ${cfgNo}, textures ${sk.i1}/${sk.i2} blend ${sk.blend}`;
    }
    if (faces.length) {
      const batches = skyBatches(faces, skyTextures, `sky ${sh.skyboxId}`);
      halfTexel(batches, skyTextures);
      const index = meshes.push(meshOf('sky', batches, { skyboxId: sh.skyboxId, config: sh.skyboxConfig, sky: skyNote })) - 1;
      skies.push({ name: 'sky', mesh: index });
    }
  }

  // ---- collision (needed for the prerendered camera) ----
  let collision: Collision | null = null;
  try {
    collision = sh.collision ? parseCollision(sceneData, sh.collision) : null;
  } catch {
    collision = null;
  }
  const floorCam = collision && player ? floorBgCam(collision, player.pos[0], player.pos[1], player.pos[2]) : -1;

  // ---- prerendered background (OoT image rooms) ----
  let backdrop: Backdrop | undefined;
  let fixedCamera: CameraView | undefined;
  const bgCamView = (index: number): CameraView | undefined => {
    const bc = collision?.bgCams[index];
    const o = bc && bc.data >>> 24 === 2 ? bc.data & 0xffffff : -1;
    if (!bc || o < 0 || o + 0x12 > sceneData.length || bc.count <= 0) return undefined;
    const pos: [number, number, number] = [s16(sceneData, o), s16(sceneData, o + 2), s16(sceneData, o + 4)];
    const rx = s16(sceneData, o + 6), ry = s16(sceneData, o + 8);
    let fov = s16(sceneData, o + 12);
    fov = fov === -1 ? 60 : fov > 360 ? fov / 100 : fov;
    const pitch = (-rx / 0x8000) * Math.PI, yaw = (ry / 0x8000) * Math.PI;
    const dir = [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];
    return { eye: pos, target: [pos[0] + dir[0] * 100, pos[1] + dir[1] * 100, pos[2] + dir[2] * 100], fovY: fov };
  };
  const imageRoom = spawnRoom?.header.mesh?.type === 1 && spawnRoom.header.mesh.images.length ? spawnRoom : null;
  if (game === 'oot' && imageRoom && collision) {
    const fixedCams = collision.bgCams.map((c, i) => (c.setting === CAM_SET_PREREND_FIXED ? i : -1)).filter((i) => i >= 0);
    const cam = fixedCams.includes(floorCam) ? floorCam : fixedCams[0] ?? -1;
    const images = imageRoom.header.mesh!.images;
    const img = images.find((im) => im.bgCamIndex === cam) ?? images[0];
    const off = img.source >>> 24 === 3 ? img.source & 0xffffff : -1;
    try {
      if (off >= 0) {
        const pic = imageRoom.data[off] === 0xff && imageRoom.data[off + 1] === 0xd8
          ? decodeJpeg(imageRoom.data, off)
          : { width: img.width, height: img.height, rgba: decodeRows(imageRoom.data, off, ImFmt.RGBA, ImSiz.B16, img.width, img.height, null, Tlut.None) };
        const texture = skyTextures.push({ width: pic.width, height: pic.height, rgba: pic.rgba, wrapS: 'clamp', wrapT: 'clamp', format: 'JPEG', source: `${imageRoom.name} ${hex(img.source)}` }) - 1;
        // The picture is the game's 320x240 view from the fixed camera: the viewer keeps its aspect.
        backdrop = { texture, u0: 0, v0: 0, u1: 1, v1: 1, aspect: pic.width / pic.height };
        if (cam >= 0) fixedCamera = bgCamView(cam);
      }
    } catch {
      backdrop = undefined;
    }
  }

  // ---- rooms ----
  // Coplanar surfaces are resolved over all rooms in the game's draw order: every room's opaque lists, then every
  // room's translucent lists (coplanar.ts).
  const XLU_ORDER = 0x100000;
  const all: Batch[] = [], order: number[] = [], owner: { room: number; xlu: boolean }[] = [];
  let opaRuns = 0, xluRuns = 0;
  for (const r of rooms) {
    if (!r || !r.header.mesh) continue;
    for (const e of r.header.mesh.entries) {
      if (e.opa) {
        for (const b of run(e.opa, 'opa', r.index, areaBase)) { all.push(b); order.push(opaRuns); owner.push({ room: r.index, xlu: false }); }
        opaRuns++;
      }
      if (e.xlu) {
        for (const b of run(e.xlu, 'xlu', r.index, areaBase)) { all.push(b); order.push(XLU_ORDER + xluRuns); owner.push({ room: r.index, xlu: true }); }
        xluRuns++;
      }
    }
  }
  const resolved = resolveCoplanar(all, order);
  const roomBatches = new Map<number, { opa: Batch[]; xlu: Batch[] }>();
  resolved.batches.forEach((b, j) => {
    const o = owner[resolved.origin[j]];
    const rb = roomBatches.get(o.room) ?? roomBatches.set(o.room, { opa: [], xlu: [] }).get(o.room)!;
    (o.xlu ? rb.xlu : rb.opa).push(b);
  });
  let roomTris = 0;
  for (const r of rooms) {
    if (!r || !r.header.mesh) continue;
    const { opa, xlu } = roomBatches.get(r.index) ?? { opa: [], xlu: [] };
    // The prerendered background and the 256 skies are drawn over the room's opaque lists, which only leave depth.
    const covered = (backdrop && r.header.mesh.type === 1) || sky256Shown;
    const roomInfo: DebugInfo = {
      scene: `${hex(def.scene)} ${sceneName}`, layer: def.layer, room: r.index, roomFile: `${r.file.index} ${r.name}`, vrom: hex(r.file.vromStart),
      meshType: r.header.mesh.type, entries: r.header.mesh.entries.length, buffer: layout,
      ...(resolved.lifted || resolved.newDecals ? { coplanar: `scene: ${resolved.lifted} decal vertices lifted, ${resolved.newDecals} coplanar triangles made decals` } : {}),
    };
    const visible = covered ? xlu : [...opa, ...xlu];
    for (const b of [...opa, ...xlu]) roomTris += b.positions.length / 9;
    if (visible.length) place(`room ${r.index}`, 'main', meshOf(`room ${r.index}`, visible, roomInfo), translation([0, 0, 0]), `room ${r.index}`, roomInfo);
    if (covered && opa.length) {
      place('opaque room lists under the background', 'background', meshOf(`room ${r.index} (covered)`, opa, roomInfo), translation([0, 0, 0]), `room ${r.index} opaque`, roomInfo, false);
    }
  }
  // Textures used by the level first, then sky and background pictures.
  const textureBase = textures.length;
  for (const tx of skyTextures) textures.push(tx);
  for (const s of skies) if (s.kind !== 'panorama') for (const b of meshes[s.mesh].batches) b.texture += textureBase;
  if (backdrop) backdrop.texture += textureBase;

  // ---- static actors and markers ----
  const markerAt = (layerName: string, label: string, pos: number[], mInfo: DebugInfo, visible = false) => {
    markers.push({ label, position: [pos[0], pos[1], pos[2]], layer: layer(layerName, 'markers', visible), info: mInfo });
  };
  const actorMeshes = new Map<string, Mesh | null>();
  let drawn = 0;
  for (const { a, draw, category, roomFile } of placed) {
    const aInfo: DebugInfo = {
      actor: a.name, id: hex(a.id), params: hex(a.params), room: a.room, record: `${roomFile ? `file ${roomFile.index}` : 'scene'} ${hex(a.at)}`,
      rotation: a.rotRaw.map(hex).join(' '), category, ...(game === 'mm' ? { halfDayMask: hex(a.halfDayMask) } : {}),
    };
    let ok = false;
    if (draw) {
      const seg6 = bases.get(`object ${hex(draw.object)}`) ?? null;
      const { position } = actorTransform(a, draw, draw.lists[0]);
      const key = `${a.name}/${a.params}/${a.rot.join(',')}/${draw.object}/${a.room}`;
      let mesh = actorMeshes.get(key);
      if (mesh === undefined) {
        const batches: Batch[] = [];
        for (const l of draw.lists) {
          const { local } = actorTransform(a, draw, l);
          const kind = l.xlu ? 'xlu' : 'opa';
          const start = resolver(kind, Math.max(0, a.room), seg6, false)(l.dl);
          const root = l.dl >>> 24;
          const owner = root === 4 ? keepBase : root === 5 ? subKeepBase : root === 6 ? seg6 : null;
          const end = owner ? owner[0] + owner[1] : buf.length;
          if (!plausibleList(buf, start, end)) continue;
          batches.push(...run(l.dl, kind, Math.max(0, a.room), seg6, {
            matrix: local, primColor: l.prim ?? 0xffffffff, envColor: l.env ?? 0x80808080,
            ...(l.xlu ? { renderMode: SETUP_RENDERMODE_XLU & ~7 } : {}),
          }, l.segments));
        }
        mesh = batches.some((b) => b.positions.length) ? meshOf(a.name, batches, { actor: a.name, object: hex(draw.object), recipe: draw.note }) : null;
        actorMeshes.set(key, mesh);
      }
      if (mesh) {
        place('static actors', 'objects', mesh, translation(position), a.name, aInfo);
        ok = true;
        drawn++;
      }
    }
    if (!ok) markerAt(categoryLayer(category), `${a.name} ${hex(a.params)}`, a.pos, aInfo);
  }
  for (const tr of transitions) {
    markerAt('transitions (doors, loading planes)', `${tr.name} ${hex(tr.params)} rooms ${sh.transitions[tr.index].frontRoom}/${sh.transitions[tr.index].backRoom}`, tr.pos, {
      actor: tr.name, id: hex(tr.id), params: hex(tr.params), record: `scene ${hex(tr.at)}`, rotation: hex(tr.rotRaw[1]),
    });
  }
  sh.spawns.forEach((sp, k) => {
    const pe = sh.playerEntries[sp.playerEntry];
    if (pe) markerAt('spawns', `spawn ${k} (room ${sp.room})`, pe.pos, { spawn: k, playerEntry: sp.playerEntry, room: sp.room, params: hex(pe.params), rotation: pe.rot.map(hex).join(' ') }, true);
  });

  // ---- collision overlays ----
  if (collision) {
    const cInfo: DebugInfo = { scene: sceneName, polygons: collision.polys.length, vertices: collision.vertices.length, waterBoxes: collision.waterBoxes.length, bgCams: collision.bgCams.length };
    const cb = collisionBatch(collision);
    if (cb) place('collision', 'collision', meshOf('collision', [cb], cInfo), translation([0, 0, 0]), 'collision', cInfo, false);
    const wb = waterBoxBatch(collision);
    if (wb) place('waterboxes', 'collision', meshOf('waterboxes', [wb], cInfo), translation([0, 0, 0]), 'waterboxes', cInfo, false);
  }

  // ---- start camera: spawn 0 and the bg camera of the floor under it (ZELDA64.md §7.6) ----
  // Fixed and pivot camera settings look from their data position at the player; otherwise the normal camera
  // follows 176 units behind the player, pulled in front of walls as the game's camera collision does.
  let camera: CameraView | undefined = fixedCamera;
  if (!camera && player) {
    const at: [number, number, number] = [player.pos[0], player.pos[1] + 40, player.pos[2]];
    const bcInfo = floorCam >= 0 ? collision?.bgCams[floorCam] : undefined;
    const bc = bcInfo && EYE_SETTINGS[game].has(bcInfo.setting) ? bgCamView(floorCam) : undefined;
    if (bc && Math.hypot(bc.eye[0] - at[0], bc.eye[1] - at[1], bc.eye[2] - at[2]) > 30) {
      camera = { eye: bc.eye, target: at, fovY: 60 };
    } else {
      camera = chooseStartCamera(player, collision, roomGeometry(meshes), z.options.trace);
    }
  }

  const level = buildLevel(info, `${z.idPrefix ?? game}-${hex(def.scene)}-${def.layer}`, textures, meshes, instances, {
    layers, markers, clearColor, ...(fog ? { fog } : {}), ...(camera ? { camera } : {}),
    ...(lightingPresets.length ? { lighting: { presets: lightingPresets.map((preset) => preset.name), default: defaultLighting } } : {}),
    ...(skies.length ? { skies } : {}), ...(backdrop ? { backdrop } : {}),
  });
  void roomTris;
  void drawn;
  void otherTimes;
  void listErrors;
  return level;
}

function sceneLevels(z: ZeldaRuntime): { defs: ZeldaLevelDef[]; levels: LevelInfo[] } {
  const { fs, t, game } = z;
  const defs: ZeldaLevelDef[] = [];
  const levels: LevelInfo[] = [];
  const push = (d: ZeldaLevelDef, name: string, kind: LevelInfo['kind'], group: string, setupParent?: number) => {
    levels.push({ index: levels.length, name, kind, group, ...(setupParent !== undefined ? { setupParent } : {}) });
    defs.push(d);
  };
  const listed = new Set<number>();
  for (const [id, name, kind, group, file] of game === 'oot' ? OOT_SCENES : MM_SCENES) {
    const e = t.scenes[id];
    if (!e) continue;
    listed.add(id);
    const main = levels.length;
    push({ scene: id, layer: 0, file, setupName: game === 'oot' ? 'Child day' : 'Setup 0' }, name, kind, group);
    let data: Uint8Array;
    try {
      data = fs.data(e.file);
    } catch {
      continue;
    }
    // MM has no night layers: scenes whose lights follow the time of day get a night variant (day 1, 23:00; night
    // half-day actors, sky and lights), as OoT's child night layers.
    if (game === 'mm') {
      const main = parseHeader(data, 0);
      const sky = main?.find((c) => c.code === 0x11);
      if (sky && data[sky.off + 6] === 0) push({ scene: id, layer: 0, file, time: CLOCK(23, 0) }, `${name} (night)`, kind, group);
    }
    // A repeated scene header can still select different alternate room headers at a different layer. De-duplicate
    // the complete effective setup, not just the scene pointer, so actor/object-list differences remain selectable.
    const setupSignature = (cmds: NonNullable<ReturnType<typeof parseHeader>>, layer: number) => {
      const header = readSceneHeader(data, cmds, layer, game);
      const roomHeaders = header.rooms.map(({ vromStart, vromEnd }) => {
        const room = fs.fileAt(vromStart, vromEnd);
        if (!room) return 'missing';
        try {
          const selected = headerForLayer(fs.data(room), 3, layer, game);
          return String(selected.cmds[0]?.off ?? -1);
        } catch {
          return 'invalid';
        }
      });
      return `${cmds[0]?.off ?? -1}/${roomHeaders.join(',')}`;
    };
    const mainHeader = parseHeader(data, 0);
    const seenSetups = new Set(mainHeader ? [setupSignature(mainHeader, 0)] : []);
    alternateHeaders(data, 2).forEach((h, k) => {
      const layer = k + 1;
      if (h === null) return;
      const cmds = parseHeader(data, h);
      if (!cmds) return;
      const signature = setupSignature(cmds, layer);
      if (seenSetups.has(signature)) return;
      seenSetups.add(signature);
      if (game === 'oot') {
        const normal = layer <= 3;
        const cutsceneIndex = 0xffec + layer; // layer 4 = CS_INDEX_0 (0xFFF0)
        const setupName = normal
          ? OOT_LAYER_NAMES[layer].replace(/^./, (c) => c.toUpperCase())
          : `Cutscene ${hex(cutsceneIndex)}`;
        const suffix = normal ? OOT_LAYER_NAMES[layer] : `cutscene ${hex(cutsceneIndex)}`;
        push({ scene: id, layer, file, setupName }, `${name} (${suffix})`, kind, group, main);
      } else {
        const isCutscene = cmds.some((c) => c.code === 0x17);
        const setupName = isCutscene ? `Cutscene setup ${layer}` : `Setup ${layer}`;
        push({ scene: id, layer, file, setupName }, `${name} (${setupName.toLowerCase()})`, kind, group, main);
      }
    });
  }
  // Scenes of this ROM the name tables do not know (the MM debug build's placeholder slots share one file).
  const seenFiles = new Set<number>();
  t.scenes.forEach((e, id) => {
    if (!e || listed.has(id) || seenFiles.has(e.file.index)) return;
    seenFiles.add(e.file.index);
    push({ scene: id, layer: 0, file: `scene_${id}` }, `Debug placeholder scene ${hex(id)} (file ${e.file.index})`, 'other', 'Debug');
  });
  return { defs, levels };
}

export function openZelda64(rom: Uint8Array, build: ZeldaBuild, options: ZeldaOptions = {}): Game {
  const fs = new ZeldaFs(rom, build);
  const t = findTables(fs);
  const game = t.game;
  const z: ZeldaRuntime = {
    options, fs, t, game,
    dayNight: game === 'oot' ? findDayNightTextures(t.codeData) : null,
    ootSky: game === 'oot' ? findOotSkyFiles(fs, t.codeData) : null,
    mmSkyFiles: game === 'mm' ? findMmSkyFiles(fs, t.codeData) : null,
    mmSkyTables: game === 'mm' ? readMmSkyTables(t.codeData) : null,
    areaTextures: game === 'mm' ? findMmAreaTextures(fs, t.codeData) : null,
    profiles: new Map(),
  };
  const { defs, levels } = sceneLevels(z);
  const music = zeldaMusic(rom, { fs, tables: t });
  const region = ({ E: 'US', P: 'PAL', J: 'Japan' } as Record<string, string>)[String.fromCharCode(rom[0x3e])] ?? 'unknown region';
  const title = game === 'oot'
    ? `The Legend of Zelda: Ocarina of Time (${t.debug ? 'Master Quest, GameCube debug' : `${region} 1.${rom[0x3f]}`})`
    : `The Legend of Zelda: Majora's Mask (${t.debug ? `debug, ${region}` : region})`;
  return {
    id: game,
    title,
    levels,
    loadLevel: (i) => {
      const level = loadZeldaLevel(z, defs[i], levels[i]);
      const options = defs.flatMap((def, k) => def.scene === defs[i].scene && def.setupName ? [{ name: def.setupName, level: k }] : []);
      if (defs[i].setupName && options.length > 1) level.setups = { options, current: i };
      return level;
    },
    music: music.tracks,
    decodeMusic: (i) => music.decode(i),
  };
}
