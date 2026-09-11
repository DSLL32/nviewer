// Bomberman Hero (U): the stages of the five planets and the hidden Gossick Star.
//
// Files are LZSS streams addressed by ROM offset (archive.ts HeroFiles). Per stage index i
// the game code holds, in the uncompressed code segment seg2 (ROM 0x4DFF0 = VRAM 0x8005BAD0):
//   0x8010B3FC[i] -> info record: +0x2C f32 far plane
//   0x80108238[i] -> file record {u32, A start, A end, B start, B end, s32 sub[4]}:
//     B = map "64" container, sub[] = nested containers inside B (-1 none)
//     A = stage blob linked at 0x802D0000; u32 +0 points to its header: +0x2B fog mode (2 =
//         fog), +0x2C backdrop picture, +0x31..0x33 fog colour, +0x34/+0x36 s16 fog min/max
//   0x8010BC30[i] -> placement block (ROM 0x2193A0 = 0x80300000): 16-byte records {u16 class,
//     s16 x, y, z, s16 yaw (degrees), s16 p1..p3} ending with class 0xFFFF
// Object classes: 0x60-byte records at ROM 0x1172B0 + class * 0x60 (name at +0x48); +0x24 ->
// {u16 slot, u16 flags, u32 model start, u32 end}; +0x28 -> shape (s16[1] = height offset).
import type { DlLighting } from '../displaylist';
import type { Backdrop, Game, Instance, Level, LevelInfo, Mesh, Texture } from '../types';
import { cstr, view } from '../util';
import { HeroFiles } from './archive';
import { buildLevel, decodeImage, fogPosition, lighting, meshFromBatches } from './common';
import { drawContainer, records64 } from './container64';
import { bombermanMusic } from './music';

const SEG2_VRAM = 0x8005bad0;
const SEG2_ROM = 0x4dff0;
const INFO_TABLE = 0x8010b3fc;
const FILE_TABLE = 0x80108238;
const PLACEMENT_TABLE = 0x8010bc30;
const PLACEMENT_ROM = 0x2193a0;
const PLACEMENT_VRAM = 0x80300000;
const PICTURE_TABLE = 0x801051e0;
const BLOB_VRAM = 0x802d0000;
const CLASS_TABLE_ROM = 0x1172b0;
const CLASS_COUNT = 652;

// In-game order: planet, area, maps as [name, stage index of the room].
const PLANETS: { planet: string; areas: { name: string; maps: [string, number][] }[] }[] = [
  {
    planet: 'Bomber', areas: [
      { name: 'Bomber Base', maps: [['Battle Room', 2], ['Hyper Room', 3], ['Secret Room', 6], ['Heavy Room', 4], ['Sky Room', 5]] },
      { name: 'Sea of Trees', maps: [['Blue Cave', 9], ['Hole Lake', 10], ['Red Cave', 11], ['Big Cannon', 13], ['Dark Wood', 12], ['Dragon Road', 14], ['Vs. Nitros', 15]] },
      { name: 'Peace Mountains', maps: [['Clown Valley', 16], ['Great Rock', 17], ['Fog Route', 18], ['Vs. Endol', 19]] },
    ],
  },
  {
    planet: 'Primus', areas: [
      { name: 'Woods of Esuram', maps: [['Groog Hills', 21], ['Bubble Hole', 22], ['Erars Lake', 23], ['Waterway', 24], ['Water Slider', 25]] },
      { name: 'Primus Castle', maps: [["Rock'n Road", 28], ['Water Pool', 27], ['Millian Road', 31], ['Warp Room', 30], ['Dark Prison', 29], ['Vs. Nitros', 87]] },
      { name: 'Clock Tower', maps: [['Killer Gate', 33], ['Spiral Tower', 34], ['Snake Route', 35], ['Vs. Baruda', 37]] },
    ],
  },
  {
    planet: 'Kanatia', areas: [
      { name: 'Lavana Volcano', maps: [['Hades Crater', 39], ['Magma Lake', 40], ['Magma Dam', 41], ['Crysta Hole', 42], ['Emerald Tube', 8]] },
      { name: 'Death Pyramid', maps: [['Death Temple', 45], ['Death Road', 48], ['Death Garden', 47], ['Float Zone', 49], ['Aqua Tank', 50], ['Aqua Way', 51], ['Vs. Nitros', 88]] },
      { name: 'Kanatia Shrine', maps: [['Hard Coaster', 53], ['Dark Maze', 54], ['Mad Coaster', 55], ['Move Stone', 56], ['Vs. Bolban', 57]] },
    ],
  },
  {
    planet: 'Mazone', areas: [
      { name: "Louie's Jungle", maps: [['Hopper Land', 61], ['Junfalls', 60], ['Freeze Lake', 59], ['Cool Cave', 62]] },
      { name: 'Slush Mountains', maps: [['SnowLand', 64], ['Storm Valley', 65], ['Snow Circuit', 74], ['Heaven Sky', 67], ['Eye Snake', 66]] },
      { name: 'Mazone Dome', maps: [['Vs. Nitros', 89], ['Air Room', 69], ['Zero G Room', 70], ['Mirror Room', 71], ['Vs. Natia', 90]] },
    ],
  },
  {
    planet: 'Garaden', areas: [
      { name: 'Garaden Star', maps: [['Boss Room 1', 76], ['Boss Room 2', 77], ['Boss Room 3', 78], ['Boss Room 4', 79], ['Boss Room 5', 80], ['Boss Room 6', 81], ['Vs. Bagular', 82]] },
    ],
  },
  {
    planet: 'Gossick', areas: [
      { name: 'Gossick Star', maps: [['Outer Road', 102], ['Inner Road', 103], ['Vs. ????', 85]] },
    ],
  },
];

// Stages with real map data that the stage selection never reaches (43 ... 112), and extra
// rooms with their own maps that may be reached from inside other stages (46 ... 127).
const OTHER_STAGES = [43, 73, 84, 101, 110, 111, 112, 46, 83, 92, 93, 94, 95, 104, 127];
// Event and cutscene scenes (stage indices >= 128), one per distinct map not used by a stage.
const CUTSCENES = [128, 133, 134, 136, 137, 141, 144, 147, 148, 150, 151, 156, 157, 165, 170];

interface StageRef { stage: number }

const STAGES: StageRef[] = [];
export const HERO_LEVELS: LevelInfo[] = [];
const addStage = (name: string, group: string, stage: number) => {
  HERO_LEVELS.push({ index: HERO_LEVELS.length, name, kind: 'adventure', group });
  STAGES.push({ stage });
};
PLANETS.forEach((p, pi) => {
  for (const a of p.areas) {
    const group = `${pi + 1} ${p.planet} – ${a.name}`;
    for (const [name, stage] of a.maps) {
      addStage(name, group, stage);
      // The first visit to Bomber Base starts in its own version of the Battle Room.
      if (stage === 2) addStage('Battle Room (first visit)', group, 0);
    }
  }
});
for (const stage of OTHER_STAGES) addStage(`Stage ${stage}`, 'Unused and extra stages', stage);
for (const stage of CUTSCENES) addStage(`Scene ${stage}`, 'Cutscene scenes', stage);

// Stage 1-1 lights: L1 black, L2 0xC8C8C8, both along (10, 42, 120), ambient 0x323232. The
// lists set L2 and ambient colours per material.
function heroLighting(rotY = 0): DlLighting {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  // Light directions in the object's space for a model turned by rotY about Y.
  const d: [number, number, number] = [10 * c - 120 * s, 42, 10 * s + 120 * c];
  return lighting([{ color: 0, dir: d }, { color: 0xc8c8c8, dir: d }], 0x323232);
}

class HeroRom {
  readonly dv: DataView;
  readonly files: HeroFiles;
  constructor(readonly rom: Uint8Array) {
    this.dv = view(rom);
    this.files = new HeroFiles(rom);
  }
  // seg2 VRAM to ROM, or -1.
  addr(vram: number): number {
    const o = vram - SEG2_VRAM + SEG2_ROM;
    return vram >= SEG2_VRAM && o >= SEG2_ROM && o < 0x126cb0 ? o : -1;
  }
  u32v(vram: number): number {
    const o = this.addr(vram);
    return o < 0 ? 0 : this.dv.getUint32(o);
  }
}

// Type-5 picture chain: records {u32 LE 5, u32 LE colours, u32 LE width, u32 LE height,
// RGBA16 palette (colours rounded up to 4), 4 bpp (<= 16 colours) or 8 bpp texels}.
function heroPicture(file: Uint8Array): Texture | null {
  if (file.length < 16) return null;
  const le = (o: number) => file[o] | (file[o + 1] << 8) | (file[o + 2] << 16) | (file[o + 3] << 24);
  if (le(0) !== 5) return null;
  const colours = le(4), w = le(8), h = le(12);
  if (!w || !h || w > 1024 || h > 1024) return null;
  return decodeImage(file, 16 + ((colours + 3) & ~3) * 2, colours <= 16 ? 'CI4' : 'CI8', w, h, 16);
}

function loadStage(r: HeroRom, index: number): Level {
  const ref = STAGES[index];
  if (!ref) throw new Error(`No level ${index}`);
  const i = ref.stage;
  const info = r.u32v(INFO_TABLE + i * 4);
  const far = r.addr(info) >= 0 ? r.dv.getFloat32(r.addr(info) + 0x2c) : 20000;
  const fileRec = r.addr(r.u32v(FILE_TABLE + i * 4));
  if (fileRec < 0) throw new Error(`Stage ${i}: no file record`);
  const blobStart = r.dv.getUint32(fileRec + 4);
  const mapStart = r.dv.getUint32(fileRec + 12);

  const textures: Texture[] = [];
  const textureKeys = new Map<string, number>();
  const meshes: Mesh[] = [];
  const instances: Instance[] = [];
  const ident = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  // The map: every display list of the container and of its nested sub-containers.
  const map = r.files.lzss(mapStart);
  const light = heroLighting();
  const bases = [0];
  for (let k = 0; k < 4; k++) {
    const sub = r.dv.getInt32(fileRec + 0x14 + k * 4);
    if (sub > 0 && sub < map.length && records64(map, sub)) bases.push(sub);
  }
  for (const base of bases) {
    const mesh = meshFromBatches(base ? `map sub 0x${base.toString(16)}` : 'map', drawContainer(map, base, {
      textures, textureKeys, keyPrefix: `${mapStart}/${base}:`, lighting: light, useTree: false,
    }));
    if (mesh.batches.length) instances.push({ name: mesh.name, mesh: meshes.push(mesh) - 1, matrix: ident });
  }

  // Objects placed by the stage's placement records.
  const placement = r.u32v(PLACEMENT_TABLE + i * 4);
  const meshOf = new Map<string, number>();
  if (placement >= PLACEMENT_VRAM) {
    for (let o = PLACEMENT_ROM + placement - PLACEMENT_VRAM; o + 16 <= r.rom.length; o += 16) {
      const cls = r.dv.getUint16(o);
      if (cls === 0xffff) break;
      if (cls >= CLASS_COUNT) continue;
      const x = r.dv.getInt16(o + 2), y = r.dv.getInt16(o + 4), z = r.dv.getInt16(o + 6), yaw = r.dv.getInt16(o + 8);
      if (x === 30000 && y === 30000 && z === 30000) continue; // list sentinel
      const desc = CLASS_TABLE_ROM + cls * 0x60;
      const res = r.addr(r.dv.getUint32(desc + 0x24));
      if (res < 0) continue;
      const modelStart = r.dv.getUint32(res + 4);
      if (modelStart < 0x47a4e0 || modelStart >= 0xb864b0) continue;
      // The class's height offset (shape +2) is also the model's root node translation, which
      // the node tree already applies.
      const rot = (yaw * Math.PI) / 180;
      const key = `${modelStart}/${yaw}`;
      let mi = meshOf.get(key);
      if (mi === undefined) {
        let batches: ReturnType<typeof drawContainer> = [];
        try {
          batches = drawContainer(r.files.lzss(modelStart), 0, { textures, textureKeys, keyPrefix: `${modelStart}:`, lighting: heroLighting(rot) });
        } catch {
          batches = [];
        }
        mi = meshes.push(meshFromBatches(cstr(r.rom, desc + 0x48, 24) || `class ${cls}`, batches)) - 1;
        meshOf.set(key, mi);
      }
      if (!meshes[mi].batches.length) continue;
      const c = Math.cos(rot), s = Math.sin(rot);
      // Only map sections are fogged; objects draw without fog.
      instances.push({
        name: meshes[mi].name, mesh: mi, noFog: true,
        matrix: new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, x, y, z, 1]),
      });
    }
  }

  const extra: Partial<Level> = {};
  const blob = r.files.lzss(blobStart);
  const bdv = view(blob);
  const header = blob.length >= 4 ? bdv.getUint32(0) - BLOB_VRAM : -1;
  if (header >= 0 && header + 0x38 <= blob.length) {
    // Projection: fovy 50, near 100, far from the info record.
    if (blob[header + 0x2b] === 2) {
      extra.fog = fogPosition(bdv.getInt16(header + 0x34), bdv.getInt16(header + 0x36),
        [blob[header + 0x31], blob[header + 0x32], blob[header + 0x33]], 100, far);
    }
    const pic = blob[header + 0x2c];
    const entry = pic ? r.addr(PICTURE_TABLE + (pic - 1) * 8) : -1;
    const picture = entry >= 0 ? heroPicture(r.files.lzss(r.dv.getUint32(entry))) : null;
    if (picture) {
      // Stage 1-1 shows 80 x 60 texels from (20, 103), magnified 4x.
      const u0 = 20 / picture.width, v0 = 103 / picture.height;
      extra.backdrop = {
        texture: textures.push(picture) - 1, u0, v0, u1: Math.min(1, u0 + 80 / picture.width), v1: Math.min(1, v0 + 60 / picture.height),
      } satisfies Backdrop;
    }
  }
  extra.clearColor = extra.fog?.color ?? [0, 0, 0];
  return buildLevel(HERO_LEVELS[index], `bmhero-${index}`, textures, meshes, instances, extra);
}

export function openBombermanHero(rom: Uint8Array): Game {
  const r = new HeroRom(rom);
  const music = bombermanMusic(rom, 'bmhero');
  return {
    id: 'bmhero',
    title: 'Bomberman Hero',
    levels: HERO_LEVELS,
    loadLevel: (i) => loadStage(r, i),
    music: music.tracks,
    decodeMusic: (i) => music.decode(i),
  };
}
