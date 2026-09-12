// Actors (ZELDA64.md §6): placements from room actor lists, transition actors and player entries, decoded per game
// (MM: id flags, degree rotations, half-day masks), and draw recipes for static props that draw fixed display lists.
// Everything without a recipe becomes a marker.
import { MM_ACTORS, OOT_ACTORS } from './names';
import { segmentAddress, segmentDisplayList, twoTexScroll, type SegmentValue } from './drawconfig';
import type { ActorEntry, TransitionActor } from './scene';
import type { ZeldaGame } from './tables';

export interface PlacedActor {
  kind: 'actor' | 'transition' | 'spawn';
  room: number; // -1: scene-wide
  index: number; // position in its list
  at: number; // file offset of the record
  id: number;
  rawId: number;
  name: string;
  pos: [number, number, number];
  rot: [number, number, number]; // binary angles (0x10000 = 360 degrees)
  rotRaw: [number, number, number];
  params: number;
  halfDayMask: number; // MM: 0 = always
  cutscene: number; // MM cutscene id, 0x7F none
}

export const actorName = (game: ZeldaGame, id: number) => (game === 'oot' ? OOT_ACTORS : MM_ACTORS)[id] || `actor 0x${id.toString(16)}`;

const degrees = (d: number) => Math.trunc((d * 0x10000) / 360) & 0xffff;

// MM Actor_SpawnEntry: id bits 15/14/13 flag rot.y/x/z as raw; each rotation is (rot >> 7) & 0x1FF degrees unless
// flagged (then passed on as a binary angle). Half-day mask ((rot.x & 7) << 7) | (rot.z & 0x7F); rot.y & 0x7F is the
// cutscene id.
export function placeRoomActor(game: ZeldaGame, e: ActorEntry, room: number): PlacedActor {
  const id = game === 'mm' ? e.rawId & 0x1fff : e.rawId;
  let rot = e.rot.slice() as [number, number, number];
  let halfDayMask = 0, cutscene = 0x7f;
  if (game === 'mm') {
    const flags = [0x4000, 0x8000, 0x2000];
    rot = e.rot.map((r, k) => {
      const v = (r >> 7) & 0x1ff;
      return e.rawId & flags[k] ? (v > 180 ? v - 360 : v) & 0xffff : degrees(v);
    }) as [number, number, number];
    halfDayMask = ((e.rot[0] & 7) << 7) | (e.rot[2] & 0x7f);
    cutscene = e.rot[1] & 0x7f;
  }
  return {
    kind: 'actor', room, index: e.index, at: e.at, id, rawId: e.rawId, name: actorName(game, id), pos: e.pos, rot, rotRaw: e.rot,
    params: e.params, halfDayMask, cutscene,
  };
}

export function placeTransitionActor(game: ZeldaGame, t: TransitionActor): PlacedActor {
  const id = game === 'mm' ? t.rawId & 0x1fff : t.rawId;
  return {
    kind: 'transition', room: t.frontRoom, index: t.index, at: t.at, id, rawId: t.rawId, name: actorName(game, id), pos: t.pos,
    rot: [0, game === 'mm' ? degrees((t.rotY >> 7) & 0x1ff) : t.rotY, 0], rotRaw: [0, t.rotY, 0], params: t.params,
    halfDayMask: 0, cutscene: game === 'mm' ? t.rotY & 0x7f : 0x7f,
  };
}

// MM half-day bits: 0x200 day 0 daytime, 0x100 day 0 night, 0x80 day 1 daytime, ... 0x01 day 4 night.
export const mmHalfDayBit = (day: number, night: boolean) => 1 << (9 - 2 * day - (night ? 1 : 0));

// Actor categories (ActorProfile.category) and the marker layer each goes to.
const CATEGORY_LAYERS = ['switches', 'background actors', 'player', 'items', 'NPCs', 'enemies', 'props', 'items', 'logic and effects', 'enemies', 'doors', 'chests'];
export const categoryLayer = (category: number) => CATEGORY_LAYERS[category] ?? 'logic and effects';

// ---- draw recipes (actor draw functions in the decomps; offsets for OoT US 1.0 / MM US, the same in the debug ROMs) ----

// Matrix ops applied after the actor matrix, in order.
export type MatrixOp = ['T', number, number, number] | ['S', number, number, number] | ['RY' | 'RX' | 'RZ', number];

export interface DrawList {
  dl: number; // segment address; segment 6 = the recipe's object, 4 = gameplay_keep, 5 = the scene's keep object
  chain?: number[]; // run these lists one after another in one pass (a material list followed by its models)
  xlu?: boolean; // drawn in the translucent buffer
  prim?: number; // RGBA set before the list
  primLod?: number;
  env?: number;
  pre?: MatrixOp[];
  segments?: Record<number, SegmentValue>; // segment -> address or synthetic display list set before the model list
}

export interface ActorDraw {
  object: number; // object id loaded as segment 6
  scale: [number, number, number];
  yOffset?: number; // shape.yOffset, multiplied by scale.y
  posAdjust?: [number, number, number]; // world position change done in init
  rot?: [number, number, number]; // shape rotation when init replaces the spawn rotation
  lists: DrawList[];
  note: string; // for bug reports
}

export interface RecipeContext {
  profileObject: number; // ActorProfile.objectId
  child: boolean;
  time: number;
  night: boolean;
  layer: number;
}

const KEEP = 1, FIELD_KEEP = 2, DANGEON_KEEP = 3;
const sc = (v: number): [number, number, number] => [v, v, v];
const o6 = (off: number) => (0x06000000 | off) >>> 0;
const rgba = (r: number, g: number, b: number, a: number) => (((r << 24) | (g << 16) | (b << 8) | a) >>> 0);
const one = (object: number, scale: number, off: number, note: string, extra: Partial<ActorDraw> = {}): ActorDraw =>
  ({ object, scale: sc(scale), lists: [{ dl: o6(off) }], note, ...extra });

// En_Wood02 types: [scale, draw type (5 = leaf), colour (0 white, 1 green, 2 yellow), spawner]
const WOOD02: [number, number, number, boolean][] = [
  [1.5, 0, 0, false], [1, 0, 0, false], [0.6, 0, 0, false], [1, 0, 0, true], [1, 0, 0, false], [1, 1, 1, false], [1, 1, 2, true],
  [1, 1, 2, false], [1, 1, 1, true], [1, 1, 1, false], [1, 2, 0, false], [1, 3, 0, false], [1.5, 3, 0, false], [1, 3, 0, true],
  [1, 3, 0, false], [1.5, 3, 0, true], [1.5, 3, 0, false], [1, 4, 0, false], [1.5, 4, 0, false], [1, 4, 0, true], [1, 4, 0, false],
  [1.5, 4, 0, true], [1.5, 4, 0, false], [0.02, 5, 1, false], [0.02, 5, 2, false], [1, 0, 0, false], [1.5, 0, 0, false],
];
const WOOD02_COLORS: [number, number, number][] = [[255, 255, 255], [50, 170, 70], [180, 155, 0]];

function wood02(a: PlacedActor, c: RecipeContext, game: ZeldaGame): ActorDraw | null {
  const type = a.params & 0xff;
  if (type >= WOOD02.length || (game === 'oot' && type > 0x18) || (game === 'mm' && type > 0x1a && type !== 0x1a)) return null;
  const [scale, drawType, color, spawner] = WOOD02[type];
  const [r, g, b] = WOOD02_COLORS[color];
  const pairs: [number, number][] = game === 'oot' ? [[0x78d0, 0x7968], [0x7ca0, 0x7d38], [0x80d0, 0x81a8]] : [[0x78d0, 0x7968], [0x7ca0, 0x7d38], [0x8160, 0x80d0]];
  let lists: DrawList[];
  if (drawType <= 2) lists = [{ dl: o6(pairs[drawType][0]) }, { dl: o6(pairs[drawType][1]), xlu: true, env: rgba(r, g, b, 0) }];
  else if (drawType === 3) lists = [{ dl: o6(0x90), xlu: true }];
  else if (drawType === 4) lists = [{ dl: o6(0x340), xlu: true }];
  else lists = [{ dl: o6(0x700), prim: rgba(r, g, b, 127) }];
  // Spawners stand 141 units away from their spawn point.
  const ang = ((0xa000 + a.rot[1] + (type === 0x0f ? 0x4000 : 0)) & 0xffff) / 0x8000 * Math.PI;
  return {
    object: c.profileObject, scale: sc(scale), lists, note: `type ${type} draw type ${drawType}`,
    rot: [a.rot[0], a.rot[1], 0], ...(spawner ? { posAdjust: [Math.sin(ang) * 141, 0, Math.cos(ang) * 141] as [number, number, number] } : {}),
  };
}

export function ootRecipe(a: PlacedActor, c: RecipeContext): ActorDraw | null {
  const p = a.params;
  switch (a.name) {
    case 'Obj_Tsubo':
      return (p >> 8) & 1 ? one(0x12c, 0.15, 0x17c0, 'object_tsubo pot') : one(DANGEON_KEEP, 0.15, 0x17870, 'dungeon pot');
    case 'Obj_Syokudai': {
      const type = (p >> 12) & 0xf;
      return one(c.profileObject, 1, [0x3a0, 0xb90, 0x870][type] ?? 0x870, `torch type ${type}`);
    }
    case 'En_Wood02': return wood02(a, c, 'oot');
    case 'Obj_Kibako': return one(DANGEON_KEEP, 0.1, 0x5290, 'small crate');
    case 'Obj_Kibako2': return one(c.profileObject, 0.1, 0x960, 'large crate');
    case 'Obj_Bombiwa': return one(c.profileObject, 0.1, 0x9e0, 'bomb rock', { yOffset: -200, posAdjust: [0, 20, 0] });
    case 'En_Kusa':
      return (p & 3) === 0 ? { object: FIELD_KEEP, scale: sc(0.4), lists: [{ dl: 0x0500b9d0 }], note: 'field bush' } : one(c.profileObject, 0.4, 0x140, 'bush');
    case 'En_Ishi':
      return p & 1
        ? { object: FIELD_KEEP, scale: sc(0.4), yOffset: 80, lists: [{ dl: 0x0500a3b8, prim: 0xffffffff }], note: 'silver rock' }
        : { object: FIELD_KEEP, scale: sc(0.1), yOffset: 58, lists: [{ dl: 0x0500a880 }], note: 'small rock' };
    case 'Bg_Haka': return { object: c.profileObject, scale: sc(0.1), lists: [{ dl: o6(0x1b0) }, { dl: o6(0x2a8), xlu: true }], note: 'gravestone' };
    case 'Bg_Ice_Turara':
      return one(c.profileObject, 0.1, 0x23d0, p === 0 ? 'stalagmite' : 'stalactite', p === 0 ? {} : { rot: [0x8000, a.rot[1], a.rot[2]], yOffset: 1200 });
    case 'En_Kanban':
      if (p === 0xffdd) return null;
      return {
        object: c.profileObject, scale: sc(0.01), posAdjust: c.child ? [0, -15, 0] : undefined,
        lists: [{ dl: 0, chain: [0xc30, 0xcb0, 0xdb8, 0xe78, 0xf38, 0xff8, 0x10b8, 0x11c0, 0x12c8, 0x13d0, 0x1488, 0x1540].map(o6), pre: [['T', 0, 0, -100]] }],
        note: 'sign: material 0xC30 and the 11 parts',
      };
    case 'Bg_Spot01_Fusya': return one(c.profileObject, 0.1, 0x100, 'windmill sails');
    case 'Bg_Spot01_Idohashira': return one(c.profileObject, 0.1, 0x420, 'well arch');
    case 'Obj_Switch': {
      const type = p & 7, sub = (p >> 4) & 7;
      if (type === 0 || type === 1) {
        const dl = type === 1 ? 0x5ad0 : sub === 0 ? 0x5800 : sub === 1 ? 0x6170 : 0x5d50;
        return { object: DANGEON_KEEP, scale: [0.1, 0.165, 0.1], posAdjust: [0, 1, 0], lists: [{ dl: o6(dl) }], note: `floor switch ${type}/${sub}` };
      }
      if (type === 2) {
        const [dl, tex] = sub === 1 ? [0x6810, 0xb0a0] : [0x6610, 0xa8a0];
        return { object: DANGEON_KEEP, scale: sc(0.1), lists: [{ dl: o6(dl), segments: { 8: segmentAddress(o6(tex)) } }], note: `eye switch ${sub}` };
      }
      if (type === 3 || type === 4) {
        if (sub === 2 || sub === 3) return null;
        const diamond = sub === 1;
        return {
          object: DANGEON_KEEP, scale: sc(0.1), note: `crystal switch ${sub}`,
          lists: [
            { dl: o6(diamond ? 0x7488 : 0x6e60), xlu: true },
            { dl: o6(diamond ? 0x7340 : 0x6d10), env: rgba(0, 0, 0, 128), ...(diamond ? { segments: { 9: segmentAddress(o6(0x144b0)) } } : {}) },
          ],
        };
      }
      return null;
    }
    case 'En_Gs': return { object: c.profileObject, scale: sc(0.1), lists: [{ dl: 0, chain: [0x950, 0x9d0, 0xa60].map(o6), prim: 0xffffffff }], note: 'gossip stone' };
    case 'Bg_Jya_Ironobj': return one(c.profileObject, 0.1, p & 1 ? 0x1050 : 0x240, p & 1 ? 'throne' : 'pillar');
    case 'Bg_Spot02_Objects': {
      const dl = [0x12a50, 0x127c0, 0x130b0][p & 0xff];
      return dl ? one(c.profileObject, 0.1, dl, `set piece ${p & 0xff}`) : null;
    }
    case 'Bg_Spot06_Objects': {
      const type = (p >> 8) & 0xff;
      if (type !== 2) return null;
      // The normal adult setup represents Lake Hylia before the Water Temple is cleared; cutscene setups force the
      // raised model. At frame zero both scroll lists have zero offsets, but retaining the two distinct lists records
      // the actor's actual material contract and lets the display-list decoder see both tile windows.
      const raised = c.child || c.layer >= 4;
      return {
        object: c.profileObject, scale: sc(1),
        lists: [{
          dl: o6(raised ? 0x470 : 0x120), xlu: true, env: rgba(255, 255, 255, 128),
          segments: {
            8: twoTexScroll(0, 0, 0, 32, 32, 1, 0, 0, 32, 32),
            9: twoTexScroll(0, 0, 0, 32, 32, 1, 0, 0, 32, 32),
          },
        }],
        note: `Lake Hylia ${raised ? 'raised' : 'lowered'} water plane; two scrolling 32x32 texture tiles (static frame 0)`,
      };
    }
    case 'En_Blkobj':
      return {
        object: c.profileObject, scale: sc(1),
        lists: [{
          dl: o6(0x53d0), xlu: true, env: rgba(0, 0, 0, 255),
          segments: {
            8: segmentDisplayList([0xe200001c, 0xc8112078]),
            13: twoTexScroll(0, 0, 0, 32, 32, 1, 0, 0, 32, 32),
          },
        }],
        note: 'Dark Link illusion room before the battle; two scrolling 32x32 texture tiles (static frame 0)',
      };
    case 'Door_Ana':
      return (p & 0x300) === 0 ? { object: FIELD_KEEP, scale: sc(0.01), rot: [a.rot[0], 0, 0], lists: [{ dl: 0x05001390, xlu: true }], note: 'grotto hole' } : null;
    default:
      return null;
  }
}

export function mmRecipe(a: PlacedActor, c: RecipeContext): ActorDraw | null {
  const p = a.params;
  switch (a.name) {
    case 'Obj_Tsubo': {
      const type = (p >> 7) & 3;
      const rot: [number, number, number] = [a.rot[0], a.rot[1], 0];
      if (type === 1) return one(0x19c, 0.29549998, 0x278, 'magic pot', { rot });
      if (type === 2) return one(0xf9, 0.197, 0x17c0, 'pot', { rot });
      return one(DANGEON_KEEP, 0.197, 0x17ea0, 'dungeon pot', { rot });
    }
    case 'En_Kusa':
      return (p & 3) === 0 ? { object: FIELD_KEEP, scale: sc(0.4), lists: [{ dl: 0x050078a0 }], note: 'bush' } : one(0xf8, 0.4, 0x140, 'grass');
    case 'Obj_Syokudai': {
      const type = (p >> 12) & 0xf;
      return one(c.profileObject, 1, [0x3a0, 0xb90, 0x870][type] ?? 0x870, `torch type ${type}`);
    }
    case 'En_Ishi': {
      const big = (p & 1) === 1;
      const base = { scale: sc(big ? 0.4 : 0.1), yOffset: big ? 80 : 58 };
      if ((p >> 3) & 1) return { object: 0x1f6, ...base, lists: [{ dl: o6(0x9b0) }], note: 'rock (object_ishi)' };
      return { object: FIELD_KEEP, ...base, lists: [{ dl: big ? 0x050061e8 : 0x050066b0, ...(big ? { prim: 0xffffffff } : {}) }], note: big ? 'silver boulder' : 'small rock' };
    }
    case 'Obj_Etcetera': {
      let type = (p & 0xff80) >> 7;
      if (type >= 4) type = 0;
      return { object: KEEP, scale: [0.01, 0.02, 0.01], lists: [{ dl: type >= 2 ? 0x04011bd0 : 0x0400ed80 }], note: `Deku flower type ${type}` };
    }
    case 'Obj_Tokei_Turret': {
      const tier = p & 3;
      return one(c.profileObject, 0.1, [0x2508, 0x2a88, 0x3038, 0x3038][tier], `carnival tier ${tier}`);
    }
    case 'En_Twig': return (p & 0xf) === 2 ? one(c.profileObject, 1, 0x14c8, 'twig') : null;
    case 'Bg_Lotus': return one(c.profileObject, 0.1, 0x40, 'lily pad');
    case 'En_Wood02': return wood02(a, c, 'mm');
    case 'Obj_Snowball': {
      const f = a.rot[1] === 1 ? 1.5 : 1;
      return one(c.profileObject, 0.1 * f, 0x8b90, 'snowball', { posAdjust: [0, 20 * f, 0], rot: [0, 0, 0] });
    }
    case 'Obj_Snowball2': return one(c.profileObject, 0.025, 0x8b90, 'small snowball', { yOffset: 200, rot: [0, 0, 0] });
    case 'En_Kanban':
      return {
        object: c.profileObject, scale: sc(0.01), posAdjust: [0, -15, 0],
        lists: [{ dl: 0, chain: [0xc30, 0xcb0, 0xdb8, 0xe78, 0xf38, 0xff8, 0x10b8, 0x11c0, 0x12c8, 0x13d0, 0x1488, 0x1540].map(o6), pre: [['T', 0, 0, -100]] }],
        note: 'sign: material 0xC30 and the 11 parts',
      };
    case 'En_Gs': {
      const type = (p >> 12) & 0xf;
      return { object: c.profileObject, scale: sc(type === 1 ? 0.15 : 0.1), lists: [{ dl: 0, chain: [0x950, 0x9d0, 0xa60].map(o6), prim: 0xffffffff }], note: `gossip stone ${type}` };
    }
    case 'Obj_Switch': {
      const type = p & 7, sub = (p >> 4) & 7;
      const scale = [0.123, 0.123, 0.1, 0.118, 0.118, 0.248][type];
      if (scale === undefined) return null;
      if (type === 0 || type === 5 || type === 1) {
        const dl = type === 1 ? 0x7e00 : sub === 1 ? 0x1b9f8 : sub === 2 || sub === 3 ? 0x1b788 : 0x1b508;
        return {
          object: DANGEON_KEEP, scale: [scale, type === 5 ? 0.2475 : 0.165, scale], posAdjust: [0, type === 5 ? 1.9 : 1, 0],
          lists: [{ dl: o6(dl), ...(sub === 0 && type !== 1 ? { prim: 0xffffffff, primLod: 0x80 } : {}) }], note: `floor switch ${type}/${sub}`,
        };
      }
      if (type === 2) {
        const [dl, tex] = sub === 1 ? [0x85f0, 0xb6c0] : [0x83f0, 0xaec0];
        return { object: DANGEON_KEEP, scale: sc(scale), lists: [{ dl: o6(dl), xlu: (p & 8) !== 0, segments: { 8: segmentAddress(o6(tex)) } }], note: `eye switch ${sub}` };
      }
      return {
        object: DANGEON_KEEP, scale: sc(scale), note: `crystal switch ${sub}`,
        lists: [{ dl: o6(0x1c058) }, { dl: o6(0x1bee0), prim: rgba(0, 0, 0, 255), primLod: 0x80 }, { dl: o6(0x1bfb8), xlu: true }],
      };
    }
    case 'Obj_Kibako': return (p >> 15) & 1 ? one(0x16f, 0.15, 0x1180, 'small crate') : one(DANGEON_KEEP, 0.15, 0x7890, 'dungeon crate');
    case 'Obj_Kibako2': return one(c.profileObject, 0.1, 0x960, 'large crate');
    case 'Obj_Taru':
      return (p >> 7) & 1
        ? { object: c.profileObject, scale: [(p >> 8) & 1 ? 0.2 : 0.1, 0.1, 0.1], lists: [{ dl: o6(0x1140) }], note: 'pirate panel' }
        : one(c.profileObject, 0.1, 0x420, 'barrel');
    case 'Bg_Umajump': return (p & 0xff) === 2 ? null : one(0xd2, 0.1, 0x1220, 'horse jump fence');
    case 'Obj_HsStump': return ((p >> 12) & 0xf) === 1 ? null : one(c.profileObject, 0.18, 0x3b8, 'stump');
    case 'Bg_Icicle': {
      const hanging = (p & 3) === 1 || (p & 3) === 2;
      return one(c.profileObject, 0.1, 0xd0, hanging ? 'icicle' : 'stalagmite', hanging ? { rot: [0x8000, a.rot[1], a.rot[2]], yOffset: 1200 } : {});
    }
    case 'Obj_Tree': return { object: c.profileObject, scale: sc((p >> 15) & 1 ? 0.15 : 0.1), lists: [{ dl: o6(0x680) }, { dl: o6(0x7c8) }], note: 'tree' };
    case 'Obj_Bombiwa':
      return (p >> 8) & 1
        ? { object: c.profileObject, scale: sc(0.1), yOffset: -200, posAdjust: [0, 20, 0], lists: [{ dl: o6(0x4560), prim: 0xffffffff, primLod: 0x9b }, { dl: o6(0x4688), xlu: true, prim: 0xffffffff, primLod: 0x9b }], note: 'bomb rock 1' }
        : one(c.profileObject, 0.1, 0x9e0, 'bomb rock', { yOffset: -200, posAdjust: [0, 20, 0] });
    case 'Obj_Comb':
      return { object: c.profileObject, scale: sc(0.1), yOffset: 118, lists: [{ dl: o6(0xcb0), pre: [['T', 0, -118, 0]] }], note: 'beehive' };
    case 'Bg_Lbfshot': return one(c.profileObject, 0.1, 0x228, 'wooden pillar');
    case 'Obj_Flowerpot': return { object: c.profileObject, scale: sc(0.1), lists: [{ dl: o6(0x12e0) }, { dl: o6(0x1408) }], note: 'flower pot' };
    case 'Obj_Tokeidai': return tokeidai(a, c);
    default:
      return null;
  }
}

// Obj_Tokeidai: clock tower parts at the level's time (all pivots cancel at rest).
function tokeidai(a: PlacedActor, c: RecipeContext): ActorDraw | null {
  const type = (a.params & 0xf000) >> 12;
  const minuteRot = Math.trunc(((Math.trunc((c.time * 720) / 0x10000) % 30) * 0x10000 * 12) / 360);
  const hour = Math.trunc((c.time * 24) / 0x10000);
  const faceRot = Math.trunc((hour * 0x10000) / 24);
  const clock = (scale: number, face: number): ActorDraw => ({
    object: 0x18c, scale: sc(scale), note: `clock type ${type}`,
    lists: [
      { dl: o6(0xcf28), pre: [['RZ', -minuteRot]] },
      { dl: o6(0xbee8) },
      { dl: o6(face), pre: [['RZ', -2 * faceRot]] },
      { dl: o6(0xc368), pre: [['RZ', -2 * faceRot], ['T', 0, -1112, -19.6], ['RY', c.night ? 0x8000 : 0]] },
    ],
  });
  switch (type) {
    case 1: return one(0x18c, 0.1, 0xd388, 'unused wall');
    case 8: return one(0x18c, 1, 0x9a08, 'Termina Field walls');
    case 0: case 4: return { object: 0x18c, scale: sc(type === 4 ? 0.15 : 0.1), lists: [{ dl: o6(0xba78), pre: [['RZ', minuteRot]] }], note: 'exterior gear' };
    case 2: return clock(0.1, 0xe818);
    case 5: return clock(0.15, 0xe818);
    case 9: return clock(0.02, 0xf518);
    case 10: return clock(0.01, 0xf518);
    case 3: case 6: return one(0x18c, type === 6 ? 0.15 : 0.1, 0xb208, 'counterweight');
    default: return null;
  }
}

// ---- matrices -----------------------------------------------------------------------------------------------------

type M3 = number[]; // 4x4 column-vector matrix, row-major: m[r * 4 + c]
const mul = (a: M3, b: M3): M3 => {
  const r = new Array<number>(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
  return r;
};
const ang = (v: number) => (((v << 16) >> 16) / 0x8000) * Math.PI;
const T = (x: number, y: number, z: number): M3 => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
const S = (x: number, y: number, z: number): M3 => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
const RY = (t: number): M3 => { const c = Math.cos(ang(t)), n = Math.sin(ang(t)); return [c, 0, n, 0, 0, 1, 0, 0, -n, 0, c, 0, 0, 0, 0, 1]; };
const RX = (t: number): M3 => { const c = Math.cos(ang(t)), n = Math.sin(ang(t)); return [1, 0, 0, 0, 0, c, -n, 0, 0, n, c, 0, 0, 0, 0, 1]; };
const RZ = (t: number): M3 => { const c = Math.cos(ang(t)), n = Math.sin(ang(t)); return [c, -n, 0, 0, n, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; };

// Actor_Draw: T(pos + (0, yOffset * scale.y, 0)) Ry Rx Rz S(scale), then the draw function's own ops. Returns the
// part without the world position (for the display list, so that lighting sees the rotated normals) in the display
// list's row-vector form, and the world position (for the instance).
export function actorTransform(a: PlacedActor, d: ActorDraw, list: DrawList): { local: number[]; position: [number, number, number] } {
  const rot = d.rot ?? a.rot;
  let m = mul(mul(mul(RY(rot[1]), RX(rot[0])), RZ(rot[2])), S(...d.scale));
  for (const op of list.pre ?? []) {
    if (op[0] === 'T') m = mul(m, T(op[1], op[2], op[3]));
    else if (op[0] === 'S') m = mul(m, S(op[1], op[2], op[3]));
    else m = mul(m, op[0] === 'RY' ? RY(op[1]) : op[0] === 'RX' ? RX(op[1]) : RZ(op[1]));
  }
  const local: number[] = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) local.push(m[j * 4 + i]);
  const adj = d.posAdjust ?? [0, 0, 0];
  return { local, position: [a.pos[0] + adj[0], a.pos[1] + adj[1] + (d.yOffset ?? 0) * d.scale[1], a.pos[2] + adj[2]] };
}
