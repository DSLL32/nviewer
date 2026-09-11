// Star Fox 64 (US V1.0 and V1.1): levels built from the placement lists (STARFOX.md §4-§5).
//
// Each level is a scene (overlay + up to 15 asset files, one per RSP segment) and a list of 0x14-byte object records.
// Object display lists carry no render state: the game calls one of 88 presets from main first, so every draw is a
// small synthesised list {preset, recipe commands, object list}. Objects are placed in a right-handed Y-up world
// with 1 vertex unit = 1 world unit; on-rails z = -zPos1 - 3000 + zPos2. Lit presets shade by vertex normals with
// the environment record's light, baked into vertex colours.
import { buildLevel, fogPosition, meshFromBatches } from '../bomberman/common';
import { sf64Music } from '../music/sf64';
import { type DlLighting, runDisplayList } from '../displaylist';
import type { Backdrop, Batch, CameraView, DebugInfo, Game, Instance, Level, LevelInfo, LevelKind, LevelLayer, Marker, Mesh, Sky, Texture } from '../types';
import { Sf64Files, Space } from './fs';
import { EVENT_NAMES, OBJECT_NAMES } from './names';

// ---- matrices as sys_matrix.c: row-major, row vectors (v' = v M); each call applies in the object's local frame ----
type M = number[];
const ident = (): M => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function translate(m: M, x: number, y: number, z: number) { for (let i = 0; i < 4; i++) m[12 + i] += m[i] * x + m[4 + i] * y + m[8 + i] * z; }
function scale(m: M, x: number, y: number, z: number) { for (let i = 0; i < 4; i++) { m[i] *= x; m[4 + i] *= y; m[8 + i] *= z; } }
function rotX(m: M, a: number) { const s = Math.sin(a), c = Math.cos(a); for (let i = 0; i < 4; i++) { const ry = m[4 + i], rz = m[8 + i]; m[4 + i] = ry * c + rz * s; m[8 + i] = rz * c - ry * s; } }
function rotY(m: M, a: number) { const s = Math.sin(a), c = Math.cos(a); for (let i = 0; i < 4; i++) { const rx = m[i], rz = m[8 + i]; m[i] = rx * c - rz * s; m[8 + i] = rx * s + rz * c; } }
function rotZ(m: M, a: number) { const s = Math.sin(a), c = Math.cos(a); for (let i = 0; i < 4; i++) { const rx = m[i], ry = m[4 + i]; m[i] = rx * c + ry * s; m[4 + i] = ry * c - rx * s; } }
const DTOR = Math.PI / 180;
const rotYXZ = (rx: number, ry: number, rz: number): M => { const m = ident(); rotY(m, ry * DTOR); rotX(m, rx * DTOR); rotZ(m, rz * DTOR); return m; };

// ---- display-list commands for synthesised lists (F3DEX) ----
type W = [number, number];
const G_DL = (addr: number): W => [0x06000000, addr >>> 0];
const G_ENDDL: W = [0xb8000000, 0];
const clearGeom = (bits: number): W => [0xb6000000, bits];
const setGeom = (bits: number): W => [0xb7000000, bits];
const CULL_BACK = 0x2000;
const prim = (r: number, g: number, b: number, a: number): W => [0xfa000000, ((r << 24) | (g << 16) | (b << 8) | a) >>> 0];
const POINT_FILTER: W = [0xba001402, 0]; // G_SETOTHERMODE_H texture filter = point

// gDPLoadTileTexture + gDPSetupTile for an RGBA16 tile, as game code textures the grounds (mask 5 = 32 texels; the
// games pass shift 0, G_TX_NOLOD).
function tileTexture(timg: number, w: number, h: number, cms: number, cmt: number, shift: number): W[] {
  const setTile = (siz: number, line: number, tile: number, ct: number, mt: number, st: number, cs: number, ms: number, ss: number): W =>
    [(0xf5 << 24) | (siz << 19) | ((line & 0x1ff) << 9), (tile << 24) | (ct << 18) | (mt << 14) | (st << 10) | (cs << 8) | (ms << 4) | ss];
  return [
    [(0xfd << 24) | (2 << 19) | 1, timg],
    setTile(2, 0, 7, 0, 0, 0, 0, 0, 0),
    [0xf3 << 24, (7 << 24) | ((w * h - 1) << 12) | Math.ceil(2048 / Math.max(1, (w * 2) >> 2))],
    setTile(2, (w * 2 + 7) >> 3, 0, cmt, 5, shift, cms, 5, shift),
    [0xf2 << 24, ((w - 1) << 14) | ((h - 1) << 2)],
  ];
}

// Assets named in the sf64 decompilation, as segment addresses (identical in V1.0 and V1.1).
const A = {
  aA6NinjinMissileDL: 0x06018bf0, aA6RocketDL: 0x06019730, aA6SpaceMineDL: 0x0601a120, aA6UmbraStationDL: 0x0600e0c0,
  aAqBoulderDL: 0x06014fd0, aAqBump2DL: 0x0600eef0, aAqCoralAnim: 0x0601ec68, aAqCoralSkel: 0x0601edb4, aAqOysterAnim: 0x0602201c,
  aAqOysterSkel: 0x060220e8, aAqSeaweedAnim1: 0x06020a40, aAqSeaweedSkel: 0x06020c6c, aAqShellDL: 0x06000e10, aAqStarfishDL: 0x06008970,
  aAqStoneColumnAnim: 0x06014438, aAqStoneColumnSkel: 0x06014504, aAqStoneColumnDL: 0x06014520, aBillShipDL: 0x0d00b880,
  aCoBuilding10DL: 0x06035da0, aCoBuilding9DL: 0x0602da20, aCoDoorsAnim: 0x0602aa7c, aCoDoorsSkel: 0x0602ab48, aCoIBeamDL: 0x06023ac0,
  aCruiserGunAnim: 0x0400a30c, aCruiserGunSkel: 0x0400a398, aFirebirdAnim: 0x040057ac, aFirebirdSkel: 0x040058b8,
  aFoBaseDL1: 0x0600d5c0, aFoBaseDL2: 0x06003090, aGreatFoxIntactDL: 0x0e000000, aKaFLBaseDL: 0x0600baf0, aKattShipDL: 0x0d009a40,
  aKillerBeeAnim: 0x04000080, aKillerBeeSkel: 0x0400014c, aMaIndicatorSignDL: 0x060066a0, aMaLaserTurretDL: 0x0600da10,
  aMaProximityLightSidesDL: 0x06010700, aMaProximityLightTopDL: 0x0601f270, aMaSwitchTrackAnim: 0x06025ca0, aMaSwitchTrackSkel: 0x06025dac,
  aMaTowerBottomDL: 0x060253e0, aMaTowerTopDL: 0x0601c000, aMaTrainStopBlockAnim: 0x0600c4d0, aMaTrainStopBlockSkel: 0x0600c65c,
  aMeFlipBot1DL: 0x06008aa0, aMeFlipBot2DL: 0x06009e30, aMeMeteoTunnelDL: 0x0601ae40, aMeRockGull1DL: 0x0600caa0,
  aMeRockGull2DL: 0x0600c130, aMeRockGull3DL: 0x0600c740, aSoGoreAnim: 0x0600636c, aSoGoreSkel: 0x06006558, aSxLaserDL: 0x060066f0,
  aSyDebrisDL: 0x0601ad70, aTiBomberAnim: 0x0700caf4, aTiBomberSkel: 0x0700cb60, aTrGroundDL: 0x06005880, aTripodAnim: 0x040001a4,
  aTripodSkel: 0x04000270, aVe1PillarDL: 0x09011200, aVe1Wall1DL: 0x06007d90, aVe1Wall2DL: 0x06007cf0,
  aVe2AndrossGateAnim: 0x06014658, aVe2AndrossGateSkel: 0x06014844, aVe2BaseAnim: 0x06014904, aVe2BaseSkel: 0x060149d0,
  aSxWarpGateAnim: 0x06013820, aSxWarpGateSkel: 0x0601390c,
};
const MA_DISTANCE_SIGNS = [0x06007430, 0x06007360, 0x06007290, 0x060071c0, 0x06007500];
const MA_RAILROAD_SWITCHES = [0x0600ad50, 0x0600aa70, 0x06003070, 0x0600a7d0, 0x0600a4d0, 0x0600a1f0, 0x06009f10, 0x06009c50];

interface ObjectInit { zPos1: number; zPos2: number; x: number; y: number; rx: number; ry: number; rz: number; id: number; index: number; at: number }

function readList(space: Space, addr: number): ObjectInit[] {
  const o = space.resolve(addr);
  const out: ObjectInit[] = [];
  if (o < 0) return out;
  const dv = space.dv;
  for (let i = 0; i < 4000 && o + (i + 1) * 0x14 <= space.buf.length; i++) {
    const p = o + i * 0x14, id = dv.getInt16(p + 0x10);
    if (id <= -1) break;
    out.push({ zPos1: dv.getFloat32(p), zPos2: dv.getInt16(p + 4), x: dv.getInt16(p + 6), y: dv.getInt16(p + 8), rx: dv.getInt16(p + 10),
      ry: dv.getInt16(p + 12), rz: dv.getInt16(p + 14), id, index: i, at: addr + i * 0x14 });
  }
  return out;
}

const objectName = (id: number) => (id >= 1000 ? `event script ${id - 1000}` : OBJECT_NAMES[id] ?? `object ${id}`);

// ---- skeletons at a fixed frame (Animation_DrawSkeleton) ----
// Limb (0x20): Gfx* dList; f32 trans x, y, z; s16 rot (unused); Limb* sibling; Limb* child. Skeleton: NULL-terminated
// Limb* array, element 0 the root, limb index = position + 1. Animation {s16 frames, limbs; u16* data; JointKey* keys}:
// key 0 is the root translation, keys 1..limbs rotations (u16 * 360 / 65536 degrees). Each limb: T(trans) RZ RY RX.
interface Part { words: W[]; m: M }

function skeleton(space: Space, skel: number, anim: number, frame: number, mode: number, base: M, limbWords: (limb: number, dl: number) => W[] | null): Part[] {
  const dv = space.dv, parts: Part[] = [], limbs: number[] = [];
  for (let k = 0; k < 64; k++) { const p = space.u32(skel + 4 * k); if (!p) break; limbs.push(p); }
  const ao = space.resolve(anim);
  if (!limbs.length || ao < 0) return parts;
  const limbCount = dv.getInt16(ao + 2), fd = space.resolve(dv.getUint32(ao + 4)), jk = space.resolve(dv.getUint32(ao + 8));
  if (fd < 0 || jk < 0) return parts;
  const key = (k: number) => [0, 4, 8].map((c) => {
    const len = dv.getUint16(jk + 12 * k + c), idx = dv.getUint16(jk + 12 * k + c + 2);
    return dv.getUint16(fd + 2 * (frame < len ? idx + frame : idx));
  });
  const visit = (p: number, parent: M, root: boolean, depth: number) => {
    const o = space.resolve(p);
    if (o < 0 || depth > 64) return;
    const idx = limbs.indexOf(p) + 1;
    const t = root && !(mode & 1) ? key(0).map((q) => (q << 16) >> 16) : [dv.getFloat32(o + 4), dv.getFloat32(o + 8), dv.getFloat32(o + 12)];
    const r = idx >= 1 && idx <= limbCount ? key(idx).map((q) => ((q * 360) / 65536) * DTOR) : [0, 0, 0];
    const m = parent.slice();
    translate(m, t[0], t[1], t[2]); rotZ(m, r[2]); rotY(m, r[1]); rotX(m, r[0]);
    const dl = dv.getUint32(o);
    const words = dl ? limbWords(idx - 1, dl) : null;
    if (words) parts.push({ words, m });
    if (dv.getUint32(o + 0x1c)) visit(dv.getUint32(o + 0x1c), m, false, depth + 1);
    if (!root && dv.getUint32(o + 0x18)) visit(dv.getUint32(o + 0x18), parent, false, depth + 1);
  };
  visit(limbs[0], base, true, 0);
  return parts;
}

// ---- event actors (ids >= 1000): script walk to the actor type (ActorEvent_ProcessScript) ----
// A command is two u16 words: opcode (w >> 9) & 0x7F, arg1 w & 0x1FF; arg2. Command k is at byte 4k.
const EVENT_SCRIPTS: Record<number, number> = {
  0: 0x0603d9e8, 1: 0x0602f3ac, 2: 0x060320d0, 3: 0x06027f50, 4: 0x060289fc, 5: 0x06032e18, 7: 0x06020dd0, 8: 0x0602aac0,
  9: 0x0c037e3c, 10: 0x06009b34, 11: 0x060381d8, 12: 0x0600631c, 13: 0x060308b8,
};

interface ScriptWalk { types: number[]; moves: boolean; branches: [number, number][] }

function walkScript(space: Space, table: number, script: number, pc: number): ScriptWalk {
  const res: ScriptWalk = { types: [], moves: false, branches: [] };
  const seen = new Set<string>();
  for (let n = 0; n < 400; n++) {
    const k = `${script}/${pc}`;
    if (seen.has(k)) break;
    seen.add(k);
    const o = space.resolve(space.u32(table + script * 4));
    if (o < 0 || o + pc + 4 > space.buf.length) break;
    const w = space.dv.getUint16(o + pc), a2 = space.dv.getUint16(o + pc + 2);
    const op = (w >> 9) & 0x7f, a1 = w & 0x1ff;
    if (op === 104) res.types.push(a2); // INIT_ACTOR
    else if (op === 0 || op === 1) { if ((a1 & 0x7f) !== 0 || ((w >> 7) & 3) === 1 || ((w >> 7) & 3) === 2) res.moves = true; } // speed
    else if ((op >= 9 && op <= 12) || (op >= 40 && op <= 47)) res.moves = true; // turns, pursuit
    else if (op === 96) res.branches.push(a1 < 200 ? [script, a1 * 4] : [a1 - 200, 0]); // SET_TRIGGER
    else if (op === 127) break; // STOP
    if (op === 126) { // LOOP
      if (a1 < 200) pc = a1 * 4; else { script = a1 - 200; pc = 0; }
      continue;
    }
    pc += 4;
  }
  return res;
}

// The actor type: the first INIT_ACTOR on the script's main path, else on its trigger branches (breadth first).
function eventModel(space: Space, table: number, index: number): { type: number; moves: boolean } {
  const main = walkScript(space, table, index, 0);
  if (main.types.length) return { type: main.types[0], moves: main.moves };
  const queue = [...main.branches], seen = new Set<string>();
  while (queue.length && seen.size <= 16) {
    const [sc, pc] = queue.shift()!;
    if (seen.has(`${sc}/${pc}`)) continue;
    seen.add(`${sc}/${pc}`);
    const w = walkScript(space, table, sc, pc);
    if (w.types.length) return { type: w.types[0], moves: w.moves };
    queue.push(...w.branches);
  }
  return { type: -1, moves: false };
}

// ---- Titania terrain (ovl_i5 fox_ground.c): a 16-column height row per 220 units of path progress ----
// Rows come from OBJ_ACTOR_TI_TERRAIN records {type = yPos, x = xPos, width = rot.x, height = rot.y, length = rot.z},
// active from zPos1: 1 cosine bump, 2 plateau, 3 winding ridge, 4-7 flat plane / terrain toggles, 8 random mountains.
const TI_ROW = 220;
const tiColumnX = (j: number) => (j === 0 ? -4000 : j === 15 ? 4000 : j * 220 - 1760);

function simulateTitania(objs: ObjectInit[], endP: number) {
  const recs = objs.filter((o) => o.id === 224).sort((a, b) => a.zPos1 - b.zPos1);
  interface Rec { type: number; x: number; width: number; height: number; length: number; state: number; u20: number; freed: boolean }
  const active: Rec[] = [];
  const rows: { P: number; h: number[] }[] = [];
  const flat: [number, number][] = [];
  const FLAT_TYPE = [0, 0, 0, 0, 4, 5, 6, 7, 0, 0, 0, 0];
  const trunc = Math.trunc;
  let ri = 0, flags = 1, flatStart: number | null = null;
  const process = (row: number[] | null, f: number): number => {
    for (const r of active) {
      if (r.freed) continue;
      const type = row === null ? FLAT_TYPE[r.type] ?? 0 : r.type;
      if (r.state === 1) {
        if (type === 1 || type === 3) r.u20 = r.length;
        else if (type === 4) f |= 2;
        else if (type === 5) f &= ~1;
        else if (type === 6) f |= 1;
        else if (type === 7) f &= ~2;
        else if (type === 8) r.u20 = 5000;
        r.state = 2;
      }
      if (type === 0) continue;
      if (type === 1) {
        for (let j = 0; j < 16; j++) {
          const t = j * 220 - 1760 - r.x;
          if (Math.abs(t) <= r.width) row![j] = trunc(row![j] + Math.cos((t / r.width) * (Math.PI / 2)) * r.height * Math.sin((r.u20 / r.length) * Math.PI));
        }
        r.u20 -= 220;
        if (r.u20 <= 0) r.freed = true;
      } else if (type === 2) {
        const x0 = r.x + (1760 - r.width * 0.5), k = 70 * DTOR;
        let v = r.height;
        if (r.u20 <= v / k) v = r.u20 * k; else if (v / k >= r.length - r.u20) v = (r.length - r.u20) * k;
        for (let j = 0, x = 0; j < 16; j++, x += 220) if (x0 <= x && x <= x0 + r.width && row![j] < v) row![j] = trunc(v);
        r.u20 += 220;
        if (r.length <= r.u20) r.freed = true;
      } else if (type === 3) {
        for (let j = 0; j < 16; j++) {
          const t = j * 220 - 1760 - r.x + Math.sin(((r.u20 * 8) / r.length) * 2 * Math.PI) * 500;
          if (Math.abs(t) <= r.width) row![j] = trunc(row![j] - Math.min(0.7, Math.cos((t / r.width) * (Math.PI / 2))) * r.height * 4 * ((r.length - r.u20) / r.length));
          row![j] = trunc(row![j] + (r.height - (r.u20 / r.length) * r.height) * 4 * 0.7);
        }
        r.u20 -= 220;
        if (r.u20 <= 0) r.freed = true;
      } else {
        r.freed = true; // 8 (random mountains) is not in the data
      }
    }
    return f;
  };
  for (let P = -26 * TI_ROW; P <= endP; P += TI_ROW) {
    while (P >= 0 && ri < recs.length && recs[ri].zPos1 <= P) {
      const o = recs[ri++];
      if (active.filter((a) => !a.freed).length < 20) active.push({ type: o.y, x: o.x, width: o.rx, height: o.ry, length: o.rz, state: 1, u20: 0, freed: false });
    }
    let f = flags;
    if (flags & 2) f = process(null, f); // records registered while the flat plane is on are lost
    if (flags & 1) { const row = new Array<number>(16).fill(0); f = process(row, f); rows.push({ P, h: row }); }
    if (f & 2 && flatStart === null) flatStart = P;
    if (!(f & 2) && flatStart !== null) { flat.push([flatStart, P]); flatStart = null; }
    flags = f;
    for (let i = active.length - 1; i >= 0; i--) if (active[i].freed) active.splice(i, 1);
  }
  if (flatStart !== null) flat.push([flatStart, endP]);
  return { rows, flat };
}

// ---- level definitions ----
type Ground =
  | { kind: 'corneria' } // on-rails strip, grass / rock / water per path section
  | { kind: 'rails'; dl: number; tex?: number; preset: number } // 8000 x 12000 strip drawn at half depth
  | { kind: 'range'; dl: number; preset: number } // 12000 x 12000 tiles
  | { kind: 'wave'; dl: number; vtx: [number, number]; zOff: number } // Solar lava / Zoness sea grid
  | { kind: 'titania' }
  | { kind: 'aquas' };

interface BackdropDef { dl: number; z: number; sx: number; yOff: number; eyeFactor: number }
const planetBackdrop = (dl: number, yOff = -2000, eyeFactor = 0.4): BackdropDef => ({ dl, z: -6000, sx: 1, yOff, eyeFactor });
const wideBackdrop = (dl: number, yOff: number): BackdropDef => ({ dl, z: -7000, sx: 1.5, yOff, eyeFactor: 0.6 });

interface LevelDef {
  name: string; kind: LevelKind; group: string;
  level: number; scene: number; list?: number; env?: number;
  mode: 'rails' | 'range'; zSign?: 1 | -1;
  ground?: Ground; backdrop?: BackdropDef;
  eye?: [number, number, number]; target?: [number, number, number];
  base?: 'fortuna' | 'katina' | 'bolse' | 'venom2';
  clear?: number; // RGBA5551 the game clears to, when code overrides the record
  far?: number; warp?: boolean; randomY?: boolean; scene360?: 'corneria' | 'andross'; zPos2?: boolean;
}

const S = { corneria: 11, meteo: 12, titania: 14, sectorX: 20, sectorZ: 22, aquas: 23, area6: 24, fortuna: 25, unk4: 27, sectorY: 28,
  solar: 29, zoness: 30, venom1: 31, andross: 32, venom2: 33, bolse: 36, katina: 37, macbeth: 38, training: 40, versus: 41 };
const RAILS = 'On-rails', RANGE = 'All-range';
const VE1_GROUND: Ground = { kind: 'rails', dl: 0x060066d0, tex: 0x06006750, preset: 29 };

const DEFS: LevelDef[] = [
  { name: 'Corneria', kind: 'campaign', group: RAILS, level: 0, scene: S.corneria, mode: 'rails', ground: { kind: 'corneria' },
    backdrop: planetBackdrop(0x060059f0, -2000, 0.6), clear: 0x190f, eye: [329, 578, 400], target: [329, 548, -1] },
  { name: 'Meteo', kind: 'campaign', group: RAILS, level: 1, scene: S.meteo, mode: 'rails', eye: [-855, 526, 400], target: [-855, 494, -1] },
  { name: 'Sector X', kind: 'campaign', group: RAILS, level: 2, scene: S.sectorX, mode: 'rails', eye: [0, 182, 400], target: [0, 150, -41] },
  { name: 'Area 6', kind: 'campaign', group: RAILS, level: 3, scene: S.area6, mode: 'rails', eye: [0, 322, 400], target: [0, 290, -1] },
  { name: 'Sector Y', kind: 'campaign', group: RAILS, level: 5, scene: S.sectorY, mode: 'rails', eye: [0, 50, 400], target: [0, 21, -41] },
  { name: 'Venom 1', kind: 'campaign', group: RAILS, level: 6, scene: S.venom1, mode: 'rails', ground: VE1_GROUND,
    backdrop: planetBackdrop(0x060046f0, -2000, 0.6), eye: [165, 137, 400], target: [165, 109, -1] },
  { name: 'Solar', kind: 'campaign', group: RAILS, level: 7, scene: S.solar, mode: 'rails', ground: { kind: 'wave', dl: 0x060005b0, vtx: [0x06001c50, 0x06004500], zOff: -2000 },
    backdrop: wideBackdrop(0x0601e150, -3500), eye: [0, 322, 400], target: [0, 290, -41] },
  { name: 'Zoness', kind: 'campaign', group: RAILS, level: 8, scene: S.zoness, mode: 'rails', ground: { kind: 'wave', dl: 0x06008830, vtx: [0x06009ed0, 0x0600c780], zOff: -1500 },
    backdrop: wideBackdrop(0x06013480, -3000), clear: 0x4107, eye: [-181, 141, 400], target: [-181, 114, -1] },
  { name: 'Macbeth', kind: 'campaign', group: RAILS, level: 11, scene: S.macbeth, mode: 'rails', ground: { kind: 'rails', dl: 0x060306d0, tex: 0x0602dcb8, preset: 29 },
    backdrop: wideBackdrop(0x06019220, -4000), eye: [-172, 109, 200], target: [-172, 27, -800] },
  { name: 'Titania', kind: 'campaign', group: RAILS, level: 12, scene: S.titania, mode: 'rails', ground: { kind: 'titania' },
    backdrop: wideBackdrop(0x06000a80, -3000), eye: [0, 35, 200], target: [0, 224, -800] },
  { name: 'Aquas', kind: 'campaign', group: RAILS, level: 13, scene: S.aquas, mode: 'rails', ground: { kind: 'aquas' },
    backdrop: wideBackdrop(0x0601aff0, 0), eye: [0, 410, 240], target: [0, 362, -1] },

  { name: 'Fortuna', kind: 'campaign', group: RANGE, level: 14, scene: S.fortuna, mode: 'range', zSign: 1, ground: { kind: 'range', dl: 0x06001360, preset: 20 },
    backdrop: planetBackdrop(0x0600d9f0, -4000), base: 'fortuna', eye: [0, 861, -11869], target: [0, 812, -11131] },
  { name: 'Katina', kind: 'campaign', group: RANGE, level: 16, scene: S.katina, mode: 'range', zSign: 1, ground: { kind: 'range', dl: 0x06009250, preset: 20 },
    backdrop: planetBackdrop(0x0600f1d0, -4500), base: 'katina', far: 30000, eye: [0, 485, -11872], target: [0, 462, -11135] },
  { name: 'Bolse', kind: 'campaign', group: RANGE, level: 17, scene: S.bolse, mode: 'range', zSign: -1, ground: { kind: 'range', dl: 0x0600a810, preset: 29 },
    base: 'bolse', eye: [1, 993, -9670], target: [1, 957, -10018] },
  { name: 'Sector Z', kind: 'campaign', group: RANGE, level: 18, scene: S.sectorZ, mode: 'range', zSign: -1, far: 30000, eye: [-3095, -18, 5], target: [-3417, -61, 0] },
  { name: 'Venom 2', kind: 'campaign', group: RANGE, level: 19, scene: S.venom2, mode: 'range', zSign: -1, ground: { kind: 'range', dl: 0x06010700, preset: 20 },
    backdrop: planetBackdrop(0x0600f670), base: 'venom2', eye: [0, 617, -3463], target: [0, 575, -3923] },
  { name: 'Corneria boss arena', kind: 'campaign', group: RANGE, level: 0, scene: S.corneria, list: 0x0603b074, mode: 'range', zSign: 1, scene360: 'corneria',
    ground: { kind: 'range', dl: 0x0601eaa0, preset: 20 }, backdrop: planetBackdrop(0x060059f0, -2000, 0.6), clear: 0x0845 },
  // Andross_LoadLevelObjects: z = -zPos1; Andross_Ve2LoadLevelObjects (the path to the real Andross): z = -zPos1 + zPos2.
  { name: 'Venom Andross (Venom 1 route)', kind: 'campaign', group: RANGE, level: 9, scene: S.andross, mode: 'range', zSign: -1, scene360: 'andross',
    eye: [0, 322, 400], target: [0, 290, -1] },
  { name: 'Venom Andross (Venom 2 route)', kind: 'campaign', group: RANGE, level: 9, scene: S.andross, list: 0x0c0356cc, mode: 'range', zSign: -1, zPos2: true,
    scene360: 'andross', backdrop: planetBackdrop(0x0600f670) },

  { name: 'Meteo warp zone', kind: 'campaign', group: 'Warp zones', level: 1, scene: S.meteo, list: 0x0602b148, mode: 'rails', warp: true },
  { name: 'Sector X warp zone', kind: 'campaign', group: 'Warp zones', level: 2, scene: S.sectorX, list: 0x0602f18c, mode: 'rails', warp: true },
  { name: 'Andross escape 1', kind: 'campaign', group: 'Venom escape', level: 9, scene: S.andross, list: 0x0c036310, mode: 'rails', clear: 0x4081 },
  { name: 'Andross escape 2', kind: 'campaign', group: 'Venom escape', level: 9, scene: S.andross, list: 0x0c036b6c, mode: 'rails', clear: 0x4081 },
  { name: 'Andross escape 3', kind: 'campaign', group: 'Venom escape', level: 9, scene: S.andross, list: 0x0c03733c, mode: 'rails', clear: 0x4081 },

  { name: 'Corneria', kind: 'battle', group: 'Versus', level: 20, scene: S.versus, list: 0x0302de3c, env: 0x0302dd70, mode: 'range', zSign: 1,
    ground: { kind: 'range', dl: 0x03018800, preset: 20 }, backdrop: planetBackdrop(0x0302d4d0), clear: 0x8fbd, eye: [-7890, 438, -7890], target: [-8215, 394, -8215] },
  { name: 'Katina', kind: 'battle', group: 'Versus', level: 20, scene: S.versus, list: 0x0302e0e4, env: 0x0302ddb4, mode: 'range', zSign: 1,
    ground: { kind: 'range', dl: 0x030160a0, preset: 20 }, backdrop: planetBackdrop(0x030146b0), clear: 0xada7 },
  { name: 'Sector Z', kind: 'battle', group: 'Versus', level: 20, scene: S.versus + 1, list: 0x0302e170, env: 0x0302ddf8, mode: 'range', zSign: 1, clear: 0x0001 },
  { name: 'Sector Z (time match)', kind: 'battle', group: 'Versus', level: 20, scene: S.versus + 1, list: 0x0302e378, env: 0x0302ddf8, mode: 'range', zSign: 1, clear: 0x0001 },

  { name: 'Training', kind: 'other', group: 'Training', level: 10, scene: S.training, mode: 'rails', ground: { kind: 'rails', dl: A.aTrGroundDL, preset: 29 },
    eye: [0, 322, 400], target: [0, 290, -1] },
  { name: 'Training (all-range)', kind: 'other', group: 'Training', level: 10, scene: S.training, list: 0x06008ef8, mode: 'range', zSign: -1, randomY: true },
  { name: 'Level 4 (unused stub)', kind: 'other', group: 'Unused', level: 4, scene: S.unk4, mode: 'rails', eye: [0, 322, 400], target: [0, 290, -1] },
  { name: 'Venom 1 beta layout', kind: 'other', group: 'Unused', level: 6, scene: S.venom1, list: 0x06010088, mode: 'rails', ground: VE1_GROUND,
    backdrop: planetBackdrop(0x060046f0, -2000, 0.6) },
];

// Corneria's ground surface per path progress on the main route (event command SET_SURFACE): 0 grass, 1 rock, 2 water.
const CORNERIA_SURFACES: [number, number][] = [[0, 2], [41181.4, 0], [141510.3, 2], [163464.2, 0]];

const rgba5551 = (c: number): [number, number, number] => [((c >> 11) & 31) * 8, ((c >> 6) & 31) * 8, ((c >> 1) & 31) * 8];

// Rand_SetSeed / Rand_ZeroOneSeeded: a Wichmann-Hill generator in f32.
function seededRandom(a: number, b: number, c: number) {
  return () => {
    a = (a * 171) % 30269; b = (b * 172) % 30307; c = (c * 170) % 30323;
    return Math.abs(Math.fround(Math.fround(Math.fround(a / 30269) + Math.fround(b / 30307)) + Math.fround(c / 30323)) % 1);
  };
}

// Space levels (and Training): the backdrop sprite Background_DrawBackdrop places in view space at T(x, y, -290) S(scale)
// for the level's start view, where 1 unit is 1 pixel of the 320 x 240 screen, and gStarCount.
interface SpaceBackdrop { stars: number; dl: number; scale: number; x?: number; y?: number; preset?: number; alpha?: number; rotX?: boolean }
const SPACE_BACKDROPS: Record<number, SpaceBackdrop> = {
  1: { stars: 600, dl: 0x0600ddf0, scale: 0.4, y: -130 }, // Meteo: shown from path progress 185668
  2: { stars: 600, dl: 0x06029890, scale: 3, x: 60, y: 40, preset: 62, alpha: 192 },
  3: { stars: 300, dl: 0x0601bb40, scale: 0.375 }, // Area 6: grows to 2.625 along the level
  4: { stars: 600, dl: 0x0601bb40, scale: 0.375 },
  5: { stars: 600, dl: 0x06001840, scale: 0.4, x: -60, preset: 62, alpha: 192 },
  10: { stars: 800, dl: 0x06003760, scale: 0.2, x: -30, y: 40, preset: 62, alpha: 255 },
  17: { stars: 300, dl: 0x0600d190, scale: 1, y: 100 },
  18: { stars: 600, dl: 0x06002f80, scale: 0.5, rotX: true },
};
const WARP_BACKDROP: SpaceBackdrop = { stars: 600, dl: 0x07001540, scale: 1.7, preset: 62, alpha: 192 };

// Background_DrawStarfield: 1 x 1 pixel stars at seeded offsets in a 480 x 360 pattern that scrolls 305.6 pixels per
// radian of camera yaw and pitch (Camera_SetStarfieldPos), so it repeats every 90 degrees of yaw and 67.5 of pitch.
// As a sky: one star quad per repeat, at the direction its pixel has at the start view.
const STAR_COLORS = [0x108b, 0x108b, 0x1087, 0x1089, 0x39ff, 0x190d, 0x108b, 0x1089, 0x294b, 0x18df, 0x294b, 0x1085, 0x39ff, 0x108b, 0x18cd, 0x108b];
function starfield(count: number): Batch {
  const rand = seededRandom(1, 29000, 9876);
  const PX = 305.58, D = 290, H = 0.6;
  const pos: number[] = [], col: number[] = [];
  for (let i = 0; i < count; i++) {
    let bx = rand() * 480 - 80 + 120, by = rand() * 360 - 60 + 120;
    if (bx >= 400) bx -= 480;
    if (by >= 300) by -= 360;
    const c = rgba5551(STAR_COLORS[i % 16]);
    for (let k = 0; k < 4; k++) {
      for (let j = -1; j <= 1; j++) {
        const th = (bx - 160) / PX + (k * Math.PI) / 2, ph = (120 - by + j * 360) / PX;
        if (Math.abs(ph) > 1.45) continue;
        const ct = Math.cos(th), st = Math.sin(th), cp = Math.cos(ph), sp = Math.sin(ph);
        const ctr = [D * cp * st, D * sp, -D * cp * ct], t1 = [ct, 0, st], t2 = [-sp * st, cp, sp * ct];
        const v = (a: number, b: number) => [0, 1, 2].map((q) => ctr[q] + H * (a * t1[q] + b * t2[q]));
        for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) { pos.push(...v(a, b)); col.push(c[0], c[1], c[2], 255); }
      }
    }
  }
  const n = pos.length / 3;
  return { texture: -1, blend: 'opaque', depthTest: false, depthWrite: false, cullBack: false, positions: new Float32Array(pos), uvs: new Float32Array(n * 2), colors: new Uint8Array(col) };
}

function loadLevel(files: Sf64Files, def: LevelDef, levelInfo: LevelInfo): Level {
  const L = files.layout;
  const space = new Space(files, files.scene(def.scene), 0x100000);
  const dv = space.dv;
  const P = (n: number): W => G_DL(L.rcpSetupDLs + n * 72);

  // Environment record (0x44): type, ground, bg colour, BGM, fog RGB, fog near/far, light angles, light, ambient.
  const envAt = space.resolve(def.env ?? files.u32(L.envTable + def.level * 4));
  if (envAt < 0) throw new Error(`${def.name}: no environment record`);
  const i32 = (k: number) => dv.getInt32(envAt + k);
  const space_ = i32(0) === 1;
  let fogColor: [number, number, number] = [i32(12), i32(16), i32(20)];
  let light: [number, number, number] = [i32(44), i32(48), i32(52)], ambient: [number, number, number] = [i32(56), i32(60), i32(64)];
  if (def.warp) { fogColor = [178, 190, 90]; light = [200, 200, 120]; ambient = [0, 50, 100]; }
  // Aquas after its intro: level code forces the light yaw to 90 and dims the colours (values read in RAM).
  const aquas = def.level === 13;
  if (aquas) { light = [30, 70, 90]; ambient = [15, 22, 37]; }

  // Zoness' sea texture is written every frame by HUD_Texture_Wave from a source texture: start from the source.
  if (def.level === 8 && space.has(0x0602c2cc) && space.has(0x0600d990)) space.buf.copyWithin(space.resolve(0x0600d990), space.resolve(0x0602c2cc), space.resolve(0x0602c2cc) + 32 * 32 * 2);
  const objs = readList(space, def.list ?? files.u32(L.levelObjectInits + def.level * 4));
  const rails = def.mode === 'rails';
  const zOf = (o: ObjectInit) => (rails ? -o.zPos1 - 3000 + o.zPos2 : (def.zSign ?? 1) * o.zPos1 + (def.zPos2 ? o.zPos2 : 0));
  const length = objs.reduce((m, o) => Math.max(m, -zOf(o)), 0);

  const eye = def.eye ?? (rails ? [0, 322, 400] : [0, 3000, 12000]);
  const target = def.target ?? (rails ? [0, 290, -1] : [0, 0, 0]);

  // Light: RX(x) RY(y) RZ(z) applied to (0, 0, 1). Camera_SetupLights rotates it by the camera every frame, which
  // the RSP's modelview transform undoes, so it is fixed in world space.
  const lm = ident();
  rotX(lm, dv.getFloat32(envAt + 32) * DTOR); rotY(lm, (aquas ? 90 : dv.getFloat32(envAt + 36)) * DTOR); rotZ(lm, dv.getFloat32(envAt + 40) * DTOR);
  const ld = [lm[8], lm[9], lm[10]];
  const ll = Math.hypot(...ld) || 1;
  // Lights_SetOneLight fills light slots 0-3 with this light (4-6 black), so it counts four times.
  const lighting: DlLighting = { lights: Array.from({ length: 4 }, () => ({ color: light, dir: [ld[0] / ll, ld[1] / ll, ld[2] / ll] as [number, number, number] })), ambient };

  const textures: Texture[] = [];
  const textureKeys = new Map<string, number>();
  const meshes: Mesh[] = [];
  const meshKeys = new Map<string, number>();
  const instances: Instance[] = [];
  const layers: LevelLayer[] = [];
  const markers: Marker[] = [];

  const run = (words: W[], m: M | null, lit = true): Batch[] => {
    const at = space.emit([...words, G_ENDDL]);
    try {
      return runDisplayList({
        buf: space.buf, ucode: 'f3dex', resolve: space.resolve, textures, textureKeys, keyPrefix: '', vertexScale: 1, mirrorX: false,
        geometryMode: 0, combiner: true, decals: true, ...(m ? { matrix: m } : {}), ...(lit ? { lighting } : {}),
      }, at);
    } catch {
      return [];
    } finally {
      space.scratch = at;
    }
  };

  // A mesh from parts (object-local matrices), shared by instances with the same parts; key null = never shared.
  const meshOf = (name: string, parts: Part[], meshInfo: DebugInfo, key: string | null = '', ground = false): number => {
    const k = key === null ? null : key || parts.map((p) => `${p.words.map((w) => `${w[0].toString(16)}.${w[1].toString(16)}`).join(',')}@${p.m.map((v) => +v.toFixed(4)).join(',')}`).join('|');
    if (k !== null && meshKeys.has(k)) return meshKeys.get(k)!;
    let batches = parts.flatMap((p) => run(p.words, p.m));
    // Grounds lie below everything at y -3; the game draws them first without depth, the viewer with depth.
    if (ground) batches = batches.map((b) => (b.blend === 'blend' ? b : { ...b, depthTest: true, depthWrite: true }));
    const index = batches.length ? meshes.push({ ...meshFromBatches(name, batches), info: meshInfo }) - 1 : -1;
    if (k !== null) meshKeys.set(k, index);
    return index;
  };

  const layerIndex = new Map<string, number>();
  const layer = (name: string, kind: LevelLayer['kind'], visibleByDefault = true) => {
    let i = layerIndex.get(name);
    if (i === undefined) {
      i = layers.push({ name, kind, instances: [], ...(visibleByDefault ? {} : { visibleByDefault: false }) }) - 1;
      layerIndex.set(name, i);
    }
    return layers[i];
  };
  const place = (layerName: string, kind: LevelLayer['kind'], mesh: number, name: string, pos: number[], instInfo: DebugInfo, animated = false) => {
    if (mesh < 0) return false;
    const index = instances.push({ name, mesh, matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, pos[0], pos[1], pos[2], 1]),
      info: instInfo, ...(animated ? { animated: true } : {}) }) - 1;
    layer(layerName, kind).instances.push(index);
    return true;
  };
  const hex = (v: number) => `0x${(v >>> 0).toString(16)}`;

  // ---- grounds ----
  const groundLayer = 'ground';
  const railsStrip = (dlWords: W[], name: string, stepInfo: DebugInfo, from: number, to: number, surfaceAt?: (z: number) => W[] | null) => {
    for (let z = from; z > to; z -= 6000) {
      const words = surfaceAt ? surfaceAt(z) : dlWords;
      if (!words) continue;
      const m = ident();
      scale(m, 1, 1, 0.5);
      place(groundLayer, 'background', meshOf(name, [{ words, m }], stepInfo, '', true), name, [0, -3, z - 3000], { ground: name });
    }
  };
  const g = def.ground;
  if (g?.kind === 'corneria') {
    const tiles: [number, number, string][] = [[0x0601b6c0, 20, 'grass'], [0x06028260, 20, 'rock'], [0x06028a60, 45, 'water']];
    railsStrip([], 'ground', {}, 2000, -length - 12000, (z) => {
      const progress = 3000 - z;
      let surface = 0;
      for (const [p0, s] of CORNERIA_SURFACES) if (progress >= p0) surface = s;
      const [tex, preset] = tiles[surface];
      return [P(preset), ...(surface === 2 ? [prim(255, 255, 255, 128)] : []), ...tileTexture(tex, 32, 32, 0, 0, 0), G_DL(0x0601b640)];
    });
  } else if (g?.kind === 'rails') {
    railsStrip([P(g.preset), ...(g.tex ? tileTexture(g.tex, 32, 32, 0, 0, 0) : []), G_DL(g.dl)], 'ground', { list: hex(g.dl) }, 2000, -length - 12000);
  } else if (g?.kind === 'aquas') {
    railsStrip([P(20), ...tileTexture(0x0600ab68, 32, 32, 0, 0, 0), G_DL(0x0600ab10)], 'sea floor', { list: '0x600ab10' }, 2000, -length - 12000);
    // Water surface at y 1600: Scale(2, 1, 0.5), translucent (preset 37, prim alpha 128).
    for (let z = 2000; z > -length - 12000; z -= 6000) {
      const m = ident();
      scale(m, 2, 1, 0.5);
      const words = [P(37), prim(255, 255, 255, 128), ...tileTexture(0x0602acc0, 32, 32, 0, 0, 0), G_DL(0x0602ac40)];
      place('water surface', 'foreground', meshOf('water surface', [{ words, m }], { list: '0x602ac40' }), 'water surface', [0, 1600, z - 3000], { ground: 'water surface' });
    }
  } else if (g?.kind === 'range') {
    // The game draws 4 tiles around the camera, recentred in 12000 steps; the viewer lays out a fixed 6 x 6 field.
    for (let i = -3; i < 3; i++) for (let j = -3; j < 3; j++) {
      place(groundLayer, 'background', meshOf('ground', [{ words: [P(g.preset), G_DL(g.dl)], m: ident() }], { list: hex(g.dl) }, '', true), 'ground',
        [12000 * i + 6000, -3, 12000 * j + 6000], { ground: hex(g.dl) });
    }
  } else if (g?.kind === 'wave') {
    // Play_InitLevel widens the 17 x 17 grids: x +-800 -> +-1400 and z -800 -> -1400; drawn T(0, -3, zOff) S(3, 2, 3).
    for (const v of g.vtx) {
      const o = space.resolve(v);
      for (let i = 0; o >= 0 && i < 17 * 17; i++) {
        const p = o + 16 * i, x = dv.getInt16(p), z = dv.getInt16(p + 4);
        if (x === 800 || x === -800) dv.setInt16(p, x < 0 ? -1400 : 1400);
        if (z === -800) dv.setInt16(p + 4, -1400);
      }
    }
    for (let z = 4200 + g.zOff; z > -length - 8400; z -= 7200) {
      const m = ident();
      scale(m, 3, 2, 3);
      place(groundLayer, 'background', meshOf('surface', [{ words: [P(29), G_DL(g.dl)], m }], { list: hex(g.dl) }, '', true), 'surface', [0, -3, z], { ground: hex(g.dl) });
    }
  } else if (g?.kind === 'titania') {
    const { rows, flat } = simulateTitania(objs, length);
    const tex = tileTexture(0x06001ba8, 32, 32, 1, 1, 0);
    const writeVtx = (at: number, x: number, y: number, z: number, s: number, t: number, n: number[]) => {
      const o = space.resolve(at);
      dv.setInt16(o, Math.round(x)); dv.setInt16(o + 2, Math.round(y)); dv.setInt16(o + 4, Math.round(z)); dv.setInt16(o + 6, 0);
      dv.setInt16(o + 8, s); dv.setInt16(o + 10, t);
      n.forEach((c, k) => dv.setInt8(o + 12 + k, c));
      dv.setUint8(o + 15, 255);
    };
    const vtxCmd = (n: number, addr: number): W => [(0x04 << 24) | ((n << 10) + 16 * n - 1), addr];
    const tri = (a: number, b: number, c: number): W => [0xbf000000, (a * 2 << 16) | (b * 2 << 8) | (c * 2)];
    for (let k = 1; k < rows.length; k++) {
      const far = rows[k], near = rows[k - 1];
      if (far.P - near.P !== TI_ROW) continue; // terrain was off in between
      const vtx = space.alloc(32 * 16);
      const hAt = (row: number[], j: number) => row[Math.max(0, Math.min(15, j))];
      for (let j = 0; j < 16; j++) {
        for (const [e, row, z] of [[0, far.h, -220], [1, near.h, 0]] as [number, number[], number][]) {
          const dhdx = (hAt(row, j + 1) - hAt(row, j - 1)) / (tiColumnX(Math.min(15, j + 1)) - tiColumnX(Math.max(0, j - 1)));
          const n = [-dhdx, 1, -(near.h[j] - far.h[j]) / 220];
          const nl = Math.hypot(...n);
          writeVtx(vtx + (j * 2 + e) * 16, tiColumnX(j), row[j], z, (j % 2) * 0x400, e * 0x400, n.map((q) => Math.round((q / nl) * 127)));
        }
      }
      const words: W[] = [P(29), ...tex, vtxCmd(32, vtx)];
      for (let i = 0; i < 15; i++) words.push(tri(2 * i, 2 * i + 1, 2 * i + 3), tri(2 * i, 2 * i + 3, 2 * i + 2));
      // The row built at path progress P lies at world z = -P - 5520 (grid origin z 200, 26 rows drawn behind it).
      place(groundLayer, 'background', meshOf('terrain', [{ words, m: ident() }], { progress: near.P }, null, true), 'terrain', [0, 0, -near.P - 5520], { progress: near.P });
    }
    const flatVtx = space.alloc(4 * 16);
    [[-3410, -5720, 0, 0], [-3410, 0, 0, 26624], [3410, 0, -32768, 26624], [3410, -5720, -32768, 0]]
      .forEach(([x, z, s, t], i) => writeVtx(flatVtx + i * 16, x, 0, z, s, t, [0, 127, 0]));
    const flatWords: W[] = [P(29), ...tileTexture(0x06001ba8, 32, 32, 1, 0, 0), vtxCmd(4, flatVtx), tri(0, 1, 2), tri(0, 2, 3)];
    const flatMesh = meshOf('flat plane', [{ words: flatWords, m: ident() }], {}, 'titania flat', true);
    for (const [a, b] of flat) for (let p = a; p <= b + 5720; p += 5720) place(groundLayer, 'background', flatMesh, 'flat plane', [0, 0, -p + 200], { progress: p });
  }

  // ---- fixed bases created by level code ----
  const baseParts: Part[] = def.base === 'fortuna' ? [{ words: [P(29), G_DL(A.aFoBaseDL2), P(34), setGeom(CULL_BACK), POINT_FILTER, prim(255, 255, 255, 255), G_DL(A.aFoBaseDL1)], m: ident() }]
    : def.base === 'katina' ? [{ words: [P(29), G_DL(A.aKaFLBaseDL)], m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 20, 0, 1] }]
      : def.base === 'bolse' ? [{ words: [P(29), G_DL(0x06002020)], m: ident() }]
        : def.base === 'venom2' ? skeleton(space, A.aVe2BaseSkel, A.aVe2BaseAnim, 0, 3, ident(), (_l, dl) => [P(29), G_DL(dl)]) : [];
  if (baseParts.length) place('scenery', 'main', meshOf('base', baseParts, { base: def.base! }), `${def.base} base`, [0, 0, 0], { base: def.base! });

  // ---- placed objects ----
  const skel = (skelAddr: number, anim: number, frame: number, mode: number, m: M, pre: W[], hide: number[] = []) =>
    skeleton(space, skelAddr, anim, frame, mode, m, (limb, dl) => (hide.includes(limb) ? null : [...pre, G_DL(dl)]));
  const info = (id: number) => {
    const a = L.objectInfo + id * 0x24;
    return { dl: files.u32(a), drawType: files.u8(a + 4) };
  };

  // Scenery (0-160) and sprites (161-175): Scenery_Draw / Sprite_Draw / Scenery360_Draw recipes keyed by object id.
  const sceneryParts = (o: ObjectInit): Part[] | null => {
    const id = o.id, oi = info(id);
    if (id >= 161) { // sprites: preset 60 (CO_RUIN1/2 57)
      return oi.drawType === 0 && oi.dl ? [{ words: [P(id === 165 || id === 166 ? 57 : 60), G_DL(oi.dl)], m: rotYXZ(o.rx, o.ry, o.rz) }] : null;
    }
    if (!rails) { // all-range: T(pos) RY
      const m = rotYXZ(0, o.ry, 0);
      if (id === 131) { rotX(m, o.rx * DTOR); rotZ(m, o.rz * DTOR); rotY(m, Math.PI / 2); translate(m, -551, 0, 0); return [{ words: [P(29), clearGeom(CULL_BACK), G_DL(0x06007650)], m }]; }
      if (id === 1 && def.scene360 === 'corneria') return [{ words: [P(29), G_DL(0x06020760)], m }];
      return oi.drawType === 0 && oi.dl ? [{ words: [P(29), G_DL(oi.dl)], m }] : null;
    }
    const m = rotYXZ(o.rx, o.ry, o.rz);
    const one = (...words: W[]): Part[] => [{ words, m }];
    if (oi.drawType === 0) {
      if (!oi.dl) return null;
      if ([9, 19, 50, 55].includes(id)) return one(P(57), clearGeom(CULL_BACK), G_DL(oi.dl)); // highway 4, tower, VE1 wall 3, rock wall
      if (id === 8) return one(P(60), G_DL(oi.dl)); // CO_HIGHWAY_3
      return one(P(29), G_DL(oi.dl));
    }
    switch (id) {
      case 18: return one(P(29), clearGeom(CULL_BACK), G_DL(0x060199d0));
      case 29: return one(P(29), G_DL(0x07007350));
      case 30: case 31: case 32: case 33: case 34: case 35: case 36: case 37: case 38: {
        const s = [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6][id - 30];
        scale(m, s, s, s);
        return one(P(29), G_DL(0x0700bb10));
      }
      case 39: return one(P(29), G_DL(A.aMeMeteoTunnelDL));
      case 40: translate(m, 0, 0, -95); return one(P(29), G_DL(A.aCoBuilding9DL));
      case 41: return one(P(29), G_DL(A.aCoBuilding10DL));
      case 42: return one(P(29), G_DL(A.aCoIBeamDL));
      case 48: rotY(m, Math.PI); return one(P(57), G_DL(A.aVe1Wall1DL));
      case 49: rotY(m, Math.PI); return one(P(57), G_DL(A.aVe1Wall2DL));
      case 56: return skel(A.aCoDoorsSkel, A.aCoDoorsAnim, 0, 3, m, [P(29)]);
      case 57: return one(P(29), G_DL(0x07002270));
      case 61: return one(P(57), clearGeom(CULL_BACK), G_DL(A.aMaTowerBottomDL), G_DL(A.aMaTowerTopDL));
      case 65: return one(P(29), G_DL(A.aMaProximityLightSidesDL), P(29), G_DL(A.aMaProximityLightTopDL));
      case 77: return one(P(57), G_DL(A.aMaIndicatorSignDL));
      case 78: case 79: case 80: case 81: case 82: return one(P(57), G_DL(MA_DISTANCE_SIGNS[id - 78]));
      case 83: return skel(A.aMaTrainStopBlockSkel, A.aMaTrainStopBlockAnim, 0, 1, m, [P(29), clearGeom(CULL_BACK)]);
      case 84: case 85: case 86: case 87: case 88: case 89: case 90: case 91: return one(P(57), G_DL(MA_RAILROAD_SWITCHES[id - 84]));
      case 92: return one(P(57), G_DL(0x060014a0));
      case 93: return one(P(57), G_DL(0x06001180));
      case 94: case 97: return one(P(57), G_DL(0x06026860));
      case 95: case 98: return one(P(57), G_DL(0x0602fbf0));
      case 96: case 99: return one(P(57), G_DL(0x06022610));
      case 100: case 102: return one(P(57), G_DL(0x060309d0));
      case 101: case 103: return one(P(57), G_DL(0x06030750));
      case 104: {
        const parts = skel(A.aMaSwitchTrackSkel, A.aMaSwitchTrackAnim, 0, 1, m.slice(), [P(57)]);
        rotY(m, -Math.PI / 18);
        translate(m, 0, 0, -1800);
        return [...parts, { words: [P(57), G_DL(0x0601c170)], m }];
      }
      case 105: return one(P(29), G_DL(0x0602d380));
      case 111: return one(P(60), G_DL(A.aSyDebrisDL));
      case 126: scale(m, 0.5, 0.5, 0.5); return one(P(29), G_DL(A.aAqBump2DL));
      case 131: return skel(A.aVe2AndrossGateSkel, A.aVe2AndrossGateAnim, 0, 1, m, [P(29)], Array.from({ length: 20 }, (_, i) => i).filter((i) => i !== 12));
      case 132: return skel(A.aVe2AndrossGateSkel, A.aVe2AndrossGateAnim, 0, 1, m, [P(29)], [13]);
      default: return null;
    }
  };

  // Actors (176-291) that are static props: draw-function recipes, else a plain list.
  const actorParts = (o: ObjectInit): Part[] | null => {
    const name = OBJECT_NAMES[o.id], m = rotYXZ(o.rx, o.ry, o.rz), base = [P(29)];
    switch (name) {
      case 'ACTOR_AQ_CORAL': return skel(A.aAqCoralSkel, A.aAqCoralAnim, 0, 3, m, base);
      case 'ACTOR_AQ_SEAWEED': return skel(A.aAqSeaweedSkel, A.aAqSeaweedAnim1, 0, 1, m, [P(29), clearGeom(CULL_BACK)]);
      case 'ACTOR_AQ_BOULDER': return [{ words: [P(29), G_DL(A.aAqBoulderDL)], m }];
      case 'ACTOR_AQ_STONE_COLUMN': {
        // Update state 0: rot.y != 0 selects the intact column list, else the skeleton; rot.y and z are then cleared.
        const mc = rotYXZ(o.rx, 0, 0);
        return o.ry !== 0 ? [{ words: [P(55), G_DL(A.aAqStoneColumnDL)], m: mc }] : skel(A.aAqStoneColumnSkel, A.aAqStoneColumnAnim, 0, 3, mc, [P(55)]);
      }
      case 'ACTOR_AQ_OYSTER': scale(m, 3, 3, 3); return skel(A.aAqOysterSkel, A.aAqOysterAnim, 0, 1, m, [P(56), prim(255, 143, 143, 255)]);
      case 'ACTOR_SO_ROCK_1': return [{ words: [P(29), G_DL(0x06017370)], m }];
      case 'ACTOR_SO_ROCK_2': return [{ words: [P(29), G_DL(0x06017090)], m }];
      case 'ACTOR_SO_ROCK_3': return [{ words: [P(29), G_DL(0x06016cf0)], m }];
      case 'ACTOR_ZO_RADARBUOY': return [{ words: [P(29), G_DL(0x06002e10)], m }];
      case 'ACTOR_ZO_CONTAINER': return skel(0x0601863c, 0x06018550, 0, 3, m, base);
      case 'ACTOR_ZO_BARRIER': return skel(0x0601fc90, 0x0601fbc4, 0, 1, m, base);
      case 'ACTOR_VE1_PILLAR_2': scale(m, 1, 0.5, 1); return [{ words: [P(29), G_DL(0x0901da50)], m }];
      case 'ACTOR_MA_BARRIER': return [{ words: [P(57), G_DL(0x060257b0)], m }];
      case 'ACTOR_MA_VERTICAL_LOCK_BAR': return [{ words: [P(29), G_DL(0x06025850)], m }];
      case 'ACTOR_MA_HORIZONTAL_LOCK_BAR': return [{ words: [P(29), G_DL(0x060251a0)], m }];
      case 'ACTOR_MA_RAILROAD_SWITCH': {
        const lever = m.slice();
        translate(lever, 0, 204, 0);
        return [...skel(0x0602ffa0, 0x0602feb4, 0, 1, m, base), { words: [P(29), G_DL(0x0602ffc0)], m: lever }];
      }
      case 'ACTOR_SZ_SPACE_JUNK': return [{ words: [P(29), G_DL(0x06001a10), clearGeom(CULL_BACK), P(57), G_DL(0x060045e0)], m }];
      case 'ACTOR_ME_LASER_CANNON_1': return [{ words: [P(29), G_DL(0x06022920)], m }];
      case 'ACTOR_AND_LASER_EMITTER': return [{ words: [P(29), G_DL(0x06007e20)], m }];
      case 'ACTOR_FO_RADAR': return skel(0x06007980, 0x06007854, 0, 3, m, base);
      default: {
        const oi = info(o.id);
        return oi.drawType === 0 && oi.dl ? [{ words: [P(29), G_DL(oi.dl)], m }] : null;
      }
    }
  };

  // Event actors: T(pos) RZ(orient.z) RY RX RZ(rot.z) with the actor type's model (sEventActorInfo).
  const scriptTable = def.level === 6 ? L.ve1ScriptTable : EVENT_SCRIPTS[def.level] ?? EVENT_SCRIPTS[0];
  const eventParts = (o: ObjectInit): { parts: Part[] | null; type: number; moves: boolean } => {
    const { type, moves } = eventModel(space, scriptTable, o.id - 1000);
    if (type < 0 || type >= 108) return { parts: null, type, moves };
    const name = EVENT_NAMES[type] ?? '';
    const ei = L.eventActorInfo + type * 0x20;
    const dl = files.u32(ei), unk16 = files.u8(ei + 0x14), unk19 = files.u8(ei + 0x17);
    if (name === 'EVENT_HANDLER') return { parts: null, type, moves };
    const umbra = name === 'A6_UMBRA_STATION';
    const rotZv = unk16 === 0 ? o.rz : 0, orientZ = unk16 === 0 && !umbra ? 0 : o.rz;
    const m = ident();
    if (unk19 !== 0 || umbra) { rotY(m, o.ry * DTOR); rotX(m, o.rx * DTOR); rotZ(m, rotZv * DTOR); }
    else { rotZ(m, orientZ * DTOR); rotY(m, o.ry * DTOR); rotX(m, o.rx * DTOR); rotZ(m, rotZv * DTOR); }
    const sk = (s: number, a: number, pre: (limb: number) => W[], frame = 0) => skeleton(space, s, a, frame, 1, m, (limb, d) => [...pre(limb), G_DL(d)]);
    const pre: W[] = ['SX_SPACE_MINE', 'SY_ROBOT_SPRITE_SIDE', 'SY_ROBOT_SPRITE_FRONT'].includes(name) ? [P(60)] : ['MA_LASER_TURRET', 'MA_RAILROAD_CART'].includes(name) ? [P(57)] : [P(29)];
    const words: W[] = [...pre, ...(dl ? [G_DL(dl)] : [])];
    let parts: Part[] | null = [{ words, m }];
    if (name.startsWith('WZ_')) parts = [{ words: [P(34), POINT_FILTER, prim(255, 255, 255, 255), G_DL(dl)], m }];
    else switch (name) {
      case 'TEAMMATE': words.push(G_DL(space_ ? 0x04007870 : 0x040018a0)); break;
      case 'SPACE_MINE': words.push(P(60), G_DL(A.aA6SpaceMineDL)); break;
      case 'A6_NINJIN_MISSILE': words.push(clearGeom(CULL_BACK), G_DL(A.aA6NinjinMissileDL)); break;
      case 'A6_ROCKET': words.push(clearGeom(CULL_BACK), G_DL(A.aA6RocketDL)); break;
      case 'SX_LASER': words.push(G_DL(A.aSxLaserDL)); break;
      case 'A6_UMBRA_STATION': rotX(m, Math.PI / 2); words.push(G_DL(A.aA6UmbraStationDL)); break;
      case 'ME_ROCK_GULL': rotX(m, o.rx * DTOR); rotY(m, o.ry * DTOR); words.push(G_DL(A.aMeRockGull1DL), G_DL(A.aMeRockGull2DL), G_DL(A.aMeRockGull3DL)); break;
      case 'ME_FLIP_BOT': words.push(G_DL(A.aMeFlipBot1DL), P(53), G_DL(A.aMeFlipBot2DL)); break;
      case 'VE1_PILLAR': scale(m, 0.6, 0.6, 0.6); words.push(G_DL(A.aVe1PillarDL)); break;
      case 'MA_LASER_TURRET': words.push(clearGeom(CULL_BACK), G_DL(A.aMaLaserTurretDL)); break;
      case 'AQ_STARFISH': parts = [{ words: [P(22), prim(255, 255, 255, 255), G_DL(A.aAqStarfishDL)], m }]; break;
      case 'AQ_SHELL': parts = [{ words: [P(21), G_DL(A.aAqShellDL)], m }]; break;
      case 'BILL': words.push(G_DL(A.aBillShipDL)); break;
      case 'KATT': words.push(G_DL(A.aKattShipDL)); break;
      case 'TI_GREAT_FOX': words.push(G_DL(A.aGreatFoxIntactDL)); break;
      case 'CRUISER_GUN': rotY(m, Math.PI); scale(m, 1.5, 1.5, 1.5); parts = sk(A.aCruiserGunSkel, A.aCruiserGunAnim, () => [P(29)]); break;
      case 'SX_WARP_GATE': parts = sk(A.aSxWarpGateSkel, A.aSxWarpGateAnim, (limb) => (limb === 4 ? [P(34), prim(255, 255, 255, 255)] : [P(29)])); break;
      case 'TRIPOD': translate(m, 0, -30, 0); parts = sk(A.aTripodSkel, A.aTripodAnim, () => [P(29)]); break;
      case 'FIREBIRD': parts = def.level === 7 ? sk(A.aSoGoreSkel, A.aSoGoreAnim, () => [P(57)]) : sk(A.aFirebirdSkel, A.aFirebirdAnim, () => [P(29)]); break;
      case 'KILLER_BEE': parts = sk(A.aKillerBeeSkel, A.aKillerBeeAnim, () => [P(29)]); break;
      case 'TI_BOMBER': parts = sk(A.aTiBomberSkel, A.aTiBomberAnim, () => [P(29)]); break;
      case 'AQ_OYSTER': scale(m, 3, 3, 3); parts = sk(A.aAqOysterSkel, A.aAqOysterAnim, () => [P(29)]); break;
      case 'ANDROSS_GATE': case 'ANDROSS_GATE_2': {
        const ao = space.resolve(A.aVe2AndrossGateAnim);
        const last = ao >= 0 ? dv.getInt16(ao) - 1 : 0;
        parts = sk(A.aVe2AndrossGateSkel, A.aVe2AndrossGateAnim, () => [P(29)], name === 'ANDROSS_GATE' ? 0 : last);
        break;
      }
      default: if (!dl) parts = null;
    }
    return { parts, type, moves };
  };

  // Training all-range: Rand_SetSeed(1, 29000, 9876), then y = yPos - RAND_FLOAT_SEEDED(300) per scenery object.
  const randomSeeded = seededRandom(1, 29000, 9876);

  let unhandled = 0;
  for (const o of objs) {
    const id = o.id;
    const name = objectName(id);
    const pos = [o.x, o.y, zOf(o)];
    const instInfo: DebugInfo = { entry: o.index, id, object: name, record: hex(o.at), x: o.x, y: o.y, zPos1: +o.zPos1.toFixed(1), ...(rails ? { zPos2: o.zPos2 } : {}), rot: `${o.rx}, ${o.ry}, ${o.rz}` };
    const marker = (layerName: string, label: string, visible = false) => {
      markers.push({ label, position: [pos[0], pos[1], pos[2]], layer: layerIndex.get(layerName) ?? (layer(layerName, 'markers', visible), layerIndex.get(layerName)!), info: instInfo });
    };
    if (id < 176) {
      if (id === 147) continue; // Versus bookkeeping
      if (!rails && id < 161 && def.randomY) pos[1] = o.y - randomSeeded() * 300;
      const parts = sceneryParts(o);
      if (!parts || !place(id < 161 ? 'scenery' : 'sprites', 'main', meshOf(name, parts, { object: name, list: hex(info(id).dl) }), name, pos, instInfo)) {
        unhandled++;
        marker('objects without geometry', `${id} ${name}`);
      }
    } else if (id < 292) {
      if (id === 224) continue; // Titania terrain records
      const parts = actorParts(o);
      if (!parts || !place('actors', 'objects', meshOf(name, parts, { object: name, list: hex(info(id).dl) }), name, pos, instInfo)) marker('actors without a model', `${id} ${name}`);
    } else if (id >= 1000) {
      if (!rails) continue;
      const ev = eventParts(o);
      const evName = ev.type >= 0 ? EVENT_NAMES[ev.type] ?? `event ${ev.type}` : 'no actor';
      const evInfo = { ...instInfo, event: evName, type: ev.type, moving: ev.moves ? 'yes' : 'no' };
      if (!ev.parts || !place(ev.moves ? 'moving event actors' : 'event actors', 'objects', meshOf(evName, ev.parts, { event: evName, type: ev.type }), evName, pos, evInfo, ev.moves)) {
        if (ev.type >= 0 && evName !== 'EVENT_HANDLER') marker('event actors without a model', `${evName}`);
      }
    } else if (id >= 322 && id < 339) {
      const oi = info(id);
      const parts = oi.drawType === 0 && oi.dl ? [{ words: [P(29), G_DL(oi.dl)], m: rotYXZ(o.rx, o.ry, o.rz) }] : null;
      if (!parts || !place('items', 'objects', meshOf(name, parts, { object: name, list: hex(oi.dl) }), name, pos, instInfo)) marker('item markers', `${id} ${name}`);
    } else {
      marker(id < 322 ? 'bosses' : 'effects and markers', `${id} ${name}`);
    }
  }

  // ---- environment ----
  const far = def.far ?? 12800;
  const fog = fogPosition(i32(24), i32(28), fogColor, 10, far);
  const clearColor = rgba5551(def.clear ?? (space_ ? 0 : dv.getUint16(envAt + 8)));

  // Planet backdrop: a 7280 x 8680 quad in view space at T(0, yOff + yb, z), yb = pitch * z - eye.y * factor, drawn
  // without the look-at. The viewer shows the window of it the start camera sees (fovy 45, 4:3).
  let backdrop: Backdrop | undefined;
  if (def.backdrop) {
    const bd = def.backdrop;
    const batches = run([P(17), G_DL(bd.dl)], null, false);
    const b = batches.find((x) => x.texture >= 0);
    if (b) {
      const pos = b.positions, uv = b.uvs;
      let x0 = 0, x1 = 0, y0 = 0, y1 = 0;
      for (let k = 1; k < pos.length / 3; k++) {
        if (pos[3 * k] < pos[3 * x0]) x0 = k; if (pos[3 * k] > pos[3 * x1]) x1 = k;
        if (pos[3 * k + 1] < pos[3 * y0 + 1]) y0 = k; if (pos[3 * k + 1] > pos[3 * y1 + 1]) y1 = k;
      }
      const lerp = (a: number, b_: number, ua: number, ub: number, v: number) => (b_ === a ? ua : ua + ((ub - ua) * (v - a)) / (b_ - a));
      const pitch = Math.atan2(target[1] - eye[1], Math.hypot(target[0] - eye[0], target[2] - eye[2]));
      const yQuad = bd.yOff + pitch * bd.z - eye[1] * bd.eyeFactor;
      const hh = -bd.z * Math.tan(22.5 * DTOR), hw = (hh * 4) / 3;
      const u = (x: number) => lerp(pos[3 * x0], pos[3 * x1], uv[2 * x0], uv[2 * x1], x / bd.sx);
      const v = (y: number) => lerp(pos[3 * y0 + 1], pos[3 * y1 + 1], uv[2 * y0 + 1], uv[2 * y1 + 1], y - yQuad);
      backdrop = { texture: b.texture, u0: u(-hw), u1: u(hw), v0: v(hh), v1: v(-hh) };
    }
  }

  // Space backdrop and starfield, drawn around the camera.
  const skies: Sky[] = [];
  const spaceBg = def.level === 20 ? undefined : def.warp ? WARP_BACKDROP : SPACE_BACKDROPS[def.level];
  if (spaceBg) {
    const m = ident();
    translate(m, spaceBg.x ?? 0, spaceBg.y ?? 0, -290);
    scale(m, spaceBg.scale, spaceBg.scale, spaceBg.rotX ? spaceBg.scale : 1);
    if (spaceBg.rotX) rotX(m, Math.PI / 2);
    const sprite = run([P(spaceBg.preset ?? 36), prim(255, 255, 255, spaceBg.alpha ?? 255), G_DL(spaceBg.dl)], m, false);
    const batches = [starfield(spaceBg.stars), ...sprite.map((b) => ({ ...b, depthTest: false, depthWrite: false, cullBack: false }))];
    skies.push({ name: 'starfield', mesh: meshes.push({ ...meshFromBatches('starfield', batches), info: { backdrop: hex(spaceBg.dl), stars: spaceBg.stars } }) - 1 });
  }

  const camera: CameraView = { eye: eye as [number, number, number], target: target as [number, number, number], fovY: 45 };
  void unhandled;
  return buildLevel(levelInfo, `sf64-${levelInfo.index}`, textures, meshes, instances, {
    layers, markers, fog, clearColor, camera, ...(backdrop ? { backdrop } : {}), ...(skies.length ? { skies } : {}),
  });
}

export function openStarFox64(rom: Uint8Array): Game {
  const files = new Sf64Files(rom);
  const levels: LevelInfo[] = DEFS.map((d, index) => ({ index, name: d.name, kind: d.kind, group: d.group }));
  const music = sf64Music(rom);
  return {
    id: 'sf64',
    title: files.layout.version === '1.1' ? 'Star Fox 64' : 'Star Fox 64 (V1.0)',
    levels,
    loadLevel: (i) => loadLevel(files, DEFS[i], levels[i]),
    music: music.tracks,
    decodeMusic: (i) => music.decode(i),
  };
}
