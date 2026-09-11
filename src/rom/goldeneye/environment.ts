// GoldenEye environment records: fog, clear colour and the code-drawn cloud and water planes (GOLDENEYE.md §3.6).
//
// Table A 0x80044E10 (0x5C bytes, zero-terminated):
//   +00 s32 id; +04 f32 near; +08 f32 far (render units); +20/+24 s32 fog min/max; +28 u8 r, g, b; +2B u8 sky on;
//   +2C f32 cloud height (world units); +30 s16 cloud texture-list index; +34..+3C f32 cloud r, g, b;
//   +40 u8 textured water; +44 f32 water height; +48 s16 water texture-list index; +4C..+54 f32 water r, g, b;
//   +58 f32 horizon offset (pixels)
// Table B 0x80045F50 (0x38 bytes): id, then table A's layout from +0x28 (colour … horizon offset) at +4; no near, far
// or fog. id -1 is the default.
import type { Fog, SkyPlane } from '../types';
import type { GeRom } from './rom';
import type { GeTextures } from './textures';

const TABLE_A = 0x80044e10;
const TABLE_B = 0x80045f50;
// The sky texture list the plane code reads (a runtime pointer at 0x8008D124): clouds, an animated texture, water.
export const SKY_TEXTURES = [2228, 1508, 1509];

type RGB = [number, number, number];

export interface GeEnvironment {
  table: 'A' | 'B';
  id: number;
  address: number;
  near: number; // render units (table B: the game's default 15)
  far: number | null; // render units; table B records keep the previous far
  fogMin: number | null; // null: no fog
  fogMax: number | null;
  color: RGB; // fog = clear = horizon colour
  sky: boolean;
  cloudHeight: number; // world units
  cloudTexture: number; // sky texture-list index
  cloudColor: RGB;
  waterTextured: boolean;
  waterHeight: number;
  waterTexture: number;
  waterColor: RGB;
  horizonOffset: number;
}

function readRecord(r: GeRom, table: 'A' | 'B', a: number): GeEnvironment {
  const b = table === 'A' ? a + 0x24 : a; // start of the shared layout, minus 4
  const rgbF = (o: number): RGB => [Math.round(r.f32(o)), Math.round(r.f32(o + 4)), Math.round(r.f32(o + 8))];
  return {
    table, id: r.s32(a), address: a,
    near: table === 'A' ? r.f32(a + 4) : 15, far: table === 'A' ? r.f32(a + 8) : null,
    fogMin: table === 'A' ? r.s32(a + 0x20) : null, fogMax: table === 'A' ? r.s32(a + 0x24) : null,
    color: [r.u8(b + 4), r.u8(b + 5), r.u8(b + 6)], sky: r.u8(b + 7) !== 0,
    cloudHeight: r.f32(b + 8), cloudTexture: r.s16(b + 0xc), cloudColor: rgbF(b + 0x10),
    waterTextured: r.u8(b + 0x1c) !== 0, waterHeight: r.f32(b + 0x20), waterTexture: r.s16(b + 0x24), waterColor: rgbF(b + 0x28),
    horizonOffset: r.f32(b + 0x34),
  };
}

function findA(r: GeRom, id: number): GeEnvironment | null {
  for (let a = TABLE_A; r.s32(a) !== 0; a += 0x5c) if (r.s32(a) === id) return readRecord(r, 'A', a);
  return null;
}

/**
 * The record the game selects for a stage (0x7F0BAA64): the alternate id + 900 when a level script asks for it, else
 * stage + 100 × players (players ≥ 2; 0 for one player), else the generic 100 × players record in multiplayer, else a
 * table B record (by stage, or the default) with near 15 and no fog.
 */
export function findEnvironment(r: GeRom, stage: number, players = 1, alternate = false): GeEnvironment {
  const n = players > 1 ? players : 0;
  const a = (alternate ? findA(r, stage + 900) : null) ?? findA(r, stage + 100 * n) ?? (n >= 2 ? findA(r, 100 * n) : null);
  if (a) return a;
  let fallback = TABLE_B;
  for (let b = TABLE_B; r.s32(b) !== 0 || b === TABLE_B; b += 0x38) {
    if (r.s32(b) === stage) return readRecord(r, 'B', b);
    if (r.s32(b) === -1) fallback = b;
  }
  return readRecord(r, 'B', fallback);
}

export interface LevelEnvironment {
  fog?: Fog;
  clearColor: RGB;
  skyPlanes?: SkyPlane[];
}

/**
 * The viewer's environment in world units. renderScale is the stage's f10 (render units = world units × f10), which the
 * record's near and far are in. Planes: clouds when the sky flag is set, plus textured water (Frigate).
 */
export function levelEnvironment(env: GeEnvironment, renderScale: number, textures: GeTextures): LevelEnvironment {
  const out: LevelEnvironment = { clearColor: env.color };
  if (env.fogMin !== null && env.fogMax !== null && env.far !== null && env.fogMax > env.fogMin) {
    const range = env.fogMax - env.fogMin;
    out.fog = {
      color: env.color, multiplier: Math.trunc(128000 / range), offset: Math.trunc(((500 - env.fogMin) * 256) / range),
      near: env.near / renderScale, far: env.far / renderScale,
    };
  }
  if (!env.sky) return out;
  const planes: SkyPlane[] = [];
  const horizonOffset = env.horizonOffset ? { horizonOffset: env.horizonOffset } : {};
  // Texel coordinates at plane hit (x, z): water (x / 32, z / 32), clouds (x / 320, z / 320) (fits to the frames' RDP
  // triangles; the scroll term is left out).
  const plane = (combine: SkyPlane['combine'], list: number, height: number, color: RGB, texelsPerUnit: number) => {
    const texture = textures.add(SKY_TEXTURES[list] ?? SKY_TEXTURES[combine === 'water' ? 2 : 0]);
    if (texture < 0) return;
    planes.push({ combine, height, texture, uvScale: textures.textures[texture].width / texelsPerUnit, color, horizon: env.color, ...horizonOffset });
  };
  if (env.waterTextured) plane('water', env.waterTexture, env.waterHeight, env.waterColor, 1 / 32);
  plane('clouds', env.cloudTexture, env.cloudHeight, env.cloudColor, 1 / 320);
  if (planes.length) out.skyPlanes = planes;
  return out;
}
