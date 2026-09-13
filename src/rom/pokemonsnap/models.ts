// Pokémon/prop DObj trees, frame-zero animation pose, and model display lists.
import type { DlLighting, Mtx } from '../displaylist';
import type { Mesh } from '../types';
import { AnimNode } from './anim';
import type { CourseId, SnapMemory, V3 } from './fs';
import { G, GfxBuilder, readMObjs, RM_FOG_OPA, RM_FOG_XLU } from './gfx';

const GEN1 = [
  '', 'Bulbasaur', 'Ivysaur', 'Venusaur', 'Charmander', 'Charmeleon', 'Charizard', 'Squirtle', 'Wartortle', 'Blastoise',
  'Caterpie', 'Metapod', 'Butterfree', 'Weedle', 'Kakuna', 'Beedrill', 'Pidgey', 'Pidgeotto', 'Pidgeot', 'Rattata',
  'Raticate', 'Spearow', 'Fearow', 'Ekans', 'Arbok', 'Pikachu', 'Raichu', 'Sandshrew', 'Sandslash', 'Nidoran F',
  'Nidorina', 'Nidoqueen', 'Nidoran M', 'Nidorino', 'Nidoking', 'Clefairy', 'Clefable', 'Vulpix', 'Ninetales', 'Jigglypuff',
  'Wigglytuff', 'Zubat', 'Golbat', 'Oddish', 'Gloom', 'Vileplume', 'Paras', 'Parasect', 'Venonat', 'Venomoth',
  'Diglett', 'Dugtrio', 'Meowth', 'Persian', 'Psyduck', 'Golduck', 'Mankey', 'Primeape', 'Growlithe', 'Arcanine',
  'Poliwag', 'Poliwhirl', 'Poliwrath', 'Abra', 'Kadabra', 'Alakazam', 'Machop', 'Machoke', 'Machamp', 'Bellsprout',
  'Weepinbell', 'Victreebel', 'Tentacool', 'Tentacruel', 'Geodude', 'Graveler', 'Golem', 'Ponyta', 'Rapidash', 'Slowpoke',
  'Slowbro', 'Magnemite', 'Magneton', "Farfetch'd", 'Doduo', 'Dodrio', 'Seel', 'Dewgong', 'Grimer', 'Muk',
  'Shellder', 'Cloyster', 'Gastly', 'Haunter', 'Gengar', 'Onix', 'Drowzee', 'Hypno', 'Krabby', 'Kingler',
  'Voltorb', 'Electrode', 'Exeggcute', 'Exeggutor', 'Cubone', 'Marowak', 'Hitmonlee', 'Hitmonchan', 'Lickitung', 'Koffing',
  'Weezing', 'Rhyhorn', 'Rhydon', 'Chansey', 'Tangela', 'Kangaskhan', 'Horsea', 'Seadra', 'Goldeen', 'Seaking',
  'Staryu', 'Starmie', 'Mr. Mime', 'Scyther', 'Jynx', 'Electabuzz', 'Magmar', 'Pinsir', 'Tauros', 'Magikarp',
  'Gyarados', 'Lapras', 'Ditto', 'Eevee', 'Vaporeon', 'Jolteon', 'Flareon', 'Porygon', 'Omanyte', 'Omastar',
  'Kabuto', 'Kabutops', 'Aerodactyl', 'Snorlax', 'Articuno', 'Zapdos', 'Moltres', 'Dratini', 'Dragonair', 'Dragonite',
  'Mewtwo', 'Mew',
];
const SPECIAL: Record<number, string> = {
  600: 'Moltres Egg', 601: 'Articuno Egg', 602: 'Zapdos Egg', 603: 'Shellder Shell',
  1001: 'Back to the Lab Gate', 1002: 'Evolution Controller', 1003: 'Common Object', 1004: 'Kingler Rock',
  1005: 'Pidgey/Scyther Controller', 1006: 'Surfing Pikachu Wake', 1007: 'Palm',
  1010: 'Pinsir Shadow', 1015: 'Computer', 1018: 'Mewtwo Constellation', 1022: 'Cubone Tree',
  1026: 'Growlithe Spawner', 1027: 'Smoke Spawner', 1028: 'Koffing Smoke', 1029: 'Smoke Puff',
  1030: 'Lava Splash', 1031: 'Volcano Smoke', 1032: 'Valley Object', 1035: 'Dugtrio Mountain',
  1036: 'Staryu/Starmie Controller', 1037: 'Mew Bubble Rings', 1038: 'Rainbow Cloud',
};
export const objectName = (id: number): string => id >= 1 && id <= 151 ? GEN1[id] : SPECIAL[id] ?? `Object ${id}`;

const SYMBOLS: Record<number, string> = {
  0x80363dbc: 'pokemonChangeBlock', 0x80363eb4: 'pokemonChangeBlockOnGround', 0x80362d2c: 'Pokemon_ChangeBlockAndRemove',
  0x80364280: 'pokemonRemoveOne', 0x8035942c: 'renderPokemonModelTypeIFogged', 0x80359484: 'renderPokemonModelTypeJFogged',
  0x803594dc: 'renderPokemonModelTypeBFogged', 0x80359534: 'renderPokemonModelTypeDFogged', 0x8035958c: 'renderPokemonModelTypeI',
  0x803595e4: 'renderPokemonModelTypeB', 0x8035963c: 'renderPokemonModelTypeD', 0x800a1530: 'renderModelTypeAFogged',
  0x800a1560: 'renderModelTypeAFoggedTransparent', 0x800a1590: 'renderModelTypeCFogged', 0x800a15d8: 'renderModelTypeBFogged',
  0x800a1608: 'renderModelTypeDFogged', 0x800a1650: 'renderModelTypeIFogged', 0x800a16b0: 'renderModelTypeJFogged',
  0x80014d60: 'renRenderModelTypeA', 0x80014f98: 'renRenderModelTypeB', 0x800153ec: 'renRenderModelTypeC',
  0x80015890: 'renRenderModelTypeD', 0x8001679c: 'renRenderModelTypeI', 0x80016c88: 'renRenderModelTypeJ',
  0x800a1680: 'renderModelTypeINoFog', 0x800a16f8: 'renderModelTypeDFoggedTTNone',
  0x80362e5c: 'Pokemon_Spawn', 0x80362ee0: 'Pokemon_SpawnOnGround',
  0x80362e10: 'Pokemon_SpawnOnGroundDlLink4', 0x80362dc4: 'Pokemon_SpawnDlLink4',
};
const CUSTOM_RENDER = new Map<number, string>();
const isRender = (a: number) => /^render|^renRender/.test(SYMBOLS[a] ?? '');

function resolveRender(m: SnapMemory, fn: number): string {
  if (SYMBOLS[fn]) return SYMBOLS[fn];
  const known = CUSTOM_RENDER.get(fn);
  if (known) return known;
  if (m.ok(fn)) {
    for (let pc = fn, i = 0; i < 64; pc += 4, i++) {
      const ins = m.u32(pc);
      if (ins >>> 26 === 3) {
        const target = ((pc & 0xf0000000) | ((ins & 0x3ffffff) << 2)) >>> 0;
        if (isRender(target)) {
          const name = `custom@${fn.toString(16)}->${SYMBOLS[target]}`;
          CUSTOM_RENDER.set(fn, name); return name;
        }
      }
      if (ins === 0x03e00008) break;
    }
  }
  return `0x${fn.toString(16)}`;
}

const DEF_TABLE: Record<CourseId, [number, number]> = {
  beach: [0x802cbee4, 16], tunnel: [0x802edfac, 21], volcano: [0x802e0d44, 20],
  river: [0x802e271c, 24], cave: [0x802c6234, 17], valley: [0x802d282c, 20], rainbow: [0x8034ab34, 5],
};

interface Def { id: number; init: number; update: number; kill: number }
export function readDefinitions(m: SnapMemory): Def[] {
  const [start, count] = DEF_TABLE[m.course.id];
  return Array.from({ length: count }, (_, i) => {
    const a = start + i * 16;
    return { id: m.u32(a), init: m.u32(a + 4), update: m.u32(a + 8), kill: m.u32(a + 12) };
  });
}

interface ScanCall { target: number; initData?: number }
function scanFunction(m: SnapMemory, start: number, depth = 0, seen = new Set<number>()): ScanCall[] {
  if (seen.has(start) || depth > 2) return [];
  seen.add(start);
  const calls: ScanCall[] = [], registers = new Map<number, number>(), stack = new Map<number, number>();
  const code = m.course.code;
  const get = (r: number) => r === 0 ? 0 : registers.get(r);
  const set = (r: number, v: number | undefined) => { if (r && v === undefined) registers.delete(r); else if (r) registers.set(r, v! >>> 0); };
  let endAfter = -1;
  const execSimple = (ins: number) => {
    const op = ins >>> 26, rs = (ins >>> 21) & 31, rt = (ins >>> 16) & 31, rd = (ins >>> 11) & 31, fn = ins & 0x3f;
    const imm = ins & 0xffff, simm = (imm << 16) >> 16;
    if (op === 0x0f) set(rt, imm << 16);
    else if (op === 0x09) { const a = get(rs); set(rt, a === undefined ? undefined : a + simm); }
    else if (op === 0x0d) { const a = get(rs); set(rt, a === undefined ? undefined : a | imm); }
    else if (op === 0 && (fn === 0x21 || fn === 0x25)) { const a = get(rs), b = get(rt); set(rd, a === undefined || b === undefined ? undefined : fn === 0x21 ? a + b : a | b); }
    else if (op === 0x2b && rs === 29) { const v = get(rt); if (v === undefined) stack.delete(imm); else stack.set(imm, v); }
    else if ([0x23, 0x0a, 0x0b, 0x08, 0x0c, 0x21, 0x25, 0x24, 0x20, 0x31].includes(op)) set(rt, undefined);
    else if (op === 0 && fn !== 0x08 && fn !== 0x09) set(rd, undefined);
  };
  for (let pc = start, n = 0; n < 2000 && m.ok(pc); pc += 4, n++) {
    const ins = m.u32(pc), op = ins >>> 26, rs = (ins >>> 21) & 31, fn = ins & 0x3f;
    if (op === 3 || op === 2) {
      const target = ((pc & 0xf0000000) | ((ins & 0x3ffffff) << 2)) >>> 0;
      execSimple(m.u32(pc + 4));
      calls.push({ target, initData: stack.get(0x14) });
      if (target >= code.vram && target < code.vram + code.romEnd - code.romStart)
        calls.push(...scanFunction(m, target, depth + 1, seen));
      if (op === 2) break;
      for (const r of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 24, 25]) registers.delete(r);
      pc += 4; n++; continue;
    }
    if (op === 0 && fn === 8 && rs === 31) endAfter = pc + 4;
    execSimple(ins);
    if (endAfter === pc) break;
  }
  return calls;
}

interface InitData {
  addr: number; tree: number; textures: number; render: number; animSetup: number; scale: V3; flags: number;
}
function readInitData(m: SnapMemory, addr: number): InitData {
  return { addr, tree: m.u32(addr), textures: m.u32(addr + 4), render: m.u32(addr + 8), animSetup: m.u32(addr + 12), scale: m.vec3(addr + 16), flags: m.u16(addr + 0x2c) };
}

export interface ModelRecord {
  id: number; name: string; initData: number; mesh: number; scale: V3; triangles: number;
  spawnFunctions: string[];
}

interface Node {
  index: number; depth: number; flags: number; parent: number; payload: number;
  pos: V3; rot: V3; scale: V3; hidden: boolean; ownHidden: boolean;
}
function readTree(m: SnapMemory, tree: number): Node[] {
  const nodes: Node[] = [], last: number[] = [];
  for (let i = 0, a = tree; i < 64; i++, a += 0x2c) {
    const id = m.s32(a);
    if (id === 18) break;
    const depth = id & 0xfff;
    nodes.push({ index: i, depth, flags: id & 0xf000, parent: depth ? last[depth - 1] : -1,
      payload: m.u32(a + 4), pos: m.vec3(a + 8), rot: m.vec3(a + 20), scale: m.vec3(a + 32), hidden: false, ownHidden: false });
    last[depth] = i;
  }
  return nodes;
}

export function rpyMatrix(pos: V3, rot: V3, scale: V3): Mtx {
  const [r, p, h] = rot, sr = Math.sin(r), cr = Math.cos(r), sp = Math.sin(p), cp = Math.cos(p), sh = Math.sin(h), ch = Math.cos(h);
  return [
    cp * ch * scale[0], cp * sh * scale[0], -sp * scale[0], 0,
    (sr * sp * ch - cr * sh) * scale[1], (sr * sp * sh + cr * ch) * scale[1], sr * cp * scale[1], 0,
    (cr * sp * ch + sr * sh) * scale[2], (cr * sp * sh - sr * ch) * scale[2], cr * cp * scale[2], 0,
    pos[0], pos[1], pos[2], 1,
  ];
}
function mul(a: Mtx, b: Mtx): Mtx {
  const out = new Array<number>(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) out[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
  return out;
}
const IDENTITY: Mtx = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const LIGHTS: DlLighting = { lights: [{ color: [180, 180, 180], dir: [0.57735, 0.57735, 0.57735] }], ambient: [100, 100, 100] };
const GEO = G.ZBUFFER | G.SHADE | G.CULL_BACK | G.SMOOTH | G.FOG | G.LIGHTING;

interface Pending { record: Omit<ModelRecord, 'mesh' | 'triangles'>; writers: string[] }

export function buildModels(m: SnapMemory): { textures: import('../types').Texture[]; meshes: Mesh[]; records: ModelRecord[] } {
  const gfx = new GfxBuilder(m, `snap/${m.course.id}/objects/`), pending: Pending[] = [], seen = new Set<number>();
  for (const def of readDefinitions(m)) {
    const calls = scanFunction(m, def.init);
    const spawnCalls = calls.filter((c) => /Pokemon_Spawn/.test(SYMBOLS[c.target] ?? ''));
    const initAddresses = new Set(spawnCalls.map((c) => c.initData).filter((x): x is number => x !== undefined && m.ok(x)));
    for (const addr of initAddresses) {
      if (seen.has(addr)) continue;
      seen.add(addr);
      const init = readInitData(m, addr);
      if (!init.tree) continue;
      const renderName = resolveRender(m, init.render), type = renderName.match(/Type([A-Z])/)?.[1];
      if (!type) throw new Error(`unknown Pokémon Snap render function 0x${init.render.toString(16)} for object ${def.id}`);
      let modelAnimations = 0, materialAnimations = 0;
      if (init.animSetup) {
        const header = m.u32(init.animSetup);
        if (header) { modelAnimations = m.u32(header + 8); materialAnimations = m.u32(header + 12); }
      }
      const nodes = readTree(m, init.tree), local: Mtx[] = [], world: Mtx[] = [];
      for (const node of nodes) {
        let pos = node.pos, rot = node.rot, scale = node.scale, flags = 0;
        const list = modelAnimations ? m.u32(modelAnimations + node.index * 4) : 0;
        if (list) {
          const anim = new AnimNode(m, false); anim.set(list, 0); anim.speed = 0; anim.tick();
          const value = (p: number, fallback: number) => anim.values.get(p) ?? fallback;
          rot = [value(1, rot[0]), value(2, rot[1]), value(3, rot[2])];
          pos = anim.position ?? [value(5, pos[0]), value(6, pos[1]), value(7, pos[2])];
          scale = [value(8, scale[0]), value(9, scale[1]), value(10, scale[2])];
          flags = anim.flags;
        }
        local.push(rpyMatrix(pos, node.flags ? [0, 0, 0] : rot, scale));
        node.ownHidden = (flags & 1) !== 0;
        node.hidden = (flags & 2) !== 0 || (node.parent >= 0 && nodes[node.parent].hidden);
      }
      nodes.forEach((node, i) => { world[i] = node.parent >= 0 ? mul(local[i], world[node.parent]) : local[i]; });
      const writers = new Map<number, ReturnType<GfxBuilder['begin']>>();
      const writer = (listId: number) => {
        let w = writers.get(listId);
        if (!w) {
          w = gfx.begin(`obj-${addr.toString(16)}-${listId}`, { geometryMode: GEO, renderMode: listId === 1 ? RM_FOG_XLU : RM_FOG_OPA, combiner: true, lighting: LIGHTS });
          writers.set(listId, w);
        }
        return w;
      };
      const materials = (i: number) => init.textures ? readMObjs(m, init.textures + i * 4, materialAnimations ? materialAnimations + i * 4 : 0) : [];
      const parentMatrix = (i: number) => nodes[i].parent >= 0 ? world[nodes[i].parent] : IDENTITY;
      for (const [i, node] of nodes.entries()) {
        if (!node.payload || node.hidden || node.ownHidden) continue;
        const mobjs = materials(i);
        if (type === 'A' || type === 'B') {
          const w = writer(0); w.matrix(world[i]); w.walk(node.payload, mobjs);
        } else if (type === 'I') {
          const pre = m.u32(node.payload), draw = m.u32(node.payload + 4), w = writer(0);
          if (pre) { w.matrix(parentMatrix(i)); w.walk(pre, mobjs); }
          if (draw) { w.matrix(world[i]); w.walk(draw, mobjs); }
        } else if (type === 'D' || type === 'C') {
          for (let p = node.payload, guard = 0; guard < 8; p += 8, guard++) {
            const id = m.u32(p); if (id === 4) break;
            const dl = m.u32(p + 4); if (!dl) continue;
            const w = writer(id); w.matrix(world[i]); w.walk(dl, mobjs);
          }
        } else if (type === 'J') {
          for (let p = node.payload, guard = 0; guard < 8; p += 12, guard++) {
            const id = m.u32(p); if (id === 4) break;
            const pre = m.u32(p + 4), draw = m.u32(p + 8); if (!draw) continue;
            const w = writer(id);
            if (pre) { w.matrix(parentMatrix(i)); w.walk(pre, mobjs); }
            w.matrix(world[i]); w.walk(draw, mobjs);
          }
        }
      }
      for (const w of writers.values()) gfx.end(w);
      pending.push({
        record: { id: def.id, name: objectName(def.id), initData: addr, scale: init.scale,
          spawnFunctions: [...new Set(spawnCalls.map((c) => SYMBOLS[c.target] ?? `0x${c.target.toString(16)}`))] },
        writers: [...writers.values()].map((w) => w.name),
      });
    }
  }
  const output = gfx.run(), meshes: Mesh[] = [], records: ModelRecord[] = [];
  for (const list of gfx.lists) if (Object.keys(list.stats.unknownOps).length)
    throw new Error(`Pokémon Snap ${m.course.id} ${list.name}: unknown display-list commands ${JSON.stringify(list.stats.unknownOps)}`);
  for (const p of pending) {
    const batches = p.writers.flatMap((name) => output.get(name) ?? []);
    let radius = 1, triangles = 0;
    for (const b of batches) {
      triangles += b.positions.length / 9;
      for (let i = 0; i < b.positions.length; i += 3) radius = Math.max(radius, Math.hypot(b.positions[i], b.positions[i + 1], b.positions[i + 2]));
    }
    const mesh = meshes.length;
    meshes.push({ name: `${p.record.id} ${p.record.name}`, radius, batches,
      info: { initData: `0x${p.record.initData.toString(16)}`, course: m.course.id } });
    records.push({ ...p.record, mesh, triangles });
  }
  return { textures: gfx.textures, meshes, records };
}
