import type { LevelInfo } from '../types';

export type AssetKind = 'geometry' | 'image' | 'animation' | 'misc';

export interface Extent {
  start: number;
  end: number;
  bank: number;
  index: number;
  id: number;
}

export interface AreaRecord {
  index: number;
  recordIndex: number;
  rom: number;
  world: number;
  stage: number;
  area: number;
  name: string;
  reachability: 'campaign' | 'tutorial' | 'hidden';
  primaryGeometry: number;
  secondaryGeometry: number;
  backdropId: number;
  colorId: number;
  musicId: number;
  setupId: number;
  deathCamera: number;
  areaType: number;
  dustSettingsId: number;
  dustImageId: number;
  info: LevelInfo;
}

export interface LayoutNode {
  index: number;
  depth: number;
  flags: number;
  parent: number;
  entry: number;
  translation: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface Placement {
  record: number;
  node: number;
  bank: number;
  entityId: number;
  action: number;
  controlFlags: number;
  behaviorFlags: number;
  saveIndex: number;
  position: [number, number, number];
  rotation: [number, number, number];
  scaleAux: [number, number, number];
}

export interface SetupRecord {
  extent: Extent;
  collision: number;
  paths: number;
  entities: number;
}

export const AREA_TYPE_NAMES = [
  'normal', 'character boss', 'world boss', 'stage end', 'log ride', 'sled ride', 'minecart ride',
  'unused', 'Dedede ride', 'final boss', 'mini-boss',
] as const;

export const WORLD_NAMES = [
  'Pop Star', 'Rock Star', 'Aqua Star', 'Neo Star', 'Shiver Star', 'Ripple Star', 'Dark Star / special',
] as const;
