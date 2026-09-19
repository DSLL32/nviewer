import type { Level } from '../types';
import type { Vigilante8TerrainSurface } from './terrain';

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function appendVigilante8Collision(
  surface: Vigilante8TerrainSurface | undefined,
  level: Level,
): void {
  if (!surface) return;
  const { samples, key } = surface;

  const positions: number[] = [], uvs: number[] = [], colors: number[] = [], triSource: number[] = [];
  let radius = 0;
  const vertex = (x: number, z: number, y: number) => {
    // The game writes (X, height, Z) directly to terrain Vtx records and
    // authors structures above ground at negative Y. Reflect X/Y together
    // with XOBF geometry to obtain the viewer's Y-up frame.
    positions.push(-x, -y, z);
    uvs.push(0, 0);
    colors.push(64, 224, 255, 128);
    radius = Math.max(radius, Math.hypot(x, y, z));
  };
  for (const [packed, s00] of samples) {
    const x = Math.floor(packed / 2048), z = packed % 2048;
    const s10 = samples.get(key(x + 1, z));
    const s01 = samples.get(key(x, z + 1));
    const s11 = samples.get(key(x + 1, z + 1));
    if (!s10 || !s01 || !s11) continue;

    // The physical height query always divides the cell at
    // xFraction + zFraction = 1, independently of the visual material's
    // selectable terrain-rendering diagonal.
    vertex(x, z, s00.height); vertex(x + 1, z, s10.height); vertex(x, z + 1, s01.height);
    vertex(x + 1, z + 1, s11.height); vertex(x, z + 1, s01.height); vertex(x + 1, z, s10.height);
    triSource.push(s00.source, s00.source);
  }
  if (!positions.length) return;

  const mesh = level.meshes.push({
    name: 'ZONE terrain collision', radius,
    batches: [{
      texture: -1, blend: 'blend', depthTest: true, depthWrite: false, cullBack: false, decal: true,
      positions: new Float32Array(positions), uvs: new Float32Array(uvs), colors: new Uint8Array(colors),
      triSource: new Uint32Array(triSource),
    }],
    info: { source: 'ZMAP/ZONE', triangles: triSource.length },
  }) - 1;
  const instance = level.instances.push({
    name: 'ZONE terrain collision', mesh, matrix: IDENTITY.slice(),
    info: { source: 'ZMAP/ZONE' },
  }) - 1;
  level.layers!.push({
    name: 'collision', kind: 'collision', instances: [instance], visibleByDefault: false,
  });
}
