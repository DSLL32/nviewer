// Optional source-archive TOWN course package. The deployed asset contains only TOWN's decoded source vertices,
// display lists, decoded textures, source light materials, and the small container metadata needed to validate/map them.
import { runDisplayList, type DlLighting } from '../displaylist';
import type { Batch, Level, LevelInfo, LevelLayer, Mesh, Texture } from '../types';
import { buildLevel, meshFromBatches } from '../bomberman/common';
import { dv, expandVertices, SegmentSpace } from './fs';
import { addSky } from './environment';

export const TOWN_ASSET_PATH = 'assets/mk64-town.bin.gz';

const MAGIC = 'MK64TOWN';
const VERSION = 1;
const HEADER_FIXED = 48;
const SECTION_ENTRY = 20;
const MAX_COMPRESSED = 128 * 1024;
const MAX_RAW = 512 * 1024;
const EXPECTED = { vertices: 5699, triangles: 2817, textures: 73, materials: 11, sections: 4 } as const;
const EXPECTED_SECTIONS: Record<string, { bytes: number; count: number }> = {
  VTXC: { bytes: EXPECTED.vertices * 14, count: EXPECTED.vertices },
  GFX7: { bytes: 68720, count: 8590 },
  TEX5: { bytes: 223232, count: EXPECTED.textures },
  MAT6: { bytes: EXPECTED.materials * 6, count: EXPECTED.materials },
};
const OPAQUE_ROOT = 0x07010c60;
const TRANSLUCENT_ROOT = 0x07002c18;
const INITIAL_GEOMETRY = 0x1 | 0x4 | 0x2000 | 0x200 | 0x20000;
const INITIAL_RENDER_MODE = 0x00552078;
const COMBINE_SHADE: [number, number] = [0xfcffffff, 0xfffe793c];

export interface TownPackage {
  vertices: Uint8Array;
  gfx: Uint8Array;
  textures: Uint8Array;
  materials: Uint8Array;
  opaqueRoot: number;
  translucentRoot: number;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function fourCC(n: number) {
  return String.fromCharCode(n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

export function parseTownPackage(raw: Uint8Array): TownPackage {
  if (raw.length < HEADER_FIXED || raw.length > MAX_RAW) throw new Error(`TOWN package has invalid size ${raw.length}`);
  for (let i = 0; i < MAGIC.length; i++) if (raw[i] !== MAGIC.charCodeAt(i)) throw new Error('TOWN package has invalid magic');
  const view = dv(raw);
  const version = view.getUint16(8), headerSize = view.getUint16(10), totalSize = view.getUint32(12);
  const sectionCount = view.getUint32(16), vertexCount = view.getUint32(20), triangleCount = view.getUint32(24), textureCount = view.getUint32(28);
  const opaqueRoot = view.getUint32(32), translucentRoot = view.getUint32(36);
  if (version !== VERSION) throw new Error(`TOWN package version ${version} is unsupported`);
  if (totalSize !== raw.length) throw new Error(`TOWN package declares ${totalSize} bytes but has ${raw.length}`);
  if (sectionCount !== EXPECTED.sections) throw new Error(`TOWN package has ${sectionCount} sections; expected ${EXPECTED.sections}`);
  if (vertexCount !== EXPECTED.vertices || triangleCount !== EXPECTED.triangles || textureCount !== EXPECTED.textures)
    throw new Error(`TOWN package statistics are ${vertexCount} vertices, ${triangleCount} triangles, ${textureCount} textures`);
  if (opaqueRoot !== OPAQUE_ROOT || translucentRoot !== TRANSLUCENT_ROOT) throw new Error('TOWN package has unexpected display-list roots');
  if (view.getUint32(40) !== 0 || view.getUint32(44) !== 0) throw new Error('TOWN package reserved header fields are nonzero');
  const tableEnd = HEADER_FIXED + sectionCount * SECTION_ENTRY;
  if (headerSize < tableEnd || headerSize > raw.length || (headerSize & 15) !== 0) throw new Error('TOWN package has an invalid section-table boundary');

  const sections = new Map<string, Uint8Array>();
  const ranges: { start: number; end: number; tag: string }[] = [];
  for (let i = 0; i < sectionCount; i++) {
    const at = HEADER_FIXED + i * SECTION_ENTRY;
    const tag = fourCC(view.getUint32(at)), offset = view.getUint32(at + 4), length = view.getUint32(at + 8);
    const count = view.getUint32(at + 12), crc = view.getUint32(at + 16), expected = EXPECTED_SECTIONS[tag];
    if (!expected) throw new Error(`TOWN package has unknown section ${JSON.stringify(tag)}`);
    if (sections.has(tag)) throw new Error(`TOWN package repeats section ${tag}`);
    if (offset < headerSize || (offset & 15) !== 0 || length > raw.length - offset) throw new Error(`TOWN section ${tag} is out of bounds`);
    if (length !== expected.bytes || count !== expected.count) throw new Error(`TOWN section ${tag} has unexpected length or count`);
    const bytes = raw.subarray(offset, offset + length);
    if (crc32(bytes) !== crc) throw new Error(`TOWN section ${tag} failed its checksum`);
    sections.set(tag, bytes);
    ranges.push({ start: offset, end: offset + length, tag });
  }
  ranges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++) if (ranges[i].start < ranges[i - 1].end)
    throw new Error(`TOWN sections ${ranges[i - 1].tag} and ${ranges[i].tag} overlap`);
  for (const tag of Object.keys(EXPECTED_SECTIONS)) if (!sections.has(tag)) throw new Error(`TOWN package is missing section ${tag}`);

  const textureBytes = sections.get('TEX5')!;
  if ((opaqueRoot & 0xffffff) + 8 > sections.get('GFX7')!.length || (translucentRoot & 0xffffff) + 8 > sections.get('GFX7')!.length)
    throw new Error('TOWN display-list root is out of bounds');
  return {
    vertices: sections.get('VTXC')!, gfx: sections.get('GFX7')!, textures: textureBytes,
    materials: sections.get('MAT6')!, opaqueRoot, translucentRoot,
  };
}

export async function decodeTownPackage(asset: Uint8Array): Promise<TownPackage> {
  // Static hosts may serve .gz as an encoded HTTP representation. fetch() then exposes the already-decoded
  // MK64TOWN body even though the requested path ends in .gz. Other hosts expose the opaque gzip file instead.
  const isRaw = asset.length >= MAGIC.length && [...MAGIC].every((char, i) => asset[i] === char.charCodeAt(0));
  if (isRaw) return parseTownPackage(asset);
  if (asset.length < 18 || asset.length > MAX_COMPRESSED) throw new Error(`TOWN gzip has invalid size ${asset.length}`);
  if (asset[0] !== 0x1f || asset[1] !== 0x8b) throw new Error('TOWN asset is neither an MK64TOWN container nor gzip data');
  const input = new Blob([asset.slice().buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  const reader = input.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MAX_RAW) { await reader.cancel(); throw new Error('TOWN package exceeds its decompressed size limit'); }
    chunks.push(value);
  }
  const raw = new Uint8Array(length);
  for (let offset = 0, i = 0; i < chunks.length; offset += chunks[i++].length) raw.set(chunks[i], offset);
  return parseTownPackage(raw);
}

function identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function prepareTownGfx(gfx: Uint8Array, materials: Uint8Array): { gfx: Uint8Array; lighting: DlLighting } {
  const result = gfx.slice(), view = dv(result);
  let lightLoads = 0, ambientLoads = 0;
  for (let offset = 0; offset < result.length; offset += 8) {
    const w0 = view.getUint32(offset), w1 = view.getUint32(offset + 4);
    if (w0 !== 0x03860010 && w0 !== 0x03880010) continue;
    const materialOffset = (w1 & 0xffffff) - (w0 === 0x03860010 ? 8 : 0);
    if ((w1 >>> 24) !== 9 || materialOffset < 0 || materialOffset % 24 !== 0)
      throw new Error('TOWN display list has an invalid material pointer');
    const material = materialOffset / 24;
    if (material >= EXPECTED.materials) throw new Error(`TOWN display list references material ${material}`);
    const source = material * 6 + (w0 === 0x03860010 ? 3 : 0);
    // The shared F3DEX interpreter handles in-list light-colour changes as G_MOVEWORD. Keep the archive's fixed
    // (0, 120, 0) directional vector in the initial light and translate each segment-9 colour load in place.
    view.setUint32(offset, w0 === 0x03860010 ? 0xbc00000a : 0xbc00200a);
    view.setUint32(offset + 4, (materials[source] << 24 | materials[source + 1] << 16 | materials[source + 2] << 8) >>> 0);
    if (w0 === 0x03860010) lightLoads++; else ambientLoads++;
  }
  if (lightLoads === 0 || lightLoads !== ambientLoads) throw new Error('TOWN display list has incomplete material loads');
  const lighting: DlLighting = {
    ambient: [materials[0], materials[1], materials[2]],
    lights: [{ color: [materials[3], materials[4], materials[5]], dir: [0, 1, 0] }],
  };
  return { gfx: result, lighting };
}

export function loadTownLevel(data: TownPackage, info: LevelInfo): Level {
  const prepared = prepareTownGfx(data.gfx, data.materials);
  const space = new SegmentSpace({ 4: expandVertices(data.vertices, EXPECTED.vertices), 5: data.textures, 7: prepared.gfx }, 16);
  const textures: Texture[] = [], textureKeys = new Map<string, number>();
  const run = (root: number): Batch[] => runDisplayList({
    buf: space.buf, ucode: 'f3dex', resolve: space.resolve, textures, textureKeys, keyPrefix: 'TOWN:', vertexScale: 1,
    mirrorX: false, geometryMode: INITIAL_GEOMETRY, renderMode: INITIAL_RENDER_MODE, combineMode: COMBINE_SHADE,
    lighting: prepared.lighting, combiner: true, decals: true,
  }, root);
  const opaque = run(data.opaqueRoot), translucent = run(data.translucentRoot);
  // The archive's eleven material records switch throughout the lists, so a single fixed DlLighting preset would
  // be wrong. Preserve the exact per-batch source-lit result as the interactive preset; runDisplayList already keeps
  // a white unlit buffer for the viewer's Off choice.
  for (const batch of [...opaque, ...translucent]) if (batch.unlitColors) batch.lightingColors = [batch.colors.slice()];
  const triangles = [...opaque, ...translucent].reduce((sum, batch) => sum + batch.positions.length / 9, 0);
  if (!triangles) throw new Error('TOWN display-list roots produced no triangles');
  const meshes: Mesh[] = [
    { ...meshFromBatches('TOWN_model', opaque), info: { root: '0x07010c60', source: '1996 TOWN source-archive display list', renderedTriangles: opaque.reduce((n, b) => n + b.positions.length / 9, 0) } },
    { ...meshFromBatches('TOWN_grp_ALLT', translucent), info: { root: '0x07002c18', source: '1996 TOWN source-archive translucent display list', renderedTriangles: translucent.reduce((n, b) => n + b.positions.length / 9, 0) } },
  ];
  // No TOWN-specific sky/environment row survives. At the user's request, use Luigi Raceway's existing viewer sky
  // as an explicit presentation fallback; this is not evidence about the archival course's intended environment.
  const sky = addSky(8, meshes);
  const skyMesh = meshes[sky.skies[0].mesh];
  skyMesh.name = 'Luigi Raceway sky (presentation fallback)';
  skyMesh.info = { ...skyMesh.info, townEvidence: 'false', fallback: 'Luigi Raceway' };
  sky.skies[0].name = 'Luigi Raceway sky (presentation fallback)';
  const instances = [
    { name: 'TOWN_model', mesh: 0, matrix: identity(), info: { root: '0x07010c60' } },
    { name: 'TOWN_grp_ALLT', mesh: 1, matrix: identity(), info: { root: '0x07002c18' } },
  ];
  const layers: LevelLayer[] = [
    { name: 'main', kind: 'main', instances: [0] },
    { name: 'translucent', kind: 'foreground', instances: [1] },
    { name: 'collision (not recovered)', kind: 'collision', instances: [], visibleByDefault: false },
  ];
  // The archive has no recovered TOWN camera or fog. Use a bounds-derived viewer overview as the initial camera.
  const level = buildLevel(info, 'mk64-town', textures, meshes, instances,
    { layers, markers: [], skies: sky.skies, clearColor: sky.clearColor,
      lighting: { presets: ['Archived materials (+Y light)'], default: 0 } });
  const center = level.bounds.min.map((n, i) => (n + level.bounds.max[i]) / 2) as [number, number, number];
  const span = Math.max(1, ...level.bounds.max.map((n, i) => n - level.bounds.min[i]));
  level.camera = { eye: [center[0] + span * 0.7, center[1] + span * 0.45, center[2] + span * 0.8], target: center, fovY: 60 };
  return level;
}
