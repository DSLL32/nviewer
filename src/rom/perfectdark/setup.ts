// Perfect Dark setup files Usetup<code>Z / Ump_setup<code>Z (PERFECTDARK.md §5.3): the props list with its object and
// character records, and the intro commands.
//
// Header: +0x0C intro offset, +0x10 props offset. Props: commands until type 0x34, the low byte of the first word is the
// type, the length in words per type from setupGetCmdLength (0x7F091E10). Object records start with a 0x5C-byte header
// {u16 extra scale (/256); u8; u8 type; s16 model number; s16 pad; u32 flags; u32 flags2 (difficulty exclusion)}.
// Character records (0x2C bytes): +0x04 u32 spawn flags, +0x08 s16 chr number, +0x0A u16 pad, +0x0C u8 body, +0x0D s8 head,
// +0x0E u16 AI list, +0x22 s16 chair.

export const OBJECT_TYPE_NAME: Record<number, string> = {
  0x01: 'DOOR', 0x02: 'DOORSCALE', 0x03: 'BASIC', 0x04: 'KEY', 0x05: 'ALARM', 0x06: 'CCTV', 0x07: 'AMMOCRATE', 0x08: 'WEAPON',
  0x09: 'CHR', 0x0a: 'SINGLEMONITOR', 0x0b: 'MULTIMONITOR', 0x0c: 'HANGINGMONITORS', 0x0d: 'AUTOGUN', 0x0e: 'LINKGUNS',
  0x0f: 'DEBRIS', 0x11: 'HAT', 0x12: 'GRENADEPROB', 0x13: 'LINKLIFTDOOR', 0x14: 'MULTIAMMOCRATE', 0x15: 'SHIELD', 0x16: 'TAG',
  0x17: 'BEGINOBJECTIVE', 0x18: 'ENDOBJECTIVE', 0x19: 'OBJECTIVE_DESTROYOBJ', 0x1a: 'OBJECTIVE_COMPFLAGS',
  0x1b: 'OBJECTIVE_FAILFLAGS', 0x1c: 'OBJECTIVE_COLLECTOBJ', 0x1d: 'OBJECTIVE_THROWOBJ', 0x1e: 'OBJECTIVE_HOLOGRAPH',
  0x20: 'OBJECTIVE_ENTERROOM', 0x21: 'OBJECTIVE_THROWINROOM', 0x23: 'BRIEFING', 0x24: 'GASBOTTLE', 0x25: 'RENAME',
  0x26: 'PADLOCKEDDOOR', 0x27: 'TRUCK', 0x28: 'HELI', 0x2a: 'GLASS', 0x2b: 'SAFE', 0x2c: 'SAFEITEM', 0x2d: 'TANK',
  0x2e: 'CAMERAPOS', 0x2f: 'TINTEDGLASS', 0x30: 'LIFT', 0x31: 'CONDITIONALSCENERY', 0x32: 'BLOCKEDPATH', 0x33: 'HOVERBIKE',
  0x34: 'END', 0x35: 'HOVERPROP', 0x36: 'FAN', 0x37: 'HOVERCAR', 0x38: 'PADEFFECT', 0x39: 'CHOPPER', 0x3a: 'MINE', 0x3b: 'ESCASTEP',
};

const TYPE_WORDS: Record<number, number> = {
  0x01: 55, 0x02: 2, 0x03: 23, 0x04: 24, 0x05: 23, 0x06: 49, 0x07: 24, 0x08: 26, 0x09: 11, 0x0a: 53, 0x0b: 140, 0x0c: 23,
  0x0d: 43, 0x0e: 2, 0x0f: 23, 0x10: 1, 0x11: 23, 0x12: 2, 0x13: 5, 0x14: 42, 0x15: 26, 0x16: 4, 0x17: 4, 0x18: 1, 0x19: 2,
  0x1a: 2, 0x1b: 2, 0x1c: 2, 0x1d: 2, 0x1e: 4, 0x1f: 1, 0x20: 4, 0x21: 5, 0x22: 1, 0x23: 4, 0x24: 23, 0x25: 10, 0x26: 4,
  0x27: 34, 0x28: 35, 0x29: 1, 0x2a: 24, 0x2b: 23, 0x2c: 5, 0x2d: 32, 0x2e: 7, 0x2f: 26, 0x30: 37, 0x31: 5, 0x32: 4, 0x33: 56,
  0x34: 1, 0x35: 39, 0x36: 29, 0x37: 38, 0x38: 3, 0x39: 58, 0x3a: 26, 0x3b: 27,
};

/** Record types that start with the object header. */
const OBJECT_TYPES = new Set([
  0x01, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x0a, 0x0b, 0x0c, 0x0d, 0x0f, 0x11, 0x14, 0x15, 0x24, 0x27, 0x28, 0x2a, 0x2b,
  0x2d, 0x2f, 0x30, 0x33, 0x35, 0x36, 0x37, 0x39, 0x3a, 0x3b,
]);

const INTRO_WORDS: Record<number, number> = { 0: 3, 1: 4, 2: 4, 3: 8, 4: 2, 5: 2, 6: 10, 7: 3, 8: 2, 9: 3, 10: 3, 11: 2, 12: 1 };
const INTRO_END = 12;
const PROPS_END = 0x34;

export interface SetupRecord {
  index: number; // command index (links between records are relative indices)
  offset: number; // in the inflated setup file
  type: number;
  raw: Uint8Array;
}

export interface SetupObject extends SetupRecord {
  extraScale: number; // u16, 0x100 = 1
  model: number; // g_ModelStates index
  pad: number; // < 0: not placed from a pad; a chr number with flag 0x4000
  flags: number;
  flags2: number;
}

export interface SetupChr extends SetupRecord {
  spawnFlags: number;
  chrNum: number;
  pad: number;
  body: number; // 255: random
  head: number; // < 0: chosen by the game
  aiList: number;
  chair: number;
}

export interface IntroCommand {
  offset: number;
  cmd: number; // 0 SPAWN {pad, flag}, 9/10/11 multiplayer pads, 12 end …
  args: number[];
}

export interface Setup {
  records: SetupRecord[];
  objects: SetupObject[];
  chrs: SetupChr[];
  intro: IntroCommand[];
}

export function parseSetup(buf: Uint8Array): Setup {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: Setup = { records: [], objects: [], chrs: [], intro: [] };
  if (buf.length < 0x20) return out;
  for (let o = dv.getUint32(0x10), index = 0; o > 0 && o + 4 <= buf.length && index < 10000; index++) {
    const type = buf[o + 3];
    if (type === PROPS_END) break;
    const words = TYPE_WORDS[type] ?? 1;
    const rec: SetupRecord = { index, offset: o, type, raw: buf.subarray(o, Math.min(buf.length, o + words * 4)) };
    out.records.push(rec);
    if (OBJECT_TYPES.has(type) && o + 0x5c <= buf.length) {
      out.objects.push({ ...rec, extraScale: dv.getUint16(o), model: dv.getInt16(o + 4), pad: dv.getInt16(o + 6), flags: dv.getUint32(o + 8), flags2: dv.getUint32(o + 12) });
    } else if (type === 0x09 && o + 0x2c <= buf.length) {
      out.chrs.push({
        ...rec, spawnFlags: dv.getUint32(o + 4), chrNum: dv.getInt16(o + 8), pad: dv.getUint16(o + 10), body: buf[o + 12],
        head: dv.getInt8(o + 13), aiList: dv.getUint16(o + 14), chair: dv.getInt16(o + 0x22),
      });
    }
    o += words * 4;
  }
  for (let o = dv.getUint32(0x0c), guard = 0; o > 0 && o + 4 <= buf.length && guard < 10000; guard++) {
    const cmd = dv.getUint32(o), n = INTRO_WORDS[cmd] ?? 1;
    const args: number[] = [];
    for (let k = 1; k < n && o + 4 * k + 4 <= buf.length; k++) args.push(dv.getInt32(o + 4 * k));
    out.intro.push({ offset: o, cmd, args });
    if (cmd === INTRO_END) break;
    o += n * 4;
  }
  return out;
}
