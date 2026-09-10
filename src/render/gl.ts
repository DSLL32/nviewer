// Small WebGL2 helpers: program compilation and texture upload.
import type { Texture, WrapMode } from '../rom';

export function createProgram(gl: WebGL2RenderingContext, vsSource: string, fsSource: string): WebGLProgram {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('createShader failed');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compile error: ${log}`);
    }
    return shader;
  };
  const vs = compile(gl.VERTEX_SHADER, vsSource);
  const fs = compile(gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  if (!program) throw new Error('createProgram failed');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error: ${log}`);
  }
  return program;
}

function wrapEnum(gl: WebGL2RenderingContext, mode: WrapMode): number {
  switch (mode) {
    case 'mirror': return gl.MIRRORED_REPEAT;
    case 'clamp': return gl.CLAMP_TO_EDGE;
    default: return gl.REPEAT;
  }
}

export interface TextureFilter {
  nearest: boolean;
  anisotropy: number; // 1 = off
}

export function applyTextureFilter(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  filter: TextureFilter,
  anisoExt: EXT_texture_filter_anisotropic | null,
) {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter.nearest ? gl.NEAREST : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter.nearest ? gl.NEAREST_MIPMAP_LINEAR : gl.LINEAR_MIPMAP_LINEAR);
  if (anisoExt) {
    gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, filter.nearest ? 1 : filter.anisotropy);
  }
}

export function uploadTexture(
  gl: WebGL2RenderingContext,
  tex: Texture,
  filter: TextureFilter,
  anisoExt: EXT_texture_filter_anisotropic | null,
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('createTexture failed');
  const w = Math.max(1, tex.width | 0);
  const h = Math.max(1, tex.height | 0);
  let pixels = tex.rgba;
  if (pixels.length !== w * h * 4) {
    // Defensive: never hand WebGL a short buffer.
    const fixed = new Uint8Array(w * h * 4);
    fixed.set(pixels.subarray(0, fixed.length));
    pixels = fixed;
  }
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapEnum(gl, tex.wrapS));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapEnum(gl, tex.wrapT));
  gl.generateMipmap(gl.TEXTURE_2D);
  applyTextureFilter(gl, texture, filter, anisoExt);
  return texture;
}
