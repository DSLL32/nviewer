// Focused integration check for bbgames source objects. Usage: npm run check:zelda-source -- [bbgames root].
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { materializeZeldaElf, parseZeldaElf } from '../src/rom/zelda/elf';
import { openZeldaSource, type ZeldaSourceFile } from '../src/rom/zelda/source';
import { selectZeldaSourceTree, ZELDA_SOURCE_ALTERNATIVES, ZELDA_SOURCE_LEVELS, ZELDA_SOURCE_PATHS } from '../src/rom/zelda/sourceManifest';

const root = process.argv[2] ?? process.env.BBGAMES_ROOT ?? '/home/n64/bbgames';

async function isDirectory(path: string) {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}

const names: string[] = [];
for (const name of ['z_ocarina2', 'z_ocarina']) if (await isDirectory(join(root, name))) names.push(name);
const tree = selectZeldaSourceTree(names);
let wrongRootRejected = false;
try { selectZeldaSourceTree(['data', 'src']); } catch { wrongRootRejected = true; }
if (!wrongRootRejected) throw new Error('wrong bbgames root was accepted');

const files: ZeldaSourceFile[] = [];
const usedAlternatives: string[] = [];
for (const path of ZELDA_SOURCE_PATHS) {
  let b: Awaited<ReturnType<typeof readFile>> | null = null;
  let lastError: unknown;
  for (const candidate of [path, ...(ZELDA_SOURCE_ALTERNATIVES[path] ?? [])]) {
    try {
      b = await readFile(join(root, tree, candidate));
      if (candidate !== path) usedAlternatives.push(`${path} <- ${candidate}`);
      break;
    } catch (e) {
      lastError = e;
    }
  }
  if (!b) throw lastError;
  files.push({ path, bytes: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer });
}
if (files.length !== new Set(files.map((f) => f.path)).size) throw new Error('manifest contains duplicate paths');

// One local .data relocation is enough to distinguish materialization from mere .data extraction.
const relocationFixture = files.find((f) => f.path === 'data/Ddanh_ROOM0.o')!;
const elf = parseZeldaElf(relocationFixture.path, new Uint8Array(relocationFixture.bytes));
const materialized = materializeZeldaElf(elf, 3, new Map(), new Map());
const relocated = new DataView(materialized.buffer, materialized.byteOffset, materialized.byteLength).getUint32(0x2c);
if (relocated !== 0x03000040) throw new Error(`R_MIPS_32 fixture produced 0x${relocated.toString(16)}, expected 0x03000040`);

const game = openZeldaSource(files, tree);
if (game.levels.length !== ZELDA_SOURCE_LEVELS.length) throw new Error(`opened ${game.levels.length} levels, expected ${ZELDA_SOURCE_LEVELS.length}`);

// The normal tree contains both forms, so explicitly substitute the fallback once and verify its tool_data symbol
// materializes to the same supported source level.
const toolPath = 'data/shape2/zelda_tool_rom/tool_data.o';
const toolAlternative = ZELDA_SOURCE_ALTERNATIVES[toolPath]?.[0];
if (toolAlternative) {
  const b = await readFile(join(root, tree, toolAlternative));
  const replacement = { path: toolPath, bytes: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer };
  const fallbackGame = openZeldaSource(files.map((f) => f.path === toolPath ? replacement : f), tree);
  const toolIndex = ZELDA_SOURCE_LEVELS.findIndex((l) => l.mode === 'tool-rom');
  if (!fallbackGame.loadLevel(toolIndex).layers?.some((l) => l.kind === 'collision')) throw new Error(`${toolAlternative}: fallback tool_data level has no collision layer`);
  usedAlternatives.push(`fallback test ${toolPath} <- ${toolAlternative}`);
}

const collect = (value: unknown) => {
  const out = new Set<ArrayBuffer>();
  const seen = new Set<object>();
  const visit = (v: unknown) => {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (ArrayBuffer.isView(v)) {
      if (v.buffer instanceof ArrayBuffer && v.byteOffset === 0 && v.byteLength === v.buffer.byteLength) out.add(v.buffer);
      return;
    }
    for (const child of Object.values(v)) visit(child);
  };
  visit(value);
  return [...out];
};

let triangles = 0;
for (const info of game.levels) {
  const level = game.loadLevel(info.index);
  if (!level.instances.length) throw new Error(`${info.name}: produced no instances`);
  const owned = new Set(level.layers?.flatMap((l) => l.instances) ?? []);
  for (let i = 0; i < level.instances.length; i++) if (!owned.has(i)) throw new Error(`${info.name}: instance ${i} has no layer`);
  for (const layer of level.layers ?? []) if (layer.kind === 'collision' && layer.visibleByDefault !== false) throw new Error(`${info.name}: collision layer is visible by default`);
  triangles += level.meshes.reduce((n, m) => n + m.batches.reduce((q, b) => q + b.positions.length / 9, 0), 0);
  for (let pass = 0; pass < 2; pass++) {
    const fresh = game.loadLevel(info.index);
    structuredClone(fresh, { transfer: collect(fresh) });
  }
}
if (!triangles) throw new Error('source levels produced no geometry');
console.log(`Zelda source check passed: ${game.levels.length} levels from ${tree}, ${files.length} allowlisted files, ${Math.round(triangles).toLocaleString()} triangles; ${usedAlternatives.length} alternative-path check(s).`);
