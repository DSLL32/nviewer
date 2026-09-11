// Gex 64: Enter the Gecko (USA).
//
// Level table ROM 0x708E0: 31 x 32 bytes {u32 data start, end (raw DEFLATE), overlay start, end,
// RAM end, char name[12]}; names for the menus in the 24-byte info table ROM 0x78EA8 {name,
// title lines 1-2, channel lines 1-2, u16 red remotes, u16 TV logo}. Level header (file offsets of
// the image linked at 0x8024B000):
//   +0x00 scene {+0x00 render BSP root, +0x24 vertex pool (segment 1), +0x38 material DLs (2),
//   +0x3C texture pool (3)}, +0x20 sky record count, +0x24 16-byte sky records (DL at +12), +0x28
//   sky vertex pool (segment 4), +0x40 object names {u32 n, char[8] x n}, +0x48 RGB clear and fog
//   colour, +0x52 u16 fog minimum, +0x7C instance count, +0x80 48-byte instances.
// Render BSP nodes (24 bytes): +0x08 u16 kind (bit 1 = leaf); inner nodes point to their children at
// +0x10/+0x14; leaves are followed by chunks {u16 flags; u16 size; u32 extra} + F3DEX 1.x list.
import type { Game, Instance, Level, LevelInfo, Mesh, Texture } from '../types';
import { buildLevel, fogPosition, meshFromBatches } from '../bomberman/common';
import { runDisplayList } from '../displaylist';
import { inflateRaw } from '../inflate';
import { decodeGex64Music, listGex64Music } from '../music/libmus64';
import { view } from '../util';
import { animatedMaterial, cstr, gex64ObjectMesh, instanceMatrix, LEVEL_BASE, objectClass, ObjectTable, startCamera, SyntheticList, titleCase, toRom, Z_UP } from './common';

const LEVEL_TABLE = 0x708e0;
const INFO_TABLE = 0x78ea8;
const OBJECT_TABLE = 0x745f0;
const LEVEL_COUNT = 31;

interface LevelDef { index: number; info: LevelInfo }

export function gex64Levels(rom: Uint8Array): { names: string[]; defs: LevelDef[] } {
  const dv = view(rom);
  const str = (o: number) => {
    const p = dv.getUint32(o);
    return p ? cstr(rom, toRom(p)) : '';
  };
  const names: string[] = [];
  const entries: { index: number; name: string; kind: LevelInfo['kind']; group?: string }[] = [];
  for (let i = 0; i < LEVEL_COUNT; i++) {
    const inf = INFO_TABLE + i * 24;
    const title = titleCase([str(inf + 4), str(inf + 8)].filter(Boolean).join(' '));
    const channel = titleCase([str(inf + 12), str(inf + 16)].filter(Boolean).join(' '));
    names.push(title);
    const internal = cstr(rom, LEVEL_TABLE + i * 32 + 0x14);
    if (i <= 13) entries.push({ index: i, name: title, kind: 'campaign', group: channel });
    else if (i <= 20) entries.push({ index: i, name: title, kind: 'bonus' });
    else if (i <= 24) entries.push({ index: i, name: title, kind: 'boss' });
    else if (i === 25) entries.push({ index: i, name: 'Media Dimension', kind: 'hub' });
    else entries.push({ index: i, name: i === 26 ? 'Intro' : `Logo (${internal})`, kind: 'other' });
  }
  // Main levels grouped by channel, in table order within each channel.
  const channels = [...new Set(entries.filter((e) => e.group).map((e) => e.group!))];
  const ordered = [
    ...entries.filter((e) => e.kind === 'hub'),
    ...channels.flatMap((g) => entries.filter((e) => e.group === g)),
    ...entries.filter((e) => e.kind === 'bonus'),
    ...entries.filter((e) => e.kind === 'boss'),
    ...entries.filter((e) => e.kind === 'other'),
  ];
  return {
    names,
    defs: ordered.map((e, n) => ({
      index: e.index, info: { index: n, name: e.name, kind: e.kind, ...(e.group ? { group: e.group } : {}) },
    })),
  };
}

// Render modes the game uses for world chunks: opaque with texel-alpha edges, back faces culled;
// translucent chunks (flag bit 0) are blended without culling.
const RM_OPAQUE = 0x00553078;
const RM_TRANSLUCENT = 0x00504a50;
const G_CULL_BACK = 0x2000;

// Object classes with geometry that the game never draws: invisible volumes, proximity triggers and
// the hub's menu hotspots.
const HIDDEN_CLASSES = new Set(['invis___', 'jinvis__', 'proxsig_', 'tvmenu__', 'select__', 'password', 'loadtv__']);


function loadLevel(rom: Uint8Array, objects: ObjectTable, def: LevelDef): Level {
  const rdv = view(rom);
  const t = LEVEL_TABLE + def.index * 32;
  const file = inflateRaw(rom, rdv.getUint32(t), 0);
  const dv = view(file);
  const u32 = (o: number) => (o >= 0 && o + 4 <= file.length ? dv.getUint32(o) : 0);
  const ptr = (o: number) => u32(o) - LEVEL_BASE;
  const inFile = (o: number) => o >= 0 && o < file.length;

  const scene = ptr(0);
  const segments: Record<number, number> = { 1: ptr(scene + 0x24), 2: ptr(scene + 0x38), 3: ptr(scene + 0x3c) };
  if (u32(0x28)) segments[4] = ptr(0x28);

  // World: every chunk of every BSP leaf in one list. Chunks of a leaf share the RSP vertex buffer.
  // The game's world state before the chunks includes G_TEXTURE scale 0.5.
  const syn = new SyntheticList();
  syn.cmd(0xbb000001, 0x80008000);
  const stack = [ptr(scene)];
  const seen = new Set<number>();
  while (stack.length) {
    const node = stack.pop()!;
    if (!inFile(node) || seen.has(node)) continue;
    seen.add(node);
    if (!(dv.getUint16(node + 8) & 2)) {
      stack.push(ptr(node + 0x14), ptr(node + 0x10));
      continue;
    }
    for (let c = node + 16; c + 8 <= file.length;) {
      const flags = dv.getUint16(c), size = dv.getUint16(c + 2);
      if (size === 0) break;
      const material = flags & 4 ? animatedMaterial(file, ptr(c + 4), (flags & 2) !== 0) : [];
      if (!material) {
        // Unsupported animated texture: keep only the chunk's vertex loads, which later chunks may use.
        for (let q = c + 8; q < c + 8 + size && q + 8 <= file.length; q += 8) {
          if (file[q] === 0x04) syn.cmd(dv.getUint32(q), dv.getUint32(q + 4));
        }
      } else {
        syn.cmd(0xb900031d, flags & 1 ? RM_TRANSLUCENT : RM_OPAQUE);
        syn.cmd(flags & 1 ? 0xb6000000 : 0xb7000000, G_CULL_BACK);
        for (const [w0, w1] of material) syn.cmd(w0, w1);
        // Flipbook material {u16 period; u16 count; ptr DL[count]}: frame 0.
        if ((flags & 6) === 2 && inFile(ptr(c + 4))) syn.cmd(0x06000000, u32(ptr(c + 4) + 4));
        syn.cmd(0x06000000, LEVEL_BASE + c + 8);
      }
      c += 8 + size;
    }
  }
  syn.cmd(0xb8000000, 0);
  const worldStart = syn.address;

  // Sky: records {u32 0; s16 dx, dy; u32; ptr DL}, drawn around the camera with texel colours only.
  const skyCount = u32(0x20);
  let skyStart = -1;
  if (skyCount && skyCount < 256 && segments[4] !== undefined) {
    skyStart = syn.address;
    syn.cmd(0xbb000001, 0x80008000);
    syn.cmd(0xfcffffff, 0xfffcf279);
    for (let i = 0; i < skyCount; i++) {
      const dl = u32(ptr(0x24) + i * 16 + 12);
      if (inFile(dl - LEVEL_BASE)) syn.cmd(0x06000000, dl);
    }
    syn.cmd(0xb8000000, 0);
  }
  void worldStart;

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
  const run = (start: number, geometryMode: number) => runDisplayList({
    buf, ucode: 'f3dex', resolve, textures, textureKeys, keyPrefix: 'world:',
    vertexScale: 1, mirrorX: false, geometryMode, matrix: Z_UP, combiner: true, decals: true,
  }, start);

  const meshes: Mesh[] = [{
    ...meshFromBatches('world', run(0x0e000000, 0x1)),
    info: { level: cstr(rom, t + 0x14), triSource: 'offset in the inflated level image' },
  }];
  const instances: Instance[] = [{ name: 'world', mesh: 0, matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) }];
  const extra: Partial<Level> = {};
  if (skyStart >= 0) {
    const sky = meshFromBatches('sky', run(skyStart, 0));
    if (sky.batches.length) extra.skies = [{ name: 'Sky', mesh: meshes.push(sky) - 1 }];
  }

  // Placed objects (rest poses). Objects with an animation table are characters and animated props.
  const names = ptr(0x40);
  const nameCount = u32(names);
  const meshOf = new Map<string, { mesh: number; skeletal: boolean } | null>();
  for (let i = 0, n = u32(0x7c), arr = ptr(0x80); i < n && arr + (i + 1) * 48 <= file.length; i++) {
    const r = arr + i * 48;
    const objIndex = dv.getInt32(r);
    if (objIndex < 0 || objIndex >= nameCount) continue;
    const name = String.fromCharCode(...file.subarray(names + 4 + objIndex * 8, names + 12 + objIndex * 8));
    let entry = meshOf.get(name);
    if (entry === undefined) {
      entry = null;
      const data = objects.data(name);
      const hidden = data && HIDDEN_CLASSES.has(objectClass(data));
      const obj = data && !hidden ? gex64ObjectMesh(data, `obj:${name}:`, textures, textureKeys) : null;
      if (obj && obj.batches.length) {
        const mesh = { ...meshFromBatches(name.replace(/_+$/, ''), obj.batches), info: { object: name, class: objectClass(data!), triSource: 'offset in the object data (past its end: synthetic list)' } };
        entry = { mesh: meshes.push(mesh) - 1, skeletal: obj.skeletal };
      }
      meshOf.set(name, entry);
    }
    if (!entry) continue;
    instances.push({
      name: meshes[entry.mesh].name, mesh: entry.mesh,
      matrix: instanceMatrix(dv.getInt16(r + 8), dv.getInt16(r + 10), dv.getInt16(r + 12), dv.getInt16(r + 16), dv.getInt16(r + 18), dv.getInt16(r + 20)),
      info: { instance: i, record: `0x${r.toString(16)}`, object: name },
    });
  }

  // Clear and fog colour; gSPFogPosition(min, 1000) with guPerspective near 220, far 10000 and a
  // 0.5 world scale in the modelview, i.e. near 440 and far 20000 world units.
  const color: [number, number, number] = [file[0x48], file[0x49], file[0x4a]];
  const fogMin = dv.getUint16(0x52) >= 1000 ? 980 : dv.getUint16(0x52);
  extra.fog = fogPosition(fogMin, 1000, color, 440, 20000);
  extra.clearColor = color;
  const [sx, sy, sz] = [0x2c, 0x2e, 0x30].map((o) => dv.getInt16(o));
  if (sx || sy || sz) extra.camera = startCamera(sx, sy, sz, meshes[0]);
  return buildLevel(def.info, `gex64-${def.info.index}`, textures, meshes, instances, extra);
}

export function openGex64(rom: Uint8Array): Game {
  const { names, defs } = gex64Levels(rom);
  const objects = new ObjectTable(rom, OBJECT_TABLE);
  return {
    id: 'gex64',
    title: 'Gex 64: Enter the Gecko',
    levels: defs.map((d) => d.info),
    loadLevel: (i) => {
      const def = defs[i];
      if (!def) throw new Error(`No level ${i}`);
      return loadLevel(rom, objects, def);
    },
    music: listGex64Music(rom, names),
    decodeMusic: (i) => decodeGex64Music(rom, i),
  };
}
