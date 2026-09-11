// Bug reports to the dev server's endpoint (vite.config.ts, POST /__report): two PNG frames of the view and a JSON
// description. Production builds have no endpoint; the selection panel then offers Copy instead.
import type { FlyCamera } from '../render/camera';
import type { LevelRenderer } from '../render/renderer';

declare const __NVIEWER_BUILD_TIME__: string | undefined;

/** When this build of the viewer was made (Vite define), if known. */
export const BUILD_TIME: string | null = typeof __NVIEWER_BUILD_TIME__ === 'string' ? __NVIEWER_BUILD_TIME__ : null;

const REPORT_URL = '/__report';
let probe: Promise<boolean> | null = null;

/** Whether the report endpoint answers (only the dev server has one). Probed once. */
export function reportEndpointAvailable(): Promise<boolean> {
  if (!import.meta.env.DEV) return Promise.resolve(false);
  probe ??= fetch(REPORT_URL, { headers: { accept: 'application/json' } })
    .then(async (r) => r.ok && ((await r.json().catch(() => null)) as { reports?: unknown } | null)?.reports === true)
    .catch(() => false);
  return probe;
}

/**
 * Draw one frame, with or without the selection highlight, and read the canvas right away (in the same task, before the
 * browser presents and clears the drawing buffer), as PNG at the canvas's current size.
 */
export function captureFrame(renderer: LevelRenderer, camera: FlyCamera, highlight: boolean): Promise<Blob> {
  const canvas = renderer.gl.canvas as HTMLCanvasElement;
  return new Promise((resolve, reject) => {
    renderer.render(camera, { highlight });
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('could not read the view'))), 'image/png');
  });
}

/** Send a report; resolves to the serial number the server gave it. */
export async function sendReport(view: Blob, highlight: Blob, details: unknown): Promise<number> {
  const form = new FormData();
  form.append('view.png', view, 'view.png');
  form.append('highlight.png', highlight, 'highlight.png');
  form.append('details.json', new Blob([JSON.stringify(details, null, 2)], { type: 'application/json' }), 'details.json');
  const response = await fetch(REPORT_URL, { method: 'POST', body: form });
  const body = (await response.json().catch(() => null)) as { serial?: unknown; error?: unknown } | null;
  if (!response.ok || typeof body?.serial !== 'number') {
    throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`);
  }
  return body.serial;
}
