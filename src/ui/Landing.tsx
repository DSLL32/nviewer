interface LandingProps {
  busy: string | null;
  error: string | null;
  onPick: () => void;
}

export function Landing({ busy, error, onPick }: LandingProps) {
  return (
    <main className="landing">
      <div className="landing-card">
        <h1>Rush 2049 Level Viewer</h1>
        <p className="muted">
          Explore the tracks and arenas of <em>San Francisco Rush 2049</em> (N64, USA). Your ROM stays in this browser:
          it is parsed locally and cached for next time.
        </p>
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
              <div className="muted small">or drop a .z64 / .v64 / .n64 file anywhere on this page</div>
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
