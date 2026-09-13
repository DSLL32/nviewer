// Explicit first-wave bbgames Zelda source assets. The browser reads only these paths; selecting bbgames does not
// read either source tree wholesale.
export interface ZeldaSourceLevelSpec {
  key: string;
  name: string;
  group: string;
  scene: string;
  rooms: string[];
  mode?: 'scene' | 'fragment' | 'tool-rom';
}

const top = (key: string, rooms: number, name = key): ZeldaSourceLevelSpec => ({
  key,
  name,
  group: 'Unreferenced complete scenes',
  scene: `data/${key}_SCENE.o`,
  rooms: Array.from({ length: rooms }, (_, i) => `data/${key}_ROOM${i}.o`),
});

export const ZELDA_SOURCE_LEVELS: ZeldaSourceLevelSpec[] = [
  {
    key: 'Ddanh_noanime', name: 'Ddanh_noanime (discarded scene)', group: 'Discarded complete scenes',
    scene: 'data/shape2/zelda_scene/.GOMI/Ddanh_noanime/Ddanh.o',
    rooms: Array.from({ length: 17 }, (_, i) => `data/shape2/zelda_scene/.GOMI/Ddanh_noanime/ROOM${i}/ROOM${i}.o`),
  },
  top('Ddanh', 17),
  top('Ddanh_ddtes', 4),
  top('Fstdan', 10, 'Fstdan (deleted)'),
  top('Hakadan_ch_dd', 2),
  top('Hakadan_dd', 4),
  top('Jyasinzou_dd', 4),
  top('K_Home.bak', 1),
  top('Kinsuta2', 1),
  top('Kokiri.bak', 1),
  top('Mori_dd', 4),
  top('Spot04_OLD', 1),
  top('Test01_BAK', 1),
  top('Ydan_ddtes', 2),
  top('Z2_DD_IKE', 6),
  top('Z2_ReDead', 14),
  {
    key: 'K_Home5_old', name: 'K_Home5 (older hidden scene)', group: 'Hidden tool scenes',
    scene: 'data/shape2/zelda_tool_scene/K_Home4/K_Home5.oo', rooms: ['data/K_Home5_ROOM0.o'],
  },
  {
    key: 'zelda_tool_rom', name: 'zelda_tool_rom historical payload', group: 'Hidden tool scenes',
    scene: 'data/shape2/zelda_tool_rom/tool_data.o', rooms: [], mode: 'tool-rom',
  },
  ...([['Bdan_dd', 5], ['Hidan_dd', 4], ['Mizusin_dd', 4]] as const).map(([key, count]): ZeldaSourceLevelSpec => ({
    key, name: `${key} (tool geometry)`, group: 'Tool-only geometry fragments', mode: 'fragment',
    scene: `data/shape2/zelda_tool_scene/${key}/${key}.o`,
    rooms: Array.from({ length: count }, (_, i) => `data/shape2/zelda_tool_scene/${key}/ROOM${i}/ROOM${i}.o`),
  })),
];

export const ZELDA_SOURCE_PATHS = [...new Set(ZELDA_SOURCE_LEVELS.flatMap((l) => [l.scene, ...l.rooms]))];

export const ZELDA_SOURCE_ALTERNATIVES: Readonly<Record<string, readonly string[]>> = {
  'data/shape2/zelda_tool_rom/tool_data.o': ['data/shape2/zelda_tool_rom/zelda_tool_rom.o'],
};

export function selectZeldaSourceTree(names: Iterable<string>): 'z_ocarina' | 'z_ocarina2' {
  const set = new Set(names);
  if (set.has('z_ocarina2')) return 'z_ocarina2';
  if (set.has('z_ocarina')) return 'z_ocarina';
  throw new Error('Choose the bbgames folder itself. It must directly contain z_ocarina and/or z_ocarina2.');
}
