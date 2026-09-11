// Free-fly camera: position + yaw/pitch. Y is up; yaw 0 looks down -Z, positive yaw turns right.
import { clamp, mat4, vec3, type Mat4, type Vec3 } from './math';

const MAX_PITCH = (89 * Math.PI) / 180;

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

export class FlyCamera {
  position: Vec3 = [0, 0, 0];
  yaw = 0;
  pitch = 0;
  fovY = (60 * Math.PI) / 180;
  /** Clip planes. The depth buffer is logarithmic, so a small near plane costs no precision; far is set per level. */
  near = 0.2;
  far = 50000;
  /** Base movement speed in world units per second. */
  speed = 500;

  forward(): Vec3 {
    const cp = Math.cos(this.pitch);
    return [Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }

  right(): Vec3 {
    return [Math.cos(this.yaw), 0, Math.sin(this.yaw)];
  }

  rotate(dYaw: number, dPitch: number) {
    this.yaw = (this.yaw + dYaw) % (Math.PI * 2);
    this.pitch = clamp(this.pitch + dPitch, -MAX_PITCH, MAX_PITCH);
  }

  lookAt(target: Vec3) {
    const d = vec3.sub(target, this.position);
    this.yaw = Math.atan2(d[0], -d[2]);
    this.pitch = clamp(Math.atan2(d[1], Math.hypot(d[0], d[2])), -MAX_PITCH, MAX_PITCH);
  }

  viewMatrix(out: Mat4): Mat4 {
    const f = this.forward();
    const r = this.right();
    const u = vec3.cross(r, f);
    const p = this.position;
    out.set([
      r[0], u[0], -f[0], 0,
      r[1], u[1], -f[1], 0,
      r[2], u[2], -f[2], 0,
      -vec3.dot(r, p), -vec3.dot(u, p), vec3.dot(f, p), 1,
    ]);
    return out;
  }

  viewProjection(out: Mat4, aspect: number): Mat4 {
    const proj = mat4.perspective(mat4.create(), this.fovY, aspect, this.near, this.far);
    return mat4.multiply(out, proj, this.viewMatrix(mat4.create()));
  }
}
