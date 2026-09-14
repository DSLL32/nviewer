import type { Batch, Mesh, MeshSky, Texture } from '../types';

const u32 = (b: Uint8Array, p: number) => ((b[p] * 0x1000000) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3]) >>> 0;
const expand5 = (v: number) => (v << 3) | (v >>> 2);

function rgba16(value: number, out: Uint8Array, offset: number) {
  out[offset] = expand5((value >>> 11) & 31);
  out[offset + 1] = expand5((value >>> 6) & 31);
  out[offset + 2] = expand5((value >>> 1) & 31);
  out[offset + 3] = value & 1 ? 255 : 0;
}

export interface BugsLifePageTexture {
  slot: number;
  descriptor: number;
  texture: Texture;
}

function dimensions(descriptor: number): [number, number] {
  return [descriptor & 1 ? 64 : 32, descriptor & 2 ? 64 : 32];
}

function payloadBytes(descriptor: number): number {
  const [width, height] = dimensions(descriptor);
  switch (descriptor & 12) {
    case 8: return width * height;       // CI8
    case 12: return width * height * 2;  // RGBA16
    default: return width * height / 2;  // CI4, including reserved dynamic-page descriptors 0..3
  }
}

export function decodeTpg(data: Uint8Array, source: string): BugsLifePageTexture[] {
  if (data.length < 0x240) throw new Error(`${source}: truncated TPG`);
  const result: BugsLifePageTexture[] = [];
  let payload = 0x240;
  for (let slot = 0; slot < 16; slot++) {
    const descriptor = u32(data, slot * 4);
    if (descriptor === 0xffffffff) continue;
    const [width, height] = dimensions(descriptor), bytes = payloadBytes(descriptor);
    if (payload + bytes > data.length) throw new Error(`${source}: slot ${slot} payload exceeds page`);
    const formatBits = descriptor & 12;
    // The runtime setup at 0x80013324 emits no texture commands for format
    // bits zero. Those reserved/dynamic payloads still occupy file space but
    // are deliberately not presented as decoded static textures.
    if (formatBits === 0) { payload += bytes; continue; }
    const rgba = new Uint8Array(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel++) {
      let color: number;
      if (formatBits === 12) color = (data[payload + pixel * 2] << 8) | data[payload + pixel * 2 + 1];
      else {
        const index = formatBits === 8
          ? data[payload + pixel]
          : (data[payload + (pixel >>> 1)] >>> (pixel & 1 ? 0 : 4)) & 15;
        // CI4 pages own one 16-entry palette per slot; CI8 uses the whole
        // shared 256-entry palette region.
        const palette = formatBits === 8 ? 0x40 + index * 2 : 0x40 + slot * 0x20 + index * 2;
        color = (data[palette] << 8) | data[palette + 1];
      }
      rgba16(color, rgba, pixel * 4);
    }
    const format = formatBits === 8 ? 'CI8/RGBA16' : formatBits === 12 ? 'RGBA16' : 'CI4/RGBA16';
    result.push({ slot, descriptor, texture: {
      width, height, rgba, wrapS: 'repeat', wrapT: 'repeat', format,
      source: `${source} slot ${slot} descriptor 0x${descriptor.toString(16)} payload 0x${payload.toString(16)}`,
    } });
    payload += bytes;
  }
  if (payload !== data.length) throw new Error(`${source}: TPG payload ends at 0x${payload.toString(16)}, file is 0x${data.length.toString(16)}`);
  return result;
}

export function decodeParallax(data: Uint8Array, source: string): Texture {
  // 0x800620f8 uploads ten consecutive 0x800-byte CI8 panels from +0x200;
  // 0x8000b358 loads the 256-entry RGBA16 TLUT at the file start. The file is
  // therefore a 10 x (64x32) strip, not a raw 256x41 RGBA16 image.
  const panelWidth = 64, panels = 10, width = panelWidth * panels, height = 32;
  if (data.length !== 0x200 + panels * 0x800) throw new Error(`${source}: invalid parallax CI8 strip size`);
  const rgba = new Uint8Array(width * height * 4);
  for (let panel = 0; panel < panels; panel++) for (let y = 0; y < height; y++) for (let x = 0; x < panelWidth; x++) {
    const index = data[0x200 + panel * 0x800 + y * panelWidth + x];
    rgba16((data[index * 2] << 8) | data[index * 2 + 1], rgba, (y * width + panel * panelWidth + x) * 4);
  }
  return { width, height, rgba, wrapS: 'repeat', wrapT: 'clamp', format: 'CI8/RGBA16 parallax (10x64x32)', source };
}

// The game draws the ten .par panels as a thin camera-relative horizontal
// strip. A thin inward cylinder preserves that parallax behavior in the
// viewer; its screen-space renderer and fill bands are not yet reproduced.
export function parallaxSkyMesh(texture: number, source: string): { mesh: Mesh; sky: MeshSky } {
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [];
  const segments = 80, radius = 1000, bottom = -103, top = 103;
  const vertex = (i: number, y: number, v: number) => {
    const turn = i / segments, angle = turn * Math.PI * 2;
    positions.push(Math.sin(angle) * radius, y, Math.cos(angle) * radius);
    uvs.push(turn, v); colors.push(255, 255, 255, 255);
  };
  for (let i = 0; i < segments; i++) {
    vertex(i, bottom, 1); vertex(i + 1, top, 0); vertex(i, top, 0);
    vertex(i, bottom, 1); vertex(i + 1, bottom, 1); vertex(i + 1, top, 0);
  }
  const batch: Batch = {
    texture, blend: 'opaque', depthTest: false, depthWrite: false, cullBack: false,
    positions: new Float32Array(positions), uvs: new Float32Array(uvs), colors: new Uint8Array(colors),
  };
  const mesh: Mesh = { name: 'parallax backdrop', radius: Math.hypot(radius, top), batches: [batch], info: {
    source, layout: 'verified 0x200-byte TLUT + ten 64x32 CI8 panels',
    limitation: 'thin camera-relative cylinder approximates the game screen-space strip/fill compositor',
  } };
  return { mesh, sky: { name: 'parallax backdrop', mesh: -1, opaque: true } };
}
