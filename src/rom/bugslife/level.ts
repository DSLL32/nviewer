import { buildLevel, fogPosition, IDENTITY } from '../bomberman/common';
import type { CameraView, Level, LevelInfo, MeshSky, Texture } from '../types';
import { parseFiniteCollision } from './all';
import { BugsLifeArchive, openBugsLifeArchive } from './archive';
import { parseBugsLifeGeometry, type BugsLifeMaterial } from './mesh';
import { creatureMarkers } from './objects';
import { decodeParallax, decodeTpg, parallaxSkyMesh } from './texture';

interface Definition { name: string; internalId: number; kind: LevelInfo['kind'] }

const DEFINITIONS: readonly Definition[] = [
  { name: 'Training', internalId: 17, kind: 'campaign' },
  { name: 'Ant Island', internalId: 1, kind: 'campaign' },
  { name: 'Tunnels', internalId: 3, kind: 'campaign' },
  { name: 'Council Chamber', internalId: 2, kind: 'campaign' },
  { name: 'Cliffside', internalId: 6, kind: 'campaign' },
  { name: 'Riverbed Canyon', internalId: 10, kind: 'campaign' },
  { name: 'Birdnest', internalId: 11, kind: 'campaign' },
  { name: 'City Entrance', internalId: 4, kind: 'campaign' },
  { name: 'City Square', internalId: 5, kind: 'campaign' },
  { name: 'Bug Bar', internalId: 14, kind: 'campaign' },
  { name: 'Clover Forest', internalId: 7, kind: 'campaign' },
  { name: 'The Tree', internalId: 12, kind: 'campaign' },
  { name: 'Battle Arena', internalId: 13, kind: 'campaign' },
  { name: 'Anthill, Part Two', internalId: 9, kind: 'campaign' },
  { name: 'Riverbed Flight', internalId: 8, kind: 'campaign' },
  { name: 'Canyon Showdown', internalId: 15, kind: 'campaign' },
  { name: 'Bonus', internalId: 16, kind: 'campaign' },
];

export const BUGSLIFE_LEVELS: LevelInfo[] = DEFINITIONS.map((definition, index) => ({
  index, name: definition.name, kind: definition.kind,
}));

const STEMS: Record<number, string> = {
  1: 'ant', 2: 'counc', 3: 'tunnel', 4: 'bugcit', 5: 'citsq', 6: 'over', 7: 'clover', 8: 'river',
  9: 'ant', 10: 'rivroc', 11: 'birdb', 12: 'tree', 13: 'banq', 14: 'bar', 15: 'end', 16: 'cus', 17: 'train',
};
const PARALLAX_LEVELS = new Set([1, 6, 7, 8, 9, 10, 11, 12, 17]);

function levelPath(id: number, file: string): string { return `level${id.toString().padStart(2, '0')}/${file}`; }

function pagePath(archive: BugsLifeArchive, id: number, page: number): string | null {
  if (id === 3 && page === 3) return levelPath(3, 'light.tpg');
  const sourceId = id === 9 ? 1 : id;
  const path = levelPath(sourceId, `${STEMS[id]}${page.toString().padStart(2, '0')}.tpg`);
  return archive.entry(path) ? path : null;
}

function materials(archive: BugsLifeArchive, id: number, textures: Texture[]) {
  const pages = new Map<number, { slots: Map<number, BugsLifeMaterial>; first: BugsLifeMaterial | null }>();
  return (page: number, slot: number): BugsLifeMaterial | null => {
    let decodedPage = pages.get(page);
    if (!decodedPage) {
      const slots = new Map<number, BugsLifeMaterial>();
      const path = pagePath(archive, id, page);
      if (path) for (const decoded of decodeTpg(archive.file(path), path)) {
        const texture = textures.push(decoded.texture) - 1;
        slots.set(decoded.slot, { texture, width: decoded.texture.width, height: decoded.texture.height, source: decoded.texture.source! });
      }
      decodedPage = { slots, first: slots.values().next().value ?? null };
      pages.set(page, decodedPage);
    }
    // The game's texture setup falls back to the page's first live pointer
    // when a slot is null (US 0x80013810..0x80013818).
    return decodedPage.slots.get(slot) ?? decodedPage.first;
  };
}

function overview(bounds: { min: [number, number, number]; max: [number, number, number] }): CameraView {
  // Authored placement centres are a better starting view than full vertex
  // bounds: several route stages deliberately retain very distant geometry.
  // Frame the middle 30% of placements, with sane limits for sparse stages.
  const center: [number, number, number] = [0, 1, 2].map((axis) => (bounds.min[axis] + bounds.max[axis]) / 2) as [number, number, number];
  const span = Math.min(30000, Math.max(15000, ...[0, 1, 2].map((axis) => bounds.max[axis] - bounds.min[axis])));
  return { eye: [center[0] + span * 0.55, center[1] + span * 0.35, center[2] + span * 0.7], target: center, fovY: 75 };
}

export function loadBugsLifeLevel(rom: Uint8Array, index: number): Level {
  if (!Number.isInteger(index) || index < 0 || index >= DEFINITIONS.length) throw new Error(`invalid A Bug's Life level ${index}`);
  const definition = DEFINITIONS[index], id = definition.internalId, archive = openBugsLifeArchive(rom);
  const textures: Texture[] = [], meshes: Level['meshes'] = [], instances: Level['instances'] = [], layers: NonNullable<Level['layers']> = [];
  const geometry = parseBugsLifeGeometry(archive.file(levelPath(id, 'level.dat')), definition.name, materials(archive, id, textures));
  const meshBase = meshes.length, instanceBase = instances.length;
  meshes.push(...geometry.meshes);
  instances.push(...geometry.instances.map((instance) => ({
    ...instance, mesh: instance.mesh + meshBase,
    info: { ...instance.info, file: levelPath(id, 'level.dat'), internalId: id },
  })));
  layers.push({ name: 'main', kind: 'main', instances: geometry.instances.map((_, i) => instanceBase + i) });

  const collision = parseFiniteCollision(archive.file(levelPath(id, 'terrain.all')), `${definition.name} collision`);
  const collisionMesh = meshes.push(collision.mesh) - 1;
  const collisionInstance = instances.push({ name: `${definition.name} collision`, mesh: collisionMesh, matrix: IDENTITY.slice(), noFog: true,
    info: { file: levelPath(id, 'terrain.all'), finiteGroups: collision.finiteGroups, infiniteGroupsOmitted: collision.infiniteGroups } }) - 1;
  layers.push({ name: 'collision', kind: 'collision', instances: [collisionInstance], visibleByDefault: false });

  const markers = creatureMarkers(archive.file(`creat/creat${id.toString().padStart(2, '0')}.bin`), id, layers);
  let skies: MeshSky[] | undefined, clearColor: [number, number, number] = [100, 145, 190];
  if (PARALLAX_LEVELS.has(id)) {
    const path = `parallax/level${id.toString().padStart(2, '0')}.par`, data = archive.file(path);
    const texture = decodeParallax(data, path), textureIndex = textures.push(texture) - 1;
    const built = parallaxSkyMesh(textureIndex, path), mesh = meshes.push(built.mesh) - 1;
    skies = [{ ...built.sky, mesh }];
    const pixel = (data[504] << 8) | data[505];
    clearColor = [(pixel >>> 8) & 0xf8, (pixel >>> 3) & 0xf8, (pixel << 2) & 0xf8];
  }

  const hidden = new Set([collisionInstance]);
  const level = buildLevel(BUGSLIFE_LEVELS[index], `bugslife-${archive.version.code.toLowerCase()}-${id.toString().padStart(2, '0')}`,
    textures, meshes, instances, {
      layers, markers, clearColor, ...(skies ? { skies } : {}),
      ...(id === 17 ? { fog: fogPosition(550, 1000, [120, 120, 255], 4, 32768) } : {}),
    }, hidden);
  level.camera = overview(geometry.focusBounds);
  return level;
}
