// Perfect Dark object placement (PERFECTDARK.md §5.5): setup record + pad + model box → the world matrix the game gives a
// prop (setup 0x7F00CEE4, objInit 0x7F06A730 / 0x7F06AB60), a door (0x7F00E368) or a character (0x7F02D4FC). Matrices are
// column-major (model units → world), world = BG units.
import type { Box, M4 } from './models';
import { mul4 } from './anim';
import { padCentre, type Pad } from './pads';
import type { SetupObject } from './setup';

type Vec3 = [number, number, number];

// The game's own constants.
const PI = 3.141092538833618;
const THREE_HALF_PI = 4.711638927459717;
const HALF_PI = 1.570546269416809;

const FLAG_WALL = 0x2; // stand on the box's z min (rotated by rotY(π)·rotX(3π/2)), no floor snap
const FLAG_UPSIDE_DOWN = 0x4;
const FLAG_NO_SNAP = 0x8;
const FLAG_FIT_X = 0x20, FLAG_FIT_Y = 0x40, FLAG_FIT_Z = 0x80;
const TYPE_WEAPON = 0x08;
const FLOOR_OFFSET = 4; // 0x7F06A620: every object but weapons stands 4 units above the floor

const norm = (v: number[]): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: number[], b: number[]): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const rotX = (a: number) => new Float64Array([1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1]);
const rotY = (a: number) => new Float64Array([Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1]);
const rotZ = (a: number) => new Float64Array([Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/**
 * A pad's orientation: columns normalize(up × look), look × that, look (local X, Y, Z). The look-at helper writes these as
 * rows; objects use the transpose (verified in RAM).
 */
function padBasis(pad: Pad): M4 {
  const l = norm(pad.look), s = norm(cross(pad.up, l)), u = norm(cross(l, s));
  return new Float64Array([...s, 0, ...u, 0, ...l, 0, 0, 0, 0, 1]);
}

const scaleColumn = (m: M4, c: number, f: number) => { for (let k = 0; k < 3; k++) m[c * 4 + k] *= f; };

export interface Placement {
  matrix: Float32Array;
  position: Vec3;
  modelScale: number; // uniform part of the scale
}

function placement(m: M4, pos: number[], modelScale: number): Placement {
  const matrix = Float32Array.from(m);
  matrix[12] = pos[0];
  matrix[13] = pos[1];
  matrix[14] = pos[2];
  matrix[15] = 1;
  return { matrix, position: [pos[0], pos[1], pos[2]], modelScale };
}

/**
 * Generic objects (every placed type but doors). `type` is the record type after the game's rewrites (MINE → WEAPON);
 * `stateScale` the model table scale; the floor is the pad height (the game raycasts the collision, §5.5 step 5).
 */
/** Where a generic object is placed: the pad position, or the bottom centre of the pad's box. */
export function placementCentre(pad: Pad): Vec3 {
  if (!pad.hasBbox) return [pad.pos[0], pad.pos[1], pad.pos[2]];
  const c = padCentre(pad), h = 0.5 * (pad.bbox[2] - pad.bbox[3]);
  return [c[0] + h * pad.up[0], c[1] + h * pad.up[1], c[2] + h * pad.up[2]];
}

/** Objects that stand on a floor: no flag 0x2/0x4/0x8 and a model box. */
export const standsOnFloor = (obj: SetupObject, box: Box | null) => !!box && !(obj.flags & (FLAG_WALL | FLAG_UPSIDE_DOWN | FLAG_NO_SNAP));

export interface Floor {
  y: number;
  onObject: boolean; // the top of another object: no floor offset (objInit 0x7F06AA4C, floor hit type 2)
}

/**
 * Generic objects (every placed type but doors). `type` is the record type after the game's rewrites (MINE → WEAPON);
 * `stateScale` the model table scale. Objects that stand on the floor use `floor` (the game raycasts the collision and
 * other objects), else the placement centre's height.
 */
export function placeObject(obj: SetupObject, type: number, pad: Pad, stateScale: number, extraScale: number, box: Box | null, floor?: Floor): Placement {
  const flags = obj.flags;
  const centre = placementCentre(pad);
  let m = padBasis(pad);
  // Fit the model box to the pad box (flags 0x20/0x40/0x80; with flag 0x2 the Y and Z columns swap), normalised by the
  // largest ratio, which goes into the uniform scale.
  const r = [1, 1, 1];
  let max = 1;
  if (box && pad.hasBbox) {
    const wall = (flags & FLAG_WALL) !== 0, yCol = wall ? 2 : 1, zCol = wall ? 1 : 2;
    const ext = [box[1] - box[0], box[3] - box[2], box[5] - box[4]];
    const pext = [pad.bbox[1] - pad.bbox[0], pad.bbox[3] - pad.bbox[2], pad.bbox[5] - pad.bbox[4]];
    if (flags & FLAG_FIT_X && ext[0] > 0) r[0] = pext[0] / (ext[0] * stateScale);
    if (flags & FLAG_FIT_Y && ext[1] > 0) r[yCol] = (wall ? pext[2] : pext[1]) / (ext[1] * stateScale);
    if (flags & FLAG_FIT_Z && ext[2] > 0) r[zCol] = (wall ? pext[1] : pext[2]) / (ext[2] * stateScale);
    max = Math.max(r[0], r[1], r[2]);
    if (!(flags & FLAG_FIT_X) && ext[0] === 0) r[0] = max;
    if (!(flags & FLAG_FIT_Y) && ext[1] === 0) r[yCol] = max;
    if (!(flags & FLAG_FIT_Z) && ext[2] === 0) r[zCol] = max;
    for (let k = 0; k < 3; k++) r[k] /= max;
    if (r.some((v) => v <= 1e-6)) r.fill(1);
  }
  const scale = stateScale * max * extraScale;
  for (let c = 0; c < 3; c++) scaleColumn(m, c, r[c] * scale);
  let pos: number[] = centre;
  const column = (c: number) => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
  if (box && flags & FLAG_WALL) {
    m = mul4(m, mul4(rotY(PI), rotX(THREE_HALF_PI)));
    pos = centre.map((v, k) => v - column(2)[k] * box[4]);
  } else if (box && flags & FLAG_UPSIDE_DOWN) {
    m = mul4(m, rotZ(PI));
    pos = centre.map((v, k) => v - column(1)[k] * box[3]);
  } else if (box && flags & FLAG_NO_SNAP) {
    pos = centre.map((v, k) => v - column(1)[k] * box[2]);
  } else if (box) {
    // Stand the box on the floor along the most vertical local axis.
    let axis = 0;
    for (let c = 1; c < 3; c++) if (Math.abs(m[c * 4 + 1]) > Math.abs(m[axis * 4 + 1])) axis = c;
    const lo = m[axis * 4 + 1] < 0 ? box[axis * 2 + 1] : box[axis * 2];
    pos = centre.map((v, k) => v - column(axis)[k] * lo);
    if (floor) pos[1] = floor.y - column(axis)[1] * lo;
    if (type !== TYPE_WEAPON && !floor?.onObject) pos[1] += FLOOR_OFFSET;
  }
  return placement(m, pos, scale);
}

/**
 * Doors, closed: the pad basis × rotZ(90°)·rotX(90°) (local X → up, Y → look, Z → normal), the model box stretched to the
 * pad box, at the box centre. `doorScale` (the last DOORSCALE record) scales the box's up extent (hypothesis).
 */
export function placeDoor(pad: Pad, box: Box | null, doorScale: number): Placement {
  const m = mul4(padBasis(pad), mul4(rotZ(HALF_PI), rotX(HALF_PI)));
  const bb = [...pad.bbox] as Pad['bbox'];
  bb[2] *= doorScale;
  bb[3] *= doorScale;
  const f = [1, 1, 1];
  if (box) {
    f[0] = (bb[3] - bb[2]) / (box[1] - box[0]);
    f[1] = (bb[5] - bb[4]) / (box[3] - box[2]);
    f[2] = (bb[1] - bb[0]) / (box[5] - box[4]);
    if (!f.every((v) => v > 1e-6)) f.fill(1);
  }
  for (let c = 0; c < 3; c++) scaleColumn(m, c, f[c]);
  return placement(m, padCentre({ ...pad, bbox: bb }), Math.max(...f));
}

/**
 * Escalator steps (setup 0x7F00FBBC): the generic placement's rotation × rotY(π), or rotY(3π/2) for steps with flag
 * 0x10000000; the tick (0x7F078094) moves the step to its path position (verified: 80/80 steps in two Air Base captures).
 */
export function placeEscalatorStep(step: Placement, turned: boolean, position: readonly number[]): Placement {
  return placement(mul4(step.matrix, rotY(turned ? THREE_HALF_PI : PI)), [...position], step.modelScale);
}

/** Characters: at (x, floor, z), turned to atan2(look.x, look.z), scaled 0.1 × the body scale. */
export function placeChr(pad: Pad, floorY: number, scale: number): Placement {
  const m = rotY(Math.atan2(pad.look[0], pad.look[2]));
  for (let c = 0; c < 3; c++) scaleColumn(m, c, scale);
  return placement(m, [pad.pos[0], floorY, pad.pos[2]], scale);
}
