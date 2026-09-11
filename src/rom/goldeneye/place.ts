// GoldenEye object placement from setup records (GOLDENEYE.md §4.8), in world units (BG units / the stage scale f0C).
// Verified against the runtime object structs of 8 stages: rotation × scale matrices exact for standard objects, doors,
// tinted glass and nearly all monitors; positions exact except where the game stacks objects on other objects.
//
// Matrices are column-major 4×4 (object → world). A pad's basis is the columns [normalize(up × look), up, look].
import type { Pad, SetupObject, Vec3 } from './setup';

/** A model's bounding box node (type 0x0A) in model units. */
export interface Box {
  min: Vec3;
  max: Vec3;
}

type M4 = Float64Array;

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

export function mul4(a: M4, b: M4): M4 {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let t = 0;
      for (let k = 0; k < 4; k++) t += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = t;
    }
  }
  return o;
}

const rotX = (a: number) => new Float64Array([1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1]);
const rotY = (a: number) => new Float64Array([Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1]);
const rotZ = (a: number) => new Float64Array([Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function basis(pad: Pad): M4 {
  const z = normalize(pad.look), x = normalize(cross(pad.up, z)), y = normalize(pad.up);
  return new Float64Array([...x, 0, ...y, 0, ...z, 0, 0, 0, 0, 1]);
}

/** A pad's position, or for a bound pad the centre of its box (BG units). */
export function padCentre(pad: Pad): Vec3 {
  const b = pad.box;
  if (!b) return [pad.pos[0], pad.pos[1], pad.pos[2]];
  const r = normalize(cross(pad.up, pad.look));
  return add(add(add(pad.pos, r, 0.5 * (b[0] + b[1])), pad.up, 0.5 * (b[2] + b[3])), pad.look, 0.5 * (b[4] + b[5]));
}

export interface Placement {
  matrix: Float32Array; // instance matrix, world units
  position: Vec3;
  modelScale: number; // the model's uniform scale (prop table scale × extrascale × bound-pad fit)
}

function placement(rot: M4, position: Vec3, modelScale: number): Placement {
  const matrix = Float32Array.from(rot);
  matrix[12] = position[0];
  matrix[13] = position[1];
  matrix[14] = position[2];
  matrix[15] = 1;
  return { matrix, position, modelScale };
}

export interface PlaceOptions {
  scale: number; // stage scale f0C
  propScale: number; // prop table scale
  box?: Box; // the model's bounding box
  // Floor height (world units) under world (x, z) for an object on this pad: the clipping tile height (§4.10).
  floorY: (x: number, z: number, pad: Pad) => number;
}

/**
 * Generic objects (0x7F001D9C and the final placement 0x7F04088C / 0x7F040BA0). `pad` is the record's pad (a bound
 * pad when the record's pad number is ≥ 10000). Flags: 0x2 wall-mounted, 0x4 upside down, 0x8 no ground snap, 0x10
 * uniform bound-pad fit, 0x20/0x40/0x80 fit x/y/z.
 */
export function placeObject(obj: SetupObject, pad: Pad, o: PlaceOptions): Placement {
  const flags = obj.flags ?? 0;
  const k = 1 / o.scale;
  let pos: Vec3 = [pad.pos[0] * k, pad.pos[1] * k, pad.pos[2] * k];
  let fx = 1, fy = 1, fz = 1, scale = o.propScale;
  const mb = o.box;
  if (pad.box) {
    const b = pad.box.map((v) => v * k);
    const r = normalize(cross(pad.up, pad.look));
    const centre = add(add(add(pos, r, 0.5 * (b[0] + b[1])), pad.up, 0.5 * (b[2] + b[3])), pad.look, 0.5 * (b[4] + b[5]));
    pos = add(centre, pad.up, 0.5 * (b[2] - b[3])); // bottom centre
    if (mb) {
      const ex = mb.max[0] - mb.min[0], ey = mb.max[1] - mb.min[1], ez = mb.max[2] - mb.min[2];
      const wall = (flags & 0x2) !== 0; // wall-mounted models lie along z: y and z swap
      if (flags & 0x30 && ex > 0) fx = (b[1] - b[0]) / (ex * scale);
      if (flags & 0x50 && ey > 0) {
        if (wall) fz = (b[5] - b[4]) / (ey * scale);
        else fy = (b[3] - b[2]) / (ey * scale);
      }
      if (flags & 0x90 && ez > 0) {
        if (wall) fy = (b[3] - b[2]) / (ez * scale);
        else fz = (b[5] - b[4]) / (ez * scale);
      }
      const mn = Math.min(fx, fy, fz), mx = Math.max(fx, fy, fz);
      if (flags & 0x10) {
        fx = fy = fz = mn;
      } else {
        if (!(flags & 0x20) && ex === 0) fx = mx;
        if (!(flags & 0x40) && ey === 0) {
          if (wall) fz = mx;
          else fy = mx;
        }
        if (!(flags & 0x80) && ez === 0) {
          if (wall) fy = mx;
          else fz = mx;
        }
      }
      // Divide by the largest factor and keep it in the uniform model scale.
      fx /= mx;
      fy /= mx;
      fz /= mx;
      if (!(fx > 1e-6 && fy > 1e-6 && fz > 1e-6)) fx = fy = fz = 1;
      scale *= mx;
    }
  }
  scale *= (obj.extraScale ?? 256) / 256;
  let rot = basis(pad);
  const f = [fx, fy, fz];
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) rot[c * 4 + r] *= f[c] * scale;
  if (mb) {
    if (flags & 0x2) {
      // Wall-mounted: the back of the box (zmin) on the pad.
      rot = mul4(rot, mul4(rotY(Math.PI), rotX(1.5 * Math.PI)));
      pos = add(pos, [rot[8], rot[9], rot[10]], -mb.min[2]);
    } else if (flags & 0x4) {
      // Upside down: the top of the box at the pad.
      rot = mul4(rot, rotZ(Math.PI));
      pos = add(pos, [rot[4], rot[5], rot[6]], -mb.max[1]);
    } else if (flags & 0x8) {
      pos = add(pos, [rot[4], rot[5], rot[6]], -mb.min[1]);
    } else {
      // On the floor (0x7F040AB4): y = floor + 4 - col1.y × ymin.
      const floor = o.floorY(pos[0], pos[2], pad);
      pos = [pos[0] - rot[4] * mb.min[1], floor + 4 - rot[5] * mb.min[1], pos[2] - rot[6] * mb.min[1]];
    }
  }
  return placement(rot, pos, scale);
}

/**
 * Doors (0x7F003480), closed: the model is fitted to the bound pad's box, its x/y/z extents mapped to the box's up,
 * look and right extents, at the box centre. `doorScale` (16.16 from the last type-0x02 record) scales xmin/xmax.
 */
export function placeDoor(pad: Pad, o: { scale: number; propScale: number; box?: Box; doorScale: number }): Placement | null {
  if (!pad.box) return null;
  const k = 1 / o.scale;
  const b = pad.box.map((v) => v * k);
  b[0] *= o.doorScale;
  b[1] *= o.doorScale;
  const p: Vec3 = [pad.pos[0] * k, pad.pos[1] * k, pad.pos[2] * k];
  const r = normalize(cross(pad.up, pad.look));
  const centre = add(add(add(p, r, 0.5 * (b[0] + b[1])), pad.up, 0.5 * (b[2] + b[3])), pad.look, 0.5 * (b[4] + b[5]));
  const rot = mul4(basis(pad), mul4(rotZ(Math.PI / 2), rotX(Math.PI / 2)));
  let sx = 1, sy = 1, sz = 1;
  if (o.box) {
    sx = (b[3] - b[2]) / (o.box.max[0] - o.box.min[0]);
    sy = (b[5] - b[4]) / (o.box.max[1] - o.box.min[1]);
    sz = (b[1] - b[0]) / (o.box.max[2] - o.box.min[2]);
    if (!(sx > 1e-6 && sy > 1e-6 && sz > 1e-6)) sx = sy = sz = 1;
  }
  const f = [sx, sy, sz];
  for (let c = 0; c < 3; c++) for (let rr = 0; rr < 3; rr++) rot[c * 4 + rr] *= f[c] * o.propScale;
  return placement(rot, centre, o.propScale * Math.max(sx, sy, sz));
}

// A guard's model origin above the floor, world units (verified on 228 idle guards on 8 stages).
export const GUARD_ORIGIN_HEIGHT = 108.3;

/** Guards: at the pad's x/z, origin 108.30 units above the floor, facing the pad's look vector (hypothesis). */
export function placeGuard(pad: Pad, floorY: number, modelScale: number, scale: number): Placement {
  const yaw = Math.atan2(pad.look[0], pad.look[2]);
  const rot = rotY(yaw);
  for (let i = 0; i < 12; i++) rot[i] *= modelScale;
  return placement(rot, [pad.pos[0] / scale, floorY + GUARD_ORIGIN_HEIGHT, pad.pos[2] / scale], modelScale);
}
