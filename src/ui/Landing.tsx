import { APP_NAME } from './Sidebar';

interface LandingProps {
  busy: string | null;
  error: string | null;
  onPick: () => void;
  onPickBbgames: () => void;
}

export function Landing({ busy, error, onPick, onPickBbgames }: LandingProps) {
  return (
    <main className="landing">
      <div className="landing-card">
        <h1>{APP_NAME}</h1>
        <p className="muted">
          Fly through the levels of N64 games: tracks, arenas and adventure maps. Your ROMs stay in this browser:
          they are parsed locally and cached for next time. Load several games at once.
        </p>
        <div className="supported">
          <div className="small muted">Supported ROMs (.z64 / .v64 / .n64):</div>
          <ul>
            <li>San Francisco Rush 2049 (U)</li>
            <li>San Francisco Rush: Extreme Racing (U)</li>
            <li>Bomberman 64 (U)</li>
            <li>Bomberman 64: The Second Attack! (U)</li>
            <li>Bomberman Hero (U)</li>
            <li>BattleTanx (U)</li>
            <li>BattleTanx: Global Assault (U)</li>
            <li>Gex 64: Enter the Gecko (U)</li>
            <li>Gex 3: Deep Cover Gecko (U)</li>
            <li>Yoshi's Story (J)</li>
            <li>Star Fox 64 (U) (V1.0, V1.1)</li>
            <li>Spider-Man (U)</li>
            <li>Star Wars: Shadows of the Empire (U V1.0–V1.2, E)</li>
            <li>The World Is Not Enough (U/E)</li>
            <li>GoldenEye 007 (U)</li>
            <li>A Bug's Life (U/E/F/G/I)</li>
            <li>Air Boarder 64 (J/E)</li>
            <li>Banjo-Kazooie (U) (V1.0)</li>
            <li>Mario Kart 64 (U) (V1.0)</li>
            <li>Mario Party (J) (revision 0)</li>
            <li>Pilotwings 64 (U/E/J)</li>
            <li>Perfect Dark (U) (V1.0)</li>
            <li>The Legend of Zelda: Ocarina of Time, Majora's Mask (retail and debug)</li>
            <li>F-Zero X (CFZE) development ROM with the 1997 Ocarina of Time prototype</li>
          </ul>
          <div className="small muted">Zelda source maps: choose the bbgames folder in a directory-handle browser. Folder access is not saved.</div>
        </div>
        <div className="dropzone" aria-busy={busy !== null}>
          {busy ? (
            <div className="busy">
              <span className="spinner" aria-hidden="true" />
              {busy}
            </div>
          ) : (
            <>
              <button type="button" className="primary" onClick={onPick} autoFocus>
                Choose ROM file…
              </button>
              <button type="button" onClick={onPickBbgames}>Open bbgames folder…</button>
              <div className="muted small">or drop the ROM file anywhere on this page</div>
            </>
          )}
        </div>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </div>
    </main>
  );
}
