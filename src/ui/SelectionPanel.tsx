import { useEffect, useRef, useState } from 'react';
import type { Texture } from '../rom';
import type { SelectionReport } from './selectionInfo';

interface SelectionPanelProps {
  report: SelectionReport;
  texture: Texture | null;
  onClear: () => void;
  /** Send a bug report for this selection (when the dev server's report endpoint is available); else Copy is offered. */
  onReport?: () => void;
  reportBusy?: boolean;
}

export function SelectionPanel({ report, texture, onClear, onReport, reportBusy }: SelectionPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    setCopyState('idle');
    panelRef.current?.scrollIntoView({ block: 'nearest' });
  }, [report]);

  const copy = async () => {
    setCopyState((await copyText(report.copyText)) ? 'copied' : 'failed');
  };

  return (
    <div ref={panelRef} className="hud selection-panel" id="selection-panel" aria-live="polite">
      <div className="hud-row">
        <strong className="selection-title">{report.title}</strong>
        <span className="selection-actions">
          {onReport ? (
            <button type="button" id="selection-report" onClick={onReport} disabled={reportBusy} title="Describe the issue and save a report with screenshots">
              Report
            </button>
          ) : (
            <button type="button" id="selection-copy" onClick={() => void copy()}>
              {copyState === 'copied' ? 'Copied' : 'Copy'}
            </button>
          )}
          <button type="button" className="link" id="selection-clear" onClick={onClear}>Clear</button>
        </span>
      </div>
      {copyState === 'failed' && <div className="small error">Could not access the clipboard.</div>}
      {texture && <TextureThumb texture={texture} />}
      {report.sections.map((s) => (
        <section key={s.title} className="selection-section">
          <h3>{s.title}</h3>
          <dl className="selection-rows">
            {s.rows.map(([label, value], i) => (
              <div key={`${label}-${i}`} className="selection-row">
                <dt>{label}</dt>
                <dd className="mono">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

const THUMB_MAX = 96; // CSS pixels for the larger side

function TextureThumb({ texture }: { texture: Texture }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const w = Math.max(1, texture.width | 0);
  const h = Math.max(1, texture.height | 0);
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pixels = new Uint8ClampedArray(w * h * 4);
    pixels.set(texture.rgba.subarray(0, pixels.length));
    ctx.putImageData(new ImageData(pixels, w, h), 0, 0);
  }, [texture, w, h]);
  const scale = Math.max(1, Math.min(8, Math.floor(THUMB_MAX / Math.max(w, h))));
  return (
    <div className="texture-thumb">
      <canvas ref={canvasRef} id="selection-texture" width={w} height={h} style={{ width: w * scale, height: h * scale }} />
    </div>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fall back to a temporary text area (e.g. no clipboard permission in an embedded page).
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
