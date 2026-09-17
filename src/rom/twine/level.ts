// 007: The World Is Not Enough (NO7E/NO7P): archive meshes, placements, and scene layers.
// Addresses refer to the USA executable unless a release-specific value is selected below.
import { edlDecompress, edlHeader } from './edl';
import type { Batch, BlendMode, CameraView, Fog, Instance, Level, LevelInfo, LevelLayer, Marker, Mesh, Texture, WrapMode } from '../types';
import { decodeRows } from '../texture';
import { typeInfo, type ObjLayer } from './objtypes';

export const ENTRIES = 507;
// The game converts float vertices to s16 as trunc(f * 64) (0x800328CC). We keep that unit.
export const WORLD_SCALE = 64;
const DEG4096 = Math.PI / (180 * 4096); // record angle unit: 0x368EFA36 (0x800411C0) = pi / 180 / 4096

const levelList = (kind: LevelInfo['kind'], rows: [number, string][]): LevelInfo[] =>
  rows.map(([index, name]) => ({ index, name, kind }));
export const LEVELS: LevelInfo[] = [
  // campaign order = mission table 0x800C02C0 order
  ...levelList('campaign', [[2, 'Courier'], [20, "King's Ransom"], [16, 'Thames Chase'], [34, 'Underground Uprising'],
    [25, 'Cold Reception'], [38, 'Night Watch'], [1, 'Midnight Departure'], [11, 'Masquerade'], [41, 'City of Walkways I'],
    [40, 'City of Walkways II'], [28, 'Turncoat'], [18, 'Fallen Angel'], [29, 'A Sinking Feeling'], [33, 'Meltdown']]),
  ...levelList('battle', [[24, 'Labyrinth'], [31, 'Frostbite'], [7, 'Istanbul'], [12, 'Forest'], [39, 'Hidden Volcano'],
    [9, 'Field of Fire'], [26, 'Sky Rail'], [32, 'Submarine'], [0, 'Air Raid'], [21, 'MI-6'], [22, 'Silo Surprise'],
    [19, 'Merchant'], [23, 'Flashpoint'], [4, 'Castle']]),
  // no mission record: front end (36), title (15) and scene-script sets (hypothesis)
  ...levelList('other', [3, 5, 6, 10, 13, 14, 30, 35].map((i): [number, string] => [i, `Scene set ${i}`])),
  { index: 8, name: 'Unreleased arena', kind: 'other', group: 'Archive sets' },
  { index: 17, name: 'Tower island', kind: 'other', group: 'Archive sets' },
  { index: 15, name: 'Title / attract set', kind: 'other', group: 'Archive sets' },
  { index: 36, name: 'Front-end set', kind: 'other', group: 'Archive sets' },
];

export interface EntryHeader {
  recOff: number; nRecs: number; off28: number; n28: number; palTab: number; nPal: number;
  texTab: number; nTex: number; palBlob: number; palSize: number; texBlob: number; texSize: number;
}

export interface SubHeader {
  offA: number; nA: number; offB: number; nB: number; offC: number; nC: number; offD: number; nD: number;
  type: number; b1f: number;
}

export interface Record44 {
  index: number;
  node: number; // u16 +00
  x: number; y: number; z: number; // f32 +0C
  rx: number; ry: number; rz: number; // f32 +18, units of 1/4096 degree
  subOff: number; // u32 +24
  modelId: number; // s16 at the u32 pointer +28 (0x800C2740 + 2 * id)
  flags2e: number; // u16 +2E
  raw: Uint8Array;
}

// Draw mode (node byte +0x45) from the sub-header type byte +0x1E, as 0x800411C0 assigns it (jump tables 0x800D3320,
// 0x800D36B8). Types in LIST_A take the 0x800412F0 branch (built only when the loader flag is set, i.e. for model
// entries; for level entries these records become spawned objects) and always use mode 1.
const LIST_A = new Set([20, 21, 24, 25, 26, 27, 30, 31, 33, 34, 39, 60, 61, 62, 64, 66, 67, 68, 69, 70, 71, 72, 73, 77, 79,
  80, 82, 83, 104, 132, 133, 134, 135, 136, 137, 138, 139, 140, 153, 154, 155, 156, 157, 158, 200]);
const TYPE_MODE: Record<number, number> = {
  52: 5, 81: 5, 122: 5, 125: 5, 119: 5, 128: 5, 121: 3, 117: 12, 50: 12, 151: 10, 118: 4, 51: 4, 199: 15, 120: 6, 53: 6, 85: 9,
  // runtime (emu2 request C): the type-114 glow object (spawn 0x8005B39C) is drawn with mode 12 = 0x800B1AF0, 005049D8
  // translucent, TEXEL0*SHADE, no fog
  114: 12,
};
export function drawMode(type: number): number {
  return LIST_A.has(type) ? 1 : TYPE_MODE[type] ?? 1;
}
export function isListA(type: number) {
  return LIST_A.has(type);
}

// Records the spawn pass 0x80042CFC (switch on sub+0x1E, table 0x800D3950) turns into actors (characters, pickups):
// types 14/17 -> 0x80081134, 35 -> 0x80064A18, 36-38/44 -> 0x80064264, 201 -> 0x800750B0. Their own mesh is the
// magenta placeholder model 420 (ROM data: B = ff00ffff), not something the game draws.
export const ACTOR_TYPES = new Set([14, 17, 35, 36, 37, 38, 44, 201]);
export const MARKER_MODEL = 420;
// Environment records: types 41/42 copy rec+0x2C..+0x3F into 0x801007CC.., 0x801096A0, 0x80115040, 0x800C0740
// (handler 0x800437E8); type 41 also registers its mesh as the sky object (0x8004478C -> 0x8010D450). Types 43, 121,
// 122 register theirs as a second layer (-> 0x801003D8, drawn first by the pass at 0x80036254). Type 42's own mesh is a
// 3-4 vertex placeholder.
export const SKY_TYPES = new Set([41, 43, 121, 122]);
export const ENV_ONLY_TYPES = new Set([42]);
// Hypothesis (needs a runtime check): 4-vertex helper planes (portals/triggers). Over all levels 71% (30), 90% (31) and
// 79% (104) of their triangles are untextured op8 planes or use fully transparent (alpha 0) CI texels; the rest paint
// solid planes across paths (Cold Reception's yellow quads) that are not in the game's view.
export const HELPER_TYPES = new Set([30, 31, 104]);
export function gameVisible(rec: Record44, sub: SubHeader): boolean {
  return rec.modelId !== MARKER_MODEL && !ACTOR_TYPES.has(sub.type) && !ENV_ONLY_TYPES.has(sub.type) && !HELPER_TYPES.has(sub.type);
}

// Render state per draw mode, from 0x80008750 (state lists 0x800B1A00.., combiners) and the texture setter 0x80032978
// (modes 5, 6, 9, 15: intensity textures without TLUT, others CI4/CI8 with an RGBA16 TLUT).
interface ModeState {
  blend: BlendMode; cull: boolean; depthTest: boolean; depthWrite: boolean; intensity: boolean;
  colour: 'shade' | 'white'; alpha: 'texel' | 'shade';
}
const MODES: Record<number, ModeState> = {};
{
  const cut = { blend: 'cutout' as BlendMode, cull: true, depthTest: true, depthWrite: true, intensity: false, colour: 'shade' as const, alpha: 'texel' as const };
  const xlu = { blend: 'blend' as BlendMode, cull: false, depthTest: true, depthWrite: false, intensity: false, colour: 'shade' as const, alpha: 'shade' as const };
  for (const m of [1, 2, 11, 14]) MODES[m] = cut;
  for (const m of [3, 4, 7, 8]) MODES[m] = xlu;
  for (const m of [10, 12, 13, 16]) MODES[m] = { ...xlu, cull: true };
  for (const m of [5, 6]) MODES[m] = { ...xlu, intensity: true, colour: 'white', alpha: 'texel' };
  for (const m of [9, 15]) MODES[m] = { ...xlu, depthTest: false, intensity: true, colour: 'white', alpha: 'texel' };
}

export class TwineRom {
  readonly dv: DataView;
  readonly archive: number;
  readonly entryTable: number;
  readonly identityTable: number;
  readonly region: 'U' | 'E';
  private compCache = new Map<string, Uint8Array>();
  private headers = new Map<number, EntryHeader>();
  constructor(readonly rom: Uint8Array) {
    this.dv = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
    const code = String.fromCharCode(...rom.subarray(0x3b, 0x3f));
    if (code !== 'NO7E' && code !== 'NO7P') throw new Error(`Not The World Is Not Enough: ${code}`);
    this.region = code === 'NO7E' ? 'U' : 'E';
    this.archive = this.region === 'U' ? 0x54d910 : 0x54e8d0;
    this.entryTable = this.region === 'U' ? 0xc1380 : 0xc1e70;
    this.identityTable = this.region === 'U' ? 0x800c2740 : 0x800c3230;
  }
  u8(o: number) { return this.rom[o]; }
  u16(o: number) { return this.dv.getUint16(o); }
  s16(o: number) { return this.dv.getInt16(o); }
  u32(o: number) { return this.dv.getUint32(o); }
  f32(o: number) { return this.dv.getFloat32(o); }

  header(entry: number): EntryHeader {
    let h = this.headers.get(entry);
    if (!h) {
      const o = this.archive + this.u32(this.entryTable + 16 * entry);
      const w = (i: number) => this.u32(o + 4 * i);
      h = { recOff: w(0), nRecs: w(1), off28: w(2), n28: w(3), palTab: w(4), nPal: w(5), texTab: w(6), nTex: w(7),
        palBlob: w(8), palSize: w(9), texBlob: w(10), texSize: w(11) };
      this.headers.set(entry, h);
    }
    return h;
  }

  // An archive-relative component: EDL-compressed if it starts with the magic (0x8001499C), else raw `size` bytes.
  comp(off: number, size: number): Uint8Array {
    const key = `${off}:${size}`;
    let d = this.compCache.get(key);
    if (!d) {
      const a = this.archive + off;
      d = edlHeader(this.rom, a) ? edlDecompress(this.rom, a) : this.rom.subarray(a, a + size);
      this.compCache.set(key, d);
    }
    return d;
  }

  records(entry: number): Record44[] {
    const h = this.header(entry);
    const out: Record44[] = [];
    for (let i = 0; i < h.nRecs; i++) {
      const o = this.archive + h.recOff + 0x44 * i;
      const ptr = this.u32(o + 0x28);
      out.push({
        index: i, node: this.u16(o), x: this.f32(o + 0x0c), y: this.f32(o + 0x10), z: this.f32(o + 0x14),
        rx: this.f32(o + 0x18), ry: this.f32(o + 0x1c), rz: this.f32(o + 0x20), subOff: this.u32(o + 0x24),
        modelId: ptr ? (ptr - this.identityTable) / 2 : -1, flags2e: this.u16(o + 0x2e), raw: this.rom.subarray(o, o + 0x44),
      });
    }
    return out;
  }

  sub(subOff: number): SubHeader {
    const o = this.archive + subOff;
    return { offA: this.u32(o), nA: this.u16(o + 4), offB: this.u32(o + 8), nB: this.u16(o + 12), offC: this.u32(o + 16),
      nC: this.u16(o + 20), offD: this.u32(o + 24), nD: this.u16(o + 28), type: this.u8(o + 30), b1f: this.u8(o + 31) };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// D command stream (builder 0x800336FC, jump table 0x800D2E68)

export type DCmd =
  | { op: 0 | 1 | 2 | 3; at: number; verts: [number, number, number][] } // {pos, uv, colour} indices -> G_VTX
  | { op: 4 | 5 | 8; at: number; tris: [number, number, number][]; extra?: number[] }
  | { op: 6; at: number; pal: number; tex: number; tris: [number, number, number][] }
  | { op: 7; at: number; tex: number; tris: [number, number, number][] }
  | { op: 9; at: number }
  | { op: 10; at: number; tex: number }
  | { op: 11; at: number; pal: number };

export function parseD(d: Uint8Array): DCmd[] {
  const out: DCmd[] = [];
  let p = 0;
  const tris = (q: number, n: number) => {
    const t: [number, number, number][] = [];
    for (let k = 0; k < n; k++) t.push([d[q + 3 * k], d[q + 3 * k + 1], d[q + 3 * k + 2]]);
    return t;
  };
  for (;;) {
    if (p >= d.length) throw new Error('D stream without end');
    const op = d[p];
    if (op === 12) return out;
    switch (op) {
      case 0: case 1: case 2: case 3: {
        const n = d[p + 1];
        const sz = [3, 6, 2, 1][op];
        const verts: [number, number, number][] = [];
        for (let k = 0; k < n; k++) {
          const q = p + 2 + sz * k;
          if (op === 0) verts.push([d[q], d[q + 1], d[q + 2]]);
          else if (op === 1) verts.push([(d[q] << 8) | d[q + 1], (d[q + 2] << 8) | d[q + 3], (d[q + 4] << 8) | d[q + 5]]);
          else if (op === 2) { const i = (d[q] << 8) | d[q + 1]; verts.push([i, i, i]); }
          else verts.push([d[q], d[q], d[q]]);
        }
        out.push({ op, at: p, verts });
        p += 2 + sz * n;
        break;
      }
      case 4:
        out.push({ op: 4, at: p, tris: [[d[p + 1], d[p + 2], d[p + 3]]] });
        p += 4;
        break;
      case 5: out.push({ op: 5, at: p, tris: tris(p + 2, d[p + 1]) }); p += 2 + 3 * d[p + 1]; break;
      case 6: out.push({ op: 6, at: p, pal: d[p + 1], tex: d[p + 2], tris: tris(p + 4, d[p + 3]) }); p += 4 + 3 * d[p + 3]; break;
      case 7: out.push({ op: 7, at: p, tex: d[p + 1], tris: tris(p + 3, d[p + 2]) }); p += 3 + 3 * d[p + 2]; break;
      case 8: out.push({ op: 8, at: p, extra: [d[p + 1], d[p + 2], d[p + 3]], tris: tris(p + 5, d[p + 4]) }); p += 5 + 3 * d[p + 4]; break;
      case 9: out.push({ op: 9, at: p }); p += 4; break;
      case 10: out.push({ op: 10, at: p, tex: d[p + 1] }); p += 2; break;
      case 11: out.push({ op: 11, at: p, pal: d[p + 1] }); p += 2; break;
      default: throw new Error(`bad D opcode ${op} at ${p}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Level building

export interface DecodeOptions {
  rotOrder?: string; // order the per-axis rotations are applied to a vertex, e.g. 'xyz' = Rx first
  mirrorX?: boolean;
  include?: (rec: Record44, sub: SubHeader) => boolean;
  op8Textured?: boolean; // op8 triangles keep the previously selected texture (default: untextured)
  skies?: boolean; // put sky-type records (SKY_TYPES) into Level.skies instead of instances
}

export interface LevelStats {
  records: number; meshes: number; triangles: number; textures: number; skipped: number; failures: string[];
  types: Record<string, number>;
}

interface BatchAcc {
  batch: Omit<Batch, 'positions' | 'uvs' | 'colors'>;
  pos: number[]; uv: number[]; col: number[];
}

export class TwineLevelBuilder {
  textures: Texture[] = [];
  private texKeys = new Map<string, number>();
  meshes: Mesh[] = [];
  private meshKeys = new Map<string, number>();
  failures: string[] = [];
  triangles = 0;
  constructor(readonly r: TwineRom, readonly opts: DecodeOptions = {}) {}

  texture(modelId: number, texIdx: number, palIdx: number, intensity: boolean): number {
    const key = `${modelId}:${texIdx}:${palIdx}:${intensity ? 'I' : 'CI'}`;
    const got = this.texKeys.get(key);
    if (got !== undefined) return got;
    const { r } = this;
    const h = r.header(modelId);
    let idx = -1;
    if (texIdx < h.nTex) {
      const o = r.archive + h.texTab + 12 * texIdx;
      const flags = r.u8(o);
      const w = r.u16(o + 2) + 1;
      const hh = r.u16(o + 4) + 1;
      const off = r.u32(o + 8);
      const tex = r.comp(h.texBlob, h.texSize);
      const bits = flags & 1 ? 8 : 4;
      const n = Math.ceil((w * hh * bits) / 8);
      const data = tex.slice(off, off + n);
      if (bits === 4) for (let i = 0; i < data.length; i++) data[i] = ((data[i] << 4) | (data[i] >> 4)) & 0xff; // 0x80041F68
      let rgba: Uint8Array;
      let format: string;
      let source = `entry ${modelId} tex ${texIdx} @${(r.archive + h.texBlob).toString(16)}+${off.toString(16)} flags ${flags.toString(16)}`;
      if (intensity) {
        rgba = decodeRows(data, 0, 4 /* I */, bits === 4 ? 0 : 1, w, hh, null, 0);
        format = bits === 4 ? 'I4' : 'I8';
      } else {
        const po = r.archive + h.palTab + 8 * Math.min(palIdx, h.nPal - 1);
        const count = r.u8(po) + 1;
        const poff = r.u32(po + 4) * 2;
        const pal = r.comp(h.palBlob, h.palSize).subarray(poff, poff + 2 * count);
        rgba = decodeRows(data, 0, 2 /* CI */, bits === 4 ? 0 : 1, w, hh, pal, 2 /* RGBA16 */);
        format = `${bits === 4 ? 'CI4' : 'CI8'}/RGBA16(${count})`;
        source += ` pal ${palIdx} +${poff.toString(16)}`;
      }
      const wrapS: WrapMode = flags & 2 ? 'clamp' : 'repeat';
      const wrapT: WrapMode = flags & 4 ? 'clamp' : 'repeat';
      idx = this.textures.length;
      this.textures.push({ width: w, height: hh, rgba, wrapS, wrapT, format, source });
    } else {
      this.failures.push(`texture ${texIdx} >= nTex ${h.nTex} (entry ${modelId})`);
    }
    this.texKeys.set(key, idx);
    return idx;
  }

  mesh(modelId: number, subOff: number, mode: number): number {
    const key = `${modelId}:${subOff}:${mode}`;
    const got = this.meshKeys.get(key);
    if (got !== undefined) return got;
    const { r } = this;
    const s = r.sub(subOff);
    const st = MODES[mode] ?? MODES[1];
    const A = r.comp(s.offA, s.nA * 12);
    const B = r.comp(s.offB, s.nB * 4);
    const C = r.comp(s.offC, s.nC * 4);
    const D = r.comp(s.offD, s.nD);
    const av = new DataView(A.buffer, A.byteOffset, A.byteLength);
    const cv = new DataView(C.buffer, C.byteOffset, C.byteLength);
    const h = r.header(modelId);
    const accs = new Map<string, BatchAcc>();
    let vtx: [number, number, number][] = [];
    let tex = -1;
    let pal = -1;
    let radius = 0;
    const mirror = this.opts.mirrorX ? -1 : 1;
    const emit = (tris: [number, number, number][], textured: boolean) => {
      const texIndex = textured && tex >= 0 ? this.texture(modelId, tex, pal >= 0 ? pal : tex, st.intensity) : -1;
      const t = texIndex >= 0 ? this.textures[texIndex] : null;
      for (const tri of tris) {
        const order = this.opts.mirrorX ? [tri[0], tri[2], tri[1]] : tri;
        let ok = true;
        for (const i of order) if (i >= vtx.length) ok = false;
        if (!ok) { this.failures.push(`tri index out of range in ${subOff.toString(16)}`); continue; }
        // The static node may be submitted through a translucent draw pass even when its
        // stored mode is 1. The vertex colour's alpha selects that pass; it is not a
        // texture-palette alpha, which is binary RGBA16 for both panes and light cones.
        const translucent = st.blend === 'cutout' && order.some((i) => {
          const c = vtx[i][2] * 4 + 3;
          return c < B.length && B[c] < 255;
        });
        const bkey = `${texIndex}:${translucent ? 'x' : 'o'}`;
        let acc = accs.get(bkey);
        if (!acc) {
          acc = { batch: { texture: texIndex, blend: translucent ? 'blend' : st.blend,
            depthTest: st.depthTest, depthWrite: translucent ? false : st.depthWrite,
            cullBack: translucent ? false : st.cull }, pos: [], uv: [], col: [] };
          accs.set(bkey, acc);
        }
        this.triangles++;
        for (const i of order) {
          const [pi, ui, ci] = vtx[i];
          const x = av.getFloat32(pi * 12) * WORLD_SCALE * mirror;
          const y = av.getFloat32(pi * 12 + 4) * WORLD_SCALE;
          const z = av.getFloat32(pi * 12 + 8) * WORLD_SCALE;
          radius = Math.max(radius, Math.hypot(x, y, z));
          acc.pos.push(x, y, z);
          if (t && ui * 4 + 4 <= C.length) acc.uv.push(cv.getInt16(ui * 4) / (32 * t.width), cv.getInt16(ui * 4 + 2) / (32 * t.height));
          else acc.uv.push(0, 0);
          const c = ci * 4 + 4 <= B.length ? ci * 4 : -1;
          if (c < 0) acc.col.push(255, 255, 255, 255);
          else if (st.colour === 'white') acc.col.push(255, 255, 255, st.alpha === 'shade' || translucent ? B[c + 3] : 255);
          else acc.col.push(B[c], B[c + 1], B[c + 2], st.alpha === 'shade' || translucent ? B[c + 3] : 255);
        }
      }
    };
    let cmds: DCmd[] = [];
    try {
      cmds = parseD(D);
    } catch (e) {
      this.failures.push(`D parse ${subOff.toString(16)}: ${(e as Error).message}`);
    }
    for (const c of cmds) {
      switch (c.op) {
        case 0: case 1: case 2: case 3: vtx = c.verts; break;
        case 4: case 5: emit(c.tris, true); break;
        case 6: pal = c.pal; tex = c.tex; emit(c.tris, true); break;
        case 7: tex = c.tex; pal = c.tex; emit(c.tris, true); break;
        case 8: emit(c.tris, !!this.opts.op8Textured); break;
        case 10: tex = c.tex; break;
        case 11: pal = c.pal; break;
      }
    }
    const batches: Batch[] = [...accs.values()].filter((a) => a.pos.length).map((a) => ({
      ...a.batch, positions: new Float32Array(a.pos), uvs: new Float32Array(a.uv), colors: new Uint8Array(a.col),
    }));
    const idx = this.meshes.length;
    this.meshes.push({ name: `m${modelId}_${subOff.toString(16)}_t${s.type}`, radius, batches,
      info: { entry: modelId, sub: '0x' + (r.archive + subOff).toString(16), type: s.type, mode, nA: s.nA, nB: s.nB, nC: s.nC, nD: s.nD } });
    this.meshKeys.set(key, idx);
    return idx;
  }
}

// Column-major object -> world matrix: translate(pos) * rotation.
// Rotation: 0x80041114 converts the angles to s16 (x 4096 / 2pi) and 0x80082FE4 builds M = Rz * Ry * Rx (column vectors,
// v' = M v as 0x80083A6C applies it); verified numerically against the game's table-driven code (fit error 1.6e-12).
export function recordMatrix(rec: Record44, rotOrder = 'xyz', mirrorX = false): Float32Array {
  const ang = { x: rec.rx * DEG4096, y: rec.ry * DEG4096, z: rec.rz * DEG4096 };
  let m = [1, 0, 0, 0, 1, 0, 0, 0, 1]; // row-major 3x3
  const mul = (a: number[], b: number[]) => {
    const o = new Array(9).fill(0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
    return o;
  };
  // rotOrder lists axes in the order they act on the vertex: v' = R_last ... R_first v
  for (const ax of rotOrder) {
    const a = ang[ax as 'x' | 'y' | 'z'];
    const c = Math.cos(a), s = Math.sin(a);
    const R = ax === 'x' ? [1, 0, 0, 0, c, -s, 0, s, c] : ax === 'y' ? [c, 0, s, 0, 1, 0, -s, 0, c] : [c, -s, 0, s, c, 0, 0, 0, 1];
    m = mul(R, m);
  }
  if (mirrorX) {
    // conjugate with diag(-1, 1, 1)
    const M = [-1, 1, 1];
    m = m.map((v, i) => v * M[Math.floor(i / 3)] * M[i % 3]);
  }
  const tx = rec.x * WORLD_SCALE * (mirrorX ? -1 : 1), ty = rec.y * WORLD_SCALE, tz = rec.z * WORLD_SCALE;
  return new Float32Array([m[0], m[3], m[6], 0, m[1], m[4], m[7], 0, m[2], m[5], m[8], 0, tx, ty, tz, 1]);
}

export function decodeLevel(r: TwineRom, levelId: number, opts: DecodeOptions = {}): { level: Level; stats: LevelStats } {
  const b = new TwineLevelBuilder(r, opts);
  const instances: Instance[] = [];
  const skies: { name: string; mesh: number }[] = [];
  const unplaced: number[] = [];
  const types: Record<string, number> = {};
  let skipped = 0;
  const recs = r.records(levelId);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const rec of recs) {
    let s: SubHeader;
    try {
      s = r.sub(rec.subOff);
    } catch (e) {
      b.failures.push(`rec ${rec.index}: ${(e as Error).message}`);
      continue;
    }
    types[s.type] = (types[s.type] ?? 0) + 1;
    if (!s.nD || (opts.include && !opts.include(rec, s))) { skipped++; continue; }
    if (rec.modelId < 0 || rec.modelId >= ENTRIES) { b.failures.push(`rec ${rec.index}: model ${rec.modelId}`); continue; }
    let mesh: number;
    try {
      mesh = b.mesh(rec.modelId, rec.subOff, drawMode(s.type));
    } catch (e) {
      b.failures.push(`rec ${rec.index}: ${(e as Error).message}`);
      continue;
    }
    const matrix = recordMatrix(rec, opts.rotOrder, opts.mirrorX);
    if (opts.skies && SKY_TYPES.has(s.type)) {
      skies.push({ name: `sky rec${rec.index} t${s.type}`, mesh });
      unplaced.push(mesh);
      continue;
    }
    instances.push({ name: `rec${rec.index}_t${s.type}`, mesh, matrix,
      info: { record: rec.index, type: s.type, mode: drawMode(s.type), listA: isListA(s.type) ? 1 : 0, model: rec.modelId,
        node: rec.node, flags2e: '0x' + rec.flags2e.toString(16) } });
    // bounds from mesh vertices
    for (const bt of b.meshes[mesh].batches) {
      const p = bt.positions;
      for (let i = 0; i < p.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          const v = matrix[k] * p[i] + matrix[4 + k] * p[i + 1] + matrix[8 + k] * p[i + 2] + matrix[12 + k];
          if (v < min[k]) min[k] = v;
          if (v > max[k]) max[k] = v;
        }
      }
    }
  }
  const info = LEVELS.find((l) => l.index === levelId) ?? { index: levelId, name: `Level ${levelId}`, kind: 'other' as const };
  // Modes whose state list has no G_FOG (everything but 1/2: 0x800B1A28/.. geometry 0x00200405 / 0x00200005).
  for (const inst of instances) if (![1, 2].includes(Number(inst.info!.mode))) inst.noFog = true;
  // The game draws the type-41 sky, then the second layer (43/121/122), camera-relative, before the world
  // (runtime: DE 800B1AA0, identity modelview, rotation-only view). Merge them into one sky so a single Sky shows both.
  if (skies.length > 1) {
    const order = [...skies].sort((p, q) => Number(!p.name.endsWith('t41')) - Number(!q.name.endsWith('t41')));
    const merged: Mesh = { name: 'sky+layers', radius: Math.max(...order.map((s) => b.meshes[s.mesh].radius)),
      batches: order.flatMap((s) => b.meshes[s.mesh].batches), info: { parts: order.map((s) => s.name).join(', ') } };
    b.meshes.push(merged);
    unplaced.push(b.meshes.length - 1);
    skies.unshift({ name: 'sky+layers', mesh: b.meshes.length - 1 });
  }
  const env = levelEnvironment(r, levelId, recs);
  const camera = startCamera(r, recs, b.meshes, instances);
  const level: Level = {
    info, id: `twine-${levelId}`, textures: b.textures, meshes: b.meshes, instances, unplaced,
    ...(skies.length ? { skies } : {}),
    ...(env?.fog ? { fog: env.fog } : {}),
    ...(env ? { clearColor: env.color } : {}),
    ...(camera ? { camera } : {}),
    bounds: { min: min as [number, number, number], max: max as [number, number, number] },
  };
  const stats: LevelStats = { records: recs.length, meshes: b.meshes.length, triangles: b.triangles, textures: b.textures.length,
    skipped, failures: b.failures, types };
  return { level, stats };
}

// ---------------------------------------------------------------------------------------------------------------
// Environment and start camera (env/NOTES.md, emu2/NOTES.md)

export interface TwineEnvironment {
  record: number; type: number;
  A: number; B: number; C: number; color: [number, number, number];
  spinDivisor: number; far: number; lightFloor: number; // far in record units (0x800C0740)
  fog?: Fog; // render units (x 64)
}

// The one type-41/42 record per level (spawn case 0x800437E8). Fog: DB080000 word1 = (B + 120A) << 16 | (C - 120A),
// colour F8 = rec+32/34/36, projection near 0.2 / far rec+3A record units (runtime-verified in 9 captures, emu2/NOTES.md 3/8).
// clearColor = fog colour (gate 0x8010A4C1 = 5 in every capture). A = B = C = 0 -> fog factor 0: no Level.fog.
export function levelEnvironment(r: TwineRom, levelId: number, recs = r.records(levelId)): TwineEnvironment | null {
  for (const rec of recs) {
    const type = r.sub(rec.subOff).type;
    if (type !== 41 && type !== 42) continue;
    const b = (o: number) => rec.raw[o + 1]; // low byte of a big-endian u16
    const u16 = (o: number) => (rec.raw[o] << 8) | rec.raw[o + 1];
    const A = b(0x2c), B = b(0x2e), C = b(0x30);
    const color: [number, number, number] = [b(0x32), b(0x34), b(0x36)];
    const far = u16(0x3a) || 175; // ROM default 0x800C0740 = 175 (strictly: the previous level's value)
    const env: TwineEnvironment = { record: rec.index, type, A, B, C, color, spinDivisor: u16(0x38), far,
      lightFloor: rec.raw[0x3f] || 255 };
    if (A | B | C) env.fog = { color, multiplier: B + 120 * A, offset: C - 120 * A, near: 0.2 * WORLD_SCALE, far: far * WORLD_SCALE };
    return env;
  }
  return null;
}

// Player 1 start: type-35 record (difficulty copy rec+40 = 0), else the first type 35-38 start. Yaw = rotY / 4096
// degrees, forward (sin yaw, 0, cos yaw) (0x800480A0 / 0x8000BBB4; runtime view yaw == record yaw in 7 captures).
// Height: the player object settles onto the floor under the start and rests STAND_HEIGHT above it; the eye is
// EYE_HEIGHT above the object (camera data+152 = 0.55 on land in all captures). Runtime: Courier and King's Ransom both
// have object Y = 1.07885 over floor 0 although their start records say 1.0865 and 1.5.
export const EYE_HEIGHT = 0.55;
export const STAND_HEIGHT = 1.07885;

// Highest non-translucent world surface at (x, z) with height in [maxY - maxDrop, maxY] (render units), or null.
export function floorBelow(meshes: Mesh[], instances: Instance[], x: number, z: number, maxY: number, maxDrop: number): number | null {
  let best: number | null = null;
  for (const inst of instances) {
    const m = inst.matrix;
    const mesh = meshes[inst.mesh];
    const dx = m[12] - x, dz = m[14] - z;
    if (dx * dx + dz * dz > (mesh.radius + 1) ** 2) continue;
    for (const bt of mesh.batches) {
      if (bt.blend === 'blend') continue;
      const p = bt.positions;
      for (let t = 0; t + 8 < p.length; t += 9) {
        const w: number[][] = [];
        for (let k = 0; k < 3; k++) {
          const i = t + 3 * k;
          w.push([m[0] * p[i] + m[4] * p[i + 1] + m[8] * p[i + 2] + m[12], m[1] * p[i] + m[5] * p[i + 1] + m[9] * p[i + 2] + m[13],
            m[2] * p[i] + m[6] * p[i + 1] + m[10] * p[i + 2] + m[14]]);
        }
        const [a, b, c] = w;
        const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
        if (Math.abs(d) < 1e-9) continue;
        const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
        const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const h = l1 * a[1] + l2 * b[1] + l3 * c[1];
        if (h <= maxY && h >= maxY - maxDrop && (best === null || h > best)) best = h;
      }
    }
  }
  return best;
}

export function startCamera(r: TwineRom, recs: Record44[], meshes?: Mesh[], instances?: Instance[]): CameraView | null {
  const starts = recs.filter((rec) => { const t = r.sub(rec.subOff).type; return t >= 35 && t <= 38; });
  const p1 = starts.filter((rec) => r.sub(rec.subOff).type === 35);
  const rec = p1.find((x) => ((x.raw[0x40] << 8) | x.raw[0x41]) === 0) ?? p1[0] ?? starts[0];
  if (!rec) return null;
  const yaw = (rec.ry / 4096) * (Math.PI / 180);
  const x = rec.x * WORLD_SCALE, z = rec.z * WORLD_SCALE;
  // the floor lies at least ~STAND_HEIGHT below the record; search 1.0 .. 3.0 units down
  const floor = meshes && instances ? floorBelow(meshes, instances, x, z, (rec.y - 1.0) * WORLD_SCALE, 2.0 * WORLD_SCALE) : null;
  const eyeY = floor !== null ? floor + (STAND_HEIGHT + EYE_HEIGHT) * WORLD_SCALE : (rec.y + EYE_HEIGHT) * WORLD_SCALE;
  const eye: [number, number, number] = [x, eyeY, z];
  return { eye, target: [eye[0] + Math.sin(yaw) * 640, eye[1], eye[2] + Math.cos(yaw) * 640], fovY: 60 };
}
const romOff = (v: number) => v - 0x80000400 + 0x1000;
// Character type k (121 entries, 12 bytes at 0x800C3CF4 + 12k): +0 u16 skeleton group (= k), +4 ptr into the model id
// table, +8 ptr to the bone -> node remap. Bone count = s16 0x800C3928 + 8*group (anim group table 0x800C3924).
// [V: disasm 0x8000237C; data: remap[i] == node of model record i for all checked types]
export interface CharType { index: number; group: number; model: number; bones: number; remap: number[] }
export function charType(r: TwineRom, k: number): CharType | null {
  if (!(k >= 0 && k < 121)) return null;
  const palShift = r.region === 'E' ? 0xaf0 : 0;
  const b = romOff(0x800c3cf4 + palShift + 12 * k);
  const group = r.u16(b);
  const model = r.s16(romOff(r.u32(b + 4)));
  const bones = r.s16(romOff(0x800c3928 + palShift + 8 * group));
  const rp = romOff(r.u32(b + 8));
  return { index: k, group, model, bones, remap: Array.from(r.rom.subarray(rp, rp + bones)) };
}

// Weapon table (59 x 232 bytes at 0x800C46DC, index = menu weapon name order): +0 first-person rig model (479..506),
// +0x2A node, +0x2C model of the third-person weapon mesh. [V: disasm 0x800015AC, preload 0x800423A8; names by consistency]
export function weaponModel(r: TwineRom, w: number): { firstPerson: number; node: number; model: number } | null {
  if (!(w > 0 && w < 59)) return null;
  const b = romOff(0x800c46dc + (r.region === 'E' ? 0xaf0 : 0) + 232 * w);
  return { firstPerson: r.s16(b), node: r.s16(b + 0x2a), model: r.s16(b + 0x2c) };
}

const mul4 = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + rr] * b[c * 4 + k];
    o[c * 4 + rr] = s;
  }
  return o;
};
// Character frame: bone world rotation = actor * D * R(record)^T with D = Ry(-90 deg) (column vectors).
// [V: Courier RDRAM + frame DL: 14 bone MODELVIEW matrices of the receptionist; translation == skeleton joint array,
//  rotation * (R^T)^-1 = D within the idle pose (2..40 deg), R instead of R^T is 150..180 deg off]
const CHAR_FRAME = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1]);
const transposeRot = (m: Float32Array) => new Float32Array([m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1]);

// Character creation starts animation 113 (0x8000265C). It contains one neutral frame for the
// 15-bone human groups. Decode its half-angle Euler quaternions and propagate each group's
// authored parent offsets; the mesh records alone do not contain the final joint positions.
function neutralHumanPose(r: TwineRom, ct: CharType): Float32Array[] | null {
  if (ct.bones !== 15) return null;
  const animBase = r.region === 'U' ? 0xf8d70 : 0xf9d30;
  const animTable = r.region === 'U' ? 0x530ba8 : 0x531b68;
  const groupTable = r.region === 'U' ? 0xc4524 : 0xc5014;
  const anim = animTable + 113 * 32;
  if (r.u16(anim) !== 1 || (r.u16(anim + 2) & 0x7fff) !== 17) return null;
  const data = animBase + r.u32(anim + 4) + 6;
  const group = animBase + r.u32(groupTable + 8 * ct.group);
  const rotations: Float32Array[] = [];
  const joints: [number, number, number][] = [];
  const pose: Float32Array[] = [];
  for (let i = 0; i < ct.bones; i++) {
    const word = r.u32(data + i * 4);
    const angle = [(word >>> 22) << 2, (word >>> 10) & 0xffe, (word << 1) & 0xffe];
    const [sx, sy, sz] = angle.map((v) => Math.sin(Math.PI * v / 4096));
    const [cx, cy, cz] = angle.map((v) => Math.cos(Math.PI * v / 4096));
    const x = cy * sx * cz - sy * cx * sz;
    const y = cy * sx * sz + sy * cx * cz;
    const z = cy * cx * sz - sy * sx * cz;
    const w = cy * cx * cz + sy * sx * sz;
    const local = new Float32Array([
      1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
      2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
      2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
      0, 0, 0, 1,
    ]);
    const off = group + 32 * i;
    const parent = r.s16(off + 2);
    if (parent >= i) return null;
    const parentRot = parent < 0 ? null : rotations[parent];
    const rot = parentRot ? mul4(parentRot, local) : local;
    const dx = r.f32(off + 4), dy = r.f32(off + 8), dz = r.f32(off + 12);
    const joint: [number, number, number] = parentRot
      ? [joints[parent][0] + parentRot[0] * dx + parentRot[4] * dy + parentRot[8] * dz,
        joints[parent][1] + parentRot[1] * dx + parentRot[5] * dy + parentRot[9] * dz,
        joints[parent][2] + parentRot[2] * dx + parentRot[6] * dy + parentRot[10] * dz]
      : [0, 0, 0];
    rot[12] = joint[0] * WORLD_SCALE;
    rot[13] = joint[1] * WORLD_SCALE;
    rot[14] = joint[2] * WORLD_SCALE;
    rotations.push(rot);
    joints.push(joint);
    pose.push(rot);
  }
  return pose;
}

export interface LayerOptions {
  difficulty?: 0 | 1 | 2; // Agent / Secret Agent / 00 Agent (u8 0x80102EE8)
  skies?: boolean;
}

export interface LayerStats { records: number; triangles: number; meshes: number; textures: number; failures: string[]; byLayer: Record<string, number>; markers: number }

interface LayerDef { key: string; name: string; kind: LevelLayer['kind']; visible: boolean }
const LAYER_DEFS: LayerDef[] = [
  { key: 'world', name: 'world', kind: 'main', visible: true },
  { key: 'door', name: 'doors & moving parts', kind: 'objects', visible: true },
  { key: 'prop', name: 'props & usable objects', kind: 'objects', visible: true },
  { key: 'pickup', name: 'pickups', kind: 'objects', visible: true },
  { key: 'character', name: 'characters', kind: 'objects', visible: true },
  { key: 'character-other', name: 'characters (other difficulties only)', kind: 'objects', visible: false },
  { key: 'character-gen', name: 'characters from generators (spawned on a condition)', kind: 'objects', visible: true },
  { key: 'vehicle', name: 'vehicles & scripted objects', kind: 'objects', visible: true },
  { key: 'mp', name: 'multiplayer objects & pickup spawns', kind: 'objects', visible: true },
  { key: 'glow', name: 'light glows', kind: 'objects', visible: false },
  { key: 'helper', name: 'Provisional helper planes (collision unverified)', kind: 'collision', visible: false },
  { key: 'm-start', name: 'player starts & respawns', kind: 'markers', visible: true },
  { key: 'm-light', name: 'light sources', kind: 'markers', visible: false },
  { key: 'm-script', name: 'script points, emitters', kind: 'markers', visible: false },
  { key: 'm-env', name: 'environment records', kind: 'markers', visible: false },
];
const GENERATOR_AI = new Set([2, 3, 28, 29, 30, 50]); // rec+34 cases of 0x80043158 that go to 0x80081134

export function decodeLevelLayers(r: TwineRom, levelId: number, opts: LayerOptions = {}): { level: Level; stats: LayerStats } {
  const difficulty = opts.difficulty ?? 0;
  const b = new TwineLevelBuilder(r, {});
  const instances: Instance[] = [];
  const markers: Marker[] = [];
  const members = new Map<string, number[]>(LAYER_DEFS.map((d) => [d.key, []]));
  const layerIndex = new Map(LAYER_DEFS.map((d, i) => [d.key, i]));
  const skies: { name: string; mesh: number }[] = [];
  const unplaced: number[] = [];
  const characterTypes = new Map<number, CharType | null>();
  const neutralPoses = new Map<number, Float32Array[] | null>();
  const put = (key: string, inst: Instance) => { members.get(key)!.push(instances.length); instances.push(inst); };
  const mark = (key: string, label: string, rec: Record44, info: Record<string, string | number>) =>
    markers.push({ label, position: [rec.x * WORLD_SCALE, rec.y * WORLD_SCALE, rec.z * WORLD_SCALE], layer: layerIndex.get(key), info });
  const u16 = (rec: Record44, off: number) => (rec.raw[off] << 8) | rec.raw[off + 1];
  const recs = r.records(levelId);
  const byLayer: Record<string, number> = {};
  for (const rec of recs) {
    let s: SubHeader;
    try { s = r.sub(rec.subOff); } catch (e) { b.failures.push(`rec ${rec.index}: ${(e as Error).message}`); continue; }
    const ti = typeInfo(s.type);
    const baseInfo = { record: rec.index, type: s.type, class: ti.name, model: rec.modelId, node: rec.node };
    const meshOf = (rr: Record44, ss: SubHeader) => (ss.nD && rr.modelId >= 0 && rr.modelId < ENTRIES ? b.mesh(rr.modelId, rr.subOff, drawMode(ss.type)) : -1);
    const place = (key: string) => {
      const mesh = meshOf(rec, s);
      if (mesh < 0) { mark('m-script', `t${s.type} (no mesh)`, rec, baseInfo); return; }
      put(key, { name: `rec${rec.index}_t${s.type}`, mesh, matrix: recordMatrix(rec), animated: key !== 'world' && key !== 'helper', info: baseInfo });
    };
    const layer: ObjLayer = ti.layer;
    byLayer[layer] = (byLayer[layer] ?? 0) + 1;
    try {
      switch (layer) {
        case 'world': place('world'); break;
        case 'helper': place('helper'); break;
        case 'door': place('door'); break;
        case 'spin': case 'prop': place('prop'); break;
        case 'pickup': place('pickup'); break;
        case 'vehicle': place('vehicle'); break;
        case 'glow': place('glow'); break;
        case 'mp':
          place('mp');
          if (s.type === 126) mark('m-start', 'MP pickup spawn', rec, { ...baseInfo, items: Array.from({ length: 8 }, (_, i) => u16(rec, 0x2c + 2 * i).toString(16)).join(' ') });
          break;
        case 'env':
          if ((s.type === 41 || s.type === 43 || s.type === 121 || s.type === 122) && opts.skies !== false && s.nD) {
            const mesh = meshOf(rec, s);
            skies.push({ name: `sky rec${rec.index} t${s.type}`, mesh }); unplaced.push(mesh);
          }
          mark('m-env', ti.name, rec, baseInfo);
          break;
        case 'light': mark('m-light', `light rgb ${u16(rec, 0x2c) & 255},${u16(rec, 0x2e) & 255},${u16(rec, 0x30) & 255}`, rec, baseInfo); break;
        case 'start': {
          if (s.type === 35) {
            const copy = u16(rec, 0x40);
            if (recs.filter((q) => r.sub(q.subOff).type === 35).length > 1 && copy !== difficulty) break; // campaign: one copy per difficulty
          }
          mark('m-start', s.type === 44 ? `MP respawn${u16(rec, 0x2e) ? ' (team)' : ''}` : `player ${s.type - 34} start`, rec, baseInfo);
          break;
        }
        case 'emitter': case 'marker': case 'unused': mark('m-script', `t${s.type} ${ti.name}`, rec, baseInfo); break;
        case 'character': {
          const ai = u16(rec, 0x34), k = u16(rec, 0x38), weapon = u16(rec, 0x3a);
          const chance = [u16(rec, 0x2e), u16(rec, 0x30), u16(rec, 0x32)];
          const always = chance.every((c) => c === 0);
          // 0x80079CB4 and the generator 0x80081134 both gate on 0x80017490: chance % for the difficulty, all zero = always
          const key = !(always || chance[difficulty] > 0) ? 'character-other' : GENERATOR_AI.has(ai) ? 'character-gen' : 'character';
          if (!characterTypes.has(k)) characterTypes.set(k, charType(r, k));
          const ct = characterTypes.get(k);
          const info = { ...baseInfo, char: k, weapon, ai, chance: chance.join('/'), trigger: rec.raw[0x3f] };
          if (!ct || ct.model < 0 || ct.model >= ENTRIES) { mark('m-script', `character ${k} (no type)`, rec, info); break; }
          if (!neutralPoses.has(k)) neutralPoses.set(k, neutralHumanPose(r, ct));
          const neutral = neutralPoses.get(k);
          const mrecs = r.records(ct.model);
          const actor = recordMatrix(rec);
          const p0 = mrecs[0];
          let placed = 0;
          for (let i = 0; i < ct.bones && i < mrecs.length; i++) {
            // record i of the model entry is bone i in bind pose [V: remap[i] == record i node]
            const br = mrecs.find((q, qi) => qi === i && q.node === ct.remap[i]) ?? mrecs.find((q) => q.node === ct.remap[i]);
            if (!br) continue;
            const bs = r.sub(br.subOff);
            const mesh = meshOf(br, bs);
            if (mesh < 0) continue;
            const local = transposeRot(recordMatrix(br));
            local[12] = (br.x - p0.x) * WORLD_SCALE; local[13] = (br.y - p0.y) * WORLD_SCALE; local[14] = (br.z - p0.z) * WORLD_SCALE;
            const matrix = neutral ? mul4(actor, neutral[i]) : mul4(actor, mul4(CHAR_FRAME, local));
            put(key, { name: `rec${rec.index}_char${k}_bone${i}`, mesh, matrix, animated: true,
              info: { ...info, bone: i, charModel: ct.model } });
            placed++;
          }
          if (!placed) mark('m-script', `character ${k}`, rec, info);
          break;
        }
      }
    } catch (e) {
      b.failures.push(`rec ${rec.index} t${s.type}: ${(e as Error).message}`);
    }
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const idx of members.get('world')!.concat(members.get('door')!, members.get('prop')!)) {
    const inst = instances[idx];
    const m = inst.matrix;
    for (const bt of b.meshes[inst.mesh].batches) {
      const p = bt.positions;
      for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) {
        const v = m[k] * p[i] + m[4 + k] * p[i + 1] + m[8 + k] * p[i + 2] + m[12 + k];
        if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v;
      }
    }
  }
  const info = LEVELS.find((l) => l.index === levelId) ?? { index: levelId, name: `Level ${levelId}`, kind: 'other' as const };
  const layers: LevelLayer[] = LAYER_DEFS.map((d) => ({ name: d.name, kind: d.kind, instances: members.get(d.key)!, visibleByDefault: d.visible }));
  const world = members.get('world')!.concat(members.get('door')!, members.get('prop')!).map((i) => instances[i]);
  const camera = startCamera(r, recs, b.meshes, world);
  const env = levelEnvironment(r, levelId, recs);
  for (const inst of instances) {
    const mode = Number(inst.info?.mode ?? b.meshes[inst.mesh].info?.mode ?? 1);
    if (mode !== 1 && mode !== 2) inst.noFog = true;
  }
  if (skies.length > 1) {
    const parts = skies.slice().sort((a, b) => Number(!a.name.endsWith('t41')) - Number(!b.name.endsWith('t41')));
    const merged: Mesh = { name: 'sky + layers', radius: Math.max(...parts.map((s) => b.meshes[s.mesh].radius)),
      batches: parts.flatMap((s) => b.meshes[s.mesh].batches), info: { parts: parts.map((s) => s.name).join(', ') } };
    const mesh = b.meshes.push(merged) - 1;
    skies.splice(0, skies.length, { name: 'sky + layers', mesh });
    unplaced.push(mesh);
  }
  if (!Number.isFinite(min[0])) { min[0] = min[1] = min[2] = -100; max[0] = max[1] = max[2] = 100; }
  const level: Level = {
    info, id: `twine-${levelId}`, textures: b.textures, meshes: b.meshes, instances, unplaced, layers, markers,
    ...(skies.length ? { skies } : {}), ...(camera ? { camera } : {}),
    ...(env?.fog ? { fog: env.fog } : {}), ...(env ? { clearColor: env.color } : {}),
    bounds: { min: min as [number, number, number], max: max as [number, number, number] },
  };
  return { level, stats: { records: recs.length, triangles: b.triangles, meshes: b.meshes.length, textures: b.textures.length, failures: b.failures, byLayer, markers: markers.length } };
}
