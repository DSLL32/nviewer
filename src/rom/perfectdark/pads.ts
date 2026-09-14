// Perfect Dark pads (bgdata/bg_<code>_padsZ) and the setup intro's spawn pads (docs/PERFECTDARK.md §5.2, §5.3, §5.5).
//
// Pads file: +0 s32 pad count; +4 s32 cover count; +8/+C/+10 s32 waypoint, waygroup, cover offsets; +14 u16 pad offsets.
// Pad (padUnpack 0x7F115A30): u32 header, flags = header >> 14, room = sign-extended bits 13..4 (always -1 in the ROM),
// lift = header & 0xF; then
//   position: flag 0x1 → 3 × s16 + 2 pad bytes, else 3 × f32
//   up:       flags 0x2/0x4/0x8 = +X/+Y/+Z (0x10 negates), else 3 × f32
//   look:     flags 0x20/0x40/0x80 = +X/+Y/+Z (0x100 negates), else 3 × f32
//   box:      flag 0x200 → 6 × f32 xmin, xmax, ymin, ymax, zmin, zmax (pad-local: x along normal, y along up, z along
//             look), else -100..100
// normal = up × look. Positions are world (BG) units.
type Vec3 = [number, number, number];

export const PADFLAG = {
  INTPOS: 0x1, UPALIGNTOX: 0x2, UPALIGNTOY: 0x4, UPALIGNTOZ: 0x8, UPALIGNINVERT: 0x10,
  LOOKALIGNTOX: 0x20, LOOKALIGNTOY: 0x40, LOOKALIGNTOZ: 0x80, LOOKALIGNINVERT: 0x100, HASBBOXDATA: 0x200,
} as const;

export interface Pad {
  index: number;
  offset: number; // in the inflated pads file
  flags: number;
  room: number; // -1 when unset
  lift: number;
  pos: Vec3;
  up: Vec3;
  look: Vec3;
  normal: Vec3;
  bbox: [number, number, number, number, number, number]; // xmin, xmax, ymin, ymax, zmin, zmax
  hasBbox: boolean;
}

export interface PadsFile {
  pads: Pad[];
  coverCount: number;
}

export function parsePads(buf: Uint8Array): PadsFile {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < 0x14) return { pads: [], coverCount: 0 };
  const count = dv.getInt32(0);
  const pads: Pad[] = [];
  for (let i = 0; i < count && 0x14 + (i + 1) * 2 <= buf.length; i++) {
    const offset = dv.getUint16(0x14 + i * 2);
    if (offset + 12 > buf.length) break;
    pads.push(parsePad(dv, i, offset));
  }
  return { pads, coverCount: dv.getInt32(4) };
}

function parsePad(dv: DataView, index: number, offset: number): Pad {
  const header = dv.getUint32(offset);
  const flags = header >>> 14;
  const f32 = (o: number): Vec3 => [dv.getFloat32(o), dv.getFloat32(o + 4), dv.getFloat32(o + 8)];
  const axis = (x: number, y: number, z: number, invert: number): Vec3 => {
    const s = flags & invert ? -1 : 1;
    return flags & x ? [s, 0, 0] : flags & y ? [0, s, 0] : [0, 0, s];
  };
  let p = offset + 4;
  let pos: Vec3;
  if (flags & PADFLAG.INTPOS) {
    pos = [dv.getInt16(p), dv.getInt16(p + 2), dv.getInt16(p + 4)];
    p += 8;
  } else {
    pos = f32(p);
    p += 12;
  }
  let up: Vec3;
  if (flags & (PADFLAG.UPALIGNTOX | PADFLAG.UPALIGNTOY | PADFLAG.UPALIGNTOZ)) up = axis(PADFLAG.UPALIGNTOX, PADFLAG.UPALIGNTOY, PADFLAG.UPALIGNTOZ, PADFLAG.UPALIGNINVERT);
  else {
    up = f32(p);
    p += 12;
  }
  let look: Vec3;
  if (flags & (PADFLAG.LOOKALIGNTOX | PADFLAG.LOOKALIGNTOY | PADFLAG.LOOKALIGNTOZ)) look = axis(PADFLAG.LOOKALIGNTOX, PADFLAG.LOOKALIGNTOY, PADFLAG.LOOKALIGNTOZ, PADFLAG.LOOKALIGNINVERT);
  else {
    look = f32(p);
    p += 12;
  }
  const normal: Vec3 = [up[1] * look[2] - look[1] * up[2], up[2] * look[0] - look[2] * up[0], up[0] * look[1] - look[0] * up[1]];
  const hasBbox = (flags & PADFLAG.HASBBOXDATA) !== 0;
  const bbox = (hasBbox ? [0, 1, 2, 3, 4, 5].map((k) => dv.getFloat32(p + k * 4)) : [-100, 100, -100, 100, -100, 100]) as Pad['bbox'];
  return { index, offset, flags, room: (header << 18) >> 22, lift: header & 0xf, pos, up, look, normal, bbox, hasBbox };
}

/** The centre of a pad's box in world units. */
export function padCentre(pad: Pad): Vec3 {
  const [x0, x1, y0, y1, z0, z1] = pad.bbox;
  return [0, 1, 2].map((k) => pad.pos[k] + 0.5 * ((x0 + x1) * pad.normal[k] + (y0 + y1) * pad.up[k] + (z0 + z1) * pad.look[k])) as Vec3;
}

// Intro command lengths in words (parser 0x7F0118F4): 0 SPAWN {pad; flag}, 1 weapon, 2 ammo, 5 outfit, 7 watch time,
// 8 credits, 9/10/11 multiplayer case/respawn/hill pads, 12 END.
const INTRO_WORDS: Record<number, number> = { 0: 3, 1: 4, 2: 4, 3: 8, 4: 2, 5: 2, 6: 10, 7: 3, 8: 2, 9: 3, 10: 3, 11: 2, 12: 1 };

/** Pad numbers of the SPAWN commands in a setup file's intro list (header +0x0C), in file order. */
export function readSpawnPads(setup: Uint8Array): number[] {
  const dv = new DataView(setup.buffer, setup.byteOffset, setup.byteLength);
  const out: number[] = [];
  if (setup.length < 0x20) return out;
  for (let o = dv.getUint32(0x0c), guard = 0; o > 0 && o + 4 <= setup.length && guard < 10000; guard++) {
    const cmd = dv.getUint32(o);
    if (cmd === 12) break;
    if (cmd === 0 && o + 8 <= setup.length) out.push(dv.getInt32(o + 4));
    o += (INTRO_WORDS[cmd] ?? 1) * 4;
  }
  return out;
}
