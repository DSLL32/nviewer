// BattleTanx: Global Assault (USA): campaign missions, battle arenas and unused levels.
//
// A level is one or two LZARI world files (a base and a campaign, battle or cutscene variant,
// chosen by a switch in code, 0x800E8380). World file: 8 u32 section offsets h[0..7]:
//   h0 u32 group count, h1 16-byte groups, h2 12-byte placements {s16 x, y, z, u16 yaw, u32
//   definition offset}, h3 object definitions (byte 0 = kind), h4 16-byte models {u8 parts,
//   u16 first part, bounds}, h5 4-byte parts (LODs) {u8 refs, u16 first ref}, h6 24-byte pool
//   references {s32 geo offset, size, state offset, size, texture offset (-1 none), size}.
// The pools hold raw F3DEX2 chunks with chunk-relative addresses: textures at 0x102C70, render
// state at 0x2F8070, geometry at 0x3013F0. The game patches state chunks at load (0x800B9B8C) and
// draws with lighting on; vertex colour bytes are normals.
import { type DlLighting, type Mtx, runDisplayList } from './displaylist';
import { lzariDecode } from './lzari';
import { decodeGaMusic, listGaMusic } from './music/libmus';
import type { Game, Instance, Level, LevelInfo, Mesh, Texture } from './types';
import { chaseCamera } from './battletanx';
import { buildLevel, lighting, meshFromBatches, translation } from './bomberman/common';
import { view } from './util';

const POOL_TEX = 0x102c70;
const POOL_STATE = 0x2f8070;
const POOL_GEO = 0x3013f0;

const NAMES = [
  'SF Breakout', 'Truck Stop', 'Texas Slave Fortress', 'Drive In', 'DC Mall', 'White House', 'Houses of Parliament',
  'Tower Bridge', 'Tower of London', 'Bistro', 'Champs Elysee', 'Eiffel Tower', 'Berlin War Zone', 'Brandenburg Gate',
  'Escape from Berlin', 'Assault on SF', 'Alcatraz', 'Lakepark', 'Panhandle', 'Railyard', 'SFO', 'Crossfire',
  'Level 22', 'Level 23', 'Shore Patrol', 'Level 25', 'SF Airport',
];

// World files (ROM start) per level id and variant, from the code switch 0x800E8380.
type Variant = 'campaign' | 'battle' | 'cutscene';
const SF_BREAKOUT = 0x3f9b60;
const FILES: Record<string, number[]> = {
  '0/campaign': [SF_BREAKOUT, 0x3fccb0], '0/battle': [SF_BREAKOUT, 0x3fd8a8], '0/cutscene': [SF_BREAKOUT, 0x3fda70],
  '1/campaign': [0x3fea30, 0x4025a0], '1/battle': [0x3fea30, 0x402b18],
  '2/campaign': [0x403930, 0x405c50], '2/battle': [0x403930, 0x4077e8], '2/cutscene': [0x403930, 0x409020],
  '3/campaign': [0x40a178, 0x40e948], '3/battle': [0x40a178, 0x40faf8],
  '4/campaign': [0x4107f8, 0x415098], '4/battle': [0x4107f8, 0x4162a0], '4/cutscene': [0x4107f8, 0x417228],
  '5/campaign': [0x417670, 0x419a70], '5/battle': [0x417670, 0x41ae90], '5/cutscene': [0x417670, 0x41b960],
  '6/campaign': [0x41ba30, 0x420708], '6/battle': [0x41ba30, 0x4223b0],
  '7/campaign': [0x4232b8, 0x424a78], '7/battle': [0x4232b8, 0x4266f8],
  '8/campaign': [0x426d38, 0x42ad60], '8/battle': [0x426d38, 0x42b858],
  '9/campaign': [0x42c500, 0x430970], '9/battle': [0x42c500, 0x431b58],
  '10/campaign': [0x432758, 0x4362d8], '10/battle': [0x432758, 0x4380d8],
  '11/campaign': [0x4394f8, 0x43de28], '11/battle': [0x4394f8, 0x43f990],
  '12/campaign': [0x440bb0, 0x443f68], '12/battle': [0x440bb0, 0x445900],
  '13/campaign': [0x446530, 0x448db0], '13/battle': [0x446530, 0x449c40],
  '14/campaign': [0x44abb0, 0x44d268], '14/battle': [0x44abb0, 0x44edd0], '14/cutscene': [0x44abb0, 0x44ff18],
  '15/campaign': [0x450320, 0x454aa8], '15/battle': [0x450320, 0x4556c0],
  '16/campaign': [0x456698, 0x459988], '16/battle': [0x456698, 0x45a828],
  '17/battle': [0x45b5e8, 0x45eb00], '18/battle': [0x45f550, 0x462578], '19/battle': [0x463018, 0x465738],
  '20/battle': [0x466630, 0x468950], '21/battle': [0x469348, 0x46a858],
  '22/battle': [0x46b170, 0x46b4f0], '23/battle': [0x46b500, 0x46b550],
  // Shore Patrol re-uses SF Breakout's base.
  '24/campaign': [SF_BREAKOUT, 0x46b6a8],
  '26/campaign': [0x46ce60, 0x46e828], '26/battle': [0x46ce60, 0x46ed20],
};

interface LevelDef { id: number; variant: Variant; kind: LevelInfo['kind']; name: string }

const CAMPAIGN = [26, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 12, 14, 24, 15, 16];
// Deathmatch arena order (USA map, then Europe), plus the two maps only other modes list.
const BATTLE = [20, 15, 16, 18, 1, 2, 3, 5, 4, 8, 6, 9, 11, 10, 17, 21, 13, 12, 14, 19, 0, 7];
const DEFS: LevelDef[] = [
  ...CAMPAIGN.map((id): LevelDef => ({ id, variant: 'campaign', kind: 'campaign', name: NAMES[id] })),
  ...BATTLE.map((id): LevelDef => ({ id, variant: 'battle', kind: 'battle', name: NAMES[id] })),
  ...[0, 2, 4, 5, 14].map((id): LevelDef => ({ id, variant: 'cutscene', kind: 'other', name: `${NAMES[id]} (cutscene)` })),
  { id: 26, variant: 'battle', kind: 'other', name: 'SF Airport (unused battle arena)' },
  // Its world file holds only a wall segment and a post; there is no floor model.
  { id: 22, variant: 'battle', kind: 'other', name: 'Test Maze (level 22, walls only)' },
];

export const GA_LEVELS: LevelInfo[] = DEFS.map((d, index) => ({ index, name: d.name, kind: d.kind }));

// Model fields of object definitions by kind (spawn switch 0x800DFA5C); multi-model kinds
// (destructibles) list their intact state first.
const MODEL_FIELD: Record<number, number> = {
  0: 2, 1: 2, 2: 2, 11: 2, 14: 2, 22: 2, 34: 2, 35: 2, 43: 2, 44: 2, 12: 4, 13: 12,
  3: 2, 4: 2, 5: 2, 10: 2, 15: 2, 21: 2, 24: 2, 26: 6, 28: 2, 29: 2, 31: 2, 32: 2, 36: 2, 40: 2,
};
const INCLUDE = 39;
const FOG_AND_LIGHTS = 37;
const AMBIENT = 38;
const PLAYER_START = 17;

// Load-time patch of texture and state chunks (0x800B9B8C): geometry-mode sets gain G_FOG and
// G_CULL_BACK and lose G_CULL_FRONT, clears can only clear G_CULL_BACK, and 17 whole commands are
// replaced (table 0x80116710 -> 0x80116798).
const STATE_PATCH: number[][] = [
  [0xe3000a01, 0x00000000, 0xe3000a01, 0x00100000], [0xe200001c, 0x00552230, 0xe200001c, 0xc8112078],
  [0xe200001c, 0x00553078, 0xe200001c, 0xc8113078], [0xe200001c, 0x005049d8, 0xe200001c, 0xc8104a50],
  [0xe200001c, 0x00552078, 0xe200001c, 0xc8112078], [0xe200001c, 0x00504a50, 0xe200001c, 0xc81049d8],
  [0xe200001c, 0x0c196230, 0xe200001c, 0xc8112230], [0xe200001c, 0x00504e50, 0xe200001c, 0xc8104e50],
  [0xe200001c, 0x00504240, 0xe200001c, 0xc8104240], [0xfcffffff, 0xfffcf279, 0xfcffffff, 0xfffcf238],
  [0xfc121824, 0xff33ffff, 0xfc127fff, 0xfffff238], [0xfc5096a1, 0x332dfeff, 0xfc5097ff, 0x3ffdfe38],
  [0xfc127e24, 0xfffff3f9, 0xfc127fff, 0xfffff238], [0xfcffffff, 0xfffdf6fb, 0xfcffffff, 0xfffdf638],
  [0xe200001c, 0x0c193078, 0xe200001c, 0xc8112078], [0xfc127e24, 0xfffff9fc, 0xfc127fff, 0xfffff838],
  [0xfc323864, 0xff73ffff, 0xfc3239ff, 0xfffffe38],
];

const G_VTX = 0x01;
const G_DL = 0xde;
const G_ENDDL = 0xdf;
const G_SETTIMG = 0xfd;
const G_GEOMETRYMODE = 0xd9;

interface World {
  data: Uint8Array;
  dv: DataView;
  h: number[];
  models: { parts: number; firstPart: number }[];
  parts: { refs: number; firstRef: number }[];
  refs: { geo: number; geoSize: number; state: number; stateSize: number; tex: number; texSize: number }[];
  placements: { x: number; y: number; z: number; yaw: number; def: number }[];
}

function parseWorld(data: Uint8Array): World {
  const dv = view(data);
  const h = Array.from({ length: 8 }, (_, k) => dv.getUint32(k * 4));
  const count = (k: number, size: number) => Math.max(0, Math.floor((h[k + 1] - h[k]) / size));
  return {
    data, dv, h,
    placements: Array.from({ length: count(2, 12) }, (_, i) => {
      const o = h[2] + i * 12;
      return { x: dv.getInt16(o), y: dv.getInt16(o + 2), z: dv.getInt16(o + 4), yaw: dv.getUint16(o + 6), def: dv.getUint32(o + 8) };
    }),
    models: Array.from({ length: count(4, 16) }, (_, i) => ({ parts: data[h[4] + i * 16], firstPart: dv.getUint16(h[4] + i * 16 + 2) })),
    parts: Array.from({ length: count(5, 4) }, (_, i) => ({ refs: data[h[5] + i * 4], firstRef: dv.getUint16(h[5] + i * 4 + 2) })),
    refs: Array.from({ length: count(6, 24) }, (_, i) => {
      const g = (k: number) => dv.getInt32(h[6] + i * 24 + k * 4);
      return { geo: g(0), geoSize: g(1), state: g(2), stateSize: g(3), tex: g(4), texSize: g(5) };
    }),
  };
}

function patchState(dv: DataView, start: number, len: number) {
  for (let o = start; o + 8 <= start + len; o += 8) {
    let w0 = dv.getUint32(o), w1 = dv.getUint32(o + 4);
    if (w0 >>> 24 === G_ENDDL) break;
    if (w0 >>> 24 === G_GEOMETRYMODE) {
      if (w1 !== 0) w1 = ((w1 | 0x10400) & ~0x200) >>> 0;
      else w0 = (w0 | 0xfffbff) >>> 0;
    }
    for (const [a0, a1, b0, b1] of STATE_PATCH) {
      if (w0 === a0 && w1 === a1) {
        w0 = b0;
        w1 = b1;
        break;
      }
    }
    dv.setUint32(o, w0);
    dv.setUint32(o + 4, w1);
  }
}

// Level memory: every pool chunk the level's models use, once, relocated and patched as the
// game loads it, followed by room for a list that calls a model's chunks.
class LevelMemory {
  private readonly at = new Map<string, number>();
  private readonly chunks: { pool: number; off: number; len: number; at: number; kind: 'tex' | 'state' | 'geo' }[] = [];
  private size = 0;
  private maxRefs = 0;
  buf = new Uint8Array(0);
  scratch = 0;

  add(refs: World['refs']) {
    this.maxRefs = Math.max(this.maxRefs, refs.length);
    for (const r of refs) {
      if (r.tex >= 0 && r.texSize > 0) this.chunk('tex', POOL_TEX, r.tex, r.texSize);
      if (r.stateSize > 0) this.chunk('state', POOL_STATE, r.state, r.stateSize);
      if (r.geoSize > 0) this.chunk('geo', POOL_GEO, r.geo, r.geoSize);
    }
  }

  private chunk(kind: 'tex' | 'state' | 'geo', pool: number, off: number, len: number) {
    const key = `${kind}${off}/${len}`;
    if (this.at.has(key)) return;
    this.at.set(key, this.size);
    this.chunks.push({ pool, off, len, at: this.size, kind });
    this.size += (len + 7) & ~7;
  }

  build(rom: Uint8Array) {
    this.scratch = this.size;
    this.buf = new Uint8Array(this.size + (this.maxRefs * 3 + 1) * 8);
    const dv = view(this.buf);
    const relocate = (at: number, len: number, op: number) => {
      for (let o = at; o + 8 <= at + len; o += 8) {
        const w0 = dv.getUint32(o);
        if (w0 >>> 24 === G_ENDDL) break;
        if (w0 >>> 24 === op) dv.setUint32(o + 4, dv.getUint32(o + 4) + at);
      }
    };
    for (const c of this.chunks) {
      this.buf.set(rom.subarray(c.pool + c.off, Math.min(rom.length, c.pool + c.off + c.len)), c.at);
      if (c.kind === 'tex') relocate(c.at, c.len, G_SETTIMG);
      if (c.kind === 'geo') relocate(c.at, c.len, G_VTX);
      if (c.kind !== 'geo') patchState(dv, c.at, c.len);
    }
  }

  // A list calling texture, state and geometry chunks of each reference in order (render state
  // carries over between references, as the game's draw lists only change it when it differs).
  callList(refs: World['refs']): number {
    const dv = view(this.buf);
    let sp = this.scratch;
    const call = (key: string) => {
      const at = this.at.get(key);
      if (at === undefined) return;
      dv.setUint32(sp, G_DL << 24);
      dv.setUint32(sp + 4, at);
      sp += 8;
    };
    for (const r of refs) {
      if (r.tex >= 0 && r.texSize > 0) call(`tex${r.tex}/${r.texSize}`);
      if (r.stateSize > 0) call(`state${r.state}/${r.stateSize}`);
      if (r.geoSize > 0) call(`geo${r.geo}/${r.geoSize}`);
    }
    dv.setUint32(sp, G_ENDDL << 24);
    return this.scratch;
  }

  // A level-memory address as a ROM offset (chunks are copied in place), for Batch.triSource.
  romOffset(addr: number): number {
    let lo = 0, hi = this.chunks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.chunks[mid].at <= addr) lo = mid;
      else hi = mid - 1;
    }
    const c = this.chunks[lo];
    return c && addr >= c.at && addr < c.at + c.len ? c.pool + c.off + addr - c.at : addr;
  }
}

function loadLevel(rom: Uint8Array, index: number): Level {
  const def = DEFS[index];
  if (!def) throw new Error(`No level ${index}`);
  const files = FILES[`${def.id}/${def.variant}`] ?? [];
  const worlds = files.map((start) => parseWorld(lzariDecode(rom, start)));

  // Fog colour and two lights (kind 37), ambient colour (kind 38).
  let fogColor: [number, number, number] | undefined;
  let light: DlLighting | undefined;
  let ambient: number | undefined;
  for (const w of worlds) {
    for (const p of w.placements) {
      const o = w.h[3] + p.def;
      const d = w.data;
      const rgb = (k: number) => (d[o + k] << 16) | (d[o + k + 1] << 8) | d[o + k + 2];
      const dir = (k: number): [number, number, number] => [0, 1, 2].map((j) => (d[o + k + j] << 24) >> 24) as [number, number, number];
      if (d[o] === FOG_AND_LIGHTS && !fogColor) {
        fogColor = [d[o + 1], d[o + 2], d[o + 3]];
        light = lighting([{ color: rgb(4), dir: dir(7) }, { color: rgb(10), dir: dir(13) }], 0);
      }
      if (d[o] === AMBIENT && ambient === undefined) ambient = rgb(1);
    }
  }
  const lights: DlLighting = light
    ? { ...light, ambient: ambient === undefined ? [0x72, 0x72, 0x73] : [(ambient >> 16) & 255, (ambient >> 8) & 255, ambient & 255] }
    : lighting([{ color: 0x808080, dir: [30, 120, 60] }], 0x7f7f7f);

  const textures: Texture[] = [];
  const textureKeys = new Map<string, number>();
  const meshes: Mesh[] = [];
  const meshOf = new Map<string, number>();
  const memory = new LevelMemory();
  const modelRefs = (wi: number, mi: number) => {
    const w = worlds[wi];
    const m = w.models[mi];
    const part = m.parts ? w.parts[m.firstPart] : undefined;
    return part ? w.refs.slice(part.firstRef, part.firstRef + part.refs) : [];
  };
  // Lights are fixed in the world, so each mesh is lit for the yaw it is placed with: the model is
  // turned inside the mesh and the instance only translates it.
  const meshFor = (wi: number, mi: number, yaw: number): number => {
    const key = `${wi}/${mi}/${yaw}`;
    const known = meshOf.get(key);
    if (known !== undefined) return known;
    const start = memory.callList(modelRefs(wi, mi));
    const buf = memory.buf;
    const a = (yaw / 65536) * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a);
    const matrix: Mtx = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
    const batches = runDisplayList({
      buf, ucode: 'f3dex2', resolve: (addr) => (addr < buf.length ? addr : -1), textures, textureKeys, keyPrefix: '',
      vertexScale: 1, mirrorX: false, geometryMode: 0x230405, renderMode: 0x552078, matrix, lighting: lights,
      combiner: true, tlutMode: 'merged', decals: true,
    }, start);
    for (const b of batches) if (b.triSource) for (let k = 0; k < b.triSource.length; k++) b.triSource[k] = memory.romOffset(b.triSource[k]);
    const mesh = meshes.push({
      ...meshFromBatches(`world ${wi} model ${mi}`, batches),
      info: {
        file: `0x${files[wi].toString(16)}`, model: mi, yaw,
        triSource: `ROM offset in the geometry pool at 0x${POOL_GEO.toString(16)} (mapped back from the level-memory copy)`,
      },
    }) - 1;
    meshOf.set(key, mesh);
    return mesh;
  };

  // Resolve placements first, so the level memory holds exactly the chunks of placed models.
  const placed: { wi: number; pi: number; def: number; mi: number; kind: number; x: number; y: number; z: number; yaw: number }[] = [];
  let startView: Level['camera'];
  worlds.forEach((w, wi) => {
    for (const [pi, p] of w.placements.entries()) {
      let o = w.h[3] + p.def;
      let kind = w.data[o];
      // Conditional includes {39, cond, u16 flag, u32 definition}: with no game mode running,
      // condition 0 excludes the target and condition 1 includes it.
      let skip = false;
      for (let depth = 0; kind === INCLUDE && depth < 4; depth++) {
        if (w.data[o + 1] !== 1) {
          skip = true;
          break;
        }
        o = w.h[3] + w.dv.getUint32(o + 4);
        kind = w.data[o];
      }
      if (skip || o >= w.data.length) continue;
      if (kind === PLAYER_START && !startView && w.data[o + 1] === 0) startView = chaseCamera(p.x, p.y, p.z, p.yaw);
      const field = MODEL_FIELD[kind];
      if (field === undefined) continue;
      const mi = w.dv.getUint16(o + field);
      if (mi === 0xffff || mi >= w.models.length) continue;
      placed.push({ wi, pi, def: o, mi, kind, x: p.x, y: p.y, z: p.z, yaw: p.yaw });
      memory.add(modelRefs(wi, mi));
    }
  });
  memory.build(rom);
  const instances: Instance[] = [];
  for (const p of placed) {
    const mesh = meshFor(p.wi, p.mi, p.yaw);
    if (!meshes[mesh].batches.length) continue;
    instances.push({
      name: `kind ${p.kind} ${meshes[mesh].name}`, mesh, matrix: translation(p.x, p.y, p.z),
      info: {
        file: `0x${files[p.wi].toString(16)}`, placement: p.pi, record: `0x${(worlds[p.wi].h[2] + p.pi * 12).toString(16)}`,
        definition: `0x${p.def.toString(16)}`, kind: p.kind,
      },
    });
  }

  const extra: Partial<Level> = {};
  if (fogColor) {
    // gSPFogPosition(995, 1000); the game's far plane adapts between 1800 and 5000.
    extra.fog = { color: fogColor, multiplier: 25600, offset: -25344, near: 16, far: 5000 };
    extra.clearColor = fogColor;
  }
  if (startView) extra.camera = startView;
  return buildLevel(GA_LEVELS[index], `battletanxga-${index}`, textures, meshes, instances, extra);
}

export function openBattleTanxGA(rom: Uint8Array): Game {
  return {
    id: 'battletanxga',
    title: 'BattleTanx: Global Assault',
    levels: GA_LEVELS,
    loadLevel: (i) => loadLevel(rom, i),
    music: listGaMusic(),
    decodeMusic: (i) => decodeGaMusic(rom, i),
  };
}
