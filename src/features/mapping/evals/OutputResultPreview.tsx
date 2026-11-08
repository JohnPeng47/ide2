import { PromoteOutput } from './PromoteOutput';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasTransform } from '../../../../domain/core/diagrams/diagramCanvas';
import type { EvalOutputResult } from '../../../../domain/mapping/evals/evalOutputResult';
import { changeDocumentPreview } from '../../../../domain/mapping/changes/changeDocumentPreview';
import { diffChangeDocument } from '../../../../domain/mapping/changes/changeDocumentDiff';
import { DiagramDiffCanvas } from '../changes/ChangeSessionPreview';
import { changeMigrationPreview } from '../changes/changeMigrationPreview';
import { readOutputResult } from './evalsApi';
import { errorMessage } from './evalsFormat';

export function OutputResultPreview({ runId, cellKey }: { runId: string; cellKey: string }) {
  const [result, setResult] = useState<EvalOutputResult>();
  const [error, setError] = useState('');
  useEffect(() => {
    let closed = false;
    setResult(undefined); setError('');
    void readOutputResult(runId, cellKey).then(value => { if (!closed) setResult(value); })
      .catch(error => { if (!closed) setError(errorMessage(error)); });
    return () => { closed = true; };
  }, [runId, cellKey]);
  if (error) return <p className="evals-error" role="alert">{error}</p>;
  if (!result) return <p role="status">Loading output…</p>;
  if (!result.canvases.length) return <p role="alert">This output has no saved canvases.</p>;
  return <FrozenOutputPreview key={`${runId}:${cellKey}`} result={result} runId={runId} cellKey={cellKey} />;
}

/** Local camera/fold state only. No live-session reads, polling, or acceptance actions. */
function FrozenOutputPreview({ result, runId, cellKey }: { result: EvalOutputResult; runId: string; cellKey: string }) {
  const [promotion, setPromotion] = useState<{ canvasId?: string; diagramId?: string; name: string }>();
  const [index, setIndex] = useState(0), [display, setDisplay] = useState<'regular' | 'diff'>('regular');
  const [focus, setFocus] = useState<{ displayNodeId?: string; contentNodeId?: string; serial: number }>({ serial: 0 });
  const [notice, setNotice] = useState('');
  const cameras = useRef(new Map<string, CanvasTransform>());
  const canvas = result.canvases[index], session = result.changeSession;
  const cameraKey = `${canvas.id}:${display}`;
  const preview = useMemo(() => display === 'diff' ? changeDocumentPreview(canvas)
    : { doc: canvas, diff: diffChangeDocument(canvas), modifiedDiagramIds: new Set<string>(), removedDiagramIds: new Set<string>() }, [canvas, display]);
  const migrations = useMemo(() => changeMigrationPreview(preview.doc, display === 'diff' ? session?.migrations ?? [] : []), [preview, display, session]);
  const select = (next: number) => { setIndex(next); setFocus({ serial: focus.serial + 1 }); setNotice(''); };
  return <section className="output-result-preview" aria-label="Execution result">
    {promotion && <PromoteOutput {...promotion} runId={runId} cellKey={cellKey} onClose={() => setPromotion(undefined)} />}
    <div className="output-result-toolbar" data-output-canvas-navigation onKeyDown={event => {
      if (event.target instanceof HTMLSelectElement || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      select((index + (event.key === 'ArrowRight' ? 1 : -1) + result.canvases.length) % result.canvases.length);
    }}>
      <span>Canvas</span>
      <button type="button" aria-label="Previous canvas" disabled={result.canvases.length < 2} onClick={() => select((index - 1 + result.canvases.length) % result.canvases.length)}>◀</button>
      <span aria-live="polite">{index + 1} / {result.canvases.length}</span>
      <button type="button" aria-label="Next canvas" disabled={result.canvases.length < 2} onClick={() => select((index + 1) % result.canvases.length)}>▶</button>
      <select aria-label="Output canvas" value={canvas.id} onChange={event => select(result.canvases.findIndex(doc => doc.id === event.target.value))}>
        {result.canvases.map(doc => <option key={doc.id} value={doc.id}>{doc.name}</option>)}
      </select>
      <span className="evals-muted">{canvas.baseline ? 'Existing canvas' : 'New canvas'}</span>
      <div role="group" aria-label="Output view">
        <button type="button" aria-pressed={display === 'regular'} onClick={() => { setDisplay('regular'); setNotice(''); }}>Result</button>
        {(session || result.canvases.some(doc => doc.baseline)) && <button type="button" aria-pressed={display === 'diff'} onClick={() => { setDisplay('diff'); setNotice(''); }}>Changes</button>}
      </div>
      <button type="button" onClick={() => setPromotion({ canvasId: canvas.id, name: canvas.name })}>Promote canvas…</button>
      {result.canvases.length > 1 && <button type="button" onClick={() => setPromotion({ name: "New canvas project" })}>Promote output set…</button>}
      {session && <small title={session.title}>Saved session v{session.version}</small>}
    </div>
    {notice && <p role="status" className="evals-notice">{notice}</p>}
    <div className="output-result-canvas" role="region" aria-label={`${canvas.name} · ${display === 'diff' ? 'Changes' : 'Result'}`}>
      <div className="change-session-preview">
        <DiagramDiffCanvas key={cameraKey} {...preview} display={display} compact highlightAdded
          onPromoteDiagram={display === "regular" ? diagramId => setPromotion({ canvasId: canvas.id, diagramId, name: canvas.name }) : undefined}
          initialTransform={cameras.current.get(cameraKey)} onTransformChange={value => { cameras.current.set(cameraKey, value); }}
          migrations={migrations} focusId={focus.displayNodeId} focusContentNodeId={focus.contentNodeId} serial={focus.serial}
          onJump={target => {
            const next = result.canvases.findIndex(doc => doc.id === target.representationId || doc.representationId === target.representationId);
            if (next < 0) { setNotice('The linked canvas is not included in this saved output.'); return; }
            setNotice(''); setIndex(next);
            setFocus({ displayNodeId: target.displayNodeId, contentNodeId: target.contentNodeId, serial: focus.serial + 1 });
          }} />
      </div>
    </div>
  </section>;
}
