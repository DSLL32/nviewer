// Gex 3: Deep Cover Gecko (USA).
//
// Level table ROM 0x8013C: 30 x 0x54 bytes {char* name; u16 title, genre, channel string ids (string
// table 0x80080110); ...; +0x1C/+0x20 level data (raw DEFLATE); +0x4C/+0x50 level song}. Level
// header (file offsets of the image linked at 0x8024B000):
//   +0x00 scene {+0x00 tree root, +0x30 vertex pool (segment 1), +0x58 material DLs (2), +0x5C
//   texture pool (3)}, +0x20 sky patch count, +0x24 16-byte patches (DL at +12), +0x28 sky vertex
//   pool (segment 4), +0x2C material table {u32 n; ptr[n]}, +0x44 object names, +0x4C RGB fog and
//   clear colour, +0x54 u16 (probably the far plane), +0x56 u16 fog minimum, +0x84 instance count,
//   +0x88 0x34-byte instances.
// Tree nodes (24 bytes): +0x0C u8 type (1 inner with children at +0x10/+0x14, 2 leaf). World geometry
// is stored as command fragments after each leaf, drawn per material: the game emits the material
// DL followed by the fragments' commands.
import type { Game, Instance, Level, LevelInfo, Mesh, MusicTrack, Texture } from '../types';
import { buildLevel, fogPosition, meshFromBatches } from '../bomberman/common';
import { runDisplayList } from '../displaylist';
import { inflateRaw } from '../inflate';
import { parseLibmusBank, renderLibmusSong, type Wave } from '../music/libmus';
import { view } from '../util';
import { animatedMaterial, cstr, gex3ObjectMesh, instanceMatrix, isMarkerMesh, LEVEL_BASE, objectClass, ObjectTable, startCamera, SyntheticList, titleCase, toRom, Z_UP } from './common';

const LEVEL_TABLE = 0x8013c;
const LEVEL_SIZE = 0x54;
const LEVEL_COUNT = 30;
const STRING_TABLE = 0x80080110;
const OBJECT_TABLE = 0x818c0;
const MUSIC_BANK = 0xd204a0; // "N64 PtrTablesV2"
const MUSIC_SAMPLES = 0xbd2050; // "N64 WaveTables"
const SONG_MASTER_VOLUME = (0x3fff * 0x3fff) >> 15;
// The game plays music at about -33 dBFS (renders match captured game audio within 1.3 dB). Tracks are
// boosted for playback next to the other games; the loudest track still peaks below full scale.
const PLAYBACK_GAIN = 6;

interface LevelDef { index: number; info: LevelInfo }

function levelStrings(rom: Uint8Array, i: number) {
  const dv = view(rom);
  const t = LEVEL_TABLE + i * LEVEL_SIZE;
  const str = (id: number) => (id ? cstr(rom, toRom(dv.getUint32(toRom(STRING_TABLE) + id * 4))) : '');
  return {
    internal: cstr(rom, toRom(dv.getUint32(t))),
    title: titleCase(str(dv.getUint16(t + 4))),
    channel: titleCase([str(dv.getUint16(t + 6)), str(dv.getUint16(t + 8))].filter(Boolean).join(' ')),
  };
}

function gex3Levels(rom: Uint8Array): LevelDef[] {
  const s = (i: number) => levelStrings(rom, i);
  const entries: { index: number; name: string; kind: LevelInfo['kind']; group?: string }[] = [
    ...[23, 24, 25, 26].map((i) => ({ index: i, name: s(i).title, kind: 'hub' as const })),
    ...Array.from({ length: 11 }, (_, i) => ({ index: i, name: s(i).title, kind: 'campaign' as const, group: s(i).channel })),
    ...[11, 12, 13, 14, 15].map((i) => ({ index: i, name: s(i).title, kind: 'bonus' as const, group: 'Bonus Bonanza' })),
    ...[16, 17, 18, 19].map((i) => ({ index: i, name: s(i).title, kind: 'bonus' as const, group: 'Secret TV' })),
    ...[20, 21, 22].map((i) => ({ index: i, name: s(i).title, kind: 'boss' as const, group: s(i).channel })),
    { index: 27, name: 'Title Screen', kind: 'other' as const },
    { index: 28, name: 'Intro', kind: 'other' as const },
    { index: 29, name: 'Story Intro', kind: 'other' as const },
  ];
  return entries.map((e, n) => ({ index: e.index, info: { index: n, name: e.name, kind: e.kind, ...(e.group ? { group: e.group } : {}) } }));
}

// World render state (static DL 0x8007F228): Z buffer, shade, back-face culling, texture scale 0.5,
// modulate combine, textured-edge render mode with fog.
const PRELUDE: [number, number][] = [
  [0xd9000000, 0], [0xd9ffffff, 0x00200405], [0xd7000002, 0x80008000], [0xfc127fff, 0xfffff238], [0xe200001c, 0xc8113078],
];

function loadLevel(rom: Uint8Array, objects: ObjectTable, def: LevelDef): Level {
  const rdv = view(rom);
  const t = LEVEL_TABLE + def.index * LEVEL_SIZE;
  const file = inflateRaw(rom, rdv.getUint32(t + 0x1c), 0);
  const dv = view(file);
  const u32 = (o: number) => (o >= 0 && o + 4 <= file.length ? dv.getUint32(o) : 0);
  const ptr = (o: number) => u32(o) - LEVEL_BASE;
  const inFile = (o: number) => o >= 0 && o < file.length;
  const isList = (p: number) => inFile(p - LEVEL_BASE) && file[p - LEVEL_BASE] === 0xe7;

  const scene = ptr(0);
  const segments: Record<number, number> = { 1: ptr(scene + 0x30), 2: ptr(scene + 0x58), 3: ptr(scene + 0x5c) };
  if (u32(0x28)) segments[4] = ptr(0x28);

  // Material table entries: a texture DL, an animation record or 0. Records are flipbooks
  // {u16 kind; u16 n; ptr DL[n]} (frame 0), animated textures, or procedural kinds (their first DL).
  // Animated textures (water, screens; seg-3 palette/texel pairs) are loaded like Gex 64's.
  const materialCommands = (p: number): [number, number][] => {
    if (isList(p)) return [[0xde000000, p]];
    const o = p - LEVEL_BASE;
    if (!inFile(o) || o + 16 > file.length) return [];
    const anim = u32(o) >>> 24 === 3 ? animatedMaterial(file, o, false, true)
      : u32(o + 8) >>> 24 === 3 ? animatedMaterial(file, o, true, true) : null;
    if (anim) return anim;
    for (let k = 0; k < 16; k++) if (isList(u32(o + k * 4))) return [[0xde000000, u32(o + k * 4)]];
    return [];
  };
  const table = ptr(0x2c);
  const materials = Array.from({ length: inFile(table) ? Math.min(u32(table), 4096) : 0 }, (_, i) => u32(table + 4 + i * 4));

  // Fragments after each leaf. Type A {u16 flags; u16 size; u16 material; u16; u32; u32} + size bytes
  // of G_VTX/G_TRI1/G_TRI2 commands; type B (flags bit 0) {u16 flags; u16 size; ptr special record}
  // + size - 8 bytes of commands + G_ENDDL (with record 0 the commands call their material with G_DL);
  // a zero word ends the list. With these sizes every fragment list of all 30 levels parses.
  const groups = new Map<number, number[][]>(); // material pointer -> command ranges
  const add = (dl: number, from: number, to: number) => {
    const g = groups.get(dl);
    if (g) g.push([from, to]);
    else groups.set(dl, [[from, to]]);
  };
  const onlyGeometry = (from: number, to: number) => {
    for (let q = from; q < to; q += 8) if (![0x01, 0x05, 0x06, 0xde].includes(file[q])) return false;
    return true;
  };
  const stack = [ptr(scene)];
  const seen = new Set<number>();
  while (stack.length) {
    const node = stack.pop()!;
    if (!inFile(node) || node + 24 > file.length || seen.has(node)) continue;
    seen.add(node);
    if (file[node + 12] === 1) {
      stack.push(ptr(node + 0x14), ptr(node + 0x10));
      continue;
    }
    if (file[node + 12] !== 2) continue;
    for (let p = node + 24, k = 0; k < 1000 && p + 16 <= file.length; k++) {
      const w0 = u32(p);
      if (w0 === 0) break;
      const size = w0 & 0xffff, flags = w0 >>> 16;
      if (flags & 1) {
        if (size % 8 || size < 16 || p + size + 8 > file.length || file[p + size] !== 0xdf || !onlyGeometry(p + 8, p + size)) break;
        add(u32(p + 4), p + 8, p + size);
        p += size + 8;
      } else {
        const material = dv.getUint16(p + 4);
        if (size % 8 || material >= materials.length || p + 16 + size > file.length || !onlyGeometry(p + 16, p + 16 + size)) break;
        add(materials[material], p + 16, p + 16 + size);
        p += 16 + size;
      }
    }
  }

  const syn = new SyntheticList();
  for (const [material, ranges] of groups) {
    for (const [w0, w1] of PRELUDE) syn.cmd(w0, w1);
    for (const [w0, w1] of materialCommands(material)) syn.cmd(w0, w1);
    for (const [from, to] of ranges) for (let q = from; q < to; q += 8) syn.cmd(dv.getUint32(q), dv.getUint32(q + 4), q);
  }
  syn.cmd(0xdf000000, 0);
  const skyCount = u32(0x20);
  let skyStart = -1;
  if (skyCount && skyCount < 256 && segments[4] !== undefined) {
    // Sky patches {u32 0; s16 dx, dy, dz; s16 cone; ptr DL}: drawn around the camera, texel colours only.
    skyStart = syn.address;
    for (const [w0, w1] of [[0xd9000000, 0], [0xd9ffffff, 0x00000405], [0xd7000002, 0x80008000], [0xfcffffff, 0xfffcf279]]) syn.cmd(w0, w1);
    for (let i = 0; i < skyCount; i++) {
      const dl = u32(ptr(0x24) + i * 16 + 12);
      if (inFile(dl - LEVEL_BASE)) syn.cmd(0xde000000, dl); // patch lists start with a material G_DL
    }
    syn.cmd(0xdf000000, 0);
  }

  const { buf, list } = syn.build(file);
  const resolve = (addr: number) => {
    addr >>>= 0;
    if (addr >= 0x80000000) return inFile(addr - LEVEL_BASE) ? addr - LEVEL_BASE : -1;
    const seg = addr >>> 24, off = addr & 0xffffff;
    if (seg === 0x0e) return list + off < buf.length ? list + off : -1;
    const base = segments[seg];
    return base === undefined || !inFile(base + off) ? -1 : base + off;
  };
  const textures: Texture[] = [];
  const textureKeys = new Map<string, number>();
  const run = (start: number) => runDisplayList({
    buf, ucode: 'f3dex2', resolve, textures, textureKeys, keyPrefix: 'world:',
    vertexScale: 1, mirrorX: false, geometryMode: 0, matrix: Z_UP, combiner: true, decals: true,
  }, start);

  // Cutout batches whose texture has partial alpha in over a quarter of its texels (the animated water
  // of special materials) are translucent surfaces; the game sets their blend mode in code.
  const partialAlpha = (t: Texture | undefined) => {
    if (!t) return false;
    let n = 0;
    for (let i = 3; i < t.rgba.length; i += 4) if (t.rgba[i] > 0 && t.rgba[i] < 255) n++;
    return n * 4 > t.rgba.length / 4;
  };
  const world = syn.remapSources(run(0x0e000000), list)
    .map((b) => (b.blend === 'cutout' && partialAlpha(textures[b.texture]) ? { ...b, blend: 'blend' as const, depthWrite: false } : b));
  const meshes: Mesh[] = [{
    ...meshFromBatches('world', world),
    info: { level: cstr(rom, toRom(rdv.getUint32(t))), triSource: 'offset in the inflated level image' },
  }];
  const instances: Instance[] = [{ name: 'world', mesh: 0, matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) }];
  const extra: Partial<Level> = {};
  if (skyStart >= 0) {
    const sky = meshFromBatches('sky', run(skyStart));
    if (sky.batches.length) extra.skies = [{ name: 'Sky', mesh: meshes.push(sky) - 1 }];
  }

  // Placed objects. The rotation order of the three angles is taken from Gex 64 (only Z is verified
  // for Gex 3); skinned objects are not built.
  const names = ptr(0x44);
  const nameCount = u32(names);
  const meshOf = new Map<string, { mesh: number; skeletal: boolean } | null>();
  for (let i = 0, n = u32(0x84), arr = ptr(0x88); i < n && arr + (i + 1) * 0x34 <= file.length; i++) {
    const r = arr + i * 0x34;
    const objIndex = dv.getInt32(r);
    if (objIndex < 0 || objIndex >= nameCount) continue;
    const name = String.fromCharCode(...file.subarray(names + 4 + objIndex * 8, names + 12 + objIndex * 8));
    let entry = meshOf.get(name);
    if (entry === undefined) {
      entry = null;
      const data = objects.data(name);
      const obj = data ? gex3ObjectMesh(data, `obj:${name}:`, textures, textureKeys) : null;
      if (obj && obj.batches.length && !isMarkerMesh(obj.batches, textures)) {
        const mesh = { ...meshFromBatches(name.replace(/_+$/, ''), obj.batches), info: { object: name, class: objectClass(data!), triSource: 'offset in the object data (past its end: synthetic list)' } };
        entry = { mesh: meshes.push(mesh) - 1, skeletal: obj.skeletal };
      }
      meshOf.set(name, entry);
    }
    if (!entry) continue;
    instances.push({
      name: meshes[entry.mesh].name, mesh: entry.mesh,
      matrix: instanceMatrix(dv.getInt16(r + 8), dv.getInt16(r + 10), dv.getInt16(r + 12), dv.getInt16(r + 16), dv.getInt16(r + 18), dv.getInt16(r + 20)),
      info: { instance: i, record: `0x${r.toString(16)}`, object: name, flags: dv.getUint16(r + 0x0e) },
    });
  }

  // Fog and clear colour; gSPFogPosition(min(u16 +0x56, 993), 1000) with near 220 and the level's far plane.
  const color: [number, number, number] = [file[0x4c], file[0x4d], file[0x4e]];
  extra.fog = fogPosition(Math.min(dv.getUint16(0x56), 993), 1000, color, 220, dv.getUint16(0x54) || 12000);
  extra.clearColor = color;
  // Player start at header +0x30 (s16 x, y, z; within 2,000 units of the game camera in level frames).
  const [sx, sy, sz] = [0x30, 0x32, 0x34].map((o) => dv.getInt16(o));
  if (sx || sy || sz) extra.camera = startCamera(sx, sy, sz, meshes[0]);
  return buildLevel(def.info, `gex3-${def.info.index}`, textures, meshes, instances, extra);
}

// One song per level (15 distinct), stored as raw DEFLATE; named after the levels that use it.
function gex3Songs(rom: Uint8Array): { start: number; end: number; name: string }[] {
  const dv = view(rom);
  const songs = new Map<number, { start: number; end: number; levels: string[] }>();
  for (let i = 0; i < LEVEL_COUNT; i++) {
    const t = LEVEL_TABLE + i * LEVEL_SIZE;
    const start = dv.getUint32(t + 0x4c), end = dv.getUint32(t + 0x50);
    if (!start || end <= start) continue;
    const s = levelStrings(rom, i);
    const label = s.title || { 27: 'Title Screen', 28: 'Intro', 29: 'Story Intro' }[i] || s.internal;
    const song = songs.get(start);
    if (song) song.levels.push(label);
    else songs.set(start, { start, end, levels: [label] });
  }
  return [...songs.values()].sort((a, b) => a.start - b.start).map((s) => ({
    start: s.start, end: s.end,
    name: s.levels.length > 3 ? `${s.levels.slice(0, 3).join(', ')} and ${s.levels.length - 3} more` : s.levels.join(', '),
  }));
}

export function openGex3(rom: Uint8Array): Game {
  const defs = gex3Levels(rom);
  const objects = new ObjectTable(rom, OBJECT_TABLE);
  const songs = gex3Songs(rom);
  let waves: Wave[] | undefined;
  const music: MusicTrack[] = songs.map((s, index) => ({ index, name: `${String(index).padStart(2, '0')} ${s.name}` }));
  return {
    id: 'gex3',
    title: 'Gex 3: Deep Cover Gecko',
    levels: defs.map((d) => d.info),
    loadLevel: (i) => {
      const def = defs[i];
      if (!def) throw new Error(`No level ${i}`);
      return loadLevel(rom, objects, def);
    },
    music,
    decodeMusic: (i) => {
      const song = songs[i];
      if (!song) throw new Error(`No music track ${i}`);
      waves ??= parseLibmusBank(rom, MUSIC_BANK, MUSIC_SAMPLES);
      // Song master volume 0x3FFF squared by the game's option scaling; reverb is off.
      const music = renderLibmusSong(rom, waves, inflateRaw(rom, song.start, 0), { masterVolume: SONG_MASTER_VOLUME, reverb: false });
      for (const ch of music.channels) for (let i = 0; i < ch.length; i++) ch[i] = Math.max(-1, Math.min(1, ch[i] * PLAYBACK_GAIN));
      return music;
    },
  };
}
