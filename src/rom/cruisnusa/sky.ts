import type { Batch, Mesh, MeshSky, Texture } from '../types';

// The course initializer loads catalog ID 0x0546 as a 680×108 RGBA5551
// panorama. Its exact screen-space sampling is not yet established; a
// camera-centred cylinder preserves the image and its horizontal wrap.
export function addCruisnSky(data: Uint8Array, textures: Texture[], meshes: Mesh[]): MeshSky[] {
  const width = 680, height = 108;
  if (data.byteLength !== width * height * 2) throw new Error('invalid Cruis\'n USA sky panorama');
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const pixel = (data[2 * i] << 8) | data[2 * i + 1];
    rgba[4 * i] = ((pixel >>> 11) & 31) * 255 / 31;
    rgba[4 * i + 1] = ((pixel >>> 6) & 31) * 255 / 31;
    rgba[4 * i + 2] = ((pixel >>> 1) & 31) * 255 / 31;
    rgba[4 * i + 3] = pixel & 1 ? 255 : 0;
  }
  const texture = textures.push({ width, height, rgba, wrapS: 'repeat', wrapT: 'clamp',
    format: 'RGBA16', source: 'catalog asset 0x0546' }) - 1;
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [];
  const segments = 64, radius = 10000;
  for (let i = 0; i < segments; i++) {
    const ring = (u: number, v: number): [number, number, number] => {
      const yaw = u * Math.PI * 2;
      return [Math.sin(yaw) * radius, (0.5 - v) * radius, -Math.cos(yaw) * radius];
    };
    const a = i / segments, b = (i + 1) / segments;
    for (const [u, v] of [[a, 0], [a, 1], [b, 1], [a, 0], [b, 1], [b, 0]]) {
      positions.push(...ring(u, v)); uvs.push(u, v); colors.push(255, 255, 255, 255);
    }
  }
  const batch: Batch = { texture, blend: 'opaque', depthTest: false, depthWrite: false, cullBack: false,
    positions: new Float32Array(positions), uvs: new Float32Array(uvs), colors: new Uint8Array(colors) };
  const mesh = meshes.push({ name: 'cloud panorama', radius, batches: [batch],
    info: { assetID: '0x0546', projection: 'camera-centred cylinder; exact game mapping unknown' } }) - 1;
  return [{ name: 'Cloud panorama', kind: 'mesh', mesh, opaque: true }];
}
