// Perfect Dark environment records: fog, clear colour and the code-drawn cloud and water planes (PERFECTDARK.md §4.9).
//
// envChoose (0x7F165D40) looks the stage up in the fog table, else in the no-fog table (else its default record, id -1).
//   fog table 0x80081164 (0x2C bytes, s16 id, zero-terminated):
//     +0 s16 id; +2 s16 near; +4 s16 far; +C s16 fog min; +E s16 fog max; +10 u8 sky r, g, b; +13 u8 suns; +14 ptr suns;
//     +18 u8 clouds on; +1A s16 cloud height; +1C u8 cloud type; +1D u8 cloud r, g, b; +20 u8 water on; +22 s16 water height;
//     +24 u8 water type; +25 u8 water r, g, b; +28 u8 water offset
//   no-fog table 0x800813CC (0x38 bytes, s32 id):
//     +0 s32 id; +4 s16 near; +6 s16 far; +E u8 sky r, g, b; +11 u8 suns; +14 ptr suns; +18 u8 clouds on; +19 u8 cloud r, g, b;
//     +1C f32 cloud height; +20 s16 cloud type; +22 u8 water on; +23 u8 water r, g, b; +28 f32 water height;
//     +2C s16 water type; +30 f32 water offset; +34 s32 flag (1: room lists keep vertex alpha, see envAlpha)
// Near and far are render units (world units × the stage's world scale); plane heights are world units.
import { fogPosition } from '../bomberman/common';
import type { Fog, SkyPlane } from '../types';
import type { PdRom } from './rom';
import type { PdTextures } from './texture';

const FOG_TABLE = 0x80081164;
const NO_FOG_TABLE = 0x800813cc;
/**
 * The sky texture list the plane code reads by cloud/water type ([0x800AB598], texture-config records whose first word is
 * the texture number, replaced by a pool pointer once loaded): identified in the Villa, Air Base, Crash Site and Air Force
 * One RDRAM captures (loaded entries' pool headers name textures 0x13 and 0x14).
 */
export const SKY_TEXTURES = [0x13, 0xc90, 0x14, 0x1];
// Plane texture mapping, world units per texel: clouds S/W = k·x, T/W = -k·z with k = 3.04e-6 in four frames, about 320
// units per texel. Water was not captured textured; GoldenEye's plane routine (the same design) maps it at 32.
const CLOUD_UNITS_PER_TEXEL = 320;
const WATER_UNITS_PER_TEXEL = 32;

type RGB = [number, number, number];

export interface PdEnvironment {
  table: 'fog' | 'no fog';
  id: number;
  address: number;
  near: number; // render units
  far: number;
  fogMin: number | null; // null: no fog
  fogMax: number | null;
  sky: RGB; // clear, fog and horizon colour
  suns: number;
  clouds: boolean;
  cloudHeight: number; // world units
  cloudType: number;
  cloudColor: RGB;
  water: boolean;
  waterHeight: number;
  waterType: number;
  waterColor: RGB;
  /**
   * The game rewrites the room lists' SHADE-alpha combiner inputs to ENV alpha (the lists' G_SETENVCOLOR alpha then sets
   * the translucency): on fog stages (shade alpha carries fog) and where the no-fog record's +0x34 flag is 0. Verified in
   * RAM lists: rewritten on Crash Site, Villa, Pelagic II (fog) and Attack Ship (flag 0); unchanged on Defection, Chicago,
   * Carrington Institute, Skedar Ruins, Air Base and the Skedar arena (flag 1). Consistent with the data: the translucent
   * lists of every flag-1 BG keep env alpha 255.
   */
  envAlpha: boolean;
}

export function findEnvironment(r: PdRom, stage: number): PdEnvironment {
  const rgb = (a: number): RGB => [r.u8(a), r.u8(a + 1), r.u8(a + 2)];
  for (let a = FOG_TABLE, i = 0; i < 64 && r.s16(a) !== 0; a += 0x2c, i++) {
    if (r.s16(a) !== stage) continue;
    return {
      table: 'fog', id: stage, address: a, near: r.s16(a + 2), far: r.s16(a + 4), fogMin: r.s16(a + 0x0c), fogMax: r.s16(a + 0x0e),
      sky: rgb(a + 0x10), suns: r.u8(a + 0x13),
      clouds: r.u8(a + 0x18) !== 0, cloudHeight: r.s16(a + 0x1a), cloudType: r.u8(a + 0x1c), cloudColor: rgb(a + 0x1d),
      water: r.u8(a + 0x20) !== 0, waterHeight: r.s16(a + 0x22), waterType: r.u8(a + 0x24), waterColor: rgb(a + 0x25),
      envAlpha: true,
    };
  }
  let chosen = NO_FOG_TABLE;
  for (let a = NO_FOG_TABLE, i = 0; i < 128 && (i === 0 || r.s32(a) !== 0); a += 0x38, i++) {
    if (r.s32(a) === stage) { chosen = a; break; }
    if (r.s32(a) === -1) chosen = a;
  }
  const a = chosen;
  return {
    table: 'no fog', id: r.s32(a), address: a, near: r.s16(a + 4), far: r.s16(a + 6), fogMin: null, fogMax: null,
    sky: rgb(a + 0x0e), suns: r.u8(a + 0x11),
    clouds: r.u8(a + 0x18) !== 0, cloudHeight: r.f32(a + 0x1c), cloudType: r.s16(a + 0x20), cloudColor: rgb(a + 0x19),
    water: r.u8(a + 0x22) !== 0, waterHeight: r.f32(a + 0x28), waterType: r.s16(a + 0x2c), waterColor: rgb(a + 0x23),
    envAlpha: r.s32(a + 0x34) === 0,
  };
}

export interface LevelEnvironment {
  clearColor: RGB;
  fog?: Fog;
  skyPlanes?: SkyPlane[];
}

/**
 * The viewer's environment in world (BG) units. Fog: gSPFogPosition(min, max) with the record's near/far divided by the
 * stage's world scale (the game scales the world, not the projection, so this is the same depth). Sky (skyRender
 * 0x7F11F754): the cloud plane above and the water plane below, each shaded
 * sky + colour·(1 - sky/255)·min(1, 2|dir.y|/|dir.xz|), clouds combined (SHADE - ENV)·TEXEL0 + ENV with ENV = the sky
 * colour, water TEXEL0·SHADE: exactly SkyPlane's model. The cloud texture's T axis runs along -z, so it gets a copy with its
 * rows flipped.
 */
export function levelEnvironment(env: PdEnvironment, worldScale: number, textures: PdTextures): LevelEnvironment {
  const out: LevelEnvironment = { clearColor: env.sky };
  const scale = worldScale > 0 ? worldScale : 1;
  if (env.fogMin !== null && env.fogMax !== null && env.fogMax > env.fogMin) {
    out.fog = fogPosition(env.fogMin, env.fogMax, env.sky, env.near / scale, env.far / scale);
  }
  const planes: SkyPlane[] = [];
  const plane = (combine: SkyPlane['combine'], type: number, height: number, color: RGB, unitsPerTexel: number) => {
    const texture = textures.add(SKY_TEXTURES[type] ?? SKY_TEXTURES[0], 'repeat', 'repeat', true);
    if (texture < 0) return;
    planes.push({ combine, height, texture, uvScale: textures.textures[texture].width * unitsPerTexel, color, horizon: env.sky });
  };
  if (env.water) plane('water', env.waterType, env.waterHeight, env.waterColor, WATER_UNITS_PER_TEXEL);
  if (env.clouds) plane('clouds', env.cloudType, env.cloudHeight, env.cloudColor, CLOUD_UNITS_PER_TEXEL);
  if (planes.length) out.skyPlanes = planes;
  return out;
}
