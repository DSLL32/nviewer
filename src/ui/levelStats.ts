import type { Level } from '../rom';

export interface LevelStats {
  triangles: number; // as drawn: placed instances + sky
  textures: number;
  instances: number; // placed instances with geometry
  scripted: number; // of which animated/scripted
  loadMs: number;
}

export function computeStats(level: Level, loadMs: number): LevelStats {
  const meshTris = level.meshes.map((m) => m.batches.reduce((n, b) => n + Math.floor(b.positions.length / 9), 0));
  let triangles = 0;
  let instances = 0;
  let scripted = 0;
  for (const inst of level.instances) {
    if (inst.mesh < 0 || inst.mesh >= meshTris.length) continue;
    triangles += meshTris[inst.mesh];
    instances++;
    if (inst.animated) scripted++;
  }
  for (const i of level.unplaced) if (level.meshes[i]?.name.endsWith('SKY')) triangles += meshTris[i];
  return { triangles, textures: level.textures.length, instances, scripted, loadMs };
}

export const formatCount = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n));
