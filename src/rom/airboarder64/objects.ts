import type { Instance, LevelLayer, Mesh, Texture } from '../types';
import type { AirBoarderRom } from './archive';

export type PlacementKind = 'free' | 'street' | 'time' | 'coin';
export interface PlacementPreset { kind: PlacementKind; setup: number; name: string }

const A_BASE_J = [0, 0x92458, 0x94568, 0x9aef4, 0xa119c, 0xa38e8];
const B_BASE_J = [0, 0x9281c, 0x95110, 0x9bde8, 0xa1fd0, 0xa4698];
const OVERLAY_J = [0x8b7f0, 0x8d230, 0x92b90, 0x95190, 0x9bfd0, 0xa2130];
const OVERLAY_RAM_J = 0x80127120;
const IDENTITY = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const hex = (n: number) => `0x${(n >>> 0).toString(16)}`;

function rgba5551(data: Uint8Array, texels: Uint8Array, palette: number): Uint8Array {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength), rgba = new Uint8Array(texels.length * 4);
  const five = (v: number) => (v << 3) | (v >>> 2);
  for (let i = 0; i < texels.length; i++) {
    const c = dv.getUint16(palette + texels[i] * 2), o = i * 4;
    rgba[o] = five((c >>> 11) & 31); rgba[o + 1] = five((c >>> 6) & 31); rgba[o + 2] = five((c >>> 1) & 31); rgba[o + 3] = c & 1 ? 255 : 0;
  }
  return rgba;
}

function markerMesh(rom: AirBoarderRom): Mesh {
  const at = 0x89710 + rom.version.overlayDelta, dv = new DataView(rom.rom.buffer, rom.rom.byteOffset, rom.rom.byteLength);
  const vertices: [number, number, number][] = [];
  for (let i = 0; i < 19; i++) vertices.push([dv.getInt16(at + i * 16), dv.getInt16(at + i * 16 + 2), dv.getInt16(at + i * 16 + 4)]);
  const positions: number[] = [], colors: number[] = [];
  for (let i = 0; i < 18; i++) for (const k of [i, (i + 1) % 18, 18]) {
    positions.push(...vertices[k]); colors.push(255, 224, 64, 255);
  }
  return { name: 'course marker disk', radius: 50, batches: [{
    texture: -1, blend: 'opaque', depthTest: true, depthWrite: true, cullBack: false,
    positions: new Float32Array(positions), uvs: new Float32Array(36 * 3), colors: new Uint8Array(colors),
  }], info: { vertices: 19, source: `ROM ${hex(at)}`, modelDisplayList: `ROM ${hex(0x89890 + rom.version.overlayDelta)}` } };
}

function coinAssets(rom: AirBoarderRom, textures: Texture[]): Mesh[] {
  const sharedId = rom.version.code === 'NABJ' ? 68 : 69, data = rom.file(sharedId);
  if (data.length < 0x8c70) throw new Error('Air Boarder shared course archive is too short for coin art');
  // The game cycles all nine frames. The viewer contract has no material-animation
  // clock, so retain all frames in the texture table and render the first one.
  const firstTexture = textures.length;
  for (let frame = 0; frame < 9; frame++) textures.push({
    width: 24, height: 24,
    rgba: rgba5551(data, data.subarray(0x7830 + frame * 0x240, 0x7a70 + frame * 0x240), 0x7630),
    wrapS: 'clamp', wrapT: 'clamp', format: 'CI8/RGBA16',
    source: `archive ${sharedId} + 0x${(0x7830 + frame * 0x240).toString(16)}, TLUT +0x7630, animation frame ${frame}`,
  });
  const sourceAt = 0x898f0 + rom.version.overlayDelta;
  const dv = new DataView(rom.rom.buffer, rom.rom.byteOffset, rom.rom.byteLength);
  return [0, 1].map((variant): Mesh => {
    const at = sourceAt + variant * 0x40, verts: { p: number[]; uv: number[]; c: number[] }[] = [];
    for (let i = 0; i < 4; i++) {
      const p = at + i * 16;
      verts.push({ p: [dv.getInt16(p), dv.getInt16(p + 2), dv.getInt16(p + 4)], uv: [dv.getInt16(p + 8) / 1472, dv.getInt16(p + 10) / 1472], c: [...rom.rom.subarray(p + 12, p + 16)] });
    }
    const positions: number[] = [], uvs: number[] = [], colors: number[] = [];
    for (const k of [0, 1, 2, 0, 2, 3]) { positions.push(...verts[k].p); uvs.push(...verts[k].uv); colors.push(...verts[k].c); }
    return { name: variant ? 'red star coin' : 'yellow star coin', radius: Math.sqrt(50), batches: [{
      texture: firstTexture, blend: 'cutout', depthTest: true, depthWrite: true, cullBack: false,
      positions: new Float32Array(positions), uvs: new Float32Array(uvs), colors: new Uint8Array(colors),
    }], info: { variant, source: `ROM ${hex(at)}`, textureArchive: sharedId, animationFrames: 9 } };
  });
}

function rotationMatrix(position: [number, number, number], axDegrees: number, ayDegrees: number, scale: number): Float32Array {
  const x = axDegrees * Math.PI / 180, y = ayDegrees * Math.PI / 180;
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y);
  // guRotateRPYF(ax, ay, 0), followed by guScaleF(scale, scale, 1).
  return new Float32Array([
    cy * scale, sx * sy * scale, -cx * sy * scale, 0,
    0, cx * scale, sx * scale, 0,
    sy, -sx * cy, cx * cy, 0,
    position[0], position[1], position[2], 1,
  ]);
}

function recordVrom(rom: AirBoarderRom, course: number, pointer: number): number {
  const ram = OVERLAY_RAM_J - (rom.version.code === 'NABP' ? 0x3de0 : 0);
  const at = OVERLAY_J[course] + rom.version.overlayDelta + ((pointer >>> 0) - ram);
  if (at < 0 || at >= rom.rom.length) throw new Error(`Air Boarder placement pointer ${hex(pointer)} is outside course overlay ${course}`);
  return at;
}

export function addPlacementObjects(
  rom: AirBoarderRom, course: number, preset: PlacementPreset, textures: Texture[], meshes: Mesh[], instances: Instance[], layers: LevelLayer[],
): void {
  if (course === 0 || preset.kind === 'free') return;
  const dv = new DataView(rom.rom.buffer, rom.rom.byteOffset, rom.rom.byteLength), delta = rom.version.overlayDelta;
  if (preset.kind === 'coin') {
    const descriptor = B_BASE_J[course] + delta + preset.setup * 8;
    const count = dv.getInt16(descriptor), pointer = dv.getUint32(descriptor + 4), first = recordVrom(rom, course, pointer);
    if (count < 0 || count > 1000 || first + count * 10 > rom.rom.length) throw new Error(`invalid Air Boarder coin descriptor at ${hex(descriptor)}`);
    const coinMeshes = coinAssets(rom, textures), meshBase = meshes.length; meshes.push(...coinMeshes);
    const placed: number[] = [];
    for (let i = 0; i < count; i++) {
      const at = first + i * 10, variant = dv.getInt16(at + 2);
      if (variant < 0 || variant > 1) throw new Error(`invalid Air Boarder coin variant ${variant} at ${hex(at)}`);
      const position: [number, number, number] = [dv.getInt16(at + 4), dv.getInt16(at + 6), dv.getInt16(at + 8)];
      placed.push(instances.push({ name: `${variant ? 'red' : 'yellow'} star coin ${i + 1}`, mesh: meshBase + variant, matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...position, 1]), animated: true,
        info: { course, mode: 'Coin', setup: preset.setup, record: `ROM ${hex(at)}`, variant, billboard: 'game uses a camera-facing matrix; viewer currently uses identity orientation' } }) - 1);
    }
    layers.push({ name: 'coins', kind: 'objects', instances: placed });
    return;
  }
  const familyIndex = preset.kind === 'street' ? preset.setup : 3 + preset.setup;
  const descriptor = A_BASE_J[course] + delta + familyIndex * 8;
  const count = dv.getInt16(descriptor), pointer = dv.getUint32(descriptor + 4), first = recordVrom(rom, course, pointer);
  if (count < 0 || count > 100 || first + count * 24 > rom.rom.length) throw new Error(`invalid Air Boarder marker descriptor at ${hex(descriptor)}`);
  const mesh = meshes.push(markerMesh(rom)) - 1, placed: number[] = [];
  for (let i = 0; i < count; i++) {
    const at = first + i * 24;
    const position: [number, number, number] = [dv.getInt16(at + 4), dv.getInt16(at + 6), dv.getInt16(at + 8)];
    const scaleNumerator = dv.getInt16(at + 10), angleA = dv.getFloat32(at + 16), angleB = dv.getFloat32(at + 20);
    placed.push(instances.push({ name: `${preset.kind === 'street' ? 'Street Work' : 'Time Attack'} marker ${i + 1}`, mesh,
      matrix: rotationMatrix(position, angleA, angleB, scaleNumerator / 5),
      info: { course, mode: preset.kind === 'street' ? 'Street Work' : 'Time Attack', setup: preset.setup, record: `ROM ${hex(at)}`, scaleNumerator, angleA, angleB } }) - 1);
  }
  layers.push({ name: 'course markers', kind: 'markers', instances: placed });
}

export const FREE_PRESET: PlacementPreset = { kind: 'free', setup: 0, name: 'Free Run' };
export const COURSE_PRESETS: readonly PlacementPreset[] = [
  FREE_PRESET,
  ...(['street', 'time', 'coin'] as const).flatMap((kind) => [0, 1, 2].map((setup) => ({
    kind, setup, name: `${kind === 'street' ? 'Street Work' : kind === 'time' ? 'Time Attack' : 'Coin'} — Level ${setup + 1}`,
  }))),
];
