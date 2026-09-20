import { decodeFla2 } from './fla2';

interface Range { name: string; start: number; end: number }

const TEX: Record<number, Range> = {
  0: { name: 'TITLE', start: 0xf6780, end: 0x115240 }, 1: { name: 'LEVELEND', start: 0x1b0ac0, end: 0x1e5f40 },
  2: { name: 'GENERIC', start: 0x115240, end: 0x1266c0 }, 3: { name: 'ATLANTIS', start: 0x1266c0, end: 0x1373c0 },
  4: { name: 'CARNIVAL', start: 0x1373c0, end: 0x143b00 }, 5: { name: 'OOTW', start: 0x180f00, end: 0x18f800 },
  6: { name: 'PIRATES', start: 0x143b00, end: 0x157a80 }, 7: { name: 'PREHISTORIC', start: 0x157a80, end: 0x16bec0 },
  8: { name: 'FORTRESS', start: 0x16bec0, end: 0x180f00 }, 9: { name: 'HUB', start: 0x18f800, end: 0x1b0ac0 },
  10: { name: 'FONT', start: 0x1e5f40, end: 0x1ea940 }, 11: { name: 'CAMEO', start: 0x1ea940, end: 0x206500 },
  12: { name: 'PRESENT', start: 0x23ab40, end: 0x24dec0 }, 13: { name: 'FLYTHRU', start: 0x24dec0, end: 0x250880 },
  14: { name: 'LEVELEND_2', start: 0x206500, end: 0x23ab40 }, 15: { name: 'CKBONUS', start: 0x250880, end: 0x251fc0 },
  16: { name: 'CKCHEAT1', start: 0x251fc0, end: 0x253c00 }, 17: { name: 'CKCHEAT2', start: 0x253c00, end: 0x255740 },
  18: { name: 'RCDEMO', start: 0x25efc0, end: 0x2607c0 },
};

const OBJ: Record<number, Range> = {};
for (const [id, name, start, end] of [
  [0,'SYSTEM',0x47d680,0x47da80],[1,'GENERIC',0x2607c0,0x282600],[2,'HUB_PART1',0x37ef00,0x38bc40],[3,'HUB_PART2',0x40a540,0x417340],
  [4,'HUB_PART3',0x417340,0x4239c0],[5,'HUB_PART4',0x4239c0,0x430040],[6,'HUB_PART5',0x430040,0x43c6c0],[7,'HUB_PART6',0x43c6c0,0x448d00],
  [8,'HUB_PART7',0x448d00,0x455640],[9,'HUB_PART8',0x455640,0x462040],[10,'CAVE',0x3db380,0x3e15c0],[11,'ASSAULT_COURSE',0x462040,0x465dc0],
  [12,'ATLANTIS_SHARED',0x282600,0x287700],[13,'ATLANTIS_L1',0x287700,0x28c700],[14,'ATLANTIS_L2',0x28c700,0x293680],[15,'ATLANTIS_L3A',0x293680,0x2a0200],
  [17,'ATLANTIS_BOSS',0x2a0200,0x2b0440],[18,'ATLANTIS_BONUS',0x2b0440,0x2b1b40],[19,'CARNIVAL_SHARED',0x2b1b40,0x2b92c0],[20,'CARNIVAL_L1',0x2b92c0,0x2c5980],
  [21,'CARNIVAL_L2A',0x2c5980,0x2cca00],[23,'CARNIVAL_L3A',0x2cca00,0x2d6980],[25,'CARNIVAL_BOSS',0x2d6980,0x2e6540],[26,'CARNIVAL_BONUS',0x2e6540,0x2e8bc0],
  [27,'OOTW_SHARED',0x3d3d80,0x3db380],[29,'OOTW_L2A',0x39e280,0x3ab800],[30,'OOTW_L2B',0x3ab800,0x3b4540],[31,'OOTW_L3',0x3b4540,0x3bf440],
  [33,'OOTW_BOSS1',0x3bf440,0x3cb680],[35,'OOTW_BONUS',0x3cfb40,0x3d3d80],[38,'PIRATES_SHARED',0x2e8bc0,0x2ee880],[39,'PIRATES_L1',0x2ee880,0x2f8580],
  [40,'PIRATES_L2A',0x2f8580,0x304800],[43,'PIRATES_L3B',0x38bc40,0x396d80],[44,'PIRATES_BOSS',0x304800,0x314a40],[45,'PIRATES_BONUS',0x314a40,0x316400],
  [46,'PREHISTORIC_SHARED',0x316400,0x320c80],[47,'PREHISTORIC_L1A',0x320c80,0x327dc0],[49,'PREHISTORIC_L2A',0x327dc0,0x330840],[52,'PREHISTORIC_L3B',0x396d80,0x39e280],
  [53,'PREHISTORIC_BOSS',0x330840,0x337d80],[54,'PREHISTORIC_BONUS',0x337d80,0x33c5c0],[55,'FORTRESS_SHARED',0x33c5c0,0x3458c0],[56,'FORTRESS_L1A',0x3458c0,0x351400],
  [58,'FORTRESS_L2A',0x351400,0x35ddc0],[61,'FORTRESS_L3B',0x35ddc0,0x369000],[62,'FORTRESS_BOSS',0x36cbc0,0x37a100],[63,'FORTRESS_BONUS',0x369000,0x36cbc0],
  [64,'HUB_SHARED',0x37a100,0x37ef00],[65,'INTRO',0x3e15c0,0x402540],[66,'OUTRO',0x46b180,0x47d680],[67,'WAYROOM',0x402540,0x40a540],
  [68,'PRESENTATION',0x47da80,0x485880],[69,'FLYTHRU',0x485880,0x492500],[70,'TITLE_BANK',0x465dc0,0x46b180],[71,'TWEEN',0x3cb680,0x3cfb40],
] as [number, string, number, number][]) OBJ[id] = { name, start, end };

export interface BankFile { id: number; name: string; bytes: Uint8Array }
export interface GloverLevelRecord { name: string; objectBank: number; song: number }

export class GloverFs {
  readonly view: DataView;
  private landscapes: { start: number; size: number }[] | null = null;
  private decoded = new Map<string, BankFile>();

  constructor(readonly rom: Uint8Array) {
    this.view = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
    if (rom.length !== 0x800000 || this.view.getUint32(0) !== 0x80371240)
      throw new Error('unsupported Glover ROM (expected normalized 8 MiB USA image)');
    const title = String.fromCharCode(...rom.subarray(0x20, 0x34)).replace(/\0/g, '').trim();
    if (title !== 'Glover') throw new Error(`invalid Glover internal title ${JSON.stringify(title)}`);
    if (this.view.getUint32(0x10) !== 0x8e6e01ff || this.view.getUint32(0x14) !== 0xccb4f948)
      throw new Error('unsupported Glover revision');
  }

  textureBank(id: number): BankFile { return this.bank('texture', id, TEX); }
  objectBank(id: number): BankFile { return this.bank('object', id, OBJ); }

  private bank(kind: string, id: number, table: Record<number, Range>): BankFile {
    const key = `${kind}:${id}`;
    const cached = this.decoded.get(key);
    if (cached) return cached;
    const range = table[id];
    if (!range) throw new Error(`Glover ${kind} bank ${id} is absent`);
    const file = { id, name: range.name, bytes: decodeFla2(this.rom.subarray(range.start, range.end)) };
    this.decoded.set(key, file);
    return file;
  }

  landscape(index: number): Uint8Array {
    if (!this.landscapes) {
      this.landscapes = [];
      for (let at = 0x492500; at < 0x4d5890;) {
        const size = this.view.getUint32(at);
        if (size < 14 || at + size > 0x4d5890) throw new Error(`invalid Glover landscape chain at 0x${at.toString(16)}`);
        this.landscapes.push({ start: at, size });
        at += size;
      }
      if (this.landscapes.length !== 48) throw new Error(`Glover landscape chain has ${this.landscapes.length} entries`);
    }
    const e = this.landscapes[index];
    if (!e) throw new RangeError(`Glover level ${index} is absent`);
    return this.rom.subarray(e.start, e.start + e.size);
  }

  levelRecord(index: number): GloverLevelRecord {
    if (index < 0 || index >= 48) throw new RangeError(`Glover level ${index} is absent`);
    const at = 0xe7910 + index * 0x38;
    let name = '';
    for (let i = 0; i < 24 && this.rom[at + i]; i++) name += String.fromCharCode(this.rom[at + i]);
    return { name, objectBank: this.view.getUint32(at + 0x28), song: this.rom[at + 0x35] };
  }

  worldOf(level: number): number {
    if (level <= 9 || level === 42 || level === 44 || level === 45) return 0;
    if (level <= 34) return 1 + Math.floor((level - 10) / 5);
    if (level <= 41 || level === 43) return 6;
    return 7;
  }

  banksFor(level: number): { textures: number[]; objects: number[] } {
    const rec = this.levelRecord(level);
    const world = this.worldOf(level);
    const textures = [2];
    const objects: number[] = [];
    if (level < 46) {
      const w = 0xe8390 + world * 0x18;
      textures.push(level === 42 ? 9 : level === 43 ? 12 : this.rom[w + 1]);
      objects.push(this.rom[w]);
    } else textures.push(11);
    if (level === 19) textures.push(15);
    if (level === 44) { textures.push(13); objects.push(69); }
    else objects.push(1);
    objects.push(rec.objectBank);
    return { textures, objects };
  }
}
