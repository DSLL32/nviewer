export interface TrgCommand { opcode: number; args: (number | string)[]; offset: number }
export interface TrgNode {
  index: number;
  type: number;
  subtype?: number;
  position?: [number, number, number];
  angles?: [number, number, number];
  links?: number[];
  pickupType?: number;
  modelChecksums?: number[];
  whatIf?: boolean;
  commands?: TrgCommand[];
  name?: string;
}
export interface ParsedTrg { slot: number; nodes: TrgNode[]; restarts: TrgNode[]; autoexec: TrgNode[] }

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const u16 = (b: Uint8Array, p: number) => view(b).getUint16(p);
const s16 = (b: Uint8Array, p: number) => view(b).getInt16(p);
const u32 = (b: Uint8Array, p: number) => view(b).getUint32(p);
const s32 = (b: Uint8Array, p: number) => view(b).getInt32(p);
const align2 = (p: number) => (p + 1) & ~1;
const align4 = (p: number) => (p + 3) & ~3;

function string(data: Uint8Array, p: number, end: number): [string, number] {
  let q = p; while (q < end && data[q]) q++;
  if (q >= end) throw new Error(`unterminated TRG string at 0x${p.toString(16)}`);
  return [String.fromCharCode(...data.subarray(p, q)), align2(q + 1)];
}
function links(data: Uint8Array, p: number, aligned = true): [number[], number] {
  const count = u16(data, p); p += 2;
  const result = Array.from({ length: count }, (_, i) => u16(data, p + i * 2)); p += count * 2;
  return [result, aligned ? align4(p) : p];
}
function position(data: Uint8Array, p: number): [number, number, number] { return [s32(data, p), s32(data, p + 4), s32(data, p + 8)]; }

const STRING_OPS = new Set([0x7e, 0x7f, 0x80, 0x8c, 0x8e, 0x9f, 0xb0, 0xb2, 0xb5, 0xbd, 0xc6]);
const NOARG = new Set([3, 4, 5, 10, 11, 12, 0x66, 0x67, 0x6e, 0x81, 0x88, 0x89, 0x8a, 0x95, 0x98, 0x9a, 0x9e, 0xa2, 0xad, 0xaf, 0xb1, 0xba, 0xbc, 0xc7, 0xda, 0xdb, 0xdc, 0xdd, 0x12c, 0x12d, 0x130, 0x131]);
const ONE = new Set([13, 0x69, 0x6a, 0x83, 0x84, 0x86, 0x93, 0x94, 0x96, 0x97, 0x99, 0x9b, 0x9c, 0x9d, 0xa0, 0xa1, 0xa3, 0xa4, 0xa5, 0xa6, 0xa8, 0xa9, 0xaa, 0xac, 0xbe, 0xc3, 0xc5, 0xcb, 0xbb, 0xcc, 0xd5, 0xd9, 0xde, 0xdf, 0x12e]);
const TWO = new Set([0x82, 0x87, 0x8b, 0x8f, 0x90, 0x91, 0x92, 0xa7, 0xae, 0xc8, 0xca]);
const THREE = new Set([0x68, 0xb6, 0xb7, 0xb8, 0x12f]);

function commands(data: Uint8Array, p: number, end: number): TrgCommand[] {
  const out: TrgCommand[] = [];
  while (p + 2 <= end) {
    const at = p, op = u16(data, p); p += 2; const args: (number | string)[] = [];
    if (op === 0xffff) return out;
    if (op === 0xbf) { let s; [s, p] = string(data, p, end); args.push(s, u16(data, p), u16(data, p + 2), u16(data, p + 4)); p += 6; }
    else if (STRING_OPS.has(op)) { let s; [s, p] = string(data, p, end); args.push(s); }
    else if (NOARG.has(op)) { /* none */ }
    else if (ONE.has(op)) { args.push(u16(data, p)); p += 2; }
    else if (TWO.has(op)) { args.push(u16(data, p), u16(data, p + 2)); p += 4; }
    else if (THREE.has(op)) { args.push(u16(data, p), u16(data, p + 2), u16(data, p + 4)); p += 6; }
    else if (op === 0x85) { for (let i = 0; i < 6; i++) args.push(s32(data, p + i * 4)); p += 24; }
    else if (op === 0x8d || op === 0xc0 || op === 0xc1 || op === 0xd1) {
      args.push(u16(data, p)); p += 2; while (p + 2 <= end) { const x = u16(data, p); p += 2; if (x === 0xff) break; args.push(x); }
    } else if (op === 0xab) { p = align4(p); args.push(u32(data, p), u16(data, p + 4), u16(data, p + 6), u16(data, p + 8)); p += 10; }
    else if (op === 0xc2) { p = align4(p); args.push(u32(data, p)); p += 4; }
    else if (op === 0xc4) { args.push(u16(data, p), u16(data, p + 2)); p += 4; }
    else if (op === 0xc9) { p = align4(p); args.push(u32(data, p), s16(data, p + 4)); p += 6; }
    else if (op === 0xb4) { for (let i = 0; i < 5; i++) args.push(u16(data, p + i * 2)); p += 10; }
    else if (op === 2) { for (;;) { let s; [s, p] = string(data, p, end); if (!s) break; args.push(s); } }
    else break; // Bounded fail-soft: environment preceding an unknown command remains useful.
    if (p > end) break;
    out.push({ opcode: op, args, offset: at });
  }
  return out;
}

const SCRIPT_ONE = new Set([0x2100,0x2101,0x2114,0x2115,0x2120,0x2121,0x2122,0x2123,0x2124,0x2129,0x212d,0x212e,0x2131,0x4101,0x4102,0x4104,0x4110,0x4112,0x4113,0x4114,0x4115,0x4116,0x4202,0x4221,0x4227,0x4280,0x4290,0x4291,0x4292,0x4296,0x4297,0x4298,0x4299,0x42a2,0x42b1,0x42b3,0x42b4,0x42c0,0x4303,0x4305,0x4309,0x4503,0x4507]);
const SCRIPT_TWO = new Set([0x2125,0x4118,0x4201,0x4304,0x4306,0x4307,0x4308,0x4508]);
const SCRIPT_THREE = new Set([0x2127,0x2128,0x2134,0x2137,0x4302]);
function scriptModels(data: Uint8Array, p: number, end: number): { hashes: number[]; whatIf: boolean } {
  const hashes: number[] = []; let whatIf = false;
  while (p + 2 <= end) {
    const op = u16(data, p); p += 2; if (op === 0x4100) break; if (op < 0x2000) continue;
    if (op === 0x212f || op === 0x4293 || op === 0x2135) { p = align4(p); if (p + 4 > end) break; if (op === 0x212f) hashes.push(u32(data, p)); p += 4; }
    else if (SCRIPT_ONE.has(op)) p += 2; else if (SCRIPT_TWO.has(op)) p += 4; else if (SCRIPT_THREE.has(op)) p += 6;
    else if (op === 0x429b) p += 12; else if (op === 0x429c) p += 10; else if (op === 0x4220 || op === 0x4222) p = align4(p) + 12;
    else if (op === 0x42b0 || op === 0x4200) { while (p < end && data[p]) p++; p = align2(p + 1); }
    else if (op === 0x4117) whatIf = true;
  }
  return { hashes, whatIf };
}

export function parseTrg(data: Uint8Array, slot: number): ParsedTrg {
  if (data.length < 16 || String.fromCharCode(...data.subarray(0, 4)) !== 'GRT_' || u32(data, 4) !== 0x00010002) throw new Error(`invalid Spider-Man TRG ${slot}`);
  const count = u32(data, 8), offsets = Array.from({ length: count }, (_, i) => u32(data, 12 + i * 4));
  if (!offsets.length || 12 + count * 4 > data.length) throw new Error(`invalid Spider-Man TRG ${slot} offsets`);
  const nodes: TrgNode[] = [];
  for (let i = 0; i < count; i++) {
    const start = offsets[i], end = offsets.slice(i + 1).find((x) => x > start) ?? data.length;
    if (start + 2 > end || end > data.length) continue;
    const type = u16(data, start), node: TrgNode = { index: i, type }; let p = start + 2;
    try {
      if (type === 3 || type === 10 || type === 11) { [node.links, p] = links(data, p); node.position = position(data, p); }
      else if (type === 13) { node.links = [u16(data, p)]; p = align4(p + 2); node.position = position(data, p); }
      else if (type === 1 || type === 7) {
        node.subtype = u16(data, p); const priority = u16(data, p + 2); p += 4; [node.links, p] = links(data, p, false);
        if (priority === 0x1000 || priority === 0x1001) {
          while (p < end && data[p] !== 0xff) p++; p = align4(p + 1); node.position = position(data, p); node.angles = [s16(data, p + 12), s16(data, p + 14), s16(data, p + 16)]; p += 18;
          if (node.subtype === 401) { p = align4(p); const hashes: number[] = []; while (p + 4 <= end) { const x = u32(data, p); p += 4; if (!x) break; hashes.push(x); } node.modelChecksums = hashes; }
          else if (node.subtype === 402) { const result = scriptModels(data, p, end); node.modelChecksums = result.hashes; node.whatIf = result.whatIf; }
        } else if (p + 12 <= end) node.position = position(data, p);
      } else if (type === 5) { node.pickupType = u16(data, p); p += 2; [node.links, p] = links(data, p); node.position = position(data, p); }
      else if (type === 8) {
        [node.links, p] = links(data, p); node.position = position(data, p); node.angles = [s16(data, p + 12), s16(data, p + 14), s16(data, p + 16)]; p += 18;
        [node.name, p] = string(data, p, end); if (end - p > 2) node.commands = commands(data, p, end);
      } else if (type === 4 || type === 15) node.commands = commands(data, p, end);
      else if (type === 6) { [node.links, p] = links(data, p); p += 4; if (end - p > 2) node.commands = commands(data, p, end); }
      else if (type === 500 || type === 501) { p = align4(p); node.position = position(data, p); }
      else if (type === 1000 || type === 1001) { [node.links, p] = links(data, p); node.position = position(data, p); node.angles = [s16(data, p + 12), s16(data, p + 14), s16(data, p + 16)]; }
      else if (type === 1002) { p += 2; [node.links, p] = links(data, p); node.position = position(data, p); }
    } catch { /* retain the bounded node header; malformed optional details become diagnostics-only */ }
    nodes.push(node);
  }
  return { slot, nodes, restarts: nodes.filter((n) => n.type === 8), autoexec: nodes.filter((n) => n.type === 4 || n.type === 15) };
}

export const TRG_TYPE_NAMES: Record<number, string> = {
  1:'BADDY',2:'CRATE',3:'POINT',4:'AUTOEXEC',5:'POWERUP',6:'COMMANDPOINT',7:'SEEDABLEBADDY',8:'RESTART',9:'BARREL',10:'RAILDEF',11:'RAILPOINT',12:'TRICKOB',13:'CAMPT',14:'GOALOB',15:'AUTOEXEC2',16:'MYST',255:'TERMINATOR',500:'LIGHT',501:'OFFLIGHT',1000:'SCRIPTPOINT',1001:'CAMERAPATH',1002:'ENHANCEDSPAWN',
};

export const BADDY_NAMES: Record<number, string> = { 203:'SCRIPTONLYBADDY',303:'MJ',304:'THUG',306:'POLICE',307:'RHINO',308:'DOCOCK',309:'SUPERDOCOCK',310:'SCORPION',311:'MYSTERIO',312:'HENCHMAN',313:'VENOM',314:'CARNAGE',315:'HOSTAGE',316:'JONAH',317:'LIZMAN',318:'BADDYCHOPPER',319:'BLACKCAT',320:'SWAT',401:'MANIPOB',402:'PLATFORM',403:'LEVER',404:'LASERFENCE',405:'TRIPWIRE',407:'SWITCH',408:'LASERBEAM',409:'ELECTROLINE',411:'SYMBYDROPLET',412:'PUNCHOB' };
