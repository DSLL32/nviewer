// Bug reports contain two PNG frames of the view and a JSON description. The dev server accepts them at /__report;
// standalone/production viewers package the same three files into a ZIP download instead.
import type { FlyCamera } from '../render/camera';
import type { LevelRenderer } from '../render/renderer';

declare const __NVIEWER_BUILD_TIME__: string | undefined;

/** When this build of the viewer was made (Vite define), if known. */
export const BUILD_TIME: string | null = typeof __NVIEWER_BUILD_TIME__ === 'string' ? __NVIEWER_BUILD_TIME__ : null;

const REPORT_URL = '/__report';
type ReportTarget = 'server' | 'download';
export type ReportResult = { kind: 'server'; serial: number } | { kind: 'download'; filename: string };

let probe: Promise<ReportTarget> | null = null;

/** Pick the dev-server endpoint when it answers; every other build can still export a report locally. */
function reportTarget(): Promise<ReportTarget> {
  if (location.protocol === 'file:' || !import.meta.env.DEV) return Promise.resolve('download');
  probe ??= fetch(REPORT_URL, { headers: { accept: 'application/json' } })
    .then(async (r): Promise<ReportTarget> =>
      r.ok && ((await r.json().catch(() => null)) as { reports?: unknown } | null)?.reports === true ? 'server' : 'download',
    )
    .catch(() => 'download');
  return probe;
}

/** Whether reports can be sent to the dev server or downloaded by the browser. */
export function reportDeliveryAvailable(): Promise<boolean> {
  return reportTarget().then(() => true);
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

/** Send a report to the dev server, or download it as a ZIP when no report endpoint exists. */
export async function sendReport(view: Blob, highlight: Blob, details: unknown): Promise<ReportResult> {
  if ((await reportTarget()) === 'download') return downloadReport(view, highlight, details);

  const form = new FormData();
  form.append('view.png', view, 'view.png');
  form.append('highlight.png', highlight, 'highlight.png');
  form.append('details.json', new Blob([JSON.stringify(details, null, 2)], { type: 'application/json' }), 'details.json');
  const response = await fetch(REPORT_URL, { method: 'POST', body: form });
  const body = (await response.json().catch(() => null)) as { serial?: unknown; error?: unknown } | null;
  if (!response.ok || typeof body?.serial !== 'number') {
    throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`);
  }
  return { kind: 'server', serial: body.serial };
}

async function downloadReport(view: Blob, highlight: Blob, details: unknown): Promise<ReportResult> {
  const filename = `${Math.floor(Date.now() / 1000)}.zip`;
  const json = new Blob([JSON.stringify(details, null, 2)], { type: 'application/json' });
  const zip = await makeZip([
    { name: 'view.png', data: new Uint8Array(await view.arrayBuffer()) },
    { name: 'highlight.png', data: new Uint8Array(await highlight.arrayBuffer()) },
    { name: 'details.json', data: new Uint8Array(await json.arrayBuffer()) },
  ]);
  const href = URL.createObjectURL(zip);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(href), 0);
  return { kind: 'download', filename };
}

interface ZipEntry {
  name: string;
  data: Uint8Array<ArrayBuffer>;
}

/** Build a ZIP with stored (uncompressed) entries, so the standalone viewer needs no compression dependency. */
async function makeZip(entries: readonly ZipEntry[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime = ((now.getHours() & 0x1f) << 11) | ((now.getMinutes() & 0x3f) << 5) | ((now.getSeconds() >> 1) & 0x1f);
  const dosDate = (((Math.max(1980, Math.min(2107, now.getFullYear())) - 1980) & 0x7f) << 9) | (((now.getMonth() + 1) & 0x0f) << 5) | (now.getDate() & 0x1f);
  const locals: Uint8Array<ArrayBuffer>[] = [];
  const centrals: Uint8Array<ArrayBuffer>[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + name.length + entry.data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true); // version needed: ZIP 2.0
    localView.setUint16(6, 0x0800, true); // UTF-8 names
    localView.setUint16(8, 0, true); // stored, not compressed
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, entry.data.length, true);
    localView.setUint32(22, entry.data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(entry.data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true); // creator version
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, entry.data.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);
    centrals.push(central);
    localOffset += local.length;
  }

  const centralSize = centrals.reduce((size, part) => size + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, localOffset, true);
  return new Blob([...locals, ...centrals, end], { type: 'application/zip' });
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < table.length; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
