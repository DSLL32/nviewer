import { useEffect, useRef, useState } from 'react';
import type { Level } from '../rom';
import { FlyCamera } from '../render/camera';
import { FlyControls, type ControlAction } from '../render/controls';
import { LevelRenderer } from '../render/renderer';
import { computeStartView, type StartView } from '../render/startView';

interface ViewportProps {
  level: Level | null;
  loadingName: string | null;
  error: string | null;
}

interface Engine {
  renderer: LevelRenderer;
  camera: FlyCamera;
  controls: FlyControls;
}

declare global {
  interface Window {
    /** Debug handle for poking at the viewer from the console. */
    nviewer?: Engine;
  }
}

export function Viewport({ level, loadingName, error }: ViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const posRef = useRef<HTMLSpanElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [glError, setGlError] = useState<string | null>(null);
  const [speed, setSpeed] = useState(500);
  const [locked, setLocked] = useState(false);
  const [nearest, setNearest] = useState(false);
  const [showScripted, setShowScripted] = useState(true);
  const [fogOn, setFogOn] = useState(readFogSetting);
  const [cullOn, setCullOn] = useState(() => readFlag(CULL_KEY));
  const [skyPref, setSkyPref] = useState<string>(() => readString(SKY_KEY) ?? '');
  const [helpOpen, setHelpOpen] = useState(true);
  const actionRef = useRef<(a: ControlAction) => void>(() => {});
  const startViewRef = useRef<{ level: Level; view: StartView } | null>(null);

  actionRef.current = (a) => {
    const engine = engineRef.current;
    if (a === 'toggle-filter') setNearest((v) => !v);
    else if (a === 'toggle-help') setHelpOpen((v) => !v);
    else if (a === 'reset' && engine && startViewRef.current) applyView(engine, startViewRef.current.view);
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    let renderer: LevelRenderer;
    try {
      renderer = new LevelRenderer(canvas);
    } catch (e) {
      setGlError(e instanceof Error ? e.message : String(e));
      return;
    }
    const camera = new FlyCamera();
    const controls = new FlyControls(canvas, camera, {
      onSpeedChange: setSpeed,
      onLockChange: setLocked,
      onAction: (a) => actionRef.current(a),
    });
    const engine: Engine = { renderer, camera, controls };
    engineRef.current = engine;
    window.nviewer = engine;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        renderer.dirty = true;
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    let raf = 0;
    let last = performance.now();
    let lastReadout = 0;
    let readoutStale = true;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(Math.max((t - last) / 1000, 0), 0.1);
      last = t;
      const moved = controls.update(dt);
      if (moved || renderer.dirty) {
        renderer.render(camera);
        readoutStale = true;
      }
      // Throttled, but always catches up once the camera stops.
      if (readoutStale && posRef.current && t - lastReadout > 100) {
        lastReadout = t;
        readoutStale = false;
        const [x, y, z] = camera.position;
        posRef.current.textContent = `${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)}`;
      }
    };
    raf = requestAnimationFrame(frame);

    const onLost = (e: Event) => {
      e.preventDefault();
      setGlError('The WebGL context was lost. Reload the page to continue.');
    };
    canvas.addEventListener('webglcontextlost', onLost);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener('webglcontextlost', onLost);
      controls.dispose();
      renderer.dispose();
      engineRef.current = null;
      if (window.nviewer === engine) delete window.nviewer;
    };
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.renderer.setLevel(level);
    if (!level) return;
    const canvas = engine.renderer.gl.canvas as HTMLCanvasElement;
    const view = computeStartView(level, canvas.width / Math.max(1, canvas.height), engine.camera.fovY);
    startViewRef.current = { level, view };
    engine.renderer.setSkyGroundHeight(view.groundY);
    applyView(engine, view);
  }, [level]);

  useEffect(() => engineRef.current?.renderer.setNearestFiltering(nearest), [nearest]);
  useEffect(() => engineRef.current?.renderer.setShowAnimated(showScripted), [showScripted]);
  useEffect(() => {
    engineRef.current?.renderer.setFogEnabled(fogOn);
    try {
      localStorage.setItem(FOG_KEY, fogOn ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }, [fogOn]);
  useEffect(() => {
    engineRef.current?.renderer.setBackfaceCulling(cullOn);
    writeFlag(CULL_KEY, cullOn);
  }, [cullOn]);

  // Sky choice for levels with Level.skies: a remembered name, "none", or the first sky by default.
  const skies = level?.skies ?? [];
  const activeSky = skies.length === 0 || skyPref === SKY_NONE ? null : (skies.find((sk) => sk.name === skyPref) ?? skies[0]).name;
  useEffect(() => engineRef.current?.renderer.setSky(activeSky), [activeSky, level]);
  useEffect(() => {
    if (skyPref) writeString(SKY_KEY, skyPref);
  }, [skyPref]);

  const hasScripted = level?.instances.some((i) => i.animated && i.mesh >= 0) ?? false;
  const hasFog = !!level?.fog;

  return (
    <main className="viewport">
      <canvas ref={canvasRef} className="gl-canvas" tabIndex={0} aria-label="Level view. Click to fly." />

      {loadingName && (
        <div className="overlay center" role="status">
          <div className="loading-pill">
            <span className="spinner" aria-hidden="true" /> Loading {loadingName}…
          </div>
        </div>
      )}
      {(glError || error) && (
        <div className="overlay center">
          <div className="error" role="alert">{glError ?? error}</div>
        </div>
      )}
      {level && !locked && !loadingName && (
        <div className="click-hint">Click the view to fly · Esc to release</div>
      )}

      <div className="hud" onMouseDown={(e) => e.stopPropagation()}>
        <div className="hud-row">
          <strong>{level ? level.info.name : 'No level'}</strong>
          <button type="button" className="link" onClick={() => setHelpOpen((v) => !v)} aria-expanded={helpOpen}>
            {helpOpen ? 'Hide help' : 'Help (H)'}
          </button>
        </div>
        <div className="hud-row small muted">
          <span>Speed <strong className="speed">{Math.round(speed)}</strong> u/s</span>
          <span ref={posRef} className="mono" />
        </div>
        {helpOpen && (
          <>
            <dl className="controls-help">
              <dt>Mouse</dt><dd>Look (click to capture, Esc releases)</dd>
              <dt>W A S D</dt><dd>Move</dd>
              <dt>Arrow keys</dt><dd>Look around</dd>
              <dt>Space / E</dt><dd>Up</dd>
              <dt>C / Q / Ctrl</dt><dd>Down</dd>
              <dt>Shift</dt><dd>Fast (×5)</dd>
              <dt>Wheel</dt><dd>Adjust speed</dd>
              <dt>R</dt><dd>Reset view</dd>
              <dt>F</dt><dd>Toggle nearest filtering</dd>
            </dl>
            <label className="check">
              <input type="checkbox" checked={nearest} onChange={(e) => setNearest(e.target.checked)} />
              Nearest texture filtering
            </label>
            <label className={`check${hasScripted ? '' : ' muted'}`}>
              <input type="checkbox" checked={showScripted} onChange={(e) => setShowScripted(e.target.checked)} />
              Show scripted objects
            </label>
            <label className={`check${hasFog ? '' : ' muted'}`} title={hasFog ? "The game's own distance fog" : 'No fog in this game'}>
              <input
                id="fog-toggle"
                type="checkbox"
                checked={fogOn}
                disabled={!hasFog}
                onChange={(e) => setFogOn(e.target.checked)}
              />
              Authentic fog{!hasFog && level ? <span className="small muted"> (no fog in this game)</span> : null}
            </label>
            {skies.length > 0 && (
              <label className="check select-row" title="The game picks one of these at random per race">
                Sky
                <select id="sky-select" value={activeSky ?? SKY_NONE} onChange={(e) => setSkyPref(e.target.value)}>
                  {skies.map((sk) => (
                    <option key={sk.name} value={sk.name}>{sk.name}</option>
                  ))}
                  <option value={SKY_NONE}>None</option>
                </select>
              </label>
            )}
            <label className="check" title="Hide the back sides of single-sided polygons, as the game does">
              <input id="cull-toggle" type="checkbox" checked={cullOn} onChange={(e) => setCullOn(e.target.checked)} />
              Back-face culling
            </label>
          </>
        )}
      </div>
    </main>
  );
}

const FOG_KEY = 'nviewer.authenticFog';
// New key: an "on" stored by the earlier culling implementation must not carry over (now off by default).
const CULL_KEY = 'nviewer.backfaceCulling.v2';

const SKY_KEY = 'nviewer.sky';
const SKY_NONE = '__none__';

function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeString(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

function readFogSetting(): boolean {
  try {
    return localStorage.getItem(FOG_KEY) === '1';
  } catch {
    return false;
  }
}

function applyView(engine: Engine, view: StartView) {
  const cam = engine.camera;
  cam.position = [...view.position];
  cam.yaw = 0;
  cam.pitch = 0;
  cam.rotate(view.yaw, view.pitch);
  engine.controls.setSpeed(view.speed);
  engine.controls.invalidate();
}
