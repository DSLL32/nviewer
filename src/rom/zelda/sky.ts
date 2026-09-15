// Skyboxes as camera-centred Sky meshes (docs/OCARINA_OF_TIME.md and docs/MAJORAS_MASK.md; z_vr_box.c). The game blends two CI8 textures by a
// constant (and MM tints the result with prim/env colours): the viewer bakes that into one texture per face. Skies are
// opaque in game; the baked textures get alpha 255 because the viewer blends sky meshes.
import { decodeRows, ImFmt, ImSiz, Tlut } from '../texture';
import type { Batch, Texture } from '../types';

export interface SkyFace { rgba: Uint8Array; width: number; height: number; positions: number[]; uvs: number[] }

const S128 = [[-64, 64, -64, 32, -32], [64, 64, 64, -32, -32], [-64, 64, 64, -32, -32], [64, 64, -64, 32, -32], [-64, 64, 64, 32, -32], [-64, -64, -64, 32, 32]];
const S256 = [[-126, 124, -126, 63, -31], [126, 124, -126, 63, -31], [126, 124, 126, -63, -31], [-126, 124, 126, -63, -31]];

const opaque = (rgba: Uint8Array) => {
  for (let k = 3; k < rgba.length; k += 4) rgba[k] = 255;
  return rgba;
};

// Two triangles per grid cell, as Skybox_CalculateFace builds them (both windings drawn: no culling).
function grid(rows: number, cols: number, point: (i: number, j: number) => number[], tc: (i: number, j: number) => number[]) {
  const positions: number[] = [], uvs: number[] = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      for (const [a, b] of [[i, j], [i, j + 1], [i + 1, j + 1], [i, j], [i + 1, j + 1], [i + 1, j]]) {
        positions.push(...point(a, b));
        uvs.push(...tc(a, b));
      }
    }
  }
  return { positions, uvs };
}

// A 128-type sky (OoT vr_fine/vr_cloud/vr_holy, MM d2): sides 128x64 at 0x2000 * k, top 128x128 at 0x8000, bottom
// at 0xC000. `mix(a, b)` bakes the two textures' texels (0..255 RGBA) into the output.
export function sky128(
  tex1: Uint8Array, tex2: Uint8Array, tlut: Uint8Array, faces: number,
  mix: (a: Uint8Array, b: Uint8Array, out: Uint8Array) => void,
): SkyFace[] {
  const out: SkyFace[] = [];
  for (let face = 0; face < faces; face++) {
    const [xs, ys, zs, outerP, innerP] = S128[face];
    // Skybox_CalculateFace128 is called with the outer and inner increments swapped.
    const inner = outerP, outer = innerP;
    const w = 128, h = face >= 4 ? 128 : 64;
    const off = face < 4 ? face * 128 * 64 : 4 * 128 * 64 + (face - 4) * 128 * 128;
    const a = decodeRows(tex1, off, ImFmt.CI, ImSiz.B8, w, h, tlut, Tlut.Rgba16);
    const b = tex2 === tex1 ? a : decodeRows(tex2, off, ImFmt.CI, ImSiz.B8, w, h, tlut, Tlut.Rgba16);
    const rgba = new Uint8Array(w * h * 4);
    mix(a, b, rgba);
    const tS = [0, 31, 62, 93, 124], tT = face >= 4 ? tS : [0, 31, 62, 31, 0];
    const g = grid(5, 5, (i, j) => {
      const u = (face <= 1 ? xs : face <= 3 ? zs : xs) + inner * j;
      const v = (face <= 3 ? ys : zs) + outer * i;
      return face <= 1 ? [u, v, zs] : face <= 3 ? [xs, v, u] : [u, ys, v];
    }, (i, j) => [tS[j] / w, tT[i] / h]);
    out.push({ rgba: opaque(rgba), width: w, height: h, ...g });
  }
  return out;
}

// A 256-type sky (OoT houses, shops, market): 256x256 CI8 faces at face * 0x10000, each with its own 256-colour
// palette at face * 0x200; 9 rows x 5 columns per face, texels 63 j by 31 i.
export function sky256(tex: Uint8Array, pal: Uint8Array, faces: number): SkyFace[] {
  const out: SkyFace[] = [];
  for (let face = 0; face < faces; face++) {
    const [xs, ys, zs, outerP, innerP] = S256[face];
    const inner = outerP, outer = innerP;
    const rgba = opaque(decodeRows(tex, face * 0x10000, ImFmt.CI, ImSiz.B8, 256, 256, pal.subarray(face * 0x200, face * 0x200 + 0x200), Tlut.Rgba16));
    const g = grid(9, 5, (i, j) => {
      const u = (face % 2 === 0 ? xs : zs) + inner * j, v = ys + outer * i;
      return face % 2 === 0 ? [u, v, zs] : [xs, v, u];
    }, (i, j) => [(63 * j) / 256, (31 * i) / 256]);
    out.push({ rgba, width: 256, height: 256, ...g });
  }
  return out;
}

// Sky faces as batches with their own clamped textures (appended to `textures`).
export function skyBatches(faces: SkyFace[], textures: Texture[], source: string): Batch[] {
  return faces.map((f, k) => {
    const texture = textures.push({ width: f.width, height: f.height, rgba: f.rgba, wrapS: 'clamp', wrapT: 'clamp', format: 'CI8', source: `${source} face ${k}` }) - 1;
    const n = f.positions.length / 3;
    return {
      texture, blend: 'opaque', depthTest: false, depthWrite: false, cullBack: false,
      positions: new Float32Array(f.positions), uvs: new Float32Array(f.uvs), colors: new Uint8Array(n * 4).fill(255),
    };
  });
}

// lerp(TEXEL0, TEXEL1, blend / 255), as SETUPDL_40's combiner.
export const lerpMix = (blend: number) => (a: Uint8Array, b: Uint8Array, out: Uint8Array) => {
  const t = blend / 255;
  for (let k = 0; k < out.length; k++) out[k] = Math.round(a[k] + (b[k] - a[k]) * t);
};

// MM: lerp(TEXEL0, TEXEL1, PRIM_ALPHA) then (PRIM - ENV) x COMBINED + ENV.
export const tintedMix = (blend: number, prim: number[], env: number[]) => (a: Uint8Array, b: Uint8Array, out: Uint8Array) => {
  const t = blend / 255;
  for (let k = 0; k < out.length; k += 4) {
    for (let c = 0; c < 3; c++) {
      const v = (a[k + c] + (b[k + c] - a[k + c]) * t) / 255;
      out[k + c] = Math.max(0, Math.min(255, Math.round(env[c] + (prim[c] - env[c]) * v)));
    }
    out[k + 3] = 255;
  }
};

// OoT skybox ids of the 256 skies: [pair index after vr_fine0 (texture/palette file pairs), faces].
export const OOT_SKY256: Record<number, [number, number]> = {
  2: [18, 2], 4: [12, 4], 7: [13, 4], 9: [10, 4], 10: [11, 4], 11: [31, 4], 12: [14, 4], 14: [15, 3], 15: [19, 4], 16: [20, 4],
  17: [23, 2], 19: [24, 2], 20: [25, 2], 22: [26, 2], 23: [27, 2], 24: [28, 2], 26: [22, 4], 27: [29, 4], 28: [30, 3],
  32: [16, 3], 33: [17, 3], 34: [21, 3],
};
