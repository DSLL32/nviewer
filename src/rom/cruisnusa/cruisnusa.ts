import type { Game, Instance, Level, LevelInfo, Marker, Mesh, Texture } from '../types';
import { emptyBounds } from '../util';
import { decodeCruisnMesh, decodeCruisnTexture, readCruisnTextureInfo, type CruisnMaterial } from './assets';
import { parseCatalog, type CruisnCatalog } from './catalog';
import { decodeCruisnUsaMusic, listCruisnUsaMusic } from './music';
import { CRUISN_COURSES, parseCourse, type CruisnPlacement, type CruisnScene } from './scene';
import { addCruisnSky } from './sky';

// Course-section initialization uses 0.2 for path displacements. The mesh
// culling routine also scales local X/Z by 0.2; the viewer applies it to the
// complete local mesh while the exact graphics-matrix path is investigated.
const SCALE = 0.2;
const TWO_PI = Math.PI * 2;
const LEVELS: LevelInfo[] = CRUISN_COURSES.map((name, index) => ({ index, name, kind: 'race' }));
const hex = (n: number) => `0x${(n >>> 0).toString(16)}`;

interface PathFrame { x: number; y: number; z: number; angle: number }

// The section builder accumulates -yaw in 16-bit binary turns, and stores
// planar rotation [cos,sin;-sin,cos]. Its X/Z displacement is root XYZ×0.2.
function advance(frame: PathFrame, p: CruisnPlacement, grade: number): PathFrame {
  const c = Math.cos(frame.angle), s = Math.sin(frame.angle);
  return { x: frame.x + SCALE * (c * p.x + s * p.z),
    y: frame.y + SCALE * (p.y + (p.x || p.z ? grade : 0)),
    z: frame.z + SCALE * (-s * p.x + c * p.z),
    angle: frame.angle - (p.yaw & 0xffff) * TWO_PI / 0x10000 };
}

function sectionGrades(catalog: CruisnCatalog, course: number, count: number): number[] {
  const rom = catalog.rom, view = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
  const pointer = view.getUint32(0x32b5c + course * 4);
  const at = pointer - 0x800ff000;
  if (at < 0 || at + 4 > rom.length) throw new Error(`invalid Cruis'n USA grade table for course ${course}`);
  const grades = new Array<number>(count);
  let record = 0, grade = 0;
  for (let i = 0; i < count; i++) {
    while (at + record * 4 + 4 <= rom.length && view.getUint16(at + record * 4) <= i) {
      grade = view.getInt16(at + record * 4 + 2);
      record++;
    }
    grades[i] = grade;
  }
  return grades;
}

function placementMatrix(frame: PathFrame, p: CruisnPlacement): Float32Array {
  const c = Math.cos(frame.angle), s = Math.sin(frame.angle);
  const x = frame.x + c * p.x / 65536 + s * p.z / 65536;
  const y = frame.y + p.y / 65536;
  const z = frame.z - s * p.x / 65536 + c * p.z / 65536;
  const angle = frame.angle - (p.yaw & 0xffff) * TWO_PI / 0x10000;
  const a = Math.cos(angle) * SCALE, b = Math.sin(angle) * SCALE;
  return new Float32Array([a, 0, -b, 0, 0, SCALE, 0, 0, b, 0, a, 0, x, y, z, 1]);
}

function meshBounds(mesh: Mesh): Level['bounds'] {
  const bounds = emptyBounds();
  for (const batch of mesh.batches) for (let i = 0; i < batch.positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      bounds.min[axis] = Math.min(bounds.min[axis], batch.positions[i + axis]);
      bounds.max[axis] = Math.max(bounds.max[axis], batch.positions[i + axis]);
    }
  }
  return bounds;
}

function includeBounds(bounds: Level['bounds'], local: Level['bounds'], matrix: Float32Array): void {
  if (!Number.isFinite(local.min[0])) return;
  for (let bits = 0; bits < 8; bits++) {
    const x = bits & 1 ? local.max[0] : local.min[0];
    const y = bits & 2 ? local.max[1] : local.min[1];
    const z = bits & 4 ? local.max[2] : local.min[2];
    const p = [matrix[0] * x + matrix[8] * z + matrix[12], matrix[5] * y + matrix[13],
      matrix[2] * x + matrix[10] * z + matrix[14]];
    for (let axis = 0; axis < 3; axis++) {
      bounds.min[axis] = Math.min(bounds.min[axis], p[axis]);
      bounds.max[axis] = Math.max(bounds.max[axis], p[axis]);
    }
  }
}

function loadCourse(catalog: CruisnCatalog, index: number): Level {
  const root = parseCourse(catalog, index);
  const meshes: Mesh[] = [], textures: Texture[] = [], instances: Instance[] = [];
  const bounds = emptyBounds();
  const meshMap = new Map<number, number>(), textureMap = new Map<number, number>();
  const textureCutout = new Map<number, boolean>();
  const meshBoxes = new Map<number, Level['bounds']>();
  const material = (assetID: number, flags: number): CruisnMaterial => {
    if ((flags & 4) !== 0) return { texture: -1, blend: 'opaque', depthTest: true, depthWrite: true,
      cullBack: false, uvScaleS: 0, uvScaleT: 0 };
    let texture = textureMap.get(assetID);
    if (texture === undefined) {
      const data = catalog.asset(assetID), info = readCruisnTextureInfo(data);
      const palette = info.mode === 1 ? catalog.asset(info.paletteAssetID) : undefined;
      const decoded = decodeCruisnTexture(data, palette);
      decoded.source = `catalog asset ${hex(assetID)}` + (info.paletteAssetID ? `, palette ${hex(info.paletteAssetID)}` : '');
      texture = textures.push(decoded) - 1;
      textureMap.set(assetID, texture);
      textureCutout.set(assetID, decoded.rgba.some((value, i) => i % 4 === 3 && value < 255));
    }
    const tex = textures[texture];
    return { texture, blend: textureCutout.get(assetID) ? 'cutout' : 'opaque', depthTest: true, depthWrite: true,
      cullBack: false, uvScaleS: 1 / (32 * tex.width), uvScaleT: 1 / (32 * tex.height) };
  };
  const getMesh = (assetID: number): number => {
    const known = meshMap.get(assetID);
    if (known !== undefined) return known;
    const mesh = decodeCruisnMesh(catalog.asset(assetID), material, `mesh ${hex(assetID)}`);
    mesh.info = { ...mesh.info, assetID: hex(assetID), romOffset: hex(catalog.entry(assetID).storedOffset) };
    const i = meshes.push(mesh) - 1;
    meshMap.set(assetID, i);
    meshBoxes.set(i, meshBounds(mesh));
    return i;
  };
  const path: Marker[] = [];
  const grades = sectionGrades(catalog, index, root.placements.length);
  const drawScene = (scene: CruisnScene, frame: PathFrame, rootSection: number, depth: number): void => {
    if (depth > 8) throw new Error(`Cruis'n USA scene nesting too deep at ${hex(scene.assetID)}`);
    for (let pi = 0; pi < scene.placements.length; pi++) {
      const p = scene.placements[pi];
      if (p.flags & 1) continue;
      if (p.child.scene) {
        // Nested scenes are placed in the current course section. Their own
        // placement coordinates pass through a signed-16-bit fixed-matrix
        // conversion before the game's 0.2 world scale.
        const c = Math.cos(frame.angle), s = Math.sin(frame.angle);
        const px = (p.x << 16) >> 16, py = (p.y << 16) >> 16, pz = (p.z << 16) >> 16;
        drawScene(p.child.scene, { x: frame.x + SCALE * (c * px + s * pz),
          y: frame.y + SCALE * py,
          z: frame.z + SCALE * (-s * px + c * pz),
          angle: frame.angle - (p.yaw & 0xffff) * TWO_PI / 0x10000 }, rootSection, depth + 1);
        continue;
      }
      const mesh = getMesh(p.child.assetID), matrix = placementMatrix(frame, p);
      const instance: Instance = { name: `section ${rootSection} mesh ${hex(p.child.assetID)}`,
        mesh, matrix,
        ...(p.drawFlags & 0x8000 ? { billboard: 'y' as const } : {}),
        info: { section: rootSection, scene: hex(scene.assetID), placement: pi,
          assetID: hex(p.child.assetID), drawFlags: hex(p.drawFlags) } };
      includeBounds(bounds, meshBoxes.get(mesh)!, matrix);
      instances.push(instance);
    }
  };
  let frame: PathFrame = { x: 0, y: 0, z: 0, angle: 0 };
  for (let section = 0; section < root.placements.length; section++) {
    const p = root.placements[section];
    if (!(p.flags & 1)) {
      path.push({ label: `Section ${section}`, position: [frame.x, frame.y, frame.z], layer: 1,
        info: { section, rootPlacement: hex(root.placementListID),
          advance: `(${p.x}, ${p.y}, ${p.z})`, yaw: hex(p.yaw) } });
      if (p.child.scene) drawScene(p.child.scene, frame, section, 1);
    }
    frame = advance(frame, p, grades[section]);
  }
  const sky = addCruisnSky(catalog.asset(0x0546), textures, meshes);
  const skyIndex = sky[0].mesh;
  if (!Number.isFinite(bounds.min[0])) {
    bounds.min = [-1, -1, -1]; bounds.max = [1, 1, 1];
  }
  const start = path[0]?.position ?? [0, 0, 0];
  const next = path.find((p) => Math.hypot(p.position[0] - start[0], p.position[2] - start[2]) > 1)?.position;
  const length = next ? Math.hypot(next[0] - start[0], next[2] - start[2]) : 1;
  const forward: [number, number] = next ? [(next[0] - start[0]) / length, (next[2] - start[2]) / length] : [0, -1];
  return { id: `cruisnusa-${index}`, info: LEVELS[index], meshes, textures, instances,
    layers: [
      { name: 'Course geometry', kind: 'main', instances: instances.map((_, i) => i) },
      { name: 'Course sections', kind: 'markers', instances: [], visibleByDefault: false },
    ],
    markers: path, skies: sky, unplaced: [skyIndex], bounds,
    camera: { eye: [start[0] - forward[0] * 700, start[1] + 300, start[2] - forward[1] * 700],
      target: [start[0] + forward[0] * 1500, start[1], start[2] + forward[1] * 1500], fovY: 55 },
    clearColor: [134, 174, 220] };
}

export function openCruisnUsa(rom: Uint8Array): Game {
  const catalog = parseCatalog(rom);
  const music = listCruisnUsaMusic(rom);
  return { id: 'cruisnusa', title: "Cruis'n USA (U 1.0)", levels: LEVELS,
    loadLevel: (index) => loadCourse(catalog, index), music,
    decodeMusic: (index) => decodeCruisnUsaMusic(rom, index) };
}
