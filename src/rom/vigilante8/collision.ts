import type { Level } from '../types';

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export interface Vigilante8TerrainChunk {
  data: number;
  end: number;
}

interface TerrainSample {
  height: number;
  source: number;
}

export function appendVigilante8Collision(
  bytes: Uint8Array,
  zmap: Vigilante8TerrainChunk | undefined,
  zones: Vigilante8TerrainChunk[],
  level: Level,
): void {
  if (!zmap || zmap.end - zmap.data !== 0x800 || !zones.length) return;

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Map<number, TerrainSample>();
  const key = (x: number, z: number) => x * 2048 + z;

  // ZMAP is 32 rows of 32 BE16 zone IDs. The runtime's first terrain
  // coordinate selects the column, and its second coordinate selects the row.
  // ZONE samples use the same order: first coordinate major, second minor.
  for (let zoneZ = 0; zoneZ < 32; zoneZ++) for (let zoneX = 0; zoneX < 32; zoneX++) {
    const zoneId = dv.getUint16(zmap.data + (zoneZ * 32 + zoneX) * 2);
    if (!zoneId) continue;
    const zone = zones[zoneId - 1];
    if (!zone || zone.end - zone.data !== 0x4000)
      throw new Error(`Invalid Vigilante 8 ZMAP zone ${zoneId}`);
    for (let localX = 0; localX < 64; localX++) for (let localZ = 0; localZ < 64; localZ++) {
      const source = zone.data + (localX * 64 + localZ) * 4;
      samples.set(key(zoneX * 64 + localX, zoneZ * 64 + localZ), {
        height: (dv.getUint16(source) & 0x7ff) / 32,
        source,
      });
    }
  }

  const positions: number[] = [], uvs: number[] = [], colors: number[] = [], triSource: number[] = [];
  let radius = 0;
  const vertex = (x: number, z: number, y: number) => {
    // XOBF display-list vertices are reflected on X for the viewer, so the
    // game's terrain coordinates use the same handedness conversion.
    positions.push(-x, y, z);
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

    // The runtime height query divides a cell at xFraction + zFraction = 1.
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
    info: { source: 'ZMAP/ZONE', zones: zones.length, triangles: triSource.length },
  }) - 1;
  const instance = level.instances.push({
    name: 'ZONE terrain collision', mesh, matrix: IDENTITY.slice(),
    info: { source: 'ZMAP/ZONE' },
  }) - 1;
  level.layers!.push({
    name: 'collision', kind: 'collision', instances: [instance], visibleByDefault: false,
  });
}
