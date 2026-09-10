import { useCallback, useEffect, useRef, useState } from 'react';
import { LEVELS, type Level } from '../rom/level';
import { clearCachedRom } from '../romCache';
import { Landing } from './Landing';
import { computeStats, type LevelStats } from './levelStats';
import { Sidebar } from './Sidebar';
import { useFileDrop } from './useFileDrop';
import { Viewport } from './Viewport';
import { ParserClient } from './workerClient';

type RomState =
  | { status: 'checking' }
  | { status: 'empty' }
  | { status: 'ready'; name: string };

const LAST_LEVEL_KEY = 'nviewer.lastLevel';
const MAX_ROM_BYTES = 128 * 1024 * 1024;

function readLastLevel(): number {
  try {
    const v = Number(localStorage.getItem(LAST_LEVEL_KEY));
    return Number.isInteger(v) && v >= 0 && v < LEVELS.length ? v : 0;
  } catch {
    return 0;
  }
}

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
        setLoading(index);
        try {
          const { level: loaded, ms } = await client.loadLevel(index);
          if (wanted.current !== index) continue;
          setLevel(loaded);
          setLevelError(null);
          setStats((s) => ({ ...s, [index]: computeStats(loaded, ms) }));
        } catch (e) {
          if (wanted.current !== index) continue;
          setLevel(null);
          setLevelError(`Could not load ${LEVELS[index].name}: ${e instanceof Error ? e.message : String(e)}`);
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
      setSelected(index);
      try {
        localStorage.setItem(LAST_LEVEL_KEY, String(index));
      } catch {
        /* storage unavailable */
      }
      wanted.current = index;
      void pumpLevels();
    },
    [pumpLevels],
  );

  useEffect(() => {
    const client = new ParserClient();
    clientRef.current = client;
    let cancelled = false;
    client
      .restore()
      .then((summary) => {
        if (cancelled) return;
        if (summary) {
          setRom({ status: 'ready', name: summary.name });
          selectLevel(readLastLevel());
        } else {
          setRom({ status: 'empty' });
        }
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
  }, [selectLevel]);

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
        const summary = await client.open(file.name, bytes);
        setRom({ status: 'ready', name: summary.name });
        setStats({});
        setLevel(null);
        selectLevel(selected ?? readLastLevel());
      } catch (e) {
        setRomError(`Could not open "${file.name}": ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setRomBusy(null);
      }
    },
    [selectLevel, selected],
  );

  const dragging = useFileDrop(openFile);

  const forgetRom = useCallback(async () => {
    wanted.current = null;
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
      {rom.status === 'ready' ? (
        <div className="app">
          <Sidebar
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
            loadingName={romBusy ?? (loading !== null ? LEVELS[loading].name : null)}
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
