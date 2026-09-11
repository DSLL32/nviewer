import { APP_NAME } from './Sidebar';

interface LandingProps {
  busy: string | null;
  error: string | null;
  onPick: () => void;
}

export function Landing({ busy, error, onPick }: LandingProps) {
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
          </ul>
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
