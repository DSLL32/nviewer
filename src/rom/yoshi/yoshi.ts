// Yoshi's Story (Japan, NYSJ revision 0): a side-scroller built from 2D tile layers (YOSHISTORY.md).
//
// Assets are read piecemeal through segmented pointers: 0x03xxxxxx = castData at ROM 0x528430, 0x04xxxxxx =
// worldDatabase at ROM 0xB16170. A world (one room) has a 0x118-byte record, a scene table and 12-byte actor
// records {u16 castId; u16 serial; f32 x; f32 y} in world pixels (y down). Actors 0x8xxx are background tile
// layers; the rest are objects. Casts (table ROM 0xA6520: {u16 id; u16; ptr castdt; ptr attribute}) point
// at eight {u32 12; ptr record} slots, whose records are {u32 size; u32 storedSize; ptr data} (data may be
// CMPR-compressed).
//
// Layers are drawn as the game's own geometry: a 40 degree camera 329.7 px in front of the main plane shows
// each layer at its depth, scaled so its texels stay 1:1, which reproduces the game's parallax exactly.
import { buildLevel, meshFromBatches } from '../bomberman/common';
import type { Batch, DebugInfo, Game, Instance, Level, LevelInfo, LevelLayer, Marker, Mesh, Texture } from '../types';
import { view } from '../util';
import { decodeYoshiMusic, listYoshiMusic } from './music';
import { CAST_NAMES, WORLD_NAMES } from './names';
import { dmaRead } from './slide';
import { yoshiCell } from './yoshicell';

const SEG3 = 0x528430;
const SEG4 = 0xb16170;
const WORLD_TABLE = 0xacb60; // {u32 attr; ptr world} x 176
const CAST_TABLE = 0xa6520;
const CAST_COUNT = 1572;
const SHAPE_TABLE = 0xa5eb4; // 128 RAM pointers to u16[16] collision masks
const FOV_Y = 40;
const K = 120 / Math.tan((FOV_Y / 2) * (Math.PI / 180)); // eye distance from the main plane (329.7)
const PLAYER_START = 0x4001;

const US_TITLES = [
  'Treasure Hunt', 'Surprise!!', 'Rail Lift', 'Tower Climb', 'Bone Dragon Pit', "Blargg's Boiler", 'Jelly Pipe',
  'Torrential Maze', 'Cloud Cruising', 'The Tall Tower', 'Poochy & Nippy', 'Frustration', 'Jungle Hut',
  'Jungle Puddle', 'Piranha Grove', 'Neuron Jungle', "Lots O' Jelly Fish", "Lots O' Fish", 'Shy Guy Limbo',
  "Shy Guy's Ship", 'Mecha Castle', 'Lift Castle', 'Ghost Castle', 'Magma Castle',
];
const PAGE_THEMES = ['Grassland', 'Cave', 'Mountain', 'Jungle', 'Sea', 'Castle'];

// Worlds of each course in play order: the start world, its areas and rooms, then worlds of the course that
// no exit reaches (boss arenas and rooms entered by code). YOSHISTORY.md §4.4.
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const COURSE_WORLDS: number[][] = [
  [43, 81], [51, 85, 148], [13, 104, 119, 160], [18, 90, 91, 92, 152],
  [46, 149, 120, 153, 171], [19, 155, 93], [16, 106, 151], [23, ...range(107, 111)],
  [52, 82, 84, 174, 83, 162], [40, 102, 103, 164, 156], [32, ...range(124, 131), 170, 163], [14, 105, 165, 76],
  [17, ...range(112, 117)], [22, 150, 97], [12, 147, 145, 86], [27, 161, 118],
  [21, 146, 94, 95, 96], [166, 30, 121, 154, 172, 173], [31, 122, 123], [28, 158, 101],
  [15, 159, 87, 88, 89], [142, 35, 141, 143, 144, 157, 167], [34, ...range(132, 140), 168], [175, 24, 98, 99, 100, 78, 169],
];
const OTHER_WORLDS: [number, string, string][] = [
  [25, 'Practice course', 'Other'],
  [79, 'Clear demo', 'Other'],
  [11, 'worldTester', 'Unused and test worlds'],
  [36, 'worldHashi', 'Unused and test worlds'],
  [37, 'worldDrum', 'Unused and test worlds'],
  [39, 'worldBosstest', 'Unused and test worlds'],
  [66, 'worldKumo_boss_enkei', 'Unused and test worlds'],
];

interface LevelDef { world: number; info: LevelInfo }

function levelDefs(): LevelDef[] {
  const defs: LevelDef[] = [];
  const add = (world: number, name: string, kind: LevelInfo['kind'], group: string) =>
    defs.push({ world, info: { index: defs.length, name, kind, group } });
  COURSE_WORLDS.forEach((worlds, c) => {
    const page = Math.floor(c / 4) + 1, course = (c % 4) + 1;
    const title = `${page}-${course} ${US_TITLES[c]}`;
    worlds.forEach((w, k) => {
      const leak = (WORLD_NAMES[w] ?? `world${w}`).replace(/^world_?/, '');
      const area = leak.match(new RegExp(`^${page}_${course}_(.+)$`));
      const suffix = k === 0 ? '' : area ? ` · area ${area[1].replace(/_/g, '-')}` : ` · ${leak}`;
      const kind = /^(Boss|Kupa|Bs_|NigeruKuppa)/.test(leak) && !area ? 'boss' : 'adventure';
      add(w, title + suffix, kind, `Page ${page} · ${PAGE_THEMES[page - 1]}`);
    });
  });
  for (const [w, name, group] of OTHER_WORLDS) add(w, name, 'other', group);
  return defs;
}

interface Cast { castdt: number; attr: number }

class YoshiRom {
  readonly dv: DataView;
  readonly casts = new Map<number, Cast>();

  constructor(readonly rom: Uint8Array) {
    this.dv = view(rom);
    for (let i = 0; i < CAST_COUNT; i++) {
      const o = CAST_TABLE + i * 12;
      if (!this.casts.has(this.dv.getUint16(o))) this.casts.set(this.dv.getUint16(o), { castdt: this.dv.getUint32(o + 4), attr: this.dv.getUint32(o + 8) });
    }
  }

  // ROM offset of a segmented pointer, or -1.
  seg(p: number, size = 1): number {
    const s = p >>> 24;
    const o = s === 3 ? SEG3 + (p & 0xffffff) : s === 4 ? SEG4 + (p & 0xffffff) : -1;
    return o >= 0 && o + size <= this.rom.length ? o : -1;
  }

  u32(o: number) { return o >= 0 && o + 4 <= this.rom.length ? this.dv.getUint32(o) : 0; }
  u16(o: number) { return o >= 0 && o + 2 <= this.rom.length ? this.dv.getUint16(o) : 0; }

  // Slot k of a castdt: the ROM offset of its 12-byte record, or -1.
  slot(castdt: number, k: number): number {
    const c = this.seg(castdt, 0x64);
    return c < 0 || this.u32(c + 0x1c + 8 * k) !== 12 ? -1 : this.seg(this.u32(c + 0x20 + 8 * k), 12);
  }

  // The data of a {size; storedSize; data} record, decompressed.
  record(rec: number): Uint8Array | null {
    if (rec < 0) return null;
    const size = this.u32(rec), data = this.seg(this.u32(rec + 8), 16);
    if (data < 0 || size <= 0 || size > 0x400000) return null;
    try {
      const out = dmaRead(this.rom, data, size);
      return out.length >= size ? out.subarray(0, size) : null;
    } catch {
      return null;
    }
  }
}

const rgba5551 = (v: number, out: Uint8Array, o: number) => {
  const r = (v >> 11) & 31, g = (v >> 6) & 31, b = (v >> 1) & 31;
  out[o] = (r << 3) | (r >> 2);
  out[o + 1] = (g << 3) | (g >> 2);
  out[o + 2] = (b << 3) | (b >> 2);
  out[o + 3] = v & 1 ? 255 : 0;
};

// Tiles packed into one texture, each padded by its repeated edge texels so filtering stays inside a tile.
class TileAtlas {
  private readonly cells = new Map<number, number>();
  private readonly tiles: Uint8Array[] = [];
  constructor(private readonly w: number, private readonly h: number) {}

  cell(key: number, rgba: () => Uint8Array): number {
    let c = this.cells.get(key);
    if (c === undefined) {
      c = this.tiles.length;
      this.tiles.push(rgba());
      this.cells.set(key, c);
    }
    return c;
  }

  get size() { return this.tiles.length; }

  build(format: string, source: string): { texture: Texture; uv: (cell: number) => [number, number, number, number] } {
    const cw = this.w + 2, ch = this.h + 2;
    const perRow = Math.max(1, Math.floor(1024 / cw));
    const width = Math.min(this.tiles.length, perRow) * cw, height = Math.ceil(this.tiles.length / perRow) * ch;
    const out = new Uint8Array(width * height * 4);
    this.tiles.forEach((t, i) => {
      const ox = (i % perRow) * cw, oy = Math.floor(i / perRow) * ch;
      for (let y = -1; y <= this.h; y++) {
        for (let x = -1; x <= this.w; x++) {
          const sx = Math.min(this.w - 1, Math.max(0, x)), sy = Math.min(this.h - 1, Math.max(0, y));
          out.set(t.subarray((sy * this.w + sx) * 4, (sy * this.w + sx) * 4 + 4), ((oy + 1 + y) * width + ox + 1 + x) * 4);
        }
      }
    });
    return {
      texture: { width, height, rgba: out, wrapS: 'clamp', wrapT: 'clamp', format, source },
      uv: (i) => {
        const ox = (i % perRow) * cw + 1, oy = Math.floor(i / perRow) * ch + 1;
        return [ox / width, oy / height, (ox + this.w) / width, (oy + this.h) / height];
      },
    };
  }
}

// Quads in the XY plane: (x, y) is the top-left corner in Y-up coordinates.
class QuadBuilder {
  readonly pos: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];

  quad(x: number, y: number, w: number, h: number, [u0, v0, u1, v1]: [number, number, number, number], rgba = [255, 255, 255, 255]) {
    const tl = [x, y], bl = [x, y - h], br = [x + w, y - h], tr = [x + w, y];
    for (const [p, t] of [[tl, [u0, v0]], [bl, [u0, v1]], [br, [u1, v1]], [tl, [u0, v0]], [br, [u1, v1]], [tr, [u1, v0]]]) {
      this.pos.push(p[0], p[1], 0);
      this.uv.push(t[0], t[1]);
      this.col.push(...rgba);
    }
  }

  batch(texture: number, blend: Batch['blend']): Batch {
    return {
      texture, blend, depthTest: true, depthWrite: blend !== 'blend', cullBack: false,
      positions: new Float32Array(this.pos), uvs: new Float32Array(this.uv), colors: new Uint8Array(this.col),
    };
  }
}

const floor16 = (v: number) => Math.floor(v / 16) * 16;
// Depth in the viewer: the integer part of the game's z gives the parallax plane, the fraction keeps the
// game's painter's order (larger z is farther).
const depthOf = (z: number) => -(Math.floor(z) - 500) - 0.1 * (z - Math.floor(z));
const hex = (v: number, n = 4) => v.toString(16).padStart(n, '0');

interface TileLayer {
  worldW: number; worldH: number; blkW: number; blkH: number; unitW: number; unitH: number;
  tiles: boolean; // false for collision-only casts (block size 0: kupa_room, boss_majin, damybg)
  units: (pass: 'tiles' | 'collision', emit: (px: number, py: number, value: number) => void) => void;
}

function tileLayer(y: YoshiRom, castdt: number): TileLayer | null {
  const bii = y.slot(castdt, 0);
  if (bii < 0) return null;
  const [bw, bh, uw, uh, worldW, worldH] = [0, 2, 4, 6, 8, 10].map((k) => y.u16(bii + k));
  const ids = y.record(y.slot(castdt, 3)), blocks = y.record(y.slot(castdt, 4));
  if (!ids || !blocks || !worldW || !worldH) return null;
  const collision = y.record(y.slot(castdt, 6));
  // Collision-only casts store no block size; their maps use the standard 256 px blocks of 16 px units.
  const tiles = bw > 0 && bh > 0 && uw > 0 && uh > 0;
  const [blkW, blkH, unitW, unitH] = tiles ? [bw, bh, uw, uh] : [256, 256, 16, 16];
  const upbX = blkW / unitW, upbY = blkH / unitH;
  const stride = Math.floor(ids.length / 2 / upbY);
  const BW = Math.floor(worldW / blkW), BH = Math.floor(worldH / blkH);
  const idv = view(ids);
  return {
    worldW, worldH, blkW, blkH, unitW, unitH, tiles,
    units: (pass, emit) => {
      const map = pass === 'tiles' ? ids : collision;
      if (!map) return;
      const mv = pass === 'tiles' ? idv : view(map);
      for (let by = 0; by < BH; by++) {
        for (let bx = 0; bx < BW; bx++) {
          const bi = by * BW + bx;
          if (bi >= blocks.length) continue;
          const b = blocks[bi];
          for (let ly = 0; ly < upbY; ly++) {
            for (let lx = 0; lx < upbX; lx++) {
              const i = ly * stride + b * upbX + lx;
              if (2 * i + 2 > map.length) continue;
              const v = mv.getUint16(2 * i);
              if (v) emit(bx * blkW + lx * unitW, by * blkH + ly * unitH, v);
            }
          }
        }
      }
    },
  };
}

// Colours of collision kinds (value >> 11) in the overlay.
const COLLISION_COLOURS = [
  [255, 255, 255], [255, 128, 0], [0, 200, 255], [255, 0, 255], [128, 255, 0], [255, 255, 0], [60, 120, 255], [255, 40, 40],
  [0, 255, 160], [200, 120, 255], [255, 180, 120], [120, 255, 255], [255, 90, 160], [160, 160, 60], [90, 200, 90], [200, 200, 200],
];

function loadLevel(y: YoshiRom, def: LevelDef): Level {
  const { rom } = y;
  const worldPtr = y.u32(WORLD_TABLE + def.world * 8 + 4);
  const w = y.seg(worldPtr, 0x118);
  if (w < 0) throw new Error(`World ${def.world} not found`);
  const dv = y.dv;
  const cam0 = [dv.getFloat32(w + 0x28), dv.getFloat32(w + 0x2c)];

  // Actors of every scene.
  const actors: { id: number; serial: number; x: number; y: number; record: number }[] = [];
  const table = y.seg(y.u32(w + 0x5c), 4);
  for (let s = 0, n = rom[w + 0x58] * rom[w + 0x59]; s < n && table >= 0; s++) {
    const scene = y.seg(y.u32(table + 4 * s), 8);
    if (scene < 0) continue;
    const count = Math.min(dv.getInt16(scene), 200), data = y.seg(y.u32(scene + 4), 12 * Math.max(count, 0));
    for (let i = 0; i < count && data >= 0; i++) {
      const o = data + 12 * i;
      actors.push({ id: dv.getUint16(o), serial: dv.getUint16(o + 2), x: dv.getFloat32(o + 4), y: dv.getFloat32(o + 8), record: o });
    }
  }

  const textures: Texture[] = [];
  const meshes: Mesh[] = [];
  const instances: Instance[] = [];
  const layers: LevelLayer[] = [];
  const markers: Marker[] = [];
  const push = (mesh: Mesh, matrix: Float32Array, info: DebugInfo) =>
    instances.push({ name: mesh.name, mesh: meshes.push(mesh) - 1, matrix, info }) - 1;

  // Background tile layers, far to near.
  const bgActors = actors
    .map((a, index) => ({ ...a, index, cast: y.casts.get(a.id) }))
    .filter((a) => (a.id & 0xf000) === 0x8000 && a.cast)
    .map((a) => ({ ...a, z: y.seg(a.cast!.attr, 8) >= 0 ? dv.getFloat32(y.seg(a.cast!.attr) + 4) : 500.5 }))
    .sort((a, b) => b.z - a.z);
  let main: { layer: TileLayer; z: number } | null = null;
  const extents: [number, number, number, number][] = []; // placed layers: x, y (down), width, height in world px
  let clearColor: [number, number, number] | undefined;
  for (const a of bgActors) {
    const { castdt, attr } = a.cast!;
    const name = CAST_NAMES.get(a.id) ?? `cast ${hex(a.id)}`;
    const layer = tileLayer(y, castdt);
    if (!layer) continue;
    const kind = /_(enkei|chukan)/.test(name) ? 'background' : /_(kinkei|mask)/.test(name) ? 'foreground' : 'main';
    // The main layer bounds the side view and carries collision, even when it has no tiles.
    if (kind === 'main' && Math.floor(a.z) === 500 && (!main || layer.worldW * layer.worldH > main.layer.worldW * main.layer.worldH)) main = { layer, z: a.z };
    if (!layer.tiles) continue;
    const ut = y.record(y.slot(castdt, 1)), pal = y.record(y.slot(castdt, 2));
    if (!ut || !pal || pal.length < 512) continue;
    const add = y.record(y.slot(castdt, 5));
    const npx = layer.unitW * layer.unitH, nTiles = Math.floor(ut.length / npx);
    const pv = view(pal);
    const tileOf = (v: number) => (v & 0x8000 ? (add && (v & 0x7fff) * 10 + 2 <= add.length ? view(add).getUint16((v & 0x7fff) * 10) : 0) : v);
    const atlas = new TileAtlas(layer.unitW, layer.unitH);
    const placed: [number, number, number][] = [];
    layer.units('tiles', (px, py, v) => {
      const t = tileOf(v);
      if (t <= 0 || t >= nTiles) return;
      const cell = atlas.cell(t, () => {
        const rgba = new Uint8Array(npx * 4);
        for (let i = 0; i < npx; i++) rgba5551(pv.getUint16(ut[t * npx + i] * 2), rgba, i * 4);
        return rgba;
      });
      placed.push([px, py, cell]);
    });
    if (!placed.length) continue;
    const { texture, uv } = atlas.build('CI8/RGBA16 tiles', `cast ${hex(a.id)} ut 0x${y.u32(y.slot(castdt, 1) + 8).toString(16)}`);
    const tex = textures.push(texture) - 1;
    const q = new QuadBuilder();
    for (const [px, py, cell] of placed) q.quad(px, -py, layer.unitW, layer.unitH, uv(cell));

    // Parallax plane: P = r * cam + floor16(r * cam0 - a) - r * cam0 per axis, with the anchor a stored
    // 16 bytes before the attribute record.
    const r = K / (Math.floor(a.z) - 500 + K);
    const at = y.seg(attr, 1);
    const anchor = at >= 16 ? [dv.getInt16(at - 16), dv.getInt16(at - 14)] : [0, 0];
    const c = [0, 1].map((k) => floor16(r * cam0[k] - anchor[k]) - r * cam0[k]);
    const X0 = 160 - (160 + c[0]) / r, Y0 = 120 - (120 + c[1]) / r;
    const s = 1 / r;
    extents.push([X0, Y0, layer.worldW * s, layer.worldH * s]);
    const mesh ={ ...meshFromBatches(name, [q.batch(tex, 'cutout')]), info: { cast: hex(a.id), castdt: `0x${castdt.toString(16)}`, tiles: atlas.size } };
    const instance = push(mesh, new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1, 0, X0, -Y0, depthOf(a.z), 1]), {
      actor: a.index, cast: hex(a.id), record: `0x${a.record.toString(16)}`, z: +a.z.toFixed(3), parallax: +r.toFixed(5), anchor: anchor.join(', '),
    });
    layers.push({ name: `${kind === 'main' ? 'main' : kind === 'background' ? 'far' : 'near'} (${name})`, kind, instances: [instance], depth: +a.z.toFixed(3), parallax: +r.toFixed(4) });
    if (clearColor === undefined) {
      const bg = new Uint8Array(4);
      rgba5551(pv.getUint16(0), bg, 0);
      clearColor = [bg[0], bg[1], bg[2]];
    }
  }

  // Collision overlay from the main layer's collision map: 16 x 16 shape masks (bit 15 leftmost, 1 solid);
  // values with (lo >> 6) == 3 are background coins.
  if (main) {
    const atlas = new TileAtlas(main.layer.unitW, main.layer.unitH);
    const units: [number, number, number, number][] = [];
    main.layer.units('collision', (px, py, v) => {
      const lo = v & 0xff, sel = lo >> 6;
      const shape = sel <= 1 ? y.u32(SHAPE_TABLE + 4 * (sel * 64 + (lo & 0x3f))) : 0;
      const rows = shape >= 0x80000400 ? shape - 0x80000400 + 0x1000 : -1;
      const key = sel === 3 ? -2 : rows;
      const cell = atlas.cell(key, () => {
        const rgba = new Uint8Array(16 * 16 * 4);
        for (let yy = 0; yy < 16; yy++) {
          const bits = rows >= 0 ? y.u16(rows + 2 * yy) : 0xffff;
          for (let xx = 0; xx < 16; xx++) if (bits & (0x8000 >> xx)) rgba.fill(255, (yy * 16 + xx) * 4, (yy * 16 + xx) * 4 + 4);
        }
        return rgba;
      });
      units.push([px, py, cell, sel === 3 ? 5 : ((v >> 11) * 8 + ((v >> 8) & 7)) % 16]); // colour by kind and attribute
    });
    if (units.length) {
      const { texture, uv } = atlas.build('collision masks', 'shape table 0xA5EB4');
      const tex = textures.push(texture) - 1;
      const q = new QuadBuilder();
      for (const [px, py, cell, kind] of units) q.quad(px, -py, 16, 16, uv(cell), [...COLLISION_COLOURS[kind], 110]);
      const mesh = meshFromBatches('collision', [q.batch(tex, 'blend')]);
      const instance = push(mesh, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0.5, 1]), { layer: 'collision of the main layer' });
      layers.push({ name: 'collision', kind: 'collision', instances: [instance], visibleByDefault: false });
    }
  }

  // Objects: unit sprites (first frame of the cast's frame table) and Yoshi at the player start; the rest
  // become markers.
  const objects: number[] = [];
  const markerLayer = layers.length + 1;
  const spriteMesh = new Map<number, number | null>();
  const sprite = (id: number, castdt: number): number | null => {
    let m = spriteMesh.get(id);
    if (m !== undefined) return m;
    m = null;
    // Size record {u16 frame width, height; u16 unit width, height; u16 sheet width, height}: a frame is a
    // grid of units taken row-major from the unit table (slot 3), stored bottom row first like the texels.
    const dims = y.slot(castdt, 0);
    const W = y.u16(dims), H = y.u16(dims + 2);
    const UW = y.u16(dims + 4) || W, UH = y.u16(dims + 6) || H;
    const cols = W / UW, rows = H / UH;
    const valid = W > 0 && H > 0 && W <= 512 && H <= 512 && Number.isInteger(cols) && Number.isInteger(rows);
    const ut = valid ? y.record(y.slot(castdt, 1)) : null;
    const pal = ut && ut.length >= UW * UH && ut.length % (UW * UH) === 0 ? y.record(y.slot(castdt, 2)) : null;
    if (ut && pal && pal.length >= 512) {
      const table = y.record(y.slot(castdt, 3));
      const nUnits = ut.length / (UW * UH);
      const units = Array.from({ length: cols * rows }, (_, k) => {
        const u = table && table.length >= 2 * k + 2 ? view(table).getUint16(2 * k) : k;
        return u < nUnits ? u : 0;
      });
      const rgba = new Uint8Array(W * H * 4);
      const pv = view(pal);
      units.forEach((u, k) => {
        const ox = (k % cols) * UW, oy = Math.floor(k / cols) * UH;
        for (let yy = 0; yy < UH; yy++) {
          for (let xx = 0; xx < UW; xx++) rgba5551(pv.getUint16(ut[u * UW * UH + yy * UW + xx] * 2), rgba, ((oy + yy) * W + ox + xx) * 4);
        }
      });
      const frame = units.join(',');
      if (rgba.some((v, i) => i % 4 === 3 && v)) {
        const tex = textures.push({ width: W, height: H, rgba, wrapS: 'clamp', wrapT: 'clamp', format: 'CI8/RGBA16', source: `cast ${hex(id)} units ${frame}` }) - 1;
        const q = new QuadBuilder();
        // Unit frames are stored bottom row first: the game draws them with a y-up object matrix (D = -1).
        q.quad(-W / 2, H, W, H, [0, 1, 1, 0]);
        m = meshes.push({ ...meshFromBatches(CAST_NAMES.get(id) ?? hex(id), [q.batch(tex, 'cutout')]), info: { cast: hex(id), castdt: `0x${castdt.toString(16)}`, units: frame, size: `${W}x${H}` } }) - 1;
      }
    }
    spriteMesh.set(id, m);
    return m;
  };
  let yoshiMesh: number | null | undefined;
  actors.forEach((a, index) => {
    if ((a.id & 0xf000) === 0x8000) return;
    const cast = y.casts.get(a.id);
    const name = CAST_NAMES.get(a.id) ?? '?';
    const at = cast ? y.seg(cast.attr, 0x54) : -1;
    const zRaw = at >= 0 ? dv.getFloat32(at + 4) : 500.4;
    const z = zRaw > 400 && zRaw < 5000 ? zRaw : 500.4;
    const info: DebugInfo = { actor: index, cast: hex(a.id), name, serial: a.serial, x: a.x, y: a.y, record: `0x${a.record.toString(16)}` };
    // Exits: attribute +0x34 -> {u32 0x20; u32 0; EXITIF {u32 name; u8 world; ...}}.
    const extra = at >= 0 ? y.seg(y.u32(at + 0x34), 32) : -1;
    const exit = extra >= 0 && y.u32(extra) === 0x20 && y.u32(extra + 4) === 0 ? rom[extra + 12] : -1;
    if (exit >= 0) info.exitTo = `${exit} ${WORLD_NAMES[exit] ?? ''}`.trim();
    let mesh: number | null = null;
    if (a.id === PLAYER_START) {
      if (yoshiMesh === undefined) {
        const cell = yoshiCell(rom, 0, 0, textures);
        yoshiMesh = cell ? meshes.push(cell) - 1 : null;
      }
      mesh = yoshiMesh;
    } else if (cast) {
      mesh = sprite(a.id, cast.castdt);
    }
    if (mesh !== null) {
      objects.push(instances.push({ name: meshes[mesh].name, mesh, matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, a.x, -a.y, depthOf(z), 1]), info }) - 1);
    } else {
      markers.push({ label: `${hex(a.id)} ${name}${exit >= 0 ? ` → ${WORLD_NAMES[exit] ?? exit}` : ''}`, position: [a.x, -a.y, depthOf(z)], layer: markerLayer, info });
    }
  });
  layers.push({ name: 'objects', kind: 'objects', instances: objects });
  layers.push({ name: 'markers', kind: 'markers', instances: [] });

  // Side view: the game's camera frame is the screen's top-left corner in main-layer pixels; the eye looks
  // at its centre from K in front. Pan limits keep the view on the main layer, or on the placed layers when
  // the world has none.
  let [rx, ry, rw, rh] = [0, 0, 320, 240];
  if (main) [rw, rh] = [main.layer.worldW, main.layer.worldH];
  else if (extents.length) {
    const x0 = Math.min(...extents.map((e) => e[0])), y0 = Math.min(...extents.map((e) => e[1]));
    [rx, ry, rw, rh] = [x0, y0, Math.max(...extents.map((e) => e[0] + e[2])) - x0, Math.max(...extents.map((e) => e[1] + e[3])) - y0];
  }
  const bx = [rx + Math.min(160, rw / 2), rx + Math.max(rw - 160, rw / 2)], byy = [ry + Math.min(120, rh / 2), ry + Math.max(rh - 120, rh / 2)];
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const extra: Partial<Level> = {
    layers, markers, pixelArt: true, clearColor: clearColor ?? [0, 0, 0],
    sideView: {
      fovY: FOV_Y, distance: K,
      start: [clamp(cam0[0] + 160, bx[0], bx[1]), -clamp(cam0[1] + 120, byy[0], byy[1])],
      bounds: { min: [bx[0], -byy[1]], max: [bx[1], -byy[0]] },
    },
  };
  return buildLevel(def.info, `yoshistory-${def.world}`, textures, meshes, instances, extra);
}

export function openYoshiStory(rom: Uint8Array): Game {
  if (rom[0x3f] !== 0) throw new Error("Unsupported Yoshi's Story revision (only the Japanese revision 0 is supported)");
  const y = new YoshiRom(rom);
  const defs = levelDefs();
  return {
    id: 'yoshistory',
    title: "Yoshi's Story",
    levels: defs.map((d) => d.info),
    loadLevel: (i) => {
      const def = defs[i];
      if (!def) throw new Error(`No level ${i}`);
      return loadLevel(y, def);
    },
    music: listYoshiMusic(),
    decodeMusic: (i) => decodeYoshiMusic(rom, i),
  };
}
