// Parse every level and print summary stats; optionally write a texture contact
// sheet per level as PNG.
// usage: npx tsx tools/levelstats.ts rom.z64 [sheetDir]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { RushRom } from '../src/rom/rom';
import { LEVELS, loadLevel, type Level } from '../src/rom/level';

const [romPath, sheetDir] = process.argv.slice(2);
const rom = new RushRom(new Uint8Array(readFileSync(romPath)));
if (sheetDir) mkdirSync(sheetDir, { recursive: true });

for (const info of LEVELS) {
  const t0 = performance.now();
  const level = loadLevel(rom, info.index);
  const ms = (performance.now() - t0).toFixed(0);
  let tris = 0, batches = 0;
  const modes = new Map<string, number>();
  for (const m of level.meshes) for (const b of m.batches) {
    batches++;
    const n = b.positions.length / 9;
    tris += n;
    const k = `${b.blend}${b.texture < 0 ? '-untex' : ''}${b.depthTest ? '' : '-noZ'}`;
    modes.set(k, (modes.get(k) ?? 0) + n);
  }
  const missing = new Map<string, number>();
  for (const i of level.instances) if (i.mesh < 0) missing.set(i.name, (missing.get(i.name) ?? 0) + 1);
  const b = level.bounds;
  console.log(`${String(info.index).padStart(2)} ${info.name.padEnd(16)} id=${level.id.padEnd(10)} ${ms}ms meshes=${level.meshes.length} batches=${batches} tris=${tris} textures=${level.textures.length} instances=${level.instances.length} unplaced=[${level.unplaced.map((i) => level.meshes[i].name).join(',')}]`);
  console.log(`     bounds ${b.min.map((v) => v.toFixed(0))} .. ${b.max.map((v) => v.toFixed(0))}  modes ${JSON.stringify(Object.fromEntries(modes))}`);
  console.log(`     not in level file: ${JSON.stringify(Object.fromEntries(missing))}`);
  if (sheetDir) writeFileSync(`${sheetDir}/${String(info.index).padStart(2, '0')}.png`, contactSheet(level));
}

function contactSheet(level: Level): Buffer {
  const cell = 128, cols = 16;
  const rows = Math.max(1, Math.ceil(level.textures.length / cols));
  const w = cell * cols, h = cell * rows;
  const px = new Uint8Array(w * h * 4);
  level.textures.forEach((t, i) => {
    const ox = (i % cols) * cell, oy = Math.floor(i / cols) * cell;
    for (let y = 0; y < Math.min(cell, t.height); y++)
      for (let x = 0; x < Math.min(cell, t.width); x++) {
        const s = (y * t.width + x) * 4, d = ((oy + y) * w + ox + x) * 4;
        const a = t.rgba[s + 3] / 255;
        const bg = ((x >> 3) + (y >> 3)) & 1 ? 200 : 120;
        for (let c = 0; c < 3; c++) px[d + c] = t.rgba[s + c] * a + bg * (1 - a);
        px[d + 3] = 255;
      }
  });
  return png(w, h, px);
}

function png(w: number, h: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const chunk = (type: string, data: Buffer) => {
    const td = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of td) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const c = Buffer.alloc(4); c.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
