// Bounded, deterministic parallelism for ROM checking tools.
import { spawn, type ChildProcess } from 'node:child_process';

const WORKER_ROM = '--worker-rom';

export interface JobArguments {
  args: string[];
  jobs: number;
  workerRom: string | null;
}

export function parseJobArguments(raw: string[]): JobArguments {
  const args: string[] = [];
  let jobs = 1;
  let workerRom: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    if (arg === '--jobs') {
      if (++i >= raw.length) throw new Error('--jobs requires a positive integer');
      jobs = Number(raw[i]);
    } else if (arg.startsWith('--jobs=')) {
      jobs = Number(arg.slice('--jobs='.length));
    } else if (arg === WORKER_ROM) {
      if (++i >= raw.length) throw new Error(`${WORKER_ROM} requires a ROM path`);
      workerRom = raw[i];
    } else {
      args.push(arg);
    }
  }
  if (!Number.isSafeInteger(jobs) || jobs < 1 || jobs > 32)
    throw new Error(`invalid --jobs value ${jobs}; expected an integer from 1 through 32`);
  return { args, jobs, workerRom };
}

interface JobResult {
  code: number;
  stdout: Buffer;
  stderr: Buffer;
}

// Spawn this same TypeScript entry point once per ROM. Results are buffered and
// emitted in ROM order, regardless of which worker finishes first.
export async function runRomJobs(roms: string[], jobs: number, args: string[]): Promise<boolean> {
  const results: (JobResult | undefined)[] = new Array(roms.length);
  const children = new Set<ChildProcess>();
  let next = 0;
  let interrupted = false;

  const stop = (signal: NodeJS.Signals) => {
    interrupted = true;
    for (const child of children) child.kill(signal);
  };
  const onInterrupt = () => stop('SIGINT');
  const onTerminate = () => stop('SIGTERM');
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);

  const run = (rom: string): Promise<JobResult> => new Promise((resolve) => {
    const child = spawn(process.execPath, [...process.execArgv, process.argv[1], ...args, WORKER_ROM, rom], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.add(child);
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    child.stdout!.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr!.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => stderr.push(Buffer.from(`${error.message}\n`)));
    child.on('close', (code) => {
      children.delete(child);
      resolve({ code: code ?? 1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });

  const worker = async () => {
    while (!interrupted) {
      const index = next++;
      if (index >= roms.length) return;
      results[index] = await run(roms[index]);
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(jobs, roms.length) }, worker));
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    for (const child of children) child.kill('SIGTERM');
  }

  let ok = !interrupted;
  for (const result of results) {
    if (!result) { ok = false; continue; }
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    if (result.code !== 0) ok = false;
  }
  return ok;
}
