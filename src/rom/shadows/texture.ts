import type { BlendMode, Texture } from '../types';
import { decodeIntroLzss } from './codecs';
import { ShadowsSceneImage } from './scene';

const be32 = (bytes: Uint8Array, at: number) =>
  ((bytes[at] * 0x1000000) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3]) >>> 0;

export class ShadowsTextureArchive {
  private decoded?: Uint8Array;
  private readonly block: Uint8Array;
  private readonly scales = new Map<number, [number, number]>();

  constructor(rom: Uint8Array) {
    let root = -1;
    for (let at = 0x1000; at < 0x3000; at += 0x10)
      if (be32(rom, at) === 0x4f677265) { root = at; break; }
    if (root < 0) throw new Error('Shadows texture Ogre root not found');
    const start = be32(rom, root + 0x30), end = be32(rom, root + 0x20);
    if (start >= end || end > rom.length) throw new Error('invalid Shadows shared image archive span');
    this.block = rom.subarray(start, end);
  }

  decode(imageId: number): Texture | null {
    const bytes = this.decoded ??= decodeIntroLzss(this.block);
    const catalogCount = be32(bytes, 0);
    const catalog = 0x10 + imageId * 12;
    if (imageId < 0 || imageId >= catalogCount || catalog + 12 > bytes.length) return null;
    const command = be32(bytes, catalog) - 0x80400000;
    const start = be32(bytes, catalog + 4) - 0x80400000;
    const end = be32(bytes, catalog + 8) - 0x80400000;
    if (start < 0 || command < start + 8 || command + 16 > end || end > bytes.length) return null;

    // Each image DL begins (after its rewritten head) with G_TEXTURE. Its
    // unsigned 16-bit S/T factors multiply the vertex's 10.5 coordinates.
    const scaleWord = be32(bytes, command + 8);
    if ((scaleWord >>> 24) !== 0xbb || !(scaleWord & 1)) return null;
    const factors = be32(bytes, command + 12);
    this.scales.set(imageId, [(factors >>> 16) / 65536, (factors & 0xffff) / 65536]);

    const commands: [number, number][] = [];
    const walk = (at: number, depth: number) => {
      for (let steps = 0; steps < 96 && at + 8 <= end; steps++, at += 8) {
        const w0 = be32(bytes, at), w1 = be32(bytes, at + 4);
        if ((w0 >>> 24) === 6 && depth < 2) {
          const target = w1 & 0x3fffff;
          if (target >= start && target + 8 <= end && !(target & 7)) walk(target, depth + 1);
        } else commands.push([w0, w1]);
        if (w0 === 0xb8000000) break;
      }
    };
    walk(command + 8, 0);
    let width = 0, height = 0, format = -1, size = -1, loaded = false;
    let tileFormat = -1, tileSize = -1;
    const images: number[] = [];
    // The first F2 after a texture load is the base tile; later F2s describe
    // smaller mip levels. The closest F5 is its render format, not the earlier
    // 16-bit load format used to transfer bytes into TMEM.
    for (const [w0, w1] of commands) {
      const opcode = w0 >>> 24;
      if (opcode === 0xfd && !loaded) images.push(w1 & 0x3fffff);
      else if (opcode === 0xf3) loaded = true;
      else if (opcode === 0xf5) { tileFormat = (w0 >>> 21) & 7; tileSize = (w0 >>> 19) & 3; }
      else if (opcode === 0xf2 && loaded) {
        width = Math.floor((((w1 >>> 12) & 0xfff) - ((w0 >>> 12) & 0xfff)) / 4) + 1;
        height = Math.floor(((w1 & 0xfff) - (w0 & 0xfff)) / 4) + 1;
        format = tileFormat; size = tileSize;
        break;
      }
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 1024 || height > 1024 || !images.length)
      return null;
    const texel = images[images.length - 1];
    const palette = images.length > 1 ? images[0] : -1;
    const bits = format === 2 && size === 0 || format === 4 && size === 0 ? 4
      : format === 2 && size === 1 ? 8 : format === 0 && size === 2 ? 16
      : format === 0 && size === 3 ? 32 : 0;
    if (!bits) return null;
    const rowBytes = Math.ceil(width * bits / 8);
    if (texel < start || texel + rowBytes * height > end) return null;
    if (format === 2 && (palette < start || palette + (size === 0 ? 32 : 512) > end)) return null;
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x, dest = i * 4, source = texel + y * rowBytes;
      if (format === 2) {
        const index = size === 1 ? bytes[source + x]
          : (x & 1) ? bytes[source + (x >>> 1)] & 15 : bytes[source + (x >>> 1)] >>> 4;
        const color = (bytes[palette + index * 2] << 8) | bytes[palette + index * 2 + 1];
        rgba[dest] = Math.round(((color >>> 11) & 31) * 255 / 31);
        rgba[dest + 1] = Math.round(((color >>> 6) & 31) * 255 / 31);
        rgba[dest + 2] = Math.round(((color >>> 1) & 31) * 255 / 31);
        rgba[dest + 3] = (color & 1) ? 255 : 0;
      } else if (format === 4) {
        const value = ((x & 1) ? bytes[source + (x >>> 1)] & 15 : bytes[source + (x >>> 1)] >>> 4) * 17;
        rgba[dest] = rgba[dest + 1] = rgba[dest + 2] = value;
        rgba[dest + 3] = 255;
      } else if (size === 2) {
        const color = (bytes[source + x * 2] << 8) | bytes[source + x * 2 + 1];
        rgba[dest] = Math.round(((color >>> 11) & 31) * 255 / 31);
        rgba[dest + 1] = Math.round(((color >>> 6) & 31) * 255 / 31);
        rgba[dest + 2] = Math.round(((color >>> 1) & 31) * 255 / 31);
        rgba[dest + 3] = (color & 1) ? 255 : 0;
      } else {
        rgba.set(bytes.subarray(source + x * 4, source + x * 4 + 4), dest);
      }
    }
    return {
      width, height, rgba, wrapS: 'repeat', wrapT: 'repeat',
      format: format === 2 ? `CI${bits}/RGBA16` : format === 4 ? 'I4' : `RGBA${bits}`,
      source: `shared A image ${imageId} at +0x${texel.toString(16)}`,
    };
  }

  scale(imageId: number): [number, number] | undefined {
    return this.scales.get(imageId);
  }
}

export class ShadowsSceneTextures {
  readonly textures: Texture[] = [];
  private readonly modes: BlendMode[] = [];
  private readonly scales: [number, number][] = [];
  private readonly byId = new Map<number, number>();

  constructor(private readonly scene: ShadowsSceneImage, private readonly archive: ShadowsTextureArchive) {}

  mode(index: number): BlendMode {
    return index < 0 ? 'opaque' : this.modes[index];
  }

  scale(index: number): [number, number] {
    return index < 0 ? [0, 0] : this.scales[index];
  }

  forRecord(record: number): number {
    const material = this.scene.u32(record + 0x24) - this.scene.base;
    if (!this.scene.contains(material, 12)) return -1;
    const descriptor = this.scene.u32(material + 8) - this.scene.base;
    if (!this.scene.contains(descriptor, 16)) return -1;
    const imageId = this.scene.u32(descriptor + 8);
    const existing = this.byId.get(imageId);
    if (existing !== undefined) return existing;
    const texture = this.archive.decode(imageId);
    if (!texture) { this.byId.set(imageId, -1); return -1; }
    const index = this.textures.length;
    this.textures.push(texture);
    this.scales.push(this.archive.scale(imageId)!);
    let cutout = false, blend = false;
    for (let i = 3; i < texture.rgba.length; i += 4) {
      const alpha = texture.rgba[i];
      if (alpha === 0) cutout = true;
      else if (alpha < 255) blend = true;
    }
    this.modes.push(blend ? 'blend' : cutout ? 'cutout' : 'opaque');
    this.byId.set(imageId, index);
    return index;
  }
}
