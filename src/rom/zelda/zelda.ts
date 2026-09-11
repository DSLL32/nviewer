// The Legend of Zelda: Ocarina of Time and Majora's Mask (ZELDA64.md): one loader for the retail and debug ROMs,
// detected by structure. A level is a scene with all its rooms for one layer (OoT child/adult day/night, MM setups):
// room display lists with the scene's draw config at a static frame and its lights at noon, the sky, the
// prerendered background of OoT image rooms, static actors with fixed display lists, markers for the other actors,
// spawns and transitions, and the collision and waterboxes as hidden layers.
import { buildLevel, fogPosition } from '../bomberman/common';
import { runDisplayList, type DisplayListContext, type DlLighting } from '../displaylist';
import { decodeRows, ImFmt, ImSiz, Tlut } from '../texture';
import type { Backdrop, Batch, CameraView, DebugInfo, Game, Instance, Level, LevelInfo, LevelLayer, Marker, Mesh, Sky, Texture } from '../types';
import {
  actorTransform, categoryLayer, mmHalfDayBit, mmRecipe, ootRecipe, placeRoomActor, placeTransitionActor, type ActorDraw, type PlacedActor,
} from './actors';
import { collisionBatch, floorBgCam, segmentHit, waterBoxBatch } from './collision';
import { mmAnimatedMaterials, ootDrawConfig, type BufferState, type DrawConfig } from './drawconfig';
import { CLOCK, currentLights, mmSky, mmSkyConfig, ootSky, readMmSkyTables, type MmSkyTables } from './env';
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

interface LevelDef { scene: number; layer: number; file: string }

// Loader options for offline comparisons with captures: the time of day (0..0xFFFF, default noon; OoT night layers
// midnight) and the MM day (default 1).
export interface ZeldaOptions { time?: number; day?: number }

interface Zelda {
  options: ZeldaOptions;
  fs: ZeldaFs;
  t: ZeldaTables;
  game: ZeldaGame;
  dayNight: number[] | null;
  ootSky: ZeldaFile | null;
  mmSkyFiles: ReturnType<typeof findMmSkyFiles>;
  mmSkyTables: MmSkyTables | null;
  areaTextures: (ZeldaFile | null)[] | null;
  profiles: Map<number, { category: number; objectId: number } | null>;
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
      triSource: cat((b) => b.triSource, (n) => new Uint32Array(n)),
      ...(g[0].uvs1 ? { uvs1: cat((b) => b.uvs1, (n) => new Float32Array(n)) } : {}),
    };
  });
}

function meshOf(name: string, batches: Batch[], info: DebugInfo): Mesh {
  const merged = mergeBatches(batches);
  let radius = 0;
  for (const b of merged) for (let k = 0; k < b.positions.length; k += 3) radius = Math.max(radius, Math.hypot(b.positions[k], b.positions[k + 1], b.positions[k + 2]));
  return { name, radius, batches: merged, info };
}

// The RDP samples texel centres at integer texel coordinates, GL at +0.5: shift every texture coordinate by half a
// texel (ZELDA64.md §5.3.3).
function halfTexel(batches: Batch[], textures: Texture[]) {
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
const translation = (p: number[]) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p[0], p[1], p[2], 1]);

function norm(v: number[]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// A display list that starts with known F3DEX2/RDP opcodes and ends within 512 commands (object offsets taken from
// the decomp XMLs are checked this way before they are drawn).
const F3DEX2_OPS = new Set([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0xd7, 0xd8, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf, 0xe0, 0xe1, 0xe2, 0xe3,
  0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xed, 0xee, 0xef, 0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff]);
function plausibleList(buf: Uint8Array, at: number): boolean {
  if (buf[at] === 0x00 && buf[at + 1] === 0x00 && buf[at + 2] === 0x00 && buf[at + 3] === 0x00) return false;
  for (let k = 0; k < 512 && at + (k + 1) * 8 <= buf.length; k++) {
    const op = buf[at + k * 8];
    if (!F3DEX2_OPS.has(op)) return false;
    if (op === 0xdf || (op === 0xde && buf[at + k * 8 + 1] === 1)) return true;
  }
  return false;
}

function sceneFileName(z: Zelda, def: LevelDef, f: ZeldaFile) {
  return z.fs.name(f.index) || def.file;
}

function loadLevel(z: Zelda, def: LevelDef, info: LevelInfo): Level {
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
  let time = night ? 0 : 0x8000;
  const fixed = spawnRoom?.header.time;
  if (fixed && fixed[0] !== 0xff) time = CLOCK(fixed[0], fixed[1]);
  if (z.options.time !== undefined) time = z.options.time;
  const day = z.options.day ?? 1;
  const lights = currentLights(game, sh.lightMode, sh.lights, time);
  const lighting: DlLighting = lights
    ? { ambient: lights.ambient as [number, number, number], lights: [{ color: lights.l1Color as [number, number, number], dir: norm(lights.l1Dir) }, { color: lights.l2Color as [number, number, number], dir: norm(lights.l2Dir) }] }
    : { ambient: [255, 255, 255], lights: [] };
  const zFar = lights ? (game === 'mm' ? Math.min(lights.zFar, 12800) : lights.zFar) : 12800;
  const fog = lights && lights.fogNear < 1000
    ? fogPosition(lights.fogNear, game === 'mm' ? Math.max(1000, Math.trunc((lights.zFar * 5) / 64)) : 1000, lights.fogColor as [number, number, number], 10, zFar)
    : undefined;

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
    if (!z.profiles.has(id)) z.profiles.set(id, actorProfile(fs, t, id));
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
      const draw = (game === 'oot' ? ootRecipe : mmRecipe)(a, { profileObject: pr?.objectId ?? 0, child: def.layer < 2, time, night: time >= 0xc000 || time < 0x4000 });
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
  const synth = { opa: new Map<number, number>(), xlu: new Map<number, number>() };
  for (const kind of ['opa', 'xlu'] as const) {
    for (const [s, v] of cfg[kind].segments) if (v.kind === 'dl') synth[kind].set(s, space.words(v.words));
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
  const resolver = (kind: 'opa' | 'xlu', room: number, seg6: [number, number] | null, images: boolean, extra?: Record<number, number>) => {
    const state = cfg[kind];
    const resolve = (addr: number): number => {
      const seg = addr >>> 24, off = addr & 0xffffff;
      if (extra && extra[seg] !== undefined) {
        const b = resolve(extra[seg]);
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

  const textures: Texture[] = [];
  const textureKeys = new Map<string, number>();
  let listErrors = 0;
  const run = (dl: number, kind: 'opa' | 'xlu', room: number, seg6: [number, number] | null, extra: Partial<DisplayListContext> = {}, segments?: Record<number, number>): Batch[] => {
    const ctx: DisplayListContext = {
      buf, ucode: 'f3dex2', resolve: resolver(kind, room, seg6, false, segments), resolveImage: resolver(kind, room, seg6, true, segments),
      textures, textureKeys, keyPrefix: '', vertexScale: 1, mirrorX: false,
      geometryMode: SETUP_GEOMETRY, renderMode: (kind === 'xlu' ? SETUP_RENDERMODE_XLU : SETUP_RENDERMODE) & ~7, alphaCompare: 0,
      combineMode: SETUP_COMBINE, otherModeH: SETUP_OTHERMODE_H, primColor: cfg[kind].prim ?? 0xffffffff, envColor: cfg[kind].env ?? 0x80808080,
      lighting, directImages: true, secondTexture: true, decals: true, combiner: true, textureGen: true, branchZ: 'near',
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
      i = layers.push({ name, kind, instances: [], ...(visible ? {} : { visibleByDefault: false }) }) - 1;
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
        backdrop = { texture, u0: 0, v0: 0, u1: 1, v1: 1 };
        if (cam >= 0) fixedCamera = bgCamView(cam);
      }
    } catch {
      backdrop = undefined;
    }
  }

  // ---- rooms ----
  let roomTris = 0;
  for (const r of rooms) {
    if (!r || !r.header.mesh) continue;
    const opa: Batch[] = [], xlu: Batch[] = [];
    for (const e of r.header.mesh.entries) {
      if (e.opa) opa.push(...run(e.opa, 'opa', r.index, areaBase));
      if (e.xlu) xlu.push(...run(e.xlu, 'xlu', r.index, areaBase));
    }
    // The prerendered background and the 256 skies are drawn over the room's opaque lists, which only leave depth.
    const covered = (backdrop && r.header.mesh.type === 1) || sky256Shown;
    const roomInfo: DebugInfo = {
      scene: `${hex(def.scene)} ${sceneName}`, layer: def.layer, room: r.index, roomFile: `${r.file.index} ${r.name}`, vrom: hex(r.file.vromStart),
      meshType: r.header.mesh.type, entries: r.header.mesh.entries.length, buffer: layout,
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
  for (const s of skies) for (const b of meshes[s.mesh].batches) b.texture += textureBase;
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
          if (start < 0 || !plausibleList(buf, start)) continue;
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
      // Candidates: behind the player, then turned, then with the player walked forward (spawns at doors walk in).
      // The first with a clear line of sight, a floor below and no walls close on three sides wins.
      const yaw0 = ((player.rot[1] << 16) >> 16) / 0x8000 * Math.PI;
      const candidate = (forward: number, turn: number) => {
        const target: [number, number, number] = [player.pos[0] + forward * Math.sin(yaw0), player.pos[1] + 44, player.pos[2] + forward * Math.cos(yaw0)];
        const yaw = yaw0 + turn;
        const eye: [number, number, number] = [target[0] - 176 * Math.sin(yaw), target[1] + 31, target[2] - 176 * Math.cos(yaw)];
        return { eye, target };
      };
      const clear = (c: { eye: number[]; target: number[] }) => {
        if (!collision) return true;
        if (segmentHit(collision, c.target, c.eye) < 1 || segmentHit(collision, [c.target[0], c.target[1] - 30, c.target[2]], c.target) < 1) return false;
        if (floorBgCam(collision, c.eye[0], c.eye[1] - 40, c.eye[2]) < 0) return false;
        let walls = 0;
        for (const [dx, dz] of [[80, 0], [-80, 0], [0, 80], [0, -80]]) if (segmentHit(collision, c.eye, [c.eye[0] + dx, c.eye[1], c.eye[2] + dz]) < 1) walls++;
        return walls <= 2;
      };
      let pick: { eye: [number, number, number]; target: [number, number, number] } | null = null;
      search: for (const forward of [0, 100, 200]) {
        for (const turn of [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2]) {
          const c = candidate(forward, turn);
          if (clear(c)) {
            pick = c;
            break search;
          }
        }
      }
      if (!pick) {
        const c = candidate(0, 0);
        const hit = collision ? segmentHit(collision, c.target, c.eye) : 1;
        const k = hit < 1 ? Math.max(0.1, hit - 15 / 179) : 1;
        pick = { target: c.target, eye: [0, 1, 2].map((i) => c.target[i] + (c.eye[i] - c.target[i]) * k) as [number, number, number] };
      }
      camera = { ...pick, fovY: 60 };
    }
  }

  const level = buildLevel(info, `${game}-${hex(def.scene)}-${def.layer}`, textures, meshes, instances, {
    layers, markers, clearColor: [0, 0, 0], ...(fog ? { fog } : {}), ...(camera ? { camera } : {}),
    ...(skies.length ? { skies } : {}), ...(backdrop ? { backdrop } : {}),
  });
  void roomTris;
  void drawn;
  void otherTimes;
  void listErrors;
  return level;
}

function sceneLevels(z: Zelda): { defs: LevelDef[]; levels: LevelInfo[] } {
  const { fs, t, game } = z;
  const defs: LevelDef[] = [];
  const levels: LevelInfo[] = [];
  const push = (d: LevelDef, name: string, kind: LevelInfo['kind'], group: string) => {
    levels.push({ index: levels.length, name, kind, group });
    defs.push(d);
  };
  const listed = new Set<number>();
  for (const [id, name, kind, group, file] of game === 'oot' ? OOT_SCENES : MM_SCENES) {
    const e = t.scenes[id];
    if (!e) continue;
    listed.add(id);
    push({ scene: id, layer: 0, file }, name, kind, group);
    let data: Uint8Array;
    try {
      data = fs.data(e.file);
    } catch {
      continue;
    }
    alternateHeaders(data, 2).forEach((h, k) => {
      const layer = k + 1;
      if (h === null) return;
      if (game === 'oot') {
        if (layer <= 3) push({ scene: id, layer, file }, `${name} (${OOT_LAYER_NAMES[layer]})`, kind, group);
      } else if (!parseHeader(data, h)?.some((c) => c.code === 0x17)) {
        push({ scene: id, layer, file }, `${name} (setup ${layer})`, kind, group);
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
  const z: Zelda = {
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
    loadLevel: (i) => loadLevel(z, defs[i], levels[i]),
    music: music.tracks,
    decodeMusic: (i) => music.decode(i),
  };
}
