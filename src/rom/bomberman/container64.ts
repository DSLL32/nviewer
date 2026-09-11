// The "64" model container of Bomberman 64 and Bomberman Hero.
//
//   +0x00 u32 0x36340038   +0x04 u32 nRecords   +0x08 u32 0x02020202
//   +0x0C nRecords x {u32 type, u32 param, u32 offset (from the container start)}
// Types: 0 display list, 5 billboard list, 6 scrolling-texture list, 8 environment-mapped
// list (all F3DEX 1.x, drawn with segment 2 = container start); 1 node tree (param =
// root node); 0x12 / 0x15 / 0x16 / 0x19 CI4 / CI8 / RGBA16 / RGBA32 image (param = width
// << 16 | height); 0x1A RGBA16 palette; others hold animation or tags.
import { type DlLighting, type Mtx, mulMtx, runDisplayList } from '../displaylist';
import type { Batch, Texture } from '../types';
import { view } from '../util';
import { decodeImage, type PixelFormat } from './common';

export interface Record64 {
  type: number;
  param: number;
  offset: number;
}

const MAGIC = 0x36340038;
const DL_TYPES = new Set([0, 5, 6, 8]);

// Game code draws the containers with ZBUFFER | SHADE | SMOOTH | CULL_BACK | LIGHTING and
// render mode Z_CMP | Z_UPD | CVG_X_ALPHA | ALPHA_CVG_SEL (cutout by texel alpha).
const GEOMETRY_MODE = 0x22205;
const RENDER_MODE = 0x00553078;
const G_TEXTURE_GEN = 0x40000;

export function records64(buf: Uint8Array, base = 0): Record64[] | null {
  const dv = view(buf);
  if (base < 0 || base + 12 > buf.length || dv.getUint32(base) !== MAGIC) return null;
  const n = dv.getUint32(base + 4);
  if (base + 12 + n * 12 > buf.length) return null;
  const out: Record64[] = [];
  for (let i = 0; i < n; i++) {
    const o = base + 12 + i * 12;
    out.push({ type: dv.getUint32(o), param: dv.getUint32(o + 4), offset: dv.getUint32(o + 8) });
  }
  return out;
}

export interface Draw64Options {
  textures: Texture[];
  textureKeys: Map<string, number>;
  keyPrefix: string;
  lighting: DlLighting;
  // Walk the node tree when there is one (models); otherwise, or when false, draw every
  // display-list record at the container origin (maps).
  useTree?: boolean;
  matrix?: Mtx;
}

const IDENTITY: Mtx = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// Right-handed rotation about X (0), Y (1) or Z (2), row-vector convention.
function rotation(axis: number, a: number): Mtx {
  const c = Math.cos(a), s = Math.sin(a);
  const m = IDENTITY.slice();
  if (axis === 0) { m[5] = c; m[6] = s; m[9] = -s; m[10] = c; }
  if (axis === 1) { m[0] = c; m[2] = -s; m[8] = s; m[10] = c; }
  if (axis === 2) { m[0] = c; m[1] = s; m[4] = -s; m[5] = c; }
  return m;
}

// Triangles of a container at `base` within `buf`.
export function drawContainer(buf: Uint8Array, base: number, opts: Draw64Options): Batch[] {
  const recs = records64(buf, base);
  if (!recs) return [];
  const dv = view(buf);
  const batches: Batch[] = [];
  const resolve = (addr: number) => {
    if (addr >>> 24 !== 2) return -1;
    const o = base + (addr & 0xffffff);
    return o < buf.length ? o : -1;
  };
  const draw = (index: number, matrix: Mtx) => {
    const r = recs[index];
    if (!r || !DL_TYPES.has(r.type) || base + r.offset >= buf.length) return;
    batches.push(...runDisplayList({
      buf, ucode: 'f3dex', resolve, textures: opts.textures, textureKeys: opts.textureKeys, keyPrefix: opts.keyPrefix,
      vertexScale: 1, mirrorX: false,
      geometryMode: GEOMETRY_MODE | (r.type === 8 ? G_TEXTURE_GEN : 0), renderMode: RENDER_MODE,
      lighting: opts.lighting, matrix, textureGen: true, decals: true,
    }, 0x02000000 | r.offset));
  };
  const root = opts.matrix ?? IDENTITY;
  const tree = opts.useTree === false ? undefined : recs.find((r) => r.type === 1);
  if (tree) {
    // 48-byte nodes: s32 record to draw (-1 none), f32 translation, rotation (degrees, X
    // then Y then Z), scale (unused by static poses), s32 next sibling and first child as
    // relative node indices. A node transforms its record and its children.
    const seen = new Set<number>();
    const visit = (first: number, parent: Mtx, depth: number) => {
      for (let i = first; depth < 64; ) {
        const o = base + tree.offset + i * 48;
        if (i < 0 || o + 48 > buf.length || seen.has(i)) return;
        seen.add(i);
        const t = [dv.getFloat32(o + 4), dv.getFloat32(o + 8), dv.getFloat32(o + 12)];
        let local: Mtx = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1];
        for (let axis = 2; axis >= 0; axis--) {
          const deg = dv.getFloat32(o + 16 + axis * 4);
          if (deg && Number.isFinite(deg)) local = mulMtx(rotation(axis, (deg * Math.PI) / 180), local);
        }
        const m = t[0] || t[1] || t[2] || local[0] !== 1 || local[5] !== 1 ? mulMtx(local, parent) : parent;
        const rec = dv.getInt32(o);
        if (rec >= 0) draw(rec, m);
        const child = dv.getInt32(o + 44);
        if (child) visit(i + child, m, depth + 1);
        const next = dv.getInt32(o + 40);
        if (!next) return;
        i += next;
      }
    };
    visit(tree.param, root, 0);
  } else {
    recs.forEach((_, i) => draw(i, root));
  }
  return batches;
}

const IMAGE_FORMATS: Record<number, PixelFormat> = { 0x12: 'CI4', 0x15: 'CI8', 0x16: 'RGBA16', 0x19: 'RGBA32' };

// The first image record of a container (with the palette that follows it), decoded.
export function containerImage(buf: Uint8Array, base = 0): Texture | null {
  const recs = records64(buf, base);
  if (!recs) return null;
  for (let i = 0; i < recs.length; i++) {
    const format = IMAGE_FORMATS[recs[i].type];
    if (!format) continue;
    const w = recs[i].param >>> 16, h = recs[i].param & 0xffff;
    if (!w || !h || w > 1024 || h > 1024) continue;
    const pal = recs.slice(i + 1).find((r) => r.type === 0x1a);
    return decodeImage(buf, base + recs[i].offset, format, w, h, format.startsWith('CI') && pal ? base + pal.offset : -1);
  }
  return null;
}
