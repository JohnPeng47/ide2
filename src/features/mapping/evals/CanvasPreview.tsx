import { useEffect, useState } from 'react';
import type { CompareCanvasCopy } from '../../../../domain/mapping/compare/comparePageSession';
import type { MappingCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { CompareCanvasPane } from './CompareCanvasPane';
import { readGenerated } from './evalsApi';
import { errorMessage, provenanceDetail } from './evalsFormat';

/** Read-only preview: browsing outputs never replaces the Mapping canvas. */
export function CanvasPreview({ canvasId, bare }: { canvasId: string; bare?: boolean }) {
  const [copy, setCopy] = useState<CompareCanvasCopy>(), [error, setError] = useState('');
  useEffect(() => {
    let closed = false; setCopy(undefined); setError('');
    void readGenerated(canvasId).then(canvas => {
      if (closed) return;
      const head = canvas.history.headId, at = new Date().toISOString();
      setCopy({ id: canvasId, source: { documentId: canvasId, checkpointId: head }, canvasName: canvas.generated.contextName, history: canvas.history, generated: canvas.generated,
        view: { id: canvasId, name: canvas.name, createdAt: at, savedAt: at, startCheckpointId: head, finalCheckpointId: head, checkpointIds: [head] } });
    }).catch(error => { if (!closed) setError(errorMessage(error)); });
    return () => { closed = true; };
  }, [canvasId]);
  if (error) return <p role="alert" className="evals-error">{error}</p>;
  if (!copy) return <p role="status" className="evals-muted canvas-preview-loading">Loading preview…</p>;
  const viewport = (copy.history.snapshots[copy.history.headId].view as MappingCanvasState | undefined)?.viewport;
  return <div className="canvas-preview"><CompareCanvasPane copy={copy} fitContent bare={bare} detail={provenanceDetail(copy.view.name, copy.generated)}
    camera={{ transform: viewport ?? { offset: { x: 170, y: 36 }, scale: 1 } }}
    actions={<a className="evals-button" href={`${import.meta.env.BASE_URL}?diagram=${encodeURIComponent(canvasId)}`} target="_blank" rel="noreferrer">Open in Mapping ↗</a>} /></div>;
}
