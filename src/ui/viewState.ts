// The camera of the shown level (free fly or side view), kept per browser tab in sessionStorage so that a reload or a
// hot update of the page comes back to the same spot. One small entry, replaced as the view changes.
import type { Level } from '../rom';

const VIEW_KEY = 'nviewer.view';

export interface ViewState {
  key: string; // the game and level the view belongs to (viewStateKey)
  position: [number, number, number];
  yaw: number;
  pitch: number;
  speed: number;
  sideView: boolean; // the side-scroller view was active (else free fly)
}

/** Identity of a loaded level for the saved view: game id and title (distinguishes ROM versions), level id and index. */
export function viewStateKey(gameId: string | null | undefined, gameTitle: string | null | undefined, level: Level): string {
  return JSON.stringify([gameId ?? '', gameTitle ?? '', level.id, level.info.index]);
}

export function saveViewState(state: ViewState) {
  try {
    sessionStorage.setItem(VIEW_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
}

/** The saved view if it belongs to this level key and is well formed, else null. */
export function loadViewState(key: string): ViewState | null {
  try {
    const raw = sessionStorage.getItem(VIEW_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ViewState> | null;
    const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
    const p = v?.position;
    if (!v || v.key !== key || !Array.isArray(p) || p.length !== 3 || !p.every(finite)) return null;
    if (!finite(v.yaw) || !finite(v.pitch) || !finite(v.speed) || v.speed <= 0) return null;
    return { key, position: [p[0], p[1], p[2]], yaw: v.yaw, pitch: v.pitch, speed: v.speed, sideView: v.sideView === true };
  } catch {
    return null;
  }
}
