import type { Game, LevelInfo } from '../types';
import type { ZeldaFile } from './fs';
import { collectElfDefinitions, materializeZeldaElf, parseZeldaElf, type ZeldaElf } from './elf';
import { ZELDA_SOURCE_LEVELS, type ZeldaSourceLevelSpec } from './sourceManifest';
import type { SceneEntry, ZeldaTables } from './tables';
import { parseHeader } from './scene';
import { loadZeldaLevel, type ZeldaFileSystem, type ZeldaLevelDef, type ZeldaRuntime } from './zelda';

export interface ZeldaSourceFile { path: string; bytes: ArrayBuffer }
const align = (n: number, a = 0x10) => (n + a - 1) & ~(a - 1);
const read32 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset + o, 4).getUint32(0);
const write32 = (b: Uint8Array, o: number, n: number) => new DataView(b.buffer, b.byteOffset + o, 4).setUint32(0, n >>> 0);

class SourceFs implements ZeldaFileSystem {
  readonly files: ZeldaFile[];
  private readonly byStart = new Map<number, ZeldaFile>();
  private readonly rows: Map<number, { file: ZeldaFile; data: Uint8Array; name: string }>;
  constructor(files: { file: ZeldaFile; data: Uint8Array; name: string }[]) {
    this.files = files.map((x) => x.file);
    for (const x of files) this.byStart.set(x.file.vromStart, x.file);
    this.rows = new Map(files.map((x) => [x.file.index, x]));
  }
  present(f: ZeldaFile) { return this.rows.has(f.index); }
  fileAt(start: number, end: number) { const f = this.byStart.get(start); return f?.vromEnd === end ? f : null; }
  fileByVrom(start: number) { return this.byStart.get(start) ?? null; }
  size(f: ZeldaFile) { return f.vromEnd - f.vromStart; }
  data(f: ZeldaFile) {
    const row = this.rows.get(f.index);
    if (!row) throw new Error(`source file ${f.index} is unavailable`);
    return row.data;
  }
  name(index: number) { return this.rows.get(index)?.name; }
}

function parseInput(spec: ZeldaSourceLevelSpec, inputs: Map<string, Uint8Array>) {
  const get = (path: string) => {
    const bytes = inputs.get(path);
    if (!bytes) throw new Error(`${path}: required source object was not provided`);
    return parseZeldaElf(path, bytes);
  };
  return { scene: get(spec.scene), rooms: spec.rooms.map(get) };
}

function toolRomScene(elf: ZeldaElf): Uint8Array {
  const declaredStart = 0x0055b590, declaredEnd = 0x00566000;
  const bankStart = declaredStart & 0xff0000;
  const offset = declaredStart - bankStart, size = declaredEnd - declaredStart;
  const symbol = elf.symbols.find((s) => s.name === 'tool_data' && s.section === elf.dataSection);
  const toolData = symbol && symbol.value + symbol.size <= elf.data.length ? elf.data.subarray(symbol.value, symbol.value + symbol.size) : elf.data;
  if (offset !== 0xb590 || size !== 43632 || toolData.length !== 0x16000 || offset + size !== toolData.length) {
    throw new Error(`${elf.path}: sparse tool_data interval is not 0x0055B590..0x00566000`);
  }
  const out = toolData.slice(offset, offset + size);
  if (out[0] !== 0x04 || read32(out, 4) !== 0x0400b5d8 || out[8] !== 0x03 || read32(out, 12) !== 0x04013fd4) {
    throw new Error(`${elf.path}: sparse payload does not have the verified historical header`);
  }
  const rebase = (p: number) => {
    const q = p & 0xffffff;
    if (p >>> 24 !== 4 || q < offset || q >= offset + size) throw new Error(`${elf.path}: historical pointer 0x${p.toString(16)} is outside tool_data`);
    return 0x02000000 | (q - offset);
  };
  const collision = rebase(read32(out, 12));
  const collisionOffset = collision & 0xffffff;
  if (collisionOffset + 0x2c > out.length) throw new Error(`${elf.path}: historical collision header exceeds tool_data`);
  for (const field of [0x10, 0x18, 0x1c, 0x20, 0x28]) {
    const at = collisionOffset + field, p = read32(out, at);
    if (p) write32(out, at, rebase(p));
  }
  // The payload predates the final scene command format. Preserve it, but substitute a two-command modern header
  // so the shared loader can expose its verified collision body.
  out.fill(0, 0, 16);
  out.set([0x03, 0, 0, 0], 0); write32(out, 4, collision);
  out.set([0x14, 0, 0, 0, 0, 0, 0, 0], 8);
  return out;
}

function roomSymbolNumber(name: string): { room: number; end: boolean } | null {
  const m = /room_?(\d+)SegmentRom(Start|End)$/i.exec(name);
  return m ? { room: Number(m[1]), end: m[2].toLowerCase() === 'end' } : null;
}

interface PreparedLevel { info: LevelInfo; runtime: ZeldaRuntime; def: ZeldaLevelDef }

function prepareLevel(spec: ZeldaSourceLevelSpec, index: number, input: Map<string, Uint8Array>): PreparedLevel {
  const parsed = parseInput(spec, input);
  let sceneData: Uint8Array;
  let roomData: Uint8Array[] = [];
  if (spec.mode === 'tool-rom') {
    sceneData = toolRomScene(parsed.scene);
  } else {
    const parts = [{ elf: parsed.scene, segment: 2 }, ...parsed.rooms.map((elf) => ({ elf, segment: 3 }))];
    const defs = collectElfDefinitions(parts);
    const syntheticRooms = parsed.rooms.map((r) => spec.mode !== 'fragment' && !parseHeader(r.data, 0)?.some((c) => c.code === 0x0a));
    const roomSizes = parsed.rooms.map((r, k) => r.data.length + (syntheticRooms[k] ? 0x20 : 0));
    const starts: number[] = [];
    let roomVrom = 0x01000000 + index * 0x01000000;
    for (let k = 0; k < parsed.rooms.length; k++) { starts.push(roomVrom); roomVrom += align(roomSizes[k], 0x1000); }
    const absolute = new Map<string, number>();
    for (const s of parsed.scene.symbols) {
      if (s.section !== 0 || !s.name) continue;
      const rr = roomSymbolNumber(s.name);
      if (!rr || rr.room >= parsed.rooms.length) continue;
      absolute.set(s.name, starts[rr.room] + (rr.end ? roomSizes[rr.room] : 0));
    }
    sceneData = materializeZeldaElf(parsed.scene, 2, defs, absolute);
    roomData = parsed.rooms.map((r) => materializeZeldaElf(r, 3, defs, absolute));

    parsed.rooms.forEach((r, k) => {
      if (!syntheticRooms[k] || spec.mode === 'fragment') return;
      const shape = r.symbols.find((s) => s.section === r.dataSection && /shape_status$/i.test(s.name));
      if (!shape) throw new Error(`${r.path}: room has neither a mesh command nor a shape_status symbol`);
      const shifted = new Uint8Array(roomData[k].length + 0x20);
      shifted.set(roomData[k], 0x20);
      for (const rel of r.relocations) {
        const at = rel.offset + 0x20, p = read32(shifted, at);
        if (p >>> 24 === 3) write32(shifted, at, p + 0x20);
      }
      shifted.set([0x0a, 0, 0, 0], 0); write32(shifted, 4, 0x03000000 | (shape.value + 0x20));
      shifted.set([0x14, 0, 0, 0, 0, 0, 0, 0], 8);
      roomData[k] = shifted;
    });

    if (spec.mode === 'fragment') {
      const list = 0x100;
      if (sceneData.length < 0x200 || sceneData.subarray(0, 0x200).some((b) => b !== 0)) throw new Error(`${parsed.scene.path}: expected the tool scene's zero-filled header slot`);
      sceneData.fill(0, 0, Math.min(0x200, sceneData.length));
      sceneData.set([0x04, roomData.length, 0, 0], 0); write32(sceneData, 4, 0x02000000 | list);
      sceneData.set([0x11, 0, 0, 0, 0, 0, 0, 0], 8);
      sceneData.set([0x14, 0, 0, 0, 0, 0, 0, 0], 16);
      roomData.forEach((room, k) => { write32(sceneData, list + k * 8, starts[k]); write32(sceneData, list + k * 8 + 4, starts[k] + room.length); });
      parsed.rooms.forEach((r, k) => {
        const shape = r.symbols.find((s) => s.section === r.dataSection && /shape_status$/i.test(s.name));
        if (!shape) throw new Error(`${r.path}: tool room has no shape_status symbol`);
        if (roomData[k].length < 0x20 || roomData[k].subarray(0, 0x20).some((b) => b !== 0)) throw new Error(`${r.path}: expected the tool room's zero-filled header slot`);
        roomData[k].set([0x0a, 0, 0, 0], 0); write32(roomData[k], 4, 0x03000000 | shape.value);
        roomData[k].set([0x14, 0, 0, 0, 0, 0, 0, 0], 8);
      });
    }
  }

  const fileRows: { file: ZeldaFile; data: Uint8Array; name: string }[] = [];
  const sceneFile: ZeldaFile = { index: 0, vromStart: 0x00100000, vromEnd: 0x00100000 + sceneData.length, romStart: 0, romEnd: 0 };
  fileRows.push({ file: sceneFile, data: sceneData, name: spec.scene });
  let roomVrom = 0x01000000 + index * 0x01000000;
  roomData.forEach((data, k) => {
    const file: ZeldaFile = { index: k + 1, vromStart: roomVrom, vromEnd: roomVrom + data.length, romStart: 0, romEnd: 0 };
    fileRows.push({ file, data, name: spec.rooms[k] });
    roomVrom += align(data.length, 0x1000);
  });
  const fs = new SourceFs(fileRows);
  const entry: SceneEntry = { id: 0, file: sceneFile, drawConfig: 0, titleTextId: 0 };
  const emptyCode: ZeldaFile = { index: -1, vromStart: 0, vromEnd: 0, romStart: 0, romEnd: 0 };
  const t: ZeldaTables = { game: 'oot', debug: false, code: emptyCode, codeData: new Uint8Array(), codeVram: 0, sceneTableOffset: 0, scenes: [entry], objects: [], actors: [] };
  const runtime: ZeldaRuntime = {
    options: {}, fs, t, game: 'oot', dayNight: null, ootSky: null, mmSkyFiles: null, mmSkyTables: null,
    areaTextures: null, profiles: new Map(), source: true, idPrefix: `zelda-source-${spec.key}`,
  };
  const info: LevelInfo = { index, name: spec.name, kind: 'other', group: spec.group };
  return { info, runtime, def: { scene: 0, layer: 0, file: spec.key } };
}

export function openZeldaSource(files: ZeldaSourceFile[], sourceTree: string): Game {
  const input = new Map<string, Uint8Array>();
  for (const f of files) {
    if (input.has(f.path)) throw new Error(`${f.path}: duplicate source file`);
    input.set(f.path, new Uint8Array(f.bytes));
  }
  const missing = ZELDA_SOURCE_LEVELS.flatMap((l) => [l.scene, ...l.rooms]).filter((p) => !input.has(p));
  if (missing.length) throw new Error(`bbgames/${sourceTree}: missing supported source object ${missing[0]}${missing.length > 1 ? ` (and ${missing.length - 1} more)` : ''}`);
  const prepared = ZELDA_SOURCE_LEVELS.map((s, i) => prepareLevel(s, i, input));
  return {
    id: 'zelda-source', title: `Zelda source maps (${sourceTree})`, levels: prepared.map((p) => p.info),
    loadLevel: (i) => {
      const p = prepared[i];
      if (!p) throw new Error(`Zelda source maps has no level ${i}`);
      return loadZeldaLevel(p.runtime, p.def, p.info);
    },
  };
}
