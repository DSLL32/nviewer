// San Francisco Rush - Extreme Racing (U): ROM access and track loading.
//
// The boot segment (ROM 0x1000, loaded at 0x80000400) decompresses the main code
// image with LZSS from ROM 0x7A7930 to 0x8005BB10. Main code holds two tables of
// u32 ROM offsets of LZSS-compressed files: A at 0x800C7C38 (65 entries) and B at
// 0x800C7BA4 (only entries 30-36 used). For track n (1-7):
//   A[29+n]  model container (segment 5)      B[29+n]  placement
//   A[29]    shared track textures, loaded right after the model in segment 5
//   A[5]     shared objects: trees, cones... (segment 6)
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
import { normalizeByteOrder } from './rom';
import type { Fog, Game, Instance, Level, LevelInfo, Mesh, Texture } from './types';
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
  addContainer(segment5, TRACK_SEGMENT, 'track:', meshes, textures, textureKeys);
  const levelMeshCount = meshes.length;
  addContainer(rom.file('A', SHARED_OBJECTS), SHARED_SEGMENT, 'shared:', meshes, textures, textureKeys);

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
    instances.push({ name, mesh, matrix: placementMatrix(m) });
    if (mesh >= 0 && mesh < levelMeshCount) {
      for (let k = 0; k < 3; k++) {
        bounds.min[k] = Math.min(bounds.min[k], m[9 + k] - meshes[mesh].radius);
        bounds.max[k] = Math.max(bounds.max[k], m[9 + k] + meshes[mesh].radius);
      }
    }
  }

  const pruned = pruneUnused(meshes, textures, instances, levelMeshCount);
  return { info, id: cstr(place, 8, 16), instances, bounds, fog: RACE_FOG, ...pruned };
}

export function openRush1(bytes: Uint8Array): Game {
  const rom = new Rush1Rom(bytes);
  return {
    id: 'rush1',
    title: 'San Francisco Rush: Extreme Racing',
    levels: RUSH1_LEVELS,
    loadLevel: (index) => loadRush1Level(rom, index),
  };
}
