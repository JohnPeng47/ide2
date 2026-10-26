import { useContext, useRef, useState } from 'react';
import { useQuickReactor, useValue } from 'tldraw';
import { CanvasRuntimeContext } from './CanvasRuntimeContext';
import { DiagramText } from '../../../shared/diagrams/DiagramText';
import type { AlternativeOperation } from '../../../../domain/mapping/workspace/diagramAlternatives';

export function DiagramSidePanelContent({ nodeId }: { nodeId: string }) {
  const runtime = useContext(CanvasRuntimeContext)!;
  const model = useValue(`side panel ${nodeId}`, () => runtime.panels.get(nodeId).get(), [runtime, nodeId]);
  const [error, setError] = useState('');
  const element = useRef<HTMLDivElement>(null);
  const restingZoom = useRef<number | undefined>(undefined);
  useQuickReactor('side panel pan layer', () => {
    const editor = runtime.editor, panel = element.current;
    if (!editor || !panel) return;
    const zoom = editor.getZoomLevel(), moving = editor.getCameraState() === 'moving';
    if (!moving || restingZoom.current === undefined) restingZoom.current = zoom;
    // Cache the panel's raster during translation only. Release it at rest or
    // on zoom so text is rasterized at the new scale instead of staying blurry.
    panel.style.willChange = moving && zoom === restingZoom.current ? 'transform' : '';
  }, [runtime, model]);
  if (!model) return null;
  const { panel, cell, bounds } = model;
  const command = (changes: Partial<Extract<AlternativeOperation, { method: 'side-panel' }>>) => {
    try { runtime.controller.applyUpdate(runtime.controller.getSnapshot().version, [{ method: 'side-panel', nodeId: panel.attachment.diagramPresentationId,
      alternativeId: panel.alternativeId, partIndex: panel.partIndex, ...changes }]); setError(''); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };
  const x1 = (model.anchor.column - bounds.column) * cell.width, x2 = panel.side === 'right' ? 0 : bounds.columns * cell.width;
  return <div ref={element} className="diagram-side-panel" data-side-panel={nodeId} data-panel-side={panel.side} data-panel-placement={panel.placement} data-mapping-static-ui data-diagram-canvas-static-ui
    onPointerDown={event => {
      const control = (event.target as Element).closest('button,input,textarea,select,a,[contenteditable=true]');
      const navigating = event.button === 1 || event.pointerType === 'touch'
        || runtime.editor?.inputs.getIsPanning() || runtime.editor?.getCurrentToolId() === 'hand';
      if (control || !navigating) event.stopPropagation();
    }} onDoubleClick={event => event.stopPropagation()}
    style={{ position: 'absolute', inset: 0, pointerEvents: 'auto', overflow: 'visible' }}>
    <svg aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
      <path d={`M ${x1} ${cell.height / 2} L ${x2} ${cell.height / 2}`} stroke="var(--border-strong)" fill="none" />
    </svg>
    <div className="diagram-side-panel-toolbar" style={{ position: 'absolute', bottom: '100%', left: 0, display: 'flex', whiteSpace: 'nowrap', fontSize: 12 }}>
      <span style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis' }} title={model.name}>{model.name}</span>
      <button aria-label="Toggle panel diff" aria-pressed={panel.display === 'diff'} onClick={() => command({ display: panel.display === 'diff' ? 'regular' : 'diff' })}>{panel.display === 'diff' ? 'Regular' : 'Diff'}</button>
      <button aria-label="Toggle panel layout flow" aria-pressed={panel.placement === 'flow'} onClick={() => command({ placement: panel.placement === 'flow' ? 'overlay' : 'flow' })}>{panel.placement === 'flow' ? 'Flow' : 'Overlay'}</button>
      <button aria-label="Auto-place panel" onClick={() => command({ autoPlace: true })}>Auto</button>
      {model.partCount > 1 && <select aria-label="Alternative part" value={panel.partIndex} onChange={event => {
        const partIndex = Number(event.target.value);
        try { runtime.controller.applyUpdate(runtime.controller.getSnapshot().version, [
          { method: 'side-panel', nodeId: panel.attachment.diagramPresentationId, alternativeId: panel.alternativeId, partIndex: panel.partIndex, close: true },
          { method: 'side-panel', nodeId: panel.attachment.diagramPresentationId, alternativeId: panel.alternativeId, partIndex, placement: panel.placement, display: panel.display }]); }
        catch (e) { setError(String(e)); }
      }}>{Array.from({ length: model.partCount }, (_, i) => <option key={i} value={i}>Part {i + 1}</option>)}</select>}
      <button aria-label="Close alternative panel" onClick={() => command({ close: true })}>×</button>
    </div>
    <DiagramText className="mapping-poc-ascii" rows={model.rows} />
    {error && <div role="alert">{error}</div>}
  </div>;
}
