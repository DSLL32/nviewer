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
          Fly through the tracks and arenas of the N64 <em>San Francisco Rush</em> games. Your ROM stays in this
          browser: it is parsed locally and cached for next time.
        </p>
        <div className="supported">
          <div className="small muted">Supported ROMs (USA versions, .z64 / .v64 / .n64):</div>
          <ul>
            <li>San Francisco Rush 2049 (U)</li>
            <li>San Francisco Rush: Extreme Racing (U)</li>
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
