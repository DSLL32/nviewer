// Pilotwings 64 task, island and environment data for the U/E/J releases.
// Parsers for UPWT (tasks), UPWL (island objects), SPTH (spline paths), 3VUE (camera/object paths), UVEN (environments),
// UVLV (level manifests) and UVTP (texture palettes), the game's own matrix helpers (row-major Mtx4F, row vectors, Z up),
// and the placement rules the game uses for every object type. Field layouts follow the decomp structs (task.h, level.h,
// spath.c, uv_filesystem.h, uv_graphics.h) and are checked against the data by ../tools/decode_tasks.ts.
// Notes: ../notes/objects.md, environment.md, collision.md.
import { PwRom } from './fs';
import { TASK_TABLE_OFFSET } from './tables';

export type V3 = [number, number, number];
export type Mtx = number[]; // 16, row-major Mtx4F m[r][c] = a[r*4+c]; v' = v * M; translation in row 3

export const UV_TYPES = new Set(['UVSY', 'UVMD', 'UVCT', 'UVTX', 'UVEN', 'UVLT', 'UVTR', 'UVSQ', 'UVLV', 'UVAN', 'UVFT', 'UVBT', 'UVSX', 'UVTP']);

class R {
  dv: DataView;
  constructor(public d: Uint8Array) { this.dv = new DataView(d.buffer, d.byteOffset, d.byteLength); }
  u8(o: number) { return this.d[o]; }
  s8(o: number) { return this.dv.getInt8(o); }
  u16(o: number) { return this.dv.getUint16(o); }
  s16(o: number) { return this.dv.getInt16(o); }
  u32(o: number) { return this.dv.getUint32(o); }
  s32(o: number) { return this.dv.getInt32(o); }
  f(o: number) { return this.dv.getFloat32(o); }
  v3(o: number): V3 { return [this.f(o), this.f(o + 4), this.f(o + 8)]; }
  str(o: number, n: number) { let s = ''; for (let i = 0; i < n && this.d[o + i]; i++) s += String.fromCharCode(this.d[o + i]); return s; }
}

// ---------------------------------------------------------------- files
export class PwData {
  rom: PwRom;
  users: { type: string; offset: number }[];
  constructor(rom: PwRom) {
    this.rom = rom;
    this.users = rom.files.filter((f) => !UV_TYPES.has(f.type)).map((f) => ({ type: f.type, offset: f.offset }));
  }
  userChunks(i: number) { return this.rom.chunks(this.users[i].offset); }
  // App tables (verified in each release): map lookup followed by the 61 task user-file indices.
  private tableOffset() {
    const offset = TASK_TABLE_OFFSET[this.rom.gameCode];
    if (offset === undefined) throw new Error(`unsupported Pilotwings 64 ROM code ${this.rom.gameCode}`);
    return offset;
  }
  taskUser(task: number) {
    if (!Number.isInteger(task) || task < 0 || task >= 61) throw new Error(`invalid Pilotwings task ${task}`);
    return this.rom.rom[this.tableOffset() + 4 + task];
  }
  mapId(mapIndex: number) { return this.rom.rom[this.tableOffset() + mapIndex]; }
}

// ---------------------------------------------------------------- game matrix helpers (kernel matrix.c)
export const identity = (): Mtx => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function rotateAxis(m: Mtx, a: number, axis: 'x' | 'y' | 'z'): Mtx { // uvMat4RotateAxis: local rotation (rows)
  if (a === 0) return m;
  const s = Math.sin(a), c = Math.cos(a), r = m.slice();
  const row = (i: number) => m.slice(i * 4, i * 4 + 4);
  const set = (i: number, v: number[]) => { for (let k = 0; k < 4; k++) r[i * 4 + k] = v[k]; };
  const lin = (p: number[], q: number[], a1: number, b1: number) => p.map((v, k) => a1 * v + b1 * q[k]);
  if (axis === 'x') { set(1, lin(row(1), row(2), c, s)); set(2, lin(row(2), row(1), c, -s)); }
  if (axis === 'y') { set(0, lin(row(0), row(2), c, -s)); set(2, lin(row(2), row(0), c, s)); }
  if (axis === 'z') { set(0, lin(row(0), row(1), c, s)); set(1, lin(row(1), row(0), c, -s)); }
  return r;
}
export function scaleRows(m: Mtx, sx: number, sy: number, sz: number): Mtx { // uvMat4Scale
  const r = m.slice();
  for (let k = 0; k < 4; k++) { r[k] *= sx; r[4 + k] *= sy; r[8 + k] *= sz; }
  return r;
}
export function localTranslate(m: Mtx, x: number, y: number, z: number): Mtx { // uvMat4LocalTranslate
  const r = m.slice();
  for (let k = 0; k < 4; k++) r[12 + k] = x * m[k] + y * m[4 + k] + z * m[8 + k] + m[12 + k];
  return r;
}
export const setPos = (m: Mtx, p: V3): Mtx => { const r = m.slice(); r[12] = p[0]; r[13] = p[1]; r[14] = p[2]; return r; };
export const DEG = 0.0174533;
// func_80313640(tx, ty, tz, rz, rx, ry): identity, rotate z, then x, then y (local), translation last. Angles in radians.
export function poseZXY(p: V3, rz: number, rx: number, ry: number): Mtx {
  return setPos(rotateAxis(rotateAxis(rotateAxis(identity(), rz, 'z'), rx, 'x'), ry, 'y'), p);
}
export const posePosDeg = (p: V3, a: V3) => poseZXY(p, a[0] * DEG, a[1] * DEG, a[2] * DEG);
export const transformPoint = (m: Mtx, v: V3): V3 => [0, 1, 2].map((c) => v[0] * m[c] + v[1] * m[4 + c] + v[2] * m[8 + c] + m[12 + c]) as V3;

// ---------------------------------------------------------------- UPWT (task)
export interface TaskCommon {
  cls: number; veh: number; test: number; mapIndex: number; goal: number; weather: number; flag9: number;
  f0C: number; // f32 at +0x0C (1.0 in most tasks)
  wind: { vec: V3; speedVar: number; speedRate: number; dirVarDeg: number; dirRateDeg: number }; // +0x10, env_802E14E8
  box2C: [V3, V3]; // +0x2C TaskObjUnk2C
  f44: number; // +0x44
  counts: Record<string, number>;
}
export interface Task {
  index: number; user: number; jptx: string; name: string; info: string; comm: TaskCommon;
  THER: ReturnType<typeof ther>[]; LWIN: ReturnType<typeof lwin>[]; TPAD: ReturnType<typeof tpad>[]; LPAD: ReturnType<typeof lpadT>[];
  LSTP: ReturnType<typeof lstp>[]; RNGS: ReturnType<typeof rngs>[]; BALS: ReturnType<typeof bals>[]; TARG: ReturnType<typeof targ>[];
  HPAD: ReturnType<typeof hpad>[]; BTGT: ReturnType<typeof btgt>[]; PHTS: ReturnType<typeof phts>[]; FALC: ReturnType<typeof falc>[];
  CNTG: ReturnType<typeof cntg>[]; HOPD: ReturnType<typeof hopd>[];
  extraChunks: string[];
}
const COUNT_ORDER = ['THER', 'LWIN', 'TPAD', 'LPAD', 'LSTP', 'RNGS', 'BALS', 'TARG', 'HPAD', 'BTGT', 'PHTS', 'FALC', 'SDFM', 'CNTG', 'HOPD', 'OBSV'];
export const RECORD_SIZE: Record<string, number> = { THER: 0x28, LWIN: 0x54, TPAD: 0x30, LPAD: 0x30, LSTP: 0x24, RNGS: 0x84, BALS: 0x68, TARG: 0x20, HPAD: 0x40, BTGT: 0x1c, PHTS: 0x14, FALC: 0xac, SDFM: 0x4c, CNTG: 0x1c, HOPD: 0x20, OBSV: 0x10 };

const ther = (r: R, o: number) => ({ pos: r.v3(o), scale: r.f(o + 12), height: r.f(o + 16), sndFlag: r.s32(o + 20), liftLowZ: r.f(o + 24), liftHighZ: r.f(o + 28), swirl: r.f(o + 32), lift: r.f(o + 36) });
const lwin = (r: R, o: number) => ({ p0: r.v3(o), p1: r.v3(o + 12), boxPos: r.v3(o + 24), boxRotDeg: r.v3(o + 36), boxSize: r.v3(o + 48), sndFlag: r.s32(o + 60), vel: r.v3(o + 64), radius: r.f(o + 76), shape: r.u8(o + 80), b51: r.u8(o + 81) });
const tpad = (r: R, o: number) => ({ pos: r.v3(o), angleDeg: r.v3(o + 12), vel: r.v3(o + 28), onGround: r.u8(o + 40), fuel: r.f(o + 44) });
const lpadT = (r: R, o: number) => ({ pos: r.v3(o), v0C: r.v3(o + 12), v1C: r.v3(o + 28), type: r.u8(o + 44) });
const lstp = (r: R, o: number) => ({ p0: r.v3(o), p1: r.v3(o + 12), valid: r.u8(o + 28), alignment: r.f(o + 32) });
const rngs = (r: R, o: number) => ({
  pos: r.v3(o), angleDeg: r.v3(o + 12), terra: r.s32(o + 24), b1C: r.u8(o + 28),
  children: Array.from({ length: r.u8(o + 29) }, (_, k) => r.s32(o + 32 + k * 4)),
  timedChildren: Array.from({ length: r.u8(o + 52) }, (_, k) => r.s32(o + 56 + k * 4)),
  points: r.u8(o + 76), untimed: r.u8(o + 77), timedDuration: r.f(o + 80), size: r.u8(o + 84), active: r.u8(o + 85),
  rotRate0: r.f(o + 88), translation: r.f(o + 92), rotAxis0: String.fromCharCode(r.u8(o + 96) || 32),
  rotRateTimedOut1: r.f(o + 100), rotRateTiming1: r.f(o + 104), rotRate1: r.f(o + 108), rotAxis1: String.fromCharCode(r.u8(o + 112) || 32),
  ringType: r.u8(o + 113), subtype: r.u8(o + 114), b73: r.u8(o + 115), label: r.str(o + 116, 16),
});
const bals = (r: R, o: number) => ({ pos: r.v3(o), v0C: r.v3(o + 12), terra: r.s32(o + 24), f1C: r.f(o + 28), type: r.u8(o + 32), willSplit: r.u8(o + 33), f24: r.f(o + 36), f28: r.f(o + 40), f2C: r.f(o + 44), scale: r.f(o + 48), points: r.s32(o + 52), s38: r.s32(o + 56), drag: r.f(o + 60), gravity: r.f(o + 64), b44: r.u8(o + 68), splitScale: r.f(o + 92), splitGravity: r.f(o + 100) });
const targ = (r: R, o: number) => ({ pos: r.v3(o), rotDeg: r.v3(o + 12), type: r.u8(o + 24), points: r.u8(o + 25) });
const hpad = (r: R, o: number) => ({ pos: r.v3(o), rotDeg: r.v3(o + 12), terra: r.s32(o + 24), type: r.u8(o + 28), points: r.u8(o + 29), fuel: r.f(o + 32), next: Array.from({ length: r.u8(o + 36) }, (_, k) => r.s32(o + 40 + k * 4)), active: r.u8(o + 60) });
const btgt = (r: R, o: number) => ({ pos: r.v3(o), terra: r.s32(o + 12), radius: r.f(o + 16), height: r.f(o + 20), b18: r.u8(o + 24), b19: r.u8(o + 25) });
const phts = (r: R, o: number) => ({ subject: r.s32(o), headingCheck: r.s32(o + 4), headingDeg: r.f(o + 8), toleranceDeg: r.f(o + 12), points: r.f(o + 16) });
const falc = (r: R, o: number) => ({ pos: r.v3(o), domainRadius: r.f(o + 12), present: r.u8(o + 16), pct: [r.u8(o + 17), r.u8(o + 18), r.u8(o + 19)], ranges: Array.from({ length: 36 }, (_, k) => r.f(o + 24 + k * 4)) });
const cntg = (r: R, o: number) => ({ pos: r.v3(o), angleDeg: r.v3(o + 12), type: r.u8(o + 24) });
const hopd = (r: R, o: number) => ({ terra: r.s32(o), pos: r.v3(o + 4), s10: r.s32(o + 16), radius: r.f(o + 20), height: r.f(o + 24) });
const PARSERS: Record<string, (r: R, o: number) => unknown> = { THER: ther, LWIN: lwin, TPAD: tpad, LPAD: lpadT, LSTP: lstp, RNGS: rngs, BALS: bals, TARG: targ, HPAD: hpad, BTGT: btgt, PHTS: phts, FALC: falc, CNTG: cntg, HOPD: hopd };

export function parseTask(data: PwData, index: number): Task {
  const user = data.taskUser(index);
  const t: any = { index, user, jptx: '', name: '', info: '', extraChunks: [] };
  for (const k of Object.keys(PARSERS)) t[k] = [];
  let comm: R | null = null;
  const chunks = data.userChunks(user);
  for (const c of chunks) if (c.tag === 'COMM') comm = new R(c.data);
  if (!comm) throw new Error(`task ${index}: no COMM`);
  const counts: Record<string, number> = {};
  COUNT_ORDER.forEach((k, i) => { counts[k] = comm!.u8(0x41c + i); });
  t.comm = {
    cls: comm.u8(0), veh: comm.u8(1), test: comm.u8(2), mapIndex: comm.u8(3), goal: comm.u8(4), weather: comm.u8(8), flag9: comm.u8(9), f0C: comm.f(0x0c),
    wind: { vec: comm.v3(0x10), speedVar: comm.f(0x1c), speedRate: comm.f(0x20), dirVarDeg: comm.f(0x24), dirRateDeg: comm.f(0x28) },
    box2C: [comm.v3(0x2c), comm.v3(0x38)], f44: comm.f(0x44), counts,
  } as TaskCommon;
  for (const c of chunks) {
    const r = new R(c.data);
    if (c.tag === 'JPTX') t.jptx = r.str(0, c.data.length);
    else if (c.tag === 'NAME') t.name = r.str(0, c.data.length);
    else if (c.tag === 'INFO') t.info = r.str(0, c.data.length);
    else if (PARSERS[c.tag]) {
      const n = counts[c.tag], size = RECORD_SIZE[c.tag];
      if (Math.ceil((n * size) / 8) * 8 !== c.data.length) throw new Error(`task ${index} ${c.tag}: ${n} x ${size} != ${c.data.length}`);
      for (let i = 0; i < n; i++) t[c.tag].push(PARSERS[c.tag](r, i * size));
    } else if (!['COMM', 'PAD '].includes(c.tag)) t.extraChunks.push(c.tag);
  }
  return t as Task;
}

// ---------------------------------------------------------------- UPWL (island)
export interface Island {
  mapIndex: number;
  ESND: { mtx: Mtx; p0: V3; p1: V3; snd: number; pitch: number; vol: number; pri: number; near: number; far: number; b70: number; attr: number }[];
  WOBJ: { pos: V3; type: number }[];
  LPAD: { pos: V3; angle: number; used: number; type: number }[]; // angle in radians (passed unscaled as rz)
  TOYS: { pos: V3 }[];
  TPTS: { mode: number; pos: V3; dirDeg: number; radius: number; terraPos: number; terraNeg: number; shift: V3 }[];
  APTS: { pos: V3; dirDeg: number; radius: number; mode: number; vol0: number; vol1: number }[];
  BNUS: { pos: V3; rotDeg: V3; terra: number }[];
}
export function parseIsland(data: PwData, mapIndex: number): Island {
  const chunks = data.userChunks(mapIndex); // sLevelUserFileLookup = {0,1,2,3}
  const lv = new R(chunks.find((c) => c.tag === 'LEVL')!.data);
  const n = { ESND: lv.u8(0), WOBJ: lv.u8(1), LPAD: lv.u8(2), TOYS: lv.u8(3), TPTS: lv.u8(4), APTS: lv.u8(5), BNUS: lv.u8(6) };
  const sz = { ESND: 0x78, WOBJ: 0x10, LPAD: 0x18, TOYS: 0x10, TPTS: 0x34, APTS: 0x20, BNUS: 0x1c };
  const isl: any = { mapIndex, ESND: [], WOBJ: [], LPAD: [], TOYS: [], TPTS: [], APTS: [], BNUS: [] };
  for (const c of chunks) {
    const tag = c.tag as keyof typeof n;
    if (!(tag in n)) continue;
    const r = new R(c.data);
    if (Math.ceil((n[tag] * sz[tag]) / 8) * 8 !== c.data.length) throw new Error(`UPWL ${mapIndex} ${tag} size`);
    for (let i = 0; i < n[tag]; i++) {
      const o = i * sz[tag];
      switch (tag) {
        case 'ESND': isl.ESND.push({ mtx: Array.from({ length: 16 }, (_, k) => r.f(o + k * 4)), p0: r.v3(o + 0x40), p1: r.v3(o + 0x4c), snd: r.u8(o + 0x58), pitch: r.f(o + 0x5c), vol: r.f(o + 0x60), pri: r.s32(o + 0x64), near: r.f(o + 0x68), far: r.f(o + 0x6c), b70: r.u8(o + 0x70), attr: r.s32(o + 0x74) }); break;
        case 'WOBJ': isl.WOBJ.push({ pos: r.v3(o), type: r.u8(o + 12) }); break;
        case 'LPAD': isl.LPAD.push({ pos: r.v3(o), angle: r.f(o + 12), used: r.s32(o + 16), type: r.u8(o + 20) }); break;
        case 'TOYS': isl.TOYS.push({ pos: r.v3(o) }); break;
        case 'TPTS': isl.TPTS.push({ mode: r.u8(o), pos: r.v3(o + 4), dirDeg: r.f(o + 16), radius: r.f(o + 20), terraPos: r.s32(o + 24), terraNeg: r.s32(o + 32), shift: r.v3(o + 40) }); break;
        case 'APTS': isl.APTS.push({ pos: r.v3(o), dirDeg: r.f(o + 12), radius: r.f(o + 16), mode: r.s32(o + 20), vol0: r.f(o + 24), vol1: r.f(o + 28) }); break;
        case 'BNUS': isl.BNUS.push({ pos: r.v3(o), rotDeg: r.v3(o + 12), terra: r.s32(o + 24) }); break;
      }
    }
  }
  return isl as Island;
}

// ---------------------------------------------------------------- SPTH, 3VUE
export interface SplinePath { axes: Record<'SCPX' | 'SCPY' | 'SCPZ' | 'SCPH' | 'SCPP' | 'SCPR', { t: number; v: number }[]>; mode: number[] }
export function parseSpth(data: PwData, user: number): SplinePath {
  const axes: any = {}; let mode: number[] = [];
  for (const c of data.userChunks(user)) {
    const r = new R(c.data);
    if (c.tag.startsWith('SCP') && c.tag !== 'SCP#') {
      const n = r.u32(0); // PathAxis {u32 count; {f32 time, f32 val}[40]} (spath.c)
      axes[c.tag] = Array.from({ length: n }, (_, k) => ({ t: r.f(4 + k * 8), v: r.f(8 + k * 8) }));
    } else if (c.tag === 'SCP#') mode = Array.from({ length: c.data.length / 4 }, (_, k) => r.u32(k * 4));
  }
  return { axes, mode };
}
const HERMITE = [[2, -2, 1, 1], [-3, 3, -2, -1], [0, 0, 1, 0], [1, 0, 0, 0]];
// spath_80340CB8: per-axis cubic between keys with fixed tangents (1, -1) (as the game does).
export function spathAxis(keys: { t: number; v: number }[], time: number): number {
  if (time <= keys[0].t) return keys[0].v;
  if (time >= keys[keys.length - 1].t) return keys[keys.length - 1].v;
  let i = 1; while (i < keys.length && keys[i].t < time) i++;
  const u = (time - keys[i - 1].t) / (keys[i].t - keys[i - 1].t);
  const p = [keys[i - 1].v, keys[i].v, 1, -1];
  const c = HERMITE.map((row) => row.reduce((s, h, k) => s + h * p[k], 0));
  return u * u * u * c[0] + u * u * c[1] + u * c[2] + c[3];
}
// spathUpdate(pose, id, time, posScale): position and heading/pitch/roll (degrees) -> func_80313640.
export function spathPose(p: SplinePath, time: number, posScale = 1): Mtx {
  const a = p.axes;
  return poseZXY([spathAxis(a.SCPX, time) * posScale, spathAxis(a.SCPY, time) * posScale, spathAxis(a.SCPZ, time) * posScale],
    spathAxis(a.SCPH, time) * 0.01745329, spathAxis(a.SCPP, time) * 0.01745329, spathAxis(a.SCPR, time) * 0.01745329);
}
export interface ViewPath { comm: number[]; modelId: number; quat: { q: [number, number, number, number]; frame: number }[]; xlat: { p: V3; frame: number }[] }
export function parse3vue(data: PwData, user: number): ViewPath {
  const out: ViewPath = { comm: [], modelId: 0, quat: [], xlat: [] };
  for (const c of data.userChunks(user)) {
    const r = new R(c.data);
    if (c.tag === 'COMM') { out.comm = [r.s32(0), r.s32(4), r.s32(8), r.s32(12), r.s32(16), r.s16(20)]; out.modelId = r.s32(16); }
    if (c.tag === 'QUAT') for (let k = 0; k < r.s32(0); k++) out.quat.push({ q: [r.f(8 + k * 24), r.f(12 + k * 24), r.f(16 + k * 24), r.f(20 + k * 24)], frame: r.s32(24 + k * 24) });
    if (c.tag === 'XLAT') for (let k = 0; k < r.s32(0); k++) out.xlat.push({ p: r.v3(8 + k * 16), frame: r.s32(20 + k * 16) });
  }
  return out;
}

// ---------------------------------------------------------------- UVEN, UVLV, UVTP
export interface Env { id: number; models: { model: number; flag: number }[]; screen: number[]; fog: number[]; unused: number[]; fogMin: number; fogMax: number; fogEnabled: number; clearEnabled: number }
export function parseEnv(data: PwData, id: number): Env {
  const d = data.rom.comm('UVEN', 0)[id]; const r = new R(d);
  const n = r.u8(0); const models = Array.from({ length: n }, (_, k) => ({ model: r.u16(1 + 3 * k), flag: r.u8(3 + 3 * k) }));
  const o = 1 + 3 * n;
  const rgba = (p: number) => [r.u8(p), r.u8(p + 1), r.u8(p + 2), r.u8(p + 3)];
  return { id, models, screen: rgba(o), fog: rgba(o + 4), unused: rgba(o + 8), fogMin: r.f(o + 0x14), fogMax: r.f(o + 0x18), fogEnabled: r.u8(o + 0x1c), clearEnabled: r.u8(o + 0x2e) };
}
export interface LevelList { terra: number[]; light: number[]; env: number[]; model: number[]; contour: number[]; texture: number[]; seq: number[]; anim: number[]; font: number[]; blit: number[] }
export function parseUvlv(data: PwData, id: number): LevelList {
  const r = new R(data.rom.comm('UVLV', 0)[id]); let p = 0; const lists: number[][] = [];
  for (let k = 0; k < 10; k++) { const n = r.u16(p); p += 2; lists.push(Array.from({ length: n }, (_, i) => r.u16(p + 2 * i))); p += 2 * n; }
  const [terra, light, env, model, contour, texture, seq, anim, font, blit] = lists;
  return { terra, light, env, model, contour, texture, seq, anim, font, blit };
}
export function parseUvtp(data: PwData, id: number): Map<number, number> {
  const r = new R(data.rom.comm('UVTP', 0)[id]); const n = r.u16(0); const m = new Map<number, number>();
  for (let k = 0; k < n; k++) m.set(r.u16(2 + 4 * k), r.u16(4 + 4 * k));
  return m;
}

// ---------------------------------------------------------------- game tables (decomp; checked where noted)
export const MAP_IDS = [1, 3, 5, 10];
export const START_TERRA = [0, 1, 3, 7]; // taskInitTest
export const ALT_TERRA: Record<number, number> = { 1: 2, 3: 8 }; // task_80346370 terra selection 1 (Crescent cave, Ever-Frost)
export function envId(mapIndex: number, weather: number): number { // envGetCurrentId (map switch verified by A)
  const t = [[2, 3, 4, 22, 5, 6], [7, 8, 9, 10, 22, 11], [12, 13, 14, 15, 16, 17], [18, 19, 20, 22, 22, 21]];
  return t[mapIndex][weather] ?? 22;
}
export const ENV_PALETTE: Record<number, number> = { 6: 0, 11: 1, 17: 2, 18: 5, 19: 5, 20: 4, 21: 3 }; // envLoadTerrainPal
// env_802E1C1C: light colours (func_8020F99C) and the vertex/texel recolour calls (func_8020F5A4 = add/HSV blend,
// func_8020F630 = multiply). Light 0 is RGB, light 1 is an HSV target.
export type TintOp = { light: 0 | 1; kind: 'blend' | 'multiply'; factors?: V3 };
export const ENV_LIGHTS: Record<number, { colors: [V3 | null, V3 | null]; ops: TintOp[] }> = (() => {
  const L1: V3 = [1, 0, 0];
  const dusk = (s: number, v: number) => ({ light: 1 as const, kind: 'blend' as const, factors: [0, s, v] as V3 });
  const e: Record<number, { colors: [V3 | null, V3 | null]; ops: TintOp[] }> = {};
  for (const id of [4, 9, 10, 14, 15, 20]) e[id] = { colors: [null, L1], ops: [dusk(0.5, 0.2)] };
  for (const id of [5, 16]) e[id] = { colors: [[0.75, 0.4, 0.2], L1], ops: [{ light: 0, kind: 'blend', factors: [0.3, 0.3, 0.3] }, dusk(0.5, 0.2)] };
  e[6] = { colors: [[0.7, 0.7, 1.0], L1], ops: [{ light: 0, kind: 'multiply' }, dusk(0.5, 0.0)] };
  e[11] = { colors: [[0.7, 0.7, 1.0], L1], ops: [{ light: 0, kind: 'multiply' }, dusk(0.5, 0.15)] };
  e[17] = { colors: [[0.7, 0.7, 1.0], L1], ops: [{ light: 0, kind: 'multiply' }, dusk(0.5, 0.2)] };
  e[21] = { colors: [[0.4, 0.4, 1.0], L1], ops: [{ light: 0, kind: 'multiply' }, dusk(0.8, 0.2)] };
  return e;
})();

export const VEHICLES = ['Hang Glider', 'Rocket Belt', 'Gyrocopter', 'Cannonball', 'Sky Diving', 'Jumble Hopper', 'Birdman'];
export const ISLANDS = ['Holiday Island', 'Crescent Island', 'Little States', 'Ever-Frost Island'];

// Model ids (UVMD index; decomp uv_dobj.h names, the ids are the uvDobjModel arguments in the code).
export const M = {
  RING: [[[0xd9, 0xdd, 0xe1, 0xe5, 0xe9], [0xda, 0xde, 0xe2, 0xe6, 0xea]], [[0xdb, 0xdf, 0xe3, 0xe7, 0xeb], [0xdc, 0xe0, 0xe4, 0xe8, 0xec]]],
  RING_LOCKED_BLUE: 0xef, RING_LOCKED_GREY: 0xf0, RING_GOAL: 0xf1, BONUS_STAR: 0xf2,
  BALL: [0xf4, 0xf5, 0xf6], TARGET: [0xf9, 0xf8, 0xf7], HPAD: [0xfc, 0xfb], HPAD_LOCKED: 0xfa,
  BTGT: 0xf3, BTGT_SCORED: 0xd2, THERMAL: 0x101, LPAD: [0x102, 0x103, 0x104], LPAD_NOTARGET: 0xd4,
  CANNON_TARGET: [0x106, 0x107, 0x108], CANNON: 0x105, HOPD: 0x109, HOPD_SCORED: 0xd1,
  MECA_HAWK: 0xd3, MECA_HAWK_GIANT: 0xfd, MECA_HAWK_SHADOW: 0xfe, WIND_WAVE: [0xd5, 0xd6],
  WINDSOCK: 0x40, TURBINE: 0x53,
};
export const RING_DIAMETER = [7.5, 10, 12.5, 17.5, 25]; // gRingDiameters (pass test radius)
export const CANNON_TARGET_DZ = [35, 42.5, 50];
export const PHOTO_SUBJECT = ['?', 'space shuttle', 'ferry (cruise ship)', 'Nessie', 'whale', 'fountain', 'oil plant'];

// A placed game object: model + game matrix (before the dobj 1/scaleDiv), or a marker without model.
export interface Placed {
  layer: 'task' | 'island' | 'moving' | 'marker';
  kind: string; index: number; name: string;
  model?: number; mtx?: Mtx; hideParts?: number[];
  pos: V3; animated?: boolean; terra?: number; info: Record<string, string | number>;
}

const r1 = (v: number) => Math.round(v * 100) / 100;
const fv = (v: V3) => v.map(r1).join(',');

export function taskObjects(task: Task, island: Island): Placed[] {
  const out: Placed[] = [];
  const add = (p: Placed) => out.push(p);
  task.THER.forEach((t, i) => { // thermals.c: diag(scale, scale, height), rotate z (phase), translate; dobj scale applies after
    let m = identity(); m[0] = t.scale; m[5] = t.scale; m[10] = t.height;
    m = setPos(rotateAxis(m, (Math.PI * i) / task.THER.length, 'z'), t.pos);
    add({ layer: 'task', kind: 'THER', index: i, name: `thermal ${i}`, model: M.THERMAL, mtx: m, pos: t.pos, animated: true, info: { scale: r1(t.scale), height: r1(t.height), lift: r1(t.lift), swirl: r1(t.swirl) } });
  });
  task.LWIN.forEach((w, i) => { // wind.c windLoad: shape 0 sphere, 1 capsule p0->p1, 2 box
    let m = identity(); let model = M.WIND_WAVE[0]; let pos = w.p0;
    if (w.shape === 0) m = setPos(scaleRows(m, w.radius, w.radius, w.radius), w.p0);
    else if (w.shape === 1) {
      const d = [w.p1[0] - w.p0[0], w.p1[1] - w.p0[1], w.p1[2] - w.p0[2]]; const len = Math.hypot(d[0], d[1], d[2]);
      if (Math.abs(d[0]) > 0.01 || Math.abs(d[1]) > 0.01) {
        const z = d.map((v) => v / len); const up = [0, 0, 1];
        const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        const nrm = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]); return a.map((v) => v / l); };
        const x = nrm(cross(z, up)); const y = nrm(cross(x, z));
        m = [x[0], x[1], x[2], 0, -y[0], -y[1], -y[2], 0, z[0], z[1], z[2], 0, 0, 0, 0, 1];
      }
      pos = [(w.p0[0] + w.p1[0]) / 2, (w.p0[1] + w.p1[1]) / 2, (w.p0[2] + w.p1[2]) / 2];
      m = setPos(scaleRows(m, w.radius, w.radius, len), pos);
    } else if (w.shape === 2) {
      model = M.WIND_WAVE[1]; pos = w.boxPos;
      m = setPos(scaleRows(rotateAxis(rotateAxis(rotateAxis(identity(), w.boxRotDeg[0] * DEG, 'z'), w.boxRotDeg[1] * DEG, 'x'), w.boxRotDeg[2] * DEG, 'y'), w.boxSize[0], w.boxSize[1], w.boxSize[2]), w.boxPos);
    }
    add({ layer: 'task', kind: 'LWIN', index: i, name: `local wind ${i} (shape ${w.shape})`, model, mtx: m, pos, animated: true, info: { shape: w.shape, radius: r1(w.radius), vel: fv(w.vel), p1: fv(w.p1), boxSize: fv(w.boxSize) } });
  });
  task.TPAD.forEach((t, i) => add({ layer: 'marker', kind: 'TPAD', index: i, name: `start ${i}`, pos: t.pos, info: { heading: r1(t.angleDeg[0]), angles: fv(t.angleDeg), vel: fv(t.vel), onGround: t.onGround, fuel: r1(t.fuel) } }));
  // Landing pads (pads.c padsLoad): each task LPAD takes the nearest unused island LPAD within 100 units; every island
  // LPAD is drawn, with the task pad's model if it was taken, else the plain pad.
  const used = new Map<number, number>();
  task.LPAD.forEach((p, i) => {
    let best = -1, bd = 100;
    island.LPAD.forEach((q, j) => { const d = Math.hypot(p.pos[0] - q.pos[0], p.pos[1] - q.pos[1], p.pos[2] - q.pos[2]); if (d < bd && !used.has(j)) { bd = d; best = j; } });
    if (best >= 0) used.set(best, i);
    add({ layer: 'marker', kind: 'LPAD', index: i, name: `landing target ${i}${best < 0 ? ' (no island pad)' : ''}`, pos: best >= 0 ? island.LPAD[best].pos : p.pos, info: { type: p.type, islandPad: best, landingRadius: 30 } });
  });
  island.LPAD.forEach((q, j) => {
    const ti = used.get(j);
    const model = ti !== undefined ? M.LPAD[task.LPAD[ti].type] : M.LPAD_NOTARGET;
    add({ layer: ti !== undefined ? 'task' : 'island', kind: 'UPWL LPAD', index: j, name: `landing pad ${j}${ti !== undefined ? ` (target ${ti})` : ''}`, model, mtx: poseZXY(q.pos, q.angle, 0, 0), pos: q.pos, info: { angleRad: r1(q.angle), taskPad: ti ?? -1 } });
  });
  task.LSTP.forEach((s, i) => add({ layer: 'marker', kind: 'LSTP', index: i, name: `landing strip ${i}`, pos: [(s.p0[0] + s.p1[0]) / 2, (s.p0[1] + s.p1[1]) / 2, (s.p0[2] + s.p1[2]) / 2], info: { p0: fv(s.p0), p1: fv(s.p1), valid: s.valid, alignment: r1(s.alignment), length: r1(Math.hypot(s.p1[0] - s.p0[0], s.p1[1] - s.p0[1], s.p1[2] - s.p0[2])) } }));
  task.RNGS.forEach((g, i) => { // rings.c ringsLoad + rings_803234A4
    const sub = Math.min(g.subtype, 3); const size = g.size >= 5 ? 2 : g.size;
    const colour = !g.active || g.children.length ? 1 : 0;
    let model: number | undefined; let hide: number[] | undefined;
    if (g.active) {
      if (sub < 2) { model = M.RING[colour][sub][size]; hide = [2, 3, 5, 6, g.ringType === 0 ? 4 : 1]; }
      else if (sub === 3) model = M.RING_GOAL;
    } else model = sub === 0 ? M.RING_LOCKED_BLUE : sub === 2 ? undefined : M.RING_LOCKED_GREY;
    add({
      layer: model !== undefined ? 'task' : 'marker', kind: 'RNGS', index: i, name: `ring ${i}${model === undefined ? ' (invisible)' : ''}`, model, hideParts: hide,
      mtx: posePosDeg(g.pos, g.angleDeg), pos: g.pos, terra: g.terra, animated: g.rotAxis0 !== 'n' && g.rotAxis0 !== ' ' || (g.rotRate1 !== 0 && g.rotAxis1 !== 'n'),
      info: { size, diameter: RING_DIAMETER[size], subtype: sub, active: g.active, ringType: g.ringType, children: g.children.join('/'), timedChildren: g.timedChildren.join('/'), points: g.points, timed: r1(g.timedDuration), rot0: `${g.rotAxis0}${r1(g.rotRate0)} tr${r1(g.translation)}`, rot1: `${g.rotAxis1}${r1(g.rotRate1)}/${r1(g.rotRateTiming1)}/${r1(g.rotRateTimedOut1)}`, terra: g.terra },
    });
  });
  task.BALS.forEach((b, i) => add({ layer: 'task', kind: 'BALS', index: i, name: `balloon ${i}`, model: M.BALL[b.type] ?? M.BALL[0], mtx: setPos(scaleRows(identity(), b.scale, b.scale, b.scale), b.pos), pos: b.pos, terra: b.terra, animated: true, info: { type: b.type, scale: r1(b.scale), split: b.willSplit, points: b.points, gravity: r1(b.gravity), drag: r1(b.drag) } }));
  task.TARG.forEach((t, i) => add({ layer: 'task', kind: 'TARG', index: i, name: `target ${i}`, model: M.TARGET[t.type], mtx: posePosDeg(t.pos, t.rotDeg), pos: t.pos, animated: t.type === 0, info: { type: t.type, points: t.points, rot: fv(t.rotDeg) } }));
  task.HPAD.forEach((h, i) => add({ layer: 'task', kind: 'HPAD', index: i, name: `hover pad ${i}`, model: h.active ? M.HPAD[h.type > 1 ? 1 : h.type] : M.HPAD_LOCKED, mtx: posePosDeg(h.pos, h.rotDeg), pos: h.pos, terra: h.terra, info: { type: h.type, active: h.active, next: h.next.join('/'), points: h.points, fuel: r1(h.fuel) } }));
  task.BTGT.forEach((b, i) => { let m = identity(); m[0] = b.radius; m[5] = b.radius; m[10] = b.height; add({ layer: 'task', kind: 'BTGT', index: i, name: `ball goal ${i}`, model: M.BTGT, mtx: setPos(m, b.pos), pos: b.pos, terra: b.terra, info: { radius: r1(b.radius), height: r1(b.height) } }); });
  task.PHTS.forEach((p, i) => add({ layer: 'marker', kind: 'PHTS', index: i, name: `photo ${i}: ${PHOTO_SUBJECT[p.subject] ?? p.subject}`, pos: [0, 0, 0], info: { subject: p.subject, headingCheck: p.headingCheck, heading: r1(p.headingDeg), tolerance: r1(p.toleranceDeg), points: r1(p.points) } }));
  task.FALC.forEach((f, i) => {
    if (!f.present) { add({ layer: 'marker', kind: 'FALC', index: i, name: `Meca Hawk domain ${i} (empty)`, pos: f.pos, info: { radius: r1(f.domainRadius) } }); return; }
    add({ layer: 'task', kind: 'FALC', index: i, name: `Meca Hawk ${i}`, model: M.MECA_HAWK, mtx: setPos(identity(), f.pos), pos: f.pos, animated: true, info: { domainRadius: r1(f.domainRadius), pct: f.pct.join('/') } });
    add({ layer: 'task', kind: 'FALC shadow', index: i, name: `Meca Hawk ${i} ground marker`, model: M.MECA_HAWK_SHADOW, mtx: setPos(identity(), [f.pos[0], f.pos[1], 0]), pos: [f.pos[0], f.pos[1], 0], animated: true, info: {} });
  });
  task.CNTG.forEach((c, i) => add({ layer: 'task', kind: 'CNTG', index: i, name: `cannon target ${i}`, model: M.CANNON_TARGET[c.type] ?? M.CANNON_TARGET[2], mtx: posePosDeg(c.pos, c.angleDeg), pos: c.pos, info: { type: c.type, centreDz: CANNON_TARGET_DZ[c.type] ?? 50 } }));
  if (task.comm.veh === 3 && task.TPAD[0]) add({ layer: 'task', kind: 'cannon', index: 0, name: 'cannon', model: M.CANNON, mtx: posePosDeg(task.TPAD[0].pos, task.TPAD[0].angleDeg), pos: task.TPAD[0].pos, info: { note: 'hypothesis: at TPAD (cannonball.c db_getstart)' } });
  task.HOPD.forEach((h, i) => { let m = identity(); m[0] = h.radius; m[5] = h.radius; m[10] = h.height; add({ layer: 'task', kind: 'HOPD', index: i, name: `hopper goal ${i}`, model: M.HOPD, mtx: setPos(m, h.pos), pos: h.pos, terra: h.terra, info: { radius: r1(h.radius), height: r1(h.height) } }); });
  return out;
}

export function islandObjects(island: Island, data: PwData, opts: { birdman?: boolean } = {}): Placed[] {
  const out: Placed[] = [];
  island.WOBJ.forEach((w, i) => out.push({ layer: 'island', kind: 'WOBJ', index: i, name: `${['windsock', 'wind turbine', 'windsock (simple)'][w.type]} ${i}`, model: w.type === 1 ? M.TURBINE : M.WINDSOCK, mtx: setPos(identity(), w.pos), pos: w.pos, animated: w.type !== 2, info: { type: w.type } }));
  island.BNUS.forEach((b, i) => out.push({ layer: 'island', kind: 'BNUS', index: i, name: `bonus star ${i}`, model: M.BONUS_STAR, mtx: posePosDeg(b.pos, b.rotDeg), pos: b.pos, terra: b.terra, animated: true, info: { terra: b.terra } }));
  island.TOYS.forEach((t, i) => out.push({ layer: 'marker', kind: 'TOYS', index: i, name: `toy ${i}`, pos: t.pos, info: { note: 'animates the UVCT static object at this point' } }));
  island.TPTS.forEach((t, i) => out.push({ layer: 'marker', kind: 'TPTS', index: i, name: `terrain switch ${i}`, pos: t.pos, info: { mode: t.mode, dir: r1(t.dirDeg), radius: r1(t.radius), terraPos: t.terraPos, terraNeg: t.terraNeg, shift: fv(t.shift) } }));
  island.APTS.forEach((a, i) => out.push({ layer: 'marker', kind: 'APTS', index: i, name: `audio point ${i}`, pos: a.pos, info: { mode: a.mode, radius: r1(a.radius), dir: r1(a.dirDeg), vol: `${r1(a.vol0)}/${r1(a.vol1)}` } }));
  island.ESND.forEach((e, i) => { const p: V3 = e.attr & 2 ? e.p0 : [e.mtx[12], e.mtx[13], e.mtx[14]]; out.push({ layer: 'marker', kind: 'ESND', index: i, name: `sound ${i} (snd ${e.snd})`, pos: p, info: { snd: e.snd, near: r1(e.near), far: r1(e.far), attr: e.attr, p1: fv(e.p1) } }); });
  // Code-driven moving objects (level_8030B868; start data from the decomp sources, positions verified as plausible).
  const mv = (name: string, model: number, m: Mtx, info: Record<string, string | number> = {}) => out.push({ layer: 'moving', kind: 'code', index: out.length, name, model, mtx: m, pos: [m[12], m[13], m[14]], animated: true, info });
  const orbit = (c: V3, radius: number) => rotateAxis(localTranslate(localTranslate(identity(), c[0], c[1], c[2]), radius, 0, 0), -0.26179937, 'y'); // gliderToyUpdate at angle 0
  const glider = [0x10b, 0x10c, 0x10d, 0x10e]; // gliderToyModelLookup for pilot Lark
  const boat = (c: V3, r: number, model: number, roll: number) => rotateAxis(localTranslate(identity(), c[0] + r, c[1], c[2]), roll * DEG, 'y'); // hypothesis (boatsUpdate not fully read)
  switch (island.mapIndex) {
    case 0:
      [[-66, 320, 125, 80], [-66, 320, 135, 70], [-70, 320, 155, 90]].forEach((g, k) => mv(`glider toy ${k}`, glider[k], orbit([g[0], g[1], g[2]], g[3]), { orbitRadius: g[3] }));
      mv('speed boat', 0x03, boat([-600, -600, 0], 300, 3, -5), { orbitCentre: '-600,-600,0', radius: 300 });
      mv('sail boat', 0x01, boat([700, -500, 0], 300, 1, 15), { orbitCentre: '700,-500,0', radius: 300 });
      break;
    case 1:
      mv('whale', 0xd7, setPos(identity(), [750, 100, 4.5]));
      mv('fountain', 0x26, setPos(identity(), [-288, -99, 5.75]));
      mv('speed boat', 0x03, boat([400, -300, 0], 400, 3, -5), { orbitCentre: '400,-300,0', radius: 400 });
      mv('yacht', 0x29, boat([300, -200, 0], 275, 0x29, 0), { orbitCentre: '300,-200,0', radius: 275 });
      [[-891.24, 602.16, 450, 220], [1100.06, 686.22, 250, 70], [1050.06, 686.22, 265, 0]].forEach((g, k) => mv(`glider toy ${k}`, glider[k], orbit([g[0], g[1], g[2]], g[3]), { orbitRadius: g[3] }));
      break;
    case 2: {
      mv('space shuttle', 0x56, setPos(identity(), [2870, -2230, 57.51]));
      mv('ferry (cruise ship)', 0x52, setPos(identity(), [1150, -2150, 8.8]));
      mv('Nessie', 0x58, setPos(identity(), [1725, -659, 28]));
      [[1666.32, -1099.06, 100, 30], [3293.09, 931.19, 150, 60], [-2294.23, -791.48, 150, 30], [-2290.23, -791.48, 170, 50]].forEach((g, k) => mv(`glider toy ${k}`, glider[k], orbit([g[0], g[1], g[2]], g[3]), { orbitRadius: g[3] }));
      const p6 = parseSpth(data, 0x6d), p7 = parseSpth(data, 0x6e);
      mv('plane (big white/red)', 0x27, spathPose(p6, 0), { path: 'SPTH user 0x6D' });
      mv('plane (yellow/white)', 0x1b, spathPose(p7, 0), { path: 'SPTH user 0x6E' });
      break;
    }
    case 3: {
      mv('oil spray', 0xa6, setPos(identity(), [-73.8, 575.7, 88.3]));
      const lift = parseSpth(data, 4);
      for (let k = 0; k < 20; k++) mv(`ski lift chair ${k}`, 0xa7, spathPose(lift, (k / 20) * 100), { path: 'SPTH user 0x04', time: (k / 20) * 100 });
      for (let k = 0; k < 5; k++) mv(`whale ${k}`, 0xd7, setPos(identity(), [1156.66, 1770.82, 0]), { note: 'pod start point' });
      break;
    }
  }
  return out;
}

// Ring course: edges from each ring to the rings it activates (childRings) and to timed rings it starts.
export function ringGraph(task: Task) {
  const edges: { from: number; to: number; timed: boolean }[] = [];
  task.RNGS.forEach((g, i) => { g.children.forEach((c) => edges.push({ from: i, to: c, timed: false })); g.timedChildren.forEach((c) => edges.push({ from: i, to: c, timed: true })); });
  const startActive = task.RNGS.map((g, i) => (g.active ? i : -1)).filter((i) => i >= 0);
  return { edges, startActive, ordered: edges.length > 0 };
}

// Start pose (db_getstart) and the chase camera the vehicle code sets up (decomp: hang_glider1.c, code_AC1A0.c, ...).
// Camera matrices use +Y forward, +Z up. Zoom z -> vertical FOV 2*atan(0.35 / z) (camera_802D45C4 + cameraInit frustum).
export const VEHICLE_CAMERA: Record<number, { mode: number; offset: V3; zoom: number; note: string }> = {
  0: { mode: 0, offset: [0, -6, 0.5], zoom: 1.0, note: 'lagged chase (0.23 s), distance clamp 1.8..18' },
  1: { mode: 4, offset: [0, -6, 0], zoom: 0.8, note: 'heading-follow, 6 behind, pitch 0' },
  2: { mode: 0, offset: [0, -4.45, 1.2], zoom: 0.8, note: 'lagged chase (0.06 s), clamp 1.8..7.9' },
  3: { mode: 5, offset: [0, -1, -2], zoom: 1.0, note: 'cannon aim camera (mode 5, not modelled)' },
  4: { mode: 5, offset: [0, -5, 0], zoom: 0.5, note: 'sky diving (mode 5, distance 5)' },
  5: { mode: 9, offset: [0, -5, 0], zoom: 0.7, note: 'hopper (mode 9)' },
  6: { mode: 0, offset: [0, -3.5, 0.5], zoom: 1.0, note: 'lagged chase (0.0125 s), clamp 3..6.5' },
};
export function startCamera(task: Task) {
  const t = task.TPAD[0];
  // Rocket Belt starts receive the runtime model-origin lift.
  // E3 verified +0.745 at task 9: start row z=5.0, live pose/camera target z=5.745.
  const startPos: V3 | undefined = t ? [t.pos[0], t.pos[1], t.pos[2] + (task.comm.veh === 1 ? 0.745 : 0)] : undefined;
  const pose = t && startPos ? posePosDeg(startPos, t.angleDeg) : identity();
  const cam = VEHICLE_CAMERA[task.comm.veh];
  let eye: V3;
  if (cam.mode === 4 || cam.mode === 5) { // camera_802D532C: yaw only, then translate back
    const h = Math.atan2(pose[0], pose[1]) - Math.PI / 2; // unk1AC = atan2(m[0][0], m[0][1]) - pi/2
    const m = localTranslate(rotateAxis(setPos(identity(), [pose[12], pose[13], pose[14]]), -h, 'z'), 0, -Math.abs(cam.offset[1]), 0);
    eye = [m[12], m[13], m[14]];
  } else eye = transformPoint(pose, cam.offset);
  const target: V3 = [pose[12], pose[13], pose[14]];
  return { pose, eye, target, fovY: (2 * Math.atan(0.35 / cam.zoom) * 180) / Math.PI, aspect: 300 / 214, cam };
}
