import { useRef, type KeyboardEvent } from 'react';
import type { LevelInfo, LevelKind } from '../rom';
import { formatCount, type LevelStats } from './levelStats';

const GROUPS: { kind: LevelKind; title: string }[] = [
  { kind: 'race', title: 'Race Tracks' },
  { kind: 'battle', title: 'Battle Arenas' },
  { kind: 'stunt', title: 'Stunt Arenas' },
  { kind: 'obstacle', title: 'Obstacle Course' },
];

export const APP_NAME = 'Rush Level Viewer';

export interface SidebarGame {
  id: string;
  title: string;
  fileName: string;
  levels: LevelInfo[];
}

/** A level of a specific loaded game. */
export interface LevelRef {
  gameId: string;
  index: number;
}

export const sameLevelRef = (a: LevelRef | null | undefined, b: LevelRef | null | undefined) =>
  !!a && !!b && a.gameId === b.gameId && a.index === b.index;

interface SidebarProps {
  games: SidebarGame[];
  selected: LevelRef | null;
  loading: LevelRef | null;
  stats: Record<string, Record<number, LevelStats>>;
  collapsed: Record<string, boolean>;
  onToggleCollapsed: (gameId: string) => void;
  onSelect: (ref: LevelRef) => void;
  onRemove: (gameId: string) => void;
  onAddRom: () => void;
}

const groupsOf = (game: SidebarGame) =>
  GROUPS.map((g) => ({ ...g, levels: game.levels.filter((l) => l.kind === g.kind) })).filter((g) => g.levels.length > 0);

export function Sidebar({ games, selected, loading, stats, collapsed, onToggleCollapsed, onSelect, onRemove, onAddRom }: SidebarProps) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  // Keyboard order follows the visual order across expanded game sections.
  const ordered: LevelRef[] = games
    .filter((g) => !collapsed[g.id])
    .flatMap((game) => groupsOf(game).flatMap((g) => g.levels.map((l) => ({ gameId: game.id, index: l.index }))));
  const selectedVisible = ordered.some((r) => sameLevelRef(r, selected));
  const buttonKey = (r: LevelRef) => `${r.gameId}:${r.index}`;

  const move = (position: number) => {
    const target = ordered[Math.max(0, Math.min(ordered.length - 1, position))];
    if (!target) return;
    buttons.current.get(buttonKey(target))?.focus();
    onSelect(target);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const el = document.activeElement as HTMLElement | null;
    let position = -1;
    if (el?.dataset.level !== undefined) {
      position = ordered.findIndex((r) => r.gameId === el.dataset.game && r.index === Number(el.dataset.level));
    } else if (el?.dataset.gameHeader !== undefined) {
      // From a section header, Down enters that section.
      position = ordered.findIndex((r) => r.gameId === el.dataset.gameHeader) - 1;
      if (position < -1) position = ordered.length - 1;
    } else {
      position = ordered.findIndex((r) => sameLevelRef(r, selected));
    }
    switch (e.key) {
      case 'ArrowDown': move(position + 1); break;
      case 'ArrowUp': move(position < 0 ? 0 : position - 1); break;
      case 'Home': move(0); break;
      case 'End': move(ordered.length - 1); break;
    }
    e.preventDefault();
  };

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <div className="app-title">{APP_NAME}</div>
      </header>
      <nav className="level-list" aria-label="Levels" onKeyDown={onKeyDown}>
        {games.map((game) => {
          const isCollapsed = !!collapsed[game.id];
          const gameStats = stats[game.id] ?? {};
          return (
            <section key={game.id} className="game-section" data-game-section={game.id}>
              <div className="game-header">
                <button
                  type="button"
                  className="game-toggle"
                  data-game-header={game.id}
                  aria-expanded={!isCollapsed}
                  aria-controls={`game-levels-${game.id}`}
                  onClick={() => onToggleCollapsed(game.id)}
                  title={game.fileName}
                >
                  <span className="chevron" aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span>
                  <span className="game-name">{game.title}</span>
                </button>
                <button
                  type="button"
                  className="link game-remove"
                  onClick={() => onRemove(game.id)}
                  title={`Remove ${game.title} (${game.fileName}) from this browser`}
                >
                  Remove
                </button>
              </div>
              {!isCollapsed && (
                <div id={`game-levels-${game.id}`}>
                  {groupsOf(game).map((group) => (
                    <div key={group.kind} className="level-group">
                      <h2>{group.title}</h2>
                      <ul>
                        {group.levels.map((l) => {
                          const ref = { gameId: game.id, index: l.index };
                          const s = gameStats[l.index];
                          const isSelected = sameLevelRef(ref, selected);
                          const isFirst = sameLevelRef(ref, ordered[0]);
                          return (
                            <li key={l.index}>
                              <button
                                type="button"
                                data-game={game.id}
                                data-level={l.index}
                                ref={(el) => {
                                  if (el) buttons.current.set(buttonKey(ref), el);
                                  else buttons.current.delete(buttonKey(ref));
                                }}
                                className={`level-item${isSelected ? ' selected' : ''}`}
                                aria-current={isSelected ? 'true' : undefined}
                                tabIndex={isSelected || (!selectedVisible && isFirst) ? 0 : -1}
                                onClick={() => onSelect(ref)}
                              >
                                <span className="level-name">
                                  {l.name}
                                  {sameLevelRef(loading, ref) && <span className="spinner tiny" aria-label="loading" />}
                                </span>
                                {s && (
                                  <span className="level-stats" title={`${s.triangles} triangles, ${s.textures} textures, ${s.instances} placed objects (${s.scripted} scripted), parsed in ${s.loadMs.toFixed(0)} ms`}>
                                    {formatCount(s.triangles)} tris · {s.textures} tex · {s.instances} obj
                                  </span>
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </nav>
      <footer className="sidebar-footer">
        <button type="button" className="add-rom" onClick={onAddRom}>Add ROM…</button>
        <div className="small muted">A ROM of a game that is already loaded replaces it.</div>
      </footer>
    </aside>
  );
}
