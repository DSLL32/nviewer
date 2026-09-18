import type { Batch, Level, Marker, Mesh } from '../types';
import type { StuntMap, StuntSet } from './fs';

type Point = [number, number, number];
const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const hex = (n: number) => `0x${n.toString(16)}`;

function extent(data: Uint8Array, offset: number, count: number, stride: number, label: string): void {
  if (!Number.isInteger(offset) || !Number.isInteger(count) || count < 0 ||
      offset > data.length || count > Math.floor((data.length - offset) / stride)) {
    throw new Error(`Stunt Racer 64: invalid ${label} at ${hex(offset)} (${count} records)`);
  }
}

function point(dv: DataView, at: number): Point {
  const p: Point = [-dv.getFloat32(at) * 32, dv.getFloat32(at + 8) * 32, dv.getFloat32(at + 4) * 32];
  if (!p.every(Number.isFinite)) throw new Error(`Stunt Racer 64: non-finite path point at ${hex(at)}`);
  return p;
}

// Two narrow crossed strips per segment; unlike a flat ground decal, a vertical
// segment remains visible from the side. These are viewer diagnostics, not game art.
class Lines {
  private positions: number[] = [];
  private colors: number[] = [];
  private sources: number[] = [];
  private radius = 0;
  constructor(private readonly color: readonly [number, number, number], private readonly width = 5) {}

  add(a: Point, b: Point, source: number): void {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    let sx = -dz, sz = dx, sl = Math.hypot(sx, sz);
    if (sl < 1e-4) { sx = 1; sz = 0; sl = 1; }
    const offsets: Point[] = [
      [sx / sl * this.width, 0, sz / sl * this.width],
      [0, this.width, 0],
    ];
    for (const o of offsets) {
      const l: Point = [a[0] - o[0], a[1] - o[1], a[2] - o[2]];
      const r: Point = [a[0] + o[0], a[1] + o[1], a[2] + o[2]];
      const q: Point = [b[0] - o[0], b[1] - o[1], b[2] - o[2]];
      const s: Point = [b[0] + o[0], b[1] + o[1], b[2] + o[2]];
      for (const p of [l, r, q, r, s, q]) {
        this.positions.push(...p);
        this.colors.push(...this.color, 225);
        this.radius = Math.max(this.radius, Math.hypot(...p));
      }
      this.sources.push(source, source);
    }
  }

  mesh(name: string, source: string): Mesh | null {
    if (!this.sources.length) return null;
    const batch: Batch = {
      texture: -1, blend: 'blend', depthTest: true, depthWrite: false, cullBack: false,
      positions: new Float32Array(this.positions), uvs: new Float32Array(this.positions.length / 3 * 2),
      colors: new Uint8Array(this.colors), triSource: new Uint32Array(this.sources),
    };
    return { name, radius: this.radius, batches: [batch], info: { source, role: 'diagnostic line strips' } };
  }
}

function layer(level: Level, name: string, lines: Lines, source: string): number {
  const number = (level.layers ??= []).length;
  const instances: number[] = [];
  const mesh = lines.mesh(name, source);
  if (mesh) {
    const m = level.meshes.push(mesh) - 1;
    instances.push(level.instances.push({ name, mesh: m, matrix: identity() }) - 1);
  }
  // These are inferred/debug views, not authored visible scenery. Keep them
  // available without obscuring the course when it is first opened.
  level.layers.push({ name, kind: 'markers', group: 'diagnostics', instances, visibleByDefault: false });
  return number;
}

function addMarker(level: Level, label: string, position: Point, layerIndex: number, info: NonNullable<Marker['info']>): void {
  (level.markers ??= []).push({ label, position, layer: layerIndex, info });
}

function filePaths(map: StuntMap, level: Level, set: StuntSet, color: readonly [number, number, number]): void {
  const lines = new Lines(color);
  const starts: { label: string; position: Point; info: NonNullable<Marker['info']> }[] = [];
  for (let i = 0; i < map.count(set); i++) {
    const file = map.load(set, i);
    const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
    let count: number, base: number, stride: number, pointOffset: number;
    if (set === 'otherPath') {
      extent(file, 0, 1, 4, `${set} count`);
      count = dv.getUint32(0) + 1; base = 0; stride = 16; pointOffset = 4;
    } else if (set === 'auxiliary') {
      extent(file, 8, 1, 4, `${set} count`);
      count = dv.getUint32(8); base = 0x28; stride = 0x1c; pointOffset = 0;
    } else {
      extent(file, 8, 1, 4, `${set} count`);
      count = dv.getUint32(8); base = 0x18; stride = 12; pointOffset = 0;
    }
    extent(file, base, count, stride, `${set} points`);
    let previous: Point | undefined;
    for (let j = 0; j < count; j++) {
      const at = base + j * stride + pointOffset;
      const p = point(dv, at);
      if (j === 0) starts.push({ label: `${set} ${i}`, position: p,
        info: { file: i, point: j, offset: hex(at), channel: set, semantics: 'diagnostic, unverified' } });
      if (previous && set !== 'auxiliary') lines.add(previous, p, (i << 20) | at);
      previous = p;
    }
  }
  const layerIndex = layer(level, set === 'auxiliary' ? 'auxiliary points' : set, lines,
    `${set} file index in upper 12 bits; decoded-file offset in lower 20 bits`);
  for (const { label, position, info } of starts) addMarker(level, label, position, layerIndex, info);
}

export function appendPaths(map: StuntMap, level: Level): void {
  // The three path families and "other path" have structurally valid point lists;
  // their exact gameplay roles are not proven. Path3 is structurally present but empty.
  filePaths(map, level, 'path0', [240, 65, 65]);
  filePaths(map, level, 'path1', [60, 220, 70]);
  filePaths(map, level, 'path2', [60, 95, 245]);
  if (map.count('path3')) filePaths(map, level, 'path3', [230, 70, 210]);
  filePaths(map, level, 'otherPath', [245, 220, 75]);
  filePaths(map, level, 'auxiliary', [205, 65, 230]);

  const data = map.primary, dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tiltCount = dv.getUint32(0x10c), tiltAt = dv.getUint32(0x108);
  extent(data, tiltAt, tiltCount, 0x2c, 'tilt lines');
  const tilt = new Lines([140, 145, 255]);
  const tiltPoints: { p: Point; i: number; at: number }[] = [];
  for (let i = 0; i < tiltCount; i++) {
    const at = tiltAt + i * 0x2c;
    const a = point(dv, at + 8), b = point(dv, at + 0x14);
    tilt.add(a, b, at);
    tiltPoints.push({ p: a, i, at });
  }
  const tiltLayer = layer(level, 'tilt lines', tilt, 'offset in decoded primary map');
  for (const { p, i, at } of tiltPoints) addMarker(level, `tilt ${i}`, p, tiltLayer, { index: i, record: hex(at), semantics: 'probable tilt line' });

  const coinCount = dv.getUint16(0x3b0), coinAt = dv.getUint32(0x3c4);
  extent(data, coinAt, coinCount, 0x38, 'coin groups');
  const coinLayer = layer(level, 'coin positions', new Lines([250, 190, 40]), 'offset in decoded primary map');
  for (let i = 0; i < coinCount; i++) {
    const at = coinAt + i * 0x38;
    const count = dv.getUint8(at), pointsAt = dv.getUint32(at + 0x24);
    extent(data, pointsAt, count, 0x10, 'coin positions');
    for (let j = 0; j < count; j++) {
      const record = pointsAt + j * 0x10;
      addMarker(level, `coin ${i}.${j}`, point(dv, record), coinLayer,
        { group: i, point: j, record: hex(record), semantics: 'probable coin position' });
    }
  }

  const boosterCount = dv.getUint16(0x3b8), boosterAt = dv.getUint32(0x3d0);
  extent(data, boosterAt, boosterCount, 0x38, 'booster groups');
  const boosters = new Lines([55, 230, 235]);
  const boosterPoints: { p: Point; group: number; index: number; at: number }[] = [];
  for (let i = 0; i < boosterCount; i++) {
    const at = boosterAt + i * 0x38, count = dv.getUint8(at + 3);
    const aAt = dv.getUint32(at + 0x30), bAt = dv.getUint32(at + 0x34);
    extent(data, aAt, count, 12, 'booster starts');
    extent(data, bAt, count, 12, 'booster ends');
    for (let j = 0; j < count; j++) {
      const record = aAt + j * 12;
      const a = point(dv, record), b = point(dv, bAt + j * 12);
      boosters.add(a, b, record);
      boosterPoints.push({ p: a, group: i, index: j, at: record });
    }
  }
  const boosterLayer = layer(level, 'booster lines', boosters, 'offset in decoded primary map');
  for (const { p, group, index, at } of boosterPoints) addMarker(level, `booster ${group}.${index}`, p, boosterLayer,
    { group, line: index, record: hex(at), semantics: 'probable booster line' });
  // +0x3B4/+0x3C8 has an unresolved record stride, so it is intentionally not decoded.
}
