import { useRef, type KeyboardEvent } from 'react';
import { LEVELS, type LevelKind } from '../rom/level';
import { formatCount, type LevelStats } from './levelStats';

const GROUPS: { kind: LevelKind; title: string }[] = [
  { kind: 'race', title: 'Race Tracks' },
  { kind: 'battle', title: 'Battle Arenas' },
  { kind: 'stunt', title: 'Stunt Arenas' },
  { kind: 'obstacle', title: 'Obstacle Course' },
];

interface SidebarProps {
  selected: number | null;
  loading: number | null;
  stats: Record<number, LevelStats>;
  romName: string;
  onSelect: (index: number) => void;
  onReplaceRom: () => void;
  onForgetRom: () => void;
}

export function Sidebar({ selected, loading, stats, romName, onSelect, onReplaceRom, onForgetRom }: SidebarProps) {
  const buttons = useRef(new Map<number, HTMLButtonElement>());

  const move = (index: number) => {
    const target = Math.max(0, Math.min(LEVELS.length - 1, index));
    buttons.current.get(target)?.focus();
    onSelect(target);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const current = Number((document.activeElement as HTMLElement | null)?.dataset.level ?? selected ?? 0);
    switch (e.key) {
      case 'ArrowDown': move(current + 1); break;
      case 'ArrowUp': move(current - 1); break;
      case 'Home': move(0); break;
      case 'End': move(LEVELS.length - 1); break;
      default: return;
    }
    e.preventDefault();
  };

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <div className="app-title">Rush 2049 Viewer</div>
      </header>
      <nav className="level-list" aria-label="Levels" onKeyDown={onKeyDown}>
        {GROUPS.map((group) => (
          <section key={group.kind} className="level-group">
            <h2>{group.title}</h2>
            <ul>
              {LEVELS.filter((l) => l.kind === group.kind).map((l) => {
                const s = stats[l.index];
                const isSelected = l.index === selected;
                return (
                  <li key={l.index}>
                    <button
                      type="button"
                      data-level={l.index}
                      ref={(el) => {
                        if (el) buttons.current.set(l.index, el);
                        else buttons.current.delete(l.index);
                      }}
                      className={`level-item${isSelected ? ' selected' : ''}`}
                      aria-current={isSelected ? 'true' : undefined}
                      tabIndex={isSelected || (selected === null && l.index === 0) ? 0 : -1}
                      onClick={() => onSelect(l.index)}
                    >
                      <span className="level-name">
                        {l.name}
                        {loading === l.index && <span className="spinner tiny" aria-label="loading" />}
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
          </section>
        ))}
      </nav>
      <footer className="sidebar-footer">
        <div className="rom-name" title={romName}>{romName}</div>
        <div className="rom-actions">
          <button type="button" onClick={onReplaceRom}>Replace ROM</button>
          <button type="button" onClick={onForgetRom} title="Remove the cached ROM from this browser">Forget</button>
        </div>
      </footer>
    </aside>
  );
}
