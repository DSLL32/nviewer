// GoldenEye BG files bg/bg_<code>_all_p.seg: the world geometry as rooms (GOLDENEYE.md §3.1-§3.5).
//
// Stored raw; pointers are segment 0x0F, file-relative. Header: +0 0; +4 rooms; +8 portals; +C visibility commands.
// Room entries (0x18 bytes, from +0x14): {vertices; primary DL; secondary DL or 0; f32 x, y, z}, each a 1172 stream;
// entry 0 is empty and the last entry is a sentinel. Vertices (N64 Vtx) are relative to the room position, and the
// lists address them as segment 0x0E. Primary lists draw in the opaque pass, secondary lists after every primary.
import { mergeBatches } from '../bomberman/common';
import { runDisplayList } from '../displaylist';
import type { Batch, DebugInfo, Mesh } from '../types';
import { inflate1172 } from './rom';
import type { GeTextures } from './textures';

type Vec3 = [number, number, number];
const SEG = 0x0f000000;

export interface BgRoom {
  index: number; // room number
  pos: Vec3; // BG units
  vertices: number; // file offsets of the compressed streams
  primary: number;
  secondary: number; // 0: none
}

export interface BgPortal {
  index: number;
  roomA: number;
  roomB: number;
  flags: number;
  points: Vec3[]; // BG units, absolute
}

export interface BgFile {
  data: Uint8Array;
  rooms: BgRoom[]; // rooms[0] is the empty entry 0, so indices are room numbers
  portals: BgPortal[];
  visibility: number; // file offset of the visibility commands (not decoded)
}

export function parseBg(data: Uint8Array): BgFile {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const ptr = (o: number) => {
    const p = dv.getUint32(o);
    if (p !== 0 && (p & 0xff000000) !== SEG) throw new Error(`BG pointer 0x${p.toString(16)} at 0x${o.toString(16)} is not in segment 0x0F`);
    return p ? p - SEG : 0;
  };
  const roomTable = ptr(4), portalTable = ptr(8);
  // The sentinel is the last entry whose successor starts with a zero word.
  let n = 1;
  while (roomTable + 0x18 * (n + 2) <= data.length && dv.getUint32(roomTable + 0x18 * (n + 1)) !== 0) n++;
  const rooms: BgRoom[] = [];
  for (let i = 0; i < n; i++) {
    const e = roomTable + 0x18 * i;
    rooms.push({ index: i, pos: [dv.getFloat32(e + 12), dv.getFloat32(e + 16), dv.getFloat32(e + 20)], vertices: ptr(e), primary: ptr(e + 4), secondary: ptr(e + 8) });
  }
  // Portals: {polygon; u8 roomA; u8 roomB; u16 flags} until a zero pointer; polygon {u8 n; 3 pad; n × f32 x, y, z}.
  const portals: BgPortal[] = [];
  for (let o = portalTable; portalTable && o + 8 <= data.length && dv.getUint32(o) !== 0; o += 8) {
    const poly = ptr(o), points: Vec3[] = [];
    for (let k = 0; k < data[poly]; k++) points.push([dv.getFloat32(poly + 4 + 12 * k), dv.getFloat32(poly + 8 + 12 * k), dv.getFloat32(poly + 12 + 12 * k)]);
    portals.push({ index: portals.length, roomA: data[o + 4], roomB: data[o + 5], flags: dv.getUint16(o + 6), points });
  }
  return { data, rooms, portals, visibility: ptr(12) };
}

// Swaps the last two vertices of every triangle: the game's front faces wind clockwise on screen (§3.7).
function reverseWinding(b: Batch) {
  const swap = (a: Float32Array | Uint8Array, k: number) => {
    for (let t = 0; t + 3 * k <= a.length; t += 3 * k) {
      for (let j = 0; j < k; j++) {
        const x = a[t + k + j];
        a[t + k + j] = a[t + 2 * k + j];
        a[t + 2 * k + j] = x;
      }
    }
  };
  swap(b.positions, 3);
  swap(b.uvs, 2);
  swap(b.colors, 4);
}

export interface RoomGeometry {
  // Depth-tested geometry, primary batches then secondary ones.
  mesh: Mesh | null;
  // Batches the lists draw without a depth test (e.g. Dam room 5's backdrop, render mode 0C182048): the game draws
  // them in room order, where they paint over nearer rooms, so the viewer draws them before all other rooms.
  backdrop: Mesh | null;
  triangles: number;
  vertices: number;
}

/**
 * One room as world-unit meshes (BG units / scale, room position baked in). BG is drawn double-sided (§3.5): some
 * visible triangles wind the other way, so cullBack is cleared on every batch. triSource is an offset into the room
 * buffer described by Mesh.info.
 */
export function buildRoom(bg: BgFile, index: number, textures: GeTextures, scale: number): RoomGeometry {
  const room = bg.rooms[index];
  const primary = inflate1172(bg.data, room.primary);
  const secondary = room.secondary ? inflate1172(bg.data, room.secondary) : null;
  const verts = inflate1172(bg.data, room.vertices);
  const align = (n: number) => (n + 7) & ~7;
  const secondaryAt = align(primary.length), vertexAt = align(secondaryAt + (secondary?.length ?? 0));
  const buf = new Uint8Array(vertexAt + verts.length);
  buf.set(primary);
  if (secondary) buf.set(secondary, secondaryAt);
  buf.set(verts, vertexAt);
  const resolve = (addr: number) => {
    const seg = addr >>> 24, o = addr & 0xffffff;
    if (seg === 0x0e) return vertexAt + o < buf.length ? vertexAt + o : -1;
    return seg === 0 && o < vertexAt ? o : -1;
  };
  const run = (start: number) => runDisplayList({
    buf, ucode: 'f3d', resolve, textures: textures.textures, textureKeys: new Map(), keyPrefix: '', rareTexture: textures.rareTexture,
    vertexScale: 1 / scale, vertexOffset: room.pos, mirrorX: false, decals: true,
  }, start);
  const batches = [...run(0), ...(secondary ? run(secondaryAt) : [])];
  for (const b of batches) {
    reverseWinding(b);
    b.cullBack = false;
  }
  const hex = (v: number) => `0x${v.toString(16)}`;
  const info: DebugInfo = {
    room: index, position: room.pos.map((v) => +v.toFixed(2)).join(', '), vertices: hex(room.vertices), primaryDL: hex(room.primary),
    ...(room.secondary ? { secondaryDL: hex(room.secondary) } : {}),
    triSource: `offset in the inflated room: primary DL at 0${secondary ? `, secondary DL at ${hex(secondaryAt)}` : ''}, vertices at ${hex(vertexAt)}`,
  };
  const mesh = (name: string, list: Batch[]): Mesh | null => {
    const merged = mergeBatches(list);
    if (!merged.length) return null;
    let radius = 0;
    for (const b of merged) for (let k = 0; k < b.positions.length; k += 3) radius = Math.max(radius, Math.hypot(b.positions[k], b.positions[k + 1], b.positions[k + 2]));
    return { name, radius, batches: merged, info };
  };
  const isBackdrop = (b: Batch) => !b.depthTest && b.blend !== 'blend';
  return {
    mesh: mesh(`room ${index}`, batches.filter((b) => !isBackdrop(b))),
    backdrop: mesh(`room ${index} backdrop`, batches.filter(isBackdrop)),
    triangles: batches.reduce((s, b) => s + b.positions.length / 9, 0),
    vertices: verts.length / 16,
  };
}
