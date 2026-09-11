// The selection panel's content: what was picked, as labelled rows and as plain text for bug reports.
import type { DebugInfo, Level } from '../rom';
import type { Vec3 } from '../render/math';
import { det3, instanceWorldBounds, transformPoint } from '../render/picking';

export type Selection =
  | { kind: 'object'; instance: number; point: Vec3 }
  | { kind: 'face'; instance: number; batch: number; tri: number; point: Vec3 }
  | { kind: 'marker'; marker: number };

export interface InfoSection {
  title: string;
  rows: [label: string, value: string][];
}

export interface SelectionReport {
  title: string;
  sections: InfoSection[];
  /** Texture of the selected face, for the thumbnail (null for objects and untextured faces). */
  texture: number | null;
  /** What the Copy button puts on the clipboard: a few lines that identify the selection, for bug reports. */
  copyText: string;
}

export interface GameIdentity {
  id: string;
  title: string;
}

const num = (n: number, digits = 3): string => {
  if (!Number.isFinite(n)) return String(n);
  const v = Number(n.toFixed(digits));
  return Object.is(v, -0) ? '0' : String(v);
};

const vec = (v: ArrayLike<number>, digits = 3) => `(${Array.from(v, (x) => num(x, digits)).join(', ')})`;

const hex = (v: number) => `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;

const yesNo = (b: boolean | undefined) => (b ? 'true' : 'false');

function infoSection(title: string, info: DebugInfo | undefined): InfoSection[] {
  if (!info) return [];
  const rows = Object.entries(info).map(([k, v]): [string, string] => [k, typeof v === 'number' ? String(v) : v]);
  return rows.length > 0 ? [{ title, rows }] : [];
}

function layerLabel(level: Level, index: number): string {
  const layer = level.layers?.[index];
  return layer ? `#${index} ${layer.name} (${layer.kind})` : `#${index}`;
}

function levelSection(level: Level, game: GameIdentity | null): InfoSection {
  const info = level.info;
  return {
    title: 'Level',
    rows: [
      ['Game', game ? `${game.title} (${game.id})` : 'unknown'],
      ['Level', `#${info.index} ${info.name}`],
      ['Level id', level.id],
      ['Kind', info.group ? `${info.kind} / ${info.group}` : info.kind],
    ],
  };
}

export function describeSelection(level: Level, game: GameIdentity | null, sel: Selection): SelectionReport | null {
  if (sel.kind === 'marker') {
    const marker = level.markers?.[sel.marker];
    if (!marker) return null;
    const rows: [string, string][] = [
      ['Marker', `#${sel.marker} ${marker.label}`],
      ['Position', vec(marker.position, 2)],
    ];
    if (marker.layer !== undefined) rows.push(['Layer', layerLabel(level, marker.layer)]);
    return {
      title: `Marker: ${marker.label}`,
      sections: [levelSection(level, game), { title: 'Marker', rows }, ...infoSection('Marker.info', marker.info)],
      texture: null,
      copyText: copyLines([copyHeader(level, game), `Marker: ${marker.label}`, infoLine('Info', marker.info)]),
    };
  }

  const inst = level.instances[sel.instance];
  const mesh = inst && inst.mesh >= 0 ? level.meshes[inst.mesh] : undefined;
  if (!inst || !mesh) return null;
  const m = inst.matrix;
  const flags = [inst.animated ? 'animated' : '', inst.noFog ? 'noFog' : '', det3(m) < 0 ? 'mirrored' : ''].filter(Boolean);
  const identity: [string, string][] = [
    ['Instance', `#${sel.instance} ${inst.name}`],
    ['Mesh', `#${inst.mesh} ${mesh.name}`],
  ];
  if (flags.length) identity.push(['Flags', flags.join(', ')]);
  const layers = (level.layers ?? []).flatMap((l, i) => (l.instances.includes(sel.instance) ? [layerLabel(level, i)] : []));
  if (layers.length) identity.push(['Layer', layers.join(', ')]);

  if (sel.kind === 'object') {
    const tris = mesh.batches.reduce((s, b) => s + Math.floor(b.positions.length / 9), 0);
    const textures = [...new Set(mesh.batches.map((b) => b.texture).filter((t) => t >= 0))].sort((a, b) => a - b);
    const untextured = mesh.batches.filter((b) => b.texture < 0).length;
    const wb = instanceWorldBounds(level, sel.instance);
    const rows: [string, string][] = [
      ...identity,
      ['Batches', String(mesh.batches.length)],
      ['Triangles', String(tris)],
      ['Translation', vec([m[12], m[13], m[14]])],
      ['Matrix row 0', vec([m[0], m[4], m[8]], 4)],
      ['Matrix row 1', vec([m[1], m[5], m[9]], 4)],
      ['Matrix row 2', vec([m[2], m[6], m[10]], 4)],
      ['World min', wb ? vec(wb.min, 2) : '-'],
      ['World max', wb ? vec(wb.max, 2) : '-'],
      ['Hit point', vec(sel.point, 2)],
      ['Textures', textures.length ? textures.join(', ') : 'none'],
    ];
    if (untextured) rows.push(['Untextured batches', String(untextured)]);
    const layerNames = (level.layers ?? []).filter((l) => l.instances.includes(sel.instance)).map((l) => l.name);
    return {
      title: `Object: ${inst.name}`,
      sections: [levelSection(level, game), { title: 'Object', rows }, ...infoSection('Instance.info', inst.info), ...infoSection('Mesh.info', mesh.info)],
      texture: null,
      copyText: copyLines([
        copyHeader(level, game),
        [`Object: instance #${sel.instance} ${inst.name}`, `mesh #${inst.mesh}`, ...(layerNames.length ? [`layer ${layerNames.join(', ')}`] : [])].join(' · '),
        infoLine('Instance', inst.info),
        infoLine('Mesh', mesh.info, true),
      ]),
    };
  }

  const batch = mesh.batches[sel.batch];
  if (!batch) return null;
  const triCount = Math.floor(batch.positions.length / 9);
  const faceRows: [string, string][] = [
    ...identity,
    ['Batch', `#${sel.batch} of ${mesh.batches.length}`],
    ['Triangle', `#${sel.tri} of ${triCount}`],
  ];
  if (batch.triSource && sel.tri < batch.triSource.length) faceRows.push(['triSource', hex(batch.triSource[sel.tri])]);
  faceRows.push(['Hit point', vec(sel.point, 2)]);

  const batchRows: [string, string][] = [
    ['blend', batch.blend],
    ['depthTest', yesNo(batch.depthTest)],
    ['depthWrite', yesNo(batch.depthWrite)],
    ['cullBack', yesNo(batch.cullBack)],
    ['decal', yesNo(batch.decal)],
  ];

  const tex = batch.texture >= 0 ? level.textures[batch.texture] : undefined;
  const texRows: [string, string][] = tex
    ? [
        ['Index', String(batch.texture)],
        ['Size', `${tex.width}×${tex.height}`],
        ['Format', tex.format],
        ['Wrap', `${tex.wrapS} / ${tex.wrapT}`],
      ]
    : [['Index', batch.texture >= 0 ? `${batch.texture} (missing)` : 'untextured (-1)']];
  if (tex?.source) texRows.push(['Source', tex.source]);

  const p = batch.positions;
  const vertexRows: [string, string][] = [];
  const world: Vec3[] = [];
  const local: Vec3[] = [];
  for (let k = 0; k < 3; k++) {
    const vi = sel.tri * 3 + k;
    const lp: Vec3 = [p[vi * 3], p[vi * 3 + 1], p[vi * 3 + 2]];
    const wp = transformPoint(m, lp[0], lp[1], lp[2]);
    local.push(lp);
    world.push(wp);
    vertexRows.push([`v${k} local`, vec(lp)]);
    vertexRows.push([`v${k} world`, vec(wp, 2)]);
    vertexRows.push([`v${k} uv`, batch.uvs.length >= (vi + 1) * 2 ? vec([batch.uvs[vi * 2], batch.uvs[vi * 2 + 1]], 4) : '-']);
    vertexRows.push([`v${k} rgba`, batch.colors.length >= (vi + 1) * 4 ? Array.from(batch.colors.subarray(vi * 4, vi * 4 + 4)).join(', ') : '-']);
  }
  vertexRows.push(['Normal (world)', vec(normal(world), 4)]);
  vertexRows.push(['Normal (local)', vec(normal(local), 4)]);

  return {
    title: `Face: ${inst.name} batch ${sel.batch} tri ${sel.tri}`,
    sections: [
      levelSection(level, game),
      { title: 'Face', rows: faceRows },
      { title: 'Batch', rows: batchRows },
      { title: 'Texture', rows: texRows },
      { title: 'Vertices', rows: vertexRows },
      ...infoSection('Instance.info', inst.info),
      ...infoSection('Mesh.info', mesh.info),
    ],
    texture: tex ? batch.texture : null,
    copyText: copyLines([
      copyHeader(level, game),
      [
        `Face: instance #${sel.instance} ${inst.name}`,
        `mesh #${inst.mesh}`,
        `batch ${sel.batch}`,
        `tri ${sel.tri}`,
        ...(batch.triSource && sel.tri < batch.triSource.length ? [`triSource 0x${batch.triSource[sel.tri].toString(16)}`] : []),
      ].join(' · '),
      tex ? [`Texture #${batch.texture}`, `${tex.width}×${tex.height} ${tex.format}`, ...(tex.source ? [tex.source] : [])].join(' · ') : null,
      infoLine('Instance', inst.info),
      infoLine('Mesh', mesh.info, true),
    ]),
  };
}

/** Counter-clockwise front-face normal, normalised. */
function normal([a, b, c]: Vec3[]): Vec3 {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n: Vec3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const l = Math.hypot(n[0], n[1], n[2]);
  return l > 0 ? [n[0] / l, n[1] / l, n[2] / l] : [0, 0, 0];
}

// Copied text: identity only (no geometry, render state or bounds), one fact group per line.
function copyHeader(level: Level, game: GameIdentity | null): string {
  return `${game ? game.title : 'unknown game'} · ${level.id} · #${level.info.index} ${level.info.name}`;
}

/** DebugInfo as "key value · key value". Mesh.info's triSource note describes the loader, not the mesh: left out. */
function infoLine(prefix: string, info: DebugInfo | undefined, skipTriSourceNote = false): string | null {
  if (!info) return null;
  const pairs = Object.entries(info)
    .filter(([k, v]) => !(skipTriSourceNote && k === 'triSource' && typeof v === 'string'))
    .map(([k, v]) => `${k} ${v}`);
  return pairs.length ? `${prefix}: ${pairs.join(' · ')}` : null;
}

function copyLines(lines: (string | null)[]): string {
  return lines.filter((l): l is string => !!l).join('\n') + '\n';
}
