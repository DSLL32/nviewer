// Camera-centred approximation of Mario Kart 64's two screen-space sky gradients.
import type { Batch, Mesh, MeshSky } from '../types';

type RGB = [number, number, number];
interface SkyColors { top: RGB; upperHorizon: RGB; lowerHorizon: RGB; bottom: RGB }

const SKY: SkyColors[] = [
  { top: [128, 184, 248], upperHorizon: [216, 232, 248], lowerHorizon: [0, 0, 0], bottom: [0, 0, 0] },
  { top: [255, 255, 255], upperHorizon: [255, 255, 255], lowerHorizon: [255, 255, 255], bottom: [255, 255, 255] },
  { top: [48, 8, 120], upperHorizon: [0, 0, 0], lowerHorizon: [0, 0, 0], bottom: [0, 0, 0] },
  { top: [0, 0, 0], upperHorizon: [0, 0, 0], lowerHorizon: [0, 0, 0], bottom: [0, 0, 0] },
  { top: [113, 70, 255], upperHorizon: [255, 184, 99], lowerHorizon: [95, 40, 15], bottom: [0, 0, 0] },
  { top: [28, 11, 90], upperHorizon: [0, 99, 164], lowerHorizon: [0, 99, 164], bottom: [0, 0, 0] },
  { top: [48, 152, 120], upperHorizon: [216, 232, 248], lowerHorizon: [48, 152, 120], bottom: [0, 0, 0] },
  { top: [238, 144, 255], upperHorizon: [255, 224, 240], lowerHorizon: [255, 224, 240], bottom: [0, 0, 0] },
  { top: [128, 184, 248], upperHorizon: [216, 232, 248], lowerHorizon: [216, 232, 248], bottom: [0, 0, 0] },
  { top: [0, 18, 255], upperHorizon: [197, 211, 255], lowerHorizon: [255, 184, 99], bottom: [0, 0, 0] },
  { top: [0, 2, 94], upperHorizon: [209, 65, 23], lowerHorizon: [209, 65, 23], bottom: [0, 0, 0] },
  { top: [195, 231, 255], upperHorizon: [255, 192, 0], lowerHorizon: [255, 192, 0], bottom: [0, 0, 0] },
  { top: [128, 184, 248], upperHorizon: [216, 232, 248], lowerHorizon: [216, 232, 248], bottom: [128, 184, 248] },
  { top: [0, 0, 0], upperHorizon: [0, 0, 0], lowerHorizon: [0, 0, 0], bottom: [0, 0, 0] },
  { top: [20, 30, 56], upperHorizon: [40, 60, 110], lowerHorizon: [0, 0, 0], bottom: [0, 0, 0] },
  { top: [128, 184, 248], upperHorizon: [216, 232, 248], lowerHorizon: [216, 232, 248], bottom: [0, 0, 0] },
  { top: [0, 0, 0], upperHorizon: [0, 0, 0], lowerHorizon: [0, 0, 0], bottom: [0, 0, 0] },
  { top: [113, 70, 255], upperHorizon: [255, 184, 99], lowerHorizon: [255, 224, 240], bottom: [0, 0, 0] },
  { top: [255, 174, 0], upperHorizon: [255, 229, 124], lowerHorizon: [22, 145, 22], bottom: [0, 0, 0] },
  { top: [0, 0, 0], upperHorizon: [0, 0, 0], lowerHorizon: [0, 0, 0], bottom: [0, 0, 0] },
  { top: [238, 144, 255], upperHorizon: [255, 224, 240], lowerHorizon: [255, 224, 240], bottom: [0, 0, 0] },
];

function addVertex(positions: number[], colors: number[], yaw: number, pitch: number, color: RGB) {
  const radius = 10000, cp = Math.cos(pitch);
  positions.push(radius * Math.sin(yaw) * cp, radius * Math.sin(pitch), -radius * Math.cos(yaw) * cp);
  colors.push(...color, 255);
}

export function addSky(courseId: number, meshes: Mesh[]): { skies: MeshSky[]; clearColor: RGB } {
  const sky = SKY[courseId] ?? SKY[0];
  const rings = [Math.PI / 2, 0.01, -0.01, -Math.PI / 2];
  const colors = [sky.top, sky.upperHorizon, sky.lowerHorizon, sky.bottom];
  const positions: number[] = [], vertexColors: number[] = [];
  const segments = 32;
  for (let ring = 0; ring + 1 < rings.length; ring++) for (let i = 0; i < segments; i++) {
    const y0 = i * Math.PI * 2 / segments, y1 = (i + 1) * Math.PI * 2 / segments;
    addVertex(positions, vertexColors, y0, rings[ring], colors[ring]);
    addVertex(positions, vertexColors, y0, rings[ring + 1], colors[ring + 1]);
    addVertex(positions, vertexColors, y1, rings[ring + 1], colors[ring + 1]);
    addVertex(positions, vertexColors, y0, rings[ring], colors[ring]);
    addVertex(positions, vertexColors, y1, rings[ring + 1], colors[ring + 1]);
    addVertex(positions, vertexColors, y1, rings[ring], colors[ring]);
  }
  const batch: Batch = {
    texture: -1, blend: 'opaque', depthTest: false, depthWrite: false, cullBack: false,
    positions: new Float32Array(positions), uvs: new Float32Array(positions.length / 3 * 2), colors: new Uint8Array(vertexColors),
  };
  const mesh = meshes.push({
    name: 'sky gradient (camera-centred approximation)', radius: 10000, batches: [batch],
    info: { source: 'sTopSkyBoxColors/sBottomSkyBoxColors', approximation: 'world sphere; game uses screen-space gradients' },
  }) - 1;
  return { skies: [{ name: 'Course sky', kind: 'mesh', mesh, opaque: true }], clearColor: sky.bottom };
}

export const PROJECTION: readonly [number, number][] = [
  [9, 4500], [2, 1500], [2, 2700], [2, 2700], [9, 4500], [9, 4500], [1, 5000],
  [9, 4500], [9, 4500], [9, 4500], [9, 4500], [10, 7000], [9, 4500], [2, 2700],
  [10, 4800], [2, 2700], [2, 2700], [2, 1500], [9, 4500], [3, 6800], [3, 6800],
];

