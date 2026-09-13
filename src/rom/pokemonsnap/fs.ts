// Pokémon Snap (U) fixed-overlay ROM layout and per-course address resolver.
// The retail game has no filesystem: each scene loads absolute ROM ranges at
// fixed VRAM addresses, and later loads shadow earlier ones.

export interface Segment {
  name: string;
  romStart: number;
  romEnd: number;
  vram: number;
}

export interface CourseDefinition {
  id: CourseId;
  name: string;
  scene: number;
  kind: 'campaign' | 'bonus';
  assets: Segment;
  extra: Segment;
  code: Segment;
  setup: number;
  height?: number;
  ceiling?: number;
  shared: Segment[];
}

export type CourseId = 'beach' | 'tunnel' | 'volcano' | 'river' | 'cave' | 'valley' | 'rainbow';
export type V3 = [number, number, number];

const seg = (name: string, romStart: number, romEnd: number, vram: number): Segment => ({ name, romStart, romEnd, vram });

export const MAIN = seg('main', 0x001000, 0x046270, 0x80000400);
export const APP_RENDER = seg('app_render', 0x046270, 0x05bf20, 0x8009a8c0);
export const MORE_FUNCS = seg('more_funcs', 0x05bf20, 0x05f050, 0x800bf080);
export const WORLD = seg('world', 0x05f050, 0x0731b0, 0x800e18a0);
export const APP_LEVEL = seg('app_level', 0x4f0610, 0x54b5d0, 0x80350200);

const MAGIKARP_TEXTURES = seg('magikarp_textures', 0x0731b0, 0x07d3b0, 0x800f5d90);
const PIKACHU_TEXTURES = seg('pikachu1', 0x07d3b0, 0x098470, 0x800fff90);
const ZUBAT_TEXTURES = seg('zubat1', 0x098470, 0x099f70, 0x8011b050);
const BULBASAUR_TEXTURES = seg('bulbasaur1', 0x099f70, 0x0a74e0, 0x8011cb50);
const MAGIKARP_MODEL = seg('magikarp_model', 0x54b5d0, 0x54d6a0, 0x8034e130);
const PIKACHU_MODEL = seg('pikachu_model', 0x54d6a0, 0x554130, 0x803476a0);
const ZUBAT_MODEL = seg('zubat_model', 0x554130, 0x557050, 0x80344780);
const BULBASAUR_MODEL = seg('bulbasaur_model', 0x557050, 0x55c110, 0x8033f6c0);

const shared = {
  magikarp: [MAGIKARP_TEXTURES, MAGIKARP_MODEL],
  pikachu: [PIKACHU_TEXTURES, PIKACHU_MODEL],
  zubat: [ZUBAT_TEXTURES, ZUBAT_MODEL],
  bulbasaur: [BULBASAUR_TEXTURES, BULBASAUR_MODEL],
};

export const COURSES: CourseDefinition[] = [
  {
    id: 'beach', name: 'Beach', scene: 0, kind: 'campaign',
    assets: seg('beach_assets', 0x0a74e0, 0x13c780, 0x8011b050),
    extra: seg('beach_extra', 0x13c780, 0x162cb0, 0x801b0310),
    code: seg('beach_code', 0x55c110, 0x5df5d0, 0x802c40a0),
    setup: 0x8011b914, height: 0x5b0f70,
    shared: [...shared.magikarp, ...shared.pikachu],
  },
  {
    id: 'tunnel', name: 'Tunnel', scene: 1, kind: 'campaign',
    assets: seg('tunnel_assets', 0x162cb0, 0x1d1d90, 0x8011cb50),
    extra: seg('tunnel_extra', 0x1d1d90, 0x1f5e70, 0x8018bc50),
    code: seg('tunnel_code', 0x5df5d0, 0x6401b0, 0x802e2500),
    setup: 0x8011e6cc, height: 0x623fb0, ceiling: 0x623fb8,
    shared: [...shared.magikarp, ...shared.pikachu, ...shared.zubat],
  },
  {
    id: 'volcano', name: 'Volcano', scene: 2, kind: 'campaign',
    assets: seg('volcano_assets', 0x326c10, 0x3d0560, 0x800fff90),
    extra: seg('volcano_extra', 0x3d0560, 0x3f63d0, 0x801a9900),
    code: seg('volcano_code', 0x7272e0, 0x79f1b0, 0x802d60e0),
    setup: 0x800fffb8, height: 0x76e6d0,
    shared: [...shared.magikarp],
  },
  {
    id: 'river', name: 'River', scene: 3, kind: 'campaign',
    assets: seg('river_assets', 0x29a190, 0x30af90, 0x8012a0c0),
    extra: seg('river_extra', 0x30af90, 0x326c10, 0x8019aee0),
    code: seg('river_code', 0x6c05e0, 0x7272e0, 0x802d8800),
    setup: 0x8012ac90, height: 0x709340,
    shared: [...shared.bulbasaur, ...shared.magikarp, ...shared.pikachu],
  },
  {
    id: 'cave', name: 'Cave', scene: 4, kind: 'campaign',
    assets: seg('cave_assets', 0x1f5e70, 0x27ab80, 0x8012a0c0),
    extra: seg('cave_extra', 0x27ab80, 0x29a190, 0x801aedf0),
    code: seg('cave_code', 0x6401b0, 0x6c05e0, 0x802bdd00),
    setup: 0x8012a0e8, height: 0x699ac0, ceiling: 0x699ac8,
    shared: [...shared.bulbasaur, ...shared.magikarp, ...shared.pikachu, ...shared.zubat],
  },
  {
    id: 'valley', name: 'Valley', scene: 5, kind: 'campaign',
    assets: seg('valley_assets', 0x3f63d0, 0x47cf30, 0x800fff90),
    extra: seg('valley_extra', 0x47cf30, 0x4a8160, 0x80186b10),
    code: seg('valley_code', 0x79f1b0, 0x825e30, 0x802c5c20),
    setup: 0x80100720, height: 0x7f8f50,
    shared: [...shared.magikarp],
  },
  {
    id: 'rainbow', name: 'Rainbow Cloud', scene: 6, kind: 'bonus',
    assets: seg('rainbow_assets', 0x4a8160, 0x4ec000, 0x800f5d90),
    extra: seg('rainbow_extra', 0x4ec000, 0x4f0610, 0x80139c50),
    code: seg('rainbow_code', 0x825e30, 0x82f8e0, 0x803466c0),
    setup: 0x800f5da0,
    shared: [],
  },
];

const be32 = (b: Uint8Array, o: number) =>
  ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

function overlayValid(rom: Uint8Array, o: number): boolean {
  const w = Array.from({ length: 9 }, (_, i) => be32(rom, o + i * 4));
  return w[0] >= 0x1000 && w[0] < w[1] && w[1] <= rom.length &&
    w[2] >= 0x80000000 && w[2] < 0x80800000 && w[3] === w[2] &&
    w[4] === w[5] && w[6] === w[7] && w[7] <= w[8] && w[6] - w[2] === w[1] - w[0];
}

export function validatePokemonSnapUs(rom: Uint8Array): void {
  const code = String.fromCharCode(...rom.subarray(0x3b, 0x3f));
  if (code !== 'NPFE') throw new Error(`unsupported Pokémon Snap ROM code ${code}`);
  if (rom.length !== 0x1000000) throw new Error(`unsupported Pokémon Snap ROM size 0x${rom.length.toString(16)} (expected 16 MiB)`);
  if (rom[0x3f] !== 0) throw new Error(`unsupported Pokémon Snap revision ${rom[0x3f]} (expected revision 0)`);
  if (be32(rom, 0x10) !== 0xca12b547 || be32(rom, 0x14) !== 0x71fa4ee4)
    throw new Error('unsupported Pokémon Snap (U) dump (header CRC mismatch)');
  for (let i = 0; i < 30; i++) {
    if (!overlayValid(rom, 0x57580 + i * 0x24))
      throw new Error(`invalid Pokémon Snap overlay table entry ${i}`);
  }
}

export class SnapMemory {
  readonly segments: Segment[];
  private readonly dv: DataView;

  constructor(readonly bytes: Uint8Array, readonly course: CourseDefinition) {
    // The resolver deliberately follows the game's reverse-load rule.
    this.segments = [MAIN, APP_RENDER, MORE_FUNCS, WORLD, APP_LEVEL, course.code, course.assets, ...course.shared];
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  rom(addr: number): number {
    addr >>>= 0;
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const s = this.segments[i];
      if (addr >= s.vram && addr < s.vram + s.romEnd - s.romStart) return s.romStart + addr - s.vram;
    }
    return -1;
  }

  segment(addr: number): string | null {
    addr >>>= 0;
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const s = this.segments[i];
      if (addr >= s.vram && addr < s.vram + s.romEnd - s.romStart) return s.name;
    }
    return null;
  }

  vramOfRom(offset: number): number {
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const s = this.segments[i];
      if (offset >= s.romStart && offset < s.romEnd) return (s.vram + offset - s.romStart) >>> 0;
    }
    return -1;
  }

  ok(addr: number): boolean { return this.rom(addr) >= 0; }
  private at(addr: number): number {
    const o = this.rom(addr);
    if (o < 0) throw new Error(`unmapped Pokémon Snap address 0x${(addr >>> 0).toString(16)} (${this.course.id})`);
    return o;
  }
  u32(a: number): number { return this.dv.getUint32(this.at(a)); }
  s32(a: number): number { return this.dv.getInt32(this.at(a)); }
  f32(a: number): number { return this.dv.getFloat32(this.at(a)); }
  u16(a: number): number { return this.dv.getUint16(this.at(a)); }
  s16(a: number): number { return this.dv.getInt16(this.at(a)); }
  u8(a: number): number { return this.bytes[this.at(a)]; }
  vec3(a: number): V3 { return [this.f32(a), this.f32(a + 4), this.f32(a + 8)]; }
}
