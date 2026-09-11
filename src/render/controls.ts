// Camera input: pointer-lock free fly (mouse look, WASD, wheel speed) or a side-scroller view (pan in X/Y,
// zoom in Z, no rotation); Ctrl/Alt + click picks for bug reports in both.
import type { FlyCamera } from './camera';
import { clamp, vec3, type Vec3 } from './math';

export type ControlAction = 'reset' | 'toggle-wireframe' | 'toggle-collision-wireframe' | 'toggle-help' | 'toggle-view' | 'toggle-cutaway';

/** Holding Ctrl picks whole objects (instances), holding Alt picks single triangles. */
export type PickMode = 'object' | 'face';

/** Side view: the eye pans in X/Y within bounds and moves in Z (distance from the Z = 0 plane) to zoom. */
export interface SideViewLimits {
  bounds: { min: [number, number]; max: [number, number] };
  minDistance: number;
  maxDistance: number;
}

export interface ControlsCallbacks {
  onSpeedChange(speed: number): void;
  onLockChange(locked: boolean): void;
  onAction(action: ControlAction): void;
  onPickModeChange(mode: PickMode | null): void;
  onPick(mode: PickMode, clientX: number, clientY: number): void;
}

const LOOK_SENSITIVITY = 0.0022; // radians per mouse pixel
const KEY_TURN_RATE = 1.8; // radians per second for arrow-key looking
const FAST_MULTIPLIER = 5;
export const MIN_SPEED = 0.5;
export const MAX_SPEED = 100000;

const SIDE_PAN_RATE = 1.5; // screen heights per second
const SIDE_ZOOM_RATE = 1.2; // e-folds of distance per second
const SIDE_FAST = 4;
const SIDE_WHEEL_STEP = 1.15;

const FORWARD = ['KeyW'];
const BACK = ['KeyS'];
const LEFT = ['KeyA'];
const RIGHT = ['KeyD'];
const UP = ['Space', 'KeyE'];
const DOWN = ['KeyC', 'KeyQ'];
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
  private hover = false;
  private ctrlHeld = false;
  private altHeld = false;
  private mode: PickMode | null = null;
  private side: SideViewLimits | null = null;
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: FlyCamera;
  private readonly cb: ControlsCallbacks;

  constructor(canvas: HTMLCanvasElement, camera: FlyCamera, cb: ControlsCallbacks) {
    this.canvas = canvas;
    this.camera = camera;
    this.cb = cb;
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('pointerenter', this.onPointerEnter);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('pointerlockchange', this.onLockChange);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onBlur);
  }

  dispose() {
    const c = this.canvas;
    c.removeEventListener('mousedown', this.onMouseDown);
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('pointerenter', this.onPointerEnter);
    c.removeEventListener('pointerleave', this.onPointerLeave);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onBlur);
    if (document.pointerLockElement === c) document.exitPointerLock();
  }

  get locked() {
    return document.pointerLockElement === this.canvas;
  }

  /** Keys drive the camera only while the mouse is captured or the canvas has focus. */
  get active() {
    return this.locked || document.activeElement === this.canvas;
  }

  get pickMode(): PickMode | null {
    return this.mode;
  }

  /** Whether the side-scroller view is active (else free fly). */
  get sideView(): boolean {
    return this.side !== null;
  }

  setSpeed(speed: number) {
    this.camera.speed = clamp(speed, MIN_SPEED, MAX_SPEED);
    this.cb.onSpeedChange(this.camera.speed);
  }

  /**
   * Switch to the side view with these limits, or back to free fly (null). The side view never rotates and never
   * captures the mouse; entering it levels the camera and clamps the eye.
   */
  setSideView(limits: SideViewLimits | null) {
    this.side = limits;
    this.dragging = false;
    if (limits) {
      if (this.locked) document.exitPointerLock();
      this.camera.yaw = 0;
      this.camera.pitch = 0;
      this.clampSide();
    }
    this.changed = true;
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

    if (this.side) {
      const fast = has(FAST) ? SIDE_FAST : 1;
      const panX = (has(RIGHT) || has(TURN_RIGHT) ? 1 : 0) - (has(LEFT) || has(TURN_LEFT) ? 1 : 0);
      const panY = (has(FORWARD) || has(LOOK_UP) ? 1 : 0) - (has(BACK) || has(LOOK_DOWN) ? 1 : 0);
      const zoom = (has(DOWN) ? 1 : 0) - (has(UP) ? 1 : 0); // C/Q back away, Space/E move in
      if (panX !== 0 || panY !== 0 || zoom !== 0) {
        const [x, y, z] = cam.position;
        // Pan speed follows the zoom: the visible height is 2 * z * tan(fovY / 2).
        const v = 2 * z * Math.tan(cam.fovY / 2) * SIDE_PAN_RATE * fast * dt;
        cam.position = [x + panX * v, y + panY * v, z * Math.exp(zoom * SIDE_ZOOM_RATE * fast * dt)];
        this.clampSide();
        moved = true;
      }
      if (cam.yaw !== 0 || cam.pitch !== 0) {
        cam.yaw = 0;
        cam.pitch = 0;
        moved = true;
      }
      return moved;
    }

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

  private clampSide() {
    const s = this.side;
    if (!s) return;
    const [x, y, z] = this.camera.position;
    this.camera.position = [
      clamp(x, s.bounds.min[0], Math.max(s.bounds.min[0], s.bounds.max[0])),
      clamp(y, s.bounds.min[1], Math.max(s.bounds.min[1], s.bounds.max[1])),
      clamp(z, s.minDistance, s.maxDistance),
    ];
  }

  /** Pick mode follows the held modifiers; entering it releases the mouse so the pointer can aim. */
  private updatePickMode() {
    const mode: PickMode | null = this.altHeld ? 'face' : this.ctrlHeld ? 'object' : null;
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode) {
      this.dragging = false;
      if (this.locked) document.exitPointerLock();
    }
    this.cb.onPickModeChange(mode);
  }

  private resetModifiers() {
    this.ctrlHeld = false;
    this.altHeld = false;
    this.updatePickMode();
  }

  private onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    this.canvas.focus();
    // Only the click's own modifiers decide: a plain click never picks, even if a key-up was missed.
    const mode: PickMode | null = e.altKey ? 'face' : e.ctrlKey ? 'object' : null;
    if (!mode && this.mode) this.resetModifiers();
    if (mode) {
      e.preventDefault();
      if (this.locked) document.exitPointerLock(); // no meaningful cursor position while captured
      else this.cb.onPick(mode, e.clientX, e.clientY);
      return;
    }
    this.dragging = true;
    if (this.side) {
      e.preventDefault(); // drag pans; no text selection, no capture
      return;
    }
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
    if (!this.locked) {
      // Resynchronise with the real modifier state (a key-up can be swallowed, e.g. by the window manager).
      const ctrl = e.ctrlKey && (this.ctrlHeld || this.hover);
      const alt = e.altKey && (this.altHeld || this.hover);
      if (ctrl !== this.ctrlHeld || alt !== this.altHeld) {
        this.ctrlHeld = ctrl;
        this.altHeld = alt;
        this.updatePickMode();
      }
    }
    if (this.side) {
      if (!this.dragging || (e.movementX === 0 && e.movementY === 0)) return;
      // Grab-and-drag: the plane under the cursor follows the mouse (exact on the Z = 0 plane).
      const cam = this.camera;
      const perPixel = (2 * cam.position[2] * Math.tan(cam.fovY / 2)) / Math.max(1, this.canvas.clientHeight);
      cam.position = [cam.position[0] - e.movementX * perPixel, cam.position[1] + e.movementY * perPixel, cam.position[2]];
      this.clampSide();
      this.changed = true;
      return;
    }
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
    if (this.side) {
      const [x, y, z] = this.camera.position;
      this.camera.position = [x, y, z * Math.pow(SIDE_WHEEL_STEP, Math.sign(e.deltaY))];
      this.clampSide();
      this.changed = true;
      return;
    }
    this.setSpeed(this.camera.speed * Math.pow(1.2, -Math.sign(e.deltaY)));
  };

  private onPointerEnter = () => {
    this.hover = true;
  };

  private onPointerLeave = () => {
    this.hover = false;
  };

  private onLockChange = () => {
    if (!this.locked) this.keys.clear();
    this.cb.onLockChange(this.locked);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Control' || e.key === 'Alt') {
      if (!this.active && !this.hover) return;
      // Alt alone would focus the browser's menu bar and take keyboard focus away from the view.
      if (e.key === 'Alt') e.preventDefault();
      if (e.key === 'Control') this.ctrlHeld = true;
      else this.altHeld = true;
      this.updatePickMode();
      return;
    }
    if (!this.active || e.metaKey || e.altKey) return;
    if (HELD_KEYS.has(e.code)) {
      this.keys.add(e.code);
      e.preventDefault(); // stop page scrolling on Space/arrows
      return;
    }
    if (e.repeat || e.ctrlKey) return;
    const action: ControlAction | null =
      e.code === 'KeyR' ? 'reset'
      : e.code === 'KeyF' ? (e.shiftKey ? 'toggle-collision-wireframe' : 'toggle-wireframe')
      : e.code === 'KeyH' ? 'toggle-help'
      : e.code === 'KeyV' ? 'toggle-view'
      : e.code === 'KeyX' ? 'toggle-cutaway'
      : null;
    if (action) {
      e.preventDefault();
      this.cb.onAction(action);
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    if (e.key === 'Control' || e.key === 'Alt') {
      if (e.key === 'Alt' && (this.active || this.hover || this.altHeld)) e.preventDefault();
      if (e.key === 'Control') this.ctrlHeld = false;
      else this.altHeld = false;
      this.updatePickMode();
    }
  };

  // Key-ups are not delivered while the window is in the background: drop held keys and any pick mode.
  private onBlur = () => {
    this.keys.clear();
    this.dragging = false;
    this.resetModifiers();
  };
}
