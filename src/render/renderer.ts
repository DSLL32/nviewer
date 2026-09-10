// WebGL2 level renderer: uploads a parsed Level once, then draws sky, opaque/cutout and blended passes.
import type { Batch, Fog, Level, Mesh } from '../rom';
import type { FlyCamera } from './camera';
import { applyTextureFilter, createProgram, uploadTexture, type TextureFilter } from './gl';
import { mat4, type Mat4 } from './math';

const VS = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec2 aUv;
layout(location = 2) in vec4 aColor;
uniform mat4 uViewProj;
uniform mat4 uView;
uniform mat4 uModel;
out vec2 vUv;
out vec4 vColor;
out highp float vDepth; // positive view-space depth (along the view axis), world units
void main() {
  vUv = aUv;
  vColor = aColor;
  vec4 world = uModel * vec4(aPosition, 1.0);
  vDepth = -(uView * world).z;
  gl_Position = uViewProj * world;
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uTexture;
uniform bool uTextured;
uniform int uMode; // 0 opaque, 1 cutout, 2 blend
// N64 RSP fog (gSPFogPosition): zndc from the game's fog projection near/far, then (zndc * mul + offset) / 255.
uniform bool uFog;
uniform vec3 uFogColor;
uniform highp float uFogNear;
uniform highp float uFogFar;
uniform highp float uFogMul;
uniform highp float uFogOffset;
in vec2 vUv;
in vec4 vColor;
in highp float vDepth;
out vec4 outColor;
void main() {
  vec4 c = vColor;
  if (uTextured) c *= texture(uTexture, vUv);
  if (uMode == 1 && c.a < 0.5) discard;
  if (uMode == 0) c.a = 1.0;
  if (uFog) {
    highp float d = max(vDepth, 1e-3);
    highp float range = uFogFar - uFogNear;
    highp float zndc = (uFogFar + uFogNear) / range - 2.0 * uFogFar * uFogNear / (range * d);
    highp float f = clamp((zndc * uFogMul + uFogOffset) / 255.0, 0.0, 1.0);
    c.rgb = mix(c.rgb, uFogColor, f);
  }
  outColor = c;
}`;

const enum Mode { Opaque = 0, Cutout = 1, Blend = 2 }

interface GpuBatch {
  vao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  count: number;
  texture: WebGLTexture | null;
  mode: Mode;
  depthTest: boolean;
  depthWrite: boolean;
  cullBack: boolean;
}

interface GpuMesh {
  solid: GpuBatch[]; // opaque + cutout, in display-list order
  blended: GpuBatch[];
}

interface DrawItem {
  mesh: GpuMesh;
  model: Mat4;
  animated: boolean;
  mirrored: boolean; // negative determinant: winding is flipped
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
  sky: GpuMesh[];
  clearColor: [number, number, number];
}

const DEFAULT_CLEAR: [number, number, number] = [0.46, 0.64, 0.86];

export interface FrameStats {
  drawCalls: number;
}

export class LevelRenderer {
  readonly gl: WebGL2RenderingContext;
  /** Set when something other than the camera changed and a redraw is needed. */
  dirty = true;
  lastFrame: FrameStats = { drawCalls: 0 };
  private showAnimated = true;
  private fog: Fog | null = null;
  private fogEnabled = false;
  private cullingEnabled = false;
  private skyGroundY = 0;

  private readonly program: WebGLProgram;
  private readonly uViewProj: WebGLUniformLocation | null;
  private readonly uModel: WebGLUniformLocation | null;
  private readonly uTextured: WebGLUniformLocation | null;
  private readonly uMode: WebGLUniformLocation | null;
  private readonly uView: WebGLUniformLocation | null;
  private readonly uFog: WebGLUniformLocation | null;
  private readonly uFogColor: WebGLUniformLocation | null;
  private readonly uFogNear: WebGLUniformLocation | null;
  private readonly uFogFar: WebGLUniformLocation | null;
  private readonly uFogMul: WebGLUniformLocation | null;
  private readonly uFogOffset: WebGLUniformLocation | null;
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
    this.program = createProgram(gl, VS, FS);
    this.uViewProj = gl.getUniformLocation(this.program, 'uViewProj');
    this.uModel = gl.getUniformLocation(this.program, 'uModel');
    this.uTextured = gl.getUniformLocation(this.program, 'uTextured');
    this.uMode = gl.getUniformLocation(this.program, 'uMode');
    this.uView = gl.getUniformLocation(this.program, 'uView');
    this.uFog = gl.getUniformLocation(this.program, 'uFog');
    this.uFogColor = gl.getUniformLocation(this.program, 'uFogColor');
    this.uFogNear = gl.getUniformLocation(this.program, 'uFogNear');
    this.uFogFar = gl.getUniformLocation(this.program, 'uFogFar');
    this.uFogMul = gl.getUniformLocation(this.program, 'uFogMul');
    this.uFogOffset = gl.getUniformLocation(this.program, 'uFogOffset');
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, 'uTexture'), 0);
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
    for (const t of this.scene?.textures ?? []) applyTextureFilter(this.gl, t, this.filter, this.anisoExt);
    this.dirty = true;
  }

  /** Toggle the game's own distance fog (only has an effect when the level defines fog). */
  setFogEnabled(enabled: boolean) {
    if (this.fogEnabled === enabled) return;
    this.fogEnabled = enabled;
    this.dirty = true;
  }

  /** Cull back faces of batches flagged cullBack (the game's own setting). Off: both sides are drawn. */
  setBackfaceCulling(enabled: boolean) {
    if (this.cullingEnabled === enabled) return;
    this.cullingEnabled = enabled;
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

  setLevel(level: Level | null) {
    this.freeScene();
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
        mesh = { solid: [], blended: [] };
        for (const b of src.batches) {
          const gb = this.uploadBatch(b, textures);
          if (!gb) continue;
          batches.push(gb);
          (gb.mode === Mode.Blend ? mesh.blended : mesh.solid).push(gb);
        }
        meshes.set(index, mesh);
      }
      return mesh;
    };

    const items: DrawItem[] = [];
    for (const inst of level.instances) {
      if (inst.mesh < 0) continue;
      const mesh = getMesh(inst.mesh);
      if (!mesh) continue;
      const m = inst.matrix;
      items.push({ mesh, model: m, animated: inst.animated === true, mirrored: det3(m) < 0, x: m[12], y: m[13], z: m[14], dist: 0 });
    }

    const sky: GpuMesh[] = [];
    let clearColor = DEFAULT_CLEAR;
    for (const index of level.unplaced) {
      const src = level.meshes[index];
      if (!src || !src.name.endsWith('SKY')) continue;
      const mesh = getMesh(index);
      if (mesh) sky.push(mesh);
      clearColor = horizonColor(src, level) ?? clearColor;
    }

    this.scene = {
      textures,
      meshes,
      batches,
      items,
      blendItems: items.filter((i) => i.mesh.blended.length > 0),
      sky,
      clearColor,
    };
  }

  render(camera: FlyCamera) {
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    this.dirty = false;
    let drawCalls = 0;
    gl.viewport(0, 0, canvas.width, canvas.height);
    const fog = this.fogEnabled && this.scene ? this.fog : null;
    const cc = fog ? [fog.color[0] / 255, fog.color[1] / 255, fog.color[2] / 255] : (this.scene?.clearColor ?? [0.08, 0.09, 0.11]);
    gl.clearColor(cc[0], cc[1], cc[2], 1);
    this.setDepthWrite(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const scene = this.scene;
    if (!scene) {
      this.lastFrame = { drawCalls };
      return;
    }

    gl.useProgram(this.program);
    camera.viewProjection(this.viewProj, canvas.width / Math.max(1, canvas.height));
    gl.uniformMatrix4fv(this.uViewProj, false, this.viewProj);
    gl.uniformMatrix4fv(this.uView, false, camera.viewMatrix(this.view));
    gl.uniform1i(this.uFog, 0);
    if (fog) {
      gl.uniform3f(this.uFogColor, fog.color[0] / 255, fog.color[1] / 255, fog.color[2] / 255);
      gl.uniform1f(this.uFogNear, fog.near);
      gl.uniform1f(this.uFogFar, fog.far);
      gl.uniform1f(this.uFogMul, fog.multiplier);
      gl.uniform1f(this.uFogOffset, fog.offset);
    }
    gl.activeTexture(gl.TEXTURE0);

    let boundModel: Mat4 | null = null;
    let boundMode = -1;
    let boundTextured = -1;
    let boundTexture: WebGLTexture | null = null;
    const draw = (b: GpuBatch, model: Mat4, depthTest: boolean, depthWrite: boolean, mirrored = false, allowCull = true) => {
      this.setDepthTest(depthTest);
      this.setDepthWrite(depthWrite);
      this.setBlend(b.mode === Mode.Blend);
      const cull = allowCull && this.cullingEnabled && b.cullBack;
      this.setCull(cull);
      if (cull) this.setMirroredWinding(mirrored);
      if (model !== boundModel) {
        gl.uniformMatrix4fv(this.uModel, false, model);
        boundModel = model;
      }
      if (b.mode !== boundMode) {
        gl.uniform1i(this.uMode, b.mode);
        boundMode = b.mode;
      }
      const textured = b.texture ? 1 : 0;
      if (textured !== boundTextured) {
        gl.uniform1i(this.uTextured, textured);
        boundTextured = textured;
      }
      if (b.texture && b.texture !== boundTexture) {
        gl.bindTexture(gl.TEXTURE_2D, b.texture);
        boundTexture = b.texture;
      }
      gl.bindVertexArray(b.vao);
      gl.drawArrays(gl.TRIANGLES, 0, b.count);
      drawCalls++;
    };

    // Sky dome: follows the camera, drawn first, no depth.
    const [cx, cy, cz] = camera.position;
    mat4.translation(this.skyModel, cx, cy - this.skyGroundY, cz);
    for (const mesh of scene.sky) {
      // Never culled: the dome is seen from inside.
      for (const b of mesh.solid) draw(b, this.skyModel, false, false, false, false);
      for (const b of mesh.blended) draw(b, this.skyModel, false, false, false, false);
    }

    // Everything after the (unfogged) sky gets the game's fog when enabled.
    if (fog) gl.uniform1i(this.uFog, 1);

    // Opaque and cutout geometry.
    const showAnimated = this.showAnimated;
    for (const item of scene.items) {
      if (item.animated && !showAnimated) continue;
      for (const b of item.mesh.solid) draw(b, item.model, b.depthTest, b.depthWrite, item.mirrored);
    }

    // Blended geometry, back to front by instance origin.
    for (const item of scene.blendItems) {
      const dx = item.x - cx, dy = item.y - cy, dz = item.z - cz;
      item.dist = dx * dx + dy * dy + dz * dz;
    }
    scene.blendItems.sort((a, b) => b.dist - a.dist);
    for (const item of scene.blendItems) {
      if (item.animated && !showAnimated) continue;
      for (const b of item.mesh.blended) draw(b, item.model, b.depthTest, false, item.mirrored);
    }

    gl.bindVertexArray(null);
    this.lastFrame = { drawCalls };
  }

  dispose() {
    this.freeScene();
    this.gl.deleteProgram(this.program);
  }

  private uploadBatch(b: Batch, textures: WebGLTexture[]): GpuBatch | null {
    const count = Math.floor(b.positions.length / 3);
    if (count < 3) return null;
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('createVertexArray failed');
    gl.bindVertexArray(vao);
    const buffers: WebGLBuffer[] = [];
    const attrib = (location: number, data: ArrayBufferView, size: number, type: number, normalized: boolean) => {
      const buf = gl.createBuffer();
      if (!buf) throw new Error('createBuffer failed');
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, type, normalized, 0, 0);
      buffers.push(buf);
    };
    attrib(0, b.positions, 3, gl.FLOAT, false);
    const textured = b.texture >= 0 && b.texture < textures.length && b.uvs.length >= count * 2;
    if (textured) attrib(1, b.uvs, 2, gl.FLOAT, false);
    else gl.vertexAttrib2f(1, 0, 0);
    if (b.colors.length >= count * 4) attrib(2, b.colors, 4, gl.UNSIGNED_BYTE, true);
    else gl.vertexAttrib4f(2, 1, 1, 1, 1);
    gl.bindVertexArray(null);
    return {
      vao,
      buffers,
      count,
      texture: textured ? textures[b.texture] : null,
      mode: b.blend === 'blend' ? Mode.Blend : b.blend === 'cutout' ? Mode.Cutout : Mode.Opaque,
      depthTest: b.depthTest,
      depthWrite: b.depthWrite,
      cullBack: b.cullBack === true,
    };
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
