// Messages between the UI thread and the parser worker.
import type { Level } from './rom/level';

export type WorkerRequest =
  | { type: 'open'; id: number; name: string; bytes: ArrayBuffer }
  | { type: 'restore'; id: number }
  | { type: 'close'; id: number }
  | { type: 'level'; id: number; index: number };

export interface RomSummary {
  name: string;
  size: number;
  persisted: boolean;
  ms: number;
}

export type WorkerResponse =
  | { type: 'rom'; id: number; ok: true; rom: RomSummary }
  | { type: 'rom'; id: number; ok: false; error: string | null } // null error: nothing cached
  | { type: 'closed'; id: number }
  | { type: 'level'; id: number; ok: true; level: Level; ms: number }
  | { type: 'level'; id: number; ok: false; error: string };
