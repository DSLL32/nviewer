import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { LevelInfo, LevelKind, MusicTrack } from '../rom';
import { formatCount, type LevelStats } from './levelStats';

const GROUPS: { kind: LevelKind; title: string }[] = [
  { kind: 'hub', title: 'Hub' },
  { kind: 'campaign', title: 'Campaign' },
  { kind: 'adventure', title: 'Adventure' },
  { kind: 'bonus', title: 'Bonus' },
  { kind: 'boss', title: 'Boss' },
  { kind: 'race', title: 'Race Tracks' },
  { kind: 'battle', title: 'Battle Arenas' },
  { kind: 'stunt', title: 'Stunt Arenas' },
  { kind: 'obstacle', title: 'Obstacle Course' },
  { kind: 'other', title: 'Other' },
];

export const APP_NAME = 'N64 Level Viewer';

// A kind group with more titled sub-groups than this starts with them collapsed.
const MANY_SUBGROUPS = 3;
const SUBGROUPS_KEY = 'nviewer.subgroupsOpen';

export interface SidebarGame {
  id: string;
  title: string;
  fileName: string;
  levels: LevelInfo[];
  music?: MusicTrack[];
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

interface SubGroup {
  key: string; // unique within the game: kind + position + title
  title: string | null; // null: levels without a `group` (rendered without a heading)
  levels: LevelInfo[];
  defaultOpen: boolean;
}

interface KindGroup {
  kind: LevelKind;
  title: string;
  subgroups: SubGroup[];
}

/** Kind groups in display order, each split into runs of consecutive levels sharing `group`. */
function groupsOf(game: SidebarGame): KindGroup[] {
  return GROUPS.map((g) => {
    const subgroups: SubGroup[] = [];
    for (const l of game.levels) {
      if (l.kind !== g.kind || l.setupParent !== undefined) continue;
      const title = l.group ?? null;
      const last = subgroups[subgroups.length - 1];
      if (last && last.title === title) last.levels.push(l);
      else subgroups.push({ key: `${g.kind}|${subgroups.length}|${title ?? ''}`, title, levels: [l], defaultOpen: true });
    }
    const titled = subgroups.filter((s) => s.title !== null).length;
    for (const s of subgroups) s.defaultOpen = s.title === null || titled <= MANY_SUBGROUPS;
    return { kind: g.kind, title: g.title, subgroups };
  }).filter((g) => g.subgroups.length > 0);
}

/** Alternate setups use their visible parent row for sidebar selection and loading state. */
function visibleLevelRef(games: SidebarGame[], ref: LevelRef | null): LevelRef | null {
  if (!ref) return null;
  const game = games.find((g) => g.id === ref.gameId);
  const index = game?.levels.find((l) => l.index === ref.index)?.setupParent ?? ref.index;
  return { gameId: ref.gameId, index };
}

function readSubgroupsOpen(): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(SUBGROUPS_KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function Sidebar({ games, selected, loading, stats, collapsed, onToggleCollapsed, onSelect, onRemove, onAddRom }: SidebarProps) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [subOpen, setSubOpen] = useState<Record<string, boolean>>(readSubgroupsOpen);
  const subKey = (gameId: string, sub: SubGroup) => `${gameId}|${sub.key}`;
  const isOpen = (gameId: string, sub: SubGroup) => sub.title === null || (subOpen[subKey(gameId, sub)] ?? sub.defaultOpen);

  useEffect(() => {
    try {
      localStorage.setItem(SUBGROUPS_KEY, JSON.stringify(subOpen));
    } catch {
      /* storage unavailable */
    }
  }, [subOpen]);

  // The selected level's sub-group is opened whenever the selection changes.
  useEffect(() => {
    if (!selected) return;
    const game = games.find((g) => g.id === selected.gameId);
    if (!game) return;
    const visibleSelected = visibleLevelRef(games, selected);
    for (const group of groupsOf(game)) {
      const sub = group.subgroups.find((s) => s.levels.some((l) => l.index === visibleSelected?.index));
      if (sub && !isOpen(game.id, sub)) setSubOpen((o) => ({ ...o, [subKey(game.id, sub)]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.gameId, selected?.index, games]);

  const layout = games.map((game) => ({ game, groups: groupsOf(game) }));
  // Keyboard order follows the visual order across expanded game sections and open sub-groups.
  const ordered: LevelRef[] = layout
    .filter(({ game }) => !collapsed[game.id])
    .flatMap(({ game, groups }) =>
      groups.flatMap((g) => g.subgroups.filter((s) => isOpen(game.id, s)).flatMap((s) => s.levels.map((l) => ({ gameId: game.id, index: l.index })))),
    );
  const visibleSelected = visibleLevelRef(games, selected);
  const visibleLoading = visibleLevelRef(games, loading);
  const selectedVisible = ordered.some((r) => sameLevelRef(r, visibleSelected));
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
      position = ordered.findIndex((r) => sameLevelRef(r, visibleSelected));
    }
    switch (e.key) {
      case 'ArrowDown': move(position + 1); break;
      case 'ArrowUp': move(position < 0 ? 0 : position - 1); break;
      case 'Home': move(0); break;
      case 'End': move(ordered.length - 1); break;
    }
    e.preventDefault();
  };

  const renderLevels = (game: SidebarGame, levels: LevelInfo[]) => (
    <ul>
      {levels.map((l) => {
        const ref = { gameId: game.id, index: l.index };
        const s = stats[game.id]?.[l.index];
        const isSelected = sameLevelRef(ref, visibleSelected);
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
                {sameLevelRef(visibleLoading, ref) && <span className="spinner tiny" aria-label="loading" />}
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
  );

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <div className="app-title">{APP_NAME}</div>
      </header>
      <nav className="level-list" aria-label="Levels" onKeyDown={onKeyDown}>
        {layout.map(({ game, groups }) => {
          const isCollapsed = !!collapsed[game.id];
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
                  {groups.map((group) => (
                    <div key={group.kind} className="level-group">
                      <h2>{group.title}</h2>
                      {group.subgroups.map((sub) => {
                        if (sub.title === null) return <div key={sub.key}>{renderLevels(game, sub.levels)}</div>;
                        const open = isOpen(game.id, sub);
                        const key = subKey(game.id, sub);
                        return (
                          <div key={sub.key} className="level-subgroup" data-subgroup={sub.title}>
                            <button
                              type="button"
                              className="subgroup-toggle"
                              aria-expanded={open}
                              onClick={() => setSubOpen((o) => ({ ...o, [key]: !open }))}
                            >
                              <span className="chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
                              <span className="subgroup-name">{sub.title}</span>
                              <span className="subgroup-count">{sub.levels.length}</span>
                            </button>
                            {open && renderLevels(game, sub.levels)}
                          </div>
                        );
                      })}
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
