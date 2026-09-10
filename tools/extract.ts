// Dump every table file of the ROM, decompressed, to <outDir>/NNN.bin.
// usage: npx tsx tools/extract.ts rom.z64 outDir
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { RushRom } from '../src/rom/rom';

const [romPath, outDir] = process.argv.slice(2);
const rom = new RushRom(new Uint8Array(readFileSync(romPath)));
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/main.bin`, rom.main);
for (const f of rom.files) {
  const data = rom.file(f.index);
  const ok = data.length === f.size ? '' : `  SIZE MISMATCH (got ${data.length.toString(16)})`;
  console.log(`${String(f.index).padStart(3)} ${f.offset.toString(16).padStart(6, '0')} t${f.type} ${f.size.toString(16).padStart(6)}${ok}`);
  writeFileSync(`${outDir}/${String(f.index).padStart(3, '0')}.bin`, data);
}
