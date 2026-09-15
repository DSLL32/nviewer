// Reproducibly builds the optional Mario Kart 64 TOWN package from the 1996 source archive.
// Usage: npx tsx tools/mk64-town-package.ts [kimura-root] [output.gz]
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { dv, mio0, unpackDisplayList } from '../src/rom/mk64/fs';

const DEFAULT_KIMURA = '/home/n64/.ai-tmp/r49/mk64/leak/kimura';
const DEFAULT_OUTPUT = 'public/assets/mk64-town.bin.gz';
const MAGIC = 'MK64TOWN';
const VERSION = 1;
const HEADER_FIXED = 48;
const SECTION_ENTRY = 20;
const ALIGN = 16;
const EXPECTED = { vertices: 5699, triangles: 2817, textures: 73, materials: 11 } as const;
const ROOTS = { opaque: 0x07010c60, translucent: 0x07002c18 } as const;

interface Part { tag: string; bytes: Uint8Array; count: number }

function auditTownExecution(courseVtx: Uint8Array, gfx: Uint8Array) {
  const view = dv(gfx), vertices = dv(courseVtx);
  let triangles = 0, missing = 0, sourceDegenerates = 0, maxEdge2 = 0, sumEdge2 = 0, commands = 0;
  let edgesOver1000 = 0;
  let maxEdgeTriangle: { command: string; indices: number[]; sources: number[]; points: number[][] } | null = null;
  const missingSamples: string[] = [];
  const vertex = (index: number) => [
    vertices.getInt16(index * 14), vertices.getInt16(index * 14 + 2), vertices.getInt16(index * 14 + 4),
  ];
  for (const root of Object.values(ROOTS)) {
    // TOWN's July command stream targets the original 16-slot vertex cache. The package converts its commands to
    // modern F3DEX, but auditing with 16 slots catches an incorrect legacy count or triangle index.
    const cache = new Array<number>(16).fill(-1);
    const walk = (address: number, depth = 0) => {
      if ((address >>> 24) !== 7 || depth > 32) throw new Error(`TOWN execution reached invalid display list 0x${address.toString(16)}`);
      for (let at = address & 0xffffff, limit = 0; limit++ < 0x2000; at += 8) {
        if (at + 8 > gfx.length) throw new Error(`TOWN execution ran past display-list data at 0x${at.toString(16)}`);
        commands++;
        const w0 = view.getUint32(at), w1 = view.getUint32(at + 4), op = w0 >>> 24;
        if (op === 0x04) {
          const n = (w0 >>> 10) & 0x3f, v0 = ((w0 >>> 16) & 0xff) >>> 1, source = (w1 & 0xffffff) / 16;
          for (let i = 0; i < n && v0 + i < cache.length; i++) cache[v0 + i] = source + i;
        } else if (op === 0x06) walk(w1, depth + 1);
        else if (op === 0xbf) {
          const indices = [(w1 >>> 17) & 0x7f, (w1 >>> 9) & 0x7f, (w1 >>> 1) & 0x7f];
          const source = indices.map(index => cache[index]);
          triangles++;
          if (source.some(index => index === undefined || index < 0)) {
            missing++;
            if (missingSamples.length < 8) missingSamples.push(`0x${at.toString(16)} [${indices.join(',')}]`);
            continue;
          }
          const sourceDegenerate = new Set(source).size !== 3;
          if (sourceDegenerate) sourceDegenerates++;
          const points = source.map(vertex);
          for (let i = 0; i < 3; i++) {
            const a = points[i], b = points[(i + 1) % 3];
            const edge2 = a.reduce((sum, value, axis) => sum + (value - b[axis]) ** 2, 0);
            if (edge2 > maxEdge2) {
              maxEdge2 = edge2;
              maxEdgeTriangle = { command: `0x${at.toString(16)}`, indices, sources: source, points };
            }
            if (edge2 > 1000 ** 2) {
              edgesOver1000++;
            }
            sumEdge2 += edge2;
          }
        } else if (op === 0xb8) return;
      }
      throw new Error(`TOWN execution did not terminate at 0x${address.toString(16)}`);
    };
    walk(root);
  }
  return { triangles, missing, missingSamples, sourceDegenerates, maxEdge: Math.sqrt(maxEdge2), maxEdgeTriangle,
    edgesOver1000, sumEdge2, commands };
}

// TOWN_pk.c predates the October 1996 packed-bytecode revision and targets a 16-slot vertex cache. Its encoded count
// value 1 is a sentinel meaning "load through slot 15"; values 2 and above are direct counts. Thus compact 0x33 is a
// full-cache load, while 0x34 and later retain ascending counts, and a general record with encoded count 1 loads
// 16-v0 vertices. Convert those records mechanically to modern F3DEX G_VTX commands, leaving every source pointer and
// triangle index untouched. The lockstep walk also verifies the archived expanded display-list layout.
function unpackTownDisplayList(packed: Uint8Array, vertexCount: number) {
  const result = unpackDisplayList(packed), view = dv(result.gfx);
  let packedAt = 0, gfxAt = 0, julyVertexLoads = 0, generalSentinelLoads = 0, generalLiteralLoads = 0;
  let compactSentinelLoads = 0, compactLiteralLoads = 0, compactMin = 0xff, compactMax = 0;
  for (;;) {
    if (packedAt >= packed.length) throw new Error('TOWN packed display list has no terminator');
    const op = packed[packedAt++];
    if (op === 0xff) break;
    let args: number, emitted: number;
    if (op <= 0x14) { args = 0; emitted = 3; }
    else if ((op >= 0x15 && op <= 0x19) || op === 0x26 || op === 0x27 || op === 0x2a || op === 0x2d || op === 0x2e || op === 0x56 || op === 0x57) { args = 0; emitted = 1; }
    else if ((op >= 0x1a && op <= 0x1f) || op === 0x2c) { args = 2; emitted = 3; }
    else if (op >= 0x20 && op <= 0x25) { args = 3; emitted = 5; }
    else if (op === 0x28) {
      args = 4;
      emitted = 1;
      if (packedAt + args > packed.length) throw new Error(`TOWN opcode at 0x${(packedAt - 1).toString(16)} is truncated`);
      const encodedCount = packed[packedAt + 2] & 0x3f, v0 = packed[packedAt + 3] & 0x3f;
      const n = encodedCount === 1 ? 16 - v0 : encodedCount;
      const source = packed[packedAt] | packed[packedAt + 1] << 8;
      if (encodedCount < 1 || n < 1 || v0 + n > 16 || source + n > vertexCount)
        throw new Error(`TOWN July vertex load at 0x${(packedAt - 1).toString(16)} is out of bounds`);
      view.setUint32(gfxAt, ((0x04 << 24) | (v0 * 2 << 16) | (n << 10) | (16 * n - 1)) >>> 0);
      julyVertexLoads++;
      if (encodedCount === 1) generalSentinelLoads++; else generalLiteralLoads++;
    }
    else if (op === 0x29 || op === 0x2b) { args = 2; emitted = 1; }
    else if (op === 0x30) { args = 3; emitted = 1; }
    else if (op >= 0x33 && op <= 0x42) {
      args = 2;
      emitted = 1;
      if (packedAt + args > packed.length) throw new Error(`TOWN opcode at 0x${(packedAt - 1).toString(16)} is truncated`);
      const n = op === 0x33 ? 16 : op - 0x32;
      const source = packed[packedAt] | packed[packedAt + 1] << 8;
      if (source + n > vertexCount)
        throw new Error(`TOWN July compact vertex load at 0x${(packedAt - 1).toString(16)} is out of bounds`);
      view.setUint32(gfxAt, ((0x04 << 24) | (n << 10) | (16 * n - 1)) >>> 0);
      julyVertexLoads++;
      if (op === 0x33) compactSentinelLoads++; else compactLiteralLoads++;
      compactMin = Math.min(compactMin, op);
      compactMax = Math.max(compactMax, op);
    } else if (op === 0x58) { args = 4; emitted = 1; }
    else throw new Error(`TOWN packed display list has invalid July opcode 0x${op.toString(16)} at 0x${(packedAt - 1).toString(16)}`);
    if (packedAt + args > packed.length) throw new Error(`TOWN opcode at 0x${(packedAt - 1).toString(16)} is truncated`);
    packedAt += args;
    gfxAt += emitted * 8;
  }
  if (packedAt !== packed.length || gfxAt !== result.gfx.length)
    throw new Error(`TOWN packed/expanded layout mismatch: 0x${packedAt.toString(16)}/0x${gfxAt.toString(16)}`);
  return { ...result, julyVertexLoads, generalSentinelLoads, generalLiteralLoads,
    compactSentinelLoads, compactLiteralLoads, compactMin, compactMax };
}

function cArray(file: string, symbol: string): Uint8Array {
  const text = readFileSync(file, 'utf8');
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`(?:extern\\s+)?unsigned\\s+char\\s+${escaped}\\s*\\[\\s*\\]\\s*=\\s*\\{([\\s\\S]*?)\\};`));
  if (!match) throw new Error(`missing unsigned char array ${symbol} in ${file}`);
  return Uint8Array.from(Array.from(match[1].matchAll(/0x([0-9a-fA-F]{1,2})|(?<![A-Za-z0-9_])([0-9]{1,3})(?![A-Za-z0-9_])/g),
    value => Number.parseInt(value[1] ?? value[2], value[1] ? 16 : 10)));
}

function asciiTag(tag: string): number {
  if (tag.length !== 4) throw new Error(`section tag ${tag} is not four bytes`);
  return (tag.charCodeAt(0) << 24 | tag.charCodeAt(1) << 16 | tag.charCodeAt(2) << 8 | tag.charCodeAt(3)) >>> 0;
}

function align(n: number) { return (n + ALIGN - 1) & ~(ALIGN - 1); }

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function packageBytes(parts: Part[]): Uint8Array {
  const headerSize = align(HEADER_FIXED + parts.length * SECTION_ENTRY);
  let totalSize = headerSize;
  const offsets = parts.map(part => {
    const offset = totalSize;
    totalSize = align(totalSize + part.bytes.length);
    return offset;
  });
  const out = new Uint8Array(totalSize);
  const view = dv(out);
  for (let i = 0; i < MAGIC.length; i++) out[i] = MAGIC.charCodeAt(i);
  view.setUint16(8, VERSION);
  view.setUint16(10, headerSize);
  view.setUint32(12, totalSize);
  view.setUint32(16, parts.length);
  view.setUint32(20, EXPECTED.vertices);
  view.setUint32(24, EXPECTED.triangles);
  view.setUint32(28, EXPECTED.textures);
  view.setUint32(32, ROOTS.opaque);
  view.setUint32(36, ROOTS.translucent);
  // +0x28 and +0x2c are reserved and remain zero.
  parts.forEach((part, i) => {
    const at = HEADER_FIXED + i * SECTION_ENTRY;
    view.setUint32(at, asciiTag(part.tag));
    view.setUint32(at + 4, offsets[i]);
    view.setUint32(at + 8, part.bytes.length);
    view.setUint32(at + 12, part.count);
    view.setUint32(at + 16, crc32(part.bytes));
    out.set(part.bytes, offsets[i]);
  });
  return out;
}

const kimura = process.argv[2] ?? DEFAULT_KIMURA;
const output = process.argv[3] ?? DEFAULT_OUTPUT;
const packedFile = join(kimura, 'map/TOWN_pk.c');
const townHeader = readFileSync(join(kimura, 'include/TOWN.h'), 'utf8');
for (const [macro, expected] of [
  ['TOWN_VTX_NUMBER', EXPECTED.vertices], ['TOWN_TRI_NUMBER', EXPECTED.triangles],
  ['TOWN_TEXT_NUMBER', EXPECTED.textures], ['TOWN_MAT_NUMBER', EXPECTED.materials],
] as const) {
  const found = townHeader.match(new RegExp(`#define\\s+${macro}\\s+(\\d+)`));
  if (!found || Number(found[1]) !== expected) throw new Error(`${macro} does not equal ${expected}`);
}

const courseVtx = mio0(cArray(packedFile, 'TOWN_VERTEX'));
if (courseVtx.length !== EXPECTED.vertices * 14) throw new Error(`decoded vertices are ${courseVtx.length} bytes; expected ${EXPECTED.vertices * 14}`);
const unpacked = unpackTownDisplayList(cArray(packedFile, 'TOWN_GFX'), EXPECTED.vertices);
if (unpacked.unknown.length) throw new Error(`TOWN_GFX has unknown opcodes at ${unpacked.unknown.map(n => `0x${n.toString(16)}`).join(', ')}`);
if (unpacked.julyVertexLoads !== 705 || unpacked.generalSentinelLoads !== 70 || unpacked.generalLiteralLoads !== 37 ||
    unpacked.compactSentinelLoads !== 235 || unpacked.compactLiteralLoads !== 363 ||
    unpacked.compactMin !== 0x33 || unpacked.compactMax !== 0x3b)
  throw new Error(`TOWN July vertex opcode regression: ${unpacked.julyVertexLoads} loads, compact range 0x${unpacked.compactMin.toString(16)}..0x${unpacked.compactMax.toString(16)}`);
const triangleCount = (unpacked.opcodes.get(0x29) ?? 0) + (unpacked.opcodes.get(0x58) ?? 0) * 2;
if (triangleCount !== EXPECTED.triangles) throw new Error(`TOWN_GFX has ${triangleCount} triangles; expected ${EXPECTED.triangles}`);

const gfxSize = Number(townHeader.match(/#define\s+TOWN_GFX_RAM_SIZE\s+(\d+)/)?.[1]);
if (unpacked.gfx.length !== gfxSize + 8)
  throw new Error(`TOWN expanded display list is ${unpacked.gfx.length} bytes; expected archived size ${gfxSize} plus final ENDDL`);

const execution = auditTownExecution(courseVtx, unpacked.gfx);
if (execution.triangles !== EXPECTED.triangles || execution.missing !== 0 || execution.commands !== 8588)
  throw new Error(`TOWN execution regression: ${execution.triangles} triangles, ${execution.missing} missing vertices (${execution.missingSamples.join('; ')}), max edge ${execution.maxEdge}`);
const gfx = unpacked.gfx;

const materials = cArray(packedFile, 'TOWN_MATERIAL');
if (materials.length !== EXPECTED.materials * 6) throw new Error(`TOWN_MATERIAL is ${materials.length} bytes; expected ${EXPECTED.materials * 6}`);

const infoText = readFileSync(join(kimura, 'map/TOWN_info.c'), 'utf8');
const textureEntries = Array.from(infoText.matchAll(/\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*(\d+)\s*,\s*(\d+)\s*\}/g), match => ({
  symbol: match[1], compressedSize: Number(match[2]), decodedSize: Number(match[3]),
}));
if (textureEntries.length !== EXPECTED.textures) throw new Error(`TOWN_info has ${textureEntries.length} textures; expected ${EXPECTED.textures}`);
const imageSources = new Map<string, string>();
for (const name of readdirSync(join(kimura, 'image')).filter(name => name.endsWith('.c')).sort()) {
  const file = join(kimura, 'image', name), text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/(?:extern\s+)?unsigned\s+char\s+([A-Za-z_][A-Za-z0-9_]*)\s*\[/g)) {
    if (imageSources.has(match[1])) throw new Error(`duplicate image array ${match[1]}`);
    imageSources.set(match[1], file);
  }
}
const decodedTextures: Uint8Array[] = [];
let textureOffset = 0;
for (const entry of textureEntries) {
  const source = imageSources.get(entry.symbol);
  if (!source) throw new Error(`no image source defines ${entry.symbol}`);
  const packed = cArray(source, entry.symbol);
  const decoded = mio0(packed);
  if (decoded.length !== entry.decodedSize) throw new Error(`${entry.symbol} decodes to ${decoded.length} bytes; expected ${entry.decodedSize}`);
  if ((textureOffset & 15) !== 0 || (decoded.length & 15) !== 0) throw new Error(`${entry.symbol} is not segment-5 aligned`);
  textureOffset += decoded.length;
  decodedTextures.push(decoded);
}
const textures = new Uint8Array(textureOffset);
for (let offset = 0, i = 0; i < decodedTextures.length; offset += decodedTextures[i++].length) textures.set(decodedTextures[i], offset);

const parts: Part[] = [
  { tag: 'VTXC', bytes: courseVtx, count: EXPECTED.vertices },
  { tag: 'GFX7', bytes: gfx, count: unpacked.commands },
  { tag: 'TEX5', bytes: textures, count: EXPECTED.textures },
  { tag: 'MAT6', bytes: materials, count: EXPECTED.materials },
];
const raw = packageBytes(parts);
const makeGzip = () => new Uint8Array(gzipSync(raw, { level: 9 }));
const gzip = makeGzip(), second = makeGzip();
if (!gzip.every((byte, i) => byte === second[i]) || gzip.length !== second.length) throw new Error('gzip output is not deterministic');
if (gzip[0] !== 0x1f || gzip[1] !== 0x8b || gzip[3] !== 0 || gzip.slice(4, 8).some(byte => byte !== 0))
  throw new Error('gzip header contains a timestamp, name, or unsupported flags');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, gzip);
console.log(JSON.stringify({
  output, rawBytes: raw.length, gzipBytes: gzip.length, sha256: createHash('sha256').update(gzip).digest('hex'),
  vertices: EXPECTED.vertices, triangles: EXPECTED.triangles, textureStreams: EXPECTED.textures,
  materialEntries: EXPECTED.materials, julyVertexLoads: unpacked.julyVertexLoads,
  julyVertexLoadKinds: {
    generalSentinel: unpacked.generalSentinelLoads, generalLiteral: unpacked.generalLiteralLoads,
    compactSentinel: unpacked.compactSentinelLoads, compactLiteral: unpacked.compactLiteralLoads,
  },
  compactVertexOpcodes: `0x${unpacked.compactMin.toString(16)}..0x${unpacked.compactMax.toString(16)}`, execution,
  sections: Object.fromEntries(parts.map(part => [part.tag, part.bytes.length])),
}, null, 2));
