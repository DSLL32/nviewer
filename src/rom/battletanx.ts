// BattleTanx (USA): campaign levels, Battlelord territories and the unreachable test levels.
//
// Main code is uncompressed (RAM = ROM + 0x80070000). Per internal level id there is an LZARI
// level file A with 9 u32 section offsets h[0..8]:
//   h0 level header (spawn tables), h1 20-byte object groups, h2 28-byte objects, h3 12-byte
//   models, h4 model ranges, h5 4-byte LOD piece lists, h6 16-byte pieces {u32 texture-pool
//   offset, u16 animation, u16 size, u32 geometry-pool offset, u32 size}.
// Pieces reference raw display-list chunks in two ROM pools (texture/render state at 0x5A1110,
// F3DEX 1.x geometry at 0x3EA970) with chunk-relative addresses. At load the game relocates
// them, replaces render modes and combiners by their fog versions (table 0x80125860 ->
// 0x801258D8) and scales vertex colours by 1.92. Objects are placed at (x, 0, z) turned about Y.
import { runDisplayList } from './displaylist';
import { lzariDecode } from './lzari';
import { parseBank, renderSequence } from './music/libultra';
import { parseSequence } from './music/rush1';
import type { Batch, CameraView, DecodedMusic, Game, Instance, Level, LevelInfo, Mesh, MusicTrack, Texture } from './types';
import { buildLevel, meshFromBatches } from './bomberman/common';
import { view } from './util';

const RAM = 0x80070000;
const POOL_TEX = 0x5a1110;
const POOL_GEO = 0x3ea970;
const RGB_TABLE = 0x801259dc; // u8[3] per id: fog and clear colour
const COLOR_SCALE = 0x8012596c; // f32 per id: vertex colour scale
const FAR_TABLE = 0x80125a30; // i16 per id: far plane
const PATCH_FROM = 0x80125860; // 15 command words replaced by
const PATCH_TO = 0x801258d8; // these (fog versions)
const PATCH_COUNT = 15;
const SONG_TABLE = 0x80125714; // u32[20] cart addresses; song n = [T[n], T[n + 1])
const MUSIC_CTL = 0x298d60;
const MUSIC_TBL = 0x217ec0;

// Level file A per internal id (level records filled at run time by 0x800865E0).
const LEVEL_FILES: Record<number, number> = {
  0: 0x738900, 1: 0x73b2f0, 2: 0x742d50, 3: 0x7472c0, 4: 0x74f0f8, 5: 0x754ef0, 6: 0x756fa0, 7: 0x75ec90,
  8: 0x767ed8, 9: 0x76fe40, 10: 0x771ea8, 11: 0x77a370, 12: 0x783328, 13: 0x78a978, 14: 0x7909f8, 15: 0x797320,
  16: 0x79eb38, 17: 0x7a6188, 24: 0x7a8868, 25: 0x7adee8, 26: 0x7b0f40, 27: 0x7b4508,
};

const NAMES: Record<number, string> = {
  0: 'Cinematic', 1: 'New York - Queens', 2: 'New York - Tunnel', 3: 'New York - Times Square',
  4: 'New York - Washington Bridge', 5: 'New York - Bonus', 6: 'Midwest - Highway', 7: 'Chicago - Lake Shore Drive',
  8: 'Chicago - State Street', 9: 'Chicago - Bonus', 10: 'Desert', 11: 'Area 51', 12: 'Las Vegas - Fremont Street',
  13: 'Las Vegas - Bonus', 14: 'San Francisco - Golden Gate Bridge', 15: 'San Francisco - The Wharf',
  16: 'San Francisco - Quarantine Zone', 17: 'San Francisco - Bonus', 24: 'The Arena', 25: 'Test 2', 26: 'Test 3',
  27: 'Test 4',
};

// Objects with flag 0x10 exist only in campaign modes (0x8007C6D8: setup modes 3..6), objects with
// flag 0x40 only in the others (Battlelord, attract demo).
type Mode = 'campaign' | 'battle';

interface LevelDef { id: number; kind: LevelInfo['kind']; mode: Mode; name: string }

const DEFS: LevelDef[] = [
  // Campaign: internal ids 1..17 in order, a bonus stage closing each region.
  ...Array.from({ length: 17 }, (_, i): LevelDef => ({ id: i + 1, kind: 'campaign', mode: 'campaign', name: NAMES[i + 1] })),
  // Battlelord territory select (1 player), in menu order.
  ...[15, 11, 12, 8, 7, 24, 3, 1].map((id): LevelDef => ({ id, kind: 'battle', mode: 'battle', name: NAMES[id] })),
  // No menu reaches these: the attract-mode street set and three test levels.
  ...[0, 25, 26, 27].map((id): LevelDef => ({ id, kind: 'other', mode: 'battle', name: NAMES[id] })),
];

export const BATTLETANX_LEVELS: LevelInfo[] = DEFS.map((d, index) => ({ index, name: d.name, kind: d.kind }));

// Marker kinds (pickup spawns, AI markers, player starts) are never drawn.
const MARKER_KINDS = new Set([10, 21, 22, 23, 24, 25]);
const PLAYER_START = 25;

const G_VTX = 0x04;
const G_DL = 0x06;
const G_ENDDL = 0xb8;
const G_SETTIMG = 0xfd;

function loadLevel(rom: Uint8Array, index: number): Level {
  const def = DEFS[index];
  if (!def) throw new Error(`No level ${index}`);
  const id = def.id;
  const dv = view(rom);
  const a = lzariDecode(rom, LEVEL_FILES[id]);
  const adv = view(a);
  const h = Array.from({ length: 9 }, (_, k) => adv.getUint32(k * 4));
  const count = (k: number, size: number) => Math.floor((h[k + 1] - h[k]) / size);

  const models = Array.from({ length: count(3, 12) }, (_, i) => ({ lodType: a[h[3] + i * 12], firstLod: adv.getUint16(h[3] + i * 12 + 2) }));
  const lods = Array.from({ length: count(5, 4) }, (_, i) => ({ count: a[h[5] + i * 4], first: adv.getUint16(h[5] + i * 4 + 2) }));
  const pieces = Array.from({ length: count(6, 16) }, (_, i) => {
    const o = h[6] + i * 16;
    return { tex: adv.getUint32(o), anim: adv.getUint16(o + 4), texSize: adv.getUint16(o + 6), geo: adv.getUint32(o + 8), geoSize: adv.getUint32(o + 12) };
  });

  // Level memory: every distinct pool chunk once, relocated and patched as the game loads it.
  const scale = dv.getFloat32(COLOR_SCALE - RAM + id * 4);
  const patch = Array.from({ length: PATCH_COUNT }, (_, k) => [
    dv.getUint32(PATCH_FROM - RAM + k * 8), dv.getUint32(PATCH_FROM - RAM + k * 8 + 4),
    dv.getUint32(PATCH_TO - RAM + k * 8), dv.getUint32(PATCH_TO - RAM + k * 8 + 4),
  ]);
  const chunkAt = new Map<string, number>();
  const chunks: { src: number; size: number; geo: boolean; at: number }[] = [];
  let size = 0;
  const addChunk = (geo: boolean, off: number, len: number) => {
    const key = `${geo ? 'g' : 't'}${off}`;
    if (chunkAt.has(key)) return;
    chunkAt.set(key, size);
    chunks.push({ src: (geo ? POOL_GEO : POOL_TEX) + off, size: len, geo, at: size });
    size += (len + 7) & ~7;
  };
  for (const p of pieces) {
    addChunk(false, p.tex, p.texSize);
    addChunk(true, p.geo, p.geoSize);
  }
  const maxPieces = lods.reduce((m, l) => Math.max(m, l.count), 0);
  const scratch = size;
  const buf = new Uint8Array(size + (maxPieces * 3 + 1) * 8);
  const bdv = view(buf);
  for (const c of chunks) {
    buf.set(rom.subarray(c.src, Math.min(rom.length, c.src + c.size)), c.at);
    for (let o = c.at; o + 8 <= c.at + c.size; o += 8) {
      const w0 = bdv.getUint32(o);
      if (w0 >>> 24 === G_ENDDL) break; // texels follow the list in texture chunks
      const op = w0 >>> 24;
      if (!c.geo) {
        if (op === G_SETTIMG) bdv.setUint32(o + 4, bdv.getUint32(o + 4) + c.at);
        const w1 = bdv.getUint32(o + 4);
        for (const [f0, f1, t0, t1] of patch) {
          if (w0 === f0 && w1 === f1) {
            bdv.setUint32(o, t0);
            bdv.setUint32(o + 4, t1);
            break;
          }
        }
      } else if (op === G_VTX) {
        const rel = bdv.getUint32(o + 4);
        bdv.setUint32(o + 4, rel + c.at);
        const n = (w0 >>> 10) & 0x3f;
        for (let v = 0; v < n; v++) {
          for (let k = 12; k < 15; k++) {
            const q = c.at + rel + v * 16 + k;
            if (q < buf.length) buf[q] = Math.min(255, Math.trunc(buf[q] * scale));
          }
        }
      }
    }
  }

  const textures: Texture[] = [];
  const textureKeys = new Map<string, number>();
  const meshes: Mesh[] = [];
  const meshOf = new Map<string, number>();
  // One mesh per model and fixed palette frame, from its most detailed LOD: per piece the game
  // calls the texture chunk, the frame's G_SETTILE if the texture is animated, then the geometry.
  const meshFor = (mi: number, animNibble: number): number => {
    const lod = lods[models[mi].firstLod];
    if (!lod) return -1;
    const animated = Array.from({ length: lod.count }, (_, k) => pieces[lod.first + k]?.anim ?? 0).some((x) => x);
    const frame = animNibble < 14 ? animNibble : 0;
    const key = animated ? `${mi}/${frame}` : `${mi}`;
    const known = meshOf.get(key);
    if (known !== undefined) return known;
    let sp = scratch;
    const cmd = (w0: number, w1: number) => {
      bdv.setUint32(sp, w0);
      bdv.setUint32(sp + 4, w1);
      sp += 8;
    };
    for (let k = 0; k < lod.count; k++) {
      const p = pieces[lod.first + k];
      if (!p) continue;
      const tex = chunkAt.get(`t${p.tex}`)!;
      cmd(G_DL << 24, tex);
      if (p.anim) {
        const frames = p.anim >> 11;
        const entry = tex + (p.anim & 0x7ff) + 8 * (frame % frames);
        cmd(bdv.getUint32(entry), bdv.getUint32(entry + 4));
      }
      cmd(G_DL << 24, chunkAt.get(`g${p.geo}`)!);
    }
    cmd(G_ENDDL << 24, 0);
    const batches: Batch[] = runDisplayList({
      buf, ucode: 'f3dex', resolve: (addr) => (addr < buf.length ? addr : -1), textures, textureKeys, keyPrefix: '',
      vertexScale: 1, mirrorX: false, geometryMode: 0x1, combiner: true, tlutMode: 'slots', decals: true,
    }, scratch);
    const mesh = meshes.push(meshFromBatches(`model ${mi}${animated ? ` frame ${frame}` : ''}`, batches)) - 1;
    meshOf.set(key, mesh);
    return mesh;
  };

  const instances: Instance[] = [];
  let start: { x: number; z: number; yaw: number } | undefined;
  for (let i = 0; i < count(2, 28); i++) {
    const o = h[2] + i * 28;
    const flags = a[o];
    const visAnim = a[o + 1];
    const kind = adv.getUint32(o + 8);
    const x = adv.getFloat32(o + 12), z = adv.getFloat32(o + 16), yaw = adv.getUint16(o + 20);
    const model = adv.getInt16(o + 24);
    if (kind === PLAYER_START && !start) start = { x, z, yaw };
    // No viewport visibility bit: logic-only records.
    if (visAnim >> 4 === 0 || MARKER_KINDS.has(kind)) continue;
    if (def.mode === 'campaign' ? flags & 0x40 : flags & 0x10) continue;
    if (model < 0 || model >= models.length) continue;
    const mesh = meshFor(model, visAnim & 15);
    if (mesh < 0 || !meshes[mesh].batches.length) continue;
    const ang = (yaw / 65536) * 2 * Math.PI;
    const c = Math.cos(ang), s = Math.sin(ang);
    instances.push({ name: meshes[mesh].name, mesh, matrix: new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, x, 0, z, 1]) });
  }

  const rgb = RGB_TABLE - RAM + id * 3;
  const color: [number, number, number] = [rom[rgb], rom[rgb + 1], rom[rgb + 2]];
  const extra: Partial<Level> = {
    // gSPFogPosition(995, 1000) with the level's far plane (near 16); the sky is cleared to the fog colour.
    fog: { color, multiplier: 25600, offset: -25344, near: 16, far: dv.getInt16(FAR_TABLE - RAM + id * 2) },
    clearColor: color,
  };
  if (start) extra.camera = chaseCamera(start.x, 0, start.z, start.yaw);
  return buildLevel(BATTLETANX_LEVELS[index], `battletanx-${index}`, textures, meshes, instances, extra);
}

// The game's chase camera: about 170 units behind the tank and 74 above it. A tank faces model -Z.
export function chaseCamera(x: number, y: number, z: number, yaw: number): CameraView {
  const ang = (yaw / 65536) * 2 * Math.PI;
  const fx = -Math.sin(ang), fz = -Math.cos(ang);
  return { eye: [x - fx * 170, y + 74, z - fz * 170], target: [x + fx * 400, y + 20, z + fz * 400] };
}

// Songs by where the game plays them (there is no sound test).
const SONG_NAMES = [
  'Times Square', 'Lake Shore Drive', 'Tunnel', 'Highway', 'Area 51', 'Fremont Street', 'Title and Menus', 'Queens',
  'Golden Gate Bridge', 'Unused A', 'Quarantine Zone', 'Unused B', 'Unused C', 'Story Screen Cue', 'Unused D',
  'The Fall', 'Desert', 'Washington Bridge', 'State Street',
];

function battletanxMusic(rom: Uint8Array): { tracks: MusicTrack[]; decode(i: number): DecodedMusic } {
  const dv = view(rom);
  let bank: ReturnType<typeof parseBank> | undefined;
  return {
    tracks: SONG_NAMES.map((name, index) => ({ index, name: `${String(index).padStart(2, '0')} ${name}` })),
    decode(index: number) {
      if (index < 0 || index >= SONG_NAMES.length) throw new Error(`No music track ${index}`);
      const start = dv.getUint32(SONG_TABLE - RAM + index * 4) - 0xb0000000;
      const end = dv.getUint32(SONG_TABLE - RAM + (index + 1) * 4) - 0xb0000000;
      bank ??= parseBank(rom, MUSIC_CTL, MUSIC_TBL, 0, null);
      // alSeqPlayer at 22047 Hz, 48 voices, sequence volume 5 << 12, looping tick 0 to the end
      // of the track; pitch ratios carry no sample-rate factor.
      return renderSequence(rom, bank, parseSequence(rom.subarray(start, end)), {
        rate: 22047, maxVoices: 48, seqVol: 20480, loop: true, pitchScale: 1,
      }).music;
    },
  };
}

export function openBattleTanx(rom: Uint8Array): Game {
  const music = battletanxMusic(rom);
  return {
    id: 'battletanx',
    title: 'BattleTanx',
    levels: BATTLETANX_LEVELS,
    loadLevel: (i) => loadLevel(rom, i),
    music: music.tracks,
    decodeMusic: (i) => music.decode(i),
  };
}
