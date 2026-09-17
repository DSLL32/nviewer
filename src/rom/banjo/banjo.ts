import type { Game } from '../types';
import { BanjoRom } from './archive';
import { loadBanjoLevel, loadBanjoTestModels, mapEntries, mapLevels } from './level';
import { decodeBanjoMusic, listBanjoMusic } from './music';

export function openBanjoKazooie(rom: Uint8Array): Game {
  const archive = new BanjoRom(rom);
  const rawEntries = mapEntries(archive.core2);
  const rawLevels = mapLevels(archive.core2, rawEntries);
  const groups = ['Spiral Mountain', "Gruntilda's Lair", "Mumbo's Mountain", 'Treasure Trove Cove',
    "Clanker's Cavern", 'Bubblegloop Swamp', 'Freezeezy Peak', "Gobi's Valley", 'Mad Monster Mansion',
    'Rusty Bucket Bay', 'Click Clock Wood', 'Cutscenes and front end'];
  const mainMaps = new Set([0x01, 0x69, 0x02, 0x07, 0x0b, 0x0d, 0x27, 0x12, 0x1b, 0x31, 0x40]);
  const ordered = rawEntries.map((entry, index) => ({ entry, info: rawLevels[index] }))
    .sort((a, b) => {
      const group = groups.indexOf(a.info.group ?? '') - groups.indexOf(b.info.group ?? '');
      if (group) return group;
      const main = Number(mainMaps.has(b.entry.map)) - Number(mainMaps.has(a.entry.map));
      return main || a.entry.map - b.entry.map;
    });
  const entries = ordered.map((row) => row.entry);
  const levels = ordered.map((row, index) => ({ ...row.info, index }));
  const archivalIndex = entries.length;
  levels.push({ index: archivalIndex, name: 'Test map models (USA V1.0, archival)', kind: 'other', group: 'Archive models' });
  return {
    id: 'banjokazooie',
    title: 'Banjo-Kazooie (USA V1.0)',
    levels,
    music: listBanjoMusic(rom),
    decodeMusic: (index) => decodeBanjoMusic(rom, index),
    loadLevel(index) {
      if (index === archivalIndex) return loadBanjoTestModels(archive, levels[index]);
      const entry = entries[index];
      if (!entry) throw new Error(`Banjo-Kazooie map index ${index} is not selectable`);
      return loadBanjoLevel(archive, entry, levels[index]);
    },
  };
}
