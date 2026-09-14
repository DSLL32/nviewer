// GoldenEye setup files: Usetup<code>Z (solo) and Ump_setup<code>Z (multiplayer), inflated (docs/GOLDENEYE.md §4.1-§4.4).
//
// The header is ten u32 file offsets. Pads are in BG units (the game divides positions and boxes by the stage scale
// f0C at load). Object records are variable-sized by type (byte +3) and end with type 0x30, which is followed by the
// intro block (spawns, starting weapons, cameras).
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

export const SETUP_HEADER = ['pathTables', 'pathLinks', 'intro', 'objects', 'pathSets', 'aiLists', 'pads', 'boundPads', 'padNames', 'boundPadNames'] as const;
export type SetupHeader = Record<(typeof SETUP_HEADER)[number], number>;

/** Record size in bytes by type (0x7F0568F4; every setup file walks exactly to its intro block). Unlisted: 4. */
export const OBJECT_SIZE: Record<number, number> = {
  0x01: 0x100, 0x02: 0x8, 0x03: 0x80, 0x04: 0x84, 0x05: 0x80, 0x06: 0xec, 0x07: 0x84, 0x08: 0x88, 0x09: 0x1c,
  0x0a: 0x100, 0x0b: 0x254, 0x0c: 0x80, 0x0d: 0xd8, 0x0e: 0xc, 0x0f: 0x4, 0x10: 0x4, 0x11: 0x80, 0x12: 0xc,
  0x13: 0x10, 0x14: 0xb4, 0x15: 0x88, 0x16: 0x10, 0x17: 0x10, 0x18: 0x4, 0x19: 0x8, 0x1a: 0x8, 0x1b: 0x8,
  0x1c: 0x8, 0x1d: 0x8, 0x1e: 0x10, 0x1f: 0x4, 0x20: 0x10, 0x21: 0x14, 0x22: 0x4, 0x23: 0x10, 0x24: 0x80,
  0x25: 0x28, 0x26: 0x10, 0x27: 0xb0, 0x28: 0xb4, 0x29: 0x4, 0x2a: 0x80, 0x2b: 0x80, 0x2c: 0x14, 0x2d: 0xe0,
  0x2e: 0x1c, 0x2f: 0x94, 0x30: 0x4,
};
export const OBJECT_END = 0x30;

/** Record type names (sizes are verified; names partly hypothesis, §4.3). */
export const OBJECT_TYPE_NAME: Record<number, string> = {
  0x01: 'door', 0x02: 'door scale', 0x03: 'standard object', 0x04: 'key', 0x05: 'alarm', 0x06: 'cctv',
  0x07: 'ammo magazine', 0x08: 'weapon', 0x09: 'guard', 0x0a: 'single monitor', 0x0b: 'multi monitor',
  0x0c: 'hanging monitor', 0x0d: 'autogun', 0x0e: 'link items', 0x11: 'hat', 0x12: 'guard attribute',
  0x14: 'ammo box', 0x15: 'body armour', 0x16: 'tag', 0x17: 'objective start', 0x18: 'objective end',
  0x19: 'objective: destroy', 0x1a: 'objective: complete flags', 0x1b: 'objective: fail flags', 0x1c: 'objective: collect',
  0x1d: 'objective: deposit', 0x1e: 'objective: photograph', 0x20: 'objective: enter room', 0x21: 'objective: deposit in room',
  0x22: 'objective: copy item', 0x23: 'watch menu text', 0x24: 'gas release', 0x25: 'rename', 0x26: 'lock door',
  0x27: 'vehicle', 0x28: 'aircraft', 0x2a: 'glass', 0x2b: 'safe', 0x2c: 'safe item', 0x2d: 'tank', 0x2e: 'cutscene',
  0x2f: 'tinted glass', 0x30: 'end',
};

/** Types with the common object header (+0 extrascale … +0C flags2) and a prop model (§4.3). */
export const MODEL_TYPES = new Set([0x01, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x0a, 0x0b, 0x0c, 0x0d, 0x11, 0x14, 0x15, 0x24, 0x27, 0x28, 0x2a, 0x2b, 0x2d, 0x2f]);

export type Vec3 = [number, number, number];

export interface Pad {
  index: number;
  offset: number; // file offset of the record
  pos: Vec3; // BG units
  up: Vec3;
  look: Vec3;
  name: string; // e.g. "p1988e"
  // Bound pads: xmin, xmax, ymin, ymax, zmin, zmax in the pad frame (x along normalize(up x look), y up, z look).
  box?: [number, number, number, number, number, number];
}

export interface SetupObject {
  index: number;
  offset: number;
  type: number;
  size: number;
  raw: Uint8Array; // the whole record
  // Common header (MODEL_TYPES only).
  extraScale?: number; // 0x100 = 1.0
  model?: number; // prop table index
  pad?: number; // pad number (≥ 10000: bound pad n - 10000; doors: the bound-pad index itself), or a character id
  flags?: number;
  flags2?: number;
}

export interface Guard {
  offset: number;
  chrId: number;
  pad: number;
  body: number; // -1 random
  aiList: number;
  path: number;
  head: number; // -1 random
  flags: number;
}

export interface IntroRecord {
  offset: number;
  type: number;
  words: number[]; // the record's words after the type
}

/** Intro record length in words by type (walker 0x7F0057C4). */
export const INTRO_WORDS: Record<number, number> = { 0: 3, 1: 4, 2: 4, 3: 8, 4: 2, 5: 2, 6: 10, 7: 3, 8: 2, 9: 1 };
export const INTRO_TYPE_NAME: Record<number, string> = {
  0: 'spawn', 1: 'starting weapon', 2: 'starting ammo', 3: 'swirl camera', 4: 'intro animation', 5: 'cuff',
  6: 'fixed camera', 7: 'watch time', 8: 'credits', 9: 'end',
};

export interface Setup {
  header: SetupHeader;
  pads: Pad[];
  boundPads: Pad[];
  objects: SetupObject[];
  guards: Guard[];
  intro: IntroRecord[];
}

export interface Spawn {
  pad: Pad;
  set: number;
  record: IntroRecord;
}

function readPad(b: Uint8Array, dv: DataView, o: number, index: number, bound: boolean): Pad {
  const f = (k: number) => dv.getFloat32(o + k);
  const nameAt = dv.getUint32(o + 0x24);
  let name = '';
  for (let k = nameAt; nameAt && k < b.length && b[k]; k++) name += String.fromCharCode(b[k]);
  return {
    index, offset: o, pos: [f(0), f(4), f(8)], up: [f(0xc), f(0x10), f(0x14)], look: [f(0x18), f(0x1c), f(0x20)], name,
    ...(bound ? { box: [f(0x2c), f(0x30), f(0x34), f(0x38), f(0x3c), f(0x40)] as Pad['box'] } : {}),
  };
}

export function parseSetup(b: Uint8Array): Setup {
  const dv = view(b);
  const header = {} as SetupHeader;
  SETUP_HEADER.forEach((k, i) => (header[k] = dv.getUint32(i * 4)));

  // Both pad lists end with an all-zero record (name offset 0).
  const padList = (start: number, size: number, bound: boolean) => {
    const out: Pad[] = [];
    for (let o = start; start && o + size <= b.length && dv.getUint32(o + 0x24) !== 0; o += size) out.push(readPad(b, dv, o, out.length, bound));
    return out;
  };
  const pads = padList(header.pads, 0x2c, false);
  const boundPads = padList(header.boundPads, 0x44, true);

  const objects: SetupObject[] = [];
  const guards: Guard[] = [];
  for (let o = header.objects; o + 4 <= b.length; ) {
    const type = b[o + 3], size = OBJECT_SIZE[type] ?? 4;
    const obj: SetupObject = { index: objects.length, offset: o, type, size, raw: b.subarray(o, o + size) };
    if (MODEL_TYPES.has(type)) {
      obj.extraScale = dv.getUint16(o);
      obj.model = dv.getInt16(o + 4);
      obj.pad = dv.getInt16(o + 6);
      obj.flags = dv.getUint32(o + 8);
      obj.flags2 = dv.getUint32(o + 0xc);
    } else if (type === 0x09) {
      guards.push({ offset: o, chrId: dv.getInt16(o + 4), pad: dv.getInt16(o + 6), body: dv.getInt16(o + 8), aiList: dv.getUint16(o + 0xa),
        path: dv.getInt16(o + 0xc), head: dv.getInt16(o + 0x16), flags: dv.getUint32(o + 0x18) });
    }
    objects.push(obj);
    o += size;
    if (type === OBJECT_END) break;
  }

  const intro: IntroRecord[] = [];
  for (let o = header.intro; o + 4 <= b.length; ) {
    const type = dv.getUint32(o), n = INTRO_WORDS[type];
    if (n === undefined) break;
    const words: number[] = [];
    for (let k = 1; k < n && o + 4 * k + 4 <= b.length; k++) words.push(dv.getInt32(o + 4 * k));
    intro.push({ offset: o, type, words });
    o += 4 * n;
    if (type === 9) break;
  }
  return { header, pads, boundPads, objects, guards, intro };
}

/** A pad by the number stored in object and intro records (≥ 10000: bound pad). */
export function padFor(s: Setup, pad: number): Pad | undefined {
  return pad >= 10000 ? s.boundPads[pad - 10000] : s.pads[pad];
}

/** Player spawn points from the intro block (type 0 {pad; set}), in file order. */
export function spawns(s: Setup): Spawn[] {
  const out: Spawn[] = [];
  for (const record of s.intro) {
    if (record.type !== 0) continue;
    const pad = padFor(s, record.words[0]);
    if (pad) out.push({ pad, set: record.words[1], record });
  }
  return out;
}
