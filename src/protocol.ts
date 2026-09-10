// Messages between the UI thread and the parser worker.
import type { Game, Level, LevelInfo } from './rom';

export type WorkerRequest =
  | { type: 'open'; id: number; name: string; bytes: ArrayBuffer }
  | { type: 'restore'; id: number }
  | { type: 'close'; id: number }
  | { type: 'level'; id: number; index: number };

export interface RomSummary {
  gameId: Game['id'];
  title: string;
  levels: LevelInfo[];
  name: string; // file name
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
