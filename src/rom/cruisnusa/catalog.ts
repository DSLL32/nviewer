// Cruis'n USA's catalog stores offsets relative to its own header.
export interface CruisnCatalogEntry {
  id: number;
  flags: number;
  decodedBytes: number;
  storedOffset: number;
  storedBytes: number;
  compressed: boolean;
}

export interface CruisnCatalog {
  rom: Uint8Array;
  base: number;
  entries: CruisnCatalogEntry[];
  entry(id: number): CruisnCatalogEntry;
  asset(id: number): Uint8Array;
}

const CATALOG_BASE = 0x80590;
const ASSET_END = 0x5c41f4;

function decodeRle(src: Uint8Array, length: number, unit: number): Uint8Array {
  const out = new Uint8Array(length);
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const highBit = 2 ** (8 * unit - 1);
  let input = 0;
  let output = 0;
  while (output < length) {
    if (input + unit > src.length) throw new Error('truncated Cruis\'n RLE token');
    const token = unit === 1 ? view.getUint8(input) : unit === 2 ? view.getUint16(input) : view.getUint32(input);
    input += unit;
    if (token >= highBit) {
      const run = (token - highBit + 3) * unit;
      if (input + unit > src.length || output + run > length) throw new Error('invalid Cruis\'n RLE run');
      for (let i = 0; i < run; i++) out[output + i] = src[input + i % unit];
      input += unit;
      output += run;
    } else {
      const run = (token + 1) * unit;
      if (input + run > src.length || output + run > length) throw new Error('invalid Cruis\'n RLE literal');
      out.set(src.subarray(input, input + run), output);
      input += run;
      output += run;
    }
  }
  return out;
}

export function parseCatalog(rom: Uint8Array): CruisnCatalog {
  const code = String.fromCharCode(...rom.subarray(0x3b, 0x3f));
  if (rom.length !== 0x800000 || code !== 'NCUE' || rom[0x3f] !== 0)
    throw new Error(`unsupported Cruis'n USA ROM ${code} revision ${rom[0x3f]}`);
  const base = CATALOG_BASE;
  const end = ASSET_END;
  const view = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
  const count = view.getUint32(base);
  if (count !== 0x30e6) throw new Error('invalid Cruis\'n USA catalog count');
  const tableEnd = base + 4 + count * 8;
  const entries: CruisnCatalogEntry[] = [];
  for (let id = 0; id < count; id++) {
    const at = base + 4 + id * 8;
    const descriptor = view.getUint32(at);
    const pointer = view.getUint32(at + 4);
    const storedOffset = base + (pointer & 0xffffff);
    entries.push({
      id,
      flags: descriptor >>> 24,
      decodedBytes: descriptor & 0xfffff,
      storedOffset,
      storedBytes: 0,
      compressed: (descriptor & 0x80000000) !== 0,
    });
  }
  // Asset IDs are not in physical ROM order near the end of the catalog.
  const byOffset = [...entries].sort((a, b) => a.storedOffset - b.storedOffset);
  if (byOffset[0].storedOffset !== tableEnd) throw new Error('Cruis\'n USA catalog data does not follow its table');
  for (let i = 0; i < count; i++) {
    const entry = byOffset[i];
    const next = i + 1 < count ? byOffset[i + 1].storedOffset : end;
    const id = entry.id;
    if (next <= entry.storedOffset || next > end) throw new Error(`invalid Cruis'n USA asset extent ${id}`);
    entry.storedBytes = next - entry.storedOffset;
    if (!entry.compressed && entry.decodedBytes > entry.storedBytes)
      throw new Error(`truncated Cruis'n USA asset ${id}`);
  }
  return {
    rom,
    base,
    entries,
    entry(id) {
      if (!Number.isInteger(id) || id < 0 || id >= entries.length) throw new Error(`Cruis'n USA asset ID ${id} is out of range`);
      return entries[id];
    },
    asset(id) {
      const entry = this.entry(id);
      const bytes = rom.subarray(entry.storedOffset, entry.storedOffset + entry.storedBytes);
      if (!entry.compressed) return bytes.subarray(0, entry.decodedBytes);
      const unit = ({ 2: 1, 3: 2, 4: 4 } as Record<number, number>)[entry.flags & 15];
      if (!unit) throw new Error(`unknown Cruis'n USA RLE unit in asset ${id}`);
      return decodeRle(bytes, entry.decodedBytes, unit);
    },
  };
}
