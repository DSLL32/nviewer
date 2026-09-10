// Spectator-style input: pointer-lock mouse look, WASD fly, wheel speed.
import type { FlyCamera } from './camera';
import { clamp, vec3, type Vec3 } from './math';

export type ControlAction = 'reset' | 'toggle-filter' | 'toggle-help';

export interface ControlsCallbacks {
  onSpeedChange(speed: number): void;
  onLockChange(locked: boolean): void;
  onAction(action: ControlAction): void;
}

const LOOK_SENSITIVITY = 0.0022; // radians per mouse pixel
const KEY_TURN_RATE = 1.8; // radians per second for arrow-key looking
const FAST_MULTIPLIER = 5;
export const MIN_SPEED = 5;
export const MAX_SPEED = 20000;

const FORWARD = ['KeyW'];
const BACK = ['KeyS'];
const LEFT = ['KeyA'];
const RIGHT = ['KeyD'];
const UP = ['Space', 'KeyE'];
const DOWN = ['KeyC', 'KeyQ', 'ControlLeft', 'ControlRight'];
const TURN_LEFT = ['ArrowLeft'];
const TURN_RIGHT = ['ArrowRight'];
const LOOK_UP = ['ArrowUp'];
const LOOK_DOWN = ['ArrowDown'];
const FAST = ['ShiftLeft', 'ShiftRight'];
const HELD_KEYS = new Set([...FORWARD, ...BACK, ...LEFT, ...RIGHT, ...UP, ...DOWN, ...TURN_LEFT, ...TURN_RIGHT, ...LOOK_UP, ...LOOK_DOWN, ...FAST]);

export class FlyControls {
  private keys = new Set<string>();
  private changed = false;
  private dragging = false;
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: FlyCamera;
  private readonly cb: ControlsCallbacks;

  constructor(canvas: HTMLCanvasElement, camera: FlyCamera, cb: ControlsCallbacks) {
    this.canvas = canvas;
    this.camera = camera;
    this.cb = cb;
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('pointerlockchange', this.onLockChange);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  dispose() {
    const c = this.canvas;
    c.removeEventListener('mousedown', this.onMouseDown);
    c.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    if (document.pointerLockElement === c) document.exitPointerLock();
  }

  get locked() {
    return document.pointerLockElement === this.canvas;
  }

  /** Keys drive the camera only while the mouse is captured or the canvas has focus. */
  get active() {
    return this.locked || document.activeElement === this.canvas;
  }

  setSpeed(speed: number) {
    this.camera.speed = clamp(speed, MIN_SPEED, MAX_SPEED);
    this.cb.onSpeedChange(this.camera.speed);
  }

  /** Mark the view as changed (e.g. after an external camera edit). */
  invalidate() {
    this.changed = true;
  }

  /** Advance by dt seconds. Returns true when the view changed since the last call. */
  update(dt: number): boolean {
    const has = (codes: string[]) => codes.some((c) => this.keys.has(c));
    const cam = this.camera;
    let moved = this.changed;
    this.changed = false;

    // Arrow keys look around (same pitch clamp as mouse look, applied in FlyCamera.rotate).
    const turn = (has(TURN_RIGHT) ? 1 : 0) - (has(TURN_LEFT) ? 1 : 0);
    const look = (has(LOOK_UP) ? 1 : 0) - (has(LOOK_DOWN) ? 1 : 0);
    if (turn !== 0 || look !== 0) {
      cam.rotate(turn * KEY_TURN_RATE * dt, look * KEY_TURN_RATE * dt);
      moved = true;
    }

    const f = cam.forward();
    const r = cam.right();
    let dir: Vec3 = [0, 0, 0];
    if (has(FORWARD)) dir = vec3.add(dir, f);
    if (has(BACK)) dir = vec3.sub(dir, f);
    if (has(RIGHT)) dir = vec3.add(dir, r);
    if (has(LEFT)) dir = vec3.sub(dir, r);
    if (has(UP)) dir[1] += 1;
    if (has(DOWN)) dir[1] -= 1;
    if (vec3.length(dir) > 1e-6) {
      const speed = cam.speed * (has(FAST) ? FAST_MULTIPLIER : 1);
      cam.position = vec3.add(cam.position, vec3.scale(vec3.normalize(dir), speed * dt));
      moved = true;
    }
    return moved;
  }

  private onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    this.canvas.focus();
    this.dragging = true;
    if (!this.locked) {
      try {
        // Returns a promise in current browsers; a refusal (e.g. sandboxed iframe) falls back to drag-look.
        const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        p?.catch?.(() => {});
      } catch {
        /* drag-look still works */
      }
    }
  };

  private onMouseUp = () => {
    this.dragging = false;
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked && !this.dragging) return;
    // Some browsers report a spurious huge delta right after locking.
    const dx = clamp(e.movementX, -300, 300);
    const dy = clamp(e.movementY, -300, 300);
    if (dx === 0 && dy === 0) return;
    this.camera.rotate(dx * LOOK_SENSITIVITY, -dy * LOOK_SENSITIVITY);
    this.changed = true;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.deltaY === 0) return;
    this.setSpeed(this.camera.speed * Math.pow(1.2, -Math.sign(e.deltaY)));
  };

  private onLockChange = () => {
    if (!this.locked) this.keys.clear();
    this.cb.onLockChange(this.locked);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.active || e.metaKey || e.altKey) return;
    if (HELD_KEYS.has(e.code)) {
      this.keys.add(e.code);
      e.preventDefault(); // stop page scrolling on Space/arrows and Ctrl+letter shortcuts where possible
      return;
    }
    if (e.repeat || e.ctrlKey) return;
    const action: ControlAction | null =
      e.code === 'KeyR' ? 'reset' : e.code === 'KeyF' ? 'toggle-filter' : e.code === 'KeyH' ? 'toggle-help' : null;
    if (action) {
      e.preventDefault();
      this.cb.onAction(action);
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onBlur = () => {
    this.keys.clear();
    this.dragging = false;
  };
}
