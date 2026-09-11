// Perfect Dark BG files bgdata/bg_<code>.seg: the world geometry as rooms (PERFECTDARK.md §4.2-§4.4, §4.9, §4.11).
//
// Container (read in parts by the game): +0 u32 primary inflated size P; +4 u32 S1 = bytes from +0x0C to section 2;
// +8 u32 primary stream length; +0x0C the primary data (a 1173 stream); then one 1173 stream per room, room r at
// 0x0C + [8] + (room pointer - 0x0F000000 - P). Section 2 at 0x0C + S1: {u16 0x8000 | size; u16 stream length} + a 1173
// stream of u16 texture numbers; section 3 likewise: per room 1..N-1 an s16 room-relative box (min, max), then u16 gfx
// sizes / 16, then u8 light counts.
// Primary data (segment 0x0F): +4 rooms {ptr gfx; f32 x, y, z; u8, u8; u16} (entry 0 unused; the entry after the last room
// holds only the end pointer), +8 portals, +0x0C visibility commands, +0x10 lights. Portals and commands decide which rooms
// the game can ever show (visibility.ts).
// Room gfx (linked at its room pointer): ptr vertices; ptr colours; ptr opaque blocks; ptr translucent blocks; s16 × 4; then
// 0x14-byte blocks {u8 type; ptr next; leaf (0): ptr DL, vertices (segment 14), colours (segment 13); parent (1): ptr
// child, split plane}. World position = room position + vertex.
import type { Batch, DebugInfo, Mesh } from '../types';
import { newDlStats, PdBatches, type PdDlStats, runPdDisplayList } from './gbi';
import { inflate1173 } from './rom';
import type { PdTextures } from './texture';

type Vec3 = [number, number, number];
const SEG = 0x0f000000;

/**
 * Sky rooms, by BG file: props the game draws first, without depth or fog, through a projection holding only the camera
 * rotation, at the plain room position (§4.9, notes/bg.md §2.7): Defection's moon (ame room 1), Skedar Ruins' gradient sky
 * (sho room 2), Attack Ship's planet (lee room 0x71), all verified in frames; lue room 0x0F by the decompilation's code.
 */
export const SKY_ROOMS: Record<string, number[]> = {
  'bgdata/bg_ame.seg': [1],
  'bgdata/bg_sho.seg': [2],
  'bgdata/bg_lee.seg': [0x71],
  'bgdata/bg_lue.seg': [0x0f],
};

export interface PdBgRoom {
  index: number;
  ptr: number; // link address of the room's gfx data (0x0F……)
  pos: Vec3;
  fileOffset: number; // of the room's 1173 stream
  bboxMin: Vec3; // section 3, absolute
  bboxMax: Vec3;
}

/** A portal between two rooms: a convex polygon in world units (§4.3). */
export interface PdPortal {
  index: number;
  rooms: [number, number];
  flags: number; // 0 in every retail BG
  points: Vec3[];
}

/** A visibility command (§4.3): u8 type; u8 len; u16 0; s32 param. Types ≥ 100 are the arguments of the command before. */
export interface PdBgCommand {
  type: number;
  len: number;
  param: number;
}

export interface PdBg {
  file: Uint8Array;
  rooms: PdBgRoom[]; // rooms[0] is the unused room 0, so indices are room numbers
  textureNumbers: number[]; // section 2
  portals: PdPortal[];
  commands: PdBgCommand[]; // up to and including END (type 0)
}

/** 0x200-byte BG files are stubs with one trivial room. */
export const isStubBg = (size: number) => size <= 0x200;

export function parseBg(file: Uint8Array): PdBg {
  const fv = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const primarySize = fv.getUint32(0), section1Len = fv.getUint32(4), primaryStreamLen = fv.getUint32(8);
  const primary = inflate1173(file, 12);
  const pv = new DataView(primary.buffer, primary.byteOffset, primary.byteLength);
  const roomTable = pv.getUint32(4) - SEG;
  const ptrs: number[] = [];
  for (let i = 0; roomTable + (i + 1) * 0x14 <= primary.length; i++) {
    const p = pv.getUint32(roomTable + i * 0x14);
    if (i > 0 && p === 0) break;
    ptrs.push(p);
  }
  const roomCount = ptrs.length - 1; // ptrs[roomCount] is the end marker
  const section2 = 12 + section1Len;
  const sec2 = inflate1173(file, section2 + 4);
  const textureNumbers: number[] = [];
  for (let i = 0; i + 1 < sec2.length; i += 2) textureNumbers.push((sec2[i] << 8) | sec2[i + 1]);
  const sec3 = inflate1173(file, section2 + 4 + fv.getUint16(section2 + 2) + 4);
  const s3 = new DataView(sec3.buffer, sec3.byteOffset, sec3.byteLength);
  const rooms: PdBgRoom[] = [];
  for (let r = 0; r < roomCount; r++) {
    const o = roomTable + r * 0x14;
    const pos: Vec3 = [pv.getFloat32(o + 4), pv.getFloat32(o + 8), pv.getFloat32(o + 12)];
    const b = (r - 1) * 12;
    const box = (k: number): Vec3 => (r > 0 && b + k + 6 <= sec3.length ? [s3.getInt16(b + k) + pos[0], s3.getInt16(b + k + 2) + pos[1], s3.getInt16(b + k + 4) + pos[2]] : [...pos]);
    rooms.push({ index: r, ptr: ptrs[r], pos, fileOffset: r > 0 ? 12 + primaryStreamLen + (ptrs[r] - SEG - primarySize) : -1, bboxMin: box(0), bboxMax: box(6) });
  }
  // Portals: {u16 1-based vertex list; s16 room, room; u8 flags; u8} until a zero list number, then the vertex lists
  // {u8 count; 3 × u8; count × f32 x, y, z} until a zero count.
  const portals: PdPortal[] = [];
  const portalTable = pv.getUint32(8) ? pv.getUint32(8) - SEG : -1;
  if (portalTable >= 0) {
    const refs: number[] = [];
    for (let o = portalTable; o + 8 <= primary.length && pv.getUint16(o) !== 0; o += 8) {
      refs.push(pv.getUint16(o));
      portals.push({ index: portals.length, rooms: [pv.getInt16(o + 2), pv.getInt16(o + 4)], flags: primary[o + 6], points: [] });
    }
    const lists: Vec3[][] = [];
    for (let o = portalTable + (portals.length + 1) * 8; o < primary.length && primary[o] > 0; o += 4 + primary[o] * 12) {
      const list: Vec3[] = [];
      for (let k = 0; k < primary[o] && o + 16 + k * 12 <= primary.length; k++) list.push([pv.getFloat32(o + 4 + k * 12), pv.getFloat32(o + 8 + k * 12), pv.getFloat32(o + 12 + k * 12)]);
      lists.push(list);
    }
    portals.forEach((p, i) => { p.points = lists[refs[i] - 1] ?? []; });
  }
  const commands: PdBgCommand[] = [];
  if (pv.getUint32(12)) {
    for (let o = pv.getUint32(12) - SEG; o >= 0 && o + 8 <= primary.length; o += 8) {
      commands.push({ type: primary[o], len: primary[o + 1], param: pv.getInt32(o + 4) });
      if (primary[o] === 0) break;
    }
  }
  return { file, rooms, textureNumbers, portals, commands };
}

interface Leaf {
  gdl: number; // link addresses
  vertices: number;
  colours: number;
}

/** A room's inflated gfx data and its leaf blocks in draw order (opaque list, then translucent list). */
export function roomLeaves(bg: PdBg, index: number): { data: Uint8Array; leaves: Leaf[] } {
  const room = bg.rooms[index];
  const data = inflate1173(bg.file, room.fileOffset);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const leaves: Leaf[] = [];
  const seen = new Set<number>();
  const walk = (addr: number, depth: number) => {
    for (let guard = 0; addr && guard < 10000; guard++) {
      const o = addr - room.ptr;
      if (o < 0 || o + 0x14 > data.length || seen.has(addr)) throw new Error(`Perfect Dark: room ${index} block 0x${addr.toString(16)} is outside its data`);
      seen.add(addr);
      const type = data[o];
      if (type === 0) leaves.push({ gdl: dv.getUint32(o + 8), vertices: dv.getUint32(o + 12), colours: dv.getUint32(o + 16) });
      else if (type === 1 && depth < 64) walk(dv.getUint32(o + 8), depth + 1);
      else if (type !== 1) throw new Error(`Perfect Dark: room ${index} block type ${type}`);
      addr = dv.getUint32(o + 4);
    }
  };
  walk(dv.getUint32(8), 0);
  walk(dv.getUint32(12), 0);
  return { data, leaves };
}

export interface RoomBatches {
  room: PdBgRoom;
  batches: Batch[];
  leaves: number;
  leafOffsets: number[]; // each leaf's display list in the inflated stream, in draw order (opaque list, then translucent)
  triangles: number;
  stats: PdDlStats;
}

/** A room's display lists as batches; positions = vertex + offset (default: room-local). */
export function roomBatches(bg: PdBg, index: number, textures: PdTextures, opts: { envAlpha?: boolean; offset?: Vec3 } = {}): RoomBatches {
  const room = bg.rooms[index];
  const { data, leaves } = roomLeaves(bg, index);
  const out = new PdBatches();
  const stats = newDlStats();
  for (const leaf of leaves) {
    if (!leaf.gdl) continue;
    const resolve = (addr: number) => {
      const seg = addr >>> 24, off = addr & 0xffffff;
      const o = seg === 0x0e ? leaf.vertices - room.ptr + off : seg === 0x0d ? leaf.colours - room.ptr + off : seg === 0x0f ? addr - room.ptr : -1;
      return o >= 0 && o < data.length ? o : -1;
    };
    runPdDisplayList({ buf: data, resolve, textures, keyPrefix: `room ${index} `, envAlpha: opts.envAlpha, offset: opts.offset, stats }, leaf.gdl, out);
  }
  return { room, batches: out.batches(), leaves: leaves.length, leafOffsets: leaves.map((leaf) => leaf.gdl - room.ptr), triangles: stats.triangles, stats };
}

export interface RoomMesh {
  room: PdBgRoom;
  mesh: Mesh;
  // Place the mesh with this translation (the centre of the room's box, so the renderer's back-to-front sort of translucent
  // batches orders rooms). Sky rooms: [0, 0, 0], positions are camera-relative.
  center: Vec3;
  sky: boolean;
  triangles: number;
  leafOffsets: number[]; // RoomBatches.leafOffsets: the draw order of triSource offsets
}

/** Every room with geometry as a mesh; `bgName` selects the sky rooms (SKY_ROOMS). */
export function buildRooms(bg: PdBg, bgName: string, textures: PdTextures, opts: { envAlpha?: boolean } = {}): RoomMesh[] {
  const skyRooms = new Set(SKY_ROOMS[bgName] ?? []);
  const hex = (v: number) => `0x${v.toString(16)}`;
  const out: RoomMesh[] = [];
  for (const room of bg.rooms) {
    if (room.index === 0) continue;
    const sky = skyRooms.has(room.index);
    const center: Vec3 = sky ? [0, 0, 0] : [0, 1, 2].map((k) => (room.bboxMin[k] + room.bboxMax[k]) / 2) as Vec3;
    const offset: Vec3 = sky ? room.pos : [room.pos[0] - center[0], room.pos[1] - center[1], room.pos[2] - center[2]];
    const r = roomBatches(bg, room.index, textures, { envAlpha: opts.envAlpha, offset });
    if (!r.triangles) continue;
    let radius = 0;
    for (const b of r.batches) for (let k = 0; k < b.positions.length; k += 3) radius = Math.max(radius, Math.hypot(b.positions[k], b.positions[k + 1], b.positions[k + 2]));
    const info: DebugInfo = {
      room: room.index, bg: bgName, position: room.pos.map((v) => +v.toFixed(2)).join(', '), roomStream: `file ${hex(room.fileOffset)}`,
      linkAddress: hex(room.ptr), leaves: r.leaves, triangles: r.triangles,
      textures: [...r.stats.textures].sort((a, b) => a - b).map(hex).join(' '),
      triSource: `offset in the inflated room stream (linked at ${hex(room.ptr)})`,
      ...(sky ? { sky: 'sky room: drawn first around the camera, without depth or fog' } : {}),
    };
    out.push({ room, mesh: { name: sky ? `sky room ${room.index}` : `room ${room.index}`, radius, batches: r.batches, info }, center, sky, triangles: r.triangles, leafOffsets: r.leafOffsets });
  }
  return out;
}
