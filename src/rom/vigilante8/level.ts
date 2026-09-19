import { runDisplayList } from '../displaylist';
import type { Batch, Level, Mesh } from '../types';
import { appendVigilante8Collision } from './collision';
import { appendVigilante8Terrain, decodeVigilante8Bitmap, readVigilante8Terrain } from './terrain';

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

interface Chunk {
  tag: string;
  start: number;
  data: number;
  end: number;
  type?: string;
}

interface ObjectPlacement {
  index: number;
  name: string;
  bank: number;
  root: number;
  matrix: Float32Array;
  source: number;
  kind: number;
  flags: number;
  nameKey: number;
}

function text(bytes: Uint8Array, offset: number, size: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + size));
}

function chunks(bytes: Uint8Array, start: number, end: number): Chunk[] {
  const out: Chunk[] = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = start; at + 8 <= end;) {
    const tag = text(bytes, at, 4), size = dv.getUint32(at + 4), chunkEnd = at + 8 + size;
    if (chunkEnd > end) throw new Error(`Vigilante 8 ${tag} chunk outside FORM`);
    out.push({ tag, start: at, data: at + 8, end: chunkEnd, ...(tag === 'FORM' ? { type: text(bytes, at + 8, 4) } : {}) });
    at = chunkEnd + (size & 1);
  }
  return out;
}

function sectionRecord(dv: DataView, section: number, index: number, count: number): [number, number] {
  if (index < 0 || index >= count) throw new Error(`Vigilante 8 section index ${index}/${count}`);
  const a = section + dv.getUint32(section + index * 4);
  const b = section + dv.getUint32(section + (index + 1) * 4);
  if (a < section || b < a || b > dv.byteLength) throw new Error('Invalid Vigilante 8 indexed section');
  return [a, b];
}

function meshRadius(batches: Batch[]): number {
  let radius2 = 0;
  for (const batch of batches) for (let i = 0; i < batch.positions.length; i += 3) {
    const x = batch.positions[i], y = batch.positions[i + 1], z = batch.positions[i + 2];
    radius2 = Math.max(radius2, x * x + y * y + z * z);
  }
  return Math.sqrt(radius2);
}

function nodeMatrix(position: [number, number, number], angles: [number, number, number]): Float32Array {
  const radians = Math.PI * 2 / 0x1000;
  const sa = Math.sin(angles[0] * radians), ca = Math.cos(angles[0] * radians);
  const sb = Math.sin(angles[1] * radians), cb = Math.cos(angles[1] * radians);
  const sc = Math.sin(angles[2] * radians), cc = Math.cos(angles[2] * radians);
  // Exact matrix built by the game's 0x8012FAA8 node-transform routine.
  // Reflecting X/Y on both sides converts its handed, Y-down frame to the viewer.
  const r00 = sc * sa * sb + cc * cb, r01 = cc * sa * sb - sc * cb, r02 = ca * sb;
  const r10 = sc * ca, r11 = cc * ca, r12 = -sa;
  const r20 = sc * sa * cb - cc * sb, r21 = cc * sa * cb + sc * sb, r22 = ca * cb;
  return new Float32Array([
    r00, r10, -r20, 0,
    r01, r11, -r21, 0,
    -r02, -r12, r22, 0,
    -position[0], -position[1], position[2], 1,
  ]);
}

function mirrorBatchesY(batches: Batch[]): void {
  const swap = (array: Float32Array | Uint8Array, width: number, a: number, b: number) => {
    for (let component = 0; component < width; component++) {
      const ai = a * width + component, bi = b * width + component, value = array[ai];
      array[ai] = array[bi]; array[bi] = value;
    }
  };
  for (const batch of batches) {
    for (let vertex = 0; vertex < batch.positions.length / 3; vertex++)
      batch.positions[vertex * 3 + 1] = -batch.positions[vertex * 3 + 1];
    // X is already reflected by the display-list decoder. The second
    // reflection reverses winding, so restore its OpenGL-facing order.
    for (let vertex = 0; vertex < batch.positions.length / 3; vertex += 3) {
      swap(batch.positions, 3, vertex + 1, vertex + 2);
      swap(batch.uvs, 2, vertex + 1, vertex + 2);
      swap(batch.colors, 4, vertex + 1, vertex + 2);
      if (batch.unlitColors) swap(batch.unlitColors, 4, vertex + 1, vertex + 2);
      for (const colors of batch.lightingColors ?? []) swap(colors, 4, vertex + 1, vertex + 2);
      if (batch.uvs1) swap(batch.uvs1, 2, vertex + 1, vertex + 2);
    }
  }
}

function multiplyMatrix(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    let value = 0;
    for (let i = 0; i < 4; i++) value += a[i * 4 + row] * b[column * 4 + i];
    out[column * 4 + row] = value;
  }
  return out;
}

function appendBank(
  bytes: Uint8Array,
  bin: Chunk,
  level: Level,
  bankIndex: number,
  placements: ObjectPlacement[],
): number[] {
  if (!placements.length) return [];
  const base = bin.data, dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const modelCount = dv.getUint32(base), modelSection = base + dv.getUint32(base + 4);
  const textureCount = dv.getUint32(base + 16), textureSection = base + dv.getUint32(base + 20);
  const nodeCount = dv.getUint32(base + 24);
  const textureBase = textureSection + dv.getUint32(textureSection);
  const textureKeys = new Map<string, number>(), models: number[] = [];

  for (let i = 0; i < modelCount; i++) {
    const [record, recordEnd] = sectionRecord(dv, modelSection, i, modelCount);
    const vertexCount = dv.getUint32(record), vertexOffset = dv.getUint32(record + 4), dlOffset = dv.getUint32(record + 8);
    const coordinateShift = dv.getUint8(record + 20);
    let batches: Batch[] = [];
    if (vertexCount && dlOffset) {
      const vertexBase = record + vertexOffset;
      const resolve = (address: number): number => {
        const segment = address >>> 24, offset = address & 0xffffff;
        if (segment === 1) return vertexBase + offset;
        if (segment === 2) return textureBase + offset;
        return address < bytes.length ? address : -1;
      };
      batches = runDisplayList({
        buf: bytes, ucode: 'f3dex2', resolve, resolveImage: resolve,
        textures: level.textures, textureKeys, keyPrefix: `v8/${bankIndex}/`,
        // Model vertices use the descriptor's binary-point shift. The RSP
        // matrix path carries the same shift at runtime node +0x1E.
        vertexScale: 1 / (1 << coordinateShift), mirrorX: true, cullBackByDefault: true,
        // The arena renderer enters XOBF lists with lighting enabled. Lists
        // then toggle it with G_GEOMETRYMODE; without a lighting context the
        // signed normal bytes are mistaken for authored RGB vertex colours.
        geometryMode: 0x20401,
        lighting: { lights: [], ambient: [255, 255, 255] },
        combiner: true, decals: true,
      }, record + dlOffset);
      mirrorBatchesY(batches);
    }
    const mesh: Mesh = {
      name: `Bank ${bankIndex + 1} model ${i}`,
      radius: meshRadius(batches), batches,
      info: {
        bank: bankIndex, model: i, record: `0x${record.toString(16)}`,
        bytes: recordEnd - record, coordinateShift,
      },
    };
    models.push(level.meshes.push(mesh) - 1);
  }

  const nodes = Array.from({ length: nodeCount }, (_, i) => {
    const at = base + 0x1c + i * 28;
    const modelWord = dv.getUint16(at);
    return {
      model: modelWord & 0x7ff,
      disabled: (modelWord & 0x8000) !== 0,
      // XOBF descendant translations are signed 16.16. The object constructor
      // copies them unchanged and the hierarchy compositor uses them as such;
      // model coordinateShift applies to vertices independently.
      position: [dv.getInt32(at + 4) / 0x10000, dv.getInt32(at + 8) / 0x10000,
        dv.getInt32(at + 12) / 0x10000] as [number, number, number],
      angles: [dv.getUint16(at + 16) & 0xfff, dv.getUint16(at + 18) & 0xfff,
        dv.getUint16(at + 20) & 0xfff] as [number, number, number],
      sibling: dv.getUint16(at + 24), child: dv.getUint16(at + 26), at,
    };
  });
  const placed: number[] = [];
  for (const placement of placements) {
    const visited = new Set<number>();
    const stack: { index: number; parent: Float32Array; followSibling: boolean; root: boolean }[] = [
      { index: placement.root, parent: IDENTITY, followSibling: false, root: true },
    ];
    while (stack.length) {
      const { index, parent, followSibling, root } = stack.pop()!;
      if (index >= nodes.length || visited.has(index)) continue;
      visited.add(index);
      const node = nodes[index];
      // 0x80137028 never follows the selected root's sibling. Child calls set
      // flag 1 and therefore do continue each child's sibling chain.
      if (followSibling && node.sibling !== 0xffff)
        stack.push({ index: node.sibling, parent, followSibling: true, root: false });
      // Negative nodes are disabled alternatives: their sibling can survive,
      // but neither the node nor its child subtree is constructed.
      if (node.disabled) continue;
      // LOAD.DLL replaces the selected root's XOBF transform with FORM/OBJ's
      // authored world transform; descendants retain their local transforms.
      const world = root ? placement.matrix : multiplyMatrix(parent, nodeMatrix(node.position, node.angles));
      if (node.child !== 0xffff)
        stack.push({ index: node.child, parent: world, followSibling: true, root: false });
      if (node.model >= models.length || !level.meshes[models[node.model]].batches.length) continue;
      placed.push(level.instances.push({
        name: root ? `${placement.name} #${placement.index}` : `${placement.name} #${placement.index} node ${index}`,
        mesh: models[node.model], matrix: world,
        info: {
          object: placement.name, objectIndex: placement.index, objectRecord: `0x${placement.source.toString(16)}`,
          bank: bankIndex, node: index, model: node.model, record: `0x${node.at.toString(16)}`,
        },
      }) - 1);
    }
  }
  return placed;
}

function objectPlacements(bytes: Uint8Array, objects: Chunk[]): ObjectPlacement[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: ObjectPlacement[] = [];
  for (let index = 0; index < objects.length; index++) {
    const object = objects[index];
    const head = chunks(bytes, object.data + 4, object.end).find((chunk) => chunk.tag === 'HEAD');
    if (!head || head.end - head.data < 34) continue;
    const kind = dv.getUint16(head.data), type = bytes[head.data + 1];
    const bank = dv.getInt16(head.data + 26);
    // LOAD.DLL's HEAD switch constructs XOBF roots for types 0 and 2..4.
    // Type 5 is a deferred item/placeholder record; type 6 is a light.
    if (bank < 0 || type === 1 || type >= 5) continue;
    const position: [number, number, number] = [
      dv.getInt32(head.data + 8) / 0x10000,
      (dv.getInt32(head.data + 12) - 0x100000) / 0x10000,
      dv.getInt32(head.data + 16) / 0x10000,
    ];
    const angles: [number, number, number] = [
      dv.getUint16(head.data + 20) & 0xfff,
      dv.getUint16(head.data + 22) & 0xfff,
      dv.getUint16(head.data + 24) & 0xfff,
    ];
    out.push({
      index, name: text(bytes, head.data + 34, head.end - head.data - 34), bank,
      root: dv.getUint16(head.data + 28), matrix: nodeMatrix(position, angles),
      source: object.start, kind, flags: dv.getUint32(head.data + 4), nameKey: dv.getUint16(head.data + 32),
    });
  }
  return out;
}

function appendSky(bytes: Uint8Array, skyChunk: Chunk, level: Level): void {
  // XBGM palettes deliberately leave every RGBA5551 alpha bit clear; the
  // game's opaque panorama pass ignores it.
  const skyTexture = decodeVigilante8Bitmap(
    bytes, skyChunk.data + 4, `XBGM 0x${skyChunk.start.toString(16)}`, true,
  );
  const texture = level.textures.push(skyTexture) - 1;
  const sidePos: number[] = [], sideUv: number[] = [], sideColor: number[] = [];
  const segments = 32, radius = 1000;
  // Preserve the bitmap's pixel aspect around one cylindrical turn. Flat caps
  // using its edge-row colours close the panorama above and below without
  // stretching the picture towards a pole.
  const halfHeight = Math.PI * radius * skyTexture.height / skyTexture.width;
  const sideVertex = (i: number, y: number) => {
    const longitude = i / segments * Math.PI * 2;
    sidePos.push(Math.sin(longitude) * radius, y, -Math.cos(longitude) * radius);
    sideUv.push(i / segments, 0.5 - y / (2 * halfHeight));
    sideColor.push(255, 255, 255, 255);
  };
  for (let i = 0; i < segments; i++) {
    sideVertex(i, -halfHeight); sideVertex(i + 1, -halfHeight); sideVertex(i + 1, halfHeight);
    sideVertex(i, -halfHeight); sideVertex(i + 1, halfHeight); sideVertex(i, halfHeight);
  }

  const edgeColor = (y: number): [number, number, number, number] => {
    let r = 0, g = 0, b = 0;
    for (let x = 0; x < skyTexture.width; x++) {
      const at = (y * skyTexture.width + x) * 4;
      r += skyTexture.rgba[at]; g += skyTexture.rgba[at + 1]; b += skyTexture.rgba[at + 2];
    }
    return [Math.round(r / skyTexture.width), Math.round(g / skyTexture.width),
      Math.round(b / skyTexture.width), 255];
  };
  const capBatch = (y: number, rgba: [number, number, number, number]): Batch => {
    const positions: number[] = [], uvs: number[] = [], colors: number[] = [];
    const vertex = (x: number, z: number) => {
      positions.push(x, y, z); uvs.push(0, 0); colors.push(...rgba);
    };
    for (let i = 0; i < segments; i++) {
      const a = i / segments * Math.PI * 2, b = (i + 1) / segments * Math.PI * 2;
      vertex(0, 0);
      vertex(Math.sin(a) * radius, -Math.cos(a) * radius);
      vertex(Math.sin(b) * radius, -Math.cos(b) * radius);
    }
    return { texture: -1, blend: 'opaque', depthTest: false, depthWrite: false, cullBack: false,
      positions: new Float32Array(positions), uvs: new Float32Array(uvs), colors: new Uint8Array(colors) };
  };
  // XBGM is camera-relative. The exact game's screen-space projection and
  // the signed XBGM prefix remain unknown.
  const mesh = level.meshes.push({
    name: 'Panoramic sky', radius: Math.hypot(radius, halfHeight),
    batches: [
      { texture, blend: 'opaque', depthTest: false, depthWrite: false, cullBack: false,
        positions: new Float32Array(sidePos), uvs: new Float32Array(sideUv), colors: new Uint8Array(sideColor) },
      capBatch(halfHeight, edgeColor(0)),
      capBatch(-halfHeight, edgeColor(skyTexture.height - 1)),
    ],
    info: { chunk: 'XBGM', offset: `0x${skyChunk.start.toString(16)}` },
  }) - 1;
  level.unplaced.push(mesh);
  level.skies = [{ name: 'Panoramic sky', mesh }];
}

function updateBounds(level: Level, instances: number[]): void {
  for (const index of instances) {
    const instance = level.instances[index], matrix = instance.matrix;
    for (const batch of level.meshes[instance.mesh].batches) for (let i = 0; i < batch.positions.length; i += 3) {
      const px = batch.positions[i], py = batch.positions[i + 1], pz = batch.positions[i + 2];
      const x = matrix[0] * px + matrix[4] * py + matrix[8] * pz + matrix[12];
      const y = matrix[1] * px + matrix[5] * py + matrix[9] * pz + matrix[13];
      const z = matrix[2] * px + matrix[6] * py + matrix[10] * pz + matrix[14];
      level.bounds.min[0] = Math.min(level.bounds.min[0], x); level.bounds.max[0] = Math.max(level.bounds.max[0], x);
      level.bounds.min[1] = Math.min(level.bounds.min[1], y); level.bounds.max[1] = Math.max(level.bounds.max[1], y);
      level.bounds.min[2] = Math.min(level.bounds.min[2], z); level.bounds.max[2] = Math.max(level.bounds.max[2], z);
    }
  }
}

export function decodeVigilante8Level(bytes: Uint8Array, level: Level): void {
  if (text(bytes, 0, 4) !== 'FORM' || text(bytes, 8, 4) !== 'TERR') throw new Error('Invalid Vigilante 8 TERR FORM');
  const top = chunks(bytes, 12, bytes.length);
  const banks = top.filter((chunk) => chunk.tag === 'FORM' && chunk.type === 'XOBF');
  const placements = objectPlacements(bytes, top.filter((chunk) => chunk.tag === 'FORM' && chunk.type === 'OBJ '));
  const placed: number[] = [];
  for (let i = 0; i < banks.length; i++) {
    const bin = chunks(bytes, banks[i].data + 4, banks[i].end).find((chunk) => chunk.tag === 'BIN ');
    if (!bin) throw new Error('Vigilante 8 XOBF has no BIN chunk');
    placed.push(...appendBank(bytes, bin, level, i, placements.filter((placement) => placement.bank === i)));
  }
  level.layers!.push({ name: 'scenery', kind: 'main', instances: placed });
  const surface = readVigilante8Terrain(bytes, top.find((chunk) => chunk.tag === 'ZMAP'),
    top.filter((chunk) => chunk.tag === 'ZONE'));
  const terrain = appendVigilante8Terrain(bytes, surface,
    top.find((chunk) => chunk.tag === 'XBMP'), top.find((chunk) => chunk.tag === 'TINF'),
    top.find((chunk) => chunk.tag === 'COLS'), level);
  level.layers!.push({ name: 'terrain', kind: 'main', instances: terrain });
  appendVigilante8Collision(surface, level);
  updateBounds(level, [...terrain, ...placed]);
  // Frame the authored playfield, not off-map dormant objects. Ski Resort,
  // for example, contains a valid tree placement roughly 900 units beyond
  // its ZMAP footprint; the game culls it, but including it in the initial
  // view would make the arena unreadably small.
  const terrainBounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  for (const index of terrain) {
    const instance = level.instances[index], matrix = instance.matrix;
    for (const batch of level.meshes[instance.mesh].batches) for (let i = 0; i < batch.positions.length; i += 3) {
      const x = matrix[0] * batch.positions[i] + matrix[4] * batch.positions[i + 1]
        + matrix[8] * batch.positions[i + 2] + matrix[12];
      const y = matrix[1] * batch.positions[i] + matrix[5] * batch.positions[i + 1]
        + matrix[9] * batch.positions[i + 2] + matrix[13];
      const z = matrix[2] * batch.positions[i] + matrix[6] * batch.positions[i + 1]
        + matrix[10] * batch.positions[i + 2] + matrix[14];
      terrainBounds.min[0] = Math.min(terrainBounds.min[0], x);
      terrainBounds.min[1] = Math.min(terrainBounds.min[1], y);
      terrainBounds.min[2] = Math.min(terrainBounds.min[2], z);
      terrainBounds.max[0] = Math.max(terrainBounds.max[0], x);
      terrainBounds.max[1] = Math.max(terrainBounds.max[1], y);
      terrainBounds.max[2] = Math.max(terrainBounds.max[2], z);
    }
  }
  if (terrainBounds.min.every(Number.isFinite) && terrainBounds.max.every(Number.isFinite)) {
    const center = [0, 1, 2].map((axis) =>
      (terrainBounds.min[axis] + terrainBounds.max[axis]) / 2) as [number, number, number];
    const span = Math.max(...[0, 1, 2].map((axis) => terrainBounds.max[axis] - terrainBounds.min[axis]), 100);
    level.camera = {
      eye: [center[0], center[1] + span * 0.32, center[2] + span * 0.46],
      target: center,
      fovY: 60,
    };
  }
  const sky = top.find((chunk) => chunk.tag === 'XBGM');
  if (sky) appendSky(bytes, sky, level);
}
