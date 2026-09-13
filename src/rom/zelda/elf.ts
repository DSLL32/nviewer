// Materialization of the big-endian ELF32 MIPS REL objects retained in the bbgames source trees. Only the section,
// symbol and R_MIPS_32 machinery used by the Zelda data objects is accepted.
export interface ElfSymbol {
  name: string;
  value: number;
  size: number;
  section: number;
  bind: number;
  type: number;
}

export interface ZeldaElf {
  path: string;
  dataSection: number;
  data: Uint8Array;
  symbols: ElfSymbol[];
  relocations: { offset: number; symbol: number }[];
}

const MAX_ELF_BYTES = 128 << 20;
const MAX_SECTION_BYTES = 64 << 20;
const MAX_SECTION_TABLE_BYTES = 4 << 20;

const readName = (table: Uint8Array, at: number) => {
  if (at < 0 || at >= table.length) return '';
  let end = at;
  while (end < table.length && table[end] !== 0) end++;
  return new TextDecoder().decode(table.subarray(at, end));
};

export function parseZeldaElf(path: string, bytes: Uint8Array): ZeldaElf {
  const fail = (why: string): never => { throw new Error(`${path}: ${why}`); };
  if (bytes.length > MAX_ELF_BYTES) fail(`implausibly large ELF (${bytes.length} bytes)`);
  if (bytes.length < 52 || bytes[0] !== 0x7f || bytes[1] !== 0x45 || bytes[2] !== 0x4c || bytes[3] !== 0x46) fail('not an ELF file');
  if (bytes[4] !== 1 || bytes[5] !== 2) fail('expected big-endian ELF32');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint16(16) !== 1 || v.getUint16(18) !== 8) fail('expected a relocatable MIPS ELF');
  const shoff = v.getUint32(32), shentsize = v.getUint16(46), shnum = v.getUint16(48), shstrndx = v.getUint16(50);
  const sectionTableSize = shentsize * shnum;
  if (shentsize < 40 || shnum === 0 || shnum > 4096 || sectionTableSize > MAX_SECTION_TABLE_BYTES || shoff + sectionTableSize > bytes.length || shstrndx >= shnum) fail('invalid section table');
  type Section = { nameAt: number; type: number; off: number; size: number; link: number; info: number; entsize: number };
  const sections: Section[] = [];
  for (let i = 0; i < shnum; i++) {
    const o = shoff + i * shentsize;
    sections.push({ nameAt: v.getUint32(o), type: v.getUint32(o + 4), off: v.getUint32(o + 16), size: v.getUint32(o + 20), link: v.getUint32(o + 24), info: v.getUint32(o + 28), entsize: v.getUint32(o + 36) });
  }
  const slice = (s: Section, label: string) => {
    if (s.size > MAX_SECTION_BYTES) fail(`${label} section is implausibly large (${s.size} bytes)`);
    if (s.type === 8) return new Uint8Array(s.size);
    if (s.off + s.size > bytes.length) fail(`${label} section exceeds the file`);
    return bytes.slice(s.off, s.off + s.size);
  };
  const shstr = slice(sections[shstrndx], 'section-name');
  const names = sections.map((s) => readName(shstr, s.nameAt));
  const dataSection = names.indexOf('.data');
  if (dataSection < 0) fail('has no .data section');
  if (sections[dataSection].type !== 1) fail('.data is not a PROGBITS section');
  const symSection = sections.findIndex((s) => s.type === 2);
  if (symSection < 0) fail('has no symbol table');
  const symtab = sections[symSection];
  if (symtab.link >= sections.length || (symtab.entsize || 16) < 16 || symtab.size % (symtab.entsize || 16)) fail('invalid symbol table');
  const strtab = slice(sections[symtab.link], 'symbol-name');
  const symbols: ElfSymbol[] = [];
  const symEnt = symtab.entsize || 16;
  if (symtab.off + symtab.size > bytes.length) fail('symbol table exceeds the file');
  for (let o = symtab.off; o < symtab.off + symtab.size; o += symEnt) {
    const info = bytes[o + 12];
    symbols.push({ name: readName(strtab, v.getUint32(o)), value: v.getUint32(o + 4), size: v.getUint32(o + 8), bind: info >>> 4, type: info & 15, section: v.getUint16(o + 14) });
  }
  const dataSize = sections[dataSection].size;
  for (const symbol of symbols) if (symbol.section === dataSection && (symbol.value > dataSize || symbol.size > dataSize - symbol.value)) {
    fail(`.data symbol ${symbol.name || '<unnamed>'} exceeds .data`);
  }
  const relocations: ZeldaElf['relocations'] = [];
  for (const s of sections) {
    if (s.type !== 9 || s.info !== dataSection) continue;
    const ent = s.entsize || 8;
    if (ent < 8 || s.size % ent || s.off + s.size > bytes.length) fail('invalid .data relocation section');
    for (let o = s.off; o < s.off + s.size; o += ent) {
      const info = v.getUint32(o + 4), type = info & 0xff, symbol = info >>> 8;
      if (type !== 2) fail(`unsupported MIPS relocation type ${type} at 0x${v.getUint32(o).toString(16)}`);
      if (symbol >= symbols.length) fail('relocation references an invalid symbol');
      relocations.push({ offset: v.getUint32(o), symbol });
    }
  }
  return { path, dataSection, data: slice(sections[dataSection], '.data'), symbols, relocations };
}

export interface ElfDefinition { elf: ZeldaElf; symbol: ElfSymbol; segment: number }

export function materializeZeldaElf(
  elf: ZeldaElf,
  segment: number,
  definitions: Map<string, ElfDefinition>,
  absolute: Map<string, number> = new Map(),
): Uint8Array {
  const out = elf.data.slice(), v = new DataView(out.buffer);
  for (const r of elf.relocations) {
    if (r.offset + 4 > out.length) throw new Error(`${elf.path}: relocation at 0x${r.offset.toString(16)} exceeds .data`);
    const sym = elf.symbols[r.symbol];
    const injected = absolute.get(sym.name);
    let value: number;
    if (injected !== undefined) value = injected;
    else {
      let def: ElfDefinition | undefined;
      if (sym.section === elf.dataSection) def = { elf, symbol: sym, segment };
      else if (sym.section === 0) def = definitions.get(sym.name);
      else throw new Error(`${elf.path}: relocation to ${sym.name || `symbol ${r.symbol}`} outside .data`);
      if (!def) {
        // Common game assets are intentionally absent in source mode. A null pointer makes the display-list
        // resolver fail softly rather than accidentally interpreting the relocation addend as local data.
        v.setUint32(r.offset, 0);
        continue;
      }
      value = ((def.segment << 24) | def.symbol.value) >>> 0;
    }
    v.setUint32(r.offset, (v.getUint32(r.offset) + value) >>> 0);
  }
  return out;
}

export function collectElfDefinitions(elves: { elf: ZeldaElf; segment: number }[]): Map<string, ElfDefinition> {
  const out = new Map<string, ElfDefinition>();
  for (const e of elves) for (const s of e.elf.symbols) {
    if (s.section !== e.elf.dataSection || !s.name || s.bind === 0) continue;
    if (!out.has(s.name)) out.set(s.name, { elf: e.elf, symbol: s, segment: e.segment });
  }
  return out;
}
