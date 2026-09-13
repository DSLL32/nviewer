// WebGL2 level renderer: uploads a parsed Level once, then draws sky, opaque/cutout and blended passes.
import type { Backdrop, Batch, Fog, Level, Mesh, SkyPlane } from '../rom';
import type { FlyCamera } from './camera';
import { applyTextureFilter, createProgram, uploadTexture, type TextureFilter } from './gl';
import { mat4, vec3, type Mat4 } from './math';

const VS = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec2 aUv;
layout(location = 2) in vec4 aColor;
layout(location = 3) in vec2 aUv1; // second texture's coordinates (Batch.uvs1)
uniform mat4 uViewProj;
uniform mat4 uView;
uniform mat4 uModel;
// N64 RSP fog (gSPFogPosition), computed per vertex and interpolated like on the hardware: zndc from the game's
// fog projection near/far, then (zndc * mul + offset) / 255, clamped per vertex.
uniform bool uFog;
uniform highp float uFogNear;
uniform highp float uFogFar;
uniform highp float uFogMul;
uniform highp float uFogOffset;
out vec2 vUv;
out vec2 vUv1;
out vec4 vColor;
out highp float vFog;
out highp float vLogW; // 1 + clip w, for the logarithmic depth buffer
void main() {
  vUv = aUv;
  vUv1 = aUv1;
  vColor = aColor;
  vec4 world = uModel * vec4(aPosition, 1.0);
  highp float depth = -(uView * world).z; // positive view-space depth along the view axis, world units
  vFog = 0.0;
  if (uFog) {
    highp float d = max(depth, 1e-3);
    highp float range = uFogFar - uFogNear;
    highp float zndc = (uFogFar + uFogNear) / range - 2.0 * uFogFar * uFogNear / (range * d);
    vFog = clamp((zndc * uFogMul + uFogOffset) / 255.0, 0.0, 1.0);
  }
  gl_Position = uViewProj * world;
  vLogW = 1.0 + gl_Position.w;
}`;

// Main fragment shader. The cutaway variant is a separate program (compiled on first use), so the normal path's shader
// is unchanged by it.
const mainFs = (cutaway: boolean) => `#version 300 es
${cutaway ? '#define CUTAWAY' : ''}
precision highp float;
uniform sampler2D uTexture;
uniform bool uTextured;
// Batch.texture1: 0 none, 1 lerp (mix by uTexMix, colour and alpha), 2 multiply (colour only; alpha from uTexture).
uniform int uTex2;
uniform sampler2D uTexture1;
uniform float uTexMix;
uniform int uMode; // 0 opaque, 1 cutout, 2 blend
uniform float uOpacity; // fades whole instances (an overlay under the pointer); 1 otherwise
uniform bool uFog;
uniform vec3 uFogColor;
// Logarithmic depth (1 / log2(far + 1)): keeps precision over both 10k-unit Rush tracks and 20k-unit Bomberman
// maps with few-unit details, where a 24-bit perspective depth buffer would z-fight at a distance.
uniform highp float uLogDepthCoef;
// Pulls decal batches (coplanar markings) towards the camera in log-depth space; 0 for everything else.
uniform highp float uDepthBias;
// Cutaway variant (depth peeling): drop fragments that are not behind the nearest opaque/cutout surface found by the first
// pass (its log depth per pixel; 1 where it found none). The comparison uses the unbiased depth, so decals go with the
// surface they lie on. The first pass is single-sampled but this one is antialiased: a surface's edge fragment can
// cover samples of a pixel whose centre the first pass saw as empty or as another surface, so the threshold is the
// farthest nearest-surface depth over the pixel and its four neighbours (otherwise peeled surfaces leave outlines).
#ifdef CUTAWAY
uniform highp sampler2D uPeelDepth;
uniform highp float uPeelEpsilon;
const ivec2 PEEL_TAPS[5] = ivec2[5](ivec2(0, 0), ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1));
#endif
in vec2 vUv;
in vec2 vUv1;
in vec4 vColor;
in highp float vFog;
in highp float vLogW;
out vec4 outColor;
void main() {
#ifdef CUTAWAY
  highp float depth = log2(max(vLogW, 1e-6)) * uLogDepthCoef;
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  ivec2 last = textureSize(uPeelDepth, 0) - 1;
  highp float first = -1.0;
  for (int k = 0; k < 5; k++) {
    highp float d = texelFetch(uPeelDepth, clamp(pixel + PEEL_TAPS[k], ivec2(0), last), 0).r;
    if (d < 1.0) first = max(first, d);
  }
  if (first >= 0.0 && depth <= first + uPeelEpsilon) discard;
  gl_FragDepth = max(0.0, depth - uDepthBias);
#else
  gl_FragDepth = max(0.0, log2(max(vLogW, 1e-6)) * uLogDepthCoef - uDepthBias);
#endif
  vec4 c = vColor;
  if (uTextured) {
    vec4 t = texture(uTexture, vUv);
    if (uTex2 == 1) t = mix(t, texture(uTexture1, vUv1), uTexMix);
    else if (uTex2 == 2) t.rgb *= texture(uTexture1, vUv1).rgb;
    c *= t;
  }
  if (uMode == 1 && c.a < 0.5) discard;
  if (uMode == 0) c.a = 1.0;
  c.a *= uOpacity; // after the cutout test: a faded cutout keeps its shape
  if (uFog) c.rgb = mix(c.rgb, uFogColor, vFog);
  outColor = c;
}`;

// Screen-fixed backdrop picture: a full-screen quad showing the texture window [u0,u1] x [v0,v1]
// left to right and top to bottom, multiplied by a tint.
const BACKDROP_VS = `#version 300 es
layout(location = 0) in vec2 aCorner; // 0..1, y up
uniform vec4 uWindow; // u0, v0, u1, v1
out vec2 vUv;
void main() {
  vUv = vec2(mix(uWindow.x, uWindow.z, aCorner.x), mix(uWindow.y, uWindow.w, 1.0 - aCorner.y));
  gl_Position = vec4(aCorner * 2.0 - 1.0, 0.0, 1.0);
}`;

const BACKDROP_FS = `#version 300 es
precision highp float;
uniform sampler2D uTexture;
uniform vec3 uTint;
in vec2 vUv;
out vec4 outColor;
void main() {
  outColor = vec4(texture(uTexture, vUv).rgb * uTint, 1.0);
}`;

// Level.skyPlanes: a full-screen pass that casts each pixel's view ray onto a horizontal world plane. The direction is
// interpolated from the four screen corners (exact for a pinhole camera, and continuous, so the texture derivatives
// hold); the horizon offset shifts the rays' screen rows before the cast.
const SKY_PLANE_VS = `#version 300 es
layout(location = 0) in vec2 aCorner; // 0..1, y up
uniform vec3 uRay0; // ray through the screen centre (forward, shifted by the horizon offset)
uniform vec3 uRayX; // added per NDC unit to the right
uniform vec3 uRayY; // added per NDC unit up
out vec3 vDir;
void main() {
  vec2 ndc = aCorner * 2.0 - 1.0;
  vDir = uRay0 + uRayX * ndc.x + uRayY * ndc.y;
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

const SKY_PLANE_FS = `#version 300 es
precision highp float;
uniform sampler2D uTexture;
uniform float uSide; // +1: plane above the eye (rays going up hit it), -1: below
uniform float uHeight; // |plane height - eye height|, world units
uniform vec2 uUvOrigin; // eye (x, z) / uvScale, wrapped to [0, 1) on the CPU for precision
uniform float uInvUvScale;
uniform vec3 uColor; // 0..1
uniform vec3 uHorizon; // 0..1
uniform bool uWater; // texel x shade; else (shade - horizon) x texel + horizon
in vec3 vDir;
out vec4 outColor;
void main() {
  float dy = vDir.y * uSide;
  float dxz = length(vDir.xz);
  // Hit distance, capped just above the horizon so the UVs stay finite and continuous for the texture derivatives
  // (the pixels past the horizon are discarded below).
  float t = uHeight / max(dy, 1e-4 * dxz + 1e-9);
  vec2 uv = uUvOrigin + vDir.xz * (t * uInvUvScale);
  vec2 gx = dFdx(uv);
  vec2 gy = dFdy(uv);
  vec3 texel = textureGrad(uTexture, uv, gx, gy).rgb;
  // Towards the horizon one pixel spans a large part of a texture repeat, beyond what mipmaps and anisotropic
  // filtering resolve: fade to the texture's average colour there instead of shimmering.
  float footprint = max(length(gx), length(gy)); // texture repeats per pixel
  vec3 mean = textureLod(uTexture, vec2(0.5), 16.0).rgb;
  texel = mix(texel, mean, smoothstep(0.1, 0.5, footprint));
  if (dy <= 0.0) discard;
  float w = min(1.0, 2.0 * dy / max(dxz, 1e-9));
  vec3 shade = uHorizon + uColor * (1.0 - uHorizon) * w;
  outColor = vec4(uWater ? texel * shade : uHorizon + (shade - uHorizon) * texel, 1.0);
}`;

// The horizon offset is given in pixels of the game's 3D view, which is 220 rows tall (110 rows per NDC unit).
const SKY_OFFSET_ROWS_PER_NDC = 110;

// Selection overlay (picked object box / face): flat colour with the scene's logarithmic depth, so one pass can be
// depth-tested against the level and another drawn through it.
const HIGHLIGHT_VS = `#version 300 es
layout(location = 0) in vec3 aPosition;
uniform mat4 uViewProj;
uniform vec2 uOffset; // screen-space nudge in clip units per w: offset copies thicken 1-pixel lines
out highp float vLogW;
void main() {
  gl_Position = uViewProj * vec4(aPosition, 1.0);
  vLogW = 1.0 + gl_Position.w;
  gl_Position.xy += uOffset * gl_Position.w;
}`;

// Wireframe overlays (setWireframe, setCollisionWireframe): triangle edges drawn as GL lines from the batches' own
// vertex buffers with one shared edge index buffer (non-indexed triangles: vertex v, v+1, v+2), depth-tested against the
// shaded scene with a small pull towards the camera. The cutaway variant drops what the cutaway removed.
const WIRE_VS = `#version 300 es
layout(location = 0) in vec3 aPosition;
uniform mat4 uViewProj;
uniform mat4 uModel;
out highp float vLogW;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  gl_Position = uViewProj * world;
  vLogW = 1.0 + gl_Position.w;
}`;

const wireFs = (cutaway: boolean) => `#version 300 es
${cutaway ? '#define CUTAWAY' : ''}
precision highp float;
uniform vec4 uColor;
uniform highp float uLogDepthCoef;
uniform highp float uDepthBias;
#ifdef CUTAWAY
uniform highp sampler2D uPeelDepth;
uniform highp float uPeelEpsilon;
const ivec2 PEEL_TAPS[5] = ivec2[5](ivec2(0, 0), ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1));
#endif
in highp float vLogW;
out vec4 outColor;
void main() {
  highp float depth = log2(max(vLogW, 1e-6)) * uLogDepthCoef;
#ifdef CUTAWAY
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  ivec2 last = textureSize(uPeelDepth, 0) - 1;
  highp float first = -1.0;
  for (int k = 0; k < 5; k++) {
    highp float d = texelFetch(uPeelDepth, clamp(pixel + PEEL_TAPS[k], ivec2(0), last), 0).r;
    if (d < 1.0) first = max(first, d);
  }
  if (first >= 0.0 && depth <= first + uPeelEpsilon) discard;
#endif
  gl_FragDepth = max(0.0, depth - uDepthBias);
  outColor = uColor;
}`;

const WIRE_DEPTH_BIAS = 1e-4;
const WIRE_COLOR = [0.35, 0.9, 1, 0.55] as const; // level geometry
const COLLISION_WIRE_COLOR = [1, 0.45, 0.15, 0.85] as const; // collision layers

interface WireProgram {
  program: WebGLProgram;
  uViewProj: WebGLUniformLocation | null;
  uModel: WebGLUniformLocation | null;
  uColor: WebGLUniformLocation | null;
  uLogDepthCoef: WebGLUniformLocation | null;
  uDepthBias: WebGLUniformLocation | null;
  uPeelEpsilon: WebGLUniformLocation | null;
}

function createWireProgram(gl: WebGL2RenderingContext, cutaway: boolean): WireProgram {
  const program = createProgram(gl, WIRE_VS, wireFs(cutaway));
  const loc = (name: string) => gl.getUniformLocation(program, name);
  if (cutaway) {
    gl.useProgram(program);
    gl.uniform1i(loc('uPeelDepth'), 1);
  }
  return { program, uViewProj: loc('uViewProj'), uModel: loc('uModel'), uColor: loc('uColor'), uLogDepthCoef: loc('uLogDepthCoef'), uDepthBias: loc('uDepthBias'), uPeelEpsilon: loc('uPeelEpsilon') };
}

const HIGHLIGHT_FS = `#version 300 es
precision highp float;
uniform vec4 uColor;
uniform highp float uLogDepthCoef;
uniform highp float uDepthBias;
in highp float vLogW;
out vec4 outColor;
void main() {
  gl_FragDepth = max(0.0, log2(max(vLogW, 1e-6)) * uLogDepthCoef - uDepthBias);
  outColor = uColor;
}`;

// Pulls the depth-tested highlight lines slightly in front of the surfaces whose edges they trace.
const HIGHLIGHT_DEPTH_BIAS = 1e-4;
const HALO_OFFSETS = [[-2, -2], [2, -2], [-2, 2], [2, 2], [0, -2], [0, 2], [-2, 0], [2, 0]];
const CORE_OFFSETS = [[0, 0], [1, 0], [0, 1], [1, 1]];

const enum Mode { Opaque = 0, Cutout = 1, Blend = 2 }

/** The main level program (or its cutaway variant) and its uniform locations. */
interface MainProgram {
  program: WebGLProgram;
  uViewProj: WebGLUniformLocation | null;
  uView: WebGLUniformLocation | null;
  uModel: WebGLUniformLocation | null;
  uTextured: WebGLUniformLocation | null;
  uTex2: WebGLUniformLocation | null;
  uTexMix: WebGLUniformLocation | null;
  uMode: WebGLUniformLocation | null;
  uFog: WebGLUniformLocation | null;
  uFogColor: WebGLUniformLocation | null;
  uFogNear: WebGLUniformLocation | null;
  uFogFar: WebGLUniformLocation | null;
  uFogMul: WebGLUniformLocation | null;
  uFogOffset: WebGLUniformLocation | null;
  uLogDepthCoef: WebGLUniformLocation | null;
  uDepthBias: WebGLUniformLocation | null;
  uOpacity: WebGLUniformLocation | null;
  uPeelEpsilon: WebGLUniformLocation | null; // cutaway variant only
}

/** Texture unit of Batch.texture1 (unit 0: the batch texture, unit 1: the cutaway depth). */
const TEXTURE1_UNIT = 2;

function createMainProgram(gl: WebGL2RenderingContext, cutaway: boolean): MainProgram {
  const program = createProgram(gl, VS, mainFs(cutaway));
  const loc = (name: string) => gl.getUniformLocation(program, name);
  gl.useProgram(program);
  gl.uniform1i(loc('uTexture'), 0);
  gl.uniform1i(loc('uTexture1'), TEXTURE1_UNIT);
  if (cutaway) gl.uniform1i(loc('uPeelDepth'), 1);
  return {
    program,
    uViewProj: loc('uViewProj'), uView: loc('uView'), uModel: loc('uModel'), uTextured: loc('uTextured'), uMode: loc('uMode'),
    uTex2: loc('uTex2'), uTexMix: loc('uTexMix'),
    uFog: loc('uFog'), uFogColor: loc('uFogColor'), uFogNear: loc('uFogNear'), uFogFar: loc('uFogFar'), uFogMul: loc('uFogMul'),
    uFogOffset: loc('uFogOffset'), uLogDepthCoef: loc('uLogDepthCoef'), uDepthBias: loc('uDepthBias'), uOpacity: loc('uOpacity'),
    uPeelEpsilon: loc('uPeelEpsilon'),
  };
}

/** Cutaway: surfaces within this fraction of the view distance of the nearest one are removed with it. */
export const CUTAWAY_EPSILON = 2e-3;

// Log-depth bias for decals: about 2e-4 of the view distance (0.2 units at 1000, 1 unit at 5000 with far 80000),
// roughly 300 steps of a 24-bit depth buffer.
const DECAL_DEPTH_BIAS = 2e-5;

interface GpuBatch {
  vao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  count: number;
  texture: WebGLTexture | null;
  // Batch.texture1: the second texture and how it combines (0 none, 1 lerp, 2 multiply).
  texture1: WebGLTexture | null;
  tex2: number;
  texMix: number;
  mode: Mode;
  depthTest: boolean;
  depthWrite: boolean;
  cullBack: boolean;
  forceCullBack: boolean;
  decal: boolean;
  colorBuffer: WebGLBuffer | null;
  unlitColorBuffer: WebGLBuffer | null;
  lightingColorBuffers: WebGLBuffer[];
  edges: WebGLBuffer | null; // the wireframe index buffer bound to this batch's vertex array, once used
}

interface GpuMesh {
  solid: GpuBatch[]; // opaque + cutout, in display-list order
  // `solid` split for the level pass: batches without depth test or depth write (backdrops the game draws before the
  // rest, e.g. GoldenEye's Dam backdrop room), drawn across all instances before the depth-tested ones; and the rest.
  background: GpuBatch[];
  tested: GpuBatch[];
  decal: GpuBatch[]; // coplanar decals (any blend mode), drawn after all solid geometry with a depth bias
  blended: GpuBatch[];
}

interface GpuSkyPlane {
  texture: WebGLTexture;
  water: boolean;
  height: number; // world Y
  uvScale: number;
  color: [number, number, number]; // 0..1
  horizon: [number, number, number]; // 0..1
  offsetNdc: number; // horizon offset in NDC units (positive: the plane appears shifted up)
}

interface DrawItem {
  index: number; // into Level.instances
  mesh: GpuMesh;
  model: Mat4;
  animated: boolean;
  noFog: boolean; // the game draws this instance without fog even when fog is on
  mirrored: boolean; // negative determinant: winding is flipped
  collision: boolean; // in a collision layer (LevelLayer kind 'collision')
  x: number;
  y: number;
  z: number;
  dist: number;
}

interface Scene {
  textures: WebGLTexture[];
  meshes: Map<number, GpuMesh>;
  batches: GpuBatch[];
  items: DrawItem[];
  blendItems: DrawItem[];
  hasDecals: boolean;
  hasBackground: boolean;
  lightingPresetCount: number;
  skyPlanes: GpuSkyPlane[]; // Level.skyPlanes, drawn in order
  skyPlaneTextures: WebGLTexture[]; // repeating copies of their textures
  sky: GpuMesh[]; // legacy sky domes (Rush 2049: unplaced *SKY meshes)
  skies: { name: string; batches: GpuBatch[] }[]; // Level.skies (Rush 1), one drawn at a time
  clearColor: [number, number, number]; // 0..1
  levelClearColor: [number, number, number] | null; // Level.clearColor, 0..1
  backdrop: { texture: WebGLTexture; window: [number, number, number, number]; tint: [number, number, number] } | null;
  // Line indices for the wireframe overlays, sized for the largest batch; made when a wireframe is first shown.
  edgeIndex: { buffer: WebGLBuffer; type: number; triangles: number; bytes: number } | null;
}

const DEFAULT_CLEAR: [number, number, number] = [0.46, 0.64, 0.86];

/** What to draw over the scene for the current selection. */
export interface Highlight {
  lines: Float32Array; // world-space segments: xyz per vertex, two vertices per segment
  fill?: Float32Array; // world-space triangles, shown translucent over everything
  color: [number, number, number]; // 0..1
}

export interface FrameStats {
  drawCalls: number;
}

export class LevelRenderer {
  readonly gl: WebGL2RenderingContext;
  /** Set when something other than the camera changed and a redraw is needed. */
  dirty = true;
  lastFrame: FrameStats = { drawCalls: 0 };
  private showAnimated = true;
  private hiddenInstances: ReadonlySet<number> | null = null;
  private instanceOpacity: ReadonlyMap<number, number> | null = null;
  private fog: Fog | null = null;
  private fogEnabled = false;
  private lightingSetting: number | null = 0;
  private cullingEnabled = false;
  private backdropVisible = true;
  private skyGroundY = 0;
  /** Selected Level.skies entry by name; undefined = first sky, null = none. */
  private skySelection: string | null | undefined = undefined;

  private readonly main: MainProgram;
  private cutawayProgram: MainProgram | null = null;
  private cutaway = false;
  /** Cutaway first pass target: a depth texture the size of the canvas. */
  private peel: { fbo: WebGLFramebuffer; depth: WebGLTexture; width: number; height: number } | null = null;
  private readonly backdropProgram: WebGLProgram;
  private readonly uBackdropWindow: WebGLUniformLocation | null;
  private readonly uBackdropTint: WebGLUniformLocation | null;
  private readonly quadVao: WebGLVertexArrayObject;
  private readonly quadBuffer: WebGLBuffer;
  private skyPlanesVisible = true;
  private readonly skyPlaneProgram: WebGLProgram;
  private readonly skyPlaneUniforms: Record<'ray0' | 'rayX' | 'rayY' | 'side' | 'height' | 'uvOrigin' | 'invUvScale' | 'color' | 'horizon' | 'water', WebGLUniformLocation | null>;
  private readonly highlightProgram: WebGLProgram;
  private readonly uHlViewProj: WebGLUniformLocation | null;
  private readonly uHlOffset: WebGLUniformLocation | null;
  private readonly uHlColor: WebGLUniformLocation | null;
  private readonly uHlLogDepthCoef: WebGLUniformLocation | null;
  private readonly uHlDepthBias: WebGLUniformLocation | null;
  private readonly highlightVao: WebGLVertexArrayObject;
  private readonly highlightBuffer: WebGLBuffer;
  private highlight: { color: [number, number, number]; fillCount: number; lineCount: number } | null = null;
  private wireframe = false;
  private collisionWireframe = false;
  private wireProgram: WireProgram | null = null;
  private wireCutawayProgram: WireProgram | null = null;
  private readonly anisoExt: EXT_texture_filter_anisotropic | null;
  private readonly filter: TextureFilter;
  private scene: Scene | null = null;
  private readonly viewProj = mat4.create();
  private readonly view = mat4.create();
  private readonly skyModel = mat4.create();

  // Cached GL state to avoid redundant calls.
  private stDepthTest: boolean | null = null;
  private stDepthWrite: boolean | null = null;
  private stBlend: boolean | null = null;
  private stCull: boolean | null = null;
  private stMirrored: boolean | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.main = createMainProgram(gl, false);
    this.backdropProgram = createProgram(gl, BACKDROP_VS, BACKDROP_FS);
    this.uBackdropWindow = gl.getUniformLocation(this.backdropProgram, 'uWindow');
    this.uBackdropTint = gl.getUniformLocation(this.backdropProgram, 'uTint');
    gl.useProgram(this.backdropProgram);
    gl.uniform1i(gl.getUniformLocation(this.backdropProgram, 'uTexture'), 0);
    const quadVao = gl.createVertexArray();
    const quadBuffer = gl.createBuffer();
    if (!quadVao || !quadBuffer) throw new Error('Could not create backdrop quad');
    gl.bindVertexArray(quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.quadVao = quadVao;
    this.quadBuffer = quadBuffer;
    const sp = createProgram(gl, SKY_PLANE_VS, SKY_PLANE_FS);
    this.skyPlaneProgram = sp;
    const loc = (name: string) => gl.getUniformLocation(sp, name);
    this.skyPlaneUniforms = {
      ray0: loc('uRay0'), rayX: loc('uRayX'), rayY: loc('uRayY'), side: loc('uSide'), height: loc('uHeight'),
      uvOrigin: loc('uUvOrigin'), invUvScale: loc('uInvUvScale'), color: loc('uColor'), horizon: loc('uHorizon'), water: loc('uWater'),
    };
    gl.useProgram(sp);
    gl.uniform1i(loc('uTexture'), 0);
    const hp = createProgram(gl, HIGHLIGHT_VS, HIGHLIGHT_FS);
    this.highlightProgram = hp;
    this.uHlViewProj = gl.getUniformLocation(hp, 'uViewProj');
    this.uHlOffset = gl.getUniformLocation(hp, 'uOffset');
    this.uHlColor = gl.getUniformLocation(hp, 'uColor');
    this.uHlLogDepthCoef = gl.getUniformLocation(hp, 'uLogDepthCoef');
    this.uHlDepthBias = gl.getUniformLocation(hp, 'uDepthBias');
    const hlVao = gl.createVertexArray();
    const hlBuffer = gl.createBuffer();
    if (!hlVao || !hlBuffer) throw new Error('Could not create highlight buffers');
    gl.bindVertexArray(hlVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, hlBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.highlightVao = hlVao;
    this.highlightBuffer = hlBuffer;
    this.anisoExt = gl.getExtension('EXT_texture_filter_anisotropic');
    const maxAniso = this.anisoExt ? (gl.getParameter(this.anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) : 1;
    this.filter = { nearest: false, anisotropy: Math.min(8, maxAniso) };
    gl.depthFunc(gl.LEQUAL);
    // Optional back-face culling (off by default); the parser delivers OpenGL winding (counter-clockwise front).
    gl.disable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  setNearestFiltering(nearest: boolean) {
    if (this.filter.nearest === nearest) return;
    this.filter.nearest = nearest;
    for (const t of [...(this.scene?.textures ?? []), ...(this.scene?.skyPlaneTextures ?? [])]) applyTextureFilter(this.gl, t, this.filter, this.anisoExt);
    this.dirty = true;
  }

  /** Toggle the game's own distance fog (only has an effect when the level defines fog). */
  setFogEnabled(enabled: boolean) {
    if (this.fogEnabled === enabled) return;
    this.fogEnabled = enabled;
    this.dirty = true;
  }

  /** Select one of Level.lighting.presets, or null to show lit geometry at full brightness. */
  setLightingSetting(setting: number | null) {
    if (this.lightingSetting === setting) return;
    this.lightingSetting = setting;
    this.applyLightingColors();
    this.dirty = true;
  }

  /** Cull ordinary cullBack batches when enabled; forceCullBack batches remain culled in either setting. */
  setBackfaceCulling(enabled: boolean) {
    if (this.cullingEnabled === enabled) return;
    this.cullingEnabled = enabled;
    this.dirty = true;
  }

  /** Show or hide the level's screen-fixed backdrop picture (Level.backdrop). */
  setBackdropVisible(visible: boolean) {
    if (this.backdropVisible === visible) return;
    this.backdropVisible = visible;
    this.dirty = true;
  }

  /** Show or hide the level's sky planes (Level.skyPlanes); hidden, the clear colour shows instead. */
  setSkyPlanesVisible(visible: boolean) {
    if (this.skyPlanesVisible === visible) return;
    this.skyPlanesVisible = visible;
    this.dirty = true;
  }

  /**
   * Cutaway: hide the nearest opaque or cutout surface under each pixel and show what lies behind it (e.g. the inside of
   * an enclosed room seen from outside). Two passes: the nearest surfaces' depth into a texture, then the scene with
   * everything not behind that depth discarded. Sky, sky planes and backdrops are unaffected.
   */
  /** Wireframe overlay: the triangle edges of the drawn level geometry (not sky, backdrops or collision layers). */
  setWireframe(enabled: boolean) {
    if (this.wireframe === enabled) return;
    this.wireframe = enabled;
    this.dirty = true;
  }

  /** Collision wireframe: the triangle edges of the collision layers, whether those layers are shown or not. */
  setCollisionWireframe(enabled: boolean) {
    if (this.collisionWireframe === enabled) return;
    this.collisionWireframe = enabled;
    this.dirty = true;
  }

  /** Size of the wireframe edge index buffer in bytes (0 until a wireframe was shown). */
  get wireframeIndexBytes(): number {
    return this.scene?.edgeIndex?.bytes ?? 0;
  }

  setCutaway(enabled: boolean) {
    if (this.cutaway === enabled) return;
    this.cutaway = enabled;
    if (!enabled) this.freePeel();
    this.dirty = true;
  }

  /** Show or hide scripted objects (doors, trains, hazards) that the parser places at their first keyframe. */
  setShowAnimated(show: boolean) {
    if (this.showAnimated === show) return;
    this.showAnimated = show;
    this.dirty = true;
  }

  /**
   * The sky dome follows the camera, offset down by the level's ground height so that its rim (modelled around
   * world ground level) stays at the horizon at any altitude.
   */
  setSkyGroundHeight(y: number) {
    this.skyGroundY = Number.isFinite(y) ? y : 0;
    this.dirty = true;
  }

  /** Choose which of the level's `skies` to draw (by name), or null for none. Unknown names fall back to the first. */
  setSky(name: string | null) {
    if (this.skySelection === name) return;
    this.skySelection = name;
    this.dirty = true;
  }

  /** Instances (indices into Level.instances) not to draw, e.g. from layers switched off; null draws all. */
  setHiddenInstances(indices: ReadonlySet<number> | null) {
    this.hiddenInstances = indices && indices.size > 0 ? indices : null;
    this.dirty = true;
  }

  /**
   * Opacity below 1 per instance (index into Level.instances), e.g. an overlay the pointer is over. Such instances
   * are drawn last, blended and without depth writes, so what lies behind them shows through. null: all opaque.
   */
  setInstanceOpacity(opacity: ReadonlyMap<number, number> | null) {
    this.instanceOpacity = opacity && opacity.size > 0 ? opacity : null;
    this.dirty = true;
  }

  /** Overlay for the picked object or face (null clears it). */
  setHighlight(h: Highlight | null) {
    this.dirty = true;
    const fill = h?.fill ?? new Float32Array(0);
    if (!h || (h.lines.length === 0 && fill.length === 0)) {
      this.highlight = null;
      return;
    }
    const data = new Float32Array(fill.length + h.lines.length);
    data.set(fill, 0);
    data.set(h.lines, fill.length);
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.highlightBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    this.highlight = { color: h.color, fillCount: Math.floor(fill.length / 3), lineCount: Math.floor(h.lines.length / 3) };
  }

  setLevel(level: Level | null) {
    this.freeScene();
    this.highlight = null;
    this.instanceOpacity = null;
    this.dirty = true;
    this.fog = level?.fog ?? null;
    if (!level) return;
    const gl = this.gl;
    const textures = level.textures.map((t) => uploadTexture(gl, t, this.filter, this.anisoExt));
    const meshes = new Map<number, GpuMesh>();
    const batches: GpuBatch[] = [];

    const getMesh = (index: number): GpuMesh | null => {
      const src: Mesh | undefined = level.meshes[index];
      if (!src) return null;
      let mesh = meshes.get(index);
      if (!mesh) {
        mesh = emptyMesh();
        for (const b of src.batches) {
          const gb = this.uploadBatch(b, textures);
          if (!gb) continue;
          batches.push(gb);
          if (gb.decal) mesh.decal.push(gb);
          else if (gb.mode === Mode.Blend) mesh.blended.push(gb);
          else {
            mesh.solid.push(gb);
            (!gb.depthTest && !gb.depthWrite ? mesh.background : mesh.tested).push(gb);
          }
        }
        meshes.set(index, mesh);
      }
      return mesh;
    };

    const collisionInstances = new Set<number>();
    for (const layer of level.layers ?? []) if (layer.kind === 'collision') for (const i of layer.instances) collisionInstances.add(i);
    const items: DrawItem[] = [];
    for (let index = 0; index < level.instances.length; index++) {
      const inst = level.instances[index];
      if (inst.mesh < 0) continue;
      const mesh = getMesh(inst.mesh);
      if (!mesh) continue;
      const m = inst.matrix;
      items.push({ index, mesh, model: m, animated: inst.animated === true, noFog: inst.noFog === true, mirrored: det3(m) < 0, collision: collisionInstances.has(index), x: m[12], y: m[13], z: m[14], dist: 0 });
    }

    const sky: GpuMesh[] = [];
    const skies: Scene['skies'] = [];
    let clearColor = DEFAULT_CLEAR;
    if (level.skies && level.skies.length > 0) {
      // Game-built skies normally use the viewer's blended pass (texture x vertex colour; alpha fades out at the
      // horizon). Some games explicitly draw a sky opaque; those retain each source batch's blend mode. cullBack
      // flags are honoured whatever the culling toggle says: Gex 3 builds its sky from patches that must not be
      // seen from behind.
      for (const entry of level.skies) {
        const src = level.meshes[entry.mesh];
        if (!src) continue;
        const skyBatches: GpuBatch[] = [];
        for (const b of src.batches) {
          const gb = this.uploadBatch(b, textures);
          if (!gb) continue;
          if (!entry.opaque) gb.mode = Mode.Blend;
          batches.push(gb);
          skyBatches.push(gb);
        }
        skies.push({ name: entry.name, batches: skyBatches });
      }
    } else {
      for (const index of level.unplaced) {
        const src = level.meshes[index];
        if (!src || !src.name.endsWith('SKY')) continue;
        const mesh = getMesh(index);
        if (mesh) sky.push(mesh);
        clearColor = horizonColor(src, level) ?? clearColor;
      }
    }

    // Sky planes sample their texture as repeating whatever wrap the level gives it: a separate copy, so geometry that
    // shares the texture keeps its own wrap mode.
    const skyPlaneTextures = new Map<number, WebGLTexture>();
    const skyPlanes: GpuSkyPlane[] = [];
    for (const p of level.skyPlanes ?? []) {
      const src = level.textures[p.texture];
      if (!src || !(p.uvScale > 0) || !Number.isFinite(p.height)) continue;
      let texture = skyPlaneTextures.get(p.texture);
      if (!texture) {
        texture = uploadTexture(gl, { ...src, wrapS: 'repeat', wrapT: 'repeat' }, this.filter, this.anisoExt);
        skyPlaneTextures.set(p.texture, texture);
      }
      skyPlanes.push(skyPlaneOf(p, texture));
    }

    this.scene = {
      textures,
      meshes,
      batches,
      items,
      blendItems: items.filter((i) => i.mesh.blended.length > 0),
      hasDecals: items.some((i) => i.mesh.decal.length > 0),
      hasBackground: items.some((i) => i.mesh.background.length > 0),
      lightingPresetCount: level.lighting?.presets.length ?? 0,
      edgeIndex: null,
      skyPlanes,
      skyPlaneTextures: [...skyPlaneTextures.values()],
      sky,
      skies,
      clearColor,
      levelClearColor: level.clearColor ? [level.clearColor[0] / 255, level.clearColor[1] / 255, level.clearColor[2] / 255] : null,
      backdrop: backdropOf(level.backdrop, textures),
    };
    this.lightingSetting = level.lighting?.default ?? 0;
    this.applyLightingColors();
  }

  /** Draw a frame. `highlight: false` leaves out the selection overlay (e.g. for a bug report's plain view). */
  render(camera: FlyCamera, options: { highlight?: boolean } = {}) {
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    this.dirty = false;
    let drawCalls = 0;
    gl.viewport(0, 0, canvas.width, canvas.height);
    const fog = this.fogEnabled && this.scene ? this.fog : null;
    // Background: the fog colour when authentic fog is on, else the game's own clear colour, else our default.
    const cc = fog
      ? [fog.color[0] / 255, fog.color[1] / 255, fog.color[2] / 255]
      : (this.scene?.levelClearColor ?? this.scene?.clearColor ?? [0.08, 0.09, 0.11]);
    gl.clearColor(cc[0], cc[1], cc[2], 1);
    this.setDepthWrite(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const scene = this.scene;
    if (!scene) {
      this.lastFrame = { drawCalls };
      return;
    }

    // Sky planes (clouds, water), before everything else: each pixel's view ray cast onto the plane.
    if (scene.skyPlanes.length > 0 && this.skyPlanesVisible) drawCalls += this.drawSkyPlanes(scene.skyPlanes, camera);

    // Screen-fixed backdrop picture, before the level.
    if (scene.backdrop && this.backdropVisible) {
      this.setDepthTest(false);
      this.setDepthWrite(false);
      this.setBlend(false);
      this.setCull(false);
      gl.useProgram(this.backdropProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, scene.backdrop.texture);
      gl.uniform4fv(this.uBackdropWindow, scene.backdrop.window);
      gl.uniform3fv(this.uBackdropTint, scene.backdrop.tint);
      gl.bindVertexArray(this.quadVao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      drawCalls++;
    }

    const logDepthCoef = 1 / Math.log2(camera.far + 1);
    camera.viewProjection(this.viewProj, canvas.width / Math.max(1, canvas.height));
    camera.viewMatrix(this.view);
    let P = this.main;
    let boundFog = 0;
    let boundModel: Mat4 | null = null;
    let boundMode = -1;
    let boundTextured = -1;
    let boundTex2 = -1;
    let boundTexMix = -1;
    // Switch to the main program or its cutaway variant: frame uniforms, and the per-draw uniform caches start over.
    const useMain = (next: MainProgram) => {
      P = next;
      gl.useProgram(P.program);
      gl.uniform1f(P.uLogDepthCoef, logDepthCoef);
      gl.uniform1f(P.uDepthBias, 0);
      gl.uniform1f(P.uOpacity, 1);
      gl.uniformMatrix4fv(P.uViewProj, false, this.viewProj);
      gl.uniformMatrix4fv(P.uView, false, this.view);
      gl.uniform1i(P.uFog, 0);
      if (fog) {
        gl.uniform3f(P.uFogColor, fog.color[0] / 255, fog.color[1] / 255, fog.color[2] / 255);
        gl.uniform1f(P.uFogNear, fog.near);
        gl.uniform1f(P.uFogFar, fog.far);
        gl.uniform1f(P.uFogMul, fog.multiplier);
        gl.uniform1f(P.uFogOffset, fog.offset);
      }
      boundFog = 0;
      boundModel = null;
      boundMode = -1;
      boundTextured = -1;
      boundTex2 = -1;
      boundTexMix = -1;
    };
    useMain(this.main);
    // Per-instance fog switch: instances the game draws unfogged keep fog factor 0.
    const fogFor = (item: DrawItem) => {
      const want = fog && !item.noFog ? 1 : 0;
      if (want !== boundFog) {
        gl.uniform1i(P.uFog, want);
        boundFog = want;
      }
    };
    gl.activeTexture(gl.TEXTURE0);

    let boundTexture: WebGLTexture | null = null;
    let boundTexture1: WebGLTexture | null = null;
    // Culling: 'toggle' = level geometry (the user's setting), 'game' = always as the batch says, 'never'.
    type CullPolicy = 'toggle' | 'game' | 'never';
    const draw = (b: GpuBatch, model: Mat4, depthTest: boolean, depthWrite: boolean, mirrored = false, policy: CullPolicy = 'toggle', forceBlend = false) => {
      this.setDepthTest(depthTest);
      this.setDepthWrite(depthWrite);
      this.setBlend(forceBlend || b.mode === Mode.Blend);
      const cull = b.forceCullBack || (policy === 'game' ? b.cullBack : policy === 'toggle' && this.cullingEnabled && b.cullBack);
      this.setCull(cull);
      if (cull) this.setMirroredWinding(mirrored);
      if (model !== boundModel) {
        gl.uniformMatrix4fv(P.uModel, false, model);
        boundModel = model;
      }
      if (b.mode !== boundMode) {
        gl.uniform1i(P.uMode, b.mode);
        boundMode = b.mode;
      }
      const textured = b.texture ? 1 : 0;
      if (textured !== boundTextured) {
        gl.uniform1i(P.uTextured, textured);
        boundTextured = textured;
      }
      if (b.texture && b.texture !== boundTexture) {
        gl.bindTexture(gl.TEXTURE_2D, b.texture);
        boundTexture = b.texture;
      }
      if (b.tex2 !== boundTex2) {
        gl.uniform1i(P.uTex2, b.tex2);
        boundTex2 = b.tex2;
      }
      if (b.tex2 !== 0) {
        if (b.texMix !== boundTexMix) {
          gl.uniform1f(P.uTexMix, b.texMix);
          boundTexMix = b.texMix;
        }
        if (b.texture1 !== boundTexture1) {
          gl.activeTexture(gl.TEXTURE0 + TEXTURE1_UNIT);
          gl.bindTexture(gl.TEXTURE_2D, b.texture1);
          gl.activeTexture(gl.TEXTURE0);
          boundTexture1 = b.texture1;
        }
      }
      gl.bindVertexArray(b.vao);
      gl.drawArrays(gl.TRIANGLES, 0, b.count);
      drawCalls++;
    };

    const showAnimated = this.showAnimated;
    const hidden = this.hiddenInstances;
    const opacity = this.instanceOpacity;

    // Cutaway, first pass (normal program): the depth of the nearest opaque/cutout surface per pixel (the surfaces that
    // write depth; faded instances are see-through and take no part).
    const peel = this.cutaway ? this.peelTarget(canvas.width, canvas.height) : null;
    if (peel) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, peel.fbo);
      this.setDepthWrite(true);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      for (const item of scene.items) {
        if ((item.animated && !showAnimated) || hidden?.has(item.index) || opacity?.has(item.index)) continue;
        for (const b of item.mesh.tested) draw(b, item.model, true, true, item.mirrored);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // Sky: drawn first around the camera, without depth or fog; Level.skies retain their game-authored culling.
    const [cx, cy, cz] = camera.position;
    if (scene.skies.length > 0) {
      // Level.skies positions are relative to the camera: only the camera rotation applies.
      const sel = this.skySelection;
      const active = sel === null ? null : (scene.skies.find((s) => s.name === sel) ?? scene.skies[0]);
      if (active) {
        mat4.translation(this.skyModel, cx, cy, cz);
        for (const b of active.batches) draw(b, this.skyModel, false, false, false, 'game');
      }
    } else {
      // Legacy dome: follows the camera, offset down by the ground height (see setSkyGroundHeight).
      mat4.translation(this.skyModel, cx, cy - this.skyGroundY, cz);
      for (const mesh of scene.sky) {
        for (const b of mesh.solid) draw(b, this.skyModel, false, false, false, 'never');
        for (const b of mesh.blended) draw(b, this.skyModel, false, false, false, 'never');
      }
    }

    // Cutaway, second pass: everything from here on keeps only what lies behind the first pass's surfaces.
    if (peel) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, peel.depth);
      gl.activeTexture(gl.TEXTURE0);
      this.cutawayProgram ??= createMainProgram(gl, true);
      useMain(this.cutawayProgram);
      gl.uniform1f(P.uPeelEpsilon, (CUTAWAY_EPSILON / Math.LN2) * logDepthCoef);
    }

    // Opaque and cutout geometry: first the batches without depth test or write (backdrops: drawn in instance order
    // they would paint over nearer geometry), then the depth-tested ones.
    if (scene.hasBackground) {
      for (const item of scene.items) {
        if ((item.animated && !showAnimated) || hidden?.has(item.index) || opacity?.has(item.index)) continue;
        fogFor(item);
        for (const b of item.mesh.background) draw(b, item.model, false, false, item.mirrored);
      }
    }
    for (const item of scene.items) {
      if ((item.animated && !showAnimated) || hidden?.has(item.index) || opacity?.has(item.index)) continue;
      fogFor(item);
      for (const b of item.mesh.tested) draw(b, item.model, b.depthTest, b.depthWrite, item.mirrored);
    }

    // Decals (RDP decal depth mode, e.g. floor markings): after the surfaces they lie on, pulled towards the camera.
    if (scene.hasDecals) {
      gl.uniform1f(P.uDepthBias, DECAL_DEPTH_BIAS);
      for (const item of scene.items) {
        if ((item.animated && !showAnimated) || hidden?.has(item.index) || opacity?.has(item.index)) continue;
        fogFor(item);
        for (const b of item.mesh.decal) draw(b, item.model, b.depthTest, false, item.mirrored);
      }
      gl.uniform1f(P.uDepthBias, 0);
    }

    // Blended geometry, back to front by instance origin.
    for (const item of scene.blendItems) {
      const dx = item.x - cx, dy = item.y - cy, dz = item.z - cz;
      item.dist = dx * dx + dy * dy + dz * dz;
    }
    scene.blendItems.sort((a, b) => b.dist - a.dist);
    for (const item of scene.blendItems) {
      if ((item.animated && !showAnimated) || hidden?.has(item.index) || opacity?.has(item.index)) continue;
      fogFor(item);
      for (const b of item.mesh.blended) draw(b, item.model, b.depthTest, false, item.mirrored);
    }

    // Faded instances: after everything else, blended, depth-tested but not written, so the level shows through.
    if (opacity) {
      for (const item of scene.items) {
        const alpha = opacity.get(item.index);
        // Fully faded: nothing to draw.
        if (alpha === undefined || alpha <= 0 || (item.animated && !showAnimated) || hidden?.has(item.index)) continue;
        fogFor(item);
        gl.uniform1f(P.uOpacity, alpha);
        for (const b of item.mesh.solid) draw(b, item.model, b.depthTest, false, item.mirrored, 'toggle', true);
        if (item.mesh.decal.length > 0) {
          gl.uniform1f(P.uDepthBias, DECAL_DEPTH_BIAS);
          for (const b of item.mesh.decal) draw(b, item.model, b.depthTest, false, item.mirrored, 'toggle', true);
          gl.uniform1f(P.uDepthBias, 0);
        }
        for (const b of item.mesh.blended) draw(b, item.model, b.depthTest, false, item.mirrored, 'toggle', true);
      }
      gl.uniform1f(P.uOpacity, 1);
    }

    if (peel) {
      // Unbind the depth texture: the next first pass renders into it (after the wireframes, which test against it).
      if (this.wireframe || this.collisionWireframe) drawCalls += this.drawWires(scene, logDepthCoef, true);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
    }

    if (!peel && (this.wireframe || this.collisionWireframe)) drawCalls += this.drawWires(scene, logDepthCoef, false);

    if (options.highlight !== false) drawCalls += this.drawHighlight(logDepthCoef);

    gl.bindVertexArray(null);
    this.lastFrame = { drawCalls };
  }

  dispose() {
    this.freeScene();
    this.freePeel();
    this.gl.deleteProgram(this.highlightProgram);
    this.gl.deleteVertexArray(this.highlightVao);
    this.gl.deleteBuffer(this.highlightBuffer);
    this.gl.deleteProgram(this.main.program);
    if (this.cutawayProgram) this.gl.deleteProgram(this.cutawayProgram.program);
    this.gl.deleteProgram(this.backdropProgram);
    this.gl.deleteVertexArray(this.quadVao);
    this.gl.deleteBuffer(this.quadBuffer);
    this.gl.deleteProgram(this.skyPlaneProgram);
    if (this.wireProgram) this.gl.deleteProgram(this.wireProgram.program);
    if (this.wireCutawayProgram) this.gl.deleteProgram(this.wireCutawayProgram.program);
  }

  /** The cutaway first-pass target at the canvas size (created or resized on demand); null if unsupported. */
  private peelTarget(width: number, height: number): NonNullable<LevelRenderer['peel']> | null {
    const gl = this.gl;
    let p = this.peel;
    if (p && p.width === width && p.height === height) return p;
    if (!p) {
      const fbo = gl.createFramebuffer();
      const depth = gl.createTexture();
      if (!fbo || !depth) return null;
      p = { fbo, depth, width: 0, height: 0 };
      this.peel = p;
    }
    // On unit 1, so the level texture bound to unit 0 stays as the draw loop expects.
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, p.depth);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT32F, width, height, 0, gl.DEPTH_COMPONENT, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, p.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, p.depth, 0);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!complete) {
      this.freePeel();
      return null;
    }
    p.width = width;
    p.height = height;
    return p;
  }

  private freePeel() {
    if (!this.peel) return;
    this.gl.deleteFramebuffer(this.peel.fbo);
    this.gl.deleteTexture(this.peel.depth);
    this.peel = null;
  }

  /** Level.skyPlanes as full-screen passes, without depth, blending, culling or fog. Returns the number of draw calls. */
  private drawSkyPlanes(planes: GpuSkyPlane[], camera: FlyCamera): number {
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    const aspect = canvas.width / Math.max(1, canvas.height);
    const tanY = Math.tan(camera.fovY / 2);
    const f = camera.forward();
    const r = camera.right();
    const u = vec3.cross(r, f);
    const [ex, ey, ez] = camera.position;
    const U = this.skyPlaneUniforms;
    this.setDepthTest(false);
    this.setDepthWrite(false);
    this.setBlend(false);
    this.setCull(false);
    gl.useProgram(this.skyPlaneProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(this.quadVao);
    gl.uniform3f(U.rayX, r[0] * tanY * aspect, r[1] * tanY * aspect, r[2] * tanY * aspect);
    gl.uniform3f(U.rayY, u[0] * tanY, u[1] * tanY, u[2] * tanY);
    let calls = 0;
    for (const p of planes) {
      const side = p.water ? -1 : 1;
      const rel = (p.height - ey) * side;
      if (!(rel > 0)) continue; // the eye is on the far side of the plane: the game draws nothing of it
      // The game casts the ray of screen row y through row y + offset (rows grow downwards): the ray shown at NDC y is
      // the unshifted ray of NDC y - offset.
      const o = -p.offsetNdc * tanY;
      gl.uniform3f(U.ray0, f[0] + u[0] * o, f[1] + u[1] * o, f[2] + u[2] * o);
      gl.uniform1f(U.side, side);
      gl.uniform1f(U.height, rel);
      gl.uniform2f(U.uvOrigin, fract(ex / p.uvScale), fract(ez / p.uvScale));
      gl.uniform1f(U.invUvScale, 1 / p.uvScale);
      gl.uniform3fv(U.color, p.color);
      gl.uniform3fv(U.horizon, p.horizon);
      gl.uniform1i(U.water, p.water ? 1 : 0);
      gl.bindTexture(gl.TEXTURE_2D, p.texture);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      calls++;
    }
    return calls;
  }

  /**
   * The wireframe overlays over the shaded scene: edges of the drawn level geometry, then of the collision layers (shown
   * or not). Returns the number of draw calls.
   */
  private drawWires(scene: Scene, logDepthCoef: number, cutaway: boolean): number {
    const gl = this.gl;
    const edges = this.edgeIndexFor(scene);
    if (!edges) return 0;
    const P = cutaway ? (this.wireCutawayProgram ??= createWireProgram(gl, true)) : (this.wireProgram ??= createWireProgram(gl, false));
    gl.useProgram(P.program);
    gl.uniformMatrix4fv(P.uViewProj, false, this.viewProj);
    gl.uniform1f(P.uLogDepthCoef, logDepthCoef);
    gl.uniform1f(P.uDepthBias, WIRE_DEPTH_BIAS);
    if (cutaway) gl.uniform1f(P.uPeelEpsilon, (CUTAWAY_EPSILON / Math.LN2) * logDepthCoef);
    this.setDepthTest(true);
    this.setDepthWrite(false);
    this.setBlend(true);
    this.setCull(false);
    const showAnimated = this.showAnimated;
    const hidden = this.hiddenInstances;
    const opacity = this.instanceOpacity;
    let calls = 0;
    let boundModel: Mat4 | null = null;
    const pass = (collision: boolean, color: readonly number[]) => {
      gl.uniform4f(P.uColor, color[0], color[1], color[2], color[3]);
      for (const item of scene.items) {
        if (item.collision !== collision) continue;
        // Level geometry as drawn; collision layers always.
        if (!collision && ((item.animated && !showAnimated) || hidden?.has(item.index) || opacity?.has(item.index))) continue;
        if (item.model !== boundModel) {
          gl.uniformMatrix4fv(P.uModel, false, item.model);
          boundModel = item.model;
        }
        for (const list of [item.mesh.solid, item.mesh.decal, item.mesh.blended]) {
          for (const b of list) {
            const count = Math.floor(b.count / 3) * 6;
            if (count === 0) continue;
            gl.bindVertexArray(b.vao);
            if (b.edges !== edges.buffer) {
              gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, edges.buffer); // stored in the batch's vertex array
              b.edges = edges.buffer;
            }
            gl.drawElements(gl.LINES, count, edges.type, 0);
            calls++;
          }
        }
      }
    };
    if (this.wireframe) pass(false, WIRE_COLOR);
    if (this.collisionWireframe) pass(true, COLLISION_WIRE_COLOR);
    return calls;
  }

  /** The shared edge index buffer: for triangle t (vertices 3t..3t+2) the lines 3t-3t+1, 3t+1-3t+2, 3t+2-3t. */
  private edgeIndexFor(scene: Scene): NonNullable<Scene['edgeIndex']> | null {
    if (scene.edgeIndex) return scene.edgeIndex;
    const gl = this.gl;
    let maxVertices = 0;
    for (const b of scene.batches) maxVertices = Math.max(maxVertices, b.count);
    const triangles = Math.floor(maxVertices / 3);
    if (triangles === 0) return null;
    const big = maxVertices > 65535;
    const indices = big ? new Uint32Array(triangles * 6) : new Uint16Array(triangles * 6);
    for (let t = 0, o = 0; t < triangles; t++) {
      const v = t * 3;
      indices[o++] = v;
      indices[o++] = v + 1;
      indices[o++] = v + 1;
      indices[o++] = v + 2;
      indices[o++] = v + 2;
      indices[o++] = v;
    }
    const buffer = gl.createBuffer();
    if (!buffer) return null;
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    scene.edgeIndex = { buffer, type: big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, triangles, bytes: indices.byteLength };
    return scene.edgeIndex;
  }

  /** The selection overlay, after the whole scene. Returns the number of draw calls. */
  private drawHighlight(logDepthCoef: number): number {
    const h = this.highlight;
    if (!h) return 0;
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    let calls = 0;
    gl.useProgram(this.highlightProgram);
    gl.uniformMatrix4fv(this.uHlViewProj, false, this.viewProj);
    gl.uniform1f(this.uHlLogDepthCoef, logDepthCoef);
    gl.uniform1f(this.uHlDepthBias, HIGHLIGHT_DEPTH_BIAS);
    gl.bindVertexArray(this.highlightVao);
    this.setCull(false);
    this.setBlend(true);
    this.setDepthWrite(false);
    // One CSS pixel in clip units (WebGL lines are one device pixel wide; offset copies make them bolder).
    const dpr = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;
    const sx = (2 * dpr) / Math.max(1, canvas.width);
    const sy = (2 * dpr) / Math.max(1, canvas.height);
    const [r, g, b] = h.color;
    if (h.fillCount > 0) {
      this.setDepthTest(false);
      gl.uniform2f(this.uHlOffset, 0, 0);
      gl.uniform4f(this.uHlColor, r, g, b, 0.4);
      gl.drawArrays(gl.TRIANGLES, 0, h.fillCount);
      calls++;
    }
    const lines = (offsets: number[][], rgba: [number, number, number, number]) => {
      gl.uniform4f(this.uHlColor, rgba[0], rgba[1], rgba[2], rgba[3]);
      for (const [ox, oy] of offsets) {
        gl.uniform2f(this.uHlOffset, ox * sx, oy * sy);
        gl.drawArrays(gl.LINES, h.fillCount, h.lineCount);
        calls++;
      }
    };
    if (h.lineCount > 0) {
      // A dark halo and a dimmed line everywhere (also through walls), then the unoccluded part at full strength.
      this.setDepthTest(false);
      lines(HALO_OFFSETS, [0, 0, 0, 0.5]);
      lines(CORE_OFFSETS, [r, g, b, 0.55]);
      this.setDepthTest(true);
      lines(CORE_OFFSETS, [r, g, b, 1]);
    }
    return calls;
  }

  private uploadBatch(b: Batch, textures: WebGLTexture[]): GpuBatch | null {
    const count = Math.floor(b.positions.length / 3);
    if (count < 3) return null;
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('createVertexArray failed');
    gl.bindVertexArray(vao);
    const buffers: WebGLBuffer[] = [];
    const buffer = (data: ArrayBufferView) => {
      const buf = gl.createBuffer();
      if (!buf) throw new Error('createBuffer failed');
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      buffers.push(buf);
      return buf;
    };
    const attrib = (location: number, data: ArrayBufferView, size: number, type: number, normalized: boolean) => {
      const buf = buffer(data);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, type, normalized, 0, 0);
      return buf;
    };
    attrib(0, b.positions, 3, gl.FLOAT, false);
    const textured = b.texture >= 0 && b.texture < textures.length && b.uvs.length >= count * 2;
    if (textured) attrib(1, b.uvs, 2, gl.FLOAT, false);
    else gl.vertexAttrib2f(1, 0, 0);
    const colorBuffer = b.colors.length >= count * 4 ? attrib(2, b.colors, 4, gl.UNSIGNED_BYTE, true) : null;
    if (!colorBuffer) gl.vertexAttrib4f(2, 1, 1, 1, 1);
    const unlitColorBuffer = (b.unlitColors?.length ?? 0) >= count * 4 ? buffer(b.unlitColors!) : null;
    const lightingColorBuffers = (b.lightingColors ?? []).filter((colors) => colors.length >= count * 4).map(buffer);
    const texture1 = textured && b.texture1 !== undefined && b.texture1 >= 0 && b.texture1 < textures.length && (b.uvs1?.length ?? 0) >= count * 2 ? textures[b.texture1] : null;
    if (texture1) attrib(3, b.uvs1!, 2, gl.FLOAT, false);
    gl.bindVertexArray(null);
    return {
      vao,
      buffers,
      count,
      texture: textured ? textures[b.texture] : null,
      texture1,
      tex2: texture1 ? (b.texBlend === 'multiply' ? 2 : 1) : 0,
      texMix: texture1 && b.texBlend !== 'multiply' ? Math.min(1, Math.max(0, b.texMix ?? 0)) : 0,
      mode: b.blend === 'blend' ? Mode.Blend : b.blend === 'cutout' ? Mode.Cutout : Mode.Opaque,
      depthTest: b.depthTest,
      depthWrite: b.depthWrite,
      cullBack: b.cullBack === true,
      forceCullBack: b.forceCullBack === true,
      decal: b.decal === true,
      colorBuffer,
      unlitColorBuffer,
      lightingColorBuffers,
      edges: null,
    };
  }

  private applyLightingColors() {
    const scene = this.scene;
    if (!scene || scene.lightingPresetCount === 0) return;
    const gl = this.gl;
    for (const b of scene.batches) {
      const color = this.lightingSetting === null
        ? (b.unlitColorBuffer ?? b.colorBuffer)
        : (b.lightingColorBuffers[this.lightingSetting] ?? b.colorBuffer);
      if (!color) continue;
      gl.bindVertexArray(b.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, color);
      gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 0, 0);
    }
    gl.bindVertexArray(null);
  }

  private freeScene() {
    const scene = this.scene;
    if (!scene) return;
    const gl = this.gl;
    for (const b of scene.batches) {
      gl.deleteVertexArray(b.vao);
      for (const buf of b.buffers) gl.deleteBuffer(buf);
    }
    for (const t of scene.textures) gl.deleteTexture(t);
    for (const t of scene.skyPlaneTextures) gl.deleteTexture(t);
    if (scene.edgeIndex) gl.deleteBuffer(scene.edgeIndex.buffer);
    this.scene = null;
  }

  private setDepthTest(on: boolean) {
    if (this.stDepthTest === on) return;
    if (on) this.gl.enable(this.gl.DEPTH_TEST);
    else this.gl.disable(this.gl.DEPTH_TEST);
    this.stDepthTest = on;
  }

  private setDepthWrite(on: boolean) {
    if (this.stDepthWrite === on) return;
    this.gl.depthMask(on);
    this.stDepthWrite = on;
  }

  private setCull(on: boolean) {
    if (this.stCull === on) return;
    if (on) this.gl.enable(this.gl.CULL_FACE);
    else this.gl.disable(this.gl.CULL_FACE);
    this.stCull = on;
  }

  /** Front faces are counter-clockwise; a mirrored model matrix (negative determinant) flips that to clockwise. */
  private setMirroredWinding(mirrored: boolean) {
    if (this.stMirrored === mirrored) return;
    this.gl.frontFace(mirrored ? this.gl.CW : this.gl.CCW);
    this.stMirrored = mirrored;
  }

  private setBlend(on: boolean) {
    if (this.stBlend === on) return;
    if (on) this.gl.enable(this.gl.BLEND);
    else this.gl.disable(this.gl.BLEND);
    this.stBlend = on;
  }
}

function emptyMesh(): GpuMesh {
  return { solid: [], background: [], tested: [], decal: [], blended: [] };
}

function skyPlaneOf(p: SkyPlane, texture: WebGLTexture): GpuSkyPlane {
  const unit = (c: readonly number[]): [number, number, number] => [c[0] / 255, c[1] / 255, c[2] / 255];
  return {
    texture,
    water: p.combine === 'water',
    height: p.height,
    uvScale: p.uvScale,
    color: unit(p.color),
    horizon: unit(p.horizon),
    offsetNdc: (p.horizonOffset ?? 0) / SKY_OFFSET_ROWS_PER_NDC,
  };
}

function fract(x: number): number {
  return x - Math.floor(x);
}

function backdropOf(b: Backdrop | undefined, textures: WebGLTexture[]): Scene['backdrop'] {
  if (!b || b.texture < 0 || b.texture >= textures.length) return null;
  const tint = b.tint ?? [255, 255, 255];
  return { texture: textures[b.texture], window: [b.u0, b.v0, b.u1, b.v1], tint: [tint[0] / 255, tint[1] / 255, tint[2] / 255] };
}

/** Average color along the lowest ring of the sky dome, used as the clear color below it. */
function horizonColor(mesh: Mesh, level: Level): [number, number, number] | null {
  let minY = Infinity, maxY = -Infinity;
  for (const b of mesh.batches) {
    for (let i = 1; i < b.positions.length; i += 3) {
      minY = Math.min(minY, b.positions[i]);
      maxY = Math.max(maxY, b.positions[i]);
    }
  }
  if (!Number.isFinite(minY)) return null;
  const limit = minY + (maxY - minY) * 0.02;
  let r = 0, g = 0, bl = 0, n = 0;
  for (const b of mesh.batches) {
    const tint = averageTextureColor(level.textures[b.texture]);
    for (let v = 0; v * 3 < b.positions.length; v++) {
      if (b.positions[v * 3 + 1] > limit || b.colors.length < (v + 1) * 4) continue;
      r += b.colors[v * 4] * tint[0];
      g += b.colors[v * 4 + 1] * tint[1];
      bl += b.colors[v * 4 + 2] * tint[2];
      n++;
    }
  }
  return n > 0 ? [r / n / 255, g / n / 255, bl / n / 255] : null;
}

function averageTextureColor(tex: Level['textures'][number] | undefined): [number, number, number] {
  if (!tex || tex.rgba.length < 4) return [1, 1, 1];
  let r = 0, g = 0, b = 0;
  const n = Math.floor(tex.rgba.length / 4);
  for (let i = 0; i < n * 4; i += 4) {
    r += tex.rgba[i];
    g += tex.rgba[i + 1];
    b += tex.rgba[i + 2];
  }
  return [r / n / 255, g / n / 255, b / n / 255];
}

/** Determinant of the upper-left 3x3 of a column-major 4x4 matrix. */
function det3(m: Mat4): number {
  return (
    m[0] * (m[5] * m[10] - m[6] * m[9]) -
    m[4] * (m[1] * m[10] - m[2] * m[9]) +
    m[8] * (m[1] * m[6] - m[2] * m[5])
  );
}
