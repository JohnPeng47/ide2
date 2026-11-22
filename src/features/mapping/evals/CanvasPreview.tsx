import { useEvalHistory, useVisitCamera } from './evalHistory';
import { PromoteOutput } from './PromoteOutput';
import { documentFromHistory } from '../../../../domain/core/diagrams/canvasHistory';
import { diagramTitle } from '../../../../domain/core/diagrams/promoteDiagram';
import { LayoutProvenance, SaveLayoutTemplate } from './LayoutTemplates';
import { useEffect, useState } from 'react';
import type { CompareCanvasCopy } from '../../../../domain/mapping/compare/comparePageSession';
import type { MappingCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { CompareCanvasPane } from './CompareCanvasPane';
import { loadCanvasPreview, peekCanvasPreview } from './canvasPreviewCache';
import { errorMessage, provenanceDetail } from './evalsFormat';
import { PopoverMenu } from './PopoverMenu';
import { promoteDiagramToCanvas } from './promoteDiagram';
import { OutputSidebar } from './OutputSidebar';

/** Read-only preview: browsing outputs never replaces the Mapping canvas. */
export function CanvasPreview({ canvasId, checkpointId, deleted, bare, promotionSource, focusDiagram, focusTitle }: { promotionSource?: { runId: string; cellKey: string }; canvasId: string; checkpointId?: string; deleted?: boolean; bare?: boolean;
  /** Display ID of one diagram to frame; the whole canvas is framed otherwise. */ focusDiagram?: string; focusTitle?: string }) {
  const { visit, navigation } = useEvalHistory();
  const camera = useVisitCamera();
  const viewed = visit.view.canvas;
  focusDiagram = viewed?.diagram ?? focusDiagram;
  const [promoting, setPromoting] = useState<{ diagramId?: string }>();
  const [diagram, setDiagram] = useState('');
  const [savingLayout, setSavingLayout] = useState(false);
  const [loaded, setCopy] = useState<CompareCanvasCopy>(), [error, setError] = useState('');
  const copy = peekCanvasPreview(canvasId, checkpointId) ?? (loaded?.id === canvasId && (!checkpointId || loaded.source.checkpointId === checkpointId) ? loaded : undefined);
  const [menu, setMenu] = useState<{ boxId: string; at: { x: number; y: number } }>();
  const [promotion, setPromotion] = useState<{ busy: boolean; message?: string; error?: string }>();
  useEffect(() => {
    let closed = false; setError(''); setPromoting(undefined); setMenu(undefined); setSavingLayout(false); setDiagram(''); setPromotion(undefined);
    void loadCanvasPreview(canvasId, checkpointId, promotionSource).then(copy => { if (!closed) setCopy(copy); })
      .catch(error => { if (!closed) setError(errorMessage(error)); });
    return () => { closed = true; };
  }, [canvasId, checkpointId, promotionSource?.runId, promotionSource?.cellKey]);
  if (error) return <p role="alert" className="evals-error">{error}</p>;
  if (!copy) return <p role="status" className="evals-muted canvas-preview-loading">Loading preview…</p>;
  const items: { id: string; name: string }[] = [];
  const document = documentFromHistory(copy.history);
  const walk = (box: typeof document.scene.root) => { if (box.kind === 'container') box.children.forEach(walk); else items.push({ id: `grid:${box.id}`, name: diagramTitle(document.scene.contents[box.contentId].content.ascii) ?? box.id }); }; walk(document.scene.root);
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
    {promoting && promotionSource && <PromoteOutput {...promotionSource} canvasId={canvasId} diagramId={promoting.diagramId} name={copy.view.name} onClose={() => setPromoting(undefined)} />}
    {menu && <PopoverMenu label="Diagram" at={menu.at} onClose={() => setMenu(undefined)} sections={[{ items: [
      { label: 'Promote to standard canvas', detail: 'opens in Mapping', onSelect: () => promotionSource ? setPromoting({ diagramId: `grid:${menu.boxId}` }) : promote(menu.boxId) }] }]} />}
    {promotion && <p role={promotion.error ? 'alert' : 'status'} className={promotion.error ? 'evals-error' : 'evals-muted'}>{promotion.error ?? promotion.message}</p>}
    {savingLayout && <SaveLayoutTemplate source={copy.source} onClose={() => setSavingLayout(false)} />}
    <OutputSidebar>{copy.generated?.layoutTemplate && <LayoutProvenance template={copy.generated.layoutTemplate} placements={copy.generated.layoutPlacements} />}{copy.generated?.generation && <details className="output-details"><summary>Original generation prompts</summary>
    {Object.entries({ 'Original triggering prompt': copy.generated.generation.triggerPrompt, 'Shared generation task': copy.generated.generation.taskPrompt,
      'Candidate prompt': copy.generated.generation.prompt }).map(([label, text]) => text ? <section key={label}><strong>{label}</strong><pre style={{ whiteSpace: 'pre-wrap' }}>{text}</pre></section> : null)}
  </details>}</OutputSidebar><CompareCanvasPane copy={copy} fitContent restoredCamera={camera.initial} onCameraChange={camera.remember} bare={bare} focusFit="readable"
    focus={focusDiagram ? { id: `diagram:${focusDiagram}`, title: focusTitle || focusDiagram, focus: { type: 'DiagramFocused', diagramId: focusDiagram } } : undefined}
    focusContentNodeId={viewed?.node} onJump={target => {
      const id = target.representationId;
      const same = id === canvasId || id === copy.source.documentId;
      navigation.update({ canvas: { id, diagram: target.displayNodeId, node: target.contentNodeId } }, same ? visit.route : { kind: 'canvas', id });
    }}
    onDiagramContextMenu={deleted || promotion?.busy ? undefined : (boxId, at) => setMenu({ boxId, at })} detail={provenanceDetail(copy.view.name, copy.generated)}
    camera={{ transform: viewport ?? { offset: { x: 170, y: 36 }, scale: 1 } }}
    actions={<>{promotionSource && <><button type="button" onClick={() => setPromoting({})}>Promote canvas…</button><select aria-label="Diagram to promote" value={diagram} onChange={e => setDiagram(e.target.value)}><option value="">Choose a diagram</option>{items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" disabled={!diagram} onClick={() => setPromoting({ diagramId: diagram })}>Promote diagram…</button></>}<button type="button" className="evals-button" onClick={() => setSavingLayout(true)}>Save layout as template</button>{!deleted && <a className="evals-button" href={`${import.meta.env.BASE_URL}?diagram=${encodeURIComponent(canvasId)}`} target="_blank" rel="noreferrer">Open in Mapping ↗</a>}</>} /></div>;
}
