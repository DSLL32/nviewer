import { runDisplayList, type DisplayListContext, type DlLighting } from '../displaylist';
import { decodeRows, ImFmt, ImSiz, Tlut } from '../texture';
import type { Batch, Mesh, Texture } from '../types';

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const ptr = (value: number) => value & 0xffffff;

export interface TextureRecord {
  id: number; width: number; height: number; format: number;
  record: number; texels: number; palette: number;
}

export function parseTextureBank(bytes: Uint8Array): TextureRecord[] {
  const dv = view(bytes);
  const count = dv.getUint32(0);
  const records: TextureRecord[] = [];
  let at = 4;
  for (let i = 0; i < count; i++) {
    if (at + 0x24 > bytes.length) throw new Error('truncated Glover texture bank');
    const length = dv.getUint32(at + 0x14);
    const palette = dv.getUint32(at + 0x20);
    if (length < 0x24 || at + length > bytes.length) throw new Error('invalid Glover texture record');
    records.push({
      id: dv.getUint32(at), width: dv.getUint16(at + 0x0c), height: dv.getUint16(at + 0x0e),
      format: dv.getUint32(at + 0x18), record: at, texels: at + dv.getUint32(at + 0x1c),
      palette: palette ? at + palette : -1,
    });
    at += length;
  }
  return records;
}

export function decodeTextureRecord(bytes: Uint8Array, record: TextureRecord): Texture {
  const format = record.format === 2 ? ImFmt.RGBA : ImFmt.CI;
  const size = record.format === 0 ? ImSiz.B4 : record.format === 1 ? ImSiz.B8 : ImSiz.B16;
  return {
    width: record.width, height: record.height,
    rgba: decodeRows(bytes, record.texels, format, size, record.width, record.height,
      record.palette >= 0 ? bytes.subarray(record.palette) : null, Tlut.Rgba16),
    wrapS: 'repeat', wrapT: 'repeat',
    format: ['CI4/RGBA16', 'CI8/RGBA16', 'RGBA16'][record.format] ?? `unknown ${record.format}`,
    source: `Glover texture 0x${record.id.toString(16)}`,
  };
}

export interface ObjectRecord { id: number; offset: number; root: number }
export interface ObjectNode {
  offset: number; name: string; alpha: number; mesh: number; displayList: number;
  scaleKeys: number; translationKeys: number; rotationKeys: number; child: number; sibling: number;
}

export function parseObjectDirectory(bytes: Uint8Array): ObjectRecord[] {
  const dv = view(bytes);
  const records: ObjectRecord[] = [];
  for (let at = 0; at + 8 <= bytes.length; at += 8) {
    const id = dv.getUint32(at);
    const offset = ptr(dv.getUint32(at + 4));
    if (!id && !offset) return records;
    if (offset + 0x1c > bytes.length) throw new Error('invalid Glover object directory');
    records.push({ id, offset, root: ptr(dv.getUint32(offset + 0x0c)) });
  }
  throw new Error('unterminated Glover object directory');
}

export function readObjectNode(bytes: Uint8Array, at: number): ObjectNode {
  const dv = view(bytes);
  if (at + 0x3c > bytes.length) throw new Error(`invalid Glover object node 0x${at.toString(16)}`);
  let name = '';
  for (let i = 4; i < 12 && bytes[at + i]; i++) name += String.fromCharCode(bytes[at + i]);
  return {
    offset: at, name, alpha: dv.getUint16(at + 0x0c), mesh: ptr(dv.getUint32(at + 0x14)),
    displayList: ptr(dv.getUint32(at + 0x18)), scaleKeys: ptr(dv.getUint32(at + 0x1c)),
    translationKeys: ptr(dv.getUint32(at + 0x20)), rotationKeys: ptr(dv.getUint32(at + 0x24)),
    child: ptr(dv.getUint32(at + 0x34)), sibling: ptr(dv.getUint32(at + 0x38)),
  };
}

type Matrix = number[];
const identity = (): Matrix => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
const multiply = (a: Matrix, b: Matrix): Matrix => {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
};
const trs = (t: number[], q: number[], s: number[]): Matrix => {
  const [x,y,z,w] = q;
  const out = [
    1-2*(y*y+z*z), 2*(x*y+z*w), 2*(x*z-y*w), 0,
    2*(x*y-z*w), 1-2*(x*x+z*z), 2*(y*z+x*w), 0,
    2*(x*z+y*w), 2*(y*z-x*w), 1-2*(x*x+y*y), 0,
    t[0],t[1],t[2],1,
  ];
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) out[c * 4 + r] *= s[c];
  return out;
};
const transform = (m: Matrix, x: number, y: number, z: number): [number, number, number] => [
  m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14],
];

export interface TextureSet {
  bytes: Uint8Array;
  records: Map<number, TextureRecord>;
  bankId: number;
}

export function combineObjectAndTextures(object: Uint8Array, textureBanks: Uint8Array[], bankId: number): TextureSet {
  let size = (object.length + 3) & ~3;
  const bases: number[] = [];
  for (const bank of textureBanks) { bases.push(size); size = (size + bank.length + 3) & ~3; }
  const bytes = new Uint8Array(size);
  bytes.set(object);
  const records = new Map<number, TextureRecord>();
  textureBanks.forEach((bank, i) => {
    const base = bases[i];
    bytes.set(bank, base);
    for (const r of parseTextureBank(bank)) records.set(r.id, {
      ...r, record: r.record + base, texels: r.texels + base, palette: r.palette < 0 ? -1 : r.palette + base,
    });
  });
  return { bytes, records, bankId };
}

function patchTextureIds(set: TextureSet, start: number, patched: Set<number>, missing: Set<number>): void {
  if (patched.has(start)) return;
  patched.add(start);
  const dv = view(set.bytes);
  for (let at = start; at + 8 <= set.bytes.length; at += 8) {
    const op = set.bytes[at];
    if (op === 0xfd) {
      const id = dv.getUint32(at + 4);
      const rec = set.records.get(id);
      if (!rec) { missing.add(id); dv.setUint32(at + 4, 0x00ffffff); }
      else dv.setUint32(at + 4, set.bytes[at + 8] === 0xe8 ? rec.palette : rec.texels);
    }
    if (op === 0xb8) return;
  }
}

export interface BuiltObject { mesh: Mesh; rootMesh: number; bytes: Uint8Array }
export interface ObjectBuildContext {
  textures: Texture[]; textureKeys: Map<string, number>; lighting: DlLighting;
  missingTextures: Set<number>; patched: Set<number>;
}

function faceBatches(set: TextureSet, node: ObjectNode, matrix: Matrix, ctx: ObjectBuildContext): Batch[] {
  const dv = view(set.bytes);
  const mesh = node.mesh;
  const faceCount = dv.getInt16(mesh), vertexCount = dv.getInt16(mesh + 2);
  const positions = ptr(dv.getUint32(mesh + 4)), indices = ptr(dv.getUint32(mesh + 8));
  const uvs = ptr(dv.getUint32(mesh + 0x10)), colors = ptr(dv.getUint32(mesh + 0x18));
  const textureIds = ptr(dv.getUint32(mesh + 0x20));
  if (faceCount <= 0 || !positions || !indices) return [];
  const groups = new Map<number, { positions: number[]; uvs: number[]; colors: number[]; source: number[] }>();
  for (let face = 0; face < faceCount; face++) {
    const textureId = textureIds ? dv.getUint32(textureIds + face * 4) : 0;
    const record = set.records.get(textureId);
    let texture = -1;
    if (record) {
      const key = `glover:${set.bankId}:${record.record}`;
      texture = ctx.textureKeys.get(key) ?? -1;
      if (texture < 0) {
        texture = ctx.textures.push(decodeTextureRecord(set.bytes, record)) - 1;
        ctx.textureKeys.set(key, texture);
      }
    } else if (textureId) ctx.missingTextures.add(textureId);
    let group = groups.get(texture);
    if (!group) groups.set(texture, group = { positions: [], uvs: [], colors: [], source: [] });
    group.source.push(mesh + face * 6);
    for (let k = 0; k < 3; k++) {
      const vertex = dv.getUint16(indices + face * 6 + k * 2);
      if (vertex >= vertexCount) continue;
      group.positions.push(...transform(matrix, dv.getFloat32(positions + vertex * 12), dv.getFloat32(positions + vertex * 12 + 4), dv.getFloat32(positions + vertex * 12 + 8)));
      const s = uvs ? dv.getInt16(uvs + face * 12 + k * 4) : 0;
      const t = uvs ? dv.getInt16(uvs + face * 12 + k * 4 + 2) : 0;
      group.uvs.push(record ? s / (32 * record.width) : 0, record ? t / (32 * record.height) : 0);
      const color = colors ? colors + vertex * 4 : -1;
      group.colors.push(color >= 0 ? set.bytes[color] : 255, color >= 0 ? set.bytes[color + 1] : 255,
        color >= 0 ? set.bytes[color + 2] : 255, node.alpha & 0xff);
    }
  }
  return [...groups.entries()].map(([texture, g]) => ({
    texture, blend: node.alpha < 255 ? 'blend' : 'opaque', depthTest: true, depthWrite: node.alpha >= 255,
    cullBack: false, positions: new Float32Array(g.positions), uvs: new Float32Array(g.uvs),
    colors: new Uint8Array(g.colors), triSource: new Uint32Array(g.source),
  }));
}

export function buildObject(set: TextureSet, object: ObjectRecord, label: string, ctx: ObjectBuildContext): BuiltObject {
  const dv = view(set.bytes);
  const batches: Batch[] = [];
  let nodeCount = 0;
  const visit = (at: number, parent: Matrix, depth: number) => {
    if (!at) return;
    if (depth > 64) throw new Error(`Glover object 0x${object.id.toString(16)} node tree is cyclic`);
    const node = readObjectNode(set.bytes, at);
    nodeCount++;
    const scale = node.scaleKeys ? [dv.getFloat32(node.scaleKeys), dv.getFloat32(node.scaleKeys + 4), dv.getFloat32(node.scaleKeys + 8)] : [1,1,1];
    const translation = node.translationKeys ? [dv.getFloat32(node.translationKeys), dv.getFloat32(node.translationKeys + 4), dv.getFloat32(node.translationKeys + 8)] : [0,0,0];
    const rotation = node.rotationKeys ? [dv.getFloat32(node.rotationKeys), dv.getFloat32(node.rotationKeys + 4), dv.getFloat32(node.rotationKeys + 8), dv.getFloat32(node.rotationKeys + 12)] : [0,0,0,1];
    const matrix = multiply(parent, trs(translation, rotation, scale));
    if (node.displayList) {
      patchTextureIds(set, node.displayList, ctx.patched, ctx.missingTextures);
      const dl: DisplayListContext = {
        buf: set.bytes, ucode: 'f3dex', resolve: a => ptr(a) < set.bytes.length ? ptr(a) : -1,
        textures: ctx.textures, textureKeys: ctx.textureKeys, keyPrefix: `glover:${set.bankId}:`,
        cullBackByDefault: true, vertexScale: 1, mirrorX: false, ciFromTlut: true, lighting: ctx.lighting,
      };
      for (const batch of runDisplayList(dl, node.displayList)) {
        for (let i = 0; i < batch.positions.length; i += 3) {
          const p = transform(matrix, batch.positions[i], batch.positions[i + 1], batch.positions[i + 2]);
          batch.positions[i] = p[0]; batch.positions[i + 1] = p[1]; batch.positions[i + 2] = p[2];
        }
        if (node.alpha < 255) {
          batch.blend = 'blend'; batch.depthWrite = false;
          for (let i = 3; i < batch.colors.length; i += 4) batch.colors[i] = Math.round(batch.colors[i] * node.alpha / 255);
        }
        batches.push(batch);
      }
    } else if (node.mesh) batches.push(...faceBatches(set, node, matrix, ctx));
    visit(node.child, matrix, depth + 1);
    visit(node.sibling, parent, depth);
  };
  visit(object.root, identity(), 0);
  let radius = 0;
  for (const batch of batches) for (let i = 0; i < batch.positions.length; i += 3)
    radius = Math.max(radius, Math.hypot(batch.positions[i], batch.positions[i + 1], batch.positions[i + 2]));
  return {
    mesh: { name: label, radius, batches, info: { objectId: `0x${object.id.toString(16)}`, objectRecord: `0x${object.offset.toString(16)}`, objectBank: set.bankId, nodes: nodeCount } },
    rootMesh: readObjectNode(set.bytes, object.root).mesh, bytes: set.bytes,
  };
}
