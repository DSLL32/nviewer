import type { Batch, Level, Marker, Mesh } from '../types';
import { identity, appendObjectModel } from './geometry';
import { JfgArchive, view } from './fs';
import type { JfgTextures } from './texture';

interface Placement {
  id: number;
  position: [number, number, number];
  size: number;
  type: number;
  list: number;
  offset: number;
  bytes: Uint8Array;
}

interface DirectModel {
  modelId: number;
  scale: number;
  behavior: number;
  definition: number;
}

const matrix = (position: readonly number[], scale = 1) => new Float32Array([
  scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, position[0], position[1], position[2], 1,
]);

function readList(archive: JfgArchive, index: number): Placement[] {
  if (index < 0) return [];
  const data = archive.romList(index), dv = view(data);
  if (!data.length) return [];
  if (data.length < 16) throw new Error(`Jet Force Gemini ROM list ${index} is truncated`);
  const bytes = dv.getUint32(0), end = 16 + bytes;
  if (end > data.length) throw new Error(`Jet Force Gemini ROM list ${index} has invalid record size ${bytes}`);
  const result: Placement[] = [];
  for (let at = 16; at < end;) {
    const size = data[at + 2];
    if (size < 10 || at + size > end) throw new Error(`Jet Force Gemini ROM list ${index} has an invalid record at 0x${at.toString(16)}`);
    result.push({ id: dv.getInt16(at), size, type: data[at + 3], position: [dv.getInt16(at + 4), dv.getInt16(at + 6), dv.getInt16(at + 8)],
      list: index, offset: at, bytes: data.subarray(at, at + size) });
    at += size;
  }
  return result;
}

function directModel(archive: JfgArchive, objectId: number): DirectModel | null {
  const translation = archive.section(0x30), tdv = view(translation);
  if (objectId < 0 || objectId * 2 + 2 > translation.length) return null;
  const definition = tdv.getUint16(objectId * 2), offsets = archive.table(0x2e), definitions = archive.section(0x2f);
  if (definition + 1 >= offsets.length) return null;
  const start = offsets[definition], end = offsets[definition + 1];
  if (end - start < 0xac || end > definitions.length) return null;
  const dv = view(definitions), count = definitions[start + 0xa6], modelList = dv.getUint32(start + 0xa8);
  if (!count || modelList > end - start || count > Math.floor((end - start - modelList) / 2)) return null;
  let modelId = -1;
  for (let i = 0; i < count; i++) {
    const candidate = dv.getUint16(start + modelList + i * 2);
    if ((candidate & 0x8000) === 0) { modelId = candidate; break; }
  }
  if (modelId < 0 || modelId >= archive.table(0x26).length - 1) return null;
  const rawScale = dv.getInt16(start + 0x18);
  return { modelId, scale: rawScale ? rawScale / 100 : 1, behavior: dv.getInt16(start + 0x1c), definition };
}

class Lines {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];
  private readonly sources: number[] = [];

  add(a: readonly number[], b: readonly number[], source: number): void {
    const dx = b[0] - a[0], dz = b[2] - a[2], length = Math.hypot(dx, dz) || 1;
    const ox = -dz / length * 2, oz = dx / length * 2;
    const p = [a[0] - ox, a[1], a[2] - oz, a[0] + ox, a[1], a[2] + oz, b[0] - ox, b[1], b[2] - oz,
      a[0] + ox, a[1], a[2] + oz, b[0] + ox, b[1], b[2] + oz, b[0] - ox, b[1], b[2] - oz];
    this.positions.push(...p);
    for (let i = 0; i < 6; i++) this.colors.push(255, 205, 45, 230);
    this.sources.push(source, source);
  }

  mesh(): Mesh | null {
    if (!this.positions.length) return null;
    const batch: Batch = { texture: -1, blend: 'blend', depthTest: true, depthWrite: false, cullBack: false,
      positions: new Float32Array(this.positions), uvs: new Float32Array(this.positions.length / 3 * 2),
      colors: new Uint8Array(this.colors), triSource: new Uint32Array(this.sources) };
    return { name: 'Patrol paths', radius: 1e6, batches: [batch], info: { source: 'ROM-list object ID 5 nodes' } };
  }
}

export interface ObjectLayers {
  objects: number[];
  pathInstances: number[];
  markers: Marker[];
}

export class JfgObjectModels {
  private readonly meshes = new Map<number, number>();
  constructor(private readonly archive: JfgArchive, private readonly level: Level, private readonly textures: JfgTextures) {}

  object(objectId: number): { mesh: number; direct: DirectModel } | null {
    const direct = directModel(this.archive, objectId);
    if (!direct) return null;
    let mesh = this.meshes.get(direct.modelId);
    if (mesh === undefined) {
      mesh = appendObjectModel(this.archive, direct.modelId, this.level, this.textures);
      this.meshes.set(direct.modelId, mesh);
    }
    return { mesh, direct };
  }
}

export function appendPlacements(archive: JfgArchive, level: Level, record: Uint8Array, models: JfgObjectModels,
  markerLayer: number, pathLayer: number): ObjectLayers {
  const rdv = view(record), ids = [rdv.getInt16(0x56), rdv.getInt16(0xca)];
  const placements = ids.flatMap((id) => readList(archive, id));
  const objects: number[] = [], markers: Marker[] = [], paths = new Map<string, Placement[]>();
  for (const placement of placements) {
    if (placement.id === 5 && placement.size === 12) {
      const path = placement.bytes[0x0a];
      const key = `${placement.list}:${path}`;
      let entries = paths.get(key); if (!entries) { entries = []; paths.set(key, entries); }
      entries.push(placement);
      markers.push({ label: `path ${path} node ${placement.bytes[0x0b]}`, position: placement.position, layer: pathLayer,
        info: { path, ordinal: placement.bytes[0x0b], romList: placement.list, record: `0x${placement.offset.toString(16)}` } });
      continue;
    }
    const resolved = models.object(placement.id);
    const info = { objectId: placement.id, romList: placement.list, record: `0x${placement.offset.toString(16)}`, recordSize: placement.size, type: placement.type };
    if (resolved) {
      objects.push(level.instances.push({ name: `Object ${placement.id}`, mesh: resolved.mesh,
        matrix: matrix(placement.position, resolved.direct.scale), animated: level.meshes[resolved.mesh].info?.deformationMode !== 0,
        info: { ...info, definition: resolved.direct.definition, behavior: resolved.direct.behavior, modelId: resolved.direct.modelId,
          definitionScale: resolved.direct.scale } }) - 1);
    } else {
      markers.push({ label: `object ${placement.id}`, position: placement.position, layer: markerLayer, info });
    }
  }
  const lines = new Lines();
  for (const nodes of paths.values()) {
    const path = nodes[0].bytes[0x0a];
    nodes.sort((a, b) => a.bytes[0x0b] - b.bytes[0x0b]);
    for (let i = 1; i < nodes.length; i++) {
      if (nodes[i].bytes[0x0b] === nodes[i - 1].bytes[0x0b] + 1)
        lines.add(nodes[i - 1].position, nodes[i].position, (path << 24) | nodes[i].offset);
    }
  }
  const pathInstances: number[] = [], pathMesh = lines.mesh();
  if (pathMesh) {
    const mesh = level.meshes.push(pathMesh) - 1;
    pathInstances.push(level.instances.push({ name: 'Patrol paths', mesh, matrix: identity() }) - 1);
  }
  return { objects, pathInstances, markers };
}
