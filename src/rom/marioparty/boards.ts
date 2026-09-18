// Mario Party (J) board maps: HVQ picture, camera, ROM-authored spaces and chain graph.
import type { Batch, Instance, Level, LevelInfo, LevelLayer, Marker, Mesh, Texture } from '../types';
import type { MarioPartyFs } from './fs';
import { decodeBackground } from './hvq';
import { buildFormParts, formLocalMatrix, parseForm } from './form';

interface BoardRecord { name: string; group: string; file: number; background: number; textureSet: number }
const BOARDS: BoardRecord[] = [
  { name: "DK's Jungle Adventure", group: 'Boards', file: 69, background: 0, textureSet: 0 },
  { name: "Peach's Birthday Cake", group: 'Boards', file: 70, background: 7, textureSet: 0 },
  { name: "Yoshi's Tropical Island", group: 'Boards', file: 71, background: 18, textureSet: 0 },
  { name: "Wario's Battle Canyon", group: 'Boards', file: 72, background: 27, textureSet: 0 },
  { name: "Luigi's Engine Room", group: 'Boards', file: 73, background: 39, textureSet: 0 },
  { name: "Mario's Rainbow Castle", group: 'Boards', file: 74, background: 47, textureSet: 0 },
  { name: "Bowser's Magma Mountain", group: 'Boards', file: 75, background: 56, textureSet: 0 },
  { name: 'Eternal Star', group: 'Boards', file: 76, background: 68, textureSet: 0 },
  { name: 'First Map (training)', group: 'Boards', file: 77, background: 77, textureSet: 0 },
  { name: 'Mini-Game Island', group: 'Mini-Game Island', file: 78, background: 79, textureSet: 2 },
  { name: 'Mini-Game Island area 1', group: 'Mini-Game Island', file: 79, background: 80, textureSet: 2 },
  { name: 'Mini-Game Island area 2', group: 'Mini-Game Island', file: 80, background: 81, textureSet: 2 },
  { name: 'Mini-Game Island area 3', group: 'Mini-Game Island', file: 81, background: 82, textureSet: 2 },
  { name: 'Mini-Game Island area 4', group: 'Mini-Game Island', file: 82, background: 83, textureSet: 2 },
  { name: 'Mini-Game Stadium', group: 'Mini-Game Stadium', file: 83, background: 99, textureSet: 0 },
];

// Explicit board-overlay model placements whose position is a named space. Most are
// event actors, so they are offered as an optional layer, not asserted to be present
// in the initial board state. Entries are [directory, file, space, scale].
type Prop = [number, number, number, number?];
const EVENT_PROPS: Prop[][] = [
  [[10,112,112], [10,117,93], [10,151,0,0.8]],
  [[10,117,58], [10,120,68], [10,158,69], [10,112,67]],
  [[10,117,55], [10,135,62,0.8], [10,185,61], [10,183,60]],
  [[10,112,67], [10,117,61]],
  [[10,112,72], [10,117,70]],
  [[10,212,3], [10,117,0], [10,104,2], [10,215,61]],
  [[10,112,65], [10,117,57], [10,135,64,0.6], [10,349,79]],
  [[10,112,2]],
  [[10,120,28], [10,117,25], [10,135,27,0.6], [10,112,26]],
  [[0,73,37,0.8], [10,246,33], [0,93,39], [9,6,39], [10,212,36]],
  [],
  [[10,135,0,0.6], [10,202,1,1.4]],
  [[0,73,0,1.2]],
  [],
  [[10,255,29], [10,117,45]],
];

export const marioPartyBoards: LevelInfo[] = BOARDS.map((b, index) => ({
  index, name: b.name, kind: index < 8 ? 'campaign' : index < 9 ? 'other' : index < 14 ? 'adventure' : 'bonus', group: b.group,
}));

interface Space { index: number; flags: number; type: number; position: [number, number, number] }
interface BoardData { spaces: Space[]; chains: number[][] }
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const romView = (rom: Uint8Array) => view(rom);
const ramToRom = (addr: number) => addr - 0x80000000 + 0xc00;

function boardData(bytes: Uint8Array): BoardData {
  const d = view(bytes), count = d.getUint16(0), chainsA = d.getUint16(2), chainsB = d.getUint16(4);
  const spacesAt = d.getUint16(6), chainAt = d.getUint16(10);
  if (chainsA !== 0 || spacesAt + count * 16 > bytes.length || chainAt + chainsB * 2 > bytes.length) {
    throw new Error('Invalid Mario Party board definition');
  }
  const spaces: Space[] = [];
  for (let i = 0; i < count; i++) {
    const at = spacesAt + 16 * i;
    spaces.push({ index: i, flags: d.getUint16(at), type: d.getUint16(at + 2) & 255,
      position: [d.getFloat32(at + 4) * 5, d.getFloat32(at + 8) * 5, d.getFloat32(at + 12) * 5] });
  }
  const chains: number[][] = [];
  for (let i = 0; i < chainsB; i++) {
    const at = chainAt + d.getUint16(chainAt + i * 2);
    if (at + 2 > bytes.length) throw new Error('Invalid Mario Party board chain offset');
    const length = d.getUint16(at);
    if (at + 2 + length * 2 > bytes.length) throw new Error('Invalid Mario Party board chain');
    const chain: number[] = [];
    for (let j = 0; j < length; j++) {
      const n = d.getUint16(at + 2 + j * 2);
      if (n >= count) throw new Error('Invalid Mario Party board space index');
      chain.push(n);
    }
    chains.push(chain);
  }
  return { spaces, chains };
}

function spaceTexture(fs: MarioPartyFs, id: number, type: number, set: number): Texture {
  const dir = id >>> 16, file = id & 0xffff, bytes = fs.getFile(dir, file), d = view(bytes);
  const format = d.getUint32(0), depth = d.getUint32(4), width = d.getUint32(8), height = d.getUint32(12);
  if (format !== 4 || depth !== 32 || !width || !height || 16 + width * height * 4 > bytes.length) {
    throw new Error(`Invalid Mario Party space texture ${dir}/${file}`);
  }
  return { width, height, rgba: bytes.slice(16, 16 + width * height * 4), wrapS: 'clamp', wrapT: 'clamp',
    format: 'RGBA32', source: `mainfs ${dir}/${file} (space type ${type}, set ${set})` };
}

function spaceMesh(rom: Uint8Array, type: number, scale: number, texture: number, width: number, height: number): Mesh {
  const d = romView(rom), base = ramToRom(0x800c47f0);
  const corners = Array.from({ length: 4 }, (_, i) => {
    const at = base + i * 16;
    return { p: [d.getInt16(at), d.getInt16(at + 2), d.getInt16(at + 4)],
      uv: [d.getInt16(at + 8) / (32 * width), d.getInt16(at + 10) / (32 * height)] };
  });
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [];
  for (const i of [0, 1, 2, 0, 2, 3]) {
    positions.push(...corners[i].p); uvs.push(...corners[i].uv); colors.push(255, 255, 255, 255);
  }
  return { name: `space type ${type}`, radius: 71 * scale, batches: [{ texture, blend: 'blend', depthTest: false,
    depthWrite: false, cullBack: true, positions: new Float32Array(positions), uvs: new Float32Array(uvs), colors: new Uint8Array(colors) }],
    info: { type, scale, renderMode: '0x504240' } };
}

function pathMesh(data: BoardData): Mesh | null {
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [];
  const seen = new Set<string>();
  for (const chain of data.chains) for (let i = 0; i + 1 < chain.length; i++) {
    const a = data.spaces[chain[i]].position, b = data.spaces[chain[i + 1]].position;
    const key = `${chain[i]}:${chain[i + 1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz);
    if (len < 1) continue;
    const nx = -dz / len * 6, nz = dx / len * 6;
    const q = [[a[0] - nx, a[1] + 2, a[2] - nz], [a[0] + nx, a[1] + 2, a[2] + nz],
      [b[0] + nx, b[1] + 2, b[2] + nz], [b[0] - nx, b[1] + 2, b[2] - nz]];
    for (const k of [0, 1, 2, 0, 2, 3]) { positions.push(...q[k]); uvs.push(0, 0); colors.push(255, 236, 116, 170); }
  }
  if (!positions.length) return null;
  const batch: Batch = { texture: -1, blend: 'blend', depthTest: false, depthWrite: false, cullBack: false,
    positions: new Float32Array(positions), uvs: new Float32Array(uvs), colors: new Uint8Array(colors) };
  return { name: 'board chain paths', radius: 0, batches: [batch],
    info: { note: 'Viewer overlay from board chain data; not drawn by the game. Cross-chain event links are not included.' } };
}

export function buildMarioPartyBoard(fs: MarioPartyFs, rom: Uint8Array, index: number): Level {
  const b = BOARDS[index];
  if (!b) throw new RangeError(`Mario Party board ${index} is absent`);
  const data = boardData(fs.getFile(10, b.file));
  const image = decodeBackground(rom, b.background);
  const d = romView(rom), set = b.textureSet;
  const table = ramToRom(0x800c4724 + set * 40), scaleTable = ramToRom(set === 2 ? 0x800c47c4 : 0x800c479c);
  const textures: Texture[] = [{ width: image.width, height: image.height, rgba: image.rgba,
    wrapS: 'clamp', wrapT: 'clamp', format: 'HVQ 2.0 RGBA5551', source: `HVQ background ${b.background}` }];
  const meshes: Mesh[] = [], instances: Instance[] = [], markers: Marker[] = [];
  const layers: LevelLayer[] = [
    { name: 'spaces', kind: 'objects', instances: [] },
    { name: 'course paths', kind: 'markers', instances: [] },
    { name: 'space labels', kind: 'markers', instances: [], visibleByDefault: false },
  ];
  const meshByType = new Map<number, number>(), scaleByType = new Map<number, number>();
  for (let type = 0; type < 10; type++) {
    const id = d.getUint32(table + type * 4);
    if (!id) continue;
    const scale = d.getFloat32(scaleTable + type * 4);
    const texture = textures.push(spaceTexture(fs, id, type, set)) - 1;
    meshByType.set(type, meshes.push(spaceMesh(rom, type, scale, texture, textures[texture].width, textures[texture].height)) - 1);
    scaleByType.set(type, scale);
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const space of data.spaces) {
    const p = space.position;
    for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p[a] - 80); max[a] = Math.max(max[a], p[a] + 80); }
    // The game changes star-candidate spaces to blue until a star is selected.
    const type = space.type === 5 ? 1 : space.type;
    const mesh = meshByType.get(type);
    const label = `space ${space.index}`;
    if (mesh !== undefined) {
      const k = scaleByType.get(type)!;
      const matrix = new Float32Array([k, 0, 0, 0, 0, 1, 0, 0, 0, 0, k, 0, p[0], p[1], p[2], 1]);
      layers[0].instances.push(instances.push({ name: label, mesh, matrix,
        info: { space: space.index, type: space.type, flags: `0x${space.flags.toString(16)}`, boardDef: `10/${b.file}` } }) - 1);
    }
    markers.push({ label: `${space.index} (${space.type})`, position: p, layer: 2,
      info: { space: space.index, type: space.type, flags: `0x${space.flags.toString(16)}` } });
  }
  const paths = pathMesh(data);
  if (paths) layers[1].instances.push(instances.push({ name: 'course paths', mesh: meshes.push(paths) - 1, matrix: identity() }) - 1);
  const propParts = EVENT_PROPS[index].map(([dir, file, space, scale = 1]) => {
    const position = data.spaces[space]?.position;
    if (!position) throw new Error(`Invalid event prop space ${space} on board ${index}`);
    return { form: parseForm(fs.getFile(dir, file)), name: `${dir}/${file} at space ${space}`,
      matrix: formLocalMatrix({ pos: position, rot: [0, 0, 0], scl: [scale, scale, scale] }), role: 'objects' as const };
  });
  if (propParts.length) {
    const built = buildFormParts(propParts);
    const textureBase = textures.length, meshBase = meshes.length, instanceBase = instances.length;
    textures.push(...built.textures);
    for (const mesh of built.meshes) meshes.push({ ...mesh, batches: mesh.batches.map((batch) => ({
      ...batch, texture: batch.texture < 0 ? -1 : batch.texture + textureBase,
    })) });
    const eventLayer = layers.push({ name: 'event props (possible states)', kind: 'objects', instances: [], visibleByDefault: false }) - 1;
    const collisionLayer = built.collisionInstances.length
      ? layers.push({ name: 'collision', kind: 'collision', instances: [], visibleByDefault: false }) - 1 : -1;
    for (let i = 0; i < built.instances.length; i++) {
      const instance = built.instances[i];
      const at = instanceBase + i;
      instances.push({ ...instance, mesh: instance.mesh + meshBase });
      layers[built.roles[i] === 'collision' ? collisionLayer : eventLayer].instances.push(at);
    }
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], built.bounds.min[a]); max[a] = Math.max(max[a], built.bounds.max[a]);
    }
  }
  const camera = image.camera;
  return { info: marioPartyBoards[index], id: `mp1j-board-${index}`, textures, meshes, instances, layers, markers,
    unplaced: [], pixelArt: true, backdrop: { texture: 0, u0: 0, v0: 0, u1: 1, v1: 1, aspect: image.width / image.height },
    camera: { eye: camera.eye.map((n) => n * 5) as [number, number, number],
      target: camera.lookAt.map((n) => n * 5) as [number, number, number], fovY: camera.fov },
    bounds: { min, max } };
}
