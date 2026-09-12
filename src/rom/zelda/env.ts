// Environment at a time of day (ZELDA64.md §7.1-§7.5; z_kankyo.c Environment_Update): the light setting blend of
// LIGHT_MODE_TIME scenes, the sun direction, fog and zFar, and the sky textures and colours.
import type { DlLighting } from '../displaylist';
import type { LightSetting } from './scene';
import type { ZeldaGame } from './tables';

// The game's clock: 0x10000 per day.
export const CLOCK = (h: number, m: number) => Math.trunc(((h * 60 + m) * 0x10000) / (24 * 60) + 0.5);

// OoT sTimeBasedLightConfigs[config][7] = {start, end, setting, next setting}; configs use settings base + 0..3.
const OOT_LIGHT_CFG: number[][][] = [0, 4, 8, 12, 20].map((b) => [
  [CLOCK(0, 0), CLOCK(4, 0) + 1, b + 3, b + 3], [CLOCK(4, 0) + 1, CLOCK(6, 0), b + 3, b + 0], [CLOCK(6, 0), CLOCK(8, 0) + 1, b + 0, b + 1],
  [CLOCK(8, 0) + 1, CLOCK(16, 0), b + 1, b + 1], [CLOCK(16, 0), CLOCK(17, 0) + 1, b + 1, b + 2], [CLOCK(17, 0) + 1, CLOCK(19, 0) + 1, b + 2, b + 3],
  [CLOCK(19, 0) + 1, CLOCK(24, 0) - 1, b + 3, b + 3],
]);
// MM: the same boundaries without the +1; night to dawn goes to other settings in some configs.
const MM_LIGHT_PAIRS = [
  [[3, 3], [3, 12], [0, 1], [1, 1], [1, 2], [2, 3], [3, 3]],
  [[7, 7], [7, 8], [4, 5], [5, 5], [5, 6], [6, 7], [7, 7]],
  [[11, 11], [11, 8], [8, 9], [9, 9], [9, 10], [10, 11], [11, 11]],
  [[15, 15], [15, 16], [12, 13], [13, 13], [13, 14], [14, 15], [15, 15]],
  [[19, 19], [19, 16], [16, 17], [17, 17], [17, 18], [18, 19], [19, 19]],
  [[23, 23], [23, 20], [20, 21], [21, 21], [21, 22], [22, 23], [23, 23]],
  [[27, 27], [27, 24], [24, 25], [25, 25], [25, 26], [26, 27], [27, 27]],
];
const MM_BOUNDS = [0, 4, 6, 8, 16, 17, 19, 24];
const MM_LIGHT_CFG: number[][][] = MM_LIGHT_PAIRS.map((cfg) => cfg.map(([a, b], i) => [CLOCK(MM_BOUNDS[i], 0), i === 6 ? CLOCK(24, 0) - 1 : CLOCK(MM_BOUNDS[i + 1], 0), a, b]));

// OoT gTimeBasedSkyboxConfigs[config][9] = {start, end, changeSkybox, skybox1Index, skybox2Index}.
const OOT_SKY_CFG: number[][][] = [[0, 1, 2, 3], [4, 5, 6, 7]].map(([dawn, day, dusk, night]) => [
  [CLOCK(0, 0), CLOCK(4, 0) + 1, 0, night, night], [CLOCK(4, 0) + 1, CLOCK(5, 0) + 1, 1, night, dawn], [CLOCK(5, 0) + 1, CLOCK(6, 0), 0, dawn, dawn],
  [CLOCK(6, 0), CLOCK(8, 0) + 1, 1, dawn, day], [CLOCK(8, 0) + 1, CLOCK(16, 0), 0, day, day], [CLOCK(16, 0), CLOCK(17, 0) + 1, 1, day, dusk],
  [CLOCK(17, 0) + 1, CLOCK(18, 0) + 1, 0, dusk, dusk], [CLOCK(18, 0) + 1, CLOCK(19, 0) + 1, 1, dusk, night], [CLOCK(19, 0) + 1, CLOCK(24, 0) - 1, 0, night, night],
]);

// MM sTimeBasedSkyboxConfigs[28][9] = {start, end, texture 1, texture 2 (0 fine, 1 cloud), colour 1, colour 2} and
// sSkyboxPrimColors / sSkyboxEnvColors (104 RGB), read from code (US +0x118234, +0x118A74, +0x118C14).
export interface MmSkyTables { configs: number[][][]; prim: number[][]; env: number[][] }

// Reads sTimeBasedSkyboxConfigs (28 x 9 x 8 bytes: u16 start, u16 end, u8 texture 1, texture 2, colour 1, colour 2)
// and the two 104-entry RGBx colour tables after it from MM code. Found by structure: a run of 28 groups of 9
// records whose times go 0 -> 0xFFFF, followed (within 0x100 bytes) by the colour tables.
export function readMmSkyTables(code: Uint8Array): MmSkyTables | null {
  const u16 = (o: number) => (code[o] << 8) | code[o + 1];
  const group = (o: number) => {
    if (u16(o) !== 0 || u16(o + 8 * 8 + 2) !== 0xffff) return false;
    for (let k = 0; k < 9; k++) {
      const q = o + k * 8;
      if (k && u16(q) !== u16(q - 6)) return false;
      if (code[q + 4] > 1 || code[q + 5] > 1 || code[q + 6] >= 104 || code[q + 7] >= 104) return false;
    }
    return true;
  };
  for (let o = 0; o + 28 * 72 + 0x400 <= code.length; o += 4) {
    let ok = true;
    for (let g = 0; g < 28 && ok; g++) ok = group(o + g * 72);
    if (!ok) continue;
    const configs = Array.from({ length: 28 }, (_, g) => Array.from({ length: 9 }, (_, k) => {
      const q = o + g * 72 + k * 8;
      return [u16(q), u16(q + 2), code[q + 4], code[q + 5], code[q + 6], code[q + 7]];
    }));
    // The colour tables follow 0x60 bytes after the configs in both MM ROMs (entries RGB + a zero byte).
    const c = o + 28 * 72 + 0x60;
    let zeros = c + 832 <= code.length;
    for (let k = 0; k < 208 && zeros; k++) zeros = code[c + k * 4 + 3] === 0;
    if (!zeros) return null;
    const rgb = (base: number) => Array.from({ length: 104 }, (_, k) => [code[base + k * 4], code[base + k * 4 + 1], code[base + k * 4 + 2]]);
    return { configs, prim: rgb(c), env: rgb(c + 416) };
  }
  return null;
}

const lerpWeight = (max: number, min: number, val: number) => {
  const d = max - min;
  if (d !== 0) {
    const r = 1 - (max - val) / d;
    if (!(r >= 1)) return r;
  }
  return 1;
};
const lerpU8 = (a: number, b: number, t: number) => Math.trunc((b - a) * t + a) & 255;
const lerp16 = (a: number, b: number, t: number) => Math.trunc((b - a) * t) + a;
const sins = (a: number) => Math.sin((((a << 16) >> 16) / 0x8000) * Math.PI);
const coss = (a: number) => Math.cos((((a << 16) >> 16) / 0x8000) * Math.PI);

export interface Lights {
  ambient: number[]; l1Dir: number[]; l1Color: number[]; l2Dir: number[]; l2Color: number[]; fogColor: number[];
  fogNear: number; zFar: number;
  source: string; // which settings, for bug reports
}

const norm = (d: number[]): [number, number, number] => {
  const n = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / n, d[1] / n, d[2] / n];
};

export function rspLighting(lights: Pick<Lights, 'ambient' | 'l1Dir' | 'l1Color' | 'l2Dir' | 'l2Color'>): DlLighting {
  return {
    ambient: lights.ambient as [number, number, number],
    lights: [
      { color: lights.l1Color as [number, number, number], dir: norm(lights.l1Dir) },
      { color: lights.l2Color as [number, number, number], dir: norm(lights.l2Dir) },
    ],
  };
}

// The lights of a scene header at `time`: lightMode 0 blends settings by the time and points light 1 at the sun
// (light 2 opposite); lightMode 1 uses setting 0 as stored.
export function currentLights(game: ZeldaGame, lightMode: number, list: LightSetting[], time: number): Lights | null {
  if (!list.length) return null;
  const at = (i: number) => list[Math.min(i, list.length - 1)];
  if (lightMode === 0) {
    const cfg = (game === 'oot' ? OOT_LIGHT_CFG : MM_LIGHT_CFG)[0];
    const e = cfg.find((x) => time >= x[0] && time < x[1]) ?? cfg[cfg.length - 1];
    const t = lerpWeight(e[1], e[0], time);
    const A = at(e[2]), B = at(e[3]);
    const d = time - CLOCK(12, 0);
    const l1 = [Math.trunc(-sins(d) * 120), Math.trunc(coss(d) * 120), Math.trunc(coss(d) * 20)];
    return {
      ambient: A.ambient.map((v, j) => lerpU8(v, B.ambient[j], t)),
      l1Dir: l1, l2Dir: l1.map((v) => -v),
      l1Color: A.l1Color.map((v, j) => lerpU8(v, B.l1Color[j], t)),
      l2Color: A.l2Color.map((v, j) => lerpU8(v, B.l2Color[j], t)),
      fogColor: A.fogColor.map((v, j) => lerpU8(v, B.fogColor[j], t)),
      fogNear: Math.min(996, lerp16(A.fogNear, B.fogNear, t)),
      zFar: Math.min(game === 'oot' ? 12800 : 15000, lerp16(A.zFar, B.zFar, t)),
      source: `time: settings ${e[2]} -> ${e[3]} at ${t.toFixed(3)}`,
    };
  }
  const L = list[0];
  return { ...L, fogNear: Math.min(996, L.fogNear), source: 'setting 0' };
}

/** The mutually exclusive scene light settings exposed by the viewer. Time-based scenes use their four canonical phases. */
export function sceneLightPresets(game: ZeldaGame, lightMode: number, list: LightSetting[]): { name: string; lighting: DlLighting }[] {
  if (!list.length) return [];
  if (lightMode !== 0) return list.map((lights, i) => ({ name: `Setting ${i + 1}`, lighting: rspLighting(lights) }));
  const phases: [string, number][] = [
    ['Dawn', CLOCK(6, 0)], ['Noon', CLOCK(12, 0)], ['Dusk', CLOCK(17, 0) + 2], ['Night', CLOCK(0, 0)],
  ];
  return phases.flatMap(([name, time]) => {
    const lights = currentLights(game, lightMode, list, time);
    return lights ? [{ name, lighting: rspLighting(lights) }] : [];
  });
}

// OoT normal sky at `time`: the two vr_fine/vr_cloud texture indices (0-7) and the blend (0: texture 1, 255: 2).
export function ootSky(config: number, time: number): { i1: number; i2: number; blend: number } {
  const cfg = OOT_SKY_CFG[config] ?? OOT_SKY_CFG[0];
  const e = cfg.find((x) => time >= x[0] && time < x[1]) ?? cfg[cfg.length - 1];
  let blend = Math.trunc(lerpWeight(e[1], e[0], time) * 255);
  if (!e[2]) blend = blend < 128 ? 255 : 0;
  return { i1: e[3], i2: e[4], blend };
}

// MM Environment_Init: the scene's sky config becomes a per-day config.
export function mmSkyConfig(headerConfig: number, day: number): number {
  const dayOffset = day !== 0 ? day - 1 : 0;
  let c = dayOffset + headerConfig * 3;
  const map: Record<number, number> = { 4: 14, 5: 16, 6: 17, 7: 18 + dayOffset, 8: 21 + dayOffset, 9: 24, 10: 25 + dayOffset };
  if (headerConfig in map) c = map[headerConfig];
  if (dayOffset >= 3) c = 13;
  if (c >= 28) c = 0;
  return c;
}

// MM Environment_UpdateSkybox: textures (0 d2_fine, 1 d2_cloud), their blend and the lerped prim/env colours.
export function mmSky(t: MmSkyTables, config: number, time: number): { i1: number; i2: number; blend: number; prim: number[]; env: number[] } {
  const cfg = t.configs[config] ?? t.configs[0];
  const e = cfg.find((x) => time >= x[0] && (time < x[1] || x[1] === 0xffff)) ?? cfg[cfg.length - 1];
  const w = lerpWeight(e[1], e[0], time);
  let blend = Math.trunc(w * 255);
  if (e[2] === e[3]) blend = blend < 128 ? 255 : 0;
  const lerp = (a: number, b: number) => Math.trunc(a + (b - a) * w);
  const p1 = t.prim[e[4]], p2 = t.prim[e[5]], n1 = t.env[e[4]], n2 = t.env[e[5]];
  return { i1: e[2], i2: e[3], blend, prim: [0, 1, 2].map((k) => lerp(p1[k], p2[k])), env: [0, 1, 2].map((k) => lerp(n1[k], n2[k])) };
}
