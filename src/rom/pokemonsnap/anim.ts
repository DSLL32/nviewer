// HAL's AnimCmd interpreter and arc-length-parameterised InterpData paths.
import type { SnapMemory, V3 } from './fs';

export const DISABLED = -3.4028234663852886e38;
const CHANGED = DISABLED / 2;
const FINISHED = DISABLED / 3;

type Kind = 'none' | 'linear' | 'cubic' | 'step' | 'lerpColor' | 'stepColor';
interface AObj {
  param: number; kind: Kind; invDuration: number; time: number; initial: number;
  target: number; rate: number; targetRate: number; path: number;
}
export interface AnimEvent { time: number; cmd: number; index: number; value: number }

// One animated DObj (parameters 1..10) or MObj (13..22 and colours 37..41).
export class AnimNode {
  aobjs = new Map<number, AObj>();
  list = 0;
  timeLeft = DISABLED;
  timePassed = 0;
  speed = 1;
  values = new Map<number, number>();
  position: V3 | null = null;
  events: AnimEvent[] = [];
  flags = 0;

  constructor(readonly mem: SnapMemory, readonly texture: boolean) {}

  set(list: number, skip = 0): void {
    for (const a of this.aobjs.values()) a.kind = 'none';
    this.list = list;
    this.timeLeft = CHANGED;
    this.timePassed = skip;
  }

  private aobj(param: number): AObj {
    let a = this.aobjs.get(param);
    if (!a) {
      a = { param, kind: 'none', invDuration: 1, time: 0, initial: 0, target: 0, rate: 0, targetRate: 0, path: 0 };
      this.aobjs.set(param, a);
    }
    return a;
  }

  process(): void {
    const m = this.mem;
    if (this.timeLeft === DISABLED) return;
    if (this.timeLeft === CHANGED) this.timeLeft = -this.timePassed;
    else {
      this.timeLeft -= this.speed;
      this.timePassed += this.speed;
      if (this.timeLeft > 0) return;
    }
    const base = this.texture ? 13 : 1;
    do {
      if (!this.list) {
        for (const a of this.aobjs.values()) if (a.kind !== 'none') a.time += this.speed + this.timeLeft;
        this.timePassed = this.timeLeft;
        this.timeLeft = FINISHED;
        return;
      }
      const w = m.u32(this.list);
      const cmd = w >>> 25;
      const duration = w & 0x7fff;
      const mask = (w << 7) >>> 22;
      const next = () => { const v = m.f32(this.list); this.list += 4; return v; };
      const nextU = () => { const v = m.u32(this.list); this.list += 4; return v; };
      switch (cmd) {
        case 3: case 4: case 5: case 6: case 8: case 9: case 10: case 11: {
          this.list += 4;
          for (let i = 0, bm = mask; i < 10 && bm; i++, bm >>>= 1) {
            if (!(bm & 1)) continue;
            const a = this.aobj(i + base);
            a.initial = a.target;
            a.target = next();
            if (cmd === 8 || cmd === 9) {
              a.rate = a.targetRate; a.targetRate = 0; a.kind = 'cubic';
              if (duration) a.invDuration = 1 / duration;
            } else if (cmd === 3 || cmd === 4) {
              a.kind = 'linear';
              if (duration) a.rate = (a.target - a.initial) / duration;
              a.targetRate = 0;
            } else if (cmd === 5 || cmd === 6) {
              a.rate = a.targetRate; a.targetRate = next(); a.kind = 'cubic';
              if (duration) a.invDuration = 1 / duration;
            } else {
              a.kind = 'step'; a.invDuration = duration; a.targetRate = 0;
            }
            a.time = -this.timeLeft - this.speed;
          }
          if (cmd === 3 || cmd === 5 || cmd === 8 || cmd === 10) this.timeLeft += duration;
          break;
        }
        case 7:
          this.list += 4;
          for (let i = 0, bm = mask; i < 10 && bm; i++, bm >>>= 1) if (bm & 1) this.aobj(i + base).targetRate = next();
          break;
        case 2:
          this.list += 4; this.timeLeft += duration; break;
        case 14:
          this.list = m.u32(this.list + 4); this.timePassed = -this.timeLeft; break;
        case 1:
          this.list = m.u32(this.list + 4); break;
        case 12:
          this.list += 4;
          for (let i = 0, bm = mask; i < 10 && bm; i++, bm >>>= 1) if (bm & 1) this.aobj(i + base).time += duration;
          break;
        case 13:
          this.list += 4; this.aobj(4).path = nextU(); break;
        case 0:
          for (const a of this.aobjs.values()) if (a.kind !== 'none') a.time += this.speed + this.timeLeft;
          this.timeLeft = FINISHED;
          return;
        case 15:
          this.flags = mask; this.list += 4; this.timeLeft += duration; break;
        case 16:
          this.events.push({ time: this.timePassed + this.timeLeft, cmd, index: mask >> 8, value: mask & 0xff });
          this.list += 4; this.timeLeft += duration; break;
        case 17: {
          const time = this.timePassed + this.timeLeft;
          this.list += 4; this.timeLeft += duration;
          for (let i = 4, bm = mask; i < 14 && bm; i++, bm >>>= 1)
            if (bm & 1) this.events.push({ time, cmd, index: i, value: next() });
          break;
        }
        case 18: case 19: case 20: case 21:
          this.list += 4;
          for (let i = 0, bm = mask; i < 5 && bm; i++, bm >>>= 1) {
            if (!(bm & 1)) continue;
            const a = this.aobj(37 + i);
            a.initial = a.target; a.target = nextU();
            if (cmd === 18 || cmd === 19) { a.kind = 'stepColor'; a.invDuration = duration; }
            else { a.kind = 'lerpColor'; if (duration) a.invDuration = 1 / duration; }
            a.time = -this.timeLeft - this.speed;
          }
          if (cmd === 18 || cmd === 20) this.timeLeft += duration;
          break;
        default:
          throw new Error(`Pokémon Snap animation command ${cmd} at 0x${this.list.toString(16)}`);
      }
    } while (this.timeLeft <= 0);
  }

  update(): void {
    if (this.timeLeft === DISABLED) return;
    for (const a of this.aobjs.values()) {
      if (a.kind === 'none') continue;
      if (this.timeLeft !== FINISHED) a.time += this.speed;
      let v = 0;
      switch (a.kind) {
        case 'linear': v = a.initial + a.time * a.rate; break;
        case 'cubic': {
          const inv2 = a.invDuration * a.invDuration, t2 = a.time * a.time;
          const f18 = a.invDuration * t2, f14 = a.time * t2 * inv2;
          const f20 = 2 * f14 * a.invDuration, f22 = 3 * t2 * inv2, f24 = f14 - f18;
          v = a.initial * (f20 - f22 + 1) + a.target * (f22 - f20) +
            a.rate * (f24 - f18 + a.time) + a.targetRate * f24;
          break;
        }
        case 'step': case 'stepColor': v = a.invDuration <= a.time ? a.target : a.initial; break;
        case 'lerpColor': {
          const k = Math.max(0, Math.min(1, a.time * a.invDuration));
          const c = (x: number, s: number) => (x >>> s) & 0xff;
          v = [24, 16, 8, 0].reduce((out, s) => out | (Math.round(c(a.initial, s) * (1 - k) + c(a.target, s) * k) << s), 0) >>> 0;
          break;
        }
      }
      if (a.param === 4 && !this.texture && a.path)
        this.position = interpolatedPosition(this.mem, a.path, Math.max(0, Math.min(1, v)));
      this.values.set(a.param, v);
    }
    if (this.timeLeft === FINISHED) this.timeLeft = DISABLED;
  }

  tick(): void { this.process(); this.update(); }
}

interface InterpData {
  type: number; numPoints: number; tension: number; points: number;
  length: number; knots: number; speed: number;
}

function readInterp(m: SnapMemory, a: number): InterpData {
  return { type: m.u8(a), numPoints: m.s16(a + 2), tension: m.f32(a + 4), points: m.u32(a + 8), length: m.f32(a + 12), knots: m.u32(a + 16), speed: m.u32(a + 20) };
}
const point = (m: SnapMemory, d: InterpData, i: number): V3 => m.vec3(d.points + 12 * i);
const combine = (p: V3[], w: number[]): V3 => [0, 1, 2].map((k) => p[0][k] * w[0] + p[1][k] * w[1] + p[2][k] * w[2] + p[3][k] * w[3]) as V3;

function curve(m: SnapMemory, d: InterpData, t: number): V3 {
  if (t < 1) {
    t *= d.numPoints - 1;
    const s = Math.trunc(t); t -= s;
    const four = (q: number) => [0, 1, 2, 3].map((k) => point(m, d, q + k));
    if (d.type === 0) {
      const a = point(m, d, s), b = point(m, d, s + 1);
      return [0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * t) as V3;
    }
    if (d.type === 1) {
      const u = 1 - t;
      return combine(four(s * 3), [u ** 3, 3 * t * u * u, 3 * t * t * u, t ** 3]);
    }
    if (d.type === 2) {
      const u = 1 - t, t2 = t * t, t3 = t2 * t;
      return combine(four(s), [u ** 3 / 6, (3 * t3 - 6 * t2 + 4) / 6, (3 * (t2 - t3 + t) + 1) / 6, t3 / 6]);
    }
    const q = d.tension, t2 = t * t, t3 = t2 * t;
    return combine(four(s), [(2 * t2 - t3 - t) * q, (2 - q) * t3 + (q - 3) * t2 + 1,
      (q - 2) * t3 + (3 - 2 * q) * t2 + q * t, (t3 - t2) * q]);
  }
  const s = d.numPoints - 1;
  if (d.type === 0) return point(m, d, s);
  if (d.type === 1) return point(m, d, s * 3);
  if (d.type === 2) return combine([0, 1, 2, 3].map((k) => point(m, d, s - 1 + k)), [0, 1 / 6, 4 / 6, 1 / 6]);
  return point(m, d, s + 1);
}

function speedAt(x: number, c: number[]): number {
  let v = c[0] * x ** 4 + c[1] * x ** 3 + c[2] * x * x + c[3] * x + c[4];
  if (v < 0 && v > -0.001) v = 0;
  return Math.sqrt(v);
}
function integrate(a: number, b: number, c: number[]): number {
  const step = (b - a) / 8;
  let sum = 0, x = a + step;
  for (let i = 2; i < 9; i++, x += step) sum += (i % 2 === 0 ? 4 : 2) * speedAt(x, c);
  return (speedAt(a, c) + sum + speedAt(b, c)) * step / 3;
}
function uniformParam(m: SnapMemory, d: InterpData, param: number): number {
  if (param === 1) return 1;
  const knot = (i: number) => m.f32(d.knots + i * 4);
  let s = 0;
  while (s + 2 < d.numPoints && knot(s + 1) < param) s++;
  let mid: number;
  if (d.type === 0) mid = (param - knot(s)) / (knot(s + 1) - knot(s));
  else {
    const c = [0, 1, 2, 3, 4].map((k) => m.f32(d.speed + 20 * s + 4 * k));
    let target = (param - knot(s)) * d.length, low = 0, high = 1;
    for (let i = 0; i < 64; i++) {
      mid = (low + high) * 0.5;
      const cur = integrate(low, mid, c);
      if (target < cur + 0.00001) high = mid;
      else { low = mid; target -= cur; }
      if (Math.abs(low - high) < 0.00001 || !(target > cur + 0.00001 || target < cur - 0.00001)) break;
    }
    mid = (low + high) * 0.5;
  }
  return (s + mid!) / (d.numPoints - 1);
}

export function interpolatedPosition(m: SnapMemory, addr: number, param: number): V3 {
  const d = readInterp(m, addr);
  return curve(m, d, uniformParam(m, d, param));
}
