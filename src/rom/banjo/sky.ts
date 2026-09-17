import type { Batch, Level, Texture } from '../types';

// D_8036BD40 in USA V1.0 core2 data (RAM 0x80363590). The zero-map record ends the table.
const SKY_TABLE_OFFSET = 0x87b0;
const SKY_RECORD_SIZE = 0x28;

export interface SkyLayer {
  model: number;
  scale: number;
  speed: number; // degrees per second about +Y
}

export interface SkyRecord {
  map: number;
  layers: SkyLayer[];
}

export function parseSkyTable(core2: Uint8Array): Map<number, SkyLayer[]> {
  const data = new DataView(core2.buffer, core2.byteOffset, core2.byteLength);
  const table = new Map<number, SkyLayer[]>();
  for (let off = SKY_TABLE_OFFSET; off + SKY_RECORD_SIZE <= core2.length; off += SKY_RECORD_SIZE) {
    const map = data.getInt16(off);
    if (map === 0) break;
    const layers: SkyLayer[] = [];
    for (let i = 0; i < 3; i++) {
      const at = off + 4 + i * 12;
      const model = data.getInt16(at);
      if (model !== 0) layers.push({ model, scale: data.getFloat32(at + 4), speed: data.getFloat32(at + 8) });
    }
    table.set(map, layers);
  }
  return table;
}

export function skyForMap(core2: Uint8Array, map: number): SkyRecord | null {
  const layers = parseSkyTable(core2).get(map);
  return layers ? { map, layers } : null;
}

export interface SkyBuildResult {
  layers: SkyLayer[];
  batches: number;
  triangles: number;
}

/**
 * Build the camera-centred, no-depth sky at animation time zero. `renderSkyModel`
 * must walk the model's geometry tree and display lists in draw order, using
 * the sky's default selectors and render state. It adds textures to `textures`.
 */
export function addBanjoSky<Model>(
  level: Level,
  map: number,
  core2: Uint8Array,
  loadModel: (assetId: number) => Model,
  renderSkyModel: (
    model: Model, scale: number, textures: Texture[], textureKeys: Map<string, number>, prefix: string,
  ) => Batch[],
): SkyBuildResult | null {
  level.clearColor = [0, 0, 0];
  const record = skyForMap(core2, map);
  if (!record?.layers.length) return null;

  const textureKeys = new Map<string, number>();
  const batches: Batch[] = [];
  for (const [i, layer] of record.layers.entries()) {
    batches.push(...renderSkyModel(
      loadModel(layer.model), layer.scale, level.textures, textureKeys,
      `sky${i}:0x${layer.model.toString(16)}:`,
    ));
  }
  if (!batches.length) return null;

  // The renderer's sky pass ignores camera translation and depth. Scaling every
  // position uniformly keeps unusually large sky models within its far plane.
  let radius = 0;
  let triangles = 0;
  for (const batch of batches) {
    triangles += batch.positions.length / 9;
    for (let i = 0; i < batch.positions.length; i += 3) {
      radius = Math.max(radius, Math.hypot(batch.positions[i], batch.positions[i + 1], batch.positions[i + 2]));
    }
  }
  const displayRadius = 1000;
  if (radius > 0) {
    const factor = displayRadius / radius;
    for (const batch of batches) {
      for (let i = 0; i < batch.positions.length; i++) batch.positions[i] *= factor;
    }
  }

  const name = `Sky (${record.layers.map((layer) => `0x${layer.model.toString(16)}`).join(' + ')})`;
  const mesh = level.meshes.push({
    name,
    radius: radius ? displayRadius : 0,
    batches,
    info: { map: `0x${map.toString(16)}`, skyTable: 'core2+0x87b0' },
  }) - 1;
  // `opaque` preserves each source batch's RDP blend/cutout mode. The renderer
  // draws the batches in this order, before map geometry, without depth/fog.
  level.skies = [{ name, mesh, opaque: true }];
  level.unplaced.push(mesh);
  return { layers: record.layers, batches: batches.length, triangles };
}
