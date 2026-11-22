import { useEvalHistory, useVisitCamera } from './evalHistory';
import type { DiagramJumpTarget } from '../../../../domain/core/diagrams/diagramJump';
import { PromoteOutput } from './PromoteOutput';
import { memo, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CanvasHistory } from '../../../../domain/core/diagrams/canvasHistory';
import type { CompareCanvasCopy } from '../../../../domain/mapping/compare/comparePageSession';
import { CompareCanvasPane } from './CompareCanvasPane';
import { OutputCommentContext } from './OutputComments';
import { TerminalMarkdownContent } from '../../../shared/markdown/TerminalMarkdownContent';
import { ExperimentOutputPanel } from './ExperimentOutputPanel';
import { CanvasLayoutPreview } from './CanvasLayoutPreview';
import type { CanvasTransform } from '../../../../domain/core/diagrams/diagramCanvas';
import type { CanvasOutputResult, EvalOutputResult } from '../../../../domain/mapping/evals/evalOutputResult';
import { changeDocumentPreview } from '../../../../domain/mapping/changes/changeDocumentPreview';
import { diffChangeDocument } from '../../../../domain/mapping/changes/changeDocumentDiff';
import { DiagramDiffCanvas } from '../changes/ChangeSessionPreview';
import { changeMigrationPreview } from '../changes/changeMigrationPreview';
import { readOutputResult } from './evalsApi';
import { errorMessage } from './evalsFormat';

export const OutputResultPreview = memo(function OutputResultPreview({ runId, cellKey }: { runId: string; cellKey: string }) {
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
  if (result.format === 'canvas-layout') return <CanvasLayoutPreview key={cellKey + runId} layout={result.layout} />;
  if (result.format === 'markdown') return <ExperimentOutputPanel title="Markdown output">
    <TerminalMarkdownContent className="output-markdown" source={result.markdown} />
  </ExperimentOutputPanel>;
  if (!result.canvases.length) return <p role="alert">This output has no saved canvases.</p>;
  return <FrozenOutputPreview key={`${runId}:${cellKey}`} result={result} runId={runId} cellKey={cellKey} />;
});

/** Local camera/fold state only. No live-session reads, polling, or acceptance actions. */
const FrozenOutputPreview = memo(function FrozenOutputPreview({ result, runId, cellKey }: { result: CanvasOutputResult; runId: string; cellKey: string }) {
  const comments = useContext(OutputCommentContext);
  const [promotion, setPromotion] = useState<{ canvasId?: string; diagramId?: string; name: string }>();
  const { navigation, visit } = useEvalHistory();
  const camera = useVisitCamera();
  const target = visit.view.canvas;
  const display = target?.display ?? 'regular';
  const [notice, setNotice] = useState('');
  const cameras = useRef(new Map<string, CanvasTransform>());
  const selectedId = comments?.activeComment?.anchor?.canvasId ?? target?.id;
  const canvas = result.canvases.find(item => item.id === selectedId) ?? result.canvases[0], session = result.changeSession;
  const commentCopy = useMemo<CompareCanvasCopy>(() => {
    const history = new CanvasHistory(canvas.proposed.document, canvas.proposed.canvas).export(true), head = history.headId;
    return { id: canvas.id, source: { documentId: canvas.id, checkpointId: head }, canvasName: canvas.name, history,
      view: { id: canvas.id, name: canvas.name, createdAt: '', savedAt: '', startCheckpointId: head, finalCheckpointId: head, checkpointIds: [head] } };
  }, [canvas]);
  const canvasIndex = result.canvases.indexOf(canvas);
  const cameraKey = `${canvas.id}:${display}`;
  const preview = useMemo(() => display === 'diff' ? changeDocumentPreview(canvas)
    : { doc: canvas, diff: diffChangeDocument(canvas), modifiedDiagramIds: new Set<string>(), removedDiagramIds: new Set<string>() }, [canvas, display]);
  const migrations = useMemo(() => changeMigrationPreview(preview.doc, display === 'diff' ? session?.migrations ?? [] : []), [preview, display, session]);
  const select = (next: number, focus?: DiagramJumpTarget, mode = display) => {
    const id = result.canvases[next].id;
    setNotice('');
    if (id === canvas.id && !focus && !target?.diagram && display === mode && !comments?.activeComment) return;
    const route = visit.route;
    navigation.update({ canvas: { id, display: mode, diagram: focus?.displayNodeId, node: focus?.contentNodeId } },
      route.kind === 'run' ? { ...route, comment: undefined } : route);
  };
  const jump = (focus: DiagramJumpTarget) => {
    const next = result.canvases.findIndex(doc => doc.id === focus.representationId || doc.representationId === focus.representationId);
    if (next < 0) { setNotice('The linked canvas is not included in this saved output.'); return; }
    select(next, focus);
  };
  // Capture the starting view once per visit. Camera events must never trigger a refit.
  const startCamera = useMemo(() => camera.initial ?? cameras.current.get(cameraKey), [camera, cameraKey]);
  const rememberCamera = (value: CanvasTransform) => { camera.remember(value); cameras.current.set(cameraKey, value); };
  return <section className="output-result-preview" aria-label="Execution result">
    {promotion && <PromoteOutput {...promotion} runId={runId} cellKey={cellKey} onClose={() => setPromotion(undefined)} />}
    <div className="output-result-toolbar" data-output-canvas-navigation onKeyDown={event => {
      if (event.target instanceof HTMLSelectElement || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      select((canvasIndex + (event.key === 'ArrowRight' ? 1 : -1) + result.canvases.length) % result.canvases.length);
    }}>
      <span>Canvas</span>
      <button type="button" aria-label="Previous canvas" disabled={result.canvases.length < 2} onClick={() => select((canvasIndex - 1 + result.canvases.length) % result.canvases.length)}>◀</button>
      <span aria-live="polite">{canvasIndex + 1} / {result.canvases.length}</span>
      <button type="button" aria-label="Next canvas" disabled={result.canvases.length < 2} onClick={() => select((canvasIndex + 1) % result.canvases.length)}>▶</button>
      <select aria-label="Output canvas" value={canvas.id} onChange={event => select(result.canvases.findIndex(doc => doc.id === event.target.value))}>
        {result.canvases.map(doc => <option key={doc.id} value={doc.id}>{doc.name}</option>)}
      </select>
      <span className="evals-muted">{canvas.baseline ? 'Existing canvas' : 'New canvas'}</span>
      <div role="group" aria-label="Output view">
        <button type="button" aria-pressed={display === 'regular'} onClick={() => { if (display !== 'regular') select(canvasIndex, undefined, 'regular'); }}>Result</button>
        {(session || result.canvases.some(doc => doc.baseline)) && <button type="button" aria-pressed={display === 'diff'} onClick={() => { if (display !== 'diff') select(canvasIndex, undefined, 'diff'); }}>Changes</button>}
      </div>
      <button type="button" onClick={() => setPromotion({ canvasId: canvas.id, name: canvas.name })}>Promote canvas…</button>
      {result.canvases.length > 1 && <button type="button" onClick={() => setPromotion({ name: "New canvas project" })}>Promote output set…</button>}
      {session && <small title={session.title}>Saved session v{session.version}</small>}
    </div>
    {notice && <p role="status" className="evals-notice">{notice}</p>}
    <div className="output-result-canvas" role="region" aria-label={`${canvas.name} · ${display === 'diff' ? 'Changes' : 'Result'}`}>
      <div className="change-session-preview">
        {comments && display === 'regular' ? <CompareCanvasPane copy={commentCopy} fitContent={!startCamera} bare focusFit="readable"
          camera={{ transform: startCamera ?? { offset: { x: 0, y: 0 }, scale: 1 } }} restoredCamera={camera.initial}
          onCameraChange={rememberCamera} focusContentNodeId={target?.node}
          focus={target?.diagram ? { id: visit.key, title: 'Linked diagram', focus: { type: 'DiagramFocused', diagramId: target.diagram } } : undefined}
          onDiagramContextMenu={id => setPromotion({ canvasId: canvas.id, diagramId: `grid:${id}`, name: canvas.name })} onJump={jump}
        /> : <DiagramDiffCanvas key={visit.key} {...preview} display={display} compact highlightAdded
          onPromoteDiagram={display === 'regular' ? diagramId => setPromotion({ canvasId: canvas.id, diagramId, name: canvas.name }) : undefined}
          initialTransform={startCamera} restoreFocusCamera={!!camera.initial} onTransformChange={rememberCamera}
          migrations={migrations} focusId={target?.diagram} focusContentNodeId={target?.node} serial={visit.index} onJump={jump} />}
      </div>
    </div>
  </section>;
});
