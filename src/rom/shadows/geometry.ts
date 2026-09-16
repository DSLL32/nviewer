import type { Batch, Level, Mesh } from '../types';
import { ShadowsSceneImage } from './scene';
import { ShadowsSceneTextures } from './texture';

const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const hex = (value: number) => `0x${value.toString(16)}`;

type Vertex = { position: [number, number, number]; uv: [number, number]; color: [number, number, number, number] };

function vertex(scene: ShadowsSceneImage, offset: number): Vertex {
  // The signed scene vertex coordinates have eight units per scene-space unit.
  // The scene's Z axis is vertical; the viewer's Y axis is vertical.
  return {
    position: [scene.s16(offset) / 8, scene.s16(offset + 4) / 8, scene.s16(offset + 2) / 8],
    uv: [scene.s16(offset + 8) / 32, scene.s16(offset + 10) / 32],
    color: [scene.u8(offset + 12), scene.u8(offset + 13), scene.u8(offset + 14), scene.u8(offset + 15)],
  };
}

function decodeMesh(scene: ShadowsSceneImage, textures: ShadowsSceneTextures, record: number, commandStart: number): Mesh | null {
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [], sources: number[] = [];
  let loaded: Vertex[] = [];
  let ended = false;
  const texture = textures.forRecord(record);
  const image = texture >= 0 ? textures.textures[texture] : null;
  const push = (indices: number[], command: number) => {
    // Swapping the source Y/Z axes changes handedness; reverse each triangle
    // so the game's back-face mode still selects the authored front face.
    for (const index of [indices[0], indices[2], indices[1]]) {
      const v = loaded[index];
      if (!v) return false;
      positions.push(...v.position);
      uvs.push(image ? v.uv[0] / image.width : 0, image ? v.uv[1] / image.height : 0);
      colors.push(...v.color);
    }
    sources.push(command);
    return true;
  };
  // All verified mesh streams use the five commands below. A bounded parser
  // excludes byte sequences that merely resemble display lists.
  for (let at = commandStart; at < Math.min(commandStart + 0x4000, scene.bytes.length - 7); at += 8) {
    const w0 = scene.u32(at), w1 = scene.u32(at + 4);
    if (w0 === 0xb8000000 && w1 === 0) { ended = true; break; }
    if ((w0 >>> 24) === 4) {
      const count = (w0 >>> 9) & 63;
      if (!count || count > 16 || (w0 & 0x1ff) + 1 !== count * 16) return null;
      const source = w1 - scene.base;
      if (!scene.contains(source, count * 16)) return null;
      loaded = Array.from({ length: count }, (_, i) => vertex(scene, source + i * 16));
    } else if (w0 === 0xbf000000 && ((w1 >>> 24) === 2 || (w1 >>> 24) === 0)) {
      const bytes = [(w1 >>> 16) & 255, (w1 >>> 8) & 255, w1 & 255];
      if (bytes.some((v) => v % 5 || v / 5 >= loaded.length) || !push(bytes.map((v) => v / 5), at)) return null;
    } else if (w0 === 0xb5000000) {
      const bytes = [(w1 >>> 24) & 255, (w1 >>> 16) & 255, (w1 >>> 8) & 255, w1 & 255];
      if (bytes.some((v) => v % 5 || v / 5 >= loaded.length)) return null;
      const q = bytes.map((v) => v / 5);
      if (!push([q[0], q[1], q[2]], at) || !push([q[0], q[2], q[3]], at)) return null;
    } else if (w0 !== 0xbe000000) return null;
  }
  if (!ended || !sources.length) return null;
  const material = scene.u32(record + 0x24) - scene.base;
  const hasMaterial = scene.contains(material, 12);
  const flags = hasMaterial ? scene.u32(material) : 0;
  const blend = textures.mode(texture);
  const batch: Batch = {
    texture, blend, depthTest: true, depthWrite: blend !== 'blend',
    cullBack: hasMaterial && !(flags & 0x10),
    positions: new Float32Array(positions), uvs: new Float32Array(uvs),
    colors: new Uint8Array(colors), triSource: new Uint32Array(sources),
  };
  let radius = 0;
  for (let i = 0; i < positions.length; i += 3) radius = Math.max(radius, Math.hypot(positions[i], positions[i + 1], positions[i + 2]));
  return { name: `mesh ${hex(record)}`, radius, batches: [batch],
    info: { record: hex(record), displayList: hex(commandStart), materialFlags: hex(flags) } };
}

function decodeIndexedCollision(scene: ShadowsSceneImage, record: number, pool: number): Mesh | null {
  const groups = scene.u16(record + 0x18), type = scene.u16(record + 0x1a);
  const indices = scene.u32(record + 0x20) - scene.base;
  const counts = scene.u32(record + 0x1c) - scene.base;
  if (!groups || groups > 10000 || ![3, 4, 5, 7].includes(type) ||
      !scene.u32(record + 0x20) || !scene.contains(indices, 2)) return null;
  if ((type === 5 || type === 7) && !scene.contains(counts, groups * 4)) return null;
  const positions: number[] = [], sources: number[] = [];
  let cursor = indices, radius = 0;
  const getVertex = (index: number): [number, number, number] | null => {
    const at = pool + index * 12;
    if (!scene.contains(at, 12)) return null;
    const x = scene.f32(at), y = scene.f32(at + 4), z = scene.f32(at + 8);
    if (![x, y, z].every(Number.isFinite)) return null;
    return [x, z, y];
  };
  for (let group = 0; group < groups; group++) {
    const n = type === 3 ? 3 : type === 4 ? 4 : scene.u32(counts + group * 4);
    if (n < 3 || n > 10000 || !scene.contains(cursor, n * 2)) return null;
    const vertices: [number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      const v = getVertex(scene.u16(cursor + i * 2));
      if (!v) return null;
      vertices.push(v);
    }
    // The intersection code alternates strip winding. Type-4's diagonal is
    // only an overlay visualization of its four-vertex geometric test.
    for (let i = 0; i < n - 2; i++) {
      const order = type === 4 ? [0, i + 1, i + 2]
        : i & 1 ? [i + 1, i, i + 2] : [i, i + 1, i + 2];
      for (const index of order) {
        const v = vertices[index];
        positions.push(...v);
        radius = Math.max(radius, Math.hypot(...v));
      }
      sources.push(cursor);
    }
    cursor += n * 2;
  }
  if (!sources.length) return null;
  const colors = new Uint8Array(sources.length * 3 * 4);
  for (let i = 0; i < colors.length; i += 4) colors.set([40, 220, 255, 110], i);
  return {
    name: `collision ${hex(record)}`, radius,
    info: { record: hex(record), type, groups, triangles: sources.length, vertexPool: hex(pool) },
    batches: [{ texture: -1, blend: 'blend', depthTest: true, depthWrite: false, cullBack: false, decal: true,
      positions: new Float32Array(positions), uvs: new Float32Array(positions.length / 3 * 2),
      colors, triSource: new Uint32Array(sources) }],
  };
}

export function shadowsGeometry(scene: ShadowsSceneImage, textures: ShadowsSceneTextures): Pick<Level, 'meshes' | 'instances' | 'layers' | 'unplaced' | 'bounds' | 'camera'> {
  const meshes: Level['meshes'] = [], instances: Level['instances'] = [];
  const bounds: Level['bounds'] = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const recordToMesh = new Map<number, number>();
  const recordToCollision = new Map<number, number>();
  // A mesh record consists of six ordered f32 bounds, one metadata word,
  // three scene pointers, and a display-list pointer at +0x28. Searching
  // pointer sites avoids treating every possible 0x2C stride as a root.
  for (let pointerSite = 0x28; pointerSite + 4 <= scene.bytes.length; pointerSite += 4) {
    const command = scene.u32(pointerSite) - scene.base;
    if ((command & 7) || !scene.contains(command, 8) || scene.u8(command) !== 4) continue;
    const record = pointerSite - 0x28;
    if (recordToMesh.has(record)) continue;
    const v = Array.from({ length: 6 }, (_, i) => scene.f32(record + i * 4));
    if (!v.every((n) => Number.isFinite(n) && Math.abs(n) < 1e6) ||
        v.some((n, i) => i < 3 && n > v[i + 3]) ||
        v.every((n, i) => i >= 3 || n === v[i + 3])) continue;
    if (![0x1c, 0x20, 0x24].every((o) => {
      const address = scene.u32(record + o);
      return address === 0 || scene.contains(address - scene.base, 4);
    })) continue;
    const mesh = decodeMesh(scene, textures, record, command);
    if (!mesh) continue;
    const meshIndex = meshes.length;
    meshes.push(mesh);
    recordToMesh.set(record, meshIndex);
  }

  const pool = scene.u32(0x44) - scene.base;

  const multiply = (a: Float32Array, b: Float32Array) => {
    const out = new Float32Array(16);
    for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++)
      for (let k = 0; k < 4; k++) out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
    return out;
  };
  const nodeMatrix = (at: number) => {
    const v = Array.from({ length: 12 }, (_, i) => scene.f32(at + 0x14 + i * 4));
    if (!v.every(Number.isFinite)) return null;
    // Node matrices store a row-major XYZ 3x3 followed by XYZ translation.
    // Conjugating by the Y/Z axis swap gives the viewer's Y-up transform.
    return new Float32Array([
      v[0], v[6], v[3], 0, v[2], v[8], v[5], 0,
      v[1], v[7], v[4], 0, v[9], v[11], v[10], 1,
    ]);
  };
  const instanceKeys = new Set<string>(), visited = new Set<string>();
  const extents: { center: [number, number, number]; size: number }[] = [];
  const mainInstances: number[] = [], collisionInstances: number[] = [];
  const append = (record: number, matrix: Float32Array) => {
    const mesh = recordToMesh.get(record);
    if (mesh === undefined) return;
    const key = `${record}/${matrix.join(',')}`;
    if (instanceKeys.has(key)) return;
    instanceKeys.add(key);
    mainInstances.push(instances.push({ name: meshes[mesh].name, mesh, matrix, info: { record: hex(record) } }) - 1);
    let collision = recordToCollision.get(record);
    if (collision === undefined && scene.contains(pool, 12)) {
      const decoded = decodeIndexedCollision(scene, record, pool);
      if (decoded) {
        collision = meshes.push(decoded) - 1;
        recordToCollision.set(record, collision);
      } else recordToCollision.set(record, -1);
    }
    if (collision !== undefined && collision >= 0) collisionInstances.push(instances.push({
      name: meshes[collision].name, mesh: collision, matrix: matrix.slice(), noFog: true,
      info: { record: hex(record), indexedCollision: 1 },
    }) - 1);
    const localMin = [Infinity, Infinity, Infinity], localMax = [-Infinity, -Infinity, -Infinity];
    for (let bits = 0; bits < 8; bits++) {
      const x = scene.f32(record + (bits & 1 ? 12 : 0));
      const y = scene.f32(record + (bits & 2 ? 16 : 4));
      const z = scene.f32(record + (bits & 4 ? 20 : 8));
      const p = [matrix[0] * x + matrix[4] * z + matrix[8] * y + matrix[12],
        matrix[1] * x + matrix[5] * z + matrix[9] * y + matrix[13],
        matrix[2] * x + matrix[6] * z + matrix[10] * y + matrix[14]];
      for (let axis = 0; axis < 3; axis++) {
        bounds.min[axis] = Math.min(bounds.min[axis], p[axis]);
        bounds.max[axis] = Math.max(bounds.max[axis], p[axis]);
        localMin[axis] = Math.min(localMin[axis], p[axis]);
        localMax[axis] = Math.max(localMax[axis], p[axis]);
      }
    }
    extents.push({
      center: [(localMin[0] + localMax[0]) / 2, (localMin[1] + localMax[1]) / 2, (localMin[2] + localMax[2]) / 2],
      size: Math.max(...localMax.map((n, i) => n - localMin[i])) / 2,
    });
  };

  // The +0x1C tagged root contains the main scene hierarchy. A 0x3064
  // node's count and pointer lead to mesh-record addresses. The other known
  // tags point to further nodes; D064/D065 additionally transform children.
  const root = scene.u32(0x1c) - scene.base;
  const stack: { at: number; matrix: Float32Array; depth: number }[] = [{ at: root, matrix: identity(), depth: 0 }];
  while (stack.length) {
    const { at, matrix, depth } = stack.pop()!;
    if (!scene.contains(at, 0x14) || depth > 64) continue;
    const tag = scene.u16(at);
    if (tag !== 0x3064 && tag !== 0x5064 && tag !== 0x5065 && tag !== 0xd064 && tag !== 0xd065) continue;
    const current = tag === 0xd064 || tag === 0xd065
      ? scene.contains(at, 0x48) && nodeMatrix(at) : identity();
    if (!current) continue;
    const nextMatrix = tag === 0xd064 || tag === 0xd065 ? multiply(matrix, current) : matrix;
    const key = `${at}/${nextMatrix.join(',')}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const count = scene.u32(at + 0xc), array = scene.u32(at + 0x10) - scene.base;
    if (count > 10000 || !scene.contains(array, count * 4)) continue;
    for (let i = 0; i < count; i++) {
      const child = scene.u32(array + i * 4) - scene.base;
      if (tag === 0x3064) append(child, nextMatrix);
      else stack.push({ at: child, matrix: nextMatrix, depth: depth + 1 });
    }
  }
  if (!instances.length) { bounds.min = [-1, -1, -1]; bounds.max = [1, 1, 1]; }
  const used = new Set(instances.map((instance) => instance.mesh));
  const unplaced = meshes.map((_, i) => i).filter((i) => !used.has(i));
  // Viewer convenience only: this is not an authored game camera. Excluding
  // the broadest 10% of placements keeps sky domes and huge ground grids from
  // forcing the initial view kilometres away from the actual scene detail.
  let camera: Level['camera'];
  if (extents.length) {
    const sample = extents.sort((a, b) => a.size - b.size).slice(0, Math.max(1, Math.ceil(extents.length * 0.9)));
    const quantile = (values: number[], fraction: number) => values.sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)];
    const axes = [0, 1, 2].map((axis) => {
      const values = sample.map((item) => item.center[axis]);
      return [quantile([...values], 0.25), quantile([...values], 0.5), quantile([...values], 0.75)];
    });
    const size75 = quantile(sample.map((item) => item.size), 0.75);
    const distance = Math.max(40, (axes[0][2] - axes[0][0]) / 2, (axes[2][2] - axes[2][0]) / 2, size75 * 5);
    const target: [number, number, number] = [axes[0][1], axes[1][1], axes[2][1]];
    camera = { eye: [target[0], target[1] + Math.max(10, distance / 4), target[2] + distance], target };
  }
  const layers: Level['layers'] = [{ name: 'scene meshes', kind: 'main', instances: mainInstances }];
  if (collisionInstances.length) layers.push({ name: 'indexed collision', kind: 'collision', instances: collisionInstances, visibleByDefault: false });
  return { meshes, instances, layers, unplaced, bounds, camera };
}
