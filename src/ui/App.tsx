import { useCallback, useEffect, useRef, useState } from 'react';
import type { RomSummary } from '../protocol';
import type { Level, LevelInfo } from '../rom';
import { clearCachedRom } from '../romCache';
import { Landing } from './Landing';
import { computeStats, type LevelStats } from './levelStats';
import { Sidebar } from './Sidebar';
import { useFileDrop } from './useFileDrop';
import { Viewport } from './Viewport';
import { ParserClient } from './workerClient';

interface GameInfo {
  id: string;
  title: string;
  levels: LevelInfo[];
}

type RomState =
  | { status: 'checking' }
  | { status: 'empty' }
  | { status: 'ready'; name: string; game: GameInfo };

const MAX_ROM_BYTES = 128 * 1024 * 1024;

// The remembered level is stored per game, so switching ROMs never restores an index the other game lacks.
const lastLevelKey = (gameId: string) => `nviewer.lastLevel.${gameId}`;

function readLastLevel(game: GameInfo): number {
  const fallback = game.levels[0]?.index ?? 0;
  try {
    const raw = localStorage.getItem(lastLevelKey(game.id));
    const v = raw === null ? NaN : Number(raw);
    return game.levels.some((l) => l.index === v) ? v : fallback;
  } catch {
    return fallback;
  }
}

const gameOf = (s: RomSummary): GameInfo => ({ id: s.gameId, title: s.title, levels: s.levels });
const levelName = (game: GameInfo | null, index: number) => game?.levels.find((l) => l.index === index)?.name ?? `Level ${index}`;

export function App() {
  const clientRef = useRef<ParserClient | null>(null);
  const [rom, setRom] = useState<RomState>({ status: 'checking' });
  const [romBusy, setRomBusy] = useState<string | null>(null);
  const [romError, setRomError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState<number | null>(null);
  const [level, setLevel] = useState<Level | null>(null);
  const [levelError, setLevelError] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<number, LevelStats>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  const gameRef = useRef<GameInfo | null>(null);
  const selectedRef = useRef<number | null>(null);
  // Bumped whenever the open ROM changes; level results from an older ROM are discarded.
  const generation = useRef(0);

  // Level requests are coalesced: while one parse runs, only the most recent selection is queued.
  const wanted = useRef<number | null>(null);
  const busy = useRef(false);

  const pumpLevels = useCallback(async () => {
    const client = clientRef.current;
    if (busy.current || !client) return;
    busy.current = true;
    try {
      while (wanted.current !== null) {
        const index = wanted.current;
        const gen = generation.current;
        setLoading(index);
        try {
          const { level: loaded, ms } = await client.loadLevel(index);
          if (wanted.current !== index || generation.current !== gen) continue;
          setLevel(loaded);
          setLevelError(null);
          setStats((s) => ({ ...s, [index]: computeStats(loaded, ms) }));
        } catch (e) {
          if (wanted.current !== index || generation.current !== gen) continue;
          setLevel(null);
          setLevelError(`Could not load ${levelName(gameRef.current, index)}: ${e instanceof Error ? e.message : String(e)}`);
        }
        wanted.current = null;
      }
    } finally {
      busy.current = false;
      setLoading(null);
    }
  }, []);

  const selectLevel = useCallback(
    (index: number) => {
      const game = gameRef.current;
      if (!game || !game.levels.some((l) => l.index === index)) return;
      setSelected(index);
      selectedRef.current = index;
      try {
        localStorage.setItem(lastLevelKey(game.id), String(index));
      } catch {
        /* storage unavailable */
      }
      wanted.current = index;
      void pumpLevels();
    },
    [pumpLevels],
  );

  /** Switch the UI to a newly opened (or restored) ROM. */
  const activateRom = useCallback(
    (summary: RomSummary) => {
      const previous = gameRef.current;
      const game = gameOf(summary);
      generation.current++;
      gameRef.current = game;
      setRom({ status: 'ready', name: summary.name, game });
      setStats({});
      setLevel(null);
      setLevelError(null);
      const keep = previous?.id === game.id && selectedRef.current !== null && game.levels.some((l) => l.index === selectedRef.current);
      selectLevel(keep ? selectedRef.current! : readLastLevel(game));
    },
    [selectLevel],
  );

  useEffect(() => {
    const client = new ParserClient();
    clientRef.current = client;
    let cancelled = false;
    client
      .restore()
      .then((summary) => {
        if (cancelled) return;
        if (summary) activateRom(summary);
        else setRom({ status: 'empty' });
      })
      .catch((e) => {
        if (cancelled) return;
        setRom({ status: 'empty' });
        setRomError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
      client.dispose();
      clientRef.current = null;
    };
  }, [activateRom]);

  const openFile = useCallback(
    async (file: File) => {
      const client = clientRef.current;
      if (!client) return;
      setRomError(null);
      if (file.size < 0x1000 || file.size > MAX_ROM_BYTES) {
        setRomError(`"${file.name}" is not an N64 ROM (unexpected size: ${file.size.toLocaleString()} bytes).`);
        return;
      }
      setRomBusy(`Opening ${file.name}…`);
      try {
        const bytes = await file.arrayBuffer();
        activateRom(await client.open(file.name, bytes));
      } catch (e) {
        setRomError(`Could not open "${file.name}": ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setRomBusy(null);
      }
    },
    [activateRom],
  );

  const dragging = useFileDrop(openFile);

  const forgetRom = useCallback(async () => {
    wanted.current = null;
    generation.current++;
    gameRef.current = null;
    selectedRef.current = null;
    await clearCachedRom().catch(() => {});
    await clientRef.current?.close().catch(() => {});
    setLevel(null);
    setSelected(null);
    setStats({});
    setLevelError(null);
    setRomError(null);
    setRom({ status: 'empty' });
  }, []);

  const pickFile = () => fileInput.current?.click();
  const game = rom.status === 'ready' ? rom.game : null;

  return (
    <>
      <input
        ref={fileInput}
        id="rom-input"
        type="file"
        accept=".z64,.v64,.n64,.rom,.bin"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void openFile(file);
        }}
      />
      {rom.status === 'ready' && game ? (
        <div className="app">
          <Sidebar
            gameTitle={game.title}
            levels={game.levels}
            selected={selected}
            loading={loading}
            stats={stats}
            romName={rom.name}
            onSelect={selectLevel}
            onReplaceRom={pickFile}
            onForgetRom={forgetRom}
          />
          <Viewport
            level={level}
            loadingName={romBusy ?? (loading !== null ? levelName(game, loading) : null)}
            error={levelError}
          />
          {romError && (
            <div className="toast error" role="alert">
              {romError}
              <button type="button" className="link" onClick={() => setRomError(null)}>Dismiss</button>
            </div>
          )}
        </div>
      ) : (
        <Landing
          busy={rom.status === 'checking' ? 'Checking for a saved ROM…' : romBusy}
          error={romError}
          onPick={pickFile}
        />
      )}
      {dragging && (
        <div className="drop-overlay">
          <div>Drop the ROM to load it</div>
        </div>
      )}
    </>
  );
}
