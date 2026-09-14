// Shared parts of Gex 64: Enter the Gecko and Gex 3: Deep Cover Gecko (Crystal Dynamics engine).
//
// Every compressed file is raw DEFLATE. Level files inflate to a flat image linked at 0x8024B000
// (every pointer inside is absolute); objects are relocatable files named in a sorted table of
// 16-byte records {char name[8], u32 ROM start, u32 ROM end}. Game space is right-handed with Z
// up, without mirroring.
import { type Mtx, runDisplayList } from '../displaylist';
import { inflateRaw } from '../inflate';
import type { Batch, CameraView, DebugInfo, Level, LevelLayer, Mesh, Texture } from '../types';
import { view } from '../util';

export const LEVEL_BASE = 0x8024b000;

// Main-image address to ROM offset.
export const toRom = (vaddr: number) => vaddr - 0x7ffff400;

// Game (x, y, z) -> viewer (x, z, -y), as a row-vector matrix (a rotation: winding is kept).
export const Z_UP: Mtx = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];

// Both games draw their camera-relative sky with a fixed 45-degree vertical projection, while the
// viewer's free camera uses 60 degrees. Stretch the authored sky's height so that its vertical screen
// coverage at the viewer default matches the game's dedicated projection instead of becoming a short
// band around the horizon. Horizontal positions are left alone so the panorama remains a closed ring.
const SKY_HEIGHT_SCALE = Math.tan(Math.PI / 6) / Math.tan(Math.PI / 8);

export function scaleSkyHeight(mesh: Mesh): Mesh {
  for (const batch of mesh.batches) {
    for (let i = 1; i < batch.positions.length; i += 3) batch.positions[i] *= SKY_HEIGHT_SCALE;
  }
  return mesh;
}

export function cstr(rom: Uint8Array, o: number): string {
  let s = '';
  while (o >= 0 && o < rom.length && rom[o]) s += String.fromCharCode(rom[o++]);
  return s;
}

const SMALL_WORDS = new Set(['and', 'of', 'the', 'a', 'in', 'on', 'is', 'to']);
const SPECIAL: Record<string, string> = { tv: 'TV', wwgex: 'WWGEX', 'www.dotcom.com': 'WWW.DotCom.Com', mooshoo: 'MooShoo' };

// The games store names in one case; title-case them for display.
export function titleCase(s: string): string {
  return s.toLowerCase().split(' ').filter(Boolean).map((w, i) => {
    if (SPECIAL[w]) return SPECIAL[w];
    if (i > 0 && SMALL_WORDS.has(w)) return w;
    return w.replace(/(^|[-(])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
  }).join(' ');
}

export class ObjectTable {
  private readonly ranges = new Map<string, [number, number]>();
  private readonly cache = new Map<string, Uint8Array | null>();

  constructor(private readonly rom: Uint8Array, table: number) {
    const dv = view(rom);
    for (let o = table; o + 16 <= rom.length && rom[o]; o += 16) {
      this.ranges.set(String.fromCharCode(...rom.subarray(o, o + 8)), [dv.getUint32(o + 8), dv.getUint32(o + 12)]);
    }
  }

  // An object's data. The relocatable file is {u32 n, u32 relocation[n], data}; the relocated
  // words hold data-relative offsets, so the data can be read with pointers relative to its start.
  data(name: string): Uint8Array | null {
    let d = this.cache.get(name);
    if (d !== undefined) return d;
    d = null;
    const range = this.ranges.get(name);
    if (range && range[0] < range[1] && range[1] <= this.rom.length) {
      try {
        const file = inflateRaw(this.rom, range[0], 0);
        const n = view(file).getUint32(0);
        if (4 + n * 4 < file.length) d = file.subarray(4 + n * 4);
      } catch {
        d = null;
      }
    }
    this.cache.set(name, d);
    return d;
  }
}

// Animated-texture records (water, lava, screens), used instead of a material DL by Gex 64 world
// chunks with flag bit 2 and by Gex 3 special materials: {ptr palette; ptr texels; u8 width, height,
// bits per texel, ?}, or a frame list {u16; u16 frames; u8 width, height, bits per texel, ?;
// {ptr palette; ptr texels}[frames]}. Frame 0 is loaded with the command pattern of the games' own
// material DLs (the RDP commands are the same for F3DEX and F3DEX2; only the TLUT mode command differs).
export function animatedMaterial(file: Uint8Array, rec: number, frames: boolean, f3dex2 = false): [number, number][] | null {
  if (rec < 0 || rec + 16 > file.length) return null;
  const dv = view(file);
  const pal = dv.getUint32(frames ? rec + 8 : rec), tex = dv.getUint32(frames ? rec + 12 : rec + 4);
  const dims = frames ? rec + 4 : rec + 8;
  const w = file[dims], h = file[dims + 1], bits = file[dims + 2];
  const lw = Math.log2(w), lh = Math.log2(h);
  if (!Number.isInteger(lw) || !Number.isInteger(lh) || ![4, 8, 16, 32].includes(bits)) return null;
  const fmtSiz = { 4: 0x40, 8: 0x48, 16: 0x10, 32: 0x18 }[bits]!; // G_SETTILE fmt << 5 | siz << 3
  const rowBytes = (w * bits) / 8;
  const dxt = Math.ceil(2048 / Math.max(1, rowBytes / 8));
  const wrap = (lw << 14) | (lh << 4); // repeat (scrolling surfaces span many texture periods), masks
  const tlutMode = f3dex2 ? 0xe3001001 : 0xba000e02;
  const load: [number, number][] = bits === 32
    ? [[0xfd180000, tex], [0xf5180000, 0x07000000 | wrap], [0xf3000000, 0x07000000 | ((w * h - 1) << 12) | dxt]]
    : [[0xfd500000, tex], [0xf5500000, 0x07000000 | wrap], [0xf3000000, 0x07000000 | (((w * h * bits) / 16 - 1) << 12) | dxt]];
  return [
    [0xe7000000, 0],
    ...(bits <= 8
      ? [[tlutMode, 0x8000], [0xfd100000, pal], [0xf5000100, 0x06000000], [0xf0000000, 0x06000000 | ((1 << bits) - 1) << 14]] as [number, number][]
      : [[tlutMode, 0]] as [number, number][]),
    [0xe6000000, 0],
    ...load,
    [0xf5000000 | (fmtSiz << 16) | ((rowBytes >> 3) << 9), wrap],
    [0xf2000000, (((w - 1) << 2) << 12) | ((h - 1) << 2)],
    [0xe6000000, 0],
  ];
}

// An object's behaviour class (8 characters at the pointer at +0x20), e.g. "generic_", "invis___".
export function objectClass(data: Uint8Array): string {
  const p = data.length >= 0x24 ? view(data).getUint32(0x20) : 0;
  return p && p + 8 <= data.length ? String.fromCharCode(...data.subarray(p, p + 8)) : '';
}

// Level-editor marker meshes (Gex 3 sound emitters and generators such as sfxwind, cricket, waterg):
// small boxes with a black texture, which the game never draws.
export function isMarkerMesh(batches: Batch[], textures: Texture[]): boolean {
  let tris = 0;
  for (const b of batches) {
    tris += b.positions.length / 9;
    const t = textures[b.texture];
    if (!t) return false;
    let sum = 0;
    for (let p = 0; p < t.rgba.length; p += 4) sum += t.rgba[p] + t.rgba[p + 1] + t.rgba[p + 2];
    if (sum / (t.rgba.length / 4) / 3 > 4) return false;
  }
  return tris <= 18;
}

// A static collision triangle in game space (Z up), for the collision overlay.
export interface CollisionFace {
  v: number[][]; // three vertices
  n: number[]; // unit normal from the level's normal table
  surface: number; // the record's surface flags or type, which picks the colour
  special: boolean; // the face refers to an event record (triggers, warps)
  source: number; // offset of the record in the inflated level image (Batch.triSource)
}

// Floor, wall, ceiling (by the normal), as in the Zelda 64 overlay.
const KIND_COLORS = [[90, 200, 90], [200, 150, 80], [200, 90, 200]];

function hueColor(key: number): number[] {
  const h = (Math.imul(key + 1, 2654435761) >>> 0) / 2 ** 32, k = (n: number) => (n + h * 6) % 6;
  return [5, 3, 1].map((n) => Math.round(255 * (0.95 - 0.7 * Math.max(0, Math.min(k(n), 4 - k(n), 1)))));
}

// All collision faces as one translucent, double-sided overlay batch: floor/wall/ceiling colours for plain surfaces
// (surface 0), mixed with a colour per surface value otherwise; faces with an event record are tinted red. Each
// face is lifted one unit along its normal and drawn as a decal, so it never fights the world surface it matches.
export function collisionBatch(faces: CollisionFace[]): Batch | null {
  const pos: number[] = [], col: number[] = [], src: number[] = [];
  for (const f of faces) {
    const kind = f.n[2] > 0.5 ? 0 : f.n[2] < -0.5 ? 2 : 1;
    let rgb = KIND_COLORS[kind];
    if (f.surface) rgb = rgb.map((c, i) => Math.round(c * 0.4 + hueColor(f.surface)[i] * 0.6));
    if (f.special) rgb = rgb.map((c, i) => Math.round(c * 0.35 + [240, 40, 40][i] * 0.65));
    for (const p of f.v) {
      pos.push(p[0] + f.n[0], p[2] + f.n[2], -(p[1] + f.n[1]));
      col.push(rgb[0], rgb[1], rgb[2], f.special ? 190 : 150);
    }
    src.push(f.source);
  }
  if (!pos.length) return null;
  return {
    texture: -1, blend: 'blend', depthTest: true, depthWrite: false, cullBack: false, decal: true,
    positions: new Float32Array(pos), uvs: new Float32Array((pos.length / 3) * 2), colors: new Uint8Array(col), triSource: new Uint32Array(src),
  };
}

// "value:count" pairs, most frequent first.
export function histogram(counts: Map<number, number>, limit = 16): string {
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k, n]) => `0x${k.toString(16)}:${n}`).join(' ') +
    (counts.size > limit ? ` (+${counts.size - limit} more)` : '');
}

// An invisible object (volume, trigger, hotspot) as an untextured translucent overlay in a colour per class.
export function volumeBatches(batches: Batch[], cls: string): Batch[] {
  const rgb = hueColor([...cls].reduce((h, c) => Math.imul(h, 31) + c.charCodeAt(0), 7));
  return batches.map((b) => {
    const colors = new Uint8Array(b.colors.length);
    for (let i = 0; i < colors.length; i += 4) colors.set([rgb[0], rgb[1], rgb[2], 110], i);
    return {
      texture: -1, blend: 'blend', depthTest: true, depthWrite: false, cullBack: false,
      positions: b.positions, uvs: new Float32Array(b.uvs.length), colors, ...(b.triSource ? { triSource: b.triSource } : {}),
    };
  });
}

// Layers for a loaded level: the world (instance 0) and the placed objects, shown as before, then the collision
// overlay and the invisible objects, appended after the level was built (bounds and unplaced meshes stay those of
// the drawn level) and hidden by default.
export function addOverlayLayers(level: Level, collision: Mesh | null, volumes: { name: string; mesh: Mesh; matrix: Float32Array; info: DebugInfo }[]): Level {
  const layers: LevelLayer[] = [
    { name: 'world', kind: 'main', instances: [0] },
    { name: 'objects', kind: 'objects', instances: level.instances.map((_, i) => i).slice(1) },
  ];
  const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  if (collision) {
    const mesh = level.meshes.push(collision) - 1;
    const instance = level.instances.push({ name: 'collision', mesh, matrix: identity, info: collision.info }) - 1;
    layers.push({ name: 'collision', kind: 'collision', instances: [instance], visibleByDefault: false });
  }
  if (volumes.length) {
    const meshOf = new Map<Mesh, number>();
    const instances = volumes.map((v) => {
      let mesh = meshOf.get(v.mesh);
      if (mesh === undefined) meshOf.set(v.mesh, (mesh = level.meshes.push(v.mesh) - 1));
      return level.instances.push({ name: v.name, mesh, matrix: v.matrix, info: v.info }) - 1;
    });
    layers.push({ name: 'invisible objects', kind: 'collision', instances, visibleByDefault: false });
  }
  level.layers = layers;
  return level;
}

// Instance transform (verified for Gex 64): world = T(x, y, z) * Rx * Ry * Rz * v in game space,
// angles 4096 per turn; as a viewer (column-major, Y-up) matrix C * [R | t] * C^-1.
export function instanceMatrix(ax: number, ay: number, az: number, x: number, y: number, z: number): Float32Array {
  const [a, b, c] = [ax, ay, az].map((v) => (v * 2 * Math.PI) / 4096);
  type M3 = number[][];
  const mul = (p: M3, q: M3): M3 => p.map((r) => [0, 1, 2].map((j) => r[0] * q[0][j] + r[1] * q[1][j] + r[2] * q[2][j]));
  const Rx = [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
  const Ry = [[Math.cos(b), 0, Math.sin(b)], [0, 1, 0], [-Math.sin(b), 0, Math.cos(b)]];
  const Rz = [[Math.cos(c), -Math.sin(c), 0], [Math.sin(c), Math.cos(c), 0], [0, 0, 1]];
  const C = [[1, 0, 0], [0, 0, 1], [0, -1, 0]];
  const Ct = [[1, 0, 0], [0, 0, -1], [0, 1, 0]];
  const L = mul(mul(C, mul(mul(Rx, Ry), Rz)), Ct);
  return new Float32Array([
    L[0][0], L[1][0], L[2][0], 0, L[0][1], L[1][1], L[2][1], 0, L[0][2], L[1][2], L[2][2], 0, x, z, -y, 1,
  ]);
}

// Start view from the player start in the level header (game coordinates). The header has no
// heading, so the view looks from the start towards the middle of the world; in game frames the
// camera sits about 1,300 units above and 1,800 behind the start, with a 40 degree field of view.
export function startCamera(x: number, y: number, z: number, world: Mesh): CameraView {
  const p = [x, z, -y];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const b of world.batches) {
    for (let i = 0; i < b.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], b.positions[i + k]);
        max[k] = Math.max(max[k], b.positions[i + k]);
      }
    }
  }
  let dx = (min[0] + max[0]) / 2 - p[0], dz = (min[2] + max[2]) / 2 - p[2];
  const len = Math.hypot(dx, dz);
  [dx, dz] = len > 1 && Number.isFinite(len) ? [dx / len, dz / len] : [0, -1];
  return {
    eye: [p[0] - dx * 1800, p[1] + 1300, p[2] - dz * 1800],
    target: [p[0] + dx * 600, p[1] + 200, p[2] + dz * 600],
    fovY: 40,
  };
}

// A display list assembled in code, placed after a data buffer. Addresses: segment 0x0E = the
// list, 0x0D = its vertices (16-byte N64 Vtx).
export class SyntheticList {
  readonly words: number[] = [];
  readonly verts: number[] = []; // 16 bytes each, as byte values
  private readonly origins: number[] = []; // per command: data offset it was copied from, or -1

  cmd(w0: number, w1: number, origin = -1) {
    this.words.push(w0 >>> 0, w1 >>> 0);
    this.origins.push(origin);
  }

  // Points Batch.triSource entries of copied commands (in the list placed at `list`) back at the
  // data offsets they were copied from.
  remapSources(batches: Batch[], list: number): Batch[] {
    for (const b of batches) {
      if (!b.triSource) continue;
      for (let i = 0; i < b.triSource.length; i++) {
        const k = (b.triSource[i] - list) / 8;
        if (Number.isInteger(k) && k >= 0 && k < this.origins.length && this.origins[k] >= 0) b.triSource[i] = this.origins[k];
      }
    }
    return batches;
  }

  get address() {
    return 0x0e000000 + this.words.length * 4;
  }

  vertex(x: number, y: number, z: number, s: number, t: number, rgba: number): number {
    const at = this.verts.length;
    const b = (v: number) => [(v >> 8) & 0xff, v & 0xff];
    this.verts.push(...b(x), ...b(y), ...b(z), 0, 0, ...b(s), ...b(t), rgba >>> 24, (rgba >>> 16) & 0xff, (rgba >>> 8) & 0xff, rgba & 0xff);
    return 0x0d000000 + at;
  }

  // The data followed by the list and its vertices, and a resolver for the synthetic segments.
  build(data: Uint8Array): { buf: Uint8Array; list: number; vertices: number } {
    const list = (data.length + 7) & ~7;
    const vertices = list + this.words.length * 4;
    const buf = new Uint8Array(vertices + this.verts.length);
    buf.set(data);
    const dv = view(buf);
    this.words.forEach((w, i) => dv.setUint32(list + i * 4, w));
    buf.set(this.verts, vertices);
    return { buf, list, vertices };
  }
}

const F3DEX_TEXTURE_HALF = [0xbb000001, 0x80008000];
const CC_MODULATE = [0xfc127fff, 0xfffff238];
const CC_SHADE = [0xfcffffff, 0xfffe7838];
const RM_OPAQUE_F3DEX = [0xb900031d, 0x00552078];
const RM_XLU_F3DEX = [0xb900031d, 0x00504a50];

export interface ObjectMesh {
  batches: Batch[];
  skeletal: boolean;
}

// Gex 64 object: +0x08 u16 meshes, +0x0C mesh table, +0x10 animation table (non-zero: skeletal).
// Mesh: +0x00 u32 vertices, +0x04 ptr, +0x10 u32 faces, +0x14 ptr (faces, or a display-list
// stream when there are no faces), +0x18 u32 parts, +0x1C ptr, +0x30 texture pool (segment 5).
// Only the rest pose is built: skeletal part vertices are placed at their joint positions.
export function gex64ObjectMesh(data: Uint8Array, prefix: string, textures: Texture[], textureKeys: Map<string, number>): ObjectMesh | null {
  if (data.length < 0x50) return null;
  const dv = view(data);
  const u32 = (o: number) => (o >= 0 && o + 4 <= data.length ? dv.getUint32(o) : 0);
  const u16 = (o: number) => (o >= 0 && o + 2 <= data.length ? dv.getUint16(o) : 0);
  const s16 = (o: number) => (o >= 0 && o + 2 <= data.length ? dv.getInt16(o) : 0);
  const m = u32(u32(0x0c));
  if (!m || m + 0x40 > data.length) return null;
  const nVerts = u32(m), vp = u32(m + 4), nFaces = u32(m + 0x10), fp = u32(m + 0x14);
  const nParts = u32(m + 0x18), pp = u32(m + 0x1c), pool = u32(m + 0x30);
  if (!fp || nVerts > 0x4000 || nFaces > 0x8000) return null;
  const skeletal = u32(0x10) !== 0;

  const offset: number[][] = Array.from({ length: nVerts }, () => [0, 0, 0]);
  if (nParts > 1 && nParts < 256 && pp) {
    const joint: number[][] = [];
    for (let i = 0; i < nParts; i++) {
      const r = pp + 24 * i;
      const type = u16(r + 2), v0 = u16(r + 8), v1 = u16(r + 10), parent = u16(r + 18);
      const pivot = [s16(r + 12), s16(r + 14), s16(r + 16)];
      if (skeletal) {
        joint[i] = i === 0 || parent >= i ? pivot : pivot.map((x, k) => x + joint[parent][k]);
        if (i > 0) for (let v = v0; v <= v1 && v < nVerts; v++) offset[v] = joint[i];
      } else if (i > 0 && type === 1) {
        for (let v = v0; v <= v1 && v < nVerts; v++) offset[v] = pivot; // camera-facing sprite
      }
    }
  }

  const syn = new SyntheticList();
  syn.cmd(F3DEX_TEXTURE_HALF[0], F3DEX_TEXTURE_HALF[1]);
  if (nFaces > 0) {
    // Face list: 12-byte vertices {s16 x, y, z; s16; u8 r, g, b, a}, 12-byte faces {u16 v0, v1, v2;
    // u8; u8 flags; ptr aux}. flags & 2: aux = {ptr material DL; u8 s0, t0, s1, t1, s2, t2; u8
    // opaque}; flags & 8: aux is an RGBA colour.
    let material = -1;
    for (let f = 0; f < nFaces; f++) {
      const fo = fp + 12 * f;
      if (fo + 12 > data.length) break;
      const idx = [u16(fo), u16(fo + 2), u16(fo + 4)];
      if (idx.some((i) => i >= nVerts)) continue;
      const flags = data[fo + 7], aux = u32(fo + 8);
      const textured = (flags & 2) !== 0 && aux + 12 <= data.length;
      if (textured) {
        syn.cmd(CC_MODULATE[0], CC_MODULATE[1]);
        const rm = data[aux + 10] ? RM_OPAQUE_F3DEX : RM_XLU_F3DEX;
        syn.cmd(rm[0], rm[1]);
        if (u32(aux) !== material) {
          material = u32(aux);
          syn.cmd(0x06000000, material);
        }
      } else {
        syn.cmd(CC_SHADE[0], CC_SHADE[1]);
        syn.cmd(RM_OPAQUE_F3DEX[0], RM_OPAQUE_F3DEX[1]);
      }
      let first = 0;
      for (let k = 0; k < 3; k++) {
        const vo = vp + 12 * idx[k], o = offset[idx[k]];
        const rgba = !textured && flags & 8 ? aux : u32(vo + 8);
        const s = textured ? data[aux + 4 + 2 * k] << 6 : 0;
        const t = textured ? data[aux + 5 + 2 * k] << 6 : 0;
        const a = syn.vertex(s16(vo) + o[0], s16(vo + 2) + o[1], s16(vo + 4) + o[2], s, t, rgba);
        if (k === 0) first = a;
      }
      syn.cmd(0x04000000 | (3 << 10) | (3 * 16 - 1), first);
      syn.cmd(0xbf000000, 0x00000204);
    }
  } else {
    // Display-list mesh: N64 Vtx vertices and records {u16 nCmd; u8 nVtx; u8 kind; ptr material}
    // followed by nCmd inline commands (the record with nCmd 0 is the last). kind & 0x7F: 1 material
    // DL, 2 flipbook {u16 period; u16 count; ptr DL[]}, 5 untextured; kind & 0x80 translucent.
    const first = syn.verts.length;
    for (let i = 0; i < nVerts; i++) {
      const vo = vp + 16 * i, o = offset[i];
      syn.vertex(s16(vo) + o[0], s16(vo + 2) + o[1], s16(vo + 4) + o[2], s16(vo + 8), s16(vo + 10), u32(vo + 12));
    }
    let loaded = 0;
    for (let r = fp, guard = 0; guard < 4000 && r + 8 <= data.length; guard++) {
      const n = u16(r), nv = data[r + 2], kind = data[r + 3], ptr = u32(r + 4);
      const rm = kind & 0x80 ? RM_XLU_F3DEX : RM_OPAQUE_F3DEX;
      syn.cmd(rm[0], rm[1]);
      const cc = (kind & 0x7f) === 5 ? CC_SHADE : CC_MODULATE;
      syn.cmd(cc[0], cc[1]);
      if (nv && loaded + nv <= nVerts) {
        syn.cmd(0x04000000 | (nv << 10) | (nv * 16 - 1), 0x0d000000 + first + loaded * 16);
        loaded += nv;
      }
      if ((kind & 0x7f) === 1 && ptr) syn.cmd(0x06000000, ptr);
      if ((kind & 0x7f) === 2 && ptr && ptr + 8 <= data.length) syn.cmd(0x06000000, u32(ptr + 4));
      syn.cmd(0x06000000, r + 8);
      if (n === 0) break;
      r += 8 + 8 * n;
    }
  }
  syn.cmd(0xb8000000, 0);
  const { buf, list, vertices } = syn.build(data);
  const resolve = (addr: number) => {
    addr >>>= 0;
    const seg = addr >>> 24, off = addr & 0xffffff;
    if (seg === 0x0e) return list + off;
    if (seg === 0x0d) return vertices + off;
    if (seg === 0x05) return pool + off < data.length ? pool + off : -1;
    if (seg === 0) return off < data.length ? off : -1;
    return -1;
  };
  const batches = runDisplayList({
    buf, ucode: 'f3dex', resolve, textures, textureKeys, keyPrefix: prefix,
    vertexScale: 1, mirrorX: false, matrix: Z_UP, combiner: true,
  }, 0x0e000000);
  return { batches, skeletal };
}

// Gex 3 object: +0x0C mesh list (the first mesh is the default). Mesh: +0x00 u16 vertices, +0x04 u16
// faces, +0x06 u16 segments, +0x08 vertices (8 bytes: s16 x, y, z; u16), +0x0C colours (u32 RGBA per
// vertex), +0x14 faces (12 bytes: u16 v0, v1, v2; u8; u8 flags; u16; u16 uv record), +0x34 texture
// pool (segment 5). UV record: {u16; u16 material DL; s16 s0, t0, s1, t1, s2, t2}. Meshes with more
// than one segment are skinned and are not built.
export function gex3ObjectMesh(data: Uint8Array, prefix: string, textures: Texture[], textureKeys: Map<string, number>): ObjectMesh | null {
  const dv = view(data);
  const u32 = (o: number) => (o >= 0 && o + 4 <= data.length ? dv.getUint32(o) : 0);
  const u16 = (o: number) => (o >= 0 && o + 2 <= data.length ? dv.getUint16(o) : 0);
  const s16 = (o: number) => (o >= 0 && o + 2 <= data.length ? dv.getInt16(o) : 0);
  const m = u32(u32(0x0c));
  if (!m || m + 0x38 > data.length) return null;
  const nVerts = u16(m), nFaces = u16(m + 4), nSegments = u16(m + 6);
  const verts = u32(m + 8), colours = u32(m + 0x0c), faces = u32(m + 0x14), pool = u32(m + 0x34);
  if (!nVerts || !nFaces || nSegments > 1) return null;
  if (verts + 8 * nVerts !== colours || colours + 4 * nVerts !== faces || faces + 12 * nFaces > data.length) return null;

  const byMaterial = new Map<number, number[]>();
  for (let f = 0; f < nFaces; f++) {
    const dl = u16(u16(faces + 12 * f + 10) + 2);
    const list = byMaterial.get(dl);
    if (list) list.push(f);
    else byMaterial.set(dl, [f]);
  }
  const syn = new SyntheticList();
  // World render state (static DL 0x8007F228): Z buffer, shade, back-face culling, texture scale 0.5,
  // modulate combine, textured-edge render mode.
  for (const [w0, w1] of [[0xd9000000, 0], [0xd9ffffff, 0x00200405], [0xd7000002, 0x80008000], [0xfc127fff, 0xfffff238], [0xe200001c, 0xc8113078]]) syn.cmd(w0, w1);
  for (const [dl, list] of byMaterial) {
    if (dl > 0 && dl < data.length && data[dl] === 0xe7) syn.cmd(0xde000000, dl);
    else syn.cmd(0xd7000000, 0);
    for (const f of list) {
      const fo = faces + 12 * f, uv = u16(fo + 10);
      let first = 0;
      for (let k = 0; k < 3; k++) {
        const vi = u16(fo + 2 * k);
        if (vi >= nVerts) continue;
        const vo = verts + 8 * vi;
        const a = syn.vertex(s16(vo), s16(vo + 2), s16(vo + 4), s16(uv + 4 + 4 * k), s16(uv + 6 + 4 * k), u32(colours + 4 * vi));
        if (k === 0) first = a;
      }
      syn.cmd(0x01003006, first);
      syn.cmd(0x05000204, 0);
    }
  }
  syn.cmd(0xdf000000, 0);
  const { buf, list, vertices } = syn.build(data);
  const resolve = (addr: number) => {
    addr >>>= 0;
    const seg = addr >>> 24, off = addr & 0xffffff;
    if (seg === 0x0e) return list + off;
    if (seg === 0x0d) return vertices + off;
    if (seg === 0x05) return pool + off < data.length ? pool + off : -1;
    if (seg === 0) return off < data.length ? off : -1;
    return -1;
  };
  const batches = runDisplayList({
    buf, ucode: 'f3dex2', resolve, textures, textureKeys, keyPrefix: prefix,
    vertexScale: 1, mirrorX: false, geometryMode: 0, matrix: Z_UP, combiner: true,
  }, 0x0e000000);
  return { batches, skeletal: u32(0x10) !== 0 };
}
