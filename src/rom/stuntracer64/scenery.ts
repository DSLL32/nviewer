import type { Level } from '../types';
import type { Material } from './material';
import { buildStuntMesh } from './geometry';

function u32(data: Uint8Array, at: number): number {
  if (at < 0 || at + 4 > data.length) throw new Error(`Stunt Racer map pointer out of bounds: 0x${at.toString(16)}`);
  return ((data[at] << 24) | (data[at + 1] << 16) | (data[at + 2] << 8) | data[at + 3]) >>> 0;
}

function rootMatrix(data: Uint8Array, at: number): Float32Array {
  if (at === 0 || at + 12 > data.length) throw new Error(`Stunt Racer scenery root out of bounds: 0x${at.toString(16)}`);
  const view = new DataView(data.buffer, data.byteOffset + at, 12);
  const x = view.getFloat32(0), y = view.getFloat32(4), z = view.getFloat32(8);
  if (![x, y, z].every(Number.isFinite)) throw new Error(`Stunt Racer scenery root has non-finite coordinates: 0x${at.toString(16)}`);
  // Source positions are local s16 coordinates; transform translations are in
  // units of 32 source coordinates. Both use the viewer's (-x,z,y) frame.
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    -x * 32, z * 32, y * 32, 1,
  ]);
}

/** Add map-resident static scenery and the camera-relative source skydome. */
export function appendSceneryAndSky(primary: Uint8Array, materials: Material[], level: Level): void {
  const skyMeta = u32(primary, 0x0c);
  if (skyMeta !== 0) {
    const mesh = level.meshes.push(buildStuntMesh(primary, skyMeta, materials, 'Skydome')) - 1;
    level.skies = [...(level.skies ?? []), { name: 'Skydome', kind: 'mesh', mesh, opaque: true }];
  }

  const records = u32(primary, 0x324), count = u32(primary, 0x328);
  if (count > 0x1000 || records > primary.length || count * 0x28 > primary.length - records) {
    throw new Error(`Stunt Racer scenery table out of bounds: 0x${records.toString(16)} × ${count}`);
  }
  const instanceIndices: number[] = [];
  for (let i = 0; i < count; i++) {
    const at = records + i * 0x28;
    const meta = u32(primary, at), root = u32(primary, at + 0x10);
    const name = `Scenery ${i + 1}`;
    const mesh = level.meshes.push(buildStuntMesh(primary, meta, materials, name)) - 1;
    const instance = level.instances.push({
      name, mesh, matrix: rootMatrix(primary, root),
      info: { source: `primary map scenery[${i}]`, geometryOffset: meta, transformOffset: root,
        limitation: 'static root pose; child transforms and animation are not reconstructed' },
    }) - 1;
    instanceIndices.push(instance);
  }
  if (instanceIndices.length) {
    (level.layers ??= []).push({ name: 'scenery', kind: 'objects', instances: instanceIndices });
  }
}
