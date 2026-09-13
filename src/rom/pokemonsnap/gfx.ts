// Pokémon Snap's HAL display-list normalizer. Runtime segment 0x0E material
// lists are reconstructed from Texture records, then lists are flattened into
// ordinary F3DEX2 command order for the shared interpreter.
import { runDisplayList, type DlLighting, type Mtx } from '../displaylist';
import type { Batch, Texture } from '../types';
import { AnimNode } from './anim';
import type { SnapMemory } from './fs';

export const G = { ZBUFFER: 0x1, SHADE: 0x4, CULL_BACK: 0x400, FOG: 0x10000, LIGHTING: 0x20000, SMOOTH: 0x200000 };
export const RM_FOG_OPA = 0xc8112078;
export const RM_FOG_XLU = 0xc81049d8;
export const RM_AA_OPA_SURF_NOZ = 0x00442048;
const SYNTH = 0xf0000000;
const SYNTH_MTX = 0xe0000000;

export interface MObjState {
  addr: number; fmt: number; siz: number; images: number; scale: number; texelOffset: number;
  widthMain: number; heightMain: number; halfS: number; offS: number; offT: number; scaleS: number; scaleT: number;
  baseOffS: number; baseScaleS: number; palettes: number; flags: number; blockFmt: number; blockSiz: number;
  blockWidth: number; blockHeight: number; widthAux: number; heightAux: number; auxOffS: number; auxOffT: number;
  auxBaseOffS: number; prim: number; lodLevel: number; minLod: number; env: number; blend: number;
  imageIndex: number; nextImageIndex: number; paletteIndex: number;
}

// `texturesPtr` points at one DObj's Texture** entry; `animationPtr` at its
// AnimCmd** entry. The game samples these into MObjs before rendering.
export function readMObjs(m: SnapMemory, texturesPtr: number, animationPtr: number, time = 0): MObjState[] {
  const out: MObjState[] = [];
  if (!texturesPtr) return out;
  const list = m.u32(texturesPtr);
  for (let i = 0; list && i < 64; i++) {
    const t = m.u32(list + i * 4);
    if (!t) break;
    out.push({
      addr: t, fmt: m.u8(t + 2), siz: m.u8(t + 3), images: m.u32(t + 4), scale: m.u16(t + 8), texelOffset: m.u16(t + 10),
      widthMain: m.u16(t + 12), heightMain: m.u16(t + 14), halfS: m.s32(t + 16), offS: m.f32(t + 20), offT: m.f32(t + 24),
      scaleS: m.f32(t + 28), scaleT: m.f32(t + 32),
      // Texture is copied to an MObj and these two fields are reset by Pokemon_SetTexture/omCreateMObj.
      baseOffS: m.f32(t + 20), baseScaleS: m.f32(t + 28), palettes: m.u32(t + 44),
      flags: m.u16(t + 48), blockFmt: m.u8(t + 50), blockSiz: m.u8(t + 51), blockWidth: m.u16(t + 52), blockHeight: m.u16(t + 54),
      widthAux: m.u16(t + 56), heightAux: m.u16(t + 58), auxOffS: m.f32(t + 60), auxOffT: m.f32(t + 64), auxBaseOffS: m.f32(t + 68),
      prim: m.u32(t + 80), lodLevel: m.u8(t + 84) / 255, minLod: m.u8(t + 85), env: m.u32(t + 88), blend: m.u32(t + 92),
      imageIndex: 0, nextImageIndex: 0, paletteIndex: 0,
    });
  }
  if (animationPtr) {
    const perMaterial = m.u32(animationPtr);
    for (let i = 0; perMaterial && i < out.length; i++) {
      const listAddr = m.u32(perMaterial + i * 4);
      if (!listAddr) continue;
      const n = new AnimNode(m, true);
      n.set(listAddr, time); n.speed = 0; n.tick();
      const s = out[i];
      for (const [p, v] of n.values) {
        switch (p) {
          case 13: s.imageIndex = Math.trunc(v) & 0xffff; break;
          case 14: s.offS = v; break;
          case 15: s.offT = v; break;
          case 16: s.scaleS = v; break;
          case 17: s.scaleT = v; break;
          case 18: s.nextImageIndex = Math.trunc(v) & 0xffff; break;
          case 19: s.auxOffS = v; break;
          case 20: s.auxOffT = v; break;
          case 21: s.lodLevel = v; break;
          case 22: s.paletteIndex = Math.trunc(v); break;
          case 37: s.prim = v >>> 0; break;
          case 38: s.env = v >>> 0; break;
          case 39: s.blend = v >>> 0; break;
        }
      }
    }
  }
  return out;
}

interface Tile {
  w0: number; set: boolean; fmt: number; siz: number; line: number; tmem: number; pal: number;
  cmt: number; maskT: number; shiftT: number; cms: number; maskS: number; shiftS: number;
  uls: number; ult: number; lrs: number; lrt: number; sized: boolean;
}
export interface ListOptions { geometryMode: number; renderMode: number; combiner?: boolean; lighting?: DlLighting }
export interface ListStats {
  name: string; commands: number; triangles: number; materialCalls: number;
  unboundDraws: number; unknownOps: Record<string, number>; images: string[];
}

export class GfxWriter {
  readonly tiles: Tile[] = Array.from({ length: 8 }, () => ({
    w0: 0, set: false, fmt: 0, siz: 0, line: 0, tmem: 0, pal: 0,
    cmt: 0, maskT: 0, shiftT: 0, cms: 0, maskS: 0, shiftS: 0,
    uls: 0, ult: 0, lrs: 0, lrt: 0, sized: false,
  }));
  readonly loaded = new Map<number, number>();
  readonly start: number;
  readonly stats: ListStats;
  private image = -1;
  private dirty = true;

  constructor(readonly gfx: GfxBuilder, readonly name: string, readonly options: ListOptions) {
    this.start = SYNTH + gfx.words.length * 4;
    this.stats = { name, commands: 0, triangles: 0, materialCalls: 0, unboundDraws: 0, unknownOps: {}, images: [] };
  }

  emit(w0: number, w1: number): void { this.gfx.words.push(w0 >>> 0, w1 >>> 0); }
  private unknown(key: string): void { this.stats.unknownOps[key] = (this.stats.unknownOps[key] ?? 0) + 1; }
  private setTile(w0: number, w1: number): void {
    const t = this.tiles[(w1 >>> 24) & 7];
    Object.assign(t, {
      w0, set: true, fmt: (w0 >>> 21) & 7, siz: (w0 >>> 19) & 3,
      line: ((w0 >>> 9) & 0x1ff) * 8, tmem: (w0 & 0x1ff) * 8, pal: (w1 >>> 20) & 0xf,
      cmt: (w1 >>> 18) & 3, maskT: (w1 >>> 14) & 0xf, shiftT: (w1 >>> 10) & 0xf,
      cms: (w1 >>> 8) & 3, maskS: (w1 >>> 4) & 0xf, shiftS: w1 & 0xf,
    });
  }
  private setSize(k: number, uls: number, ult: number, lrs: number, lrt: number): void {
    Object.assign(this.tiles[k], { uls, ult, lrs, lrt, sized: true });
  }
  private loadTlut(tile: number, palette: number, count: number): void {
    this.emit(0xf5000100, 0x05000000);
    this.emit(0xfd100000, palette);
    this.emit(0xf0000000, (tile << 24) | ((count - 1) << 14));
    this.dirty = true;
  }
  private bind(): void {
    this.dirty = false;
    const t = this.tiles[0];
    const image = this.loaded.get(t.tmem);
    if (!t.set || image === undefined || !t.sized) { this.stats.unboundDraws++; return; }
    const bits = [4, 8, 16, 32][t.siz];
    const winW = ((t.lrs - t.uls) >> 2) + 1, winH = ((t.lrt - t.ult) >> 2) + 1;
    const width = t.maskS ? 1 << t.maskS : t.line ? t.line * 8 / bits : winW;
    const height = t.maskT ? 1 << t.maskT : winH;
    const cms = winW > width ? 0 : t.cms, cmt = winH > height ? 0 : t.cmt;
    const mod = (v: number, n: number) => ((v % n) + n) % n;
    const uls = cms === 0 ? mod(t.uls, width * 4) : t.uls & 0xfff;
    const ult = cmt === 0 ? mod(t.ult, height * 4) : t.ult & 0xfff;
    const key = `0x${image.toString(16)}`;
    if (!this.stats.images.includes(key)) this.stats.images.push(key);
    this.emit(0xfd000000 | (t.siz << 19), image);
    this.emit(0xf3000000, 0x07000000);
    this.emit(t.w0, (t.pal << 20) | (cmt << 18) | (t.maskT << 14) | (t.shiftT << 10) | (cms << 8) | (t.maskS << 4) | t.shiftS);
    this.emit(0xf2000000 | ((uls & 0xfff) << 12) | (ult & 0xfff),
      (((uls + (width - 1) * 4) & 0xfff) << 12) | ((ult + (height - 1) * 4) & 0xfff));
  }

  // Reconstruct renLoadTextures for one material at animation frame zero.
  private material(s: MObjState | undefined, index: number): void {
    const m = this.gfx.mem;
    this.stats.materialCalls++;
    if (!s) { this.unknown(`DE 0E missing material ${index}`); return; }
    const flags = s.flags || 0xa1;
    let scaleS = s.scaleS, offS = s.offS, auxOffS = s.auxOffS;
    const scaleT = s.scaleT;
    if (s.halfS) {
      scaleS *= 0.5;
      offS = (offS - s.baseOffS + 1 - s.baseScaleS * 0.5) * 0.5;
      auxOffS = (auxOffS - s.auxBaseOffS + 1 - s.baseScaleS * 0.5) * 0.5;
    }
    let imageIndex = s.imageIndex, nextImageIndex = s.nextImageIndex;
    if (flags & 0x04) {
      const palette = m.u32(s.palettes + 4 * s.paletteIndex);
      this.image = palette;
      if (flags & 0x03) this.loadTlut(5, palette, s.siz === 1 ? 256 : 16);
    }
    if (flags & 0x1000) this.emit(0xdb0a0000, m.u32(s.addr + 0x60));
    if (flags & 0x2000) this.emit(0xdb0a0018, m.u32(s.addr + 0x64));
    if (flags & (0x200 | 0x10 | 0x08)) {
      let frac: number;
      if (flags & 0x10) {
        const base = Math.trunc(s.lodLevel);
        frac = Math.trunc((s.lodLevel - base) * 256); imageIndex = base; nextImageIndex = base + 1;
      } else frac = Math.trunc(s.lodLevel * 255);
      this.emit(0xfa000000 | (s.minLod << 8) | (frac & 0xff), s.prim);
    }
    if (flags & 0x400) this.emit(0xfb000000, s.env);
    if (flags & (0x10 | 0x02)) {
      this.image = m.u32(s.images + 4 * nextImageIndex);
      if (flags & (0x10 | 0x01)) { this.loaded.set(this.tiles[6].tmem, this.image); this.dirty = true; }
    }
    if (flags & (0x10 | 0x01)) this.image = m.u32(s.images + 4 * imageIndex);
    const eps = 1 / 65535;
    if (flags & 0x20) {
      const uls = Math.abs(scaleS) > eps ? Math.trunc(((offS * s.widthMain + s.texelOffset) / scaleS) * 4) : 0;
      const ult = Math.abs(scaleT) > eps ? Math.trunc((((1 - scaleT - s.offT) * s.heightMain + s.texelOffset) / scaleT) * 4) : 0;
      this.setSize(0, uls, ult, ((s.widthMain - 1) << 2) + uls, ((s.heightMain - 1) << 2) + ult);
      this.dirty = true;
    }
    if (flags & 0x40) {
      const uls = Math.abs(scaleS) > eps ? Math.trunc(((auxOffS * s.widthAux + s.texelOffset) / scaleS) * 4) : 0;
      const ult = Math.abs(scaleT) > eps ? Math.trunc((((1 - scaleT - s.auxOffT) * s.heightAux + s.texelOffset) / scaleT) * 4) : 0;
      this.setSize(1, uls, ult, ((s.widthAux - 1) << 2) + uls, ((s.heightAux - 1) << 2) + ult);
    }
    if (flags & 0x80) {
      const ss = Math.min(0xffff, Math.abs(scaleS) > eps ? Math.trunc(2097152 / s.scale / scaleS) : 0);
      const tt = Math.min(0xffff, Math.abs(scaleT) > eps ? Math.trunc(2097152 / s.scale / scaleT) : 0);
      this.emit(0xd7000002, (ss << 16) | tt);
    }
  }

  walk(addr: number, materials: MObjState[], depth = 0): void {
    const m = this.gfx.mem;
    if (depth > 16) throw new Error('Pokémon Snap display-list nesting exceeds 16');
    let half1 = 0;
    for (let n = 0, a = addr; n < 100000; n++, a += 8) {
      const w0 = m.u32(a), w1 = m.u32(a + 4), op = w0 >>> 24;
      this.stats.commands++;
      this.gfx.opcodes.set(op, (this.gfx.opcodes.get(op) ?? 0) + 1);
      switch (op) {
        case 0x01: case 0x02: // VTX, MODIFYVTX
          this.emit(w0, w1); break;
        case 0x05: case 0x06: case 0x07:
          if (this.dirty) this.bind();
          this.stats.triangles += op === 0x05 ? 1 : 2;
          this.emit(w0, w1); break;
        case 0xdb: case 0xd7: case 0xd9: case 0xe2: case 0xe3: case 0xfa: case 0xfb: case 0xfc:
          this.emit(w0, w1); break;
        case 0x00: case 0x03: case 0xe6: case 0xe7: case 0xe8: case 0xe9: case 0xf9:
          break;
        case 0xe1: half1 = w1; break;
        case 0x04: this.walk(half1, materials, depth + 1); return; // always choose the near LOD
        case 0xfd: this.image = w1; break;
        case 0xf5: this.setTile(w0, w1); if (((w1 >>> 24) & 7) === 0) this.dirty = true; break;
        case 0xf2: this.setSize((w1 >>> 24) & 7, (w0 >>> 12) & 0xfff, w0 & 0xfff, (w1 >>> 12) & 0xfff, w1 & 0xfff); this.dirty = true; break;
        case 0xf3: this.loaded.set(this.tiles[(w1 >>> 24) & 7].tmem, this.image); this.dirty = true; break;
        case 0xf0: this.loadTlut((w1 >>> 24) & 7, this.image, ((w1 >>> 14) & 0x3ff) + 1); break;
        case 0xde:
          if (w1 >>> 24 === 0x0e) this.material(materials[(w1 & 0xffffff) / 8], (w1 & 0xffffff) / 8);
          else this.walk(w1, materials, depth + 1);
          if ((w0 >>> 16) & 0xff) return;
          break;
        case 0xdf: return;
        default: this.unknown(op.toString(16));
      }
    }
    throw new Error(`unterminated Pokémon Snap display list at 0x${addr.toString(16)}`);
  }

  matrix(mtx: Mtx): void {
    const addr = SYNTH_MTX + this.gfx.matrixBytes.length;
    const bytes = new Uint8Array(64), dv = new DataView(bytes.buffer);
    for (let i = 0; i < 16; i++) {
      const fixed = Math.max(-2147483648, Math.min(2147483647, Math.round(mtx[i] * 65536)));
      dv.setInt16(i * 2, Math.floor(fixed / 65536));
      dv.setUint16(32 + i * 2, fixed & 0xffff);
    }
    this.gfx.matrixBytes.push(...bytes);
    this.emit(0xda380003, addr); // modelview, load, no push
  }
}

export class GfxBuilder {
  readonly words: number[] = [];
  readonly matrixBytes: number[] = [];
  readonly lists: GfxWriter[] = [];
  readonly textures: Texture[] = [];
  readonly textureKeys = new Map<string, number>();
  readonly opcodes = new Map<number, number>();

  constructor(readonly mem: SnapMemory, readonly keyPrefix: string) {}
  begin(name: string, options: ListOptions): GfxWriter {
    const writer = new GfxWriter(this, name, options); this.lists.push(writer); return writer;
  }
  end(writer: GfxWriter): void { writer.emit(0xdf000000, 0); }

  run(): Map<string, Batch[]> {
    const rom = this.mem.bytes, wordBytes = this.words.length * 4;
    const buf = new Uint8Array(rom.length + wordBytes + this.matrixBytes.length);
    buf.set(rom);
    const dv = new DataView(buf.buffer);
    this.words.forEach((word, i) => dv.setUint32(rom.length + i * 4, word));
    buf.set(this.matrixBytes, rom.length + wordBytes);
    const resolve = (addr: number) => {
      addr >>>= 0;
      if (addr >>> 28 === 0xf) return rom.length + (addr & 0x0fffffff);
      if (addr >>> 28 === 0xe) return rom.length + wordBytes + (addr & 0x0fffffff);
      return this.mem.rom(addr);
    };
    const out = new Map<string, Batch[]>();
    for (const list of this.lists) {
      const useMatrix = this.matrixBytes.length > 0;
      out.set(list.name, runDisplayList({
        buf, ucode: 'f3dex2', resolve, textures: this.textures, textureKeys: this.textureKeys,
        keyPrefix: this.keyPrefix, vertexScale: 1, mirrorX: false,
        geometryMode: list.options.geometryMode, renderMode: list.options.renderMode,
        directImages: true, decals: true, combiner: list.options.combiner,
        ...(list.options.lighting ? { lighting: list.options.lighting } : {}),
        ...(useMatrix ? { matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } : {}),
      }, list.start));
    }
    return out;
  }
}
