import { buildLevel, fogPosition } from '../bomberman/common';
import type { CameraView, Level, LevelInfo, Marker } from '../types';
import { SpiderManFs } from './fs';
import { appendBundle, parseBundle, type SpiderManBundle } from './model';
import { BADDY_NAMES, parseTrg, TRG_TYPE_NAMES, type TrgCommand, type TrgNode } from './trg';
import { SpiderManTextures } from './texture';

interface Definition { stem: string; title: string; trg: number; g: number; o: number; kind: LevelInfo['kind']; group: string; setupParent?: number; restart?: number; setupLabel?: string }
const baseDefs: Definition[] = [];
const add = (stem: string, title: string, trg: number, g: number, o: number, kind: LevelInfo['kind'], group: string, setupParent?: number) =>
  baseDefs.push({ stem, title, trg, g, o, kind, group, ...(setupParent === undefined ? {} : { setupParent }) });

// Retail order is the game's 34-row campaign table; TRG slots 31-34 are late archive additions.
[
  ['L1A1','Get to the Bank!',0,15,17],['L1A2','Bank Approach',1,18,20],['L1A3','Hostage Situation',2,21,23],['L1A4','Stop the Bomb!',3,24,26],
  ['L2A1','Race to the Bugle',4,27,29],['L2A2','Spidey vs. Scorpion!',5,30,32],
  ['L3A1','Police Chopper Chase',6,33,35],['L3A2','Missile Attack',7,36,38],['L3A3','Building Top Chase',8,39,41],['L3A4','Scale the Girders',9,42,44],['L3A5','Police Evaded',10,45,47],
  ['L4A1','Spidey vs. Rhino!',11,48,50],
  ['L5A1','Catch Venom',12,51,53],['L5A2','Spidey vs. Venom!',13,54,56],['L5A3','Sewer Entrance',14,57,59],['L5A4','Sewer Cavern',15,60,62],['L5A5','Subway',16,63,65],['L5A6','Sewage Plant',17,66,68],['L5A7','Hidden Switches',31,127,129],
  ['L6A1','Tunnel Crawl',18,69,71],['L6A2',"Venom's Puzzle",19,72,74],['L6A3',"The Lizard's Maze",20,75,77],['L6A4','Spidey vs. Venom Again!',21,78,80],
  ['L7A1','Symbiotes Infest Bugle',22,81,83],['L7A2','Elevator Descent',23,84,86],['L7A3','Stop the Presses!',24,87,89],['L7A4',"Bugle's Basement",25,90,92],['L7A5','Spidey vs. Mysterio!',26,93,95],
  ['L8A1','Waterfront Warehouse',27,96,98],['L8A2','Underwater Trench',28,99,101],['L8A3','Stopping the Fog',32,130,132],['L8A4','Spidey vs. Doc Ock!',29,102,104],['L8A5','Spidey vs. Carnage!',33,133,135],['L8A6','Spidey vs. Monster-Ock!',34,136,138],
].forEach((x) => add(x[0] as string, x[1] as string, x[2] as number, x[3] as number, x[4] as number, 'campaign', `Chapter ${(x[0] as string)[1]}`));

add('L1A2a', 'Bank Approach (alternate)', 38, 169, 20, 'campaign', 'Alternate');
[
  ['L9A1',39,170,172],['L9A2',40,173,175],['L9A3',41,176,178],['L9A4',42,179,181],
  ['LBA1',43,182,184],['LBA2',44,185,187],['LBA3',45,188,190],['LBA4',46,191,193],
  ['LCA1',47,194,196],['LCA2',48,197,199],['LCA3',49,200,202],['LCA4',50,203,205],
  ['LDA1',51,206,208],['LDA2',52,209,211],['LDA3',53,212,214],['LGA1',55,215,217],['LHA1',56,218,220],
].forEach((x) => add(x[0] as string, `${x[0]} Training`, x[1] as number, x[2] as number, x[3] as number, 'obstacle', 'Training'));
const dem1 = baseDefs.length;
add('Dem1', 'Demo 1', 30, 158, 160, 'other', 'Attract Demos');
add('Dem1', 'Demo 1 (alternate setup)', 35, 158, 160, 'other', 'Attract Demos', dem1);
add('Dem2', 'Demo 2', 36, 161, 163, 'other', 'Attract Demos');
add('Dem3', 'Demo 3', 57, 251, 253, 'other', 'Attract Demos');
add('Dem4', 'Demo 4', 58, 254, 65, 'other', 'Attract Demos');
add('studio', 'Recording Studio (unreferenced)', -1, 262, -1, 'other', 'Diagnostic Models');

function axisPosition(raw: [number, number, number]): [number, number, number] { return [raw[0] / 2.25, -raw[1] / 2.25, -raw[2] / 2.25]; }
function mul(a: number[], b: number[]): number[] {
  const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o;
}
function nodeMatrix(position: [number, number, number], angles: [number, number, number] = [0, 0, 0]): Float32Array {
  const [x, y, z] = angles.map((a) => (a & 0xfff) * Math.PI * 2 / 4096), cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  const rx = [1,0,0,0, 0,cx,sx,0, 0,-sx,cx,0, 0,0,0,1], ry = [cy,0,-sy,0, 0,1,0,0, sy,0,cy,0, 0,0,0,1], rz = [cz,sz,0,0, -sz,cz,0,0, 0,0,1,0, 0,0,0,1];
  const c = [1,0,0,0, 0,-1,0,0, 0,0,-1,0, 0,0,0,1], r = mul(c, mul(mul(ry, rx), mul(rz, c))), p = axisPosition(position);
  r[12] = p[0]; r[13] = p[1]; r[14] = p[2]; return new Float32Array(r);
}

function marker(node: TrgNode, layer: number, slot: number): Marker | null {
  if (!node.position) return null;
  const type = TRG_TYPE_NAMES[node.type] ?? `NODE_${node.type}`, subtype = node.subtype === undefined ? '' : ` ${BADDY_NAMES[node.subtype] ?? node.subtype}`;
  return { label: `${type}${subtype} ${node.index}`, position: axisPosition(node.position), layer,
    info: { trgSlot: slot, trgNode: node.index, nodeType: type, ...(node.subtype === undefined ? {} : { subtype: node.subtype }),
      ...(node.links?.length ? { links: node.links.join(',') } : {}), ...(node.modelChecksums?.length ? { modelChecksums: node.modelChecksums.map((x) => `0x${x.toString(16).padStart(8,'0')}`).join(',') } : {}) } };
}

function environment(commands: TrgCommand[]): { clearColor: [number, number, number]; fog?: [number, number]; backgrounds: number[]; off: boolean } {
  let clearColor: [number, number, number] = [0, 0, 0], fog: [number, number] | undefined, off = false; const backgrounds: number[] = [];
  for (const c of commands) {
    if (c.opcode === 0xca) { const gb = c.args[1] as number; clearColor = [c.args[0] as number, gb >>> 8, gb & 255]; }
    else if (c.opcode === 0x68) fog = [c.args[1] as number, (c.args[1] as number) + (c.args[2] as number)];
    else if (c.opcode === 0xab) { backgrounds.push(c.args[0] as number); off = false; }
    else if (c.opcode === 0x84) off = true;
    else if (c.opcode === 0x83) off = false;
  }
  return { clearColor, ...(fog ? { fog } : {}), backgrounds: off ? [] : backgrounds, off };
}

function startCamera(restart?: TrgNode): CameraView | undefined {
  if (!restart?.position) return undefined;
  const at = axisPosition(restart.position), a = restart.angles ?? [0, 0, 0], yaw = (a[0] & 0xfff) * Math.PI * 2 / 4096, pitch = (a[1] & 0xfff) * Math.PI * 2 / 4096;
  const target: [number, number, number] = [at[0] + Math.sin(yaw) * Math.cos(pitch) * 500, at[1] + 80 + Math.sin(pitch) * 500, at[2] - Math.cos(yaw) * Math.cos(pitch) * 500];
  return { eye: [at[0], at[1] + 80, at[2]], target, fovY: 60 };
}

export class SpiderManLevelSource {
  readonly textures: SpiderManTextures;
  readonly definitions: Definition[];
  readonly levels: LevelInfo[];
  private readonly bundles = new Map<number, SpiderManBundle>();
  constructor(readonly fs: SpiderManFs) {
    this.textures = new SpiderManTextures(fs);
    this.definitions = baseDefs.map((d) => ({ ...d, restart: 0,
      setupLabel: d.setupParent === undefined ? 'Start' : 'Alternate setup — Start' }));
    baseDefs.forEach((d, baseIndex) => {
      if (d.trg < 0) return;
      const count = parseTrg(fs.getFile(1, d.trg), d.trg).restarts.length;
      for (let restart = 1; restart < count; restart++) {
        const parent = d.setupParent ?? baseIndex, prefix = d.setupParent === undefined ? '' : 'Alternate setup — ';
        this.definitions.push({ ...d, title: `${baseDefs[parent].title} (${prefix}Restart ${restart + 1})`, setupParent: parent, restart,
          setupLabel: `${prefix}Restart ${restart + 1}` });
      }
    });
    this.levels = this.definitions.map((d, index) => ({ index, name: d.title, kind: d.kind, group: d.group,
      ...(d.setupParent === undefined ? {} : { setupParent: d.setupParent }) }));
  }
  bundle(slot: number) { let b = this.bundles.get(slot); if (!b) { b = parseBundle(this.fs, slot); this.bundles.set(slot, b); } return b; }

  private studio(index: number, d: Definition): Level {
    const textures: Level['textures'] = [], meshes: Level['meshes'] = [], instances: Level['instances'] = [], base = { textures, meshes, instances };
    const geometry = appendBundle(base, this.textures, this.bundle(d.g), 'recording studio');
    for (const ii of geometry.visibleInstances) instances[ii].info = { ...instances[ii].info, diagnostic: 'unreferenced by every declarative model/TRG route; runtime numeric reachability open' };
    const layers: NonNullable<Level['layers']> = [
      { name: 'main', kind: 'main', instances: geometry.visibleInstances },
      { name: 'objects', kind: 'objects', instances: [] },
      { name: 'objects (What If)', kind: 'objects', instances: [], visibleByDefault: false },
      { name: 'background', kind: 'background', instances: [] },
      { name: 'markers', kind: 'markers', instances: [] },
      { name: 'collision', kind: 'collision', instances: geometry.collisionInstances, visibleByDefault: false },
    ];
    const level = buildLevel(this.levels[index], 'spiderman-studio-unreferenced', textures, meshes, instances,
      { layers, markers: [], clearColor: [24, 24, 28] }, new Set(geometry.collisionInstances));
    const center: [number, number, number] = [0,1,2].map((a) => (level.bounds.min[a] + level.bounds.max[a]) / 2) as [number, number, number];
    const span = Math.max(100, ...[0,1,2].map((a) => level.bounds.max[a] - level.bounds.min[a]));
    level.camera = { eye: [center[0] + span * .75, center[1] + span * .45, center[2] + span * .9], target: center, fovY: 60 };
    return level;
  }

  load(index: number): Level {
    if (!Number.isInteger(index) || index < 0 || index >= this.definitions.length) throw new Error(`invalid Spider-Man level ${index}`);
    const d = this.definitions[index]; if (d.trg < 0) return this.studio(index, d);
    const trg = parseTrg(this.fs.getFile(1, d.trg), d.trg), restart = trg.restarts[d.restart ?? 0];
    const activeCommands = [...trg.autoexec.flatMap((n) => n.commands ?? []), ...(restart?.commands ?? [])], env = environment(activeCommands);
    const g = this.bundle(d.g), o = this.bundle(d.o), textures: Level['textures'] = [], meshes: Level['meshes'] = [], instances: Level['instances'] = [];
    const shellBackgroundObjects = new Set<number>();
    for (const checksum of env.backgrounds) o.objects.forEach((object, oi) => { if (object.checksum === checksum) shellBackgroundObjects.add(oi); });
    const base = { textures, meshes, instances };
    const main = appendBundle(base, this.textures, g, `${d.stem}_G`);
    const objectIndices = o.objects.map((_, i) => i).filter((i) => !shellBackgroundObjects.has(i));
    const objects = appendBundle(base, this.textures, o, `${d.stem}_O`, { objects: objectIndices });
    const backgroundInstances: number[] = [];
    for (const oi of shellBackgroundObjects) backgroundInstances.push(...appendBundle(base, this.textures, o, `${d.stem}_O background`, { objects: [oi], background: true, collision: false }).visibleInstances);
    const camera = startCamera(restart);
    // Backdrops are camera-relative in the game. Instance has no camera-relative flag,
    // so anchor them at the authored starting camera for an exact initial view.
    if (camera) for (const ii of backgroundInstances) {
      instances[ii].matrix[0] = -1; instances[ii].matrix[10] = -1; // fixed -pi authored by Background_Draw
      instances[ii].matrix[12] += camera.eye[0]; instances[ii].matrix[13] += camera.eye[1]; instances[ii].matrix[14] += camera.eye[2];
    }

    const normalObjectInstances = [...objects.visibleInstances], whatIfInstances: number[] = [];
    const resolvedNodes = new Set<number>();
    for (const node of trg.nodes) {
      const checksum = node.modelChecksums?.[0]; if (checksum === undefined || !node.position) continue;
      const candidates = objects.byChecksum.get(checksum) ?? [];
      if (!candidates.length) continue;
      const p = axisPosition(node.position), distances = candidates.map((ii) => Math.hypot(instances[ii].matrix[12] - p[0], instances[ii].matrix[13] - p[1], instances[ii].matrix[14] - p[2]));
      const min = Math.min(...distances), selected = candidates.filter((_, i) => Math.abs(distances[i] - min) < 0.01);
      if (min < 4) {
        for (const ii of selected) {
          instances[ii].matrix = nodeMatrix(node.position, node.angles); instances[ii].animated = true; instances[ii].info = { ...instances[ii].info, trgSlot: d.trg, trgNode: node.index };
          if (node.whatIf) { const at = normalObjectInstances.indexOf(ii); if (at >= 0) normalObjectInstances.splice(at, 1); if (!whatIfInstances.includes(ii)) whatIfInstances.push(ii); }
        }
      } else {
        for (const source of selected) {
          const ii = instances.push({ ...instances[source], matrix: nodeMatrix(node.position, node.angles), animated: true, info: { ...instances[source].info, trgSlot: d.trg, trgNode: node.index, placement: 'TRG overlay' } }) - 1;
          (node.whatIf ? whatIfInstances : normalObjectInstances).push(ii);
        }
      }
      resolvedNodes.add(node.index);
    }

    const layers: NonNullable<Level['layers']> = [
      { name: 'main', kind: 'main', instances: main.visibleInstances },
      { name: 'objects', kind: 'objects', instances: normalObjectInstances },
      { name: 'objects (What If)', kind: 'objects', instances: whatIfInstances, visibleByDefault: false },
      { name: 'background', kind: 'background', instances: backgroundInstances },
      { name: 'markers', kind: 'markers', instances: [] },
      { name: 'collision', kind: 'collision', instances: [...main.collisionInstances, ...objects.collisionInstances], visibleByDefault: false },
    ];
    const markerLayer = 4, markers = trg.nodes.flatMap((n) => resolvedNodes.has(n.index) ? [] : [marker(n, markerLayer, d.trg)]).filter((x): x is Marker => x !== null);
    const hidden = new Set([...whatIfInstances, ...backgroundInstances, ...main.collisionInstances, ...objects.collisionInstances]);
    const extra: Partial<Level> = { layers, markers, clearColor: env.clearColor, camera };
    if (env.fog) {
      const [start, end] = env.fog, max = 1000, min = Math.max(0, Math.min(999, Math.round(start * max / Math.max(1, end))));
      extra.fog = fogPosition(min, max, env.clearColor, 1, end / 16);
    }
    const level = buildLevel(this.levels[index], `spiderman-${d.stem.toLowerCase()}-trg${d.trg}-restart${d.restart ?? 0}`, textures, meshes, instances, extra, hidden);
    const setupRoot = d.setupParent ?? index;
    const options = this.definitions.flatMap((candidate, candidateIndex) => (candidate.setupParent ?? candidateIndex) === setupRoot
      ? [{ name: candidate.setupLabel ?? 'Start', level: candidateIndex }] : []);
    if (options.length > 1) level.setups = { options, current: index };
    return level;
  }
}
