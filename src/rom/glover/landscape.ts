// Landscape scripts are streams of big-endian u16 opcodes with inline payloads.
const FIXED: Record<number, number> = {
  0x01:0,0x02:14,0x03:20,0x04:0,0x05:0,0x06:0,0x07:2,0x08:2,0x22:8,
  0x58:2,0x59:6,0x5a:6,0x5b:14,0x5c:2,0x5d:0,0x60:8,0x61:8,0x62:12,0x63:6,0x64:0,0x65:18,0x66:0,
  0x67:8,0x68:12,0x69:26,0x6a:2,0x6b:14,0x6c:4,0x6d:4,0x6e:6,0x6f:2,0x70:16,0x71:2,0x72:24,0x73:2,
  0x74:12,0x75:18,0x76:4,0x77:6,0x78:2,0x79:12,0x7a:16,0x7b:0,0x7c:4,0x7d:6,0x7e:4,0x7f:10,0x80:24,
  0x81:28,0x82:0,0x83:20,0x84:0,0x85:4,0x86:16,0x87:18,0x89:20,0x8a:30,0x8b:30,0x8c:52,0x8d:70,
  0x8e:2,0x8f:60,0x90:60,0x91:24,0x92:24,0x93:12,0x94:12,0x97:14,0x98:6,0x99:26,0x9d:0,0x9e:16,
  0x9f:16,0xa0:62,0xa1:24,0xa2:30,0xa3:4,0xa4:0,0xa5:8,0xa6:12,0xa7:2,0xa8:4,0xa9:4,0xaa:0,0xb3:0,
  0xb4:2,0xb5:48,0xb6:4,0xb7:4,0xb8:0,0xb9:0,0xba:0,0xbb:14,0xbc:24,0xbd:6,0xbe:32,0xbf:6,0xc0:0,
  0xc1:6,0xc2:6,0xc3:6,0xc4:6,0xc5:6,0xc6:6,0xc7:6,0xc8:6,
};
const ACTION_PAYLOAD: Record<number, number> = { 70:6,71:6,72:6,73:14,74:10,75:2,76:2,77:14,84:30,85:6,86:12 };

export interface LandscapeCommand { op: number; offset: number; length: number }

function variableLength(dv: DataView, op: number, at: number): number {
  const type = dv.getUint16(at);
  if (op === 0x95)
    return 2 + (type >= 34 && type <= 41 ? [28,24,16,24,16,24,16,20][type - 34] : 4);
  if (op === 0x96) {
    if (type in ACTION_PAYLOAD) return 2 + ACTION_PAYLOAD[type];
    return 2 + ([53,59,60,61,62,63,64].includes(type) ? 12 : type === 79 ? 8 : 0) + 12;
  }
  if (op === 0x9a || op === 0x9b || op === 0x9c) {
    const payload = type === 3 ? 24 : [0,1,2,9,10,11,13,22,23].includes(type) ? 12 : 4;
    return 4 + payload + 18;
  }
  if (op === 0xab) return 2 + (type < 7 ? [10,14,18,6,6,2,4][type] : 0) + 4;
  throw new Error(`unknown variable Glover landscape opcode 0x${op.toString(16)}`);
}

export function parseLandscape(file: Uint8Array): LandscapeCommand[] {
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const out: LandscapeCommand[] = [];
  for (let at = 12; at + 2 <= file.length;) {
    const op = dv.getUint16(at);
    if (op === 32000) return out;
    const offset = at + 2;
    const length = op === 0x95 || op === 0x96 || op === 0x9a || op === 0x9b || op === 0x9c || op === 0xab
      ? variableLength(dv, op, offset) : FIXED[op];
    if (length === undefined || offset + length > file.length)
      throw new Error(`invalid Glover landscape opcode 0x${op.toString(16)} at 0x${at.toString(16)}`);
    out.push({ op, offset, length });
    at = offset + length;
  }
  throw new Error('unterminated Glover landscape');
}
