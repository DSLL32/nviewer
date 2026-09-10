// Promise wrapper around the parser worker.
import type { RomSummary, WorkerRequest, WorkerResponse } from '../protocol';
import type { Level } from '../rom';

type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void };
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export class ParserClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      p.resolve(e.data);
    };
    this.worker.onerror = (e) => {
      const err = new Error(`Parser worker failed: ${e.message || 'unknown error'}`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
  }

  private request(msg: DistributiveOmit<WorkerRequest, 'id'>, transfer: Transferable[] = []): Promise<WorkerResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...msg, id } as WorkerRequest, transfer);
    });
  }

  /**
   * Validate and open a ROM; the buffer is transferred to the worker. A ROM of an already open game replaces it.
   * Throws with a readable message.
   */
  async open(name: string, bytes: ArrayBuffer): Promise<RomSummary> {
    const r = await this.request({ type: 'open', name, bytes }, [bytes]);
    if (r.type !== 'rom') throw new Error('Unexpected worker response');
    if (!r.ok) throw new Error(r.error);
    return r.rom;
  }

  /** Re-open every ROM cached in IndexedDB. */
  async restore(): Promise<{ roms: RomSummary[]; errors: string[] }> {
    const r = await this.request({ type: 'restore' });
    if (r.type !== 'restored') throw new Error('Unexpected worker response');
    return { roms: r.roms, errors: r.errors };
  }

  /** Close a game and drop its cached ROM. */
  async remove(gameId: string): Promise<void> {
    await this.request({ type: 'remove', gameId });
  }

  async loadLevel(gameId: string, index: number): Promise<{ level: Level; ms: number }> {
    const r = await this.request({ type: 'level', gameId, index });
    if (r.type !== 'level') throw new Error('Unexpected worker response');
    if (!r.ok) throw new Error(r.error);
    return { level: r.level, ms: r.ms };
  }

  dispose() {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error('Parser worker terminated'));
    this.pending.clear();
  }
}
