// Bomberman 64: The Second Attack! (U): battle stages and story areas.
//
// A level is a scene descriptor resource (2056-2237): +0 u32 map NIFF, +4 u32 collision file,
// +8 u32 nKinds, +0xC u32 nObjects, then 32-byte kind records and 76-byte placements. The
// environment record (lights, fog, clear colour) comes from the world's area-info file (2036 +
// world, 2045 for battle), the camera from the camera files (2046 + world, 2055 for battle).
// Some stages draw a 2D backdrop bitmap first (BOMBERMAN.md 5.3.9).
import type { Backdrop, CameraView, Game, Instance, Level, LevelInfo, Mesh, Texture } from '../types';
import { view } from '../util';
import { type Archive, bm64saResources } from './archive';
import { buildLevel, decodeImage, fogPosition, meshFromBatches } from './common';
import { bombermanMusic } from './music';
import { drawNiff, type Env, parseEnv, parseNiff } from './niff';

interface SceneDef {
  desc: number;
  name: string;
  kind: 'battle' | 'adventure';
  group?: string;
  world: number; // area-info and camera file index; -1 battle
  backdrop?: [number, number]; // mode, bitmap resource
}

const BATTLE: [number, string, [number, number]?][] = [
  [2058, 'Normal'], [2059, 'Park'], [2060, 'Tropical Island'], [2061, 'Miniature City'], [2062, 'Abandoned Mine'],
  [2063, 'Desert Shrine'], [2064, 'Altar'], [2065, 'Rope Bridge', [0, 2354]], [2066, 'Castle Garden', [0, 2354]],
  [2068, 'Cloud Castle', [0, 2354]], [2069, 'River', [4, 2354]], [2070, 'Royal Palace', [3, 2354]],
  [2071, 'Casino', [1, 3072]], [2072, 'Underground Maze', [3, 2354]], [2073, 'Underground River', [3, 2354]],
  [2074, 'Ivory Halls', [1, 3072]], [2075, 'Crystal Palace'], [2076, 'Hanging Gardens', [0, 2354]],
  [2077, 'Plains', [4, 2354]], [2078, 'Floating Halls', [0, 2354]], [2080, 'Ranch', [0, 2354]], [2081, 'Ranch (Nighttime)'],
];

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// World names from resource 2031; areas in file order (areas have no names).
const WORLDS: { name: string; areas: number[] }[] = [
  { name: 'Lost Planet Alcatraz', areas: [2057, 2223, 2217, 2227, ...range(2120, 2130), 2230, 2131, 2231] },
  { name: 'Ocean Planet Aquanet', areas: [...range(2101, 2106), ...range(2108, 2112), 2222, 2228, 2113, 2116, 2117, 2118, 2107, 2115, 2119, 2114] },
  { name: 'Sky Planet Horizon', areas: range(2132, 2148) },
  { name: 'Game Planet Starlight', areas: [2218, 2156, ...range(2149, 2155), ...range(2157, 2162)] },
  { name: 'Nature Planet Neverland', areas: [2219, 2229, ...range(2082, 2092), ...range(2094, 2100), 2093] },
  { name: 'Amusement Planet Epikyur', areas: [2220, ...range(2167, 2177), 2179, 2182, ...range(2163, 2166), 2178, 2180, 2181] },
  { name: 'Prison Planet Thantos', areas: [...range(2183, 2201), 2225] },
  { name: 'Warship Noah', areas: [2221, ...range(2202, 2216), 2232, 2233, 2234, 2224, 2226] },
  { name: 'Merchant Ship Frontier', areas: [2235, 2236, 2237] },
];

// Story areas drawn with the backdrop (gamesceneSetup 0x8002E28C): all of world 2 and a few more.
const STORY_BACKDROP = new Map<number, number>([[2138, 0], [2225, 2], [2165, 0], [2178, 0], [2180, 0], [2164, 0], [2181, 0], [2224, 0]]);

const SCENES: SceneDef[] = [
  ...BATTLE.map(([desc, name, backdrop]): SceneDef => ({ desc, name, kind: 'battle', world: -1, backdrop })),
  ...WORLDS.flatMap((w, world) => w.areas.map((desc, i): SceneDef => {
    const mode = world === 2 ? 0 : STORY_BACKDROP.get(desc);
    return {
      desc, name: desc === 2057 ? `Intro (${desc})` : `Area ${i + (w.areas[0] === 2057 ? 0 : 1)} (${desc})`,
      kind: 'adventure', group: w.name, world, ...(mode !== undefined ? { backdrop: [mode, 2354] as [number, number] } : {}),
    };
  })),
];

export const SA_LEVELS: LevelInfo[] = SCENES.map((s, index) => ({
  index, name: s.name, kind: s.kind, ...(s.group ? { group: s.group } : {}),
}));

const BACKDROP_TINT: Record<number, [number, number, number]> = { 2: [255, 255, 0], 3: [100, 100, 100], 4: [0, 255, 0] };
const SOFT_BLOCK_ID = 25;
const SOFT_BLOCK_NIFF = 586;

// Area-info file: {u32 area, u32 environment (-1 none), u32, u32 n, n x 8 bytes, u32 sets, sets x
// {u32, u32, u32, u32 m, m x 8 bytes}} records, ended by area 0.
function environmentOf(res: Archive, file: number, desc: number): number {
  let buf: Uint8Array;
  try {
    buf = res.file(file);
  } catch {
    return -1;
  }
  const dv = view(buf);
  for (let o = 0; o + 16 <= buf.length;) {
    const area = dv.getUint32(o);
    if (area === 0) break;
    const env = dv.getInt32(o + 4);
    if (area === desc) return env;
    o += 16 + dv.getUint32(o + 12) * 8;
    const sets = dv.getUint32(o);
    o += 4;
    for (let k = 0; k < sets && o + 16 <= buf.length; k++) o += 16 + dv.getUint32(o + 12) * 8;
  }
  return -1;
}

// Camera files: u32 count, 52-byte records {u32 area, s32 entrance, f32 yaw, pitch (degrees),
// distance, f32 look-at xyz, f32 second point xyz, f32 fovy, u32 mode (2 fixed)}.
function cameraOf(res: Archive, file: number, desc: number): CameraView | undefined {
  let buf: Uint8Array;
  try {
    buf = res.file(file);
  } catch {
    return undefined;
  }
  const dv = view(buf);
  const n = buf.length >= 4 ? dv.getUint32(0) : 0;
  for (let i = 0; i < n && 4 + (i + 1) * 52 <= buf.length; i++) {
    const o = 4 + i * 52;
    if (dv.getUint32(o) !== desc || dv.getInt32(o + 4) !== -1 || dv.getUint32(o + 48) !== 2) continue;
    const [yaw, pitch, dist, ax, ay, az] = [8, 12, 16, 20, 24, 28].map((k) => dv.getFloat32(o + k));
    const y = (yaw * Math.PI) / 180, p = (pitch * Math.PI) / 180;
    return {
      eye: [ax + dist * Math.cos(p) * Math.sin(y), ay + dist * Math.sin(p), az + dist * Math.cos(p) * Math.cos(y)],
      target: [ax, ay, az],
      fovY: dv.getFloat32(o + 44),
    };
  }
  return undefined;
}

// Bitmap resource: u32 size, u32 texel offset, u32 palette offset, u32 bits (4 or 8), u32 width,
// u32 height, u32 colours; RGBA16 palette.
function bitmap(buf: Uint8Array): Texture | null {
  if (buf.length < 0x20) return null;
  const dv = view(buf);
  const [pix, pal, bits, w, h] = [4, 8, 12, 16, 20].map((k) => dv.getUint32(k));
  if (!w || !h || w > 1024 || h > 1024 || (bits !== 4 && bits !== 8)) return null;
  return decodeImage(buf, pix, bits === 4 ? 'CI4' : 'CI8', w, h, pal);
}

function loadScene(res: Archive, index: number): Level {
  const s = SCENES[index];
  if (!s) throw new Error(`No level ${index}`);
  const d = res.file(s.desc);
  const dv = view(d);
  const mapRes = dv.getUint32(0);
  const envRes = environmentOf(res, s.world < 0 ? 2045 : 2036 + s.world, s.desc);
  let env: Env | null = null;
  if (envRes > 0) {
    try {
      env = parseEnv(res.file(envRes));
    } catch {
      env = null;
    }
  }

  const textures: Texture[] = [];
  const textureKeys = new Map<string, number>();
  const meshes: Mesh[] = [];
  const instances: Instance[] = [];
  const ident = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  const map = mapRes > 0 ? parseNiff(res.file(mapRes)) : null;
  if (map) {
    const mesh = meshFromBatches(`map ${mapRes}`, drawNiff(map, { textures, textureKeys, keyPrefix: `${mapRes}:`, env }));
    mesh.info = { resource: mapRes, rom: `0x${res.romOffset(mapRes).toString(16)}`, triSource: `offset in resource ${mapRes} (decompressed NIFF)` };
    instances.push({ name: mesh.name, mesh: meshes.push(mesh) - 1, matrix: ident, info: { scene: s.desc, map: mapRes } });
  }

  // Candidate soft-block positions (the game picks some at random each round).
  const nKinds = dv.getUint32(8), nObjects = dv.getUint32(12);
  const blocks: number[][] = [];
  for (let i = 0; i < nObjects; i++) {
    const o = 16 + nKinds * 32 + i * 76;
    if (o + 76 > d.length) break;
    const kind = 16 + dv.getUint32(o) * 32;
    if (kind + 32 > d.length || dv.getUint32(kind) !== 4 || dv.getUint32(kind + 0x14) !== SOFT_BLOCK_ID) continue;
    blocks.push([dv.getFloat32(o + 4), dv.getFloat32(o + 8), dv.getFloat32(o + 12), i, o]);
  }
  if (blocks.length) {
    const block = parseNiff(res.file(SOFT_BLOCK_NIFF));
    if (block) {
      const mesh = meshFromBatches('soft block', drawNiff(block, { textures, textureKeys, keyPrefix: `${SOFT_BLOCK_NIFF}:`, env }));
      mesh.info = { resource: SOFT_BLOCK_NIFF, rom: `0x${res.romOffset(SOFT_BLOCK_NIFF).toString(16)}`, triSource: `offset in resource ${SOFT_BLOCK_NIFF} (decompressed NIFF)` };
      const mi = meshes.push(mesh) - 1;
      for (const [x, y, z, object, record] of blocks) {
        instances.push({
          name: 'soft block', mesh: mi, matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x + 50, y, z + 50, 1]), animated: true,
          info: { scene: s.desc, object, record: `0x${record.toString(16)}`, kind: dv.getUint32(record) },
        });
      }
    }
  }

  const extra: Partial<Level> = {};
  if (s.backdrop) {
    const [mode, image] = s.backdrop;
    const picture = bitmap(res.file(image));
    if (picture) {
      extra.backdrop = {
        texture: textures.push(picture) - 1, u0: 0, v0: 0, u1: 1, v1: 1,
        ...(BACKDROP_TINT[mode] ? { tint: BACKDROP_TINT[mode] } : {}),
      } satisfies Backdrop;
    }
  }
  extra.clearColor = env?.clear ?? [0, 0, 0];
  // Projection near 200, far 8000; fog runs from the environment's minimum to 1000.
  if (env?.fog) extra.fog = fogPosition(env.fog.min, 1000, env.fog.color, 200, 8000);
  const camera = cameraOf(res, s.world < 0 ? 2055 : 2046 + s.world, s.desc);
  if (camera) extra.camera = camera;
  return buildLevel(SA_LEVELS[index], `bm64sa-${index}`, textures, meshes, instances, extra);
}

export function openBomberman64SA(rom: Uint8Array): Game {
  const res = bm64saResources(rom);
  const music = bombermanMusic(rom, 'bm64sa');
  return {
    id: 'bm64sa',
    title: 'Bomberman 64: The Second Attack!',
    levels: SA_LEVELS,
    loadLevel: (i) => loadScene(res, i),
    music: music.tracks,
    decodeMusic: (i) => music.decode(i),
  };
}
