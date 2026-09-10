// Rush 2049 level geometry: the per-level model container (file 101 + n) and the
// placement file (file 120 + n), turned into render-ready meshes and instances.
//
// Model container: u32 at offset 0 points to a trailer of {tag, offset, count|size}
// records. IMAG holds texel data, TXLD texture-setup display lists, OBHD the object
// headers (88 bytes each), OBJS vertices and F3DEX2 display lists. Display-list and
// vertex addresses are file offsets; texture image addresses are IMAG-relative.
//
// Placement file: same trailer layout. WHDR holds the level id, WOBJ the placed
// instances (104 bytes: name, 3x3 matrix, translation, ..., bounds).
import { runDisplayList } from './displaylist';
import type { RushRom } from './rom';
import type { Instance, Level, LevelInfo, Mesh, Texture } from './types';
import { cstr, emptyBounds, mirrorMatrixX, mirrorPlacementX, placementMatrix, pruneUnused, view } from './util';

export type * from './types';

const MODEL_FILE_BASE = 101;
const PLACEMENT_FILE_BASE = 120;

export const LEVELS: LevelInfo[] = [
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ name: `Track ${n}`, kind: 'race' as const })),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ name: `Battle ${n}`, kind: 'battle' as const })),
  ...[1, 2, 3, 4].map((n) => ({ name: `Stunt ${n}`, kind: 'stunt' as const })),
  { name: 'Obstacle Course', kind: 'obstacle' as const },
].map((l, index) => ({ ...l, index }));

interface Section { offset: number; count: number }

function readSections(buf: Uint8Array): Map<string, Section> {
  const dv = view(buf);
  const out = new Map<string, Section>();
  for (let o = dv.getUint32(0); o + 12 <= buf.length; o += 12) {
    const tag = String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
    out.set(tag, { offset: dv.getUint32(o + 4), count: dv.getUint32(o + 8) });
  }
  return out;
}

// Objects placed by name but stored outside the level file: per-track props
// (file 82 + track number) and shared pickups (coins, battle weapon icons).
const TRACK_PROPS_BASE = 82;
const SHARED_OBJECT_FILES = [68, 76];

class MeshLibrary {
  readonly textures: Texture[] = [];
  readonly meshes: Mesh[] = [];
  private textureKeys = new Map<string, number>();

  // Adds every object of a model container; returns the range of new mesh indices.
  add(model: Uint8Array, fileIndex: number): [number, number] {
    const sections = readSections(model);
    const imag = sections.get('IMAG')!.offset;
    const obhd = sections.get('OBHD')!;
    const dv = view(model);
    const ctx = {
      buf: model, ucode: 'f3dex2' as const, textures: this.textures, textureKeys: this.textureKeys,
      // Double-sided faces are modelled as reversed-winding twins, so the game culls back faces.
      cullBackByDefault: true,
      keyPrefix: `${fileIndex}:`,
      // Texture images are addressed relative to IMAG; every other address is a file offset.
      resolve: (addr: number) => addr,
      resolveImage: (addr: number) => imag + addr,
    };
    const first = this.meshes.length;
    for (let i = 0; i < obhd.count; i++) {
      const r = obhd.offset + i * 88;
      // Records hold LOD slots of {flags, max distance, display list, vertices} from +24;
      // slot 0 is the most detailed.
      this.meshes.push({
        name: cstr(model, r, 16),
        radius: dv.getFloat32(r + 16),
        batches: runDisplayList(ctx, dv.getUint32(r + 32)),
      });
    }
    return [first, this.meshes.length];
  }
}

export function loadLevel(rom: RushRom, index: number): Level {
  const info = LEVELS[index];
  const place = rom.file(PLACEMENT_FILE_BASE + index);
  const model = rom.file(MODEL_FILE_BASE + index);
  const dv = view(model);
  const lib = new MeshLibrary();
  const [, levelMeshCount] = lib.add(model, MODEL_FILE_BASE + index);
  const { meshes, textures } = lib;

  // Placement names are resolved against the level file first, then the other
  // containers (loaded on first need). Stored object names carry suffixes such as
  // "G1" and are truncated to 15 characters; placements of direction-specific
  // variants add "_FW"/"_BW".
  const extraFiles = [...(info.kind === 'race' ? [TRACK_PROPS_BASE + index] : []), ...SHARED_OBJECT_FILES];
  let extrasLoaded = false;
  const resolved = new Map<string, number>();
  const lookup = (name: string, from: number, to: number): number => {
    const base = name.replace(/_(FW|BW)$/, '');
    let prefix = -1;
    for (let i = from; i < to; i++) {
      const n = meshes[i].name;
      if (n === name || n === base || n === `${base}G1`) return i;
      // A prefix match must not continue the name's digits ("RAMP" isn't "RAMP02...").
      if (prefix < 0 && n.startsWith(base) && !/^\d/.test(n.slice(base.length))) prefix = i;
    }
    return prefix;
  };
  const resolve = (name: string): number => {
    let mesh = resolved.get(name);
    if (mesh !== undefined) return mesh;
    mesh = lookup(name, 0, levelMeshCount);
    if (mesh < 0) {
      if (!extrasLoaded) {
        for (const f of extraFiles) lib.add(rom.file(f), f);
        extrasLoaded = true;
      }
      mesh = lookup(name, levelMeshCount, meshes.length);
    }
    resolved.set(name, mesh);
    return mesh;
  };

  const psec = readSections(place);
  const pdv = view(place);
  const whdr = psec.get('WHDR')!;
  const wobj = psec.get('WOBJ')!;
  const instances: Instance[] = [];
  const bounds = emptyBounds();
  for (let i = 0; i < wobj.count; i++) {
    const o = wobj.offset + i * 104;
    const name = cstr(place, o, 16);
    const m = mirrorPlacementX(Array.from({ length: 12 }, (_, k) => pdv.getFloat32(o + 16 + k * 4)));
    const mesh = resolve(name);
    instances.push({ name, mesh, matrix: placementMatrix(m) });
    if (mesh >= 0 && mesh < levelMeshCount) {
      const rad = meshes[mesh].radius;
      for (let k = 0; k < 3; k++) {
        bounds.min[k] = Math.min(bounds.min[k], m[9 + k] - rad);
        bounds.max[k] = Math.max(bounds.max[k], m[9 + k] + rad);
      }
    }
  }
  // Scripted objects (doors, trains, obstacle-course hazards) have no placement
  // entry; PTHD (36 bytes each: name, flags, ..., PATH offset) lists their motion
  // paths. PATH keyframes are 68 bytes: world position, direction, scale, rotation
  // quaternion (x, y, z, w; all zero when unused), timing. Show each object at the
  // first keyframe of each of its paths.
  const pthd = readSections(model).get('PTHD');
  if (pthd) {
    const seen = new Set<string>();
    for (let i = 0; i < pthd.count; i++) {
      const e = pthd.offset + i * 36;
      const name = cstr(model, e, 16);
      let k = dv.getUint32(e + 28);
      let f = (n: number) => dv.getFloat32(k + n * 4);
      // Some paths start with a keyframe at the origin; the real start follows it.
      if (f(0) === 0 && f(1) === 0 && f(2) === 0 && k + 136 <= model.length) {
        k += 68;
        f = (n: number) => dv.getFloat32(k + n * 4);
      }
      const key = `${name}/${f(0)}/${f(1)}/${f(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const mesh = resolve(name);
      if (mesh < 0) continue;
      let [x, y, z, w] = [f(9), f(10), f(11), f(12)];
      const len = Math.hypot(x, y, z, w);
      if (len < 1e-6) [x, y, z, w] = [0, 0, 0, 1];
      else [x, y, z, w] = [x / len, y / len, z / len, w / len];
      const [sx, sy, sz] = [f(6), f(7), f(8)];
      instances.push({
        name,
        mesh,
        animated: true,
        matrix: mirrorMatrixX(new Float32Array([
          (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + w * z) * sx, 2 * (x * z - w * y) * sx, 0,
          2 * (x * y - w * z) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + w * x) * sy, 0,
          2 * (x * z + w * y) * sz, 2 * (y * z - w * x) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
          f(0), f(1), f(2), 1,
        ])),
      });
    }
  }

  const pruned = pruneUnused(meshes, textures, instances, levelMeshCount);
  return { info, id: cstr(place, whdr.offset + 8, 16), instances, bounds, ...pruned };
}
