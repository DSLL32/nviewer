import { useCallback, useEffect, useRef, useState } from 'react';
import type { RomSummary } from '../protocol';
import type { Level } from '../rom';
import { Landing } from './Landing';
import { MusicBox } from './MusicBox';
import { computeStats, type LevelStats } from './levelStats';
import { Sidebar, sameLevelRef, type LevelRef, type SidebarGame } from './Sidebar';
import { useFileDrop } from './useFileDrop';
import { Viewport } from './Viewport';
import { ParserClient } from './workerClient';

const MAX_ROM_BYTES = 128 * 1024 * 1024;

// The remembered level is stored per game, so a game never restores an index it lacks.
const lastLevelKey = (gameId: string) => `nviewer.lastLevel.${gameId}`;
const LAST_SELECTION_KEY = 'nviewer.lastSelection';
const COLLAPSED_KEY = 'nviewer.collapsedGames';

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

function readLastLevel(game: SidebarGame): number {
  const fallback = game.levels[0]?.index ?? 0;
  const raw = readStorage(lastLevelKey(game.id));
  const v = raw === null ? NaN : Number(raw);
  return game.levels.some((l) => l.index === v) ? v : fallback;
}

function readLastSelection(): LevelRef | null {
  try {
    const v = JSON.parse(readStorage(LAST_SELECTION_KEY) ?? 'null') as Partial<LevelRef> | null;
    return v && typeof v.gameId === 'string' && typeof v.index === 'number' ? { gameId: v.gameId, index: v.index } : null;
  } catch {
    return null;
  }
}

function readCollapsed(): Record<string, boolean> {
  try {
    const v = JSON.parse(readStorage(COLLAPSED_KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

const gameOf = (s: RomSummary): SidebarGame => ({ id: s.gameId, title: s.title, fileName: s.name, levels: s.levels, music: s.music });

const levelName = (games: SidebarGame[], ref: LevelRef) => {
  const game = games.find((g) => g.id === ref.gameId);
  return game?.levels.find((l) => l.index === ref.index)?.name ?? `Level ${ref.index}`;
};

export function App() {
  const clientRef = useRef<ParserClient | null>(null);
  const [checking, setChecking] = useState(true);
  const [games, setGames] = useState<SidebarGame[]>([]);
  const [romBusy, setRomBusy] = useState<string | null>(null);
  const [romError, setRomError] = useState<string | null>(null);
  const [selected, setSelected] = useState<LevelRef | null>(null);
  const [loading, setLoading] = useState<LevelRef | null>(null);
  const [level, setLevel] = useState<Level | null>(null);
  const [levelGameId, setLevelGameId] = useState<string | null>(null);
  const [levelError, setLevelError] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, Record<number, LevelStats>>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed);
  const fileInput = useRef<HTMLInputElement>(null);

  const gamesRef = useRef<SidebarGame[]>([]);
  const selectedRef = useRef<LevelRef | null>(null);
  // Bumped per game whenever its ROM is replaced or removed; level results from an older ROM are discarded.
  const generations = useRef(new Map<string, number>());
  const generationOf = (gameId: string) => generations.current.get(gameId) ?? 0;
  const bumpGeneration = (gameId: string) => generations.current.set(gameId, generationOf(gameId) + 1);

  // Sections are kept in a stable order (by title) regardless of load or restore order.
  const updateGames = useCallback((next: SidebarGame[]) => {
    const sorted = [...next].sort((x, y) => x.title.localeCompare(y.title));
    gamesRef.current = sorted;
    setGames(sorted);
  }, []);

  // Level requests are coalesced: while one parse runs, only the most recent selection is queued.
  const wanted = useRef<LevelRef | null>(null);
  const busy = useRef(false);

  const pumpLevels = useCallback(async () => {
    const client = clientRef.current;
    if (busy.current || !client) return;
    busy.current = true;
    try {
      while (wanted.current !== null) {
        const ref = wanted.current;
        const gen = generationOf(ref.gameId);
        setLoading(ref);
        try {
          const { level: loaded, ms } = await client.loadLevel(ref.gameId, ref.index);
          if (!sameLevelRef(wanted.current, ref) || generationOf(ref.gameId) !== gen) continue;
          setLevel(loaded);
          setLevelGameId(ref.gameId);
          setLevelError(null);
          setStats((s) => ({ ...s, [ref.gameId]: { ...(s[ref.gameId] ?? {}), [ref.index]: computeStats(loaded, ms) } }));
        } catch (e) {
          if (!sameLevelRef(wanted.current, ref) || generationOf(ref.gameId) !== gen) continue;
          setLevel(null);
          setLevelError(`Could not load ${levelName(gamesRef.current, ref)}: ${e instanceof Error ? e.message : String(e)}`);
        }
        wanted.current = null;
      }
    } finally {
      busy.current = false;
      setLoading(null);
    }
  }, []);

  const selectLevel = useCallback(
    (ref: LevelRef) => {
      const game = gamesRef.current.find((g) => g.id === ref.gameId);
      if (!game || !game.levels.some((l) => l.index === ref.index)) return;
      setSelected(ref);
      selectedRef.current = ref;
      writeStorage(lastLevelKey(game.id), String(ref.index));
      writeStorage(LAST_SELECTION_KEY, JSON.stringify(ref));
      wanted.current = ref;
      void pumpLevels();
    },
    [pumpLevels],
  );

  /** Add a newly opened ROM, or replace the ROM of a game that is already loaded. */
  const addGame = useCallback(
    (summary: RomSummary) => {
      const info = gameOf(summary);
      bumpGeneration(info.id);
      const current = gamesRef.current;
      const replaced = current.some((g) => g.id === info.id);
      updateGames(replaced ? current.map((g) => (g.id === info.id ? info : g)) : [...current, info]);
      setStats((s) => {
        const next = { ...s };
        delete next[info.id];
        return next;
      });
      setCollapsed((c) => (c[info.id] ? { ...c, [info.id]: false } : c));
      const sel = selectedRef.current;
      if (!sel) {
        selectLevel({ gameId: info.id, index: readLastLevel(info) });
      } else if (sel.gameId === info.id) {
        // The shown level belonged to the replaced ROM: load it again from the new one.
        setLevel(null);
        const index = info.levels.some((l) => l.index === sel.index) ? sel.index : readLastLevel(info);
        selectLevel({ gameId: info.id, index });
      }
    },
    [selectLevel, updateGames],
  );

  useEffect(() => {
    const client = new ParserClient();
    clientRef.current = client;
    let cancelled = false;
    client
      .restore()
      .then(({ roms, errors }) => {
        if (cancelled) return;
        const restored = roms.map(gameOf);
        updateGames(restored);
        if (restored.length > 0) {
          const last = readLastSelection();
          const lastGame = last && restored.find((g) => g.id === last.gameId && g.levels.some((l) => l.index === last.index));
          selectLevel(lastGame && last ? last : { gameId: restored[0].id, index: readLastLevel(restored[0]) });
        }
        if (errors.length) setRomError(errors.join(' '));
        setChecking(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setRomError(e instanceof Error ? e.message : String(e));
        setChecking(false);
      });
    return () => {
      cancelled = true;
      client.dispose();
      clientRef.current = null;
    };
  }, [selectLevel, updateGames]);

  useEffect(() => writeStorage(COLLAPSED_KEY, JSON.stringify(collapsed)), [collapsed]);

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
        addGame(await client.open(file.name, bytes));
      } catch (e) {
        setRomError(`Could not open "${file.name}": ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setRomBusy(null);
      }
    },
    [addGame],
  );

  const dragging = useFileDrop(openFile);

  const removeGame = useCallback(
    async (gameId: string) => {
      bumpGeneration(gameId);
      await clientRef.current?.remove(gameId).catch(() => {});
      const next = gamesRef.current.filter((g) => g.id !== gameId);
      updateGames(next);
      setStats((s) => {
        const copy = { ...s };
        delete copy[gameId];
        return copy;
      });
      if (selectedRef.current?.gameId === gameId) {
        if (wanted.current?.gameId === gameId) wanted.current = null;
        selectedRef.current = null;
        setSelected(null);
        setLevel(null);
        setLevelError(null);
        if (next.length > 0) selectLevel({ gameId: next[0].id, index: readLastLevel(next[0]) });
      }
    },
    [selectLevel, updateGames],
  );

  const toggleCollapsed = useCallback((gameId: string) => setCollapsed((c) => ({ ...c, [gameId]: !c[gameId] })), []);

  const decodeMusic = useCallback((gameId: string, index: number) => {
    const client = clientRef.current;
    return client ? client.decodeMusic(gameId, index) : Promise.reject(new Error('Parser not ready'));
  }, []);

  const pickFile = () => fileInput.current?.click();

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
      {!checking && games.length > 0 ? (
        <div className="app">
          <Sidebar
            games={games}
            selected={selected}
            loading={loading}
            stats={stats}
            collapsed={collapsed}
            onToggleCollapsed={toggleCollapsed}
            onSelect={selectLevel}
            onRemove={(id) => void removeGame(id)}
            onAddRom={pickFile}
          />
          <Viewport
            level={level}
            gameId={levelGameId}
            gameTitle={games.find((g) => g.id === levelGameId)?.title ?? null}
            loadingName={romBusy ?? (loading !== null ? levelName(games, loading) : null)}
            error={levelError}
          >
            <MusicBox games={games} currentGameId={selected?.gameId ?? null} decode={decodeMusic} />
          </Viewport>
          {romError && (
            <div className="toast error" role="alert">
              {romError}
              <button type="button" className="link" onClick={() => setRomError(null)}>Dismiss</button>
            </div>
          )}
        </div>
      ) : (
        <Landing busy={checking ? 'Checking for saved ROMs…' : romBusy} error={romError} onPick={pickFile} />
      )}
      {dragging && (
        <div className="drop-overlay">
          <div>Drop a ROM to add it</div>
        </div>
      )}
    </>
  );
}
