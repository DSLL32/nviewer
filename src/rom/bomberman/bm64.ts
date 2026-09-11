// Bomberman 64 (U): battle stages and adventure areas.
//
// Every stage area is a code overlay that loads its map container from the asset archive
// (ROM 0x300000) and sets up the scene: extra map parts, fog, clear colour, light
// direction/colour and a 2D background picture. Those calls are hard-coded in the
// overlays, so the tables below list their arguments (see BOMBERMAN.md 4.1 and 5.4).
// Map vertices are world coordinates (scale 1, right-handed, Y up).
import type { DlLighting } from '../displaylist';
import type { Backdrop, CameraView, Game, Instance, Level, LevelInfo, LevelLayer, Marker, Mesh, Texture } from '../types';
import { type Archive, bm64Assets } from './archive';
import { addCollisionLayer, bm64CollisionGroups, collisionInstances, hex, parseBm64Attributes } from './collision';
import { buildLevel, fogPosition, lighting, meshFromBatches, translation, withAlpha } from './common';
import { containerImage, drawContainer } from './container64';
import { bombermanMusic } from './music';

interface Part {
  asset: number;
  at?: [number, number, number];
  alpha?: number; // drawn translucent by game code
}

interface AreaDef {
  name: string;
  kind: 'battle' | 'adventure';
  group?: string;
  map: number;
  attr: number; // attribute (collision) file: the overlay's loadAttributes argument
  parts?: Part[];
  fog?: [number, number, number, number, number]; // setFog(min, max, r, g, b)
  clear?: [number, number, number];
  background?: number; // asset holding the picture
  window?: [number, number, number, number];
  lightDir?: [number, number, number];
  lightColor?: [number, number, number];
  camera?: CameraView;
}

const WORLDS = ['Green Garden', 'Blue Resort', 'Red Mountain', 'White Glacier', 'Black Fortress', 'Rainbow Palace'];

const battle = (name: string, map: number, attr: number, extra: Partial<AreaDef> = {}): AreaDef => ({ name, kind: 'battle', map, attr, ...extra });
const area = (world: number, name: string, map: number, attr: number, extra: Partial<AreaDef> = {}): AreaDef => ({
  name, kind: 'adventure', group: WORLDS[world], map, attr, ...extra,
});

const GG_SKY: [number, number, number] = [55, 77, 255];
const RM_SKY: [number, number, number] = [255, 161, 29];
const WG_SKY: [number, number, number] = [230, 240, 255];
const BR_EAST: [number, number, number] = [45, 110, 44];
const BF_LIGHT: [number, number, number] = [15, 126, 0];
const TOWER_Y = 12000;
const tower = (...extra: number[]): Part[] => [...extra.map((asset) => ({ asset })), { asset: 199 }, { asset: 199, at: [0, TOWER_Y, 0] }];
const trapTower = (name: string, map: number, attr: number, parts: Part[]): AreaDef =>
  area(4, name, map, attr, { parts, fog: [966, 1000, 0, 255, 255], clear: [0, 255, 255] });

// Battle stages in stage-select order (overlays 0x90-0x99), then the adventure areas with a
// map file (boss arenas built only from object models are left out).
const AREAS: AreaDef[] = [
  battle('Rock Garden', 513, 537, {
    camera: { eye: [2300, 2400, 3101], target: [2300, 0, 3101 - 2400 / Math.tan((55 * Math.PI) / 180)], fovY: 30 },
  }),
  // The water is a 6600 x 6600 quad drawn at 60% over black; 515 is the central platform.
  battle('UP and Down', 514, 538, { parts: [{ asset: 516, at: [0, -400, 0], alpha: 0.6 }, { asset: 515, at: [2350, 800, 1550] }] }),
  // Backdrop: 80 x 60 texels of the 160 x 160 picture from row 57, magnified 4x.
  battle('Pyramid', 518, 539, { parts: [{ asset: 519, at: [0, -400, 0], alpha: 0.6 }], background: 662, window: [0, 57 / 160, 0.5, 117 / 160] }),
  battle('Greedy TraP', 520, 540, { parts: [{ asset: 523 }] }),
  battle('Top Rules', 525, 541),
  battle('Field of Grass', 529, 542, { background: 662 }),
  battle('In the Gutter', 530, 543, { background: 662 }),
  battle('Sea Sick', 534, 544, { clear: [200, 200, 255] }),
  battle('Blizzard Battle', 535, 545, { parts: [{ asset: 218 }], clear: [90, 140, 255] }),
  battle('Lost at Sea', 536, 546),

  area(0, 'Untouchable Treasure, area 1', 578, 588, { clear: GG_SKY }),
  area(0, 'Untouchable Treasure, area 2', 579, 589, { clear: GG_SKY }),
  area(0, 'Untouchable Treasure, area 3', 580, 590),
  area(0, 'Untouchable Treasure, area 4', 581, 591),
  area(0, 'Untouchable Treasure, area 5', 582, 592),
  area(0, 'Friend or Foe?', 587, 597, { background: 662, clear: GG_SKY }),
  area(0, 'To Have or Have Not, area 1', 583, 593),
  area(0, 'To Have or Have Not, area 2', 584, 594),
  area(0, 'To Have or Have Not, area 3', 585, 595),
  area(0, 'To Have or Have Not, area 4', 586, 596, { clear: GG_SKY }),

  area(1, 'Switches and Bridges, area 1', 314, 320, { clear: [0, 0, 0] }),
  area(1, 'Switches and Bridges, area 2', 315, 321, { lightDir: [45, 110, -44] }),
  area(1, 'Switches and Bridges, area 3', 316, 322, { lightDir: [55, 114, 0] }),
  area(1, 'Switches and Bridges, area 4', 317, 323, { lightDir: BR_EAST }),
  area(1, 'Switches and Bridges, area 5', 319, 325, { lightDir: BR_EAST }),
  area(1, 'Pump it Up!', 318, 324, { lightDir: BR_EAST }),

  area(2, 'Hot on the Trail, area 1', 389, 400, { clear: RM_SKY }),
  area(2, 'Hot on the Trail, area 2', 391, 401, { clear: RM_SKY }),
  area(2, 'Hot on the Trail, area 3', 393, 402, { clear: RM_SKY }),
  area(2, 'Hot on the Trail, area 4', 395, 403, { clear: RM_SKY }),
  area(2, 'Hot on the Trail, area 5', 397, 404, { clear: RM_SKY }),
  area(2, 'Side room', 399, 405, { fog: [850, 930, 0, 0, 48] }),
  area(2, 'VS Orion', 426, 427),
  area(2, 'On the Right Track, area 1', 409, 421, { fog: [943, 990, 255, 135, 31], clear: RM_SKY }),
  area(2, 'On the Right Track, area 2', 411, 422, { fog: [920, 990, 255, 135, 31], clear: RM_SKY }),
  area(2, 'On the Right Track, area 3', 413, 423, { fog: [915, 990, 255, 135, 31], clear: RM_SKY }),
  area(2, 'On the Right Track, area 4', 416, 424, { fog: [910, 990, 255, 135, 31], clear: RM_SKY }),
  area(2, 'On the Right Track, area 5', 418, 425, { fog: [890, 990, 255, 135, 31], clear: RM_SKY }),
  area(2, 'Hot Avenger', 465, 466),

  area(3, 'Blizzard Peaks, area 1', 547, 567, { fog: [945, 970, ...WG_SKY], clear: WG_SKY }),
  area(3, 'Blizzard Peaks, area 2', 548, 568, { fog: [930, 950, ...WG_SKY], clear: WG_SKY }),
  area(3, 'Blizzard Peaks, area 3', 550, 569, { fog: [945, 970, ...WG_SKY], clear: WG_SKY }),
  area(3, 'Blizzard Peaks, area 4', 551, 570, { fog: [860, 960, ...WG_SKY], clear: WG_SKY }),
  area(3, 'VS Regulus', 566, 577, { background: 633 }),
  area(3, 'Shiny Slippy Icy Floor, area 1', 554, 573, { background: 633 }),
  area(3, 'Shiny Slippy Icy Floor, area 2', 557, 574, { background: 633 }),
  area(3, 'Shiny Slippy Icy Floor, area 3', 560, 575, { background: 633 }),
  area(3, 'Shiny Slippy Icy Floor, area 4', 563, 576, { background: 633 }),
  area(3, 'Cold Killers', 638, 635, { fog: [971, 975, 0, 0, 0], clear: [0, 0, 0] }),

  area(4, 'Go for Broke, area 1', 468, 481, { parts: [467, 469, 470, 471].map((asset) => ({ asset })) }),
  area(4, 'Go for Broke, area 2', 472, 482, { parts: [{ asset: 473 }, { asset: 474 }], lightDir: BF_LIGHT }),
  area(4, 'Go for Broke, area 3', 476, 483, { parts: [{ asset: 477 }, { asset: 468 }, { asset: 469 }, { asset: 469, at: [7600, 0, 0] }] }),
  area(4, 'Go for Broke, area 4', 472, 484, { parts: [{ asset: 473 }, { asset: 475 }], lightDir: BF_LIGHT }),
  area(4, 'Go for Broke, area 5', 468, 485, { parts: [{ asset: 478 }, { asset: 479 }, { asset: 469, at: [7600, 0, 0] }] }),
  area(4, 'Go for Broke, area 6', 480, 486),
  area(4, 'High-Tech Harvester', 700, 701, { lightColor: [2, 2, 25] }),
  trapTower('Trap Tower, area 1', 489, 499, tower(490)),
  trapTower('Trap Tower, area 2', 491, 500, tower(492)),
  trapTower('Trap Tower, area 3', 493, 502, [...tower(494), { asset: 186 }]),
  trapTower('Trap Tower, area 4', 495, 503, [{ asset: 199 }]),
  trapTower('Trap Tower, area 5', 496, 504, tower()),
  trapTower('Trap Tower, area 6', 497, 505, tower(498)),
  area(4, 'VS Altair', 506, 507),

  area(5, 'Beyond the Clouds..., area 1', 729, 735, { background: 741 }),
  area(5, 'Beyond the Clouds..., area 2', 730, 736, { background: 741 }),
  // The overlay passes no blue component (stale stack word); 0 is assumed.
  area(5, 'Doom Castle, area 1', 731, 737, { background: 741, fog: [885, 955, 30, 25, 0], lightDir: BF_LIGHT }),
  area(5, 'Doom Castle, area 2', 730, 738, { background: 741 }),
];

export const BM64_LEVELS: LevelInfo[] = AREAS.map((a, index) => ({
  index, name: a.name, kind: a.kind, ...(a.group ? { group: a.group } : {}),
}));

// Master display list lights: L0 0x323232 and L1 0xC8C8C8 along (0, 114, 55), ambient
// 0x505050. Overlays can change both directions and the colour of L0; model lists set the
// colours of L1 and ambient themselves.
function areaLighting(a: AreaDef): DlLighting {
  const dir = a.lightDir ?? [0, 114, 55];
  const c = a.lightColor ? (a.lightColor[0] << 16) | (a.lightColor[1] << 8) | a.lightColor[2] : 0x323232;
  return lighting([{ color: c, dir }, { color: 0xc8c8c8, dir }], 0x505050);
}

function loadArea(assets: Archive, index: number): Level {
  const a = AREAS[index];
  if (!a) throw new Error(`No level ${index}`);
  const textures: Texture[] = [];
  const textureKeys = new Map<string, number>();
  const meshes: Mesh[] = [];
  const meshOf = new Map<string, number>();
  const instances: Instance[] = [];
  const light = areaLighting(a);
  const mapLayer: LevelLayer = { name: 'map', kind: 'main', instances: [] };
  const layers: LevelLayer[] = [mapLayer];

  const place = (def: string, asset: number, at: [number, number, number] = [0, 0, 0], alpha?: number) => {
    const key = `${asset}/${alpha ?? 1}`;
    let mi = meshOf.get(key);
    if (mi === undefined) {
      const file = assets.file(asset);
      let mesh = meshFromBatches(`asset ${asset}`, drawContainer(file, 0, {
        textures, textureKeys, keyPrefix: `${asset}:`, lighting: light,
      }));
      if (alpha !== undefined) mesh = withAlpha(mesh, alpha);
      mesh.info = { asset, rom: `0x${assets.romOffset(asset).toString(16)}`, ...(alpha !== undefined ? { alpha } : {}), triSource: `offset in asset ${asset} (decompressed)` };
      mi = meshes.push(mesh) - 1;
      meshOf.set(key, mi);
    }
    // Placed by the area overlay's code (AREAS table here), not by a placement file.
    mapLayer.instances.push(instances.push({ name: `asset ${asset}`, mesh: mi, matrix: translation(...at), info: { area: index, def, asset } }) - 1);
  };
  place('map', a.map);
  (a.parts ?? []).forEach((p, k) => place(`parts[${k}]`, p.asset, p.at, p.alpha));

  const extra: Partial<Level> = { layers };
  // The attribute grid (the game's only map collision), in hidden layers: cell shapes, then object and trigger
  // volumes, then spawn markers.
  const grid = parseBm64Attributes(assets.file(a.attr));
  const collision = bm64CollisionGroups(grid, { area: index, asset: a.attr, rom: hex(assets.romOffset(a.attr)) });
  addCollisionLayer(meshes, instances, layers, collision.terrain);
  addCollisionLayer(meshes, instances, layers, collision.cells, 'attribute volumes');
  if (collision.markers.length) {
    const layer = layers.push({ name: 'attribute markers', kind: 'markers', instances: [], visibleByDefault: false }) - 1;
    extra.markers = collision.markers.map((m): Marker => ({
      label: `marker ${m.id}`, position: [m.x, m.y, m.z], layer,
      info: { asset: a.attr, code: hex(m.code), cell: m.cell.join(', ') },
    }));
  }
  // Most scenes clear the colour buffer to black; scenes with a background picture don't.
  if (a.background !== undefined) {
    const picture = containerImage(assets.file(a.background));
    if (picture) {
      const [u0, v0, u1, v1] = a.window ?? [0, 0, 1, 1];
      extra.backdrop = { texture: textures.push(picture) - 1, u0, v0, u1, v1 } satisfies Backdrop;
    }
  }
  extra.clearColor = a.clear ?? [0, 0, 0];
  // Projection near 200, far 20000 (guPerspective fovy 30).
  if (a.fog) extra.fog = fogPosition(a.fog[0], a.fog[1], [a.fog[2], a.fog[3], a.fog[4]], 200, 20000);
  if (a.camera) extra.camera = a.camera;
  return buildLevel(BM64_LEVELS[index], `bm64-${index}`, textures, meshes, instances, extra, collisionInstances(layers));
}

export function openBomberman64(rom: Uint8Array): Game {
  const assets = bm64Assets(rom);
  const music = bombermanMusic(rom, 'bm64');
  return {
    id: 'bm64',
    title: 'Bomberman 64',
    levels: BM64_LEVELS,
    loadLevel: (i) => loadArea(assets, i),
    music: music.tracks,
    decodeMusic: (i) => music.decode(i),
  };
}
