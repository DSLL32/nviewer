// Scene draw configs at a static frame (ZELDA64.md §5.4): what segments 6 and 8-0xD hold and the prim/env colours
// left set when the room lists draw, separately for the opaque (OPA) and translucent (XLU) display buffers.
// OoT: the 53 sSceneDrawConfigs functions of z_scene_table.c, keyed by the scene table's drawConfig byte. MM: the
// scene's AnimatedMaterial list (command 0x1A).
import { u16, u32 } from './scene';

// A segment's contents: a synthesised display list, or an address (a texture) in another segment.
export type SegmentValue = { kind: 'dl'; words: number[] } | { kind: 'addr'; addr: number };
export interface BufferState { segments: Map<number, SegmentValue>; env?: number; prim?: number }
export interface DrawConfig { opa: BufferState; xlu: BufferState; notes: string[] }

export interface DrawParams {
  frame: number; // gameplayFrames (0 for the static view)
  night: boolean; // nightFlag
  time: number; // 0..0xFFFF
  layer: number; // sceneLayer
  adult: boolean;
  sceneId: number;
  masterQuest: boolean; // the Water Temple entrance texture sits in segment 8 instead of 6
  dayNightTextures: number[] | null; // the 40 pointers after sDefaultDisplayList
}

const ENDDL = [0xdf000000, 0];
const PIPESYNC = [0xe7000000, 0];
const TILESYNC = [0xe8000000, 0];
const rgba = (r: number, g: number, b: number, a: number) => (((r & 255) << 24) | ((g & 255) << 16) | ((b & 255) << 8) | (a & 255)) >>> 0;
const env = (r: number, g: number, b: number, a: number) => [0xfb000000, rgba(r, g, b, a)];
const prim = (r: number, g: number, b: number, a: number, lod = 0) => [(0xfa000000 | (lod & 255)) >>> 0, rgba(r, g, b, a)];
const tileSize = (t: number, x: number, y: number, w: number, h: number) => {
  x = (x >>> 0) % 2048;
  y = (y >>> 0) % 2048;
  return [(0xf2000000 | ((x & 0xfff) << 12) | (y & 0xfff)) >>> 0, ((t << 24) | (((x + ((w - 1) << 2)) & 0xfff) << 12) | ((y + ((h - 1) << 2)) & 0xfff)) >>> 0];
};
const dl = (...parts: number[][]): SegmentValue => ({ kind: 'dl', words: [...parts.flat(), ...ENDDL] });
const texScroll = (x: number, y: number, w: number, h: number) => dl(TILESYNC, tileSize(0, x, y, w, h));
const twoTexScroll = (t1: number, x1: number, y1: number, w1: number, h1: number, t2: number, x2: number, y2: number, w2: number, h2: number, extra: number[] = []) =>
  dl(TILESYNC, tileSize(t1, x1, y1, w1, h1), TILESYNC, tileSize(t2, x2, y2, w2, h2), extra);

const CLOCK = (h: number, m: number) => Math.trunc(((h * 60 + m) * 0x10000) / (24 * 60) + 0.5);
// (coss(angle) >> 8 >> 1) + 192 as the game stores it in a u8
const coss8 = (angle: number) => {
  const c = Math.trunc(Math.cos(((angle & 0xffff) / 0x10000) * 2 * Math.PI) * 0x7fff) >> 8;
  return ((c >> 1) + 192) & 0xff;
};

const SCENE_JABU_JABU = 0x02, SCENE_SHADOW_TEMPLE_BOSS = 0x18, SCENE_CASTLE_COURTYARD_GUARDS_DAY = 0x45, SCENE_OUTSIDE_GANONS_CASTLE = 0x64;

export function ootDrawConfig(sdc: number, p: DrawParams): DrawConfig {
  const opa: BufferState = { segments: new Map() }, xlu: BufferState = { segments: new Map() };
  const notes: string[] = [];
  const f = p.frame >>> 0;
  const night = p.night ? 1 : 0;
  const dp0 = 0, dp1 = 0; // roomCtx.drawParams: 0 until actors set them
  const tex = (i: number): SegmentValue | null => (p.dayNightTextures ? { kind: 'addr', addr: p.dayNightTextures[i] } : null);
  const setTex = (s: BufferState, seg: number, i: number) => {
    const v = tex(i);
    if (v) s.segments.set(seg, v);
  };
  const both = (seg: number, v: SegmentValue) => { opa.segments.set(seg, v); xlu.segments.set(seg, v); };
  const env128 = () => { opa.env = rgba(128, 128, 128, 128); xlu.env = rgba(128, 128, 128, 128); };
  const water = (a: number) => twoTexScroll(0, 127 - (f % 128), (a * f) % 128, 32, 32, 1, f % 128, (a * f) % 128, 32, 32);
  switch (sdc) {
    case 0: // SDC_DEFAULT
      for (let s = 8; s <= 13; s++) both(s, dl());
      opa.prim = xlu.prim = rgba(128, 128, 128, 128);
      env128();
      break;
    case 1: // Hyrule Field
      xlu.segments.set(8, water(3));
      xlu.segments.set(9, water(10));
      env128();
      if (p.time > CLOCK(7, 0) && p.time <= CLOCK(18, 30)) xlu.segments.set(10, dl());
      else { xlu.segments.set(10, dl(prim(255, 255, 255, dp0), [0xde000000, 0x03012b20])); notes.push('night list 0x03012B20 (hypothesis)'); }
      break;
    case 2: setTex(opa, 8, 30 + night); env128(); break; // Kakariko Village
    case 3: xlu.segments.set(8, water(6)); xlu.segments.set(9, water(3)); xlu.segments.set(10, water(1)); env128(); break;
    case 4: { // Kokiri Forest
      xlu.segments.set(9, water(1));
      xlu.segments.set(8, water(10));
      env128();
      let a3 = 128, a0 = 500;
      if (p.layer === 4) a3 = 255 - (dp0 & 255);
      else if (p.layer === 6) a0 = dp0 + 500;
      opa.segments.set(10, dl(PIPESYNC, env(128, 128, 128, a3)));
      both(11, dl(PIPESYNC, env(128, 128, 128, Math.trunc(a0 * 0.1))));
      opa.segments.set(12, twoTexScroll(0, 0, 0, 32, 16, 1, 0, 0, 32, 16));
      break;
    }
    case 5: { // Lake Hylia
      const d = p.layer >= 4 || p.adult ? 87 : dp0;
      opa.segments.set(8, twoTexScroll(0, f, f, 32, 32, 1, 0, 0, 32, 32, env(0, 0, 0, d + 168)));
      opa.segments.set(9, twoTexScroll(0, -f, -f, 32, 32, 1, 0, 0, 16, 64, env(0, 0, 0, d + 168)));
      opa.env = rgba(255, 255, 255, 128);
      break;
    }
    case 6: // Zora's Domain
      opa.segments.set(12, twoTexScroll(0, 0, 0, 64, 32, 1, 0, p.adult ? 0 : 127 - (f % 128), 64, 32));
      opa.env = rgba(128, 128, 128, 128);
      setTex(xlu, 8, 32 + night);
      break;
    case 7: // Zora's Fountain
      opa.segments.set(8, twoTexScroll(0, f % 128, 0, 32, 32, 1, 0, 0, 32, 32));
      xlu.segments.set(9, twoTexScroll(0, 0, 255 - ((2 * f) % 256), 64, 64, 1, 0, 255 - ((2 * f) % 256), 64, 64));
      xlu.segments.set(10, twoTexScroll(0, 0, f % 128, 32, 32, 1, 0, f % 128, 32, 32));
      env128();
      break;
    case 8: // Gerudo Valley
      xlu.segments.set(8, twoTexScroll(0, 0, (3 * f) % 1024, 32, 256, 1, 0, (3 * f) % 1024, 32, 256));
      xlu.segments.set(9, twoTexScroll(0, 0, f % 256, 64, 64, 1, 0, f % 256, 64, 64));
      xlu.segments.set(10, twoTexScroll(0, 0, (2 * f) % 128, 32, 32, 1, 0, (2 * f) % 128, 32, 32));
      opa.segments.set(11, twoTexScroll(0, 0, 0, 32, 32, 1, 0, 127 - ((3 * f) % 128), 32, 32));
      xlu.segments.set(12, twoTexScroll(0, 0, f % 128, 32, 32, 1, 0, f % 128, 32, 32));
      xlu.segments.set(13, twoTexScroll(0, 0, f % 64, 16, 16, 1, 0, f % 64, 16, 16));
      env128();
      break;
    case 9: // Lost Woods
      xlu.segments.set(8, twoTexScroll(0, f % 128, 0, 32, 16, 1, f % 128, 0, 32, 16));
      xlu.segments.set(9, twoTexScroll(0, 127 - (f % 128), f % 128, 32, 32, 1, f % 128, f % 128, 32, 32));
      env128();
      break;
    case 10: opa.segments.set(8, twoTexScroll(0, 0, 0, 32, 32, 1, 0, 127 - (f % 128), 32, 32)); env128(); break; // Desert Colossus
    case 11: setTex(opa, 8, 34 + night); break; // Gerudo's Fortress
    case 12: // Haunted Wasteland
      opa.segments.set(8, twoTexScroll(0, 0, f % 128, 32, 32, 1, 0, f % 128, 32, 32));
      xlu.segments.set(9, twoTexScroll(0, 0, f % 128, 32, 32, 1, 0, f % 128, 32, 32));
      env128();
      break;
    case 13: xlu.segments.set(8, water(10)); xlu.segments.set(9, water(3)); env128(); break; // Hyrule Castle
    case 14: // Death Mountain Trail
      if (p.time > CLOCK(7, 0) && p.time <= CLOCK(18, 0)) xlu.segments.set(8, dl());
      else { xlu.segments.set(8, dl(prim(255, 255, 255, dp0), [0xde000000, 0x0300aa48])); notes.push('night list 0x0300AA48 (hypothesis)'); }
      env128();
      break;
    case 15: { // Death Mountain Crater
      const c = coss8(f * 1500);
      opa.segments.set(8, twoTexScroll(0, 0, f % 128, 32, 32, 1, 0, f % 128, 32, 32));
      opa.env = rgba(c, c, 255, 128);
      xlu.env = rgba(128, 128, 128, 128);
      break;
    }
    case 16: // Goron City
      opa.segments.set(8, twoTexScroll(0, 0, 127 - (f % 128), 32, 32, 1, f % 128, 0, 32, 32));
      env128();
      setTex(xlu, 8, 36 + night);
      break;
    case 17: setTex(opa, 8, 38 + night); env128(); break; // Lon Lon Ranch
    case 18: // Fire Temple
      opa.segments.set(8, twoTexScroll(0, 0, 127 - (f % 128), 32, 32, 1, 127 - (f % 128), 0, 32, 32));
      opa.segments.set(9, twoTexScroll(0, (3 * f) % 128, 127 - ((6 * f) % 128), 32, 32, 1, (6 * f) % 128, 127 - ((3 * f) % 128), 32, 32));
      opa.env = xlu.env = rgba(128, 128, 128, 64);
      break;
    case 19: // Deku Tree
      xlu.segments.set(9, twoTexScroll(0, 127 - (f % 128), f % 128, 32, 32, 1, f % 128, f % 128, 32, 32));
      xlu.env = rgba(128, 128, 128, 128);
      setTex(opa, 8, 0 + night);
      break;
    case 20: { // Dodongo's Cavern
      setTex(opa, 8, 2 + night);
      setTex(opa, 9, 4 + ((f & 14) >> 1));
      xlu.segments.set(9, twoTexScroll(0, f % 256, 0, 64, 32, 1, 0, f % 128, 64, 32));
      opa.segments.set(10, twoTexScroll(0, 0, f % 128, 32, 32, 1, 0, (2 * f) % 128, 32, 32));
      env128();
      opa.segments.set(11, dl(PIPESYNC, env(255, 255, 255, 0)));
      opa.segments.set(12, dl(PIPESYNC, env(255, 255, 255, 0)));
      break;
    }
    case 21: // Jabu-Jabu
      if (p.sceneId === SCENE_JABU_JABU) {
        opa.segments.set(8, twoTexScroll(0, f % 128, (2 * f) % 128, 32, 32, 1, 127 - (f % 128), (2 * f) % 128, 32, 32));
        opa.segments.set(11, twoTexScroll(0, 0, 255 - ((4 * f) % 256), 32, 64, 1, 0, 255 - ((4 * f) % 256), 32, 64));
      } else {
        opa.segments.set(8, texScroll((127 - f) % 128, f % 128, 32, 32));
      }
      env128();
      notes.push('segment 0xD matrix (pulsing walls): identity');
      break;
    case 22: setTex(xlu, 8, 26 + night); xlu.segments.set(9, water(1)); opa.segments.set(10, water(1)); env128(); break; // Forest Temple
    case 23: { // Water Temple (drawParams[1] = water level state, 0 at scene start)
      // Retail lists read the entrance texture from segment 6, Master Quest builds from segment 8: set both.
      setTex(xlu, 6, 14 + night);
      setTex(xlu, 8, 14 + night);
      const e = (x: number, a: number) => twoTexScroll(0, x, 0, 32, 32, 1, 0, 0, 32, 32, env(0, 0, 0, a));
      opa.segments.set(8, e(f, 255));
      opa.segments.set(9, e(f, 255));
      opa.segments.set(10, e(f % 128, 160));
      opa.segments.set(11, e(3 * f, 185));
      xlu.segments.set(12, twoTexScroll(0, f, f, 32, 32, 1, 0, 127 - f, 32, 32, env(0, 0, 0, 128)));
      xlu.segments.set(13, twoTexScroll(0, 4 * f, 0, 32, 32, 1, 4 * f, 0, 32, 32, env(0, 0, 0, 128)));
      break;
    }
    case 24: // Shadow Temple and Bottom of the Well
      (p.sceneId === SCENE_SHADOW_TEMPLE_BOSS ? opa : xlu).segments.set(8, twoTexScroll(0, (2 * f) % 128, 0, 32, 32, 1, (2 * f) % 128, 0, 32, 32));
      env128();
      break;
    case 25: setTex(xlu, 8, 28 + night); break; // Spirit Temple
    case 26: // Inside Ganon's Castle
      xlu.segments.set(8, twoTexScroll(0, 127 - (f % 128), f % 512, 32, 128, 1, f % 128, f % 512, 32, 128));
      xlu.segments.set(9, water(1));
      opa.segments.set(10, water(1));
      env128();
      break;
    case 27: setTex(xlu, 8, 18 + night); opa.segments.set(9, water(1)); xlu.segments.set(10, water(1)); env128(); break; // Gerudo Training Ground
    case 28: // Deku Tree boss
      xlu.segments.set(8, twoTexScroll(0, (2 * f) % 256, 0, 64, 32, 1, 0, (2 * f) % 128, 64, 32));
      xlu.env = rgba(128, 128, 128, 128);
      break;
    case 29: // Water Temple boss
      opa.segments.set(8, twoTexScroll(0, f, 0, 32, 32, 1, 0, 0, 32, 32));
      opa.env = rgba(128, 128, 128, dp0);
      xlu.env = rgba(128, 128, 128, 145);
      break;
    case 30: // Temple of Time
      both(8, dl(prim(255, 255, 255, 255)));
      both(9, dl(prim(76, 76, 76, 255)));
      both(10, dl(PIPESYNC, env(0, 0, 0, dp0)));
      both(11, dl(prim(89, 89, 89, 255), PIPESYNC, env(0, 0, 0, dp0)));
      both(12, dl(prim(255, 255, 255, 255), PIPESYNC, env(0, 0, 0, dp0)));
      both(13, dl(PIPESYNC, env(0, 0, 0, dp1)));
      break;
    case 31: // Grottos
      xlu.segments.set(8, texScroll(0, f % 64, 256, 16));
      xlu.segments.set(9, water(1));
      opa.segments.set(10, twoTexScroll(0, 0, 0, 32, 32, 1, 0, 127 - (f % 128), 32, 32));
      opa.segments.set(11, texScroll(0, f % 128, 32, 32));
      xlu.segments.set(12, twoTexScroll(0, 0, (50 * f) % 2048, 8, 512, 1, 0, (60 * f) % 2048, 8, 512));
      opa.segments.set(13, twoTexScroll(0, 0, 0, 32, 64, 1, 0, f % 128, 32, 32));
      env128();
      break;
    case 32: // Chamber of the Sages
      xlu.segments.set(8, texScroll(0, (2 * f) % 256, 64, 64));
      opa.segments.set(10, water(1));
      xlu.segments.set(9, twoTexScroll(0, 127 - (f % 128), f % 256, 32, 64, 1, 0, 0, 32, 128));
      env128();
      break;
    case 33: // Great Fairy's Fountain
      xlu.segments.set(8, twoTexScroll(0, 127 - (f % 128), (3 * f) % 256, 32, 64, 1, f % 128, (3 * f) % 256, 32, 64));
      xlu.segments.set(9, water(3));
      env128();
      break;
    case 34: opa.segments.set(8, texScroll(0, f % 64, 4, 16)); opa.env = rgba(128, 128, 128, 128); break; // Shooting Gallery
    case 35: // Castle courtyard guards
      xlu.segments.set(8, water(3));
      if (p.sceneId === SCENE_CASTLE_COURTYARD_GUARDS_DAY) xlu.segments.set(9, texScroll(0, (10 * f) % 256, 32, 64));
      env128();
      break;
    case 36: { // Outside Ganon's Castle
      if (p.sceneId === SCENE_OUTSIDE_GANONS_CASTLE) {
        xlu.segments.set(9, texScroll(0, f % 256, 64, 64));
        xlu.segments.set(8, twoTexScroll(0, 0, 255 - (f % 256), 64, 64, 1, 0, f % 256, 64, 64));
      }
      opa.segments.set(11, twoTexScroll(0, 255 - (f % 128), f % 128, 32, 32, 1, f % 128, f % 128, 32, 32));
      const c = coss8(f * 1500);
      opa.env = rgba(c, c, c, 128);
      xlu.env = rgba(128, 128, 128, 128);
      break;
    }
    case 37: setTex(xlu, 8, 16 + night); opa.segments.set(9, water(1)); xlu.segments.set(10, water(1)); env128(); break; // Ice Cavern
    case 38: { // Ganon's Tower collapse exterior
      opa.segments.set(8, twoTexScroll(0, 0, f % 512, 64, 128, 1, 0, 511 - (f % 512), 64, 128));
      opa.segments.set(9, twoTexScroll(0, 0, f % 256, 32, 64, 1, 0, 255 - (f % 256), 32, 64));
      xlu.segments.set(10, twoTexScroll(0, 0, (20 * f) % 2048, 16, 512, 1, 0, (30 * f) % 2048, 16, 512));
      const c = coss8(f * 1500);
      opa.env = rgba(c, c, c, 128);
      xlu.env = rgba(128, 128, 128, 128);
      break;
    }
    case 39: xlu.segments.set(8, water(3)); xlu.segments.set(9, texScroll(0, f % 64, 256, 16)); env128(); break; // Fairy's Fountain
    case 40: opa.segments.set(9, texScroll(0, (3 * f) % 128, 32, 32)); setTex(xlu, 8, 12 + night); break; // Thieves' Hideout
    case 41: // Bombchu Bowling Alley
      xlu.segments.set(8, texScroll(127 - ((4 * f) % 128), 0, 32, 32));
      opa.segments.set(9, texScroll(0, (5 * f) % 64, 16, 16));
      opa.segments.set(10, texScroll(0, 63 - ((2 * f) % 64), 16, 16));
      xlu.segments.set(11, twoTexScroll(0, 0, 127 - ((3 * f) % 128), 32, 32, 1, 0, 0, 32, 32));
      env128();
      break;
    case 42: // Royal Family's Tomb
      xlu.segments.set(8, texScroll(0, f % 64, 256, 16));
      xlu.segments.set(9, twoTexScroll(0, 0, (60 * f) % 2048, 8, 512, 1, 0, (50 * f) % 2048, 8, 512));
      opa.segments.set(10, twoTexScroll(0, 127 - (f % 128), 0, 32, 32, 1, f % 128, 0, 32, 32));
      xlu.segments.set(11, twoTexScroll(0, 0, 1023 - ((6 * f) % 1024), 16, 256, 1, 0, 1023 - ((3 * f) % 1024), 16, 256));
      env128();
      break;
    case 43: // Lakeside Laboratory
      opa.segments.set(8, twoTexScroll(0, 0, 0, 32, 32, 1, 0, f % 128, 32, 32));
      xlu.segments.set(10, water(1));
      xlu.segments.set(9, texScroll(0, 255 - ((10 * f) % 256), 32, 64));
      env128();
      break;
    case 44: setTex(xlu, 8, 20 + night); env128(); break; // Lon Lon buildings
    case 45: { // Market guard house
      const v = p.adult ? 1 : night;
      setTex(opa, 8, 24 + v);
      setTex(opa, 9, 22 + v);
      env128();
      break;
    }
    case 46: // Potion shop (granny)
      opa.segments.set(8, texScroll(0, (3 * f) % 128, 32, 32));
      xlu.segments.set(9, twoTexScroll(0, 0, 1023 - ((3 * f) % 1024), 16, 256, 1, 0, 1023 - ((6 * f) % 1024), 16, 256));
      env128();
      break;
    case 47: xlu.segments.set(8, water(1)); env128(); break; // calm water
    case 48: xlu.segments.set(8, texScroll(0, f % 64, 256, 16)); env128(); break; // grave exit light
    case 49: opa.segments.set(8, texScroll(127 - ((2 * f) % 128), 0, 32, 64)); opa.segments.set(9, texScroll(0, (2 * f) % 512, 128, 128)); env128(); break;
    case 50: // Fishing pond
      xlu.segments.set(8, twoTexScroll(0, 127 - (f % 128), f % 128, 32, 32, 1, f % 128, f % 128, 32, 32, prim(255, 255, 255, dp0 + 127)));
      env128();
      break;
    default:
      break; // 51, 52: screen shake only
  }
  return { opa, xlu, notes };
}

// MM AnimatedMaterial list at frame `step` (AnimatedMat_DrawMain): 8-byte entries {s8 segment (the list ends after a
// negative one; 0 = no list), s16 type, params*}; segment used = |segment| + 7.
export function mmAnimatedMaterials(buf: Uint8Array, ptr: number, step: number): { segments: Map<number, SegmentValue>; notes: string[] } {
  const segments = new Map<number, SegmentValue>();
  const notes: string[] = [];
  let o = ptr & 0xffffff;
  if (!ptr || ptr >>> 24 !== 2 || o >= buf.length) return { segments, notes };
  const s8 = (q: number) => (buf[q] << 24) >> 24;
  const at = (q: number) => u32(buf, q) & 0xffffff;
  for (let guard = 0; guard < 64 && o + 8 <= buf.length; guard++) {
    const segment = s8(o);
    if (segment === 0) break;
    const type = (u16(buf, o + 2) << 16) >> 16;
    const params = at(o + 4);
    const seg = Math.abs(segment) + 7;
    const scroll = (q: number) => ({ x: s8(q), y: s8(q + 1), w: buf[q + 2], h: buf[q + 3] });
    if (params + 16 <= buf.length) {
      switch (type) {
        case 0: {
          const a = scroll(params);
          segments.set(seg, texScroll(a.x * step, -(a.y * step), a.w, a.h));
          break;
        }
        case 1: {
          const a = scroll(params), c = scroll(params + 4);
          segments.set(seg, twoTexScroll(0, a.x * step, -(a.y * step), a.w, a.h, 1, c.x * step, -(c.y * step), c.w, c.h));
          break;
        }
        case 2: case 3: case 4: {
          // Colour key frames: at step 0 all three kinds give the first key's colours.
          const length = u16(buf, params) || 1;
          const primColors = at(params + 4), envColors = u32(buf, params + 8) ? at(params + 8) : -1;
          const k = type === 2 ? step % length : 0;
          const pc = [0, 1, 2, 3, 4].map((j) => buf[primColors + k * 5 + j] ?? 0);
          const words = [prim(pc[0], pc[1], pc[2], pc[3], pc[4])];
          if (envColors >= 0) words.push(env(buf[envColors + k * 4] ?? 0, buf[envColors + k * 4 + 1] ?? 0, buf[envColors + k * 4 + 2] ?? 0, buf[envColors + k * 4 + 3] ?? 0));
          segments.set(seg, dl(...words));
          break;
        }
        case 5: {
          const length = u16(buf, params) || 1;
          const list = at(params + 4), indices = at(params + 8);
          segments.set(seg, { kind: 'addr', addr: u32(buf, list + (buf[indices + (step % length)] ?? 0) * 4) });
          break;
        }
        default:
          notes.push(`segment ${seg}: animated material type ${type} not handled`);
      }
    }
    o += 8;
    if (segment < 0) break;
  }
  return { segments, notes };
}
