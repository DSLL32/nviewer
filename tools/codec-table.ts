/** Rebuild the reference codecs and compare each with its largest indexed ROM stream.
 * Usage: npm run bench:codecs -- --jobs 4 [--only vpk0]
 * ROMs are read from NVIEWER_ROMS (default: /data/software/ai-scratch).
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const romDir = process.env.NVIEWER_ROMS ?? '/data/software/ai-scratch';
type Sample = { codec: string; game: string; rom: string; offset: number;
  retail: number; decoded: number; scope: string };

// Largest verified stream in the named game's complete index, or across the
// named games when a codec is shared. `retail` excludes archive alignment.
const samples: Sample[] = [
  { codec: 'mio0', game: 'Star Fox 64 U 1.1', rom: 'Star Fox 64 (U) (V1.1) [!].z64', offset: 0xA88180, retail: 191968, decoded: 396960, scope: 'SF64/MK64/Pilotwings indexes' },
  { codec: 'yaz0', game: "Majora's Mask U", rom: "Legend of Zelda, The - Majora's Mask (U) [!].z64", offset: 0xA684D0, retail: 778426, decoded: 1303776, scope: 'OoT/MM dmadata' },
  { codec: 'yay0', game: 'Bomberman 64: Second Attack', rom: 'Bomberman 64 - The Second Attack! (U) [!].z64', offset: 0xCC8C5E, retail: 53744, decoded: 100348, scope: 'resource archive' },
  { codec: 'hudson1', game: 'Bomberman 64: Second Attack', rom: 'Bomberman 64 - The Second Attack! (U) [!].z64', offset: 0xC3D07C, retail: 85765, decoded: 86116, scope: 'Bomberman 64/Second Attack archives' },
  { codec: 'hudson4', game: 'Bomberman Hero', rom: 'Bomberman Hero (U) [!].z64', offset: 0x585F00, retail: 115616, decoded: 445376, scope: 'Hero archive chains' },
  { codec: 'rnc1', game: "A Bug's Life", rom: "Bug's Life, A (U) [!].z64", offset: 0x1B1C68, retail: 179193, decoded: 268368, scope: 'five regional manifests' },
  { codec: 'rnc2', game: "A Bug's Life", rom: "Bug's Life, A (U) [!].z64", offset: 0x5617E8, retail: 22456, decoded: 33344, scope: 'five regional manifests' },
  { codec: 'lh5', game: 'Air Boarder 64 J', rom: 'Airboarder 64 (J) [!].z64', offset: 0x56A8F4, retail: 583156, decoded: 1271176, scope: 'J/P compressed archives' },
  { codec: 'erz2', game: 'Spider-Man', rom: 'Spider-Man (U) [!].z64', offset: 0x63218, retail: 35513, decoded: 65536, scope: 'boot blocks and archive leaves' },
  { codec: 'vpk0', game: 'Pokémon Snap', rom: 'Pokemon Snap (U) [!].z64', offset: 0xA0F830, retail: 316438, decoded: 997232, scope: 'three verified streams' },
  { codec: 'rare1172', game: 'GoldenEye 007', rom: 'GoldenEye 007 (U) [!].z64', offset: 0x21990, retail: 71760, decoded: 247120, scope: 'valid ROM tags' },
  { codec: 'rare1172-u32', game: 'Banjo-Kazooie U 1.0', rom: 'Banjo-Kazooie (U) (V1.0) [!].z64', offset: 0x9981C8, retail: 231555, decoded: 495668, scope: 'U 1.0 asset table' },
  { codec: 'rare1173', game: 'Perfect Dark', rom: 'Perfect Dark (U) (V1.0) [!].z64', offset: 0x3050, retail: 178722, decoded: 356240, scope: 'valid ROM tags' },
  { codec: 'rare-dkr', game: 'Jet Force Gemini U', rom: 'Jet Force Gemini (U) [!].z64', offset: 0xEEE9C0, retail: 93982, decoded: 197440, scope: 'JFG U screen/scene/model tables (1,207 streams)' },
  { codec: 'raw-deflate', game: 'Rush 2049', rom: 'San Francisco Rush 2049 (U) [!].z64', offset: 0x6E3080, retail: 714357, decoded: 1578064, scope: 'Rush 2049/Gex file indexes and main images' },
  { codec: 'chunked-zlib', game: 'Stunt Racer 64', rom: 'Stunt Racer 64 (U) [!].z64', offset: 0x3885A0, retail: 301186, decoded: 737520, scope: 'all 2,211 valid containers' },
  { codec: 'boss-pattern', game: 'Stunt Racer 64', rom: 'Stunt Racer 64 (U) [!].z64', offset: 0xBC4238, retail: 9883, decoded: 34240, scope: 'all 14 music pattern streams' },
  { codec: 'fla2', game: 'Glover', rom: 'Glover (U) [!].z64', offset: 0x1B0AC0, retail: 218194, decoded: 689628, scope: 'all 76 indexed banks' },
  { codec: 'rush1-lzss', game: 'San Francisco Rush', rom: 'San Francisco Rush - Extreme Racing (U) (M3) [!].z64', offset: 0x2354C0, retail: 570270, decoded: 1052128, scope: 'Rush 1 A/B pointers and main image' },
  { codec: 'rush2049-lzss', game: 'Rush 2049', rom: 'San Francisco Rush 2049 (U) [!].z64', offset: 0x399370, retail: 90821, decoded: 219288, scope: 'Rush 2049 type-1 file table' },
  { codec: 'cmpr', game: "Yoshi's Story", rom: 'Yoshi Story (J) [!].z64', offset: 0x7F3E70, retail: 163042, decoded: 230144, scope: 'all 702 CMPR records' },
  { codec: 'lzari', game: 'BattleTanx', rom: 'BattleTanx (U) [!].z64', offset: 0x4E46E0, retail: 168526, decoded: 284096, scope: 'BattleTanx/Global Assault file indexes' },
];

const cpp = ['mio0', 'yaz0', 'yay0', 'rush_lzss', 'smsr', 'rnc', 'airboarder_lh5', 'vpk0', 'erz2', 'boss_pattern', 'fla2'];
const c = ['lzari', 'deflate', 'chunked_zlib'];
function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} failed:\n${result.stderr || result.stdout}`);
}

function args(): { jobs: number; only: string } {
  let jobs = 1, only = '';
  const words = process.argv.slice(2);
  for (let i = 0; i < words.length; i++) {
    if (words[i] === '--jobs') jobs = Number(words[++i]);
    else if (words[i] === '--only') only = words[++i]?.toLowerCase() ?? '';
    else throw new Error(`unknown option: ${words[i]}`);
  }
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > 4) throw new Error('--jobs must be 1–4');
  return { jobs, only };
}

function measure(binary: string, sample: Sample): Promise<{ sample: Sample; packed: number; seconds: number }> {
  return new Promise((fulfill, reject) => {
    const path = resolve(romDir, sample.rom);
    const child = spawn(binary, [sample.codec, path, String(sample.offset),
      String(sample.retail), String(sample.decoded)]);
    let out = '', err = '';
    child.stdout.setEncoding('utf8').on('data', (part: string) => out += part);
    child.stderr.setEncoding('utf8').on('data', (part: string) => err += part);
    child.on('error', reject);
    child.on('close', (status) => {
      if (status !== 0) { reject(new Error(`${sample.codec} ${sample.game}: ${err || `exit ${status}`}`)); return; }
      const fields = out.trim().split(/\s+/).map(Number);
      if (fields.length !== 4 || fields[0] !== sample.retail || fields[1] !== sample.decoded ||
          !Number.isFinite(fields[2]) || !Number.isFinite(fields[3])) {
        reject(new Error(`bad result for ${sample.codec}: ${out}`)); return;
      }
      fulfill({ sample, packed: fields[2], seconds: fields[3] });
    });
  });
}

async function main(): Promise<void> {
  const { jobs, only } = args();
  const selected = samples.filter((s) => !only || `${s.codec} ${s.game}`.toLowerCase().includes(only));
  if (!selected.length) throw new Error(`no samples match ${only}`);
  const scratch = mkdtempSync(join(homedir(), '.ai-tmp', 'codec-table-'));
  try {
    for (const name of c) run('gcc', ['-O3', '-std=c11', '-c', `codecs/${name}.c`, '-o', join(scratch, `${name}.o`)]);
    const binary = join(scratch, 'codec-table');
    run('g++', ['-O3', '-std=c++17', 'tools/codec-table.cpp',
      ...cpp.map((name) => `codecs/${name}.cpp`), ...c.map((name) => join(scratch, `${name}.o`)),
      '-lz', '-o', binary]);
    const results: Awaited<ReturnType<typeof measure>>[] = Array(selected.length);
    let next = 0;
    let failure: unknown;
    await Promise.all(Array.from({ length: Math.min(jobs, selected.length) }, async () => {
      while (!failure) {
        const index = next++;
        if (index >= selected.length) return;
        try { results[index] = await measure(binary, selected[index]); }
        catch (error) { failure = error; }
      }
    }));
    if (failure) throw failure;
    results.sort((a, b) => (a.packed / a.sample.retail) - (b.packed / b.sample.retail));
    console.log('| Format / largest indexed sample | Retail bytes | Decoded bytes | Our bytes | Change | Encode time |');
    console.log('|---|---:|---:|---:|---:|---:|');
    for (const { sample, packed, seconds } of results) {
      const change = (packed - sample.retail) / sample.retail * 100;
      const label = `${sample.codec} — ${sample.game} @ 0x${sample.offset.toString(16).toUpperCase()}`;
      console.log(`| ${label} | ${sample.retail.toLocaleString('en-US')} | ${sample.decoded.toLocaleString('en-US')} | ${packed.toLocaleString('en-US')} | ${change >= 0 ? '+' : ''}${change.toFixed(2)}% | ${seconds.toFixed(2)} s |`);
    }
    console.log('\nRetail bytes exclude archive alignment; each chosen stream is the largest in the audited indexes named in the script. All repacks decoded byte-for-byte.');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
