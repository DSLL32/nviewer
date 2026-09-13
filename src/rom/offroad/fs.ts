// Off Road Challenge (U/E): raw 41-file table and bounded KSEG0 resolver.
// Files are copied verbatim to their default destinations; pointers inside the
// European files are rebased by +0x80, so all higher-level parsing is address based.

export interface OffroadVersion {
  code: 'NOFE' | 'NOFP';
  region: 'US' | 'Europe';
  fileTable: number;
  rootTable: number;
  optionalIds: number;
  mainIds: number;
  crc1: number;
  crc2: number;
}

export interface AssetFile {
  id: number;
  romStart: number;
  romEnd: number;
  destination: number;
  flags: number;
}

export interface AddressSource {
  file: AssetFile;
  offset: number;
}

const VERSION_BY_CODE: Record<string, OffroadVersion | undefined> = {
  NOFE: { code: 'NOFE', region: 'US', fileTable: 0x6e310, rootTable: 0x6ed24, optionalIds: 0x83388, mainIds: 0x833ac, crc1: 0x319093ec, crc2: 0x0fc209ef },
  NOFP: { code: 'NOFP', region: 'Europe', fileTable: 0x6e390, rootTable: 0x6eda4, optionalIds: 0x83408, mainIds: 0x8342c, crc1: 0x812289d0, crc2: 0xc2e53296 },
};

const hex = (n: number) => `0x${(n >>> 0).toString(16)}`;

export class OffroadImage {
  constructor(readonly rom: Uint8Array, readonly files: AssetFile[]) {}

  source(address: number, size = 1): AddressSource {
    address >>>= 0;
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`invalid Off Road Challenge read size ${size}`);
    let found: AddressSource | null = null;
    for (const file of this.files) {
      const length = file.romEnd - file.romStart;
      if (address >= file.destination && address + size <= file.destination + length) {
        if (found) throw new Error(`ambiguous Off Road Challenge address ${hex(address)}+${hex(size)}`);
        found = { file, offset: file.romStart + address - file.destination };
      }
    }
    if (!found) throw new Error(`unmapped Off Road Challenge address ${hex(address)}+${hex(size)}`);
    return found;
  }

  contains(address: number, size = 1): boolean {
    try { this.source(address, size); return true; } catch { return false; }
  }

  u8(address: number): number { return this.rom[this.source(address).offset]; }
  u16(address: number): number { return this.view(address, 2).getUint16(0); }
  u32(address: number): number { return this.view(address, 4).getUint32(0); }
  s32(address: number): number { return this.view(address, 4).getInt32(0); }
  f32(address: number): number { return this.view(address, 4).getFloat32(0); }
  view(address: number, size: number): DataView {
    const { offset } = this.source(address, size);
    return new DataView(this.rom.buffer, this.rom.byteOffset + offset, size);
  }
}

export class OffroadRom {
  readonly version: OffroadVersion;
  readonly files: AssetFile[];
  private readonly dv: DataView;

  constructor(readonly rom: Uint8Array) {
    this.dv = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
    if (rom.length !== 0x1000000) throw new Error(`unsupported Off Road Challenge ROM size ${hex(rom.length)} (expected 16 MiB)`);
    const magic = this.word(0);
    if (magic !== 0x80371240) throw new Error('Off Road Challenge ROM must be normalized to big-endian byte order');
    const code = String.fromCharCode(...rom.subarray(0x3b, 0x3f));
    const version = VERSION_BY_CODE[code];
    if (!version) throw new Error(`unsupported Off Road Challenge ROM code ${code}`);
    if (rom[0x3f] !== 0) throw new Error(`unsupported Off Road Challenge revision ${rom[0x3f]} (expected revision 0)`);
    const title = String.fromCharCode(...rom.subarray(0x20, 0x34)).replace(/\0/g, '').trim();
    if (title !== 'OFFROAD') throw new Error(`invalid Off Road Challenge internal title ${JSON.stringify(title)}`);
    if (this.word(0x10) !== version.crc1 || this.word(0x14) !== version.crc2)
      throw new Error(`unsupported Off Road Challenge ${version.region} dump (header CRC mismatch)`);
    this.version = version;

    const files: AssetFile[] = [];
    for (let id = 0; id < 41; id++) {
      const p = version.fileTable + id * 16;
      const file = { id, romStart: this.word(p), romEnd: this.word(p + 4), destination: this.word(p + 8), flags: this.word(p + 12) };
      if (file.flags !== 0) throw new Error(`Off Road Challenge file ${id} has unsupported flags ${hex(file.flags)}`);
      if (file.romStart > file.romEnd || file.romEnd > rom.length)
        throw new Error(`Off Road Challenge file ${id} has invalid ROM range ${hex(file.romStart)}-${hex(file.romEnd)}`);
      if (file.destination < 0x80000000 || file.destination + file.romEnd - file.romStart > 0x80800000)
        throw new Error(`Off Road Challenge file ${id} has invalid destination ${hex(file.destination)}`);
      files.push(file);
    }
    const physical = [...files].sort((a, b) => a.romStart - b.romStart);
    for (let i = 1; i < physical.length; i++) if (physical[i - 1].romEnd !== physical[i].romStart)
      throw new Error(`Off Road Challenge asset table gap/overlap before file ${physical[i].id}`);
    this.files = files;
  }

  private word(offset: number): number {
    return this.dv.getUint32(offset);
  }

  trackImage(index: number): { image: OffroadImage; root: number; fileIds: number[] } {
    if (!Number.isInteger(index) || index < 0 || index >= 9) throw new Error(`invalid Off Road Challenge track ${index}`);
    const optional = this.dv.getInt32(this.version.optionalIds + index * 4);
    const main = this.dv.getInt32(this.version.mainIds + index * 4);
    if (optional < -1 || optional >= this.files.length || main < 0 || main >= this.files.length)
      throw new Error(`invalid Off Road Challenge track file IDs ${optional}/${main}`);
    const fileIds = optional < 0 ? [main] : [optional, main];
    const root = this.word(this.version.rootTable + index * 4);
    const image = new OffroadImage(this.rom, fileIds.map((id) => this.files[id]));
    if (!image.contains(root, 0x4c)) throw new Error(`invalid Off Road Challenge track ${index} root ${hex(root)}`);
    return { image, root, fileIds };
  }
}
