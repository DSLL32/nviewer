// Perfect Dark display lists (docs/PERFECTDARK.md §4.5, §5.4): Rare's GBI1-family microcode (glide64 "ucode 7", Fast3D /
// F3DEX 1.x numbering) with 12-byte vertices, colour arrays, TRI4 and the file-only C0 texture macro, interpreted into
// viewer batches. The viewer's displaylist.ts can't run these lists; the combiner fold and the render-mode rules here follow
// it, with one addition for PD's pass-through forced-blend sky mode.
//
// Commands:
//   01 G_MTX       w1 = 0x03000000 + slot * 0x40: load model matrix slot (models; ctx.matrix)
//   04 G_VTX       w0: count - 1 in bits 20-23, first slot in 16-19; w1: 12-byte vertices {s16 x, y, z; u8 flags;
//                  u8 colour offset; s16 s, t}; 16 slots
//   06 G_DL        call (w0 byte 1 = 0) or branch
//   07 G_COL       w0 & 0xFFFF = bytes; w1: u32 RGBA colours; a vertex's colour is at colours + its colour offset
//   B1 TRI4        triangle k = (w1 >> 8k & 15, w1 >> 8k+4 & 15, w0 >> 4k & 15), all three equal = none
//   B5 TRI2        indices / 2 (frames only)
//   BF TRI1        indices / 10
//   B6/B7          clear/set geometry mode (F3DEX 1.x bits)
//   B8             end
//   B9/BA          other mode L (render mode, alpha compare) / H (TEXTLUT)
//   BB G_TEXTURE   on, scale
//   C0             texture macro: w0 S wrap (22-23), T wrap (20-21), offset (18-19), shift S (14-17), shift T (10-13),
//                  subcommand (0-2); w1 min (24-31), second texture (12-23), texture (0-11). A no-op for the RSP, expanded
//                  by the game at load into texture loads from the global store (§4.6). Offset 2 is the RDP's half-texel
//                  bilinear offset, which GPU filtering already has; detail textures (subcommands 0/1) are not drawn.
//   E7 FA FB FC    pipesync, prim / env colour, combiner
//   FD F0 F3 F5 F2 embedded texture: SETTIMG, LOADTLUT, LOADBLOCK, SETTILE, SETTILESIZE (models, §5.4)
import type { DlLighting } from '../displaylist';
import { decodeTexture, loadBlock, TMEM_SIZE, type TextureDesc } from '../texture';
import type { Batch, BlendMode } from '../types';
import { TXMODE_WRAP, type PdTextures } from './texture';

export const G_ZBUFFER = 0x1;
export const G_SHADE = 0x4;
export const G_SHADING_SMOOTH = 0x200;
export const G_CULL_BACK = 0x2000;
export const G_FOG = 0x10000;
export const G_LIGHTING = 0x20000;
export const G_TEXTURE_GEN = 0x40000;
/** Geometry mode the game sets before drawing BG rooms (shared state list 0x80061380). */
export const DEFAULT_GEOMETRY_MODE = G_ZBUFFER | G_SHADE | G_SHADING_SMOOTH;
/** G_RM_PASS, G_RM_AA_ZB_OPA_SURF2: the room lists set their own render modes first. */
export const DEFAULT_RENDER_MODE = 0x0c182078;

const RM_Z_CMP = 0x10, RM_Z_UPD = 0x20, RM_CVG_X_ALPHA = 0x1000, RM_FORCE_BL = 0x4000;
const RM_ZMODE_MASK = 0xc00, RM_ZMODE_XLU = 0x800, RM_ZMODE_DEC = 0xc00;

export interface PdDlStats {
  commands: number;
  triangles: number;
  textureRefs: number; // C0 commands
  textures: Set<number>; // global texture numbers the C0 commands name
  missingTextures: Set<number>;
  tileLoads: number; // LOADBLOCKs of embedded texels
  colourOutOfRange: number; // vertices whose colour offset lies outside the G_COL array
  litVertices: number; // vertices loaded with G_LIGHTING (their colour bytes are a normal)
  unknownOps: Map<number, number>;
}

export function newDlStats(): PdDlStats {
  return { commands: 0, triangles: 0, textureRefs: 0, textures: new Set(), missingTextures: new Set(), tileLoads: 0, colourOutOfRange: 0, litVertices: 0, unknownOps: new Map() };
}

export interface PdDlContext {
  buf: Uint8Array;
  /** Offset in buf of a segmented address (lists, vertices, colours, texels), -1 when it can't be resolved. */
  resolve: (addr: number) => number;
  textures: PdTextures;
  /** Identifies buf in the keys of embedded textures (e.g. the model file). */
  keyPrefix?: string;
  geometryMode?: number; // default DEFAULT_GEOMETRY_MODE
  renderMode?: number; // default DEFAULT_RENDER_MODE
  /**
   * The game's load-time combiner rewrite: SHADE alpha inputs read ENV alpha instead (verified in RAM on the fog stages and
   * Attack Ship, where shade alpha carries fog).
   */
  envAlpha?: boolean;
  /** Added to every vertex position (after ctx.matrix). */
  offset?: readonly [number, number, number];
  /** G_MTX: the column-major 4x4 (Instance.matrix layout) for a model matrix slot; the following vertices use it. */
  matrix?: (slot: number) => ArrayLike<number> | null;
  /** With G_LIGHTING, vertex colours come from these lights (colour bytes = normal); without, lit vertices are white. */
  lighting?: DlLighting;
  stats?: PdDlStats;
}

interface Group {
  batch: Omit<Batch, 'positions' | 'uvs' | 'colors' | 'triSource'>;
  pos: number[];
  uv: number[];
  col: number[];
  src: number[];
}

/** Triangles of one or more display lists, grouped into batches by texture and draw state. */
export class PdBatches {
  private readonly groups = new Map<string, Group>();

  group(texture: number, blend: BlendMode, depthTest: boolean, depthWrite: boolean, cullBack: boolean, decal: boolean): Group {
    const key = `${texture}/${blend}/${depthTest}/${depthWrite}/${cullBack}/${decal}`;
    let g = this.groups.get(key);
    if (!g) {
      g = { batch: { texture, blend, depthTest, depthWrite, cullBack, ...(decal ? { decal } : {}) }, pos: [], uv: [], col: [], src: [] };
      this.groups.set(key, g);
    }
    return g;
  }

  get triangles(): number {
    let n = 0;
    for (const g of this.groups.values()) n += g.src.length;
    return n;
  }

  /** The batches, triSource = offsets in buf of the commands that drew each triangle. */
  batches(): Batch[] {
    return [...this.groups.values()].filter((g) => g.src.length).map((g) => ({
      ...g.batch, positions: new Float32Array(g.pos), uvs: new Float32Array(g.uv), colors: new Uint8Array(g.col), triSource: new Uint32Array(g.src),
    }));
  }
}

// G_SETCOMBINE fields per cycle: colour a, b, c, d, then alpha a, b, c, d (output = (a - b) * c + d).
function decodeCombine(w0: number, w1: number): number[] {
  return [
    (w0 >>> 20) & 15, (w1 >>> 28) & 15, (w0 >>> 15) & 31, (w1 >>> 15) & 7,
    (w0 >>> 12) & 7, (w1 >>> 12) & 7, (w0 >>> 9) & 7, (w1 >>> 9) & 7,
    (w0 >>> 5) & 15, (w1 >>> 24) & 15, w0 & 31, (w1 >>> 6) & 7,
    (w1 >>> 21) & 7, (w1 >>> 3) & 7, (w1 >>> 18) & 7, w1 & 7,
  ];
}

// Both combiner cycles with TEXEL0 = TEXEL1 = 1 (displaylist.ts evalCombine): the colour the texture is multiplied by.
// LOD_FRACTION counts as 0, so PD's TRILERP first cycle gives TEXEL0.
function evalCombine(c: number[], shade: number[], prim: number[], env: number[]): number[] {
  let comb = [0, 0, 0, 0];
  for (let cycle = 0; cycle < 2; cycle++) {
    const [a, b, cc, d, aa, ab, ac, ad] = c.slice(cycle * 8, cycle * 8 + 8);
    const rgb = (code: number, k: number, slot: 'a' | 'b' | 'c' | 'd') => {
      switch (code) {
        case 0: return comb[k];
        case 1: case 2: return 1;
        case 3: return prim[k];
        case 4: return shade[k];
        case 5: return env[k];
        case 6: return slot === 'a' || slot === 'd' ? 1 : 0; // ONE / CENTER, SCALE
        case 7: return slot === 'c' ? comb[3] : 0; // COMBINED_ALPHA / NOISE, K4, 0
        case 8: case 9: return slot === 'c' ? 1 : 0; // TEXEL0/1_ALPHA
        case 10: return slot === 'c' ? prim[3] : 0;
        case 11: return slot === 'c' ? shade[3] : 0;
        case 12: return slot === 'c' ? env[3] : 0;
        default: return 0;
      }
    };
    const alpha = (code: number, slot: 'a' | 'b' | 'c' | 'd') => {
      switch (code) {
        case 0: return slot === 'c' ? 0 : comb[3]; // COMBINED / LOD_FRACTION
        case 1: case 2: return 1;
        case 3: return prim[3];
        case 4: return shade[3];
        case 5: return env[3];
        case 6: return slot === 'c' ? 0 : 1; // ONE / PRIM_LOD_FRAC
        default: return 0;
      }
    };
    const out = [0, 1, 2].map((k) => (rgb(a, k, 'a') - rgb(b, k, 'b')) * rgb(cc, k, 'c') + rgb(d, k, 'd'));
    out.push((alpha(aa, 'a') - alpha(ab, 'b')) * alpha(ac, 'c') + alpha(ad, 'd'));
    comb = out.map((v) => Math.min(1, Math.max(0, v)));
  }
  return comb;
}

const unit = (v: number) => [v >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff].map((q) => q / 255);
const pack = (c: number[]) => ((Math.round(c[0] * 255) << 24) | (Math.round(c[1] * 255) << 16) | (Math.round(c[2] * 255) << 8) | Math.round(c[3] * 255)) >>> 0;
// G_SETTILE shift: 1..10 divide texture coordinates by 2^shift, 11..15 multiply by 2^(16 - shift).
const shiftScale = (s: number) => (s > 10 ? 1 << (16 - s) : 1 / (1 << s));

interface Vtx {
  x: number; y: number; z: number;
  s: number; t: number;
  c: number; // RGBA (shaded when lit)
  gen: boolean; // G_TEXTURE_GEN coordinates in gu, gv (0..1)
  gu: number; gv: number;
}

interface TexUse {
  index: number; // into ctx.textures.textures
  width: number;
  height: number;
  shiftS: number;
  shiftT: number;
  uls: number; // whole texels subtracted from s, t (a tile's window; the RDP's half-texel filter offset is left to the GPU)
  ult: number;
}

interface Tile {
  fmt: number; siz: number; line: number; tmem: number; cms: number; cmt: number; shiftS: number; shiftT: number;
  uls: number; ult: number; width: number; height: number;
}

/**
 * Runs the display list at segmented address `start`, adding its triangles to `out`. RSP and RDP state starts from the
 * context's defaults for each call.
 */
export function runPdDisplayList(ctx: PdDlContext, start: number, out: PdBatches): void {
  const { buf, resolve, stats } = ctx;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const [ox, oy, oz] = ctx.offset ?? [0, 0, 0];
  let geom = ctx.geometryMode ?? DEFAULT_GEOMETRY_MODE;
  let rm = ctx.renderMode ?? DEFAULT_RENDER_MODE;
  let alphaCompare = 0, textLut = 0;
  const fold = new Map<number, number>(); // vertex colour → folded colour for the current combiner, prim and env
  let combine: number[] = [];
  let usesTexel = true;
  const setCombine = (w0: number, w1: number) => {
    combine = decodeCombine(w0, w1);
    if (ctx.envAlpha) for (const k of [4, 5, 6, 7, 12, 13, 14, 15]) if (combine[k] === 4) combine[k] = 5;
    usesTexel = [0, 1, 2, 3, 8, 9, 10, 11].some((k) => combine[k] === 1 || combine[k] === 2);
    fold.clear();
  };
  setCombine(0xfc26a004, 0x1f1093ff); // TRILERP, then COMBINED × SHADE
  let prim = unit(0xffffffff), env = unit(0xffffffff);
  let texOn = true, scaleS = 1, scaleT = 1;
  let c0: TexUse | null = null;
  let fromTile = false; // the last texture came from an embedded tile load, not a C0
  const mem = new Uint8Array(TMEM_SIZE);
  let timg = -1, timgSiz = 0, image = -1, palette = -1, loadKey = '';
  const tiles: Tile[] = Array.from({ length: 8 }, () => ({ fmt: 0, siz: 0, line: 0, tmem: 0, cms: 0, cmt: 0, shiftS: 0, shiftT: 0, uls: 0, ult: 0, width: 0, height: 0 }));
  let tileTex: TexUse | null | undefined; // undefined: tile state changed since it was looked up
  let colBase = -1, colCount = 0;
  let mtx: ArrayLike<number> | null = null;
  const vtx: (Vtx | undefined)[] = new Array(16);
  let cmdAddr = 0;

  const tileTexture = (): TexUse | null => {
    if (tileTex !== undefined) return tileTex;
    const t = tiles[0];
    if (image < 0 || t.width <= 0 || t.height <= 0) return (tileTex = null);
    // Colour-indexed: the RDP ignores the tile's format and uses the TLUT mode for 4/8-bit texels (model lists load CI4
    // tiles with format 0, e.g. Pcidoor1_refZ).
    const ci = palette >= 0 && (t.fmt === 2 || (textLut >= 2 && t.siz <= 1));
    const line = t.siz === 3 ? t.line * 2 : t.line;
    const wrap = (cm: number) => (cm & 2 ? 'clamp' : cm & 1 ? 'mirror' : 'repeat');
    const key = `${ctx.keyPrefix ?? ''}E${loadKey}/${t.tmem}/${line}/${ci ? palette : -1}/${t.fmt}/${t.siz}/${t.width}x${t.height}/${textLut}/${t.cms}/${t.cmt}`;
    const index = ctx.textures.addRaw(key, () => {
      const desc: TextureDesc = {
        fmt: (ci ? 2 : t.fmt) as TextureDesc['fmt'], siz: t.siz as TextureDesc['siz'], width: t.width, height: t.height, mem, tmem: t.tmem, line,
        palette: ci ? buf.subarray(palette, palette + 512) : null, tlut: textLut as TextureDesc['tlut'],
      };
      const name = ['RGBA', 'YUV', 'CI', 'IA', 'I'][ci ? 2 : t.fmt] + [4, 8, 16, 32][t.siz];
      return {
        width: t.width, height: t.height, rgba: decodeTexture(desc), wrapS: wrap(t.cms), wrapT: wrap(t.cmt),
        format: ci ? `${name}/${textLut === 3 ? 'IA16' : 'RGBA16'}` : name,
        source: `${ctx.keyPrefix ?? ''}image 0x${image.toString(16)}${ci ? ` palette 0x${palette.toString(16)}` : ''}`,
      };
    });
    return (tileTex = index >= 0 ? { index, width: t.width, height: t.height, shiftS: t.shiftS, shiftT: t.shiftT, uls: Math.floor(t.uls), ult: Math.floor(t.ult) } : null);
  };

  const tri = (a: number, b: number, c: number) => {
    const va = vtx[a], vb = vtx[b], vc = vtx[c];
    if (!va || !vb || !vc) return;
    const tex = texOn && usesTexel ? (fromTile ? tileTexture() : c0) : null;
    const zmode = rm & RM_ZMODE_MASK;
    // Translucent only when the forced blend mixes with the framebuffer: cycle 2 (CLR_MEM, 1MA). Skedar Ruins' sky room
    // forces blending with a pass-through blender (0x0F0A4000): an opaque surface without depth.
    const memoryBlend = ((rm >>> 20) & 3) === 1 && ((rm >>> 16) & 3) === 0;
    const blend: BlendMode = rm & RM_FORCE_BL && memoryBlend && (zmode === RM_ZMODE_XLU || !(rm & RM_Z_UPD))
      ? 'blend'
      : rm & RM_CVG_X_ALPHA || alphaCompare === 1 ? 'cutout' : 'opaque';
    const zbuf = (geom & G_ZBUFFER) !== 0;
    const depthTest = zbuf && (rm & RM_Z_CMP) !== 0;
    const depthWrite = zbuf && (rm & RM_Z_UPD) !== 0 && blend !== 'blend';
    const g = out.group(tex ? tex.index : -1, blend, depthTest, depthWrite, (geom & G_CULL_BACK) !== 0, depthTest && zmode === RM_ZMODE_DEC);
    g.src.push(cmdAddr);
    if (stats) stats.triangles++;
    const su = tex ? (scaleS * shiftScale(tex.shiftS)) / (32 * tex.width) : 0;
    const sv = tex ? (scaleT * shiftScale(tex.shiftT)) / (32 * tex.height) : 0;
    for (const v of [va, vb, vc]) {
      g.pos.push(v.x, v.y, v.z);
      if (!tex) g.uv.push(0, 0);
      else if (v.gen) g.uv.push(v.gu, v.gv);
      else g.uv.push(v.s * su - tex.uls / tex.width, v.t * sv - tex.ult / tex.height);
      let folded = fold.get(v.c);
      if (folded === undefined) fold.set(v.c, (folded = pack(evalCombine(combine, unit(v.c), prim, env))));
      g.col.push(folded >>> 24, (folded >>> 16) & 0xff, (folded >>> 8) & 0xff, folded & 0xff);
    }
  };

  const vertices = (addr: number, n: number, first: number) => {
    const base = resolve(addr);
    if (base < 0) return;
    const lit = (geom & G_LIGHTING) !== 0;
    const gen = lit && (geom & G_TEXTURE_GEN) !== 0;
    const m = mtx;
    for (let k = 0; k < n; k++) {
      const o = base + k * 12;
      if (o + 12 > buf.length) break;
      let x = dv.getInt16(o), y = dv.getInt16(o + 2), z = dv.getInt16(o + 4);
      if (m) {
        const tx = m[0] * x + m[4] * y + m[8] * z + m[12];
        const ty = m[1] * x + m[5] * y + m[9] * z + m[13];
        z = m[2] * x + m[6] * y + m[10] * z + m[14];
        x = tx;
        y = ty;
      }
      const ci = buf[o + 7];
      let c = 0xffffffff;
      if (colBase >= 0 && ci >> 2 < colCount && colBase + ci + 4 <= buf.length) c = dv.getUint32(colBase + ci);
      else if (stats) stats.colourOutOfRange++;
      const v: Vtx = { x: x + ox, y: y + oy, z: z + oz, s: dv.getInt16(o + 8), t: dv.getInt16(o + 10), c, gen: false, gu: 0, gv: 0 };
      if (lit) {
        if (stats) stats.litVertices++;
        let nx = c >> 24, ny = (c << 8) >> 24, nz = (c << 16) >> 24;
        if (m) {
          const tx = nx * m[0] + ny * m[4] + nz * m[8];
          const ty = nx * m[1] + ny * m[5] + nz * m[9];
          nz = nx * m[2] + ny * m[6] + nz * m[10];
          nx = tx;
          ny = ty;
        }
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        let r = 255, gg = 255, bl = 255;
        if (ctx.lighting) {
          [r, gg, bl] = ctx.lighting.ambient;
          for (const l of ctx.lighting.lights) {
            const d = Math.max(0, nx * l.dir[0] + ny * l.dir[1] + nz * l.dir[2]);
            r += l.color[0] * d;
            gg += l.color[1] * d;
            bl += l.color[2] * d;
          }
        }
        const q = (value: number) => Math.min(255, Math.round(value));
        v.c = ((q(r) << 24) | (q(gg) << 16) | (q(bl) << 8) | (c & 0xff)) >>> 0;
        if (gen) {
          v.gen = true;
          v.gu = nx * 0.5 + 0.5;
          v.gv = -ny * 0.5 + 0.5;
        }
      }
      vtx[(first + k) & 15] = v;
    }
  };

  const stack: number[] = [];
  let pc = resolve(start);
  for (let steps = 0; steps < 200000 && pc >= 0 && pc + 8 <= buf.length; steps++) {
    const w0 = dv.getUint32(pc), w1 = dv.getUint32(pc + 4), op = w0 >>> 24;
    cmdAddr = pc;
    pc += 8;
    if (stats) stats.commands++;
    switch (op) {
      case 0x01: // G_MTX (flags byte 1: 1 projection, 2 load, 4 push)
        if (!((w0 >>> 16) & 1) && ctx.matrix && w1 >>> 24 === 3) mtx = ctx.matrix((w1 & 0xffffff) / 0x40);
        break;
      case 0x04:
        vertices(w1, ((w0 >>> 20) & 15) + 1, (w0 >>> 16) & 15);
        break;
      case 0x06: {
        const target = resolve(w1);
        if (target < 0) break;
        if (((w0 >>> 16) & 0xff) === 0) stack.push(pc);
        pc = target;
        break;
      }
      case 0x07:
        colBase = resolve(w1);
        colCount = (w0 & 0xffff) >> 2;
        break;
      case 0xb1:
        for (let k = 0; k < 4; k++) {
          const a = (w1 >>> (8 * k)) & 15, b = (w1 >>> (8 * k + 4)) & 15, c = (w0 >>> (4 * k)) & 15;
          if (!(a === b && b === c)) tri(a, b, c);
        }
        break;
      case 0xb5:
        tri(((w0 >>> 16) & 0xff) >> 1, ((w0 >>> 8) & 0xff) >> 1, (w0 & 0xff) >> 1);
        tri(((w1 >>> 16) & 0xff) >> 1, ((w1 >>> 8) & 0xff) >> 1, (w1 & 0xff) >> 1);
        break;
      case 0xbf:
        tri(((w1 >>> 16) & 0xff) / 10, ((w1 >>> 8) & 0xff) / 10, (w1 & 0xff) / 10);
        break;
      case 0xb6:
        geom = (geom & ~w1) >>> 0;
        break;
      case 0xb7:
        geom = (geom | w1) >>> 0;
        break;
      case 0xb8:
        if (!stack.length) return;
        pc = stack.pop()!;
        break;
      case 0xb9: { // G_SETOTHERMODE_L
        const shift = (w0 >>> 8) & 0xff, len = w0 & 0xff;
        const mask = len >= 32 ? 0xffffffff : (((1 << len) - 1) << shift) >>> 0;
        if (shift === 0) alphaCompare = w1 & 3;
        if (shift <= 3 && shift + len > 3) rm = ((rm & ~mask) | (w1 & mask)) >>> 0;
        break;
      }
      case 0xba: { // G_SETOTHERMODE_H
        const shift = (w0 >>> 8) & 0xff, len = w0 & 0xff;
        if (shift <= 14 && shift + len >= 16) {
          textLut = (w1 >>> 14) & 3;
          tileTex = undefined;
        }
        break;
      }
      case 0xbb:
        texOn = (w0 & 1) !== 0;
        scaleS = (w1 >>> 16) / 65536;
        scaleT = (w1 & 0xffff) / 65536;
        break;
      case 0xc0: {
        const num = w1 & 0xfff;
        const index = ctx.textures.add(num, TXMODE_WRAP[(w0 >>> 22) & 3], TXMODE_WRAP[(w0 >>> 20) & 3]);
        const img = index >= 0 ? ctx.textures.image(num) : null;
        // The shift fields belong to the detail tile of subcommands 0/1 (15/15, 14/14): the expanded lists in the Defection
        // frame load the base texture's level 0 into tile 0 with shift 0 every time.
        c0 = img ? { index, width: img.width, height: img.height, shiftS: 0, shiftT: 0, uls: 0, ult: 0 } : null;
        fromTile = false;
        if (stats) {
          stats.textureRefs++;
          (img ? stats.textures : stats.missingTextures).add(num);
        }
        break;
      }
      case 0xfd: // G_SETTIMG
        timg = resolve(w1);
        timgSiz = (w0 >>> 19) & 3;
        break;
      case 0xf3: { // G_LOADBLOCK
        if (timg < 0) break;
        const tile = tiles[(w1 >>> 24) & 7];
        const bytes = ((((w1 >>> 12) & 0xfff) - ((w0 >>> 12) & 0xfff) + 1) << timgSiz) >> 1;
        loadBlock(mem, buf, timg, bytes, tile.tmem, w1 & 0xfff, tile.siz as TextureDesc['siz']);
        image = timg;
        loadKey = `${timg}/${bytes}/${tile.tmem}/${w1 & 0xfff}/${tile.siz}`;
        fromTile = true;
        tileTex = undefined;
        if (stats) stats.tileLoads++;
        break;
      }
      case 0xf0: // G_LOADTLUT
        palette = timg;
        tileTex = undefined;
        break;
      case 0xf5: { // G_SETTILE
        const t = tiles[(w1 >>> 24) & 7];
        t.fmt = (w0 >>> 21) & 7;
        t.siz = (w0 >>> 19) & 3;
        t.line = ((w0 >>> 9) & 0x1ff) * 8;
        t.tmem = (w0 & 0x1ff) * 8;
        t.cmt = (w1 >>> 18) & 3;
        t.shiftT = (w1 >>> 10) & 0xf;
        t.cms = (w1 >>> 8) & 3;
        t.shiftS = w1 & 0xf;
        tileTex = undefined;
        break;
      }
      case 0xf2: { // G_SETTILESIZE
        const t = tiles[(w1 >>> 24) & 7];
        t.uls = ((w0 >>> 12) & 0xfff) / 4;
        t.ult = (w0 & 0xfff) / 4;
        t.width = (((w1 >>> 12) & 0xfff) >> 2) - (((w0 >>> 12) & 0xfff) >> 2) + 1;
        t.height = ((w1 & 0xfff) >> 2) - ((w0 & 0xfff) >> 2) + 1;
        tileTex = undefined;
        break;
      }
      case 0xfa:
        prim = unit(w1);
        fold.clear();
        break;
      case 0xfb:
        env = unit(w1);
        fold.clear();
        break;
      case 0xfc:
        setCombine(w0, w1);
        break;
      case 0x00: case 0xb2: case 0xb3: case 0xb4: case 0xbc: case 0xbd: case 0xbe:
      case 0xe6: case 0xe7: case 0xe8: case 0xe9: case 0xed: case 0xee: case 0xef: case 0xf6: case 0xf7: case 0xf8: case 0xf9:
        break; // no-ops, sync, scissor, fill/fog/blend colours, frame-only RDP words: nothing the batches carry
      default:
        if (stats) stats.unknownOps.set(op, (stats.unknownOps.get(op) ?? 0) + 1);
    }
  }
}
