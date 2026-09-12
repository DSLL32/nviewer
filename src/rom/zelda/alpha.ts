// The Ocarina of Time prototype (late 1997) in the upper half of an F-Zero X development cartridge (ZELDA64.md §11).
// No build string, file table, code, objects, skies or audio survive: 52 scenes (each scene file followed by its rooms)
// lie raw at 0x10FA150-0x19A4470. Identified by the whole file's MD5. Same header, mesh and collision formats as
// retail OoT with these differences: F3DEX 1.x display lists, raw RGBA16 prerendered backgrounds, 12-byte waterboxes,
// alpha actor ids, and lost draw configs (dynamic segments 7-0xD) and keep objects.
import { buildLevel, fogPosition } from '../bomberman/common';
import { runDisplayList, type DisplayListContext } from '../displaylist';
import { decodeRows, ImFmt, ImSiz, Tlut } from '../texture';
import type { Backdrop, Batch, CameraView, DebugInfo, Game, Instance, Level, LevelInfo, LevelKind, LevelLayer, Marker, Mesh, Texture } from '../types';
import { floorBgCam, waterBoxBatch } from './collision';
import { resolveCoplanar } from './coplanar';
import { currentLights, rspLighting, sceneLightPresets } from './env';
import { OOT_ACTORS } from './names';
import {
  alternateHeaders, headerForLayer, parseCollision, parseHeader, readRoomHeader, readSceneHeader, s16, u16, u32, type Collision, type RoomHeader,
} from './scene';
import { halfTexel, layerGroup, meshOf, translation } from './zelda';

export const ALPHA_MD5 = '95bf2153aaad6faff3fb42fecd2f0200';
const DATA_START = 0x1000000, DATA_END = 0x19a4470;

// [id, scene start, display name, sw97 name, kind, group, retail counterpart, collision shared, textures shared, status,
// name guessed by sw97]
type AlphaScene = [number, number, string, string, LevelKind, string, string, string, string, string, boolean];
const O = 'Overworld', D = 'Dungeons', I = 'Interiors and prerendered', U = 'Unfinished and unknown', T = 'Test maps';
const SCENES: AlphaScene[] = [
  [0x00, 0x10fa150, 'Fstdan (test dungeon)', 'fstdan', 'adventure', D, 'none', '-', '0%', 'absent from retail; leak Fstdan_SCENE/ROOM0-9', false],
  [0x01, 0x116bf80, "Dodongo's Cavern (1997)", 'dodongos_cavern', 'adventure', D, 'ddan (17 rooms)', '8%', '18%', 'older version, same overall topology', false],
  [0x02, 0x11d7ca0, 'syotes (test)', 'syotes_old', 'other', T, 'syotes (debug)', '100%', '81%', 'test map, geometry as in the debug ROM', false],
  [0x03, 0x11e6860, 'syotes2 (test)', 'syotes2_old', 'other', T, 'syotes2 (debug)', '100%', '71%', 'test map', false],
  [0x04, 0x11f2c30, 'test01 (test map)', 'test_map', 'other', T, 'test01 (debug)', '99%', '33%', 'test map', false],
  [0x05, 0x1200b10, 'Deku Tree, unfinished', 'unfinished_deku_tree', 'other', U, 'none', '0%', '0%', 'absent from retail', true],
  [0x06, 0x1209b40, 'Gohma room, unfinished', 'unfinished_gohma', 'other', U, 'ydan_boss?', '0%', '0%', 'absent from retail', true],
  [0x07, 0x1213480, 'depth_test (prerendered)', 'old_depth_test', 'other', T, 'depth_test (debug)', '100%', '-', 'test map; background image present', false],
  [0x08, 0x125ee70, 'Item shop (prerendered)', 'i_shop', 'other', I, 'none', '0%', '-', 'absent from retail; background present', false],
  [0x09, 0x12875b0, 'Hyrule Field (Spaceworld 97)', 'hyrule_field', 'hub', O, 'spot00', '36%', '41%', 'demo version; night alternate header', false],
  [0x0a, 0x12b1c30, 'Kakariko Village (old)', 'old_kakariko_village', 'hub', O, 'spot01', '0%', '0%', 'different layout', false],
  [0x0b, 0x12d2df0, 'Graveyard (old)', 'old_graveyard', 'hub', O, 'spot02', '0%', '0%', 'different layout', false],
  [0x0c, 0x12e8a70, 'Lost Woods (old)', 'old_lost_woods', 'hub', O, 'spot10 (10 rooms)', '0%', '21%', 'one open area instead of the room maze', false],
  [0x0d, 0x130c490, 'Kokiri Forest (1997)', 'kokiri_forest', 'hub', O, 'spot04 (3 rooms)', '51%', '38%', 'older version', false],
  [0x0e, 0x1335a90, 'Sacred Forest Meadow (old)', 'old_sacred_forest_meadow', 'hub', O, 'spot05', '0%', '0%', 'different layout', false],
  [0x0f, 0x133cd40, 'Lake Hylia (old)', 'old_lake_hylia', 'hub', O, 'spot06', '0%', '0%', 'different layout', false],
  [0x10, 0x1356e50, "Zora's River (old)", 'old_zoras_river', 'hub', O, 'spot03', '0%', '0%', 'different layout', false],
  [0x11, 0x135d420, 'Pond (unknown)', 'old_pond', 'hub', O, 'none found', '-', '12%', 'absent from retail', false],
  [0x12, 0x1366200, 'Gerudo Valley (1997)', 'gerudo_valley', 'hub', O, 'spot09 / spot12', '0%', '32%', 'textures from spot09/spot12', false],
  [0x13, 0x138efc0, 'Hyrule Castle (1997)', 'hyrule_castle', 'hub', O, 'spot15', '11%', '30%', 'path layout recognisably the same, geometry rebuilt', false],
  [0x14, 0x13a8aa0, 'Death Mountain Trail (1997)', 'death_mountain_trail', 'hub', O, 'spot16', '70%', '36%', 'close to retail', false],
  [0x15, 0x13c2d50, 'Death Mountain Crater (1997)', 'death_mountain_crater', 'hub', O, 'spot17', '0%', '3%', 'same star-shaped outline, different geometry', false],
  [0x16, 0x13e4860, 'Unknown 0x16', 'unk_0x16', 'other', U, '?', '-', '0%', 'absent from retail', false],
  [0x17, 0x13e74b0, 'Unknown 0x17', 'unk_0x17', 'other', U, '? (HIDAN textures)', '-', '20%', 'absent from retail', false],
  [0x18, 0x13f4780, 'Market, prerender placeholder 1', 'pr_market_1', 'other', I, 'market_day', '8%', '-', 'untextured placeholder; background absent', false],
  [0x19, 0x13f8fc0, 'Market, prerender placeholder 2', 'pr_market_2', 'other', I, 'market_day', '6%', '-', 'untextured placeholder; background absent', false],
  [0x1a, 0x13fc0c0, 'Fire Temple (1997)', 'fire_temple', 'adventure', D, 'HIDAN (27 rooms)', '3%', '22%', 'different layout', false],
  [0x1b, 0x1516950, 'Forest Temple (1997)', 'forest_temple', 'adventure', D, 'Bmori1 (23 rooms)', '3%', '29%', 'different layout', false],
  [0x1c, 0x160bb40, 'Archery range', 'archery', 'hub', O, 'none (not syatekijyou)', '0%', '0%', 'absent from retail', false],
  [0x1d, 0x161b1e0, 'sasatest (test)', 'old_sasatest', 'other', T, 'sasatest (debug)', '100%', '-', 'test map', false],
  [0x1e, 0x16225b0, 'Behind Temple of Time, prerender placeholder', 'pr_behind_tot', 'other', I, '?', '-', '-', 'untextured placeholder; background absent', false],
  [0x1f, 0x1624320, 'testroom (test)', 'old_testroom', 'other', T, 'testroom (debug, 5 rooms)', '72%', '94%', 'test map, older revision', false],
  [0x20, 0x16336c0, 'Inside the Deku Tree (1997)', 'deku_tree', 'adventure', D, 'ydan (12 rooms)', '0%', '13%', 'different layout', false],
  [0x21, 0x16aa080, 'Jabu-Jabu test', 'jabu_test', 'other', T, 'none', '-', '0%', 'absent from retail', false],
  [0x22, 0x16ad480, 'Chamber of Sages (1997)', 'chamber_of_sages', 'other', I, 'kenjyanoma', '29%', '5%', 'older version', false],
  [0x23, 0x16bf4e0, 'Temple of Time exterior, prerender placeholder', 'pr_outside_tot', 'other', I, 'shrine', '0%', '-', 'untextured placeholder; background absent', false],
  [0x24, 0x16c36c0, 'Great Fairy Fountain (1997)', 'fairy_fountain', 'other', I, 'yousei_izumi_tate', '27%', '12%', 'older version', false],
  [0x25, 0x16d0cc0, 'Temple of Time (1997)', 'temple_of_time', 'other', I, 'tokinoma (2 rooms)', '0%', '60%', 'different layout, retail textures', false],
  [0x26, 0x16e1c10, 'Forest Temple room, unfinished', 'unfinished_forest_temple', 'other', U, 'none', '0%', '100%', 'absent from retail', false],
  [0x27, 0x16ecfe0, 'lod_test', 'lod_test', 'other', T, 'none', '-', '0%', 'test map (2 triangles)', false],
  [0x28, 0x16eed40, 'sutaru (test)', 'old_sutaru', 'other', T, 'sutaru (debug)', '100%', '100%', 'test map', false],
  [0x29, 0x16f6ba0, 'Fire Temple rooms, unfinished', 'unfinished_fire_temple', 'other', U, 'none', '0%', '33%', 'absent from retail', false],
  [0x2a, 0x1733f00, "Link's House (prerendered)", 'pr_links_house', 'other', I, 'link_home', '23% (85% within 16 units)', '-', 'background present', false],
  [0x2b, 0x175b4c0, 'Kokiri house 1 (prerendered)', 'pr_kokiri_house_1', 'other', I, 'kokiri_home', '4%', '-', 'background present', false],
  [0x2c, 0x17856a0, 'Unknown 0x2C', 'unk_0x2C', 'other', U, '?', '-', '50%', 'absent from retail', false],
  [0x2d, 0x1789c10, 'Hyrule Field (older)', 'old_hyrule_field', 'hub', O, 'spot00', '0%', '0%', 'older, very different map; no actors', false],
  [0x2e, 0x17c6920, 'Unknown 0x2E', 'unk_0x2E', 'other', U, '? (mori textures)', '-', '40%', 'absent from retail', false],
  [0x2f, 0x17d3120, 'Water Temple (1997)', 'water_temple', 'adventure', D, 'MIZUsin (23 rooms)', '0%', '27%', 'different layout', false],
  [0x30, 0x18c2ca0, 'Kokiri house 2 (prerendered)', 'pr_kokiri_house_2', 'other', I, 'kokiri_home3', '0%', '-', 'background present', false],
  [0x31, 0x18ee2c0, 'Grotto (1997)', 'grottos', 'other', I, 'kakusiana (14 rooms)', '68%', '36%', 'one grotto', false],
  [0x32, 0x18f9b10, 'Gerudo Training Ground (old)', 'poe_race', 'adventure', D, 'men (11 rooms)', '12%', '25%', 'older version', false],
  [0x33, 0x197d860, 'Market Entrance (prerendered)', 'unk_0x33', 'other', I, 'entra', '42% (92% within 16 units)', '-', 'background present', false],
];
// Sidebar order (§11.4).
const ORDER = [
  0x09, 0x2d, 0x0d, 0x0c, 0x0e, 0x0a, 0x0b, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x1c,
  0x20, 0x01, 0x1b, 0x1a, 0x2f, 0x32, 0x00,
  0x25, 0x22, 0x24, 0x31, 0x08, 0x2a, 0x2b, 0x30, 0x33, 0x18, 0x19, 0x1e, 0x23,
  0x05, 0x06, 0x26, 0x29, 0x16, 0x17, 0x2c, 0x2e,
  0x02, 0x03, 0x04, 0x07, 0x1d, 0x1f, 0x21, 0x27, 0x28,
];

// ---- identification ----

// MD5 (RFC 1321) of the whole ROM.
export function md5Hex(data: Uint8Array): string {
  const K = Array.from({ length: 64 }, (_, i) => (Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  const R = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const n = data.length, total = ((n + 8) >>> 6) + 1;
  const words = new Uint32Array(16);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const tail = new Uint8Array(64);
  for (let blk = 0; blk < total; blk++) {
    const o = blk * 64;
    if (o + 64 <= n) {
      for (let i = 0; i < 16; i++) words[i] = data[o + i * 4] | (data[o + i * 4 + 1] << 8) | (data[o + i * 4 + 2] << 16) | (data[o + i * 4 + 3] << 24);
    } else {
      tail.fill(0);
      if (o < n) tail.set(data.subarray(o, n));
      if (n >= o && n < o + 64) tail[n - o] = 0x80;
      if (blk === total - 1) {
        const bits = n * 8;
        tail[56] = bits & 0xff; tail[57] = (bits >>> 8) & 0xff; tail[58] = (bits >>> 16) & 0xff; tail[59] = (bits >>> 24) & 0xff;
        tail[60] = Math.floor(bits / 2 ** 32) & 0xff;
      }
      for (let i = 0; i < 16; i++) words[i] = tail[i * 4] | (tail[i * 4 + 1] << 8) | (tail[i * 4 + 2] << 16) | (tail[i * 4 + 3] << 24);
    }
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; } else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; } else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) & 15; } else { f = c ^ (b | ~d); g = (7 * i) & 15; }
      const t = d;
      d = c;
      c = b;
      const x = (a + f + K[i] + words[g]) | 0, s = R[(i >> 4) * 4 + (i & 3)];
      b = (b + ((x << s) | (x >>> (32 - s)))) | 0;
      a = t;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  const hex = (v: number) => Array.from({ length: 4 }, (_, k) => ((v >>> (8 * k)) & 0xff).toString(16).padStart(2, '0')).join('');
  return hex(a0) + hex(b0) + hex(c0) + hex(d0);
}

// Cheap checks first (size and header), then the hash.
export function isZeldaAlpha(rom: Uint8Array): boolean {
  if (rom.length !== 0x2000000 || String.fromCharCode(...rom.subarray(0x3b, 0x3f)) !== 'CFZE') return false;
  return md5Hex(rom) === ALPHA_MD5;
}

// The structural scan (§11.3): 4-aligned room-list commands 04 nn 00 00 02 xxxxxx whose table (relative to a header
// start up to 24 commands back) holds nn ascending, non-overlapping ROM ranges inside the data area, the first after
// the header, with a valid command list up to its END.
export function scanAlphaScenes(rom: Uint8Array): number[] {
  const found = new Set<number>();
  for (let o = DATA_START; o < DATA_END - 8; o += 4) {
    if (rom[o] !== 0x04 || rom[o + 4] !== 0x02 || rom[o + 2] || rom[o + 3] || !rom[o + 1]) continue;
    const n = rom[o + 1];
    let best = -1;
    for (let k = 0; k < 25; k++) {
      const start = o - 8 * k;
      if (start < DATA_START) break;
      const ro = start + (u32(rom, o + 4) & 0xffffff);
      if (ro + 8 * n > DATA_END) continue;
      let ok = true;
      for (let i = 0; i < n && ok; i++) {
        const a = u32(rom, ro + 8 * i), b = u32(rom, ro + 8 * i + 4);
        ok = a >= DATA_START && a < b && b <= DATA_END && (i === 0 ? a > start : a >= u32(rom, ro + 8 * i - 4));
      }
      if (!ok) continue;
      const first = u32(rom, ro);
      const cmds = parseHeader(rom.subarray(start, first), 0);
      if (cmds && cmds.some((c) => c.code === 0x04)) best = start;
    }
    if (best >= 0) found.add(best);
  }
  return [...found].sort((a, b) => a - b);
}

// Alpha actor ids (§11.5): the same as retail below 0x20, En_Fish/En_Insect swapped, 0x22/0x23 keep actors and 0x54
// En_Npc only in the alpha, retail id + 1 from 0x24.
export function alphaActorName(id: number): { name: string; retail: number } {
  if (id === 0x22) return { name: 'Field_Keep', retail: -1 };
  if (id === 0x23) return { name: 'Dungeon_Keep', retail: -1 };
  if (id === 0x54) return { name: 'En_Npc', retail: -1 };
  const retail = id < 0x20 ? id : id === 0x20 ? 0x21 : id === 0x21 ? 0x20 : id <= 0x63 ? id - 1 : -1;
  return { name: retail >= 0 ? OOT_ACTORS[retail] || `actor 0x${id.toString(16)}` : `actor 0x${id.toString(16)}`, retail };
}

// ---- levels ----

const hex = (v: number) => `0x${(v >>> 0).toString(16)}`;
// The retail SETUPDL_25 state with F3DEX geometry mode bits (ZBUFFER, SHADE, SHADING_SMOOTH, CULL_BACK, FOG, LIGHTING).
const SETUP_COMBINE: [number, number] = [0xfc127e03, 0xff0ff3ff];
const SETUP_OTHERMODE_H = 0x00102c10;
const SETUP_RENDERMODE = 0xc8112078;
const SETUP_RENDERMODE_XLU = 0xc81049d8;
const SETUP_GEOMETRY = 0x1 | 0x4 | 0x200 | 0x2000 | 0x10000 | 0x20000;
const PREREND_FIXED = 0x19;

interface AlphaDef { scene: AlphaScene; layer: number; setupName?: string }

interface AlphaCollisionGroup { type: number; flagsA: number; flagsB: number; count: number; batch: Batch }

// Keep alpha collision grouped by SurfaceType so a selected face reports the exact two words that govern it.
// Swimming is not a CollisionPoly/SurfaceType property in Zelda: rectangular WaterBox records define water volumes.
// Batch.triSource is the scene-buffer offset of the original 16-byte CollisionPoly record.
function alphaCollisionGroups(c: Collision, sceneData: Uint8Array, collisionHeader: number): AlphaCollisionGroup[] {
  const header = collisionHeader & 0xffffff;
  const polyList = header + 0x1c <= sceneData.length ? u32(sceneData, header + 0x18) & 0xffffff : 0;
  const colors: [number, number, number][] = [[90, 200, 90], [200, 150, 80], [200, 90, 200]];
  const groups = new Map<string, { type: number; flagsA: number; flagsB: number; pos: number[]; col: number[]; src: number[] }>();
  for (let i = 0; i < c.polys.length; i++) {
    const p = c.polys[i];
    const vertices = p.v.map((v) => c.vertices[v]);
    if (vertices.some((v) => !v)) continue;
    const record = polyList + i * 16;
    const flagsA = record + 6 <= sceneData.length ? u16(sceneData, record + 2) & 0xe000 : 0;
    const flagsB = record + 6 <= sceneData.length ? u16(sceneData, record + 4) & 0xe000 : 0;
    const key = `${p.type}:${flagsA}:${flagsB}`;
    const g = groups.get(key) ?? { type: p.type, flagsA, flagsB, pos: [], col: [], src: [] };
    groups.set(key, g);
    const kind = p.normal[1] > 0.5 ? 0 : p.normal[1] < -0.5 ? 2 : 1;
    const st = c.surfaceTypes[p.type] ?? [0, 0];
    const h = (Math.imul(st[0] ^ Math.imul(st[1], 40503), 2654435761) >>> 24) / 255;
    const shade = 0.7 + 0.3 * h;
    const rgb = colors[kind].map((v) => Math.round(v * shade));
    for (const v of vertices) {
      g.pos.push(v![0], v![1], v![2]);
      g.col.push(rgb[0], rgb[1], rgb[2], 150);
    }
    g.src.push(record);
  }
  return [...groups.values()].sort((a, b) => a.type - b.type || a.flagsA - b.flagsA || a.flagsB - b.flagsB).map((g) => ({
    type: g.type, flagsA: g.flagsA, flagsB: g.flagsB, count: g.src.length,
    batch: {
      texture: -1, blend: 'blend', depthTest: true, depthWrite: false, cullBack: false,
      positions: new Float32Array(g.pos), uvs: new Float32Array((g.pos.length / 3) * 2), colors: new Uint8Array(g.col),
      triSource: new Uint32Array(g.src),
    },
  }));
}

function alphaSurfaceInfo(type: number, flagsA: number, flagsB: number, words: [number, number], count: number): DebugInfo {
  const [w0, w1] = words;
  const word = (v: number) => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;
  return {
    surfaceType: type, surfaceWords: `${word(w0)} ${word(w1)}`, polygonFlags: `${word(flagsA)} ${word(flagsB)}`, polygonsWithFlags: count,
    bgCamIndex: w0 & 0xff, exitIndex: (w0 >>> 8) & 0x1f, floorType: (w0 >>> 13) & 0x1f,
    wallType: (w0 >>> 21) & 0x1f, floorProperty: (w0 >>> 26) & 0xf,
    soft: (w0 >>> 30) & 1 ? 'yes' : 'no', horseBlocked: w0 >>> 31 ? 'yes' : 'no',
    material: w1 & 0xf, floorEffect: (w1 >>> 4) & 3, lightSetting: (w1 >>> 6) & 0x1f,
    echo: (w1 >>> 11) & 0x3f, hookshot: (w1 >>> 17) & 1 ? 'yes' : 'no',
    conveyorSpeed: (w1 >>> 18) & 7, conveyorDirection: (w1 >>> 21) & 0x3f,
    wallDamage: (w1 >>> 27) & 1 ? 'yes' : 'no',
    ignoreCamera: flagsA & 0x2000 ? 'yes' : 'no', ignoreEntities: flagsA & 0x4000 ? 'yes' : 'no',
    ignoreProjectiles: flagsA & 0x8000 ? 'yes' : 'no', floorConveyor: flagsB & 0x2000 ? 'yes' : 'no',
    swimmable: 'not encoded by SurfaceType; swimming regions are separate waterboxes',
    triSource: 'offset of the 16-byte collision polygon record in the scene buffer',
  };
}

function loadAlphaLevel(rom: Uint8Array, def: AlphaDef, info: LevelInfo): Level {
  const [id, start, name, sw97, , , retail, colShared, texShared, status, guessed] = def.scene;
  const roomList = parseHeader(rom.subarray(start, start + 0x200), 0)?.find((c) => c.code === 0x04);
  const firstRoom = roomList ? u32(rom, start + (roomList.d2 & 0xffffff)) : start + 0x200;
  const sceneData = rom.subarray(start, firstRoom);
  const hdr = headerForLayer(sceneData, 2, def.layer, 'oot');
  const sh = readSceneHeader(sceneData, hdr.cmds, hdr.used, 'oot');
  const rooms = sh.rooms.map((r, k) => {
    if (r.vromStart < DATA_START || r.vromEnd > DATA_END || r.vromEnd <= r.vromStart) return null;
    const data = rom.subarray(r.vromStart, r.vromEnd);
    try {
      const h = headerForLayer(data, 3, def.layer, 'oot');
      return { index: k, start: r.vromStart, data, header: readRoomHeader(data, h.cmds, h.used) as RoomHeader };
    } catch {
      return null;
    }
  });
  const spawn = sh.spawns[0] ?? { playerEntry: 0, room: 0 };
  const player = sh.playerEntries[spawn.playerEntry] ?? sh.playerEntries[0];
  const levelInfo: DebugInfo = {
    scene: `${hex(id)} ${name}`, sw97Name: sw97 + (guessed ? ' (the name is the sw97 project\'s guess)' : ''), romRange: `${hex(start)}-${hex(rooms.at(-1)?.start ?? firstRoom)}`,
    retailCounterpart: retail, collisionShared: colShared, texturesShared: texShared, status, layer: def.layer,
  };

  // Environment: the light settings as in retail at noon (setting blend by time for lightMode 0), night for the
  // alternate header. The fog colour is the clear colour (no sky files).
  const time = def.layer === 1 ? 0 : 0x8000;
  const lights = currentLights('oot', sh.lightMode, sh.lights, time);
  const lighting = lights ? rspLighting(lights) : { ambient: [255, 255, 255] as [number, number, number], lights: [] };
  const lightingPresets = sceneLightPresets('oot', sh.lightMode, sh.lights);
  let defaultLighting = lightingPresets.findIndex((preset) => JSON.stringify(preset.lighting) === JSON.stringify(lighting));
  if (lightingPresets.length && defaultLighting < 0) {
    lightingPresets.unshift({ name: 'Current', lighting });
    defaultLighting = 0;
  }
  const fog = lights && lights.fogNear < 1000 ? fogPosition(lights.fogNear, 1000, lights.fogColor as [number, number, number], 10, lights.zFar || 12800) : undefined;
  const clearColor = (lights?.fogColor ?? [0, 0, 0]) as [number, number, number];

  // Address space: scene, rooms, an end-of-list stub for the lost dynamic segments.
  const size = sceneData.length + rooms.reduce((n, r) => n + (r ? r.data.length : 0), 0) + 8 + 64;
  const buf = new Uint8Array(size);
  buf.set(sceneData, 0);
  const roomBase: number[] = [];
  let at = sceneData.length;
  for (const r of rooms) {
    roomBase.push(at);
    if (r) {
      buf.set(r.data, at);
      at += r.data.length;
    }
  }
  const stub = at;
  buf[stub] = 0xb8; // F3DEX G_ENDDL
  // An identity matrix (16.16) for room G_MTX commands whose matrix segment (the lost draw config's 0xD) is not in the ROM.
  const identityMtx = stub + 8;
  for (const i of [0, 5, 10, 15]) buf[identityMtx + i * 2 + 1] = 1;
  const resolver = (room: number, images: boolean) => (addr: number): number => {
    const seg = addr >>> 24, off = addr & 0xffffff;
    if (seg === 2) return off < sceneData.length ? off : -1;
    if (seg === 3) return rooms[room] && off < rooms[room]!.data.length ? roomBase[room] + off : -1;
    // Keep objects (4, 5) and the draw config's segments (6-0xD) are not in the ROM: calls draw nothing, textures
    // stay untextured.
    return !images && seg >= 4 && seg <= 0x0d ? stub : -1;
  };
  const textures: Texture[] = [];
  const textureKeys = new Map<string, number>();
  let errors = 0;
  const run = (dl: number, xlu: boolean, room: number): Batch[] => {
    const ctx: DisplayListContext = {
      buf, ucode: 'f3dex', resolve: resolver(room, false), resolveImage: resolver(room, true), textures, textureKeys, keyPrefix: '',
      vertexScale: 1, mirrorX: false, geometryMode: SETUP_GEOMETRY, renderMode: (xlu ? SETUP_RENDERMODE_XLU : SETUP_RENDERMODE) & ~7,
      alphaCompare: 0, combineMode: SETUP_COMBINE, otherModeH: SETUP_OTHERMODE_H, primColor: 0xffffffff, envColor: 0x80808080,
      lighting, lightingPresets: lightingPresets.map((preset) => preset.lighting), directImages: true, secondTexture: true, decals: true, combiner: true, textureGen: true,
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      resolveMatrix: (addr) => (addr >>> 24 === 2 || addr >>> 24 === 3 ? resolver(room, false)(addr) : identityMtx),
    };
    try {
      const out = runDisplayList(ctx, dl);
      halfTexel(out, textures);
      return out;
    } catch {
      errors++;
      return [];
    }
  };

  const meshes: Mesh[] = [];
  const instances: Instance[] = [];
  const layers: LevelLayer[] = [];
  const markers: Marker[] = [];
  const layerIndex = new Map<string, number>();
  const layer = (lname: string, kind: LevelLayer['kind'], visible = true) => {
    let i = layerIndex.get(lname);
    if (i === undefined) {
      const group = layerGroup(lname, kind);
      i = layers.push({ name: lname, kind, instances: [], ...(visible ? {} : { visibleByDefault: false }), ...(group ? { group } : {}) }) - 1;
      layerIndex.set(lname, i);
    }
    return i;
  };
  const place = (lname: string, kind: LevelLayer['kind'], mesh: Mesh, iname: string, iinfo: DebugInfo, visible = true) => {
    const m = meshes.push(mesh) - 1;
    layers[layer(lname, kind, visible)].instances.push(instances.push({ name: iname, mesh: m, matrix: translation([0, 0, 0]), info: iinfo }) - 1);
  };

  let collision: Collision | null = null;
  try {
    collision = sh.collision ? parseCollision(sceneData, sh.collision, 12) : null;
  } catch {
    collision = null;
  }

  // Prerendered background: a raw RGBA16 320x240 image at the end of the room file.
  let backdrop: Backdrop | undefined;
  let fixedCamera: CameraView | undefined;
  const spawnRoom = rooms[spawn.room] ?? rooms.find((r) => r) ?? null;
  const imageRoom = spawnRoom?.header.mesh?.type === 1 && spawnRoom.header.mesh.images.length ? spawnRoom : null;
  const floorCam = collision && player ? floorBgCam(collision, player.pos[0], player.pos[1], player.pos[2]) : -1;
  if (imageRoom) {
    const img = imageRoom.header.mesh!.images[0];
    const off = img.source >>> 24 === 3 ? img.source & 0xffffff : -1;
    const w = img.width || 320, h = img.height || 240;
    if (off >= 0 && off + w * h * 2 <= imageRoom.data.length) {
      const rgba = decodeRows(imageRoom.data, off, ImFmt.RGBA, ImSiz.B16, w, h, null, Tlut.None);
      for (let k = 3; k < rgba.length; k += 4) rgba[k] = 255;
      const texture = textures.push({ width: w, height: h, rgba, wrapS: 'clamp', wrapT: 'clamp', format: 'RGBA16', source: `room ${imageRoom.index} ${hex(img.source)}` }) - 1;
      backdrop = { texture, u0: 0, v0: 0, u1: 1, v1: 1, aspect: w / h }; // the game's 320x240 view from the fixed camera
      // The fixed bg camera of the spawn floor, else the first camera with position data.
      const cams = collision?.bgCams ?? [];
      const order = [floorCam, ...cams.map((c, i) => (c.setting === PREREND_FIXED ? i : -1)), ...cams.map((_, i) => i)].filter((i) => i >= 0);
      for (const ci of order) {
        const bc = cams[ci];
        const o = bc && bc.data >>> 24 === 2 && bc.count > 0 ? bc.data & 0xffffff : -1;
        if (o < 0 || o + 0x12 > sceneData.length) continue;
        const pos: [number, number, number] = [s16(sceneData, o), s16(sceneData, o + 2), s16(sceneData, o + 4)];
        const pitch = (-s16(sceneData, o + 6) / 0x8000) * Math.PI, yaw = (s16(sceneData, o + 8) / 0x8000) * Math.PI;
        let fov = s16(sceneData, o + 12);
        fov = fov === -1 ? 60 : fov > 360 ? fov / 100 : fov;
        if (!(fov > 5 && fov < 170)) fov = 60;
        const dir = [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];
        fixedCamera = { eye: pos, target: [pos[0] + dir[0] * 100, pos[1] + dir[1] * 100, pos[2] + dir[2] * 100], fovY: fov };
        levelInfo.backgroundCamera = `bg camera ${ci} setting ${hex(bc.setting)}`;
        break;
      }
    }
  }

  // Rooms: one mesh each; the opaque lists of an image room only leave depth under the background. Coplanar surfaces
  // are resolved over all rooms in draw order (all opaque lists, then all translucent lists; coplanar.ts).
  const all: Batch[] = [], order: number[] = [], owner: { room: number; xlu: boolean }[] = [];
  let opaRuns = 0, xluRuns = 0;
  for (const r of rooms) {
    if (!r?.header.mesh) continue;
    for (const e of r.header.mesh.entries) {
      if (e.opa) {
        for (const b of run(e.opa, false, r.index)) { all.push(b); order.push(opaRuns); owner.push({ room: r.index, xlu: false }); }
        opaRuns++;
      }
      if (e.xlu) {
        for (const b of run(e.xlu, true, r.index)) { all.push(b); order.push(0x100000 + xluRuns); owner.push({ room: r.index, xlu: true }); }
        xluRuns++;
      }
    }
  }
  const resolved = resolveCoplanar(all, order);
  if (resolved.lifted || resolved.newDecals) levelInfo.coplanar = `${resolved.lifted} decal vertices lifted, ${resolved.newDecals} coplanar triangles made decals`;
  const roomBatches = new Map<number, { opa: Batch[]; xlu: Batch[] }>();
  resolved.batches.forEach((b, j) => {
    const o = owner[resolved.origin[j]];
    const rb = roomBatches.get(o.room) ?? roomBatches.set(o.room, { opa: [], xlu: [] }).get(o.room)!;
    (o.xlu ? rb.xlu : rb.opa).push(b);
  });
  for (const r of rooms) {
    if (!r?.header.mesh) continue;
    const { opa, xlu } = roomBatches.get(r.index) ?? { opa: [], xlu: [] };
    const roomInfo: DebugInfo = { ...levelInfo, room: r.index, roomRange: `${hex(r.start)}-${hex(r.start + r.data.length)}`, meshType: r.header.mesh.type, entries: r.header.mesh.entries.length, buffer: `scene 0x0, room ${r.index} ${hex(roomBase[r.index])}` };
    const covered = backdrop && r.header.mesh.type === 1;
    const visible = covered ? xlu : [...opa, ...xlu];
    if (visible.some((b) => b.positions.length)) place(`room ${r.index}`, 'main', meshOf(`room ${r.index}`, visible, roomInfo), `room ${r.index}`, roomInfo);
    if (covered && opa.some((b) => b.positions.length)) place('opaque room lists under the background', 'background', meshOf(`room ${r.index} (covered)`, opa, roomInfo), `room ${r.index} opaque`, roomInfo, false);
  }
  if (errors) levelInfo.listErrors = errors;

  // Actors: markers only (no object files in the ROM).
  const groupOf = (n: string) => (n.startsWith('En_') ? 'actors' : n.startsWith('Bg_') || n.startsWith('Obj_') ? 'props and set pieces' : n.startsWith('Door_') ? 'doors' : 'other actors');
  for (const r of rooms) {
    for (const e of r?.header.actors ?? []) {
      const { name: an, retail: rid } = alphaActorName(e.rawId);
      markers.push({
        label: `${an} ${hex(e.params)}`, position: e.pos, layer: layer(groupOf(an), 'markers', false),
        info: { actor: an, alphaId: hex(e.rawId), retailId: rid >= 0 ? hex(rid) : 'none (alpha only)', idMapping: 'derived (ZELDA64.md §11.5)', params: hex(e.params), room: r!.index, record: `room ${hex(r!.start + e.at)}`, rotation: e.rot.map(hex).join(' ') },
      });
    }
  }
  for (const tr of sh.transitions) {
    const { name: an, retail: rid } = alphaActorName(tr.rawId);
    markers.push({
      label: `${an} ${hex(tr.params)} rooms ${tr.frontRoom}/${tr.backRoom}`, position: tr.pos, layer: layer('transitions (doors, loading planes)', 'markers', false),
      info: { actor: an, alphaId: hex(tr.rawId), retailId: rid >= 0 ? hex(rid) : 'none', params: hex(tr.params), record: `scene ${hex(start + tr.at)}` },
    });
  }
  sh.spawns.forEach((sp, k) => {
    const pe = sh.playerEntries[sp.playerEntry];
    if (pe) markers.push({ label: `spawn ${k} (room ${sp.room})`, position: pe.pos, layer: layer('spawns', 'markers'), info: { spawn: k, room: sp.room, params: hex(pe.params) } });
  });

  if (collision) {
    const cInfo: DebugInfo = { ...levelInfo, polygons: collision.polys.length, waterBoxes: collision.waterBoxes.length, waterBoxSize: 12 };
    const groups = alphaCollisionGroups(collision, sceneData, sh.collision);
    for (const g of groups) {
      const sInfo = { ...cInfo, ...alphaSurfaceInfo(g.type, g.flagsA, g.flagsB, collision.surfaceTypes[g.type] ?? [0, 0], g.count) };
      const suffix = g.flagsA || g.flagsB ? ` flags ${hex(g.flagsA)}/${hex(g.flagsB)}` : '';
      place('collision', 'collision', meshOf(`collision surface ${g.type}${suffix}`, [g.batch], sInfo), `collision surface ${g.type}${suffix}`, sInfo, false);
    }
    const wb = waterBoxBatch(collision);
    if (wb) place('waterboxes', 'collision', meshOf('waterboxes', [wb], cInfo), 'waterboxes', cInfo, false);
  }

  // Start view from player entry 0 as the research renders frame it (§11.6): 260 units behind and 110 above the
  // player, looking 300 units ahead; the game's own camera logic for this build is lost.
  let camera = fixedCamera;
  if (!camera && player) {
    const a = (((player.rot[1] << 16) >> 16) / 0x8000) * Math.PI, fx = Math.sin(a), fz = Math.cos(a);
    const [px, py, pz] = player.pos;
    camera = { eye: [px - fx * 260, py + 110, pz - fz * 260], target: [px + fx * 300, py + 50, pz + fz * 300], fovY: 60 };
  }
  return buildLevel(info, `oot-alpha-${hex(id)}-${def.layer}`, textures, meshes, instances, {
    layers, markers, clearColor, ...(lightingPresets.length ? { lighting: { presets: lightingPresets.map((preset) => preset.name), default: defaultLighting } } : {}),
    ...(fog ? { fog } : {}), ...(camera ? { camera } : {}), ...(backdrop ? { backdrop } : {}),
  });
}

export function openZeldaAlpha(rom: Uint8Array): Game {
  const byId = new Map(SCENES.map((s) => [s[0], s]));
  const defs: AlphaDef[] = [];
  const levels: LevelInfo[] = [];
  for (const id of ORDER) {
    const s = byId.get(id)!;
    const push = (layer: number, name: string, setupName?: string, setupParent?: number) => {
      levels.push({ index: levels.length, name, kind: s[4], group: s[5], ...(setupParent !== undefined ? { setupParent } : {}) });
      defs.push({ scene: s, layer, setupName });
    };
    const main = levels.length;
    push(0, s[2] + (s[10] ? ' (sw97 name)' : ''), id === 0x09 ? 'Day' : undefined);
    const sceneData = rom.subarray(s[1], s[1] + 0x40000);
    // Alternate headers: only 0x09 has one (night).
    if (alternateHeaders(sceneData, 2)[0] != null) push(1, `${s[2]} (night)`, 'Night', main);
  }
  return {
    id: 'oot-alpha', title: 'Ocarina of Time (1997 prototype, F-Zero X cartridge)', levels,
    loadLevel: (i) => {
      const level = loadAlphaLevel(rom, defs[i], levels[i]);
      const options = defs.flatMap((def, k) => def.scene === defs[i].scene && def.setupName ? [{ name: def.setupName, level: k }] : []);
      if (options.length > 1) level.setups = { options, current: i };
      return level;
    },
  };
}

// The static table and the structural scan agree (a check for the test scripts).
export function checkAlphaTable(rom: Uint8Array): { table: number; scanned: number; mismatches: number[] } {
  const scanned = scanAlphaScenes(rom);
  const table = SCENES.map((s) => s[1]);
  return { table: table.length, scanned: scanned.length, mismatches: [...table.filter((a) => !scanned.includes(a)), ...scanned.filter((a) => !table.includes(a))] };
}
