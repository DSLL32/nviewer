// Scene and room files (docs/OCARINA_OF_TIME.md and docs/MAJORAS_MASK.md): header commands, alternate headers, light settings, mesh
// headers, collision and the actor, transition, spawn and object lists. Scene pointers are segment 2, room pointers
// segment 3; every parser works on one file's bytes.
import type { ZeldaGame } from './tables';

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const s16 = (b: Uint8Array, o: number) => (u16(b, o) << 16) >> 16;
const s8 = (b: Uint8Array, o: number) => (b[o] << 24) >> 24;
export { s16, u16, u32 };

export interface Cmd { code: number; d1: number; d2: number; off: number }

// 8-byte commands {u8 code, u8 data1, u16, u32 data2} ending with 0x14 (at most 64).
export function parseHeader(b: Uint8Array, off: number): Cmd[] | null {
  const out: Cmd[] = [];
  for (let i = 0; i < 64; i++) {
    const q = off + i * 8;
    if (q < 0 || q + 8 > b.length || b[q] > 0x1f) return null;
    out.push({ code: b[q], d1: b[q + 1], d2: u32(b, q + 4), off: q });
    if (b[q] === 0x14) return out;
  }
  return null;
}

// Offset of a segment pointer inside this file, -1 if it points elsewhere.
export const segOffset = (p: number, seg: number, len: number) => (p >>> 24 === seg && (p & 0xffffff) < len ? p & 0xffffff : -1);

// The alternate header list (command 0x18): header offsets per slot (slot k = layer k + 1), null for empty slots.
// The list has no length: read while the words are 0 or pointers to parsable headers.
export function alternateHeaders(b: Uint8Array, seg: number): (number | null)[] {
  const main = parseHeader(b, 0);
  const alt = main?.find((c) => c.code === 0x18);
  if (!alt) return [];
  const list = segOffset(alt.d2, seg, b.length);
  if (list < 0) return [];
  const out: (number | null)[] = [];
  for (let k = 0; k < 32 && list + 4 * (k + 1) <= b.length; k++) {
    const p = u32(b, list + 4 * k);
    if (p === 0) {
      out.push(null);
      continue;
    }
    const h = segOffset(p, seg, b.length);
    if (h < 0 || !parseHeader(b, h)) break;
    out.push(h);
  }
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
}

// The commands a layer runs (z_scene.c Scene_CommandAlternateHeaderList): layer 0 the main header; layer n the
// alternate header n - 1 if set (OoT adult night falls back to adult day), else the main header.
export function headerForLayer(b: Uint8Array, seg: number, layer: number, game: ZeldaGame): { cmds: Cmd[]; used: number } {
  const main = parseHeader(b, 0);
  if (!main) throw new Error('bad scene/room header');
  if (layer === 0) return { cmds: main, used: 0 };
  const alts = alternateHeaders(b, seg);
  const pick = (n: number) => (alts[n - 1] != null ? parseHeader(b, alts[n - 1]!) : null);
  let h = pick(layer);
  if (h) return { cmds: h, used: layer };
  if (game === 'oot' && layer === 3) {
    h = pick(2);
    if (h) return { cmds: h, used: 2 };
  }
  return { cmds: main, used: 0 };
}

export interface LightSetting {
  ambient: number[]; l1Dir: number[]; l1Color: number[]; l2Dir: number[]; l2Color: number[]; fogColor: number[];
  fogNear: number; zFar: number;
}

// EnvLightSettings (0x16 bytes): ambient, light 1 dir/colour, light 2 dir/colour, fog colour, blend rate << 10 | fog
// near, zFar.
export function parseLightSettings(b: Uint8Array, cmd: Cmd, seg = 2): LightSetting[] {
  const o = segOffset(cmd.d2, seg, b.length);
  const out: LightSetting[] = [];
  for (let k = 0; o >= 0 && k < cmd.d1 && o + (k + 1) * 0x16 <= b.length; k++) {
    const e = o + k * 0x16;
    out.push({
      ambient: [b[e], b[e + 1], b[e + 2]], l1Dir: [s8(b, e + 3), s8(b, e + 4), s8(b, e + 5)], l1Color: [b[e + 6], b[e + 7], b[e + 8]],
      l2Dir: [s8(b, e + 9), s8(b, e + 10), s8(b, e + 11)], l2Color: [b[e + 12], b[e + 13], b[e + 14]],
      fogColor: [b[e + 15], b[e + 16], b[e + 17]], fogNear: u16(b, e + 0x12) & 0x3ff, zFar: s16(b, e + 0x14),
    });
  }
  return out;
}

export interface MeshEntry { opa: number; xlu: number; center?: [number, number, number]; radius?: number }
export interface BgImage { bgCamIndex: number; source: number; width: number; height: number; fmt: number; siz: number }
export interface RoomMesh { type: number; entries: MeshEntry[]; images: BgImage[] }

// Mesh header (command 0x0A): type 0 {n, entries, end} with 8-byte {opa, xlu}; type 1 prerendered image(s) with one
// {opa, xlu}; type 2 {n, entries, end} with 16-byte {center, radius, opa, xlu}.
export function parseMesh(b: Uint8Array, p: number, seg = 3): RoomMesh | null {
  const o = segOffset(p, seg, b.length);
  if (o < 0 || o + 8 > b.length) return null;
  const type = b[o];
  const entries: MeshEntry[] = [];
  const images: BgImage[] = [];
  if (type === 0 || type === 2) {
    const n = b[o + 1];
    const s = u32(b, o + 4) & 0xffffff;
    const size = type === 0 ? 8 : 16;
    for (let k = 0; k < n && s + (k + 1) * size <= b.length; k++) {
      const q = s + k * size;
      if (type === 0) entries.push({ opa: u32(b, q), xlu: u32(b, q + 4) });
      else entries.push({ center: [s16(b, q), s16(b, q + 2), s16(b, q + 4)], radius: s16(b, q + 6), opa: u32(b, q + 8), xlu: u32(b, q + 12) });
    }
  } else if (type === 1) {
    const e = u32(b, o + 4) & 0xffffff;
    if (e + 8 <= b.length) entries.push({ opa: u32(b, e), xlu: u32(b, e + 4) });
    if (b[o + 1] === 1) {
      images.push({ bgCamIndex: -1, source: u32(b, o + 8), width: u16(b, o + 0x14), height: u16(b, o + 0x16), fmt: b[o + 0x18], siz: b[o + 0x19] });
    } else {
      const n = b[o + 8];
      const l = u32(b, o + 0xc) & 0xffffff;
      for (let k = 0; k < n && l + (k + 1) * 0x1c <= b.length; k++) {
        const q = l + k * 0x1c;
        images.push({ bgCamIndex: b[q + 2], source: u32(b, q + 4), width: u16(b, q + 0x10), height: u16(b, q + 0x12), fmt: b[q + 0x14], siz: b[q + 0x15] });
      }
    }
  }
  return { type, entries, images };
}

export interface CollisionPoly { type: number; v: [number, number, number]; normal: [number, number, number] }
export interface WaterBox { xMin: number; ySurface: number; zMin: number; xLength: number; zLength: number; properties: number }
export interface BgCam { setting: number; count: number; data: number }
export interface Collision {
  vertices: [number, number, number][];
  polys: CollisionPoly[];
  surfaceTypes: [number, number][];
  bgCams: BgCam[];
  waterBoxes: WaterBox[];
}

// CollisionHeader (0x2C): min, max, vertices, polygons, surface types, bg cameras, waterboxes (16 bytes; 12 in the
// 1997 prototype).
export function parseCollision(b: Uint8Array, p: number, waterBoxSize = 16): Collision | null {
  const o = segOffset(p, 2, b.length);
  if (o < 0 || o + 0x2c > b.length) return null;
  const at = (q: number) => u32(b, q) & 0xffffff;
  const nv = u16(b, o + 0xc), vl = at(o + 0x10), np = u16(b, o + 0x14), pl = at(o + 0x18);
  const stl = at(o + 0x1c), bcl = u32(b, o + 0x20) ? at(o + 0x20) : -1, nw = u16(b, o + 0x24), wl = at(o + 0x28);
  const vertices: [number, number, number][] = [];
  for (let k = 0; k < nv && vl + (k + 1) * 6 <= b.length; k++) vertices.push([s16(b, vl + k * 6), s16(b, vl + k * 6 + 2), s16(b, vl + k * 6 + 4)]);
  const polys: CollisionPoly[] = [];
  for (let k = 0; k < np && pl + (k + 1) * 16 <= b.length; k++) {
    const q = pl + k * 16;
    polys.push({
      type: u16(b, q), v: [u16(b, q + 2) & 0x1fff, u16(b, q + 4) & 0x1fff, u16(b, q + 6) & 0x1fff],
      normal: [s16(b, q + 8) / 0x7fff, s16(b, q + 10) / 0x7fff, s16(b, q + 12) / 0x7fff],
    });
  }
  const nst = polys.reduce((m, q) => Math.max(m, q.type + 1), 0);
  const surfaceTypes: [number, number][] = [];
  for (let k = 0; k < nst && stl + (k + 1) * 8 <= b.length; k++) surfaceTypes.push([u32(b, stl + k * 8), u32(b, stl + k * 8 + 4)]);
  const waterBoxes: WaterBox[] = [];
  for (let k = 0; k < nw && wl + (k + 1) * waterBoxSize <= b.length; k++) {
    const q = wl + k * waterBoxSize;
    waterBoxes.push({
      xMin: s16(b, q), ySurface: s16(b, q + 2), zMin: s16(b, q + 4), xLength: s16(b, q + 6), zLength: s16(b, q + 8),
      properties: waterBoxSize === 16 ? u32(b, q + 12) : u16(b, q + 10),
    });
  }
  // The bg camera list has no count: the highest index used by surface types and waterboxes, plus one.
  let ncam = 0;
  for (const s of surfaceTypes) ncam = Math.max(ncam, (s[0] & 0xff) + 1);
  if (waterBoxSize === 16) for (const w of waterBoxes) ncam = Math.max(ncam, (w.properties & 0xff) + 1);
  const bgCams: BgCam[] = [];
  for (let k = 0; bcl >= 0 && k < ncam && bcl + (k + 1) * 8 <= b.length; k++) {
    bgCams.push({ setting: u16(b, bcl + k * 8), count: s16(b, bcl + k * 8 + 2), data: u32(b, bcl + k * 8 + 4) });
  }
  return { vertices, polys, surfaceTypes, bgCams, waterBoxes };
}

export interface ActorEntry {
  index: number; // position in its list
  at: number; // file offset of the record
  rawId: number; // u16 as stored (MM: flags in the top 3 bits)
  pos: [number, number, number];
  rot: [number, number, number]; // as stored
  params: number;
}

// ActorEntry lists (commands 0x00 player entries, 0x01 actors): 16 bytes {s16 id; Vec3s pos; Vec3s rot; s16 params}.
export function parseActorEntries(b: Uint8Array, cmd: Cmd, seg: number): ActorEntry[] {
  const o = segOffset(cmd.d2, seg, b.length);
  const out: ActorEntry[] = [];
  for (let k = 0; o >= 0 && k < cmd.d1 && o + (k + 1) * 16 <= b.length; k++) {
    const q = o + k * 16;
    out.push({
      index: k, at: q, rawId: u16(b, q), pos: [s16(b, q + 2), s16(b, q + 4), s16(b, q + 6)],
      rot: [u16(b, q + 8), u16(b, q + 10), u16(b, q + 12)], params: u16(b, q + 14),
    });
  }
  return out;
}

export interface TransitionActor {
  index: number; at: number; frontRoom: number; frontCam: number; backRoom: number; backCam: number;
  rawId: number; pos: [number, number, number]; rotY: number; params: number;
}

// Transition actors (scene command 0x0E): {s8 frontRoom, frontCam, backRoom, backCam; s16 id; Vec3s pos; s16 rotY;
// s16 params}.
export function parseTransitionActors(b: Uint8Array, cmd: Cmd): TransitionActor[] {
  const o = segOffset(cmd.d2, 2, b.length);
  const out: TransitionActor[] = [];
  for (let k = 0; o >= 0 && k < cmd.d1 && o + (k + 1) * 16 <= b.length; k++) {
    const q = o + k * 16;
    out.push({
      index: k, at: q, frontRoom: s8(b, q), frontCam: s8(b, q + 1), backRoom: s8(b, q + 2), backCam: s8(b, q + 3), rawId: u16(b, q + 4),
      pos: [s16(b, q + 6), s16(b, q + 8), s16(b, q + 10)], rotY: u16(b, q + 12), params: u16(b, q + 14),
    });
  }
  return out;
}

export interface SceneHeader {
  cmds: Cmd[];
  layerUsed: number;
  rooms: { vromStart: number; vromEnd: number }[];
  lights: LightSetting[];
  skyboxId: number;
  skyboxConfig: number;
  lightMode: number;
  areaTextures: number; // MM command 0x11 data1 (scene_texture_0N), 0 none
  playerEntries: ActorEntry[];
  spawns: { playerEntry: number; room: number }[];
  transitions: TransitionActor[];
  collision: number; // segment pointer, 0 none
  keepObject: number; // command 0x07 object id (gameplay_field_keep / dangeon_keep), 0 none
  animatedMaterials: number; // MM command 0x1A pointer, 0 none
  sequence: number; // command 0x15 byte 7, 0x7F none; -1 absent
  cutscene: boolean; // the header carries cutscene data (0x17)
}

export function readSceneHeader(b: Uint8Array, cmds: Cmd[], used: number, game: ZeldaGame): SceneHeader {
  const get = (c: number) => cmds.find((x) => x.code === c);
  const rl = get(0x04);
  const rooms: SceneHeader['rooms'] = [];
  const ro = rl ? segOffset(rl.d2, 2, b.length) : -1;
  for (let k = 0; rl && ro >= 0 && k < rl.d1 && ro + (k + 1) * 8 <= b.length; k++) rooms.push({ vromStart: u32(b, ro + k * 8), vromEnd: u32(b, ro + k * 8 + 4) });
  const sk = get(0x11);
  const pe = get(0x00);
  const playerEntries = pe ? parseActorEntries(b, pe, 2) : [];
  const spawns: SceneHeader['spawns'] = [];
  const sp = get(0x06);
  const so = sp ? segOffset(sp.d2, 2, b.length) : -1;
  // No length: entries while the player entry and room indices are in range.
  for (let k = 0; so >= 0 && k < 64 && so + (k + 1) * 2 <= b.length; k++) {
    const q = so + k * 2;
    if (b[q] >= playerEntries.length || b[q + 1] >= Math.max(1, rooms.length)) break;
    spawns.push({ playerEntry: b[q], room: b[q + 1] });
  }
  const tl = get(0x0e), lt = get(0x0f), so15 = get(0x15);
  return {
    cmds, layerUsed: used, rooms, lights: lt ? parseLightSettings(b, lt) : [],
    skyboxId: sk ? (game === 'mm' ? b[sk.off + 4] & 3 : b[sk.off + 4]) : 0, skyboxConfig: sk ? b[sk.off + 5] : 0, lightMode: sk ? b[sk.off + 6] : 0,
    areaTextures: sk && game === 'mm' ? sk.d1 : 0,
    playerEntries, spawns, transitions: tl ? parseTransitionActors(b, tl) : [],
    collision: get(0x03)?.d2 ?? 0, keepObject: get(0x07) ? get(0x07)!.d2 & 0xffff : 0, animatedMaterials: game === 'mm' ? (get(0x1a)?.d2 ?? 0) : 0,
    sequence: so15 ? b[so15.off + 7] : -1, cutscene: cmds.some((c) => c.code === 0x17),
  };
}

export interface RoomHeader {
  cmds: Cmd[];
  layerUsed: number;
  mesh: RoomMesh | null;
  actors: ActorEntry[];
  objects: number[];
  skyboxDisabled: boolean;
  sunMoonDisabled: boolean;
  time: [number, number, number] | null; // hour, minute, speed (command 0x10)
}

export function readRoomHeader(b: Uint8Array, cmds: Cmd[], used: number): RoomHeader {
  const get = (c: number) => cmds.find((x) => x.code === c);
  const m = get(0x0a), al = get(0x01), ol = get(0x0b), sd = get(0x12), tm = get(0x10);
  const objects: number[] = [];
  const oo = ol ? segOffset(ol.d2, 3, b.length) : -1;
  for (let k = 0; ol && oo >= 0 && k < ol.d1 && oo + (k + 1) * 2 <= b.length; k++) objects.push(u16(b, oo + k * 2));
  return {
    cmds, layerUsed: used, mesh: m ? parseMesh(b, m.d2) : null, actors: al ? parseActorEntries(b, al, 3) : [], objects,
    skyboxDisabled: sd ? b[sd.off + 4] !== 0 : false, sunMoonDisabled: sd ? b[sd.off + 5] !== 0 : false,
    time: tm ? [b[tm.off + 4], b[tm.off + 5], b[tm.off + 6]] : null,
  };
}
