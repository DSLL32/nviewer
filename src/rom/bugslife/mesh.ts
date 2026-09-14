import type { Batch, Instance, Mesh } from '../types';

const dvOf = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const hex = (n: number) => `0x${n.toString(16)}`;

export interface BugsLifeMaterial {
  texture: number;
  width: number;
  height: number;
  source: string;
}

export interface BugsLifeGeometryResult {
  meshes: Mesh[];
  instances: Instance[];
  placements: number;
  models: number;
  skippedModels: number;
  skippedByReason: Record<string, number>;
  vertices: number;
  faceRecords: number;
  focusBounds: { min: [number, number, number]; max: [number, number, number] };
}

interface Placement {
  offset: number;
  list: 1 | 2;
  center: [number, number, number];
  flags: number;
  model: number;
}

interface GroupOutput {
  texture: number;
  blend: 'opaque' | 'cutout' | 'blend';
  positions: number[];
  uvs: number[];
  colors: number[];
  sources: number[];
}

interface ParsedModel {
  mesh: Mesh;
  matrix: Float32Array;
  translation: [number, number, number];
  angles: [number, number, number];
  stream: number;
  vertices: number;
  faces: number;
}

const RECORD_SIZE: Record<number, number> = { 0: 16, 1: 12, 2: 16, 3: 12, 4: 16, 6: 16, 8: 16, 9: 12, 10: 16, 11: 12, 12: 16, 14: 16 };

class UnsupportedModelError extends Error {
  constructor(readonly reason: string) { super(reason); }
}

function placementLists(data: Uint8Array): { records: Placement[]; end: number } {
  const dv = dvOf(data);
  if (data.length < 8) throw new Error('level.dat is truncated');
  const tableCount = dv.getInt32(0);
  if (tableCount < 0 || tableCount > 10000) throw new Error(`invalid initial table count ${tableCount}`);
  let p = 4;
  for (let i = 0; i < tableCount; i++) {
    if (p + 4 > data.length) throw new Error('initial level table outside file');
    const count = dv.getInt16(p), type = dv.getInt16(p + 2);
    if (count < 0) throw new Error(`negative initial table count at ${hex(p)}`);
    p += type < 0 ? Math.floor((3 * count + 1) / 2) * 4 + 16 : type === 63 ? count * 16 + 4 : count * 12 + 4;
    if (p > data.length) throw new Error('initial level table overruns file');
  }
  if (p + 4 > data.length) throw new Error('level placement header outside file');
  p += 4;
  const records: Placement[] = [];
  const list = (number: 1 | 2) => {
    for (;;) {
      if (p + 20 > data.length) throw new Error('unterminated level placement list');
      const flags = dv.getUint16(p + 14);
      if (flags & 0x8000) { p += 20; return; }
      records.push({
        offset: p, list: number,
        center: [dv.getInt32(p), dv.getInt32(p + 4), dv.getInt32(p + 8)],
        flags, model: dv.getUint32(p + 16),
      });
      p += 20;
    }
  };
  list(1);
  if (p + 4 > data.length) throw new Error('missing level pointer-table count');
  const pointerCount = dv.getInt32(p);
  if (pointerCount > 10000) throw new Error(`invalid level pointer-table count ${pointerCount}`);
  p += pointerCount >= 0 ? 8 + pointerCount * 4 : 4;
  if (p > data.length) throw new Error('level pointer table overruns file');
  list(2);
  return { records, end: p };
}

// 0x8001554c uses a 4096-entry sine table. Its matrix words match this
// row-major Rx/Ry/Rz composition; convert them to the viewer's column-major
// object-to-world representation. Header xyz, not the placement's culling
// centre, is the runtime translation.
function modelMatrix(translation: [number, number, number], angles: [number, number, number]): Float32Array {
  const [a, b, c] = angles.map((v) => (v & 0xfff) * Math.PI / 2048);
  const sa = Math.sin(a), ca = Math.cos(a), sb = Math.sin(b), cb = Math.cos(b), sc = Math.sin(c), cc = Math.cos(c);
  const r00 = cb * cc, r01 = -cb * sc, r02 = sb;
  const r10 = sa * sb * cc + ca * sc, r11 = -sa * sb * sc + ca * cc, r12 = -sa * cb;
  const r20 = -ca * sb * cc + sa * sc, r21 = ca * sb * sc + sa * cc, r22 = ca * cb;
  const matrix = new Float32Array([
    r00, r10, r20, 0,
    r01, r11, r21, 0,
    r02, r12, r22, 0,
    translation[0], translation[1], translation[2], 1,
  ]);
  // The common renderer emits (x,-y,-z) at 0x8003d1ec..0x8003d3a8.
  // Vertices below use the same S=diag(1,-1,-1), so conjugate the local
  // transform (S*M*S) to produce the runtime world coordinates S*M*v.
  for (const i of [1, 2, 4, 8, 13, 14]) matrix[i] = -matrix[i];
  return matrix;
}

function parseModel(
  data: Uint8Array,
  levelName: string,
  record: Placement,
  materialFor: (page: number, slot: number) => BugsLifeMaterial | null,
): ParsedModel {
  const dv = dvOf(data), model = record.model;
  const pointerAt = model + (record.flags & 8 ? 0x1c : 0x14);
  if (model > data.length - 0x20 || pointerAt > data.length - 4)
    throw new Error(`model header ${hex(model)} outside level.dat`);
  const stream = dv.getInt32(pointerAt);
  if (stream < 0) throw new UnsupportedModelError('pre-relocated/negative stream pointer');
  if (stream > data.length - 4) throw new Error(`model ${hex(model)} stream ${hex(stream)} outside level.dat`);
  const count = dv.getInt32(stream);
  if (count < 0) throw new UnsupportedModelError('negative-count model stream');
  if (count > 0x10000 || stream + 4 + count * 8 > data.length)
    throw new Error(`model ${hex(model)} has invalid vertex count ${count}`);

  const groupStart = stream + 4 + count * 8;
  // Low-nibble placement variants 2, 3 and 10 use another payload family.
  // One type-3 Ant Island record deliberately points at an empty common
  // stream, which is safe to retain as a no-op model.
  const placementKind = record.flags & 0xf;
  if ((placementKind === 2 || placementKind === 3 || placementKind === 10) && dv.getInt16(groupStart) !== -1)
    throw new UnsupportedModelError(`non-common placement kind ${placementKind}`);

  const sourceVertices: [number, number, number, number][] = [];
  for (let i = 0, p = stream + 4; i < count; i++, p += 8)
    sourceVertices.push([dv.getInt16(p), dv.getInt16(p + 2), dv.getInt16(p + 4), dv.getUint16(p + 6)]);

  const outputs = new Map<string, GroupOutput>();
  const outputFor = (material: BugsLifeMaterial | null, _flags: number) => {
    // The containing level pass installs AA_ZB_TEX_EDGE2 (0xc8113078), whose
    // CVG_X_ALPHA state makes RGBA5551 palette alpha a coverage mask. Group
    // control bits affect vertex shading, not the RDP render class.
    const blend = material ? 'cutout' : 'opaque';
    const texture = material?.texture ?? -1, key = `${texture}/${blend}`;
    let output = outputs.get(key);
    if (!output) {
      output = { texture, blend, positions: [], uvs: [], colors: [], sources: [] };
      outputs.set(key, output);
    }
    return output;
  };

  let p = groupStart, faces = 0, terminated = false;
  for (let groups = 0; groups < 0x10000; groups++) {
    if (p + 2 > data.length) throw new Error(`model ${hex(model)} has an unterminated face-group stream`);
    if (dv.getInt16(p) === -1) { p += 2; terminated = true; break; }
    if (p + 4 > data.length) throw new Error(`model ${hex(model)} has a truncated face-group header`);
    const control = dv.getUint16(p), faceCount = dv.getInt16(p + 2), kind = control & 0x1f;
    const recordSize = RECORD_SIZE[kind];
    if (!recordSize) throw new Error(`model ${hex(model)} uses unsupported face kind ${kind} at ${hex(p)}`);
    if (faceCount <= 0) throw new Error(`model ${hex(model)} has invalid face count ${faceCount} at ${hex(p)}`);
    if (p + 4 + faceCount * recordSize > data.length) throw new Error(`model ${hex(model)} face group overruns level.dat at ${hex(p)}`);
    const corners = recordSize === 12 ? 3 : 4, page = (control >>> 8) & 0x1f, flags = control & 0x60;
    p += 4;
    for (let face = 0; face < faceCount; face++, p += recordSize) {
      const refs = Array.from({ length: corners }, (_, i) => dv.getUint16(p + i * 2));
      const indices = refs.map((ref) => ref & 0xfff);
      if (indices.some((index) => index >= sourceVertices.length))
        throw new Error(`model ${hex(model)} face at ${hex(p)} references a vertex outside its ${count}-vertex stream`);
      const material = materialFor(page, refs[1] >>> 12), out = outputFor(material, flags);
      // The runtime's G_TRI2 word names dynamic cache slots, not source-record
      // corners directly. US 0x8003c9cc..0x8003ca58 fills slots 0..3 from
      // source refs 3,2,0,1; the command at 0x8003d06c therefore uses the
      // source-record diagonal 0--2. Preserve that topology here.
      const order = corners === 3 ? [2, 1, 0] : [2, 1, 0, 3, 2, 0];
      for (const corner of order) {
        const [x, y, z, packed] = sourceVertices[indices[corner]];
        out.positions.push(x, -y, -z);
        const uv = p + corners * 2 + corner * 2;
        // 0x8003cd0c..0x8003cd58 emits unsigned byte<<4 as S10.5 vertex ST.
        // The containing pass sets gSPTexture scale S/T to 0x8000 (one half),
        // while 0x80013324 sets tile shifts 15/14 for 32/64 texels. Applying
        // all three stages and normalising for WebGL gives byte/64 for either
        // texture dimension; the dimension-dependent shift cancels the size.
        out.uvs.push(material ? data[uv] / 64 : 0, material ? data[uv + 1] / 64 : 0);
        out.colors.push((packed & 0xf800) >>> 8, (packed & 0x07e0) >>> 3, (packed & 0x001f) << 3, 255);
      }
      for (let tri = 0; tri < order.length / 3; tri++) out.sources.push(p);
      faces++;
    }
  }
  if (!terminated) throw new Error(`model ${hex(model)} has too many face groups`);

  const batches: Batch[] = [...outputs.values()].map((out) => ({
    texture: out.texture, blend: out.blend, depthTest: true, depthWrite: out.blend !== 'blend', cullBack: false,
    positions: new Float32Array(out.positions), uvs: new Float32Array(out.uvs), colors: new Uint8Array(out.colors),
    triSource: new Uint32Array(out.sources),
  }));
  let radius = 0;
  for (const batch of batches) for (let i = 0; i < batch.positions.length; i += 3)
    radius = Math.max(radius, Math.hypot(batch.positions[i], batch.positions[i + 1], batch.positions[i + 2]));
  const translation: [number, number, number] = [dv.getInt32(model), dv.getInt32(model + 4), dv.getInt32(model + 8)];
  const angles: [number, number, number] = [dv.getUint16(model + 12), dv.getUint16(model + 14), dv.getUint16(model + 16)];
  return {
    mesh: { name: `${levelName} model ${hex(model)}`, radius, batches, info: {
      file: 'level.dat', model: hex(model), stream: hex(stream), sourceVertices: count, faceRecords: faces,
      triSource: 'offset in decoded level.dat', scale: 1,
      lod: 'authored level.dat stream (high-detail; lowres.n64 is not selected)',
    } },
    matrix: modelMatrix(translation, angles), translation, angles, stream, vertices: count, faces,
  };
}

function hasCommonEnvelope(data: Uint8Array, record: Placement): boolean {
  const dv = dvOf(data), pointerAt = record.model + (record.flags & 8 ? 0x1c : 0x14);
  if (record.model > data.length - 0x20 || pointerAt > data.length - 4) return false;
  const stream = dv.getInt32(pointerAt);
  if (stream < 0 || stream > data.length - 4) return false;
  const count = dv.getInt32(stream);
  if (count < 0 || count > 0x10000 || stream + 4 + count * 8 > data.length) return false;
  const p = stream + 4 + count * 8;
  if (dv.getInt16(p) === -1) return true;
  if (p + 4 > data.length) return false;
  const kind = dv.getUint16(p) & 0x1f, faceCount = dv.getInt16(p + 2), size = RECORD_SIZE[kind];
  return !!size && faceCount > 0 && p + 4 + faceCount * size <= data.length;
}

export function parseBugsLifeGeometry(
  data: Uint8Array,
  name: string,
  materialFor: (page: number, slot: number) => BugsLifeMaterial | null,
): BugsLifeGeometryResult {
  const placement = placementLists(data), meshes: Mesh[] = [], instances: Instance[] = [];
  const parsed = new Map<number, { mesh: number; model: ParsedModel }>();
  const skippedByReason: Record<string, number> = {};
  const centres: [number, number, number][] = [];
  let skippedModels = 0, vertices = 0, faceRecords = 0;
  const skip = (reason: string) => {
    skippedModels++;
    skippedByReason[reason] = (skippedByReason[reason] ?? 0) + 1;
  };

  for (const record of placement.records) {
    if (!record.model) continue;
    const existing = parsed.get(record.model);
    if (record.list === 2) {
      if (!existing) {
        if (!hasCommonEnvelope(data, record)) { skip('secondary non-mesh placement'); continue; }
        // Secondary records are normally another placement family. A valid
        // common envelope is nevertheless parsed strictly (the Bonus file has
        // one authored empty stream); corruption after this recognition point
        // is not swallowed as an expected skip.
        const model = parseModel(data, name, record, materialFor);
        parsed.set(record.model, { mesh: meshes.push(model.mesh) - 1, model });
        vertices += model.vertices;
        faceRecords += model.faces;
      }
      continue;
    }
    let resolved = existing;
    if (!resolved) {
      try {
        const model = parseModel(data, name, record, materialFor);
        resolved = { mesh: meshes.push(model.mesh) - 1, model };
        parsed.set(record.model, resolved);
        vertices += model.vertices;
        faceRecords += model.faces;
      } catch (error) {
        if (error instanceof UnsupportedModelError) { skip(error.reason); continue; }
        throw error;
      }
    }
    const m = resolved.model;
    instances.push({
      name: `${name} placement ${hex(record.offset)}`, mesh: resolved.mesh, matrix: m.matrix.slice(),
      info: {
        file: 'level.dat', placement: hex(record.offset), model: hex(record.model), stream: hex(m.stream),
        cullingCenter: record.center.join(', '), translation: m.translation.join(', '), angles: m.angles.map(hex).join(', '),
      },
    });
    centres.push([record.center[0], -record.center[1], -record.center[2]]);
  }

  if (!centres.length) throw new Error(`${name}: no common model placements`);
  const quantile = (axis: number, fraction: number) => {
    const values = centres.map((v) => v[axis]).sort((a, b) => a - b);
    return values[Math.round((values.length - 1) * fraction)];
  };
  const focusBounds = {
    min: [quantile(0, 0.35), quantile(1, 0.35), quantile(2, 0.35)] as [number, number, number],
    max: [quantile(0, 0.65), quantile(1, 0.65), quantile(2, 0.65)] as [number, number, number],
  };

  return {
    meshes, instances, placements: placement.records.length, models: parsed.size, skippedModels, skippedByReason,
    vertices, faceRecords, focusBounds,
  };
}
