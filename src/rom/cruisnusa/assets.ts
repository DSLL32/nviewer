import type { Batch, BlendMode, Mesh, Texture } from '../types';

const u16 = (data: Uint8Array, at: number): number => (data[at] << 8) | data[at + 1];
const s16 = (data: Uint8Array, at: number): number => (u16(data, at) << 16) >> 16;
const u32 = (data: Uint8Array, at: number): number =>
  ((data[at] << 24) | (data[at + 1] << 16) | (data[at + 2] << 8) | data[at + 3]) >>> 0;

function requireBytes(data: Uint8Array, at: number, count: number, context: string): void {
  if (at < 0 || count < 0 || at + count > data.length)
    throw new Error(`Cruis'n USA ${context} exceeds asset (${at}+${count} > ${data.length})`);
}

function rgba5551(value: number, dst: Uint8Array, at: number): void {
  dst[at] = Math.round(((value >>> 11) & 31) * 255 / 31);
  dst[at + 1] = Math.round(((value >>> 6) & 31) * 255 / 31);
  dst[at + 2] = Math.round(((value >>> 1) & 31) * 255 / 31);
  dst[at + 3] = (value & 1) ? 255 : 0;
}

export interface CruisnTextureInfo {
  width: number;
  height: number;
  mode: number;
  paletteAssetID: number;
}

export function readCruisnTextureInfo(data: Uint8Array): CruisnTextureInfo {
  requireBytes(data, 0, 8, 'texture header');
  const width = data[0] * 2, height = data[1] * 2;
  const mode = u16(data, 2), paletteAssetID = u32(data, 4);
  if (!width || !height || (mode !== 0 && mode !== 1))
    throw new Error(`Cruis'n USA invalid texture ${width}×${height}, mode ${mode}`);
  requireBytes(data, 8, width * height * (mode === 0 ? 2 : 1), 'texture pixels');
  if (data.length !== 8 + width * height * (mode === 0 ? 2 : 1))
    throw new Error(`Cruis'n USA texture has ${data.length - 8} pixels bytes, expected ${width * height * (mode === 0 ? 2 : 1)}`);
  return { width, height, mode, paletteAssetID };
}

/** Decode one class-0x40 image. Multi-palette files require an explicit paletteIndex when not using palette zero. */
export function decodeCruisnTexture(data: Uint8Array, paletteData?: Uint8Array, paletteIndex = 0): Texture {
  const { width, height, mode, paletteAssetID } = readCruisnTextureInfo(data);
  const rgba = new Uint8Array(width * height * 4);
  if (mode === 0) {
    if (paletteAssetID !== 0) throw new Error(`Cruis'n USA direct texture references palette ${paletteAssetID}`);
    for (let i = 0; i < width * height; i++) rgba5551(u16(data, 8 + i * 2), rgba, i * 4);
  } else {
    if (!paletteData) throw new Error(`Cruis'n USA CI8 texture needs palette asset ${paletteAssetID}`);
    requireBytes(paletteData, 0, 8, 'palette header');
    const marker = u32(paletteData, 0), count = u32(paletteData, 4);
    if (marker !== 1 || count < 1 || paletteData.length !== 8 + count * 512)
      throw new Error(`Cruis'n USA invalid palette asset (marker ${marker}, count ${count})`);
    if (!Number.isInteger(paletteIndex) || paletteIndex < 0 || paletteIndex >= count)
      throw new Error(`Cruis'n USA palette index ${paletteIndex} outside 0..${count - 1}`);
    const base = 8 + paletteIndex * 512;
    for (let i = 0; i < width * height; i++) rgba5551(u16(paletteData, base + data[8 + i] * 2), rgba, i * 4);
  }
  return { width, height, rgba, wrapS: 'repeat', wrapT: 'repeat',
    format: mode === 0 ? 'RGBA5551' : `CI8/RGBA5551 palette ${paletteIndex}` };
}

/** The caller supplies render state and ST scaling. Stored ST is signed 10.5 fixed,
 * so normalized UV scales are 1 / (32 * texture width/height). */
export interface CruisnMaterial {
  texture: number;
  blend: BlendMode;
  depthTest: boolean;
  depthWrite: boolean;
  cullBack: boolean;
  uvScaleS: number;
  uvScaleT: number;
  uvOffsetS?: number;
  uvOffsetT?: number;
  color?: readonly [number, number, number, number];
}

/** Decode the exact class-0x10/0x20 mesh grammar; positions remain in stored coordinate units. */
export function decodeCruisnMesh(data: Uint8Array,
                                 resolveMaterial: (assetID: number, flags: number) => CruisnMaterial,
                                 name: string): Mesh {
  requireBytes(data, 0, 18, 'mesh header');
  const positionCount = data[0] + 1, secondaryCount = data[1] + 1;
  const primitiveUnits = u16(data, 2);
  const positionAt = 4, secondaryAt = positionAt + positionCount * 6;
  const metadataAt = secondaryAt + secondaryCount * 4;
  requireBytes(data, metadataAt, 4, 'mesh arrays');
  const batches: Batch[] = [];
  let at = metadataAt + 4, units = 0, radius = 0;
  while (units < primitiveUnits) {
    requireBytes(data, at, 6, 'material batch');
    const shifted = (at & 2) !== 0;
    const materialAssetID = u32(data, at + (shifted ? 2 : 0));
    const triangleCount = data[at + (shifted ? 0 : 4)];
    const flags = data[at + (shifted ? 1 : 5)];
    if (units + triangleCount + 1 > primitiveUnits)
      throw new Error(`Cruis'n USA batch exceeds primitive count at ${at}`);
    requireBytes(data, at + 6, triangleCount * 6, 'triangles');
    const material = resolveMaterial(materialAssetID, flags);
    const positions = new Float32Array(triangleCount * 9);
    const uvs = new Float32Array(triangleCount * 6);
    const colors = new Uint8Array(triangleCount * 12);
    const triSource = new Uint32Array(triangleCount);
    const color = material.color ?? [255, 255, 255, 255];
    for (let t = 0; t < triangleCount; t++) {
      const triangleAt = at + 6 + t * 6;
      triSource[t] = triangleAt;
      for (let c = 0; c < 3; c++) {
        const pi = data[triangleAt + c], si = data[triangleAt + 3 + c];
        if (pi >= positionCount || si >= secondaryCount)
          throw new Error(`Cruis'n USA triangle index outside mesh arrays at ${triangleAt}`);
        const p = positionAt + pi * 6, s = secondaryAt + si * 4;
        const x = s16(data, p), y = s16(data, p + 2), z = s16(data, p + 4);
        const vertex = t * 3 + c;
        positions.set([x, y, z], vertex * 3);
        uvs[vertex * 2] = s16(data, s) * material.uvScaleS + (material.uvOffsetS ?? 0);
        uvs[vertex * 2 + 1] = s16(data, s + 2) * material.uvScaleT + (material.uvOffsetT ?? 0);
        colors.set(color, vertex * 4);
        radius = Math.max(radius, Math.hypot(x, y, z));
      }
    }
    batches.push({ texture: material.texture, blend: material.blend,
      depthTest: material.depthTest, depthWrite: material.depthWrite, cullBack: material.cullBack,
      positions, uvs, colors, triSource });
    at += 6 * (triangleCount + 1);
    units += triangleCount + 1;
  }
  if (at !== data.length)
    throw new Error(`Cruis'n USA mesh has ${data.length - at} trailing bytes`);
  return { name, radius, batches, info: { positionCount, secondaryCount,
    primitiveUnits, metadata0: s16(data, metadataAt), metadata1: s16(data, metadataAt + 2),
    triSource: 'triangle byte offset within mesh asset' } };
}
