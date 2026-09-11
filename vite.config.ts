// Vite configuration: the build time for bug reports, and a dev-server-only endpoint that saves bug reports.
//
// POST /__report (dev server only; production builds have no endpoint), multipart/form-data with exactly three file
// fields:
//   view.png       PNG of the view as drawn, without the selection highlight
//   highlight.png  PNG of the same frame with the selection highlight (the view again when nothing is highlighted)
//   details.json   a JSON object describing the report (description, camera, level, selection, toggles, ...)
// Response: 200 {"serial": N}; rejected requests get 4xx {"error": "..."}. GET /__report answers {"reports": true}
// (the client's availability probe).
// Files, in reports/ at the project root (or the folder in $NVIEWER_REPORTS_DIR): .serial holds the last used number;
// each report is NNNN.view.png, NNNN.highlight.png and NNNN.json (the number zero-padded to 4 digits). Every file is
// written to a temporary dot-file and renamed into place, the JSON last: a report is complete once its JSON exists.
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { defineConfig, type Plugin } from 'vite';

const REPORT_MAX_BYTES = 30 * 1024 * 1024;
const REPORT_FIELDS = ['view.png', 'highlight.png', 'details.json'];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function reportPlugin(): Plugin {
  return {
    name: 'nviewer-report',
    apply: 'serve',
    configureServer(server) {
      const dir = path.resolve(server.config.root, process.env.NVIEWER_REPORTS_DIR || 'reports');
      // Reports are numbered and written one at a time.
      let queue: Promise<unknown> = Promise.resolve();
      const serialize = <T>(job: () => Promise<T>): Promise<T> => {
        const run = queue.then(job);
        queue = run.catch(() => undefined);
        return run;
      };
      server.middlewares.use('/__report', (req, res) => {
        handleReport(req, res, dir, serialize).catch((e: unknown) =>
          send(res, e instanceof HttpError ? e.status : 500, { error: e instanceof Error ? e.message : String(e) }),
        );
      });
    },
  };
}

async function handleReport(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string,
  serialize: <T>(job: () => Promise<T>) => Promise<T>,
) {
  if (req.method === 'GET' || req.method === 'HEAD') return send(res, 200, { reports: true });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    throw new HttpError(405, 'Use POST');
  }
  if (!/^multipart\/form-data\s*;/i.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'Expected multipart/form-data');
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > REPORT_MAX_BYTES) throw new HttpError(413, 'Report too large');

  // The body as a WHATWG stream, cut off past the size cap.
  let received = 0;
  let tooLarge = false;
  const limited = Readable.from(
    (async function* () {
      for await (const chunk of req as AsyncIterable<Buffer>) {
        received += chunk.length;
        if (received > REPORT_MAX_BYTES) {
          tooLarge = true;
          throw new HttpError(413, 'Report too large');
        }
        yield chunk;
      }
    })(),
  );
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) for (const v of value) headers.append(name, v);
  }
  let form: FormData;
  try {
    const init = { method: 'POST', headers, body: Readable.toWeb(limited) as unknown as ReadableStream, duplex: 'half' };
    form = await new Request('http://localhost/__report', init as RequestInit).formData();
  } catch {
    throw tooLarge ? new HttpError(413, 'Report too large') : new HttpError(400, 'Malformed multipart/form-data');
  }

  const names = [...form.keys()];
  if (names.length !== REPORT_FIELDS.length || !REPORT_FIELDS.every((n) => form.getAll(n).length === 1)) {
    throw new HttpError(400, `Expected exactly the file fields ${REPORT_FIELDS.join(', ')}`);
  }
  const bytesOf = async (name: string) => {
    const value = form.get(name);
    if (value === null || typeof value === 'string') throw new HttpError(400, `${name} must be a file`);
    return new Uint8Array(await value.arrayBuffer());
  };
  const view = await bytesOf('view.png');
  const highlight = await bytesOf('highlight.png');
  const json = await bytesOf('details.json');
  for (const [name, bytes] of [['view.png', view], ['highlight.png', highlight]] as const) {
    if (bytes.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) throw new HttpError(400, `${name} is not a PNG`);
  }
  let details: unknown;
  try {
    details = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json));
  } catch {
    throw new HttpError(400, 'details.json is not valid JSON');
  }
  if (!details || typeof details !== 'object' || Array.isArray(details)) throw new HttpError(400, 'details.json must be a JSON object');

  const serial = await serialize(() => saveReport(dir, view, highlight, details as Record<string, unknown>));
  send(res, 200, { serial });
}

async function saveReport(dir: string, view: Uint8Array, highlight: Uint8Array, details: Record<string, unknown>): Promise<number> {
  await mkdir(dir, { recursive: true });
  const serialPath = path.join(dir, '.serial');
  const last = Number.parseInt(await readFile(serialPath, 'utf8').catch(() => '0'), 10);
  // Never reuse the number of a report already on disk (e.g. if .serial was deleted).
  let onDisk = 0;
  for (const f of await readdir(dir)) {
    const m = /^(\d+)\.(json|view\.png|highlight\.png)$/.exec(f);
    if (m) onDisk = Math.max(onDisk, Number(m[1]));
  }
  const serial = Math.max(Number.isFinite(last) ? last : 0, onDisk) + 1;
  await writeAtomic(serialPath, `${serial}\n`);
  const base = String(serial).padStart(4, '0');
  await writeAtomic(path.join(dir, `${base}.view.png`), view);
  await writeAtomic(path.join(dir, `${base}.highlight.png`), highlight);
  const record = { ...details, serial, receivedAt: new Date().toISOString(), files: { view: `${base}.view.png`, highlight: `${base}.highlight.png` } };
  await writeAtomic(path.join(dir, `${base}.json`), `${JSON.stringify(record, null, 2)}\n`);
  return serial;
}

async function writeAtomic(file: string, data: string | Uint8Array) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  await writeFile(tmp, data);
  await rename(tmp, file);
}

function send(res: ServerResponse, status: number, body: unknown) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  // Rejected uploads may not have been read to the end: don't keep the connection.
  if (status >= 400) res.setHeader('Connection', 'close');
  res.end(JSON.stringify(body));
}

export default defineConfig({
  plugins: [reportPlugin()],
  define: { __NVIEWER_BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  // Saved reports are not part of the app.
  server: { watch: { ignored: ['**/reports/**'] } },
});
