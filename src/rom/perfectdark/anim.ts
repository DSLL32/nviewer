// Perfect Dark animations (PERFECTDARK.md §5.6): the ROM table, per-part headers, bit-packed frames, and the joint
// matrices of lib model.c for one frame, plus the stand animation chrStand (0x7F02E6DC) gives a character.
//
// Table ROM 0x7CD1A0: u32 count, then 12-byte records {u16 frames; u16 bytes per frame; u32 data offset (from ROM
// 0x1A15C0); u16 header length; u8 angle bits; u8 flags (1 loop, 2 absolute root, 4 frame remap)}. The header holds one
// descriptor per skeleton part: u8 flags, then field blocks (base value + delta bit width); frames are MSB-first bit
// streams in descriptor order. Joint = parent × T(position) × Rz·Ry·Rx (column-major matrices, PD's Mtxf layout).
import { NODE, type M4, type PdModel, type PdNode } from './models';
import type { PdRom } from './rom';

const TABLE = 0x7cd1a0;
const DATA = 0x1a15c0;
const SKELETONS = 0x80089990; // NULL-terminated pointers to {u16 id; u16 joints; ptr {u8 part, mirror part}[]}
export const RARE_TWO_PI = 6.282185077667236; // the game's 2π (lib 0x7005469C)
const FLAG_LOOP = 0x01;
const FLAG_ABSOLUTE_ROOT = 0x02;
const FLAG_REMAP = 0x04;

export interface AnimRecord {
  index: number;
  frames: number;
  bytesPerFrame: number;
  dataOffset: number; // from ROM 0x1A15C0
  headerLength: number;
  angleBits: number;
  flags: number;
}

export function animRecord(r: PdRom, index: number): AnimRecord | null {
  const dv = new DataView(r.rom.buffer, r.rom.byteOffset, r.rom.byteLength);
  if (!(index > 0 && index < dv.getUint32(TABLE))) return null;
  const o = TABLE + 4 + index * 12;
  const rec = {
    index, frames: dv.getUint16(o), bytesPerFrame: dv.getUint16(o + 2), dataOffset: dv.getUint32(o + 4),
    headerLength: dv.getUint16(o + 8), angleBits: r.rom[o + 10], flags: r.rom[o + 11],
  };
  return rec.frames > 0 ? rec : null;
}

/** The skeleton's mirror part table (for flipped animations), or null. */
function mirrorTable(r: PdRom, skeleton: number): number[] | null {
  for (let a = SKELETONS; a < SKELETONS + 256; a += 4) {
    const p = r.u32(a);
    if (!p) break;
    if (r.u16(p) !== skeleton) continue;
    const n = r.u16(p + 2), joints = r.u32(p + 4);
    return Array.from({ length: n }, (_, k) => r.u8(joints + 2 * k + 1));
  }
  return null;
}

// `n` (≤ 32) bits MSB-first at bit `pos` of the bytes from `base`, as an unsigned number.
function bits(buf: Uint8Array, base: number, pos: number, n: number): number {
  let v = 0;
  for (let i = 0; i < n; i++) {
    const p = pos + i;
    v = v * 2 + (((buf[base + (p >>> 3)] ?? 0) >> (7 - (p & 7))) & 1);
  }
  return v;
}

// A delta sign-extended from `n` bits to 16 (0x70023FE0), as a u16.
function signed16(v: number, n: number): number {
  return n > 0 && n < 16 && v & (1 << (n - 1)) ? (v | (((1 << (16 - n)) - 1) << n)) & 0xffff : v & 0xffff;
}

const s16 = (v: number) => (v << 16) >> 16;

interface Part {
  flags: number;
  header: number; // ROM offset of the descriptor's first field block (after the flags byte)
  bit: number; // bit offset of the part's fields in a frame
}

class Anim {
  readonly parts: Part[] = [];
  private readonly header: number;

  constructor(readonly r: PdRom, readonly rec: AnimRecord) {
    const h = (this.header = DATA + rec.dataOffset), rom = r.rom;
    for (let hp = h, bit = 0; hp < h + rec.headerLength;) {
      const flags = rom[hp++];
      this.parts.push({ flags, header: hp, bit });
      if (flags & 0x08) { bit += rom[hp + 2] + rom[hp + 5] + rom[hp + 8] + rom[hp + 11]; hp += 12; }
      else if (flags & 0x02) { bit += rom[hp + 2] + rom[hp + 5] + rom[hp + 8]; hp += 9; }
      else if (flags & 0x20) { bit += rom[hp] + rom[hp + 5] + rom[hp + 10]; hp += 15; }
      if (flags & 0x01) { bit += rom[hp + 2] + rom[hp + 5] + rom[hp + 8]; hp += 9; }
      else if (flags & 0x10) bit += 96;
      if (flags & 0x40) { bit += rom[hp]; hp += 5; }
      if (flags & 0x80) bit += 96;
    }
  }

  /** ROM offset of a frame's bits (0x70023908: frames inside the remap table's dropped ranges aren't stored). */
  frame(frame: number): number {
    const { rec, r } = this;
    let stored = frame;
    if (rec.flags & FLAG_REMAP) {
      const dv = new DataView(r.rom.buffer, r.rom.byteOffset);
      for (let p = this.header + rec.headerLength - 2; p - 2 >= this.header; p -= 4) {
        const start = dv.getInt16(p);
        if (start < 0) break;
        const end = dv.getInt16(p - 2);
        if (frame < start) continue;
        if (end < frame) { stored -= end - start + 1; continue; }
        stored = stored - frame + start;
        break;
      }
    }
    return this.header + rec.headerLength + rec.bytesPerFrame * stored;
  }

  /** animGetPartValues (0x70024050): rotation (radians), translation and scale of `part` in the frame at `at`. */
  sample(at: number, part: number, flip: boolean): { rot: number[]; pos: number[]; scale: number[] } {
    const out = { rot: [0, 0, 0], pos: [0, 0, 0], scale: [1, 1, 1] };
    const p = this.parts[part];
    if (!p) return out;
    const rom = this.r.rom, dv = new DataView(rom.buffer, rom.byteOffset);
    let hp = p.header, bit = p.bit;
    const float = () => {
      const f = new DataView(new ArrayBuffer(4));
      f.setUint32(0, bits(rom, at, bit, 32));
      bit += 32;
      return f.getFloat32(0);
    };
    if (p.flags & 0x08) {
      bit += rom[hp + 2] + rom[hp + 5] + rom[hp + 8] + rom[hp + 11];
      hp += 12;
    } else if (p.flags & 0x02) {
      for (let k = 0; k < 3; k++) {
        const n = rom[hp + 3 * k + 2];
        out.pos[k] = s16(dv.getUint16(hp + 3 * k) + signed16(bits(rom, at, bit, n), n));
        bit += n;
      }
      hp += 9;
    } else if (p.flags & 0x20) {
      for (let k = 0; k < 3; k++) {
        const n = rom[hp + 5 * k];
        out.pos[k] = ((dv.getUint32(hp + 5 * k + 1) + bits(rom, at, bit, n)) | 0) * 0.0010000000474974513;
        bit += n;
      }
      hp += 15;
    }
    if (p.flags & 0x01) {
      for (let k = 0; k < 3; k++) {
        const n = rom[hp + 3 * k + 2];
        const a16 = (((bits(rom, at, bit, n) + dv.getUint16(hp + 3 * k)) & 0xffff) << (16 - this.rec.angleBits)) & 0xffff;
        bit += n;
        out.rot[k] = ((flip && k > 0 && a16 ? 0x10000 - a16 : a16) * RARE_TWO_PI) / 65536;
      }
    } else if (p.flags & 0x10) {
      out.rot = [float(), float(), float()];
      if (flip) for (const k of [1, 2]) if (out.rot[k] !== 0) out.rot[k] = RARE_TWO_PI - out.rot[k];
    }
    if (p.flags & 0x80) out.scale = [float(), float(), float()]; // like the game, without skipping a 0x40 field
    return out;
  }

  /** The flag-0x08 root motion block of `part` (0x7002485C): s16 x, y, z and the yaw, or null. */
  rootMotion(at: number, part: number, flip: boolean): { pos: number[]; yaw: number } | null {
    const p = this.parts[part];
    if (!p || !(p.flags & 0x08)) return null;
    const rom = this.r.rom, dv = new DataView(rom.buffer, rom.byteOffset);
    let bit = p.bit;
    const v = [0, 1, 2, 3].map((k) => {
      const n = rom[p.header + 3 * k + 2];
      const value = (dv.getUint16(p.header + 3 * k) + signed16(bits(rom, at, bit, n), n)) & 0xffff;
      bit += n;
      return value;
    });
    const pos = [s16(v[0]), s16(v[1]), s16(v[2])];
    let yaw = v[3];
    if (flip) {
      pos[0] = s16(-pos[0]);
      if (yaw) yaw = 0x10000 - yaw;
    }
    return { pos, yaw: (yaw * RARE_TWO_PI) / 65536 };
  }
}

// ---- matrices (column-major) ----
export const identity = (): M4 => new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function mul4(a: ArrayLike<number>, b: ArrayLike<number>): M4 {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let row = 0; row < 4; row++) {
      let t = 0;
      for (let k = 0; k < 4; k++) t += a[k * 4 + row] * b[c * 4 + k];
      o[c * 4 + row] = t;
    }
  }
  return o;
}

/** 0x7001648C: Rz(z)·Ry(y)·Rx(x). */
function euler(rot: number[]): M4 {
  const cx = Math.cos(rot[0]), sx = Math.sin(rot[0]), cy = Math.cos(rot[1]), sy = Math.sin(rot[1]), cz = Math.cos(rot[2]), sz = Math.sin(rot[2]);
  return new Float64Array([
    cy * cz, cy * sz, -sy, 0,
    sx * cz * sy - cx * sz, sx * sz * sy + cx * cz, sx * cy, 0,
    cx * cz * sy + sx * sz, cx * sz * sy - sx * cz, cx * cy, 0,
    0, 0, 0, 1,
  ]);
}

/** 0x7F097518(q, 0.5): half of a rotation (slerp from identity), the elbow/knee skinning slot. */
function halfRotation(m: M4): M4 {
  let w: number, x: number, y: number, z: number;
  const tr = m[0] + m[5] + m[10];
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; [w, x, y, z] = [s / 4, (m[6] - m[9]) / s, (m[8] - m[2]) / s, (m[1] - m[4]) / s]; }
  else if (m[0] > m[5] && m[0] > m[10]) { const s = Math.sqrt(1 + m[0] - m[5] - m[10]) * 2; [w, x, y, z] = [(m[6] - m[9]) / s, s / 4, (m[1] + m[4]) / s, (m[8] + m[2]) / s]; }
  else if (m[5] > m[10]) { const s = Math.sqrt(1 + m[5] - m[0] - m[10]) * 2; [w, x, y, z] = [(m[8] - m[2]) / s, (m[1] + m[4]) / s, s / 4, (m[6] + m[9]) / s]; }
  else { const s = Math.sqrt(1 + m[10] - m[0] - m[5]) * 2; [w, x, y, z] = [(m[1] - m[4]) / s, (m[8] + m[2]) / s, (m[6] + m[9]) / s, s / 4]; }
  if (w < 0) [w, x, y, z] = [-w, -x, -y, -z];
  const l = Math.hypot(1 + w, x, y, z);
  [w, x, y, z] = [(1 + w) / l, x / l, y / l, z / l];
  return new Float64Array([
    1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y), 0,
    2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x), 0,
    2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ]);
}

/** 0x7001AFE8: the shorter way round between two angles in [0, 2π). */
function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  if (b < a) d += RARE_TWO_PI;
  if (d < Math.PI) {
    const v = a + d * t;
    return v >= RARE_TWO_PI ? v - RARE_TWO_PI : v;
  }
  const v = a - (RARE_TWO_PI - d) * t;
  return v < 0 ? v + RARE_TWO_PI : v;
}

export interface Pose {
  anim: number;
  frame: number;
  flip: boolean;
  slots: (M4 | undefined)[]; // matrix slot → joint matrix (model units)
  nodes: Map<PdNode, M4>; // the joint frame in effect at each node (HEADSPOT: where the head attaches)
  rootMotion: { pos: number[]; yaw: number } | null; // of the root part in frame A
}

export interface PoseOptions {
  flip?: boolean; // mirrored animation: parts from the skeleton's mirror table, Y and Z angles negated
  animScale?: number; // the body table's animation scale (translations stored in the animation)
  /** Interpolation towards `frameB` (default: the next frame) by `frac` (default: the fractional part of the frame). */
  frameB?: number;
  frac?: number;
  /** Lift the root by the frame's root motion height × animScale, so the feet stand on y = 0 (§5.6). */
  stand?: boolean;
}

/** Joint matrices of `model` in animation `animIndex` at `frame` (the math of 0x7001B400 / 0x7001BFA8), or null. */
export function poseModel(r: PdRom, model: PdModel, animIndex: number, frame: number, o: PoseOptions = {}): Pose | null {
  const rec = animRecord(r, animIndex);
  if (!rec) return null;
  const anim = new Anim(r, rec);
  const wrap = (f: number) => (rec.flags & FLAG_LOOP ? ((f % rec.frames) + rec.frames) % rec.frames : Math.max(0, Math.min(rec.frames - 1, f)));
  const fa = wrap(Math.floor(frame));
  const fb = wrap(o.frameB ?? fa + 1);
  const frac = fb === fa ? 0 : (o.frac ?? frame - Math.floor(frame));
  const atA = anim.frame(fa), atB = frac ? anim.frame(fb) : atA;
  const flip = !!o.flip;
  const mirror = flip ? mirrorTable(r, model.skeleton) : null;
  const part = (p: number) => (mirror ? (mirror[p] ?? p) : p);
  const animScale = o.animScale ?? 1;
  const sample = (p: number, root: boolean) => {
    const a = anim.sample(atA, part(p), flip);
    if (frac) {
      const b = anim.sample(atB, part(p), flip);
      a.rot = a.rot.map((v, k) => lerpAngle(v, b.rot[k], frac));
      if (root && rec.flags & FLAG_ABSOLUTE_ROOT) a.pos = a.pos.map((v, k) => v + (b.pos[k] - v) * frac);
    }
    return a;
  };
  const dv = new DataView(model.data.buffer, model.data.byteOffset, model.data.byteLength);
  const chrinfo = model.nodes.find((n) => n.type === NODE.CHRINFO && n.rodata >= 0);
  const rootMotion = chrinfo ? anim.rootMotion(atA, part(dv.getUint16(chrinfo.rodata)), flip) : null;
  const base = identity();
  if (o.stand && rootMotion) base[13] = rootMotion.pos[1] * animScale;

  const slots: (M4 | undefined)[] = [];
  const nodes = new Map<PdNode, M4>();
  const roots = new Set(model.roots);
  const visit = (n: PdNode, parent: M4, depth: number) => {
    let here = parent;
    const ro = n.rodata;
    if (ro >= 0 && n.type === NODE.CHRINFO) {
      here = mul4(parent, euler(sample(dv.getUint16(ro), true).rot));
      const slot = dv.getInt16(ro + 2);
      if (slot >= 0) slots[slot] = here;
    } else if (ro >= 0 && n.type === NODE.POSITION) {
      const root = roots.has(n);
      const s = sample(dv.getUint16(ro + 12), root);
      const rest = [dv.getFloat32(ro), dv.getFloat32(ro + 4), dv.getFloat32(ro + 8)];
      const moved = s.pos.some((v) => v !== 0);
      const pos = [0, 1, 2].map((k) => (moved ? s.pos[k] * animScale : 0) + (root ? 0 : rest[k]));
      const rot = euler(s.rot);
      const local = rot.slice();
      for (let c = 0; c < 3; c++) if (s.scale[c] !== 1) for (let k = 0; k < 3; k++) local[c * 4 + k] *= s.scale[c];
      local.set(pos, 12);
      here = mul4(parent, local);
      const [s0, s1] = [dv.getInt16(ro + 14), dv.getInt16(ro + 16)];
      if (s0 >= 0) slots[s0] = here;
      if (n.flags & 0x01 && s1 >= 0) { // type 0x102: a second slot with half the rotation
        const half = halfRotation(rot);
        half.set(pos, 12);
        slots[s1] = mul4(parent, half);
      }
    } else if (ro >= 0 && n.type === NODE.POSITIONHELD) {
      const local = identity();
      local.set([dv.getFloat32(ro), dv.getFloat32(ro + 4), dv.getFloat32(ro + 8)], 12);
      here = mul4(parent, local);
      const slot = dv.getInt16(ro + 14);
      if (slot >= 0) slots[slot] = here;
    }
    nodes.set(n, here);
    if (depth < 64) for (const c of n.children) visit(c, here, depth + 1);
  };
  for (const root of model.roots) visit(root, base, 0);
  return { anim: animIndex, frame: fa, flip, slots, nodes, rootMotion };
}

// ---- stand animations (chrStand 0x7F02E6DC, bodyGetRace 0x7F02CDE0) ----
const RACE_STAND: Record<number, number> = { 92: 192, 123: 192, 147: 192, 107: 318, 108: 318, 118: 567 }; // Skedar ×3, Dr Caroll, eyespy, chicrob
const STAND_TWO_HANDED = 1;
const STAND_OTHER = 106;
const WEAPONS = 0x8006ff18; // 94 pointers to weapon definitions; +0x4C u32 flags, 0x8 = one-handed
const WEAPON_COUNT = 94;
const WEAPONFLAG_ONEHANDED = 0x8;
const OBJFLAG_LEFT_HAND = 0x10000000; // hypothesis: the second of a dual-wielding Skedar's guns carries it

/** Whether the game treats a weapon number as one-handed (weapon definition +0x4C & 8). */
export function weaponOneHanded(r: PdRom, weapon: number): boolean {
  if (!(weapon >= 0 && weapon < WEAPON_COUNT)) return false;
  const def = r.u32(WEAPONS + weapon * 4);
  return def >= 0x80059fe0 && def < 0x80059fe0 + r.data.length && (r.u32(def + 0x4c) & WEAPONFLAG_ONEHANDED) !== 0;
}

/**
 * The animation chrStand gives a body: Skedar 192, Dr Caroll and the eyespy 318, the robot 567; humans 106 when unarmed,
 * holding two guns or a one-handed gun (random flip, shown unflipped), else 1 (a two-handed gun, flipped in the left hand).
 * Verified against RAM: Crash Site's CstripesZ guards with an Avenger run 1, Villa's unarmed secretary 106.
 */
export function standAnimation(r: PdRom, body: number, held: { weapon: number; flags: number }[]): { anim: number; flip: boolean; rule: string } {
  const race = RACE_STAND[body];
  if (race) return { anim: race, flip: false, rule: 'race stand animation' };
  if (held.length !== 1) return { anim: STAND_OTHER, flip: false, rule: held.length ? 'two guns' : 'unarmed' };
  if (weaponOneHanded(r, held[0].weapon)) return { anim: STAND_OTHER, flip: false, rule: 'one-handed gun' };
  return { anim: STAND_TWO_HANDED, flip: (held[0].flags & OBJFLAG_LEFT_HAND) !== 0, rule: 'two-handed gun' };
}
