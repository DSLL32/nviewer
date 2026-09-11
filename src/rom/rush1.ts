// San Francisco Rush - Extreme Racing (U): ROM access and track loading.
//
// The boot segment (ROM 0x1000, loaded at 0x80000400) decompresses the main code
// image with LZSS from ROM 0x7A7930 to 0x8005BB10. Main code holds two tables of
// u32 ROM offsets of LZSS-compressed files: A at 0x800C7C38 (65 entries) and B at
// 0x800C7BA4 (only entries 30-36 used). For track n (1-7):
//   A[29+n]  model container (segment 5)      B[29+n]  placement
//   A[29]    shared track textures, loaded right after the model in segment 5
//   A[5]     shared objects: trees, cones... (segment 6)
//   A[36+n]  collision polygons (rushcollision.ts)
//
// Model container: header of segment pointers. u32 +0 -> name table (24 bytes per
// object: name, radius, flags), u32 +4 object count, +0x10/+0x18 texture and palette
// tables; object records (52 bytes, display list at +12) follow the header at 0x20.
// Display lists are F3DEX 1.x; all addresses are segmented.
//
// Placement: u32 version, u32 0x18, level name at +8, then 100-byte instances from
// 0x18: name, 3x3 matrix, translation, flags, next-sibling and first-child indices,
// bounds. Children are positioned relative to their parent.
import { runDisplayList } from './displaylist';
import { lzssRingDecode } from './lzss';
import { decodeRush1Music, listRush1Music } from './music/rush1';
import { normalizeByteOrder } from './rom';
import { appendCollisionLayers, parseRushCollision } from './rushcollision';
import { decodeTexture, ImFmt, ImSiz, loadBlock, Tlut, TMEM_SIZE } from './texture';
import type { Fog, Game, Instance, Level, LevelInfo, LevelLayer, Mesh, Sky, Texture } from './types';
import { cstr, emptyBounds, mirrorPlacementX, placementMatrix, pruneUnused, view } from './util';

const MAIN_ROM = 0x7a7930;
const MAIN_VADDR = 0x8005bb10;
const TABLE_A = 0x800c7c38;
const TABLE_A_COUNT = 65;
const TABLE_B = 0x800c7ba4;

const TRACK_MODEL_BASE = 29; // A[29 + n]
const TRACK_PLACEMENT_BASE = 29; // B[29 + n]
const SHARED_OBJECTS = 5; // A[5]
const SHARED_TEXTURES = 29; // A[29]
const TRACK_COLLISION_BASE = 36; // A[36 + n]
const TRACK_SEGMENT = 5;
const SHARED_SEGMENT = 6;

// Race fog, read from the frame display list in RAM during races on tracks 1 and 2
// (identical): G_SETFOGCOLOR 0x9696BEFF and gSPFogFactor(32000, -31744), i.e. fog
// position 996..1000. The projection is guPerspective with near 40 and far 32040 in
// vertex units (16 per world unit), so fog starts about 480 world units away and is
// complete at about 1980, just before the far plane.
const RACE_FOG: Fog = { color: [150, 150, 190], multiplier: 32000, offset: -31744, near: 40 / 16, far: 32040 / 16 };

export const RUSH1_LEVELS: LevelInfo[] = [1, 2, 3, 4, 5, 6, 7].map((n, index) => ({
  index,
  name: n === 7 ? 'Track 7 (hidden)' : `Track ${n}`,
  kind: 'race' as const,
}));

export class Rush1Rom {
  readonly bytes: Uint8Array;
  readonly main: Uint8Array;
  private offsetsA: number[] = [];
  private offsetsB: number[] = [];
  private cache = new Map<string, Uint8Array>();

  constructor(bytes: Uint8Array) {
    this.bytes = normalizeByteOrder(bytes);
    const id = String.fromCharCode(...this.bytes.subarray(0x3b, 0x3f));
    if (id !== 'NSFE') throw new Error(`Not San Francisco Rush (U): game code "${id}"`);
    this.main = lzssRingDecode(this.bytes, MAIN_ROM);
    const dv = view(this.main);
    for (let i = 0; i < TABLE_A_COUNT; i++) this.offsetsA.push(dv.getUint32(TABLE_A - MAIN_VADDR + i * 4));
    for (let i = 0; i < 37; i++) this.offsetsB.push(dv.getUint32(TABLE_B - MAIN_VADDR + i * 4));
  }

  file(table: 'A' | 'B', index: number): Uint8Array {
    const key = `${table}${index}`;
    let data = this.cache.get(key);
    if (!data) {
      const offset = (table === 'A' ? this.offsetsA : this.offsetsB)[index];
      if (!offset) throw new Error(`File ${key} does not exist`);
      data = lzssRingDecode(this.bytes, offset);
      this.cache.set(key, data);
    }
    return data;
  }
}

function addContainer(
  buf: Uint8Array, segment: number, keyPrefix: string, meshes: Mesh[], textures: Texture[], textureKeys: Map<string, number>,
  file: string, triSource: string,
) {
  const dv = view(buf);
  const names = dv.getUint32(0) & 0xffffff;
  const count = dv.getUint32(4);
  const ctx = {
    buf, ucode: 'f3dex' as const, textures, textureKeys, keyPrefix,
    // Double-sided faces are modelled as reversed-winding twins, so the game culls back faces.
    cullBackByDefault: true,
    resolve: (addr: number) => (addr >>> 24 === segment && (addr & 0xffffff) < buf.length ? addr & 0xffffff : -1),
  };
  for (let i = 0; i < count; i++) {
    meshes.push({
      name: cstr(buf, names + i * 24, 16),
      radius: dv.getFloat32(names + i * 24 + 16),
      batches: runDisplayList(ctx, dv.getUint32(0x20 + i * 52 + 12)),
      info: { file, object: i, record: `0x${(0x20 + i * 52).toString(16)}`, triSource },
    });
  }
}

export function loadRush1Level(rom: Rush1Rom, index: number): Level {
  const info = RUSH1_LEVELS[index];
  const n = index + 1;
  const meshes: Mesh[] = [];
  const textures: Texture[] = [];
  const textureKeys = new Map<string, number>();
  // Segment 5 is the heap the race loads into: the track file, then (16-byte aligned)
  // the shared texture file A[29], which the track's display lists address past the
  // end of the track file.
  const model = rom.file('A', TRACK_MODEL_BASE + n);
  const shared = rom.file('A', SHARED_TEXTURES);
  const segment5 = new Uint8Array(((model.length + 15) & ~15) + shared.length);
  segment5.set(model);
  segment5.set(shared, (model.length + 15) & ~15);
  addContainer(segment5, TRACK_SEGMENT, 'track:', meshes, textures, textureKeys, `A${TRACK_MODEL_BASE + n}`,
    `offset in segment 5: file A${TRACK_MODEL_BASE + n} (decompressed), then A${SHARED_TEXTURES} from 0x${((model.length + 15) & ~15).toString(16)}`);
  const levelMeshCount = meshes.length;
  addContainer(rom.file('A', SHARED_OBJECTS), SHARED_SEGMENT, 'shared:', meshes, textures, textureKeys, `A${SHARED_OBJECTS}`,
    `offset in file A${SHARED_OBJECTS} (decompressed)`);

  const byName = new Map<string, number>();
  meshes.forEach((m, i) => { if (!byName.has(m.name)) byName.set(m.name, i); });

  const place = rom.file('B', TRACK_PLACEMENT_BASE + n);
  const pdv = view(place);
  const count = Math.floor((place.length - 0x18) / 100);
  const entry = (i: number) => 0x18 + i * 100;

  // Entries form a tree: +68 next sibling, +70 first child (entry indices, -1 = none).
  // A child's translation is relative to its parent's (the game adds the parent
  // entry's stored translation, placement function @ 0x800829E4).
  const parent = new Int32Array(count).fill(-1);
  const visited = new Uint8Array(count);
  const walk = (first: number, parentIndex: number) => {
    for (let i = first; i >= 0 && i < count && !visited[i]; i = pdv.getInt16(entry(i) + 68)) {
      visited[i] = 1;
      parent[i] = parentIndex;
      walk(pdv.getInt16(entry(i) + 70), i);
    }
  };
  walk(0, -1);

  const instances: Instance[] = [];
  const bounds = emptyBounds();
  for (let i = 0; i < count; i++) {
    const o = entry(i);
    const name = cstr(place, o, 16);
    const m = Array.from({ length: 12 }, (_, k) => pdv.getFloat32(o + 16 + k * 4));
    if (parent[i] >= 0) for (let k = 0; k < 3; k++) m[9 + k] += pdv.getFloat32(entry(parent[i]) + 52 + k * 4);
    mirrorPlacementX(m);
    const mesh = byName.get(name) ?? -1;
    instances.push({ name, mesh, matrix: placementMatrix(m), info: { file: `B${TRACK_PLACEMENT_BASE + n}`, instance: i, record: `0x${o.toString(16)}`, parent: parent[i] } });
    if (mesh >= 0 && mesh < levelMeshCount) {
      for (let k = 0; k < 3; k++) {
        bounds.min[k] = Math.min(bounds.min[k], m[9 + k] - meshes[mesh].radius);
        bounds.max[k] = Math.max(bounds.max[k], m[9 + k] + meshes[mesh].radius);
      }
    }
  }

  // Layers: the track container's pieces and the shared objects. Collision (hidden) goes last.
  const track: LevelLayer = { name: 'track', kind: 'main', instances: [] };
  const objects: LevelLayer = { name: 'objects', kind: 'objects', instances: [] };
  instances.forEach((inst, i) => (inst.mesh >= 0 && inst.mesh < levelMeshCount ? track : objects).instances.push(i));

  const pruned = pruneUnused(meshes, textures, instances, levelMeshCount);
  const skies = buildSkies(rom, pruned.meshes, pruned.textures);
  const level: Level = {
    info, id: cstr(place, 8, 16), instances, bounds, fog: RACE_FOG, skies, layers: [track, objects].filter((l) => l.instances.length), ...pruned,
  };
  // The race loads A[44 + n] instead when the byte at 0x800EA13E is set (0x800AA340): nearly the same polygons.
  appendCollisionLayers(level, parseRushCollision(rom.file('A', TRACK_COLLISION_BASE + n), 'rush1'), `A${TRACK_COLLISION_BASE + n}`);
  return level;
}

// The race sky is not level data. Game code (@ 0x800A7494) builds a dome around the camera
// from tables in main code and textures it with SKY01 or SKYFOUR from A[5], picked at
// random per race. 25 vertices (centre and three rings of 8): positions at 0x800C7D88
// (x, y, z floats, vertex units), texture coordinates at 0x800C7EB4 (u, v; 512 texture
// units each), alpha at 0x800C7F7C (fading to 0 at the horizon); 24 polygons at
// 0x800C7F98 (4 vertex indices, 0xFF for triangles, 0xFFFFFFFF ends). Drawn blended,
// without depth or fog.
const SKY_VERTICES = 0x800c7d88;
const SKY_UVS = 0x800c7eb4;
const SKY_ALPHA = 0x800c7f7c;
const SKY_POLYGONS = 0x800c7f98;
const SKY_TEXTURES = ['SKY01', 'SKYFOUR'];

function buildSkies(rom: Rush1Rom, meshes: Mesh[], textures: Texture[]): Sky[] {
  const main = view(rom.main);
  const at = (addr: number) => addr - MAIN_VADDR;
  const tris: number[][] = [];
  const triRecords: number[] = []; // Batch.triSource: polygon record offsets in main code
  for (let o = at(SKY_POLYGONS); rom.main[o] !== 0xff; o += 4) {
    const [a, b, c, d] = rom.main.subarray(o, o + 4);
    tris.push([a, b, c]);
    triRecords.push(o);
    if (d !== 0xff) {
      tris.push([a, c, d]);
      triRecords.push(o);
    }
  }

  // A[5] texture table (+0x10: 32-byte entries of name, width, height, format, ..., image
  // pointer, palette index) and palette table (+0x18: 24-byte entries, pointer at +20).
  const shared = rom.file('A', SHARED_OBJECTS);
  const sdv = view(shared);
  const texTable = sdv.getUint32(0x10) & 0xffffff;
  const texCount = sdv.getUint32(0x14);
  const palTable = sdv.getUint32(0x18) & 0xffffff;

  const skies: Sky[] = [];
  for (const name of SKY_TEXTURES) {
    let e = -1;
    for (let i = 0; i < texCount && e < 0; i++) if (cstr(shared, texTable + i * 32, 16) === name) e = texTable + i * 32;
    if (e < 0) continue;
    const width = sdv.getUint16(e + 16);
    const height = sdv.getUint16(e + 18);
    const image = sdv.getUint32(e + 24) & 0xffffff;
    const palette = sdv.getUint32(palTable + sdv.getUint16(e + 28) * 24 + 20) & 0xffffff;
    // CI4 with an RGBA16 palette. The game's block load advances its row counter once per
    // texel row, so the odd-row swaps cancel out.
    const line = width / 2;
    const mem = new Uint8Array(TMEM_SIZE);
    loadBlock(mem, shared, image, line * height, 0, 16384 / line, ImSiz.B16);
    const rgba = decodeTexture({
      fmt: ImFmt.CI, siz: ImSiz.B4, width, height, mem, tmem: 0, line,
      palette: shared.subarray(palette, palette + 32), tlut: Tlut.Rgba16,
    });
    const texture = textures.push({ width, height, rgba, wrapS: 'repeat', wrapT: 'repeat', format: 'CI4/RGBA16' }) - 1;

    const positions: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    let radius = 0;
    for (const tri of tris) {
      for (const i of tri) {
        const [x, y, z] = [0, 1, 2].map((k) => main.getFloat32(at(SKY_VERTICES) + (i * 3 + k) * 4) / 16);
        positions.push(-x, y, z); // mirrored like the level
        radius = Math.max(radius, Math.hypot(x, y, z));
        uvs.push((main.getFloat32(at(SKY_UVS) + i * 8) * 16) / width, (main.getFloat32(at(SKY_UVS) + i * 8 + 4) * 16) / height);
        colors.push(255, 255, 255, rom.main[at(SKY_ALPHA) + i]);
      }
    }
    const mesh = meshes.push({
      name,
      radius,
      batches: [{
        texture, blend: 'blend', depthTest: false, depthWrite: false, cullBack: false,
        positions: new Float32Array(positions), uvs: new Float32Array(uvs), colors: new Uint8Array(colors),
        triSource: new Uint32Array(triRecords),
      }],
      info: { file: `A${SHARED_OBJECTS}`, texture: `0x${e.toString(16)}`, triSource: `offset in the main code image (RAM 0x${MAIN_VADDR.toString(16)} + offset): polygon record` },
    }) - 1;
    skies.push({ name, mesh });
  }
  return skies;
}

export function openRush1(bytes: Uint8Array): Game {
  const rom = new Rush1Rom(bytes);
  return {
    id: 'rush1',
    title: 'San Francisco Rush: Extreme Racing',
    levels: RUSH1_LEVELS,
    loadLevel: (index) => loadRush1Level(rom, index),
    music: listRush1Music(rom),
    decodeMusic: (index) => decodeRush1Music(rom, index),
  };
}
