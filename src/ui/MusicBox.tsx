import { useEffect, useRef, useState } from 'react';
import { IDLE_STATE, MusicPlayer, type PlayerState } from '../audio/musicPlayer';
import type { DecodedMusic, MusicTrack } from '../rom';

export interface MusicGame {
  id: string;
  title: string;
  music?: MusicTrack[];
}

interface MusicBoxProps {
  games: MusicGame[];
  /** Game whose level is shown; its soundtrack is listed by default. */
  currentGameId: string | null;
  decode: (gameId: string, index: number) => Promise<DecodedMusic>;
}

declare global {
  interface Window {
    /** Debug handle for the music player. */
    nviewerMusic?: MusicPlayer;
  }
}

const VISIBLE_KEY = 'nviewer.musicVisible';
const VOLUME_KEY = 'nviewer.musicVolume';

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

function readVolume(): number {
  const raw = readStorage(VOLUME_KEY);
  const v = raw === null ? NaN : Number(raw);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.7;
}

const formatTime = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export function MusicBox({ games, currentGameId, decode }: MusicBoxProps) {
  const [visible, setVisible] = useState(() => readStorage(VISIBLE_KEY) !== '0');
  const [volume, setVolume] = useState(readVolume);
  const [state, setState] = useState<PlayerState>(IDLE_STATE);
  const [elapsed, setElapsed] = useState(0);
  const [pickedGame, setPickedGame] = useState<string | null>(null);
  const playerRef = useRef<MusicPlayer | null>(null);
  const decodeRef = useRef(decode);
  decodeRef.current = decode;
  const gamesRef = useRef(games);
  gamesRef.current = games;

  /** Play the track `dir` steps away from the current one within its game's soundtrack. */
  const advanceRef = useRef((dir: number) => {
    const player = playerRef.current;
    const track = player?.state.track;
    if (!player || !track) return;
    const list = gamesRef.current.find((g) => g.id === track.gameId)?.music ?? [];
    const pos = list.findIndex((t) => t.index === track.index);
    if (list.length === 0 || pos < 0) return;
    const next = list[(pos + dir + list.length) % list.length];
    void player.play({ gameId: track.gameId, index: next.index, name: next.name });
  });

  useEffect(() => {
    const player = new MusicPlayer((g, i) => decodeRef.current(g, i), setState, () => advanceRef.current(1));
    player.setVolume(readVolume());
    playerRef.current = player;
    window.nviewerMusic = player;
    return () => {
      player.dispose();
      playerRef.current = null;
      if (window.nviewerMusic === player) delete window.nviewerMusic;
    };
  }, []);

  useEffect(() => {
    playerRef.current?.setVolume(volume);
    writeStorage(VOLUME_KEY, String(volume));
  }, [volume]);

  useEffect(() => writeStorage(VISIBLE_KEY, visible ? '1' : '0'), [visible]);

  // Elapsed-time readout.
  useEffect(() => {
    if (state.status !== 'playing' && state.status !== 'paused') {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(playerRef.current?.position() ?? 0);
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [state]);

  // Stop when the playing game's ROM is removed.
  useEffect(() => {
    const track = state.track;
    if (track && !games.some((g) => g.id === track.gameId)) playerRef.current?.stop();
  }, [games, state.track]);

  // Keep the playing track visible in long lists (e.g. 76 songs).
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('.music-track.current')?.scrollIntoView({ block: 'nearest' });
  }, [state.track?.gameId, state.track?.index, pickedGame, currentGameId, visible]);

  // Follow the shown level's game unless the user picked another soundtrack.
  useEffect(() => setPickedGame(null), [currentGameId]);

  const musicGames = games.filter((g) => (g.music?.length ?? 0) > 0);
  const listGameId = pickedGame && games.some((g) => g.id === pickedGame) ? pickedGame : (currentGameId ?? games[0]?.id ?? null);
  const listGame = games.find((g) => g.id === listGameId) ?? null;
  const tracks = listGame?.music ?? [];
  const player = playerRef.current;
  const playing = state.status === 'playing';
  const hasTrack = state.track !== null && (state.status === 'playing' || state.status === 'paused');
  const canControl = hasTrack || tracks.length > 0;

  const playTrack = (gameId: string, t: MusicTrack) => void player?.play({ gameId, index: t.index, name: t.name });
  const onPlayPause = () => {
    if (!player) return;
    if (state.status === 'playing') player.pause();
    else if (state.status === 'paused') player.resume();
    else if (listGame && tracks.length > 0) playTrack(listGame.id, tracks[0]);
  };
  const onStep = (dir: number) => {
    if (!player) return;
    if (state.track) advanceRef.current(dir);
    else if (listGame && tracks.length > 0) playTrack(listGame.id, dir > 0 ? tracks[0] : tracks[tracks.length - 1]);
  };

  const status =
    state.status === 'rendering' ? 'Rendering…'
    : state.status === 'error' ? `Error: ${state.error}`
    : !state.track ? (tracks.length > 0 ? 'Pick a track to play' : '')
    : state.loop ? `Loops ${formatTime(state.loop.start)}–${formatTime(state.loop.end)}`
    : 'No loop: plays the next track at the end';

  return (
    <div className="hud music-box" aria-label="Music player">
      <div className="hud-row">
        <strong>Music</strong>
        <button type="button" id="music-visibility" className="link" onClick={() => setVisible((v) => !v)} aria-expanded={visible}>
          {visible ? 'Hide music' : 'Show music'}
        </button>
      </div>
      {visible && (
        <>
          {games.length > 1 && musicGames.length > 0 && (
            <label className="check select-row">
              Soundtrack
              <select id="music-game" value={listGameId ?? ''} onChange={(e) => setPickedGame(e.target.value)}>
                {games.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}{(g.music?.length ?? 0) === 0 ? ' (no music)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="music-now">
            <span className="music-title" id="music-title">{state.track?.name ?? '—'}</span>
            <span className="mono small" id="music-time">{formatTime(elapsed)} / {formatTime(state.duration)}</span>
          </div>
          <input
            id="music-seek"
            type="range"
            className="music-seek"
            min={0}
            max={Math.max(0.01, state.duration)}
            step={0.1}
            value={Math.min(elapsed, state.duration)}
            disabled={!hasTrack}
            aria-label="Position"
            onChange={(e) => {
              player?.seek(Number(e.target.value));
              setElapsed(Number(e.target.value));
            }}
          />
          <div className="music-controls">
            <button type="button" id="music-prev" onClick={() => onStep(-1)} disabled={!canControl} aria-label="Previous track" title="Previous">⏮</button>
            <button type="button" id="music-play" onClick={onPlayPause} disabled={!canControl || state.status === 'rendering'} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause' : 'Play'}>
              {playing ? '❚❚' : '▶'}
            </button>
            <button type="button" id="music-next" onClick={() => onStep(1)} disabled={!canControl} aria-label="Next track" title="Next">⏭</button>
            <input
              id="music-volume"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="Volume"
              title={`Volume ${Math.round(volume * 100)}%`}
            />
          </div>
          <div className="small muted music-status" id="music-status">
            {state.status === 'rendering' && <span className="spinner tiny" aria-hidden="true" />} {status}
          </div>
          {tracks.length > 0 && listGame ? (
            <ul ref={listRef} className="music-list" aria-label={`${listGame.title} soundtrack (${tracks.length} tracks)`}>
              {tracks.map((t) => {
                const current = state.track?.gameId === listGame.id && state.track.index === t.index && state.status !== 'idle';
                return (
                  <li key={t.index}>
                    <button
                      type="button"
                      className={`music-track${current ? ' current' : ''}`}
                      data-track={t.name}
                      title={t.name}
                      onClick={() => playTrack(listGame.id, t)}
                    >
                      {t.name}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="small muted" id="music-empty">
              {listGame ? `No music available for ${listGame.title} yet.` : 'No game loaded.'}
            </div>
          )}
        </>
      )}
    </div>
  );
}
