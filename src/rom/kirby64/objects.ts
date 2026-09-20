import type { Level } from '../types';
import { f32, KirbyArchive, s16, u32 } from './fs';
import { decodeGeometry, placeModel, rpyMatrix, type DecodedModel } from './geometry';
import type { Placement, SetupRecord } from './types';

const DIRECT_TABLES: Record<number, { rom: number; count: number }> = {
  0: { rom: 0x168ef4, count: 107 },
  1: { rom: 0x1e416c, count: 3 },
  2: { rom: 0x17b37c, count: 7 },
  3: { rom: 0x1690a0, count: 14 },
};

const BANK7_MODELS = new Map<string, number>([
  ['0/0', 0x0002006a], ['1/0', 0x0002006f], ['1/1', 0x0002006f], ['1/2', 0x0002006f],
  ['2/0', 0x00020067], ['3/0', 0x0002006f], ['4/0', 0x0002006f], ['5/0', 0x0002006f],
  ['6/0', 0x00020060], ['7/0', 0x0002006c], ['9/0', 0x00020068], ['10/0', 0x0002006b],
]);

function readPlacements(archive: KirbyArchive, setup: SetupRecord): Placement[] {
  if (!setup.entities) return [];
  const out: Placement[] = [], rom = archive.rom;
  for (let at = setup.entities, count = 0; at + 4 <= setup.extent.end && count < 0x1000; at += 0x2c, count++) {
    if (u32(rom, at) === 0x99999999) return out;
    if (at + 0x2c > setup.extent.end) break;
    out.push({
      record: at, node: rom[at], bank: rom[at + 1], entityId: rom[at + 2], action: rom[at + 3],
      controlFlags: rom[at + 4], behaviorFlags: rom[at + 5], saveIndex: s16(rom, at + 6),
      position: [f32(rom, at + 8), f32(rom, at + 0xc), f32(rom, at + 0x10)],
      rotation: [f32(rom, at + 0x14), f32(rom, at + 0x18), f32(rom, at + 0x1c)],
      scaleAux: [f32(rom, at + 0x20), f32(rom, at + 0x24), f32(rom, at + 0x28)],
    });
  }
  throw new Error(`Kirby 64: unterminated entity list in setup ${setup.extent.index}`);
}

function geometryFor(archive: KirbyArchive, p: Placement): number {
  const table = DIRECT_TABLES[p.bank];
  if (table) return p.entityId < table.count ? u32(archive.rom, table.rom + p.entityId * 4) : 0;
  if (p.bank === 7) return BANK7_MODELS.get(`${p.entityId}/${p.action}`) ?? 0;
  return 0;
}

function objectLabel(p: Placement): string {
  if (p.bank === 3 && p.entityId === 7) return 'Crystal Shard';
  if (p.bank === 3) return `Item ${p.entityId}`;
  if (p.bank === 1) return `Character encounter ${p.entityId}`;
  if (p.bank === 2) return `World boss controller ${p.entityId}`;
  if (p.bank === 5) return `Stage resource 0x${((p.action << 8) | p.entityId).toString(16).padStart(3, '0')}`;
  if (p.bank === 7) return `Helper ${p.entityId} action ${p.action}`;
  if (p.bank === 8) return `Mini-boss controller ${p.entityId}`;
  return `Actor ${p.entityId} action ${p.action}`;
}

function unresolvedReason(p: Placement, geometry: number): string {
  if (p.bank === 5) return ((p.action << 8) | p.entityId) >= 0x115 ? 'constructor rejects selector' : 'stage-overlay resource model unresolved';
  if (p.bank === 8) return 'stage-overlay-specific encounter visual unresolved';
  if ((p.bank === 1 || p.bank === 2) && !geometry) return 'common model table is null; stage-specific visual unresolved';
  if (p.bank === 7 && !geometry) return 'helper has no own static model';
  return 'no verified static model mapping';
}

export function appendObjects(archive: KirbyArchive, level: Level, setup: SetupRecord,
                              objectInstances: number[], markerLayer: number): { placements: number; modeled: number; markers: number } {
  const placements = readPlacements(archive, setup), cache = new Map<number, DecodedModel>();
  level.markers ??= [];
  let modeled = 0, markers = 0;
  for (const p of placements) {
    const geometry = geometryFor(archive, p), label = objectLabel(p);
    const info = {
      placementROM: `0x${p.record.toString(16)}`, bank: p.bank, entityId: p.entityId, action: p.action,
      pathNode: p.node, pathParameter: p.scaleAux[1], controlFlags: p.controlFlags, behaviorFlags: p.behaviorFlags,
      saveIndex: p.saveIndex, absolutePlacement: p.controlFlags & 1 ? 1 : 0,
    };
    if (geometry) {
      let model = cache.get(geometry);
      if (!model) {
        model = decodeGeometry(archive, level, geometry, `${label} model ${geometry >>> 16}:${geometry & 0xffff}`);
        cache.set(geometry, model);
      }
      if (model.parts.length) {
        const before = level.instances.length;
        const scale = Number.isFinite(p.scaleAux[0]) ? p.scaleAux[0] : 1;
        placeModel(level, model, rpyMatrix(p.position, p.rotation, [scale, scale, scale]), objectInstances, label, info);
        for (let i = before; i < level.instances.length; i++) level.instances[i].animated = true;
        modeled++;
        continue;
      }
    }
    level.markers.push({
      label: `${label} — ${unresolvedReason(p, geometry)}`,
      position: [-p.position[0], p.position[1], p.position[2]], layer: markerLayer,
      info: { ...info, ...(geometry ? { geometryId: `${geometry >>> 16}:${geometry & 0xffff}` } : {}) },
    });
    markers++;
  }
  return { placements: placements.length, modeled, markers };
}
