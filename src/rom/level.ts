// Rush 2049 level geometry: the per-level model container (file 101 + n) and the
// placement file (file 120 + n), turned into render-ready meshes and instances.
//
// Model container: u32 at offset 0 points to a trailer of {tag, offset, count|size}
// records. IMAG holds texel data, TXLD texture-setup display lists, OBHD the object
// headers (88 bytes each), OBJS vertices and F3DEX2 display lists. Display-list and
// vertex addresses are file offsets; texture image addresses are IMAG-relative.
//
// Placement file: same trailer layout. WHDR holds the level id, WOBJ the placed
// instances (104 bytes: name, 3x3 matrix, translation, ..., bounds).
import type { RushRom } from './rom';
import { decodeTexture, ImFmt, ImSiz, Tlut, type TextureDesc } from './texture';

export type LevelKind = 'race' | 'battle' | 'stunt' | 'obstacle';

export interface LevelInfo {
  index: number;
  name: string;
  kind: LevelKind;
}

const MODEL_FILE_BASE = 101;
const PLACEMENT_FILE_BASE = 120;

export const LEVELS: LevelInfo[] = [
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ name: `Track ${n}`, kind: 'race' as const })),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ name: `Battle ${n}`, kind: 'battle' as const })),
  ...[1, 2, 3, 4].map((n) => ({ name: `Stunt ${n}`, kind: 'stunt' as const })),
  { name: 'Obstacle Course', kind: 'obstacle' as const },
].map((l, index) => ({ ...l, index }));

// Vertex coordinates are 1/16 of a world unit.
const VERTEX_SCALE = 1 / 16;

export type WrapMode = 'repeat' | 'mirror' | 'clamp';
export type BlendMode = 'opaque' | 'cutout' | 'blend';

export interface Texture {
  width: number;
  height: number;
  rgba: Uint8Array;
  wrapS: WrapMode;
  wrapT: WrapMode;
}

export interface Batch {
  texture: number; // index into Level.textures, -1 for untextured
  blend: BlendMode;
  depthTest: boolean;
  depthWrite: boolean;
  // Non-indexed triangles: 3 positions / 2 uvs / 4 colors per vertex.
  positions: Float32Array;
  uvs: Float32Array;
  colors: Uint8Array;
}

export interface Mesh {
  name: string;
  radius: number;
  batches: Batch[];
}

export interface Instance {
  name: string;
  mesh: number; // index into Level.meshes, -1 when the object isn't in this level file
  matrix: Float32Array; // 4x4 column-major, object -> world
  animated?: boolean; // scripted object, shown at the start of its motion path
}

export interface Level {
  info: LevelInfo;
  id: string;
  textures: Texture[];
  meshes: Mesh[];
  instances: Instance[];
  // Meshes that no instance references (sky, doors and other scripted objects).
  unplaced: number[];
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

interface Section { offset: number; count: number }

function readSections(buf: Uint8Array): Map<string, Section> {
  const dv = view(buf);
  const out = new Map<string, Section>();
  for (let o = dv.getUint32(0); o + 12 <= buf.length; o += 12) {
    const tag = String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
    out.set(tag, { offset: dv.getUint32(o + 4), count: dv.getUint32(o + 8) });
  }
  return out;
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

function cstr(buf: Uint8Array, o: number, len: number): string {
  let s = '';
  for (let i = 0; i < len && buf[o + i]; i++) s += String.fromCharCode(buf[o + i]);
  return s;
}

// Objects placed by name but stored outside the level file: per-track props
// (file 82 + track number) and shared pickups (coins, battle weapon icons).
const TRACK_PROPS_BASE = 82;
const SHARED_OBJECT_FILES = [68, 76];

class MeshLibrary {
  readonly textures: Texture[] = [];
  readonly meshes: Mesh[] = [];
  private textureKeys = new Map<string, number>();

  // Adds every object of a model container; returns the range of new mesh indices.
  add(model: Uint8Array, fileIndex: number): [number, number] {
    const sections = readSections(model);
    const imag = sections.get('IMAG')!.offset;
    const obhd = sections.get('OBHD')!;
    const dv = view(model);
    const first = this.meshes.length;
    for (let i = 0; i < obhd.count; i++) {
      const r = obhd.offset + i * 88;
      // Records hold LOD slots of {flags, max distance, display list, vertices} from +24;
      // slot 0 is the most detailed.
      const dl = dv.getUint32(r + 32);
      this.meshes.push({
        name: cstr(model, r, 16),
        radius: dv.getFloat32(r + 16),
        batches: runDisplayList(model, imag, dl, this.textures, this.textureKeys, `${fileIndex}:`),
      });
    }
    return [first, this.meshes.length];
  }
}

export function loadLevel(rom: RushRom, index: number): Level {
  const info = LEVELS[index];
  const place = rom.file(PLACEMENT_FILE_BASE + index);
  const model = rom.file(MODEL_FILE_BASE + index);
  const dv = view(model);
  const lib = new MeshLibrary();
  const [, levelMeshCount] = lib.add(model, MODEL_FILE_BASE + index);
  const { meshes, textures } = lib;

  // Placement names are resolved against the level file first, then the other
  // containers (loaded on first need). Stored object names carry suffixes such as
  // "G1" and are truncated to 15 characters; placements of direction-specific
  // variants add "_FW"/"_BW".
  const extraFiles = [...(info.kind === 'race' ? [TRACK_PROPS_BASE + index] : []), ...SHARED_OBJECT_FILES];
  let extrasLoaded = false;
  const resolved = new Map<string, number>();
  const lookup = (name: string, from: number, to: number): number => {
    const base = name.replace(/_(FW|BW)$/, '');
    let prefix = -1;
    for (let i = from; i < to; i++) {
      const n = meshes[i].name;
      if (n === name || n === base || n === `${base}G1`) return i;
      // A prefix match must not continue the name's digits ("RAMP" isn't "RAMP02...").
      if (prefix < 0 && n.startsWith(base) && !/^\d/.test(n.slice(base.length))) prefix = i;
    }
    return prefix;
  };
  const resolve = (name: string): number => {
    let mesh = resolved.get(name);
    if (mesh !== undefined) return mesh;
    mesh = lookup(name, 0, levelMeshCount);
    if (mesh < 0) {
      if (!extrasLoaded) {
        for (const f of extraFiles) lib.add(rom.file(f), f);
        extrasLoaded = true;
      }
      mesh = lookup(name, levelMeshCount, meshes.length);
    }
    resolved.set(name, mesh);
    return mesh;
  };

  const psec = readSections(place);
  const pdv = view(place);
  const whdr = psec.get('WHDR')!;
  const wobj = psec.get('WOBJ')!;
  const instances: Instance[] = [];
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < wobj.count; i++) {
    const o = wobj.offset + i * 104;
    const name = cstr(place, o, 16);
    const m = Array.from({ length: 12 }, (_, k) => pdv.getFloat32(o + 16 + k * 4));
    // Row-vector convention: world = x*row0 + y*row1 + z*row2 + t.
    const matrix = new Float32Array([
      m[0], m[1], m[2], 0,
      m[3], m[4], m[5], 0,
      m[6], m[7], m[8], 0,
      m[9], m[10], m[11], 1,
    ]);
    const mesh = resolve(name);
    instances.push({ name, mesh, matrix });
    if (mesh >= 0 && mesh < levelMeshCount) {
      const rad = meshes[mesh].radius;
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], m[9 + k] - rad);
        max[k] = Math.max(max[k], m[9 + k] + rad);
      }
    }
  }
  // Scripted objects (doors, trains, obstacle-course hazards) have no placement
  // entry; PTHD (36 bytes each: name, flags, ..., PATH offset) lists their motion
  // paths. PATH keyframes are 68 bytes: world position, direction, scale, rotation
  // quaternion (x, y, z, w; all zero when unused), timing. Show each object at the
  // first keyframe of each of its paths.
  const modelSections = readSections(model);
  const pthd = modelSections.get('PTHD');
  if (pthd) {
    const seen = new Set<string>();
    for (let i = 0; i < pthd.count; i++) {
      const e = pthd.offset + i * 36;
      const name = cstr(model, e, 16);
      let k = dv.getUint32(e + 28);
      let f = (n: number) => dv.getFloat32(k + n * 4);
      // Some paths start with a keyframe at the origin; the real start follows it.
      if (f(0) === 0 && f(1) === 0 && f(2) === 0 && k + 136 <= model.length) {
        k += 68;
        f = (n: number) => dv.getFloat32(k + n * 4);
      }
      const key = `${name}/${f(0)}/${f(1)}/${f(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const mesh = resolve(name);
      if (mesh < 0) continue;
      let [x, y, z, w] = [f(9), f(10), f(11), f(12)];
      const len = Math.hypot(x, y, z, w);
      if (len < 1e-6) [x, y, z, w] = [0, 0, 0, 1];
      else [x, y, z, w] = [x / len, y / len, z / len, w / len];
      const [sx, sy, sz] = [f(6), f(7), f(8)];
      instances.push({
        name,
        mesh,
        animated: true,
        matrix: new Float32Array([
          (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + w * z) * sx, 2 * (x * z - w * y) * sx, 0,
          2 * (x * y - w * z) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + w * x) * sy, 0,
          2 * (x * z + w * y) * sz, 2 * (y * z - w * x) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
          f(0), f(1), f(2), 1,
        ]),
      });
    }
  }

  const used = new Set(instances.map((i) => i.mesh));

  // Keep the level's own meshes (indices unchanged) plus only the extra objects
  // actually placed, and only the textures those meshes use.
  const keep = meshes.map((_, i) => i).filter((i) => i < levelMeshCount || used.has(i));
  const meshRemap = new Map(keep.map((old, i) => [old, i]));
  const textureRemap = new Map<number, number>();
  const keptTextures: Texture[] = [];
  const keptMeshes = keep.map((i): Mesh => ({
    ...meshes[i],
    batches: meshes[i].batches.map((b) => {
      if (b.texture < 0) return b;
      let t = textureRemap.get(b.texture);
      if (t === undefined) {
        t = keptTextures.push(textures[b.texture]) - 1;
        textureRemap.set(b.texture, t);
      }
      return { ...b, texture: t };
    }),
  }));
  for (const inst of instances) if (inst.mesh >= 0) inst.mesh = meshRemap.get(inst.mesh)!;

  return {
    info,
    id: cstr(place, whdr.offset + 8, 16),
    textures: keptTextures,
    meshes: keptMeshes,
    instances,
    unplaced: meshes.slice(0, levelMeshCount).map((_, i) => i).filter((i) => !used.has(i)),
    bounds: { min, max },
  };
}

// --- F3DEX2 display list interpretation -------------------------------------------

const enum Op {
  VTX = 0x01, TRI1 = 0x05, TRI2 = 0x06, TEXTURE = 0xd7, GEOMETRYMODE = 0xd9,
  DL = 0xde, ENDDL = 0xdf, SETOTHERMODE_L = 0xe2, SETOTHERMODE_H = 0xe3,
  SETTILESIZE = 0xf2, LOADBLOCK = 0xf3, SETTILE = 0xf5, LOADTLUT = 0xf0,
  SETCOMBINE = 0xfc, SETTIMG = 0xfd,
}

const G_ZBUFFER = 0x1;
const RM_Z_CMP = 0x10, RM_Z_UPD = 0x20, RM_CVG_X_ALPHA = 0x1000, RM_FORCE_BL = 0x4000;
const RM_ZMODE_MASK = 0xc00, RM_ZMODE_XLU = 0x800;

interface Tile { fmt: number; siz: number; width: number; height: number; cms: number; cmt: number; shiftS: number; shiftT: number }

interface State {
  vtx: { x: number; y: number; z: number; s: number; t: number; c: number }[];
  geometryMode: number;
  renderMode: number;
  alphaCompare: number;
  textLut: number;
  combineUsesTexel: boolean;
  textureOn: boolean;
  scaleS: number;
  scaleT: number;
  timg: number;
  image: number;
  palette: number;
  tiles: Tile[];
}

interface BatchBuilder { key: string; batch: Omit<Batch, 'positions' | 'uvs' | 'colors'>; pos: number[]; uv: number[]; col: number[] }

function runDisplayList(
  buf: Uint8Array, imag: number, start: number,
  textures: Texture[], textureKeys: Map<string, number>, keyPrefix: string,
): Batch[] {
  const dv = view(buf);
  const st: State = {
    vtx: [], geometryMode: G_ZBUFFER, renderMode: RM_Z_CMP | RM_Z_UPD, alphaCompare: 0, textLut: 0,
    // Many objects set up a texture without a G_TEXTURE command of their own: the
    // game leaves texturing enabled between objects.
    combineUsesTexel: true, textureOn: true, scaleS: 1, scaleT: 1, timg: 0, image: -1, palette: -1,
    tiles: Array.from({ length: 8 }, () => ({ fmt: 0, siz: 0, width: 0, height: 0, cms: 0, cmt: 0, shiftS: 0, shiftT: 0 })),
  };
  const builders = new Map<string, BatchBuilder>();

  const currentTexture = (): number => {
    if (!st.textureOn || !st.combineUsesTexel || st.image < 0) return -1;
    const t = st.tiles[0];
    if (t.width === 0 || t.height === 0) return -1;
    const wrap = (cm: number): WrapMode => (cm & 2 ? 'clamp' : cm & 1 ? 'mirror' : 'repeat');
    const desc: TextureDesc = {
      fmt: t.fmt as ImFmt, siz: t.siz as ImSiz, width: t.width, height: t.height,
      image: st.image, palette: t.fmt === ImFmt.CI ? st.palette : -1, tlut: st.textLut as Tlut,
    };
    const key = `${keyPrefix}${desc.image}/${desc.palette}/${desc.fmt}/${desc.siz}/${desc.width}x${desc.height}/${desc.tlut}/${t.cms}/${t.cmt}`;
    let idx = textureKeys.get(key);
    if (idx === undefined) {
      idx = textures.length;
      textures.push({ width: t.width, height: t.height, rgba: decodeTexture(buf, desc), wrapS: wrap(t.cms), wrapT: wrap(t.cmt) });
      textureKeys.set(key, idx);
    }
    return idx;
  };

  const triangle = (a: number, b: number, c: number) => {
    const texture = currentTexture();
    const rm = st.renderMode;
    const blend: BlendMode = rm & RM_FORCE_BL && ((rm & RM_ZMODE_MASK) === RM_ZMODE_XLU || !(rm & RM_Z_UPD))
      ? 'blend'
      : rm & RM_CVG_X_ALPHA || st.alphaCompare ? 'cutout' : 'opaque';
    const zbuf = (st.geometryMode & G_ZBUFFER) !== 0;
    const depthTest = zbuf && (rm & RM_Z_CMP) !== 0;
    const depthWrite = zbuf && (rm & RM_Z_UPD) !== 0 && blend !== 'blend';
    const key = `${texture}/${blend}/${depthTest}/${depthWrite}`;
    let bb = builders.get(key);
    if (!bb) {
      bb = { key, batch: { texture, blend, depthTest, depthWrite }, pos: [], uv: [], col: [] };
      builders.set(key, bb);
    }
    const tile = st.tiles[0];
    const shift = (s: number) => (s > 10 ? 1 << (16 - s) : 1 / (1 << s));
    const su = texture >= 0 ? (st.scaleS * shift(tile.shiftS)) / (32 * tile.width) : 0;
    const sv = texture >= 0 ? (st.scaleT * shift(tile.shiftT)) / (32 * tile.height) : 0;
    for (const i of [a, b, c]) {
      const v = st.vtx[i];
      if (!v) return;
    }
    for (const i of [a, b, c]) {
      const v = st.vtx[i];
      bb.pos.push(v.x * VERTEX_SCALE, v.y * VERTEX_SCALE, v.z * VERTEX_SCALE);
      bb.uv.push(v.s * su, v.t * sv);
      bb.col.push(v.c >>> 24, (v.c >>> 16) & 0xff, (v.c >>> 8) & 0xff, v.c & 0xff);
    }
  };

  const stack: number[] = [];
  let pc = start;
  for (let steps = 0; steps < 1_000_000; steps++) {
    if (pc < 0 || pc + 8 > buf.length) break;
    const w0 = dv.getUint32(pc);
    const w1 = dv.getUint32(pc + 4);
    pc += 8;
    switch (w0 >>> 24) {
      case Op.VTX: {
        const n = (w0 >>> 12) & 0xff;
        const v0 = ((w0 & 0xff) >> 1) - n;
        for (let k = 0; k < n; k++) {
          const o = w1 + k * 16;
          if (o + 16 > buf.length) break;
          st.vtx[v0 + k] = {
            x: dv.getInt16(o), y: dv.getInt16(o + 2), z: dv.getInt16(o + 4),
            s: dv.getInt16(o + 8), t: dv.getInt16(o + 10), c: dv.getUint32(o + 12),
          };
        }
        break;
      }
      case Op.TRI1:
        triangle(((w0 >>> 16) & 0xff) >> 1, ((w0 >>> 8) & 0xff) >> 1, (w0 & 0xff) >> 1);
        break;
      case Op.TRI2:
        triangle(((w0 >>> 16) & 0xff) >> 1, ((w0 >>> 8) & 0xff) >> 1, (w0 & 0xff) >> 1);
        triangle(((w1 >>> 16) & 0xff) >> 1, ((w1 >>> 8) & 0xff) >> 1, (w1 & 0xff) >> 1);
        break;
      case Op.TEXTURE:
        st.textureOn = (w0 & 2) !== 0;
        st.scaleS = (w1 >>> 16) / 65536;
        st.scaleT = (w1 & 0xffff) / 65536;
        break;
      case Op.GEOMETRYMODE:
        st.geometryMode = ((st.geometryMode & (w0 & 0xffffff)) | w1) >>> 0;
        break;
      case Op.SETOTHERMODE_L:
      case Op.SETOTHERMODE_H: {
        const len = (w0 & 0xff) + 1;
        const shift = 32 - ((w0 >>> 8) & 0xff) - len;
        const mask = (((1 << len) - 1) << shift) >>> 0;
        if (w0 >>> 24 === Op.SETOTHERMODE_L) {
          if (shift === 0) st.alphaCompare = w1 & 3;
          if (shift <= 3 && shift + len > 3) st.renderMode = ((st.renderMode & ~mask) | (w1 & mask)) >>> 0;
        } else if (shift <= 14 && shift + len >= 16) {
          st.textLut = (w1 >>> 14) & 3;
        }
        break;
      }
      case Op.SETCOMBINE: {
        const colorInputs = [
          (w0 >>> 20) & 0xf, (w1 >>> 28) & 0xf, (w0 >>> 15) & 0x1f, (w1 >>> 15) & 0x7,
          (w0 >>> 5) & 0xf, (w1 >>> 24) & 0xf, w0 & 0x1f, (w1 >>> 6) & 0x7,
        ];
        st.combineUsesTexel = colorInputs.some((v) => v === 1 || v === 2);
        break;
      }
      case Op.SETTIMG:
        st.timg = imag + w1;
        break;
      case Op.LOADBLOCK:
        st.image = st.timg;
        break;
      case Op.LOADTLUT:
        st.palette = st.timg;
        break;
      case Op.SETTILE: {
        const t = st.tiles[(w1 >>> 24) & 7];
        t.fmt = (w0 >>> 21) & 7;
        t.siz = (w0 >>> 19) & 3;
        t.cmt = (w1 >>> 18) & 3;
        t.shiftT = (w1 >>> 10) & 0xf;
        t.cms = (w1 >>> 8) & 3;
        t.shiftS = w1 & 0xf;
        break;
      }
      case Op.SETTILESIZE: {
        const t = st.tiles[(w1 >>> 24) & 7];
        t.width = (((w1 >>> 12) & 0xfff) >> 2) - (((w0 >>> 12) & 0xfff) >> 2) + 1;
        t.height = ((w1 & 0xfff) >> 2) - ((w0 & 0xfff) >> 2) + 1;
        break;
      }
      case Op.DL:
        if (((w0 >>> 16) & 0xff) === 0) stack.push(pc);
        pc = w1;
        break;
      case Op.ENDDL:
        if (stack.length === 0) steps = Infinity;
        else pc = stack.pop()!;
        break;
      default:
        break; // sync, no-op and game marker commands carry nothing we render
    }
  }

  return [...builders.values()].map((b) => ({
    ...b.batch,
    positions: new Float32Array(b.pos),
    uvs: new Float32Array(b.uv),
    colors: new Uint8Array(b.col),
  }));
}
