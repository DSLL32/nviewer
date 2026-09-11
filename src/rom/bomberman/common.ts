// Helpers shared by the Bomberman loaders.
import type { DlLighting } from '../displaylist';
import type { Batch, Fog, Instance, Level, LevelInfo, Mesh, Texture } from '../types';
import { emptyBounds, view } from '../util';

export const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function translation(x: number, y: number, z: number): Float32Array {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

// Batches from separate display lists with identical render state are concatenated.
export function mergeBatches(batches: Batch[]): Batch[] {
  const groups = new Map<string, Batch[]>();
  for (const b of batches) {
    if (b.positions.length === 0) continue;
    const k = `${b.texture}/${b.blend}/${b.depthTest}/${b.depthWrite}/${b.cullBack}/${b.decal ?? false}`;
    const g = groups.get(k);
    if (g) g.push(b);
    else groups.set(k, [b]);
  }
  return [...groups.values()].map((g) => {
    if (g.length === 1) return g[0];
    const cat = <T extends Float32Array | Uint8Array>(get: (b: Batch) => T, make: (n: number) => T): T => {
      const out = make(g.reduce((s, b) => s + get(b).length, 0));
      let o = 0;
      for (const b of g) {
        out.set(get(b), o);
        o += get(b).length;
      }
      return out;
    };
    return {
      ...g[0],
      positions: cat((b) => b.positions, (n) => new Float32Array(n)),
      uvs: cat((b) => b.uvs, (n) => new Float32Array(n)),
      colors: cat((b) => b.colors, (n) => new Uint8Array(n)),
    };
  });
}

export function meshFromBatches(name: string, batches: Batch[]): Mesh {
  const merged = mergeBatches(batches);
  let radius = 0;
  for (const b of merged) {
    for (let k = 0; k < b.positions.length; k += 3) {
      radius = Math.max(radius, Math.hypot(b.positions[k], b.positions[k + 1], b.positions[k + 2]));
    }
  }
  return { name, radius, batches: merged };
}

// Draws a mesh translucent with a constant alpha (the games blend some surfaces by a
// factor set in game code).
export function withAlpha(mesh: Mesh, alpha: number): Mesh {
  return {
    ...mesh,
    batches: mergeBatches(mesh.batches.map((b) => {
      const colors = b.colors.slice();
      for (let k = 3; k < colors.length; k += 4) colors[k] = Math.round(colors[k] * alpha);
      return { ...b, colors, blend: 'blend', depthWrite: false };
    })),
  };
}

export function buildLevel(info: LevelInfo, id: string, textures: Texture[], meshes: Mesh[], instances: Instance[], extra: Partial<Level> = {}): Level {
  const bounds = emptyBounds();
  for (const inst of instances) {
    const mesh = meshes[inst.mesh];
    if (!mesh) continue;
    const m = inst.matrix;
    for (const b of mesh.batches) {
      const p = b.positions;
      for (let k = 0; k < p.length; k += 3) {
        const x = p[k] * m[0] + p[k + 1] * m[4] + p[k + 2] * m[8] + m[12];
        const y = p[k] * m[1] + p[k + 1] * m[5] + p[k + 2] * m[9] + m[13];
        const z = p[k] * m[2] + p[k + 1] * m[6] + p[k + 2] * m[10] + m[14];
        if (x < bounds.min[0]) bounds.min[0] = x;
        if (y < bounds.min[1]) bounds.min[1] = y;
        if (z < bounds.min[2]) bounds.min[2] = z;
        if (x > bounds.max[0]) bounds.max[0] = x;
        if (y > bounds.max[1]) bounds.max[1] = y;
        if (z > bounds.max[2]) bounds.max[2] = z;
      }
    }
  }
  const used = new Set(instances.map((i) => i.mesh));
  return {
    info, id, textures, meshes, instances, bounds,
    unplaced: meshes.map((_, i) => i).filter((i) => !used.has(i)),
    ...extra,
  };
}

// gSPFogPosition(min, max) as libultra computes it (C integer division), for a projection
// with the given near and far planes.
export function fogPosition(min: number, max: number, color: [number, number, number], near: number, far: number): Fog {
  return {
    color,
    multiplier: Math.trunc(128000 / (max - min)),
    offset: Math.trunc(((500 - min) * 256) / (max - min)),
    near,
    far,
  };
}

// libultra lights: unit directions from signed-byte vectors.
export function lighting(lights: { color: number; dir: [number, number, number] }[], ambient: number): DlLighting {
  const rgb = (c: number): [number, number, number] => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
  return {
    lights: lights.map((l) => {
      const n = Math.hypot(...l.dir) || 1;
      return { color: rgb(l.color), dir: [l.dir[0] / n, l.dir[1] / n, l.dir[2] / n] };
    }),
    ambient: rgb(ambient),
  };
}

export type PixelFormat = 'CI4' | 'CI8' | 'RGBA16' | 'RGBA32';

// A plain image (rows of whole texels, not RDP texture memory) with an optional RGBA16
// palette.
export function decodeImage(buf: Uint8Array, offset: number, format: PixelFormat, width: number, height: number, palette = -1): Texture {
  const dv = view(buf);
  const rgba = new Uint8Array(width * height * 4);
  const e5 = (v: number) => (v << 3) | (v >> 2);
  const put16 = (v: number, d: number) => {
    rgba[d] = e5((v >> 11) & 31);
    rgba[d + 1] = e5((v >> 6) & 31);
    rgba[d + 2] = e5((v >> 1) & 31);
    rgba[d + 3] = v & 1 ? 255 : 0;
  };
  const entry = (i: number) => (palette >= 0 && palette + i * 2 + 2 <= buf.length ? dv.getUint16(palette + i * 2) : 0);
  const rowBytes = format === 'CI4' ? (width + 1) >> 1 : format === 'CI8' ? width : format === 'RGBA16' ? width * 2 : width * 4;
  for (let y = 0; y < height; y++) {
    const row = offset + y * rowBytes;
    for (let x = 0; x < width; x++) {
      const d = (y * width + x) * 4;
      switch (format) {
        case 'CI4': put16(entry((buf[row + (x >> 1)] >> (x & 1 ? 0 : 4)) & 15), d); break;
        case 'CI8': put16(entry(buf[row + x] ?? 0), d); break;
        case 'RGBA16': put16(row + x * 2 + 2 <= buf.length ? dv.getUint16(row + x * 2) : 0, d); break;
        case 'RGBA32': for (let c = 0; c < 4; c++) rgba[d + c] = buf[row + x * 4 + c] ?? 0; break;
      }
    }
  }
  return { width, height, rgba, wrapS: 'clamp', wrapT: 'clamp', format: palette >= 0 ? `${format}/RGBA16` : format };
}
