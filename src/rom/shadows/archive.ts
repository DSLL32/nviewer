import { decodeIntroLzss, decodeLzhuf } from './codecs';

export interface ShadowsScene {
  index: number;
  name: string;
  kind: 'gameplay' | 'cutscene' | 'menu';
  storedStart: number;
  storedEnd: number;
}

const be32 = (data: Uint8Array, at: number) =>
  ((data[at] * 0x1000000) + (data[at + 1] << 16) + (data[at + 2] << 8) + data[at + 3]) >>> 0;
const ascii = (data: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...data.subarray(start, end)).split('\0', 1)[0];

const GAMEPLAY_IDS = new Set([3, 4, 5, 6, 8, 10, 14, 15, 17, 20, 21, 22, 25, 26, 27, 29, 30]);

export class ShadowsArchive {
  readonly region: string;
  readonly revision: number;
  readonly scenes: ShadowsScene[];
  private readonly code: Uint8Array;
  private readonly length: Uint8Array;

  constructor(readonly rom: Uint8Array) {
    if (rom.length !== 0xc00000 || be32(rom, 0) !== 0x80371240)
      throw new Error('Shadows of the Empire requires a normalized 12 MiB ROM');
    const gameCode = ascii(rom, 0x3b, 0x3f);
    this.revision = rom[0x3f];
    if (gameCode === 'NSWE' && this.revision <= 2) this.region = 'U';
    else if (gameCode === 'NSWP' && this.revision === 0) this.region = 'E';
    else throw new Error(`unsupported Shadows of the Empire release ${gameCode} revision ${this.revision}`);

    // The Ogre directory moves between USA and Europe. Find it in the small
    // uncompressed preamble, then validate its members before trusting offsets.
    let root = -1;
    for (let at = 0x1000; at + 4 <= 0x3000; at += 0x10) {
      if (ascii(rom, at, at + 4) === 'Ogre') {
        if (root >= 0) throw new Error('ambiguous Shadows Ogre root');
        root = at;
      }
    }
    if (root < 0 || root + 0x940 > rom.length) throw new Error('Shadows Ogre root not found');
    if (be32(rom, root + 4) !== 0x10000001) throw new Error('unsupported Shadows Ogre directory version');
    const mainStart = be32(rom, root + 8);
    const mainEnd = be32(rom, root + 0xc);
    const firstScene = be32(rom, root + 0x2c);
    if (mainStart < root + 0x940 + 0x200 || mainEnd <= mainStart || mainEnd >= firstScene || firstScene >= rom.length)
      throw new Error('invalid Shadows Ogre resource bounds');
    // The pair of 256-byte position tables precedes the main stream, but the
    // intervening padding varies by revision. Locate their characteristic
    // prefix-code lengths instead of assuming a fixed displacement.
    let table = -1;
    for (let at = mainStart - 0x300; at + 0x200 <= mainStart; at += 4) {
      const lengths = rom.subarray(at + 0x100, at + 0x200);
      if (lengths[0] !== 3 || lengths[32] !== 4 || lengths[80] !== 5 ||
          lengths[144] !== 6 || lengths[192] !== 7 || lengths[240] !== 8) continue;
      let valid = true;
      for (let i = 0; i < 256; i++) {
        const expected = i < 32 ? 3 : i < 80 ? 4 : i < 144 ? 5 : i < 192 ? 6 : i < 240 ? 7 : 8;
        if (lengths[i] !== expected || rom[at + i] > 63 || (i && rom[at + i] < rom[at + i - 1])) {
          valid = false;
          break;
        }
      }
      if (!valid) continue;
      if (table >= 0) throw new Error('ambiguous Shadows position tables');
      table = at;
    }
    if (table < 0) throw new Error('Shadows position tables not found');
    this.code = rom.subarray(table, table + 0x100);
    this.length = rom.subarray(table + 0x100, table + 0x200);

    this.scenes = [];
    let expectedStart = firstScene;
    for (let index = 0; index < 32; index++) {
      const start = be32(rom, root + 0x40 + index * 4);
      const word = be32(rom, root + 0xc0 + index * 4);
      const storedSize = word & 0xffffff;
      const end = start + storedSize;
      if ((word >>> 24) !== 1 || !storedSize || start !== expectedStart || end > rom.length || (start & 15) || (end & 15))
        throw new Error(`invalid Shadows scene ${index} ROM span`);
      const name = ascii(rom, root + 0x140 + index * 0x40, root + 0x140 + (index + 1) * 0x40);
      if (!name || /[^\x20-\x7e]/.test(name)) throw new Error(`invalid Shadows scene ${index} name`);
      this.scenes.push({ index, name, kind: index === 2 ? 'menu' : GAMEPLAY_IDS.has(index) ? 'gameplay' : 'cutscene', storedStart: start, storedEnd: end });
      expectedStart = end;
    }
  }

  loadScene(index: number): Uint8Array {
    const scene = this.scenes[index];
    if (!Number.isInteger(index) || !scene) throw new Error(`invalid Shadows scene index ${index}`);
    const block = this.rom.subarray(scene.storedStart, scene.storedEnd);
    const decoded = index === 0 ? decodeIntroLzss(block) : decodeLzhuf(block, this.code, this.length);
    if (decoded.length < 0x50 || ascii(decoded, 0, 4) !== 'LStb')
      throw new Error(`Shadows scene ${index} has invalid LStb header`);
    const base = be32(decoded, 4), end = be32(decoded, 8);
    const secondaryBase = be32(decoded, 0xc), secondaryEnd = be32(decoded, 0x10);
    if (end - base !== decoded.length || secondaryEnd - secondaryBase !== decoded.length)
      throw new Error(`Shadows scene ${index} decoded size does not match LStb bounds`);
    for (let at = 0x14; at <= 0x44; at += 4) {
      const pointer = be32(decoded, at);
      if (pointer < base || pointer >= end) throw new Error(`Shadows scene ${index} has invalid pointer +0x${at.toString(16)}`);
    }
    return decoded;
  }
}
