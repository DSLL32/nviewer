import type { CameraView, Level, LevelInfo, LevelKind, LevelLayer } from '../types';
import { MarioPartyFs } from './fs';
import { buildFormParts, formLocalMatrix, parseForm } from './form';
import recipes from './scene-recipes.json';

type V3 = [number, number, number];

interface ScenePart {
  id: string;
  flags?: number;
  role: 'static' | 'prop' | 'hidden';
  pos?: V3;
  rot?: V3;
  scl?: V3;
}

interface SceneRecipe {
  key: string;
  ovl: number | null;
  name: string;
  kind: LevelKind;
  group?: string;
  listed: boolean;
  parts: ScenePart[];
  camera?: {
    center?: V3; rot?: V3; zoom?: number;
    eye?: V3; target?: V3; fov: number;
    near?: number; far?: number; source?: string;
  };
  fog?: { near: number; far: number; color: V3 };
  clear?: V3;
  lights?: { ambient: V3; dirs: { dir: V3; color: V3 | null }[] };
}

const sceneRecipes = (recipes.scenes as unknown as SceneRecipe[])
  .filter((scene) => scene.parts.length > 0)
  .sort((a, b) => a.kind.localeCompare(b.kind) ||
    (a.group ?? '').localeCompare(b.group ?? '') ||
    (a.ovl ?? 999) - (b.ovl ?? 999));

export const marioPartyScenes: LevelInfo[] = sceneRecipes.map((scene, index) => ({
  index,
  name: scene.listed ? scene.name : `${scene.name} (partial)`,
  kind: scene.kind,
  group: scene.group,
}));

function sceneCamera(scene: SceneRecipe): CameraView | undefined {
  const camera = scene.camera;
  if (!camera) return undefined;
  if (camera.eye && camera.target) return {
    eye: camera.eye, target: camera.target, fovY: camera.fov,
  };
  if (!camera.center || !camera.rot || camera.zoom === undefined) return undefined;
  const [rx, ry] = camera.rot.map((v) => v * Math.PI / 180);
  const eye: V3 = [
    camera.center[0] + Math.sin(ry) * Math.cos(rx) * camera.zoom,
    camera.center[1] - Math.sin(rx) * camera.zoom,
    camera.center[2] + Math.cos(ry) * Math.cos(rx) * camera.zoom,
  ];
  return { eye, target: camera.center, fovY: camera.fov };
}

export function buildMarioPartyScene(fs: MarioPartyFs, localIndex: number, levelIndex: number): Level {
  const scene = sceneRecipes[localIndex];
  if (!scene) throw new RangeError(`Mario Party scene ${localIndex} is absent`);
  const parts = scene.parts.map((part) => {
    const [dir, file] = part.id.split('/').map(Number);
    return {
      form: parseForm(fs.getFile(dir, file)),
      name: part.id,
      loadFlags: part.flags ?? 0x299,
      role: part.role === 'static' ? 'main' as const :
        part.role === 'prop' ? 'objects' as const : 'hidden' as const,
      matrix: formLocalMatrix({
        pos: part.pos ?? [0, 0, 0],
        rot: part.rot ?? [0, 0, 0],
        scl: part.scl ?? [1, 1, 1],
      }),
    };
  });
  const built = buildFormParts(parts, { lights: scene.lights });
  const groups = { main: [] as number[], objects: [] as number[], hidden: [] as number[], collision: [] as number[] };
  built.roles.forEach((role, index) => groups[role].push(index));
  const layers: LevelLayer[] = [];
  if (groups.main.length) layers.push({ name: 'arena', kind: 'main', instances: groups.main });
  if (groups.objects.length) layers.push({ name: 'props at start', kind: 'objects', instances: groups.objects });
  if (groups.hidden.length) layers.push({ name: 'hidden at start', kind: 'objects', instances: groups.hidden, visibleByDefault: false });
  if (groups.collision.length) layers.push({ name: 'collision (MAP1)', kind: 'collision', instances: groups.collision, visibleByDefault: false });

  const level: Level = {
    id: `marioparty-scene-${scene.key}`,
    info: { ...marioPartyScenes[localIndex], index: levelIndex },
    textures: built.textures,
    meshes: built.meshes,
    instances: built.instances,
    layers,
    unplaced: [],
    bounds: built.bounds,
    camera: sceneCamera(scene),
    clearColor: scene.clear,
  };
  if (scene.fog) {
    const { near, far, color } = scene.fog;
    level.fog = {
      color,
      multiplier: Math.trunc(128000 / (far - near)),
      offset: Math.trunc((500 - near) * 256 / (far - near)),
      near: scene.camera?.near ?? 80,
      far: scene.camera?.far ?? 8000,
    };
  }
  return level;
}
