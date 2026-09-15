// Tables in `code`, all found by structure (docs/OCARINA_OF_TIME.md and docs/MAJORAS_MASK.md): the scene table (its record size
// tells OoT from MM), object and actor overlay tables, the OoT day/night texture pointers, sky and area texture files.
import { type ZeldaFile, type ZeldaFs } from './fs';

export type ZeldaGame = 'oot' | 'mm';

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

export interface SceneEntry {
  id: number;
  file: ZeldaFile;
  drawConfig: number;
  titleTextId: number; // MM area name message, OoT 0
}

export interface ActorOverlay {
  id: number;
  file: ZeldaFile | null; // null: internal actor (in code) or unset
  vramStart: number;
  profile: number; // VRAM of the ActorProfile, 0 unset
  namePtr: number; // debug builds
}

export interface ZeldaTables {
  game: ZeldaGame;
  debug: boolean; // actor name pointers present (debug builds)
  code: ZeldaFile;
  codeData: Uint8Array;
  codeVram: number;
  sceneTableOffset: number;
  scenes: (SceneEntry | null)[];
  objects: (ZeldaFile | null)[];
  actors: ActorOverlay[];
}

// A scene/room header: 8-byte commands (code < 0x20) ending with 0x14, containing a room list (0x04) for scenes.
export function looksLikeHeader(b: Uint8Array, off: number, needCode = 0x04): boolean {
  let found = false;
  for (let i = 0; i < 64; i++) {
    const q = off + i * 8;
    if (q + 8 > b.length || b[q] > 0x1f) return false;
    if (b[q] === needCode) found = true;
    if (b[q] === 0x14) return found;
  }
  return false;
}

// bss start and size from the entry code at ROM 0x1000 (lui/addiu t0 = start; li or lui/ori t1 = size).
function bootBss(rom: Uint8Array): [number, number] {
  let t0 = 0, t1 = 0;
  for (let o = 0x1000; o < 0x1020; o += 4) {
    const w = u32(rom, o), op = w >>> 16, imm = w & 0xffff, simm = (imm << 16) >> 16;
    if (op === 0x3c08) t0 = imm << 16;
    else if (op === 0x2508) t0 = (t0 + simm) >>> 0;
    else if (op === 0x3c09) t1 = imm << 16;
    else if (op === 0x3529 || op === 0x3409) t1 = (t1 | imm) >>> 0;
    else if (op === 0x2409) t1 = simm >>> 0;
  }
  return [t0 >>> 0, t1 >>> 0];
}

export function findTables(fs: ZeldaFs): ZeldaTables {
  const isFile = (vs: number, ve: number) => fs.fileAt(vs, ve) !== null;
  const headerFile = (f: ZeldaFile) => {
    try {
      return looksLikeHeader(fs.data(f), 0);
    } catch {
      return false;
    }
  };

  // Scene table: the only run of >= 60 records whose RomFile is a scene file. OoT: 0x14 bytes with a title RomFile
  // or zeros; MM: 0x10 bytes with {0, 0} gaps.
  const findScenes = (data: Uint8Array): { game: ZeldaGame; offset: number; scenes: (SceneEntry | null)[] } | null => {
    for (let o = 0; o + 0x14 * 60 <= data.length; o += 4) {
      if (!isFile(u32(data, o), u32(data, o + 4))) continue;
      for (const stride of [0x14, 0x10]) {
        const entries: (SceneEntry | null)[] = [];
        let set = 0;
        for (let q = o; q + stride <= data.length; q += stride) {
          const vs = u32(data, q), ve = u32(data, q + 4);
          const f = fs.fileAt(vs, ve);
          if (!f) {
            if (stride === 0x10 && vs === 0 && ve === 0) {
              entries.push(null);
              continue;
            }
            break;
          }
          if (stride === 0x14) {
            const ts = u32(data, q + 8), te = u32(data, q + 12);
            if (!((ts === 0 && te === 0) || isFile(ts, te)) || data[q + 0x11] >= 0x40) break;
          }
          entries.push({ id: entries.length, file: f, drawConfig: data[q + (stride === 0x14 ? 0x11 : 0x0b)], titleTextId: stride === 0x10 ? (data[q + 8] << 8) | data[q + 9] : 0 });
          set++;
        }
        while (entries.length && entries[entries.length - 1] === null) entries.pop();
        if (set < 60) continue;
        const firsts = entries.filter((e): e is SceneEntry => e !== null).slice(0, 3);
        if (firsts.every((e) => headerFile(e.file))) return { game: stride === 0x14 ? 'oot' : 'mm', offset: o, scenes: entries };
      }
    }
    return null;
  };

  let code: ZeldaFile | null = null;
  let codeData: Uint8Array | null = null;
  let found: ReturnType<typeof findScenes> = null;
  for (const f of fs.files.slice(3, 128)) {
    if (!fs.present(f) || fs.size(f) < 0x80000) continue;
    const data = fs.data(f);
    found = findScenes(data);
    if (found) {
      code = f;
      codeData = data;
      break;
    }
  }
  if (!found || !code || !codeData) throw new Error('Zelda 64: scene table not found');

  const [bssStart, bssSize] = bootBss(fs.rom);
  const codeVram = ((bssStart + bssSize + fs.size(fs.files[2]) + 0x1f) & ~0x1f) >>> 0;

  // Object table: the longest run of 8-byte RomFile records (zeros allowed). Entry 0 is empty and entry 1
  // (gameplay_keep) a file, so the table starts one record before the run's first file.
  let objects: (ZeldaFile | null)[] = [];
  let bestFiles = 0;
  for (const align of [0, 4]) {
    for (let o = align; o + 16 <= codeData.length; ) {
      let n = 0, files = 0, first = -1;
      while (o + (n + 1) * 8 <= codeData.length) {
        const q = o + n * 8, vs = u32(codeData, q), ve = u32(codeData, q + 4);
        // Unused ids are {0, 0} or an empty range at some file's start.
        if (vs === ve && (vs === 0 || fs.fileByVrom(vs))) n++;
        else if (isFile(vs, ve)) {
          if (first < 0) first = q;
          n++;
          files++;
        } else break;
      }
      if (files > bestFiles && first - 8 >= o) {
        bestFiles = files;
        objects = [];
        for (let q = first - 8; q < o + n * 8; q += 8) objects.push(fs.fileAt(u32(codeData, q), u32(codeData, q + 4)));
        while (objects.length && objects[objects.length - 1] === null) objects.pop();
      }
      o += n > 0 ? n * 8 : 8;
    }
  }

  // Actor overlay table: 0x20-byte records {RomFile; vramStart; vramEnd; loadedRamAddr = 0; profile; name; u16
  // allocType; s8 numLoaded; pad}, starting with the internal Player (no file, a profile in code).
  let actors: ActorOverlay[] = [];
  const plausible = (q: number) => {
    const vs = u32(codeData!, q), ve = u32(codeData!, q + 4), vr0 = u32(codeData!, q + 8), vr1 = u32(codeData!, q + 12);
    const loaded = u32(codeData!, q + 16), prof = u32(codeData!, q + 20), name = u32(codeData!, q + 24);
    if (loaded !== 0 || (name !== 0 && name >>> 24 !== 0x80)) return false;
    if (vs === 0 && ve === 0) return vr0 === 0 && vr1 === 0 && (prof === 0 || prof >>> 24 === 0x80);
    return isFile(vs, ve) && vr0 >>> 24 === 0x80 && vr1 > vr0 && prof >= vr0 && prof < vr1;
  };
  for (let o = 0; o + 0x20 * 400 <= codeData.length; o += 4) {
    if (u32(codeData, o) !== 0 || u32(codeData, o + 20) >>> 24 !== 0x80 || !plausible(o)) continue;
    let n = 0;
    while (o + (n + 1) * 0x20 <= codeData.length && plausible(o + n * 0x20)) n++;
    if (n < 400) continue;
    actors = Array.from({ length: n }, (_, k) => {
      const q = o + k * 0x20;
      return { id: k, file: fs.fileAt(u32(codeData!, q), u32(codeData!, q + 4)), vramStart: u32(codeData!, q + 8), profile: u32(codeData!, q + 20), namePtr: u32(codeData!, q + 24) };
    });
    break;
  }

  return {
    game: found.game, debug: actors.some((a) => a.namePtr !== 0), code, codeData, codeVram, sceneTableOffset: found.offset,
    scenes: found.scenes, objects, actors,
  };
}

// The actor profile {s16 id; u8 category; u32 flags; s16 objectId; ...} of an actor, from its overlay (or code).
export function actorProfile(fs: ZeldaFs, t: ZeldaTables, id: number): { category: number; objectId: number } | null {
  const a = t.actors[id];
  if (!a || !a.profile) return null;
  try {
    const data = a.file ? fs.data(a.file) : t.codeData;
    const o = a.profile - (a.file ? a.vramStart : t.codeVram);
    if (o < 0 || o + 12 > data.length) return null;
    return { category: data[o + 2], objectId: (data[o + 8] << 8) | data[o + 9] };
  } catch {
    return null;
  }
}

// OoT: the 40 day/night texture pointers of z_scene_table.c after sDefaultDisplayList (6 x gsSPSegment(8..0xD) =
// DB060020..DB060034, PipeSync, prim, env, EndDL), skipping function pointers.
export function findDayNightTextures(code: Uint8Array): number[] | null {
  for (let i = 0; i + 120 <= code.length; i += 4) {
    if (u32(code, i) !== 0xdb060020) continue;
    let ok = true;
    for (let k = 1; k < 6 && ok; k++) ok = u32(code, i + 8 * k) === 0xdb060020 + 4 * k;
    if (!ok) continue;
    let o = i + 80;
    while (o + 4 <= code.length && u32(code, o) >>> 24 === 0x80) o += 4;
    const ptrs: number[] = [];
    for (let k = 0; k < 40 && o + 4 * (k + 1) <= code.length; k++) ptrs.push(u32(code, o + 4 * k));
    if (ptrs.length === 40 && ptrs.every((v) => v >>> 24 === 2)) return ptrs;
  }
  return null;
}

// OoT gNormalSkyFiles: 9 consecutive {RomFile texture; RomFile palette} with 0x100-byte palettes. Returns the file of
// the first texture (vr_fine0); the other sky files follow it in filesystem order as texture/palette pairs.
export function findOotSkyFiles(fs: ZeldaFs, code: Uint8Array): ZeldaFile | null {
  for (let o = 0; o + 16 * 9 <= code.length; o += 4) {
    let ok = true;
    for (let k = 0; k < 9 && ok; k++) {
      const q = o + k * 16;
      const tex = fs.fileAt(u32(code, q), u32(code, q + 4)), pal = fs.fileAt(u32(code, q + 8), u32(code, q + 12));
      ok = !!tex && !!pal && fs.size(pal) === 0x100 && fs.size(tex) >= 0xc000;
    }
    if (ok) return fs.fileAt(u32(code, o), u32(code, o + 4));
  }
  return null;
}

// MM sNormalSkyFiles {d2_fine_static, 0}, {d2_cloud_static, 0} (0xC000-byte files); the palette d2_fine_pal_static
// is the next file in the filesystem (true in both MM ROMs).
export function findMmSkyFiles(fs: ZeldaFs, code: Uint8Array): { fine: ZeldaFile; cloud: ZeldaFile; palette: ZeldaFile } | null {
  for (let o = 0; o + 32 <= code.length; o += 4) {
    if (u32(code, o + 8) || u32(code, o + 12) || u32(code, o + 24) || u32(code, o + 28)) continue;
    const fine = fs.fileAt(u32(code, o), u32(code, o + 4)), cloud = fs.fileAt(u32(code, o + 16), u32(code, o + 20));
    if (!fine || !cloud || fs.size(fine) !== 0xc000 || fs.size(cloud) !== 0xc000) continue;
    const palette = fs.files[cloud.index + 1];
    if (palette && fs.present(palette)) return { fine, cloud, palette };
  }
  return null;
}

// MM sSceneTextureFiles: {0, 0} and 8 RomFiles with consecutive file indices, followed by a pointer (not a RomFile).
export function findMmAreaTextures(fs: ZeldaFs, code: Uint8Array): (ZeldaFile | null)[] | null {
  for (let o = 0; o + 80 <= code.length; o += 4) {
    if (u32(code, o) || u32(code, o + 4)) continue;
    const files: ZeldaFile[] = [];
    for (let k = 1; k <= 8; k++) {
      const f = fs.fileAt(u32(code, o + k * 8), u32(code, o + k * 8 + 4));
      if (!f || (files.length && f.index !== files[files.length - 1].index + 1)) break;
      files.push(f);
    }
    if (files.length === 8 && u32(code, o + 72) >>> 24 === 0x80) return [null, ...files];
  }
  return null;
}
