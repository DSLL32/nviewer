// Build a complete viewer Level for any Pilotwings 64 task (0..60) or island.
//   terrain (UVTR cells -> UVCT) + UVCT static objects + sea + sky (UVEN) + fog + environment palette/recolour,
//   island objects (UPWL), code-driven moving objects at their start pose, task objects (UPWT), start camera,
//   markers, ring-course ribbons, moving-object paths, and collision overlays.
// Game coordinates are Z up; viewer (x, y, z) = game (x, z, -y).
import type { Batch, Level, LevelLayer, Marker, Mesh, Instance } from '../types';
import { parseUvtx, type Uvmd } from './model';
import {
  PwData, parseTask, parseIsland, parseEnv, parseUvlv, parseUvtp, envId, ENV_PALETTE, ENV_LIGHTS, START_TERRA, ALT_TERRA, MAP_IDS,
  taskObjects, islandObjects, ringGraph, startCamera, parseSpth, spathPose, VEHICLES, ISLANDS, transformPoint, type Placed, type V3, type Mtx, type Task,
} from './objects';
import { EnvGeo, newCtx, modelMesh, contourMesh, partMatrices, type Tint } from './model';

export const ZUP_TO_YUP = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
export function mul4(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const r = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + rr] * b[c * 4 + k]; r[c * 4 + rr] = s; }
  return r;
}
const scale = (s: number) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
export const toViewer = (p: V3): [number, number, number] => [p[0], p[2], -p[1]];
const PILOT_VEHICLE_UVLV = [0x1c, 0x22, 0x28, 0x2f, 0x3b, 0x41, 0x35]; // levelComputeAppend, pilot Lark, by vehicle
export const BIRDMAN_TASK = [45, 53, 57, 49]; // first Birdman task per island (camera for island levels)

export interface SceneOpts {
  taskIndex?: number; mapIndex?: number; weather?: number;
  tint?: boolean; // environment recolour (default true)
  skyEyeZ?: number; // game Z the sky dome is baked for (default: camera eye Z); the game anchors the dome at Z = 0
  collision?: boolean; // build collision layers (default true)
}

export function buildScene(data: PwData, o: SceneOpts): Level {
  const task: Task | undefined = o.taskIndex !== undefined ? parseTask(data, o.taskIndex) : undefined;
  const mapIndex = task ? task.comm.mapIndex : o.mapIndex ?? 0;
  const weather = task ? task.comm.weather : o.weather ?? 0;
  const veh = task ? task.comm.veh : 6;
  const env = envId(mapIndex, weather);
  const E = parseEnv(data, env);
  const palette = ENV_PALETTE[env] !== undefined ? parseUvtp(data, ENV_PALETTE[env]) : null;
  const lists = [MAP_IDS[mapIndex], 0x1a, ...(veh === 0 || veh === 6 ? [0x1b] : []), PILOT_VEHICLE_UVLV[veh], 0x0c, 0x0d, 0x2e, 0x70 + env].map((id) => parseUvlv(data, id));
  const lights = ENV_LIGHTS[env];
  const tint: Tint | null = o.tint !== false && lights ? { colors: lights.colors, ops: lights.ops, models: new Set(lists.flatMap((l) => l.model)), contours: new Set(lists.flatMap((l) => l.contour)), textures: new Set(lists.flatMap((l) => l.texture)) } : null;
  const geo = new EnvGeo(data.rom, palette, tint);
  const ctx = newCtx();
  const meshes: Mesh[] = []; const instances: Instance[] = []; const markers: Marker[] = [];
  const layers: LevelLayer[] = [];
  const layer = (name: string, kind: LevelLayer['kind'], visibleByDefault = true, group?: string) => { layers.push({ name, kind, instances: [], visibleByDefault, ...(group ? { group } : {}) }); return layers.length - 1; };
  const L = {
    sea: layer('sea (UVEN model)', 'background'), terrain: layer(`terrain ${START_TERRA[mapIndex]}`, 'main'),
    alt: ALT_TERRA[mapIndex] !== undefined ? layer(`terrain ${ALT_TERRA[mapIndex]} (switched in by TPTS)`, 'main') : -1,
    statics: layer('static objects (UVCT)', 'main'), island: layer('island objects (UPWL)', 'objects'), moving: layer('moving objects (code, start pose)', 'objects'),
    task: layer('task objects (UPWT)', 'objects'), markers: layer('markers', 'markers', false), course: layer('ring course', 'markers', false),
    paths: layer('moving object paths', 'markers', false), colTerrain: layer('collision: terrain surfaces', 'collision', false), colVolumes: layer('collision: object boxes', 'collision', false),
  };
  const addInst = (li: number, inst: Instance) => { if (li < 0) return; layers[li].instances.push(instances.length); instances.push(inst); };
  const meshCache = new Map<string, number>();
  const cached = (key: string, make: () => Mesh) => { let i = meshCache.get(key); if (i === undefined) { i = meshes.length; meshes.push(make()); meshCache.set(key, i); } return i; };
  const romMd = (id: number) => geo.md(id);

  // ---- camera (task start, or the island's first Birdman start)
  const camTask = task ?? parseTask(data, BIRDMAN_TASK[mapIndex]);
  const sc = startCamera(camTask);
  const eyeZ = o.skyEyeZ ?? sc.eye[2];

  // ---- environment models: sky (flag 8) -> Level.skies, others (sea) -> background instance. _uvEnvDraw clears the
  // Z bit (state bit 21) unless flag 1, draws without fog unless flag 4.
  const skies: Level['skies'] = [];
  for (const em of E.models) {
    const mask = (s: number) => (em.flag & 1 ? s : s & ~0x200000);
    if (em.flag & 8) {
      const mesh = modelMesh(geo, ctx, em.model, { stateMask: mask, name: `sky UVMD ${em.model}` });
      for (const b of mesh.batches) for (let i = 0; i < b.positions.length; i += 3) { const y = b.positions[i + 1], z = b.positions[i + 2]; b.positions[i + 1] = z - eyeZ; b.positions[i + 2] = -y; }
      mesh.info = { ...mesh.info, note: `camera-relative in X/Y only; baked for eye Z ${eyeZ.toFixed(1)}` };
      skies.push({ name: `UVMD ${em.model}`, mesh: meshes.length }); meshes.push(mesh);
    } else {
      const mi = cached(`env${em.model}`, () => modelMesh(geo, ctx, em.model, { stateMask: mask, name: `sea UVMD ${em.model}` }));
      addInst(L.sea, { name: `sea UVMD ${em.model} (flag ${em.flag})`, mesh: mi, matrix: mul4(ZUP_TO_YUP, scale(1 / romMd(em.model).scaleDiv)), noFog: !(em.flag & 4), info: { uvmd: em.model, flag: em.flag, env } });
    }
  }

  // ---- terrain, static objects, terrain collision
  const classOf = new Map<number, number>();
  const surfClass = (tex: number) => { if (tex >= 0xffe) return -1; let c = classOf.get(tex); if (c === undefined) { c = parseUvtx(data.rom.comm('UVTX', tex)[0]).u32; classOf.set(tex, c); } return c; };
  const terraList: [number, number][] = [[START_TERRA[mapIndex], L.terrain]];
  if (ALT_TERRA[mapIndex] !== undefined) terraList.push([ALT_TERRA[mapIndex], L.alt]);
  const bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
  for (const [tk, li] of terraList) {
    const tr = geo.terrains[tk];
    for (let i = 0; i < 3; i++) { bmin[i] = Math.min(bmin[i], tr.bounds[i]); bmax[i] = Math.max(bmax[i], tr.bounds[i + 3]); }
    for (const cell of tr.cells) {
      if (!cell) continue;
      const cellM = mul4(ZUP_TO_YUP, cell.mtx);
      addInst(li, { name: `terra ${tk} cell ${cell.col},${cell.row} UVCT ${cell.uvct}`, mesh: cached(`ct${cell.uvct}`, () => contourMesh(geo, ctx, cell.uvct)), matrix: cellM, info: { terra: tk, col: cell.col, row: cell.row, uvct: cell.uvct } });
      const ct = geo.ct(cell.uvct);
      ct.objects.forEach((ob, k) => {
        if (ob.model >= data.rom.count('UVMD')) return;
        const m = mul4(cellM, ob.mtx[0]);
        addInst(L.statics, { name: `UVCT ${cell.uvct} object ${k} UVMD ${ob.model}`, mesh: cached(`md${ob.model}`, () => modelMesh(geo, ctx, ob.model)), matrix: m, info: { uvct: cell.uvct, object: k, uvmd: ob.model, mask: `0x${ob.mask.toString(16)}` } });
        if (o.collision !== false) volumeInstances(`UVCT ${cell.uvct} obj ${k}`, ob.model, mul4(m, scale(romMd(ob.model).scaleDiv)), 'static');
      });
      if (o.collision !== false) addInst(L.colTerrain, { name: `collision UVCT ${cell.uvct}`, mesh: cached(`col${cell.uvct}`, () => terrainCollisionMesh(cell.uvct)), matrix: cellM, info: { uvct: cell.uvct } });
    }
  }
  if (o.collision !== false && E.models.some((model) => !(model.flag & 8))) {
    const x0 = bmin[0], x1 = bmax[0], z0 = -bmax[1], z1 = -bmin[1];
    const positions = new Float32Array([x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z0, x1, 0, z1, x0, 0, z1]);
    const mesh: Mesh = { name: 'collision infinite sea plane (clipped to island bounds)', radius: Math.max(Math.abs(x0), Math.abs(x1), Math.abs(z0), Math.abs(z1)), batches: [{ texture: -1, blend: 'blend', depthTest: true, depthWrite: false, cullBack: false, positions, uvs: new Float32Array(12), colors: new Uint8Array(24).fill(80) }], info: { source: 'runtime sea plane z=0' } };
    const mi = meshes.length; meshes.push(mesh);
    addInst(L.colTerrain, { name: 'collision infinite sea plane', mesh: mi, matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), info: { clipped: 'island bounds' } });
  }

  function terrainCollisionMesh(id: number): Mesh {
    const ct = geo.ct(id); const dv = new DataView(ct.verts.buffer, ct.verts.byteOffset, ct.verts.byteLength);
    const triTex: number[] = new Array(ct.tris.length).fill(0xfff);
    for (const b of ct.batches) for (let t = b.firstTri; t < b.firstTri + b.triCount; t++) triTex[t] = b.state & 0xfff;
    const groups = new Map<string, { pos: number[]; col: number[] }>();
    ct.tris.forEach(([a, b, c], t) => {
      const tex = triTex[t], cls = surfClass(tex);
      const key = tex === 40 || tex === 48 ? 'water (no collision)' : cls === 4 ? 'water' : cls === 32 ? 'class 32' : cls < 0 ? 'untextured' : 'ground';
      const base = { ground: [150, 140, 110], water: [40, 110, 230], 'water (no collision)': [80, 220, 230], 'class 32': [240, 130, 40], untextured: [200, 60, 200] }[key]!;
      const p = [a, b, c].map((v) => [dv.getInt16(v * 16), dv.getInt16(v * 16 + 2), dv.getInt16(v * 16 + 4)]);
      const u = p[1].map((x, i) => x - p[0][i]), w = p[2].map((x, i) => x - p[0][i]);
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; const nl = Math.hypot(n[0], n[1], n[2]) || 1;
      const shade = 0.45 + 0.55 * Math.abs(n[2] / nl);
      let g = groups.get(key); if (!g) { g = { pos: [], col: [] }; groups.set(key, g); }
      for (const q of p) { g.pos.push(...q); g.col.push(...base.map((x) => Math.round(x * shade)), 255); }
    });
    const batches: Batch[] = [...groups].map(([, g]) => ({ texture: -1, blend: 'opaque', depthTest: true, depthWrite: true, cullBack: false, positions: new Float32Array(g.pos), uvs: new Float32Array((g.pos.length / 3) * 2), colors: new Uint8Array(g.col) }));
    return { name: `collision UVCT ${id}`, radius: 1000, batches, info: { uvct: id, classes: [...groups.keys()].join('/') } };
  }

  // UVMD collision boxes (36-byte records): part, skip count, hollow flag, min/max in world units in the part frame
  // (child parts: rotation only), cumulative triangle end index; leaf boxes with triangles test those triangles.
  function volumeInstances(name: string, model: number, frame: Float32Array, what: string) {
    const md = romMd(model);
    if (md.recs36.length) {
      const mi = cached(`vol${model}`, () => volumeMesh(md, model));
      addInst(L.colVolumes, { name: `${name} boxes UVMD ${model} (${what})`, mesh: mi, matrix: frame, info: { uvmd: model, boxes: md.recs36.length, tris: md.recs6.length } });
    } else {
      // The runtime falls back to the model-radius sphere when a UVMD has no box tree.
      const mi = cached('collision-unit-sphere', sphereMesh);
      addInst(L.colVolumes, { name: `${name} sphere UVMD ${model} (${what})`, mesh: mi, matrix: mul4(frame, scale(md.radius)), info: { uvmd: model, radius: md.radius } });
    }
  }
  function sphereMesh(): Mesh {
    const pos: number[] = []; const col: number[] = [];
    const rings = 6, sides = 12;
    const point = (ring: number, side: number) => {
      const lat = -Math.PI / 2 + (Math.PI * ring) / rings, lon = (2 * Math.PI * side) / sides;
      return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
    };
    for (let r = 0; r < rings; r++) for (let s = 0; s < sides; s++) {
      const q = [point(r, s), point(r, s + 1), point(r + 1, s + 1), point(r + 1, s)];
      for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...q[k]); col.push(60, 200, 255, 50); }
    }
    return { name: 'collision bounding sphere', radius: 1, batches: [{ texture: -1, blend: 'blend', depthTest: true, depthWrite: false, cullBack: false, positions: new Float32Array(pos), uvs: new Float32Array((pos.length / 3) * 2), colors: new Uint8Array(col) }] };
  }
  function volumeMesh(md: Uvmd, model: number): Mesh {
    const parts = partMatrices(md); const pos: number[] = []; const col: number[] = []; const tpos: number[] = []; const tcol: number[] = [];
    let prevEnd = 0;
    const vdv = new DataView(md.verts.buffer, md.verts.byteOffset, md.verts.byteLength);
    md.recs36.forEach((r) => {
      const dv = new DataView(r.buffer, r.byteOffset, 36); const part = r[0];
      const b = [4, 8, 12, 16, 20, 24].map((k) => dv.getFloat32(k)); const end = dv.getUint16(28); const nt = end - prevEnd;
      const pm = parts[part] ?? parts[0]; const rot = (v: number[]): number[] => [0, 1, 2].map((c) => v[0] * pm[c] + v[1] * pm[4 + c] + v[2] * pm[8 + c]);
      const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => rot([k & 1 ? b[3] : b[0], k & 2 ? b[4] : b[1], k & 4 ? b[5] : b[2]]));
      const faces = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
      const c = nt ? [230, 60, 230, 70] : r[1] ? [60, 200, 255, 50] : [255, 200, 40, 90];
      for (const f of faces) for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...corners[f[k]]); col.push(...c); }
      for (let t = prevEnd; t < end; t++) for (const v of md.recs6[t]) { tpos.push(...rot([vdv.getInt16(v * 16) / md.scaleDiv, vdv.getInt16(v * 16 + 2) / md.scaleDiv, vdv.getInt16(v * 16 + 4) / md.scaleDiv])); tcol.push(230, 60, 230, 255); }
      prevEnd = end;
    });
    const batches: Batch[] = [{ texture: -1, blend: 'blend', depthTest: true, depthWrite: false, cullBack: false, positions: new Float32Array(pos), uvs: new Float32Array((pos.length / 3) * 2), colors: new Uint8Array(col) }];
    if (tpos.length) batches.push({ texture: -1, blend: 'opaque', depthTest: true, depthWrite: true, cullBack: false, positions: new Float32Array(tpos), uvs: new Float32Array((tpos.length / 3) * 2), colors: new Uint8Array(tcol) });
    return { name: `collision boxes UVMD ${model}`, radius: md.radius, batches, info: { uvmd: model } };
  }

  // ---- objects
  const island = parseIsland(data, mapIndex);
  const placed: Placed[] = [...islandObjects(island, data), ...(task ? taskObjects(task, island) : island.LPAD.map((q, j): Placed => ({ layer: 'island', kind: 'UPWL LPAD', index: j, name: `landing pad ${j}`, model: 0xd4, mtx: [Math.cos(q.angle), Math.sin(q.angle), 0, 0, -Math.sin(q.angle), Math.cos(q.angle), 0, 0, 0, 0, 1, 0, q.pos[0], q.pos[1], q.pos[2], 1], pos: q.pos, info: {} })))];
  for (const p of placed) {
    const li = p.layer === 'task' ? L.task : p.layer === 'island' ? L.island : p.layer === 'moving' ? L.moving : L.markers;
    const info: Record<string, string | number> = { kind: p.kind, index: p.index, ...p.info };
    if (p.model !== undefined && p.mtx) {
      const md = romMd(p.model);
      const key = `md${p.model}${p.hideParts ? `-h${p.hideParts.join('.')}` : ''}`;
      const matrix = mul4(ZUP_TO_YUP, mul4(p.mtx, scale(1 / md.scaleDiv)));
      addInst(li, { name: `${p.kind} ${p.index}: ${p.name} (UVMD 0x${p.model.toString(16)})`, mesh: cached(key, () => modelMesh(geo, ctx, p.model!, { hideParts: p.hideParts })), matrix, animated: p.animated, info: { ...info, uvmd: p.model } });
      if (o.collision !== false && p.layer !== 'marker') volumeInstances(`${p.kind} ${p.index}`, p.model, mul4(ZUP_TO_YUP, p.mtx), 'dynamic');
      if (['RNGS', 'BNUS', 'FALC', 'TARG', 'HPAD', 'HOPD', 'BTGT', 'CNTG', 'BALS'].includes(p.kind)) markers.push({ label: p.name, position: toViewer(p.pos), layer: L.markers, info });
    } else if (p.kind !== 'PHTS') markers.push({ label: p.name, position: toViewer(p.pos), layer: L.markers, info });
  }
  if (task) {
    const photoPos: Record<number, V3> = { 1: [2870, -2230, 57.51], 2: [1150, -2150, 8.8], 3: [1725, -659, 28], 4: [750, 100, 4.5], 5: [-288, -99, 5.75], 6: [-368, 648, 106] };
    task.PHTS.forEach((ph, i) => markers.push({ label: `photo target ${i}: ${['', 'space shuttle', 'ferry', 'Nessie', 'whale', 'fountain', 'oil plant'][ph.subject]}`, position: toViewer(photoPos[ph.subject] ?? [0, 0, 0]), layer: L.markers, info: { ...ph, headingDeg: ph.headingDeg } }));
    task.LSTP.forEach((s, i) => { const mi = meshes.length; meshes.push(ribbonMesh(`landing strip ${i}`, [[s.p0, s.p1]], [255, 255, 255, 200], 4)); addInst(L.markers, { name: `landing strip ${i}`, mesh: mi, matrix: new Float32Array(ZUP_TO_YUP), info: { alignment: s.alignment } }); });
    // ring course (child links) as ribbons
    const g = ringGraph(task);
    if (g.edges.length) {
      const segs = g.edges.filter((e) => !e.timed).map((e) => [task.RNGS[e.from].pos, task.RNGS[e.to].pos] as [V3, V3]);
      const tsegs = g.edges.filter((e) => e.timed).map((e) => [task.RNGS[e.from].pos, task.RNGS[e.to].pos] as [V3, V3]);
      if (segs.length) { const mi = meshes.length; meshes.push(ribbonMesh('ring course', segs, [255, 220, 0, 220], 1.2)); addInst(L.course, { name: 'ring course (child rings)', mesh: mi, matrix: new Float32Array(ZUP_TO_YUP), info: { edges: segs.length } }); }
      if (tsegs.length) { const mi = meshes.length; meshes.push(ribbonMesh('timed rings', tsegs, [255, 60, 40, 220], 1.2)); addInst(L.course, { name: 'ring course (timed rings)', mesh: mi, matrix: new Float32Array(ZUP_TO_YUP), info: { edges: tsegs.length } }); }
    }
    const t0 = task.TPAD[0];
    if (t0) { const fwd = transformPoint(sc.pose, [0, 25, 0]); const mi = meshes.length; meshes.push(ribbonMesh('start heading', [[t0.pos, fwd]], [60, 255, 60, 230], 1.5)); addInst(L.markers, { name: 'start heading (25 units)', mesh: mi, matrix: new Float32Array(ZUP_TO_YUP), info: {} }); }
  }
  // moving object paths
  const pathSegs: [V3, V3][] = [];
  const sample = (user: number, n: number) => { const p = parseSpth(data, user); let prev: V3 | null = null; for (let k = 0; k <= n; k++) { const m = spathPose(p, (k / n) * 100); const q: V3 = [m[12], m[13], m[14]]; if (prev) pathSegs.push([prev, q]); prev = q; } };
  if (mapIndex === 3) sample(0x04, 60);
  if (mapIndex === 2) { sample(0x6d, 200); sample(0x6e, 200); }
  if (pathSegs.length) { const mi = meshes.length; meshes.push(ribbonMesh('SPTH paths', pathSegs, [120, 255, 255, 200], 2)); addInst(L.paths, { name: 'SPTH paths (ski lift / planes)', mesh: mi, matrix: new Float32Array(ZUP_TO_YUP), info: {} }); }

  // ---- fog, camera, level
  let fog: Level['fog'];
  if (E.fogEnabled && E.fogMax) {
    const min = Math.min((E.fogMin / E.fogMax) * 1000, 996); // uvGfxSetFogFactor clamp 0.996, gSPFogPosition(min, 1000)
    fog = { color: [E.fog[0], E.fog[1], E.fog[2]], multiplier: 128000 / (1000 - min), offset: ((500 - min) * 256) / (1000 - min), near: 40, far: 2000 };
  }
  const name = task ? `${task.jptx} ${VEHICLES[veh]} test ${task.comm.test + 1} (${ISLANDS[mapIndex]}, env ${env})` : `${ISLANDS[mapIndex]} (env ${env})`;
  return {
    info: { index: task?.index ?? mapIndex, name, kind: task ? (veh >= 3 && veh <= 5 ? 'bonus' : veh === 6 ? 'other' : 'stunt') : 'other', group: ISLANDS[mapIndex] },
    id: task ? `pw-task-${task.index}` : `pw-island-${mapIndex}`,
    textures: ctx.textures, meshes, instances, layers, markers, skies, fog,
    clearColor: E.clearEnabled ? [E.screen[0], E.screen[1], E.screen[2]] : undefined,
    camera: { eye: toViewer(sc.eye), target: toViewer(sc.target), fovY: sc.fovY },
    unplaced: [],
    bounds: { min: [bmin[0], bmin[2], -bmax[1]], max: [bmax[0], bmax[2], -bmin[1]] },
  };
}

// Line segments as two crossed quads each (visible from above and from the side), game coordinates.
export function ribbonMesh(name: string, segs: [V3, V3][], rgba: number[], width: number): Mesh {
  const pos: number[] = []; const col: number[] = [];
  for (const [a, b] of segs) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const len = Math.hypot(d[0], d[1], d[2]) || 1;
    let side = [-d[1], d[0], 0]; const sl = Math.hypot(side[0], side[1]); side = sl > 1e-6 ? side.map((v) => (v / sl) * width) : [width, 0, 0];
    const up = [(d[1] * side[2] - d[2] * side[1]) / len, (d[2] * side[0] - d[0] * side[2]) / len, (d[0] * side[1] - d[1] * side[0]) / len];
    for (const o of [side, up]) {
      const q = [a.map((v, i) => v - o[i]), a.map((v, i) => v + o[i]), b.map((v, i) => v + o[i]), b.map((v, i) => v - o[i])];
      for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...q[k]); col.push(...rgba); }
    }
  }
  return { name, radius: 1e5, batches: [{ texture: -1, blend: 'opaque', depthTest: true, depthWrite: true, cullBack: false, positions: new Float32Array(pos), uvs: new Float32Array((pos.length / 3) * 2), colors: new Uint8Array(col) }], info: { segments: segs.length } };
}

export function buildTaskLevel(data: PwData, taskIndex: number, opts: Omit<SceneOpts, 'taskIndex'> = {}) { return buildScene(data, { ...opts, taskIndex }); }
export function buildIslandLevel(data: PwData, mapIndex: number, weather = 0, opts: SceneOpts = {}) { return buildScene(data, { ...opts, mapIndex, weather }); }
