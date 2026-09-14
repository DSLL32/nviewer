// Mario Kart 64 course loader: gCourseTable entry -> render-ready Level (nviewer src/rom/types.ts).
// Race courses use their retail credits whole-course root for one coherent static model; genuinely camera-dependent
// extras from render_<course>/func_8029122C remain available in a hidden layer. The alternate `mode: 'race'` path is
// retained for diagnostics and deduplicates the union of path-section/camera-direction recipes. Collision comes from
// collision.ts.
import { runDisplayList } from '../displaylist';
import type { DlLighting } from '../displaylist';
import type { Batch, Level, LevelLayer, Mesh, Texture, Instance, DebugInfo } from '../types';
import { buildLevel, meshFromBatches } from '../bomberman/common';
import {
  COURSES, courseSpace, loadCourseFiles, loadCommonFiles, readCourseTable, type Mk64Layout, type CourseFiles, type SegmentSpace,
} from './fs';
import { COURSE_DEFS, G, type Step, type W } from './courses';
import { buildCollision, SURFACE_NAMES, type CollisionResult } from './collision';
import { addSky, PROJECTION } from './environment';
import { addCoursePaths, addObjectMarkers, buildObjectTextureSegment, objectModel, startCamera, staticCourseCamera } from './objects';
import { fogPosition } from '../bomberman/common';

const G_DL = (addr: number): W => [0x06000000, addr >>> 0];
const ENDDL: W = [0xb8000000, 0];
// init_rdp + render_player_one_1p_screen: G_ZBUFFER | G_SHADE | G_CULL_BACK | G_LIGHTING | G_SHADING_SMOOTH, render
// mode AA_ZB_OPA_SURF; render_<course> clears G_LIGHTING first.
const INITIAL_GEOMETRY = 0x1 | 0x4 | 0x2000 | 0x200;
const INITIAL_RENDER_MODE = 0x00552078;
const KOOPA_PALM_LIGHT: DlLighting = { lights: [{ color: [255, 255, 254], dir: [0, 0, 1] }], ambient: [170, 170, 169] };

export interface LoadedCourse {
  level: Level;
  files: CourseFiles;
  space: SegmentSpace;
  collision: CollisionResult;
  stats: DebugInfo;
}

// find_vtx_and_set_colours: every vertex the list loads gets alpha (and rgb when r != 0).
function setVertexColours(sp: SegmentSpace, dl: number, alpha: number, rgb?: [number, number, number], depth = 0) {
  let o = sp.resolve(dl);
  if (o < 0 || depth > 16) return;
  for (;; o += 8) {
    const w0 = sp.dv.getUint32(o), w1 = sp.dv.getUint32(o + 4), op = w0 >>> 24;
    if (op === 0xb8) break;
    if (op === 0x06) setVertexColours(sp, w1, alpha, rgb, depth + 1);
    else if (op === 0x04) {
      const base = sp.resolve(w1), n = (w0 >>> 10) & 0x3f;
      for (let k = 0; base >= 0 && k < n; k++) {
        if (rgb && rgb[0]) { sp.buf[base + 16 * k + 12] = rgb[0]; sp.buf[base + 16 * k + 13] = rgb[1]; sp.buf[base + 16 * k + 14] = rgb[2]; }
        sp.buf[base + 16 * k + 15] = alpha;
      }
    }
  }
}

// Diagnostic race-recipe triangles already emitted: section variants call the same packed lists in different orders,
// so G_CULL_BACK (cleared and set by packed opcodes 0x56/0x57 and the recipes) can differ between two draws of one
// triangle. Keep the first copy, switching it to no culling if any other copy disables culling.
interface Emitted { batch: number; tri: number; mat: string; cull: boolean }
function dedupe(batches: Batch[], seen: Map<string, Emitted>, conflicts: { n: number; cull: number; samples: string[] }, all: Batch[]): Batch[] {
  const out: Batch[] = [];
  for (const b of batches) {
    const keep: number[] = [];
    const n = b.positions.length / 9;
    const noCull: number[] = [];
    for (let t = 0; t < n; t++) {
      const p = b.positions.subarray(t * 9, t * 9 + 9);
      // The diagnostic race recipes deliberately revisit section lists from several camera directions. Some copies have a
      // different command address (and occasionally a different material state), but occupy the exact same plane.
      // Geometry, rather than command provenance, is therefore the identity.  Ordered vertices keep intentional
      // reverse-wound back faces distinct.
      const geo = Array.from(p).join(',');
      const mat = `${b.texture}/${b.blend}/${Array.from(b.colors.subarray(t * 12, t * 12 + 12)).join(',')}`;
      const prev = seen.get(geo);
      if (prev === undefined) { seen.set(geo, { batch: -1, tri: keep.length, mat, cull: b.cullBack }); keep.push(t); if (!b.cullBack) noCull.push(t); }
      else if (prev.mat !== mat) { conflicts.n++; if (conflicts.samples.length < 12) conflicts.samples.push(`${geo.slice(0, 60)} | ${prev.mat.slice(0, 80)} | ${mat.slice(0, 80)}`); }
      else if (prev.cull !== b.cullBack) {
        conflicts.cull++;
        if (prev.cull && !b.cullBack) { prev.cull = false; (prev as Emitted & { uncull?: boolean }).uncull = true; }
      }
    }
    if (!keep.length) continue;
    const pick = <T extends Float32Array | Uint8Array | Uint32Array>(a: T, k: number, make: (n: number) => T): T => {
      const r = make(keep.length * k);
      keep.forEach((t, i) => r.set(a.subarray(t * k, t * k + k), i * k));
      return r;
    };
    const nb: Batch = {
      ...b, positions: pick(b.positions, 9, (x) => new Float32Array(x)), uvs: pick(b.uvs, 6, (x) => new Float32Array(x)),
      colors: pick(b.colors, 12, (x) => new Uint8Array(x)), ...(b.triSource ? { triSource: pick(b.triSource, 1, (x) => new Uint32Array(x)) } : {}),
    };
    const bi = all.push(nb) - 1;
    for (const [, e] of seen) if (e.batch === -1) e.batch = bi;
    out.push(nb);
  }
  return out;
}

// Splits every emitted batch whose triangles a later draw uncculled: returns, per emitted batch, its replacement batches.
function uncullSplit(seenMaps: Iterable<Map<string, Emitted>>, all: Batch[]): Batch[][] {
  const moves = new Map<number, Set<number>>();
  for (const seen of seenMaps) for (const e of seen.values()) if ((e as Emitted & { uncull?: boolean }).uncull && e.batch >= 0) {
    if (!moves.has(e.batch)) moves.set(e.batch, new Set());
    moves.get(e.batch)!.add(e.tri);
  }
  return all.map((b, bi) => {
    const m = moves.get(bi);
    if (!m || !b.cullBack) return [b];
    const n = b.positions.length / 9;
    const split = (want: boolean): Batch | null => {
      const idx = [...Array(n).keys()].filter((t) => m.has(t) === want);
      if (!idx.length) return null;
      const pick = <T extends Float32Array | Uint8Array | Uint32Array>(a: T, k: number, make: (n: number) => T): T => {
        const r = make(idx.length * k);
        idx.forEach((t, i) => r.set(a.subarray(t * k, t * k + k), i * k));
        return r;
      };
      return { ...b, cullBack: !want, positions: pick(b.positions, 9, (x) => new Float32Array(x)), uvs: pick(b.uvs, 6, (x) => new Float32Array(x)),
        colors: pick(b.colors, 12, (x) => new Uint8Array(x)), ...(b.triSource ? { triSource: pick(b.triSource, 1, (x) => new Uint32Array(x)) } : {}) };
    };
    return [split(false), split(true)].filter((x): x is Batch => !!x);
  });
}

const SURFACE_COLOURS: Record<number, [number, number, number]> = {
  0: [200, 200, 200], 1: [120, 120, 130], 2: [150, 100, 60], 3: [230, 210, 140], 4: [160, 150, 140], 5: [240, 240, 255], 6: [180, 120, 70],
  7: [210, 180, 110], 8: [80, 190, 70], 9: [140, 220, 255], 10: [170, 150, 100], 11: [200, 210, 230], 12: [120, 90, 70], 13: [190, 140, 90],
  14: [110, 80, 60], 15: [90, 80, 90], 16: [200, 160, 90], 17: [170, 110, 50], 0xfffc: [255, 150, 0], 0xfffd: [255, 40, 40], 0xfffe: [255, 220, 0],
  0xffff: [220, 60, 220],
};

export function loadCourseLevel(rom: Uint8Array, layout: Mk64Layout, id: number, opts: { mode?: 'race' | 'credits' } = {}): LoadedCourse {
  const courseId = id === 20 ? 7 : id; // award ceremony: Royal Raceway (load_ceremony_cutscene)
  const table = readCourseTable(rom, layout.courseTable);
  const files = loadCourseFiles(rom, layout, table[courseId]);
  const common = loadCommonFiles(rom, layout);
  const seg3 = id === 20 ? undefined : buildObjectTextureSegment(rom, courseId);
  const sp = courseSpace(files, common, 0x100000, seg3 ? { 3: seg3 } : {});
  const def = COURSE_DEFS[courseId];
  const ceremony = id === 20 ? COURSE_DEFS[20] : null;
  // before the vertex colour edits, as the game (colours do not matter); the ceremony builds none (gCollisionMeshCount = 0)
  const collision = id === 20 ? { triangles: [], skipped: { flag4: 0, degenerate: 0, floorFilter: 0, wallFilter: 0 }, commands: 0, min: [0, 0, 0] as [number, number, number], max: [0, 0, 0] as [number, number, number] } : buildCollision(sp, def);
  for (const vc of def.vertexColours ?? []) setVertexColours(sp, vc.dl, vc.alpha, vc.rgb);

  const textures: Texture[] = [];
  const textureKeys = new Map<string, number>();
  const run = (words: W[], lighting?: DlLighting): Batch[] => {
    const at = sp.emit([...words, ENDDL]);
    const scratch = sp.scratch;
    try {
      return runDisplayList({
        buf: sp.buf, ucode: 'f3dex', resolve: sp.resolve, textures, textureKeys, keyPrefix: '', vertexScale: 1, mirrorX: false,
        geometryMode: INITIAL_GEOMETRY | (lighting ? 0x20000 : 0), renderMode: INITIAL_RENDER_MODE,
        combineMode: [G.CC_SHADE[0], G.CC_SHADE[1]], combiner: true, decals: true, ...(lighting ? { lighting } : {}),
      }, at);
    } finally {
      sp.scratch = scratch - (words.length + 1) * 8;
    }
  };

  const meshes: Mesh[] = [];
  const instances: Instance[] = [];
  const layers: LevelLayer[] = [];
  // Keep visibility realms independent: a hidden camera-dependent or translucent overlay must not consume the
  // opaque course face that remains visible when that optional layer is disabled.
  const seen = new Map<string, Map<string, Emitted>>();
  const conflicts = { n: 0, cull: 0, samples: [] as string[] };
  const emitted: Batch[] = [];
  const layerOf = (name: string, kind: LevelLayer['kind'], visibleByDefault = true) => {
    let l = layers.find((q) => q.name === name);
    if (!l) layers.push((l = { name, kind, instances: [], ...(visibleByDefault ? {} : { visibleByDefault: false }) }));
    return l;
  };
  const place = (mesh: Mesh, layer: LevelLayer, pos: [number, number, number] = [0, 0, 0], info: DebugInfo = {}) => {
    if (!mesh.batches.length) return;
    const m = meshes.push(mesh) - 1;
    layer.instances.push(instances.push({ name: mesh.name, mesh: m, matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...pos, 1]), info }) - 1);
  };
  const hex = (v: number) => `0x${(v >>> 0).toString(16)}`;
  layerOf('main', 'main');

  let totalTris = 0;
  // Meshes are built after both passes, so that triangles whose culling a later draw switched off can be moved.
  const groups: { name: string; layer: LevelLayer; pos: [number, number, number]; info: DebugInfo; batches: number[] }[] = [];
  const stepOf = new Map<string, Step>();
  const steps_ = (name: string) => stepOf.get(name);
  const pass = (steps: Step[], passName: string, kind: LevelLayer['kind']) => {
    let state: W[] = [];
    const main: number[] = [];
    for (const st of steps) {
      state = [...state, ...(st.state ?? [])];
      const lists = [...(st.dls ?? [])];
      if (st.table) for (let k = 0; k < st.table.count; k++) { const a = sp.u32(st.table.addr + 4 * k); if (a && !lists.includes(a)) lists.push(a); }
      let batches: Batch[] = [];
      for (const dl of lists) batches.push(...run([...state, G_DL(dl)]));
      const first = emitted.length;
      const conditional = st.note?.startsWith('only when');
      const realm = conditional ? 'camera-dependent' : passName;
      let realmSeen = seen.get(realm);
      if (!realmSeen) seen.set(realm, realmSeen = new Map());
      dedupe(batches, realmSeen, conflicts, emitted);
      const indices = [...Array(emitted.length - first).keys()].map((k) => first + k);
      if (conditional || st.cameraPlane || st.translate) {
        stepOf.set(`${passName}: ${lists.map(hex).join(' ')}`, st);
        groups.push({
          name: `${passName}: ${lists.map(hex).join(' ')}`, layer: conditional ? layerOf('camera-dependent', 'foreground', false) : layerOf(passName, kind),
          pos: st.translate ?? [0, 0, 0], info: { lists: lists.map(hex).join(' '), note: st.note ?? '' }, batches: indices,
        });
      } else main.push(...indices);
    }
    if (main.length) groups.push({ name: passName, layer: layerOf(passName, kind), pos: [0, 0, 0], info: { pass: passName }, batches: main });
  };
  if (ceremony?.endingList) {
    // copy the ending-segment list (up to its G_ENDDL) into the scratch area and draw it
    const at = layout.endingRom + (ceremony.endingList - 0x80280000);
    const words: W[] = [];
    for (let k = 0; k < 512; k++) { const w0 = (rom[at + 8 * k] << 24 | rom[at + 8 * k + 1] << 16 | rom[at + 8 * k + 2] << 8 | rom[at + 8 * k + 3]) >>> 0, w1 = (rom[at + 8 * k + 4] << 24 | rom[at + 8 * k + 5] << 16 | rom[at + 8 * k + 6] << 8 | rom[at + 8 * k + 7]) >>> 0; if (w0 === 0xb8000000) break; words.push([w0, w1]); }
    const b = run([G.CULL_ON, ...words]);
    place({ ...meshFromBatches('ceremony (D_80284F70)', b), info: { list: '0x80284f70', rom: `0x${at.toString(16)}` } }, layerOf('main', 'main'));
  } else if (def.credits && opts.mode !== 'race') {
    // The retail credits root is the game's purpose-built whole-course display list.  Unlike a union of every
    // camera-direction entry in the race section table, it contains each static part once and establishes material
    // state coherently across its child lists.  That distinction matters: the section-table union includes mutually
    // exclusive route/LOD faces and restarts inherited texture state at arbitrary entry boundaries.
    const b = run([G.CULL_ON, G_DL(def.credits)]);
    // Bowser's lava is authored as one irregular triangulated field whose faces all use essentially the same
    // texel density, but rotate that basis independently. That is valid retail data (texture scale 0xFFFF, zero
    // tile shifts, 32x32 wrapping, and no runtime scroll target), yet its seams dominate an unrestricted overhead
    // view. Apply the explicitly declared material-wide viewer presentation; never key this to a triangle or DL.
    const presentations: string[] = [];
    for (const p of def.planarPresentation ?? []) {
      const source = `image 0x${p.textureSource.toString(16)} tmem 0x0`;
      let changed = 0;
      for (const batch of b) {
        if (textures[batch.texture]?.source !== source) continue;
        const uvs = new Float32Array(batch.uvs.length);
        for (let v = 0; v < batch.positions.length / 3; v++) {
          uvs[v * 2] = batch.positions[v * 3] / p.worldPeriod;
          uvs[v * 2 + 1] = batch.positions[v * 3 + 2] / p.worldPeriod;
        }
        batch.uvs = uvs;
        changed += batch.positions.length / 9;
      }
      if (changed) presentations.push(`${p.note}; ${changed} triangles; material ${source}`);
    }
    const solid = b.filter((q) => q.blend !== 'blend');
    const translucent = b.filter((q) => q.blend === 'blend');
    if (solid.length) place({ ...meshFromBatches('whole-course credits root', solid), info: { list: hex(def.credits), source: 'retail whole-course display list', ...(presentations.length ? { presentation: presentations.join('\n') } : {}) } }, layerOf('main', 'main'));
    if (translucent.length) place({ ...meshFromBatches('whole-course translucent geometry', translucent), info: { list: hex(def.credits), source: 'retail whole-course display list', ...(presentations.length ? { presentation: presentations.join('\n') } : {}) } }, layerOf('translucent', 'foreground'));

    // Keep genuinely view-dependent extras inspectable without baking one arbitrary race camera's choice into the
    // default course.  The raw under-camera plane is intentionally hidden; it only has meaning after per-frame
    // camera translation and texture scrolling in the game.
    for (const steps of [def.opaque, def.translucent]) {
      let state: W[] = [];
      for (const st of steps) {
        state = [...state, ...(st.state ?? [])];
        if (!st.cameraPlane && !st.note?.startsWith('only when')) continue;
        const lists = [...(st.dls ?? [])];
        if (st.table) for (let k = 0; k < st.table.count; k++) { const a = sp.u32(st.table.addr + 4 * k); if (a && !lists.includes(a)) lists.push(a); }
        const batches = lists.flatMap((dl) => run([...state, G_DL(dl)]));
        if (!batches.length) continue;
        place({ ...meshFromBatches(`camera-dependent: ${lists.map(hex).join(' ')}`, batches), info: {
          lists: lists.map(hex).join(' '), note: st.note ?? '', ...(st.cameraPlane ? { runtime: 'translated beneath the camera each frame' } : {}),
        } }, layerOf('camera-dependent', 'foreground', false), st.translate ?? [0, 0, 0]);
      }
    }
  } else {
    pass(def.opaque, 'main', 'main');
    pass(def.translucent, 'translucent', 'foreground');
    const replaced = uncullSplit(seen.values(), emitted);
    // bounds of the main course mesh, for planes the game keeps under the camera
    const mn = [Infinity, Infinity], mx = [-Infinity, -Infinity];
    for (const g of groups) if (g.name === 'main') for (const i of g.batches) for (const b of replaced[i]) for (let k = 0; k < b.positions.length; k += 3) {
      mn[0] = Math.min(mn[0], b.positions[k]); mx[0] = Math.max(mx[0], b.positions[k]); mn[1] = Math.min(mn[1], b.positions[k + 2]); mx[1] = Math.max(mx[1], b.positions[k + 2]);
    }
    for (const g of groups) {
      const mesh = { ...meshFromBatches(g.name, g.batches.flatMap((i) => replaced[i])), info: g.info };
      const step = steps_(g.name);
      if (step?.cameraPlane && mesh.batches.length) {
        // Banshee Boardwalk: a 500-unit octagon the game draws at (camera x, -82, camera z) with a scrolling texture,
        // so the water always covers the view. Static stand-in: one quad over the course bounds with the octagon's
        // texture, colour and texel density (u, v gradients from its first triangle).
        const b0 = mesh.batches[0];
        const P = (k: number) => [b0.positions[k * 3], b0.positions[k * 3 + 2]], U = (k: number) => [b0.uvs[k * 2], b0.uvs[k * 2 + 1]];
        const [p0, p1, p2] = [P(0), P(1), P(2)], [u0, u1, u2] = [U(0), U(1), U(2)];
        const det = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
        const grad = (i: number) => [((u1[i] - u0[i]) * (p2[1] - p0[1]) - (u2[i] - u0[i]) * (p1[1] - p0[1])) / det, ((u2[i] - u0[i]) * (p1[0] - p0[0]) - (u1[i] - u0[i]) * (p2[0] - p0[0])) / det];
        const gu = grad(0), gv = grad(1);
        const uvAt = (x: number, z: number) => [u0[0] + gu[0] * (x - p0[0]) + gu[1] * (z - p0[1]), u0[1] + gv[0] * (x - p0[0]) + gv[1] * (z - p0[1])];
        const [x0, z0, x1, z1] = [mn[0] - 500, mn[1] - 500, mx[0] + 500, mx[1] + 500];
        const quad = [[x0, z0], [x0, z1], [x1, z1], [x0, z0], [x1, z1], [x1, z0]];
        const y = b0.positions[1];
        const col = Array.from(b0.colors.subarray(0, 4));
        const plane: Batch = { ...b0, cullBack: false, positions: new Float32Array(quad.flatMap(([x, z]) => [x, y, z])), uvs: new Float32Array(quad.flatMap(([x, z]) => uvAt(x, z))),
          colors: new Uint8Array(quad.flatMap(() => col)), triSource: new Uint32Array([b0.triSource?.[0] ?? 0, b0.triSource?.[0] ?? 0]) };
        place({ ...meshFromBatches(`${g.name} (quad over the course)`, [plane]), info: { ...g.info, stand_in: 'octagon under the camera -> quad over the course bounds' } }, g.layer, g.pos, g.info);
      } else place(mesh, g.layer, g.pos, g.info);
    }
  }
  for (const m of meshes) for (const b of m.batches) totalTris += b.positions.length / 9;

  const markers = [] as NonNullable<Level['markers']>;
  const objects = addObjectMarkers(sp, id, collision.triangles, layers, markers);
  const path = addCoursePaths(sp, id, meshes, instances, layers);
  markers.push(...path.markers);

  const camera = startCamera(path.main) ?? staticCourseCamera(id);
  const matrix = (position: [number, number, number], scale: number, yaw = 0) => {
    const c = Math.cos(yaw) * scale, s = Math.sin(yaw) * scale;
    return new Float32Array([c, 0, -s, 0, 0, scale, 0, 0, s, 0, c, 0, position[0], position[1], position[2], 1]);
  };
  const placeInstance = (meshIndex: number, layer: LevelLayer, name: string, position: [number, number, number],
    scale: number, yaw: number, info: DebugInfo, animated = false, billboard = false) => {
    const instance = instances.push({ name, mesh: meshIndex, matrix: matrix(position, scale, yaw), ...(billboard ? { billboard: 'y' as const } : {}), ...(animated ? { animated: true } : {}), info }) - 1;
    layer.instances.push(instance);
  };
  const objectLayer = layers[objects.layer];
  const modelMeshes = new Map<string, number>();
  const tlut256 = (address: number): W[] => [
    [0xfd100000, address], [0xe8000000, 0], [0xf5000100, 0x07000000], [0xe6000000, 0], [0xf0000000, 0x073fc000], [0xe7000000, 0],
  ];
  for (const object of objects.placements) {
    const recipe = objectModel(courseId, object);
    if (!recipe) continue;
    const key = `${recipe.roots.join(',')}/${recipe.name}`;
    let meshIndex = modelMeshes.get(key);
    if (meshIndex === undefined) {
      const words = object.name === 'item box' ? recipe.roots.map(G_DL) : [
        G.TEX_ON, G.CC_MODULATEIDECALA, G.RM_TEX_EDGE, G.CULL_OFF,
        ...tlut256(0x0d004c68), ...recipe.roots.map(G_DL),
      ];
      // The palm renderer enables G_LIGHTING before these lists. Their vertices store signed normals, while each
      // root's gsSPSetLights1 points at the same retail 170/255, +Z light. runDisplayList currently consumes the
      // supplied RSP light (the roots' F3DEX G_MOVEMEM light pointers are intentionally not interpreted globally).
      const batches = run(words, recipe.lighting === 'koopa palm' ? KOOPA_PALM_LIGHT : undefined);
      if (!batches.length) continue;
      meshIndex = meshes.push({ ...meshFromBatches(recipe.name, batches), info: {
        object: object.name, lists: recipe.roots.map(hex).join(' '),
        representation: object.name === 'item box' ? 'static frame of rotating actor' : recipe.billboard ? 'retail Y-axis camera billboard' : 'retail static model',
      } }) - 1;
      modelMeshes.set(key, meshIndex);
    }
    placeInstance(meshIndex, objectLayer, `${object.name} ${object.entry + 1}`, object.position, recipe.scale, 0,
      { object: object.name, entry: object.entry, id: hex(object.id), source: hex(object.source), authoredY: object.authoredY,
        model: recipe.roots.map(hex).join(' '), ...(recipe.billboard ? { billboard: 'Y-axis camera-facing' } : {}) }, object.name === 'item box', recipe.billboard);
  }
  if (id === 20) {
    const podiums = [0x0b0075f0, 0x0b008040, 0x0b008a90];
    const base: [number, number, number] = [-3203.5, 19, -478];
    for (let i = 0; i < podiums.length; i++) {
      const batches = run([G_DL(podiums[i])]);
      if (!batches.length) continue;
      const mi = meshes.push({ ...meshFromBatches(`ceremony podium part ${i + 1}`, batches), info: { list: hex(podiums[i]), source: 'ceremony segment B' } }) - 1;
      placeInstance(mi, objectLayer, `ceremony podium part ${i + 1}`, base, 1, -0x71c * Math.PI / 0x8000,
        { object: 'podium', part: i + 1, list: hex(podiums[i]), source: 'D_800E634C' }, true);
    }
    const trophyRoot = 0x0b0069d8;
    const trophyBatches = run([G_DL(trophyRoot)]);
    if (trophyBatches.length) {
      const mi = meshes.push({ ...meshFromBatches('gold trophy', trophyBatches), info: { list: hex(trophyRoot), source: 'ceremony segment B', variant: '150cc first-place frame' } }) - 1;
      placeInstance(mi, objectLayer, 'gold trophy', [base[0], base[1] + 16, base[2]], 0.005, 0,
        { object: 'gold trophy', list: hex(trophyRoot), variant: 'gold_trophy_dl10' }, true);
    }
  }

  // collision layers: one mesh per surface type
  const collisionInstances = new Set<number>();
  const bySurface = new Map<number, typeof collision.triangles>();
  for (const t of collision.triangles) { const l = bySurface.get(t.surface) ?? []; l.push(t); bySurface.set(t.surface, l); }
  const colLayer = layerOf('collision', 'collision', false);
  for (const [surface, list] of [...bySurface.entries()].sort((a, b) => a[0] - b[0])) {
    const pos: number[] = [], col: number[] = [], src: number[] = [];
    for (const t of list) {
      const [r, g, b] = SURFACE_COLOURS[surface] ?? [128, 128, 128];
      const shade = Math.abs(t.normal[1]) > 0.5 ? 1 : 0.7;
      // lift 0.5 along the normal; wind counter-clockwise seen from the normal side
      const lift = t.normal.map((q) => q * 0.5);
      const v = t.v.map((p) => p.map((q, k) => q + lift[k]));
      const e1 = [0, 1, 2].map((k) => v[1][k] - v[0][k]), e2 = [0, 1, 2].map((k) => v[2][k] - v[0][k]);
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const order = cr[0] * t.normal[0] + cr[1] * t.normal[1] + cr[2] * t.normal[2] < 0 ? [0, 2, 1] : [0, 1, 2];
      for (const k of order) { pos.push(...v[k]); col.push(Math.round(r * shade), Math.round(g * shade), Math.round(b * shade), 150); }
      src.push(t.source);
    }
    const positions = new Float32Array(pos);
    const mesh: Mesh = {
      name: `collision ${SURFACE_NAMES[surface] ?? `surface ${surface}`}`,
      radius: 0,
      batches: [{ texture: -1, blend: 'blend', depthTest: true, depthWrite: false, cullBack: false, decal: true, positions, uvs: new Float32Array(positions.length / 3 * 2), colors: new Uint8Array(col), triSource: new Uint32Array(src) }],
      info: { surface: hex(surface), name: SURFACE_NAMES[surface] ?? '', triangles: list.length },
    };
    const before = instances.length;
    place(mesh, colLayer);
    if (instances.length > before) collisionInstances.add(instances.length - 1);
  }

  const c = COURSES[id];
  const sky = addSky(id, meshes);
  const projection = PROJECTION[id] ?? PROJECTION[0];
  const fog = def.fog && id !== 3 ? fogPosition(def.fog.near, def.fog.far, def.fog.color, projection[0], projection[1]) : undefined;
  const level = buildLevel(
    { index: id, name: c.name, kind: c.kind, group: c.kind === 'race' ? c.cup : c.kind === 'battle' ? 'Battle' : 'Other' },
    `mk64-${id}`, textures, meshes, instances,
    { layers, markers, skies: sky.skies, clearColor: sky.clearColor, ...(camera ? { camera } : {}), ...(fog ? { fog } : {}) },
    collisionInstances,
  );
  return {
    level, files, space: sp, collision,
    stats: { triangles: totalTris, textures: textures.length, meshes: meshes.length, conflicts: conflicts.n, cullConflicts: conflicts.cull, conflictSamples: conflicts.samples.join('\n'), collisionTriangles: collision.triangles.length },
  };
}
