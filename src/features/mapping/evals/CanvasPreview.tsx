import { LayoutProvenance, SaveLayoutTemplate } from './LayoutTemplates';
import { useEffect, useState } from 'react';
import type { CompareCanvasCopy } from '../../../../domain/mapping/compare/comparePageSession';
import type { MappingCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { CompareCanvasPane } from './CompareCanvasPane';
import { readGenerated } from './evalsApi';
import { errorMessage, provenanceDetail } from './evalsFormat';
import { PopoverMenu } from './PopoverMenu';
import { promoteDiagramToCanvas } from './promoteDiagram';

/** Read-only preview: browsing outputs never replaces the Mapping canvas. */
export function CanvasPreview({ canvasId, checkpointId, deleted, bare }: { canvasId: string; checkpointId?: string; deleted?: boolean; bare?: boolean }) {
  const [savingLayout, setSavingLayout] = useState(false);
  const [copy, setCopy] = useState<CompareCanvasCopy>(), [error, setError] = useState('');
  const [menu, setMenu] = useState<{ boxId: string; at: { x: number; y: number } }>();
  const [promotion, setPromotion] = useState<{ busy: boolean; message?: string; error?: string }>();
  useEffect(() => {
    let closed = false; setCopy(undefined); setError('');
    void readGenerated(canvasId, checkpointId).then(canvas => {
      if (closed) return;
      const head = checkpointId ?? canvas.history.headId, at = new Date().toISOString();
      if (!canvas.history.snapshots[head]) throw Error('The pinned output snapshot is unavailable.');
      canvas.history.headId = head;
      setCopy({ id: canvasId, source: { documentId: canvasId, checkpointId: head }, canvasName: canvas.generated.contextName, history: canvas.history, generated: canvas.generated,
        view: { id: canvasId, name: canvas.name, createdAt: at, savedAt: at, startCheckpointId: head, finalCheckpointId: head, checkpointIds: [head] } });
    }).catch(error => { if (!closed) setError(errorMessage(error)); });
    return () => { closed = true; };
  }, [canvasId, checkpointId]);
  if (error) return <p role="alert" className="evals-error">{error}</p>;
  if (!copy) return <p role="status" className="evals-muted canvas-preview-loading">Loading preview…</p>;
  const viewport = (copy.history.snapshots[copy.history.headId].view as MappingCanvasState | undefined)?.viewport;
  const promote = (boxId: string) => {
    // Open the tab during the click so popup blockers allow it; it navigates once the canvas is saved.
    const tab = window.open('', '_blank');
    setPromotion({ busy: true, message: 'Creating standard canvas…' });
    void promoteDiagramToCanvas(canvasId, copy.history, boxId, copy.view.name).then(representation => {
      const url = `${import.meta.env.BASE_URL}?diagram=${encodeURIComponent(representation.id)}`;
      if (tab) tab.location.href = url; else window.open(url, '_blank');
      setPromotion({ busy: false, message: `Created “${representation.name}”` });
    }).catch(error => { tab?.close(); setPromotion({ busy: false, error: errorMessage(error) }); });
  };
  return <div className="canvas-preview">
    {menu && <PopoverMenu label="Diagram" at={menu.at} onClose={() => setMenu(undefined)} sections={[{ items: [
      { label: 'Promote to standard canvas', detail: 'opens in Mapping', onSelect: () => promote(menu.boxId) }] }]} />}
    {promotion && <p role={promotion.error ? 'alert' : 'status'} className={promotion.error ? 'evals-error' : 'evals-muted'}>{promotion.error ?? promotion.message}</p>}
    {savingLayout && <SaveLayoutTemplate source={copy.source} onClose={() => setSavingLayout(false)} />}
    {copy.generated?.layoutTemplate && <LayoutProvenance template={copy.generated.layoutTemplate} placements={copy.generated.layoutPlacements} />}{copy.generated?.generation && <details className="output-details"><summary>Original generation prompts</summary>
    {Object.entries({ 'Original triggering prompt': copy.generated.generation.triggerPrompt, 'Shared generation task': copy.generated.generation.taskPrompt,
      'Candidate prompt': copy.generated.generation.prompt }).map(([label, text]) => text ? <section key={label}><strong>{label}</strong><pre style={{ whiteSpace: 'pre-wrap' }}>{text}</pre></section> : null)}
  </details>}<CompareCanvasPane copy={copy} fitContent bare={bare}
    onDiagramContextMenu={deleted || promotion?.busy ? undefined : (boxId, at) => setMenu({ boxId, at })} detail={provenanceDetail(copy.view.name, copy.generated)}
    camera={{ transform: viewport ?? { offset: { x: 170, y: 36 }, scale: 1 } }}
    actions={<><button type="button" className="evals-button" onClick={() => setSavingLayout(true)}>Save layout as template</button>{!deleted && <a className="evals-button" href={`${import.meta.env.BASE_URL}?diagram=${encodeURIComponent(canvasId)}`} target="_blank" rel="noreferrer">Open in Mapping ↗</a>}</>} /></div>;
}
