// Numeric self-checks for png.ts and raster.ts. Run: npm run check:render  (exits 1 on failure)
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Batch, Texture } from '../../src/rom/types';
import { decodePng, encodePng, readPng } from './png';
import { renderMeshes, type RenderOptions } from './raster';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

// Deterministic PRNG.
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);

// 1. PNG round trip.
{
  const w = 37, h = 23, rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = i % 7 === 0 ? 255 : Math.floor(rand() * 256);
  const back = decodePng(encodePng(w, h, rgba));
  check('png round trip', back.width === w && back.height === h && back.rgba.every((v, i) => v === rgba[i]));
}

// 2. Emulator screenshot (8-bit RGB) decodes.
{
  // Emulator screenshots live outside the repo; point NVIEWER_SHOTS at a directory of PNGs to include this check.
  const dirs = process.env.NVIEWER_SHOTS ? [process.env.NVIEWER_SHOTS] : [];
  const dir = dirs.find((d) => existsSync(d) && readdirSync(d).some((f) => f.endsWith('.png')));
  if (dir) {
    const file = join(dir, readdirSync(dir).find((f) => f.endsWith('.png'))!);
    const img = readPng(file);
    let nonBlack = 0;
    for (let i = 0; i < img.width * img.height; i++) if (img.rgba[i * 4] | img.rgba[i * 4 + 1] | img.rgba[i * 4 + 2]) nonBlack++;
    check('read emulator screenshot', img.width > 0 && img.rgba[3] === 255, `${file} ${img.width}x${img.height}, ${nonBlack} non-black px`);
  } else console.log('skip read emulator screenshot (none found)');
}

const white = (n: number, a = 255) => new Uint8Array(n * 4).fill(255).map((v, i) => (i % 4 === 3 ? a : v));
const batch = (pos: number[], blend: Batch['blend'], alpha = 255, texture = -1, uvs?: number[]): Batch => ({
  texture, blend, depthTest: true, depthWrite: blend !== 'blend', cullBack: true,
  positions: new Float32Array(pos), uvs: new Float32Array(uvs ?? new Array((pos.length / 3) * 2).fill(0)), colors: white(pos.length / 3, alpha),
});
const orthoOpts = (w: number, h: number): RenderOptions => ({
  width: w, height: h, eye: [0, 0, 5], target: [0, 0, 0], ortho: { halfHeight: 1.25 }, near: 0.1, far: 10,
  background: [0, 0, 0], mipmaps: false, drawSkies: false,
});

// 3. Watertight fill rule: a jittered grid mesh drawn with alpha 0.5 must give exactly one blend per pixel.
{
  // 20x20 cells of 8 px, offset by half a pixel so unjittered vertices (a third of them, and the whole outline) sit
  // exactly on pixel centres. Jitter (<= 1.6 px per axis) is small enough to keep every cell convex (no fold-over).
  const N = 20, halfPx = 1.25 / 200, grid: [number, number][] = [];
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const fixed = i === 0 || j === 0 || i === N || j === N || (i * 7 + j * 3) % 3 === 0;
      const jx = fixed ? 0 : (rand() - 0.5) * 0.04, jy = fixed ? 0 : (rand() - 0.5) * 0.04;
      grid.push([-1 + (2 * i) / N + halfPx + jx, -1 + (2 * j) / N + halfPx + jy]);
    }
  }
  const pos: number[] = [];
  const P = (i: number, j: number) => [...grid[j * (N + 1) + i], 0];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      // Alternate diagonals; some triangles fans meet at pixel centres on purpose (axis-aligned edges).
      if ((i + j) & 1) pos.push(...P(i, j), ...P(i + 1, j), ...P(i + 1, j + 1), ...P(i, j), ...P(i + 1, j + 1), ...P(i, j + 1));
      else pos.push(...P(i, j), ...P(i + 1, j), ...P(i, j + 1), ...P(i + 1, j), ...P(i + 1, j + 1), ...P(i, j + 1));
    }
  }
  const W = 200, H = 200;
  const img = renderMeshes([{ name: 'grid', radius: 1, batches: [batch(pos, 'blend', 128)] }], [], orthoOpts(W, H));
  let bad = 0, covered = 0;
  const expect = Math.round((128 / 255) * 255);
  for (let i = 0; i < W * H; i++) {
    const v = img[i * 4];
    if (v === 0) continue;
    if (v === expect) covered++;
    else bad++;
  }
  // Square [-1,1] with halfHeight 1.25 over 200 px = 160x160 px.
  check('watertight blended mesh (no double hits / cracks)', bad === 0 && covered === 160 * 160, `covered ${covered}, bad ${bad}`);
}

// 4. Back-face culling honours CCW winding.
{
  const ccw = [-1, -1, 0, 1, -1, 0, 0, 1, 0];
  const cw = [-1, -1, 0, 0, 1, 0, 1, -1, 0];
  const count = (pos: number[], cull: boolean) => {
    const img = renderMeshes([{ name: 't', radius: 1, batches: [batch(pos, 'opaque')] }], [], { ...orthoOpts(64, 64), cull });
    let n = 0;
    for (let i = 0; i < 64 * 64; i++) if (img[i * 4]) n++;
    return n;
  };
  check('cull keeps CCW, drops CW', count(ccw, true) > 500 && count(cw, true) === 0 && count(cw, false) === count(ccw, true));
}

// 5. Near-plane clipping: a triangle through the camera covers the lower screen, no NaNs / throws.
{
  const pos = [-50, -1, 50, 50, -1, 50, 0, -1, -50];
  const img = renderMeshes([{ name: 'floor', radius: 1, batches: [batch(pos, 'opaque')] }], [], {
    width: 64, height: 64, eye: [0, 0, 0], target: [0, 0, -1], fovY: 60, near: 0.1, far: 1000, background: [0, 0, 0], drawSkies: false,
  });
  const row = (y: number) => { let n = 0; for (let x = 0; x < 64; x++) if (img[(y * 64 + x) * 4]) n++; return n; };
  check('near-plane clipping', row(63) === 64 && row(0) === 0, `bottom row ${row(63)}/64, top row ${row(0)}/64`);
}

// 6. Texture wrap + nearest sampling: 4x1 texture, quad uv -1..3 -> 16 texels across; check sequence per mode.
{
  const tex = (wrap: Texture['wrapS']): Texture => ({
    width: 4, height: 1, wrapS: wrap, wrapT: wrap, format: 'test',
    rgba: new Uint8Array([10, 0, 0, 255, 20, 0, 0, 255, 30, 0, 0, 255, 40, 0, 0, 255]),
  });
  const pos = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0];
  const uvs = [-1, 0.5, 3, 0.5, 3, 0.5, -1, 0.5, 3, 0.5, -1, 0.5];
  const expected: Record<string, number[]> = {
    repeat: [10, 20, 30, 40, 10, 20, 30, 40, 10, 20, 30, 40, 10, 20, 30, 40],
    mirror: [40, 30, 20, 10, 10, 20, 30, 40, 40, 30, 20, 10, 10, 20, 30, 40],
    clamp: [10, 10, 10, 10, 10, 20, 30, 40, 40, 40, 40, 40, 40, 40, 40, 40],
  };
  for (const mode of ['repeat', 'mirror', 'clamp'] as const) {
    const W = 160;
    const img = renderMeshes([{ name: 'q', radius: 1, batches: [batch(pos, 'opaque', 255, 0, uvs)] }], [tex(mode)], {
      width: W, height: 16, eye: [0, 0, 5], target: [0, 0, 0], ortho: { halfHeight: 1 }, near: 0.1, far: 10, filter: 'nearest', mipmaps: false,
    });
    // Orthographic halfHeight 1 with aspect 10: quad spans x in [-1, 1] of halfWidth 10 -> pixels 72..87.
    const got: number[] = [];
    for (let k = 0; k < 16; k++) got.push(img[(8 * W + 72 + k) * 4]);
    check(`wrap ${mode} (nearest)`, got.every((v, i) => v === expected[mode][i]), got.join(','));
  }
}

// 7. Cutout threshold at alpha 0.5 and opaque ignoring alpha.
{
  const pos = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0];
  const px = (blend: Batch['blend'], alpha: number) => renderMeshes([{ name: 'q', radius: 1, batches: [batch(pos, blend, alpha)] }], [], orthoOpts(8, 8))[(4 * 8 + 4) * 4];
  check('cutout alpha 127 discarded, 128 kept', px('cutout', 127) === 0 && px('cutout', 128) === 255);
  check('opaque ignores alpha', px('opaque', 0) === 255);
}

if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed');
