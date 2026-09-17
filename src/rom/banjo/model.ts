// Banjo-Kazooie model file ("0x0000000B" assets) parser.

export const be = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

export interface ModelHeader {
  magic: number;
  geo: number; texList: number; geoType: number; gfx: number; vtx: number; unk14: number; anim: number;
  coll: number; camArea: number; mesh: number; animVtx: number; animTex: number; unk30: number; vtxCount: number;
  unk34: number;
}

export interface TexInfo { index: number; offset: number; type: number; w: number; h: number; raw: Uint8Array }
export interface TexList { at: number; size: number; count: number; dataStart: number; infos: TexInfo[] }

export interface VtxList {
  at: number; min: number[]; max: number[]; center: number[]; localNorm: number; count: number; globalNorm: number;
  start: number; // offset of Vtx[0]
}

export interface CollTri { a: number; b: number; c: number; unk6: number; flags: number }
export interface CollList {
  at: number; min: number[]; max: number[]; yStride: number; zStride: number; geoCount: number; scale: number;
  triCount: number; cells: { start: number; count: number }[]; tris: CollTri[]; end: number;
}

export interface GeoNode {
  at: number; cmd: number; next: number; fields: Record<string, number | number[]>; children: GeoNode[];
}

export interface Model {
  buf: Uint8Array; hdr: ModelHeader; tex: TexList; vtx: VtxList; gfxAt: number; gfxCount: number;
  geo: GeoNode[]; coll: CollList | null; errors: string[]; animTex: { frameSize: number; frameCount: number; rate: number }[] | null;
  camAreas: { min: number[]; max: number[]; flag: number }[] | null;
}

export function parseHeader(b: Uint8Array): ModelHeader {
  const d = be(b);
  return {
    magic: d.getUint32(0), geo: d.getInt32(4), texList: d.getInt16(8), geoType: d.getInt16(0xa), gfx: d.getInt32(0xc),
    vtx: d.getInt32(0x10), unk14: d.getInt32(0x14), anim: d.getInt32(0x18), coll: d.getInt32(0x1c),
    camArea: d.getInt32(0x20), mesh: d.getInt32(0x24), animVtx: d.getInt32(0x28), animTex: d.getInt32(0x2c),
    unk30: d.getUint16(0x30), vtxCount: d.getUint16(0x32), unk34: d.getFloat32(0x34),
  };
}

// Size in bytes of the texel data (level 0) and palette of a texture-list entry.
export function texBits(type: number) { return type & 1 ? 4 : type & 2 ? 8 : type & 4 ? 16 : type & 8 ? 32 : 0; }
export function texPalBytes(type: number) { return type & 1 ? 32 : type & 2 ? 512 : 0; }

export const GEO_NAMES: Record<number, string> = {
  0: 'BILLBOARD', 1: 'SORT', 2: 'BONE', 3: 'LOADDL', 4: 'NOP4', 5: 'SKINNING', 6: 'CALL', 7: 'LOADDL2', 8: 'LOD',
  9: 'NOP9', 10: 'REFPOINT', 11: 'NOPB', 12: 'SELECTOR', 13: 'DRAWDIST', 14: 'SPHERECULL', 15: 'CAMERA', 16: 'TEXWRAP',
};

export function parseModel(b: Uint8Array): Model {
  const d = be(b);
  const errors: string[] = [];
  const hdr = parseHeader(b);
  const n = b.length;
  const inb = (o: number, len: number, what: string) => {
    if (o < 0 || o + len > n) { errors.push(`${what} out of bounds @0x${o.toString(16)}+${len}`); return false; }
    return true;
  };
  if (hdr.magic !== 0xb) errors.push('bad magic');

  // Texture list: s32 size (whole section incl. this header), s16 count, u16, count x 16-byte infos, data.
  const ta = hdr.texList;
  let tex: TexList = { at: ta, size: 0, count: 0, dataStart: 0, infos: [] };
  if (inb(ta, 8, 'texlist')) {
    tex.size = d.getInt32(ta);
    tex.count = d.getInt16(ta + 4);
    tex.dataStart = ta + 8 + tex.count * 16;
    for (let i = 0; i < tex.count && inb(ta + 8 + i * 16, 16, 'texinfo'); i++) {
      const o = ta + 8 + i * 16;
      tex.infos.push({ index: i, offset: d.getInt32(o), type: d.getInt16(o + 4), w: b[o + 8], h: b[o + 9], raw: b.subarray(o, o + 16) });
    }
  }

  const va = hdr.vtx;
  let vtx: VtxList = { at: va, min: [], max: [], center: [], localNorm: 0, count: 0, globalNorm: 0, start: va + 0x18 };
  if (inb(va, 0x18, 'vtxlist')) {
    const s = (k: number) => d.getInt16(va + k);
    vtx = {
      at: va, min: [s(0), s(2), s(4)], max: [s(6), s(8), s(10)], center: [s(12), s(14), s(16)], localNorm: s(18),
      count: s(20), globalNorm: s(22), start: va + 0x18,
    };
    inb(vtx.start, vtx.count * 16, 'vertices');
  }

  let gfxCount = 0;
  if (inb(hdr.gfx, 8, 'gfx')) {
    gfxCount = d.getUint32(hdr.gfx);
    inb(hdr.gfx + 8, gfxCount * 8, 'gfx commands');
  }

  // Geometry layout command tree.
  const seen = new Set<number>();
  const walk = (start: number, depth: number): GeoNode[] => {
    const out: GeoNode[] = [];
    let at = start;
    for (let guard = 0; guard < 100000; guard++) {
      if (depth > 64) { errors.push('geo too deep'); break; }
      if (!inb(at, 8, 'geo cmd')) break;
      if (seen.has(at)) { errors.push(`geo loop @0x${at.toString(16)}`); break; }
      seen.add(at);
      const cmd = d.getUint32(at), next = d.getInt32(at + 4);
      const node: GeoNode = { at, cmd, next, fields: {}, children: [] };
      const f = node.fields;
      const child = (off: number) => { if (off) node.children.push(...walk(at + off, depth + 1)); };
      switch (cmd) {
        case 0: // billboard
          f.branch = d.getInt16(at + 8); f.noPitch = d.getInt16(at + 10);
          f.pos = [d.getFloat32(at + 12), d.getFloat32(at + 16), d.getFloat32(at + 20)];
          child(f.branch as number);
          break;
        case 1:
          f.p1 = [d.getFloat32(at + 8), d.getFloat32(at + 12), d.getFloat32(at + 16)];
          f.p2 = [d.getFloat32(at + 20), d.getFloat32(at + 24), d.getFloat32(at + 28)];
          f.flags = d.getInt16(at + 32); f.branch1 = d.getInt16(at + 34); f.branch2 = d.getInt32(at + 36);
          child(f.branch1 as number); child(f.branch2 as number);
          break;
        case 2:
          f.branch = b[at + 8]; f.mtx = d.getInt8(at + 9); f.w10 = d.getUint16(at + 10);
          child(f.branch as number);
          break;
        case 3:
          f.gfx = d.getInt16(at + 8); f.w10 = d.getUint16(at + 10);
          break;
        case 5: {
          const list: number[] = [];
          for (let k = 0; inb(at + 8 + k * 2, 2, 'skin'); k++) {
            const v = d.getInt16(at + 8 + k * 2);
            if (k > 0 && v === 0) break;
            list.push(v);
            if (k > 64) break;
          }
          f.gfx = list;
          break;
        }
        case 6: f.branch = d.getInt32(at + 8); child(f.branch as number); break;
        case 7: f.w8 = d.getInt16(at + 8); f.gfx = d.getInt16(at + 10); break;
        case 8:
          f.max = d.getFloat32(at + 8); f.min = d.getFloat32(at + 12);
          f.pos = [d.getFloat32(at + 16), d.getFloat32(at + 20), d.getFloat32(at + 24)];
          f.branch = d.getInt32(at + 28); child(f.branch as number);
          break;
        case 10:
          f.index = d.getInt16(at + 8); f.mtx = d.getInt16(at + 10);
          f.point = [d.getFloat32(at + 12), d.getFloat32(at + 16), d.getFloat32(at + 20)];
          break;
        case 12: {
          const count = d.getInt16(at + 8);
          f.count = count; f.index = d.getInt16(at + 10);
          const offs: number[] = [];
          for (let k = 0; k < count && inb(at + 12 + k * 4, 4, 'selector'); k++) offs.push(d.getInt32(at + 12 + k * 4));
          f.offsets = offs;
          for (const o of offs) child(o);
          break;
        }
        case 13:
          f.min = [d.getInt16(at + 8), d.getInt16(at + 10), d.getInt16(at + 12)];
          f.max = [d.getInt16(at + 14), d.getInt16(at + 16), d.getInt16(at + 18)];
          f.branch = d.getInt16(at + 20); f.w22 = d.getUint16(at + 22);
          child(f.branch as number);
          break;
        case 14:
          f.pos = [d.getInt16(at + 8), d.getInt16(at + 10), d.getInt16(at + 12)];
          f.dist = d.getInt16(at + 14); f.branch = d.getInt16(at + 16); f.mtx = d.getInt16(at + 18);
          child(f.branch as number);
          break;
        case 15: {
          f.branch = d.getInt16(at + 8); f.count = b[at + 10]; f.flags = b[at + 11];
          const ids: number[] = [];
          for (let k = 0; k < (f.count as number); k++) ids.push(b[at + 12 + k]);
          f.ids = ids;
          child(f.branch as number);
          break;
        }
        case 16: f.mode = d.getInt32(at + 8); break;
        case 4: case 9: case 11: break;
        default: errors.push(`geo cmd ${cmd} unknown @0x${at.toString(16)}`);
      }
      out.push(node);
      if (next === 0) break;
      if (next < 0) errors.push(`geo negative next @0x${at.toString(16)}`);
      at += next;
    }
    return out;
  };
  const geo = hdr.geo ? walk(hdr.geo, 0) : [];

  let coll: CollList | null = null;
  if (hdr.coll && inb(hdr.coll, 0x18, 'coll')) {
    const c = hdr.coll;
    const s = (k: number) => d.getInt16(c + k);
    const cl: CollList = {
      at: c, min: [s(0), s(2), s(4)], max: [s(6), s(8), s(10)], yStride: s(12), zStride: s(14), geoCount: s(16),
      scale: s(18), triCount: d.getUint16(20 + c), cells: [], tris: [], end: 0,
    };
    let o = c + 0x18;
    for (let i = 0; i < cl.geoCount && inb(o, 4, 'coll cell'); i++, o += 4) cl.cells.push({ start: d.getInt16(o), count: d.getInt16(o + 2) });
    for (let i = 0; i < cl.triCount && inb(o, 12, 'coll tri'); i++, o += 12) {
      cl.tris.push({ a: d.getInt16(o), b: d.getInt16(o + 2), c: d.getInt16(o + 4), unk6: d.getUint16(o + 6), flags: d.getUint32(o + 8) });
    }
    cl.end = o;
    coll = cl;
  }

  let animTex = null;
  if (hdr.animTex && inb(hdr.animTex, 32, 'animtex')) {
    animTex = [0, 1, 2, 3].map((k) => ({
      frameSize: d.getInt16(hdr.animTex + k * 8), frameCount: d.getInt16(hdr.animTex + k * 8 + 2), rate: d.getFloat32(hdr.animTex + k * 8 + 4),
    }));
  }
  let camAreas = null;
  if (hdr.camArea && inb(hdr.camArea, 2, 'camarea')) {
    const cnt = b[hdr.camArea];
    camAreas = [];
    for (let k = 0; k < cnt && inb(hdr.camArea + 2 + k * 14, 14, 'camarea entry'); k++) {
      const o = hdr.camArea + 2 + k * 14;
      camAreas.push({ min: [d.getInt16(o), d.getInt16(o + 2), d.getInt16(o + 4)], max: [d.getInt16(o + 6), d.getInt16(o + 8), d.getInt16(o + 10)], flag: b[o + 12] });
    }
  }

  return { buf: b, hdr, tex, vtx, gfxAt: hdr.gfx, gfxCount, geo, coll, errors, animTex, camAreas };
}

// All display-list entry indices reachable from the geometry tree, with the path of node kinds above each.
export interface DlRef { gfx: number; path: string; node: GeoNode }
export function collectDlRefs(m: Model): DlRef[] {
  const out: DlRef[] = [];
  const rec = (nodes: GeoNode[], path: string) => {
    for (const nd of nodes) {
      const p = path ? `${path}/${GEO_NAMES[nd.cmd]}` : GEO_NAMES[nd.cmd];
      if (nd.cmd === 3 || nd.cmd === 7) out.push({ gfx: nd.fields.gfx as number, path: p, node: nd });
      if (nd.cmd === 5) for (const g of nd.fields.gfx as number[]) out.push({ gfx: g, path: p, node: nd });
      rec(nd.children, p);
    }
  };
  rec(m.geo, '');
  return out;
}

export function flattenGeo(nodes: GeoNode[], out: GeoNode[] = []): GeoNode[] {
  for (const n of nodes) { out.push(n); flattenGeo(n.children, out); }
  return out;
}
