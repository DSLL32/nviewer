import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Level, LevelLayer, Marker, SideView } from '../rom';
import { FlyCamera } from '../render/camera';
import { FlyControls, type ControlAction, type PickMode, type SideViewLimits } from '../render/controls';
import { mat4, type Mat4 } from '../render/math';
import { LevelPicker, orientedBoxLines, triangleWorld } from '../render/picking';
import { CUTAWAY_EPSILON, LevelRenderer } from '../render/renderer';
import { computeStartView, type StartView } from '../render/startView';
import { SelectionPanel } from './SelectionPanel';
import { describeSelection, type Selection } from './selectionInfo';
import { BUILD_TIME, captureFrame, reportEndpointAvailable, sendReport } from './report';
import { loadViewState, saveViewState, viewStateKey, type ViewState } from './viewState';

const OBJECT_HIGHLIGHT: [number, number, number] = [1, 0.2, 0.95]; // magenta
const FACE_HIGHLIGHT: [number, number, number] = [1, 0.9, 0.1]; // yellow

const FREE_FLY_FOV_Y = (60 * Math.PI) / 180;
// Side view zoom range: the eye's distance from the Z = 0 plane.
const SIDE_MIN_DISTANCE = 60;
const SIDE_MAX_DISTANCE = 6000;
const MARKER_PICK_RADIUS = 10; // CSS px around a marker dot
const MAX_MARKER_LABELS = 150; // more markers on screen than this: dots only
const LABEL_CELL_W = 40; // label de-cluttering grid, CSS px
const LABEL_CELL_H = 14;
const FADED_OPACITY = 0; // fadeOnHover layers under the pointer vanish completely, as in the game
const FADE_SECONDS = 0.15;
const VIEW_SAVE_MS = 400; // at most this often while the view changes
const GROUP_OPEN_MAX = 8; // layer groups (LevelLayer.group) with more layers than this start collapsed

interface ViewportProps {
  level: Level | null;
  /** Game the shown level belongs to (for the selection report). */
  gameId?: string | null;
  gameTitle?: string | null;
  loadingName: string | null;
  error: string | null;
  /** Extra panels stacked below the help panel (e.g. the music box). */
  children?: ReactNode;
}

interface Engine {
  renderer: LevelRenderer;
  camera: FlyCamera;
  controls: FlyControls;
}

/** A marker's DOM element, positioned each frame from the camera. */
interface MarkerEntry {
  el: HTMLDivElement;
  label: HTMLSpanElement;
  position: [number, number, number];
  labelWidth: number; // estimated, CSS px
  selected: boolean;
}

/** Layers that fade while the pointer is over them (LevelLayer.fadeOnHover), animated by the frame loop. */
interface FadeState {
  level: Level;
  picker: LevelPicker;
  layers: { index: number; opacity: number; target: number }[];
  layerOfInstance: Map<number, number>; // instance index -> position in `layers`
  stale: boolean; // re-test the hover (new state)
  push: boolean; // send the opacities to the renderer
}

interface PointerState {
  x: number; // CSS px within the canvas
  y: number;
  inside: boolean;
  moved: boolean;
  locked: boolean;
}

declare global {
  interface Window {
    /** Debug handle for poking at the viewer from the console. */
    nviewer?: Engine;
  }
}

export function Viewport({ level, gameId, gameTitle, loadingName, error, children }: ViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLElement>(null);
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number } | null>(null);
  const posRef = useRef<HTMLSpanElement>(null);
  const markerHostRef = useRef<HTMLDivElement>(null);
  const markerEntriesRef = useRef<MarkerEntry[]>([]);
  const engineRef = useRef<Engine | null>(null);
  const [glError, setGlError] = useState<string | null>(null);
  const [speed, setSpeed] = useState(500);
  const [locked, setLocked] = useState(false);
  const [nearest, setNearest] = useState(false);
  const [showScripted, setShowScripted] = useState(true);
  const [fogOn, setFogOn] = useState(readFogSetting);
  const [cullOn, setCullOn] = useState(() => readFlag(CULL_KEY));
  const [cutaway, setCutaway] = useState(false);
  const [skyPref, setSkyPref] = useState<string>(() => readString(SKY_KEY) ?? '');
  const [showBackdrop, setShowBackdrop] = useState(() => readString(BACKDROP_KEY) !== '0');
  const [helpOpen, setHelpOpen] = useState(true);
  // Bug reports (report.ts): offered when the dev server's endpoint answers; the last outcome is shown briefly.
  const [reportAvailable, setReportAvailable] = useState(false);
  const [reportStatus, setReportStatus] = useState<{ kind: 'busy' | 'ok' | 'error'; text: string } | null>(null);
  const actionRef = useRef<(a: ControlAction) => void>(() => {});
  const startViewRef = useRef<{ level: Level; view: StartView } | null>(null);
  const [pickMode, setPickMode] = useState<PickMode | null>(null);
  // Per-level UI state remembers its level, so a newly loaded level starts from its defaults.
  const [picked, setPicked] = useState<{ level: Level; sel: Selection } | null>(null);
  const [flyLevel, setFlyLevel] = useState<Level | null>(null); // level switched from side view to free fly
  const [layerState, setLayerState] = useState<{ level: Level; hidden: ReadonlySet<number> } | null>(null);
  const pickerRef = useRef<LevelPicker | null>(null);
  const pickRef = useRef<(mode: PickMode, clientX: number, clientY: number) => void>(() => {});
  const pixelArtRef = useRef(false);
  const fadeRef = useRef<FadeState | null>(null);
  // The view (camera, speed, side view or free fly) is saved per tab (viewState.ts) so a reload or hot update returns to
  // it: it is restored only for the first level an engine shows, and only if the saved view belongs to that level.
  // A later level switch or a different ROM starts from the level's start view as before.
  const viewKeyRef = useRef<string | null>(null); // key of the shown level once its view is applied (null: don't save)
  const viewPersistRef = useRef({ stale: false, last: 0 });
  const levelSeenRef = useRef(false); // the current engine has shown a level
  const restoredViewRef = useRef<{ level: Level; state: ViewState } | null>(null);

  const sideView = level?.sideView ?? null;
  const sideActive = !!sideView && flyLevel !== level;

  // A prerendered picture from a fixed game camera (Backdrop.aspect) keeps its proportions: while it is shown, the 3D
  // view (canvas and marker overlay) is a centred rectangle of that aspect. Picking, markers and the renderer all work
  // from the canvas, so they follow the rectangle.
  const lockedAspect = showBackdrop && level?.backdrop?.aspect && level.backdrop.aspect > 0 ? level.backdrop.aspect : null;
  const viewRect = lockedAspect && viewportSize ? fitAspect(viewportSize.width, viewportSize.height, lockedAspect) : null;
  const viewRectStyle = viewRect
    ? { position: 'absolute' as const, left: viewRect.left, top: viewRect.top, width: viewRect.width, height: viewRect.height, right: 'auto', bottom: 'auto' }
    : undefined;

  // Layer visibility: checkboxes from Level.layers; `visibleByDefault: false` layers start hidden.
  const defaultHiddenLayers = useMemo(
    () => new Set((level?.layers ?? []).flatMap((l, i) => (l.visibleByDefault === false ? [i] : []))),
    [level],
  );
  const hiddenLayers = layerState && layerState.level === level ? layerState.hidden : defaultHiddenLayers;
  const hiddenInstances = useMemo(() => {
    const out = new Set<number>();
    level?.layers?.forEach((l, i) => {
      if (hiddenLayers.has(i)) for (const inst of l.instances) out.add(inst);
    });
    return out;
  }, [level, hiddenLayers]);

  // Layers panel entries in level order: an ungrouped layer, or a group (LevelLayer.group) placed where its first layer is.
  const layerEntries = useMemo(() => {
    const out: ({ group: null; index: number } | { group: string; indices: number[] })[] = [];
    const byGroup = new Map<string, number[]>();
    (level?.layers ?? []).forEach((l, i) => {
      if (!l.group) {
        out.push({ group: null, index: i });
        return;
      }
      let indices = byGroup.get(l.group);
      if (!indices) {
        indices = [];
        byGroup.set(l.group, indices);
        out.push({ group: l.group, indices });
      }
      indices.push(i);
    });
    return out;
  }, [level]);
  // Expanded or collapsed groups, per level; groups of many layers start collapsed.
  const [groupOpenState, setGroupOpenState] = useState<{ level: Level; open: Record<string, boolean> } | null>(null);
  const groupOpen = (name: string, size: number) =>
    (groupOpenState && groupOpenState.level === level ? groupOpenState.open[name] : undefined) ?? size <= GROUP_OPEN_MAX;

  const instanceVisible = (lv: Level, i: number) => !hiddenInstances.has(i) && (showScripted || !lv.instances[i]?.animated);
  const markerVisible = (m: Marker | undefined) => !!m && (m.layer === undefined || !hiddenLayers.has(m.layer));

  const pickerFor = (lv: Level): LevelPicker => {
    let picker = pickerRef.current;
    if (!picker || picker.level !== lv) {
      picker = new LevelPicker(lv);
      pickerRef.current = picker;
    }
    return picker;
  };

  // Hidden things (scripted objects or layers switched off) cannot stay selected.
  const selection =
    picked &&
    level &&
    picked.level === level &&
    (picked.sel.kind === 'marker' ? markerVisible(level.markers?.[picked.sel.marker]) : instanceVisible(level, picked.sel.instance))
      ? picked.sel
      : null;
  const selectedMarker = selection?.kind === 'marker' ? selection.marker : -1;

  // A faded overlay is see-through for picking as well.
  const isFaded = (lv: Level, i: number) => {
    const fade = fadeRef.current;
    if (!fade || fade.level !== lv) return false;
    const k = fade.layerOfInstance.get(i);
    return k !== undefined && fade.layers[k].opacity < 1;
  };

  pickRef.current = (mode, clientX, clientY) => {
    const engine = engineRef.current;
    if (!engine || !level) return;
    const canvas = engine.renderer.gl.canvas as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const cam = engine.camera;
    const aspect = canvas.width / Math.max(1, canvas.height);
    if (mode === 'object' && level.markers?.length) {
      // Marker dots first: they mark objects that have no geometry to hit.
      const vp = cam.viewProjection(mat4.create(), aspect);
      let best = -1;
      let bestDist = MARKER_PICK_RADIUS;
      level.markers.forEach((m, i) => {
        if (!markerVisible(m)) return;
        const s = projectToCss(vp, m.position, rect.width, rect.height);
        if (!s) return;
        const d = Math.hypot(s[0] - (clientX - rect.left), s[1] - (clientY - rect.top));
        if (d <= bestDist) {
          bestDist = d;
          best = i;
        }
      });
      if (best >= 0) {
        setPicked({ level, sel: { kind: 'marker', marker: best } });
        return;
      }
    }
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = 1 - ((clientY - rect.top) / rect.height) * 2;
    const dir = cam.rayThrough(ndcX, ndcY, aspect);
    const picker = pickerFor(level);
    const pickOptions = { include: (i: number) => instanceVisible(level, i) && !isFaded(level, i), cullBackFaces: cullOn, minT: cam.near };
    if (cutaway) {
      // Pick what the cutaway shows: the nearest hit behind the nearest opaque/cutout surface (the renderer's first pass).
      const first = picker.pick(cam.position, dir, { ...pickOptions, batch: (b) => b.blend !== 'blend' && !b.decal && (b.depthTest || b.depthWrite) });
      if (first) pickOptions.minT = first.t * (1 + CUTAWAY_EPSILON);
    }
    const hit = picker.pick(cam.position, dir, pickOptions);
    if (!hit) setPicked(null);
    else if (mode === 'object') setPicked({ level, sel: { kind: 'object', instance: hit.instance, point: hit.point } });
    else setPicked({ level, sel: { kind: 'face', instance: hit.instance, batch: hit.batch, tri: hit.tri, point: hit.point } });
  };

  const toggleView = () => {
    if (!level?.sideView) return;
    restoredViewRef.current = null;
    setFlyLevel(sideActive ? level : null);
  };

  actionRef.current = (a) => {
    const engine = engineRef.current;
    if (a === 'toggle-filter') setNearest((v) => !v);
    else if (a === 'toggle-help') setHelpOpen((v) => !v);
    else if (a === 'toggle-view') toggleView();
    else if (a === 'toggle-cutaway') setCutaway((v) => !v);
    else if (a === 'reset' && engine && startViewRef.current) {
      restoredViewRef.current = null;
      applyView(engine, startViewRef.current.view);
      if (sideActive && sideView && level) engine.controls.setSideView(sideLimits(sideView, level));
    }
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
    levelSeenRef.current = false;
    const controls = new FlyControls(canvas, camera, {
      onSpeedChange: (s) => {
        setSpeed(s);
        viewPersistRef.current.stale = true;
      },
      onLockChange: setLocked,
      onAction: (a) => actionRef.current(a),
      onPickModeChange: setPickMode,
      onPick: (mode, x, y) => pickRef.current(mode, x, y),
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
    const host = viewportRef.current;
    const hostObserver = new ResizeObserver(() => {
      if (host) setViewportSize({ width: host.clientWidth, height: host.clientHeight });
    });
    if (host) hostObserver.observe(host);

    // Pointer position for hover effects (fading overlays).
    const pointer: PointerState = { x: 0, y: 0, inside: false, moved: false, locked: false };
    const onPointerMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
      pointer.inside = true;
      pointer.moved = true;
    };
    const onPointerLeave = () => {
      pointer.inside = false;
      pointer.moved = true;
    };
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);

    const saveView = () => {
      const key = viewKeyRef.current;
      if (!key) return;
      viewPersistRef.current.stale = false;
      saveViewState({ key, position: [...camera.position], yaw: camera.yaw, pitch: camera.pitch, speed: camera.speed, sideView: controls.sideView });
    };
    window.addEventListener('pagehide', saveView);
    window.addEventListener('beforeunload', saveView);

    let raf = 0;
    let last = performance.now();
    let lastReadout = 0;
    let readoutStale = true;
    const markerMatrix = mat4.create();
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(Math.max((t - last) / 1000, 0), 0.1);
      last = t;
      const moved = controls.update(dt);
      updateFade(fadeRef.current, pointer, moved, dt, engine, canvas);
      if (moved || renderer.dirty) {
        renderer.render(camera);
        layoutMarkers(markerEntriesRef.current, camera, canvas, markerMatrix);
        readoutStale = true;
      }
      const persist = viewPersistRef.current;
      if (moved) persist.stale = true;
      if (persist.stale && t - persist.last > VIEW_SAVE_MS) {
        persist.last = t;
        saveView();
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
      // Unmount or hot update: keep the view for the next engine.
      saveView();
      window.removeEventListener('pagehide', saveView);
      window.removeEventListener('beforeunload', saveView);
      cancelAnimationFrame(raf);
      observer.disconnect();
      hostObserver.disconnect();
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
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
    viewKeyRef.current = null;
    restoredViewRef.current = null;
    if (!level) return;
    // Far plane from the level size (the logarithmic depth buffer keeps precision across the whole range).
    const { min, max } = level.bounds;
    const diag = [0, 1, 2].every((k) => Number.isFinite(min[k]) && Number.isFinite(max[k]))
      ? Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2])
      : 0;
    engine.camera.far = Math.max(50000, diag * 4);
    const sv = level.sideView;
    let view: StartView;
    if (sv) {
      // The game's own lens, never re-framed: its parallax depends on the field of view and eye distance.
      engine.camera.fovY = (sv.fovY * Math.PI) / 180;
      view = { position: [sv.start[0], sv.start[1], sv.distance], yaw: 0, pitch: 0, speed: Math.min(5000, Math.max(50, sv.distance)), groundY: 0 };
    } else {
      // A prerendered picture only lines up through the game camera's own lens.
      const gameFov = level.backdrop?.aspect && level.camera?.fovY && level.camera.fovY > 0 && level.camera.fovY < 179 ? level.camera.fovY : null;
      engine.camera.fovY = gameFov ? (gameFov * Math.PI) / 180 : FREE_FLY_FOV_Y;
      const canvas = engine.renderer.gl.canvas as HTMLCanvasElement;
      view = computeStartView(level, canvas.width / Math.max(1, canvas.height), engine.camera.fovY);
    }
    startViewRef.current = { level, view };
    engine.renderer.setSkyGroundHeight(view.groundY);
    applyView(engine, view);
    // After a reload or hot update: the saved view, if it belongs to this level.
    const key = viewStateKey(gameId, gameTitle, level);
    const saved = levelSeenRef.current ? null : loadViewState(key);
    levelSeenRef.current = true;
    if (saved) {
      placeView(engine, saved);
      restoredViewRef.current = { level, state: saved };
      if (sv) setFlyLevel(saved.sideView ? null : level);
    }
    viewKeyRef.current = key;
    viewPersistRef.current.stale = true;
  }, [level]);

  // Side view on or off; free fly starts from wherever the side-view eye is.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const sv = level?.sideView;
    // A restored view is placed again once its mode is active: entering the side view levels and clamps the camera,
    // and leaving it resets the speed.
    const restored = restoredViewRef.current?.level === level ? restoredViewRef.current.state : null;
    const restoreNow = restored !== null && restored.sideView === sideActive;
    if (restoreNow) placeView(engine, restored);
    if (sv && level && sideActive) {
      engine.controls.setSideView(sideLimits(sv, level));
    } else {
      engine.controls.setSideView(null);
      if (sv) engine.controls.setSpeed(Math.min(5000, Math.max(50, engine.camera.position[2])));
    }
    if (restoreNow) engine.controls.setSpeed(restored.speed);
    viewPersistRef.current.stale = true;
  }, [level, sideActive]);

  // Pixel-art levels default to nearest filtering (F still toggles); leaving them restores linear filtering.
  useEffect(() => {
    const pixelArt = !!level?.pixelArt;
    if (pixelArt !== pixelArtRef.current) {
      pixelArtRef.current = pixelArt;
      setNearest(pixelArt);
    }
  }, [level]);

  useEffect(() => engineRef.current?.renderer.setNearestFiltering(nearest), [nearest]);
  useEffect(() => engineRef.current?.renderer.setShowAnimated(showScripted), [showScripted]);
  useEffect(() => engineRef.current?.renderer.setCutaway(cutaway), [cutaway]);
  useEffect(() => engineRef.current?.renderer.setHiddenInstances(hiddenInstances), [hiddenInstances]);
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
  // Sky planes (Level.skyPlanes) share the preference: "None" in the sky list hides them too, and vice versa.
  const hasSkyPlanes = (level?.skyPlanes?.length ?? 0) > 0;
  const skyPlanesOn = skyPref !== SKY_NONE;
  useEffect(() => engineRef.current?.renderer.setSkyPlanesVisible(skyPlanesOn), [skyPlanesOn]);
  useEffect(() => {
    writeString(SKY_KEY, skyPref);
  }, [skyPref]);
  useEffect(() => {
    engineRef.current?.renderer.setBackdropVisible(showBackdrop);
    writeString(BACKDROP_KEY, showBackdrop ? '1' : '0');
  }, [showBackdrop]);

  // Hover-fading overlays (LevelLayer.fadeOnHover). Layers switched off in the panel take no part.
  useEffect(() => {
    const prev = fadeRef.current;
    const layers: FadeState['layers'] = [];
    const layerOfInstance = new Map<number, number>();
    level?.layers?.forEach((l, index) => {
      if (!l.fadeOnHover || hiddenLayers.has(index)) return;
      const old = prev && prev.level === level ? prev.layers.find((x) => x.index === index) : undefined;
      for (const inst of l.instances) layerOfInstance.set(inst, layers.length);
      layers.push({ index, opacity: old?.opacity ?? 1, target: old?.target ?? 1 });
    });
    fadeRef.current = level && layers.length > 0 ? { level, picker: pickerFor(level), layers, layerOfInstance, stale: true, push: true } : null;
    if (!fadeRef.current) engineRef.current?.renderer.setInstanceOpacity(null);
  }, [level, hiddenLayers]);

  // Marker overlay elements (positions are updated by the frame loop whenever the view changes).
  useEffect(() => {
    const host = markerHostRef.current;
    if (!host) return;
    host.replaceChildren();
    const entries: MarkerEntry[] = [];
    (level?.markers ?? []).forEach((m, i) => {
      if (m.layer !== undefined && hiddenLayers.has(m.layer)) return;
      const el = document.createElement('div');
      el.className = i === selectedMarker ? 'marker selected' : 'marker';
      el.dataset.marker = String(i);
      const dot = document.createElement('span');
      dot.className = 'marker-dot';
      const label = document.createElement('span');
      label.className = 'marker-label';
      label.textContent = m.label;
      el.append(dot, label);
      host.append(el);
      entries.push({ el, label, position: m.position, labelWidth: 14 + m.label.length * 6.6, selected: i === selectedMarker });
    });
    // The selected marker claims its label space first.
    entries.sort((a, b) => Number(b.selected) - Number(a.selected));
    markerEntriesRef.current = entries;
    if (engineRef.current) engineRef.current.renderer.dirty = true;
  }, [level, hiddenLayers, selectedMarker]);

  // Selection overlay: the object's oriented bounding box, or the face filled and outlined (markers are
  // highlighted in the marker overlay).
  useEffect(() => {
    const renderer = engineRef.current?.renderer;
    if (!renderer) return;
    const inst = level && selection && selection.kind !== 'marker' ? level.instances[selection.instance] : undefined;
    if (!level || !selection || selection.kind === 'marker' || !inst) {
      renderer.setHighlight(null);
    } else if (selection.kind === 'object') {
      const bounds = pickerFor(level).bounds(inst.mesh);
      renderer.setHighlight(bounds ? { lines: orientedBoxLines(bounds, inst.matrix), color: OBJECT_HIGHLIGHT } : null);
    } else {
      const tri = triangleWorld(level, selection.instance, selection.batch, selection.tri);
      renderer.setHighlight(
        tri
          ? {
              fill: new Float32Array([...tri[0], ...tri[1], ...tri[2]]),
              lines: new Float32Array([...tri[0], ...tri[1], ...tri[1], ...tri[2], ...tri[2], ...tri[0]]),
              color: FACE_HIGHLIGHT,
            }
          : null,
      );
    }
  }, [level, selection]);

  useEffect(() => {
    let alive = true;
    void reportEndpointAvailable().then((ok) => {
      if (alive) setReportAvailable(ok);
    });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!reportStatus || reportStatus.kind === 'busy') return;
    const timer = setTimeout(() => setReportStatus(null), 8000);
    return () => clearTimeout(timer);
  }, [reportStatus]);

  // Esc clears the selection (while the mouse is captured, the browser uses Esc to release it instead).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target;
      if (t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
      if (t instanceof HTMLInputElement && t.type !== 'checkbox' && t.type !== 'range') return;
      setPicked(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const report = useMemo(
    () => (level && selection ? describeSelection(level, gameId && gameTitle ? { id: gameId, title: gameTitle } : null, selection) : null),
    [level, selection, gameId, gameTitle],
  );
  const reportTexture = report && report.texture !== null && level ? (level.textures[report.texture] ?? null) : null;

  // One state update however many layers change (a group toggle), so the hidden instances are recomputed once.
  const setLayersVisible = (indices: readonly number[], visible: boolean) => {
    if (!level) return;
    const next = new Set(hiddenLayers);
    for (const index of indices) {
      if (visible) next.delete(index);
      else next.add(index);
    }
    setLayerState({ level, hidden: next });
  };
  const setLayerVisible = (index: number, visible: boolean) => setLayersVisible([index], visible);
  const toggleGroupOpen = (name: string, size: number) => {
    if (!level) return;
    const open = groupOpenState && groupOpenState.level === level ? groupOpenState.open : {};
    setGroupOpenState({ level, open: { ...open, [name]: !groupOpen(name, size) } });
  };

  const layerRow = (l: LevelLayer, i: number) => (
    <label key={i} className="check layer-row" title={`${l.kind}: ${l.instances.length} instance${l.instances.length === 1 ? '' : 's'}`}>
      <input type="checkbox" data-layer={i} checked={!hiddenLayers.has(i)} onChange={(e) => setLayerVisible(i, e.target.checked)} />
      <span className="layer-name">{l.name}</span>
      <span className="layer-meta small muted">
        {[
          l.depth !== undefined ? `z ${+l.depth.toFixed(2)}` : null,
          l.parallax !== undefined ? `×${l.parallax.toFixed(2)}` : null,
        ].filter(Boolean).join(' · ')}
      </span>
    </label>
  );

  // Everything a report needs to reproduce the view (details.json).
  const reportDetails = (description: string, withSelection: boolean) => {
    const engine = engineRef.current!;
    const lv = level!;
    const cam = engine.camera;
    const canvas = engine.renderer.gl.canvas as HTMLCanvasElement;
    const sel = withSelection ? selection : null;
    const groups: Record<string, { layers: number; expanded: boolean }> = {};
    for (const entry of layerEntries) if (entry.group !== null) groups[entry.group] = { layers: entry.indices.length, expanded: groupOpen(entry.group, entry.indices.length) };
    return {
      description,
      timestamp: new Date().toISOString(),
      kind: sel ? sel.kind : 'view',
      copyText: sel && report ? report.copyText : null,
      selection: sel,
      highlightImage: sel && sel.kind !== 'marker' ? 'selection highlighted' : 'same as view.png',
      game: { id: gameId ?? null, title: gameTitle ?? null },
      level: { index: lv.info.index, id: lv.id, name: lv.info.name },
      camera: {
        mode: sideActive ? 'side view' : 'free fly',
        eye: [...cam.position],
        yaw: cam.yaw,
        pitch: cam.pitch,
        fovY: (cam.fovY * 180) / Math.PI,
        speed: cam.speed,
        near: cam.near,
        far: cam.far,
        ...(lv.sideView ? { sideView: { pan: [cam.position[0], cam.position[1]], distance: cam.position[2] } } : {}),
      },
      canvas: { width: canvas.width, height: canvas.height, cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight, devicePixelRatio: window.devicePixelRatio },
      viewport: viewportSize,
      aspectRect: viewRect && lockedAspect ? { ...viewRect, aspect: lockedAspect } : null,
      layers: layers.map((l, i) => ({ name: l.name, kind: l.kind, ...(l.group ? { group: l.group } : {}), visible: !hiddenLayers.has(i) })),
      layerGroups: groups,
      toggles: {
        cutaway,
        nearestFiltering: nearest,
        backfaceCulling: cullOn,
        authenticFog: fogOn,
        showScripted,
        showBackdrop: lv.backdrop ? showBackdrop : null,
        sky: skies.length > 0 ? activeSky : null,
        showSky: hasSkyPlanes ? skyPlanesOn : null,
      },
      build: { time: BUILD_TIME, mode: import.meta.env.MODE, userAgent: navigator.userAgent },
    };
  };

  // Report the selection (withSelection) or the plain view: describe, capture both frames, send.
  const submitReport = async (withSelection: boolean) => {
    const engine = engineRef.current;
    if (!engine || !level || reportStatus?.kind === 'busy') return;
    const answer = window.prompt('Describe the issue');
    const description = answer?.trim() ?? '';
    if (!description) return;
    const sel = withSelection ? selection : null;
    setReportStatus({ kind: 'busy', text: 'Sending report…' });
    try {
      const view = await captureFrame(engine.renderer, engine.camera, false);
      const highlight = sel && sel.kind !== 'marker' ? await captureFrame(engine.renderer, engine.camera, true) : view;
      engine.renderer.dirty = true;
      const serial = await sendReport(view, highlight, reportDetails(description, withSelection));
      setReportStatus({ kind: 'ok', text: `Saved report ${String(serial).padStart(4, '0')}` });
    } catch (e) {
      engine.renderer.dirty = true;
      setReportStatus({ kind: 'error', text: `Report not saved: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const hasScripted = level?.instances.some((i) => i.animated && i.mesh >= 0) ?? false;
  const hasFog = !!level?.fog;
  const layers = level?.layers ?? [];

  return (
    <main ref={viewportRef} className={`viewport${viewRect ? ' letterboxed' : ''}`}>
      <canvas
        ref={canvasRef}
        className={`gl-canvas${pickMode ? ` pick-${pickMode}` : ''}${sideActive ? ' side-view' : ''}`}
        style={viewRectStyle}
        tabIndex={0}
        aria-label={
          sideActive
            ? 'Level view. Drag or use the arrow keys to pan, wheel to zoom, Ctrl+click selects an object, Alt+click a face.'
            : 'Level view. Click to fly, Ctrl+click selects an object, Alt+click a face.'
        }
      />
      <div ref={markerHostRef} className="marker-layer" aria-hidden="true" style={viewRectStyle} />

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
      {level && !loadingName && (pickMode || !locked) && (
        <div className="click-hint" id="click-hint">
          {pickMode === 'object'
            ? 'Click an object to select it · Esc clears the selection'
            : pickMode === 'face'
              ? 'Click a face to select it · Esc clears the selection'
              : sideActive
                ? 'Drag or W A S D to pan · wheel zooms · V for free fly'
                : 'Click the view to fly · Esc to release'}
        </div>
      )}

      <div className={`hud-stack${report ? ' wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
      <div className="hud">
        <div className="hud-row">
          <strong>{level ? level.info.name : 'No level'}</strong>
          <button type="button" className="link" onClick={() => setHelpOpen((v) => !v)} aria-expanded={helpOpen}>
            {helpOpen ? 'Hide help' : 'Help (H)'}
          </button>
        </div>
        <div className="hud-row small muted">
          {sideActive ? (
            <span id="view-mode">Side view</span>
          ) : (
            <span id="view-mode">{sideView ? 'Free fly · ' : ''}Speed <strong className="speed">{Math.round(speed)}</strong> u/s</span>
          )}
          <span ref={posRef} className="mono" />
        </div>
        {reportAvailable && level && (
          <div className="hud-row small">
            <button type="button" className="link" id="report-view" onClick={() => void submitReport(false)} disabled={reportStatus?.kind === 'busy'} title="Describe an issue with this view and save a report with a screenshot">
              Report view
            </button>
          </div>
        )}
        {sideView && (
          <label className="check" title="The game's own side-scrolling camera, or free fly through the layers (V)">
            <input id="side-view-toggle" type="checkbox" checked={sideActive} onChange={toggleView} />
            Side view (V)
          </label>
        )}
        {helpOpen && (
          <>
            {sideActive ? (
              <dl className="controls-help">
                <dt>Drag</dt><dd>Pan</dd>
                <dt>W A S D / arrows</dt><dd>Pan</dd>
                <dt>Wheel</dt><dd>Zoom</dd>
                <dt>Space / E</dt><dd>Zoom in</dd>
                <dt>C / Q</dt><dd>Zoom out</dd>
                <dt>Shift</dt><dd>Fast (×4)</dd>
                <dt>V</dt><dd>Free fly</dd>
                <dt>R</dt><dd>Reset view</dd>
                <dt>F</dt><dd>Toggle nearest filtering</dd>
                <dt>X</dt><dd>Cutaway (hide the nearest surface)</dd>
                <dt>Ctrl + click</dt><dd>Select object or marker</dd>
                <dt>Alt + click</dt><dd>Select face</dd>
              </dl>
            ) : (
              <dl className="controls-help">
                <dt>Mouse</dt><dd>Look (click to capture, Esc releases)</dd>
                <dt>W A S D</dt><dd>Move</dd>
                <dt>Arrow keys</dt><dd>Look around</dd>
                <dt>Space / E</dt><dd>Up</dd>
                <dt>C / Q</dt><dd>Down</dd>
                <dt>Shift</dt><dd>Fast (×5)</dd>
                <dt>Wheel</dt><dd>Adjust speed</dd>
                {sideView && (<><dt>V</dt><dd>Side view</dd></>)}
                <dt>R</dt><dd>Reset view</dd>
                <dt>F</dt><dd>Toggle nearest filtering</dd>
                <dt>X</dt><dd>Cutaway (hide the nearest surface)</dd>
                <dt>Ctrl + click</dt><dd>Select {level?.markers?.length ? 'object or marker' : 'object'}</dd>
                <dt>Alt + click</dt><dd>Select face</dd>
              </dl>
            )}
            <label className="check">
              <input id="nearest-toggle" type="checkbox" checked={nearest} onChange={(e) => setNearest(e.target.checked)} />
              Nearest texture filtering
            </label>
            <label
              className={`check${hasScripted ? '' : ' muted'}`}
              title="Objects the game moves along a path (shown at their start) or places at random (e.g. battle soft-block positions)"
            >
              <input id="scripted-toggle" type="checkbox" checked={showScripted} onChange={(e) => setShowScripted(e.target.checked)} />
              Show scripted/random objects
            </label>
            <label className={`check${hasFog ? '' : ' muted'}`} title={hasFog ? "The game's own distance fog" : 'No fog in this game'}>
              <input
                id="fog-toggle"
                type="checkbox"
                checked={fogOn}
                disabled={!hasFog}
                onChange={(e) => setFogOn(e.target.checked)}
              />
              Authentic fog{!hasFog && level ? <span className="small muted"> (no fog in this level)</span> : null}
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
            {hasSkyPlanes && (
              <label className="check" title="The cloud layer (and water) the game projects behind the level">
                <input id="sky-toggle" type="checkbox" checked={skyPlanesOn} onChange={(e) => setSkyPref(e.target.checked ? '' : SKY_NONE)} />
                Show sky
              </label>
            )}
            {level?.backdrop && (
              <label className="check" title="The 2D picture the game draws behind the level">
                <input id="backdrop-toggle" type="checkbox" checked={showBackdrop} onChange={(e) => setShowBackdrop(e.target.checked)} />
                Show backdrop
              </label>
            )}
            <label className="check" title="Hide the nearest surface under each pixel to look inside enclosed areas from outside (X)">
              <input id="cutaway-toggle" type="checkbox" checked={cutaway} onChange={(e) => setCutaway(e.target.checked)} />
              Cutaway (X)
            </label>
            <label className="check" title="Hide the back sides of single-sided polygons, as the game does">
              <input id="cull-toggle" type="checkbox" checked={cullOn} onChange={(e) => setCullOn(e.target.checked)} />
              Back-face culling
            </label>
          </>
        )}
      </div>
      {layers.length > 0 && (
        <div className="hud layer-panel" id="layer-panel">
          <div className="hud-row">
            <strong>Layers</strong>
            <span className="small muted">{layers.length - layers.filter((_, i) => hiddenLayers.has(i)).length} of {layers.length} shown</span>
          </div>
          {layerEntries.map((entry) => {
            if (entry.group === null) return layerRow(layers[entry.index], entry.index);
            const { group, indices } = entry;
            const shown = indices.filter((i) => !hiddenLayers.has(i)).length;
            const open = groupOpen(group, indices.length);
            const mixed = shown > 0 && shown < indices.length;
            return (
              <div key={`group:${group}`} className="layer-group" data-layer-group={group}>
                <div className="layer-group-row">
                  <button
                    type="button"
                    className="group-toggle"
                    aria-expanded={open}
                    aria-label={`${open ? 'Collapse' : 'Expand'} ${group}`}
                    onClick={() => toggleGroupOpen(group, indices.length)}
                  >
                    {open ? '▾' : '▸'}
                  </button>
                  <label className="check layer-group-check" title={`${indices.length} layer${indices.length === 1 ? '' : 's'}`}>
                    <input
                      type="checkbox"
                      data-layer-group-toggle={group}
                      checked={shown === indices.length}
                      ref={(el) => {
                        if (el) el.indeterminate = mixed;
                      }}
                      onChange={(e) => setLayersVisible(indices, e.target.checked)}
                    />
                    <span className="layer-group-name">{group}</span>
                  </label>
                  <span className="layer-group-count small muted">{shown} of {indices.length} shown</span>
                </div>
                {open && <div className="layer-group-rows">{indices.map((i) => layerRow(layers[i], i))}</div>}
              </div>
            );
          })}
        </div>
      )}
      {children}
      {reportStatus && (
        <div className={`hud report-status small${reportStatus.kind === 'error' ? ' error' : ''}`} id="report-status" role="status">
          {reportStatus.text}
        </div>
      )}
      {report && (
        <SelectionPanel
          report={report}
          texture={reportTexture}
          onClear={() => setPicked(null)}
          {...(reportAvailable ? { onReport: () => void submitReport(true), reportBusy: reportStatus?.kind === 'busy' } : {})}
        />
      )}
      </div>
    </main>
  );
}

const FOG_KEY = 'nviewer.authenticFog';
// New key: an "on" stored by the earlier culling implementation must not carry over (now off by default).
const CULL_KEY = 'nviewer.backfaceCulling.v2';

const SKY_KEY = 'nviewer.sky';
const BACKDROP_KEY = 'nviewer.showBackdrop';
const SKY_NONE = '__none__';

/** The largest rectangle of this aspect (width / height) centred in a width x height box, in whole CSS pixels. */
function fitAspect(width: number, height: number, aspect: number) {
  const w = Math.max(1, Math.min(width, Math.round(height * aspect)));
  const h = Math.max(1, Math.min(height, Math.round(w / aspect)));
  return { left: Math.floor((width - w) / 2), top: Math.floor((height - h) / 2), width: w, height: h };
}

function sideLimits(sv: SideView, level: Level): SideViewLimits {
  const min: [number, number] = [sv.bounds.min[0], sv.bounds.min[1]];
  const max: [number, number] = [sv.bounds.max[0], sv.bounds.max[1]];
  // A zero-size pan range on an axis would freeze the view there: fall back to the level's own extent.
  for (const k of [0, 1] as const) {
    if (!(max[k] > min[k]) && Number.isFinite(level.bounds.min[k]) && Number.isFinite(level.bounds.max[k])) {
      min[k] = Math.min(min[k], level.bounds.min[k]);
      max[k] = Math.max(max[k], level.bounds.max[k]);
    }
  }
  return {
    bounds: { min, max },
    minDistance: Math.min(SIDE_MIN_DISTANCE, sv.distance),
    maxDistance: Math.max(SIDE_MAX_DISTANCE, sv.distance),
  };
}

/**
 * Fade overlays under the pointer. The hover test is a ray pick against the fade layers' own triangles (with the cutout
 * alpha), whatever their current opacity, so a faded layer stays hovered. Captured free fly has no pointer: no fade.
 */
function updateFade(fade: FadeState | null, pointer: PointerState, cameraMoved: boolean, dt: number, engine: Engine, canvas: HTMLCanvasElement) {
  if (!fade) return;
  const { camera, controls, renderer } = engine;
  const locked = controls.locked;
  if (pointer.moved || cameraMoved || fade.stale || locked !== pointer.locked) {
    pointer.moved = false;
    pointer.locked = locked;
    fade.stale = false;
    let hit = -1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (pointer.inside && !locked && w > 0 && h > 0) {
      const dir = camera.rayThrough((pointer.x / w) * 2 - 1, 1 - (pointer.y / h) * 2, canvas.width / Math.max(1, canvas.height));
      const found = fade.picker.pick(camera.position, dir, { include: (i) => fade.layerOfInstance.has(i), cullBackFaces: false, minT: camera.near });
      if (found) hit = fade.layerOfInstance.get(found.instance) ?? -1;
    }
    fade.layers.forEach((l, k) => {
      l.target = k === hit ? FADED_OPACITY : 1;
    });
  }
  const step = ((1 - FADED_OPACITY) * dt) / FADE_SECONDS;
  let changed = fade.push;
  for (const l of fade.layers) {
    if (l.opacity === l.target) continue;
    l.opacity = l.opacity > l.target ? Math.max(l.target, l.opacity - step) : Math.min(l.target, l.opacity + step);
    changed = true;
  }
  if (!changed) return;
  fade.push = false;
  const opacity = new Map<number, number>();
  fade.layerOfInstance.forEach((k, inst) => {
    if (fade.layers[k].opacity < 1) opacity.set(inst, fade.layers[k].opacity);
  });
  renderer.setInstanceOpacity(opacity);
}

/** CSS pixel position of a world point (origin at the canvas's top left), or null behind the camera. */
function projectToCss(vp: Mat4, p: readonly number[], width: number, height: number): [number, number] | null {
  const w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
  if (w <= 1e-6) return null;
  const x = (vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12]) / w;
  const y = (vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13]) / w;
  return [(x * 0.5 + 0.5) * width, (0.5 - y * 0.5) * height];
}

/**
 * Position marker dots for the current camera. Labels are shown only while they fit: at most MAX_MARKER_LABELS
 * markers on screen, and greedily on a coarse grid so that overlapping labels are skipped.
 */
function layoutMarkers(entries: MarkerEntry[], camera: FlyCamera, canvas: HTMLCanvasElement, vp: Mat4) {
  if (entries.length === 0) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  camera.viewProjection(vp, canvas.width / Math.max(1, canvas.height));
  const onScreen: { e: MarkerEntry; x: number; y: number }[] = [];
  for (const e of entries) {
    const s = projectToCss(vp, e.position, width, height);
    if (!s || s[0] < -8 || s[1] < -8 || s[0] > width + 8 || s[1] > height + 8) {
      if (e.el.style.display !== 'none') e.el.style.display = 'none';
      continue;
    }
    onScreen.push({ e, x: s[0], y: s[1] });
  }
  const labels = onScreen.length <= MAX_MARKER_LABELS;
  const taken = new Set<number>();
  for (const { e, x, y } of onScreen) {
    e.el.style.display = '';
    e.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    let show = labels || e.selected;
    if (show) {
      const row = Math.floor(y / LABEL_CELL_H);
      const first = Math.floor(x / LABEL_CELL_W);
      const last = Math.floor((x + e.labelWidth) / LABEL_CELL_W);
      for (let c = first; c <= last && show; c++) if (taken.has(row * 4096 + c)) show = e.selected;
      if (show) for (let c = first; c <= last; c++) taken.add(row * 4096 + c);
    }
    e.label.style.visibility = show ? '' : 'hidden';
  }
}

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

/** Put the camera where a saved view was (position, look direction, speed). */
function placeView(engine: Engine, view: ViewState) {
  const cam = engine.camera;
  cam.position = [...view.position];
  cam.yaw = 0;
  cam.pitch = 0;
  cam.rotate(view.yaw, view.pitch);
  engine.controls.setSpeed(view.speed);
  engine.controls.invalidate();
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
